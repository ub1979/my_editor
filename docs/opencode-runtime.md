# OpenCode project-agent backend

`my_editor: Choose Project Agent Runtime` selects **OpenCode** or **Built-in** for new project-agent turns. The default remains Built-in until explicitly selected. Changing this choice does not resume a paused Build/QA run or change its model or saving/execution permissions.

This adapter requires the installed **OpenCode 1.19.3** binary. The default executable is `~/.opencode/bin/opencode`; `myEditor.projectAgents.openCodePath` accepts an absolute user setting. There is no automatic download, upgrade or fallback. A missing or incompatible runtime stops with an error. Runtime settings are application-scoped so a workspace cannot redirect the executable.

## Ownership and boundaries

OpenCode runs a native headless session and its model → MCP action → model cycle. A localhost model adapter uses the exact model already selected in my_editor, including the existing Codex CLI subscription adapter. No provider credentials are copied into OpenCode and no OpenCode provider/model substitution is inferred.

The existing host supervisor remains authoritative for bounded source context, protocol validation, evidence, completion rules and tool budgets. The model adapter supplies that host context rather than OpenCode's accumulated conversation. This is a supervised backend integration, not a replacement of my_editor's reasoning prompts or context strategy; OpenCode compaction, native subagents and unrestricted workspace tools are not enabled.

OpenCode receives one authenticated MCP tool. It can redeem a one-use ticket for the exact action parsed by the host, after which the existing my_editor tool executor enforces scope, dirty-buffer and source checks. Native filesystem, shell, browser, web and subagent tools are denied. Test requests retain the existing approval path. File proposals retain Keep/Undo, including current-source revalidation at Keep and existing explicitly authorized automatic saving.

MCP receipts retain action counts and evidence hashes. Exact file/test evidence goes to the selected model through my_editor's bounded context and existing investigation records. This avoids accumulating a second full-source history in the native session.

Every turn starts an owned localhost process in a private temporary directory with a random server password and separate gateway token. User/project configuration, plugins, external skills and provider credentials are not inherited. Effective configuration is checked against the pinned runtime's normalized schema; unexpected managed configuration causes a stop, not a policy bypass. Stop aborts the session and owned process. Success, error and cancellation remove the owned runtime state. Separate agent conversations remain stored and isolated by my_editor, including across a fresh runtime turn.

Requirements, Architecture, Flow/Planner, Build, Review, QA, Debug and general project investigations use the project-agent boundary. Inline `#AI`, selection edits, file edits/explanations and other focused helpers retain their existing implementation and review UI.

## Startup isolation and diagnostics

The version probe and server receive an owned private HOME/USERPROFILE, working directory and XDG directories. They do not need to discover the user's home through the OS account service. The host reserves an ephemeral loopback port explicitly because pinned OpenCode 1.19.3 treats port zero as a preference for port 4096. Reservation and native bind cannot be atomic; a competing bind stops the turn rather than connecting elsewhere or retrying blindly.

Readiness requires the complete exact loopback URL on the announced port. The existing 15-second deadline remains. Failure diagnostics include stage, elapsed time, output byte counts and a small allowlist of OS error codes, without recording raw runtime output or credentials. Cancellation, invalid readiness and timeout terminate the owned child and remove its private profile.

## Acceptance checks

Run from `overlay/extensions/my-editor-core`:

```sh
npm test
npm run compile
node test/runtime/openCode.cjs
node test/runtime/openCodeStartup.cjs
```

The runtime fixture launches the actual pinned binary with a deterministic local model. It covers native MCP execution, bounded correction, the 60-action budget, unavailable models, cancellation with late results, isolated restart, version rejection, authentication, native-tool refusal, mismatched/replayed tickets and temporary-state cleanup.

From the repository root, the same real-editor fixtures can exercise either backend:

```sh
MY_EDITOR_INTEGRATION_SUITE=projectBuild scripts/test-editor.sh
MY_EDITOR_INTEGRATION_SUITE=openCode scripts/test-editor.sh
MY_EDITOR_INTEGRATION_SUITE=openCode MY_EDITOR_OPENCODE_SUITE=agentChats scripts/test-editor.sh
MY_EDITOR_INTEGRATION_SUITE=openCode MY_EDITOR_OPENCODE_SUITE=standaloneSpecialists scripts/test-editor.sh
MY_EDITOR_INTEGRATION_SUITE=openCode MY_EDITOR_OPENCODE_SUITE=planningApprovals scripts/test-editor.sh
MY_EDITOR_INTEGRATION_SUITE=openCode MY_EDITOR_OPENCODE_SUITE=coding scripts/test-editor.sh
MY_EDITOR_INTEGRATION_SUITE=openCode MY_EDITOR_OPENCODE_SUITE=openCodeLifecycle scripts/test-editor.sh
```

These use disposable profiles, projects and local deterministic models. The combined suite checks actual failing-to-passing tests, immediate verification, unchanged-failure stops, scoped repairs, Keep/Undo, evidence freshness, cancellation and existing permissions. OpenCode gets a longer bounded fixture deadline for starting a private process on every file turn; functional assertions and production repair limits stay the same.

`MY_EDITOR_OPENCODE_SUITE=openCodeCodex` additionally uses the existing authenticated `codex-cli:gpt-5.6-sol` model in a disposable arithmetic repair with both backends. It requires failing test evidence, an unkept proposal, Undo, Keep, and passing tests against saved source. It is a compatibility comparison on a small task, not a general quality benchmark.

The lifecycle fixture kills only the owned OpenCode child during a pending model request, verifies that the host cancels the model without falling back or changing source, cancels another turn through New Chat, then completes a fresh turn. The focused-helper fixture selects a reference Python interpreter in its disposable profile (`MY_EDITOR_FIXTURE_PYTHON`, default `/usr/bin/python3`), avoiding the machine's competing interpreter discovery. It does not change the user's interpreter or the production Python helper.

The startup fault fixture uses real disposable child processes to test silent timeout, cancellation, wrong listener and bind failure cleanup, then verifies the pinned runtime while an owned listener occupies 4096. It requires that port to be free before starting; it never stops another service.

For a finite concurrency check, run the following command in three separate terminals and the combined native suite in a fourth with `MY_EDITOR_FIXTURE_TIMEOUT_MS=300000`. This bounded harness-only wait allows a 32-file phase to finish under concurrent load; the default is unchanged and no production deadline is extended. Each profile and project is disposable. This does not start an application QA run or a recurring monitor:

```sh
MY_EDITOR_INTEGRATION_SUITE=openCode MY_EDITOR_OPENCODE_SUITE=openCodeLoad LOAD_TRACE=1 LOAD_SECONDS=1200 scripts/test-editor.sh
```

Each cycle tests a refused read-only write, an unsaved proposal, Undo, a fresh proposal, Keep and a real test process against saved source. The test explicitly accepts each fixture test-command prompt; it does not change the user's permissions. Inspect each final report, startup trace and process/profile cleanup rather than treating elapsed time or a model summary as a pass. The standalone native stress helper also supports `LOAD_WORKERS`, `LOAD_SECONDS`, `LOAD_REPORT` and `LOAD_OCCUPY_DEFAULT=1`.

## Limits

This backend alone does not establish that the social-media application passes acceptance, that OpenCode improves semantic agent quality, or that a broad QA rerun is justified. That application remains paused until a separate continuation is authorized. Its five-minute monitor has been deleted at the user's request. The current integration intentionally retains the host's context and recovery strategy; any future delegation of those responsibilities needs its own comparative evaluation.
