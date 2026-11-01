#!/usr/bin/env bash
# Test the installed app's inline Python output without a proposed-API command-line override.
set -euo pipefail
RUN_DIR="$(mktemp -d /tmp/my-editor-python-inline.XXXXXX)"
mkdir -p "${RUN_DIR}/project" "${RUN_DIR}/user/User"
cat > "${RUN_DIR}/user/User/settings.json" <<'JSON'
{"security.workspace.trust.enabled":false,"workbench.startupEditor":"none","window.restoreWindows":"none"}
JSON
export MY_EDITOR_INTEGRATION_REPORT="${RUN_DIR}/report.json"
echo "Inline test report: ${MY_EDITOR_INTEGRATION_REPORT}"
EXTENSION="/Applications/my_editor.app/Contents/Resources/app/extensions/my-editor-core"
"/Applications/my_editor.app/Contents/MacOS/my_editor" \
  --user-data-dir="${RUN_DIR}/user" --extensions-dir="${RUN_DIR}/extensions" \
  --disable-extensions --skip-welcome --skip-release-notes --use-inmemory-secretstorage \
  --extensionDevelopmentPath="${EXTENSION}" --extensionTestsPath="${EXTENSION}/test/integration/pythonInline.cjs" \
  "${RUN_DIR}/project"
python3 - "${MY_EDITOR_INTEGRATION_REPORT}" <<'PY'
import json, pathlib, sys
report = json.load(open(sys.argv[1]))
print(json.dumps(report, indent=2))
if not report['passed']:
    raise SystemExit(1)
logs = pathlib.Path(sys.argv[1]).parent / 'user' / 'logs'
for log in logs.rglob('*.log'):
    if 'Unknown inset' in log.read_text(errors='replace'):
        raise SystemExit(f'Native output cleanup failed: {log}')
PY
