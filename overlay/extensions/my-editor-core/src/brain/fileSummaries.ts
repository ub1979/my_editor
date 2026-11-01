import * as vscode from 'vscode';
import type { Sink } from '../chat/engineTypes';
import { ApiKeys } from '../models/secrets';
import { ModelEntry } from '../models/types';
import { redact } from '../records/redact';
import { isSensitiveFile } from '../records/sensitive';
import { FilePiece, SourceFile, splitAtDefinitions } from './analysisPlan';
import { COMBINE_SYSTEM, hashOf, plural, summarise, SUMMARY_SYSTEM } from './analysisModel';
import { BrainMap, FileSummary, readText, saveSummaries } from './brain';

interface PendingFile extends SourceFile { readonly hash: string }
const MAX_SUMMARISED = 1_500;

/** Read only changed, non-sensitive files; put heavily used source first. */
async function staleFiles(built: BrainMap, paths: string[], folder: vscode.Uri): Promise<PendingFile[]> {
	const stale: PendingFile[] = [];
	for (const file of paths.filter(p => !isSensitiveFile(p))) {
		const raw = await readText(vscode.Uri.joinPath(folder, file));
		if (!raw?.trim()) { continue; }
		const hash = hashOf(raw);
		if (built.files[file].summaryHash !== hash || !built.files[file].summary) { stale.push({ path: file, text: redact(raw), hash }); }
	}
	return stale.sort((a, b) => built.files[b.path].importedBy.length - built.files[a.path].importedBy.length || a.path.localeCompare(b.path));
}

function pieceInputs(todo: PendingFile[]): { items: SourceFile[]; piecesOf: Map<string, FilePiece[]>; partlyRead: string[] } {
	const items: SourceFile[] = [], partlyRead: string[] = [];
	const piecesOf = new Map<string, FilePiece[]>();
	for (const file of todo) {
		if (file.text.length <= 10_000) { items.push({ path: file.path, text: file.text }); continue; }
		const { pieces, complete } = splitAtDefinitions(file.text, 10_000, 30);
		piecesOf.set(file.path, pieces);
		if (!complete) { partlyRead.push(file.path); }
		pieces.forEach((piece, i) => items.push({ path: `${file.path}#${i + 1}`, text: `(lines ${piece.start}–${piece.end})\n${piece.text}` }));
	}
	return { items, piecesOf, partlyRead };
}

function combineInputs(piecesOf: Map<string, FilePiece[]>, found: Record<string, string>): SourceFile[] {
	return [...piecesOf].flatMap(([file, pieces]) => {
		const lines = pieces.map((piece, i) => found[`${file}#${i + 1}`] ? `Lines ${piece.start}–${piece.end}: ${found[`${file}#${i + 1}`]}` : '').filter(Boolean);
		return lines.length ? [{ path: file, text: lines.join('\n') }] : [];
	});
}

function collect(todo: PendingFile[], piecesOf: Map<string, FilePiece[]>, found: Record<string, string>, combined: Record<string, string>): Record<string, FileSummary> {
	const summaries: Record<string, FileSummary> = {};
	for (const file of todo) {
		const pieces = piecesOf.get(file.path);
		if (!pieces) {
			if (found[file.path]) { summaries[file.path] = { summary: found[file.path], hash: file.hash }; }
			continue;
		}
		const pieceSummaries = pieces.flatMap((piece, i) => found[`${file.path}#${i + 1}`]
			? [{ start: piece.start, end: piece.end, summary: found[`${file.path}#${i + 1}`] }] : []);
		if (combined[file.path]) { summaries[file.path] = { summary: combined[file.path], hash: file.hash, pieces: pieceSummaries }; }
	}
	return summaries;
}

/** Summarisation is a replaceable stage; document drafting only consumes its map and coverage. */
export async function summariseSourceFiles(built: BrainMap, paths: string[], folder: vscode.Uri, model: ModelEntry,
	keys: ApiKeys, token: vscode.CancellationToken, sink: Sink) {
	const secretFiles = paths.filter(file => isSensitiveFile(file)).length;
	const stale = await staleFiles(built, paths, folder);
	const todo = stale.slice(0, MAX_SUMMARISED);
	const { items, piecesOf, partlyRead } = pieceInputs(todo);
	sink.progress(todo.length ? `Summarising ${plural(todo.length, 'file')} with ${model.label}…` : 'Every file summary is up to date…');
	const found = await summarise(items, SUMMARY_SYSTEM, model, keys, token, done => sink.progress(`Summarised ${done} of ${items.length}…`));
	const combine = combineInputs(piecesOf, found);
	const combined = combine.length && !token.isCancellationRequested
		? await summarise(combine, COMBINE_SYSTEM, model, keys, token, () => sink.progress('Putting the long files together…')) : {};
	const summaries = collect(todo, piecesOf, found, combined);
	return { summaries, map: await saveSummaries(summaries) ?? built, upToDate: paths.length - secretFiles - stale.length,
		coverage: { secretFiles, inPieces: piecesOf.size, partlyRead, leftForLater: stale.length - todo.length, failed: todo.length - Object.keys(summaries).length } };
}
