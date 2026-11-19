using System.Text.Json;

namespace MTBIndoorBern;

internal static class BikeProfileTests
{
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static void Near(double actual, double expected, double tolerance, string message) => Check(Math.Abs(actual - expected) <= tolerance, message);

    public static void Verify()
    {
        var bike = new BikeProfile();
        Check(bike.TryValidate(out _), "Default bike profile");
        var copy = bike.Copy(); copy.Sprockets[0] = 52;
        Check(bike.Sprockets[0] == 51, "Bike profile copy must not share gears");
        var roundTrip = JsonSerializer.Deserialize<BikeProfile>(JsonSerializer.Serialize(copy))!;
        Check(roundTrip.Sprockets[0] == 52 && roundTrip.BikeKg == 14 && roundTrip.LowCadenceAssist, "Bike profile serialization");
        var invalid = new BikeProfile { Name = null!, BikeKg = double.NaN, WheelCircumferenceM = double.PositiveInfinity, Sprockets = null!, PhysicalGearNote = null! };
        Check(!invalid.TryValidate(out _), "Reject missing fields"); invalid.Normalize();
        Check(invalid.TryValidate(out _) && invalid.BikeKg == 14 && invalid.WheelCircumferenceM == 2.3, "Repair saved profile");
        foreach (var gears in new int[][] { [], [51, 24, 10], [51, 24, 24, 10], [10, 24, 33, 51], [61, 40, 30, 10], [51, 40, 30, 8] })
            Check(!new BikeProfile { Sprockets = gears }.TryValidate(out _), "Reject invalid cassette");
        Check(!new BikeProfile { Name = " " }.TryValidate(out _) && !new BikeProfile { BikeKg = 36 }.TryValidate(out _)
            && !new BikeProfile { WheelCircumferenceM = 1.4 }.TryValidate(out _) && !new BikeProfile { PhysicalGearNote = new string('x', 121) }.TryValidate(out _), "Reject profile bounds");
        var custom = new BikeProfile { Sprockets = [52, 36, 24, 11] };
        Check(custom.TryValidate(out _), "Four-gear custom cassette");
        Near(BikeDynamics.Development(1, 32, bike), 2.3 * 32 / 51, 1e-10, "Gear rollout");
        Near(BikeDynamics.Ratio(100, 32, custom), 32.0 / 11, 1e-10, "Dynamic gear upper bound");
        Near(BikeDynamics.Ratio(-1, 32, custom), 32.0 / 52, 1e-10, "Dynamic gear lower bound");
        // Independent road-load reference: 89 kg, 10%, 70 rpm, 32x51, no wind.
        Near(BikeDynamics.TargetPower(10, 1, 1, 70, 75, 32, bike), 167.6248, .05, "Steady climbing power reference");
        Near(BikeDynamics.TargetTorque(10, 1, 1, 70, 75, 32, bike), 22.867, .02, "Steady climbing torque reference");
        for (int gear = 2; gear <= bike.Sprockets.Length; gear++)
            Check(BikeDynamics.TargetPower(5, 1, gear, 70, 75, 32, bike) > BikeDynamics.TargetPower(5, 1, gear - 1, 70, 75, 32, bike), "Monotonic gear load below cap");
        Check(BikeDynamics.TargetPower(10, 1, 1, 70, 75, 32, new BikeProfile { BikeKg = 25 }) > BikeDynamics.TargetPower(10, 1, 1, 70, 75, 32, bike), "Bike mass affects climbing effort");
        Check(BikeDynamics.TargetPower(10, 1, 1, 70, 75, 32, new BikeProfile { WheelCircumferenceM = 2.5 }) > BikeDynamics.TargetPower(10, 1, 1, 70, 75, 32, bike), "Wheel rollout affects effort");
        Check(BikeDynamics.RoadForce(3, 0, 75, bike, "asphalt") < BikeDynamics.RoadForce(3, 0, 75, bike, "gravel")
            && BikeDynamics.RoadForce(3, 0, 75, bike, "gravel") < BikeDynamics.RoadForce(3, 0, 75, bike, "leaves"), "Surface rolling force");
        Check(BikeDynamics.TargetPower(12, 1, 1, 30, 75, 32, bike) == 0, "Assisted low-cadence release");
        var unassisted = new BikeProfile { LowCadenceAssist = false };
        Check(BikeDynamics.TargetPower(12, 1, 1, 30, 75, 32, unassisted) > 0
            && BikeDynamics.TargetPower(12, 1, 1, 12, 75, 32, unassisted) == 0, "Unassisted retains stationary protection");
        Near(BikeDynamics.CadenceRelease(45, bike), 1, 1e-10, "Assisted full-load threshold");
        Near(BikeDynamics.CadenceRelease(25, unassisted), 1, 1e-10, "Unassisted full-load threshold");
        Check(BikeDynamics.TargetPower(30, 1, 12, 170, 160, 60, bike) <= 600.0000001, "Power cap");
        Check(BikeDynamics.TargetPower(10, 1, 1, double.NaN, 75, 32, bike) == 0, "Invalid cadence must release");
        Check(BikeDynamics.TargetPower(-15, 1, 1, 70, 75, 32, bike) == 0, "Downhill target must never demand negative power");
        Check(BikeDynamics.Speed(0, 0, 10, 75, .1, bike) == 0 && BikeDynamics.Speed(0, 0, -10, 75, .1, bike) > 0, "Stationary climbing and downhill coasting");
        double steady = 0;
        for (int i = 0; i < 20000; i++) steady = BikeDynamics.Speed(steady, 167.6248, 10, 75, .025, bike);
        Near(steady, 70.0 / 60 * BikeDynamics.Development(1, 32, bike), .001, "Measured power and geared speed converge at full difficulty");
        var fast = new TorqueRamp(); var slow = new TorqueRamp();
        for (int i = 0; i < 40; i++) fast.NextPower(500, 75, .1);
        for (int i = 0; i < 4; i++) slow.NextPower(500, 75, 1);
        Near(fast.TorqueNm, slow.TorqueNm, 1e-10, "Torque rise independent of command frequency");
        Near(fast.TorqueNm, 20, 1e-10, "Five Nm per second torque ramp");
        Near(fast.NextPower(50, 75, .1), 50, 1e-10, "Immediate lower-load release");
        Check(fast.NextPower(500, 0, .1) == 0 && fast.TorqueNm == 0, "Stop releases torque ramp");
        fast.NextPower(500, 75, 100);
        Near(fast.TorqueNm, 5, 1e-10, "Long scheduling stall cannot apply unbounded torque jump");
    }
}
