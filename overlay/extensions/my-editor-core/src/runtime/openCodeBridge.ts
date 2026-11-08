import { createServer, IncomingMessage, ServerResponse } from 'http';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { AgentLoopOptions, executeAgentCalls } from '../chat/agentLoop';
import { AgentToolCall, parseAgentStep } from '../chat/agentProtocol';
import { ChatTurn } from '../models/types';
import { BRIDGE_MODEL, GATEWAY_TOOL } from './openCodeConfig';

function deferred<T>() {
	let resolve!: (value: T) => void, reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	void promise.catch(() => {});
	return { promise, resolve, reject };
}
interface Ask {
	turns: ChatTurn[]; finalOnly: boolean; remaining: number;
	result: ReturnType<typeof deferred<string>>;
}
interface Ticket {
	id: string; raw: string; calls: AgentToolCall[]; ask: Ask;
	arrived: boolean; receipt: ReturnType<typeof deferred<string>>;
}

/** OpenCode drives model → MCP → model. The existing host loop supervises every action and conclusion. */
export class OpenCodeBridge {
	readonly secret = randomBytes(32).toString('hex');
	private server = createServer((req, res) => { void this.handle(req, res); });
	private queued?: Ask;
	private activeAsk?: Ask;
	private activeTicket?: Ticket;
	private waiter = deferred<void>();
	private ticket?: Ticket;
	private failure?: Error;
	private providerBusy = false;
	private nativeContinuation = false;
	private finalReturned = false;
	private launch?: () => void;
	private requests = 0;
	private dispatches = 0;
	url = '';

