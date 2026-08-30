# DATEV Rechnung extracts — REAL

`extract_2025-270.txt`, `-271.txt`, `-272.txt` are verbatim `pdftotext -layout`
dumps of the real DATEV invoices (copied 30.08.2026 from
`~/Downloads/cxc_inventario/`). They drive `parseDatevFooterPedidos` and
`parseDatevRechnungHeader`.

Layout facts the parser relies on:

- header: `Rechnungs-Nr.: 2025-NNN`, `Belegdatum`, `Auftragsnummer`
- positions above `Summe:` / `Endbetrag:` (German decimals, `1.234,56`)
- 2025-270 spans two pages: page 1 ends with `Übertrag:` and a bank footer,
  page 2 starts with `Vortrag:` — all of it is ABOVE the last `Endbetrag:`
- the Insyte pedidos (7 digits) sit one per line AFTER
  `Verwenden Sie bitte die Rechnungsnummer für die Überweisung.`; 2025-272
  has a trailing ` .` after the last one
- the bank footer repeats after the pedidos with phone (`+49 176 72195330`,
  8 digits), Steuernummer, USt-IdNr and IBAN groups — none may be read as a pedido

Pedidos: 2025-270 → 2640070, 2640164, 2640165, 2640168, 2640169, 2640170 ·
2025-271 → 2640178 · 2025-272 → 2640321, 2640322.
