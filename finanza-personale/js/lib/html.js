// Template HTML con escape automatico: ogni valore interpolato viene reso innocuo,
// tranne l'HTML prodotto da altri template (SafeHtml) o marcato esplicitamente con raw().

export class SafeHtml {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
}

export function raw(s) {
  return new SafeHtml(String(s));
}

// Nel testo i booleani non producono nulla (utile con "cond && html`…`");
// dentro un attributo (aria-pressed="${attivo}") diventano "true" o "false".
function toHtml(v) {
  if (v == null || typeof v === "boolean") return "";
  if (v instanceof SafeHtml) return v.s;
  if (Array.isArray(v)) return v.map(toHtml).join("");
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const attrValue = typeof v === "boolean" && /=\s*"$/.test(strings[i]);
    out += (attrValue ? String(v) : toHtml(v)) + strings[i + 1];
  }
  return new SafeHtml(out);
}

// Attributo booleano: attr("disabled", cond)
export function attr(name, on) {
  return on ? raw(` ${name}`) : "";
}
