# Changelog

## 0.0.90-alpha.0

- Show a distinct Used state after an agent action runs and remember it for that project.
- Return rejected whole-file proposals to the agent so it can revise oversized or invalid source. A specialist can consult the Project Guide once and offer a decision if it is still blocked.

## 0.0.89-alpha.0

- Let slow OpenCode sessions use the existing turn deadline and Stop control. Keep the internal model stream alive during quiet periods, report which runtime connection failed, and avoid replaying a submitted turn.
- Add a primary action to each agent chat. Planning agents check saved prerequisites, offer their next task or review the saved document, and keep the normal review and Keep flow.

## 0.0.88-alpha.0

- Recognize typed/generic component signatures and document-only clarification/file-tree sections without relaxing real requirement and interface checks.
- Correct a generated planning document once with the full validation feedback, including incomplete fences, and preserve its draft across evidence retrieval and failed corrections.
- Offer a targeted Repair action for retained invalid drafts, including project-prefixed titles and JSON file-plan objects. Keep draft data separate from revision/read-only instruction classification.
- Reject stale planning proposals when prerequisite contents change, even if requirement IDs remain the same.
- Report Go package metadata errors that `go list -e` returns with exit code zero instead of treating them as missing declarations.
- Extend unit and real-editor coverage for planning recovery, stale Keep, agent isolation, permissions, Build/QA and runtime lifecycle. Bound test worker concurrency and syntax-check the editor fixtures.

## 0.0.87-alpha.0

- Fix Requirements → Architecture → Flow & tree → Build handoffs, including natural-language stage requests, and show the next agent after Keep. Preserve separate agent histories.
- Discover saved requirements in project tools, accept safe Markdown planning/review conclusions, and avoid forced rereads when current planning evidence is already supplied.
- Scope model tool instructions and per-file context, remove duplicate saved-document history and irrelevant fixer guidance, overlap provider discovery, and record numeric request-size/timing diagnostics.
- Use the available chat width, wrap long reply blocks, and replace cramped project-header links with accessible icon buttons and hover labels.
- Add real-editor coverage for agent routing, Keep handoffs, scoped prompts, file-worker permissions and measured webview layout.

## 0.0.86-alpha.0

- Give each OpenCode version probe and server a private home and working directory; avoid the implicit default-port preference during concurrent startup.
- Require a complete matching loopback readiness announcement and report bounded startup diagnostics without leaking runtime output. Retain the existing deadline, cancellation, permissions and Keep/Undo.
- Add finite concurrent real-editor load coverage for read-only refusal, proposals, Undo, Keep and actual saved-source tests.

## 0.0.85-alpha.0

- Distinguish explicit edit requests with narrow preservation constraints or prior read-only evidence from global edit prohibitions. Keep proposal and execution permissions unchanged.
- Allow one diagnosis format correction for prose-only replies; genuine BLOCKED responses stop immediately.
- Stop QA repairs when a previously repaired command failure returns, retaining the five-round guard and required final verification.

## 0.0.84-alpha.0

- Add thirteen development specialists covering the missing Appling catalog roles, with isolated conversations, focused workflows and existing host permissions/Keep/Undo. Preserve manual routing precedence and paused QA.

## 0.0.83-alpha.0

- Add an isolated UI/UX project agent with the pinned Apache-2.0 Anthropic frontend-design skill, responsive/accessibility guidance and explicit visual-evidence limitations. Preserve existing model, tools, permissions and Keep/Undo.
- Route explicit interface design requests separately from architecture; preserve manual pins, explicit modes and change-location requests.

## 0.0.82-alpha.0

- Add an opt-in OpenCode 1.19.3 backend for project-agent turns, selected through Choose Project Agent Runtime. Focused editing helpers keep their existing path.
- Route the exact selected model through my_editor's provider adapter and expose only an authenticated, one-use host-action gateway. Retain Keep/Undo, read/write scope, dirty buffers, command approvals, recovery limits and final verification.
- Isolate runtime state and configuration, refuse unexpected native tools/configuration or unsupported versions, abort owned sessions on Stop, and remove their temporary state. No silent runtime/model fallback or automatic permission expansion.

