import { addMonthsYm, daysInMonth, firstDay, lastDay } from "../lib/dates.js";
import { round, toNum } from "../lib/format.js";
import { cardPaymentShares, ownCost } from "./cashflow.js";
import { LOAN_CATEGORY } from "./loans.js";
import { CARD_CATEGORY } from "./cards.js";
import { INVEST_CATEGORY } from "./finance.js";

// Le rate dei finanziamenti sono un impegno fisso, non una spesa da tenere sotto controllo: restano fuori
// dal budget (contano invece nel flusso di cassa). Vale per le rate automatiche e per la loro categoria.
export const outOfBudget = (t) => !!t.loanId || t.category === LOAN_CATEGORY;

export function budgetStatus(budget, spent) {
  if (!(budget > 0)) return spent > 0 ? "none" : "empty";
  const pct = (spent / budget) * 100;
  if (pct > 100) return "over";
  if (pct >= 85) return "warn";
  return "ok";
}

const median = (list) => {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Spesa per categoria e mese (stesse regole del budget: niente rate, addebiti carta al netto).
function spendingByMonth(transactions, months) {
  const want = new Set(months);
  const shares = cardPaymentShares(transactions);
  const by = new Map();
  for (const t of transactions) {
    if (t.kind !== "Uscita" || !t.date || !want.has(t.date.slice(0, 7)) || outOfBudget(t)) continue;
    const amt = ownCost(t, shares);
    if (amt < 0.005) continue;
    const cat = t.category || "Altro";
    if (!by.has(cat)) by.set(cat, []);
    by.get(cat).push({ month: t.date.slice(0, 7), day: Number(t.date.slice(8, 10)), amount: amt });
  }
  return by;
}

// Righe del budget di un mese: una per categoria di uscita, più le spese in categorie sconosciute.
// Per il mese in corso "projected" è la spesa prevista a fine mese: quanto speso finora più quanto si
// spende di solito nei giorni che restano (media degli ultimi 3 mesi interi, stessi giorni del mese).
export function budgetMonth(categories, transactions, ym, today) {
  const from = firstDay(ym), to = lastDay(ym);
  const spentBy = new Map();
  const futureBy = new Map();
  const shares = cardPaymentShares(transactions);
  const current = !!today && today.slice(0, 7) === ym;
  let excluded = 0;
  for (const t of transactions) {
    if (t.kind !== "Uscita" || !t.date || t.date < from || t.date > to) continue;
    const amt = ownCost(t, shares);
    if (amt < 0.005) continue;
    if (outOfBudget(t)) { excluded += amt; continue; }
    const cat = t.category || "Altro";
    spentBy.set(cat, (spentBy.get(cat) || 0) + amt);
    if (current && t.date > today) futureBy.set(cat, (futureBy.get(cat) || 0) + amt);
  }
  for (const [k, v] of spentBy) spentBy.set(k, round(v, 2));
  const dayNow = current ? Number(today.slice(8, 10)) : 0;
  const monthDays = daysInMonth(ym);
  const past = current ? [1, 2, 3].map((i) => addMonthsYm(ym, -i)) : [];
  const history = current ? spendingByMonth(transactions, past) : new Map();
  // Spesa solita nei giorni che restano: i giorni che questo mese non ha valgono come il suo ultimo giorno
  // (l'affitto pagato il 31 a febbraio si paga il 28).
  const typicalRest = (name) => {
    const list = history.get(name) || [];
    return list.filter((x) => Math.min(x.day, monthDays) > dayNow).reduce((s, x) => s + x.amount, 0) / 3;
  };
  // Le spese già registrate con data futura nel mese contano una volta sola: o quelle o la spesa solita.
  const row = (id, name, emoji, budget, spent) => {
    const future = futureBy.get(name) || 0;
    const projected = current ? round(spent - future + Math.max(future, typicalRest(name)), 2) : null;
    return { id, name, emoji, budget, spent, remaining: budget - spent, pct: budget > 0 ? (spent / budget) * 100 : null, status: budgetStatus(budget, spent), projected, atRisk: budget > 0 && projected != null && projected > budget && spent <= budget };
  };
  const rows = [];
  const seen = new Set();
  for (const c of categories) {
    if (c.kind === "Entrata" || c.name === LOAN_CATEGORY) continue;
    seen.add(c.name);
    rows.push(row(c.id, c.name, c.emoji, toNum(c.budget), spentBy.get(c.name) || 0));
  }
  for (const [name, spent] of spentBy) {
    if (seen.has(name)) continue;
    rows.push(row(null, name, null, 0, spent));
  }
  const budgeted = rows.filter((r) => r.budget > 0);
  const totalBudget = budgeted.reduce((s, r) => s + r.budget, 0);
  const spentBudgeted = budgeted.reduce((s, r) => s + r.spent, 0);
  const spentAll = rows.reduce((s, r) => s + r.spent, 0);
  const days = daysInMonth(ym);
  let daysLeft = null;
  if (current) daysLeft = days - dayNow + 1;
  const remaining = totalBudget - spentBudgeted;
  return {
    rows: rows.sort((a, b) => (b.budget > 0) - (a.budget > 0) || b.spent - a.spent || a.name.localeCompare(b.name, "it")),
    totalBudget, spentBudgeted, spentAll, remaining, daysLeft, excluded,
    projectedBudgeted: current ? round(budgeted.reduce((s, r) => s + r.projected, 0), 2) : null,
    projectedAll: current ? round(rows.reduce((s, r) => s + r.projected, 0), 2) : null,
    perDay: daysLeft && remaining > 0 ? remaining / daysLeft : null,
  };
}

// Budget suggeriti: per ogni categoria di spesa presente in almeno 4 degli ultimi 6 mesi interi, la spesa
// tipica (la maggiore tra mediana e media, così le categorie a sbalzi non sforano sempre) arrotondata ai 10 €
// sopra. Restano fuori rate, addebiti delle carte e versamenti negli investimenti, che non sono spese da contenere.
export function suggestBudgets(categories, transactions, today, months = 6) {
  const ym = today.slice(0, 7);
  const list = Array.from({ length: months }, (_, i) => addMonthsYm(ym, -(i + 1)));
  const by = spendingByMonth(transactions, list);
  const out = [];
  for (const c of categories) {
    if (c.kind === "Entrata" || [LOAN_CATEGORY, CARD_CATEGORY, INVEST_CATEGORY].includes(c.name)) continue;
    const tx = by.get(c.name);
    if (!tx) continue;
    const totals = list.map((m) => tx.filter((x) => x.month === m).reduce((s, x) => s + x.amount, 0));
    const active = totals.filter((v) => v > 0.005).length;
    if (active < 4) continue;
    const med = round(median(totals), 2);
    const avg = round(totals.reduce((s, v) => s + v, 0) / months, 2);
    out.push({
      id: c.id, name: c.name, emoji: c.emoji, current: toNum(c.budget),
      suggested: Math.max(10, Math.ceil(Math.max(med, avg) / 10) * 10),
      median: med, average: avg, max: round(Math.max(...totals), 2), months: active,
    });
  }
  return out.sort((a, b) => b.suggested - a.suggested);
}
