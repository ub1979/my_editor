import type { PlanningDocuments } from './planning';
import { planningSections, PlanningSection } from './planningSections';
import { parseTree, TreeFile } from './stubs';
import { queryTerms, rankPaths, sourceExcerpt } from './relevance';
import { extractFacts, resolveImport } from '../brain/facts';
import { redact } from '../records/redact';
import { posix } from 'path';
import { decisionReference } from './decisionReferences';

function isConfiguration(path: string): boolean {
	return /(?:^|\/)(?:package\.json|(?:ts|js)config(?:\.[^/]+)?\.json|[^/]+\.config\.[cm]?[jt]s)$/.test(path);
}

/** Configuration starts with its inherited config and enclosing manifests, not every module test. */
function configurationHints(path: string, source: string, known: ReadonlySet<string>): string[] {
	const hints = new Set<string>();
	try {
		const data = JSON.parse(source);
		for (const spec of [data.extends].flat().filter((value): value is string => typeof value === 'string')) {
			if (spec.startsWith('.')) { hints.add(posix.normalize(posix.join(posix.dirname(path), spec))); }
		}
	} catch { /* Non-JSON configs use the import map below. */ }
	let directory = posix.dirname(path);
	for (;;) {
		for (const name of known) {
			if (posix.dirname(name) === directory && isConfiguration(name)) { hints.add(name); }
		}
		if (directory === '.') { break; }
		directory = posix.dirname(directory);
	}
	return [...hints].filter(name => name !== path && known.has(name));
}

function bounded(text: string, limit: number): string {
	return text.length <= limit ? text : text.slice(0, limit) + '\n[Excerpt ends. Read the cited source range for missing detail.]';
}

function sectionText(file: string, section: PlanningSection, limit: number): string {
	const source = file.includes('requirements') ? 'requirements' : 'architecture';
	const ref = section.body.trim().length >= 16 && section.body.trim().length <= 8000 ? ` · decision reference ${decisionReference(source, section.body)}` : '';
	return `${file}:${section.line + 1}-${section.endLine} · ${section.title}${ref}\n${bounded(section.body, limit)}`;
}

