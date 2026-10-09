/** Files that must never reach a model: environment files, keys, credentials. */
const SENSITIVE_NAMES = [
	String.raw`\.env(\..*)?`, String.raw`\.flaskenv`, String.raw`.*\.pem`, String.raw`.*\.key`, String.raw`.*\.p12`, String.raw`.*\.pfx`,
	'id_rsa', 'id_ed25519', 'id_ecdsa', String.raw`\.npmrc`, String.raw`\.pypirc`, String.raw`\.netrc`,
	String.raw`credentials(\.json)?`, String.raw`secrets?\.(json|ya?ml|toml)`,
];
const SENSITIVE_FILE = new RegExp(String.raw`(^|\/)(${SENSITIVE_NAMES.join('|')})$`, 'i');

/** Languages VS Code gives to secret-bearing files. */
const SENSITIVE_LANGUAGES = new Set(['dotenv']);

export function isSensitiveFile(path: string, languageId?: string): boolean {
	return SENSITIVE_FILE.test(path) || (languageId !== undefined && SENSITIVE_LANGUAGES.has(languageId));
}
