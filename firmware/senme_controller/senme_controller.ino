// ESP32 Dev Module (original ESP32 / WROOM), Arduino-ESP32 3.x.
// Active-high, low-side N-channel MOSFET drivers. See ../README.md.
#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <driver/rmt_tx.h>
#include <esp_arduino_version.h>
#include <soc/soc_caps.h>
#include "Control.h"
#include "LedWaveform.h"

#if ESP_ARDUINO_VERSION_MAJOR < 3
#error "Use Arduino-ESP32 3.x."
#endif
#if !CONFIG_IDF_TARGET_ESP32
#error "This pin assignment and firmware target the original ESP32 (WROOM/DevKit)."
#endif

constexpr uint8_t LED_PIN = 25;
constexpr uint8_t MOTOR_PIN = 26;
constexpr uint8_t ENCODER_CLK_PIN = 32;
constexpr uint8_t ENCODER_DT_PIN = 33;
constexpr uint8_t BUTTON_PIN = 27;
// This controller appears to release LOW and press HIGH; verify with button logs.
// Use LOW for a conventional normally-open switch connected to GND.
constexpr uint8_t BUTTON_PRESSED_LEVEL = HIGH;
constexpr int ENCODER_DIRECTION = 1;  // Change to -1 if clockwise decreases.
constexpr int ENCODER_EDGES_PER_CLICK = 4;  // Some encoders need 2.
constexpr uint32_t MOTOR_PWM_HZ = 20000;
constexpr uint8_t MOTOR_PWM_BITS = 10;
constexpr uint32_t MOTOR_PWM_MAX = (1u << MOTOR_PWM_BITS) - 1;
constexpr uint32_t LED_BREATHE_PERIOD_US = 1000;  // 1 kHz dimming PWM.
constexpr uint8_t ESPNOW_CHANNEL = 1;  // Sender must use the same channel.

senme::Settings settings;
senme::Mode mode = senme::Mode::EspNow;
senme::Button button;
senme::SaveIndicator saveIndicator;
senme::ModeIndicator modeIndicator;
Preferences preferences;
bool storageReady = false;
bool motorReady = false;
uint32_t sequenceStartedAt = 0;
uint32_t editMotorStartedAt = 0;
float appliedMotorPercent = 0;
senme::MotorStop modeChangeStop;
unsigned lastPhase = 0;
portMUX_TYPE remoteMux = portMUX_INITIALIZER_UNLOCKED;
senme::RemoteRun remoteRun;

rmt_channel_handle_t ledChannel = nullptr;
rmt_encoder_handle_t ledEncoder = nullptr;
rmt_symbol_word_t ledSymbols[2]{};
bool ledEnabled = false;
uint32_t ledPeriodUs = 0;
uint32_t ledOnUs = 0;
bool ledDimBlink = false;

portMUX_TYPE encoderMux = portMUX_INITIALIZER_UNLOCKED;
volatile uint8_t encoderPrevious = 0;
volatile int encoderEdges = 0;
volatile int encoderClicks = 0;

void ARDUINO_ISR_ATTR encoderChanged() {
  portENTER_CRITICAL_ISR(&encoderMux);
  const uint8_t current = (digitalRead(ENCODER_CLK_PIN) << 1) | digitalRead(ENCODER_DT_PIN);
  const uint8_t previous = encoderPrevious;
  encoderPrevious = current;
  if ((previous ^ current) == 3) {
    encoderEdges = 0;  // Both contacts changed: discard an ambiguous transition.
  } else if (previous != current) {
    // Adjacent contact bounce reverses the previous edge and cancels itself.
    encoderEdges = encoderEdges + (((previous & 1) ^ (current >> 1)) ? 1 : -1);
    if (encoderEdges >= ENCODER_EDGES_PER_CLICK) {
      if (encoderClicks < 10000) encoderClicks = encoderClicks + 1;
      encoderEdges = 0;
    } else if (encoderEdges <= -ENCODER_EDGES_PER_CLICK) {
      if (encoderClicks > -10000) encoderClicks = encoderClicks - 1;
      encoderEdges = 0;
    }
  }
  portEXIT_CRITICAL_ISR(&encoderMux);
}

