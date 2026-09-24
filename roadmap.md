# my_editor comparison and roadmap

**As of 24 September 2026.** This compares my_editor's current macOS alpha with **Cursor's editor** and **Google Antigravity IDE**. Antigravity 2.0 is a separate agent manager and is outside this comparison. Competitor entries describe documented capabilities, not hands-on test results. my_editor entries use the [current product status](docs/vision-and-status.md), [feature checklist](docs/progress.md), and recent clone-flow work. A feature marked *built* still needs an end-to-end check in the installed app before it is treated as reliable.

## Aim

Build an editor that helps a person make and maintain a large software project with an AI pair programmer. The editor should remember what the project is for, help turn ideas into requirements and architecture, find the right source when a question arises, propose code changes for review, check the result, and explain later why a change happened. The user remains in control of files, model choice, tests, and publishing.

The product promise is **continuity with evidence**. Pair should know which project and branch are open, retain the active goal and accepted decisions through long chats and restarts, retrieve current code rather than relying on an old summary, and distinguish observed facts from guesses. The project brain is a navigable map; current source and Git history are the authority. A quiet, attractive interface should make this workflow easy without hiding ordinary editor features.

### Product objectives

| Objective | User outcome |
|---|---|
| Pair programming | Discuss, debug, review, and request a code change in the same project-aware conversation. |
| Requirements and architecture | Develop and revise requirements, architecture, flows, and a planned file tree, with links to implementation. |
| Project brain | Return to a large project after time away and recover its purpose, modules, conventions, decisions, current task, and coverage gaps. |
| Human control | Inspect a diff and choose Keep or Undo before an AI proposal is saved; approve tests and publishing separately. |
| Change management | Trace a request through requirements, decisions, changed files, QA results, and Git commits; see likely effects of future changes. |
| Quality assurance | Run relevant checks on kept changes, review failures, and retain evidence with the change record. |
| Clear coding interface | Find files, see project maps, adjust layout, and understand the active model without fighting the UI. |
| Model flexibility | Use supported subscription, API, or local models through the same project-aware Pair workflow. |

**North-star scenario:** Reopen a large repository, ask about a problem with no file open, receive an answer grounded in current files and Git, approve a proposed change, verify it, and later find the reason and test result from its commit. This should work without asking the user to paste the project back into chat.

## Current baseline and limits

- The codebase and installed app identify as **0.0.5 alpha**. The app is currently tested only on macOS arm64. This source version was requested before the installed-app Pair acceptance check; it is not release-tagged.
- Home, Project, Pair, guided planning, brain analysis, visual maps, model selection, diff review, Navigator, and some QA paths are built. Their existence does not establish that the complete workflow is reliable on a large real project.
- The private `go-dialer` branch was cloned and Git confirmed its branch and commit. The clone naming and destination flow confused the user. A clearer editable-name prompt has been compiled and copied into the installed app, but that revised prompt has **not** been verified by the user in the UI.
- The project brain has file-size and run limits. Pair's long-chat continuity, large-repository retrieval, complete multi-file edit loop, and restart behavior still need end-to-end checks. Change impact is a hint; a linked request-to-commit record is not complete.
- Pair's former 10-check cutoff has been replaced locally with a 60-check safety bound, grouped read-only checks, and a summary of unfinished work at the bound. Automated tests pass and the compiled extension is in the installed app; a live large-project request after restart still needs verification.
- A joined model tool reply previously appeared as raw JSON in Pair. The local parser now handles the repeated request and retries malformed tool JSON once; the installed-app behavior still needs a user-run check.
- Long pasted messages were silently cut to 2,500 characters when reused as chat history. Pair now marks shortened messages and can fetch stored chat text in bounded chunks; a real log-retrieval check in the installed app remains open.
- The Project view now has a local Git update card and checks the tracked remote branch on open and every ten minutes. It notifies once per new remote head, and the Update action only fast-forwards after safety checks. The installed-app notification and update flow still need a live check on a cloned project.
- A saved Pair conversation in `m_dialer` held recent 5,000–6,000-character user pastes, with relevant log terms beyond the former 2,500-character model cutoff. Pair now includes those recent pastes under a model-aware budget, saves the user's message before requesting a model reply, and retains up to 200 messages for search. A live GPT Sol follow-up on the saved conversation remains the acceptance check; chat state is scoped to the opened workspace folder.
- The user will operate the editor UI for now. Verify the 0.0.5 Pair flow in the installed app before calling this release complete. Git pushes require the user's instruction.
- Pair now has a project status snapshot per turn, approved named operational observations, searchable saved records, and linked proposal events. The m_dialer observation recipes were exercised from the host runner; the installed-app Pair flow and approval UI still need a user-run check before these features are marked verified.

