# Brake Bench firmware

[Assembly and wiring guide](https://github.com/mfarre/mtb-indoor-bern/blob/main/docs/bluetooth-brakes.md#maneta-v01) · [Bluetooth tester](https://mfarre.github.io/mtb-indoor-bern/workshop/tester/) · [Wire protocol](../../docs/brake-protocol.md)

An ESP32-S3 application for a **LilyGO T-Beam Supreme** and two AS5600 angle encoders behind a TCA9548A. It sends raw angle and diagnostic readings to the browser tester over Bluetooth LE. The firmware does not drive brakes, control a trainer, implement a Bluetooth gamepad or connect these levers to the MTB simulator yet.

The code is build-checked, with host tests for acquisition failures and packet encoding. A successful build is not a physical hardware test. Check the board revision and complete the assembly guide’s bench test before treating a built device as working.

## Board profile and electrical connection

The supplied profile targets the **T-Beam Supreme ESP32-S3 with 8 MB flash**, using its external four-pin connector, marked **CNC1 in the V3.1 schematic**. It uses USB CDC for logging and reassigns the connector's UART pins to an I2C bus:

| Supreme connector signal | Firmware role | TCA9548A |
| --- | --- | --- |
| Pin 1, GND | Ground | GND |
| Pin 2, VDD3V3 | Regulated 3.3 V | VCC |
| Pin 3, U0TXD / GPIO43 | SDA | Upstream SDA |
| Pin 4, U0RXD / GPIO44 | SCL | Upstream SCL |

Numbers refer to the schematic, not an assumed left-to-right socket view. Confirm connector orientation/continuity and board markings before connecting power. Do not determine polarity solely from cable colours. **VBAT, VSYS and VBUS are not the 3.3 V sensor supply.**

The connector's VDD3V3 supply is the same DC1 rail that runs the ESP32. This firmware therefore needs no PMU rail switching for that connector and does not alter charging or rail configuration. The separate BLDO2 expansion-header output is not equivalent without PMU setup. The onboard GPIO17/18 sensor bus and GPIO42/41 PMU bus are left untouched. PSRAM is not used by this small application.

Connect both encoders to the same 3.3 V and ground. Connect the left encoder SDA/SCL to **SD0/SC0**, and the right to **SD1/SC1**. Both AS5600s use `0x36`. Strap mux A0/A1/A2 low for `0x70`; verify its RESET pull-up and suitable I2C pull-ups on the upstream bus and both used branches. Check fitted module resistors before adding others. DIR must have a defined level; use ground if the AS5600 breakout does not already do so. OUT and programming pads are unused.

The constants in `platformio.ini` select SDA43/SCL44. Do not change them to 17/18 just because that is the onboard I2C bus: this project deliberately uses the external connector.

## Build and upload

Install [Python](https://www.python.org/downloads/) and [PlatformIO Core](https://docs.platformio.org/en/latest/core/installation/index.html), or install the official PlatformIO extension in VS Code. Download/clone this repository. In a terminal at its root:

```sh
python -m pip install platformio==6.1.18
python -m platformio run -d firmware/brake-bench -e tbeam-supreme
python -m platformio device list
```

The project pins Espressif32 platform **6.10.0** and Arduino-ESP32 package **3.20017.0 (Arduino 2.0.17)**. Bluetooth uses the core's bundled BLE library. The first build downloads the toolchain. Generated `.pio/` files are ignored.

1. Connect the Supreme's **USB-C data/flash port** to the computer with a data-capable USB cable. A battery is not needed for the initial USB bench test. The separate core-module micro-USB port is not the port used here.
2. Find the serial device with `device list`. Replace `COM7` below with that device, for example `/dev/ttyACM0` on Linux. Close any other terminal using the port.
3. Upload the application. This replaces the application already installed on the board:

```sh
python -m platformio run -d firmware/brake-bench -e tbeam-supreme -t upload --upload-port COM7
python -m platformio device monitor --port COM7 --baud 115200
```

If the bootloader is not detected, hold **BOOT**, press and release **RST**, then release **BOOT**. Check the newly enumerated USB port and upload again. Press **RST** after upload to run the application; the application port may differ from the bootloader port. In VS Code, open `firmware/brake-bench` as a PlatformIO project and use **Build**, **Upload** and **Serial Monitor** for the same steps.

Normal startup advertises **MTB Brake Bench** automatically. No button press or serial command is required. The application never waits for a serial monitor to be opened. Because USB enumeration takes time, the monitor can miss the first boot messages; the once-per-second status lines continue:

```text
MTB Brake Bench v1 - T-Beam Supreme ESP32-S3
External CNC1: SDA=GPIO43 SCL=GPIO44, 3.3V, 100kHz; mux=0x70 channels=0/1
seq=... mux=1 left=1 raw=... status=0x20 agc=... right=1 raw=... status=0x20 agc=... ble=0
```

These are example messages, not a recorded measurement. `left=1/right=1` mean register reads succeeded; confirm magnetic status as well. `raw=65535`, `status=0xFF`, `agc=255` mark an invalid read.

## Connect from the computer

Open the [online Bluetooth tester](https://mfarre.github.io/mtb-indoor-bern/workshop/tester/) in desktop Chrome or Edge on a computer with Bluetooth enabled. Click **Connect Bluetooth**, select **MTB Brake Bench**, and allow the browser connection. Select it from the webpage's chooser rather than pairing it as an operating-system game controller.

Keep only one BLE client connected. The tester displays raw angles, magnetic diagnostics and connection freshness, and provides client-side endpoint capture and CSV export. Calibrations live in the tester; the firmware stores no calibration or permanent AS5600 settings. The firmware resumes advertising after a client disconnects. If a device remains busy, close other BLE apps/tabs or reset the board.

The online app requires HTTPS; a local copy can use `http://localhost`. A local `file://` page or ordinary LAN HTTP URL is not a suitable Web Bluetooth origin. Browser support and the detailed bench procedure are explained in the [assembly guide](https://github.com/mfarre/mtb-indoor-bern/blob/main/docs/bluetooth-brakes.md#bluetooth-bench-test).

## Firmware behavior

- Samples at a nominal **20 Hz**, selects only mux channel 0 or 1, and disconnects the branch after each read. A sampling cycle begins with all channels off.
- Reads `STATUS`, `RAW_ANGLE` and `AGC`. Successful I2C communication and a healthy magnetic field are different states. Healthy means MD=1 and ML=MH=0.
- Publishes a fixed 20-byte read/notify characteristic; no writable control characteristic, Wi-Fi connection or LoRa transmission is used.
- Sets a **15 ms per-I2C-operation timeout**. Faults can reduce the sample rate. After three consecutive whole-bus failures it attempts a bounded open-drain bus clear, at most once per second, then reinitializes only the external bus.
- Never substitutes a previous reading for a failed read. If mux channel isolation becomes uncertain, both sensor readings are invalidated.
- No AS5600 OTP/configuration writes, permanent calibration or actuator commands are issued. The only I2C configuration writes select TCA9548A channels; AS5600 writes set the register pointer for reads.

Unplugging or a bus fault must appear as an invalid or stale measurement in the tester, not as a valid released lever. A disconnected magnet can still leave I2C healthy; inspect magnetic diagnostics.

## Host tests

The host tests compile the same acquisition and encoding headers used by the firmware. They cover a missing mux, missing sensor, partial read, mux deselection failure, fresh invalidation after a previously good sample, safe channel masks, magnetic diagnostics and the exact BLE packet bytes.

```sh
python firmware/brake-bench/tests/run_host_tests.py --cxx clang++
# Or a local Zig C++ compiler:
python firmware/brake-bench/tests/run_host_tests.py --cxx /path/to/zig --zig
```

These tests do not simulate radio propagation, magnetic geometry, electrical pull-ups or physical USB flashing.

## Primary references

- [LilyGO hardware notes and pin map](https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series/blob/master/docs/en/t_beam_supreme/t_beam_supreme_hw.md)
- [Supreme V3.1 schematic: CNC1 connector](https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series/blob/master/schematic/T-Beam-S3-Supreme/T-Beam-S3-Supreme-V3.1.pdf)
- [ESP32/PMU core schematic](https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series/blob/master/schematic/T-Beam-S3-Supreme/T-Beam-S3-Core.pdf)
- [LilyGO factory PMU initialization reference](https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series/blob/master/examples/Factory/LoRaBoards.cpp)
- [TI TCA9548A datasheet](https://www.ti.com/lit/ds/symlink/tca9548a.pdf)
- [ams AS5600 datasheet](https://cdn-learn.adafruit.com/assets/assets/000/138/130/original/Magnetic_Rotary_Position_Sensor_AS5600_Datasheet.pdf)
- [PlatformIO Espressif32 6.10.0](https://github.com/platformio/platform-espressif32/tree/v6.10.0)
