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

export async function fetchIssueWithSubIssues(issueNumber: number) {
	const repoJson = await exec(["gh", "repo", "view", "--json", "owner,name"]);

	const { owner, name } = JSON.parse(repoJson);

	const query = `{
		repository(owner: "${owner.login}", name: "${name}") {
			issue(number: ${issueNumber}) {
				number
				title
				body
				state
				subIssues(first: 50) {
					nodes {
						number
						title
						body
						state
					}
				}
			}
		}
	}`;

	const result = await exec(["gh", "api", "graphql", "-f", `query=${query}`]);

	const data = JSON.parse(result).data.repository.issue;

	if (!data) return [];

	const issues: Issue[] = [];

	const subIssues = data.subIssues?.nodes ?? [];

	const openSubIssues = subIssues.filter((s: { state: string }) => s.state === "OPEN");

	if (openSubIssues.length > 0) {
		for (const sub of openSubIssues) {
			issues.push({
				number: sub.number,
				title: sub.title,
				body: sub.body ?? "",
			});
		}
	} else if (data.state === "OPEN") {
		issues.push({
			number: data.number,
			title: data.title,
			body: data.body ?? "",
		});
	}

	return issues;
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
