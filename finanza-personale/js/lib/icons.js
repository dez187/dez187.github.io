import { raw } from "./html.js";

// Icone a tratto su griglia 24×24.
const PATHS = {
  home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v10.5a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><rect x="3.5" y="8" width="17" height="11.5" rx="2.5"/><path d="M16 14h1.5"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" stroke-width="2.6"/>',
  flow: '<path d="M7 18V5M3.5 8.5 7 5l3.5 3.5"/><path d="M17 6v13M13.5 15.5 17 19l3.5-3.5"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12h.01" stroke-width="2.6"/>',
  trend: '<path d="m3.5 16.5 5.5-5.5 4 4 7.5-7.5"/><path d="M15 7.5h5.5V13"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3"/>',
  chevronLeft: '<path d="m14.5 18-6-6 6-6"/>',
  chevronRight: '<path d="m9.5 18 6-6-6-6"/>',
  chevronDown: '<path d="m6 9.5 6 6 6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  pencil: '<path d="M4 20h4.2L19 9.2a2.9 2.9 0 0 0-4.2-4.2L4 15.8V20z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.8 12.2a1 1 0 0 0 1 .8h7.4a1 1 0 0 0 1-.8L17.5 7M9.5 7V4.5h5V7"/>',
  refresh: '<path d="M19.5 11A7.5 7.5 0 0 0 6.2 6.8L4.5 8.5"/><path d="M4.5 4v4.5H9"/><path d="M4.5 13a7.5 7.5 0 0 0 13.3 4.2l1.7-1.7"/><path d="M19.5 20v-4.5H15"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  upload: '<path d="M12 20V9M7.5 13.5 12 9l4.5 4.5M5 4.5h14"/>',
  logout: '<path d="M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3"/><path d="M10 16.5 5.5 12 10 7.5M5.5 12H16"/>',
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2M12 19.2v2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M2.8 12h2M19.2 12h2M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>',
  moon: '<path d="M19.5 14.5A7.8 7.8 0 1 1 9.5 4.5a6.3 6.3 0 0 0 10 10z"/>',
  monitor: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/>',
  bank: '<path d="M3.5 9.5 12 4l8.5 5.5"/><path d="M5.5 10v7.5M10 10v7.5M14 10v7.5M18.5 10v7.5M3.5 20h17"/>',
  vault: '<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 8.5v1M12 14.5v1M8.5 12h1M14.5 12h1"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01" stroke-width="2.6"/>',
  repeat: '<path d="m16.5 3 3.5 3.5-3.5 3.5"/><path d="M4 11.5V10a3.5 3.5 0 0 1 3.5-3.5H20"/><path d="m7.5 21-3.5-3.5L7.5 14"/><path d="M20 12.5V14a3.5 3.5 0 0 1-3.5 3.5H4"/>',
  transfer: '<path d="m16 3.5 4 4-4 4M20 7.5H5"/><path d="m8 20.5-4-4 4-4M4 16.5h15"/>',
  alert: '<path d="M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5M12 17h.01"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8h.01"/>',
  dots: '<path d="M5.5 12h.01M12 12h.01M18.5 12h.01" stroke-width="3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9.5H7z"/>',
  cloudOff: '<path d="M3 3l18 18"/><path d="M9.5 6.2A6 6 0 0 1 18 9a4.5 4.5 0 0 1 2.1 8.3M17.5 18.5H7a4.5 4.5 0 0 1-.9-8.9"/>',
  percent: '<path d="M18.5 5.5 5.5 18.5"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
  coins: '<circle cx="9" cy="9" r="5.5"/><path d="M14.8 9.6a5.5 5.5 0 1 1-5.2 5.2"/>',
  pie: '<path d="M12 3.5v8.5h8.5"/><path d="M20.5 12A8.5 8.5 0 1 1 12 3.5"/>',
  layers: '<path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8 12 3.5z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/><path d="m3.5 16.5 8.5 4.5 8.5-4.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
  play: '<path d="M7.5 5.5v13l10.5-6.5-10.5-6.5z"/>',
  skip: '<path d="M6 5.5v13l9-6.5-9-6.5zM18 5.5v13"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  shield: '<path d="M12 3.5 19 6v6c0 4.5-3 7.5-7 8.5-4-1-7-4-7-8.5V6l7-2.5z"/>',
  file: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5L14 3.5z"/><path d="M14 3.5v5h5"/>',
  arrowUpRight: '<path d="M7 17 17 7M8.5 7H17v8.5"/>',
  arrowDownRight: '<path d="M7 7l10 10M17 8.5V17H8.5"/>',
  tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.3 7.3a1 1 0 0 1-1.4 0L3.5 12.2z"/><path d="M8 8h.01" stroke-width="2.6"/>',
  flag: '<path d="M5.5 21V4"/><path d="M5.5 4.5h11.5l-2.2 4.2 2.2 4.3H5.5"/>',
  bolt: '<path d="M13.2 3 5.5 13.2h6L10.8 21l7.7-10.2h-6L13.2 3z"/>',
  forecast: '<path d="M3.5 20h17"/><path d="m3.5 15.5 4-4 3 2.5 3.5-4"/><path d="m15.5 8.5 2-1.5 3 1" stroke-dasharray="1.6 2.2"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
};

export function icon(name, size = 20, cls = "") {
  return raw(
    `<svg class="icon${cls ? " " + cls : ""}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name] || ""}</svg>`
  );
}

export function logo(size = 28) {
  return raw(
    `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="9" fill="var(--accent)"/><path d="M9 22.5v-4.5M14 22.5v-8.5M19 22.5V11M24 22.5V8.5" stroke="var(--on-accent)" stroke-width="3" stroke-linecap="round"/></svg>`
  );
}

export function googleLogo(size = 18) {
  return raw(
    `<svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`
  );
}
