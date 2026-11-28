using System.Text.Json;

namespace MTBIndoorBern;

internal static class BluetoothReliabilityTests
{
    public static void Verify()
    {
        static void Check(bool value, string message) { if (!value) throw new Exception(message); }
        var now = new DateTime(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);
        var health = new SensorHealth(SensorRole.HeartRate);
        Check(!health.IsConnected(true), "Transport alone cannot make a sensor ready");
        health.SubscriptionsReady(now);
        Check(health.IsConnected(true) && health.DataState(true, now) == "waiting", "Subscribed HR must wait for a measurement");
        Check(!health.NeedsRefresh(true, now.AddSeconds(19)) && health.NeedsRefresh(true, now.AddSeconds(20)), "Missing HR notification recovery timeout");
        health.Measurement(now.AddSeconds(2));
        Check(health.DataState(true, now.AddSeconds(9)) == "connected" && health.DataState(true, now.AddSeconds(10)) == "stale", "HR freshness window");
        Check(!health.NeedsRefresh(true, now.AddSeconds(21)) && health.NeedsRefresh(true, now.AddSeconds(22)), "Stopped HR notification recovery timeout");
        health.Invalidate();
        Check(!health.IsConnected(true) && health.LastMeasurement is null, "Windows automatic transport reconnect must not revive retired subscriptions");
        health.SubscriptionsReady(now.AddSeconds(30));
        Check(health.DataState(true, now.AddSeconds(30)) == "waiting", "Reconnected HR must wait for new data");

        var clickHealth = new SensorHealth(SensorRole.Controller);
        clickHealth.SubscriptionsReady(now);
        Check(clickHealth.DataState(true, now) == "waiting", "Controller input must be confirmed separately");
        clickHealth.Measurement(now);
        Check(clickHealth.DataState(true, now.AddHours(1)) == "connected" && !clickHealth.NeedsRefresh(true, now.AddHours(1)), "Idle controllers must not be treated as dead sensors");
        clickHealth.Invalidate();
        Check(!clickHealth.IsConnected(true), "Click reconnect must repeat the handshake");

        var right = new NearbyDevice(100, "Zwift Click", -45, [], 10);
        var left = new NearbyDevice(200, "Zwift Click", -50, [], 11);
        Check(right.Matches(SensorRole.Controller) && !right.Matches(SensorRole.LeftController), "Right manufacturer-only advertisement routing");
        Check(left.Matches(SensorRole.LeftController) && !left.Matches(SensorRole.Controller), "Left manufacturer-only advertisement routing");
        Check(new NearbyDevice(300,"",-60,[BleIds.ZwiftV2]).Matches(SensorRole.Controller), "Service-only Zwift discovery");
        Check(new NearbyDevice(400,"HRM-Dual",-60,[]).Matches(SensorRole.HeartRate), "HRM-Dual discovery by name");

        var rightPlus = Packets.ReadZwiftClick2(ClickPacket(uint.MaxValue & ~0x1000u), true).ToArray();
        var mirroredPlus = Packets.ReadZwiftClick2(ClickPacket(uint.MaxValue & ~0x1000u), false).ToArray();
        var leftMinus = Packets.ReadZwiftClick2(ClickPacket(uint.MaxValue & ~0x100u), false).ToArray();
        Check(rightPlus[0].State == 1 && mirroredPlus.All(s=>s.State==0), "Mirrored right + must not shift twice");
        Check(leftMinus[0].State == 0 && leftMinus[1].State == 1 && leftMinus[2].State == 0, "Left minus mapping");
        Check(Packets.ReadZwiftClick2(ClickPacket(uint.MaxValue & ~0x10u), true).Last().State == 1, "Right A brake mapping");
        Check(Packets.ReadZwiftClick2(ClickPacket(uint.MaxValue & ~0x10u), false).All(s=>s.State==0), "Left mirrored A must not stick braking");
        Check(Packets.ReadZwiftClick([0x37,8,1]).SequenceEqual(new (byte,byte)[]{(1,0)}), "Missing legacy fields must not invent a gear press");
        foreach (var malformed in new byte[][] { [0x23,8,0xff,0xff,0xff,0xff,0x1f], [0x23,0,0], [0x23,0x12,0xff,0xff,0xff,0xff,0x0f] })
        {
            try { Packets.ReadZwiftClick2(malformed,true); throw new Exception("Malformed Click packet accepted"); }
            catch (InvalidDataException) { }
        }

        string folder = Path.Combine(Path.GetTempPath(),"MtbBleTests-"+Guid.NewGuid().ToString("N"));
        string file = Path.Combine(folder,"settings.json");
        try
        {
            var preferences = new PreferencesStore(file);
            preferences.Remember(SensorRole.Controller,right);
            using var equipment = new Equipment(preferences,CancellationToken.None,_=>{});
            Check(equipment.FindAutomaticDevice(SensorRole.LeftController,[left])?.Address == 200, "Existing right pair can discover one left pod");
            Check(equipment.FindAutomaticDevice(SensorRole.LeftController,[left,left with { Address=201 }]) is null, "Ambiguous left pods must not auto-pair");
            preferences.Remember(SensorRole.LeftController,left);
            Check(equipment.FindAutomaticDevice(SensorRole.Controller,[left]) is null, "Saved right must not reconnect to left");
            using var snapshot = JsonDocument.Parse(JsonSerializer.Serialize(equipment.Snapshot()));
            var devices = snapshot.RootElement.EnumerateArray().ToArray();
            Check(devices.Length == 4, "Both Click slots must appear on the ride screen");
            Check(devices[1].GetProperty("state").GetString()=="searching" && devices[1].GetProperty("status").GetString()!.Contains("every 5 s"), "Searching chips must not retain a stale Connected label");
        }
        finally
        {
            if(File.Exists(file))File.Delete(file);
            if(Directory.Exists(folder))Directory.Delete(folder);
        }
    }

    private static byte[] ClickPacket(uint mask)
    {
        var bytes = new List<byte>{0x23,8};
        do { byte value=(byte)(mask&127);mask>>=7;bytes.Add((byte)(value|(mask==0?0:128))); } while(mask!=0);
        return bytes.ToArray();
    }
}
