import { addDays } from "./dates.js";

// File calendario (.ics, RFC 5545) con le scadenze: eventi di un giorno intero, ognuno con un promemoria
// alle 9 del giorno prima. Si apre con il calendario del telefono o del computer, che lo importa.
// L'UID di ogni evento non cambia tra un'esportazione e l'altra (per le stime vale il mese, vedi
// domain/calendar.js): reimportando, i calendari che lo supportano aggiornano gli eventi invece di duplicarli.
// Una scadenza che sparisce o cambia mese resta invece nel calendario: lo dice la pagina Previsioni.

// Testo di un campo: \ ; , e gli a capo vanno protetti.
export function icsText(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// Righe al massimo di 75 byte: le successive cominciano con uno spazio (senza spezzare i caratteri).
export function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = "", size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const max = out.length ? 74 : 75;
    if (size + n > max) {
      out.push(cur);
      cur = "";
      size = 0;
    }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.map((l, i) => (i ? " " + l : l)).join("\r\n");
}

const compact = (d) => d.replace(/-/g, "");

// events: [{ uid, date (AAAA-MM-GG), title, description, alarm ("before" o true = il giorno prima alle 9, "morning" = alle 9 del giorno) }]
// stamp: data e ora di creazione in UTC, es. "20261007T080000Z".
export function buildIcs(events, { name = "Scadenze Patrimonio", stamp } = {}) {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Patrimonio//Scadenze//IT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(name)}`,
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${icsText(e.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(e.date)}`,
      `DTEND;VALUE=DATE:${compact(addDays(e.date, 1))}`,
      `SUMMARY:${icsText(e.title)}`,
      ...(e.description ? [`DESCRIPTION:${icsText(e.description)}`] : []),
      "TRANSP:TRANSPARENT",
    );
    // "morning": alle 9 del giorno stesso; altrimenti alle 9 del giorno prima.
    if (e.alarm) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(e.title)}`, `TRIGGER:${e.alarm === "morning" ? "PT9H" : "-PT15H"}`, "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