## Comparison

| Capability | my_editor today | Cursor | Antigravity IDE |
|---|---|---|---|
| Main workflow | Pair programming in a VSCodium editor: Project and Pair views, guided build stages, and reviewed edits. Working alpha. | Agent, Ask, Plan, and Debug modes for coding tasks. [Modes](https://prod.cursor.com/help/ai-features/agent) | Editor plus agent conversations; agents work across editor, terminal, and browser. [IDE overview](https://www.antigravity.google/docs/ide/overview/) |
| Understanding a repository | `Analyse` builds a file map, module notes, and draft architecture; visual architecture and file maps are built. Large-repo coverage and freshness need live validation. | Automatic codebase indexing and code search; agent reads files as needed. [Indexing](https://docs.cursor.com/get-started/installation), [Agent](https://cursor.com/docs/agent/overview) | Agent reasons over workspace code and uses tools. The documented IDE also has reusable rules and skills. [Agent](https://www.antigravity.google/docs/agent), [Skills](https://www.antigravity.google/docs/skills?tab=ide) |
| Long conversations and project memory | Brain, decisions, chat history, Git context, and a compacted working brief are built; continuity after restarts and across large projects remains unproven. | Project rules and memories persist context; conversation search and side chats help recover prior work. [Rules](https://docs.cursor.com/context/rules-for-ai), [Memories](https://docs.cursor.com/en/context/memories), [Agent](https://cursor.com/docs/agent/overview) | Persistent rules and agent knowledge are documented; multiple conversations can run in parallel. [Rules](https://antigravity.google/docs/rules/), [Agent](https://www.antigravity.google/docs/agent) |
| Code changes and control | Pair proposes diffs; the user chooses Keep or Undo before files are saved. Bounded source and Git tools are built, but the complete multi-file loop needs live testing. | Agent can edit several files and run commands; diff review and local checkpoints support rollback. [Agent](https://cursor.com/docs/agent/overview) | Agent can edit code and produce plans and diffs as reviewable artifacts; review behavior depends on settings. [IDE overview](https://www.antigravity.google/docs/ide/overview/), [Artifacts](https://antigravity.google/docs/artifacts?authuser=002) |
| Requirements, architecture, and visual plans | Dedicated Requirements → Architecture → Flow & tree → Build → QA path, plus saved specs and visual maps. | Plan mode supports reviewing an approach before a larger change; the cited docs do not describe a dedicated requirements record. [Modes](https://prod.cursor.com/help/ai-features/agent) | Planning artifacts can include architecture diagrams and accept feedback. [IDE overview](https://www.antigravity.google/docs/ide/overview/), [Artifacts](https://antigravity.google/docs/artifacts?authuser=002) |
| Change management | Git history and impact hints exist. A durable record linking request → decision → kept diff → checks → commit is still missing. | Checkpoints and Git support rollback and history; Bugbot can review a branch or PR. [Agent](https://cursor.com/docs/agent/overview), [Bugbot](https://prod.cursor.com/docs/bugbot) | Plans, diffs, walkthroughs, and verification artifacts show what an agent did. [Artifacts](https://antigravity.google/docs/artifacts?authuser=002), [Walkthrough](https://www.antigravity.google/docs/walkthrough) |
| QA and evidence | On-save Navigator, folder fit reports, review, and approved npm/Go/Cargo/pytest runs exist. Tests currently inspect kept workspace files; results are not yet tied to a change record. | Agent can run tests and terminal commands; Bugbot provides code review. [Agent](https://cursor.com/docs/agent/overview), [Bugbot](https://prod.cursor.com/docs/bugbot) | Agent can use terminal and browser and attach verification artifacts, including browser recordings. [IDE overview](https://www.antigravity.google/docs/ide/overview/), [Walkthrough](https://www.antigravity.google/docs/walkthrough) |
| Model choice | Claude/Codex subscription routes, Ollama/LM Studio, and API routes are built. Some API routes and model-picker combinations need live checks. | Agent supports choosing a model for a task. [Agent](https://cursor.com/docs/agent/overview) | Agent side panel offers a model picker and agent modes. [Side panel](https://www.antigravity.google/docs/agent-side-panel) |
| AI autocomplete | No my_editor-specific Tab completion yet; language tooling provides ordinary editor completions. | AI Tab predicts edits, imports, and jumps within or across files. [Tab](https://prod.cursor.com/help/ai-features/tab) | Editor Tab supplies AI completion while typing. [IDE overview](https://www.antigravity.google/docs/ide/overview/) |
| Browser and parallel work | No browser agent or background agent manager in Pair. Current tools are intentionally bounded to the editor host. | Agent has browser tools, side chats, subagents, and background agents. [Agent](https://cursor.com/docs/agent/overview), [Background agents](https://docs.cursor.com/background-agent) | Browser agent and parallel local agents are core IDE features. [IDE overview](https://www.antigravity.google/docs/ide/overview/) |
| First-use and release confidence | Home, clone, model choice, and layout exist, but real use has exposed confusing clone prompts and insufficient live release checks. macOS arm64 is the only tested platform. | Established onboarding, indexing status, and editor workflows are documented. [Installation](https://docs.cursor.com/get-started/installation) | Editor, agent panel, and artifact review are documented product surfaces. [IDE overview](https://www.antigravity.google/docs/ide/overview/), [Side panel](https://www.antigravity.google/docs/agent-side-panel) |

## Marks and direction

These are **judgment scores, not benchmark results**. The direction mark asks how closely each product serves *our stated aim*: a long-lived project brain, user-controlled pair programming, and traceable requirements → changes → QA. It does not rate the universal quality of the product. The feature mark estimates useful capability available today, including gaps and validation risk. Competitor scores use official documentation; I have not run the same tasks in all three editors.

| Product | Direction fit to our aim /10 | Feature readiness today /10 | Reason for the marks |
|---|---:|---:|---|
| **my_editor** | **9** | **4** | The aim directly connects project knowledge, requirements, reviewed edits, change history, and QA. Much of the structure is built, but large-project continuity, the full Pair loop, clone UX, and release checks still need installed-app proof. [Status](docs/vision-and-status.md) |
| **Cursor** | **6** | **9** | Strong codebase retrieval, planning, agent editing, checkpoints, AI Tab, and review. Its documented workflow centers on completing coding tasks; requirements-to-commit traceability is less central to that workflow. [Agent](https://cursor.com/docs/agent/overview), [Tab](https://prod.cursor.com/help/ai-features/tab), [Rules](https://docs.cursor.com/context/rules-for-ai) |
| **Antigravity IDE** | **6** | **8** | Strong editor, browser and parallel agents, with plans, diffs, and verification artifacts. Its documented direction centers on agents executing tasks across surfaces; our persistent project and change record is a different emphasis. [IDE overview](https://www.antigravity.google/docs/ide/overview/), [Artifacts](https://antigravity.google/docs/artifacts?authuser=002) |

**Direction answer:** yes, my_editor is aiming at a different center of gravity. Cursor emphasizes fast AI-assisted coding and task completion; Antigravity emphasizes agent work across editor, terminal, and browser with artifact review. my_editor aims to be a project-aware pair programmer that keeps the *reason* behind changes accessible over time. Cursor and Antigravity also have memory, plans, and review, so the distinction is emphasis and integration, not an exclusive feature claim. The 9/10 direction mark is a bet on that focus; the 4/10 feature mark reflects how much still needs to work reliably before the vision is delivered.

### What to learn from the comparison

my_editor's strongest direction is **project continuity with explicit human review**. Its requirements, architecture, brain, impact view, and Keep/Undo flow should form one connected workflow. Cursor and Antigravity set a high bar for everyday coding speed, repository retrieval, verification, and clear feedback while work runs. The next releases should prove my_editor's existing path works reliably before adding background agents or AI autocomplete.

### Ironman skill assessment

The downloaded `ironman` package has useful plain-language **discuss** and **teach** guidance, but should **not be bundled unchanged**. Its `/ironman on/off` state and reply-checking Stop hook are built for Claude Code under `~/.claude/`. my_editor currently loads a skill's `SKILL.md` for one Pair request; it does not run that hook or maintain those modes across later turns. Its code mode also asks for approval before every block, while my_editor already uses Keep/Undo to review proposed edits. Copying the package would advertise behavior the app cannot provide. A later opt-in coaching skill can adapt the voice and teaching loop to Pair, use the existing diff review, and add a native readability check only if real users find it helpful. Keep the downloaded scripts and personal glossary out of the app bundle.

## Roadmap, in priority order

The milestones are ordered by dependency, not by promised release date. A milestone is complete only after its acceptance checks pass in the installed app on a real repository. Unit tests and a copied extension bundle are supporting evidence, not a substitute for that check.

### M0 — Make the current app dependable

**Outcome:** A user can open or clone a project and immediately see the right project, branch, files, and model. Pair can answer a project question without an open file.

- Make Clone from Git show an editable project name and an unambiguous destination. Display the final path, selected branch, progress, success, and actionable failure text. Keep prompts open when switching apps. Offer Open instead of cloning over an existing folder.
- Verify the current local clone-name changes in the installed UI; they are not yet a verified feature. Do not create a release tag until the UI check passes.
- Run a fresh-profile smoke script and a manual pass: clone a private repository from a branch-page URL and from repo URL plus branch; choose a custom name; switch apps mid-prompt; confirm the opened Git branch, root path, file tree, and restart behavior.
- Exercise Pair with no file open, then with a selected file, using at least one subscription and one local model. The response must identify the actual workspace and cite files it read. Failed provider calls must produce a useful error.
- Exercise a single Pair request that needs at least 15 project checks. Confirm it continues past the old cutoff, supports grouped reads, and reports verified progress and remaining work if it reaches the safety bound.
- Fix layout and file-opening behavior seen in real use. Test narrow, wide, and resized windows without requiring users to toggle panels to recover space.

**Exit check:** An installed-app run of the full clone → open → ask → propose → Keep → test → restart flow is recorded with screenshots or a short result log. Do not create a release tag until that run passes. Git pushes require the user's instruction.

### M1 — Make the project brain trustworthy at scale

**Outcome:** Pair stays aware of the project over long chats and restarts, while checking current source before making claims.

- Add a visible coverage and freshness panel: analysed files, missing files, skipped reasons, changed-since-analysis files, and the commit or content hash used.
- Make Analyse resumable on a repository at least as large as `go-dialer`; preserve completed summaries and retry only missing or changed files. Measure duration, memory use, failures, and recovery after interruption.
- Define a context budget per turn. Keep the active goal, accepted decisions, current branch and commit, recent turns, and retrieved evidence; compact older chat without losing unresolved work. Show which files and brain notes supported an answer.
- Test a long conversation, app restart, branch switch, stale brain entry, and a request about an unopened file. Pair should retrieve fresh evidence or say what it could not inspect.

**Exit check:** On a 700+ code-file project and a 100-turn test conversation, Pair names the correct project and branch, finds relevant source, reports incomplete coverage, and does not claim to have read files it did not read.

### M2 — Connect changes to reasons and consequences

**Outcome:** A future developer can answer why a change was made, what was verified, and what may be affected by changing it again.

- Create one local change record per task: user request, linked requirement and decision IDs, base commit, proposed files and hunks, Keep/Undo outcomes, tests, review findings, and eventual commit ID.
- Separate **observed dependencies** from **predicted impact**. Let a user open the exact source, requirement, or decision behind each impact hint.
- Detect branch or working-tree changes after a proposal and warn before applying a stale diff. Preserve a readable history across restarts without storing secrets or huge code copies.
- Provide a Change History view that filters by file, requirement, task, and commit. Record manual edits as Git evidence without inventing a chat rationale for them.

**Exit check:** Complete two linked changes, reject one proposal, then reopen the project. The history must show the accepted and rejected work, checks, commit links, and limits of the impact estimate.

### M3 — Close the QA loop

**Outcome:** A kept change can be checked, fixed, and signed off from the same task record.

- Suggest tests from touched files and requirements, then run allowed commands only with the user's approval. Attach command, exit code, relevant output, and tested commit or working-tree state.
- Turn failures into a follow-up debugging task that can inspect files and propose a reviewed fix. Mark a result stale after the tested files change.
- Add requirement coverage and architecture-fit checks with source links. Keep AI findings advisory until a person reviews them.
- Add an installed-app regression suite for clone, model picker, Pair project binding, diff review, and restart recovery.

**Exit check:** A failing test can be traced to a kept change, fixed through another reviewed proposal, rerun, and found later in Change History.

### M4 — Improve daily editing speed and presentation

**Outcome:** The editor feels easy to use for long coding sessions, with clear model and context controls.

- Make the active model and reasoning level visible at the point of use; show provider availability and concise failures without changing models silently.
- Refine Home, Project, Pair, Explorer, and visual maps through user tests. Preserve layout across restart and make file navigation work at every panel size.
- Add direct links from architecture parts and requirements to relevant files and changes. Show analysis progress without burying the user in notifications.
- Evaluate AI Tab completion and inline edits only after the core project-aware Pair flow is stable. Measure latency, acceptance rate, and whether suggestions respect local conventions.

**Exit check:** A user can clone, orient themselves, find a file, ask Pair, review a diff, and return after restart without needing undocumented shortcuts or layout repairs.

### M5 — Optional agent capabilities

Browser verification, parallel tasks, remote/background agents, and richer MCP integrations are candidates after M0–M4. Each needs a clear user benefit, scoped permissions, visible progress, and a reviewable result. Add them one at a time rather than treating competitor feature count as the goal.

## Release rule

For this roadmap, **built** means code exists; **verified** means an installed-app scenario passed; **released** means the version was verified and tagged with the user's approval. Keep those states visible. Push source changes only when the user requests it; a source push at the current version is not a completed release.
