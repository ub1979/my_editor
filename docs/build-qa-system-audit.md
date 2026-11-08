# Production hardening follow-up — 8 November 2026

Authorized scope: editor fixes and disposable acceptance only. Social-media QA and monitoring stay off. No permission expansion, Keep/Undo bypass or repair-budget reset.

Confirmed causes and changes:

- `requestPolicy` treated narrow invariant constraints (such as preserving source-size policy) as global edit bans, and did not recognize “Continue implementing”. Normalize explicit continuation requests and a bounded set of preservation constraints. The real-editor regression also exposed the missing imperative “patch”; accept it while preserving explicit “do not patch” and “without patching” prohibitions. Prior “read-only inspection verified” is evidence wording, not a current prohibition. Global and conflicting edit bans remain read-only. These are intent classifications, not permission grants; every host tool still applies its existing authorization and proposal controls.
- `parseTestRepairs` classified a missing TEST_REPAIRS envelope as unrecoverable, unlike malformed JSON. It now permits the existing one format correction for prose-only output, with unchanged source/scope/evidence validation. Genuine BLOCKED replies still stop immediately. Repeated invalid responses stop after the one correction.
- Verification already executes focused repairs before unrelated reviews and stops an immediately unchanged failure. Add a history check to stop alternating failures returning to an earlier command fingerprint despite fresh source hashes. Preserve total five-round guard, selected model, command authorization, build prerequisite ordering and final complete-verification gate.

Validation completed before installation:

| Gate | Executable evidence |
| --- | --- |
| Final compile and unit tests | 848 passed, zero failed/skipped; `/tmp/editor-hardening-compile.log`, `/tmp/editor-hardening-unit.log` |
| Consolidated built-in host suite | Real failure→repair→pass, unchanged and alternating failure stops, source freshness, permissions and final gate; `/tmp/my-editor-integration.zT684Q/report.json` |
| Final consolidated native OpenCode suite | Passed sequentially through 299 native sessions, executing the same fixtures including recurring-failure stop and bounded prose-only diagnosis correction; `/tmp/my-editor-integration.SuByEM/report.json`, `/tmp/editor-hardening-opencode-final.log` |
| Final constrained editing | Real exact-edit proposal for “patch…Do not change source-size policy…Read-only inspection verified…”; Keep saves it; `/tmp/my-editor-integration.PyOeOA/report.json` |
| Final explicit read-only refusal | Three independent planning agents read current source; attempted writes refused, no proposal or generated plan; `/tmp/my-editor-integration.1lnuor/report.json` |
| Real selected model | Codex GPT-5.6-Sol reproduced failure, left source untouched before Keep, discarded Undo, reproposed, Kept and passed unchanged original tests through both runtimes. Four test permission prompts retained; `/tmp/my-editor-integration.UtWU1v/report.json` |
| Native runtime contracts | Nine cases passed, including auth/native-tool refusal, exact one-use receipts, unavailable-model stop, cancellation and owned-state cleanup; `/tmp/editor-hardening-runtime.log` |

The constrained-edit host test initially exposed the missing imperative “patch” and stopped safely; this was fixed together with explicit patch prohibitions and retested. The first long native run stopped on bounded OpenCode startup timeout while other isolated profiles ran (`/tmp/editor-hardening-opencode.log`). Sequential full acceptance then passed without changing production timeouts or adding automatic startup retries. Contention is a hypothesis, not a proven cause; multi-window load reliability remains unproven. The original failed profile/report is retained at `/tmp/my-editor-integration.S3UB40/report.json` and the timeout profile at `/tmp/my-editor-integration.tdJAEF`.

Candidate source/compiled hashes are recorded in `/tmp/editor-hardening-final-source.json` and were unchanged at acceptance completion. The three changed production source files have 80, 56 and 93 lines. These checks establish the demonstrated fixes and host safety boundaries on this macOS environment; they do not establish long-duration reliability, all specialist output quality, cross-platform behavior or independent security certification. Installed 0.0.85-alpha.0 after UI Quit; code signature, all ten product checksums and compiled/installed extension equality passed. Home UI shows 0.0.85 alpha. Reopened socail_media without Resume. Full persisted Build/QA state and exact settings bytes match the pre-test snapshots: paused, same selected Codex model/OpenCode backend and permissions. The existing preview was stopped and restored only through my_editor’s terminal. No application source edits, broad QA restart, monitoring, guard reset, commit or push occurred. Installation evidence: `/tmp/editor-hardening-install-verification.json`; log: `/tmp/my-editor-install-85.log`.

---

# Focused application acceptance — 8 November 2026 (final checks verified)

The user subsequently authorized application repairs through my_editor using its OpenCode backend, with immediate focused verification and final checks. Broad QA remains paused; no Resume, five-round reset or recurring monitor is used. This work does not change the installed editor. Keep review, selected `codex-cli:gpt-5.6-sol`, permission boundaries and application ownership remain intact.

## Evidence and findings so far

