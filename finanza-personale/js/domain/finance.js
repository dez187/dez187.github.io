import { toNum } from "../lib/format.js";

export const ACCOUNT_TYPES = ["Conto corrente", "Conto deposito", "Contanti", "Carta prepagata", "Altro"];

// Ordine e raggruppamento dei conti nei menu e nella pagina Conti.
export const ACCOUNT_GROUPS = [
  { type: "Conto corrente", label: "Conti correnti", icon: "bank" },
  { type: "Conto deposito", label: "Conti deposito", icon: "vault" },
  { type: "Contanti", label: "Contanti", icon: "cash" },
  { type: "Carta prepagata", label: "Carte prepagate", icon: "card" },
  { type: null, label: "Altri conti", icon: "wallet" },
];

export function accountGroup(type) {
  return ACCOUNT_GROUPS.find((g) => g.type === type) || ACCOUNT_GROUPS[ACCOUNT_GROUPS.length - 1];
}

export function groupAccounts(accounts) {
  const known = ACCOUNT_GROUPS.map((g) => g.type).filter(Boolean);
  return ACCOUNT_GROUPS.map((g) => ({
    ...g,
    rows: accounts.filter((a) => (g.type ? a.type === g.type : !known.includes(a.type))),
  })).filter((g) => g.rows.length);
}

export const CARD_NETWORKS = ["Visa", "Mastercard", "American Express", "Altro"];

// Saldo registrato + movimenti del conto successivi a "saldo aggiornato al" e non futuri.
// Senza data, tutti i movimenti del conto sono considerati non ancora inclusi nel saldo.
export function accountEffectiveBalance(acc, transactions, today) {
  const asOf = acc.balanceDate || "";
  let delta = 0;
  for (const t of transactions) {
    if (!t.date || t.date <= asOf || t.date > today) continue;
    const amt = toNum(t.amount);
    if (t.kind === "Giroconto") {
      if (t.fromAccountId === acc.id) delta -= amt;
      if (t.toAccountId === acc.id) delta += amt;
    } else if (t.accountId && t.accountId === acc.id && !t.cardId) {
      delta += (t.kind === "Entrata" ? 1 : -1) * amt;
    }
  }
  return toNum(acc.balance) + delta;
}

// Effetto di un movimento sullo speso di una carta: le uscite e le ricariche fatte con la carta
// (giroconto "da" carta) lo aumentano, i rimborsi e i pagamenti verso la carta (giroconto "a" carta) lo riducono.
export function cardEffect(t, cardId) {
  if (t.kind === "Giroconto") return t.fromCardId === cardId ? 1 : t.toCardId === cardId ? -1 : 0;
  if (t.cardId !== cardId) return 0;
  return t.kind === "Entrata" ? -1 : 1;
}

// Campi che non valgono più quando un movimento cambia tipo (es. un'uscita che diventa giroconto): si
// svuotano quelli presenti. L'addebito di una carta (cardPaymentFor e periodo) ha senso solo su un'uscita.
const SIDE_FIELDS = ["fromAccountId", "toAccountId", "fromCardId", "toCardId"];
const CARD_PAYMENT_FIELDS = ["cardPaymentFor", "cycleFrom", "cycleTo"];
export function staleTxFields(t, kind) {
  // Un giroconto non è con una persona né di un viaggio (il suo modulo non ha quei campi); un'entrata non ha
  // una parte da restituire.
  const keys = kind === "Giroconto" ? ["accountId", "cardId", ...CARD_PAYMENT_FIELDS, "person", "owed", "tag"] : kind === "Entrata" ? [...SIDE_FIELDS, ...CARD_PAYMENT_FIELDS, "owed"] : SIDE_FIELDS;
  return Object.fromEntries(keys.filter((k) => t[k]).map((k) => [k, ""]));
}

// Colore dell'importo di un movimento: entrate "pos" (verde), giroconti "xfer" (azzurro), versamenti negli
// investimenti "inv" (arancione: PAC e categoria Investimenti), tutte le altre uscite "out" (rosso).
export const INVEST_CATEGORY = "Investimenti";
export function txTone(t) {
  if (t.kind === "Entrata") return "pos";
  if (t.kind === "Giroconto") return "xfer";
  return t.pacId || t.category === INVEST_CATEGORY ? "inv" : "out";
}

// Stessa logica dei conti per le carte.
export function cardEffectiveSpent(card, transactions, today) {
  const asOf = card.spentDate || "";
  let delta = 0;
  for (const t of transactions) {
    if (!t.date || t.date <= asOf || t.date > today) continue;
    const sign = cardEffect(t, card.id);
    if (sign) delta += sign * toNum(t.amount);
  }
  return toNum(card.spent) + delta;
}

export const HOLDING_CLASSES = [
  { key: "etf", label: "ETF", singular: "ETF", series: 1 },
  { key: "stocks", label: "Azioni", singular: "Azione", series: 2 },
  { key: "crypto", label: "Crypto", singular: "Crypto", series: 3 },
];

