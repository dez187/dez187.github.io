// Vista "Incontro": costruttore di incontri (budget 2024) e tracker del combattimento.
import { S, salva, elimina, impostazioni, spedizioneAttiva, sezione, nuovoId } from '../store.js';
import { h, svuota, bottone, icona, modale, schedaMostro, gettoniDadi, vai, toast } from '../ui.js';
import {
  d, budget, gruppoTipico, generaIncontro, risolviPool, xpIncontro, valutaIncontro, crTesto, xpMostro, materialiDa,
  DIFFICOLTA, rngSeme,
} from '../logica.js';
import { registra } from '../azioni.js';
import { scegliMostro } from '../scelte.js';

export function gruppoAttuale(gdm) {
  const pg = (impostazioni().gruppo || []).filter((p) => p.nome);
  return pg.length ? { pg, tipico: false } : { pg: gruppoTipico(S.dati.tabelle, gdm || 1), tipico: true };
}

export function mostraScheda(k) {
  const m = S.dati.perMostro.get(k);
  if (!m) return toast('Mostro non trovato nel bestiario.');
  modale(m.it, schedaMostro(m), [{ testo: 'Chiudi' }, { testo: 'Apri nel bestiario', fn: () => vai(`bestiario/${k}`) }]);
}

// ---------------------------------------------------------------- avvio del combattimento
export function avviaCombattimento(gruppi, { sez = null, titolo = '' } = {}) {
  const combattenti = [];
  for (const pg of (impostazioni().gruppo || []).filter((p) => p.nome)) {
    combattenti.push({ id: nuovoId('c'), nome: pg.nome, pg: true, init: null, pf: Number(pg.pf) || null, pfMax: Number(pg.pf) || null, ca: Number(pg.ca) || null, cond: [] });
  }
  const riassunto = [];
  for (const gr of gruppi) {
    const m = S.dati.perMostro.get(gr.k);
    if (!m) continue;
    riassunto.push(`${gr.n}× ${gr.nome || m.it}`);
    for (let i = 1; i <= gr.n; i++) {
      combattenti.push({
        id: nuovoId('c'), nome: `${gr.nome || m.it}${gr.n > 1 ? ` ${i}` : ''}`, k: m.k, pg: false,
        init: d(20) + (m.init || 0), pf: m.pf, pfMax: m.pf, ca: m.ca, cond: [],
      });
    }
  }
  const gdm = sez ? S.dati.perSez.get(sez)?.g : spedizioneAttiva()?.gdm || 1;
  salva('incontri', 'attivo', { titolo, sez, gdm, round: 1, turno: 0, combattenti: ordina(combattenti), creato: Date.now() }, { subito: true });
  registra(`Combattimento${titolo ? ` (${titolo})` : ''}: ${riassunto.join(', ')}`, 'incontro');
  vai('incontro');
}

function ordina(c) {
  return [...c].sort((a, b) => (b.init ?? -99) - (a.init ?? -99) || (a.pg ? -1 : 1));
}

// ---------------------------------------------------------------- mostri erranti
export function apriErrante(c) {
  const sp = spedizioneAttiva();
  const qui = sp?.percorso?.[sp.posizione];
  const s = qui ? sezione(qui.sez) : null;
  const corpo = h('div', { style: { display: 'grid', gap: '14px' } },
    gettoniDadi([{ dado: 20, risultato: c.tiro, cosa: `incontro con 1-${c.soglia}` }]));
  if (!c.incontro) {
    corpo.append(h('p', { class: 'leggi' }, 'Nessun incontro. Per ora il dungeon tace.'));
    return modale('Mostri erranti', corpo, [{ testo: 'Chiudi' }]);
  }
  if (!s || !s.mostri?.length) {
    corpo.append(h('p', null, 'Incontro! Il gruppo non è in una sezione con mostri: scegli tu chi arriva, o imposta la posizione nel percorso.'));
    return modale('Mostri erranti', corpo, [{ testo: 'Chiudi' }, { testo: 'Costruisci l\'incontro', cls: 'primario', fn: () => vai('incontro') }]);
  }
  const { pg } = gruppoAttuale(s.g);
  const pool = risolviPool(s.mostri, S.dati.perMostro);
  let gruppi = generaIncontro(pool, budget(S.dati.tabelle, pg, 1), rngSeme(Date.now()));
  const lista = h('div');
  const disegna = () => svuota(lista, h('div', { class: 'gruppo-mostri' }, gruppi.map((g) => {
    const m = S.dati.perMostro.get(g.k);
    return h('div', null, h('b', null, `${g.n}×`), h('a', { href: '#', onclick: (e) => { e.preventDefault(); mostraScheda(g.k); } }, g.nome || m.it),
      h('span', { class: 'tag' }, `GS ${crTesto(m.cr)}`), h('span', null, ''));
  })));
  disegna();
  corpo.append(h('p', { class: 'tag rosso' }, `Incontro in ${s.nome}`), lista);
  modale('Mostri erranti', corpo, [
    { testo: 'Chiudi' },
    { testo: 'Ritira', fn: () => { gruppi = generaIncontro(pool, budget(S.dati.tabelle, pg, 1), rngSeme(Date.now())); disegna(); return false; } },
    { testo: 'Combatti', cls: 'primario', fn: () => avviaCombattimento(gruppi, { sez: s.id, titolo: `Erranti in ${s.nome}` }) },
  ]);
}

