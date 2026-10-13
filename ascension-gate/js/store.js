// Accesso ai dati: file statici (public/data) + documenti sul database D1 tramite il Worker.
// I documenti sono in cache in memoria; i salvataggi partono con un piccolo ritardo e,
// se la rete manca, restano in coda (anche in localStorage) finché non passano.

const CHIAVE_LS = 'ag-chiave';
const CODA_LS = 'ag-coda';

export const S = {
  ruolo: null,
  dati: null,
  docs: {},
  ascoltatori: new Set(),
};

function chiave() {
  try { return localStorage.getItem(CHIAVE_LS) || ''; } catch { return ''; }
}

// DEMO: nessun server. I documenti stanno nel browser (localStorage), le immagini solo in memoria.
const DEMO_KEY = 'ag-demo-v1';
const IMMAGINI = new Map();
function demoDb() {
  let db = null;
  try { db = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); } catch { db = null; }
  const oggi = new Date().toISOString().slice(0, 10);
  if (!db || db.giorno !== oggi) db = demoSeme(oggi);
  return db;
}
function demoSalva(db) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); } catch { /* pieno */ } }
function demoSeme(oggi) {
  const ora = Date.now();
  const d = (col, id, data) => ({ col, id, data, aggiornato: ora });
  const righe = [
    d('impostazioni', 'generali', { gruppo: [
      { nome: 'Aria', livello: 3, ca: 15, pf: 24, note: 'Ladra, scout del gruppo' },
      { nome: 'Bruno', livello: 3, ca: 17, pf: 31, note: 'Guerriero, porta lo scudo' },
      { nome: 'Cleo', livello: 3, ca: 13, pf: 20, note: 'Chierica del sole' },
      { nome: 'Dario', livello: 3, ca: 12, pf: 18, note: 'Mago, conosce i rituali' }], spedizioneAttiva: 'sp-demo', tema: 'scuro' }),
    d('spedizioni', 'sp-demo', { nome: 'Discesa nella Radice', creata: ora, gdm: 1,
      percorso: [{ sez: 'rd-1', stato: 'completata' }, { sez: 'rd-2', stato: 'completata' }, { sez: 'rd-3', stato: 'in-corso' }, { sez: 'rd-4', stato: 'da-esplorare' }],
      posizione: 2, pressione: 2, turni: 14, risorse: { torce: 5, razioni: 7, acqua: 7 },
      registro: [{ t: ora - 3600000, tipo: 'nota', testo: "Il gruppo entra nell'Imbocco dei Funghi." }, { t: ora - 1800000, tipo: 'nota', testo: 'Primo scontro con i ratti giganti: nessuna perdita.' }],
      note: 'Demo: modifica pure percorso, risorse e note, tutto resta nel tuo browser.' }),
  ];
  const db = { giorno: oggi, docs: {} };
  for (const r of righe) { (db.docs[r.col] ||= {})[r.id] = r; }
  demoSalva(db);
  return db;
}
const riga = (r) => ({ id: r.id, data: r.data, aggiornato: r.aggiornato });
async function chiama(metodo, percorso, corpo, tipo = 'application/json') {
  const [risorsa, a, b] = percorso.split('/').filter(Boolean);
  const db = demoDb();
  if (risorsa === 'chi') return { ruolo: 'master' };
  if (risorsa === 'giocatori') { const r = db.docs.stato?.giocatori; return r ? riga(r) : { id: 'giocatori', data: null, aggiornato: 0 }; }
  if (risorsa === 'img') {
    if (metodo === 'POST') { const id = Math.random().toString(36).slice(2) + Date.now().toString(36); IMMAGINI.set(id, corpo); return { id }; }
    if (metodo === 'DELETE') { IMMAGINI.delete(a); return { ok: true }; }
  }
  if (risorsa === 'docs') {
    const col = (db.docs[a] ||= {});
    if (!b && metodo === 'GET') return Object.values(col).sort((x, y) => x.aggiornato - y.aggiornato).map(riga);
    if (b && metodo === 'GET') { if (!col[b]) { const e = new Error('Documento non trovato'); e.stato = 404; throw e; } return riga(col[b]); }
    if (b && metodo === 'PUT') { const ora = Date.now(); col[b] = { col: a, id: b, data: corpo, aggiornato: ora }; demoSalva(db); return { id: b, aggiornato: ora }; }
    if (b && metodo === 'DELETE') { delete col[b]; demoSalva(db); return { ok: true }; }
  }
  if (risorsa === 'esporta') return Object.values(db.docs).flatMap((c) => Object.values(c)).map((r) => ({ col: r.col, ...riga(r) }));
  if (risorsa === 'importa') {
    const ora = Date.now(); let n = 0;
    for (const r of corpo || []) { (db.docs[r.col] ||= {})[r.id] = { col: r.col, id: r.id, data: r.data, aggiornato: ora }; n++; }
    demoSalva(db); return { importati: n };
  }
  const e = new Error('Percorso sconosciuto'); e.stato = 404; throw e;
}

