import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Issue } from "./planner";

const mockRunClaude = mock();

mock.module("./claude", () => ({
	runClaude: mockRunClaude,
}));

// Bun corrupts re-exported modules when they are loaded for real before
// being mocked. planner.ts imports ./exec (a re-export of ./exec-impl);
// without this mock, the real load poisons ./exec-impl for later test
// files that need the real implementation.
mock.module("./exec", () => ({ exec: mock() }));

const { runPlanner } = await import("./planner");

beforeEach(() => {
	mockRunClaude.mockReset();
});

const issues: Issue[] = [
	{ number: 1, title: "Add auth", body: "Auth system" },
	{ number: 2, title: "Fix typo", body: "Typo in readme" },
	{ number: 3, title: "Refactor DB", body: "DB layer" },
];

describe("runPlanner", () => {
	test("single issue: skips Claude", async () => {
		const result = await runPlanner([issues[0]]);

		expect(result).toEqual([{ number: 1, title: "Add auth", dependsOn: [] }]);
		expect(mockRunClaude).not.toHaveBeenCalled();
	});

	test("multiple issues: parses dependencies from Claude", async () => {
		mockRunClaude.mockImplementation(
			async () =>
				`[{"number": 1, "title": "Add auth", "dependsOn": []}, {"number": 2, "title": "Fix typo", "dependsOn": [1]}]`,
		);

		const result = await runPlanner([issues[0], issues[1]]);

		expect(result).toEqual([
			{ number: 1, title: "Add auth", dependsOn: [] },
			{ number: 2, title: "Fix typo", dependsOn: [1] },
		]);
	});

	test("filters out issues and dependsOn refs not in the original list", async () => {
		mockRunClaude.mockImplementation(
			async () => `[{"number": 1, "title": "Add auth", "dependsOn": [999]}]`,
		);

		const result = await runPlanner([issues[0], issues[1]]);

		expect(result).toEqual([{ number: 1, title: "Add auth", dependsOn: [] }]);
	});

	test("defaults missing dependsOn to empty array", async () => {
		mockRunClaude.mockImplementation(async () => `[{"number": 1, "title": "Add auth"}]`);

		const result = await runPlanner([issues[0], issues[1]]);

		expect(result).toEqual([{ number: 1, title: "Add auth", dependsOn: [] }]);
	});

	test("throws on invalid JSON from Claude", async () => {
		mockRunClaude.mockImplementation(async () => "I don't know what to do");

		expect(runPlanner([issues[0], issues[1]])).rejects.toThrow("invalid JSON");
	});

	test("extracts the JSON array even when Claude wraps it in prose", async () => {
		mockRunClaude.mockImplementation(
			async () =>
				'Here is the plan:\n```json\n[{"number": 1, "title": "Add auth", "dependsOn": [2]}, {"number": 2, "title": "Fix typo", "dependsOn": []}]\n```\nDone.',
		);

		const result = await runPlanner([issues[0], issues[1]]);

		expect(result).toEqual([
			{ number: 1, title: "Add auth", dependsOn: [2] },
			{ number: 2, title: "Fix typo", dependsOn: [] },
		]);
	});
});
