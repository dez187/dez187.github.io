import { occurrenceDate, perMonth } from "../lib/dates.js";
import { onDate, toNum } from "../lib/format.js";

// Operazioni programmate: spese/entrate ricorrenti (type "expense" | "income") e giroconti ripetuti ("transfer").
// Ogni occorrenza scaduta diventa un movimento con id deterministico "sch-<id>-<data>": rieseguire non crea doppioni.

export const END_MODES = ["Nessuna fine", "Numero di rate", "Data di fine"];
// Tetto ai conteggi (arretrati, ripresa dopo una pausa): con la frequenza giornaliera mille passi sono meno di tre anni.
const MAX_STEPS = 100000;

export function scheduleEnded(s, done, next) {
  if (s.endMode === "Numero di rate") return done >= toNum(s.endCount);
  if (s.endMode === "Data di fine") return !!s.endDate && next > s.endDate;
  return false;
}

export function nextOccurrence(s) {
  return occurrenceDate(s.startDate, s.frequency, toNum(s.done));
}

export function dueOccurrences(s, today, limit = 1000) {
  let done = toNum(s.done);
  const dates = [];
  while (dates.length < limit) {
    const next = occurrenceDate(s.startDate, s.frequency, done);
    if (scheduleEnded(s, done, next) || next > today) break;
    dates.push(next);
    done++;
  }
  const ended = scheduleEnded(s, done, occurrenceDate(s.startDate, s.frequency, done));
  const status = ended ? "Concluso" : s.status === "In pausa" ? "In pausa" : "Attivo";
  return { dates, done, status };
}

export const scheduleTxId = (scheduleId, date) => `sch-${scheduleId}-${date}`;

export function scheduleKind(s) {
  if (s.type === "transfer") return "Giroconto";
  return s.type === "income" ? "Entrata" : "Uscita";
}

// Movimenti già registrati da una programmazione (per annullarne la creazione).
export function scheduleTxDeleteOps(scheduleId, transactions) {
  return transactions.filter((t) => t.scheduleId === scheduleId).map((t) => ({ op: "delete", coll: "transactions", id: t.id }));
}

export function buildScheduleTx(s, date) {
  if (s.type === "transfer") {
    return {
      date, description: s.description || "Giroconto", category: "Giroconto", kind: "Giroconto",
      amount: toNum(s.amount), fromAccountId: s.fromAccountId || "", toAccountId: s.toAccountId || "", scheduleId: s.id,
    };
  }
  const tx = {
    date, description: s.description || "", category: s.category || "Altro", kind: scheduleKind(s),
    amount: toNum(s.amount), accountId: "", cardId: "", scheduleId: s.id,
  };
  const pw = String(s.payWith || "");
  if (pw.startsWith("card:")) tx.cardId = pw.slice(5);
  else if (pw.startsWith("account:")) tx.accountId = pw.slice(8);
  return tx;
}

// Operazioni da scrivere per registrare tutte le occorrenze scadute (le programmazioni in pausa restano ferme).
export function planSchedules(schedules, transactions, today) {
  const existing = new Set(transactions.map((t) => t.id));
  const ops = [];
  let created = 0;
  for (const s of schedules) {
    if (!s.startDate || !s.frequency || s.status === "In pausa") continue;
    const { dates, done, status } = dueOccurrences(s, today);
    if (!dates.length && status === s.status) continue;
    for (const date of dates) {
      const id = scheduleTxId(s.id, date);
      if (existing.has(id)) continue;
      ops.push({ op: "set", coll: "transactions", id, data: buildScheduleTx(s, date) });
      created++;
    }
    ops.push({ op: "update", coll: "schedules", id: s.id, data: { done, status } });
  }
  return { ops, created };
}

export function countDue(s, today) {
  return dueOccurrences({ ...s, done: 0, status: "Attivo" }, today, MAX_STEPS).dates.length;
}

// Alla ripresa, le occorrenze cadute durante la pausa vengono saltate (quella di oggi no).
export function resumePatch(s, today) {
  let done = toNum(s.done);
  for (let i = 0; i < MAX_STEPS; i++) {
    const next = occurrenceDate(s.startDate, s.frequency, done);
    if (next >= today || scheduleEnded(s, done, next)) break;
    done++;
  }
  return { status: "Attivo", done };
}

export const monthlyEquivalent = (s) => perMonth(toNum(s.amount), s.frequency);

export function scheduleEndText(s) {
  if (s.endMode === "Numero di rate") return `${toNum(s.done)} di ${toNum(s.endCount)} rate`;
  if (s.endMode === "Data di fine") return `fino ${onDate("a", s.endDate)}`;
  return "senza fine";
}

// Controlli sull'intervallo di fine: restituisce i campi da salvare o un messaggio d'errore.
export function readEnd(data, startDate) {
  const endMode = data.endMode || "Nessuna fine";
  if (endMode === "Numero di rate") {
    const n = Math.round(toNum(data.endCount));
    if (n < 1) return { error: "Il numero di rate deve essere almeno 1." };
    return { endMode, endCount: n, endDate: "" };
  }
  if (endMode === "Data di fine") {
    if (!data.endDate || data.endDate < startDate) return { error: "La data di fine non può precedere la prima data." };
    return { endMode, endCount: 0, endDate: data.endDate };
  }
  return { endMode: "Nessuna fine", endCount: 0, endDate: "" };
}
