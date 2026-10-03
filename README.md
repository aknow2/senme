# senme

OpenSCADによる部品設計・STLデータと、ESP32用のLED／モーター制御ファームウェア。

- ルートの `.scad` / `.stl`：ギア、支持部品、配線ボックスなど。
- [octagonal_bell](octagonal_bell/README.md)：八角形ベルの設計。
- [firmware](firmware/README.md)：配線・制御仕様・書き込み手順。
- [sense_sender](firmware/sense_sender/README.md)：MPU6050の揺れを検出してESP-NOWで開始指令を送るスケッチ。
- `BOSL2/`：同梱のOpenSCADライブラリ。著作権表示・ライセンスは [BOSL2/LICENSE](BOSL2/LICENSE) を参照してください。

## 公開対象と実機利用の注意

実機のMACアドレスを含む `firmware/address/`、ファームウェアのビルド成果物、ローカル環境設定はGitの追跡対象外です。

現在のESP-NOW通信は暗号化・送信元認証を行わず、ブロードキャストの開始指令も受け付けます。無線が届く範囲の第三者からの指令で、待機中のモーターが始動する可能性があります。第三者が無線通信できる場所での運用には、通信の認証・暗号化と実機の安全対策を別途検討してください。