void fail(const char* message) {
  // Latch the fault: no START or mode transition can resume operation.
  portENTER_CRITICAL(&remoteMux);
  remoteRun.disable();
  portEXIT_CRITICAL(&remoteMux);
  Serial.printf("ERROR: %s; attempting controlled motor stop.\n", message);

  // Use only direct API calls here; check()/fail() must never recurse.
  // Start from the last successfully applied output, not the failed request.
  senme::MotorStop faultStop;
  faultStop.begin(millis(), appliedMotorPercent);
  bool rampWriteFailed = false;
  if (motorReady) {
    while (faultStop.active() && !faultStop.due(millis())) {
      const uint32_t duty = lroundf(faultStop.output(millis()) * MOTOR_PWM_MAX / 100.0f);
      if (ledcWrite(MOTOR_PIN, duty)) {
        appliedMotorPercent = duty * 100.0f / MOTOR_PWM_MAX;
      } else {
        rampWriteFailed = true;
      }
      delay(10);
    }
  }
  bool zeroAccepted = motorReady ? ledcWrite(MOTOR_PIN, 0) : true;
  if (!motorReady) digitalWrite(MOTOR_PIN, LOW);
  if (zeroAccepted) appliedMotorPercent = 0;
  if (ledChannel && ledEnabled) rmt_disable(ledChannel);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  if (rampWriteFailed) Serial.println("ERROR: motor ramp write failed; smooth deceleration not confirmed.");
  Serial.println(zeroAccepted ? "FAULT LATCHED: motor zero command accepted; reset required."
                              : "FAULT LATCHED: motor zero command failed; retrying; reset required.");
  while (true) {
    delay(1000);
    // If the API recovers, keep requesting OFF; never restart the ramp or run.
    if (!zeroAccepted && ledcWrite(MOTOR_PIN, 0)) {
      zeroAccepted = true;
      appliedMotorPercent = 0;
      Serial.println("FAULT LATCHED: motor zero command accepted; reset required.");
    }
  }
}

void check(esp_err_t result, const char* operation) {
  if (result != ESP_OK) fail(operation);
}

void receiveEspNow(const esp_now_recv_info_t*, const uint8_t* data, int length) {
  portENTER_CRITICAL(&remoteMux);
  remoteRun.receive(data, length);
  portEXIT_CRITICAL(&remoteMux);
}

void beginEspNow() {
  if (!WiFi.mode(WIFI_STA)) fail("Wi-Fi station initialization");
  check(esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE), "ESP-NOW channel");
  check(esp_now_init(), "ESP-NOW initialization");
  check(esp_now_register_recv_cb(receiveEspNow), "ESP-NOW receive callback");
  Serial.printf("ESP-NOW: MAC=%s channel=%u command=START\n",
                WiFi.macAddress().c_str(), ESPNOW_CHANNEL);
}

