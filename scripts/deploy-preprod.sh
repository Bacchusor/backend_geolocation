#!/usr/bin/env bash
# Deploy / update the GeoReminder pre-production stack on the Pi (portainer-local, 192.168.1.111).
#
# Usage:  scripts/deploy-preprod.sh [IMAGE_TAG]
# Env:    PREPROD_HOST (default 192.168.1.111), PREPROD_USER (default bacchusor), SSH_KEY (optional path)
#         GHCR_USER / GHCR_TOKEN (optional, only if the GHCR packages are private)
#
# What it does (idempotent):
#   1. copies docker-compose.yml to /opt/georeminder on the host
#   2. creates /opt/georeminder/.env from .env.preprod (local, git-ignored) if it exists, else keeps the remote one
#   3. docker compose pull + up -d, then waits for /v1/ready
set -euo pipefail

HOST="${PREPROD_HOST:-192.168.1.111}"
USER_="${PREPROD_USER:-bacchusor}"
TAG="${1:-${IMAGE_TAG:-pre}}"
REMOTE_DIR=/opt/georeminder
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)
[[ -n "${SSH_KEY:-}" ]] && SSH_OPTS+=(-i "$SSH_KEY")
ssh_() { ssh "${SSH_OPTS[@]}" "$USER_@$HOST" "$@"; }
scp_() { scp "${SSH_OPTS[@]}" "$@"; }

cd "$(dirname "$0")/.."
echo "==> target $USER_@$HOST, image tag $TAG"

ssh_ "sudo mkdir -p $REMOTE_DIR && sudo chown $USER_ $REMOTE_DIR"
scp_ docker-compose.yml "$USER_@$HOST:$REMOTE_DIR/docker-compose.yml"
if [[ -f .env.preprod ]]; then
  scp_ .env.preprod "$USER_@$HOST:$REMOTE_DIR/.env"
  echo "==> .env uploaded from .env.preprod"
else
  ssh_ "test -f $REMOTE_DIR/.env" || { echo "!! no .env.preprod locally and no $REMOTE_DIR/.env on the host"; exit 1; }
fi
ssh_ "cd $REMOTE_DIR && grep -q '^IMAGE_TAG=' .env && sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=$TAG/' .env || echo IMAGE_TAG=$TAG >> .env"

if [[ -n "${GHCR_TOKEN:-}" ]]; then
  ssh_ "echo '$GHCR_TOKEN' | sudo docker login ghcr.io -u '${GHCR_USER:-x}' --password-stdin" >/dev/null
fi

ssh_ "cd $REMOTE_DIR && sudo docker compose pull --quiet && sudo docker compose up -d --remove-orphans"

API_PORT=$(ssh_ "cd $REMOTE_DIR && grep -E '^API_PORT=' .env | cut -d= -f2" || true)
API_PORT="${API_PORT:-3000}"
echo "==> waiting for http://$HOST:$API_PORT/v1/ready"
for i in $(seq 1 40); do
  if out=$(curl -fsS --max-time 5 "http://$HOST:$API_PORT/v1/ready" 2>/dev/null); then
    echo "==> ready: $out"
    ssh_ "cd $REMOTE_DIR && sudo docker compose ps"
    exit 0
  fi
  sleep 5
done
echo "!! API did not become ready; last logs:"
ssh_ "cd $REMOTE_DIR && sudo docker compose ps && sudo docker compose logs --tail=50 api"
exit 1
