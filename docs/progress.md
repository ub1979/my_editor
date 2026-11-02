# Progress against the plan

Status of the requirements in [`plans/my_editor-plan-v2.md`](plans/my_editor-plan-v2.md). The original checklist is from 2026-09-23; the additions below are from 2026-09-25.
✅ done and verified in the app · 🟡 partly done · ⬜ not started.

## 0.0.33 alpha inline class recovery — 2 November 2026

The reported //AI directive is valid. Removed the separate 100-line snippet limit in favor of the remaining source-file budget, separated the rejection reasons, and added one bounded correction attempt plus redacted response inspection. Prompts preserve the planned public API and request complete typed error handling. All 741 automated tests passed, plus an editor-host replay of the reported stub with a 111-line class, correction, failure and concurrent-edit cases. The user's project was only read. Local installation and archive are prepared for testing.

## 0.0.32 alpha file-local pair programming — 1 November 2026

File chat follows the active source file and retains separate transcripts and drafts. Planned-file rationale comes from linked saved planning evidence, and Review/Explain use the selection or unsaved file with brief replies by default. Existing inline AI directives now include linked plan context and style instructions, with stale-buffer protection and reviewed Keep. Opening files does not invoke a model. All 735 automated tests and the file-chat and coding editor-host suites passed. The screen-inspection tool timed out, so visual acceptance remains pending. Local installation and archive are prepared for user testing.

## 0.0.31 alpha stable planning baseline — 1 November 2026

The reported saved chat showed a request to keep architecture v1.0.1 and switch to the tree producing another architecture revision. Stage handoffs now recognize that wording. Host-enforced inspection prevents replacement proposals during checks, existing drafts open without generation, and explicit revisions still require Keep. Analysis writes separate observed-code reports in the brain rather than replacing planning files. Creating saved planned files uses the tree without model regeneration. The user's current saved requirements, architecture and tree pass validation and were only read. All 731 automated tests passed, along with editor-host plan-stability, planning retrieval and separate/shared-chat checks. Local installation and archive are prepared for user acceptance testing.

## 0.0.30 alpha separate agent chats — 1 November 2026

Agent chats now retain independent transcripts and working briefs by default. A visible Shared chat option restores the combined workflow explicitly. Migration preserves the complete prior chat and copies identifiable exchanges into the corresponding agents, including full document recovery. Returning to an agent resumes without generation; drafts and New chat are scoped to the active conversation, while saved specs remain shared project evidence. All 724 automated tests passed. Real editor-host tests verified eight requests across isolated and shared chats, plus the existing planning suite and captured architecture Keep/recovery replay. Local installation and archive are prepared for user acceptance testing.

## 0.0.29 alpha architecture recovery — 1 November 2026

The validator had mistaken general anchored topics for components, and the error UI matched the word model inside data-models. Component groups now determine validation scope, model recovery is an explicit host action, and complete retained replies can reopen for Keep without regeneration. Saved tree section values are supplied in full. All 713 automated tests passed. The user's exact latest architecture response was replayed and kept in a disposable editor, including a second review with zero model calls; requirements, tree and selected model were preserved. The original project was only read. Its saved failed message renders the new Review saved architecture action after restart.

## 0.0.28 alpha planning startup fix — 1 November 2026

The reported failure came from opening Requirements: a generic kickoff let the model resume an older architecture request under the Requirements target. Completed-stage kickoff is now host-driven, showing saved status and the next incomplete stage with no model request or proposal. Draft kickoff names its exact document. All 706 automated tests and the editor-host planning suite pass, including the reported reopen flow. The actual social-media project maps from complete Requirements to unfinished Architecture; its files were only read during this investigation.

## 0.0.27 alpha planning audit — 1 November 2026

Fixed shared planning intent routing, wrong-document rejection, HTML/nested section parsing, interface recognition, complete generated-document history, nested code fences, trailing warnings and archive failure handling. Keep uses a fixed original snapshot. The user's archived architecture validates against the saved requirements and 14-section tree; rebuilding the project is unnecessary. All 701 automated tests passed, plus the planning and general editor-host checks. The earlier Go split test passes with normal build-cache access; failed package discovery now reports its cause. Local installation and versioned archive are prepared for user acceptance testing.

