import { randomId } from "../lib/dom.js";

// Dati salvati solo in questo browser (localStorage). Utile per provare l'app senza Firebase.
export function createLocalBackend(key = "patrimonio:local:v1") {
  const load = () => {
    try {
      const raw = localStorage.getItem(key);
      const j = raw ? JSON.parse(raw) : null;
      return j && j.collections ? j : { collections: {} };
    } catch {
      return { collections: {} };
    }
  };
  let db = load();
  const subs = new Map();
  const docs = (coll) => Object.entries(db.collections[coll] || {}).map(([id, d]) => ({ id, ...d }));
  const notify = (colls) => {
    for (const c of colls) for (const cb of subs.get(c) || []) cb(docs(c));
  };
  const clone = (d) => JSON.parse(JSON.stringify(d ?? {}));

  const onStorage = (e) => {
    if (e.key !== key) return;
    db = load();
    notify([...subs.keys()]);
  };
  window.addEventListener("storage", onStorage);

  return {
    kind: "local",
    subscribe(coll, cb) {
      if (!subs.has(coll)) subs.set(coll, new Set());
      subs.get(coll).add(cb);
      queueMicrotask(() => cb(docs(coll)));
      return () => subs.get(coll)?.delete(cb);
    },
    newId: () => randomId(),
    // Tutto o niente, come un batch di Firestore.
    async write(ops) {
      const next = clone(db);
      for (const o of ops) {
        const c = (next.collections[o.coll] ||= {});
        if (o.op === "set") c[o.id] = clone(o.data);
        else if (o.op === "merge") c[o.id] = { ...(c[o.id] || {}), ...clone(o.data) };
        else if (o.op === "update") {
          if (!c[o.id]) throw new Error(`Elemento non trovato (${o.coll}/${o.id}).`);
          c[o.id] = { ...c[o.id], ...clone(o.data) };
        } else if (o.op === "delete") delete c[o.id];
      }
      const text = JSON.stringify(next);
      localStorage.setItem(key, text);
      db = next;
      notify(new Set(ops.map((o) => o.coll)));
    },
    destroy() {
      window.removeEventListener("storage", onStorage);
    },
  };
}
