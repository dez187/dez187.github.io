import { addDays, addMonths, daysBetween } from "../lib/dates.js";
import { round, toNum } from "../lib/format.js";

// Rate a pagamento trovate nei movimenti (solo lettura):
//  - "Paga in 3" e simili (PayPal, Klarna, Scalapay...): stesso importo, a un mese di distanza, al massimo
//    tre volte. Con due rate pagate e l'ultima recente, la terza è ancora da pagare.
//  - rateizzazioni con l'Agenzia delle Entrate-Riscossione: importo quasi uguale ogni mese, anche da conti
//    diversi; quante rate restano non si sa (lo indica l'utente programmandole).
// Servono alla previsione (le rate rimaste) e alla pagina dei debiti, dove si possono programmare o ignorare.

export const BNPL_TOTAL = 3;
const BNPL = [
  [/paypal/i, "PayPal"], [/klarna/i, "Klarna"], [/scalapay/i, "Scalapay"], [/pagolight|heylight/i, "HeyLight"],
  [/pay ?in ?3|paga in 3|in 3 rate/i, "Paga in 3"],
];
const TAX = /riscossione|agenzia\s+(delle\s+)?entrate|(^|[^a-z])ader([^a-z]|$)|rateizz/i;

export function instalmentProvider(description) {
  const d = String(description || "");
  if (TAX.test(d)) return { type: "tax", label: "Agenzia delle Entrate-Riscossione" };
  for (const [re, label] of BNPL) if (re.test(d)) return { type: "bnpl", label };
  return null;
}

const via = (t) => (t.cardId ? `card:${t.cardId}` : `account:${t.accountId || ""}`);
const median = (list) => {
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0;
};

// Catene di pagamenti a circa un mese di distanza; same(a, b) dice se due pagamenti possono essere della stessa serie.
function chains(items, same) {
  const out = [];
  for (const it of [...items].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    const gapOk = (c) => { const g = daysBetween(c[c.length - 1].date, it.date); return g >= 20 && g <= 40; };
    // La catena più vecchia che può continuare (due piani con lo stesso importo restano separati).
    const c = out.find((x) => gapOk(x) && same(x[x.length - 1], it));
    if (c) c.push(it);
    else out.push([it]);
  }
  return out;
}

// opts.lookbackDays: quanto indietro guardare (circa 13 mesi).
// opts.schedules: le operazioni programmate. Le rate registrate da una programmazione con un numero di rate o
// una data di fine (come quella creata con "Programma") fanno parte del piano; se l'ultima rata viene da una
// programmazione conclusa, il piano è finito. Quelle senza fine (abbonamenti) restano fuori.
// Restituisce i piani (in corso e conclusi), dal più recente.
export function detectInstalments(transactions, today, { lookbackDays = 400, schedules = [] } = {}) {
  const from = addDays(today, -lookbackDays);
  const finite = new Map((schedules || []).filter((s) => s.endMode === "Numero di rate" || s.endMode === "Data di fine").map((s) => [s.id, s]));
  const bnpl = [], tax = [];
  for (const t of transactions || []) {
    if (t.kind !== "Uscita" || !t.date || t.date < from || t.date > today || t.pacId || t.loanId || t.cardPaymentFor) continue;
    if (t.scheduleId && !finite.has(t.scheduleId)) continue;
    const amount = toNum(t.amount);
    if (!(amount > 0)) continue;
    const p = instalmentProvider(t.description);
    if (!p) continue;
    const it = { id: t.id, date: t.date, amount, via: via(t), provider: p.label, accountId: t.cardId ? "" : t.accountId || "", cardId: t.cardId || "", scheduleId: t.scheduleId || "" };
    (p.type === "tax" ? tax : bnpl).push(it);
  }
  const ended = (last) => !!last.scheduleId && finite.get(last.scheduleId).status === "Concluso";
  const plans = [];
  // Paga in 3: stesso mezzo di pagamento e stesso importo (al centesimo, con 2 centesimi di tolleranza).
  for (const c of chains(bnpl, (a, b) => a.via === b.via && Math.abs(a.amount - b.amount) <= 0.021)) {
    if (c.length < 2 || c.length > BNPL_TOTAL) continue; // un solo pagamento non è una serie; quattro o più sono un abbonamento
    const last = c[c.length - 1];
    const paid = c.length;
    const open = paid < BNPL_TOTAL && daysBetween(last.date, today) <= 40 && !ended(last);
    plans.push(plan("bnpl", c, { label: `${last.provider} in ${BNPL_TOTAL} rate`, total: BNPL_TOTAL, remaining: open ? BNPL_TOTAL - paid : 0, open }));
  }
  // Rateizzazioni fiscali: importo entro il 5% della serie, da qualunque conto.
  for (const c of chains(tax, (a, b) => Math.abs(a.amount - b.amount) <= Math.max(1, a.amount * 0.05))) {
    if (c.length < 2) continue;
    const last = c[c.length - 1];
    const open = daysBetween(last.date, today) <= 40 && !ended(last);
    plans.push(plan("tax", c, { label: "Rateizzazione Agenzia delle Entrate-Riscossione", total: null, remaining: null, open }));
  }
  return plans.sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
}

