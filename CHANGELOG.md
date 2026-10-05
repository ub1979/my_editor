# Changelog

my_editor uses the version in `overlay/extensions/my-editor-core/package.json` as its own release number. The Home page displays that version. The underlying editor shell keeps its upstream version independently.

## Unreleased

- Pair can search the web and read pages with the Claude and Codex subscription models, in every skill including Requirements, Architecture and Plan the files. It is told to look up unfamiliar products, models and terms before asking the user, and to name its sources. Claude gets only its WebSearch and WebFetch tools; Codex gets only its hosted web search. The progress line shows each search. Turn it off with `myEditor.pair.webAccess`. Local and API-key models are unchanged.

## 0.0.6 alpha — 2026-09-25 (source commit; app verification pending)

- Added a centered Pair chat with seven original animal specialists, automatic task and project-stage selection, and a manual pin. The right sidebar remains available; characters share the same model, tools, and review rules.
- Added Find a change: Pair can map a requested change, open up to eight verified file locations near the right lines, and explain them before coding. Shan the panda adapts the downloaded Iron Man skill's plain colleague and teaching voice to Pair's existing diff review.
- Opening Pair in the center now closes the right Pair sidebar, and Pair's sidebar switch closes the center tab. First-run layout no longer opens a second Pair view during project analysis.
- Review now uses project search and file reads, checks current source before claiming an architecture review is verified, and remains unable to propose edits in that mode.
- Explain, Why, QA, and Brainstorm can also fetch current project files and records on demand. Character changes keep the same conversation and working brief.
- Added 400-line warnings and a VSCodium save-time gate for human edits, plus hard checks for AI proposals and Keep. Multiple top-level classes in one source file are also flagged or rejected. The core patch needs a full build and live test.
- Navigator, comment, and structure findings now offer Quick Fix choices for a reviewed Pair proposal or manual guidance. Comment guidance no longer inserts code automatically.
- Split chat and Home styles into focused files. The new extension source compiles and passes automated tests; the updated app flow still needs live validation.
- `scripts/install.sh` now compiles and refreshes built-in extensions before its quick install, then signs and verifies the app bundle. `--full` rebuilds the editor shell and applies core patches when needed.

## 0.0.5 alpha — 2026-09-24

- Versioned source and installed extension; the live installed-app Pair workflow still needs a user-run check before a release tag.
- Pair now receives the open folder, local commit and branch, last fetched upstream gap, and brain revision on every turn. The Project view also flags a brain built from a different commit.
- Added project-scoped, user-approved observation recipes. Pair can request fixed diagnostics without receiving an unrestricted command tool; the local m_dialer project now has read-only cell, PostgreSQL and inventory checks.
- Pair records the host checks behind each investigation and links proposed, kept and undone file changes to the chat request and Git state. Older saved project records are searchable from Pair.
- Pair can make up to 60 project-tool checks in one request and group four independent read-only checks. When it reaches that safety bound, it asks the model to summarize findings and unfinished work instead of showing the old ten-tool error.
- Pair now consumes joined or repeated internal tool requests instead of printing their JSON in chat. It retries a malformed request once and keeps any final response in plain English.
- Pair can retrieve earlier messages in the same chat, including parts of long pasted logs omitted from the live prompt. Shortened history now points to the stored message instead of silently cutting it off.
- The Project view checks the current Git branch for remote commits on open and every ten minutes, shows an update card, and offers an explicit fast-forward update. Local edits and divergent commits are preserved and reported.
- Pair now includes recent pasted messages in the model context when the selected model has room, saves each paste before calling the model, and can search up to 200 stored messages. The chat shows which workspace owns the conversation, and old internal tool JSON is no longer treated as a finding.

## 0.0.4 alpha — 2026-09-24

- The Branch and Project folder name prompts in Clone from Git stay open when the editor loses focus, so users can copy a branch name from another app and return to paste it.

## 0.0.3 alpha — 2026-09-24

- Clone from Git now accepts GitHub branch-page links and checks out the branch they name.
- Repository URLs can be cloned with an optional branch, so the editor no longer silently opens the default branch when the user specifies another one.

## 0.0.2 alpha — 2026-09-23

- Pair chat can request more files, search large repositories, inspect Git history, and prepare reviewable changes across files during one reply.
- Added approved test runs for npm, Go, Cargo and pytest projects. Tests run against kept workspace files.
- Kept tool access in the editor host with bounded reads, path checks, a ten-step limit, and the existing Keep/Undo review.
- Pair now carries proposal outcomes into later turns and labels unkept proposals as expired after an app restart.

## 0.0.1 alpha — 2026-09-23

- First alpha release of the Project, Pair, and project-brain workflows.
- Added visual architecture and file maps, source-aware project chat, conversation continuity, and Git change history and impact views.
- Added a Codex reasoning selector and made the full-width editor the first-run layout default.

For each release, bump the core package version and lockfile together, update this changelog, then tag the commit. The full steps are in [docs/development.md](docs/development.md#releasing).
