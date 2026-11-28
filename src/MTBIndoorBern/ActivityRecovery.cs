namespace MTBIndoorBern;

// Retain immutable snapshots while a local save is pending or has failed. A
// reset/course change may dispose its recorder before disk becomes available.
internal sealed class ActivityRecovery
{
    private readonly object gate = new();
    private readonly Dictionary<string, RideActivity> pending = new(StringComparer.Ordinal);

    public void Remember(RideActivity activity)
    {
        if (activity is null || string.IsNullOrWhiteSpace(activity.Id) || !activity.IsRealRide) return;
        lock (gate)
        {
            if (pending.TryGetValue(activity.Id, out var previous) &&
                (previous.IsComplete && !activity.IsComplete || previous.ActiveSeconds > activity.ActiveSeconds || previous.EndedUtc > activity.EndedUtc)) return;
            pending[activity.Id] = activity;
        }
    }

    public void Saved(RideActivity activity)
    {
        lock (gate)
        {
            // An earlier checkpoint completing its write must not evict a newer
            // snapshot queued while the disk operation was in flight.
            if (pending.TryGetValue(activity.Id, out var current) && ReferenceEquals(current, activity)) pending.Remove(activity.Id);
        }
    }

    public RideActivity? Find(string id) { lock (gate) return pending.GetValueOrDefault(id); }
    public IReadOnlyList<RideActivity> Snapshot() { lock (gate) return pending.Values.ToArray(); }
}

internal static class ActivityRecoveryTests
{
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    public static void Verify()
    {
        var recovery = new ActivityRecovery();
        var start = new DateTimeOffset(2026, 1, 2, 9, 0, 0, TimeSpan.Zero);
        var early = new RideActivity { Id = Guid.NewGuid().ToString("N"), IsRealRide = true, StartedUtc = start, EndedUtc = start.AddSeconds(30), ActiveSeconds = 30 };
        var later = early with { EndedUtc = start.AddSeconds(60), ActiveSeconds = 60 };
        var complete = later with { IsComplete = true };
        recovery.Remember(early); recovery.Remember(later); recovery.Saved(early);
        Check(ReferenceEquals(recovery.Find(early.Id), later), "An older successful checkpoint cannot evict newer unsaved data");
        recovery.Remember(complete); recovery.Remember(early); recovery.Remember(later);
        Check(ReferenceEquals(recovery.Find(early.Id), complete), "A late partial snapshot cannot replace a completed unsaved ride");
        // The old recorder is now gone; a different course/session is active.
        var nextRide = early with { Id = Guid.NewGuid().ToString("N"), StartedUtc = start.AddDays(1), EndedUtc = start.AddDays(1).AddSeconds(30) };
        recovery.Remember(nextRide); recovery.Saved(nextRide);
        Check(recovery.Snapshot().Count == 1 && ReferenceEquals(recovery.Find(early.Id), complete), "Saving a new session does not discard the failed previous ride");
        recovery.Saved(later);
        Check(recovery.Find(early.Id) is not null, "A late partial write cannot mark a final recording saved");
        recovery.Saved(complete);
        Check(recovery.Snapshot().Count == 0, "Only successful persistence of the retained snapshot clears recovery");
        recovery.Remember(early with { IsRealRide = false });
        Check(recovery.Snapshot().Count == 0, "Synthetic sessions are not retained as real recordings");

        var folder = Path.Combine(Path.GetTempPath(), "mtb-activity-recovery-tests-" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(folder);
            var blockedFolder = Path.Combine(folder, "not-a-directory");
            File.WriteAllText(blockedFolder, "Existing file must survive");
            var fixture = ActivityExportTests.Fixture();
            recovery.Remember(fixture);
            var failed = false;
            try { new ActivityStore(blockedFolder).Save(fixture); recovery.Saved(fixture); }
            catch (IOException) { failed = true; }
            Check(failed && ReferenceEquals(recovery.Find(fixture.Id), fixture), "A real storage failure retains the complete ride after its recorder is gone");
            var exportPath = Path.Combine(folder, "recovered.tcx");
            ActivityExport.WriteTcx(recovery.Find(fixture.Id)!, exportPath);
            Check(File.Exists(exportPath) && File.ReadAllText(blockedFolder) == "Existing file must survive", "The retained ride can be exported elsewhere without changing the blocked storage location");
            var retryStore = new ActivityStore(Path.Combine(folder, "available"));
            retryStore.Save(fixture); recovery.Saved(fixture);
            Check(recovery.Snapshot().Count == 0 && retryStore.Load(fixture.Id)?.IsComplete == true, "A successful retry persists the ride before clearing memory recovery");
        }
        finally
        {
            var temporaryRoot = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (Path.GetFullPath(folder).StartsWith(temporaryRoot, StringComparison.OrdinalIgnoreCase) && Path.GetFileName(folder).StartsWith("mtb-activity-recovery-tests-", StringComparison.Ordinal) && Directory.Exists(folder))
                Directory.Delete(folder, recursive: true);
        }
    }
}
