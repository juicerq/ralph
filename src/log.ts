import { intro, log as clack, outro, taskLog as clackTaskLog } from "@clack/prompts";

import type { WorkerResult } from "./worker";

let tl: ReturnType<typeof clackTaskLog> | null = null;

export function start() {
	intro("ralph");
}

export function info(msg: string) {
	clack.info(msg);
}

export function startWorkers() {
	tl = clackTaskLog({ title: "Implementing issues" });
}

export function status(issue: { number: number; title: string }, msg: string) {
	if (tl) {
		tl.message(`#${issue.number} ${issue.title} — ${msg}`);

		return;
	}

	clack.step(`#${issue.number} ${issue.title} — ${msg}`);
}

export function toolCall(issueNumber: number, name: string, args: string) {
	tl?.message(`#${issueNumber} ── ${name.padEnd(12)} ${args}`);
}

export function endWorkers(results: WorkerResult[]) {
	if (!tl) return;

	const succeeded = results.filter((r) => r.status === "success").length;

	const failed = results.length - succeeded;

	if (failed === 0) {
		tl.success(`${succeeded} issue(s) implemented`);
	} else {
		tl.error(`${succeeded} succeeded, ${failed} failed`);
	}

	tl = null;
}

export function summary(results: WorkerResult[]) {
	for (const r of results) {
		if (r.status === "success") {
			clack.success(`#${r.issue.number} ${r.issue.title}`);

			continue;
		}

		const extra = r.error ? ` — ${r.error}` : "";

		const logHint = ` → .ralph/logs/${r.issue.number}.log`;

		if (r.status === "merge-failed") {
			clack.warning(`#${r.issue.number} ${r.issue.title}${extra}${logHint}`);
		} else {
			clack.error(`#${r.issue.number} ${r.issue.title}${extra}${logHint}`);
		}
	}
}

export function end(msg?: string) {
	outro(msg ?? "Done");
}
