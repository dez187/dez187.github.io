// IBAN dei conti: si salva senza spazi e in maiuscolo, si mostra a gruppi di quattro caratteri.

// Lunghezza dell'IBAN per i paesi più comuni (registro SWIFT). Per gli altri paesi vale solo il controllo
// generale (15-34 caratteri) più le cifre di controllo, che bastano a scoprire quasi tutti gli errori di battitura.
const LENGTHS = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18, FR: 27,
  GB: 22, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31,
  NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27, VA: 22,
};

// Toglie spazi, trattini e un'eventuale etichetta "IBAN" davanti (capita incollando dall'app della banca).
export function normalizeIban(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/^\s*IBAN\b\s*:?/, "")
    .replace(/[\s ​-]+/g, "");
}

// Resto della divisione per 97 dell'IBAN con i primi quattro caratteri spostati in fondo e le lettere
// trasformate in numeri (A = 10 … Z = 35): un IBAN corretto dà 1.
function mod97(iban) {
  const s = iban.slice(4) + iban.slice(0, 4);
  let r = 0;
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    const n = code >= 65 ? code - 55 : code - 48;
    r = n > 9 ? (r * 100 + n) % 97 : (r * 10 + n) % 97;
  }
  return r;
}

// "" se l'IBAN (già normalizzato o no) è valido, altrimenti il motivo in italiano.
export function ibanError(value) {
  const iban = normalizeIban(value);
  if (!iban) return "";
  if (!/^[A-Z0-9]+$/.test(iban)) return "IBAN non valido: usa solo lettere e numeri.";
  if (!/^[A-Z]{2}\d{2}/.test(iban)) return "IBAN non valido: deve iniziare con la sigla del paese e due cifre, es. IT60.";
  const len = LENGTHS[iban.slice(0, 2)];
  if (len && iban.length !== len) return `IBAN non valido: per ${iban.slice(0, 2)} servono ${len} caratteri, qui ce ne sono ${iban.length}.`;
  if (iban.length < 15 || iban.length > 34) return "IBAN non valido: la lunghezza non è corretta.";
  if (mod97(iban) !== 1) return "IBAN non valido: le cifre di controllo non tornano, ricontrolla di averlo scritto bene.";
  return "";
}

export function isValidIban(value) {
  const iban = normalizeIban(value);
  return !!iban && !ibanError(iban);
}

// A gruppi di quattro, come sugli estratti conto: IT60 X054 2811 1010 0000 0123 456.
export function formatIban(value) {
  return normalizeIban(value).replace(/(.{4})(?=.)/g, "$1 ");
}
