using System.Text.Json;

namespace MTBIndoorBern;

internal static class CalibrationTests
{
    private static void Check(bool condition, string message) { if (!condition) throw new Exception("Calibration: " + message); }
    private sealed class FakeTrainer : ICalibrationTrainer
    {
        public bool Connected { get; set; } = true;
        public bool SupportsPower { get; set; } = true;
        public double? Power { get; set; } = 50;
        public double? Cadence { get; set; } = 70;
        public DateTime? LastPacket { get; set; }
        public string Identity { get; set; } = "test-trainer";
        public int Starts, Stops, Target;
        public int PreviousTarget;
        public DateTime CommandTime;
        public double ResponseDelaySeconds;
        public Func<DateTime>? Now;
        public readonly List<int> Commands = [];
        public bool RejectLoad, RejectStop;
        public TaskCompletionSource? StartGate;
        public TaskCompletionSource? LoadGate;
        public async Task StartAsync(CancellationToken token)
        { Starts++; if (StartGate is not null) await StartGate.Task.WaitAsync(token); }
        public async Task SetPowerAsync(int watts, CancellationToken token)
        {
            token.ThrowIfCancellationRequested(); Commands.Add(watts);
            if (RejectLoad && watts > 0) throw new IOException("Synthetic command failure");
            // Simulate a write already on the radio that acknowledges after cancellation.
            if (watts > 0 && LoadGate is not null) await LoadGate.Task;
            PreviousTarget = Target; Target = watts; CommandTime = Now?.Invoke() ?? default;
        }
        public Task StopAsync() { Stops++; if (RejectStop) throw new IOException("Synthetic release failure"); Target = 0; return Task.CompletedTask; }
    }

