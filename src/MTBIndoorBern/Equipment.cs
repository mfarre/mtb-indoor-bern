namespace MTBIndoorBern;

internal sealed class Equipment : IDisposable
{
    public static readonly SensorRole[] Roles = [SensorRole.Trainer,SensorRole.Controller,SensorRole.HeartRate];
    private readonly PreferencesStore preferences;
    private readonly CancellationToken token;
    private readonly Dictionary<SensorRole, bool> busy = Roles.ToDictionary(r=>r,_=>false);
    private readonly HashSet<SensorRole> paused = [];
    private readonly List<Task> pending = [];
    private readonly Action<string> log;
    public Dictionary<SensorRole, SensorConnection> Connections { get; } = Roles.ToDictionary(r=>r,r=>new SensorConnection(r));
    public NearbyDevice[] Nearby { get; private set; } = [];
    public bool Searching { get; private set; }
    public string ScanStatus { get; private set; } = "Cerca automàtica cada 5 segons";
    public event Action? Changed;
    public Func<Task>? BeforeTrainerChange;
    public Equipment(PreferencesStore preferences, CancellationToken token, Action<string> log)
    { this.preferences=preferences;this.token=token;this.log=log;foreach(var c in Connections.Values)c.Changed+=()=>Changed?.Invoke(); }
    public bool Busy(SensorRole role)=>busy[role];
    public bool Paused(SensorRole role)=>paused.Contains(role);
    public SavedSensor? Saved(SensorRole role)=>preferences.Data.Sensors.FirstOrDefault(s=>s.Role==role);
    public async Task ScanAsync()
    {
        if(Searching||token.IsCancellationRequested)return;
        Searching=true;ScanStatus="Cercant l’equip recordat · nova cerca cada 5 s";Changed?.Invoke();
        try
        {
            Nearby=await Discovery.ScanAsync(token,4);
            ScanStatus=$"{Nearby.Length} dispositius detectats · cerca automàtica cada 5 s";
            foreach(var role in Roles)
            {
                if(paused.Contains(role)||busy[role]||Connections[role].Connected)continue;
                var match=Saved(role)?.Find(Nearby);
                if(match is not null){var job=ConnectAsync(role,match);pending.Add(job);}
            }
            pending.RemoveAll(t=>t.IsCompleted);
        }
        catch(OperationCanceledException) { }
        catch(Exception e){ScanStatus=e.Message;}
        finally{Searching=false;Changed?.Invoke();}
    }
    public async Task ConnectAsync(SensorRole role, NearbyDevice device)
    {
        if(busy[role]||token.IsCancellationRequested)return;
        if(device.Address==0){ResumeSearch(role);await ScanAsync();return;}
        busy[role]=true;paused.Remove(role);Changed?.Invoke();
        try
        {
            if(role==SensorRole.Trainer&&BeforeTrainerChange is not null)await BeforeTrainerChange();
            if(Connections[role].HasSession)await Connections[role].DisconnectAsync();
            await Connections[role].ConnectAsync(device,token);
            preferences.Remember(role,device); log($"{device.DisplayName} connectat i recordat.");
        }
        catch(OperationCanceledException) { }
        catch(Exception e){log($"{device.DisplayName}: {e.Message}");}
        finally{busy[role]=false;Changed?.Invoke();}
    }
    public async Task DisconnectAsync(SensorRole role,bool forget=false)
    {
        if(busy[role])return;
        paused.Add(role);busy[role]=true;Changed?.Invoke();
        try
        {
            if(role==SensorRole.Trainer&&BeforeTrainerChange is not null)await BeforeTrainerChange();
            await Connections[role].DisconnectAsync();
            if(forget)preferences.Forget(role);
        }
        finally{busy[role]=false;Changed?.Invoke();}
    }
    public void ResumeSearch(SensorRole role){paused.Remove(role);Changed?.Invoke();}
    public object[] Snapshot()=>Roles.Select(role=>
    {
        var c=Connections[role];var saved=Saved(role);
        string state=c.Connected?"connected":busy[role]?"connecting":paused.Contains(role)?"paused":saved is not null?"searching":"unpaired";
        string label=role switch{SensorRole.Trainer=>"KICKR",SensorRole.Controller=>"Click dret",_=>"Pulsòmetre"};
        return (object)new {role=role.ToString(),label,state,name=c.Connected?c.DeviceName:saved?.Name??"",battery=c.Battery};
    }).ToArray();
    public async Task ShutdownAsync(){await Task.WhenAll(pending);await Task.WhenAll(Connections.Values.Select(c=>c.DisconnectAsync()));}
    public void Dispose(){foreach(var c in Connections.Values)c.Dispose();}
}
