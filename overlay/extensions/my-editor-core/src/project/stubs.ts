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

/**
 * A starting file that states its job: a header comment (role, requirements, architecture section) and a
 * placeholder that keeps the project compiling. Never any invented implementation.
 */
export function stubContent(file: TreeFile): string {
	const facts = [
		file.role ?? 'Describe what this file is responsible for.',
		file.requirements?.length ? `Requirements: ${file.requirements.join(', ')}.` : '',
		file.section ? `Architecture: #${file.section}.` : '',
	].filter(Boolean);
	if (/\.(ts|tsx|mts|js|jsx|mjs)$/.test(file.path)) {
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
	if (/\.(sh|rb|yaml|yml|toml)$/.test(file.path)) {
		return `${facts.map(f => `# ${f}`).join('\n')}\n`;
	}
	return '';
}

/** The next file to work on: the first one that is started but not done, else the first not done. */
export function nextFile(files: TreeFile[]): TreeFile | undefined {
	return files.find(f => f.status === 'in-progress')
		?? files.find(f => f.status === 'stub')
		?? files.find(f => f.status !== 'done');
}
