# my_editor

A code editor where **you** stay in control. Built on VSCodium (the open-source VS Code), it adds a pair
programmer that writes only what you ask, a project brain that keeps a short map of your codebase, and a
calm, writing-first interface.

The plan and requirements are in [`docs/plans/my_editor-plan-v2.md`](docs/plans/my_editor-plan-v2.md).
The current aim, objectives, and status are in [`docs/vision-and-status.md`](docs/vision-and-status.md).
Decisions are in [`docs/decisions/`](docs/decisions/). Screenshots are in [`docs/screens/`](docs/screens/).

## What works today

- **Home:** opening the app without a project shows your projects with their progress, plus New project,
  Open folder and Clone from Git. Clone accepts a repository URL plus an optional branch, or a GitHub branch
  page URL; it checks out that branch when cloning. A new project gets git, a starter `.my_editor/`, and
  `/requirements` in chat.

- **The editor:** VSCodium 1.135 rebranded as my_editor (own name, icon, bundle id, data folder).
- **The look:** *Paper* theme (dark olive chrome, cream page) and *Night*; the code sits on a centred page;
  the minimap, breadcrumbs, most of the status bar and the Copilot prompts are gone.
- **The Project view** (left sidebar): the build path (Requirements → Architecture → Flow & tree → Build → QA)
  with live status, memory (conventions, brain, decisions, chat history) and the active model.
- **The Pair** (right sidebar): my_editor's own chat. Opening a project greets you with skill cards (Plan:
  Requirements, Architecture, Plan the files, Brainstorm; Build: Next step, Add a feature, Change selection,
  Explain, Why; Fix: Review, Debug, Tests, Refactor; plus your own skills). Type `/` for commands.
  Code changes come back as proposals: review them in an inline diff, undo single parts with the gutter
  arrow, then **Keep** (writes and saves) or **Undo**. Nothing touches your file before Keep.
- **Project-aware chat:** ordinary Pair requests can search and read more project files as needed, inspect
  Git history, and propose changes to several files in one conversation. Test commands run only after you
  approve them in the editor. Tests use the current workspace, so keep a proposal before testing that change.
  Unkept proposals expire when the app restarts.
  The Pair refreshes brain, source, planning and Git context each turn, and condenses older conversation into
  a working brief while preserving the recent messages.
- **Auto comments:** add a function or class without a comment and the Pair writes a short one in the
  language's style (docstring, JSDoc, `///`, Go's `// Name …`). Only for code you add; ⌘Z removes it. Toggle it
  with the speech-bubble button in the editor toolbar.
- **This file** (under the file tree): symbols, Pair notes and git history for the open file, in my_editor's style.
- **A quiet window:** the left bar has only Files and Project; Search, Git, Run and Extensions still work
  from their shortcuts and appear only while open.
- **Languages built in:** JavaScript/TypeScript, Python (basedpyright, debugpy), Rust (rust-analyzer),
  Go and C/C++ (clangd). Pinned in `overlay/bundled-extensions.json`, checksum-verified at build time.
- **Models** — pick with **my_editor: Choose Default Model** (or *Change* in the Project view):
  - **Claude subscription** through your Claude Code login (`claude` CLI): Opus, Sonnet, Haiku. The CLI runs
    without its own tools, MCP or saved session; Pair's host tools are available in chat. API-key variables are
    removed so billing never switches silently.
  - **ChatGPT subscription** through your Codex login (`codex exec`, read-only sandbox, empty working folder).
    Pair's project tools run in the editor host.
  - **Local:** Ollama and LM Studio, listed whenever their servers are running.
  - **API keys** (kept in the macOS keychain): Anthropic, OpenAI, OpenRouter, any OpenAI-compatible URL.
- **Visual project maps:** in Project, open **Architecture map** to see parts and their code links, or **File tree** to browse and search planned files. Both read the saved `.my_editor/specs/` documents.
- **Navigator:** after each save it reviews only the changed lines and shows at most three notes. It never edits.
- **Project brain:** open a project that already has code and the pair asks first: *Shall I get to know this
  project?* If you say yes, it reads every file and writes `.my_editor/brain/`: a map of each file's imports,
  exports and a one-line summary, and a note per part. It also drafts `specs/architecture.md` and `specs/tree.json`
  for you to Keep or Undo. Your code is never changed. Long files are read in pieces. Running it again only
  redoes files that changed. Anything it could not cover (huge or generated files, very big projects) is listed,
  never skipped silently. The brain stays current on save, and the pair uses it as
  context. To run it again, use **Analyse** in the Project view or **my_editor: Analyse This Project**.

## Build and run (macOS)

Needs Node 24, Xcode command-line tools, `jq`, and about 20 GB of free disk.

```bash
scripts/build.sh            # first build: fetches VSCodium + VS Code, ~15 min
scripts/build.sh --reuse    # later builds reuse the downloaded source, ~10 min
scripts/run.sh ~/some/project
scripts/install.sh          # optional: copy the app into /Applications
```

The finished app is `app/my_editor.app`. It is self-contained and runs from anywhere. `vscodium/` (about 7 GB)
is only the build workspace; delete it to free space, and the next build downloads it again.

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
vscodium/                the pinned checkout and build workspace (git-ignored, safe to delete)
app/                     the finished my_editor.app (git-ignored)
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
