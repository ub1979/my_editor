import * as vscode from 'vscode';
import { EXCLUDE_GLOB } from '../brain/brain';
import { readBuildGuide } from './buildStore';
import { buildPlanIdentity } from './buildWork';
import { digest } from './buildProgress';
import { assertPlanningReady, readPlanningDocuments } from './planningFiles';
import { parseTree } from './stubs';
import { eligibleFile } from './filePassPolicy';
import { PassOptions, passTargets } from './filePassPlan';

export async function passIdentity(root: vscode.Uri): Promise<string> {
	const docs = await readPlanningDocuments(root);
	const files = docs.tree ? parseTree(docs.tree) : [];
	const plan = docs.tree && JSON.parse(docs.tree).buildPlan;
	return digest(JSON.stringify([buildPlanIdentity({ files, plan }), docs.requirements, docs.architecture]));
}

export async function passScope(root: vscode.Uri, kind: PassOptions['kind'], selected?: string) {
	const identity = await passIdentity(root);
	const guide = await readBuildGuide(root);
	if (guide.problems.length) { throw new Error(guide.problems.join('\n')); }
	if (!selected && kind === 'Build') { await assertPlanningReady(root, 'tree'); }
	const modules = guide.plan ? guide.steps.map(({ step }) => ({ title: step.title, files: step.files }))
		: guide.files.length ? [{ title: 'Saved file order (module boundaries unplanned)', files: guide.files.map(file => file.path) }] : [];
	if (kind === 'QA' && !selected) {
		const planned = new Set(modules.flatMap(group => group.files));
		const files = await vscode.workspace.findFiles(new vscode.RelativePattern(root,
			'**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py,go,rs,java,kt,kts,c,cc,cpp,h,hpp,cs,swift,rb,php,dart,vue,svelte,css,html,sql,sh}'), EXCLUDE_GLOB);
		const extra = files.map(uri => vscode.workspace.asRelativePath(uri, false)).filter(path => !planned.has(path) && eligibleFile(path)).sort();
		if (extra.length) { modules.push({ title: 'Other project source', files: extra }); }
	}
	const groups = passTargets(modules, selected);
	if (!groups.length) { throw new Error('No files are available. Save the project file tree or select an individual file.'); }
	return { guide, groups, identity };
}
