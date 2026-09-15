#!/usr/bin/env bash
# Build a standalone skiller binary and install it to PREFIX/bin.
# Usage:
#   ./install.sh
#   PREFIX=/usr/local ./install.sh
#   ./install.sh --build-only
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${PREFIX:-$HOME/.local}"
BIN_DIR="${PREFIX}/bin"
BUILD_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --build-only) BUILD_ONLY=1 ;;
    -h | --help)
      cat <<EOF
Usage: ./install.sh [--build-only]

Build skiller with Bun (--compile) into dist/skiller and install it.

Options:
  --build-only   Compile only; do not copy to PREFIX/bin
  -h, --help     Show this help

Environment:
  PREFIX         Install prefix (default: ~/.local)
                 Binary lands at \$PREFIX/bin/skiller
EOF
      exit 0
      ;;
    *)
      echo "unknown option: $arg" >&2
      echo "try: ./install.sh --help" >&2
      exit 1
      ;;
  esac
done

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun is required (https://bun.sh)" >&2
  exit 1
fi

cd "$ROOT"

echo "==> installing dependencies"
bun install

echo "==> compiling standalone binary"
mkdir -p dist
# Native compile only — OpenTUI ships per-OS natives; do not cross-compile here.
bun build ./index.ts --compile --outfile dist/skiller

if [[ ! -x dist/skiller ]]; then
  echo "error: compile produced no executable at dist/skiller" >&2
  exit 1
fi

echo "==> built $(du -h dist/skiller | awk '{print $1}') → dist/skiller"

if [[ "$BUILD_ONLY" -eq 1 ]]; then
  echo "done (build only). run: ./dist/skiller --help"
  exit 0
fi

mkdir -p "$BIN_DIR"
install -m 755 dist/skiller "$BIN_DIR/skiller"

echo "==> installed $BIN_DIR/skiller"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo
    echo "note: $BIN_DIR is not on your PATH."
    echo "add this to your shell profile:"
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac

echo
echo "try: skiller --help"
