import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('regenerating themes preserves shipped readability fixes', () => {
	const script = resolve(process.cwd(), '../../../scripts/gen-themes.py');
	const generated = JSON.parse(execFileSync('python3', ['-c',
		'import runpy,json,sys; m=runpy.run_path(sys.argv[1]); print(json.dumps([m["theme"]("my_editor Paper",True),m["theme"]("my_editor Night",False)]))', script],
		{ encoding: 'utf8' }));
	for (const [index, name] of ['paper', 'night'].entries()) {
		const theme = JSON.parse(readFileSync(resolve(process.cwd(), `../my-editor-look/themes/${name}-color-theme.json`), 'utf8'));
		assert.deepEqual(generated[index], theme, `${name} theme must match its generator`);
		const colors: Record<string, string> = theme.colors;
		for (const [foreground, background] of [
			['editor.foreground', 'editor.background'], ['editorLineNumber.foreground', 'editor.background'],
			['editorCodeLens.foreground', 'editor.background'], ['settings.headerForeground', 'editor.background'],
			['input.foreground', 'input.background'], ['input.placeholderForeground', 'input.background'],
			['button.foreground', 'button.background'], ['descriptionForeground', 'sideBar.background'],
		]) {
			const luminance = (hex: string) => {
				const rgb = hex.slice(1, 7).match(/../g)!.map(value => parseInt(value, 16) / 255)
					.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
				return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
			};
			const a = luminance(colors[foreground]), b = luminance(colors[background]);
			assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, `${name}: ${foreground} on ${background}`);
		}
	}
});
