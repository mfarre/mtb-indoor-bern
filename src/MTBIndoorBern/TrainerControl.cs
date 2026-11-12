using System.Buffers.Binary;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Storage.Streams;

namespace MTBIndoorBern;

// FTMS 1.0: one outstanding Control Point procedure, completed by an indication.
internal sealed class TrainerControl : IDisposable
{
    private readonly GattCharacteristic point;
    private GattCharacteristic? machineStatus;
    private readonly SemaphoreSlim commands = new(1, 1);
    private TaskCompletionSource<byte>? pending;
    private byte pendingOpcode;
    private bool disposed;
    public bool IsControlling { get; private set; }
    public double AppliedGrade { get; private set; }
    public int AppliedPower { get; private set; }
    public bool SupportsPower => (TargetFeatures & (1 << 3)) != 0;
    private bool powerMode;
    public uint TargetFeatures { get; }
    public string Status { get; private set; } = "Control disponible";
    public event Action<string>? Trace;

    private TrainerControl(GattCharacteristic point, uint features)
    {
        this.point = point;
        TargetFeatures = features;
        point.ValueChanged += OnReply;
    }

    public static async Task<TrainerControl?> CreateAsync(GattDeviceService service, byte[] features, CancellationToken token)
    {
        if (features.Length < 8) return null;
        uint targets = BinaryPrimitives.ReadUInt32LittleEndian(features.AsSpan(4));
        if ((targets & (1 << 13)) == 0) return null;
        var result = await service.GetCharacteristicsForUuidAsync(BleIds.Standard(0x2ad9), BluetoothCacheMode.Uncached).AsTask(token);
        if (result.Status != GattCommunicationStatus.Success || result.Characteristics.Count == 0) return null;
        var characteristic = result.Characteristics[0];
        if (!characteristic.CharacteristicProperties.HasFlag(GattCharacteristicProperties.Indicate)) return null;
        var control = new TrainerControl(characteristic, targets);
        var status = await characteristic.WriteClientCharacteristicConfigurationDescriptorAsync(GattClientCharacteristicConfigurationDescriptorValue.Indicate).AsTask(token);
        if (status != GattCommunicationStatus.Success) { control.Dispose(); return null; }
        var statusResult = await service.GetCharacteristicsForUuidAsync(BleIds.Standard(0x2ada), BluetoothCacheMode.Uncached).AsTask(token);
        if (statusResult.Status == GattCommunicationStatus.Success && statusResult.Characteristics.Count > 0)
        {
            control.machineStatus = statusResult.Characteristics[0];
            control.machineStatus.ValueChanged += control.OnMachineStatus;
            await control.machineStatus.WriteClientCharacteristicConfigurationDescriptorAsync(GattClientCharacteristicConfigurationDescriptorValue.Notify).AsTask(token);
        }
        return control;
    }

    private void OnMachineStatus(GattCharacteristic sender, GattValueChangedEventArgs args)
    {
        using var reader = DataReader.FromBuffer(args.CharacteristicValue);
        if (reader.UnconsumedBufferLength > 0 && reader.ReadByte() == 0xff) ConnectionLost();
    }

    private void OnReply(GattCharacteristic sender, GattValueChangedEventArgs args)
    {
        using var reader = DataReader.FromBuffer(args.CharacteristicValue);
        var bytes = new byte[args.CharacteristicValue.Length];
        reader.ReadBytes(bytes);
        if (bytes.Length >= 3 && bytes[0] == 0x80 && bytes[1] == pendingOpcode)
            pending?.TrySetResult(bytes[2]);
    }

