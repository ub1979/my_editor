import * as vscode from 'vscode';
import { posix } from 'path';
import type { PassModule } from './filePassPlan';
import type { RepairRequest, RepairSpec } from './filePassRepairs';
import { companionTest, eligibleFile } from './filePassPolicy';

/** A new supporting file needs exact run-scoped approval, never implicit plan mutation. */
export function repairScope(request: RepairRequest, modules: readonly PassModule[], planned: readonly string[], approved: readonly RepairSpec[], qaTests: readonly string[] = []) {
	const known = new Set([...planned, ...modules.flatMap(group => group.files), ...approved.map(file => file.path)]);
	const groups = modules.map(group => ({ ...group, files: [...group.files] }));
	// Whole-project QA already authorizes existing source. Tests created after its
	// initial discovery may be requested later; discover them again, never trust a
	// model claim that an arbitrary existing file is an approved companion test.
	const discoveredTests = new Set(qaTests.filter(path => eligibleFile(path) && companionTest(path)));
	const additions: RepairSpec[] = [];
	for (const file of request.files) {
		if (!eligibleFile(file.path)) { throw new Error(`Unsafe repair path: ${file.path}`); }
		if (known.has(file.path)) { continue; }
		if (discoveredTests.has(file.path)) {
			let group = groups.find(group => group.title === 'Other project source');
			if (!group) { group = { title: 'Other project source', files: [] }; groups.push(group); }
			group.files.push(file.path); known.add(file.path); continue;
		}
		const directory = posix.dirname(file.path);
		const owners = groups.filter(group => group.files.some(path => known.has(path) && posix.dirname(path) === directory));
		// QA discovery groups are inventories, not competing architectural owners.
		// Prefer the sole saved-plan owner, retaining ambiguity checks for real modules.
		const plannedOwners = owners.filter(group => group.files.some(path => planned.includes(path) && posix.dirname(path) === directory));
		const owner = plannedOwners.length === 1 ? plannedOwners[0] : owners.length === 1 ? owners[0] : undefined;
		if (!owner) { throw new Error(`The new repair file ${file.path} must be beside files in one selected module. Add it to the saved plan first.`); }
		owner.files.push(file.path); additions.push(file);
	}
	return { modules: groups, planned: [...known, ...additions.map(file => file.path)], additions };
}

export async function approveRepairAdditions(additions: readonly RepairSpec[], automaticCompanionTests = false): Promise<boolean> {
	// New tests already fall within the run's companion-test permission. Production
	// supporting files still need an exact scope review, including in unattended mode.
	const needsApproval = additions.filter(file => !automaticCompanionTests || !companionTest(file.path));
	if (!needsApproval.length) { return true; }
	const choice = await vscode.window.showWarningMessage('Add supporting files to this repair run?', {
		modal: true, detail: needsApproval.map(file => `${file.path}\n${file.reason}`).join('\n\n')
			+ '\n\nThese exact files join this run and its later QA. Each is built separately using your current saving settings. The saved project plan is unchanged.',
	}, 'Add files and continue');
	return choice === 'Add files and continue';
}
