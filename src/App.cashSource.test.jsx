import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { installFirebaseMocks } from "./test/firebaseMock";

installFirebaseMocks({
	user: {
		uid: "synthetic",
		displayName: "Synthetic User",
		email: "test@example.invalid",
	},
	documents: { bankAccount: { balance: 800 } },
});
vi.doMock("./features/perfil/UserProfile", () => ({
	default: () => <input aria-label="Profile draft" defaultValue="draft" />,
}));
vi.doMock("./features/configuracion/ConfiguracionUnified", () => ({
	default: () => <p>Independent settings</p>,
}));
const { onSnapshot } = await import("firebase/firestore");
const ordinarySubscribe = onSnapshot.getMockImplementation();
const { default: App } = await import("./App");

it("keeps the real shell and profile functional without a false header zero across recovery", async () => {
	const listeners = [];
	onSnapshot.mockImplementation((ref, next, fail) => {
		if (ref.id !== "reconciliation") return ordinarySubscribe(ref, next, fail);
		listeners.push({ next, fail });
		return vi.fn();
	});
	render(
		<MemoryRouter initialEntries={["/perfil"]}>
			<App />
		</MemoryRouter>,
	);
	const draft = await screen.findByRole("textbox", { name: "Profile draft" });
	expect(screen.getByRole("status")).toHaveTextContent("Cargando conciliación");
	const header = screen.getByRole("banner");
	expect(within(header).queryByText("0,00")).not.toBeInTheDocument();
	expect(within(header).getByRole("button", { name: "Crear" })).toBeEnabled();
	expect(
		within(header).getByRole("button", { name: /Synthetic User/ }),
	).toBeEnabled();
	expect(
		screen.getByRole("navigation", { name: "Páginas de la sección" }),
	).toBeInTheDocument();
	expect(listeners).toHaveLength(1);
	act(() => listeners[0].fail(new Error("private backend details")));
	expect(screen.getByRole("alert")).toHaveTextContent("Caja no disponible");
	expect(within(header).queryByText("0,00")).not.toBeInTheDocument();
	fireEvent.click(
		screen.getByRole("button", { name: "Reintentar conciliación" }),
	);
	expect(listeners).toHaveLength(2);
	act(() =>
		listeners[1].next({
			exists: () => true,
			data: () => ({
				anchors: [{ date: "2026-01-01", balance: 1234, source: "Synthetic" }],
			}),
		}),
	);
	expect(within(header).getByText("1.234,00")).toBeInTheDocument();
	expect(screen.getByRole("textbox")).toBe(draft);
	expect(draft).toHaveValue("draft");
	act(() => listeners[1].fail(new Error("later failure")));
	expect(within(header).queryByText("1.234,00")).not.toBeInTheDocument();
	fireEvent.click(screen.getByRole("tab", { name: /Configuraci/ }));
	fireEvent.click(
		await within(
			screen.getByRole("navigation", { name: "Páginas de la sección" }),
		).findByRole("button", { name: "Config" }),
	);
	expect(await screen.findByText("Independent settings")).toBeInTheDocument();
});
