namespace MTBIndoorBern;

internal static class BrakeHandlingTests
{
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static double Advance(TrailHandling handling, double speed, double front = 0, double rear = 0, double dt = .025, bool fallback = false)
        => handling.Step(speed, 0, 0, 75, fallback, null, 0, dt, frontBrake: front, rearBrake: rear);

    public static void Verify()
    {
        var front = new TrailHandling(); var rear = new TrailHandling();
        double vf = 10, vr = 10;
        for (int i = 0; i < 30; i++) { vf = Advance(front, vf, .5); vr = Advance(rear, vr, rear: .5); }
        Check(vf < vr && front.FrontBrake == .5 && front.RearBrake == 0 && rear.FrontBrake == 0 && rear.RearBrake == .5, "Independent proportional brakes have distinct front/rear stopping forces");
        Check(front.CrashSequence == 0 && rear.CrashSequence == 0 && front.RearSlip == 0 && rear.FrontSlip == 0, "Moderate independent braking does not invent wheel locks");

        var light = new TrailHandling(); var strong = new TrailHandling();
        double vl = 10, vs = 10;
        for (int i = 0; i < 30; i++) { vl = Advance(light, vl, .25); vs = Advance(strong, vs, .7); }
        Check(vs < vl && strong.Recovery == 0, "Increasing pressure progressively slows the bike before the lock threshold");

        var skid = new TrailHandling(); double skidSpeed = 10;
        for (int i = 0; i < 30; i++) skidSpeed = Advance(skid, skidSpeed, rear: 1);
        Check(skid.RearSlip > .9 && skid.FrontSlip == 0 && skid.CrashSequence == 0, "A hard rear brake produces a rear skid without a front-wheel fall");
        for (int i = 0; i < 20; i++) skidSpeed = Advance(skid, skidSpeed);
        Check(skid.RearSlip == 0 && skid.RearBrake == 0, "Releasing the rear brake clears its skid");

        var assisted = new TrailHandling(); double assistedSpeed = 10;
        for (int i = 0; i < 200; i++) assistedSpeed = assisted.Step(assistedSpeed, 0, -20, 75, true, null, 0, .025);
        Check(assistedSpeed == 0 && assisted.Brake == 1 && assisted.Recovery == 0 && assisted.CrashSequence == 0 && assisted.FrontSlip == 0 && assisted.RearSlip == 0,
            "Click/Space remains an assisted balanced brake and stops on a steep descent without a front flip");

        var tap = new TrailHandling();
        for (int i = 0; i < 5; i++) Advance(tap, 10, 1);
        for (int i = 0; i < 10; i++) Advance(tap, 10);
        Check(tap.CrashSequence == 0 && tap.FrontSlip == 0, "A brief front-brake tap does not become a sustained lock");
        var belowThreshold = new TrailHandling(); var slow = new TrailHandling();
        for (int i = 0; i < 120; i++) { Advance(belowThreshold, 10, .91); Advance(slow, 3.9, 1); }
        Check(belowThreshold.CrashSequence == 0 && slow.CrashSequence == 0, "Front-lock requires both the pressure and physical-speed thresholds");

        static double CrashAt(double dt)
        {
            var h = new TrailHandling(); double speed = 10, elapsed = 0;
            while (h.Recovery == 0 && elapsed < 2) { speed = Advance(h, speed, 1, dt: dt); elapsed += dt; }
            Check(h.CrashKind == "front-lock" && h.CrashSequence == 1 && h.OffTracks == 1 && speed == 0 && h.Recovery == 3,
                "A sustained hard front lock creates exactly one three-second stopped recovery");
            return elapsed;
        }
        Check(Math.Abs(CrashAt(.025) - CrashAt(.02)) < .05, "Front-lock timing is stable across physics steps");

        var held = new TrailHandling();
        for (int i = 0; i < 400; i++) Advance(held, 10, 1);
        Check(held.CrashSequence == 1 && held.Recovery == 0, "A held front lever cannot retrigger a fall after recovery, even if speed rises again");
        Advance(held, 10, 0);
        for (int i = 0; i < 30; i++) Advance(held, 10, 1);
        Check(held.CrashSequence == 2 && held.Recovery > 0, "Releasing and squeezing the front lever rearms a later fall");
        held.Release();
        Check(held.FrontBrake == 0 && held.RearBrake == 0 && held.FrontSlip == 0 && held.RearSlip == 0 && held.Recovery == 0 && held.CrashKind is null && held.CrashSequence == 2,
            "Pause-style release clears effects without rewinding crash event identity");
        held.Reset(); Check(held.OffTracks == 0 && held.CrashSequence == 2, "Restart clears penalties while keeping crash sequence monotonic");

        var corner = new TrailHandling(); var sharp = new TrailCorner(100, 4, 1, "gravel", 2);
        for (int i = 0; i < 100 && corner.Recovery == 0; i++) corner.Step(12, 0, 0, 75, false, sharp, 100, .025);
        Check(corner.CrashKind == "corner" && corner.CrashSequence == 1 && corner.Recovery == 3, "Existing corner run-outs retain a separate crash event and recovery");

        var recovery = new TrailHandling();
        for (int i = 0; i < 50 && recovery.Recovery == 0; i++) Advance(recovery, 10, 1);
        var started = new DateTimeOffset(2026, 1, 2, 12, 0, 0, TimeSpan.Zero);
        var recorder = new RideActivityRecorder("test", "Synthetic stationary recovery", started, 0);
        for (int i = 1; i <= 30; i++)
        {
            var velocity = recovery.Step(0, 200, 0, 75, false, null, 0, .1, frontBrake: 1);
            Check(velocity == 0, "Recovery holds the avatar stationary while measured trainer power remains independent");
            recorder.Record(started.AddSeconds(i * .1), .1, 0, 200, 80, 140, true);
        }
        var recorded = recorder.Snapshot()!;
        Check(recovery.Recovery < 1e-8 && Math.Abs(recorded.ActiveSeconds - 3) < 1e-8 && Math.Abs(recorded.MechanicalWorkJoules - 600) < 1e-8 && recorded.DistanceMeters == 0 && recorded.EstimatedCalories > 0,
            "Three seconds lost to virtual recovery still retain real measured work and calories at zero distance");

        var normalDemo = new TrailHandling(); var fastDemo = new TrailHandling();
        double normalSpeed = 6.2, fastSpeed = 6.2;
        for (int i = 0; i < 30; i++)
        {
            normalSpeed = normalDemo.StepDemo(normalSpeed, false, 1, 0, .025);
            fastSpeed = fastDemo.StepDemo(fastSpeed * 8, false, 1, 0, .025);
        }
        Check(normalDemo.CrashSequence == 1 && fastDemo.CrashSequence == 1 && Math.Abs(normalDemo.Recovery - fastDemo.Recovery) < .001,
            "Exploration caps physical speed before wheel-lock evaluation, independently of displayed acceleration");
        var invalid = new TrailHandling(); Advance(invalid, 8, double.NaN, double.PositiveInfinity);
        Check(invalid.Brake == 0 && invalid.CrashSequence == 0, "Invalid pressures fail to zero without creating braking or falls");
    }
}
