import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { installFirebaseMocks } from "../test/firebaseMock.js";

installFirebaseMocks({ documents: { bankAccount: { balance: 800 } } });
const { onSnapshot } = await import("firebase/firestore");
const ordinarySubscribe = onSnapshot.getMockImplementation();
const { FinanceLedgerProvider, useFinanceLedgerContext } = await import(
	"./FinanceLedgerContext.jsx"
);

it("keeps unrelated children mounted and retries one shared reconciliation listener for all consumers", () => {
	const listeners = [];
	onSnapshot.mockImplementation((ref, next, fail) => {
		if (ref.id !== "reconciliation") return ordinarySubscribe(ref, next, fail);
		const listener = { next, fail, unsubscribe: vi.fn() };
		listeners.push(listener);
		return listener.unsubscribe;
	});
	const actions = [];
	const Consumer = ({ name }) => {
		const ledger = useFinanceLedgerContext();
		actions.push(ledger.actions);
		return (
			<button onClick={ledger.actions.reconciliation.retry}>
				{name}: {ledger.cashMeta.status}
			</button>
		);
	};
	render(
		<FinanceLedgerProvider
			user={{ uid: "synthetic", email: "test@example.invalid" }}
		>
			<input aria-label="Unrelated work" defaultValue="preserved" />
			<Consumer name="First" />
			<Consumer name="Second" />
		</FinanceLedgerProvider>,
	);
	expect(
		screen.getByRole("button", { name: "First: loading" }),
	).toBeInTheDocument();
	const input = screen.getByRole("textbox");
	fireEvent.change(input, { target: { value: "draft" } });
	expect(listeners).toHaveLength(1);
	act(() => listeners[0].fail(new Error("synthetic failure")));
	expect(
		screen.getByRole("button", { name: "Second: error" }),
	).toBeInTheDocument();
	fireEvent.click(screen.getByRole("button", { name: "First: error" }));
	expect(listeners).toHaveLength(2);
	expect(listeners[0].unsubscribe).toHaveBeenCalledOnce();
	act(() => listeners[1].next({ exists: () => false }));
	expect(
		screen.getByRole("button", { name: "First: ready" }),
	).toBeInTheDocument();
	expect(
		screen.getByRole("button", { name: "Second: ready" }),
	).toBeInTheDocument();
	expect(screen.getByRole("textbox")).toBe(input);
	expect(input).toHaveValue("draft");
	expect(actions.every((value) => value === actions[0])).toBe(true);
});
