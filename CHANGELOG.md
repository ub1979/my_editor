# Changelog

my_editor uses the version in `overlay/extensions/my-editor-core/package.json` as its own release number. The Home page displays that version. The underlying editor shell keeps its upstream version independently.

## 0.0.32 alpha — 2026-11-01

- File chat follows the source editor with an independent saved transcript and draft for every file URI. It resumes when returning to a file; New chat clears only that file. Project agents retain their separate chats. Automatic following can be turned off in settings.
- Planned files offer “Why did we plan this file?” above the source. Explanations use the saved tree role, linked architecture section and requirements. Opening a file makes no model request and does not change plans.
- Editor toolbar and file-chat buttons provide focused Review and Explain for selected code or the current file, including unsaved changes. Replies are instructed to stay within three short sentences or bullets unless more detail is requested. This file actions and Open next file now use the file conversation.
- Existing #AI / // AI directives generate bounded snippets in the editor using the saved plan and surrounding code style, with brief useful comments. Changes remain reviewed diffs until Keep. An edit during generation invalidates the result.
- File requests capture their originating file and selection. Switching during a reply cannot move its transcript to another file; stale UI actions are rejected. Unsent drafts survive quick actions, secrets are excluded/redacted, and saved chats remain available through the existing project chat archive setting.
- Validation: 735 automated tests passed, including file-history restoration and webview isolation. Real editor-host file-chat checks passed for plan context, selections, unsaved code, switching during generation, draft persistence, no generation on open, inline Keep and unchanged saved plans. The existing coding suite also passed after explicitly selecting Builder for its creation/deletion fixture, as required by separate agent chats. Visual inspection was unavailable because the computer-use tool timed out; local user acceptance is still needed.

## 0.0.31 alpha — 2026-11-01

- Checks and discussion of saved planning documents cannot create replacement proposals. The host blocks write/delete tools during inspections and does not turn a model's unsolicited document into Keep. Explicit revision requests still work; read-only replies do not add Finalize or recovery actions.
- Opening an existing draft reports its saved-file checks without generating a new document. Agents are instructed to cite saved evidence, separate defects from optional improvements and implementation gaps, and preserve unrelated decisions and IDs. Long project-note excerpts identify the omitted content.
- Move on/switch/continue-to-stage requests, including the reported answer labels, route to the named document before generation. Asking Flow & tree to make the planned files uses the saved tree directly, creates only missing stubs, and changes only their progress status.
- Analyse project and AI-readiness write observed architecture and file-map reports under `.my_editor/brain/`; they never propose replacing the saved architecture or tree. Code-derived observations no longer downgrade the plan to a draft.
- Validation: all 731 automated tests passed. A real editor-host test blocked unsolicited replacements and incidental cross-document edits, preserved all saved plans during analysis, opened complete stages and drafts without generation, created files without a model, and kept an explicitly requested revision. Existing planning retrieval and separate/shared-chat integration checks also passed.

## 0.0.30 alpha — 2026-11-01

- Each agent has its own saved conversation and working brief by default. Agent buttons open the corresponding chat; returning resumes it without another planning kickoff. Explicit document requests switch to the correct agent before assembling history.
- The Chat organization menu offers Shared chat as an explicit alternative. Shared and individual conversations persist separately; changing this option never combines or deletes them. Saved project documents remain available to every agent.
- Existing mixed conversations are preserved in Shared chat and their identifiable exchanges copied to the appropriate agent. Complete retained documents and recovery actions survive migration; mixed working briefs stay only in Shared chat.
- Unsent drafts stay with their chat when switching. New chat clears only the active conversation. Keep/Undo updates proposal cards even when their agent chat is hidden, without inserting them into another transcript.
- Validation: 724 automated tests passed. Real editor-host requests verified isolation, resuming without generation, explicit sharing, independent resets and unchanged model selection. Shared planning retrieval and the exact captured architecture Keep/recovery replay also passed in disposable projects.

## 0.0.29 alpha — 2026-11-01

