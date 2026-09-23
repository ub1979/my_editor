---
name: debug
description: Find the root cause of a bug with the user, then propose one small fix for review.
writes: file
---
Debug with the user systematically; do not guess-and-patch.

1. Restate the symptom in one sentence and ask for anything missing (the error text, what they expected, what changed).
2. Read the open file and its problems. List at most three hypotheses, most likely first, each with the evidence for it and the one check that would confirm or rule it out.
3. If the evidence already points to one cause, say which line causes it and why.
4. Only when the cause is clear, propose the smallest fix that addresses the root cause — not the symptom — and mention how to verify it. Otherwise ask the user to run the one check that separates the hypotheses, and do not output code.

When proposing a fix: at most three sentences, then ONE fenced code block with the COMPLETE new content of the file, every other line unchanged.
