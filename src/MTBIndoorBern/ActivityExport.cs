using System.Globalization;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace MTBIndoorBern;

// TCX is deliberately an indoor record: simulator coordinates are not outdoor GPS.
internal static class ActivityExport
{
    public const long MaximumUploadBytes = 25_000_000;
    public const string UploadUrl = "https://www.strava.com/upload/select";
    internal const string TcxNamespace = "http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2";
    internal const string ExtensionNamespace = "http://www.garmin.com/xmlschemas/ActivityExtension/v2";
    private static readonly XNamespace Tcx = TcxNamespace, Extension = ExtensionNamespace;

    public static bool CanExport(RideActivity? activity) => activity is { IsRealRide: true, SampleLimitReached: false, ActiveSeconds: > 0 }
        && activity.Segments is not null && activity.Segments.All(s => s is not null && s.Points is not null)
        && activity.Segments.Sum(s => s.Points.Count) >= 2;

    public static string SuggestedFileName(RideActivity activity)
    {
        ActivityValidation.Validate(activity);
        // Course names are user-visible labels, not path components.
        return $"MTB-Indoor-{activity.StartedUtc.UtcDateTime:yyyy-MM-dd-HHmmss}-{Guid.Parse(activity.Id):N}.tcx";
    }

    public static void WriteTcx(RideActivity activity, string path)
    {
        byte[] data = ToTcxBytes(activity);
        ActivityFiles.WriteAtomic(path, data, keepBackup: false);
    }

    internal static byte[] ToTcxBytes(RideActivity activity)
    {
        ActivityValidation.Validate(activity);
        if (activity.SampleLimitReached)
            throw new InvalidDataException("This ride reached the recording limit. Its incomplete sample stream cannot be exported to Strava.");
        if (!CanExport(activity))
            throw new InvalidDataException("Record a real trainer ride before exporting. Demo and practice sessions are not workout records.");
        if (activity.EstimatedCalories > ushort.MaxValue)
            throw new InvalidDataException("The calorie total is larger than the TCX format supports.");

        var lap = new XElement(Tcx + "Lap", new XAttribute("StartTime", Utc(activity.StartedUtc)),
            new XElement(Tcx + "TotalTimeSeconds", Number(activity.ActiveSeconds)),
            new XElement(Tcx + "DistanceMeters", Number(activity.DistanceMeters)),
            new XElement(Tcx + "Calories", (int)Math.Round(activity.EstimatedCalories, MidpointRounding.AwayFromZero)),
            new XElement(Tcx + "Intensity", "Active"),
            new XElement(Tcx + "TriggerMethod", "Manual"));
        foreach (var segment in activity.Segments.Where(s => s.Points.Count > 0))
        {
            var track = new XElement(Tcx + "Track");
            foreach (var point in segment.Points)
            {
                var trackpoint = new XElement(Tcx + "Trackpoint",
                    new XElement(Tcx + "Time", Utc(point.TimeUtc)),
                    new XElement(Tcx + "DistanceMeters", Number(point.DistanceMeters)));
                if (point.HeartRateBpm is int heartRate)
                    trackpoint.Add(new XElement(Tcx + "HeartRateBpm", new XElement(Tcx + "Value", heartRate)));
                if (point.CadenceRpm is double cadence)
                    trackpoint.Add(new XElement(Tcx + "Cadence", (int)Math.Round(cadence, MidpointRounding.AwayFromZero)));
                if (point.PowerWatts is int watts)
                    trackpoint.Add(new XElement(Tcx + "Extensions", new XElement(Extension + "TPX",
                        new XAttribute("CadenceSensor", "Bike"), new XElement(Extension + "Watts", watts))));
                track.Add(trackpoint);
            }
            lap.Add(track);
        }
        var notes = $"MTB Indoor - Bern · {activity.CourseName}. Indoor trainer ride. Distance is simulated; no GPS or outdoor elevation is recorded. "
            + "Estimated calories use measured mechanical work and an assumed 24% cycling efficiency. "
            + (activity.IsComplete ? "Completed recording." : "Saved checkpoint; the recording may have ended unexpectedly.");
        XNamespace xsi = "http://www.w3.org/2001/XMLSchema-instance";
        var document = new XDocument(new XDeclaration("1.0", "utf-8", null),
            new XElement(Tcx + "TrainingCenterDatabase", new XAttribute(XNamespace.Xmlns + "xsi", xsi),
                new XAttribute(XNamespace.Xmlns + "ae", Extension),
                new XAttribute(xsi + "schemaLocation", TcxNamespace + " https://www8.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd "
                    + ExtensionNamespace + " https://www8.garmin.com/xmlschemas/ActivityExtensionv2.xsd"),
                new XElement(Tcx + "Activities", new XElement(Tcx + "Activity", new XAttribute("Sport", "Biking"),
                    new XElement(Tcx + "Id", Utc(activity.StartedUtc)), lap, new XElement(Tcx + "Notes", notes)))));
        using var stream = new MemoryStream();
        using (var writer = XmlWriter.Create(stream, new XmlWriterSettings { Encoding = new UTF8Encoding(false), Indent = false, CloseOutput = false }))
            document.Save(writer);
        if (stream.Length > MaximumUploadBytes)
            throw new InvalidDataException("This TCX exceeds Strava's 25 MB file-upload limit. The local ride record is still saved.");
        return stream.ToArray();
    }

