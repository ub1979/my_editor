#!/usr/bin/env bash
# Checks out VSCodium at the commit pinned in upstream.json into ./vscodium.
set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
REPO="$( jq -r '.vscodium.repo' "${ROOT}/upstream.json" )"
COMMIT="$( jq -r '.vscodium.commit' "${ROOT}/upstream.json" )"

if [[ ! -d "${ROOT}/vscodium/.git" ]]; then
  git clone --quiet "${REPO}" "${ROOT}/vscodium"
fi

cd "${ROOT}/vscodium"
git fetch --quiet origin "${COMMIT}" 2>/dev/null || git fetch --quiet --unshallow origin || true
# Restore tracked files (the overlay edits product.json, patches/user, src/stable); keep ./vscode.
git checkout --quiet --force "${COMMIT}"
git clean --quiet -fd -- patches/user src/stable
echo "VSCodium at $( git rev-parse --short HEAD ) (VS Code $( jq -r '.tag' upstream/stable.json ))"
