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

const CALL = new RegExp('\\b(?:readdirSync|readdir|opendirSync|opendir|import\\.meta\\.glob|require\\.context'
	+ '|(?:globSync|globbySync|globby|glob|fg|fastGlob|tinyglobby)(?:\\.\\w+)?)\\s*\\(', 'g');
const KEY = /\b(?:entities|migrations|subscribers|entry|entryPoints|input|spec)['"]?\s*:[ \t]*/g;
const SCANNED = /\.(?:[cm]?[jt]sx?|json|vue|svelte|astro|html|ya?ml)$/;
const NOT_SCANNED = new RegExp('(^|/)(node_modules|dist|build|out|coverage|vendor)/|\\.d\\.[cm]?ts$'
	+ '|(^|/)(package(-lock)?\\.json|[jt]sconfig[^/]*\\.json|\\.eslintrc[^/]*|eslint\\.config\\.\\w+|\\.prettierrc[^/]*|prettier\\.config\\.\\w+)$');
const LITERAL = /^(['"`])([^'"`\n]*)\1$/;
const GLOB_STRING = /(['"`])[^'"`\n]*[*?{][^'"`\n]*\1/;

/**
 * One expression from `start` (after spaces, and line breaks too when `lines`): its text, up to a top-level `,`,
 * closing bracket or line end with quotes respected, and where it ends.
 */
function expression(text: string, start: number, lines = true): { value: string; end: number } {
	let i = start;
	while (i < text.length && (text[i] === ' ' || text[i] === '\t' || (lines && /\s/.test(text[i])))) { i++; }
	const from = i;
	let depth = 0;
	for (; i < text.length; i++) {
		const c = text[i];
		if (c === '"' || c === '\'' || c === '`') {
			const close = text.indexOf(c, i + 1);
			if (close < 0) { i = text.length; break; }
			i = close;
		} else if ('([{'.includes(c)) { depth++; }
		else if (')]}'.includes(c)) { if (depth === 0) { break; } depth--; }
		else if (depth === 0 && (c === ',' || c === '\n')) { break; }
	}
	return { value: text.slice(from, i).trim(), end: i };
}

/** The elements of an array literal's text, or the text itself. */
function elements(value: string): string[] {
	if (!value.startsWith('[')) { return value ? [value] : []; }
	const out: string[] = [];
	for (let at = 1; at < value.length;) {
		const element = expression(value, at);
		if (element.value) { out.push(element.value); }
		if (value[element.end] !== ',') { break; }
		at = element.end + 1;
	}
	return out;
}

/**
 * A finder from a call's first argument or a key's value: quoted strings (alone or in an array) are patterns; a
 * non-literal argument, or a non-literal element holding a glob (`__dirname + '/plugins/*.ts'`), finds
 * everything below the file's folder.
 */
function finderOf(file: string, value: string, call: boolean): PathFinder | undefined {
	const patterns: string[] = [];
	let below = call && !value;
	for (const element of elements(value)) {
		const literal = LITERAL.exec(element);
		if (literal && !literal[2].includes('${')) { patterns.push(literal[2]); }
		else if (call || GLOB_STRING.test(element)) { below = true; }
	}
	if (below) { return { file, below: path.posix.dirname(file) }; }
	return patterns.length ? { file, patterns } : undefined;
}

/** `spec:` followed by a YAML list in a `.mocharc.yml`. */
function yamlList(text: string, end: number): string[] {
	const items: string[] = [];
	for (const line of text.slice(end).split('\n').slice(1)) {
		const item = /^\s+-\s*(.+?)\s*$/.exec(line);
		if (!item) { break; }
		items.push(item[1].replace(/^(['"])(.*)\1$/, '$2'));
	}
	return items;
}

/** Globs in package.json scripts (`esbuild 'src/*.ts'`, `mocha --spec=test/**`), relative to the package; none without packages. */
function scriptFinders(project: TsProject): PathFinder[] {
	return [...project.packages ?? []].flatMap(([dir, pkg]) => {
		const patterns = Object.values(pkg.scripts ?? {}).flatMap(script => script.split(/\s+/))
			.map(token => token.replace(/^--?[\w-]+=/, '').replace(/^(['"])(.*)\1$/, '$2')).filter(token => /^[\w./*?{},@!+-]+$/.test(token) && /[*{]/.test(token));
		return patterns.length ? [{ file: dir === '.' ? 'package.json' : `${dir}/package.json`, patterns }] : [];
	});
}

/**
 * Every place in the tracked files that finds files by a path string (`readdirSync`, `import.meta.glob`, glob libraries,
 * ORM entity globs, build entries, Mocha `spec`), and globs in package.json scripts.
 */
export function pathFinders(project: TsProject): PathFinder[] {
	const finders: PathFinder[] = [];
	for (const file of project.tracked.filter(f => SCANNED.test(f) && !NOT_SCANNED.test(f))) {
		let text = '';
		try { text = readFileSync(path.join(project.root, file), 'utf8'); } catch { continue; }
		if (text.length > 512 * 1024) { continue; }
		for (const match of text.matchAll(CALL)) {
			const finder = finderOf(file, expression(text, match.index + match[0].length).value, true);
			if (finder) { finders.push(finder); }
		}
		for (const match of text.matchAll(KEY)) {
			const end = match.index + match[0].length;
			const { value } = expression(text, end, false);
			// YAML may leave a scalar unquoted (`spec: test/**/*.ts`); in code, an unquoted value is an expression.
			const yaml = /\.ya?ml$/.test(file);
			const finder = !value ? { file, patterns: yamlList(text, end) }
				: yaml && !/^['"[]/.test(value) ? { file, patterns: [value.replace(/\s+#.*$/, '')] } : finderOf(file, value, false);
			if (finder?.patterns?.length || finder?.below) { finders.push(finder); }
		}
	}
	return [...finders, ...scriptFinders(project)];
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
		if (!pattern || pattern.startsWith('!') || /^[a-z]+:/i.test(pattern)) { continue; }
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
