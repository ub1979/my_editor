#!/usr/bin/env bash
# Builds my_editor for macOS on this machine's architecture.
#
#   scripts/build.sh            full build (fresh VS Code source)
#   scripts/build.sh --reuse    reuse ./vscodium/vscode, re-apply patches (faster, skips the clone)
set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
REUSE="no"
[[ "${1:-}" == "--reuse" ]] && REUSE="yes"

"${ROOT}/scripts/fetch-vscodium.sh"

# --- 1. Built-in extensions: compile, then stage into VSCodium's source overlay
for ext in "${ROOT}"/overlay/extensions/*/; do
  name="$( basename "${ext}" )"
  echo "Compiling built-in extension ${name}"
  if jq -e '.scripts.compile' "${ext}/package.json" >/dev/null; then
    ( cd "${ext}" && npm install --silent && npm run -s compile )
  fi
  dest="${ROOT}/vscodium/src/stable/extensions/${name}"
  mkdir -p "${dest}"
  rsync -a --delete --exclude node_modules --exclude src --exclude '*.map' --exclude tsconfig.json "${ext}" "${dest}/"
done

# --- 2. Resource overrides (app icon, empty-editor mark): overlay/src mirrors vscodium/src/stable
rsync -a "${ROOT}/overlay/src/" "${ROOT}/vscodium/src/stable/"

# --- 3. Core patches
shopt -s nullglob
for patch in "${ROOT}"/overlay/patches/*.patch; do
  cp "${patch}" "${ROOT}/vscodium/patches/user/"
done
shopt -u nullglob

# --- 4. Branding: our product.json wins over VSCodium's
cd "${ROOT}/vscodium"
jq -s '.[0] * .[1]' product.json "${ROOT}/overlay/product.json" > product.json.tmp && mv product.json.tmp product.json

# --- 5. Build (mirrors vscodium/dev/build.sh with our names)
# VSCodium scripts read unset variables, so relax nounset from here on.
set +u
export APP_NAME="my_editor"
export BINARY_NAME="my_editor"
export ORG_NAME="my_editor"
export ASSETS_REPOSITORY="my-editor/my_editor"
export GH_REPO_PATH="my-editor/my_editor"
export CI_BUILD="no"
export SHOULD_BUILD="yes"
export SHOULD_BUILD_REH="no"
export SHOULD_BUILD_REH_WEB="no"
export SHOULD_BUILD_CLI="no"
export VSCODE_QUALITY="stable"
export VSCODE_LATEST="no"
export VSCODE_SKIP_NODE_VERSION_CHECK="yes"
export OS_NAME="osx"
export VSCODE_ARCH="$( [[ "$( uname -m )" == "arm64" ]] && echo arm64 || echo x64 )"
export NODE_OPTIONS="--max-old-space-size=8192"

if [[ "${REUSE}" == "yes" && -d vscode/.git ]]; then
  . dev/build.env
  export MS_TAG MS_COMMIT RELEASE_VERSION BUILD_SOURCEVERSION
  ( cd vscode && git add . && git reset -q --hard HEAD && rm -rf .build out* )
else
  rm -rf vscode VSCode*
  . get_repo.sh
  . version.sh
  {
    echo "MS_TAG=\"${MS_TAG}\""
    echo "MS_COMMIT=\"${MS_COMMIT}\""
    echo "RELEASE_VERSION=\"${RELEASE_VERSION}\""
    echo "BUILD_SOURCEVERSION=\"${BUILD_SOURCEVERSION}\""
  } > dev/build.env
fi

. build.sh

# --- 6. Put the finished app somewhere simple; it is self-contained and runs from anywhere
mkdir -p "${ROOT}/app"
rsync -a --delete "${ROOT}/vscodium/VSCode-darwin-${VSCODE_ARCH}/my_editor.app/" "${ROOT}/app/my_editor.app/"

# --- 7. Language support (Python, Rust, Go, C/C++): pinned in overlay/bundled-extensions.json, verified, built in
python3 "${ROOT}/scripts/fetch-extensions.py" "${ROOT}/vscodium/.bundled-staging"
rsync -a "${ROOT}/vscodium/.bundled-staging/" "${ROOT}/app/my_editor.app/Contents/Resources/app/extensions/"

echo
echo "Built: ${ROOT}/app/my_editor.app"
echo "Install it with scripts/install.sh, or run it with scripts/run.sh [folder]"
