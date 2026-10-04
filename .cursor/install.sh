#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap. Must exit. No secrets.
# Site lockfile is bun.lock; the CLI has its own package-lock.json.
set -euo pipefail

NODE_VERSION=24.21.0
NODE_SHA256=fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6
BUN_VERSION=1.3.11
# sha256 of the official bun-v1.3.11 bun-linux-x64.zip release asset.
BUN_SHA256=8611ba935af886f05a6f38740a15160326c15e5d5d07adef966130b4493607ed

PREFIX=/opt/satus-toolchain
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

install_node() {
  local current=""
  if [[ -x "$PREFIX/bin/node" ]]; then
    current="$("$PREFIX/bin/node" -v 2>/dev/null || true)"
  fi
  if [[ "$current" == "v${NODE_VERSION}" ]]; then
    return 0
  fi

  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    -o "$tmp/node.tar.xz"
  echo "${NODE_SHA256}  $tmp/node.tar.xz" | sha256sum -c -
  sudo mkdir -p "$PREFIX"
  sudo tar -xJf "$tmp/node.tar.xz" -C "$PREFIX" --strip-components=1 --no-same-owner
  trap - RETURN
  rm -rf "$tmp"
}

install_bun() {
  local current=""
  if [[ -x "$PREFIX/bin/bun" ]]; then
    current="$("$PREFIX/bin/bun" --version 2>/dev/null || true)"
  fi
  if [[ "$current" == "$BUN_VERSION" ]]; then
    return 0
  fi

  local tmp
  tmp="$(mktemp -d)"
  curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip" \
    -o "$tmp/bun.zip"
  echo "${BUN_SHA256}  $tmp/bun.zip" | sha256sum -c -
  python3 - "$tmp" <<'PY'
import sys, zipfile
from pathlib import Path
tmp = Path(sys.argv[1])
with zipfile.ZipFile(tmp / "bun.zip") as zf:
    zf.extract("bun-linux-x64/bun", path=tmp)
PY
  sudo cp "$tmp/bun-linux-x64/bun" "$PREFIX/bin/bun"
  sudo chmod 755 "$PREFIX/bin/bun"
  # bun and bunx are the same binary; bunx is a name check.
  sudo ln -sfn bun "$PREFIX/bin/bunx"
  rm -rf "$tmp"
}

install_node
install_bun

sudo tee /etc/profile.d/satus-toolchain.sh >/dev/null <<EOF
export PATH="${PREFIX}/bin:\$PATH"
EOF
sudo chmod 644 /etc/profile.d/satus-toolchain.sh

export PATH="${PREFIX}/bin:${PATH}"
hash -r

cd "$ROOT"
bun install --frozen-lockfile
(
  cd "$ROOT/packages/cli"
  npm ci
)
