# Make a project AI-ready: Rust (Stage 2e)

- **Date:** 10 October 2026 (revised the same day after an adversarial review with rustc 1.88 probes: child modules
  with specific refusals replace the first draft's `include!` splice)
- **Status:** Design, not built. Needs review before a plan.
- **Builds on:** [AI-ready design](2026-10-07-ai-ready-design.md), *Stage 2a: Go*,
  [TS/JS design](2026-10-09-ai-ready-ts-design.md), [Python design](2026-10-10-ai-ready-python-design.md) and
  [C# design](2026-10-10-ai-ready-csharp-design.md) (their structure and review lessons), the `LanguageAdapter`
  interface on branch `ai-ready-go`
- **Replaces for Rust:** the Rust row of the general design's language table ("`syn`-based helper via cargo; new module
  with `pub use` back, visibility kept"). This design keeps the new module and the re-exports, but parses with the
  rust-analyzer that ships with the editor and **widens** visibility in a fixed, checked way instead of keeping it.
  Where this file and the general rules differ, this file wins, and the difference is named.

Probes for this design ran on rustc and cargo 1.88.0 (rustup 1.29.0, stable, aarch64-apple-darwin) and the bundled
rust-analyzer 0.4.3059, offline. Claims marked *probed* were run, by the author or the reviewer; everything else is
from documentation and must be confirmed while building. `rustfmt` and `clippy` are not installed on the probe machine,
so nothing about them is probed.

## Version 1 scope

Where the safe choice is unclear, version 1 refuses or skips.

| Project or file | What may move in version 1 |
|---|---|
| A UTF-8 `.rs` file of a workspace member package (edition 2018, 2021 or 2024), compiled by exactly one lib, bin or proc-macro target in the baseline build, in a package whose MIR dumps are reproducible, built by an installed toolchain (the one `rust-toolchain.toml` selects) | Whole top-level items that pass *What may move*, into new child modules `<stem>/<part>.rs` (declared `mod <part>;`), with visibility widened by *Visibility* and explicit re-exports in the original; and inline modules outlined into their own file (*Outlining an inline module*) |
| As above, in a project whose tracked code mentions `type_name`, `bevy_reflect` or `typetag` | Functions only (no types, traits, impls, consts or statics), plus outlining |
| As above, with a `macro_rules!` definition, an item-level macro call or a `#[macro_use]` item **after** the leading block | Only the items above the first of these (*Macro scope*) |
| A crate root (`lib.rs`, `main.rs`, a `[lib]` or `[[bin]]` `path`) or a `mod.rs` | The same as any file; its child modules live in its own folder (`src/<part>.rs`) |
| A file with `#[path]`, `#[macro_export]`, an item-level `include!`, a shebang, a BOM, CRLF line endings, a parse error, or a generated-code marker | Nothing; skipped |
| A file that is not compiled on this machine (its `mod` is behind a `#[cfg]` that is off here) or is compiled by two targets | Nothing; skipped |
| `build.rs` and the package's `build` script; files under `tests/`, `benches/`, `examples/`; files directly in `src/bin/` (their child modules would be auto-discovered as binaries) | Nothing; skipped |
| A package whose build script reads its own sources (a `cbindgen` build-dependency, a `rerun-if-changed` naming `src`), or whose MIR differs between two builds of `HEAD`, or between a clean and a touched tree (time or dirty stamps) | Nothing; the package's splits are skipped for the run |
| An edition 2015 package; a package that is not a workspace member (a path dependency outside the workspace, `vendor/`, `[workspace] exclude`, a nested workspace) | Nothing; skipped |
| A `rust-toolchain.toml` naming a toolchain that is not installed; no `cargo`; a `rust-version` newer than the toolchain; no bundled rust-analyzer for this platform | Nothing; the run stops with a plain message (probed: with `RUSTUP_AUTO_INSTALL=0`, `cargo -V` exits with *toolchain '1.60.0-aarch64-apple-darwin' is not installed* instead of downloading) |

Every narrowed or skipped file names the reason in the report. In practice, functions that log or trace do not move
(their log target would change, and rule 6 refuses that); see *Review*.

## Goal

Split an oversized Rust file into focused, idiomatic modules. Whole top-level items move into new child modules of the
original; their bytes change only where a visibility is widened by a fixed table, and the original re-exports each
moved name, so every caller, path and import keeps working and every item stays visible to exactly the modules that
could see it before. Large inline modules (`mod tests { … }`) move to their own file without any change. The program
must behave as before, and the host must be able to show it without trusting the model.

## Why Rust is harder than Go, and how each risk is closed

In Go a move inside a package changes nothing a program can see. In Rust a file is a module, so a split moves items
into a **different module**. Each of these can change behavior while `cargo build` and a thin test suite stay green:

1. **Privacy decides which method or field is used.** Probed: `struct S` with a private inherent `fn name()` and a
   trait `Name` with a default `name()` implemented for `S`. After moving `S` and its impl into `foo/part.rs` unchanged,
   `S.name()` in `foo` compiled (two warnings) and returned `"trait"` instead of `"inherent"`: method lookup skips an
   inaccessible inherent method and takes the trait's. Field access through `Deref` has the same fallback.
   **Closed by** widening (*Visibility*): with the method `pub(super)`, the same probe returned `"inherent"` (probed by
   the reviewer and again for this revision).
2. **Names the moved code used.** A child module sees nothing of its parent by default. **Closed by** `use super::*;`
   in the child: a glob import of the parent brings the parent's items (private ones included, since a child may see
   them), its imports, the names of its own glob imports, and its `_` trait imports. Probed: a child used `HashMap`
   that the parent had only through `use std::collections::*;`, and `write!` on a `String` with the parent's `use
   std::fmt::Write as _;`. The child's own items shadow the glob, as the parent's did.
3. **Names the remaining code used.** **Closed by** explicit re-exports in the original, one per name, never a glob
   (*Re-exports*). An explicit import has the same priority as the item it replaces, so it still shadows the parent's
   glob imports as the item did.
4. **Paths relative to the module.** `self::` and `super::` inside moved code would point one level deeper. **Closed by**
   refusing any span with a `self::` or `super::` token, including inside attribute strings such as `#[serde(with =
   "super::x")]`.
5. **Names derived from the module path.** `module_path!()`, `log` and `tracing` targets, `tracing` callsites and
   `#[instrument]` spans, `std::any::type_name`, symbol names, doc-test names. `module_path!()` is a string constant in
   MIR (probed: `const "cm::foo::part"`), so **rule 6 refuses** any step where it changes, which covers every logging
   or tracing macro. `type_name` is a generic call, which rule 6 cannot see change, so projects that mention it are
   **narrowed** to moving functions only, and the change is **disclosed**. Symbol names and doc-test names are
   disclosed.
6. **Macro scope.** `macro_rules!` scope is textual: a child module sees the macros defined before its `mod`
   declaration. **Closed by** declaring the new modules at the end of the leading block and the macro-boundary rule
   (*Macro scope*).
7. **Macros on moved items.** A derive or attribute macro runs on the moved item in its new module: what it generates
   (helper items, `macro_rules!`, `module_path!()`) lands there. **Closed by** an allowlist of derives and attributes
   (*What may move*); anything else is refused, and rule 6 is the backstop.

**Considered and kept only as a later strict mode: `include!`.** The first draft spliced new files back with
`include!("foo.part.rs")`, which keeps every item in the same module, so nothing in points 1 to 5 changes and no
visibility needs widening. It was dropped for version 1 because the user's goal is idiomatic, focused code: `include!`
for hand-written code is unusual, `cargo fmt` never visits included files, and readers and tools expect modules. It
remains a candidate for a "strict" mode that moves logging functions too (*Out of scope*).

