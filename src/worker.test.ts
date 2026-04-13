import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { WorkerIssue } from "./worker";
import type { Config } from "./config";

async function git(args: string[], cwd: string) {
	const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
	return stdout.trim();
}

const mockRunClaude = mock();

mock.module("./exec", () => ({
	exec: async (cmd: string[], opts?: { cwd?: string }) => {
		const proc = Bun.spawn(cmd, { cwd: opts?.cwd, stdout: "pipe", stderr: "pipe" });
		const [exitCode, stdout, stderr] = await Promise.all([
			proc.exited,
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		if (exitCode !== 0) throw new Error(`${cmd.join(" ")} failed (exit ${exitCode}):\n${stderr}`);
		return stdout.trim();
	},
	runClaude: mockRunClaude,
}));

const { runWorker, resolveConflict } = await import("./worker");

let testDir: string;

let originalCwd: string;

const issue: WorkerIssue = {
	number: 99,
	title: "Test issue",
	body: "Test body",
	dependsOn: [],
};

const config: Config = {
	label: "ralph",
	concurrency: 1,
	model: "opus",
	prompt: "Test.",
	retries: 1,
};

function simulateCommit() {
	mockRunClaude.mockImplementation(async (_prompt: string, opts: { cwd?: string }) => {
		await writeFile(join(opts.cwd!, "work.txt"), "done");
		await git(["add", "."], opts.cwd!);
		await git(["commit", "-m", "implement #99"], opts.cwd!);
		return "";
	});
}

function realMerge() {
	return async (branch: string) => {
		await git(["merge", branch], testDir);
	};
}

beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), "ralph-test-"));
	originalCwd = process.cwd();
	process.chdir(testDir);

	await git(["init"], testDir);
	await git(["config", "user.name", "test"], testDir);
	await git(["config", "user.email", "test@test.com"], testDir);
	await writeFile(join(testDir, "initial.txt"), "init");
	await git(["add", "."], testDir);
	await git(["commit", "-m", "initial"], testDir);

	mockRunClaude.mockReset();
});

afterEach(async () => {
	process.chdir(originalCwd);
	await rm(testDir, { recursive: true, force: true });
});

describe("runWorker", () => {
	test("fresh: creates branch, runs agent, merges", async () => {
		simulateCommit();
		const result = await runWorker(issue, config, realMerge());

		expect(result.status).toBe("success");
		expect(mockRunClaude.mock.calls[0][0]).toContain("You are implementing");
	});

	test("resume: reuses existing worktree with uncommitted changes", async () => {
		const worktreePath = join(testDir, ".ralph", "99");
		await git(["worktree", "add", worktreePath, "-b", "ralph/99"], testDir);
		await writeFile(join(worktreePath, "partial.txt"), "in progress");
		await git(["add", "."], worktreePath);

		mockRunClaude.mockImplementation(async (_prompt: string, opts: { cwd?: string }) => {
			await git(["commit", "-m", "complete #99"], opts.cwd!);
			return "";
		});

		const result = await runWorker(issue, config, realMerge());

		expect(result.status).toBe("success");
		expect(mockRunClaude.mock.calls[0][0]).toContain("resuming work");
	});

	test("resume: recreates worktree for orphan branch", async () => {
		const worktreePath = join(testDir, ".ralph", "99");
		await git(["worktree", "add", worktreePath, "-b", "ralph/99"], testDir);
		await writeFile(join(worktreePath, "prev.txt"), "previous");
		await git(["add", "."], worktreePath);
		await git(["commit", "-m", "previous work"], worktreePath);
		await git(["worktree", "remove", worktreePath, "--force"], testDir);

		simulateCommit();
		const result = await runWorker(issue, config, realMerge());

		expect(result.status).toBe("success");
		expect(mockRunClaude.mock.calls[0][0]).toContain("resuming work");
	});

	test("no commits returns failed", async () => {
		mockRunClaude.mockImplementation(async () => "");
		const merge = mock(async () => {});

		const result = await runWorker(issue, config, merge);

		expect(result.status).toBe("failed");
		expect(result.error).toContain("No commits");
		expect(merge).not.toHaveBeenCalled();
	});

	test("already implemented returns already-done", async () => {
		mockRunClaude.mockImplementation(
			async () => "The issue is [ALREADY_IMPLEMENTED] in the codebase.",
		);
		const merge = mock(async () => {});

		const result = await runWorker(issue, config, merge);

		expect(result.status).toBe("already-done");
		expect(result.error).toBeUndefined();
		expect(merge).not.toHaveBeenCalled();
	});

	test("merge conflict returns merge-failed", async () => {
		simulateCommit();
		const merge = async () => {
			throw new Error("conflict");
		};

		const result = await runWorker(issue, config, merge);

		expect(result.status).toBe("merge-failed");
	});
});

describe("resolveConflict", () => {
	async function setupDivergent(file: string, mainContent: string, branchContent: string) {
		const branch = "ralph/99";
		const worktreePath = join(testDir, ".ralph", "99");

		await git(["worktree", "add", worktreePath, "-b", branch], testDir);
		await writeFile(join(worktreePath, file), branchContent);
		await git(["add", "."], worktreePath);
		await git(["commit", "-m", "branch change"], worktreePath);
		await git(["worktree", "remove", worktreePath, "--force"], testDir);

		await writeFile(join(testDir, file), mainContent);
		await git(["add", "."], testDir);
		await git(["commit", "-m", "main change"], testDir);

		return { issue, status: "merge-failed" as const, branch, error: "conflict" };
	}

	test("clean merge: no conflict between branches", async () => {
		const branch = "ralph/99";
		const worktreePath = join(testDir, ".ralph", "99");

		await git(["worktree", "add", worktreePath, "-b", branch], testDir);
		await writeFile(join(worktreePath, "feature.txt"), "new feature");
		await git(["add", "."], worktreePath);
		await git(["commit", "-m", "add feature"], worktreePath);
		await git(["worktree", "remove", worktreePath, "--force"], testDir);

		const input = { issue, status: "merge-failed" as const, branch, error: "previous error" };
		const result = await resolveConflict(input, config);

		expect(result.status).toBe("success");
		expect(mockRunClaude).not.toHaveBeenCalled();
	});

	test("conflict resolved by Claude", async () => {
		const input = await setupDivergent("shared.txt", "main version", "branch version");

		mockRunClaude.mockImplementation(async () => {
			await writeFile(join(testDir, "shared.txt"), "merged version");
			await git(["add", "shared.txt"], testDir);
			return "";
		});

		const result = await resolveConflict(input, config);

		expect(result.status).toBe("success");
		expect(mockRunClaude).toHaveBeenCalledTimes(1);
		expect(mockRunClaude.mock.calls[0][0]).toContain("resolving merge conflicts");
	});

	test("conflict unresolved by Claude", async () => {
		const input = await setupDivergent("shared.txt", "main version", "branch version");

		mockRunClaude.mockImplementation(async () => "");

		const result = await resolveConflict(input, config);

		expect(result.status).toBe("merge-failed");
		expect(result.error).toContain("Conflict resolution failed");
	});
});
