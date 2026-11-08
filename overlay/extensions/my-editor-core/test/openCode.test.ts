import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedEnvironment, openCodeConfig, projectRuntimeName, verifyEffectiveConfig } from '../src/runtime/openCodeConfig';

test('Invalid runtime settings never fall back to another backend', () => {
	assert.equal(projectRuntimeName('opencode'), 'opencode'); assert.equal(projectRuntimeName('builtin'), 'builtin');
	for (const value of ['OpenCode', 'missing', '', null, false]) { assert.throws(() => projectRuntimeName(value), /Unknown project-agent runtime/); }
});

const expected = () => openCodeConfig('http://127.0.0.1:1234', 'fixture-only');
function effective() {
	const value = expected();
	return { ...value, agent: Object.fromEntries(Object.entries(value.agent).map(([name, config]) => [name, { options: {}, permission: {}, ...config }])) };
}
test('OpenCode inherits only process essentials, never credentials or user runtime configuration', () => {
	const env = isolatedEnvironment('/tmp/fixture', expected(), 'private', { PATH: '/bin', TMPDIR: '/tmp', OPENAI_API_KEY: 'secret',
		HOME: '/real-home', OPENCODE_CONFIG: '/external.json', OPENCODE_AUTH_CONTENT: 'secret', NODE_OPTIONS: '--require /external.js' });
	assert.equal(env.PATH, '/bin'); assert.equal(env.HOME, '/tmp/fixture/home'); assert.equal(env.USERPROFILE, '/tmp/fixture/home');
	assert.equal(env.OPENAI_API_KEY, undefined);
	assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.OPENCODE_CONFIG, undefined); assert.equal(env.OPENCODE_AUTH_CONTENT, '{}');
	assert.equal(env.OPENCODE_DISABLE_PROJECT_CONFIG, '1'); assert.equal(env.OPENCODE_DISABLE_EXTERNAL_SKILLS, '1');
	assert.equal(env.OPENCODE_TEST_MANAGED_CONFIG_DIR, undefined, 'System-managed policy must not be bypassed');
});
test('OpenCode effective configuration accepts only the pinned runtime defaults', () => {
	assert.doesNotThrow(() => verifyEffectiveConfig(effective(), expected()));
	for (const mutate of [
		(v: any) => { v.permission['*'] = 'allow'; }, (v: any) => { v.agent.myeditor.permission.bash = 'allow'; },
		(v: any) => { v.agent.external = {}; }, (v: any) => { v.plugin.push('external'); },
		(v: any) => { v.mcp.other = { type: 'local', command: ['sh'] }; }, (v: any) => { v.model = 'another/model'; },
		(v: any) => { v.small_model = 'another/model'; }, (v: any) => { v.snapshot = true; },
		(v: any) => { v.compaction.auto = true; }, (v: any) => { v.provider.myeditor.options.baseURL = 'https://external'; },
	]) { const value = effective(); mutate(value); assert.throws(() => verifyEffectiveConfig(value, expected())); }
});
