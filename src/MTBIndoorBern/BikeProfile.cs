namespace MTBIndoorBern;

internal sealed class BikeProfile
{
    public string Name { get; set; } = "My MTB";
    public double BikeKg { get; set; } = 14;
    public double WheelCircumferenceM { get; set; } = 2.30;
    // First sprocket is gear 1: the easiest climbing gear.
    public int[] Sprockets { get; set; } = DefaultSprockets();
    public bool LowCadenceAssist { get; set; } = true;
    public string PhysicalGearNote { get; set; } = "";

    public static int[] DefaultSprockets() => [51, 45, 39, 33, 28, 24, 21, 18, 16, 14, 12, 10];

    public BikeProfile Copy() => new()
    {
        Name = Name, BikeKg = BikeKg, WheelCircumferenceM = WheelCircumferenceM,
        Sprockets = Sprockets is null ? DefaultSprockets() : (int[])Sprockets.Clone(),
        LowCadenceAssist = LowCadenceAssist, PhysicalGearNote = PhysicalGearNote
    };

    // Repair old/corrupt saved data. Submitted form values are validated before saving.
    public BikeProfile Normalize()
    {
        Name = string.IsNullOrWhiteSpace(Name) ? "My MTB" : Name.Trim();
        if (Name.Length > 60) Name = Name[..60];
        PhysicalGearNote = PhysicalGearNote?.Trim() ?? "";
        if (PhysicalGearNote.Length > 120) PhysicalGearNote = PhysicalGearNote[..120];
        BikeKg = double.IsFinite(BikeKg) ? Math.Clamp(BikeKg, 5, 35) : 14;
        WheelCircumferenceM = double.IsFinite(WheelCircumferenceM) ? Math.Clamp(WheelCircumferenceM, 1.5, 3) : 2.30;
        if (!ValidSprockets(Sprockets)) Sprockets = DefaultSprockets();
        return this;
    }

    public bool TryValidate(out string error)
    {
        if (string.IsNullOrWhiteSpace(Name) || Name.Trim().Length > 60)
            error = "Enter a bike name between 1 and 60 characters.";
        else if (!double.IsFinite(BikeKg) || BikeKg < 5 || BikeKg > 35)
            error = "Bike weight must be between 5 and 35 kg.";
        else if (!double.IsFinite(WheelCircumferenceM) || WheelCircumferenceM < 1.5 || WheelCircumferenceM > 3)
            error = "Wheel circumference must be between 1.50 and 3.00 metres.";
        else if (!ValidSprockets(Sprockets))
            error = "Enter 4 to 24 sprockets, with 9 to 60 teeth, from largest to smallest without duplicates.";
        else if ((PhysicalGearNote?.Trim().Length ?? 0) > 120)
            error = "The physical gear note can contain up to 120 characters.";
        else { error = ""; return true; }
        return false;
    }

    internal static bool ValidSprockets(int[]? values) => values is { Length: >= 4 and <= 24 }
        && values.All(v => v is >= 9 and <= 60)
        && values.Zip(values.Skip(1)).All(pair => pair.First > pair.Second);
}

internal static class BikeDynamics
{
    public const double TransmissionEfficiency = .96;
    public const double MaximumPower = 600;
    public const double MaximumSpeed = 45 / 3.6;
    public const double DefaultTorqueRisePerSecond = 5;
    private const double Gravity = 9.81, AirDensity = 1.225, DragArea = .51;

    // These are modelling assumptions, not measurements of each mapped trail.
    public static double RollingResistance(string? surface) => surface switch
    {
        "asphalt" => .005,
        "earth" or "leaves" => .012,
        _ => .009
    };
    private static double Mass(double riderKg, BikeProfile profile) =>
        (double.IsFinite(riderKg) ? Math.Clamp(riderKg, 40, 160) : 75)
        + (double.IsFinite(profile.BikeKg) ? Math.Clamp(profile.BikeKg, 5, 35) : 14);
    private static double Circumference(BikeProfile profile) => double.IsFinite(profile.WheelCircumferenceM)
        ? Math.Clamp(profile.WheelCircumferenceM, 1.5, 3) : 2.30;
    public static int Sprocket(int gear, BikeProfile profile)
    {
        var sprockets = BikeProfile.ValidSprockets(profile.Sprockets) ? profile.Sprockets : BikeProfile.DefaultSprockets();
        return sprockets[Math.Clamp(gear, 1, sprockets.Length) - 1];
    }
    public static double Ratio(int gear, int chainring, BikeProfile profile) => Math.Clamp(chainring, 20, 60) / (double)Sprocket(gear, profile);
    public static double Development(int gear, int chainring, BikeProfile profile) => Circumference(profile) * Ratio(gear, chainring, profile);
    public static double StopCadence(BikeProfile profile) => profile.LowCadenceAssist ? 30 : 12;
    public static double FullCadence(BikeProfile profile) => profile.LowCadenceAssist ? 45 : 25;
    public static double CadenceRelease(double cadence, BikeProfile profile)
    {
        if (!double.IsFinite(cadence)) return 0;
        double amount = Math.Clamp((cadence - StopCadence(profile)) / (FullCadence(profile) - StopCadence(profile)), 0, 1);
        return amount * amount;
    }

