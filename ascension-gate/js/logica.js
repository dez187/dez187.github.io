// Logica pura (niente DOM): dadi, tiri di sezione e mappa, incontri, tesori, trappole.
// Usata dall'interfaccia e dai test in tests/.

// ---------------------------------------------------------------- dadi
// Tiri veri: generatore crittografico, senza distorsioni (campionamento con rifiuto).
export function d(n) {
  if (n < 1) throw new Error('dado non valido');
  const lim = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  let x;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= lim);
  return (x % n) + 1;
}

// Generatore deterministico per le mappe (stesso seme = stessa mappa).
export function rngSeme(seme) {
  let a = typeof seme === 'number' ? seme >>> 0 : hash(String(seme));
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    f: next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    shuffle: (arr) => {
      const a2 = arr.slice();
      for (let i = a2.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a2[i], a2[j]] = [a2[j], a2[i]];
      }
      return a2;
    },
  };
  return r;
}

export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// "2d6 × 10", "4d10+3", "1d20" -> { totale, tiri, formula }
export function tiraFormula(formula, dado = d) {
  const f = formula.replace(/\s/g, '').replace(/\./g, '').replace('×', '*').replace(/x/gi, '*');
  const m = f.match(/^(\d*)d(\d+)([+-]\d+)?(?:\*(\d+))?$/i);
  if (!m) throw new Error(`formula non valida: ${formula}`);
  const n = Number(m[1] || 1), facce = Number(m[2]), mod = Number(m[3] || 0), molt = Number(m[4] || 1);
  const tiri = Array.from({ length: n }, () => dado(facce));
  const totale = (tiri.reduce((a, b) => a + b, 0) + mod) * molt;
  return { totale, tiri, formula };
}

// ---------------------------------------------------------------- tiri di sezione e mappa
// Stessa logica di tira_sezione.py: prima il dungeon (a pari probabilità), poi la sezione.
export function tiraSezione(sezioni, gdm, { dungeon = null, pool = false, noSicure = false } = {}, dado = d) {
  let tier = sezioni.filter((s) => s.g === gdm);
  if (noSicure) tier = tier.filter((s) => s.d !== 'sa');
  if (dungeon) tier = tier.filter((s) => s.d === dungeon);
  if (!tier.length) return null;
  const tiri = [];
  if (pool || dungeon) {
    const k = dado(tier.length);
    tiri.push({ dado: tier.length, risultato: k, cosa: 'sezione' });
    return { sezione: tier[k - 1], tiri };
  }
  const chiavi = [];
  for (const s of tier) if (!chiavi.includes(s.d)) chiavi.push(s.d);
  const kd = dado(chiavi.length);
  const dk = chiavi[kd - 1];
  tiri.push({ dado: chiavi.length, risultato: kd, cosa: 'dungeon', valore: dk });
  const sub = tier.filter((s) => s.d === dk);
  const ks = dado(sub.length);
  tiri.push({ dado: sub.length, risultato: ks, cosa: 'sezione' });
  return { sezione: sub[ks - 1], tiri };
}

// Stessa logica di tira_mappa.py: tira il dungeon come tira_sezione, poi la mappa se ce n'è più d'una.
export function tiraMappa(sezioni, mappe, gdm, { dungeon = null } = {}, dado = d) {
  const tiri = [];
  if (gdm == null) {
    gdm = dado(5);
    tiri.push({ dado: 5, risultato: gdm, cosa: 'gdm' });
  }
  let dk = dungeon;
  if (!dk) {
    const chiavi = [];
    for (const s of sezioni) if (s.g === gdm && !chiavi.includes(s.d)) chiavi.push(s.d);
    const k = dado(chiavi.length);
    dk = chiavi[k - 1];
    tiri.push({ dado: chiavi.length, risultato: k, cosa: 'dungeon', valore: dk });
  }
  const candidate = Object.values(mappe).filter(
    (m) => m.tirabile && m.codici.includes(dk) && m.gdm[0] <= gdm && gdm <= m.gdm[1],
  );
  if (!candidate.length) return { gdm, dungeon: dk, mappa: null, tiri };
  let mappa = candidate[0];
  if (candidate.length > 1) {
    const k = dado(candidate.length);
    mappa = candidate[k - 1];
    tiri.push({ dado: candidate.length, risultato: k, cosa: 'mappa' });
  }
  return { gdm, dungeon: dk, mappa, tiri };
}

// ---------------------------------------------------------------- incontri (regole 2024)
export const XP_CR = {
  0: 10, 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900,
  8: 3900, 9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000,
  18: 20000, 19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000, 24: 62000, 30: 155000,
};

