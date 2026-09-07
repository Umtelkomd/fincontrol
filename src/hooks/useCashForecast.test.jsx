import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFirebaseMocks } from "../test/firebaseMock.js";

installFirebaseMocks();
vi.doMock("../finance/cashForecast", async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, buildCashForecast: vi.fn(actual.buildCashForecast) };
});
const { onSnapshot } = await import("firebase/firestore");
const { buildCashForecast } = await import("../finance/cashForecast");
const { useCashForecast } = await import("./useCashForecast.js");
const today = "2026-09-01";
const ready = {
	loading: false,
	error: null,
	sourceErrors: { reconciliation: null },
	cashSource: "anchors",
	cashMeta: { status: "ready" },
	summary: { currentCash: 321 },
	receivables: [],
	payables: [],
	postedMovements: [],
};
beforeEach(() => {
	buildCashForecast.mockClear();
});

describe("useCashForecast source health", () => {
	it("guards the standalone real-ledger path before loading and after ready fails", () => {
		const ordinarySubscribe = onSnapshot.getMockImplementation();
		let listener;
		onSnapshot.mockImplementation((ref, next, fail) => {
			if (ref.id !== "reconciliation")
				return ordinarySubscribe(ref, next, fail);
			listener = { next, fail };
			return () => {};
		});
		const user = { uid: "synthetic", email: "user@example.invalid" };
		const { result } = renderHook(() =>
			useCashForecast(user, { today, weeks: 2 }),
		);
		expect(result.current.status).toBe("loading");
		expect(buildCashForecast).not.toHaveBeenCalled();
		act(() =>
			listener.next({
				exists: () => true,
				data: () => ({ anchors: [{ date: "2026-01-01", balance: 321 }] }),
			}),
		);
		expect(result.current).toMatchObject({
			available: true,
			startBalance: 321,
		});
		buildCashForecast.mockClear();
		const error = new Error("synthetic terminal failure");
		act(() => listener.fail(error));
		expect(result.current).toMatchObject({
			available: false,
			status: "error",
			startBalance: null,
			error,
			sourceErrors: { reconciliation: error },
		});
		expect(buildCashForecast).not.toHaveBeenCalled();
		onSnapshot.mockImplementation(ordinarySubscribe);
	});

	it.each([
		"loading",
		"error",
	])("does not run the actual engine from %s cash or retained balances", (status) => {
		const failure = new Error("synthetic anchor failure");
		const ledger = {
			...ready,
			loading: status === "loading",
			error: failure,
			sourceErrors: { reconciliation: failure },
			cashSource: "unavailable",
			cashMeta: { status },
		};
		const { result, rerender } = renderHook(
			({ ledger }) => useCashForecast(null, { ledger, today, weeks: 2 }),
			{ initialProps: { ledger } },
		);
		expect(buildCashForecast).not.toHaveBeenCalled();
		expect(result.current).toMatchObject({
			available: false,
			status,
			loading: ledger.loading,
			error: failure,
			sourceErrors: ledger.sourceErrors,
			weeks: [],
			obligations: [],
			vatObligations: [],
		});
		for (const key of [
			"startBalance",
			"totalInflow",
			"totalOutflow",
			"netHorizon",
			"endBalance",
			"firstNegativeWeek",
			"weeksToNegative",
			"lowestWeek",
			"collectionSlipDays",
			"collectionSlip",
		])
			expect(result.current[key]).toBeNull();
		rerender({ ledger: ready });
		expect(buildCashForecast).toHaveBeenCalledOnce();
		expect(buildCashForecast).toHaveBeenCalledWith(
			expect.objectContaining({ startBalance: 321, today, weeks: 2 }),
		);
		expect(result.current).toMatchObject({
			available: true,
			status: "ready",
			startBalance: 321,
			endBalance: 321,
			error: null,
		});
		expect(result.current.weeks).toHaveLength(2);
	});

	it.each([
		null,
		undefined,
		NaN,
		Infinity,
	])("does not seed a forecast from unknown cash %s", (cash) => {
		const { result } = renderHook(() =>
			useCashForecast(null, {
				ledger: { ...ready, summary: { currentCash: cash } },
				today,
			}),
		);
		expect(buildCashForecast).not.toHaveBeenCalled();
		expect(result.current.startBalance).toBeNull();
	});

	it.each([
		0, -50,
	])("preserves healthy zero/negative cash %s and independent errors", (cash) => {
		const error = new Error("synthetic project failure");
		const sourceErrors = { reconciliation: null, projects: error };
		const { result } = renderHook(() =>
			useCashForecast(null, {
				ledger: {
					...ready,
					error,
					sourceErrors,
					summary: { currentCash: cash },
				},
				today,
				weeks: 2,
			}),
		);
		expect(result.current).toMatchObject({
			available: true,
			startBalance: cash,
			endBalance: cash,
			error,
			sourceErrors,
		});
		expect(buildCashForecast).toHaveBeenCalled();
	});
});
