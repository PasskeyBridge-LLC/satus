#!/usr/bin/env bash
# Boot the site dev server in tmux session dev-server. Safe to rerun.
# Long-running process stays in tmux; this script exits once the port answers.
set -euo pipefail

PREFIX=/opt/satus-toolchain
PORT=5173
SESSION=dev-server
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL="http://127.0.0.1:${PORT}/"
export PATH="${PREFIX}/bin:${PATH}"

ready() {
  curl -fs -o /dev/null --max-time 2 "$URL"
}

if tmux has-session -t "$SESSION" 2>/dev/null; then
  if ready; then
    exit 0
  fi
  tmux kill-session -t "$SESSION"
fi

# A leftover listener with no session would make the new server fail to bind.
if command -v ss >/dev/null 2>&1 && ss -ltn | grep -q ":${PORT} "; then
  echo "port ${PORT} is already in use and session ${SESSION} is not running" >&2
  exit 1
fi

tmux new-session -d -s "$SESSION" -c "$ROOT" -- \
  bash -lc "export PATH='${PREFIX}/bin':\$PATH; exec bun run dev -- --host 0.0.0.0 --port ${PORT} >>/tmp/dev-server.log 2>&1"

for _ in $(seq 1 90); do
  if ready; then
    exit 0
  fi
  sleep 1
done

echo "dev server did not answer on ${URL}" >&2
tail -n 80 /tmp/dev-server.log >&2 || true
exit 1
