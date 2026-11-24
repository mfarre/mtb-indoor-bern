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

1. Confirm healthy magnetic status on both channels: MD = 1, ML = 0, MH = 0. A failed read or missing/weak/strong field is shown as a fault or warning.
2. Let the left lever return, hold it still for at least half a second, and choose **Set released**. Pull to a comfortable stop, hold it still, and choose **Set full pull**. Repeat on the right.
3. Pull and release ten times. Calibrated travel is an angle percentage, not force. Zero crossing and opposite sensor directions are handled automatically.
4. Choose **Remember calibration** only if you want to keep the endpoints on this browser. Profiles are keyed by the selected Bluetooth device's browser ID and protocol version; they are not shared across devices or sent to a server. Recalibrate after mechanical changes.
5. **Export CSV** saves the current session, labelled `BLUETOOTH` or `DEMO`, with device name, raw angle, magnetic status, AGC, endpoints and normalized travel. At most the most recent 12,000 samples are retained; the page reports when earlier rows have been discarded. Export before reconnecting or switching to demo.

No advancing telemetry for 750 ms blanks the live measurements and calibrated travel. Duplicate/out-of-order packets do not keep stale readings alive. Disconnect clears displayed readings; the session remains exportable until a new session starts. Calibration is not accepted from unhealthy, moving or stale readings. Implausible endpoint spans and angles far outside the calibrated travel are rejected rather than reported as a full pull.

**Try the demo** uses generated samples and manual sliders. Its fault selector demonstrates missing magnets, weak fields, an I2C read failure, a disconnected mux and stalled telemetry. The demo never connects to hardware or loads/saves a real device's calibration. The demo is not evidence of a physical test.

## Validation

No build step or third-party JavaScript library is needed. Run the transport-independent checks with Node:

```sh
node --test docs/workshop/tester/core.test.mjs
```

These checks cover byte layout, status faults, circular calibration, moving-sample rejection, device scoping, stale/duplicate frames, wraparound, reboot and CSV quoting. Browser/physical validation must be reported separately. A passing software test does not verify wiring, BLE radio range or the mechanics.