## 0.0.81-alpha.0

- Establish dependency-ordered build/type/lint/test evidence before unattended whole-project QA. Verify each repair batch immediately, stop unchanged executable failures, and require final passing checks before completion.
- Separate saved edits from verified fixes, retain repair evidence, and protect legacy test-only permissions from implicit command expansion.
- Allow Requirements, Architecture and Planner to inspect current code independently of generated planning documents, with read-only scope and required source inspection. Existing proposal approvals and isolated conversations remain.
- Audit the shared OpenCode recommendation and define a replaceable runtime trial; no backend or model switch is included.

## 0.0.80-alpha.0

- Revalidate tool-read dependency evidence using the existing 400 KB read budget, while retaining the 80 KB whole-file edit limit and full source freshness checks.

## 0.0.79-alpha.0

- State the final-test diagnosis batch limits explicitly and allow one evidence-backed format correction. Keep source/scope validation, bounded retries and genuine decision/environment blockers intact.

## 0.0.78-alpha.0

- Resolve new supporting files to the sole saved-plan directory owner when QA inventory groups also contain siblings. Retain genuine multiple-owner rejection and explicit production-file scope approval.

## 0.0.77-alpha.0

- Rediscover existing companion tests for whole-project QA test-failure diagnosis, include them in the repair queue and source-progress signatures, and preserve selected-file and production-file scope boundaries.
- Persist command outcomes before model diagnosis, expose checkpoint activity, and identify rejected repair paths in errors.

## 0.0.76-alpha.0

- Accept a verified contiguous excerpt within a content-addressed planning section, retaining the full section for coordinated repairs. Changed/unknown references, unrelated or altered quotes, and partial developer answers remain rejected. Clarify citation recovery and cover the worker/controller path in the disposable editor fixture.

my_editor uses the version in `overlay/extensions/my-editor-core/package.json` as its own release number. The Home page displays that version. The underlying editor shell keeps its upstream version independently.

## 0.0.75 alpha — 2026-11-07

- Consolidated Build/QA review and release gate are documented in `docs/build-qa-system-audit.md`; application acceptance remains separate from editor fixture success.
- Saved decisions can be referenced by host-generated content IDs, avoiding repeated prose transcription while preserving provenance, scope checks and legacy quote support.
- Checkpoints retain structured command outcomes and log paths. Diagnostic bundles prioritize failures without losing early failures behind later successful output.
- Dependency freshness is rechecked at Keep; workspace wildcard exports and package-local regression lookup improve context selection. Explicit model selection never silently falls back when unavailable.

## 0.0.74 alpha — 2026-11-07

- Build and QA assemble fresh dependency source from current imports, workspace package exports, manifests, nearby tests and brain-linked callers. Excerpts and missing links are explicit; tools can expand retrieval. Dependency hashes cover both preloaded source and subsequent file reads, and reject stale proposals.
- Unattended QA diagnoses actual failed checkpoint output, revisits a coherent set of existing run files, then reruns checks. Five rounds and a source-progress guard bound recovery. Diagnosis cannot write files, expand scope or authorize a product decision.
- Source changes during checks invalidate the result. Reports retain runner summaries, reported skips, test-driven repair rounds and explicit verification limits. Scoped file reads can retain up to 600 lines without the earlier 8 KB tool-result cutoff.

## 0.0.73 alpha — 2026-11-07

- Invalid coordinated-repair decision citations receive one evidence-backed correction attempt inside the file pass. The model must correct the source and quote against saved plans; unresolved mismatches still stop, and the controller revalidates before queueing.

## 0.0.72 alpha — 2026-11-07

- Saved-plan repair quotes also tolerate unordered-list markers and prose wrapping. Contiguous wording, punctuation, negation and order remain required; exact developer answers and all repair guards remain unchanged.

## 0.0.71 alpha — 2026-11-07

- Saved-plan repair decisions accept quotations of rendered bold text by removing paired Markdown bold markers only. Words and punctuation must still match; developer answers remain exact.

## 0.0.70 alpha — 2026-11-07

