import { ymd } from "../lib/dates.js";
import { round, toNum } from "../lib/format.js";
import { normText } from "./rules.js";
import { CARD_CATEGORY, cycleForDebitDate } from "./cards.js";

// Importazione di estratti conto CSV (Revolut, Banco BPM e in generale le banche italiane):
// lettura del file, riconoscimento delle colonne, date e importi, doppioni.

// ---------- lettura ----------
export function detectDelimiter(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim()).slice(0, 15);
  let best = ";", bestScore = -1;
  for (const d of [";", "\t", ",", "|"]) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const freq = new Map();
    for (const c of counts) if (c > 0) freq.set(c, (freq.get(c) || 0) + 1);
    let mode = 0, modeFreq = 0;
    for (const [c, f] of freq) if (f > modeFreq || (f === modeFreq && c > mode)) { mode = c; modeFreq = f; }
    const score = modeFreq * 100 + mode;
    if (mode > 0 && score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

function countOutsideQuotes(line, d) {
  let n = 0, q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === d && !q) n++;
  }
  return n;
}

export function parseCsv(text, delimiter) {
  const s = String(text || "").replace(/^﻿/, "");
  const rows = [];
  let row = [], cell = "", inQ = false, quoted = false;
  const endCell = () => { row.push(quoted ? cell : cell.trim()); cell = ""; quoted = false; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += c;
    } else if (c === '"' && cell.trim() === "") { inQ = true; quoted = true; cell = ""; }
    else if (c === delimiter) endCell();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      endCell();
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { endCell(); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x !== ""));
}

// ---------- intestazione e colonne ----------
const HEADER_WORD = /data|date|descri|causale|dettagl|operazion|importo|amount|dare|avere|entrat|uscit|addebit|accredit|saldo|balance|valuta|currency|divisa|tipo|type|beneficiar|merchant|categor|started|completed|fee|commission|state|stato|prodotto|product|riferimento|memo/i;

export function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const hits = rows[i].filter((c) => c && c.length <= 40 && HEADER_WORD.test(c) && !/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/.test(c) && !/^-?[\d.,]+$/.test(c)).length;
    if (hits >= 2) return i;
  }
  return -1;
}

export function guessMapping(headers) {
  const used = new Set();
  const pick = (patterns, exclude) => {
    for (const re of patterns) {
      const i = headers.findIndex((h, k) => !used.has(k) && re.test(h) && !(exclude && exclude.test(h)));
      if (i >= 0) { used.add(i); return i; }
    }
    return -1;
  };
  const m = {};
  m.date = pick([/completed date|data di completamento|data contabile|data operazione|data movimento|booking date|^data$|^date$/i, /started date|data di inizio|data/i, /date/i], /valuta|value/i);
  m.state = pick([/^state$|^stato$/i]);
  m.product = pick([/^product$|^prodotto$/i]);
  // Solo una colonna di costo "semplice" (Revolut: Fee/Costo) si sottrae dall'importo; le colonne di commissioni
  // informative delle carte (Nexi: "Commissione circuiti (€)") sono già comprese nell'importo in euro.
  m.fee = pick([/^(fee|fees|costo|costi|commissione|commissioni|spese)$/i]);
  m.balance = pick([/saldo|balance/i]);
  // Prima l'importo dichiaratamente in euro (Nexi ha anche "Importo originale in Divisa").
  m.amount = pick([/(importo|amount|ammontare)\s*(\((€|eur)\)|in (€|eur)|eur$)/i, /^importo|^amount|^ammontare|^valore|importo \(|amount \(/i], /fee|commission|divisa|original/i);
  m.debit = pick([/dare|uscit|addebit|debit|withdraw|prelievi|pagamenti/i]);
  m.credit = pick([/avere|entrat|accredit|credit|deposit|versament/i]);
  m.description = pick([/descrizione|description/i, /dettagl|details|merchant|beneficiar|causale|operazion|memo|riferimento|narrative/i]);
  m.currency = pick([/currency|divisa|^valuta$/i], /data|date/i);
  // Con un importo già in euro, la colonna della valuta è quella della spesa originale: non va controllata.
  if (m.amount >= 0 && /(\(|\s)(€|eur)\)?$/i.test(headers[m.amount] || "")) m.currency = -1;
  m.type = pick([/^type$|^tipo$/i]);
  m.category = pick([/categor/i]);
  if (m.amount >= 0) { m.debit = -1; m.credit = -1; }
  return m;
}

// ---------- date ----------
const MONTHS = { gen: 1, jan: 1, feb: 2, mar: 3, apr: 4, mag: 5, may: 5, giu: 6, jun: 6, lug: 7, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, ott: 10, oct: 10, nov: 11, dic: 12, dec: 12 };

export function detectDateOrder(samples) {
  return dateOrderFromData(samples) || "dmy";
}

// "dmy" o "mdy" solo se almeno una data lo dice (un giorno oltre il 12), altrimenti null.
function dateOrderFromData(samples) {
  for (const s of samples) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(String(s || "").trim());
    if (!m) continue;
    if (Number(m[1]) > 12) return "dmy";
    if (Number(m[2]) > 12) return "mdy";
  }
  return null;
}

export function parseDateCell(value, order = "dmy") {
  const s = String(value || "").trim();
  let y, mo, d, m;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s))) [y, mo, d] = [m[1], m[2], m[3]].map(Number);
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s))) {
    const a = Number(m[1]), b = Number(m[2]);
    y = Number(m[3]);
    [d, mo] = order === "mdy" ? [b, a] : [a, b];
  } else if ((m = /^(\d{1,2})\s+([a-zà-ù]{3})[a-zà-ù.]*\s+(\d{2,4})/i.exec(s))) {
    d = Number(m[1]);
    mo = MONTHS[m[2].toLowerCase()];
    y = Number(m[3]);
  } else return null;
  if (y < 100) y += 2000;
  if (!mo || mo > 12 || !d || d > 31 || y < 1990 || y > 2100) return null;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > dim) return null;
  return ymd(y, mo, d);
}

