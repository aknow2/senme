#include "../senme_controller/Control.h"
#include <cassert>
#include <iostream>
#include <limits>

using namespace senme;

bool near(float a, float b) { return std::fabs(a - b) < 0.01f; }

void testSequence() {
  Settings s;
  s.motorPercent = 80;
  auto at = [&](uint32_t t) { return outputFor(Mode::Sequence, t, s); };
  assert(at(0).phase == 1 && near(at(0).brightness, 0) && at(0).motorPercent == 0);
  assert(near(at(1250).brightness, 0.5f));
  assert(near(at(2500).brightness, 1));
  assert(near(at(5000).brightness, 0));
  assert(at(19999).phase == 1);
  assert(at(20000).phase == 2 && at(20000).motorPercent == 55);
  assert(at(20000).led == LedPattern::Steady);
  assert(near(at(20000).brightness, 0.0f));
  assert(near(at(27500).brightness, 0.5f));
  assert(at(34999).brightness > 0.999f);
  assert(at(35000).led == LedPattern::Blink);
  assert(near(at(27500).motorPercent, 67.5f));
  assert(at(34999).phase == 2);
  assert(at(35000).phase == 3 && at(35000).motorPercent == 80);
  assert(at(94999).phase == 3 && at(94999).motorPercent == 80);
  assert(at(95000).phase == 4 && at(95000).motorPercent == 80);
  assert(near(at(102500).motorPercent, 67.5f));
  assert(at(109999).phase == 4);
  assert(at(110000).phase == 1 && at(110000).motorPercent == 0);
  assert(near(at(110000).brightness, 0));
  assert(at(220000).phase == 1);
  for (uint32_t t = 0; t < kCycleMs; ++t) {
    const auto out = at(t);
    assert(out.led == (t < 20000 ? LedPattern::Breathe :
                       t < 35000 ? LedPattern::Steady : LedPattern::Blink));
    if (t >= 20000 && t < 35000) assert(near(out.brightness, float(t - 20000) / 15000));
    assert(out.brightness >= 0 && out.brightness <= 1);
    assert(out.motorPercent >= 0 && out.motorPercent <= 80);
  }
  s.motorPercent = 0;
  for (uint32_t t = 0; t < kCycleMs; t += 100) assert(at(t).motorPercent == 0);

  // The sketch rebases its start once per cycle; verify an overflowing clock.
  uint32_t start = std::numeric_limits<uint32_t>::max() - 10000;
  uint32_t now = start + 35000;
  assert(outputFor(Mode::Sequence, uint32_t(now - start), s).phase == 3);
  now = start + kCycleMs;
  while (uint32_t(now - start) >= kCycleMs) start += kCycleMs;
  assert(uint32_t(now - start) == 0);
}

void testEditing() {
  Settings s;
  assert(s.motorPercent == 55 && s.motorPercent == kMotorStartPercent && s.motorPercent == kEditStopPercent);
  s.adjust(Mode::EditLed, 1);
  assert(s.ledOnUs == 5500);
  s.adjust(Mode::EditLed, -1);
  assert(s.ledOnUs == 5000);
  s.adjust(Mode::EditLed, -10000);
  assert(s.ledOnUs == 0);
  s.adjust(Mode::EditLed, 10000);
  assert(s.ledOnUs == kBlinkPeriodUs);
  s.validate();
  assert(s.ledOnUs == 55550); // Continuous-on survives saved-setting validation.
  s.adjust(Mode::EditLed, -1);
  assert(s.ledOnUs == 55500);
  s.validate();
  assert(s.ledOnUs == 55500);
  s.adjust(Mode::EditLed, 1);
  assert(s.ledOnUs == 55550);
  s.ledOnUs = 56000; // Migrate the previous continuous-on setting.
  s.validate();
  assert(s.ledOnUs == 55550);
  s.adjust(Mode::EditMotor, 1);
  assert(s.motorPercent == 56);
  s.adjust(Mode::EditMotor, -10000);
  assert(s.motorPercent == 0);
  s.adjust(Mode::EditMotor, 10000);
  assert(s.motorPercent == 100);
  s.adjust(Mode::Sequence, -10000);
  s.adjust(Mode::EspNow, -10000);
  assert(s.motorPercent == 100 && s.ledOnUs == kBlinkPeriodUs);
  assert(outputFor(Mode::EditLed, 123, s).motorPercent == 0);
  assert(outputFor(Mode::EditMotor, 15000, s).motorPercent == 100);
  assert(outputFor(Mode::EditMotor, 123, s).led == LedPattern::Steady);
  s.ledOnUs = 123;
  s.motorPercent = 101;
  s.validate();
  assert(s.ledOnUs == 5000 && s.motorPercent == 55);
}