    private static string Number(double value) => value.ToString("0.#########", CultureInfo.InvariantCulture);
    private static string Utc(DateTimeOffset time) => time.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", CultureInfo.InvariantCulture);
}

// Shared validation for local persistence and export. Loading an edited/corrupt
// file must not introduce invented samples or non-finite activity totals.
internal static class ActivityValidation
{
    public static void Validate(RideActivity activity)
    {
        if (activity is null || !activity.IsRealRide || !Guid.TryParse(activity.Id, out _) ||
            string.IsNullOrWhiteSpace(activity.CourseId) || activity.CourseId.Length > 100 ||
            string.IsNullOrWhiteSpace(activity.CourseName) || activity.CourseName.Length > 240 ||
            activity.StartedUtc == default || activity.EndedUtc < activity.StartedUtc ||
            !Nonnegative(activity.ActiveSeconds) || !Nonnegative(activity.DistanceMeters) || !Nonnegative(activity.MechanicalWorkJoules) ||
            activity.Segments is null || activity.Segments.Count > 1024)
            throw new InvalidDataException("The saved activity is not a valid real trainer ride.");
        int count = 0;
        double previousDistance = 0, previousActive = 0;
        DateTimeOffset previousEnd = activity.StartedUtc;
        foreach (var segment in activity.Segments)
        {
            if (segment is null || segment.Points is null || segment.StartedUtc < previousEnd || segment.EndedUtc < segment.StartedUtc ||
                segment.EndedUtc > activity.EndedUtc || !Nonnegative(segment.ActiveSeconds) ||
                !Nonnegative(segment.DistanceMeters) || !Nonnegative(segment.MechanicalWorkJoules))
                throw new InvalidDataException("The saved activity contains an invalid recording segment.");
            DateTimeOffset? previousTime = null;
            foreach (var point in segment.Points)
            {
                if (++count > 100_000 || point is null || point.TimeUtc < segment.StartedUtc || point.TimeUtc > segment.EndedUtc ||
                    previousTime is { } prior && point.TimeUtc <= prior ||
                    !Nonnegative(point.ActiveSeconds) || point.ActiveSeconds + .000001 < previousActive || point.ActiveSeconds > activity.ActiveSeconds + .000001 ||
                    !Nonnegative(point.DistanceMeters) || point.DistanceMeters + .000001 < previousDistance || point.DistanceMeters > activity.DistanceMeters + .000001 ||
                    point.PowerWatts is < 0 or > ushort.MaxValue || point.HeartRateBpm is < 1 or > byte.MaxValue ||
                    point.CadenceRpm is double cadence && (!double.IsFinite(cadence) || cadence < 0 || cadence > 254))
                    throw new InvalidDataException("The saved activity contains an invalid or out-of-order sample.");
                previousTime = point.TimeUtc; previousDistance = point.DistanceMeters; previousActive = point.ActiveSeconds;
            }
            previousEnd = segment.EndedUtc;
        }
    }
    private static bool Nonnegative(double value) => double.IsFinite(value) && value >= 0;
}

internal static class ActivityFiles
{
    public static void WriteAtomic(string path, byte[] data, bool keepBackup)
    {
        var destination = Path.GetFullPath(path);
        var folder = Path.GetDirectoryName(destination) ?? throw new IOException("Choose a folder for the activity file.");
        Directory.CreateDirectory(folder);
        var temporary = Path.Combine(folder, ".mtb-activity-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            { stream.Write(data); stream.Flush(flushToDisk: true); }
            if (File.Exists(destination)) File.Replace(temporary, destination, keepBackup ? destination + ".bak" : null);
            else File.Move(temporary, destination);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
