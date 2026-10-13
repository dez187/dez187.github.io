// Vista "Bestiario": SRD 5.2 (più alcuni SRD 5.1) e mostri creati dal master.
import { S, salva, elimina, spedizioneAttiva, sezione, nuovoId } from '../store.js';
import {
  h, svuota, bottone, icona, schedaMostro, nomeTipo, nomeTaglia, vai, modale, conferma, toast,
} from '../ui.js';
import { crTesto, XP_CR } from '../logica.js';
import { avviaCombattimento } from './incontro.js';

const norm = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const filtri = { q: '', tipo: '', fonte: '', crMin: '', crMax: '', zona: false };
const CR = [0, 0.125, 0.25, 0.5, ...Array.from({ length: 30 }, (_, i) => i + 1)];

export function monta(el, params) {
  let scelto = params[0] || null;
  const elenco = h('div', { class: 'elenco-mostri' });
  const scheda = h('div');
  const conta = h('span', { class: 'tag' });

  const sezQui = () => {
    const sp = spedizioneAttiva();
    const p = sp?.percorso?.[sp.posizione];
    return p ? sezione(p.sez) : null;
  };

  const risultati = () => {
    const q = norm(filtri.q);
    const zona = filtri.zona ? new Set((sezQui()?.mostri || []).map((v) => v.k || v.s)) : null;
    return S.dati.tuttiMostri.filter((m) => (!q || norm(`${m.it} ${m.en}`).includes(q))
      && (!filtri.tipo || m.tipo === filtri.tipo)
      && (!filtri.fonte || m.fonte === filtri.fonte)
      && (filtri.crMin === '' || m.cr >= Number(filtri.crMin))
      && (filtri.crMax === '' || m.cr <= Number(filtri.crMax))
      && (!zona || zona.has(m.k)));
  };

  const disegnaElenco = () => {
    const r = risultati();
    conta.textContent = `${r.length} mostri`;
    svuota(elenco, r.slice(0, 400).map((m) => h('button', { type: 'button', class: m.k === scelto ? 'attivo' : '', onclick: () => { scelto = m.k; history.replaceState(null, '', `#/bestiario/${m.k}`); disegnaElenco(); disegnaScheda(); } },
      h('span', null, m.it), h('span', { class: 'cr' }, `GS ${crTesto(m.cr)}`),
      h('small', null, `${nomeTipo(m.tipo)}, taglia ${nomeTaglia(m.taglia)}${m.en && m.en !== m.it ? ` · ${m.en}` : ''}${m.fonte === 'Personalizzato' ? ' · tuo' : ''}`))));
  };

  const disegnaScheda = () => {
    const m = scelto && S.dati.perMostro.get(scelto);
    if (!m) return svuota(scheda, h('div', { class: 'pannello' }, h('p', { style: { color: 'var(--testo-2)' } }, 'Scegli un mostro dall\'elenco.')));
    const s = sezQui();
    const custom = m.fonte === 'Personalizzato';
    svuota(scheda,
      h('div', { class: 'riga', style: { marginBottom: '12px' } },
        bottone('Combatti', () => avviaCombattimento([{ k: m.k, n: 1 }], { titolo: m.it }), { cls: 'piccolo pericolo', ico: 'spade' }),
        s ? bottone(`Aggiungi ai mostri di ${s.nome.replace(/^Livello /, 'L')}`, () => {
          const att = S.docs.sezioni?.[s.id] || {};
          salva('sezioni', s.id, { ...att, mostri: [...(s.mostri || []), { k: m.k }] });
          toast(`${m.it} aggiunto alla zona.`);
        }, { cls: 'piccolo', ico: 'piu' }) : null,
        bottone(custom ? 'Modifica' : 'Copia e modifica', () => editorMostro(custom ? m : { ...m, k: null, it: `${m.it} (variante)` }, (k) => { scelto = k; disegnaElenco(); disegnaScheda(); }), { cls: 'piccolo', ico: 'matita' }),
        custom ? bottone('Elimina', () => conferma(`Eliminare "${m.it}"?`, () => { elimina('mostri', m.k); scelto = null; disegnaElenco(); disegnaScheda(); }, 'Elimina'), { cls: 'piccolo fantasma', ico: 'cestino' }) : null),
      schedaMostro(m));
  };

  const tipi = [...new Set(S.dati.tuttiMostri.map((m) => m.tipo))].sort((a, b) => nomeTipo(a).localeCompare(nomeTipo(b), 'it'));
  const sel = (chiave, opzioni, etichetta) => {
    const s = h('select', { class: 'campo', 'aria-label': etichetta, onchange: (e) => { filtri[chiave] = e.target.value; disegnaElenco(); } }, opzioni);
    s.value = filtri[chiave];
    return s;
  };
  const cerca = h('input', { class: 'campo', type: 'search', placeholder: 'Cerca (italiano o inglese)…', value: filtri.q, oninput: (e) => { filtri.q = e.target.value; disegnaElenco(); } });
  const crOpz = (vuoto) => [h('option', { value: '' }, vuoto), ...CR.map((c) => h('option', { value: String(c) }, `GS ${crTesto(c)}`))];

  svuota(el,
    h('div', { class: 'testa-vista' },
      h('div', null, h('p', { class: 'occhiello' }, 'Bestiario'), h('h1', null, 'Mostri'),
        h('p', { class: 'sotto' }, 'Il SRD 5.2 completo (regole 2024) più alcuni mostri del SRD 5.1 che mancano, con nomi e descrizioni in italiano. Le schede tecniche restano in inglese, come nel SRD. Puoi creare i tuoi mostri o copiarne uno e modificarlo.')),
      bottone('Nuovo mostro', () => editorMostro(null, (k) => { scelto = k; disegnaElenco(); disegnaScheda(); }), { cls: 'primario', ico: 'piu' })),
    h('div', { class: 'vista-bestiario' },
      h('section', { class: 'pannello' },
        h('div', { class: 'filtri' },
          cerca,
          h('div', { class: 'riga' },
            sel('tipo', [h('option', { value: '' }, 'Ogni tipo'), ...tipi.map((t) => h('option', { value: t }, nomeTipo(t)))], 'Tipo'),
            sel('fonte', [h('option', { value: '' }, 'Ogni fonte'), h('option', { value: 'SRD 5.2' }, 'SRD 5.2'), h('option', { value: 'SRD 5.1' }, 'SRD 5.1'), h('option', { value: 'Personalizzato' }, 'I miei')], 'Fonte')),
          h('div', { class: 'riga' }, sel('crMin', crOpz('GS da…'), 'Grado di sfida minimo'), sel('crMax', crOpz('…a'), 'Grado di sfida massimo')),
          h('label', { class: 'riga', style: { fontSize: '13px' } },
            h('input', { type: 'checkbox', checked: filtri.zona, onchange: (e) => { filtri.zona = e.target.checked; disegnaElenco(); } }),
            'Solo i mostri della sezione dove si trova il gruppo'),
          conta),
        elenco),
      scheda));
  disegnaElenco();
  disegnaScheda();
  return null;
}