void writeLed(uint32_t periodUs, uint32_t onUs, bool dimBlink = false) {
  if (periodUs == ledPeriodUs && onUs == ledOnUs && dimBlink == ledDimBlink) return;
  if (ledEnabled) {
    check(rmt_disable(ledChannel), "LED stop previous waveform");
    ledEnabled = false;
  }
  rmt_carrier_config_t carrier = {};
  carrier.frequency_hz = senme::kBlinkCarrierHz;
  carrier.duty_cycle = senme::kBlinkLedDuty;
  check(rmt_apply_carrier(ledChannel, dimBlink && senme::kBlinkLedDuty < 1.0f ? &carrier : nullptr), "LED carrier");
  check(rmt_encoder_reset(ledEncoder), "LED encoder reset");
  const auto envelope = senme::ledEnvelope(periodUs, onUs);
  for (unsigned i = 0; i < envelope.count / 2; ++i) {
    ledSymbols[i].duration0 = envelope.pulses[2 * i].duration;
    ledSymbols[i].level0 = envelope.pulses[2 * i].high;
    ledSymbols[i].duration1 = envelope.pulses[2 * i + 1].duration;
    ledSymbols[i].level1 = envelope.pulses[2 * i + 1].high;
  }
  check(rmt_enable(ledChannel), "LED enable");
  ledEnabled = true;
  rmt_transmit_config_t transmit = {};
  transmit.loop_count = -1;
  transmit.flags.queue_nonblocking = true;
  check(rmt_transmit(ledChannel, ledEncoder, ledSymbols,
                    envelope.count / 2 * sizeof(ledSymbols[0]), &transmit), "LED waveform");
  ledPeriodUs = periodUs;
  ledOnUs = onUs;
  ledDimBlink = dimBlink;
}

void forceLed(int level) {
  writeLed(LED_BREATHE_PERIOD_US, level > 0 ? LED_BREATHE_PERIOD_US : 0);
}

void beginLed() {
  rmt_tx_channel_config_t channel = {};
  channel.gpio_num = gpio_num_t(LED_PIN);
  channel.clk_src = RMT_CLK_SRC_DEFAULT;
  channel.resolution_hz = 1000000;
  channel.mem_block_symbols = 64;
  channel.trans_queue_depth = 1;
  check(rmt_new_tx_channel(&channel, &ledChannel), "LED RMT channel");
  rmt_copy_encoder_config_t encoder = {};
  check(rmt_new_copy_encoder(&encoder, &ledEncoder), "LED RMT encoder");
  forceLed(0);
}

void reportSettings() {
  Serial.printf("LED: %.2f ms ON / %.2f ms period; motor maximum: %lu%%\n",
                settings.ledOnUs / 1000.0, senme::kBlinkPeriodUs / 1000.0, static_cast<unsigned long>(settings.motorPercent));
}

void enterNextMode(uint32_t now) {
  if (modeChangeStop.active()) {
    Serial.println("Mode change ignored while motor is stopping");
    return;
  }
  portENTER_CRITICAL(&remoteMux);
  const bool busy = remoteRun.busy();
  if (!busy) remoteRun.disable();
  portEXIT_CRITICAL(&remoteMux);
  if (busy) {
    Serial.println("ESP-NOW: mode change ignored during run/stop");
    return;
  }
  portENTER_CRITICAL(&encoderMux);
  encoderClicks = 0;
  encoderEdges = 0;
  portEXIT_CRITICAL(&encoderMux);
  switch (mode) {
    case senme::Mode::Sequence:
      modeChangeStop.begin(now, appliedMotorPercent);
      mode = senme::Mode::EditLed;
      Serial.println("Mode: EDIT 1 (LED on-time); motor stopping over 15 seconds");
      break;
    case senme::Mode::EditLed:
      mode = senme::Mode::EditMotor;
      editMotorStartedAt = now;
      Serial.println("Mode: EDIT 2 (motor maximum); ramp up over 15 seconds");
      break;
    case senme::Mode::EditMotor:
      mode = senme::Mode::EspNow;
      portENTER_CRITICAL(&remoteMux);
      remoteRun.stopEditing(now, appliedMotorPercent);
      portEXIT_CRITICAL(&remoteMux);
      Serial.println("Mode: ESP-NOW; stopping edit motor over 15 seconds to 45%, then OFF");
      break;
    case senme::Mode::EspNow:
      mode = senme::Mode::Sequence;
      sequenceStartedAt = now;
      lastPhase = 0;
      Serial.println("Mode: SEQUENCE (restart from phase 1)");
      break;
  }
  // Rejected clicks return above; only accepted transitions get feedback.
  saveIndicator.cancel();
  modeIndicator.begin(now);
  reportSettings();
}