// Le rateizzazioni durano anni: quando le prime rate escono dalla finestra di ricerca cambiano la data
// d'inizio e un po' l'importo mediano. Per questo la chiave non ha la data e un piano ignorato si riconosce
// anche da una chiave con un importo simile.
const keyAmount = (k) => Number(String(k).split("|")[2]);
export function planMatchesKey(p, key) {
  if (key === p.key) return true;
  if (p.type !== "tax" || !String(key).startsWith("tax|")) return false;
  return Math.abs(keyAmount(key) - p.amount) <= Math.max(1, p.amount * 0.05);
}
export const planIgnored = (p, keys) => (Array.isArray(keys) ? keys : []).some((k) => planMatchesKey(p, k));

function plan(type, chain, extra) {
  const first = chain[0], last = chain[chain.length - 1];
  const amount = round(type === "tax" ? median(chain.map((x) => x.amount)) : last.amount, 2);
  return {
    key: type === "tax" ? `tax||${amount.toFixed(2)}` : `${type}|${last.via}|${amount.toFixed(2)}|${first.date}`,
    type,
    provider: last.provider,
    amount,
    paid: chain.length,
    first: first.date,
    last: last.date,
    next: addMonths(last.date, 1),
    accountId: last.accountId,
    cardId: last.cardId,
    txIds: chain.map((x) => x.id),
    ...extra,
    // Quanto resta da pagare (solo per i piani di cui si conosce il numero di rate).
    left: extra.remaining ? round(extra.remaining * amount, 2) : 0,
  };
}

// Un piano già programmato dall'utente: un'operazione programmata attiva con lo stesso importo e lo stesso
// mezzo di pagamento (per le rateizzazioni basta l'importo simile e una descrizione che ne parli).
export function instalmentCovered(p, schedules) {
  return (schedules || []).some((s) => {
    if (s.type !== "expense" || s.status === "Concluso" || s.status === "In pausa") return false;
    const a = toNum(s.amount);
    if (p.type === "tax") return Math.abs(a - p.amount) <= Math.max(1, p.amount * 0.05) && (TAX.test(s.description || "") || TAX.test(s.category || "") || s.category === "Tasse");
    const pay = p.cardId ? `card:${p.cardId}` : `account:${p.accountId}`;
    return Math.abs(a - p.amount) <= 0.021 && String(s.payWith || "") === pay;
  });
}

// Date delle rate ancora attese entro "end": quelle rimaste dei Paga in 3, ogni mese per le rateizzazioni.
// Una rata già scaduta e non ancora registrata conta domani.
export function instalmentDates(p, today, end) {
  if (!p.open) return [];
  const out = [];
  let date = p.next;
  const max = p.type === "tax" ? 24 : p.remaining || 0;
  for (let k = 0; k < max; k++, date = addMonths(p.next, k)) {
    const d = date <= today ? addDays(today, 1) : date;
    if (d > end) break;
    out.push(d);
  }
  return out;
}