    // Signed resistance along the road. Negative total force drives downhill coasting.
    public static double RoadForce(double speed, double grade, double riderKg, BikeProfile profile, string surface = "gravel")
    {
        speed = double.IsFinite(speed) ? Math.Max(0, speed) : 0;
        double theta = Math.Atan((double.IsFinite(grade) ? Math.Clamp(grade, -30, 30) : 0) / 100);
        return Mass(riderKg, profile) * Gravity * (Math.Sin(theta) + RollingResistance(surface) * Math.Cos(theta))
            + .5 * AirDensity * DragArea * speed * speed;
    }

    // Actual measured watts drive the avatar. Do not substitute cadence-derived speed here.
    public static double Speed(double speed, double watts, double grade, double riderKg, double dt, BikeProfile profile, string surface = "gravel")
    {
        speed = double.IsFinite(speed) ? Math.Clamp(speed, 0, MaximumSpeed) : 0;
        watts = double.IsFinite(watts) ? Math.Clamp(watts, 0, 2000) : 0;
        dt = double.IsFinite(dt) ? Math.Clamp(dt, 0, .25) : 0;
        double force = watts * TransmissionEfficiency / Math.Max(speed, .5) - RoadForce(speed, grade, riderKg, profile, surface);
        return Math.Clamp(speed + Math.Clamp(force / Mass(riderKg, profile), -4, 2.5) * dt, 0, MaximumSpeed);
    }

    // Steady-state crank torque for the selected virtual gear. ERG is only the power
    // adapter; it cannot reproduce exact wheel inertia or independent torque control.
    private static double RoadCrankTorque(double grade, double difficulty, int gear, double cadence, double riderKg, int chainring, BikeProfile profile, string surface)
    {
        if (!double.IsFinite(cadence) || cadence <= StopCadence(profile)) return 0;
        cadence = Math.Clamp(cadence, 0, 170);
        difficulty = double.IsFinite(difficulty) ? Math.Clamp(difficulty, 0, 1) : .5;
        double development = Development(gear, chainring, profile), speed = cadence / 60 * development;
        double force = RoadForce(speed, grade * difficulty, riderKg, profile, surface);
        return Math.Max(0, force) * development / (2 * Math.PI * TransmissionEfficiency) * CadenceRelease(cadence, profile);
    }
    public static double TargetTorque(double grade, double difficulty, int gear, double cadence, double riderKg, int chainring, BikeProfile profile, string surface = "gravel")
    {
        if (!double.IsFinite(cadence) || cadence <= 0) return 0;
        double torque = RoadCrankTorque(grade, difficulty, gear, cadence, riderKg, chainring, profile, surface);
        return Math.Min(torque, MaximumPower / (Math.Clamp(cadence, 0, 170) * 2 * Math.PI / 60));
    }
    public static double TargetPower(double grade, double difficulty, int gear, double cadence, double riderKg, int chainring, BikeProfile profile, string surface = "gravel")
    {
        if (!double.IsFinite(cadence)) return 0;
        return Math.Clamp(RoadCrankTorque(grade, difficulty, gear, cadence, riderKg, chainring, profile, surface)
            * Math.Clamp(cadence, 0, 170) * 2 * Math.PI / 60, 0, MaximumPower);
    }
}

internal sealed class TorqueRamp
{
    public double TorqueNm { get; private set; }
    public void Reset(double torqueNm = 0) => TorqueNm = double.IsFinite(torqueNm) ? Math.Max(0, torqueNm) : 0;

    // Time-based rise: 5 Nm/s is about 39 W/s at 75 rpm. Reductions release immediately.
    // dt is elapsed control time, not the number of BLE messages or their acknowledgements.
    public double NextPower(double targetWatts, double cadence, double dt, double increaseNmPerSecond = BikeDynamics.DefaultTorqueRisePerSecond)
    {
        if (!double.IsFinite(targetWatts) || !double.IsFinite(cadence) || cadence <= 0)
        { Reset(); return 0; }
        double omega = Math.Clamp(cadence, 0, 170) * 2 * Math.PI / 60;
        double target = Math.Clamp(targetWatts, 0, BikeDynamics.MaximumPower) / omega;
        dt = double.IsFinite(dt) ? Math.Clamp(dt, 0, 1) : 0;
        double rate = double.IsFinite(increaseNmPerSecond) ? Math.Clamp(increaseNmPerSecond, 1, 12) : BikeDynamics.DefaultTorqueRisePerSecond;
        TorqueNm = Math.Min(target, TorqueNm + rate * dt);
        return Math.Clamp(TorqueNm * omega, 0, BikeDynamics.MaximumPower);
    }
}
