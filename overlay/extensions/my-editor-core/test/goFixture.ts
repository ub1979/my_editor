import { mkdtempSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { goInstallDirs } from '../src/aiready/goAdapter';
import { buildGoHelper, goFileInfo } from '../src/aiready/goAst';
import { GoFileInfo, goFileInfoView, platforms } from '../src/aiready/goRules';
import { findTool } from '../src/aiready/projectCommands';

/** Test helper: parses Go source with the real helper, or undefined when Go is not installed. */
let helper: Promise<string | undefined> | undefined;
const work = mkdtempSync(path.join(os.tmpdir(), 'my-editor-goast-test-'));

function helperPath(): Promise<string | undefined> {
	const go = findTool('go', goInstallDirs());
	helper ??= go
		? buildGoHelper(path.resolve(__dirname, '../../resources/goast/main.go'), path.join(os.tmpdir(), 'my-editor-goast-cache'), 'test', go)
		: Promise.resolve(undefined);
	return helper;
}

export async function goInfo(file: string, text: string | Buffer, packageNames: ReadonlyMap<string, string> = new Map()):
	Promise<{ source: Buffer; info: GoFileInfo } | undefined> {
	const binary = await helperPath();
	if (!binary) { return undefined; }
	const source = Buffer.isBuffer(text) ? text : Buffer.from(text);
	const full = path.join(work, file.replace(/\//g, '_'));
	writeFileSync(full, source);
	return { source, info: goFileInfoView(file, await goFileInfo(binary, full), packageNames) };
}

/** Go's platform names plus two made-up ones, so a newer `go tool dist list` is honoured. */
export const KNOWN = platforms('linux/amd64\nwindows/arm64\nnewos/newarch\n');
export const YAML = new Map([['gopkg.in/yaml.v3', 'yaml'], ['fmt', 'fmt'], ['strings', 'strings']]);

/** A package file with every kind of declaration the split rules care about. IDs 0–8. */
export const SHOP = `package shop

import (
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

// Kind is an enum.
type Kind int

const (
	KindA Kind = iota
	KindB
)

var counter = 1

var _ fmt.Stringer
var _ fmt.Stringer

var cache map[string]int

// Detached note about encoding.

// Encode writes v as YAML.
func Encode(v any) ([]byte, error) { return yaml.Marshal(v) } // nolint

// Upper shouts.
func Upper(s string) string { return strings.ToUpper(s) }

func describe(k Kind) string { return fmt.Sprint(k) }
`;
