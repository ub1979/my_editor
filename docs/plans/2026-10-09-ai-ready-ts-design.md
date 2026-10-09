# Make a project AI-ready: TypeScript and JavaScript (Stage 2b)

- **Date:** 9 October 2026 (narrowed after review the same day)
- **Status:** Design, not built. Needs review before a plan.
- **Builds on:** [AI-ready design](2026-10-07-ai-ready-design.md), *Stage 2a: Go* (the model followed here), the
  `LanguageAdapter` interface on branch `ai-ready-go`
- **Replaces for TS/JS:** the general Stage 2 rules (extractor, split, refuse-to-split list, move check). Where this
  file and the general rules differ, this file wins, and the difference is named.

## Version 1 scope

Where the safe choice is unclear, version 1 refuses or skips.

| Project | What may move in version 1 |
|---|---|
| TS compiled to ES modules and checked by `tsc`: `module` and `moduleResolution` set, no transform tool, nothing runs the code as CommonJS | Functions, interfaces and type aliases; classes, `const`/`let`/`var` and enums whose definition-time code is pure (see *What may move*) |
| TS that runs as CommonJS anywhere: `module: commonjs`, a `.cts` file, a CommonJS package under `node16`/`nodenext`, tests under Jest, or ts-node running it as CommonJS (a `"ts-node"` section in a tsconfig with `module: commonjs`, or `-r`/`--require ts-node/register` in a script or `.mocharc`) | Interfaces and type aliases only |
| A transform tool configured or installed: Next.js (`next`); Vite (`vite`, `vite.config.*`); Vitest (`vitest`, `vitest.config.*`); webpack with `ts-loader` or `babel-loader`; Parcel (`parcel`, `@parcel/*`, `.parcelrc`); Rollup with a TS plugin (`@rollup/plugin-typescript`, `rollup-plugin-typescript2`, `rollup-plugin-esbuild`, `@rollup/plugin-babel`, …); tsup; esbuild (`esbuild` in a script, a tracked file that loads it, or `tsconfigRaw`); `tsx`; Babel; swc (`.swcrc`, `@swc/*`); Sucrase; Metro; `esbuild-register`; a `ts-node` run. An `esbuild` or `rollup` dependency alone does not count | Interfaces and type aliases only |
| TS run without a compile step: Node's type stripping (a script runs `node`, not `ts-node`, on a `.ts`/`.mts` file, `--experimental-strip-types`/`--experimental-transform-types`, or tsconfig `erasableSyntaxOnly`), Bun (`bun.lock`, `bun.lockb`, `bunfig.toml`, `bun`/`bunx` in a script) or Deno (`deno.json`, `deno.jsonc`) | Interfaces and type aliases only |
| Plain JS as ES modules run natively (`.mjs` or `"type": "module"`), no Jest, no transform tool, no JSX | Function declarations only |
| CommonJS source, other plain JS, a tsconfig without `module` or `moduleResolution` | Nothing; the files are skipped with the reason |

A types-only move changes no emitted JavaScript of the original, under both the elision and the verbatim reading of
imports: the facade is `export type … from`, the original drops only unused specifiers written as types and never
empties a declaration (see *The original*), a plan that would drop any other specifier is refused, and nothing loads
the new files at run time. Each narrowed file names the tool that narrowed it.

## Goal

Split an oversized `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx` or `.mjs` file into focused files in the same folder.
Whole top-level declarations move byte for byte. The original path keeps exporting exactly what it exported, through a
re-export facade, so no caller changes. The program must behave as before, and the host must be able to show it
without trusting the model.

## Why TS/JS is harder than Go

In Go, files in a package share one namespace: a move changes no import and no caller. In TS/JS every file is its own
module. A move adds a module, adds import edges, and changes when code runs. Five things can change behavior while the
compiler and a thin test suite stay green:

