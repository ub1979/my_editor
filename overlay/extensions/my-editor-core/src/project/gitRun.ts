import { execFile } from 'child_process';
import { redact } from '../records/redact';

/**
 * Runs one git command in `cwd` without a shell and without prompting for a login (a missing login fails instead of
 * waiting); stdout trimmed. A failure carries git's last two stderr lines with remote URLs and secrets removed.
 */
export function runGit(cwd: string, args: readonly string[], timeout = 20_000): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile('git', [...args], {
			cwd, timeout, maxBuffer: 2_000_000,
			env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
		}, (error, stdout, stderr) => {
			if (error) {
				const detail = stderr.trim().split(/[\r\n]+/).slice(-2).join(' ') || error.message;
				reject(new Error(redact(detail.replace(/https?:\/\/[^\s]+/g, '[remote URL]')).slice(0, 500)));
			}
			else { resolve(stdout.trim()); }
		});
	});
}