## 0.0.26 alpha local fix — 1 November 2026

Regenerating architecture from a Requirements answer now switches the planning target. Saved requirements in the reported project already pass validation; no project regeneration is needed. Planning and choice regression tests pass.

## 0.0.25 alpha local release — 1 November 2026

Claude effort selection is available beside the model picker, using discovered model capabilities and separate saved preferences for Claude and Codex. Build and 17 focused tests passed; the existing Go split failure remains.

## 0.0.24 alpha local release — 1 November 2026

Claude now offers discovered versions and pinned model IDs. Planning can retrieve earlier user and assistant messages and saved chats; finalization choices route to the described document. The build, 40 focused tests, planning and general editor-host smoke tests, and a live Claude response passed. Full suite: 687/688; the existing Go split declaration-check failure remains. A versioned local app archive is available for user acceptance testing.

## 0.0.23 alpha source audit — 31 October 2026

Reviewed chat and cancellation, planning references, proposals and scaffolding, provider failures, source helpers, theme generation and build/install scripts. Fixed reproducible issues and added regression coverage. The current checkout builds and passes 682 extension tests, 53 Python helper tests and the Go extraction suite. Details and remaining live validation are in [the audit](audits/2026-10-31.md).

## 0.0.22 alpha source update — 31 October 2026

Planning completion now checks document content and saved references. Summary drafts no longer complete a stage; finalization buttons prepare full proposals. Chat question options become clickable answer cards, and Flow & tree uses a matching illustrated avatar. Reinstall and live editor validation remain pending.

## 0.0.21 alpha source update — 31 October 2026

Flow & tree has a dedicated role and creates missing planned files after Keep. Pair offers persistent chat text size controls. Settings, Keyboard Shortcuts, theme secondary text and chat controls have contrast fixes. Source checks are recorded in the commit; reinstall and final live UI verification remain pending.

## v0.1 — pair mode (plan milestones M0–M3)

