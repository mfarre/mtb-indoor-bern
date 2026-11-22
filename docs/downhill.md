# Braking and the Dentenberg descent

[Project overview](../README.md) · [Simulator](simulator.md) · [Bluetooth brake project](bluetooth-brakes.md) · [Development log](../DEVELOPMENT_LOG.md)

Hold **A on the right Zwift Click 2** to brake; release it to coast again. You can also hold **Space**, the **A** key or the on-screen **A / Space · Brake** button. `+` shifts up and `B` shifts down, as before. Detection of A being pressed and released has been checked with the real controller.

The brake reduces virtual bicycle speed. **It does not apply a physical brake or increase KICKR load.** On descents, gravity moves the bicycle even at zero power. Small flat sections and rises may require pedalling during a real ride.

## Why braking helps

The central sign shows the direction of the next corner, distance to its entry and the game's target speed. The calculation uses route curvature, surface type and estimated width. Signs also appear within the scene. These values tune gameplay; they are not measurements of real grip or outdoor riding recommendations.

Entering slightly too fast causes a skid, visible lateral movement and loss of speed. Sustained excessive speed takes you off the riding line: the virtual bicycle stops for **3 seconds**, the timer continues and control then returns. Runouts are not random. Braking early lets you retain exit speed and avoid this penalty.

Climbs emphasise **gradient percentage**; descents show **speed**, gradient and whether you are braking or coasting. The grip indicator warns of a skid before control is lost.

## Practice and personal records

**Practise the descent · Dentenberg · forest descent** on the welcome screen places you 55 m before the sector starts. It needs no sensors and does not control the KICKR. It uses the same braking and grip as a real ride, with automatic propulsion on flat sections and rises so you can complete it using only the controls. **Explore in demo** remains available at ×1, ×2, ×4 and ×8; this automatic tour neither scores a time nor applies runouts.

The timed **Dentenberg · forest descent** sector covers **km 4.480–6.980 of the existing Al Dente course**. It is not a second imported track. `handling.json` defines the sector boundaries and can define sectors for other courses.

During a real ride, timing starts when you cross the start line and ends at the finish. It includes stops and recoveries. Your best time is saved to `records.json` beside the executable and reappears when the app reopens. Pausing within the sector invalidates the time; practice and demo sessions cannot set records either. Changes to the route or grip model separate older records from new ones.

If a previously connected Click disconnects during a real ride, the route pauses so the controls can be recovered. Keyboard and on-screen braking release when focus is lost; input messages expire to prevent a stuck brake if the view is interrupted.

## Verification

The built-in tests cover A decoding, release, A+B, braking on a −20% slope, gravity starts at 0 W, time-step stability, excessive corner-entry speed, timing, pausing and record persistence. Run `build.ps1 -SelfTest` to repeat them with the local course data.

The automated descent test, including its approach, takes **384.3 s with 4 runouts** without braking, compared with **365.1 s and no runouts** with anticipatory braking. This compares simulations using practice propulsion; it is neither a pedalling test nor a personal record.

Ground geometry was also corrected at corners where the route revisits the same path with small GPS/barometric elevation differences. A continuous mesh prevents overlapping terrain strips, and the surface of the distant pass is hidden immediately around the rider. Route elevations and physics are preserved.

Click 2 protocol: `0x23` packets contain an active-low button mask; A corresponds to `0x10`. Community reference: [zwiftplay protocol discussion](https://github.com/ajchellew/zwiftplay/issues/5).
