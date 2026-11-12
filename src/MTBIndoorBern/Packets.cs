using System.Buffers.Binary;

namespace MTBIndoorBern;

internal static class Packets
{
    private static ushort U16(byte[] bytes, int offset)
    {
        if (offset + 2 > bytes.Length) throw new InvalidDataException("Paquet Bluetooth incomplet.");
        return BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(offset, 2));
    }

    public static int ReadHeartRate(byte[] bytes)
    {
        if (bytes.Length < 2) throw new InvalidDataException();
        return (bytes[0] & 1) == 0 ? bytes[1] : U16(bytes, 1);
    }

    public static (int? Power, double? Cadence) ReadIndoorBike(byte[] bytes)
    {
        var flags = U16(bytes, 0);
        int offset = 2;
        if ((flags & 1) == 0) offset += 2;
        if ((flags & 2) != 0) offset += 2;
        double? cadence = null;
        if ((flags & 4) != 0) { cadence = U16(bytes, offset) / 2.0; offset += 2; }
        if ((flags & 8) != 0) offset += 2;
        if ((flags & 16) != 0) offset += 3;
        if ((flags & 32) != 0) offset += 2;
        int? power = (flags & 64) != 0 ? unchecked((short)U16(bytes, offset)) : null;
        if (offset > bytes.Length) throw new InvalidDataException();
        return (power, cadence);
    }

    public static (int Power, ushort? Revolutions, ushort? Time) ReadCyclingPower(byte[] bytes)
    {
        var flags = U16(bytes, 0);
        int power = unchecked((short)U16(bytes, 2)), offset = 4;
        if ((flags & 1) != 0) offset += 1;
        if ((flags & 4) != 0) offset += 2;
        if ((flags & 16) != 0) offset += 6;
        if ((flags & 32) == 0) return (power, null, null);
        return (power, U16(bytes, offset), U16(bytes, offset + 2));
    }

    public static IEnumerable<(byte Button, byte State)> ReadButtons(byte[] bytes)
    {
        if (bytes.Length < 3 || bytes[0] != 1 || bytes.Length % 2 == 0) throw new InvalidDataException();
        var result = new List<(byte, byte)>();
        for (int i = 1; i < bytes.Length; i += 2) result.Add((bytes[i], bytes[i + 1]));
        return result;
    }

    public static void Verify()
    {
        if (ReadHeartRate([0, 137]) != 137 || ReadHeartRate([1, 44, 1]) != 300) throw new Exception("Heart rate decoding failed");
        var bike = ReadIndoorBike([0x44, 0, 0xc4, 9, 180, 0, 250, 0]);
        if (bike.Power != 250 || bike.Cadence != 90) throw new Exception("FTMS decoding failed");
        if (ReadIndoorBike([0x41, 0, 100, 0]).Power != 100) throw new Exception("FTMS More Data flag failed");
        var power = ReadCyclingPower([0x20, 0, 200, 0, 5, 0, 0, 4]);
        if (power.Power != 200 || power.Revolutions != 5 || power.Time != 1024) throw new Exception("Cycling power decoding failed");
        if (ReadButtons([1, 1, 1, 2, 0]).Count() != 2) throw new Exception("Controller decoding failed");
        var click = ReadZwiftClick([0x37, 8, 0, 16, 1]).ToArray();
        if (click[0].State != 1 || click[1].State != 0) throw new Exception("Zwift Click decoding failed");
        var click2 = ReadZwiftClick2([0x23, 8, 0xdf, 0xff, 0xff, 0xff, 0x0f], true).ToArray();
        if (click2[0].State != 0 || click2[1].State != 1) throw new Exception("Click 2 B button decoding failed");
        try { ReadHeartRate([1, 30]); throw new Exception("Truncated heart rate accepted"); } catch (InvalidDataException) { }
        try { ReadIndoorBike([0x44, 0, 0]); throw new Exception("Truncated FTMS accepted"); } catch (InvalidDataException) { }
    }

    public static IEnumerable<(byte Button, byte State)> ReadZwiftClick(byte[] bytes)
    {
        if (bytes.Length < 1 || bytes[0] != 0x37) throw new InvalidDataException();
        byte plus = 1, minus = 1;
        int offset = 1;
        while (offset < bytes.Length)
        {
            uint tag = ReadVarint(bytes, ref offset);
            if ((tag & 7) != 0) throw new InvalidDataException();
            uint value = ReadVarint(bytes, ref offset);
            if (tag == 8) plus = value == 0 ? (byte)1 : (byte)0;
            if (tag == 16) minus = value == 0 ? (byte)1 : (byte)0;
        }
        return [(1, plus), (2, minus)];
    }

    private static uint ReadVarint(byte[] bytes, ref int offset)
    {
        uint result = 0;
        for (int shift = 0; shift < 32 && offset < bytes.Length; shift += 7)
        {
            byte value = bytes[offset++];
            result |= (uint)(value & 127) << shift;
            if ((value & 128) == 0) return result;
        }
        throw new InvalidDataException();
    }

    public static IEnumerable<(byte Button, byte State)> ReadZwiftClick2(byte[] bytes, bool rightOnly)
    {
        if (bytes.Length < 2 || bytes[0] != 0x23) throw new InvalidDataException();
        int offset = 1;
        uint? mask = null;
        while (offset < bytes.Length)
        {
            uint tag = ReadVarint(bytes, ref offset);
            if ((tag & 7) == 0)
            {
                uint value = ReadVarint(bytes, ref offset);
                if (tag == 8) mask = value;
            }
            else if ((tag & 7) == 2)
            {
                int length = checked((int)ReadVarint(bytes, ref offset));
                if (length > bytes.Length - offset) throw new InvalidDataException();
                offset += length;
            }
            else throw new InvalidDataException();
        }
        if (!mask.HasValue) throw new InvalidDataException();
        byte up = (mask.Value & 0x1000) == 0 ? (byte)1 : (byte)0;
        byte down = (mask.Value & (rightOnly ? 0x20u : 0x100u)) == 0 ? (byte)1 : (byte)0;
        return [(1, up), (2, down)];
    }
}
