// Categorie predefinite: le stesse proposte dal vecchio artifact, con un'icona ciascuna.
export const DEFAULT_CATEGORIES = [
  { name: "Stipendio", emoji: "💼", kind: "Entrata" },
  { name: "Bonus", emoji: "🎉", kind: "Entrata" },
  { name: "Rimborsi", emoji: "↩️", kind: "Entrata" },
  { name: "Altre entrate", emoji: "💶", kind: "Entrata" },
  { name: "Affitto", emoji: "🏠", kind: "Uscita" },
  { name: "Mutuo", emoji: "🏦", kind: "Uscita" },
  { name: "Bollette", emoji: "💡", kind: "Uscita" },
  { name: "Spesa", emoji: "🛒", kind: "Uscita" },
  { name: "Ristoranti", emoji: "🍽️", kind: "Uscita" },
  { name: "Trasporti", emoji: "🚗", kind: "Uscita" },
  { name: "Salute", emoji: "💊", kind: "Uscita" },
  { name: "Svago", emoji: "🎬", kind: "Uscita" },
  { name: "Abbonamenti", emoji: "📺", kind: "Uscita" },
  { name: "Assicurazioni", emoji: "🛡️", kind: "Uscita" },
  { name: "Investimenti", emoji: "📈", kind: "Uscita" },
  { name: "Carta di credito", emoji: "💳", kind: "Uscita" },
  { name: "Tasse", emoji: "🧾", kind: "Uscita" },
  { name: "Regali", emoji: "🎁", kind: "Uscita" },
  { name: "Altro", emoji: "📦", kind: "Uscita" },
];

// Versione dell'elenco predefinito: chi ha già le categorie riceve solo quelle aggiunte dopo.
export const CATEGORIES_VERSION = 2;
const ADDED_IN = { 2: ["Carta di credito"] };

export function upgradeCategoryOps(existing, fromVersion) {
  const names = new Set(existing.map((c) => c.name));
  const ops = [];
  for (let v = (fromVersion || 1) + 1; v <= CATEGORIES_VERSION; v++) {
    for (const name of ADDED_IN[v] || []) {
      const i = DEFAULT_CATEGORIES.findIndex((c) => c.name === name);
      if (i < 0 || names.has(name)) continue;
      const c = DEFAULT_CATEGORIES[i];
      // Mezzo punto sotto la posizione nell'elenco nuovo: finisce subito dopo la categoria che la precede.
      ops.push({ op: "set", coll: "categories", id: categoryId(c.name), data: { name: c.name, emoji: c.emoji, kind: c.kind, budget: 0, order: i - 0.5 } });
    }
  }
  return ops;
}

const GUESSES = [
  [/gatt|cane|cani|anima|veterin|lettier|croccant/i, "🐾"],
  [/benzin|carbur|auto|parchegg|pedagg/i, "⛽"],
  [/caff|bar\b|colazion/i, "☕"],
  [/pizz|ristor|pranz|cena|sushi|delivery/i, "🍕"],
  [/viagg|vacanz|hotel|volo|treno/i, "✈️"],
  [/sport|palestr|fitness/i, "🏋️"],
  [/scuol|libr|corso|istruz|univers/i, "📚"],
  [/vestit|abbigl|scarp|moda/i, "👕"],
  [/tech|elettron|computer|telefon/i, "💻"],
  [/casa|arred|mobil/i, "🛋️"],
  [/bimb|figl|bambin/i, "🧸"],
  [/rata|prestit|finanz/i, "💳"],
  [/stipend|salar/i, "💼"],
];

export function guessEmoji(name) {
  for (const [re, emoji] of GUESSES) if (re.test(name)) return emoji;
  return "🏷️";
}

// Id deterministico: due dispositivi che creano la stessa categoria scrivono lo stesso documento.
export function categoryId(name) {
  const slug = String(name).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `cat-${slug || "senza-nome"}`;
}

export function categoryFor(name, categories) {
  const c = categories.find((x) => x.name === name);
  if (c) return c;
  if (name === "Giroconto") return { name, emoji: "🔁", kind: "Giroconto" };
  return { name: name || "Altro", emoji: guessEmoji(name || ""), kind: "Uscita" };
}

// Categorie iniziali: quelle predefinite più quelle già usate nei movimenti importati.
export function seedCategoryOps(existing, transactions) {
  const names = new Set(existing.map((c) => c.name));
  const ops = [];
  const add = (c, order) => {
    if (names.has(c.name)) return;
    names.add(c.name);
    ops.push({ op: "set", coll: "categories", id: categoryId(c.name), data: { name: c.name, emoji: c.emoji, kind: c.kind, budget: 0, order } });
  };
  DEFAULT_CATEGORIES.forEach((c, i) => add(c, i));
  let order = DEFAULT_CATEGORIES.length;
  for (const t of transactions) {
    const n = (t.category || "").trim();
    if (!n || n === "Giroconto") continue;
    add({ name: n, emoji: guessEmoji(n), kind: t.kind === "Entrata" ? "Entrata" : "Uscita" }, order++);
  }
  return ops;
}

export function sortCategories(list) {
  return [...list].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "Entrata" ? 1 : -1) || (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name, "it"));
}
