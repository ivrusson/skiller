#!/usr/bin/env bash
# Install skiller as a standalone binary.
#
# From a clone:
#   ./install.sh
#   ./install.sh --build-only
#   PREFIX=/usr/local ./install.sh
#
# One-liner (no clone needed) — builds from source:
#   curl -fsSL https://raw.githubusercontent.com/ivrusson/skiller/main/install.sh | bash
#
# Prebuilt binary from the latest GitHub Release (CI artifacts):
#   curl -fsSL https://raw.githubusercontent.com/ivrusson/skiller/main/install.sh | bash -s -- --from-release
set -euo pipefail

REPO_SLUG="${SKILLER_REPO_SLUG:-ivrusson/skiller}"
REPO_URL="${SKILLER_REPO:-https://github.com/${REPO_SLUG}.git}"
REPO_REF="${SKILLER_REF:-main}"
RAW_BASE="https://raw.githubusercontent.com/${REPO_SLUG}/${REPO_REF}"
PREFIX="${PREFIX:-$HOME/.local}"
BIN_DIR="${PREFIX}/bin"
BUILD_ONLY=0
FROM_RELEASE=0
CLEANUP_ROOT=0
ROOT=""

usage() {
  cat <<EOF
Usage: install.sh [options]

Install skiller into \$PREFIX/bin/skiller (default: ~/.local/bin/skiller).

Options:
  --from-release   Download a prebuilt binary from the latest GitHub Release
  --build-only     Compile only (checkout mode); do not copy to PREFIX/bin
  -h, --help       Show this help

Environment:
  PREFIX              Install prefix (default: ~/.local)
  SKILLER_REF         Git ref to clone / raw URL branch (default: main)
  SKILLER_REPO        Git remote URL (default: https://github.com/ivrusson/skiller.git)
  SKILLER_REPO_SLUG   owner/repo for release downloads (default: ivrusson/skiller)

Examples:
  curl -fsSL ${RAW_BASE}/install.sh | bash
  curl -fsSL ${RAW_BASE}/install.sh | bash -s -- --from-release
  ./install.sh
EOF
}

for arg in "$@"; do
  case "$arg" in
    --from-release) FROM_RELEASE=1 ;;
    --build-only) BUILD_ONLY=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $arg" >&2
      echo "try: install.sh --help" >&2
      exit 1
      ;;
  esac
done

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: '$1' is required" >&2
    exit 1
  fi
}

ensure_path_note() {
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *)
      echo
      echo "note: $BIN_DIR is not on your PATH."
      echo "add this to your shell profile:"
      echo "  export PATH=\"$BIN_DIR:\$PATH\""
      ;;
  esac
}

install_binary() {
  local src="$1"
  mkdir -p "$BIN_DIR"
  install -m 755 "$src" "$BIN_DIR/skiller"
  echo "==> installed $BIN_DIR/skiller"
  ensure_path_note
  echo
  echo "try: skiller --help"
}

detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$os" in
    linux) os="linux" ;;
    darwin) os="darwin" ;;
    mingw* | msys* | cygwin*) os="windows" ;;
    *)
      echo "error: unsupported OS: $(uname -s)" >&2
      exit 1
      ;;
  esac
  case "$arch" in
    x86_64 | amd64) arch="x64" ;;
    arm64 | aarch64) arch="arm64" ;;
    *)
      echo "error: unsupported arch: $(uname -m)" >&2
      exit 1
      ;;
  esac
  if [[ "$os" == "windows" ]]; then
    echo "skiller-${os}-${arch}.exe"
  else
    echo "skiller-${os}-${arch}"
  fi
}

resolve_repo_root() {
  # When the script lives inside a checkout, use that tree.
  if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    local here
    here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [[ -f "$here/index.ts" && -f "$here/package.json" ]]; then
      ROOT="$here"
      return
    fi
  fi
  # Piped via curl | bash (or otherwise not in a checkout): clone a shallow copy.
  need_cmd git
  ROOT="$(mktemp -d "${TMPDIR:-/tmp}/skiller-src.XXXXXX")"
  CLEANUP_ROOT=1
  echo "==> cloning ${REPO_URL} (@${REPO_REF}) → $ROOT"
  git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$ROOT"
}

cleanup() {
  if [[ "$CLEANUP_ROOT" -eq 1 && -n "$ROOT" && -d "$ROOT" ]]; then
    rm -rf "$ROOT"
  fi
}
trap cleanup EXIT

install_from_release() {
  need_cmd curl
  local asset tag url tmp api body
  asset="$(detect_platform)"
  api="https://api.github.com/repos/${REPO_SLUG}/releases/latest"
  echo "==> resolving latest release for ${REPO_SLUG}"
  body="$(curl -fsSL "$api" 2>/dev/null || true)"
  tag="$(printf '%s' "$body" | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  if [[ -z "$tag" ]]; then
    echo "error: could not find a latest GitHub Release for ${REPO_SLUG}" >&2
    echo "hint: use source install instead (omit --from-release), or publish a v* tag first" >&2
    exit 1
  fi
  url="https://github.com/${REPO_SLUG}/releases/download/${tag}/${asset}"
  tmp="$(mktemp "${TMPDIR:-/tmp}/skiller-bin.XXXXXX")"
  echo "==> downloading ${url}"
  if ! curl -fsSL "$url" -o "$tmp"; then
    echo "error: failed to download ${asset} from ${tag}" >&2
    echo "available assets are listed on https://github.com/${REPO_SLUG}/releases/tag/${tag}" >&2
    rm -f "$tmp"
    exit 1
  fi
  chmod +x "$tmp"
  install_binary "$tmp"
  rm -f "$tmp"
}

install_from_source() {
  need_cmd bun
  resolve_repo_root
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
    if [[ "$CLEANUP_ROOT" -eq 1 ]]; then
      echo "error: --build-only requires a local checkout (not curl | bash)" >&2
      exit 1
    fi
    echo "done (build only). run: ./dist/skiller --help"
    exit 0
  fi

  install_binary "$ROOT/dist/skiller"
}

if [[ "$FROM_RELEASE" -eq 1 ]]; then
  if [[ "$BUILD_ONLY" -eq 1 ]]; then
    echo "error: --build-only cannot be combined with --from-release" >&2
    exit 1
  fi
  install_from_release
else
  install_from_source
fi
