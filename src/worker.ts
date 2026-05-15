import { runClaude } from "./claude";
import { type Config, resolveModel } from "./config";
import { exec } from "./exec";
import type { PlannedIssue } from "./planner";

export type WorkerIssue = PlannedIssue & { body: string };

export type WorkerResult = {
	issue: WorkerIssue;
	status: "success" | "merge-failed" | "failed" | "already-done";
	error?: string;
	branch: string;
};

export async function runWorker(
	issue: WorkerIssue,
	config: Config,
	merge: (branch: string) => Promise<void>,
	resume = false,
	onToolCall?: (name: string, args: string) => void,
) {
	const branch = `swarm/${issue.number}`;

	const worktreePath = `${process.cwd()}/.swarm/${issue.number}`;

	try {
		const branchExists = await exec(["git", "rev-parse", "--verify", branch]).then(
			() => true,
			() => false,
		);

		if (branchExists) {
			const worktreeExists = await exec(["git", "worktree", "list", "--porcelain"]).then((out) =>
				out.includes(worktreePath),
			);

			if (!worktreeExists) {
				await exec(["git", "worktree", "add", worktreePath, branch]);
			}
		} else {
			await exec(["git", "worktree", "add", worktreePath, "-b", branch]);
		}

		const baseCommit = await exec(["git", "rev-parse", "HEAD"]);

		const logFile = `${process.cwd()}/.swarm/logs/${issue.number}.log`;

		const claudeOpts = {
			model: resolveModel(config.model),
			cwd: worktreePath,
			logFile,
			onToolCall,
		};

		const fullPrompt = branchExists ? buildResumePrompt(issue, config) : buildPrompt(issue, config);

		let response: string;

		if (resume) {
			response = await runClaude(buildRetryPrompt(issue), { ...claudeOpts, resume: true }).catch(
				() => runClaude(fullPrompt, claudeOpts),
			);
		} else {
			response = await runClaude(fullPrompt, claudeOpts);
		}

		const worktreeHead = await exec(["git", "-C", worktreePath, "rev-parse", "HEAD"]);

		if (baseCommit === worktreeHead) {
			await cleanup(worktreePath, branch);

			if (response.includes("[ALREADY_IMPLEMENTED]")) {
				return {
					issue,
					status: "already-done" as const,
					branch,
				};
			}

			return {
				issue,
				status: "failed" as const,
				error: "No commits made",
				branch,
			};
		}

		try {
			await merge(branch);
		} catch {
			await removeWorktree(worktreePath);
			return {
				issue,
				status: "merge-failed" as const,
				error: `Merge conflict. Branch ${branch} preserved.`,
				branch,
			};
		}

		await cleanup(worktreePath, branch);

		return { issue, status: "success" as const, branch };
	} catch (e) {
		await removeWorktree(worktreePath);
		return {
			issue,
			status: "failed" as const,
			error: e instanceof Error ? e.message : String(e),
			branch,
		};
	}
}

function buildResumePrompt(issue: WorkerIssue, config: Config) {
	return `
		You are resuming work on GitHub issue #${issue.number}: ${issue.title}
		${issue.body || "No description provided."}

		${config.prompt}

		A previous agent was working on this issue in this worktree. Before continuing, check git status and git diff to understand what was already done. Then complete the remaining work.

		IMPORTANT: You MUST commit your changes before finishing. If you don't commit, your work will be lost.

		If the issue is already fully implemented in the codebase with all acceptance criteria met, do NOT commit anything. Instead, include the marker [ALREADY_IMPLEMENTED] in your response.

		After implementing:
		1. Make sure the code compiles and typechecks
		2. Run tests if applicable
		3. Commit your changes with a descriptive message referencing issue #${issue.number}
	`;
}

function buildRetryPrompt(issue: WorkerIssue) {
	return `Your previous attempt to implement issue #${issue.number} did not produce valid commits. Check what went wrong, fix any issues, and commit your changes.

If the issue is already fully implemented in the codebase with all acceptance criteria met, do NOT commit anything. Instead, include the marker [ALREADY_IMPLEMENTED] in your response.`;
}

function buildPrompt(issue: WorkerIssue, config: Config) {
	return `
	You are implementing GitHub issue #${issue.number}: ${issue.title}

	${issue.body || "No description provided."}

	${config.prompt}

	IMPORTANT: You MUST commit your changes before finishing. If you don't commit, your work will be lost.

	If the issue is already fully implemented in the codebase with all acceptance criteria met, do NOT commit anything. Instead, include the marker [ALREADY_IMPLEMENTED] in your response.

	After implementing:
	1. Make sure the code compiles and typechecks
	2. Run tests if applicable
	3. Commit your changes with a descriptive message referencing issue #${issue.number}
`;
}

export async function resolveConflict(result: WorkerResult, config: Config) {
	const { branch, issue } = result;

	try {
		const mergeOutcome = await exec(["git", "merge", branch, "--no-commit", "--no-ff"])
			.then(() => "clean" as const)
			.catch(() => "conflict" as const);

		if (mergeOutcome === "clean") {
			await exec(["git", "commit", "--no-edit"]);

			await exec(["git", "branch", "-D", branch]).catch(() => {});

			return { issue, status: "success" as const, branch };
		}

		const conflicting = await exec(["git", "diff", "--name-only", "--diff-filter=U"]);

		if (!conflicting) {
			await exec(["git", "commit", "--no-edit"]);

			await exec(["git", "branch", "-D", branch]).catch(() => {});

			return { issue, status: "success" as const, branch };
		}

		await runClaude(buildConflictPrompt(issue, conflicting), {
			model: resolveModel(config.model),
			logFile: `${process.cwd()}/.swarm/logs/${issue.number}-conflict.log`,
		});

		const remaining = await exec(["git", "diff", "--name-only", "--diff-filter=U"]).catch(() => "");

		if (remaining) {
			await exec(["git", "merge", "--abort"]).catch(() => {});
			return {
				issue,
				status: "merge-failed" as const,
				error: `Conflict resolution failed. Branch ${branch} preserved.`,
				branch,
			};
		}

		await exec(["git", "commit", "--no-edit"]);

		await exec(["git", "branch", "-D", branch]).catch(() => {});

		return { issue, status: "success" as const, branch };
	} catch (e) {
		await exec(["git", "merge", "--abort"]).catch(() => {});
		return {
			issue,
			status: "merge-failed" as const,
			error: e instanceof Error ? e.message : String(e),
			branch,
		};
	}
}

function buildConflictPrompt(issue: WorkerIssue, conflictingFiles: string) {
	return `
	You are resolving merge conflicts. Branch swarm/${issue.number} implements issue #${issue.number}: ${issue.title}

	${issue.body || "No description provided."}

	Conflicting files:
	${conflictingFiles}

	Instructions:
	1. Read each conflicting file
	2. Resolve conflicts by integrating BOTH sides. HEAD has already-merged work from other issues, incoming is this issue's implementation
	3. Remove all conflict markers (<<<<<<<, =======, >>>>>>>)
	4. Stage resolved files with git add
	5. Do NOT commit
`;
}

async function cleanup(worktreePath: string, branch: string) {
	await removeWorktree(worktreePath);

	await exec(["git", "branch", "-D", branch]).catch(() => {});
}

async function removeWorktree(worktreePath: string) {
	await exec(["git", "worktree", "remove", worktreePath, "--force"]).catch(() => {});
}
