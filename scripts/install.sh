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
      rsync -a --delete --exclude node_modules --exclude __pycache__ --exclude src --exclude '*.map' --exclude tsconfig.json "${ext}" "${dest}/"
    done
    # The editor reuses its cached list of built-in extensions while this folder's mtime is unchanged, so an update
    # inside it would keep the old manifests (and versions) until the next change; touching it invalidates the cache.
    touch "${APP}/Contents/Resources/app/extensions"
    # Refresh product configuration, including the built-in extension's editor inset capability.
    product="${APP}/Contents/Resources/app/product.json"
    jq -s '.[0] * .[1]' "${product}" "${ROOT}/overlay/product.json" > "${product}.tmp"
    mv "${product}.tmp" "${product}"
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
