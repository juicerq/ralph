import { describe, test, expect, mock } from "bun:test"
import type { Issue } from "./planner"

mock.module("./exec", () => ({
	exec: mock(),
	runClaude: mock(),
}))

// extractPlan is private — test via runPlanner with single issue (skips Claude)
// and test the JSON parsing behavior through the public API
const { runPlanner } = await import("./planner")

const issues: Issue[] = [
	{ number: 1, title: "Add auth", body: "Auth system" },
	{ number: 2, title: "Fix typo", body: "Typo in readme" },
	{ number: 3, title: "Refactor DB", body: "DB layer" },
]

describe("runPlanner", () => {
	test("single issue: returns opus without calling Claude", async () => {
		const { runClaude } = await import("./exec")

		const result = await runPlanner([issues[0]])

		expect(result).toEqual([{ number: 1, title: "Add auth", model: "opus" }])
		expect(runClaude).not.toHaveBeenCalled()
	})

	test("multiple issues: parses Claude JSON output", async () => {
		const { runClaude } = await import("./exec") as { runClaude: ReturnType<typeof mock> }

		runClaude.mockImplementation(async () =>
			`Here's the plan:\n[{"number": 2, "title": "Fix typo", "model": "sonnet"}, {"number": 1, "title": "Add auth", "model": "opus"}]`
		)

		const result = await runPlanner([issues[0], issues[1]])

		expect(result).toEqual([
			{ number: 2, title: "Fix typo", model: "sonnet" },
			{ number: 1, title: "Add auth", model: "opus" },
		])
	})

	test("filters out issues not in the original list", async () => {
		const { runClaude } = await import("./exec") as { runClaude: ReturnType<typeof mock> }

		runClaude.mockImplementation(async () =>
			`[{"number": 1, "title": "Add auth", "model": "opus"}, {"number": 999, "title": "Ghost", "model": "sonnet"}]`
		)

		const result = await runPlanner([issues[0], issues[1]])

		expect(result).toEqual([{ number: 1, title: "Add auth", model: "opus" }])
	})

	test("throws on invalid JSON from Claude", async () => {
		const { runClaude } = await import("./exec") as { runClaude: ReturnType<typeof mock> }

		runClaude.mockImplementation(async () => "I don't know what to do")

		expect(runPlanner([issues[0], issues[1]])).rejects.toThrow("invalid JSON")
	})
})
