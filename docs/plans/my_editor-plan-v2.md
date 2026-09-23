# my_editor — A Code Editor Where You Stay in Control
## Plan & Requirements v2

**Author:** Syed Sheheryar Bukhari
**Date:** 23 September 2026
**Status:** Draft for review
**Supersedes:** `keel-plan-v1.md` (which drifted into a VS Code extension and a drift-detection product)

---

## 0. Decisions made (grilling, 23 Sep 2026)

| # | Question | Decision |
|---|---|---|
| D1 | Extension or editor? | **Own editor.** Fork of VSCodium (Code-OSS plus build, branding and Open VSX scripts) |
| D2 | Why fork? | Inline diff UX, own the whole UI, own brand, control defaults |
| D3 | Who is v1 for? | The author first. macOS arm64 build, unsigned, no auto-update |
| D4 | Time | Full time |
| D5 | Records to keep | Decision log, chat history, code comments, review notes — all four |
| D6 | Brain updates | Automatically, when a file is made and saved |
| D7 | When the user codes by hand | **Actively advise** (navigator), never edit |
| D8 | Pair programming roles | Navigator, driver on request, brainstorm buddy |
| D9 | Model access | BYO API keys, Claude subscription, Ollama; **model chosen per job** |
| D10 | Skill format | `SKILL.md` files (same as Lyra / Claude Code); built-in, global and per-project |
| D11 | Languages | TypeScript/JS and Python deeply; any language generically |
| D12 | Spec or decision changes | **Impact list**: user picks files, AI proposes diffs one file at a time |
| D13 | Existing projects | Supported in v1 (brain bootstrap from an existing repo) |
| D14 | Storage | Everything in the repo under `.my_editor/`, committed to git |
| D15 | First usable version (v0.1) | **Pair mode first** — brain + navigator + driver on request + brainstorm |
| D16 | Name | **my_editor** — final |

---

## 1. The idea

> Other AI editors build the project *for* you. **my_editor helps you build it yourself.**

You talk to the editor the way you would talk to a senior colleague. It uses skills (requirements,
architecture, planning, review, QA, brainstorming, debugging) to help you design the project, lay out
its flow and file tree, and then build it **one file at a time**. For each file you choose:

- write it yourself,
- ask the AI to write the whole file,
- ask the AI to write just one feature or function,
- or ask for help, an explanation, or a second opinion.

The editor keeps a **project brain** — a short, always-current map of the whole project, its
decisions, conventions and your style — so every AI request has the right context without flooding
it. Over months, it helps you maintain and change the project the way *you* want it built.

### The control contract

These six rules are the product. Every feature must obey them, and they are enforced in code
(tool layer), not only in prompts.

1. **The AI writes only what you ask, only where you ask** — a file, a function, a selection.
2. **Every AI write is a diff you accept.** No silent writes, ever, in any mode.
3. **Advice never edits.** The navigator comments; it does not touch code.
4. **Everything the AI knows about your project is a readable file you can edit** (`.my_editor/`).
5. **You can always code with zero AI.** Every AI feature can be switched off.
6. **Your style wins.** Conventions and learned preferences go into every request.

### Relationship to Lyra

Same knowledge, opposite control.

- **Lyra**: the AI drives; the human approves at checkpoints. Builds software *from* a description.
- **my_editor**: the human drives; the AI helps on request. Helps you build software *yourself*.

my_editor reuses Lyra's skills (rewritten so each one ends in a proposal you accept) and Lyra's
project-brain idea (bounded size, freshness checked against git). It does **not** reuse Lyra's
orchestrator, kanban, workers or Hermes runtime.

### Non-goals (v1)

- Autonomous "build the whole app" mode
- Tab autocomplete (possible v2)
- Deployment/DevOps, security audits, team accounts, cloud sync
- Windows/Linux builds, signing, auto-update (until a public release)

---

## 2. Core concepts

### 2.1 Project brain

The brain is how the editor understands a large project without context problems. It is layered,
so a request loads only what it needs:

