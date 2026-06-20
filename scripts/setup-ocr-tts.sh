#!/usr/bin/env bash
# Telecharge les binaires/modeles locaux pour l'OCR (tesseract fra) et la
# synthese vocale (Piper). Tout est vendorise sous vendor/ (git-ignore),
# aucune dependance reseau a l'execution du site, aucun sudo requis.
#
# Idempotent : ne retelecharge pas ce qui est deja present.
# Usage : bash scripts/setup-ocr-tts.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/vendor"
TESSDATA="$VENDOR/tessdata"
PIPER_DIR="$VENDOR/piper"
VOICES_DIR="$PIPER_DIR/voices"

mkdir -p "$TESSDATA" "$PIPER_DIR" "$VOICES_DIR"

dl() {
  # dl <url> <dest>
  local url="$1" dest="$2"
  if [ -s "$dest" ]; then
    echo "  deja present : $(basename "$dest")"
    return 0
  fi
  echo "  telechargement : $(basename "$dest")"
  curl -fSL --retry 3 --connect-timeout 20 -o "$dest.part" "$url"
  mv "$dest.part" "$dest"
}

echo "== 1/3  Langue OCR francaise (tesseract) =="
# tessdata standard (bon compromis vitesse/precision pour de l'imprime).
dl "https://github.com/tesseract-ocr/tessdata/raw/main/fra.traineddata" \
   "$TESSDATA/fra.traineddata"
# osd utile pour la detection d'orientation (deskew).
dl "https://github.com/tesseract-ocr/tessdata/raw/main/osd.traineddata" \
   "$TESSDATA/osd.traineddata"

echo "== 2/3  Moteur Piper (synthese vocale) =="
PIPER_BIN="$PIPER_DIR/piper/piper"
if [ -x "$PIPER_BIN" ]; then
  echo "  deja present : piper"
else
  PIPER_TGZ="$PIPER_DIR/piper_linux_x86_64.tar.gz"
  dl "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz" \
     "$PIPER_TGZ"
  echo "  extraction du binaire Piper"
  tar -xzf "$PIPER_TGZ" -C "$PIPER_DIR"
  rm -f "$PIPER_TGZ"
fi

echo "== 3/3  Voix francaise (fr_FR-siwis-medium) =="
HF="https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium"
dl "$HF/fr_FR-siwis-medium.onnx"      "$VOICES_DIR/fr_FR-siwis-medium.onnx"
dl "$HF/fr_FR-siwis-medium.onnx.json" "$VOICES_DIR/fr_FR-siwis-medium.onnx.json"

echo
echo "OK. Verification rapide :"
echo -n "  tesseract fra : "
if TESSDATA_PREFIX="$TESSDATA" tesseract --list-langs 2>/dev/null | grep -qx fra; then
  echo "OK"
else
  echo "ABSENT (verifier le telechargement)"
fi
echo -n "  piper         : "
[ -x "$PIPER_BIN" ] && echo "OK" || echo "ABSENT"
echo -n "  voix FR       : "
[ -s "$VOICES_DIR/fr_FR-siwis-medium.onnx" ] && echo "OK" || echo "ABSENT"
