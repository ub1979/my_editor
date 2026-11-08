import type { PassModule } from './filePassPlan';

export interface DependencyRequest { path: string; dependencies: string[] }

/** A model can request ordering, but cannot expand the user's selected build scope. */
export class PlannedDependencies extends Error {
	constructor(readonly dependencies: string[]) { super(`Build planned dependencies first: ${dependencies.join(', ')}`); }
}

export function requestedDependencies(reply: string): string[] | undefined {
	const match = /^BLOCKED\s*\nDEPENDENCIES_REQUIRED\s+([\s\S]+)$/.exec(reply.trim());
	if (!match) { return undefined; }
	let paths: unknown;
	try { paths = JSON.parse(match[1]); } catch { throw new Error('The model returned an invalid dependency list. Retry the file.'); }
	if (!Array.isArray(paths) || !paths.length || paths.length > 20
		|| paths.some(path => typeof path !== 'string' || !path.trim()) || new Set(paths).size !== paths.length) {
		throw new Error('The model must identify distinct planned dependency paths. Retry the file.');
	}
	return paths;
}

/** Reorder only unfinished files inside one module; its checkpoint and membership stay intact. */
export function prioritizeDependencies(modules: PassModule[], request: DependencyRequest,
	done: readonly string[], history: readonly DependencyRequest[]): PassModule[] {
	const group = modules.find(module => module.files.includes(request.path));
	const completed = new Set(done);
	if (!group || completed.has(request.path) || !request.dependencies.length
		|| request.dependencies.some(path => path === request.path || completed.has(path) || !group.files.includes(path))) {
		throw new Error('BLOCKED\nDependencies must be unfinished files in this selected module. Review the build plan or build the dependency separately.');
	}
	const edges = new Map<string, Set<string>>();
	for (const item of [...history, request]) {
		const targets = edges.get(item.path) ?? new Set<string>();
		item.dependencies.forEach(path => targets.add(path)); edges.set(item.path, targets);
	}
	const reaches = (path: string, target: string, seen = new Set<string>()): boolean => {
		if (path === target) { return true; }
		if (seen.has(path)) { return false; }
		seen.add(path); return [...(edges.get(path) ?? [])].some(next => reaches(next, target, seen));
	};
	if (request.dependencies.some(path => reaches(path, request.path))) {
		throw new Error('BLOCKED\nThe planned files have circular dependencies. Clarify their shared interfaces before continuing.');
	}
	if (history.some(item => item.path === request.path && item.dependencies.some(path => request.dependencies.includes(path)))) {
		throw new Error('BLOCKED\nThis dependency request repeated without resolving the interface. Review the dependency implementation before retrying.');
	}
	const dependencies = new Set(request.dependencies);
	const remaining = group.files.filter(path => !dependencies.has(path));
	remaining.splice(remaining.indexOf(request.path), 0, ...group.files.filter(path => dependencies.has(path)));
	return modules.map(module => module === group ? { ...module, files: remaining } : module);
}
