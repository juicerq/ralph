import { describe, test, expect } from "bun:test";

// Import from the real-impl module, not the `./exec` façade that other test
// files mock. Bun's `mock.module` persists globally, so pulling in the façade
// here would pick up whichever mock won in the registry and break regression
// coverage of the actual shell wrapper.
const { exec } = await import("./exec-impl");

describe("exec", () => {
	test("returns trimmed stdout on success", async () => {
		expect(await exec(["echo", "hello world"])).toBe("hello world");
	});

	test("preserves internal newlines but trims trailing whitespace", async () => {
		expect(await exec(["printf", "line1\nline2\n"])).toBe("line1\nline2");
	});

	test("throws on non-zero exit code with command and stderr in the message", async () => {
		await expect(exec(["sh", "-c", "echo bad >&2; exit 2"])).rejects.toThrow(
			/sh -c echo bad >&2; exit 2 failed \(exit 2\):\nbad/,
		);
	});

	test("respects the cwd option", async () => {
		expect(await exec(["pwd"], { cwd: "/tmp" })).toMatch(/\/tmp/);
	});

	test("returns empty string for a command with no output", async () => {
		expect(await exec(["true"])).toBe("");
	});

	test("throws on unknown command (ENOENT surfaces as non-zero exit)", async () => {
		await expect(exec(["swarm-nonexistent-command-xyz"])).rejects.toThrow();
	});
});
