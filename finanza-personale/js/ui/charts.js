import { esc } from "../lib/html.js";
import { fmtEUR } from "../lib/format.js";

// Grafici SVG disegnati a mano: linee da 2px, aree al ~10%, barre ≤24px con estremità arrotondate,
// griglia a filo sottile, tooltip con cursore verticale (mouse, tocco e tastiera).

const observers = new Set();
let uid = 0;

export function disposeCharts() {
  for (const ro of observers) ro.disconnect();
  observers.clear();
}

function setup(el, draw) {
  let lastW = 0;
  const render = () => {
    const w = Math.round(el.clientWidth);
    if (!w || w === lastW) return;
    lastW = w;
    draw(w);
  };
  render();
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => render());
    ro.observe(el);
    observers.add(ro);
  }
}

function niceStep(range, count) {
  const raw = range / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

export function niceTicks(min, max, count = 4) {
  if (min === max) {
    const d = Math.abs(min) * 0.1 || 1;
    min -= d;
    max += d;
  }
  const step = niceStep(max - min, count);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

// Tooltip: testo inserito con textContent (le etichette sono dati dell'utente).
function tipFor(el) {
  let tip = el.querySelector(":scope > .chart-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.setAttribute("aria-hidden", "true");
    el.appendChild(tip);
  }
  return tip;
}

function showTip(el, x, y, title, rows) {
  const tip = tipFor(el);
  tip.replaceChildren();
  if (title) {
    const t = document.createElement("div");
    t.className = "tip-title";
    t.textContent = title;
    tip.appendChild(t);
  }
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "tip-row";
    if (r.color) {
      const k = document.createElement("span");
      k.className = "tip-key" + (r.shape === "box" ? " box" : "");
      k.style.background = r.color;
      row.appendChild(k);
    }
    const v = document.createElement("strong");
    v.textContent = r.value;
    row.appendChild(v);
    if (r.label) {
      const l = document.createElement("span");
      l.className = "tip-label";
      l.textContent = r.label;
      row.appendChild(l);
    }
    tip.appendChild(row);
  }
  tip.classList.add("show");
  const w = tip.offsetWidth, h = tip.offsetHeight, cw = el.clientWidth;
  const left = Math.max(w / 2 + 2, Math.min(cw - w / 2 - 2, x));
  const top = y - h - 12 < 0 ? y + 16 : y - h - 12;
  tip.style.left = left + "px";
  tip.style.top = top + "px";
}

function hideTip(el) {
  const tip = el.querySelector(":scope > .chart-tip");
  if (tip) tip.classList.remove("show");
}

// Il grafico si annuncia come immagine con una descrizione; resta focalizzabile per esplorarlo con le frecce.
function labelSvg(svg, summary) {
  if (!svg || !summary) return;
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", summary);
}

// ---------- mini linea di andamento (riquadri) ----------
export function sparkline(points, { width = 96, height = 28, color = "var(--ink-3)" } = {}) {
  if (!points || points.length < 2) return "";
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = 3;
  const x = (i) => pad + (i * (width - pad * 2)) / (points.length - 1);
  const y = (v) => pad + (height - pad * 2) * (hi === lo ? 0.5 : 1 - (v - lo) / (hi - lo));
  const d = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const li = vals.length - 1;
  return `<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="${d}" class="series-line muted" style="stroke:${color}"/><circle cx="${x(li).toFixed(1)}" cy="${y(vals[li]).toFixed(1)}" r="3" class="end-dot" style="fill:var(--series-1)"/></svg>`;
}

// ---------- area / linea nel tempo ----------
export function areaChart(el, opts) {
  const { points = [], height = 220, format = fmtEUR, color = "var(--series-1)", xFormat, summary } = opts;
  const id = `g${++uid}`;
  setup(el, (W) => {
    if (points.length < 2) {
      el.innerHTML = `<div class="chart-empty" style="height:${height}px">${esc(opts.emptyText || "Servono almeno due giorni di dati per il grafico.")}</div>`;
      return;
    }
    const H = height, padL = 6, padR = 62, padT = 14, padB = 28;
    const vals = points.map((p) => p.value);
    const ticks = niceTicks(Math.min(...vals), Math.max(...vals), 4);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const iw = W - padL - padR, ih = H - padT - padB;
    const x = (i) => padL + (i * iw) / (points.length - 1);
    const y = (v) => padT + ih - ((v - y0) / (y1 - y0 || 1)) * ih;
    const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
    const area = `${line}L${x(points.length - 1).toFixed(1)},${padT + ih}L${padL},${padT + ih}Z`;
    const grid = ticks.map((t) => `<line x1="${padL}" x2="${padL + iw}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" class="gridline"/><text x="${W - 4}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end" class="axis-label">${esc(fmtAxis(t, format, ticks[1] - ticks[0]))}</text>`).join("");
    const nLabels = Math.max(2, Math.min(6, Math.floor(iw / 90)));
    const idx = [...new Set(Array.from({ length: nLabels }, (_, k) => Math.round((k * (points.length - 1)) / (nLabels - 1))))];
    const xl = idx.map((i) => `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}" class="axis-label">${esc((xFormat || ((d) => d))(points[i].date))}</text>`).join("");
    const last = points.length - 1;
    el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" tabindex="0">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${color};stop-opacity:.16"/><stop offset="1" style="stop-color:${color};stop-opacity:0"/></linearGradient></defs>
      ${grid}
      ${y0 === 0 ? `<path d="${area}" style="fill:url(#${id})"/>` : ""}
      <path d="${line}" class="series-line" style="stroke:${color}"/>
      <circle cx="${x(last).toFixed(1)}" cy="${y(points[last].value).toFixed(1)}" r="4" class="end-dot" style="fill:${color}"/>
      <g class="hover" visibility="hidden"><line class="crosshair" y1="${padT}" y2="${padT + ih}"/><circle r="4.5" class="end-dot" style="fill:${color}"/></g>
      ${xl}
      <rect class="hit" x="${padL}" y="0" width="${iw}" height="${H}" fill="transparent"/>
    </svg>`;
    const svg = el.querySelector("svg");
    labelSvg(svg, summary);
    const hover = svg.querySelector(".hover");
    const cross = hover.querySelector("line");
    const dot = hover.querySelector("circle");
    let cur = last;
    const show = (i) => {
      cur = Math.max(0, Math.min(last, i));
      const px = x(cur), py = y(points[cur].value);
      cross.setAttribute("x1", px);
      cross.setAttribute("x2", px);
      dot.setAttribute("cx", px);
      dot.setAttribute("cy", py);
      hover.setAttribute("visibility", "visible");
      showTip(el, px, py, (opts.tipDate || xFormat || ((d) => d))(points[cur].date), [{ value: format(points[cur].value), color, label: opts.seriesLabel || "" }]);
    };
    const hide = () => { hover.setAttribute("visibility", "hidden"); hideTip(el); };
    const fromEvent = (e) => {
      const r = svg.getBoundingClientRect();
      return Math.round(((e.clientX - r.left - padL) / iw) * last);
    };
    svg.addEventListener("pointermove", (e) => show(fromEvent(e)));
    svg.addEventListener("pointerdown", (e) => show(fromEvent(e)));
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("focus", () => show(cur));
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") { show(cur - 1); e.preventDefault(); }
      else if (e.key === "ArrowRight") { show(cur + 1); e.preventDefault(); }
      else if (e.key === "Home") { show(0); e.preventDefault(); }
      else if (e.key === "End") { show(last); e.preventDefault(); }
    });
  });
}

// Etichette degli assi: abbreviate (2,4k) solo se il passo tra le tacche lo consente, altrimenti per esteso (2.410).
function fmtAxis(v, format, step = 1) {
  const a = Math.abs(v);
  const opt = (d) => ({ minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: "always" });
  if (a >= 1e6 && step >= 1e5) return (v / 1e6).toLocaleString("it-IT", { maximumFractionDigits: 1 }) + " Mln";
  if (a >= 1e4 && step >= 1e3) return (v / 1e3).toLocaleString("it-IT", { maximumFractionDigits: 0 }) + "k";
  if (a >= 1e3 && step >= 100) return (v / 1e3).toLocaleString("it-IT", { maximumFractionDigits: 1 }) + "k";
  return v.toLocaleString("it-IT", opt(step >= 1 ? 0 : step >= 0.1 ? 1 : 2));
}

function barPath(x, y, w, h, r) {
  if (h <= 0) return "";
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// ---------- barre raggruppate (entrate/uscite per mese) ----------
export function groupedBars(el, opts) {
  const { groups = [], height = 230, format = fmtEUR, onSelect, selected, summary } = opts;
  setup(el, (W) => {
    if (!groups.length) {
      el.innerHTML = `<div class="chart-empty" style="height:${height}px">Nessun dato nel periodo.</div>`;
      return;
    }
    const H = height, padL = 44, padR = 6, padT = 10, padB = 26;
    const max = Math.max(1, ...groups.flatMap((g) => g.values.map((v) => v.value)));
    const ticks = niceTicks(0, max, 4);
    const top = ticks[ticks.length - 1];
    const iw = W - padL - padR, ih = H - padT - padB;
    const band = iw / groups.length;
    const n = groups[0].values.length;
    const bw = Math.max(3, Math.min(24, (band * 0.7 - (n - 1) * 2) / n));
    const y = (v) => padT + ih - (v / top) * ih;
    let body = ticks.map((t) => `<line x1="${padL}" x2="${padL + iw}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" class="gridline"/><text x="${padL - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end" class="axis-label">${esc(fmtAxis(t, format, ticks[1] - ticks[0]))}</text>`).join("");
    groups.forEach((g, gi) => {
      const gx = padL + gi * band + (band - (n * bw + (n - 1) * 2)) / 2;
      const dim = selected && selected !== g.key ? " dim" : "";
      body += `<g class="bar-group${dim}" data-i="${gi}">`;
      g.values.forEach((v, vi) => {
        const h = Math.max(0, padT + ih - y(v.value));
        body += `<path d="${barPath(gx + vi * (bw + 2), y(v.value), bw, h, 4)}" style="fill:${v.color}"/>`;
      });
      body += `</g><text x="${(padL + gi * band + band / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="axis-label${selected === g.key ? " strong" : ""}">${esc(g.label)}</text>`;
      body += `<rect class="hit" data-i="${gi}" x="${(padL + gi * band).toFixed(1)}" y="${padT}" width="${band.toFixed(1)}" height="${ih}" fill="transparent"/>`;
    });
    el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" tabindex="0">${body}<line x1="${padL}" x2="${padL + iw}" y1="${padT + ih}" y2="${padT + ih}" class="baseline"/></svg>`;
    const svg = el.querySelector("svg");
    labelSvg(svg, summary);
    let cur = Math.max(0, groups.findIndex((g) => g.key === selected));
    const show = (i) => {
      cur = Math.max(0, Math.min(groups.length - 1, i));
      const g = groups[cur];
      svg.querySelectorAll(".bar-group").forEach((b) => b.classList.toggle("hovered", Number(b.dataset.i) === cur));
      const cx = padL + cur * band + band / 2;
      const peak = Math.max(...g.values.map((v) => v.value));
      showTip(el, cx, y(peak), g.title || g.label, g.values.map((v) => ({ value: format(v.value), label: v.name, color: v.color, shape: "box" })).concat(g.extra || []));
    };
    const hide = () => { svg.querySelectorAll(".bar-group.hovered").forEach((b) => b.classList.remove("hovered")); hideTip(el); };
    svg.querySelectorAll(".hit").forEach((r) => {
      r.addEventListener("pointerenter", () => show(Number(r.dataset.i)));
      r.addEventListener("pointerdown", () => show(Number(r.dataset.i)));
      r.addEventListener("click", () => onSelect && onSelect(groups[Number(r.dataset.i)].key));
    });
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("focus", () => show(cur));
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") { show(cur - 1); e.preventDefault(); }
      else if (e.key === "ArrowRight") { show(cur + 1); e.preventDefault(); }
      else if ((e.key === "Enter" || e.key === " ") && onSelect) { onSelect(groups[cur].key); e.preventDefault(); }
    });
  });
}

