import { createHash } from 'crypto';
import * as vscode from 'vscode';
import { ApiKeys } from '../models/secrets';
import { streamModel } from '../models/stream';
import { ModelEntry } from '../models/types';
import { batchFiles, parseSummaries, SourceFile } from './analysisPlan';
const PARALLEL = 3;
const BATCH_TIMEOUT_MS = 180_000;

export const SUMMARY_SYSTEM = `You summarise source files for a project map. For each item you are given, write one plain sentence
(at most 25 words) saying what it is responsible for, as a teammate would explain it. An item named like "path#3" is one
piece of a longer file: summarise what that piece does. No Markdown, no code.
Reply with only a JSON object mapping each item name exactly as given to its sentence.`;

export const COMBINE_SYSTEM = `You are given, for each source file, one-line summaries of its pieces in order. Write one plain sentence
(at most 25 words) saying what the whole file is responsible for. No Markdown, no code.
Reply with only a JSON object mapping each file path exactly as given to its sentence.`;

export const PART_SYSTEM = `You are given the parts of a software project, each with its files and one-line summaries. For each part write
two or three plain sentences: what the part is for and how it is organised. No Markdown, no code.
Reply with only a JSON object mapping each part name exactly as given to its sentences.`;
export const ARCHITECTURE_SYSTEM = `You write the architecture document of an existing project from an outline of its files. Describe what
the code shows; where something is unclear, say so under "Open questions" instead of guessing. Write Markdown:
- "# <project name>", then one short paragraph: what the project is and who it seems to be for.
- "## Stack": languages, frameworks and tools visible in the files.
- One section per part in the outline, using exactly the heading anchor given there, e.g. "## API client {#src-api}".
  Say what the part does, its main files and how it connects to the other parts. Merge nothing, skip nothing.
- "## How it fits together": the main flow through the parts, in a few sentences.
- "## Decisions": design choices visible in the code, each with why it was probably made.
- "## Open questions": what a newcomer cannot tell from the code.
Keep it short: a few sentences per section. Reply with only the document.`;

/** Asks one model and returns its whole reply, giving up after a while so one stuck request cannot stall the run. */
export async function ask(entry: ModelEntry, keys: ApiKeys, system: string, text: string, token: vscode.CancellationToken, timeoutMs: number): Promise<string> {
	const source = new vscode.CancellationTokenSource();
	const cancel = token.onCancellationRequested(() => source.cancel());
	const timer = setTimeout(() => source.cancel(), timeoutMs);
	let reply = '';
	try {
		await streamModel(entry, keys, { system, turns: [{ role: 'user', text }], token: source.token, onText: chunk => reply += chunk });
	} finally {
		clearTimeout(timer);
		cancel.dispose();
		source.dispose();
	}
	return reply;
}

export function hashOf(text: string): string {
	return createHash('sha1').update(text).digest('hex').slice(0, 12);
}

export function plural(n: number, word: string): string {
	return `${n.toLocaleString('en')} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Sends items to the model in batches, a few at a time, and collects one summary per item.
 * Items the model did not answer for are simply missing from the result.
 */
export async function summarise(
	items: readonly SourceFile[], system: string, model: ModelEntry, keys: ApiKeys, token: vscode.CancellationToken,
	onBatch: (done: number) => void, maxChars = 200,
): Promise<Record<string, string>> {
	const found: Record<string, string> = {};
	let done = 0;
	const pass = async (batches: SourceFile[][]) => {
		let next = 0;
		const worker = async () => {
			while (next < batches.length && !token.isCancellationRequested) {
				const batch = batches[next++];
				const names = batch.map(f => f.path);
				// Naming the keys matters: given one file, models otherwise summarise each function in it.
				const text = `${batch.map(f => `=== ${f.path} ===\n${f.text}`).join('\n\n')}\n\nReply with a JSON object with exactly these keys: ${JSON.stringify(names)}`;
				try {
					Object.assign(found, parseSummaries(await ask(model, keys, system, text, token, BATCH_TIMEOUT_MS), names, maxChars));
				} catch {
					// Retried once below, then counted as missing by the caller.
				}
				done += batch.length;
				onBatch(Math.min(done, items.length));
			}
		};
		await Promise.all(Array.from({ length: Math.min(PARALLEL, batches.length) }, worker));
	};
	await pass(batchFiles(items));
	const missing = items.filter(item => !found[item.path]);
	if (missing.length && !token.isCancellationRequested) {
		done = items.length - missing.length;
		await pass(batchFiles(missing));
	}
	return found;
}

