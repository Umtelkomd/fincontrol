import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// Independent of vite.config.js: never load local application environment files.
export default defineConfig({
	envDir: false,
	plugins: [react(), tailwindcss()],
	resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
	test: {
		environment: "jsdom",
		setupFiles: ["./src/test/setup.js"],
		include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx}"],
		exclude: [...configDefaults.exclude, "**/*.integration.test.js"],
		env: {
			VITE_FIREBASE_API_KEY: "demo-key",
			VITE_FIREBASE_AUTH_DOMAIN: "demo-fincontrol.invalid",
			VITE_FIREBASE_PROJECT_ID: "demo-fincontrol",
			VITE_FIREBASE_STORAGE_BUCKET: "demo-fincontrol.invalid",
			VITE_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
			VITE_FIREBASE_APP_ID: "demo-app",
		},
	},
});