// ---------- linee a confronto (spesa cumulata: questo mese vs mese scorso) ----------
export function lineChart(el, opts) {
  const { series = [], count, height = 180, format = fmtEUR, xLabel = (i) => String(i + 1), summary } = opts;
  setup(el, (W) => {
    const all = series.flatMap((s) => s.values);
    if (!all.some((v) => v > 0)) {
      el.innerHTML = `<div class="chart-empty" style="height:${height}px">${esc(opts.emptyText || "Nessuna spesa registrata.")}</div>`;
      return;
    }
    const H = height, padL = 6, padR = 52, padT = 10, padB = 24;
    const ticks = niceTicks(0, Math.max(1, ...all), 3);
    const top = ticks[ticks.length - 1];
    const iw = W - padL - padR, ih = H - padT - padB;
    const n = Math.max(2, count);
    const x = (i) => padL + (i * iw) / (n - 1);
    const y = (v) => padT + ih - (v / top) * ih;
    let body = ticks.map((t) => `<line x1="${padL}" x2="${padL + iw}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" class="gridline"/><text x="${W - 4}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end" class="axis-label">${esc(fmtAxis(t, format, ticks[1] - ticks[0]))}</text>`).join("");
    for (const s of series) {
      if (!s.values.length) continue;
      const d = s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
      body += `<path d="${d}" class="series-line${s.muted ? " muted" : ""}" style="stroke:${s.color}"/>`;
      if (s.endDot) {
        const li = s.values.length - 1;
        body += `<circle cx="${x(li).toFixed(1)}" cy="${y(s.values[li]).toFixed(1)}" r="4" class="end-dot" style="fill:${s.color}"/>`;
      }
    }
    const marks = [0, Math.floor((n - 1) / 2), n - 1];
    body += marks.map((i) => `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}" class="axis-label">${esc(xLabel(i))}</text>`).join("");
    body += `<g class="hover" visibility="hidden"><line class="crosshair" y1="${padT}" y2="${padT + ih}"/></g><rect class="hit" x="${padL}" y="0" width="${iw}" height="${H}" fill="transparent"/>`;
    el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" tabindex="0">${body}</svg>`;
    const svg = el.querySelector("svg");
    labelSvg(svg, summary);
    const hover = svg.querySelector(".hover");
    const cross = hover.querySelector("line");
    let cur = Math.max(0, Math.max(...series.map((s) => s.values.length)) - 1);
    const show = (i) => {
      cur = Math.max(0, Math.min(n - 1, i));
      cross.setAttribute("x1", x(cur));
      cross.setAttribute("x2", x(cur));
      hover.setAttribute("visibility", "visible");
      const rows = series.filter((s) => s.values.length > cur).map((s) => ({ value: format(s.values[cur]), label: s.name, color: s.color }));
      const peak = Math.max(0, ...series.filter((s) => s.values.length > cur).map((s) => s.values[cur]));
      showTip(el, x(cur), y(peak), opts.tipTitle ? opts.tipTitle(cur) : xLabel(cur), rows);
    };
    const hide = () => { hover.setAttribute("visibility", "hidden"); hideTip(el); };
    const fromEvent = (e) => {
      const r = svg.getBoundingClientRect();
      return Math.round(((e.clientX - r.left - padL) / iw) * (n - 1));
    };
    svg.addEventListener("pointermove", (e) => show(fromEvent(e)));
    svg.addEventListener("pointerdown", (e) => show(fromEvent(e)));
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("focus", () => show(cur));
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") { show(cur - 1); e.preventDefault(); }
      else if (e.key === "ArrowRight") { show(cur + 1); e.preventDefault(); }
    });
  });
}