// ---------------------------------------------------------------- costruttore
export function costruttore({ pool = [], gdm = 1, sez = null, titolo = '' }) {
  const { pg, tipico } = gruppoAttuale(gdm);
  const buds = [0, 1, 2].map((i) => budget(S.dati.tabelle, pg, i));
  let diff = 1;
  let gruppi = [];
  const el = h('div', { style: { display: 'grid', gap: '12px' } });
  const poolRisolto = () => risolviPool(pool, S.dati.perMostro);

  const disegna = () => {
    const xp = xpIncontro(gruppi, S.dati.perMostro);
    const val = gruppi.length ? valutaIncontro(xp, S.dati.tabelle, pg) : '—';
    const perc = Math.min(100, (xp / (buds[2] * 1.5)) * 100);
    svuota(el,
      h('div', { class: 'budget' }, DIFFICOLTA.map((nome, i) => h('div', { class: i === diff ? 'qui' : '', style: { cursor: 'pointer' }, onclick: () => { diff = i; disegna(); } },
        h('span', null, `Difficoltà ${nome.toLowerCase()}`), h('b', null, `${buds[i].toLocaleString('it-IT')} PE`)))),
      h('p', { style: { fontSize: '13px', color: 'var(--testo-3)', margin: 0 } },
        tipico ? `Gruppo tipico: ${pg.length} PG di livello ${pg[0].livello} per il GdM ${gdm}. Inserisci i tuoi PG nelle Impostazioni.`
          : `Gruppo: ${pg.map((p) => `${p.nome} (${p.livello})`).join(', ')}`),
      pool.length ? h('div', null,
        h('div', { class: 'etichetta-mini' }, 'Mostri della zona'),
        h('div', { class: 'mostri-zona' }, poolRisolto().map((p) => h('button', { type: 'button', class: 'chip-mostro', title: p.m.desc || '',
          onclick: () => aggiungi(p.m.k, p.nome) }, icona('piu'), p.nome || p.m.it, h('small', null, `GS ${crTesto(p.m.cr)}`))))) : null,
      h('div', { class: 'riga' },
        pool.length ? bottone('Genera dal pool', () => { gruppi = generaIncontro(poolRisolto(), buds[diff], rngSeme(Date.now())); disegna(); }, { cls: 'ambra', ico: 'dado' }) : null,
        bottone('Aggiungi dal bestiario', () => scegliMostro('Aggiungi all\'incontro', (k) => aggiungi(k)), { ico: 'libro' }),
        gruppi.length ? bottone('Svuota', () => { gruppi = []; disegna(); }, { cls: 'fantasma', ico: 'x' }) : null),
      gruppi.length ? h('div', { class: 'gruppo-mostri' }, gruppi.map((g, i) => {
        const m = S.dati.perMostro.get(g.k);
        const n = h('input', { class: 'campo numero', type: 'number', min: '1', max: '30', value: String(g.n), 'aria-label': `Quanti ${m.it}`,
          onchange: (e) => { g.n = Math.max(1, Number(e.target.value) || 1); disegna(); } });
        return h('div', null, n,
          h('div', null, h('a', { href: '#', onclick: (e) => { e.preventDefault(); mostraScheda(g.k); } }, g.nome || m.it),
            h('div', { style: { fontSize: '12px', color: 'var(--testo-3)' } }, `GS ${crTesto(m.cr)} · ${xpMostro(m).toLocaleString('it-IT')} PE ciascuno`)),
          h('b', { style: { fontFamily: 'var(--f-mono)' } }, (xpMostro(m) * g.n).toLocaleString('it-IT')),
          h('button', { class: 'btn-ico', type: 'button', 'aria-label': 'Togli', onclick: () => { gruppi.splice(i, 1); disegna(); } }, icona('x')));
      })) : h('p', { style: { color: 'var(--testo-3)', margin: 0 } }, 'Nessun mostro nell\'incontro.'),
      gruppi.length ? h('div', null,
        h('div', { class: 'riga' }, h('b', null, `${xp.toLocaleString('it-IT')} PE`), h('span', { class: `tag ${val === 'Alta' ? 'ambra' : val === 'Oltre il limite' ? 'rosso' : ''}` }, `Difficoltà: ${val}`)),
        h('div', { class: `barra-xp ${val === 'Alta' ? 'alta' : val === 'Oltre il limite' ? 'oltre' : ''}` }, h('i', { style: { width: `${perc}%` } })),
        bottone('Avvia il combattimento', () => avviaCombattimento(gruppi, { sez, titolo }), { cls: 'primario', ico: 'spade' })) : null);
  };
  const aggiungi = (k, nome = null) => {
    const g = gruppi.find((x) => x.k === k && x.nome === nome);
    if (g) g.n++; else gruppi.push({ k, n: 1, nome });
    disegna();
  };
  disegna();
  return el;
}

