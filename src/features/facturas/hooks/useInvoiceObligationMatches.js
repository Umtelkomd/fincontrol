import { useEffect, useRef, useState } from 'react';
import {
  normalizeObligationMatchResponse,
  rankInvoiceObligations,
} from '../lib/obligationMatcher';

const INITIAL_STATE = Object.freeze({ status: 'idle', matchedIds: [] });

/** Debounced, stale-safe client state for provider-neutral obligation ranking. */
export const useInvoiceObligationMatches = ({
  enabled,
  invoice,
  debounceMs = 250,
}) => {
  const [state, setState] = useState(INITIAL_STATE);
  const requestVersion = useRef(0);
  const counterpartyName = invoice?.counterpartyName?.trim() || '';
  const family = invoice?.family;
  const sourceSystem = invoice?.sourceSystem;
  const invoiceNumber = invoice?.invoiceNumber;
  const grossAmount = invoice?.grossAmount;
  const issueDate = invoice?.issueDate;

  useEffect(() => {
    const version = ++requestVersion.current;
    if (!enabled || !counterpartyName) {
      setState(INITIAL_STATE);
      return undefined;
    }

    setState({ status: 'loading', matchedIds: [] });
    const timer = window.setTimeout(async () => {
      try {
        const response = normalizeObligationMatchResponse(
          await rankInvoiceObligations({
            family,
            sourceSystem,
            counterpartyName,
            invoiceNumber,
            grossAmount,
            issueDate,
          }),
        );
        if (requestVersion.current !== version) return;
        if (response.fallback) {
          setState({ status: 'fallback', matchedIds: [] });
          return;
        }
        setState({
          status: 'success',
          matchedIds: response.matches.map((match) => match.recordId),
        });
      } catch {
        if (requestVersion.current === version)
          setState({ status: 'fallback', matchedIds: [] });
      }
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [
    enabled,
    counterpartyName,
    family,
    sourceSystem,
    invoiceNumber,
    grossAmount,
    issueDate,
    debounceMs,
  ]);

  return state;
};

export default useInvoiceObligationMatches;
