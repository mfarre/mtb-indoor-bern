using System.Buffers.Binary;

namespace MTBIndoorBern;

internal static class BrakeProtocolTests
{
    private static void Check(bool value, string message) { if (!value) throw new Exception("Brake protocol: " + message); }
    private static void Near(double actual, double expected, string message) => Check(Math.Abs(actual - expected) < .000001, message);
    private static void Throws(Action action, string message)
    {
        try { action(); } catch (Exception e) when (e is InvalidOperationException or InvalidDataException) { return; }
        throw new Exception("Brake protocol: " + message);
    }
    internal static byte[] Frame(ushort sequence, uint uptime, int left = 1000, int right = 2000, int flags = 7,
        byte leftStatus = 0x20, byte rightStatus = 0x20, byte leftAgc = 64, byte rightAgc = 64)
    {
        byte[] data = new byte[20]; data[0] = 1; data[1] = (byte)flags;
        BinaryPrimitives.WriteUInt16LittleEndian(data.AsSpan(2), sequence); BinaryPrimitives.WriteUInt32LittleEndian(data.AsSpan(4), uptime);
        BinaryPrimitives.WriteUInt16LittleEndian(data.AsSpan(8), (ushort)left); BinaryPrimitives.WriteUInt16LittleEndian(data.AsSpan(10), (ushort)right);
        data[12] = leftStatus; data[13] = rightStatus; data[14] = leftAgc; data[15] = rightAgc; return data;
    }
    private static BrakeDeviceCalibration Profile(ulong address = 111, bool reverse = false, bool provisional = false) => new()
    {
        Address = address, Left = BrakeEndpoints.Create(1000, 1300, provisional), Right = BrakeEndpoints.Create(2000, 1700), LeftIsFront = !reverse
    };

