import { anchorFor, moduleOf } from '../brain/analysisPlan';
import { planningSections } from './planningSections';
import { parseTree, TreeFile } from './stubs';

export interface VisualPart {
	readonly id: string;
	readonly title: string;
	readonly summary: string;
	fileCount: number;
	uses: { id: string; count: number }[];
}

export interface ProjectVisuals {
	readonly overview: string;
	readonly parts: VisualPart[];
	readonly files: TreeFile[];
}

function plain(text: string): string {
	return text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();
}

/** Builds a small visual model from the saved specs and the brain's resolved imports. */
export function projectVisuals(architecture: string, treeText: string, brainText = ''): ProjectVisuals {
	let files: TreeFile[] = [];
	try {
		files = parseTree(treeText);
	} catch {
		// The visual tree stays empty until the JSON is fixed.
	}
	let brain: { files?: Record<string, { imports?: string[] }> } = {};
	try {
		const parsed = JSON.parse(brainText);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) { brain = parsed; }
	} catch {
		// The specs can still be visualised without a brain map.
	}

	const sections = planningSections(architecture);
	const headings = sections.some(section => section.anchor) ? sections.filter(section => section.anchor) : sections.filter(section => section.level === 2);
	const general = new Set(['stack', 'how it fits together', 'decisions', 'open questions']);
	const parts: VisualPart[] = headings.flatMap(heading => {
		const title = heading.title;
		if (general.has(title.toLowerCase())) {
			return [];
		}
		const id = heading.anchor ?? anchorFor(title);
		const body = heading.body;
		const paragraph = body.split(/\n\s*\n/).map(p => p.trim()).find(p => p && !/^(#|[-*>|]|```)/.test(p)) ?? '';
		return [{ id, title, summary: plain(paragraph).slice(0, 360), fileCount: 0, uses: [] }];
	});
	const byPath = new Map(files.map(file => [file.path, file.section?.replace(/^#/, '') || anchorFor(moduleOf(file.path))]));
	const byId = new Map(parts.map(part => [part.id, part]));
	const links = new Map<string, Map<string, number>>();
	for (const path of new Set([...files.map(file => file.path), ...Object.keys(brain.files ?? {})])) {
		const owner = byPath.get(path) ?? anchorFor(moduleOf(path));
		const part = owner && byId.get(owner);
		if (part) {
			part.fileCount++;
		}
	}
	for (const [path, entry] of Object.entries(brain.files ?? {})) {
		const from = byPath.get(path) ?? anchorFor(moduleOf(path));
		if (!byId.has(from) || !entry || !Array.isArray(entry.imports)) {
			continue;
		}
		for (const imported of entry.imports) {
			const to = byPath.get(imported) ?? anchorFor(moduleOf(imported));
			if (from === to || !byId.has(to)) {
				continue;
			}
			const targets = links.get(from) ?? new Map<string, number>();
			targets.set(to, (targets.get(to) ?? 0) + 1);
			links.set(from, targets);
		}
	}
	for (const part of parts) {
		part.uses = [...(links.get(part.id) ?? [])].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, count }));
	}
	const before = architecture.split('\n').slice(0, headings[0]?.line).join('\n');
	const overview = before.split(/\n\s*\n/).map(p => p.trim()).find(p => p && !p.startsWith('#')) ?? '';
	return { overview: plain(overview).slice(0, 500), parts, files };
}
