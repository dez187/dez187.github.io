// Finestre di scelta riutilizzabili: una sezione o un mostro, con ricerca.
import { S } from './store.js';
import { h, svuota, modale, pillGdm, NOMI_DUNGEON, nomeTipo } from './ui.js';
import { crTesto } from './logica.js';

const norm = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function scegliSezione(titolo, fn, { gdm = null } = {}) {
  const cerca = h('input', { class: 'campo', placeholder: 'Cerca per nome, livello o dungeon…', type: 'search' });
  const filtroG = h('select', { class: 'campo', style: { maxWidth: '130px' } },
    h('option', { value: '' }, 'Ogni GdM'), [1, 2, 3, 4, 5].map((g) => h('option', { value: String(g) }, `GdM ${g}`)));
  if (gdm) filtroG.value = String(gdm);
  const elenco = h('div', { class: 'mappa-elenco', style: { maxHeight: '50vh', overflowY: 'auto' } });
  let chiudi;
  const disegna = () => {
    const q = norm(cerca.value);
    const g = Number(filtroG.value) || null;
    const voci = S.dati.sezioni.filter((s) => (!g || s.g === g) && (!q || norm(`${s.nome} ${NOMI_DUNGEON[s.d]} ${s.id}`).includes(q)));
    svuota(elenco, voci.slice(0, 120).map((s) => h('button', { type: 'button', onclick: () => { chiudi(); fn(s.id); } },
      h('span', null, s.nome, h('br'), h('small', { style: { color: 'var(--testo-3)' } }, NOMI_DUNGEON[s.d])), pillGdm(s.g))));
  };
  cerca.addEventListener('input', disegna);
  filtroG.addEventListener('change', disegna);
  chiudi = modale(titolo, h('div', { style: { display: 'grid', gap: '10px' } }, h('div', { class: 'riga' }, cerca, filtroG), elenco));
  disegna();
  cerca.focus();
}

export function scegliMostro(titolo, fn, { crMax = null } = {}) {
  const cerca = h('input', { class: 'campo', placeholder: 'Cerca un mostro (italiano o inglese)…', type: 'search' });
  const elenco = h('div', { class: 'elenco-mostri', style: { maxHeight: '50vh' } });
  let chiudi;
  const disegna = () => {
    const q = norm(cerca.value);
    const voci = S.dati.tuttiMostri.filter((m) => (!q || norm(`${m.it} ${m.en || ''}`).includes(q)) && (crMax == null || m.cr <= crMax));
    svuota(elenco, voci.slice(0, 150).map((m) => h('button', { type: 'button', onclick: () => { chiudi(); fn(m.k); } },
      h('span', null, m.it), h('span', { class: 'cr' }, `GS ${crTesto(m.cr)}`),
      h('small', null, `${nomeTipo(m.tipo)}${m.en && m.en !== m.it ? ` · ${m.en}` : ''}`))));
  };
  cerca.addEventListener('input', disegna);
  chiudi = modale(titolo, h('div', { style: { display: 'grid', gap: '10px' } }, cerca, elenco));
  disegna();
  cerca.focus();
}
