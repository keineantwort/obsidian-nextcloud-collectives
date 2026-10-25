#!/bin/sh
# Tell whether the changes between two commits touch anything the integration and performance tests depend on: source
# code, tests, the test server, the test configuration, the dependencies and the workflows that run the tests. Changes to
# documentation, images and the like do not. Used by integration.yml (pull requests, pushes to main) and nightly.yml.
# Prints "true" or "false". If git cannot compare the two commits, prints "true", so the tests run.
# Usage: affects-tests.sh <base> [<head>]   (head defaults to HEAD; both must be present in the local repository)
set -u
RELEVANT='^(src/|tests/|scripts/dev-nextcloud/|scripts/ci/|\.forgejo/workflows/(integration|nightly)\.yml$|vitest\..*\.config\.ts$|package(-lock)?\.json$)'
if ! CHANGED=$(git diff --name-only "$1" "${2:-HEAD}" 2>/dev/null); then
	echo "Cannot compare $1 with ${2:-HEAD}" >&2
	echo true
	exit 0
fi
if printf '%s\n' "$CHANGED" | grep -qE "$RELEVANT"; then echo true; else echo false; fi