void testEditStop() {
  const uint8_t start[] = "START";
  Settings settings;
  for (uint32_t origin : {100u, std::numeric_limits<uint32_t>::max() - 5000}) {
    for (float maximum : {0.0f, 20.0f, 30.0f, 54.0f, 55.0f, 56.0f, 80.0f, 100.0f}) {
      RemoteRun run;
      run.stopEditing(origin, maximum);
      assert(run.busy() && !run.receive(start, 5));
      float previous = maximum;
      for (uint32_t elapsed = 0; elapsed <= 15000; ++elapsed) {
        run.tick(origin + elapsed);
        const float percent = run.output(origin + elapsed, settings).motorPercent;
        assert(percent >= 0 && percent <= previous);
        previous = percent;
        assert(!run.receive(start, 5));
        if (maximum > 0 && elapsed < 15000) {
          assert(!run.editStopDue(origin + elapsed));
          assert(near(percent, maximum + ((maximum < 55 ? maximum : 55) - maximum) * elapsed / 15000));
          run.confirmEditStopped(origin + elapsed);
          assert(run.busy());
        } else {
          assert(run.editStopDue(origin + elapsed) && percent == 0);
        }
      }
      // No START accepted until hardware stop is acknowledged.
      assert(run.busy());
      run.confirmEditStopped(origin + 15123);
      assert(!run.busy() && run.state() == RemoteRun::State::Ready);
      assert(run.receive(start, 5));
    }
  }
  MotorStop stop;
  assert(!stop.active());
  stop.begin(100, 80);
  assert(stop.active() && stop.output(100) == 80);
  assert(near(stop.output(7600), 67.5f));
  assert(stop.output(15099) > 55 && !stop.due(15099));
  assert(stop.output(15100) == 0 && stop.due(15100));
  stop.finish();
  assert(!stop.active());
  stop.begin(20000, 0);
  assert(!stop.active());
  settings.motorPercent = 80;
  assert(outputFor(Mode::EditMotor, 0, settings).motorPercent == 55);
  assert(near(outputFor(Mode::EditMotor, 7500, settings).motorPercent, 67.5f));
  assert(outputFor(Mode::EditMotor, 15000, settings).motorPercent == 80);
  assert(outputFor(Mode::EditMotor, 60000, settings).motorPercent == 80);
  for (uint32_t t = 0; t < 15000; ++t) {
    const auto out = outputFor(Mode::EditMotor, t, settings);
    assert(out.led == LedPattern::Steady && near(out.brightness, float(t) / 15000));
  }
  assert(outputFor(Mode::EditMotor, 15000, settings).led == LedPattern::Blink);
}

