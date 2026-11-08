import { loadTypeScript } from '../aiready/tsLoad';
import { redact, redactKnownSecrets } from './redact';

/** Keep the credential guard without mistaking verified JS/TS references for literal secret values. */
export function hasCredentialLikeSource(path: string, source: string): boolean {
	if (redactKnownSecrets(source) !== source) { return true; }
	if (!/\.[cm]?[jt]sx?$/i.test(path)) { return redact(source) !== source; }
	const ts = loadTypeScript('typescript');
	if (typeof ts === 'string') { return redact(source) !== source; }
	const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
	const references: { start: number; end: number }[] = [];
	const visit = (node: import('typescript').Node): void => {
		const value = ts.isPropertyAssignment(node) || ts.isVariableDeclaration(node) ? node.initializer : undefined;
		// Only simple AST references qualify. Comments, strings and interpolated expressions retain the guard.
		if (value && (ts.isIdentifier(value) || ts.isPropertyAccessExpression(value))
			&& /^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*$/.test(value.getText(file))) {
			references.push({ start: value.getStart(file), end: value.end });
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	let checked = source;
	for (const range of references.sort((a, b) => b.start - a.start)) {
		checked = checked.slice(0, range.start) + '_' + checked.slice(range.end);
	}
	return redact(checked) !== checked;
}