export async function accedi() {
  S.ruolo = 'master';
  return 'master';
}

export async function ruoloSalvato() {
  S.ruolo = 'master';
  return 'master';
}

export function esci() {
  try { localStorage.removeItem(DEMO_KEY); } catch { /* niente */ }
  S.ruolo = null;
}

export async function caricaDati() {
  const nomi = ['meta', 'sezioni', 'temi', 'mappe', 'tabelle', 'bestiario'];
  const [meta, sezioni, temi, mappe, tabelle, bestiario] = await Promise.all(
    nomi.map((n) => fetch(`data/${n}.json`).then((r) => r.json())),
  );
  S.dati = { meta, sezioni, temi, mappe, tabelle, bestiario };
  S.dati.perSez = new Map(sezioni.map((s) => [s.id, s]));
  ricalcolaMostri();
  return S.dati;
}

// Il bestiario unisce SRD e mostri creati dal master (collezione "mostri").
export function ricalcolaMostri() {
  const custom = Object.values(S.docs.mostri || {}).map((m) => ({ ...m, fonte: 'Personalizzato' }));
  S.dati.tuttiMostri = [...S.dati.bestiario, ...custom].sort((a, b) => a.it.localeCompare(b.it, 'it'));
  S.dati.perMostro = new Map(S.dati.tuttiMostri.map((m) => [m.k, m]));
}

// Sezione con le modifiche del master sopra i contenuti di base.
export function sezione(id) {
  const base = S.dati.perSez.get(id);
  if (!base) return null;
  const mod = S.docs.sezioni?.[id];
  const out = { ...base, base };
  // un campo tolto dal master (undefined) fa tornare il valore originale
  if (mod) for (const [k, v] of Object.entries(mod)) if (v !== undefined) out[k] = v;
  return out;
}

export const COLLEZIONI = ['spedizioni', 'griglie', 'mappe', 'mostri', 'incontri', 'stato', 'impostazioni', 'sezioni', 'tiri'];

export async function caricaDocs() {
  const liste = await Promise.all(COLLEZIONI.map((c) => chiama('GET', `docs/${c}`)));
  COLLEZIONI.forEach((c, i) => {
    S.docs[c] = {};
    for (const r of liste[i]) S.docs[c][r.id] = r.data;
  });
  ricalcolaMostri();
  svuotaCoda();
}

export function doc(col, id) {
  return S.docs[col]?.[id];
}

const timer = new Map();

// Salva subito in memoria, sul server dopo 600 ms (i salvataggi ravvicinati si uniscono).
export function salva(col, id, data, { subito = false } = {}) {
  S.docs[col] = S.docs[col] || {};
  S.docs[col][id] = data;
  if (col === 'mostri') ricalcolaMostri();
  notifica(col, id);
  const k = `${col}/${id}`;
  clearTimeout(timer.get(k));
  const invia = () => {
    timer.delete(k);
    chiama('PUT', `docs/${col}/${id}`, S.docs[col][id]).then(() => statoRete(true)).catch(() => {
      accoda({ op: 'put', col, id });
      statoRete(false);
    });
  };
  if (subito) invia();
  else timer.set(k, setTimeout(invia, 600));
}

