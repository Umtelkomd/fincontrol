import { describe, expect, it } from "vitest";

import { ritualCopy } from "./ritualCopy.js";

const step = (id, extra = {}) => ({
	id,
	href: extra.href ?? null,
	count: extra.count ?? null,
	reason: extra.reason ?? null,
});

describe("ritualCopy", () => {
	it("asks to retry when cash is unavailable", () => {
		expect(ritualCopy(step("unavailable"))).toEqual({
			title: "No se puede leer la caja",
			detail: "Reintenta la lectura. No uses un saldo en cero.",
			cta: "Reintentar",
		});
	});

	it("sends the operator to Banco on an import gap", () => {
		expect(ritualCopy(step("import", { href: "/banco" }))).toEqual({
			title: "Importa el extracto",
			detail: "Hay un hueco de más de 5 días hábiles sin movimientos.",
			cta: "Ir a Banco",
		});
	});

	it("distinguishes a missing anchor from a stale one", () => {
		expect(
			ritualCopy(step("anchor", { href: "/banco", reason: "missing" })),
		).toEqual({
			title: "Registra el ancla",
			detail: "La caja aún no está conciliada con un saldo verificado.",
			cta: "Ir a Banco",
		});
		expect(
			ritualCopy(step("anchor", { href: "/banco", reason: "stale" })),
		).toEqual({
			title: "Ancla desactualizada",
			detail: "El saldo verificado tiene más de 45 días. Registra el cierre.",
			cta: "Ir a Banco",
		});
	});

	it("points drift at Tesorería", () => {
		expect(ritualCopy(step("drift", { href: "/configuracion" }))).toEqual({
			title: "Las anclas no cuadran",
			detail:
				"Los movimientos entre anclas no explican el saldo. Revisa tesorería.",
			cta: "Ir a Tesorería",
		});
	});

	it("pluralizes the classifier inbox", () => {
		expect(
			ritualCopy(step("classify", { href: "/clasificar", count: 1 })),
		).toEqual({
			title: "Vacía la bandeja",
			detail: "Hay 1 movimiento sin clasificar.",
			cta: "Ir a Bandeja",
		});
		expect(
			ritualCopy(step("classify", { href: "/clasificar", count: 4 })),
		).toEqual({
			title: "Vacía la bandeja",
			detail: "Hay 4 movimientos sin clasificar.",
			cta: "Ir a Bandeja",
		});
	});

	it("pluralizes pending remesas", () => {
		expect(
			ritualCopy(step("remesas", { href: "/cxc/remesas", count: 1 })),
		).toEqual({
			title: "Concilia las remesas",
			detail: "Hay 1 remesa sin explicar.",
			cta: "Ir a Remesas",
		});
		expect(
			ritualCopy(step("remesas", { href: "/cxc/remesas", count: 3 })),
		).toEqual({
			title: "Concilia las remesas",
			detail: "Hay 3 remesas sin explicar.",
			cta: "Ir a Remesas",
		});
	});

	it("has no CTA when the ritual is done", () => {
		expect(ritualCopy(step("done"))).toEqual({
			title: "Cierre al día",
			detail: "Extracto, ancla, bandeja y remesas están en orden.",
			cta: null,
		});
	});
});
