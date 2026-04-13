import { mkdir } from "fs/promises";

export async function exec(cmd: string[], opts?: { cwd?: string }) {
	const proc = Bun.spawn(cmd, {
		cwd: opts?.cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);

	if (exitCode !== 0) {
		throw new Error(`${cmd.join(" ")} failed (exit ${exitCode}):\n${stderr}`);
	}

	return stdout.trim();
}

const TOOL_ARG_FIELDS: Record<string, string> = {
	Bash: "command",
	Edit: "file_path",
	Write: "file_path",
	Agent: "description",
	WebSearch: "query",
	WebFetch: "url",
};

export async function runClaude(
	prompt: string,
	opts: {
		model: string;
		cwd?: string;
		logFile?: string;
		resume?: boolean;
		onToolCall?: (name: string, args: string) => void;
	},
) {
	const args = [
		"claude",
		"--print",
		"--verbose",
		"--dangerously-skip-permissions",
		"--output-format",
		"stream-json",
		"--model",
		opts.model,
	];

	if (opts.resume) {
		args.push("--continue");
	}

	args.push(prompt);

	const proc = Bun.spawn(args, {
		cwd: opts.cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	const chunks: string[] = [];

	const reader = proc.stdout.getReader();

	const decoder = new TextDecoder();

	let logWriter: ReturnType<ReturnType<typeof Bun.file>["writer"]> | undefined;

	if (opts.logFile) {
		const dir = opts.logFile.substring(0, opts.logFile.lastIndexOf("/"));

		await mkdir(dir, { recursive: true });

		logWriter = Bun.file(opts.logFile).writer();
	}

	let lineBuffer = "";

	while (true) {
		const { done, value } = await reader.read();

		if (done) break;

		const text = decoder.decode(value, { stream: true });

		chunks.push(text);

		if (logWriter) logWriter.write(value);

		if (opts.onToolCall) {
			lineBuffer += text;

			const lines = lineBuffer.split("\n");

			lineBuffer = lines.pop() ?? "";

			for (const line of lines) {
				if (line.trim()) extractToolCalls(line, opts.onToolCall, opts.cwd);
			}
		}
	}

	if (logWriter) {
		logWriter.flush();

		logWriter.end();
	}

	const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);

	const stdout = chunks.join("");

	if (exitCode !== 0) {
		if (logWriter && stderr && opts.logFile) {
			await Bun.write(opts.logFile, `${stdout}\n--- STDERR ---\n${stderr}`);
		}

		throw new Error(`claude failed (exit ${exitCode}):\n${stderr}`);
	}

	return parseStreamJson(stdout);
}

function extractToolCalls(
	line: string,
	callback: (name: string, args: string) => void,
	cwd?: string,
) {
	if (!line.startsWith("{")) return;

	try {
		const obj = JSON.parse(line);

		if (obj.type !== "assistant" || !Array.isArray(obj.message?.content)) return;

		for (const block of obj.message.content) {
			if (block.type !== "tool_use") continue;

			const argField = TOOL_ARG_FIELDS[block.name];

			if (!argField) continue;

			const raw = block.input?.[argField];

			if (!raw) continue;

			callback(block.name, formatToolArg(block.name, String(raw), cwd));
		}
	} catch {}
}

function formatToolArg(name: string, value: string, cwd?: string) {
	let display = value;

	if (cwd && (name === "Edit" || name === "Write")) {
		display = display.replace(cwd + "/", "");
	}

	if (name === "Bash") {
		display = display.split("\n")[0];
	}

	if (display.length > 80) {
		return display.slice(0, 77) + "...";
	}

	return display;
}

function parseStreamJson(raw: string) {
	const lines = raw.split("\n").filter(Boolean);
	let result = "";

	for (const line of lines) {
		try {
			const parsed = JSON.parse(line);

			if (parsed.type === "assistant") {
				for (const block of parsed.message?.content ?? []) {
					if (block.type === "text") {
						result = block.text;
					}
				}
			}
		} catch {}
	}

	return result.trim();
}
