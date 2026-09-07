import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { installFirebaseMocks } from "@/test/firebaseMock";
import { isoDaysFromNow, ledgerFixtures } from "@/test/fixtures";

const store = installFirebaseMocks(ledgerFixtures());
vi.doMock("recharts", async () => ({
	...(await vi.importActual("recharts")),
	ResponsiveContainer: ({ children }) => children,
	AreaChart: ({ data }) => (
		<div data-testid="projection-chart">{JSON.stringify(data)}</div>
	),
}));
const { renderScreen } = await import("@/test/renderScreen.jsx");
const { default: ProyeccionCashflow } = await import(
	"./ProyeccionCashflow.jsx"
);
const { onSnapshot } = await import("firebase/firestore");
const ordinarySubscribe = onSnapshot.getMockImplementation();
const USER = { uid: "test-uid" };
const cashTile = () => screen.getByText("Caja actual").parentElement;

beforeEach(() => {
	onSnapshot.mockImplementation(ordinarySubscribe);
	const pristine = ledgerFixtures();
	Object.assign(store.collections, pristine.collections);
	Object.assign(store.documents, pristine.documents);
	store.errors = {};
});

describe("Proyección — primera semana en negativo", () => {
	it("shows absence rather than currency zero when no week crosses below zero", () => {
		renderScreen(<ProyeccionCashflow user={USER} />);
		const card = within(
			screen.getByText("Primera semana en negativo").parentElement,
		);
		expect(
			card.getByText("La caja no cruza a negativo en el horizonte"),
		).toBeInTheDocument();
		expect(card.getByText("—")).toBeInTheDocument();
		expect(card.queryByText("0,00")).not.toBeInTheDocument();
	});

	it.each([
		{ balance: -1000, formatted: "-1.000,00" },
		{ balance: 0, formatted: "0,00" },
	])("preserves real currency balances of $balance", ({
		balance,
		formatted,
	}) => {
		store.collections.bankMovements = [];
		store.collections.receivables = [];
		store.collections.payables = [];
		store.documents.reconciliation = {
			anchors: [{ date: isoDaysFromNow(0), balance }],
		};
		renderScreen(<ProyeccionCashflow user={USER} />);
		const card = within(
			screen.getByText("Primera semana en negativo").parentElement,
		);
		if (balance < 0) {
			expect(card.getByText(formatted)).toBeInTheDocument();
			expect(card.queryByText("—")).not.toBeInTheDocument();
			expect(card.getByText(/· en \d+ sem\./)).toBeInTheDocument();
			expect(
				card.queryByText("La caja no cruza a negativo en el horizonte"),
			).not.toBeInTheDocument();
		} else {
			expect(card.getByText("—")).toBeInTheDocument();
			expect(card.queryByText(formatted)).not.toBeInTheDocument();
			expect(
				card.getByText("La caja no cruza a negativo en el horizonte"),
			).toBeInTheDocument();
		}
		for (const title of [
			"Caja actual",
			"Semana más baja",
			/^Saldo a \d+ semanas$/,
		]) {
			expect(
				within(screen.getByText(title).parentElement).getByText(formatted),
			).toBeInTheDocument();
		}
	});
});

describe("Proyección — conciliación no disponible", () => {
	it("does not declare a safe horizon or fabricate zero cash after source failure", () => {
		store.errors.reconciliation = new Error("private backend detail");
		renderScreen(<ProyeccionCashflow user={USER} />);
		expect(
			screen.queryByText("La caja no cruza a negativo en el horizonte"),
		).not.toBeInTheDocument();
		expect(within(cashTile()).queryByText("0,00")).not.toBeInTheDocument();
		expect(
			screen.queryByText("Saldo proyectado por semana"),
		).not.toBeInTheDocument();
		expect(screen.queryByTestId("projection-chart")).not.toBeInTheDocument();
		expect(screen.queryByText(/los cobros entran/)).not.toBeInTheDocument();
		expect(screen.queryByText("Semana más baja")).not.toBeInTheDocument();
		expect(screen.getByText("Ventana 14d")).toBeInTheDocument();
		expect(screen.getByText("Proyección no disponible")).toBeInTheDocument();
		expect(screen.queryByText(/private backend detail/)).not.toBeInTheDocument();
	});

	it("keeps independent content through loading, retry, fresh zero, later failure and empty recovery", () => {
		const listeners = [];
		onSnapshot.mockImplementation((ref, next, fail) => {
			if (ref.id !== "reconciliation") return ordinarySubscribe(ref, next, fail);
			const listener = { next, fail, unsubscribe: vi.fn() };
			listeners.push(listener);
			return listener.unsubscribe;
		});
		renderScreen(<ProyeccionCashflow user={USER} />);
		const independent = screen.getByText("Ventana 14d").parentElement;
		expect(screen.getByRole("status")).toHaveTextContent("Cargando conciliación");
		expect(listeners).toHaveLength(1);
		act(() => listeners[0].fail(new Error("read failed")));
		fireEvent.click(
			screen.getByRole("button", { name: "Reintentar conciliación" }),
		);
		expect(listeners).toHaveLength(2);
		expect(listeners[0].unsubscribe).toHaveBeenCalledOnce();
		expect(screen.getByRole("status")).toHaveTextContent("Cargando conciliación");
		act(() =>
			listeners[1].next({
				exists: () => true,
				data: () => ({ anchors: [{ date: isoDaysFromNow(0), balance: 0 }] }),
			}),
		);
		expect(within(cashTile()).getByText("0,00")).toBeInTheDocument();
		expect(screen.getByTestId("projection-chart")).toHaveTextContent('"base":0');
		expect(screen.getByText("Saldo proyectado por semana")).toBeInTheDocument();
		expect(screen.getByText("Ventana 14d").parentElement).toBe(independent);
		act(() =>
			listeners[1].next({
				exists: () => true,
				data: () => ({
					anchors: [{ date: isoDaysFromNow(0), balance: 12345 }],
				}),
			}),
		);
		expect(within(cashTile()).getByText("12.345,00")).toBeInTheDocument();
		act(() => listeners[1].fail(new Error("later failure")));
		expect(
			screen.queryByText("Saldo proyectado por semana"),
		).not.toBeInTheDocument();
		fireEvent.click(
			screen.getByRole("button", { name: "Reintentar conciliación" }),
		);
		act(() => listeners[2].next({ exists: () => false }));
		expect(screen.getByText("Saldo proyectado por semana")).toBeInTheDocument();
		expect(listeners).toHaveLength(3);
	});
});
