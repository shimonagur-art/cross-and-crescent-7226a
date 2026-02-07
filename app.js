// ==============================
// Cross & Crescent - app.js (DATA-DRIVEN)
// Basemap: CARTO light_nolabels (clean, no labels)
// Overlay: hrmap.png (handwritten) aligned by geo bounds
// Controls: ONE tiny "Show/Hide basemap" button aligned with the 3 category dots
// ==============================

const periodRange = document.getElementById("periodRange");
const periodValue = document.getElementById("periodValue");
const panelTitle = document.getElementById("panelTitle");
const panelBody = document.getElementById("panelBody");

let map = null;
let markersLayer = null;
let routesLayer = null;

let PERIODS = [];
let OBJECTS_BY_ID = new Map();

let selectedMarker = null;
let isTransitioning = false;
let renderToken = 0;

// ===== Overlay settings =====
const HRMAP_URL = "images/hrmap.png";

// 🔧 Adjust these corners to align the overlay to geo space
// Format: [[southLat, westLng], [northLat, eastLng]]
let HRMAP_BOUNDS = [
  [18, -15], // south, west
  [62, 52]   // north, east
];

let baseLayer = null;
let hrOverlay = null;

function setPanel(title, html) {
  panelTitle.textContent = title;
  panelBody.innerHTML = html;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * ✅ Ensure exactly ONE basemap toggle exists, and place it
 * on the same top row as the 3 category dots (CCC).
 */
function ensureMapControls() {
  // Remove any duplicates from previous experiments (if they exist)
  const existingControls = document.querySelectorAll("#hrmapControls");
  if (existingControls.length > 1) {
    existingControls.forEach((el, i) => {
      if (i > 0) el.remove();
    });
  }

  const existingButtons = document.querySelectorAll("#btnToggleBase");
  if (existingButtons.length > 1) {
    existingButtons.forEach((el, i) => {
      if (i > 0) el.remove();
    });
  }

  // If we already have a single control, just (re)place it correctly and wire it
  let wrap = document.getElementById("hrmapControls");
  let btnBase = document.getElementById("btnToggleBase");

  if (!wrap) {
    wrap = document.createElement("span");
    wrap.id = "hrmapControls";
    wrap.style.cssText = `
      display: inline-flex;
      align-items: center;
      margin-right: 10px;
    `;
  }

  if (!btnBase) {
    btnBase = document.createElement("button");
    btnBase.id = "btnToggleBase";
    btnBase.type = "button";
    btnBase.textContent = "Show basemap";
    btnBase.className = "miniBtn";
    // Tiny styling inline so it works even before CSS changes
    btnBase.style.cssText = `
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid #d6d6d6;
      background: #fff;
      cursor: pointer;
      font: 12px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      line-height: 1;
      white-space: nowrap;
    `;
    wrap.appendChild(btnBase);
  } else {
    // ensure button is inside wrapper
    if (!wrap.contains(btnBase)) wrap.appendChild(btnBase);
  }

  // ✅ Place on the SAME ROW as the 3 dots
  // That row is the first ".legend__row" (Category key)
  const topLegendRow = document.querySelector(".legend .legend__row");
  if (topLegendRow) {
    // put it at the start of the row (so it sits left of CCC)
    if (wrap.parentElement !== topLegendRow) {
      topLegendRow.insertBefore(wrap, topLegendRow.firstChild);
    }
  } else {
    // fallback: place near the legend
    const legend = document.querySelector(".legend");
    if (legend && wrap.parentElement !== legend) legend.insertBefore(wrap, legend.firstChild);
  }

  // Avoid double-binding click events
  if (!btnBase.__wired) {
    btnBase.__wired = true;

    // Default: basemap OFF (handwritten-only view)
    if (baseLayer && map && map.hasLayer(baseLayer)) {
      map.removeLayer(baseLayer);
      btnBase.textContent = "Show basemap";
    }

    btnBase.addEventListener("click", () => {
      if (!baseLayer || !map) return;

      if (map.hasLayer(baseLayer)) {
        map.removeLayer(baseLayer);
        btnBase.textContent = "Show basemap";
      } else {
        baseLayer.addTo(map);
        btnBase.textContent = "Hide basemap";
      }
    });
  }
}

function initMap() {
  // Keep setView (we'll tune view later if needed)
  map = L.map("map", { scrollWheelZoom: false }).setView([44.5, 8.5], 4);

  // Clean, label-free basemap
  baseLayer = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
    { maxZoom: 20, subdomains: "abcd", attribution: "" }
  ).addTo(map);

  // Handwritten overlay
  hrOverlay = L.imageOverlay(HRMAP_URL, HRMAP_BOUNDS, { opacity: 0.7 }).addTo(map);
  hrOverlay.on("error", () => console.error("❌ hrmap overlay failed to load:", HRMAP_URL));

  markersLayer = L.layerGroup().addTo(map);
  routesLayer = L.layerGroup().addTo(map);

  // Build/position the single toggle
  ensureMapControls();
}

