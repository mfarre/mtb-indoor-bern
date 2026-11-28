namespace MTBIndoorBern;

internal static class BrakePersistenceTests
{
    private static void Check(bool value, string message) { if (!value) throw new Exception("Brake persistence: " + message); }
    private static void Throws<T>(Action action, string message) where T : Exception
    {
        try { action(); } catch (T) { return; }
        throw new Exception("Brake persistence: " + message);
    }

    public static void Verify()
    {
        string folder = Path.Combine(Path.GetTempPath(), "MtbBrakeTests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        string file = Path.Combine(folder, "settings.json");
        string blocked = Path.Combine(folder, "not-a-directory");
        try
        {
            var clean = new PreferencesStore(file, false);
            Check(clean.Data.Version == 5 && clean.Data.BrakeCalibrations.Count == 0 && clean.Data.Sensors.Count == 0, "Public defaults cannot seed a private board or calibration");
            using (var equipment = new Equipment(clean, CancellationToken.None, _ => { }))
            {
                Throws<InvalidOperationException>(() => equipment.SaveBrakeCalibration(new(1000, 1300), new(2000, 1700), true), "Missing board identity must reject saving");
                Check(equipment.BrakeInput.Front == 0 && equipment.BrakeInput.Rear == 0, "No board must remain released");
            }
            File.WriteAllText(file, """
                {"Version":4,"RiderKg":81,"Difficulty":0.65,"Chainring":30,"Sensors":[
                  {"Role":"Trainer","Address":11,"Name":"Trainer"},
                  {"Role":"Controller","Address":12,"Name":"Zwift Click","ZwiftType":10},
                  {"Role":"LeftController","Address":13,"Name":"Zwift Click","ZwiftType":11},
                  {"Role":"HeartRate","Address":14,"Name":"HRM-Dual"}]}
                """);
            var store = new PreferencesStore(file, false);
            Check(store.Data.Version == 5 && store.Data.RiderKg == 81 && store.Data.Difficulty == .65 && store.Data.Chainring == 30 && store.Data.Sensors.Count == 4,
                "Version four upgrade must preserve trainer, Click pair, HR and rider preferences");
            var board = new NearbyDevice(111, "MTB Brake Bench", -45, [BrakeProtocol.Service]);
            var otherBoard = board with { Address = 222 };
            store.Remember(SensorRole.Brakes, board);
            var saved = store.Data.Sensors.Single(s => s.Role == SensorRole.Brakes);
            Check(saved.Find([otherBoard]) is null && saved.Find([otherBoard, board])?.Address == 111, "Calibration pairing must use exact board identity, never shared names");
            Check(new SavedSensor(SensorRole.Brakes, 0, board.Name).Find([board]) is null, "Missing address cannot auto-pair by name");
            using (var equipment = new Equipment(store, CancellationToken.None, _ => { }))
            {
                bool trainerTouched = false;
                equipment.BeforeTrainerChange = () => { trainerTouched = true; return Task.CompletedTask; };
                equipment.SaveBrakeCalibration(new(1000, 1300, true), new(2000, 1700), false);
                Check(!trainerTouched && !equipment.BrakeInput.Armed && equipment.BrakeInput.Front == 0, "Calibration must neither command trainer nor arm disconnected input");
                var loaded = new PreferencesStore(file, false);
                var profile = loaded.Data.BrakeCalibrations.Single();
                Check(profile.Address == 111 && profile.Left?.Provisional == true && profile.Left.Span == 300 && profile.Right?.Span == -300 && !profile.LeftIsFront,
                    "Signed endpoints, warning and configurable mapping must round trip per board");
                Check(equipment.FindAutomaticDevice(SensorRole.Brakes, [otherBoard]) is null, "Automatic reconnect cannot move a calibration to another board");
                store.Data.BrakeCalibrations.Add(new() { Address = 222, Left = new(1400, 1800), Right = new(2500, 2100) });
                store.Save();
                equipment.ClearBrakeCalibration();
                Check(equipment.BrakeCalibration is { Left: null, Right: null, LeftIsFront: false } && store.Data.BrakeCalibrations.Single(c => c.Address == 222).Left is not null,
                    "Clear must affect only selected board and retain mapping");
                equipment.SaveBrakeCalibration(new(1000, 1300), new(2000, 1700), true);
                store.Forget(SensorRole.Brakes);
                Check(store.Data.BrakeCalibrations.Count == 1 && store.Data.BrakeCalibrations[0].Address == 222 && store.Data.Sensors.Count == 4,
                    "Forget must clear only that board calibration and preserve existing equipment");
            }
            File.WriteAllText(file, """
                {"BrakeCalibrations":[
                  {"Address":0,"Left":{"Released":1000,"Pulled":1300}},
                  {"Address":281474976710656},
                  {"Address":111,"ProtocolVersion":2},
                  {"Address":222,"Left":{"Released":1000,"Pulled":1005},"Right":{"Released":2000,"Pulled":1700}},
                  {"Address":333,"Left":{"Released":1000,"Pulled":1300}},
                  {"Address":333,"LeftIsFront":false,"Left":{"Released":1400,"Pulled":1800}}
                ]}
                """);
            var invalid = new PreferencesStore(file, false);
            Check(invalid.Data.BrakeCalibrations.Count == 2 && invalid.Data.BrakeCalibrations.Single(c => c.Address == 222) is { Left: null, Right: not null } &&
                invalid.Data.BrakeCalibrations.Single(c => c.Address == 333) is { LeftIsFront: false }, "Invalid identities/protocols and endpoint spans must not activate; last duplicate wins");

            File.WriteAllText(blocked, "This path is a regular file.");
            var failed = new PreferencesStore(Path.Combine(blocked, "settings.json"), false);
            failed.Data.Sensors.Add(new(SensorRole.Brakes, 111, board.Name));
            var old = new BrakeDeviceCalibration { Address = 111, Left = new(1000, 1300), Right = new(2000, 1700) };
            failed.Data.BrakeCalibrations.Add(old);
            using (var equipment = new Equipment(failed, CancellationToken.None, _ => { }))
            {
                Throws<IOException>(() => equipment.SaveBrakeCalibration(new(1100, 1400), new(2100, 1800), false), "Disk failure must be surfaced to setup UI");
                Check(failed.Warning is not null && failed.Data.BrakeCalibrations.Single() == old, "Failed save must roll back in-memory active calibration");
            }

            var time = new DateTime(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);
            var health = new SensorHealth(SensorRole.Brakes);
            health.SubscriptionsReady(time);
            Check(health.DataState(true, time) == "waiting" && !health.NeedsRefresh(true, time.AddMilliseconds(1999)), "Subscription without data cannot confirm brake input");
            health.Measurement(time);
            Check(health.DataState(true, time.AddMilliseconds(749)) == "connected" && health.DataState(true, time.AddMilliseconds(750)) == "stale", "Brake data expires at 750 ms");
            Check(health.NeedsRefresh(true, time.AddSeconds(2)) && !health.NeedsRefresh(false, time.AddSeconds(2)), "Silent connected board is eligible for reconnect on normal search cycle");
            health.Invalidate();
            Check(!health.IsConnected(true) && health.LastMeasurement is null, "Disconnected subscriptions cannot resurrect a brake measurement");
        }
        finally
        {
            if (File.Exists(file)) File.Delete(file);
            if (File.Exists(file + ".tmp")) File.Delete(file + ".tmp");
            if (File.Exists(blocked)) File.Delete(blocked);
            if (Directory.Exists(folder)) Directory.Delete(folder);
        }
    }
}