    public static void Verify() => VerifyAsync().GetAwaiter().GetResult();
    private static async Task VerifyAsync()
    {
        // All time is virtual; no Bluetooth access, delays, device identifiers or user settings.
        DateTime now = new(2026, 11, 19, 12, 0, 0, DateTimeKind.Utc);
        var trainer = new FakeTrainer { LastPacket = now, Now = () => now };
        var session = new CalibrationSession(trainer, _ => { }, () => now);
        int completed = 0; session.Completed += _ => completed++;
        await session.StartAsync("profile-A"); await session.StartAsync("ignored-reentrant-profile");
        Check(trainer.Starts == 0 && trainer.Commands.Count == 0 && session.Phase == "warmup", "arming must not apply load");
        async Task Advance(double seconds, bool fresh = true, bool chooseCadence = true, double? fixedPower = null)
        {
            for (int i = 0; i < (int)Math.Round(seconds * 10); i++)
            {
                now = now.AddMilliseconds(100);
                if (fresh && i % 5 == 0)
                {
                    trainer.LastPacket = now;
                    if (chooseCadence)
                    {
                        using var json = JsonDocument.Parse(JsonSerializer.Serialize(session.Snapshot()));
                        trainer.Cadence = (json.RootElement.GetProperty("targetCadenceMin").GetDouble() + json.RootElement.GetProperty("targetCadenceMax").GetDouble()) / 2;
                    }
                    trainer.Power = fixedPower ?? (trainer.Target == 0 ? 50 : (now - trainer.CommandTime).TotalSeconds < trainer.ResponseDelaySeconds ? trainer.PreviousTarget : trainer.Target);
                }
                session.Tick(.1); await session.PendingOperation;
            }
        }
        await Advance(130);
        Check(session.Phase == "complete" && completed == 1 && session.Result is not null, "valid fresh samples must complete");
        Check(trainer.Starts == 1 && trainer.Stops == 1 && trainer.Commands.Max() == 110 && trainer.Commands[^1] == 0, "bounded loads and release after completion");
        Check(session.Result!.IsValidFor("profile-A", "test-trainer") && !session.Result.IsValidFor("profile-B", "test-trainer") && !session.Result.IsValidFor("profile-A", "other-trainer"), "result binding");
        Check(session.Result.Steps.Length == 5 && session.Result.TorqueRiseNmPerSecond is >= 3 and <= 6 && session.Result.UpdateIntervalSeconds >= 1, "bounded conservative recommendations");
        var roundTrip = JsonSerializer.Deserialize<CalibrationResult>(JsonSerializer.Serialize(session.Result));
        Check(roundTrip!.IsValidFor("profile-A", "test-trainer"), "result persistence");

        double fastRamp = session.Result.TorqueRiseNmPerSecond;
        trainer.ResponseDelaySeconds = 6;
        await session.StartAsync("profile-A"); await Advance(130);
        Check(session.Phase == "complete" && completed == 2 && session.Result!.SettlingSeconds is >= 6 and < 8 && session.Result.TorqueRiseNmPerSecond < fastRamp, "measured slow response must yield gentler ramp");
        trainer.ResponseDelaySeconds = 0;
        int validCompletions = completed, successfulStops = trainer.Stops;

        await session.StartAsync("profile-A"); await Advance(6); await session.CancelAsync("User stop");
        Check(session.Phase == "cancelled" && !session.Active && session.Result is null && completed == validCompletions && trainer.Target == 0 && trainer.Stops == successfulStops + 1, "cancel releases without result");

        await session.StartAsync("profile-A"); await Advance(6); await Advance(4, fresh: false);
        Check(session.Phase == "failed" && completed == validCompletions && trainer.Target == 0, "stale data stops load and rejects result");

        trainer.LastPacket = now; trainer.Cadence = 70;
        await session.StartAsync("profile-A"); await Advance(6); trainer.Cadence = 0;
        await Advance(2, chooseCadence: false);
        Check(session.Phase == "failed" && trainer.Target == 0 && completed == validCompletions, "stopped pedalling releases load");

        trainer.Cadence = 70; trainer.LastPacket = now;
        await session.StartAsync("profile-A"); await Advance(35, fixedPower: 20);
        Check(session.Phase == "failed" && completed == validCompletions && session.Result is null && trainer.Target == 0, "poor measured tracking cannot calibrate");

        trainer.LastPacket = now; trainer.Cadence = 70;
        await session.StartAsync("profile-A"); await Advance(6); trainer.Cadence = 100; await Advance(25, chooseCadence: false);
        Check(session.Phase == "failed" && trainer.Target == 0 && completed == validCompletions, "wrong cadence must reject stage even when watts match");

        trainer.LastPacket = now; trainer.Cadence = 70;
        await session.StartAsync("profile-A"); await Advance(6); trainer.Connected = false; await Advance(.2);
        Check(session.Phase == "failed" && trainer.Target == 0 && completed == validCompletions, "disconnect must stop without a result");
        trainer.Connected = true;

        trainer.LastPacket = now; trainer.Cadence = 70;
        await session.StartAsync("profile-A"); await Advance(6); trainer.Identity = "changed-trainer"; await Advance(.2);
        Check(session.Phase == "failed" && trainer.Target == 0 && completed == validCompletions, "changed trainer invalidates run");

        trainer.LastPacket = now; trainer.RejectLoad = true;
        await session.StartAsync("profile-A"); await Advance(7);
        Check(session.Phase == "failed" && trainer.Target == 0 && completed == validCompletions, "command rejection still releases");
        trainer.RejectLoad = false;

        // An async start cancelled midway must finish before the release command.
        var waiting = new FakeTrainer { LastPacket = now, StartGate = new(TaskCreationOptions.RunContinuationsAsynchronously) };
        var pending = new CalibrationSession(waiting, _ => { }, () => now);
        await pending.StartAsync("profile-A");
        for (int i = 0; i < 60; i++) { now = now.AddMilliseconds(100); waiting.LastPacket = now; pending.Tick(.1); }
        Check(pending.Phase == "preparing", "delayed start enters preparing");
        await pending.CancelAsync("Cancel during start");
        Check(pending.Phase == "cancelled" && waiting.Stops == 1 && waiting.Commands.SequenceEqual(new[] { 0 }), "no late load after cancelling start");

        var delayedLoad = new FakeTrainer { LastPacket = now, LoadGate = new(TaskCreationOptions.RunContinuationsAsynchronously) };
        var delayedSession = new CalibrationSession(delayedLoad, _ => { }, () => now);
        await delayedSession.StartAsync("profile-A");
        for (int i = 0; i < 70; i++) { now = now.AddMilliseconds(100); delayedLoad.LastPacket = now; delayedSession.Tick(.1); }
        Check(delayedSession.Phase == "preparing" && delayedLoad.Commands.SequenceEqual(new[] { 70 }), "load acknowledgement remains pending");
        var cancellation = delayedSession.CancelAsync("Cancel during load acknowledgement");
        Check(!cancellation.IsCompleted && delayedSession.Phase == "stopping" && delayedLoad.Stops == 0, "release waits for in-flight load");
        delayedLoad.LoadGate.SetResult(); await cancellation;
        Check(delayedSession.Phase == "cancelled" && delayedLoad.Target == 0 && delayedLoad.Stops == 1 && delayedLoad.Commands.SequenceEqual(new[] { 70, 0 }) && delayedSession.Result is null,
            "late accepted load is followed by zero and stop without result");

        var delayedAck = new FakeTrainer { LastPacket = now, LoadGate = new(TaskCreationOptions.RunContinuationsAsynchronously) };
        var acknowledgement = new CalibrationSession(delayedAck, _ => { }, () => now);
        await acknowledgement.StartAsync("profile-A");
        for (int i = 0; i < 140; i++) { now = now.AddMilliseconds(100); delayedAck.LastPacket = now; acknowledgement.Tick(.1); }
        delayedAck.LoadGate.SetResult(); await acknowledgement.PendingOperation;
        using (var snapshot = JsonDocument.Parse(JsonSerializer.Serialize(acknowledgement.Snapshot())))
            Check(acknowledgement.Phase == "step" && snapshot.RootElement.GetProperty("progress").GetDouble() == 0 && snapshot.RootElement.GetProperty("secondsRemaining").GetDouble() == 20,
                "measurement clock begins after command acknowledgement");
        for (int i = 0; i < 40; i++) { now = now.AddMilliseconds(100); acknowledgement.Tick(.1); await acknowledgement.PendingOperation; }
        Check(acknowledgement.Phase == "failed" && acknowledgement.Result is null && delayedAck.Target == 0,
            "pre-acknowledgement telemetry cannot substitute for fresh measurements");

        // Duplicate packet timestamps must not be counted as many independent observations.
        var duplicate = new FakeTrainer { LastPacket = now };
        var duplicates = new CalibrationSession(duplicate, _ => { }, () => now);
        await duplicates.StartAsync("profile-A");
        for (int i = 0; i < 80; i++) duplicates.Tick(.1);
        Check(duplicate.Starts == 0 && duplicates.Phase == "warmup", "duplicate samples cannot satisfy warmup");
        await duplicates.CancelAsync("End duplicate test");

        var unstable = new FakeTrainer { LastPacket = now, Cadence = 50 };
        var stability = new CalibrationSession(unstable, _ => { }, () => now);
        await stability.StartAsync("profile-A");
        for (int i = 0; i < 20; i++) { now = now.AddMilliseconds(100); unstable.LastPacket = now; stability.Tick(.1); }
        unstable.Cadence = 70;
        for (int i = 0; i < 52; i++)
        {
            now = now.AddMilliseconds(100);
            if (i % 20 == 0) unstable.LastPacket = now;
            stability.Tick(.1);
        }
        Check(unstable.Starts == 0 && stability.Phase == "warmup", "historical out-of-band packets cannot satisfy a new stable window");
        await stability.CancelAsync("End stability test");

        trainer.LastPacket = now; trainer.RejectStop = true;
        await session.StartAsync("profile-A"); await Advance(130);
        Check(session.Phase == "failed" && completed == validCompletions && session.Result is null, "unconfirmed release prevents result publication");
    }
}
