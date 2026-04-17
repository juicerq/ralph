import { beforeEach, describe, expect, mock, test } from "bun:test";

const mockExec = mock();

mock.module("./exec", () => ({
	exec: mockExec,
}));

const { fetchParents, closeCompletedParents } = await import("./parent");

const repoResponse = JSON.stringify({ owner: { login: "acme" }, name: "widgets" });

function parentsGraphqlResponse(map: Record<number, number | null>) {
	const repository: Record<string, { parent: { number: number } | null }> = {};

	for (const [num, parent] of Object.entries(map)) {
		repository[`i${num}`] = parent === null ? { parent: null } : { parent: { number: parent } };
	}

	return JSON.stringify({ data: { repository } });
}

function summaryResponse(completed: number, total: number) {
	return JSON.stringify({
		data: { repository: { issue: { subIssuesSummary: { completed, total } } } },
	});
}

describe("fetchParents", () => {
	beforeEach(() => {
		mockExec.mockReset();
	});

	test("returns empty map without any exec calls when given no issues", async () => {
		const result = await fetchParents([]);

		expect(result.size).toBe(0);

		expect(mockExec).not.toHaveBeenCalled();
	});

	test("maps child issue numbers to their parent numbers", async () => {
		mockExec.mockImplementationOnce(async () => repoResponse);

		mockExec.mockImplementationOnce(async () =>
			parentsGraphqlResponse({ 10: 99, 11: 99, 12: null }),
		);

		const result = await fetchParents([10, 11, 12]);

		expect(result.get(10)).toEqual({ number: 99 });

		expect(result.get(11)).toEqual({ number: 99 });

		expect(result.has(12)).toBe(false);
	});

	test("builds a graphql query containing aliases for every issue number", async () => {
		mockExec.mockImplementationOnce(async () => repoResponse);

		mockExec.mockImplementationOnce(async () => parentsGraphqlResponse({ 10: null, 11: null }));

		await fetchParents([10, 11]);

		const graphqlCall = mockExec.mock.calls[1][0];

		expect(graphqlCall.slice(0, 4)).toEqual(["gh", "api", "graphql", "-f"]);

		const query = graphqlCall[4];

		expect(query).toContain("i10: issue(number: 10)");

		expect(query).toContain("i11: issue(number: 11)");

		expect(query).toContain('owner: "acme"');

		expect(query).toContain('name: "widgets"');
	});
});

describe("closeCompletedParents", () => {
	const parents = new Map<number, { number: number }>([
		[10, { number: 99 }],
		[11, { number: 99 }],
	]);

	beforeEach(() => {
		mockExec.mockReset();
	});

	test("no-op when parents map is empty", async () => {
		await closeCompletedParents(new Map(), []);

		expect(mockExec).not.toHaveBeenCalled();
	});

	test("closes parent when all sub-issues succeeded and summary reports completed", async () => {
		mockExec.mockImplementation(async (cmd: string[]) => {
			if (cmd[1] === "repo") return repoResponse;

			if (cmd[1] === "api") return summaryResponse(3, 3);

			if (cmd[1] === "issue" && cmd[2] === "close") return "";

			throw new Error(`unexpected exec: ${cmd.join(" ")}`);
		});

		await closeCompletedParents(parents, [
			{ issue: { number: 10 }, status: "success" },
			{ issue: { number: 11 }, status: "success" },
		]);

		const closeCalls = mockExec.mock.calls.filter(
			(c: string[][]) => c[0][1] === "issue" && c[0][2] === "close",
		);

		expect(closeCalls).toEqual([[["gh", "issue", "close", "99"]]]);
	});

	test("skips close when any sub-issue did not succeed", async () => {
		mockExec.mockImplementation(async (cmd: string[]) => {
			if (cmd[1] === "repo") return repoResponse;

			throw new Error(`unexpected exec: ${cmd.join(" ")}`);
		});

		await closeCompletedParents(parents, [
			{ issue: { number: 10 }, status: "success" },
			{ issue: { number: 11 }, status: "failed" },
		]);

		const closeCalls = mockExec.mock.calls.filter(
			(c: string[][]) => c[0][1] === "issue" && c[0][2] === "close",
		);

		expect(closeCalls).toEqual([]);
	});

	test("skips close when subIssuesSummary reports more siblings still open", async () => {
		mockExec.mockImplementation(async (cmd: string[]) => {
			if (cmd[1] === "repo") return repoResponse;

			if (cmd[1] === "api") return summaryResponse(2, 5);

			throw new Error(`unexpected exec: ${cmd.join(" ")}`);
		});

		await closeCompletedParents(parents, [
			{ issue: { number: 10 }, status: "success" },
			{ issue: { number: 11 }, status: "success" },
		]);

		const closeCalls = mockExec.mock.calls.filter(
			(c: string[][]) => c[0][1] === "issue" && c[0][2] === "close",
		);

		expect(closeCalls).toEqual([]);
	});

	test("skips close when summary reports total 0 (defensive against GraphQL quirks)", async () => {
		mockExec.mockImplementation(async (cmd: string[]) => {
			if (cmd[1] === "repo") return repoResponse;

			if (cmd[1] === "api") return summaryResponse(0, 0);

			throw new Error(`unexpected exec: ${cmd.join(" ")}`);
		});

		await closeCompletedParents(parents, [
			{ issue: { number: 10 }, status: "success" },
			{ issue: { number: 11 }, status: "success" },
		]);

		const closeCalls = mockExec.mock.calls.filter(
			(c: string[][]) => c[0][1] === "issue" && c[0][2] === "close",
		);

		expect(closeCalls).toEqual([]);
	});

	test("a gh close failure does not propagate (best-effort)", async () => {
		mockExec.mockImplementation(async (cmd: string[]) => {
			if (cmd[1] === "repo") return repoResponse;

			if (cmd[1] === "api") return summaryResponse(3, 3);

			if (cmd[1] === "issue" && cmd[2] === "close") throw new Error("gh permission denied");

			throw new Error(`unexpected exec: ${cmd.join(" ")}`);
		});

		await closeCompletedParents(parents, [
			{ issue: { number: 10 }, status: "success" },
			{ issue: { number: 11 }, status: "success" },
		]);

		const closeCalls = mockExec.mock.calls.filter(
			(c: string[][]) => c[0][1] === "issue" && c[0][2] === "close",
		);

		expect(closeCalls).toHaveLength(1);
	});

	test("fetches repo info once across multiple parent groups", async () => {
		mockExec.mockImplementation(async (cmd: string[]) => {
			if (cmd[1] === "repo") return repoResponse;

			if (cmd[1] === "api") return summaryResponse(2, 3);

			throw new Error(`unexpected exec: ${cmd.join(" ")}`);
		});

		const multiParent = new Map<number, { number: number }>([
			[10, { number: 99 }],
			[20, { number: 88 }],
		]);

		await closeCompletedParents(multiParent, [
			{ issue: { number: 10 }, status: "success" },
			{ issue: { number: 20 }, status: "success" },
		]);

		const repoCalls = mockExec.mock.calls.filter((c: string[][]) => c[0][1] === "repo");

		expect(repoCalls).toHaveLength(1);
	});
});
