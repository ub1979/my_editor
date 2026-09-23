import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { readMap } from '../brain/brain';
import { queryTerms, rankPaths } from './relevance';
import { CommitRecord, parseCommits } from './commitParse';
import { parseTree } from './stubs';
import { redact } from '../records/redact';
import { isSensitiveFile } from '../records/sensitive';

function git(cwd: string, args: readonly string[]): Promise<string> {
	return new Promise(resolve => execFile('git', [...args], { cwd, timeout: 5000, maxBuffer: 2_000_000 }, (error, stdout) => resolve(error ? '' : stdout)));
}

/** Reads Git metadata on demand; the repository remains the full, durable commit record. */
export async function changeContext(question: string, currentFile?: string, detailed = false): Promise<string> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root || root.scheme !== 'file') { return 'No local Git project is open.'; }
	const cwd = root.fsPath;
	const map = await readMap();
	let planned: ReturnType<typeof parseTree> = [];
	try { planned = parseTree(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, '.my_editor', 'specs', 'tree.json')))); } catch { /* No file plan yet. */ }
	const planByPath = new Map(planned.map(file => [file.path, file]));
	const terms = queryTerms(question);
	const ranked = map ? rankPaths(map.files, terms, entry => [entry.summary, entry.role, entry.note].filter(Boolean).join(' ')) : [];
	const namedPath = question.match(/\b[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+\.[a-zA-Z0-9]+\b/)?.[0];
	const focus = namedPath && !namedPath.split('/').includes('..') ? namedPath : currentFile || ranked[0];
	const asksImpact = /\b(impact|affect|change|changing|modify|refactor|remove|delete|future)\b/i.test(question);
	const asksHistory = /\b(commit|commits|history|changed|change|why|regression|broke|introduced)\b/i.test(question);
	const subjectTerm = asksHistory ? (question.toLowerCase().match(/[a-z][a-z0-9_]{3,}/g) ?? []).find(word => !/^(commit|commits|history|changed|change|when|what|which|where|why|that|this|file|project|about|introduced)$/.test(word)) : undefined;
	const [head, branch, status, recentOutput, focusedOutput, subjectOutput, diffStat, focusedDiff] = await Promise.all([
		git(cwd, ['rev-parse', '--short', 'HEAD']),
		git(cwd, ['status', '--short', '--branch']),
		git(cwd, ['status', '--short', '--untracked-files=normal']),
		git(cwd, ['log', `-n${detailed ? 12 : 4}`, '--date=short', '--format=COMMIT%x09%h%x09%ad%x09%s', '--name-only']),
		focus ? git(cwd, ['log', '--all', '-n4', '--date=short', '--format=COMMIT%x09%h%x09%ad%x09%s', '--name-only', '--', focus]) : Promise.resolve(''),
		subjectTerm ? git(cwd, ['log', '--all', '-n4', `--grep=${subjectTerm}`, '--date=short', '--format=COMMIT%x09%h%x09%ad%x09%s', '--name-only']) : Promise.resolve(''),
		detailed ? git(cwd, ['diff', 'HEAD', '--stat']) : Promise.resolve(''),
		asksHistory && focus && !isSensitiveFile(focus) ? git(cwd, ['diff', 'HEAD', '--', focus]) : Promise.resolve(''),
	]);
	if (!head.trim() && !status.trim() && !recentOutput.trim()) { return 'This project has no readable Git history.'; }
	const commits = parseCommits(recentOutput);
	const focused = parseCommits(focusedOutput).filter(commit => !commits.some(recent => recent.hash === commit.hash));
	const bySubject = parseCommits(subjectOutput).filter(commit => ![...commits, ...focused].some(other => other.hash === commit.hash));
	const changed = status.split('\n').filter(Boolean).map(line => line.slice(3).split(' -> ').pop() ?? '').filter(Boolean);
	const impact = new Set<string>();
	const requirements = new Set<string>();
	const sections = new Set<string>();
	for (const path of changed) {
		for (const importer of map?.files[path]?.importedBy ?? []) { impact.add(importer); }
		for (const id of planByPath.get(path)?.requirements ?? []) { requirements.add(id); }
		const section = planByPath.get(path)?.section;
		if (section) { sections.add(section); }
	}
	const format = (commit: CommitRecord) => {
		const downstream = new Set(commit.paths.flatMap(path => map?.files[path]?.importedBy ?? []));
		return `- ${commit.hash} ${commit.date} ${commit.subject}${detailed && commit.paths.length ? `\n  Files: ${commit.paths.slice(0, 8).join(', ')}${commit.paths.length > 8 ? ` (+${commit.paths.length - 8} more)` : ''}` : ''}${detailed && downstream.size ? `\n  Possible downstream: ${[...downstream].slice(0, 8).join(', ')}` : ''}`;
	};
	const focusedPlan = focus ? planByPath.get(focus) : undefined;
	const directImporters = focus ? map?.files[focus]?.importedBy ?? [] : [];
	return redact([
		`Git HEAD: ${head.trim()}`,
		branch.trim() ? `Branch: ${branch.split('\n')[0].replace(/^##\s*/, '')}` : '',
		`Working tree: ${status.trim() ? changed.slice(0, detailed ? 30 : 10).join(', ') + (changed.length > (detailed ? 30 : 10) ? ` (+${changed.length - (detailed ? 30 : 10)} more)` : '') : 'clean'}`,
		diffStat.trim() ? `Tracked edit sizes:\n${diffStat.slice(0, 2000)}` : '',
		focusedDiff.trim() ? `Uncommitted diff for ${focus} (excerpt):\n${focusedDiff.slice(0, 6000)}` : '',
		impact.size ? `Possible downstream files for current edits (brain import graph): ${[...impact].slice(0, 20).join(', ')}` : '',
		requirements.size ? `Requirements linked to current edits: ${[...requirements].join(', ')}` : '',
		sections.size ? `Architecture sections linked to current edits: ${[...sections].map(section => `#${section}`).join(', ')}` : '',
		asksImpact && focus ? `If ${focus} changes: direct importers: ${directImporters.slice(0, 15).join(', ') || '(none recorded)'}; linked requirements: ${focusedPlan?.requirements?.join(', ') || '(none recorded)'}; architecture section: ${focusedPlan?.section ? `#${focusedPlan.section}` : '(none recorded)'}. This is a dependency hint, not a prediction of runtime behavior.` : '',
		`Recent commits:\n${commits.map(format).join('\n') || '(none)'}`,
		focused.length ? `Other commits touching ${focus} (all refs):\n${focused.map(format).join('\n')}` : '',
		bySubject.length ? `Earlier commits with “${subjectTerm}” in the subject:\n${bySubject.map(format).join('\n')}` : '',
		'Git history records what changed; the import graph suggests affected files, but runtime effects still need review and tests.',
	].filter(Boolean).join('\n\n'));
}
