import "./style.css";
(function () {
  "use strict";

  // ── Persistencia (localStorage con respaldo en memoria) ──────
  const STORE_KEY = "atlas-zmg-v1";
  let memoryStore = null;
  let storageOK = true;
  try {
    localStorage.setItem("__t", "1");
    localStorage.removeItem("__t");
  } catch (e) { storageOK = false; }

  function saveStore(obj) {
    const json = JSON.stringify(obj);
    if (storageOK) {
      try { localStorage.setItem(STORE_KEY, json); }
      catch (e) { storageOK = false; memoryStore = json; }
    } else {
      memoryStore = json;
    }
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    document.getElementById("save-status").textContent =
      storageOK ? `guardado ${hh}:${mm}` : "⚠ sin persistencia (solo esta sesión)";
  }
  function loadStore() {
    try {
      const raw = storageOK ? localStorage.getItem(STORE_KEY) : memoryStore;
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // ── Mapa base ────────────────────────────────────────────────
  const map = L.map("map", { zoomControl: true }).setView([20.6736, -103.3634], 11);

  const capaCalles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  });
  const capaClara = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    attribution: '&copy; OpenStreetMap &copy; CARTO'
  });
  capaClara.addTo(map);
  L.control.layers(
    { "Fondo claro": capaClara, "Calles (OSM)": capaCalles },
    null, { position: "bottomright" }
  ).addTo(map);
  L.control.scale({ metric: true, imperial: false }).addTo(map);

  // ── Estado ───────────────────────────────────────────────────
  const drawn = new L.FeatureGroup().addTo(map);
  const registry = new Map();   // id -> { layer, props }
  let groups = [];              // [{ id, name, collapsed }]
  let selectedId = null;
  let seq = 1;
  const dragState = { id: null };

  function newGroup(name) {
    const g = { id: "g" + Date.now().toString(36) + "-" + (seq++),
                name: name || ("Tópico " + (groups.length + 1)),
                collapsed: false };
    groups.push(g);
    return g;
  }
  function entriesInGroup(gid) {
    return [...registry.values()]
      .filter(en => (en.props.group || null) === gid)
      .sort((a, b) => (a.props.order ?? 0) - (b.props.order ?? 0));
  }
  function moveEntry(id, targetGroup, beforeId) {
    const entry = registry.get(id);
    if (!entry) return;
    entry.props.group = targetGroup;
    const list = entriesInGroup(targetGroup).filter(en => en.props.id !== id);
    let idx = list.length;
    if (beforeId) {
      const i = list.findIndex(en => en.props.id === beforeId);
      if (i !== -1) idx = i;
    }
    list.splice(idx, 0, entry);
    list.forEach((en, i) => { en.props.order = i; });
    render(); persist();
  }

  const PALETTE = ["#1e66f5", "#40a02b", "#fe640b", "#d20f39", "#8839ef", "#179299"];
  function nextColor() {
    return PALETTE[(registry.size) % PALETTE.length];
  }

  const KIND_LABEL = { zone: "zona", route: "ruta", marker: "punto" };
  function effWeight(props) {
    return Math.max(0.1, (props.freq ?? 1) * (props.imp ?? 3));
  }
  function defaultName(kind) {
    const n = [...registry.values()].filter(r => r.props.kind === kind).length + 1;
    return `${KIND_LABEL[kind].charAt(0).toUpperCase() + KIND_LABEL[kind].slice(1)} ${n}`;
  }

  // ── Mediciones ───────────────────────────────────────────────
  function fmtArea(m2) {
    if (m2 >= 1e6) return (m2 / 1e6).toFixed(2) + " km²";
    if (m2 >= 1e4) return (m2 / 1e4).toFixed(1) + " ha";
    return Math.round(m2) + " m²";
  }
  function fmtDist(m) {
    return m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m";
  }
  function measure(layer, kind) {
    if (kind === "zone") {
      const ll = layer.getLatLngs()[0];
      return fmtArea(L.GeometryUtil.geodesicArea(ll));
    }
    if (kind === "route") {
      const ll = layer.getLatLngs();
      let d = 0;
      for (let i = 1; i < ll.length; i++) d += ll[i - 1].distanceTo(ll[i]);
      return fmtDist(d);
    }
    const p = layer.getLatLng();
    return p.lat.toFixed(4) + ", " + p.lng.toFixed(4);
  }

  // ── Estilo de capas ──────────────────────────────────────────
  function applyStyle(entry) {
    const { layer, props } = entry;
    if (props.kind === "marker") {
      layer.setStyle({ color: props.color, fillColor: props.color, fillOpacity: 0.85, weight: 2 });
      layer.setRadius(8);
    } else if (props.kind === "zone") {
      layer.setStyle({ color: props.color, weight: 2.5, fillColor: props.color, fillOpacity: 0.18 });
    } else {
      layer.setStyle({ color: props.color, weight: 4, opacity: 0.9 });
    }
  }

  // ── Alta de elementos ────────────────────────────────────────
  function addEntry(layer, kind, props) {
    const id = props?.id || ("f" + Date.now().toString(36) + "-" + (seq++));
    const entry = {
      layer,
      props: {
        id,
        kind,
        name:  props?.name  || defaultName(kind),
        color: props?.color || nextColor(),
        notes: props?.notes || "",
        group: props?.group ?? null,
        order: (props?.order ?? entriesInGroup(props?.group ?? null).length),
        role:  props?.role ?? null,
        freq:  props?.freq ?? 1,   // visitas por semana
        imp:   props?.imp ?? 3     // importancia subjetiva 1–5
      }
    };
    registry.set(id, entry);
    layer._atlasId = id;
    applyStyle(entry);
    layer.bindTooltip(() => registry.get(id).props.name, { sticky: true });
    layer.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      if (routeAB.active) { routePointFromEntry(entry, e.latlng); return; }
      select(id, { scroll: true });
    });
    drawn.addLayer(layer);
    return entry;
  }

  function removeEntry(id) {
    const entry = registry.get(id);
    if (!entry) return;
    drawn.removeLayer(entry.layer);
    registry.delete(id);
    if (selectedId === id) selectedId = null;
    render(); persist();
  }

  // ── Dibujo (Leaflet.draw) ────────────────────────────────────
  L.drawLocal.draw.toolbar.buttons.polygon = "Dibujar zona (polígono)";
  L.drawLocal.draw.toolbar.buttons.rectangle = "Dibujar zona (rectángulo)";
  L.drawLocal.draw.toolbar.buttons.polyline = "Dibujar ruta";
  L.drawLocal.draw.toolbar.buttons.marker = "Colocar punto";

  const drawControl = new L.Control.Draw({
    position: "topleft",
    draw: {
      polygon:   { allowIntersection: false, showArea: true, shapeOptions: { weight: 2.5 } },
      rectangle: { shapeOptions: { weight: 2.5 } },
      polyline:  { shapeOptions: { weight: 4 } },
      marker: true,
      circle: false,
      circlemarker: false
    },
    edit: { featureGroup: drawn, remove: false }
  });
  map.addControl(drawControl);

  map.on(L.Draw.Event.CREATED, (e) => {
    let layer = e.layer, kind;
    if (e.layerType === "polygon" || e.layerType === "rectangle") kind = "zone";
    else if (e.layerType === "polyline") kind = "route";
    else {
      kind = "marker";
      layer = L.circleMarker(e.layer.getLatLng(), { radius: 8 });
    }
    const entry = addEntry(layer, kind);
    select(entry.props.id, { scroll: true });
    persist();
  });

  map.on(L.Draw.Event.EDITED, () => { render(); persist(); });

  // ── Ruta A→B (enrutamiento por calles con OSRM) ──────────────
  const routeAB = {
    active: false,
    pointA: null,
    nameA: null,
    nameB: null,
    tempLayers: []
  };
  const banner = document.getElementById("route-banner");

  function abIcon(letter) {
    return L.divIcon({ className: "", html: `<div class="ab-label">${letter}</div>`,
                       iconSize: [20, 20], iconAnchor: [10, 10] });
  }

  function setRouteMode(on) {
    routeAB.active = on;
    routeAB.pointA = null;
    routeAB.nameA = null;
    routeAB.nameB = null;
    routeAB.tempLayers.forEach(l => map.removeLayer(l));
    routeAB.tempLayers = [];
    abBtn.classList.toggle("active", on);
    banner.style.display = on ? "block" : "none";
    if (on) banner.textContent = "Punto A: clic en el mapa o en una figura · Esc para cancelar";
    map.getContainer().style.cursor = on ? "crosshair" : "";
  }

  // punto de anclaje al hacer clic sobre una figura existente
  function anchorOf(entry, clickLatLng) {
    const { layer, props } = entry;
    if (props.kind === "marker") return layer.getLatLng();          // el punto exacto
    if (props.kind === "zone")   return layer.getBounds().getCenter(); // centroide de la zona
    return clickLatLng;                                             // ruta: donde se hizo clic
  }

  function routePointFromEntry(entry, clickLatLng) {
    handleRoutePoint(anchorOf(entry, clickLatLng), entry.props.name);
  }

  function handleRoutePoint(latlng, sourceName) {
    if (!routeAB.pointA) {
      routeAB.pointA = latlng;
      routeAB.nameA = sourceName || null;
      routeAB.tempLayers.push(L.marker(latlng, { icon: abIcon("A") }).addTo(map));
      banner.textContent = (sourceName ? `A = ${sourceName} · ` : "") +
        "Punto B: clic en el mapa o en una figura · Esc para cancelar";
    } else {
      routeAB.nameB = sourceName || null;
      routeAB.tempLayers.push(L.marker(latlng, { icon: abIcon("B") }).addTo(map));
      finishRoute(routeAB.pointA, latlng);
    }
  }

  const AbControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const div = L.DomUtil.create("div", "leaflet-bar");
      const a = L.DomUtil.create("a", "route-ab-btn", div);
      a.href = "#";
      a.textContent = "A→B";
      a.title = "Trazar ruta por calles entre dos puntos";
      L.DomEvent.on(a, "click", (e) => {
        L.DomEvent.stop(e);
        setRouteMode(!routeAB.active);
      });
      return div;
    }
  });
  const abControlInstance = new AbControl().addTo(map);
  const abBtn = abControlInstance.getContainer().querySelector(".route-ab-btn");

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && routeAB.active) setRouteMode(false);
  });

  async function fetchRoute(a, b) {
    const url = `https://router.project-osrm.org/route/v1/driving/` +
                `${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (data.code !== "Ok" || !data.routes?.length) throw new Error("sin ruta");
    return data.routes[0];
  }

  async function finishRoute(a, b) {
    banner.textContent = "Calculando ruta…";
    const nameA = routeAB.nameA, nameB = routeAB.nameB;
    let latlngs, autoNote;
    try {
      const r = await fetchRoute(a, b);
      latlngs = r.geometry.coordinates.map(c => L.latLng(c[1], c[0]));
      const mins = Math.round(r.duration / 60);
      autoNote = `Ruta por calles (OSRM, auto): ${fmtDist(r.distance)}, ~${mins} min.`;
    } catch (err) {
      // respaldo: línea recta si no hay conexión o el servicio falla
      latlngs = [a, b];
      autoNote = "Línea recta A→B (no se pudo consultar el servicio de rutas: " +
                 err.message + ").";
    }
    if (nameA || nameB) {
      autoNote += `\nOrigen: ${nameA || "punto libre"} · Destino: ${nameB || "punto libre"}.`;
    }
    const layer = L.polyline(latlngs);
    const entry = addEntry(layer, "route");
    if (nameA && nameB) entry.props.name = `${nameA} → ${nameB}`;
    else if (nameA)     entry.props.name = `${nameA} → B`;
    else if (nameB)     entry.props.name = `A → ${nameB}`;
    entry.props.notes = autoNote;
    setRouteMode(false);
    select(entry.props.id, { zoom: true, scroll: true });
    persist();
  }

  map.on("click", (e) => {
    if (!routeAB.active) { select(null); return; }
    handleRoutePoint(e.latlng, null);
  });

  // ── Selección ────────────────────────────────────────────────
  function select(id, opts = {}) {
    selectedId = id;
    render();
    if (!id) return;
    const entry = registry.get(id);
    if (opts.zoom || opts.scroll) {
      const card = document.querySelector(`.card[data-id="${id}"]`);
      if (card) card.scrollIntoView({ block: "nearest" });
    }
    if (opts.zoom) {
      if (entry.props.kind === "marker") map.setView(entry.layer.getLatLng(), Math.max(map.getZoom(), 14));
      else map.fitBounds(entry.layer.getBounds().pad(0.3));
    }
  }

  // ── Render de la barra lateral ───────────────────────────────
  const listEl = document.getElementById("item-list");
  const emptyHint = document.getElementById("empty-hint");

  function render() {
    listEl.querySelectorAll(".card, .group").forEach(c => c.remove());
    const entries = [...registry.values()];
    emptyHint.style.display = entries.length ? "none" : "block";

    const counts = { zone: 0, route: 0, marker: 0 };
    entries.forEach(en => counts[en.props.kind]++);
    document.getElementById("count-zones").textContent   = counts.zone   + (counts.zone   === 1 ? " zona"  : " zonas");
    document.getElementById("count-routes").textContent  = counts.route  + (counts.route  === 1 ? " ruta"  : " rutas");
    document.getElementById("count-markers").textContent = counts.marker + (counts.marker === 1 ? " punto" : " puntos");

    // secciones: cada grupo definido + "sin grupo" al final
    for (const g of groups) listEl.appendChild(buildGroupSection(g));
    listEl.appendChild(buildGroupSection(null));
  }

  function buildGroupSection(g) {
    const gid = g ? g.id : null;
    const section = document.createElement("div");
    section.className = "group";
    section.dataset.gid = gid || "";

    const items = entriesInGroup(gid);

    // cabecera (solo para grupos reales, o si hay elementos sin grupo junto a grupos)
    if (g || (groups.length && items.length)) {
      const head = document.createElement("div");
      head.className = "group-head";

      const toggle = document.createElement("button");
      toggle.className = "group-toggle";
      const collapsed = g ? g.collapsed : false;
      toggle.textContent = collapsed ? "▶" : "▼";
      toggle.title = collapsed ? "Expandir" : "Contraer";
      if (g) {
        toggle.addEventListener("click", (e) => {
          e.stopPropagation();
          g.collapsed = !g.collapsed;
          render(); persist();
        });
      } else {
        toggle.style.visibility = "hidden";
      }

      const nameInput = document.createElement("input");
      nameInput.className = "group-name";
      nameInput.value = g ? g.name : "Sin grupo";
      nameInput.readOnly = !g;
      if (g) {
        nameInput.title = "Renombrar grupo";
        nameInput.addEventListener("input", () => { g.name = nameInput.value; persist(); });
      }

      const count = document.createElement("span");
      count.className = "group-count";
      count.textContent = items.length;

      head.append(toggle, nameInput, count);

      if (g) {
        const delG = document.createElement("button");
        delG.className = "icon-btn danger";
        delG.textContent = "✕";
        delG.title = "Eliminar grupo (los elementos pasan a Sin grupo)";
        delG.addEventListener("click", (e) => {
          e.stopPropagation();
          if (!confirm(`¿Eliminar el grupo "${g.name}"? Sus elementos pasan a "Sin grupo".`)) return;
          items.forEach(en => { en.props.group = null; });
          groups = groups.filter(x => x.id !== g.id);
          render(); persist();
        });
        head.appendChild(delG);
      }

      // soltar sobre la cabecera = mover al final del grupo
      head.addEventListener("dragover", (e) => { e.preventDefault(); head.classList.add("drop-hover"); });
      head.addEventListener("dragleave", () => head.classList.remove("drop-hover"));
      head.addEventListener("drop", (e) => {
        e.preventDefault(); head.classList.remove("drop-hover");
        if (dragState.id) moveEntry(dragState.id, gid, null);
      });

      section.appendChild(head);
    }

    // cuerpo
    const body = document.createElement("div");
    body.className = "group-body";
    if (g && g.collapsed) { section.appendChild(body); body.style.display = "none"; return section; }

    if (!items.length && g) {
      body.classList.add("empty-body");
      body.textContent = "Arrastra tarjetas aquí";
    }
    for (const entry of items) body.appendChild(buildCard(entry));

    // soltar en el cuerpo (zona vacía o al final)
    body.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.target === body) body.classList.add("drop-hover");
    });
    body.addEventListener("dragleave", (e) => {
      if (e.target === body) body.classList.remove("drop-hover");
    });
    body.addEventListener("drop", (e) => {
      body.classList.remove("drop-hover");
      if (e.target !== body) return;   // los drops sobre tarjetas los maneja la tarjeta
      e.preventDefault();
      if (dragState.id) moveEntry(dragState.id, gid, null);
    });

    section.appendChild(body);
    return section;
  }

  function buildCard(entry) {
    const { props, layer } = entry;
    const card = document.createElement("div");
    card.className = "card" + (props.id === selectedId ? " selected" : "");
    card.dataset.id = props.id;

    // fila principal
    const row = document.createElement("div");
    row.className = "card-row";

    const handle = document.createElement("span");
    handle.className = "card-handle";
    handle.textContent = "⠿";
    handle.title = "Arrastrar para reordenar o agrupar";
    handle.draggable = true;
    handle.addEventListener("dragstart", (e) => {
      dragState.id = props.id;
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", props.id);
      e.dataTransfer.setDragImage(card, 20, 20);
    });
    handle.addEventListener("dragend", () => {
      dragState.id = null;
      card.classList.remove("dragging");
      document.querySelectorAll(".drop-before, .drop-hover")
        .forEach(el => el.classList.remove("drop-before", "drop-hover"));
    });
    handle.addEventListener("click", (e) => e.stopPropagation());

    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = props.color;
    sw.addEventListener("click", (e) => e.stopPropagation());
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = props.color;
    colorInput.title = "Cambiar color";
    colorInput.addEventListener("click", (e) => e.stopPropagation());
    colorInput.addEventListener("input", () => {
      props.color = colorInput.value;
      sw.style.background = props.color;
      applyStyle(entry);
      persist();
    });
    sw.appendChild(colorInput);

    const nameInput = document.createElement("input");
    nameInput.className = "card-name";
    nameInput.value = props.name;
    nameInput.title = "Renombrar";
    nameInput.addEventListener("input", () => { props.name = nameInput.value; persist(); });
    nameInput.addEventListener("click", (e) => e.stopPropagation());

    const zoomBtn = document.createElement("button");
    zoomBtn.className = "icon-btn";
    zoomBtn.textContent = "◎";
    zoomBtn.title = "Ver en el mapa";
    zoomBtn.addEventListener("click", (e) => { e.stopPropagation(); select(props.id, { zoom: true }); });

    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn danger";
    delBtn.textContent = "✕";
    delBtn.title = "Eliminar";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm(`¿Eliminar "${props.name}"?`)) removeEntry(props.id);
    });

    row.append(handle, sw, nameInput, zoomBtn, delBtn);

    // meta: tipo + medición
    const meta = document.createElement("div");
    meta.className = "card-meta";
    const kindChip = document.createElement("span");
    kindChip.className = "chip kind-" + props.kind;
    kindChip.textContent = KIND_LABEL[props.kind];
    const measChip = document.createElement("span");
    measChip.className = "chip measure";
    measChip.textContent = measure(layer, props.kind);
    meta.append(kindChip, measChip);

    // paleta rápida (visible al seleccionar la tarjeta)
    const palette = document.createElement("div");
    palette.className = "card-palette";
    for (const c of PALETTE) {
      const dot = document.createElement("button");
      dot.className = "pal-dot" + (c.toLowerCase() === props.color.toLowerCase() ? " current" : "");
      dot.style.background = c;
      dot.title = c;
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        props.color = c;
        sw.style.background = c;
        colorInput.value = c;
        palette.querySelectorAll(".pal-dot").forEach(d => d.classList.remove("current"));
        dot.classList.add("current");
        applyStyle(entry);
        persist();
      });
      palette.appendChild(dot);
    }

    // pesos (visible al seleccionar; no aplica a rutas ni a centros calculados)
    const weights = document.createElement("div");
    weights.className = "card-weights";
    if (props.kind !== "route" && !String(props.role || "").startsWith("center")) {
      const mk = (labelTxt, key, min, max, step, title) => {
        const lab = document.createElement("label");
        lab.title = title;
        lab.append(labelTxt);
        const inp = document.createElement("input");
        inp.type = "number"; inp.min = min; inp.step = step;
        if (max) inp.max = max;
        inp.value = props[key];
        inp.addEventListener("click", (e) => e.stopPropagation());
        inp.addEventListener("input", () => {
          const v = parseFloat(inp.value);
          if (!isNaN(v)) { props[key] = v; wChip.textContent = "peso " + effWeight(props).toFixed(1); persist(); }
        });
        lab.appendChild(inp);
        return lab;
      };
      const wChip = document.createElement("span");
      wChip.className = "chip weight";
      wChip.textContent = "peso " + effWeight(props).toFixed(1);
      wChip.title = "Peso efectivo = visitas/sem × importancia. Afecta los cálculos de centro.";
      weights.append(
        mk("visitas/sem", "freq", 0, null, 0.5, "¿Cuántas veces por semana visitas este lugar?"),
        mk("importancia", "imp", 1, 5, 1, "Qué tanto te importa vivir cerca (1–5)"),
        wChip
      );
    }

    // notas
    const notes = document.createElement("textarea");
    notes.className = "card-notes";
    notes.placeholder = "Notas de análisis…";
    notes.value = props.notes;
    notes.addEventListener("input", () => { props.notes = notes.value; persist(); });
    notes.addEventListener("click", (e) => e.stopPropagation());

    card.append(row, meta, palette, weights, notes);
    card.addEventListener("click", () => select(props.id, { zoom: false }));

    // soltar sobre una tarjeta = insertar antes de ella (mismo grupo que la tarjeta)
    card.addEventListener("dragover", (e) => {
      if (!dragState.id || dragState.id === props.id) return;
      e.preventDefault();
      e.stopPropagation();
      card.classList.add("drop-before");
    });
    card.addEventListener("dragleave", () => card.classList.remove("drop-before"));
    card.addEventListener("drop", (e) => {
      card.classList.remove("drop-before");
      if (!dragState.id || dragState.id === props.id) return;
      e.preventDefault();
      e.stopPropagation();
      moveEntry(dragState.id, props.group || null, props.id);
    });

    return card;
  }

  // ── Serialización ────────────────────────────────────────────
  let persistTimer = null;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const fc = toFeatureCollection();
      saveStore(fc);
    }, 250);
  }

  function toFeatureCollection() {
    const features = [];
    for (const { layer, props } of registry.values()) {
      const gj = layer.toGeoJSON();
      gj.properties = { ...props };
      features.push(gj);
    }
    return { type: "FeatureCollection", features, groups: groups.map(g => ({ ...g })) };
  }

  document.getElementById("btn-new-group").addEventListener("click", () => {
    const name = prompt("Nombre del grupo (tópico):", "Tópico " + (groups.length + 1));
    if (name === null) return;
    newGroup(name.trim() || undefined);
    render(); persist();
  });

  // ── Centro óptimo: centroide vs mediana geométrica ───────────
  function computeCenter(opts) {
    const { includeZones, groupName, role, labelBase } = opts;
    const sources = [...registry.values()].filter(en =>
      !String(en.props.role || "").startsWith("center") &&
      (en.props.kind === "marker" || (includeZones && en.props.kind === "zone"))
    );
    if (sources.length < 2) {
      alert(includeZones
        ? "Necesitas al menos 2 elementos (puntos o zonas) para calcular el centro global."
        : "Necesitas al menos 2 puntos de interés (marcadores) para calcular el centro.");
      return;
    }
    // punto representativo: posición del marcador o centroide de la zona
    const lls = sources.map(en =>
      en.props.kind === "marker" ? en.layer.getLatLng()
                                 : en.layer.getBounds().getCenter());

    // proyección equirectangular local (suficiente a escala metropolitana)
    const R = 6371000, rad = Math.PI / 180;
    const latRef = lls.reduce((s, p) => s + p.lat, 0) / lls.length;
    const k = Math.cos(latRef * rad);
    const toXY = ll => ({ x: R * ll.lng * rad * k, y: R * ll.lat * rad });
    const toLL = p => L.latLng(p.y / (R * rad), p.x / (R * rad * k));
    const xy = lls.map(toXY);

    const wts = sources.map(en => effWeight(en.props));
    const totW = wts.reduce((s, w) => s + w, 0);

    // 1) centroide ponderado (promedio — sensible a atípicos)
    const cen = {
      x: xy.reduce((s, p, i) => s + p.x * wts[i], 0) / totW,
      y: xy.reduce((s, p, i) => s + p.y * wts[i], 0) / totW
    };

    // 2) mediana geométrica ponderada (Weiszfeld — robusta a atípicos)
    let m = { ...cen };
    for (let it = 0; it < 300; it++) {
      let sx = 0, sy = 0, sw = 0, coincide = null;
      for (let i = 0; i < xy.length; i++) {
        const p = xy[i];
        const d = Math.hypot(p.x - m.x, p.y - m.y);
        if (d < 1e-6) { coincide = p; continue; }  // cae exactamente sobre un punto
        const w = wts[i] / d;
        sx += p.x * w; sy += p.y * w; sw += w;
      }
      if (!sw) { m = coincide; break; }
      const nx = sx / sw, ny = sy / sw;
      const step = Math.hypot(nx - m.x, ny - m.y);
      m = { x: nx, y: ny };
      if (step < 0.5) break;   // convergió a medio metro
    }

    const centroidLL = toLL(cen);
    const medianLL   = toLL(m);

    function stats(ll) {
      let wsum = 0, weekly = 0, max = -1, maxName = "";
      for (let i = 0; i < lls.length; i++) {
        const d = ll.distanceTo(lls[i]);
        wsum += d * wts[i];
        weekly += d * 2 * (sources[i].props.freq ?? 1);   // ida y vuelta
        if (d > max) { max = d; maxName = sources[i].props.name; }
      }
      return { mean: wsum / totW, weekly, max, maxName };
    }
    const sM = stats(medianLL), sC = stats(centroidLL);

    // grupo destino (se reutiliza si ya existe); limpiar centros anteriores del mismo tipo
    let g = groups.find(x => x.name === groupName);
    if (!g) g = newGroup(groupName);
    [...registry.values()]
      .filter(en => en.props.role === role)
      .forEach(en => { drawn.removeLayer(en.layer); registry.delete(en.props.id); });

    const fmt = ll => ll.lat.toFixed(5) + ", " + ll.lng.toFixed(5);
    const nZ = sources.filter(en => en.props.kind === "zone").length;
    const nP = sources.length - nZ;
    const baseTxt = includeZones
      ? `${nP} puntos + ${nZ} zonas (centroide de cada zona)`
      : `${sources.length} puntos`;

    const eM = addEntry(L.circleMarker(medianLL, { radius: 8 }), "marker",
      { role, group: g.id, color: "#40a02b",
        name: `${labelBase} (mediana)` });
    eM.props.notes =
      `Mediana geométrica de ${baseTxt} — minimiza la suma de distancias ` +
      `y NO se deja arrastrar por elementos atípicos. Ponderado por visitas/sem × importancia. Recomendado.\n` +
      `Distancia media ponderada: ${fmtDist(sM.mean)} · máxima: ${fmtDist(sM.max)} (${sM.maxName}).\n` +
      `Km-viaje semanales estimados (ida y vuelta, lineales): ${fmtDist(sM.weekly)}.\n` +
      `Coordenadas: ${fmt(medianLL)}`;

    const eC = addEntry(L.circleMarker(centroidLL, { radius: 8 }), "marker",
      { role, group: g.id, color: "#7c7f93",
        name: `${labelBase} (promedio simple)` });
    eC.props.notes =
      `Centroide (promedio de coordenadas) de ${baseTxt} — referencia. Un elemento ` +
      `lejano lo jala proporcionalmente, por eso suele quedar sesgado hacia el atípico.\n` +
      `Distancia media ponderada: ${fmtDist(sC.mean)} · máxima: ${fmtDist(sC.max)} (${sC.maxName}).\n` +
      `Km-viaje semanales estimados (ida y vuelta, lineales): ${fmtDist(sC.weekly)}.\n` +
      `Coordenadas: ${fmt(centroidLL)}`;

    render(); persist();
    select(eM.props.id, { scroll: true });
    map.fitBounds(L.latLngBounds([...lls, medianLL, centroidLL]).pad(0.15));
  }

  document.getElementById("btn-center").addEventListener("click", () =>
    computeCenter({ includeZones: false, groupName: "Centro óptimo",
                    role: "center", labelBase: "Centro óptimo" }));
  document.getElementById("btn-center-global").addEventListener("click", () =>
    computeCenter({ includeZones: true, groupName: "Centro global",
                    role: "center-global", labelBase: "Centro global" }));

  // ── Centro por red vial (km de calles, matriz OSRM) ──────────
  function centerSources() {
    return [...registry.values()].filter(en =>
      !String(en.props.role || "").startsWith("center") &&
      (en.props.kind === "marker" || en.props.kind === "zone"));
  }

  function gridOver(latMin, latMax, lngMin, lngMax, n) {
    const pts = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        pts.push(L.latLng(
          latMin + (latMax - latMin) * (n === 1 ? 0.5 : i / (n - 1)),
          lngMin + (lngMax - lngMin) * (n === 1 ? 0.5 : j / (n - 1))));
    return pts;
  }

  async function osrmTableDistances(cands, targets) {
    const coords = [...cands, ...targets]
      .map(p => p.lng.toFixed(6) + "," + p.lat.toFixed(6)).join(";");
    const src = cands.map((_, i) => i).join(";");
    const dst = targets.map((_, i) => i + cands.length).join(";");
    const url = `https://router.project-osrm.org/table/v1/driving/${coords}` +
                `?sources=${src}&destinations=${dst}&annotations=distance`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (data.code !== "Ok" || !data.distances) throw new Error(data.code || "sin datos");
    return { distances: data.distances, snapped: data.sources || null };
  }

  function bestCandidate(cands, targets, distances, wts) {
    let best = -1, bestSum = Infinity, bestRow = null;
    for (let i = 0; i < cands.length; i++) {
      const row = distances[i];
      if (row.some(d => d == null)) continue;   // candidato sin conexión a algún destino
      const sum = row.reduce((s, d, j) => s + d * wts[j], 0);
      if (sum < bestSum) { bestSum = sum; best = i; bestRow = row; }
    }
    return { idx: best, row: bestRow };
  }

  async function computeRouteCenter() {
    const btn = document.getElementById("btn-center-routes");
    const sources = centerSources();
    if (sources.length < 2) {
      alert("Necesitas al menos 2 elementos (puntos o zonas) para calcular el centro por rutas.");
      return;
    }
    if (sources.length > 45) {
      alert("Máximo 45 destinos para el cálculo por rutas (límite del servicio OSRM).");
      return;
    }
    const targets = sources.map(en =>
      en.props.kind === "marker" ? en.layer.getLatLng()
                                 : en.layer.getBounds().getCenter());

    btn.disabled = true;
    const prevTxt = btn.textContent;
    btn.textContent = "◈ …";
    try {
      // malla gruesa 7×7 sobre el bounding box de los destinos (con margen)
      const b = L.latLngBounds(targets).pad(0.20);
      const coarse = gridOver(b.getSouth(), b.getNorth(), b.getWest(), b.getEast(), 7);
      const wts = sources.map(en => effWeight(en.props));
      const r1 = await osrmTableDistances(coarse, targets);
      const w1 = bestCandidate(coarse, targets, r1.distances, wts);
      if (w1.idx === -1) throw new Error("ningún candidato alcanzó todos los destinos");

      // malla fina 5×5 alrededor del ganador (una celda gruesa de radio)
      const dLat = (b.getNorth() - b.getSouth()) / 6;
      const dLng = (b.getEast() - b.getWest()) / 6;
      const c = coarse[w1.idx];
      const fine = gridOver(c.lat - dLat, c.lat + dLat, c.lng - dLng, c.lng + dLng, 5);
      const r2 = await osrmTableDistances(fine, targets);
      const w2 = bestCandidate(fine, targets, r2.distances, wts);

      const wsum = row => row.reduce((s, d, j) => s + d * wts[j], 0);
      const useFine = w2.idx !== -1 && wsum(w2.row) <= wsum(w1.row);
      const winRow = useFine ? w2.row : w1.row;
      // ubicación ajustada a la calle más cercana (snap de OSRM), si viene
      const snap = useFine ? r2.snapped?.[w2.idx] : r1.snapped?.[w1.idx];
      const winLL = snap?.location
        ? L.latLng(snap.location[1], snap.location[0])
        : (useFine ? fine[w2.idx] : coarse[w1.idx]);

      const totW = wts.reduce((s, w) => s + w, 0);
      const mean = winRow.reduce((s, d, j) => s + d * wts[j], 0) / totW;
      const weekly = winRow.reduce((s, d, j) => s + d * 2 * (sources[j].props.freq ?? 1), 0);
      let max = -1, maxName = "";
      winRow.forEach((d, i) => { if (d > max) { max = d; maxName = sources[i].props.name; } });

      const nZ = sources.filter(en => en.props.kind === "zone").length;
      const nP = sources.length - nZ;

      let g = groups.find(x => x.name === "Centro por rutas");
      if (!g) g = newGroup("Centro por rutas");
      [...registry.values()]
        .filter(en => en.props.role === "center-routes")
        .forEach(en => { drawn.removeLayer(en.layer); registry.delete(en.props.id); });

      const e = addEntry(L.circleMarker(winLL, { radius: 8 }), "marker",
        { role: "center-routes", group: g.id, color: "#fe640b",
          name: "Centro por rutas (km)" });
      e.props.notes =
        `Centro por red vial (OSRM): minimiza la suma de km por calles a ` +
        `${nP} puntos + ${nZ} zonas. Búsqueda en malla 7×7 refinada a 5×5, ` +
        `ajustado a la vialidad más cercana.\n` +
        `Ponderado por visitas/sem × importancia.\n` +
        `Km por calles — promedio ponderado: ${fmtDist(mean)} · máximo: ${fmtDist(max)} (${maxName}).\n` +
        `Km-viaje semanales estimados por calles (ida y vuelta): ${fmtDist(weekly)}.\n` +
        `Perfil auto como proxy de la red; en distancias cortas aplica igual para bici.\n` +
        `Coordenadas: ${winLL.lat.toFixed(5)}, ${winLL.lng.toFixed(5)}`;

      render(); persist();
      select(e.props.id, { scroll: true });
      map.fitBounds(L.latLngBounds([...targets, winLL]).pad(0.15));
    } catch (err) {
      alert("No se pudo calcular el centro por rutas: " + err.message +
            "\nRevisa tu conexión o intenta de nuevo (el servidor demo de OSRM a veces se satura).");
    } finally {
      btn.disabled = false;
      btn.textContent = prevTxt;
    }
  }

  document.getElementById("btn-center-routes").addEventListener("click", computeRouteCenter);


  function loadFeature(f) {
    const p = f.properties || {};
    const geom = f.geometry;
    if (!geom) return;
    let layer, kind;
    if (geom.type === "Polygon") {
      kind = "zone";
      const ll = geom.coordinates[0].map(c => L.latLng(c[1], c[0]));
      layer = L.polygon(ll);
    } else if (geom.type === "LineString") {
      kind = "route";
      const ll = geom.coordinates.map(c => L.latLng(c[1], c[0]));
      layer = L.polyline(ll);
    } else if (geom.type === "Point") {
      kind = "marker";
      layer = L.circleMarker(L.latLng(geom.coordinates[1], geom.coordinates[0]), { radius: 8 });
    } else return;
    addEntry(layer, p.kind || kind, p);
  }

  // ── Exportar / importar / borrar ─────────────────────────────
  document.getElementById("btn-export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(toFeatureCollection(), null, 2)],
                          { type: "application/geo+json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "atlas-zmg.geojson";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const fileInput = document.getElementById("file-input");
  document.getElementById("btn-import").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const fc = JSON.parse(reader.result);
        const feats = fc.type === "FeatureCollection" ? fc.features
                    : fc.type === "Feature" ? [fc] : [];
        if (!feats.length) { alert("El archivo no contiene features GeoJSON."); return; }
        if (Array.isArray(fc.groups)) {
          const existing = new Set(groups.map(g => g.id));
          fc.groups.forEach(g => { if (!existing.has(g.id)) groups.push({ ...g }); });
        }
        feats.forEach(loadFeature);
        render(); persist();
        if (drawn.getLayers().length) map.fitBounds(drawn.getBounds().pad(0.15));
      } catch (e) {
        alert("No se pudo leer el archivo: " + e.message);
      }
      fileInput.value = "";
    };
    reader.readAsText(file);
  });

  document.getElementById("btn-clear").addEventListener("click", () => {
    if (!registry.size) return;
    if (!confirm("¿Borrar todos los elementos? Esta acción no se puede deshacer.")) return;
    drawn.clearLayers();
    registry.clear();
    groups = [];
    selectedId = null;
    render(); persist();
  });

  // ── Arranque ─────────────────────────────────────────────────
  const saved = loadStore();
  if (saved) {
    if (Array.isArray(saved.groups)) groups = saved.groups;
    if (saved.features) {
      saved.features.forEach(loadFeature);
      // si una tarjeta apunta a un grupo que ya no existe, pasa a "Sin grupo"
      const gids = new Set(groups.map(g => g.id));
      for (const en of registry.values()) {
        if (en.props.group && !gids.has(en.props.group)) en.props.group = null;
      }
      if (drawn.getLayers().length) map.fitBounds(drawn.getBounds().pad(0.15));
    }
  }
  render();
  document.getElementById("save-status").textContent =
    storageOK ? (saved ? "cargado" : "listo") : "⚠ sin persistencia (solo esta sesión)";
})();
