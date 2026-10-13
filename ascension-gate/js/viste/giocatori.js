// Schermata dei giocatori: legge ogni 2 secondi il documento preparato dal master e mostra
// la mappa (solo ciò che è stato rivelato), un'immagine o il testo da leggere.
import { leggiGiocatori, urlImmagine, S } from '../store.js';
import { h, svuota, icona } from '../ui.js';
import { disegnaGriglia } from './griglia-canvas.js';

// Ritaglia la griglia sulla parte esplorata (con un bordo), così la mappa riempie lo schermo.
function ritaglia(g) {
  let x1 = g.w, y1 = g.h, x2 = -1, y2 = -1;
  for (let i = 0; i < g.celle.length; i++) {
    if (g.celle.charCodeAt(i) === 48) continue;
    const x = i % g.w, y = (i / g.w) | 0;
    x1 = Math.min(x1, x); x2 = Math.max(x2, x); y1 = Math.min(y1, y); y2 = Math.max(y2, y);
  }
  if (x2 < 0) return g;
  // almeno 18 x 12 caselle, per non ingrandire troppo una stanza sola
  const allarga = (a, b, min, max) => {
    let span = b - a + 1 + 4;
    let s = a - 2;
    if (span < min) { s -= Math.floor((min - span) / 2); span = min; }
    s = Math.max(0, Math.min(s, max - span));
    return [s, Math.min(span, max)];
  };
  const [ox, w] = allarga(x1, x2, 18, g.w);
  const [oy, h] = allarga(y1, y2, 12, g.h);
  let celle = '';
  for (let y = oy; y < oy + h; y++) celle += g.celle.slice(y * g.w + ox, y * g.w + ox + w);
  const sposta = (p) => ({ ...p, x: p.x - ox, y: p.y - oy });
  return {
    w, h, celle,
    porte: (g.porte || []).map(sposta), segni: (g.segni || []).map(sposta),
    etichette: (g.etichette || []).map(sposta), gruppo: g.gruppo ? sposta(g.gruppo) : null,
  };
}

export function monta(app) {
  let ultimo = -1;
  let dati = null;
  const titolo = h('h1');
  const occhiello = h('p', { class: 'occhiello' });
  const centro = h('div', { class: 'giocatori-centro' });
  const testo = h('div', { class: 'giocatori-testo' });
  const stato = h('div', { class: 'giocatori-stato' });
  const schermo = h('button', { class: 'btn-ico', type: 'button', 'aria-label': 'Schermo intero', title: 'Schermo intero',
    onclick: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()) }, icona('schermo'));
  svuota(app, h('div', { class: 'giocatori' },
    h('header', { class: 'giocatori-testa' }, h('div', null, occhiello, titolo), schermo),
    centro, testo, stato));
  attesa();

  function attesa() {
    titolo.textContent = '';
    occhiello.textContent = 'Ascension Gate';
    svuota(testo);
    svuota(centro, h('div', { class: 'giocatori-attesa' }, h('div', { class: 'avvio-segno' }), 'Il master sta preparando la scena…'));
  }

  const mostra = async () => {
    if (!dati || dati.modo === 'nero') return attesa();
    titolo.textContent = dati.titolo || '';
    occhiello.textContent = dati.sottotitolo || 'Ascension Gate';
    svuota(testo, dati.testo ? h('p', null, dati.testo) : null);
    if (dati.modo === 'mappa' && dati.griglia) {
      const cv = h('canvas', { role: 'img', 'aria-label': 'Mappa esplorata' });
      svuota(centro, cv);
      const vista = ritaglia(dati.griglia);
      const disegna = () => {
        const r = centro.getBoundingClientRect();
        const cella = Math.max(8, Math.min(56, Math.floor(Math.min((r.width - 20) / vista.w, (r.height - 10) / vista.h))));
        disegnaGriglia(cv, vista, { cella, modo: 'giocatori', pav: dati.pav, muro: dati.muro, etichette: vista.etichette });
      };
      disegna();
      window.onresize = disegna;
    } else if (dati.modo === 'immagine' && dati.immagine) {
      const img = h('img', { alt: dati.titolo || 'Immagine' });
      svuota(centro, img);
      try { img.src = await urlImmagine(dati.immagine); } catch { svuota(centro, h('p', null, 'Immagine non disponibile.')); }
    } else {
      svuota(centro);
    }
  };

  const giro = async () => {
    try {
      const r = await leggiGiocatori();
      stato.textContent = '';
      if (r.aggiornato !== ultimo) {
        ultimo = r.aggiornato;
        dati = r.data;
        await mostra();
      }
    } catch (e) {
      stato.textContent = e.stato === 401 ? 'Chiave non valida' : 'Connessione persa, riprovo…';
    }
  };
  giro();
  setInterval(giro, 2000);
  // lo schermo non si spegne durante la sessione, se il browser lo permette
  try { navigator.wakeLock?.request('screen').catch(() => {}); } catch { /* niente */ }
  return S;
}
