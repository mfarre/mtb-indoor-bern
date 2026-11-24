#include <Arduino.h>
#include <Wire.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <atomic>
#include "BrakeAcquisition.h"

#ifndef BRAKE_SDA_PIN
#define BRAKE_SDA_PIN 43
#endif
#ifndef BRAKE_SCL_PIN
#define BRAKE_SCL_PIN 44
#endif

namespace {
constexpr uint8_t MuxAddress = 0x70;
constexpr uint8_t SensorAddress = 0x36;
constexpr uint32_t SampleIntervalMs = 50;
constexpr uint16_t I2cTimeoutMs = 15;
constexpr uint32_t RecoveryIntervalMs = 1000;
BLECharacteristic* telemetry = nullptr;
std::atomic<bool> connected{false};
std::atomic<bool> restartAdvertising{false};
uint16_t sequence = 0;
uint32_t lastSample = 0;
uint32_t lastLog = 0;
uint32_t lastRecovery = 0;
unsigned consecutiveFailures = 0;

class SensorBus {
public:
    bool select(uint8_t mask) {
        Wire.beginTransmission(MuxAddress);
        Wire.write(mask);
        return Wire.endTransmission(true) == 0;
    }
    bool readSensor(uint8_t reg, uint8_t* data, size_t length) {
        Wire.beginTransmission(SensorAddress);
        Wire.write(reg);
        if (Wire.endTransmission(false) != 0) return false;
        const size_t count = Wire.requestFrom(SensorAddress, length, true);
        if (count != length) {
            while (Wire.available()) Wire.read();
            return false;
        }
        for (size_t i=0; i<length; ++i) {
            if (!Wire.available()) return false;
            data[i] = static_cast<uint8_t>(Wire.read());
        }
        return true;
    }
} sensorBus;

bool beginSensorBus() {
    const bool ready = Wire.begin(BRAKE_SDA_PIN, BRAKE_SCL_PIN, 100000);
    Wire.setTimeOut(I2cTimeoutMs);
    return ready;
}

void recoverSensorBus() {
    // Standard bounded I2C bus clear. Open-drain HIGH releases a line; it never
    // drives an external low level high. A held-low clock is not forced.
    Wire.end();
    digitalWrite(BRAKE_SDA_PIN, HIGH);
    digitalWrite(BRAKE_SCL_PIN, HIGH);
    pinMode(BRAKE_SDA_PIN, OUTPUT_OPEN_DRAIN);
    pinMode(BRAKE_SCL_PIN, OUTPUT_OPEN_DRAIN);
    delayMicroseconds(10);
    if (digitalRead(BRAKE_SCL_PIN)) {
        for (unsigned i=0; i<9 && !digitalRead(BRAKE_SDA_PIN); ++i) {
            digitalWrite(BRAKE_SCL_PIN, LOW);
            delayMicroseconds(10);
            digitalWrite(BRAKE_SCL_PIN, HIGH);
            delayMicroseconds(10);
            if (!digitalRead(BRAKE_SCL_PIN)) break;
        }
        if (digitalRead(BRAKE_SCL_PIN)) {
            digitalWrite(BRAKE_SCL_PIN, LOW);
            digitalWrite(BRAKE_SDA_PIN, LOW);
            delayMicroseconds(10);
            digitalWrite(BRAKE_SCL_PIN, HIGH);
            delayMicroseconds(10);
            if (digitalRead(BRAKE_SCL_PIN)) digitalWrite(BRAKE_SDA_PIN, HIGH);
        }
    }
    pinMode(BRAKE_SDA_PIN, INPUT);
    pinMode(BRAKE_SCL_PIN, INPUT);
    beginSensorBus();
}

class ServerCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer*) override { connected.store(true); }
    void onDisconnect(BLEServer*) override {
        connected.store(false);
        restartAdvertising.store(true);
    }
};
ServerCallbacks serverCallbacks;

void beginBle() {
    BLEDevice::init(brake::DeviceName);
    auto* server = BLEDevice::createServer();
    server->setCallbacks(&serverCallbacks);
    auto* service = server->createService(brake::ServiceUuid);
    telemetry = service->createCharacteristic(brake::TelemetryUuid,
        BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    telemetry->addDescriptor(new BLE2902());
    auto empty = brake::encode(brake::Sample{});
    telemetry->setValue(empty.data(), empty.size());
    service->start();
    auto* advertising = BLEDevice::getAdvertising();
    advertising->addServiceUUID(brake::ServiceUuid);
    advertising->setScanResponse(true);
    advertising->setMinPreferred(0x06);
    advertising->setMaxPreferred(0x12);
    advertising->start();
}
}

void setup() {
    Serial.begin(115200); // USB CDC; GPIO43/44 remain available for I2C.
    // No waiting for a serial terminal: normal boot must work without a PC.
    beginSensorBus();
    beginBle();
    Serial.println("MTB Brake Bench v1 - T-Beam Supreme ESP32-S3");
    Serial.printf("External CNC1: SDA=GPIO%d SCL=GPIO%d, 3.3V, 100kHz; mux=0x70 channels=0/1\n", BRAKE_SDA_PIN, BRAKE_SCL_PIN);
    Serial.println("BLE advertising: MTB Brake Bench. Telemetry only; no game control or OTP writes.");
}

void loop() {
    if (restartAdvertising.exchange(false)) BLEDevice::startAdvertising();
    const uint32_t now = millis();
    if (static_cast<uint32_t>(now-lastSample) < SampleIntervalMs) {
        delay(1);
        return;
    }
    lastSample = now;
    auto sample = brake::acquire(sensorBus, sequence++);
    sample.uptimeMs = millis();
    auto frame = brake::encode(sample);
    telemetry->setValue(frame.data(), frame.size());
    if (connected.load()) telemetry->notify();

    const bool busFault = !sample.muxOk || (!sample.left.readOk && !sample.right.readOk);
    consecutiveFailures = busFault ? min(consecutiveFailures+1, 3u) : 0;
    if (consecutiveFailures >= 3 && static_cast<uint32_t>(now-lastRecovery) >= RecoveryIntervalMs) {
        lastRecovery = now;
        recoverSensorBus();
    }
    if (static_cast<uint32_t>(now-lastLog) >= 1000) {
        lastLog = now;
        Serial.printf("seq=%u mux=%u left=%u raw=%u status=0x%02X agc=%u right=%u raw=%u status=0x%02X agc=%u ble=%u\n",
            sample.sequence, sample.muxOk, sample.left.readOk, sample.left.raw, sample.left.status, sample.left.agc,
            sample.right.readOk, sample.right.raw, sample.right.status, sample.right.agc, connected.load());
    }
}