- Architecture validation follows component groups and separates general document anchors from component interfaces. Overview, Stack, APIs, Data models and Events no longer need per-component requirement/interface descriptions. Nested API headings stay part of their owning component; all anchors remain available for links.
- The Choose a model action now requires an explicit missing-model error. Text such as data-models in a validation error cannot trigger it or change the selected model.
- Failed replies that retain a complete valid document offer Review saved architecture (or the relevant document). This revalidates the retained response and prepares Keep without another model call; it replaces the redundant Finalize choice.
- Planning context includes every saved tree section value directly, avoiding partial anchor lists from paged file reads.
- Validation: all 713 automated tests passed. Both captured architecture replies from the reported project pass validation. The latest exact response was replayed in a disposable editor project, reached Keep, and saved successfully; reviewing it again made no model request, preserved requirements/tree, and kept the selected model.

## 0.0.28 alpha — 2026-11-01

- Opening completed Requirements, Architecture or Flow & tree now reports the saved stage status without calling a model or preparing a replacement. It offers the next incomplete planning stage and keeps the selected skill available for requested revisions.
- Incomplete prerequisites are reported before generation. Draft-stage startup names the exact target document and treats older cross-stage requests as history. Planning startup skips model-based chat compaction.
- Completed-stage replies no longer offer redundant Finalize buttons; their continuation state survives reopening the chat.
- Validation: all 706 automated tests passed. Editor-host tests reopen completed Requirements after an architecture conversation and a rejected wrong-document reply, confirming zero model requests, no proposals and unchanged files. The user's actual saved documents select Architecture as the next stage.

## 0.0.27 alpha — 2026-11-01

- Typed planning requests and answer choices share document routing. Wrong-document replies are rejected before a proposal can replace another planning file; errors distinguish proposed content from saved prerequisites.
- Architecture validation, project maps and impact lookup share a Markdown section parser, supporting nested headings, HTML anchors and fenced examples. Concrete routes, configuration and callable signatures count as interfaces.
- Planning history retains full generated documents across display shortening and restarts. Longer outer fences preserve embedded examples, incomplete fences cannot produce partial documents, and warnings after the document remain visible.
- Chat archives finish saving before a turn completes, report failures and do not replace unreadable history. Rejected planning replies retain their investigation record.
- Proposal diffs use a fixed, read-only original snapshot, avoiding an editor assertion while Keep replaces an existing file. Go package discovery reports lookup failures instead of treating them as empty packages.
- Validation: 701 automated tests passed, plus planning and general editor-host checks. The earlier Go split failure was reproduced only with restricted cache access; it passes with the normal local cache. The user's complete archived architecture passes against the existing requirements and all 14 tree sections.

## 0.0.26 alpha — 2026-11-01

- Regenerate, rewrite, restore, rebuild and generate choices switch to the named planning document. Regenerating architecture from Requirements no longer validates architecture content as requirements.
- Verified the user's saved requirements pass validation; only architecture needs completion. Planning and answer-routing regression tests pass.

## 0.0.25 alpha — 2026-11-01

- The chat model picker now offers Claude effort: Model default, Low (light), Medium, High, Extra high and Maximum, limited to the levels reported by the selected model.
- Claude and Codex retain separate effort preferences. Claude requests pass the selected level with `--effort`; unsupported saved levels fall back to the model default.
- Validation: build and 17 focused provider, effort and webview tests passed. The known Go split test failure from 0.0.24 remains outside this change.

## 0.0.24 alpha — 2026-11-01

- Claude subscription models are discovered from the installed CLI, with resolved version labels and explicit version selections. Existing aliases and custom IDs remain supported.
- Requirements, Architecture and File Tree can retrieve older chat messages and saved project records. Chat search includes assistant decisions; saved replies retain complete document content with secret redaction.
- “Write it now” choices use the described document to select the planning mode. Planning prompts receive saved-file validation results, and complete documents still require Keep.
- This local release snapshots the current editor source, including the existing coding assistance, Python inline output and source-helper changes.
- Validation: build passed; 40 focused regression tests passed; planning and general editor-host smoke tests passed; real Claude discovery and response passed. The full suite passed 687 of 688 tests, with an existing Go split declaration-check failure in aiReadySteps.test.ts. This remains an alpha for local testing.

