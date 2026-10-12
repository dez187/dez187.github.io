import { toNum } from "../lib/format.js";
import { nextOccurrence, scheduleKind } from "./schedules.js";
import { resolveAsset } from "./pac.js";
import { nameOf, txRoute, txTone } from "./finance.js";
import { loanAutoPay } from "./loans.js";

// Scadenze in arrivo: movimenti già registrati con data futura (es. l'addebito di una carta),
// operazioni programmate, rate dei finanziamenti, versamenti PAC e rinnovi del plafond delle carte.
export function upcomingItems(state, totals, today) {
  const items = [];
  for (const t of state.transactions || []) {
    if (!t.date || t.date <= today) continue;
    const transfer = t.kind === "Giroconto";
    items.push({
      kind: "tx", id: t.id, date: t.date, title: t.description || "Movimento", amount: toNum(t.amount),
      sign: transfer ? 0 : t.kind === "Entrata" ? 1 : -1, tone: txTone(t), label: transfer ? "Giroconto" : t.category || "Altro", where: txRoute(t, state), due: false,
    });
  }
  for (const s of state.schedules || []) {
    if (!s.startDate || s.status === "Concluso" || s.status === "In pausa") continue;
    const transfer = s.type === "transfer";
    const pay = String(s.payWith || "");
    const where = transfer
      ? `${nameOf(state.accounts, s.fromAccountId)} → ${nameOf(state.accounts, s.toAccountId)}`
      : pay.startsWith("card:") ? nameOf(state.creditCards, pay.slice(5)) : nameOf(state.accounts, pay.slice(8));
    items.push({
      kind: "schedule", id: s.id, date: nextOccurrence(s), title: s.description || "Operazione programmata",
      amount: toNum(s.amount), sign: transfer ? 0 : s.type === "income" ? 1 : -1, tone: txTone({ kind: scheduleKind(s), category: s.category }),
      label: transfer ? "Giroconto" : s.type === "income" ? "Entrata ricorrente" : "Spesa ricorrente", where, due: false,
    });
  }
  for (const p of state.pac || []) {
    if (p.status === "In pausa" || !p.nextDate) continue;
    const t = resolveAsset(p.asset, state);
    items.push({
      kind: "pac", id: p.id, date: p.nextDate, title: p.name || "Piano di accumulo", amount: toNum(p.amount), sign: -1, tone: "inv",
      label: "Piano di accumulo", where: t ? t.holding.name : "strumento mancante", due: p.nextDate <= today,
    });
  }
  for (const l of state.loans || []) {
    if (!loanAutoPay(l) || toNum(l.remaining) <= 0.005) continue;
    items.push({
      kind: "loan", id: l.id, date: l.nextDate, title: `Rata ${l.name || "finanziamento"}`, amount: toNum(l.monthlyPayment), sign: -1, tone: "out",
      label: "Finanziamento", where: nameOf(state.accounts, l.accountId), due: false,
    });
  }
  for (const c of state.creditCards || []) {
    if (!c.resetDate) continue;
    const spent = totals.cards.get(c.id)?.spent || 0;
    items.push({
      kind: "card", id: c.id, date: c.resetDate, title: `Rinnovo plafond ${c.name || "carta"}`, amount: spent, sign: 0,
      label: "Carta di credito", where: "", due: c.resetDate <= today && spent > 0,
    });
  }
  return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
