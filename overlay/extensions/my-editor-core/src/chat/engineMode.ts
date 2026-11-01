import type * as vscode from 'vscode';
import { currentFile, FileContext } from '../pair/context';
import { Mode, MODES } from '../pair/prompts';
import { loadSkills } from '../skills/loader';
import type { RunInput, Sink } from './engineTypes';

/** Resolve built-in and user-installed modes before asking a model. */
export async function resolveMode(extensionUri: vscode.Uri, id: string, prompt: string, sink: Sink):
	Promise<{ mode: Mode; prompt: string } | undefined> {
	let mode: Mode | undefined = MODES[id];
	if (id === 'skill' || id.startsWith('skill:')) {
		const name = id === 'skill' ? prompt.trim().split(/\s+/)[0] ?? '' : id.slice(6);
		if (id === 'skill') { prompt = prompt.trim().slice(name.length).trim(); }
		const skill = (await loadSkills(extensionUri)).get(name.toLowerCase());
		if (!skill) { sink.text(`There is no skill called \`${name}\`. Pick one from the list at the top of the chat.`); return; }
		mode = { id: `skill:${skill.name}`, writes: skill.writes, instruction: skill.instruction };
	}
	if (!mode) { sink.text(`I don't know \`/${id}\`. Try /feature, /change, /next, /explain, /review, /brainstorm or a skill.`); return; }
	return { mode, prompt };
}

/** File-writing modes need a complete file or an explicit selection; false means the guard already explained the limit. */
export async function readModeFile(mode: Mode, input: RunInput, sink: Sink): Promise<FileContext | undefined | false> {
	let file: FileContext | undefined;
	try { file = await currentFile(input.activeFile); }
	catch (error) { sink.error(error instanceof Error ? error.message : String(error)); return false; }
	if ((mode.writes === 'file' || mode.writes === 'selection') && !file) {
		sink.text('Open the file you want to work on, then ask again.'); return false;
	}
	if (mode.writes === 'file' && file?.truncated) {
		sink.text(`\`${file.relativePath}\` is too long to rewrite as a whole. Select the part to work on and use \`/change\`.`); return false;
	}
	if (mode.writes === 'selection' && !file?.selection) {
		sink.text('Select the lines to change first, or use `/feature` to change the file.'); return false;
	}
	return file;
}
