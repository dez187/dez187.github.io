// Generatore procedurale delle mappe di sezione (griglia a caselle da 1,5 m).
// Deterministico: stessa sezione + stesso seme = stessa mappa. Nessun DOM.
import {
  rngSeme, budget, gruppoTipico, risolviPool, generaIncontro, rendiTrappola, trappolePerTema, tiraTesoro, tiraFormula,
} from './logica.js';

export const T = { ROCCIA: 0, PAV: 1, ACQUA: 2, LAVA: 3, FANGO: 4, COLONNA: 5 };
export const W = 44;
export const H = 32;

const PERICOLI = { acqua: T.ACQUA, lava: T.LAVA, fango: T.FANGO, vapore: T.ACQUA };

export function generaGriglia(sez, dati, { seme = 1, gruppo = null } = {}) {
  const r = rngSeme(`${sez.id}:${seme}`);
  const tema = dati.temi[sez.tema] || dati.temi.caverna;
  const celle = new Uint8Array(W * H);
  const zona = new Int16Array(W * H).fill(-1);
  const sicura = sez.d === 'sa';

  // 1. Stanze
  const nVoluto = sicura ? (sez.g >= 3 ? r.int(7, 10) : r.int(3, 5)) : r.int(7, 11);
  const stanze = [];
  for (let tent = 0; tent < 900 && stanze.length < nVoluto; tent++) {
    const w = r.int(4, sicura && sez.g >= 3 ? 10 : 9);
    const h = r.int(4, 7);
    const x = r.int(1, W - w - 2);
    const y = r.int(1, H - h - 2);
    const margine = tent < 600 ? 2 : 1;
    const urta = stanze.some((s) => x < s.x + s.w + margine && x + w + margine > s.x && y < s.y + s.h + margine && y + h + margine > s.y);
    if (urta) continue;
    const forma = tema.forma === 'grotta' || (tema.forma === 'misto' && r.chance(0.5)) ? 'grotta' : 'rett';
    stanze.push({ x, y, w, h, forma });
  }
  // numerazione da sinistra a destra, dall'alto in basso: più facile da leggere al tavolo
  stanze.sort((a, b) => a.x + a.y * 0.6 - (b.x + b.y * 0.6));
  stanze.forEach((s, i) => { s.id = i; s.n = i + 1; });

  const idx = (x, y) => y * W + x;
  for (const s of stanze) {
    const cx = s.x + (s.w - 1) / 2, cy = s.y + (s.h - 1) / 2;
    const rx = s.w / 2, ry = s.h / 2;
    for (let y = s.y; y < s.y + s.h; y++) {
      for (let x = s.x; x < s.x + s.w; x++) {
        let dentro = true;
        if (s.forma === 'grotta') {
          const dx = (x - cx) / rx, dy = (y - cy) / ry;
          dentro = dx * dx + dy * dy <= 1.05 + (r.f() - 0.5) * 0.45;
        }
        if (dentro) {
          celle[idx(x, y)] = T.PAV;
          zona[idx(x, y)] = s.id;
        }
      }
    }
    // la cella centrale è sempre pavimento: i corridoi partono da lì
    celle[idx(Math.round(cx), Math.round(cy))] = T.PAV;
    zona[idx(Math.round(cx), Math.round(cy))] = s.id;
  }

  // 2. Collegamenti: albero minimo (Prim) + qualche anello
  const centro = (s) => [Math.round(s.x + (s.w - 1) / 2), Math.round(s.y + (s.h - 1) / 2)];
  const dist = (a, b) => {
    const [ax, ay] = centro(a), [bx, by] = centro(b);
    return Math.abs(ax - bx) + Math.abs(ay - by);
  };
  const archi = [];
  const dentro = new Set([0]);
  while (dentro.size < stanze.length) {
    let best = null;
    for (const i of dentro) {
      for (let j = 0; j < stanze.length; j++) {
        if (dentro.has(j)) continue;
        const dd = dist(stanze[i], stanze[j]);
        if (!best || dd < best.dd) best = { a: i, b: j, dd };
      }
    }
    dentro.add(best.b);
    archi.push({ a: best.a, b: best.b, albero: true });
  }
  for (let i = 0; i < stanze.length; i++) {
    if (!r.chance(0.3)) continue;
    const vicini = stanze.map((s, j) => ({ j, dd: dist(stanze[i], s) })).filter((v) => v.j !== i)
      .sort((p, q) => p.dd - q.dd).slice(0, 3);
    const v = r.pick(vicini);
    if (v && !archi.some((e) => (e.a === i && e.b === v.j) || (e.a === v.j && e.b === i))) {
      archi.push({ a: i, b: v.j, albero: false });
    }
  }

  // 3. Corridoi a L, con porte dove il corridoio entra in una stanza rettangolare
  const porte = [];
  const portaIn = new Set();
  const pesi = dati.tabelle.porte;
  const tipoPorta = (albero) => {
    const opz = albero ? pesi.filter((p) => p.tipo !== 'segreta') : pesi;
    let tot = opz.reduce((t, p) => t + p.peso, 0), x = r.f() * tot;
    for (const p of opz) { x -= p.peso; if (x <= 0) return p.tipo; }
    return 'normale';
  };
  const naturale = tema.forma === 'grotta';
  for (const e of archi) {
    const [x1, y1] = centro(stanze[e.a]);
    const [x2, y2] = centro(stanze[e.b]);
    const percorso = [];
    const orizzontalePrima = r.chance(0.5);
    let x = x1, y = y1;
    const passo = (tx, ty) => {
      while (x !== tx) { x += Math.sign(tx - x); percorso.push([x, y]); }
      while (y !== ty) { y += Math.sign(ty - y); percorso.push([x, y]); }
    };
    if (orizzontalePrima) { passo(x2, y1); passo(x2, y2); } else { passo(x1, y2); passo(x2, y2); }
    let prec = zona[idx(x1, y1)];
    let precXY = [x1, y1];
    let porteArco = 0;
    for (const [px, py] of percorso) {
      const i = idx(px, py);
      const eraStanza = prec >= 0;
      if (celle[i] === T.ROCCIA) celle[i] = T.PAV;
      const z = zona[i];
      // transizione stanza -> corridoio o corridoio -> stanza: possibile porta sulla cella di corridoio
      if (!naturale && porteArco < 2) {
        const cellaPorta = eraStanza && z < 0 ? [px, py] : (!eraStanza && z >= 0 ? precXY : null);
        const stanzaToccata = eraStanza && z < 0 ? prec : z;
        if (cellaPorta && stanze[stanzaToccata]?.forma === 'rett') {
          const [dx, dy] = cellaPorta;
          const k = idx(dx, dy);
          if (!portaIn.has(k) && zona[k] < 0) {
            const or = celle[idx(dx - 1, dy)] === T.ROCCIA && celle[idx(dx + 1, dy)] === T.ROCCIA ? 'v' : 'h';
            porte.push({ x: dx, y: dy, tipo: tipoPorta(e.albero), or });
            portaIn.add(k);
            porteArco++;
          }
        }
      }
      prec = z;
      precXY = [px, py];
    }
  }
  // tieni solo le porte che stanno davvero in un varco (due lati di roccia)
  const porteValide = porte.filter((p) => {
    const L = celle[idx(p.x - 1, p.y)], R = celle[idx(p.x + 1, p.y)];
    const U = celle[idx(p.x, p.y - 1)], D = celle[idx(p.x, p.y + 1)];
    if (L === T.ROCCIA && R === T.ROCCIA) { p.or = 'v'; return true; }
    if (U === T.ROCCIA && D === T.ROCCIA) { p.or = 'h'; return true; }
    return false;
  });

  // 4. Ruoli: ingresso, uscita, tana
  const adj = stanze.map(() => []);
  for (const e of archi) { adj[e.a].push(e.b); adj[e.b].push(e.a); }
  const ingresso = stanze.reduce((a, b) => (a.x + a.y * 0.3 <= b.x + b.y * 0.3 ? a : b)).id;
  const dist0 = bfs(adj, ingresso);
  const perDistanza = stanze.map((s) => s.id).sort((a, b) => dist0[b] - dist0[a]);
  const uscita = perDistanza.find((i) => i !== ingresso) ?? ingresso;
  const candidatiTana = stanze.filter((s) => s.id !== ingresso && s.id !== uscita && dist0[s.id] >= 2)
    .sort((a, b) => b.w * b.h - a.w * a.h);
  const tana = sicura ? null : (candidatiTana[0]?.id ?? null);
  for (const s of stanze) {
    s.ruolo = s.id === ingresso ? 'ingresso' : s.id === uscita ? 'uscita' : s.id === tana ? 'tana' : 'normale';
  }

  // 5. Pericoli ambientali e colonne
  const pericolo = PERICOLI[sez.pericolo || tema.pericolo || ''];
  const vicinoPorta = (x, y) => porteValide.some((p) => Math.abs(p.x - x) + Math.abs(p.y - y) <= 2);
  for (const s of stanze) {
    if (pericolo && s.ruolo !== 'ingresso' && r.chance(0.35)) {
      const [cx, cy] = centro(s);
      const bx = cx + r.int(-1, 1), by = cy + r.int(-1, 1);
      const raggio = Math.max(1, Math.floor(Math.min(s.w, s.h) / 3));
      for (let y = by - raggio; y <= by + raggio; y++) {
        for (let x = bx - raggio - 1; x <= bx + raggio + 1; x++) {
          const i = idx(x, y);
          // la riga e la colonna del centro restano libere: ci passano i corridoi
          if (x === cx || y === cy) continue;
          if (zona[i] === s.id && celle[i] === T.PAV && !vicinoPorta(x, y) && r.chance(0.8)) celle[i] = pericolo;
        }
      }
    } else if (s.forma === 'rett' && s.w >= 7 && s.h >= 6 && r.chance(0.4)) {
      for (let y = s.y + 1; y < s.y + s.h - 1; y += 3) {
        for (let x = s.x + 1; x < s.x + s.w - 1; x += 3) {
          const [cx, cy] = centro(s);
          if (!vicinoPorta(x, y) && x !== cx && y !== cy) celle[idx(x, y)] = T.COLONNA;
        }
      }
    }
  }

  // 6. Contenuto delle stanze
  const segni = [];
  const angolo = (s) => {
    for (let y = s.y; y < s.y + s.h; y++) {
      for (let x = s.x; x < s.x + s.w; x++) {
        const i = idx(x, y);
        if (zona[i] === s.id && celle[i] === T.PAV && x > s.x && y > s.y) return [x, y];
      }
    }
    return centro(s);
  };
  const cellaLibera = (s) => {
    for (let t = 0; t < 40; t++) {
      const x = r.int(s.x, s.x + s.w - 1), y = r.int(s.y, s.y + s.h - 1);
      if (zona[idx(x, y)] === s.id && celle[idx(x, y)] === T.PAV) return [x, y];
    }
    return centro(s);
  };
  const descrizioni = r.shuffle(tema.stanze);
  const dettagli = r.shuffle(tema.dettagli);
  const elementi = r.shuffle(tema.elementi);
  const gdm = sez.g;
  const pg = gruppo && gruppo.length ? gruppo : gruppoTipico(dati.tabelle, gdm);
  const pool = risolviPool(sez.mostri, dati.perMostro);
  const trapPool = trappolePerTema(dati.tabelle, sez.tema);
  const ideeTrappole = r.shuffle(sez.trappole || []);
  const oggetti = r.shuffle(sez.oggetti || []);
  const servizi = sicura ? (sez.servizi?.lista || []) : [];
  const dadoSeme = (n) => r.int(1, n);

  stanze.forEach((s, i) => {
    s.descr = `${descrizioni[i % descrizioni.length]} ${dettagli[i % dettagli.length]}`;
    s.elemento = elementi[i % elementi.length];
    s.mostri = [];
    s.trappola = null;
    s.tesoro = [];
    s.note = '';
    if (sicura) {
      const serv = servizi[i];
      if (serv) {
        const info = dati.tabelle.servizi[serv.c];
        s.servizio = serv.c + (serv.g || '');
        s.titolo = info.nome;
        s.descr = `${r.pick(info.stanza)} ${dettagli[i % dettagli.length]}`;
        s.note = info.desc;
      }
      if (s.ruolo === 'ingresso') s.titolo = s.titolo || 'Ingresso';
      return;
    }
    if (s.ruolo === 'ingresso') {
      s.titolo = 'Ingresso';
      return;
    }
    const tiro = r.int(1, 6);
    const riga = dati.tabelle.riempimento.find((q) => tiro >= q.da && tiro <= q.a);
    let tipo = s.ruolo === 'tana' ? 'mostri' : riga.tipo;
    if (s.ruolo === 'uscita' && tipo === 'vuota') tipo = r.chance(0.5) ? 'mostri' : 'speciale';
    s.contenuto = tipo;
    if (tipo === 'mostri' && pool.length) {
      const diff = s.ruolo === 'tana' ? 2 : r.chance(0.5) ? 0 : 1;
      s.mostri = generaIncontro(pool, budget(dati.tabelle, pg, diff), r);
      s.difficolta = diff;
    }
    if (tipo === 'trappola' && trapPool.length) {
      s.trappola = rendiTrappola(r.pick(trapPool), gdm, dati.tabelle);
      if (ideeTrappole.length) s.trappola.idea = ideeTrappole.pop();
      segni.push({ tipo: 'trappola', x: 0, y: 0, stanza: s.id, pos: cellaLibera(s) });
    }
    if (tipo === 'speciale') s.note = `Elemento notevole: ${s.elemento}.`;
    const pTesoro = s.ruolo === 'tana' ? 1 : riga.tesoro;
    if (r.chance(pTesoro)) {
      s.tesoro = tiraTesoro(dati.tabelle, gdm, r, dadoSeme);
      if (s.ruolo === 'tana' && oggetti.length) s.tesoro.push(oggetti.pop());
      segni.push({ tipo: 'tesoro', stanza: s.id, pos: cellaLibera(s) });
    }
    if (s.ruolo === 'tana') s.titolo = 'Tana del boss';
  });
  if (!sicura && oggetti.length) {
    const s = r.pick(stanze.filter((q) => q.ruolo !== 'ingresso'));
    if (s) s.tesoro.push(oggetti.pop());
  }
  // segni fissi: ingresso e uscita in un angolo della stanza (il centro è del numero)
  segni.push({ tipo: 'ingresso', stanza: ingresso, pos: angolo(stanze[ingresso]) });
  if (uscita !== ingresso) segni.push({ tipo: 'uscita', stanza: uscita, pos: angolo(stanze[uscita]) });
  for (const sg of segni) { sg.x = sg.pos[0]; sg.y = sg.pos[1]; delete sg.pos; }

  return {
    v: 1, seme, w: W, h: H, tema: sez.tema,
    celle: codifica(celle), zona: Array.from(zona),
    stanze, porte: porteValide, segni,
    rivelate: [], trovate: [], gruppo: accantoAlCentro(stanze[ingresso], zona, celle),
    aggiornata: Date.now(),
  };
}

