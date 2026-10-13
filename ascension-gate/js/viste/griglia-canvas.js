// Disegno delle mappe di sezione su canvas (stile carta da dungeon: pavimento chiaro a quadretti,
// roccia tratteggiata, porte, segni) ed editor a pennello per il master.
import { T, decodifica, codifica, celleVisibili } from '../generatore.js';

const COLORI = {
  nebbia: '#07090b', acqua: '#4a7ea3', acquaRiflesso: 'rgba(255,255,255,0.28)', lava: '#c8531f', lavaLuce: '#ffb24a',
  fango: '#6b5a40', colonna: '#2a2520', muroLinea: '#15120f', porta: '#8a5a2b', portaChiusa: '#6b3f1d', oro: '#e7c14e',
  trappola: '#e84d4d', ingresso: '#3fbf7f', uscita: '#f2b35b', gruppo: '#4fe0d6', selezione: '#4fe0d6',
};

// Centri delle stanze (media delle celle), per i numeri.
export function centriStanze(g) {
  const acc = new Map();
  for (let i = 0; i < g.zona.length; i++) {
    const z = g.zona[i];
    if (z < 0) continue;
    const a = acc.get(z) || { x: 0, y: 0, n: 0 };
    a.x += i % g.w; a.y += (i / g.w) | 0; a.n++;
    acc.set(z, a);
  }
  const out = new Map();
  for (const [z, a] of acc) out.set(z, { x: a.x / a.n, y: a.y / a.n });
  return out;
}

