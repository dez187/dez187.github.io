import { round, toNum } from "../lib/format.js";
import { normText, RULE_KINDS } from "./rules.js";
import { categoryId, guessEmoji } from "./categories.js";
import { ACCOUNT_TYPES } from "./finance.js";
import { isValidIban, normalizeIban } from "../lib/iban.js";

// Pacchetto di movimenti preparato fuori dall'app, per esempio dagli estratti conto di un anno:
// movimenti già puliti e collegati a conti e carte, con categorie, regole, correzioni dei movimenti
// già registrati e, se c'è, lo storico del disponibile ricostruito. Si importa tutto insieme, con
// anteprima e controllo dei doppioni.
export const BUNDLE_FORMAT = "patrimonio-movimenti";
// Valore della scelta "crea un conto nuovo" per una fonte che nell'app non esiste ancora.
export const CREATE = "__new__";

const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const KEY_RE = /^(account|card):[A-Za-z0-9_\-.~:@+]{1,200}$/;
const KINDS = ["Uscita", "Entrata", "Giroconto"];
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const str = (v, max = 300) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const idOf = (v) => (typeof v === "string" && ID_RE.test(v) ? v : "");
const amountOf = (v) => (v && isDate(v.date) && Number.isFinite(Number(v.value)) ? { value: round(Number(v.value), 2), date: v.date } : null);

// I due lati di un giroconto: un conto oppure una carta (ricarica fatta con la carta, pagamento della carta).
function transferSides(t) {
  const fromCardId = idOf(t.fromCardId), toCardId = idOf(t.toCardId);
  return {
    fromAccountId: fromCardId ? "" : idOf(t.fromAccountId), fromCardId,
    toAccountId: toCardId ? "" : idOf(t.toAccountId), toCardId,
  };
}

