import type { TreeFile } from './stubs';
import { isSourceFile, MAX_SOURCE_LINES } from '../quality/sourcePolicy';
import { safeRelativePath } from '../chat/agentProtocol';

export interface BuildStep {
	id: string;
	title: string;
	files: string[];
	dependsOn: string[];
	tasks: string[];
	checks: string[];
}
export interface BuildPlan { version: 1; entryPoint: string; steps: BuildStep[] }

const strings = (value: unknown): value is string[] => Array.isArray(value)
	&& value.every(item => typeof item === 'string' && !!item.trim());
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Legacy trees remain usable; newly supplied build guidance must be complete and internally consistent. */
export function buildPlanProblems(raw: unknown, files: TreeFile[]): string[] {
	if (!record(raw) || raw.buildPlan === undefined) { return []; }
	const plan = raw.buildPlan;
	if (!record(plan) || plan.version !== 1 || !Array.isArray(plan.steps) || !plan.steps.length) {
		return ['buildPlan needs version 1 and a non-empty steps array'];
	}
	const problems: string[] = [];
	const paths = new Set(files.map(file => file.path));
	if (paths.size !== files.length) { problems.push('Planned file paths must be unique'); }
	if (typeof plan.entryPoint !== 'string' || !paths.has(plan.entryPoint)) {
		problems.push('buildPlan.entryPoint must name a planned application entry point or library public entry file');
	}
	for (const file of files) {
		if (!safeRelativePath(file.path)) { problems.push(`Unsafe planned path: ${file.path}`); }
		if (isSourceFile(file.path) && (!Number.isInteger(file.estimatedLines) || file.estimatedLines! < 1 || file.estimatedLines! > MAX_SOURCE_LINES)) {
			problems.push(`${file.path} needs estimatedLines between 1 and ${MAX_SOURCE_LINES}; split oversized responsibilities before planning the files`);
		}
	}
	const ids = new Set<string>();
	const assigned = new Set<string>();
	const steps: BuildStep[] = [];
	for (const value of plan.steps) {
		if (!record(value) || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(value.id)
			|| ['__proto__', 'constructor', 'prototype'].includes(value.id)
			|| typeof value.title !== 'string' || !value.title.trim()
			|| !strings(value.files) || !value.files.length || !strings(value.dependsOn)
			|| !strings(value.tasks) || !value.tasks.length || !strings(value.checks) || !value.checks.length) {
			problems.push('Each build step needs a stable id, title, files, dependsOn, implementation tasks and verification checks'); continue;
		}
		const step = value as unknown as BuildStep;
		if (ids.has(step.id)) { problems.push(`Duplicate build step: ${step.id}`); }
		ids.add(step.id);
		for (const file of step.files) {
			if (!paths.has(file)) { problems.push(`Build step ${step.id} names an unplanned file: ${file}`); }
			if (assigned.has(file)) { problems.push(`${file} is assigned to more than one build step`); }
			assigned.add(file);
		}
		steps.push(step);
	}
	for (const file of files) { if (!assigned.has(file.path)) { problems.push(`${file.path} needs a build step`); } }
	for (const step of steps) {
		for (const dependency of step.dependsOn) {
			if (!ids.has(dependency)) { problems.push(`Build step ${step.id} has unknown prerequisite ${dependency}`); }
			if (dependency === step.id) { problems.push(`Build step ${step.id} depends on itself`); }
		}
	}
	if (orderedSteps(steps).length !== steps.length) { problems.push('Build step dependencies contain a cycle or unresolved prerequisite'); }
	return [...new Set(problems)];
}

/** Stable topological order: a library's consumers cannot precede that library. */
export function orderedSteps(steps: readonly BuildStep[]): BuildStep[] {
	const pending = [...steps], ordered: BuildStep[] = [], done = new Set<string>();
	while (pending.length) {
		const index = pending.findIndex(step => step.dependsOn.every(id => done.has(id)));
		if (index < 0) { break; }
		const [step] = pending.splice(index, 1); ordered.push(step); done.add(step.id);
	}
	return ordered;
}

/** No invented dependencies or tests for older trees: clearly label their original file order as unverified guidance. */
export function legacyBuildSteps(files: TreeFile[]): BuildStep[] {
	return files.map((file, index) => ({ id: `file-${index + 1}`, title: file.role || file.path, files: [file.path], dependsOn: [],
		tasks: [file.role || 'Implement this file’s planned responsibility.'], checks: [] }));
}