| Layer | File | Size budget | Written by |
|---|---|---|---|
| Index | `brain/index.md` | ≤ 2,000 tokens | AI summary, user-editable: purpose, stack, module list, key conventions, current work |
| Module notes | `brain/modules/<module>.md` | ≤ 800 tokens each | AI summary per folder/module, user-editable |
| File map | `brain/map.json` | one entry per file | **Facts from the parser** (exports, imports, symbols) + a one-line role written by AI |
| Links | inside `map.json` | — | Which requirement, architecture section and decisions each file belongs to |

**Rules**

- Facts (exports, imports, signatures, who-imports-whom) come from a parser or language server,
  **never from the LLM**. The LLM writes only short summaries. This keeps the brain correct.
- **Update trigger (D6):** on save, the file's facts update immediately (cheap, no AI). The file's
  one-line role and its module note are refreshed by a cheap model when the file's exports or
  signatures changed, or when the file is marked done.
- **Freshness** is checked against git, as in Lyra: each entry records the commit it was built from;
  stale entries are shown and refreshed on demand.
- The brain is plain text in the repo. You can read and edit it; hand edits are kept, not overwritten.

**Context assembly.** Every AI request gets, within a token budget:
`conventions` + `brain/index.md` + the current file's map entry and module note + its direct
neighbours (imports and importers) + linked spec section + relevant decisions + the open buffer,
selection and diagnostics. Nothing else unless you add it (`@file`, `@decision`, `@spec`).

### 2.2 Skills

Skills are `SKILL.md` files, the same format as Lyra and Claude Code.

- **Where they come from:** built-in (shipped with the editor) → global (`~/.my_editor/skills/`) →
  project (`.my_editor/skills/`). Project skills override global, global override built-in.
- **How you call them:** `/skill` in chat, the command palette, or the explorer/editor right-click menu.
- **What they may do:** read the project and the brain, ask you questions, and **propose** — diffs,
  documents, notes, decisions. The tool layer gives skills no direct write tool; all writes go
  through the diff gate.
- Frontmatter adds `model_tier` (strong / cheap / local) so the model router picks the right model.

### 2.3 Records

| Record | Where | What |
|---|---|---|
| Decision log | `decisions/NNNN-title.md` | Short ADRs: what was decided, why, alternatives, linked files/symbols |
| Chat history | `chats/YYYY-MM-DD-<id>.md` | Every conversation, with the files it touched. **Secrets redacted before writing** |
| Review notes | `notes/*.json` | Line comments and TODOs from you or a review skill, shown with the editor's Comments UI, anchored so they survive edits |
| Code comments | in the code | The AI writes comments and docstrings in your style (from conventions) |

With these you can ask: **"Why is this code like this?"** — the editor answers from the decisions,
chats and notes linked to that file or selection.

### 2.4 Memory

