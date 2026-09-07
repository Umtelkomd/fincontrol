/**
 * CashFlow (/cashflow) — the VAT obligation panel.
 *
 * Treasury decisions are taken on this screen, and until now the Umsatzsteuer
 * was invisible here: it only existed as a manual figure in
 * `settings/treasury.vatEstimates`, which is empty in production. These tests
 * mount the real screen over faked Firestore and assert that the derived VAT
 * reaches the user WITH its coverage caveat — a number presented as exact when
 * it is only an estimate is worse than no number.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { installFirebaseMocks } from "@/test/firebaseMock";
import {
	bankMovementFixture,
	isoThisMonth,
	ledgerFixtures,
	receivableFixture,
} from "@/test/fixtures";
import { vatDueDate } from "@/lib/finance/fiscalCalendar";
import { formatDate } from "@/utils/formatters";

// The clock is pinned BEFORE any fixture is built. `computeVatByMonth` skips
// dates after today on purpose, and the fixtures below sit on the 5th–7th of
// "this month" — so on days 1–6 of every month they were in the future and the
// two assertions on the derived figure failed. Only `Date` is faked: timers and
// React scheduling keep running for real.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-09-15T12:00:00Z"));
afterAll(() => {
	vi.useRealTimers();
});

const store = installFirebaseMocks(ledgerFixtures());
vi.doMock("recharts", async () => ({
	...(await vi.importActual("recharts")),
	ResponsiveContainer: ({ children }) => children,
	BarChart: ({ data }) => (
		<div data-testid="movement-or-forecast-chart">{JSON.stringify(data)}</div>
	),
	LineChart: ({ data }) => (
		<div data-testid="cash-chart">{JSON.stringify(data)}</div>
	),
}));

const { renderScreen } = await import("@/test/renderScreen.jsx");
const { default: CashFlow } = await import("./CashFlow.jsx");
const { onSnapshot } = await import("firebase/firestore");
const ordinarySubscribe = onSnapshot.getMockImplementation();

const USER = { uid: "test-uid", email: "jromero@umtelkomd.com" };

const THIS_MONTH = isoThisMonth(5).slice(0, 7);

/** Ledger where every VAT-relevant record sits inside the current month. */
const vatLedger = () => {
	const pristine = ledgerFixtures();
	Object.assign(store.collections, pristine.collections, {
		// 11.900 € invoiced at 19% → 1.900 € repercutido.
		receivables: [
			receivableFixture({
				issueDate: isoThisMonth(5),
				amount: 11900,
				openAmount: 0,
				status: "settled",
				taxRate: 0.19,
			}),
		],
		bankMovements: [
			// 5.950 € of materials at 19% → 950 € soportado.
			bankMovementFixture({
				direction: "out",
				amount: 5950,
				categoryName: "Materiales",
				postedDate: isoThisMonth(6),
			}),
			// 4.050 € nobody classified → no rate, and it drags coverage down.
			bankMovementFixture({
				direction: "out",
				amount: 4050,
				categoryName: "",
				postedDate: isoThisMonth(7),
			}),
		],
	});
	Object.assign(store.documents, pristine.documents, {
		vatRates: { rates: { Materiales: 0.19 } },
	});
	store.errors = {};
	store.auth.permissions = null;
	store.auth.userRole = "admin";
};

const vatPanel = () => screen.getByText("IVA por liquidar").closest("section");

beforeEach(() => {
	onSnapshot.mockImplementation(ordinarySubscribe);
	vatLedger();
});

