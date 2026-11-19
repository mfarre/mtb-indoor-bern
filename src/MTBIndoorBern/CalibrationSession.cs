namespace MTBIndoorBern;

// This interface deliberately separates the guided protocol from BLE and permits
// deterministic verification without starting a real trainer.
internal interface ICalibrationTrainer
{
    bool Connected { get; }
    bool SupportsPower { get; }
    double? Power { get; }
    double? Cadence { get; }
    DateTime? LastPacket { get; }
    string Identity { get; }
    Task StartAsync(CancellationToken token);
    Task SetPowerAsync(int watts, CancellationToken token);
    Task StopAsync();
}

internal sealed class CalibrationStepResult
{
    public string Name { get; set; } = "";
    public int TargetPower { get; set; }
    public double MeanPower { get; set; }
    public double MeanCadence { get; set; }
    public double MeanErrorPercent { get; set; }
    public double SettlingSeconds { get; set; }
    public int Samples { get; set; }
    internal object Snapshot() => new { name = Name, targetPower = TargetPower, meanPower = MeanPower, meanCadence = MeanCadence, meanErrorPercent = MeanErrorPercent, settlingSeconds = SettlingSeconds, samples = Samples };
}

internal sealed class CalibrationResult
{
    public int Version { get; set; } = 1;
    public DateTime CompletedUtc { get; set; }
    public string TrainerIdentity { get; set; } = "";
    public string ProfileSignature { get; set; } = "";
    public double SettlingSeconds { get; set; }
    public double MeanErrorPercent { get; set; }
    public double TorqueRiseNmPerSecond { get; set; } = 5;
    public double UpdateIntervalSeconds { get; set; } = 1;
    public CalibrationStepResult[] Steps { get; set; } = [];
    public bool IsValidFor(string signature, string identity) => Version == 1 && CompletedUtc != default &&
        !string.IsNullOrWhiteSpace(signature) && !string.IsNullOrWhiteSpace(identity) &&
        ProfileSignature == signature && TrainerIdentity == identity &&
        double.IsFinite(SettlingSeconds) && SettlingSeconds is >= 0 and <= 15 &&
        double.IsFinite(MeanErrorPercent) && MeanErrorPercent is >= 0 and <= 20 &&
        double.IsFinite(TorqueRiseNmPerSecond) && TorqueRiseNmPerSecond is >= 3 and <= 6 &&
        double.IsFinite(UpdateIntervalSeconds) && UpdateIntervalSeconds is >= 1 and <= 2 && Steps?.Length == 5 &&
        Steps.All(s => s is not null && s.Samples >= 12 && s.TargetPower is 70 or 110 &&
            double.IsFinite(s.MeanPower) && s.MeanPower is >= 0 and <= 200 &&
            double.IsFinite(s.MeanCadence) && s.MeanCadence is >= 35 and <= 120 &&
            double.IsFinite(s.MeanErrorPercent) && s.MeanErrorPercent is >= 0 and <= 20 &&
            double.IsFinite(s.SettlingSeconds) && s.SettlingSeconds is >= 0 and <= 15);
    public object Snapshot() => new { version = Version, completedUtc = CompletedUtc, settlingSeconds = SettlingSeconds,
        meanErrorPercent = MeanErrorPercent, torqueRiseNmPerSecond = TorqueRiseNmPerSecond,
        updateIntervalSeconds = UpdateIntervalSeconds, steps = (Steps ?? []).Select(s => s.Snapshot()).ToArray() };
}

internal sealed class CalibrationSession
{
    private sealed record Stage(string Name, int Power, double MinCadence, double MaxCadence, double Seconds);
    private sealed record Sample(double Seconds, double Power, double Cadence);
    private static readonly Stage[] Stages = [
        new("Base suau", 70, 65, 75, 20),
        new("Resposta a 70 rpm", 110, 65, 75, 24),
        new("Recuperació a 70 rpm", 70, 65, 75, 20),
        new("Resposta a 85 rpm", 110, 80, 90, 24),
        new("Recuperació a 85 rpm", 70, 80, 90, 20)
    ];
    private readonly ICalibrationTrainer trainer;
    private readonly Action<string> log;
    private readonly Func<DateTime> utcNow;
    private CancellationTokenSource? cancellation;
    private Task commandTask = Task.CompletedTask;
    private Task? endingTask;
    private int generation, stageIndex = -1, freshCount;
    private double elapsed, stageElapsed, stableSeconds, slowSeconds;
    private DateTime? lastSamplePacket;
    private bool claimed;
    private string identity = "", signature = "", pendingFailure = "";
    private readonly List<Sample> samples = [];
    private readonly List<CalibrationStepResult> results = [];
    private int targetPower;
    public string Phase { get; private set; } = "idle";
    public string Message { get; private set; } = "Prova opcional de resposta del KICKR · uns 2 minuts · 70–110 W.";
    public bool Active => Phase is "warmup" or "preparing" or "step" or "cadence" or "stopping";
    public CalibrationResult? Result { get; private set; }
    public event Action<CalibrationResult>? Completed;
    internal Task PendingOperation => endingTask ?? commandTask;

