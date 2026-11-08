import * as vscode from 'vscode';
import { createHash } from 'crypto';
import { checkedProjectPath } from '../chat/projectPath';
import { checkAncestors, CheckLocation, verificationPlan } from './verificationPlan';

/** Read only ancestors of the authorized run. Missing folders are normal during initial Build. */
export async function discoverVerification(root: vscode.Uri, files: readonly string[]) {
	const locations: CheckLocation[] = [];
	for (const directory of checkAncestors(files)) {
		if (directory) { checkedProjectPath(root.fsPath, directory, true); }
		const cwd = vscode.Uri.joinPath(root, directory);
		let names: string[];
		try { names = (await vscode.workspace.fs.readDirectory(cwd)).map(([name]) => name); }
		catch (error) { if ((error as { code?: string }).code === 'FileNotFound') { continue; } throw error; }
		const read = async (name: string) => {
			if (!names.includes(name)) { return; }
			const relative = directory ? `${directory}/${name}` : name;
			const target = checkedProjectPath(root.fsPath, relative);
			if ((await vscode.workspace.fs.stat(vscode.Uri.file(target))).size > 400000) { throw new Error(`Verification manifest too large: ${relative}`); }
			return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(target)));
		};
		const [packageJson, pyproject] = await Promise.all([read('package.json'), read('pyproject.toml')]);
		const configurationHashes: Record<string, string> = {};
		for (const name of names.filter(name => /^tsconfig.*\.json$|^(?:pnpm-lock\.yaml|pnpm-workspace\.yaml|package-lock\.json|go\.(?:mod|sum)|Cargo\.(?:toml|lock))$/.test(name))) {
			configurationHashes[name] = createHash('sha256').update((await read(name))!).digest('hex');
		}
		locations.push({ directory, names: names.filter(name => ['package.json', 'tsconfig.json', 'pyproject.toml', 'setup.py',
			'requirements.txt', 'pytest.ini', 'conftest.py', 'go.mod', 'Cargo.toml'].includes(name)).sort(), packageJson, pyproject, configurationHashes });
	}
	return verificationPlan(locations);
}
