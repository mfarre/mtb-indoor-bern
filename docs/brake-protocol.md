# Brake Bench BLE protocol v1

[Assembly guide](bluetooth-brakes.md#maneta-v01) · [Tester](https://mfarre.github.io/mtb-indoor-bern/workshop/tester/) · [Firmware](../firmware/brake-bench/)

This is a project-specific telemetry service for the dual-encoder bench test. It is not a Bluetooth HID, Cycling Power or Fitness Machine service, and the simulator does not yet consume it.

| Field | Value |
| --- | --- |
| Advertised name | `MTB Brake Bench` |
| Service UUID | `7d9f0001-6f5b-4ad7-9f2a-6a52b5b3a001` |
| Telemetry characteristic | `7d9f0002-6f5b-4ad7-9f2a-6a52b5b3a001` |
| Characteristic properties | Read, Notify; CCCD subscription |
| Notification length | Exactly 20 bytes; default ATT MTU 23 is sufficient |
| Nominal update rate | 20 Hz; can fall during I2C faults |
| Multibyte byte order | Little endian |

## Frame layout

| Offset | Type | Meaning |
| ---: | --- | --- |
| 0 | u8 | Protocol version, `1` |
| 1 | u8 | Flags: bit 0 mux communication/isolation OK, bit 1 left registers read OK, bit 2 right registers read OK; other bits zero |
| 2 | u16 | Sequence, increments once per sampling cycle and wraps at 65536 |
| 4 | u32 | `millis()` after acquisition; milliseconds since boot, wraps at 2^32 |
| 8 | u16 | Left raw angle, 0–4095; `0xFFFF` if the read failed |
| 10 | u16 | Right raw angle, 0–4095; `0xFFFF` if the read failed |
| 12 | u8 | Left AS5600 STATUS; `0xFF` if the read failed |
| 13 | u8 | Right AS5600 STATUS; `0xFF` if the read failed |
| 14 | u8 | Left AGC; `0xFF` if the read failed |
| 15 | u8 | Right AGC; `0xFF` if the read failed |
| 16 | 4 bytes | Reserved, all zero |

The raw reading, status and AGC are read during the same sampling cycle, but the two sensors are sampled sequentially, not simultaneously. The timestamp marks the end of that cycle. Failed reads never reuse prior values. A mux selection/deselection failure invalidates both sensor readings because branch isolation is uncertain.

## Validity and client behavior

Read flags describe communication, not magnetic health. A magnetically **healthy** reading requires the mux and channel-read flags, raw angle in 0–4095, AGC in 0–128 for this 3.3 V wiring, and `(status & 0x38) == 0x20`: MD bit 5 set, ML bit 4 and MH bit 3 clear. MD=0 means no valid magnet detection; ML/MH flag insufficient/excessive field. The firmware passes these diagnostic bits through unchanged.

The bench distinguishes a readable warning from a hard fault. With valid communication, MD=1 and exactly one of ML/MH set, it may display angle and **provisional** travel and capture stable endpoints while retaining the amber warning. This is a client-side diagnostic choice, not a declaration that the sensor meets its magnetic specification. Missing MD, failed communication, invalid sentinels or simultaneous ML+MH remain faults. At 3.3 V, AGC 128 with ML set indicates maximum-gain overflow; apparent motion does not cancel that warning. [Manufacturer STATUS/AGC reference](https://cdn-learn.adafruit.com/assets/assets/000/138/130/original/Magnetic_Rotary_Position_Sensor_AS5600_Datasheet.pdf).

Clients must also check freshness: receiving an old packet is not evidence of a live measurement. Invalidate on disconnect and when no new valid-version frame arrives within the tester's stale timeout. Reset per-connection sequence/freshness state on reconnect or detected reboot. Treat sequence wrap normally; firmware time wraps independently.

There are no commands, calibration writes or OTP writes in this service. Endpoint calibration is client-side and must account for the raw 4095/0 wrap and either direction of travel. The tester saves completed endpoints locally by selected Bluetooth device and protocol; manual endpoint entry does not change the BLE payload. The device does not report force or hydraulic pressure.

## Golden fixture

A sample with sequence `0x1234`, uptime `0x01020304`, left raw `4095`, right raw `0`, both STATUS `0x20`, AGC `64` and `65`, and all three flags set encodes as:

```text
01 07 34 12 04 03 02 01 ff 0f 00 00 20 20 40 41 00 00 00 00
```

An initial/disconnected-sensor sample can still be read over BLE. Its unset flags and invalid sentinels must not be displayed as calibrated zero.
