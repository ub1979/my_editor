import type * as vscode from 'vscode';
import { AgentLoopOptions, runAgentLoop } from '../chat/agentLoop';
import { OpenCodeBridge } from './openCodeBridge';
import { startOpenCode, OpenCodeServer } from './openCodeServer';
import { BRIDGE_MODEL, OPENCODE_VERSION } from './openCodeConfig';

/** Keeps the existing model, context, scope, recovery and Keep/Undo contracts around OpenCode's native loop. */
export async function runOpenCodeLoop(options: AgentLoopOptions, binary: string, token: vscode.CancellationToken): Promise<string> {
	if (token.isCancellationRequested) { return ''; }
	const bridge = new OpenCodeBridge(options), abort = new AbortController();
	let server: OpenCodeServer | undefined, sessionId: string | undefined, prompt = Promise.resolve();
	const stopped = () => { bridge.fail(new Error('OpenCode agent stopped.')); abort.abort(); };
	const listener = token.onCancellationRequested(stopped);
	const deadline = setTimeout(stopped, 30 * 60 * 1000);
	try {
		options.progress(`Starting isolated OpenCode ${OPENCODE_VERSION} project session…`);
		await bridge.listen();
		server = await startOpenCode(binary, bridge.url, bridge.secret, abort.signal);
		const session = await server.request('/session', { title: 'my_editor supervised project turn', agent: 'myeditor',
			model: { providerID: 'myeditor', id: BRIDGE_MODEL } });
		if (typeof session.id !== 'string' || !/^ses[\w-]+$/.test(session.id)) { throw new Error('OpenCode returned an invalid session identifier.'); }
		sessionId = session.id;
		bridge.bind(() => {
			prompt = prompt.then(async () => {
				if (abort.signal.aborted) { return; }
				const result = await server!.request(`/session/${sessionId}/message`, { agent: 'myeditor',
					model: { providerID: 'myeditor', modelID: BRIDGE_MODEL },
					parts: [{ type: 'text', text: 'Continue the host-supervised project request using only the editor action gateway.' }] });
				if (result.info?.error) { throw new Error(`OpenCode session failed: ${result.info.error.name ?? 'provider error'}`); }
				bridge.promptCompleted();
			}).catch(error => bridge.fail(error));
		});
		const reply = await runAgentLoop({ ...options, ask: (...args) => bridge.ask(...args), dispatch: calls => bridge.dispatch(calls) });
		// A model answer alone is not proof that the native session completed successfully.
		if (!token.isCancellationRequested) {
			let completionTimer: ReturnType<typeof setTimeout> | undefined;
			try { await Promise.race([prompt, new Promise<never>((_, reject) => {
				completionTimer = setTimeout(() => reject(new Error('OpenCode did not finish its final response.')), 5000);
			})]); } finally { clearTimeout(completionTimer); }
			bridge.assertHealthy();
		}
		options.onObservation?.({ name: 'runtime_session', arguments: { id: `opencode ${OPENCODE_VERSION} ${sessionId}` } },
			JSON.stringify(bridge.stats()));
		return reply;
	} catch (error) {
		if (token.isCancellationRequested) { return ''; }
		throw error;
	} finally {
		listener.dispose(); clearTimeout(deadline);
		if (server && sessionId) { await server.request(`/session/${sessionId}/abort`, {}, AbortSignal.timeout(2000)).catch(() => {}); }
		abort.abort(); await bridge.close(); await server?.close(); await prompt;
	}
}
