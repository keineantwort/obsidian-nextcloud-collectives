#!/bin/sh
# Start the local test server and wait until it is healthy.
set -eu
cd "$(dirname "$0")"
[ -f .env ] || cp .env.example .env
docker compose up -d --wait
. ./.env
echo "Nextcloud läuft auf http://localhost:${NC_PORT}"
docker compose exec -T -u www-data nextcloud php occ app:list --enabled | grep -E 'collectives|circles|text'