## Decisions

| Question | Decision | Why |
|---|---|---|
| Split mechanism | New child modules `<stem>/<part>.rs`, `mod <part>;` in the original, `use super::*;` in the child | The idiomatic Rust split; every risk it brings is closed by a rule above |
| Visibility | Widened by a fixed table, so each item stays visible to exactly the same modules (*Visibility*) | Keeps privacy-driven method and field selection the same (point 1); the edits are positions the host records and the move check verifies |
| Re-exports | One explicit `use` per moved name in the original, at the item's original visibility, never a glob | Same shadowing as the item; no unused glob; private names only where still mentioned |
| Inline modules | Outlined to their own file unchanged (*Outlining an inline module*) | `mod tests { … }` is often the largest part of a file; its module path does not change |
| Parser | The rust-analyzer binary bundled with the editor, `rust-analyzer parse --json`, syntax only | Ships with the editor and runs offline; lossless (every byte, comments included), UTF-8 offsets, error nodes |
| Who plans | The model, by item ID, as in Go. It writes no code: the host writes `mod`, `use` and visibility | Grouping is a judgement call; everything the host writes is mechanical and checked |
| The proof | Move rules 1–5, rule 6 (same MIR, from a stable `--emit=mir` dump of a line-preserving variant, with moved definition paths mapped back), build and tests against the baseline | The compiler's own resolved code is compared, not source text |
| Characterization tests | Not required, as in Go and C# | Rule 6 compares every function body; generated tests would add no proof |
| Network | `cargo fetch` once, approved and disclosed; every other cargo command runs `--offline` | Dependencies may be missing from `~/.cargo/registry`; checks must not download |
| Formatter | `rustfmt --check` on the original and new files only when the project uses rustfmt and it is installed, and the original was clean | Same rule as `gofmt`, Prettier and black |
| Fixes | `['split']` only | The general design leaves Rust test generation out |

## The parser

**Options considered.**

| Option | Verdict |
|---|---|
| A `syn` helper built with cargo | Rejected. This machine's `~/.cargo/registry` has `syn` 2.0.119, `proc-macro2`, `quote`, `unicode-ident` and `serde_json` (probed), but a user's may have none, and building would need crates.io. `syn` also drops non-doc comments and needs `proc-macro2`'s `span-locations` feature for offsets |
| `rustc -Zunpretty=…` | Rejected. Nightly only, or `RUSTC_BOOTSTRAP=1`, which can change what build scripts detect (crates that probe for nightly features); it prints expanded code, not the original bytes |
| rust-analyzer (bundled) | **Chosen.** `overlay/bundled-extensions.json` pins `rust-lang.rust-analyzer` 0.4.3059; the binary is at `extensions/rust-lang.rust-analyzer/server/rust-analyzer` under `vscode.env.appRoot`. Its CLI has `parse` (with `--json`) and `symbols` |
| A hand-written tokenizer | Rejected. Raw strings, nested block comments, lifetimes versus char literals and doc comments as attributes are easy to get wrong, and a wrong span moves the wrong bytes |

**What `parse` gives** (probed): the lossless syntax tree of stdin, whitespace and comments included, each node with
`start`/`end` as `[offset, line, column]`. Offsets are UTF-8 bytes: a file with a two-byte `é` ended at 102, its `wc -c`
size. Syntax errors are `ERROR` nodes. A 4,179-line file (`syn`'s `expr.rs`) parsed in about 20 ms into 6 MB of JSON.
`symbols` gives item ranges but not the attribute, visibility and comment structure, so it is not used.

**Caveats.**

- `rust-analyzer --help` says subcommands *do not provide any stability guarantees*. The version is pinned with the
  editor, and the adapter runs `parse` on a shipped probe file once per rust-analyzer version and compares the result
  with a stored expectation before trusting it, as Go does with its helper.
- `parse` has no edition flag and parses as edition 2024 (probed: `fn gen() {}` gave `ERROR@3..6`). Valid 2018 or 2021
  code that uses `gen` (or another newer keyword) as a name gets an error node and the file is skipped: the safe
  direction. Edition 2015 packages are skipped outright (`async`, `await`, `dyn`, `try` were names then).
- `bundled-extensions.json` lists only `darwin-arm64`. On other platforms the Rust adapter stops with *Rust splitting
  needs the editor's bundled rust-analyzer, which this build does not include.* A rust-analyzer on `PATH` is not used: its
  version, and so its output, is not pinned.

**Spans.** rust-analyzer hangs every leading comment on the item node, across blank lines (probed: a `// plain` line, a
`///` line, a blank line, then `// attached plain`, `#[inline]`, `fn f`, all inside `FN`). The adapter computes the span
itself:

- it starts at the item's first outer attribute or doc comment (`ATTR`, `DOC_COMMENT`), or its visibility or keyword if
  it has none, then extends upward over plain `//` and `/* */` comment lines with no blank line between;
- it ends at the newline that ends the item's last line, so a trailing `// comment` moves with it (the interface's
  `Span` convention).

A `///` comment above a blank line **is** part of the item: doc comments are `#[doc]` attributes, and rustc applies them
to the next item whatever lies between. So it moves with the item, unlike C#, where such a comment skips the file. A
plain `//` comment separated by a blank line is detached and stays. An item that shares a line with other code is not
movable.

