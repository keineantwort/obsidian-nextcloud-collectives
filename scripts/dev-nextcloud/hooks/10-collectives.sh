#!/bin/sh
# Runs once after the Nextcloud installation (official image hook).
set -eu
occ() { php /var/www/html/occ "$@"; }

# The app store sometimes fails to deliver the app list; occ then reports "it was not found on the appstore" although the
# store lists the app for this version (seen in nightly runs). After a failed download Nextcloud does not ask the store
# again for 5 minutes (setting appstore-fetcher-lastFailure, Fetcher::RETRY_AFTER_FAILURE_SECONDS) and answers with an
# empty list, so each retry first deletes that marker. The waits (100 s in total) stay well below the health check of
# docker-compose.yml, which gives the hook about 5 minutes.
install_app() {
	for wait in 10 20 30 40 0; do
		occ app:enable "$1" 2>/dev/null && return 0
		occ app:install "$1" && return 0
		store_failure
		[ "$wait" -gt 0 ] || break
		echo "Installing $1 failed, next try in $wait s" >&2
		sleep "$wait"
		occ config:app:delete settings appstore-fetcher-lastFailure >/dev/null
	done
	echo "Installing $1 failed for good" >&2
	return 1
}

# Print why the last download from the app store failed; Nextcloud writes it only to its log, not to occ's output.
store_failure() {
	grep -a -E 'Failed to connect to the app store|"app":"appstoreFetcher"' /var/www/html/data/nextcloud.log 2>/dev/null | tail -n 1 | php -r '
		$e = json_decode(stream_get_contents(STDIN), true);
		if (!is_array($e)) exit;
		$detail = $e["exception"]["Message"] ?? "";
		fwrite(STDERR, "App store: " . $e["message"] . ($detail !== "" && $detail !== $e["message"] ? " (" . $detail . ")" : "") . PHP_EOL);
	' || true
}

install_app circles
install_app collectives
# Allow background jobs to run via AJAX so the dev server needs no cron container.
occ background:ajax

OC_PASS="$NC_TEST_PASSWORD" occ user:add --password-from-env --display-name "Alice Test" "$NC_TEST_USER"
