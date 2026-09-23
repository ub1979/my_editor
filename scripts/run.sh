#!/usr/bin/env bash
# Opens the built my_editor app, optionally on a folder: scripts/run.sh [folder]
set -euo pipefail
ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
APP="${ROOT}/vscodium/VSCode-darwin-$( [[ "$( uname -m )" == "arm64" ]] && echo arm64 || echo x64 )/my_editor.app"
[[ -d "${APP}" ]] || { echo "Not built yet. Run scripts/build.sh first." >&2; exit 1; }
open -a "${APP}" "$@"
