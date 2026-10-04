# Senme

Senmeの機構設計・ファームウェアと、球体リソファン作成用のsimulatorをまとめたフォルダです。

- ルートの `.scad`・`.stl`・画像、`BOSL2/`、`octagonal_bell/`、`firmware/` などは `../6ro_art/senme` からコピーしています。
- `simulator/` は `../360li/experimental` を元にした独立したWebアプリです。必要な共通コード・依存関係の設定・テストをすべて内包しています。

## simulatorの起動

```sh
cd simulator
npm ci
npm run dev
```

http://127.0.0.1:5174/ を開いてください。詳しい操作・確認方法は [simulator/README.md](simulator/README.md) を参照してください。

## 機構設計とファームウェア

OpenSCADの設計は同梱の `BOSL2/` を使用します。
ファームウェアの操作・書き込み方法は [firmware/README.md](firmware/README.md) を参照してください。

## 公開対象と通信の注意

実機MACアドレスのメモ、ビルド成果物、STL、作業用の `tmp/`・`output/`、秘密情報を含むローカル設定は公開対象外です。BOSL2のライセンスは [BOSL2/LICENSE](BOSL2/LICENSE) を参照してください。

現在のESP-NOW通信には暗号化・送信元認証がなく、ブロードキャストの開始指令も受け付けます。無線が届く第三者の指令で待機中のモーターが始動する可能性があります。