// ---------- ciambella (ripartizione) ----------
export function donutChart(el, opts) {
  const { slices = [], size = 176, format = fmtEUR, centerLabel = "Totale", summary } = opts;
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (!(total > 0)) {
    el.innerHTML = `<div class="chart-empty" style="height:${size}px">Nessun valore da mostrare.</div>`;
    return;
  }
  const R = size / 2, r = R - 20, cx = R, cy = R;
  let a0 = -Math.PI / 2;
  const paths = [];
  const visible = slices.filter((s) => s.value > 0);
  visible.forEach((s, i) => {
    const frac = s.value / total;
    const a1 = a0 + frac * Math.PI * 2;
    let d;
    if (frac >= 0.9999) {
      d = `M${cx},${cy - R}A${R},${R} 0 1 1 ${cx - 0.01},${cy - R}Z M${cx},${cy - r}A${r},${r} 0 1 0 ${cx + 0.01},${cy - r}Z`;
    } else {
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
      d = `M${p(R, a0)}A${R},${R} 0 ${large} 1 ${p(R, a1)}L${p(r, a1)}A${r},${r} 0 ${large} 0 ${p(r, a0)}Z`;
    }
    paths.push(`<path d="${d}" class="slice" data-i="${i}" fill-rule="evenodd" style="fill:${s.color}"/>`);
    a0 = a1;
  });
  el.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" tabindex="0">${paths.join("")}
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="donut-label">${esc(centerLabel)}</text>
    <text x="${cx}" y="${cy + 16}" text-anchor="middle" class="donut-value">${esc(opts.centerValue || format(total))}</text></svg>`;
  const svg = el.querySelector("svg");
    labelSvg(svg, summary);
  const show = (i, px, py) => {
    const s = visible[i];
    svg.querySelectorAll(".slice").forEach((p) => p.classList.toggle("dim", Number(p.dataset.i) !== i));
    showTip(el, px, py, s.label, [{ value: format(s.value), label: ((s.value / total) * 100).toLocaleString("it-IT", { maximumFractionDigits: 1 }) + "%", color: s.color, shape: "box" }]);
  };
  const hide = () => { svg.querySelectorAll(".slice").forEach((p) => p.classList.remove("dim")); hideTip(el); };
  svg.querySelectorAll(".slice").forEach((p) => {
    const handler = (e) => {
      const r = el.getBoundingClientRect();
      show(Number(p.dataset.i), e.clientX - r.left, e.clientY - r.top);
    };
    p.addEventListener("pointermove", handler);
    p.addEventListener("pointerdown", handler);
  });
  svg.addEventListener("pointerleave", hide);
  let cur = -1;
  svg.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    cur = (cur + (e.key === "ArrowRight" ? 1 : visible.length - 1)) % visible.length;
    show(cur, cx, 16);
    e.preventDefault();
  });
  svg.addEventListener("blur", hide);
}

// ---------- Sankey del flusso di cassa ----------
// opts.onSelect(voce): toccando una voce (rettangolo, etichetta o banda) o premendo Invio su quella evidenziata.
export function sankeyChart(el, model, opts = {}) {
  const { format = fmtEUR, colors = {}, summary, onSelect } = opts;
  setup(el, (W) => {
    const { sources, targets, hub } = model;
    if (!(hub > 0) || (!sources.length && !targets.length)) {
      el.innerHTML = `<div class="chart-empty" style="height:200px">Nessun movimento nel periodo.</div>`;
      return;
    }
    // Ogni nodo occupa almeno "minSlot" in altezza, così le etichette dei nodi piccoli non si sovrappongono;
    // il rettangolo resta proporzionale all'importo, centrato nel suo spazio.
    const nodeW = 10, gap = 8, minSlot = 30, padT = 8;
    const narrow = W < 520;
    const labelW = Math.min(narrow ? 104 : 150, W * 0.3);
    const baseH = opts.minHeight || 260;
    const rows = Math.max(sources.length, targets.length, 1);
    const k = (baseH - padT * 2 - (rows - 1) * gap) / hub;
    const slotOf = (n) => Math.max(n.amount * k, minSlot);
    const sideTotal = (list) => list.reduce((s, n) => s + slotOf(n), 0) + Math.max(0, list.length - 1) * gap;
    const H = Math.max(baseH, Math.max(sideTotal(sources), sideTotal(targets), hub * k) + padT * 2);
    const avail = H - padT * 2;
    const colorOf = (n) => colors[n.kind] || "var(--ink-3)";
    const place = (list) => {
      let yy = padT + (avail - sideTotal(list)) / 2;
      return list.map((n) => {
        const s = slotOf(n);
        const h = Math.max(2, n.amount * k);
        const node = { ...n, y: yy + (s - h) / 2, h };
        yy += s + gap;
        return node;
      });
    };
    const L = place(sources), Rn = place(targets);
    const xL = labelW, xH = W / 2 - nodeW / 2, xR = W - labelW - nodeW;
    const hubH = hub * k, hubY = padT + (avail - hubH) / 2;
    let links = "", nodes = "", labels = "", hits = "";
    // Area da toccare: tutto lo spazio della voce, etichetta compresa.
    const hit = (i, x, w, n) => {
      if (!onSelect) return;
      const s = slotOf(n);
      hits += `<rect class="sankey-hit" data-i="${i}" x="${x.toFixed(1)}" y="${(n.y - (s - n.h) / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${s.toFixed(1)}"/>`;
    };
    let yIn = hubY, yOut = hubY;
    const band = (x0, y0, h0, x1, y1, h1) => {
      const xm = (x0 + x1) / 2;
      return `M${x0},${y0}C${xm},${y0} ${xm},${y1} ${x1},${y1}V${y1 + h1}C${xm},${y1 + h1} ${xm},${y0 + h0} ${x0},${y0 + h0}Z`;
    };
    const items = [];
    L.forEach((n) => {
      const h = n.amount * k;
      items.push({ n, from: n.name, to: "Entrate" });
      links += `<path class="link" data-i="${items.length - 1}" d="${band(xL + nodeW, n.y, n.h, xH, yIn, h)}" style="fill:${colorOf(n)}"/>`;
      yIn += h;
      nodes += `<rect x="${xL}" y="${n.y.toFixed(1)}" width="${nodeW}" height="${n.h.toFixed(1)}" rx="2" style="fill:${colorOf(n)}"/>`;
      labels += nodeLabel(xL - 8, n.y + n.h / 2, "end", n.name, format(n.amount), labelW - 12);
      hit(items.length - 1, 0, xL + nodeW, n);
    });
    Rn.forEach((n) => {
      const h = n.amount * k;
      items.push({ n, from: "Entrate", to: n.name });
      links += `<path class="link" data-i="${items.length - 1}" d="${band(xH + nodeW, yOut, h, xR, n.y, n.h)}" style="fill:${colorOf(n)}"/>`;
      yOut += h;
      nodes += `<rect x="${xR}" y="${n.y.toFixed(1)}" width="${nodeW}" height="${n.h.toFixed(1)}" rx="2" style="fill:${colorOf(n)}"/>`;
      labels += nodeLabel(xR + nodeW + 8, n.y + n.h / 2, "start", n.name, format(n.amount), labelW - 12);
      hit(items.length - 1, xR, W - xR, n);
    });
    nodes += `<rect x="${xH}" y="${hubY.toFixed(1)}" width="${nodeW}" height="${hubH.toFixed(1)}" rx="2" style="fill:var(--ink-2)"/>`;
    el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" tabindex="0"${onSelect ? ' class="selectable"' : ""}>${links}${nodes}${labels}${hits}</svg>`;
    const svg = el.querySelector("svg");
    labelSvg(svg, summary);
    const paths = [...svg.querySelectorAll(".link")];
    const show = (i, px, py) => {
      paths.forEach((p) => p.classList.toggle("active", Number(p.dataset.i) === i));
      svg.classList.add("focusing");
      const it = items[i];
      showTip(el, px, py, `${it.from} → ${it.to}`, [{ value: format(it.n.amount), label: `${((it.n.amount / hub) * 100).toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`, color: colorOf(it.n), shape: "box" }]);
    };
    const hide = () => { svg.classList.remove("focusing"); paths.forEach((p) => p.classList.remove("active")); hideTip(el); };
    [...svg.querySelectorAll(".link, .sankey-hit")].forEach((p) => {
      const h = (e) => {
        const r = el.getBoundingClientRect();
        show(Number(p.dataset.i), e.clientX - r.left, e.clientY - r.top);
      };
      p.addEventListener("pointermove", h);
      p.addEventListener("pointerdown", h);
      if (onSelect) p.addEventListener("click", () => { hide(); onSelect(items[Number(p.dataset.i)].n); });
    });
    svg.addEventListener("pointerleave", hide);
    let cur = -1;
    svg.addEventListener("keydown", (e) => {
      if (onSelect && cur >= 0 && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        hide();
        onSelect(items[cur].n);
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      cur = (cur + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      show(cur, W / 2, 20);
      e.preventDefault();
    });
    svg.addEventListener("blur", hide);
  });
}

