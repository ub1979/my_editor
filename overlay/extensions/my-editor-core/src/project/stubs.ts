/** One planned file in `.my_editor/specs/tree.json`. */
export interface TreeFile {
	path: string;
	role?: string;
	requirements?: string[];
	section?: string;
	status?: 'planned' | 'stub' | 'in-progress' | 'done' | string;
}

/** Accepts the tree as an array or as `{ files: [...] }`, ignoring entries without a path. */
export function parseTree(text: string): TreeFile[] {
	const raw = JSON.parse(text);
	const list = Array.isArray(raw) ? raw : Array.isArray(raw?.files) ? raw.files : [];
	return list.filter((f: unknown): f is TreeFile => !!f && typeof (f as TreeFile).path === 'string' && !!(f as TreeFile).path.trim());
}

/** Refuse an incomplete tree when it is about to be kept and scaffolded. */
export function validateTreePlan(text: string): TreeFile[] {
	const raw = JSON.parse(text);
	const list = Array.isArray(raw) ? raw : raw?.files;
	if (!Array.isArray(list) || list.some(file => !file || typeof file.path !== 'string' || !file.path.trim())) {
		throw new Error('The file tree must be a JSON array (or an object with files) and every entry needs a path.');
	}
	return list as TreeFile[];
}

/**
 * A starting file that states its job: a header comment (role, requirements, architecture section) and a
 * placeholder that keeps the project compiling. Never any invented implementation.
 */
export function stubContent(file: TreeFile): string {
	const oneLine = (value: string) => value.replace(/\s+/g, ' ').replace(/\*\//g, '* /').replace(/-->/g, '-- >').replace(/"""/g, '" " "').trim();
	const facts = [
		oneLine(typeof file.role === 'string' ? file.role : 'Describe what this file is responsible for.'),
		Array.isArray(file.requirements) && file.requirements.length ? `Requirements: ${file.requirements.join(', ')}.` : '',
		file.section ? `Architecture: #${file.section}.` : '',
	].filter(Boolean).map(oneLine);
	if (/\.(ts|tsx|mts|js|jsx|mjs|cjs)$/.test(file.path)) {
		const body = /\.(ts|tsx|mts)$/.test(file.path) ? 'export {};\n' : '';
		return `/**\n${facts.map(f => ` * ${f}`).join('\n')}\n */\n\n${body}`;
	}
	if (/\.pyi?$/.test(file.path)) {
		return `"""${facts.join('\n\n')}\n"""\n`;
	}
	if (/\.(md|markdown)$/.test(file.path)) {
		return `# ${file.path.split('/').pop()}\n\n${facts.join('\n\n')}\n`;
	}
	if (/\.(css|scss)$/.test(file.path)) {
		return `/* ${facts.join(' ')} */\n`;
	}
	if (/\.(html|vue|svelte)$/.test(file.path)) {
		return `<!-- ${facts.join(' ')} -->\n`;
	}
	if (/\.(sh|rb|yaml|yml|toml|ini|conf|properties|r|R)$/.test(file.path)) {
		return `${facts.map(f => `# ${f}`).join('\n')}\n`;
	}
	if (/\.sql$/.test(file.path)) {
		return `${facts.map(f => `-- ${f}`).join('\n')}\n`;
	}
	if (/\.(go|c|cc|cpp|h|hpp|java|kt|kts|rs|swift|cs|php|dart)$/.test(file.path)) {
		return `${facts.map(f => `// ${f}`).join('\n')}\n`;
	}
	if (/\.(xml|svg)$/.test(file.path)) {
		return `<!-- ${facts.join(' ')} -->\n`;
	}
	if (/\.(txt|text|csv|tsv)$/.test(file.path)) {
		return `${facts.join(' ')}\n`;
	}
	if (/\.jsonc?$/.test(file.path)) {
		return /\.jsonc$/.test(file.path) ? `// ${facts.join(' ')}\n{}\n` : '{}\n';
	}
	return '';
}

/** The next file to work on: the first one that is started but not done, else the first not done. */
export function nextFile(files: TreeFile[]): TreeFile | undefined {
	return files.find(f => f.status === 'in-progress')
		?? files.find(f => f.status === 'stub')
		?? files.find(f => f.status !== 'done');
}
