// ESP32-WROOM / Arduino-ESP32 3.3.8. MPU6050 acceleration -> ESP-NOW START.
#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include "ShakeDetector.h"

constexpr int SDA_PIN = 21;
constexpr int SCL_PIN = 22;
constexpr uint8_t MPU_ADDRESS = 0x68;  // AD0=GND; use 0x69 for AD0=3.3V.
constexpr uint8_t ESPNOW_CHANNEL = 1;
// Broadcast by default. Replace with the receiver STA MAC for a single receiver.
const uint8_t RECEIVER_MAC[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
constexpr uint32_t SAMPLE_MS = 10;

sense::ShakeDetector detector;
uint32_t sampledAt = 0;
uint32_t reportedAt = 0;
bool sensorError = false;
portMUX_TYPE sendMux = portMUX_INITIALIZER_UNLOCKED;
int sendResult = -1;

void fail(const char* message) {
  Serial.printf("ERROR: %s; sending disabled. Check wiring/configuration and reset.\n", message);
  while (true) delay(1000);
}

void check(esp_err_t result, const char* message) {
  if (result != ESP_OK) fail(message);
}

bool writeRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDRESS);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool readRegisters(uint8_t reg, uint8_t* data, size_t length) {
  Wire.beginTransmission(MPU_ADDRESS);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(MPU_ADDRESS, length, true) != length) {
    while (Wire.available()) Wire.read();
    return false;
  }
  for (size_t i = 0; i < length; ++i) data[i] = Wire.read();
  return true;
}

void beginMpu() {
  if (!Wire.begin(SDA_PIN, SCL_PIN, 100000)) fail("I2C initialization");
  Wire.setTimeOut(20);
  uint8_t identity = 0;
  if (!readRegisters(0x75, &identity, 1) || identity != 0x68) fail("MPU6050 WHO_AM_I (expected 0x68)");
  if (!writeRegister(0x6B, 0x80)) fail("MPU6050 reset");
  delay(100);
  // Wake with X-gyro PLL; all axes enabled; DLPF 44 Hz; 100 Hz sampling; +/-8 g.
  if (!writeRegister(0x6B, 0x01) || !writeRegister(0x6C, 0x00) ||
      !writeRegister(0x1A, 0x03) || !writeRegister(0x19, 9) ||
      !writeRegister(0x1C, 0x10)) fail("MPU6050 configuration");
  delay(100);
}

float accelerationG(const uint8_t* bytes) {
  const uint16_t raw = (uint16_t(bytes[0]) << 8) | bytes[1];
  const int32_t signedRaw = raw < 0x8000 ? int32_t(raw) : int32_t(raw) - 65536;
  return signedRaw / 4096.0f;
}

void sentEspNow(const esp_now_send_info_t*, esp_now_send_status_t status) {
  portENTER_CRITICAL(&sendMux);
  sendResult = status == ESP_NOW_SEND_SUCCESS ? 1 : 0;
  portEXIT_CRITICAL(&sendMux);
}

void setup() {
  Serial.begin(115200);
  beginMpu();
  if (!WiFi.mode(WIFI_STA)) fail("Wi-Fi station initialization");
  check(esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE), "Wi-Fi channel");
  check(esp_now_init(), "ESP-NOW initialization");
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, RECEIVER_MAC, sizeof(RECEIVER_MAC));
  peer.channel = ESPNOW_CHANNEL;
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  check(esp_now_add_peer(&peer), "ESP-NOW peer registration");
  check(esp_now_register_send_cb(sentEspNow), "ESP-NOW send callback");
  Serial.printf("sense_sender: MAC=%s channel=%u target=%02X:%02X:%02X:%02X:%02X:%02X\n",
                WiFi.macAddress().c_str(), ESPNOW_CHANNEL,
                RECEIVER_MAC[0], RECEIVER_MAC[1], RECEIVER_MAC[2],
                RECEIVER_MAC[3], RECEIVER_MAC[4], RECEIVER_MAC[5]);
  Serial.printf("MPU6050: SDA=%d SCL=%d address=0x%02X; threshold=%.2f g\n",
                SDA_PIN, SCL_PIN, MPU_ADDRESS, sense::kTriggerG);
  Serial.println("Keep still for 3 seconds to arm; shake strongly to send START.");
}

void loop() {
  portENTER_CRITICAL(&sendMux);
  const int result = sendResult;
  sendResult = -1;
  portEXIT_CRITICAL(&sendMux);
  if (result >= 0) Serial.printf("ESP-NOW: link %s (not execution acknowledgement)\n", result ? "OK" : "FAILED");

  const uint32_t now = millis();
  if (uint32_t(now - sampledAt) < SAMPLE_MS) {
    delay(1);
    return;
  }
  sampledAt = now;
  uint8_t data[6];
  if (!readRegisters(0x3B, data, sizeof(data))) {
    detector.invalidate();
    if (!sensorError) Serial.println("MPU6050: read failed; sending disabled until valid readings and quiet period");
    sensorError = true;
    return;
  }
  if (sensorError) Serial.println("MPU6050: readings recovered; keep still to rearm");
  sensorError = false;
  const bool wasArmed = detector.armed();
  if (detector.update(accelerationG(data), accelerationG(data + 2), accelerationG(data + 4), now)) {
    const uint8_t command[] = {'S', 'T', 'A', 'R', 'T'};
    const esp_err_t err = esp_now_send(RECEIVER_MAC, command, sizeof(command));
    Serial.printf("SHAKE: %.2f g; START %s (%s)\n", detector.strengthG(),
                  err == ESP_OK ? "queued" : "failed", esp_err_to_name(err));
    // No retries: a late retry could start an unintended second receiver cycle.
  } else if (!wasArmed && detector.armed()) {
    Serial.println("ARMED: waiting for shake");
  }
  if (uint32_t(now - reportedAt) >= 500) {
    reportedAt = now;
    Serial.printf("motion=%.2f g; %s\n", detector.strengthG(), detector.armed() ? "ARMED" : "WAIT QUIET");
  }
}