function nodeLabel(x, cy, anchor, name, value, maxW) {
  const maxChars = Math.max(6, Math.floor(maxW / 7));
  const shown = name.length > maxChars ? name.slice(0, maxChars - 1) + "…" : name;
  return `<text x="${x.toFixed(1)}" y="${(cy - 2).toFixed(1)}" text-anchor="${anchor}" class="node-name">${esc(shown)}</text><text x="${x.toFixed(1)}" y="${(cy + 12).toFixed(1)}" text-anchor="${anchor}" class="node-value">${esc(value)}</text>`;
}

// ---------- più linee nel tempo (previsione, patrimonio, proiezioni) ----------
// series: [{ name, color, points: [{ date, value }], dashed, area }]. Le serie si allineano per data;
// con "zero" l'asse comprende sempre lo zero, segnato da una linea più marcata se i valori lo attraversano.
export function multiLineChart(el, opts) {
  const { series = [], height = 240, format = fmtEUR, xFormat = (d) => d, summary, zero = true } = opts;
  const id = `g${++uid}`;
  setup(el, (W) => {
    const drawn = series.filter((s) => s.points && s.points.length);
    const dates = [...new Set(drawn.flatMap((s) => s.points.map((p) => p.date)))].sort();
    if (dates.length < 2) {
      el.innerHTML = `<div class="chart-empty" style="height:${height}px">${esc(opts.emptyText || "Servono almeno due punti per il grafico.")}</div>`;
      return;
    }
    const at = new Map(dates.map((d, i) => [d, i]));
    const vals = drawn.flatMap((s) => s.points.map((p) => p.value));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    const ticks = niceTicks(lo, hi, 4);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const H = height, padL = 6, padR = 62, padT = 14, padB = 28;
    const iw = W - padL - padR, ih = H - padT - padB;
    const last = dates.length - 1;
    // Asse orizzontale per data, non per posizione: giorni mancanti (es. storico del patrimonio) restano larghi quanto sono.
    const times = dates.map((d) => Date.parse(`${d}T00:00:00Z`));
    const t0 = times[0], span = times[last] - t0 || 1;
    const x = (i) => padL + ((times[i] - t0) * iw) / span;
    const nearest = (tt) => { let b = 0; for (let i = 1; i <= last; i++) if (Math.abs(times[i] - tt) < Math.abs(times[b] - tt)) b = i; return b; };
    const y = (v) => padT + ih - ((v - y0) / (y1 - y0 || 1)) * ih;
    const step = ticks[1] - ticks[0];
    let body = ticks.map((t) => `<line x1="${padL}" x2="${padL + iw}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" class="gridline"/><text x="${W - 4}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end" class="axis-label">${esc(fmtAxis(t, format, step))}</text>`).join("");
    if (y0 < 0 && y1 > 0) body += `<line x1="${padL}" x2="${padL + iw}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="baseline"/>`;
    let defs = "";
    drawn.forEach((s, k) => {
      const pts = s.points.map((p) => [x(at.get(p.date)), y(p.value)]);
      const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
      if (s.area && y0 === 0) {
        defs += `<linearGradient id="${id}-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${s.color};stop-opacity:.14"/><stop offset="1" style="stop-color:${s.color};stop-opacity:0"/></linearGradient>`;
        body += `<path d="${d}L${pts[pts.length - 1][0].toFixed(1)},${padT + ih}L${pts[0][0].toFixed(1)},${padT + ih}Z" style="fill:url(#${id}-${k})"/>`;
      }
      body += `<path d="${d}" class="series-line${s.muted ? " muted" : ""}" style="stroke:${s.color}${s.dashed ? ";stroke-dasharray:5 4" : ""}"/>`;
    });
    const mk = opts.marker;
    if (mk && at.has(mk.date)) {
      const mx = x(at.get(mk.date)), my = y(mk.value);
      const anchor = mx < padL + 60 ? "start" : mx > padL + iw - 60 ? "end" : "middle";
      const ly = my + 20 > padT + ih ? my - 10 : my + 20;
      body += `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="4" class="end-dot" style="fill:${mk.color || "var(--ink-2)"}"/><text x="${mx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" class="axis-label strong">${esc(mk.label)}</text>`;
    }
    const nLabels = Math.max(2, Math.min(6, Math.floor(iw / 90)));
    const cand = [...new Set(Array.from({ length: nLabels }, (_, k) => nearest(t0 + (k * span) / (nLabels - 1))))];
    // Etichette ad almeno 48px l'una dall'altra; l'ultima data resta sempre.
    const marks = [];
    for (const i of cand) { if (marks.length && x(i) - x(marks[marks.length - 1]) < 48) { if (i === last) marks[marks.length - 1] = i; continue; } marks.push(i); }
    body += marks.map((i) => `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === last ? "end" : "middle"}" class="axis-label">${esc(xFormat(dates[i]))}</text>`).join("");
    body += `<g class="hover" visibility="hidden"><line class="crosshair" y1="${padT}" y2="${padT + ih}"/></g><rect class="hit" x="${padL}" y="0" width="${iw}" height="${H}" fill="transparent"/>`;
    el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" tabindex="0">${defs ? `<defs>${defs}</defs>` : ""}${body}</svg>`;
    const svg = el.querySelector("svg");
    labelSvg(svg, summary);
    const hover = svg.querySelector(".hover");
    const cross = hover.querySelector("line");
    const byDate = drawn.map((s) => new Map(s.points.map((p) => [p.date, p.value])));
    let cur = last;
    const show = (i) => {
      cur = Math.max(0, Math.min(last, i));
      const d = dates[cur];
      cross.setAttribute("x1", x(cur));
      cross.setAttribute("x2", x(cur));
      hover.setAttribute("visibility", "visible");
      const rows = drawn.map((s, k) => (byDate[k].has(d) ? { value: format(byDate[k].get(d)), label: s.name, color: s.color } : null)).filter(Boolean);
      const top = Math.max(...drawn.map((s, k) => (byDate[k].has(d) ? byDate[k].get(d) : -Infinity)));
      showTip(el, x(cur), y(Number.isFinite(top) ? top : y1), (opts.tipDate || xFormat)(d), rows);
    };
    const hide = () => { hover.setAttribute("visibility", "hidden"); hideTip(el); };
    const fromEvent = (e) => {
      const r = svg.getBoundingClientRect();
      return nearest(t0 + ((e.clientX - r.left - padL) / iw) * span);
    };
    svg.addEventListener("pointermove", (e) => show(fromEvent(e)));
    svg.addEventListener("pointerdown", (e) => show(fromEvent(e)));
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("focus", () => show(cur));
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") { show(cur - 1); e.preventDefault(); }
      else if (e.key === "ArrowRight") { show(cur + 1); e.preventDefault(); }
      else if (e.key === "Home") { show(0); e.preventDefault(); }
      else if (e.key === "End") { show(last); e.preventDefault(); }
    });
  });
}