// Mostro personalizzato: i numeri principali, più un testo libero per tratti e azioni.
function editorMostro(m, fatto) {
  const v = m || { it: '', tipo: 'monstrosity', taglia: 'medium', cr: 1, ca: 12, pf: 20, dv: '', vel: '9 m', car: [10, 10, 10, 10, 10, 10], init: 0, sensi: 'Percezione passiva 10', lingue: '—', desc: '', testo: '' };
  const campo = (et, val, attr = {}) => {
    const i = h('input', { class: 'campo', value: val ?? '', ...attr });
    return [h('label', { class: 'etichetta' }, et, i), i];
  };
  const [lNome, nome] = campo('Nome', v.it);
  const [lCr, cr] = campo('Grado di sfida', v.cr, { type: 'number', step: '0.125', min: '0' });
  const [lCa, ca] = campo('CA', v.ca, { type: 'number' });
  const [lPf, pf] = campo('PF', v.pf, { type: 'number' });
  const [lDv, dv] = campo('Dadi vita', v.dv);
  const [lVel, vel] = campo('Velocità', v.vel);
  const [lIni, ini] = campo('Iniziativa', v.init, { type: 'number' });
  const [lSen, sensi] = campo('Sensi', v.sensi);
  const [lLin, lingue] = campo('Lingue', v.lingue);
  const tipo = h('select', { class: 'campo' }, ['aberration', 'beast', 'celestial', 'construct', 'dragon', 'elemental', 'fey', 'fiend', 'giant', 'humanoid', 'monstrosity', 'ooze', 'plant', 'undead'].map((t) => h('option', { value: t }, nomeTipo(t))));
  tipo.value = v.tipo;
  const taglia = h('select', { class: 'campo' }, ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'].map((t) => h('option', { value: t }, nomeTaglia(t))));
  taglia.value = v.taglia;
  const car = v.car.map((x, i) => h('input', { class: 'campo', type: 'number', value: x, 'aria-label': ['FOR', 'DES', 'COS', 'INT', 'SAG', 'CAR'][i], style: { textAlign: 'center' } }));
  const desc = h('textarea', { class: 'campo', rows: 2 }, v.desc || '');
  const testo = h('textarea', { class: 'campo', rows: 8, placeholder: '**Morso.** Attacco in mischia: +5, portata 1,5 m. 7 (1d8 + 3) danni perforanti.' },
    v.testo || [...(v.tratti || []), ...(v.azioni || []), ...(v.bonus || []), ...(v.reazioni || []), ...(v.leggendarie || [])].map((a) => `**${a.n}.** ${a.d}`).join('\n\n'));
  modale(m?.k ? `Modifica ${m.it}` : 'Nuovo mostro', h('div', { style: { display: 'grid', gap: '12px' } },
    lNome,
    h('div', { class: 'griglia-3' }, h('label', { class: 'etichetta' }, 'Tipo', tipo), h('label', { class: 'etichetta' }, 'Taglia', taglia), lCr),
    h('div', { class: 'griglia-3' }, lCa, lPf, lDv),
    h('div', { class: 'griglia-3' }, lVel, lIni, lSen),
    lLin,
    h('div', null, h('div', { class: 'etichetta-mini' }, 'Caratteristiche'), h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px' } }, car)),
    h('label', { class: 'etichetta' }, 'Descrizione (in italiano, per i giocatori o per te)', desc),
    h('label', { class: 'etichetta' }, 'Tratti e azioni (testo libero; **grassetto** per i nomi)', testo)), [
    { testo: 'Annulla' },
    { testo: 'Salva', cls: 'primario', fn: () => {
      if (!nome.value.trim()) { toast('Serve un nome.'); return false; }
      const k = m?.k && m.fonte === 'Personalizzato' ? m.k : nuovoId('mio');
      const c = Number(cr.value) || 0;
      salva('mostri', k, {
        k, it: nome.value.trim(), en: '', tipo: tipo.value, taglia: taglia.value, all: '', cr: c, xp: XP_CR[c] || 0,
        ca: Number(ca.value) || 10, cad: '', pf: Number(pf.value) || 1, dv: dv.value, vel: vel.value, car: car.map((x) => Number(x.value) || 10),
        ts: {}, abil: {}, init: Number(ini.value) || 0, sensi: sensi.value, lingue: lingue.value, res: '', imm: '', vuln: '', immc: '',
        tratti: [], azioni: [], bonus: [], reazioni: [], leggendarie: [], desc: desc.value, testo: testo.value,
      });
      toast('Mostro salvato.');
      fatto?.(k);
    } },
  ]);
}

export { editorMostro };
