import { createHash } from 'crypto';
import { BuildStep } from './buildPlan';

export interface StepConfirmation { signature: string; confirmedAt: string; evidence: 'user-confirmed' }
export interface BuildProgress { version: 1; steps: Record<string, StepConfirmation> }
export interface StepState {
	step: BuildStep;
	signature: string;
	status: 'ready' | 'blocked' | 'verified' | 'changed';
	missing: string[];
	dirty: string[];
}
export interface BuildFileSnapshot { hash?: string; dirty?: boolean; stub?: boolean }

export function digest(text: string): string { return createHash('sha256').update(text).digest('hex'); }

/** A confirmation applies to the exact step, source and prerequisite versions the user checked. */
export function stepStates(steps: BuildStep[], files: Map<string, BuildFileSnapshot>, progress: BuildProgress): StepState[] {
	const states = new Map<string, StepState>();
	for (const step of steps) {
		const missing = step.files.filter(file => !files.get(file)?.hash);
		const dirty = step.files.filter(file => files.get(file)?.dirty);
		const signature = digest(JSON.stringify({ step, files: step.files.map(file => [file, files.get(file)?.hash]),
			dependencies: step.dependsOn.map(id => [id, states.get(id)?.signature]) }));
		const previous = progress.steps[step.id];
		const ready = step.dependsOn.every(id => states.get(id)?.status === 'verified');
		const verified = ready && !missing.length && !dirty.length && previous?.evidence === 'user-confirmed' && previous.signature === signature;
		states.set(step.id, { step, signature, missing, dirty, status: verified ? 'verified'
			: !ready ? 'blocked' : previous ? 'changed' : 'ready' });
	}
	return [...states.values()];
}