- Reproduction rebuilt dependencies before tests: block-kit Resume still returned 415 rather than the required 400; X Connector's routes and Launcher compilation passed against current saved source. my_editor proposed the minimal content-length/transfer-encoding check and Keep saved it. `opencode-block-kit-after.log` has 154 passing tests; X Connector has 104 passed/two live skips and Launcher initially 59 passed/eight isolation skips.
- Full compilation found `HeadersInit` in two server adapters and a missing `AiUnavailable` result alternative in Composer. Three proposals were kept, then both packages passed build/typecheck/test (`opencode-compiler-repair-*.log`). Root build/test, all-package typecheck and lint passed at 02:20 (`opencode-final-tests-verified.log`, `opencode-final-typecheck-verified.log`, `opencode-final-lint-verified.log`): 1,638 passed, ten skipped. This snapshot predates subsequent startup repairs and is not the final acceptance evidence.
- Explicit local isolation execution failed at fresh NATS startup. Installed JetStream 3.4.0 represents stream-not-found as `JetStreamApiError` with numeric code 10059, not the obsolete shapes mocked by the test. my_editor changed the classifier and tests to the actual exported SDK class while retaining unrelated error propagation. Build/typecheck and 58 Launcher tests pass (`opencode-nats-*.log`).
- The next single isolation case demonstrated Interface's build had never emitted its server: `tsconfig.json` included nonexistent `src/` paths instead of `server/` and `web/`. Correcting that configuration exposed three genuine compiler defects. my_editor proposed byte-preserving Blob input copying, standard NavLink active accessibility behavior and an AI-settings type alias. Kept changes pass real Interface build/typecheck and all 61 tests (`opencode-interface-*-verified.log`). Strict checks were retained.
- Subsequent isolation retry failed with EADDRINUSE. Eight orphan services from these exact tests were confirmed by start time, PPID 1, repository cwd and ports; the supervisor killed package-manager wrappers without their descendants. Exact PIDs were sent TERM through my_editor's terminal. A first lifecycle proposal that could silently succeed after incomplete cleanup was explicitly Undone. The corrected kept proposal uses detached owned POSIX groups, bounded TERM/KILL, retained ownership and rejection on incomplete cleanup, all-settled shutdown, explicit stopBlock delegation and wrapper `exit` handling independent of pipe `close`. The isolation test preserves its health/unavailable assertions and calls the owned stop API. One real startup/stop case passed, followed by **all eight isolation cases passing at 02:51 UTC**, with no NATS/service listeners remaining (`opencode-launcher-isolation-all-verified.log`). A native request interrupted by `fetch failed` left three reviewable proposals intact; these were reviewed/kept and only missing tests were requested again. The nine supervisor unit cases and a real disposable wrapper plus TERM-resistant descendant regression passed; both exact PIDs disappeared and shutdown resolved. The added real-process case also passed in the final full suite.

Native session evidence includes `02-14-50-548Z-d9d741d147b2` (Resume), `02-18-00-918Z-734a044f2b5a` (compiler repairs), `02-26-48-273Z-fa4e7756e6ad` (NATS), `02-31-27-352Z-5bea3911b4b5` (Interface build paths) and `02-32-53-218Z-e4f54cdcc19b` (Interface types) in the application's investigations directory for 2026-11-08. Each records an OpenCode 1.19.3 native session and host `propose_edit` calls. All application commands were entered in my_editor's terminal; the external shell only inspected application state/source/logs.

Lifecycle evidence continues with `02-42-44-623Z-9c5413c9532e` (corrected supervisor), `02-52-51-778Z-88f6730d8dc7` (unit regressions), and `02-55-24-902Z-a53e480f19cd` (real-process regression). The latter uses native session `ses_e46ec3185ffe02o5V6pZ3S4Eqp` and host `propose_file`; Keep saved the new test. The interrupted batch has UI-retained proposals but no completed investigation record; it is not presented as a clean completed model turn.

## Final executable evidence

All paths below are relative to `/Users/u/funcoding/social_media/socail_media/.my_editor/test-runs/`.

| Check | Result | Log |
| --- | --- | --- |
| `pnpm test` (root build prerequisite, then all package tests) | All 13 package builds and all 13 test commands completed; 1,644 tests passed; `VERIFY_EXIT=0` | `opencode-acceptance-final-tests.log` |
| `pnpm run typecheck` | All 13 package typechecks completed; `VERIFY_EXIT=0` | `opencode-acceptance-final-typecheck.log` |
| `pnpm run lint` | File-length check passed; `VERIFY_EXIT=0` | `opencode-acceptance-final-lint.log` |
| Explicit Launcher isolation | All eight actual service startup/stop/sibling-health cases passed on the same production source | `opencode-launcher-isolation-all-verified.log` |
| Actual wrapper/descendant lifecycle | Passed individually and again in root suite; TERM-resistant descendant removed, shutdown successful | `opencode-launcher-real-processes.log` |