export async function elimina(col, id) {
  if (S.docs[col]) delete S.docs[col][id];
  if (col === 'mostri') ricalcolaMostri();
  notifica(col, id);
  try {
    await chiama('DELETE', `docs/${col}/${id}`);
  } catch {
    accoda({ op: 'del', col, id });
    statoRete(false);
  }
}

function leggiCoda() {
  try { return JSON.parse(localStorage.getItem(CODA_LS) || '[]'); } catch { return []; }
}

function accoda(voce) {
  const coda = leggiCoda().filter((v) => !(v.col === voce.col && v.id === voce.id));
  if (voce.op === 'put') voce.data = S.docs[voce.col]?.[voce.id];
  coda.push(voce);
  try { localStorage.setItem(CODA_LS, JSON.stringify(coda)); } catch { /* pieno */ }
}

export async function svuotaCoda() {
  const coda = leggiCoda();
  if (!coda.length) return;
  const resto = [];
  for (const v of coda) {
    try {
      if (v.op === 'put') await chiama('PUT', `docs/${v.col}/${v.id}`, v.data);
      else await chiama('DELETE', `docs/${v.col}/${v.id}`);
    } catch {
      resto.push(v);
    }
  }
  try { localStorage.setItem(CODA_LS, JSON.stringify(resto)); } catch { /* niente */ }
  statoRete(resto.length === 0);
}

let reteOk = true;
function statoRete(ok) {
  if (ok === reteOk) return;
  reteOk = ok;
  document.dispatchEvent(new CustomEvent('ag-rete', { detail: ok }));
}
setInterval(() => { if (!reteOk || leggiCoda().length) svuotaCoda(); }, 15000);

export function ascolta(fn) {
  S.ascoltatori.add(fn);
  return () => S.ascoltatori.delete(fn);
}

function notifica(col, id) {
  for (const fn of S.ascoltatori) fn(col, id);
}

// ---------------------------------------------------------------- vista giocatori
export async function leggiGiocatori() {
  return chiama('GET', 'giocatori');
}

// ---------------------------------------------------------------- immagini
// Ridimensiona sul dispositivo (lato lungo 2400 px, JPEG) prima di caricare.
export async function caricaImmagine(file) {
  const bmp = await createImageBitmap(file);
  const scala = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * scala);
  cv.height = Math.round(bmp.height * scala);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  const blob = await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.86));
  const { id } = await chiama('POST', 'img', blob, 'image/jpeg');
  return id;
}

const urlImg = new Map();
export async function urlImmagine(id) {
  if (urlImg.has(id)) return urlImg.get(id);
  const blob = IMMAGINI.get(id);
  if (!blob) throw new Error('immagine non disponibile');
  const u = URL.createObjectURL(blob);
  urlImg.set(id, u);
  return u;
}

export async function eliminaImmagine(id) {
  await chiama('DELETE', `img/${id}`);
}

export async function esporta() {
  return chiama('GET', 'esporta');
}

export async function importa(righe) {
  return chiama('POST', 'importa', righe);
}

// ---------------------------------------------------------------- impostazioni e spedizione attiva
export function impostazioni() {
  return S.docs.impostazioni?.generali || { gruppo: [], spedizioneAttiva: null, tema: 'scuro' };
}

export function salvaImpostazioni(patch) {
  salva('impostazioni', 'generali', { ...impostazioni(), ...patch });
}

export function spedizioneAttiva() {
  const id = impostazioni().spedizioneAttiva;
  return id ? { id, ...S.docs.spedizioni?.[id] } : null;
}

export function salvaSpedizione(sp) {
  const { id, ...data } = sp;
  salva('spedizioni', id, data);
}

export function nuovoId(prefisso) {
  return `${prefisso}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
