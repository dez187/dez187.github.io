// Avvio, accesso, cornice (testata, navigazione) e instradamento tra le viste.
import {
  S, accedi, ruoloSalvato, esci, caricaDati, caricaDocs, impostazioni, salvaImpostazioni, spedizioneAttiva,
  salvaSpedizione, nuovoId, sezione,
} from './store.js';
import { h, svuota, icona, bottone, toast, modale } from './ui.js';
import { controlloErranti, sogliaErranti } from './logica.js';
import { apriErrante } from './viste/incontro.js';

const app = document.getElementById('app');
app.removeAttribute('aria-live');

const VISTE = {
  tiro: { titolo: 'Tiro', ico: 'dado', carica: () => import('./viste/tiro.js') },
  percorso: { titolo: 'Percorso', ico: 'percorso', carica: () => import('./viste/spedizione.js') },
  mappa: { titolo: 'Mappe', ico: 'mappa', carica: () => import('./viste/mappa.js') },
  sezione: { titolo: 'Sezione', ico: 'stanza', carica: () => import('./viste/sezione.js') },
  incontro: { titolo: 'Incontro', ico: 'spade', carica: () => import('./viste/incontro.js') },
  bestiario: { titolo: 'Bestiario', ico: 'libro', carica: () => import('./viste/bestiario.js') },
  tabelle: { titolo: 'Tabelle', ico: 'tabella', carica: () => import('./viste/tabelle.js') },
  impostazioni: { titolo: 'Impostazioni', ico: 'ingranaggio', carica: () => import('./viste/impostazioni.js') },
};

let smonta = null;
let contenuto = null;
let navEl = null;
let testataEl = null;

