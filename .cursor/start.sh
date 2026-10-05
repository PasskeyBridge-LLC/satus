#!/usr/bin/env bash
# Boot local databases and the site dev server. Safe to rerun.
# Long-running processes stay in tmux; this script exits once the site
# answers a license check against the local seed.
set -euo pipefail

PREFIX=/opt/satus-toolchain
PORT=5173
SESSION=dev-server
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL="http://127.0.0.1:${PORT}/"
export PATH="${PREFIX}/bin:/usr/local/bin:${PATH}"
export DO_NOT_TRACK=1
export SUPABASE_TELEMETRY_DISABLED=1

# 203.0.113.9 is documentation range. The 61-call proof uses .10 so this
# boot probe does not consume that bucket.
SEED_KEY="satus_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

site_on_local_db() {
  curl -fs -o /dev/null --max-time 2 "$URL" || return 1
  local body
  body="$(curl -fs --max-time 5 \
    -H "content-type: application/json" \
    -H "x-forwarded-for: 203.0.113.9" \
    -d "{\"key\":\"${SEED_KEY}\"}" \
    "${URL}api/public/license/verify" || true)"
  [[ "$body" == *'"valid":true'* ]]
}

bash "$ROOT/scripts/test-db.sh"

if tmux has-session -t "$SESSION" 2>/dev/null && site_on_local_db; then
  exit 0
fi

if tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux kill-session -t "$SESSION"
fi

if command -v ss >/dev/null 2>&1 && ss -ltn | grep -q ":${PORT} "; then
  echo "port ${PORT} is already in use and session ${SESSION} is not running" >&2
  exit 1
fi

tmux new-session -d -s "$SESSION" -c "$ROOT" -- \
  bash -lc "export PATH='${PREFIX}/bin':\$PATH; set -a; source .env.local; set +a; exec bun run dev -- --host 0.0.0.0 --port ${PORT} >>/tmp/dev-server.log 2>&1"

for _ in $(seq 1 90); do
  if site_on_local_db; then
    exit 0
  fi
  sleep 1
done

echo "dev server did not answer a local license check on ${URL}" >&2
tail -n 80 /tmp/dev-server.log >&2 || true
exit 1