The final root checks ran at 02:56 UTC and were verified at 02:57 UTC. The standard suite reports ten skips: eight isolation checks are opt-in but passed separately; **two live-X checks remain skipped and unverified**, including real posting. No real post was authorized or made. Local fixtures and health/isolation execution do not establish manual browser journeys, live-account compatibility or production deployment acceptance.

The 272 source/config files captured immediately before final checks have identical SHA-256 values afterward. The complete read-only persisted Build/QA state equals `/tmp/my-editor-opencode-paused-before.json`: status paused, selected `codex-cli:gpt-5.6-sol`, existing unattended permissions and five-round state are unchanged. The settings hash excluding runtime keys remains `2d3c37c923160851d622efff875baf6e527383f9b735bf4c25d8859912067c3f`. The UI is idle with no pending Keep proposal. No NATS/service listeners remained. The historical checkpoint still says failed because this focused verification intentionally did not Resume or overwrite that run. No recurring monitor, editor reinstall, permission expansion, commit or push occurred.

Evidence manifest: `/tmp/social-media-opencode-acceptance-verification.json`; source snapshot: `/tmp/social-media-opencode-final-candidate.json`. Log SHA-256 values:

- Final root build/tests: `5d9d430d80b8fc632334217d4b1219b8e5375e60760f303c4cefc83449af4c2d`.
- Final typecheck: `3b248e4182094952663c84ef16476fe62d14c675f33b41ac5c9edf63cb648fd6`.
- Final lint: `03f0b88418404f909e1a8d0bb84cee4b98db1d21f1ec25307537b915b780b9`.
- Eight isolation cases: `5c2d746902c93e31d16e7a5b7a1499a9301d7cdb4e2f0b9322f66ba01479fa4c`.
- Standalone actual descendant test: `7ae7611b7623ca2dc6de80c468871430c49930e696b14065669c64c7a51b09d2`.

Two editor workflow limitations observed for later consolidation: project-chat `run_tests` does not accept scoped build/type/lint commands, so these checks used the authorized editor terminal; a prompt containing “read-only” anywhere can classify an otherwise explicit repair request as read-only. Neither guard was bypassed or patched during application acceptance. No integration quality/speed comparison is inferred from this one application run. Live-X tests, including the real-post test, remain unexecuted.

---

# OpenCode integration acceptance — 8 November 2026

The user authorized integrating OpenCode for project agents, preserving Keep/Undo and existing permissions, and keeping social-media QA paused. Version **0.0.82-alpha.0** implements that adapter. The five-minute `monitor-my-editor-build-and-qa` heartbeat was deleted through the automation API after the user requested its removal; it must not be recreated.

The pinned **OpenCode 1.19.3** native server runs the model/MCP action cycle in a private owned session. Its only tool redeems an authenticated one-use ticket validated and executed by my_editor. The exact selected model still uses my_editor's provider adapter; no credential migration or silent model/runtime fallback occurs. Scope, dirty buffers, source freshness, proposal review, command approvals, bounded recovery and completion rules remain with the editor. Native filesystem/shell/web/subagent tools and inherited plugins/configuration are disabled and the effective configuration is checked before work. The host still supplies bounded context and reasoning instructions; this does not replace the strategy with OpenCode's prompts, compaction or subagents.

## Verified evidence

- Combined real-editor Build/QA fixture passed through **291 native OpenCode sessions**: `/tmp/my-editor-integration.WvoD5L/report.json`, `/tmp/my-editor-opencode-project-build-final.log`. It executes actual failures, coherent repairs and passing reruns, stops unchanged failures, and retains the final full-verification gate, scope, Keep/Undo, freshness and existing consent checks.
- Independent agent chats, standalone specialists and planning approvals passed through the native backend: `/tmp/my-editor-opencode-agentChats.log`, `/tmp/my-editor-opencode-standaloneSpecialists.log`, `/tmp/my-editor-opencode-planningApprovals.log`.
- The same authenticated **codex-cli:gpt-5.6-sol** model reproduced and repaired a failing arithmetic test using both backends. Both exercised Undo, Keep and actual passing tests without changing the tests or package manifest. Built-in took **44.393 s**, OpenCode **54.392 s**, with four turns each. This is compatibility evidence from one small task, not a speed or quality advantage: `/tmp/my-editor-integration.oYUn1r/report.json`.
- Final lifecycle changes wait for native completion and cancel host model/tool work when the owned runtime fails. These changes were made after the full combined run and checked with the full unit suite, actual-runtime contract suite, and targeted real-editor crash/cancel/restart and editing fixtures. Native crash aborts a pending model request, New Chat cancels another request, no fallback/source mutation occurs, and a fresh session succeeds: `/tmp/my-editor-integration.zf65Ns/report.json`.
- The final focused-helper fixture passes inline insertion/Keep, Python selection persistence, review, source context, file creation and reviewed deletion: `/tmp/my-editor-integration.Szs7Zv/report.json`. Earlier runs intermittently failed during Python interpreter discovery before any OpenCode project calls. The disposable fixture now selects `/usr/bin/python3` explicitly; competing Conda/Homebrew auto-discovery remains outside this acceptance claim. Production Python code and user settings were not changed.
- Compilation and **844 unit tests** passed with no skipped tests. Nine actual-runtime cases passed, including malformed responses, action budget, unavailable model, cancellation/late results, restart, version rejection, auth/native-tool refusal, one-use tickets and owned-state cleanup: `/tmp/my-editor-opencode-unit-final.log`, `/tmp/my-editor-opencode-runtime-final.log`. New runtime source files are 23–162 lines.

