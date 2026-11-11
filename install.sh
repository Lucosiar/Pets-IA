#!/bin/bash
# Pets IA for macOS: downloads the latest release and runs `petsia setup`.
#   curl -fsSL https://raw.githubusercontent.com/Lucosiar/Pets-IA/main/install.sh | bash
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Este instalador es para macOS. En Windows usa install.ps1." >&2
  exit 1
fi
case "$(uname -m)" in
  arm64) arch=arm64 ;;
  x86_64) arch=x64 ;;
  *) echo "Arquitectura no soportada: $(uname -m)" >&2; exit 1 ;;
esac

url="https://github.com/Lucosiar/Pets-IA/releases/latest/download/petsia-macos-$arch.tar.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "Descargando Pets IA ($arch)…"
curl -fsSL "$url" -o "$tmp/petsia.tar.gz"
tar -xzf "$tmp/petsia.tar.gz" -C "$tmp"
"$tmp/petsia" setup