- Coordinated repairs distinguish separate defects in the same dependency from identical repair requests. Repeated reasons, pending duplicates and cycles still stop; each origin/dependency pair has a three-request limit in addition to the overall run limit.

## 0.0.69 alpha — 2026-11-07

- Whole-project QA can coordinate repairs to existing companion tests created after its initial file discovery. Persisted QA scope is reused without duplicate file entries; Build and selected-file scope remain restricted, and new production supporting files still require exact approval.

## 0.0.68 alpha — 2026-11-07

- Supporting test files requested by coordinated QA repairs reuse the run’s existing automatic companion-test permission. New production supporting files retain their exact scope approval.

- Detected test tasks retain bounded output logs and pass redacted failure excerpts to QA, with a timeout for hanging commands. Older unattended QA runs refresh exit-code-only evidence once when resumed.
- Build instructions distinguish an interface owned by a new file from a missing dependency, so empty future consumers do not unnecessarily block related-file batches.

## 0.0.67 alpha — 2026-11-07

- Build and QA accept literal line breaks and tabs inside otherwise valid model JSON strings, preserving source content exactly. Ambiguous quotes, escapes and truncated responses remain rejected; normal file scope, approval and validation still apply.

## 0.0.66 alpha — 2026-11-07

- Build can generate up to three related files in one model request, sharing source context and explicit interfaces. The setup and compact Speed control let the user choose grouped generation or one file per request; single-file review cadence stays individual.
- Each candidate still receives its own source, plan, path and 600-line checks, saving permission, summary and progress entry. Prepared siblings are discarded when their input snapshots change or the run pauses/reopens.
- Incomplete or out-of-scope batches fall back to the individual dependency-aware workflow without repeatedly retrying the same group. Later QA and tests still cover every generated file.

## 0.0.65 alpha — 2026-11-07

- Repair prerequisites now take priority in both the active repair queue and normal build order. The controller resumes the consumer after saving its prerequisite, retaining the approved decision and one-file write scope.
- Runs stopped by 0.0.64's unscheduled dependency request can resume without a repeated-request loop. Actual repeated work, cycles and out-of-scope dependencies remain rejected.
- Finishing the implementation stage inside a repair queue now triggers tests and QA rather than skipping those stages.
- Architecture and file planning now explicitly call for shared field types, ID ownership, producer/consumer contracts and dependency order within each module.

## 0.0.64 alpha — 2026-11-07

- Coordinated repairs can propose exact new supporting files, such as forward migrations that preserve existing data. A concrete scope review authorizes those files for this run; each is then built separately and included in later QA without repeated scope approvals.
- Declining the scope review saves no files and leaves progress resumable. Existing files outside the selected plan remain protected, and the saved architecture/file plan is unchanged.

## 0.0.63 alpha — 2026-11-07

- Build/QA can request coordinated repairs to already-planned files, including files processed earlier and files in another selected module. The queue repairs them one at a time, then returns to the blocked file without repeating Keep prompts when automatic saving is already authorized.
- Repair requests must cite the exact developer answer or an explicit saved-plan quote. File scope, source guards and saving permissions remain enforced; generated code comments alone are not accepted as authorization.
- Repair queues and decisions survive pause/reopen and remain available to later QA. Existing-code shortcuts cannot skip queued repairs. Completed-file counts stay unique, and chat/report views show the repair queue and reasons.
- Out-of-scope, duplicate, repeated and circular repair requests are rejected instead of silently widening scope or looping.

## 0.0.62 alpha — 2026-11-07

- Build and QA investigate a design blocker against fresh saved requirements and architecture before asking the user. Ranked, line-referenced excerpts search the full documents, beyond the initial file brief; one bounded recovery can finish the file when the saved decision is clear.
- Explicit saved contract decisions are treated as existing authorization. Generated code disagreeing with that decision is a defect to correct, not a reason to ask the developer to choose again. File scope and normal save validation stay intact.
- Unresolved questions must identify both planning sources, the exact missing/conflicting information, a recommendation, and two numbered alternatives with trade-offs. Unsupported bare questions are rejected. The Answer action shows the actual question and points to the recommendations in chat.

