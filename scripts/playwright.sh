#!/usr/bin/env bash
# Playwright, on a virtual display.
#
# Electron opens real windows, and a suite that takes over the screen is a suite
# people stop running while they work. xvfb keeps them out of the way; set
# ORRERY_HEADED=1 when watching them is the point.
#
# WAYLAND_DISPLAY is dropped along the way. xvfb-run sets DISPLAY at a virtual X
# server, but Electron 36 and later default to "use Wayland if WAYLAND_DISPLAY
# is set" — so on any Wayland desktop the app ignored that DISPLAY, connected to
# the real compositor, and opened its windows on the screen of whoever was
# working on the machine. With the variable gone there is no compositor to find.
set -euo pipefail

export ORRERY_E2E_WRAPPED=1

if [[ "${ORRERY_HEADED:-}" == "1" ]] || ! command -v xvfb-run >/dev/null 2>&1; then
  exec npx playwright test "$@"
fi
unset WAYLAND_DISPLAY
exec xvfb-run -a npx playwright test "$@"
