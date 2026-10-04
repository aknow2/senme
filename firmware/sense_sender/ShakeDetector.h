#pragma once

#include <cmath>
#include <cstdint>

namespace sense {

constexpr float kTriggerG = 3.0f;  // Deviation of acceleration magnitude from 1 g.
constexpr float kQuietG = 1.0f;
constexpr uint32_t kQuietMs = 3000;
constexpr uint32_t kMinSendIntervalMs = 3000;
constexpr unsigned kTriggerSamples = 2;

class ShakeDetector {
 public:
  bool armed() const { return armed_; }
  float strengthG() const { return strengthG_; }

  void invalidate() {
    armed_ = false;
    quiet_ = false;
    overCount_ = 0;
    haveSample_ = false;
  }

  bool update(float xG, float yG, float zG, uint32_t now) {
    if (!std::isfinite(xG) || !std::isfinite(yG) || !std::isfinite(zG)) {
      invalidate();
      return false;
    }
    if (haveSample_ && uint32_t(now - lastSampleAt_) > 50) invalidate();
    haveSample_ = true;
    lastSampleAt_ = now;
    strengthG_ = std::fabs(std::sqrt(xG * xG + yG * yG + zG * zG) - 1.0f);
    if (strengthG_ <= kQuietG) {
      overCount_ = 0;
      if (!quiet_) {
        quiet_ = true;
        quietAt_ = now;
      }
      if (uint32_t(now - quietAt_) >= kQuietMs &&
          (!sent_ || uint32_t(now - sentAt_) >= kMinSendIntervalMs)) armed_ = true;
    } else {
      quiet_ = false;
      if (armed_ && strengthG_ > kTriggerG) {
        if (++overCount_ >= kTriggerSamples) {
          armed_ = false;
          overCount_ = 0;
          sent_ = true;
          sentAt_ = now;
          return true;
        }
      } else {
        overCount_ = 0;
      }
    }
    return false;
  }

 private:
  bool armed_ = false;
  bool quiet_ = false;
  bool sent_ = false;
  bool haveSample_ = false;
  unsigned overCount_ = 0;
  float strengthG_ = 0;
  uint32_t quietAt_ = 0;
  uint32_t sentAt_ = 0;
  uint32_t lastSampleAt_ = 0;
};

}  // namespace sense
