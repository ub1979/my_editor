# 0001 — Reuse the core chat and inline edit review

**Date:** 2026-09-23 · **Status:** accepted · **Milestone:** M0 spike

## Question
Plan §5.1 asked whether Code-OSS's built-in chat panel and inline edit review (accept/reject
per hunk) can serve my_editor without Copilot, or whether we must build our own webview chat
and diff gate (the plan's "make-or-break" M4 item).

## Finding
They can, with one small core patch.

- A built-in extension may use proposed APIs (`extensionsProposedApi.ts` skips the check for
  built-ins), so `@pair` can use `response.textEdit` (proposal `chatParticipantAdditions`).
- Our models appear in the chat model picker through the stable
  `lm.registerLanguageModelChatProvider`; `isDefault` needs proposal `chatProvider`.
- Blocker found: the extension host only accepted a *Copilot* model as the default
  (`extHostLanguageModels.ts`), so every request failed with "Language model unavailable".
  Fixed by `overlay/patches/100-chat-default-model-any-vendor.patch`.
- VSCodium ships with `chat.disableAIFeatures: true`; our core extension defaults it to false.
- Result: `@pair` answers in the core chat, and its proposed edit shows in the editor with
  Keep / Undo per hunk plus a file-level Keep / Undo in chat
  (`docs/screens/m0-pair-inline-review.png`).

## Decision
Reuse the core chat view and chat editing session for chat and the diff gate. Do not build a
webview chat or a custom diff UI. Agent mode stays off (`chat.agent.enabled: false`): my_editor is
a pair programmer, not an autonomous agent.

## Consequences
- M4 (diff gate) shrinks from weeks to wiring. FR-052 (per-hunk accept/reject) comes from core.
- Upstream chat editing saves proposed edits to disk immediately and reverts on Undo. That breaks "no
  silent writes" (a test runner or build could pick up an unapproved edit), so
  `overlay/patches/140-chat-no-save-before-keep.patch` keeps proposed edits unsaved in the editor until
  the user presses Keep, which saves. Found while testing `/requirements` on 2026-09-23.
- We now depend on proposed APIs that can change between VS Code releases. Pinned typings live in
  `overlay/extensions/my-editor-core/typings/` and must be refreshed on each upstream bump.