void testRemoteRun() {
  const uint8_t start[] = "START";
  const uint8_t bad[] = "STARTX";
  Settings settings;
  settings.motorPercent = 80;
  // Repeat across millis() overflow.
  for (const uint32_t origin : {100u, std::numeric_limits<uint32_t>::max() - 10000,
                                std::numeric_limits<uint32_t>::max() - 62000}) {
    RemoteRun run;
    assert(!run.receive(start, 5));
    run.enable(origin);
    assert(!run.receive(nullptr, 5));
    assert(!run.receive(start, 0));
    assert(!run.receive(start, 4));
    assert(!run.receive(start, 7));
    assert(!run.receive(bad, 6));
    assert(!run.receive(reinterpret_cast<const uint8_t*>("start"), 5));
    assert(run.state() == RemoteRun::State::Ready);
    for (uint32_t elapsed = 0; elapsed <= 125000; elapsed += 1250) {
      run.tick(origin + elapsed);
      const auto out = run.output(origin + elapsed, settings);
      assert(out.led == LedPattern::Breathe && out.motorPercent == 0);
      assert(near(out.brightness, outputFor(Mode::Sequence, elapsed % 5000, settings).brightness));
    }
    // Re-entering standby restarts the fade at zero brightness.
    run.disable();
    run.enable(origin);
    assert(near(run.output(origin, settings).brightness, 0));
    assert(run.receive(start, 5));
    assert(run.busy());
    assert(!run.receive(start, 6)); // Burst before loop cannot queue a second run.
    run.tick(origin);
    auto at = [&](uint32_t elapsed) { return run.output(origin + elapsed, settings); };
    assert(at(0).motorPercent == 55 && at(0).phase == 2);
    assert(near(at(7500).motorPercent, 67.5f));
    assert(at(14999).phase == 2);
    assert(at(15000).motorPercent == 80 && at(15000).phase == 3);
    assert(at(44999).phase == 3);
    assert(at(45000).phase == 4 && at(45000).motorPercent == 80);
    assert(near(at(52500).motorPercent, 67.5f));
    assert(at(59999).phase == 4);
    for (uint32_t t = 0; t < kRemoteRunMs; ++t) {
      run.tick(origin + t);
      assert(!run.receive(start, 5));
      if (t < 15000) assert(near(at(t).brightness, float(t) / 15000));
      assert(at(t).motorPercent >= 0 && at(t).motorPercent <= 80);
      assert(at(t).led == (t < 15000 ? LedPattern::Steady : LedPattern::Blink));
    }
    assert(at(60000).motorPercent == 0 && at(60000).led == LedPattern::Breathe);
    run.tick(origin + 60000);
    assert(run.stopDue(origin + 60000));
    assert(!run.receive(start, 5));
    // Cooldown starts at the actual stop acknowledgement, not the scheduled end.
    run.confirmStopped(origin + 60123);
    assert(run.state() == RemoteRun::State::Cooldown && !run.busy());
    assert(at(60123).led == LedPattern::Breathe && near(at(60123).brightness, 0));
    assert(at(62623).motorPercent == 0 && near(at(62623).brightness, 1));
    for (uint32_t elapsed = 0; elapsed < 3000; ++elapsed) {
      run.tick(origin + 60123 + elapsed);
      assert(run.state() == RemoteRun::State::Cooldown);
      assert(!run.receive(start, 5) && !run.receive(start, 6));
      assert(at(60123 + elapsed).motorPercent == 0);
    }
    run.tick(origin + 63123);
    assert(run.state() == RemoteRun::State::Ready);
    assert(near(at(63123).brightness, breatheOutput(3000).brightness));
    run.tick(origin + 100000);
    assert(run.state() == RemoteRun::State::Ready); // No replay of ignored requests.
    assert(run.receive(start, 6)); // Optional trailing NUL accepted.
    run.tick(origin + 100000);
    assert(at(100000).led == LedPattern::Steady);
    assert(near(at(100000).brightness, 0.0f));
    assert(at(107500).motorPercent == 67.5f);
    run.confirmStopped(origin + 115000); // Early acknowledgement cannot reopen reception.
    assert(run.busy() && !run.receive(start, 5));
    run.confirmStopped(origin + 160000);
    assert(!run.receive(start, 5));
    run.tick(origin + 162999);
    assert(!run.receive(start, 5));
    run.tick(origin + 163000);
    assert(run.receive(start, 5));
    run.tick(origin + 163000);
    assert(at(163000).motorPercent == 55 && at(163000).phase == 2);
    run.disable();
    assert(at(107500).motorPercent == 0);
    assert(!run.receive(start, 5));
    run.enable(origin);
    assert(run.state() == RemoteRun::State::Ready);
  }
}

void testButton() {
  // Feed every millisecond, just as loop() does: a silent multi-second gap
  // must not masquerade as a continuously observed hold in these tests.
  for (uint32_t origin : {0u, std::numeric_limits<uint32_t>::max() - 500}) {
    for (uint32_t held : {10u, 30u, 100u, 500u, 2999u, 3000u, 5000u}) {
      Button b;
      unsigned clicks = 0, longs = 0;
      for (uint32_t t = 0; t <= held + 200; ++t) {
        const auto e = b.update(t >= 50 && t < 50 + held, origin + t);
        clicks += e == ButtonEvent::Click;
        longs += e == ButtonEvent::LongPress;
        assert(!b.samplingInterrupted());
      }
      assert(clicks == (held >= kDebounceMs && held < kLongPressMs ? 1u : 0u));
      assert(longs == (held >= kLongPressMs ? 1u : 0u));
      if (clicks || longs) assert(b.lastPressMs() == (held < kLongPressMs ? held : kLongPressMs));
    }
    // Multiple short clicks never accumulate into one long hold.
    Button repeated;
    unsigned clicks = 0;
    for (uint32_t t = 0; t < 6000; ++t) {
      const auto e = repeated.update(t % 200 >= 50 && t % 200 < 100, origin + t);
      assert(e != ButtonEvent::LongPress);
      clicks += e == ButtonEvent::Click;
    }
    assert(clicks == 30);

    // Contact bounce on both edges yields exactly one click.
    Button bounce;
    clicks = 0;
    for (uint32_t t = 0; t < 500; ++t) {
      const bool down = (t >= 100 && t < 110 && t % 2 == 0) ||
                        (t >= 110 && t < 200) ||
                        (t >= 200 && t < 210 && t % 2 == 0);
      const auto e = bounce.update(down, origin + t);
      assert(e != ButtonEvent::LongPress);
      clicks += e == ButtonEvent::Click;
    }
    assert(clicks == 1);

    for (bool resumedDown : {false, true}) {
      Button stalled;
      for (uint32_t t = 0; t <= 150; ++t) {
        assert(stalled.update(t >= 100, origin + t) == ButtonEvent::None);
      }
      // A short press was released during a stalled loop. The resumed sample
      // may be released, or belong to an entirely new press: neither is SAVE.
      assert(stalled.update(resumedDown, origin + 4000) == ButtonEvent::None);
      assert(stalled.samplingInterrupted());
      for (uint32_t t = 4001; t <= 8000; ++t) {
        assert(stalled.update(resumedDown && t < 7500, origin + t) == ButtonEvent::None);
      }
      clicks = 0;
      for (uint32_t t = 8001; t <= 8300; ++t) {
        const auto e = stalled.update(t >= 8100 && t < 8200, origin + t);
        assert(e != ButtonEvent::LongPress);
        clicks += e == ButtonEvent::Click;
      }
      assert(clicks == 1); // A clean release rearms the button.
    }
  }
}

