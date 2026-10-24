#!/bin/sh
# Runs once after the Nextcloud installation (official image hook).
set -eu
occ() { php /var/www/html/occ "$@"; }

# The app store sometimes answers without the app list; occ then reports "it was not found on the appstore" although the
# store lists the app for this version (seen in a nightly run for Nextcloud 34). So the download is tried several times.
# The waits (100 s in total) stay well below the health check of docker-compose.yml, which gives the hook about 5 minutes.
install_app() {
	for wait in 10 20 30 40 0; do
		occ app:enable "$1" 2>/dev/null && return 0
		occ app:install "$1" && return 0
		[ "$wait" -gt 0 ] || break
		echo "Installing $1 failed, next try in $wait s" >&2
		sleep "$wait"
	done
	echo "Installing $1 failed for good" >&2
	return 1
}

install_app circles
install_app collectives
# Allow background jobs to run via AJAX so the dev server needs no cron container.
occ background:ajax

OC_PASS="$NC_TEST_PASSWORD" occ user:add --password-from-env --display-name "Alice Test" "$NC_TEST_USER"
