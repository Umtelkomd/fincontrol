/**
 * TEST ONLY — invented invoices/orders, not anonymized production extracts.
 * All parties/IDs/dates/amounts are fictional. ZZ00 and +00 are deliberately
 * invalid bank/phone placeholders. Expected outputs live in the tests, not here.
 * Structural case mapping is recorded in plans/004-close-self-provisioning-gap.md.
 */
const BANK_FOOTER = `Synthetic Supplier — NOT A REAL BUSINESS
Telefon +00 000 88888888
USt-IdNr DE000000000 · Steuernummer 000/000/00000
IBAN ZZ00 0000 0000 0000 0000 00 · BIC SYNTHETIC
`;

export const SYNTHETIC_SIX_PEDIDOS = `SYNTHETIC TEST INVOICE — NOT FOR PAYMENT
Rechnungs-Nr.: 2099-901
Belegdatum: 14.03.2099 · Auftragsnummer: 0099000000
1 0099010001 Synthetic Alpha KW10 1,00 120,00
2 0099010002 Synthetic Beta KW11 2,00 240,00
3 0099010003 Synthetic Gamma KW11 3,00 360,00
Übertrag: 720,00
${BANK_FOOTER}\f
Vortrag: 720,00
4 0099010004 Synthetic Delta KW11 4,00 480,00
5 0099010005 Synthetic Epsilon KW11 5,00 600,00
6 0099010006 Synthetic Zeta KW11 6,00 720,00
Zwischensumme: 2.520,00
Summe: 2.520,00
USt 19 %: 478,80
Endbetrag: 2.998,80
Verwenden Sie bitte die Rechnungsnummer für die Überweisung.
9901001
9901002
9901003
9901004
9901005
9901006
Zahlbar bis 28.03.2099
${BANK_FOOTER}`;

export const SYNTHETIC_SINGLE_PEDIDO = `SYNTHETIC TEST INVOICE — NOT FOR PAYMENT
Rechnungs-Nr.: 2099-902
Belegdatum: 14.03.2099 · Auftragsnummer: 0099000000
1 0099010007 Synthetic Single 1,00 12.345,67
Summe: 12.345,67
USt 19 %: 2.345,68
Endbetrag: 14.691,35
Verwenden Sie bitte die Rechnungsnummer für die Überweisung.
9901007
${BANK_FOOTER}`;

export const SYNTHETIC_TWO_PEDIDOS = `SYNTHETIC TEST INVOICE — NOT FOR PAYMENT
Rechnungs-Nr.: 2099-903
Belegdatum: 14.03.2099 · Auftragsnummer: 0099000000
1 0099010008 Synthetic Pair A 1,00 800,00
2 0099010009 Synthetic Pair B 1,00 900,00
Summe: 1.700,00
USt 19 %: 323,00
Endbetrag: 2.023,00
Verwenden Sie bitte die Rechnungsnummer für die Überweisung.
9901008
9901008
9901009 .
${BANK_FOOTER}`;

export const SYNTHETIC_PEDIDOS_CSV = `num_doc,fecha_pedido,codigo_presupuesto,fecha_presupuesto,ref_proveedor,importe
9901001,14/03/2099,0099010001,13/03/2099,Synthetic Alpha KW10 2099,120.00 EUR
9901002,14/03/2099,0099010002,13/03/2099,Synthetic Beta KW11 2099,240.00 EUR
9901003,14/03/2099,0099010003,13/03/2099,Synthetic Gamma KW11 2099,360.00 EUR
9901004,14/03/2099,0099010004,13/03/2099,"Synthetic Delta A, B KW11 2099",480.00 EUR
9901005,14/03/2099,0099010005,13/03/2099,Synthetic Epsilon KW11 2099,600.00 EUR
9901006,14/03/2099,0099010006,13/03/2099,Synthetic Zeta KW11 2099,720.00 EUR
9901007,14/03/2099,0099010007,13/03/2099,Synthetic Single,12345.67 EUR
9901008,14/03/2099,0099010008,13/03/2099,Synthetic Pair A,800.00 EUR
9901009,14/03/2099,0099010009,13/03/2099,Synthetic Pair B,900.00 EUR
`;
