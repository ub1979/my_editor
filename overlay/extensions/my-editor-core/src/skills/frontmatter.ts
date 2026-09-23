/** A parsed SKILL.md: YAML-ish frontmatter (flat `key: value` pairs) plus the instruction body. */
export interface SkillFile {
	readonly meta: Record<string, string>;
	readonly body: string;
}

/** Parses the flat frontmatter used by Lyra and Claude Code skills. Nested YAML is ignored. */
export function parseSkill(text: string): SkillFile {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
	if (!match) {
		return { meta: {}, body: text.trim() };
	}
	const meta: Record<string, string> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
		if (pair) {
			meta[pair[1]] = pair[2].trim().replace(/^(["'])(.*)\1$/, '$2');
		}
	}
	return { meta, body: match[2].trim() };
}