// Una cella libera accanto al centro della stanza: il centro ospita il numero.
export function accantoAlCentro(s, zona, celle) {
  const cx = Math.round(s.x + (s.w - 1) / 2), cy = Math.round(s.y + (s.h - 1) / 2);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1], [-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const i = (cy + dy) * W + (cx + dx);
    if (zona[i] === s.id && celle[i] !== T.ROCCIA && celle[i] !== T.COLONNA) return { x: cx + dx, y: cy + dy };
  }
  return { x: cx, y: cy };
}

function bfs(adj, da) {
  const dist = adj.map(() => Infinity);
  dist[da] = 0;
  const coda = [da];
  while (coda.length) {
    const u = coda.shift();
    for (const v of adj[u]) if (dist[v] === Infinity) { dist[v] = dist[u] + 1; coda.push(v); }
  }
  return dist;
}

export function codifica(celle) {
  return Array.from(celle).join('');
}

export function decodifica(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) - 48;
  return out;
}

// Celle visibili ai giocatori: le stanze rivelate più i corridoi raggiungibili da esse,
// fermandosi alle stanze non rivelate e alle porte segrete non trovate.
export function celleVisibili(g) {
  const celle = decodifica(g.celle);
  const vis = new Uint8Array(g.w * g.h);
  const riv = new Set(g.rivelate);
  const trov = new Set(g.trovate);
  const segrete = new Set(g.porte.map((p, i) => (p.tipo === 'segreta' && !trov.has(i) ? p.y * g.w + p.x : -1)));
  const coda = [];
  for (let i = 0; i < celle.length; i++) {
    if (celle[i] !== T.ROCCIA && riv.has(g.zona[i])) { vis[i] = 1; coda.push(i); }
  }
  while (coda.length) {
    const i = coda.pop();
    const x = i % g.w, y = (i / g.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const j = ny * g.w + nx;
      if (vis[j] || celle[j] === T.ROCCIA || segrete.has(j)) continue;
      if (g.zona[j] >= 0 && !riv.has(g.zona[j])) continue;
      vis[j] = 1;
      // non si attraversano stanze intere: i corridoi sì
      coda.push(j);
    }
  }
  return vis;
}

// Tutte le stanze sono raggiungibili dall'ingresso (le porte segrete contano come passabili).
export function raggiungibili(g) {
  const celle = decodifica(g.celle);
  const start = g.stanze.find((s) => s.ruolo === 'ingresso') || g.stanze[0];
  const partenza = g.zona.findIndex((z) => z === start.id);
  const vis = new Uint8Array(g.w * g.h);
  const coda = [partenza];
  vis[partenza] = 1;
  while (coda.length) {
    const i = coda.pop();
    const x = i % g.w, y = (i / g.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = (y + dy) * g.w + (x + dx);
      if (x + dx < 0 || y + dy < 0 || x + dx >= g.w || y + dy >= g.h) continue;
      if (vis[j] || celle[j] === T.ROCCIA) continue;
      vis[j] = 1;
      coda.push(j);
    }
  }
  const trovate = new Set();
  for (let i = 0; i < vis.length; i++) if (vis[i] && g.zona[i] >= 0) trovate.add(g.zona[i]);
  return g.stanze.every((s) => trovate.has(s.id));
}

export { tiraFormula };
