import { describe, expect, it, vi } from "vitest";
import { withEmulatorSafety } from "./emulatorSafety.js";

const safe = {
	GCLOUD_PROJECT: "demo-fincontrol",
	FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
};

describe("emulator initialization gate", () => {
	it.each([
		undefined,
		"localhost:9199",
		"192.0.2.1:9199",
		"127.0.0.1:9200",
		"https://127.0.0.1:9199",
	])(
		"rejects Storage endpoint %s before SDK initialization",
		async (endpoint) => {
			const initialize = vi.fn();
			await expect(
				withEmulatorSafety(
					{ ...safe, FIREBASE_STORAGE_EMULATOR_HOST: endpoint },
					initialize,
					{ requireStorage: true },
				),
			).rejects.toThrow(/Unsafe emulator/);
			expect(initialize).not.toHaveBeenCalled();
		},
	);

	it("allows Storage initialization only at the exact loopback endpoint", async () => {
		const initialize = vi.fn(() => "ready");
		await expect(
			withEmulatorSafety(
				{ ...safe, FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199" },
				initialize,
				{ requireStorage: true },
			),
		).resolves.toBe("ready");
		expect(initialize).toHaveBeenCalledOnce();
	});

	it.each([
		{ FIRESTORE_EMULATOR_HOST: undefined },
		{ FIRESTORE_EMULATOR_HOST: "localhost:8080" },
		{ FIRESTORE_EMULATOR_HOST: "192.0.2.1:8080" },
		{ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8081" },
		{ GCLOUD_PROJECT: undefined },
		{ GCLOUD_PROJECT: "demo-other" },
		{ GCLOUD_PROJECT: "live-project" },
		{ GOOGLE_CLOUD_PROJECT: "live-project" },
		{ GOOGLE_APPLICATION_CREDENTIALS: "" },
		{ FIREBASE_TOKEN: "synthetic" },
		{ GOOGLE_OAUTH_ACCESS_TOKEN: "synthetic" },
		{ VITE_FIREBASE_PROJECT_ID: "demo-fincontrol" },
		{ FIREBASE_CONFIG: '{"projectId":"live-project"}' },
		{ FIREBASE_CONFIG: "not-json" },
	])(
		"rejects unsafe environment %j before SDK initialization",
		async (override) => {
			for (const requireStorage of [false, true]) {
				const initialize = vi.fn();
				await expect(
					withEmulatorSafety(
						{
							...safe,
							FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
							...override,
						},
						initialize,
						{ requireStorage },
					),
				).rejects.toThrow(/Unsafe emulator/);
				expect(initialize).not.toHaveBeenCalled();
			}
		},
	);

	it("allows only the exact demo/loopback boundary", async () => {
		const initialize = vi.fn(() => "ready");
		await expect(withEmulatorSafety(safe, initialize)).resolves.toBe("ready");
		expect(initialize).toHaveBeenCalledWith({
			projectId: "demo-fincontrol",
			host: "127.0.0.1",
			port: 8080,
		});
	});

	it("accepts the CLI demo project configuration", async () => {
		const initialize = vi.fn();
		await withEmulatorSafety(
			{ ...safe, FIREBASE_CONFIG: '{"projectId":"demo-fincontrol"}' },
			initialize,
		);
		expect(initialize).toHaveBeenCalledOnce();
	});
});
