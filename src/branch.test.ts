import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";

const mockExec = mock();

const mockText = mock();

mock.module("./exec", () => ({
	exec: mockExec,
}));

const noop = () => {};

const noopTaskLog = () => ({ message: noop, success: noop, error: noop });

mock.module("@clack/prompts", () => ({
	text: mockText,
	intro: noop,
	outro: noop,
	log: {
		info: noop,
		step: noop,
		success: noop,
		warning: noop,
		error: noop,
		message: noop,
	},
	taskLog: noopTaskLog,
}));

const { promptBranch } = await import("./branch");

describe("promptBranch", () => {
	const originalIsTTY = process.stdin.isTTY;

	beforeEach(() => {
		mockExec.mockReset();
		mockText.mockReset();

		(process.stdin as any).isTTY = true;
	});

	afterEach(() => {
		(process.stdin as any).isTTY = originalIsTTY;
	});

	test("skips prompt in non-TTY environment", async () => {
		(process.stdin as any).isTTY = false;

		await promptBranch();

		expect(mockText).not.toHaveBeenCalled();
	});

	test("skips prompt when not on default branch", async () => {
		mockExec.mockImplementation((cmd: string[]) => {
			if (cmd.includes("rev-parse")) return Promise.resolve("feature/existing");

			if (cmd.includes("gh")) return Promise.resolve("main");

			return Promise.resolve("");
		});

		await promptBranch();

		expect(mockText).not.toHaveBeenCalled();
	});

	test("shows prompt when on default branch", async () => {
		mockExec.mockImplementation((cmd: string[]) => {
			if (cmd.includes("rev-parse")) return Promise.resolve("main");

			if (cmd.includes("gh")) return Promise.resolve("main");

			return Promise.resolve("");
		});

		mockText.mockResolvedValue("");

		await promptBranch();

		expect(mockText).toHaveBeenCalledTimes(1);

		const call = mockText.mock.calls[0][0];

		expect(call.message).toBe("Branch name (enter to stay on main)");
		expect(call.placeholder).toBe("feature/...");
	});

	test("creates branch when user provides name", async () => {
		mockExec.mockImplementation((cmd: string[]) => {
			if (cmd.includes("rev-parse")) return Promise.resolve("main");

			if (cmd.includes("gh")) return Promise.resolve("main");

			return Promise.resolve("");
		});

		mockText.mockResolvedValue("feature/new-thing");

		await promptBranch();

		expect(mockExec).toHaveBeenCalledWith(["git", "checkout", "-b", "feature/new-thing"]);
	});

	test("does not create branch when user presses enter (empty input)", async () => {
		mockExec.mockImplementation((cmd: string[]) => {
			if (cmd.includes("rev-parse")) return Promise.resolve("main");

			if (cmd.includes("gh")) return Promise.resolve("main");

			return Promise.resolve("");
		});

		mockText.mockResolvedValue("");

		await promptBranch();

		const checkoutCalls = mockExec.mock.calls.filter((call: string[][]) =>
			call[0].includes("checkout"),
		);

		expect(checkoutCalls).toHaveLength(0);
	});

	test("does not create branch when user cancels (symbol returned)", async () => {
		mockExec.mockImplementation((cmd: string[]) => {
			if (cmd.includes("rev-parse")) return Promise.resolve("main");

			if (cmd.includes("gh")) return Promise.resolve("main");

			return Promise.resolve("");
		});

		mockText.mockResolvedValue(Symbol("cancel"));

		await promptBranch();

		const checkoutCalls = mockExec.mock.calls.filter((call: string[][]) =>
			call[0].includes("checkout"),
		);

		expect(checkoutCalls).toHaveLength(0);
	});

	test("falls back to main when gh command fails", async () => {
		mockExec.mockImplementation((cmd: string[]) => {
			if (cmd.includes("rev-parse")) return Promise.resolve("main");

			if (cmd.includes("gh")) return Promise.reject(new Error("gh not found"));

			return Promise.resolve("");
		});

		mockText.mockResolvedValue("");

		await promptBranch();

		expect(mockText).toHaveBeenCalledTimes(1);

		const call = mockText.mock.calls[0][0];

		expect(call.message).toBe("Branch name (enter to stay on main)");
	});

	test("adapts message to non-main default branch", async () => {
		mockExec.mockImplementation((cmd: string[]) => {
			if (cmd.includes("rev-parse")) return Promise.resolve("develop");

			if (cmd.includes("gh")) return Promise.resolve("develop");

			return Promise.resolve("");
		});

		mockText.mockResolvedValue("");

		await promptBranch();

		const call = mockText.mock.calls[0][0];

		expect(call.message).toBe("Branch name (enter to stay on develop)");
	});
});
