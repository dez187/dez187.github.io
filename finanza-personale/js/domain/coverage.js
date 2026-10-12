import { addDays, daysBetween } from "../lib/dates.js";
import { round } from "../lib/format.js";
import { ACCOUNT_KINDS } from "./forecast.js";
import { coveredBy } from "./recurring.js";

// Addebiti scoperti: dalla previsione conto per conto (solo scadenze note), il primo giorno dei prossimi
// "days" in cui un conto andrebbe sotto zero, gli addebiti di quel giorno, quanto manca e da quale altro
// conto si potrebbe spostare. Solo calcolo, nessuna scrittura.

export const COVER_DAYS = 10;
// Il conto da cui spostare i soldi deve restare coperto per tutto questo periodo, non solo fino all'addebito.
const SOURCE_DAYS = 30;
// Da dove spostare i soldi: prima i conti correnti e le prepagate, poi i conti deposito; i contanti mai.
const SOURCE_RANK = { "Conto corrente": 0, "Carta prepagata": 0, "Conto deposito": 1 };

const roundUp = (v) => Math.ceil((v - 0.001) / 10) * 10;

function windowPoints(acc, today, end) {
  return acc.points.filter((p) => p.date > today && p.date <= end);
}

// Conto da cui prendere "need" euro: quello che, tolta la cifra, resta sopra zero con tutte le sue scadenze
// note fino a "until". taken: quanto è già stato proposto da ogni conto per gli altri avvisi.
function pickSource(forecast, state, exceptId, need, today, until, taken) {
  const meta = new Map((state.accounts || []).map((a) => [a.id, a]));
  const options = [];
  for (const acc of forecast.accounts || []) {
    if (acc.id === exceptId) continue;
    const a = meta.get(acc.id);
    if (!a || !(a.type in SOURCE_RANK)) continue;
    const spare = Math.min(acc.start, ...windowPoints(acc, today, until).map((p) => p.value)) - (taken.get(acc.id) || 0);
    if (spare >= need) options.push({ accountId: acc.id, name: acc.name, spare: round(spare, 2), rank: SOURCE_RANK[a.type] });
  }
  options.sort((x, y) => x.rank - y.rank || y.spare - x.spare);
  return options[0] || null;
}

// adjust(accountId, date) → quanto togliere al saldo previsto quel giorno (per lo stipendio in ritardo).
export function uncoveredDebits(forecast, state, today, { days = COVER_DAYS, adjust = null } = {}) {
  if (!forecast || !Array.isArray(forecast.accounts)) return [];
  const events = Array.isArray(forecast.events) ? forecast.events : [];
  const end = addDays(today, days);
  const out = [];
  for (const acc of forecast.accounts) {
    const pts = windowPoints(acc, today, end).map((p) => ({ date: p.date, value: p.value - (adjust ? adjust(acc.id, p.date) : 0) }));
    const first = pts.find((p) => p.value < -0.005);
    if (!first) continue;
    const debits = events.filter((e) => e.accountId === acc.id && e.date === first.date && e.amount < 0 && ACCOUNT_KINDS.has(e.kind) && e.kind !== "transfer");
    if (!debits.length) continue; // in rosso per un giroconto programmato: lo vede già l'avviso del conto
    const low = pts.reduce((m, p) => (p.value < m.value ? p : m), first);
    const shortfall = round(-low.value, 2);
    out.push({
      accountId: acc.id, name: acc.name, date: first.date, lowDate: low.date,
      debits: debits.map((e) => ({ label: e.label, amount: round(-e.amount, 2), kind: e.kind })),
      total: round(debits.reduce((s, e) => s - e.amount, 0), 2),
      shortfall, need: roundUp(shortfall), from: null,
    });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // Prima gli addebiti più vicini; lo stesso conto non si propone per più soldi di quanti ne può dare.
  // Un conto che va a sua volta scoperto non fa da fonte.
  const short = new Set(out.map((u) => u.accountId));
  const until = addDays(today, Math.max(days, SOURCE_DAYS));
  const taken = new Map();
  for (const u of out) {
    u.from = pickSource({ accounts: forecast.accounts.filter((a) => !short.has(a.id) || a.id === u.accountId) }, state, u.accountId, u.need, today, until, taken);
    if (u.from) taken.set(u.from.accountId, (taken.get(u.from.accountId) || 0) + u.need);
  }
  return out;
}

// Stipendio in ritardo: la ricorrenza dello stipendio è attesa da almeno "grace" giorni e non è arrivata.
// La previsione la conta comunque domani: qui si guarda cosa succede se non arriva nei prossimi giorni.
export function salaryLate(forecast, state, today, { grace = 2, days = COVER_DAYS } = {}) {
  const s = forecast && forecast.salary;
  if (!s || !s.accountId) return null;
  // Uno stipendio programmato si registra da solo: non può essere "in ritardo".
  if (coveredBy(s, state.schedules, state.loans)) return null;
  const expected = s.nextAmountDate || s.next;
  const late = daysBetween(expected, today);
  // Oltre tre settimane di ritardo è più probabile che manchino i movimenti (estratto non importato).
  if (!(late >= grace) || late > 21) return null;
  // La previsione conta lo stipendio in ritardo domani. Se non c'è, è già registrato (per esempio con una
  // data futura) e non manca niente.
  const ev = (forecast.events || []).find((e) => e.kind === "income" && e.estimated && e.accountId === s.accountId && e.label === s.label && e.date <= addDays(today, 1));
  if (!ev || !(ev.amount > 0)) return null;
  const amount = ev.amount;
  const from = ev.date;
  const risks = uncoveredDebits(forecast, state, today, { days, adjust: (id, d) => (id === s.accountId && d >= from ? amount : 0) })
    .filter((r) => r.accountId === s.accountId);
  return { expected, late, amount: round(amount, 2), accountId: s.accountId, label: s.label, risk: risks[0] || null };
}
