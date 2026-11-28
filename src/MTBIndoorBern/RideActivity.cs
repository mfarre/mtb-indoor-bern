namespace MTBIndoorBern;

// No geographic coordinates are recorded. Distance is the simulator's virtual
// distance; power, cadence and heart rate are measured trainer/sensor values.
internal sealed record RideActivityPoint
{
    public DateTimeOffset TimeUtc { get; init; }
    public double ActiveSeconds { get; init; }
    public double DistanceMeters { get; init; }
    public int? PowerWatts { get; init; }
    public double? CadenceRpm { get; init; }
    public int? HeartRateBpm { get; init; }
}

internal sealed record RideActivitySegment
{
    public DateTimeOffset StartedUtc { get; init; }
    public DateTimeOffset EndedUtc { get; init; }
    public double ActiveSeconds { get; init; }
    public double DistanceMeters { get; init; }
    public double MechanicalWorkJoules { get; init; }
    public IReadOnlyList<RideActivityPoint> Points { get; init; } = [];
}

internal sealed record RideActivity
{
    public string Id { get; init; } = "";
    public string CourseId { get; init; } = "";
    public string CourseName { get; init; } = "";
    public DateTimeOffset StartedUtc { get; init; }
    public DateTimeOffset EndedUtc { get; init; }
    public bool IsComplete { get; init; }
    public bool IsRealRide { get; init; }
    public double ActiveSeconds { get; init; }
    public double DistanceMeters { get; init; }
    public double MechanicalWorkJoules { get; init; }
    public double EstimatedCalories => RideEnergy.EstimatedCalories(MechanicalWorkJoules);
    public bool SampleLimitReached { get; init; }
    public IReadOnlyList<RideActivitySegment> Segments { get; init; } = [];
}

internal static class RideEnergy
{
    public const double AssumedEfficiency = .24;
    public const double JoulesPerKilocalorie = 4184;
    public static double EstimatedCalories(double mechanicalJoules) =>
        double.IsFinite(mechanicalJoules) && mechanicalJoules > 0
            ? mechanicalJoules / (JoulesPerKilocalorie * AssumedEfficiency) : 0;
}

// The recorder is separate from motion/control physics. All inputs are supplied
// by the host after it has accepted a fresh, real trainer interval. It never
// reads sensors, writes files or performs network operations.
internal sealed class RideActivityRecorder
{
    public const int MaximumPoints = 72000;
    public const int MaximumSegments = 1024;
    public const double MaximumIntervalSeconds = 1;
    private readonly string id = Guid.NewGuid().ToString("N"), courseId, courseName;
    private readonly DateTimeOffset startedUtc;
    private readonly List<RideActivitySegment> segments = [];
    private readonly int pointLimit, segmentLimit;
    private List<RideActivityPoint>? points;
    private RideActivityPoint? latest;
    private DateTimeOffset pendingStartUtc, segmentStartUtc, lastUtc, lastRecordedUtc;
    private double segmentStartSeconds, segmentStartDistance, segmentStartWork, previousRouteDistance, nextSampleAt;
    private bool accepting = true;
    private int storedPoints;
    public bool IsComplete { get; private set; }
    public bool SampleLimitReached { get; private set; }
    public double ActiveSeconds { get; private set; }
    public double DistanceMeters { get; private set; }
    public double MechanicalWorkJoules { get; private set; }
    public double EstimatedCalories => RideEnergy.EstimatedCalories(MechanicalWorkJoules);
    public string Id => id;

    public RideActivityRecorder(string courseId, string courseName, DateTimeOffset startedUtc, double startRouteDistance,
        int pointLimit = MaximumPoints, int segmentLimit = MaximumSegments)
    {
        if (!double.IsFinite(startRouteDistance) || startRouteDistance < 0) throw new ArgumentOutOfRangeException(nameof(startRouteDistance));
        if (pointLimit < 2 || segmentLimit < 1) throw new ArgumentOutOfRangeException(nameof(pointLimit));
        this.courseId = courseId; this.courseName = courseName;
        this.startedUtc = pendingStartUtc = lastUtc = lastRecordedUtc = startedUtc.ToUniversalTime();
        previousRouteDistance = startRouteDistance;
        this.pointLimit = Math.Min(MaximumPoints, pointLimit); this.segmentLimit = Math.Min(MaximumSegments, segmentLimit);
    }

    public void Resume(DateTimeOffset utcNow, double routeDistance)
    {
        if (IsComplete) return;
        if (!double.IsFinite(routeDistance) || routeDistance < 0) return;
        pendingStartUtc = utcNow.ToUniversalTime() < lastUtc ? lastUtc : utcNow.ToUniversalTime();
        previousRouteDistance = routeDistance;
        accepting = true;
    }

