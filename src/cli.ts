#!/usr/bin/env bun

import { loadConfig } from "./config"
import { fetchIssues, runPlanner } from "./planner"
import { runWorker, type WorkerIssue, type WorkerResult } from "./worker"
import * as log from "./log"
import { exec } from "./exec"

async function main() {
	const args = process.argv.slice(2)

	if (args.includes("--help") || args.includes("-h")) {
		console.log(`Usage: ralph [options]

Options:
  --label <name>       Issue label (default: ralph)
  --concurrency <n>    Max parallel agents (default: 3)
  --model <name>       Default model: opus, sonnet (default: opus)
  --prompt <text>      Extra instructions for agents
  -h, --help           Show this help`)
		return
	}

	const flags = parseFlags(args)
	const config = await loadConfig(flags)

	const issues = await fetchIssues(config.label)
	if (issues.length === 0) {
		log.info(`No issues with label "${config.label}"`)
		return
	}
	log.info(`Found ${issues.length} issue(s)`)

	const plan = await runPlanner(issues)
	if (plan.length === 0) {
		log.info("Planner selected no issues")
		return
	}
	log.info(`Plan: ${plan.length} issue(s) to implement`)

	await exec(["git", "worktree", "prune"])

	const enriched: WorkerIssue[] = plan.flatMap((p) => {
		const issue = issues.find((i) => i.number === p.number)
		if (!issue) return []
		return [{ ...p, body: issue.body }]
	})

	const results = await runWorkers(enriched, config)
	log.summary(results)

	const failures = results.filter((r) => r.status !== "success")
	if (failures.length > 0) process.exit(1)
}

async function runWorkers(issues: WorkerIssue[], config: { concurrency: number } & Parameters<typeof runWorker>[1]) {
	const results: WorkerResult[] = []
	const queue = [...issues]
	const running = new Set<Promise<void>>()

	let mergeChain = Promise.resolve()
	const mergeLocked = (branch: string) => {
		const p = mergeChain.then(async () => {
			try {
				await exec(["git", "merge", branch])
			} catch (e) {
				await exec(["git", "merge", "--abort"]).catch(() => {})
				throw e
			}
		})
		mergeChain = p.then(
			() => {},
			() => {},
		)
		return p
	}

	while (queue.length > 0 || running.size > 0) {
		while (queue.length > 0 && running.size < config.concurrency) {
			const issue = queue.shift()!
			log.status(issue, "starting")

			const p = runWorker(issue, config, mergeLocked).then((result) => {
				results.push(result)
				log.status(result.issue, result.status === "success" ? "merged" : result.status)
				running.delete(p)
			})
			running.add(p)
		}

		if (running.size > 0) {
			await Promise.race(running)
		}
	}

	return results
}

function parseFlags(args: string[]) {
	const result: Record<string, string> = {}
	for (let i = 0; i < args.length; i++) {
		if (args[i].startsWith("--") && i + 1 < args.length) {
			result[args[i].slice(2)] = args[++i]
		}
	}
	return {
		label: result.label,
		concurrency: result.concurrency ? Number(result.concurrency) : undefined,
		model: result.model,
		prompt: result.prompt,
	}
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
