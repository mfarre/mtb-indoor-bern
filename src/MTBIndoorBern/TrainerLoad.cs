namespace MTBIndoorBern;

// The rendered road, HUD and avatar physics keep their exact local slope. Only
// the trainer averages the surrounding 40 m to soften sampled elevation noise.
internal sealed class TrainerLoad
{
    public const double GradeWindowMeters = 40;
    private readonly RoutePoint[] points;
    private readonly double[] horizontalDistance;
    private readonly TorqueRamp torqueRamp = new();
    public double TorqueNm => torqueRamp.TorqueNm;

    public TrainerLoad(Course course)
    {
        points = course.Points;
        if (points.Length < 2) throw new ArgumentException("A trainer profile needs at least two route points.", nameof(course));
        horizontalDistance = new double[points.Length];
        for (int i = 1; i < points.Length; i++)
        {
            double dx = points[i].X - points[i - 1].X, dz = points[i].Z - points[i - 1].Z;
            horizontalDistance[i] = horizontalDistance[i - 1] + Math.Sqrt(dx * dx + dz * dz);
        }
    }

    public void Reset() => torqueRamp.Reset();

    public double GradeAt(double distance)
    {
        if (!double.IsFinite(distance)) return 0;
        distance = Math.Clamp(distance, points[0].D, points[^1].D);
        var start = Sample(Math.Max(points[0].D, distance - GradeWindowMeters / 2));
        var end = Sample(Math.Min(points[^1].D, distance + GradeWindowMeters / 2));
        double length = end.Horizontal - start.Horizontal;
        // Sum the rendered horizontal segments. A straight endpoint-to-endpoint
        // chord would cut across switchbacks and invent a much steeper incline.
        double grade = length > .001 ? 100 * (end.Height - start.Height) / length : 0;
        return double.IsFinite(grade) ? grade : 0;
    }

    private (double Height, double Horizontal) Sample(double distance)
    {
        int left = 0, right = points.Length - 1;
        while (right - left > 1)
        {
            int mid = (left + right) / 2;
            if (points[mid].D <= distance) left = mid; else right = mid;
        }
        double t = (distance - points[left].D) / (points[right].D - points[left].D);
        return (points[left].Y + (points[right].Y - points[left].Y) * t,
            horizontalDistance[left] + (horizontalDistance[right] - horizontalDistance[left]) * t);
    }

    public double NextPower(double distance, double difficulty, int gear, double cadence,
        double riderKg, int chainring, BikeProfile bike, string surface, double dt,
        double torqueRiseNmPerSecond, bool easierShift = false)
    {
        double target = BikeDynamics.TargetPower(GradeAt(distance), difficulty, gear, cadence,
            riderKg, chainring, bike, surface);
        // Terrain reductions may ease out, but an easier gear or low-cadence
        // assistance must reduce load promptly. Zero targets always release.
        bool smoothReduction = !easierShift && cadence >= BikeDynamics.FullCadence(bike);
        return torqueRamp.NextPower(target, cadence, dt, torqueRiseNmPerSecond, smoothReduction);
    }
}