export function parseBundle(json) {
  if (!json || json.format !== BUNDLE_FORMAT || !Array.isArray(json.transactions)) throw new Error("Il file non contiene un pacchetto di movimenti.");
  const sources = [];
  for (const s of Array.isArray(json.sources) ? json.sources.slice(0, 50) : []) {
    const key = str(s && s.key, 220);
    if (!KEY_RE.test(key) || sources.some((x) => x.key === key)) continue;
    const type = key.slice(0, key.indexOf(":"));
    const src = { key, type, id: key.slice(key.indexOf(":") + 1), name: str(s.name, 120) || key, file: str(s.file, 200), from: isDate(s.from) ? s.from : "", to: isDate(s.to) ? s.to : "" };
    if (type === "account" && amountOf(s.balance)) src.balance = amountOf(s.balance);
    if (type === "card" && amountOf(s.spent)) src.spent = amountOf(s.spent);
    if (type === "account" && s.create && typeof s.create === "object") {
      src.create = { type: ACCOUNT_TYPES.includes(s.create.type) ? s.create.type : "Altro", bank: str(s.create.bank, 80) };
      if (typeof s.create.iban === "string" && isValidIban(s.create.iban)) src.create.iban = normalizeIban(s.create.iban);
    }
    sources.push(src);
  }
  const seen = new Set();
  const transactions = [];
  let skipped = 0;
  for (const t of json.transactions.slice(0, 20000)) {
    const id = t ? idOf(String(t.id || "")) : "";
    const amount = round(Math.abs(toNum(t && t.amount)), 2);
    if (!id || seen.has(id) || !isDate(t.date) || !(amount > 0) || !KINDS.includes(t.kind)) { skipped++; continue; }
    const tx = { date: t.date, description: str(t.description) || "Movimento", amount, kind: t.kind, source: "estratto" };
    if (t.kind === "Giroconto") {
      Object.assign(tx, { category: "Giroconto" }, transferSides(t));
      if (!(tx.fromAccountId || tx.fromCardId) && !(tx.toAccountId || tx.toCardId)) { skipped++; continue; }
    } else {
      Object.assign(tx, { category: str(t.category, 80) || (t.kind === "Entrata" ? "Altre entrate" : "Altro"), accountId: idOf(t.accountId), cardId: idOf(t.cardId) });
      if (!tx.accountId === !tx.cardId) { skipped++; continue; }
      if (t.kind === "Uscita" && tx.accountId && idOf(t.cardPaymentFor)) {
        tx.cardPaymentFor = t.cardPaymentFor;
        if (isDate(t.cycleFrom) && isDate(t.cycleTo) && t.cycleFrom < t.cycleTo) Object.assign(tx, { cycleFrom: t.cycleFrom, cycleTo: t.cycleTo });
      }
    }
    const note = str(t.note, 500);
    if (note) tx.note = note;
    seen.add(id);
    transactions.push({ id, data: tx });
  }
  // Correzioni di movimenti già registrati: solo campi noti, controllati come sopra.
  const corrections = [];
  for (const c of Array.isArray(json.corrections) ? json.corrections.slice(0, 500) : []) {
    const id = c ? idOf(String(c.id || "")) : "";
    if (!id || !c.data || typeof c.data !== "object" || corrections.some((x) => x.id === id)) continue;
    const d = c.data, data = {};
    if (d.amount != null && toNum(d.amount) > 0) data.amount = round(Math.abs(toNum(d.amount)), 2);
    if (isDate(d.date)) data.date = d.date;
    if (str(d.description)) data.description = str(d.description);
    if (str(d.category, 80)) data.category = str(d.category, 80);
    if (KINDS.includes(d.kind)) {
      data.kind = d.kind;
      if (d.kind === "Giroconto") Object.assign(data, { category: "Giroconto", accountId: "", cardId: "" }, transferSides(d));
      else Object.assign(data, { accountId: idOf(d.accountId), cardId: idOf(d.cardId), fromAccountId: "", toAccountId: "", fromCardId: "", toCardId: "" });
    }
    if (Object.keys(data).length) corrections.push({ id, data, note: str(c.note, 300) });
  }
  const categories = [];
  for (const c of Array.isArray(json.categories) ? json.categories.slice(0, 200) : []) {
    const name = str(c && c.name, 60);
    if (!name || name === "Giroconto" || categories.some((x) => x.name === name)) continue;
    categories.push({ name, emoji: str(c.emoji, 8) || guessEmoji(name), kind: c.kind === "Entrata" ? "Entrata" : "Uscita" });
  }
  const rules = [];
  for (const r of Array.isArray(json.rules) ? json.rules.slice(0, 500) : []) {
    const pattern = str(r && r.pattern, 80);
    const category = str(r && r.category, 80);
    if (normText(pattern).length < 2 || !category) continue;
    rules.push({ pattern, category, kind: RULE_KINDS.includes(r.kind) ? r.kind : "Tutti" });
  }
  const history = [];
  for (const h of Array.isArray(json.history) ? json.history.slice(0, 4000) : []) {
    if (h && isDate(h.date) && Number.isFinite(Number(h.liquidity)) && !history.some((x) => x.date === h.date)) history.push({ date: h.date, liquidity: round(Number(h.liquidity), 2) });
  }
  history.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { note: str(json.note, 500), createdAt: str(json.createdAt, 40), sources, transactions, corrections, categories, rules, history, skipped };
}

// Dove finisce ogni fonte nell'app: lo stesso id se esiste ancora, altrimenti un conto (o una carta)
// con lo stesso nome; per un conto da creare CREATE; null = non importare.
export function defaultMapping(sources, state) {
  const map = new Map();
  for (const s of sources) {
    const list = s.type === "card" ? state.creditCards || [] : state.accounts || [];
    const hit = list.find((x) => x.id === s.id) || list.find((x) => normText(x.name) === normText(s.name));
    map.set(s.key, hit ? hit.id : s.create ? CREATE : null);
  }
  return map;
}

// Applica la scelta dei conti: gli id delle fonti diventano quelli dell'app. Restituisce null se il
// movimento non ha più un conto o una carta (fonte esclusa o conto inesistente).
export function remapTransaction(data, mapping, state) {
  const has = (type, id) => (type === "card" ? state.creditCards || [] : state.accounts || []).some((x) => x.id === id);
  const resolve = (type, id) => {
    if (!id) return "";
    const key = `${type}:${id}`;
    if (mapping.has(key)) {
      const v = mapping.get(key);
      return v === CREATE ? id : v || null;
    }
    return has(type, id) ? id : null;
  };
  const out = { ...data };
  if (data.kind === "Giroconto") {
    // Un lato escluso resta "non indicato"; se mancano tutti e due il movimento non serve.
    out.fromCardId = resolve("card", data.fromCardId) || "";
    out.fromAccountId = out.fromCardId ? "" : resolve("account", data.fromAccountId) || "";
    out.toCardId = resolve("card", data.toCardId) || "";
    out.toAccountId = out.toCardId ? "" : resolve("account", data.toAccountId) || "";
    return out.fromAccountId || out.fromCardId || out.toAccountId || out.toCardId ? out : null;
  }
  if (data.cardId) {
    const card = resolve("card", data.cardId);
    if (!card) return null;
    out.cardId = card;
    out.accountId = "";
  } else {
    const acc = resolve("account", data.accountId);
    if (!acc) return null;
    out.accountId = acc;
    out.cardId = "";
  }
  if (data.cardPaymentFor) {
    const card = resolve("card", data.cardPaymentFor);
    if (card) out.cardPaymentFor = card;
    else { delete out.cardPaymentFor; delete out.cycleFrom; delete out.cycleTo; }
  }
  return out;
}

