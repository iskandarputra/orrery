#!/usr/bin/env bash
#
# Orrery — one entry point for the things you do to this project.
#
#   ./orrery.sh setup     install everything the project needs
#   ./orrery.sh doctor    report what is present and what is missing
#   ./orrery.sh dev       run the app
#   ./orrery.sh check     lint, typecheck and unit tests (what CI runs)
#   ./orrery.sh e2e       end-to-end tests, headless if there is no display
#   ./orrery.sh package   build installers
#
# Run it with no arguments for the full list.
set -euo pipefail
cd "$(dirname "$0")"

# rustup installs to ~/.cargo/bin and adds it to PATH through the shell profile,
# which a non-interactive shell never sources. Look there before deciding Rust
# is absent.
[[ -d "$HOME/.cargo/bin" ]] && export PATH="$HOME/.cargo/bin:$PATH"

if [[ -t 1 ]]; then
  BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RESET=$'\e[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; RESET=''
fi

step() { printf '%s›%s %s\n' "$BOLD" "$RESET" "$*"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
bad()  { printf '  %s✗%s %s\n' "$RED" "$RESET" "$*"; }
die()  { printf '%serror:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# Electron needs a display, and a test suite that takes over yours is a suite
# you stop running while you work. So the virtual display is the default
# wherever xvfb exists: the app opens, is driven, and is never seen.
#
# ORRERY_HEADED=1 puts the windows back on screen, for when watching them is the
# point. ORRERY_XVFB=1 is kept because CI and the docs use it, and it now means
# the same thing as the default.
run_windowed() {
  export ORRERY_E2E_WRAPPED=1
  if [[ "${ORRERY_HEADED:-}" == "1" ]]; then
    [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]] || die "ORRERY_HEADED=1 but there is no display."
    step "on your display (ORRERY_HEADED=1)"
    "$@"
  elif have xvfb-run; then
    step "virtual display, so nothing steals focus"
    # Without this the virtual display is set up and then ignored: Electron 36
    # and later prefer Wayland whenever WAYLAND_DISPLAY is set, so the app went
    # to the real compositor and the windows opened on your screen anyway.
    unset WAYLAND_DISPLAY
    xvfb-run -a "$@"
  elif [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
    warn "xvfb-run is missing — windows will open on your display"
    "$@"
  else
    die "no display and no xvfb-run. Run './orrery.sh setup' first."
  fi
}

# --- commands ---------------------------------------------------------------

cmd_doctor() {
  step "toolchain"
  have node   && ok "node      $(node --version)"          || bad "node      missing"
  have npm    && ok "npm       $(npm --version)"           || bad "npm       missing"
  have cargo  && ok "cargo     $(cargo --version | cut -d' ' -f2)" \
              || warn "cargo     missing — the Rust sidecar will be skipped"
  have git    && ok "git       $(git --version | cut -d' ' -f3)" || bad "git       missing"

  step "end-to-end prerequisites"
  if [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
    ok "display   present"
  elif have xvfb-run; then
    ok "xvfb-run  present (no display, will run virtual)"
  else
    warn "no display and no xvfb-run — './orrery.sh e2e' cannot run"
  fi

  step "workspace"
  [[ -d node_modules ]] && ok "node_modules installed" || warn "node_modules missing — run setup"
  if [[ -x native/target/release/orrery-sidecar ]]; then
    ok "sidecar built ($(du -h native/target/release/orrery-sidecar | cut -f1))"
  else
    warn "sidecar not built — search uses the TypeScript path"
  fi
}

cmd_setup() {
  step "system packages for Electron and headless tests"
  local pkgs=(xvfb libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils)
  local missing=()
  for p in "${pkgs[@]}"; do
    dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p")
  done
  if [[ ${#missing[@]} -eq 0 ]]; then
    ok "all present"
  elif have apt-get; then
    warn "installing: ${missing[*]}"
    # Interactive on purpose: sudo will prompt in your terminal.
    sudo apt-get update && sudo apt-get install -y "${missing[@]}"
    ok "installed"
  else
    warn "not a Debian/Ubuntu system — install by hand: ${missing[*]}"
  fi

  step "node dependencies"
  npm install
  ok "installed"

  step "rust toolchain (optional — powers the search sidecar)"
  if have cargo; then
    ok "already present ($(cargo --version | cut -d' ' -f2))"
  else
    warn "installing rustup"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --profile minimal --default-toolchain stable
    export PATH="$HOME/.cargo/bin:$PATH"
    ok "installed — open a new shell, or run: . \"\$HOME/.cargo/env\""
  fi

  step "done"
  cmd_doctor
}

cmd_dev()     { npm run dev; }
cmd_build()   { npm run build; }
cmd_native()  { bash scripts/build-native.sh; }

cmd_check() {
  step "format";    npm run format:check
  step "lint";      npm run lint
  step "typecheck"; npm run typecheck
  step "unit";      npx vitest run --maxWorkers=1
  ok "all checks passed"
}

cmd_test() {
  step "unit"; npx vitest run --maxWorkers=1
  if have cargo; then
    step "cargo"; ( cd native && cargo test )
  else
    warn "cargo missing — skipping the Rust tests"
  fi
}

cmd_e2e() {
  step "build"; npm run build
  step "e2e"
  # `--` lets you pass a spec through: ./orrery.sh e2e e2e/smoke.spec.ts
  run_windowed npx playwright test --reporter=line "$@"
}

cmd_e2e_rust() {
  have cargo || die "cargo is required for the Rust path. Run './orrery.sh setup'."
  step "build";  npm run build
  step "native"; bash scripts/build-native.sh
  step "e2e with the Rust sidecar"
  ORRERY_RUST_SEARCH=1 run_windowed npx playwright test --reporter=line "$@"
}

cmd_package() {
  step "checks"; cmd_check
  step "native";  bash scripts/build-native.sh
  step "build";   npm run build
  step "package"; npx electron-builder --linux "${1:-deb}"
  ls -1sh dist/*.deb dist/*.AppImage 2>/dev/null || true
}

cmd_clean() {
  step "removing build output"
  rm -rf out dist resources/sidecar native/target test-results
  ok "clean (node_modules kept — use 'npm ci' to rebuild it)"
}

usage() {
  cat <<USAGE
${BOLD}orrery.sh${RESET} — project tasks

  ${BOLD}setup${RESET}      install system packages, node modules and the Rust toolchain
  ${BOLD}doctor${RESET}     report what is present and what is missing
  ${BOLD}dev${RESET}        run the app in development
  ${BOLD}build${RESET}      build the app into out/
  ${BOLD}native${RESET}     build the Rust search sidecar
  ${BOLD}check${RESET}      lint, typecheck and unit tests — what CI's first job runs
  ${BOLD}test${RESET}       unit tests, plus cargo tests when Rust is installed
  ${BOLD}e2e${RESET}        end-to-end tests (add a path to run one spec)
  ${BOLD}e2e:rust${RESET}   end-to-end tests against the Rust sidecar
  ${BOLD}package${RESET}    build an installer (deb by default, or: package AppImage)
  ${BOLD}clean${RESET}      remove build output

${DIM}e2e runs on a virtual display so the windows never take your focus.
Set ORRERY_HEADED=1 to watch them instead — that is
exactly what CI does, so it is how you rehearse a CI failure locally.${RESET}
USAGE
}

case "${1:-}" in
  setup)     shift; cmd_setup "$@" ;;
  doctor)    shift; cmd_doctor "$@" ;;
  dev)       shift; cmd_dev "$@" ;;
  build)     shift; cmd_build "$@" ;;
  native)    shift; cmd_native "$@" ;;
  check)     shift; cmd_check "$@" ;;
  test)      shift; cmd_test "$@" ;;
  e2e)       shift; cmd_e2e "$@" ;;
  e2e:rust)  shift; cmd_e2e_rust "$@" ;;
  package)   shift; cmd_package "$@" ;;
  clean)     shift; cmd_clean "$@" ;;
  ''|-h|--help|help) usage ;;
  *) printf '%sunknown command:%s %s\n\n' "$RED" "$RESET" "$1" >&2; usage; exit 1 ;;
esac
