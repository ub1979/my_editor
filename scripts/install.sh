#!/usr/bin/env bash
# Quickly refreshes built-in extensions in the existing app and installs it.
# Pass --full to rebuild the editor shell and apply core patches first.
set -euo pipefail
ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
APP="${ROOT}/app/my_editor.app"
case "${1:-}" in
  "")
    [[ -d "${APP}" ]] || { echo "No built app. Run scripts/install.sh --full first." >&2; exit 1; }
    for ext in "${ROOT}"/overlay/extensions/*/; do
      name="$( basename "${ext}" )"
      if jq -e '.scripts.compile' "${ext}/package.json" >/dev/null; then
        if [[ ! -d "${ext}/node_modules" ]]; then
          ( cd "${ext}" && npm ci --silent )
        fi
        ( cd "${ext}" && npm run -s compile )
      fi
      dest="${APP}/Contents/Resources/app/extensions/${name}"
      mkdir -p "${dest}"
      rsync -a --delete --exclude node_modules --exclude src --exclude '*.map' --exclude tsconfig.json "${ext}" "${dest}/"
    done
    echo "Updated built-in extensions. Editor core patches require scripts/install.sh --full."
    ;;
  --full)
    "${ROOT}/scripts/build.sh" --reuse
    ;;
  *)
    echo "Usage: scripts/install.sh [--full]" >&2
    exit 2
    ;;
esac
[[ -d "${APP}" ]] || { echo "Build did not produce my_editor.app." >&2; exit 1; }
codesign --force --deep --sign - "${APP}"
codesign --verify --deep --strict "${APP}"
rsync -a --delete "${APP}/" "/Applications/my_editor.app/"
codesign --verify --deep --strict "/Applications/my_editor.app"
echo "Installed /Applications/my_editor.app"
