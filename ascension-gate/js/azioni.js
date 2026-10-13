// Azioni condivise tra le viste: percorso della spedizione, registro, schermata dei giocatori.
import { S, spedizioneAttiva, salvaSpedizione, salva, sezione } from './store.js';
import { toast, aggiornaTestata } from './ui.js';

export function registra(testo, tipo = 'nota') {
  const sp = spedizioneAttiva();
  if (!sp) return;
  sp.registro = [...(sp.registro || []), { t: Date.now(), tipo, testo }].slice(-200);
  salvaSpedizione(sp);
}

// La prima mappa tirabile che contiene la sezione (per aprirla "sulla mappa").
export function mappaDiSezione(sezId, preferita) {
  const mappe = S.dati.mappe;
  const ha = (m) => m?.nodi.some((n) => n.sez === sezId);
  const override = (id) => S.docs.mappe?.[id];
  if (preferita && (ha(override(preferita)) || ha(mappe[preferita]))) return preferita;
  for (const m of Object.values(mappe)) {
    if (m.tirabile && (ha(override(m.id)) || ha(m))) return m.id;
  }
  return null;
}

export function aggiungiAlPercorso(sezId, { mappa = null, qui = false } = {}) {
  const sp = spedizioneAttiva();
  if (!sp) return;
  sp.percorso = [...(sp.percorso || []), { sez: sezId, mappa: mappa || mappaDiSezione(sezId), stato: 'da-esplorare', t: Date.now() }];
  if (qui || sp.posizione == null || sp.posizione < 0) sp.posizione = sp.percorso.length - 1;
  const s = sezione(sezId);
  sp.registro = [...(sp.registro || []), { t: Date.now(), tipo: 'percorso', testo: `Aggiunta al percorso: ${s?.nome}` }].slice(-200);
  salvaSpedizione(sp);
  aggiornaTestata();
  toast(`Aggiunta al percorso: ${s?.nome}`);
}

// "Il gruppo è qui": se la sezione è già nel percorso diventa la posizione, altrimenti si aggiunge.
export function gruppoQui(sezId, mappa = null) {
  const sp = spedizioneAttiva();
  if (!sp) return;
  const i = (sp.percorso || []).map((p) => p.sez).lastIndexOf(sezId);
  if (i < 0) return aggiungiAlPercorso(sezId, { mappa, qui: true });
  sp.posizione = i;
  if (sp.percorso[i].stato === 'da-esplorare') sp.percorso[i].stato = 'in-corso';
  salvaSpedizione(sp);
  aggiornaTestata();
  toast(`Il gruppo è in: ${sezione(sezId)?.nome}`);
}

// Scrive il documento letto dalla schermata dei giocatori.
export function pubblicaGiocatori(stato) {
  salva('stato', 'giocatori', { ...stato, aggiornato: Date.now() }, { subito: true });
}

export function schermoNero() {
  pubblicaGiocatori({ modo: 'nero' });
  toast('Schermata dei giocatori oscurata.');
}
