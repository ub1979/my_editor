import type { TsImport } from './tsImports';

/** Declaration and file facts shared by the parser and move checks. */
export interface TsDecl {
	readonly kind: string;
	readonly names: string[];
	readonly exported: boolean;
	readonly isDefault: boolean;
	readonly declare: boolean;
	readonly valueMeaning: boolean;
	/** UTF-16 offsets of the span: attached comments to the end of its last line. */
	readonly start: number;
	readonly end: number;
	readonly own: boolean;
	readonly docText: string;
	/** Module-scope names it uses (not its own), as values and only as types. */
	readonly valueUses: string[];
	readonly typeUses: string[];
	/** Module-scope names its definition-time code reads. */
	readonly defReads: string[];
	readonly quiet: boolean;
	/** Its definition-time code runs nothing (for classes, variables and enums). */
	readonly pure: boolean;
	readonly problems: string[];
	readonly decorators: boolean;
	readonly jsx: boolean;
	/** JSDoc `@typedef`, `@callback` or `@import` in it. */
	readonly jsdocTypes: boolean;
	/** Variables: every name is a plain identifier. */
	readonly plainNames: boolean;
	/** Enums: literal members only. */
	readonly literalEnum: boolean;
	/** Names in it that are written to outside their own declaration span. */
	readonly assigned: string[];
	/** For an `export { … }` list: the local names it exports. */
	readonly listed: string[];
}

export interface TsFacts {
	readonly text: string;
	readonly imports: readonly TsImport[];
	readonly decls: readonly TsDecl[];
	/** UTF-16 offset of the line where the facade goes when there are no imports (after the directives). */
	readonly facadeAt: number;
	readonly directives: readonly string[];
	readonly parseErrors: number;
	/** Every import, `import x = require()` and `export … from` comes before the first other statement. */
	readonly importsAtTop: boolean;
	readonly module: boolean;
	readonly exportEquals: boolean;
	/** Top-level `require`, `module.exports` or `exports.x` in a JS file. */
	readonly commonJs: boolean;
	readonly decorators: boolean;
	/** Comments outside declarations' spans that apply to the file, and the first comment. */
	readonly comments: readonly string[];
	readonly firstComment: string;
	/** UTF-16 offset to UTF-8 byte offset. */
	readonly bytes: (offset: number) => number;
}

