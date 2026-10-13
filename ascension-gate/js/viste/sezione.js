// Vista "Sezione": panoramica da leggere, mappa della sezione con stanze e contenuti,
// incontri della zona, testo del manuale e immagini (le mappe dei tuoi libri).
import {
  S, salva, sezione, caricaImmagine, urlImmagine, eliminaImmagine, spedizioneAttiva,
} from '../store.js';
import {
  h, svuota, bottone, icona, pillGdm, NOMI_DUNGEON, vai, modale, conferma, toast, nomeTipo,
} from '../ui.js';
import { aggiungiAlPercorso, gruppoQui, mappaDiSezione, pubblicaGiocatori, schermoNero, registra } from '../azioni.js';
import { generaGriglia, accantoAlCentro, decodifica } from '../generatore.js';
import { creaEditor, STRUMENTI, grigliaPerGiocatori, centriStanze } from './griglia-canvas.js';
import { costruttore, mostraScheda, avviaCombattimento, gruppoAttuale } from './incontro.js';
import { scegliMostro, scegliSezione } from '../scelte.js';
import {
  generaIncontro, risolviPool, budget, rngSeme, crTesto, tiraTesoro, rendiTrappola, trappolePerTema, xpIncontro, d,
} from '../logica.js';

const TAB = { panoramica: 'Panoramica', mappa: 'Mappa della sezione', incontri: 'Incontri', manuale: 'Manuale e immagini' };
const RUOLI = { ingresso: 'Ingresso', uscita: 'Uscita', tana: 'Tana del boss' };