## Deployment and limits

Installed **0.0.82-alpha.0** once after UI Quit (`/tmp/my-editor-install-82.log`). Verified the installed code signature, all **10** product checksums and equality of the installed extension with the compiled candidate. The Home UI displayed the new version. Reopened socail_media and selected OpenCode through **Choose Project Agent Runtime**; the Settings UI confirms `opencode`.

Read-only verification confirms the entire saved Build/QA state equals the pre-integration snapshot, including **paused**, `codex-cli:gpt-5.6-sol`, the failed checkpoint and all unattended options. The user settings hash excluding the two runtime setting keys is unchanged (`2d3c37c923160851d622efff875baf6e527383f9b735bf4c25d8859912067c3f`). The monitor file is absent. Evidence: `/tmp/my-editor-opencode-installed-verification.json`. The UI confirms paused with the same model and saving/execution description. No Resume, application command/repair, new permission, guard reset, commit or push occurred.

No social-media acceptance, browser journey, external service, general semantic quality improvement or faster execution is established by these checks. The application still retains its prior failing checkpoint. Its continuation remains a separate step; the integration does not justify another broad QA loop without reproducing and verifying the demonstrated causes.

---

# Agent strategy audit — 8 November 2026

## Current decision and pause boundary

The user stopped the application run and heartbeat, then authorized an audit and systemic fixes to my_editor. The social-media application remains paused. This work does not restart QA, edit application sources, run application commands from the shell, change its model, raise its five-round guard or enable additional run permissions.

The earlier audit below found real boundary defects but was not sufficient: it tested recovery mechanisms without establishing an efficient verification strategy. The live run demonstrated that accepting source changes and completing file reviews could consume hours while the same executable failures survived. Editor unit totals and deterministic fixtures do not establish agent quality or application acceptance.

## Shared discussion and current implementation

Reference supplied by the user: https://chatgpt.com/s/cx_6aefc631f39881918e6c38f9ce77c80a (read through the browser on 8 November).

Confirmed in the current source:

- Eight independently selectable specialist conversations and working briefs share a custom TypeScript engine; they are not separate installed Claude agents. Requirements/Architecture/Flow have document workflows, while Build/QA also use a persistent host controller.
- Manual editing, #AI insertion, file explanation, focused selection/file edits and project investigation follow different paths. Their scope and Keep/Undo guarantees must survive any backend change.
- Small write scope currently limits investigation capabilities in focused editing modes. A new runtime must support read investigation independently of write scope; expanding writes is not the solution.
- Document validators establish shape, IDs and provenance more strongly than semantic quality. A valid citation is not proof of implementation correctness.
- Formal document generation has prerequisite gates. Standalone read-only specialist analysis should work from current code and an explicit brief, with missing evidence and assumptions identified.

The discussion's final runtime recommendation was an **OpenCode trial for project agents**, retaining focused helpers and editor authority. It revised an earlier Hermes-first suggestion. It did not demonstrate that either runtime improves output quality. Replacing the runtime does not replace my_editor's completion contract.

## Root causes and consolidated correction

| Observed behavior | Cause in host control | Implemented correction |
|---|---|---|
| Tests passed against stale workspace outputs or exposed compiler errors only late | Checkpoint discovery selected tests, not a dependency-ordered verification plan | Discover explicit build/type/lint/test commands. Order workspace builds by declared package dependencies; prevent dependent tests from running against a failed build. Retain each command and log independently. |
| Many file reviews before discovering the first actionable failure | Standalone unattended QA began with broad file review | Establish executable baseline first, then prioritize a demonstrated failure before unrelated QA. |
| A repair batch finished but unrelated reviews resumed before proving the fix | File completion and execution were separate distant phases | Persist a repair verification cursor; verify the selected command, affected package checks and build prerequisites immediately after its coherent repair batch. A focused pass cannot replace final full verification. |
| Additional tests/comments earned another round while the same failure remained | No-progress guard compared source hashes only | Compare stable failure evidence before/after a repair as well as source progress. An unchanged demonstrated failure stops before another automatic cycle. Keep the five-round total guard. |
| Unverified runs could finish; edited files displayed as fixed | Completion was a review queue state, with tests merely described | Require passing execution for completion. Show edits saved separately from check results. Keep before/after repair evidence in reports. |
| Resume could do nothing when a completed result appeared just before the testing flag cleared | Persisted results were visible before the active checkpoint finished cleanup | Await the active checkpoint at Resume; preserve a user pause and reject running work. |
| Changed files invalidated every later review by array position | QA resume truncated the results suffix | Invalidate changed file snapshots individually; retain unrelated reviews. Full verification still runs before success. |
| Standalone Architecture/Requirements/Planning inspections inherited document-generation prerequisites | A role and document output mode were coupled | Explicit read-only requests use specialist inspection objectives with current-source checks, no document write and no prerequisite document generation. Formal build planning retains its gates. |

