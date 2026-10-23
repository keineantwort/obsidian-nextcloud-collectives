#!/bin/sh
# Tell whether the newest Nextcloud image (nextcloud:apache) is the image of the current tested major version (the
# highest in TESTED_NEXTCLOUD_MAJORS, src/api/versionCheck.ts). "<major>-apache" always points to the newest release of
# that major, so equal digests mean the same Nextcloud; a CI job for "latest" would only repeat the job of that version.
# Prints "true" or "false". If Docker Hub cannot be asked, prints "false", so the job for "latest" runs.
# Usage: latest-is-current.sh
set -eu
cd "$(dirname "$0")"
CURRENT=$(sed -n 's/.*TESTED_NEXTCLOUD_MAJORS[^=]*= *\[\([^]]*\)\].*/\1/p' ../../src/api/versionCheck.ts | tr ',' '\n' | tr -d ' ' | sort -n | tail -1)
digest() {
	curl -fsS "https://hub.docker.com/v2/repositories/library/nextcloud/tags/$1" | jq -r '.digest // empty' 2>/dev/null || true
}
LATEST=$(digest apache)
OWN=$(digest "${CURRENT}-apache")
echo "nextcloud:apache ${LATEST:-unknown}, nextcloud:${CURRENT}-apache ${OWN:-unknown}" >&2
if [ -n "$LATEST" ] && [ "$LATEST" = "$OWN" ]; then echo true; else echo false; fi
