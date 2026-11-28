using System.Buffers.Binary;

namespace MTBIndoorBern;

internal sealed record BrakeEncoderReading(int Raw, int Status, int Agc);
internal sealed record BrakeFrame(int Version, int Flags, ushort Sequence, uint Uptime, BrakeEncoderReading Left, BrakeEncoderReading Right);
internal sealed record BrakeMagneticState(bool Healthy, bool Usable, string Status);

internal static class BrakeProtocol
{
    public const int Version = 1;
    public const int FrameLength = 20;
    public const int StaleMilliseconds = 750;
    public static readonly Guid Service = new("7d9f0001-6f5b-4ad7-9f2a-6a52b5b3a001");
    public static readonly Guid Telemetry = new("7d9f0002-6f5b-4ad7-9f2a-6a52b5b3a001");

    public static BrakeFrame Decode(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length != FrameLength) throw new InvalidDataException("Brake telemetry must contain exactly 20 bytes.");
        if (bytes[0] != Version) throw new InvalidDataException("Unsupported brake protocol version.");
        if ((bytes[1] & 0xf8) != 0 || BinaryPrimitives.ReadUInt32LittleEndian(bytes[16..]) != 0)
            throw new InvalidDataException("Unsupported brake flags or reserved data.");
        return new(bytes[0], bytes[1], BinaryPrimitives.ReadUInt16LittleEndian(bytes[2..]), BinaryPrimitives.ReadUInt32LittleEndian(bytes[4..]),
            new(BinaryPrimitives.ReadUInt16LittleEndian(bytes[8..]), bytes[12], bytes[14]),
            new(BinaryPrimitives.ReadUInt16LittleEndian(bytes[10..]), bytes[13], bytes[15]));
    }

    public static BrakeMagneticState ChannelState(BrakeFrame frame, bool left)
    {
        var value = left ? frame.Left : frame.Right;
        if ((frame.Flags & 1) == 0) return new(false, false, "Multiplexer not responding");
        if ((frame.Flags & (left ? 2 : 4)) == 0 || !BrakeEndpoints.ValidRaw(value.Raw) || value.Status == 255 || value.Agc is < 0 or > 128)
            return new(false, false, "Encoder read failed");
        if ((value.Status & ~0x38) != 0 || (value.Status & 0x18) == 0x18)
            return new(false, false, "Invalid magnetic status");
        if ((value.Status & 0x20) == 0) return new(false, false, "Magnet not detected");
        if ((value.Status & 0x10) != 0) return new(false, true, "Magnetic field too weak · provisional");
        if ((value.Status & 0x08) != 0) return new(false, true, "Magnetic field too strong · provisional");
        return new(true, true, "Magnetic field healthy");
    }
}

// Ports the bench's ordering contract. Receiving a duplicate/out-of-order frame
// never renews freshness; both counters are needed because they wrap separately.
internal sealed class BrakeFrameClock
{
    private BrakeFrame? last;
    public long? ReceivedMilliseconds { get; private set; }
    public void Reset() { last = null; ReceivedMilliseconds = null; }
    public void InvalidateFreshness() => ReceivedMilliseconds = null;
    public bool Accept(BrakeFrame frame, long nowMilliseconds, out bool restarted)
    {
        restarted = false;
        if (last is not null)
        {
            int advance = unchecked((ushort)(frame.Sequence - last.Sequence));
            uint timeAdvance = unchecked(frame.Uptime - last.Uptime);
            restarted = timeAdvance > int.MaxValue && frame.Uptime < 1000 && frame.Sequence < 40 && last.Uptime > 2000;
            if (!restarted && advance == 0 && timeAdvance == 0) return false;
            if (!restarted && timeAdvance > int.MaxValue) return false;
            if (!restarted && timeAdvance < (advance == 0 ? 65536 : advance)) return false;
        }
        last = frame; ReceivedMilliseconds = nowMilliseconds; return true;
    }
    public bool Fresh(long nowMilliseconds) => ReceivedMilliseconds is { } last && nowMilliseconds - last is >= 0 and < BrakeProtocol.StaleMilliseconds;
}
