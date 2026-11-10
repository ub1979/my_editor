import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { agentInstruction, agentToolNames } from '../src/chat/agentInstructions';
import { mayUsePlanningTool } from '../src/chat/projectToolPolicy';
import { MODES, systemPrompt } from '../src/pair/prompts';
import { RequestMetrics } from '../src/chat/requestMetrics';

test('planning advertises only executable read-only tools, with chat retrieval only when history exists', () => {
	for (const chatHistory of [false, true]) {
		const scope = { planning: true, chatHistory };
		assert.ok(agentToolNames(scope).every(mayUsePlanningTool));
		assert.equal(agentToolNames(scope).includes('read_chat'), chatHistory);
		assert.doesNotMatch(agentInstruction(scope), /"name":"(?:propose_file|propose_edit|propose_delete|run_tests|observe|open_files)"/);
	}
	assert.ok(agentInstruction({ planning: true }).length < 2300, 'Keep the protocol proportional to a planning interview');
});

test('file passes expose scoped writes without command, deletion, observation or UI-opening instructions', () => {
	const tools = agentToolNames({ filePass: true, observations: true });
	assert.ok(tools.includes('propose_edit'));
	for (const name of ['run_tests', 'propose_delete', 'observe', 'open_files']) { assert.ok(!tools.includes(name)); }
	const review = agentToolNames({ readOnly: true, chatHistory: true });
	assert.ok(review.includes('open_files'));
	assert.ok(review.every(name => mayUsePlanningTool(name) || name === 'open_files'));
	assert.ok(!agentToolNames({}).includes('observe'));
	assert.ok(agentToolNames({ observations: true }).includes('observe'));
});

test('fixer guidance is relevant to restructuring and Git work, not planning or scoped implementation', () => {
	for (const mode of [MODES.requirements, MODES.architecture, MODES.tree]) {
		assert.doesNotMatch(systemPrompt(mode, '', '', '/project'), /my_editor has a fixer/);
	}
	assert.doesNotMatch(systemPrompt(MODES.chat, '', '', '/project', { filePass: true, request: 'Implement this file' }), /my_editor has a fixer/);
	assert.doesNotMatch(systemPrompt(MODES.chat, '', '', '/project', { request: 'Explain the CSV import' }), /my_editor has a fixer/);
	assert.match(systemPrompt(MODES.chat, '', '', '/project', { request: 'Split long files on a branch' }), /Fix on a local/);
});

test('request diagnostics separate adapter waits from host time and retain only sizes and timings', () => {
	let now = 100;
	const metrics = new RequestMetrics(12, () => now);
	const call = metrics.begin('private instructions', [{ role: 'user', text: 'private source' }]);
	now = 120; call.firstText();
	now = 140; call.firstText();
	now = 170; call.end(50); call.end(50);
	now = 200;
	const result = metrics.finish();
	assert.equal(result.contextMs, 12);
	assert.equal(result.agentMs, 100);
	assert.equal(result.modelMs, 70);
	assert.equal(result.otherAgentMs, 30);
	assert.equal(result.calls.length, 1);
	assert.equal(result.calls[0].firstTextMs, 20);
	assert.equal(result.calls[0].inputChars, 'private instructionsprivate source'.length);
	assert.doesNotMatch(JSON.stringify(result), /private|instructions|source/);
});
