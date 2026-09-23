/** Files that must never reach a model: environment files, keys, credentials. */
const SENSITIVE_FILE = /(^|\/)(\.env(\..*)?|\.flaskenv|.*\.pem|.*\.key|.*\.p12|.*\.pfx|id_rsa|id_ed25519|id_ecdsa|\.npmrc|\.pypirc|\.netrc|credentials(\.json)?|secrets?\.(json|ya?ml|toml))$/i;

/** Languages VS Code gives to secret-bearing files. */
const SENSITIVE_LANGUAGES = new Set(['dotenv']);

export function isSensitiveFile(path: string, languageId?: string): boolean {
	return SENSITIVE_FILE.test(path) || (languageId !== undefined && SENSITIVE_LANGUAGES.has(languageId));
}
