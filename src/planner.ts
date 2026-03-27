import { exec, runClaude } from "./exec"

export type Issue = {
	number: number
	title: string
	body: string
}

export type PlannedIssue = {
	number: number
	title: string
	model: "opus" | "sonnet"
	dependsOn: number[]
}

export async function fetchIssues(label: string) {
	const json = await exec([
		"gh", "issue", "list",
		"--label", label,
		"--state", "open",
		"--json", "number,title,body",
		"--limit", "50",
	])

	return JSON.parse(json) as Issue[]
}

export async function runPlanner(issues: Issue[]) {
	if (issues.length === 1) {
		return [{ number: issues[0].number, title: issues[0].title, model: "opus" as const, dependsOn: [] }]
	}

	const prompt = buildPrompt(issues)
	const output = await runClaude(prompt, { model: "claude-opus-4-6" })

	return extractPlan(output, issues)
}

function buildPrompt(issues: Issue[]) {
	const list = issues
		.map((i) => `## #${i.number}: ${i.title}\n${i.body ?? "No description."}`)
		.join("\n\n")

	return `You are a planning agent. Analyze these GitHub issues and determine the optimal implementation order.

Consider dependencies — if issue A must be done before issue B, A comes first.
Issues without dependencies can be implemented in parallel.

For each issue, assign a model:
- "opus" for complex tasks (new features, refactoring, architecture changes)
- "sonnet" for trivial tasks (typo fixes, renames, simple config changes, documentation)

For each issue, list which other issues it depends on in "dependsOn" (empty array if none).

Issues:
${list}

Return ONLY a JSON array ordered by implementation priority, no other text:
[{"number": 42, "title": "Add auth", "model": "opus", "dependsOn": []}, {"number": 43, "title": "Use auth", "model": "sonnet", "dependsOn": [42]}]`
}

function extractPlan(output: string, issues: Issue[]) {
	const match = output.match(/\[[\s\S]*\]/)
	if (!match) throw new Error("Planner returned invalid JSON:\n" + output)

	const parsed = JSON.parse(match[0]) as PlannedIssue[]
	const validNumbers = new Set(issues.map((i) => i.number))

	return parsed
		.filter((p) => validNumbers.has(p.number))
		.map((p) => ({
			...p,
			dependsOn: (p.dependsOn ?? []).filter((d) => validNumbers.has(d)),
		}))
}
