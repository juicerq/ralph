export type Config = {
	label: string
	concurrency: number
	model: string
	prompt: string
	retries: number
}

const DEFAULTS: Config = {
	label: "ralph",
	concurrency: 1,
	model: "opus",
	prompt: "Implement the issue. Run tests before committing if applicable.",
	retries: 1,
}

export async function loadConfig(flags: Partial<Config>) {
	const fileConfig = await loadConfigFile()
	return { ...DEFAULTS, ...fileConfig, ...stripUndefined(flags) }
}

async function loadConfigFile(): Promise<Partial<Config>> {
	const path = `${process.cwd()}/ralph.config.ts`
	try {
		const mod = await import(path)
		return mod.default ?? {}
	} catch {
		return {}
	}
}

function stripUndefined(obj: Partial<Config>) {
	const result: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(obj)) {
		if (value !== undefined) result[key] = value
	}
	return result as Partial<Config>
}