function clearLayers() {
  markersLayer.clearLayers();
  routesLayer.clearLayers();
  selectedMarker = null;
}

function updateActiveBand(index) {
  document.querySelectorAll(".bands span").forEach(el => {
    el.classList.toggle("active", Number(el.dataset.index) === index);
  });
}

function updatePeriodUI(index) {
  const p = PERIODS[index];
  if (!p) return;
  const start = p.yearStart ?? "";
  const end = p.yearEnd ?? "";
  periodValue.textContent = `${p.label} (${start}–${end})`;
}

// --- Color / style helpers ---
function routeColor(influence) {
  const v = String(influence || "").trim().toLowerCase();
  if (v === "christianity") return "#d32f2f";
  if (v === "islam") return "#2e7d32";
  return "#5e35b1";
}

function categoryColor(category) {
  const v = String(category || "").trim().toLowerCase();
  if (v === "cultural") return "#2b6cb0";
  if (v === "commercial") return "#2f855a";
  if (v === "conquest") return "#c53030";
  return "#0b4f6c";
}

function markerStyleBase(color) {
  return { radius: 11, weight: 0, opacity: 0, color, fillColor: color, fillOpacity: 0.65 };
}
function markerStyleHover(color) {
  return { radius: 12, weight: 0, opacity: 0, color, fillColor: color, fillOpacity: 0.95 };
}
function markerStyleSelected(color) {
  return { radius: 12, weight: 0, opacity: 0, color, fillColor: color, fillOpacity: 1 };
}

// --- Fade helpers ---
function easeLinear(t) { return t; }

function animateStyle(layer, from, to, durationMs = 300, onDone) {
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / durationMs);
    const e = easeLinear(t);

    const cur = {};
    for (const k of Object.keys(to)) {
      const a = (from[k] ?? 0);
      const b = to[k];
      cur[k] = a + (b - a) * e;
    }
    layer.setStyle(cur);

    if (t < 1) requestAnimationFrame(tick);
    else if (onDone) onDone();
  }
  requestAnimationFrame(tick);
}

function fadeOutLayers(markersLayer, routesLayer, durationMs = 220) {
  const markers = [];
  markersLayer.eachLayer(l => markers.push(l));
  const routes = [];
  routesLayer.eachLayer(l => routes.push(l));

  for (const m of markers) {
    const from = {
      fillOpacity: (typeof m.options?.fillOpacity === "number") ? m.options.fillOpacity : 0.5,
      opacity: (typeof m.options?.opacity === "number") ? m.options.opacity : 1
    };
    animateStyle(m, from, { fillOpacity: 0, opacity: 0 }, durationMs);
  }

  for (const r of routes) {
    const from = { opacity: (typeof r.options?.opacity === "number") ? r.options.opacity : 0.9 };
    animateStyle(r, from, { opacity: 0 }, durationMs);
  }

  return new Promise(resolve => setTimeout(resolve, durationMs));
}

function fadeInMarker(marker, targetFillOpacity, durationMs = 450) {
  marker.setStyle({ fillOpacity: 0, opacity: 0 });
  animateStyle(marker, { fillOpacity: 0, opacity: 0 }, { fillOpacity: targetFillOpacity, opacity: 1 }, durationMs);
}

