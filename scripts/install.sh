#!/usr/bin/env bash
# Builds the current source, then installs it into /Applications for Launchpad/Spotlight.
set -euo pipefail
ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
"${ROOT}/scripts/build.sh" --reuse
[[ -d "${ROOT}/app/my_editor.app" ]] || { echo "Build did not produce my_editor.app." >&2; exit 1; }
rsync -a --delete "${ROOT}/app/my_editor.app/" "/Applications/my_editor.app/"
echo "Installed /Applications/my_editor.app"
