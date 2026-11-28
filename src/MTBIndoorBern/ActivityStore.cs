using System.Text.Json;

namespace MTBIndoorBern;

internal sealed record ActivitySummary
{
    public string Id { get; init; } = "";
    public string CourseId { get; init; } = "";
    public string CourseName { get; init; } = "";
    public DateTimeOffset StartedUtc { get; init; }
    public DateTimeOffset EndedUtc { get; init; }
    public double ActiveSeconds { get; init; }
    public double DistanceMeters { get; init; }
    public double MechanicalWorkJoules { get; init; }
    public double EstimatedCalories { get; init; }
    public int SampleCount { get; init; }
    public bool IsComplete { get; init; }
    public bool SampleLimitReached { get; init; }

    internal static ActivitySummary From(RideActivity ride) => new()
    {
        Id = ride.Id, CourseId = ride.CourseId, CourseName = ride.CourseName,
        StartedUtc = ride.StartedUtc, EndedUtc = ride.EndedUtc, ActiveSeconds = ride.ActiveSeconds,
        DistanceMeters = ride.DistanceMeters, MechanicalWorkJoules = ride.MechanicalWorkJoules,
        EstimatedCalories = ride.EstimatedCalories, SampleCount = ride.Segments.Sum(s => s.Points.Count),
        IsComplete = ride.IsComplete, SampleLimitReached = ride.SampleLimitReached
    };
}

// Called through the host's background save queue. Files are private local
// workouts, never part of application assets or the public repository.
internal sealed class ActivityStore
{
    private const long MaximumLocalBytes = 64 * 1024 * 1024;
    private readonly object gate = new();
    private static readonly JsonSerializerOptions JsonOptions = new() { MaxDepth = 32 };
    public string Folder { get; }
    public string? LastReadWarning { get; private set; }
    public ActivityStore(string folder) => Folder = Path.GetFullPath(folder);

    public void Save(RideActivity activity)
    {
        ActivityValidation.Validate(activity);
        var data = JsonSerializer.SerializeToUtf8Bytes(activity, JsonOptions);
        if (data.LongLength > MaximumLocalBytes) throw new InvalidDataException("The activity exceeds the local recording-file limit.");
        lock (gate)
        {
            var path = FileFor(activity);
            // A late checkpoint cannot replace a final or newer snapshot.
            var existing = ReadFile(path, warn: false);
            if (existing is not null && (existing.IsComplete && !activity.IsComplete || existing.ActiveSeconds > activity.ActiveSeconds ||
                existing.EndedUtc > activity.EndedUtc)) return;
            ActivityFiles.WriteAtomic(path, data, keepBackup: true);
        }
    }

    public IReadOnlyList<ActivitySummary> ListRecent(int limit = 30)
    {
        lock (gate)
        {
            LastReadWarning = null;
            var result = new List<ActivitySummary>();
            if (!Directory.Exists(Folder)) return result;
            // Names begin with UTC start time, so only a bounded recent window
            // needs reading. Old records are retained, not automatically pruned.
            foreach (var file in Directory.EnumerateFiles(Folder, "*.json", SearchOption.TopDirectoryOnly)
                .OrderByDescending(Path.GetFileName, StringComparer.Ordinal).Take(Math.Clamp(limit, 1, 100) + 30))
            {
                var activity = ReadFile(file, warn: true);
                if (activity is not null) result.Add(ActivitySummary.From(activity));
                if (result.Count >= Math.Clamp(limit, 1, 100)) break;
            }
            return result;
        }
    }

    public RideActivity? LoadLatest()
    {
        var recent = ListRecent(1);
        var warning = LastReadWarning;
        var activity = recent.Count > 0 ? Load(recent[0].Id) : null;
        LastReadWarning ??= warning;
        return activity;
    }

    public RideActivity? Load(string id)
    {
        if (!Guid.TryParse(id, out var parsed)) throw new ArgumentException("Choose a saved activity.", nameof(id));
        lock (gate)
        {
            LastReadWarning = null;
            if (!Directory.Exists(Folder)) return null;
            var file = Directory.EnumerateFiles(Folder, "*-" + parsed.ToString("N") + ".json", SearchOption.TopDirectoryOnly)
                .OrderByDescending(Path.GetFileName, StringComparer.Ordinal).FirstOrDefault();
            return file is null ? null : ReadFile(file, warn: true);
        }
    }

    private string FileFor(RideActivity activity) => Path.Combine(Folder,
        $"{activity.StartedUtc.UtcDateTime:yyyyMMdd'T'HHmmssfff'Z'}-{Guid.Parse(activity.Id):N}.json");

    private RideActivity? ReadFile(string file, bool warn)
    {
        bool primaryExists = File.Exists(file), backupExists = File.Exists(file + ".bak");
        if (!primaryExists && !backupExists) return null;
        foreach (var candidate in new[] { file, file + ".bak" })
        {
            try
            {
                if (!File.Exists(candidate)) continue;
                if (new FileInfo(candidate).Length > MaximumLocalBytes) throw new InvalidDataException("Activity file is too large.");
                var activity = JsonSerializer.Deserialize<RideActivity>(File.ReadAllBytes(candidate), JsonOptions)
                    ?? throw new InvalidDataException("Activity file is empty.");
                ActivityValidation.Validate(activity);
                if (!Path.GetFileName(file).EndsWith("-" + Guid.Parse(activity.Id).ToString("N") + ".json", StringComparison.Ordinal))
                    throw new InvalidDataException("Activity file identity does not match its name.");
                if (candidate != file && warn) LastReadWarning = "A damaged activity file was recovered from its previous local checkpoint.";
                return activity;
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException or ArgumentException or InvalidOperationException)
            { /* Keep looking for the previous atomic checkpoint. */ }
        }
        if (warn) LastReadWarning = "A saved activity could not be read. Other activities remain available; the damaged file has been kept.";
        return null;
    }
}