New unattended authorizations name build/type/lint/test execution explicitly. A saved tests-only run does not silently gain these commands; it remains unverified until its user chooses execution permissions. Manual runs offer a concrete required-check list. One selected passing command cannot cover other required commands.

## OpenCode integration decision

Installed local binary discovered read-only: OpenCode **1.19.3**. No model call or application access has been delegated to it. Official documentation checked on 8 November:

- https://docs.opencode.ai/docs/server/ — headless server, localhost binding, HTTP authentication, session and event APIs.
- https://docs.opencode.ai/docs/sdk/ — TypeScript client and generated API types.
- https://opencode.ai/docs/permissions/ — V2 uses a different permission schema/action vocabulary from V1. Version-specific enforcement must be tested rather than inferred.

Keep the existing frontend and specialists. Put a replaceable project-execution adapter behind the current engine boundary. my_editor owns: exact read/write scope, unsaved buffers, source snapshots, proposed diffs, Keep/Undo, selected model, credentials, command approvals, cancellation and verification results. The external runtime owns: isolated task/session execution and tool sequencing within that contract. It must not receive unrestricted workspace write/shell authority or silently reuse a different model/provider.

Promotion gate for an actual OpenCode adapter: pin runtime/API version; isolate project/config/session state; bridge host tools or stage in an isolated copy; route proposed edits through current source guards; reject unknown permissions; map Stop to session abort and owned process cancellation; demonstrate selection boundaries, dirty buffers, independent chats, model-unavailable behavior and restart safety. Compare existing and candidate runtimes using the same task/model/budget where supported. Codex CLI subscription/model compatibility is an explicit unresolved integration check, not an assumed mapping to an OpenCode provider.

This batch addresses host verification first. No OpenCode default switch, credential migration or claimed completed integration is made.

## Release evidence

Version **0.0.81-alpha.0** is installed. Compilation and all **841 editor tests** pass, with no skipped unit tests (`/tmp/my-editor-strategy-compile.log`, `/tmp/my-editor-strategy-unit.log`). A compiler-dependent existing Go fixture failed in the restricted shell; it and the full suite passed with normal compiler/cache access, without weakening assertions or changing Go implementation.

The combined disposable real-editor suite passed (`/tmp/my-editor-strategy-integration-final.log`, `/tmp/my-editor-integration.AcOqa6/report.json`). It supplies a stale passing compiled artifact while source fails, requires rebuilding and reproduction, accepts a scoped model-proposed repair, and verifies actual passing consumer execution. Its comment-only repair stops on the same executable failure before unrelated QA. It also checks build-prerequisite blocking, a successful build-only focused repair followed by the full-verification requirement, actual saved repair paths, source/configuration freshness, legacy consent, interruption, unavailable selected models and the existing evidence/scope controls. The last no-emit/typecheck classification adjustment is covered by the full unit suite; the combined fixture's explicit-build scenario is unchanged.

Separate real-editor fixtures passed for independent Requirements/Architecture/Planner inspection with missing planning documents and refused writes (`/tmp/my-editor-integration.hlPpRf/report.json`), isolated conversations (`/tmp/my-editor-integration.WcnzT4/report.json`) and natural planning approvals/Keep/read-only boundaries (`/tmp/my-editor-integration.EMIKRD/report.json`). Changed source and fixture files remain below 600 lines.

Installed once after UI Quit (`/tmp/my-editor-install-81.log`); verified the code signature, all 10 bundle checksums and installed extension equality with the compiled build. The installed Home UI displays 0.0.81 alpha. Reopened socail_media and confirmed **Build: paused**, with the selected codex-cli:gpt-5.6-sol model and prior permissions preserved. The heartbeat remains PAUSED. No application repairs or commands were performed by this task, no run was resumed, and no completion claim is made for the application. Its retained checkpoint remains 11 passing/3 failing commands.

Browser journeys, live external services, opt-in skips, semantic requirements/design quality, durable task rollback and production OpenCode integration remain separate unverified capabilities. They must not be implied by this release's tests.

---

# Build/QA system audit — 7 November 2026

## Purpose and release rule

The earlier process installed successive fixes for blockers discovered by the live social-media acceptance run. Passing editor unit tests and small fixtures were reported too prominently while application acceptance remained incomplete. This audit reviews the pipeline as a system, defines one bounded remediation batch, and requires its integrated fixture to pass before one installation. New routine findings belong here, not in a stream of user notifications.