## 0.0.61 alpha — 2026-11-06

- New “Unattended run…” permission choice presents one upfront authorization for planned-file saves, QA fixes, new companion tests and detected project test execution, including scripts generated during the run. Permissions are scoped to the current workspace run and survive reopening.
- Approved test commands execute sequentially at stage boundaries without a task picker. Configured arbitrary tasks are excluded from this automatic mode. Cancellation, workspace changes and permission revocation stop further automatic execution.
- Passing final checks finish unattended runs without “Finish after review.” Failed or unavailable checks remain explicit and do not automatically complete. Design questions and changed plans still require attention.
- Saving → Change offers the same authorization for an existing run. Separate runs retain their own choices.

## 0.0.60 alpha — 2026-11-06

- Build everything now has separate implementation and QA stages. Existing non-placeholder code is preserved for later QA without an AI audit during implementation; missing and visibly incomplete files still go through the normal generation and save guards.
- Once all planned files are processed, the editor offers tests, then reviews the application and companion tests in QA before final tests. Failed final tests block completion; skipped checks remain unverified. Existing code is never labelled verified merely because it exists.
- Resume preserves unchanged implementation results when another file changes. Starting another whole run offers to resume saved progress. Existing whole Build runs can switch using “Build first, then QA.”
- Progress distinguishes implementation files saved/present from QA files reviewed/fixed. Reports retain both stages. Module and selected-file runs keep their selected review cadence.

## 0.0.59 alpha — 2026-11-06

- Run-scoped saving permissions can be changed while a Keep decision is pending. Users can authorize planned files and new companion tests for the remainder of a run, with no repeated Keep prompts. The companion-test prompt can grant the same new-test permission. Separate runs retain their own choices.
- Current-file cards show finished/total, remaining files, and saved versus unchanged counts.

- Build/QA puts the current file before collapsed finished-file history. Compact controls have tooltips and expandable help that never pauses a run. Prepared code stays collapsed until requested, and unrelated editor-file labels no longer appear in the active run composer.
- File activity describes the current file and related context instead of displaying a tool-call budget as progress. Configuration lookup hints focus on inherited settings and enclosing manifests.
- Run-owned clean preview tabs close when a file finishes; existing, pinned and unsaved tabs stay open. Keeping a file-pass proposal closes its diff without opening another source tab.
- New-test approval explains that the additional file is inside the project and distinguishes Review from Keep.

## 0.0.58 alpha — 2026-11-06

- Build everything and QA everything now stop at a final test/review checkpoint. All selected modules contribute detected test tasks.
- A failing selected test task blocks continuation and completion, including after Stop/Resume or a cancelled retry. A passing rerun releases the checkpoint.
- Skipped or unreported tests stay explicitly unverified in the chat, guide and completion report; passing one selected task does not claim complete project coverage.

## 0.0.57 alpha — 2026-11-06

- Bare placeholder responses cannot become source-file proposals or be kept as edited proposals. This guard preserves ordinary identifiers and string literals containing the word placeholder.

## 0.0.56 alpha — 2026-11-06

- Build can process explicitly requested, unimplemented dependencies first within the same selected module, then return to the waiting file. Module membership, saved planning documents and review checkpoints remain intact. Cycles, repeated requests, completed files and out-of-scope dependencies stop with an actionable explanation. File results record order changes.

## 0.0.55 alpha — 2026-11-06

- Valid Build/QA completion summaries use the file-run contract exclusively. Ordinary chat recovery no longer replaces them with conflicting Keep guidance. Failed completion corrections retain bounded diagnostic evidence.

## 0.0.54 alpha — 2026-11-06

- Larger batches of read-only model requests are processed four at a time, within the existing 60-call budget. A valid six-read GPT response no longer stops Build with a generic parse error. Grouped writes and test execution remain rejected.

## 0.0.53 alpha — 2026-11-06

- Explicit repair requests can limit retrieval to “these two files” or “the following files” without being made read-only. A standalone read-only request still forbids edits.
- Agents can propose exact, unambiguous replacements for small repairs. The host preserves untouched content and retains the normal diff, scope, validation and Keep rules. Missing, repeated or overlapping matches are rejected.
- Source proposals beginning with a model failure response are rejected before review or saving.

