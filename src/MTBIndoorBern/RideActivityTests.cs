using System.Text.Json;

namespace MTBIndoorBern;

internal static class RideActivityTests
{
    private static void Check(bool value, string message) { if (!value) throw new Exception("Ride activity: " + message); }
    private static void Near(double actual, double expected, string message) => Check(Math.Abs(actual - expected) < .00001, message);

    public static void Verify()
    {
        var start = new DateTimeOffset(2026, 1, 2, 12, 0, 0, TimeSpan.Zero);
        var ride = new RideActivityRecorder("test", "Synthetic indoor fixture", start, 8000);
        Check(ride.Snapshot() is null, "no activity or calorie estimate before a real measurement");
        for (int i = 1; i <= 3600; i++) ride.Record(start.AddSeconds(i), 1, 8000 + 6 * i, 200, 80, 140, true);
        var hour = ride.Snapshot()!;
        Near(hour.ActiveSeconds, 3600, "one hour of fresh measured intervals");
        Near(hour.MechanicalWorkJoules, 720000, "200 W for one hour is 720 kJ");
        Near(hour.EstimatedCalories, 720000 / (4184 * .24), "explicit 24 percent efficiency estimate");
        Near(hour.DistanceMeters, 21600, "partial course starts contribute only ridden virtual distance");
        Check(hour.Segments.Count == 1 && hour.Segments[0].Points.Count == 3601, "one-Hz sampling plus first point");
        Check(hour.Segments[0].Points[0].DistanceMeters == 0 && hour.Segments[0].Points[0].TimeUtc == start, "UTC origin and zero distance");
        Check(hour.Segments[0].Points.All(p => p.PowerWatts == 200 && p.CadenceRpm == 80 && p.HeartRateBpm == 140), "measured telemetry retained");

        // Snapshots detach arrays, so exporters and storage cannot mutate the ride.
        var old = hour.Segments[0].Points[0];
        ((RideActivityPoint[])hour.Segments[0].Points)[0] = old with { PowerWatts = 999 };
        Check(ride.Snapshot()!.Segments[0].Points[0].PowerWatts == 200, "snapshot arrays are detached");
        var roundtrip = JsonSerializer.Deserialize<RideActivity>(JsonSerializer.Serialize(ride.Snapshot()))!;
        Near(roundtrip.EstimatedCalories, ride.EstimatedCalories, "immutable model round-trips through JSON");

        ride.Pause();
        ride.Record(start.AddSeconds(3650), 1, 30000, 400, 90, 150, true);
        Near(ride.ActiveSeconds, 3600, "pause cannot record work or time");
        ride.Resume(start.AddSeconds(3700), 29600);
        ride.Record(start.AddSeconds(3701), 1, 29610, 0, 0, null, true);
        var resumed = ride.Snapshot()!;
        Near(resumed.MechanicalWorkJoules, 720000, "coasting does not add calories");
        Near(resumed.ActiveSeconds, 3601, "fresh zero-W coasting still records active ride time");
        Near(resumed.DistanceMeters, 21610, "resume never bridges virtual distance while paused");
        Check(resumed.Segments.Count == 2 && resumed.Segments[1].StartedUtc == start.AddSeconds(3700), "pause creates a separate timestamped track");
        Check(resumed.Segments[1].Points[^1].HeartRateBpm is null && resumed.Segments[1].Points[^1].PowerWatts == 0, "missing HR omitted; real zero watts retained");

        ride.Record(start.AddSeconds(3702), 1, 29620, 300, 90, 160, false);
        ride.Record(start.AddSeconds(3712), 10, 29680, 300, 90, 160, true);
        Near(ride.MechanicalWorkJoules, 720000, "stale and delayed intervals never invent energy");
        Near(ride.ActiveSeconds, 3601, "gaps are excluded from active time");
        ride.Record(start.AddSeconds(3713), 1, 29686, 100, double.NaN, 0, true);
        var gap = ride.Snapshot()!;
        Near(gap.MechanicalWorkJoules, 720100, "fresh recording recovers after a gap");
        Near(gap.DistanceMeters, 21616, "unknown movement in gap is not silently recorded");
        Check(gap.Segments.Count == 3 && gap.Segments[^1].Points[^1].CadenceRpm is null && gap.Segments[^1].Points[^1].HeartRateBpm is null,
            "gap-separated track and invalid optional telemetry omission");
        var beforeBad = ride.ActiveSeconds;
        foreach (double invalid in new[] { double.NaN, double.PositiveInfinity, -1, 0 }) ride.Record(start.AddSeconds(3714), invalid, 29686, 100, 80, 140, true);
        ride.Record(start.AddSeconds(3715), 1, 29686, null, 80, 140, true);
        Near(ride.ActiveSeconds, beforeBad, "invalid durations and missing power are ignored");
        ride.Complete();
        ride.Resume(start.AddSeconds(3800), 30000); ride.Record(start.AddSeconds(3801), 1, 30006, 400, 90, 150, true);
        Check(ride.Snapshot()!.IsComplete, "completion is permanent");
        Near(ride.ActiveSeconds, beforeBad, "completed activities cannot accrue more work");

        var first = new RideActivityRecorder("test", "Start alignment", start, 0);
        first.Record(start.AddSeconds(.04), .1, .1, 100, 70, null, true);
        Near(first.ActiveSeconds, .04, "timer fraction before Start completes is excluded");
        Near(first.MechanicalWorkJoules, 4, "first power interval clipped to actual start");
        first.Record(start.AddSeconds(.03), .1, .2, 100, 70, null, true);
        Near(first.MechanicalWorkJoules, 4, "clock reversal cannot add work");

        var limited = new RideActivityRecorder("test", "Bounded recording", start, 0, pointLimit: 5, segmentLimit: 2);
        for (int i = 1; i <= 20; i++) limited.Record(start.AddSeconds(i), 1, i, 200, 80, null, true);
        var capped = limited.Snapshot()!;
        Check(capped.SampleLimitReached && capped.Segments.Sum(s => s.Points.Count) <= 5, "point budget is bounded and explicitly flagged");
        Near(capped.MechanicalWorkJoules, 4000, "energy still accumulates after sample limit");
        var segmentLimited = new RideActivityRecorder("test", "Segment limit", start, 0, segmentLimit: 2);
        for (int i = 0; i < 10; i++)
        {
            segmentLimited.Resume(start.AddSeconds(i * 3), i);
            segmentLimited.Record(start.AddSeconds(i * 3 + 1), 1, i + 1, 100, 80, null, true);
            segmentLimited.Pause();
        }
        Check(segmentLimited.Snapshot()!.SampleLimitReached && segmentLimited.Snapshot()!.Segments.Count == 2, "pause count cannot grow memory without bound");
        foreach (double invalid in new[] { double.NaN, double.PositiveInfinity, -10d }) Near(RideEnergy.EstimatedCalories(invalid), 0, "invalid work cannot produce invalid calorie display");
    }
}
