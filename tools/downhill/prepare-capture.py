from pathlib import Path
import shutil,sys
root=Path(__file__).resolve().parents[2];src=root/'src/MTBIndoorBern';scenario=sys.argv[1] if len(sys.argv)>1 else 'brake';target=root/f'artifacts/downhill/{scenario}/source';out=root/f'artifacts/downhill/{scenario}/capture';out.mkdir(parents=True,exist_ok=True)
shutil.copytree(src,target,dirs_exist_ok=True)
p=target/'Program.cs';s=p.read_text(encoding='utf-8').replace('private static void Main(string[] args)\n    {','private static void Main(string[] args)\n    {\n        args = ["--render-smoke", @"'+str(out/'report.json')+'"];');p.write_text(s,encoding='utf-8')
p=target/'RidePanel.cs';s=p.read_text(encoding='utf-8')
init='await Ride.StartPracticeAsync(); while(Ride.Distance<4670) Ride.Tick(.1);'
if scenario=='climb':init='await Ride.StartAsync(true); Ride.JumpDemo(2050);'
if scenario=='welcome':init=''
s=s.replace('await Ride.StartAsync(true); Ride.JumpDemo(selectedCourse.PreviewDistance);',init)
automation='''var next=Ride.Trail.Next(Ride.Distance); Ride.SetControllerBrake(next is not null && Ride.Velocity>next.Limit*.96 && next.Start-Ride.Distance<Math.Max(3,(Ride.Velocity*Ride.Velocity-next.Limit*next.Limit)/6+Ride.Velocity*.75));'''
if scenario in ('brake','runout'):
 s=s.replace('private bool controllerWasConnected;', '''private bool controllerWasConnected;
    private int captureFrames; private bool captureBusy;
    private async Task CaptureFrameAsync() {
        try { using var stream=File.Create(Path.Combine(Path.GetDirectoryName(smokeFile!)!, $"frame-{captureFrames:D4}.png"));
            await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,stream);
            File.AppendAllText(Path.Combine(Path.GetDirectoryName(smokeFile!)!,"states.jsonl"),JsonSerializer.Serialize(Ride.Snapshot())+Environment.NewLine);captureFrames++; }
        finally {captureBusy=false;}
    }''')
 s=s.replace('var now = time.Elapsed.TotalSeconds;', 'var now = time.Elapsed.TotalSeconds; if(!ready || !Ride.Running || captureBusy || captureFrames>=110)return; captureBusy=true;')
 s=s.replace('Ride.Tick(now - lastTick); lastTick = now;', (automation if scenario=='brake' else '')+'\n            Ride.Tick(.1); lastTick = now;')
 s=s.replace('web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(Ride.Snapshot(equipment.Snapshot())));','web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(Ride.Snapshot(equipment.Snapshot())));\n            web.CoreWebView2!.PostWebMessageAsJson("{\\\"type\\\":\\\"capture-frame\\\"}");')
 s=s.replace('case "heartbeat":','case "frame-ready": await CaptureFrameAsync(); break;\n                case "heartbeat":')
 s=s.replace('time.Elapsed.TotalSeconds > 12','captureFrames>=110 && !captureBusy')
p.write_text(s,encoding='utf-8')
p=target/'Scene/scene.js';s=p.read_text(encoding='utf-8').replace("send('stats',{fps,", "send('stats',{brake:state.brake,slip:state.slip,recovery:state.recovery,descent:state.descent,focus:$('focus-value').textContent,corner:$('corner-title').textContent,fps,");
if scenario in ('brake','runout'):
 s=s.replace("if(event.data?.type==='state')", "if(event.data?.type==='capture-frame'){requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>send('frame-ready'))));}else if(event.data?.type==='state')")
p.write_text(s,encoding='utf-8')
p=target/'MTBIndoorBern.csproj';s=p.read_text(encoding='utf-8').replace('../../../work/nuget',str(root/'artifacts/nuget'));p.write_text(s,encoding='utf-8')
p=target/'Directory.Build.props';p.write_text('<Project><PropertyGroup><BaseIntermediateOutputPath>'+str(root/f'artifacts/downhill/{scenario}/obj/')+'/</BaseIntermediateOutputPath><BaseOutputPath>'+str(root/f'artifacts/downhill/{scenario}/bin/')+'/</BaseOutputPath></PropertyGroup></Project>',encoding='utf-8')
print(target)