describe("CashFlow — unavailable cash", () => {
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
		renderScreen(<CashFlow user={USER} />);
		if (status === "error") {
			act(() => pending.reconciliation.fail(new Error("synthetic failure")));
		} else if (status === "ready") {
			const { ref, next, fail } = pending.reconciliation;
			act(() => ordinarySubscribe(ref, next, fail));
		}
		for (const source of order) {
			expect(screen.getByText("Cargando…")).toBeInTheDocument();
			expect(screen.queryByText("Estado de Resultados")).not.toBeInTheDocument();
			expect(screen.queryByTestId("movement-or-forecast-chart")).not.toBeInTheDocument();
			const { ref, next, fail } = pending[source];
			act(() => ordinarySubscribe(ref, next, fail));
		}
		expect(screen.getByText("Estado de Resultados")).toBeInTheDocument();
		expect(screen.getAllByText("Movimiento de prueba").length).toBeGreaterThan(0);
	});
	it("does not mistake skipped VAT/forecast for no obligations, and keeps posted movements", () => {
		store.errors.reconciliation = new Error("private backend detail");
		renderScreen(<CashFlow user={USER} />);
		expect(
			within(vatPanel()).queryByText(/Sin IVA estimado/),
		).not.toBeInTheDocument();
		expect(within(vatPanel()).getByText(/no disponible/i)).toBeInTheDocument();
		expect(screen.getByText("Proyección no disponible")).toBeInTheDocument();
		expect(screen.getByText("Estado de Resultados")).toBeInTheDocument();
		expect(screen.getAllByText("Movimiento de prueba").length).toBeGreaterThan(
			0,
		);
		expect(screen.queryByText("Caja registrada")).not.toBeInTheDocument();
		expect(screen.queryByTestId("cash-chart")).not.toBeInTheDocument();
		expect(screen.getAllByTestId("movement-or-forecast-chart")).toHaveLength(1);
		expect(
			screen.queryByText(/Lo ya vencido se espera de inmediato/),
		).not.toBeInTheDocument();
		expect(
			screen.queryByText(/private backend detail/),
		).not.toBeInTheDocument();
	});

	it("preserves movements during retry and restores VAT only after a new listener succeeds", () => {
		const listeners = [];
		onSnapshot.mockImplementation((ref, next, fail) => {
			if (ref.id !== "reconciliation")
				return ordinarySubscribe(ref, next, fail);
			const listener = { next, fail, unsubscribe: vi.fn() };
			listeners.push(listener);
			return listener.unsubscribe;
		});
		renderScreen(<CashFlow user={USER} />);
		const movements = screen
			.getByText("Movimientos recientes")
			.closest("section");
		expect(screen.getByRole("status")).toHaveTextContent(
			"Cargando conciliación",
		);
		expect(listeners).toHaveLength(1);
		act(() => listeners[0].fail(new Error("failed")));
		fireEvent.click(
			screen.getByRole("button", { name: "Reintentar conciliación" }),
		);
		expect(listeners[0].unsubscribe).toHaveBeenCalledOnce();
		expect(listeners).toHaveLength(2);
		expect(screen.getByText("Movimientos recientes").closest("section")).toBe(
			movements,
		);
		act(() => listeners[1].next({ exists: () => false }));
		expect(within(vatPanel()).getByText("950,00")).toBeInTheDocument();
		expect(screen.getByTestId("cash-chart")).toBeInTheDocument();
		expect(screen.getAllByTestId("movement-or-forecast-chart")).toHaveLength(2);
		expect(
			screen.queryByText("Proyección no disponible"),
		).not.toBeInTheDocument();
		act(() => listeners[1].fail(new Error("later failure")));
		expect(within(vatPanel()).queryByText("950,00")).not.toBeInTheDocument();
	});
});

describe("CashFlow — IVA por liquidar", () => {
	it("lists the derived obligation with its month, amount and filing date", () => {
		renderScreen(<CashFlow user={USER} />);

		const panel = vatPanel();
		// 1.900 repercutido − 950 soportado.
		expect(within(panel).getByText("950,00")).toBeInTheDocument();
		expect(
			within(panel).getByText(formatDate(vatDueDate(THIS_MONTH))),
		).toBeInTheDocument();
	});

	it("says out loud which share of the amounts the estimate stands on", () => {
		renderScreen(<CashFlow user={USER} />);

		// 17.850 € of 21.900 € carry a known rate → 82%.
		expect(
			within(vatPanel()).getByText(
				/Estimado sobre el 82% de los importes clasificados/,
			),
		).toBeInTheDocument();
	});

	it("shows the manually entered amount instead, with no estimate caveat", () => {
		store.documents.treasury = {
			vatEstimates: [{ month: THIS_MONTH, amount: 3000 }],
			alertBufferEur: 10000,
		};

		renderScreen(<CashFlow user={USER} />);

		const panel = vatPanel();
		expect(within(panel).getByText("3.000,00")).toBeInTheDocument();
		expect(within(panel).getByText("Manual")).toBeInTheDocument();
		expect(
			within(panel).queryByText(/Estimado sobre el/),
		).not.toBeInTheDocument();
	});

	it("explains the absence instead of showing an empty table", () => {
		store.collections.receivables = [];
		store.collections.bankMovements = [];

		renderScreen(<CashFlow user={USER} />);

		expect(
			within(vatPanel()).getByText(/Sin IVA estimado/),
		).toBeInTheDocument();
	});
});
