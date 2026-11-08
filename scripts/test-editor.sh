#!/usr/bin/env bash
# Run editor-host tests in disposable user data and a disposable project, with a local model fixture.
set -euo pipefail
ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
RUN_DIR="$(mktemp -d /tmp/my-editor-integration.XXXXXX)"
mkdir -p "${RUN_DIR}/project" "${RUN_DIR}/user/User"
cat > "${RUN_DIR}/user/User/settings.json" <<'JSON'
{"security.workspace.trust.enabled":false,"workbench.startupEditor":"none","window.restoreWindows":"none"}
JSON
if [[ "${MY_EDITOR_INTEGRATION_SUITE:-}" == "openCode" ]]; then
  jq '. + {"myEditor.projectAgents.runtime":"opencode"}' "${RUN_DIR}/user/User/settings.json" > "${RUN_DIR}/settings.json"
  mv "${RUN_DIR}/settings.json" "${RUN_DIR}/user/User/settings.json"
fi
export MY_EDITOR_INTEGRATION_REPORT="${RUN_DIR}/report.json"
[[ "${1:-}" == "--save-gate" ]] && export MY_EDITOR_ASSERT_SAVE_GATE=1
"${ROOT}/app/my_editor.app/Contents/MacOS/my_editor" \
  --user-data-dir="${RUN_DIR}/user" --extensions-dir="${RUN_DIR}/extensions" \
  --disable-extensions --skip-welcome --skip-release-notes --use-inmemory-secretstorage \
  --extensionDevelopmentPath="${ROOT}/overlay/extensions/my-editor-core" \
  --extensionTestsPath="${ROOT}/overlay/extensions/my-editor-core/test/integration/${MY_EDITOR_INTEGRATION_SUITE:-coding}.cjs" \
  --enable-proposed-api=my-editor.my-editor-core "${RUN_DIR}/project"
cat "${MY_EDITOR_INTEGRATION_REPORT}"