    public CalibrationSession(ICalibrationTrainer trainer, Action<string> log, Func<DateTime>? utcNow = null)
    { this.trainer = trainer; this.log = log; this.utcNow = utcNow ?? (() => DateTime.UtcNow); }

    // Arming never applies load. The first control command follows fresh, steady pedalling.
    public Task StartAsync(string profileSignature)
    {
        if (Active) return Task.CompletedTask;
        if (!trainer.Connected || !trainer.SupportsPower || string.IsNullOrWhiteSpace(trainer.Identity))
        { Phase = "failed"; Message = "Connecta el KICKR amb control de potència abans d’iniciar la prova."; return Task.CompletedTask; }
        if (string.IsNullOrWhiteSpace(profileSignature))
        { Phase = "failed"; Message = "Desa primer el perfil de bicicleta."; return Task.CompletedTask; }
        cancellation?.Dispose(); cancellation = new(); generation++;
        commandTask = Task.CompletedTask; endingTask = null; claimed = false; pendingFailure = "";
        elapsed = stageElapsed = stableSeconds = slowSeconds = 0; stageIndex = -1; freshCount = 0; targetPower = 0;
        samples.Clear(); results.Clear(); lastSamplePacket = null; Result = null;
        signature = profileSignature; identity = trainer.Identity; Phase = "warmup";
        Message = "Pedala entre 65 i 75 rpm durant 5 segons. Mantén la mateixa marxa física tota la prova.";
        log("Calibratge de resposta preparat; esperant cadència estable.");
        return Task.CompletedTask;
    }

    public Task CancelAsync(string reason = "Prova cancel·lada") => EndAsync("cancelled", reason);

    public void Tick(double dt)
    {
        if (!Active || Phase == "stopping") return;
        if (!double.IsFinite(dt) || dt <= 0) return;
        dt = Math.Min(dt, 1); elapsed += dt; stageElapsed += dt;
        if (pendingFailure.Length > 0) { _ = EndAsync("failed", pendingFailure); return; }
        if (!trainer.Connected || trainer.Identity != identity) { _ = EndAsync("failed", "Prova aturada: s’ha desconnectat o canviat el KICKR. Torna-ho a provar."); return; }
        bool valid = Fresh();
        if (!valid)
        {
            stableSeconds = 0; freshCount = 0;
            if (claimed || elapsed > 15) _ = EndAsync("failed", "Prova aturada: falten dades recents de potència o cadència. Torna-ho a provar.");
            return;
        }
        double cadence = trainer.Cadence!.Value, power = trainer.Power!.Value;
        slowSeconds = claimed && cadence < 35 ? slowSeconds + dt : 0;
        if (slowSeconds >= 1) { _ = EndAsync("failed", "Prova aturada en deixar de pedalar. Càrrega alliberada; torna-ho a provar quan estiguis a punt."); return; }
        bool unique = !lastSamplePacket.HasValue || trainer.LastPacket!.Value > lastSamplePacket.Value;
        if (unique) lastSamplePacket = trainer.LastPacket;
        if (Phase is "warmup" or "cadence")
        {
            var min = Phase == "warmup" ? 65 : 80; var max = Phase == "warmup" ? 75 : 90;
            if (cadence >= min && cadence <= max)
            {
                stableSeconds += dt;
                if (unique) freshCount++;
            }
            else { stableSeconds = 0; freshCount = 0; }
            if (stableSeconds >= 5 && freshCount >= 5) BeginStage(Phase == "warmup" ? 0 : 3);
            else if (stageElapsed > (Phase == "warmup" ? 60 : 40))
                _ = EndAsync("failed", "No s’ha mantingut la cadència indicada. La prova no es desa; pots repetir-la.");
            return;
        }
        if (Phase != "step") return;
        if (unique) samples.Add(new(stageElapsed, power, cadence));
        if (stageElapsed < Stages[stageIndex].Seconds) return;
        if (!AnalyzeStage(out var result, out var failure)) { _ = EndAsync("failed", failure); return; }
        results.Add(result!);
        if (stageIndex == Stages.Length - 1)
        {
            var rises = new[] { results[1].SettlingSeconds, results[3].SettlingSeconds };
            var settling = rises.Average();
            var final = new CalibrationResult { CompletedUtc = utcNow(), TrainerIdentity = identity, ProfileSignature = signature,
                SettlingSeconds = Math.Round(settling, 2), MeanErrorPercent = Math.Round(results.Average(r => r.MeanErrorPercent), 2),
                // A conservative ramp recommendation, not a gain correction to measured watts.
                TorqueRiseNmPerSecond = Math.Round(Math.Clamp(20 / Math.Max(3.4, settling), 3, 6), 2),
                UpdateIntervalSeconds = 1, Steps = results.ToArray() };
            _ = EndAsync("complete", "Prova completada. Resposta mesurada; ajustos de transició preparats. No verifica l’exactitud absoluta dels watts.", final);
        }
        else if (stageIndex == 2)
        {
            Phase = "cadence"; stageElapsed = stableSeconds = 0; freshCount = 0;
            Message = "Ara puja suaument a 80–90 rpm, mantenint la mateixa marxa física. La càrrega continua a 70 W.";
        }
        else BeginStage(stageIndex + 1);
    }