The application remains owned by my_editor: no direct application edits or shell commands. Preserve the selected run model, existing permissions, decisions, unrelated workspace changes, and the 600-line source limit. Do not commit or push.

## Reviewed boundaries and findings

| Boundary | Evidence | Disposition in this batch |
|---|---|---|
| Planning and contract decisions | `filePassRepairs.ts` uses exact prose quotations, which already caused several formatting/source retries. A matching quotation proves provenance, not semantic correctness. | Add content-addressed decision references drawn from current saved sections and developer answers, retaining legacy quote validation. Unknown or changed references must fail; references never authorize new file scope. |
| Context selection and freshness | `fileEvidence.ts` resolves current relative imports and workspace exports, but wildcard exports are unresolved; same-basename tests in unrelated packages can take priority. `filePassReview.ts` validates dependencies before review, while delayed Keep only rechecks plan/target. | Resolve wildcard workspace exports, scope same-name tests to the owning package, label unresolved aliases and bounded discovery, and revalidate dependencies at the actual Keep boundary. |
| Model ownership | `engine.ts` silently falls back to the default when an explicitly selected model is absent. | Fail explicitly instead of changing the run model. |
| Checkpoint evidence | `filePassTests.ts` concatenates all results; diagnosis retains only the last 40 KB. Early failures can disappear behind later passing output. | Keep typed per-command results and build a bounded diagnostic bundle that includes every command/status/log path, prioritizing failures. Preserve full logs. |
| Recovery and lifecycle | 0.0.74 added bounded test-driven repair, source-progress guards, cancellation and plan checks. The new fixture only proves one failure and one repair cycle. | Extend combined real-editor coverage to mixed command results, stale review-time dependencies, decision-reference invalidation, and genuine failures remaining incomplete. Retain restart, cancellation, scope and permission regressions. |
| Verification scope | Detected test commands do not automatically cover production builds, browsers, opt-in integration tests or external services. Unit-test totals do not establish application correctness. | Keep those limits explicit. Do not enable broader command permissions implicitly or declare full application acceptance from file counts/model conclusions. Final live evidence remains required. |
| Context/model limits and environment | 600 lines is a source maintainability rule, not a guarantee that every dependency fits. Dependency installation/native ABI issues need environment-specific handling. | Keep expandable retrieval and honest omitted-source labels. Preserve completed dependency approvals; do not silently install packages or invent a blanket no-error guarantee. These are recorded operating constraints, not hidden completion claims. |

## Acceptance gate

- Compile and all editor tests pass; changed source/fixture files stay below 600 lines.
- Real-editor fixture executes failing processes, diagnoses from actual retained output, repairs only authorized files, reruns and verifies passing execution.
- Unknown/stale decision references, dependency changes during review, unavailable selected models, unauthorized repair targets, no-progress loops, cancellation and source changes during tests cannot become success.
- Mixed pass/fail output retains the early failure and every log reference within a bounded context.
- One tested installation, signature/checksum verification, then UI resume with the same model and permissions.
- Social-media QA and final application checks must actually finish and pass before acceptance is called complete; list skipped/unverified checks.

## Status

Review and consolidated remediation complete for the listed boundaries. Compilation, all 834 unit tests and the combined real-editor acceptance suite pass (`/tmp/my-editor-75-unit.log`, `/tmp/my-editor-75-build.log`). The single consolidated 0.0.75 update is installed, with signature and all 10 bundle checksums verified. The existing application run was resumed through the UI with its model and permissions preserved. Live application QA/final tests remain the outstanding acceptance gate; fixture success is not application success.

## Live acceptance observation — 21:04 UTC

After the Mac became accessible, UI Resume retried NotificationsPanel.tsx. The model supplied a section decision reference together with a shorter quote from within that section; the strict reference/full-quote consistency check rejected it. No application change was applied by us and no new product decision was inferred. One UI retry is running against current saved evidence. If this repeats, inspect citation recovery as a single bounded follow-up against the release gate rather than weakening provenance or installing an untested patch. QA remains at 212/228 completed reviews; final application checks have not run.

## Bounded citation follow-up — 21:09 UTC

The same failure reproduced on the one UI retry. Read-only inspection confirmed the cited hash identifies the current Block kit package section and its supplied quote is verbatim inside that section. The defect is the host requiring an optional pinpoint quote to equal the entire section. The correction validates a contiguous normalized excerpt only within the addressed section, then materializes the entire section for both worker and controller so qualifications are retained. It does not allow partial developer answers, another section’s quote, changed/unknown references, invented words, changed punctuation or noncontiguous matches. Recovery now explicitly recommends omitting the redundant quote. Regression coverage includes these rejection boundaries and a real coordinated repair that recovers from a wrong source, uses a section excerpt, retains full context and reaches actual passing tests. Compile and all 835 unit tests pass; the combined disposable editor release gate passed (`/tmp/my-editor-integration.H5kw4b/report.json`), including actual test processes and worker/controller quote materialization. No application files or application commands were changed/run by this agent.

