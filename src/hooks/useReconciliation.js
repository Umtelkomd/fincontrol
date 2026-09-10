import { useCallback, useEffect, useMemo, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db, appId } from "../services/firebase";
import { logError } from "../utils/logger";
import { writeAuditLogEntry } from "../utils/auditLog";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const sortByDateDesc = (left, right) =>
	(right.date || "").localeCompare(left.date || "");

/**
 * Reconciliation anchors (settings/reconciliation): verified bank balances
 * the cash position derives from. The newest anchor ≤ today wins; movements
 * after it complete the balance. Managed from Configuración → Tesorería.
 */
export const useReconciliation = (user) => {
	const userId = user?.uid || user?.email || null;
	const [attempt, setAttempt] = useState(0);
	const [state, setState] = useState(() => ({
		userId,
		anchors: [],
		loading: !!userId,
		error: null,
	}));
	// Hide the previous identity's data on the first render, before effect cleanup.
	const { anchors, loading, error } =
		state.userId === userId
			? state
			: { anchors: [], loading: !!userId, error: null };

	const retry = useCallback(() => {
		if (!userId) return;
		setState((previous) => ({ ...previous, loading: true }));
		setAttempt((previous) => previous + 1);
	}, [userId]);

	const docRef = useMemo(
		() =>
			doc(
				db,
				"artifacts",
				appId,
				"public",
				"data",
				"settings",
				"reconciliation",
			),
		[],
	);

	useEffect(() => {
		setState((previous) =>
			previous.userId === userId
				? { ...previous, loading: !!userId }
				: { userId, anchors: [], loading: !!userId, error: null },
		);
		if (!userId) return undefined;
		let active = true;
		const unsubscribe = onSnapshot(
			docRef,
			(snapshot) => {
				if (!active) return;
				const data = snapshot.exists() ? snapshot.data() : null;
				const list = Array.isArray(data?.anchors) ? data.anchors : [];
				setState({
					userId,
					anchors: [...list].sort(sortByDateDesc),
					loading: false,
					error: null,
				});
			},
			(err) => {
				if (!active) return;
				// Firestore errors terminate listeners. Recovery requires a new one.
				active = false;
				logError("Error loading reconciliation anchors:", err);
				setState((previous) => ({ ...previous, error: err, loading: false }));
			},
		);

		return () => {
			active = false;
			unsubscribe();
		};
	}, [docRef, userId, attempt]);

	const persist = async (nextAnchors, description) => {
		if (!user) return { success: false, error: "No user" };
		try {
			await setDoc(docRef, {
				anchors: nextAnchors,
				updatedAt: serverTimestamp(),
				updatedBy: user.email,
			});
			await writeAuditLogEntry({
				action: "update",
				entityType: "settings",
				entityId: "reconciliation",
				description,
				userEmail: user.email,
				after: { anchors: nextAnchors },
			});
			return { success: true };
		} catch (err) {
			logError("Error saving reconciliation anchors:", err);
			return { success: false, error: err };
		}
	};

	const addAnchors = async (entries) => {
		if (!entries.length) return { success: false, error: "empty-anchors" };
		const replacements = new Map();
		// Validate the whole batch before writing: no partially saved imports.
		for (const { date, balance, source, note = "" } of entries) {
			if (!ISO_DATE_RE.test(date || ""))
				return { success: false, error: "invalid-date" };
			const numericBalance = Number(balance);
			if (!Number.isFinite(numericBalance))
				return { success: false, error: "invalid-balance" };
			if (!source || !source.trim())
				return { success: false, error: "missing-source" };

			const anchor = {
				date,
				balance: Math.round(numericBalance * 100) / 100,
				source: source.trim(),
				note: note.trim(),
				confirmedBy: user?.email || "",
				confirmedAt: new Date().toISOString(),
			};
			replacements.set(date, anchor);
		}
		const next = [
			...anchors.filter((entry) => !replacements.has(entry.date)),
			...replacements.values(),
		].sort(sortByDateDesc);
		return persist(
			next,
			`Anclas de conciliación registradas: ${[...replacements.keys()].join(", ")}`,
		);
	};

	const addAnchor = (entry) => addAnchors([entry]);

	const removeAnchor = async (date) => {
		const next = anchors.filter((entry) => entry.date !== date);
		if (next.length === anchors.length)
			return { success: false, error: "not-found" };
		return persist(next, `Ancla de conciliación eliminada: ${date}`);
	};

	return { anchors, loading, error, retry, addAnchor, addAnchors, removeAnchor };
};

export default useReconciliation;
