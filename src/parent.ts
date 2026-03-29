import { exec } from "./exec";
import * as log from "./log";

type ParentIssue = {
	number: number;
};

let repoCache: { owner: string; name: string } | null = null;

async function getRepo() {
	if (repoCache) return repoCache;

	const json = await exec(["gh", "repo", "view", "--json", "owner,name"]);

	const { owner, name } = JSON.parse(json);

	repoCache = { owner: owner.login, name };

	return repoCache;
}

export async function fetchParents(issueNumbers: number[]) {
	if (issueNumbers.length === 0) return new Map<number, ParentIssue>();

	const { owner, name } = await getRepo();

	const aliases = issueNumbers
		.map((n) => `i${n}: issue(number: ${n}) { parent { number } }`)
		.join(" ");

	const query = `{ repository(owner: "${owner}", name: "${name}") { ${aliases} } }`;

	const result = await exec(["gh", "api", "graphql", "-f", `query=${query}`]);

	const data = JSON.parse(result).data.repository;

	const parents = new Map<number, ParentIssue>();

	for (const num of issueNumbers) {
		const parent = data[`i${num}`]?.parent;

		if (parent) {
			parents.set(num, { number: parent.number });
		}
	}

	return parents;
}

async function allSubIssuesCompleted(parentNumber: number) {
	const { owner, name } = await getRepo();

	const query = `{ repository(owner: "${owner}", name: "${name}") { issue(number: ${parentNumber}) { subIssuesSummary { completed total } } } }`;

	const result = await exec(["gh", "api", "graphql", "-f", `query=${query}`]);

	const summary = JSON.parse(result).data.repository.issue.subIssuesSummary;

	return summary.total > 0 && summary.completed === summary.total;
}

export async function closeCompletedParents(
	parents: Map<number, ParentIssue>,
	results: { issue: { number: number }; status: string }[],
) {
	if (parents.size === 0) return;

	const groups = new Map<number, number[]>();

	for (const [subNumber, parent] of parents) {
		const group = groups.get(parent.number) ?? [];

		group.push(subNumber);

		groups.set(parent.number, group);
	}

	for (const [parentNumber, subNumbers] of groups) {
		const allSucceeded = subNumbers.every(
			(n) => results.find((r) => r.issue.number === n)?.status === "success",
		);

		if (!allSucceeded) continue;

		const allCompleted = await allSubIssuesCompleted(parentNumber);

		if (!allCompleted) continue;

		await exec(["gh", "issue", "close", String(parentNumber)]).catch(() => {});

		log.info(`Closed parent issue #${parentNumber}`);
	}
}
