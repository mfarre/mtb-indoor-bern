using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MTBIndoorBern;

internal sealed class ProfileInput
{
    public string Name { get; set; } = "";
    public double RiderKg { get; set; }
    public double BikeKg { get; set; }
    public double WheelCircumferenceM { get; set; }
    public int Chainring { get; set; }
    public int[] Sprockets { get; set; } = [];
    public double Difficulty { get; set; }
    public bool LowCadenceAssist { get; set; } = true;
    public string PhysicalGearNote { get; set; } = "";
    public BikeProfile Bike => new() { Name=Name, BikeKg=BikeKg, WheelCircumferenceM=WheelCircumferenceM,
        Sprockets=Sprockets, LowCadenceAssist=LowCadenceAssist, PhysicalGearNote=PhysicalGearNote };
    public bool TryValidate(out string error)
    {
        if(!double.IsFinite(RiderKg)||RiderKg is <40 or >160)error="Rider weight must be between 40 and 160 kg.";
        else if(Chainring is <20 or >60)error="The chainring must have between 20 and 60 teeth.";
        else if(!double.IsFinite(Difficulty)||Difficulty is <0 or >1)error="KICKR gradient scaling must be between 0% and 100%.";
        else return Bike.TryValidate(out error);
        return false;
    }
}

internal static class ProfileSettings
{
    public static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive=true, PropertyNamingPolicy=JsonNamingPolicy.CamelCase };
    public static string Signature(Preferences p)
    {
        // Cosmetic renames and route selection do not invalidate a measured response.
        string data=JsonSerializer.Serialize(new { version=1, p.RiderKg,p.Difficulty,p.Chainring,p.Bike.BikeKg,
            p.Bike.WheelCircumferenceM,p.Bike.Sprockets,p.Bike.LowCadenceAssist,physicalGear=p.Bike.PhysicalGearNote.Trim() });
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(data)));
    }
    public static object Snapshot(Preferences p)=>new {name=p.Bike.Name,riderKg=p.RiderKg,bikeKg=p.Bike.BikeKg,
        wheelCircumferenceM=p.Bike.WheelCircumferenceM,chainring=p.Chainring,sprockets=p.Bike.Sprockets,
        difficulty=p.Difficulty,lowCadenceAssist=p.Bike.LowCadenceAssist,physicalGearNote=p.Bike.PhysicalGearNote};
    public static bool Save(PreferencesStore store, ProfileInput input, out string error)
    {
        if(!input.TryValidate(out error))return false;
        var p=store.Data;var oldBike=p.Bike;double oldWeight=p.RiderKg,oldDifficulty=p.Difficulty;int oldChainring=p.Chainring;
        p.Bike=input.Bike.Normalize();p.RiderKg=input.RiderKg;p.Difficulty=input.Difficulty;p.Chainring=input.Chainring;
        store.Save();
        if(store.Warning is null)return true;
        error=store.Warning;p.Bike=oldBike;p.RiderKg=oldWeight;p.Difficulty=oldDifficulty;p.Chainring=oldChainring;return false;
    }
    public static void Verify()
    {
        string folder=Path.Combine(Path.GetTempPath(),"MtbProfile-"+Guid.NewGuid().ToString("N")),file=Path.Combine(folder,"settings.json");
        Directory.CreateDirectory(folder);
        try
        {
            File.WriteAllText(file,"{\"Version\":2,\"RiderKg\":83,\"Difficulty\":0.75,\"Chainring\":30,\"CourseId\":\"uetliberg\",\"Sensors\":[{\"Role\":\"Trainer\",\"Address\":123,\"Name\":\"Test trainer\"}]}");
            var store=new PreferencesStore(file,false);
            if(store.Data.Bike.BikeKg!=14||store.Data.RiderKg!=83||store.Data.Chainring!=30||store.Data.Sensors.Count!=1)throw new Exception("Legacy profile migration");
            var input=new ProfileInput{Name="Test MTB",RiderKg=81,BikeKg=12.5,WheelCircumferenceM=2.24,Chainring=28,
                Sprockets=[46,37,28,21,16,11],Difficulty=1,LowCadenceAssist=false,PhysicalGearNote="32 x 16 fixed"};
            if(!Save(store,input,out var error))throw new Exception(error);
            var loaded=new PreferencesStore(file,false);
            if(loaded.Data.Bike.Sprockets.Length!=6||loaded.Data.Chainring!=28||loaded.Data.Bike.BikeKg!=12.5||loaded.Data.CourseId!="uetliberg"||loaded.Data.Sensors[0].Address!=123)throw new Exception("Profile round trip and migration preservation");
            var signature=Signature(loaded.Data);loaded.Data.Bike.Name="Another name";
            if(Signature(loaded.Data)!=signature)throw new Exception("Cosmetic rename invalidates calibration");
            loaded.Data.Bike.PhysicalGearNote="32 x 18 fixed";
            if(Signature(loaded.Data)==signature)throw new Exception("Physical gear change must invalidate calibration");
            input.Sprockets=[11,21,46,51];if(Save(store,input,out _)||store.Data.Bike.Sprockets.Length!=6)throw new Exception("Rejected settings mutated profile");
            File.WriteAllText(file,"{\"Bike\":{\"Sprockets\":null,\"BikeKg\":-1},\"Sensors\":null}");
            loaded=new PreferencesStore(file,false);if(!loaded.Data.Bike.TryValidate(out _)||loaded.Data.Sensors.Count!=0)throw new Exception("Malformed saved profile repair");
        }
        finally {if(File.Exists(file))File.Delete(file);if(File.Exists(file+".tmp"))File.Delete(file+".tmp");Directory.Delete(folder);}
    }
}

internal sealed class CalibrationTrainerAdapter(Equipment equipment) : ICalibrationTrainer
{
    private SensorConnection Sensor=>equipment.Connections[SensorRole.Trainer];
    private TrainerControl? ownedControl;
    public bool Connected=>Sensor.Connected&&(ownedControl is null||ReferenceEquals(ownedControl,Sensor.Control));
    public bool SupportsPower=>Sensor.Control?.SupportsPower==true;
    public double? Power=>Sensor.Power;
    public double? Cadence=>Sensor.Cadence;
    public DateTime? LastPacket=>Sensor.LastPowerPacket is { } p && Sensor.LastCadencePacket is { } c ? (p<c?p:c) : null;
    public string Identity
    {
        get
        {
            var saved=equipment.Saved(SensorRole.Trainer);
            string id=$"{saved?.Address}|{Sensor.DeviceName}|{Sensor.Model}|{Sensor.Firmware}";
            return Sensor.Connected?Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(id))):"";
        }
    }
    public async Task StartAsync(CancellationToken token)
    {
        ownedControl=Sensor.Control??throw new IOException("Connect a KICKR with power control.");
        await ownedControl.StartAsync(token,true);
    }
    public Task SetPowerAsync(int watts,CancellationToken token)=>(ownedControl??throw new IOException("Calibration control unavailable.")).SetPowerAsync(watts,token);
    public async Task StopAsync()
    {
        var control=ownedControl;
        if(control is null)return;
        try{await control.StopAsync();}
        finally{ownedControl=null;}
    }
}
