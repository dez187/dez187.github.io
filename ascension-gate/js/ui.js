// Piccole utilità per costruire l'interfaccia senza framework.
import { crTesto } from './logica.js';

export function h(tag, attrs, ...figli) {
  const el = tag === 'frag' ? document.createDocumentFragment() : document.createElement(tag);
  if (attrs && tag !== 'frag') {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  aggiungi(el, figli);
  return el;
}

function aggiungi(el, figli) {
  for (const f of figli) {
    if (f == null || f === false) continue;
    if (Array.isArray(f)) aggiungi(el, f);
    else el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
}

export function svuota(el, ...figli) {
  el.replaceChildren();
  aggiungi(el, figli);
  return el;
}

// Icone disegnate a mano (tratto 1.6, 24x24), ereditano il colore del testo.
const ICONE = {
  dado: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/>',
  percorso: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h7a3 3 0 0 1 0 6H10a3 3 0 0 0 0 6h7"/>',
  mappa: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  stanza: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 12h7M14 12h7M12 3v6M12 15v6"/>',
  spade: '<path d="M4 20l6-6M14.5 3.5L20 4l.5 5.5-9 9-4-4z"/><path d="M20 20l-6-6M9.5 3.5L4 4l-.5 5.5 3 3"/>',
  libro: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M9 7h6"/>',
  tabella: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  ingranaggio: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  occhio: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  occhioNo: '<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3 3.6M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 4.4-1"/>',
  piu: '<path d="M12 5v14M5 12h14"/>',
  meno: '<path d="M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  su: '<path d="M6 15l6-6 6 6"/>',
  giu: '<path d="M6 9l6 6 6-6"/>',
  matita: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  cestino: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  gruppo: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M14 20a4 4 0 0 1 7-2.6"/>',
  fuoco: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z"/>',
  schermo: '<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M8 20h8M12 16v4"/>',
  immagine: '<rect x="3" y="4" width="18" height="16" rx="1"/><circle cx="9" cy="10" r="2"/><path d="M3 18l6-5 4 3 3-2 5 4"/>',
  freccia: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  indietro: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  clessidra: '<path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/>',
  scudo: '<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/>',
  cuore: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  rifai: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>',
  annulla: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  lucchetto: '<rect x="5" y="11" width="14" height="10" rx="1"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  esci: '<path d="M15 4h4v16h-4M10 16l4-4-4-4M14 12H3"/>',
  cerca: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  scarica: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  carica: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
  bersaglio: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
};

export function icona(nome, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', `ico ${cls}`);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONE[nome] || '';
  return s;
}

export function bottone(testo, onclick, { ico, cls = '', titolo, disabilitato } = {}) {
  return h('button', { class: `btn ${cls}`, onclick, title: titolo, type: 'button', disabled: disabilitato },
    ico ? icona(ico) : null, testo ? h('span', null, testo) : null);
}

export function pillGdm(g, testo) {
  return h('span', { class: `gdm gdm-${g}` }, testo || `GdM ${g}`);
}

export const NOMI_DUNGEON = {
  rd: 'La Radice', sa: 'Area Sicura',
};

// Nome breve per i nodi e le liste: "1B · Il Bastione Abbandonato"
export function nomeBreve(sez) {
  const m = sez.nome.match(/^Livello (\w+) - (.*)$/);
  if (m) return `${m[1]} · ${m[2]}`;
  if (sez.nome.startsWith('Livello del Terreno')) return `0 · ${sez.nome.replace('Livello del Terreno - ', '')}`;
  return sez.nome;
}

// ---------------------------------------------------------------- avvisi
let contToast;
export function toast(msg, tipo = '') {
  if (!contToast) {
    contToast = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(contToast);
  }
  const t = h('div', { class: `toast ${tipo}` }, msg);
  contToast.append(t);
  setTimeout(() => t.classList.add('via'), 2600);
  setTimeout(() => t.remove(), 3100);
}

export function modale(titolo, corpo, azioni = []) {
  const chiudi = () => { sfondo.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') chiudi(); };
  const sfondo = h('div', { class: 'modale-sfondo', onclick: (e) => { if (e.target === sfondo) chiudi(); } },
    h('div', { class: 'modale', role: 'dialog', 'aria-modal': 'true', 'aria-label': titolo },
      h('div', { class: 'modale-testa' }, h('h3', null, titolo),
        h('button', { class: 'btn-ico', onclick: chiudi, 'aria-label': 'Chiudi', type: 'button' }, icona('x'))),
      h('div', { class: 'modale-corpo' }, corpo),
      azioni.length ? h('div', { class: 'modale-azioni' }, azioni.map((a) => bottone(a.testo, () => {
        if (a.fn?.() !== false) chiudi();
      }, { cls: a.cls || '' }))) : null));
  document.body.append(sfondo);
  document.addEventListener('keydown', esc);
  sfondo.querySelector('input, textarea, select, button:not(.btn-ico)')?.focus();
  return chiudi;
}

export function conferma(msg, fn, testoOk = 'Conferma') {
  modale('Sei sicuro?', h('p', null, msg), [
    { testo: 'Annulla' },
    { testo: testoOk, cls: 'pericolo', fn },
  ]);
}

export function chiedi(titolo, etichetta, valore, fn) {
  const inp = h('input', { class: 'campo', value: valore || '' });
  modale(titolo, h('label', { class: 'etichetta' }, etichetta, inp), [
    { testo: 'Annulla' },
    { testo: 'Salva', cls: 'primario', fn: () => fn(inp.value.trim()) },
  ]);
  setTimeout(() => inp.select(), 30);
}

// ---------------------------------------------------------------- dadi
// Mostra i tiri come gettoni che "rotolano" per mezzo secondo prima di fermarsi sul risultato.
export function gettoniDadi(tiri) {
  return h('div', { class: 'dadi' }, tiri.map((t, i) => {
    const valore = h('b', null, String(t.risultato));
    const el = h('div', { class: 'dado-tiro', style: { animationDelay: `${i * 120}ms` } },
      h('span', { class: 'dado-tipo' }, `d${t.dado}`), valore,
      t.cosa ? h('span', { class: 'dado-cosa' }, t.cosa) : null);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      let n = 0;
      const giro = setInterval(() => {
        valore.textContent = String(1 + Math.floor(Math.random() * t.dado));
        if (++n > 7 + i * 2) { clearInterval(giro); valore.textContent = String(t.risultato); el.classList.add('fermo'); }
      }, 55);
    } else el.classList.add('fermo');
    return el;
  }));
}

// ---------------------------------------------------------------- scheda del mostro
const CAR = ['FOR', 'DES', 'COS', 'INT', 'SAG', 'CAR'];
const TIPI = {
  aberration: 'Aberrazione', beast: 'Bestia', celestial: 'Celestiale', construct: 'Costrutto', dragon: 'Drago',
  elemental: 'Elementale', fey: 'Fatato', fiend: 'Immondo', giant: 'Gigante', humanoid: 'Umanoide',
  monstrosity: 'Mostruosità', ooze: 'Melma', plant: 'Pianta', undead: 'Non morto',
};
const TAGLIE = { tiny: 'Minuscola', small: 'Piccola', medium: 'Media', large: 'Grande', huge: 'Enorme', gargantuan: 'Mastodontica' };
export const nomeTipo = (t) => TIPI[t] || t;
export const nomeTaglia = (t) => TAGLIE[t] || t;
const MOD = (v) => { const m = Math.floor((v - 10) / 2); return m >= 0 ? `+${m}` : `${m}`; };
const TS_NOMI = { strength: 'FOR', dexterity: 'DES', constitution: 'COS', intelligence: 'INT', wisdom: 'SAG', charisma: 'CAR' };

// Testo con **grassetto** e _corsivo_ minimali (le descrizioni SRD usano il markdown).
function testoRicco(t) {
  const frag = document.createDocumentFragment();
  for (const par of String(t).split(/\n\n+/)) {
    const p = h('p');
    const parti = par.split(/(\*\*[^*]+\*\*|_[^_]+_)/g);
    for (const x of parti) {
      if (x.startsWith('**')) p.append(h('b', null, x.slice(2, -2)));
      else if (x.startsWith('_') && x.endsWith('_') && x.length > 2) p.append(h('i', null, x.slice(1, -1)));
      else p.append(x.replace(/^- /gm, '• '));
    }
    frag.append(p);
  }
  return frag;
}

export function schedaMostro(m, { compatta = false } = {}) {
  const blocco = (titolo, voci) => voci?.length ? h('div', { class: 'sb-blocco' },
    titolo ? h('h5', null, titolo) : null,
    voci.map((v) => h('div', { class: 'sb-voce' }, h('b', null, `${v.n}. `), testoRicco(v.d)))) : null;
  const riga = (et, val) => val ? h('div', { class: 'sb-riga' }, h('b', null, et + ' '), val) : null;
  const ts = m.ts && Object.keys(m.ts).length
    ? Object.entries(m.ts).map(([k, v]) => `${TS_NOMI[k] || k} ${v >= 0 ? '+' : ''}${v}`).join(', ') : null;
  const abil = m.abil && Object.keys(m.abil).length
    ? Object.entries(m.abil).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v >= 0 ? '+' : ''}${v}`).join(', ') : null;
  return h('article', { class: `scheda-mostro ${compatta ? 'compatta' : ''}` },
    h('header', null,
      h('h4', null, m.it, m.en && m.en !== m.it ? h('small', null, ` · ${m.en}`) : null),
      h('div', { class: 'sb-sotto' }, `${nomeTipo(m.tipo)}, taglia ${nomeTaglia(m.taglia)}${m.all ? ` · ${m.all}` : ''}`),
      m.desc ? h('p', { class: 'sb-desc' }, m.desc) : null),
    h('div', { class: 'sb-numeri' },
      h('div', null, h('span', null, 'CA'), h('b', null, String(m.ca)), m.cad ? h('small', null, m.cad) : null),
      h('div', null, h('span', null, 'PF'), h('b', null, String(m.pf)), m.dv ? h('small', null, m.dv) : null),
      h('div', null, h('span', null, 'Iniziativa'), h('b', null, (m.init >= 0 ? '+' : '') + m.init)),
      h('div', null, h('span', null, 'GS'), h('b', null, crTesto(m.cr)), h('small', null, `${(m.xp || 0).toLocaleString('it-IT')} PE`))),
    riga('Velocità', m.vel),
    m.car ? h('div', { class: 'sb-car' }, m.car.map((v, i) => h('div', null, h('span', null, CAR[i]), h('b', null, String(v)), h('small', null, MOD(v))))) : null,
    riga('Tiri salvezza', compatta ? null : ts),
    riga('Abilità', abil),
    riga('Vulnerabilità', m.vuln), riga('Resistenze', m.res), riga('Immunità', [m.imm, m.immc].filter(Boolean).join('; ')),
    riga('Sensi', m.sensi), riga('Lingue', compatta ? null : m.lingue),
    blocco('Tratti', m.tratti), blocco('Azioni', m.azioni), blocco('Azioni bonus', m.bonus),
    blocco('Reazioni', m.reazioni), blocco('Azioni leggendarie', m.leggendarie),
    m.testo ? h('div', { class: 'sb-blocco' }, testoRicco(m.testo)) : null,
    h('footer', null, m.fonte || ''));
}

export function formatData(ts) {
  return new Date(ts).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Navigazione e avviso di aggiornamento della testata (senza importare app.js dalle viste).
export function vai(percorso) {
  location.hash = `#/${percorso}`;
}

export function aggiornaTestata() {
  document.dispatchEvent(new Event('ag-spedizione'));
}

// Numeri cerchiati per l'ordine di visita sulla mappa (①…⑳, poi #21).
export function numeroCerchiato(n) {
  return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `#${n}`;
}