// ---------------------------------------------------------------- tracker
export function monta(el) {
  let selezionato = null;
  const lato = h('aside');

  const disegna = () => {
    const inc = S.docs.incontri?.attivo;
    if (!inc) {
      const sp = spedizioneAttiva();
      const qui = sp?.percorso?.[sp.posizione];
      const s = qui ? sezione(qui.sez) : null;
      return svuota(el,
        h('div', { class: 'testa-vista' }, h('div', null, h('p', { class: 'occhiello' }, 'Incontro'), h('h1', null, 'Costruisci un incontro'),
          h('p', { class: 'sotto' }, s ? `Il gruppo è in ${s.nome}: i mostri della zona sono già pronti.` : 'Scegli i mostri dal bestiario: il budget segue le regole 2024.'))),
        h('div', { class: 'colonne-sezione' },
          h('section', { class: 'pannello' }, h('h2', null, 'Incontro'), costruttore({ pool: s?.mostri || [], gdm: s?.g || sp?.gdm || 1, sez: s?.id || null, titolo: s ? s.nome : '' })),
          h('section', { class: 'pannello' }, h('h2', null, 'Come funziona'),
            h('ul', { class: 'lista-puntata', style: { fontSize: '14px', color: 'var(--testo-2)' } },
              h('li', null, 'Il budget di PE è la somma dei budget dei PG per livello e difficoltà (Guida del DM 2024): niente moltiplicatori per il numero di mostri.'),
              h('li', null, 'Il GdM della zona non si adatta al gruppo: se l\'incontro supera il budget Alto, è la zona a essere troppo pericolosa.'),
              h('li', null, 'Avviando il combattimento i mostri tirano l\'iniziativa da soli; quella dei PG la inserisci tu.')))));
    }
    const salvaInc = (fn) => { const x = S.docs.incontri.attivo; fn(x); salva('incontri', 'attivo', x); disegna(); };
    const turnoDi = inc.combattenti[inc.turno];
    const lista = h('div', { class: 'tracker' }, inc.combattenti.map((c, i) => {
      const m = c.k ? S.dati.perMostro.get(c.k) : null;
      const pfPerc = c.pfMax ? Math.max(0, (c.pf / c.pfMax) * 100) : 100;
      const valore = h('input', { class: 'campo', type: 'number', min: '0', placeholder: 'PF', 'aria-label': `Danno o cura per ${c.nome}` });
      const applica = (segno) => {
        const v = Number(valore.value);
        if (!v) return;
        salvaInc((x) => {
          const t = x.combattenti.find((q) => q.id === c.id);
          if (t.pf == null) return;
          t.pf = Math.max(0, Math.min(t.pfMax || 9999, t.pf + segno * v));
        });
      };
      const init = h('input', { class: 'campo iniziativa', type: 'number', value: c.init ?? '', 'aria-label': `Iniziativa di ${c.nome}`,
        onchange: (e) => salvaInc((x) => { x.combattenti.find((q) => q.id === c.id).init = e.target.value === '' ? null : Number(e.target.value); }) });
      const aggCond = h('select', { class: 'campo', style: { width: 'auto', minHeight: '26px', padding: '0 6px', fontSize: '12px' }, 'aria-label': 'Aggiungi condizione',
        onchange: (e) => { const v = e.target.value; if (v) salvaInc((x) => { const t = x.combattenti.find((q) => q.id === c.id); t.cond = [...new Set([...(t.cond || []), v])]; }); } },
      h('option', { value: '' }, '+ condizione'), S.dati.tabelle.condizioni.map((k) => h('option', { value: k }, k)));
      return h('div', { class: `combattente ${c.pg ? 'pg' : ''} ${i === inc.turno ? 'turno' : ''} ${c.pf === 0 && !c.pg ? 'morto' : ''}` },
        init,
        h('div', null,
          h('div', { class: 'nome-c', onclick: () => { selezionato = c.k; mostraLato(); } }, c.nome),
          h('div', { style: { fontSize: '12px', color: 'var(--testo-3)' } }, [c.ca ? `CA ${c.ca}` : null, m ? `GS ${crTesto(m.cr)}` : null].filter(Boolean).join(' · ')),
          h('div', { class: 'condizioni' }, (c.cond || []).map((k) => h('span', { class: 'tag ambra', title: 'Togli', onclick: () => salvaInc((x) => { const t = x.combattenti.find((q) => q.id === c.id); t.cond = t.cond.filter((z) => z !== k); }) }, k, ' ×')), aggCond)),
        h('div', { class: 'pf' },
          c.pfMax ? h('div', { class: `pf-barra ${pfPerc < 25 ? 'basso' : pfPerc < 60 ? 'medio' : ''}` }, h('i', { style: { width: `${pfPerc}%` } })) : null,
          h('div', { class: 'pf-riga' },
            h('b', null, c.pf != null ? `${c.pf}/${c.pfMax}` : '—'),
            valore,
            h('button', { class: 'btn piccolo pericolo', type: 'button', onclick: () => applica(-1) }, 'Danno'),
            h('button', { class: 'btn piccolo', type: 'button', onclick: () => applica(1) }, 'Cura'))),
        h('div', { class: 'azioni-c' },
          h('button', { class: 'btn-ico', type: 'button', 'aria-label': `Togli ${c.nome}`, onclick: () => salvaInc((x) => {
            const k = x.combattenti.findIndex((q) => q.id === c.id);
            x.combattenti.splice(k, 1);
            if (x.turno >= x.combattenti.length) x.turno = 0;
          }) }, icona('x'))));
    }));

    svuota(el,
      h('div', { class: 'testa-vista' },
        h('div', null, h('p', { class: 'occhiello' }, `Round ${inc.round}`), h('h1', null, inc.titolo || 'Combattimento'),
          h('p', { class: 'sotto' }, turnoDi ? `Tocca a: ${turnoDi.nome}` : '')),
        h('div', { class: 'riga' },
          bottone('Turno precedente', () => salvaInc((x) => { x.turno--; if (x.turno < 0) { x.turno = x.combattenti.length - 1; x.round = Math.max(1, x.round - 1); } }), { cls: 'fantasma', ico: 'indietro' }),
          bottone('Turno successivo', () => salvaInc((x) => { x.turno++; if (x.turno >= x.combattenti.length) { x.turno = 0; x.round++; } }), { cls: 'primario', ico: 'freccia' }))),
      h('div', { class: 'colonne-sezione' },
        h('div', null,
          h('div', { class: 'riga', style: { marginBottom: '12px' } },
            bottone('Riordina per iniziativa', () => salvaInc((x) => { const chi = x.combattenti[x.turno]?.id; x.combattenti = ordina(x.combattenti); x.turno = Math.max(0, x.combattenti.findIndex((q) => q.id === chi)); }), { cls: 'piccolo', ico: 'giu' }),
            bottone('Aggiungi mostro', () => scegliMostro('Aggiungi al combattimento', (k) => salvaInc((x) => {
              const m = S.dati.perMostro.get(k);
              x.combattenti.push({ id: nuovoId('c'), nome: m.it, k, pg: false, init: d(20) + (m.init || 0), pf: m.pf, pfMax: m.pf, ca: m.ca, cond: [] });
            })), { cls: 'piccolo', ico: 'piu' }),
            bottone('Aggiungi PG o PNG', () => {
              const nome = h('input', { class: 'campo', placeholder: 'Nome' });
              const pf = h('input', { class: 'campo', type: 'number', placeholder: 'PF' });
              const ca = h('input', { class: 'campo', type: 'number', placeholder: 'CA' });
              const ini = h('input', { class: 'campo', type: 'number', placeholder: 'Iniziativa' });
              modale('Aggiungi al combattimento', h('div', { class: 'griglia-2' }, nome, ini, pf, ca), [{ testo: 'Annulla' }, { testo: 'Aggiungi', cls: 'primario', fn: () => {
                if (!nome.value.trim()) return false;
                salvaInc((x) => x.combattenti.push({ id: nuovoId('c'), nome: nome.value.trim(), pg: true, init: ini.value === '' ? null : Number(ini.value), pf: Number(pf.value) || null, pfMax: Number(pf.value) || null, ca: Number(ca.value) || null, cond: [] }));
              } }]);
            }, { cls: 'piccolo', ico: 'gruppo' }),
            h('span', { class: 'spazio' }),
            bottone('Termina', termina, { cls: 'piccolo ambra', ico: 'scudo' })),
          lista),
        lato));
    mostraLato();
  };

  const mostraLato = () => {
    const inc = S.docs.incontri?.attivo;
    const k = selezionato || inc?.combattenti.find((c) => c.k)?.k;
    const m = k ? S.dati.perMostro.get(k) : null;
    svuota(lato, m ? schedaMostro(m, { compatta: true }) : h('div', { class: 'pannello' }, 'Tocca il nome di un mostro per vederne la scheda.'));
  };

  const termina = () => {
    const inc = S.docs.incontri.attivo;
    const sconfitti = inc.combattenti.filter((c) => !c.pg && c.pf === 0 && c.k);
    const pgN = inc.combattenti.filter((c) => c.pg).length || gruppoAttuale(inc.gdm).pg.length;
    const xp = sconfitti.reduce((t, c) => t + xpMostro(S.dati.perMostro.get(c.k)), 0);
    const perTipo = new Map();
    for (const c of sconfitti) {
      const m = S.dati.perMostro.get(c.k);
      const mat = materialiDa(m, inc.gdm, S.dati.tabelle);
      const k = m.k;
      const x = perTipo.get(k) || { m, mat, n: 0 };
      x.n++;
      perTipo.set(k, x);
    }
    const cd = 8 + inc.gdm;
    const nuclei = h('div');
    const corpo = h('div', { style: { display: 'grid', gap: '14px' } },
      h('div', { class: 'budget' },
        h('div', null, h('span', null, 'Nemici sconfitti'), h('b', null, String(sconfitti.length))),
        h('div', null, h('span', null, 'PE totali'), h('b', null, xp.toLocaleString('it-IT'))),
        h('div', null, h('span', null, `PE a testa (${pgN})`), h('b', null, Math.floor(xp / Math.max(1, pgN)).toLocaleString('it-IT')))),
      perTipo.size ? h('div', null,
        h('div', { class: 'etichetta-mini' }, `Raccolta: 10 minuti per creatura, prova CD ${cd} (Sopravvivenza, Natura o Medicina)`),
        h('div', { class: 'contenitore-tabella' }, h('table', { class: 'tabella' },
          h('thead', null, h('tr', null, ['Mostro', 'Famiglia', 'Materiali', 'Ingredienti', 'Unità'].map((t) => h('th', null, t)))),
          h('tbody', null, [...perTipo.values()].map(({ m, mat, n }) => h('tr', null,
            h('td', null, `${n}× ${m.it}`), h('td', null, mat.famiglia), h('td', null, mat.materiali), h('td', null, mat.ingredienti),
            h('td', null, /non commestibile|tabù|proibito/.test(mat.ingredienti)
              ? `${n * mat.unita} materiali (Grado ${inc.gdm})`
              : `${n * mat.unita} materiali + ${n * mat.unita} ingredienti (Grado ${inc.gdm})`))))))) : h('p', null, 'Nessun nemico a 0 PF: niente da raccogliere.'),
      inc.gdm >= 3 && sconfitti.length ? h('div', null,
        bottone('Tira i Nuclei (5-6 su d6 per creatura)', () => {
          const tiri = sconfitti.map((c) => ({ dado: 6, risultato: d(6), cosa: c.nome }));
          const n = tiri.filter((t) => t.risultato >= 5).length;
          svuota(nuclei, gettoniDadi(tiri), h('p', { class: 'tag ambra', style: { marginTop: '8px' } }, `${n} Nucle${n === 1 ? 'o' : 'i'} di Grado ${inc.gdm}`));
        }, { cls: 'ambra', ico: 'dado' }), nuclei) : null);
    modale('Fine del combattimento', corpo, [
      { testo: 'Continua a combattere' },
      { testo: 'Chiudi l\'incontro', cls: 'primario', fn: () => {
        registra(`Fine combattimento${inc.titolo ? ` (${inc.titolo})` : ''}: ${sconfitti.length} sconfitti, ${xp} PE`, 'incontro');
        elimina('incontri', 'attivo');
        setTimeout(disegna, 50);
      } },
    ]);
  };

  disegna();
  return null;
}
