#!/usr/bin/env bash
# =============================================================================
# VPS deploy (run as root). Defaults: pull, npm ci, db:migrate, build, restart, health.
#
#   ./scripts/deploy-vps.sh
#
# Optional env (same line or export before invoking):
#   LEAKWRLD_ROOT=/opt/leakwrld          # app directory
#   LEAKWRLD_USER=leakwrld               # unix user that owns the app
#   LEAKWRLD_SERVICE=leakwrld            # systemd unit (restart + status)
#   LEAKWRLD_HEALTH=http://127.0.0.1:3002/api/health
#
#   LEAKWRLD_MEDIA=1                     # after pull: media:sync (needs R2_* in .env)
#   LEAKWRLD_CATALOG=1                  # catalog:rebuild (needs DATABASE_URL). Auto-on if MEDIA or THUMBS.
#   LEAKWRLD_CATALOG_FORCE=1            # npm run catalog:rebuild -- --force
#   LEAKWRLD_THUMBS=1                   # media:thumbs:cache (VERY slow: full rclone copy per missing WebP)
#   LEAKWRLD_SKIP_BUILD=1               # skip npm run build (not recommended)
#   LEAKWRLD_SKIP_RESTART=1           # skip systemctl restart (for testing)
#
# Thumbs example in screen (recommended):
#   screen -S lw-thumbs
#   cd /opt/leakwrld && set -a && . ./.env && set +a && npm run media:thumbs:cache
#   # Ctrl+A D to detach; then: LEAKWRLD_CATALOG=1 ./scripts/deploy-vps.sh
# =============================================================================
set -euo pipefail

ROOT="${LEAKWRLD_ROOT:-/opt/leakwrld}"
RUNU="${LEAKWRLD_USER:-leakwrld}"
SVC="${LEAKWRLD_SERVICE:-leakwrld}"
HEALTH="${LEAKWRLD_HEALTH:-http://127.0.0.1:3002/api/health}"

run_as() {
  sudo -u "$RUNU" bash -lc "$1"
}

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this script as root (it uses chown and systemctl)." >&2
  exit 1
fi

echo "==> chown ${RUNU}:${RUNU} ${ROOT}"
chown -R "${RUNU}:${RUNU}" "$ROOT"

echo "==> git pull"
run_as "cd '$ROOT' && git pull origin main"

echo "==> npm ci"
run_as "cd '$ROOT' && npm ci"

echo "==> db:migrate"
run_as "cd '$ROOT' && set -a && . ./.env && set +a && npm run db:migrate"

if [[ "${LEAKWRLD_MEDIA:-}" == "1" ]]; then
  echo "==> media:sync (R2 → manifests under client/public/media)"
  run_as "cd '$ROOT' && set -a && . ./.env && set +a && npm run media:sync"
fi

if [[ "${LEAKWRLD_THUMBS:-}" == "1" ]]; then
  echo "==> media:thumbs:cache (long run: consider screen/tmux; progress every 25 items)"
  run_as "cd '$ROOT' && set -a && . ./.env && set +a && npm run media:thumbs:cache"
fi

DO_CATALOG="${LEAKWRLD_CATALOG:-}"
[[ "${LEAKWRLD_MEDIA:-}" == "1" || "${LEAKWRLD_THUMBS:-}" == "1" ]] && DO_CATALOG="1"

if [[ "$DO_CATALOG" == "1" ]]; then
  echo "==> catalog:rebuild"
  if [[ "${LEAKWRLD_CATALOG_FORCE:-}" == "1" ]]; then
    run_as "cd '$ROOT' && set -a && . ./.env && set +a && npm run catalog:rebuild -- --force"
  else
    run_as "cd '$ROOT' && set -a && . ./.env && set +a && npm run catalog:rebuild"
  fi
fi

if [[ "${LEAKWRLD_SKIP_BUILD:-}" != "1" ]]; then
  echo "==> npm run build"
  run_as "cd '$ROOT' && npm run build"
else
  echo "==> skip build (LEAKWRLD_SKIP_BUILD=1)"
fi

if [[ "${LEAKWRLD_SKIP_RESTART:-}" != "1" ]]; then
  echo "==> systemctl restart ${SVC}"
  systemctl restart "$SVC"
  systemctl status "$SVC" --no-pager || true
else
  echo "==> skip restart (LEAKWRLD_SKIP_RESTART=1)"
fi

echo "==> GET ${HEALTH}"
curl -sS "$HEALTH" || true
echo ""
echo "Deploy finished."