`memory/learnings.jsonl` (from Lyra's `learn` skill): patterns, pitfalls, your style preferences
("prefers early returns", "no default exports"). Added when you say "remember this" or accept a
suggestion to record one. Used in context assembly.

---

## 3. Artifact layout

```
my-project/
├── .my_editor/
│   ├── conventions.md          Your rules and style; injected into every coding request
│   ├── specs/
│   │   ├── requirements.md     Requirement IDs (FR-/NFR-), user journeys, acceptance criteria
│   │   ├── architecture.md     Components, patterns, data models, APIs; sections have stable IDs
│   │   ├── flows.md            User flows and data flows
│   │   └── tree.json           Planned files: path, role, requirement IDs, architecture section, status
│   ├── brain/
│   │   ├── index.md
│   │   ├── map.json
│   │   └── modules/*.md
│   ├── decisions/NNNN-*.md
│   ├── notes/*.json
│   ├── chats/*.md
│   ├── memory/learnings.jsonl
│   ├── skills/                 Project-level skills
│   ├── qa/                     QA and review reports, dated
│   └── state.json              Guided-flow phase, approvals, per-file status
├── src/
└── ...
```

**Stable section IDs.** Architecture sections carry an anchor (`## Auth service {#auth-service}`),
and `tree.json` links to the anchor, not to a heading number. Renumbering never breaks links.

**Rules:** every file is human-readable and hand-editable; a text editor is always enough to fix
`.my_editor/`; file-watcher reconciles hand edits instead of overwriting them.

**Git.** Everything is committed (D14). Chat transcripts are stored as trimmed Markdown (tool
outputs cut) to keep the repo small, and redacted for secrets before they touch disk.

---

## 4. How it works — the main flows

### 4.1 Pair mode (v0.1)

You code. The editor is your pair.

- **Navigator (D7):** on save (debounced, only the changed hunks), a cheap model checks the change
  against conventions, architecture and the brain. Findings appear as warnings in the editor and in
  a Navigator panel ("this duplicates `formatDate` in `utils/date.ts`", "breaks the repository
  pattern in ADR-0004"). It **never edits**. You can mute it per file or per session.
- **Driver on request:** "take the next step" — the AI writes the next small piece of the current
  file or task as a diff. You review, accept, and take the keyboard back.
- **Brainstorm:** talk through options, patterns and trade-offs before coding. The result can be
  saved as a decision with one click.
- **Help modes** on any file: write whole file · write this feature/function · change this selection
  · explain · review · suggest only (no code).

### 4.2 Guided build (new project)

```
Requirements ─▶ Architecture ─▶ Flow & tree ─▶ Scaffold ─▶ File by file (pair mode)
     ▲               ▲               ▲                             │
     └───────────────┴───────────────┴──── change anytime ─────────┘  (impact list)
```

1. **Requirements** — the requirements skill interviews you (one question at a time, with
   "skip" / "decide for me"), stress-tests the answers, writes `requirements.md` with IDs.
   You approve.
2. **Architecture** — the architecture skill proposes components, patterns, data models and APIs;
   you discuss and edit; it writes `architecture.md` and records key choices as decisions. You approve.
3. **Flow & tree** — user flows and data flows (`flows.md`), and the planned file tree (`tree.json`),
   every file linked to requirements and an architecture section. You approve.
4. **Scaffold** — a checkbox tree; you pick files; the editor creates **typed stubs** (signatures +
   `TODO`), never empty files, never overwriting an existing file.
5. **File by file** — a progress panel shows each file as planned / stub / in progress / done. You
   open a file and work on it in pair mode. Marking a file done refreshes its brain entry.

Every step needs your approval to move forward; you can go back to any step at any time. The flow
is a small state machine (XState v5) — no agent orchestration.

### 4.3 Existing project

Open a repo → the editor builds the brain: parse every file (deterministic, fast), then summarise
module by module with a cheap model, directory by directory so no single request is too large.
You review and correct `brain/index.md` and the module notes. Optionally, the architecture skill
writes a reverse spec (`architecture.md` + `tree.json`) from the code for you to correct.
From then on, pair mode and change impact work the same as on a new project.

### 4.4 Change impact (D12)

When a requirement, architecture section, decision or exported symbol changes:

1. The editor computes affected files from brain links (spec → files) and code references
   (symbol → callers, via the language server).
2. It shows an **impact list** with a reason for each file.
3. You tick the files to update. The AI proposes a diff for one file at a time; you accept, edit or skip.
4. The change is recorded as a decision.

### 4.5 QA and review

Right-click a folder or several files → **QA**: collect diagnostics, run the project's tests for
those files, check imports and types against the architecture, and list requirement coverage gaps.
Checks that can be done by tools are done by tools; the model explains the failures and proposes
tests or fixes as diffs. Reports are saved in `qa/`.

---

## 5. Architecture of the editor

### 5.1 Fork strategy: "a fork that behaves like an extension"

Base: **VSCodium** (build scripts, branding, Open VSX, telemetry off). On top:

| Layer | What goes there | Why |
|---|---|---|
| **Built-in extensions** (≈90%) | Brain, skills, models, records, navigator, guided flow, QA | Built-in extensions ship inside the app and can use VS Code's *proposed* APIs, which third-party extensions can't. Keeps upstream merges easy |
| **Core patches** (≈10%) | Inline diff review UI if the built-in one can't be reused, phase/progress UI in the workbench, product branding and defaults | Only where the extension API can't reach |
| **product.json** | Name, icons, Open VSX gallery, default settings | Branding and defaults (D2) |

Core patches live as a numbered patch series (`patches/my_editor/NNN-*.patch`), applied on top of
a pinned VS Code release tag. Upstream updates: rebase the patch series once a month (budget 1–2 days).

**Week 1 spike that may save months:** Code-OSS now includes the chat UI and the inline
"edit review" (accept/reject hunks) in core, since Microsoft open-sourced its AI chat in 2025.
Check how much of that works in a fork without Copilot, through a chat participant and a
language-model provider registered by our built-in extension. If it works, reuse it for chat and diff
review instead of building a webview chat and a custom diff gate.

### 5.2 Components (inside the built-in extensions)

| Component | Job | Technology |
|---|---|---|
| Model router | Picks a model per job (code, architecture, navigator, brain summary); streaming; tool calls | Vercel AI SDK (API keys, OpenRouter, Ollama, custom base URL) + Claude Agent SDK (subscription route) |
| Skill runtime | Loads `SKILL.md` from three locations, exposes read/propose tools only | TypeScript |
| Brain service | Parse, map, summarise, freshness, context assembly | `web-tree-sitter` (WASM, no native deps) + language-server symbol/reference queries |
| Diff gate | Every AI write: diff → accept/reject per hunk → stale-file guard → apply | Core chat editing UI if the spike passes; otherwise a custom inline diff (core patch) |
| Navigator | Debounced on-save review of changed hunks → diagnostics + panel | Cheap/local model via router |
| Records | Decisions, chats (with redaction), notes (Comments API), learnings | Plain files |
| Guided flow | Phases and approvals | XState v5 |
| QA | Diagnostics, test run, import/type checks, coverage by requirement | Language diagnostics, TypeScript compiler / basedpyright, the project's test runner |
| UI | Chat, brain, decisions, progress tree, impact list, QA report | Native views where possible; React + Vite webviews for custom panels |

### 5.3 Language support (D11)

| Level | Languages | What works |
|---|---|---|
| Deep | TypeScript/JS, Python | Parser facts, references, type checks against architecture, test running |
| Generic | Everything else | Chat, skills, brain (tree-sitter grammars where available), diffs, navigator from LLM only |

Python note: VS Code's Pylance is not available in forks; ship **basedpyright** from Open VSX.

---

## 6. Skills — port from Lyra

Lyra's workflow skills live in
`lyra/plugins/ultimate-builder/skills/ultimate-app-builder/references/workflows/`.

| Lyra skill | my_editor skill | Change needed |
|---|---|---|
| `req-engineer` | `requirements` | Light — the interview is already human-in-the-loop |
| `sw-architect` | `architecture` | Light — add stable section IDs, decision records, existing-repo mode |
| `task-planner` | `flow-and-tree` | Rewrite output: `flows.md` + `tree.json`, not agent task waves |
| `sw-developer` | `implement` | **Heavy** — proposes a diff for the scope you chose; no autonomous TDD loop |
| `code-reviewer` | `review` + `navigator` | Medium — a fast single-pass mode for on-save |
| — (new) | `brainstorm` | New — options, patterns, trade-offs; ends in a decision |
| — (new) | `driver` | New — "next small step" as a diff |
| `qa-functional`, `qa-evidence`, `qa-experience` | `qa` | Medium |
| `debugger` | `debug` | Light — proposes, doesn't apply |
| `context-save` | `brain` | Rewrite for the layered brain |
| `learn` | `remember` | Light |
| `spec` | `feature-spec` | Light — small feature/bug spec without the full flow |
| `oop-restructurer` | `refactor-pattern` | Medium — proposes diffs file by file |
| `tech-writer` | `docs` | Light |
| `researcher` | `research` | Light |
| `ui-designer`, `ux-writer`, `a11y-auditor`, `health`, `benchmark` | later | v1.1+ |
| `idk_it`, `proj-manager`, `devops-engineer`, `security-auditor`, `qa-engineer` | not ported | Orchestration, team planning or out of scope |

Also port `requirement_ids.py` (56 lines) and `qa_acceptance.py` (175 lines) to TypeScript, and
Lyra's brain freshness logic (`project_brain.py`).

Licensing: Lyra is MIT, built on Hermes Agent (Nous Research, MIT). Porting skill text and small
modules is fine; keep the MIT notices.

---

## 7. Functional requirements

Priority: **MUST** = v1, **SHOULD** = v1.1, **COULD** = later. `v0.1` marks the pair-mode release.

### Editor platform

| ID | Requirement | Priority |
|---|---|---|
| FR-001 | Build from a VSCodium fork as "my_editor" for macOS arm64 (`v0.1`) | MUST |
| FR-002 | Features live in built-in extensions; core changes are a separate numbered patch series on a pinned VS Code tag (`v0.1`) | MUST |
| FR-003 | Open VSX as the extension gallery; basedpyright bundled for Python (`v0.1`) | MUST |
| FR-004 | Scripted monthly upstream rebase with a checklist | SHOULD |

### Models

| ID | Requirement | Priority |
|---|---|---|
| FR-010 | Providers: Anthropic, OpenAI, OpenRouter, Ollama, custom base URL (`v0.1`) | MUST |
| FR-011 | Claude subscription route via Claude Agent SDK | SHOULD |
| FR-012 | Per-job model choice: code, architecture, navigator, brain summary (`v0.1`) | MUST |
| FR-013 | Keys in the OS secret store only; never in `.my_editor/` or settings (`v0.1`) | MUST |
| FR-014 | Token use and cost per job | COULD |

### Skills

| ID | Requirement | Priority |
|---|---|---|
| FR-020 | Load `SKILL.md` from built-in, global and project folders; project overrides global overrides built-in (`v0.1`) | MUST |
| FR-021 | Call skills from chat (`/name`), command palette and right-click menus (`v0.1`) | MUST |
| FR-022 | Skills get read and propose tools only; the tool layer rejects any direct write (`v0.1`) | MUST |
| FR-023 | Skill frontmatter `model_tier` selects the model | SHOULD |

### Project brain

| ID | Requirement | Priority |
|---|---|---|
| FR-030 | Layered brain: `index.md` (≤ 2,000 tokens), module notes, `map.json` (`v0.1`) | MUST |
| FR-031 | Exports, imports and symbols come from the parser or language server, never the LLM (`v0.1`) | MUST |
| FR-032 | On save, update the file's facts; refresh its role and module note when exports/signatures change or the file is marked done (`v0.1`) | MUST |
| FR-033 | Each entry records its git commit; stale entries are shown and refreshable (`v0.1`) | MUST |
| FR-034 | Build the brain for an existing repo, directory by directory, with user review (`v0.1`) | MUST |
| FR-035 | Context assembly within a token budget for every AI request (see §2.1) (`v0.1`) | MUST |
| FR-036 | Brain files are hand-editable; hand edits are kept (`v0.1`) | MUST |
| FR-037 | Learnings memory: "remember this", used in context assembly | SHOULD |

### Records

| ID | Requirement | Priority |
|---|---|---|
| FR-040 | Decision log: create from chat, brainstorm or change impact; link to files and symbols | MUST |
| FR-041 | Save every chat with the files it touched; redact secrets before writing (`v0.1`) | MUST |
| FR-042 | Review notes as line comments stored in `notes/`, anchored to survive edits | MUST |
| FR-043 | AI-written code comments and docstrings follow `conventions.md` | SHOULD |
| FR-044 | "Why is this like this?" for a file or selection, answered from linked decisions, chats and notes | SHOULD |

### Pair mode

| ID | Requirement | Priority |
|---|---|---|
| FR-050 | Chat aware of the open file, selection, diagnostics and brain (`v0.1`) | MUST |
| FR-051 | Help modes: write whole file, write feature/function, change selection, explain, review, suggest only (`v0.1`) | MUST |
| FR-052 | Every AI edit is a diff with accept / reject / retry, per hunk (`v0.1`) | MUST |
| FR-053 | Refuse to apply a diff if the file changed on disk since it was generated (`v0.1`) | MUST |
| FR-054 | Navigator: on save, review changed hunks against conventions, architecture and brain; show as warnings and in a panel; never edit (`v0.1`) | MUST |
| FR-055 | Navigator can be muted per file and per session; debounced and rate-limited (`v0.1`) | MUST |
| FR-056 | Driver on request: "next step" produces a small diff for the current file or task (`v0.1`) | MUST |
| FR-057 | Brainstorm skill; the outcome can be saved as a decision in one click (`v0.1`) | MUST |
| FR-058 | Coding with zero AI is always possible; every AI feature can be switched off (`v0.1`) | MUST |

### Guided build

| ID | Requirement | Priority |
|---|---|---|
| FR-060 | Requirements interview → `requirements.md` with IDs and acceptance criteria | MUST |
| FR-061 | Architecture → `architecture.md` with stable section IDs; key choices saved as decisions | MUST |
| FR-062 | Flow & tree → `flows.md` + `tree.json`, every file linked to requirements and a section | MUST |
| FR-063 | Scaffold from a checkbox tree with typed stubs; never overwrite a non-empty file | MUST |
| FR-064 | Progress panel: planned / stub / in progress / done per file | MUST |
| FR-065 | Each step needs approval to move forward; going back is always allowed | MUST |
| FR-066 | Reverse spec (`architecture.md` + `tree.json`) from an existing repo | SHOULD |

### Change impact

| ID | Requirement | Priority |
|---|---|---|
| FR-070 | When a spec section, decision or exported symbol changes, compute affected files from brain links and code references | MUST |
| FR-071 | Impact list with reasons; user picks files; AI proposes one diff per file | MUST |
| FR-072 | Each applied change is recorded as a decision | SHOULD |

### QA and other skills

| ID | Requirement | Priority |
|---|---|---|
| FR-080 | QA on a folder or file selection: diagnostics, tests, import/type checks against architecture, requirement coverage; report saved to `qa/` | MUST |
| FR-081 | Propose tests for selected files as diffs | SHOULD |
| FR-082 | Review skill on a selection, file or uncommitted changes | SHOULD |
| FR-083 | Debug skill: finds root cause, proposes a fix as a diff | SHOULD |
| FR-084 | Refactor-to-pattern skill, one file at a time | COULD |

---

## 8. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-001 | Startup | No noticeable slowdown vs plain VSCodium; brain loads lazily |
| NFR-002 | Brain build | Existing repo of 1,000 files: parse facts in under 60 s; summaries run in the background |
| NFR-003 | Diff rendering | Under 1 s for a 500-line file after the model finishes |
| NFR-004 | Navigator cost | Only changed hunks; debounced; defaults to a cheap or local model |
| NFR-005 | Data | All project state in `.my_editor/`; no account, no cloud; fully offline with Ollama |
| NFR-006 | Secrets | Keys in the OS secret store; `.env` and similar never sent to a model; chats redacted before writing |
| NFR-007 | Durability | `.my_editor/` readable and fixable with any text editor |
| NFR-008 | Brain correctness | Facts in `map.json` match the parser output exactly (tested) |
| NFR-009 | Upstream | Patch series applies to a new VS Code release in ≤ 2 days of work |

---

## 9. Failure modes

| Scenario | Behaviour | User sees | Severity |
|---|---|---|---|
| Skill tries to write a file directly | Blocked by the tool layer | "Skills can only propose changes" | CRITICAL |
| File changed on disk after the diff was made | Apply aborted | "File changed — regenerate the diff" | HIGH |
| Secret in a chat message | Redacted before the chat is saved | `[REDACTED]` in the transcript | HIGH |
| Existing repo too large for one request | Directory-by-directory build; progress shown | Brain build progress bar | MEDIUM |
| Navigator too noisy | Severity threshold, mute per file/session | Mute button on the panel | MEDIUM |
| Brain entry stale | Marked stale; refreshed on demand or on next save | Stale badge in the brain view | LOW |
| Model provider down | No partial writes; state kept | "Provider unreachable" + retry / switch model | MEDIUM |
| Malformed `tree.json` or spec file | Parse error shown; nothing overwritten | Error with line number | MEDIUM |
| `.my_editor/` merge conflict | Guided flow paused until resolved | "Resolve the conflict in git" | MEDIUM |
| Two AI edits on the same file | Second one refused while a review is open | "A review is already open for this file" | LOW |

---

## 10. Roadmap (full time)

| Milestone | Weeks | Deliverable | Exit criterion |
|---|---|---|---|
| **M0** Editor build | 1 | VSCodium fork builds as my_editor on macOS arm64; an empty built-in extension loads. **Spike:** reuse of core chat + inline edit review without Copilot | App launches with own name; spike verdict written as a decision |
| **M1** Models + skills + chat | 2 | Model router, secret storage, skill loader, chat with open-file awareness, chat history saved | Ask a question about the open file through a project skill |
| **M2** Project brain | 2 | Parser facts, layered brain, existing-repo build, freshness, context assembly | Brain for Lyra built and correct; context stays within budget |
| **M3** Pair mode → **v0.1** | 2 | Diff gate, help modes, navigator, driver, brainstorm | Author uses it daily on a real project for a week |
| **M4** Records | 2 | Decisions, review notes, "why is this like this?", learnings | Decisions and notes survive edits and show in the editor |
| **M5** Guided build | 3 | Requirements → architecture → flow & tree → scaffold → progress | A new project goes from an idea to typed stubs |
| **M6** Change impact | 2 | Impact list, one diff per file, decision recorded | Renaming an exported function lists exactly its callers |
| **M7** QA + more skills | 2 | QA, tests, review, debug | A deliberate type/contract break is caught by tools, not the model |
| **M8** Hardening | 1–2 | Performance, crash fixes, upstream rebase dry run | Rebase to the next VS Code release works |

**Total: about 17–18 weeks full time. v0.1 (pair mode) at about week 7.**

Why pair mode first: it is useful on existing projects (Lyra, SocialFlow) from day one, and it
proves the two hardest parts — the brain and the diff gate — before building the guided flow on them.

---

## 11. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Upstream VS Code changes break core patches | HIGH | ≈90% in built-in extensions; few small patches; pinned tag; monthly rebase |
| Navigator is noisy or expensive, gets switched off | HIGH | Changed hunks only, debounce, cheap/local model, severity threshold, mute |
| Brain summaries are wrong or go stale | HIGH | Facts from parser only; summaries short; git freshness; user-editable |
| Secrets leak into committed chat history | HIGH | Redact before writing; never read `.env`; a check before commit |
| Scope is large for one person | HIGH | v0.1 at week 7; use it daily; cut SHOULDs first |
| Diff review feels slower than Cursor | HIGH | M0 spike on core inline edit review; per-hunk accept |
| Rewriting Lyra skills for human control takes longer than expected | MEDIUM | Start with requirements, architecture, review, brainstorm; the rest after v0.1 |
| No Pylance / Microsoft extensions in a fork | MEDIUM | basedpyright; Open VSX alternatives |
| Claude subscription use by a third-party app | MEDIUM | Fine for personal use via the Agent SDK; check Anthropic's terms before any public release |
| Chat history makes the repo large | LOW | Trimmed Markdown; optional archive folder later |

---

## 12. Open questions

1. **"Done" for a file.** Proposed: you mark it done, or all its tree-linked functions are implemented.
   Confirm.
2. **Navigator strictness.** Default to warnings only for convention/architecture breaks, or also style hints?
3. **Python contracts.** `.pyi` stubs or Pydantic models for architecture interfaces?
4. **Monorepos.** One `.my_editor/` at the root with per-package brain modules, or one per package?
5. **M0 spike outcome.** Reuse core chat + inline edit review, or build our own?

---

## Appendix A — Requirement counts

| Area | IDs | Total | MUST | In v0.1 |
|---|---|---|---|---|
| Editor platform | FR-001 – FR-004 | 4 | 3 | 3 |
| Models | FR-010 – FR-014 | 5 | 3 | 3 |
| Skills | FR-020 – FR-023 | 4 | 3 | 3 |
| Project brain | FR-030 – FR-037 | 8 | 7 | 7 |
| Records | FR-040 – FR-044 | 5 | 3 | 1 |
| Pair mode | FR-050 – FR-058 | 9 | 9 | 9 |
| Guided build | FR-060 – FR-066 | 7 | 6 | 0 |
| Change impact | FR-070 – FR-072 | 3 | 2 | 0 |
| QA and other skills | FR-080 – FR-084 | 5 | 1 | 0 |
| **Total** | | **50** | **37** | **26** |

Plus 9 non-functional requirements (NFR-001 – NFR-009).
