import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";

// Scelta dell'icona (un'emoji) di categorie e obiettivi: un pulsante che apre un menu di icone a gruppi,
// più un campo per scriverne o incollarne una qualsiasi. Il valore sta in un campo nascosto con il nome
// del campo, così il modulo lo legge come gli altri.

export const EMOJI_GROUPS = [
  ["Casa e bollette", ["🏠", "🏡", "🏢", "🛋️", "🛏️", "🔑", "🔧", "🧹", "🧺", "💡", "🔥", "💧", "📶", "📱", "💻", "📺", "🧾"]],
  ["Spesa e cibo", ["🛒", "🥦", "🍎", "🥖", "🧀", "🍕", "🍔", "🍣", "🍝", "🍽️", "☕", "🍺", "🍷", "🍸", "🧁", "🍫"]],
  ["Trasporti e viaggi", ["🚗", "🚙", "🏍️", "🚲", "🛴", "🚌", "🚆", "🚇", "🚕", "⛽", "🅿️", "✈️", "🚢", "🧳", "🏨", "🗺️", "🏖️", "⛰️"]],
  ["Salute e cura", ["💊", "🏥", "🩺", "🦷", "👓", "💪", "🧘", "💇", "💅", "🧴"]],
  ["Svago e sport", ["🎬", "🎮", "🎵", "🎧", "🎨", "📚", "🎟️", "🎲", "🧩", "🃏", "🧙", "🎤", "⚽", "🏋️", "🎾", "🏊", "🚴", "🎳"]],
  ["Shopping e regali", ["🛍️", "👕", "👗", "👟", "👜", "💄", "💍", "🎁", "📦", "🪴"]],
  ["Famiglia e animali", ["👶", "🧸", "🎒", "🏫", "🎓", "🐶", "🐱", "🐾", "🐟", "🐴"]],
  ["Soldi e lavoro", ["💶", "💰", "💳", "🏦", "📈", "📉", "💼", "🧮", "📄", "🪙", "💸", "🎉", "↩️", "🤝", "🏛️", "⚖️"]],
  ["Altro", ["🏷️", "⭐", "❤️", "🎯", "🔁", "📌", "⚙️", "🛡️", "🔒", "📮", "☂️", "🌱", "♻️", "❓"]],
];

export const EMOJI_MAX = 8; // abbastanza per le emoji composte (es. 👨‍👩‍👧)

// f: { key, label, placeholder }; value: l'emoji salvata (può essere vuota).
export function emojiFieldHTML(f, value) {
  const id = `f-${f.key}`;
  const v = value || "";
  const shown = v || f.placeholder || "🏷️";
  return html`<div class="field wide emoji-field" data-emoji-field data-placeholder="${f.placeholder || "🏷️"}">
    <span class="field-label" id="${id}-label">${f.label}</span>
    <input type="hidden" id="${id}" name="${f.key}" value="${v}">
    <button type="button" class="input emoji-btn" data-emoji-toggle aria-expanded="false" aria-controls="${id}-panel" aria-labelledby="${id}-label ${id}-current"><span class="emoji-current" id="${id}-current">${shown}</span><span class="emoji-btn-text">Scegli</span>${icon("chevronDown", 18)}</button>
    <div class="emoji-panel" id="${id}-panel" data-emoji-panel role="group" aria-label="Icone" hidden>
      ${EMOJI_GROUPS.map(([name, list]) => html`<p class="emoji-group">${name}</p><div class="emoji-grid">${list.map((e) => html`<button type="button" class="emoji-opt" data-emoji="${e}" aria-pressed="${e === v}" aria-label="Icona ${e}" tabindex="-1">${e}</button>`)}</div>`)}
      <label class="field emoji-custom" for="${id}-custom"><span class="field-label">Oppure scrivi o incolla un'emoji</span><input class="input" id="${id}-custom" data-emoji-custom type="text" maxlength="${EMOJI_MAX}" autocomplete="off" value="${v && !EMOJI_GROUPS.some(([, list]) => list.includes(v)) ? v : ""}"></label>
    </div>
  </div>`;
}

// Collega i menu di icone di un modulo. Su ogni contenitore resta box._picker = { set, suggest }:
// suggest cambia l'icona solo finché non ne è stata scelta una (es. proposta dal nome della categoria).
export function wireEmojiFields(root) {
  for (const box of root.querySelectorAll("[data-emoji-field]")) {
    const input = box.querySelector('input[type="hidden"]');
    const toggle = box.querySelector("[data-emoji-toggle]");
    const panel = box.querySelector("[data-emoji-panel]");
    const current = box.querySelector(".emoji-current");
    const custom = box.querySelector("[data-emoji-custom]");
    const opts = [...panel.querySelectorAll("[data-emoji]")];
    let chosen = !!input.value;
    const roving = () => {
      const on = opts.find((b) => b.getAttribute("aria-pressed") === "true") || opts[0];
      for (const b of opts) b.tabIndex = b === on ? 0 : -1;
      return on;
    };
    const set = (v, byUser = true) => {
      input.value = v;
      current.textContent = v || box.dataset.placeholder;
      for (const b of opts) b.setAttribute("aria-pressed", String(b.dataset.emoji === v));
      roving();
      if (byUser) chosen = true;
    };
    const open = (yes) => {
      panel.hidden = !yes;
      toggle.setAttribute("aria-expanded", String(yes));
      if (yes) roving().focus();
    };
    roving();
    toggle.addEventListener("click", () => open(panel.hidden));
    // Esc con il menu aperto chiude il menu, non la finestra.
    const dlg = box.closest("dialog");
    if (dlg) dlg.addEventListener("cancel", (e) => { if (!panel.hidden) { e.preventDefault(); open(false); toggle.focus(); } });
    panel.addEventListener("click", (e) => {
      const b = e.target.closest("[data-emoji]");
      if (!b) return;
      set(b.dataset.emoji);
      custom.value = "";
      open(false);
      toggle.focus();
    });
    custom.addEventListener("input", () => {
      const v = custom.value.trim();
      if (v) set(v);
    });
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        // Chiude solo il menu, non la finestra.
        e.preventDefault();
        e.stopPropagation();
        open(false);
        toggle.focus();
        return;
      }
      const i = opts.indexOf(document.activeElement);
      if (i < 0) return;
      const grid = document.activeElement.parentElement;
      const cols = Math.max(1, Math.round(grid.clientWidth / (document.activeElement.offsetWidth || 44)));
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -i, End: opts.length - 1 - i }[e.key];
      if (step == null) return;
      e.preventDefault();
      const next = opts[Math.max(0, Math.min(opts.length - 1, i + step))];
      for (const b of opts) b.tabIndex = b === next ? 0 : -1;
      next.focus();
    });
    box._picker = { set, suggest: (v) => { if (!chosen) set(v, false); } };
  }
}
