import { describe, expect, test } from "bun:test";

import { parseFlags } from "./flags";

describe("parseFlags", () => {
	test("empty args: every field undefined", () => {
		expect(parseFlags([])).toEqual({
			issue: undefined,
			label: undefined,
			concurrency: undefined,
			model: undefined,
			prompt: undefined,
			retries: undefined,
		});
	});

	test("parses all known flags with numeric coercion", () => {
		expect(
			parseFlags([
				"--issue",
				"42",
				"--label",
				"feat",
				"--concurrency",
				"4",
				"--model",
				"sonnet",
				"--prompt",
				"be careful",
				"--retries",
				"3",
			]),
		).toEqual({
			issue: 42,
			label: "feat",
			concurrency: 4,
			model: "sonnet",
			prompt: "be careful",
			retries: 3,
		});
	});

	test("ignores unknown flags without disturbing known ones", () => {
		expect(parseFlags(["--bogus", "x", "--label", "feat"])).toMatchObject({ label: "feat" });
	});

	test("ignores a trailing flag with no value", () => {
		expect(parseFlags(["--label"])).toMatchObject({ label: undefined });
	});

	test("positional values without a preceding flag are ignored", () => {
		expect(parseFlags(["positional", "--label", "feat"])).toMatchObject({ label: "feat" });
	});

	test("a later occurrence of the same flag overrides an earlier one", () => {
		expect(parseFlags(["--label", "a", "--label", "b"])).toMatchObject({ label: "b" });
	});

	test("-h/--help are not parsed as value-bearing flags here (handled by main)", () => {
		expect(parseFlags(["--help"])).toEqual({
			issue: undefined,
			label: undefined,
			concurrency: undefined,
			model: undefined,
			prompt: undefined,
			retries: undefined,
		});
	});

	test("known limitation: a flag followed by another flag consumes it as the value", () => {
		// Documents the behaviour of the simple two-token parser.
		// `--label --concurrency 4` yields label="--concurrency", concurrency=undefined.
		expect(parseFlags(["--label", "--concurrency", "4"])).toMatchObject({
			label: "--concurrency",
			concurrency: undefined,
		});
	});
});
