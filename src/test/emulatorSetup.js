import process from "node:process";
import { vi } from "vitest";
import { withEmulatorSafety } from "./emulatorSafety.js";

// Application initialization (Auth, persistence, live config) is never part of this harness.
vi.mock("../services/firebase.js", () => {
	throw new Error(
		"Unsafe emulator: application Firebase initialization is forbidden",
	);
});
await withEmulatorSafety(process.env, () => undefined);