**Visibility slots.** For each item, and for each field (named or tuple) of a moved `struct` or `union` and each
associated item of a moved inherent `impl`, the parser reports the `VISIBILITY` node's byte range, or the empty slot
where one would go (after outer attributes and doc comments, before `unsafe`/`async`/`const`/the keyword, or before a
tuple field's type). The widening edits only these slots.

Byte offsets come straight from rust-analyzer; the host slices with `Buffer` only.

## The leading block

From the top of the file, the longest run of: inner attributes (`#![…]`), inner doc comments (`//!`), `use`
declarations, `extern crate`, out-of-line `mod x;` declarations, `macro_rules!` definitions, item-level macro calls
(`lazy_static!`, `thread_local!`; not `include!`, which skips the file), and items with `#[macro_use]`, with their
attributes and the comments and blank lines between them. The block ends at the first other item. It never moves.

The **generated region** goes right after it, each declaration on its own line:

```rust
mod exprs;
mod stmts;

pub use self::exprs::parse_expr;
pub(crate) use self::exprs::ExprKind;
use self::stmts::lower_stmt;
```

`mod` lines in plan order (private modules), a blank line, then the re-exports in the order of the moved items, then one
blank line. If the leading block is empty, the region starts the file. For the move check this is the file's
`importRegion`, as for TS's facade: before the split it is the empty span at the start of the first non-blank line after
the leading block (offset 0 when the block is empty); after the split it is the generated region. The core's rule 2
already treats an empty region as "imports go here" and ignores blank lines right after the region (to be confirmed
with a test while building).

## Macro scope

`macro_rules!` macros are scoped by text order: a macro is visible from its definition to the end of the enclosing
module, including child modules **declared later**. Path-based macros (`#[macro_export]` at the crate root, `use`d
macros, the `macro_use` prelude) are the fallback when no textual macro matches.

The new `mod` lines sit at the end of the leading block, so the child sees exactly the textual macros defined above
that point (probed: a `macro_rules! seven` in the leading block was usable in the child). A moved item saw the macros
defined above **its** old place, so the two sets are equal only if nothing between the end of the leading block and the
item defines or imports a macro. Probed (first draft, same mechanism): `lib.rs` defines `which!` returning `"outer"`;
`foo.rs` defines `which!` returning `"inner"` below the splice point; a moved `b()` calling `which!()` returned
`"outer"` instead of `"inner"`, with no warning.

**The rule.** A **macro boundary** is a `macro_rules!` definition, an item-level macro call (any of them can expand to
a `macro_rules!`), or an item with `#[macro_use]`. Every item below the first macro boundary after the leading block is
unmovable, with the reason *a macro is defined or invoked above it at line N; moving it would change which macros it
sees*. Boundaries inside the leading block are above the `mod` lines and every moved item, so they change nothing.

Files with `#[macro_export]` are skipped outright (version 1 does not reason about crate-root macro exports), and files
with `#[path]` because they bend module file lookup, which new child modules take part in.

## Visibility

Each moved item, each field of a moved `struct` or `union`, and each associated item of a moved inherent `impl` gets the
narrowest visibility that keeps it visible to **exactly** the modules that could see it before. A private item of
`crate::a::foo` is visible in `foo` and below; in `crate::a::foo::part`, `pub(super)` is visible in `foo` and below:
the same set.

| Before (in `crate::a::foo`) | After (in `crate::a::foo::part`) |
|---|---|
| none (private) or `pub(self)` | `pub(super)` |
| `pub(super)` | `pub(in crate::a)`; `pub(crate)` when the original's parent is the crate root |
| `pub(crate)`, `pub`, `pub(in crate::…)` | unchanged |
| `pub(in self)`, `pub(in super…)`, any `pub(in …)` not starting with `crate` | refused (rare; a relative path would change meaning) |

The original's module path comes from its file path (`src/a/foo.rs` and `src/a/foo/mod.rs` are `crate::a::foo`; crate
roots are `crate`), which is exact because files with `#[path]` are skipped. Enum variants, trait items and trait
`impl` items have no visibility and are untouched. Items nested inside function bodies are untouched: only code inside
that body can name them.

**Why it is safe:** privacy decides which inherent method, field or constructor a path or method call picks; with the
same visibility sets, every lookup has the same candidates. Lints that read visibility (`private_interfaces`,
`unreachable_pub`, `dead_code`) see the same sets too; any new warning fails the step anyway. The edits are recorded as
`(slot, old text, new text)` and rule 1 checks them (*Move check*).

## Re-exports

For each moved name the original gets one line `<vis> use self::<part>::<Name>;`, where `<vis>` is the item's
**original** visibility (`pub`, `pub(crate)`, `pub(super)`, `pub(in crate::…)`, or nothing). Never a glob: `pub use
self::part::*` has glob priority, so it would lose to the original's other glob imports where the item used to win, and
it would export every widened name.

Probed: an unused `pub(crate) use` and an unused `pub(super) use` each gave *warning: unused import*. So a re-export is
written only when it can be used:

- always for `pub` items of a lib target whose modules are `pub` up to the crate root (public API);
- otherwise when the name occurs as an identifier anywhere outside the moved items of its own group: the rest of the
  original (inline modules included), its descendant module files, other groups' moved items, and the package's other
  tracked `.rs` files (which may use `crate::a::foo::Name`). A constant used in a `match` pattern is the case that makes
  this rule matter: without the import, `MAX =>` would become a catch-all binding;
- a moved **trait** is always re-imported (by name when it occurs, else `use self::part::Trait as _;`), because method
  calls use it without naming it.

An occurrence that is not a real use leaves an unused import, which the warning comparison catches and the step is
undone; a real use the scan misses (an identifier built by `paste!`) fails to compile or, through a glob fallback,
changes a MIR body, which rule 6 catches. A moved item with `#[cfg(…)]` attributes gets a byte copy of them on its
re-export line, so the import disappears in configurations where the item does. A moved `#[deprecated]` item's
re-export line gets `#[allow(deprecated)]`: importing a deprecated item is itself a use that warns, so without it every
such step would fail the warning comparison.

**In the child.** `use super::*;` (after the header) only when the moved items mention a name the original declares or
imports, or the original has a glob import; otherwise it would be an unused import. The child never gets other `use`
lines.

## What may move

A **declaration** is one top-level item, from its span start to the end of its last line. Plans refer to it by ID.

| Item | Movable when | Why not otherwise |
|---|---|---|
| `fn` (also `async`, `const`, `unsafe`), `struct`, `enum`, `union`, `trait`, `type`, `const` (also `const _`), `static` (also `static mut`), `impl` (inherent or trait) | Below the leading block, above the first macro boundary, whole lines, and none of the refusals below | — |
| `mod name { … }` (inline) | Only as an outline (next section), never into a part | Moving a module into another changes every path inside it |
| `use`, `extern crate`, `mod x;` | Never | They are the module's frame |
| `macro_rules!`, item-level macro calls | Never | Textual macro scope; unknown expansions. `$crate` appears only inside macro bodies, which never move |
| `#[test]` functions and `#[cfg(test)]` items (also `cfg_attr(test, …)`, `cfg(any(test, …))`) | Never into a part | Test names are module paths; outline `mod tests` instead |
| A span containing `self::` or `super::` (as tokens, or inside a string literal in an attribute) | Never | The path would point one level deeper |
| A span containing a link attribute anywhere, nested items included: `#[no_mangle]`, `#[export_name]`, `#[link_section]`, `#[used]`, `#[link_name]`, `#[link]`, also in `unsafe(…)` and `cfg_attr` forms; or an `extern { … }` block; or `#[global_allocator]`, `#[panic_handler]`, `#[proc_macro*]`, `#[ctor]`, `#[dtor]`, `#[distributed_slice]`, `#[linkme::…]` | Never | Linkage and section order are outside rule 6; crate-root-only attributes |
| A span containing `file!`, `column!`, `module_path!`, `include!`, `include_str!` or `include_bytes!` (an identifier followed by `!`), or an out-of-line `mod x;` | Never | `include*!` paths and `mod` paths resolve against the new file's folder (probed for `include_str!`); `file!` and `module_path!` change; `column!` cannot be mapped by rule 6 |
| An item with a derive or attribute outside the allowlist below | Never | A macro can generate helper items, `macro_rules!` or `module_path!()` in the new module |
| A visibility `pub(in …)` not starting with `crate` | Never | See *Visibility* |
| In a project that mentions `type_name`, `bevy_reflect` or `typetag` in tracked code: anything but `fn` | Never | Their output names the type's module path; rule 6 cannot see a runtime `type_name` change |

**The attribute allowlist.** Built-in attributes: `doc`, `cfg`, `cfg_attr` (with allowlisted contents), `allow`, `warn`,
`deny`, `forbid`, `expect`, `inline`, `cold`, `must_use`, `deprecated`, `track_caller`, `repr`, `non_exhaustive`,
`automatically_derived`, `rustfmt::…`, `clippy::…`. Derives: `Debug`, `Clone`, `Copy`, `PartialEq`, `Eq`,
`PartialOrd`, `Ord`, `Hash`, `Default`, serde's `Serialize` and `Deserialize`, thiserror's `Error`, with their helper
attributes (`serde(…)`, `error(…)`, `from`, `source`, `backtrace`, `default`). Attribute macros: `async_trait`. These
generate only impls of the item (to confirm for each while building: no `module_path!()`, no named helper items, no
`macro_rules!`). A path-qualified spelling (`serde::Serialize`, `async_trait::async_trait`) counts.

