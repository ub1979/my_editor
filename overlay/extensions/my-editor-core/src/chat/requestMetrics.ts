import type { ChatTurn } from '../models/types';

export interface ModelRequestMetric {
	readonly systemChars: number;
	readonly inputChars: number;
	readonly outputChars: number;
	readonly durationMs: number;
	readonly firstTextMs?: number;
}

export interface RequestPerformance {
	/** Local preparation inside PairEngine, before starting the agent runtime. */
	readonly contextMs: number;
	readonly agentMs: number;
	/** Adapter wait, including its CLI launch/network time; not a measurement of server inference alone. */
	readonly modelMs: number;
	/** Runtime startup, project tools and other host work, excluding model waits. */
	readonly otherAgentMs: number;
	readonly calls: readonly ModelRequestMetric[];
}

/** Numeric local diagnostics only: never retain prompt bodies, code or credentials. */
export class RequestMetrics {
	private readonly started: number;
	private readonly calls: ModelRequestMetric[] = [];
	constructor(private readonly contextMs = 0, private readonly now: () => number = Date.now) { this.started = now(); }

	begin(system: string, turns: readonly ChatTurn[]) {
		const started = this.now();
		const inputChars = system.length + turns.reduce((total, turn) => total + turn.text.length, 0);
		let firstTextMs: number | undefined, ended = false;
		return {
			firstText: () => { firstTextMs ??= Math.max(0, this.now() - started); },
			end: (outputChars: number) => {
				if (ended) { return; } ended = true;
				this.calls.push({ systemChars: system.length, inputChars, outputChars,
					durationMs: Math.max(0, this.now() - started), ...(firstTextMs === undefined ? {} : { firstTextMs }) });
			},
		};
	}

	finish(): RequestPerformance {
		const agentMs = Math.max(0, this.now() - this.started);
		const modelMs = this.calls.reduce((total, call) => total + call.durationMs, 0);
		return { contextMs: this.contextMs, agentMs, modelMs, otherAgentMs: Math.max(0, agentMs - modelMs), calls: [...this.calls] };
	}
}