	constructor(private readonly options: AgentLoopOptions) {}
	async listen(): Promise<void> {
		await new Promise<void>((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
		const address = this.server.address();
		if (!address || typeof address === 'string') { throw new Error('Cannot bind the OpenCode bridge.'); }
		this.url = `http://127.0.0.1:${address.port}`;
	}
	bind(launch: () => void) { this.launch = launch; }
	stats() { return { modelRequests: this.requests, toolDispatches: this.dispatches }; }
	assertHealthy() { if (this.failure) { throw this.failure; } }
	promptCompleted() {
		if (!this.finalReturned && !this.failure) { this.fail(new Error('OpenCode ended before returning a host-verifiable conclusion.')); }
	}
	async ask(turns: ChatTurn[], finalOnly: boolean, remaining: number): Promise<string> {
		if (this.failure) { throw this.failure; }
		if (this.queued) { throw new Error('Concurrent OpenCode model requests are not supported in one agent turn.'); }
		const request: Ask = { turns, finalOnly, remaining, result: deferred<string>() };
		this.queued = request; this.waiter.resolve();
		if (!this.nativeContinuation) { this.nativeContinuation = true; this.launch!(); }
		return request.result.promise;
	}
	async dispatch(calls: readonly AgentToolCall[]): Promise<readonly string[]> {
		const ticket = this.ticket;
		if (this.failure) { throw this.failure; }
		if (!ticket?.arrived || !calls.length || calls.length > ticket.calls.length
			|| calls.some((call, i) => JSON.stringify(call) !== JSON.stringify(ticket.calls[i]))) {
			throw new Error('OpenCode tool receipt did not match the host-authorized action.');
		}
		this.ticket = undefined; this.activeTicket = ticket; // Consume once, before any asynchronous execution.
		try {
			const results = await executeAgentCalls(this.options, calls);
			this.dispatches += calls.length;
			// The selected model receives exact bounded evidence from agentTurns. Avoid retaining
			// duplicate source bodies in the native session's growing transcript.
			ticket.receipt.resolve(JSON.stringify({ completed: calls.length, evidence: results.map(result => ({
				sha256: createHash('sha256').update(result).digest('hex'), characters: result.length,
			})), context: 'Exact results are supplied by the my_editor host on the next model request.' }));
			return results;
		} catch (error) { ticket.receipt.reject(error as Error); throw error; }
		finally { this.activeTicket = undefined; }
	}
	fail(error: Error, abortWork = true) {
		this.failure ??= error; this.queued?.result.reject(error); this.queued = undefined;
		this.activeAsk?.result.reject(error); this.activeTicket?.receipt.reject(error);
		this.ticket?.ask.result.reject(error); this.ticket?.receipt.reject(error); this.ticket = undefined;
		this.waiter.reject(error);
		if (abortWork) { this.options.abortRuntimeWork?.(); }
	}
	async close() {
		this.fail(new Error('OpenCode agent turn closed.'), false);
		this.server.closeAllConnections();
		await new Promise<void>(resolve => this.server.close(() => resolve()));
	}
	private async body(req: IncomingMessage): Promise<any> {
		const chunks: Buffer[] = []; let size = 0;
		for await (const chunk of req) { size += chunk.length; if (size > 2000000) { throw new Error('OpenCode request exceeded the host limit.'); } chunks.push(chunk); }
		return JSON.parse(Buffer.concat(chunks).toString('utf8'));
	}
	private async handle(req: IncomingMessage, res: ServerResponse) {
		if (req.headers.authorization !== `Bearer ${this.secret}` || req.headers.origin) { res.writeHead(403).end(); return; }
		if (req.method !== 'POST') { res.writeHead(405).end(); return; }
		try {
			const body = await this.body(req);
			if (req.url === '/mcp') { await this.mcp(body, res); }
			else if (req.url === '/v1/chat/completions') { await this.model(body, res); }
			else { res.writeHead(404).end(); }
		} catch (error) {
			this.fail(error instanceof Error ? error : new Error(String(error)));
			if (!res.headersSent) { res.writeHead(500, { 'content-type': 'application/json' }); }
			res.end(JSON.stringify({ error: { message: 'my_editor runtime bridge stopped; inspect the host error.' } }));
		}
	}
	private async mcp(body: any, res: ServerResponse) {
		if (body.jsonrpc !== '2.0') { throw new Error('Invalid MCP envelope.'); }
		if (body.id === undefined) { res.writeHead(202).end(); return; }
		let result: unknown;
		if (body.method === 'initialize') { result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'my_editor', version: '1' } }; }
		else if (body.method === 'tools/list') { result = { tools: [{ name: 'action', description: 'Execute a one-use action already validated by the my_editor host.',
			inputSchema: { type: 'object', properties: { ticket: { type: 'string' } }, required: ['ticket'], additionalProperties: false } }] }; }
		else if (body.method === 'tools/call') {
			const ticket = this.ticket;
			if (body.params?.name !== 'action' || !ticket || ticket.arrived || body.params.arguments?.ticket !== ticket.id
				|| Object.keys(body.params.arguments).length !== 1 || this.options.cancelled()) { throw new Error('Rejected unknown, reused or cancelled OpenCode action ticket.'); }
			ticket.arrived = true; ticket.ask.result.resolve(ticket.raw);
			result = { content: [{ type: 'text', text: await ticket.receipt.promise }] };
		} else if (body.method === 'ping') { result = {}; }
		else { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not available' } })); return; }
		res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
	}
	private async model(body: any, res: ServerResponse) {
		if (this.failure) { throw this.failure; }
		if (body.model !== BRIDGE_MODEL || this.providerBusy || this.ticket) { throw new Error('Unexpected or overlapping OpenCode provider request.'); }
		// OpenCode's native filesystem, shell, web and subagent tools are never exposed to the selected model.
		if (!Array.isArray(body.tools) || body.tools.some((tool: any) => tool.function?.name !== GATEWAY_TOOL)) { throw new Error('OpenCode exposed unexpected native tools.'); }
		this.providerBusy = true; this.requests++; this.finalReturned = false;
		let ask: Ask | undefined;
		try {
			if (!this.queued) { await this.waiter.promise; }
			ask = this.queued; this.activeAsk = ask; this.queued = undefined; this.waiter = deferred<void>();
			if (!ask || this.options.cancelled()) { throw new Error('OpenCode request cancelled.'); }
			const raw = await this.options.ask(ask.turns, ask.finalOnly, ask.remaining);
			if (this.failure) { throw this.failure; }
			if (this.options.cancelled()) { throw new Error('OpenCode request cancelled.'); }
			const step = parseAgentStep(raw, this.options.fileReview);
			let message: any = { role: 'assistant', content: raw }, finish = 'stop';
			if (!ask.finalOnly && step && step.action !== 'final') {
				if (!body.tools.some((tool: any) => tool.function?.name === GATEWAY_TOOL)) { throw new Error('OpenCode host gateway is unavailable.'); }
				this.ticket = { id: randomUUID(), raw, calls: step.action === 'tools' ? step.calls : [step], ask, arrived: false, receipt: deferred<string>() };
				message = { role: 'assistant', content: null, tool_calls: [{ id: 'call_' + randomUUID(), type: 'function',
					function: { name: GATEWAY_TOOL, arguments: JSON.stringify({ ticket: this.ticket.id }) } }] }; finish = 'tool_calls';
			} else { this.finalReturned = true; this.nativeContinuation = false; ask.result.resolve(raw); }
			const base = { id: 'chatcmpl-' + randomUUID(), created: Math.floor(Date.now() / 1000), model: BRIDGE_MODEL };
			if (body.stream) {
				res.writeHead(200, { 'content-type': 'text/event-stream' });
				const delta = { ...message, ...(message.tool_calls ? { tool_calls: message.tool_calls.map((tool: any, index: number) => ({ index, ...tool })) } : {}) };
				res.write('data: ' + JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n');
				res.end('data: ' + JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }) + '\n\ndata: [DONE]\n\n');
			} else { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...base, object: 'chat.completion', choices: [{ index: 0, message, finish_reason: finish }] })); }
		} catch (error) { ask?.result.reject(error as Error); throw error; }
		finally { this.providerBusy = false; this.activeAsk = undefined; }
	}
}
