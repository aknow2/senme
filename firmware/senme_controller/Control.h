#pragma once

#include <cmath>
#include <cstdint>
#include <cstring>

namespace senme {

constexpr uint32_t kBlinkPeriodUs = 55550;
constexpr uint32_t kOnStepUs = 500;
constexpr uint32_t kCycleMs = 110000;
constexpr uint32_t kMotorRampMs = 15000;
constexpr uint32_t kEditStopMs = kMotorRampMs;
constexpr float kMotorStartPercent = 45.0f;
constexpr float kEditStopPercent = 45.0f;
constexpr uint32_t kLongPressMs = 3000;
constexpr uint32_t kDebounceMs = 25;
constexpr uint32_t kButtonMaxSampleGapMs = 100;

enum class Mode { Sequence, EditLed, EditMotor, EspNow };
enum class LedPattern { Breathe, Steady, Blink, Off };

// Override the LED for one second after a successful save; -1 restores normal output.
class SaveIndicator {
 public:
  void cancel() { active_ = false; }
  void begin(uint32_t now) { startedAt_ = now; active_ = true; }
  int level(uint32_t now) {
    if (!active_) return -1;
    const uint32_t elapsed = now - startedAt_;
    if (elapsed >= 1000) {
      active_ = false;
      return -1;
    }
    return (elapsed * 6 / 1000) % 2 == 0 ? 1 : 0;
  }
 private:
  uint32_t startedAt_ = 0;
  bool active_ = false;
};
// Two quick flashes after an accepted mode change. Start with OFF so the
// flashes remain distinguishable when the previous mode had the LED ON.
// OFF 100 / ON 80 / OFF 100 / ON 80 / OFF 140 ms; -1 resumes normal output.
class ModeIndicator {
 public:
  void begin(uint32_t now) { startedAt_ = now; active_ = true; }
  void cancel() { active_ = false; }
  int level(uint32_t now) {
    if (!active_) return -1;
    const uint32_t elapsed = now - startedAt_;
    if (elapsed >= 500) {
      active_ = false;
      return -1;
    }
    return (elapsed >= 100 && elapsed < 180) ||
           (elapsed >= 280 && elapsed < 360) ? 1 : 0;
  }
 private:
  uint32_t startedAt_ = 0;
  bool active_ = false;
};
enum class ButtonEvent { None, Click, LongPress };

inline bool isEditing(Mode mode) {
  return mode == Mode::EditLed || mode == Mode::EditMotor;
}

struct Settings {
  uint32_t ledOnUs = 5000;
  uint32_t motorPercent = uint32_t(kMotorStartPercent);

  void validate() {
    if (ledOnUs == 56000) ledOnUs = kBlinkPeriodUs; // Preserve legacy continuous-on setting.
    if (ledOnUs > kBlinkPeriodUs ||
        (ledOnUs != kBlinkPeriodUs && ledOnUs % kOnStepUs != 0)) ledOnUs = 5000;
    if (motorPercent > 100) motorPercent = uint32_t(kMotorStartPercent);
  }

