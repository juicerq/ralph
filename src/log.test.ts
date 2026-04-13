import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { WorkerResult } from "./worker";

let logged: string[] = [];

mock.module("@clack/prompts", () => {
	const capture = (...args: unknown[]) => {
		logged.push(args.map(String).join(" "));
	};

	return {
		intro: capture,
		outro: capture,
		log: {
			info: capture,
			step: capture,
			success: capture,
			warning: capture,
			error: capture,
			message: capture,
		},
		taskLog: () => ({
			message: capture,
			success: capture,
			error: capture,
		}),
	};
});

import * as log from "./log";

beforeEach(() => {
	logged = [];
});

describe("info", () => {
	test("logs a message", () => {
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

		expect(logged[0]).toContain("▶");

		expect(logged[0]).toContain("starting");
	});

	test("uses ✓ for merged", () => {
		log.status({ number: 1, title: "X" }, "merged");

		expect(logged[0]).toContain("✓");
	});

	test("uses ✗ for failed", () => {
		log.status({ number: 1, title: "X" }, "failed");

		expect(logged[0]).toContain("✗");
	});

	test("uses ● for unknown status", () => {
		log.status({ number: 1, title: "X" }, "custom");

		expect(logged[0]).toContain("●");
	});
});

describe("summary", () => {
	const issue = { number: 1, title: "Add auth", body: "", dependsOn: [] };

	test("shows succeeded issue", () => {
		const results: WorkerResult[] = [{ issue, status: "success", branch: "ralph/1" }];

		log.summary(results);

		const output = logged.join("\n");

		expect(output).toContain("#1");

		expect(output).toContain("Add auth");
	});

	test("shows error message for failed", () => {
		const results: WorkerResult[] = [
			{ issue, status: "failed", error: "something broke", branch: "ralph/1" },
		];

		log.summary(results);

		const output = logged.join("\n");

		expect(output).toContain("something broke");
	});

	test("shows merge-failed issue", () => {
		const results: WorkerResult[] = [
			{ issue, status: "merge-failed", error: "conflict", branch: "ralph/1" },
		];

		log.summary(results);

		const output = logged.join("\n");

		expect(output).toContain("#1");

		expect(output).toContain("conflict");
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

		expect(logged.length).toBe(0);
	});
});
