// @ts-check
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
const question = /** @type {HTMLTextAreaElement} */ (byId('question'));
let key;
let busy = false;
const drafts = new Map();
const post = (type, extra = {}) => vscode.postMessage({ type, key, ...extra });

function message(role, text) {
	const article = document.createElement('article');
	article.className = role;
	const label = document.createElement('strong');
	label.textContent = role === 'user' ? 'You' : 'Pair';
	const body = document.createElement('div');
	// Model output is always text, including code; it cannot inject links, scripts or commands.
	body.textContent = text;
	article.append(label, body);
	return article;
}

window.addEventListener('message', event => {
	const state = event.data;
	if (state?.type === 'reset') {
		drafts.delete(state.key); if (state.key === key) { question.value = ''; } return;
	}
	if (state?.type !== 'state') { return; }
	if (state.key !== key) {
		if (key) { drafts.set(key, question.value); }
		key = state.key;
		question.value = drafts.get(key) ?? state.chat?.draft ?? '';
	}
	busy = state.busy;
	byId('file').textContent = state.path ?? 'File chat';
	byId('scope').textContent = state.key ? state.selection : '';
	byId('empty').hidden = !!state.key;
	byId('content').hidden = !state.key;
	const messages = byId('messages');
	const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 100;
	messages.replaceChildren(...(state.chat?.messages ?? []).map(item => message(item.role, item.text)));
	if (state.partial) { messages.append(message('assistant', state.partial)); }
	else if (busy) { messages.append(message('assistant', 'Thinking…')); }
	byId('error').textContent = state.error ?? '';
	byId('stop').hidden = !busy;
	byId('send').disabled = busy;
	byId('new').disabled = busy;
	for (const button of document.querySelectorAll('[data-action]')) { button.disabled = busy; }
	if (nearBottom) { window.scrollTo(0, document.body.scrollHeight); }
});

question.addEventListener('input', () => { drafts.set(key, question.value); post('draft', { text: question.value }); });
document.querySelector('form').addEventListener('submit', event => {
	event.preventDefault();
	if (busy || !question.value.trim()) { return; }
	post('send', { text: question.value }); question.value = ''; drafts.set(key, '');
});
question.addEventListener('keydown', event => {
	if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
		event.preventDefault(); document.querySelector('form').requestSubmit();
	}
});
for (const button of document.querySelectorAll('[data-action]')) {
	button.addEventListener('click', () => post('action', { action: button.dataset.action }));
}
byId('new').addEventListener('click', () => { post('new'); question.value = ''; drafts.set(key, ''); });
for (const type of ['stop', 'model', 'project']) { byId(type).addEventListener('click', () => post(type)); }
vscode.postMessage({ type: 'ready' });
