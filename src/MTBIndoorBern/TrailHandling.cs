using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MTBIndoorBern;

internal sealed record TrailCorner(double Distance, double Limit, int Direction, string Surface, double Width)
{
    public double Start => Distance - 14;
    public double End => Distance + 14;
}
internal sealed record DescentStage(string Id, string Name, double Start, double End);
internal sealed class TrailPlan
{
    public TrailCorner[] Corners { get; }
    public DescentStage? Stage { get; }
    public string RecordKey { get; }
    private readonly List<(double From,double To,string Surface,double Width)> surfaces = [];
    public string SurfaceAt(double distance)=>surfaces.FirstOrDefault(s=>distance>=s.From&&distance<s.To).Surface??"gravel";
    public TrailPlan(Course course, string? routeFile = null)
    {
        string appearance = routeFile is null ? "" : Path.Combine(Path.GetDirectoryName(routeFile)!, "appearance.json");
        if (File.Exists(appearance))
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(appearance));
            foreach (var s in doc.RootElement.GetProperty("segments").EnumerateArray())
                surfaces.Add((s.GetProperty("from").GetDouble(), s.GetProperty("to").GetDouble(), s.GetProperty("surface").GetString()!, s.GetProperty("width").GetDouble()));
        }
        var samples = new List<TrailCorner>();
        for (double d = 20; d < course.Length - 20; d += 5)
        {
            var a = course.At(d - 14); var b = course.At(d); var c = course.At(d + 14);
            double ux = b.X - a.X, uz = b.Z - a.Z, vx = c.X - b.X, vz = c.Z - b.Z;
            double cross = ux * vz - uz * vx;
            double denominator = Math.Sqrt((ux * ux + uz * uz) * (vx * vx + vz * vz) * (Math.Pow(c.X - a.X, 2) + Math.Pow(c.Z - a.Z, 2)));
            double curvature = denominator > .01 ? Math.Abs(2 * cross / denominator) : 0;
            var surface = surfaces.FirstOrDefault(s => d >= s.From && d < s.To);
            string kind = surface.Surface ?? "gravel"; double width = surface.Width > 0 ? surface.Width : 2;
            // Gameplay calibration, not surveyed grip or real-world speed advice.
            double grip = kind switch { "asphalt" => .46, "leaves" => .25, _ => .33 };
            double limit = Math.Clamp(Math.Sqrt(grip * 9.81 * Math.Clamp(width / 2, .8, 1.1) / Math.Max(curvature, .0001)), 12 / 3.6, 45 / 3.6);
            samples.Add(new(d, limit, Math.Sign(cross), kind, width));
        }
        var corners = new List<TrailCorner>();
        for (int i = 1; i < samples.Count - 1; i++)
        {
            var p = samples[i];
            if (p.Limit >= 38 / 3.6 || p.Limit > samples[i - 1].Limit || p.Limit >= samples[i + 1].Limit) continue;
            if (corners.Count > 0 && p.Distance - corners[^1].Distance < 42)
            { if (p.Limit < corners[^1].Limit) corners[^1] = p; }
            else corners.Add(p);
        }
        Corners = corners.ToArray();
        string handlingFile = routeFile is null ? "" : Path.Combine(Path.GetDirectoryName(routeFile)!, "handling.json");
        if (File.Exists(handlingFile))
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(handlingFile));
            var s = doc.RootElement.GetProperty("descent");
            var stage = new DescentStage(s.GetProperty("id").GetString()!, s.GetProperty("name").GetString()!, s.GetProperty("start").GetDouble(), s.GetProperty("end").GetDouble());
            if (stage.Start < 0 || stage.End > course.Length || stage.End <= stage.Start + 100) throw new InvalidDataException("Tram de baixada invàlid");
            Stage = stage;
        }
        string identity = JsonSerializer.Serialize(new { version = 2, course.Points, Corners, Stage });
        RecordKey = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity)))[..20];
    }
    public TrailCorner? At(double distance) => Corners.FirstOrDefault(c => distance >= c.Start && distance <= c.End);
    public TrailCorner? Next(double distance, double range = 140) => Corners.FirstOrDefault(c => c.End >= distance && c.Start <= distance + range);
    public object Snapshot() => new { type = "trail", corners = Corners.Select(c => new { distance = c.Distance, limit = c.Limit * 3.6, direction = c.Direction, surface = c.Surface, width = c.Width }),
        stage = Stage is null ? null : new { name = Stage.Name, start = Stage.Start, end = Stage.End } };
}

