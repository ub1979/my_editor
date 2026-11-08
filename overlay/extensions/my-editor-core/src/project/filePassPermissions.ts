import * as vscode from 'vscode';
import { discoverVerification } from './verificationDiscovery';

/** Approval names the execution scope, including tests that do not exist at setup time. */
export async function authorizeUnattended(root: vscode.Uri, files: readonly string[]): Promise<boolean> {
	const tasks = (await discoverVerification(root, files)).checks;
	const detected = tasks.length ? tasks.slice(0, 3).map(task => `${task.command} in ${task.directory || '.'}`).join('; ')
		+ (tasks.length > 3 ? `; and ${tasks.length - 3} more detected commands` : '') : 'No checks detected yet; generated scripts are included.';
	const choice = await vscode.window.showQuickPick([
		{ label: 'Allow unattended run', description: 'Save files + new tests + QA repairs + build/type/lint/test checks',
			detail: 'Includes detected build, typecheck, lint and test commands and newly created or changed scripts. No Keep or check-selection prompts. Finish only after required checks pass. Detected: ' + detected },
		{ label: 'Cancel', detail: 'Leave permissions unchanged.' },
	], { title: 'Authorize unattended run',
		placeHolder: `${root.fsPath} — this run only. Project tests execute project code with your account permissions.`,
		ignoreFocusOut: true });
	return choice?.label === 'Allow unattended run';
}
