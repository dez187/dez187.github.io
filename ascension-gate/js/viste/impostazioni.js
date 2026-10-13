// Vista "Impostazioni": gruppo dei PG, tema, backup, uscita.
import { S, impostazioni, salvaImpostazioni, esporta, importa, caricaDocs } from '../store.js';
import { h, svuota, bottone, icona, toast, conferma } from '../ui.js';

export function monta(el) {
  const disegna = () => {
    const imp = impostazioni();
    const gruppo = imp.gruppo?.length ? imp.gruppo : [];
    const salvaGruppo = (nuovo) => { salvaImpostazioni({ gruppo: nuovo }); };
    const righe = gruppo.map((pg, i) => {
      const campo = (k, attr, larg) => {
        const inp = h('input', { class: 'campo', value: pg[k] ?? '', style: { width: larg }, ...attr });
        inp.addEventListener('change', () => {
          const g2 = [...impostazioni().gruppo];
          g2[i] = { ...g2[i], [k]: attr.type === 'number' ? Number(inp.value) || 0 : inp.value };
          salvaGruppo(g2);
        });
        return inp;
      };
      return h('div', { class: 'riga', style: { marginBottom: '8px' } },
        campo('nome', { placeholder: 'Nome', 'aria-label': 'Nome del PG' }, '180px'),
        campo('livello', { type: 'number', min: '1', max: '20', 'aria-label': 'Livello' }, '80px'),
        campo('ca', { type: 'number', placeholder: 'CA', 'aria-label': 'Classe armatura' }, '80px'),
        campo('pf', { type: 'number', placeholder: 'PF', 'aria-label': 'Punti ferita massimi' }, '90px'),
        campo('note', { placeholder: 'Rank, classe, note', 'aria-label': 'Note' }, '220px'),
        h('button', { class: 'btn-ico', type: 'button', 'aria-label': 'Togli PG', onclick: () => { salvaGruppo(gruppo.filter((_, k) => k !== i)); disegna(); } }, icona('x')));
    });
    const file = h('input', { type: 'file', accept: 'application/json', class: 'sr', id: 'importa-file' });
    file.addEventListener('change', async () => {
      const f = file.files[0];
      file.value = '';
      if (!f) return;
      try {
        const righe2 = JSON.parse(await f.text());
        conferma(`Importare ${righe2.length} documenti? Quelli con lo stesso nome verranno sovrascritti.`, async () => {
          const r = await importa(righe2);
          await caricaDocs();
          toast(`Importati ${r.importati} documenti.`);
          disegna();
        }, 'Importa');
      } catch (e) {
        toast(`File non valido: ${e.message}`, 'avviso');
      }
    });
    svuota(el,
      h('div', { class: 'testa-vista' }, h('div', null, h('p', { class: 'occhiello' }, 'Impostazioni'), h('h1', null, 'Il tavolo'))),
      h('section', { class: 'pannello' },
        h('header', null, h('h2', null, 'Gruppo dei PG'),
          bottone('Aggiungi PG', () => { salvaGruppo([...gruppo, { nome: '', livello: 1, ca: 12, pf: 10, note: '' }]); disegna(); }, { cls: 'piccolo', ico: 'piu' })),
        h('p', { style: { fontSize: '13px', color: 'var(--testo-3)' } }, 'Livello (per i Super Risvegliati) o Livello Equivalente (per i Risvegliati di Rank fisso): serve al budget degli incontri. PF e CA entrano nel tracker del combattimento.'),
        righe.length ? righe : h('p', { style: { color: 'var(--testo-2)' } }, 'Nessun PG: gli incontri usano un gruppo tipico di 4 PG per il Grado.')),
      h('div', { class: 'griglia-2', style: { marginTop: '16px' } },
        h('section', { class: 'pannello' }, h('h2', null, 'Aspetto'),
          h('div', { class: 'segmenti' }, [['scuro', 'Scuro'], ['chiaro', 'Chiaro']].map(([k, v]) => h('button', {
            type: 'button', class: (imp.tema || 'scuro') === k ? 'attivo' : '',
            onclick: () => { salvaImpostazioni({ tema: k }); try { localStorage.setItem('ag-tema', k); } catch { /* niente */ } document.documentElement.dataset.tema = k; disegna(); },
          }, v)))),
        h('section', { class: 'pannello' }, h('h2', null, 'Backup'),
          h('p', { style: { fontSize: '14px', color: 'var(--testo-2)' } }, 'Scarica tutti i tuoi dati (spedizioni, mappe modificate, mostri, note). Le immagini restano sul server.'),
          h('div', { class: 'riga' },
            bottone('Scarica backup', async () => {
              const dati = await esporta();
              const blob = new Blob([JSON.stringify(dati, null, 1)], { type: 'application/json' });
              const a = h('a', { href: URL.createObjectURL(blob), download: `ascension-gate-backup-${new Date().toISOString().slice(0, 10)}.json` });
              document.body.append(a);
              a.click();
              a.remove();
            }, { ico: 'scarica' }),
            h('label', { class: 'btn', for: 'importa-file' }, icona('carica'), h('span', null, 'Importa backup')), file))),
      h('section', { class: 'pannello', style: { marginTop: '16px' } }, h('h2', null, 'Accesso'),
        h('p', { style: { fontSize: '14px', color: 'var(--testo-2)' } }, 'La chiave del master apre tutto; quella dei giocatori apre solo la loro schermata (da aprire su un altro schermo o tablet). Le chiavi sono nel file CHIAVI.txt della cartella dell\'app.'),
        bottone('Esci da questo dispositivo', async () => { const m = await import('../app.js'); m.esciDalTavolo(); }, { cls: 'fantasma', ico: 'esci' })),
      h('section', { class: 'pannello', style: { marginTop: '16px' } }, h('h2', null, 'Crediti'),
        h('p', { style: { fontSize: '13px', color: 'var(--testo-2)' } }, S.dati.meta.licenza),
        h('p', { style: { fontSize: '13px', color: 'var(--testo-2)' } }, 'Demo pubblica: il dungeon "La Radice", le sezioni e le mappe sono di fantasia e scritti per questa dimostrazione. Il bestiario è quello dell\'SRD.')));
  };
  disegna();
  return null;
}
