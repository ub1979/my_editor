#!/usr/bin/env bash
# Copies the built app into /Applications (replacing an older copy), so it opens from Launchpad/Spotlight.
set -euo pipefail
ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
[[ -d "${ROOT}/app/my_editor.app" ]] || { echo "Not built yet. Run scripts/build.sh first." >&2; exit 1; }
rsync -a --delete "${ROOT}/app/my_editor.app/" "/Applications/my_editor.app/"
echo "Installed /Applications/my_editor.app"
