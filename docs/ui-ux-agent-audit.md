# UI/UX capability audit — 8 November 2026

## Selection

The selected foundation is Anthropic's frontend-design skill, pinned at `2c5958ecac7cee2b583967a2c4981d0f4a75c579`. This is a fit assessment, not a benchmark proving universally superior aesthetics. It is embedded only in the UI/UX specialist's prompt, with unchanged upstream source and Apache-2.0 license in `overlay/extensions/my-editor-core/third-party/frontend-design`. No upstream installer, executable, plugin or credential is introduced.

| Option | Strength | Fit and limits |
| --- | --- | --- |
| [Anthropic frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | Product-specific visual direction, typography, tokens, content, plan/build/critique workflow | Selected: instruction-only, easy to pin and embed behind host proposal controls. Requires explicit interaction/accessibility and evidence guidance for application interfaces. |
| [Impeccable](https://github.com/pbakaus/impeccable) | Broad design critique, audit, refinement and rendered-review workflows | Inspected revision `924bbd194d02e5e15a227e75b5901fb0d7a4ecad`, skill 4.8.1. Current setup invokes a separate executable, references and orchestration. Richer tooling, but not a drop-in fit for this host's current scoped tool surface. Not installed. |
| [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | Searchable design/style/stack guidance and design-system selection | Useful reference library; larger data/script integration. Repository claims are not comparative quality evidence. Not installed. |
| Local Appling | Anthropic frontend-design plus Taste/style overlays, accessibility, tokens, components, writing and design-review references | Broader design knowledge than my_editor previously had. Local attribution pins Anthropic at `0a64e39`, Taste at `c607b11`, design-quality at `93a7fbb`. Presence of skills does not prove automatic use or successful visual verification. |

Appling evidence: `/Users/u/funcoding/Appling/skills/ui-ux/ATTRIBUTION.md` and the corresponding skill/reference directories. Its library is not a single superior designer model. The integration keeps my_editor's selected model and OpenCode runtime unchanged.

## What changes

A ninth independently selectable specialist, **UI/UX agent** (`iris`), receives the pinned design knowledge plus host-specific requirements: inspect current styles/entry points, prioritize task-oriented applications appropriately, produce real styles/imports, cover responsive and interaction states, preserve contracts, and use Keep/Undo. Explicit UI/UX, stylesheet, responsive-layout, typography and redesign requests route to it without overriding pinned agents, explicit modes or locate-only requests. Other roles do not inherit the design prompt or its conversation history.

This adds design reasoning, not a new autonomous execution engine. The host still owns all tools and permissions. No browser, shell, package-install or filesystem authority is added. Current project-agent observation tools do not provide rendered screenshots; therefore visual acceptance must remain explicitly unverified unless authorized rendered evidence is available. The agent cannot truthfully claim that unit tests establish appearance. This release does not redesign the social-media application or restart its QA.

## Full Appling catalog parity

The later user request expands the scope from recommended gaps to every missing development specialist. The actual reference is Appling's `web/src/lib/guided-phase-plan.ts` (`GUIDED_PHASE_ORDER`) and labels/descriptions in `web/src/pages/ChatPage.tsx`, with workflow references under `plugins/ultimate-builder/skills/ultimate-app-builder/references/workflows`.

The canonical catalog contains 21 roles. Eight are covered by existing my_editor roles, counting the new UI/UX role. Thirteen additional selectable specialists bring my_editor to 22 roles including its Project guide:

| Appling role | my_editor role |
| --- | --- |
| req-engineer | Requirements (soki) |
| researcher | Research (new) |
| spec | Specification (new) |
| ui-designer | UI/UX (iris, new in 0.0.83) |
| sw-architect | Architecture (lisko) |
| task-planner | Flow & tree (flow) |
| proj-manager | Project planning (new) |
| sw-developer | Build (ada) |
| oop-restructurer | Restructuring (new) |
| debugger | Debug (hopper) |
| code-reviewer | Review (diji) |
| ux-writer | UX writing (new) |
| qa-engineer | QA (poppy) |
| a11y-auditor | Accessibility (new) |
| security-auditor | Security (new) |
| devops-engineer | Deployment (new) |
| benchmark | Performance (new) |
| tech-writer | Documentation (new) |
| health | Project health (new) |
| context-save | Project memory (new) |
| learn | Controlled learning (new) |

These are independently authored, bounded host workflows, not a wholesale copy of Appling's plugin. Its mandatory spawning, tool names, active exploitation, default broad pipelines and automatic learning triggers are not imported. The user gets selectable capabilities, not an automatic chain of 21 phases. Existing pins, explicit modes and locate-only precedence remain. Saved agent IDs stay stable. The Project guide covers workflow coordination; media builders and style presets are outside this development catalog.

Rendered browser observation remains a tooling gap. Adding roles does not manufacture accessibility measurements, current external research, deployment evidence or visual verification. Unavailable checks must be reported as unverified.

## Validation

The UI-only 0.0.83 batch passed 846 unit tests and a disposable real-editor OpenCode conversation fixture, and was installed with signature and all ten checksums verified. The expanded 0.0.84 catalog passed compilation, all 847 unit tests (zero failures/skips), and the real-editor OpenCode fixture selecting all thirteen new roles across 23 model requests. Evidence: `/tmp/my-editor-specialists-tests.log`, `/tmp/my-editor-integration.kFPRdx/report.json`. This uses a deterministic local model fixture through the native runtime; it is not a benchmark of model task quality. No visual-quality advantage over Appling has been benchmarked. Social application source is unchanged; broad QA and monitoring remain off.

The catalog fixture initially matched a prior role marker in the shared investigation index. Captured request evidence confirmed it was a labelled saved project report in system context, not another live conversation. The corrected fixture checks every role identity and non-system conversation isolation while retaining shared project evidence.

Installed 0.0.84-alpha.0 after the editor was closed. Signature verification, all ten product checksums and installed-versus-compiled extension equality passed. Reopened the social project through UI; the picker exposes all 22 roles and selecting UI/UX opens its separate conversation. Model remains Codex GPT-5.6-Sol and runtime OpenCode. Non-runtime settings hash remains `2d3c37c923160851d622efff875baf6e527383f9b735bf4c25d8859912067c3f`. The preinstallation Build/QA snapshot matched exactly before reopening; UI confirms the historical run remains paused. Restored Social Hub through my_editor terminal, log `.my_editor/test-runs/browser-demo-agents-84.log`; Accounts loads in the browser. No application redesign was performed, no automation restarted.
