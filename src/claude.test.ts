import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// Import from the real-impl module, not the `./claude` façade that other
// test files mock. Bun's `mock.module` persists globally — importing the
// façade would hand us the mocked `runClaude` and void the real-behaviour
// coverage this file is here to provide.
import { runClaude } from "./claude-impl";

const originalSpawn = Bun.spawn;

let lastSpawnArgs: { cmd: string[]; opts?: { cwd?: string } } | undefined;

function makeStream(text: string) {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(text));
			controller.close();
		},
	});
}

function installSpawn(opts: { stdout?: string; stderr?: string; exitCode?: number } = {}) {
	(Bun as any).spawn = mock((cmd: string[], spawnOpts?: { cwd?: string }) => {
		lastSpawnArgs = { cmd, opts: spawnOpts };

		return {
			stdout: makeStream(opts.stdout ?? ""),
			stderr: new Response(opts.stderr ?? "").body!,
			exited: Promise.resolve(opts.exitCode ?? 0),
		};
	});
}

beforeEach(() => {
	lastSpawnArgs = undefined;
});

afterEach(() => {
	(Bun as any).spawn = originalSpawn;
});

describe("runClaude command line", () => {
	test("spawns claude with fixed base flags and the user prompt at the end", async () => {
		installSpawn();

		await runClaude("do the thing", { model: "claude-opus-4-6" });

		expect(lastSpawnArgs?.cmd).toEqual([
			"claude",
			"--print",
			"--verbose",
			"--dangerously-skip-permissions",
			"--output-format",
			"stream-json",
			"--model",
			"claude-opus-4-6",
			"do the thing",
		]);
	});

	test("passes cwd through to Bun.spawn", async () => {
		installSpawn();

		await runClaude("x", { model: "opus", cwd: "/work" });

		expect(lastSpawnArgs?.opts?.cwd).toBe("/work");
	});

	test("resume=true injects --continue before the prompt", async () => {
		installSpawn();

		await runClaude("retry prompt", { model: "opus", resume: true });

		const cmd = lastSpawnArgs!.cmd;

		expect(cmd).toContain("--continue");

		expect(cmd[cmd.length - 1]).toBe("retry prompt");

		expect(cmd.indexOf("--continue")).toBeLessThan(cmd.length - 1);
	});
});

describe("runClaude output parsing", () => {
	test("returns the text of the last assistant message, overwriting earlier ones", async () => {
		const streamOutput = [
			JSON.stringify({
				type: "assistant",
				message: { content: [{ type: "text", text: "first response" }] },
			}),
			JSON.stringify({
				type: "assistant",
				message: { content: [{ type: "text", text: "final answer" }] },
			}),
		].join("\n");

		installSpawn({ stdout: streamOutput });

		expect(await runClaude("x", { model: "opus" })).toBe("final answer");
	});

	test("ignores non-text blocks and malformed JSON lines", async () => {
		const streamOutput = [
			JSON.stringify({ type: "system", message: "ignored" }),
			JSON.stringify({
				type: "assistant",
				message: {
					content: [
						{ type: "tool_use", text: "ignored" },
						{ type: "text", text: "the real answer" },
					],
				},
			}),
			"not valid json",
		].join("\n");

		installSpawn({ stdout: streamOutput });

		expect(await runClaude("x", { model: "opus" })).toBe("the real answer");
	});

	test("returns empty string when no assistant messages appear", async () => {
		installSpawn({ stdout: JSON.stringify({ type: "system", message: "setup" }) });

		expect(await runClaude("x", { model: "opus" })).toBe("");
	});

	test("throws with exit code and stderr on non-zero exit", async () => {
		installSpawn({ stderr: "something went wrong", exitCode: 1 });

		await expect(runClaude("x", { model: "opus" })).rejects.toThrow(
			/claude failed \(exit 1\):\nsomething went wrong/,
		);
	});
});

