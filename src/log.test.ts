import { beforeEach, describe, expect, mock, test } from "bun:test";

type LogEntry = { level: string; text: string };

let entries: LogEntry[] = [];

let taskLogEntries: LogEntry[] = [];

mock.module("@clack/prompts", () => {
	const push =
		(level: string) =>
		(...args: unknown[]) => {
			entries.push({ level, text: args.map(String).join(" ") });
		};

	const pushTask =
		(level: string) =>
		(...args: unknown[]) => {
			taskLogEntries.push({ level, text: args.map(String).join(" ") });
		};

	return {
		intro: push("intro"),
		outro: push("outro"),
		log: {
			info: push("info"),
			step: push("step"),
			success: push("success"),
			warning: push("warning"),
			error: push("error"),
			message: push("message"),
		},
		taskLog: () => ({
			message: pushTask("message"),
			success: pushTask("success"),
			error: pushTask("error"),
		}),
		// Present so other test files that interleave with this one — and reuse the same
		// global @clack/prompts mock — can still resolve the `text` binding.
		text: async () => "",
	};
});

const log = await import("./log");

beforeEach(() => {
	entries = [];
	taskLogEntries = [];
});

describe("status", () => {
	test("formats issue number, title, symbol, and message", () => {
		log.status({ number: 42, title: "Fix bug" }, "starting");

		expect(entries).toEqual([{ level: "step", text: "#42 Fix bug  ▶ starting" }]);
	});

	test.each([
		["merged", "✓"],
		["resolved", "✓"],
		["already done", "✓"],
		["starting", "▶"],
		["retrying", "▶"],
		["resolving", "▶"],
		["failed", "✗"],
		["merge-failed", "✗"],
		["unresolved", "✗"],
		["anything else", "●"],
	])("uses %s symbol for status %s", (status, symbol) => {
		log.status({ number: 1, title: "X" }, status);

		expect(entries[0].text).toContain(symbol);
	});

	test("routes to taskLog while workers are active", () => {
		log.startWorkers();

		log.status({ number: 7, title: "T" }, "starting");

		expect(entries.filter((e) => e.level === "step")).toEqual([]);

		expect(taskLogEntries).toEqual([{ level: "message", text: "#7 T  ▶ starting" }]);

		log.endWorkers([]);
	});
});

describe("toolCall", () => {
	test("writes to taskLog with padded tool name", () => {
		log.startWorkers();

		log.toolCall(3, "Edit", "src/foo.ts");

		expect(taskLogEntries).toEqual([{ level: "message", text: "#3 ── Edit         src/foo.ts" }]);

		log.endWorkers([]);
	});

	test("is a no-op when workers have not started", () => {
		log.toolCall(3, "Edit", "src/foo.ts");

		expect(taskLogEntries).toEqual([]);

		expect(entries).toEqual([]);
	});
});

describe("endWorkers", () => {
	const issue = { number: 1, title: "T", body: "", dependsOn: [] };

	test("reports success when all succeeded or already-done", () => {
		log.startWorkers();

		log.endWorkers([
			{ issue, status: "success", branch: "swarm/1" },
			{ issue: { ...issue, number: 2 }, status: "already-done", branch: "swarm/2" },
		]);

		expect(taskLogEntries).toEqual([{ level: "success", text: "2 issue(s) implemented" }]);
	});

	test("reports error when any failed", () => {
		log.startWorkers();

		log.endWorkers([
			{ issue, status: "success", branch: "swarm/1" },
			{ issue: { ...issue, number: 2 }, status: "failed", error: "x", branch: "swarm/2" },
		]);

		expect(taskLogEntries).toEqual([{ level: "error", text: "1 succeeded, 1 failed" }]);
	});

	test("is a no-op when workers have not started", () => {
		log.endWorkers([{ issue, status: "success", branch: "swarm/1" }]);

		expect(taskLogEntries).toEqual([]);
	});

	test("after endWorkers, subsequent status calls route to step again", () => {
		log.startWorkers();

		log.endWorkers([]);

		log.status(issue, "starting");

		expect(entries).toEqual([{ level: "step", text: "#1 T  ▶ starting" }]);
	});
});

describe("summary", () => {
	const issue = { number: 1, title: "Add auth", body: "", dependsOn: [] };

	test("success uses success level without a log hint", () => {
		log.summary([{ issue, status: "success", branch: "swarm/1" }]);

		expect(entries).toEqual([{ level: "success", text: "#1 Add auth" }]);
	});

	test("already-done uses info level", () => {
		log.summary([{ issue, status: "already-done", branch: "swarm/1" }]);

		expect(entries).toEqual([{ level: "info", text: "#1 Add auth — already implemented" }]);
	});

	test("failed uses error level and includes error message plus log hint", () => {
		log.summary([{ issue, status: "failed", error: "boom", branch: "swarm/1" }]);

		expect(entries).toEqual([{ level: "error", text: "#1 Add auth — boom → .swarm/logs/1.log" }]);
	});

	test("merge-failed uses warning level, not error", () => {
		log.summary([{ issue, status: "merge-failed", error: "conflict", branch: "swarm/1" }]);

		expect(entries).toEqual([
			{ level: "warning", text: "#1 Add auth — conflict → .swarm/logs/1.log" },
		]);
	});
});
