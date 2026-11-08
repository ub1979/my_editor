import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import * as path from 'path';
import type * as vscode from 'vscode';
import { checkedProjectPath } from '../chat/projectPath';
import type { ProjectBuildState } from './projectBuild';

export function filePassReport(state: ProjectBuildState): string {
	const rows = (state.results ?? []).map(row => `## ${row.path}\n\n${row.note}`);
	const tests = state.testHistory?.length ? state.testHistory.join('\n') : 'No test execution was recorded for this run.';
	const ordering = state.dependencyRequests?.length ? ['## Dependency order', ...state.dependencyRequests.map(item =>
		`Built planned dependencies before ${item.path}: ${item.dependencies.join(', ')}`)] : [];
	const built = state.buildResults ? ['## Implementation stage', ...state.buildResults.map(row => `### ${row.path} (${row.outcome})\n\n${row.note}`)] : [];
	const repairs = state.repairHistory?.length ? ['## Coordinated repairs', ...state.repairHistory.map(item =>
		`Before ${item.origin}: ${item.files.map(file => `${file.path}: ${file.reason}`).join('; ')}\n\nDecision (${item.decision.source}): ${item.decision.quote}`)] : [];
	const additions = state.repairAdditions?.length ? ['## Approved supporting files', ...state.repairAdditions.map(file => `${file.path}: ${file.reason}`)] : [];
	const retries = state.testRepairs?.length ? ['## Test-driven repair rounds', ...state.testRepairs.map((round, index) =>
		`Round ${index + 1}: ${round.commandId ?? 'Legacy batch'} — ${round.verified === true ? 'focused checks passed' : 'not verified passing'}\n`
		+ round.files.map(file => `${file.path}: ${file.reason}`).join('; ') + '\n'
		+ (round.verification ?? []).map(check => `${check.status}: ${check.name} — ${check.output ?? 'no log'}`).join('\n'))] : [];
	return [`# ${state.phase === 'qa' ? 'Build and QA' : state.options?.kind ?? 'Build'} file results`,
		`${rows.length} of ${state.total} files ${state.phase === 'build' ? 'processed; QA pending' : 'reviewed'}.`,
		state.message, ...ordering, ...repairs, ...additions, ...retries, ...built, ...rows, '## Test execution', tests,
		'## Verification scope', 'Executed build/type/lint/test commands and their logs are recorded above. Saved edits and model reviews are not passing checks. An exit code of zero does not establish that skipped cases, browser flows, live integrations or deployment were verified. Checks without detected commands remain unverified. Inspect runner summaries and saved logs for actual coverage.'].join('\n\n') + '\n';
}

/** Each finished QA run gets its own report, including checks skipped or executed at checkpoints. */
export async function saveQAReport(root: vscode.Uri, state: ProjectBuildState): Promise<string> {
	const relative = `.my_editor/qa/${new Date().toISOString().slice(0, 10)}-${randomUUID()}-file-review.md`;
	const target = checkedProjectPath(root.fsPath, relative, true);
	await fs.mkdir(path.dirname(target), { recursive: true });
	await fs.writeFile(checkedProjectPath(root.fsPath, relative, true), filePassReport(state), { flag: 'wx' });
	return relative;
}