// g: { w, h, celle (stringa), porte, segni, gruppo, zona? , etichette? }
// opz: { cella, modo: 'master'|'giocatori', anteprima, selezionata, pav, muro, visibili (Uint8Array) }
export function disegnaGriglia(canvas, g, opz) {
  const { cella, modo = 'master' } = opz;
  const dpr = window.devicePixelRatio || 1;
  const W = g.w * cella, H = g.h * cella;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const celle = decodifica(g.celle);
  const pav = opz.pav || '#d6d0c2';
  const muro = opz.muro || '#1f1d1a';
  const at = (x, y) => (x < 0 || y < 0 || x >= g.w || y >= g.h ? T.ROCCIA : celle[y * g.w + x]);
  const solido = (x, y) => at(x, y) === T.ROCCIA;

  ctx.fillStyle = COLORI.nebbia;
  ctx.fillRect(0, 0, W, H);

  // roccia vicina a spazi aperti: campitura tratteggiata come sulle mappe a mano
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (!solido(x, y)) continue;
      let vicino = false;
      for (let dy = -1; dy <= 1 && !vicino; dy++) for (let dx = -1; dx <= 1; dx++) if (!solido(x + dx, y + dy)) { vicino = true; break; }
      if (!vicino) continue;
      const px = x * cella, py = y * cella;
      ctx.fillStyle = muro;
      ctx.fillRect(px, py, cella, cella);
      ctx.save();
      ctx.beginPath();
      ctx.rect(px, py, cella, cella);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.lineWidth = 1;
      for (let k = -cella; k < cella * 2; k += Math.max(4, cella / 3)) {
        ctx.beginPath();
        ctx.moveTo(px + k, py);
        ctx.lineTo(px + k - cella, py + cella);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // pavimento e terreni
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const t = at(x, y);
      if (t === T.ROCCIA) continue;
      const px = x * cella, py = y * cella;
      ctx.fillStyle = pav;
      ctx.fillRect(px, py, cella, cella);
      if (t === T.ACQUA) {
        ctx.fillStyle = COLORI.acqua;
        ctx.fillRect(px, py, cella, cella);
        ctx.strokeStyle = COLORI.acquaRiflesso;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px + cella * 0.2, py + cella * 0.45);
        ctx.quadraticCurveTo(px + cella * 0.35, py + cella * 0.3, px + cella * 0.5, py + cella * 0.45);
        ctx.quadraticCurveTo(px + cella * 0.65, py + cella * 0.6, px + cella * 0.8, py + cella * 0.45);
        ctx.stroke();
      } else if (t === T.LAVA) {
        const grad = ctx.createRadialGradient(px + cella / 2, py + cella / 2, 1, px + cella / 2, py + cella / 2, cella * 0.7);
        grad.addColorStop(0, COLORI.lavaLuce);
        grad.addColorStop(1, COLORI.lava);
        ctx.fillStyle = grad;
        ctx.fillRect(px, py, cella, cella);
      } else if (t === T.FANGO) {
        ctx.fillStyle = COLORI.fango;
        ctx.fillRect(px, py, cella, cella);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.arc(px + cella * 0.35, py + cella * 0.4, cella * 0.1, 0, Math.PI * 2);
        ctx.arc(px + cella * 0.68, py + cella * 0.66, cella * 0.07, 0, Math.PI * 2);
        ctx.fill();
      } else if (t === T.COLONNA) {
        ctx.fillStyle = COLORI.colonna;
        ctx.beginPath();
        ctx.arc(px + cella / 2, py + cella / 2, cella * 0.34, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // quadretti
  ctx.strokeStyle = 'rgba(40, 30, 20, 0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (solido(x, y)) continue;
      const px = x * cella + 0.5, py = y * cella + 0.5;
      ctx.rect(px, py, cella, cella);
    }
  }
  ctx.stroke();

  // pareti
  ctx.strokeStyle = COLORI.muroLinea;
  ctx.lineWidth = Math.max(1.5, cella / 9);
  ctx.lineCap = 'square';
  ctx.beginPath();
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (solido(x, y)) continue;
      const px = x * cella, py = y * cella;
      if (solido(x, y - 1)) { ctx.moveTo(px, py); ctx.lineTo(px + cella, py); }
      if (solido(x, y + 1)) { ctx.moveTo(px, py + cella); ctx.lineTo(px + cella, py + cella); }
      if (solido(x - 1, y)) { ctx.moveTo(px, py); ctx.lineTo(px, py + cella); }
      if (solido(x + 1, y)) { ctx.moveTo(px + cella, py); ctx.lineTo(px + cella, py + cella); }
    }
  }
  ctx.stroke();

  // porte
  for (const [i, p] of (g.porte || []).entries()) {
    if (solido(p.x, p.y)) continue;
    const trovata = (g.trovate || []).includes(i);
    if (modo === 'giocatori' && p.tipo === 'segreta' && !trovata) continue;
    const cx = p.x * cella + cella / 2, cy = p.y * cella + cella / 2;
    const lungo = cella * 0.86, corto = Math.max(3, cella * 0.28);
    const [w, h] = p.or === 'v' ? [lungo, corto] : [corto, lungo];
    if (p.tipo === 'segreta' && modo !== 'giocatori') {
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = trovata ? COLORI.porta : '#b36bff';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
      ctx.setLineDash([]);
      ctx.fillStyle = '#b36bff';
      ctx.font = `600 ${Math.round(cella * 0.5)}px JetBrains Mono, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('S', cx, cy);
      continue;
    }
    ctx.fillStyle = p.tipo === 'chiusa' ? COLORI.portaChiusa : COLORI.porta;
    ctx.strokeStyle = COLORI.muroLinea;
    ctx.lineWidth = 1.5;
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
    if (modo !== 'giocatori' && p.tipo === 'chiusa') {
      ctx.fillStyle = COLORI.oro;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1.5, cella * 0.09), 0, Math.PI * 2);
      ctx.fill();
    }
    if (modo !== 'giocatori' && p.tipo === 'bloccata') {
      ctx.strokeStyle = COLORI.oro;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - w / 2, cy - h / 2); ctx.lineTo(cx + w / 2, cy + h / 2);
      ctx.stroke();
    }
  }

  // segni
  for (const s of g.segni || []) {
    if (solido(s.x, s.y)) continue;
    if (modo === 'giocatori' && (s.tipo === 'trappola' || s.tipo === 'tesoro')) continue;
    const cx = s.x * cella + cella / 2, cy = s.y * cella + cella / 2, r = cella * 0.36;
    ctx.lineWidth = 2;
    if (s.tipo === 'trappola') {
      ctx.fillStyle = COLORI.trappola;
      ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy + r * 0.8); ctx.lineTo(cx - r, cy + r * 0.8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${Math.round(cella * 0.42)}px JetBrains Mono, monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('!', cx, cy + r * 0.15);
    } else if (s.tipo === 'tesoro') {
      ctx.fillStyle = COLORI.oro;
      ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.8, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r * 0.8, cy); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#6b5210'; ctx.stroke();
    } else if (s.tipo === 'ingresso' || s.tipo === 'uscita') {
      ctx.strokeStyle = s.tipo === 'ingresso' ? COLORI.ingresso : COLORI.uscita;
      ctx.lineWidth = Math.max(1.5, cella / 10);
      for (let k = 0; k < 4; k++) {
        const yy = cy - r + (k * r * 2) / 3;
        const ww = r * (1 - k * 0.18);
        ctx.beginPath(); ctx.moveTo(cx - ww, yy); ctx.lineTo(cx + ww, yy); ctx.stroke();
      }
    }
  }

  // numeri delle stanze
  const numeri = opz.etichette || (g.zona && g.stanze ? [...centriStanze(g)].map(([z, c]) => {
    const st = g.stanze.find((s) => s.id === z);
    return st ? { n: st.n, x: c.x, y: c.y, id: st.id } : null;
  }).filter(Boolean) : []);
  if (opz.numeri !== false) {
    for (const e of numeri) {
      const cx = e.x * cella + cella / 2, cy = e.y * cella + cella / 2, r = Math.max(8, cella * 0.42);
      ctx.fillStyle = 'rgba(255, 252, 244, 0.92)';
      ctx.strokeStyle = COLORI.muroLinea;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1b1510';
      ctx.font = `700 ${Math.round(r * 1.05)}px JetBrains Mono, monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(e.n), cx, cy + 1);
    }
  }

  // stanza selezionata
  if (opz.selezionata != null && g.zona) {
    ctx.strokeStyle = COLORI.selezione;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    const z = opz.selezionata;
    const inZ = (x, y) => x >= 0 && y >= 0 && x < g.w && y < g.h && g.zona[y * g.w + x] === z;
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        if (!inZ(x, y)) continue;
        const px = x * cella, py = y * cella;
        if (!inZ(x, y - 1)) { ctx.moveTo(px, py); ctx.lineTo(px + cella, py); }
        if (!inZ(x, y + 1)) { ctx.moveTo(px, py + cella); ctx.lineTo(px + cella, py + cella); }
        if (!inZ(x - 1, y)) { ctx.moveTo(px, py); ctx.lineTo(px, py + cella); }
        if (!inZ(x + 1, y)) { ctx.moveTo(px + cella, py); ctx.lineTo(px + cella, py + cella); }
      }
    }
    ctx.stroke();
  }

  // anteprima di ciò che vedono i giocatori
  if (opz.anteprima && opz.visibili) {
    ctx.fillStyle = 'rgba(3, 5, 7, 0.72)';
    for (let i = 0; i < opz.visibili.length; i++) {
      if (opz.visibili[i]) continue;
      ctx.fillRect((i % g.w) * cella, ((i / g.w) | 0) * cella, cella, cella);
    }
  }

  // gettone del gruppo
  if (g.gruppo) {
    const cx = g.gruppo.x * cella + cella / 2, cy = g.gruppo.y * cella + cella / 2, r = Math.max(6, cella * 0.4);
    ctx.save();
    ctx.shadowColor = COLORI.gruppo;
    ctx.shadowBlur = 12;
    ctx.fillStyle = COLORI.gruppo;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#06201e';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#06201e';
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.35, 0, Math.PI * 2); ctx.fill();
  }
}

