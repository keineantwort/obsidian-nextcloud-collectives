#!/bin/sh
# Print the versions of Nextcloud and its apps of the running test server (for CI logs and bug reports).
# The Collectives version is not readable for normal users through the API (architecture §12), so this asks occ inside the container.
# Usage: versions.sh [compose project name]   (default: the project of up.sh)
set -eu
cd "$(dirname "$0")"
[ -z "${1:-}" ] || set -- -p "$1"
echo "Nextcloud: $(docker compose "$@" exec -T -u www-data nextcloud php occ status --output=json | sed -n 's/.*"versionstring":"\([^"]*\)".*/\1/p')"
docker compose "$@" exec -T -u www-data nextcloud php occ app:list --enabled | grep -E '^  - (collectives|circles|text):' | sed 's/^  - /App /'
