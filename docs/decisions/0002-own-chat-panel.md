# 0002 — Our own chat panel instead of VS Code's chat

**Date:** 2026-09-23 · **Status:** accepted · **Supersedes:** the chat half of 0001

## Why
The user found VS Code's integrated chat "ugly" and not the product: my_editor should feel like a friendly,
interactive pair-programming environment, with skills offered up front when a project opens.

## Decision
- The Pair is a webview panel of our own in the right sidebar (`src/chat/`): bubbles, an avatar, skill
  cards (Plan / Build / Fix / your skills), a composer with `/` commands, the current file and the model.
- The chat talks to models directly (`models/stream.ts`); VS Code's AI chat is switched off
  (`chat.disableAIFeatures: true`), which also removes its Copilot prompts and inline chat.
- Code changes are proposals reviewed in an inline diff (`chat/proposals.ts`): the proposed text lives in an
  in-memory, editable file system, so a single part can be reverted with the gutter arrow; Keep writes what
  is left into the real file and saves; Undo discards it. Keep warns if the file changed since.
- The sidebar shows only Files and Project; Search, Git, Run, Extensions and Testing appear only while open
  (patch 160). Git status items and the accounts icon start hidden.

## Consequences
- Patches 100, 140 and 150 (VS Code chat adjustments) no longer matter; they stay harmless until the next
  cleanup.
- We own the chat's rendering: Markdown is rendered on the extension side with raw HTML disabled, and the
  panel's buttons can only run an allow-listed set of commands.
