import { addDays, addMonths, daysBetween, daysInMonth, pad2, perMonth } from "../lib/dates.js";
import { round, toNum } from "../lib/format.js";

// Spese ed entrate ricorrenti trovate nei movimenti: stesso esercente (o, per le entrate, stessa categoria),
// importo simile e cadenza regolare. Solo lettura: non scrive nulla. Servono per proporre nuove operazioni
// programmate e per la previsione del saldo.

const NOISE = new Set([
  "pagamento", "pagam", "addebito", "addeb", "sdd", "pos", "carta", "card", "acquisto", "acq", "di", "del", "della", "dei", "da",
  "il", "la", "lo", "le", "per", "con", "su", "in", "nr", "presso", "bonifico", "sepa", "direct", "debit", "online", "www", "com",
  "it", "srl", "spa", "eur", "euro", "op", "rif", "ns", "vs", "favore", "ordine", "disposizione",
]);
const MONTHS = new Set([
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
  "gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic",
]);

// Chiave dell'esercente: le prime due parole significative della descrizione (senza numeri, mesi e parole di servizio).
export function merchantKey(desc) {
  const words = String(desc || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]+/g, " ")
    .split(/\s+/).filter((w) => w.length > 1 && !NOISE.has(w) && !MONTHS.has(w));
  return words.slice(0, 2).join(" ");
}

// Cadenze riconosciute: giorni nominali e intervallo accettato per la mediana degli intervalli.
const CADENCES = [
  { frequency: "Settimanale", days: 7, min: 5, max: 9, minCount: 4 },
  { frequency: "Ogni 2 settimane", days: 14, min: 12, max: 17, minCount: 3 },
  { frequency: "Mensile", days: 30.44, min: 25, max: 36, minCount: 3 },
  { frequency: "Bimestrale", days: 60.9, min: 55, max: 70, minCount: 3 },
  { frequency: "Trimestrale", days: 91.3, min: 80, max: 100, minCount: 3 },
];

