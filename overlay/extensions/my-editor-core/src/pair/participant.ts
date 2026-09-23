import * as vscode from 'vscode';
import { logExchange } from '../records/chatLog';
import { currentFile, describeFile, FileContext, readProjectNote } from './context';
import { lastCodeBlock } from './codeBlock';
import { Mode, MODES, systemPrompt } from './prompts';

const HISTORY_TURNS = 6;

/** `@pair`: the pair programmer. Talks by default; writes code only for an explicit mode, as a reviewed edit. */
export function registerPairParticipant(): vscode.Disposable {
	const participant = vscode.chat.createChatParticipant('myEditor.pair', handle);
	participant.iconPath = new vscode.ThemeIcon('sparkle');
	return participant;
}

async function handle(
	request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
	const mode = MODES[request.command ?? 'chat'] ?? MODES.chat;
	let file: FileContext | undefined;
	try {
		file = await currentFile(request);
	} catch (err) {
		stream.markdown(String(err instanceof Error ? err.message : err));
		return {};
	}
	if (mode.writes !== 'none' && !file) {
		stream.markdown('Open the file you want to work on, then ask again.');
		return {};
	}
	if (mode.writes === 'selection' && !file?.selection) {
		stream.markdown('Select the lines to change first — or use `/feature` to change the file.');
		return {};
	}

	const [conventions, brain] = await Promise.all([readProjectNote('conventions.md'), readProjectNote('brain/index.md')]);
	const messages = [
		...history(context),
		vscode.LanguageModelChatMessage.User(
			[file ? describeFile(file) : 'No file is open.', `Request: ${request.prompt || '(no extra instructions)'}`].join('\n\n')),
	];

	const reply = await request.model.sendRequest(
		messages, { modelOptions: { system: systemPrompt(mode, conventions, brain) } }, token);

	const text = await streamUntilCode(reply.text, stream, mode, file);
	if (token.isCancellationRequested) {
		return {};
	}
	if (mode.writes !== 'none' && file) {
		proposeEdit(stream, mode, file, text);
	}
	void logExchange({ mode: mode.id, model: request.model.name, file: file?.relativePath, prompt: request.prompt, reply: text });
	return { metadata: { mode: mode.id } };
}

/** Streams prose into chat; once a code block starts in an editing mode, shows progress instead of code. */
async function streamUntilCode(
	parts: AsyncIterable<string>, stream: vscode.ChatResponseStream, mode: Mode, file: FileContext | undefined,
): Promise<string> {
	let full = '';
	let shown = 0;
	let writing = false;
	for await (const part of parts) {
		full += part;
		if (mode.writes === 'none') {
			stream.markdown(part);
			continue;
		}
		if (!writing) {
			const fence = full.indexOf('```');
			// Hold back a trailing "`" or "``" that may be the start of a fence.
			const safeEnd = fence >= 0 ? fence : Math.max(shown, full.length - 2);
			if (safeEnd > shown) {
				stream.markdown(full.slice(shown, safeEnd));
				shown = safeEnd;
			}
			if (fence >= 0) {
				writing = true;
				stream.progress(`Writing ${file?.relativePath ?? 'the change'}…`);
			}
		}
	}
	return full;
}

function proposeEdit(stream: vscode.ChatResponseStream, mode: Mode, file: FileContext, reply: string): void {
	const code = lastCodeBlock(reply);
	if (code === undefined) {
		stream.markdown('\n\n_No code came back, so nothing was changed._');
		return;
	}
	const range = mode.writes === 'selection' && file.selection
		? file.selection
		: new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
	const content = mode.writes === 'file' && file.text.endsWith('\n') && !code.endsWith('\n') ? `${code}\n` : code;
	stream.markdown('\n\nReview the change in the editor — keep or undo each part.');
	stream.textEdit(file.uri, [vscode.TextEdit.replace(range, content)]);
	stream.textEdit(file.uri, true);
}

/** The last few turns, as plain text, so follow-ups make sense. */
function history(context: vscode.ChatContext): vscode.LanguageModelChatMessage[] {
	const out: vscode.LanguageModelChatMessage[] = [];
	for (const turn of context.history.slice(-HISTORY_TURNS)) {
		if (turn instanceof vscode.ChatRequestTurn) {
			out.push(vscode.LanguageModelChatMessage.User(turn.prompt));
		} else if (turn instanceof vscode.ChatResponseTurn) {
			const text = turn.response
				.map(part => (part instanceof vscode.ChatResponseMarkdownPart ? part.value.value : ''))
				.join('');
			if (text) {
				out.push(vscode.LanguageModelChatMessage.Assistant(text));
			}
		}
	}
	return out;
}