## 0.0.52 alpha — 2026-11-06

- Chat checks claims that a diff is ready for Keep against actual host proposals. A missing proposal gets one correction attempt, then an explicit incomplete result. References to an already-open proposal remain valid.
- A repair naming one file can exclude other named files without being misclassified as a read-only request. Global prohibitions and conflicting target restrictions remain read-only; excluded planning files do not gain revision permission.
- Proposal tabs use “proposed by AI” instead of the obsolete “Pair” label.

## 0.0.51 alpha — 2026-11-06

- Build and QA reject binary or credential-like generated content before staging or saving it. Previously a file could be saved and then fail the source check, leaving the run stopped after a partial save. Test fixtures receive a correction explaining how to use synthetic values.
- The source guard recognizes simple JavaScript and TypeScript references such as `token: fixture.value` without treating them as credential literals. Literal values, comments, known key formats and non-code configuration retain their checks.

## 0.0.50 alpha — 2026-11-06

- The editor shell leaves Keychain uninitialized for absent secret reads, secret-name listing and deletion. Real credential reads and writes retain the existing encryption path.
- Secret-change notifications still work before the first credential read, and explicit in-memory test mode remains isolated from persisted secret names.
- Validation: all 19 core SecretStorage tests pass, including empty lookups, metadata-only access, deferred decryption, notifications and isolation.

## 0.0.49 alpha — 2026-11-06

- Build and QA receive a focused per-file brief: linked acceptance criteria, shared constraints, relevant architecture, the current module's checks, and dependency lookup paths. Unrelated feature bodies and the full tree are omitted; source locators remain available for targeted retrieval.
- File context retains project brain notes, direct dependency/caller hints and accepted decisions. Developer clarifications remain attached to their target file.
- Ordinary repair chat retains a bounded set of unique dependency results after four reads. Cloud Ollama context capacity is discovered from model metadata and cached.
- Model discovery lists encrypted-storage key names without decrypting unused API keys. Actual API calls still read their selected credential through SecretStorage.
- DeepSeek's native grouped-read envelope keeps the existing read-only batch restrictions. Unproposed rewrite claims receive a bounded correction.

## 0.0.48 alpha — 2026-11-06

- Scoped file passes accept their plain `FILE_REVIEWED` and `BLOCKED` conclusions without a redundant model request. Prompts explicitly place those markers inside the final JSON message.
- DeepSeek's alternate grouped-read envelope uses the same read-only allowlist and batch limits as normal grouped tools.
- Build prompts explicitly require missing and placeholder files to be implemented in the current pass. A completion claim without a staged implementation gets one correction attempt; the host still rejects an unwritten file.
- Ollama's native tool responses, including DeepSeek's nested argument envelope, enter the existing agent parser and permission checks instead of appearing as empty replies. Native requests cannot execute in turns without project tools.

## 0.0.47 alpha — 2026-11-06

- DeepSeek's XML-wrapped read requests are normalized using the existing read-only allowlist. Malformed replies retain redacted diagnostic evidence and receive a concrete correction example.
- Tool history preserves valid JSON actions instead of prose receipts that DeepSeek could imitate. Complete proposals count toward the retained-context budget.
- Choosing a recovery model applies only to the current Build or QA run. Dismissing the picker preserves its model and other chats keep their default.
- File and module checkpoints offer tests from the nearest package or language project for the files just processed. Whole-project and configured tasks remain available.
- Validation: compilation and the editor-host Build/QA fixture pass. The fixture proves a nested package test runs successfully while the root test command deliberately fails.

## 0.0.46 alpha — 2026-11-06

- Expanding a Build or QA chat reveals its current run when run data arrives after the conversation. Later updates respect the reader's scroll position.
- Lay out the agent header before positioning the conversation, preventing the restored view from landing on an older message.
- Validation: the chat webview regression check passes. Live project root checks pass, including 600/601-line lint boundaries; whole-project acceptance remains in progress.

## 0.0.45 alpha — 2026-11-06

