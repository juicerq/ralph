export function parseFlags(args: string[]) {
	const result: Record<string, string> = {};

	for (let i = 0; i < args.length; i++) {
		if (args[i].startsWith("--") && i + 1 < args.length) {
			result[args[i].slice(2)] = args[++i];
		}
	}

	return {
		issue: result.issue ? Number(result.issue) : undefined,
		label: result.label,
		concurrency: result.concurrency ? Number(result.concurrency) : undefined,
		model: result.model,
		prompt: result.prompt,
		retries: result.retries ? Number(result.retries) : undefined,
	};
}
