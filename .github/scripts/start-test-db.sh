#!/usr/bin/env bash
set -euo pipefail

docker run -d --name pf-db \
  -e POSTGRES_PASSWORD=postgres \
  -p 127.0.0.1:5433:5432 \
  -v "$PWD/docker/postgres/init:/docker-entrypoint-initdb.d:ro" \
  postgres:18

# The temporary init server may accept Unix-socket connections before roles
# and databases exist. Require a successful TCP query as the migration role.
for _ in $(seq 1 30); do
  if docker exec -e PGPASSWORD=pf_owner pf-db \
    psql -h 127.0.0.1 -U pf_owner -d personal_finance_test -Atqc 'SELECT 1' >/dev/null 2>&1; then
    exit 0
  fi
  sleep 2
done
docker logs pf-db
echo 'PostgreSQL did not initialize the test roles/database within 60 seconds.' >&2
exit 1
