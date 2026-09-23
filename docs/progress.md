# Progress against the plan

Status of the requirements in [`plans/my_editor-plan-v2.md`](plans/my_editor-plan-v2.md), as of 2026-09-23.
✅ done and verified in the app · 🟡 partly done · ⬜ not started.

## v0.1 — pair mode (plan milestones M0–M3)

| ID | Requirement | Status | Notes |
|---|---|---|---|
| FR-001 | Build from VSCodium as my_editor, macOS arm64 | ✅ | `scripts/build.sh`; ~8 min with `--reuse` |
| FR-002 | Built-in extensions + numbered core patches on a pinned tag | ✅ | 4 patches in `overlay/patches/` |
| FR-003 | Open VSX; basedpyright bundled | 🟡 | Open VSX yes; basedpyright not bundled yet |
| FR-010 | Anthropic, OpenAI, OpenRouter, Ollama, custom URL | 🟡 | All written; **only Ollama tested live** (no API keys on this machine) |
| FR-012 | Model per job | 🟡 | Chat uses the picked model; navigator picks local → Haiku → default |
| FR-013 | Keys only in the OS keychain | ✅ | SecretStorage; `my_editor: Set API Key` |
| FR-020 | SKILL.md from built-in, global, project | ✅ | Project overrides global overrides built-in |
| FR-021 | Call skills from chat, palette, right-click | 🟡 | Chat (`/skill`) only |
| FR-022 | Skills can only read and propose | ✅ | Skills get no tools; every write is a reviewed edit |
| FR-030 | Layered brain | 🟡 | `index.md` + `map.json`; per-module notes not yet |
| FR-031 | Facts from a parser, never the LLM | ✅ | Regex extractor for TS/JS/Python, tested on song_maker (0 mismatches) |
| FR-032 | Update on save | ✅ | Facts update on save; no LLM summaries yet |
| FR-033 | Git freshness | 🟡 | Commit recorded; stale entries not shown yet |
| FR-034 | Brain for an existing repo | ✅ | One command, bounded to 5,000 files |
| FR-035 | Context assembly | 🟡 | Conventions + brain index + file + neighbours; no token accounting yet |
| FR-036 | Brain hand-editable | ✅ | Notes outside the auto markers and `note` fields survive rebuilds |
| FR-041 | Chat history, secrets redacted | ✅ | `.my_editor/chats/`, code collapsed to keep git small |
| FR-050 | Chat aware of file, selection, problems, brain | ✅ | |
| FR-051 | Help modes | ✅ | `/file /feature /change /next /explain /review /brainstorm` |
| FR-052 | Every AI edit is a diff with keep/undo per hunk | ✅ | Core chat editing (decision 0001) |
| FR-053 | Refuse a stale diff | ⬜ | Not tested yet against core chat editing |
| FR-054 | Navigator on save, never edits | ✅ | Found a planted bug with a local model |
| FR-055 | Mute per file/session; debounce | ✅ | Commands in the palette |
| FR-056 | Driver: next step | ✅ | `/next` |
| FR-057 | Brainstorm, save as decision | ✅ | Button after a brainstorm |
| FR-058 | Everything AI can be switched off | 🟡 | Navigator and chat history have settings; chat via `chat.disableAIFeatures` |

## After v0.1

| Area | Status | Notes |
|---|---|---|
| Decisions (FR-040) | 🟡 | From brainstorms; linking to files not yet |
| Review notes as line comments (FR-042) | ⬜ | |
| "Why is this like this?" (FR-044) | ⬜ | |
| Guided build: requirements, architecture, tree (FR-060–062) | 🟡 | Modes exist and write through review; **not yet tried end to end with a model** |
| Scaffold typed stubs (FR-063) | ⬜ | |
| Progress per file (FR-064) | 🟡 | Build stage counts `status` in `tree.json` |
| Change impact list (FR-070–072) | ⬜ | |
| QA on a folder (FR-080) | ⬜ | `/review` and `/skill tests` cover part of it |

## UI

| Item | Status |
|---|---|
| Paper and Night themes, contrast-checked | ✅ |
| Centred page that keeps ~100 columns | ✅ |
| Quiet status bar, no Copilot prompts, Ask mode only | ✅ |
| Project view in the song_maker style | ✅ |
| App icon and empty-editor mark | ✅ |
| Defaults applied from the first frame (patch 130) | ✅ after build 5 |

## Known issues

- VS Code's "Local" session picker and "Ask" mode label still show under the chat input.
- The app bundle is ~1 GB; it has not been slimmed.
- Only tested with a fresh profile on macOS arm64.
