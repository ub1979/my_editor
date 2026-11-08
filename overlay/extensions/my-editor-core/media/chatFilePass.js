// @ts-check
// Run activity shares the conversation scroller; nothing is layered over chat text.
let filePassState, passSignature = '', passActivity, passActivityDetail, passHadRun = false, passHelpOpen = false, passHistoryOpen = false;
const filePassPanel = el('section', { class: 'file-pass', 'aria-label': 'Build and QA controls' });
scroll.append(filePassPanel);

function renderFilePass() {
	const kind = state.characterId === 'ada' ? 'Build' : state.characterId === 'poppy' ? 'QA' : undefined;
	filePassPanel.hidden = !kind || showSkills;
	if (!kind) { passHadRun = false; passSignature = ''; return; }
	const data = filePassState?.agent === state.characterId ? filePassState : undefined;
	const run = data?.run;
	const signature = JSON.stringify([state.characterId, state.running, data && { ...data, run: run && { ...run, activity: undefined, activityAt: undefined } }]);
	if (signature === passSignature) {
		if (passActivity && run?.status === 'running') { passActivity.textContent = activityLabel(run); }
		if (passActivityDetail) { passActivityDetail.textContent = activityDetail(run); }
		return;
	}
	// Run data can arrive after the transcript. Reveal it once, then respect manual scrolling.
	const follow = !passSignature || !!run && !passHadRun || scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
	passHadRun = !!run;
	passSignature = signature; passActivity = undefined; passActivityDetail = undefined;
	filePassPanel.replaceChildren();
	const active = run && ['running', 'review', 'checkpoint'].includes(run.status);
	const button = (label, action, disabled = false, path = undefined) => {
		const node = el('button', { type: 'button' }, [label]);
		const help = {
			start: 'Choose the files, review cadence and saving permission for a new run.',
			file: 'Build or review the file selected in the editor.',
			open: 'View this saved file beside chat. The run continues.',
			follow: 'Show each current file beside chat, then close its temporary tab when finished. This does not pause the run. Your existing tabs and unsaved edits stay open.',
			pause: 'Pause the run. Saved files stay saved; you can resume later.',
			report: 'Open file summaries and recorded test results. The run continues.',
			resume: 'Continue from the saved progress after your review.',
			model: 'Choose the model for the remaining files in this run.',
			test: 'Choose and authorize a test task for the saved files.',
			review: 'Inspect the pending change before saving it.', keep: 'Save the reviewed change and continue.',
			answer: 'Answer the agent’s question so it can retry this file.',
			saving: 'Choose review, automatic saving, or unattended permission for files, new tests and test execution in this run.',
			speed: 'Generate up to three related files together or use one file per request. Each save is still checked. Applies to subsequent requests.',
			buildFirst: 'Pause and switch this run to build missing files first. Existing implementations await a separate QA stage. Resume when ready.',
		};
		node.title = help[action] || label;
		node.setAttribute('aria-description', node.title);
		node.disabled = disabled || !data?.root;
		if (node.disabled) { node.title = !data?.root ? 'Open a project first.' : active || state.running
			? 'Stop or finish the current run first.' : 'Open a source file to use this action.'; }
		node.addEventListener('click', () => vscode.postMessage({ type: 'filePass', id: action,
			key: state.characterId, text: data?.root, ...(path ? { href: path } : {}) }));
		return node;
	};
	filePassPanel.append(el('h2', {}, [run?.phase === 'build' ? '1. Build files' : run?.phase === 'qa' ? '2. QA and final tests'
		: run ? `${run.options?.kind ?? kind} progress` : `${kind} with AI`]));
	if (!active) { filePassPanel.append(el('div', { class: 'actions' }, [button(`${kind} project…`, 'start', state.running),
		button(`${kind} selected file…`, 'file', state.running || !data?.file)])); }
	if (data?.counts) { filePassPanel.append(el('p', { class: 'pass-meta' }, [data.counts])); }
	if (data?.problem) { filePassPanel.append(el('p', {}, [data.problem])); }
	if (!run) { return; }
	const results = run.results ?? [];
	if (run.buildResults) { filePassPanel.append(el('p', { class: 'pass-meta' }, [`Implementation stage: ${run.buildResults.length} files processed. QA progress below.`])); }
	filePassPanel.append(el('p', { class: 'pass-meta', role: 'status' }, [
		`${run.status} · ${fileProgress(run)}`,
	]));
	if (run.status !== 'complete') {
		const policy = run.options?.unattended ? 'Unattended · files, new tests and test commands approved' : run.options?.automatic ? run.options?.companionTests === 'automatic'
			? 'Auto-save files and new tests' : 'Auto-save files; review new tests' : 'Review each change';
		filePassPanel.append(el('div', { class: 'actions pass-saving' }, [el('span', { class: 'pass-meta' }, [`Saving: ${policy}`]), button('Change…', 'saving')]));
		if (run.options?.kind === 'Build' && !run.options?.selected && run.options?.interval !== 'file' && run.phase !== 'qa') {
			filePassPanel.append(el('div', { class: 'actions pass-saving' }, [el('span', { class: 'pass-meta' }, [
				`Build speed: ${run.options?.batchSize === 3 ? 'Related files together (up to 3)' : 'One file per request'}`]), button('Speed…', 'speed')]));
		}
	}
	if (run.batchPaths?.length > 1) { filePassPanel.append(el('p', { class: 'pass-meta' }, [`Preparing together: ${run.batchPaths.join(' · ')}`])); }
	const current = run.currentFile?.path ?? (run.status !== 'complete' ? run.modules?.flatMap(group => group.files)[results.length] : undefined);
	const repair = run.repairQueue?.find(item => item.path === current);
	if (run.repairQueue?.length) { filePassPanel.append(el('p', { class: 'pass-meta', role: 'status' }, [
		`Coordinated repair · ${run.repairQueue.length} file(s) queued · then return to ${run.repairQueue[0].origin}`,
	])); }
	if (current && (!results.some(result => result.path === current) || repair) && run.status !== 'complete') {
		const card = el('article', { class: 'pass-current', 'aria-label': 'Current file' }, [
			el('span', { class: 'pass-label' }, [repair ? 'Repairing' : run.status === 'running' ? 'Working on' : 'Current file']),
			el('code', { class: 'pass-path' }, [current]),
			el('p', { class: 'pass-meta', role: 'status' }, [fileProgress(run)]),
		]);
		if (repair) { card.append(el('p', {}, [repair.reason])); }
		if (run.currentFile?.role) { card.append(el('p', {}, [run.currentFile.role])); }
		if (run.step) { card.append(el('p', { class: 'pass-meta' }, [`Module: ${run.step}`])); }
		passActivity = el('p', { class: 'pass-meta', role: 'status' }, [run.status === 'running' ? activityLabel(run) : run.message]);
		card.append(passActivity);
		passActivityDetail = el('p', { class: 'pass-meta' }, [activityDetail(run)]);
		card.append(el('details', { class: 'pass-detail' }, [el('summary', {}, ['Activity details']), passActivityDetail]));
		if (run.preview?.path === current) {
			const lines = run.preview.content.trimEnd().split('\n').length;
			card.append(el('details', { class: 'pass-preview' }, [
				el('summary', {}, [`Prepared code · ${lines} ${lines === 1 ? 'line' : 'lines'} · not saved`]),
				el('pre', {}, [el('code', {}, [run.preview.content])]),
			]));
		}
		card.append(el('div', { class: 'actions' }, [button(data?.following ? 'Hide file preview' : 'Show files beside chat', 'follow')]));
		filePassPanel.append(card);
	} else { filePassPanel.append(el('p', {}, [run.message])); }
	if (run.status === 'checkpoint' && run.activity) {
		passActivityDetail = el('p', { class: 'pass-meta', role: 'status' }, [activityDetail(run)]);
		filePassPanel.append(passActivityDetail);
	}
	if (/claude-cli.*(?:auth|login|session expired)/i.test(run.message)) {
		filePassPanel.append(el('p', {}, ['Sign in to Claude Code again, then Resume, or choose another run model.']));
	}
	if (run.lastTest) { filePassPanel.append(el('p', { class: 'pass-test' }, [
		(run.status === 'running' ? 'Previous checkpoint: ' : '') + run.lastTest,
	])); }
	const actions = el('div', { class: 'actions run-actions' });
	if (run.pending?.length) { actions.append(button('Review diff', 'review'), button('Keep file', 'keep')); }
	if (run.needsAnswer) { actions.append(button('Answer question…', 'answer')); }
	if (run.status === 'checkpoint') {
		actions.append(button('Run tests…', 'test'));
		if (run.lastTestStatus === 'failed') {
			filePassPanel.append(el('p', { class: 'pass-test', role: 'status' }, ['Tests failed. Review the terminal output and rerun the tests after fixing the failures.']));
		} else {
			const label = run.lastTestStatus !== 'passed' ? 'Continue with tests unverified'
				: run.remaining ? 'Continue after review' : 'Finish after review';
			actions.append(button(label, 'resume'));
		}
	}
	if (['paused', 'error'].includes(run.status)) { actions.append(button('Resume', 'resume'), button('Choose run model…', 'model')); }
	if (!run.phase && run.options?.kind === 'Build' && run.options?.interval === 0 && !run.options?.selected && run.status !== 'complete') {
		actions.append(button('Build first, then QA', 'buildFirst'));
	}
	if (active) { actions.append(button('Pause', 'pause')); }
	actions.append(button('View report', 'report'));
	filePassPanel.append(actions);
	const help = el('details', { class: 'pass-help', ...(passHelpOpen ? { open: '' } : {}) }, [
		el('summary', {}, ['What do these controls do?']),
		el('p', {}, ['Reading this help, opening a report, or viewing files does not pause the run.']),
		el('p', {}, ['Show files beside chat: follows the current file. Its temporary preview closes when finished. Existing, pinned and unsaved tabs are kept. Hide file preview changes only the view.']),
		el('p', {}, ['Pause: stops further work and preserves saved progress. Resume continues later. View report: shows file summaries and recorded test results.']),
		el('p', {}, ['Saving → Change: review each file, auto-save planned files, or auto-save files and new tests for this run. Automatic saving keeps the normal validation checks. Design questions and failed checks can still pause the run.']),
		el('p', {}, ['Unattended run: approve saves, QA fixes, new tests and detected project test commands up front. No repeated Keep, companion-test or test-task prompts; passing final checks finish automatically. Pause stops the run; changing permissions revokes future automatic actions. Design blockers, changed plans or failing final checks may still need attention.']),
		el('p', {}, ['The AI reads relevant requirements, dependency contracts and tests for the current file. Reading is not a test run. Prepared code is not saved yet; Saved confirms it is on disk.']),
		el('p', {}, ['Build everything: fill missing implementations first, then test and QA. Existing code is preserved for QA, not counted as verified. The QA stage reviews all project source, including companion tests, and ends with final tests. Module and single-file runs keep their chosen checkpoints.']),
	]);
	help.addEventListener('toggle', () => { passHelpOpen = help.open; });
	filePassPanel.append(help);
	if (results.length) {
		const last = results.at(-1);
		filePassPanel.append(el('p', { class: 'pass-meta' }, [`Last finished: ${last.path}`]));
		const history = el('details', { class: 'pass-earlier', ...(passHistoryOpen ? { open: '' } : {}) }, [el('summary', {}, [`Finished files (${results.length})`])]);
		for (const result of [...results].reverse()) { history.append(fileResultCard(result, button)); }
		history.addEventListener('toggle', () => { passHistoryOpen = history.open; });
		filePassPanel.append(history);
	}
	if (follow) { scroll.scrollTop = scroll.scrollHeight; }
}