void saveCurrentSetting() {
  if (!senme::isEditing(mode)) return;
  if (!storageReady) {
    Serial.println("SAVE FAILED: NVS unavailable; current setting remains in RAM only.");
    return;
  }
  const char* key = mode == senme::Mode::EditLed ? "ledOnUs" : "motorPct";
  const uint32_t value = mode == senme::Mode::EditLed ? settings.ledOnUs : settings.motorPercent;
  if (preferences.putUInt(key, value) != sizeof(uint32_t)) {
    Serial.println("SAVE FAILED: setting remains in RAM only.");
    return;
  }
  Serial.printf("SAVED: %s = %lu\n", key, static_cast<unsigned long>(value));
  modeIndicator.cancel();
  saveIndicator.begin(millis());
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  pinMode(MOTOR_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  digitalWrite(MOTOR_PIN, LOW);
  Serial.begin(115200);
  pinMode(ENCODER_CLK_PIN, INPUT_PULLUP);
  pinMode(ENCODER_DT_PIN, INPUT_PULLUP);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  Serial.printf("BUTTON: GPIO27=%d; pressed level=%d (HIGH=1, LOW=0)\n",
                digitalRead(BUTTON_PIN), BUTTON_PRESSED_LEVEL);

  storageReady = preferences.begin("senme", false);
  if (storageReady) {
    settings.ledOnUs = preferences.getUInt("ledOnUs", settings.ledOnUs);
    settings.motorPercent = preferences.getUInt("motorPct", settings.motorPercent);
    settings.validate();
  } else {
    Serial.println("NVS unavailable: using defaults; saving disabled.");
  }
  motorReady = ledcAttach(MOTOR_PIN, MOTOR_PWM_HZ, MOTOR_PWM_BITS);
  if (!motorReady) fail("Motor PWM initialization");
  if (!ledcWrite(MOTOR_PIN, 0)) fail("Motor initial off");
  beginLed();
  beginEspNow();
  encoderPrevious = (digitalRead(ENCODER_CLK_PIN) << 1) | digitalRead(ENCODER_DT_PIN);
  attachInterrupt(digitalPinToInterrupt(ENCODER_CLK_PIN), encoderChanged, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENCODER_DT_PIN), encoderChanged, CHANGE);
  sequenceStartedAt = millis();
  Serial.println("Mode: ESP-NOW; click: next mode; hold 3 seconds in edit mode: save");
  reportSettings();
  // Hardware is initialized and the motor is off before accepting START.
  portENTER_CRITICAL(&remoteMux);
  remoteRun.enable(millis());
  portEXIT_CRITICAL(&remoteMux);
  Serial.println("ESP-NOW: READY (waiting for START)");
}