## 0.0.23 alpha — 2026-10-31

- New Chat isolates cancelled replies; concurrent sends cannot start while chat persistence is pending. Project-stage refreshes respect an explicitly selected planning skill.
- Chat refreshes preserve the reading position. Architecture links normalize leading `#` markers; malformed saved metadata no longer breaks maps, and duplicate component anchors are rejected.
- Scaffold writes create files exclusively, recheck the plan after the picker, preserve tree metadata and update only changed statuses. Git metadata and dependency paths are skipped.
- Generated source edits are rejected if the source changed while the model was answering. Provider stream errors, output limits and failed CLI exits prevent incomplete replies from becoming file proposals.
- The theme generator now preserves the shipped contrast fixes. Regression coverage checks generated theme parity and key text/background contrast pairs.
- Source audit: extension build and 682 tests passed, as did 53 Python helper tests and the Go extraction suite. Go tests use a writable cache. Reinstall and live UI/provider checks remain pending; see `docs/audits/2026-10-31.md`.

## 0.0.22 alpha — 2026-10-31

- Planning resumes saved work and proposes a complete document once decisions are settled. It no longer waits for an exact "write it" phrase; Finalize buttons are available in chat.
- Question options render as keyboard-accessible answer buttons, including their explanations. A choice sends its answer through the normal chat flow; typed answers remain available.
- Completion checks identify draft summaries and missing requirement details. Architecture sections need stable anchors, requirement links and interfaces. Tree generation checks saved prerequisites and references before creating files; analysis drafts remain explicitly marked as drafts.
- Flow & tree uses a beaver avatar in the same illustrated style as the other agents.
- Source update; reinstall and live editor validation remain pending.

## 0.0.21 alpha — 2026-10-31

- Flow & tree has its own named agent and diagram avatar. Selecting a planning skill chooses its agent, including when a different agent was pinned.
- Pair adds persistent A− and A+ controls for chat text size, with a layout that wraps on narrow panels.
- Keeping a valid tree JSON proposal creates every missing planned file, including nested folders, and carries each role into supported file comments. Existing files are preserved.
- Settings and Keyboard Shortcuts use readable text, selection, link and focus colors on their editor surfaces. Paper and Night secondary text and chat controls have improved contrast.
- Source update; reinstall and final live UI checks remain pending.

## 0.0.20 alpha — 2026-10-22

- Ollama project actions recover ordinary prose and known shorthand tool replies. Unsupported file-access denials are redirected to the editor's tools; false claims of completed writes are rejected. Ordinary change requests may propose edits directly, while explicit location questions remain read-only. File reads prefer the current unsaved editor buffer, so coding-time changes stay visible to the model.
- GLM 5 uses Ollama's separate reasoning channel to prevent planning examples from contaminating generated code. Flat GLM tool actions are accepted through the same validated host tools. A real-model installed-editor test checks brain reads, a Python file edit, and exactly one requested `#Ai` function with surrounding code preserved.
- Reviewed proposals can create nested folders and delete files through Keep/Undo. New paths are checked against existing ancestors and symlinks; no target changes before Keep.
- Python: Shift+Enter runs the selection or current line; Cmd+Enter (Ctrl+Enter elsewhere) runs a `# %%` cell. A persistent terminal uses the project's selected Python interpreter, retains variables and displays final expressions. A restart command clears the session.
- Python Results shows each run's file and line range, printed output, final expression values and errors. The terminal remains interactive, and later selections can continue after an error. Live GLM assistance checks cover automatic bug findings, quiet manual mode and reviewed test suggestions that preserve production code.
- Python output now appears directly below executed selections and cells, without opening a separate panel. Reruns replace their old output, edits above move it, and editing executed code invalidates its stale result. Outputs can be dismissed or cleared; the separate Results history remains available on demand. Native view-zone tests cover errors, tab switching and split editors without changing source files.
- An Auto/Manual status control governs background coding assistance. Auto reviews after a quiet typing period; Review Selection or File Now works in either mode. Functions and classes offer optional test and accessor suggestions.
- `#Ai <instruction>` comments offer a Generate Below action and Cmd+Alt+Enter (Ctrl+Alt+Enter elsewhere). In Auto mode, Enter after a completed directive starts a proposal. Only a bounded snippet is inserted below that line; surrounding code is preserved, and Keep applies it.
- The source limit is 300 lines, with a warning at 270. Extension, parser helper and test files were split by responsibility, and a regression gate checks file size and one class per file. Editor-host smoke tests cover actual proposals, Python execution and assistance modes.

