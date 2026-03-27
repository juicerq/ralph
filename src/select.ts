import { checkbox } from "@inquirer/prompts";
import { exec } from "./exec";
import type { Issue } from "./planner";

export async function selectIssues() {
	const json = await exec([
		"gh",
		"issue",
		"list",
		"--state",
		"open",
		"--json",
		"number,title,body",
		"--limit",
		"50",
	]);

	const issues = JSON.parse(json) as Issue[];

	if (issues.length === 0) return [];

	return checkbox<Issue>({
		message: "Select issues to implement",
		choices: issues.map((i) => ({
			name: `#${i.number} ${i.title}`,
			value: i,
		})),
	});
}
