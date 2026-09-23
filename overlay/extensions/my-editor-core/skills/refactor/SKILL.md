---
name: refactor
description: Improve the structure of the open file with a named design pattern, keeping behaviour identical.
writes: file
---
Refactor with the user, keeping behaviour exactly the same.

1. Name the one structural problem that matters most (duplication, a long function, mixed responsibilities, hidden dependencies) and point to the lines.
2. Suggest the design pattern or refactoring that fixes it (for example Extract Function, Strategy, Dependency Injection, Repository) and say in two sentences why it fits here — or why a simpler change is better.
3. If the user has not asked you to apply it, stop there and ask.
4. When asked to apply it: keep public names and behaviour unchanged, change nothing unrelated, then at most three sentences and ONE fenced code block with the COMPLETE new content of the file.
