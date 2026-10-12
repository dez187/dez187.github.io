export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export function randomId(len = 20) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = "";
  for (const b of bytes) s += CHARS[b % CHARS.length];
  return s;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function downloadText(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari chiede conferma prima di scaricare: il collegamento deve restare valido per un po'.
  setTimeout(() => URL.revokeObjectURL(url), 40000);
}

// Copia un testo negli appunti. Se il browser non lo permette, ripiega su una selezione temporanea
// (dentro la finestra aperta, perché fuori da un dialog modale non si può selezionare nulla).
export async function copyText(text, near = null) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // si prova il metodo di riserva
  }
  const host = (near && near.closest && near.closest("dialog")) || document.body;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
  host.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length); // iOS seleziona solo così
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  if (near && near.focus) near.focus();
  return ok;
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error || new Error("Lettura non riuscita"));
    r.readAsText(file);
  });
}

export const prefersReducedMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
