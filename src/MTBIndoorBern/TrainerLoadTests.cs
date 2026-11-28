namespace MTBIndoorBern;

internal static class TrainerLoadTests
{
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static void Near(double actual, double expected, double tolerance, string message) => Check(Math.Abs(actual - expected) <= tolerance, message);

    private static Course MakeCourse(double[] grades, bool switchbacks = false)
    {
        var points = new RoutePoint[grades.Length + 1];
        double height = 0;
        for (int i = 0; i <= grades.Length; i++)
        {
            points[i] = new RoutePoint { D = i * 5, X = switchbacks ? (i % 2) * 5 : i * 5,
                Y = height, Alt = height + 500, Grade = grades[Math.Min(i, grades.Length - 1)] };
            if (i < grades.Length) height += grades[i] * .05;
        }
        return new Course { Length = grades.Length * 5, Points = points };
    }

    public static void Verify()
    {
        var steepCourse = MakeCourse(Enumerable.Repeat(20d, 60).ToArray());
        var steep = new TrainerLoad(steepCourse);
        foreach (double distance in new double[] { -100, 0, 3, 100, 297, 300, 400 })
            Near(steep.GradeAt(distance), 20, 1e-10, "Sustained steep terrain and truncated endpoints retain their grade");
        Near(new TrainerLoad(MakeCourse(Enumerable.Repeat(20d, 60).ToArray(), true)).GradeAt(100),
            20, 1e-10, "A switchback must use road length, not its endpoint chord");

        var noisyCourse = MakeCourse(Enumerable.Range(0, 80).Select(i => i % 2 == 0 ? 4d : 12).ToArray());
        var noise = new TrainerLoad(noisyCourse);
        for (double distance = 20; distance <= 380; distance += .5)
            Near(noise.GradeAt(distance), 8, 1e-10, "Five-metre elevation oscillations average to their sustained climb");
        Near(noise.GradeAt(100 - .0001), noise.GradeAt(100 + .0001), .0001,
            "Trainer grade stays continuous at a source vertex");
        Check(noisyCourse.At(99.99).Grade == 12 && noisyCourse.At(100).Grade == 4,
            "Trainer filtering must not change the local road/display/physics grade");
        Near(noisyCourse.Points[20].Y, 8, 1e-10, "Trainer filtering must not mutate rendered elevation");
        Near(noisyCourse.Points[20].Alt, 508, 1e-10, "Trainer filtering must not mutate altitude");
        Check(noise.GradeAt(double.NaN) == 0 && noise.GradeAt(double.PositiveInfinity) == 0,
            "Invalid distance cannot request an arbitrary incline");

        var bike = new BikeProfile();
        const double rate = 5.25, cadence = 70;
        double omega = cadence * 2 * Math.PI / 60;
        var ramp = new TorqueRamp();
        ramp.Reset(40);
        ramp.NextPower(10 * omega, cadence, .5, rate, true);
        Near(ramp.TorqueNm, 40 - rate, 1e-10, "Normal reductions are bounded at twice the configured rise rate");
        ramp.NextPower(60 * omega, cadence, .5, rate, true);
        Near(ramp.TorqueNm, 40 - rate / 2, 1e-10, "Configured rise rate is preserved");
        ramp.Reset(40);
        Near(ramp.NextPower(10 * omega, cadence, .1, rate), 10 * omega, 1e-10,
            "Calibration/default ramp retains immediate reductions");
        ramp.Reset(40);
        Check(ramp.NextPower(0, cadence, 0, rate, true) == 0 && ramp.TorqueNm == 0,
            "Zero power releases even when smoothing is enabled and no time has elapsed");

        double Power(TrainerLoad load, double distance, int gear = 6, double rpm = cadence, double dt = 1, bool easier = false) =>
            load.NextPower(distance, 1, gear, rpm, 75, 32, bike, "asphalt", dt, rate, easier);
        void Settle(TrainerLoad load, double distance) { for (int i = 0; i < 100; i++) Power(load, distance); }
        Settle(steep, 100);
        Near(Power(steep, 100, gear: 1, dt: .01, easier: true),
            BikeDynamics.TargetPower(20, 1, 1, cadence, 75, 32, bike, "asphalt"), 1e-8,
            "An easier gear bypasses the slower terrain release");
        Settle(steep, 100);
        Near(Power(steep, 100, rpm: 35, dt: .01),
            BikeDynamics.TargetPower(20, 1, 6, 35, 75, 32, bike, "asphalt"), 1e-8,
            "Low-cadence assistance must release immediately");
        foreach (double rpm in new double[] { 0, 30, double.NaN })
        {
            Settle(steep, 100);
            Check(Power(steep, 100, rpm: rpm, dt: 0) == 0 && steep.TorqueNm == 0,
                "Stopped or invalid cadence leaves no retained load");
            Power(steep, 100, dt: 1);
            Near(steep.TorqueNm, rate, 1e-10, "Restart after release uses the saved rise rate from zero");
        }
        Settle(steep, 100);
        steep.Reset(); Power(steep, 100, dt: .2);
        Near(steep.TorqueNm, rate * .2, 1e-10, "Session stop/reset removes all retained torque");
        steep.Reset(); Power(steep, 100, dt: 100);
        Near(steep.TorqueNm, rate, 1e-10, "A scheduling stall cannot create a large command jump");

        var crest = new TrainerLoad(MakeCourse(Enumerable.Repeat(18d, 30).Concat(Enumerable.Repeat(-18d, 30)).ToArray()));
        Settle(crest, 100);
        Check(Power(crest, 250, dt: 0) == 0 && crest.TorqueNm == 0,
            "A downhill zero-load target cannot retain uphill resistance");
    }

    public static void VerifyGurten(Course course)
    {
        var load = new TrainerLoad(course);
        var rawJumps = new List<double>(); var filteredJumps = new List<double>();
        double rawPeak = 0, filteredPeak = 0;
        // The public Gurten route's road climb ends around 4.14 km.
        for (int i = 0; i < course.Points.Length - 1 && course.Points[i + 1].D <= 4138; i++)
        {
            var a = course.Points[i]; var b = course.Points[i + 1];
            double grade = load.GradeAt(a.D);
            rawJumps.Add(Math.Abs(b.Grade - a.Grade));
            filteredJumps.Add(Math.Abs(load.GradeAt(b.D) - grade));
            rawPeak = Math.Max(rawPeak, a.Grade); filteredPeak = Math.Max(filteredPeak, grade);
        }
        Check(rawJumps.Count > 500, "Gurten regression requires the full public climb");
        rawJumps.Sort(); filteredJumps.Sort(); int percentile = (int)(rawJumps.Count * .95);
        Check(filteredJumps[percentile] < rawJumps[percentile] * .8 && filteredJumps[^1] < rawJumps[^1] * .6,
            "Gurten terrain sampling must reduce short-distance grade jumps");
        Check(filteredPeak > 20 && filteredPeak > rawPeak * .85,
            "Gurten smoothing must preserve its genuinely steep climbing sections");
    }
}
