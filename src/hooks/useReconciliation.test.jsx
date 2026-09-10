import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFirebaseMocks } from "../test/firebaseMock.js";

installFirebaseMocks();
const { onSnapshot, setDoc } = await import("firebase/firestore");
const { useReconciliation } = await import("./useReconciliation.js");
const user = { uid: "synthetic-a", email: "a@example.invalid" };
const anchor = { date: "2026-01-01", balance: 123, source: "synthetic" };
const snapshot = (anchors) => ({
	exists: () => anchors !== null,
	data: () => ({ anchors }),
});
let listeners;
beforeEach(() => {
	listeners = [];
	setDoc.mockReset().mockResolvedValue(undefined);
	onSnapshot.mockImplementation((ref, next, fail) => {
		const listener = { next, fail, unsubscribe: vi.fn() };
		listeners.push(listener);
		return listener.unsubscribe;
	});
});

describe("useReconciliation persistence", () => {
	it("validates the entire batch before writing and retains the single-anchor API", async () => {
		const { result } = renderHook(() => useReconciliation(user));
		act(() => listeners[0].next(snapshot([anchor])));
		const may = { date: "2026-05-31", balance: 100, source: "bank" };
		const invalid = { ...may, date: "invalid" };
		expect(await result.current.addAnchors([may, invalid])).toMatchObject({ success: false });
		expect(setDoc).not.toHaveBeenCalled();
		expect(await result.current.addAnchor(may)).toEqual({ success: true });
		expect(setDoc.mock.calls[0][1].anchors).toEqual([expect.objectContaining(may), anchor]);
	});
});

describe("useReconciliation lifecycle", () => {
	it.each([
		"permission-denied",
		"unavailable",
		"unknown",
	])("retains %s until an explicit retry really succeeds", (code) => {
		const error = Object.assign(new Error("synthetic read failure"), { code });
		const { result, rerender } = renderHook(
			({ user }) => useReconciliation(user),
			{ initialProps: { user } },
		);
		const retry = result.current.retry;
		act(() => listeners[0].fail(error));
		expect(result.current).toMatchObject({
			loading: false,
			error,
			anchors: [],
		});
		rerender({ user: { ...user } });
		expect(listeners).toHaveLength(1);
		expect(result.current.retry).toBe(retry);
		act(() => result.current.retry());
		expect(listeners).toHaveLength(2);
		expect(listeners[0].unsubscribe).toHaveBeenCalledOnce();
		expect(result.current).toMatchObject({ loading: true, error });
		act(() => listeners[0].next(snapshot([anchor])));
		expect(result.current.anchors).toEqual([]);
		act(() => listeners[1].next(snapshot([anchor])));
		expect(result.current).toMatchObject({
			loading: false,
			error: null,
			anchors: [anchor],
		});
	});

	it.each([
		[null],
		[[]],
	])("retains same-user data on error but accepts successful empty/missing retry: %j", (empty) => {
		const { result } = renderHook(() => useReconciliation(user));
		act(() => listeners[0].next(snapshot([anchor])));
		const failure = new Error("synthetic failure after ready");
		act(() => listeners[0].fail(failure));
		expect(result.current.anchors).toEqual([anchor]);
		act(() => listeners[0].next(snapshot([])));
		expect(result.current.error).toBe(failure);
		act(() => result.current.retry());
		act(() => listeners[1].fail(failure));
		expect(result.current.loading).toBe(false);
		expect(listeners).toHaveLength(2);
		act(() => result.current.retry());
		act(() => listeners[2].next(snapshot(empty)));
		expect(result.current).toMatchObject({
			anchors: [],
			error: null,
			loading: false,
		});
	});

	it("clears cross-user state on every render, logout and late callbacks, and unsubscribes on unmount", () => {
		const observed = [];
		const { result, rerender, unmount } = renderHook(
			({ user }) => {
				const source = useReconciliation(user);
				observed.push(source);
				return source;
			},
			{ initialProps: { user } },
		);
		act(() => listeners[0].next(snapshot([anchor])));
		act(() => listeners[0].fail(new Error("synthetic old error")));
		observed.length = 0;
		rerender({ user: { uid: "synthetic-b", email: "b@example.invalid" } });
		expect(
			observed.every(
				(source) => source.anchors.length === 0 && source.error === null,
			),
		).toBe(true);
		expect(result.current.loading).toBe(true);
		expect(listeners[0].unsubscribe).toHaveBeenCalledOnce();
		act(() => listeners[0].next(snapshot([anchor])));
		expect(result.current.anchors).toEqual([]);
		act(() => listeners[1].next(snapshot([anchor])));
		rerender({ user: null });
		expect(result.current).toMatchObject({
			anchors: [],
			loading: false,
			error: null,
		});
		act(() => {
			listeners[1].next(snapshot([anchor]));
			listeners[1].fail(new Error("late"));
			result.current.retry();
		});
		expect(result.current).toMatchObject({
			anchors: [],
			loading: false,
			error: null,
		});
		expect(listeners).toHaveLength(2);
		rerender({ user });
		unmount();
		expect(listeners[2].unsubscribe).toHaveBeenCalledOnce();
		act(() => listeners[2].next(snapshot([anchor])));
	});

	it("does not subscribe or stay busy without a user", () => {
		const { result } = renderHook(() => useReconciliation(null));
		expect(result.current.loading).toBe(false);
		expect(listeners).toHaveLength(0);
	});
});
