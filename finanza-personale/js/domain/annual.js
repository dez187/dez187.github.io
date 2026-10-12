import { round, toNum, fmtNum } from "../lib/format.js";
import { HOLDING_CLASSES, holdingValue } from "./finance.js";
import { resolveAsset } from "./pac.js";
import { SALES_CATEGORY } from "./forecast.js";
import { csvCell } from "../data/backup.js";

// Riepilogo annuale degli investimenti, utile per la dichiarazione dei redditi. Per ogni anno l'app salva
// in "annual/<anno>" le posizioni del primo giorno in cui viene aperta (start) e dell'ultimo (end): solo
// aggiunte, nessun altro dato viene toccato. Per gli anni prima di questa funzione servono i documenti del broker.

export const ANNUAL = "annual";

// "hid" e non "id": i backup tolgono i campi "id" (anche annidati), e l'identificativo dello strumento serve
// a distinguere le righe del riepilogo.
export function positionItems(state) {
  const items = [];
  for (const c of HOLDING_CLASSES) {
    for (const h of state[c.key] || []) {
      items.push({
        coll: c.key, hid: h.id, name: h.name || "", code: c.key === "crypto" ? h.symbol || "" : h.isin || "",
        broker: h.broker || h.exchange || "", quantity: round(toNum(h.quantity), 8), price: round(toNum(h.currentPrice), 6), value: round(holdingValue(h), 2),
      });
    }
  }
  return items.sort((a, b) => (a.coll + a.name).localeCompare(b.coll + b.name, "it"));
}

// Confronto per campi (l'ordine delle chiavi può cambiare dopo il salvataggio su Firestore).
const FIELDS = ["coll", "hid", "name", "code", "broker", "quantity", "price", "value"];
const norm = (list) => JSON.stringify((list || []).map((it) => FIELDS.map((f) => it[f] ?? null)));
const sameItems = (a, b) => norm(a) === norm(b);

// Operazioni per tenere aggiornato l'anno in corso. "fresh": i riepiloghi sono stati letti dal server,
// così un dispositivo con la copia locale vuota non riscrive l'inizio d'anno salvato da un altro.
// "holdingsFresh": gli investimenti sono stati letti dal server; solo allora, se non resta nessuna posizione
// (tutto venduto), la fine di un anno già cominciato diventa vuota. Una copia locale ancora vuota non la tocca.
export function annualOps(state, today, fresh, holdingsFresh = false) {
  const year = today.slice(0, 4);
  const items = positionItems(state);
  const doc = (state[ANNUAL] || []).find((d) => d.id === year);
  if (!items.length && !(doc && doc.start && holdingsFresh)) return [];
  const snap = { date: today, items };
  if (!doc) return fresh ? [{ op: "set", coll: ANNUAL, id: year, data: { year: Number(year), start: snap, end: snap } }] : [];
  if (doc.end && doc.end.date === today && sameItems(doc.end.items, items)) return [];
  if (doc.end && doc.end.date > today) return [];
  return [{ op: "merge", coll: ANNUAL, id: year, data: doc.start ? { end: snap } : { start: snap, end: snap } }];
}

// Anni disponibili nel riepilogo: quelli salvati più quello in corso.
export function annualYears(state, today) {
  const years = new Set((state[ANNUAL] || []).map((d) => Number(d.id)).filter(Number.isFinite));
  years.add(Number(today.slice(0, 4)));
  return [...years].sort((a, b) => b - a);
}

