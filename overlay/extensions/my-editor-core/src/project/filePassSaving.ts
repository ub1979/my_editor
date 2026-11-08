/** These permissions never apply outside the current run or to existing extra files. */
export const savingChoices = [
	{ label: 'Review each change', description: 'Wait for Keep on each file and new test', automatic: false, companionTests: 'review' as const, unattended: false },
	{ label: 'Auto-save planned files', description: 'Review additional test files before saving', automatic: true, companionTests: 'review' as const, unattended: false },
	{ label: 'Auto-save files and new tests', description: 'Allow validated files and new companion tests for this run; no repeated Keep prompts', automatic: true, companionTests: 'automatic' as const, unattended: false },
	{ label: 'Unattended run…', description: 'Approve saves, new tests and test commands up front; continue through QA and finish automatically',
		automatic: true, companionTests: 'automatic' as const, unattended: true },
];
