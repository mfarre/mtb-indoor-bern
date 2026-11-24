#pragma once
#include "BrakeProtocol.h"

namespace brake {
// Transport provides select(mask), readSensor(register, bytes, length).
// This small interface allows the production acquisition order to be tested
// with NACKs and short reads without an ESP32 or attached sensors.
template<class Transport>
SensorReading readChannel(Transport& bus, uint8_t channel, bool& muxOk) {
    SensorReading result;
    if (!bus.select(static_cast<uint8_t>(1u << channel))) {
        muxOk = false;
        return result;
    }
    uint8_t registers[3]{};
    uint8_t agc = InvalidRegister;
    // STATUS 0x0B, RAW_ANGLE high 0x0C, RAW_ANGLE low 0x0D.
    if (bus.readSensor(0x0b, registers, 3) && bus.readSensor(0x1a, &agc, 1)) {
        result.raw = (static_cast<uint16_t>(registers[1] & 0x0f) << 8) | registers[2];
        result.status = registers[0];
        result.agc = agc;
        result.readOk = true;
    }
    if (!bus.select(0)) muxOk = false;
    return result;
}

template<class Transport>
Sample acquire(Transport& bus, uint16_t sequence) {
    Sample sample;
    sample.sequence = sequence;
    // Start with both downstream channels disconnected, also proving mux ACK.
    sample.muxOk = bus.select(0);
    if (!sample.muxOk) return sample;
    sample.left = readChannel(bus, 0, sample.muxOk);
    // Even if a left sensor is absent, a successful channel-1 selection can
    // recover the independent right branch. Never select mask 0x03.
    sample.right = readChannel(bus, 1, sample.muxOk);
    if (!sample.muxOk) {
        // Channel isolation became uncertain: publish neither cached reading.
        sample.left = SensorReading{};
        sample.right = SensorReading{};
    }
    return sample;
}
}
