#!/bin/sh
# Stop the test server. Pass --reset to also delete all data.
set -eu
cd "$(dirname "$0")"
if [ "${1:-}" = "--reset" ]; then docker compose down -v; else docker compose down; fi
