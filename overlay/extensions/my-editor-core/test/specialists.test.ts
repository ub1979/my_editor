import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CHARACTERS, characterPrompt } from '../src/chat/characters';
import { SPECIALISTS } from '../src/chat/specialists';
import { routeCharacter } from '../src/chat/characterRouting';

test('all Appling development gaps have isolated selectable host roles without changing route precedence', () => {
 assert.equal(SPECIALISTS.length, 13);
 assert.equal(new Set(CHARACTERS.map(item => item.id)).size, 22);
 for (const role of SPECIALISTS) {
  assert.equal(routeCharacter('/' + role.id, undefined, 'bamboo', false).id, role.id);
  assert.equal(routeCharacter('/' + role.id, undefined, 'ada', true).id, 'ada');
  assert.match(characterPrompt(role.id), /All file changes remain proposals under Keep\/Undo/);
  assert.match(characterPrompt(role.id), /Do not resume paused QA/);
 }
 assert.equal(routeCharacter('security audit', undefined, 'bamboo', false).id, 'security-auditor');
 assert.equal(routeCharacter('accessibility audit', undefined, 'bamboo', false).id, 'a11y-auditor');
 assert.equal(routeCharacter('security audit', 'review', 'bamboo', false).id, 'diji');
 assert.equal(routeCharacter('Where should I change deployment?', undefined, 'bamboo', false).id, 'bamboo');
 assert.doesNotMatch(characterPrompt('ada'), /Record a scoped pattern/);
});
