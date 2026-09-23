import { extractFacts, resolveImport } from './facts';

/** Deterministic findings about how a set of files fit together. */
export interface FitReport {
	readonly files: string[];
	readonly brokenImports: { file: string; spec: string }[];
	readonly cycles: string[][];
	readonly links: { from: string; to: string }[];
	readonly unusedExports: { file: string; names: string[] }[];
}

/**
 * Analyses the selected files against the whole project: relative imports that resolve to nothing,
 * import cycles among the selection, the links between selected files, and exports no project file imports.
 */
export function analyzeFit(selected: { path: string; text: string }[], project: { path: string; text: string }[]): FitReport {
	const known = new Set(project.map(f => f.path));
	const selectedSet = new Set(selected.map(f => f.path));
	const graph = new Map<string, string[]>();
	const importedAnywhere = new Set<string>();
	for (const file of project) {
		for (const spec of extractFacts(file.path, file.text).imports) {
			const target = resolveImport(file.path, spec, known);
			if (target && target !== file.path) {
				importedAnywhere.add(target);
			}
		}
	}

	const brokenImports: FitReport['brokenImports'] = [];
	const links: FitReport['links'] = [];
	const unusedExports: FitReport['unusedExports'] = [];
	for (const file of selected) {
		const facts = extractFacts(file.path, file.text);
		const targets: string[] = [];
		for (const spec of facts.imports) {
			const target = resolveImport(file.path, spec, known);
			if (spec.startsWith('.') && !target) {
				brokenImports.push({ file: file.path, spec });
			} else if (target && selectedSet.has(target)) {
				targets.push(target);
				links.push({ from: file.path, to: target });
			}
		}
		graph.set(file.path, targets);
		if (facts.exports.length && !importedAnywhere.has(file.path) && !/(^|\/)(index|main|app|extension|cli)\.[jt]sx?$/i.test(file.path) && facts.language !== 'py') {
			unusedExports.push({ file: file.path, names: facts.exports });
		}
	}
	return { files: [...selectedSet].sort(), brokenImports, cycles: findCycles(graph), links, unusedExports };
}

/** Elementary cycles found by DFS, each reported once starting from its smallest path. */
function findCycles(graph: Map<string, string[]>): string[][] {
	const cycles = new Map<string, string[]>();
	const visit = (start: string, node: string, path: string[], seen: Set<string>) => {
		for (const next of graph.get(node) ?? []) {
			if (next === start) {
				const cycle = [...path];
				const min = cycle.reduce((a, b) => (a < b ? a : b));
				const rotated = [...cycle.slice(cycle.indexOf(min)), ...cycle.slice(0, cycle.indexOf(min))];
				cycles.set(rotated.join('→'), rotated);
			} else if (!seen.has(next) && next > start) {
				seen.add(next);
				visit(start, next, [...path, next], seen);
				seen.delete(next);
			}
		}
	};
	for (const node of graph.keys()) {
		visit(node, node, [node], new Set([node]));
	}
	return [...cycles.values()];
}

/** The report as Markdown, for `.my_editor/qa/` and for the pair to explain. */
export function fitMarkdown(report: FitReport, problems: { file: string; line: number; severity: string; message: string }[], when: string): string {
	const lines = [`# Fit check — ${when}`, '', `**Files:** ${report.files.length}`, ''];
	lines.push('## Problems from the editor', '');
	lines.push(...(problems.length ? problems.slice(0, 40).map(p => `- \`${p.file}:${p.line}\` ${p.severity}: ${p.message}`) : ['- None.']));
	lines.push('', '## Broken imports', '');
	lines.push(...(report.brokenImports.length ? report.brokenImports.map(b => `- \`${b.file}\` imports \`${b.spec}\`, which does not exist`) : ['- None.']));
	lines.push('', '## Import cycles', '');
	lines.push(...(report.cycles.length ? report.cycles.map(c => `- ${c.map(p => `\`${p}\``).join(' → ')} → back`) : ['- None.']));
	lines.push('', '## How the files connect', '');
	lines.push(...(report.links.length ? report.links.map(l => `- \`${l.from}\` uses \`${l.to}\``) : ['- The selected files do not import each other.']));
	lines.push('', '## Exports no project file imports', '');
	lines.push(...(report.unusedExports.length ? report.unusedExports.map(u => `- \`${u.file}\`: ${u.names.join(', ')}`) : ['- None.']));
	lines.push('', '## Files', '', ...report.files.map(f => `- \`${f}\``), '');
	return lines.join('\n');
}
