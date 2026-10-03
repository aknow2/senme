#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SKETCH="$SCRIPT_DIR/senme_controller"
TARGET=senme_controller
FQBN=esp32:esp32:esp32
CORE_VERSION=3.3.8
INDEX_URL=https://espressif.github.io/arduino-esp32/package_esp32_index.json
PORT="${ESP32_PORT:-}"
MONITOR=true
BUILD_ONLY=false

usage() {
  cat <<'EOF'
Usage: flash.sh [--target senme_controller|sense_sender] --port PORT [--no-monitor]
       flash.sh [--target senme_controller|sense_sender] --build-only

ESP32コア3.3.8を準備し、コンパイル・書き込み・モニター起動を行います。
  --port PORT    書き込み先（環境変数ESP32_PORTでも指定可能）
  --target NAME  senme_controller（既定）またはsense_sender
  --no-monitor   書き込み後にモニターを開かない
  --build-only   環境準備とコンパイルのみ実行
  -h, --help     このヘルプを表示

実行前に負荷電源を切り、他のシリアルモニターを終了してください。
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      if [[ $# -lt 2 ]]; then
        echo 'エラー: --targetにはスケッチ名を指定してください。' >&2
        exit 2
      fi
      case "$2" in
        senme_controller|sense_sender) TARGET="$2"; SKETCH="$SCRIPT_DIR/$TARGET" ;;
        *) echo "不明なスケッチ: $2" >&2; exit 2 ;;
      esac
      shift 2
      ;;
    --port)
      if [[ $# -lt 2 || -z "$2" || "$2" == --* ]]; then
        echo 'エラー: --portにはポートを指定してください。' >&2
        exit 2
      fi
      PORT="$2"
      shift 2
      ;;
    --no-monitor) MONITOR=false; shift ;;
    --build-only) BUILD_ONLY=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "不明な引数: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "$BUILD_ONLY" == false && -z "$PORT" ]]; then
  echo 'エラー: --portまたはESP32_PORTで書き込み先を指定してください。' >&2
  echo 'ポート確認: arduino-cli board list' >&2
  exit 2
fi

if ! command -v arduino-cli >/dev/null 2>&1; then
  if ! command -v brew >/dev/null 2>&1; then
    echo 'Arduino CLIがありません。Arduino CLIまたはHomebrewを導入してください。' >&2
    exit 1
  fi
  brew install arduino-cli
fi

installed_cores="$(arduino-cli core list)"
if ! awk -v version="$CORE_VERSION" '$1 == "esp32:esp32" && $2 == version { found=1 } END { exit !found }' <<< "$installed_cores"; then
  echo "ESP32コア $CORE_VERSION をインストールします。"
  arduino-cli core update-index --additional-urls "$INDEX_URL"
  arduino-cli core install "esp32:esp32@$CORE_VERSION" --additional-urls "$INDEX_URL"
fi

# Each run gets its own directory so an old binary cannot be uploaded by mistake.
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/senme-build.XXXXXX")"
trap 'rm -rf -- "$BUILD_DIR"' EXIT
echo "コンパイル中: $TARGET"
arduino-cli compile --fqbn "$FQBN" --output-dir "$BUILD_DIR" "$SKETCH"

if [[ "$BUILD_ONLY" == true ]]; then
  echo 'コンパイル成功（実機への書き込みなし）。'
  exit 0
fi

echo "スケッチ: $TARGET / 書き込み先: ${PORT}（負荷電源を切った状態で使用してください）"
arduino-cli upload --port "$PORT" --fqbn "$FQBN" --input-dir "$BUILD_DIR" "$SKETCH"
echo '書き込み完了。'

if [[ "$MONITOR" == true ]]; then
  echo 'モニター接続後、ENを一度押すと起動ログを確認できます。終了: Ctrl+C'
  arduino-cli monitor --port "$PORT" --config baudrate=115200,dtr=off,rts=off
fi
