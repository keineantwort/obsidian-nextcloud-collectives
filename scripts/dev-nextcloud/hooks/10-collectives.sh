#!/bin/sh
# Runs once after the Nextcloud installation (official image hook).
set -eu
occ() { php /var/www/html/occ "$@"; }

occ app:enable circles || occ app:install circles
occ app:install collectives || occ app:enable collectives
# Allow background jobs to run via AJAX so the dev server needs no cron container.
occ background:ajax

OC_PASS="$NC_TEST_PASSWORD" occ user:add --password-from-env --display-name "Alice Test" "$NC_TEST_USER"
