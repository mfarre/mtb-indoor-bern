using System.Text.Json;

namespace MTBIndoorBern;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        if(args.Length>=2&&args[0]=="--probe-mtb")
        {Task.Run(()=>Diagnostics.EquipmentAsync(args[1])).GetAwaiter().GetResult();return;}
        if(args.Length>=2&&args[0]=="--probe-mtb-gears")
        {Task.Run(()=>Diagnostics.GearsAsync(args[1])).GetAwaiter().GetResult();return;}
        if (args.Length >= 2 && args[0] == "--scan")
        {
            try
            {
                var devices = Task.Run(() => Discovery.ScanAsync(CancellationToken.None)).GetAwaiter().GetResult();
                File.WriteAllText(args[1], JsonSerializer.Serialize(devices, new JsonSerializerOptions { WriteIndented = true }));
            }
            catch (Exception e) { File.WriteAllText(args[1], JsonSerializer.Serialize(new { error = e.ToString() })); Environment.ExitCode = 1; }
            return;
        }
        if (args.Length >= 2 && args[0] == "--self-test")
        {
            try { Packets.Verify(); RideSession.Verify(CourseCatalog.RouteFile(CourseCatalog.Load()[0])); PreferencesStore.Verify(); File.WriteAllText(args[1], "PASS: BLE and FTMS packets; all 2448 visual slopes match physics; hill restart; MTB 1x12 load and low-cadence release; 600 W cap; pause/reset; settings persistence and device identity."); }
            catch (Exception e) { File.WriteAllText(args[1], e.ToString()); Environment.ExitCode = 1; }
            return;
        }
        if (args.Length >= 2 && args[0] == "--probe-controller")
        {
            Task.Run(async () =>
            {
                var events = new System.Collections.Concurrent.ConcurrentQueue<object>();
                try
                {
                    var devices = await Discovery.ScanAsync(CancellationToken.None);
                    var controller = devices.FirstOrDefault(d => d.ZwiftType == 10) ?? devices.First(d => d.Matches(SensorRole.Controller));
                    events.Enqueue(new { controller });
                    using var connection = new SensorConnection(SensorRole.Controller);
                    connection.Changed += () => events.Enqueue(new { time = DateTime.UtcNow, connection.Status, connection.Model, connection.Firmware, connection.LastPacket });
                    connection.Shift += direction => events.Enqueue(new { time = DateTime.UtcNow, shift = direction });
                    await connection.ConnectAsync(controller, CancellationToken.None);
                    await Task.Delay(TimeSpan.FromSeconds(35));
                    await connection.DisconnectAsync();
                }
                catch (Exception e) { events.Enqueue(new { error = e.ToString() }); Environment.ExitCode = 1; }
                File.WriteAllText(args[1], JsonSerializer.Serialize(events, new JsonSerializerOptions { WriteIndented = true }));
            }).GetAwaiter().GetResult();
            return;
        }
        if (args.Length >= 2 && args[0] is "--probe-trainer" or "--probe-trainer-info" or "--probe-trainer-flat")
        {
            Task.Run(async () =>
            {
                var events = new System.Collections.Concurrent.ConcurrentQueue<object>();
                using var connection = new SensorConnection(SensorRole.Trainer);
                try
                {
                    var devices = await Discovery.ScanAsync(CancellationToken.None);
                    var selected = devices.First(d => d.Name.Contains("KICKR", StringComparison.OrdinalIgnoreCase));
                    events.Enqueue(new { selected });
                    await connection.ConnectAsync(selected, CancellationToken.None);
                    events.Enqueue(new { connection.Connected, connection.ControlInfo, connection.Model, connection.Firmware, features = connection.Control?.TargetFeatures });
                    if (args[0] == "--probe-trainer-info") events.Enqueue(new { gatt = await connection.InspectTrainerAsync() });
                    if (args[0] is "--probe-trainer" or "--probe-trainer-flat")
                    {
                        var control = connection.Control ?? throw new Exception("No FTMS simulation control available");
                        control.Trace += trace => events.Enqueue(new { time = DateTime.UtcNow, trace });
                        await control.StartAsync(CancellationToken.None);
                        foreach(double grade in (args[0] == "--probe-trainer-flat" ? new double[]{0} : new double[]{0,1,2,1,0}))
                        {
                            await control.SetGradeAsync(grade, CancellationToken.None);
                            await Task.Delay(4000);
                            events.Enqueue(new { time = DateTime.UtcNow, grade, applied = control.AppliedGrade, connection.Power, connection.Cadence });
                        }
                        await control.StopAsync();
                        events.Enqueue(new { stopped = true, control.Status });
                    }
                }
                catch (Exception e) { events.Enqueue(new { error = e.ToString() }); Environment.ExitCode = 1; }
                finally { await connection.DisconnectAsync(); }
                File.WriteAllText(args[1], JsonSerializer.Serialize(events, new JsonSerializerOptions { WriteIndented = true }));
            }).GetAwaiter().GetResult();
            return;
        }
        ApplicationConfiguration.Initialize();
        using var instance = new Mutex(true, "Local\\AlDente.MtbIndoor", out bool firstInstance);
        if (!firstInstance) { MessageBox.Show("MTB Indoor - Bern ja està obert. Fes servir la finestra existent per evitar dues connexions al KICKR.", "MTB Indoor - Bern"); return; }
        try { Application.Run(new MainForm(args.Length >= 2 && args[0] is "--render-smoke" or "--render-welcome" ? args[1] : null, args.Length == 0 || args[0] != "--render-welcome")); }
        catch (Exception e) { MessageBox.Show("No s’ha pogut iniciar MTB Indoor - Bern. Mantén la carpeta Scene al costat de l’executable.\n\n" + e.Message, "MTB Indoor - Bern"); }
    }
}