  void adjust(Mode mode, int clicks) {
    if (!isEditing(mode)) return;
    // The continuous-on endpoint is between the regular 0.5 ms steps.
    const uint32_t ledBase = ledOnUs == kBlinkPeriodUs && clicks < 0
        ? ((kBlinkPeriodUs + kOnStepUs - 1) / kOnStepUs) * kOnStepUs : ledOnUs;
    int64_t value = mode == Mode::EditLed
                        ? int64_t(ledBase) + int64_t(clicks) * kOnStepUs
                        : int64_t(motorPercent) + clicks;
    const int64_t maximum = mode == Mode::EditLed ? kBlinkPeriodUs : 100;
    if (value < 0) value = 0;
    if (value > maximum) value = maximum;
    if (mode == Mode::EditLed) ledOnUs = uint32_t(value);
    else motorPercent = uint32_t(value);
  }
};

struct Output {
  LedPattern led;
  float brightness;
  float motorPercent;
  unsigned phase;
};

inline Output breatheOutput(uint32_t elapsedMs) {
  // A sine wave shifted by -pi/2: starts and ends at zero brightness.
  const float phase = 6.28318530718f * float(elapsedMs % 5000) / 5000.0f;
  return {LedPattern::Breathe, 0.5f - 0.5f * std::cos(phase), 0, 1};
}

inline Output startingOutput(uint32_t elapsedMs, const Settings& settings, unsigned phase) {
  const float target = float(settings.motorPercent);
  const float from = target < kMotorStartPercent ? target : kMotorStartPercent;
  return {LedPattern::Steady, 0.70f,
          from + (target - from) * float(elapsedMs) / kMotorRampMs, phase};
}

// Hold outputs already at/below the cutoff; never accelerate to reach 45%.
inline float stoppingPercent(float from, uint32_t elapsedMs) {
  if (elapsedMs >= kMotorRampMs) return 0;
  const float cutoff = from < kEditStopPercent ? from : kEditStopPercent;
  return from + (cutoff - from) * float(elapsedMs) / kMotorRampMs;
}

class MotorStop {
 public:
  void begin(uint32_t now, float from) {
    startedAt_ = now;
    from_ = from;
    active_ = from > 0;
  }
  bool active() const { return active_; }
  bool due(uint32_t now) const { return active_ && uint32_t(now - startedAt_) >= kMotorRampMs; }
  float output(uint32_t now) const { return active_ ? stoppingPercent(from_, now - startedAt_) : 0; }
  void finish() { active_ = false; }
 private:
  bool active_ = false;
  uint32_t startedAt_ = 0;
  float from_ = 0;
};

inline Output outputFor(Mode mode, uint32_t elapsedMs, const Settings& settings) {
  if (mode == Mode::EspNow) return {LedPattern::Off, 0, 0, 0};
  if (mode == Mode::EditLed) return {LedPattern::Blink, 0, 0, 0};
  if (mode == Mode::EditMotor) {
    if (elapsedMs < kMotorRampMs) return startingOutput(elapsedMs, settings, 0);
    return {LedPattern::Blink, 0, float(settings.motorPercent), 0};
  }
  const uint32_t t = elapsedMs % kCycleMs;
  if (t < 20000) {
    return breatheOutput(t);
  }
  if (t < 20000 + kMotorRampMs) {
    return startingOutput(t - 20000, settings, 2);
  }
  if (t < kCycleMs - kMotorRampMs) return {LedPattern::Blink, 0, float(settings.motorPercent), 3};
  return {LedPattern::Blink, 0, stoppingPercent(float(settings.motorPercent), t - (kCycleMs - kMotorRampMs)), 4};
}

constexpr uint32_t kRemoteRunMs = 60000;
constexpr uint32_t kRemoteRampMs = kMotorRampMs;

// A single request slot, not a queue. Guard all accesses when shared with Wi-Fi.
class RemoteRun {
 public:
  enum class State { Disabled, EditStopping, Ready, Pending, Running };

  State state() const { return state_; }
  bool busy() const {
    return state_ == State::EditStopping || state_ == State::Pending || state_ == State::Running;
  }
  void enable(uint32_t now) { readyAt_ = now; state_ = State::Ready; }
  void disable() { state_ = State::Disabled; }

  void stopEditing(uint32_t now, float currentPercent) {
    startedAt_ = now;
    editStopFrom_ = currentPercent;
    state_ = State::EditStopping;
  }

  bool editStopDue(uint32_t now) const {
    return state_ == State::EditStopping &&
           (editStopFrom_ <= 0 || uint32_t(now - startedAt_) >= kEditStopMs);
  }

  // Enable reception only after zero PWM has been applied.
  void confirmEditStopped(uint32_t now) {
    if (editStopDue(now)) enable(now);
  }

  bool receive(const uint8_t* data, int length) {
    // Do not inspect the message body while busy or outside ESP-NOW mode.
    if (state_ != State::Ready) return false;
    if (!data || (length != 5 && length != 6)) return false;
    if (std::memcmp(data, "START", 5) != 0 || (length == 6 && data[5] != 0)) return false;
    state_ = State::Pending;
    return true;
  }

