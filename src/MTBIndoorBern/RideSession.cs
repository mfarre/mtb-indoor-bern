using System.Text.Json;

namespace MTBIndoorBern;

internal sealed class RoutePoint
{
    public double D { get; set; }
    public double X { get; set; }
    public double Y { get; set; }
    public double Z { get; set; }
    public double Alt { get; set; }
    public double Grade { get; set; }
}

internal sealed class Course
{
    public double Length { get; set; }
    public double Ascent { get; set; }
    public RoutePoint[] Points { get; set; } = [];
    public static Course Load(string file)
    {
        var route = JsonSerializer.Deserialize<Course>(File.ReadAllText(file), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
        if (route.Points.Length < 2 || route.Length < 100 || route.Points.Any(p => !double.IsFinite(p.Grade)) ||
            route.Points.Zip(route.Points.Skip(1)).Any(p => p.First.D >= p.Second.D))
            throw new InvalidDataException("El traçat del circuit no és vàlid.");
        return route;
    }
    public RoutePoint At(double distance)
    {
        distance = Math.Clamp(distance, 0, Length);
        int left = 0, right = Points.Length - 1;
        while (right - left > 1) { int mid = (left + right) / 2; if (Points[mid].D <= distance) left = mid; else right = mid; }
        var a = Points[left]; var b = Points[right]; double t = (distance - a.D) / (b.D - a.D);
        return new RoutePoint { D = distance, X = a.X + (b.X - a.X) * t, Y = a.Y + (b.Y - a.Y) * t,
            Z = a.Z + (b.Z - a.Z) * t, Alt = a.Alt + (b.Alt - a.Alt) * t, Grade = a.Grade };
    }
}

internal static class RidePhysics
{
    public static double Speed(double speed, double watts, double grade, double riderKg, double dt)
    {
        var mass = riderKg + 14;
        var force = Math.Clamp(watts, 0, 2000) * .96 / Math.Max(speed, .5) - mass * 9.81 * (grade / 100 + .009) - .5 * 1.225 * .51 * speed * speed;
        return Math.Clamp(speed + Math.Clamp(force / mass, -4, 2.5) * dt, 0, 45 / 3.6);
    }
    public static readonly int[] Sprockets = [51,45,39,33,28,24,21,18,16,14,12,10];
    public static double Ratio(int gear,int chainring=32)=>chainring/(double)Sprockets[Math.Clamp(gear,1,12)-1];
    public static double Development(int gear,int chainring=32)=>2.30*Ratio(gear,chainring);
    // 29-inch MTB: real 1x12 ratios, 2.30 m wheel rollout. Convert the road force at
    // cadence-derived geared speed to crank power; update FTMS dynamically, not a fixed ERG workout.
    public static double TargetPower(double grade,double difficulty,int gear,double cadence,double riderKg,int chainring=32)
    {
        if(!double.IsFinite(cadence)||cadence<=30)return 0;
        cadence=Math.Clamp(cadence,0,170);
        double speed=cadence/60*Development(gear,chainring);
        double slope=Math.Clamp(grade,-30,30)*difficulty/100;
        double force=(riderKg+14)*9.81*(slope+.009)+.5*1.225*.51*speed*speed;
        double release=Math.Clamp((cadence-30)/15,0,1);
        return Math.Clamp(Math.Max(0,force)*speed/.96*release*release,0,600);
    }
}

internal sealed class RideSession
{
    private readonly SensorConnection trainer, heart;
    private readonly Action<string> log;
    private readonly Course course;
    private readonly PreferencesStore? preferences;
    private readonly SemaphoreSlim operations = new(1, 1);
    private CancellationTokenSource? rideToken;
    private bool controlBusy, pedalled;
    private DateTime lastControl = DateTime.MinValue;
    private DateTime lastConfirmation = DateTime.MinValue;
    private TrainerControl? activeControl;
    public string Mode { get; private set; } = "ready";
    public string Message { get; private set; } = "Connecta el KICKR i inicia la ruta, o explora-la en mode demo.";
    public double Distance { get; private set; }
    public double Velocity { get; private set; }
    public double Elapsed { get; private set; }
    public double Climbed { get; private set; }
    public int Gear { get; private set; } = 8;
    public int Chainring { get; private set; } = 32;
    public double RiderKg { get; private set; } = 75;
    public double Difficulty { get; private set; } = .5;
    public bool Running => Mode is "ride" or "demo";
    public bool Live => Mode == "ride";
    public bool Busy { get; private set; }
    public bool IsDemo { get; private set; }