export function monta(el, params) {
  const [id, tabParam] = params;
  if (!id || !S.dati.perSez.get(id)) {
    svuota(el, h('div', { class: 'vuoto' }, h('h2', null, 'Nessuna sezione aperta'),
      h('p', null, 'Tira una sezione, scegline una dal percorso o cercala.'),
      bottone('Cerca una sezione', () => scegliSezione('Apri una sezione', (sid) => vai(`sezione/${sid}`)), { cls: 'primario', ico: 'cerca' })));
    return null;
  }
  try { localStorage.setItem('ag-ultima-sezione', id); } catch { /* niente */ }
  let tab = TAB[tabParam] ? tabParam : 'panoramica';
  let editor = null;
  let stanzaSel = null;
  const tema = () => S.dati.temi[sezione(id).tema] || S.dati.temi.caverna;
  const corpo = h('div');
  const tabs = h('div', { class: 'schede-tab', role: 'tablist' });
  const testa = h('div', { class: 'sezione-testa' });

  const salvaMod = (patch) => salva('sezioni', id, { ...(S.docs.sezioni?.[id] || {}), ...patch });

  const disegnaTesta = () => {
    const s = sezione(id);
    const sp = spedizioneAttiva();
    const qui = sp?.percorso?.[sp.posizione]?.sez === id;
    svuota(testa,
      h('p', { class: 'occhiello' }, s.d === 'sa' ? 'Area sicura' : NOMI_DUNGEON[s.d]),
      h('h1', null, s.nome),
      h('div', { class: 'riga' }, pillGdm(s.g), s.tema ? h('span', { class: 'tag' }, tema().nome) : null,
        h('span', { class: 'tag' }, s.d === 'sa' ? `Dotazioni: ${s.fonte}` : `Fonte: ${s.fonte}`),
        qui ? h('span', { class: 'tag ambra' }, icona('bersaglio'), 'Il gruppo è qui') : null),
      h('div', { class: 'riga' },
        bottone('Il gruppo è qui', () => { gruppoQui(id); disegnaTesta(); }, { cls: qui ? 'attivo' : 'primario', ico: 'bersaglio' }),
        bottone('Aggiungi al percorso', () => { aggiungiAlPercorso(id); disegnaTesta(); }, { ico: 'piu' }),
        bottone('Sulla mappa', () => vai(`mappa/${mappaDiSezione(id, sp?.percorso?.[sp.posizione]?.mappa) || ''}`), { ico: 'mappa' }),
        bottone('Mostra il testo ai giocatori', () => { pubblicaGiocatori({ modo: 'testo', sez: id, titolo: s.nome, testo: s.descr || '' }); toast('Testo inviato alla schermata dei giocatori.'); }, { ico: 'schermo' }),
        bottone('Schermo nero', schermoNero, { cls: 'fantasma', ico: 'occhioNo' })));
  };

  const disegnaTabs = () => svuota(tabs, Object.entries(TAB).map(([k, v]) => h('button', {
    type: 'button', role: 'tab', class: k === tab ? 'attiva' : '', 'aria-selected': String(k === tab),
    onclick: () => { tab = k; history.replaceState(null, '', `#/sezione/${id}/${k}`); disegnaTabs(); disegnaCorpo(); },
  }, v)));

  const disegnaCorpo = () => {
    editor?.distruggi();
    editor = null;
    if (tab === 'panoramica') panoramica();
    else if (tab === 'mappa') mappa();
    else if (tab === 'incontri') incontri();
    else manuale();
  };

  // ------------------------------------------------ panoramica
  const panoramica = () => {
    const s = sezione(id);
    const meta = S.dati.meta.dungeon[s.d];
    const modificato = s.base.descr && s.descr !== s.base.descr;
    const voci = s.mostri || [];
    let togli = false;
    const chips = h('div', { class: 'mostri-zona' });
    const disegnaChips = () => svuota(chips, voci.length ? voci.map((v, i) => {
      const m = S.dati.perMostro.get(v.k || v.s);
      const nome = v.x || m?.it || v.k;
      return h('button', { type: 'button', class: `chip-mostro ${v.x ? 'fuori' : ''}`, title: m?.desc || '',
        onclick: () => {
          if (togli) { const nuove = voci.filter((_, k) => k !== i); salvaMod({ mostri: nuove }); panoramica(); return; }
          if (m) mostraScheda(m.k);
        } },
      togli ? icona('x') : null, nome, m ? h('small', null, `GS ${crTesto(m.cr)}`) : null,
      v.x && m ? h('small', null, `≈ ${m.it}`) : null);
    }) : h('p', { style: { color: 'var(--testo-3)', margin: 0 } }, s.d === 'sa' ? 'Nessun abitante indicato.' : 'Nessun mostro.'));
    disegnaChips();
    const lista = (titolo, arr) => arr?.length ? h('div', null, h('div', { class: 'etichetta-mini' }, titolo), h('ul', { class: 'lista-puntata' }, arr.map((x) => h('li', null, x)))) : null;
    svuota(corpo, h('div', { class: 'colonne-sezione' },
      h('div', { style: { display: 'grid', gap: '16px' } },
        s.descr ? h('div', { class: 'leggi' }, h('span', { class: 'etichetta-mini' }, 'Da leggere ai giocatori'), s.descr) : null,
        modificato ? h('p', { style: { fontSize: '13px', color: 'var(--testo-3)', margin: 0 } }, 'Testo modificato da te. ',
          h('a', { href: '#', onclick: (e) => { e.preventDefault(); salvaMod({ descr: undefined }); panoramica(); } }, 'Torna all\'originale')) : null,
        s.tratto ? h('div', { class: 'nota-master' }, h('b', null, 'Tratto fisso. '), s.tratto) : null,
        h('section', { class: 'pannello' }, h('h2', null, 'Per il master'),
          h('div', { style: { display: 'grid', gap: '14px' } },
            lista('Trappole e trabocchetti della zona', s.trappole),
            lista('Oggetti notevoli', s.oggetti),
            s.note ? h('div', null, h('div', { class: 'etichetta-mini' }, 'Nota'), h('p', null, s.note)) : null,
            meta?.ingresso ? h('div', null, h('div', { class: 'etichetta-mini' }, 'Ingresso nella campagna'), h('p', null, meta.ingresso)) : null,
            s.servizi ? h('div', null, h('div', { class: 'etichetta-mini' }, 'Servizi'),
              h('ul', { class: 'lista-puntata' }, s.servizi.lista.map((x) => {
                const info = S.dati.tabelle.servizi[x.c];
                return h('li', null, h('b', null, `${info.nome}${x.g ? ` (Grado ${x.g})` : ''}: `), x.nota ? `${x.nota}. ` : '', info.desc);
              }), s.servizi.extra.map((x) => h('li', null, x)))) : null))),
      h('div', { style: { display: 'grid', gap: '16px' } },
        h('section', { class: 'pannello' },
          h('header', null, h('h2', null, s.d === 'sa' ? 'Chi si incontra' : 'Mostri della zona'),
            h('div', { class: 'riga' },
              bottone('Aggiungi', () => scegliMostro('Aggiungi ai mostri della zona', (k) => { salvaMod({ mostri: [...voci, { k }] }); panoramica(); }), { cls: 'piccolo', ico: 'piu' }),
              bottone('Togli', () => { togli = !togli; disegnaChips(); }, { cls: 'piccolo fantasma', ico: 'x' }))),
          chips,
          h('p', { style: { fontSize: '12px', color: 'var(--testo-3)', margin: '10px 0 0' } }, 'I nomi con il bordo tratteggiato non sono nel SRD: la scheda mostrata è il sostituto indicato con ≈. ',
            S.docs.sezioni?.[id]?.mostri ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); salvaMod({ mostri: undefined }); panoramica(); } }, 'Ripristina l\'elenco originale.') : null)),
        h('section', { class: 'pannello' }, h('h2', null, 'Descrizioni dei mostri'),
          h('div', { style: { display: 'grid', gap: '10px' } }, risolviPool(voci, S.dati.perMostro).map(({ m, nome }) => h('div', null,
            h('b', null, nome || m.it), h('span', { style: { color: 'var(--testo-3)', fontSize: '12px' } }, ` · ${nomeTipo(m.tipo)}, GS ${crTesto(m.cr)}`),
            h('p', { style: { margin: '2px 0 0', font: '15px/1.45 var(--f-testo)' } }, m.desc || '—'))))),
        h('section', { class: 'pannello' }, h('h2', null, 'Dal manuale'),
          h('p', { style: { fontSize: '14px' } }, s.d === 'sa' ? 'Area sicura del generatore: nessun manuale.' : `Riferimento: ${s.fonte}.`),
          h('p', { style: { fontSize: '13px', color: 'var(--testo-3)' } }, 'Le descrizioni qui sono scritte apposta per Ascension Gate. Il testo in riquadro e le mappe ufficiali stanno nei tuoi manuali: puoi incollarli e caricarli nella scheda "Manuale e immagini", restano solo nel tuo database.'),
          bottone('Apri Manuale e immagini', () => { tab = 'manuale'; history.replaceState(null, '', `#/sezione/${id}/manuale`); disegnaTabs(); disegnaCorpo(); }, { cls: 'piccolo', ico: 'libro' })))));
  };

  // ------------------------------------------------ mappa della sezione
  const mappa = () => {
    const s = sezione(id);
    let g = S.docs.griglie?.[id];
    if (!g) {
      g = generaGriglia(s, { ...S.dati, perMostro: S.dati.perMostro }, { seme: 1, gruppo: gruppoAttuale(s.g).tipico ? null : gruppoAttuale(s.g).pg });
      salva('griglie', id, g);
    }
    const tela = h('div', { class: 'tela-contenitore' });
    const barra = h('div', { class: 'griglia-barra' });
    const elenco = h('div', { class: 'stanza-elenco' });
    const scheda = h('div', { class: 'stanza-scheda' });
    let strumento = 'seleziona';
    let anteprima = false;
    let timerPub = null;

    const inDiretta = () => {
      const st = S.docs.stato?.giocatori;
      return st && st.sez === id && st.modo === 'mappa';
    };
    const testoAttuale = (gg) => {
      if (!gg.gruppo) return '';
      const z = gg.zona[gg.gruppo.y * gg.w + gg.gruppo.x];
      const st = gg.stanze.find((x) => x.id === z);
      return st && gg.rivelate.includes(z) ? st.descr : '';
    };
    const pubblica = (testo) => {
      const gg = editor.g;
      pubblicaGiocatori({
        modo: 'mappa', sez: id, titolo: s.nome, sottotitolo: s.d === 'sa' ? 'Area sicura' : NOMI_DUNGEON[s.d],
        griglia: grigliaPerGiocatori(gg), pav: tema().pav, muro: tema().muro, testo: testo ?? testoAttuale(gg),
      });
    };
    const cambiata = (gg) => {
      salva('griglie', id, gg);
      disegnaElenco();
      if (stanzaSel != null) disegnaScheda();
      if (inDiretta()) { clearTimeout(timerPub); timerPub = setTimeout(() => pubblica(), 350); }
    };

    const disegnaBarra = () => svuota(barra,
      STRUMENTI.map((st) => h('button', { type: 'button', class: `strumento ${st.id === strumento ? 'attivo' : ''}`, title: st.nome,
        onclick: () => { strumento = st.id; editor.strumento(st.id); disegnaBarra(); } },
      st.colore ? h('i', { style: { background: st.colore } }) : null, st.nome)),
      h('span', { class: 'sep' }),
      h('button', { type: 'button', class: 'strumento', onclick: () => { if (!editor.annulla()) toast('Niente da annullare.'); } }, icona('annulla'), 'Annulla'),
      h('button', { type: 'button', class: `strumento ${anteprima ? 'attivo' : ''}`, onclick: () => { anteprima = !anteprima; editor.anteprima(anteprima); disegnaBarra(); } }, icona('occhio'), 'Anteprima giocatori'),
      h('button', { type: 'button', class: 'strumento', onclick: () => { editor.g.rivelate = editor.g.stanze.map((x) => x.id); editor.ridisegna(); cambiata(editor.g); } }, 'Rivela tutto'),
      h('button', { type: 'button', class: 'strumento', onclick: () => { editor.g.rivelate = []; editor.ridisegna(); cambiata(editor.g); } }, 'Nascondi tutto'),
      h('span', { class: 'spazio' }),
      bottone(inDiretta() ? 'In onda ai giocatori' : 'Mostra ai giocatori', () => { pubblica(); toast('Mappa inviata alla schermata dei giocatori.'); disegnaBarra(); }, { cls: `piccolo ${inDiretta() ? 'attivo' : 'primario'}`, ico: 'schermo' }),
      bottone('Rigenera', () => conferma('Generare una mappa nuova per questa sezione? Stanze, contenuti e modifiche attuali andranno persi.', () => {
        const nuova = generaGriglia(s, S.dati, { seme: (editor.g.seme || 1) + 1, gruppo: gruppoAttuale(s.g).tipico ? null : gruppoAttuale(s.g).pg });
        stanzaSel = null;
        editor.imposta(nuova);
        cambiata(nuova);
        svuota(scheda, h('p', { style: { color: 'var(--testo-3)' } }, 'Seleziona una stanza.'));
      }, 'Rigenera'), { cls: 'piccolo fantasma', ico: 'rifai' }));

    const disegnaElenco = () => {
      const gg = editor.g;
      svuota(elenco, [...gg.stanze].sort((a, b) => a.n - b.n).map((st) => h('button', {
        type: 'button', class: st.id === stanzaSel ? 'attiva' : '',
        onclick: () => { stanzaSel = st.id; editor.seleziona(st.id); disegnaElenco(); disegnaScheda(); },
      }, h('span', { class: 'num' }, String(st.n)),
      h('span', null, st.titolo || RUOLI[st.ruolo] || (st.descr || '').split('.')[0].slice(0, 44), st.sgombra ? ' ✓' : ''),
      h('span', { class: 'icone-stanza' },
        st.mostri?.length ? h('i', { class: 'pallino-mostri', title: 'Mostri' }) : null,
        st.trappola ? h('i', { class: 'pallino-trappola', title: 'Trappola' }) : null,
        st.tesoro?.length ? h('i', { class: 'pallino-tesoro', title: 'Tesoro' }) : null,
        gg.rivelate.includes(st.id) ? h('i', { class: 'pallino-rivelata', title: 'Vista dai giocatori' }) : null))));
    };

    const disegnaScheda = () => {
      const gg = editor.g;
      const st = gg.stanze.find((x) => x.id === stanzaSel);
      if (!st) return svuota(scheda, h('p', { style: { color: 'var(--testo-3)' } }, 'Seleziona una stanza sulla mappa o nell\'elenco.'));
      const aggiorna = () => { cambiata(gg); editor.ridisegna(); };
      const pool = risolviPool(sezione(id).mostri, S.dati.perMostro);
      const { pg } = gruppoAttuale(s.g);
      const rivelata = gg.rivelate.includes(st.id);
      const descr = h('textarea', { class: 'campo', rows: 4 }, st.descr || '');
      descr.addEventListener('change', () => { st.descr = descr.value; aggiorna(); });
      const note = h('textarea', { class: 'campo', rows: 2, placeholder: 'Note tue su questa stanza' }, st.note || '');
      note.addEventListener('change', () => { st.note = note.value; aggiorna(); });
      const xp = xpIncontro(st.mostri || [], S.dati.perMostro);
      svuota(scheda,
        h('div', null, h('p', { class: 'occhiello' }, `Stanza ${st.n}`), h('h3', null, st.titolo || RUOLI[st.ruolo] || 'Stanza'),
          h('div', { class: 'riga', style: { marginTop: '6px' } },
            RUOLI[st.ruolo] ? h('span', { class: 'tag' }, RUOLI[st.ruolo]) : null,
            st.servizio ? h('span', { class: 'tag verde' }, st.servizio) : null,
            rivelata ? h('span', { class: 'tag' }, icona('occhio'), 'Vista dai giocatori') : h('span', { class: 'tag' }, icona('occhioNo'), 'Nascosta'))),
        h('div', { class: 'riga' },
          bottone('Il gruppo è qui', () => {
            gg.gruppo = accantoAlCentro(st, gg.zona, decodifica(gg.celle));
            if (!rivelata) gg.rivelate = [...gg.rivelate, st.id];
            aggiorna();
            if (inDiretta()) pubblica(st.descr);
          }, { cls: 'piccolo primario', ico: 'bersaglio' }),
          bottone(rivelata ? 'Nascondi' : 'Rivela', () => { gg.rivelate = rivelata ? gg.rivelate.filter((r) => r !== st.id) : [...gg.rivelate, st.id]; aggiorna(); }, { cls: 'piccolo', ico: rivelata ? 'occhioNo' : 'occhio' }),
          bottone('Leggila ai giocatori', () => { if (!rivelata) { gg.rivelate = [...gg.rivelate, st.id]; aggiorna(); } pubblica(st.descr); toast('Inviata alla schermata dei giocatori.'); }, { cls: 'piccolo', ico: 'schermo' }),
          bottone(st.sgombra ? 'Da sgombrare' : 'Sgombrata', () => { st.sgombra = !st.sgombra; aggiorna(); }, { cls: 'piccolo fantasma' })),
        h('label', { class: 'etichetta' }, 'Da leggere (modificabile)', descr),
        st.elemento ? h('div', { class: 'nota-master' }, h('b', null, 'Elemento notevole: '), st.elemento) : null,
        st.note && !st.servizio ? null : st.servizio ? h('div', { class: 'nota-master' }, st.note) : null,
        h('section', null,
          h('div', { class: 'etichetta-mini' }, s.d === 'sa' ? 'Presenze' : 'Mostri'),
          st.mostri?.length ? h('div', { class: 'gruppo-mostri' }, st.mostri.map((gm) => {
            const m = S.dati.perMostro.get(gm.k);
            return m ? h('div', null, h('b', null, `${gm.n}×`), h('a', { href: '#', onclick: (e) => { e.preventDefault(); mostraScheda(gm.k); } }, gm.nome || m.it),
              h('span', { class: 'tag' }, `GS ${crTesto(m.cr)}`), h('span')) : null;
          })) : h('p', { style: { color: 'var(--testo-3)', margin: 0, fontSize: '14px' } }, 'Nessuno.'),
          st.mostri?.length ? h('p', { style: { fontSize: '12px', color: 'var(--testo-3)', margin: '6px 0' } }, `${xp.toLocaleString('it-IT')} PE`) : null,
          h('div', { class: 'riga' },
            st.mostri?.length ? bottone('Combatti', () => avviaCombattimento(st.mostri, { sez: id, titolo: `Stanza ${st.n} · ${s.nome}` }), { cls: 'piccolo pericolo', ico: 'spade' }) : null,
            pool.length ? bottone(st.mostri?.length ? 'Ritira' : 'Metti un incontro', () => {
              st.mostri = generaIncontro(pool, budget(S.dati.tabelle, pg, st.ruolo === 'tana' ? 2 : 1), rngSeme(Date.now()));
              aggiorna();
            }, { cls: 'piccolo', ico: 'dado' }) : null,
            bottone('Dal bestiario', () => scegliMostro('Aggiungi alla stanza', (k) => { st.mostri = [...(st.mostri || []), { k, n: 1 }]; aggiorna(); }), { cls: 'piccolo fantasma', ico: 'piu' }),
            st.mostri?.length ? bottone('Togli', () => { st.mostri = []; aggiorna(); }, { cls: 'piccolo fantasma', ico: 'x' }) : null)),
        h('section', null,
          h('div', { class: 'etichetta-mini' }, 'Trappola'),
          st.trappola ? h('div', { style: { fontSize: '14px', display: 'grid', gap: '4px' } },
            h('b', null, st.trappola.nome), h('span', null, h('i', null, 'Innesco: '), st.trappola.innesco), h('span', null, st.trappola.effetto),
            h('span', { style: { color: 'var(--testo-2)' } }, st.trappola.scopri), st.trappola.idea ? h('span', { class: 'tag ambra' }, `Idea della zona: ${st.trappola.idea}`) : null)
            : h('p', { style: { color: 'var(--testo-3)', margin: 0, fontSize: '14px' } }, 'Nessuna.'),
          h('div', { class: 'riga', style: { marginTop: '6px' } },
            bottone(st.trappola ? 'Cambia' : 'Metti una trappola', () => {
              const t = rendiTrappola(trappolePerTema(S.dati.tabelle, s.tema)[d(trappolePerTema(S.dati.tabelle, s.tema).length) - 1], s.g, S.dati.tabelle);
              st.trappola = t;
              if (!gg.segni.some((x) => x.tipo === 'trappola' && x.stanza === st.id)) {
                const c = centriStanze(gg).get(st.id);
                gg.segni.push({ tipo: 'trappola', stanza: st.id, x: Math.round(c.x), y: Math.round(c.y) + 1 });
              }
              aggiorna();
            }, { cls: 'piccolo', ico: 'dado' }),
            st.trappola ? bottone('Togli', () => { st.trappola = null; gg.segni = gg.segni.filter((x) => !(x.tipo === 'trappola' && x.stanza === st.id)); aggiorna(); }, { cls: 'piccolo fantasma', ico: 'x' }) : null)),
        h('section', null,
          h('div', { class: 'etichetta-mini' }, 'Tesoro e oggetti'),
          st.tesoro?.length ? h('ul', { class: 'lista-puntata', style: { fontSize: '14px' } }, st.tesoro.map((t) => h('li', null, t))) : h('p', { style: { color: 'var(--testo-3)', margin: 0, fontSize: '14px' } }, 'Niente.'),
          h('div', { class: 'riga', style: { marginTop: '6px' } },
            bottone('Tira un tesoro', () => { st.tesoro = [...(st.tesoro || []), ...tiraTesoro(S.dati.tabelle, s.g, rngSeme(Date.now()))]; aggiorna(); }, { cls: 'piccolo ambra', ico: 'dado' }),
            st.tesoro?.length ? bottone('Togli', () => { st.tesoro = []; aggiorna(); }, { cls: 'piccolo fantasma', ico: 'x' }) : null)),
        h('label', { class: 'etichetta' }, 'Note', note));
    };

    svuota(corpo,
      h('p', { style: { fontSize: '13px', color: 'var(--testo-3)', marginTop: 0 } },
        'Mappa generata per questa sezione (non è la mappa del manuale: quella puoi caricarla nella scheda "Manuale e immagini"). Ogni casella è 1,5 m. Numeri = stanze; triangolo rosso = trappola; rombo d\'oro = tesoro; scale verdi = ingresso, ambra = uscita; S viola = porta segreta.'),
      barra,
      h('div', { class: 'griglia-vista' }, tela,
        h('aside', { style: { display: 'grid', gap: '14px' } },
          h('section', { class: 'pannello' }, h('h2', null, 'Stanze'), elenco),
          h('section', { class: 'pannello' }, scheda))));
    editor = creaEditor(tela, g, {
      tema: tema(),
      onCambia: cambiata,
      onSeleziona: (z) => { stanzaSel = z; disegnaElenco(); disegnaScheda(); },
    });
    disegnaBarra();
    disegnaElenco();
    disegnaScheda();
  };

  // ------------------------------------------------ incontri
  const incontri = () => {
    const s = sezione(id);
    const pool = risolviPool(s.mostri, S.dati.perMostro);
    const esito = h('div');
    svuota(corpo, h('div', { class: 'colonne-sezione' },
      h('section', { class: 'pannello' }, h('h2', null, 'Costruisci un incontro'), costruttore({ pool: s.mostri || [], gdm: s.g, sez: id, titolo: s.nome })),
      h('div', { style: { display: 'grid', gap: '16px' } },
        h('section', { class: 'pannello' }, h('h2', null, 'Mostri erranti della zona'),
          pool.length ? h('div', { class: 'contenitore-tabella' }, h('table', { class: 'tabella' },
            h('thead', null, h('tr', null, h('th', null, `d${pool.length}`), h('th', null, 'Mostro'), h('th', null, 'GS'))),
            h('tbody', null, pool.map((p, i) => h('tr', null, h('td', null, String(i + 1)),
              h('td', null, h('a', { href: '#', onclick: (e) => { e.preventDefault(); mostraScheda(p.m.k); } }, p.nome || p.m.it)), h('td', null, crTesto(p.m.cr))))))) : h('p', null, 'Nessun mostro in questa sezione.'),
          pool.length ? bottone(`Tira d${pool.length}`, () => {
            const k = d(pool.length);
            const p = pool[k - 1];
            const gr = generaIncontro([p], budget(S.dati.tabelle, gruppoAttuale(s.g).pg, 1), rngSeme(Date.now()));
            registra(`Mostro errante in ${s.nome}: d${pool.length}→${k} = ${gr[0].n}× ${p.nome || p.m.it}`, 'erranti');
            svuota(esito, h('div', { class: 'risultato', style: { marginTop: '12px' } },
              h('div', { class: 'risultato-corpo' }, h('div', { class: 'riga' }, h('b', { style: { fontFamily: 'var(--f-mono)', fontSize: '20px', color: 'var(--accento)' } }, String(k)),
                h('span', null, `${gr[0].n}× ${p.nome || p.m.it}`)),
              bottone('Combatti', () => avviaCombattimento(gr, { sez: id, titolo: `Erranti in ${s.nome}` }), { cls: 'piccolo pericolo', ico: 'spade' }))));
          }, { cls: 'ambra', ico: 'dado' }) : null, esito))));
  };

  // ------------------------------------------------ manuale e immagini
  const manuale = () => {
    const s = sezione(id);
    const mod = S.docs.sezioni?.[id] || {};
    const testoMan = h('textarea', { class: 'campo', rows: 10, placeholder: 'Incolla qui il testo in riquadro o le note del tuo manuale per questa sezione.' }, mod.testoManuale || '');
    testoMan.addEventListener('input', () => salvaMod({ testoManuale: testoMan.value }));
    const descr = h('textarea', { class: 'campo', rows: 5 }, s.descr || '');
    descr.addEventListener('change', () => salvaMod({ descr: descr.value }));
    const galleria = h('div', { class: 'galleria' });
    const file = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'sr', id: `img-${id}` });
    file.addEventListener('change', async () => {
      const lista = [...file.files];
      file.value = '';
      for (const f of lista) {
        try {
          toast(`Carico ${f.name}…`);
          const imgId = await caricaImmagine(f);
          const att = S.docs.sezioni?.[id] || {};
          salvaMod({ immagini: [...(att.immagini || []), { id: imgId, nome: f.name }] });
          registra(`Immagine caricata in ${s.nome}: ${f.name}`, 'nota');
        } catch (e) {
          toast(`Non riesco a caricare ${f.name}: ${e.message}`, 'avviso');
        }
      }
      disegnaGalleria();
    });
    const disegnaGalleria = async () => {
      const imm = S.docs.sezioni?.[id]?.immagini || [];
      svuota(galleria, imm.length ? imm.map((im) => {
        const img = h('img', { alt: im.nome, loading: 'lazy' });
        urlImmagine(im.id).then((u) => { img.src = u; }).catch(() => { img.alt = 'Immagine non disponibile'; });
        img.addEventListener('click', () => modale(im.nome, h('img', { class: 'zoom-img', src: img.src, alt: im.nome })));
        return h('figure', null, img, h('figcaption', null,
          h('button', { class: 'btn-ico', type: 'button', title: 'Mostra ai giocatori', 'aria-label': 'Mostra ai giocatori', onclick: () => {
            pubblicaGiocatori({ modo: 'immagine', sez: id, titolo: s.nome, immagine: im.id, testo: '' });
            toast('Immagine inviata alla schermata dei giocatori.');
          } }, icona('schermo')),
          h('button', { class: 'btn-ico', type: 'button', title: 'Elimina', 'aria-label': 'Elimina immagine', onclick: () => conferma(`Eliminare "${im.nome}"?`, async () => {
            salvaMod({ immagini: (S.docs.sezioni?.[id]?.immagini || []).filter((x) => x.id !== im.id) });
            try { await eliminaImmagine(im.id); } catch { /* resta orfana nel KV */ }
            disegnaGalleria();
          }, 'Elimina') }, icona('cestino'))));
      }) : h('p', { style: { color: 'var(--testo-3)', margin: 0 } }, 'Nessuna immagine.'));
    };
    svuota(corpo, h('div', { class: 'colonne-sezione' },
      h('div', { style: { display: 'grid', gap: '16px' } },
        h('section', { class: 'pannello' },
          h('header', null, h('h2', null, 'Testo del tuo manuale'),
            bottone('Mostralo ai giocatori', () => { pubblicaGiocatori({ modo: 'testo', sez: id, titolo: s.nome, testo: testoMan.value }); toast('Testo inviato.'); }, { cls: 'piccolo', ico: 'schermo' })),
          h('p', { style: { fontSize: '13px', color: 'var(--testo-3)' } }, `Fonte: ${s.fonte}. Resta privato nel tuo database.`), testoMan),
        h('section', { class: 'pannello' },
          h('header', null, h('h2', null, 'Descrizione per i giocatori'),
            S.docs.sezioni?.[id]?.descr ? bottone('Torna all\'originale', () => { salvaMod({ descr: undefined }); manuale(); }, { cls: 'piccolo fantasma', ico: 'annulla' }) : null),
          descr)),
      h('section', { class: 'pannello' },
        h('header', null, h('h2', null, 'Immagini e mappe'),
          h('label', { class: 'btn piccolo primario', for: `img-${id}` }, icona('carica'), h('span', null, 'Carica'))),
        file,
        h('p', { style: { fontSize: '13px', color: 'var(--testo-3)' } }, 'Foto o scansioni delle mappe dei tuoi manuali, handout, ritratti. Si ridimensionano a 2400 px prima del caricamento.'),
        galleria)));
    disegnaGalleria();
  };

  svuota(el, testa, tabs, corpo);
  disegnaTesta();
  disegnaTabs();
  disegnaCorpo();
  const f = () => disegnaTesta();
  document.addEventListener('ag-spedizione', f);
  return () => { document.removeEventListener('ag-spedizione', f); editor?.distruggi(); };
}