- Model output updates the activity label while a code proposal or final response is arriving. Build no longer stays labelled as reading context during code generation.
- Retains the validated 600-line limit and clarification recovery from 0.0.44.
- Validation: compilation and the editor-host Build/QA fixture pass, including code-generation activity, reviewed/automatic saves, previews, real tests and blocker recovery.

## 0.0.44 alpha — 2026-11-06

- Raised the source-file limit to 600 lines at the user's request, with a warning at 540. AI proposals, inline generation, diagnostics, refactoring prompts, Build/QA and the editor's final save guard use the same limit.
- Preserve a worker's final BLOCKED question after a rejected proposal so the user can answer it. Previously, the earlier validation error hid the actionable question.
- The installer refuses to replace an app that is still running, preventing stale checksum metadata from producing a false corruption warning after a core update.
- Validation: all 770 automated tests pass serially. Editor-host Build/QA checks pass, including the recovered clarification. The rebuilt shell saves exactly 600 lines and blocks 601. Installed bundle checksums and code signature pass. Live project acceptance is still in progress.

## 0.0.43 alpha — 2026-11-06

- Scoped Build/QA passes retain dependency bodies within a bounded context budget instead of discarding full results after four checks. Repeated identical reads share one retained result.
- Each file attempt records its model conclusion and host retrieval evidence. An unimplemented-file failure includes the model's explanation.
- Restoring a source editor no longer automatically replaces the selected sidebar with File chat.
- Validation: all 770 automated tests passed with test concurrency set to one; the file-chat and project-build editor fixtures passed. The default concurrent suite exposed timing-sensitive existing Go refactor tests, which also passed in isolation. Live social-media project acceptance is in progress.

## 0.0.42 alpha — 2026-11-06

- Split opening one file from following the build in the editor. Follow advances through the queue, can be stopped independently, and does not switch away from unsaved edits.
- Build and QA show prepared code before applying it, clearly marked as not saved. Context-gathering explains why the editor still shows existing contents. Progress identifies tool targets and the latest update time.
- Completed results distinguish host save state from the AI's pre-save review. File workers are instructed to leave saving and continuation to the host's permission controls.
- Validation: 769 automated tests and the real-editor project-build fixture passed, including follow/stop-follow, prepared-code delivery, reviewed saves, cancellation and actual Node test execution with a simulated model. Prepared-code controls were inspected in light and dark previews.

## 0.0.41 alpha — 2026-11-06

- Agent chat fills the editor tab. Conversation and Build/QA activity share one scroll area, with no sticky controls covering text. Tabs use the active agent's name. Column mode closes the expanded chat tab and reveals the current build file; File chat no longer takes over a visible agent chat.
- Each run shows the current file, its planned responsibility, module and live work status. Completed files have a concise summary, saved/unchanged outcome and an Open file action. Earlier summaries remain available after reopening; generation does not imply test success.
- Replaced animal avatars with eight distinct human cartoon portraits and keep the selected agent visible in narrow columns. Button text/background pairs and focus states work in light and dark themes.
- Local tree-status updates use atomic replacement so a running build cannot mistake an intermediate empty plan for a changed design.
- Validation: 769 automated tests and the project-build and file-chat editor-host fixtures passed. The build fixture verifies column navigation, closing the expanded tab, file links, agent-sidebar retention, live progress and saved summaries, using simulated generation and actual Node tests. Visual previews cover light/dark layouts and a 360-pixel sidebar.

## 0.0.40 alpha — 2026-11-06

- Build and QA chats now show project and file run buttons, live queue status, review controls, checkpoints and errors. Opening either Project stage opens its agent chat.
- Plain build requests open the scope chooser. Authentication failures remain visible after reopening, with a run model chooser and Resume. The reported project's queue had stopped before its first file because Claude authentication expired.
- Build/QA buttons use explicit foreground/background pairs, readable disabled states and visible keyboard focus. Recovery actions stay visible when long status text scrolls in a narrow sidebar.
- Validation: 769 automated tests and the editor-host project-build fixture passed, including live chat progress and error delivery. Dark/light and narrow-sidebar previews were visually inspected. Model replies in the fixture are simulated; test commands execute real Node tests.

