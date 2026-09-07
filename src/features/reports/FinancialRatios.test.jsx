import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { installFirebaseMocks } from "@/test/firebaseMock";
import { isoDaysFromNow, ledgerFixtures } from "@/test/fixtures";

const store = installFirebaseMocks(ledgerFixtures());
// Expose chart input in jsdom, where ResponsiveContainer has no layout.
vi.doMock("recharts", async () => ({
	...(await vi.importActual("recharts")),
	ResponsiveContainer: ({ children }) => children,
	BarChart: ({ data }) => (
		<div data-testid="comparison-chart">{JSON.stringify(data)}</div>
	),
	RadialBarChart: ({ data }) => (
		<div data-testid="ratio-gauge">{JSON.stringify(data)}</div>
	),
}));
const { renderScreen } = await import("@/test/renderScreen.jsx");
const { default: FinancialRatios } = await import("./FinancialRatios.jsx");
const { onSnapshot } = await import("firebase/firestore");
const ordinarySubscribe = onSnapshot.getMockImplementation();
const USER = { uid: "test-uid" };
const ratioCard = (title) =>
	screen.getByText(title).closest(".overflow-hidden");

beforeEach(() => {
	onSnapshot.mockImplementation(ordinarySubscribe);
	const pristine = ledgerFixtures();
	Object.assign(store.collections, pristine.collections);
	Object.assign(store.documents, pristine.documents);
	store.errors = {};
});

describe("FinancialRatios — unknown is not zero", () => {
	it.each([
		["loading", ["bankMovements", "receivables", "payables"]],
		["error", ["payables", "bankMovements", "receivables"]],
		["ready", ["receivables", "payables", "bankMovements"]],
	])("waits for independent snapshots with reconciliation %s", (status, order) => {
		const pending = {};
		onSnapshot.mockImplementation((ref, next, fail) => {
			const source = ref.path.split("/").at(-1);
			if (order.includes(source) || source === "reconciliation") {
				pending[source] = { ref, next, fail };
				return vi.fn();
			}
			return ordinarySubscribe(ref, next, fail);
		});
		renderScreen(<FinancialRatios user={USER} />);
		if (status === "error") {
			act(() => pending.reconciliation.fail(new Error("synthetic failure")));
		} else if (status === "ready") {
			const { ref, next, fail } = pending.reconciliation;
			act(() => ordinarySubscribe(ref, next, fail));
		}
		for (const source of order) {
			expect(screen.getByText("Cargando…")).toBeInTheDocument();
			expect(screen.queryByText("Días de cobro")).not.toBeInTheDocument();
			expect(screen.queryByTestId("comparison-chart")).not.toBeInTheDocument();
			const { ref, next, fail } = pending[source];
			act(() => ordinarySubscribe(ref, next, fail));
		}
		expect(ratioCard("Días de cobro")).not.toHaveTextContent("No disponible");
		fireEvent.click(screen.getByRole("button", { name: "Todos los años" }));
		expect(screen.getByTestId("comparison-chart")).toHaveTextContent("Margen caja");
	});
	it("does not rate unavailable cash, while independent ratios and chart rows remain", () => {
		store.errors.reconciliation = new Error("private backend detail");
		renderScreen(<FinancialRatios user={USER} />);
		expect(ratioCard("Prueba ácida")).not.toHaveTextContent("0.0x");
		for (const name of [
			"Ratio corriente",
			"Prueba ácida",
			"Capital operativo",
			"Margen proyectado",
		]) {
			expect(ratioCard(name)).toHaveTextContent("No disponible");
			expect(ratioCard(name)).not.toHaveTextContent(
				/Saludable|Crítico|Requiere atención/,
			);
			expect(
				ratioCard(name).querySelector('[data-testid="ratio-gauge"]'),
			).toBeNull();
		}
		expect(ratioCard("Cobertura 14d")).not.toHaveTextContent("No disponible");
		expect(ratioCard("Días de cobro")).not.toHaveTextContent("No disponible");
		expect(screen.getByTestId("comparison-chart")).not.toHaveTextContent(
			/Ratio corriente|Prueba ácida|Cobertura caja/,
		);
		expect(screen.getByTestId("comparison-chart")).toHaveTextContent(
			"Margen caja",
		);
		expect(
			screen.queryByRole("button", { name: /exportar/i }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByText(/private backend detail/),
		).not.toBeInTheDocument();
	});

	it("preserves filters on loading and retry, restores legitimate zero, then invalidates it", () => {
		const listeners = [];
		onSnapshot.mockImplementation((ref, next, fail) => {
			if (ref.id !== "reconciliation")
				return ordinarySubscribe(ref, next, fail);
			const listener = { next, fail, unsubscribe: vi.fn() };
			listeners.push(listener);
			return listener.unsubscribe;
		});
		renderScreen(<FinancialRatios user={USER} />);
		fireEvent.click(screen.getByRole("button", { name: "Todos los años" }));
		expect(screen.getByRole("status")).toHaveTextContent(
			"Cargando conciliación",
		);
		expect(listeners).toHaveLength(1);
		expect(ratioCard("Días de pago")).toBeInTheDocument();
		act(() => listeners[0].fail(new Error("failed")));
		fireEvent.click(
			screen.getByRole("button", { name: "Reintentar conciliación" }),
		);
		expect(listeners[0].unsubscribe).toHaveBeenCalledOnce();
		act(() =>
			listeners[1].next({
				exists: () => true,
				data: () => ({ anchors: [{ date: isoDaysFromNow(0), balance: 0 }] }),
			}),
		);
		expect(ratioCard("Prueba ácida")).toHaveTextContent("0.0x");
		expect(ratioCard("Prueba ácida")).toHaveTextContent("Crítico");
		expect(screen.getByTestId("comparison-chart")).toHaveTextContent(
			"Ratio corriente",
		);
		act(() => listeners[1].fail(new Error("later failure")));
		expect(ratioCard("Prueba ácida")).toHaveTextContent("No disponible");
		fireEvent.click(
			screen.getByRole("button", { name: "Reintentar conciliación" }),
		);
		act(() => listeners[2].next({ exists: () => false }));
		expect(ratioCard("Prueba ácida")).not.toHaveTextContent("No disponible");
		expect(listeners).toHaveLength(3);
	});
});
