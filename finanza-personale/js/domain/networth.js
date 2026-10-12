import { addMonths, addMonthsYm, daysBetween, lastDay, monthOf, perMonth } from "../lib/dates.js";
import { round, toNum } from "../lib/format.js";
import { historyValue } from "./history.js";
import { flowTotals } from "./cashflow.js";
import { LOAN_CATEGORY } from "./loans.js";

// Patrimonio netto: conti e investimenti meno carte e finanziamenti. Solo calcolo.

export function netWorth(t) {
  const assets = t.liquidity + t.investments;
  const debts = t.cardsSpent + t.loansDebt;
  return { value: round(assets - debts, 2), assets: round(assets, 2), debts: round(debts, 2), liquidity: t.liquidity, investments: t.investments, cards: t.cardsSpent, loans: t.loansDebt };
}

// Storico: solo i giorni con tutti i valori (le istantanee salvate dall'app; i giorni ricostruiti dagli
// estratti hanno solo il disponibile e restano fuori). L'ultimo punto è il valore di oggi.
export function netWorthSeries(history, today, current) {
  const pts = [];
  for (const h of history || []) {
    if (!h.date || h.date > today || h.loansDebt == null || h.cardsDebt == null) continue;
    const liq = historyValue(h, "liquidity");
    const inv = historyValue(h, "investments");
    if (liq == null || inv == null) continue;
    pts.push({ date: h.date, value: round(liq + inv - toNum(h.cardsDebt) - toNum(h.loansDebt), 2) });
  }
  pts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (current != null) {
    if (pts.length && pts[pts.length - 1].date === today) pts[pts.length - 1] = { date: today, value: round(current, 2) };
    else pts.push({ date: today, value: round(current, 2) });
  }
  return pts;
}

// Finanziamenti le cui rate compaiono tra le uscite degli ultimi 12 mesi (rate automatiche o uscite della
// categoria Finanziamenti di importo simile, almeno 6). Per gli altri (es. pagati con giroconti a un conto
// della finanziaria) la rata non è nel risparmio medio e la proiezione la toglie a parte dal disponibile.
// Ogni uscita senza finanziamento indicato conta per un solo finanziamento (due rate uguali non si
// spartiscono gli stessi pagamenti).
export function loansPaidInHistory(state, today) {
  const from = `${addMonthsYm(monthOf(today), -12)}-01`;
  const recent = (state.transactions || []).filter((t) => t.kind === "Uscita" && t.date >= from && t.date <= today);
  const out = new Set(), used = new Set();
  for (const l of state.loans || []) if (recent.filter((t) => t.loanId === l.id).length >= 6) out.add(l.id);
  for (const l of state.loans || []) {
    if (out.has(l.id)) continue;
    const pay = toNum(l.monthlyPayment);
    const own = recent.filter((t) => t.loanId === l.id).length;
    const hits = recent.filter((t) => !t.loanId && !used.has(t.id) && t.category === LOAN_CATEGORY && pay > 0 && Math.abs(toNum(t.amount) - pay) <= Math.max(5, pay * 0.03));
    // Al massimo un pagamento al mese per finanziamento: gli altri restano per un finanziamento con la stessa rata.
    const months = new Set(), mine = [];
    for (const t of hits) { const m = t.date.slice(0, 7); if (!months.has(m)) { months.add(m); mine.push(t); } }
    if (own + mine.length >= 6) { out.add(l.id); mine.forEach((t) => used.add(t.id)); }
  }
  return out;
}

