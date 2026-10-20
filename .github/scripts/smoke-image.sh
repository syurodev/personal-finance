#!/usr/bin/env bash
set -euo pipefail
image=${1:?Supply the image to verify}
cleanup() {
  if [ "${1:-0}" -ne 0 ]; then
    docker logs pf-smoke 2>/dev/null || true
  fi
  docker rm -f pf-smoke >/dev/null 2>&1 || true
}
trap 'cleanup $?' EXIT

# Tests use personal_finance_test. Exercise the image's migration command
# against the separate, freshly initialized personal_finance database.
docker run --rm --network host --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges \
  -e MIGRATION_DATABASE_URL=postgres://pf_owner:pf_owner@127.0.0.1:5433/personal_finance \
  "$image" bun src/db/migrate-cli.ts

docker run -d --name pf-smoke --network host --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges \
  --env-file .env.test \
  -e DATABASE_URL=postgres://pf_app:pf_app@127.0.0.1:5433/personal_finance \
  "$image"
for _ in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:3101/healthz >/dev/null; then
    exit 0
  fi
  if [ "$(docker inspect --format '{{.State.Running}}' pf-smoke)" != true ]; then
    break
  fi
  sleep 2
done
echo 'The production image failed its /healthz smoke test.' >&2
exit 1
