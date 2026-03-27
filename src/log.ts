import type { WorkerResult } from "./worker"

const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`

export function info(msg: string) {
	console.log(dim(msg))
}

export function status(issue: { number: number; title: string }, msg: string) {
	console.log(`${dim(`#${issue.number}`)} ${issue.title} ${dim("—")} ${msg}`)
}

export function summary(results: WorkerResult[]) {
	console.log(`\n${bold("--- Results ---")}`)

	for (const r of results) {
		const tag =
			r.status === "success"
				? green("[ok]")
				: r.status === "merge-failed"
					? yellow("[conflict]")
					: red("[fail]")

		const extra = r.error ? ` ${dim(r.error)}` : ""
		const logHint = r.status !== "success" ? ` ${dim(`→ .ralph/logs/${r.issue.number}.log`)}` : ""
		console.log(`${tag} #${r.issue.number} ${r.issue.title}${extra}${logHint}`)
	}

	const succeeded = results.filter((r) => r.status === "success").length
	const failed = results.length - succeeded
	console.log(
		`\n${succeeded} succeeded, ${failed} failed`,
	)
}
