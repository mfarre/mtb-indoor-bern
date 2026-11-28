namespace MTBIndoorBern;

// BLE transport connectivity is insufficient after a disconnect: CCCD subscriptions
// and the controller handshake must succeed again before a session can be reused.
internal sealed class SensorHealth(SensorRole role)
{
    private volatile bool subscribed;
    public bool Subscribed => subscribed;
    public DateTime? ConnectedAt { get; private set; }
    public DateTime? LastMeasurement { get; private set; }

    public void SubscriptionsReady(DateTime now) { ConnectedAt = now; subscribed = true; }
    public void Measurement(DateTime now) => LastMeasurement = now;
    public void Invalidate() { subscribed = false; ConnectedAt = LastMeasurement = null; }
    public bool IsConnected(bool transportConnected) => Subscribed && transportConnected;
    public static bool IsFresh(DateTime? sample, DateTime now) => sample.HasValue && (now - sample.Value).TotalSeconds is >= 0 and < 8;
    public string DataState(bool connected, DateTime now)
    {
        if (!connected) return "disconnected";
        if (role == SensorRole.Trainer) return "connected";
        if (!LastMeasurement.HasValue) return "waiting";
        if (role == SensorRole.Brakes && (now - LastMeasurement.Value).TotalMilliseconds is not (>= 0 and < BrakeProtocol.StaleMilliseconds)) return "stale";
        // Controllers are event driven. An idle controller is not a failed sensor.
        return role == SensorRole.HeartRate && !IsFresh(LastMeasurement, now) ? "stale" : "connected";
    }
    public bool NeedsRefresh(bool connected, DateTime now) => connected &&
        (LastMeasurement ?? ConnectedAt) is { } last &&
        (role == SensorRole.HeartRate && (now - last).TotalSeconds >= 20 || role == SensorRole.Brakes && (now - last).TotalSeconds >= 2);
}
