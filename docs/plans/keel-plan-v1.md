# Keel — Spec-Driven Editor
## Plan & Requirements v1

**Author:** Syed Sheheryar Bukhari
**Date:** 23 September 2026
**Status:** Draft for review
**Working name:** Keel *(the spine a build is laid on — verify availability on Open VSX and the VS Code Marketplace before committing)*

---

## 0. Assumptions

Seven decisions were not yet made. These are the working assumptions; override any and the affected sections change.

| # | Decision | Assumed | Rationale |
|---|---|---|---|
| A1 | Languages at v1 | TypeScript/JS first, Python second | Deterministic fit-checking needs real type information; TS gives it via the Compiler API |
| A2 | Spec verification | Machine-readable **interfaces** (`.spec/contracts/*`), prose for everything else | Makes Phase 5 mechanical rather than an LLM opinion |
| A3 | Drift behaviour | **Warn, never block.** Stale files appear as diagnostics plus a sidebar badge | Blocking a human mid-flow kills the product |
| A4 | `.spec/` in version control | Yes, committed | Specs are team artifacts and should be reviewable in PRs |
| A5 | Model access | BYO-key (Anthropic, OpenAI, OpenRouter) + Ollama; `subc` as a private default | Open source needs no-account onboarding |
| A6 | Tests | AI proposes tests in Phase 5; not TDD-first | TDD-first roughly doubles v1 scope |
| A7 | Distribution | VS Code extension, Open VSX + Marketplace, MIT | A fork is a download and a trust decision; defer it |

---

## 1. Thesis

> **Cursor** gives you an agent with no memory of intent.
> **Kiro** gives you specs, then walks away from them.
> **Keel** keeps the spec live: it is the context for every edit, and it tells you when your code has drifted from it.

The human drives. The AI works one file at a time under an approved architecture. Agent mode exists, opt-in, bounded by the same specs.

### Positioning

| Tool | Specs | Human-driven | Drift detection |
|---|---|---|---|
| Cursor | No | Partly | No |
| Claude Code | No | No | No |
| AWS Kiro | Yes, up front | No | No |
| GitHub Spec Kit | Yes | Partly | No |
| Lyra (own project) | Yes | No | No |
| **Keel** | **Yes, live** | **Yes** | **Yes** |

Drift detection is the defensible piece. Everything else is table stakes or catch-up.

### Relationship to Lyra

Lyra and Keel have opposite control flows and are complementary, not competing.

- **Lyra**: AI drives, human approves at checkpoints. For building software *from* a description.
- **Keel**: human drives, AI assists under spec constraints. For building software *yourself*, faster and more coherently.

Keel reuses Lyra's playbook knowledge (see §10) and can optionally invoke Lyra as an agent-mode backend (FR-036).

---

## 2. Personas

| ID | Persona | Core need | Why Keel |
|---|---|---|---|
| **P1** | Solo dev / indie hacker *(primary)* | Ships fast; loses architectural coherence by project three | Structure without ceremony; specs that stay useful |
| **P2** | Senior dev on an existing codebase | AI that respects existing patterns rather than rewriting them | Brownfield reverse-spec plus convention enforcement |
| **P3** | Tech lead | A reviewable contract that juniors and AI both work against | `.spec/` in git, visible in PRs |

**Non-persona at v1:** non-coders and no-code users. That is Lyra's audience.

---

## 3. Scope

### In scope (v1)

- Five phases with explicit human approval gates
- Greenfield forward path **and** brownfield reverse-spec path
- Per-file, per-function and per-selection implementation with mandatory diff review
- Component-fit QA triggered from the explorer context menu
- Drift detection with stale-file diagnostics
- Opt-in agent mode, spec-bounded
- BYO-key and local model support

### Out of scope (v1)

