import { describe, expect, it } from "vitest";

import { OPERATIONAL_DATA_START } from "../../../finance/constants.js";
import { pendingInboxCount, pendingRemesasCount } from "./ritualCounts.js";

const movement = (overrides = {}) => ({
	id: "mov-1",
	direction: "out",
	amount: 119,
	status: "posted",
	postedDate: "2026-06-01",
	categoryName: "",
	...overrides,
});

describe("pendingInboxCount", () => {
	it("counts operational movements with a pendingReasonOf", () => {
		expect(
			pendingInboxCount([
				movement({ id: "open", categoryName: "" }),
				movement({
					id: "classified",
					categoryName: "Materiales",
					costScope: "overhead",
				}),
			]),
		).toBe(1);
	});

	it("does not treat missing-invoice-only rows as inbox", () => {
		expect(
			pendingInboxCount([
				movement({
					id: "invoice-gap",
					categoryName: "Materiales",
					costScope: "overhead",
					projectId: "",
				}),
			]),
		).toBe(0);
	});

	it("skips void rows and anything before OPERATIONAL_DATA_START", () => {
		expect(
			pendingInboxCount([
				movement({ id: "voided", status: "void", categoryName: "" }),
				movement({
					id: "historical",
					postedDate: "2025-12-31",
					categoryName: "",
				}),
			]),
		).toBe(0);
		expect(OPERATIONAL_DATA_START).toBe("2026-01-01");
	});

	it("returns 0 for malformed input without throwing", () => {
		expect(pendingInboxCount(null)).toBe(0);
		expect(pendingInboxCount(undefined)).toBe(0);
		expect(pendingInboxCount({})).toBe(0);
		expect(pendingInboxCount([null, undefined, movement({ id: "ok" })])).toBe(1);
	});
});

describe("pendingRemesasCount", () => {
	it("counts live incoming batches that are not internal transfers", () => {
		expect(
			pendingRemesasCount([
				movement({
					id: "remesa",
					direction: "in",
					amount: 10000,
					kind: "collection",
				}),
				movement({
					id: "internal",
					direction: "in",
					amount: 4000,
					kind: "transfer",
				}),
				movement({ id: "outflow", direction: "out", amount: 500 }),
			]),
		).toBe(1);
	});

	it("returns 0 for malformed input without throwing", () => {
		expect(pendingRemesasCount(null)).toBe(0);
		expect(pendingRemesasCount(undefined)).toBe(0);
		expect(pendingRemesasCount("nope")).toBe(0);
		expect(pendingRemesasCount([null, { direction: "in", amount: 50 }])).toBe(1);
	});
});
