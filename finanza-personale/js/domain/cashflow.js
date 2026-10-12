import { addMonthsYm, daysInMonth, firstDay, lastDay } from "../lib/dates.js";
import { toNum } from "../lib/format.js";
import { INVEST_CATEGORY, cardEffect } from "./finance.js";
import { isRepayment, owedPart } from "./people.js";

// I giroconti spostano denaro tra conti propri: non sono né entrate né uscite.
export const isTransfer = (t) => t.kind === "Giroconto";

// Per ogni addebito di carta sul conto: la parte già registrata come spese sulla carta nel periodo
// che l'addebito paga (cycleFrom escluso, cycleTo incluso), al netto dei rimborsi. Si calcola ogni
// volta dai movimenti, così resta giusta anche se le spese della carta arrivano dopo (es. da un
// estratto conto importato). Più addebiti dello stesso periodo se la dividono in ordine di data.
const sharesCache = new WeakMap();

export function cardPaymentShares(transactions) {
  const cached = sharesCache.get(transactions);
  if (cached) return cached;
  const shares = new Map();
  const groups = new Map();
  for (const t of transactions) {
    if (!t.cardPaymentFor || !t.cycleTo) continue;
    const key = `${t.cardPaymentFor}|${t.cycleFrom || ""}|${t.cycleTo}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  for (const list of groups.values()) {
    const { cardPaymentFor: cardId, cycleTo } = list[0];
    const cycleFrom = list[0].cycleFrom || "";
    let left = 0;
    for (const t of transactions) {
      if (!t.date || t.date <= cycleFrom || t.date > cycleTo) continue;
      const sign = cardEffect(t, cardId);
      if (sign && !(t.kind === "Giroconto" && sign < 0)) left += sign * toNum(t.amount);
    }
    left = Math.max(0, left);
    list.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || (a.createdAt || 0) - (b.createdAt || 0));
    for (const p of list) {
      const part = Math.min(Math.max(0, toNum(p.amount)), left);
      shares.set(p.id, part);
      left -= part;
    }
  }
  sharesCache.set(transactions, shares);
  return shares;
}

// Spesa effettiva di un'uscita: dall'addebito della carta si toglie la parte già registrata
// come spese sulla carta, così nessuna spesa viene contata due volte.
export function expenseAmount(t, shares) {
  const part = t.cardPaymentFor && shares ? shares.get(t.id) || 0 : 0;
  return Math.max(0, toNum(t.amount) - part);
}

// Quanto di un'uscita è davvero una tua spesa: senza la parte che un'altra persona ti deve restituire.
// Vale per entrate/uscite e budget; i saldi e la previsione restano sui soldi che si muovono davvero.
export function ownCost(t, shares) {
  return Math.max(0, expenseAmount(t, shares) - owedPart(t));
}

// Le restituzioni (entrate con una persona) chiudono un credito: non sono entrate.
export { isRepayment };

function sortedEntries(map) {
  return [...map.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
}

export function flowTotals(transactions, from, to) {
  let income = 0, expense = 0, count = 0;
  let largest = null, largestAmt = 0;
  const inc = new Map(), exp = new Map();
  const shares = cardPaymentShares(transactions);
  for (const t of transactions) {
    if (!t.date || t.date < from || t.date > to || isTransfer(t) || isRepayment(t)) continue;
    if (t.kind === "Entrata") {
      const amt = toNum(t.amount);
      const cat = t.category || "Altre entrate";
      income += amt;
      inc.set(cat, (inc.get(cat) || 0) + amt);
    } else {
      const amt = ownCost(t, shares);
      if (amt < 0.005) continue;
      const cat = t.category || "Altro";
      expense += amt;
      exp.set(cat, (exp.get(cat) || 0) + amt);
      if (!largest || amt > largestAmt) { largest = t; largestAmt = amt; }
    }
    count++;
  }
  const net = income - expense;
  return {
    income, expense, net, count, largest,
    savingsRate: income > 0 ? (net / income) * 100 : null,
    byIncome: sortedEntries(inc),
    byExpense: sortedEntries(exp),
  };
}

export function monthTotals(transactions, ym) {
  return flowTotals(transactions, firstDay(ym), lastDay(ym));
}

export function monthlySeries(transactions, endYm, months) {
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const ym = addMonthsYm(endYm, -i);
    const t = monthTotals(transactions, ym);
    out.push({ ym, income: t.income, expense: t.expense, net: t.net });
  }
  return out;
}

// Spesa cumulata giorno per giorno nel mese (fino a "uptoDay" se indicato).
export function cumulativeSpending(transactions, ym, uptoDay) {
  const days = daysInMonth(ym);
  const daily = new Array(days).fill(0);
  const shares = cardPaymentShares(transactions);
  for (const t of transactions) {
    if (t.kind !== "Uscita" || !t.date || t.date.slice(0, 7) !== ym) continue;
    const d = Number(t.date.slice(8, 10));
    if (d >= 1 && d <= days) daily[d - 1] += ownCost(t, shares);
  }
  const limit = uptoDay ? Math.min(uptoDay, days) : days;
  const out = [];
  let sum = 0;
  for (let i = 0; i < limit; i++) {
    sum += daily[i];
    out.push(sum);
  }
  return out;
}

// Modello per il diagramma di Sankey: categorie di entrata → Entrate → categorie di uscita (+ risparmio).
// Se le uscite superano le entrate, la differenza arriva dai risparmi. Ogni voce sa quali categorie
// rappresenta (cats): le più piccole si raccolgono in "Altre entrate"/"Altre uscite", o nella categoria
// con quel nome se è già tra le maggiori.
export function sankeyModel(totals, maxPerSide = 6) {
  const fold = (rows, otherLabel) => {
    const nodes = rows.map((r) => ({ ...r, cats: [r.name] }));
    if (nodes.length <= maxPerSide) return nodes;
    const head = nodes.slice(0, maxPerSide - 1);
    const tail = nodes.slice(maxPerSide - 1);
    const rest = tail.reduce((s, r) => s + r.amount, 0);
    const same = head.find((r) => r.name === otherLabel);
    if (same) return head.map((r) => (r === same ? { ...r, amount: r.amount + rest, cats: [...r.cats, ...tail.map((x) => x.name)] } : r));
    return [...head, { name: otherLabel, amount: rest, cats: tail.map((x) => x.name) }];
  };
  const sources = fold(totals.byIncome.filter((r) => r.amount > 0), "Altre entrate").map((r) => ({ ...r, kind: "income" }));
  const targets = fold(totals.byExpense.filter((r) => r.amount > 0), "Altre uscite").map((r) => ({ ...r, kind: r.cats.length === 1 && r.cats[0] === INVEST_CATEGORY ? "invest" : "expense" }));
  if (totals.net > 0.005) targets.push({ name: "Risparmio", amount: totals.net, kind: "saving", cats: [] });
  if (totals.net < -0.005) sources.push({ name: "Dai risparmi", amount: -totals.net, kind: "deficit", cats: [] });
  const hub = Math.max(totals.income, totals.expense);
  return { sources, targets, hub };
}

// Movimenti di un periodo che compongono una voce del flusso (kind "income" o "expense", categorie cats),
// con l'importo che vi contano: degli addebiti delle carte solo la parte non già registrata sulla carta.
export function flowItems(transactions, from, to, kind, cats) {
  const want = new Set(cats);
  const shares = cardPaymentShares(transactions);
  const out = [];
  for (const t of transactions) {
    if (!t.date || t.date < from || t.date > to || isTransfer(t) || isRepayment(t)) continue;
    const income = t.kind === "Entrata";
    if (income !== (kind === "income")) continue;
    const cat = t.category || (income ? "Altre entrate" : "Altro");
    if (!want.has(cat)) continue;
    const amount = income ? toNum(t.amount) : ownCost(t, shares);
    if (!income && amount < 0.005) continue;
    out.push({ t, cat, amount });
  }
  return out.sort((a, b) => (a.t.date < b.t.date ? 1 : a.t.date > b.t.date ? -1 : 0));
}
