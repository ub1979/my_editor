import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { join } from 'node:path';

class Element {
	children: unknown[] = [];
	readonly style = {};
	readonly classList = { toggle: () => undefined };
	value = '';
	scrollHeight = 0;
	scrollTop = 0;
	clientHeight = 0;
	setAttribute(): void {}
	append(...children: unknown[]): void { this.children.push(...children); }
	replaceChildren(...children: unknown[]): void { this.children = children; }
	addEventListener(): void {}
}

test('split chat webview loads in order and renders a Codex model selection', () => {
	const sent: { type: string }[] = [];
	let receive: ((event: { data: unknown }) => void) | undefined;
	const document = {
		getElementById: () => new Element(), createElement: () => new Element(), createElementNS: () => new Element(),
	};
	const context = createContext({
		document, window: { addEventListener: (_name: string, handler: typeof receive) => { receive = handler; } },
		acquireVsCodeApi: () => ({ postMessage: (message: { type: string }) => sent.push(message) }),
	});
	for (const file of ['chatDom.js', 'chatCards.js', 'chat.js']) {
		runInContext(readFileSync(join(process.cwd(), 'media', file), 'utf8'), context, { filename: file });
	}
	receive?.({ data: { type: 'init', project: 'm_dialer', projectPath: '/projects/m_dialer', skills: [], messages: [] } });
	receive?.({ data: { type: 'models', current: 'codex-cli:default', reasoning: 'high',
		models: [{ key: 'codex-cli:default', label: 'Codex', detail: 'local login' }] } });
	assert.equal(sent[0]?.type, 'ready');
	assert.equal(runInContext('reasoningSelect.hidden', context), false);
	assert.equal(runInContext('reasoningSelect.children.length', context), 5);
});
