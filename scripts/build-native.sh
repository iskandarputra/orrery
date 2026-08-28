#!/usr/bin/env bash
# Build the Rust sidecar and stage it for packaging.
#
# The sidecar is optional: a machine without cargo must still be able to build
# and run the app, so a missing toolchain is reported and skipped, not fatal.
set -euo pipefail
cd "$(dirname "$0")/.."

# rustup installs to ~/.cargo/bin and puts it on PATH through the shell profile,
# which a non-interactive build shell never sources. Look there before giving up.
if ! command -v cargo >/dev/null 2>&1 && [[ -x "$HOME/.cargo/bin/cargo" ]]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo not found — skipping the Rust sidecar."
  echo "The app will use its TypeScript search implementation."
  exit 0
fi

echo "› building orrery-sidecar (release)"
cargo build --release --manifest-path native/Cargo.toml

BIN=orrery-sidecar
[[ "${OS:-}" == "Windows_NT" ]] && BIN=orrery-sidecar.exe

mkdir -p resources/sidecar
cp "native/target/release/$BIN" "resources/sidecar/$BIN"
echo "✓ staged → resources/sidecar/$BIN ($(du -h "resources/sidecar/$BIN" | cut -f1))"
