# Brake bench tester

[Prototype assembly and wiring guide](../../bluetooth-brakes.md#maneta-v01)

A browser-local, read-only test tool for the [brake-bench firmware](../../../firmware/brake-bench/) and [v1 telemetry protocol](../../brake-protocol.md). It reads two AS5600 channels through the TCA9548A and LilyGO T-Beam Supreme. It does not control the trainer, write to the encoders or connect the levers to the simulator.

Open the [hosted tester](https://mfarre.github.io/mtb-indoor-bern/workshop/tester/) in a current Chrome or Edge desktop browser on a computer with Bluetooth. Web Bluetooth needs HTTPS or localhost and an explicit click on **Connect Bluetooth**. Select **MTB Brake Bench**. Close another BLE client if it has already connected to the board. [Browser API requirements](https://developer.chrome.com/docs/capabilities/bluetooth).

For local use, serve the repository's `docs` directory, then open the printed localhost address with `/workshop/tester/`. For example, from the repository root:

```sh
python -m http.server 8000 --directory docs --bind 127.0.0.1
```

Open `http://localhost:8000/workshop/tester/`. A `file://` URL is not the supported launch method.

## Bench sequence

1. Check the status on each lever. **Healthy** means MD = 1, ML = 0, MH = 0. A detected magnet with a weak or strong field keeps an amber warning: its angle and provisional travel can be inspected, but that does not validate magnetic accuracy.
2. Let the left lever return, hold it still for at least half a second, and choose **Set released**. Pull to a comfortable stop, hold it still, and choose **Set full pull**. Repeat on the right.
3. Pull and release ten times. Calibrated travel is an angle percentage, not force. Zero crossing and opposite sensor directions are handled automatically.
4. Completed endpoints are saved automatically for the selected Bluetooth device and protocol in this browser. Check the save status beside the lever. **Clear** removes that lever's local calibration. Recalibrate after mechanical changes.
5. If you have already measured the endpoints, enter the **released** and **full-pull raw values** in that lever's manual fields and choose **Save endpoints**. Values must be whole encoder counts from 0 to 4095, with a plausible stroke; decreasing values and a 4095/0 crossing are supported. These are your own measurements, not universal defaults.

The tester now concentrates on the two lever cards. The combined history plot, session recorder and CSV export have been removed. Calibration is local to the browser; it is not written to the controller or the AS5600.

No advancing telemetry for 750 ms blanks the live measurements and calibrated travel. Duplicate/out-of-order packets do not keep stale readings alive. Disconnect also clears live values. Capture rejects moving or stale readings, failed I2C reads, missing magnets and invalid status combinations. A readable detected magnet with only a weak/strong-field warning can supply provisional endpoints; the warning remains visible. Implausible spans and angles far outside calibrated travel are rejected rather than reported as a full pull.

## A moving angle with a weak-field warning

These can occur together. **MD = 1, ML = 1, MH = 0** means the chip detects the magnet while reporting insufficient field for its gain range. At the project's 3.3 V supply, **AGC 128 is maximum gain**, not a midpoint. An angle that responds to a pull therefore does not prove healthy magnetic conditions. See the manufacturer [AS5600 datasheet, STATUS/AGC and magnetic requirements](https://cdn-learn.adafruit.com/assets/assets/000/138/130/original/Magnetic_Rotary_Position_Sensor_AS5600_Datasheet.pdf).

Centre the rotating diametric magnet over the **chip**, keep the PCB fixed and parallel, and adjust the magnet-to-chip gap while watching status throughout the stroke. With a weak field, carefully reducing that gap may help; preserve mechanical clearance. Choose the final spacing from the actual readings and repeatability, not a universal printed spacer thickness. Saving endpoints changes the percentage mapping; it does not repair the field.

**Try the demo** uses generated samples and manual sliders. Its fault selector demonstrates missing magnets, weak fields, an I2C read failure, a disconnected mux and stalled telemetry. The demo never connects to hardware or loads/saves a real device's calibration. The demo is not evidence of a physical test.

## Validation

No build step or third-party JavaScript library is needed. Run the transport-independent checks with Node:

```sh
node --test docs/workshop/tester/core.test.mjs
```

The software checks cover byte layout, magnetic health versus readable warnings, circular calibration in both directions, moving-sample rejection, device scoping, stale/duplicate frames, wraparound and reboot. Browser/physical validation must be reported separately. A passing software test does not verify wiring, BLE radio range or the mechanics.

On **28 November 2026**, the hosted tester was observed receiving real BLE readings from both prototype levers. Both reported MD = 1, ML = 1, MH = 0 and AGC 128. This confirms live acquisition and transport, with a weak-field condition still to resolve; it is not a completed magnetic-quality or repeatability test. The custom levers remain separate from simulator braking.
