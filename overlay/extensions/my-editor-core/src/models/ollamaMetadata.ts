const cache = new Map<string, { expires: number; result: Promise<number> }>();
const DEFAULT_CONTEXT = 32_000;

/** Cloud requests use the hosted context; local runtime allocation may differ from model capacity. */
export function cloudContextTokens(baseUrl: string, model: string): Promise<number> {
	const key = `${baseUrl}\n${model}`;
	const cached = cache.get(key);
	if (cached && cached.expires > Date.now()) { return cached.result; }
	const result = readCapacity(baseUrl, model);
	cache.set(key, { expires: Date.now() + 300_000, result });
	return result;
}

async function readCapacity(baseUrl: string, model: string): Promise<number> {
	try {
		const response = await fetch(`${baseUrl}/api/show`, {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ model }), signal: AbortSignal.timeout(1500),
		});
		if (!response.ok) { return DEFAULT_CONTEXT; }
		const body = await response.json() as { model_info?: Record<string, unknown> };
		const values = Object.entries(body.model_info ?? {}).filter(([key]) => key.endsWith('.context_length'))
			.map(([, value]) => value).filter((value): value is number => typeof value === 'number'
				&& Number.isSafeInteger(value) && value >= 4096 && value <= 2_097_152);
		return values.length ? Math.min(...values) : DEFAULT_CONTEXT;
	} catch { return DEFAULT_CONTEXT; }
}