  void tick(uint32_t now) {
    if (state_ == State::Pending) {
      startedAt_ = now;
      state_ = State::Running;
    } else if (state_ == State::Ready) {
      // Keep the fade continuous even across repeated millis() rollovers.
      readyAt_ += (uint32_t(now - readyAt_) / 5000) * 5000;
    }
  }

  bool stopDue(uint32_t now) const {
    return state_ == State::Running && uint32_t(now - startedAt_) >= kRemoteRunMs;
  }

  // Call only after the main loop has applied zero PWM to the motor.
  void confirmStopped(uint32_t now) {
    if (!stopDue(now)) return;
    enable(now);
  }

  Output output(uint32_t now, const Settings& settings) const {
    if (state_ == State::EditStopping) {
      const float percent = editStopDue(now) ? 0.0f
          : stoppingPercent(editStopFrom_, uint32_t(now - startedAt_));
      return editStopDue(now) ? breatheOutput(0) : Output{LedPattern::Blink, 0, percent, 4};
    }
    if (state_ == State::Ready) return breatheOutput(uint32_t(now - readyAt_));
    if (stopDue(now)) return breatheOutput(0);
    if (state_ != State::Running) return {LedPattern::Off, 0, 0, 0};
    const uint32_t t = now - startedAt_;
    if (t < kRemoteRampMs) {
      return startingOutput(t, settings, 2);
    }
    if (t < kRemoteRunMs - kRemoteRampMs) {
      return {LedPattern::Blink, 0, float(settings.motorPercent), 3};
    }
    return {LedPattern::Blink, 0, stoppingPercent(float(settings.motorPercent), t - (kRemoteRunMs - kRemoteRampMs)), 4};
  }

 private:
  State state_ = State::Disabled;
  uint32_t readyAt_ = 0;
  uint32_t startedAt_ = 0;
  float editStopFrom_ = 0;
};

// Unsigned subtraction also handles the millis() wrap at about 49.7 days.
class Button {
 public:
  bool samplingInterrupted() const { return interrupted_; }
  uint32_t lastPressMs() const { return lastPressMs_; }

  ButtonEvent update(bool down, uint32_t now) {
    interrupted_ = sampled_ && uint32_t(now - sampledAt_) > kButtonMaxSampleGapMs
        && (down || raw_ || stable_);
    sampled_ = true;
    sampledAt_ = now;
    if (interrupted_) {
      // The contact may have been released/repressed while loop() was blocked.
      // Never turn unobserved time into a SAVE or a delayed mode change.
      awaitingRelease_ = true;
      raw_ = stable_ = down;
      rawChangedAt_ = now;
      longHandled_ = true;
    }
    if (down != raw_) {
      raw_ = down;
      rawChangedAt_ = now;
    }
    if (awaitingRelease_) {
      if (!raw_ && uint32_t(now - rawChangedAt_) >= kDebounceMs) {
        awaitingRelease_ = false;
        stable_ = false;
      }
      return ButtonEvent::None;
    }
    if (raw_ != stable_ && uint32_t(now - rawChangedAt_) >= kDebounceMs) {
      stable_ = raw_;
      if (stable_) {
        pressedAt_ = rawChangedAt_;
        longHandled_ = false;
      } else if (!longHandled_) {
        longHandled_ = true;
        lastPressMs_ = rawChangedAt_ - pressedAt_;
        return lastPressMs_ >= kLongPressMs
                   ? ButtonEvent::LongPress : ButtonEvent::Click;
      }
    }
    if (stable_ && raw_ && !longHandled_ && uint32_t(now - pressedAt_) >= kLongPressMs) {
      longHandled_ = true;
      lastPressMs_ = now - pressedAt_;
      return ButtonEvent::LongPress;
    }
    return ButtonEvent::None;
  }

 private:
  bool sampled_ = false;
  bool interrupted_ = false;
  bool awaitingRelease_ = false;
  uint32_t sampledAt_ = 0;
  uint32_t lastPressMs_ = 0;
  bool raw_ = false;
  bool stable_ = false;
  bool longHandled_ = false;
  uint32_t rawChangedAt_ = 0;
  uint32_t pressedAt_ = 0;
};

}  // namespace senme