- Tab autocomplete (Copilot owns this; do not compete)
- Deployment, DevOps and security-audit phases (Lyra's territory)
- Team sync, cloud state, user accounts
- Fit-checking for languages beyond TS/Python (chat works everywhere; *verification* does not)
- Any Code-OSS fork

### v2 candidates

Inline ghost-text edits · spec-aware PR review · more languages · fork and signed desktop app · team-shared spec registry.

---

## 4. Artifact layout

All state lives in the workspace. No cloud, no database.

```
my-project/
├── .spec/
│   ├── 00_conventions.md       Immutable project rules; injected into every coding prompt
│   ├── 01_requirements.md      FR/NFR IDs, user journeys, failure matrix   (locked in P1)
│   ├── 02_architecture.md      ADRs, data models, task interfaces          (locked in P2)
│   ├── 03_tree_spec.json       Files + role + requirement_ids + plan_section
│   ├── contracts/              Machine-readable interfaces (.ts / .pyi)
│   ├── qa/                     Fit and QA reports, dated
│   └── state.json              Phase, lock hashes, drift ledger
├── src/
└── package.json
```

### `03_tree_spec.json` entry

```json
{
  "path": "src/services/auth.ts",
  "role": "JWT verification and session cookies",
  "requirement_ids": ["FR-003", "FR-004", "NFR-002"],
  "plan_section": "7.2",
  "contract": ".spec/contracts/auth.ts",
  "status": "stub"
}
```

`status` is one of `stub`, `implemented`, `stale`, `orphan`.

The `requirement_ids` and `plan_section` fields are the core mechanism of the whole product. They are what make drift computable and fit-checking mechanical rather than a matter of LLM judgement.

### `state.json`

```json
{
  "phase": "IMPLEMENT",
  "locks": {
    "01_requirements.md": { "hash": "sha256:...", "locked_at": "2026-09-23T10:00:00Z" },
    "02_architecture.md": { "hash": "sha256:...", "locked_at": "2026-09-23T11:30:00Z" }
  },
  "section_hashes": { "02_architecture.md#7.2": "sha256:..." },
  "drift": [
    { "path": "src/services/auth.ts", "reason": "plan_section 7.2 changed", "since": "2026-09-23T14:00:00Z" }
  ]
}
```

### Design rules for artifacts

1. Every file is human-readable and hand-editable.
2. The editor must never be *required* to repair `.spec/` — a text editor is always sufficient.
3. Hand edits are detected by a file watcher and reconciled, never overwritten.

---

## 5. State machine

```
        ┌──────────────── brownfield entry ────────────────┐
        │                                                   ▼
P1 Requirements ─▶ P2 Architecture ─▶ P3 Scaffold ─▶ P4 Implement ⇄ P5 Fit & QA
        ▲                  ▲                              │
        └──── revise (drift ledger records what goes stale)┘
```

### Transition rules

1. **Every forward transition requires an explicit "Approve & Lock" click.** No auto-advance, ever, under any configuration.
2. **Backward transitions are always permitted.** Re-locking a revised spec recomputes the drift ledger.
3. **Brownfield entry** skips P1 by default: analyse repo → generate `02` + `03` → user corrects → land in P4. `01_requirements.md` can be generated later or never.
4. **Agent mode** is available only inside P4 and P5, writes only inside the approved tree, and retains the per-file diff gate.
5. **Quick mode** skips straight to P4 with `00_conventions.md` only — for small tasks where spec ceremony is disproportionate.

### Implementation note

Use **XState v5**. This is a five-state machine with human-triggered transitions; it needs no agentic orchestration. LangGraph is the wrong tool here — it earns its place only inside a phase that runs a genuine tool loop (agent mode), not at the gate level.

---

## 6. Functional requirements

### Phase 1 — Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-001 | Conduct a Socratic interview, one question per message, honouring Skip / Decide for me / Use smart defaults | MUST |
| FR-002 | Run an adversarial stress-test pass (failure modes, scope killers, assumption busters) before writing the document | MUST |
| FR-003 | Present 2–3 paradigm-level alternative approaches with trade-offs; user selects | SHOULD |
| FR-004 | Emit `01_requirements.md` with uniquely-identified FRs, each carrying acceptance criteria and a MUST/SHOULD/COULD priority | MUST |
| FR-005 | Render a preview in the webview with an Approve & Lock action; locking stores a per-section hash map | MUST |
| FR-006 | Redact secrets, API keys, internal URLs and PII before writing the document | MUST |

**Acceptance:** a fresh project reaches a locked `01_requirements.md` within roughly 15 minutes of conversation, with every FR carrying an ID and acceptance criteria.

### Phase 2 — Architecture

| ID | Requirement | Priority |
|---|---|---|
| FR-010 | Generate `02_architecture.md`: stack, components, data models, API shapes, ADRs, task interfaces | MUST |
| FR-011 | Render Mermaid diagrams inline in the webview | SHOULD |
| FR-012 | Emit `.spec/contracts/*` — compilable interface stubs for every cross-component boundary | MUST |
| FR-013 | Verify every architecture section traces to at least one FR; flag unreferenced FRs before allowing lock | MUST |
| FR-014 | **Brownfield:** derive `02_architecture.md` from an existing repository via AST scan and dependency graph | MUST |
| FR-015 | Generate or accept a hand-written `00_conventions.md`; it is editable at any time | MUST |

**Acceptance:** contracts compile cleanly; no FR is left unaddressed at lock time.

### Phase 3 — Scaffold

| ID | Requirement | Priority |
|---|---|---|
| FR-020 | Emit `03_tree_spec.json`, each entry linked to requirement IDs and a plan section | MUST |
| FR-021 | Present an interactive checkbox tree supporting add, rename and remove of nodes | MUST |
| FR-022 | Generate **typed stubs** derived from contracts (signatures plus a `TODO` throw), never empty files | MUST |
| FR-023 | Never overwrite an existing non-empty file; skip it and report | MUST |
| FR-024 | Reconcile manually-created files against the tree spec on save | SHOULD |
| FR-025 | Mark files present on disk but absent from the spec as `orphan` | SHOULD |

**Acceptance:** generated stubs compile; the project has zero lint errors immediately after scaffolding.

### Phase 4 — Implementation *(the core)*

| ID | Requirement | Priority |
|---|---|---|
| FR-030 | Implement a whole file, a single function, or the current selection, on request | MUST |
| FR-031 | Assemble context from: `00_conventions.md` + this file's plan section + its contract + current buffer + diagnostics | MUST |
| FR-032 | **No silent writes.** Every AI edit renders as a reviewable diff with Accept / Reject / Retry | MUST |
| FR-033 | Support hunk-level partial acceptance | SHOULD |
| FR-034 | Run a pre-flight convention lint on generated code; show violations above the diff | SHOULD |
| FR-035 | Provide a chat sidebar aware of the open buffer and current selection | MUST |
| FR-036 | Agent mode: opt-in, multi-file, confined to the approved tree, per-file diff gate retained | SHOULD |
| FR-037 | Permit fully manual coding with zero AI involvement at all times | MUST |
| FR-038 | Update the file's `status` to `implemented` on accept | MUST |

**Acceptance:** implementing a scaffolded file takes exactly one request and one Accept, and the result compiles against its contract.

### Phase 5 — Fit & QA

| ID | Requirement | Priority |
|---|---|---|
| FR-040 | Trigger from the explorer context menu on a folder or a multi-file selection | MUST |
| FR-041 | Run a deterministic fit check: type-check against contracts plus an import-boundary check. The LLM only *explains* failures | MUST |
| FR-042 | Pull `vscode.languages.getDiagnostics()` into the report | MUST |
| FR-043 | Produce a coverage matrix mapping each FR to the code and tests satisfying it; list gaps | MUST |
| FR-044 | Propose boundary-interaction tests for the selected files | SHOULD |
| FR-045 | Render the report in the webview and persist it to `.spec/qa/` | SHOULD |

**Acceptance:** a deliberately introduced contract violation is caught by the deterministic check, not by the LLM.

### Cross-cutting — Drift detection

| ID | Requirement | Priority |
|---|---|---|
| FR-050 | Hash spec sections on lock; when a section changes, mark dependent tree entries `stale` | MUST |
| FR-051 | Surface stale files as VS Code diagnostics (warning severity) plus a sidebar badge | MUST |
| FR-052 | Offer a per-file Reconcile action showing what changed in the spec and proposing a diff | SHOULD |
| FR-053 | Drift warns; it never blocks editing, saving or building | MUST |
| FR-054 | Allow dismissal of a drift warning per file, recorded in the ledger | SHOULD |

**Acceptance:** editing one architecture section marks exactly the files linked to that section, and no others.

### Cross-cutting — Models

| ID | Requirement | Priority |
|---|---|---|
| FR-060 | Provider configuration for Anthropic, OpenAI, OpenRouter, Ollama and any custom base URL | MUST |
| FR-061 | Per-phase model override (cheap model for scaffold, strong model for architecture) | SHOULD |
| FR-062 | Display token usage and cost per phase | COULD |
| FR-063 | Store keys in VS Code SecretStorage; never in `.spec/` or `settings.json` | MUST |

---

## 7. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-001 | Activation performance | Under 500 ms; do not activate on workspaces without `.spec/` unless explicitly invoked |
| NFR-002 | Diff rendering | Under 1 s for a 500-line file after the model response completes |
| NFR-003 | Data residency | All state on disk in the workspace; no cloud, no account; fully offline with Ollama |
| NFR-004 | Secret handling | Keys in SecretStorage only |
| NFR-005 | Content safety | Redact secrets from any file content sent to a model; silently refuse `.env` and equivalents |
| NFR-006 | Manual override | Every AI feature individually disableable |
| NFR-007 | Artifact durability | `.spec/` is human-readable and hand-editable; the editor is never required to repair it |
| NFR-008 | Determinism | Fit-checking results must be reproducible across runs and independent of model choice |
| NFR-009 | Packaging | Single VSIX under 10 MB; no native dependencies |

---

## 8. Failure mode matrix

| Scenario | System behaviour | User sees | Recovery path | Severity |
|---|---|---|---|---|
| Model returns malformed JSON for the tree spec | Retry once with a schema reminder, then fail cleanly | "Couldn't parse the file tree" plus raw output | Edit the tree by hand | MEDIUM |
| User hand-edits `.spec/` | Watcher revalidates and recomputes hashes | Badge: *n* files now stale | Reconcile or dismiss | LOW |
| Two locked specs contradict each other | Detected at P2 lock via FR traceability | List of unreferenced or conflicting FRs | Return to P1 | HIGH |
| Model provider unavailable mid-phase | State preserved; no partial write | "Provider unreachable" with Retry | Switch provider and resume | MEDIUM |
| Brownfield repo exceeds context window | Scan directory by directory, summarise, let user select scope | Directory picker with size estimates | Narrow the scope | HIGH |
| Agent mode attempts a write outside the tree | Blocked by path guard before any write | "Blocked: path not in approved tree" | Add to tree, or reject | CRITICAL |
| Generated code violates conventions | Pre-flight lint flags it before the diff renders | Violations listed above the diff | Retry with violations fed back | MEDIUM |
| `.spec/` merge conflict in git | Detected on load; phase frozen | "Spec conflict — resolve before continuing" | Resolve in git as normal | MEDIUM |
| Accept clicked while file changed externally | Detect via hash; abort the write | "File changed on disk since the diff was generated" | Regenerate the diff | HIGH |
| Contract file deleted by user | Fit check degrades to LLM-only with a warning | "No contract for this file — fit check is advisory" | Regenerate from P2 | LOW |
| Same file implemented twice concurrently | Second request rejected while a diff is pending | "A review is already open for this file" | Resolve the open diff | LOW |
| Requirements locked, then user changes their mind | Unlock permitted; ledger records every dependent artifact | Warning listing the downstream impact | Proceed or cancel | LOW |

---

## 9. Technology stack

| Layer | Choice | Justification |
|---|---|---|
| Host | VS Code extension, `@types/vscode` | No fork at v1; one-click install on Open VSX and Marketplace |
| Webview UI | React + Vite + Tailwind in a `WebviewViewProvider` | Single bundled script and stylesheet |
| State machine | **XState v5** | Five states, human-triggered transitions; no agentic orchestration needed |
| Model layer | Vercel AI SDK (`ai`) | Model-agnostic, streaming, tool calls, wide provider coverage |
| Diff review | Custom: virtual document + CodeLens Accept/Reject + `WorkspaceEdit` | `vscode.diff` displays two URIs only — it has **no** built-in accept/reject controls. This is a genuine build item, not a one-liner |
| Static analysis | TypeScript Compiler API, `ts-morph`, `dependency-cruiser` | Deterministic fit-checking and boundary verification |
| Agent mode | Lyra as an optional local subprocess | Behind a feature flag; reuses existing work rather than rebuilding it |

### Corrections against the original draft

1. **`vscode.diff` has no Accept/Reject.** The original plan assumed native controls. They must be built. Spike this in week 1.
2. **LangGraph.js is not needed at the gate level.** The snippet in the original draft also used the deprecated `channels` API and referenced an undefined `userConfirmed`. XState alone covers the gates; LangGraph is only worth considering inside agent mode.
3. **`resourceSet` is not a valid `when` clause context key.** Multi-select arrives as handler arguments `(uri: Uri, uris: Uri[])`.
4. **The vscode repository uses npm, not yarn.** Moot now that the fork is deferred.
5. **Empty skeleton files cause immediate lint and import noise.** Typed stubs avoid this (FR-022).
6. **Prose architecture cannot be mechanically verified.** Hence machine-readable contracts (A2, FR-012).

---

## 10. Reuse from Lyra

Lift the **knowledge**, drop the **orchestrator**. Lyra's playbooks are roughly 5,000 lines of tuned, debugged prompt content that would otherwise have to be written from scratch.

| Lyra source | Becomes | Effort |
|---|---|---|
| `workflows/req-engineer/SKILL.md` | `playbooks/requirements.md` | Near-verbatim |
| `workflows/sw-architect/SKILL.md` | `playbooks/architecture.md` + brownfield mode | Light edit |
| `workflows/task-planner/SKILL.md` | `playbooks/scaffold.md` | Rewrite output to tree spec |
| `workflows/sw-developer/` + `code-reviewer/` | `playbooks/implement.md` | Heavy — currently assumes the AI owns the file |
| `workflows/qa-functional/`, `qa-evidence/` | `playbooks/qa.md` | Medium |
| `workflows/spec/SKILL.md` | Quick-mode playbook | Light edit |
| `requirement_ids.py` | `src/spec/requirementIds.ts` | Port, roughly 100 lines |
| `qa_acceptance.py` | `src/qa/coverage.ts` | Port |
| `workflow_contract.json` | `src/state/rules.ts` | Concept only |
| `.sdlc/` layout | `.spec/` layout | Already reflected above |

**Not reused:** kanban, `project_runs`, worker dispatch, the SDLC coordinator, Hermes runtime, the ACP adapter, the web dashboard, platform plugins, the 18-provider layer. These all exist to make the AI autonomous, which is the opposite of Keel's thesis.

**Licensing note:** Lyra is MIT but builds on Hermes Agent (Nous Research). If agent mode ships Lyra as a subprocess, verify Hermes's licence permits redistribution in this form. Lifting playbook *text* from your own MIT repo is unproblematic.

---

## 11. Roadmap

Estimates are part-time.

| Milestone | Weeks | Deliverable | Exit criterion |
|---|---|---|---|
| **M0** | 1 | Repo, licence, name check, playbooks ported, `.spec/` schema frozen | Schema documented; tree-spec JSON validates against it |
| **M1** | 2 | Extension skeleton, webview, XState, model layer, `.spec/` I/O | Send a prompt, receive a response, write a file |
| **M2** | 2 | Phases 1–2 plus lock and hash | A fresh project reaches locked architecture |
| **M3** | 2 | Phase 3, contracts, typed stubs | Stubs compile; tree is editable |
| **M4** | 3 | **Phase 4 and the diff gate** | Implement a scaffolded file end to end |
| **M5** | 1 | Brownfield entry path | Point at an existing repo, get a usable `02` + `03` |
| **M6** | 2 | Phase 5 fit check and QA | A deliberate contract break is caught deterministically |
| **M7** | 2 | Drift ledger and diagnostics | Editing architecture marks exactly the right files stale |
| **M8** | 1 | Agent mode behind a flag | A multi-file run stays inside the approved tree |
| **M9** | 2 | Polish, docs, Open VSX release | Someone other than the author completes a project with it |

**Total: roughly 18 weeks.**

**M4 is make-or-break.** If the diff gate feels clumsy relative to Cursor, nothing downstream matters. Run a throwaway spike on the diff UI in week 1, before committing to the rest.

**Ship-early cut:** M0–M4 alone is a usable tool and a legitimate v0.1 release. Publish it, gather feedback, then continue.

---

## 12. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Diff gate feels slower than Cursor's inline edits | **CRITICAL** | Spike in week 1; add inline edit for selections in v2 |
| Spec ceremony too heavy for small tasks | HIGH | Quick mode (§5) skipping to P4 with conventions only |
| Drift detection produces noise, gets ignored | HIGH | Warn-only, dismissible, thresholds tuned on your own projects first |
| Cursor or Kiro ship equivalent drift detection | MEDIUM | Publish the approach early; it is the defensible differentiator |
| Scope creep back toward Lyra's autonomy | MEDIUM | Agent mode stays behind a flag permanently |
| Brownfield context-window limits | MEDIUM | Directory-scoped scanning; never whole-repo dumps |
| Open-source maintenance burden | MEDIUM | Extension not fork; no native deps; no server to run |
| Fork temptation returns | LOW | Revisit only past 1,000 installs |
| Model output quality varies by provider | LOW | Deterministic checks (FR-041) are model-independent by design |

---

## 13. Open decisions

1. **Name** — confirm Keel is available on Open VSX, the Marketplace and npm.
2. **Conventions provenance** — generated in P2, or always hand-written by the user?
3. **Lock semantics** — does locking make spec files read-only, or merely hash them? *(Recommendation: hashes only. Read-only is annoying and easily circumvented.)*
4. **Monorepo support** — one `.spec/` per package, or one at the root with package scoping?
5. **Telemetry** — none at all, or opt-in anonymous phase-completion counts? *(Recommendation: none at v1; it is a trust cost with little payoff at this stage.)*
6. **Contract language for Python** — `.pyi` stubs, or Pydantic models?
7. **Quick mode and drift** — do quick-mode edits participate in the drift ledger at all?

---

## Appendix A — Requirement index

**Phase 1:** FR-001 … FR-006
**Phase 2:** FR-010 … FR-015
**Phase 3:** FR-020 … FR-025
**Phase 4:** FR-030 … FR-038
**Phase 5:** FR-040 … FR-045
**Drift:** FR-050 … FR-054
**Models:** FR-060 … FR-063
**Non-functional:** NFR-001 … NFR-009

Total: 46 functional requirements, 9 non-functional.

## Appendix B — v1 cut line

Everything marked MUST is v1. Everything marked SHOULD is v1.1. Everything marked COULD is v2 or later.

MUST count by phase: P1 five, P2 five, P3 three, P4 five, P5 three, drift two, models two. **Twenty-five MUST requirements** constitute the shippable core.
