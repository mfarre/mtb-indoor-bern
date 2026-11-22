using System.Diagnostics;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MTBIndoorBern;

internal sealed class RidePanel : Panel
{
    private readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Theme.Background };
    private readonly System.Windows.Forms.Timer clock = new() { Interval = 100 };
    private readonly Stopwatch time = Stopwatch.StartNew();
    private readonly Action devices;
    private readonly Action<string> log;
    private readonly string? smokeFile;
    private readonly bool smokeDemo;
    private double lastTick;
    private DateTime heartbeat = DateTime.UtcNow;
    private bool ready, initialized, captured;
    private bool controllerWasConnected;
    private readonly Equipment equipment;
    private readonly PreferencesStore preferences;
    private readonly CourseInfo[] courses;
    private CourseInfo selectedCourse;
    private readonly CalibrationTrainerAdapter trainerAdapter;
    private readonly CalibrationSession calibration;
    private bool profileOpen;
    private double lastProfilePost;
    public bool CalibrationActive => calibration.Active;
    public RideSession Ride { get; private set; }

    public RidePanel(Equipment equipment,PreferencesStore preferences, Action devices, Action<string> log, string? smokeFile = null, bool smokeDemo = true)
    {
        this.devices = devices; this.log = log; this.smokeFile = smokeFile; this.smokeDemo = smokeDemo;
        this.equipment=equipment;this.preferences=preferences;courses=CourseCatalog.Load();
        selectedCourse=courses.FirstOrDefault(c=>c.Id==preferences.Data.CourseId)??courses.First();
        preferences.Data.CourseId=selectedCourse.Id;preferences.Save();
        Dock = DockStyle.Fill;
        trainerAdapter=new(equipment);calibration=new(trainerAdapter,log);
        calibration.Completed+=OnCalibrationCompleted;
        Ride = NewRide();
        Controls.Add(web);
        clock.Tick += (_, _) =>
        {
            var now = time.Elapsed.TotalSeconds;
            var controller = equipment.Connections[SensorRole.Controller];
            if (controllerWasConnected && !controller.Connected && Ride.Live) _ = Ride.PauseAsync("Click disconnected · ride paused to restore braking");
            controllerWasConnected = controller.Connected;
            Ride.SetControllerBrake(controller.Connected && controller.BrakePressed);
            double dt=now-lastTick;lastTick=now;
            calibration.Tick(dt);
            if(!calibration.Active)Ride.Tick(dt);
            if (ready && (Ride.Running||calibration.Active) && (DateTime.UtcNow - heartbeat).TotalSeconds > 8)
                _ = PauseAllAsync("View interrupted · load released");
            if (ready && web.CoreWebView2 is not null)
                {
                web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(Ride.Snapshot(equipment.Snapshot())));
                if(profileOpen){PostCalibration();if(now-lastProfilePost>=1){lastProfilePost=now;PostProfile();}}
            }
        };
        clock.Start();
    }

    private RideSession NewRide()=>new(Course.Load(CourseCatalog.RouteFile(selectedCourse)),equipment.Connections[SensorRole.Trainer],equipment.Connections[SensorRole.HeartRate],log,preferences,CourseCatalog.RouteFile(selectedCourse),new PersonalRecords(Path.Combine(AppContext.BaseDirectory,"records.json"))){TrainerIdentity=()=>trainerAdapter.Identity};
    private string CourseUrl=>"https://mtbindoor.local/index.html?course="+Uri.EscapeDataString(selectedCourse.Id);

    public async Task InitializeAsync()
    {
        if (initialized) return; initialized = true;
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null,
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MTBIndoorBern", "WebView"));
            await web.EnsureCoreWebView2Async(env);
            var core = web.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.SetVirtualHostNameToFolderMapping("mtbindoor.local", Path.Combine(AppContext.BaseDirectory, "Scene"), CoreWebView2HostResourceAccessKind.DenyCors);
            core.NavigationStarting += (_, e) => { if (!e.Uri.StartsWith("https://mtbindoor.local/", StringComparison.Ordinal)) e.Cancel = true; };
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.ProcessFailed += async (_, _) => { ready = false; await PauseAllAsync("The 3D engine stopped. Restart MTB Indoor - Bern."); };
            core.WebMessageReceived += OnMessage;
            // The same virtual origin serves new local assets after an application update.
            await core.Profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.DiskCache);
            core.Navigate(CourseUrl);
        }
        catch (Exception e)
        {
            Controls.Add(new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter, ForeColor = Theme.Ink,
                Text = "Could not load the 3D course.\n" + e.Message });
            Controls[Controls.Count - 1].BringToFront(); log(e.Message);
        }
    }

    private async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!e.Source.StartsWith("https://mtbindoor.local/", StringComparison.Ordinal)) return;
        try
        {
            using var json = JsonDocument.Parse(e.WebMessageAsJson);
            var message = json.RootElement;
            var action = message.GetProperty("action").GetString();
            if(calibration.Active && action is not ("heartbeat" or "stats" or "error" or "pause" or "stop" or "devices" or "profile-request" or "profile-close" or "calibration-cancel" or "profile-save")) {PostCalibration();return;}
            if(profileOpen && action is ("start" or "demo" or "practice" or "resume" or "course" or "settings" or "preview"))return;
            switch (action)
            {
                case "ready": web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type="catalog", ids=courses.Select(c=>c.Id).ToArray() })); ready = true; heartbeat = DateTime.UtcNow; web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(Ride.Trail.Snapshot())); if (smokeFile is not null && smokeDemo) { await Ride.StartAsync(true); Ride.JumpDemo(selectedCourse.PreviewDistance); } break;
                case "heartbeat": heartbeat = DateTime.UtcNow; break;
                case "profile-request":
                    profileOpen=true;
                    if(!calibration.Active)await Ride.PauseAsync("Ride paused · bike setup");
                    PostProfile();PostCalibration();break;
                case "profile-close": profileOpen=false;await calibration.CancelAsync("Test stopped when calibration was closed");break;
                case "profile-save":
                    if(calibration.Active||Ride.Running||Ride.Busy){PostProfile(error:"Stop the test before changing the profile.");break;}
                    try
                    {
                        var input=JsonSerializer.Deserialize<ProfileInput>(message.GetProperty("profile").GetRawText(),ProfileSettings.JsonOptions);
                        if(input is null){PostProfile(error:"Invalid profile.");break;}
                        if(!ProfileSettings.Save(preferences,input,out var validationError)){PostProfile(error:validationError);break;}
                        Ride.ReloadProfile();PostProfile(notice:"Profile saved. The settings apply to your next rides.",saved:true);
                    }
                    catch(JsonException){PostProfile(error:"Check the profile values.");}
                    break;
                case "calibration-start":
                    if(!profileOpen||Ride.Running||Ride.Busy||equipment.Busy(SensorRole.Trainer)){PostCalibration();PostProfile();break;}
                    await calibration.StartAsync(ProfileSettings.Signature(preferences.Data));PostCalibration();break;
                case "calibration-cancel": await calibration.CancelAsync("Test stopped · load released");PostCalibration();PostProfile();break;
                case "calibration-forget":
                    if(calibration.Active)break;
                    var previousCalibration=preferences.Data.Calibration;preferences.Data.Calibration=null;preferences.Save();
                    if(preferences.Warning is not null)preferences.Data.Calibration=previousCalibration;
                    PostProfile(notice:preferences.Warning is null?"Result removed. Using the standard response.":null,error:preferences.Warning);break;
                case "start": await Ride.StartAsync(false); break;
                case "demo": await Ride.StartAsync(true); break;
                case "preview":
                    if(Ride.Running||Ride.Busy)break;
                    double preview=message.GetProperty("distance").GetDouble();if(!double.IsFinite(preview))break;
                    await Ride.ResetAsync();await Ride.StartAsync(true);Ride.JumpDemo(preview);break;
                case "demo-speed": Ride.CycleDemoSpeed(); break;
                case "practice": await Ride.StartPracticeAsync(); break;
                case "brake": Ride.SetScreenBrake(message.GetProperty("pressed").GetBoolean()); break;
                case "pause": await PauseAllAsync("Ride paused · load released"); break;
                case "resume": await Ride.ResumeAsync(); break;
                case "seek": Ride.SeekDemo(message.GetProperty("distance").GetDouble()); break;
                case "stop": await calibration.CancelAsync("Test stopped");await Ride.ResetAsync(); break;
                case "devices": await PauseAllAsync("Ride paused to configure devices"); devices(); break;
                case "gear": Ride.Shift(message.GetProperty("delta").GetInt32()); break;
                case "settings": Ride.Configure(message.GetProperty("weight").GetDouble(), message.GetProperty("difficulty").GetDouble(),message.GetProperty("chainring").GetInt32()); break;
                case "course":
                    if(Ride.Running||Ride.Busy)break;
                    var chosen=courses.FirstOrDefault(c=>c.Id==message.GetProperty("id").GetString());
                    if(chosen is null||chosen.Id==selectedCourse.Id)break;
                    await Ride.ResetAsync();selectedCourse=chosen;preferences.Data.CourseId=chosen.Id;preferences.Save();Ride=NewRide();ready=false;web.CoreWebView2.Navigate(CourseUrl);break;
                case "error": await PauseAllAsync("3D error: " + message.GetProperty("message").GetString()); break;
                case "stats":
                    if (smokeFile is not null && !captured && time.Elapsed.TotalSeconds > 12)
                    {
                        captured = true;
                        File.WriteAllText(smokeFile, message.GetRawText());
                        using var stream = File.Create(Path.ChangeExtension(smokeFile, ".png"));
                        await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
                        BeginInvoke(() => FindForm()?.Close());
                    }
                    break;
            }
        }
        catch (Exception ex) { log("Course: " + ex.Message); }
    }

    private void PostProfile(string? notice=null,string? error=null,bool saved=false)
    {
        if(web.CoreWebView2 is null)return;
        var result=preferences.Data.Calibration;
        web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new {type="bike-profile",profile=ProfileSettings.Snapshot(preferences.Data),
            calibrationResult=result?.Snapshot(),calibrationValid=result?.IsValidFor(ProfileSettings.Signature(preferences.Data),trainerAdapter.Identity)==true,
            trainerConnected=trainerAdapter.Connected,canCalibrate=trainerAdapter.Connected&&trainerAdapter.SupportsPower&&!equipment.Busy(SensorRole.Trainer)&&!calibration.Active&&!Ride.Running&&!Ride.Busy,
            notice,error,saved,settingsWarning=preferences.Warning},ProfileSettings.JsonOptions));
    }
    private void PostCalibration(){if(web.CoreWebView2 is not null)web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(calibration.Snapshot(),ProfileSettings.JsonOptions));}
    private void OnCalibrationCompleted(CalibrationResult result)
    {
        if(InvokeRequired){BeginInvoke(()=>OnCalibrationCompleted(result));return;}
        if(!result.IsValidFor(ProfileSettings.Signature(preferences.Data),trainerAdapter.Identity))return;
        var previous=preferences.Data.Calibration;preferences.Data.Calibration=result;preferences.Save();
        if(preferences.Warning is not null)preferences.Data.Calibration=previous;
        PostProfile(notice:preferences.Warning is null?"Response calibration completed and saved.":null,error:preferences.Warning);
    }
    public async Task PauseAllAsync(string reason){await calibration.CancelAsync(reason);await Ride.PauseAsync(reason);}
    public void OpenProfile(){if(ready&&web.CoreWebView2 is not null)web.CoreWebView2.PostWebMessageAsJson("{\"type\":\"open-profile\"}");}
    public Task CancelCalibrationAsync(string reason)=>calibration.CancelAsync(reason);
    public async Task ShutdownAsync() { clock.Stop(); await PauseAllAsync("MTB Indoor - Bern closed"); }
    protected override void Dispose(bool disposing) { if (disposing) clock.Dispose(); base.Dispose(disposing); }
}
