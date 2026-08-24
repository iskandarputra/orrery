#!/usr/bin/env bash
#
# package.sh — build zymd and produce distributable installers with electron-builder.
#
# Usage:
#   ./scripts/package.sh                 # Linux: .deb + AppImage (default)
#   ./scripts/package.sh deb             # only .deb
#   ./scripts/package.sh appimage        # only AppImage
#   ./scripts/package.sh deb appimage    # both, explicitly
#   ./scripts/package.sh --skip-checks   # skip lint/typecheck/tests (any position)
#
# Output lands in ./dist. Cross-building for mac/win from Linux is not
# supported here — run this on the matching OS, or use CI.
#
set -euo pipefail
cd "$(dirname "$0")/.."

SKIP_CHECKS=0
TARGETS=()
for arg in "$@"; do
  case "$arg" in
    --skip-checks) SKIP_CHECKS=1 ;;
    deb|AppImage|appimage) TARGETS+=("${arg,,}") ;;
    *) echo "unknown argument: $arg" >&2; exit 1 ;;
  esac
done
# Default to both Linux targets.
[[ ${#TARGETS[@]} -eq 0 ]] && TARGETS=(deb appimage)

# Map to electron-builder flags (--linux deb AppImage).
BUILDER_TARGETS=()
for t in "${TARGETS[@]}"; do
  [[ "$t" == "appimage" ]] && BUILDER_TARGETS+=(AppImage) || BUILDER_TARGETS+=("$t")
done

echo "▸ zymd package → ${BUILDER_TARGETS[*]}"

if [[ ! -d node_modules ]]; then
  echo "▸ installing dependencies…"
  npm install
fi

if [[ "$SKIP_CHECKS" -eq 0 ]]; then
  echo "▸ lint…";       npm run lint
  echo "▸ typecheck…";  npm run typecheck
  echo "▸ unit tests…"; npm test
fi

echo "▸ bundling…"
npx electron-vite build

echo "▸ electron-builder…"
npx electron-builder --linux "${BUILDER_TARGETS[@]}"

echo ""
echo "✓ artifacts in ./dist:"
ls -1 dist/*.deb dist/*.AppImage 2>/dev/null || true
