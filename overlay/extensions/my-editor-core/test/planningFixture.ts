export const requirements = `# Requirements
## Goal
Help people publish a reviewed draft.
## Users
Individual writers.
## Functional requirements
- FR-001 MUST save a draft. Acceptance: save and reopen a draft without losing its text.
## Non-functional requirements
- NFR-001 SHOULD preserve drafts across restarts. Acceptance: restart and recover the saved draft.
## Out of scope
Team accounts.
`;

export const architecture = `# Architecture
## Overview and system flow
The composer sends a draft to the store and retrieves it when reopened.
## Composer {#composer}
Owns draft editing for FR-001. Interface: saveDraft(text) and loadDraft(id).
## Store {#store}
Persists drafts for FR-001 and NFR-001. Interface: putDraft and getDraft.
## Decisions
Keep storage local because this version has one user; defer a remote database.
`;

export const tree = JSON.stringify([
	{ path: 'src/draft.ts', role: 'Stores a draft.', requirements: ['FR-001'], section: 'store' },
	{ path: 'test/draft.test.ts', role: 'Checks saved drafts.', requirements: ['FR-001', 'NFR-001'], section: 'store' },
]);
