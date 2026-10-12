import { addDays } from "../lib/dates.js";
import { fmtEUR, MINUS, round } from "../lib/format.js";
import { hashString } from "./csvimport.js";

// Scadenze dei prossimi mesi per il calendario del telefono (vedi lib/ics.js): dalla previsione, le uscite
// note (rate, addebiti delle carte, programmate, PAC, rate a pagamento, ricorrenze, spese annuali stimate)
// e le entrate importanti, più un promemoria per controllare che lo stipendio sia arrivato.

const LABEL = { tx: "Movimento già registrato", transfer: "Giroconto", schedule: "Operazione programmata", income: "Entrata", loan: "Rata del finanziamento", pac: "Piano di accumulo", recurring: "Spesa ricorrente", card: "Addebito della carta", annual: "Spesa annuale (come l'anno scorso)", extra: "Mensilità extra", instalment: "Rata a pagamento" };
const MIN_AMOUNT = 5;
const ALARM_FROM = 50;

export function calendarEvents(forecast, state, today) {
  if (!forecast) return [];
  const accounts = new Map((state.accounts || []).map((a) => [a.id, a.name || "Conto"]));
  const salary = forecast.salary;
  const out = [];
  const seen = new Map();
  for (const e of forecast.events || []) {
    const abs = Math.abs(e.amount);
    if (abs < MIN_AMOUNT) continue;
    if (e.kind === "transfer" && e.amount > 0) continue; // del giroconto basta il lato che parte
    if (e.kind === "income" && !(salary && e.label === salary.label && e.accountId === salary.accountId) && abs < ALARM_FROM) continue;
    const sign = e.amount > 0 ? "+" : MINUS;
    const where = accounts.get(e.accountId) || "";
    // Le stime (stipendio, ricorrenze, rate) si spostano di qualche giorno da un'esportazione all'altra: il loro
    // UID usa il mese, così reimportando il file l'evento si aggiorna invece di comparire due volte.
    const base = `${e.kind}|${e.accountId}|${e.estimated ? e.date.slice(0, 7) : e.date}|${hashString(String(e.label || ""))}`;
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    out.push({
      uid: `${base.replace(/\|/g, "-")}${n ? `-${n}` : ""}@patrimonio`,
      date: e.date,
      title: `${sign}${fmtEUR(round(abs, 2))} · ${e.label || LABEL[e.kind] || "Scadenza"}`,
      description: [LABEL[e.kind] || "", where ? `Conto: ${where}` : "", e.estimated ? "Importo stimato dall'app" : ""].filter(Boolean).join("\n"),
      alarm: e.amount < 0 && abs >= ALARM_FROM ? "before" : false,
    });
  }
  // Stipendio: un promemoria due giorni dopo il giorno solito, per accorgersi subito di un ritardo.
  if (salary && salary.next && salary.next > today) {
    const date = addDays(salary.next, 2);
    out.push({ uid: `salary-check-${date.slice(0, 7)}@patrimonio`, date, title: `Controlla che ${String(salary.label || "lo stipendio").toLowerCase() === "stipendio" ? "lo stipendio" : salary.label} sia arrivato`, description: `Di solito arriva intorno ${salary.next.slice(8, 10) === "01" || salary.next.slice(8, 10) === "08" || salary.next.slice(8, 10) === "11" ? "all'" : "al "}${Number(salary.next.slice(8, 10))}: se manca, apri Patrimonio per vedere quali addebiti restano scoperti.`, alarm: "morning" });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
