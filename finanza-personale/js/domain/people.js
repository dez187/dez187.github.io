import { round, toNum } from "../lib/format.js";
import { formatIban } from "../lib/iban.js";

// Persone e viaggi (solo lettura). Campi facoltativi dei movimenti:
//  - person: con chi è la spesa o chi ti restituisce i soldi;
//  - owed: su un'uscita, quanto di quella spesa ti deve restituire la persona (non è una tua spesa);
//  - tag: viaggio o evento (es. "Londra ottobre 2026"), per vederne il costo totale.
// Un'entrata con una persona è una restituzione: chiude quanto ti doveva e non conta come entrata.

export const cleanName = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
export const nameKey = (s) => cleanName(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Quanto di un'uscita va restituito (mai più dell'importo, mai negativo).
export function owedPart(t) {
  if (!t || t.kind !== "Uscita" || !cleanName(t.person)) return 0;
  return Math.min(Math.max(0, toNum(t.owed)), Math.max(0, toNum(t.amount)));
}

export const isRepayment = (t) => !!t && t.kind === "Entrata" && !!cleanName(t.person);

const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

// Un elemento per persona: quanto ti deve (owed − restituito), con i movimenti. Il nome mostrato è quello
// scritto più di recente (le maiuscole e gli accenti non separano le persone).
export function peopleSummary(transactions) {
  const by = new Map();
  for (const t of [...(transactions || [])].sort(byDateDesc)) {
    const name = cleanName(t.person);
    if (!name || (t.kind !== "Uscita" && t.kind !== "Entrata")) continue;
    const k = nameKey(name);
    const e = by.get(k) || { key: k, name, owed: 0, repaid: 0, items: [], last: t.date || "" };
    if (t.kind === "Uscita") e.owed += owedPart(t);
    else e.repaid += toNum(t.amount);
    e.items.push(t);
    by.set(k, e);
  }
  return [...by.values()]
    .map((e) => ({ ...e, owed: round(e.owed, 2), repaid: round(e.repaid, 2), balance: round(e.owed - e.repaid, 2) }))
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance) || (a.last < b.last ? 1 : -1));
}

// Un elemento per viaggio o evento: speso, rimborsato dagli altri e quanto resta a te.
export function tagsSummary(transactions) {
  const by = new Map();
  for (const t of [...(transactions || [])].sort(byDateDesc)) {
    const name = cleanName(t.tag);
    if (!name || (t.kind !== "Uscita" && t.kind !== "Entrata")) continue;
    const k = nameKey(name);
    const e = by.get(k) || { key: k, name, spent: 0, owed: 0, repaid: 0, refunds: 0, count: 0, from: t.date || "", to: t.date || "" };
    if (t.kind === "Uscita") {
      e.spent += toNum(t.amount);
      e.owed += owedPart(t);
    } else if (isRepayment(t)) e.repaid += toNum(t.amount);
    else e.refunds += toNum(t.amount);
    e.count++;
    if (t.date && t.date < e.from) e.from = t.date;
    if (t.date && t.date > e.to) e.to = t.date;
    by.set(k, e);
  }
  // Quanto è costato davvero: lo speso meno quello che pagano gli altri. Le persone: la parte da restituire (o,
  // se non è stata indicata, quanto hanno già restituito con questo viaggio); poi i rimborsi senza persona
  // (es. un volo cancellato), che si aggiungono.
  return [...by.values()]
    .map((e) => {
      const others = Math.max(e.owed, e.repaid) + e.refunds;
      return { ...e, spent: round(e.spent, 2), owed: round(e.owed, 2), repaid: round(e.repaid, 2), refunds: round(e.refunds, 2), others: round(others, 2), net: round(e.spent - others, 2) };
    })
    .sort((a, b) => (a.to < b.to ? 1 : a.to > b.to ? -1 : 0));
}

export function knownNames(transactions, field) {
  const by = new Map();
  for (const t of [...(transactions || [])].sort(byDateDesc)) {
    const n = cleanName(t[field]);
    if (n && !by.has(nameKey(n))) by.set(nameKey(n), n);
  }
  return [...by.values()].sort((a, b) => a.localeCompare(b, "it"));
}

// Messaggio da mandare per chiedere un rimborso: importo, motivi (le spese ancora aperte) e IBAN.
export function refundMessage({ name, amount, reasons = [], iban = "", holder = "" }) {
  const amt = Number(amount).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const why = reasons.filter(Boolean);
  const lines = [`Ciao ${cleanName(name) || ""}! Mi mandi ${amt} €${why.length ? ` per ${why.slice(0, 4).join(", ")}${why.length > 4 ? " e altro" : ""}` : ""}?`.replace(/ !/, "!")];
  if (iban) lines.push(`IBAN: ${formatIban(iban)}${holder ? ` (intestato a ${cleanName(holder)})` : ""}`);
  lines.push("Grazie!");
  return lines.join("\n");
}