void testStartRampLimits() {
  const uint8_t start[] = "START";
  for (const uint32_t target : {0u, 20u, 30u, 54u, 55u, 56u, 80u, 100u}) {
    Settings settings;
    settings.motorPercent = target;
    RemoteRun run;
    run.enable(0);
    assert(run.receive(start, 5));
    run.tick(0);
    const float initial = target < 55 ? float(target) : 55.0f;
    float previous = initial;
    for (const uint32_t t : {0u, 1u, 7500u, 14999u, 15000u}) {
      const auto sequence = outputFor(Mode::Sequence, 20000 + t, settings);
      const auto edit = outputFor(Mode::EditMotor, t, settings);
      const auto remote = run.output(t, settings);
      const float expected = initial + (target - initial) * t / 15000.0f;
      assert(near(sequence.motorPercent, expected));
      assert(near(edit.motorPercent, expected));
      assert(near(remote.motorPercent, expected));
      assert(sequence.motorPercent >= previous && sequence.motorPercent <= target);
      previous = sequence.motorPercent;
    }
  }
}

void testSaveIndicator() {
  for (const uint32_t origin : {100u, std::numeric_limits<uint32_t>::max() - 500}) {
    SaveIndicator indicator;
    assert(indicator.level(origin) == -1);
    indicator.begin(origin);
    unsigned pulses = 0;
    int previous = 0;
    for (uint32_t t = 0; t < 1000; ++t) {
      const int level = indicator.level(origin + t);
      assert(level == 0 || level == 1);
      if (level == 1 && previous == 0) ++pulses;
      previous = level;
    }
    assert(pulses == 3 && previous == 0);
    assert(indicator.level(origin + 1000) == -1);
    assert(indicator.level(origin) == -1); // Must not replay after clock rollover.
    indicator.begin(origin + 2000);
    assert(indicator.level(origin + 2000) == 1);
    assert(indicator.level(origin + 2167) == 0);
    indicator.begin(origin + 2200); // A new successful save restarts feedback.
    assert(indicator.level(origin + 2200) == 1);
    assert(indicator.level(origin + 3200) == -1);
  }
}

void testModeIndicator() {
  for (const uint32_t origin : {100u, std::numeric_limits<uint32_t>::max() - 250}) {
    ModeIndicator indicator;
    assert(indicator.level(origin) == -1);
    indicator.begin(origin);
    unsigned pulses = 0;
    int previous = 0;
    for (uint32_t t = 0; t < 500; ++t) {
      const int expected = (t >= 100 && t < 180) || (t >= 280 && t < 360) ? 1 : 0;
      const int level = indicator.level(origin + t);
      assert(level == expected);
      if (level == 1 && previous == 0) ++pulses;
      previous = level;
    }
    assert(pulses == 2 && previous == 0);
    assert(indicator.level(origin + 500) == -1);
    assert(indicator.level(origin) == -1);
    indicator.begin(origin + 600);
    assert(indicator.level(origin + 700) == 1);
    indicator.begin(origin + 720); // A second accepted change restarts the cue.
    assert(indicator.level(origin + 720) == 0);
    assert(indicator.level(origin + 820) == 1);
    indicator.cancel();
    assert(indicator.level(origin + 830) == -1);
    SaveIndicator save;
    save.begin(origin);
    assert(save.level(origin) == 1);
    save.cancel();
    assert(save.level(origin + 1) == -1);
  }
}

int main() {
  testModeIndicator();
  testSaveIndicator();
  testStartRampLimits();
  testSequence();
  testEditing();
  testButton();
  testRemoteRun();
  testEditStop();
  std::cout << "PASS: edit stop, sequence, settings, button, ESP-NOW run/3-second-cooldown/discard, clock rollover\n";
}
