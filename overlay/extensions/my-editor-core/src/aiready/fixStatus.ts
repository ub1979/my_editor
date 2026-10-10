let active = false;
const listeners = new Set<() => void>();

/** Whether a fix run is in progress in this window. */
export function fixRunning(): boolean { return active; }

export function setFixRunning(value: boolean): void {
	if (active === value) { return; }
	active = value;
	for (const listener of [...listeners]) { listener(); }
}

/** Calls `listener` whenever the running state changes; returns the unsubscribe. */
export function onFixStatus(listener: () => void): { dispose(): void } {
	listeners.add(listener);
	return { dispose: () => { listeners.delete(listener); } };
}
