import { addPeriod } from "../lib/dates.js";
import { round, toNum } from "../lib/format.js";

export const PAC_FREQUENCIES = ["Settimanale", "Mensile", "Bimestrale", "Trimestrale", "Semestrale", "Annuale"];

// "etf:<id>" → { coll, id, holding }
export function resolveAsset(ref, state) {
  const s = String(ref || "");
  const i = s.indexOf(":");
  if (i < 0) return null;
  const coll = s.slice(0, i), id = s.slice(i + 1);
  if (!["etf", "stocks", "crypto"].includes(coll)) return null;
  const holding = (state[coll] || []).find((h) => h.id === id);
  return holding ? { coll, id, holding } : null;
}

export const pacTxId = (pacId, date) => `pac-${pacId}-${date}`;

export function pacIsDue(pac, today) {
  return pac.status !== "In pausa" && !!pac.nextDate && pac.nextDate <= today;
}

// Tutte le scritture di un versamento vanno in un unico batch atomico: quantità, movimento e prossima data.
// Se il movimento con id deterministico esiste già, il versamento era stato registrato: si avanza solo la data.
export function planPacRegistration(pac, state, today, overrides = {}) {
  const target = resolveAsset(pac.asset, state);
  if (!target) return { error: "Lo strumento collegato al piano non esiste più: modifica il piano e sceglilo di nuovo." };
  const price = overrides.price != null ? toNum(overrides.price) : toNum(target.holding.currentPrice);
  if (!(price > 0)) return { error: `Imposta un prezzo valido per "${target.holding.name || "lo strumento"}" prima di registrare il versamento.` };
  const amount = overrides.amount != null ? toNum(overrides.amount) : toNum(pac.amount);
  if (!(amount > 0)) return { error: "L'importo del versamento deve essere maggiore di zero." };
  const date = pac.nextDate || today;
  const txId = pacTxId(pac.id, date);
  const ops = [];
  const units = amount / price;
  if (!(state.transactions || []).some((t) => t.id === txId)) {
    const oldQty = toNum(target.holding.quantity);
    const oldAvg = toNum(target.holding.avgPrice);
    const newQty = oldQty + units;
    // Con prezzo di carico sconosciuto (0) sulle quote già possedute, la media resta sconosciuta.
    let newAvg = oldAvg;
    if (oldQty <= 0) newAvg = price;
    else if (oldAvg > 0) newAvg = (oldQty * oldAvg + amount) / newQty;
    ops.push({ op: "update", coll: target.coll, id: target.id, data: { quantity: round(newQty, 8), avgPrice: round(newAvg, 6) } });
    ops.push({
      op: "set", coll: "transactions", id: txId,
      data: {
        date, description: pac.name || "Piano di accumulo", category: "Investimenti", kind: "Uscita", amount,
        accountId: pac.accountId || "", cardId: "", pacId: pac.id, asset: pac.asset || "", units: round(units, 8), unitPrice: price,
      },
    });
  }
  ops.push({ op: "update", coll: "pac", id: pac.id, data: { nextDate: addPeriod(date, pac.frequency) } });
  return { ops, date, units, price, amount, target };
}

// Salta la scadenza corrente senza registrare nulla.
export function planPacSkip(pac) {
  const date = pac.nextDate;
  if (!date) return { ops: [] };
  return { ops: [{ op: "update", coll: "pac", id: pac.id, data: { nextDate: addPeriod(date, pac.frequency) } }] };
}

// Rendimento annuo di una serie di flussi (XIRR): versamenti negativi alle loro date, valore finale positivo.
// Restituisce la percentuale annua, o null se non si trova (es. flussi tutti dello stesso segno).
export function xirr(flows) {
  const list = flows.filter((f) => f.date && Number.isFinite(f.amount) && f.amount !== 0);
  if (!list.some((f) => f.amount < 0) || !list.some((f) => f.amount > 0)) return null;
  const t0 = Date.parse(list.reduce((m, f) => (f.date < m ? f.date : m), list[0].date));
  const years = list.map((f) => (Date.parse(f.date) - t0) / (365.25 * 86400000));
  const npv = (r) => list.reduce((s, f, i) => s + f.amount / Math.pow(1 + r, years[i]), 0);
  let lo = -0.9999, hi = 10;
  let flo = npv(lo), fhi = npv(hi);
  // Date illeggibili (NaN), nessun cambio di segno o valore attuale nullo a ogni tasso: rendimento non determinabile.
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0 || (flo === 0 && fhi === 0)) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid * 100;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return ((lo + hi) / 2) * 100;
}

// Andamento di un piano: versato, quote comprate con i versamenti registrati dall'app, valore di quelle quote
// al prezzo attuale e rendimento annuo (solo dopo almeno 90 giorni dal primo versamento, prima non è attendibile).
// I versamenti senza numero di quote (es. importati) rendono il valore incompleto: in quel caso niente rendimento.
export function pacStats(pac, state, today) {
  const target = resolveAsset(pac.asset, state);
  const tx = (state.transactions || []).filter((t) => !!pac.id && t.pacId === pac.id && t.date && t.date <= today);
  const invested = tx.reduce((s, t) => s + toNum(t.amount), 0);
  const withUnits = tx.filter((t) => toNum(t.units) > 0);
  const units = withUnits.reduce((s, t) => s + toNum(t.units), 0);
  const price = target ? toNum(target.holding.currentPrice) : 0;
  const value = units * price;
  const partial = withUnits.length < tx.length || !(price > 0);
  const first = tx.reduce((m, t) => (!m || t.date < m ? t.date : m), "");
  const days = first ? Math.round((Date.parse(today) - Date.parse(first)) / 86400000) : 0;
  const annual = !partial && tx.length && days >= 90 ? xirr([...tx.map((t) => ({ date: t.date, amount: -toNum(t.amount) })), { date: today, amount: value }]) : null;
  return {
    count: tx.length, invested: round(invested, 2), units: round(units, 8), value: round(value, 2),
    gain: partial ? null : round(value - invested, 2), gainPct: !partial && invested > 0 ? ((value - invested) / invested) * 100 : null,
    first: first || null, days, annual, partial,
  };
}

// Valore futuro di un versamento periodico: valore di oggi e versamenti, al rendimento annuo indicato.
// Rendimenti negativi ammessi (fino a -100%, perdita totale).
export function futureValue({ value = 0, monthly = 0, years = 10, annualReturn = 0 }) {
  const m = Math.max(0, Math.round(toNum(years) * 12));
  const rate = Math.max(-100, toNum(annualReturn));
  const rm = rate <= -100 ? -1 : Math.pow(1 + rate / 100, 1 / 12) - 1;
  const growth = Math.pow(1 + rm, m);
  const fv = Math.abs(rm) > 1e-12 ? toNum(value) * growth + toNum(monthly) * ((growth - 1) / rm) : toNum(value) + toNum(monthly) * m;
  return { value: round(fv, 2), contributions: round(toNum(monthly) * m, 2), months: m };
}