// La versione della griglia che si manda ai giocatori: solo celle viste, niente trappole
// né tesori, porte segrete non trovate trasformate in muro.
export function grigliaPerGiocatori(g) {
  const vis = celleVisibili(g);
  const celle = decodifica(g.celle);
  const trov = new Set(g.trovate || []);
  const visibili = celle.map((c, i) => (vis[i] ? c : 0));
  const porte = g.porte.map((p, i) => ({ ...p, i }))
    .filter((p) => vis[p.y * g.w + p.x] && (p.tipo !== 'segreta' || trov.has(p.i)))
    .map((p) => ({ x: p.x, y: p.y, or: p.or, tipo: 'normale' }));
  const segni = g.segni.filter((s) => (s.tipo === 'ingresso' || s.tipo === 'uscita') && vis[s.y * g.w + s.x]);
  const centri = centriStanze(g);
  const etichette = g.stanze.filter((s) => g.rivelate.includes(s.id) && centri.has(s.id))
    .map((s) => ({ n: s.n, x: centri.get(s.id).x, y: centri.get(s.id).y }));
  const gruppo = g.gruppo && vis[g.gruppo.y * g.w + g.gruppo.x] ? g.gruppo : null;
  return { w: g.w, h: g.h, celle: codifica(visibili), porte, segni, etichette, gruppo };
}