function fileResultCard(result, button) {
	const note = result.note || 'File pass finished. See the file for its current contents.';
	const concise = note.replace(/\s+/g, ' ').trim();
	const card = el('article', { class: 'pass-result' }, [
		el('span', { class: 'pass-label' }, [result.outcome === 'saved' ? 'Saved' : result.outcome === 'existing' ? 'Existing code · awaiting QA' : result.outcome === 'reviewed' ? 'Reviewed · unchanged' : 'Processed']),
		el('code', { class: 'pass-path' }, [result.path]),
		el('p', {}, [concise.length > 280 ? concise.slice(0, 277) + '…' : concise]),
	]);
	if (concise.length > 280) { card.append(el('details', {}, [el('summary', {}, ['Full file summary']), el('p', {}, [note])])); }
	card.append(button('View saved file', 'open', false, result.path));
	return card;
}

function activityLabel(run) {
	const activity = run.activity ?? 'Preparing this file…';
	if (/^Checking the project|^Using /.test(activity)) { return run.preview ? 'Reviewing the prepared code…' : 'Reviewing the context for this file…'; }
	if (activity.startsWith('Reading related context:')) { return 'Reading dependencies needed for this file…'; }
	return activity;
}

function activityDetail(run) {
	return (run.activity ?? 'Preparing this file…') + (run.activityAt ? ` Updated ${new Date(run.activityAt).toLocaleTimeString()}.` : '');
}

function fileProgress(run) {
	const finished = run.results?.length ?? Math.max(0, (run.total ?? run.remaining) - run.remaining);
	const saved = run.results?.filter(result => result.outcome === 'saved').length ?? 0;
	const existing = run.results?.filter(result => result.outcome === 'existing').length ?? 0;
	if (run.phase === 'build') { return `${finished} of ${run.total} files processed · ${run.remaining} left to build`
		+ ` (${saved} saved, ${existing} already present, ${finished - saved - existing} previously reviewed) · QA follows`; }
	if (run.phase === 'qa') { return `${finished} of ${run.total} files reviewed · ${run.remaining} left in QA (${saved} edits saved; verification tracked separately)`; }
	return `${finished} of ${run.total ?? finished + run.remaining} files finished · ${run.remaining} left`
		+ (finished ? ` (${saved} saved, ${finished - saved} checked without changes)` : '');
}