**No static initialization order.** Rust has no runtime initialization of `static`s: initializers are evaluated at
compile time, `lazy_static`/`OnceLock`/`LazyLock` run on first use, and `#[ctor]` is refused. So `static` and `const`
move freely, unlike Go's initialized `var`s. Generics, `where` clauses and `const fn` need nothing special. Inherent
`impl` blocks may live in any module of the crate and trait coherence is per crate, so moving an impl, or a type without
its impls, changes neither.

## Outlining an inline module

A top-level inline module `mod name { … }` (with any attributes, typically `#[cfg(test)] mod tests`) moves to its own
file: the module path stays `crate::…::foo::name`, so test names, `module_path!()`, `self::`/`super::` paths and
privacy are all unchanged. The reviewer's probe found nothing observable changed apart from source positions.

- **The original** keeps everything up to and including `mod name` (attributes, doc comments, visibility) and the rest
  of the closing line after `}` (a trailing comment); the bytes from the space before `{` through `}` become `;`. The
  declaration stays in place, so the module still sees the same textual macros.
- **The new file** is `<stem>/<name>.rs` (`<dir>/<name>.rs` for `lib.rs`, `main.rs` and `mod.rs`, which is where `mod
  name;` looks), holding the body between the braces. The body's common indentation (the indentation of its first
  non-blank line) is removed from each line; a line that starts inside a string literal or block comment is copied
  unchanged (removing spaces there would change a value or a doc); a non-blank line indented less than that skips the
  outline. Inner attributes and `//!` docs at the top of the body become the file's own, which is valid.
- **Refused** when the body contains `#[path]`, `#[macro_use]`, `include!`, `include_str!`, `include_bytes!`, `file!`,
  `column!`, or an out-of-line `mod x;`; or when `<name>.rs` or `<name>/mod.rs` already exists.

An outline is a plan group holding exactly one inline module; its file name is fixed by the module's name. A plan may
mix outlines and parts.

## Skipped files

Reported, never split:

- **Not a member's compiled source:** not under a workspace member's folder (from `cargo metadata --no-deps
  --offline`); under `target/`, `vendor/`, `third_party/`, `.cargo/`; in a nested workspace; not listed in any dep-info
  file of the baseline (*Rule 6: membership*), which covers modules behind a `#[cfg]` that is off on this machine;
  listed by two targets.
- **Build and test code:** the package's build script; anything under `tests/`, `benches/`, `examples/`; files
  directly in `src/bin/` (a crate root there declares children in `src/bin/`, which cargo would discover as binaries).
- **Generated:** a first comment with `@generated`, `Code generated`, `DO NOT EDIT`, `automatically generated`;
  `linguist-generated`; any file that a tracked file names in `include!`, `include_str!` or `include_bytes!`.
- **Module and macro tricks:** `#[path]` (also inside `cfg_attr`) anywhere in the file, or the file is named by another
  file's `#[path]`; `#[macro_export]`; an item-level `include!`.
- **Bytes:** a BOM, CRLF line endings, a shebang (`#!` not followed by `[`), a file over 512 KB, a symlink, invalid
  UTF-8, an `ERROR` node anywhere in the parse.
- **Package level:** edition 2015; a build script that reads the package's sources: a `cbindgen` or `syn`
  build-dependency, or a `rerun-if-changed` that names a path under `src` (cbindgen parses source files following `mod`
  declarations, and a tool that does not follow them would miss moved items); non-reproducible MIR (*Rule 6*).

`lib.rs`, `main.rs` and `mod.rs` are **not** skipped. Crate attributes (`#![…]`), `extern crate` and `//!` docs are in
the leading block and never move. A `[lib] path` override or other non-standard layout needs no rule: which files a
target compiles is read from rustc's dep-info, not guessed from paths.

## Applying a split (host, no AI)