// --- Route crawl ---
async function animateRouteCrawl(polyline, { fromLatLng, toLatLng, durationMs = 1500, delayMs = 0, token } = {}) {
  if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  if (token !== renderToken) return;

  const start = performance.now();
  function frame(now) {
    if (token !== renderToken) return;

    const t = Math.min(1, (now - start) / durationMs);
    const e = easeLinear(t);

    const lat = fromLatLng.lat + (toLatLng.lat - fromLatLng.lat) * e;
    const lng = fromLatLng.lng + (toLatLng.lng - fromLatLng.lng) * e;

    polyline.setLatLngs([fromLatLng, L.latLng(lat, lng)]);

    if (t < 1) requestAnimationFrame(frame);
    else polyline.setLatLngs([fromLatLng, toLatLng]);
  }
  requestAnimationFrame(frame);
}

// --- Hover tooltip ---
function buildHoverHTML(obj) {
  const title = escapeHtml(obj?.title || obj?.id || "Object");
  const thumb = String(obj?.hover?.thumb || "").trim();
  const yearRaw = obj?.hover?.year ?? obj?.year ?? "";
  const year = yearRaw ? escapeHtml(yearRaw) : "";

  const imgHtml = thumb ? `<img class="hover-thumb" src="${escapeHtml(thumb)}" alt="${title}" />` : "";

  return `
    <div class="hover-card">
      ${imgHtml}
      <div class="hover-meta">
        <div class="hover-title">${title}</div>
        ${year ? `<div class="hover-year">${year}</div>` : ""}
      </div>
    </div>
  `;
}

// --- Right panel ---
function buildPanelHTML(obj, period) {
  const title = escapeHtml(obj?.title || obj?.id || "Object");
  const subtitle = escapeHtml(obj?.panel?.subtitle || "");
  const body = escapeHtml(obj?.panel?.body || "");

  const tags = Array.isArray(obj?.tags) ? obj.tags : [];
  const tagHtml = tags.length ? `<p><strong>Tags:</strong> ${tags.map(t => escapeHtml(t)).join(", ")}</p>` : "";

  const locs = Array.isArray(obj?.locations) ? obj.locations : [];
  const locHtml = locs.length
    ? `<p><strong>Locations:</strong> ${locs.map(l => escapeHtml(l.label || "")).filter(Boolean).join(", ")}</p>`
    : "";

  const pLabel = escapeHtml(period?.label || "");
  const pStart = escapeHtml(period?.yearStart ?? "");
  const pEnd = escapeHtml(period?.yearEnd ?? "");

  const images = Array.isArray(obj?.panel?.images) ? obj.panel.images : [];
  const imagesHtml = images.length
    ? `<div class="panel-images">${images.filter(Boolean).map(src => `<img class="panel-img" src="${escapeHtml(src)}" alt="${title}" />`).join("")}</div>`
    : "";

  return `
    <p><strong>Selected period:</strong> ${pLabel} (${pStart}–${pEnd})</p>
    ${subtitle ? `<h3>${subtitle}</h3>` : ""}
    ${tagHtml}
    ${locHtml}
    ${body ? `<p>${body}</p>` : ""}
    ${imagesHtml}
  `;
}

// --- Data loading ---
async function loadData() {
  const [objectsRes, periodsRes] = await Promise.all([
    fetch("data/objects.json", { cache: "no-store" }),
    fetch("data/periods.json", { cache: "no-store" })
  ]);

  if (!objectsRes.ok) throw new Error("Failed to load data/objects.json");
  if (!periodsRes.ok) throw new Error("Failed to load data/periods.json");

  const objectsArr = await objectsRes.json();
  const periodsObj = await periodsRes.json();

  if (!Array.isArray(objectsArr)) throw new Error("objects.json must be an array of objects");
  if (!periodsObj || !Array.isArray(periodsObj.periods)) throw new Error('periods.json must be { "periods": [ ... ] }');

  OBJECTS_BY_ID = new Map(objectsArr.map(o => [o.id, o]));
  PERIODS = periodsObj.periods;

  periodRange.min = "0";
  periodRange.max = String(Math.max(0, PERIODS.length - 1));
  if (!periodRange.value) periodRange.value = "0";

  const v = Number(periodRange.value);
  if (v > PERIODS.length - 1) periodRange.value = String(PERIODS.length - 1);
}