## 0.0.19 alpha — 2026-10-20

- The fix list says why fixes are left unticked. When a package didn't build here last time, the top line reads "N left unticked: their packages didn't build here last time. Fixed the build? Tick them to check again.", and each row names the build error (say, a missing C header). When only add-tests rows are offered, it says nothing is ticked yet and that tests are never ticked for you.
- The Project card adds that files in packages that don't build can be ticked again once they build.

## 0.0.18 alpha — 2026-10-12

- Push to GitHub from my_editor: a **Push…** button on the Project view's Git card, and under Pair's reply when you ask Pair to push. You pick the remote and the branch name there, see exactly which commit goes where and the git command, and confirm; it pushes with your own git login and never forces. A new branch pushed under its own name then follows its GitHub copy, so update notices work.
- **Close project** at the top of the Project view (and the command my_editor: Close Project) closes the folder and goes back to Home. If a fix run is still working, it asks first.

## 0.0.17 alpha — 2026-10-12

- Refactors are ticked like splits; one with no test that runs it says so under its row, and build, vet and the extract check still guard it. Only refactors whose package can't be checked here, or that an earlier run refused for the same content, start unticked.
- A refactor must leave the function small enough to fit in a file of its own with the file's package and imports, so the split that follows can always finish; the model is asked for a real improvement (the function under about 200 lines, helpers that each do one job), not the smallest change that fits.

## 0.0.16 alpha — 2026-10-12

- The fix list puts refactors at the top under their own heading ("Refactors: 2 waiting for your OK"), with the splits and tests below; typing "refactor" in its search box finds them.
- The AI readiness card says what to do with refactors no test runs: click the button and tick them under Refactors.

## 0.0.15 alpha — 2026-10-12

- Go files your branch changed after `ai_fix` split off are now checked from the branch's own content before the picker opens, so test files are never ticked blindly and long functions in those files are offered as refactors in the first run.
- `scripts/install.sh` makes the editor reload its built-in extension list, so Home shows the installed version straight away.

## 0.0.14 alpha — 2026-10-12

- Go: a long function can be refactored into helpers on the `ai_fix` branch, then its file split, in one click. The model only chooses which statements become helpers and their names; my_editor writes them byte for byte, with types from the compiler's own type checker, refuses anything it cannot prove behaves the same, checks the written file with separate code, and runs build, vet and tests against the baseline.
- A refactor is ticked only when the package's tests ran that function in an earlier run; otherwise it is offered unticked with the reason, and you decide. Refused refactors are remembered for that file's content and are not ticked again.
- The approval window explains the extra `go test -coverprofile` command, and the AI readiness card counts only what a click would do.

## 0.0.13 alpha — 2026-10-11

