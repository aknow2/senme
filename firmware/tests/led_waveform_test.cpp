#include "../senme_controller/LedWaveform.h"
#include <cassert>
#include <iostream>

int main() {
  using namespace senme;
  assert(kBlinkLedDuty == 1.0f && kBlinkCarrierHz == 20000);
  for (uint32_t period : {1000u, 55550u}) {
    for (uint32_t on = 0; on <= period; ++on) {
      const auto w = ledEnvelope(period, on);
      assert(w.count == 2 || w.count == 4);
      uint32_t total = 0, high = 0;
      bool reachedOff = false;
      for (unsigned i = 0; i < w.count; ++i) {
        const auto p = w.pulses[i];
        assert(p.duration > 0 && p.duration <= 32767);
        total += p.duration;
        if (p.high) { assert(!reachedOff); high += p.duration; }
        else reachedOff = true;
      }
      assert(total == period && high == on);
    }
  }
  const auto blink = ledEnvelope(55550, 1500);
  uint32_t high = 0;
  for (unsigned i = 0; i < blink.count; ++i)
    if (blink.pulses[i].high) high += blink.pulses[i].duration;
  assert(high == 1500); // Brightness must not shorten the strobe envelope.
  std::cout << "PASS: all fade/strobe widths preserve envelope, period, RMT limits and endpoints\n";
}
