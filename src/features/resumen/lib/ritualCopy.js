/**
 * Neutral Spanish copy for the cash-ritual next-step strip.
 * Input is the object returned by `nextRitualStep`.
 */

const copyFor = (title, detail, cta) => ({ title, detail, cta });

const noun = (count, singular, plural) =>
	Number(count) === 1 ? singular : plural;

export const ritualCopy = (step) => {
	const id = step?.id;

	if (id === "unavailable") {
		return copyFor(
			"No se puede leer la caja",
			"Reintenta la lectura. No uses un saldo en cero.",
			"Reintentar",
		);
	}

	if (id === "import") {
		return copyFor(
			"Importa el extracto",
			"Hay un hueco de más de 5 días hábiles sin movimientos.",
			"Ir a Banco",
		);
	}

	if (id === "anchor" && step.reason === "stale") {
		return copyFor(
			"Ancla desactualizada",
			"El saldo verificado tiene más de 45 días. Registra el cierre.",
			"Ir a Banco",
		);
	}

	if (id === "anchor") {
		return copyFor(
			"Registra el ancla",
			"La caja aún no está conciliada con un saldo verificado.",
			"Ir a Banco",
		);
	}

	if (id === "drift") {
		return copyFor(
			"Las anclas no cuadran",
			"Los movimientos entre anclas no explican el saldo. Revisa tesorería.",
			"Ir a Tesorería",
		);
	}

	if (id === "classify") {
		const count = Number(step.count) || 0;
		return copyFor(
			"Vacía la bandeja",
			`Hay ${count} ${noun(count, "movimiento", "movimientos")} sin clasificar.`,
			"Ir a Bandeja",
		);
	}

	if (id === "remesas") {
		const count = Number(step.count) || 0;
		return copyFor(
			"Concilia las remesas",
			`Hay ${count} ${noun(count, "remesa", "remesas")} sin explicar.`,
			"Ir a Remesas",
		);
	}

	return copyFor(
		"Cierre al día",
		"Extracto, ancla, bandeja y remesas están en orden.",
		null,
	);
};