internal sealed class TrailHandling
{
    public double Brake { get; private set; }
    public double Slip { get; private set; }
    public double Recovery { get; private set; }
    public int OffTracks { get; private set; }
    public int Side { get; private set; } = 1;
    private double ignoreUntil = -1;
    public void Reset() { Brake = Slip = Recovery = 0; OffTracks = 0; ignoreUntil = -1; }
    public void Release() { Brake = 0; }
    public double Step(double speed, double watts, double grade, double weight, bool pressed, TrailCorner? corner, double distance, double dt, BikeProfile? bike=null, string surface="gravel")
    {
        Brake = Math.Clamp(Brake + (pressed ? dt * 5 : -dt * 9), 0, 1);
        if (Recovery > 0) { Recovery = Math.Max(0, Recovery - dt); Slip = 0; return 0; }
        speed = Math.Max(0, BikeDynamics.Speed(speed, watts, grade, weight, dt,bike??new(),surface) - Brake * 5.5 * dt);
        double excess = corner is not null && distance > ignoreUntil ? Math.Max(0, Math.Pow(speed / corner.Limit, 2) - 1.08) : 0;
        Slip = Math.Clamp(Slip + (excess > 0 ? excess * 1.6 : -1.8) * dt, 0, 1);
        if (excess > 0)
        {
            Side = corner!.Direction == 0 ? 1 : -corner.Direction;
            speed = Math.Max(0, speed - Math.Min(2, excess * .7) * dt);
            if (Slip >= 1) { Recovery = 3; OffTracks++; ignoreUntil = corner.End + 3; return 0; }
        }
        return speed;
    }
}

internal sealed class PersonalRecords
{
    private readonly string? file;
    private Dictionary<string, double> times = [];
    public string? Warning { get; private set; }
    public PersonalRecords(string? file)
    {
        this.file = file;
        try { if (file is not null && File.Exists(file)) times = JsonSerializer.Deserialize<Dictionary<string, double>>(File.ReadAllText(file)) ?? []; }
        catch { Warning = "No s’han pogut llegir els rècords locals."; }
    }
    public double? Best(string key) => times.TryGetValue(key, out double t) && double.IsFinite(t) && t > 0 ? t : null;
    public bool Submit(string key, double seconds)
    {
        if (!double.IsFinite(seconds) || seconds <= 0 || (Best(key) is double best && seconds >= best)) return false;
        times[key] = seconds;
        try { if (file is not null) { File.WriteAllText(file + ".tmp", JsonSerializer.Serialize(times)); File.Move(file + ".tmp", file, true); } }
        catch { Warning = "Rècord d’aquesta sessió; no s’ha pogut desar al disc."; }
        return true;
    }
}

internal sealed class DescentTimer
{
    private readonly DescentStage? stage;
    private readonly PersonalRecords records;
    private readonly string key;
    public string Status { get; private set; } = "waiting";
    public double Seconds { get; private set; }
    public bool Eligible { get; private set; }
    public bool NewBest { get; private set; }
    private int initialOffTracks;
    public double? Best => records.Best(key);
    public DescentTimer(TrailPlan plan, PersonalRecords records) { stage = plan.Stage; key = plan.RecordKey; this.records = records; }
    public void Reset() { Status = "waiting"; Seconds = 0; Eligible = NewBest = false; initialOffTracks = 0; }
    public void Invalidate() { Eligible = false; }
    public void Tick(double from, double to, double dt, bool live, int offTracks = 0)
    {
        if (stage is null || Status == "finished") return;
        double fraction = 1;
        if (Status == "waiting")
        {
            if (from >= stage.Start || to < stage.Start) return;
            Status = "running"; Eligible = live;
            initialOffTracks = offTracks;
            fraction = (to - stage.Start) / Math.Max(.000001, to - from);
        }
        if (Status != "running") return;
        if (!live) Eligible = false;
        if (to >= stage.End)
        {
            fraction -= Math.Clamp((to - stage.End) / Math.Max(.000001, to - from), 0, 1);
            Seconds += dt * Math.Max(0, fraction); Status = "finished";
            if (Eligible) NewBest = records.Submit(key, Seconds);
        }
        else Seconds += dt * fraction;
    }
    public object Snapshot(double distance, int offTracks) => new { name = stage?.Name, status = Status, seconds = Seconds, eligible = Eligible, newBest = NewBest, best = Best,
        remaining = stage is null ? 0 : Math.Max(0, (Status == "waiting" ? stage.Start : stage.End) - distance), offTracks = Status == "waiting" ? 0 : Math.Max(0, offTracks - initialOffTracks), warning = records.Warning };
}
