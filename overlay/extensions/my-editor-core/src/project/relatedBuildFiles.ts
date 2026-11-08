import type { BuildGuideState } from './buildStore';
import type { ProjectBuildState } from './projectBuild';
import { passSource } from './filePassSource';
import { existingImplementation } from './filePassWorkflow';

/** Keep each generation batch in one module and respect per-file review cadence. */
export async function relatedBuildFiles(state: ProjectBuildState, guide: BuildGuideState, path: string): Promise<string[]> {
	const options = state.options;
	if (options?.kind !== 'Build' || state.phase === 'qa' || options.batchSize !== 3 || options.selected || options.interval === 'file') { return [path]; }
	const group = state.modules?.find(group => group.files.includes(path));
	if (!group) { return [path]; }
	const repair = state.repairQueue?.find(item => item.path === path);
	const candidates = repair ? state.repairQueue!.filter(item => item.origin === repair.origin && group.files.includes(item.path)).map(item => item.path)
		: group.files.slice(group.files.indexOf(path)).filter(name => !state.results?.some(result => result.path === name));
	const selected = [path];
	for (const name of candidates) {
		if (name === path) { continue; }
		const file = guide.files.find(file => file.path === name);
		const source = await passSource(guide.root, name);
		if (!repair && file && existingImplementation(file, source.source, source.hash)) { continue; }
		selected.push(name);
		if (selected.length === 3) { break; }
	}
	return selected;
}
