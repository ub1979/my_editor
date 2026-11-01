import * as vscode from 'vscode';
import { analyseProject, ask } from '../brain/analyse';
import { groupByModule } from '../brain/analysisPlan';
import { BrainMap, describeEntry, readMap, readText } from '../brain/brain';
import type { Sink } from '../chat/engine';
import { Proposals } from '../chat/proposals';
import { loadCatalog, pickDefault } from '../models/catalog';
import { ApiKeys } from '../models/secrets';
import { isSourceFile } from '../quality/sourcePolicy';
import { redact } from '../records/redact';
import { isSensitiveFile } from '../records/sensitive';
import { detectCommands, RootFiles } from './commandDetect';
import { FileStats, fileStats, FindingKind, HealthFinding, scanHealth, testSubject } from './health';
import { DEFAULT_LIMITS, ReviewPart, reviewParts } from './healthReview';
import { fixableFinding } from './languages';
import { renderReport } from './report';

const REPORT_DIR = ['.my_editor', 'ai-ready'];
const REVIEW_TIMEOUT_MS = 180_000;

/** "Check AI-readiness", stage 1: get to know the project, then write its health report (partial if stopped). Code never changes. */
export async function makeAiReady(keys: ApiKeys, proposals: Proposals, sink: Sink, token: vscode.CancellationToken): Promise<void> {
	await analyseProject(keys, proposals, sink, token);
	await writeHealthReport(keys, sink, token);
}

/** Scans the project, has the model review its parts and writes the report; a stop leaves a partial report. */
async function writeHealthReport(keys: ApiKeys, sink: Sink, token: vscode.CancellationToken): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	const map = await readMap();
	const model = pickDefault(await loadCatalog(keys));
	if (!folder || !map || !model) { return; } // Analyse has already said why.
	sink.progress('Checking file sizes, classes and tests…');
	const paths = Object.keys(map.files);
	if (!paths.length) { sink.progress(''); return; }
	const texts = new Map<string, string>();
	for (const path of paths.filter(isSourceFile)) {
		const text = await readText(vscode.Uri.joinPath(folder.uri, path));
		if (text !== undefined) { texts.set(path, text); }
	}
	const stats = [...texts].map(([path, text]) => fileStats(path, text));
	const commands = detectCommands(await rootFiles(folder.uri));
	const notCovered = [
		...(map.tooLarge ?? []).map(path => `${path} is too large to read.`),
		...(map.fileLimitHit ? ['The project has more code files than the brain reads (5,000).'] : []),
	];
	const findings = scanHealth(stats, paths, commands, notCovered);
	const parts = reviewInput(texts, stats, findings, map);
	sink.progress(`Reviewing ${parts.length} part${parts.length === 1 ? '' : 's'} with ${model.label}…`);
	const review = await reviewParts(parts, (system, text) => ask(model, keys, system, text, token, REVIEW_TIMEOUT_MS),
		DEFAULT_LIMITS, () => token.isCancellationRequested);
	const all = [...findings, ...review.findings];
	const dir = vscode.Uri.joinPath(folder.uri, ...REPORT_DIR);
	const uri = vscode.Uri.joinPath(dir, 'report.md');
	try {
		await vscode.workspace.fs.createDirectory(dir);
		await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(renderReport({
			project: folder.name, date: new Date().toISOString().slice(0, 10), model: model.label, stats, findings: all, commands, review,
		})));
	} catch (err) {
		sink.progress('');
		sink.error(`Could not write the health report: ${err instanceof Error ? err.message : String(err)}`);
		return;
	}
	sink.progress('');
	const count = (...kinds: FindingKind[]) => all.filter(f => kinds.includes(f.kind)).length;
	sink.text(`\n\n**Health report** written to \`.my_editor/ai-ready/report.md\`: ${count('too-long')} over 300 lines, `
		+ `${count('many-classes')} with more than one class, ${count('untested')} without tests, ${count('mixed-job', 'design')} design notes `
		+ `and ${count('bug', 'poor-code')} suggestions.${review.partial ? ' I stopped early, so the report is partial.' : ''} Nothing in the code changed.`);
	if (all.some(f => f.file && fixableFinding(f.file, f.kind))) {
		sink.action('Fix on a local branch', 'myEditor.aiReadyFix', []);
	}
	try { await vscode.commands.executeCommand('markdown.showPreview', uri); } catch { await vscode.window.showTextDocument(uri); }
}

/** Non-test, non-secret source grouped by part; the most flagged and largest parts are reviewed first. */
function reviewInput(texts: ReadonlyMap<string, string>, stats: readonly FileStats[], findings: readonly HealthFinding[], map: BrainMap): ReviewPart[] {
	const flagged = new Map<string, number>();
	for (const finding of findings) {
		if (finding.file) { flagged.set(finding.file, (flagged.get(finding.file) ?? 0) + 1); }
	}
	const byPath = new Map(stats.map(s => [s.path, s]));
	const reviewable = [...texts.keys()].filter(path => !isSensitiveFile(path) && testSubject(path) === undefined);
	return [...groupByModule(reviewable)].map(([name, files]) => ({
		name,
		priority: files.reduce((sum, path) => sum + (flagged.get(path) ?? 0) * 100_000 + (byPath.get(path)?.lines ?? 0), 0),
		files: files.map(path => ({
			path, summary: describeEntry(map.files[path]) || undefined, text: redact(texts.get(path) ?? ''),
			focusLines: (byPath.get(path)?.classes ?? []).map(c => c.line),
		})),
	}));
}

/** Names of the top-level entries plus the text of package.json and pyproject.toml, for command detection. */
async function rootFiles(root: vscode.Uri): Promise<RootFiles> {
	let names: string[] = [];
	try { names = (await vscode.workspace.fs.readDirectory(root)).map(([name]) => name); } catch { names = []; }
	return {
		names,
		packageJson: await readText(vscode.Uri.joinPath(root, 'package.json')),
		pyproject: await readText(vscode.Uri.joinPath(root, 'pyproject.toml')),
	};
}
