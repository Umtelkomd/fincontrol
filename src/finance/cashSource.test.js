import { describe, expect, it } from "vitest";
import { resolveCashSource } from "./cashSource";

const anchor = (date, balance, extra = {}) => ({
	date,
	balance,
	source: "datev",
	...extra,
});

const mv = (postedDate, direction, amount, extra = {}) => ({
	postedDate,
	direction,
	amount,
	status: "posted",
	...extra,
});

// Realistic production shape: DATEV SuSa anchor 2026-05-31 at +1214.20 €,
// June nets −2617.30, July (up to the 3rd) nets +7630.21 → 6227.11 today.
const PROD_ANCHOR = anchor("2026-05-31", 1214.2, { note: "DATEV SuSa 1200" });
const PROD_MOVEMENTS = [
	mv("2026-06-15", "out", 3000),
	mv("2026-06-20", "in", 382.7),
	mv("2026-07-01", "in", 7000),
	mv("2026-07-03", "in", 630.21),
];
const TODAY = "2026-07-10";

describe("resolveCashSource — source health", () => {
	it.each([
		[true, null, "loading", []],
		[false, new Error("synthetic failure"), "error", []],
		[false, new Error("synthetic failure"), "error", [PROD_ANCHOR]],
		[true, new Error("synthetic retry"), "loading", [PROD_ANCHOR]],
	])("never falls back during loading/error (%s, %s)", (reconciliationLoading, reconciliationError, status, anchors) => {
		const result = resolveCashSource({
			anchors,
			movements: PROD_MOVEMENTS,
			today: TODAY,
			legacyBalance: 987,
			reconciliationLoading,
			reconciliationError,
		});
		expect(result).toMatchObject({
			currentCash: null,
			source: "unavailable",
			cashMeta: { status, anchor: null },
		});
		expect(result.cashMeta.importGap.hasGap).toBe(false);
	});

	it("distinguishes valid absence from failure explicitly", () => {
		const result = resolveCashSource({
			anchors: [],
			movements: [],
			today: TODAY,
			legacyBalance: 987,
			reconciliationLoading: false,
			reconciliationError: null,
		});
		expect(result).toMatchObject({
			currentCash: 987,
			source: "legacy",
			cashMeta: { status: "ready" },
		});
	});
});

describe("resolveCashSource — anchors path", () => {
	it("derives the balance from the anchor plus later movements", () => {
		const result = resolveCashSource({
			anchors: [PROD_ANCHOR],
			movements: PROD_MOVEMENTS,
			today: TODAY,
			legacyBalance: -99999, // must be ignored when an anchor covers today
		});

		expect(result.source).toBe("anchors");
		expect(result.currentCash).toBe(6227.11);
		expect(result.cashMeta.anchor.date).toBe("2026-05-31");
		expect(result.cashMeta.anchor.balance).toBeCloseTo(1214.2, 2);
	});

	it("reports freshness metadata alongside the balance", () => {
		const result = resolveCashSource({
			anchors: [PROD_ANCHOR],
			movements: PROD_MOVEMENTS,
			today: TODAY,
		});

		expect(result.cashMeta.lastMovementDate).toBe("2026-07-03");
		expect(result.cashMeta.staleDays).toBe(7); // calendar days 07-03 → 07-10
		// Jul 6–10 are 5 quiet bank business days — at the default tolerance edge.
		expect(result.cashMeta.importGap).toEqual({
			hasGap: false,
			lastMovementDate: "2026-07-03",
			quietBusinessDays: 5,
		});
	});

	it("uses signedAmountOf semantics: zero signedAmount falls back to direction", () => {
		const result = resolveCashSource({
			anchors: [anchor("2026-05-31", 1000)],
			movements: [
				mv("2026-06-01", "out", 100, { signedAmount: 0 }), // legacy import: unusable
				mv("2026-06-02", "in", 50, { signedAmount: -50 }), // nonzero signedAmount wins
			],
			today: TODAY,
			legacyBalance: 0,
		});

		expect(result.currentCash).toBe(850); // 1000 - 100 - 50
	});

	it("keeps the anchor balance when no movements exist and flags the gap", () => {
		const result = resolveCashSource({
			anchors: [PROD_ANCHOR],
			movements: [],
			today: TODAY,
			legacyBalance: 0,
		});

		expect(result.source).toBe("anchors");
		expect(result.currentCash).toBeCloseTo(1214.2, 2);
		expect(result.cashMeta.lastMovementDate).toBeNull();
		expect(result.cashMeta.staleDays).toBeNull();
		expect(result.cashMeta.importGap.hasGap).toBe(true);
	});

	it("rounds float dust at the boundary", () => {
		const result = resolveCashSource({
			anchors: [anchor("2026-05-31", 0.1)],
			movements: [mv("2026-06-01", "in", 0.2)],
			today: TODAY,
			legacyBalance: 0,
		});
		expect(result.currentCash).toBe(0.3);
	});
});