// I lati di un movimento: su quale conto o carta entra o esce denaro. Per una carta "out" è una
// spesa o una ricarica fatta con la carta, "in" un rimborso o un pagamento della carta.
export function txSides(t) {
  if (t.kind === "Giroconto") {
    const from = t.fromCardId ? `card:${t.fromCardId}` : t.fromAccountId ? `account:${t.fromAccountId}` : "";
    const to = t.toCardId ? `card:${t.toCardId}` : t.toAccountId ? `account:${t.toAccountId}` : "";
    return [from && { key: from, dir: "out" }, to && { key: to, dir: "in" }].filter(Boolean);
  }
  const dir = t.kind === "Entrata" ? "in" : "out";
  if (t.cardId) return [{ key: `card:${t.cardId}`, dir }];
  if (t.accountId) return [{ key: `account:${t.accountId}`, dir }];
  return [];
}

// Stato di ogni movimento del pacchetto rispetto a quelli già nell'app: "imported" (stesso id,
// pacchetto già importato), "present" (stesso importo e verso sullo stesso conto, stessa data),
// "similar" (a pochi giorni di distanza) oppure "new". items: [{ id, data }] già rimappati.
export function bundleStatus(items, existing, toleranceDays = 3) {
  const ids = new Set(existing.map((t) => t.id));
  const own = new Set(items.map((t) => t.id));
  const byCents = new Map();
  for (const e of existing) {
    if (!e.date || own.has(e.id)) continue;
    const k = Math.round(toNum(e.amount) * 100);
    if (!byCents.has(k)) byCents.set(k, []);
    byCents.get(k).push(e);
  }
  const dayNum = (d) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86400000;
  const used = new Set();
  return items.map(({ id, data }) => {
    if (ids.has(id)) return { status: "imported" };
    const sides = txSides(data);
    const candidates = (byCents.get(Math.round(data.amount * 100)) || []).filter((e) => !used.has(e.id) && txSides(e).some((x) => sides.some((y) => x.key === y.key && x.dir === y.dir)));
    let hit = candidates.find((e) => e.date === data.date);
    if (hit) { used.add(hit.id); return { status: "present", of: hit }; }
    hit = candidates.find((e) => Math.abs(dayNum(e.date) - dayNum(data.date)) <= toleranceDays);
    if (hit) { used.add(hit.id); return { status: "similar", of: hit }; }
    return { status: "new" };
  });
}

// Effetto dei movimenti scelti su un conto o una carta, e cosa proporre per il saldo:
// "file" = saldo (o speso) dell'estratto, "today" = il valore che si vede ora vale da oggi, "keep" = com'è.
export function anchorPlan(source, target, chosen, today) {
  if (!target) return null;
  const card = source.type === "card";
  const key = `${source.type}:${target.id}`;
  const asOf = (card ? target.spentDate : target.balanceDate) || "";
  let delta = 0, count = 0;
  for (const t of chosen) {
    if (!t.date || t.date <= asOf || t.date > today) continue;
    for (const s of txSides(t)) {
      if (s.key !== key) continue;
      // Per i conti un'entrata aumenta il saldo; per le carte una spesa aumenta lo speso.
      delta += (s.dir === "in" ? 1 : -1) * (card ? -1 : 1) * toNum(t.amount);
      count++;
    }
  }
  const fromFile = card ? source.spent : source.balance;
  const options = [];
  if (fromFile && (!asOf || fromFile.date >= asOf)) options.push("file");
  if (!asOf) options.push("today");
  options.push("keep");
  return { asOf, delta: round(delta, 2), count, options, mode: options[0] };
}

