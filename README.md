# my_editor

A code editor where **you** stay in control. Built on VSCodium (the open-source VS Code), it adds a pair
programmer that writes only what you ask, a project brain that keeps a short map of your codebase, and a
calm, writing-first interface.

The plan and requirements are in [`docs/plans/my_editor-plan-v2.md`](docs/plans/my_editor-plan-v2.md).
Decisions are in [`docs/decisions/`](docs/decisions/). Screenshots are in [`docs/screens/`](docs/screens/).

## What works today

- **The editor:** VSCodium 1.135 rebranded as my_editor (own name, icon, bundle id, data folder).
- **The look:** *Paper* theme (dark olive chrome, cream page) and *Night*; the code sits on a centred page;
  the minimap, breadcrumbs, most of the status bar and the Copilot prompts are gone.
- **The Project view** (left sidebar): the build path (Requirements → Architecture → Flow & tree → Build → QA)
  with live status, memory (conventions, brain, decisions, chat history) and the active model.
- **Chat with `@pair`** (right sidebar, the default participant). Plain questions never touch code.
  - `/file`, `/feature`, `/change`, `/next` write code — shown in the editor with **Keep / Undo** per change.
  - `/explain`, `/review`, `/brainstorm` only talk; a brainstorm can be saved as a decision.
  - `/requirements`, `/architecture`, `/tree` interview you and, when you say "write it", propose the spec file.
  - `/skill <name>` runs a `SKILL.md` skill (built-in: `debug`, `tests`, `refactor`; add your own).
- **Models** — pick with **my_editor: Choose Default Model** (or *Change* in the Project view):
  - **Claude subscription** through your Claude Code login (`claude` CLI): Opus, Sonnet, Haiku. Runs with no
    tools, no MCP and no saved session, and with API-key variables removed so billing never switches silently.
  - **ChatGPT subscription** through your Codex login (`codex exec`, read-only sandbox, empty working folder).
  - **Local:** Ollama and LM Studio, listed whenever their servers are running.
  - **API keys** (kept in the macOS keychain): Anthropic, OpenAI, OpenRouter, any OpenAI-compatible URL.
- **Navigator:** after each save it reviews only the changed lines and shows at most three notes. It never edits.
- **Project brain:** **my_editor: Build Project Brain** writes `.my_editor/brain/` — a map of every file's
  imports, exports and role — and keeps it current on save. `@pair` uses it as context.

## Build and run (macOS)

Needs Node 24, Xcode command-line tools, `jq`, and about 20 GB of free disk.

```bash
scripts/build.sh            # first build: fetches VSCodium + VS Code, ~15 min
scripts/build.sh --reuse    # later builds reuse the downloaded source
scripts/run.sh ~/some/project
```

The app is written to `vscodium/VSCode-darwin-arm64/my_editor.app`.

## How the repo is laid out

```
overlay/                 everything my_editor adds on top of VSCodium
  product.json           name, ids and the calm default settings
  patches/NNN-*.patch    the few core changes (see each file's header)
  extensions/
    my-editor-core/      pair, models, brain, navigator, project view, skills
    my-editor-look/      the Paper and Night themes
  src/                   resource overrides (app icon, empty-editor mark)
scripts/                 build.sh, fetch-vscodium.sh, run.sh, gen-themes.py
upstream.json            the pinned VSCodium commit (VS Code 1.135.0)
vscodium/                the pinned checkout (git-ignored, created by the build)
```

VSCodium itself is never edited: `scripts/build.sh` copies the overlay into a pinned checkout and builds it.
To move to a newer VS Code, change the commit in `upstream.json`, rebuild, and fix any patch that no longer applies.

## Working on the core extension

```bash
cd overlay/extensions/my-editor-core
npm install
npm run compile   # type-check and bundle to dist/
npm test          # unit tests (node --test)
```

To try a change without rebuilding the app, launch the built app with
`--extensionDevelopmentPath=<path to the extension> --enable-proposed-api=my-editor.my-editor-core`.
