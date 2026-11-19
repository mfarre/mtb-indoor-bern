using System.Text.Json;

namespace MTBIndoorBern;

internal static class TrailTests
{
    private static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    public static object Verify(string routeFile)
    {
        var pressed = Packets.ReadZwiftClick2([0x23, 8, 0xef, 0xff, 0xff, 0xff, 0x0f], true).ToArray();
        var released = Packets.ReadZwiftClick2([0x23, 8, 0xff, 0xff, 0xff, 0xff, 0x0f], true).ToArray();
        var both = Packets.ReadZwiftClick2([0x23, 8, 0xcf, 0xff, 0xff, 0xff, 0x0f], true).ToArray();
        Check(pressed[2].State == 1 && pressed[0].State == 0 && pressed[1].State == 0 && released.All(b => b.State == 0), "A press/release must not shift");
        Check(both[1].State == 1 && both[2].State == 1, "A+B simultaneous");
        Check(Packets.ReadZwiftClick2([0x23, 8, 0xef, 0xff, 0xff, 0xff, 0x0f], false).Last().State == 0, "Do not map left Click to A");
        try { Packets.ReadZwiftClick2([0x23, 8, 0x80], true); throw new Exception("Malformed Click packet accepted"); } catch (InvalidDataException) { }
        var brake = new TrailHandling(); double speed = 10;
        for (int i = 0; i < 200; i++) speed = brake.Step(speed, 0, -20, 75, true, null, 0, .025);
        Check(speed == 0 && brake.Brake == 1, "Brake must stop on steep downhill");
        for (int i = 0; i < 80; i++) speed = brake.Step(speed, 0, -10, 75, false, null, 0, .025);
        Check(speed > 1 && brake.Brake == 0, "Release must coast downhill at zero watts");
        var straight = new Course { Length = 300, Points = [new() { D = 0 }, new() { D = 300, X = 300 }] };
        Check(new TrailPlan(straight).Corners.Length == 0, "Straight trail must have no corner risk");
        var course = Course.Load(routeFile); var plan = new TrailPlan(course, routeFile);
        Check(plan.Corners.All(c => double.IsFinite(c.Limit) && c.Limit >= 12 / 3.6 && c.Limit <= 45 / 3.6), "Finite corner speeds");
        object? descentComparison = null;
        if (plan.Stage is { } stage)
        {
            var noBrake = Simulate(course, plan, false, .025);
            var skilled = Simulate(course, plan, true, .025);
            var differentStep = Simulate(course, plan, true, .02);
            Check(noBrake.OffTracks > 0 && skilled.OffTracks == 0, "Anticipating corners must prevent run-outs");
            Check(skilled.Seconds < noBrake.Seconds, "A controlled descent should beat never braking");
            Check(Math.Abs(skilled.Seconds - differentStep.Seconds) < 2, "Braking must be stable across update intervals");
            descentComparison = new { noBrake, skilled, differentStep };
            string file = Path.Combine(Path.GetTempPath(), "mtb-record-test-" + Guid.NewGuid() + ".json");
            try
            {
                var records = new PersonalRecords(file); var timer = new DescentTimer(plan, records);
                timer.Tick(stage.Start - 10, stage.Start + 10, 2, true);
                timer.Tick(stage.Start + 10, stage.Start + 10, 3, true);
                timer.Tick(stage.Start + 10, stage.End - 10, 100, true);
                timer.Tick(stage.End - 10, stage.End + 10, 2, true);
                Check(timer.Status == "finished" && Math.Abs(timer.Seconds - 105) < .0001 && timer.NewBest, "Fractional gates and stationary recovery time");
                Check(new PersonalRecords(file).Best(plan.RecordKey) == 105, "Persist best time");
                timer.Reset(); timer.Tick(stage.Start - 1, stage.Start + 1, 1, true); timer.Invalidate(); timer.Tick(stage.Start + 1, stage.End + 1, 30, true);
                Check(!timer.NewBest && records.Best(plan.RecordKey) == 105, "Pause invalidates personal best");
                timer.Reset(); timer.Tick(stage.Start - 1, stage.Start + 1, 1, false); timer.Tick(stage.Start + 1, stage.End + 1, 20, false);
                Check(!timer.NewBest && records.Best(plan.RecordKey) == 105, "Practice cannot overwrite best");
                Check(!records.Submit(plan.RecordKey, double.NaN) && !records.Submit(plan.RecordKey, 110), "Reject bad or worse records");
            }
            finally { if (File.Exists(file)) File.Delete(file); if (File.Exists(file + ".tmp")) File.Delete(file + ".tmp"); }
            using var trainer = new SensorConnection(SensorRole.Trainer); using var heart = new SensorConnection(SensorRole.HeartRate);
            var ride = new RideSession(course, trainer, heart, _ => { }, routeFile: routeFile);
            ride.StartPracticeAsync().GetAwaiter().GetResult();
            Check(ride.Practice && ride.IsDemo && ride.Distance < stage.Start && trainer.Control is null, "Practice without trainer");
            ride.CycleDemoSpeed(); Check(ride.DemoSpeed == 1, "Practice cannot accelerate time");
            ride.SetScreenBrake(true); for (int i = 0; i < 50; i++) ride.Tick(.1);
            Check(ride.Velocity == 0, "RideSession receives held brake");
            ride.PauseAsync().GetAwaiter().GetResult(); Check(!ride.BrakePressed && !ride.Descent.Eligible, "Pause releases brake and ranking");
            ride.ResetAsync().GetAwaiter().GetResult(); Check(!ride.Practice && ride.Handling.OffTracks == 0, "Reset handling");
        }
        return new { passed = true, corners = plan.Corners.Length, descentComparison };
    }
    private sealed record Simulation(double Seconds, int OffTracks);
    private static Simulation Simulate(Course course, TrailPlan plan, bool controlled, double dt)
    {
        var h = new TrailHandling(); double d = plan.Stage!.Start - 55, v = 5, time = 0;
        while (d < plan.Stage.End && time < 1800)
        {
            var p = course.At(d); var next = plan.Next(d);
            bool brake = controlled && next is not null && v > next.Limit * .96 && next.Start - d < Math.Max(3, (v * v - next.Limit * next.Limit) / 6 + v * .75);
            v = h.Step(v, p.Grade > -1.3 ? 160 : 0, p.Grade, 75, brake, plan.At(d), d, dt,new BikeProfile(),plan.SurfaceAt(d));
            d += v * dt; time += dt;
        }
        Check(d >= plan.Stage.End, "Descent must reach finish");
        return new(time, h.OffTracks);
    }
}
