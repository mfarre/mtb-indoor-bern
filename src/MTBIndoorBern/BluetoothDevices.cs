using System.Collections.Concurrent;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.Advertisement;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Storage.Streams;

namespace MTBIndoorBern;

// Keep Controller's serialized value for existing saved right-hand controllers.
internal enum SensorRole { Trainer, HeartRate, Controller, LeftController }

internal static class SensorRoles
{
    public static bool IsController(this SensorRole role) => role is SensorRole.Controller or SensorRole.LeftController;
}

internal sealed record NearbyDevice(ulong Address, string Name, short Rssi, Guid[] Services, byte? ZwiftType = null)
{
    public string DisplayName => ZwiftType switch { 10 => "Zwift Click 2 · right", 11 => "Zwift Click 2 · left", 9 => "Zwift Click 1", _ => Name };
    public bool IsZwift => ZwiftType is 9 or 10 or 11 || Services.Contains(BleIds.Zwift) || Services.Contains(BleIds.ZwiftV2) || Name.Contains("Zwift", StringComparison.OrdinalIgnoreCase);
    public override string ToString() => Rssi==0?$"{DisplayName}   ·   saved":$"{DisplayName}   ·   {Rssi} dBm";
    public bool Matches(SensorRole role) => role switch
    {
        SensorRole.Trainer => Services.Contains(BleIds.Ftms) || Services.Contains(BleIds.Power) || Name.Contains("KICKR", StringComparison.OrdinalIgnoreCase),
        SensorRole.HeartRate => Services.Contains(BleIds.HeartRate) || Name.Contains("HRM", StringComparison.OrdinalIgnoreCase) || Name.Contains("TICKR", StringComparison.OrdinalIgnoreCase) || Name.Contains("Polar", StringComparison.OrdinalIgnoreCase),
        SensorRole.LeftController => ZwiftType == 11,
        _ => ZwiftType != 11 && (IsZwift || Services.Contains(BleIds.OpenBikeControl) || Name.Contains("Click", StringComparison.OrdinalIgnoreCase) || Name.Contains("BikeControl", StringComparison.OrdinalIgnoreCase))
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
            throw new InvalidOperationException("Windows cannot find an available Bluetooth LE adapter.");
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
            throw new InvalidOperationException($"Bluetooth scanning stopped ({stoppedError}).");
        return devices.Values.Where(d => !string.IsNullOrWhiteSpace(d.Name) || d.Services.Length > 0 || d.ZwiftType is 9 or 10 or 11)
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
    private readonly object inputLock = new();
    private readonly Dictionary<byte, byte> buttonStates = [];
    private readonly SensorHealth health;
    private CancellationTokenSource? controllerLifetime;
    private int generation;
    private bool linkLost;
    private ushort? crankRevolutions, crankTime;
    private byte? zwiftType;
    public event Action? Changed;
    public event Action<int>? Shift;
    public event Action<string>? ControllerPacket;
    public bool BrakePressed { get; private set; }
    public SensorRole Role { get; }
    public string Status { get; private set; } = "Disconnected";
    public string DeviceName { get; private set; } = "";
    public bool Connected => health.IsConnected(device?.ConnectionStatus == BluetoothConnectionStatus.Connected);
    public bool InputConfirmed => Connected && LastPacket.HasValue;
    public bool ActivationRequired { get; private set; }
    public string DataState => ActivationRequired && !InputConfirmed ? "waiting" : health.DataState(Connected, DateTime.UtcNow);
    public bool NeedsRefresh => health.NeedsRefresh(Connected, DateTime.UtcNow);
    public DateTime? LastHeartRatePacket { get; private set; }
    public bool HeartRateFresh => Connected && HeartRate is > 0 && SensorHealth.IsFresh(LastHeartRatePacket, DateTime.UtcNow);
    public bool HasSession => device is not null;
    public DateTime? LastPacket { get; private set; }
    public DateTime? LastPowerPacket { get; private set; }
    public DateTime? LastCadencePacket { get; private set; }
    public int? Power { get; private set; }
    public double? Cadence { get; private set; }
    public int? HeartRate { get; private set; }
    public int? Battery { get; private set; }
    public string Model { get; private set; } = "";
    public string Firmware { get; private set; } = "";
    public bool SupportsFtms { get; private set; }
    public TrainerControl? Control { get; private set; }
    public string ControlInfo { get; private set; } = "";

    public SensorConnection(SensorRole role) { Role = role; health = new(role); }

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
            linkLost = false;
            Status = "Connecting…";
            DeviceName = selected.DisplayName;
            zwiftType = selected.ZwiftType;
            Changed?.Invoke();
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(25));
            var token = timeout.Token;
            device = await BluetoothLEDevice.FromBluetoothAddressAsync(selected.Address).AsTask(token)
                ?? throw new InvalidOperationException("The device is not responding. Wake it up and try again.");
            device.ConnectionStatusChanged += OnConnectionChanged;
            session = await GattSession.FromDeviceIdAsync(device.BluetoothDeviceId).AsTask(token);
            if (session is not null) session.MaintainConnection = true;
            bool subscribed = await DiscoverAndSubscribeAsync(token);
            if (!subscribed)
                throw new InvalidOperationException(Role.IsController()
                    ? "The button service is unavailable. Wake the Click and close other apps using it."
                    : "The expected data service was not found. Check the selected sensor and close other apps using it.");
            if (Role == SensorRole.Trainer && SupportsFtms)
            {
                try
                {
                    var features = await ReadAsync(0x1826, 0x2acc, token);
                    Control = await TrainerControl.CreateAsync(services.First(s => s.Uuid == BleIds.Ftms), features, token);
                    ControlInfo = Control is null ? "Control unavailable. Close other training apps and reconnect the KICKR." : "FTMS resistance available";
                }
                catch (Exception e) { ControlInfo = "Control unavailable: " + e.Message; }
            }
            lock (inputLock)
            {
                if (linkLost || device.ConnectionStatus != BluetoothConnectionStatus.Connected)
                    throw new InvalidOperationException("Connection lost during setup. Retrying automatically.");
                health.SubscriptionsReady(DateTime.UtcNow);
            }
            Status = LastPacket.HasValue ? "Connected · live data" : "Connected · waiting for data";
            if (controllerWrite is not null && zwiftType is 10 or 11)
            {
                controllerLifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                _ = KeepControllerAliveAsync(controllerWrite, generation, controllerLifetime.Token);
            }
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
            Status = e is OperationCanceledException ? "Connection timed out. Reconnect to try again." : e.Message;
            Changed?.Invoke();
            throw;
        }
        finally { gate.Release(); }
    }

    private static void EnsureSuccess(GattCommunicationStatus status)
    {
        if (status != GattCommunicationStatus.Success)
            throw new InvalidOperationException($"Bluetooth could not complete the connection ({status}). Check that the sensor is awake and available.");
    }

    private async Task<bool> DiscoverAndSubscribeAsync(CancellationToken token)
    {
        // WinRT may return an incomplete service/characteristic list just after connect.
        for (int attempt = 0; attempt < 3; attempt++)
        {
            ClearSubscriptions();
            lock (inputLock) { health.Invalidate(); ClearData(); }
            foreach (var old in services) old.Dispose();
            services.Clear();
            var result = await device!.GetGattServicesAsync(BluetoothCacheMode.Uncached).AsTask(token);
            EnsureSuccess(result.Status);
            services.AddRange(result.Services);
            SupportsFtms = services.Any(s => s.Uuid == BleIds.Ftms);
            bool subscribed;
            if (Role == SensorRole.HeartRate)
                subscribed = await SubscribeAsync(BleIds.HeartRate, BleIds.Standard(0x2a37), token);
            else if (Role.IsController())
                subscribed = await SubscribeAsync(BleIds.OpenBikeControl, BleIds.Buttons, token) || await SubscribeZwiftClickAsync(token);
            else
                subscribed = await SubscribeAsync(BleIds.Ftms, BleIds.Standard(0x2ad2), token) || await SubscribeAsync(BleIds.Power, BleIds.Standard(0x2a63), token);
            if (subscribed) return true;
            if (attempt < 2) await Task.Delay(750, token);
        }
        return false;
    }

    private async Task<bool> SubscribeAsync(Guid serviceId, Guid characteristicId, CancellationToken token)
    {
        var service = services.FirstOrDefault(s => s.Uuid == serviceId);
        if (service is null) return false;
        var result = await service.GetCharacteristicsForUuidAsync(characteristicId, BluetoothCacheMode.Uncached).AsTask(token);
        if (result.Status != GattCommunicationStatus.Success || result.Characteristics.Count == 0) return false;
        var characteristic = result.Characteristics[0];
        if (!characteristic.CharacteristicProperties.HasFlag(GattCharacteristicProperties.Notify) &&
            !characteristic.CharacteristicProperties.HasFlag(GattCharacteristicProperties.Indicate)) return false;
        var cccd = characteristic.CharacteristicProperties.HasFlag(GattCharacteristicProperties.Notify)
            ? GattClientCharacteristicConfigurationDescriptorValue.Notify
            : GattClientCharacteristicConfigurationDescriptorValue.Indicate;
        lock (inputLock)
        {
            subscriptions.Add(characteristic);
            characteristic.ValueChanged += OnValueChanged;
        }
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

    private GattCharacteristic? controllerWrite;
    private async Task<bool> SubscribeZwiftClickAsync(CancellationToken token)
    {
        // Legacy Click uses the public RideOn handshake and 0x37 button notifications.
        // Both Click 2 sides use 02 03 and active-low 0x23 messages. Firmware-specific
        // left-pod activation is separate: transport connectivity does not prove input.
        var service = services.FirstOrDefault(s => s.Uuid == BleIds.ZwiftV2) ?? services.FirstOrDefault(s => s.Uuid == BleIds.Zwift);
        if (service is null) return false;
        if (!await SubscribeAsync(service.Uuid, BleIds.ZwiftNotifications, token)) return false;
        if (!await SubscribeAsync(service.Uuid, BleIds.ZwiftReply, token)) return false;
        var result = await service.GetCharacteristicsForUuidAsync(BleIds.ZwiftWrite).AsTask(token);
        if (result.Status != GattCommunicationStatus.Success || result.Characteristics.Count == 0) return false;
        byte[] handshake = System.Text.Encoding.ASCII.GetBytes("RideOn");
        if (!zwiftType.HasValue && service.Uuid == BleIds.ZwiftV2)
            zwiftType = Role == SensorRole.LeftController ? (byte)11 : (byte)10;
        if (zwiftType is 10 or 11) handshake = [..handshake, 2, 3];
        controllerWrite = result.Characteristics[0];
        await WriteControllerAsync(controllerWrite, handshake, token);
        if (zwiftType is 10 or 11)
        {
            // Public Click V2 activation sequence; no account token or unlock bypass.
            await Task.Delay(100, token);
            await WriteControllerAsync(controllerWrite, [0x00, 0x08, 0x00], token);
            await Task.Delay(100, token);
            await WriteControllerAsync(controllerWrite, [0x00, 0x08, 0x10], token);
        }
        return true;
    }

    private static async Task WriteControllerAsync(GattCharacteristic characteristic, byte[] data, CancellationToken token)
    {
        using var writer = new DataWriter();
        writer.WriteBytes(data);
        var option = characteristic.CharacteristicProperties.HasFlag(GattCharacteristicProperties.WriteWithoutResponse)
            ? GattWriteOption.WriteWithoutResponse : GattWriteOption.WriteWithResponse;
        EnsureSuccess(await characteristic.WriteValueAsync(writer.DetachBuffer(), option).AsTask(token));
    }

    private async Task KeepControllerAliveAsync(GattCharacteristic characteristic, int currentGeneration, CancellationToken token)
    {
        try
        {
            while (!token.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromSeconds(3), token);
                if (currentGeneration != generation || !Connected) return;
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
                timeout.CancelAfter(TimeSpan.FromSeconds(5));
                await WriteControllerAsync(characteristic, System.Text.Encoding.ASCII.GetBytes("RideOn"), timeout.Token);
            }
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { }
        catch (Exception)
        {
            if (!token.IsCancellationRequested && InvalidateConnection("Controller link lost · reconnecting", expectedGeneration: currentGeneration))
                Changed?.Invoke();
        }
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
            lock (inputLock)
            {
            // WinRT may deliver a queued notification after we retired its session.
            if (linkLost || !subscriptions.Contains(sender)) return;
            var bytes = Bytes(args.CharacteristicValue);
            if (sender.Uuid == BleIds.Standard(0x2a37))
            {
                int bpm = Packets.ReadHeartRate(bytes);
                if (bpm <= 0) return; // A battery read or zero bpm is not a heart-rate sample.
                HeartRate = bpm; LastHeartRatePacket = DateTime.UtcNow;
            }
            else if (sender.Uuid == BleIds.Standard(0x2ad2))
            {
                var data = Packets.ReadIndoorBike(bytes);
                if (data.Power.HasValue) { Power = data.Power; LastPowerPacket=DateTime.UtcNow; }
                if (data.Cadence.HasValue) { Cadence = data.Cadence; LastCadencePacket=DateTime.UtcNow; }
            }
            else if (sender.Uuid == BleIds.Standard(0x2a63))
            {
                var data = Packets.ReadCyclingPower(bytes);
                Power = data.Power; LastPowerPacket=DateTime.UtcNow;
                if (data.Revolutions.HasValue && data.Time.HasValue)
                {
                    if (crankRevolutions.HasValue && crankTime.HasValue)
                    {
                        var delta = unchecked((ushort)(data.Time.Value - crankTime.Value));
                        var revolutions = unchecked((ushort)(data.Revolutions.Value - crankRevolutions.Value));
                        if (delta > 0) Cadence = revolutions * 60.0 * 1024 / delta;
                        else if (revolutions == 0) Cadence = 0;
                        LastCadencePacket=DateTime.UtcNow;
                    }
                    crankRevolutions = data.Revolutions;
                    crankTime = data.Time;
                }
            }
            else if (sender.Uuid == BleIds.Buttons || sender.Uuid == BleIds.ZwiftNotifications || sender.Uuid == BleIds.ZwiftReply)
            {
                if (Role == SensorRole.LeftController && bytes.Length >= 2 && bytes[0] == 0xff && bytes[1] == 0x03)
                {
                    ActivationRequired = true;
                    Status = "Left Click requests Zwift activation · input not confirmed";
                    Changed?.Invoke();
                    return;
                }
                if (sender.Uuid != BleIds.Buttons && (bytes.Length == 0 || (bytes[0] != 0x37 && bytes[0] != 0x23))) return;
                var states = (sender.Uuid == BleIds.Buttons ? Packets.ReadButtons(bytes)
                    : bytes[0] == 0x37 ? Packets.ReadZwiftClick(bytes) : Packets.ReadZwiftClick2(bytes, Role != SensorRole.LeftController)).ToArray();
                if (states.Length == 0) return;
                ControllerPacket?.Invoke(Convert.ToHexString(bytes));
                foreach (var (button, state) in states)
                {
                    buttonStates.TryGetValue(button, out var previous);
                    buttonStates[button] = state;
                    if (button == 3) BrakePressed = state != 0;
                    if (health.Subscribed && state != 0 && previous == 0 && (button == 1 || button == 2)) Shift?.Invoke(button == 1 ? 1 : -1);
                }
                ActivationRequired = false;
            }
            else return;
            LastPacket = DateTime.UtcNow;
            health.Measurement(LastPacket.Value);
            Status = "Connected · live data";
            }
            Changed?.Invoke();
        }
        catch (InvalidDataException) { /* Ignore a truncated radio packet, retaining the last valid sample. */ }
    }

    private void OnConnectionChanged(BluetoothLEDevice sender, object args)
    {
        lock (inputLock)
        {
            if (sender != device) return;
            if (sender.ConnectionStatus == BluetoothConnectionStatus.Disconnected)
                InvalidateConnection("Connection lost · reconnecting", expectedDevice: sender);
        }
        // A Windows transport reconnect must never resurrect old subscriptions.
        Changed?.Invoke();
    }

    private bool InvalidateConnection(string reason, BluetoothLEDevice? expectedDevice = null, int? expectedGeneration = null)
    {
        lock (inputLock)
        {
            // Check identity while holding the same lock as invalidation: an old
            // callback/failed keepalive must not tear down a replacement session.
            if (expectedDevice is not null && expectedDevice != device || expectedGeneration.HasValue && expectedGeneration != generation) return false;
            linkLost = true;
            health.Invalidate();
            controllerLifetime?.Cancel();
            Control?.ConnectionLost();
            ClearData();
            Status = reason;
            if (session is not null) { try { session.MaintainConnection = false; } catch (Exception) { } }
            return true;
        }
    }

    public async Task DisconnectAsync()
    {
        await gate.WaitAsync();
        try
        {
            try { if (Control is not null) await Control.StopAsync(); } catch (Exception) { }
            DisconnectCore(); Status = "Disconnected"; Changed?.Invoke();
        }
        finally { gate.Release(); }
    }

    private void ClearData()
    {
        Power = null; Cadence = null; HeartRate = null; LastPacket = LastPowerPacket = LastCadencePacket = LastHeartRatePacket = null;
        crankRevolutions = null; crankTime = null; buttonStates.Clear(); BrakePressed = false;
    }

    private void DisconnectCore()
    {
        lock (inputLock)
        {
        generation++;
        linkLost = true;
        health.Invalidate();
        controllerLifetime?.Cancel(); controllerLifetime?.Dispose(); controllerLifetime = null;
        Control?.Dispose(); Control = null; ControlInfo = "";
        ClearSubscriptions();
        if (device is not null) device.ConnectionStatusChanged -= OnConnectionChanged;
        if (session is not null)
        {
            try { session.MaintainConnection = false; } catch (Exception) { }
            try { session.Dispose(); } catch (Exception) { }
            session = null;
        }
        foreach (var service in services) { try { service.Dispose(); } catch (Exception) { } }
        services.Clear();
        try { device?.Dispose(); } catch (Exception) { }
        device = null;
        ClearData(); Battery = null; SupportsFtms = false; Model = ""; Firmware = ""; ActivationRequired = false;
        }
    }

    private void ClearSubscriptions()
    {
        lock (inputLock)
        {
            foreach (var characteristic in subscriptions) characteristic.ValueChanged -= OnValueChanged;
            subscriptions.Clear();
            controllerWrite = null;
        }
    }

    public void Dispose() => DisconnectCore();
}