## Final-checkpoint scope follow-up — 21:49 UTC

All 229 QA files were reviewed, then the 14 actual test commands found failures. The model diagnosis correctly named late companion tests (launcher/main, AI-provider/main and db, Approval Queue/routes) that existed on disk but were absent from the initial QA module snapshot. The test-repair path lacked the fresh companion-test discovery already used by coordinated repairs. It now rediscovers eligible existing tests for whole-project QA before diagnosis and includes them in repair scheduling and source-progress signatures; selected-file runs and arbitrary unplanned production files do not gain scope. Actual per-command outcomes are persisted before long diagnosis, checkpoint activity is visible, and rejected repair targets name their path. These observed issues are tested together; the bounded fixture adds a companion during QA, executes its failure, diagnoses it in authorized scope and reviews it on the passing rerun. Final application failures remain unresolved until my_editor repairs and retests them.

## QA directory ownership follow-up — 22:42 UTC

Composer’s duplicate-event regression requested a new forward migration under the explicit saved subscriber idempotency requirement. The directory contained the planned 001 migration in Build the Composer and the previously approved 002 migration in Other project source, so the owner check confused an inventory group with a second architectural owner. Resolve to the sole saved-plan owner where one exists; keep rejection when two planned modules claim the directory or multiple discovery groups have no planned owner. The exact new production-file approval remains required. Unit boundaries and the combined real-editor fixture cover a QA-requested migration beside planned and discovered siblings, explicit approval, unchanged plan and passing final fixture tests. Application repairs remain with my_editor.

Release gate passed: all 836 editor unit tests, compilation and the combined disposable real-editor suite (`/tmp/my-editor-integration.VGxFhw/report.json`). Installed 0.0.78 after UI Quit, verified signature and all 10 checksums, reopened and resumed the application QA run with its model and permissions preserved. Application final tests remain failing until my_editor completes repairs and a passing rerun.

## Bounded diagnosis protocol follow-up — 23:18 UTC

All 273 reviews finished and actual tests improved to six passing/eight failing commands. The model returned more than the parser’s 20-file repair limit, which its prompt had not stated; this stopped before scheduling a second repair round. Make the bounded protocol explicit, prioritizing coherent root-cause/regression batches, and allow one format correction against the same current scope, source-freshness checks and retained failure evidence. Do not trim targets silently or convert genuine BLOCKED responses into speculative work. Typed parse failures distinguish format errors from real blockers. The combined fixture must exercise an oversized response corrected into an actual failing-to-passing repair, repeated unauthorized targets stopping after one correction, and a genuine environment blocker stopping without retry. Full release gate required before installation.

The full release gate passed: compilation, all 837 unit tests and combined disposable suite `/tmp/my-editor-integration.DFKkly/report.json`. Version 0.0.79 installed after UI Pause/Quit with signature and all 10 checksums verified, then UI Resume started the 14-command checkpoint at 23:22 UTC. Model and unattended permissions remain unchanged. Application final acceptance remains incomplete.

## Read evidence size follow-up — 8 November, 00:23 UTC

The fourth repair round’s next diagnosis read the generated lockfile successfully through the 400 KB read_file tool, then freshness validation rejected that same evidence using the 80 KB whole-file edit limit. Separate bounded evidence reads from edit-target reads: freshness may re-read and hash up to the existing tool-read limit; editable file size, path/symlink, dirty buffer, text and credential guards remain. A real-editor fixture reads a >80 KB dependency through the model tool, reaches review, then changes that dependency and verifies Keep cannot apply stale work. It also verifies the same file remains ineligible as a whole-file edit and evidence over 400 KB is rejected. Full release gate required before installation.

The application checkpoint also recorded lockfile drift after my_editor removed two Notifications development dependencies. Paused the checkpoint and used the previously authorized dependency synchronization in my_editor’s terminal (`pnpm install --offline --no-frozen-lockfile`); it reported already up to date in 109ms, with existing supply-chain policies passing and no downloads. No application source or application commands were changed/run from our shell. Remaining launcher type errors and application tests belong to my_editor.

Release gate passed: compilation, all 837 editor unit tests and combined real-editor fixture `/tmp/my-editor-integration.2mmP4n/report.json`. Installed 0.0.80 after UI Quit, verified signature/all 10 checksums, reopened and resumed at 00:29 UTC with the same selected model and unattended options. Application acceptance remains incomplete.


## Concurrent startup investigation — 8 November (candidate 0.0.86, validation in progress)

The original 12:10:22 startup timeout had no runtime output. The matching OS log for child 43172 contains only an early UID/account lookup at 12:10:07.825, before the usual SQLite/security initialization. This is a lead, not a sampled proof of the blocking frame. The child environment omitted HOME; supplying a private HOME removes that early lookup in a comparative probe. Both version probing and serving now use the owned private home/configuration/work directory. No user credentials or model permissions are added.