/** Complete linked acceptance criteria, plus shared constraints; unrelated feature bodies stay out. */
function requirementBrief(source: string, ids: ReadonlySet<string>): string {
	const sections = planningSections(source);
	const selected = sections.filter(section => {
		const linked = [...section.title.matchAll(/\bN?FR-\d+\b/g)].some(match => ids.has(match[0]) || match[0].startsWith('NFR-'));
		return linked || /^(?:\d+[.)]?\s*)?(?:goal|architecture constraints|non-functional requirements|constraints|quality requirements)\b/i.test(section.title);
	});
	const parts = selected.filter(section => !selected.some(parent => parent !== section
		&& parent.line < section.line && parent.endLine >= section.endLine))
		.map(section => sectionText('.my_editor/specs/requirements.md', section, 6000));
	// Older plans put requirement ids in list/table rows instead of headings.
	const lines = source.split(/\r?\n/);
	for (let index = 0; index < lines.length; index++) {
		if (selected.some(section => index >= section.line && index < section.endLine)) { continue; }
		if (![...lines[index].matchAll(/\bN?FR-\d+\b/g)].some(match => ids.has(match[0]) || match[0].startsWith('NFR-'))) { continue; }
		let end = index + 1;
		while (end < lines.length && !/^\s*(?:#{1,6}\s|[-*]\s+(?:\*\*)?N?FR-\d+|\|\s*N?FR-\d+)/.test(lines[end])) { end++; }
		parts.push(`.my_editor/specs/requirements.md:${index + 1}-${end}\n${lines.slice(index, end).join('\n')}`);
		index = end - 1;
	}
	return bounded(parts.join('\n\n') || 'No linked requirement text found. Inspect the saved requirements before inferring behavior.', 14000);
}

function architectureBrief(source: string, file: TreeFile | undefined, current: string, terms: string[]): string {
	const sections = planningSections(source);
	const anchors = new Set([file?.section, ...[...current.slice(0, 1800).matchAll(/#([a-z][\w-]+)/gi)].map(match => match[1])]);
	const primary = sections.filter(section => section.anchor && anchors.has(section.anchor));
	const parts = primary.map(section => sectionText('.my_editor/specs/architecture.md', section, 9000));
	for (const section of sections.filter(section => !primary.includes(section)
		&& /overview|constraint|security|api|events|data model|testing|decision|system flow/i.test(section.title))) {
		if (primary.some(parent => section.line >= parent.line && section.endLine <= parent.endLine)) { continue; }
		parts.push(`.my_editor/specs/architecture.md:${section.line + 1}-${section.endLine} · ${section.title} (excerpt numbers are relative to this section body)\n`
			+ sourceExcerpt(section.body, terms, 1600));
	}
	const index = sections.filter(section => section.anchor).map(section =>
		`${section.anchor}: lines ${section.line + 1}-${section.endLine} · ${section.title}`).join('\n');
	return bounded(parts.join('\n\n'), 15000) + '\n\nArchitecture lookup index (read additional sections only when needed):\n' + bounded(index, 4000);
}

/** A fresh per-file plan and dependency map, never the entire tree or unrelated source bodies. */
export function fileBuildBrief(docs: PlanningDocuments, path: string, source: string): string {
	let files: TreeFile[] = [], steps: { id: string; title: string; files: string[]; dependsOn?: string[]; tasks?: string[]; checks?: string[] }[] = [];
	try {
		files = parseTree(docs.tree ?? '[]');
		const raw = JSON.parse(docs.tree ?? '{}').buildPlan?.steps;
		steps = Array.isArray(raw) ? raw.filter(step => step && Array.isArray(step.files)) : [];
	}
	catch { /* Selected-file QA is valid without a saved tree. */ }
	const file = files.find(item => item.path === path), step = steps.find(item => item.files.includes(path));
	const terms = queryTerms(`${path} ${file?.role ?? ''}`);
	const known = new Set(files.map(item => item.path));
	const configuration = isConfiguration(path);
	const imports = extractFacts(path, source).imports.map(spec => ({ spec, path: resolveImport(path, spec, known) }));
	const candidates = Object.fromEntries(files.filter(item => item.path !== path && (item.section === file?.section
		|| steps.some(dependency => step?.dependsOn?.includes(dependency.id) && dependency.files.includes(item.path))))
		.map(item => [item.path, item.role ?? '']));
	const related = [...new Set([...imports.flatMap(item => item.path ? [item.path] : []),
		...(configuration ? configurationHints(path, source, known)
			: [...rankPaths(candidates, terms, value => value), ...Object.keys(candidates)])])].slice(0, 16);
	return redact(bounded([
		`File implementation brief for ${path}. Saved plans describe intended behavior; verify interfaces against current source.`,
		`Tree entry: ${JSON.stringify(file ?? { path, role: 'Unplanned file: inspect its callers and tests.' })}`,
		step ? `Current module and planned checks (not test results): ${bounded(JSON.stringify({ id: step.id, title: step.title,
			tasks: step.tasks, checks: step.checks, dependsOn: step.dependsOn }), 5000)}` : '',
		'Linked requirements and shared constraints:\n' + requirementBrief(docs.requirements ?? '', new Set(file?.requirements ?? [])),
		'Relevant architecture and interface guidance:\n' + architectureBrief(docs.architecture ?? '', file, source, terms),
		`Imports read from the current file: ${JSON.stringify(imports)}. Unresolved package names require their manifest/export contracts; do not invent them.`,
		'Related planned files (optional lookup hints, not a reading checklist or verified interfaces):\n' + bounded(related.map(name =>
			`${name} — ${files.find(item => item.path === name)?.role ?? ''}`).join('\n'), 5000),
		'The complete current file is in the request. Read only the dependency contracts, callers or tests needed for this file. '
			+ 'Retain verified interfaces; do not reread unchanged files or load the entire project. If a linked contract is missing or contradictory, report the exact gap.',
		configuration ? 'This is a configuration file. Start with its enclosing manifest, inherited configuration and explicit import/export contracts. '
			+ 'Do not audit the module’s source and tests by default. Read a specific source/test only to resolve a concrete configuration question, then finish this file.' : '',
	].filter(Boolean).join('\n\n'), 32000));
}
