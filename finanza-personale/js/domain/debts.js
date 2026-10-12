import { addMonths, addMonthsYm, daysInMonth, monthOf, pad2 } from "../lib/dates.js";
import { round, toNum } from "../lib/format.js";
import { loanPayDay, nextInstallmentDate } from "./loans.js";

// Piano dei debiti: ammortamento dei finanziamenti (rata costante, alla francese) e simulazioni di
// rimborso anticipato. Solo calcolo: niente viene scritto. Le simulazioni tengono la rata uguale e
// accorciano la durata; eventuali penali dipendono dal contratto.

// Data della prima rata da simulare: la prossima indicata; se è passata, il prossimo giorno dell'addebito
// (questo mese, se non è ancora arrivato); senza date, il 1° del mese prossimo.
export function firstInstallment(loan, today) {
  if (loan.nextDate && loan.nextDate > today) return loan.nextDate;
  const ym = monthOf(today);
  if (!loan.nextDate) return nextInstallmentDate(`${ym}-01`, 1);
  const day = loanPayDay(loan);
  const thisMonth = `${ym}-${pad2(Math.min(day, daysInMonth(ym)))}`;
  return thisMonth > today ? thisMonth : nextInstallmentDate(`${ym}-01`, day);
}

// opts: { startDate, extraMonthly, lumpSum } — lumpSum si versa subito, prima della prima rata.
export function amortize(loan, { startDate, extraMonthly = 0, lumpSum = 0 } = {}) {
  let remaining = Math.max(0, toNum(loan.remaining) - Math.max(0, toNum(lumpSum)));
  const r = toNum(loan.rate) / 100 / 12;
  const payment = toNum(loan.monthlyPayment);
  const extra = Math.max(0, toNum(extraMonthly));
  const rows = [];
  if (remaining <= 0.005) return { rows, months: 0, interest: 0, paid: 0, end: null, endless: false };
  if (!(payment + extra > 0)) return { rows, months: Infinity, interest: Infinity, paid: Infinity, end: null, endless: true };
  const day = loan.nextDate ? loanPayDay(loan) : Number(String(startDate).slice(8, 10)) || 1;
  let date = startDate;
  let interestTot = 0, paidTot = 0;
  for (let n = 1; n <= 600 && remaining > 0.005; n++) {
    const interest = round(remaining * r, 2);
    const due = remaining + interest;
    const pay = round(Math.min(payment + extra, due), 2);
    if (pay <= interest + 0.004) return { rows, months: Infinity, interest: Infinity, paid: Infinity, end: null, endless: true };
    remaining = round(Math.max(0, due - pay), 2);
    interestTot += interest;
    paidTot += pay;
    rows.push({ n, date, payment: pay, interest, principal: round(pay - interest, 2), remaining });
    date = nextInstallmentDate(date, day);
  }
  // Non estinto entro 50 anni: niente data di fine né totali (sarebbero solo una parte); le righe restano.
  if (remaining > 0.005) return { rows, months: Infinity, interest: Infinity, paid: Infinity, end: null, endless: true, capped: true };
  return { rows, months: rows.length, interest: round(interestTot, 2), paid: round(paidTot + Math.max(0, toNum(lumpSum)), 2), end: rows.length ? rows[rows.length - 1].date : null, endless: false };
}

// Confronto tra il piano attuale e quello con un versamento extra (mensile e/o una tantum).
export function simulateExtra(loan, today, { extraMonthly = 0, lumpSum = 0 } = {}) {
  const startDate = firstInstallment(loan, today);
  const base = amortize(loan, { startDate });
  const plan = amortize(loan, { startDate, extraMonthly, lumpSum });
  return {
    base, plan,
    monthsSaved: Number.isFinite(base.months) && Number.isFinite(plan.months) ? base.months - plan.months : null,
    interestSaved: Number.isFinite(base.interest) && Number.isFinite(plan.interest) ? round(base.interest - plan.interest, 2) : null,
  };
}

// Più finanziamenti insieme, con un extra mensile che va a uno alla volta. Quando un debito si chiude,
// la sua rata si aggiunge all'extra ("effetto valanga"). Strategie: "avalanche" = prima il tasso più alto,
// "snowball" = prima il debito più piccolo. Con rollover false e senza extra si ottiene il piano di oggi:
// ogni finanziamento con la sua rata, e la rata di quelli chiusi non passa agli altri. Ogni finanziamento
// comincia dal mese della sua prossima rata (come nella scheda del singolo finanziamento).
export function payoffPlan(loans, today, { extraMonthly = 0, strategy = "avalanche", rollover = true } = {}) {
  const debts = loans
    .filter((l) => toNum(l.remaining) > 0.005 && toNum(l.monthlyPayment) > 0)
    .map((l) => ({ id: l.id, name: l.name || "Finanziamento", remaining: toNum(l.remaining), r: toNum(l.rate) / 100 / 12, payment: toNum(l.monthlyPayment), end: null, interest: 0, start: monthOf(firstInstallment(l, today)) }));
  const order = [...debts].sort((a, b) => (strategy === "snowball" ? a.remaining - b.remaining : b.r - a.r || a.remaining - b.remaining));
  const startYm = debts.length ? debts.reduce((m, d) => (d.start < m ? d.start : m), debts[0].start) : addMonthsYm(monthOf(today), 1);
  const startDate = `${startYm}-01`;
  let month = 0, interest = 0;
  for (; month < 600 && debts.some((d) => d.remaining > 0.005); month++) {
    const date = addMonths(startDate, month);
    const ym = date.slice(0, 7);
    let pool = Math.max(0, toNum(extraMonthly));
    for (const d of debts) {
      if (d.remaining <= 0.005) { if (rollover) pool += d.payment; continue; }
      if (ym < d.start) continue;
      const i = d.remaining * d.r;
      const pay = Math.min(d.payment, d.remaining + i);
      d.remaining = Math.max(0, d.remaining + i - pay);
      d.interest += i;
      interest += i;
      if (rollover) pool += d.payment - pay;
      if (d.remaining <= 0.005 && !d.end) d.end = date;
    }
    for (const d of order) {
      if (pool <= 0.005) break;
      const t = debts.find((x) => x.id === d.id);
      if (t.remaining <= 0.005 || ym < t.start) continue;
      const pay = Math.min(pool, t.remaining);
      t.remaining -= pay;
      pool -= pay;
      if (t.remaining <= 0.005 && !t.end) t.end = date;
    }
  }
  // Se un debito non si chiude mai (rata che non copre gli interessi) non c'è una data in cui tutto è estinto,
  // e gli interessi di 50 anni non sono un totale sensato.
  const last = debts.reduce((m, d) => (d.end && d.end > m ? d.end : m), "");
  const allEnd = debts.every((d) => d.end);
  return {
    months: month,
    interest: allEnd ? round(interest, 2) : Infinity,
    end: allEnd ? last || null : null,
    debts: debts.map((d) => ({ id: d.id, name: d.name, end: d.end, interest: d.end ? round(d.interest, 2) : Infinity })),
    order: order.map((d) => d.id),
  };
}
