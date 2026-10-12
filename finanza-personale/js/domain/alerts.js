import { addDays, daysBetween } from "../lib/dates.js";
import { round, toNum } from "../lib/format.js";
import { loanAutoPay } from "./loans.js";
import { salaryLate, uncoveredDebits } from "./coverage.js";

// Avvisi calcolati dai dati (nessuna scrittura). Ogni avviso ha una chiave stabile per poterlo rimandare
// (settings.alertSnooze[chiave] = data fino a cui non mostrarlo) e un livello: "high", "warn" o "info".
// Il testo lo compone l'interfaccia a partire da type e dai campi.

const ORDER = { high: 0, warn: 1, info: 2 };
export const ALERT_DAYS = 30;

// opts: { forecast (buildForecast), budget (budgetMonth del mese in corso), recurring, prefs (settings) }
export function buildAlerts(state, totals, today, { forecast, budget, recurring, prefs } = {}) {
  prefs = prefs && typeof prefs === "object" ? prefs : {};
  recurring = Array.isArray(recurring) ? recurring : [];
  const out = [];
  const limit = addDays(today, ALERT_DAYS);
  // 1. addebiti dei prossimi giorni che il conto non copre: quale, quanto manca e da dove spostarlo
  //    (al posto dell'avviso generico sul conto, che resta per le date più lontane)
  const covered = new Set();
  if (forecast) {
    for (const u of uncoveredDebits(forecast, state, today)) {
      covered.add(u.accountId);
      out.push({ key: `cover:${u.accountId}:${u.date}`, level: "high", type: "debit-uncovered", accountId: u.accountId, name: u.name, date: u.date, debits: u.debits, total: u.total, shortfall: u.shortfall, need: u.need, from: u.from });
    }
    // 1b. stipendio atteso da qualche giorno e non arrivato: cosa resterebbe scoperto se tarda ancora
    const late = salaryLate(forecast, state, today);
    if (late) out.push({ key: `salary-late:${late.expected}`, level: late.risk ? "warn" : "info", type: "salary-late", accountId: late.accountId, name: late.label, expected: late.expected, late: late.late, amount: late.amount, risk: late.risk, date: late.risk ? late.risk.date : late.expected });
  }
  // 2. conti che con le scadenze note andrebbero in rosso nei prossimi 30 giorni
  if (forecast) {
    for (const a of forecast.accounts) {
      if (covered.has(a.id)) continue;
      const p = a.points.find((x) => x.date <= limit && x.value < -10);
      if (!p) continue;
      const low = a.points.filter((x) => x.date <= limit).reduce((m, x) => (x.value < m.value ? x : m), p);
      out.push({ key: `neg:${a.id}`, level: "high", type: "account-negative", accountId: a.id, name: a.name, value: low.value, date: p.date, lowDate: low.date });
    }
    // 3. disponibile totale previsto sotto la soglia scelta (di base zero)
    const threshold = Number.isFinite(Number(prefs.alertMinBalance)) && prefs.alertMinBalance !== "" ? Number(prefs.alertMinBalance) : 0;
    const low = forecast.points.filter((x) => x.date > today && x.date <= limit).reduce((m, x) => (!m || x.value < m.value ? x : m), null);
    if (low && low.value < threshold) out.push({ key: "total-low", level: low.value < 0 ? "high" : "warn", type: "total-low", value: low.value, date: low.date, threshold });
  }
  // 4. carte vicine al massimale (o oltre: chiave diversa, così rimandare il primo avviso non nasconde il secondo)
  for (const c of state.creditCards || []) {
    const info = totals.cards && totals.cards.get(c.id);
    if (!info) continue;
    const spent = round(info.spent, 2);
    if (info.limit > 0) {
      const pct = round((spent / info.limit) * 100, 4);
      if (pct >= 90) out.push({ key: pct > 100 ? `card-over:${c.id}` : `card:${c.id}`, level: pct > 100 ? "high" : "warn", type: "card-limit", cardId: c.id, name: c.name || "Carta", spent, limit: info.limit, pct });
    }
    // carta senza data di rinnovo con dello speso: l'addebito non si può prevedere bene
    if (!c.resetDate && spent > 0) out.push({ key: `card-reset:${c.id}`, level: "info", type: "card-no-reset", cardId: c.id, name: c.name || "Carta" });
  }
  // 5. budget del mese: già sforati o che al ritmo solito lo sforeranno
  if (budget && budget.daysLeft != null) {
    const ym = today.slice(0, 7);
    for (const r of budget.rows) {
      if (!(r.budget > 0)) continue;
      if (r.status === "over") out.push({ key: `budget-over:${r.name}:${ym}`, level: "high", type: "budget-over", name: r.name, spent: r.spent, budget: r.budget });
      else if (r.atRisk && Number(today.slice(8, 10)) >= 5) out.push({ key: `budget:${r.name}:${ym}`, level: "warn", type: "budget-risk", name: r.name, spent: r.spent, budget: r.budget, projected: r.projected });
    }
  }
  // 6. abbonamenti e spese ricorrenti con un aumento recente
  for (const r of recurring) {
    if (r.kind !== "Uscita" || !r.change || r.change.to <= r.change.from || daysBetween(r.change.date, today) > 45) continue;
    out.push({ key: `price:${r.key}:${r.change.date}`, level: "info", type: "price-up", name: r.label, from: r.change.from, to: r.change.to, date: r.change.date });
  }
  // 7. finanziamenti con la rata che l'app non registra da sola
  for (const l of state.loans || []) {
    if (toNum(l.remaining) > 0.005 && toNum(l.monthlyPayment) > 0 && !loanAutoPay(l)) out.push({ key: `loan-auto:${l.id}`, level: "info", type: "loan-manual", loanId: l.id, name: l.name || "Finanziamento" });
  }
  const snooze = prefs.alertSnooze && typeof prefs.alertSnooze === "object" ? prefs.alertSnooze : {};
  return out
    .filter((a) => !(snooze[a.key] && snooze[a.key] >= today))
    .sort((a, b) => ORDER[a.level] - ORDER[b.level] || String(a.date || "").localeCompare(String(b.date || "")));
}

// Rimanda un avviso: torna dopo "days" giorni. Le chiavi scadute si tolgono per non far crescere le impostazioni.
export function snoozeData(prefs, key, today, days = 7) {
  const cur = prefs.alertSnooze && typeof prefs.alertSnooze === "object" ? prefs.alertSnooze : {};
  const next = {};
  for (const [k, v] of Object.entries(cur)) if (typeof v === "string" && v >= today) next[k] = v;
  const n = Math.round(Number(days));
  next[key] = addDays(today, Number.isFinite(n) && n > 0 ? n : 7);
  return { alertSnooze: next };
}
