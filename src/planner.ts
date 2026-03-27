import { resolveModel } from "./config";
import { exec, runClaude } from "./exec";

export type Issue = {
	number: number;
	title: string;
	body: string;
};

export type PlannedIssue = {
	number: number;
	title: string;
	dependsOn: number[];
};

export async function fetchIssues(label: string) {
	const json = await exec([
		"gh",
		"issue",
		"list",
		"--label",
		label,
		"--state",
		"open",
		"--json",
		"number,title,body",
		"--limit",
		"50",
	]);

	return JSON.parse(json) as Issue[];
}

export async function runPlanner(issues: Issue[]) {
	if (issues.length === 1) {
		return [{ number: issues[0].number, title: issues[0].title, dependsOn: [] }];
	}

	const prompt = buildPrompt(issues);

	const output = await runClaude(prompt, { model: resolveModel("opus") });

	return extractPlan(output, issues);
}

function buildPrompt(issues: Issue[]) {
	const list = issues
		.map((i) => `## #${i.number}: ${i.title}\n${i.body || "No description provided."}`)
		.join("\n\n");

	return `You are a planning agent. Analyze these GitHub issues and determine dependencies.

For each issue, list which other issues it depends on in "dependsOn" (empty array if none).
An issue B depends on issue A if B requires code, infrastructure, or API shapes that A introduces.

Issues:
${list}

Return ONLY a JSON array, no other text:
[{"number": 42, "title": "Add auth", "dependsOn": []}, {"number": 43, "title": "Use auth", "dependsOn": [42]}]`;
}

function extractPlan(output: string, issues: Issue[]) {
	const match = output.match(/\[[\s\S]*\]/);

	if (!match) throw new Error("Planner returned invalid JSON:\n" + output);

	const parsed = JSON.parse(match[0]) as PlannedIssue[];

	const validNumbers = new Set(issues.map((i) => i.number));

	return parsed
		.filter((p) => validNumbers.has(p.number))
		.map((p) => ({
			...p,
			dependsOn: (p.dependsOn ?? []).filter((d) => validNumbers.has(d)),
		}));
}
