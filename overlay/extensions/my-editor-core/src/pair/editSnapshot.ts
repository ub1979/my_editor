import { createHash } from 'crypto';

/** Keep a compact identity for the entire source, including text beyond the model's context limit. */
export function sourceFingerprint(text: string): string {
	return createHash('sha256').update(text).digest('hex');
}

/** Selection offsets and whole-file replies are valid only for the source the model read. */
export function assertEditSnapshot(fingerprint: string, text: string): void {
	if (sourceFingerprint(text) !== fingerprint) {
		throw new Error('The file changed while Pair was preparing this edit. Ask again using the current file; no proposal was created.');
	}
}
