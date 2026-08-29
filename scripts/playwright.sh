#!/usr/bin/env bash
# Playwright, on a virtual display.
#
# Electron opens real windows, and a suite that takes over the screen is a suite
# people stop running while they work. xvfb keeps them out of the way; set
# ORRERY_HEADED=1 when watching them is the point.
set -euo pipefail

export ORRERY_E2E_WRAPPED=1

if [[ "${ORRERY_HEADED:-}" == "1" ]] || ! command -v xvfb-run >/dev/null 2>&1; then
  exec npx playwright test "$@"
fi
exec xvfb-run -a npx playwright test "$@"
