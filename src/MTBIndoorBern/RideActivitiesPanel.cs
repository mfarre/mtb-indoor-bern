using System.Diagnostics;
using System.Text.Json;

namespace MTBIndoorBern;

internal sealed partial class RidePanel
{
    private readonly ActivityStore activityStore = new(Path.Combine(AppContext.BaseDirectory, "activities"));
    private readonly ActivityRecovery activityRecovery = new();
    private Task pendingActivitySave = Task.CompletedTask;
    private string? activitySaveWarning;
    private bool activitiesOpen;
    private int activityDialogGeneration;
    private void InvalidateActivityExport() { activityDialogGeneration++; exportedActivityId=null; exportedActivityPath=null; }
    private string? exportedActivityId, exportedActivityPath;

    private void QueueActivitySave(RideActivity activity)
    {
        // Serialize checkpoints away from the UI/ride clock. A failed checkpoint
        // retains the previous file and cannot stop trainer control or a ride.
        activityRecovery.Remember(activity);
        pendingActivitySave = SaveActivityAfterAsync(pendingActivitySave, activity);
    }

    private async Task SaveActivityAfterAsync(Task previous, RideActivity activity)
    {
        try
        {
            await previous;
            await Task.Run(() => activityStore.Save(activity));
            activityRecovery.Saved(activity);
            activitySaveWarning = null;
        }
        catch (Exception ex)
        {
            activitySaveWarning = "A ride could not be saved locally. It remains available in Activities; export it before closing the app.";
            log("Activity save: " + ex.Message);
        }
    }