export const holdingValue = (h) => toNum(h.quantity) * toNum(h.currentPrice);

// Il guadagno si calcola solo sulle posizioni con prezzo di carico noto: un prezzo medio a 0
// significa "non inserito", non "regalato", e gonfierebbe il risultato.
export function classSummary(rows) {
  let value = 0, cost = 0, valueWithCost = 0, missingCost = 0;
  for (const h of rows) {
    const v = holdingValue(h);
    value += v;
    const avg = toNum(h.avgPrice);
    if (avg > 0) {
      cost += toNum(h.quantity) * avg;
      valueWithCost += v;
    } else if (toNum(h.quantity) > 0) {
      missingCost++;
    }
  }
  const gain = valueWithCost - cost;
  return { value, cost, valueWithCost, gain, gainPct: cost > 0 ? (gain / cost) * 100 : null, missingCost, count: rows.length };
}

export function investmentsSummary(state) {
  const byClass = {};
  const total = { value: 0, cost: 0, valueWithCost: 0, gain: 0, gainPct: null, missingCost: 0, count: 0 };
  for (const c of HOLDING_CLASSES) {
    const s = classSummary(state[c.key] || []);
    byClass[c.key] = s;
    total.value += s.value;
    total.cost += s.cost;
    total.valueWithCost += s.valueWithCost;
    total.gain += s.gain;
    total.missingCost += s.missingCost;
    total.count += s.count;
  }
  total.gainPct = total.cost > 0 ? (total.gain / total.cost) * 100 : null;
  return { byClass, total };
}

export function totals(state, today) {
  const tx = state.transactions || [];
  const balances = new Map();
  let liquidity = 0;
  for (const a of state.accounts || []) {
    const b = accountEffectiveBalance(a, tx, today);
    balances.set(a.id, b);
    liquidity += b;
  }
  const cards = new Map();
  let cardsSpent = 0, cardsLimit = 0, creditAvailable = 0;
  for (const c of state.creditCards || []) {
    const spent = cardEffectiveSpent(c, tx, today);
    const limit = toNum(c.limit);
    // Il credito residuo si calcola carta per carta: una carta oltre il limite non toglie credito alle altre.
    const available = Math.max(0, limit - spent);
    cards.set(c.id, { spent, limit, available, pct: limit > 0 ? (spent / limit) * 100 : 0 });
    cardsSpent += spent;
    cardsLimit += limit;
    creditAvailable += available;
  }
  let loansDebt = 0, loansMonthly = 0;
  for (const l of state.loans || []) {
    loansDebt += toNum(l.remaining);
    loansMonthly += toNum(l.monthlyPayment);
  }
  const inv = investmentsSummary(state);
  return {
    liquidity,
    balances,
    cards,
    cardsSpent,
    cardsLimit,
    creditAvailable,
    loansDebt,
    loansMonthly,
    debts: loansDebt + cardsSpent,
    investments: inv.total.value,
    inv,
  };
}

// Stima della durata residua di un finanziamento a rata costante.
export function loanPayoff(loan) {
  const balance = toNum(loan.remaining);
  const payment = toNum(loan.monthlyPayment);
  const r = toNum(loan.rate) / 100 / 12;
  if (balance <= 0) return { months: 0, interest: 0 };
  if (payment <= 0) return null;
  let exact;
  if (r <= 0) exact = balance / payment;
  else {
    const x = 1 - (r * balance) / payment;
    if (x <= 0) return { months: Infinity, interest: Infinity };
    exact = -Math.log(x) / Math.log(1 + r);
  }
  // Rate da pagare (l'ultima può essere parziale) e interessi sulla durata effettiva.
  return { months: Math.ceil(exact - 1e-9), interest: Math.max(0, exact * payment - balance) };
}

export function loanProgress(loan) {
  const principal = toNum(loan.principal);
  const remaining = toNum(loan.remaining);
  if (principal <= 0) return null;
  return Math.max(0, Math.min(100, ((principal - remaining) / principal) * 100));
}

export function nameOf(list, id, fallback = "—") {
  const x = (list || []).find((r) => r.id === id);
  return x ? x.name || "senza nome" : fallback;
}

// "Dove" è avvenuto il movimento, in parole. Un lato del giroconto può essere una carta.
export function txRoute(t, state) {
  if (t.kind === "Giroconto") {
    const side = (cardId, accountId) => (cardId ? nameOf(state.creditCards, cardId) : nameOf(state.accounts, accountId));
    return `${side(t.fromCardId, t.fromAccountId)} → ${side(t.toCardId, t.toAccountId)}`;
  }
  if (t.cardId) return nameOf(state.creditCards, t.cardId);
  if (t.accountId) return nameOf(state.accounts, t.accountId);
  return "";
}
