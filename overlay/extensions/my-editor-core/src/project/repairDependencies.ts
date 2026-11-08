import { DependencyRequest, prioritizeDependencies } from './filePassDependencies';
import type { PassModule } from './filePassPlan';
import type { QueuedRepair } from './filePassRepairs';

/** Dependency priority must affect the active repair queue as well as normal build order. */
export function scheduleRepairDependencies(modules: PassModule[], queue: readonly QueuedRepair[], request: DependencyRequest,
	done: readonly string[], history: readonly DependencyRequest[], scheduled: readonly DependencyRequest[]) {
	const current = queue[0];
	if (!current || current.path !== request.path) { throw new Error('The dependency request is not for the active repair.'); }
	// Older versions recorded an ordering request without scheduling it in the repair queue.
	// Permit that exact edge once; retain all other edges for cycle detection and all actually scheduled repeats.
	const prior = history.map(item => ({ ...item, dependencies: item.dependencies.filter(path =>
		item.path !== request.path || !request.dependencies.includes(path)
		|| scheduled.some(old => old.path === item.path && old.dependencies.includes(path))) })).filter(item => item.dependencies.length);
	const nextModules = prioritizeDependencies(modules, request, done.filter(path => path !== current.path), prior);
	const targets = new Set(request.dependencies);
	const ordered = nextModules.flatMap(group => group.files).filter(path => targets.has(path));
	const prerequisites = ordered.map(path => queue.find(item => item.path === path) ?? {
		...current, path, reason: `Implement the planned prerequisite needed by ${current.path}. ${current.reason}`,
	});
	return { modules: nextModules, queue: [...prerequisites, ...queue.filter(item => !targets.has(item.path))] };
}