## 0.0.39 alpha — 2026-11-06

- Build and QA offer project and selected-file runs with explicit write permission. Each run uses one file at a time and shows module and file counts. Users can review each diff or authorize automatic application and choose test and review checkpoints after each file or group of one or two modules.
- Workers inspect saved requirements, architecture, flow, brain, conventions and source. Generated files have a 300-line limit. Build and QA ask for design clarification when needed and require separate approval for a new companion test.
- Checkpoints record actual test-task outcomes. QA saves file findings and test evidence in a project report. Stop, reopen and resume preserve saved work. Source or planning changes invalidate stale proposals.

## 0.0.38 alpha — 2026-11-04

- Fixed Build navigation revisiting saved setup files because prerequisite test confirmations were missing. Coding readiness now follows saved prerequisite implementation, while check confirmations remain separate. Within a ready step, unfinished source is preferred over manifests; the Project Build action always uses the guide even if its row carries a file path.
- Added Build whole project in Project, File chat and Build guide. Explicit requests such as “ok code everything for me” start a persistent queue in saved dependency order, using the selected chat model. Remaining stubs are prepared as complete reviewed proposals; Keep reviewed batch automatically prepares the next batch, including when a model finishes only part of a step. There is no five-file project cap.
- Queue state, remaining counts, review links and pause/resume controls are visible in Build guide. Reopening pauses safely and regenerates only unkept work after Resume. Full saved planning context stays available to each worker; writes are restricted to that batch, and existing implemented files and planning documents are preserved. Empty/unchanged proposals, invalid JSON and concurrent developer edits are rejected. Source-size rules remain enforced; no code is truncated to fit.
- Completion means no unchanged planned stubs remain, not that tests passed. Generation failures stop visibly; Undo pauses the queue. Project verification remains explicit and separate.
- Validation: 765 automated tests passed. The whole-project editor-host fixture generated seven remaining files across four partial batches without another chat prompt, exercised source-first navigation, reviewed Keep, scoped writes, pause/resume, cancellation, Undo, empty replies and concurrent edits. Existing build-start, file-chat and build-guide regressions passed. The social-media project was only read; live-model acceptance remains pending.

## 0.0.37 alpha — 2026-11-04

- Build now opens the selected planned file with a visible file-chat guide: its step, file position, saved purpose, next action, tasks, checks and file order. Configuration comes first when the saved plan requires it; the view explains that order instead of opening an unexplained empty JSON file. Opening the guide does not invoke a model.
- Help me start requests a brief, concrete first action for the current file. Prepare this file uses its saved planning context to create a complete reviewed proposal in the file-local workflow, including JSON files that cannot contain inline AI comments. The source stays unchanged until Keep; incomplete code fences, elisions, invalid JSON and stale-source replies are rejected, and the existing source-size policy applies.
- Next file navigates within the current step without confirming checks. Build selects a dirty file or remaining stub before revisiting existing content. Existing code is not evidence that tests passed; dependency and manual check-confirmation rules remain intact.
- Validation: 760 automated tests passed. Editor-host tests exercised the visible first-file guide, no model on open, brief help, JSON generation and Keep, remaining-stub navigation, isolated file chats, stale actions, edits during generation and invalid JSON. Existing file-chat and build-guide regressions passed. The social-media project was only read. Local acceptance remains pending.

## 0.0.36 alpha — 2026-11-02

- Fixed saved planning turns treating a selected “Decide for me: I'd add…” choice and a subsequent “ok do it” as read-only. Concrete choice selections and natural approvals of the immediately preceding edit offer now authorize a reviewed proposal without requiring a rewritten slash command.
- Unrelated acknowledgements, older offers, explicit no-change instructions and opening a planning stage do not authorize edits. Generic code turns still cannot use these acknowledgements to rewrite a different planning document. Keep remains required.
- Validation: 757 automated tests passed. An editor-host replay exercised the reported delegated choice and natural approval, confirmed both produced proposals, verified no save before Keep, and rejected a replacement during an explicit read-only check. The existing plan-stability editor-host suite also passed. The actual social-media project was only inspected; the missing publish_failed pause behavior in its architecture remains a separate planning discrepancy with FR-011.

