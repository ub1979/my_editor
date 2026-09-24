import * as vscode from 'vscode';
import { queryTerms } from '../project/relevance';
import { compactInvestigation, InvestigationRecord } from './investigationRecord';

function validRecord(value: unknown): value is InvestigationRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) { return false; }
	const record = value as Record<string, unknown>;
	return typeof record.id === 'string' && typeof record.at === 'string'
		&& typeof record.question === 'string' && typeof record.answer === 'string'
		&& Array.isArray(record.evidence)
		&& record.evidence.every(item => item && typeof item === 'object'
			&& typeof item.tool === 'string' && typeof item.subject === 'string');
}

function root(): vscode.Uri | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function day(at: string): string { return at.slice(0, 10); }

export async function saveInvestigation(record: InvestigationRecord): Promise<void> {
	const project = root();
	if (!project || !/^[a-f0-9]{12}$/.test(record.id)) { return; }
	try { await vscode.workspace.fs.stat(vscode.Uri.joinPath(project, '.my_editor')); }
	catch { return; }
	const dir = vscode.Uri.joinPath(project, '.my_editor', 'investigations', day(record.at));
	await vscode.workspace.fs.createDirectory(dir);
	await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, `${record.at.replace(/[:.]/g, '-')}-${record.id}.json`),
		new TextEncoder().encode(JSON.stringify(compactInvestigation(record), null, 2) + '\n'));
}

/** Prior reports orient the next turn; their claims stay labelled as unverified until source is rechecked. */
export async function recentInvestigationContext(question: string): Promise<string> {
	const project = root();
	if (!project) { return ''; }
	const terms = queryTerms(question);
	const base = vscode.Uri.joinPath(project, '.my_editor', 'investigations');
	let dates: [string, vscode.FileType][];
	try { dates = await vscode.workspace.fs.readDirectory(base); } catch { return ''; }
	const records: InvestigationRecord[] = [];
	for (const [folder, type] of dates.filter(([, type]) => type === vscode.FileType.Directory).sort().reverse().slice(0, 2)) {
		const dir = vscode.Uri.joinPath(base, folder);
		let files: [string, vscode.FileType][];
		try { files = await vscode.workspace.fs.readDirectory(dir); } catch { continue; }
		for (const [name, kind] of files.filter(([name, kind]) => kind === vscode.FileType.File && name.endsWith('.json')).sort().reverse().slice(0, 20)) {
			try {
				const uri = vscode.Uri.joinPath(dir, name);
				if ((await vscode.workspace.fs.stat(uri)).size > 40_000) { continue; }
				const value: unknown = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
				if (validRecord(value)) { records.push(value); }
			}
			catch { /* A damaged entry cannot become model context. */ }
		}
	}
	const ranked = records.map(record => ({ record,
		score: terms.filter(term => `${record.question} ${record.answer}`.toLowerCase().includes(term)).length,
	})).sort((a, b) => b.score - a.score || b.record.at.localeCompare(a.record.at));
	return ranked.slice(0, 3).map(({ record }) =>
		`Earlier investigation ${record.at} (assistant report; verify against current source):\nQuestion: ${record.question.slice(0, 350)}\nReport: ${record.answer.slice(0, 900)}\nHost checks: ${record.evidence.map(item => `${item.tool}(${item.subject})`).slice(0, 12).join(', ') || '(none)'}`,
	).join('\n\n').slice(0, 4_500);
}
