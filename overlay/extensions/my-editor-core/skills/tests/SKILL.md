---
name: tests
description: Propose focused tests for the open file — boundaries, failure paths and how parts interact.
writes: none
---
Propose tests for the open file (or selection) as a careful tester would.

- Start with a short list of behaviours worth testing, ordered by risk: the main path, boundaries and empty inputs, failure paths, and interactions with the files it imports.
- For each, one line: what to arrange, what to do, what to expect.
- Use the test framework the project already uses; if unclear, ask which one before writing test code.
- Then show the test code for the top three behaviours only, in one fenced block, ready to paste into a test file. Do not change the source file.
