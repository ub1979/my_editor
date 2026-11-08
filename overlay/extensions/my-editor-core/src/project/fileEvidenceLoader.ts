import * as vscode from 'vscode';
import { readMap, EXCLUDE_GLOB } from '../brain/brain';
import { eligibleFile } from './filePassPolicy';
import { readPlanningDocuments } from './planningFiles';
import { parseTree } from './stubs';
import { gatherFileEvidence } from './fileEvidence';
import { evidenceSource, passSource } from './filePassSource';
import { redact } from '../records/redact';
import { digest } from './buildProgress';

export async function loadFileEvidence(root: vscode.Uri, path: string, source: string, token: vscode.CancellationToken) {
	const [map, docs, uris] = await Promise.all([readMap(), readPlanningDocuments(root),
		vscode.workspace.findFiles(new vscode.RelativePattern(root, '**/*'), EXCLUDE_GLOB, 5000)]);
	let files: ReturnType<typeof parseTree> = [];
	try { files = parseTree(docs.tree ?? '[]'); } catch { /* QA can operate without a saved tree. */ }
	const known = new Set([...files.map(file => file.path), ...uris.map(uri => vscode.workspace.asRelativePath(uri, false))].filter(eligibleFile));
	const entry = files.find(file => file.path === path);
	const hints = [...(map?.files[path]?.importedBy ?? []), ...(map?.files[path]?.imports ?? []),
		...files.filter(file => entry?.section && file.section === entry.section).map(file => file.path)];
	const evidence = await gatherFileEvidence(path, source, known, hints, async name => {
		if (token.isCancellationRequested) { throw new Error('Stopped.'); }
		return passSource(root, name);
	});
	if (token.isCancellationRequested) { throw new Error('Stopped.'); }
	return { ...evidence, text: redact(evidence.text) + (uris.length >= 5000
		? '\nWorkspace discovery reached 5000 paths. This bundle is incomplete; use targeted list_files/search to expand it.' : '') };
}

export async function validateFileEvidence(root: vscode.Uri, snapshots: Record<string, string | undefined> = {}) {
	for (const [path, hash] of Object.entries(snapshots)) {
		if ((await evidenceSource(root, path)).hash !== hash) { throw new Error(`${path} changed after dependency context was loaded. Resume to rebuild the context before saving.`); }
	}
}

export function trackFileEvidence(snapshots: Record<string, string | undefined>, targets: readonly string[]) {
	return (path: string, source: string) => {
		if (!targets.includes(path) && eligibleFile(path) && !Object.prototype.hasOwnProperty.call(snapshots, path)) {
			snapshots[path] = digest(source);
		}
	};
}