    private bool Fresh()
    {
        var age = trainer.LastPacket.HasValue ? (utcNow() - trainer.LastPacket.Value).TotalSeconds : double.PositiveInfinity;
        return age is >= -.5 and <= 3 && trainer.Power is double power && double.IsFinite(power) && power is >= 0 and <= 2000 &&
            trainer.Cadence is double cadence && double.IsFinite(cadence) && cadence is >= 0 and <= 220;
    }

    private void BeginStage(int index)
    {
        if (!commandTask.IsCompleted || Phase == "stopping") return;
        stageIndex = index; stageElapsed = 0; Phase = "preparing"; Message = "Preparant el següent tram de la prova…";
        commandTask = SetStageAsync(index, generation, cancellation!.Token);
    }

    private async Task SetStageAsync(int index, int run, CancellationToken token)
    {
        try
        {
            if (!claimed) { claimed = true; await trainer.StartAsync(token); }
            token.ThrowIfCancellationRequested();
            await trainer.SetPowerAsync(Stages[index].Power, token);
            token.ThrowIfCancellationRequested();
            if (run != generation || Phase == "stopping") return;
            stageIndex = index; stageElapsed = stableSeconds = 0; freshCount = 0; samples.Clear();
            lastSamplePacket = trainer.LastPacket; targetPower = Stages[index].Power; Phase = "step";
            Message = $"{Stages[index].Name}: mantén {Stages[index].MinCadence:0}–{Stages[index].MaxCadence:0} rpm. No canviïs la marxa física.";
            log($"Calibratge: tram {index + 1}/{Stages.Length}, objectiu {targetPower} W confirmat; mesurant la resposta.");
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { }
        catch (Exception e) { pendingFailure = "No s’ha pogut completar l’ordre al KICKR. " + e.Message; }
    }

    private bool AnalyzeStage(out CalibrationStepResult? result, out string failure)
    {
        result = null; failure = "Dades insuficients o inestables: aquesta prova no es desa. Repeteix-la mantenint la cadència indicada.";
        var stage = Stages[stageIndex];
        var tail = samples.Where(s => s.Seconds >= stage.Seconds - 10).ToArray();
        if (samples.Count < 12 || tail.Length < 6 || tail[^1].Seconds - tail[0].Seconds < 6) return false;
        if (samples.Zip(samples.Skip(1)).Any(p => p.Second.Seconds - p.First.Seconds > 2.5)) return false;
        double meanCadence = tail.Average(s => s.Cadence);
        double cadenceDeviation = Math.Sqrt(tail.Average(s => Math.Pow(s.Cadence - meanCadence, 2)));
        if (meanCadence < stage.MinCadence || meanCadence > stage.MaxCadence || cadenceDeviation > 5 ||
            tail.Count(s => s.Cadence >= stage.MinCadence && s.Cadence <= stage.MaxCadence) < tail.Length * .75) return false;
        double meanPower = tail.Average(s => s.Power), error = tail.Average(s => Math.Abs(s.Power - stage.Power) / stage.Power * 100);
        if (Math.Abs(meanPower - stage.Power) > Math.Max(8, stage.Power * .15) || error > 20)
        { failure = "El KICKR no ha seguit prou bé la càrrega de prova. No es corregeixen ni es multipliquen els watts; revisa la connexió i repeteix-la."; return false; }
        double? anchor = null, settling = null; double previous = -1;
        foreach (var sample in samples)
        {
            bool close = Math.Abs(sample.Power - stage.Power) <= Math.Max(8, stage.Power * .1) && sample.Cadence >= stage.MinCadence && sample.Cadence <= stage.MaxCadence;
            if (!close || (previous >= 0 && sample.Seconds - previous > 2.5)) anchor = null;
            if (close) { anchor ??= sample.Seconds; if (sample.Seconds - anchor >= 3) { settling = anchor; break; } }
            previous = sample.Seconds;
        }
        if (!settling.HasValue || settling > 15)
        { failure = "La càrrega no s’ha estabilitzat a temps. Aquesta prova no es desa; pots repetir-la amb una cadència més estable."; return false; }
        result = new() { Name = stage.Name, TargetPower = stage.Power, MeanPower = Math.Round(meanPower, 2), MeanCadence = Math.Round(meanCadence, 2),
            MeanErrorPercent = Math.Round(error, 2), SettlingSeconds = Math.Round(settling.Value, 2), Samples = samples.Count };
        return true;
    }

    private Task EndAsync(string endPhase, string message, CalibrationResult? result = null)
    {
        if (endingTask is not null) return endingTask;
        if (!Active) return Task.CompletedTask;
        generation++; cancellation?.Cancel(); Phase = "stopping"; Message = "Alliberant la càrrega del KICKR…";
        endingTask = ReleaseAsync(commandTask, endPhase, message, result);
        return endingTask;
    }

    private async Task ReleaseAsync(Task pending, string endPhase, string message, CalibrationResult? result)
    {
        await pending;
        string? failure = null;
        if (claimed)
        {
            try { using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5)); await trainer.SetPowerAsync(0, timeout.Token); }
            catch (Exception e) { failure = e.Message; }
            try { await trainer.StopAsync(); }
            catch (Exception e) { failure = e.Message; }
        }
        claimed = false; targetPower = 0;
        if (failure is not null)
        { Phase = "failed"; Message = "Prova aturada, però el KICKR no ha confirmat l’alliberament de càrrega. " + failure; }
        else
        {
            Phase = endPhase; Message = message;
            if (endPhase == "complete" && result is not null)
            {
                Result = result;
                try { Completed?.Invoke(result); }
                catch (Exception e) { Message = "Prova completada, però no s’ha pogut desar el resultat. " + e.Message; }
            }
        }
        log(Message);
    }

    public object Snapshot()
    {
        var stage = stageIndex >= 0 ? Stages[stageIndex] : Stages[0];
        double min = Phase == "cadence" ? 80 : stage.MinCadence, max = Phase == "cadence" ? 90 : stage.MaxCadence;
        double remaining = Phase == "warmup" ? Math.Max(0, 60 - stageElapsed) : Phase == "cadence" ? Math.Max(0, 40 - stageElapsed) : Math.Max(0, stage.Seconds - stageElapsed);
        double completed = Stages.Take(results.Count).Sum(s => s.Seconds);
        double progress = Phase == "complete" ? 1 : Math.Clamp((completed + (Phase == "step" ? stageElapsed : 0)) / Stages.Sum(s => s.Seconds), 0, 1);
        return new { type = "calibration", phase = Phase, active = Active, running = Active, canStart = !Active && trainer.Connected && trainer.SupportsPower,
            message = Message, instruction = Message, targetPower, targetCadenceMin = min, targetCadenceMax = max,
            measuredPower = Fresh() ? trainer.Power : null, cadence = Fresh() ? trainer.Cadence : null,
            secondsRemaining = Math.Ceiling(remaining), progress, stepIndex = Math.Max(0, stageIndex), stepCount = Stages.Length,
            summary = Message, result = Phase == "complete" ? Result?.Snapshot() : null };
    }
}
