/** The project files that show how a project is built and tested. */
export interface RootFiles {
	/** File names in the project's top folder. */
	readonly names: readonly string[];
	readonly packageJson?: string;
	readonly pyproject?: string;
}

export interface DetectedCommands {
	readonly languages: readonly string[];
	/** Build and type checks, as exact command lines. */
	readonly checks: readonly string[];
	readonly tests: readonly string[];
}

const NPM_PLACEHOLDER_TEST = /no test specified/;

/** Build and test commands for the languages a project's top-level files reveal. */
export function detectCommands(root: RootFiles): DetectedCommands {
	const has = (name: string) => root.names.includes(name);
	const languages: string[] = [];
	const checks: string[] = [];
	const tests: string[] = [];
	if (has('package.json')) {
		languages.push('JavaScript/TypeScript');
		if (has('tsconfig.json')) { checks.push('npx tsc --noEmit'); }
		if (npmTestScript(root.packageJson)) { tests.push('npm test'); }
	}
	if (['pyproject.toml', 'setup.py', 'requirements.txt', 'pytest.ini', 'conftest.py'].some(has)) {
		languages.push('Python');
		checks.push('python -m compileall -q');
		if (has('pytest.ini') || has('conftest.py') || /pytest/.test(root.pyproject ?? '')) { tests.push('pytest -q -rA'); }
	}
	if (has('go.mod')) {
		languages.push('Go');
		checks.push('go build ./...', 'go vet ./...');
		tests.push('go test -json ./...');
	}
	if (has('Cargo.toml')) {
		languages.push('Rust');
		checks.push('cargo check');
		tests.push('cargo test');
	}
	return { languages, checks, tests };
}

function npmTestScript(packageJson: string | undefined): string | undefined {
	try {
		const test = (JSON.parse(packageJson ?? '{}') as { scripts?: Record<string, unknown> }).scripts?.test;
		return typeof test === 'string' && test.trim() && !NPM_PLACEHOLDER_TEST.test(test) ? test : undefined;
	} catch {
		return undefined;
	}
}
