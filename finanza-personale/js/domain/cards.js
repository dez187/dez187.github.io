import { addDays, addMonths, addPeriod, daysBetween } from "../lib/dates.js";
import { round, toNum } from "../lib/format.js";
import { cardEffect, cardEffectiveSpent } from "./finance.js";
import { categoryId } from "./categories.js";

// Chiusura del mese di una carta di credito: addebito sul conto e rinnovo del plafond.
// L'addebito è un'uscita del conto con categoria dedicata e ricorda il periodo di spese che paga
// (cycleFrom escluso, cycleTo incluso): la parte già registrata una per una sulla carta in quel
// periodo non viene contata due volte nel flusso di cassa e nel budget (vedi cardPaymentShares).

export const CARD_CATEGORY = "Carta di credito";

// La categoria degli addebiti, se manca ancora (chi usava l'app prima che esistesse).
export function cardCategoryOp(categories) {
  if ((categories || []).some((c) => c.name === CARD_CATEGORY)) return null;
  return { op: "set", coll: "categories", id: categoryId(CARD_CATEGORY), data: { name: CARD_CATEGORY, emoji: "💳", kind: "Uscita", budget: 0, order: 14.5 } };
}

// Inizio del ciclo che si chiude con il rinnovo: l'ultimo rinnovo registrato, altrimenti un mese prima.
export function cycleStart(card, renewDate) {
  return card.cycleStart && card.cycleStart < renewDate ? card.cycleStart : addMonths(renewDate, -1);
}

// Spese registrate una per una sulla carta tra due date (al netto dei rimborsi), comprese le ricariche
// fatte con la carta; i pagamenti verso la carta non contano.
export function itemizedInCycle(card, transactions, from, to) {
  let sum = 0;
  for (const t of transactions) {
    if (!t.date || t.date <= from || t.date > to) continue;
    const sign = cardEffect(t, card.id);
    if (sign && !(t.kind === "Giroconto" && sign < 0)) sum += sign * toNum(t.amount);
  }
  return Math.max(0, round(sum, 2));
}

const hasPayment = (card, transactions, cycleTo) => transactions.some((t) => t.cardPaymentFor === card.id && t.cycleTo === cycleTo);

function knownDelay(card) {
  const v = card.payDelayDays;
  return v !== "" && v != null && Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : null;
}

// Periodo di spese pagato da un addebito. Insieme al rinnovo è il mese che si chiude; da solo è
// l'ultimo mese già chiuso (oppure quello in scadenza, se l'ultimo chiuso risulta già pagato).
export function paidCycle(card, transactions, { renew, renewDate, today }) {
  if (renew) return renewDate ? { from: cycleStart(card, renewDate), to: renewDate } : null;
  const due = !!card.resetDate && card.resetDate <= today;
  if (card.cycleStart) {
    if (due && card.resetDate > card.cycleStart && hasPayment(card, transactions, card.cycleStart)) return { from: card.cycleStart, to: card.resetDate };
    const from = card.prevCycleStart && card.prevCycleStart < card.cycleStart ? card.prevCycleStart : addMonths(card.cycleStart, -1);
    return { from, to: card.cycleStart };
  }
  if (!card.resetDate) return null;
  const to = due ? card.resetDate : addMonths(card.resetDate, -1);
  return { from: addMonths(to, -1), to };
}

// Periodo pagato da un addebito di cui si conosce solo la data (es. letto dall'estratto del conto):
// l'ultimo mese della carta chiuso a quella data, contando i rinnovi di mese in mese. Se si sa dopo
// quanti giorni arriva di solito l'addebito, vale il rinnovo più vicino alla data attesa (l'addebito
// può slittare di qualche giorno per un festivo).
export function cycleForDebitDate(card, date) {
  const anchor = card.resetDate || card.cycleStart;
  if (!anchor || !date) return null;
  const delay = knownDelay(card);
  const ref = delay != null ? addDays(date, -delay) : date;
  let k = Math.round(daysBetween(anchor, ref) / 30.44);
  while (addMonths(anchor, k) > ref) k--;
  while (addMonths(anchor, k + 1) <= ref) k++;
  if (delay != null && daysBetween(ref, addMonths(anchor, k + 1)) < daysBetween(addMonths(anchor, k), ref)) k++;
  const to = addMonths(anchor, k);
  const from = to === card.cycleStart && card.prevCycleStart && card.prevCycleStart < to ? card.prevCycleStart : addMonths(anchor, k - 1);
  return { from, to };
}