## 0.0.35 alpha — 2026-11-02

- Fixed the long-tree generation loop: saved planning files are supplied whole within the model context budget, and remain available across project checks. Tree JSON is compacted without dropping entries or properties. Documents that exceed the budget are explicitly identified instead of presenting a truncated beginning as a complete baseline.
- An explicit planning write request already authorizes preparation. If the model nevertheless asks for “continue” or another Generate click, the host makes one bounded correction in the same run, preserving the correction through further retrieval. Repeated deferral reports failure without claiming a document is ready; genuine missing decisions and read-only discussions remain separate.
- Validation: 754 automated tests passed. A real editor-host fixture used a saved tree over 30,000 characters, retained all 150 entries through repeated checks, recovered a premature “continue” reply, and produced a full Keep proposal from one Generate request. Keep preserved existing source and both prerequisite documents. The reported project's complete planning context was checked read-only and fits the selected Claude model's budget. Existing planning retrieval and plan-stability editor-host regressions also passed. Live model acceptance remains pending.

## 0.0.34 alpha — 2026-11-02

- Flow now plans complete implementations across focused files before scaffolding, estimates final source sizes with headroom, and explicitly splits responsibilities expected to exceed 300 lines. The limit never authorizes omitted behavior or compressed formatting. Estimates remain forecasts that may need revisiting during implementation.
- Tree JSON can include buildPlan version 1 with a real application/library entry point, dependency-aware steps, assigned files, implementation tasks and observable checks. Validation rejects oversized/missing source estimates, invalid references, duplicate assignments and dependency cycles when guidance is supplied. Legacy trees remain valid and are not silently regenerated or downgraded.
- Project now offers Start here and a native Build guide. The guide orders libraries before consumers, distinguishes the runtime entry from the first build step, lists each step’s files/tasks/checks, and opens files in their own chats. Existing trees offer an explicit reviewed upgrade through Flow. File chat and inline snippets receive the saved step’s guidance.
- Build progress is separate from the tree in .my_editor/build-progress.json. Confirm checks passed records explicit user evidence for the exact step, source and prerequisite versions; missing/dirty files and unchanged stubs cannot be confirmed. Later source or step changes invalidate confirmation and block dependants. File status alone never claims tests passed.
- Run a configured test task lets the user select an existing VS Code test task. Model-written check text is displayed as guidance and is never executed automatically. Task exit alone does not prove that every step check passed; the user confirms the listed expected outcomes. Project Build status reflects step confirmations when guidance exists.
- Validation: 745 automated tests passed. A real editor-host test exercised dependency-first navigation, a real passing Node test task, stub rejection, explicit progress recording, source-edit invalidation, and a reviewed legacy-tree upgrade that preserved requirements and architecture. The existing planning editor-host regression also passed. User acceptance remains pending.

## 0.0.33 alpha — 2026-11-02

- Inline class generation uses the remaining space under the 300-line source-file limit instead of a separate 100-line snippet cap. It preserves every surrounding byte, including the planned header and existing exports.
- Empty output, unfinished fences, multiple blocks, omission placeholders and line overflow now have distinct errors. Fences are parsed by full lines so backticks inside source strings do not cut snippets short. The one-class-per-file policy is checked before opening a proposal.
- Invalid responses get one automatic correction attempt with the precise failed check. Source edits, cancellation and provider failures stop generation without retrying; a second invalid response cannot become a proposal. Redacted replies are retained in the AI snippets output channel with a View response action.
- The prompt preserves APIs named in the file header (including a promised factory when implementing it with a class), asks for all methods and error handling, and recommends types/interfaces for typed errors instead of extra classes.
- Validation: 741 automated tests passed. A disposable editor replayed the reported client.ts stub with a deterministic 111-line class, reached Keep, recovered from an omission response, rejected a second invalid response and preserved a concurrent unsaved edit. The user's actual client.ts was only read; its original rejected response was not retained by the previous release, so the exact failed check cannot be recovered.

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