// Ipotesi di partenza della proiezione: il risparmio medio degli ultimi 12 mesi interi (entrate meno uscite,
// già al netto di rate e versamenti nei PAC), i versamenti mensili dei PAC attivi e i finanziamenti la cui
// rata non è già tra le uscite (cashLoans).
export function projectionDefaults(state, today) {
  const ym = monthOf(today);
  const from = `${addMonthsYm(ym, -12)}-01`;
  const to = lastDay(addMonthsYm(ym, -1));
  const tot = flowTotals(state.transactions || [], from, to);
  // Con movimenti più vecchi i mesi sono 12; altrimenti quelli da cui partono i movimenti (chi ha appena cominciato).
  let first = to, older = false;
  for (const t of state.transactions || []) {
    if (!t.date) continue;
    if (t.date < from) older = true;
    else if (t.date < first) first = t.date;
  }
  const months = older ? 12 : Math.max(1, Math.min(12, Math.round(daysBetween(first, to) / 30.44)));
  const invest = (state.pac || []).filter((p) => p.status !== "In pausa").reduce((s, p) => s + perMonth(toNum(p.amount), p.frequency || "Mensile"), 0);
  const paid = loansPaidInHistory(state, today);
  const cashLoans = (state.loans || []).filter((l) => toNum(l.remaining) > 0.005 && !paid.has(l.id)).map((l) => l.id);
  return { monthlySaving: round(tot.net / months, 2), monthlyInvest: round(invest, 2), months, cashLoans };
}

// Proiezione mese per mese. Ogni mese: il risparmio va sul conto (più le rate dei finanziamenti estinti durante
// la proiezione, che non si pagano più), gli investimenti rendono e ricevono i versamenti, ogni rata riduce il
// debito della quota capitale. Le rate dei finanziamenti in cashLoans non sono nel risparmio medio: si tolgono
// dal disponibile a parte. Le carte restano come sono.
// opts: { liquidity, investments, cards, loans, monthlySaving, monthlyInvest, annualReturn (%), months, startDate, cashLoans }
export function projectNetWorth(opts) {
  const { liquidity, investments, cards, loans = [], monthlySaving = 0, monthlyInvest = 0, annualReturn = 0, months = 120, startDate, cashLoans = [] } = opts;
  const rm = Math.pow(1 + toNum(annualReturn) / 100, 1 / 12) - 1;
  let L = toNum(liquidity), I = toNum(investments);
  const cash = new Set(cashLoans);
  const debts = loans.map((l) => ({ id: l.id, name: l.name, remaining: toNum(l.remaining), rate: toNum(l.rate) / 100 / 12, payment: toNum(l.monthlyPayment), end: null, active: toNum(l.remaining) > 0.005, fromCash: cash.has(l.id) }));
  const C = toNum(cards);
  const points = [];
  let positiveAt = null;
  for (let m = 0; m <= months; m++) {
    const date = addMonths(startDate, m);
    if (m > 0) {
      let freed = 0;
      for (const d of debts) {
        if (!d.active) continue;
        if (d.remaining <= 0.005) { if (!d.fromCash) freed += d.payment; continue; }
        const interest = d.remaining * d.rate;
        const pay = Math.min(d.payment, d.remaining + interest);
        if (d.fromCash) L -= pay;
        if (!(d.payment > 0)) continue; // rata non indicata: debito invariato
        // Se la rata non copre gli interessi il debito cresce.
        d.remaining = Math.max(0, d.remaining + interest - pay);
        if (d.remaining <= 0.005) { d.end = date; if (!d.fromCash) freed += d.payment - pay; }
      }
      L += toNum(monthlySaving) + freed;
      I = I * (1 + rm) + toNum(monthlyInvest);
    }
    const D = debts.reduce((s, d) => s + d.remaining, 0) + C;
    const value = L + I - D;
    points.push({ date, value: round(value, 2), liquidity: round(L, 2), investments: round(I, 2), debts: round(D, 2) });
    if (positiveAt == null && m > 0 && points[0].value < 0 && value >= 0) positiveAt = date;
  }
  // Solo i finanziamenti ancora da rimborsare (quelli già estinti non hanno una fine da prevedere).
  return { points, positiveAt, debtsEnd: debts.filter((d) => d.active).map((d) => ({ id: d.id, name: d.name, end: d.end })) };
}
