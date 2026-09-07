import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { installFirebaseMocks } from "@/test/firebaseMock";
import { isoDaysFromNow, ledgerFixtures } from "@/test/fixtures";

const store = installFirebaseMocks(ledgerFixtures());
const { renderScreen } = await import("@/test/renderScreen.jsx");
const { default: AlertasOperativas } = await import("./AlertasOperativas.jsx");
const { onSnapshot } = await import("firebase/firestore");
const ordinarySubscribe = onSnapshot.getMockImplementation();
const USER = { uid: "test-uid" };

beforeEach(() => {
	onSnapshot.mockImplementation(ordinarySubscribe);
	const pristine = ledgerFixtures();
	Object.assign(store.collections, pristine.collections);
	Object.assign(store.documents, pristine.documents);
	store.errors = {};
});

describe("AlertasOperativas — projection validity", () => {
	it("never equates an unavailable projection with everything under control", () => {
		store.collections.payables = [];
		store.collections.receivables = [];
		store.errors.reconciliation = new Error("private backend detail");
		renderScreen(<AlertasOperativas user={USER} />);
		expect(screen.queryByText("Todo bajo control")).not.toBeInTheDocument();
		expect(screen.queryByText("✓ Todo al día")).not.toBeInTheDocument();
		expect(screen.getByText("Proyección no disponible")).toBeInTheDocument();
		expect(
			screen.getByText(/Sin alertas operativas detectadas/),
		).toBeInTheDocument();
		expect(
			screen.queryByText(/private backend detail/),
		).not.toBeInTheDocument();
	});

	it("keeps operational alerts through loading and retry without another shared subscription", () => {
		const listeners = [];
		onSnapshot.mockImplementation((ref, next, fail) => {
			if (ref.id !== "reconciliation")
				return ordinarySubscribe(ref, next, fail);
			const listener = { next, fail, unsubscribe: vi.fn() };
			listeners.push(listener);
			return listener.unsubscribe;
		});
		renderScreen(<AlertasOperativas user={USER} />);
		expect(screen.getByRole("status")).toHaveTextContent(
			"Cargando conciliación",
		);
		expect(screen.getByText("Material fibra")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Ir a CXC" })).toBeEnabled();
		expect(listeners).toHaveLength(1);
		act(() => listeners[0].fail(new Error("failed")));
		fireEvent.click(
			screen.getByRole("button", { name: "Reintentar conciliación" }),
		);
		expect(listeners[0].unsubscribe).toHaveBeenCalledOnce();
		act(() =>
			listeners[1].next({
				exists: () => true,
				data: () => ({
					anchors: [{ date: isoDaysFromNow(0), balance: -100000 }],
				}),
			}),
		);
		expect(screen.getByText("Saldo proyectado a negativo")).toBeInTheDocument();
		act(() => listeners[1].fail(new Error("later failure")));
		expect(
			screen.queryByText("Saldo proyectado a negativo"),
		).not.toBeInTheDocument();
		expect(screen.getByText("Material fibra")).toBeInTheDocument();
		fireEvent.click(
			screen.getByRole("button", { name: "Reintentar conciliación" }),
		);
		act(() => listeners[2].next({ exists: () => false }));
		expect(
			screen.queryByText("Proyección no disponible"),
		).not.toBeInTheDocument();
		expect(listeners).toHaveLength(3);
	});

	it("allows the healthy no-warning conclusion for verified zero and no obligations", () => {
		store.collections.payables = [];
		store.collections.receivables = [];
		store.collections.bankMovements = [];
		store.documents.reconciliation = {
			anchors: [{ date: isoDaysFromNow(0), balance: 0 }],
		};
		renderScreen(<AlertasOperativas user={USER} />);
		expect(screen.getByText("Todo bajo control")).toBeInTheDocument();
		expect(
			screen.queryByText("Proyección no disponible"),
		).not.toBeInTheDocument();
	});
});
