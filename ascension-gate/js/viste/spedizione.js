// Vista "Percorso": la spedizione in corso, i passi fatti e da fare, risorse, note e registro.
import {
  S, spedizioneAttiva, salvaSpedizione, salvaImpostazioni, impostazioni, nuovoId, sezione, elimina,
} from '../store.js';
import {
  h, svuota, bottone, icona, pillGdm, NOMI_DUNGEON, vai, formatData, chiedi, conferma, aggiornaTestata, toast,
} from '../ui.js';
import { aggiungiAlPercorso, mappaDiSezione } from '../azioni.js';
import { scegliSezione } from '../scelte.js';

const STATI = { 'da-esplorare': 'Da esplorare', 'in-corso': 'In corso', completata: 'Completata', saltata: 'Saltata' };

export function monta(el) {
  const disegna = () => {
    const sp = spedizioneAttiva();
    if (!sp) return svuota(el, h('div', { class: 'vuoto' }, 'Nessuna spedizione.'));
    const salvaEd = (fn) => { const s = spedizioneAttiva(); fn(s); salvaSpedizione(s); aggiornaTestata(); };
    const percorso = sp.percorso || [];

    const catena = h('div', { class: 'catena' }, percorso.length ? percorso.map((p, i) => {
      const s = sezione(p.sez);
      const prima = percorso[i - 1] && sezione(percorso[i - 1].sez);
      const anomala = prima && prima.d !== s.d && s.d !== 'sa' && prima.d !== 'sa';
      return [
        i > 0 ? h('span', { class: `catena-freccia ${anomala ? 'anomala' : ''}`, title: anomala ? 'Porta Anomala: si cambia dungeon' : '' }, icona('freccia')) : null,
        h('button', {
          type: 'button', class: `catena-passo ${i === sp.posizione ? 'qui' : ''} ${p.stato === 'completata' ? 'fatto' : ''}`,
          onclick: () => vai(`sezione/${p.sez}`), title: s.nome,
        }, h('span', { class: 'n' }, String(i + 1)), pillGdm(s.g, String(s.g)), h('span', { class: 't' }, s.nome.replace(/^Livello /, 'L'))),
      ];
    }) : h('p', { style: { color: 'var(--testo-3)' } }, 'Il percorso è vuoto: tira una sezione o aggiungila a mano.'));

    const passi = h('div', { class: 'passi' }, percorso.map((p, i) => {
      const s = sezione(p.sez);
      const sposta = (delta) => salvaEd((x) => {
        const j = i + delta;
        if (j < 0 || j >= x.percorso.length) return;
        [x.percorso[i], x.percorso[j]] = [x.percorso[j], x.percorso[i]];
        if (x.posizione === i) x.posizione = j; else if (x.posizione === j) x.posizione = i;
      });
      const stato = h('select', { class: 'campo', style: { width: 'auto', minHeight: '30px', padding: '2px 8px', fontSize: '13px' },
        onchange: (e) => salvaEd((x) => { x.percorso[i].stato = e.target.value; }) },
      Object.entries(STATI).map(([k, v]) => h('option', { value: k }, v)));
      stato.value = p.stato || 'da-esplorare';
      return h('div', { class: `passo ${i === sp.posizione ? 'qui' : ''}` },
        h('span', { class: 'passo-n' }, String(i + 1)),
        h('div', { class: 'passo-info' },
          h('b', null, h('a', { href: `#/sezione/${p.sez}`, style: { color: 'inherit', textDecoration: 'none' } }, s.nome)),
          h('div', { class: 'riga' }, pillGdm(s.g), h('span', { class: s.d === 'sa' ? 'tag verde' : 'tag' }, NOMI_DUNGEON[s.d]), stato,
            i === sp.posizione ? h('span', { class: 'tag ambra' }, icona('bersaglio'), 'Il gruppo è qui') : null)),
        h('div', { class: 'passo-azioni' },
          h('button', { class: 'btn-ico', type: 'button', title: 'Il gruppo è qui', 'aria-label': 'Il gruppo è qui', onclick: () => salvaEd((x) => { x.posizione = i; if (x.percorso[i].stato === 'da-esplorare') x.percorso[i].stato = 'in-corso'; }) }, icona('bersaglio')),
          h('button', { class: 'btn-ico', type: 'button', title: 'Vedi sulla mappa', 'aria-label': 'Vedi sulla mappa', onclick: () => vai(`mappa/${p.mappa || mappaDiSezione(p.sez) || ''}`) }, icona('mappa')),
          h('button', { class: 'btn-ico', type: 'button', title: 'Sposta su', 'aria-label': 'Sposta su', onclick: () => sposta(-1) }, icona('su')),
          h('button', { class: 'btn-ico', type: 'button', title: 'Sposta giù', 'aria-label': 'Sposta giù', onclick: () => sposta(1) }, icona('giu')),
          h('button', { class: 'btn-ico', type: 'button', title: 'Togli dal percorso', 'aria-label': 'Togli dal percorso', onclick: () => salvaEd((x) => {
            x.percorso.splice(i, 1);
            if (x.posizione >= x.percorso.length) x.posizione = x.percorso.length - 1;
            else if (x.posizione > i) x.posizione--;
          }) }, icona('x'))));
    }));

    const contatore = (chiave, nome) => h('div', { class: 'contatore' },
      h('span', null, nome),
      h('div', null,
        h('button', { class: 'btn-ico', type: 'button', 'aria-label': `Meno ${nome}`, onclick: () => salvaEd((x) => { x.risorse = x.risorse || {}; x.risorse[chiave] = Math.max(0, (x.risorse[chiave] || 0) - 1); }) }, icona('meno')),
        h('b', null, String(sp.risorse?.[chiave] ?? 0)),
        h('button', { class: 'btn-ico', type: 'button', 'aria-label': `Più ${nome}`, onclick: () => salvaEd((x) => { x.risorse = x.risorse || {}; x.risorse[chiave] = (x.risorse[chiave] || 0) + 1; }) }, icona('piu'))));

    const note = h('textarea', { class: 'campo', placeholder: 'Conoscenza raccolta, piste, promesse fatte ai PNG…', rows: 6 }, sp.note || '');
    note.addEventListener('input', () => { const s = spedizioneAttiva(); s.note = note.value; salvaSpedizione(s); });

    const altre = Object.entries(S.docs.spedizioni || {});
    const scelta = h('select', { class: 'campo', style: { width: 'auto' }, 'aria-label': 'Spedizione attiva',
      onchange: (e) => { salvaImpostazioni({ spedizioneAttiva: e.target.value }); aggiornaTestata(); } },
    altre.map(([id, x]) => h('option', { value: id }, x.nome)));
    scelta.value = sp.id;

    svuota(el,
      h('div', { class: 'testa-vista' },
        h('div', null, h('p', { class: 'occhiello' }, 'Spedizione'),
          h('h1', null, sp.nome, ' ', h('button', { class: 'btn-ico', type: 'button', 'aria-label': 'Rinomina', title: 'Rinomina',
            onclick: () => chiedi('Rinomina la spedizione', 'Nome', sp.nome, (v) => v && salvaEd((x) => { x.nome = v; })) }, icona('matita'))),
          h('p', { class: 'sotto' }, `Iniziata il ${formatData(sp.creata)} · ${percorso.length} sezioni nel percorso`)),
        h('div', { class: 'riga' }, scelta,
          bottone('Nuova spedizione', () => chiedi('Nuova spedizione', 'Nome', `Spedizione ${altre.length + 1}`, (v) => {
            if (!v) return;
            const id = nuovoId('sp');
            salvaSpedizione({ id, nome: v, creata: Date.now(), gdm: sp.gdm || 1, percorso: [], posizione: -1, pressione: 0, turni: 0, risorse: { torce: 6, razioni: 8, acqua: 8 }, registro: [], note: '' });
            salvaImpostazioni({ spedizioneAttiva: id });
            aggiornaTestata();
          }), { ico: 'piu' }),
          altre.length > 1 ? bottone('Elimina', () => conferma(`Eliminare "${sp.nome}" con tutto il suo registro?`, () => {
            elimina('spedizioni', sp.id);
            const resto = Object.keys(S.docs.spedizioni || {});
            salvaImpostazioni({ spedizioneAttiva: resto[0] || null });
            aggiornaTestata();
          }, 'Elimina'), { cls: 'fantasma', ico: 'cestino' }) : null)),
      h('div', { class: 'colonne-sezione' },
        h('div', null,
          h('section', { class: 'pannello' },
            h('header', null, h('h2', null, 'Percorso'),
              h('div', { class: 'riga' },
                bottone('Aggiungi sezione', () => scegliSezione('Aggiungi al percorso', (id) => aggiungiAlPercorso(id), { gdm: sp.gdm }), { cls: 'piccolo', ico: 'piu' }),
                bottone('Tira', () => vai('tiro'), { cls: 'piccolo', ico: 'dado' }))),
            catena),
          h('section', { class: 'pannello' }, h('h2', null, 'Passi'), percorso.length ? passi : h('p', { style: { color: 'var(--testo-3)' } }, 'Nessun passo ancora.'))),
        h('div', null,
          h('section', { class: 'pannello' }, h('h2', null, 'Risorse'),
            h('div', { class: 'risorse' }, contatore('torce', 'Torce'), contatore('razioni', 'Razioni'), contatore('acqua', 'Acqua')),
            h('p', { style: { color: 'var(--testo-3)', fontSize: '13px', marginTop: '10px' } }, 'Una torcia dura un\'ora (6 turni). Cucinare fuori da un\'area sicura alza la Pressione di 1.')),
          h('section', { class: 'pannello' }, h('h2', null, 'Grado della spedizione'),
            h('div', { class: 'segmenti' }, [1, 2, 3, 4, 5].map((g) => h('button', { type: 'button', class: g === sp.gdm ? 'attivo' : '', onclick: () => salvaEd((x) => { x.gdm = g; }) }, String(g)))),
            h('p', { style: { color: 'var(--testo-2)', fontSize: '13px', marginTop: '8px' } }, S.dati.meta.scala_gdm[sp.gdm || 1])),
          h('section', { class: 'pannello' }, h('h2', null, 'Conoscenza e note'), note),
          h('section', { class: 'pannello' }, h('header', null, h('h2', null, 'Registro'),
            bottone('Nota', () => chiedi('Aggiungi al registro', 'Cosa è successo?', '', (v) => v && salvaEd((x) => { x.registro = [...(x.registro || []), { t: Date.now(), tipo: 'nota', testo: v }]; })), { cls: 'piccolo', ico: 'matita' })),
          h('div', { class: 'registro' }, [...(sp.registro || [])].reverse().slice(0, 80).map((r) => h('div', null, h('time', null, formatData(r.t)), h('span', null, r.testo))))))));
  };
  disegna();
  const f = () => disegna();
  document.addEventListener('ag-spedizione', f);
  return () => document.removeEventListener('ag-spedizione', f);
}
