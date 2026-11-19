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
    // Compatibility entry points for diagnostics; active rides use their saved BikeProfile.
    public static readonly int[] Sprockets = [51,45,39,33,28,24,21,18,16,14,12,10];
    public static double Ratio(int gear,int chainring=32)=>BikeDynamics.Ratio(gear,chainring,new());
    public static double Development(int gear,int chainring=32)=>BikeDynamics.Development(gear,chainring,new());
    public static double Speed(double speed,double watts,double grade,double riderKg,double dt)=>BikeDynamics.Speed(speed,watts,grade,riderKg,dt,new());
    public static double TargetPower(double grade,double difficulty,int gear,double cadence,double riderKg,int chainring=32)=>BikeDynamics.TargetPower(grade,difficulty,gear,cadence,riderKg,chainring,new());
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
    private readonly TorqueRamp torqueRamp = new();
    public BikeProfile Bike { get; private set; } = new();
    public int GearCount => Bike.Sprockets.Length;
    public Func<string> TrainerIdentity { get; set; } = () => "";
    private CalibrationResult? ValidCalibration => preferences?.Data.Calibration is { } c && c.IsValidFor(ProfileSettings.Signature(preferences.Data),TrainerIdentity()) ? c : null;
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
    public int DemoSpeed { get; private set; } = 1;
    public bool Practice { get; private set; }
    public TrailPlan Trail { get; }
    public TrailHandling Handling { get; } = new();
    public DescentTimer Descent { get; }
    private bool controllerBrake, screenBrake;
    private DateTime screenBrakeUntil;
    public bool BrakePressed => controllerBrake || (screenBrake && DateTime.UtcNow < screenBrakeUntil);
    public void SetControllerBrake(bool pressed) => controllerBrake = pressed;
    public void SetScreenBrake(bool pressed) { screenBrake = pressed; screenBrakeUntil = DateTime.UtcNow.AddSeconds(.75); }

    public RideSession(Course course, SensorConnection trainer, SensorConnection heart, Action<string> log,PreferencesStore? preferences=null, string? routeFile=null, PersonalRecords? records=null)
    { this.course = course; this.trainer = trainer; this.heart = heart; this.log = log;this.preferences=preferences;
      Trail = new(course, routeFile); Descent = new(Trail, records ?? new PersonalRecords(null));
      ReloadProfile(); }

    public void Shift(int delta) { Gear = Math.Clamp(Gear + Math.Sign(delta), 1, GearCount); }
    public void CycleDemoSpeed()
    {
        if (!IsDemo || Practice || Busy || Mode is not ("demo" or "paused")) return;
        DemoSpeed = DemoSpeed == 8 ? 1 : DemoSpeed * 2;
    }
    public void JumpDemo(double distance)
    {
        if (Mode != "demo") return;
        SeekDemo(Math.Clamp(distance, 0, course.Length - 10)); Elapsed = 0; Climbed = 0;
    }
    public bool CanSeek => IsDemo && !Busy && Mode is "demo" or "paused" or "finished";
    public void SeekDemo(double distance)
    {
        if (!CanSeek || !double.IsFinite(distance)) return;
        bool wasFinished = Mode == "finished";
        Distance = Math.Clamp(distance, 0, course.Length); Velocity = 0;
        Handling.Reset(); Descent.Reset(); screenBrake = controllerBrake = false;
        if (Distance >= course.Length) { Mode = "finished"; Message = "Final de la demo · clica el perfil per tornar a un altre punt"; }
        else if (wasFinished) { Mode = "paused"; Message = "Demo en pausa · prem Reprèn per continuar des d’aquest punt"; }
        else Message = Mode == "paused" ? "Demo en pausa · posició canviada al perfil" : Practice ? "PRÀCTICA · nova posició · sense rècord" : "DEMO · posició canviada al perfil";
    }
    public Task ResumeAsync() => Mode == "paused" && !Busy ? StartAsync(IsDemo) : Task.CompletedTask;
    public async Task StartPracticeAsync()
    {
        if (Trail.Stage is null || Busy || Running) return;
        await ResetAsync(); await StartAsync(true);
        Practice = true; JumpDemo(Math.Max(0, Trail.Stage.Start - 55)); Velocity = 5;
        Message = "PRÀCTICA · A / Espai: mantén per frenar · sense KICKR ni rècord";
    }
    public void Configure(double weight, double difficulty,int chainring=32)
    {
        if (Running || Busy) return;
        if (double.IsFinite(weight)) RiderKg = Math.Clamp(weight, 40, 160);
        if (double.IsFinite(difficulty)) Difficulty = Math.Clamp(difficulty, 0, 1);
        Chainring=chainring is >=20 and <=60?chainring:32;
        if(preferences is not null){preferences.Data.RiderKg=RiderKg;preferences.Data.Difficulty=Difficulty;preferences.Data.Chainring=Chainring;preferences.Save();}
    }
    public void ReloadProfile()
    {
        if(Running||Busy)return;
        if(preferences is not null){RiderKg=preferences.Data.RiderKg;Difficulty=preferences.Data.Difficulty;Chainring=preferences.Data.Chainring;Bike=preferences.Data.Bike.Copy();}
        Gear=Math.Clamp(Gear,1,GearCount); torqueRamp.Reset(); Descent.Invalidate();
    }
    private bool Fresh => trainer.Connected && trainer.LastPowerPacket.HasValue && (DateTime.UtcNow - trainer.LastPowerPacket.Value).TotalSeconds < 5 && trainer.LastCadencePacket.HasValue && (DateTime.UtcNow - trainer.LastCadencePacket.Value).TotalSeconds < 5 && trainer.Power.HasValue;

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
            if (!demo) Practice = false;
            if (!demo)
            {
                activeControl = trainer.Control;
                rideToken?.Dispose(); rideToken = new CancellationTokenSource();
                await activeControl!.StartAsync(rideToken.Token,true);
            }
            torqueRamp.Reset();
            Mode = demo ? "demo" : "ride";
            Message = Practice ? "PRÀCTICA · A / Espai: mantén per frenar · sense KICKR ni rècord" : demo ? "DEMO · recorregut automàtic, sense controlar el KICKR" : $"MTB 1×{GearCount} · + puja marxa · B baixa marxa";
            pedalled = demo || pedalled; lastControl = DateTime.MinValue; lastConfirmation = DateTime.UtcNow;
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
            Descent.Invalidate(); screenBrake = controllerBrake = false; Handling.Release();
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
    private void ResetProgress() { Distance = 0; Elapsed = 0; Velocity = 0; Climbed = 0; pedalled = false; DemoSpeed = 1; Practice = false; Handling.Reset(); Descent.Reset(); screenBrake = controllerBrake = false; }
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
        // Small fixed upper step keeps braking and corner penalties stable at 10 Hz or after a delayed frame.
        for (double remaining = dt; remaining > .000001;)
        {
            double step = Math.Min(.025, remaining); remaining -= step;
            var before = course.At(Distance); double oldDistance = Distance;
            int watts = Practice ? (before.Grade > -1.3 ? 160 : 0) : IsDemo ? 170 : Math.Max(0, trainer.Power ?? 0);
            if (watts > 10 || before.Grade < -1.1) pedalled = true;
            if (pedalled)
            {
                Velocity = IsDemo && !Practice ? (BrakePressed ? Math.Max(0, Velocity - 5.5 * step) : 6.2 * DemoSpeed)
                    : Handling.Step(Velocity, watts, before.Grade, RiderKg, BrakePressed, Trail.At(Distance), Distance, step, Bike, Trail.SurfaceAt(Distance));
                Distance = Math.Min(course.Length, Distance + Velocity * step);
                Elapsed += step;
                Climbed += Math.Max(0, course.At(Distance).Alt - before.Alt);
            }
            if (!IsDemo || Practice) Descent.Tick(oldDistance, Distance, step, Live, Handling.OffTracks);
        }
        if (Distance >= course.Length) { _ = PauseAsync("Volta completada. Bona ruta!"); return; }
        if (Live && !controlBusy && (DateTime.UtcNow - lastControl).TotalSeconds >= (ValidCalibration?.UpdateIntervalSeconds ?? 1))
            _ = UpdateResistanceAsync();
    }

    private async Task UpdateResistanceAsync()
    {
        var control = activeControl; var token = rideToken?.Token ?? CancellationToken.None;
        if (control is null) return;
        controlBusy = true; double controlDt=lastControl==DateTime.MinValue?1:Math.Clamp((DateTime.UtcNow-lastControl).TotalSeconds,0,2); lastControl = DateTime.UtcNow;
        try
        {
            double cadence=trainer.Cadence??0;
            var target = BikeDynamics.TargetPower(course.At(Distance).Grade,Difficulty,Gear,cadence,RiderKg,Chainring,Bike,Trail.SurfaceAt(Distance));
            target = torqueRamp.NextPower(target,cadence,controlDt,ValidCalibration?.TorqueRiseNmPerSecond ?? 5);
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
            devices,chainring=Chainring,sprocket=Bike.Sprockets[Gear-1],development=BikeDynamics.Development(Gear,Chainring,Bike),gearCount=GearCount,bikeName=Bike.Name,bikeKg=Bike.BikeKg,calibrated=ValidCalibration is not null,settingsWarning=preferences?.Warning,
            watts = Practice ? (Running && p.Grade > -1.3 ? 160 : 0) : IsDemo && Running ? 170 : Fresh ? trainer.Power : null,
            cadence = Practice ? 0 : IsDemo && Running ? 82 : Fresh ? trainer.Cadence : null,
            heart = hrFresh ? heart.HeartRate : null, trainer = trainer.Connected, hr = hrFresh,
            control = activeControl?.IsControlling == true, targetPower = activeControl?.AppliedPower,
            controlStatus = trainer.Control?.Status ?? trainer.ControlInfo,
            length = course.Length, demo = IsDemo, demoSpeed = DemoSpeed, practice = Practice, canSeek = CanSeek,
            brake = BrakePressed, brakePressure = Handling.Brake, slip = Handling.Slip, recovery = Handling.Recovery, skidSide = Handling.Side,
            corner = CornerSnapshot(), descent = Descent.Snapshot(Distance, Handling.OffTracks) };
    }
    private object? CornerSnapshot()
    {
        var c = Trail.Next(Distance); if (c is null) return null;
        return new { distance = Math.Max(0, c.Start - Distance), limit = c.Limit * 3.6, direction = c.Direction, surface = c.Surface,
            urgent = Velocity > c.Limit * 1.04 && c.Start - Distance < Math.Max(25, (Velocity * Velocity - c.Limit * c.Limit) / 7 + Velocity * 1.4) };
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
        ride.SeekDemo(100); if(ride.Distance!=0||ride.CanSeek)throw new Exception("Seeking before demo");
        ride.CycleDemoSpeed(); if(ride.DemoSpeed != 1) throw new Exception("Demo speed outside demo");
        ride.StartAsync(false).GetAwaiter().GetResult();
        if (ride.Running || ride.Distance != 0) throw new Exception("Live start without trainer");
        ride.SeekDemo(100); if(ride.Distance!=0||ride.CanSeek)throw new Exception("Seeking a real paused session");
        ride.StartAsync(true).GetAwaiter().GetResult();
        for(int i=0;i<100;i++) ride.Tick(.1);
        if (Math.Abs(ride.Distance - 62) > .01 || trainer.Control is not null) throw new Exception("Demo must advance without controlling trainer");
        foreach(int multiplier in new[]{2,4,8,1})
        {
            double previous=ride.Distance, elapsed=ride.Elapsed;
            ride.CycleDemoSpeed(); for(int i=0;i<10;i++)ride.Tick(.1);
            if(ride.DemoSpeed!=multiplier || Math.Abs(ride.Distance-previous-6.2*multiplier)>.001 || Math.Abs(ride.Elapsed-elapsed-1)>.001 || trainer.Control is not null)
                throw new Exception("Demo acceleration must change travel only and wrap to 1x");
        }
        ride.PauseAsync().GetAwaiter().GetResult(); double pausedDistance = ride.Distance;
        ride.Tick(.1); if(ride.Distance != pausedDistance || ride.Velocity != 0) throw new Exception("Pause drift");
        ride.CycleDemoSpeed(); ride.Tick(.1);
        if(ride.DemoSpeed!=2 || ride.Distance!=pausedDistance)throw new Exception("Paused demo speed must not advance");
        double savedElapsed=ride.Elapsed;
        ride.SeekDemo(course.Length*.4); pausedDistance=ride.Distance; ride.Tick(.1);
        if(ride.Mode!="paused"||ride.Distance!=pausedDistance||ride.Elapsed!=savedElapsed||ride.Velocity!=0)throw new Exception("Paused seeking must preserve pause and time");
        foreach(var invalid in new[]{double.NaN,double.PositiveInfinity,double.NegativeInfinity})ride.SeekDemo(invalid);
        if(ride.Distance!=pausedDistance)throw new Exception("Non-finite seek");
        ride.ResumeAsync().GetAwaiter().GetResult(); ride.Tick(.1);
        if(ride.DemoSpeed!=2 || Math.Abs(ride.Distance-pausedDistance-1.24)>.001)throw new Exception("Resume demo speed");
        ride.SeekDemo(1000);ride.Tick(.1);
        if(ride.Mode!="demo"||Math.Abs(ride.Distance-1001.24)>.001||trainer.Control is not null)throw new Exception("Running seek without trainer control");
        ride.SeekDemo(-50);if(ride.Distance!=0)throw new Exception("Seek lower bound");
        ride.SeekDemo(course.Length+100);if(ride.Mode!="finished"||ride.Distance!=course.Length)throw new Exception("Seek upper bound");
        ride.SeekDemo(1000);if(ride.Mode!="paused"||ride.Distance!=1000)throw new Exception("Seek from finish");
        ride.ResumeAsync().GetAwaiter().GetResult();
        ride.JumpDemo(course.Length-10);ride.CycleDemoSpeed();ride.CycleDemoSpeed();ride.Tick(.25);
        if(ride.Mode!="finished" || ride.Distance!=course.Length || ride.Velocity!=0)throw new Exception("Fast demo must stop at finish");
        for(int i=0;i<30;i++) ride.Shift(1); if(ride.Gear != 12) throw new Exception("Gear upper bound");
        for(int i=0;i<30;i++) ride.Shift(-1); if(ride.Gear != 1) throw new Exception("Gear lower bound");
        ride.ResetAsync().GetAwaiter().GetResult(); if(ride.Distance != 0 || ride.Elapsed != 0 || ride.DemoSpeed!=1) throw new Exception("Route reset");

        var profileStore = new PreferencesStore(Path.Combine(Path.GetTempPath(), "MtbRideProfile-" + Guid.NewGuid().ToString("N") + ".json"), false);
        profileStore.Data.RiderKg = 83; profileStore.Data.Difficulty = .6; profileStore.Data.Chainring = 28;
        profileStore.Data.Bike = new BikeProfile { Name = "Test 1x6", BikeKg = 12.5, WheelCircumferenceM = 2.24,
            Sprockets = [46, 37, 28, 21, 16, 11], LowCadenceAssist = false };
        var customRide = new RideSession(course, trainer, heart, _ => { }, profileStore);
        if(customRide.GearCount!=6 || customRide.Gear!=6 || customRide.Chainring!=28 || customRide.RiderKg!=83 || customRide.Difficulty!=.6 || customRide.Bike.BikeKg!=12.5 || customRide.Bike.LowCadenceAssist)
            throw new Exception("Saved custom bike profile must initialize the ride and clamp its initial gear");
        var customState = JsonSerializer.SerializeToElement(customRide.Snapshot());
        if(customState.GetProperty("gearCount").GetInt32()!=6 || customState.GetProperty("sprocket").GetInt32()!=11 ||
            customState.GetProperty("bikeName").GetString()!="Test 1x6" || customState.GetProperty("bikeKg").GetDouble()!=12.5 ||
            Math.Abs(customState.GetProperty("development").GetDouble()-2.24*28/11)>.000001)
            throw new Exception("Ride snapshot must report the saved transmission and rollout");
        for(int i=0;i<30;i++)customRide.Shift(-1);
        customState=JsonSerializer.SerializeToElement(customRide.Snapshot());
        if(customRide.Gear!=1 || customState.GetProperty("sprocket").GetInt32()!=46 || Math.Abs(customState.GetProperty("development").GetDouble()-2.24*28/46)>.000001)
            throw new Exception("Custom lowest gear and development");
        for(int i=0;i<30;i++)customRide.Shift(1);
        if(customRide.Gear!=6)throw new Exception("Custom highest gear bound");
        profileStore.Data.Bike.Sprockets[0]=48;
        if(customRide.Bike.Sprockets[0]!=46)throw new Exception("Ride must own a copy of its saved cassette");
        customRide.StartAsync(true).GetAwaiter().GetResult();customRide.Tick(.1);
        profileStore.Data.Bike = new BikeProfile { Name="Test 1x4", BikeKg=10, WheelCircumferenceM=2.15, Sprockets=[50,34,22,11] };
        profileStore.Data.Chainring=30;profileStore.Data.RiderKg=90;
        customRide.ReloadProfile();
        if(customRide.GearCount!=6 || customRide.Bike.BikeKg!=12.5 || customRide.Chainring!=28 || customRide.RiderKg!=83)
            throw new Exception("Profile reload must not change a running session");
        customRide.PauseAsync().GetAwaiter().GetResult();customRide.ReloadProfile();
        customState=JsonSerializer.SerializeToElement(customRide.Snapshot());
        if(customRide.GearCount!=4 || customRide.Gear!=4 || customRide.Bike.BikeKg!=10 || customRide.Chainring!=30 || customRide.RiderKg!=90 ||
            Math.Abs(customState.GetProperty("development").GetDouble()-2.15*30/11)>.000001)
            throw new Exception("Paused profile reload must apply mass, chainring and cassette and clamp gear");
        customRide.ResetAsync().GetAwaiter().GetResult();
        if(customRide.Distance!=0 || customRide.Elapsed!=0 || customRide.GearCount!=4 || customRide.Bike.BikeKg!=10 || trainer.Control is not null)
            throw new Exception("Reset must preserve the selected bike without acquiring trainer control");
        customRide.StartAsync(false).GetAwaiter().GetResult();
        if(customRide.Running || trainer.Control is not null)throw new Exception("Custom profile must not bypass the real-trainer start guard");
    }
}
