import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtemp } from "fs/promises";

import { loadConfig } from "./config";

let testDir: string;

let originalCwd: string;

beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), "ralph-config-test-"));
	originalCwd = process.cwd();
	process.chdir(testDir);
});

afterEach(async () => {
	process.chdir(originalCwd);
	await rm(testDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
	test("returns defaults when no flags or config file", async () => {
		const config = await loadConfig({});

		expect(config.label).toBe("ralph");
		expect(config.concurrency).toBe(1);
		expect(config.model).toBe("opus");
		expect(config.retries).toBe(1);
		expect(config.prompt).toContain("Implement the issue");
	});

	test("flags override defaults", async () => {
		const config = await loadConfig({
			label: "custom",
			concurrency: 4,
			model: "sonnet",
			retries: 3,
		});

		expect(config.label).toBe("custom");
		expect(config.concurrency).toBe(4);
		expect(config.model).toBe("sonnet");
		expect(config.retries).toBe(3);
	});

	test("undefined flags do not override defaults", async () => {
		const config = await loadConfig({
			label: undefined,
			concurrency: undefined,
		});

		expect(config.label).toBe("ralph");
		expect(config.concurrency).toBe(1);
	});

	test("config file values are used", async () => {
		await writeFile(
			join(testDir, "ralph.config.ts"),
			`export default { label: "from-file", concurrency: 2 };`,
		);

		const config = await loadConfig({});

		expect(config.label).toBe("from-file");
		expect(config.concurrency).toBe(2);
		// Defaults still fill in the rest
		expect(config.model).toBe("opus");
	});

	test("flags override config file values", async () => {
		await writeFile(
			join(testDir, "ralph.config.ts"),
			`export default { label: "from-file", model: "sonnet" };`,
		);

		const config = await loadConfig({ label: "from-flag" });

		expect(config.label).toBe("from-flag");
		expect(config.model).toBe("sonnet");
	});

	test("partial flags with config file: merge correctly", async () => {
		await writeFile(
			join(testDir, "ralph.config.ts"),
			`export default { concurrency: 3, retries: 5 };`,
		);

		const config = await loadConfig({ concurrency: 8 });

		expect(config.concurrency).toBe(8);
		expect(config.retries).toBe(5);
		expect(config.label).toBe("ralph");
	});
});
