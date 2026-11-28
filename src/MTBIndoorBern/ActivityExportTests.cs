using System.Globalization;
using System.Xml.Linq;

namespace MTBIndoorBern;

internal static class ActivityExportTests
{
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static void Reject(Action action, string message)
    {
        try { action(); } catch (Exception e) when (e is InvalidDataException or ArgumentException) { return; }
        throw new Exception(message);
    }

    // Invented data for format checks only. Never automatically uploaded.
    internal static RideActivity Fixture()
    {
        var start = new DateTimeOffset(2026, 1, 2, 10, 0, 0, TimeSpan.FromHours(1));
        RideActivityPoint Point(int seconds, double active, double distance, int? watts, double? cadence, int? heart) => new()
        { TimeUtc = start.AddSeconds(seconds), ActiveSeconds = active, DistanceMeters = distance, PowerWatts = watts, CadenceRpm = cadence, HeartRateBpm = heart };
        return new RideActivity
        {
            Id = "b7d058260ec144a49a752f21f350cfb6", CourseId = "test-only", CourseName = "TEST ONLY · Pine & \"Birch\"",
            StartedUtc = start, EndedUtc = start.AddSeconds(32), IsComplete = true, IsRealRide = true,
            ActiveSeconds = 4, DistanceMeters = 24.5, MechanicalWorkJoules = 800,
            Segments =
            [
                new() { StartedUtc = start, EndedUtc = start.AddSeconds(2), ActiveSeconds = 2, DistanceMeters = 12.25, MechanicalWorkJoules = 400,
                    Points = [Point(0, 0, 0, 200, 82.5, 140), Point(1, 1, 6.125, 200, null, null), Point(2, 2, 12.25, 0, 0, 138)] },
                new() { StartedUtc = start.AddSeconds(30), EndedUtc = start.AddSeconds(32), ActiveSeconds = 2, DistanceMeters = 12.25, MechanicalWorkJoules = 400,
                    Points = [Point(30, 2, 12.25, 200, 85, 139), Point(31, 3, 18.375, null, null, null), Point(32, 4, 24.5, 200, 85, 141)] }
            ]
        };
    }

