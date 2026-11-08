import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { join } from 'node:path';

class Element {
	children: Element[] = [];
	listeners = new Map<string, (event?: unknown) => void>();
	value = ''; textContent = ''; disabled = false; hidden = false;
	append(...children: Element[]): void { this.children.push(...children); }
	replaceChildren(...children: Element[]): void { this.children = children; }
	addEventListener(name: string, handler: (event?: unknown) => void): void { this.listeners.set(name, handler); }
}

test('file chat UI replaces history, scopes actions and drafts, and renders model output as inert text', () => {
	const sent: Record<string, unknown>[] = [];
	const elements = new Map<string, Element>();
	const get = (id: string) => {
		if (!elements.has(id)) { elements.set(id, new Element()); }
		return elements.get(id)!;
	};
	let receive: (event: { data: unknown }) => void = () => {};
	const context = createContext({
		document: { getElementById: get, createElement: () => new Element(), querySelector: get,
			querySelectorAll: () => [], body: { scrollHeight: 100 } },
		window: { addEventListener: (_name: string, handler: typeof receive) => { receive = handler; },
			innerHeight: 500, scrollY: 0, scrollTo: () => {} },
		acquireVsCodeApi: () => ({ postMessage: (message: Record<string, unknown>) => sent.push(message) }),
	});
	runInContext(readFileSync(join(process.cwd(), 'media/filechat.js'), 'utf8'), context);
	const state = (key: string, text: string, busy = false) => receive({ data: { type: 'state', key, path: key, busy,
		chat: { draft: '', messages: [{ role: 'assistant', text }] } } });
	state('a/file.py', 'A reply');
	assert.equal(get('messages').children[0].children[1].textContent, 'A reply');
	get('question').value = 'draft A'; get('question').listeners.get('input')!();
	assert.equal(sent.at(-1)?.key, 'a/file.py');
	state('b/file.py', 'B reply');
	assert.equal(get('question').value, '');
	assert.equal(get('messages').children.length, 1);
	assert.equal(get('messages').children[0].children[1].textContent, 'B reply');
	get('question').value = 'draft B';
	state('a/file.py', '<script>malicious()</script>');
	assert.equal(get('question').value, 'draft A');
	assert.equal(get('messages').children[0].children[1].textContent, '<script>malicious()</script>');
	assert.equal(get('messages').children[0].children[1].children.length, 0);
	state('a/file.py', 'streaming', true);
	assert.equal(get('send').disabled, true);
	assert.equal(get('stop').hidden, false);
	assert.equal(get('question').value, 'draft A');
	state('b/file.py', 'B reply');
	get('form').listeners.get('submit')!({ preventDefault() {} });
	assert.equal(sent.at(-1)?.key, 'b/file.py');
	assert.equal(sent.at(-1)?.text, 'draft B');
	receive({ data: { type: 'reset', key: 'a/file.py' } });
	state('a/file.py', 'fresh');
	assert.equal(get('question').value, '');
	receive({ data: { type: 'state', key: 'package.json', path: 'package.json', busy: false,
		build: { title: 'Step 1: Workspace', position: 'File 1 of 2', purpose: 'Configure scripts', instruction: 'Start here',
			tasks: ['<script>inert()</script>'], checks: ['Parse JSON'], files: ['package.json', 'tsconfig.json'], next: 'tsconfig.json' } } });
	assert.equal(get('build').hidden, false);
	assert.equal(get('buildPurpose').textContent, 'Configure scripts');
	assert.equal(get('buildTasks').children[0].textContent, '<script>inert()</script>');
	assert.equal(get('buildFile').disabled, false);
	get('buildNext').listeners.get('click')!();
	assert.equal(sent.at(-1)?.key, 'package.json');
	assert.equal(sent.at(-1)?.type, 'buildNext');
	state('unplanned.py', 'No build card');
	assert.equal(get('build').hidden, true);
	assert.equal(get('buildFile').disabled, false);
	get('qaFile').listeners.get('click')!();
	assert.equal(sent.at(-1)?.key, 'unplanned.py');
	assert.equal(sent.at(-1)?.type, 'qaFile');
});
