import { describe, test, expect } from "bun:test";

async function exec(cmd: string[], opts?: { cwd?: string }) {
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
