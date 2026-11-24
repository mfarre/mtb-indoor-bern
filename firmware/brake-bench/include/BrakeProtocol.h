#pragma once
#include <array>
#include <cstdint>

namespace brake {
constexpr char ServiceUuid[] = "7d9f0001-6f5b-4ad7-9f2a-6a52b5b3a001";
constexpr char TelemetryUuid[] = "7d9f0002-6f5b-4ad7-9f2a-6a52b5b3a001";
constexpr char DeviceName[] = "MTB Brake Bench";
constexpr uint8_t Version = 1;
constexpr uint16_t InvalidAngle = 0xffff;
constexpr uint8_t InvalidRegister = 0xff;

struct SensorReading {
    uint16_t raw = InvalidAngle;
    uint8_t status = InvalidRegister;
    uint8_t agc = InvalidRegister;
    bool readOk = false;

    bool healthy() const {
        return readOk && raw <= 4095 && agc <= 128 && (status & 0x38) == 0x20;
    }
};

struct Sample {
    uint16_t sequence = 0;
    uint32_t uptimeMs = 0;
    bool muxOk = false;
    SensorReading left;
    SensorReading right;
};

inline std::array<uint8_t,20> encode(const Sample& sample) {
    std::array<uint8_t,20> frame{};
    frame[0] = Version;
    frame[1] = (sample.muxOk ? 1 : 0) | (sample.left.readOk ? 2 : 0) | (sample.right.readOk ? 4 : 0);
    frame[2] = sample.sequence & 0xff;
    frame[3] = sample.sequence >> 8;
    for (unsigned i=0; i<4; ++i) frame[4+i] = (sample.uptimeMs >> (i*8)) & 0xff;
    const SensorReading* sensors[] = {&sample.left, &sample.right};
    for (unsigned i=0; i<2; ++i) {
        const auto& sensor = *sensors[i];
        const uint16_t raw = sensor.readOk ? sensor.raw : InvalidAngle;
        frame[8+2*i] = raw & 0xff;
        frame[9+2*i] = raw >> 8;
        frame[12+i] = sensor.readOk ? sensor.status : InvalidRegister;
        frame[14+i] = sensor.readOk ? sensor.agc : InvalidRegister;
    }
    return frame;
}
}
