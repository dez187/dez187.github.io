import { addDays, daysBetween, isDateStr } from "./dates.js";

export const MINUS = "−";

// Separatore delle migliaia anche a 4 cifre (1.234,50 €), come nelle app bancarie italiane.
const eur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", useGrouping: "always" });
const nfCache = new Map();
function nf(min, max) {
  const key = min + ":" + max;
  let f = nfCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("it-IT", { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: "always" });
    nfCache.set(key, f);
  }
  return f;
}

export function toNum(v) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export function round(v, digits = 2) {
  const f = 10 ** digits;
  return Math.round((toNum(v) + Number.EPSILON) * f) / f;
}

// Il segno meno tipografico (−) si legge meglio del trattino.
export function fmtEUR(v) {
  const n = toNum(v);
  const s = eur.format(Math.abs(n));
  return n <= -0.005 ? MINUS + s : s;
}

export function fmtSigned(v) {
  const n = toNum(v);
  if (Math.abs(n) < 0.005) return eur.format(0);
  return (n > 0 ? "+" : MINUS) + eur.format(Math.abs(n));
}

export function fmtNum(v, max = 2, min = 0) {
  const n = toNum(v);
  const f = nf(min, max);
  const s = f.format(Math.abs(n));
  return n < 0 && s !== f.format(0) ? MINUS + s : s;
}

export function fmtPct(v, digits = 1, signed = false) {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = nf(digits, digits).format(Math.abs(v)) + "%";
  const zero = nf(digits, digits).format(0) + "%";
  if (s === zero) return s;
  if (signed) return (v > 0 ? "+" : MINUS) + s;
  return (v < 0 ? MINUS : "") + s;
}

export const fmtQty = (v) => fmtNum(v, 6);

// Prezzi sotto 1 € (molte crypto) hanno bisogno di più decimali.
export function fmtPrice(v) {
  const n = toNum(v);
  const max = n !== 0 && Math.abs(n) < 1 ? 6 : 2;
  return (n < 0 ? MINUS : "") + nf(2, max).format(Math.abs(n)) + " €";
}

export function fmtCompactEUR(v) {
  const n = toNum(v);
  const a = Math.abs(n);
  let s;
  if (a >= 1e6) s = nf(0, 1).format(a / 1e6) + " Mln";
  else if (a >= 1e4) s = nf(0, 0).format(a / 1e3) + "k";
  else if (a >= 1e3) s = nf(0, 1).format(a / 1e3) + "k";
  else s = nf(0, 0).format(a);
  return (n < 0 && s !== "0" ? MINUS : "") + s + " €";
}

export const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function utc(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}
const dShort = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dDayMonth = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", timeZone: "UTC" });
const dLong = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const dLongYear = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const dMonthYear = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" });
const dMonthShort = new Intl.DateTimeFormat("it-IT", { month: "short", timeZone: "UTC" });
const dMonthLong = new Intl.DateTimeFormat("it-IT", { month: "long", timeZone: "UTC" });

export const fmtDate = (s) => (isDateStr(s) ? dShort.format(utc(s)) : "—");
export const fmtDayMonth = (s) => (isDateStr(s) ? dDayMonth.format(utc(s)) : "—");
export const fmtMonth = (ym) => capitalize(dMonthYear.format(utc(`${ym}-01`)));
export const fmtMonthInline = (ym) => dMonthYear.format(utc(`${ym}-01`));
export const fmtMonthShort = (ym) => dMonthShort.format(utc(`${ym}-01`)).replace(".", "");
export const fmtMonthName = (ym) => dMonthLong.format(utc(`${ym}-01`));

// Preposizione articolata davanti a una data: "al 30 set", ma "all'8 set", "dall'1 ott", "l'11 nov".
// prep: "a", "da", "di" oppure "il".
export function onDate(prep, s, format = fmtDate) {
  const text = format(s);
  const elide = isDateStr(s) && [1, 8, 11].includes(Number(s.slice(8, 10)));
  if (prep === "il") return (elide ? "l'" : "il ") + text;
  return (prep === "di" ? "de" : prep) + (elide ? "ll'" : "l ") + text;
}

export function fmtDateLong(s, today) {
  const sameYear = today && s.slice(0, 4) === today.slice(0, 4);
  return capitalize((sameYear ? dLong : dLongYear).format(utc(s)));
}

export function fmtDayHeader(s, today) {
  if (!isDateStr(s)) return "Senza data";
  if (s === today) return "Oggi";
  if (s === addDays(today, -1)) return "Ieri";
  if (s === addDays(today, 1)) return "Domani";
  return fmtDateLong(s, today);
}

export function fmtRelative(s, today) {
  if (!isDateStr(s)) return "";
  const d = daysBetween(today, s);
  if (d === 0) return "oggi";
  if (d === 1) return "domani";
  if (d === -1) return "ieri";
  if (d > 1) return d < 45 ? `tra ${d} giorni` : onDate("il", s);
  return -d < 45 ? `${-d} giorni fa` : onDate("il", s);
}

export function initials(name) {
  const w = String(name || "").trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || "") + (w[1]?.[0] || "")).toUpperCase() || "?";
}

// Accetta "1.234,56", "1234,56", "1234.56", "1.234" (migliaia) e il segno meno.
export function parseAmount(input) {
  if (typeof input === "number") return Number.isFinite(input) ? input : NaN;
  let s = String(input ?? "").trim().replace(/[\s€']/g, "").replace(MINUS, "-");
  if (!s) return NaN;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^-?\d*\.?\d+$/.test(s)) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// Valore numerico mostrato in un campo di testo (virgola decimale, nessun separatore delle migliaia).
export function numToInput(v) {
  if (v === "" || v == null) return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return String(n).replace(".", ",");
}
