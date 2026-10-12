// Regole automatiche: "se la descrizione contiene X, usa la categoria Y".
// Il confronto ignora maiuscole, accenti e spazi doppi.

export function normText(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

export const RULE_KINDS = ["Tutti", "Uscita", "Entrata"];
const GENERIC = new Set(["", "Altro", "Altre entrate", "Giroconto"]);

export function ruleMatches(rule, description, kind) {
  const p = normText(rule.pattern);
  if (!p) return false;
  if (rule.kind && rule.kind !== "Tutti" && kind && rule.kind !== kind) return false;
  return normText(description).includes(p);
}

// Le regole più specifiche (testo più lungo) vincono; a parità, la più vecchia.
export function sortRules(rules) {
  return [...rules].sort((a, b) => normText(b.pattern).length - normText(a.pattern).length || (a.createdAt || 0) - (b.createdAt || 0));
}

export function matchRule(rules, description, kind) {
  return sortRules(rules || []).find((r) => ruleMatches(r, description, kind)) || null;
}

const kindOf = (c) => (c.kind === "Entrata" ? "Entrata" : "Uscita");

// Categoria suggerita: prima le regole, poi l'ultimo movimento con la stessa descrizione, poi
// l'ultimo la cui descrizione comincia allo stesso modo ("Cuccia di Lilli" e "Cuccia di Lilli - sabbia"),
// infine una categoria il cui nome compare nella descrizione ("Stipendio settembre" → Stipendio).
export function suggestCategory(description, kind, rules, transactions, categories) {
  const r = matchRule(rules, description, kind);
  if (r) return { category: r.category, source: "rule" };
  const d = normText(description);
  if (d.length < 3) return null;
  let best = null, similar = null;
  const newer = (t, cur) => !cur || (t.date || "") > (cur.date || "");
  for (const t of transactions || []) {
    if (t.kind !== kind || GENERIC.has(t.category || "") || t.cardPaymentFor) continue;
    const td = normText(t.description);
    if (td === d) { if (newer(t, best)) best = t; }
    else if (d.length >= 6 && td.length >= 6 && (td.startsWith(d) || d.startsWith(td)) && newer(t, similar)) similar = t;
  }
  if (best) return { category: best.category, source: "history" };
  if (similar) return { category: similar.category, source: "similar" };
  const words = new Set(d.split(/[^a-z0-9]+/));
  const named = (categories || []).find((c) => !GENERIC.has(c.name) && kindOf(c) === kind && normText(c.name).length >= 4 && words.has(normText(c.name)));
  return named ? { category: named.name, source: "name" } : null;
}

// Movimenti già registrati a cui la regola cambierebbe categoria.
export function ruleApplyOps(rule, transactions) {
  if (!rule.category || rule.category === "Giroconto") return [];
  const ops = [];
  for (const t of transactions || []) {
    if (t.kind === "Giroconto" || t.cardPaymentFor || t.pacId || t.loanId) continue;
    if (t.category === rule.category || !ruleMatches(rule, t.description, t.kind)) continue;
    ops.push({ op: "update", coll: "transactions", id: t.id, data: { category: rule.category } });
  }
  return ops;
}