function drawForPeriod(periodIndex) {
  renderToken++;
  const token = renderToken;

  let routeIndex = 0;
  const period = PERIODS[periodIndex];
  clearLayers();

  if (!period) {
    setPanel("No period", "<p>Period not found.</p>");
    return;
  }

  const objectIds = Array.isArray(period.objects) ? period.objects : [];
  if (objectIds.length === 0) {
    setPanel("No objects", `<p>No objects configured for ${escapeHtml(period.label)}.</p>`);
    return;
  }

  for (const id of objectIds) {
    const obj = OBJECTS_BY_ID.get(id);
    if (!obj) continue;

    const col = categoryColor(obj.category);
    const baseStyle = markerStyleBase(col);
    const hoverStyle = markerStyleHover(col);
    const selectedStyle = markerStyleSelected(col);

    const locations = Array.isArray(obj.locations) ? obj.locations : [];
    const routes = Array.isArray(obj.routes) ? obj.routes : [];
    if (locations.length === 0) continue;

    for (const loc of locations) {
      if (loc?.lat == null || loc?.lng == null) continue;

      const marker = L.circleMarker([Number(loc.lat), Number(loc.lng)], baseStyle);
      marker.__baseStyle = baseStyle;
      marker.__hoverStyle = hoverStyle;
      marker.__selectedStyle = selectedStyle;

      marker.bindTooltip(buildHoverHTML(obj), {
        direction: "top",
        offset: [0, -10],
        opacity: 1,
        className: "hover-tooltip",
        sticky: true
      });

      marker.on("mouseover", () => {
        if (selectedMarker === marker) return;
        marker.setStyle(marker.__hoverStyle);
      });

      marker.on("mouseout", () => {
        if (selectedMarker === marker) return;
        marker.setStyle(marker.__baseStyle);
      });

      marker.on("click", () => {
        if (selectedMarker && selectedMarker !== marker) selectedMarker.setStyle(selectedMarker.__baseStyle);
        selectedMarker = marker;
        marker.setStyle(marker.__selectedStyle);
        setPanel(obj.title || obj.id || "Object", buildPanelHTML(obj, period));
      });

      marker.addTo(markersLayer);
      fadeInMarker(marker, marker.__baseStyle.fillOpacity, 400);

      for (const r of routes) {
        if (r?.toLat == null || r?.toLng == null) continue;

        const from = L.latLng(Number(loc.lat), Number(loc.lng));
        const to = L.latLng(Number(r.toLat), Number(r.toLng));

        const routeLine = L.polyline([from, from], {
          color: routeColor(r.influence),
          weight: 3,
          opacity: 0.9,
          dashArray: "6 8"
        }).addTo(routesLayer);

        animateRouteCrawl(routeLine, {
          fromLatLng: from,
          toLatLng: to,
          durationMs: 1500,
          delayMs: routeIndex * 200,
          token
        });

        routeIndex++;
      }
    }
  }

  setPanel("Select an object", `<p>Hover markers to preview. Click a marker to see full details.</p>`);
}

async function applyPeriod(index) {
  if (isTransitioning) return;
  isTransitioning = true;

  const idx = Math.max(0, Math.min(index, PERIODS.length - 1));
  periodRange.value = String(idx);
  updatePeriodUI(idx);
  updateActiveBand(idx);

  await fadeOutLayers(markersLayer, routesLayer, 400);
  drawForPeriod(idx);

  isTransitioning = false;
}

function wireControls() {
  periodRange.addEventListener("input", (e) => applyPeriod(Number(e.target.value)));
}

function wireBands() {
  document.querySelectorAll(".bands span").forEach((el) => {
    const activate = () => {
      const idx = Number(el.dataset.index);
      if (Number.isFinite(idx) && idx >= 0 && idx < PERIODS.length) applyPeriod(idx);
    };
    el.addEventListener("click", activate);
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        activate();
      }
    });
  });
}

(async function main() {
  initMap();
  wireControls();
  wireBands();

  try {
    await loadData();
    await applyPeriod(Number(periodRange.value));
  } catch (err) {
    setPanel("Error", `<p>${escapeHtml(err.message)}</p>`);
    console.error(err);
  }
})();
