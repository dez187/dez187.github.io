// Lettura dei fogli di calcolo degli estratti conto, senza librerie esterne: Excel moderno (.xlsx, un archivio
// zip di file XML), Excel 97-2003 (.xls, formato binario BIFF8) e le "finte .xls" che sono tabelle HTML.
// Il risultato sono righe di testo come quelle di un CSV, così il resto dell'importazione non cambia.
// I numeri diventano testo con la virgola decimale (1234,56), le date "vere" di Excel diventano AAAA-MM-GG.

const td = (label) => new TextDecoder(label);

// Tipo di file dai primi byte: "xlsx", "xls", "html" oppure null (testo, da leggere come CSV).
export function sniffSpreadsheet(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "xlsx";
  if (b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 && b[4] === 0xa1 && b[5] === 0xb1 && b[6] === 0x1a && b[7] === 0xe1) return "xls";
  const head = td("utf-8").decode(b.subarray(0, Math.min(b.length, 2048))).replace(/^﻿/, "").trimStart().toLowerCase();
  if (/^<(!doctype html|html|table|\?xml[^>]*>\s*<html)/.test(head) || (/^</.test(head) && head.includes("<table"))) return "html";
  return null;
}

// Errori con un messaggio per l'utente; qualunque altro errore (file rovinato) diventa DAMAGED.
const DAMAGED = "Il file Excel è danneggiato: scaricalo di nuovo dalla banca o salvalo come CSV.";
const sheetError = (message) => Object.assign(new Error(message), { sheet: true });

// Decompressione "deflate" senza intestazione (quella degli zip): nel browser con DecompressionStream.
async function browserInflateRaw(data) {
  let ds;
  try {
    ds = new DecompressionStream("deflate-raw");
  } catch {
    throw sheetError("Questo browser non sa aprire i file Excel: aggiornalo, oppure salva il file come CSV e riprova.");
  }
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// opts.inflateRaw(Uint8Array) → Uint8Array | Promise<Uint8Array> (nei test si usa zlib).
export async function readSpreadsheet(buffer, opts = {}) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const kind = sniffSpreadsheet(bytes);
  try {
    if (kind === "xlsx") return { kind, ...(await readXlsx(bytes, opts.inflateRaw || browserInflateRaw)) };
    if (kind === "xls") return { kind, ...readXls(bytes) };
    if (kind === "html") return { kind, ...readHtmlTable(decodeText(bytes)) };
  } catch (e) {
    throw e && e.sheet ? e : sheetError(DAMAGED);
  }
  return null;
}

