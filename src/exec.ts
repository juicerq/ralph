export async function exec(cmd: string[], opts?: { cwd?: string }) {
	const proc = Bun.spawn(cmd, {
		cwd: opts?.cwd,
		stdout: "pipe",
		stderr: "pipe",
	})

	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	])

	if (exitCode !== 0) {
		throw new Error(`${cmd.join(" ")} failed (exit ${exitCode}):\n${stderr}`)
	}

	return stdout.trim()
}

export async function runClaude(prompt: string, opts: { model: string; cwd?: string }) {
	const proc = Bun.spawn([
		"claude",
		"--print",
		"--verbose",
		"--dangerously-skip-permissions",
		"--output-format", "stream-json",
		"--model", opts.model,
		prompt,
	], {
		cwd: opts.cwd,
		stdout: "pipe",
		stderr: "pipe",
	})

	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	])

	if (exitCode !== 0) {
		throw new Error(`claude failed (exit ${exitCode}):\n${stderr}`)
	}

	return parseStreamJson(stdout)
}

function parseStreamJson(raw: string) {
	const lines = raw.split("\n").filter(Boolean)
	let result = ""

	for (const line of lines) {
		try {
			const parsed = JSON.parse(line)
			if (parsed.type === "assistant") {
				for (const block of parsed.message?.content ?? []) {
					if (block.type === "text") {
						result = block.text
					}
				}
			}
		} catch {
			// skip non-JSON lines
		}
	}

	return result.trim()
}