describe("runClaude onToolCall", () => {
	test("invoked once per tool_use block for every tool with a mapped input field", async () => {
		const stream =
			JSON.stringify({
				type: "assistant",
				message: {
					content: [
						{ type: "tool_use", name: "Bash", input: { command: "ls -la" } },
						{ type: "tool_use", name: "Edit", input: { file_path: "src/a.ts" } },
						{ type: "tool_use", name: "Write", input: { file_path: "src/b.ts" } },
						{ type: "tool_use", name: "Agent", input: { description: "find the bug" } },
						{ type: "tool_use", name: "WebSearch", input: { query: "bun test" } },
						{ type: "tool_use", name: "WebFetch", input: { url: "https://bun.sh" } },
					],
				},
			}) + "\n";

		installSpawn({ stdout: stream });

		const calls: { name: string; args: string }[] = [];

		await runClaude("x", {
			model: "opus",
			onToolCall: (name, args) => calls.push({ name, args }),
		});

		expect(calls).toEqual([
			{ name: "Bash", args: "ls -la" },
			{ name: "Edit", args: "src/a.ts" },
			{ name: "Write", args: "src/b.ts" },
			{ name: "Agent", args: "find the bug" },
			{ name: "WebSearch", args: "bun test" },
			{ name: "WebFetch", args: "https://bun.sh" },
		]);
	});

	test("ignores tool names with no mapped input field (e.g. Read, Grep)", async () => {
		const stream =
			JSON.stringify({
				type: "assistant",
				message: {
					content: [
						{ type: "tool_use", name: "Read", input: { file_path: "src/x.ts" } },
						{ type: "tool_use", name: "Bash", input: { command: "echo" } },
					],
				},
			}) + "\n";

		installSpawn({ stdout: stream });

		const calls: string[] = [];

		await runClaude("x", {
			model: "opus",
			onToolCall: (name) => calls.push(name),
		});

		expect(calls).toEqual(["Bash"]);
	});

	test("strips cwd prefix from Edit/Write file paths", async () => {
		const stream =
			JSON.stringify({
				type: "assistant",
				message: {
					content: [{ type: "tool_use", name: "Edit", input: { file_path: "/w/src/foo.ts" } }],
				},
			}) + "\n";

		installSpawn({ stdout: stream });

		const calls: string[] = [];

		await runClaude("x", {
			model: "opus",
			cwd: "/w",
			onToolCall: (_name, args) => calls.push(args),
		});

		expect(calls).toEqual(["src/foo.ts"]);
	});

	test("truncates Bash commands to the first line and caps at 80 chars", async () => {
		const longLine = "echo " + "a".repeat(200);

		const multiLine = "first line\nsecond line";

		const stream =
			JSON.stringify({
				type: "assistant",
				message: {
					content: [
						{ type: "tool_use", name: "Bash", input: { command: longLine } },
						{ type: "tool_use", name: "Bash", input: { command: multiLine } },
					],
				},
			}) + "\n";

		installSpawn({ stdout: stream });

		const calls: string[] = [];

		await runClaude("x", {
			model: "opus",
			onToolCall: (_name, args) => calls.push(args),
		});

		expect(calls[0]).toHaveLength(80);

		expect(calls[0].endsWith("...")).toBe(true);

		expect(calls[1]).toBe("first line");
	});

	test("not invoked for malformed JSON lines", async () => {
		installSpawn({ stdout: "not json at all\n{broken\n" });

		const calls: string[] = [];

		await runClaude("x", {
			model: "opus",
			onToolCall: (name) => calls.push(name),
		});

		expect(calls).toEqual([]);
	});

	test("handles a tool_use block split across multiple read chunks", async () => {
		const block = JSON.stringify({
			type: "assistant",
			message: {
				content: [{ type: "tool_use", name: "Bash", input: { command: "echo hi" } }],
			},
		});

		const split = Math.floor(block.length / 2);

		const stdoutStream = new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(block.slice(0, split)));

				controller.enqueue(new TextEncoder().encode(block.slice(split) + "\n"));

				controller.close();
			},
		});

		(Bun as any).spawn = mock(() => ({
			stdout: stdoutStream,
			stderr: new Response("").body!,
			exited: Promise.resolve(0),
		}));

		const calls: string[] = [];

		await runClaude("x", {
			model: "opus",
			onToolCall: (_name, args) => calls.push(args),
		});

		expect(calls).toEqual(["echo hi"]);
	});
});

describe("runClaude logFile", () => {
	let logDir: string;

	beforeEach(async () => {
		logDir = await mkdtemp(join(tmpdir(), "swarm-claude-log-"));
	});

	afterEach(async () => {
		await rm(logDir, { recursive: true, force: true });
	});

	test("writes the raw claude stream to the log file on success (creating parent dirs)", async () => {
		const payload = "line1\nline2\n";

		installSpawn({ stdout: payload });

		const logFile = join(logDir, "nested", "run.log");

		await runClaude("x", { model: "opus", logFile });

		expect(await readFile(logFile, "utf8")).toBe(payload);
	});

	test("on failure, replaces the log with stdout + stderr marker for debugging", async () => {
		installSpawn({ stdout: "partial output", stderr: "boom", exitCode: 2 });

		const logFile = join(logDir, "fail.log");

		await expect(runClaude("x", { model: "opus", logFile })).rejects.toThrow();

		const contents = await readFile(logFile, "utf8");

		expect(contents).toBe("partial output\n--- STDERR ---\nboom");
	});
});
