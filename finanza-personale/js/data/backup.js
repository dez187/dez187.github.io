import { fmtNum, toNum } from "../lib/format.js";
import { txRoute } from "../domain/finance.js";

export const COLLECTIONS = ["accounts", "creditCards", "loans", "transactions", "schedules", "etf", "stocks", "crypto", "pac", "history", "categories", "rules", "goals", "annual"];
export const BACKUP_FORMAT = "patrimonio-backup";
export const PATCH_FORMAT = "patrimonio-patch";

const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;

// Le impostazioni ("settings/prefs": soglie degli avvisi, avvisi rimandati, preferenze) viaggiano col backup
// a parte: all'importazione si uniscono a quelle presenti e non vengono mai cancellate.
export function buildBackup(state, exportedAt = new Date().toISOString()) {
  const collections = {};
  for (const c of COLLECTIONS) {
    collections[c] = (state[c] || []).map(({ id, ...data }) => ({ id, data }));
  }
  const { id: _id, ...prefs } = state.settings || {};
  if (Object.keys(prefs).length) collections.settings = [{ id: "prefs", data: prefs }];
  return { format: BACKUP_FORMAT, version: 2, exportedAt, collections };
}

function cleanValue(v, depth) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v.slice(0, 5000);
  if (typeof v === "boolean") return v;
  if (depth > 4) return null;
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => cleanValue(x, depth + 1));
  if (typeof v === "object") return cleanData(v, depth + 1);
  return null;
}

function cleanData(obj, depth = 0) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (!k || k.startsWith("__") || k === "id" || k.length > 100) continue;
    const c = cleanValue(v, depth);
    if (c !== null && c !== undefined) out[k] = c;
  }
  return out;
}

// Legge un backup del nuovo formato (con id) o l'esportazione JSON del vecchio artifact (senza id).
export function parseBackup(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("Il file non è un backup valido.");
  const warnings = [];
  const collections = {};
  if (json.format === BACKUP_FORMAT) {
    if (!json.collections || typeof json.collections !== "object") throw new Error("Il backup non contiene dati.");
    for (const c of COLLECTIONS) {
      const list = json.collections[c];
      if (!Array.isArray(list)) continue;
      const seen = new Set();
      collections[c] = [];
      for (const row of list) {
        if (!row || typeof row !== "object" || !ID_RE.test(String(row.id || "")) || /^__.*__$/.test(row.id)) {
          warnings.push(`Un elemento di "${c}" senza identificativo valido è stato ignorato.`);
          continue;
        }
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        collections[c].push({ id: row.id, data: cleanData(row.data) });
      }
    }
    const prefs = Array.isArray(json.collections.settings) ? json.collections.settings.find((r) => r && r.id === "prefs" && r.data && typeof r.data === "object") : null;
    if (prefs) collections.settings = [{ id: "prefs", data: cleanData(prefs.data) }];
    return { collections, legacy: false, warnings, exportedAt: json.exportedAt || null };
  }
  let found = false;
  for (const c of COLLECTIONS) {
    const list = json[c];
    if (!Array.isArray(list)) continue;
    found = true;
    collections[c] = list.filter((d) => d && typeof d === "object").map((d, i) => ({
      id: c === "history" && /^\d{4}-\d{2}-\d{2}$/.test(d.date || "") ? d.date : `imp-${c}-${i + 1}`,
      data: cleanData(d),
    }));
  }
  if (!found) throw new Error("Il file non contiene dati riconoscibili.");
  warnings.push("Questo file viene dall'esportazione del vecchio artifact, che non salvava gli identificativi: movimenti, piani di accumulo e programmazioni andranno ricollegati ai conti. Se possibile usa il backup completo.");
  return { collections, legacy: true, warnings, exportedAt: json.exportedAt || null };
}

// File di aggiornamenti: modifica solo i campi indicati degli elementi esistenti, trovati per id,
// ISIN, simbolo o nome. Es. { format: "patrimonio-patch", updates: [{ coll: "etf", match: { isin }, data: { avgPrice } }] }
export function parsePatch(json) {
  if (!json || json.format !== PATCH_FORMAT || !Array.isArray(json.updates)) throw new Error("Il file non contiene aggiornamenti validi.");
  const updates = [];
  for (const u of json.updates.slice(0, 2000)) {
    if (!u || !COLLECTIONS.includes(u.coll) || !u.match || typeof u.match !== "object") continue;
    const match = {};
    for (const k of ["id", "isin", "symbol", "name"]) if (typeof u.match[k] === "string" && u.match[k].trim()) match[k] = u.match[k].trim();
    const data = cleanData(u.data);
    if (!Object.keys(match).length || !Object.keys(data).length) continue;
    updates.push({ coll: u.coll, match, data, create: u.create === true });
  }
  return { updates, note: typeof json.note === "string" ? json.note.slice(0, 500) : "", createdAt: json.createdAt || null };
}

