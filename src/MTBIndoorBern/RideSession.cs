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
            throw new InvalidDataException("The course route is invalid.");
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
    private readonly CourseSector[] sectors;
    private readonly PreferencesStore? preferences;
    private readonly SemaphoreSlim operations = new(1, 1);
    private CancellationTokenSource? rideToken;
    private bool controlBusy, pedalled;
    private DateTime lastControl = DateTime.MinValue;
    private DateTime lastConfirmation = DateTime.MinValue;
    private TrainerControl? activeControl;
    private readonly TrainerLoad trainerLoad;
    private bool easierShiftPending;
    private string presentationEpoch = Guid.NewGuid().ToString("N");
    private long stateSequence, shiftSequence;
    private readonly string activityCourseId, activityCourseName;
    private RideActivityRecorder? activityRecorder;
    private double lastActivityCheckpoint;
    public event Action<RideActivity>? ActivityChanged;
    public RideActivity? CurrentActivity => activityRecorder?.Snapshot();
    public double? EstimatedCalories => !IsDemo && !Practice && activityRecorder?.ActiveSeconds > 0 ? activityRecorder.EstimatedCalories : null;
    public double? WorkKj => !IsDemo && !Practice && activityRecorder?.ActiveSeconds > 0 ? activityRecorder.MechanicalWorkJoules / 1000 : null;
    public double EnergyMeasuredSeconds => !IsDemo && !Practice ? activityRecorder?.ActiveSeconds ?? 0 : 0;
    private void NewPresentationEpoch() { presentationEpoch = Guid.NewGuid().ToString("N"); stateSequence = 0; }
    public BikeProfile Bike { get; private set; } = new();
    public int GearCount => Bike.Sprockets.Length;
    public Func<string> TrainerIdentity { get; set; } = () => "";
    private CalibrationResult? ValidCalibration => preferences?.Data.Calibration is { } c && c.IsValidFor(ProfileSettings.Signature(preferences.Data),TrainerIdentity()) ? c : null;
    public string Mode { get; private set; } = "ready";
    public string Message { get; private set; } = "Connect the KICKR and start riding, or explore in demo mode.";
    public double Distance { get; private set; }
    public double Velocity { get; private set; }
    public double Elapsed { get; private set; }
    public double Climbed { get; private set; }
    public string StartSector { get; private set; } = "";
    public double StartDistance { get; private set; }
    public bool CanSelectStart => !Busy && activeControl is null && Mode is "ready" or "finished";
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
    private double leverFront, leverRear, demoPhysicalVelocity;
    private bool leverFrontArmed, leverRearArmed;
    private bool FallbackBrakePressed => controllerBrake || (screenBrake && DateTime.UtcNow < screenBrakeUntil);
    private double FrontLeverPressure => leverFrontArmed ? leverFront : 0;
    private double RearLeverPressure => leverRearArmed ? leverRear : 0;
    public bool BrakePressed => FallbackBrakePressed || FrontLeverPressure > .01 || RearLeverPressure > .01;
    public void SetControllerBrake(bool pressed) => controllerBrake = pressed;
    public void SetScreenBrake(bool pressed) { screenBrake = pressed; screenBrakeUntil = DateTime.UtcNow.AddSeconds(.75); }
    public void SetLeverBrakes(double front, double rear)
    {
        static void Set(double value, ref double pressure, ref bool armed)
        {
            if (!double.IsFinite(value)) { pressure = 0; armed = false; return; }
            pressure = TrailHandling.Pressure(value);
            if (pressure <= .05) { pressure = 0; armed = true; }
        }
        Set(front, ref leverFront, ref leverFrontArmed); Set(rear, ref leverRear, ref leverRearArmed);
    }
    private void ResetBrakeInputs()
    {
        screenBrake = controllerBrake = false; leverFront = leverRear = demoPhysicalVelocity = 0;
        leverFrontArmed = leverRearArmed = false; Handling.Release();
    }

    public RideSession(Course course, SensorConnection trainer, SensorConnection heart, Action<string> log,PreferencesStore? preferences=null, string? routeFile=null, PersonalRecords? records=null,CourseSector[]? sectors=null,string? courseId=null,string? courseName=null)
    { this.course = course; this.trainer = trainer; this.heart = heart; this.log = log;this.preferences=preferences;
      activityCourseId = courseId ?? (routeFile is null ? "indoor" : Path.GetFileName(Path.GetDirectoryName(routeFile)) ?? "indoor");
      activityCourseName = courseName ?? activityCourseId;
      trainerLoad = new(course);
      CourseCatalog.ValidateSectors(sectors,course.Length);this.sectors=sectors?.ToArray()??[];
      Trail = new(course, routeFile); Descent = new(Trail, records ?? new PersonalRecords(null));
      ReloadProfile(); }

    public bool SelectStart(string? sectorId)
    {
        if(!CanSelectStart)return false;
        var sector=sectors.FirstOrDefault(s=>s.Id==sectorId);
        if(!string.IsNullOrEmpty(sectorId)&&sector is null)return false;
        StartSector=sector?.Id??"";StartDistance=sector?.Start??0;
        ResetProgress();Mode="ready";
        Message=sector is null?"Whole course selected · start at km 0":$"Start at {sector.Name} · km {StartDistance/1000:0.00} to the finish";
        return true;
    }

    public void Shift(int delta)
    {
        int previous = Gear;
        Gear = Math.Clamp(Gear + Math.Sign(delta), 1, GearCount);
        if (Gear < previous) easierShiftPending = true;
        if (Gear != previous) shiftSequence++;
    }
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
        NewPresentationEpoch();
        bool wasFinished = Mode == "finished";
        Distance = Math.Clamp(distance, 0, course.Length); Velocity = 0;
        Handling.Reset(); Descent.ResetAt(Distance); ResetBrakeInputs();
        if (Distance >= course.Length) { Mode = "finished"; Message = "Demo finished · click the profile to return to another point"; }
        else if (wasFinished) { Mode = "paused"; Message = "Demo paused · select Resume to continue from here"; }
        else Message = Mode == "paused" ? "Demo paused · position changed using the profile" : Practice ? "PRACTICE · new position · no record" : "DEMO · position changed using the profile";
    }
    public Task ResumeAsync() => Mode == "paused" && !Busy ? StartAsync(IsDemo) : Task.CompletedTask;
    public async Task StartPracticeAsync()
    {
        if (Trail.Stage is null || Busy || Running) return;
        await ResetAsync(); await StartAsync(true);
        Practice = true; JumpDemo(Math.Max(0, Trail.Stage.Start - 55)); Velocity = 5;
        Message = "PRACTICE · hold A / Space to brake · no KICKR control or record";
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
        Gear=Math.Clamp(Gear,1,GearCount); trainerLoad.Reset(); easierShiftPending = false; Descent.Invalidate();
    }
    private bool Fresh => trainer.Connected && trainer.LastPowerPacket.HasValue && (DateTime.UtcNow - trainer.LastPowerPacket.Value).TotalSeconds < 5 && trainer.LastCadencePacket.HasValue && (DateTime.UtcNow - trainer.LastCadencePacket.Value).TotalSeconds < 5 && trainer.Power.HasValue;

    public async Task StartAsync(bool demo)
    {
        await operations.WaitAsync(); Busy = true;
        try
        {
            if (Running) return;
            if (!demo && (!Fresh || trainer.Control?.SupportsPower!=true||!trainer.Cadence.HasValue))
                throw new InvalidOperationException("Waiting for KICKR power and cadence. Pedal for a few seconds, then start again.");
            if (Distance >= course.Length || IsDemo != demo) ResetProgress();
            IsDemo = demo;
            if (!demo) Practice = false;
            if (!demo)
            {
                activeControl = trainer.Control;
                rideToken?.Dispose(); rideToken = new CancellationTokenSource();
                await activeControl!.StartAsync(rideToken.Token,true);
            }
            trainerLoad.Reset(); easierShiftPending = false;
            if (!demo)
            {
                if (activityRecorder is null || activityRecorder.IsComplete)
                    activityRecorder = new(activityCourseId, activityCourseName, DateTimeOffset.UtcNow, Distance);
                else activityRecorder.Resume(DateTimeOffset.UtcNow, Distance);
            }
            Mode = demo ? "demo" : "ride";
            NewPresentationEpoch();
            ResetBrakeInputs();
            Message = Practice ? "PRACTICE · hold A / Space to brake · no KICKR control or record" : demo ? "DEMO · automatic ride, without KICKR control" : $"MTB 1×{GearCount} · + shifts up · B shifts down";
            pedalled = demo || pedalled; lastControl = DateTime.MinValue; lastConfirmation = DateTime.UtcNow;
            log(demo ? "3D demo started. KICKR control is inactive." : "Ride started. KICKR control confirmed.");
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
            activityRecorder?.Pause();
            if (Mode == "finished") FinishActivity(); else PublishActivity();
            Descent.Invalidate(); ResetBrakeInputs();
            Message = reason ?? "Ride paused · resistance released";
            string? failure = await ReleaseControlAsync();
            if (failure is not null) Message += " · " + failure;
            log(Message);
        }
        finally { Busy = false; operations.Release(); }
    }

    public async Task ResetAsync()
    {
        await PauseAsync("Ride stopped");
        ResetProgress(); Mode = "ready";
    }
    public RideActivity? FinishActivity()
    {
        if (activityRecorder is null) return null;
        if (!activityRecorder.IsComplete) { activityRecorder.Complete(); PublishActivity(); }
        return activityRecorder.Snapshot();
    }
    private void PublishActivity()
    {
        if (activityRecorder is null) return;
        lastActivityCheckpoint = activityRecorder.ActiveSeconds;
        if (ActivityChanged is null || activityRecorder.Snapshot() is not { } activity) return;
        foreach (Action<RideActivity> handler in ActivityChanged.GetInvocationList())
            try { handler(activity); } catch (Exception e) { try { log("Could not save the activity: " + e.Message); } catch { } }
    }
    private void ResetProgress() { FinishActivity(); activityRecorder = null; lastActivityCheckpoint = 0; NewPresentationEpoch(); Distance = StartDistance; Elapsed = 0; Velocity = 0; Climbed = 0; pedalled = false; DemoSpeed = 1; Practice = false; Handling.Reset(); if(StartDistance>0)Descent.ResetAt(StartDistance);else Descent.Reset(); ResetBrakeInputs(); }
    private async Task<string?> ReleaseControlAsync()
    {
        rideToken?.Cancel();
        trainerLoad.Reset(); easierShiftPending = false;
        var control = activeControl; activeControl = null;
        if (control is null) return null;
        try { await control.StopAsync(); return null; }
        catch (Exception e) { return e.Message; }
    }

    public void Tick(double dt)
    {
        if (!Running || Busy) return;
        double measuredInterval = dt;
        dt = Math.Clamp(dt, 0, .25);
        if (Live && (!Fresh || activeControl != trainer.Control || activeControl?.IsControlling != true))
        { _ = PauseAsync("Ride paused: KICKR signal or control was lost"); return; }
        // Small fixed upper step keeps braking and corner penalties stable at 10 Hz or after a delayed frame.
        for (double remaining = dt; remaining > .000001;)
        {
            double step = Math.Min(.025, remaining); remaining -= step;
            var before = course.At(Distance); double oldDistance = Distance;
            int watts = Practice ? (before.Grade > -1.3 ? 160 : 0) : IsDemo ? 170 : Math.Max(0, trainer.Power ?? 0);
            if (watts > 10 || before.Grade < -1.1) pedalled = true;
            if (pedalled)
            {
                if (IsDemo && !Practice)
                {
                    demoPhysicalVelocity = Handling.StepDemo(demoPhysicalVelocity, FallbackBrakePressed, FrontLeverPressure, RearLeverPressure, step);
                    Velocity = demoPhysicalVelocity * DemoSpeed;
                }
                else Velocity = Handling.Step(Velocity, watts, before.Grade, RiderKg, FallbackBrakePressed, Trail.At(Distance), Distance, step, Bike, Trail.SurfaceAt(Distance), FrontLeverPressure, RearLeverPressure);
                Distance = Math.Min(course.Length, Distance + Velocity * step);
                Elapsed += step;
                Climbed += Math.Max(0, course.At(Distance).Alt - before.Alt);
            }
            if (!IsDemo || Practice) Descent.Tick(oldDistance, Distance, step, Live && StartDistance==0, Handling.OffTracks);
        }
        if (Live && !IsDemo && !Practice && activityRecorder is not null)
        {
            activityRecorder.Record(DateTimeOffset.UtcNow, measuredInterval, Distance, trainer.Power,
                trainer.Cadence, heart.HeartRateFresh ? heart.HeartRate : null, Fresh);
            if (activityRecorder.ActiveSeconds - lastActivityCheckpoint >= 30) PublishActivity();
        }
        if (Distance >= course.Length) { _ = PauseAsync("Course complete. Enjoy the ride!"); return; }
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
            bool easierShift = easierShiftPending; easierShiftPending = false;
            var target = trainerLoad.NextPower(Distance,Difficulty,Gear,cadence,RiderKg,Chainring,Bike,
                Trail.SurfaceAt(Distance),controlDt,ValidCalibration?.TorqueRiseNmPerSecond ?? 5,easierShift);
            if (Math.Abs(target - control.AppliedPower) >= 2 || (DateTime.UtcNow - lastConfirmation).TotalSeconds >= 5)
            {
                await control.SetPowerAsync((int)Math.Round(target), token);
                lastConfirmation = DateTime.UtcNow;
            }
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { }
        catch (Exception e) { if (Live) await PauseAsync("Control interrupted: " + e.Message); }
        finally { controlBusy = false; }
    }

    public object Snapshot(object? devices=null)
    {
        var p = course.At(Distance);
        bool hrFresh = heart.HeartRateFresh;
        // Demo cadence/power are display values, not drivetrain telemetry. Supply explicit
        // presentation semantics without feeding the sound adapter back into ride physics.
        bool coasting = IsDemo ? (p.Grade <= -1.3 || BrakePressed) : Fresh && (trainer.Power <= 5 || trainer.Cadence <= 2);
        double audioBrake = Handling.Brake;
        return new { type = "state", mode = Mode, message = Message, distance = Distance, speed = Velocity * 3.6, elapsed = Elapsed,
            presentationEpoch, stateSequence = ++stateSequence, shiftSequence, hostTimeMs = Environment.TickCount64,
            calories = EstimatedCalories, workKj = WorkKj, energyMeasuredSeconds = EnergyMeasuredSeconds,
            activityId = !IsDemo && !Practice && activityRecorder?.ActiveSeconds > 0 ? activityRecorder.Id : null,
            presentation = (preferences?.Data.Presentation ?? new PresentationPreferences()).Snapshot(),
            surface = Trail.SurfaceAt(Distance), audio = new { coasting, brake = audioBrake, synthetic = IsDemo },
            climbed = Climbed, grade = p.Grade, altitude = p.Alt, gear = Gear, weight = RiderKg, difficulty = Difficulty, busy = Busy,
            devices,chainring=Chainring,sprocket=Bike.Sprockets[Gear-1],development=BikeDynamics.Development(Gear,Chainring,Bike),gearCount=GearCount,bikeName=Bike.Name,bikeKg=Bike.BikeKg,calibrated=ValidCalibration is not null,settingsWarning=preferences?.Warning,
            watts = Practice ? (Running && p.Grade > -1.3 ? 160 : 0) : IsDemo && Running ? 170 : Fresh ? trainer.Power : null,
            cadence = Practice ? 0 : IsDemo && Running ? 82 : Fresh ? trainer.Cadence : null,
            heart = hrFresh ? heart.HeartRate : null, trainer = trainer.Connected, hr = hrFresh,
            control = activeControl?.IsControlling == true, targetPower = activeControl?.AppliedPower,
            trainerGrade = trainerLoad.GradeAt(Distance),
            controlStatus = trainer.Control?.Status ?? trainer.ControlInfo,
            length = course.Length, demo = IsDemo, demoSpeed = DemoSpeed, practice = Practice, canSeek = CanSeek,
            startSector=StartSector,startDistance=StartDistance,canSelectStart=CanSelectStart,riddenDistance=Math.Max(0,Distance-StartDistance),sector=SectorSnapshot(),
            brake = BrakePressed, brakePressure = Handling.Brake, slip = Handling.Slip, recovery = Handling.Recovery, skidSide = Handling.Side,
            frontBrake = Handling.FrontBrake, rearBrake = Handling.RearBrake, frontSlip = Handling.FrontSlip, rearSlip = Handling.RearSlip,
            crashSequence = Handling.CrashSequence, crashKind = Handling.CrashKind,
            physicalSpeedKmh = (IsDemo && !Practice ? demoPhysicalVelocity : Velocity) * 3.6,
            corner = CornerSnapshot(), descent = Descent.Snapshot(Distance, Handling.OffTracks) };
    }
    private object? SectorSnapshot()
    {
        int index=Array.FindLastIndex(sectors,s=>Distance>=s.Start);
        if(index<0)return null;
        var sector=sectors[index];
        return new {id=sector.Id,name=sector.Name,start=sector.Start,end=sector.End,index=index+1,count=sectors.Length};
    }
    private object? CornerSnapshot()
    {
        var c = Trail.Next(Distance); if (c is null) return null;
        return new { distance = Math.Max(0, c.Start - Distance), limit = c.Limit * 3.6, direction = c.Direction, surface = c.Surface,
            urgent = Velocity > c.Limit * 1.04 && c.Start - Distance < Math.Max(25, (Velocity * Velocity - c.Limit * c.Limit) / 7 + Velocity * 1.4) };
    }

    private static void VerifyBrakeLifecycle(Course course, SensorConnection trainer, SensorConnection heart)
    {
        static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
        var ride = new RideSession(course, trainer, heart, _ => { });
        ride.SetLeverBrakes(1, 1); ride.StartAsync(true).GetAwaiter().GetResult();
        for (int i = 0; i < 10; i++) { ride.SetLeverBrakes(1, 1); ride.Tick(.1); }
        Check(ride.Handling.Brake == 0 && ride.Handling.CrashSequence == 0, "A lever held before start must be released before it can brake");
        ride.SetLeverBrakes(1, 0); ride.Tick(.1); ride.SetLeverBrakes(1, 1); ride.Tick(.1);
        Check(ride.Handling.RearBrake > 0 && ride.Handling.FrontBrake == 0, "Session release-arming is independent for front and rear levers");
        ride.PauseAsync().GetAwaiter().GetResult();
        Check(ride.Handling.Brake == 0 && ride.Handling.RearSlip == 0 && !ride.BrakePressed, "Pause clears both lever pressures and slip effects");
        ride.ResumeAsync().GetAwaiter().GetResult();
        for (int i = 0; i < 5; i++) { ride.SetLeverBrakes(1, 1); ride.Tick(.1); }
        Check(ride.Handling.Brake == 0, "Resume requires released levers before accepting held hardware input");
        ride.SetLeverBrakes(0, 0); ride.Tick(.1); ride.SetLeverBrakes(1, 0);
        for (int i = 0; i < 10 && ride.Handling.Recovery == 0; i++) ride.Tick(.1);
        Check(ride.Handling.CrashKind == "front-lock" && ride.Handling.CrashSequence == 1 && ride.Running, "A front lock is a virtual recovery, not a session pause");
        double stoppedAt = ride.Distance, elapsedAt = ride.Elapsed;
        for (int i = 0; i < 20; i++) ride.Tick(.1);
        Check(ride.Distance == stoppedAt && Math.Abs(ride.Elapsed - elapsedAt - 2) < 1e-8 && ride.Running, "Recovery costs elapsed time without moving the avatar or stopping the session");
        for (int i = 0; i < 50; i++) ride.Tick(.1);
        Check(ride.Handling.CrashSequence == 1 && ride.Handling.Recovery == 0, "A continuously held front lever cannot replay a fall after recovery");
        Check(ride.CurrentActivity is null && ride.EstimatedCalories is null && trainer.Control is null, "Brake exploration still creates neither trainer commands nor synthetic workout calories");

        ride.SeekDemo(0); ride.SetLeverBrakes(1, 1); ride.Tick(.1);
        Check(ride.Handling.Brake == 0 && ride.Handling.Recovery == 0 && ride.Handling.CrashKind is null, "Seeking clears crash effects and rearms held lever input");
        for (int i = 0; i < 3; i++) { ride.CycleDemoSpeed(); ride.Tick(.1); }
        var state = JsonSerializer.SerializeToElement(ride.Snapshot());
        Check(ride.DemoSpeed == 8 && Math.Abs(state.GetProperty("physicalSpeedKmh").GetDouble() - 6.2 * 3.6) < 1e-8 && Math.Abs(ride.Velocity - 6.2 * 8) < 1e-8,
            "Demo acceleration changes route speed while snapshot physical speed stays capped");
        ride.SetLeverBrakes(0, 0); ride.Tick(.1); ride.SetLeverBrakes(double.NaN, double.PositiveInfinity); ride.Tick(.1);
        Check(ride.Handling.Brake == 0, "Invalid hardware pressures clear and disarm both channels");
        ride.ResetAsync().GetAwaiter().GetResult(); ride.StartAsync(true).GetAwaiter().GetResult(); ride.SetLeverBrakes(1, 1); ride.Tick(.1);
        Check(ride.Handling.OffTracks == 0 && ride.Handling.Brake == 0 && ride.Handling.Recovery == 0, "Restart clears penalties and requires a fresh release before braking");
        ride.PauseAsync().GetAwaiter().GetResult();
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
        for(int i=0;i<course.Points.Length-1;i++){var a=course.Points[i];var b=course.Points[i+1];var gradient=(b.Y-a.Y)/Math.Sqrt(Math.Pow(b.X-a.X,2)+Math.Pow(b.Z-a.Z,2))*100;if(Math.Abs(gradient-a.Grade)>.002)throw new Exception("Rendered slope differs from local physics slope");}
        if (!TrainerControl.SimulationPacket(-2.5).SequenceEqual(new byte[]{0x11,0,0,6,255,40,51})) throw new Exception("Signed FTMS encoding");
        if (TrainerControl.SimulationPacket(50)[3] != 32) throw new Exception("FTMS clamp");
        using var trainer = new SensorConnection(SensorRole.Trainer);
        using var heart = new SensorConnection(SensorRole.HeartRate);
        var ride = new RideSession(course, trainer, heart, _ => { });
        var initialView = JsonSerializer.SerializeToElement(ride.Snapshot());
        var nextView = JsonSerializer.SerializeToElement(ride.Snapshot());
        if (initialView.GetProperty("presentationEpoch").GetString() != nextView.GetProperty("presentationEpoch").GetString() ||
            nextView.GetProperty("stateSequence").GetInt64() <= initialView.GetProperty("stateSequence").GetInt64() ||
            nextView.GetProperty("hostTimeMs").GetInt64() < initialView.GetProperty("hostTimeMs").GetInt64() ||
            nextView.GetProperty("surface").GetString() != ride.Trail.SurfaceAt(ride.Distance))
            throw new Exception("Presentation snapshot sequence, clock and current surface");
        if (initialView.GetProperty("calories").ValueKind != JsonValueKind.Null || initialView.GetProperty("activityId").ValueKind != JsonValueKind.Null || ride.CurrentActivity is not null)
            throw new Exception("No calories or real activity before trainer measurements");
        long shifts = initialView.GetProperty("shiftSequence").GetInt64();
        ride.Shift(0);
        if (JsonSerializer.SerializeToElement(ride.Snapshot()).GetProperty("shiftSequence").GetInt64() != shifts) throw new Exception("Ignored shift must remain silent");
        ride.Shift(1); ride.Shift(-1);
        if (JsonSerializer.SerializeToElement(ride.Snapshot()).GetProperty("shiftSequence").GetInt64() != shifts + 2) throw new Exception("Only confirmed actual shifts advance the sound counter");
        ride.SeekDemo(100); if(ride.Distance!=0||ride.CanSeek)throw new Exception("Seeking before demo");
        ride.CycleDemoSpeed(); if(ride.DemoSpeed != 1) throw new Exception("Demo speed outside demo");
        ride.StartAsync(false).GetAwaiter().GetResult();
        if (ride.Running || ride.Distance != 0) throw new Exception("Live start without trainer");
        ride.SeekDemo(100); if(ride.Distance!=0||ride.CanSeek)throw new Exception("Seeking a real paused session");
        ride.StartAsync(true).GetAwaiter().GetResult();
        var demoView = JsonSerializer.SerializeToElement(ride.Snapshot());
        if (demoView.GetProperty("presentationEpoch").GetString() == initialView.GetProperty("presentationEpoch").GetString() ||
            !demoView.GetProperty("audio").GetProperty("synthetic").GetBoolean()) throw new Exception("Demo must start a new presentation epoch with explicit synthetic audio semantics");
        for(int i=0;i<100;i++) ride.Tick(.1);
        if (Math.Abs(ride.Distance - 62) > .01 || trainer.Control is not null) throw new Exception("Demo must advance without controlling trainer");
        if (ride.CurrentActivity is not null || ride.EstimatedCalories is not null || ride.WorkKj is not null || ride.EnergyMeasuredSeconds != 0)
            throw new Exception("Synthetic demo watts must not create calories or a Strava activity");
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
        string? epochBeforeSeek = JsonSerializer.SerializeToElement(ride.Snapshot()).GetProperty("presentationEpoch").GetString();
        ride.SeekDemo(course.Length*.4); pausedDistance=ride.Distance; ride.Tick(.1);
        string? epochAfterSeek = JsonSerializer.SerializeToElement(ride.Snapshot()).GetProperty("presentationEpoch").GetString();
        if (epochBeforeSeek == epochAfterSeek) throw new Exception("Seek must invalidate presentation interpolation and old audio events");
        if(ride.Mode!="paused"||ride.Distance!=pausedDistance||ride.Elapsed!=savedElapsed||ride.Velocity!=0)throw new Exception("Paused seeking must preserve pause and time");
        foreach(var invalid in new[]{double.NaN,double.PositiveInfinity,double.NegativeInfinity})ride.SeekDemo(invalid);
        if (JsonSerializer.SerializeToElement(ride.Snapshot()).GetProperty("presentationEpoch").GetString() != epochAfterSeek) throw new Exception("Ignored seek must not reset presentation");
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

        // Exercise archive lifecycle with a synthetic in-memory recorder, without
        // starting a trainer or bypassing the real ride start guard.
        var archiveRide = new RideSession(course, trainer, heart, _ => { });
        var activityStart = new DateTimeOffset(2026, 1, 2, 12, 0, 0, TimeSpan.Zero);
        archiveRide.activityRecorder = new("test", "Synthetic archive fixture", activityStart, 0);
        archiveRide.activityRecorder.Record(activityStart.AddSeconds(1), 1, 6, 200, 80, null, true);
        var saved = new List<RideActivity>();
        archiveRide.ActivityChanged += _ => throw new IOException("Synthetic persistence failure");
        archiveRide.ActivityChanged += saved.Add;
        archiveRide.ResetAsync().GetAwaiter().GetResult();
        archiveRide.FinishActivity();
        if (saved.Count(s => s.IsComplete) != 1 || saved[^1].MechanicalWorkJoules != 200 || archiveRide.CurrentActivity is not null || archiveRide.EstimatedCalories is not null)
            throw new Exception("Reset archives measured work before clearing and isolates persistence errors");
        archiveRide.activityRecorder = new("test", "Synthetic finish fixture", activityStart, 0);
        archiveRide.activityRecorder.Record(activityStart.AddSeconds(1), 1, 6, 200, 80, null, true);
        archiveRide.Distance = course.Length;
        archiveRide.PauseAsync().GetAwaiter().GetResult();
        if (archiveRide.CurrentActivity?.IsComplete != true || archiveRide.EstimatedCalories is null)
            throw new Exception("Course finish retains the completed calorie summary");

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
        VerifyBrakeLifecycle(course, trainer, heart);
    }
}
