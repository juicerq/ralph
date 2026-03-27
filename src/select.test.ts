import { describe, test, expect, mock } from "bun:test";

const mockExec = mock();

const mockCheckbox = mock();

mock.module("./exec", () => ({
	exec: mockExec,
}));

mock.module("@inquirer/prompts", () => ({
	checkbox: mockCheckbox,
}));

const { selectIssues } = await import("./select");

describe("selectIssues", () => {
	test("returns empty array when no issues exist", async () => {
		mockExec.mockResolvedValue("[]");

		const result = await selectIssues();

		expect(result).toEqual([]);
		expect(mockCheckbox).not.toHaveBeenCalled();
	});

	test("calls gh issue list with correct args", async () => {
		mockExec.mockResolvedValue("[]");

		await selectIssues();

		expect(mockExec).toHaveBeenCalledWith([
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
	});

	test("presents issues as checkbox choices and returns selected", async () => {
		const issues = [
			{ number: 1, title: "Add auth", body: "Auth system" },
			{ number: 2, title: "Fix typo", body: "Typo fix" },
		];
		mockExec.mockResolvedValue(JSON.stringify(issues));
		mockCheckbox.mockResolvedValue([issues[0]]);

		const result = await selectIssues();

		expect(result).toEqual([issues[0]]);
		expect(mockCheckbox).toHaveBeenCalledTimes(1);

		const call = mockCheckbox.mock.calls[0][0];
		expect(call.message).toBe("Select issues to implement");
		expect(call.choices).toEqual([
			{ name: "#1 Add auth", value: issues[0] },
			{ name: "#2 Fix typo", value: issues[1] },
		]);
	});

	test("returns all issues when all selected", async () => {
		const issues = [
			{ number: 1, title: "A", body: "" },
			{ number: 2, title: "B", body: "" },
			{ number: 3, title: "C", body: "" },
		];
		mockExec.mockResolvedValue(JSON.stringify(issues));
		mockCheckbox.mockResolvedValue(issues);

		const result = await selectIssues();

		expect(result).toEqual(issues);
	});
});