// Righe per strumento: quantità e valore a inizio e fine anno (per l'anno in corso, la fine è oggi),
// versamenti dei PAC nell'anno. Totali per broker; le vendite di investimenti dell'anno a parte.
export function annualReport(state, year, today) {
  const y = String(year);
  const doc = (state[ANNUAL] || []).find((d) => d.id === y) || null;
  const current = y === today.slice(0, 4);
  const start = doc && doc.start ? doc.start : null;
  const end = current ? { date: today, items: positionItems(state) } : doc && doc.end ? doc.end : null;
  const rows = new Map();
  const ref = (it) => it.hid ?? it.id ?? it.name;
  const key = (it) => `${it.coll}:${ref(it)}`;
  const base = (it) => ({ key: key(it), coll: it.coll, hid: ref(it), name: it.name, code: it.code, broker: it.broker, startQty: null, startValue: null, endQty: null, endValue: null, contributions: 0 });
  for (const it of (start && start.items) || []) rows.set(key(it), { ...base(it), startQty: it.quantity, startValue: it.value });
  for (const it of (end && end.items) || []) {
    const r = rows.get(key(it)) || base(it);
    Object.assign(r, { name: it.name || r.name, code: it.code || r.code, broker: it.broker || r.broker, endQty: it.quantity, endValue: it.value });
    rows.set(key(it), r);
  }
  let sales = 0, unattributed = 0;
  for (const t of state.transactions || []) {
    if (!t.date || t.date.slice(0, 4) !== y) continue;
    if (t.kind === "Entrata" && t.category === SALES_CATEGORY) sales += toNum(t.amount);
    if (!t.pacId) continue;
    // Lo strumento del versamento: quello salvato sul movimento (dai versamenti registrati dopo questa
    // versione), altrimenti quello attuale del piano.
    const pac = (state.pac || []).find((p) => p.id === t.pacId);
    const target = resolveAsset(t.asset || (pac && pac.asset), state);
    if (!target) { unattributed = round(unattributed + toNum(t.amount), 2); continue; }
    const k = `${target.coll}:${target.id}`;
    const r = rows.get(k) || base({ coll: target.coll, hid: target.id, name: target.holding.name, code: target.coll === "crypto" ? target.holding.symbol : target.holding.isin, broker: target.holding.broker || target.holding.exchange });
    r.contributions = round(r.contributions + toNum(t.amount), 2);
    rows.set(k, r);
  }
  const list = [...rows.values()].sort((a, b) => (a.broker + a.name).localeCompare(b.broker + b.name, "it"));
  const byBroker = new Map();
  for (const r of list) {
    const b = byBroker.get(r.broker || "") || { broker: r.broker || "", startValue: 0, endValue: 0, contributions: 0, count: 0 };
    b.startValue += r.startValue || 0;
    b.endValue += r.endValue || 0;
    b.contributions += r.contributions;
    b.count++;
    byBroker.set(r.broker || "", b);
  }
  const sum = (f) => round(list.reduce((s, r) => s + (r[f] || 0), 0), 2);
  return {
    year: Number(y), current, start, end, rows: list,
    byBroker: [...byBroker.values()].map((b) => ({ ...b, startValue: round(b.startValue, 2), endValue: round(b.endValue, 2), contributions: round(b.contributions, 2) })),
    totals: { startValue: start ? sum("startValue") : null, endValue: end ? sum("endValue") : null, contributions: round(sum("contributions") + unattributed, 2) },
    unattributed,
    sales: round(sales, 2),
  };
}

const LABEL = { etf: "ETF", stocks: "Azione", crypto: "Crypto" };
const num = (v, d = 2) => (v == null ? "" : fmtNum(v, d, d));

export function annualCsv(report) {
  const head = ["Tipo", "Strumento", "ISIN o simbolo", "Broker", `Quantità ${report.start ? report.start.date : "inizio anno"}`, `Valore ${report.start ? report.start.date : "inizio anno"}`, `Quantità ${report.end ? report.end.date : "fine anno"}`, `Valore ${report.end ? report.end.date : "fine anno"}`, "Versato con i PAC nell'anno"];
  const lines = [head.map(csvCell).join(";")];
  for (const r of report.rows) {
    lines.push([LABEL[r.coll] || r.coll, csvCell(r.name), csvCell(r.code), csvCell(r.broker), num(r.startQty, 6), num(r.startValue), num(r.endQty, 6), num(r.endValue), num(r.contributions)].join(";"));
  }
  return "﻿" + lines.join("\r\n");
}
