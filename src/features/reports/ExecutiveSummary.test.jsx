/**
 * ExecutiveSummary — the report that disagreed with Resumen.
 *
 * It filtered open invoices by the selected year, so its "liquidity" dropped
 * every receivable issued in 2025 or with a blank issueDate, and it printed the
 * raw runway ("-0.3 meses"). Both numbers now come from the shared
 * LiquidityKpis fed by the one formula in useTreasuryMetrics.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { installFirebaseMocks } from "@/test/firebaseMock";
import {
	isoDaysFromNow,
	ledgerFixtures,
	receivableFixture,
} from "@/test/fixtures";

const store = installFirebaseMocks(ledgerFixtures());

const { renderScreen } = await import("@/test/renderScreen.jsx");
const { default: ExecutiveSummary } = await import("./ExecutiveSummary.jsx");
const { onSnapshot } = await import("firebase/firestore");
const ordinarySubscribe = onSnapshot.getMockImplementation();
vi.doMock("@/utils/pdfExport", () => ({ exportReportToPDF: vi.fn() }));
const { default: Reports } = await import("./Reports.jsx");
const { exportReportToPDF } = await import("@/utils/pdfExport");

const USER = { uid: "test-uid", email: "jromero@umtelkomd.com" };

beforeEach(() => {
	onSnapshot.mockImplementation(ordinarySubscribe);
	store.errors = {};
	exportReportToPDF.mockClear();
	const pristine = ledgerFixtures();
	Object.assign(store.collections, pristine.collections);
	Object.assign(store.documents, pristine.documents);
});

describe("ExecutiveSummary — shared liquidity trio", () => {
	it("does not print fabricated cash in its executive narrative, preserving independent priorities", () => {
		store.errors.reconciliation = new Error("private backend detail");
		renderScreen(<ExecutiveSummary user={USER} />);
		const narrative = screen.getByText("Posición de caja").parentElement;
		expect(narrative).not.toHaveTextContent("0,00");
		expect(narrative).toHaveTextContent("No disponible");
		expect(
			screen.getByText("CXC vencida").parentElement.parentElement,
		).toHaveTextContent("10.000,00");
		expect(screen.getByText("Riesgo de cobranza")).toBeInTheDocument();
		expect(screen.getByText(/Recuperar la conciliación/)).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /exportar/i }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByText(/private backend detail/),
		).not.toBeInTheDocument();
	});

	it("keeps fiscal controls and a single shared retry through loading, zero and empty recovery", () => {
		const listeners = [];
		onSnapshot.mockImplementation((ref, next, fail) => {
			if (ref.id !== "reconciliation")
				return ordinarySubscribe(ref, next, fail);
			const listener = { next, fail, unsubscribe: vi.fn() };
			listeners.push(listener);
			return listener.unsubscribe;
		});
		renderScreen(<ExecutiveSummary user={USER} />);
		fireEvent.click(screen.getByRole("button", { name: "Todos los años" }));
		expect(listeners).toHaveLength(1);
		expect(screen.getByRole("status")).toHaveTextContent(
			"Cargando conciliación",
		);
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
		expect(
			screen.getByText("Posición de caja").parentElement,
		).toHaveTextContent("Caja 0,00");
		act(() => listeners[1].fail(new Error("later failure")));
		expect(
			screen.getByText("Posición de caja").parentElement,
		).not.toHaveTextContent("0,00");
		fireEvent.click(
			screen.getByRole("button", { name: "Reintentar conciliación" }),
		);
		act(() => listeners[2].next({ exists: () => false }));
		expect(
			screen.getByText("Posición de caja").parentElement,
		).not.toHaveTextContent("No disponible");
		expect(listeners).toHaveLength(3);
	});

	it("leaves the separate posted-results PDF export usable when reconciliation fails", () => {
		store.errors.reconciliation = new Error("failed");
		store.collections.bankMovements = store.collections.bankMovements.map(
			(movement) => ({ ...movement, postedDate: isoDaysFromNow(0) }),
		);
		renderScreen(<Reports user={USER} />);
		fireEvent.change(screen.getByRole("combobox"), {
			target: { value: "all" },
		});
		const button = screen.getByRole("button", { name: "Exportar PDF" });
		expect(button).toBeEnabled();
		fireEvent.click(button);
		expect(exportReportToPDF).toHaveBeenCalledOnce();
		expect(exportReportToPDF.mock.calls[0][1]).toBe("general");
		expect(exportReportToPDF.mock.calls[0][0].length).toBeGreaterThan(0);
	});
	it("prints Caja / Posición neta / Runway with the same figures as Resumen", () => {
		renderScreen(<ExecutiveSummary user={USER} />);

		expect(screen.getByText("Caja")).toBeInTheDocument();
		expect(screen.getByText("52.000,00")).toBeInTheDocument();
		expect(screen.getByText("Posición neta")).toBeInTheDocument();
		// 52.000 + 10.000 open receivable − 4.000 open payable.
		expect(screen.getByText("58.000,00")).toBeInTheDocument();
		expect(screen.getByText("Runway")).toBeInTheDocument();
		expect(screen.getByText("CXC vencida")).toBeInTheDocument();
		expect(screen.queryByText("Liquidez proyectada")).not.toBeInTheDocument();
		expect(screen.queryByText("Cobertura de caja")).not.toBeInTheDocument();
	});

	it("keeps an open invoice issued last year in the position whatever the year filter says", () => {
		store.collections.receivables = [
			receivableFixture({
				id: "cxc-2025",
				openAmount: 120,
				amount: 120,
				issueDate: "2025-11-03",
				dueDate: isoDaysFromNow(20),
			}),
		];

		renderScreen(<ExecutiveSummary user={USER} />);

		// 52.000 + 120 − 4.000 with the current year selected by default…
		expect(screen.getByText("48.120,00")).toBeInTheDocument();

		// …and still 48.120 after switching the year filter.
		fireEvent.click(screen.getByRole("button", { name: "Todos los años" }));
		expect(screen.getByText("48.120,00")).toBeInTheDocument();
	});

	it("never prints a negative runway when the cash is below zero", () => {
		store.documents.reconciliation = {
			anchors: [
				{
					date: isoDaysFromNow(-10),
					balance: -40000,
					source: "DATEV SuSa 1200",
				},
			],
		};

		renderScreen(<ExecutiveSummary user={USER} />);

		const runway = screen.getByText("Runway").closest("div").parentElement;
		expect(within(runway).getByText("Bajo cero")).toBeInTheDocument();
		expect(screen.queryByText(/-\d+[.,]\d+ meses/)).not.toBeInTheDocument();
	});
});
