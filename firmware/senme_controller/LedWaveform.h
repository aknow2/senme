#pragma once
#include <cstdint>

namespace senme {
constexpr float kBlinkLedDuty = 1.0f;
constexpr uint32_t kBlinkCarrierHz = 20000;
struct LedPulse { uint16_t duration; bool high; };
struct LedEnvelope { LedPulse pulses[4]{}; unsigned count = 0; };
// RMT durations must be nonzero and <=32767; pairs form one symbol.
// Valid periods: 2..65534 us. Preserve both envelope width and period exactly.
inline LedEnvelope ledEnvelope(uint32_t period, uint32_t on) {
  LedEnvelope w;
  if (on > period) on = period;
  const uint32_t off = period - on;
  auto add = [&](uint32_t duration, bool high) {
    w.pulses[w.count++] = {uint16_t(duration), high};
  };
  if (on == 0 || off == 0) {
    add(period / 2, on != 0);
    add(period - period / 2, on != 0);
  } else if (on <= 32767 && off <= 32767) {
    add(on, true); add(off, false);
  } else if (on > 32767) {
    add(on / 3, true); add(on / 3, true);
    add(on - 2 * (on / 3), true); add(off, false);
  } else {
    add(on, true); add(off / 3, false);
    add(off / 3, false); add(off - 2 * (off / 3), false);
  }
  return w;
}
} // namespace senme
