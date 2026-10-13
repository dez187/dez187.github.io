// Vista "Tiro": il Grado di Minaccia, poi la mappa e la sezione, come tira_mappa.py e tira_sezione.py.
import { S, salva, spedizioneAttiva, salvaSpedizione, sezione } from '../store.js';
import {
  h, svuota, bottone, pillGdm, gettoniDadi, NOMI_DUNGEON, vai, formatData, icona, aggiornaTestata,
} from '../ui.js';
import { tiraSezione, tiraMappa, d } from '../logica.js';
import { aggiungiAlPercorso, registra } from '../azioni.js';

const stato = { gdm: null, modo: 'misto', noSicure: false };

export function monta(el) {
  const sp = spedizioneAttiva();
  if (stato.gdm == null) stato.gdm = sp?.gdm || 1;
  const risultati = h('div', { class: 'risultati' });
  const controlli = h('div', { class: 'tiro-controlli' });
  const storicoEl = h('div', { class: 'storico' });

  const disegnaControlli = () => {
    const dungeonQui = [];
    for (const s of S.dati.sezioni) if (s.g === stato.gdm && !dungeonQui.includes(s.d)) dungeonQui.push(s.d);
    if (!['misto', 'pool'].includes(stato.modo) && !dungeonQui.includes(stato.modo)) stato.modo = 'misto';
    const conta = (dk) => S.dati.sezioni.filter((s) => s.g === stato.gdm && s.d === dk).length;
    const sel = h('select', { class: 'campo', onchange: (e) => { stato.modo = e.target.value; } },
      h('option', { value: 'misto' }, `Misto: prima il dungeon (d${dungeonQui.length}), poi la sezione`),
      h('option', { value: 'pool' }, `Pool: tutte le ${S.dati.sezioni.filter((s) => s.g === stato.gdm).length} sezioni alla pari`),
      dungeonQui.map((dk) => h('option', { value: dk }, `Solo ${NOMI_DUNGEON[dk]} (${conta(dk)})`)));
    sel.value = stato.modo;
    svuota(controlli,
      h('div', { class: 'riga-ctrl' }, h('span', null, 'Grado di Minaccia'),
        h('div', { class: 'riga' },
          h('div', { class: 'segmenti', role: 'group', 'aria-label': 'Grado di Minaccia' },
            [1, 2, 3, 4, 5].map((g) => h('button', {
              type: 'button', class: g === stato.gdm ? 'attivo' : '', 'aria-pressed': String(g === stato.gdm),
              onclick: () => { stato.gdm = g; salvaGdm(); disegnaControlli(); },
            }, String(g)))),
          bottone('Tira il Grado (d5)', () => {
            const g = d(5);
            stato.gdm = g;
            salvaGdm();
            disegnaControlli();
            risultati.prepend(h('div', { class: 'risultato' },
              h('div', { class: 'risultato-testa' }, h('b', null, 'Grado di Minaccia'), gettoniDadi([{ dado: 5, risultato: g, cosa: 'grado' }])),
              h('div', { class: 'risultato-corpo' }, h('div', { class: 'riga' }, pillGdm(g), S.dati.meta.scala_gdm[g]))));
          }, { cls: 'piccolo', ico: 'dado' }),
          h('span', { class: 'sotto', style: { color: 'var(--testo-2)' } }, S.dati.meta.scala_gdm[stato.gdm]))),
      h('div', { class: 'riga-ctrl' }, h('span', null, 'Dungeon'), sel),
      h('div', { class: 'riga-ctrl' }, h('span', null, 'Aree sicure'),
        h('label', { class: 'riga' },
          h('input', { type: 'checkbox', checked: stato.noSicure, onchange: (e) => { stato.noSicure = e.target.checked; } }),
          'Escludi le aree sicure dal tiro della sezione')),
      h('div', { class: 'tiro-bottoni' },
        bottone('Tira la mappa', () => tira('mappa'), { cls: '', ico: 'mappa' }),
        bottone('Tira la sezione', () => tira('sezione'), { cls: '', ico: 'stanza' }),
        bottone('Tira mappa e sezione', () => tira('entrambe'), { cls: 'primario', ico: 'dado' })));
  };

  const salvaGdm = () => {
    const s = spedizioneAttiva();
    if (s && s.gdm !== stato.gdm) { s.gdm = stato.gdm; salvaSpedizione(s); }
  };

  const tira = (cosa) => {
    const dungeon = ['misto', 'pool'].includes(stato.modo) ? null : stato.modo;
    let mappaRis = null;
    // mappa e sezione dello stesso tiro stanno insieme, la mappa sopra
    const gruppo = h('div', { class: 'gruppo-tiro' });
    risultati.prepend(gruppo);
    if (cosa !== 'sezione') {
      mappaRis = tiraMappa(S.dati.sezioni, S.dati.mappe, stato.gdm, { dungeon });
      gruppo.append(cartaMappa(mappaRis));
      ricorda({ tipo: 'mappa', gdm: stato.gdm, id: mappaRis.mappa?.id, tiri: mappaRis.tiri });
    }
    if (cosa !== 'mappa') {
      // con "entrambe" la sezione si tira tra quelle della mappa uscita (stesso dungeon e stesso GdM);
      // se la mappa non ne ha, tra tutte quelle del dungeon
      const dk = cosa === 'entrambe' ? mappaRis.dungeon : dungeon;
      let r = null;
      if (cosa === 'entrambe' && mappaRis.mappa) {
        const nodi = mappaRis.mappa.nodi.map((n) => n.sez && S.dati.perSez.get(n.sez))
          .filter((s, i, a) => s && s.g === stato.gdm && s.d === dk && a.indexOf(s) === i);
        if (nodi.length) {
          const k = d(nodi.length);
          r = { sezione: nodi[k - 1], tiri: [{ dado: nodi.length, risultato: k, cosa: 'sezione della mappa' }] };
        }
      }
      r = r || tiraSezione(S.dati.sezioni, stato.gdm, { dungeon: dk, pool: stato.modo === 'pool', noSicure: stato.noSicure && dk !== 'sa' });
      if (!r) return;
      gruppo.append(cartaSezione(r, mappaRis?.mappa?.id));
      ricorda({ tipo: 'sezione', gdm: stato.gdm, id: r.sezione.id, tiri: r.tiri });
    }
    disegnaStorico();
  };

  const cartaSezione = (r, mappaId) => {
    const s = sezione(r.sezione.id);
    const tiri = r.tiri.map((t) => ({ ...t, cosa: t.cosa === 'dungeon' ? NOMI_DUNGEON[t.valore] : t.cosa }));
    return h('article', { class: 'risultato' },
      h('div', { class: 'risultato-testa' },
        h('div', { class: 'riga' }, pillGdm(s.g), h('span', { class: s.d === 'sa' ? 'tag verde' : 'tag' }, NOMI_DUNGEON[s.d])),
        gettoniDadi(tiri)),
      h('div', { class: 'risultato-corpo' },
        h('div', null, h('h3', null, s.nome), h('div', { class: 'fonte' }, s.d === 'sa' ? `Dotazioni: ${s.fonte}` : `Fonte: ${s.fonte}`)),
        s.descr ? h('div', { class: 'leggi' }, s.descr) : null,
        s.servizi ? h('div', { class: 'riga' }, s.servizi.lista.map((x) => h('span', { class: 'tag verde' }, `${S.dati.tabelle.servizi[x.c].nome}${x.g ? ` ${x.g}` : ''}`))) : null,
        s.tratto ? h('div', { class: 'nota-master' }, h('b', null, 'Tratto fisso. '), s.tratto) : null,
        h('div', { class: 'riga' },
          bottone('Apri la sezione', () => vai(`sezione/${s.id}`), { cls: 'primario', ico: 'freccia' }),
          bottone('Aggiungi al percorso', () => aggiungiAlPercorso(s.id, { mappa: mappaId }), { ico: 'piu' }),
          bottone('Il gruppo entra qui', () => { aggiungiAlPercorso(s.id, { mappa: mappaId, qui: true }); vai(`sezione/${s.id}`); }, { ico: 'bersaglio' }))));
  };

  const cartaMappa = (r) => {
    const m = r.mappa;
    const tiri = r.tiri.map((t) => ({ ...t, cosa: t.cosa === 'dungeon' ? NOMI_DUNGEON[t.valore] : t.cosa }));
    if (!m) return h('div', { class: 'risultato' }, h('div', { class: 'risultato-corpo' }, 'Nessuna mappa per questo tiro.'));
    const nSez = m.nodi.filter((n) => n.sez && S.dati.perSez.get(n.sez)?.g === r.gdm).length;
    return h('article', { class: 'risultato' },
      h('div', { class: 'risultato-testa' },
        h('div', { class: 'riga' }, icona('mappa'), h('b', null, 'Mappa'), h('span', { class: 'tag' }, `copre GdM ${m.gdm[0]}–${m.gdm[1]}`)),
        gettoniDadi(tiri)),
      h('div', { class: 'risultato-corpo' },
        h('div', null, h('h3', null, m.titolo),
          h('div', { class: 'fonte' }, `${m.nodi.filter((n) => n.sez).length} sezioni sulla mappa, ${nSez} di GdM ${r.gdm}`)),
        h('div', { class: 'riga' },
          bottone('Apri la mappa', () => vai(`mappa/${m.id}`), { cls: 'primario', ico: 'freccia' }),
          bottone(`Tira una sezione di GdM ${r.gdm} su questa mappa`, () => vai(`mappa/${m.id}/tira/${r.gdm}`), { ico: 'dado' }))));
  };

  const ricorda = (voce) => {
    const st = S.docs.tiri?.storico || { voci: [] };
    salva('tiri', 'storico', { voci: [{ t: Date.now(), ...voce }, ...st.voci].slice(0, 60) });
    const nome = voce.tipo === 'mappa' ? S.dati.mappe[voce.id]?.titolo : S.dati.perSez.get(voce.id)?.nome;
    registra(`Tiro ${voce.tipo} (GdM ${voce.gdm}): ${voce.tiri.map((t) => `d${t.dado}→${t.risultato}`).join(', ')} = ${nome}`, 'tiro');
  };

  const disegnaStorico = () => {
    const voci = S.docs.tiri?.storico?.voci || [];
    svuota(storicoEl, voci.length ? voci.slice(0, 15).map((v) => {
      const nome = v.tipo === 'mappa' ? S.dati.mappe[v.id]?.titolo : S.dati.perSez.get(v.id)?.nome;
      const href = v.tipo === 'mappa' ? `#/mappa/${v.id}` : `#/sezione/${v.id}`;
      return h('div', { class: 'storico-voce' },
        h('time', null, formatData(v.t)),
        h('a', { href }, h('span', { class: 'tag' }, v.tipo), ' ', nome || v.id),
        pillGdm(v.gdm));
    }) : h('p', { style: { color: 'var(--testo-3)' } }, 'Ancora nessun tiro.'));
  };

  svuota(el,
    h('div', { class: 'testa-vista' },
      h('div', null, h('p', { class: 'occhiello' }, 'Generatore'), h('h1', null, 'Tira il Grado'),
        h('p', { class: 'sotto' }, 'Un dado per il dungeon e uno per la sezione: il dungeon esce a pari probabilità, così nessun dungeon sommerge gli altri. La mappa segue lo stesso tiro e, se il Grado sta a cavallo tra due fasce, tira ancora.'))),
    h('div', { class: 'griglia-2' },
      h('div', null, h('section', { class: 'pannello' }, h('h2', null, 'Parametri'), controlli),
        h('section', { class: 'pannello' }, h('h2', null, 'Ultimi tiri'), storicoEl)),
      h('div', null, risultati)));
  disegnaControlli();
  disegnaStorico();
  aggiornaTestata();
}