function decodeText(bytes) {
  try {
    return td("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return td("windows-1252").decode(bytes);
  }
}

// ---------- celle → testo ----------
// Numero come testo con la virgola decimale e senza separatore delle migliaia (niente code di arrotondamento).
export function numberText(n) {
  if (!Number.isFinite(n)) return "";
  const v = Math.abs(n) >= 1e15 ? n : Number(n.toFixed(10));
  const s = String(v);
  return /e/i.test(s) ? s : s.replace(".", ",");
}

// Data seriale di Excel (giorni dal 1899-12-30; dal 1904-01-01 con il calendario Mac) → AAAA-MM-GG.
export function excelDate(serial, date1904 = false) {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(base + Math.floor(serial + 1e-9) * 86400000);
  return d.toISOString().slice(0, 10);
}

// Formati numerici che rappresentano una data (quelli predefiniti di Excel e i personalizzati con g/m/a).
const DATE_IDS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
export function isDateFormat(id, code) {
  if (DATE_IDS.has(Number(id)) && !code) return true;
  if (!code) return false;
  const c = String(code).replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
  return /[dy]/i.test(c) || (/m/i.test(c) && !/[hs]/i.test(c) && /[dy/]/i.test(c));
}

// Righe senza celle vuote in fondo e senza righe del tutto vuote (come quelle di un CSV).
function tidy(grid) {
  const out = [];
  for (const row of grid) {
    if (!row) continue;
    const r = Array.from(row, (c) => (c == null ? "" : String(c).replace(/\s+/g, " ").trim()));
    if (r.some((c) => c !== "")) out.push(r);
  }
  return out;
}

// ---------- .xlsx ----------
function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

// Elenco dei file nell'archivio zip, dalla directory centrale.
export function zipEntries(b) {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw sheetError("Il file Excel è danneggiato o incompleto.");
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count && p + 46 <= b.length; i++) {
    if (u32(b, p) !== 0x02014b50) break;
    const method = u16(b, p + 10), csize = u32(b, p + 20), nameLen = u16(b, p + 28), extraLen = u16(b, p + 30), commentLen = u16(b, p + 32), local = u32(b, p + 42);
    const name = td("utf-8").decode(b.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, csize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function zipText(b, entries, name, inflateRaw) {
  const e = entries.get(name);
  if (!e) return null;
  if (u32(b, e.local) !== 0x04034b50) throw sheetError("Il file Excel è danneggiato.");
  const start = e.local + 30 + u16(b, e.local + 26) + u16(b, e.local + 28);
  const raw = b.subarray(start, start + e.csize);
  const data = e.method === 0 ? raw : e.method === 8 ? await inflateRaw(raw) : null;
  if (!data) throw sheetError("Il file Excel usa una compressione non supportata.");
  return unprefix(td("utf-8").decode(data));
}

// Alcuni programmi scrivono i tag con il prefisso dello spazio dei nomi (<x:row>, <x:c>): si tolgono, così
// le ricerche qui sotto valgono per tutti. Gli attributi (r:id) restano come sono.
const unprefix = (xml) => xml.replace(/<(\/?)[A-Za-z_][\w.-]*:(?=[A-Za-z_])/g, "<$1");

// Entità XML e le più comuni dell'HTML (lettere accentate italiane, euro) per le tabelle salvate come .xls.
const ENT = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", euro: "€", deg: "°", laquo: "«", raquo: "»", hellip: "…", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  agrave: "à", aacute: "á", egrave: "è", eacute: "é", igrave: "ì", iacute: "í", ograve: "ò", oacute: "ó", ugrave: "ù", uacute: "ú",
  Agrave: "À", Aacute: "Á", Egrave: "È", Eacute: "É", Igrave: "Ì", Iacute: "Í", Ograve: "Ò", Oacute: "Ó", Ugrave: "Ù", Uacute: "Ú", ccedil: "ç", ntilde: "ñ", uuml: "ü", ouml: "ö", auml: "ä",
};
export function decodeXml(s) {
  return String(s)
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
      return ENT[e] ?? ENT[e.toLowerCase()] ?? m;
    })
    .replace(/_x([0-9a-f]{4})_/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
}

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : null;
};

// Testo di un elemento con eventuali "run" di formattazione (<r><t>..</t></r>), senza la fonetica (<rPh>).
function richText(xml) {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let s = "";
  for (const m of clean.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) s += m[1] ? decodeXml(m[1]) : "";
  return s;
}

function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || "");
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function readXlsx(b, inflateRaw) {
  const entries = zipEntries(b);
  const workbook = await zipText(b, entries, "xl/workbook.xml", inflateRaw);
  if (!workbook) throw sheetError("Il file non sembra un foglio Excel.");
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(workbook);
  // Il primo foglio dell'elenco (non nascosto), con il suo file.
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*\/?>/g)].map((m) => ({ name: attr(m[0], "name") || "", rid: attr(m[0], "r:id"), hidden: /state="(hidden|veryHidden)"/.test(m[0]) }));
  const sheet = sheets.find((s) => !s.hidden) || sheets[0];
  const rels = (await zipText(b, entries, "xl/_rels/workbook.xml.rels", inflateRaw)) || "";
  let target = null;
  if (sheet && sheet.rid) {
    for (const m of rels.matchAll(/<Relationship\b[^>]*\/?>/g)) {
      if (attr(m[0], "Id") === sheet.rid) target = attr(m[0], "Target");
    }
  }
  let path = target ? (target.startsWith("/") ? target.slice(1) : `xl/${target}`) : null;
  if (path) path = path.replace(/\/[^/]+\/\.\.\//g, "/");
  if (!path || !entries.has(path)) path = [...entries.keys()].filter((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n)).sort()[0];
  if (!path) throw sheetError("Nel file Excel non c'è nessun foglio.");
  const shared = [];
  const sst = await zipText(b, entries, "xl/sharedStrings.xml", inflateRaw);
  // Una stringa vuota può essere scritta <si/>: va contata, altrimenti tutte le successive slittano di uno.
  if (sst) for (const m of sst.matchAll(/<si(?:\s[^>]*)?\/>|<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) shared.push(m[1] ? richText(m[1]) : "");
  // Stili: quali celle sono date.
  const dateStyles = new Set();
  const styles = await zipText(b, entries, "xl/styles.xml", inflateRaw);
  if (styles) {
    const codes = new Map();
    for (const m of styles.matchAll(/<numFmt\b[^>]*\/?>/g)) codes.set(Number(attr(m[0], "numFmtId")), attr(m[0], "formatCode") || "");
    const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles);
    if (xfs) {
      let i = 0;
      for (const m of xfs[1].matchAll(/<xf\b[^>]*?(?:\/>|>)/g)) {
        const id = Number(attr(m[0], "numFmtId") || 0);
        if (isDateFormat(id, codes.get(id))) dateStyles.add(i);
        i++;
      }
    }
  }
  const xml = await zipText(b, entries, path, inflateRaw);
  const grid = [];
  let nextRow = 0;
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rAttr = /\sr="(\d+)"/.exec(rm[1]);
    const ri = rAttr ? Number(rAttr[1]) - 1 : nextRow;
    nextRow = ri + 1;
    const row = [];
    let nextCol = 0;
    for (const cm of (rm[2] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = cm[1];
      const ref = /\sr="([A-Z]+\d+)"/.exec(a);
      const ci = ref ? colIndex(ref[1]) : nextCol;
      nextCol = ci + 1;
      const t = (/\st="([^"]*)"/.exec(a) || [])[1] || "n";
      const s = Number((/\ss="(\d+)"/.exec(a) || [])[1] || 0);
      const body = cm[2] || "";
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
      let val = "";
      if (t === "s") val = v ? shared[Number(v[1])] ?? "" : "";
      else if (t === "inlineStr") val = richText((/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body) || [])[1] || "");
      else if (t === "str") val = v ? decodeXml(v[1]) : "";
      else if (t === "b") val = v ? (v[1] === "1" ? "VERO" : "FALSO") : "";
      else if (t === "e") val = "";
      else if (t === "d") val = v ? decodeXml(v[1]).slice(0, 10) : "";
      else if (v) {
        const n = Number(v[1]);
        val = dateStyles.has(s) ? excelDate(n, date1904) || numberText(n) : numberText(n);
      }
      row[ci] = val;
    }
    grid[ri] = row;
  }
  return { sheet: sheet ? sheet.name : "", rows: tidy(grid) };
}