// Cerca per id, poi ISIN, simbolo e nome: il primo criterio che trova qualcosa vince.
function findTarget(list, match) {
  const eq = (a, b) => String(a || "").trim().toUpperCase() === String(b || "").trim().toUpperCase();
  return (
    (match.id && list.find((d) => d.id === match.id)) ||
    (match.isin && list.find((d) => eq(d.isin, match.isin))) ||
    (match.symbol && list.find((d) => eq(d.symbol, match.symbol))) ||
    (match.name && list.find((d) => eq(d.name, match.name))) ||
    null
  );
}

// Per ogni aggiornamento: l'elemento trovato, i campi che cambiano (prima → dopo) e l'operazione.
// Gli aggiornamenti con "create" aggiungono la voce, se non esiste ancora.
export function patchPlan(patch, state, newId = () => "") {
  const rows = [];
  for (const u of patch.updates) {
    const doc = findTarget(state[u.coll] || [], u.match);
    if (!doc) {
      if (u.create) rows.push({ ...u, doc: null, isNew: true, changes: [], op: { op: "set", coll: u.coll, id: newId(), data: { ...u.data } } });
      else rows.push({ ...u, doc: null, changes: [] });
      continue;
    }
    const changes = Object.entries(u.data)
      .filter(([k, v]) => JSON.stringify(doc[k]) !== JSON.stringify(v))
      .map(([field, to]) => ({ field, from: doc[field], to }));
    rows.push({ ...u, doc, changes, op: changes.length ? { op: "update", coll: u.coll, id: doc.id, data: Object.fromEntries(changes.map((c) => [c.field, c.to])) } : null });
  }
  return rows;
}

// Backup completo: contiene almeno conti, carte, finanziamenti, movimenti e investimenti (anche vuoti).
// Solo così "Sostituisci" non rischia di cancellare dati che nel file non ci sono.
const CORE = ["accounts", "creditCards", "loans", "transactions", "etf", "stocks", "crypto"];
export function isFullBackup(parsed) {
  return !!parsed && CORE.every((c) => Array.isArray(parsed.collections[c]));
}

export function backupCounts(parsed) {
  return COLLECTIONS.map((c) => ({ coll: c, count: (parsed.collections[c] || []).length })).filter((x) => x.count > 0);
}

// "merge": aggiunge e sovrascrive per id. "replace": prima elimina tutto ciò che non è nel backup,
// anche negli archivi che il backup non contiene (es. regole e obiettivi in un backup più vecchio).
export function importOps(parsed, state, mode) {
  const ops = [];
  for (const c of COLLECTIONS) {
    const rows = parsed.collections[c] || [];
    if (mode === "replace") {
      const keep = new Set(rows.map((r) => r.id));
      for (const d of state[c] || []) if (!keep.has(d.id)) ops.push({ op: "delete", coll: c, id: d.id });
    }
    for (const r of rows) {
      // Unendo un backup, di un riepilogo annuale si tiene l'inizio più vecchio e la fine più recente:
      // un backup più vecchio non lo fa tornare indietro, e l'inizio d'anno del backup non si perde.
      if (mode !== "replace" && c === "annual") {
        const cur = (state[c] || []).find((d) => d.id === r.id);
        if (cur && (cur.start || cur.end)) {
          const curStart = cur.start && cur.start.date, newStart = r.data.start && r.data.start.date;
          const curEnd = cur.end && cur.end.date, newEnd = r.data.end && r.data.end.date;
          const start = curStart && (!newStart || curStart <= newStart) ? cur.start : r.data.start || cur.start;
          const end = curEnd && (!newEnd || curEnd >= newEnd) ? cur.end : r.data.end || cur.end;
          if (start === cur.start && end === cur.end) continue;
          const { id: _id, ...curData } = cur;
          ops.push({ op: "set", coll: c, id: r.id, data: { ...curData, ...r.data, start, end } });
          continue;
        }
      }
      ops.push({ op: "set", coll: c, id: r.id, data: r.data });
    }
  }
  const prefs = (parsed.collections.settings || []).find((r) => r.id === "prefs");
  if (prefs && Object.keys(prefs.data).length) ops.push({ op: "merge", coll: "settings", id: "prefs", data: prefs.data });
  return ops;
}

export function wipeOps(state) {
  const ops = [];
  for (const c of COLLECTIONS) for (const d of state[c] || []) ops.push({ op: "delete", coll: c, id: d.id });
  return ops;
}

// Protegge i fogli di calcolo dalle formule nascoste nei testi (=, +, -, @ all'inizio).
export function csvCell(v) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[;"\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function transactionsCsv(state) {
  const lines = [["Data", "Descrizione", "Categoria", "Tipo", "Importo", "Conto", "Persona", "Da restituire", "Viaggio o evento"].join(";")];
  const rows = [...(state.transactions || [])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  for (const t of rows) {
    lines.push([
      t.date || "",
      csvCell(t.description),
      csvCell(t.category || ""),
      t.kind || "",
      fmtNum(toNum(t.amount), 2, 2),
      csvCell(txRoute(t, state)),
      csvCell(t.person || ""),
      Number(t.owed) > 0 ? fmtNum(toNum(t.owed), 2, 2) : "",
      csvCell(t.tag || ""),
    ].join(";"));
  }
  return "﻿" + lines.join("\r\n");
}
