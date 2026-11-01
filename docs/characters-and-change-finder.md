# Pair agents and change finder

Pair shows eight agents named for their jobs. Every agent uses the same chosen model, project tools, source evidence, 300-line rule, and Keep/Undo review.

| Agent | Focus | Working habit |
|---|---|---|
| Project | Project guide | Finds the relevant code and helps choose a next step. |
| Requirements | Requirements | Turns answers into testable behavior. |
| Architecture | Architecture | Gives each part one clear responsibility. |
| Flow & tree | Flow and files | Maps the flow and gives every planned file a role. |
| Build | Implementation | Implements a focused piece after consulting on scope. |
| Review | Review | Checks claims against code and distinguishes bugs from preferences. |
| QA | Quality assurance | Looks for counterexamples and missing checks. |
| Debug | Debugging | Reproduces a symptom and traces it to a cause. |

Pair starts with an agent suited to the opened project's stage, then switches for explicit skills and task wording. A manual choice pins that voice; **Pinned** returns to **Auto** when clicked. Choosing a skill selects its agent. A different project folder resets the pin. These are chat roles with one shared conversation and the same permissions. The A− and A+ buttons change chat text size.

Pair keeps recent conversation turns, condenses older turns into a working brief, and can retrieve stored chat messages and saved project records. Read-only help modes including Review, Explain, Why, QA, and Brainstorm can search and read project source when the attached context is insufficient; ordinary chat can also propose code for Keep/Undo. The brain and selected source excerpts are bounded so the model is not sent the whole repository on every turn. Pair must report missing coverage or stale evidence instead of guessing. Long-history recovery and large-project retrieval still need live validation; no finite context can guarantee perfect recall.

The **Find a change** card and `/locate` command ask the Project agent to search and read the current project, inspect likely callers and tests, and open up to eight verified source locations as editor tabs. The first result is focused near its line. Pair reports why each location matters and any search limit. This turn cannot propose code. A plain request such as “I want to change the header” also starts this map. The developer can then ask for an implementation, which still goes through consultation and diff review.

## Iron Man skill adaptation

The Project agent's voice adapts the downloaded `iron_man_skill/ironman` package's useful colleague and teaching guidance: short plain explanations, a definition when a term first matters, concrete examples, and a check that the developer understands the choice. Code is explained and shown through Pair's existing reviewable proposals. The downloaded skill's `/ironman` marker, Claude Code Stop hook, readability script, personal glossary, and approval-before-every-block loop are specific to Claude Code and are not installed or bundled in my_editor. Pair's existing Keep/Undo flow is the approval point for each proposed file change.

This is implemented in extension source. The character UI, automatic routing, and tab opening still need a check in a running editor with a real project and model.