// ---------- importi ----------
export function detectNumberFormat(samples) {
  let it = 0, en = 0;
  for (const raw of samples) {
    const s = String(raw || "").replace(/[^\d.,]/g, "");
    if (!s) continue;
    const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
    if (lc >= 0 && ld >= 0) { if (lc > ld) it += 2; else en += 2; }
    else if (lc >= 0) { if (/,\d{1,2}$/.test(s)) it += 2; else en += 1; }
    else if (ld >= 0) { if (/\.\d{1,2}$/.test(s)) en += 2; else it += 1; }
  }
  return en > it ? "en" : "it";
}

export function parseNumberCell(value, fmt = "it") {
  let t = String(value ?? "").replace(/−/g, "-").replace(/\s|€|\$|£|EUR|eur/g, "");
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (/-$/.test(t)) { neg = !neg; t = t.slice(0, -1); }
  if (/^[+-]/.test(t)) { if (t[0] === "-") neg = !neg; t = t.slice(1); }
  t = fmt === "it" ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  if (!/^\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return neg ? -n : n;
}

// ---------- righe ----------
const DONE_STATE = /complet|eseguit|contabilizz|^cont\.?$|booked|settled|confermat/i;

// Righe del file → movimenti proposti. amount: positivo = entrata, negativo = uscita.
export function buildItems(rows, headerIndex, mapping, opts = {}) {
  const data = rows.slice(headerIndex + 1);
  const cell = (r, i) => (i >= 0 && i < r.length ? r[i] : "");
  const numCells = [];
  for (const r of data.slice(0, 200)) for (const k of [mapping.amount, mapping.debit, mapping.credit, mapping.balance]) if (k >= 0 && cell(r, k)) numCells.push(cell(r, k));
  const fmt = opts.numberFormat || detectNumberFormat(numCells);
  // Le date del file decidono; l'indizio (opts.dateOrder) vale solo quando sono tutte ambigue.
  const order = dateOrderFromData(data.slice(0, 200).map((r) => cell(r, mapping.date))) || opts.dateOrder || "dmy";
  const items = [];
  data.forEach((r, i) => {
    if (opts.product && mapping.product >= 0 && cell(r, mapping.product) !== opts.product) return;
    const line = headerIndex + 2 + i;
    const dateCell = cell(r, mapping.date);
    const date = parseDateCell(dateCell, order);
    const state = mapping.state >= 0 ? cell(r, mapping.state) : "";
    // Righe senza una data riconoscibile (titoli, saldi finali, note) non sono movimenti.
    if (!date && !state && !/\d{1,4}[/.-]\d{1,2}|\d{1,2}\s+[a-zà-ù]{3}/i.test(dateCell)) return;
    let amount = null;
    if (mapping.amount >= 0) amount = parseNumberCell(cell(r, mapping.amount), fmt);
    else {
      const debit = mapping.debit >= 0 ? parseNumberCell(cell(r, mapping.debit), fmt) : null;
      const credit = mapping.credit >= 0 ? parseNumberCell(cell(r, mapping.credit), fmt) : null;
      if (debit != null || credit != null) amount = Math.abs(credit || 0) - Math.abs(debit || 0);
    }
    if (!date && amount == null) return; // righe di totale o note in fondo al file
    const fee = mapping.fee >= 0 ? parseNumberCell(cell(r, mapping.fee), fmt) : null;
    if (amount != null && fee) amount -= Math.abs(fee);
    if (amount != null && opts.invert) amount = -amount;
    const parts = [cell(r, mapping.description)];
    const description = parts.filter(Boolean).join(" · ").replace(/\s+/g, " ").trim() || cell(r, mapping.type) || "Movimento";
    const item = { line, date, amount: amount == null ? null : round(amount, 2), description, balance: mapping.balance >= 0 ? parseNumberCell(cell(r, mapping.balance), fmt) : null, category: mapping.category >= 0 ? cell(r, mapping.category) : "" };
    const currency = mapping.currency >= 0 ? cell(r, mapping.currency).toUpperCase() : "";
    if (state && !DONE_STATE.test(state)) item.skip = `non completato (${state.toLowerCase()})`;
    else if (!date) item.skip = "data non valida";
    else if (amount == null) item.skip = "importo non valido";
    else if (Math.abs(amount) < 0.005) item.skip = "importo zero";
    else if (currency && currency !== "EUR") item.skip = `valuta ${currency}`;
    items.push(item);
  });
  return { items, numberFormat: fmt, dateOrder: order };
}

// Indizi sul formato che non si ricavano dalle colonne: l'estratto American Express scrive le date
// all'americana (mese/giorno/anno) anche nella versione italiana.
// Si guardano solo le righe prima dei movimenti, mai i movimenti (una banca può avere "ADDEBITO AMERICAN EXPRESS").
export function sheetHints(rows, headerIndex) {
  if (!(headerIndex >= 0)) return {};
  const before = rows.slice(0, headerIndex + 1).flat().join(" ");
  return /american express|amex/i.test(before) ? { dateOrder: "mdy", bank: "American Express" } : {};
}

export function productValues(rows, headerIndex, mapping) {
  if (mapping.product < 0) return [];
  const counts = new Map();
  for (const r of rows.slice(headerIndex + 1)) {
    const v = r[mapping.product] || "";
    if (v) counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

// ---------- doppioni ----------
// Hash veloce a 53 bit (cyrb53) per identificativi stabili.
export function hashString(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// Id deterministico: reimportare lo stesso file non crea doppioni.
export function assignImportIds(items, targetKey) {
  const seen = new Map();
  for (const it of items) {
    if (it.skip) continue;
    const base = `${targetKey}|${it.date}|${it.amount.toFixed(2)}|${normText(it.description)}`;
    const k = seen.get(base) || 0;
    seen.set(base, k + 1);
    it.id = `csv-${hashString(base)}-${k}`;
  }
  return items;
}

function touches(t, target, outflow) {
  if (target.type === "card") {
    if (t.kind === "Giroconto") return outflow ? t.fromCardId === target.id : t.toCardId === target.id;
    return t.cardId === target.id && (outflow ? t.kind !== "Entrata" : t.kind === "Entrata");
  }
  if (t.kind === "Giroconto") return outflow ? t.fromAccountId === target.id : t.toAccountId === target.id;
  return t.accountId === target.id && !t.cardId && (outflow ? t.kind === "Uscita" : t.kind === "Entrata");
}

// Segna i movimenti già presenti: stesso id d'importazione, oppure stesso importo e verso sullo
// stesso conto nella stessa data ("present") o a pochi giorni di distanza ("similar").
export function markDuplicates(items, transactions, target, toleranceDays = 3) {
  const ids = new Set(transactions.map((t) => t.id));
  const pool = transactions.filter((t) => t.date && !String(t.id).startsWith("csv-"));
  const used = new Set();
  const dayNum = (d) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86400000;
  for (const it of items) {
    if (it.skip) continue;
    if (it.id && ids.has(it.id)) { it.dup = "imported"; continue; }
    const outflow = it.amount < 0;
    const abs = Math.abs(it.amount);
    const same = (t) => !used.has(t.id) && Math.abs(toNum(t.amount) - abs) < 0.005 && touches(t, target, outflow);
    let hit = pool.find((t) => same(t) && t.date === it.date);
    if (hit) { used.add(hit.id); it.dup = "present"; it.dupOf = hit.id; continue; }
    hit = pool.find((t) => same(t) && Math.abs(dayNum(t.date) - dayNum(it.date)) <= toleranceDays);
    if (hit) { used.add(hit.id); it.dup = "similar"; it.dupOf = hit.id; }
  }
  return items;
}

// ---------- carte di credito negli estratti ----------
export const CARD_PAYMENT = "__card__:";

function mentions(text, name) {
  const n = normText(name);
  return n.length >= 3 && new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(text);
}

// Nell'estratto del conto: l'addebito mensile di una carta. La descrizione parla di addebito e
// nomina la carta o chi la emette ("ADDEBITO SDD AMERICAN EXPRESS"). Restituisce l'id della carta.
export function suggestCardPayment(description, cards) {
  const d = normText(description);
  if (!/addebit|(^|[^a-z])sdd([^a-z]|$)|estratto|saldo/.test(d)) return null;
  const hit = (cards || []).find((c) => mentions(d, c.name) || mentions(d, c.issuer));
  return hit ? hit.id : null;
}

// Nell'estratto della carta: il pagamento del mese precedente ("PAGAMENTO RICEVUTO - GRAZIE").
// Non è un rimborso: importarlo farebbe scendere lo speso e comparire un'entrata che non c'è.
export function isStatementPayment(description) {
  return /pagamento ricevuto|payment received|pagamento[^a-z]+grazie|grazie per il (suo |tuo )?pagamento|addebito (in c\/?c|in conto|diretto|sdd)|saldo (precedente|estratto conto)/.test(normText(description));
}

// Negli estratti delle carte le spese sono spesso in positivo: in quel caso il segno va invertito.
// Indizi, in ordine: rimborsi e pagamenti dell'estratto con il segno meno; poi la maggioranza dei
// movimenti, per numero e a parità per importo. items: righe lette senza inversione.
export function cardSignInverted(items) {
  const valid = items.filter((it) => !it.skip && it.amount);
  let hint = 0;
  for (const it of valid) {
    if (isStatementPayment(it.description) || /storno|rimbors|refund|accredito|(^|[^a-z])reso([^a-z]|$)/.test(normText(it.description))) hint += it.amount < 0 ? 1 : -1;
  }
  if (hint !== 0) return hint > 0;
  const pos = valid.filter((it) => it.amount > 0);
  const neg = valid.filter((it) => it.amount < 0);
  if (pos.length !== neg.length) return pos.length > neg.length;
  const total = (list) => list.reduce((s, it) => s + Math.abs(it.amount), 0);
  return total(pos) > total(neg);
}

// Movimento da salvare. category "__transfer__" = giroconto con un conto non indicato;
// "__card__:<id>" = addebito mensile di quella carta (solo per le uscite di un conto).
export function itemToTransaction(it, target, category, now, cards) {
  const amount = round(Math.abs(it.amount), 2);
  const base = { date: it.date, description: it.description, amount, source: "csv", createdAt: now };
  if (category === "__transfer__" && target.type === "account") {
    return { ...base, kind: "Giroconto", category: "Giroconto", fromAccountId: it.amount < 0 ? target.id : "", toAccountId: it.amount < 0 ? "" : target.id };
  }
  const kind = it.amount < 0 ? "Uscita" : "Entrata";
  const special = typeof category === "string" && (category === "__transfer__" || category.startsWith(CARD_PAYMENT));
  if (special && category.startsWith(CARD_PAYMENT) && target.type === "account" && kind === "Uscita") {
    const cardId = category.slice(CARD_PAYMENT.length);
    const card = (cards || []).find((c) => c.id === cardId);
    const cycle = card ? cycleForDebitDate(card, it.date) : null;
    return { ...base, kind, category: CARD_CATEGORY, accountId: target.id, cardId: "", cardPaymentFor: cardId, ...(cycle ? { cycleFrom: cycle.from, cycleTo: cycle.to } : {}) };
  }
  const cat = category && !special ? category : kind === "Entrata" ? "Altre entrate" : "Altro";
  return { ...base, kind, category: cat, accountId: target.type === "account" ? target.id : "", cardId: target.type === "card" ? target.id : "" };
}