    public RideSession(Course course, SensorConnection trainer, SensorConnection heart, Action<string> log,PreferencesStore? preferences=null)
    { this.course = course; this.trainer = trainer; this.heart = heart; this.log = log;this.preferences=preferences;
      if(preferences is not null){RiderKg=preferences.Data.RiderKg;Difficulty=preferences.Data.Difficulty;Chainring=preferences.Data.Chainring;} }

    public void Shift(int delta) { Gear = Math.Clamp(Gear + Math.Sign(delta), 1, 12); }
    public void JumpDemo(double distance)
    {
        if (Mode != "demo") return;
        Distance = Math.Clamp(distance, 0, course.Length - 10); Velocity = 0; Elapsed = 0; Climbed = 0;
    }
    public void Configure(double weight, double difficulty,int chainring=32)
    {
        if (Running || Busy) return;
        if (double.IsFinite(weight)) RiderKg = Math.Clamp(weight, 40, 160);
        if (double.IsFinite(difficulty)) Difficulty = Math.Clamp(difficulty, 0, 1);
        Chainring=chainring is 30 or 32 or 34?chainring:32;
        if(preferences is not null){preferences.Data.RiderKg=RiderKg;preferences.Data.Difficulty=Difficulty;preferences.Data.Chainring=Chainring;preferences.Save();}
    }
    private bool Fresh => trainer.Connected && trainer.LastPacket.HasValue && (DateTime.UtcNow - trainer.LastPacket.Value).TotalSeconds < 5 && trainer.Power.HasValue;

    public async Task StartAsync(bool demo)
    {
        await operations.WaitAsync(); Busy = true;
        try
        {
            if (Running) return;
            if (!demo && (!Fresh || trainer.Control?.SupportsPower!=true||!trainer.Cadence.HasValue))
                throw new InvalidOperationException("Esperant el KICKR amb potència i cadència. Pedala uns segons i torna a iniciar.");
            if (Distance >= course.Length || IsDemo != demo) ResetProgress();
            IsDemo = demo;
            if (!demo)
            {
                activeControl = trainer.Control;
                rideToken?.Dispose(); rideToken = new CancellationTokenSource();
                await activeControl!.StartAsync(rideToken.Token,true);
            }
            Mode = demo ? "demo" : "ride";
            Message = demo ? "DEMO · recorregut automàtic, sense controlar el KICKR" : "MTB 1×12 · + puja marxa · B baixa marxa";
            pedalled = demo; lastControl = DateTime.MinValue; lastConfirmation = DateTime.UtcNow;
            log(demo ? "Demo 3D iniciada. KICKR sense control." : "Ruta iniciada. Control del KICKR confirmat.");
        }
        catch (Exception e)
        {
            await ReleaseControlAsync(); Mode = "paused"; Message = e.Message; log(e.Message);
        }
        finally { Busy = false; operations.Release(); }
    }

    public async Task PauseAsync(string? reason = null)
    {
        await operations.WaitAsync(); Busy = true;
        try
        {
            Mode = Distance >= course.Length ? "finished" : "paused"; Velocity = 0;
            Message = reason ?? "Ruta en pausa · resistència alliberada";
            string? failure = await ReleaseControlAsync();
            if (failure is not null) Message += " · " + failure;
            log(Message);
        }
        finally { Busy = false; operations.Release(); }
    }

