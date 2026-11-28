namespace MTBIndoorBern;

internal sealed class Equipment : IDisposable
{
    public static readonly SensorRole[] ControllerRoles = [SensorRole.Controller,SensorRole.LeftController];
    public static readonly SensorRole[] Roles = [SensorRole.Trainer,SensorRole.Controller,SensorRole.LeftController,SensorRole.HeartRate,SensorRole.Brakes];
    private readonly PreferencesStore preferences;
    private readonly CancellationToken token;
    private readonly Dictionary<SensorRole, bool> busy = Roles.ToDictionary(r=>r,_=>false);
    private readonly HashSet<SensorRole> paused = [];
    private readonly List<Task> pending = [];
    private readonly Action<string> log;
    public Dictionary<SensorRole, SensorConnection> Connections { get; } = Roles.ToDictionary(r=>r,r=>new SensorConnection(r));
    public NearbyDevice[] Nearby { get; private set; } = [];
    public bool Searching { get; private set; }
    public string ScanStatus { get; private set; } = "Automatic search every 5 seconds";
    public event Action? Changed;
    public event Action<int>? Shift;
    public bool ControllerBrakePressed => ControllerRoles.Any(r=>Connections[r].Connected&&Connections[r].BrakePressed);
    private ulong BrakeAddress
    {
        get { ulong address = Connections[SensorRole.Brakes].DeviceAddress; return address > 0 ? address : Saved(SensorRole.Brakes)?.Address ?? 0; }
    }
    public BrakeDeviceCalibration? BrakeCalibration => preferences.Data.BrakeCalibrations.FirstOrDefault(c => c.Address == BrakeAddress && c.ProtocolVersion == BrakeProtocol.Version)?.Normalize();
    public BrakeInputSnapshot BrakeInput
    {
        get
        {
            var connection = Connections[SensorRole.Brakes];
            return connection.GetBrakeInput(BrakeCalibration, BrakeAddress, connection.DeviceAddress > 0 ? connection.DeviceName : Saved(SensorRole.Brakes)?.Name ?? "MTB Brake Bench");
        }
    }
    public BrakeEndpointCapture CaptureBrakeEndpoint(bool left) => Connections[SensorRole.Brakes].CaptureBrakeEndpoint(left);
    public void SaveBrakeCalibration(BrakeEndpoints? left, BrakeEndpoints? right, bool leftIsFront)
    {
        if (Busy(SensorRole.Brakes)) throw new InvalidOperationException("Wait for the brake connection to finish before saving calibration.");
        ulong address = BrakeAddress;
        if (address == 0 || address > 0xFFFFFFFFFFFF) throw new InvalidOperationException("Select and connect the brake board before saving its calibration.");
        if (left is not null) left = BrakeEndpoints.Create(left.Released, left.Pulled, left.Provisional);
        if (right is not null) right = BrakeEndpoints.Create(right.Released, right.Pulled, right.Provisional);
        var saved = new BrakeDeviceCalibration { Address = address, Left = left, Right = right, LeftIsFront = leftIsFront };
        var previous = preferences.Data.BrakeCalibrations;
        preferences.Data.BrakeCalibrations = [..previous.Where(c => c.Address != address), saved];
        preferences.Save();
        Connections[SensorRole.Brakes].ResetBrakeArming();
        if (preferences.Warning is { } warning)
        {
            preferences.Data.BrakeCalibrations = previous;
            throw new IOException(warning);
        }
        Changed?.Invoke();
    }
    public void ClearBrakeCalibration() => SaveBrakeCalibration(null, null, BrakeCalibration?.LeftIsFront ?? true);
    public bool ShouldSearch => Roles.Any(r=>!Paused(r)&&!Busy(r)&&(!Connections[r].Connected||Connections[r].NeedsRefresh));
    public Func<Task>? BeforeTrainerChange;
    public Equipment(PreferencesStore preferences, CancellationToken token, Action<string> log)
    {
        this.preferences=preferences;this.token=token;this.log=log;
        foreach(var c in Connections.Values)c.Changed+=()=>Changed?.Invoke();
        foreach(var role in ControllerRoles)Connections[role].Shift+=direction=>Shift?.Invoke(direction);
    }
    public bool Busy(SensorRole role)=>busy[role];
    public bool Paused(SensorRole role)=>paused.Contains(role);
    public SavedSensor? Saved(SensorRole role)=>preferences.Data.Sensors.FirstOrDefault(s=>s.Role==role);
    public async Task ScanAsync()
    {
        if(Searching||token.IsCancellationRequested)return;
        Searching=true;ScanStatus="Searching for saved devices · retrying every 5 s";Changed?.Invoke();
        try
        {
            Nearby=await Discovery.ScanAsync(token,4);
            ScanStatus=$"{Nearby.Length} devices found · automatic search every 5 s";
            foreach(var role in Roles)
            {
                var connection=Connections[role];
                if(paused.Contains(role)||busy[role]||(connection.Connected&&!connection.NeedsRefresh))continue;
                var match=FindAutomaticDevice(role,Nearby);
                if(match is not null){var job=ConnectAsync(role,match);pending.Add(job);}
            }
            pending.RemoveAll(t=>t.IsCompleted);
        }
        catch(OperationCanceledException) { }
        catch(Exception e){ScanStatus=e.Message;}
        finally{Searching=false;Changed?.Invoke();}
    }
    internal NearbyDevice? FindAutomaticDevice(SensorRole role, NearbyDevice[] nearby)
    {
        var saved=Saved(role);
        var match=saved?.Find(nearby);
        if(match is not null)return match;
        // A failed/quiet subscribed link may not advertise while Windows still owns
        // it. Retry its saved identity once per normal scan cycle with fresh GATT.
        if(saved is { Address: > 0 } && Connections[role].HasSession)
            return new(saved.Address,saved.Name,0,[],saved.ZwiftType);
        // Complete an existing pair only when discovery identifies one unambiguous
        // left pod. Never guess a side from the common "Zwift Click" name alone.
        if(role==SensorRole.LeftController && saved is null && Saved(SensorRole.Controller) is not null)
        {
            var left=nearby.Where(d=>d.ZwiftType==11).ToArray();
            if(left.Length==1)return left[0];
        }
        return null;
    }
    public async Task ConnectAsync(SensorRole role, NearbyDevice device)
    {
        if(busy[role]||token.IsCancellationRequested)return;
        if(device.Address==0){ResumeSearch(role);await ScanAsync();return;}
        if(role==SensorRole.Controller&&device.ZwiftType==11 || role==SensorRole.LeftController&&device.ZwiftType is 9 or 10)
        { log("Choose the matching left or right Click card.");return; }
        if(Connections.Any(pair=>pair.Key!=role&&pair.Value.HasSession&&Saved(pair.Key)?.Address==device.Address))
        { log("This device is already assigned to another slot.");return; }
        busy[role]=true;paused.Remove(role);Changed?.Invoke();
        try
        {
            if(role==SensorRole.Trainer&&BeforeTrainerChange is not null)await BeforeTrainerChange();
            if(Connections[role].HasSession)await Connections[role].DisconnectAsync();
            await Connections[role].ConnectAsync(device,token);
            preferences.Remember(role,device);
            log(preferences.Warning is { } warning ? $"{device.DisplayName} connected, but could not be remembered. {warning}" : $"{device.DisplayName} connected and saved.");
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
        if (role == SensorRole.Brakes)
        {
            var input = BrakeInput;
            string brakeState = c.Connected ? input.State : busy[role] ? "connecting" : paused.Contains(role) ? "paused" : saved is not null ? "searching" : "unpaired";
            string brakeStatus = brakeState switch
            {
                "connecting" => "Connecting…", "paused" => "Search paused · select Connect to resume",
                "searching" => "Searching for saved board · every 5 s", "unpaired" => "Select the brake board to save it", _ => input.Status
            };
            return (object)new { role = role.ToString(), label = "Brakes", state = brakeState, status = brakeStatus,
                detail = c.Connected ? input.Status : brakeStatus, name = c.Connected ? c.DeviceName : saved?.Name ?? "",
                battery = c.Battery, inputConfirmed = c.Connected && input.Armed, front = input.Front, rear = input.Rear };
        }
        string state=c.Connected?c.DataState:busy[role]?"connecting":paused.Contains(role)?"paused":saved is not null?"searching":"unpaired";
        string label=role switch{SensorRole.Trainer=>"KICKR",SensorRole.Controller=>"Right Click",SensorRole.LeftController=>"Left Click",_=>"Heart rate"};
        string status=state switch
        {
            "connecting"=>"Connecting…",
            "paused"=>"Search paused · select Connect to resume",
            "searching"=>"Searching for saved device · every 5 s",
            "unpaired"=>"Select a device to save it",
            "waiting"=>c.ActivationRequired?"Zwift activation requested":role.IsController()?"Press a button to confirm input":"Waiting for heart-rate data",
            "stale"=>"Heart-rate data stopped · reconnecting",
            _=>role.IsController()?"Button input confirmed":"Live data"
        };
        return (object)new {role=role.ToString(),label,state,status,detail=c.Status,name=c.Connected?c.DeviceName:saved?.Name??"",battery=c.Battery,inputConfirmed=c.InputConfirmed};
    }).ToArray();
    public async Task ShutdownAsync(){await Task.WhenAll(pending);await Task.WhenAll(Connections.Values.Select(c=>c.DisconnectAsync()));}
    public void Dispose(){foreach(var c in Connections.Values)c.Dispose();}
}