| ID | Requirement | Status | Notes |
|---|---|---|---|
| FR-001 | Build from VSCodium as my_editor, macOS arm64 | ✅ | `scripts/build.sh`; ~8 min with `--reuse` |
| FR-002 | Built-in extensions + numbered core patches on a pinned tag | ✅ | 10 patches in `overlay/patches/`, listed in [patches.md](patches.md) |
| FR-003 | Open VSX; basedpyright | ✅ | Bundled: pinned in `overlay/bundled-extensions.json` and sha256-checked from Open VSX at build time, with Python, Rust, Go and C/C++ support |
| FR-010 | Providers | 🟡 | Claude CLI (subscription), Codex CLI, Ollama and LM Studio **tested live in the app**; Anthropic/OpenAI/OpenRouter API keys written but untested (no keys here) |
| FR-011 | Subscription route | ✅ | `claude` and `codex` CLIs, Lyra-style guard rails |
| FR-012 | Model per job | 🟡 | Chat uses the picked model; navigator picks local → Haiku → default |
| FR-013 | Keys only in the OS keychain | ✅ | SecretStorage; `my_editor: Set API Key` |
| FR-020 | SKILL.md from built-in, global, project | ✅ | Project overrides global overrides built-in |
| FR-021 | Call skills from chat, palette, right-click | 🟡 | Chat (`/skill`) only |
| FR-022 | Skills can only read and propose | ✅ | Skills get no tools; every write is a reviewed edit |
| FR-030 | Layered brain | ✅ | `index.md` + `map.json` + a note per part in `brain/modules/` |
| FR-031 | Facts from a parser, never the LLM | ✅ | Regex extractor for TS/JS/Python, tested on song_maker (0 mismatches) |
| FR-032 | Update on save | ✅ | Facts update on save; one-line AI summaries come from Analyse and are kept across rebuilds |
| FR-033 | Git freshness | 🟡 | Commit recorded; stale entries not shown yet |
| FR-034 | Brain for an existing repo | ✅ | **Analyse this project**: offered once when a project with code has no brain, runs only if the user says yes. Summarises every file (quick model, secrets redacted, `.env`/keys skipped), writes part notes, proposes `architecture.md` and `tree.json` for Keep/Undo. Long files are summarised in pieces cut between definitions, then as a whole (the pieces become a line-range outline the pair sees). Each part gets a few sentences. Re-runs only redo changed files (content hash) and rewrite only changed architecture sections. Anything not covered is reported in the chat and the brain index: files over 400 KB, the 5,000-file cap, the 1,500-files-per-run cap (Continue button), failures. Tested on a 50-file project with Claude CLI |
| FR-035 | Context assembly | 🟡 | Conventions + brain index + file + neighbours; no token accounting yet |
| FR-036 | Brain hand-editable | ✅ | Notes outside the auto markers and `note` fields survive rebuilds |
| FR-041 | Chat history, secrets redacted | ✅ | `.my_editor/chats/`, complete replies retained with secrets redacted |
| FR-050 | Chat aware of file, selection, problems, brain | ✅ | |
| FR-051 | Help modes | ✅ | `/file /feature /change /next /explain /why /review /qa /brainstorm /locate /impact`, plus `/requirements /architecture /tree` for planning |
| FR-052 | Every AI edit is a diff with keep/undo per hunk | ✅ | Pair proposals in an in-memory file system, shown as an inline diff (decision 0002, which replaced the core chat of 0001) |
| FR-053 | Nothing written before Keep | ✅ | Proposals live in memory until Keep (decision 0002); Keep warns if the file changed since, but that check is not tested |
| FR-054 | Navigator on save, never edits | ✅ | Found a planted bug with a local model |
| FR-055 | Mute per file/session; debounce | ✅ | Commands in the palette |
| FR-056 | Driver: next step | ✅ | `/next` |
| FR-057 | Brainstorm, save as decision | ✅ | Button after a brainstorm |
| FR-058 | Everything AI can be switched off | 🟡 | Navigator and chat history have settings; chat via `chat.disableAIFeatures` |

## After v0.1

### New product requirements (25 September 2026)

| ID | Requirement | Status | Notes |
|---|---|---|---|
| FR-059 | Choose a reviewed AI fix or guided manual fix for a live finding | 🟡 | Source now adds Quick Fix choices to Navigator, comment, and structure findings. Running-app validation is open. |
| FR-085 | Check correctness, performance, style, design, comments and tests against project conventions | 🟡 | Navigator prompt now requests evidence-based findings across these areas; comment guidance is advisory. Accuracy and coverage need real-project validation. |
| FR-086 | One responsibility per source file, one class per file where relevant, and a 300-line maximum for human and AI changes | ✅ | AI proposals and Keep are rejected above 300 lines or with multiple top-level classes. Human edits get diagnostics and a rebuilt VSCodium save gate. The editor-host smoke test confirms that 301 lines stay unsaved. Maintained source/helpers/tests are checked for 300 lines and one class per file. |
| FR-087 | Helpful Pair roles switch with task and project, with manual override | 🟡 | Eight role-named agents and source routing are implemented; live editor validation remains open. Choosing a planning stage selects its agent. Manual choice pins the voice until Auto, another skill, or a project folder change. |
| FR-088 | Find likely change sites and open relevant files near exact lines | 🟡 | `/locate`, a Find a change card, and host-verified tab opening are implemented; real-project search quality and UI behavior need live validation. |
| FR-089 | Pair researches on the web before asking or advising (5 October 2026) | 🟡 | Claude and Codex subscription models use their own web search in every skill; checked from the extension's CLI code with both, not yet in the running app. Local and API-key models have no search. `myEditor.pair.webAccess` turns it off. |
| FR-090 | Offer to make a foreign project AI-ready (7 October 2026) | 🟡 | Stage 1 health report built, reviewed and unit-tested (131 tests); checked end to end in a dev window on a sample project with Claude Haiku (found the planted bug at its line, code untouched); installed-app check by the user pending. Follow-ups: Analyse's Continue button doesn't refresh the report; whole-project texts held in memory; redaction of a multi-line key shifts later line numbers. Stage 2a (Go fixes on a local branch) built and unit-tested (155 tests), dry-run on a copy of the dialer; live check pending. Refactor of long Go functions (extract function) built and reviewed (632 TS tests, goextract tests), dry-run on a copy of the dialer: both store functions refactored and split. TS/JS, Python, C#, Rust and C/C++ adapters next. |
| FR-091 | Run Python lines and cells in a persistent interactive session | ✅ | Shift+Enter runs a selection or line; Cmd/Ctrl+Enter runs a `# %%` cell. Project interpreter, retained variables, final-expression display and restart. Editor-host smoke test executes two dependent selections. |
| FR-092 | Automatic or manual coding assistance | ✅ | Persistent Auto/Manual status control. Auto reviews changed code after a quiet typing period; explicit review works in either mode. Editor-host checks cover automatic typing review and manual silence. |
| FR-093 | Generate only the code requested by an inline AI comment | ✅ | `#Ai <instruction>` / `// Ai ...` CodeLens and command; Auto mode starts on Enter. One bounded insertion below the directive, stale-file guard and Keep/Undo review. Surrounding text is preserved exactly. |
| FR-094 | Optional tests and accessor suggestions at declarations | ✅ | Language-provider CodeLens actions for functions/classes, plus an explicit manual command. The prompt limits work to the chosen declaration and existing test framework. |
| FR-095 | Recover Ollama project actions and report file state truthfully | ✅ | Known tool-action shorthand and prose repair, host-tool recovery for access denials, current unsaved-buffer reads, false-write-claim guard, nested creation, reviewed deletion and bounded response time. Adapter tests and deterministic editor-host tests pass; individual model reliability varies. |

