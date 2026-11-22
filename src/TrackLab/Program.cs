using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program
{
    [STAThread] static void Main(string[] args)
    {
        CultureInfo.DefaultThreadCurrentCulture=CultureInfo.GetCultureInfo("en-GB");
        CultureInfo.DefaultThreadCurrentUICulture=CultureInfo.GetCultureInfo("en-GB");
        ApplicationConfiguration.Initialize();
        Application.Run(new LabForm(args.Length>1&&args[0]=="--smoke"?args[1]:null));
    }
}
internal sealed class LabForm:Form
{
    readonly WebView2 web=new(){Dock=DockStyle.Fill,DefaultBackgroundColor=Color.FromArgb(17,26,24)};
    readonly string root=AppContext.BaseDirectory;
    readonly string? smoke;
    JsonElement config; string session=""; bool busy; Process? worker;
    public LabForm(string? smoke)
    {
        this.smoke=smoke;Text="Track Lab · MTB Indoor - Bern";ClientSize=new(1440,940);MinimumSize=new(1080,760);StartPosition=FormStartPosition.CenterScreen;
        Controls.Add(web);Shown+=async(_,_)=>await Initialize();
        FormClosing+=(_,e)=>{if(busy){e.Cancel=true;Post(new{type="status",text="Wait for the import to finish or select Cancel."});}};
    }
    string Setting(string key)=>config.GetProperty(key).GetString()!;
    async Task Initialize()
    {
        try{
            var configFile=Path.Combine(root,"config.json");
            if(!File.Exists(configFile))File.WriteAllText(configFile,JsonSerializer.Serialize(new{defaultSession="",sessionsRoot=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),"MTB Track Lab"),python="python",node="node",ffmpeg="ffmpeg",course=""},new JsonSerializerOptions{WriteIndented=true}));
            config=JsonDocument.Parse(File.ReadAllText(configFile)).RootElement.Clone();session=Setting("defaultSession");Directory.CreateDirectory(Setting("sessionsRoot"));
            var env=await CoreWebView2Environment.CreateAsync(null,Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"MTBTrackLab","WebView"));
            await web.EnsureCoreWebView2Async(env);var core=web.CoreWebView2;
            await core.Profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.DiskCache);
            core.SetVirtualHostNameToFolderMapping("tracklab.local",Path.Combine(root,"Web"),CoreWebView2HostResourceAccessKind.DenyCors);
            core.Settings.AreDevToolsEnabled=false;core.Settings.IsStatusBarEnabled=false;core.Settings.AreDefaultContextMenusEnabled=false;
            core.NavigationStarting+=(_,e)=>{if(!e.Uri.StartsWith("https://tracklab.local/",StringComparison.Ordinal))e.Cancel=true;};
            core.NewWindowRequested+=(_,e)=>e.Handled=true;core.PermissionRequested+=(_,e)=>e.State=CoreWebView2PermissionState.Deny;
            core.WebMessageReceived+=Message;
            if(File.Exists(Path.Combine(session,"analysis.json")))OpenSession(session);else core.Navigate("https://tracklab.local/index.html?empty=1");
        }catch(Exception e){MessageBox.Show(e.Message,"Track Lab");Close();}
    }
    void OpenSession(string folder)
    {
        if(!File.Exists(Path.Combine(folder,"analysis.json")))throw new FileNotFoundException("The folder does not contain analysis.json.");
        session=Path.GetFullPath(folder);web.CoreWebView2.SetVirtualHostNameToFolderMapping("session.local",session,CoreWebView2HostResourceAccessKind.Allow);
        web.CoreWebView2.Navigate("https://tracklab.local/index.html?smoke="+(smoke is null?"0":"1")+"&t="+DateTime.UtcNow.Ticks);
    }
    void Post(object value)=>web.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(value));
    async void Message(object? sender,CoreWebView2WebMessageReceivedEventArgs e)
    {
        if(!e.Source.StartsWith("https://tracklab.local/",StringComparison.Ordinal))return;
        try{
            var m=JsonDocument.Parse(e.WebMessageAsJson).RootElement;string? action=m.GetProperty("action").GetString();
            if(busy&&action!="cancel")return;
            switch(action){
                case "ready": Post(new{type="path",path=session});break;
                case "open":using(var dialog=new OpenFileDialog{Filter="Track Lab session|analysis.json",InitialDirectory=Setting("sessionsRoot")})if(dialog.ShowDialog(this)==DialogResult.OK)OpenSession(Path.GetDirectoryName(dialog.FileName)!);break;
                case "folder":Process.Start(new ProcessStartInfo("explorer.exe",string.IsNullOrEmpty(session)?Setting("sessionsRoot"):session){UseShellExecute=true});break;
                case "save":
                    var json=m.GetProperty("data").GetRawText();if(json.Length>1_000_000)throw new Exception("The annotations are too large.");
                    var file=Path.Combine(session,"annotations.json");File.WriteAllText(file+".tmp",json);File.Move(file+".tmp",file,true);Post(new{type="status",text="Annotations and clock adjustment saved."});break;
                case "export":using(var dialog=new SaveFileDialog{Filter="JSON observations|*.json",FileName="course-observations.json",InitialDirectory=session})if(dialog.ShowDialog(this)==DialogResult.OK){File.WriteAllText(dialog.FileName,m.GetProperty("data").GetRawText());Post(new{type="status",text="Observations exported."});}break;
                case "import":await Import(m.GetProperty("rotation").GetInt32());break;
                case "capture":await CaptureFrame(m.GetProperty("video").GetInt32(),m.GetProperty("seconds").GetDouble());break;
                case "cancel":if(worker is {HasExited:false})worker.Kill(true);break;
                case "smoke":if(smoke is not null){File.WriteAllText(smoke,m.GetRawText());using var stream=File.Create(Path.ChangeExtension(smoke,".png"));await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,stream);BeginInvoke(Close);}break;
                case "error":if(smoke is not null){File.WriteAllText(smoke,m.GetRawText());BeginInvoke(Close);}break;
            }
        }catch(Exception ex){Post(new{type="status",text="Error: "+ex.Message});}
    }
    async Task Run(string exe,IEnumerable<string> args)
    {
        var start=new ProcessStartInfo(exe){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};foreach(var arg in args)start.ArgumentList.Add(arg);
        using var p=new Process{StartInfo=start};worker=p;p.Start();
        var errors=p.StandardError.ReadToEndAsync();var output=Task.Run(async()=>{while(await p.StandardOutput.ReadLineAsync() is string line){if(!IsDisposed)BeginInvoke(()=>Post(new{type="status",text=line}));}});
        await p.WaitForExitAsync();await output;var err=await errors;worker=null;if(p.ExitCode!=0)throw new Exception(string.IsNullOrWhiteSpace(err)?"Process interrupted; original files are preserved.":err[..Math.Min(err.Length,1000)]);
    }
    async Task Import(int rotation)
    {
        using var fit=new OpenFileDialog{Filter="FIT or ZIP|*.fit;*.zip",Title="Choose the ride FIT or ZIP file"};if(fit.ShowDialog(this)!=DialogResult.OK)return;
        using var videos=new FolderBrowserDialog{Description="Original video folder",UseDescriptionForTitle=true};if(videos.ShowDialog(this)!=DialogResult.OK)return;
        var name=Path.GetFileNameWithoutExtension(fit.FileName)+"-"+DateTime.Now.ToString("yyyyMMdd-HHmmss");var destination=Path.Combine(Setting("sessionsRoot"),name);
        busy=true;Post(new{type="busy",value=true});
        try{
            Post(new{type="status",text="Copying and verifying originals. This may take a few minutes…"});
            await Run(Setting("python"),[Path.Combine(root,"Scripts/import_session.py"),"--video-dir",videos.SelectedPath,"--fit-zip",fit.FileName,"--output",destination]);
            var fits=Directory.GetFiles(Path.Combine(destination,"fit"),"*.fit",SearchOption.AllDirectories).Where(p=>!Path.GetFileName(p).StartsWith("._")).ToArray();if(fits.Length!=1)throw new Exception("The ZIP must contain exactly one FIT file.");
            var decodeArgs=new List<string>{Path.Combine(root,"Scripts/decode-fit.mjs"),fits[0],Path.Combine(destination,"track.json"),Path.Combine(root,"FitSdk/src/index.js")};
            if(File.Exists(Setting("course")))decodeArgs.Add(Setting("course"));
            await Run(Setting("node"),decodeArgs);
            await Run(Setting("python"),[Path.Combine(root,"Scripts/analyze_session.py"),destination,"--ffmpeg",Setting("ffmpeg"),"--rotation",rotation==0?"0":"180"]);
            OpenSession(destination);
        }finally{busy=false;Post(new{type="busy",value=false});}
    }
    async Task CaptureFrame(int index,double seconds)
    {
        using var data=JsonDocument.Parse(File.ReadAllText(Path.Combine(session,"analysis.json")));var videos=data.RootElement.GetProperty("videos");
        if(index<0||index>=videos.GetArrayLength()||!double.IsFinite(seconds))throw new Exception("Invalid video frame.");var v=videos[index];seconds=Math.Clamp(seconds,0,v.GetProperty("duration").GetDouble()-.1);
        var input=Path.GetFullPath(Path.Combine(session,(v.TryGetProperty("highResolution",out var high)?high:v.GetProperty("original")).GetString()!));if(!input.StartsWith(session+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new Exception("Invalid file path.");
        Directory.CreateDirectory(Path.Combine(session,"details"));var file=$"details/video-{index+1}-{seconds:00000.0}-{DateTime.Now:HHmmss}.jpg";
        busy=true;Post(new{type="busy",value=true});try{
            var vf=v.GetProperty("rotation").GetInt32()==180?"hflip,vflip":"null";
            await Run(Setting("ffmpeg"),["-v","error","-nostdin","-y","-ss",seconds.ToString(System.Globalization.CultureInfo.InvariantCulture),"-noautorotate","-i",input,"-map","0:v:0","-frames:v","1","-vf",vf,"-q:v","2",Path.Combine(session,file)]);
            Post(new{type="captured",file,video=index,seconds});
        }finally{busy=false;Post(new{type="busy",value=false});}
    }
}
