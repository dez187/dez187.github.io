import { addDays } from "../lib/dates.js";
import { round, toNum } from "../lib/format.js";

// Documenti "history/<data>": un'istantanea al giorno dei totali.
// I documenti creati dal vecchio artifact usano "netWorth" come sinonimo della liquidità.
export function historyValue(doc, field) {
  if (field === "liquidity") {
    const v = doc.liquidity ?? doc.netWorth;
    return v == null ? null : toNum(v);
  }
  if (field === "investments") {
    if (doc.etfValue == null && doc.stocksValue == null && doc.cryptoValue == null) return null;
    return toNum(doc.etfValue) + toNum(doc.stocksValue) + toNum(doc.cryptoValue);
  }
  const v = doc[field];
  return v == null ? null : toNum(v);
}

// Serie giornaliera tra from e to: ogni giorno porta l'ultimo valore noto; l'ultimo punto è il valore attuale.
export function dailySeries(history, field, from, to, current) {
  const pts = history
    .filter((h) => h.date && h.date <= to)
    .map((h) => ({ date: h.date, value: historyValue(h, field) }))
    .filter((p) => p.value != null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let carry = null;
  let i = 0;
  while (i < pts.length && pts[i].date <= from) carry = pts[i++].value;
  let day = carry == null ? (pts[i] ? pts[i].date : to) : from;
  const out = [];
  let guard = 0;
  while (day <= to && guard++ < 4000) {
    while (i < pts.length && pts[i].date <= day) carry = pts[i++].value;
    if (carry != null) out.push({ date: day, value: carry });
    day = addDays(day, 1);
  }
  if (current != null) {
    if (out.length && out[out.length - 1].date === to) out[out.length - 1] = { date: to, value: current };
    else out.push({ date: to, value: current });
  }
  return out;
}

export function firstHistoryDate(history, field) {
  let min = null;
  for (const h of history) {
    if (h.date && historyValue(h, field) != null && (!min || h.date < min)) min = h.date;
  }
  return min;
}

export function buildSnapshot(t, today) {
  return {
    date: today,
    liquidity: round(t.liquidity, 2),
    etfValue: round(t.inv.byClass.etf.value, 2),
    stocksValue: round(t.inv.byClass.stocks.value, 2),
    cryptoValue: round(t.inv.byClass.crypto.value, 2),
    cardsDebt: round(t.cardsSpent, 2),
    loansDebt: round(t.loansDebt, 2),
    debts: round(t.debts, 2),
  };
}

const SNAPSHOT_FIELDS = ["liquidity", "etfValue", "stocksValue", "cryptoValue", "cardsDebt", "loansDebt"];

export function sameSnapshot(a, b) {
  if (!a || !b) return false;
  return SNAPSHOT_FIELDS.every((k) => Math.abs(toNum(a[k]) - toNum(b[k])) < 0.005) && a.date === b.date;
}
