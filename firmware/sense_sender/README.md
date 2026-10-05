# sense_sender：揺れでSTARTを送信

ESP32-WROOM系の開発ボードとMPU6050を使い、大きな揺れを検知したら
ESP-NOWでASCIIの `START`（5バイト、改行なし）を1回送信します。
Arduino-ESP32 **3.3.8** 用です。Wire・Wi-Fi・ESP-NOWはコア付属で、追加ライブラリは不要です。
モーターを制御する `senme_controller` とは別のESP32へ書き込んでください。

## 配線

3.3V電源・3.3V I2C信号に対応したMPU6050モジュールを使用します。
モジュールの電源仕様・端子表記を確認してください。

| 送信側ESP32 | MPU6050モジュール |
| --- | --- |
| 3V3 | VCC（3.3V対応電源入力） |
| GND | GND |
| GPIO21 / D21 | SDA |
| GPIO22 / D22 | SCL |
| GND | AD0（アドレス0x68） |

INT・XDA・XCLは接続不要です。SDA/SCLは3.3Vへのプルアップが必要です。
モジュールに実装済みなら追加不要、なければ各線に4.7kΩ程度を追加します。
AD0を3.3Vに接続する場合はコードの `MPU_ADDRESS` を `0x69` にします。

## 検知の動作

1. 起動後、静かな状態が3秒続くと `ARMED`（検知可能）になります。
2. 約10msごとに加速度を読み、`abs(sqrt(x² + y² + z²) - 1)` をg単位で計算します。
3. その値が **1.3gを超える読み取りが2回連続**すると、`START` を1回送ります。1.3gちょうどでは送信しません。
4. 揺れが収まり、1.0g以下が3秒続き、かつ前回の送信から3秒以上経過すると再び検知可能になります。両方の待ち時間は重なり、合計6秒待つ必要はありません。

この数値は初期値です。取り付け位置や揺らし方に応じて調整してください。
静止中の重力1gを差し引くため、静止した向きが変わるだけでは反応しません。
角速度や振れ幅そのものを判定する方式ではなく、加速度の変化を検知します。
落下・衝撃でも反応し得ます。加速度レンジは±8g、ローパスフィルターは44Hzです。

揺れ続けても連送しません。送信失敗時にも自動再送せず、静止してからの次の揺れで送ります。
センサー読み取り失敗時は送信を抑止し、有効な読み取りと静止期間を確認してから再開します。
起動時にセンサーの識別・設定に失敗した場合はエラーで停止するので、配線確認後にENで再起動してください。

## 通信設定

`sense_sender.ino` の先頭で指定します。

- `ESPNOW_CHANNEL = 1`：受信側と一致させます。Wi-Fiルーターへの接続は不要です。
- `RECEIVER_MAC = FF:FF:FF:FF:FF:FF`：初期値はブロードキャストです。
  同じチャンネルで待機中の対応受信機すべてが反応します。
  1台だけに送る場合は、受信側の起動ログに出るSTA MACアドレスへ変更してください。

例えば受信側MACが `AA:BB:CC:11:22:33` なら、次のように変更します（この値は例です）。

```cpp
const uint8_t RECEIVER_MAC[6] = {0xAA, 0xBB, 0xCC, 0x11, 0x22, 0x33};
```

暗号化・アプリケーションの受付ACKは使用しません。ログの `START queued` は送信要求受付、
`link OK` は無線送信結果であり、モーターの実行開始を保証しません。
特にブロードキャストは受信機が不在でも成功扱いになり得ます。

受信側は **ESP-NOWモード**にしてください。動作中60秒と停止後3秒間の受信破棄は受信側で行い、その後に次のSTARTを受け付けます。
その期間の揺れによる送信は実行されず、後で再送もされません。
受信側が `READY` に戻った後、新たに揺らすと再実行できます。

## 書き込みとログ

`senme` ディレクトリから、送信側ESP32のUSBポートを確認して実行します。
受信側と送信側を両方USB接続している場合は、片方ずつ接続してポートを確認してください。

```sh
arduino-cli board list

# /dev/cu.usbserial-0001 は送信側の実際のポートへ置き換える
./firmware/flash.sh --target sense_sender --port /dev/cu.usbserial-0001

# コンパイルだけ
./firmware/flash.sh --target sense_sender --build-only
```

`--target` を省略すると受信側 `senme_controller` が選ばれます。
スクリプトは環境準備、コンパイル、書き込み、115200 bps・DTR OFF・RTS OFFでのログ表示を行います。
接続後にENを押すと起動ログが見られます。終了は `Ctrl+C` です。

```text
Keep still for 3 seconds to arm; shake strongly to send START.
ARMED: waiting for shake
SHAKE: 3.10 g; START queued (ESP_OK)
ESP-NOW: link OK (not execution acknowledgement)
```

## 感度調整と確認

`ShakeDetector.h` の定数を変更して書き込み直します。

| 定数 | 初期値 | 意味 |
| --- | --- | --- |
| `kTriggerG` | 1.3 | 小さくすると弱い揺れでも反応 |
| `kTriggerSamples` | 2 | 閾値を超える連続読み取り回数 |
| `kQuietG` | 1.0 | 静かな状態とみなす上限。`kTriggerG` より小さく設定 |
| `kQuietMs` | 3000 | 再検知の前に必要な静止時間 |
| `kMinSendIntervalMs` | 3000 | 送信の最小間隔 |

`motion=... g` は500msごとの値です。短い揺れのピークはこの定期ログには出ない場合があります。
検知時の `SHAKE` ログにも、その時点の値を表示します。

実機で確認する項目：

- 静止・小さな振動では送信せず、大きく揺らすと1回送信する。
- 揺れを続けても連送せず、一度静止してから揺らすと再送信できる。
- 受信側のESP-NOWモードで60秒動作が始まる。
- 受信側の動作中は揺らしても再実行されず、待機に戻ってからの新たな揺れで実行する。
- I2C配線が外れたときに、読み取りエラーを揺れとして送信しない。

ホスト側の判定ロジックテスト：

```sh
c++ -std=c++17 -Wall -Wextra -Werror firmware/tests/shake_test.cpp -o /tmp/senme-shake-test
/tmp/senme-shake-test
```

コンパイルと判定ロジックのテストを実施。センサー実機での感度・ESP-NOW通信は未確認です。

参考：[Espressif ESP-NOW API](https://docs.espressif.com/projects/esp-idf/en/v5.5/esp32/api-reference/network/esp_now.html)、
[TDK MPU6050レジスタ資料](https://invensense.tdk.com/wp-content/uploads/2015/02/MPU-6000-Register-Map.pdf)。
