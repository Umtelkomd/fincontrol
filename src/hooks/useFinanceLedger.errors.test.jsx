import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFirebaseMocks } from "../test/firebaseMock.js";

const store = installFirebaseMocks({
	documents: { bankAccount: { balance: 800, balanceDate: "2026-01-01" } },
});
const { onSnapshot } = await import("firebase/firestore");
const ordinarySubscribe = onSnapshot.getMockImplementation();
const { useFinanceLedger } = await import("./useFinanceLedger.js");
const user = { uid: "synthetic-user", email: "user@example.invalid" };
let listeners;
const snapshot = (anchors) => ({
	exists: () => anchors !== null,
	data: () => ({ anchors }),
});

beforeEach(() => {
	listeners = [];
	store.errors = {};
	onSnapshot.mockImplementation((ref, next, fail) => {
		if (ref.id !== "reconciliation") return ordinarySubscribe(ref, next, fail);
		const listener = { next, fail, unsubscribe: vi.fn() };
		listeners.push(listener);
		return listener.unsubscribe;
	});
});

describe("useFinanceLedger reconciliation source errors", () => {
	it.each([
		"transactions", "bankAccount", "bankMovements", "receivables",
		"payables", "budgets", "projects",
	])("tracks %s loading independently of reconciliation", (source) => {
		let pending;
		const subscribe = onSnapshot.getMockImplementation();
		onSnapshot.mockImplementation((ref, next, fail) => {
			if (ref.path.split("/").at(-1) !== source) return subscribe(ref, next, fail);
			pending = { ref, next, fail };
			return vi.fn();
		});
		const { result } = renderHook(() => useFinanceLedger(user));
		expect(result.current.independentLoading).toBe(true);
		act(() => listeners[0].fail(new Error("synthetic failure")));
		expect(result.current.independentLoading).toBe(true);
		act(() => result.current.actions.reconciliation.retry());
		expect(result.current.independentLoading).toBe(true);
		act(() => ordinarySubscribe(pending.ref, pending.next, pending.fail));
		expect(result.current.independentLoading).toBe(false);
		expect(result.current.loading).toBe(true);
		act(() => listeners[1].next(snapshot([])));
		expect(result.current.independentLoading).toBe(false);
		expect(result.current.loading).toBe(false);
	});

	it.each([
		[null, "legacy", 800],
		[[], "legacy", 800],
		[[{ date: "2026-01-01", balance: 456 }], "anchors", 456],
	])("recovers through shared stable actions from a fresh snapshot: %j", (anchors, source, cash) => {
		const projectError = new Error("synthetic project failure");
		store.errors.projects = projectError;
		const { result, rerender } = renderHook(
			({ user }) => useFinanceLedger(user),
			{ initialProps: { user } },
		);
		const actions = result.current.actions;
		expect(result.current.cashMeta.status).toBe("loading");
		expect(result.current.summary.currentCash).toBeNull();
		act(() =>
			listeners[0].next(snapshot([{ date: "2026-01-01", balance: 123 }])),
		);
		const failure = new Error("synthetic read failure");
		act(() => listeners[0].fail(failure));
		act(() => actions.reconciliation.retry());
		expect(listeners).toHaveLength(2);
		expect(result.current.loading).toBe(true);
		expect(result.current.cashMeta.status).toBe("loading");
		expect(result.current.sourceErrors.reconciliation).toBe(failure);
		act(() => listeners[1].next(snapshot(anchors)));
		expect(result.current.summary.currentCash).toBe(cash);
		expect(result.current.cashSource).toBe(source);
		expect(result.current.cashMeta.status).toBe("ready");
		expect(result.current.sourceErrors.reconciliation).toBeNull();
		expect(result.current.sourceErrors.projects).toBe(projectError);
		expect(result.current.error).toBe(projectError);
		rerender({ user: { ...user } });
		expect(result.current.actions).toBe(actions);
		expect(result.current.actions.reconciliation.retry).toBe(
			actions.reconciliation.retry,
		);
		expect(listeners).toHaveLength(2);
	});

	it("invalidates previously ready anchors without losing independent source errors", () => {
		const bankError = new Error("synthetic bank failure");
		const receivableError = new Error("synthetic receivable failure");
		const projectError = new Error("synthetic project failure");
		store.errors = {
			bankMovements: bankError,
			receivables: receivableError,
			projects: projectError,
		};
		const { result } = renderHook(() => useFinanceLedger(user));
		act(() =>
			listeners[0].next(snapshot([{ date: "2026-01-01", balance: 123 }])),
		);
		expect(result.current.summary.currentCash).toBe(123);
		const failure = new Error("synthetic anchor failure");
		act(() => listeners[0].fail(failure));
		expect(result.current.sourceErrors).toMatchObject({
			reconciliation: failure,
			bankMovements: bankError,
			receivables: receivableError,
			projects: projectError,
		});
		expect(result.current.error).toBe(bankError);
		expect(result.current.summary.currentCash).toBeNull();
		expect(result.current.cashMeta.status).toBe("error");
	});

	it("exposes the original reconciliation failure rather than a healthy legacy balance", () => {
		const failure = new Error("synthetic permission denied");
		const { result } = renderHook(() => useFinanceLedger(user));
		act(() => listeners[0].fail(failure));
		expect(result.current.sourceErrors.reconciliation).toBe(failure);
		expect(result.current.error).toBe(failure);
		expect(result.current.loading).toBe(false);
		expect(result.current.cashSource).toBe("unavailable");
		expect(result.current.summary.currentCash).toBeNull();
		expect(result.current.summary.creditUsed).toBeNull();
		expect(result.current.summary.availableCredit).toBeNull();
	});
});
