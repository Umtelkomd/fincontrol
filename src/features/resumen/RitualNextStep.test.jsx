import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";

import RitualNextStep from "./RitualNextStep.jsx";

const renderStep = (props) =>
	render(
		<MemoryRouter>
			<RitualNextStep {...props} />
		</MemoryRouter>,
	);

it("renders a Link to step.href for an import step when it is elsewhere", () => {
	renderStep({
		step: { id: "import", href: "/banco", count: null, reason: null },
		title: "Importa el extracto",
		detail: "Hay un hueco de más de 5 días hábiles sin movimientos.",
		cta: "Ir a Banco",
		here: false,
	});

	const strip = screen.getByTestId("ritual-next-step");
	expect(strip.tagName).toBe("SECTION");
	expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
	const link = screen.getByRole("link", { name: "Ir a Banco" });
	expect(link).toHaveAttribute("href", "/banco");
	expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("hides the Link for an import step when it is already here", () => {
	renderStep({
		step: { id: "import", href: "/banco", count: null, reason: null },
		title: "Importa el extracto",
		detail: "Hay un hueco de más de 5 días hábiles sin movimientos.",
		cta: "Ir a Banco",
		here: true,
	});

	expect(screen.getByTestId("ritual-next-step")).toBeInTheDocument();
	expect(screen.getByText("Importa el extracto")).toBeInTheDocument();
	expect(
		screen.queryByRole("link", { name: "Ir a Banco" }),
	).not.toBeInTheDocument();
});

it("calls onRetry from a button when cash is unavailable", () => {
	const onRetry = vi.fn();
	renderStep({
		step: { id: "unavailable", href: null, count: null, reason: null },
		title: "No se puede leer la caja",
		detail: "Reintenta la lectura. No uses un saldo en cero.",
		cta: "Reintentar",
		onRetry,
		here: true,
	});

	fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
	expect(onRetry).toHaveBeenCalledOnce();
	expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it("shows title and detail with no CTA when the ritual is done", () => {
	renderStep({
		step: { id: "done", href: null, count: null, reason: null },
		title: "Cierre al día",
		detail: "Extracto, ancla, bandeja y remesas están en orden.",
		cta: null,
	});

	expect(screen.getByText("Cierre al día")).toBeInTheDocument();
	expect(
		screen.getByText("Extracto, ancla, bandeja y remesas están en orden."),
	).toBeInTheDocument();
	expect(screen.queryByRole("link")).not.toBeInTheDocument();
	expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
