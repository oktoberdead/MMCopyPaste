#!/usr/bin/env bash
# Пересоздаёт иконки расширения (нужен ImageMagick: convert).
# Запуск: bash tools/make-icons.sh
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p icons

for SIZE in 16 32 48 128; do
  RADIUS=$(( SIZE / 5 ))
  MAX=$(( SIZE - 1 ))
  POINT=$(( SIZE * 58 / 100 ))
  PAD=$(( SIZE / 16 ))

  convert -size "${SIZE}x${SIZE}" xc:none -fill white \
    -draw "roundrectangle ${PAD},${PAD} $(( MAX - PAD )),$(( MAX - PAD )) ${RADIUS},${RADIUS}" \
    "/tmp/mmc-shape-${SIZE}.png"

  convert -size "${SIZE}x${SIZE}" gradient:'#2f6fed'-'#7a5cff' "/tmp/mmc-grad-${SIZE}.png"

  convert "/tmp/mmc-grad-${SIZE}.png" "/tmp/mmc-shape-${SIZE}.png" \
    -alpha off -compose CopyOpacity -composite \
    -font DejaVu-Sans-Bold -pointsize "${POINT}" -fill white \
    -gravity center -annotate +0+$(( SIZE / 24 )) 'M' \
    "icons/icon-${SIZE}.png"

  rm -f "/tmp/mmc-shape-${SIZE}.png" "/tmp/mmc-grad-${SIZE}.png"
  echo "icons/icon-${SIZE}.png"
done