    public void Record(DateTimeOffset utcNow, double seconds, double routeDistance, int? powerWatts,
        double? cadenceRpm, int? heartRateBpm, bool validLiveSample)
    {
        if (!accepting || IsComplete) return;
        utcNow = utcNow.ToUniversalTime();
        if (!validLiveSample || !double.IsFinite(seconds) || seconds <= 0 || seconds > MaximumIntervalSeconds ||
            !double.IsFinite(routeDistance) || routeDistance < previousRouteDistance || powerWatts is null or < 0 or > 5000 || utcNow <= lastUtc)
        {
            // Do not bridge pauses, stale packets, clock reversals or a delayed UI
            // tick with invented power. A later fresh interval starts a new track.
            CloseSegment();
            if (double.IsFinite(routeDistance) && routeDistance >= 0) previousRouteDistance = routeDistance;
            if (utcNow > lastUtc) { lastUtc = utcNow; pendingStartUtc = utcNow; }
            return;
        }
        // The first timer interval may have begun before Start/Resume completed.
        // Never credit that pre-start fraction or more time than UTC advanced.
        var intervalStart = points is null && pendingStartUtc > lastUtc ? pendingStartUtc : lastUtc;
        seconds = Math.Min(seconds, (utcNow - intervalStart).TotalSeconds);
        if (seconds <= 0) return;
        if (points is not null && (utcNow - lastUtc).TotalSeconds > MaximumIntervalSeconds + .25)
        {
            CloseSegment(); pendingStartUtc = utcNow.AddSeconds(-seconds);
        }
        if (points is null && !SampleLimitReached)
        {
            if (segments.Count >= segmentLimit || storedPoints + 2 > pointLimit) SampleLimitReached = true;
            else
            {
                segmentStartUtc = utcNow.AddSeconds(-seconds);
                if (segmentStartUtc < pendingStartUtc) segmentStartUtc = pendingStartUtc;
                if (segmentStartUtc < lastUtc) segmentStartUtc = lastUtc;
                segmentStartSeconds = ActiveSeconds; segmentStartDistance = DistanceMeters; segmentStartWork = MechanicalWorkJoules;
                points = [Point(segmentStartUtc, powerWatts, cadenceRpm, heartRateBpm)];
                nextSampleAt = ActiveSeconds + 1;
            }
        }
        ActiveSeconds += seconds;
        DistanceMeters += routeDistance - previousRouteDistance;
        MechanicalWorkJoules += powerWatts.Value * seconds;
        previousRouteDistance = routeDistance; lastUtc = lastRecordedUtc = utcNow;
        latest = Point(utcNow, powerWatts, cadenceRpm, heartRateBpm);
        if (points is not null && ActiveSeconds + .000001 >= nextSampleAt)
        {
            // Always reserve one endpoint. Once the bounded recording is full,
            // totals remain usable in the UI but export must report truncation.
            if (storedPoints + points.Count + 2 > pointLimit) SampleLimitReached = true;
            else { points.Add(latest); nextSampleAt = ActiveSeconds + 1; }
        }
    }

    private RideActivityPoint Point(DateTimeOffset utc, int? watts, double? cadence, int? heart) => new()
    {
        TimeUtc = utc, ActiveSeconds = ActiveSeconds, DistanceMeters = DistanceMeters, PowerWatts = watts,
        CadenceRpm = cadence is >= 0 and <= 254 && double.IsFinite(cadence.Value) ? cadence : null,
        HeartRateBpm = heart is > 0 and <= 255 ? heart : null
    };

    public void Pause() { CloseSegment(); accepting = false; }
    public void Complete() { if (IsComplete) return; Pause(); IsComplete = true; }

    private RideActivitySegment? SegmentSnapshot()
    {
        if (points is null || latest is null || ActiveSeconds <= segmentStartSeconds) return null;
        var copy = new List<RideActivityPoint>(points);
        if (latest.TimeUtc > copy[^1].TimeUtc) copy.Add(latest);
        else if (copy.Count == 1) return null;
        else copy[^1] = latest;
        return new() { StartedUtc = segmentStartUtc, EndedUtc = latest.TimeUtc, ActiveSeconds = ActiveSeconds - segmentStartSeconds,
            DistanceMeters = DistanceMeters - segmentStartDistance, MechanicalWorkJoules = MechanicalWorkJoules - segmentStartWork, Points = copy.ToArray() };
    }

    private void CloseSegment()
    {
        var segment = SegmentSnapshot();
        if (segment is not null) { segments.Add(segment); storedPoints += segment.Points.Count; }
        points = null; latest = null;
    }

    public RideActivity? Snapshot()
    {
        if (ActiveSeconds <= 0) return null;
        var all = new List<RideActivitySegment>(segments);
        if (SegmentSnapshot() is { } open) all.Add(open);
        // Segment records and point records are immutable; detach every array so
        // neither persistence nor a caller can mutate the running recorder.
        var detached = all.Select(s => s with { Points = s.Points.ToArray() }).ToArray();
        return new() { Id = id, CourseId = courseId, CourseName = courseName, StartedUtc = startedUtc, EndedUtc = lastRecordedUtc,
            IsComplete = IsComplete, IsRealRide = true, ActiveSeconds = ActiveSeconds, DistanceMeters = DistanceMeters,
            MechanicalWorkJoules = MechanicalWorkJoules, SampleLimitReached = SampleLimitReached, Segments = detached };
    }
}
