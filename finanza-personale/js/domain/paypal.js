import { addDays, daysBetween } from "../lib/dates.js";
import { round, toNum } from "../lib/format.js";
import { detectDateOrder, detectNumberFormat, parseDateCell, parseNumberCell } from "./csvimport.js";

// "PayPal in chiaro": dall'attività scaricata da PayPal (CSV) si ritrova il negozio vero dietro ogni
// movimento della banca o della carta descritto solo come "PayPal". Solo lettura: le modifiche le propone
// l'interfaccia e le conferma l'utente.

const COLS = {
  date: /^(data|date)$/i,
  name: /^(nome|name)$/i,
  type: /^(tipo|type)$/i,
  status: /^(stato|status)$/i,
  currency: /^(valuta|currency)$/i,
  gross: /^(lordo|gross|importo|amount)$/i,
  id: /^(codice transazione|transaction id|id transazione)$/i,
  ref: /^(codice transazione di riferimento|reference txn id|riferimento transazione)$/i,
  item: /^(titolo oggetto|item title)$/i,
};

// Righe del CSV → movimenti PayPal { date, name, type, status, currency, gross, id, ref, item }.
export function parsePaypalActivity(rows) {
  const h = (rows || []).findIndex((r) => r.some((c) => COLS.date.test(String(c).trim())) && r.some((c) => COLS.gross.test(String(c).trim())) && r.some((c) => COLS.name.test(String(c).trim())));
  if (h < 0) return null;
  const head = rows[h].map((c) => String(c).trim());
  const idx = Object.fromEntries(Object.entries(COLS).map(([k, re]) => [k, head.findIndex((c) => re.test(c))]));
  const data = rows.slice(h + 1);
  const cell = (r, k) => (idx[k] >= 0 && idx[k] < r.length ? String(r[idx[k]] ?? "").trim() : "");
  const fmt = detectNumberFormat(data.slice(0, 300).map((r) => cell(r, "gross")));
  const order = detectDateOrder(data.slice(0, 300).map((r) => cell(r, "date")));
  const out = [];
  for (const r of data) {
    const date = parseDateCell(cell(r, "date"), order);
    const gross = parseNumberCell(cell(r, "gross"), fmt);
    if (!date || gross == null) continue;
    const status = cell(r, "status");
    if (status && /annull|cancel|rifiut|denied|in sospeso|pending|non riusc|failed/i.test(status)) continue;
    out.push({ date, name: cell(r, "name"), type: cell(r, "type"), status, currency: (cell(r, "currency") || "EUR").toUpperCase(), gross: round(gross, 2), id: cell(r, "id"), ref: cell(r, "ref"), item: cell(r, "item") });
  }
  return out;
}

export const isPaypalTx = (t) => !!t && (t.kind === "Uscita" || t.kind === "Entrata") && /paypal/i.test(String(t.origDescription || t.description || ""));

// Importo in euro di un pagamento: quello in euro, o la conversione in euro collegata (stesso codice).
function euroAmount(e, entries) {
  if (e.currency === "EUR") return Math.abs(e.gross);
  const conv = entries.find((x) => x !== e && x.currency === "EUR" && ((e.id && x.ref === e.id) || (x.ref && x.ref === e.ref)) && (e.gross < 0 ? x.gross < 0 : x.gross > 0));
  return conv ? Math.abs(conv.gross) : null;
}

// Abbina i movimenti "PayPal" dell'app ai pagamenti con un nome nell'attività PayPal.
//  - "exact": stesso importo in euro, dalla settimana prima a tre giorni dopo l'addebito;
//  - "instalment": una rata di un acquisto "Paga in 3" (un terzo dell'importo, a 0, 30 o 60 giorni).
// Ogni pagamento PayPal si usa una volta: o per un addebito intero, o per le sue tre rate (una per scadenza).
export function matchPaypal(entries, transactions) {
  const named = (entries || []).filter((e) => e.name).map((e) => ({ ...e, eur: euroAmount(e, entries) })).filter((e) => e.eur != null && e.eur > 0);
  const targets = (transactions || []).filter(isPaypalTx).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const used = new Map();
  const out = [];
  const pending = [];
  for (const t of targets) {
    const outflow = t.kind === "Uscita";
    const amt = toNum(t.amount);
    let best = null, bestD = Infinity;
    for (const e of named) {
      if (used.get(e) || (outflow ? e.gross >= 0 : e.gross <= 0) || Math.abs(e.eur - amt) > 0.011) continue;
      const d = daysBetween(e.date, t.date);
      if (d < -3 || d > 7) continue;
      if (Math.abs(d) < bestD) { best = e; bestD = Math.abs(d); }
    }
    if (best) {
      used.set(best, "exact");
      out.push({ tx: t, entry: best, kind: "exact", name: best.name, item: best.item });
    } else if (outflow) pending.push(t);
  }
  const SLOTS = [0, 30, 61];
  for (const t of pending) {
    const amt = toNum(t.amount);
    let best = null, bestScore = Infinity, bestSlot = -1;
    for (const e of named) {
      const u = used.get(e);
      if (e.gross >= 0 || u === "exact" || Math.abs(e.eur - amt * 3) > 0.031) continue;
      const d = daysBetween(e.date, t.date);
      if (d < -3 || d > 100) continue;
      SLOTS.forEach((off, k) => {
        const score = Math.abs(d - off);
        if (!(u && u.has(k)) && score <= 7 && score < bestScore) { best = e; bestScore = score; bestSlot = k; }
      });
    }
    if (best) {
      used.set(best, new Set([...(used.get(best) || []), bestSlot]));
      out.push({ tx: t, entry: best, kind: "instalment", name: best.name, item: best.item });
    }
  }
  return { matches: out.sort((a, b) => (a.tx.date < b.tx.date ? 1 : a.tx.date > b.tx.date ? -1 : 0)), targets: targets.length, from: entries && entries.length ? entries.reduce((m, e) => (e.date < m ? e.date : m), entries[0].date) : "", to: entries && entries.length ? entries.reduce((m, e) => (e.date > m ? e.date : m), entries[0].date) : "" };
}

// Dati da scrivere sul movimento: il nome del negozio al posto di "PayPal" (la descrizione originale resta
// in origDescription, così si può sempre risalire all'estratto).
export function paypalPatch(m, category) {
  const t = m.tx;
  const name = String(m.name).replace(/\s+/g, " ").trim().slice(0, 80);
  const data = { description: `${name} (PayPal${m.kind === "instalment" ? ", rata" : ""})`, paypalName: name };
  if (!t.origDescription) data.origDescription = t.description || "";
  if (category && category !== t.category) data.category = category;
  return data;
}

// Data dell'ultimo addebito "PayPal" non ancora abbinato: suggerisce fino a quando scaricare l'attività.
export function paypalRange(transactions, today) {
  const list = (transactions || []).filter((t) => isPaypalTx(t) && !t.paypalName && t.date <= today).map((t) => t.date).sort();
  return list.length ? { from: addDays(list[0], -7), to: list[list.length - 1], count: list.length } : null;
}
