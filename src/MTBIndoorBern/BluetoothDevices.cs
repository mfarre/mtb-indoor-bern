using System.Collections.Concurrent;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.Advertisement;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Storage.Streams;

namespace MTBIndoorBern;

internal enum SensorRole { Trainer, HeartRate, Controller }

internal sealed record NearbyDevice(ulong Address, string Name, short Rssi, Guid[] Services, byte? ZwiftType = null)
{
    public string DisplayName => ZwiftType switch { 10 => "Zwift Click 2 · dret", 11 => "Zwift Click 2 · esquerre", 9 => "Zwift Click 1", _ => Name };
    public override string ToString() => Rssi==0?$"{DisplayName}   ·   recordat":$"{DisplayName}   ·   {Rssi} dBm";
    public bool Matches(SensorRole role) => role switch
    {
        SensorRole.Trainer => Services.Contains(BleIds.Ftms) || Services.Contains(BleIds.Power) || Name.Contains("KICKR", StringComparison.OrdinalIgnoreCase),
        SensorRole.HeartRate => Services.Contains(BleIds.HeartRate) || Name.Contains("TICKR", StringComparison.OrdinalIgnoreCase) || Name.Contains("Polar", StringComparison.OrdinalIgnoreCase),
        _ => Services.Contains(BleIds.OpenBikeControl) || Name.Contains("Zwift", StringComparison.OrdinalIgnoreCase) || Name.Contains("Click", StringComparison.OrdinalIgnoreCase) || Name.Contains("BikeControl", StringComparison.OrdinalIgnoreCase)
    };
}

internal static class BleIds
{
    public static Guid Standard(int id) => new($"0000{id:x4}-0000-1000-8000-00805f9b34fb");
    public static readonly Guid Ftms = Standard(0x1826), Power = Standard(0x1818), HeartRate = Standard(0x180d);
    public static readonly Guid OpenBikeControl = new("d273f680-d548-419d-b9d1-fa0472345229");
    public static readonly Guid Buttons = new("d273f681-d548-419d-b9d1-fa0472345229");
    public static readonly Guid Zwift = new("00000001-19ca-4651-86e5-fa29dcdd09d1");
    public static readonly Guid ZwiftV2 = Standard(0xfc82);
    public static readonly Guid ZwiftNotifications = new("00000002-19ca-4651-86e5-fa29dcdd09d1");
    public static readonly Guid ZwiftWrite = new("00000003-19ca-4651-86e5-fa29dcdd09d1");
    public static readonly Guid ZwiftReply = new("00000004-19ca-4651-86e5-fa29dcdd09d1");
}

internal static class Discovery
{
    public static async Task<NearbyDevice[]> ScanAsync(CancellationToken cancellationToken, int durationSeconds = 12)
    {
        var adapter = await BluetoothAdapter.GetDefaultAsync().AsTask(cancellationToken);
        if (adapter is null || !adapter.IsLowEnergySupported)
            throw new InvalidOperationException("Windows no troba cap adaptador Bluetooth LE disponible.");
        var devices = new ConcurrentDictionary<ulong, NearbyDevice>();
        var watcher = new BluetoothLEAdvertisementWatcher { ScanningMode = BluetoothLEScanningMode.Active };
        BluetoothError? stoppedError = null;
        watcher.Received += (_, e) =>
        {
            byte? zwiftType = null;
            var manufacturer = e.Advertisement.ManufacturerData.FirstOrDefault(m => m.CompanyId == 2378);
            if (manufacturer is not null && manufacturer.Data.Length > 0)
            {
                using var reader = DataReader.FromBuffer(manufacturer.Data);
                zwiftType = reader.ReadByte();
            }
            devices.AddOrUpdate(e.BluetoothAddress,
                _ => new(e.BluetoothAddress, e.Advertisement.LocalName, e.RawSignalStrengthInDBm, e.Advertisement.ServiceUuids.ToArray(), zwiftType),
                (_, previous) => new(e.BluetoothAddress,
                    string.IsNullOrWhiteSpace(e.Advertisement.LocalName) ? previous.Name : e.Advertisement.LocalName,
                    e.RawSignalStrengthInDBm, previous.Services.Union(e.Advertisement.ServiceUuids).ToArray(), zwiftType ?? previous.ZwiftType));
        };
        watcher.Stopped += (_, e) => stoppedError = e.Error;
        try
        {
            watcher.Start();
            await Task.Delay(TimeSpan.FromSeconds(Math.Clamp(durationSeconds,1,12)), cancellationToken);
        }
        finally { watcher.Stop(); }
        if (stoppedError is not null && stoppedError != BluetoothError.Success)
            throw new InvalidOperationException($"La cerca Bluetooth s'ha aturat ({stoppedError}).");
        return devices.Values.Where(d => !string.IsNullOrWhiteSpace(d.Name) || d.Services.Length > 0)
            .Select(d => string.IsNullOrWhiteSpace(d.Name) ? d with { Name = $"Sensor {d.Address & 0xffff:X4}" } : d)
            .OrderBy(d => d.Name).ThenBy(d => d.ZwiftType).ToArray();
    }
}

