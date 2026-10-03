#include "../sense_sender/ShakeDetector.h"
#include <cassert>
#include <iostream>
#include <limits>

void testShake(uint32_t origin) {
  sense::ShakeDetector d;
  uint32_t t = origin;
  auto sample = [&](float x, float y, float z) {
    const bool result = d.update(x, y, z, t);
    t += 10;
    return result;
  };
  // Startup motion does not transmit until the first quiet interval.
  for (int i = 0; i < 200; ++i) assert(!sample(0, 0, 4.1f));
  for (int i = 0; i < 300; ++i) {
    assert(!sample(0, 0, 1));
    assert(!d.armed());
  }
  assert(!sample(0, 0, 1) && d.armed());
  // Static orientation and low amplitude noise do not trigger.
  for (int i = 0; i < 200; ++i) assert(!sample(0.6f, 0.8f, 0));
  for (int i = 0; i < 100; ++i) assert(!sample(0, 0, i % 2 ? 1.1f : 0.9f));
  // Exactly 3 g of deviation must not trigger, even on repeated readings.
  for (int i = 0; i < 10; ++i) assert(!sample(0, 0, 4));
  assert(!sample(0, 0, 4.1f)); // Isolated spike is ignored.
  assert(!sample(0, 0, 1));
  assert(!sample(0, 4.1f, 0));
  assert(sample(0, 4.1f, 0));
  assert(!d.armed());
  // A continuous shake lasting beyond the receiver's cycle still sends once.
  for (int i = 0; i < 7000; ++i) assert(!sample(0, 4.1f, 0));
  for (int i = 0; i < 301; ++i) assert(!sample(1, 0, 0));
  assert(d.armed());
  assert(!sample(-4.1f, 0, 0));
  assert(sample(-4.1f, 0, 0));
  // Rearm exactly after 3 seconds of quiet, with send spacing also satisfied.
  for (int i = 0; i < 300; ++i) {
    assert(!sample(0, 0, -1));
    assert(!d.armed());
  }
  assert(!sample(0, 0, -1) && d.armed());
  d.invalidate();
  assert(!d.armed());
  assert(!sample(0, 0, 4.1f));
  assert(!sample(0, 0, 4.1f));
  for (int i = 0; i < 301; ++i) assert(!sample(0, 0, 1));
  assert(d.armed());
  assert(!sample(std::numeric_limits<float>::quiet_NaN(), 0, 1));
  assert(!d.armed());
  for (int i = 0; i < 301; ++i) assert(!sample(0, 0, 1));
  assert(d.armed());
  t += 1000; // Missing samples must not count as a quiet interval.
  assert(!sample(0, 0, 4.1f));
  assert(!d.armed());
}

void testQuietBoundary() {
  sense::ShakeDetector d;
  uint32_t t = 0;
  // 1.01 g is not quiet and cannot arm the detector.
  for (; t <= 4000; t += 10) {
    assert(!d.update(0, 0, 2.01f, t));
    assert(!d.armed());
  }
  const uint32_t quietAt = t;
  // 1.0 g is quiet, including the boundary itself.
  for (; t < quietAt + 3000; t += 10) {
    assert(!d.update(0, 0, 2.0f, t));
    assert(!d.armed());
  }
  assert(!d.update(0, 0, 2.0f, t));
  assert(d.strengthG() == sense::kQuietG);
  assert(d.armed());
}

int main() {
  testQuietBoundary();
  testShake(0);
  testShake(std::numeric_limits<uint32_t>::max() - 500);
  std::cout << "PASS: shake threshold, orientation, startup, rearm, continuous shake, sensor gaps, rollover\n";
}
