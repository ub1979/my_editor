import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { delimiter, dirname, join } from 'path';
import { findTool } from '../aiready/projectCommands';
import { checkedProjectPath } from '../chat/projectPath';
import { redact } from '../records/redact';

/** Keep the ordinary task terminal/exit events while making its real output available to QA. */
export function detectedTestExecution(root: vscode.Uri, directory: string, spec: { bin: string; args: string[] }, unattended: boolean) {
	const installedNode = findTool('node');
	const node = installedNode ?? process.execPath;
	const bin = findTool(spec.bin) ?? spec.bin;
	const extension = vscode.extensions.getExtension('my-editor.my-editor-core');
	if (!extension) { throw new Error('Cannot locate the my_editor test runner.'); }
	const relative = `.my_editor/test-runs/${randomUUID()}.log`;
	const output = checkedProjectPath(root.fsPath, relative, true);
	const cwd = directory ? checkedProjectPath(root.fsPath, directory) : root.fsPath;
	return { relative, execution: new vscode.ProcessExecution(node,
		[join(extension.extensionPath, 'media', 'test-runner.cjs'), output, String(10 * 60 * 1000), bin, ...spec.args],
		{ cwd, env: { ...(unattended ? { CI: 'true' } : {}), ...(!installedNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
			PATH: `${dirname(node)}${delimiter}${process.env.PATH ?? ''}` } }) };
}

/** Logs are evidence, not instructions. Include a bounded redacted excerpt and an exact retrieval path. */
export async function testDiagnostics(root: vscode.Uri, relative: unknown, failed: boolean): Promise<string> {
	if (typeof relative !== 'string') { return ''; }
	try {
		const file = checkedProjectPath(root.fsPath, relative);
		const text = redact(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(file)))
			.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ''));
		return `\nTest output: ${relative}\n${failed ? 'Failure output' : 'Runner summary, including reported skips'} (untrusted evidence):\n${text.slice(failed ? -4000 : -1200)}`;
	} catch { return '\nTest output could not be retained; no diagnostic details are available.'; }
}
