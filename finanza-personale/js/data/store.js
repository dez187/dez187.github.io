import { COLLECTIONS } from "./backup.js";

// Stato reattivo sopra un "backend" (Firestore o locale) che espone:
//   subscribe(coll, onDocs(docs, meta?), onError) → annulla;  write(ops) → Promise;  newId() → string
// meta.fromCache = true quando i documenti arrivano dalla copia locale e non ancora dal server.
// Ogni operazione è { op: "set" | "update" | "merge" | "delete", coll, id, data }.

const ORDER = {
  transactions: (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)),
  history: (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0),
  pac: (a, b) => String(a.nextDate || "").localeCompare(String(b.nextDate || "")) || byName(a, b),
  schedules: (a, b) => String(a.startDate || "").localeCompare(String(b.startDate || "")),
};
function byName(a, b) {
  return String(a.name || "").localeCompare(String(b.name || ""), "it", { sensitivity: "base" });
}

export function createStore(backend) {
  const state = { settings: {} };
  for (const c of COLLECTIONS) state[c] = [];
  const loaded = new Set();
  const fresh = new Set();
  const listeners = new Set();
  const errorListeners = new Set();
  let version = 0;
  let queued = false;

  const emit = () => {
    version++;
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      for (const fn of listeners) fn(state);
    });
  };

  const unsubs = [...COLLECTIONS, "settings"].map((coll) =>
    backend.subscribe(
      coll,
      (docs, meta) => {
        if (coll === "settings") state.settings = docs.find((d) => d.id === "prefs") || {};
        else state[coll] = docs.sort(ORDER[coll] || byName);
        loaded.add(coll);
        if (!meta || meta.fromCache === false) fresh.add(coll);
        else if (meta.fromCache === true) fresh.delete(coll); // offline o non ancora confermata: la copia può essere vecchia
        emit();
      },
      (err) => {
        loaded.add(coll);
        for (const fn of errorListeners) fn(coll, err);
        emit();
      }
    )
  );

  function commit(ops) {
    const list = (ops || []).filter(Boolean);
    if (!list.length) return Promise.resolve();
    return backend.write(list);
  }

  return {
    state,
    backend,
    get version() { return version; },
    get ready() { return COLLECTIONS.every((c) => loaded.has(c)) && loaded.has("settings"); },
    // Vero quando l'ultima istantanea della collezione arriva dal server (sempre, in modalità locale).
    isFresh(coll) { return fresh.has(coll); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onError(fn) { errorListeners.add(fn); return () => errorListeners.delete(fn); },
    newId: () => backend.newId(),
    commit,
    find(coll, id) { return (state[coll] || []).find((d) => d.id === id) || null; },
    stop() { unsubs.forEach((u) => u && u()); listeners.clear(); errorListeners.clear(); },
  };
}

// Operazioni inverse, per il pulsante "Annulla" dopo un salvataggio o un'eliminazione.
export function invertOps(ops, state) {
  const inv = [];
  for (const o of ops) {
    const prev = (state[o.coll] || []).find((d) => d.id === o.id);
    const prevData = prev ? stripId(prev) : null;
    if (o.op === "delete") {
      if (prevData) inv.push({ op: "set", coll: o.coll, id: o.id, data: prevData });
    } else if (!prevData) {
      inv.push({ op: "delete", coll: o.coll, id: o.id });
    } else {
      inv.push({ op: "set", coll: o.coll, id: o.id, data: prevData });
    }
  }
  return inv.reverse();
}

export function stripId(doc) {
  const { id, ...data } = doc;
  return data;
}
