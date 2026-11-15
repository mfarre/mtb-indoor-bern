using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed record CaptureSpec(string SceneFolder, string OutputFolder, double StartMeters = 4000,
    double SpeedMps = 6.2, int Seconds = 10, int Fps = 12, string CourseId = "al-dente");

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var path=args.Length>0?args[0]:Path.Combine(AppContext.BaseDirectory,"capture.json");
        try
        {
            var spec=JsonSerializer.Deserialize<CaptureSpec>(File.ReadAllText(path),new JsonSerializerOptions{PropertyNameCaseInsensitive=true})!;
            if(!Directory.Exists(spec.SceneFolder)||spec.Seconds is <1 or >60||spec.Fps is <1 or >30||!double.IsFinite(spec.StartMeters)||spec.StartMeters<0||!double.IsFinite(spec.SpeedMps)||spec.SpeedMps is <=0 or >50)
                throw new InvalidDataException("Invalid capture settings");
            Directory.CreateDirectory(spec.OutputFolder);
            Application.Run(new CaptureForm(spec));
        }
        catch(Exception ex){MessageBox.Show(ex.Message,"Render capture");Environment.ExitCode=1;}
    }
}

internal sealed class CaptureForm:Form
{
    private readonly WebView2 web=new(){Dock=DockStyle.Fill};
    private readonly CaptureSpec spec;
    private int frame;
    private bool started,closing;
    private readonly System.Windows.Forms.Timer watchdog=new(){Interval=30000};
    public CaptureForm(CaptureSpec spec)
    {
        this.spec=spec;Text="MTB Indoor · Captura de comparació";ClientSize=new Size(960,540);
        AutoScaleMode=AutoScaleMode.None;StartPosition=FormStartPosition.CenterScreen;Controls.Add(web);
        watchdog.Tick+=(_,_)=>Fail(new TimeoutException("No rendered frame received within 30 seconds"));
        Shown+=async(_,_)=>{try{await InitializeAsync();}catch(Exception ex){Fail(ex);}};
        FormClosing+=(_,_)=>{closing=true;watchdog.Stop();};
    }
    private async Task InitializeAsync()
    {
        var env=await CoreWebView2Environment.CreateAsync(null,Path.Combine(Path.GetTempPath(),"MTBIndoorRenderCapture"));
        await web.EnsureCoreWebView2Async(env);var core=web.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled=false;core.Settings.IsStatusBarEnabled=false;
        var source=Path.GetFullPath(spec.SceneFolder);
        var staging=Path.GetFullPath(Path.Combine(spec.OutputFolder,"_scene"));
        if(staging.StartsWith(source.TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("OutputFolder must be outside SceneFolder");
        foreach(var file in Directory.GetFiles(source,"*",SearchOption.AllDirectories))
        {
            var destination=Path.Combine(staging,Path.GetRelativePath(source,file));
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);File.Copy(file,destination,true);
        }
        File.Copy(Path.Combine(AppContext.BaseDirectory,"capture.html"),Path.Combine(staging,"capture.html"),true);
        core.SetVirtualHostNameToFolderMapping("render.local",staging,CoreWebView2HostResourceAccessKind.DenyCors);
        core.NavigationStarting+=(_,e)=>{if(!e.Uri.StartsWith("https://render.local/",StringComparison.Ordinal))e.Cancel=true;};
        core.NewWindowRequested+=(_,e)=>e.Handled=true;
        core.PermissionRequested+=(_,e)=>e.State=CoreWebView2PermissionState.Deny;
        core.WebMessageReceived+=async(_,e)=>
        {
            if(closing||!e.Source.StartsWith("https://render.local/",StringComparison.Ordinal))return;
            try
            {
                using var doc=JsonDocument.Parse(e.WebMessageAsJson);var data=doc.RootElement;
                if(data.TryGetProperty("error",out var error))throw new Exception(error.GetString());
                if(data.GetProperty("type").GetString()=="ready"&&!started){started=true;await NextAsync();}
                else if(data.GetProperty("type").GetString()=="frame")
                {
                    watchdog.Stop();
                    using(var output=File.Create(Path.Combine(spec.OutputFolder,$"{frame:D4}.png")))
                        await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,output);
                    if(++frame>=spec.Seconds*spec.Fps)
                    {
                        File.WriteAllText(Path.Combine(spec.OutputFolder,"capture-report.json"),JsonSerializer.Serialize(new{spec,frames=frame,lastFrame=data.Clone()},new JsonSerializerOptions{WriteIndented=true}));
                        Close();
                    }
                    else await NextAsync();
                }
            }
            catch(Exception ex){Fail(ex);}
        };
        core.ProcessFailed+=(_,e)=>Fail(new Exception(e.ProcessFailedKind.ToString()));
        core.Navigate("https://render.local/capture.html?course="+Uri.EscapeDataString(spec.CourseId));watchdog.Start();
    }
    private async Task NextAsync()
    {
        watchdog.Start();
        var args=JsonSerializer.Serialize(new{distance=spec.StartMeters+frame*spec.SpeedMps/spec.Fps,dt=1.0/spec.Fps});
        await web.CoreWebView2.ExecuteScriptAsync($"window.renderCaptureFrame({args})");
        Text=$"MTB Indoor · Captura {frame+1}/{spec.Seconds*spec.Fps}";
    }
    private void Fail(Exception ex)
    {
        if(closing)return;watchdog.Stop();
        File.WriteAllText(Path.Combine(spec.OutputFolder,"error.txt"),ex.ToString());Environment.ExitCode=1;Close();
    }
    protected override void Dispose(bool disposing){if(disposing)watchdog.Dispose();base.Dispose(disposing);}
}
