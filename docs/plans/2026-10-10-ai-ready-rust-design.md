# Make a project AI-ready: Rust (Stage 2e)

- **Date:** 10 October 2026
- **Status:** Design, not built. Needs review before a plan.
- **Builds on:** [AI-ready design](2026-10-07-ai-ready-design.md), *Stage 2a: Go*,
  [TS/JS design](2026-10-09-ai-ready-ts-design.md), [Python design](2026-10-10-ai-ready-python-design.md) and
  [C# design](2026-10-10-ai-ready-csharp-design.md) (their structure and review lessons), the `LanguageAdapter`
  interface on branch `ai-ready-go`
- **Replaces for Rust:** the Rust row of the general design's language table ("`syn`-based helper via cargo; new module
  with `pub use` back, visibility kept"). This design uses the rust-analyzer that ships with the editor, and splits
  with `include!` into the **same** module instead of a new one. Where this file and the general rules differ, this
  file wins, and the difference is named.

Probes for this design ran on rustc and cargo 1.88.0 (rustup 1.29.0, stable, aarch64-apple-darwin) and the bundled
rust-analyzer 0.4.3059, offline. Claims marked *probed* were run; everything else is from documentation and must be
confirmed while building. `rustfmt` and `clippy` are not installed on the probe machine, so nothing about them is
probed.

## Version 1 scope

Where the safe choice is unclear, version 1 refuses or skips.

| Project or file | What may move in version 1 |
|---|---|
| A UTF-8 `.rs` file of a workspace member package (edition 2018, 2021 or 2024), compiled by exactly one lib, bin or proc-macro target in the baseline build, in a package whose MIR dumps are reproducible, built by an installed toolchain (the one `rust-toolchain.toml` selects) | Whole top-level items that pass *What may move*, into new files `<stem>.<name>.rs` beside it, spliced back with `include!` |
| As above, with a `macro_rules!` definition, an item-level macro call or a `#[macro_use]` item **after** the leading block | Only the items above the first of these (*Macro scope*) |
| A crate root (`lib.rs`, `main.rs`, a `[lib]` or `[[bin]]` `path`) or a `mod.rs` | The same as any file: `include!` keeps crate-root items at the crate root (probed with `fn main` and a `#[test]` in an included file) |
| A file with `#[path]`, `#[macro_export]`, an item-level `include!`, a shebang, a BOM, CRLF line endings, a parse error, or a generated-code marker | Nothing; skipped |
| A file that is not compiled on this machine (its `mod` is behind a `#[cfg]` that is off here) or is compiled by two targets | Nothing; skipped |
| `build.rs` and the package's `build` script; files under `tests/`, `benches/`, `examples/`; files directly in `src/bin/` | Nothing; skipped |
| A package whose build script reads its own sources (a `cbindgen` build-dependency, a `rerun-if-changed` naming `src`), or whose MIR differs between two builds of `HEAD`, or between a clean and a touched tree (time or dirty stamps) | Nothing; the package's splits are skipped for the run |
| An edition 2015 package; a package that is not a workspace member (a path dependency outside the workspace, `vendor/`, `[workspace] exclude`, a nested workspace) | Nothing; skipped |
| A `rust-toolchain.toml` naming a toolchain that is not installed; no `cargo`; a `rust-version` newer than the toolchain; no bundled rust-analyzer for this platform | Nothing; the run stops with a plain message (probed: with `RUSTUP_AUTO_INSTALL=0`, `cargo -V` exits with *toolchain '1.60.0-aarch64-apple-darwin' is not installed* instead of downloading) |

Every narrowed or skipped file names the reason in the report.

## Goal

Split an oversized Rust file into focused files. Whole top-level items move byte for byte into new files beside the
original, and the original splices them back in with `include!`, so every item stays in the module it was in. No path,
visibility, import or caller changes. The program must behave as before, and the host must be able to show it without
trusting the model.

## Why Rust needs its own scheme

A Rust item's identity is its module path, and the module is decided by the file: `src/foo.rs` is module `foo`. The
natural split, a child module (`mod part;` plus `pub use part::*;`), changes the module of every moved item, and with it
privacy, name resolution and every name the program can observe. `include!` does not: it is a textual splice that the
compiler expands in place, so the included items are items of the including module, as if they had never left.

**What a child module changes** (each is a reason it is refused for version 1):

1. **Privacy picks a different method, silently.** Probed: `struct S` with a private inherent method `name()` and a
   trait `Name` with a default `name()` implemented for `S`. Moved into `foo/part.rs` (`mod part; pub use
   self::part::*;`, `use super::*;` in the child), `S.name()` in `foo` still compiled, with two warnings, and returned
   `"trait"` instead of `"inherent"`: method lookup skips the now-inaccessible inherent method and takes the trait's.
   Field access through `Deref` has the same fallback (not probed).
2. **Private items stop being visible.** A moved private item is private to the child, so the parent cannot use it.
   Making it `pub(super)` or `pub(crate)` edits the moved bytes. The parent's private items reach the child only through
   `use super::*` or explicit imports, and `super::`, `self::` and `pub(super)` inside moved code change meaning.
3. **Observable names change.** `module_path!()`, `std::any::type_name`, `log` and `tracing` targets (filters match by
   prefix, but output and exact-match filters change), `tracing` span metadata, `bevy_reflect` type paths, rustdoc
   paths, symbol names and the names of moved `#[test]` functions. Probed under `include!`: `type_name::<Moved>()`
   stayed `inc::foo::Moved` and `module_path!()` stayed `inc::foo`.
4. **Re-exports add warnings.** `pub(crate) use part::X` that nothing uses is an `unused_imports` warning; `use
   super::*` trips `clippy::wildcard_imports` (pedantic).

A child-module mode could move only items that are `pub` or `pub(crate)` with every field and associated item, that use
no `self::` or `super::` path, and whose module path nobody reads. The last condition cannot be checked. That mode is
out of scope; see *Out of scope*.

**What `include!` still changes:** source positions. File names and line numbers in panics, `Location::caller()`,
`#[track_caller]`, `file!()`, `line!()`, backtraces and debug info; doc-test names (they carry the file and line);
and anything a proc macro derives from `Span::file()`, `Span::local_file()` or line numbers (stable since 1.88). Plus
two things the rules below close: `include_str!`/`include_bytes!`/`include!` paths inside moved code resolve against the
new file's folder (probed: `include_str!("data.txt")` read `src/foo/data.txt`, not `src/data.txt`), and `macro_rules!`
scope is textual, so an item that moves to the `include!` position can see a different set of macros (probed below).

**The cost:** `include!` for hand-written code is unusual Rust. Readers and tools expect modules. `cargo fmt` follows
`mod` declarations only, so it never formats or checks the new files. The change note says this plainly, and says that
turning a part into a real module later needs visibility changes my_editor does not make because they can change
behavior (point 1 above).

## Decisions

| Question | Decision | Why |
|---|---|---|
| Split mechanism | New files spliced back with `include!` into the same module | Module path, privacy, name and method resolution, macro paths, impls and coherence stay exactly the same. A child module changes them (probed above) |
| Parser | The rust-analyzer binary bundled with the editor, `rust-analyzer parse --json`, syntax only | Ships with the editor and runs offline; lossless (every byte, comments included), UTF-8 offsets, error nodes |
| Who plans | The model, by item ID, as in Go. It writes no code at all: `include!` needs no imports | Grouping is a judgement call; everything the host builds is mechanical |
| New files | Beside the original, named `<stem>.<name>.rs` (`parser.rs` → `parser.exprs.rs`) | A dotted stem can never be claimed by a `mod` declaration, sorts next to the original, and is not auto-discovered by cargo |
| Where `include!` goes | One block of `include!("…");` lines right after the file's leading block (*The leading block*) | One fixed place known at parse time, like Go's import block; moved items still see the same macros (*Macro scope*) |
| The proof | Move rules 1–5, rule 6 (same MIR, from a stable `--emit=mir` dump of a line-preserving variant), build and tests against the baseline | The compiler's own resolved code is compared, not source text |
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
`symbols` gives item ranges but not the attribute and comment structure, so it is not used.

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
plain `//` comment separated by a blank line is detached and stays where it is. An item that shares a line with other
code (another item, a statement) is not movable.

Byte offsets come straight from rust-analyzer; the host slices with `Buffer` only.

## The leading block

From the top of the file, the longest run of: inner attributes (`#![…]`), inner doc comments (`//!`), `use`
declarations, `extern crate`, out-of-line `mod x;` declarations, `macro_rules!` definitions, item-level macro calls
(`lazy_static!`, `thread_local!`; not `include!`, which skips the file), and items with `#[macro_use]`, with their
attributes and the comments and blank lines between them. The block ends at the first other item. It never moves.
Macro definitions and calls at the top are safe for the same reason as below: they are above the include block, so
above every moved item.

The **include block** goes right after it: one line `include!("<stem>.<name>.rs");` per new file, in plan order,
followed by one blank line. If the leading block is empty, the include block starts the file.

For the move check this is the file's `importRegion`, as for TS's facade: in the original before the split it is the
empty span at the start of the first non-blank line after the leading block (offset 0 when the block is empty); after
the split it is the include block. The core's rule 2 already treats an empty region as "imports go here" and ignores
blank lines right after the region, so the include block needs no change to rule 2 (to be confirmed with a test while
building).

## Macro scope

`macro_rules!` macros are scoped by text order: a macro is visible from its definition to the end of the enclosing
module, including child modules declared later, and an `include!`d file sees the macros defined before the `include!`
call. Path-based macros (`#[macro_export]` at the crate root, `use`d macros, the `macro_use` prelude) are the fallback
when no textual macro matches.

So moving an item to the include block, which is above its old place, changes which macros it sees when a macro is
defined between the two. Probed: `lib.rs` defines `macro_rules! which { () => { "outer" } }` before `pub mod foo;`;
`foo.rs` defines `which` returning `"inner"` and, before that, `include!("foo/part.rs")`, whose `b()` calls `which!()`.
`b()` returned `"outer"`; inline after the inner definition it returned `"inner"`. It compiled without a warning.

**The rule.** A **macro boundary** is a `macro_rules!` definition, an item-level macro call (`lazy_static!`,
`thread_local!`, `bitflags!`, `cfg_if!`, any `name!` at item level; any of them can expand to a `macro_rules!`), or an
item with `#[macro_use]`. Every item below the first macro boundary after the leading block is unmovable, with the
reason *a macro is defined or invoked above it at line N; moving it would change which macros it sees*. Boundaries
inside the leading block are above the include block and above every moved item, so they change nothing.

With that rule, the textual macro scope at the include block equals the scope at each moved item's old place: nothing
that defines or imports a macro lies between them, and the moved items themselves never do (they are never macros or
macro calls). Rule 6 would also catch the probe above (the string constant differs), but the static rule is the proof.

Files with `#[macro_export]` are skipped outright: such a macro is visible by path across the crate, and version 1 does
not reason about macro-expanded exports. Files with `#[path]` are skipped because they bend module file lookup, which
`include!`d files take part in: probed, a `mod sub;` written inside an included file resolved to the including
module's folder (`src/foo/sub.rs`), not the included file's.

## What may move

A **declaration** is one top-level item, from its span start (above) to the end of its last line. Plans refer to it by
ID (its index among the file's top-level items).

| Item | Movable when | Why not otherwise |
|---|---|---|
| `fn` (also `async`, `const`, `unsafe`, `extern "ABI" fn`), `struct`, `enum`, `union`, `trait`, `type`, `const` (also `const _`), `static` (also `static mut`), `impl` (inherent or trait) | Below the leading block, above the first macro boundary, whole lines, and none of the refusals below | — |
| `use`, `extern crate`, `mod` (inline or `mod x;`) | Never | They are the module's frame. A `mod x;` inside an included file would look for `x` in the including module's folder (probed) |
| `macro_rules!`, item-level macro calls (`include!`, `global_asm!`, `lazy_static!`…) | Never | Textual macro scope; unknown expansions. `$crate` appears only inside macro bodies, which never move, so it needs no rule |
| `extern { … }` blocks (also `unsafe extern`) | Never | `#[link]` attributes are collected in source order, which decides link order |
| Items with `#[no_mangle]`, `#[export_name]`, `#[link_section]`, `#[used]`, `#[link_name]`, `#[global_allocator]`, `#[panic_handler]`, `#[proc_macro]`, `#[proc_macro_derive]`, `#[proc_macro_attribute]`, `#[ctor]`, `#[dtor]`, `#[distributed_slice]`, any `#[linkme::…]` (also in `unsafe(…)` and `cfg_attr` forms) | Never | Linkage and section order are outside rule 6, and moving changes the item's place in the object file |
| An item whose span contains `file!`, `include!`, `include_str!` or `include_bytes!` (an identifier followed by `!`, anywhere: body, attribute such as `#[doc = include_str!(…)]`, macro arguments) or an out-of-line `mod x;` (in a function body) | Never | Probed: `include_str!` resolves against the new file's folder, and `file!()` gives the new file name, which code may use as a path |
| An item with `#[cfg(…)]` or `#[cfg_attr(…)]` | Movable | The same module and the same tokens under every configuration. Rule 6 sees only what the dumped configurations compile; items it did not see are listed in the change note |
| `#[test]` functions and `#[cfg(test)]` items (not `mod tests`) | Movable | Test names are module paths, which `include!` keeps (probed) |
| Items with derives or attribute macros | Movable | Same module; what a macro reads from spans is disclosed, and rule 6 catches changed generated code |

**No static initialization order.** Rust has no runtime initialization of `static`s: initializers are evaluated at
compile time, `lazy_static`/`OnceLock`/`LazyLock` run on first use, and `#[ctor]` is refused above. So `static` and
`const` move freely, unlike Go's initialized `var`s. `const fn`, generics, `where` clauses and trait impls need nothing
special: the module, and so every path in them, is the same. Trait coherence is per crate and unchanged.

## Skipped files

Reported, never split:

- **Not a member's compiled source:** not under a workspace member's folder (from `cargo metadata --no-deps
  --offline`); under `target/`, `vendor/`, `third_party/`, `.cargo/`; in a nested workspace; not listed in any dep-info
  file of the baseline (*Rule 6: membership*), which covers modules behind a `#[cfg]` that is off on this machine;
  listed by two targets (a lib and a bin that both `mod` the same file).
- **Build and test code:** the package's build script (`build.rs` or `package.build`); anything under `tests/`,
  `benches/`, `examples/`; files directly in `src/bin/` (a new `src/bin/x.y.rs` would become a new binary target).
- **Generated:** a first comment with `@generated`, `Code generated`, `DO NOT EDIT`, `automatically generated`;
  `linguist-generated`; any file that a tracked file names in `include!`, `include_str!` or `include_bytes!` (it is
  someone's data, including part files from an earlier split).
- **Module and macro tricks:** `#[path]` (also inside `cfg_attr`) anywhere in the file, or the file is named by another
  file's `#[path]`; `#[macro_export]`; an item-level `include!` (generated code or an earlier split; version 1 splits a
  file once).
- **Bytes:** a BOM, CRLF line endings, a shebang (`#!` not followed by `[`), a file over 512 KB, a symlink, invalid
  UTF-8, an `ERROR` node anywhere in the parse.
- **Package level:** edition 2015; a build script that reads the package's sources: a `cbindgen` or `syn`
  build-dependency, or a `rerun-if-changed` that names a path under `src` (cbindgen parses the source without expanding
  macros, so items moved into an included file would vanish from the generated C header); non-reproducible MIR
  (*Rule 6*).

`lib.rs`, `main.rs` and `mod.rs` are **not** skipped. `include!` keeps crate-root items at the crate root: probed, `fn
main` in an included file ran and printed `bin1` for `module_path!()`, and a `#[test]` in an included file ran as
`in_included`. Crate attributes (`#![…]`), `extern crate` and `//!` docs are in the leading block and never move.

A `[lib] path` override or other non-standard layout needs no rule: which files a target compiles is read from rustc's
dep-info, not guessed from paths.

## Applying a split (host, no AI)

**The plan.** As in Go: the model gets the declaration list (`{id, kind, names, receiver, lines, firstDocLine, movable,
reason}`) and proposes `[{ "file": "parser.exprs.rs", "declarations": [3, 7] }]`. It writes no import lines; there are
none. `planProblems` rejects unknown, repeated or unmovable IDs, bad names (*File names*), a new file or the original
over 400 lines (a single item over 400 lines stays a suggestion). A plan may move every movable item; the original
then holds its leading block, the include block and whatever could not move, which is still valid Rust.

**A new file** is: the header line `// Part of <original basename>, included there with include!. Split by my_editor.`,
a blank line (so the header never attaches to the first item), then the moved spans byte for byte in their original
order, separated by one blank line, ending with a newline. The header is a plain `//` comment: an inner `//!` doc would
be an inner attribute, which an included file cannot have.

**The original** keeps everything else byte for byte, minus the moved spans; blank lines around a removed span collapse
to one (as in Go). The include block is inserted at the import region. Nothing else changes: no `use`, no visibility,
no `mod`. Every `use` stays and stays used, because the moved items are still in the module.

**The include path** is the new file's basename: rustc resolves `include!` against the folder of the file that
contains the call (probed: `include!("foo/part.rs")` in `src/foo.rs` read `src/foo/part.rs`). Forward slashes work on
every platform.

## File names

`fileNameProblems(name, original)`:

- `^<stem>\.[a-z][a-z0-9_]{0,39}\.rs$`, where `<stem>` is the original's file stem (`mod.rs` gives `mod.<name>.rs`);
- no entry in the folder with the same name, ignoring case, and no repeat within the plan;
- cargo must not see a new target: rule 4 compares the package's targets before and after;
- when the package's `Cargo.toml` sets `include` or `exclude`, the new name must be packaged whenever the original is
  (checked in rule 4 with `cargo package --list --allow-dirty --offline -p <pkg>`; probed to list files offline without
  building).

A dotted stem cannot be a module name, so no `mod` declaration can ever claim the file, and nobody adding `mod exprs;`
later collides with it.

## Move check (Rust)

Rules 1, 3 and 5 are the language-neutral ones on byte spans. Rule 2 uses the core's import region, rule 4 gets Rust
parts, and rule 6 is new.

1. Each moved span appears byte-identical in exactly the new file the plan names.
2. The original equals its old bytes minus the moved spans (blank lines may collapse), apart from the import region.
   `rsImportProblems`: after the split, the import region holds exactly one `include!("<file>");` line per plan group,
   in plan order, and nothing else; before, it was empty.
3. A new file holds only the header line, a blank line and its moved spans (the header is the `prelude` and must equal
   `splitHeader`).
4. Same declarations and same targets:
   - the items of the original and its part files (kind, names, receiver, doc text) are the same multiset before and
     after (`declarationProblems`; for an `impl` the receiver is the self type and the name is the trait, if any);
   - after the split: the dep-info of every rule-6 variant build (which compiles the same file names as the real
     split) lists exactly the reference build's files plus the new ones, `cargo metadata --no-deps` reports the same
     targets, and the package-list check above passes.
5. No other tracked file changed.
6. **Same MIR** (below), after the checks pass.

Rules 1 to 5 (except rule 4's dep-info part) run on the files as written and re-parsed from disk, before any build.

### Rule 6: same MIR

`rustc --emit=mir` is a **stable** option and writes the MIR of every body in the crate: functions, closures, generic
functions, `const` and `static` initializers, promoted constants and, in a test build, the test harness. Probed:
`cargo rustc --lib -- --emit=mir,link` on stable 1.88 wrote it, and `cargo rustc --lib --profile test -- --emit=…`
added the `#[test]` functions and the harness `main`. MIR is after name resolution, macro expansion and method and
trait selection, so it is where the child-module failure above would show (`<S as Name>::name` instead of `S::name`)
and where the macro-scope probe would show (`"outer"` instead of `"inner"`).

**Why not compare the split directly.** Probed: a straight diff of the inline version and the `include!` version
differed in impl and closure positions (`<impl at src/foo.rs:3:1: 3:11>` became `<impl at src/foo/part.rs:2:1: …>`),
in `line!()` values (`const 3_u32` became `const 2_u32`), in `file!()` strings, and in a `static`'s bytes, where the
string length (`0a` versus `0f`) and the line (`04` versus `03`) are raw bytes. `log` and `tracing` macros put lines and
file names into code the same way, so they cannot be told apart from other integers and strings.

**The variant.** So rule 6 compares the reference against a **variant** of the split that keeps every token on its
original line and gives the new files names of the original's length:

- the variant original is the old original with each moved span's lines replaced by empty lines (same line count), and
  the `include!` calls prepended to the first line after the leading block (the first line of the file when the block
  is empty). That line is empty in the variant (it opened a moved span or was blank) or starts a remaining item or
  comment, so the calls never land inside a comment, as they would after a block ending in `//! docs`, and their tokens
  come after the leading block's and before the next item's, as in the real split;
- each variant new file is empty lines plus its moved spans, each starting on the line where it was in the original;
- the dump build adds `--remap-path-prefix=<new path>=<placeholder>` for each new file, where `<new path>` is the path
  as rustc names it (the original's path from dep-info, with the new basename) and `<placeholder>` has exactly the
  byte length of the original's path, differs per new file (`src/@@@@@1`, `src/@@@@@2` for `src/foo.rs`), and does not
  occur in the reference dump.

Probed: with the moved items padded to their old lines and the new file remapped to the equal-length `src/@@@@@@`, the
dump differed from the inline version's only in the placeholder (in positions, a `const "…"` string and one
allocation's bytes) and in allocation numbering (`alloc4` became `alloc3`). Remapping the new file to the original's own
path does not work: rustc's source map treated it as the same file and spliced the original into itself (probed:
*E0428 the name `keep` is defined multiple times*).

**Rule 6a: the variant is the split.** Before the variant is built, the host checks, per file, that the variant and
the real split have the same sequence of tokens apart from whitespace and plain comments (doc comments are `#[doc]`
attributes and are compared like any token), and the same file names. They differ only in blank lines, the header
comment and where the `include!` tokens sit on their line. In Rust such differences change spans only, which is exactly the disclosed set (*What "unchanged" means*).

**Rule 6b: the comparison.** Both dumps are normalized in three ways and nothing else:

1. each placeholder is replaced by the original's path, in text and byte-wise inside parsed allocation dumps (equal
   length, so no row or size changes; the hex rows are parsed, never matched by pattern);
2. each `allocN` reference is replaced by a hash of the allocation's normalized content, pointers inside it replaced
   recursively (a reference cycle is cut by its depth-first index), so numbering and sharing differences vanish;
3. bodies are sorted by their header line.

Then the two must be equal. The first difference is reported with its body header (*`fn foo::K::k` differs: `const
"inner"` became `const "outer"`*). A dump the parser cannot read (an unknown line shape, a format change in a new rustc)
means *cannot verify*, and the step is undone with that reason: the parser fails closed.

**The commands.** For each target that compiles the file (from dep-info) and each profile (`dev`, `test`):

```
cargo rustc -p <pkg> --lib|--bin <name> [--profile test] --offline [--locked] --message-format=short -- --emit=mir=<state>/<step>/<target>-<profile>-<side>.mir,dep-info=<state>/<step>/<target>-<profile>-<side>.d,link [--remap-path-prefix=<new path>=<placeholder>…]
```

They run through `runTool` with `commandEnv`, as Go's `go list` and C#'s MSBuild evaluations do, but they compile the
project's code (build scripts and proc macros run, as in the approved build), so the approval dialog lists them as
*MIR comparison builds* with the template above. The paths live in run state (they may have spaces; `runTool` passes
arguments without a shell). Probed: extra `cargo rustc` arguments leave `-C metadata` unchanged (`ef1677bbddd4ddbd` in
all three builds) and change only `-C extra-filename`, so the crate's identity (and with it `TypeId` values) is the
same in every dump, and the dump builds do not overwrite the normal build's artifacts. Also probed: `--emit=mir=<path
with a space>,dep-info=<path>,link` wrote both files where asked, and the dep-info listed the included file
(`src/lib.rs src/foo.rs src/foo/part.rs`, paths as rustc names them).

**When it runs** (the `assemblyCheck` hook proposed in the C# design):

- **baseline**, once per package with a chosen file: build every lib, bin and proc-macro target of the package, in
  both the `dev` and `test` profiles, with `--emit=dep-info` to learn which targets compile which files
  (**membership**; a `#[cfg(test)] mod` appears only in the test profile, and is not "not compiled on this machine"); dump `HEAD` twice and require equal
  normalized dumps (**reproducibility**: a build script or proc macro that embeds the time fails this); then dump once
  more with the original touched (a newline appended at its end, which moves no line) and an empty untracked file
  beside it, and require the same dump (**dirty stamps**: `vergen`, `built` or `git describe --dirty` would embed the
  difference and refuse every step). Then the touch is undone. A package that fails any of these has its splits
  skipped for the run with the first difference;
- **snapshot**, per step, before the split is written: dump `HEAD` (the reference), because stamps such as a commit hash
  change with every commit;
- **compare**, per step, after build and tests pass: write the variant over the real files, run rule 6a, dump, write
  the real files back and check their bytes against the split, then compare. The variant is never committed.

**The tool probe.** Once per rustc version (`rustc -vV`'s commit hash), the adapter runs the whole rule-6 pipeline on a
small shipped probe crate (an impl with a closure and `line!()`, a `static` with `file!()` and `line!()`, a generic
function, moved into a part file) and requires an empty difference. If it fails, Rust splitting stops with *my_editor
cannot read this Rust version's MIR dumps.*

**What rule 6 proves:** for each target that compiles the file, in the `dev` and `test` profiles, with the package's
default features and this machine's target: every MIR body is the same after the split as before, apart from the new
files' names, and the real split differs from the compiled variant only in whitespace and plain comments. So name
resolution,
method and trait selection, macro expansion, constant values and proc-macro output are unchanged in those builds.

**What it does not prove:** the `release` profile, other features, other targets and `cfg` values (the structural
argument still holds there: same module, same tokens, same macro scope); linkage (refused statically); type definitions
(they have no bodies; their bytes are identical and in the same module); file names and line numbers (disclosed).

**Cost:** per step, two dumps (reference and variant) per target and profile, usually four crate builds, on top of
build and tests. The dump builds use their own `extra-filename`, so the normal build stays cached. Doing all of a
package's files in one step would save builds; as in C#, version 1 keeps one file per step.

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
  unused variable: …`, so `baseline.ts`'s position pattern already strips the file and line. Lints fire in included code
  as they do inline (probed: `unused_variables`, `unused_parens`, `while_true` and `non_snake_case` reported at the new
  file's path). Cargo replays cached warnings for fresh crates (probed: the second, fresh build printed the same
  warning), so both baseline runs see them and nothing like C#'s `--no-incremental` is needed. Counted per message;
  a step fails when any count grows (C#'s `warnings: 'no-more'` core change, with a Rust warning pattern), so a
  project with `-D warnings` in `.cargo/config.toml` is covered either way.
- **`--no-fail-fast`**: without it the first failing test binary stops the rest, and later binaries' results would be
  missing.
- **Test output** (libtest's text; `--format json` is nightly-only). Probed shape:
  - `Running unittests src/lib.rs (target/debug/deps/inc-c3426b0877ddc581)` and `Running tests/it.rs (…)` start a
    binary; `Doc-tests inc` starts the doc tests. The binary key is the text before the parenthesis (`unittests
    src/lib.rs`, `tests/it.rs`, `doctests inc`), without the hash;
  - `test t::a ... ok`, `... FAILED`, `... ignored` (also `ignored, <reason>`) give pass, fail, skip; keys are
    `<binary> <test name>`;
  - doc-test names carry the file and line (`src/foo/part.rs - foo::moved (line 7)`), which a split changes. They are
    compared per binary and item path (`foo::moved`) as a multiset of outcomes;
  - a binary that crashes or never prints `test result:` counts as a failure of that binary; `error: N targets
    failed` lines are not parsed.
- **Formatter.** When the project uses rustfmt (`rustfmt.toml` or `.rustfmt.toml`, or `cargo fmt` in tracked CI files or
  scripts) and `rustfmt --version` works, `unformatted` runs `rustfmt --check --edition <edition> <file>` on the
  original before; if it was clean, the original and the new files must be clean after. `cargo fmt` is not used: it
  never visits included files. Not probed (rustfmt is not installed on the probe machine).

**Environment** (`commandEnv`): `RUSTUP_AUTO_INSTALL=0` (probed above; the Go `GOTOOLCHAIN=local` counterpart),
`CARGO_TERM_COLOR=never`, `CARGO_TERM_PROGRESS_WHEN=never`. Nothing else. In particular not `RUSTFLAGS` (it replaces
`build.rustflags` from `.cargo/config.toml`), `CARGO_TARGET_DIR` or `RUST_BACKTRACE`. The approval dialog shows any
`RUSTFLAGS`, `CARGO_*` or `RUSTC*` variables the editor's own environment passes through.

**Finding cargo:** `PATH`, then `~/.cargo/bin`, `/opt/homebrew/bin`, `/usr/local/bin`. `cargo -V` and `rustc -vV` run in
the worktree root, so `rust-toolchain.toml` applies; a failure stops the run with its message. A cargo that is not the
rustup proxy ignores `rust-toolchain.toml`; the run goes on and the change note names the toolchain used. A package
`rust-version` newer than the toolchain fails the baseline build with cargo's message.

**The target folder** is the worktree's own (`target/`, untracked), read from `cargo metadata`'s `target_directory`.
The first build compiles every dependency, which the approval text says. Removing the worktree removes it.

## What "unchanged" means

**Shown by** the move check, rule 6 and the checks:

- every moved item is byte-identical and still an item of the same module, after the same `use` declarations and in
  the same textual macro scope;
- every function, closure, constant and static compiles to the same MIR in the dev and test builds, apart from file
  names and line numbers;
- the build has the same errors and no more warnings, and the tests have the same results, as the baseline.

**Unchanged by construction** (the module is the same): module paths and so `module_path!()`, `log` and `tracing`
targets, `std::any::type_name`, `TypeId`; visibility and privacy; `self::`, `super::` and `crate::` paths; glob imports
and preludes (probed: an included item shadowed a glob import exactly as the inline one did); impls and coherence; test
names; rustdoc paths; symbol names of items outside impls.

**What may still differ** (in the change note, `mayDiffer`):

- file names and line numbers for moved code, and line numbers for the code below the include block in the original:
  panic messages, `Location::caller()`, `#[track_caller]`, backtraces, debug info, `line!()`, the file and line in `log`
  records, `tracing` metadata, `anyhow`/`eyre`/`snafu` locations;
- doc-test names (they carry the file and line);
- symbol hashes of methods in moved `impl` blocks (the impl's index in the module can change); seen only in backtraces;
- code a proc macro generates from `Span::file()` or line numbers (rule 6 sees the variant, whose lines are the old
  ones);
- the order of link-time registrations from derives (`inventory`, `linkme` behind a derive), which Rust leaves
  unspecified;
- tooling: `cargo fmt` does not visit the new files; rust-analyzer handles `include!` (to confirm in the editor that it
  does not flag the new files as outside the module tree).

## Components

In `src/aiready/`, each under 400 lines:

| Unit | Job | Interface |
|---|---|---|
| `rsTools.ts` | Find cargo and rustc, check the toolchain in the worktree, find the bundled rust-analyzer, run the parse probe and the MIR probe once per version | `rsTools(appRoot, extensionPath, storage, version): RsTools \| string` |
| `rsAst.ts` | Run `rust-analyzer parse --json` on one file; items with spans (attached comments), attributes, macro calls by name, `#[path]`, `include*!`/`file!` tokens, error nodes; the non-trivia token list for rule 6a | `rsFileFacts(tools, file): RsFacts` |
| `rsProject.ts` | `cargo metadata` (members, targets, editions, autodiscovery, `include`/`exclude`, build-dependencies), build-script source readers, Cargo.lock, rustfmt and clippy use | `rsProject(root, tools, tracked): RsProject` |
| `rsRules.ts` | Skip reasons, the leading block, macro boundaries, movability, file names (pure) | `rsSkipReason(…)`, `rsFileInfoView(…)`, `rsFileNameProblems(…)` |
| `rsSplit.ts` | New files and the original with the include block; the line-preserving variant (pure) | `buildRsSplit(source, info, plan)`, `buildRsVariant(source, info, plan)` |
| `rsMoveCheck.ts` | Rule 2's include block, rule 4's targets and package list, rule 6a's token equality | `rsImportProblems(…)`, `targetProblems(…)`, `sameTokens(…)` |
| `rsMir.ts` | Parse a MIR dump, the three normalizations, the comparison with a readable first difference (pure, fails closed) | `normalizeMir(text, placeholders): Mir`, `compareMir(a, b): string[]` |
| `rsMirCheck.ts` | Rule 6's hook: membership, reproducibility and dirty-stamp checks at baseline, reference dumps, variant write, dump and restore | `baseline(pkg, run)`, `snapshot(file, run)`, `compare(file, plan, run)` |
| `rsTests.ts` | libtest text into `TestRun` (binary keys, doc-test multisets, crashed binaries) | `parseCargoTest(output): TestRun \| undefined` |
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
| `LanguageInfo` for Rust: `fixes: ['split']`, `extensions: ['.rs']` | — |

The include block uses the existing `importRegion` and `importProblems`; no new rule-2 mechanism is needed.
`unitFiles(file)` returns the original and the part files its include block names. The add-tests members
(`testFileName`, `testNames`, `testProblems`, `testPrompt`) are never called, because `fixes` has no `tests`.

## Tests

Pure unit tests, plus toolchain tests that run when cargo and the bundled rust-analyzer are present and are skipped with
a note otherwise.

- **Parser and spans:** UTF-8 offsets with non-ASCII before a span; a `///` above a blank line moves with its item; a
  plain `//` above a blank line stays; attributes and `#[cfg_attr]` attached; a trailing `// comment` moves; an item
  sharing a line is not movable; an `ERROR` node skips the file; `fn gen` in an edition 2021 file skips it; the probe
  file check rejects a changed JSON shape.
- **Leading block and include block:** `#![…]`, `//!`, `use`, `extern crate`, `mod x;`, top `macro_rules!` and
  `#[macro_use] mod` form the block; the include block lands after it, or at the top when it is empty; an existing
  item-level `include!` skips the file.
- **Macro scope:** an item below a `macro_rules!` after the leading block is unmovable (the outer/inner probe as a
  toolchain test, which must also fail rule 6 when the static rule is disabled); below `lazy_static!` or `thread_local!`
  in the middle of a file likewise; above them movable; `lazy_static!` at the top joins the leading block and leaves the
  items below it movable; `#[macro_export]` skips the file.
- **Movability:** each item kind from the table; `use`, `mod`, `extern crate`, `extern` blocks and macro calls stay;
  `#[no_mangle]`, `#[unsafe(no_mangle)]`, `#[cfg_attr(x, link_section = "…")]`, `#[used]`, `#[ctor]` refuse; `file!()`,
  `include_str!` in a body and `#[doc = include_str!(…)]` refuse; `line!()` moves; a `#[test]` fn moves; a plan moving every item leaves a valid original.
- **Skipped files:** `#[path]` in the file and naming the file; `build.rs`; `tests/x.rs`; `src/bin/x.rs`; a generated
  header; BOM; CRLF; shebang; a file in two targets; a file not in any dep-info (`#[cfg(windows)] mod win;`); an
  edition 2015 package; a `cbindgen` build-dependency; a path dependency outside the workspace.
- **Plan and names:** `foo.exprs.rs` passes; `exprs.rs`, `foo.Exprs.rs`, an existing name (any case), a repeat in the
  plan, a new file over 400 lines refuse; `mod.rs` gives `mod.<name>.rs`; `include`/`exclude` in `Cargo.toml` that would
  leave the new file out of the package fails rule 4.
- **Move check:** pass on a clean split; fail on an edited span, an extra line in the original, an include line out of
  plan order, a `use` added to a new file, a changed header, another tracked file changed; rule 2 accepts the include
  block with and without a blank line after the leading block.
- **Rule 6:** the probed shapes as fixtures: a moved impl with a closure and `line!()`, a `static` with `file!()` and
  `line!()`, a generic function; pass after normalization; the placeholder replaced inside a parsed allocation; shared
  versus separate allocations compare equal; a different `const` fails with the body header; the child-module privacy
  probe (forced through the variant path) fails; an unknown dump line fails closed; a build script embedding the time
  fails reproducibility; one embedding `git describe --dirty` fails the dirty-stamp check; a commit hash stamp passes
  because the reference is built at `HEAD`; a test-profile dump includes `#[test]` bodies; a placeholder that occurs in
  the reference dump is replaced by another; rule 6a fails when the variant has a token the split lacks; a leading block
that ends in a `//!` or `//` comment line puts the variant's `include!` calls on the next line, and rule 6a passes;
a changed `///` line fails rule 6a.
- **Checks:** the probed `--message-format=short` warning line compares equal after a move; a new warning fails, a lost
  one passes; warnings replayed on a fresh build; libtest lines (`ok`, `FAILED`, `ignored`, `ignored, reason`), binary
  keys without hashes, doc tests with changed file and line compare equal, two doc tests on one item, a crashed binary
  fails; `cargo fetch --locked` only with a tracked `Cargo.lock`; `RUSTUP_AUTO_INSTALL=0` with a missing pinned
  toolchain stops with cargo's message; no `push`, `fetch` or `remote` git command; no environment variable beyond the
  listed ones set by the adapter.
- **Languages:** a root with only `Cargo.toml` gets Rust; with `Cargo.toml` and `package.json`, TS/JS and the note; a
  virtual workspace root gets Rust.
- **End to end** in a dev host: a binary crate with a 900-line `main.rs` (clap, `log`, `anyhow`), a library workspace
  with a 1,200-line `parser.rs` with doc tests, derives (`serde`) and `#[cfg(test)] mod tests`, and a crate with
  `tracing` and `macro_rules!` helpers at the top of the file. Expect build, warnings and tests equal to the baseline,
  rule 6 equal, one commit per split, the user's folder untouched.

## Out of scope for this version

- Splitting into real child or sibling modules (*Why Rust needs its own scheme*). A later "module" mode would need rule
  6 to map the moved items' paths (`foo::X` to `foo::part::X`) and could only accept items that are `pub` or
  `pub(crate)` with all fields and associated items, use no `self::`/`super::` paths, and are not observed by module
  path; it would still change `type_name`, `module_path!()` and log targets.
- Files after a macro boundary, files with `#[macro_export]` or `#[path]`, a second split of an already split file,
  test, bench, example and build-script files.
- Rule 6 for the release profile, other features and other targets; the public API compared through rustdoc JSON
  (nightly only) or `cargo expand` (nightly). Comparing symbol tables (`nm` on the rlib or binary) was considered and
  dropped: with `include!` the names are the same by construction, and a symbol table says nothing about function
  bodies, which is where every probed failure showed.
- Moving `use`, `mod`, macros, `extern` blocks and link-attributed items.
- Add-tests for Rust; `cargo nextest` output (projects that use nextest still get `cargo test`).
- Platforms whose editor build does not bundle rust-analyzer.

## Review: the points most likely to be wrong

1. **`include!` is the right proof and the wrong idiom.** It keeps the module, which makes the split provable, but Rust
   readers and tools expect modules, `cargo fmt` never formats the new files, and a user who later turns a part into a
   module meets the privacy problem this design avoided. The task framed the split as a child module; this design
   refuses that scheme on probed evidence. If the user prefers idiomatic modules with a much narrower scope, that is a
   different design.
2. **Rule 6 depends on the MIR text format**, which is compiler-internal and changes between releases. Both dumps come
   from the same compiler, so only the parser is at risk: it must fail closed on anything it does not know, and the
   per-version probe crate must exercise allocations, promoted constants, closures, impls and generics. A rustc that
   prints something new will refuse every split until the parser learns it (safe, but annoying).
3. **The variant argument.** Rule 6 compares a line-padded, path-remapped variant, not the committed files; rule 6a then
   claims the two differ only in whitespace and plain comments, and that such differences change only spans. That holds for
   rustc; it fails for a proc macro that reads line numbers or `Span::file()`, which the change note discloses but
   nothing catches.
4. **Stamps and reproducibility.** The baseline builds `HEAD` twice and once touched. A stamp that changes rarely (per
   day), or a dirty check that reacts to something other than a modified tracked file or an untracked file, can still
   pass the baseline and fail a step, which is then undone: safe, but confusing.
5. **Macro boundaries are conservative.** Macro definitions and calls at the top of a file join the leading block, but
   one in the middle is a boundary, so a file with `thread_local!` or `lazy_static!` half way down can move only what is
   above it. An allowlist of macros known not to define macros would help, but a local `macro_rules! lazy_static` could
   shadow the name; version 1 does not try.
6. **rust-analyzer's CLI is unstable and edition-blind.** The pinned version and the probe file guard the output shape.
   Parsing as edition 2024 skips older files that use newer keywords as names; a construct that parses validly but
   differently across editions would give a wrong span, which rules 1 to 4 and the build would catch.
7. **Build scripts that read sources** are found by build-dependency names and `rerun-if-changed` paths. A custom
   script that parses `src/` another way (a code generator, a doc tool) is missed, and its output may silently lose the
   moved items if it lands in `OUT_DIR` rather than a tracked file.
8. **Cost.** Rule 6 adds about four crate builds per step, and the first build in the worktree compiles every
   dependency. Large workspaces will be slow; batching a package's files into one step is the first optimization.
9. **Not probed:** rustfmt and clippy (not installed on the probe machine); rust-analyzer's handling of the new files in
   the editor; `cargo package --list` with a real `include` list; the doc-test multiset keys on a crate with many doc
   tests; `Span::file()` under `--remap-path-prefix`.

Related: [AI-ready design](2026-10-07-ai-ready-design.md), [TS/JS design](2026-10-09-ai-ready-ts-design.md),
[Python design](2026-10-10-ai-ready-python-design.md), [C# design](2026-10-10-ai-ready-csharp-design.md),
[Stage 2 Go plan](2026-10-09-ai-ready-stage2-go-plan.md).
