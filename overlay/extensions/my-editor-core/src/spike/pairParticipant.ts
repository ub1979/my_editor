import * as vscode from 'vscode';

const LINE_COMMENT: Record<string, string> = {
	python: '#', shellscript: '#', ruby: '#', yaml: '#', dockerfile: '#', makefile: '#',
};

/**
 * M0 spike: `@pair` answers through the selected model, then proposes a one-line edit to
 * the active file via `response.textEdit`. Proves the core inline accept/reject review works
 * for our participant in a fork without Copilot.
 */
export function registerPairParticipant(): vscode.Disposable {
	const handler: vscode.ChatRequestHandler = async (request, _context, stream, token) => {
		const reply = await request.model.sendRequest(
			[vscode.LanguageModelChatMessage.User(request.prompt)], {}, token);
		for await (const chunk of reply.text) {
			stream.markdown(chunk);
		}

		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			stream.markdown('\n\nOpen a file and ask again to see a proposed edit.');
			return;
		}

		const marker = LINE_COMMENT[editor.document.languageId] ?? '//';
		const line = `${marker} my_editor spike: proposed by @pair — accept or reject this line\n`;
		stream.markdown('\n\nProposed edit below — review it in the editor.');
		stream.textEdit(editor.document.uri, [vscode.TextEdit.insert(new vscode.Position(0, 0), line)]);
		stream.textEdit(editor.document.uri, true);
	};

	return vscode.chat.createChatParticipant('myEditor.pair', handler);
}
