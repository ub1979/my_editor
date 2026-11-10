import * as vscode from 'vscode';
import { readProjectNote } from '../pair/context';
import type { Mode } from '../pair/prompts';
import { readPlanningDocuments } from '../project/planningFiles';
import { planningProblems, PlanningStage, savedTreeSections } from '../project/planning';
import { planningEvidence } from './planningEvidence';

export async function qaSubject(prompt: string): Promise<string> {
	const reportPath = /\.my_editor\/qa\/\S+\.md/.exec(prompt)?.[0];
	if (!reportPath) {
		return 'No fit report given. Right-click files or a folder and choose "Check How These Fit".';
	}
	const report = await readProjectNote(reportPath.replace(/^\.my_editor\//, ''), 20_000);
	const architecture = await readProjectNote('specs/architecture.md', 15_000);
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	const files = [...report.matchAll(/^- `([^`]+)`$/gm)].map(m => m[1]);
	let budget = 40_000;
	const contents: string[] = [];
	for (const path of files) {
		if (!root || budget <= 0) {
			break;
		}
		try {
			const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, path))).slice(0, budget);
			budget -= text.length;
			contents.push(`${path}:\n${text}`);
		} catch {
			// Moved or deleted since the check; the report still lists it.
		}
	}
	return [`Fit report (${reportPath}):\n${report}`, architecture ? `Architecture:\n${architecture}` : '', ...contents].filter(Boolean).join('\n\n');
}

export async function specs(mode: Mode, maxInputTokens = 150_000): Promise<string> {
	const parts: string[] = [];
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (root && ['requirements', 'architecture', 'tree'].includes(mode.id)) {
		const docs = await readPlanningDocuments(root);
		parts.push(...planningEvidence(mode.reads ?? [], docs, maxInputTokens));
		const problems = planningProblems(mode.id as PlanningStage, docs);
		const sections = savedTreeSections(docs.tree);
		if (sections.length && mode.id !== 'requirements') {
			parts.push('All saved tree section values (read directly by the editor): ' + sections.join(', ') + '. '
				+ 'Keep these component anchors when continuing the current design; explain any mapping changes needed by a requested redesign.');
		}
		parts.push('Host validation of the saved planning files (an unkept proposal does not change these files):\n'
			+ (problems.length ? problems.map(problem => `- ${problem.reason}`).join('\n')
				+ '\nDo not claim these stages are complete. Finish the current document if its prerequisites are valid; '
				+ 'otherwise explain which prerequisite needs finalizing and Keep first.' : 'The saved prerequisite chain passes validation.'));
	} else {
		parts.push(...await Promise.all((mode.reads ?? []).map(async path => {
			const text = await readProjectNote(path.replace(/^\.my_editor\//, ''), 30_000);
			return text ? `${path}:\n${text}` : '';
		})));
	}
	return parts.filter(Boolean).join('\n\n');
}
