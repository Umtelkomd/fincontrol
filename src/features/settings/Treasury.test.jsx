import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { installFirebaseMocks } from "../../test/firebaseMock";

installFirebaseMocks({ documents: { bankAccount: { balance: 800 } } });
const { onSnapshot, setDoc } = await import("firebase/firestore");
const ordinarySubscribe = onSnapshot.getMockImplementation();
const { renderScreen } = await import("../../test/renderScreen.jsx");
const { default: Treasury } = await import("./Treasury.jsx");
const USER = { uid: "synthetic", email: "test@example.invalid" };
let listeners;
const success = (listener, anchors = []) =>
	act(() => listener.next({ exists: () => true, data: () => ({ anchors }) }));
const balancePanel = () => screen.getByText("Saldo derivado hoy").parentElement;

beforeEach(() => {
	listeners = [];
	setDoc.mockClear();
	onSnapshot.mockImplementation((ref, next, fail) => {
		if (ref.id !== "reconciliation") return ordinarySubscribe(ref, next, fail);
		const listener = { next, fail, unsubscribe: vi.fn() };
		listeners.push(listener);
		return listener.unsubscribe;
	});
});

it("keeps other settings editable while shared and local reconciliation load, fail and recover", () => {
	renderScreen(<Treasury user={USER} />, { user: USER });
	expect(screen.getByText("IVA estimado por mes")).toBeInTheDocument();
	expect(
		screen.getByRole("button", { name: "Guardar estimado" }),
	).toBeEnabled();
	expect(
		screen.getByRole("button", { name: "Registrar ancla" }),
	).toBeDisabled();
	expect(within(balancePanel()).queryByText("0,00")).not.toBeInTheDocument();
	expect(listeners).toHaveLength(2);
	act(() =>
		listeners.forEach((listener) =>
			listener.fail(new Error("private backend details")),
		),
	);
	expect(screen.queryByText(/private backend/)).not.toBeInTheDocument();
	expect(screen.queryByText(/Sin anclas:/)).not.toBeInTheDocument();
	fireEvent.click(
		screen.getByRole("button", { name: "Reintentar conciliación" }),
	);
	fireEvent.click(
		screen.getByRole("button", { name: "Reintentar lectura de anclas" }),
	);
	expect(listeners).toHaveLength(4);
	success(listeners[2], [
		{ date: "2026-01-01", balance: 4321, source: "Synthetic" },
	]);
	success(listeners[3]);
	expect(within(balancePanel()).getByText("4.321,00")).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Registrar ancla" })).toBeEnabled();
});

it("disables add and remove after only the local editing listener fails, without erasing drafts", () => {
	renderScreen(<Treasury user={USER} />, { user: USER });
	const anchor = { date: "2026-01-01", balance: 4321, source: "Synthetic" };
	// Child effects subscribe first: local editing listener, then shared provider.
	success(listeners[0], [anchor]);
	success(listeners[1], [anchor]);
	const input = screen.getByLabelText("Fuente");
	fireEvent.change(input, { target: { value: "Draft" } });
	act(() => listeners[0].fail(new Error("read failed")));
	expect(
		screen.getByRole("button", { name: "Registrar ancla" }),
	).toBeDisabled();
	const remove = screen.getByRole("button", { name: /Eliminar ancla/ });
	expect(remove).toBeDisabled();
	fireEvent.click(remove);
	fireEvent.submit(input.closest("form"));
	expect(setDoc).not.toHaveBeenCalled();
	expect(input).toHaveValue("Draft");
	expect(
		screen.getByRole("button", { name: "Guardar estimado" }),
	).toBeEnabled();
	fireEvent.click(
		screen.getByRole("button", { name: "Reintentar lectura de anclas" }),
	);
	success(listeners[2], [anchor]);
	expect(input).toHaveValue("Draft");
	expect(screen.getByRole("button", { name: /Eliminar ancla/ })).toBeEnabled();
});