**The plan.** As in Go: the model gets the declaration list (`{id, kind, names, receiver, lines, firstDocLine, movable,
reason, visibility}`, inline modules marked as outlines) and proposes `[{ "file": "exprs", "declarations": [3, 7] }]`
(a module name for a part; for an outline, the module's own name). It writes no code. `planProblems` rejects unknown,
repeated or unmovable IDs, bad names (*File names*), an outline group with anything else in it, and a new file or the
original over 400 lines (a single item over 400 lines stays a suggestion).

**A part file** is: the header line `// Split from <original basename> by my_editor.`, a blank line, `use super::*;` and
a blank line when needed (*Re-exports*), then the moved spans in their original order, each with its visibility edits,
separated by one blank line, ending with a newline. The header is a plain `//` comment (not `//!`, which would become
the module's documentation).

**The original** keeps everything else byte for byte, minus the moved spans (blank lines around a removed span
collapse to one, as in Go), with the generated region after the leading block and each outlined module's braces
replaced by `;`. Every existing `use` stays: the remaining code may need it, and the child sees it through the glob.

## File names

`fileNameProblems(name, original)` for a part module name:

- `^[a-z][a-z0-9_]{0,39}$`, not a Rust keyword or reserved word (`mod type;` does not parse), not `tests` or `test`, not a
  Windows device name (`con`, `aux`, `nul`, `prn`, `com1`…`lpt9`);
- neither `<dir>/<name>.rs` nor `<dir>/<name>/mod.rs` exists (ignoring case), where `<dir>` is the original's child
  folder (`src/a/foo/` for `src/a/foo.rs`, the file's own folder for `lib.rs`, `main.rs`, `mod.rs`); no repeat in the
  plan;
- the name does not occur as an identifier anywhere in the package's tracked sources (a module is a name in the type
  namespace; this rules out shadowing an imported `exprs` and changes in how rustc shortens paths in MIR);
- cargo must not see a new target, and when `Cargo.toml` sets `include` or `exclude`, the new file must be packaged
  whenever the original is (rule 4, with `cargo package --list --allow-dirty --offline -p <pkg>`; probed to list files
  offline without building).

## Move check (Rust)

Rules 3 and 5 are the language-neutral ones. Rules 1 and 2 get Rust parts for the visibility edits, the generated
region and outlines; rule 4 gets Rust parts, and rule 6 is new.

1. Each moved span appears in exactly the new file the plan names, byte-identical once its recorded visibility edits
   are reversed; each edit sits in a visibility slot the parser reported, and its old and new text are a row of the
   *Visibility* table for the original's module path. An outlined module's file equals its body with exactly the
   specified indentation removed.
2. The original equals its old bytes minus the moved spans (blank lines may collapse), apart from the import region
   and each outline's `{ … }` → `;`. `rsImportProblems`: after the split, the region holds exactly one `mod <part>;` per
   part group in plan order and the re-export lines the *Re-exports* rules produce, in order, with their `#[cfg]`
   copies, and nothing else.
3. A part file holds only its header line, the optional `use super::*;` and its edited spans.
4. Same declarations and same targets:
   - the items of the original and its new files (kind, names, receiver, doc text) are the same multiset before and
     after (`declarationProblems`; for an `impl` the receiver is the self type and the name is the trait, if any);
   - the dep-info of every rule-6 variant build lists exactly the reference build's files plus the new ones, `cargo
     metadata --no-deps` reports the same targets, and the package-list check passes.
5. No other tracked file changed.
6. **Same MIR** (below), after the checks pass.

Rules 1 to 5 (except rule 4's dep-info part) run on the files as written and re-parsed from disk, before any build.

### Rule 6: same MIR

`rustc --emit=mir` is a **stable** option and writes the MIR of every body in the crate: functions, closures, generic
functions, `const` and `static` initializers, promoted constants and, in a test build, the test harness. Probed: `cargo
rustc --lib -- --emit=mir,link` on stable 1.88 wrote it, and `--profile test` added the `#[test]` functions and the
harness `main`. MIR is after name resolution, macro expansion and method and trait selection, so the privacy fallback
above would show (`<S as Name>::name` instead of `S::name`), as would the macro-scope probe (`"outer"` instead of
`"inner"`) and a changed log target (`const "cm::foo::part"` instead of `const "cm::foo"`, probed).

**Why a variant.** Probed: a straight diff of an item before and after a move differed in impl and closure positions
(`<impl at src/foo.rs:3:1: 3:11>` versus the new file and line), in `line!()` values (`const 3_u32` versus `const
2_u32`), in `file!()` strings, and in a `static`'s bytes, where the string length (`0a` versus `0f`) and the line (`04`
versus `03`) are raw bytes. `log` and `tracing` put lines and file names into code the same way, so they cannot be told
apart from other integers and strings. So rule 6 compares the reference against a **variant** of the split that keeps
every token on its original line and column, and gives the new files names of the original's length:

- **the variant original:** the old original with each moved span's lines, and each outlined body's lines, replaced by
  empty lines (same line count; an outline's `{` becomes `;` on its own line). The generated declarations go **on their
  own line**: all of them, separated by spaces, on the first line of the first moved span, which is empty in the
  variant, so no remaining token shifts column (this closes the first draft's column hole, where generated text was
  prepended to a line with code on it);
- **the variant new files:** empty lines plus the moved spans, each on its original line; outlined bodies keep their
  indentation (no dedent); `use super::*;` on its own line after the last span;
- **the dump build** adds `--remap-path-prefix=<new path>=<placeholder>` per new file, where `<new path>` is the path as
  rustc names it and `<placeholder>` has exactly the byte length of the original's path, differs per new file
  (`src/@@@@@1`, `src/@@@@@2` for `src/foo.rs`), and does not occur in the reference dump.

Probed (first draft, same construction): with the moved items padded to their old lines and the new file remapped to
the equal-length `src/@@@@@@`, the dump differed from the inline version's only in the placeholder (in positions, a
`const "…"` string and one allocation's bytes) and in allocation numbering (`alloc4` became `alloc3`). Remapping the new
file to the original's own path does not work: rustc's source map treated it as the same file (probed: *E0428 the name
`keep` is defined multiple times*).

**Rule 6a: the variant is the split.** Before the variant is built, the host checks, per file, that the variant and the
real split have the same tokens apart from whitespace and plain comments (doc comments are `#[doc]` attributes and are
compared), with the generated declarations compared as a separate list (their position differs, which the macro
boundary rule makes irrelevant: nothing between the end of the leading block and the first moved span defines a
macro). The remaining differences are blank lines, the header, indentation of outlined bodies and where the generated
lines sit: whitespace and comments, which change spans only.

**Rule 6b: the comparison.** Both dumps are normalized in five ways and nothing else:

1. each placeholder is replaced by the original's path, in text and byte-wise inside parsed allocation dumps (equal
   length, so no row or size changes; the hex rows are parsed, never matched by pattern);
2. each `allocN` reference is replaced by a hash of the allocation's normalized content, pointers inside it replaced
   recursively (a reference cycle is cut by its depth-first index), so numbering and sharing differences vanish;
3. bodies are sorted by their header line;
4. **definition paths** of items in a new module are mapped back to the original's: `foo::exprs::x` to `foo::x`, and the
   shortened forms rustc prints (probed: a moved function printed as just `fn w()`; a moved impl as `part::<impl at
   src/foo/part.rs:3:1: 3:7>::name`, where the original printed `foo::<impl at …>`). Only paths in function headers,
   types and call targets are mapped, **never string constants or allocation bytes**, so `module_path!()`, log and
   tracing targets and `type_name` evaluated at compile time still differ and refuse the step;
5. **columns** inside the new files, on lines that got visibility edits, are mapped back by the summed length of every
   edit on that line to the left of the position (a struct written on one line can get several field edits; the edits
   are known exactly; `column!` is refused, so no column is a value).

Then the two must be equal. The first difference is reported with its body header (*`fn foo::K::k` differs: `const
"inner"` became `const "outer"`*), and a log-target difference gets a plain reason (*`foo::exprs::parse` logs or
traces, and its log target would change from `app::foo` to `app::foo::exprs`*). A dump the parser cannot read, or a
path form the mapping does not know, means *cannot verify*, and the step is undone with that reason: the parser fails
closed.

**v1.1 widening (not in v1): log targets.** Rule 6 could map a string constant exactly equal to `<orig>::<part>` back to
`<orig>`, so functions that log could move, only when:

- every macro call in the function is from an allowlist (std macros, `log`, `tracing`, `#[instrument]`);
- the project has no exact-target comparisons in tracked code (`.target() ==`, reads of `module_path()` from log or
  tracing metadata);
- the mapping also covers `tracing` callsite statics (their `target` and `module_path` fields live in allocations).

Log targets would then move to *What may still differ*: `RUST_LOG` and `EnvFilter` match targets by prefix, so
`app::foo=debug` still matches `app::foo::exprs`, but output and exact-match filters change.

**The commands.** For each target that compiles the file (from dep-info) and each profile (`dev`, `test`):

```
cargo rustc -p <pkg> --lib|--bin <name> [--profile test] --offline [--locked] --message-format=short -- --emit=mir=<state>/<step>/<target>-<profile>-<side>.mir,dep-info=<state>/<step>/<target>-<profile>-<side>.d,link [--remap-path-prefix=<new path>=<placeholder>…]
```

They run through `runTool` with `commandEnv`, but they compile the project's code (build scripts and proc macros run,
as in the approved build), so the approval dialog lists them as *MIR comparison builds* with the template above.
Probed: extra `cargo rustc` arguments leave `-C metadata` unchanged and change only `-C extra-filename`, so the crate's
identity is the same in every dump and the dump builds do not overwrite the normal build's artifacts; and
`--emit=mir=<path with a space>,dep-info=<path>,link` wrote both files where asked, the dep-info listing every source
file as rustc names it.

