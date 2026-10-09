import { readFileSync } from 'fs';
import * as path from 'path';
import type { TsProject } from './tsProject';

/** Something in a tracked file that finds files by path: a folder (and everything below it), or a glob. */
export interface PathFinder {
	readonly file: string;
	/** A folder below which every file is found (a non-literal `readdir` or glob argument). */
	readonly below?: string;
	/** Literal paths or globs, each relative to the root or to the file's folder. */
	readonly patterns?: readonly string[];
}

const CALL = /\b(readdirSync|readdir|opendirSync|opendir|globSync|glob|globby|fg|fastGlob|import\.meta\.glob|require\.context)\s*\(\s*(?:(['"`])([^'"`\n]*)\2)?/g;
const KEY = /\b(entities|migrations|subscribers|entry|entryPoints|input)\s*:\s*\[?((?:\s*(['"`])[^'"`\n]*\3\s*,?)+)/g;
const SCANNED = /\.(?:[cm]?[jt]sx?|json|vue|svelte|astro|html|ya?ml)$/;
const NOT_SCANNED = /(^|\/)(node_modules|dist|build|out|coverage|vendor)\/|(^|\/)(package(-lock)?\.json|[jt]sconfig[^/]*\.json|\.eslintrc[^/]*|eslint\.config\.\w+|\.prettierrc[^/]*|prettier\.config\.\w+)$|\.d\.[cm]?ts$/;

/** Every place in the tracked files that finds files by a path string (`readdirSync`, `import.meta.glob`, ORM entity globs, build entries). */
export function pathFinders(project: TsProject): PathFinder[] {
	const finders: PathFinder[] = [];
	for (const file of project.tracked.filter(f => SCANNED.test(f) && !NOT_SCANNED.test(f))) {
		let text = '';
		try { text = readFileSync(path.join(project.root, file), 'utf8'); } catch { continue; }
		if (text.length > 512 * 1024) { continue; }
		for (const match of text.matchAll(CALL)) {
			if (match[3] === undefined || match[3].includes('${')) { finders.push({ file, below: path.posix.dirname(file) }); }
			else { finders.push({ file, patterns: [match[3]] }); }
		}
		for (const match of text.matchAll(KEY)) {
			finders.push({ file, patterns: [...match[2].matchAll(/(['"`])([^'"`\n]*)\1/g)].map(m => m[2]) });
		}
	}
	return finders;
}

/** A glob as a regular expression over `/`-separated relative paths: `**`, `*`, `?`, `[…]`, `{a,b}` and `?(…)`/`+(…)`/`@(…)`/`*(…)`/`!(…)`. */
export function globRegExp(glob: string): RegExp {
	const escape = (text: string) => text.replace(/[.+^$()|[\]\\]/g, '\\$&');
	const convert = (part: string): string => {
		let out = '';
		for (let i = 0; i < part.length; i++) {
			const c = part[i];
			if ('?+@*!'.includes(c) && part[i + 1] === '(') {
				const end = part.indexOf(')', i);
				const inner = part.slice(i + 2, end).split('|').map(convert).join('|');
				out += c === '!' ? `(?!(?:${inner}))[^/]*` : `(?:${inner})${c === '@' ? '' : c === '+' ? '+' : c === '?' ? '?' : '*'}`;
				i = end;
			} else if (c === '*' && part[i + 1] === '*') {
				out += part[i + 2] === '/' ? '(?:.*/)?' : '.*';
				i += part[i + 2] === '/' ? 2 : 1;
			} else if (c === '[' && part.indexOf(']', i) > i) {
				out += part.slice(i, part.indexOf(']', i) + 1);
				i = part.indexOf(']', i);
			} else if (c === '*') { out += '[^/]*'; }
			else if (c === '?') { out += '[^/]'; }
			else if (c === '{') {
				const end = part.indexOf('}', i);
				out += end > i ? `(?:${part.slice(i + 1, end).split(',').map(convert).join('|')})` : '\\{';
				i = end > i ? end : i;
			} else { out += escape(c); }
		}
		return out;
	};
	return new RegExp(`^${convert(glob.replace(/^\.\//, ''))}$`);
}

/** Whether a finder finds files in a folder: a literal naming it or a parent, or a glob matching a file in it. */
export function findsFolder(finder: PathFinder, dir: string, probes: readonly string[]): boolean {
	const inside = (parent: string) => parent === '.' || dir === parent || dir.startsWith(`${parent}/`);
	if (finder.below !== undefined) { return inside(finder.below); }
	const bases = ['.', path.posix.dirname(finder.file)];
	for (const pattern of finder.patterns ?? []) {
		if (!pattern || /^[a-z]+:/i.test(pattern)) { continue; }
		for (const base of bases) {
			const full = path.posix.normalize(path.posix.join(base, pattern)).replace(/\/+$/, '');
			if (/[*?{]/.test(pattern)) {
				const re = globRegExp(full);
				if (probes.some(probe => re.test(probe))) { return true; }
			} else if (inside(full === '' ? '.' : full)) { return true; }
		}
	}
	return false;
}

const FRAMEWORKS: readonly [string, RegExp][] = [
	['next', /(^|\/)(app|pages)\//], ['nuxt', /(^|\/)(pages|plugins|composables|utils|layouts|components|middleware|store|server)\//],
	['expo-router', /(^|\/)app\//], ['@sveltejs/kit', /(^|\/)routes\/|(^|\/)\+[^/]*$/], ['astro', /(^|\/)pages\//],
];

/** A framework that finds files by their folder, when the dependency is present; any `api/` or `functions/` folder too. */
export function frameworkFolder(project: TsProject, file: string): string | undefined {
	for (const [name, pattern] of FRAMEWORKS) {
		if (project.dependencies.has(name) && pattern.test(file)) { return `${name} finds files in this folder by their path`; }
	}
	if (/(^|\/)(api|functions)\//.test(file)) { return 'serverless hosts find files in api/ and functions/ folders by their path'; }
	return undefined;
}