    public async Task ResetAsync()
    {
        await PauseAsync("Ruta aturada");
        ResetProgress(); Mode = "ready";
    }
    private void ResetProgress() { Distance = 0; Elapsed = 0; Velocity = 0; Climbed = 0; pedalled = false; }
    private async Task<string?> ReleaseControlAsync()
    {
        rideToken?.Cancel();
        var control = activeControl; activeControl = null;
        if (control is null) return null;
        try { await control.StopAsync(); return null; }
        catch (Exception e) { return e.Message; }
    }

    public void Tick(double dt)
    {
        if (!Running || Busy) return;
        dt = Math.Clamp(dt, 0, .25);
        if (Live && (!Fresh || activeControl != trainer.Control || activeControl?.IsControlling != true))
        { _ = PauseAsync("Ruta pausada: s’ha perdut el senyal o el control del KICKR"); return; }
        var before = course.At(Distance);
        int watts = IsDemo ? 170 : Math.Max(0, trainer.Power ?? 0);
        if (watts > 10) pedalled = true;
        if (pedalled)
        {
            Velocity = IsDemo ? 6.2 : RidePhysics.Speed(Velocity, watts, before.Grade, RiderKg, dt);
            Distance = Math.Min(course.Length, Distance + Velocity * dt);
            Elapsed += dt;
            Climbed += Math.Max(0, course.At(Distance).Alt - before.Alt);
        }
        if (Distance >= course.Length) { _ = PauseAsync("Volta completada. Bona ruta!"); return; }
        if (Live && !controlBusy && (DateTime.UtcNow - lastControl).TotalSeconds >= 1)
            _ = UpdateResistanceAsync();
    }