**When it runs** (the `assemblyCheck` hook proposed in the C# design):

- **baseline**, once per package with a chosen file: build every lib, bin and proc-macro target in the `dev` and `test`
  profiles with `--emit=dep-info` to learn which targets compile which files (**membership**; a `#[cfg(test)] mod`
  appears only in the test profile); dump `HEAD` twice and require equal normalized dumps (**reproducibility**); dump
  once more with the original touched (a newline appended at its end, which moves no line) and an empty untracked file
  beside it, and require the same dump (**dirty stamps**: `vergen`, `built`, `git describe --dirty`). A package that
  fails any of these has its splits skipped for the run with the first difference;
- **snapshot**, per step, before the split is written: dump `HEAD` (the reference), because stamps such as a commit hash
  change with every commit;
- **compare**, per step, after build and tests pass: write the variant over the real files, run rule 6a, dump, write
  the real files back and check their bytes against the split, then compare. The variant is never committed.

**The tool probe.** Once per rustc version (`rustc -vV`'s commit hash), the adapter runs the whole rule-6 pipeline on a
small shipped probe crate (a moved impl with a closure, `line!()` and a widened private method; a `static` with
`line!()`; a generic function; an outlined test module) and requires an empty difference, and a second probe with a
`log`-style `module_path!()` that must be refused. If either fails, Rust splitting stops with *my_editor cannot read
this Rust version's MIR dumps.*

**What rule 6 proves:** for each target that compiles the file, in the `dev` and `test` profiles, with the package's
default features and this machine's target: every MIR body is the same after the split as before, apart from moved
items' definition paths, file names and the columns of widened lines, and the real split differs from the compiled
variant only in whitespace and comments. So name resolution, privacy-driven method and field selection, macro
expansion, constant values (module path strings included) and proc-macro output are unchanged in those builds.

**What it does not prove:** the `release` profile, other features, other targets and `cfg` values; linkage (refused
statically); type definitions (they have no bodies; their bytes are identical apart from checked visibility edits);
runtime `type_name` (narrowed and disclosed); file names and line numbers (disclosed).

**Cost:** per step, two dumps (reference and variant) per target and profile, usually four crate builds, on top of
build and tests. Doing all of a package's files in one step would save builds; as in C#, version 1 keeps one file per
step.

## Checks per step

**Install, once per run, before the baseline** (`setup`, label `install`): `cargo fetch` (`--locked` when `Cargo.lock`
is tracked). The approval text says it may download crates from the project's registries into `~/.cargo/registry`,
which the user's own builds share, and that building runs build scripts and proc macros from those crates. Without a
tracked `Cargo.lock`, `cargo fetch` writes one into the worktree (untracked; rule 5 ignores it), and the change note says
the branch may have been tested with newer dependency versions than the user's folder. `ready()` checks that `cargo
metadata --offline --format-version 1` succeeds; `setupStamp` is the hash of `Cargo.lock`.

| Label | Command | Verifies | Compared by |
|---|---|---|---|
| `install` | as above, once | — | Must succeed |
| `build` | `cargo check --workspace --all-targets --offline --message-format=short` | No | Exit code, error lines, warnings that may not grow |
| `build` | `cargo build -p <pkg> --offline --message-format=short` | Yes | Exit code, error lines, warnings that may not grow |
| `vet` | `cargo clippy -p <pkg> --all-targets --offline --message-format=short`, only when the project uses clippy (`clippy.toml`, `[lints.clippy]`, or `cargo clippy` in tracked CI files or scripts) and `cargo clippy -V` works | No | As `build` |
| `test` | `cargo test -p <pkg> --offline --no-fail-fast` | No | Per-test results |

`--locked` is added to each when `Cargo.lock` is tracked. Then rule 6.

- **Warnings** (probed): `--message-format=short` prints one line per diagnostic, `src/foo/part.rs:10:38: warning:
  unused variable: …`, so `baseline.ts`'s position pattern already strips the file and line. Cargo replays cached
  warnings for fresh crates (probed), so both baseline runs see them. Counted per message; a step fails when any count
  grows (C#'s `warnings: 'no-more'` core change, with a Rust warning pattern). Before counting, moved definition paths
  in warning text are mapped back the same way rule 6 maps them in MIR (`foo::part::old` → `foo::old`), so a warning
  that names a moved item (a deprecation, a `dead_code` path) compares equal. This is what catches an unused
  re-export, an unused `use super::*;`, `clippy::wildcard_imports` (pedantic) on the glob, and a project with `-D
  warnings` in `.cargo/config.toml` either way.
- **`--no-fail-fast`**: without it the first failing test binary stops the rest.
- **Test output** (libtest's text; `--format json` is nightly-only). Probed shape:
  - `Running unittests src/lib.rs (target/debug/deps/inc-c3426b0877ddc581)` and `Running tests/it.rs (…)` start a
    binary; `Doc-tests inc` starts the doc tests. The binary key is the text before the parenthesis, without the hash;
  - `test t::a ... ok`, `... FAILED`, `... ignored` (also `ignored, <reason>`) give pass, fail, skip; keys are
    `<binary> <test name>`;
  - doc-test names carry the file, the item path and the line (`src/foo/part.rs - foo::moved (line 7)`), and a split
    changes all three. They are compared per binary and item path, with moved items' paths mapped back as in rule 6, as
    a multiset of outcomes;
  - a binary that crashes or never prints `test result:` counts as a failure of that binary.
- **Formatter.** When the project uses rustfmt (`rustfmt.toml` or `.rustfmt.toml`, or `cargo fmt` in tracked CI files or
  scripts) and `rustfmt --version` works, `unformatted` runs `rustfmt --check --edition <edition>` on the original before;
  if it was clean, the original and the new files must be clean after. New child modules are reached through `mod`, so
  the user's `cargo fmt` formats them as usual. Not probed (rustfmt is not installed on the probe machine).

**Environment** (`commandEnv`): `RUSTUP_AUTO_INSTALL=0` (probed above; the Go `GOTOOLCHAIN=local` counterpart),
`CARGO_TERM_COLOR=never`, `CARGO_TERM_PROGRESS_WHEN=never`. Nothing else. In particular not `RUSTFLAGS` (it replaces
`build.rustflags` from `.cargo/config.toml`), `CARGO_TARGET_DIR` or `RUST_BACKTRACE`. The approval dialog shows any
`RUSTFLAGS`, `CARGO_*` or `RUSTC*` variables the editor's own environment passes through.

**Finding cargo:** `PATH`, then `~/.cargo/bin`, `/opt/homebrew/bin`, `/usr/local/bin`. `cargo -V` and `rustc -vV` run in
the worktree root, so `rust-toolchain.toml` applies; a failure stops the run with its message. A cargo that is not the
rustup proxy ignores `rust-toolchain.toml`; the run goes on and the change note names the toolchain used.

**The target folder** is the worktree's own (`target/`, untracked), read from `cargo metadata`'s `target_directory`.
The first build compiles every dependency, which the approval text says.

## What "unchanged" means

**Shown by** the move check, rule 6 and the checks:

- every moved item is byte-identical apart from visibility edits that keep the same visibility sets, and sees the same
  names (through `use super::*`) and the same textual macros;
- the remaining code sees every moved name through an explicit re-export with the item's own priority;
- every function, closure, constant and static compiles to the same MIR in the dev and test builds, module path strings
  included, apart from moved definition paths, file names and line numbers;
- the build has the same errors and no more warnings, and the tests have the same results, as the baseline.

**What may still differ** (in the change note, `mayDiffer`):

- the text of warnings about moved items (their paths gain the part module; compared after mapping back);
- `std::any::type_name` and `type_name_of_val` of moved items (`app::foo::exprs::Expr` instead of `app::foo::Expr`);
  projects that mention them move functions only, which `type_name` does not name;
- symbol names of moved items (backtraces, profilers, `nm`); not `#[no_mangle]` ones, which never move;
- doc-test names (file, item path, line);
- file names and line numbers for moved and outlined code, and line numbers below the generated region in the
  original: panic messages, `Location::caller()`, `#[track_caller]`, backtraces, debug info, `line!()`;
- rustdoc paths of items that are not re-exported publicly (private and crate-visible items, in
  `--document-private-items` output);
- tooling: rust-analyzer in the editor follows the new modules at once, but batch indexers built from an older snapshot
  (`rust-analyzer scip`, `rust-analyzer diagnostics` runs, tree-sitter based tools) show the old layout until rebuilt.

## Components

In `src/aiready/`, each under 400 lines:

| Unit | Job | Interface |
|---|---|---|
| `rsTools.ts` | Find cargo and rustc, check the toolchain in the worktree, find the bundled rust-analyzer, run the parse probe and the MIR probes once per version | `rsTools(appRoot, extensionPath, storage, version): RsTools \| string` |
| `rsAst.ts` | Run `rust-analyzer parse --json` on one file; items with spans, visibility slots (items, fields, inherent associated items), attributes and derives, macro calls by name, `self::`/`super::` tokens and attribute strings, inline module bodies, error nodes; the token list for rule 6a | `rsFileFacts(tools, file): RsFacts` |
| `rsProject.ts` | `cargo metadata` (members, targets, editions, autodiscovery, `include`/`exclude`, build-dependencies), module paths from file paths, identifier occurrences across the package, `type_name`/`bevy_reflect`/`typetag` mentions, rustfmt and clippy use | `rsProject(root, tools, tracked): RsProject` |
| `rsRules.ts` | Skip reasons, the leading block, macro boundaries, movability, the attribute allowlist, file names (pure) | `rsSkipReason(…)`, `rsFileInfoView(…)`, `rsFileNameProblems(…)` |
| `rsVisibility.ts` | The widening table and the re-export lines (pure) | `widen(slot, modulePath)`, `reexports(info, plan, occurrences)` |
| `rsSplit.ts` | Part files, outlines, the original with the generated region; the line- and column-preserving variant (pure) | `buildRsSplit(source, info, plan)`, `buildRsVariant(source, info, plan)` |
| `rsMoveCheck.ts` | Rule 1's reversed edits and outline dedent, rule 2's region and outlines, rule 4's targets and package list, rule 6a's tokens | `rsMovedProblems(…)`, `rsImportProblems(…)`, `targetProblems(…)`, `sameTokens(…)` |
| `rsMir.ts` | Parse a MIR dump, the five normalizations, the comparison with a readable first difference (pure, fails closed) | `normalizeMir(text, mapping): Mir`, `compareMir(a, b): string[]` |
| `rsMirCheck.ts` | Rule 6's hook: membership, reproducibility and dirty-stamp checks at baseline, reference dumps, variant write, dump and restore | `baseline(pkg, run)`, `snapshot(file, run)`, `compare(file, plan, run)` |
| `rsTests.ts` | libtest text into `TestRun` (binary keys, doc-test multisets with paths mapped back, crashed binaries) | `parseCargoTest(output, pathMap): TestRun \| undefined` |
| `rsPrompts.ts` | The split prompt | `rsSplitPrompt(info, lines)` |
| `rsAdapter.ts` | Wire it into `LanguageAdapter` | `createRsAdapter(root, tools, tracked)` |

`languages.ts` keeps its order: Go, TS/JS, Python, C#, then Rust. Rust is picked when the root has a `Cargo.toml` and no
earlier language's marker; a root with `Cargo.toml` and `package.json` (napi-rs, wasm-pack) stays TS/JS and gets a
`languageNote`. A Tauri app (`package.json` at the root, `src-tauri/Cargo.toml` below) is TS/JS only in version 1.

**Changes to the shared core** (small; other adapters unaffected):

| Change | Why |
|---|---|
| The `assemblyCheck` hook from the C# design (`baseline`, `snapshot`, `compare`), if C# has not landed it | Rule 6 needs a reference dump before the split and a variant dump after the checks |
| `CheckCommand.warnings: 'no-more'` from the C# design, with the warning-line pattern supplied by the adapter (Rust: `warning: …` lines of `--message-format=short`, without the `generated N warnings` summaries) | Gaining a warning is a signal; losing one is not a behavior change |
| Optional `movedProblems(before, after, files, plan)` on the adapter, replacing the core's byte-identity part of rule 1 and its rule-2 line comparison for the outlined braces, when present | Moved spans carry visibility edits, and outlines change indentation and braces; both are exact, recorded transformations the adapter checks |
| `LanguageInfo` for Rust: `fixes: ['split']`, `extensions: ['.rs']` | — |

The generated region uses the existing `importRegion` and `importProblems`. `unitFiles(file)` returns the original and
the files of the modules its generated region and outlines declare. The add-tests members are never called, because
`fixes` has no `tests`.

## Tests

Pure unit tests, plus toolchain tests that run when cargo and the bundled rust-analyzer are present and are skipped with
a note otherwise.

- **Parser and spans:** UTF-8 offsets with non-ASCII before a span; a `///` above a blank line moves with its item; a
  plain `//` above a blank line stays; a trailing comment moves; an item sharing a line is not movable; an `ERROR` node
  skips the file; `fn gen` in an edition 2021 file skips it; visibility slots for a private fn, `pub(crate) const`, a
  `#[derive]`d struct with private and `pub` named fields, a tuple struct `S(u8, pub u8)`, an inherent impl's private
  `fn`, `const` and `type`, an `async unsafe fn`; none for enum variants, trait items and trait impl items.
- **Visibility:** private → `pub(super)`; `pub(self)` → `pub(super)`; `pub(super)` in `crate::a::foo` → `pub(in
  crate::a)`, and in `crate::foo` → `pub(crate)`; `pub`, `pub(crate)`, `pub(in crate::x)` unchanged; `pub(in self)`
  refused; the privacy probe (`"inherent"` versus `"trait"`) as a toolchain test that passes with widening and fails
  rule 6 without it.
- **Re-exports:** a `pub` item of a public module path always re-exported; a private item used by the remaining code,
  by an inline `mod tests` (`use super::*`), by a sibling module file (`super::Name`), and by another group re-imported;
  an unused private item not; an unused `pub(crate)` item not (probed warning); a `#[deprecated]` item's re-export
  carries `#[allow(deprecated)]` and the step adds no warning; a moved const used in a `match` pattern
  re-imported; a moved trait re-imported by name, or `as _`; `#[cfg(windows)]` copied onto the re-export; `use
  super::*` written only when needed; never a glob re-export.
- **Names in the child** (toolchain): a parent private fn, a parent `use` import, a name from a parent glob import
  (probed: `HashMap`), a `_` trait import (probed: `write!`), a leading-block `macro_rules!` (probed) all resolve in the
  child.
- **Macro scope:** an item below a `macro_rules!` after the leading block is unmovable (the outer/inner probe as a
  toolchain test, which must fail rule 6 when the static rule is disabled); `lazy_static!` at the top joins the leading
  block; in the middle it is a boundary; `#[macro_export]` skips the file.
- **Movability:** each item kind; `use`, `mod x;`, `extern crate`, macro calls stay; `self::x`, `super::x`,
  `#[serde(with = "super::x")]` refuse; `#[test]` and `#[cfg(test)]` items refuse; `#[no_mangle]`, `#[unsafe(no_mangle)]`,
  `#[cfg_attr(x, link_section = "…")]`, `#[used]` on a static nested in a fn body, an `extern` block refuse; `file!`,
  `column!`, `module_path!`, `include_str!` refuse; `line!()` moves; `#[derive(Debug, serde::Serialize)]` and
  `#[async_trait]` move; `#[derive(Builder)]` and `#[tracing::instrument]` refuse; in a project mentioning `type_name`,
  a struct refuses and a fn moves.
- **Outlines:** `#[cfg(test)] mod tests { … }` becomes `#[cfg(test)] mod tests;` plus `foo/tests.rs` (and `src/tests.rs`
  for `lib.rs`); indentation removed; a multi-line string literal and a `/** */` block inside keep their lines; a line
  indented less skips; `//!` and `#![allow(…)]` at the top of the body become file-level; a trailing `} // tests`
  comment stays; `#[path]`, `#[macro_use]`, `include_str!`, `file!`, `column!` or a nested `mod x;` inside refuse;
  existing `tests.rs` or `tests/mod.rs` refuses; test names unchanged (toolchain).
- **Skipped files:** `#[path]` in the file and naming the file; `build.rs`; `tests/x.rs`; `src/bin/x.rs`; a generated
  header; BOM; CRLF; shebang; a file in two targets; a file not in any dep-info (`#[cfg(windows)] mod win;`); an
  edition 2015 package; a `cbindgen` build-dependency; a path dependency outside the workspace.
- **Plan and names:** `exprs` passes; `Exprs`, `type`, `tests`, `con`, an existing `exprs.rs` or `exprs/mod.rs`, a name
  that occurs as an identifier in the package, a repeat, a new file over 400 lines refuse; an outline group with a
  second declaration refuses; `include`/`exclude` in `Cargo.toml` that would leave the new file out fails rule 4.
- **Move check:** pass on a clean split; fail on an edited span, a visibility edit outside a slot, a widening that is not
  the table's (`pub(crate)` where `pub(super)` was due), an extra line in the original, a `mod` line out of plan order,
  a glob re-export, an extra `use` in a part file, a changed header, a wrong dedent, another tracked file changed.
- **Rule 6:** pass after normalization for a moved impl with a closure and `line!()`, a `static` with `line!()`, a
  generic function, a widened method on a line with a closure (column mapping), a one-line struct with several widened
  fields and a closure after them (columns summed), an outlined test module; a moved fn
  calling `log::info!` fails with the log-target reason; `const N: &str = type_name::<X>()` fails; `foo::exprs::x` and
  `exprs::<impl at …>` map back; an unknown path form fails closed; shared versus separate allocations compare equal;
  an unknown dump line fails closed; a build script embedding the time fails reproducibility; one embedding `git
  describe --dirty` fails the dirty-stamp check; a commit hash stamp passes; rule 6a fails when the variant has a token
  the split lacks, and when a `///` line differs; the variant puts generated declarations on an empty line, never on a
  line with code.
- **Checks:** the probed warning line compares equal after a move; a new warning (an unused re-export) fails, a lost one
  passes; libtest lines, binary keys without hashes, doc tests with changed file, path and line compare equal, two doc
  tests on one item, a crashed binary fails; `cargo fetch --locked` only with a tracked `Cargo.lock`;
  `RUSTUP_AUTO_INSTALL=0` with a missing pinned toolchain stops with cargo's message; no `push`, `fetch` or `remote` git
  command; no environment variable beyond the listed ones set by the adapter.
- **Languages:** a root with only `Cargo.toml` gets Rust; with `Cargo.toml` and `package.json`, TS/JS and the note; a
  virtual workspace root gets Rust.
- **End to end** in a dev host: a binary crate with a 900-line `main.rs` (clap, `anyhow`, some `log` calls), a library
  workspace with a 1,200-line `parser.rs` with doc tests, serde derives and a 300-line `#[cfg(test)] mod tests`, and a
  crate with `tracing` and `macro_rules!` helpers at the top. Expect logging functions to stay, the tests module to be
  outlined, build, warnings and tests equal to the baseline, rule 6 equal, one commit per split, the user's folder
  untouched.

## Out of scope for this version

- **A strict `include!` mode.** Splicing new files back with `include!` keeps every item in its module, so it could also
  move logging and tracing functions, types in `type_name` projects, `#[test]` functions and non-allowlisted macros. It
  was the first draft of this design and its probes stand; it is unidiomatic, and `cargo fmt` never formats included
  files, so it is a candidate for a later opt-in mode, not version 1.
- Moving items that use `self::`/`super::` paths (it would need path rewriting), `#[test]` and `#[cfg(test)]` items into
  parts, items with non-allowlisted macros, and functions that log (their target would change).
- Sibling modules (moving items to `crate::a::bar` instead of a child): widening would have to reach the parent, which
  widens visibility for every other child too.
- Files after a macro boundary, files with `#[macro_export]` or `#[path]`, test, bench, example and build-script files.
- Rule 6 for the release profile, other features and other targets; the public API compared through rustdoc JSON
  (nightly only) or `cargo expand` (nightly). Comparing symbol tables (`nm`) was considered and dropped: names change
  by design here, and a symbol table says nothing about function bodies, where every probed failure showed.
- Add-tests for Rust; `cargo nextest` output (projects that use nextest still get `cargo test`).
- Platforms whose editor build does not bundle rust-analyzer.

## Review: the points most likely to be wrong

1. **The widening table's claim.** "Visible to exactly the same modules" rests on `pub(super)` in a child equalling
   private in the parent, and `pub(in <grandparent>)` equalling `pub(super)` in the parent. Descendants of the original
   (its other child modules, inline modules) keep access through the re-exports; anything that reached a private item
   through a path the scan does not see fails to compile or changes a body that rule 6 compares.
2. **Name resolution through `use super::*`.** The child sees the parent's names through a glob, which ranks below the
   child's own items and above the preludes, as the parent's names did for the item. Probed for items, imports, globbed
   names, `_` trait imports and textual macros. Not probed: names that are ambiguous between two of the parent's globs
   (an error only when used, before and after), extern-prelude crate names shadowed by a parent item, and `#[macro_use]`
   prelude macros.
3. **Most logging code will not move.** `log` and `tracing` macros embed `module_path!()`, so rule 6 refuses every
   function that logs. On a service crate that may leave large files nearly unsplit; the report must say why, and the
   strict `include!` mode is the answer if users want more.
4. **The attribute allowlist** decides which derives and attribute macros are trusted to generate only impls. A
   wrong entry is caught by rule 6 only if the generated code differs in a body; generated helper items with fixed names
   would fail to resolve (a build error) rather than change silently.
5. **Rule 6's path mapping** depends on how rustc prints definition paths (full, shortened, `<impl at …>` under the
   parent). The probes show two shortened forms; any form the mapping does not know fails closed, which refuses safe
   moves until the mapping learns it. The MIR text format is compiler-internal; same compiler on both sides, but the
   parser must fail closed and the per-version probe crate must exercise every shape.
6. **The variant argument.** Rule 6 compares a line- and column-preserving, path-remapped variant, not the committed
   files; rule 6a claims they differ only in whitespace and comments, which change spans only. That holds for rustc; a
   proc macro that reads line numbers or `Span::file()` is disclosed, not caught.
7. **Re-export occurrence scan.** Writing a re-export only when the name occurs as an identifier is a text heuristic: a
   false positive costs an unused-import warning (the step is undone), a false negative a build error or a rule-6
   difference. Both are safe; frequent false positives would make splits annoying.
8. **Stamps and reproducibility.** The baseline builds `HEAD` twice and once touched. A stamp that changes rarely, or a
   dirty check that reacts to something else, can still fail a step, which is then undone: safe, but confusing.
9. **Cost.** Rule 6 adds about four crate builds per step, and the first build in the worktree compiles every
   dependency.
10. **Not probed:** rustfmt and clippy (not installed on the probe machine); the attribute allowlist's expansions;
    `cargo package --list` with a real `include` list; doc-test keys on a crate with many doc tests; `Span::file()`
    under `--remap-path-prefix`; the outline dedent on real test modules.

Related: [AI-ready design](2026-10-07-ai-ready-design.md), [TS/JS design](2026-10-09-ai-ready-ts-design.md),
[Python design](2026-10-10-ai-ready-python-design.md), [C# design](2026-10-10-ai-ready-csharp-design.md),
[Stage 2 Go plan](2026-10-09-ai-ready-stage2-go-plan.md).