// ---------- .xls (BIFF8 dentro un Compound File) ----------
function cfbStream(b, wanted) {
  if (b.length < 512) throw sheetError("Il file Excel è troppo corto.");
  const secShift = u16(b, 30), miniShift = u16(b, 32);
  const secSize = 1 << secShift, miniSize = 1 << miniShift;
  const nFat = u32(b, 44), dirStart = u32(b, 48), miniCutoff = u32(b, 56), miniFatStart = u32(b, 60), difatStart = u32(b, 68), nDifat = u32(b, 72);
  // Un'intestazione rovinata non deve far leggere più settori di quanti il file ne contenga.
  const nSectors = Math.ceil(b.length / secSize);
  if ((secShift !== 9 && secShift !== 12) || miniShift > secShift || nFat > nSectors || nDifat > nSectors) throw sheetError(DAMAGED);
  const sector = (n) => {
    if (n + 1 >= nSectors) throw sheetError(DAMAGED);
    return b.subarray((n + 1) * secSize, (n + 2) * secSize); // l'intestazione occupa il primo settore
  };
  const fatSectors = [];
  for (let i = 0; i < 109 && fatSectors.length < nFat; i++) fatSectors.push(u32(b, 76 + i * 4));
  let d = difatStart;
  const seen = new Set();
  for (let k = 0; k < nDifat && d < 0xfffffffa && fatSectors.length < nFat; k++) {
    if (seen.has(d)) throw sheetError(DAMAGED);
    seen.add(d);
    const s = sector(d);
    for (let i = 0; i < secSize / 4 - 1 && fatSectors.length < nFat; i++) fatSectors.push(u32(s, i * 4));
    d = u32(s, secSize - 4);
  }
  const fat = [];
  for (const fs of fatSectors) {
    const s = sector(fs);
    for (let i = 0; i < secSize / 4; i++) fat.push(u32(s, i * 4));
  }
  const chain = (start, table, limit) => {
    const out = [];
    for (let n = start, guard = 0; n < 0xfffffffa && guard < limit; guard++) {
      out.push(n);
      n = table[n];
    }
    return out;
  };
  const readChain = (start, size) => {
    const parts = chain(start, fat, fat.length + 1).map(sector);
    const out = new Uint8Array(parts.length * secSize);
    parts.forEach((p, i) => out.set(p, i * secSize));
    return size == null ? out : out.subarray(0, size);
  };
  const dir = readChain(dirStart);
  const items = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameLen = u16(dir, o + 64);
    const name = nameLen >= 2 ? td("utf-16le").decode(dir.subarray(o, o + nameLen - 2)) : "";
    items.push({ name, type: dir[o + 66], start: u32(dir, o + 116), size: u32(dir, o + 120) });
  }
  const root = items.find((x) => x.type === 5);
  const item = items.find((x) => x.type === 2 && wanted.includes(x.name));
  if (!item) throw sheetError("Nel file .xls non c'è un foglio di lavoro leggibile.");
  if (item.size >= miniCutoff || !root) return readChain(item.start, item.size);
  // Stream piccolo: sta nel "mini stream" dentro la radice.
  const miniStream = readChain(root.start, root.size);
  const miniFat = [];
  if (miniFatStart < 0xfffffffa) {
    const mf = readChain(miniFatStart);
    for (let i = 0; i + 4 <= mf.length; i += 4) miniFat.push(u32(mf, i));
  }
  const parts = chain(item.start, miniFat, miniFat.length + 1);
  const out = new Uint8Array(parts.length * miniSize);
  parts.forEach((n, i) => out.set(miniStream.subarray(n * miniSize, (n + 1) * miniSize), i * miniSize));
  return out.subarray(0, item.size);
}