### Other work after v0.1

| Area | Status | Notes |
|---|---|---|
| Decisions (FR-040) | 🟡 | From brainstorms; linking to files not yet |
| Review notes as line comments (FR-042) | ⬜ | |
| "Why is this like this?" (FR-044) | ✅ | `/why` cites decisions and past chats about the file; says when there is no record |
| Guided build: requirements, architecture, tree (FR-060–062) | ✅ | Requirements verified end to end with a local model; architecture/tree share the same path |
| Scaffold stubs from the tree (FR-063) | ✅ | Keeping tree.json creates every missing planned file as a stub; supported text formats include the JSON role as a comment. Existing files are preserved. The manual command still lets users tick files. |
| Progress per file (FR-064) | ✅ | stub → in progress on save → done by command; Build opens the next file with `/next` |
| Change impact list (FR-070–071) | ✅ | `/impact`: section, requirement or symbol → affected files with Adapt buttons; decisions not yet recorded (FR-072) |
| QA on a folder (FR-080) | ✅ | Right-click → Check How These Fit: tool findings saved to `.my_editor/qa/`, then `/qa` explains |

## UI

| Item | Status |
|---|---|
| Paper and Night themes, contrast-checked | ✅ |
| Centred page that keeps ~100 columns | ✅ |
| Quiet status bar, no Copilot prompts, Ask mode only | ✅ |
| Project view in the song_maker style | ✅ |
| App icon and empty-editor mark | ✅ |
| Defaults applied from the first frame (patch 130) | ✅ after build 5 |

## Security and safety fixes (review, 2026-09-23)

- Whole-file edits refuse files over 60k characters (the model only sees part of them).
- Program paths and server URLs are user-level only; verified that a project's `.vscode/settings.json` cannot run a planted program.
- The navigator skips `.env`/key files and redacts secrets before sending.
- Codex runs without browser/computer use, apps, plugins or MCP servers. Since 5 October, Pair may enable its hosted web search (and Claude's WebSearch/WebFetch), unless `myEditor.pair.webAccess` is off.
- Replies that elide code ("… existing code …") are refused instead of applied.

## Known issues

- A "Local" label still shows under the chat input after the first message (the mode picker is gone).
- The app bundle is ~1 GB; it has not been slimmed.
- Only tested with a fresh profile on macOS arm64.