export function crTesto(cr) {
  return { 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' }[cr] || String(cr);
}

export const DIFFICOLTA = ['Bassa', 'Moderata', 'Alta'];

// budget = somma dei budget dei PG (tabella xp_budget per livello: [bassa, moderata, alta])
export function budget(tabelle, gruppo, diff) {
  const i = typeof diff === 'number' ? diff : DIFFICOLTA.indexOf(diff);
  return gruppo.reduce((tot, pg) => {
    const liv = Math.min(20, Math.max(1, Number(pg.livello) || 1));
    return tot + tabelle.xp_budget[String(liv)][i];
  }, 0);
}

export function xpMostro(m) {
  return m.xp || XP_CR[m.cr] || 0;
}

// Gruppo "tipico" per un GdM quando non ci sono PG configurati.
export function gruppoTipico(tabelle, gdm, n = 4) {
  const liv = tabelle.scala.livello_tipico[gdm - 1];
  return Array.from({ length: n }, (_, i) => ({ nome: `PG ${i + 1}`, livello: liv }));
}

// Voci del pool di una sezione -> mostri del bestiario (le voci x: usano il sostituto).
export function risolviPool(voci, perMostro) {
  const out = [];
  for (const v of voci || []) {
    const m = perMostro.get(v.k || v.s);
    if (m) out.push({ m, nome: v.x || null });
  }
  return out;
}

// Genera un incontro dal pool che stia nel budget: un gruppo principale e, a volte, un secondo.
export function generaIncontro(pool, bud, r = rngSeme(Date.now())) {
  if (!pool.length || bud <= 0) return [];
  const xp = (p) => xpMostro(p.m);
  let adatti = pool.filter((p) => xp(p) <= bud && xp(p) >= bud / 12);
  if (!adatti.length) adatti = pool.filter((p) => xp(p) <= bud);
  if (!adatti.length) adatti = [pool.reduce((a, b) => (xp(a) <= xp(b) ? a : b))];
  const primo = r.pick(adatti);
  const quota = bud * (0.55 + r.f() * 0.4);
  const n1 = Math.max(1, Math.min(8, Math.floor(quota / xp(primo)) || 1));
  const gruppi = [{ k: primo.m.k, nome: primo.nome, n: n1 }];
  const resto = bud - n1 * xp(primo);
  const altri = pool.filter((p) => p.m.k !== primo.m.k && xp(p) <= resto);
  if (altri.length && r.chance(0.6)) {
    const secondo = r.pick(altri);
    const n2 = Math.max(1, Math.min(6, Math.floor(resto / xp(secondo))));
    gruppi.push({ k: secondo.m.k, nome: secondo.nome, n: n2 });
  }
  return gruppi;
}

export function xpIncontro(gruppi, perMostro) {
  return gruppi.reduce((t, g) => t + (perMostro.get(g.k) ? xpMostro(perMostro.get(g.k)) * g.n : 0), 0);
}

export function valutaIncontro(xp, tabelle, gruppo) {
  const [b, m, a] = [0, 1, 2].map((i) => budget(tabelle, gruppo, i));
  if (xp > a * 1.5) return 'Oltre il limite';
  if (xp > m) return 'Alta';
  if (xp > b) return 'Moderata';
  return 'Bassa';
}

// ---------------------------------------------------------------- trappole e tesori
export function rendiTrappola(t, gdm, tabelle) {
  const s = tabelle.scala;
  const i = gdm - 1;
  const sub = (txt) => txt
    .replaceAll('{cd}', s.cd[i]).replaceAll('{cd2}', s.cd[i] + 2)
    .replaceAll('{attacco}', s.attacco[i]).replaceAll('{lieve}', s.lieve[i]).replaceAll('{grave}', s.grave[i]);
  return { nome: t.nome, innesco: t.innesco, effetto: sub(t.effetto), scopri: sub(t.scopri) };
}

export function trappolePerTema(tabelle, tema) {
  return tabelle.trappole.filter((t) => t.temi.includes('*') || t.temi.includes(tema));
}

export function tiraTesoro(tabelle, gdm, r = rngSeme(Date.now()), dado = d) {
  const t = tabelle.tesori;
  const i = gdm - 1;
  const monete = tiraFormula(t.monete[i].replace(/\s*mo$/, ''), dado);
  const righe = [`${monete.totale.toLocaleString('it-IT')} mo (${t.monete[i]})`];
  if (r.chance(t.prob_gemme[i])) {
    const n = r.int(1, 3);
    for (let k = 0; k < n; k++) righe.push(r.chance(0.6) ? r.pick(t.gemme[i]) : r.pick(t.arte[i]));
  }
  if (r.chance(t.prob_magico[i])) righe.push('Oggetto magico: ' + r.pick(t.magici[i]));
  return righe;
}

export function materialiDa(m, gdm, tabelle) {
  const mat = tabelle.materiali[m.tipo] || tabelle.materiali.monstrosity;
  const q = tabelle.quantita_taglia[m.taglia] || 1;
  return { famiglia: mat.fam, materiali: mat.mat, ingredienti: mat.ing, unita: q, grado: gdm, nucleo: gdm >= 3 };
}

// ---------------------------------------------------------------- pressione
export function sogliaErranti(pressione) {
  return 1 + Math.max(0, Math.min(5, pressione));
}

export function controlloErranti(pressione, dado = d) {
  const tiro = dado(20);
  return { tiro, soglia: sogliaErranti(pressione), incontro: tiro <= sogliaErranti(pressione) };
}
