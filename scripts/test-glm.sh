#!/usr/bin/env bash
# Exercise the installed editor with real Ollama GLM in an isolated Python project.
set -euo pipefail
ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
RUN_DIR="$(mktemp -d /tmp/my-editor-glm.XXXXXX)"
SUITE="${MY_EDITOR_GLM_SUITE:-glm}"
[[ "${SUITE}" == "glm" || "${SUITE}" == "glmAssistance" ]] || { echo 'Unknown GLM test suite' >&2; exit 2; }
mkdir -p "${RUN_DIR}/project" "${RUN_DIR}/user/User"
cat > "${RUN_DIR}/user/User/settings.json" <<'JSON'
{"security.workspace.trust.enabled":false,"workbench.startupEditor":"none","window.restoreWindows":"none"}
JSON
export MY_EDITOR_INTEGRATION_REPORT="${RUN_DIR}/report.json"
echo "GLM test report: ${MY_EDITOR_INTEGRATION_REPORT}"
"/Applications/my_editor.app/Contents/MacOS/my_editor" \
  --user-data-dir="${RUN_DIR}/user" --extensions-dir="${RUN_DIR}/extensions" \
  --disable-extensions --skip-welcome --skip-release-notes --use-inmemory-secretstorage \
  --extensionDevelopmentPath="/Applications/my_editor.app/Contents/Resources/app/extensions/my-editor-core" \
  --extensionTestsPath="${ROOT}/overlay/extensions/my-editor-core/test/integration/${SUITE}.cjs" \
  --enable-proposed-api=my-editor.my-editor-core "${RUN_DIR}/project"
python3 - "${MY_EDITOR_INTEGRATION_REPORT}" <<'PY'
import json, pathlib, sys
report_path = pathlib.Path(sys.argv[1])
report = json.loads(report_path.read_text())
summary = {key: report.get(key) for key in ('passed', 'model', 'checks', 'error')}
summary['modelRequests'] = len(report['requests'])
report_path.with_name('summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary, indent=2))
if not report['passed']:
    raise SystemExit(1)
PY