    private void PostActivityResult(string? id = null, string? notice = null, string? error = null, bool exported = false, string? requestId = null)
    {
        web.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "activity-result", id, notice, error, exported, requestId }));
    }

    private async Task PostActivitiesAsync(string? error = null, string? requestId = null)
    {
        if (web.CoreWebView2 is null) return;
        InvalidateActivityExport();
        var generation = activityDialogGeneration;
        try
        {
            var checkpoint = Ride.CurrentActivity;
            if (checkpoint is not null) QueueActivitySave(checkpoint);
            await pendingActivitySave;
            if (generation != activityDialogGeneration) return;
            // Retry older unsaved rides, including one whose recorder was reset
            // or replaced by a course change. Current data was attempted above.
            foreach (var retained in activityRecovery.Snapshot().Where(activity => activity.Id != checkpoint?.Id)) QueueActivitySave(retained);
            await pendingActivitySave;
            if (generation != activityDialogGeneration) return;
            IReadOnlyList<ActivitySummary> entries;
            string? readWarning = null;
            try { entries = await Task.Run(() => activityStore.ListRecent()); }
            catch (Exception ex) { entries = []; readWarning = "Saved rides could not be read. The current ride can still be exported."; log("Activity history: " + ex.Message); }
            // Retained failures stay visible/exportable after recorder reset.
            var currentRide = Ride.CurrentActivity;
            var retainedRides = activityRecovery.Snapshot().ToDictionary(activity => activity.Id, StringComparer.Ordinal);
            if (currentRide is not null) retainedRides[currentRide.Id] = currentRide;
            var merged = retainedRides.Values.OrderByDescending(activity => activity.StartedUtc).Select(ActivitySummary.From)
                .Concat(entries.Where(entry => !retainedRides.ContainsKey(entry.Id)));
            var summaries = merged.Select(entry => new
            {
                id = entry.Id, courseName = entry.CourseName, startedUtc = entry.StartedUtc,
                activeSeconds = entry.ActiveSeconds, distanceMeters = entry.DistanceMeters,
                calories = entry.EstimatedCalories, workKj = entry.MechanicalWorkJoules / 1000,
                averagePower = entry.ActiveSeconds > 0 ? entry.MechanicalWorkJoules / entry.ActiveSeconds : 0,
                isComplete = entry.IsComplete,
                canExport = entry.SampleCount >= 2 && entry.ActiveSeconds > 0 && !entry.SampleLimitReached,
                truncated = entry.SampleLimitReached
            }).ToArray();
            if (generation != activityDialogGeneration) return;
            var unsaved = activityRecovery.Snapshot().Count;
            web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
            {
                // Disk history is bounded by ListRecent; every unsaved ride must
                // remain reachable even if storage failed for over 30 sessions.
                type = "activities", requestId, activities = summaries, error,
                warning = unsaved > 0 ? $"{unsaved} ride(s) could not be saved locally. Export them from Activities before closing the app. Refresh retries the local save."
                    : activitySaveWarning ?? readWarning ?? activityStore.LastReadWarning,
                notice = Ride.Mode == "paused" ? "Ride paused. Close this panel and resume when you are ready." : null
            }));
        }
        catch (Exception ex)
        {
            log("Activities: " + ex.Message);
            if (generation != activityDialogGeneration) return;
            web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "activities", requestId, activities = Array.Empty<object>(), error = "Could not read saved rides. The original files have not been removed." }));
        }
    }

    private async Task OpenActivitiesAsync(string? requestId)
    {
        if (calibration.Active || profileOpen)
        {
            await PostActivitiesAsync("Close bike setup and finish calibration before reviewing activities.", requestId);
            return;
        }
        activitiesOpen = true;
        InvalidateActivityExport();
        var generation = activityDialogGeneration;
        if (Ride.Running) await Ride.PauseAsync("Ride paused to review activities · load released");
        if (!activitiesOpen || generation != activityDialogGeneration) return;
        await PostActivitiesAsync(requestId: requestId);
    }

    private async Task ExportActivityAsync(string? id, string? requestId)
    {
        void Result(string? notice = null, string? error = null, bool exported = false) => PostActivityResult(id, notice, error, exported, requestId);
        if (!activitiesOpen || Ride.Running || Ride.Busy || calibration.Active) { Result(error: "Pause the ride and open Activities first."); return; }
        if (!Guid.TryParse(id, out _)) { Result(error: "Select a recorded ride."); return; }
        InvalidateActivityExport();
        var generation = activityDialogGeneration;
        try
        {
            await pendingActivitySave;
            if (!activitiesOpen || generation != activityDialogGeneration) return;
            var current = Ride.CurrentActivity;
            var activity = current?.Id == id ? current : activityRecovery.Find(id!);
            activity ??= await Task.Run(() => activityStore.Load(id!));
            if (!activitiesOpen || generation != activityDialogGeneration) return;
            if (!ActivityExport.CanExport(activity)) { Result(error: "This ride does not yet contain enough measured data for export, or exceeded the recording limit."); return; }
            using var dialog = new SaveFileDialog
            {
                Title = "Save indoor ride for Strava", Filter = "Training Center activity (*.tcx)|*.tcx",
                DefaultExt = "tcx", AddExtension = true, FileName = ActivityExport.SuggestedFileName(activity!),
                OverwritePrompt = true, RestoreDirectory = true, ValidateNames = true
            };
            if (dialog.ShowDialog(FindForm()) != DialogResult.OK) { Result(notice: "Export cancelled."); return; }
            await Task.Run(() => ActivityExport.WriteTcx(activity!, dialog.FileName));
            if (!activitiesOpen || generation != activityDialogGeneration) return;
            exportedActivityId = id; exportedActivityPath = dialog.FileName;
            Result(notice: $"Saved {Path.GetFileName(dialog.FileName)}. Open Strava, select this file and review the activity before publishing.", exported: true);
        }
        catch (Exception ex)
        {
            log("Activity export: " + ex.Message);
            if (activitiesOpen && generation == activityDialogGeneration) Result(error: "Could not export this ride: " + ex.Message);
        }
    }

    private void OpenStravaUpload(string? id, string? requestId)
    {
        void Result(string? notice = null, string? error = null) => PostActivityResult(id, notice, error, requestId: requestId);
        if (!activitiesOpen || Ride.Running || id != exportedActivityId || exportedActivityPath is null || !File.Exists(exportedActivityPath))
        { Result(error: "Save the selected ride as a TCX file first."); return; }
        try
        {
            // Opens a fixed destination only. No workout, token or personal data is
            // attached to the URL; the rider chooses the file and publishes on Strava.
            Process.Start(new ProcessStartInfo("https://www.strava.com/upload/select") { UseShellExecute = true });
            Result(notice: $"Select {Path.GetFileName(exportedActivityPath)} on Strava. Mark it as indoor, review visibility and save when ready.");
        }
        catch (Exception ex) { log("Open Strava: " + ex.Message); Result(error: "Could not open the browser. Visit strava.com/upload/select and choose the saved TCX file."); }
    }
}