function rkValue(rk) {
  const div = rk & 1, isInt = rk & 2;
  let v;
  if (isInt) v = rk >> 2;
  else {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setUint32(0, (rk & 0xfffffffc) >>> 0, false);
    buf.setUint32(4, 0, false);
    v = buf.getFloat64(0, false);
  }
  return div ? v / 100 : v;
}

// Lettore sequenziale di stringhe Unicode BIFF8 che proseguono nei record CONTINUE (ogni pezzo
// dopo il primo comincia con un byte che dice se i caratteri sono a 8 o a 16 bit).
class Chunks {
  constructor(parts) { this.parts = parts; this.i = 0; this.o = 0; }
  get cur() { return this.parts[this.i]; }
  left() { return this.cur ? this.cur.length - this.o : 0; }
  next() { this.i++; this.o = 0; }
  byte() { if (this.left() < 1) this.next(); return this.cur ? this.cur[this.o++] : 0; }
  u16() { if (this.left() < 2) this.next(); const c = this.cur; if (!c) return 0; const v = c[this.o] | (c[this.o + 1] << 8); this.o += 2; return v; }
  u32() { if (this.left() < 4) this.next(); const c = this.cur; if (!c) return 0; const v = u32(c, this.o); this.o += 4; return v; }
  skip(n) {
    while (n > 0 && this.cur) {
      const k = Math.min(n, this.left());
      this.o += k;
      n -= k;
      if (n > 0) this.next();
    }
  }
  str() {
    const cch = this.u16();
    const flags = this.byte();
    let wide = flags & 1;
    const rich = flags & 8 ? this.u16() : 0;
    const ext = flags & 4 ? this.u32() : 0;
    let s = "";
    let n = cch;
    while (n > 0 && this.cur) {
      if (this.left() <= 0) {
        this.next();
        if (!this.cur) break;
        wide = this.cur[this.o++] & 1;
      }
      const avail = wide ? Math.floor(this.left() / 2) : this.left();
      const k = Math.min(n, avail);
      if (k <= 0) { this.next(); if (!this.cur) break; wide = this.cur[this.o++] & 1; continue; }
      const c = this.cur;
      if (wide) for (let j = 0; j < k; j++) s += String.fromCharCode(c[this.o + j * 2] | (c[this.o + j * 2 + 1] << 8));
      else for (let j = 0; j < k; j++) s += String.fromCharCode(c[this.o + j]);
      this.o += wide ? k * 2 : k;
      n -= k;
    }
    this.skip(rich * 4 + ext);
    return s;
  }
}

function shortStr(b, o, lenBytes = 2) {
  const cch = lenBytes === 2 ? u16(b, o) : b[o];
  const flags = b[o + lenBytes];
  const p = o + lenBytes + 1;
  if (flags & 1) return td("utf-16le").decode(b.subarray(p, p + cch * 2));
  let s = "";
  for (let j = 0; j < cch; j++) s += String.fromCharCode(b[p + j]);
  return s;
}

