import { implementationRules } from './filePassPolicy';

/** Shared contract between Flow's prompt and the host's guided-build validation. */
export const BUILD_PLAN_INSTRUCTION = `${implementationRules}
Plan complete implementations before scaffolding. The 600-line limit is a design
constraint, never permission to omit behavior, error handling, tests or documentation, or cram statements onto fewer lines.
Estimate each source file's final size, including imports and useful comments. Aim below 250 lines for headroom and record
estimatedLines. If a responsibility is likely to need more than 600 lines, split it into cohesive collaborating files now,
including the interfaces and tests that connect them. Estimates are forecasts, not proof; revise the split if implementation grows.
Choose a real conventional application entry point (for example src/main.ts or main.py), or the public index for a library.
Do not invent an unused main file or rename a saved entry point just for appearance. Explain where execution begins.
Produce a dependency-aware buildPlan: foundation/configuration and shared libraries before their consumers, then integration.
Include full-project integration and startup checks in the final implementation step. Each step names its files,
prerequisite step IDs, small concrete implementation tasks, and observable verification checks
(including the test file or command when known and the expected outcome). Include tests with the implementation they verify.
In each task, name the contracts it consumes and produces, with their owning file paths and the exact types/signatures
from the architecture. Order the files within a step by their actual dependencies too: shared types and repositories
before services, services before routes/entry points, and each test after the interface it exercises is available.
Check that consumers agree with producers on fields and ID representations. Surface an actual unresolved contract
decision during planning instead of having separate file passes invent incompatible types.
Every planned file belongs to exactly one step. The first dependency-ready step is Start here; the application entry point
can be a later step. Do not equate creating a stub, writing code or marking a file done with passing its tests.
Return a JSON object with files and buildPlan, using this shape:
{"files":[{"path":"src/main.ts","role":"Application entry point","requirements":["FR-001"],"section":"app",
"status":"planned","estimatedLines":100}],"buildPlan":{"version":1,"entryPoint":"src/main.ts","steps":[
{"id":"app","title":"Build the application entry","files":["src/main.ts"],"dependsOn":[],
"tasks":["Implement the planned startup and shutdown behavior"],
"checks":["Run the startup test and verify the expected service is ready; verify a clear error for invalid configuration"]}]}}.
When adding guidance to an existing tree, preserve its paths, roles, requirement links, section anchors, status and unrelated
metadata. Add estimates and buildPlan; propose a path/role split only with a concrete size/responsibility reason. Do not regenerate
requirements or architecture. Existing complete trees without buildPlan remain valid; missing build guidance is an optional addition.`;
