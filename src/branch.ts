import { text } from "@clack/prompts";

import { exec } from "./exec";

export async function promptBranch() {
	if (!process.stdin.isTTY) return;

	const [current, defaultBranch] = await Promise.all([
		exec(["git", "rev-parse", "--abbrev-ref", "HEAD"]),
		exec([
			"gh",
			"repo",
			"view",
			"--json",
			"defaultBranchRef",
			"--jq",
			".defaultBranchRef.name",
		]).catch(() => "main"),
	]);

	if (current !== defaultBranch) return;

	const branch = await text({
		message: `Branch name (enter to stay on ${defaultBranch})`,
		placeholder: "feature/...",
	});

	if (!branch || typeof branch !== "string") return;

	await exec(["git", "checkout", "-b", branch]);
}