internal sealed class SensorConnection : IDisposable
{
    private BluetoothLEDevice? device;
    private GattSession? session;
    private readonly List<GattDeviceService> services = [];
    private readonly List<GattCharacteristic> subscriptions = [];
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly Dictionary<byte, byte> buttonStates = [];
    private ushort? crankRevolutions, crankTime;
    private bool ready;
    private byte? zwiftType;
    public event Action? Changed;
    public event Action<int>? Shift;
    public SensorRole Role { get; }
    public string Status { get; private set; } = "Sense connexió";
    public string DeviceName { get; private set; } = "";
    public bool Connected => ready && device?.ConnectionStatus == BluetoothConnectionStatus.Connected;
    public bool HasSession => device is not null;
    public DateTime? LastPacket { get; private set; }
    public int? Power { get; private set; }
    public double? Cadence { get; private set; }
    public int? HeartRate { get; private set; }
    public int? Battery { get; private set; }
    public string Model { get; private set; } = "";
    public string Firmware { get; private set; } = "";
    public bool SupportsFtms { get; private set; }
    public TrainerControl? Control { get; private set; }
    public string ControlInfo { get; private set; } = "";

    public SensorConnection(SensorRole role) => Role = role;

    public async Task<object[]> InspectTrainerAsync()
    {
        var results = new List<object>();
        var service = services.FirstOrDefault(s => s.Uuid == BleIds.Ftms);
        if (service is null) return [];
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var chars = await service.GetCharacteristicsAsync(BluetoothCacheMode.Uncached).AsTask(timeout.Token);
        results.Add(new { status = chars.Status.ToString(), chars.ProtocolError });
        foreach (var c in chars.Characteristics)
        {
            string data = "", readStatus = "";
            if (c.CharacteristicProperties.HasFlag(GattCharacteristicProperties.Read))
            {
                var read = await c.ReadValueAsync(BluetoothCacheMode.Uncached).AsTask(timeout.Token);
                readStatus = read.Status + "/" + read.ProtocolError;
                if (read.Status == GattCommunicationStatus.Success) data = Convert.ToHexString(Bytes(read.Value));
            }
            results.Add(new { c.Uuid, properties = c.CharacteristicProperties.ToString(), readStatus, data });
        }
        return results.ToArray();
    }