// current = saldo (o speso) effettivo che l'app mostra adesso, prima dell'importazione: con "today"
// diventa il valore registrato a oggi, così quello che si vede non cambia.
export function anchorOps(source, target, mode, today, current) {
  if (!target || mode === "keep") return [];
  const card = source.type === "card";
  const value = round(Number.isFinite(current) ? current : toNum(card ? target.spent : target.balance), 2);
  if (card) {
    if (mode === "file" && source.spent) return [{ op: "update", coll: "creditCards", id: target.id, data: { spent: source.spent.value, spentDate: source.spent.date } }];
    return mode === "today" && !target.spentDate ? [{ op: "update", coll: "creditCards", id: target.id, data: { spent: value, spentDate: today } }] : [];
  }
  if (mode === "file" && source.balance) return [{ op: "update", coll: "accounts", id: target.id, data: { balance: source.balance.value, balanceDate: source.balance.date } }];
  if (mode === "today" && !target.balanceDate) return [{ op: "update", coll: "accounts", id: target.id, data: { balance: value, balanceDate: today } }];
  return [];
}

// Conto nuovo per una fonte che nell'app non c'è: nasce con il saldo dell'estratto.
export function createOps(source, today, now = 0) {
  if (source.type !== "account" || !source.create) return [];
  return [{
    op: "set", coll: "accounts", id: source.id,
    data: { name: source.name, type: source.create.type, bank: source.create.bank, ...(source.create.iban ? { iban: source.create.iban } : {}), balance: source.balance ? source.balance.value : 0, balanceDate: source.balance ? source.balance.date : today, note: "", createdAt: now },
  }];
}

// Correzioni applicabili: solo per movimenti che esistono ancora e che cambierebbero davvero.
export function correctionRows(bundle, transactions) {
  const out = [];
  for (const c of bundle.corrections) {
    const t = transactions.find((x) => x.id === c.id);
    if (!t) continue;
    const data = Object.fromEntries(Object.entries(c.data).filter(([k, v]) => (t[k] ?? "") !== v));
    if (Object.keys(data).length) out.push({ id: c.id, tx: t, data, note: c.note });
  }
  return out;
}

// Categorie che mancano (quelle del pacchetto e quelle usate dai movimenti scelti).
export function missingCategoryOps(bundle, chosen, categories) {
  const names = new Set(categories.map((c) => c.name));
  const ops = [];
  const add = (name, kind, emoji) => {
    if (!name || name === "Giroconto" || names.has(name)) return;
    names.add(name);
    ops.push({ op: "set", coll: "categories", id: categoryId(name), data: { name, emoji: emoji || guessEmoji(name), kind, budget: 0, order: 900 } });
  };
  for (const c of bundle.categories) if (chosen.some((t) => t.category === c.name)) add(c.name, c.kind, c.emoji);
  for (const t of chosen) if (t.kind !== "Giroconto") add(t.category, t.kind === "Entrata" ? "Entrata" : "Uscita");
  return ops;
}

// Regole nuove (testo e tipo non ancora presenti).
export function newRules(bundle, rules) {
  const have = new Set(rules.map((r) => `${normText(r.pattern)}|${r.kind || "Tutti"}`));
  const out = [];
  for (const r of bundle.rules) {
    const k = `${normText(r.pattern)}|${r.kind}`;
    if (have.has(k)) continue;
    have.add(k);
    out.push(r);
  }
  return out;
}

// Storico del disponibile: i giorni nuovi si aggiungono; quelli già registrati si correggono (solo
// il disponibile: gli altri valori del giorno restano) se overwrite è vero e se il valore cambia.
export function historyOps(bundle, history, overwrite = true) {
  const have = new Map(history.map((h) => [h.date, h]));
  const ops = [];
  for (const h of bundle.history) {
    const cur = have.get(h.date);
    if (!cur) ops.push({ op: "set", coll: "history", id: h.date, data: { date: h.date, liquidity: h.liquidity, rebuilt: true } });
    else if (overwrite && !(cur.rebuilt && Math.abs(cur.liquidity - h.liquidity) < 0.005)) ops.push({ op: "merge", coll: "history", id: h.date, data: { liquidity: h.liquidity, rebuilt: true } });
  }
  return ops;
}
