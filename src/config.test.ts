import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtemp } from "fs/promises";

import { loadConfig, resolveModel } from "./config";

let testDir: string;

let originalCwd: string;

beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), "swarm-config-test-"));
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

		expect(config.label).toBe("swarm");
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

		expect(config.label).toBe("swarm");
		expect(config.concurrency).toBe(1);
	});

	test("config file values are used", async () => {
		await writeFile(
			join(testDir, "swarm.config.ts"),
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
			join(testDir, "swarm.config.ts"),
			`export default { label: "from-file", model: "sonnet" };`,
		);

		const config = await loadConfig({ label: "from-flag" });

		expect(config.label).toBe("from-flag");
		expect(config.model).toBe("sonnet");
	});

	test("partial flags with config file: merge correctly", async () => {
		await writeFile(
			join(testDir, "swarm.config.ts"),
			`export default { concurrency: 3, retries: 5 };`,
		);

		const config = await loadConfig({ concurrency: 8 });

		expect(config.concurrency).toBe(8);
		expect(config.retries).toBe(5);
		expect(config.label).toBe("swarm");
	});

	test("undefined flag does not overwrite config file value", async () => {
		await writeFile(join(testDir, "swarm.config.ts"), `export default { label: "from-file" };`);

		const config = await loadConfig({ label: undefined });

		expect(config.label).toBe("from-file");
	});

	test("config file without a default export is treated as empty", async () => {
		await writeFile(join(testDir, "swarm.config.ts"), `export const other = 1;`);

		const config = await loadConfig({});

		expect(config.label).toBe("swarm");
	});
});

describe("resolveModel", () => {
	test("maps opus alias to the current opus model id", () => {
		expect(resolveModel("opus")).toBe("claude-opus-4-6");
	});

	test("maps sonnet alias to the current sonnet model id", () => {
		expect(resolveModel("sonnet")).toBe("claude-sonnet-4-6");
	});

	test("maps haiku alias to the current haiku model id", () => {
		expect(resolveModel("haiku")).toBe("claude-haiku-4-5-20251001");
	});

	test("passes through an unknown value unchanged (custom model id)", () => {
		expect(resolveModel("claude-some-future-model")).toBe("claude-some-future-model");
	});
});
