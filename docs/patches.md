# Core patches

my_editor changes as little of VS Code as it can. Most features live in the built-in extensions under
`overlay/extensions/`. The few changes that an extension cannot make are the numbered patches in
`overlay/patches/`. `scripts/build.sh` copies them into VSCodium's `patches/user/` folder, and VSCodium applies
them to the pinned VS Code source (1.135.0, see `upstream.json`). Every changed line carries a
`// my_editor:` comment.

| Patch | VS Code file | What it changes | Why |
|---|---|---|---|
| 100 chat default model any vendor | `api/common/extHostLanguageModels.ts` | Without Copilot, the default chat model can come from any vendor. | VS Code only accepted a Copilot default, so a non-Copilot model was never picked. |
| 110 centred page layout | `base/browser/ui/centered/centeredViewLayout.ts` | Page width 960 px (about 100 columns); margins can shrink to a 16–20 px frame. | The code sits on a centred page. Upstream's 60 px minimum margin squeezed the page on small windows. |
| 120 quiet status bar | `parts/statusbar/statusbarModel.ts` | Encoding, EOL, indentation, language, Git and chat entries start hidden. | A calm window. Any entry can be shown again from the status bar's context menu. |
| 130 product defaults | `services/configuration/browser/configuration.ts` | `configurationDefaults` in `product.json` apply from the first frame. | Extension defaults arrive too late for editors restored at startup, so the look flickered. |
| 140 no save before Keep | `chatEditing/chatEditingModified{Document,Notebook}Entry.ts` | Proposed chat edits stay unsaved until the user keeps them. | Upstream saved proposals to disk before review. |
| 150 hide mode and target pickers | `chat/browser/actions/chatExecuteActions.ts` | The chat mode and session-target pickers show only when `myEditor.chat.showModePicker` / `showSessionTarget` are on. | With one mode and local sessions there was nothing to choose. |
| 160 quiet activity bar | `parts/globalCompositeBar.ts`, `parts/paneCompositeBar.ts` | The accounts icon starts hidden. Search, Git, Run, Extensions, Remote, Testing and Chat appear in the bar only while open. | The left bar shows Files and Project only. The views still open from their shortcuts. |
| 170 start on Home | `platform/windows/electron-main/windowsMainService.ts` | `window.restoreWindows` defaults to `none`. | The app starts on Home instead of reopening the last project. Reloads and updates still restore windows. |
| 171 own style, hide Outline and Timeline | `workbench/browser/style.ts`, `outline.contribution.ts`, `timeline.contribution.ts` | Loads `my-editor.css` (from `overlay/src/`); Outline and Timeline start hidden. | The workbench matches the Paper style; the **This file** panel replaces Outline and Timeline. |
| 180 source line save gate | `services/textfile/common/textFileEditorModel.ts` | A source file above 400 lines is not saved. The buffer stays dirty and a warning is logged. | Enforces the 400-line rule for human edits at the final save step, after formatters run. |

Since [decision 0002](decisions/0002-own-chat-panel.md), Pair is my_editor's own webview and VS Code's chat is
switched off, so patches 100, 140 and 150 no longer affect Pair. They are harmless and stay until a cleanup.

## Working with patches

- **Add one:** VSCodium applies these with `git apply`, so after a build every patch is an uncommitted change in
  `vscodium/vscode/`. For a file no existing patch touches, edit it there and save the change with
  `git -C vscodium/vscode diff -- <file> > overlay/patches/NNN-area-what.patch`. For a file that a patch already
  changes, edit that patch instead, or the new one would repeat its hunks. Mark every changed line with a
  `// my_editor:` comment and add the patch to this table.
- **Upgrade VS Code:** change the commit in `upstream.json`, run `scripts/build.sh`, and fix or regenerate any
  patch that no longer applies.
- **Install:** patches need a full build (`scripts/install.sh --full`). The quick install only refreshes the
  built-in extensions.

Related: [development guide](development.md), [README](../README.md).