1. **Evaluation order.** Imported modules run before the importing module's body. A moved declaration's
   definition-time code (an initializer, a class's `extends`, static fields) now runs earlier.
2. **Which modules load, and when.** Removing an import from the original can move a library's first load later.
3. **CommonJS output.** A moved export becomes a getter on the original's `exports`, defined at the facade line instead
   of at the top. Spies, assignment, key order and cycles see the difference.
4. **Module-relative values.** `import.meta.url`, `__filename`, top-level `this` and stack traces name the file.
5. **Tools that find files by path.** Routers, globs, `readdirSync` loaders and bundlers that trust `sideEffects`
   react to a new file or a changed module.

Each rule below exists to close one of these. When a rule cannot decide, the move is refused.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Parser | The TypeScript compiler API that ships with the editor, for TS and JS alike. Never regexes | One parser and one binder for every flavor; JSX, JSDoc and TS syntax all parse |
| Type checker | Used for name resolution and the export surface, on small in-memory programs. The project's own `tsc` is only the build check | Analysis must not depend on the project's TS version or on `node_modules` |
| Where new files go | The original's folder | Every relative specifier copied byte for byte resolves the same, and the same tsconfig applies |
| The original after a split | Its old bytes, minus moved spans, plus a facade block after its imports | Callers and `package.json` `exports` keep the old path |
| What may move | Per project, see *Version 1 scope* | Runtime moves only where the output is ES modules and no other tool transforms it |
| Imports in new files | Built by the host from binder references, copied from the original's import declarations. The model never writes import lines | The general rules let the model write import lines; that is dropped |
| A moved declaration that uses a name that stays | Refused, except a type-only use of a type the original already exports | A value import back into the original is a cycle with the facade |
| A moved name that is not exported but is used by staying code or by another new file | Refused: helpers move with every declaration that uses them | Exporting it would add an export the original never had |
| CommonJS source (`require`, `module.exports`) | File skipped | Its exports are built at run time; there is nothing static to check |
| Files in an import cycle (static, dynamic or `require`, any depth) | Skipped | Evaluation order inside a cycle depends on which module loads first |
| Characterization tests before splits | Not required, as in Go | The binding and export checks prove name resolution unchanged; generated tests would not catch the residual risks either |
| Lint, Prettier | Not enforced, except: when the original was Prettier-clean and Prettier is installed, the new files and the original must stay clean | Same rule as `gofmt`, only where the project already uses it |

## The bundled TypeScript

The compiler ships with the editor at `vscode.env.appRoot + '/extensions/node_modules/typescript'` (6.0.3 today). The
extension does not bundle its own copy.

- `tsLoad.ts` loads it once with a runtime `require` (`createRequire(__filename)(dir)`), so esbuild leaves it out of
  `dist/extension.js`. Code imports only types: `import type * as TS from 'typescript'` (the dev dependency).
- The adapter gets the module as a parameter (`createTsAdapter(root, ts, …)`). Unit tests pass the dev dependency;
  a test run with `MY_EDITOR_TS=<app path>` uses the shipped one, so both versions are tested.
- Version gate: major 5 or 6 and `ts.createProgram` present. Otherwise stop with *TypeScript splitting needs the
  editor's TypeScript 5 or 6.* TS 7 (the native compiler) has a different API and must be re-reviewed.
- **Unset `module` or `moduleResolution`: skip.** TS 6 and TS 5 default them differently, so the bundled compiler
  could read a project's files in a way its own `tsc` does not. The tsconfig (after `extends`) must set both.
- TS 6 deprecates `moduleResolution: node10`, `baseUrl`, `target: es5` and others. Probed: `parseJsonConfigFileContent`
  still parses them and `resolveModuleName` still resolves `paths` and `.js`→`.ts`. Option deprecation diagnostics are
  ignored by the analysis programs; they matter only to the project's own `tsc`.
- TS positions are UTF-16 indices. Spans are UTF-8 byte offsets, converted once per file with a prefix table (probed:
  an emoji and an accent before a declaration put it at UTF-16 21, UTF-8 24). The host slices with `Buffer` only.

Three analysis views, all in memory, all with `noLib: true` and `types: []`:

| View | Holds | Used for |
|---|---|---|
| File program | One file, `noResolve: true` | Declarations, spans, binder references, purity. Probed: imports, top-level names, `typeof X` in types, shorthand `{ a }` and JSX tags all resolve; globals resolve to nothing |
| Unit program | The original plus the same-folder modules it imports, with the project's options | The export surface: `getExportsOfModule` with aliases followed into new files (probed for value, type, class and `default`) |
| Module graph | Every tracked TS/JS file, built once per run | Import cycles (below) |

**The module graph.** Edges are every static `import` and `export … from`, and every `require('literal')`,
`import('literal')` and `jest.requireActual('literal')` at any depth, including inside functions. `import type` and
`export type` are not edges. Specifiers are resolved with `ts.resolveModuleName`; a bare name that matches a
workspace package (from the root `workspaces` or `pnpm-workspace.yaml`) resolves to that package's source entry. A file
that imports itself is in a cycle. A non-literal `require(x)` or `import(x)` in a file makes that file count as in a
cycle.

## Module format and skipped files

| File | Format | Split? |
|---|---|---|
| `.ts` `.tsx` `.mts` with `import`/`export` | ES module syntax; emitted as ESM or CommonJS per tsconfig | Per *Version 1 scope* |
| `.cts` with `import`/`export` | ES syntax, always emitted as CommonJS | Types only |
| `.js` `.jsx` `.mjs` with `import`/`export` and no top-level `require`, `module`, `exports` | ES module | Per *Version 1 scope* |
| `.cjs`, or a `.js` that uses `require`/`module.exports`/`exports.x` at top level | CommonJS | Skipped: *CommonJS module* |
| A file with `export =` or `export as namespace` | One export object | Skipped |
| A file with no `import` or `export` | Script: its top-level names are globals and a new file would never load | Skipped |

**Skipped files** (reported, never split):

- `.d.ts`, `.d.mts`, `.d.cts`;
- test and test-support files: `*.test.*`, `*.spec.*`, `*.stories.*`, and anything under `__tests__/`, `__mocks__/`,
  `__fixtures__/`, `test/`, `tests/`, `spec/`, `e2e/`, `cypress/` (Mocha runs every file in `test/`; Jest runs every
  file in `__tests__/`; `__mocks__/` paths are meaningful to Jest);
- config and entry scripts: `*.config.*`, `*.setup.*`, `setupTests.*`, `gulpfile.*`, `Gruntfile.*`, `.eslintrc.*`;
- build output and vendored code: `node_modules/`, `dist/`, `build/`, `out/`, `coverage/`, `vendor/`, `*.min.js`;
- generated code: a first comment containing `@generated`, `DO NOT EDIT`, `auto-generated` or `Code generated`, or a
  `linguist-generated` attribute, or names like `*.gen.ts`, `*_pb.ts`, `__generated__/`;
- minified-looking files: any line over 1,000 characters, or a file over 512 KB;
- files the parser reports errors for (this also catches Flow files and broken code);
- files with a BOM or CRLF line endings, as in Go;
- files with a directive prologue other than `'use strict'` (`'use client'`, `'use server'` and friends mark the file,
  and a new file would lack it);
- files with a file-level tool comment that new files would need: `// @ts-nocheck`, `// @ts-check`,
  `/* eslint-disable */` (whole file), `/* istanbul ignore file */`, `/* c8 ignore file */`, `@jsx`, `@jsxFrag`,
  `@jsxImportSource`, `@jsxRuntime`, `@flow`, `/// <amd-module />`. Other `/// <reference … />` lines stay in the
  original and still apply program-wide;
- files with decorators when `emitDecoratorMetadata` is on (metadata references types as run-time values);
- files whose imports are not one block at the top: every `import`, `import x = require()` and `export … from` must
  come before the first other statement (comments and blank lines between them are fine);
- files in an import cycle (module graph above);
- **tree-shaking:** the nearest `package.json` marks the original side-effect-free (`"sideEffects": false`, or a list
  that does not match it) and the original has any statement that is not quiet, or any side-effect import. A bundler
  may then drop or reorder code that runs;
- **folders something finds by path:** any tracked file holds a string or glob that names or matches the original's
  folder: `readdirSync`/`readdir` arguments, `import.meta.glob`, `require.context`, ORM entity globs
  (`entities: ['src/**/*.entity.ts']`), test or build globs. A non-literal `readdir`/`glob` argument matches every
  folder below its file;
- **framework convention folders,** found from the dependencies: Next.js `app/` and `pages/`; Nuxt `pages/`,
  `plugins/`, `composables/`, `utils/`, `layouts/`, `components/`, `middleware/`, `store/`, `server/`; Expo Router
  `app/`; SvelteKit `routes/` and `+` files; Astro `pages/`. Also any `api/` or `functions/` folder (serverless hosts);
- **public subpaths:** the nearest `package.json` `exports` has a wildcard subpath (`"./*": "./src/*.js"`), which would
  make a new file public;
- the nearest `package.json` has a `files` list that names the original by exact path (not by folder or glob): a new
  file would be left out of the published package.

Top-level `await` does **not** skip a file. It is ordinary code that runs, so declarations after it obey the
*quiet window* rule below.

## What may move

A **declaration** is one top-level statement, plus its attached comments: the comment lines directly above it with no
blank line between (JSDoc, `// eslint-disable-next-line`, `// @ts-expect-error`), up to the end of its last line,
so a trailing comment moves with it. A declaration that shares a line with other code is not movable. Overload
signatures and the implementation (`function f(a: string): void; function f(a: number): void; function f(a) {}`) are
**one** declaration with one span, because they must move together; so are `declare function` overloads.

**Definition-time code** is what runs when the declaration itself is evaluated: a variable's initializer; a class's
`extends` expression, computed member names, static field initializers and `static {}` blocks; an enum's member
initializers. Function bodies, methods, instance fields and parameter defaults run later and do not count.

**Pure** definition-time code is only:

- literals (string, number, bigint, boolean, `null`, regex) and templates without substitutions;
- function, arrow and class expressions (a class expression's own definition-time code must be pure);
- reads of module-scope bindings (this file's imports and top-level declarations), and of `undefined`, `NaN` and
  `Infinity`. Other global reads (`window`, `process`, `Error`) are not pure: a global can be an accessor;
- array literals and object literals of the above, with plain keys (identifiers, strings, numbers), no spread, no
  computed keys, no getters or setters;
- `new Map()`, `new Set()`, `new WeakMap()` and `new WeakSet()` with no arguments, when the name is the global one.

Everything else is not pure: property reads (getters), operators (`+`, comparisons and templates with substitutions
call `valueOf`/`toString`; `in` and `instanceof` call traps and `Symbol.hasInstance`), spread and destructuring
(iterators), calls, other `new`, tagged templates, assignments, `delete`, `await`, `yield` and `import()`.
`as`, `satisfies`, `!` and parentheses are transparent.

A statement is **quiet** if evaluating it runs no code: a function, interface, type alias, `declare` statement, a
class, variable or enum with pure definition-time code, an import or re-export, or an export list. Any other
statement runs code (a call, an impure initializer, an `if`, a top-level `await`, a namespace body).

**The quiet window rule.** A declaration other than a function or a type may move only if every top-level statement
before it in the original is quiet. After a move, the declaration is defined before the original's body starts. With
a quiet window, nothing ran before it in the original, so nothing could have changed what it reads or could observe
it being early (a `var` read as `undefined`, a `let` or class read in its temporal dead zone). Functions are created
when the module is linked, before any code runs, so they are never early. Types do not exist at run time.

**Order between moved names.** When a moved declaration's definition-time code reads another moved name (`const B =
A`, `class C extends Base`), the target must come earlier in the original and both must go to the same new file.
Otherwise the plan is rejected. New files run in facade order, not in the original's order, so a read across new
files could see a binding before it is set.

**Never reassigned.** A moved name of any kind (function, class, `let`, `var`) must not be assigned anywhere outside
its own declaration. After the move it is an import in the original and in sibling files, and imports cannot be
assigned.

| Declaration | Movable when | Why not otherwise |
|---|---|---|
| `function` (async, generator, overloads grouped), `export function`, `export default function` | Never reassigned (subject to the name rules) | Hoisted; no definition-time code |
| `interface`, `type` | Always (subject to the name rules) | Erased |
| `class`, `export default class` | No decorators anywhere in it; definition-time code pure; quiet window; never reassigned | Decorators run at definition (DI registration order, metadata) |
| `enum` | A single declaration; every member a literal or a reference to an earlier member; quiet window | Computed members run code |
| `const enum` | Never | Inlined across files by `tsc`, erased without `isolatedModules`, emitted with it (probed): its re-export behaves differently per tool |
| `const`, `let`, `var` | Plain names (no destructuring); pure initializer; quiet window; never reassigned | |
| `namespace`/`module` (not `declare`) | Never | Its body is an IIFE that runs code, and it merges |
| Anything `declare`d (`declare const`, `declare global`, `declare module`) | Never | Ambient: an exported `declare const` has no run-time export, so `export { x } from` would fail to link |
| A name with more than one declaration (interface + interface, class + interface, function + namespace, enum + enum) | Never, all parts | Declaration merging spans statements |
| `export default <expression>`, `export =`, export lists, imports, `import x = N.y`, expression and control statements | Never; they stay | Not declarations, or run code |
| A declaration containing JSX, when the tsconfig has `jsx: preserve` or there is no tsconfig | Never | Another tool compiles the JSX, with settings the host cannot read |
| A JS declaration whose doc comment has `@typedef`, `@callback` or `@import` | Never | Those tags declare file-level types other code may import |
| A declaration whose span uses `import.meta` (except `.dirname` and `.env`), `__filename`, a free `module` or `exports`, `require` other than `require('literal')`, or `eval` | Never | These name the module or its file. `__dirname` and relative paths are the same in the same folder |
| A declaration whose span uses `this`, `arguments` or `new.target` that binds at module level, including inside top-level arrow functions at any depth | Never | Module-level `this` differs per module (`exports` under CommonJS) |
| A declaration whose span contains `import.meta.glob`, `require.context` or a `readdir` | Never | It enumerates the folder, which now holds the new files |

## Names that cross files

The file program gives, for each declaration, every top-level name it references (from identifiers, JSX tags,
shorthand properties, `typeof` in types, and in JS files JSDoc type references), split into **value uses** and
**type-only uses**. With D a moved declaration in new file N:

| D uses X, and X… | Result |
|---|---|
| moves to N too | Nothing to do (definition-time reads: X must come earlier, see *Order between moved names*) |
| moves to another new file M, and X was exported by its own `export` keyword | N imports X from M. Value uses between new files must not form a cycle (type-only edges may). Definition-time reads across files are rejected |
| moves to another new file M, and X was not exported | **Plan rejected:** a helper moves to the same file as every declaration that uses it |
| is an import of the original | N gets that import, rebuilt from the original's declaration (below) |
| stays, and the use is type-only, and X is a type the original already exports by name (TS only) | N gets `import type { X } from './<original>'`. Erased everywhere, so no run-time edge |
| stays, any other case | **Plan rejected:** *declaration 7 (`parseRow`) uses `rowCache` (8), which stays. Move it to the same file or leave both.* |
| is a global or not found | Nothing to do; rule 6 checks it still binds the same way |

The other direction, with S a statement that stays in the original:

| S uses X, and X moved to N… | Result |
|---|---|
| X was exported by its own `export` keyword | The facade re-exports it and the original imports it for S |
| X was not exported | **Plan rejected.** *This is the general rule: no new exports, and no export list added to a new file* |
| X is a type named in a staying `export { … }` list | **Plan rejected.** Probed: `import type { I } …; export { I };` is an error under `verbatimModuleSyntax` (TS1205), and the list may not change |

`buildSplit` enforces these rules and throws a plain reason, which `planProblems` sends back to the model for its one
retry. The model's prompt lists, per declaration, `needs` (IDs it uses as values), `typeNeeds`, and whether it is
exported, so it can plan closed groups.

## Applying a split (host, no AI)

**A new file** is, in order:

1. `// Split from <original basename> by my_editor.` and a blank line;
2. its import lines (below), then a blank line;
3. the moved spans byte for byte, in original order, one blank line apart.

**Import lines in a new file.** For each of the original's import declarations, the new file gets the same declaration
filtered to the bindings its spans use. Every piece is copied as text from the original: the module specifier with
its quotes, each specifier (`a as b`, `type T`, `"x-y" as z`), the default name, `* as ns`, import attributes
(`with { type: 'json' }`), the `import type` keyword and the trailing semicolon or its absence. Only the list is
filtered; nothing is renamed. `import x = require('m')` is copied whole. Imports from sibling new files use the
specifier form below, `import type` for names without a value meaning. Side-effect imports (`import './x'`) are never
copied: they stay in the original, which still loads them first.

**Classic JSX.** When a moved span contains JSX and the tsconfig has `jsx: react` (classic), the new file also gets the
original's import of the `jsxFactory`/`jsxFragmentFactory` root name (`React` by default). `react-jsx` needs nothing.
`preserve` and no tsconfig are refused (above).

**The original** keeps everything else byte for byte, minus the moved spans (blank lines around a removed span collapse
to one, as in Go). Its import block changes only in these ways:

1. **Only specifiers written as types may be dropped.** A specifier in an `import type …` declaration, or written
   `type T` inline, is dropped when nothing left uses it, except that a declaration without `import type` is never
   emptied: if every specifier in it would go, it stays byte-identical (under `verbatimModuleSyntax`
   `import { type T } from 'm'` still loads `m`, under elision it does not, so neither change is safe for both).
2. **A specifier with no value use before the split stays byte-identical**, even if nothing uses it after. If the
   project has `noUnusedLocals`, `tsc` then fails differently from the baseline and the step is skipped.
3. **Load order is kept.** A specifier whose last value use moved is removed. If it was the declaration's last
   specifier, the declaration becomes a side-effect import of the same specifier (`import { z } from 'zod';` becomes
   `import 'zod';`): the declaration loaded its module before under both readings, and still does, at the same place
   in the original's import order. If other specifiers remain, the plan is rejected, because under elision they may no
   longer load the module. Side-effect imports always stay.
4. **The facade block** follows the last import (or, with no imports, comes before the first statement, after any
   `'use strict'`), then a blank line. Per new file: `import { … }` for moved names the original's staying code uses
   (`import type` when the name has no value meaning), then `export { … } from` for moved names that were exported by
   their own keyword, then `export type { … } from` for those that are types only:

```ts
import { formatRow } from './rows.js';
export { formatRow, parseRow } from './rows.js';
export type { RowError } from './rows.js';
```

   `export default` becomes `default` in the list (`export { default } from './x.js'`, and `import Foo from
   './x.js'` if staying code uses `Foo`). Probed: `export type { default } from` is valid and erased. Separate value
   and type lines work under `isolatedModules`, `verbatimModuleSyntax` and Node's type stripping.

"Loads its module at run time" depends on the compiler setting, which the host reads from tsconfig. Transform tools
reduce a project to types-only moves, so only `tsc`'s reading matters for run-time moves:

| Setting | A declaration loads its module when | Probed |
|---|---|---|
| `verbatimModuleSyntax`, `importsNotUsedAsValues` (any value but `remove`) or `preserveValueImports` | It is not `import type …`. `import { type A } from 'm'` still loads `m` | Emits `import {} from 'm'` |
| Otherwise | It is a side-effect import, or at least one binding is used as a value | A type-only use is elided |
| Plain JS | Always (there are no type-only uses) | — |

Because new files only import what the original imported (already loaded earlier in the original's import order),
other new files, and erased types, and because the facade comes after every original import, the new files run after
all the original's imports and before its body, and they only define things. The first load of every module happens
where it did before.

**Specifier form** for `./<new file>`:

1. Copy the style of the original's relative imports: `.js`-style suffix, `.ts`-style suffix, or none. The suffix is
   mapped by the new file's extension: `.ts`/`.tsx` → `.js`, `.mts` → `.mjs`, `.cts` → `.cjs` (or `.ts`, `.mts`,
   `.cts` when the original uses source extensions).
2. If the original has no relative import, copy the style of the relative imports in its sibling files in the same
   folder, if they all agree.
3. Otherwise the plan is rejected: *no relative import to copy the specifier style from.*
4. The host then resolves the specifier with `ts.resolveModuleName` and the project's options; it must reach the new
   file, else the plan is rejected.

Path aliases (`@/x`, `paths`, `baseUrl`, `#imports`) are never generated. Copied specifiers keep their aliases and
resolve the same, because the folder and tsconfig are the same.

## File names

`fileNameProblems(name, original)` (the interface gains the original's path; Go ignores it):

- `^[A-Za-z0-9][A-Za-z0-9._-]*$`, and the **same extension as the original** (`.ts` code moved into `.tsx` can parse
  differently: `<T>x` is a type assertion in one and JSX in the other);
- not `index.*`, not a `.d.ts`, `.test.`, `.spec.`, `.stories.`, `.config.` name, no leading `+` or `_`;
- not a framework file name: `page`, `layout`, `route`, `template`, `loading`, `error`, `not-found`, `default`,
  `head`, `middleware`, `instrumentation`, `_app`, `_document`, `_layout`;
- its stem (ignoring case) is not the stem of any existing file or folder in the folder: creating `utils.ts` next to
  `utils/index.ts` or `utils.js` changes what an extensionless `./utils` resolves to;
- the project's test globs (`jest.testMatch`, Vitest `include`) must not match it.

After the files are written, the tsconfig check runs (move rule 4): every tsconfig whose file list held the original
must hold each new file, and no other tsconfig may gain one. `tsc` itself would compile a new file anyway, because the
original imports it, but under `composite` an unlisted file is an error (TS6307), and editors pick a file's project by
its `include`. `rootDir` and `outDir` are kept by the same-folder rule: `rows.js` lands next to `report.js`.

## Move check (TS/JS)

Rules 1, 3 and 5 are the language-neutral ones on byte spans. Rule 2 and rule 4 get TS parts, and rule 6 is new.

1. Each moved span appears byte-identical in exactly the new file the plan names.
2. The original equals its old bytes minus the moved spans (blank lines may collapse). Its import block is checked by
   the adapter (`importProblems`): every old import declaration is unchanged, lost only unused specifiers written as types
   (never all of them unless it is `import type`) or specifiers whose last value use moved, or became a side-effect
   import under the load-order rule; the only added lines are the facade block, and it names only the
   plan's new files. Each new file's imports must be a filtered copy of an original import declaration, an import of
   a sibling new file, or `import type` from the original.
3. A new file holds only its header comment, import lines and moved spans.
4. Same declarations and same exports:
   - the unit's declarations (kind with its `export` keyword, names, doc comment) are the same multiset before and
     after, as in Go (`declarationProblems`); the unit is the original plus the same-folder modules it imports;
   - the original's **export surface** is the same: the same names, each with the same meanings (value, type,
     namespace), each resolving through any re-export to a declaration with the same bytes. Names from an existing
     `export * from 'pkg'` are compared as written;
   - each new file exports only what its moved spans export with their own keyword;
   - the tsconfig membership check above.
5. No other tracked file changed.
6. **Bindings are the same.** For every identifier in every moved span and every staying statement, the binder target
   after the move is the same as before: the same declaration (by its bytes), the same import (specifier and imported
   name), or the same global. A target reached through an import of a new file counts as the declaration it re-traces
   to. This proves that the computed imports are complete and that nothing got shadowed, and it works for plain JS.

Rules 2 and 6 run on the files as written and re-parsed from disk, not on the host's own build output.

## Checks per step

**Install, once per run, before the baseline.** The worktree has no `node_modules`. The approved commands include the
lockfile's install: `npm ci`, `pnpm install --frozen-lockfile`, `yarn install --immutable` (Berry) or
`--frozen-lockfile` (classic), `bun install --frozen-lockfile`. With no lockfile, splits are refused for the run (an
install would resolve different versions). Install scripts run, and the approval text says so. Symlinking the user's
`node_modules` is not used: workspace links in it point into the user's folder, so tests would run the user's code
instead of the branch. After install, every workspace package must resolve inside the worktree, and no tracked file
may have changed; otherwise stop with a plain message.

| Label | Command | Compared by |
|---|---|---|
| `install` | as above, once | Must succeed |
| `build` | `npx --no tsc --noEmit -p <tsconfig> --pretty false` for the tsconfig that holds the file (`pnpm exec tsc`, `yarn tsc` per package manager). With `references`: `tsc -b <tsconfig> --pretty false` (it writes build output in the worktree only) | Exit code and error lines, as in Go |
| `test` | The test script of the nearest `package.json` that has one: `npm test`, or the workspace form (`npm test -w <dir>`, `pnpm --filter ./<dir> test`, `yarn workspace <name> test`) | Per-test results when parsable, else exit code |

- `--no` matters: plain `npx tsc` with no local TypeScript downloads an unrelated npm package named `tsc`.
- `tsc` reports `path(line,col): error TS…`. The core's position pattern (`baseline.ts`) must also strip that form, so
  an old error inside a moved declaration still compares equal.
- Tests run with `CI=1` and `NO_COLOR=1`: Vitest and Jest then run once instead of watching, and Jest's `--ci`
  default refuses to write new snapshots (which would change tracked files).
- Per-test results: when the test script is a single runner call, the reporter flag is appended after `--`: Jest
  `--json`, Vitest `--reporter=json`, Mocha `--reporter json`, `node --test` `--test-reporter=tap`. Keys are
  `<test file> <describe › test>`; test files never move, so keys stay stable. Any other script (`build && jest`) is
  compared by exit code and the change note says so.
- Plain JS (function moves only): no build check. With no test command either, splits are offered but not
  pre-selected, and the change note says only the move check ran.

## What "unchanged" means

The change note says exactly what was shown, and no more.

**Types-only moves** (interfaces and type aliases). The original's emitted JavaScript is the same under both the
elision and the verbatim reading: the facade is `export type … from`; the only specifiers dropped are written as
types, from declarations that are `import type` (erased either way) or that keep another specifier (so they load, or
not, exactly as before); no value use moves. The new files are reached only through erased imports, so they never
run. Shown by: the move check and `tsc`.

**Run-time moves** (ES module output, `tsc` only, no transform tool, not under Jest). Shown by the move check, `tsc`
and the tests:

- every name in moved and staying code binds to the same declaration, import or global (rule 6);
- the original exports the same names with the same meanings, resolving to the same declaration bytes (rule 4);
- every module the original imported first loads at the same place in its import order;
- moved definitions run after all the original's imports and before its body. With pure definition-time code, a quiet
  window, same-file order for reads between moved names, and no cycle, no code runs between their old and new place;
- in production module objects (Node's ES modules, browsers, standard bundler output), re-exports are live bindings
  and namespace objects are sorted and frozen, so `instanceof`, singletons, `Object.keys(ns)` and assignment behave as
  before. Vitest and vite-node build their own module objects, whose keys and descriptors may differ; a test that
  inspects them is guarded only by the test comparison;
- each new module is imported only by the original and its siblings, each with one specifier, so it has one instance
  per instance of the original.

**What may still differ** (in the change note):

- file names and line numbers in stack traces, `console.trace` and logger caller fields;
- bundler output: chunk contents and module order inside a chunk (module run order is kept as above);
- development-only behavior: hot-reload boundaries and source maps.

**Why CommonJS output is types-only.** Under CommonJS a moved export becomes a getter on the original's `exports`
object, defined at the facade line. Probed: `tsc`'s getter is configurable (it first sets `exports.f = void 0`),
Babel's is not, so `jest.spyOn` works with one and throws with the other. A sloppy-mode `require('./x').f = g` is
silently ignored (probed), `Object.keys(require('./x'))` order changes, and an exported function is no longer set at
the very top of the module, which a cycle can observe. None of this is caught by `tsc`.

## Add-tests fix (TS/JS)

For a file flagged untested: `<name>.ai.test.<ext>` next to the source when the project keeps tests next to sources,
else in its test folder with the matching name. It must match the runner's test globs, import only the source, the
runner and the runner's mock helpers, not import `http`, `https`, `net` or `child_process`, not name a remote URL,
build, and pass twice. Failing tests are dropped by name (`it`/`test` blocks are found with the parser). This mirrors
Go and is a separate plan item.

## Components

In `src/aiready/`, each under 400 lines:

| Unit | Job | Interface |
|---|---|---|
| `tsLoad.ts` | Load the editor's TypeScript once; version gate | `loadTypeScript(appRoot): TS \| string` |
| `tsProject.ts` | tsconfig per file (parsed with `extends`), module format, run-as-CommonJS and transform-tool detection, the version 1 scope, import-retention setting, JSX mode, package manager, test script, workspaces, `sideEffects`, `exports` wildcards, framework folders, path-string scan, the module graph and its cycles | `tsProject(root, ts, tracked): TsProject` |
| `tsAst.ts` | Parse one file: statements, UTF-8 spans, overload groups, imports, binder references (value, type, definition-time), purity, assignments, merged symbols, module-level `this` | `tsFileFacts(ts, path, text, options): TsFacts` |
| `tsRules.ts` | Skip reasons, movability and reasons, the quiet window, file-name problems (pure) | `tsSkipReason(...)`, `tsFileInfoView(...)`, `tsFileNameProblems(...)` |
| `tsSplit.ts` | Name rules, new files, import filtering, specifier form, the original's import block and facade (pure) | `buildTsSplit(source, info, plan): SplitResult` |
| `tsMoveCheck.ts` | Rule 2's import block, rule 4's export surface and tsconfig membership, rule 6 bindings | `tsImportProblems(...)`, `tsSameDeclarations(...)` |
| `tsTests.ts` | Jest, Vitest, Mocha JSON and TAP parsing; test names; test-file problems | `parseTsTests(output)`, … |
| `tsPrompts.ts` | Split and test prompts (declarations with `needs`/`typeNeeds`/exported, sibling names for naming style) | `tsSplitPrompt(...)`, `tsTestPrompt(...)` |
| `tsAdapter.ts` | Wire it into `LanguageAdapter` | `createTsAdapter(root, ts, project, tracked)` |

`languages.ts` picks the TS adapter when the root has a `package.json`, `tsconfig.json` or `jsconfig.json` and no
`go.mod` (a mixed repo stays Go-first until adapters are chosen per file).

**Changes to the shared core** (small, Go unaffected):

| Change | Why |
|---|---|
| `fileNameProblems(name, original)` | Same-extension and stem-collision rules need the folder and extension |
| Optional `setup(): CheckCommand[]`, label `install`, run once after the worktree is made and before the baseline, approved with the rest | The worktree has no `node_modules` |
| Optional `importProblems(before, after, newFiles)`; when present it replaces the generic "original gained an import" check | The facade adds imports by design |
| `moveCheck.ts`: an empty `importRegion` marks where the facade goes | A file without imports still gets a facade |
| `baseline.ts`: strip `path(line,col): ` like `path:line:col:` | `tsc` error format |
| Optional `env` on `CheckCommand` | `CI=1`, `NO_COLOR=1` for tests |
| `commandDetect.ts`: `npx tsc` becomes `npx --no tsc` | Never download a package named `tsc` |

`unitFiles(file)` returns the original first, then the same-folder modules it imports, transitively. `unformatted`
runs the project's Prettier with `--check` only when Prettier and its config are present.

## Tests

Pure unit tests, with the dev-dependency TypeScript and, when `MY_EDITOR_TS` is set, the shipped one:

- **Scope:** an ESM `tsc`-only project allows run-time moves; `module: commonjs`, a `.cts` file, a CommonJS package
  under `nodenext`, Jest, a `.babelrc`, `.swcrc`, an esbuild `tsconfigRaw`, Sucrase, Metro or `tsx` reduce it to
  types; a tsconfig without `module` or without `moduleResolution` skips; plain JS ESM allows functions only.
- **Spans:** JSDoc and `//` comments attached; a detached comment (blank line) stays; a trailing comment moves;
  `// @ts-expect-error` above a declaration moves with it; overloads form one declaration; a declaration sharing a
  line is unmovable; UTF-8 offsets with emoji and accents before a span.
- **Purity:** `/a/`, `'x'`, `` `x` ``, `() => 1`, `[1, A]`, `{ a: 1 }` and `new Map()` are pure; `` `${a}` ``,
  `a + b`, `a.b`, `'k' in o`, `x instanceof C`, `[...a]`, `{ [k]: 1 }`, `{ get x() {} }`, `new Map([[1, 2]])`,
  `Symbol('s')`, `Object.freeze({})` and `f()` are not.
- **Movability:** a function after `init();` moves; a `const` after `init();` does not (quiet window); a class with a
  decorator, a static block calling code, or `extends mixin(B)` does not; `extends Base` with `Base` an import after
  quiet statements does; `extends Error` and `const x = window` (global reads) do not; `const B = A` with `A` later in the file, or in another new file, is rejected; a `let`, a
  function or a class assigned elsewhere does not move; a literal enum moves, a computed one and a `const enum` do
  not; merged declarations, `declare const`, `declare global` and a namespace do not; `import.meta.url`,
  `__filename`, top-level `this`, and `this` or `arguments` inside a top-level arrow (also nested arrows) refuse;
  `__dirname` and `require('./x')` inside a function move; JSX under `jsx: preserve` or without tsconfig refuses; a
  JSDoc `@typedef` refuses.
- **Skipped files:** CommonJS `.js`, `.cjs`, `export =`, a script file, `'use client'`, `// @ts-nocheck`, CRLF, a
  parse error, a `.d.ts`, a test file, a generated header, decorators with `emitDecoratorMetadata`, an import after a
  statement; `sideEffects: false` with a top-level call or a side-effect import; a folder named by a `readdirSync`
  string, an `import.meta.glob`, or an ORM entity glob in another file; Nuxt `composables/`, Next `app/`, Expo
  `app/`, SvelteKit `routes/`, Astro `pages/` when the dependency is present; `exports` with `"./*"`.
- **Cycles:** a two-file static cycle; a cycle through `require('./a')` inside a function; through `import('./a')`;
  through `jest.requireActual('./a')`; a self-import; a cycle through a workspace package name; a non-literal
  `require(x)`; a type-only cycle does **not** skip.
- **Name rules:** a moved function using a staying helper is rejected with both IDs; moving both passes; a type-only
  use of an exported staying interface gets `import type` from the original; of a non-exported one is rejected; a
  non-exported helper used by staying code, or by two new files, is rejected; an exported one used by another new file
  is imported from its new file; a value cycle between two new files is rejected and a type-only one passes; a type
  in a staying `export { I }` list is rejected.
- **Imports:** filtered specifiers keep `as`, `type`, default, namespace, attributes, quotes and semicolons; side-effect
  imports stay only in the original; classic JSX copies `React`, `react-jsx` does not.
- **The original's import block:** an unused `import type` specifier and an unused inline `type T` are dropped; the
  last inline `type T` of a plain `import { … }` is kept byte-identical; a specifier with no value use before stays
  byte-identical (and `noUnusedLocals` then skips the step through the build comparison); a declaration whose last
  specifier lost its last value use becomes `import 'm'`; one whose other specifiers remain is rejected; a types-only
  move leaves the original's emitted JavaScript identical under both `verbatimModuleSyntax` and elision; the facade has separate value and type lines; `export default
  function` re-exports as `default`; a file with no imports gets its facade after `'use strict'`.
- **Specifiers:** copies `.js`, `.ts` or none from the original; `.mts` maps to `.mjs` and `.cts` to `.cjs`; falls back
  to siblings that agree; rejects when there is nothing to copy or siblings disagree; a specifier that does not resolve
  is rejected.
- **File names:** different extension, `index.ts`, `page.tsx`, a stem matching `utils/`, a test-glob match.
- **Move check:** pass on a clean split; fail on an edited body, an added side-effect import in a new file, an import
  of a module the original did not import, an added `export { … }` in a new file, a facade naming a file outside the
  plan, a dropped export, a changed export meaning (class re-exported with `export type`), a shadowing import
  (rule 6), a tsconfig that does not include the new file.
- **Checks:** `tsc` lines with `path(l,c):` compare equal after a move; Jest `--json`, Vitest JSON, TAP parsing;
  `npx --no` in every built command; no lockfile refuses; no `push`, `fetch` or `remote` git command.
- **End to end** in a dev host with a real model, on fixtures: a 600-line ESM `.ts` checked by `tsc` with Vitest (two
  classes, an interface used by both, a helper); a React `.tsx` with `react-jsx`; a Jest project (types-only moves
  only); an ESM `.mjs` with no tsconfig (functions only); an npm-workspaces monorepo. Expect builds and tests equal to
  the baseline, one commit per split, the user's folder untouched.

## Out of scope for this version

- Run-time moves under CommonJS output, Jest, or any transform tool.
- CommonJS source files, `export =`, script files, namespaces, `const enum`, decorators, declaration merging.
- Moving declarations with impure definition-time code, even when the order could be proven.
- Adding exports: an `export { helper }` list in a new file, or a value import back from the original.
- Splitting test files, `.d.ts`, Vue and Svelte single-file components.
- Updating callers to import from the new files.

## Review: the points most likely to be wrong

1. **Detecting "runs as CommonJS" and "transform tool present".** It is read from tsconfig, file extensions,
   `package.json` `type`, dependencies and config files. A tool we do not know (a custom loader, `ts-node` options
   in a script, a bundler plugin) could still transform the code.
2. **Path-string and framework-folder scans** are pattern matches. A loader that builds its path from pieces at run
   time, or a framework not in the list, could still pick up a new file.
3. **Load order through the side-effect-import rewrite** relies on `tsc`'s import elision being the one that runs.
4. **The module graph** may miss edges hidden behind loaders or computed specifiers in files that are not tracked.
5. **The shipped TypeScript is VS Code's.** If the editor moves to TypeScript 7, the adapter stops with a message
   until it is ported, or the extension must ship its own copy.
6. **Install in the worktree** runs the project's install scripts and may take minutes; a project whose `postinstall`
   writes tracked files cannot be fixed.

Related: [AI-ready design](2026-10-07-ai-ready-design.md), [Stage 2 Go plan](2026-10-09-ai-ready-stage2-go-plan.md).