    private async Task UpdateResistanceAsync()
    {
        var control = activeControl; var token = rideToken?.Token ?? CancellationToken.None;
        if (control is null) return;
        controlBusy = true; lastControl = DateTime.UtcNow;
        try
        {
            double cadence=trainer.Cadence??0;
            var target = RidePhysics.TargetPower(course.At(Distance).Grade,Difficulty,Gear,cadence,RiderKg,Chainring);
            target = cadence<=30?0:Math.Min(target,control.AppliedPower+40);
            if (Math.Abs(target - control.AppliedPower) >= 2 || (DateTime.UtcNow - lastConfirmation).TotalSeconds >= 5)
            {
                await control.SetPowerAsync((int)Math.Round(target), token);
                lastConfirmation = DateTime.UtcNow;
            }
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { }
        catch (Exception e) { if (Live) await PauseAsync("Control interromput: " + e.Message); }
        finally { controlBusy = false; }
    }

    public object Snapshot(object? devices=null)
    {
        var p = course.At(Distance);
        bool hrFresh = heart.Connected && heart.LastPacket.HasValue && (DateTime.UtcNow - heart.LastPacket.Value).TotalSeconds < 8;
        return new { type = "state", mode = Mode, message = Message, distance = Distance, speed = Velocity * 3.6, elapsed = Elapsed,
            climbed = Climbed, grade = p.Grade, altitude = p.Alt, gear = Gear, weight = RiderKg, difficulty = Difficulty, busy = Busy,
            devices,chainring=Chainring,sprocket=RidePhysics.Sprockets[Gear-1],development=RidePhysics.Development(Gear,Chainring),gearCount=12,settingsWarning=preferences?.Warning,
            watts = IsDemo && Running ? 170 : Fresh ? trainer.Power : null,
            cadence = IsDemo && Running ? 82 : Fresh ? trainer.Cadence : null,
            heart = hrFresh ? heart.HeartRate : null, trainer = trainer.Connected, hr = hrFresh,
            control = activeControl?.IsControlling == true, targetPower = activeControl?.AppliedPower,
            controlStatus = trainer.Control?.Status ?? trainer.ControlInfo,
            length = course.Length, demo = IsDemo };
    }

    public static void Verify(string routeFile)
    {
        var course = Course.Load(routeFile);
        if (Math.Abs(course.At(course.Length).D - course.Length) > .001 || course.At(0).D != 0) throw new Exception("Route endpoints");
        double flat = 0, up = 0;
        for (int i = 0; i < 3000; i++) { flat = RidePhysics.Speed(flat, 180, 0, 75, .1); up = RidePhysics.Speed(up, 180, 6, 75, .1); }
        if (flat <= up || up <= 0 || flat > 45 / 3.6) throw new Exception("Physics hill/flat");
        if (RidePhysics.Speed(0, 0, 3, 75, .1) != 0) throw new Exception("Stationary rider");
        if (RidePhysics.Speed(0, 150, 15, 75, .1) <= 0) throw new Exception("MTB hill restart at low speed");
        if (!TrainerControl.PowerPacket(180).SequenceEqual(new byte[]{5,180,0}) || !TrainerControl.PowerPacket(900).SequenceEqual(new byte[]{5,88,2}) || !TrainerControl.PowerPacket(-1).SequenceEqual(new byte[]{5,0,0})) throw new Exception("FTMS power target encoding and limits");
        if(RidePhysics.TargetPower(12,1,1,70,75)>=RidePhysics.TargetPower(12,1,6,70,75))throw new Exception("MTB low gear must reduce climbing load");
        if(RidePhysics.TargetPower(12,1,1,70,75)>230)throw new Exception("32x51 climbing load unrealistic");
        if(RidePhysics.TargetPower(17,1,12,90,75)!=600)throw new Exception("Load cap");
        if(RidePhysics.TargetPower(12,1,5,20,75)!=0||RidePhysics.TargetPower(12,1,5,40,75)>=RidePhysics.TargetPower(12,1,5,70,75))throw new Exception("Low-cadence resistance release");
        for(int i=0;i<course.Points.Length-1;i++){var a=course.Points[i];var b=course.Points[i+1];var gradient=(b.Y-a.Y)/Math.Sqrt(Math.Pow(b.X-a.X,2)+Math.Pow(b.Z-a.Z,2))*100;if(Math.Abs(gradient-a.Grade)>.002)throw new Exception("Rendered slope differs from controller slope");}
        if (!TrainerControl.SimulationPacket(-2.5).SequenceEqual(new byte[]{0x11,0,0,6,255,40,51})) throw new Exception("Signed FTMS encoding");
        if (TrainerControl.SimulationPacket(50)[3] != 32) throw new Exception("FTMS clamp");
        using var trainer = new SensorConnection(SensorRole.Trainer);
        using var heart = new SensorConnection(SensorRole.HeartRate);
        var ride = new RideSession(course, trainer, heart, _ => { });
        ride.StartAsync(false).GetAwaiter().GetResult();
        if (ride.Running || ride.Distance != 0) throw new Exception("Live start without trainer");
        ride.StartAsync(true).GetAwaiter().GetResult();
        for(int i=0;i<100;i++) ride.Tick(.1);
        if (Math.Abs(ride.Distance - 62) > .01 || trainer.Control is not null) throw new Exception("Demo must advance without controlling trainer");
        ride.PauseAsync().GetAwaiter().GetResult(); double pausedDistance = ride.Distance;
        ride.Tick(.1); if(ride.Distance != pausedDistance || ride.Velocity != 0) throw new Exception("Pause drift");
        for(int i=0;i<30;i++) ride.Shift(1); if(ride.Gear != 12) throw new Exception("Gear upper bound");
        for(int i=0;i<30;i++) ride.Shift(-1); if(ride.Gear != 1) throw new Exception("Gear lower bound");
        ride.ResetAsync().GetAwaiter().GetResult(); if(ride.Distance != 0 || ride.Elapsed != 0) throw new Exception("Route reset");
    }
}