// Valori proposti nella finestra "Addebito e rinnovo". Senza una scelta esplicita (opts.renew) il
// plafond si rinnova se la carta è in scadenza o non ha una data di rinnovo; non si rinnova se il
// rinnovo è già stato registrato e manca solo l'addebito del mese chiuso.
// amount è null quando l'importo lo conosce solo l'estratto conto.
export function settlementDefaults(card, state, today, opts = {}) {
  const tx = state.transactions || [];
  const due = !!card.resetDate && card.resetDate <= today;
  const pending = !!card.cycleStart && !due && !hasPayment(card, tx, card.cycleStart);
  const renew = opts.renew != null ? !!opts.renew : !pending && (due || !card.resetDate);
  const renewDate = opts.renewDate || (due ? card.resetDate : today);
  const cycle = paidCycle(card, tx, { renew, renewDate, today });
  const paid = !!cycle && hasPayment(card, tx, cycle.to);
  const spentAt = (date) => Math.max(0, round(cardEffectiveSpent(card, tx, date), 2));
  let amount;
  if (renew) amount = spentAt(renewDate);
  else if (!cycle) amount = spentAt(today);
  else if (cycle.to === card.cycleStart) amount = card.lastCycleSpent != null && !paid ? Math.max(0, round(toNum(card.lastCycleSpent), 2)) : null;
  else if (due) amount = spentAt(cycle.to);
  else amount = null;
  const delay = knownDelay(card);
  const base = renew ? renewDate : cycle ? cycle.to : today;
  return {
    due,
    renew,
    renewDate,
    cycle,
    paid,
    amount,
    debitDate: delay != null ? addDays(base, delay) : renew ? renewDate : today,
    accountId: card.payAccountId && (state.accounts || []).some((a) => a.id === card.payAccountId) ? card.payAccountId : "",
    itemized: cycle ? itemizedInCycle(card, tx, cycle.from, cycle.to) : 0,
    nextReset: addPeriod(renewDate, "Mensile"),
  };
}

// opts: { debit, amount, accountId, date, renew, renewDate, today, txId, now }
export function planCardSettlement(card, state, opts) {
  const { debit, renew } = opts;
  const tx = state.transactions || [];
  if (!debit && !renew) return { error: "Scegli almeno una delle due operazioni." };
  const ops = [];
  const patch = {};
  const renewDate = opts.renewDate;
  if (renew && !renewDate) return { error: "Indica la data del rinnovo.", field: "renewDate" };
  if (debit) {
    const amount = round(toNum(opts.amount), 2);
    if (!(amount > 0)) return { error: "Inserisci l'importo addebitato.", field: "amount" };
    if (!opts.accountId) return { error: "Scegli il conto di addebito.", field: "accountId" };
    if (!opts.date) return { error: "Indica la data dell'addebito.", field: "date" };
    const cycle = paidCycle(card, tx, { renew, renewDate, today: opts.today || opts.date });
    const catOp = cardCategoryOp(state.categories);
    if (catOp) ops.push(catOp);
    const data = {
      date: opts.date, description: `Addebito ${card.name || "carta"}`, category: CARD_CATEGORY, kind: "Uscita", amount,
      accountId: opts.accountId, cardId: "", cardPaymentFor: card.id, createdAt: opts.now || 0,
    };
    if (cycle) Object.assign(data, { cycleFrom: cycle.from, cycleTo: cycle.to });
    ops.push({ op: "set", coll: "transactions", id: opts.txId, data });
    patch.payAccountId = opts.accountId;
    // Giorni tra la chiusura del mese e l'addebito: serviranno a proporre la data la prossima volta.
    const delay = cycle ? daysBetween(cycle.to, opts.date) : -1;
    if (delay >= 0 && delay <= 62) patch.payDelayDays = delay;
  }
  if (renew) {
    Object.assign(patch, {
      spent: 0, spentDate: renewDate, resetDate: addPeriod(renewDate, "Mensile"),
      cycleStart: renewDate, prevCycleStart: cycleStart(card, renewDate),
      lastCycleSpent: Math.max(0, round(cardEffectiveSpent(card, tx, renewDate), 2)),
    });
  }
  ops.push({ op: "update", coll: "creditCards", id: card.id, data: patch });
  return { ops };
}
