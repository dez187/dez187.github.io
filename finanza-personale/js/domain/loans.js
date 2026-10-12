import { addMonths, daysInMonth, pad2 } from "../lib/dates.js";
import { round, toNum } from "../lib/format.js";
import { categoryId } from "./categories.js";

// Addebito automatico delle rate dei finanziamenti. Con conto di addebito e data della prossima rata,
// alla scadenza l'app registra la rata come uscita del conto (categoria "Finanziamenti") e scala dal
// debito residuo la quota capitale: la rata meno gli interessi del mese, al tasso annuo indicato.
// Ogni rata ha un id deterministico "loan-<id>-<data>": rieseguire non crea doppioni.

export const LOAN_CATEGORY = "Finanziamenti";
export const loanTxId = (loanId, date) => `loan-${loanId}-${date}`;

export function loanCategoryOp(categories) {
  if ((categories || []).some((c) => c.name === LOAN_CATEGORY)) return null;
  return { op: "set", coll: "categories", id: categoryId(LOAN_CATEGORY), data: { name: LOAN_CATEGORY, emoji: "📄", kind: "Uscita", budget: 0, order: 14.6 } };
}

export const loanAutoPay = (loan) => !!(loan && loan.accountId && loan.nextDate && toNum(loan.monthlyPayment) > 0);

// Giorno del mese dell'addebito: quello scelto nel modulo (le rate di fine mese restano a fine mese).
export function loanPayDay(loan) {
  const d = Math.round(toNum(loan.payDay));
  return d >= 1 && d <= 31 ? d : Number(String(loan.nextDate || "").slice(8, 10)) || 1;
}

// Stesso giorno del mese successivo, o l'ultimo se il mese è più corto.
export function nextInstallmentDate(date, day) {
  const ym = addMonths(`${date.slice(0, 7)}-01`, 1).slice(0, 7);
  return `${ym}-${pad2(Math.min(day, daysInMonth(ym)))}`;
}

// Rate scadute fino a oggi compreso, con interessi e quota capitale; next è la rata successiva
// ("" se il debito è estinto o si è passata l'ultima rata indicata, endDate "AAAA-MM").
export function dueInstallments(loan, today, limit = 600) {
  const payment = toNum(loan.monthlyPayment);
  const monthlyRate = toNum(loan.rate) / 100 / 12;
  const day = loanPayDay(loan);
  const end = loan.endDate || "";
  const past = (date) => !!end && date.slice(0, 7) > end;
  let remaining = round(toNum(loan.remaining), 2);
  let date = loan.nextDate || "";
  const items = [];
  while (items.length < limit && date && date <= today && remaining > 0.005 && !past(date)) {
    const interest = round(remaining * monthlyRate, 2);
    const amount = round(Math.min(payment, remaining + interest), 2);
    const principal = round(amount - interest, 2);
    remaining = round(Math.max(0, remaining - principal), 2);
    items.push({ date, amount, interest, principal, remaining });
    date = nextInstallmentDate(date, day);
  }
  const over = remaining <= 0.005 || !date || past(date);
  return { items, next: over ? "" : date, remaining };
}

// Operazioni da scrivere per registrare le rate scadute di tutti i finanziamenti con addebito automatico.
export function planLoanPayments(state, today) {
  const existing = new Set((state.transactions || []).map((t) => t.id));
  const ops = [];
  let created = 0;
  for (const loan of state.loans || []) {
    if (!loanAutoPay(loan) || loan.nextDate > today) continue;
    const { items, next, remaining } = dueInstallments(loan, today);
    for (const it of items) {
      const id = loanTxId(loan.id, it.date);
      if (existing.has(id)) continue;
      ops.push({
        op: "set", coll: "transactions", id,
        data: { date: it.date, description: `Rata ${loan.name || "finanziamento"}`, category: LOAN_CATEGORY, kind: "Uscita", amount: it.amount, accountId: loan.accountId, cardId: "", loanId: loan.id },
      });
      created++;
    }
    ops.push({ op: "update", coll: "loans", id: loan.id, data: { remaining, nextDate: next, payDay: loanPayDay(loan) } });
  }
  const cat = created ? loanCategoryOp(state.categories) : null;
  if (cat) ops.unshift(cat);
  return { ops, created };
}
