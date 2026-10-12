#!/bin/bash
# Runs every suite in $SUITES on every app version in $VERSIONS, under a
# virtual display where there is no real one, and reports each the way GitHub
# Actions reads it: exit 0 passed, 2 skipped cases (a warning), else failed —
# with the tail of the suite's app log on failure. From Lure (.dev/ci-suites.sh).
#
#   RUN_SUITE=.dev/ci-run.sh   the project's command that starts the app and runs one suite
#   SUITES="test-a test-b"     required
#   VERSIONS="latest earliest" handed to RUN_SUITE as $VERSION_VAR (default APP_VERSION)
#   APP_NAME=Obsidian          for the group titles; SUITE_LOG='app-%s.log' for the log tail
#   XVFB_SCREEN=1920x1080x24
set +e
: "${RUN_SUITE:?the command that runs one suite}" "${SUITES:?}"
var=${VERSION_VAR:-APP_VERSION}
failed=0
for version in ${VERSIONS:-latest}; do
	for suite in $SUITES; do
		echo "::group::$suite (${APP_NAME:-app} $version)"
		if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ] || [ "$(uname)" = Darwin ] || [ "${OS:-}" = Windows_NT ]; then
			env "$var=$version" $RUN_SUITE "$suite"
		else
			env "$var=$version" xvfb-run -a -s "-screen 0 ${XVFB_SCREEN:-1920x1080x24}" $RUN_SUITE "$suite"
		fi
		code=$?
		echo "::endgroup::"
		case $code in
			0) ;;
			2) echo "::warning::$suite ($version) skipped cases" ;;
			*) echo "::error::$suite ($version) failed"; failed=1
			   [ -n "${SUITE_LOG:-}" ] && tail -30 "$(printf "$SUITE_LOG" "$suite")" 2>/dev/null ;;
		esac
	done
done
exit $failed