    private async Task SendAsync(byte[] data, CancellationToken token)
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        var completion = new TaskCompletionSource<byte>(TaskCreationOptions.RunContinuationsAsynchronously);
        pendingOpcode = data[0];
        pending = completion;
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
            timeout.CancelAfter(TimeSpan.FromSeconds(4));
            using var writer = new DataWriter();
            writer.WriteBytes(data);
            var status = await point.WriteValueAsync(writer.DetachBuffer(), GattWriteOption.WriteWithResponse).AsTask(timeout.Token);
            if (status != GattCommunicationStatus.Success) throw new IOException($"KICKR: escriptura {status}.");
            byte response = await completion.Task.WaitAsync(timeout.Token);
            Trace?.Invoke($"FTMS {Convert.ToHexString(data)} → {response}");
            if (response != 1) throw new IOException(response switch
            {
                2 => "El KICKR no admet aquesta ordre de resistència.",
                3 => "El KICKR ha rebutjat el valor de resistència.",
                5 => "Control del KICKR denegat. Tanca les altres apps d’entrenament i torna a iniciar.",
                _ => $"El KICKR no ha completat l’ordre ({response})."
            });
        }
        finally { pending = null; }
    }

    public static byte[] SimulationPacket(double grade)
    {
        if (!double.IsFinite(grade)) throw new ArgumentOutOfRangeException(nameof(grade));
        byte[] packet = [0x11, 0, 0, 0, 0, 40, 51]; // no wind, Crr .004, Cw .51 kg/m
        BinaryPrimitives.WriteInt16LittleEndian(packet.AsSpan(3), (short)Math.Round(Math.Clamp(grade, -3, 8) * 100));
        return packet;
    }

    public async Task StartAsync(CancellationToken token,bool usePowerMode=false)
    {
        await commands.WaitAsync(token);
        try
        {
            await SendAsync([0x00], token);
            IsControlling = true;
            await SendAsync([0x07], token);
            powerMode=usePowerMode;
            if(powerMode&&!SupportsPower)throw new IOException("El rodillo no admet el control de càrrega MTB.");
            await SendAsync(powerMode?PowerPacket(0):SimulationPacket(0), token);
            AppliedGrade = 0;
            AppliedPower = 0;
            Status = "Control actiu · confirmat pel KICKR";
        }
        catch { Status = "No s’ha pogut iniciar el control"; throw; }
        finally { commands.Release(); }
    }

    public async Task SetGradeAsync(double grade, CancellationToken token)
    {
        await commands.WaitAsync(token);
        try
        {
            if (!IsControlling) throw new IOException("El KICKR ha perdut el control. Torna a iniciar la ruta.");
            var packet = SimulationPacket(grade);
            await SendAsync(packet, token);
            AppliedGrade = BinaryPrimitives.ReadInt16LittleEndian(packet.AsSpan(3)) / 100.0;
            Status = "Control actiu · confirmat pel KICKR";
        }
        finally { commands.Release(); }
    }

    public static byte[] PowerPacket(int watts)
    {
        byte[] packet=[0x05,0,0];BinaryPrimitives.WriteInt16LittleEndian(packet.AsSpan(1),(short)Math.Clamp(watts,0,600));return packet;
    }
    public async Task SetPowerAsync(int watts,CancellationToken token)
    {
        await commands.WaitAsync(token);
        try
        {
            if(!IsControlling||!SupportsPower)throw new IOException("Control MTB del KICKR no disponible.");
            await SendAsync(PowerPacket(watts),token);AppliedPower=Math.Clamp(watts,0,600);powerMode=true;
            Status="Càrrega MTB confirmada pel KICKR";
        }
        finally{commands.Release();}
    }

    public async Task StopAsync()
    {
        await commands.WaitAsync();
        try
        {
            if (disposed || !IsControlling) return;
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(9));
            Exception? failure = null;
            if(powerMode){try{await SendAsync(PowerPacket(0),timeout.Token);AppliedPower=0;}catch(Exception e){failure=e;}}
            try { await SendAsync(SimulationPacket(0), timeout.Token); AppliedGrade = 0; }
            catch (Exception e) { failure = e; }
            try { await SendAsync([0x08, 0x01], timeout.Token); }
            catch (Exception e) { failure ??= e; }
            IsControlling = false;
            Status = failure is null ? "Aturat · pendent 0% confirmat" : "Aturada sense confirmació del KICKR";
            if (failure is not null) throw new IOException(Status, failure);
        }
        finally { commands.Release(); }
    }

    public void ConnectionLost()
    {
        IsControlling = false;
        Status = "Control interromput · torna a iniciar";
        pending?.TrySetException(new IOException("Connexió del KICKR perduda."));
    }

    public void Dispose()
    {
        disposed = true;
        ConnectionLost();
        point.ValueChanged -= OnReply;
        if (machineStatus is not null) machineStatus.ValueChanged -= OnMachineStatus;
    }
}
