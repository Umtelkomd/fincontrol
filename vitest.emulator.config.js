import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
	envDir: false,
	resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
	test: {
		environment: "node",
		include: ["src/test/*.integration.test.js"],
		setupFiles: ["./src/test/emulatorSetup.js"],
		fileParallelism: false,
		testTimeout: 15000,
		hookTimeout: 30000,
	},
});
