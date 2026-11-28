namespace MTBIndoorBern;

internal sealed record BrakeEndpoints(int Released, int Pulled, bool Provisional = false)
{
    public static bool ValidRaw(int value) => value is >= 0 and < 4096;
    public static int WrapDelta(int value, int origin) => ((value - origin + 6144) % 4096) - 2048;
    public int Span => WrapDelta(Pulled, Released);
    public static BrakeEndpoints Create(int released, int pulled, bool provisional = false)
    {
        if (!ValidRaw(released) || !ValidRaw(pulled)) throw new InvalidOperationException("Both brake endpoints must be between 0 and 4095.");
        int span = WrapDelta(pulled, released);
        if (Math.Abs(span) < 16) throw new InvalidOperationException("Brake travel is too small. Capture released and a distinct comfortable full pull.");
        if (Math.Abs(span) > 1024) throw new InvalidOperationException("Brake travel exceeds 90°. Check the magnet and endpoints.");
        return new(released, pulled, provisional);
    }
    public double? Normalize(int raw)
    {
        if (!ValidRaw(raw)) return null;
        try { Create(Released, Pulled, Provisional); } catch (InvalidOperationException) { return null; }
        double fraction = (double)WrapDelta(raw, Released) / Span, tolerance = Math.Max(16d / Math.Abs(Span), .2);
        return fraction < -tolerance || fraction > 1 + tolerance ? null : Math.Clamp(fraction, 0, 1);
    }
}

internal sealed record BrakeDeviceCalibration
{
    public ulong Address { get; init; }
    public int ProtocolVersion { get; init; } = BrakeProtocol.Version;
    public BrakeEndpoints? Left { get; init; }
    public BrakeEndpoints? Right { get; init; }
    public bool LeftIsFront { get; init; } = true;

    public BrakeDeviceCalibration Normalize()
    {
        static BrakeEndpoints? Endpoint(BrakeEndpoints? value)
        {
            try { return value is null ? null : BrakeEndpoints.Create(value.Released, value.Pulled, value.Provisional); }
            catch (InvalidOperationException) { return null; }
        }
        return this with { Left = Endpoint(Left), Right = Endpoint(Right) };
    }
}

internal sealed record BrakeEndpointCapture(int Raw, bool Provisional);
internal sealed record BrakeChannelSnapshot(int? Raw, double? Travel, bool Healthy, bool Usable, bool Armed, string Status);
internal sealed record BrakeInputSnapshot(double Front, double Rear, BrakeChannelSnapshot Left, BrakeChannelSnapshot Right,
    bool Fresh, bool Armed, string State, string Status, ulong DeviceAddress, string DeviceName, bool Calibrated, bool LeftIsFront);

// Access is serialized by SensorConnection.inputLock. This class has no BLE,
// trainer or persistence side effects and can be exercised entirely offline.
internal sealed class BrakeInputState
{
    private sealed record Sample(BrakeFrame Frame, long Time);
    private readonly BrakeFrameClock clock = new();
    private readonly List<Sample> history = [];
    private readonly bool[] armed = new bool[2];
    private readonly long[] armAfter = new long[2];
    private BrakeFrame? frame;
    private BrakeDeviceCalibration? profile;
    private string? frameFault;
    public void Reset()
    {
        clock.Reset(); history.Clear(); frame = null; frameFault = null; profile = null;
        ResetArming(0);
    }
    public void ResetArming(long nowMilliseconds)
    {
        armed[0] = armed[1] = false; armAfter[0] = armAfter[1] = nowMilliseconds;
    }
    public bool Accept(ReadOnlySpan<byte> bytes, long nowMilliseconds)
    {
        BrakeFrame next;
        try { next = BrakeProtocol.Decode(bytes); }
        catch (InvalidDataException e)
        {
            frameFault = e.Message; frame = null; history.Clear(); clock.InvalidateFreshness(); ResetArming(nowMilliseconds); return false;
        }
        bool wasFresh = clock.Fresh(nowMilliseconds);
        if (!clock.Accept(next, nowMilliseconds, out bool restarted)) return false;
        if (restarted || !wasFresh) { history.Clear(); ResetArming(nowMilliseconds); }
        frame = next; frameFault = null;
        for (int i = 0; i < 2; i++)
        {
            var endpoint = i == 0 ? profile?.Left : profile?.Right;
            int raw = i == 0 ? next.Left.Raw : next.Right.Raw;
            if (!BrakeProtocol.ChannelState(next, i == 0).Usable || endpoint is not null && endpoint.Normalize(raw) is null)
            { armed[i] = false; armAfter[i] = nowMilliseconds; }
        }
        history.Add(new(next, nowMilliseconds));
        if (history.Count > 32) history.RemoveAt(0);
        return true;
    }

