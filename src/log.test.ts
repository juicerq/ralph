import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { WorkerResult } from "./worker";

const originalLog = console.log;

let logged: string[];

beforeEach(() => {
	logged = [];
	console.log = mock((...args: unknown[]) => {
		logged.push(args.map(String).join(" "));
	});
});

afterEach(() => {
	console.log = originalLog;
});

// Import after mocking would cause issues since console.log is global,
// so we import normally and just capture calls.
import * as log from "./log";

describe("info", () => {
	test("logs a dimmed message", () => {
		log.info("hello");

		expect(logged.length).toBe(1);
		expect(logged[0]).toContain("hello");
	});
});

describe("status", () => {
	test("logs issue number, title, and status", () => {
		log.status({ number: 42, title: "Fix bug" }, "starting");

		expect(logged.length).toBe(1);
		expect(logged[0]).toContain("#42");
		expect(logged[0]).toContain("Fix bug");
		expect(logged[0]).toContain("starting");
	});
});

describe("summary", () => {
	const issue = { number: 1, title: "Add auth", body: "", dependsOn: [] };

	test("shows result counts", () => {
		const results: WorkerResult[] = [
			{ issue, status: "success", branch: "ralph/1" },
			{
				issue: { ...issue, number: 2, title: "Fix bug" },
				status: "failed",
				error: "boom",
				branch: "ralph/2",
			},
		];

		log.summary(results);

		const output = logged.join("\n");

		expect(output).toContain("1 succeeded, 1 failed");
	});

	test("shows ok tag for success", () => {
		const results: WorkerResult[] = [{ issue, status: "success", branch: "ralph/1" }];

		log.summary(results);

		const output = logged.join("\n");

		expect(output).toContain("[ok]");
		expect(output).toContain("#1");
	});

	test("shows fail tag and error for failed", () => {
		const results: WorkerResult[] = [
			{ issue, status: "failed", error: "something broke", branch: "ralph/1" },
		];

		log.summary(results);

		const output = logged.join("\n");

		expect(output).toContain("[fail]");
		expect(output).toContain("something broke");
	});

	test("shows conflict tag for merge-failed", () => {
		const results: WorkerResult[] = [
			{ issue, status: "merge-failed", error: "conflict", branch: "ralph/1" },
		];

		log.summary(results);

		const output = logged.join("\n");

		expect(output).toContain("[conflict]");
	});

	test("shows log file hint for non-success", () => {
		const results: WorkerResult[] = [{ issue, status: "failed", error: "err", branch: "ralph/1" }];

		log.summary(results);

		const output = logged.join("\n");

		expect(output).toContain(".ralph/logs/1.log");
	});

	test("does not show log hint for success", () => {
		const results: WorkerResult[] = [{ issue, status: "success", branch: "ralph/1" }];

		log.summary(results);

		const output = logged.join("\n");

		expect(output).not.toContain(".ralph/logs/");
	});

	test("handles empty results", () => {
		log.summary([]);

		const output = logged.join("\n");

		expect(output).toContain("0 succeeded, 0 failed");
	});
});