describe("resolveCashSource — legacy fallback", () => {
	it("falls back to the legacy balance when the anchors array is empty", () => {
		const result = resolveCashSource({
			anchors: [],
			movements: PROD_MOVEMENTS,
			today: TODAY,
			legacyBalance: 12345.67,
		});

		expect(result.source).toBe("legacy");
		expect(result.currentCash).toBe(12345.67);
		expect(result.cashMeta.anchor).toBeNull();
		// Freshness still reported so the header/alerts work before the seed runs.
		expect(result.cashMeta.lastMovementDate).toBe("2026-07-03");
		expect(result.cashMeta.staleDays).toBe(7);
		expect(result.cashMeta.importGap.hasGap).toBe(false);
	});

	it("falls back when every anchor is in the future", () => {
		const result = resolveCashSource({
			anchors: [anchor("2026-08-31", 5000)],
			movements: PROD_MOVEMENTS,
			today: TODAY,
			legacyBalance: 777,
		});

		expect(result.source).toBe("legacy");
		expect(result.currentCash).toBe(777);
		expect(result.cashMeta.anchor).toBeNull();
	});

	it("falls back when anchors are malformed", () => {
		const result = resolveCashSource({
			anchors: [{ date: "not-a-date", balance: 100 }, { date: "2026-05-31" }],
			movements: [],
			today: TODAY,
			legacyBalance: 42,
		});

		expect(result.source).toBe("legacy");
		expect(result.currentCash).toBe(42);
	});

	it("tolerates missing inputs", () => {
		const result = resolveCashSource({ today: TODAY, legacyBalance: 10 });
		expect(result.source).toBe("legacy");
		expect(result.currentCash).toBe(10);
		expect(result.cashMeta.importGap.hasGap).toBe(true);
	});
});

describe("resolveCashSource — anchor drift", () => {
	it("surfaces the real production contradiction between the 05-31 and 07-27 anchors", () => {
		const result = resolveCashSource({
			anchors: [PROD_ANCHOR, anchor("2026-07-27", -16395.13)],
			movements: [mv("2026-06-15", "in", 21130.12)], // nets to the verified +21,130.12
			today: "2026-07-27",
			legacyBalance: 0,
		});

		expect(result.cashMeta.anchorDrift).toHaveLength(1);
		expect(result.cashMeta.anchorDrift[0]).toMatchObject({
			fromDate: "2026-05-31",
			toDate: "2026-07-27",
			expected: -16395.13,
		});
		expect(result.cashMeta.anchorDrift[0].drift).toBeCloseTo(38739.45, 2);
	});

	it("reports no drift with a single anchor", () => {
		const result = resolveCashSource({
			anchors: [PROD_ANCHOR],
			movements: PROD_MOVEMENTS,
			today: TODAY,
			legacyBalance: 0,
		});
		expect(result.cashMeta.anchorDrift).toEqual([]);
	});

	it("still reports anchorDrift while loading/error, alongside importGap", () => {
		const result = resolveCashSource({
			anchors: [PROD_ANCHOR, anchor("2026-07-27", -16395.13)],
			movements: [mv("2026-06-15", "in", 21130.12)],
			today: TODAY,
			legacyBalance: 987,
			reconciliationLoading: true,
		});
		expect(result.cashMeta.status).toBe("loading");
		expect(result.cashMeta.anchorDrift).toHaveLength(1);
	});
});