- The AI readiness card says why files over 400 lines are left, by reason: how many need a real refactor (which the fixer doesn't do) and how many are in packages that don't build on this computer.

## 0.0.12 alpha — 2026-10-10

- Fix remaining files no longer ticks the same files every time. When your branch had changed a file after `ai_fix` split off, the picker could not tell that it is a test file or needs a real refactor, so it ticked it and the run skipped it again. A run now remembers what it settled from a file's content, by that content, and later pickers leave those files out.
- A run that commits no fix adds nothing to `ai_fix`: no empty change note. It says why each chosen fix was skipped.
- The Project card counts only files a click would split, and names the ones no run here can split instead of asking for another run.

## 0.0.11 alpha — 2026-10-10

- The Project view matches Pair: an AI readiness card, a compact Git card, pill buttons and one-line rows; nothing scrolls sideways. The fix button shows its state (Running…, Continue, Fix remaining files) and how many files over 400 lines are left.
- Fix on a local branch is in Project → Health and after Analyse. Finder `.DS_Store` files no longer block a run, and Pair knows the fixer instead of offering to split files by hand.
- The picker reads the `ai_fix` branch, so later runs offer files no earlier run reached. A file over 400 lines only because of one long declaration is reported as needing a real refactor instead of being moved for nothing.
- Fixed a run stalling for minutes after a check finished, when a background process kept its output open.
- my_editor's own code follows its rules: the chat view split into focused files, a test file per module, no line over 160 characters.

- Fixes on a local branch always go on one local branch, `ai_fix`; each run adds its commits on top of it (earlier work on `my_editor/ai-ready` is carried over once). If your branch has newer commits, the run says so and changes nothing else. my_editor never suggests merging `ai_fix`: review it with `git diff`, work on it with `git switch ai_fix`, or delete it.
- One click fixes every chosen file: a run no longer stops after 25 fixes, so there is no pressing the button again and again. Stop still saves where it is and Continue picks up from there; each fix is still its own commit, with one change note at the end. Pair shows *Fix 7 of 26: …* while it works, and the Project button reads **Fix remaining files** (was **Next batch**). Only a runaway run stops, at 500 fixes, and then says so.
- The picker ticks every split it can do. Files the last run could not check here (their package's build already failed at baseline) are left unticked, with the reason under the row; add-tests choices stay unticked as before.
- Chosen fixes that nothing here can check (their package's build already fails) are skipped right after the baseline and said once grouped by package.
- The change note lists files a split left over 400 lines and why, and groups the files never split by reason.

## 0.0.10 alpha — 2026-10-10 (installed; live check by the user pending)

- Python projects can be fixed on a local branch too. Whole definitions move byte for byte into new modules in the same package and the original imports them back, in a layout that black and ruff accept. An import check with the project's own interpreter proves every copied import still gives the same objects. Moves are refused where Python could notice: code that runs on import, decorators that register, doctests, `mock.patch` strings and warning filters naming the module, and projects that pickle or use process pools (constants only).
- Designs for C#, Rust and C/C++ are written and reviewed; they are next.

## 0.0.9 alpha — 2026-10-10 (installed; live check by the user pending)

- TypeScript and JavaScript projects can be fixed on a local branch too. Whole declarations move byte for byte into new files in the same folder and the original re-exports them; analysis uses the editor's own TypeScript. Projects that run through CommonJS, Babel, Vite, Next.js, Vitest, esbuild, Bun, tsx, swc, webpack or Parcel move only types, which those tools erase. Each split must pass the project's `tsc` and tests against a baseline.
- A split runs only if at least one compile check of its package passed before the run; commit messages and the change note say which checks passed and which already failed.
- The fixer is built on a language-neutral core with one adapter per language.

## 0.0.8 alpha — 2026-10-09 (installed; live check by the user pending)

- The first-open offer and command now say **Check AI-readiness**: that step only reports. Fixing is its own step, **Fix on a local branch**.
- Go projects can be fixed on a local branch after the AI-ready report: long files are split by moving whole declarations byte for byte, and untested files get tests. Each fix is checked (move check, `go build`, `go vet`, `go test` against a baseline run twice) and committed on its own in a worktree next to the project; at most 25 per run, with Stop and Continue. Nothing is pushed.

## 0.0.7 alpha — 2026-10-07 (installed; live check by the user pending)

- Opening a project my_editor did not create offers an AI-ready check: Analyse, then a health report of long files, extra classes, untested files, design notes and possible bugs at lines the model was shown. It changes no code; model text is escaped in the report. Also available from the Project view and the command palette.
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
