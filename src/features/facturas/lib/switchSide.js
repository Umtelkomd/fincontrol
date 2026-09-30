/**
 * SWITCH SIDE — an archived invoice was loaded on the wrong side (a supplier
 * invoice archived as "emitida", or ours archived as "recibida"). Plans the
 * whole correction so useInvoiceDocuments.switchInvoiceSide can commit it in
 * ONE batch:
 *   - the archive doc flips `direction`/`family` and gets its identity
 *     recomputed (the issuer changes with the direction, see intake.js);
 *   - its linked CXC/CXP (at most one) becomes the twin in the other
 *     collection — same number, counterparty, amounts, dates, project,
 *     cost center — and the original is deleted;
 *   - the archive's link points at the new obligation.
 *
 * Refused while the obligation carries money (obligationLockState: payments,
 * partial/settled, a reconciled bank movement) — there is no undo of a bank
 * reconciliation, and flipping a paid invoice would silently move cash
 * between CXC and CXP. Pure: no Firebase, no Date.now().
 */
import { invoiceIdentityInput } from '../../../finance/invoiceArchive';
import { obligationLockState } from '../../../finance/invoiceAmendment';
import { buildConvertedPayload } from '../../../finance/obligationConversion';
import { ISSUER_TENANT_ID } from './intake';

const FAMILY_BY_DIRECTION = { incoming: 'payable', outgoing: 'receivable' };
const OTHER_DIRECTION = { incoming: 'outgoing', outgoing: 'incoming' };
export const FAMILY_LABEL = { payable: 'CXP', receivable: 'CXC' };

const invalid = (error) => ({ valid: false, error });

/**
 * Why this archived invoice cannot switch side, or '' when it can. Used by
 * the viewer to disable the button with the reason as its tooltip.
 */
export const switchSideBlocker = ({ invoiceDocument, obligations = [], bankMovements = [] } = {}) => {
  const direction = invoiceDocument?.direction;
  if (!OTHER_DIRECTION[direction]) return 'La factura no tiene un tipo (emitida/recibida) válido';
  const links = Array.isArray(invoiceDocument.links) ? invoiceDocument.links : [];
  if (links.length > 1) return 'La factura está vinculada a varias obligaciones: corrígelas una a una en CXC/CXP';
  if (links.length === 0) return '';
  const [link] = links;
  const obligation = obligations.find((row) => row.kind === link.family && row.id === link.recordId);
  if (!obligation) return 'La CXC/CXP vinculada ya no existe';
  if (obligation.status === 'cancelled') return `La ${FAMILY_LABEL[link.family]} vinculada está cancelada`;
  const lock = obligationLockState(obligation, bankMovements);
  return lock.locked ? lock.reasons.join('; ') : '';
};

/**
 * @returns {{ valid: false, error: string } | {
 *   valid: true, fromFamily: string, toFamily: string,
 *   archivePatch: { direction, family, identity },
 *   obligation: null | { fromFamily, id, payload },
 * }}
 */
export const planInvoiceSwitchSide = ({
  invoiceDocument,
  obligations = [],
  bankMovements = [],
  reason,
  userEmail,
  nowIso,
} = {}) => {
  if (!String(reason || '').trim()) return invalid('El motivo de la corrección es obligatorio');
  const blocker = switchSideBlocker({ invoiceDocument, obligations, bankMovements });
  if (blocker) return invalid(blocker);

  const fromDirection = invoiceDocument.direction;
  const toDirection = OTHER_DIRECTION[fromDirection];
  const fromFamily = FAMILY_BY_DIRECTION[fromDirection];
  const toFamily = FAMILY_BY_DIRECTION[toDirection];
  const counterpartyId = invoiceDocument.counterpartyId || invoiceDocument.counterpartyName || '';

  let identity;
  try {
    identity = invoiceIdentityInput({
      direction: toDirection,
      issuerId: toDirection === 'incoming' ? counterpartyId : ISSUER_TENANT_ID,
      counterpartyId,
      invoiceNumber: invoiceDocument.invoiceNumber,
    });
  } catch (error) {
    return invalid(`No se puede recalcular la identidad de la factura: ${error.message}`);
  }

  const archivePatch = { direction: toDirection, family: toFamily, identity };
  const [link] = Array.isArray(invoiceDocument.links) ? invoiceDocument.links : [];
  if (!link) return { valid: true, fromFamily, toFamily, archivePatch, obligation: null };

  const row = obligations.find((entry) => entry.kind === link.family && entry.id === link.recordId);
  const payload = buildConvertedPayload(row, link.family, userEmail, nowIso);
  payload.auditTrail[0].detail += ` desde Facturas. Motivo: ${String(reason).trim()}`;
  payload.invoiceDocumentIds = [invoiceDocument.id];
  payload.archivedInvoiceIdentity = identity;

  return {
    valid: true,
    fromFamily: link.family,
    toFamily: link.family === 'payable' ? 'receivable' : 'payable',
    archivePatch,
    obligation: { fromFamily: link.family, id: link.recordId, payload },
  };
};
