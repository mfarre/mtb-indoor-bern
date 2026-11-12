using System.Text.Json;
using System.Text.Json.Serialization;

namespace MTBIndoorBern;

internal sealed record SavedSensor(SensorRole Role, ulong Address, string Name, byte? ZwiftType = null)
{
    public NearbyDevice? Find(IEnumerable<NearbyDevice> devices)
    {
        var candidates = devices.Where(d => d.Matches(Role)).ToArray();
        var exact = candidates.FirstOrDefault(d => Address != 0 && d.Address == Address);
        if (exact is not null) return exact;
        var named = candidates.Where(d => d.Name.Equals(Name, StringComparison.OrdinalIgnoreCase) &&
            (!ZwiftType.HasValue || d.ZwiftType == ZwiftType)).ToArray();
        return named.Length == 1 ? named[0] : null;
    }
}

internal sealed class Preferences
{
    public int Version { get; set; } = 2;
    public double RiderKg { get; set; } = 75;
    public double Difficulty { get; set; } = .5;
    public int Chainring { get; set; } = 32;
    public string CourseId { get; set; } = "al-dente";
    public List<SavedSensor> Sensors { get; set; } = [];
}

internal sealed class PreferencesStore
{
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true, Converters = { new JsonStringEnumConverter() } };
    public Preferences Data { get; private set; }
    public string FilePath { get; }
    public string? Warning { get; private set; }
    public PreferencesStore(string file, bool seedKnownEquipment = false)
    {
        FilePath = file;
        try { Data = File.Exists(file) ? JsonSerializer.Deserialize<Preferences>(File.ReadAllText(file), Options) ?? new() : new(); }
        catch (Exception e) when(e is IOException or JsonException or UnauthorizedAccessException)
        { Data = new(); Warning = "No s’han pogut llegir els ajustos. " + e.Message; }
        Data.RiderKg = double.IsFinite(Data.RiderKg) ? Math.Clamp(Data.RiderKg, 40, 160) : 75;
        Data.Difficulty = double.IsFinite(Data.Difficulty) ? Math.Clamp(Data.Difficulty, 0, 1) : .5;
        Data.Chainring = Data.Chainring is 30 or 32 or 34 ? Data.Chainring : 32;
        Data.Sensors ??= [];

    }
    public void Remember(SensorRole role, NearbyDevice device)
    {
        Data.Sensors.RemoveAll(s => s.Role == role);
        Data.Sensors.Add(new(role, device.Address, device.Name, device.ZwiftType)); Save();
    }
    public void Forget(SensorRole role) { Data.Sensors.RemoveAll(s => s.Role == role); Save(); }
    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            var temporary = FilePath + ".tmp";
            File.WriteAllText(temporary, JsonSerializer.Serialize(Data, Options));
            File.Move(temporary, FilePath, true); Warning = null;
        }
        catch (Exception e) when(e is IOException or UnauthorizedAccessException)
        { Warning = "No s’han pogut desar els ajustos. " + e.Message; }
    }
    public static void Verify()
    {
        string folder = Path.Combine(Path.GetTempPath(), "MtbIndoorBern-test-" + Guid.NewGuid().ToString("N"));
        string file = Path.Combine(folder, "settings.json");
        try
        {
            var store = new PreferencesStore(file,false);
            store.Data.RiderKg=83; store.Data.Difficulty=.75; store.Data.Chainring=30;
            store.Remember(SensorRole.Controller,new NearbyDevice(123,"Zwift Click",-50,[BleIds.ZwiftV2],10));
            var loaded = new PreferencesStore(file,false);
            if(loaded.Data.RiderKg!=83||loaded.Data.Difficulty!=.75||loaded.Data.Chainring!=30||loaded.Data.Sensors.Count!=1)throw new Exception("Preferences round trip");
            var saved=loaded.Data.Sensors[0];
            if(saved.Find([new(456,"Zwift Click",-60,[BleIds.ZwiftV2],11)]) is not null)throw new Exception("Left/right identity confusion");
            if(saved.Find([new(456,"Zwift Click",-60,[BleIds.ZwiftV2],10)])?.Address!=456)throw new Exception("BLE address rotation");
            if(saved.Find([new(456,"Zwift Click",-60,[BleIds.ZwiftV2],10),new(789,"Zwift Click",-65,[BleIds.ZwiftV2],10)]) is not null)throw new Exception("Ambiguous equipment auto-connect");
        }
        finally { if(File.Exists(file))File.Delete(file); if(Directory.Exists(folder))Directory.Delete(folder); }
    }
}