const median = (list) => {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mostCommon = (list) => {
  const n = new Map();
  for (const x of list) n.set(x, (n.get(x) || 0) + 1);
  let best = null, bestN = 0;
  for (const [x, c] of n) if (c > bestN) { best = x; bestN = c; }
  return best;
};

// Movimenti che non contano: generati dall'app (programmate, PAC, rate), addebiti delle carte, giroconti.
export function isCandidate(t) {
  return !!t.date && (t.kind === "Uscita" || t.kind === "Entrata") && !t.scheduleId && !t.pacId && !t.loanId && !t.cardPaymentFor;
}

// Divide gli importi di un esercente in gruppi di valore simile (es. due abbonamenti Apple di prezzo diverso).
function clusterByAmount(items) {
  const sorted = [...items].sort((a, b) => a.amount - b.amount);
  const groups = [];
  for (const it of sorted) {
    const g = groups[groups.length - 1];
    if (g && it.amount <= median(g.map((x) => x.amount)) * 1.2 + 0.5) g.push(it);
    else groups.push([it]);
  }
  return mergeSequential(groups);
}

// Gruppi di importo che si susseguono nel tempo (il vecchio prezzo finisce e il nuovo comincia circa una
// cadenza dopo) sono la stessa spesa con un cambio di prezzo, non due abbonamenti diversi. Un solo pagamento
// al prezzo nuovo conta solo se cade alla scadenza attesa e non è di tutt'altro importo (un acquisto a parte
// presso lo stesso esercente non è un aumento). keyAmount ricorda il prezzo del primo gruppo: la chiave della
// ricorrenza resta la stessa anche dopo il cambio.
function mergeSequential(groups) {
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const sorted = groups.map((g) => [...g].sort(byDate)).sort((a, b) => byDate(a[0], b[0]));
  const out = [];
  for (const g of sorted) {
    const prev = out.find((p) => {
      if (p.length < 2 || !(g[0].date > p[p.length - 1].date)) return false;
      const gaps = [];
      for (let i = 1; i < p.length; i++) gaps.push(daysBetween(p[i - 1].date, p[i].date));
      const step = median(gaps.filter((x) => x > 0));
      const gap = daysBetween(p[p.length - 1].date, g[0].date);
      if (!(step > 0)) return false;
      if (g.length === 1) {
        // Un cambio forte (fine di una promozione, piano più economico) solo se cade proprio alla scadenza.
        const ratio = g[0].amount / p[p.length - 1].amount;
        return gap >= step * 0.8 && gap <= step * 1.25 && ((ratio >= 0.5 && ratio <= 2) || (gap >= step * 0.9 && gap <= step * 1.1 && ratio >= 0.2 && ratio <= 5));
      }
      return gap >= step * 0.6 && gap <= step * 1.45;
    });
    if (prev) {
      if (prev.keyAmount == null) prev.keyAmount = median(prev.map((x) => x.amount));
      prev.push(...g);
    } else out.push(g);
  }
  return out;
}

// Giorno tipico del mese: il 31 e l'1 sono vicini, quindi per i pagamenti a cavallo del mese i giorni fino al
// 15 valgono +31 (si usa questa versione solo se raggruppa meglio i giorni).
function typicalDay(dates) {
  const days = dates.map((d) => Number(d.slice(8, 10)));
  const wrapped = days.map((d) => (d <= 15 ? d + 31 : d));
  const spread = (list) => { const m = median(list); return list.reduce((acc, x) => acc + Math.abs(x - m), 0); };
  let day = Math.round(median(spread(wrapped) < spread(days) ? wrapped : days));
  if (day > 31) day -= 31;
  return Math.max(1, day);
}

// Prossima data attesa dopo "last", con la cadenza trovata. Per le mensili: lo stesso giorno del mese, contando
// dal mese a cui appartiene l'ultimo pagamento (l'affitto del 1° pagato il 31 vale per il mese dopo; uno del 30
// pagato il 1° vale per il mese prima), così nessuna scadenza si ripete o salta.
function nextAfter(last, cadence, dayOfMonth) {
  if (cadence.frequency === "Mensile" || cadence.frequency === "Bimestrale" || cadence.frequency === "Trimestrale") {
    const step = cadence.frequency === "Mensile" ? 1 : cadence.frequency === "Bimestrale" ? 2 : 3;
    const at = (ym) => `${ym}-${pad2(Math.min(dayOfMonth, daysInMonth(ym)))}`;
    const base = `${last.slice(0, 7)}-01`;
    let ref = last.slice(0, 7);
    for (const k of [-1, 1]) {
      const ym = addMonths(base, k).slice(0, 7);
      if (Math.abs(daysBetween(last, at(ym))) < Math.abs(daysBetween(last, at(ref)))) ref = ym;
    }
    return at(addMonths(`${ref}-01`, step).slice(0, 7));
  }
  return addDays(last, Math.round(cadence.days));
}

function evaluate(group, today, meta) {
  const dates = group.map((x) => x.date).sort();
  const months = new Set(dates.map((d) => d.slice(0, 7)));
  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
  const g = median(gaps.filter((x) => x > 0));
  const cadence = CADENCES.find((c) => g >= c.min && g <= c.max);
  if (!cadence || dates.length < cadence.minCount) return null;
  if (cadence.days >= 25 && months.size < 3) return null;
  // Regolarità: la maggior parte degli intervalli vicina alla cadenza (un mese saltato è ammesso).
  const ok = gaps.filter((x) => (x >= cadence.days * 0.6 && x <= cadence.days * 1.45) || (x >= cadence.days * 1.6 && x <= cadence.days * 2.4)).length;
  if (ok < gaps.length * 0.7) return null;
  const last = dates[dates.length - 1];
  if (daysBetween(last, today) > cadence.days * 1.6 + 7) return null;
  const byDate = [...group].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const amounts = byDate.map((x) => x.amount);
  const lastAmount = amounts[amounts.length - 1];
  const prev = amounts.slice(0, -1);
  const before = prev.length ? median(prev.slice(-3)) : lastAmount;
  // Cambio di prezzo (solo per le spese): almeno 30 centesimi e oltre il 3%, dalla data del primo pagamento
  // al prezzo nuovo. Da lì vale il prezzo nuovo.
  const differs = (a, b) => { const d = round(Math.abs(a - b), 2); return d >= 0.3 && d / b > 0.03; };
  let change = null;
  if (meta.kind === "Uscita" && prev.length && differs(lastAmount, before)) {
    let since = amounts.length - 1;
    while (since > 0 && !differs(lastAmount, amounts[since - 1])) since--;
    // Un importo già pagato prima non è un prezzo nuovo: è una spesa che varia (14, 15, 14, 15...).
    if (!amounts.slice(0, since).some((a) => !differs(lastAmount, a))) change = { from: round(before, 2), to: round(lastAmount, 2), date: byDate[since].date };
  }
  const amount = round(change ? lastAmount : median(amounts.slice(-3)), 2);
  // Giorno tipico dagli ultimi tre pagamenti: se il giorno dell'addebito cambia (dal 23 al 2), la data prevista lo segue.
  const dayOfMonth = typicalDay(dates.slice(-3));
  return {
    ...meta,
    frequency: cadence.frequency,
    period: cadence.days,
    amount,
    monthly: round(perMonth(amount, cadence.frequency), 2),
    yearly: round(perMonth(amount, cadence.frequency) * 12, 2),
    count: dates.length,
    first: dates[0],
    last,
    next: nextAfter(last, cadence, dayOfMonth),
    dayOfMonth,
    change,
    txIds: byDate.map((x) => x.id),
  };
}

// Le entrate (es. lo stipendio) si raggruppano per categoria e si sommano per mese: acconti e saldi,
// tredicesima e quattordicesima non spezzano la cadenza. Le extra si trovano a parte (extraIncome).
function incomeGroups(list) {
  const groups = new Map();
  for (const t of list) {
    const key = `${t.category || "Altre entrate"}|${t.accountId || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  return groups;
}

// opts.lookbackDays: quanto indietro guardare (default circa 13 mesi).
export function detectRecurring(transactions, today, { lookbackDays = 400 } = {}) {
  const from = addDays(today, -lookbackDays);
  const list = (transactions || []).filter((t) => isCandidate(t) && t.date >= from && t.date <= today && toNum(t.amount) > 0);
  const out = [];
  // Uscite: per esercente e mezzo di pagamento, poi per importo simile.
  const byMerchant = new Map();
  for (const t of list) {
    if (t.kind !== "Uscita") continue;
    const key = merchantKey(t.description);
    if (!key) continue;
    const via = t.cardId ? `card:${t.cardId}` : `account:${t.accountId || ""}`;
    const k = `${key}|${via}`;
    if (!byMerchant.has(k)) byMerchant.set(k, []);
    byMerchant.get(k).push({ id: t.id, date: t.date, amount: toNum(t.amount), t });
  }
  for (const [k, items] of byMerchant) {
    const [key] = k.split("|");
    for (const group of clusterByAmount(items)) {
      if (group.length < 3) continue;
      const ts = group.map((x) => x.t);
      // Chiave stabile: l'importo tipico in euro (in centesimi sotto 2,50 €, dove due prezzi si confonderebbero);
      // dopo un cambio di prezzo resta quello di prima.
      const m = group.keyAmount ?? median(group.map((x) => x.amount));
      const r = evaluate(group, today, {
        key: `${k}|${round(m, m < 2.5 ? 2 : 0)}`,
        merchant: key,
        kind: "Uscita",
        label: mostCommon(ts.map((t) => String(t.description || "").trim())) || key,
        category: mostCommon(ts.map((t) => t.category || "Altro")),
        accountId: ts[0].cardId ? "" : ts[0].accountId || "",
        cardId: ts[0].cardId || "",
      });
      if (r) out.push(r);
    }
  }
  // Entrate: per categoria e conto, sommate per mese.
  for (const [k, ts] of incomeGroups(list.filter((t) => t.kind === "Entrata"))) {
    const byMonth = new Map();
    for (const t of ts) {
      const m = t.date.slice(0, 7);
      const e = byMonth.get(m) || { month: m, amount: 0, items: [] };
      e.amount += toNum(t.amount);
      e.items.push({ id: t.id, date: t.date, amount: toNum(t.amount) });
      byMonth.set(m, e);
    }
    const monthly = [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
    if (monthly.length < 3) continue;
    const typical = median(monthly.map((e) => e.amount));
    // La data del mese è quella del pagamento principale (il più vicino all'importo tipico; a parità il primo).
    const group = monthly.map((e) => {
      const main = [...e.items].sort((a, b) => Math.abs(a.amount - typical) - Math.abs(b.amount - typical) || (a.date < b.date ? -1 : 1))[0];
      return { id: main.id, date: main.date, month: e.month, amount: Math.min(e.amount, typical * 1.3) };
    });
    // Mese in corso incompleto (solo un acconto e il giorno solito non ancora arrivato): il saldo è ancora atteso.
    // Quanto è già arrivato quel mese conta: la prossima entrata prevista è solo il resto (nextAmount).
    // Il mese è incompleto finché non arriva il giorno solito dell'ultimo pagamento del mese (vale anche quando
    // l'acconto è la parte più grande).
    const cur = group[group.length - 1];
    const usual = median(monthly.slice(0, -1).map((e) => Math.max(...e.items.map((x) => Number(x.date.slice(8, 10))))));
    let received = 0;
    if (cur.month === today.slice(0, 7) && cur.amount < typical * 0.6 && Number(today.slice(8, 10)) < usual) {
      received = byMonth.get(cur.month).amount;
      group.pop();
    }
    if (group.length < 3) continue;
    // Importi stabili (variazione entro il 35% della media): lo stipendio sì, i versamenti saltuari di contanti no
    // (quelli restano nella media delle entrate non regolari della previsione).
    const vals = group.map((x) => x.amount);
    const mean = vals.reduce((acc, v) => acc + v, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / vals.length);
    if (!(mean > 0) || sd / mean > 0.35) continue;
    const [category, accountId] = k.split("|");
    const r = evaluate(group, today, { key: `in|${k}`, merchant: category.toLowerCase(), kind: "Entrata", label: category, category, accountId, cardId: "" });
    // nextAmountDate: se la data del pagamento principale è già passata, il resto arriva il giorno solito dell'ultimo.
    const ym = today.slice(0, 7);
    const rest = r && received > 0 && r.next.slice(0, 7) === ym;
    const restDate = rest && r.next <= today ? `${ym}-${pad2(Math.min(Math.round(usual), daysInMonth(ym)))}` : null;
    if (r) out.push({ ...r, txIds: ts.map((t) => t.id), ...(rest ? { nextAmount: round(Math.max(0, r.amount - received), 2) } : {}), ...(restDate ? { nextAmountDate: restDate } : {}) });
  }
  return out.sort((a, b) => b.yearly - a.yearly);
}

// Ricorrenze già coperte da qualcosa che l'app registra da sola: un'operazione programmata attiva e simile
// o la rata automatica di un finanziamento ancora da rimborsare.
export function coveredBy(item, schedules, loans) {
  for (const s of schedules || []) {
    if (s.status === "Concluso" || s.status === "In pausa") continue;
    const kind = s.type === "income" ? "Entrata" : s.type === "expense" ? "Uscita" : "";
    if (kind !== item.kind) continue;
    const pay = String(s.payWith || "");
    const sameVia = item.cardId ? pay === `card:${item.cardId}` : pay === `account:${item.accountId}`;
    const sameName = merchantKey(s.description) === item.merchant || (item.kind === "Entrata" && s.category === item.category);
    if (sameVia && sameName && Math.abs(toNum(s.amount) - item.amount) <= Math.max(1, item.amount * 0.2)) return { type: "schedule", id: s.id };
  }
  for (const l of loans || []) {
    if (!l.accountId || !l.nextDate || !(toNum(l.monthlyPayment) > 0) || toNum(l.remaining) <= 0.005 || item.kind !== "Uscita" || item.accountId !== l.accountId) continue;
    if (Math.abs(toNum(l.monthlyPayment) - item.amount) <= Math.max(5, item.amount * 0.05)) return { type: "loan", id: l.id };
  }
  return null;
}

// Entrate extra rispetto a quella tipica del mese (tredicesima, quattordicesima): l'eccedenza e la data
// dell'ultimo pagamento del mese. Servono alla previsione per riproporle l'anno dopo.
export function extraIncome(transactions, item) {
  if (!item || item.kind !== "Entrata") return [];
  const ids = new Set(item.txIds);
  const byMonth = new Map();
  for (const t of transactions || []) {
    if (!ids.has(t.id)) continue;
    const m = t.date.slice(0, 7);
    const e = byMonth.get(m) || { amount: 0, last: "" };
    e.amount += toNum(t.amount);
    if (t.date > e.last) e.last = t.date;
    byMonth.set(m, e);
  }
  const out = [];
  for (const [month, e] of byMonth) {
    const extra = e.amount - item.amount;
    if (extra > item.amount * 0.4) out.push({ month, date: e.last, amount: round(extra, 2) });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Esercenti dove si spende più spesso negli ultimi 12 mesi (almeno 6 pagamenti): per capire cosa c'è dentro
// categorie larghe come "Acquisti online". Esclusi giroconti, addebiti delle carte e movimenti generati dall'app.
export function topMerchants(transactions, today, { min = 6, limit = 8 } = {}) {
  const from = addDays(today, -365);
  const by = new Map();
  for (const t of transactions || []) {
    if (!isCandidate(t) || t.kind !== "Uscita" || t.date <= from || t.date > today) continue;
    const key = merchantKey(t.description);
    if (!key) continue;
    const e = by.get(key) || { key, labels: [], categories: [], count: 0, total: 0 };
    e.labels.push(String(t.description || "").trim());
    e.categories.push(t.category || "Altro");
    e.count++;
    e.total += toNum(t.amount);
    by.set(key, e);
  }
  return [...by.values()]
    .filter((e) => e.count >= min)
    .map((e) => ({ key: e.key, label: mostCommon(e.labels) || e.key, category: mostCommon(e.categories), count: e.count, total: round(e.total, 2), average: round(e.total / e.count, 2) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}