    public static void Verify()
    {
        var activity = Fixture();
        var originalCulture = CultureInfo.CurrentCulture;
        byte[] bytes;
        try { CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("ca-ES"); bytes = ActivityExport.ToTcxBytes(activity); }
        finally { CultureInfo.CurrentCulture = originalCulture; }
        using var stream = new MemoryStream(bytes);
        var document = XDocument.Load(stream);
        XNamespace tcx = ActivityExport.TcxNamespace, extension = ActivityExport.ExtensionNamespace;
        var recorded = document.Descendants(tcx + "Activity").Single();
        Check((string?)recorded.Attribute("Sport") == "Biking", "TCX is a cycling activity");
        Check((string?)recorded.Element(tcx + "Id") == "2026-01-02T09:00:00.0000000Z", "Activity ID uses original start in UTC");
        var lap = recorded.Element(tcx + "Lap")!;
        Check((string?)lap.Element(tcx + "TotalTimeSeconds") == "4" && (string?)lap.Element(tcx + "DistanceMeters") == "24.5", "TCX uses active time and virtual distance with invariant decimals");
        Check((int?)lap.Element(tcx + "Calories") == 1, "TCX calorie estimate uses rounded kilocalories");
        Check(lap.Elements(tcx + "Track").Count() == 2, "Pause creates a separate track, not invented interpolated points");
        var points = document.Descendants(tcx + "Trackpoint").ToArray();
        Check(points.Length == 6 && (string?)points[3].Element(tcx + "Time") == "2026-01-02T09:00:30.0000000Z", "Actual timestamp gap is retained");
        Check(points[1].Element(tcx + "HeartRateBpm") is null && points[1].Element(tcx + "Cadence") is null && points[4].Element(tcx + "Extensions") is null, "Missing sensor samples are omitted, not filled with zero or old values");
        Check((int?)points[2].Descendants(extension + "Watts").Single() == 0 && (int?)points[2].Element(tcx + "Cadence") == 0, "Measured zero coasting values remain zero");
        Check((int?)points[0].Element(tcx + "Cadence") == 83, "Measured cadence rounds to TCX integer units");
        Check(!document.Descendants(tcx + "Position").Any() && !document.Descendants(tcx + "AltitudeMeters").Any(), "Indoor activity contains no invented outdoor GPS or elevation");
        Check(((string?)recorded.Element(tcx + "Notes"))!.Contains(activity.CourseName, StringComparison.Ordinal), "Course label is XML escaped and round-trips");
        Check(ActivityExport.SuggestedFileName(activity).EndsWith("-" + activity.Id + ".tcx", StringComparison.Ordinal) && !ActivityExport.SuggestedFileName(activity).Contains("Birch"), "Export filename cannot inherit course path characters");
        Reject(() => ActivityExport.ToTcxBytes(activity with { IsRealRide = false }), "Reject simulated workouts");
        Reject(() => ActivityExport.ToTcxBytes(activity with { SampleLimitReached = true }), "Reject truncated recording exports");
        Reject(() => ActivityExport.ToTcxBytes(activity with { MechanicalWorkJoules = double.NaN }), "Reject nonfinite data");
        Reject(() => ActivityExport.ToTcxBytes(activity with { Segments = [activity.Segments[0] with { Points = [activity.Segments[0].Points[0], activity.Segments[0].Points[0]] }] }), "Reject duplicate sample times");

        var recorder = new RideActivityRecorder("test-recorder", "TEST ONLY · recorder", activity.StartedUtc, 4000);
        recorder.Record(activity.StartedUtc.AddSeconds(1), 1, 4005, 180, 81, 140, true);
        recorder.Record(activity.StartedUtc.AddSeconds(2), 1, 4010, 180, 81, 141, true);
        recorder.Pause();
        recorder.Resume(activity.StartedUtc.AddSeconds(30), 4010);
        recorder.Record(activity.StartedUtc.AddSeconds(31), 1, 4015, 190, 83, null, true);
        recorder.Complete();
        var recorderSnapshot = recorder.Snapshot()!;
        ActivityValidation.Validate(recorderSnapshot);
        Check(recorderSnapshot.DistanceMeters == 15 && ActivityExport.ToTcxBytes(recorderSnapshot).Length > 0,
            "The actual recorder exports partial-route starts and pause/resume without geometry offsets");

        var folder = Path.Combine(Path.GetTempPath(), "mtb-activity-tests-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new ActivityStore(folder);
            Check(!Directory.Exists(folder), "Store construction does not touch disk");
            Check(store.LoadLatest() is null, "Empty store is usable");
            store.Save(activity with { IsComplete = false });
            store.Save(activity);
            store.Save(activity with { IsComplete = false });
            var loaded = store.Load(activity.Id)!;
            Check(loaded.IsComplete && loaded.Segments[1].Points[2].HeartRateBpm == 141, "Final recording survives a late checkpoint and JSON round-trip");
            var summary = store.ListRecent().Single();
            Check(summary.SampleCount == 6 && summary.MechanicalWorkJoules == 800 && summary.EstimatedCalories == activity.EstimatedCalories, "Activity list contains honest summary values");
            Reject(() => store.Load("../../settings"), "Activity ID cannot select arbitrary local files");
            var file = Directory.EnumerateFiles(folder, "*.json").Single();
            Check(File.Exists(file + ".bak"), "Atomic replacement retains previous checkpoint");
            File.WriteAllText(file, "{damaged");
            loaded = store.Load(activity.Id)!;
            Check(!loaded.IsComplete && store.LastReadWarning is not null, "Corrupt primary recovers the prior checkpoint with a visible warning");
            File.WriteAllText(file + ".bak", "{damaged backup");
            Check(store.ListRecent().Count == 0 && store.LastReadWarning is not null, "A corrupt recording is isolated without deleting it");
            Check(File.Exists(file) && File.Exists(file + ".bak"), "Corrupt originals remain available for recovery");
            var export = Path.Combine(folder, "chosen.tcx");
            File.WriteAllText(export, "existing file");
            Reject(() => ActivityExport.WriteTcx(activity with { IsRealRide = false }, export), "Failed export must not replace selected destination");
            Check(File.ReadAllText(export) == "existing file", "Rejected export preserves existing file");
            ActivityExport.WriteTcx(activity, export);
            Check(XDocument.Load(export).Descendants(tcx + "Trackpoint").Count() == 6, "Successful file export contains the recorded samples");
            Check(!Directory.EnumerateFiles(folder, "*.tmp").Any(), "Atomic operations leave no temporary files");
        }
        finally
        {
            var root = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (Path.GetFullPath(folder).StartsWith(root, StringComparison.OrdinalIgnoreCase) && Path.GetFileName(folder).StartsWith("mtb-activity-tests-", StringComparison.Ordinal) && Directory.Exists(folder))
                Directory.Delete(folder, recursive: true);
        }
    }
}
