#include "BrakeAcquisition.h"
#include <cassert>
#include <iostream>
#include <vector>

struct FakeBus {
    bool muxPresent = true;
    bool present[2] = {true,true};
    bool shortAgc[2] = {false,false};
    bool failDeselect = false;
    bool failSelectLeft = false;
    uint8_t mask = 0;
    uint8_t statuses[2] = {0x20,0x20};
    uint8_t gains[2] = {64,65};
    unsigned selects = 0;
    std::vector<uint8_t> masks;
    bool select(uint8_t value) {
        assert(value == 0 || value == 1 || value == 2);
        masks.push_back(value);
        ++selects;
        if (!muxPresent || (failDeselect && value==0 && selects>1) || (failSelectLeft && value==1)) return false;
        mask = value;
        return true;
    }
    bool readSensor(uint8_t reg, uint8_t* data, size_t length) {
        assert(mask == 1 || mask == 2);
        const int channel = mask==1 ? 0 : 1;
        if (!present[channel]) return false;
        if (reg==0x0b) {
            assert(length==3);
            data[0]=statuses[channel];data[1]=channel==0 ? 0x0f : 0;data[2]=channel==0 ? 0xff : 0;
        } else {
            assert(reg==0x1a && length==1);
            if (shortAgc[channel]) return false;
            data[0]=gains[channel];
        }
        return true;
    }
};

int main() {
    FakeBus bus;
    auto sample=brake::acquire(bus,0x1234);
    sample.uptimeMs=0x01020304;
    assert(sample.muxOk && sample.left.healthy() && sample.right.healthy());
    assert(bus.masks == std::vector<uint8_t>({0,1,0,2,0}));
    assert(bus.mask==0);
    const std::array<uint8_t,20> expected{{1,7,0x34,0x12,4,3,2,1,0xff,0x0f,0,0,0x20,0x20,64,65,0,0,0,0}};
    assert(brake::encode(sample)==expected);

    bus.present[0]=false;
    sample=brake::acquire(bus,1);
    assert(sample.muxOk && !sample.left.readOk && sample.right.healthy());
    assert(sample.left.raw==0xffff && sample.left.status==0xff && sample.left.agc==0xff);
    auto frame=brake::encode(sample);
    assert(frame[1]==5 && frame[8]==0xff && frame[9]==0xff && frame[12]==0xff && frame[14]==0xff);

    FakeBus shortBus;shortBus.shortAgc[1]=true;
    sample=brake::acquire(shortBus,2);
    assert(sample.left.healthy() && !sample.right.readOk && sample.right.raw==0xffff);

    FakeBus absent;absent.muxPresent=false;
    sample=brake::acquire(absent,3);
    assert(!sample.muxOk && !sample.left.readOk && !sample.right.readOk && absent.selects==1);

    FakeBus isolation;isolation.failDeselect=true;
    sample=brake::acquire(isolation,4);
    assert(!sample.muxOk && !sample.left.readOk && !sample.right.readOk);

    FakeBus selection;selection.failSelectLeft=true;
    sample=brake::acquire(selection,5);
    assert(!sample.muxOk && !sample.right.readOk);

    FakeBus magnetic;
    for (uint8_t status : {0x00,0x10,0x30,0x28,0x38}) {
        magnetic.statuses[0]=status;
        sample=brake::acquire(magnetic,6);
        assert(sample.muxOk && sample.left.readOk && !sample.left.healthy());
        assert(sample.left.status==status && sample.right.healthy());
    }
    magnetic.statuses[0]=0x20;
    magnetic.gains[0]=128;
    sample=brake::acquire(magnetic,7);
    assert(sample.left.healthy());
    magnetic.gains[0]=129;
    sample=brake::acquire(magnetic,8);
    assert(sample.left.readOk && !sample.left.healthy());
    // Encoding must discard values when readOk is false, even if a caller
    // accidentally left numbers in an invalid SensorReading.
    sample.left.raw=123;sample.left.status=0x20;sample.left.agc=64;sample.left.readOk=false;
    frame=brake::encode(sample);
    assert(frame[8]==0xff && frame[9]==0xff && frame[12]==0xff && frame[14]==0xff);
    sample.sequence=65535;sample.uptimeMs=0xffffffff;
    frame=brake::encode(sample);
    assert(frame[2]==255 && frame[3]==255 && frame[4]==255 && frame[7]==255);
    std::cout << "PASS: acquisition ordering, independent failures, mux isolation, fresh invalidation, magnetic flags, golden frame and integer boundaries\n";
}
