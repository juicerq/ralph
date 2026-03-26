import { exec, runClaude } from "./exec"
import type { PlannedIssue } from "./planner"
import type { Config } from "./config"

export type WorkerIssue = PlannedIssue & { body: string }

export type WorkerResult = {
	issue: WorkerIssue
	status: "success" | "merge-failed" | "failed"
	error?: string
	branch: string
}

const MODEL_MAP: Record<string, string> = {
	opus: "claude-opus-4-6",
	sonnet: "claude-sonnet-4-6",
	haiku: "claude-haiku-4-5-20251001",
}

function resolveModel(model: string) {
	return MODEL_MAP[model] ?? model
}

export async function runWorker(
	issue: WorkerIssue,
	config: Config,
	merge: (branch: string) => Promise<void>,
): Promise<WorkerResult> {
	const branch = `ralph/${issue.number}`
	const worktreePath = `${process.cwd()}/.ralph/${issue.number}`

	try {
		const branchExists = await exec(["git", "rev-parse", "--verify", branch]).then(
			() => true,
			() => false,
		)
		if (branchExists) {
			return {
				issue,
				status: "failed",
				error: `Branch ${branch} already exists. Remove it first.`,
				branch,
			}
		}

		const baseCommit = await exec(["git", "rev-parse", "HEAD"])

		await exec(["git", "worktree", "add", worktreePath, "-b", branch])

		const prompt = buildPrompt(issue, config)
		await runClaude(prompt, {
			model: resolveModel(issue.model),
			cwd: worktreePath,
		})

		const worktreeHead = await exec(["git", "-C", worktreePath, "rev-parse", "HEAD"])
		if (baseCommit === worktreeHead) {
			await cleanup(worktreePath, branch)
			return { issue, status: "failed", error: "No commits made", branch }
		}

		try {
			await merge(branch)
		} catch {
			await removeWorktree(worktreePath)
			return {
				issue,
				status: "merge-failed",
				error: `Merge conflict. Branch ${branch} preserved.`,
				branch,
			}
		}

		await cleanup(worktreePath, branch)
		return { issue, status: "success", branch }
	} catch (e) {
		await removeWorktree(worktreePath)
		return {
			issue,
			status: "failed",
			error: e instanceof Error ? e.message : String(e),
			branch,
		}
	}
}

function buildPrompt(issue: WorkerIssue, config: Config) {
	return `You are implementing GitHub issue #${issue.number}: ${issue.title}

${issue.body || "No description provided."}

${config.prompt}

After implementing:
1. Make sure the code compiles and typechecks
2. Run tests if applicable
3. Commit your changes with a descriptive message referencing issue #${issue.number}`
}

async function cleanup(worktreePath: string, branch: string) {
	await removeWorktree(worktreePath)
	await exec(["git", "branch", "-D", branch]).catch(() => {})
}

async function removeWorktree(worktreePath: string) {
	await exec(["git", "worktree", "remove", worktreePath, "--force"]).catch(() => {})
}
