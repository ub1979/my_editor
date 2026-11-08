import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { decisionEvidence, decisionQuestionProblem, decisionAnswerPrompt } from '../src/project/fileDecision';

const question = 'BLOCKED\nEvidence: .my_editor/specs/requirements.md:20 lists publishing; .my_editor/specs/architecture.md:104 lists draftId without its type.\n'
	+ 'Missing or conflicting: No type is specified for the payload ID.\nRecommendation: Use strings to preserve the existing storage interface.\n'
	+ 'Options:\n1. Strings: preserve storage but update the event schema.\n2. Integers: preserve events but migrate storage.\n'
	+ 'Question: Which ID type should the shared payload use?';

test('blocker lookup searches beyond the initial brief and preserves source line references', () => {
	const requirements = 'Unrelated draft prose\n'.repeat(1000) + 'draftId and attemptId are opaque strings.\n';
	const evidence = decisionEvidence({ requirements, architecture: 'Envelope id is UUID.\nPayload draftId is a string.\n' },
		'Composer `draftId` and `attemptId`: strings or integers?');
	assert.match(evidence, /requirements\.md:1001: draftId and attemptId are opaque strings/);
	assert.match(evidence, /architecture\.md:2: Payload draftId is a string/);
	assert.ok(evidence.length <= 20200);
});

test('missing documents and unmatched excerpts do not claim that the design decision is absent', () => {
	const evidence = decisionEvidence({ architecture: 'Overview\nA desktop tool' }, 'Which publish identifier?');
	assert.match(evidence, /requirements\.md: missing or unreadable/);
	assert.match(evidence, /No literal matches. Inspect the document/);
});

test('a design question needs evidence, a recommendation and two alternatives', () => {
	assert.equal(decisionQuestionProblem(question), undefined);
	assert.ok(decisionQuestionProblem('BLOCKED\nStrings or integers?'));
	assert.ok(decisionQuestionProblem(question.replace('Recommendation:', 'Guess:')));
	assert.ok(decisionQuestionProblem(question.replace('2. Integers', 'Integers')));
	assert.ok(decisionQuestionProblem(question.replace('.my_editor/specs/architecture.md', 'generated.ts')));
	assert.equal(decisionAnswerPrompt(question), 'Which ID type should the shared payload use? See the recommendation and alternatives in the agent chat.');
});
