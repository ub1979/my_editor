import { join } from 'path';
import { isDeepStrictEqual } from 'util';

/** The HTTP/permission contract is tested against this exact installed release. No automatic upgrade. */
export const OPENCODE_VERSION = '1.19.3';
export const GATEWAY_TOOL = 'editor_action';
export const BRIDGE_MODEL = 'selected';

export function projectRuntimeName(value: unknown): 'builtin' | 'opencode' {
	if (value === 'builtin' || value === 'opencode') { return value; }
	throw new Error('Unknown project-agent runtime. Choose OpenCode or Built-in in Project Agent Runtime.');
}

/** No provider credentials, user plugins, project config or application workspace are inherited. */
export function isolatedEnvironment(root: string, config: unknown, password: string, parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return {
		PATH: parent.PATH, TMPDIR: parent.TMPDIR,
		// Give the child an actual private home: omitting HOME triggers an OS account lookup on POSIX.
		HOME: join(root, 'home'), USERPROFILE: join(root, 'home'),
		...(parent.SystemRoot ? { SystemRoot: parent.SystemRoot } : {}),
		XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'),
		XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'),
		OPENCODE_TEST_HOME: join(root, 'home'), OPENCODE_CONFIG_DIR: join(root, 'config'),
		OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_AUTH_CONTENT: '{}',
		OPENCODE_SERVER_PASSWORD: password, OPENCODE_SERVER_USERNAME: 'my_editor',
		OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_MODELS_FETCH: '1',
		OPENCODE_DISABLE_DEFAULT_PLUGINS: '1', OPENCODE_DISABLE_EXTERNAL_SKILLS: '1', OPENCODE_DISABLE_CLAUDE_CODE: '1',
		OPENCODE_DISABLE_LSP_DOWNLOAD: '1', OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: '1', OPENCODE_PURE: '1',
	};
}

export function openCodeConfig(bridgeUrl: string, secret: string) {
	const permission = { '*': 'deny', [GATEWAY_TOOL]: 'allow' };
	return {
		autoupdate: false, share: 'disabled', snapshot: false, plugin: [], instructions: [], lsp: false, formatter: false,
		compaction: { auto: false, prune: false }, permission, tools: { '*': false, [GATEWAY_TOOL]: true },
		enabled_providers: ['myeditor'], model: `myeditor/${BRIDGE_MODEL}`, small_model: `myeditor/${BRIDGE_MODEL}`,
		default_agent: 'myeditor',
		agent: {
			myeditor: { mode: 'primary', description: 'my_editor project agent with host-controlled tools', permission, steps: 90 },
			title: { disable: true }, summary: { disable: true }, compaction: { disable: true },
		},
		provider: { myeditor: { npm: '@ai-sdk/openai-compatible', name: 'my_editor selected model',
			options: { baseURL: `${bridgeUrl}/v1`, apiKey: secret },
			models: { [BRIDGE_MODEL]: { name: 'Selected model through my_editor', tool_call: true,
				limit: { context: 1000000, output: 128000 }, cost: { input: 0, output: 0 } } } } },
		mcp: { editor: { type: 'remote', url: `${bridgeUrl}/mcp`, oauth: false,
			headers: { Authorization: `Bearer ${secret}` }, timeout: 600000 } },
	};
}

export function verifyEffectiveConfig(actual: Record<string, unknown>, expected: ReturnType<typeof openCodeConfig>): void {
	for (const key of ['permission', 'tools', 'enabled_providers', 'provider', 'mcp', 'plugin', 'instructions', 'lsp', 'formatter', 'share', 'compaction', 'model', 'small_model', 'default_agent', 'snapshot', 'autoupdate'] as const) {
		if (!isDeepStrictEqual(actual[key], expected[key])) { throw new Error(`OpenCode effective ${key} differs from the host-controlled configuration.`); }
	}
	const agent = actual.agent as Record<string, unknown> | undefined;
	if (!agent || !isDeepStrictEqual(Object.keys(agent).sort(), Object.keys(expected.agent).sort())) { throw new Error('OpenCode loaded unexpected agents.'); }
	for (const [name, config] of Object.entries(expected.agent)) {
		// 1.19.3 materializes these two empty defaults when normalizing agents.
		if (!isDeepStrictEqual(agent[name], { options: {}, permission: {}, ...config })) { throw new Error(`OpenCode effective agent ${name} differs from the host-controlled configuration.`); }
	}
}
