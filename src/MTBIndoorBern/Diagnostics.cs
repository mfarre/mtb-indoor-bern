using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;

namespace MTBIndoorBern;

internal static class Diagnostics
{
    public static async Task GearsAsync(string report)
    {
        var events=new ConcurrentQueue<object>();
        using var lifetime=new CancellationTokenSource(TimeSpan.FromSeconds(60));
        using var trainer=new SensorConnection(SensorRole.Trainer);
        try
        {
            var preferences=new PreferencesStore(Path.Combine(AppContext.BaseDirectory,"settings.json"));
            var nearby=await Discovery.ScanAsync(lifetime.Token,4);
            var saved=preferences.Data.Sensors.First(s=>s.Role==SensorRole.Trainer);
            await trainer.ConnectAsync(saved.Find(nearby)??throw new IOException("KICKR recordat no trobat"),lifetime.Token);
            var control=trainer.Control??throw new IOException("Sense control FTMS");
            control.Trace+=trace=>events.Enqueue(new{time=DateTime.UtcNow,trace});
            await control.StartAsync(lifetime.Token,true);
            try
            {
                // At a gentle 8% slope: 8 s in third gear, 8 s in first, then 4 s on flat.
                // Bounded to 200 W and released whenever cadence or data drops.
                for(int second=0;second<20;second++)
                {
                    int gear=second<8?3:1;double grade=second<16?8:0;
                    bool fresh=trainer.LastPacket.HasValue&&(DateTime.UtcNow-trainer.LastPacket.Value).TotalSeconds<3;
                    double cadence=fresh?trainer.Cadence??0:0;
                    int target=(int)Math.Round(RidePhysics.TargetPower(grade,1,gear,cadence,preferences.Data.RiderKg,preferences.Data.Chainring));
                    target=cadence<=30?0:Math.Min(200,Math.Min(target,control.AppliedPower+40));
                    await control.SetPowerAsync(target,lifetime.Token);
                    events.Enqueue(new{time=DateTime.UtcNow,second,gear,grade,cadence,target,trainer.Power});
                    await Task.Delay(1000,lifetime.Token);
                }
            }
            finally{await control.StopAsync();}
        }
        catch(Exception e){events.Enqueue(new{error=e.ToString()});Environment.ExitCode=1;}
        finally
        {
            await trainer.DisconnectAsync();events.Enqueue(new{closed=true});
            File.WriteAllText(report,JsonSerializer.Serialize(events,new JsonSerializerOptions{WriteIndented=true}));
        }
    }
    // Development check: reconnect saved equipment and acknowledge only a zero-watt target.
    public static async Task EquipmentAsync(string report)
    {
        var events=new ConcurrentQueue<object>();
        using var lifetime=new CancellationTokenSource(TimeSpan.FromSeconds(40));
        var preferences=new PreferencesStore(Path.Combine(AppContext.BaseDirectory,"settings.json"));
        preferences.Save();
        using var equipment=new Equipment(preferences,lifetime.Token,s=>events.Enqueue(new{time=DateTime.UtcNow,message=s}));
        var clock=Stopwatch.StartNew();bool tested=false;
        try
        {
            for(int scan=0;scan<5;scan++)
            {
                var delay=TimeSpan.FromSeconds(scan*5)-clock.Elapsed;
                if(delay>TimeSpan.Zero)await Task.Delay(delay,lifetime.Token);
                events.Enqueue(new{scan,seconds=clock.Elapsed.TotalSeconds});
                await equipment.ScanAsync();
                events.Enqueue(new{seconds=clock.Elapsed.TotalSeconds,devices=equipment.Snapshot()});
                var trainer=equipment.Connections[SensorRole.Trainer];
                if(!tested&&trainer.Connected&&!equipment.Busy(SensorRole.Trainer)&&trainer.Control is {SupportsPower:true} control)
                {
                    tested=true;control.Trace+=trace=>events.Enqueue(new{time=DateTime.UtcNow,trace});
                    try
                    {
                        await control.StartAsync(lifetime.Token,true);
                        await control.SetPowerAsync(0,lifetime.Token);
                        events.Enqueue(new{mtbPowerMode=true,control.AppliedPower,trainer.ControlInfo});
                    }
                    finally{await control.StopAsync();}
                }
            }
            events.Enqueue(new{powerModeTested=tested,saved=preferences.Data.Sensors});
        }
        catch(Exception e){events.Enqueue(new{error=e.ToString()});Environment.ExitCode=1;}
        finally
        {
            lifetime.Cancel();await equipment.ShutdownAsync();
            events.Enqueue(new{closed=true,seconds=clock.Elapsed.TotalSeconds});
            File.WriteAllText(report,JsonSerializer.Serialize(events,new JsonSerializerOptions{WriteIndented=true}));
        }
    }
}