function readXls(bytes) {
  const wb = cfbStream(bytes, ["Workbook", "Book"]);
  const recs = [];
  for (let p = 0; p + 4 <= wb.length;) {
    const type = u16(wb, p), len = u16(wb, p + 2);
    recs.push({ type, pos: p, data: wb.subarray(p + 4, p + 4 + len) });
    p += 4 + len;
  }
  const sst = [];
  const formats = new Map();
  const xfFormat = [];
  const sheets = [];
  let date1904 = false;
  let i = 0;
  // Parte globale: stringhe condivise, formati, stili, fogli.
  for (; i < recs.length; i++) {
    const r = recs[i];
    if (r.type === 0x0809 && i > 0) break;
    if (r.type === 0x000a) { i++; break; }
    if (r.type === 0x0022) date1904 = u16(r.data, 0) === 1;
    else if (r.type === 0x041e) formats.set(u16(r.data, 0), shortStr(r.data, 2));
    else if (r.type === 0x00e0) xfFormat.push(u16(r.data, 2));
    else if (r.type === 0x0085) sheets.push({ pos: u32(r.data, 0), hidden: r.data[4] & 3, kind: r.data[5], name: shortStr(r.data, 6, 1) });
    else if (r.type === 0x00fc) {
      const parts = [r.data.subarray(8)];
      for (let k = i + 1; k < recs.length && recs[k].type === 0x003c; k++) parts.push(recs[k].data);
      const total = u32(r.data, 4);
      const rd = new Chunks(parts);
      for (let k = 0; k < total && rd.cur; k++) sst.push(rd.str());
    }
  }
  const isDate = (xf) => { const id = xfFormat[xf]; return id != null && isDateFormat(id, formats.get(id)); };
  const sheet = sheets.find((s) => s.kind === 0 && !s.hidden) || sheets.find((s) => s.kind === 0) || sheets[0];
  let start = sheet ? recs.findIndex((r) => r.pos === sheet.pos) : -1;
  if (start < 0) start = recs.findIndex((r, k) => k > 0 && r.type === 0x0809);
  if (start < 0) throw sheetError("Nel file .xls non c'è nessun foglio.");
  const grid = [];
  const put = (row, col, v) => { (grid[row] || (grid[row] = []))[col] = v; };
  const num = (row, col, xf, n) => put(row, col, isDate(xf) ? excelDate(n, date1904) || numberText(n) : numberText(n));
  let pendingFormula = null;
  for (let k = start + 1; k < recs.length; k++) {
    const { type, data: d } = recs[k];
    if (type === 0x000a) break;
    if (type === 0x00fd) put(u16(d, 0), u16(d, 2), sst[u32(d, 6)] ?? "");
    else if (type === 0x0203) num(u16(d, 0), u16(d, 2), u16(d, 4), new DataView(d.buffer, d.byteOffset + 6, 8).getFloat64(0, true));
    else if (type === 0x027e) num(u16(d, 0), u16(d, 2), u16(d, 4), rkValue(u32(d, 6)));
    else if (type === 0x00bd) {
      const row = u16(d, 0), first = u16(d, 2), last = u16(d, d.length - 2);
      for (let c = first, o = 4; c <= last && o + 6 <= d.length - 2; c++, o += 6) num(row, c, u16(d, o), rkValue(u32(d, o + 2)));
    } else if (type === 0x0204) put(u16(d, 0), u16(d, 2), shortStr(d, 6));
    else if (type === 0x0006) {
      const row = u16(d, 0), col = u16(d, 2), xf = u16(d, 4);
      if (u16(d, 12) === 0xffff) {
        const t = d[6];
        if (t === 0) pendingFormula = { row, col };
        else if (t === 1) put(row, col, d[8] ? "VERO" : "FALSO");
      } else num(row, col, xf, new DataView(d.buffer, d.byteOffset + 6, 8).getFloat64(0, true));
    } else if (type === 0x0207 && pendingFormula) {
      put(pendingFormula.row, pendingFormula.col, new Chunks([d]).str());
      pendingFormula = null;
    } else if (type === 0x0205 && d[7] === 0) put(u16(d, 0), u16(d, 2), d[6] ? "VERO" : "FALSO");
  }
  return { sheet: sheet ? sheet.name : "", rows: tidy(grid) };
}

// ---------- tabella HTML salvata come .xls ----------
export function readHtmlTable(text) {
  const src = String(text || "").replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
  const rows = [];
  for (const rm of src.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table>|$)/gi)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<t([dh])\b([^>]*)>([\s\S]*?)(?=<t[dh]\b|<\/tr>|$)/gi)) {
      const cell = decodeXml(cm[3].replace(/<br\s*\/?>/gi, " ").replace(/<\/t[dh]>/gi, "").replace(/<[^>]+>/g, " "));
      row.push(cell);
      const span = Number((/colspan\s*=\s*"?(\d+)/i.exec(cm[2]) || [])[1] || 1);
      for (let s = 1; s < Math.min(span, 50); s++) row.push("");
    }
    rows.push(row);
  }
  return { sheet: "", rows: tidy(rows) };
}
