export type Config = {
	label: string;
	concurrency: number;
	model: string;
	prompt: string;
	retries: number;
};

const MODEL_MAP: Record<string, string> = {
	opus: "claude-opus-4-6",
	sonnet: "claude-sonnet-4-6",
	haiku: "claude-haiku-4-5-20251001",
};

export function resolveModel(model: string) {
	return MODEL_MAP[model] ?? model;
}

const DEFAULTS: Config = {
	label: "ralph",
	concurrency: 1,
	model: "opus",
	prompt: "Implement the issue. Run tests before committing if applicable.",
	retries: 1,
};

export async function loadConfig(flags: Partial<Config>) {
	const fileConfig = await loadConfigFile();

	const defined = Object.fromEntries(Object.entries(flags).filter(([, v]) => v !== undefined));

	return { ...DEFAULTS, ...fileConfig, ...defined };
}

async function loadConfigFile(): Promise<Partial<Config>> {
	const path = `${process.cwd()}/ralph.config.ts`;
	try {
		const mod = await import(path);
		return mod.default ?? {};
	} catch {
		return {};
	}
}
