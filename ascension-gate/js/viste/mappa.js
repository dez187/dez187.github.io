// Vista "Mappe": le mappe dei percorsi come grafo (Cytoscape), con il percorso della spedizione
// sovrapposto, modifica di nodi e collegamenti, e il tiro di una sezione sulla mappa.
import { S, salva, elimina, spedizioneAttiva, sezione } from '../store.js';
import {
  h, svuota, bottone, icona, pillGdm, NOMI_DUNGEON, vai, nomeBreve, numeroCerchiato, modale, chiedi, conferma, toast,
  gettoniDadi,
} from '../ui.js';
import { aggiungiAlPercorso, gruppoQui, registra } from '../azioni.js';
import { scegliSezione } from '../scelte.js';
import { d } from '../logica.js';

const TIPI_NODO = {
  sezione: 'Sezione', sicura: 'Area sicura', accesso: 'Accesso', uscita: 'Uscita / Porta Anomala', insediamento: 'Insediamento', speciale: 'Luogo speciale',
};

export function monta(el, params) {
  const [idParam, azione, arg] = params;
  const sp = spedizioneAttiva();
  const posizione = sp?.percorso?.[sp.posizione];
  const mappaId = (idParam && S.dati.mappe[idParam]) ? idParam : (posizione?.mappa || 'radice_alta');
  let cy = null;
  let modifica = false;
  let collegaDa = null;
  let selezione = null;

  const area = h('div', { class: 'mappa-area' });
  const cyEl = h('div', { class: 'mappa-cy', role: 'img', 'aria-label': 'Mappa dei percorsi' });
  const barra = h('div', { class: 'mappa-strumenti' });
  const legenda = h('div', { class: 'mappa-legenda' });
  const dettaglio = h('div');
  area.append(cyEl, barra, legenda);
  const radice = h('div', { class: 'vista-mappa' }, area,
    h('aside', { class: 'mappa-lato' },
      h('section', { class: 'pannello' }, h('h2', null, 'Selezione'), dettaglio),
      h('section', { class: 'pannello' }, h('h2', null, 'Mappe'), elencoMappe(mappaId))));

  const grafo = () => {
    const base = S.dati.mappe[mappaId];
    const ov = S.docs.mappe?.[mappaId];
    return { ...base, nodi: ov?.nodi || base.nodi, archi: ov?.archi || base.archi, pos: ov?.pos || null };
  };

  const salvaMappa = (patch) => {
    const g = grafo();
    const pos = {};
    cy?.nodes().forEach((n) => { pos[n.id()] = { ...n.position() }; });
    salva('mappe', mappaId, { nodi: g.nodi, archi: g.archi, pos, ...patch });
  };

  // ------------------------------------------------ elementi e percorso
  const elementi = () => {
    const g = grafo();
    const sp2 = spedizioneAttiva();
    const perc = (sp2?.percorso || []).map((p) => p.sez);
    const visite = new Map();
    perc.forEach((sid, i) => { if (!visite.has(sid)) visite.set(sid, []); visite.get(sid).push(i + 1); });
    const qui = sp2?.percorso?.[sp2.posizione]?.sez;
    const nodiPerSez = new Map();
    const nodi = g.nodi.map((n) => {
      const s = n.sez ? sezione(n.sez) : null;
      if (n.sez && !nodiPerSez.has(n.sez)) nodiPerSez.set(n.sez, n.id);
      const base = n.label || (s ? nomeBreve(s) : n.id);
      const v = n.sez ? visite.get(n.sez) : null;
      const label = v ? `${v.map(numeroCerchiato).join('')} ${base}` : base;
      const cls = [n.tipo, s ? `g${s.g}` : '', v ? 'rotta' : '', n.sez && n.sez === qui ? 'qui' : ''].join(' ');
      return { group: 'nodes', data: { id: n.id, label, tipo: n.tipo, sez: n.sez || '', link: n.link || '' }, classes: cls };
    });
    const archi = g.archi.map((a, i) => ({ group: 'edges', data: { id: `e${i}`, source: a.da, target: a.a, label: a.label || '', i }, classes: a.tratt ? 'tratt' : '' }));
    // tratti del percorso: si evidenzia l'arco esistente, altrimenti si disegna un salto
    const salti = [];
    for (let i = 1; i < perc.length; i++) {
      const a = nodiPerSez.get(perc[i - 1]), b = nodiPerSez.get(perc[i]);
      if (!a || !b || a === b) continue;
      const arco = archi.find((e) => (e.data.source === a && e.data.target === b) || (e.data.source === b && e.data.target === a));
      if (arco) arco.classes += ' rotta';
      else salti.push({ group: 'edges', data: { id: `salto${i}`, source: a, target: b, label: '' }, classes: 'salto' });
    }
    return { g, els: [...nodi, ...archi, ...salti] };
  };

  const stile = () => {
    const css = getComputedStyle(document.documentElement);
    const v = (n) => css.getPropertyValue(n).trim();
    const gdm = [1, 2, 3, 4, 5].map((g) => ({ selector: `node.g${g}`, style: { 'border-color': v(`--g${g}`) } }));
    return [
      { selector: 'node', style: {
        'background-color': v('--bg-3'), 'border-width': 2, 'border-color': v('--linea-2'), label: 'data(label)',
        color: v('--testo'), 'font-family': 'IBM Plex Sans, sans-serif', 'font-size': 11, 'text-wrap': 'wrap',
        'text-max-width': 136, 'text-valign': 'center', 'text-halign': 'center', shape: 'round-rectangle',
        width: 156, height: 50,
      } },
      ...gdm,
      { selector: 'node.sicura', style: { 'border-color': v('--verde'), 'border-style': 'dashed', color: v('--verde') } },
      { selector: 'node.accesso', style: { shape: 'cut-rectangle', 'border-color': v('--accento'), color: v('--accento') } },
      { selector: 'node.uscita', style: { shape: 'tag', 'border-color': v('--viola'), color: v('--viola') } },
      { selector: 'node.insediamento', style: { shape: 'barrel', 'border-color': v('--ambra'), color: v('--ambra') } },
      { selector: 'node.speciale', style: { shape: 'octagon', 'border-color': v('--testo-3'), color: v('--testo-2') } },
      { selector: 'node.rotta', style: { 'border-width': 4, 'font-weight': 600 } },
      { selector: 'node.qui', style: { 'background-color': v('--accento'), color: v('--accento-testo'), 'border-color': v('--accento'), 'underlay-color': v('--accento'), 'underlay-opacity': 0.3, 'underlay-padding': 10, 'underlay-shape': 'round-rectangle' } },
      { selector: 'node:selected', style: { 'overlay-color': v('--accento'), 'overlay-opacity': 0.18, 'overlay-padding': 6 } },
      { selector: 'node.collega-da', style: { 'border-color': v('--ambra'), 'border-width': 5 } },
      { selector: 'edge', style: {
        width: 1.6, 'line-color': v('--linea-2'), 'target-arrow-color': v('--linea-2'), 'target-arrow-shape': 'triangle',
        'arrow-scale': 0.9, 'curve-style': 'bezier', label: 'data(label)', 'font-size': 9, color: v('--testo-3'),
        'text-background-color': v('--bg-2'), 'text-background-opacity': 1, 'text-background-padding': 2,
        'text-rotation': 'autorotate', 'font-family': 'IBM Plex Sans, sans-serif',
      } },
      { selector: 'edge.tratt', style: { 'line-style': 'dashed', 'line-color': v('--viola'), 'target-arrow-color': v('--viola'), color: v('--viola') } },
      { selector: 'edge.rotta', style: { width: 4, 'line-color': v('--accento'), 'target-arrow-color': v('--accento'), 'z-index': 10 } },
      { selector: 'edge.salto', style: { width: 3, 'line-style': 'dotted', 'line-color': v('--accento'), 'target-arrow-color': v('--accento'), 'curve-style': 'unbundled-bezier', 'control-point-distances': 40 } },
      { selector: 'edge:selected', style: { width: 4, 'line-color': v('--ambra'), 'target-arrow-color': v('--ambra') } },
    ];
  };

  // ------------------------------------------------ disegno
  const disegna = (mantieniVista = false) => {
    const { g, els } = elementi();
    const vista = cy && mantieniVista ? { zoom: cy.zoom(), pan: { ...cy.pan() } } : null;
    const posPrec = {};
    cy?.nodes().forEach((n) => { posPrec[n.id()] = { ...n.position() }; });
    cy?.destroy();
    const pos = g.pos || (Object.keys(posPrec).length ? posPrec : null);
    const tuttePos = pos && g.nodi.every((n) => pos[n.id]);
    cy = window.cytoscape({
      container: cyEl, elements: els, style: stile(), wheelSensitivity: 0.25, minZoom: 0.2, maxZoom: 2.5,
      autoungrabify: !modifica, boxSelectionEnabled: false,
      layout: tuttePos
        ? { name: 'preset', positions: (n) => pos[n.id()] || { x: 0, y: 0 }, fit: !vista, padding: 30 }
        : { name: 'dagre', rankDir: 'TB', nodeSep: 26, rankSep: 52, edgeSep: 12, fit: true, padding: 30 },
    });
    if (!tuttePos) serpente();
    if (vista) { cy.zoom(vista.zoom); cy.pan(vista.pan); }
    cy.on('tap', 'node', (e) => tocca(e.target));
    cy.on('tap', 'edge', (e) => { if (!e.target.hasClass('salto')) seleziona(e.target); });
    cy.on('tap', (e) => { if (e.target === cy) seleziona(null); });
    cy.on('dragfree', 'node', () => { if (modifica) salvaMappa({}); });
    disegnaBarra();
    disegnaLegenda();
    if (selezione) {
      const x = cy.getElementById(selezione);
      if (x.nonempty()) { x.select(); mostraDettaglio(x); } else seleziona(null);
    } else mostraDettaglio(null);
  };

  // Le catene lunghissime (il Sottomonte ha 24 livelli) diventano un serpentone leggibile.
  const serpente = () => {
    const bb = cy.elements().boundingBox();
    if (cy.nodes().length <= 12 || bb.h / Math.max(bb.w, 1) < 2.2) return;
    const ord = cy.nodes().sort((a, b) => a.position('y') - b.position('y') || a.position('x') - b.position('x'));
    const perRiga = 5;
    ord.forEach((n, i) => {
      const r = Math.floor(i / perRiga), c = i % perRiga;
      n.position({ x: (r % 2 ? perRiga - 1 - c : c) * 196, y: r * 118 });
    });
    cy.fit(undefined, 30);
  };

  const tocca = (n) => {
    if (modifica && collegaDa) {
      if (collegaDa !== n.id()) {
        const g = grafo();
        salva('mappe', mappaId, { nodi: g.nodi, archi: [...g.archi, { da: collegaDa, a: n.id(), tratt: false, label: '' }], pos: posizioni() });
        toast('Collegamento aggiunto.');
      }
      collegaDa = null;
      disegna(true);
      return;
    }
    seleziona(n);
  };

  const posizioni = () => {
    const pos = {};
    cy.nodes().forEach((n) => { pos[n.id()] = { ...n.position() }; });
    return pos;
  };

  const seleziona = (x) => {
    selezione = x ? x.id() : null;
    mostraDettaglio(x);
    disegnaBarra();
  };

  // ------------------------------------------------ pannello di dettaglio
  const mostraDettaglio = (x) => {
    if (!x) {
      const sp2 = spedizioneAttiva();
      const qui = sp2?.percorso?.[sp2.posizione];
      return svuota(dettaglio,
        h('p', { style: { color: 'var(--testo-2)', fontSize: '14px' } }, 'Tocca un nodo per vederne i dettagli.'),
        qui ? h('p', { style: { fontSize: '14px' } }, 'Il gruppo è in ', h('a', { href: `#/sezione/${qui.sez}` }, sezione(qui.sez)?.nome), '.') : null,
        h('p', { style: { color: 'var(--testo-3)', fontSize: '13px' } }, 'I numeri cerchiati sono l\'ordine di visita del percorso; il nodo pieno è dove si trova il gruppo; le frecce ciano sono il cammino fatto.'));
    }
    if (x.isEdge()) {
      const a = grafo().archi[x.data('i')];
      return svuota(dettaglio,
        h('h3', { style: { font: '600 16px var(--f-titolo)' } }, 'Collegamento'),
        h('p', null, `${x.source().data('label')} → ${x.target().data('label')}`),
        a?.label ? h('p', { class: 'tag viola' }, a.label) : null,
        modifica ? h('div', { class: 'riga' },
          bottone('Etichetta', () => chiedi('Etichetta del collegamento', 'Testo', a.label, (v) => modificaArco(x.data('i'), { label: v })), { cls: 'piccolo', ico: 'matita' }),
          bottone(a?.tratt ? 'Linea continua' : 'Tratteggiata', () => modificaArco(x.data('i'), { tratt: !a.tratt }), { cls: 'piccolo' }),
          bottone('Elimina', () => eliminaSelezione(), { cls: 'piccolo pericolo', ico: 'cestino' })) : null);
    }
    const sid = x.data('sez');
    const s = sid ? sezione(sid) : null;
    const link = x.data('link');
    const sp2 = spedizioneAttiva();
    const visite = (sp2?.percorso || []).map((p, i) => (p.sez === sid ? i + 1 : 0)).filter(Boolean);
    svuota(dettaglio,
      h('p', { class: 'occhiello' }, TIPI_NODO[x.data('tipo')] || x.data('tipo')),
      h('h3', { style: { font: '650 19px/1.2 var(--f-titolo)', margin: '4px 0 8px' } }, s ? s.nome : x.data('label')),
      s ? h('div', { class: 'riga', style: { marginBottom: '10px' } }, pillGdm(s.g), h('span', { class: s.d === 'sa' ? 'tag verde' : 'tag' }, NOMI_DUNGEON[s.d])) : null,
      s?.descr ? h('p', { style: { font: '15px/1.5 var(--f-testo)' } }, s.descr.length > 240 ? `${s.descr.slice(0, 240)}…` : s.descr) : null,
      visite.length ? h('p', { class: 'tag ambra' }, `Nel percorso: passo ${visite.join(', ')}`) : null,
      h('div', { style: { display: 'grid', gap: '8px', marginTop: '12px' } },
        s ? bottone('Apri la sezione', () => vai(`sezione/${s.id}`), { cls: 'primario largo', ico: 'freccia' }) : null,
        s ? bottone('Il gruppo è qui', () => gruppoQui(s.id, mappaId), { cls: 'largo', ico: 'bersaglio' }) : null,
        s ? bottone('Aggiungi al percorso', () => aggiungiAlPercorso(s.id, { mappa: mappaId }), { cls: 'largo', ico: 'piu' }) : null,
        link && S.dati.mappe[link] ? bottone(`Apri: ${S.dati.mappe[link].titolo}`, () => vai(`mappa/${link}`), { cls: 'largo', ico: 'mappa' }) : null,
        modifica ? h('div', { class: 'riga' },
          bottone('Rinomina', () => chiedi('Nome del nodo', 'Etichetta', x.data('label').replace(/^[①-⑳#\d]+\s/, ''), (v) => modificaNodo(x.id(), { label: v || undefined })), { cls: 'piccolo', ico: 'matita' }),
          bottone('Collega da qui', () => { collegaDa = x.id(); x.addClass('collega-da'); toast('Ora tocca il nodo di arrivo.'); }, { cls: 'piccolo', ico: 'freccia' }),
          bottone('Elimina', () => eliminaSelezione(), { cls: 'piccolo pericolo', ico: 'cestino' })) : null));
  };

  const modificaNodo = (id, patch) => {
    const g = grafo();
    salva('mappe', mappaId, { nodi: g.nodi.map((n) => (n.id === id ? { ...n, ...patch } : n)), archi: g.archi, pos: posizioni() });
    disegna(true);
  };
  const modificaArco = (i, patch) => {
    const g = grafo();
    salva('mappe', mappaId, { nodi: g.nodi, archi: g.archi.map((a, k) => (k === i ? { ...a, ...patch } : a)), pos: posizioni() });
    disegna(true);
  };
  const eliminaSelezione = () => {
    const x = selezione && cy.getElementById(selezione);
    if (!x || x.empty()) return;
    const g = grafo();
    if (x.isEdge()) {
      const i = x.data('i');
      salva('mappe', mappaId, { nodi: g.nodi, archi: g.archi.filter((_, k) => k !== i), pos: posizioni() });
    } else {
      const id = x.id();
      salva('mappe', mappaId, { nodi: g.nodi.filter((n) => n.id !== id), archi: g.archi.filter((a) => a.da !== id && a.a !== id), pos: posizioni() });
    }
    selezione = null;
    disegna(true);
  };

  const aggiungiNodo = () => {
    const tipo = h('select', { class: 'campo' }, Object.entries(TIPI_NODO).map(([k, v]) => h('option', { value: k }, v)));
    const etichetta = h('input', { class: 'campo', placeholder: 'Nome (per i nodi che non sono sezioni)' });
    const piazza = (nodo) => {
      const g = grafo();
      const ext = cy.extent();
      const pos = { ...posizioni(), [nodo.id]: { x: (ext.x1 + ext.x2) / 2, y: (ext.y1 + ext.y2) / 2 } };
      salva('mappe', mappaId, { nodi: [...g.nodi, nodo], archi: g.archi, pos });
      selezione = nodo.id;
      disegna(true);
    };
    modale('Nuovo nodo', h('div', { style: { display: 'grid', gap: '12px' } },
      h('label', { class: 'etichetta' }, 'Tipo', tipo), h('label', { class: 'etichetta' }, 'Nome', etichetta),
      h('p', { style: { color: 'var(--testo-3)', fontSize: '13px' } }, 'Per una sezione o un\'area sicura sceglierai la sezione nel passo successivo.')), [
      { testo: 'Annulla' },
      { testo: 'Continua', cls: 'primario', fn: () => {
        const t = tipo.value;
        const unico = (base) => { let id = base, k = 2; const ids = new Set(grafo().nodi.map((n) => n.id)); while (ids.has(id)) id = `${base}-${k++}`; return id; };
        if (t === 'sezione' || t === 'sicura') {
          setTimeout(() => scegliSezione('Quale sezione?', (sid) => piazza({ id: unico(sid), tipo: sid.startsWith('sa-') ? 'sicura' : 'sezione', sez: sid })), 50);
        } else {
          piazza({ id: unico(`n-${Date.now().toString(36)}`), tipo: t, label: etichetta.value.trim() || TIPI_NODO[t] });
        }
      } },
    ]);
  };

  // ------------------------------------------------ tiro sulla mappa
  const tiraQui = (gdmScelto) => {
    const sp2 = spedizioneAttiva();
    const gdmSel = h('div', { class: 'segmenti' });
    let g = gdmScelto || sp2?.gdm || 1;
    const sicure = h('input', { type: 'checkbox', checked: true });
    const disegnaG = () => svuota(gdmSel, [1, 2, 3, 4, 5].map((x) => h('button', { type: 'button', class: x === g ? 'attivo' : '', onclick: () => { g = x; disegnaG(); } }, String(x))));
    disegnaG();
    const esito = h('div');
    const tira = () => {
      const tutte = [...new Set(grafo().nodi.filter((n) => n.sez).map((n) => n.sez))].map((sid) => sezione(sid))
        .filter((s) => sicure.checked || s.d !== 'sa');
      let pool = tutte.filter((s) => s.g === g);
      const avviso = pool.length ? null : `Nessuna sezione di GdM ${g} su questa mappa: tiro tra tutte le sue ${tutte.length}.`;
      if (!pool.length) pool = tutte;
      const k = d(pool.length);
      const s = pool[k - 1];
      registra(`Tiro sulla mappa ${S.dati.mappe[mappaId].titolo} (GdM ${g}): d${pool.length}→${k} = ${s.nome}`, 'tiro');
      const nodo = cy.nodes().filter((n) => n.data('sez') === s.id).first();
      if (nodo.nonempty()) { cy.animate({ center: { eles: nodo }, zoom: Math.max(cy.zoom(), 1) }, { duration: 300 }); cy.elements().unselect(); nodo.select(); seleziona(nodo); }
      svuota(esito, h('div', { class: 'risultato' },
        h('div', { class: 'risultato-testa' }, h('div', { class: 'riga' }, pillGdm(s.g), h('span', { class: 'tag' }, NOMI_DUNGEON[s.d])), gettoniDadi([{ dado: pool.length, risultato: k, cosa: 'sezione' }])),
        h('div', { class: 'risultato-corpo' },
          avviso ? h('p', { class: 'tag ambra' }, avviso) : null,
          h('h3', null, s.nome), s.descr ? h('div', { class: 'leggi' }, s.descr) : null)));
      ultima = s;
    };
    let ultima = null;
    modale('Tira una sezione su questa mappa', h('div', { style: { display: 'grid', gap: '12px' } },
      h('div', { class: 'riga' }, h('span', null, 'Grado di Minaccia'), gdmSel),
      h('label', { class: 'riga' }, sicure, 'Includi le aree sicure della mappa'),
      bottone('Tira', tira, { cls: 'primario', ico: 'dado' }), esito), [
      { testo: 'Chiudi' },
      { testo: 'Il gruppo entra qui', cls: 'primario', fn: () => { if (!ultima) return false; gruppoQui(ultima.id, mappaId); vai(`sezione/${ultima.id}`); } },
    ]);
    if (gdmScelto) tira();
  };

  // ------------------------------------------------ barra e legenda
  const disegnaBarra = () => {
    const m = S.dati.mappe[mappaId];
    svuota(barra,
      h('span', { class: 'tag', style: { background: 'var(--bg-2)', fontWeight: 600, color: 'var(--testo)' } }, m.titolo, m.gdm ? ` · GdM ${m.gdm[0]}–${m.gdm[1]}` : ''),
      h('span', { class: 'spazio' }),
      m.tirabile ? bottone('Tira qui', () => tiraQui(), { cls: 'piccolo', ico: 'dado' }) : null,
      bottone('Centra', () => cy.fit(undefined, 30), { cls: 'piccolo', ico: 'bersaglio' }),
      bottone(modifica ? 'Fine modifica' : 'Modifica', () => {
        modifica = !modifica;
        collegaDa = null;
        radice.classList.toggle('modo-modifica', modifica);
        cy.autoungrabify(!modifica);
        disegnaBarra();
        if (selezione) mostraDettaglio(cy.getElementById(selezione));
        if (modifica) toast('Modifica: trascina i nodi, tocca un nodo per collegarlo o eliminarlo.');
      }, { cls: `piccolo ${modifica ? 'attivo' : ''}`, ico: 'matita' }),
      modifica ? bottone('Nodo', aggiungiNodo, { cls: 'piccolo', ico: 'piu' }) : null,
      modifica && S.docs.mappe?.[mappaId] ? bottone('Ripristina', () => conferma('Tornare alla mappa originale? Le modifiche a questa mappa andranno perse.', () => {
        elimina('mappe', mappaId);
        cy.destroy();
        cy = null;
        disegna();
      }, 'Ripristina'), { cls: 'piccolo pericolo', ico: 'annulla' }) : null);
  };

  const disegnaLegenda = () => {
    svuota(legenda,
      [1, 2, 3, 4, 5].map((g) => h('span', null, h('i', { style: { border: `2px solid var(--g${g})` } }), `GdM ${g}`)),
      h('span', null, h('i', { style: { border: '2px dashed var(--verde)' } }), 'Area sicura'),
      h('span', null, h('i', { style: { borderTop: '2px dashed var(--viola)', height: 0, width: '14px' } }), 'Porta Anomala / nascosto'),
      h('span', null, h('i', { style: { background: 'var(--accento)' } }), 'Gruppo'));
  };

  svuota(el, radice);
  if (!window.cytoscape) {
    svuota(area, h('div', { class: 'vuoto' }, 'Libreria delle mappe non caricata.'));
    return null;
  }
  disegna();
  if (azione === 'tira') setTimeout(() => tiraQui(Number(arg) || null), 200);
  const aggiorna = () => cy && disegna(true);
  document.addEventListener('ag-spedizione', aggiorna);
  return () => { document.removeEventListener('ag-spedizione', aggiorna); cy?.destroy(); };
}

function elencoMappe(attiva) {
  const mappe = Object.values(S.dati.mappe);
  const voce = (m) => h('button', { type: 'button', class: m.id === attiva ? 'attiva' : '', onclick: () => vai(`mappa/${m.id}`) },
    h('span', null, m.titolo), m.gdm ? h('span', { class: 'tag' }, `${m.gdm[0]}–${m.gdm[1]}`) : null);
  return h('div', { class: 'mappa-elenco' },
    h('h3', null, 'Si possono tirare'), mappe.filter((m) => m.tirabile).map(voce),
    h('h3', null, 'Riferimento'), mappe.filter((m) => !m.tirabile).map(voce));
}
