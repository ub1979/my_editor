# Pair characters and change finder

Pair has seven original animal mascots. Their names and working habits draw loosely on ideas from computing and philosophy; none claims to be a historical person. Every character uses the same chosen model, project tools, source evidence, 400-line rule, and Keep/Undo review.

| Character | Focus | Working habit |
|---|---|---|
| Shan the panda | Project guide | Finds the relevant code, speaks plainly, and helps the developer choose a next step. Inspired by Claude Shannon's way of making complex ideas clear. |
| Soki the owl | Requirements | Asks useful questions and turns answers into testable behavior. Inspired by Socrates. |
| Ada the moth | Builder | Implements a focused piece after consulting on scope. Inspired by Ada Lovelace. |
| Lisko the lynx | Architect | Gives each part one clear responsibility. Inspired by Barbara Liskov. |
| Diji the hedgehog | Reviewer | Checks claims against code and distinguishes bugs from preferences. Inspired by Edsger Dijkstra. |
| Poppy the penguin | QA | Looks for counterexamples and missing checks. Inspired by Karl Popper. |
| Hopper the frog | Debugger | Reproduces a symptom and traces it to a cause. Inspired by Grace Hopper. |

Pair starts with a character suited to the opened project's stage, then switches for explicit skills and task wording. A manual character choice pins that voice; **Pinned** returns to **Auto** when clicked. A different project folder resets the pin and selects a character for that project. The characters are presentation and work focus, not separate agents or permission levels. Switching characters does not reset the conversation or its working brief.

Pair keeps recent conversation turns, condenses older turns into a working brief, and can retrieve stored chat messages and saved project records. Read-only help modes including Review, Explain, Why, QA, and Brainstorm can search and read project source when the attached context is insufficient; ordinary chat can also propose code for Keep/Undo. The brain and selected source excerpts are bounded so the model is not sent the whole repository on every turn. Pair must report missing coverage or stale evidence instead of guessing. Long-history recovery and large-project retrieval still need live validation; no finite context can guarantee perfect recall.

The **Find a change** card and `/locate` command ask Shan to search and read the current project, inspect likely callers and tests, and open up to eight verified source locations as editor tabs. The first result is focused near its line. Pair reports why each location matters and any search limit. This turn cannot propose code. A plain request such as “I want to change the header” also starts this map. The developer can then ask for an implementation, which still goes through consultation and diff review.

## Iron Man skill adaptation

Shan's voice adapts the downloaded `iron_man_skill/ironman` package's useful colleague and teaching guidance: short plain explanations, a definition when a term first matters, concrete examples, and a check that the developer understands the choice. Code is explained and shown through Pair's existing reviewable proposals. The downloaded skill's `/ironman` marker, Claude Code Stop hook, readability script, personal glossary, and approval-before-every-block loop are specific to Claude Code and are not installed or bundled in my_editor. Pair's existing Keep/Undo flow is the approval point for each proposed file change.

This is implemented in extension source. The character UI, automatic routing, and tab opening still need a check in a running editor with a real project and model.