// ---------------------------------------------------------------- editor
export const STRUMENTI = [
  { id: 'seleziona', nome: 'Seleziona' },
  { id: 'gruppo', nome: 'Gruppo' },
  { id: 'rivela', nome: 'Rivela' },
  { id: 'pavimento', nome: 'Pavimento', colore: '#d6d0c2', t: T.PAV },
  { id: 'roccia', nome: 'Roccia', colore: '#1f1d1a', t: T.ROCCIA },
  { id: 'acqua', nome: 'Acqua', colore: COLORI.acqua, t: T.ACQUA },
  { id: 'lava', nome: 'Lava', colore: COLORI.lava, t: T.LAVA },
  { id: 'fango', nome: 'Fango', colore: COLORI.fango, t: T.FANGO },
  { id: 'colonna', nome: 'Colonna', colore: COLORI.colonna, t: T.COLONNA },
  { id: 'porta', nome: 'Porta' },
  { id: 'trappola', nome: 'Trappola', colore: COLORI.trappola },
  { id: 'tesoro', nome: 'Tesoro', colore: COLORI.oro },
  { id: 'stanza', nome: 'Nuova stanza' },
];

const CICLO_PORTE = ['normale', 'bloccata', 'chiusa', 'segreta', null];

export function creaEditor(contenitore, statoIniziale, { tema, onCambia, onSeleziona }) {
  let g = statoIniziale;
  let strumento = 'seleziona';
  let selezionata = null;
  let anteprima = false;
  let cella = 20;
  let premuto = false;
  let inizioStanza = null;
  let rettangolo = null;
  const annulla = [];
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', 'Mappa della sezione');
  canvas.setAttribute('role', 'img');
  contenitore.replaceChildren(canvas);

  const ridimensiona = () => {
    const w = contenitore.clientWidth || 800;
    cella = Math.max(10, Math.min(30, Math.floor(w / g.w)));
    disegna();
  };
  const ro = new ResizeObserver(ridimensiona);
  ro.observe(contenitore);

  function disegna() {
    disegnaGriglia(canvas, g, {
      cella, modo: 'master', selezionata, anteprima, visibili: anteprima ? celleVisibili(g) : null,
      pav: tema?.pav, muro: tema?.muro,
    });
    if (rettangolo) {
      const ctx = canvas.getContext('2d');
      const [x1, y1, x2, y2] = rettangolo;
      ctx.strokeStyle = '#f2b35b';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.min(x1, x2) * cella, Math.min(y1, y2) * cella, (Math.abs(x2 - x1) + 1) * cella, (Math.abs(y2 - y1) + 1) * cella);
      ctx.setLineDash([]);
    }
  }

  const istantanea = () => JSON.stringify({ celle: g.celle, zona: g.zona, porte: g.porte, segni: g.segni, stanze: g.stanze, rivelate: g.rivelate, gruppo: g.gruppo, trovate: g.trovate });
  const ricorda = () => { annulla.push(istantanea()); if (annulla.length > 40) annulla.shift(); };
  const cambia = () => { g.aggiornata = Date.now(); disegna(); onCambia?.(g); };

  const cellaDa = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / cella), y = Math.floor((e.clientY - r.top) / cella);
    return x >= 0 && y >= 0 && x < g.w && y < g.h ? [x, y] : null;
  };

  const dipingi = (x, y, t) => {
    const celle = decodifica(g.celle);
    const i = y * g.w + x;
    if (celle[i] === t) return;
    celle[i] = t;
    g.celle = codifica(celle);
    if (t === T.ROCCIA) g.porte = g.porte.filter((p) => !(p.x === x && p.y === y));
  };

  const agisci = (e, inizio) => {
    const c = cellaDa(e);
    if (!c) return;
    const [x, y] = c;
    const i = y * g.w + x;
    const st = STRUMENTI.find((s) => s.id === strumento);
    if (st?.t != null) {
      if (inizio) ricorda();
      dipingi(x, y, st.t);
      disegna();
      return;
    }
    if (!inizio) {
      if (strumento === 'stanza' && inizioStanza) { rettangolo = [...inizioStanza, x, y]; disegna(); }
      return;
    }
    const z = g.zona[i];
    if (strumento === 'seleziona') {
      selezionata = z >= 0 ? z : null;
      disegna();
      onSeleziona?.(selezionata);
    } else if (strumento === 'gruppo') {
      ricorda();
      g.gruppo = { x, y };
      if (z >= 0 && !g.rivelate.includes(z)) g.rivelate = [...g.rivelate, z];
      if (z >= 0) { selezionata = z; onSeleziona?.(z); }
      cambia();
    } else if (strumento === 'rivela') {
      if (z < 0) return;
      ricorda();
      g.rivelate = g.rivelate.includes(z) ? g.rivelate.filter((r) => r !== z) : [...g.rivelate, z];
      cambia();
    } else if (strumento === 'porta') {
      const celle = decodifica(g.celle);
      if (celle[i] === T.ROCCIA) return;
      ricorda();
      const k = g.porte.findIndex((p) => p.x === x && p.y === y);
      if (k >= 0) {
        const prossimo = CICLO_PORTE[(CICLO_PORTE.indexOf(g.porte[k].tipo) + 1) % CICLO_PORTE.length];
        if (prossimo) g.porte[k] = { ...g.porte[k], tipo: prossimo };
        else { g.porte.splice(k, 1); g.trovate = (g.trovate || []).filter((t) => t !== k).map((t) => (t > k ? t - 1 : t)); }
      } else {
        const or = celle[y * g.w + x - 1] === T.ROCCIA && celle[y * g.w + x + 1] === T.ROCCIA ? 'v' : 'h';
        g.porte.push({ x, y, tipo: 'normale', or });
      }
      cambia();
    } else if (strumento === 'trappola' || strumento === 'tesoro') {
      ricorda();
      const k = g.segni.findIndex((s) => s.x === x && s.y === y && s.tipo === strumento);
      if (k >= 0) g.segni.splice(k, 1);
      else g.segni.push({ tipo: strumento, x, y, stanza: z >= 0 ? z : null });
      cambia();
    } else if (strumento === 'stanza') {
      inizioStanza = [x, y];
      rettangolo = [x, y, x, y];
      disegna();
    }
  };

  const creaStanza = () => {
    if (!rettangolo) return;
    const [x1, y1, x2, y2] = rettangolo;
    const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1) + 1, hh = Math.abs(y2 - y1) + 1;
    rettangolo = null;
    inizioStanza = null;
    if (w < 2 || hh < 2) return disegna();
    ricorda();
    const id = Math.max(-1, ...g.stanze.map((s) => s.id)) + 1;
    const n = Math.max(0, ...g.stanze.map((s) => s.n)) + 1;
    const celle = decodifica(g.celle);
    for (let yy = y; yy < y + hh; yy++) for (let xx = x; xx < x + w; xx++) { celle[yy * g.w + xx] = T.PAV; g.zona[yy * g.w + xx] = id; }
    g.celle = codifica(celle);
    g.stanze.push({ id, n, x, y, w, h: hh, forma: 'rett', ruolo: 'normale', descr: '', elemento: '', mostri: [], trappola: null, tesoro: [], note: '', titolo: 'Nuova stanza' });
    selezionata = id;
    cambia();
    onSeleziona?.(id);
  };

  canvas.addEventListener('pointerdown', (e) => { premuto = true; canvas.setPointerCapture(e.pointerId); agisci(e, true); });
  canvas.addEventListener('pointermove', (e) => { if (premuto) agisci(e, false); });
  const fine = () => {
    if (!premuto) return;
    premuto = false;
    if (strumento === 'stanza') creaStanza();
    else if (STRUMENTI.find((s) => s.id === strumento)?.t != null) cambia();
  };
  canvas.addEventListener('pointerup', fine);
  canvas.addEventListener('pointercancel', fine);

  ridimensiona();
  return {
    get g() { return g; },
    imposta(nuova) { g = nuova; selezionata = null; disegna(); },
    strumento(id) { strumento = id; canvas.style.cursor = id === 'seleziona' ? 'pointer' : 'crosshair'; },
    anteprima(v) { anteprima = v; disegna(); },
    seleziona(z) { selezionata = z; disegna(); },
    annulla() {
      const s = annulla.pop();
      if (!s) return false;
      Object.assign(g, JSON.parse(s));
      cambia();
      return true;
    },
    ridisegna: disegna,
    distruggi() { ro.disconnect(); },
  };
}
