import { describe, test, expect, mock, beforeEach } from "bun:test";

// --- exec tests use the real exec since it's a thin wrapper around Bun.spawn ---

import { exec } from "./exec";

describe("exec", () => {
	test("returns trimmed stdout on success", async () => {
		const result = await exec(["echo", "hello world"]);
		expect(result).toBe("hello world");
	});

	test("handles multi-line output", async () => {
		const result = await exec(["printf", "line1\nline2\n"]);
		expect(result).toBe("line1\nline2");
	});

	test("throws on non-zero exit code", async () => {
		await expect(exec(["false"])).rejects.toThrow("failed (exit 1)");
	});

	test("includes command and stderr in error message", async () => {
		await expect(exec(["sh", "-c", "echo bad >&2; exit 2"])).rejects.toThrow(
			/sh -c echo bad >&2; exit 2 failed \(exit 2\):\nbad/,
		);
	});

	test("respects cwd option", async () => {
		const result = await exec(["pwd"], { cwd: "/tmp" });
		expect(result).toMatch(/\/tmp/);
	});

	test("returns empty string for empty output", async () => {
		const result = await exec(["true"]);
		expect(result).toBe("");
	});
});

describe("parseStreamJson", () => {
	// parseStreamJson is not exported, so we test it through runClaude.
	// Since runClaude spawns `claude`, we mock Bun.spawn and test the parsing
	// by importing the module with mocked spawn.

	const mockSpawn = mock();
	const mockMkdir = mock();

	beforeEach(() => {
		mockSpawn.mockReset();
		mockMkdir.mockReset();
	});

	function makeStream(text: string) {
		return new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(text));
				controller.close();
			},
		});
	}

	// We need to re-import with mocked Bun.spawn to test runClaude
	test("runClaude parses stream-json and returns last assistant text", async () => {
		const originalSpawn = Bun.spawn;

		try {
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

			(Bun as any).spawn = mock(() => ({
				stdout: makeStream(streamOutput),
				stderr: new Response("").body!,
				exited: Promise.resolve(0),
			}));

			// Re-import to pick up mocked Bun.spawn
			// We test the function directly by calling it
			const { runClaude } = await import("./exec");

			const result = await runClaude("test prompt", { model: "opus" });
			expect(result).toBe("final answer");
		} finally {
			(Bun as any).spawn = originalSpawn;
		}
	});

	test("runClaude extracts text from mixed message types", async () => {
		const originalSpawn = Bun.spawn;

		try {
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

			(Bun as any).spawn = mock(() => ({
				stdout: makeStream(streamOutput),
				stderr: new Response("").body!,
				exited: Promise.resolve(0),
			}));

			const { runClaude } = await import("./exec");

			const result = await runClaude("test", { model: "opus" });
			expect(result).toBe("the real answer");
		} finally {
			(Bun as any).spawn = originalSpawn;
		}
	});

	test("runClaude throws on non-zero exit code", async () => {
		const originalSpawn = Bun.spawn;

		try {
			(Bun as any).spawn = mock(() => ({
				stdout: makeStream(""),
				stderr: new Response("something went wrong").body!,
				exited: Promise.resolve(1),
			}));

			const { runClaude } = await import("./exec");
			await expect(runClaude("test", { model: "opus" })).rejects.toThrow("claude failed (exit 1)");
		} finally {
			(Bun as any).spawn = originalSpawn;
		}
	});

	test("runClaude returns empty string when no assistant messages", async () => {
		const originalSpawn = Bun.spawn;

		try {
			const streamOutput = JSON.stringify({ type: "system", message: "setup" });

			(Bun as any).spawn = mock(() => ({
				stdout: makeStream(streamOutput),
				stderr: new Response("").body!,
				exited: Promise.resolve(0),
			}));

			const { runClaude } = await import("./exec");

			const result = await runClaude("test", { model: "opus" });
			expect(result).toBe("");
		} finally {
			(Bun as any).spawn = originalSpawn;
		}
	});
});
