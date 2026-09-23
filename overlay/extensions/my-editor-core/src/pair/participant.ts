import * as vscode from 'vscode';
import { logExchange } from '../records/chatLog';
import { currentFile, describeFile, FileContext, readProjectNote } from './context';
import { lastCodeBlock } from './codeBlock';
import { Mode, MODES, systemPrompt } from './prompts';
import { loadSkills } from '../skills/loader';
import { neighbourSummary } from '../brain/brain';

const HISTORY_TURNS = 6;

/** `@pair`: the pair programmer. Talks by default; writes code only for an explicit mode, as a reviewed edit. */
export function registerPairParticipant(extensionUri: vscode.Uri): vscode.Disposable {
	const participant = vscode.chat.createChatParticipant('myEditor.pair', (request, context, stream, token) =>
		handle(extensionUri, request, context, stream, token));
	participant.iconPath = new vscode.ThemeIcon('sparkle');
	return participant;
}

async function handle(
	extensionUri: vscode.Uri, request: vscode.ChatRequest, context: vscode.ChatContext,
	stream: vscode.ChatResponseStream, token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
	let mode: Mode = MODES[request.command ?? 'chat'] ?? MODES.chat;
	let prompt = request.prompt;
	if (request.command === 'skill') {
		const chosen = await resolveSkill(extensionUri, prompt, stream);
		if (!chosen) {
			return {};
		}
		({ mode, prompt } = chosen);
	}
	let file: FileContext | undefined;
	try {
		file = await currentFile(request);
	} catch (err) {
		stream.markdown(String(err instanceof Error ? err.message : err));
		return {};
	}
	if ((mode.writes === 'file' || mode.writes === 'selection') && !file) {
		stream.markdown('Open the file you want to work on, then ask again.');
		return {};
	}
	if (mode.writes === 'selection' && !file?.selection) {
		stream.markdown('Select the lines to change first — or use `/feature` to change the file.');
		return {};
	}

	const [conventions, brain, specs, neighbours] = await Promise.all([
		readProjectNote('conventions.md'), readProjectNote('brain/index.md'), readSpecs(mode),
		file ? neighbourSummary(file.relativePath) : Promise.resolve('')]);
	const subject = mode.writes === 'doc'
		? specs || 'No specs written yet.'
		: file ? [describeFile(file), neighbours].filter(Boolean).join('\n\n') : 'No file is open.';
	const messages = [
		...history(context),
		vscode.LanguageModelChatMessage.User(`${subject}\n\nRequest: ${prompt || '(no extra instructions)'}`),
	];

	const reply = await request.model.sendRequest(
		messages, { modelOptions: { system: systemPrompt(mode, conventions, brain) } }, token);

	const text = await streamUntilCode(reply.text, stream, mode, file);
	if (token.isCancellationRequested) {
		return {};
	}
	if (mode.writes === 'doc') {
		await proposeDoc(stream, mode, text);
	} else if (mode.writes !== 'none' && file) {
		proposeEdit(stream, mode, file, text);
	}
	void logExchange({ mode: mode.id, model: request.model.name, file: file?.relativePath, prompt, reply: text });
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

/** `/skill <name> <request>`: runs a SKILL.md as the mode. Without a known name, lists the skills. */
async function resolveSkill(
	extensionUri: vscode.Uri, prompt: string, stream: vscode.ChatResponseStream,
): Promise<{ mode: Mode; prompt: string } | undefined> {
	const skills = await loadSkills(extensionUri);
	const [name = '', ...rest] = prompt.trim().split(/\s+/);
	const skill = skills.get(name.toLowerCase());
	if (!skill) {
		const lines = [...skills.values()]
			.sort((a, b) => a.name.localeCompare(b.name))
			.map(s => `- **${s.name}** — ${s.description || 'no description'} _(${s.source})_`);
		stream.markdown(`${name ? `No skill called \`${name}\`. ` : ''}Use \`/skill <name> <what you want>\`.\n\n${lines.join('\n') || 'No skills found.'}\n\nAdd your own in \`.my_editor/skills/<name>/SKILL.md\` (this project) or \`~/.my_editor/skills/\` (everywhere).`);
		return undefined;
	}
	return { mode: { id: `skill:${skill.name}`, writes: skill.writes, instruction: skill.instruction }, prompt: rest.join(' ') };
}

/** The spec files a document mode works from, labelled by path. */
async function readSpecs(mode: Mode): Promise<string> {
	const parts = await Promise.all((mode.reads ?? []).map(async path => {
		const text = await readProjectNote(path.replace(/^\.my_editor\//, ''), 30_000);
		return text ? `${path}:\n${text}` : '';
	}));
	return parts.filter(Boolean).join('\n\n');
}

/** Writes a spec document through the same keep/undo review as code; creates the file if needed. */
async function proposeDoc(stream: vscode.ChatResponseStream, mode: Mode, reply: string): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	const content = lastCodeBlock(reply);
	if (!root || !mode.doc || content === undefined) {
		return; // Still interviewing: nothing to write yet.
	}
	const uri = vscode.Uri.joinPath(root, mode.doc);
	try {
		await vscode.workspace.fs.stat(uri);
	} catch {
		await vscode.workspace.fs.writeFile(uri, new Uint8Array());
	}
	stream.markdown(`\n\nReview \`${mode.doc}\` in the editor — keep or undo each part.`);
	stream.textEdit(uri, [vscode.TextEdit.replace(new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), content.endsWith('\n') ? content : `${content}\n`)]);
	stream.textEdit(uri, true);
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
