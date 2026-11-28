using System.Text.Json;
using System.Text.Json.Serialization;

namespace MTBIndoorBern;

internal sealed record SavedSensor(SensorRole Role, ulong Address, string Name, byte? ZwiftType = null)
{
    public NearbyDevice? Find(IEnumerable<NearbyDevice> devices)
    {
        var candidates = devices.Where(d => d.Matches(Role) ||
            (Address != 0 && d.Address == Address && !d.ZwiftType.HasValue)).ToArray();
        var exact = candidates.FirstOrDefault(d => Address != 0 && d.Address == Address);
        if (exact is not null) return exact;
        var named = candidates.Where(d => d.Name.Equals(Name, StringComparison.OrdinalIgnoreCase) &&
            (!ZwiftType.HasValue || d.ZwiftType == ZwiftType)).ToArray();
        return named.Length == 1 ? named[0] : null;
    }
}

internal sealed class Preferences
{
    public int Version { get; set; } = 4;
    public double RiderKg { get; set; } = 75;
    public double Difficulty { get; set; } = .5;
    public int Chainring { get; set; } = 32;
    public BikeProfile Bike { get; set; } = new();
    public PresentationPreferences Presentation { get; set; } = new();
    public CalibrationResult? Calibration { get; set; }
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
        { Data = new(); Warning = "Could not read the settings. " + e.Message; }
        Data.RiderKg = double.IsFinite(Data.RiderKg) ? Math.Clamp(Data.RiderKg, 40, 160) : 75;
        Data.Difficulty = double.IsFinite(Data.Difficulty) ? Math.Clamp(Data.Difficulty, 0, 1) : .5;
        Data.Chainring = Data.Chainring is >=20 and <=60 ? Data.Chainring : 32;
        Data.Bike = (Data.Bike ?? new()).Normalize();
        Data.Presentation = (Data.Presentation ?? new()).Normalize();
        Data.Version = 4;
        Data.Sensors ??= [];
        // Existing Controller records remain the right slot. A positively identified
        // left pod accidentally saved in that old slot is migrated to its own slot.
        Data.Sensors = Data.Sensors.Select(s => s.Role == SensorRole.Controller && s.ZwiftType == 11
            ? s with { Role = SensorRole.LeftController } : s)
            .Where(s => Enum.IsDefined(s.Role)).GroupBy(s => s.Role).Select(g => g.Last()).ToList();
    }
    public void Remember(SensorRole role, NearbyDevice device)
    {
        if (role == SensorRole.Controller && device.ZwiftType == 11 || role == SensorRole.LeftController && device.ZwiftType is 9 or 10)
            throw new InvalidOperationException("Select the matching left or right Click slot.");
        // One physical device cannot occupy two saved slots.
        Data.Sensors.RemoveAll(s => s.Role == role);
        if (device.Address != 0) Data.Sensors.RemoveAll(s => s.Address == device.Address);
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
        { Warning = "Could not save the settings. " + e.Message; }
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
            loaded.Remember(SensorRole.LeftController, new(456,"Zwift Click",-60,[BleIds.ZwiftV2],11));
            var pair = new PreferencesStore(file, false);
            if(pair.Data.Sensors.Count != 2 || pair.Data.Sensors.Single(s=>s.Role==SensorRole.Controller).Address != 123 ||
                pair.Data.Sensors.Single(s=>s.Role==SensorRole.LeftController).Address != 456) throw new Exception("Independent Click persistence");
            File.WriteAllText(file,"{\"Version\":3,\"Sensors\":[{\"Role\":\"Controller\",\"Address\":123,\"Name\":\"Zwift Click\",\"ZwiftType\":10}]}");
            var legacy = new PreferencesStore(file, false);
            if(legacy.Data.Sensors.Single().Role != SensorRole.Controller || legacy.Data.Version != 4) throw new Exception("Legacy right Click migration");
            File.WriteAllText(file,"{\"Version\":3,\"Sensors\":[{\"Role\":\"Controller\",\"Address\":456,\"Name\":\"Zwift Click\",\"ZwiftType\":11}]}");
            if(new PreferencesStore(file, false).Data.Sensors.Single().Role != SensorRole.LeftController) throw new Exception("Legacy left Click migration");
        }
        finally { if(File.Exists(file))File.Delete(file); if(Directory.Exists(folder))Directory.Delete(folder); }
    }
}