    public static void Verify()
    {
        var golden = BrakeProtocol.Decode(Convert.FromHexString("0107341204030201ff0f00002020404100000000"));
        Check(golden.Sequence == 0x1234 && golden.Uptime == 0x01020304 && golden.Left.Raw == 4095 && golden.Right.Raw == 0 && golden.Left.Agc == 64 && golden.Right.Agc == 65, "golden fixture little-endian decoding");
        Check(BrakeProtocol.ChannelState(golden, true).Healthy && BrakeProtocol.ChannelState(golden, false).Healthy, "golden magnetic health");
        Throws(() => BrakeProtocol.Decode(new byte[19]), "truncated frame rejected");
        var invalid = Frame(1, 50); invalid[0] = 2; Throws(() => BrakeProtocol.Decode(invalid), "unknown version rejected");
        invalid = Frame(1, 50); invalid[1] |= 8; Throws(() => BrakeProtocol.Decode(invalid), "unknown flags rejected");
        invalid = Frame(1, 50); invalid[19] = 1; Throws(() => BrakeProtocol.Decode(invalid), "reserved data rejected");
        foreach (byte status in new byte[] { 0, 0x18, 0x38, 0xff, 0x21 })
            Check(!BrakeProtocol.ChannelState(BrakeProtocol.Decode(Frame(1, 50, leftStatus: status)), true).Usable, "missing magnet and invalid status are faults");
        foreach (byte status in new byte[] { 0x28, 0x30 })
        {
            var warning = BrakeProtocol.ChannelState(BrakeProtocol.Decode(Frame(1, 50, leftStatus: status, leftAgc: 128)), true);
            Check(warning.Usable && !warning.Healthy, "readable weak/strong field is explicitly provisional");
        }
        Check(!BrakeProtocol.ChannelState(BrakeProtocol.Decode(Frame(1, 50, left: 65535)), true).Usable, "raw sentinel rejected");
        Check(!BrakeProtocol.ChannelState(BrakeProtocol.Decode(Frame(1, 50, leftAgc: 129)), true).Usable, "AGC outside 3.3V range rejected");
        var noMux = BrakeProtocol.Decode(Frame(1, 50, flags: 6));
        Check(!BrakeProtocol.ChannelState(noMux, true).Usable && !BrakeProtocol.ChannelState(noMux, false).Usable, "mux isolation failure releases both channels");

        var forward = BrakeEndpoints.Create(1000, 1300); var backward = BrakeEndpoints.Create(2000, 1700); var wrapping = BrakeEndpoints.Create(4000, 100);
        Near(forward.Normalize(1150)!.Value, .5, "forward travel"); Near(backward.Normalize(1850)!.Value, .5, "reverse travel");
        Near(wrapping.Normalize(2)!.Value, .5, "zero-crossing travel");
        Check(forward.Normalize(2000) is null && forward.Normalize(-1) is null, "out-of-travel input never saturates to a false full brake");
        Near(forward.Normalize(995)!.Value, 0, "small release tolerance clamps to zero");
        Throws(() => BrakeEndpoints.Create(1000, 1005), "small span rejected"); Throws(() => BrakeEndpoints.Create(1000, 2200), "over-90-degree span rejected");

        var clock = new BrakeFrameClock();
        Check(clock.Accept(BrakeProtocol.Decode(Frame(65535, uint.MaxValue - 20)), 1000, out _), "clock starts");
        Check(clock.Accept(BrakeProtocol.Decode(Frame(0, 29)), 1050, out bool restarted) && !restarted, "independent sequence and uptime wrap");
        Check(!clock.Accept(BrakeProtocol.Decode(Frame(0, 29)), 1700, out _) && !clock.Fresh(1800), "duplicate packets cannot keep input fresh");
        Check(!clock.Accept(BrakeProtocol.Decode(Frame(65535, uint.MaxValue - 20)), 1900, out _), "old notification ignored");
        clock.Reset(); clock.Accept(BrakeProtocol.Decode(Frame(12, 3000)), 0, out _);
        Check(clock.Accept(BrakeProtocol.Decode(Frame(1, 50)), 50, out restarted) && restarted, "clear reboot recognised");
        clock.Reset(); clock.Accept(BrakeProtocol.Decode(Frame(10, 1000)), 0, out _);
        Check(clock.Accept(BrakeProtocol.Decode(Frame(10, 3277800)), 100, out _) && clock.Fresh(100), "entire sequence wrap resolved by advancing uptime");
        Check(!clock.Accept(BrakeProtocol.Decode(Frame(20, 3277801)), 150, out _), "contradictory counters rejected");

        var state = new BrakeInputState(); var profile = Profile();
        state.Accept(Frame(1, 50, 1300, 1700), 50);
        var held = state.Snapshot(true, 111, "Synthetic board", profile, 50);
        Check(held.Front == 0 && held.Rear == 0 && !held.Armed, "held levers do not arm after connect");
        for (ushort i = 2; i <= 8; i++) { state.Accept(Frame(i, (uint)(i * 50)), i * 50); state.Snapshot(true, 111, "Synthetic board", profile, i * 50); }
        var released = state.Snapshot(true, 111, "Synthetic board", profile, 400);
        Check(released.Armed && released.State == "connected", "distinct released frames arm both channels");
        state.Accept(Frame(9, 450, 1150, 1700), 450);
        var squeezed = state.Snapshot(true, 111, "Synthetic board", profile, 450);
        Near(squeezed.Front, .5, "left is front by default"); Near(squeezed.Rear, 1, "right reverse travel is rear");
        state.Accept(Frame(10, 500, 1150, 1700, flags: 3), 500);
        var rightFault = state.Snapshot(true, 111, "Synthetic board", profile, 500);
        Near(rightFault.Front, .5, "healthy front remains independent of rear fault"); Check(rightFault.Rear == 0 && !rightFault.Right.Armed, "rear fault releases rear immediately");
        state.Accept(Frame(11, 550, 1150, 1700), 550);
        Check(state.Snapshot(true, 111, "Synthetic board", profile, 550).Rear == 0, "fault recovery while held cannot rearm");
        var stale = state.Snapshot(true, 111, "Synthetic board", profile, 1300);
        Check(stale.Front == 0 && stale.Rear == 0 && stale.State == "stale", "750ms watchdog releases both inputs");
        state.Accept(Frame(12, 600, 1300, 1700), 1350);
        Check(state.Snapshot(true, 111, "Synthetic board", profile, 1350).Front == 0, "stale recovery requires release");
        for (ushort i = 13; i <= 19; i++) { long t = 1350 + (i - 12) * 50; state.Accept(Frame(i, (uint)(i * 50)), t); state.Snapshot(true, 111, "Synthetic board", profile, t); }
        Check(state.Snapshot(true, 111, "Synthetic board", profile, 1700).Armed, "released recovery re-arms");
        var switched = state.Snapshot(true, 111, "Synthetic board", Profile(reverse: true), 1700);
        Check(!switched.Armed && switched.Front == 0, "mapping changes require rearming");
        Check(!state.Snapshot(true, 222, "Synthetic board", profile, 1700).Calibrated, "another exact address cannot inherit calibration");
        Check(!state.Snapshot(true, 111, "Synthetic board", profile with { ProtocolVersion = 2 }, 1700).Calibrated, "another protocol cannot inherit calibration");
        Check(!state.Snapshot(true, 0, "Synthetic board", Profile(address: 0), 1700).Calibrated, "missing board address cannot activate calibration");

        var interleaved = new BrakeInputState();
        for (ushort i = 1; i <= 8; i++) { interleaved.Accept(Frame(i, (uint)(i * 50)), i * 50); interleaved.Snapshot(true, 111, "Synthetic board", profile, i * 50); }
        Check(interleaved.Snapshot(true, 111, "Synthetic board", profile, 400).Armed, "interleaved fixture arms");
        interleaved.Accept(Frame(9, 450, 2500, 2000), 450);
        interleaved.Accept(Frame(10, 500, 1300, 1700), 500);
        var recoveredHeld = interleaved.Snapshot(true, 111, "Synthetic board", profile, 500);
        Check(recoveredHeld.Front == 0 && recoveredHeld.Rear == 1, "out-of-travel frame between UI reads must disarm only affected channel");

        var warningState = new BrakeInputState(); var provisional = Profile(provisional: true);
        for (ushort i = 1; i <= 14; i++)
        {
            warningState.Accept(Frame(i, (uint)(i * 50), leftStatus: 0x30, leftAgc: 128), i * 50);
            warningState.Snapshot(true, 111, "Synthetic board", provisional, i * 50);
        }
        var captured = warningState.Capture(true, 700);
        Check(captured.Raw == 1000 && captured.Provisional, "stable usable warning may be captured provisionally");
        warningState.Accept(Frame(15, 750, 1300, 2000, leftStatus: 0x30, leftAgc: 128), 750);
        var warned = warningState.Snapshot(true, 111, "Synthetic board", provisional, 750);
        Check(warned.Front == 1 && warned.State == "warning" && !warned.Left.Healthy, "provisional input works with an explicit warning");
        Throws(() => warningState.Capture(true, 750), "moving endpoint cannot be captured");
        invalid = Frame(16, 800); invalid[0] = 2; warningState.Accept(invalid, 800);
        var malformed = warningState.Snapshot(true, 111, "Synthetic board", provisional, 800);
        Check(malformed.Front == 0 && malformed.Rear == 0 && malformed.State == "fault", "invalid frame releases immediately");
        warningState.Reset();
        Check(!warningState.Snapshot(false, 111, "Synthetic board", provisional, 850).Armed, "disconnect clears frame clock and arming");
    }
}