    public BrakeInputSnapshot Snapshot(bool connected, ulong address, string name, BrakeDeviceCalibration? calibration, long nowMilliseconds)
    {
        if (address == 0 || address > 0xFFFFFFFFFFFF || calibration?.Address != address || calibration?.ProtocolVersion != BrakeProtocol.Version) calibration = null;
        calibration = calibration?.Normalize();
        if (!Equals(profile, calibration)) { profile = calibration; ResetArming(nowMilliseconds); }
        bool fresh = connected && frame is not null && clock.Fresh(nowMilliseconds);
        if (!fresh) ResetArming(nowMilliseconds);
        bool configured = profile?.Left is not null && profile.Right is not null, leftFront = profile?.LeftIsFront ?? true;
        string unavailable = !connected ? "Disconnected" : frameFault ?? (frame is null ? "Waiting for brake telemetry" : "Brake telemetry stopped · input released");
        BrakeChannelSnapshot Channel(bool left)
        {
            int index = left ? 0 : 1;
            if (!fresh || frame is null) return new(null, null, false, false, false, unavailable);
            var value = left ? frame.Left : frame.Right;
            var magnetic = BrakeProtocol.ChannelState(frame, left);
            var endpoints = left ? profile?.Left : profile?.Right;
            int? raw = BrakeEndpoints.ValidRaw(value.Raw) ? value.Raw : null;
            double? travel = magnetic.Usable && endpoints is not null ? endpoints.Normalize(value.Raw) : null;
            bool usable = magnetic.Usable && (endpoints is null || travel.HasValue);
            if (!usable || endpoints is null) { armed[index] = false; armAfter[index] = nowMilliseconds; }
            else if (!armed[index] && travel <= .05)
            {
                // Only distinct accepted frames can establish release. Re-reading
                // one packet from the UI never satisfies the 200 ms release gate.
                long? oldest = null;
                foreach (var sample in history.AsEnumerable().Reverse())
                {
                    if (sample.Time < armAfter[index] || nowMilliseconds - sample.Time >= BrakeProtocol.StaleMilliseconds) break;
                    var reading = left ? sample.Frame.Left : sample.Frame.Right;
                    var normalized = endpoints.Normalize(reading.Raw);
                    if (!BrakeProtocol.ChannelState(sample.Frame, left).Usable || normalized is null || normalized > .05) break;
                    oldest = sample.Time;
                }
                if (oldest is { } start && clock.ReceivedMilliseconds - start >= 200) armed[index] = true;
            }
            bool healthy = magnetic.Healthy && endpoints?.Provisional != true && usable;
            string status = !magnetic.Usable ? magnetic.Status : endpoints is null ? magnetic.Status + " · calibration required"
                : !travel.HasValue ? "Outside calibrated travel · input released"
                : endpoints.Provisional && magnetic.Healthy ? "Provisional calibration · check magnetic setup"
                : magnetic.Status;
            return new(raw, travel, healthy, usable, armed[index], status);
        }
        var left = Channel(true); var right = Channel(false);
        double leftInput = left.Armed ? left.Travel ?? 0 : 0, rightInput = right.Armed ? right.Travel ?? 0 : 0;
        string state = !connected ? "disconnected" : frameFault is not null ? "fault" : !fresh ? frame is null ? "waiting" : "stale"
            : !left.Usable || !right.Usable ? "fault" : !configured ? "uncalibrated" : !left.Armed || !right.Armed ? "arming"
            : !left.Healthy || !right.Healthy ? "warning" : "connected";
        string statusText = state switch
        {
            "disconnected" or "waiting" or "stale" => unavailable,
            "fault" => frameFault ?? (!left.Usable ? "Left: " + left.Status : "Right: " + right.Status),
            "uncalibrated" => "Set released and full-pull endpoints in Brake setup",
            "arming" => "Release the levers to arm braking",
            "warning" => "Provisional brake input · check magnetic setup",
            _ => "Both levers ready"
        };
        if (fresh && (state is "arming" or "uncalibrated") &&
            (left.Usable && !left.Healthy || right.Usable && !right.Healthy)) statusText += " · provisional magnetic setup";
        return new(leftFront ? leftInput : rightInput, leftFront ? rightInput : leftInput, left, right, fresh,
            left.Armed && right.Armed, state, statusText, address, name, configured, leftFront);
    }

    public BrakeEndpointCapture Capture(bool left, long nowMilliseconds)
    {
        if (!clock.Fresh(nowMilliseconds)) throw new InvalidOperationException("Fresh brake telemetry is required before capturing an endpoint.");
        var recent = history.Where(s => nowMilliseconds - s.Time is >= 0 and <= 650).ToArray();
        if (recent.Length < 10 || nowMilliseconds - recent[^1].Time > 150 || recent[^1].Time - recent[0].Time < 450)
            throw new InvalidOperationException("Hold this lever still with usable readings for at least half a second.");
        if (recent.Any(s => !BrakeProtocol.ChannelState(s.Frame, left).Usable))
            throw new InvalidOperationException("A detected magnet and valid encoder readings are required before capture.");
        int origin = left ? recent[0].Frame.Left.Raw : recent[0].Frame.Right.Raw;
        var deltas = recent.Select(s => BrakeEndpoints.WrapDelta(left ? s.Frame.Left.Raw : s.Frame.Right.Raw, origin)).ToArray();
        if (deltas.Max() - deltas.Min() > 12) throw new InvalidOperationException("The lever is still moving. Hold it steady and try again.");
        int raw = ((int)Math.Round(origin + deltas.Average(), MidpointRounding.AwayFromZero) % 4096 + 4096) % 4096;
        return new(raw, recent.Any(s => !BrakeProtocol.ChannelState(s.Frame, left).Healthy));
    }
}
