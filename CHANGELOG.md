# Changelog

my_editor uses the version in `overlay/extensions/my-editor-core/package.json` as its own release number. The Home page displays that version. The underlying editor shell keeps its upstream version independently.

## 0.0.3 alpha — 2026-09-24

- Clone from Git now accepts GitHub branch-page links and checks out the branch they name.
- Repository URLs can be cloned with an optional branch, so the editor no longer silently opens the default branch when the user specifies another one.

## 0.0.2 alpha — 2026-09-23

- Pair chat can request more files, search large repositories, inspect Git history, and prepare reviewable changes across files during one reply.
- Added approved test runs for npm, Go, Cargo and pytest projects. Tests run against kept workspace files.
- Kept tool access in the editor host with bounded reads, path checks, a ten-step limit, and the existing Keep/Undo review.
- Pair now carries proposal outcomes into later turns and labels unkept proposals as expired after an app restart.

## 0.0.1 alpha — 2026-09-23

- First alpha release of the Project, Pair, and project-brain workflows.
- Added visual architecture and file maps, source-aware project chat, conversation continuity, and Git change history and impact views.
- Added a Codex reasoning selector and made the full-width editor the first-run layout default.

For each release, bump the core package version and lockfile together, update this changelog, then tag the commit.
