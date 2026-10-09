# Make a project AI-ready: TypeScript and JavaScript (Stage 2b)

- **Date:** 9 October 2026
- **Status:** Design, not built. Needs review before a plan.
- **Builds on:** [AI-ready design](2026-10-07-ai-ready-design.md), *Stage 2a: Go* (the model followed here), the
  `LanguageAdapter` interface on branch `ai-ready-go`
- **Replaces for TS/JS:** the general Stage 2 rules (extractor, split, refuse-to-split list, move check). Where this
  file and the general rules differ, this file wins, and the difference is named.

## Goal

Split an oversized `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx` or `.mjs` file into focused files in the same folder.
Whole top-level declarations move byte for byte. The original path keeps exporting exactly what it exported, through a
re-export facade, so no caller changes. The program must behave as before, and the host must be able to show it
without trusting the model.

## Why TS/JS is harder than Go

In Go, files in a package share one namespace: a move changes no import and no caller. In TS/JS every file is its own
module. A move adds a module, adds import edges, and changes when code runs. Four things can change behavior while
the compiler and a thin test suite stay green:

1. **Evaluation order.** Imported modules run before the importing module's body. A moved declaration's
   definition-time code (an initializer, a class's `extends`, static fields) now runs earlier.
2. **Which modules load, and when.** Removing an import from the original can move a library's first load later.
3. **Cycles.** With CommonJS output, `export function f` is assigned to `exports` at the very top, but a re-export is
   a getter defined at the facade line. A module in a cycle that reads `f` early sees it before the move and
   `undefined` after.
4. **Module-relative values.** `import.meta.url`, `__filename`, top-level `this` and stack traces name the file.

Each rule below exists to close one of these. When a rule cannot decide, the move is refused.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Parser | The TypeScript compiler API that ships with the editor, for TS and JS alike. Never regexes | One parser and one binder for every flavor; JSX, JSDoc and TS syntax all parse |
| Type checker | Used for name resolution and the export surface, on small in-memory programs. The project's own `tsc` is only the build check | Analysis must not depend on the project's TS version or on `node_modules` |
| Where new files go | The original's folder | Every relative specifier copied byte for byte (`./x`, `require('./x')`, `import('./x')`, `new URL('./x', …)`) resolves the same, and the same tsconfig applies |
| The original after a split | Its old bytes, minus moved spans, plus a facade block after its imports | Callers and `package.json` `exports` keep the old path |
| What may move | Functions, interfaces, type aliases, and classes, `const`/`let`/`var` and enums whose definition-time code is pure and comes after no code that runs | See *What may move* |
| Imports in new files | Built by the host from binder references, copied from the original's import declarations. The model never writes import lines | The general rules let the model write import lines; that is dropped |
| A moved declaration that uses a name that stays | Refused, except a type-only use of a type the original already exports | A value import back into the original is a cycle with the facade |
| CommonJS source (`require`, `module.exports`) | File skipped in this version | Its exports are built at run time; there is nothing static to check |
| Files in a runtime import cycle | Skipped | CommonJS output (including Jest's transform) changes when a re-exported name becomes readable |
| Characterization tests before splits | Not required, as in Go | The binding and export checks below prove name resolution unchanged; generated tests would not catch the residual risks either |
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
- TS 6 deprecates `moduleResolution: node10`, `baseUrl`, `target: es5` and others. Probed: `parseJsonConfigFileContent`
  still parses them without config errors and `resolveModuleName` still resolves `paths` and `.js`→`.ts`. Option
  deprecation diagnostics are ignored by the analysis programs; they matter only to the project's own `tsc`.
- TS positions are UTF-16 indices. Spans are UTF-8 byte offsets, converted once per file with a prefix table (probed:
  an emoji and an accent before a declaration put it at UTF-16 21, UTF-8 24). The host slices with `Buffer` only.

Three analysis views, all in memory, all with `noLib: true` and `types: []`:

| View | Holds | Used for |
|---|---|---|
| File program | One file, `noResolve: true` | Declarations, spans, binder references, purity. Probed: imports, top-level names, `typeof X` in types, shorthand `{ a }` and JSX tags all resolve; globals resolve to nothing |
| Unit program | The original plus the same-folder modules it imports, with the project's options | The export surface: `getExportsOfModule` with aliases followed into new files (probed for value, type, class and `default`) |
| Module graph | Every tracked TS/JS file of a tsconfig, imports from the parser, resolved with `ts.resolveModuleName` and a cache; built once per run | Runtime import cycles |

## Module format and skipped files

| File | Format | Split? |
|---|---|---|
| `.ts` `.tsx` `.mts` with `import`/`export` | ES module syntax (emitted as ESM or CommonJS) | Yes |
| `.cts` with `import`/`export` | ES syntax, always emitted as CommonJS | Yes |
| `.js` `.jsx` `.mjs` with `import`/`export` and no top-level `require`, `module`, `exports` | ES module | Yes |
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
  and a new file would lack it). `'use strict'` is harmless: ES modules are strict, and probed: TypeScript's CommonJS
  output starts with `"use strict"` for every module file;
- files with a file-level tool comment that new files would need: `// @ts-nocheck`, `// @ts-check`,
  `/* eslint-disable */` (whole file), `/* istanbul ignore file */`, `/* c8 ignore file */`, `@jsx`, `@jsxFrag`,
  `@jsxImportSource`, `@jsxRuntime`, `@flow`, `/// <amd-module />`. Other `/// <reference … />` lines stay in the
  original and still apply program-wide;
- files whose imports are not one block at the top: every `import`, `import x = require()` and `export … from` must
  come before the first other statement (comments and blank lines between them are fine);
- files in a runtime import cycle (module graph above; `import type` and `export type` edges do not count; other
  imports count even if a compiler would elide them);
- files in a file-system router folder, where a new file becomes a page or endpoint: any path segment `pages`,
  `routes`, `api`, `functions`, `middleware`, or a SvelteKit `+` file;
- files a dynamic loader may enumerate: the folder is matched by an `import.meta.glob(…)` or `require.context(…)` call
  anywhere in the tracked sources (a non-literal argument matches every folder below its file), or a file in the
  folder reads its own directory (`readdirSync(__dirname)`, `readdir(import.meta.dirname)`);
- files whose nearest `package.json` has a `files` list that names the original by exact path (not by folder or glob):
  a new file would be left out of the published package.

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

**Pure** definition-time code only builds values and reads: literals, templates, regex literals, array and object
literals without spread, function, arrow and class expressions (whose own definition-time code is pure), identifier
reads, property reads, unary, binary, logical and conditional operators, and `as`/`satisfies`/`!`/parentheses. Also
pure: `new Map()`, `new Set()`, `new WeakMap()`, `new WeakSet()`, `Symbol('…')` and `Object.freeze(…)` of pure code,
when the name is the global one (not shadowed). Calls, other `new`, tagged templates, assignments, `++`/`--`,
`delete`, `await`, `yield` and `import()` are not pure.

A statement is **quiet** if evaluating it runs no code with effects: a function, interface, type alias, `declare`
statement, a class, variable or enum with pure definition-time code, an import or re-export, or an export list. Any
other statement runs code (a call, an effectful initializer, an `if`, a top-level `await`, a namespace body).

**The quiet window rule.** A declaration other than a function or a type may move only if every top-level statement
before it in the original is quiet. After a move, the declaration is defined before the original's body starts. With
a quiet window, nothing that ran before it in the original could have changed what it reads, or could observe it
being early (a `var` read as `undefined`, a `let` or class read in its temporal dead zone). Functions are created when
the module is linked, before any code runs, so they are never early. Types do not exist at run time.

| Declaration | Movable when | Why not otherwise |
|---|---|---|
| `function` (async, generator, overloads grouped), `export function`, `export default function` | Always (subject to the name rules) | Hoisted; no definition-time code |
| `interface`, `type` | Always | Erased |
| `class`, `export default class` | No decorators anywhere in it; definition-time code pure; quiet window | Decorators run at definition (DI registration order, `emitDecoratorMetadata` references) |
| `enum` | A single declaration; every member has a constant value (`checker.getConstantValue`); quiet window | Computed members run code |
| `const enum` | Never | Inlined across files by `tsc`, erased without `isolatedModules`, emitted with it (probed): its re-export behaves differently per tool |
| `const`, `let`, `var` | Plain names (no destructuring); pure initializer; quiet window; a `let`/`var` is never assigned outside its own declaration | A reassigned binding would become an import, which cannot be assigned |
| `namespace`/`module` (not `declare`) | Never | Its body is an IIFE that runs code, and it merges |
| Anything `declare`d (`declare const`, `declare global`, `declare module`) | Never | Ambient: an exported `declare const` has no run-time export, so `export { x } from` would fail to link |
| A name with more than one declaration (interface + interface, class + interface, function + namespace, enum + enum) | Never, all parts | Declaration merging spans statements |
| `export default <expression>`, `export =`, export lists, imports, `import x = N.y`, expression and control statements | Never; they stay | Not declarations, or run code |
| A JS declaration whose doc comment has `@typedef`, `@callback` or `@import` | Never | Those tags declare file-level types other code may import |
| A declaration whose span uses `import.meta` (except `.dirname` and `.env`), `__filename`, a free `module` or `exports`, `require` other than `require('literal')`, `eval`, or top-level `this`, `arguments` or `new.target` | Never | These name the module or its file. `__dirname` and relative paths are the same in the same folder, so they are fine |
| A declaration whose span contains `import.meta.glob` or `require.context` | Never | It enumerates the folder, which now holds the new files |

## Names that cross files

The file program gives, for each declaration, every top-level name it references (from identifiers, JSX tags,
shorthand properties, decorators, `typeof` in types, and in JS files JSDoc type references), split into **value uses**
and **type-only uses**. With D a moved declaration in new file N:

| D uses X, and X… | Result |
|---|---|
| moves to N too | Nothing to do |
| moves to another new file M | N imports X from M. Value uses between new files must not form a cycle (type-only edges may) |
| is an import of the original | N gets that import, rebuilt from the original's declaration (below) |
| stays, and the use is type-only, and X is a type the original already exports by name (TS only) | N gets `import type { X } from './<original>'`. Erased everywhere, so no run-time edge |
| stays, any other case | **Plan rejected:** *declaration 7 (`parseRow`) uses `rowCache` (8), which stays. Move it to the same file or leave both.* |
| is a global or not found | Nothing to do; rule 6 checks it still binds the same way |

The other direction, with S a statement that stays in the original:

| S uses X, and X moved to N… | Result |
|---|---|
| X was exported by its own `export` keyword | Nothing extra: the facade re-exports it and the original imports it for S |
| X was not exported | N gets a trailing `export { X };` (or `export type { X };`); the original imports it. The original's export surface is unchanged. *This relaxes the general rule, which refused such moves because adding `export` edits the span; a separate export list does not* |
| X is a type named in a staying `export { … }` list | **Plan rejected.** Probed: `import type { I } …; export { I };` is an error under `verbatimModuleSyntax` (TS1205), and the list may not change |

A non-exported helper used by two new files is handled the same way: it moves to one of them, which exports it, and
the other imports it.

`buildSplit` enforces these rules and throws a plain reason, which `planProblems` sends back to the model for its one
retry. The model's prompt lists, per declaration, `needs` (IDs it uses as values) and `typeNeeds`, so it can plan
closed groups.

## Applying a split (host, no AI)

**A new file** is, in order:

1. `// Split from <original basename> by my_editor.` and a blank line;
2. its import lines (below), then a blank line;
3. the moved spans byte for byte, in original order, one blank line apart;
4. if needed, one `export { … };` line and one `export type { … };` line for moved names the original or a sibling
   imports but that were not exported.

**Import lines in a new file.** For each of the original's import declarations, the new file gets the same declaration
filtered to the bindings its spans use. Every piece is copied as text from the original: the module specifier with
its quotes, each specifier (`a as b`, `type T`, `"x-y" as z`), the default name, `* as ns`, import attributes
(`with { type: 'json' }`), the `import type` keyword and the trailing semicolon or its absence. Only the list is
filtered; nothing is renamed. `import x = require('m')` is copied whole. Imports from sibling new files use the
specifier form below, `import type` for names without a value meaning. Side-effect imports (`import './x'`) are never
copied: they stay in the original, which still loads them first.

**Classic JSX.** When a moved span contains JSX and the file is compiled with the classic runtime (`jsx: react` or
`react-native` in tsconfig; for JS without tsconfig, the original imports `React` and uses it only through JSX), the
new file also gets the original's `React` import (or the `jsxFactory`/`jsxFragmentFactory` root names). The
automatic runtime needs nothing.

**The original** keeps everything else byte for byte, minus the moved spans (blank lines around a removed span collapse
to one, as in Go). Its import block changes in exactly three ways:

1. A specifier that nothing left in the original uses is removed, unless that changes when its module loads (next
   rule). Side-effect imports always stay.
2. **Load order is kept.** If a declaration loaded its module at run time before the split and would not after, it
   becomes a side-effect import of the same specifier (`import { z } from 'zod';` becomes `import 'zod';`). The
   module still first loads at the same place in the original's import order. If only some specifiers remain and
   they no longer load the module (only type uses left, under elision), the plan is rejected.
3. **The facade block** follows the last import (or, with no imports, comes before the first statement, after any
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

"Loads its module at run time" depends on the compiler setting, and the host reads it from tsconfig:

| Setting | A declaration loads its module when | Probed |
|---|---|---|
| `verbatimModuleSyntax` (or Babel with `onlyRemoveTypeImports`) | It is not `import type …`. `import { type A } from 'm'` still loads `m` | Emits `import {} from 'm'` |
| Otherwise (tsc default, `isolatedModules`, esbuild, swc, Babel default) | It is a side-effect import, or at least one binding is used as a value | A type-only use is elided |
| Plain JS | Always (there are no type-only uses) | — |

If a TS project has a Babel config whose setting cannot be read, and the two readings disagree for a declaration the
split touches, the plan is rejected.

Because new files only import what the original imported (already loaded earlier in the original's import order),
other new files, and erased types, and because the facade comes after every original import, the new files run after
all the original's imports and before its body, and they only define things. The first load of every module happens
where it did before.

**Specifier form** for `./<new file>`, decided once per file:

1. If the original has relative imports, copy their style: `.js` suffix, `.ts` suffix, or none.
2. Otherwise from the compiler options: `module`/`moduleResolution` `node16` or `nodenext` with the file emitted as
   ESM (`.mts`, or `"type": "module"`), or a JS ESM file run by Node: `.js`. `allowImportingTsExtensions` or
   `rewriteRelativeImportExtensions`: `.ts`. Otherwise (`bundler`, `node10`): none.
3. The host then resolves the specifier with `ts.resolveModuleName` and the project's options; it must reach the new
   file, else the plan is rejected.

Path aliases (`@/x`, `paths`, `baseUrl`, `#imports`) are never generated. Copied specifiers keep their aliases and
resolve the same, because the folder and tsconfig are the same.

## File names

`fileNameProblems(name, original)` (the interface gains the original's path; Go ignores it):

- `^[A-Za-z0-9][A-Za-z0-9._-]*$`, and the **same extension as the original** (`.ts` code moved into `.tsx` can parse
  differently: `<T>x` is a type assertion in one and JSX in the other);
- not `index.*`, not a `.d.ts`, `.test.`, `.spec.`, `.stories.`, `.config.` name, no leading `+` or `_`;
- not a framework file name: `page`, `layout`, `route`, `template`, `loading`, `error`, `not-found`, `default`,
  `head`, `middleware`, `instrumentation`, `_app`, `_document`;
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
   the adapter (`importProblems`): every old import declaration is unchanged, lost only unused specifiers, or became a
   side-effect import under the load-order rule; the only added lines are the facade block, and it names only the
   plan's new files. Each new file's imports must be a filtered copy of an original import declaration, an import of
   a sibling new file, or `import type` from the original.
3. A new file holds only its header comment, import lines, moved spans and its trailing export lines.
4. Same declarations and same exports:
   - the unit's declarations (kind with its `export` keyword, names, doc comment) are the same multiset before and
     after, as in Go (`declarationProblems`); the unit is the original plus the same-folder modules it imports;
   - the original's **export surface** is the same: the same names, each with the same meanings (value, type,
     namespace), each resolving through any re-export to a declaration with the same bytes. Names from an existing
     `export * from 'pkg'` are compared as written;
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
`--frozen-lockfile` (classic), `bun install --frozen-lockfile`; `npm install` without a lockfile. It runs the
project's install scripts, which the approval text says. Symlinking the user's `node_modules` is not used: workspace
links in it point into the user's folder, so tests would run the user's code instead of the branch. After install,
every workspace package must resolve inside the worktree, and no tracked file may have changed; otherwise stop with a
plain message.

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
- No `tsconfig.json` (plain JS): no build check. A split then rests on the move check and tests. With neither tsc nor a
  test command, splits are offered but not pre-selected, and the change note says only the move check ran.

## What "unchanged" means

The program's behavior, not where code lives. The change note lists what may differ:

- file names and line numbers in stack traces, `console.trace`, and logger caller fields;
- with CommonJS output (tsc `module: commonjs`, `.cts`, Jest's Babel or ts-jest transform), a moved export becomes a
  getter on the original's `exports` (probed: `Object.defineProperty(exports, "f", { enumerable: true, get … })`,
  not configurable). Reading it gives the same object, so `instanceof` and singletons hold. But
  `jest.spyOn(module, 'f')`, `sinon.stub` and assignment to that property fail, and the key order of
  `Object.keys(require('./x'))` may change. A test that spies this way fails, so the step is skipped, not committed.
  ES module namespaces are sorted and immutable, so nothing changes there.

A moved class or variable is defined earlier than before, but the quiet window rule means no code ran before it in
the original, and the cycle rule means no other module can reach the original early, so nothing can observe the
difference (no temporal-dead-zone error turns into a value, no `var` read as `undefined` turns into one).

**Module identity.** Each new module is imported only by the original and its sibling new files, each with one
specifier, so it is instantiated exactly once per instance of the original, in ESM, CommonJS, Jest's module registry
(`resetModules`, `isolateModules` reset both) and bundlers.

Refused rather than accepted (see *What may move*): `import.meta.url`, `import.meta.filename`, `__filename`,
`import.meta.hot`, top-level `this`, `eval`.

## Add-tests fix (TS/JS)

For a file flagged untested: `<name>.ai.test.<ext>` next to the source when the project keeps tests next to sources,
else in its test folder with the matching name. It must match the runner's test globs, import only the source, the
runner and the runner's mock helpers, not import `http`, `https`, `net` or `child_process`, not name a remote URL,
build, and pass twice. Failing tests are dropped by name (`it`/`test` blocks are found with the
parser). This mirrors Go and is a separate plan item.

## Components

In `src/aiready/`, each under 400 lines:

| Unit | Job | Interface |
|---|---|---|
| `tsLoad.ts` | Load the editor's TypeScript once; version gate | `loadTypeScript(appRoot): TS \| string` |
| `tsProject.ts` | tsconfig per file (parsed with `extends`), module format, `verbatimModuleSyntax`, JSX mode, specifier form, package manager, test script, the module graph and its cycles | `tsProject(root, ts, tracked): TsProject` |
| `tsAst.ts` | Parse one file: statements, UTF-8 spans, overload groups, imports, binder references (value and type), definition-time purity, merged symbols | `tsFileFacts(ts, path, text, options): TsFacts` |
| `tsRules.ts` | Skip reasons, movability and reasons, the quiet window, file-name problems (pure) | `tsSkipReason(...)`, `tsFileInfoView(...)`, `tsFileNameProblems(...)` |
| `tsSplit.ts` | Name rules, new files, import filtering, the original's import block and facade (pure) | `buildTsSplit(source, info, plan): SplitResult` |
| `tsMoveCheck.ts` | Rule 2's import block, rule 4's export surface and tsconfig membership, rule 6 bindings | `tsImportProblems(...)`, `tsSameDeclarations(...)` |
| `tsTests.ts` | Jest, Vitest, Mocha JSON and TAP parsing; test names; test-file problems | `parseTsTests(output)`, … |
| `tsPrompts.ts` | Split and test prompts (declarations with `needs`/`typeNeeds`, sibling names for naming style) | `tsSplitPrompt(...)`, `tsTestPrompt(...)` |
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

- **Spans:** JSDoc and `//` comments attached; a detached comment (blank line) stays; a trailing comment moves;
  `// @ts-expect-error` above a declaration moves with it; overloads form one declaration; a declaration sharing a
  line is unmovable; UTF-8 offsets with emoji and accents before a span.
- **Movability:** a function after `init();` moves; a `const` after `init();` does not (quiet window); `const x =
  compute()` does not; `const re = /a/`, `const m = new Map()` and `export const f = () => 1` do; a class with a
  decorator, a static block calling code, or `extends mixin(B)` does not; `extends Base` after quiet statements does;
  a `let` assigned elsewhere does not; a constant enum moves, a computed one and a `const enum` do not;
  `interface A` twice, `class C` + `interface C`, function + namespace do not; `declare const`, `declare global`, a
  namespace do not; `import.meta.url`, `__filename`, top-level `this` refuse; `__dirname` and `require('./x')` inside
  a function move; a JSDoc `@typedef` refuses.
- **Skipped files:** CommonJS `.js`, `.cjs`, `export =`, a script file, `'use client'`, `// @ts-nocheck`, CRLF, a
  parse error, a `.d.ts`, a test file, a generated header, a file in `pages/`, a folder matched by `import.meta.glob`,
  a file in a two-file import cycle (and not for a type-only cycle), an import after a statement.
- **Name rules:** a moved function using a staying helper is rejected with both IDs; moving both passes; a type-only
  use of an exported staying interface gets `import type` from the original; of a non-exported one is rejected; a
  value cycle between two new files is rejected and a type-only one passes; a non-exported helper used by staying code
  gets a trailing `export { helper }`; a type in a staying `export { I }` list is rejected.
- **Imports:** filtered specifiers keep `as`, `type`, default, namespace, attributes, quotes and semicolons; side-effect
  imports stay only in the original; classic JSX copies `React`, automatic does not.
- **The original's import block:** an unused specifier is removed; a fully unused value import becomes `import 'm'`;
  a type-only import with no uses left is removed under elision and becomes `import 'm'` under
  `verbatimModuleSyntax` unless it was `import type`; the partial case that would stop loading `m` is rejected; the
  facade has separate value and type lines; `export default function` re-exports as `default`; a file with no
  imports gets its facade after `'use strict'`.
- **Specifiers:** copies `.js`, `.ts` or none from the original; falls back by `moduleResolution`; a specifier that
  does not resolve is rejected.
- **File names:** different extension, `index.ts`, `page.tsx`, a stem matching `utils/`, a test-glob match.
- **Move check:** pass on a clean split; fail on an edited body, an added side-effect import in a new file, an import
  of a module the original did not import, a facade naming a file outside the plan, a dropped export, a changed export
  meaning (class re-exported with `export type`), a shadowing import (rule 6), a tsconfig that does not include the new
  file.
- **Checks:** `tsc` lines with `path(l,c):` compare equal after a move; Jest `--json`, Vitest JSON, TAP parsing;
  `npx --no` in every built command; no `push`, `fetch` or `remote` git command.
- **End to end** in a dev host with a real model, on fixtures: a 600-line `.ts` (two classes, an interface used by
  both, a helper), a React `.tsx` (classic and automatic runtime), an ESM `.mjs` with no tsconfig, a Jest project
  using `jest.spyOn` on the original (the step must be skipped by the test comparison), and an npm-workspaces
  monorepo. Expect builds and tests equal to the baseline, one commit per split, the user's folder untouched.

## Out of scope for this version

- CommonJS source files, `export =`, script files, namespaces, `const enum`, decorators, declaration merging.
- Moving declarations with effectful definition-time code, even when the order could be proven.
- Importing a staying value back from the original (would allow module-level loggers and caches to stay put).
- Splitting test files, `.d.ts`, Vue and Svelte single-file components.
- Updating callers to import from the new files.

## Review: the points most likely to be wrong

1. **The quiet window and "pure" reads.** The proof treats property reads, `valueOf` and getters at definition time
   as effect-free. A getter with side effects read by a moved class's `extends` or a static field is outside it.
2. **Load order through the side-effect-import rewrite.** It assumes the project's compile setting is readable. Babel
   configs, `ts-jest` `isolatedModules`, and esbuild's tsconfig handling may disagree with tsconfig.
3. **CommonJS output in tests.** Getter re-exports break spies; the test comparison is the only guard. A project with
   few tests that monkeypatches its own module exports in production code would not be caught.
4. **Cycle detection** uses the module graph with every non-`type` import counted. Dynamic `import()` and
   `require()` inside functions are not edges; a cycle that only exists through them is missed.
5. **Dynamic loaders and file-system routing** are matched by folder names and call patterns. A framework with other
   conventions (Nuxt `server/`, Astro `src/pages`, custom plugin loaders) could pick up a new file.
6. **Allowing `export { helper }` in new files and `import type` back from the original** goes beyond the general
   rules. Both are erased or invisible from outside, but they widen what a reviewer must trust.
7. **The shipped TypeScript is VS Code's.** If the editor moves to TypeScript 7, the adapter stops with a message
   until it is ported, or the extension must ship its own copy.
8. **Install in the worktree** runs the project's install scripts and may take minutes; a project whose `postinstall`
   writes tracked files cannot be fixed.

Related: [AI-ready design](2026-10-07-ai-ready-design.md), [Stage 2 Go plan](2026-10-09-ai-ready-stage2-go-plan.md).
