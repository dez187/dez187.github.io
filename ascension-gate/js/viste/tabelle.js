// Vista "Tabelle": riferimento rapido al tavolo, con tiri per trappole, tesori e porte.
import { S, spedizioneAttiva } from '../store.js';
import { h, svuota, bottone, pillGdm, gettoniDadi } from '../ui.js';
import { d, rendiTrappola, tiraTesoro, rngSeme } from '../logica.js';

export function monta(el) {
  let g = spedizioneAttiva()?.gdm || 1;
  const t = S.dati.tabelle;
  const esitoTrappola = h('div');
  const esitoTesoro = h('div');
  const corpoTrappole = h('tbody');
  const scelta = h('div', { class: 'segmenti' });

  const disegna = () => {
    svuota(scelta, [1, 2, 3, 4, 5].map((x) => h('button', { type: 'button', class: x === g ? 'attivo' : '', onclick: () => { g = x; disegna(); } }, String(x))));
    svuota(corpoTrappole, t.trappole.map((tr) => {
      const r = rendiTrappola(tr, g, t);
      return h('tr', null, h('td', null, h('b', null, r.nome), h('div', { style: { fontSize: '12px', color: 'var(--testo-3)' } }, r.innesco)), h('td', null, r.effetto), h('td', null, r.scopri));
    }));
  };

  const tabella = (intest, righe) => h('div', { class: 'contenitore-tabella' }, h('table', { class: 'tabella' },
    h('thead', null, h('tr', null, intest.map((x) => h('th', null, x)))), h('tbody', null, righe)));

  svuota(el,
    h('div', { class: 'testa-vista' },
      h('div', null, h('p', { class: 'occhiello' }, 'Riferimento'), h('h1', null, 'Tabelle del master'),
        h('p', { class: 'sotto' }, 'CD e danni si adattano al Grado di Minaccia scelto, secondo le fasce della Guida del DM.')),
      h('div', { class: 'riga' }, h('span', null, 'Grado'), scelta)),
    h('div', { class: 'griglia-2' },
      h('section', { class: 'pannello' },
        h('header', null, h('h2', null, 'Tesoro'), bottone('Tira', () => {
          const righe = tiraTesoro(t, g, rngSeme(Date.now()));
          svuota(esitoTesoro, h('div', { class: 'risultato' }, h('div', { class: 'risultato-corpo' }, h('div', { class: 'riga' }, pillGdm(g), h('b', null, 'Tesoro')), h('ul', { class: 'lista-puntata' }, righe.map((r) => h('li', null, r))))));
        }, { cls: 'piccolo ambra', ico: 'dado' })),
        esitoTesoro,
        tabella(['GdM', 'Monete', 'Gemme e arte', 'Oggetto magico'], [1, 2, 3, 4, 5].map((x) => h('tr', null,
          h('td', null, pillGdm(x)), h('td', null, t.tesori.monete[x - 1]),
          h('td', null, `${Math.round(t.tesori.prob_gemme[x - 1] * 100)}%`), h('td', null, `${Math.round(t.tesori.prob_magico[x - 1] * 100)}%`))))),
      h('section', { class: 'pannello' },
        h('header', null, h('h2', null, 'Trappola a caso'), bottone('Tira', () => {
          const k = d(t.trappole.length);
          const r = rendiTrappola(t.trappole[k - 1], g, t);
          svuota(esitoTrappola, h('div', { class: 'risultato' }, h('div', { class: 'risultato-testa' }, h('b', null, r.nome), gettoniDadi([{ dado: t.trappole.length, risultato: k }])),
            h('div', { class: 'risultato-corpo' }, h('p', null, h('i', null, 'Innesco: '), r.innesco), h('p', null, r.effetto), h('p', { style: { color: 'var(--testo-2)' } }, r.scopri))));
        }, { cls: 'piccolo', ico: 'dado' })),
        esitoTrappola,
        h('div', { class: 'etichetta-mini', style: { marginTop: '12px' } }, 'Porte'),
        tabella(['Porta', 'Probabilità', 'Come si apre'], t.porte.map((p) => h('tr', null, h('td', null, p.tipo), h('td', null, `${p.peso}%`),
          h('td', null, p.nota.replaceAll('{cd}', t.scala.cd[g - 1]).replaceAll('{cd2}', t.scala.cd[g - 1] + 2))))))),
    h('section', { class: 'pannello' }, h('h2', null, 'Trappole e trabocchetti'),
      h('div', { class: 'contenitore-tabella' }, h('table', { class: 'tabella' },
        h('thead', null, h('tr', null, h('th', null, 'Trappola'), h('th', null, 'Effetto'), h('th', null, 'Scoprirla e disinnescarla'))), corpoTrappole))),
    h('div', { class: 'griglia-2', style: { marginTop: '16px' } },
      h('section', { class: 'pannello' }, h('h2', null, 'Pressione'),
        tabella(['', 'Livello', 'Effetto'], t.pressione.map((p) => h('tr', null, h('td', null, h('b', { style: { fontFamily: 'var(--f-mono)' } }, String(p.livello))), h('td', null, p.nome), h('td', null, p.effetto)))),
        h('div', { class: 'etichetta-mini', style: { marginTop: '12px' } }, 'Cosa la muove'),
        tabella(['Evento', 'Pressione'], t.pressione_eventi.map((e) => h('tr', null, h('td', null, e.nome), h('td', null, e.delta > 0 ? `+${e.delta}` : String(e.delta)))))),
      h('section', { class: 'pannello' }, h('h2', null, 'Aree sicure: servizi'),
        tabella(['', 'Servizio', 'Cosa offre'], Object.entries(t.servizi).map(([k, s]) => h('tr', null, h('td', null, h('b', null, k)), h('td', null, s.nome), h('td', null, s.desc)))))),
    h('section', { class: 'pannello', style: { marginTop: '16px' } }, h('h2', null, 'Materiali e ingredienti dai mostri'),
      tabella(['Famiglia', 'Materiali', 'Ingredienti'], Object.values(t.materiali).map((m) => h('tr', null, h('td', null, m.fam), h('td', null, m.mat), h('td', null, m.ing)))),
      h('p', { style: { fontSize: '13px', color: 'var(--testo-3)', marginTop: '10px' } }, 'Unità per taglia: Piccola o Media 1, Grande 2, Enorme 3, Mastodontica 4; un boss almeno 4. Dal Grado 3 in su, un Nucleo con 5-6 su d6 (sempre dal boss).')),
    h('p', { style: { fontSize: '12px', color: 'var(--testo-3)', marginTop: '20px' } }, S.dati.meta.licenza));
  disegna();
  return null;
}