Pinned OpenCode 1.19.3 source also confirms that --port 0 first attempts 4096. This behavior creates unnecessary shared-port contention, but tests occupying that port did not reproduce the timeout. The candidate explicitly reserves an ephemeral loopback port and validates the full matching readiness line; the unavoidable reservation-release/bind race fails closed. The 15-second readiness deadline remains unchanged and no retry is added. Timeout/exit errors now expose elapsed time, output byte counts and allowlisted error codes, not raw output or credentials.

Initial four-worker native baselines passed 131 sessions over 120 seconds and 166 sessions over 180 seconds with 4096 occupied. Three concurrent real-editor baselines each completed ten minutes of actual read-only refusal, proposal/Undo/Keep and saved-file test execution while a fourth combined acceptance suite ran. The historical timeout has not naturally reproduced. All 852 unit tests and nine native contract cases pass. Two initial unit runs failed because the sandbox denied Go's user build cache; rerunning with GOCACHE in a disposable directory passed without editor permission changes. A first load-fixture smoke failed due to an omitted test-command argument, corrected before the baseline. Longer candidate load and final installation verification remain outstanding.

The original-code combined baseline did not pass: its 120-second test-harness phase deadline expired while status was still running at file 27/32 with six remaining and fresh passing runtime sessions. All 279 native startups were under 2.9 seconds. This is not the original 15-second startup timeout. Added an explicit 30–300-second bounded fixture-only wait override for concurrent acceptance; production deadlines/guards and default fixture waits are unchanged. The first candidate combined run is being stopped and restarted with the corrected load-harness budget; its partial execution is not counted as a pass.

Candidate lifecycle fault tests passed with real child processes: cancellation (553ms), silent startup (15,060ms at the unchanged production deadline), wrong listener (108ms) and simulated bind failure (100ms) all removed their owned child/profile; native startup also passed while an owned server occupied 4096. The first fault-fixture attempt failed only on macOS /var versus /private/var path spelling; the assertion was normalized and rerun.

The actual selected codex-cli:gpt-5.6-sol model passed a disposable failing-test → proposal → Undo → proposal → Keep → unchanged-test pass through both runtimes during concurrent load. All four test-command approvals were required and exercised; the original tests and manifest were preserved. Report: /tmp/my-editor-integration.KtX9Ur/report.json. This confirms compatibility and approval boundaries on the fixture, not broad semantic agent quality.

Pinned implementation reference: [OpenCode 1.19.3 port fallback](https://github.com/anomalyco/opencode/blob/v1.19.3/packages/opencode/src/server/server.ts) tries 4096 before an ephemeral port when passed zero. [libuv home-directory behavior](https://github.com/libuv/libuv/blob/v1.x/docs/src/misc.rst) documents HOME before the POSIX account lookup; the local comparative OS traces, not that generic documentation alone, support the missing-home lead in this incident. Raw local diagnostic evidence is retained in /tmp/editor-original-timeout-os.log and /tmp/editor-private-home-probe-os.log.

The three candidate real-editor soaks completed after 1,211–1,215 seconds each, with 64 full cycles per profile (768 native sessions total). Every cycle asserted read-only refusal, no saved write before Keep, Undo, Keep, a real passing saved-source test and a fresh test-command approval. All three process exits were zero; every recorded native child exited and every owned private profile was removed. Reports: /tmp/my-editor-integration.VLUU5E, /tmp/my-editor-integration.6telb9, /tmp/my-editor-integration.APAW79. A concurrent four-worker occupied-port stress added 84 native sessions over 185.8 seconds, all passing and cleaned; startup p95 1,649ms, maximum 2,613ms. Combined acceptance remains running; no installation yet.

Final candidate combined acceptance passed with process exit zero: /tmp/my-editor-integration.f7S4FE/report.json, 299 recorded native sessions/302 native startups. All execution, scope, source freshness, repeated-failure, malformed-diagnosis and final-verification assertions passed. Including the three soaks, selected-model comparison and occupied-port stress, 1,158 measured native startups succeeded; maximum readiness 2,613ms. Owned runtime cleanup and source hashes were verified. This is sustained macOS evidence, not proof of the historical stall's exact cause or indefinite/cross-platform reliability. The candidate's release gate is passed; installation verification follows. Structured evidence: docs/production-hardening-86-evidence.json.

Installed 0.0.86 through UI Quit and scripts/install.sh. Signature, all ten product checksums, tested source/compiled equality and Home UI version passed. After reopening socail_media, the full Build/QA state remains paused and byte-for-byte user settings match the pre-task snapshot. Restored only the existing preview through my_editor terminal and verified Accounts in the browser; the pre-existing unlinked account/optional fake-platform-unavailable state remains. No social source edits, QA Resume, recurring monitor, permission expansion, commit or push. Final installation evidence: /tmp/editor-load-86-install-verification.json and docs/production-hardening-86-evidence.json.
