import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { join } from 'node:path';

class Element {
	children: unknown[] = [];
	listeners = new Map<string, () => void>();
	attributes = new Map<string, string>();
	readonly style = { setProperty: (_name: string, _value: string) => undefined };
	readonly classList = { toggle: () => undefined };
	value = '';
	disabled = false;
	scrollHeight = 0;
	scrollTop = 0;
	clientHeight = 0;
	get lastElementChild(): Element | undefined { return this.children.at(-1) as Element | undefined; }
	setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
	append(...children: unknown[]): void { this.children.push(...children); }
	replaceChildren(...children: unknown[]): void { this.children = children; }
	addEventListener(name: string, handler: () => void): void { this.listeners.set(name, handler); }
	click(): void { if (!this.disabled) { this.listeners.get('click')?.(); } }
}

test('split chat webview loads in order and renders a Codex model selection', () => {
	const sent: { type: string }[] = [];
	let savedViewState: { chatTextSize?: number } = {};
	let receive: ((event: { data: unknown }) => void) | undefined;
	const document = {
		getElementById: () => new Element(), createElement: () => new Element(), createElementNS: () => new Element(),
	};
	const context = createContext({
		document, window: { addEventListener: (_name: string, handler: typeof receive) => { receive = handler; } },
		acquireVsCodeApi: () => ({ postMessage: (message: { type: string }) => sent.push(message),
			getState: () => savedViewState, setState: (value: { chatTextSize?: number }) => { savedViewState = value; } }),
	});
	for (const file of ['chatDom.js', 'chatFaces.js', 'chatCards.js', 'chatMenu.js', 'chat.js', 'chatFilePass.js', 'chatEvents.js']) {
		runInContext(readFileSync(join(process.cwd(), 'media', file), 'utf8'), context, { filename: file });
	}
	receive?.({ data: { type: 'init', project: 'm_dialer', projectPath: '/projects/m_dialer', skills: [], messages: [],
		characterId: 'bamboo', characters: [
			{ id: 'bamboo', name: 'Shan', role: 'Project guide', greeting: 'Hello' },
			{ id: 'soki', name: 'Soki', role: 'Requirements', greeting: 'Why?' },
			{ id: 'ada', name: 'Ada', role: 'Builder', greeting: 'Build?' },
			{ id: 'lisko', name: 'Architecture agent', role: 'Architecture', greeting: 'Design?' },
			{ id: 'flow', name: 'Flow & tree agent', role: 'Flow & tree', greeting: 'Map?' },
			{ id: 'diji', name: 'Diji', role: 'Reviewer', greeting: 'Review?' },
			{ id: 'poppy', name: 'Poppy', role: 'QA', greeting: 'Test?' },
			{ id: 'hopper', name: 'Hopper', role: 'Debugger', greeting: 'Debug?' },
		] } });
	receive?.({ data: { type: 'models', current: 'codex-cli:default', reasoning: 'high',
		models: [{ key: 'codex-cli:default', label: 'Codex', detail: 'local login', effortLevels: ['low', 'medium', 'high', 'xhigh'], reasoning: 'high' }] } });
	assert.equal(sent[0]?.type, 'ready');
	assert.equal(runInContext('reasoningSelect.hidden', context), false);
	assert.equal(runInContext('reasoningSelect.children.length', context), 5);
	receive?.({ data: { type: 'models', current: 'claude-cli:opus', models: [
		{ key: 'claude-cli:opus', label: 'Claude Opus', effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], reasoning: 'max' },
		{ key: 'claude-cli:legacy', label: 'Legacy', effortLevels: [], reasoning: 'default' },
	] } });
	assert.equal(runInContext('reasoningSelect.hidden', context), false);
	assert.equal(runInContext('reasoningSelect.children.length', context), 6);
	assert.equal(runInContext('state.reasoning', context), 'max');
	runInContext("reasoningSelect.value = 'low'; reasoningSelect.listeners.get('change')()", context);
	assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))), { type: 'reasoning', key: 'low', id: 'claude-cli:opus' });
	runInContext("modelSelect.value = 'claude-cli:legacy'; modelSelect.listeners.get('change')()", context);
	assert.equal(runInContext('reasoningSelect.hidden', context), true);
	assert.equal(runInContext('state.reasoning', context), 'default');
	runInContext("modelSelect.value = 'claude-cli:opus'; modelSelect.listeners.get('change')()", context);
	assert.equal(runInContext('state.reasoning', context), 'low');

	receive?.({ data: { type: 'character', characterId: 'ada' } });
	receive?.({ data: { type: 'filePass', agent: 'ada', root: 'file:///project', counts: '2 modules · 3 files',
		run: { options: { kind: 'Build' }, status: 'error', remaining: 3, message: 'claude-cli: OAuth session expired' } } });
	assert.equal(runInContext('filePassPanel.hidden', context), false);
	runInContext(`(() => {
		const buttons = filePassPanel.children.flatMap(node => node.children || []);
		buttons.find(node => node.children?.includes('Resume')).click();
	})()`, context);
	assert.equal((sent.at(-1) as unknown as { id: string }).id, 'resume');
	assert.equal((sent.at(-1) as unknown as { key: string }).key, 'ada');
	receive?.({ data: { type: 'character', characterId: 'soki' } });
	assert.equal(runInContext('filePassPanel.hidden', context), true);
	receive?.({ data: { type: 'character', characterId: 'poppy' } });
	receive?.({ data: { type: 'filePass', agent: 'poppy', root: 'file:///project', counts: '2 modules · 3 files' } });
	runInContext("filePassPanel.children[1].children[0].click()", context);
	assert.equal((sent.at(-1) as unknown as { id: string }).id, 'start');
	assert.equal((sent.at(-1) as unknown as { key: string }).key, 'poppy');
	assert.equal(runInContext('app.children.includes(filePassPanel)', context), false, 'Run controls must not sit over the conversation');
	assert.equal(runInContext('scroll.children.includes(filePassPanel)', context), true);
	receive?.({ data: { type: 'character', characterId: 'ada' } });
	receive?.({ data: { type: 'filePass', agent: 'ada', root: 'file:///project',
		run: { options: { kind: 'Build' }, status: 'complete', total: 1, remaining: 0, results: [], message: 'Build complete.' } } });
	assert.match(runInContext('JSON.stringify(filePassPanel.children)', context), /Next: QA/);
	runInContext("filePassPanel.children.find(node => node.attributes?.get('class') === 'actions run-actions').children.find(node => node.children.includes('Continue to QA')).click()", context);
	assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))), { type: 'character', id: 'poppy' });
	receive?.({ data: { type: 'character', characterId: 'poppy' } });
	const activity = { type: 'filePass', agent: 'poppy', root: 'file:///project', run: { options: { kind: 'QA' }, status: 'running',
		currentFile: { path: 'src/worker.ts', role: 'Process one job.' }, activity: 'Reading callers', total: 3, remaining: 2,
		results: [{ path: 'src/store.ts', outcome: 'saved', note: 'Added validation. Tests have not run.' }], message: 'Working' } };
	runInContext('scroll.scrollHeight = 2000; scroll.clientHeight = 600; scroll.scrollTop = 500', context);
	receive?.({ data: activity });
	assert.equal(runInContext('scroll.scrollTop', context), 2000, 'The initial run must be revealed when it arrives after the transcript');
	runInContext('scroll.scrollTop = 500', context);
	assert.match(runInContext('JSON.stringify(filePassPanel.children)', context), /src\/store.ts/);
	assert.match(runInContext('JSON.stringify(filePassPanel.children)', context), /Added validation/);
	assert.match(runInContext('JSON.stringify(filePassPanel.children)', context), /src\/worker.ts/);
	assert.match(runInContext("JSON.stringify(filePassPanel.children.find(node => node.attributes?.get('class') === 'pass-current'))", context), /1 of 3 files finished · 2 left/);
	runInContext('globalThis.beforeProgress = filePassPanel.children.at(-1)', context);
	receive?.({ data: { ...activity, run: { ...activity.run, activity: 'Preparing proposal' } } });
	assert.equal(runInContext('filePassPanel.children.at(-1) === beforeProgress', context), true, 'Live progress must preserve focused controls');
	assert.equal(runInContext('passActivity.textContent', context), 'Preparing proposal');
	receive?.({ data: { ...activity, following: true, run: { ...activity.run, preview: { path: 'src/worker.ts', content: 'export const worker = () => 1;\n' } } } });
	assert.equal(runInContext('scroll.scrollTop', context), 500, 'Later file updates must preserve a reader’s manual scroll position');
	assert.match(runInContext('JSON.stringify(filePassPanel.children)', context), /Prepared code · 1 line · not saved/);
	assert.match(runInContext('JSON.stringify(filePassPanel.children)', context), /export const worker/);
	assert.match(runInContext('JSON.stringify(filePassPanel.children)', context), /Hide file preview/);
	assert.equal(runInContext("filePassPanel.children.find(node => node.attributes?.get('class') === 'pass-current').children.find(node => node.attributes?.get('class') === 'pass-preview').attributes.has('open')", context), false);
	assert.equal(runInContext("filePassPanel.children.findIndex(node => node.attributes?.get('class') === 'pass-current') < filePassPanel.children.findIndex(node => node.attributes?.get('class') === 'pass-earlier')", context), true);
	const beforeHelp = sent.length;
	runInContext("filePassPanel.children.find(node => node.attributes?.get('class') === 'pass-help').listeners.get('toggle')()", context);
	assert.equal(sent.length, beforeHelp, 'Opening help must not issue a host command or pause the run');
	assert.equal(runInContext("filePassPanel.children.find(node => node.attributes?.get('class') === 'actions run-actions').children.every(button => !!button.title)", context), true);
	receive?.({ data: { type: 'context', file: '/project/unrelated.ts' } });
	assert.doesNotMatch(runInContext('JSON.stringify(context.children)', context), /unrelated.ts/);
	assert.equal(runInContext("activityLabel({activity:'Checking the project (10/60) · latest: read_file(old.ts:1)…'})", context), 'Reviewing the context for this file…');
	runInContext("filePassPanel.children.find(node => node.attributes?.get('class') === 'pass-earlier').children[1].children.at(-1).click()", context);
	assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))), { type: 'filePass', id: 'open', key: 'poppy', text: 'file:///project', href: 'src/store.ts' });
	assert.equal(runInContext("fileProgress({phase:'build',total:3,remaining:1,results:[{outcome:'saved'},{outcome:'existing'}]})", context),
		'2 of 3 files processed · 1 left to build (1 saved, 1 already present, 0 previously reviewed) · QA follows');
	assert.equal(runInContext("fileProgress({phase:'qa',total:3,remaining:2,results:[{outcome:'reviewed'}]})", context),
		'1 of 3 files reviewed · 2 left in QA (0 edits saved; verification tracked separately)');
	receive?.({ data: { ...activity, run: { ...activity.run, currentFile: { path: 'src/store.ts' },
		repairQueue: [{ path: 'src/store.ts', origin: 'src/worker.ts', reason: 'Align the approved ID contract.' }] } } });
	assert.match(runInContext("JSON.stringify(filePassPanel.children.find(node => node.attributes?.get('class') === 'pass-current'))", context), /Repairing/);
	assert.match(runInContext('JSON.stringify(filePassPanel.children)', context), /Coordinated repair/);

	// A selected model stays selected after validation errors mentioning a data-models section.
	for (const errorAction of [undefined, 'chooseModel']) {
		receive?.({ data: { type: 'messages', messages: [{ id: 'error1', role: 'assistant', done: true, proposals: [], actions: [],
			error: 'Proposed architecture: architecture section #data-models needs requirement links and an interface.', errorAction }] } });
		const buttons = runInContext(`(() => {
			const collect = node => typeof node === 'string' ? [node] : (node.children || []).flatMap(collect);
			return collect(scroll).filter(text => text === 'Choose a model').length;
		})()`, context);
		assert.equal(buttons, errorAction ? 1 : 0);
		assert.equal(runInContext('state.model', context), 'claude-cli:opus');
	}

	receive?.({ data: { type: 'character', characterId: 'ada', pinned: false, reason: 'Building together' } });
	assert.equal(runInContext('state.characterId', context), 'ada');
	assert.equal(runInContext('rail.children.length', context), 2);
	assert.equal(runInContext('rail.children[1].children.length', context), 8);
	assert.equal(runInContext('FACES.flow !== FACES.lisko && FACES.ada !== FACES.bamboo && FACES.poppy !== FACES.hopper', context), true);
	runInContext('header.children[2].children[1].children[1].click()', context);
	assert.equal(savedViewState.chatTextSize, 14);
	runInContext('header.children[2].children[1].children[0].click()', context);
	assert.equal(savedViewState.chatTextSize, 13);
	runInContext('rail.children[1].children[5].click()', context);
	assert.equal(runInContext('state.characterId', context), 'ada', 'Wait for the host before changing the visible agent');
	assert.equal(sent.at(-1)?.type, 'character');
	receive?.({ data: { type: 'conversation', conversationId: 'shared', chatLayout: 'shared', characterId: 'diji', pinned: true, messages: [] } });
	runInContext('header.children[2].children[0].click()', context);
	assert.equal(sent.at(-1)?.type, 'autoCharacter');

	receive?.({ data: { type: 'messages', messages: [{ id: 'q1', role: 'assistant', html: '<p>Choose?</p>', done: true,
		proposals: [], actions: [], nextStep: 'Next: Architecture will design the system.',
		choices: [{ label: 'Full architecture', description: 'Write all component interfaces.' }, { label: 'Decide for me' }] }] } });
	assert.match(runInContext('JSON.stringify(scroll.children[0])', context), /Next: Architecture will design the system/);
	assert.equal(runInContext("scroll.children[0].children[1].children.find(node => node.attributes?.get('class') === 'reply-choices').children.length", context), 2);
	runInContext("scroll.children[0].children[1].children.find(node => node.attributes?.get('class') === 'reply-choices').children[0].click()", context);
	assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))), { type: 'answer', id: 'q1', index: 0 });
	assert.equal(runInContext("scroll.children[0].children[1].children.find(node => node.attributes?.get('class') === 'reply-choices').children.every(button => button.disabled)", context), true);
	const count = sent.length;
	runInContext("scroll.children[0].children[1].children.find(node => node.attributes?.get('class') === 'reply-choices').children[0].click()", context);
	assert.equal(sent.length, count);

	// Separate chats replace the transcript and preserve a draft per agent; the model stays selected.
	runInContext("input.value = 'shared draft'", context);
	receive?.({ data: { type: 'conversation', conversationId: 'soki', chatLayout: 'agents', characterId: 'soki', pinned: true,
		mode: 'requirements', label: 'Requirements', messages: [] } });
	assert.equal(runInContext('state.messages.length', context), 0);
	assert.equal(runInContext('input.value', context), '');
	assert.equal(runInContext('header.children[2].children[0].hidden', context), true);
	runInContext("input.value = 'requirements draft'", context);
	receive?.({ data: { type: 'conversation', conversationId: 'lisko', chatLayout: 'agents', characterId: 'lisko', mode: 'architecture', messages: [] } });
	assert.equal(runInContext('input.value', context), '');
	assert.equal(runInContext('state.mode', context), 'architecture');
	receive?.({ data: { type: 'conversation', conversationId: 'soki', chatLayout: 'agents', characterId: 'soki', mode: 'requirements', messages: [] } });
	assert.equal(runInContext('input.value', context), 'requirements draft');
	assert.equal(runInContext('state.model', context), 'claude-cli:opus');
	runInContext("header.children[2].children[5].value = 'shared'; header.children[2].children[5].listeners.get('change')()", context);
	assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))), { type: 'chatLayout', id: 'shared' });
	receive?.({ data: { type: 'conversation', conversationId: 'shared', chatLayout: 'shared', characterId: 'diji', messages: [] } });
	assert.equal(runInContext('input.value', context), 'shared draft');
	receive?.({ data: { type: 'messages', messages: [{ id: 'end', role: 'assistant', html: '<p>Done</p>', done: true, proposals: [], actions: [] }] } });

	// Background refreshes must preserve the reading position; new messages follow the conversation.
	runInContext('scroll.scrollHeight = 2000; scroll.clientHeight = 300; scroll.scrollTop = 240; renderScroll()', context);
	assert.equal(runInContext('scroll.scrollTop', context), 240);
	runInContext('renderScroll(true)', context);
	assert.equal(runInContext('scroll.scrollTop', context), 2000);
});