function rotta() {
  const [nome, ...resto] = location.hash.replace(/^#\/?/, '').split('/');
  return { nome: nome || 'tiro', params: resto.map(decodeURIComponent) };
}

export function vai(percorso) {
  location.hash = `#/${percorso}`;
}

async function avvia() {
  applicaTema();
  const r = rotta();
  const ruolo = await ruoloSalvato();
  if (!ruolo) return schermataAccesso();
  await caricaDati();
  if (ruolo === 'giocatori' || r.nome === 'giocatori') return vistaGiocatori();
  await caricaDocs();
  preparaSpedizione();
  applicaTema();
  cornice();
  window.addEventListener('hashchange', mostra);
  mostra();
}

function applicaTema() {
  let t = 'scuro';
  try { t = S.docs.impostazioni?.generali?.tema || localStorage.getItem('ag-tema') || 'scuro'; } catch { /* niente */ }
  document.documentElement.dataset.tema = t;
}

async function vistaGiocatori() {
  document.body.classList.add('modo-giocatori');
  const m = await import('./viste/giocatori.js');
  m.monta(app);
}

function schermataAccesso(errore) {
  const inp = h('input', { class: 'campo', type: 'password', autocomplete: 'current-password', placeholder: 'Chiave del master o dei giocatori' });
  const msg = h('p', { class: 'accesso-errore', role: 'alert' }, errore || '');
  const invia = async (e) => {
    e.preventDefault();
    if (!inp.value.trim()) return;
    try {
      await accedi(inp.value);
      location.reload();
    } catch (err) {
      msg.textContent = err.stato === 401 ? 'Chiave sbagliata.' : `Il Gate non risponde (${err.message}).`;
    }
  };
  svuota(app, h('main', { class: 'accesso' },
    h('div', { class: 'accesso-scheda' },
      h('div', { class: 'accesso-segno' }, icona('lucchetto')),
      h('p', { class: 'occhiello' }, 'Ascension Gate'),
      h('h1', null, 'Tavolo del Master'),
      h('p', { class: 'sotto' }, 'Inserisci la chiave. Quella del master apre tutto, quella dei giocatori solo la loro schermata.'),
      h('form', { onsubmit: invia }, inp, bottone('Entra', null, { cls: 'primario largo', ico: 'freccia' })),
      msg)));
  app.querySelector('form button').type = 'submit';
  inp.focus();
}

function preparaSpedizione() {
  const imp = impostazioni();
  if (imp.spedizioneAttiva && S.docs.spedizioni?.[imp.spedizioneAttiva]) return;
  const esistente = Object.keys(S.docs.spedizioni || {})[0];
  if (esistente) return salvaImpostazioni({ spedizioneAttiva: esistente });
  const id = nuovoId('sp');
  salvaSpedizione({ id, nome: 'Prima spedizione', creata: Date.now(), gdm: 1, percorso: [], posizione: -1, pressione: 0, turni: 0, risorse: { torce: 6, razioni: 8, acqua: 8 }, registro: [], note: '' });
  salvaImpostazioni({ spedizioneAttiva: id });
}

// ---------------------------------------------------------------- cornice
function cornice() {
  testataEl = h('header', { class: 'testata' });
  navEl = h('nav', { class: 'nav', 'aria-label': 'Sezioni dell\'app' });
  contenuto = h('main', { class: 'contenuto', id: 'contenuto', tabindex: '-1' });
  svuota(app, h('div', { class: 'guscio' }, testataEl, navEl, contenuto));
  disegnaTestata();
  disegnaNav();
  document.addEventListener('ag-spedizione', () => { disegnaTestata(); disegnaNav(); });
  document.addEventListener('ag-rete', (e) => {
    testataEl.classList.toggle('offline', !e.detail);
    toast(e.detail ? 'Di nuovo in linea: dati salvati.' : 'Connessione persa: salvo appena torna.', e.detail ? '' : 'avviso');
  });
}

function disegnaNav() {
  const { nome } = rotta();
  svuota(navEl, Object.entries(VISTE).map(([k, v]) => {
    const href = k === 'sezione' ? `#/sezione/${ultimaSezione() || ''}` : `#/${k}`;
    return h('a', { class: `nav-voce ${k === nome ? 'attiva' : ''}`, href, 'aria-current': k === nome ? 'page' : null },
      icona(v.ico), h('span', null, v.titolo));
  }));
}

function ultimaSezione() {
  const sp = spedizioneAttiva();
  if (sp?.percorso?.length && sp.posizione >= 0) return sp.percorso[sp.posizione]?.sez;
  try { return localStorage.getItem('ag-ultima-sezione'); } catch { return null; }
}

export function disegnaTestata() {
  if (!testataEl) return;
  const sp = spedizioneAttiva();
  const tab = S.dati.tabelle.pressione;
  const pr = sp?.pressione ?? 0;
  const turni = sp?.turni ?? 0;
  const ore = Math.floor((turni * 10) / 60), min = (turni * 10) % 60;
  const cambiaPressione = (delta, motivo) => {
    const s = spedizioneAttiva();
    s.pressione = Math.max(0, Math.min(5, (s.pressione || 0) + delta));
    s.registro = [...(s.registro || []), { t: Date.now(), tipo: 'pressione', testo: `Pressione ${delta > 0 ? '+' : ''}${delta}${motivo ? ` (${motivo})` : ''}: ${tab[s.pressione].nome}` }].slice(-200);
    salvaSpedizione(s);
    disegnaTestata();
  };
  const turno = () => {
    const s = spedizioneAttiva();
    s.turni = (s.turni || 0) + 1;
    salvaSpedizione(s);
    disegnaTestata();
    if (s.turni % 3 === 0) {
      toast('Sono passati 30 minuti: controllo dei mostri erranti.');
      errante();
    }
  };
  const posizione = sp?.percorso?.[sp.posizione];
  const sezAttuale = posizione ? sezione(posizione.sez) : null;
  svuota(testataEl,
    h('a', { class: 'marchio', href: '#/tiro', 'aria-label': 'Ascension Gate, torna al tiro' },
      h('span', { class: 'marchio-segno' }), h('span', { class: 'marchio-testo' }, 'Ascension Gate')),
    h('button', { class: 'testata-spedizione', type: 'button', onclick: () => vai('percorso'), title: 'Apri il percorso della spedizione' },
      h('span', { class: 'etichetta-mini' }, 'Spedizione'),
      h('b', null, sp?.nome || '—'),
      sezAttuale ? h('span', { class: 'qui' }, icona('bersaglio'), sezAttuale.nome.replace(/^Livello /, 'L')) : null),
    h('div', { class: `pressione p${pr}`, title: tab[pr].effetto },
      h('span', { class: 'etichetta-mini' }, 'Pressione'),
      h('div', { class: 'pressione-controlli' },
        h('button', { class: 'btn-ico', type: 'button', onclick: () => cambiaPressione(-1), 'aria-label': 'Abbassa la Pressione' }, icona('meno')),
        h('div', { class: 'pressione-barra', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '5', 'aria-valuenow': String(pr), 'aria-label': `Pressione ${pr}: ${tab[pr].nome}` },
          [0, 1, 2, 3, 4].map((i) => h('i', { class: i < pr ? 'on' : '' })), h('b', null, tab[pr].nome)),
        h('button', { class: 'btn-ico', type: 'button', onclick: () => cambiaPressione(1), 'aria-label': 'Alza la Pressione' }, icona('piu')))),
    h('div', { class: 'tempo', title: 'Ogni turno sono 10 minuti; ogni 30 minuti si controllano i mostri erranti' },
      h('span', { class: 'etichetta-mini' }, 'Tempo'),
      h('div', { class: 'tempo-riga' },
        h('b', null, `${ore} h ${String(min).padStart(2, '0')}`),
        bottone('+10 min', turno, { cls: 'piccolo', ico: 'clessidra' }))),
    h('div', { class: 'testata-azioni' },
      bottone('Erranti', errante, { cls: 'piccolo', ico: 'dado', titolo: `Controllo mostri erranti: incontro con 1-${sogliaErranti(pr)} su d20` }),
      bottone('Giocatori', () => window.open('#/giocatori', 'ag-giocatori'), { cls: 'piccolo', ico: 'schermo', titolo: 'Apri la schermata dei giocatori (su un altro schermo o dispositivo)' })));
}

function errante() {
  const sp = spedizioneAttiva();
  const c = controlloErranti(sp?.pressione || 0);
  const s = spedizioneAttiva();
  s.registro = [...(s.registro || []), { t: Date.now(), tipo: 'erranti', testo: `Mostri erranti: d20 = ${c.tiro} (incontro con 1-${c.soglia}) → ${c.incontro ? 'INCONTRO' : 'niente'}` }].slice(-200);
  salvaSpedizione(s);
  apriErrante(c);
}

async function mostra() {
  const { nome, params } = rotta();
  if (nome === 'giocatori') return location.reload();
  const v = VISTE[nome] || VISTE.tiro;
  disegnaNav();
  if (smonta) { try { smonta(); } catch { /* vista già chiusa */ } smonta = null; }
  document.title = `${v.titolo} · Ascension Gate`;
  svuota(contenuto, h('div', { class: 'caricamento' }, 'Caricamento…'));
  try {
    const mod = await v.carica();
    svuota(contenuto);
    smonta = (await mod.monta(contenuto, params)) || null;
  } catch (e) {
    console.error(e);
    svuota(contenuto, h('div', { class: 'vuoto' }, h('h2', null, 'Qualcosa è andato storto'), h('p', null, e.message)));
  }
  contenuto.scrollTop = 0;
}

export function aggiornaTestata() {
  disegnaTestata();
  disegnaNav();
}

export function esciDalTavolo() {
  modale('Uscire?', h('p', null, 'Su questo dispositivo dovrai reinserire la chiave.'), [
    { testo: 'Annulla' },
    { testo: 'Esci', cls: 'pericolo', fn: () => { esci(); location.hash = ''; location.reload(); } },
  ]);
}

avvia().catch((e) => {
  console.error(e);
  svuota(app, h('div', { class: 'vuoto' }, h('h2', null, 'Il Gate non si apre'), h('p', null, e.message)));
});
