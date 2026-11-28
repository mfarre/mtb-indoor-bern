using System.Text.Json;

namespace MTBIndoorBern;

// Presentation is separate from the physical bike/calibration signature.
internal sealed class PresentationPreferences
{
    public double Volume { get; set; } = .35;
    public bool Muted { get; set; }
    public bool Immersive { get; set; }
    public bool StableCamera { get; set; } = true;
    public int TargetFps { get; set; } = 30;

    public PresentationPreferences Normalize()
    {
        Volume = double.IsFinite(Volume) ? Math.Clamp(Volume, 0, 1) : .35;
        TargetFps = TargetFps == 60 ? 60 : 30;
        return this;
    }

    public void ApplyPatch(JsonElement patch)
    {
        if (patch.ValueKind != JsonValueKind.Object) return;
        if (patch.TryGetProperty("volume", out var volume) && volume.ValueKind == JsonValueKind.Number && volume.TryGetDouble(out var v) && double.IsFinite(v)) Volume = v;
        if (patch.TryGetProperty("targetFps", out var fps) && fps.ValueKind == JsonValueKind.Number && fps.TryGetInt32(out var f)) TargetFps = f;
        if (patch.TryGetProperty("muted", out var muted) && muted.ValueKind is JsonValueKind.True or JsonValueKind.False) Muted = muted.GetBoolean();
        if (patch.TryGetProperty("immersive", out var immersive) && immersive.ValueKind is JsonValueKind.True or JsonValueKind.False) Immersive = immersive.GetBoolean();
        if (patch.TryGetProperty("stableCamera", out var stable) && stable.ValueKind is JsonValueKind.True or JsonValueKind.False) StableCamera = stable.GetBoolean();
        Normalize();
    }

    public object Snapshot() => new { volume = Volume, muted = Muted, immersive = Immersive, stableCamera = StableCamera, targetFps = TargetFps };

    public static void Verify()
    {
        string directory = Path.Combine(Path.GetTempPath(), "MtbPresentation-" + Guid.NewGuid().ToString("N"));
        string file = Path.Combine(directory, "settings.json");
        try
        {
            Directory.CreateDirectory(directory);
            File.WriteAllText(file, "{\"Version\":4,\"RiderKg\":83,\"Chainring\":30}");
            var store = new PreferencesStore(file);
            var settings = store.Data.Presentation;
            if (settings.Volume != .35 || settings.Muted || !settings.StableCamera || settings.Immersive || settings.TargetFps != 30) throw new Exception("Legacy presentation defaults");
            string signature = ProfileSettings.Signature(store.Data);
            settings.ApplyPatch(JsonSerializer.SerializeToElement(new { volume = 8, muted = true, targetFps = 60, immersive = true }));
            settings.ApplyPatch(JsonSerializer.SerializeToElement(new { stableCamera = false, riderKg = 140 }));
            if (settings.Volume != 1 || !settings.Muted || !settings.Immersive || settings.StableCamera || settings.TargetFps != 60 || store.Data.RiderKg != 83 || ProfileSettings.Signature(store.Data) != signature) throw new Exception("Presentation patch changed bike or reset unrelated fields");
            store.Save();
            var read = new PreferencesStore(file).Data.Presentation;
            if (read.Volume != 1 || !read.Muted || !read.Immersive || read.StableCamera || read.TargetFps != 60) throw new Exception("Presentation persistence");
            settings.Volume = double.NaN; settings.TargetFps = 144; settings.Normalize();
            if (settings.Volume != .35 || settings.TargetFps != 30) throw new Exception("Invalid presentation values");
            settings.ApplyPatch(JsonSerializer.SerializeToElement(new { volume = "invalid", muted = 1, stableCamera = "false" }));
            if (settings.Volume != .35 || !settings.Muted || settings.StableCamera) throw new Exception("Invalid presentation patch types");
            File.WriteAllText(file, "{\"Presentation\":null}");
            if (new PreferencesStore(file).Data.Presentation.Volume != .35) throw new Exception("Null presentation migration");
        }
        finally { if (File.Exists(file)) File.Delete(file); if (Directory.Exists(directory)) Directory.Delete(directory); }
    }
}
