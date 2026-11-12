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
    private readonly Equipment equipment;
    private readonly PreferencesStore preferences;
    private readonly CourseInfo[] courses;
    private CourseInfo selectedCourse;
    public RideSession Ride { get; private set; }

    public RidePanel(Equipment equipment,PreferencesStore preferences, Action devices, Action<string> log, string? smokeFile = null, bool smokeDemo = true)
    {
        this.devices = devices; this.log = log; this.smokeFile = smokeFile; this.smokeDemo = smokeDemo;
        this.equipment=equipment;this.preferences=preferences;courses=CourseCatalog.Load();
        selectedCourse=courses.FirstOrDefault(c=>c.Id==preferences.Data.CourseId)??courses.First();
        preferences.Data.CourseId=selectedCourse.Id;preferences.Save();
        Dock = DockStyle.Fill;
        Ride = NewRide();
        Controls.Add(web);
        clock.Tick += (_, _) =>
        {
            var now = time.Elapsed.TotalSeconds;
            Ride.Tick(now - lastTick); lastTick = now;
            if (ready && Ride.Running && (DateTime.UtcNow - heartbeat).TotalSeconds > 8)
                _ = Ride.PauseAsync("Vista 3D interrompuda · ruta pausada");
            if (ready && web.CoreWebView2 is not null)
                web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(Ride.Snapshot(equipment.Snapshot())));
        };
        clock.Start();
    }

    private RideSession NewRide()=>new(Course.Load(CourseCatalog.RouteFile(selectedCourse)),equipment.Connections[SensorRole.Trainer],equipment.Connections[SensorRole.HeartRate],log,preferences);
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
            core.ProcessFailed += async (_, _) => { ready = false; await Ride.PauseAsync("El motor 3D s’ha interromput. Reinicia MTB Indoor - Bern."); };
            core.WebMessageReceived += OnMessage;
            core.Navigate(CourseUrl);
        }
        catch (Exception e)
        {
            Controls.Add(new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter, ForeColor = Theme.Ink,
                Text = "No s’ha pogut carregar el circuit 3D.\n" + e.Message });
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
            switch (action)
            {
                case "ready": ready = true; heartbeat = DateTime.UtcNow; if (smokeFile is not null && smokeDemo) { await Ride.StartAsync(true); Ride.JumpDemo(selectedCourse.PreviewDistance); } break;
                case "heartbeat": heartbeat = DateTime.UtcNow; break;
                case "start": await Ride.StartAsync(false); break;
                case "demo": await Ride.StartAsync(true); break;
                case "pause": await Ride.PauseAsync(); break;
                case "stop": await Ride.ResetAsync(); break;
                case "devices": await Ride.PauseAsync("Ruta en pausa per configurar dispositius"); devices(); break;
                case "gear": Ride.Shift(message.GetProperty("delta").GetInt32()); break;
                case "settings": Ride.Configure(message.GetProperty("weight").GetDouble(), message.GetProperty("difficulty").GetDouble(),message.GetProperty("chainring").GetInt32()); break;
                case "course":
                    if(Ride.Running||Ride.Busy)break;
                    var chosen=courses.FirstOrDefault(c=>c.Id==message.GetProperty("id").GetString());
                    if(chosen is null||chosen.Id==selectedCourse.Id)break;
                    await Ride.ResetAsync();selectedCourse=chosen;preferences.Data.CourseId=chosen.Id;preferences.Save();Ride=NewRide();ready=false;web.CoreWebView2.Navigate(CourseUrl);break;
                case "error": await Ride.PauseAsync("Error 3D: " + message.GetProperty("message").GetString()); break;
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
        catch (Exception ex) { log("Circuit: " + ex.Message); }
    }

    public async Task ShutdownAsync() { clock.Stop(); await Ride.PauseAsync("MTB Indoor - Bern tancat"); }
    protected override void Dispose(bool disposing) { if (disposing) clock.Dispose(); base.Dispose(disposing); }
}
