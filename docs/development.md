# Development guide

How my_editor is built, how to work on it, and how to cut a release. For what the product does, start with
the [README](../README.md); for the core VS Code changes, see [patches](patches.md).

## How the build works

my_editor never edits VSCodium directly. Everything it adds lives in `overlay/`, and `scripts/build.sh`
copies that overlay into a pinned VSCodium checkout before building:

| Step | What happens |
|---|---|
| 0. Fetch | `fetch-vscodium.sh` checks out the VSCodium commit pinned in `upstream.json` into `vscodium/`. |
| 1. Built-in extensions | Each folder in `overlay/extensions/` is compiled (if it has a `compile` script) and staged into `vscodium/src/stable/extensions/`. |
| 2. Resources | `overlay/src/` (app icon, empty-editor mark, `my-editor.css`) is copied over `vscodium/src/stable/`. |
| 3. Patches | `overlay/patches/*.patch` go into `vscodium/patches/user/`; VSCodium applies them. |
| 4. Branding | `overlay/product.json` is merged over VSCodium's (name, ids, data folder, default settings). |
| 5. Build | VSCodium's own build runs with my_editor's names. macOS only, this machine's architecture. |
| 6. App | The result is copied to `app/my_editor.app`. |
| 7. Languages | `fetch-extensions.py` downloads the extensions pinned in `overlay/bundled-extensions.json` from Open VSX, checks each sha256, and adds them to the app. |

Requirements: macOS, Node 24, Xcode command-line tools, `jq`, Python 3, and about 20 GB of free disk.
`vscodium/` (about 7 GB) is only the build workspace and is git-ignored; delete it to free space.

## Commands

```bash
scripts/build.sh               # full build from fresh VS Code source (~15 min)
scripts/build.sh --reuse       # reuse vscodium/vscode, re-apply patches (~10 min)
scripts/install.sh             # quick: recompile built-in extensions into app/, sign, copy to /Applications
scripts/install.sh --full      # build.sh --reuse first (needed for patch or product.json changes), then install
scripts/run.sh [folder]        # open app/my_editor.app, optionally on a folder
python3 scripts/gen-themes.py  # regenerate the Paper and Night themes from one palette
python3 scripts/gen-icons.py   # regenerate the file icon theme
```

The quick install only refreshes `overlay/extensions/`. Changes to patches, `overlay/src/`, `product.json` or the
bundled language extensions need `--full`. Both installs ad-hoc sign the bundle and verify the signature before
and after copying it to `/Applications/my_editor.app`.

Don't edit `scripts/build.sh` while a build is running (bash reads it lazily), and don't launch the app while
it is being packaged.

## Working on the core extension

`overlay/extensions/my-editor-core` holds Pair, models, the brain, Navigator, Home, the Project view and the
built-in skills. `my-editor-look` holds the themes and file icons.

```bash
cd overlay/extensions/my-editor-core
npm install
npm run compile   # type-check, then bundle src/extension.ts to dist/extension.js
npm test          # compile to out-test/ and run the unit tests with node --test
```

| Folder in `src/` | Responsibility |
|---|---|
| `chat/` | The Pair webview, the tool loop, proposals and Keep/Undo, characters, observations, chat records |
| `pair/` | Prompts, context assembly, code-block parsing |
| `models/` | Providers: Claude and Codex CLIs, Anthropic, OpenAI-compatible, Ollama, LM Studio, keychain |
| `brain/` | Fact extraction, Analyse, the brain index and file map, fit checks |
| `navigator/` | On-save review of changed lines and its Quick Fix actions |
| `comments/`, `quality/` | Comment guidance and the 400-line / one-class source policy |
| `project/` | Home, clone, the Project view, Git history and sync, impact, visual maps, This file |
| `records/`, `qa/`, `skills/` | Saved records and redaction, QA fit reports, the SKILL.md loader |

Webview assets (HTML helpers, CSS, scripts) are in `media/`. Built-in skills are in `skills/<name>/SKILL.md`;
a user's `~/.my_editor/skills/` overrides them, and a project's `.my_editor/skills/` overrides both.

To try a change without rebuilding the app, launch the built app with
`--extensionDevelopmentPath=<path to the extension> --enable-proposed-api=my-editor.my-editor-core`.
Built-in extensions may use proposed APIs; their typings are in `typings/`.

`src/dev/testHooks.ts` supports automated UI runs. It does nothing unless `MY_EDITOR_TEST_REPORT`,
`MY_EDITOR_TEST_QUERY` or `MY_EDITOR_TEST_COMMAND` is set.

Keep each source file focused and under 400 lines; my_editor applies the same rule to itself.

## Releasing

1. Bump `version` in `overlay/extensions/my-editor-core/package.json` and `package-lock.json` together.
   This is my_editor's release number; Home shows it. The editor shell keeps its upstream version.
2. Add the release to [CHANGELOG.md](../CHANGELOG.md) and update [vision-and-status.md](vision-and-status.md)
   and [progress.md](progress.md).
3. Run `npm test`, then `scripts/install.sh` (or `--full` if patches or `product.json` changed).
4. Check the new flows in the installed app.
5. Commit and tag the commit with the version.

Related: [patches](patches.md), [plan v2](plans/my_editor-plan-v2.md), [docs index](README.md).
