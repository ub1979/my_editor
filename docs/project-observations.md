# Project observations in Pair

Pair can inspect local source and Git by default. A project may also register named operational checks in `.my_editor/observations.json`. This lets Pair compare live metrics or read logs when source code alone cannot answer a question.

Open **Project → Live observations → Configure checks** to create or edit the file. A check has a stable `id`, a description shown to Pair, an absolute executable path, fixed arguments, optional standard input, and a timeout:

```json
{
  "version": 1,
  "checks": [
    {
      "id": "git_status",
      "title": "Local Git status",
      "description": "Read the current branch and working-tree state.",
      "command": "/usr/bin/git",
      "args": ["status", "--short", "--branch"],
      "timeoutSeconds": 10
    }
  ]
}
```

Pair can request a check by its `id`. It cannot change the registered command or supply extra arguments. Before the first run, my_editor shows the exact recipe for approval; approval is tied to the project path and the recipe content, so an edit requires a new approval. Commands run without a local shell, with a minimal environment, a 60-second maximum timeout, bounded output, and redaction before output reaches the model. A project recipe can still contain a command that changes files or remote systems; the approval dialog is the trust boundary. Remote SSH recipes may contain a fixed script in `stdin`; review that script before approving. Keep passwords and tokens out of this file.

Each completed Pair investigation is saved under `.my_editor/investigations/`. Records contain the project and brain commits, question, answer, and bounded excerpts and hashes of host tool results. Proposal events are saved under `.my_editor/changes/` with the linked chat request, file path, base hash, and kept-file hash. Pair can search older saved chats, decisions, investigations, and change records with its `search_records` tool. These records show what was observed and changed; they do not make an earlier assistant explanation authoritative.

The local `m_dialer` project has three read-only checks: `cell_a_live` compares a1 and a2 dialing and finalization, `postgres_health` reads active index progress and session waits, and `inventory_health` reads the Brain's background verification metrics. They use the existing SSH configuration and do not modify production. The user still reviews each exact recipe before Pair first runs it.
Its observation profile is excluded in that clone's local Git configuration because it contains private host topology. Review any new profile before sharing it with a repository.