void loop() {
  const uint32_t now = millis();
  // Rebase each cycle so millis() rollover cannot disturb the 80-second cycle.
  while (uint32_t(now - sequenceStartedAt) >= senme::kCycleMs) {
    sequenceStartedAt += senme::kCycleMs;
  }
  const auto event = button.update(digitalRead(BUTTON_PIN) == BUTTON_PRESSED_LEVEL, now);
  if (button.samplingInterrupted()) {
    Serial.println("BUTTON: sampling gap >100ms; gesture discarded; release and press again");
  }
  if (event != senme::ButtonEvent::None) {
    Serial.printf("BUTTON: %s (%lu ms)\n",
                  event == senme::ButtonEvent::Click ? "CLICK" : "LONG PRESS",
                  static_cast<unsigned long>(button.lastPressMs()));
  }
  if (event == senme::ButtonEvent::Click) enterNextMode(now);

  portENTER_CRITICAL(&encoderMux);
  const int clicks = encoderClicks * ENCODER_DIRECTION;
  encoderClicks = 0;
  portEXIT_CRITICAL(&encoderMux);
  if (clicks != 0 && senme::isEditing(mode)) {
    settings.adjust(mode, clicks);
    reportSettings();
  }

  portENTER_CRITICAL(&remoteMux);
  const auto oldRemoteState = remoteRun.state();
  remoteRun.tick(now);
  const auto remoteSnapshot = remoteRun;
  portEXIT_CRITICAL(&remoteMux);
  if (oldRemoteState == senme::RemoteRun::State::Pending) {
    saveIndicator.cancel();
    modeIndicator.cancel();
    Serial.println("ESP-NOW: START accepted; 6 flashes (1 second), motor OFF");
  }
  if (oldRemoteState == senme::RemoteRun::State::Notifying &&
      remoteSnapshot.state() == senme::RemoteRun::State::Running) {
    Serial.println("ESP-NOW: RUNNING (60 seconds)");
  }
  if (oldRemoteState == senme::RemoteRun::State::Cooldown &&
      remoteSnapshot.state() == senme::RemoteRun::State::Ready) {
    Serial.println("ESP-NOW: READY (waiting for START)");
  }

  auto output = mode == senme::Mode::EspNow
                          ? remoteSnapshot.output(now, settings)
                          : senme::outputFor(mode, mode == senme::Mode::EditMotor
                              ? now - editMotorStartedAt : now - sequenceStartedAt, settings);
  if (modeChangeStop.active()) output.motorPercent = modeChangeStop.output(now);
  const uint32_t motorDuty = lroundf(output.motorPercent * MOTOR_PWM_MAX / 100.0f);
  static uint32_t previousMotorDuty = 0;
  if (motorDuty != previousMotorDuty) {
    if (!ledcWrite(MOTOR_PIN, motorDuty)) fail("Motor duty update");
    previousMotorDuty = motorDuty;
  }
  if (modeChangeStop.due(now)) modeChangeStop.finish();
  appliedMotorPercent = motorDuty * 100.0f / MOTOR_PWM_MAX;
  // Saturate the edit ramp clock to avoid restarting it at millis() rollover.
  if (mode == senme::Mode::EditMotor && uint32_t(now - editMotorStartedAt) >= senme::kMotorRampMs) {
    editMotorStartedAt = now - senme::kMotorRampMs;
  }
  const int saveLevel = saveIndicator.level(now);
  const int modeLevel = modeIndicator.level(now);
  if (saveLevel >= 0) {
    // Indicator pulses retain full brightness; motor control continues.
    forceLed(saveLevel);
  } else if (modeLevel >= 0) {
    forceLed(modeLevel);
  } else if (output.led == senme::LedPattern::Off) {
    writeLed(senme::kBlinkPeriodUs, 0);
  } else if (output.led == senme::LedPattern::Breathe ||
             output.led == senme::LedPattern::Steady) {
    writeLed(LED_BREATHE_PERIOD_US, lroundf(output.brightness * LED_BREATHE_PERIOD_US));
  } else {
    writeLed(senme::kBlinkPeriodUs, settings.ledOnUs, true);
  }
  if (mode == senme::Mode::EspNow && remoteSnapshot.editStopDue(now)) {
    portENTER_CRITICAL(&remoteMux);
    remoteRun.confirmEditStopped(millis());
    portEXIT_CRITICAL(&remoteMux);
    Serial.println("ESP-NOW: READY (waiting for START)");
  }
  if (mode == senme::Mode::EspNow && remoteSnapshot.stopDue(now)) {
    portENTER_CRITICAL(&remoteMux);
    remoteRun.confirmStopped(millis());
    portEXIT_CRITICAL(&remoteMux);
    Serial.println("ESP-NOW: STOPPED; COOLDOWN (3 seconds; START ignored)");
  }
  if (mode == senme::Mode::Sequence && output.phase != lastPhase) {
    lastPhase = output.phase;
    Serial.printf("Sequence phase: %u\n", output.phase);
  }
  // Saving never happens in an ISR. Hardware PWM keeps running during NVS writes.
  if (event == senme::ButtonEvent::LongPress) saveCurrentSetting();
  delay(1);
}
