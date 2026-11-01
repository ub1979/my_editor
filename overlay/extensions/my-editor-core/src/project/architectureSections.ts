import { planningSections, PlanningSection } from './planningSections';

/** Document topics describe the system as a whole; they are not independently implemented components. */
function topic(title: string): string {
	return title.replace(/^\d+(?:\.\d+)*[.)]?\s*/, '').toLowerCase().replace(/[-_&/]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const GROUP = /^(?:(?:system|runtime|shared|major) )?(?:components|building blocks|services|modules|packages|subsystems)(?: and (?:packages|services|modules))?$/;
const OVERVIEW = /^(?:architecture|overview|(?:system |architecture |project )?overview|(?:technology |tech )?stack|(?:main |system |main system )?flow|how it fits together|(?:data |domain )models?|(?:data )storage|(?:shared |public )?apis?(?: and (?:contracts|interfaces))?|api (?:design|contracts|conventions)|events?(?: and (?:messages|messaging))?|decisions(?: and trade offs)?|trade offs|testing(?: strategy)?|security|deployment|failure handling|error handling|risks(?: and open (?:items|questions))?|open (?:items|questions)|follow ups(?: for tree.json)?|requirements(?: mapping)?|constraints|assumptions)$/;
const INTERFACE = /\b(?:interfaces?|API|inputs?|outputs?|contracts?|routes?|endpoints?|HTTP|SSE|CLI|commands?|config(?:uration)?)\b|`[\w.$]+\([^`\n]*\)`/i;

export function hasComponentContract(body: string): boolean {
	return /\bN?FR-\d{3,}\b/.test(body) && INTERFACE.test(body);
}

/** Component sections may be flat or grouped; their nested API/data headings belong to that component. */
export function architectureComponentSections(text: string): PlanningSection[] {
	const sections = planningSections(text);
	const grouped = sections.some(section => GROUP.test(topic(section.title)));
	const selected: PlanningSection[] = [];
	const parents: PlanningSection[] = [];
	for (const section of sections) {
		while (parents.length && parents.at(-1)!.level >= section.level) { parents.pop(); }
		const inGroup = parents.some(parent => GROUP.test(topic(parent.title)));
		const inComponent = parents.some(parent => selected.includes(parent));
		const name = topic(section.title);
		// A short title such as API may name a real component with a specific ID such as internal-api.
		const general = OVERVIEW.test(name) && OVERVIEW.test(topic(section.anchor ?? '')) && !hasComponentContract(section.body);
		if (section.anchor && section.level > 1 && !inComponent && !GROUP.test(name) && (grouped ? inGroup : !general)) {
			selected.push(section);
		}
		parents.push(section);
	}
	return selected;
}

/** All explicit anchors remain valid link destinations, including overview and component subsections. */
export function architectureAnchors(text: string): Map<string, string> {
	return new Map(planningSections(text).flatMap(section => section.anchor ? [[section.anchor, section.body]] : []));
}