    public async Task ConnectAsync(NearbyDevice selected, CancellationToken cancellationToken)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            DisconnectCore();
            Status = "Connectant…";
            DeviceName = selected.DisplayName;
            zwiftType = selected.ZwiftType;
            Changed?.Invoke();
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(25));
            var token = timeout.Token;
            device = await BluetoothLEDevice.FromBluetoothAddressAsync(selected.Address).AsTask(token)
                ?? throw new InvalidOperationException("El dispositiu no respon. Activa'l i torna-ho a provar.");
            device.ConnectionStatusChanged += OnConnectionChanged;
            session = await GattSession.FromDeviceIdAsync(device.BluetoothDeviceId).AsTask(token);
            if (session is not null) session.MaintainConnection = true;
            var result = await device.GetGattServicesAsync(BluetoothCacheMode.Uncached).AsTask(token);
            EnsureSuccess(result.Status);
            services.AddRange(result.Services);
            SupportsFtms = services.Any(s => s.Uuid == BleIds.Ftms);
            bool subscribed;
            if (Role == SensorRole.HeartRate)
                subscribed = await SubscribeAsync(BleIds.HeartRate, BleIds.Standard(0x2a37), token);
            else if (Role == SensorRole.Controller)
            {
                subscribed = await SubscribeAsync(BleIds.OpenBikeControl, BleIds.Buttons, token);
                if (!subscribed && selected.Name.Equals("Zwift Click", StringComparison.OrdinalIgnoreCase))
                    subscribed = await SubscribeZwiftClickAsync(token);
            }
            else
            {
                subscribed = await SubscribeAsync(BleIds.Ftms, BleIds.Standard(0x2ad2), token);
                if (!subscribed) subscribed = await SubscribeAsync(BleIds.Power, BleIds.Standard(0x2a63), token);
            }
            if (!subscribed)
                throw new InvalidOperationException(Role == SensorRole.Controller
                    ? "El servei de botons no està disponible. Si és un Click 2, prova el comandament dret."
                    : "No s'ha trobat el servei de dades esperat. Comprova el sensor seleccionat i tanca altres apps que l'utilitzin.");
            if (Role == SensorRole.Trainer && SupportsFtms)
            {
                try
                {
                    var features = await ReadAsync(0x1826, 0x2acc, token);
                    Control = await TrainerControl.CreateAsync(services.First(s => s.Uuid == BleIds.Ftms), features, token);
                    ControlInfo = Control is null ? "Control no disponible. Tanca altres apps d’entrenament i reconnecta el KICKR." : "Resistència FTMS disponible";
                }
                catch (Exception e) { ControlInfo = "Control no disponible: " + e.Message; }
            }
            ready = true;
            Status = "Connectat · esperant dades";
            Changed?.Invoke();
            // Device information is optional. Its failure must not tear down a working sensor.
            try
            {
                Model = await ReadTextAsync(0x180a, 0x2a24, token);
                Firmware = await ReadTextAsync(0x180a, 0x2a26, token);
                var batteryBytes = await ReadAsync(0x180f, 0x2a19, token);
                if (batteryBytes is { Length: > 0 } && batteryBytes[0] <= 100) Battery = batteryBytes[0];
            }
            catch (Exception) { /* Optional metadata may be unavailable or time out. */ }
            Changed?.Invoke();
        }
        catch (Exception e)
        {
            DisconnectCore();
            Status = e is OperationCanceledException ? "Temps d'espera esgotat. Torna a connectar." : e.Message;
            Changed?.Invoke();
            throw;
        }
        finally { gate.Release(); }
    }

    private static void EnsureSuccess(GattCommunicationStatus status)
    {
        if (status != GattCommunicationStatus.Success)
            throw new InvalidOperationException($"Bluetooth no ha completat la connexió ({status}). Comprova que el sensor estigui despert i disponible.");
    }

    private async Task<bool> SubscribeAsync(Guid serviceId, Guid characteristicId, CancellationToken token)
    {
        var service = services.FirstOrDefault(s => s.Uuid == serviceId);
        if (service is null) return false;
        var result = await service.GetCharacteristicsForUuidAsync(characteristicId, BluetoothCacheMode.Uncached).AsTask(token);
        if (result.Status != GattCommunicationStatus.Success || result.Characteristics.Count == 0) return false;
        var characteristic = result.Characteristics[0];
        var cccd = characteristic.CharacteristicProperties.HasFlag(GattCharacteristicProperties.Notify)
            ? GattClientCharacteristicConfigurationDescriptorValue.Notify
            : GattClientCharacteristicConfigurationDescriptorValue.Indicate;
        subscriptions.Add(characteristic);
        characteristic.ValueChanged += OnValueChanged;
        EnsureSuccess(await characteristic.WriteClientCharacteristicConfigurationDescriptorAsync(cccd).AsTask(token));
        return true;
    }

    private async Task<byte[]> ReadAsync(int serviceId, int characteristicId, CancellationToken token)
    {
        var service = services.FirstOrDefault(s => s.Uuid == BleIds.Standard(serviceId));
        if (service is null) return [];
        var characteristics = await service.GetCharacteristicsForUuidAsync(BleIds.Standard(characteristicId), BluetoothCacheMode.Uncached).AsTask(token);
        if (characteristics.Status != GattCommunicationStatus.Success || characteristics.Characteristics.Count == 0) return [];
        var result = await characteristics.Characteristics[0].ReadValueAsync(BluetoothCacheMode.Uncached).AsTask(token);
        return result.Status == GattCommunicationStatus.Success ? Bytes(result.Value) : [];
    }

    private async Task<bool> SubscribeZwiftClickAsync(CancellationToken token)
    {
        // Legacy Click uses the public RideOn handshake and 0x37 button notifications.
        // Click 2 right uses the 02 03 handshake extension and active-low 0x23 messages.
        var service = services.FirstOrDefault(s => s.Uuid == BleIds.ZwiftV2) ?? services.FirstOrDefault(s => s.Uuid == BleIds.Zwift);
        if (service is null) return false;
        if (!await SubscribeAsync(service.Uuid, BleIds.ZwiftNotifications, token)) return false;
        if (!await SubscribeAsync(service.Uuid, BleIds.ZwiftReply, token)) return false;
        var result = await service.GetCharacteristicsForUuidAsync(BleIds.ZwiftWrite).AsTask(token);
        if (result.Status != GattCommunicationStatus.Success || result.Characteristics.Count == 0) return false;
        using var writer = new DataWriter();
        byte[] handshake = System.Text.Encoding.ASCII.GetBytes("RideOn");
        if (zwiftType is 10 or 11) handshake = [..handshake, 2, 3];
        writer.WriteBytes(handshake);
        var characteristic = result.Characteristics[0];
        var option = characteristic.CharacteristicProperties.HasFlag(GattCharacteristicProperties.WriteWithoutResponse)
            ? GattWriteOption.WriteWithoutResponse : GattWriteOption.WriteWithResponse;
        EnsureSuccess(await characteristic.WriteValueAsync(writer.DetachBuffer(), option).AsTask(token));
        return true;
    }

    private async Task<string> ReadTextAsync(int serviceId, int characteristicId, CancellationToken token) =>
        System.Text.Encoding.UTF8.GetString(await ReadAsync(serviceId, characteristicId, token)).TrimEnd('\0');

    private static byte[] Bytes(IBuffer buffer)
    {
        using var reader = DataReader.FromBuffer(buffer);
        var data = new byte[buffer.Length];
        reader.ReadBytes(data);
        return data;
    }

    private void OnValueChanged(GattCharacteristic sender, GattValueChangedEventArgs args)
    {
        try
        {
            var bytes = Bytes(args.CharacteristicValue);
            if (sender.Uuid == BleIds.Standard(0x2a37)) HeartRate = Packets.ReadHeartRate(bytes);
            else if (sender.Uuid == BleIds.Standard(0x2ad2))
            {
                var data = Packets.ReadIndoorBike(bytes);
                if (data.Power.HasValue) Power = data.Power;
                if (data.Cadence.HasValue) Cadence = data.Cadence;
            }
            else if (sender.Uuid == BleIds.Standard(0x2a63))
            {
                var data = Packets.ReadCyclingPower(bytes);
                Power = data.Power;
                if (data.Revolutions.HasValue && data.Time.HasValue)
                {
                    if (crankRevolutions.HasValue && crankTime.HasValue)
                    {
                        var delta = unchecked((ushort)(data.Time.Value - crankTime.Value));
                        var revolutions = unchecked((ushort)(data.Revolutions.Value - crankRevolutions.Value));
                        if (delta > 0) Cadence = revolutions * 60.0 * 1024 / delta;
                        else if (revolutions == 0) Cadence = 0;
                    }
                    crankRevolutions = data.Revolutions;
                    crankTime = data.Time;
                }
            }
            else if (sender.Uuid == BleIds.Buttons || sender.Uuid == BleIds.ZwiftNotifications || sender.Uuid == BleIds.ZwiftReply)
            {
                if (sender.Uuid != BleIds.Buttons && (bytes.Length == 0 || (bytes[0] != 0x37 && bytes[0] != 0x23))) return;
                var states = sender.Uuid == BleIds.Buttons ? Packets.ReadButtons(bytes)
                    : bytes[0] == 0x37 ? Packets.ReadZwiftClick(bytes) : Packets.ReadZwiftClick2(bytes, zwiftType == 10);
                foreach (var (button, state) in states)
                {
                    buttonStates.TryGetValue(button, out var previous);
                    buttonStates[button] = state;
                    if (state != 0 && previous == 0 && (button == 1 || button == 2)) Shift?.Invoke(button == 1 ? 1 : -1);
                }
            }
            LastPacket = DateTime.UtcNow;
            Status = "Connectat · dades en directe";
            Changed?.Invoke();
        }
        catch (InvalidDataException) { /* Ignore a truncated radio packet, retaining the last valid sample. */ }
    }

    private void OnConnectionChanged(BluetoothLEDevice sender, object args)
    {
        if (sender != device) return;
        if (sender.ConnectionStatus == BluetoothConnectionStatus.Disconnected)
        {
            Control?.ConnectionLost();
            ClearData();
            Status = "Connexió perduda · intentant recuperar";
        }
        else if (ready) Status = "Connectat · esperant dades";
        Changed?.Invoke();
    }

    public async Task DisconnectAsync()
    {
        await gate.WaitAsync();
        try
        {
            try { if (Control is not null) await Control.StopAsync(); } catch (Exception) { }
            DisconnectCore(); Status = "Sense connexió"; Changed?.Invoke();
        }
        finally { gate.Release(); }
    }

    private void ClearData()
    {
        Power = null; Cadence = null; HeartRate = null; LastPacket = null;
        crankRevolutions = null; crankTime = null; buttonStates.Clear();
    }

    private void DisconnectCore()
    {
        ready = false;
        Control?.Dispose(); Control = null; ControlInfo = "";
        foreach (var characteristic in subscriptions) characteristic.ValueChanged -= OnValueChanged;
        subscriptions.Clear();
        if (device is not null) device.ConnectionStatusChanged -= OnConnectionChanged;
        if (session is not null) { session.MaintainConnection = false; session.Dispose(); session = null; }
        foreach (var service in services) service.Dispose();
        services.Clear();
        device?.Dispose(); device = null;
        ClearData(); Battery = null; SupportsFtms = false; Model = ""; Firmware = "";
    }

    public void Dispose() => DisconnectCore();
}
