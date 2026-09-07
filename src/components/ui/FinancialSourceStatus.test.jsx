import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import FinancialSourceStatus from "./FinancialSourceStatus";

it("announces safe error and retry-loading states, then disappears on recovery", () => {
	const retry = vi.fn();
	const { rerender } = render(
		<FinancialSourceStatus status="error" onRetry={retry} />,
	);
	expect(screen.getByRole("alert")).toHaveTextContent("Caja no disponible");
	const button = screen.getByRole("button", {
		name: "Reintentar conciliación",
	});
	expect(button).toHaveAttribute("type", "button");
	fireEvent.click(button);
	expect(retry).toHaveBeenCalledOnce();
	rerender(<FinancialSourceStatus status="loading" onRetry={retry} />);
	expect(screen.getByRole("status")).toHaveTextContent("Cargando conciliación");
	expect(screen.queryByRole("button")).not.toBeInTheDocument();
	rerender(<FinancialSourceStatus status="ready" onRetry={retry} />);
	expect(screen.queryByRole("status")).not.toBeInTheDocument();
	expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
