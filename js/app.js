/* Rotta Pullman — interfaccia */
(function () {
  'use strict';
  const C = window.RPCore;
  const API = window.RPServices;
  const $ = (s, r) => (r || document).querySelector(s);

  /* Costruisce elementi DOM; il testo passa sempre da textContent. */
  function h(tag, attrs) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'svg') e.innerHTML = v; // solo SVG generati qui
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (let i = 2; i < arguments.length; i++) {
      const kids = [].concat(arguments[i]);
      for (const kid of kids) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }

  /* ------------------------------------------------------------------ */
  /* Stato                                                               */
  /* ------------------------------------------------------------------ */
  const STORE = 'rotta-pullman/v1';
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } },
    set(o) { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch (e) { /* memoria non disponibile */ } },
  };

  const EXAMPLE = [
    { label: 'Milano, Stazione Centrale', lat: 45.48596, lon: 9.20444 },
    { label: 'Firenze, Piazzale Michelangelo', lat: 43.76291, lon: 11.26505 },
  ];
  const DEFAULT_PRESET = C.PRESETS.find((p) => p.id === 'gt13');
  let uid = 0;
  const mkStop = (o) => ({ id: ++uid, label: (o && o.label) || '', lat: o && o.lat != null ? Number(o.lat) : null, lon: o && o.lon != null ? Number(o.lon) : null, dwell: (o && Number(o.dwell)) || 0 });

  function localInputValue(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function defaultDeparture() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(7, 0, 0, 0);
    return localInputValue(d);
  }
  function validDeparture(v) {
    const t = v ? new Date(v).getTime() : NaN;
    return isFinite(t) && t > Date.now() - 3 * 3600e3 ? v : defaultDeparture();
  }

  const saved = store.get();
  const firstVisit = !saved.stops;
  const state = {
    vehicle: C.sanitizeVehicle(saved.vehicle || DEFAULT_PRESET),
    presetId: saved.presetId || 'p:gt13',
    margin: saved.margin != null ? Number(saved.margin) : 0.1,
    breakMode: saved.breakMode || 'legge',
    options: Object.assign({ engine: 'valhalla', orsKey: '', tomtomKey: '', mapillaryToken: '', avoidTolls: false, avoidHighways: false, avoidFerries: true, strictHgv: true, vmax: 100 }, saved.options || {}),
    stops: (saved.stops && saved.stops.length >= 2 ? saved.stops : EXAMPLE).map(mkStop),
    isExample: saved.stops ? !!saved.example : true,
    departure: validDeparture(saved.departure),
    garage: Array.isArray(saved.garage) ? saved.garage : [],
    base: saved.base || (location.protocol === 'file:' ? 'esri' : 'stradale'),
    route: null, plan: null, analysis: null, parkings: null, permits: null, stale: false,
  };

  // link condiviso (#v=...)
  let fromShare = false;
  const m = location.hash.match(/^#v=([A-Za-z0-9_-]+)$/);
  if (m) {
    const sh = C.decodeShare(m[1]);
    if (sh && sh.stops.length >= 2) {
      fromShare = true;
      state.stops = sh.stops.map(mkStop);
      state.isExample = false;
      if (sh.vehicle) { state.vehicle = sh.vehicle; state.presetId = matchPreset(sh.vehicle); }
      if (sh.margin != null) state.margin = sh.margin;
      if (sh.breakMode) state.breakMode = sh.breakMode;
      if (sh.options) Object.assign(state.options, sh.options);
    }
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* file:// */ }
  }

  function persist() {
    store.set({
      vehicle: state.vehicle, presetId: state.presetId, margin: state.margin, breakMode: state.breakMode,
      options: state.options, departure: state.departure, garage: state.garage, base: state.base,
      stops: state.stops.map((s) => ({ label: s.label, lat: s.lat, lon: s.lon, dwell: s.dwell })),
      example: state.isExample,
    });
  }

  function matchPreset(v) {
    const same = (p) => ['lunghezza', 'altezza', 'larghezza', 'peso', 'caricoAsse', 'assi'].every((k) => Math.abs(p[k] - v[k]) < 1e-6);
    const p = C.PRESETS.find(same);
    if (p) return 'p:' + p.id;
    const g = state.garage.find((x) => same(x.vehicle));
    return g ? 'g:' + g.nome : 'custom';
  }

  const fmtCoords = (lat, lon) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const isWide = () => window.matchMedia('(min-width: 900px)').matches;
  const depMs = () => new Date(state.departure).getTime() || Date.now();
  const stopName = (i, s) => (s && s.label) || `Tappa ${C.stopLetter(i)}`;

  /* ------------------------------------------------------------------ */
  /* Cartelli stradali (SVG)                                             */
  /* ------------------------------------------------------------------ */
  function esc(s) { return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }

  const dec1 = (v) => C.fmtNum(v, Number.isInteger(v) ? 1 : undefined);

  function signSVG(kind, text) {
    const ring = '<circle class="ring" cx="50" cy="50" r="43" fill="#fff" stroke="#c8102e" stroke-width="12"/>';
    const len = String(text || '').length;
    const fs = len >= 5 ? 23 : len === 4 ? 27 : 31;
    const t = (y, size) => `<text x="50" y="${y}" text-anchor="middle" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="700" font-size="${size}" fill="#111">${esc(text)}</text>`;
    let inner = '';
    switch (kind) {
      case 'altezza':
        inner = '<path d="M40 22h20l-10 9z M40 78h20l-10-9z" fill="#111"/>' + t(60, fs);
        break;
      case 'larghezza':
        inner = '<path d="M22 40v20l9-10z M78 40v20l-9-10z" fill="#111"/>' + t(60, fs - 5);
        break;
      case 'lunghezza':
        inner = t(53, fs - 3) + '<path d="M30 66h40" stroke="#111" stroke-width="3"/><path d="M27 66l8-5v10z M73 66l-8-5v10z" fill="#111"/>';
        break;
      case 'asse':
        inner = t(54, fs - 5) + '<path d="M34 67h32" stroke="#111" stroke-width="4"/><circle cx="34" cy="69" r="5" fill="#111"/><circle cx="66" cy="69" r="5" fill="#111"/>';
        break;
      case 'bus':
        inner = '<rect x="27" y="36" width="46" height="24" rx="4" fill="#111"/><rect x="31" y="40" width="9" height="8" fill="#fff"/><rect x="43" y="40" width="9" height="8" fill="#fff"/><rect x="55" y="40" width="9" height="8" fill="#fff"/><circle cx="36" cy="62" r="5" fill="#111" stroke="#fff" stroke-width="2"/><circle cx="63" cy="62" r="5" fill="#111" stroke="#fff" stroke-width="2"/>';
        break;
      case 'pesanti':
        inner = '<rect x="24" y="38" width="32" height="22" fill="#111"/><path d="M57 45h10l7 8v7H57z" fill="#111"/><circle cx="33" cy="62" r="5" fill="#111" stroke="#fff" stroke-width="2"/><circle cx="66" cy="62" r="5" fill="#111" stroke="#fff" stroke-width="2"/>';
        break;
      default:
        inner = t(60, fs);
    }
    return `<svg viewBox="0 0 100 100" role="img" aria-hidden="true">${ring}${inner}</svg>`;
  }

  const DANGER_SVG = '<svg viewBox="0 0 100 100" role="img" aria-hidden="true"><path d="M50 8 94 88H6z" fill="#fff" stroke="#c8102e" stroke-width="10" stroke-linejoin="round"/><path d="M50 36v26" stroke="#111" stroke-width="9" stroke-linecap="round"/><circle cx="50" cy="74" r="5.5" fill="#111"/></svg>';

  function hazardSign(hz) {
    const v = hz.value;
    if (hz.kind === 'tomtom') return DANGER_SVG;
    switch (hz.kind) {
      case 'altezza': return signSVG('altezza', v != null ? dec1(v) : '?');
      case 'larghezza': return signSVG('larghezza', dec1(v));
      case 'lunghezza': return signSVG('lunghezza', C.fmtNum(v));
      case 'peso': return signSVG('peso', C.fmtNum(v) + 't');
      case 'asse': return signSVG('asse', C.fmtNum(v) + 't');
      case 'bus': return signSVG('bus');
      default: return signSVG('pesanti');
    }
  }

  function arrowSVG(icon) {
    if (icon === 'arrive') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4h10l-1.5 3L16 10H8v11" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
    if (icon === 'round') return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 22v-4.5 M16.5 9.5 20 6 M20 6h-4 M20 6v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    if (icon === 'ferry') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15h16l-2 4H6z M8 15V9h8v6 M12 9V5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
    const a = Number(icon) || 0;
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><g transform="rotate(${a} 12 12)"><path d="M12 21V5 M6.5 10.5 12 5l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
  }

  const ICONS = {
    layers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 8.5 12 14l10-5.5z M2 15.5 12 21l10-5.5 M2 12l10 5.5L22 12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
    fit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 15c2-5 6-1 8-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    locate: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 1.5v4 M12 18.5v4 M1.5 12h4 M18.5 12h4" stroke="currentColor" stroke-width="2"/></svg>',
  };

  /* ------------------------------------------------------------------ */
  /* Mappa                                                               */
  /* ------------------------------------------------------------------ */
  const map = L.map('map', { zoomControl: false, attributionControl: false, worldCopyJump: true, tapTolerance: 20 }).setView([42.9, 12.4], 6);

  const OSM_LINK = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
  // Mappe che non richiedono chiavi. Quelle di OpenStreetMap chiedono che la pagina sia su un sito web:
  // aprendo il file dal disco si parte con quelle Esri.
  const BASES = {
    stradale: { nome: 'Stradale · OpenStreetMap', make: () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: OSM_LINK }) },
    esri: { nome: 'Stradale · Esri', make: () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 18, attribution: 'Mappa © Esri, HERE, Garmin, ' + OSM_LINK }) },
    satellite: { nome: 'Satellite', make: () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 18, attribution: 'Immagini © Esri, Maxar, Earthstar Geographics' }) },
  };
  if (!BASES[state.base]) state.base = 'stradale'; // anche per chi aveva salvato le vecchie mappe CARTO
  let baseLayer = BASES[state.base].make().addTo(map);
  function setBase(key) {
    if (!BASES[key]) return;
    map.removeLayer(baseLayer);
    baseLayer = BASES[key].make().addTo(map);
    baseLayer.bringToBack();
    state.base = key;
    persist();
  }

  const lg = {
    route: L.layerGroup().addTo(map),
    breaks: L.layerGroup().addTo(map),
    parks: L.layerGroup().addTo(map),
    hazards: L.layerGroup().addTo(map),
    stops: L.layerGroup().addTo(map),
    me: L.layerGroup().addTo(map),
  };

  const Tools = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const box = h('div', { class: 'map-tools' });
      const menu = h('div', { class: 'layer-menu', hidden: true, role: 'radiogroup', 'aria-label': 'Tipo di mappa' });
      for (const k of Object.keys(BASES)) {
        const id = 'base-' + k;
        const input = h('input', { type: 'radio', name: 'base', id, value: k });
        input.checked = state.base === k;
        input.addEventListener('change', () => { setBase(k); menu.hidden = true; });
        menu.append(h('label', { for: id }, input, BASES[k].nome));
      }
      box.append(
        h('button', { type: 'button', title: 'Tipo di mappa', 'aria-label': 'Tipo di mappa', svg: ICONS.layers, onclick: () => { menu.hidden = !menu.hidden; } }),
        menu,
        h('button', { type: 'button', title: 'Mostra tutto il percorso', 'aria-label': 'Mostra tutto il percorso', svg: ICONS.fit, onclick: () => fitAll() }),
        h('button', { type: 'button', title: 'La mia posizione', 'aria-label': 'La mia posizione', svg: ICONS.locate, onclick: () => locate() }),
      );
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.disableScrollPropagation(box);
      return box;
    },
  });
  const attribution = L.control.attribution({ prefix: '<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>' });
  const zoomCtl = L.control.zoom({ position: 'topright', zoomInTitle: 'Avvicina', zoomOutTitle: 'Allontana' });
  const tools = new Tools();
  function placeControls() {
    attribution.remove(); zoomCtl.remove(); tools.remove();
    attribution.setPosition(isWide() ? 'bottomright' : 'topleft').addTo(map);
    if (isWide()) zoomCtl.addTo(map);
    tools.addTo(map);
  }
  placeControls();

  function mapPadding() {
    if (isWide()) {
      const w = $('#panel').getBoundingClientRect().right;
      return { paddingTopLeft: [w + 24, 40], paddingBottomRight: [70, 40] };
    }
    const sheetH = window.innerHeight - $('#panel').getBoundingClientRect().top;
    return { paddingTopLeft: [24, 70], paddingBottomRight: [64, sheetH + 24] };
  }

  function fitAll() {
    let b = null;
    if (state.route) b = L.latLngBounds(state.route.coords);
    else {
      const pts = state.stops.filter((s) => s.lat != null).map((s) => [s.lat, s.lon]);
      if (pts.length) b = L.latLngBounds(pts);
    }
    if (!b) return;
    if (!isWide() && sheet === 'max') setSheet('mid');
    const opts = Object.assign({ maxZoom: 15 }, mapPadding());
    setTimeout(() => map.fitBounds(b, opts), isWide() ? 0 : 300);
  }

  function flyTo(lat, lon, zoom) {
    if (!isWide() && sheet !== 'min') setSheet('min');
    setTimeout(() => {
      const z = zoom || 16;
      const pad = mapPadding();
      // centra il punto nell'area di mappa visibile
      const size = map.getSize();
      const visCx = (pad.paddingTopLeft[0] + size.x - pad.paddingBottomRight[0]) / 2;
      const visCy = (pad.paddingTopLeft[1] + size.y - pad.paddingBottomRight[1]) / 2;
      const target = map.project([lat, lon], z).subtract([visCx - size.x / 2, visCy - size.y / 2]);
      map.setView(map.unproject(target, z), z);
    }, isWide() ? 0 : 300);
  }

  /* menu del punto toccato sulla mappa */
  function openPointMenu(latlng, title) {
    const lat = latlng.lat, lon = latlng.lng;
    const pick = (where) => { map.closePopup(); setStopFromMap(where, lat, lon); };
    const box = h('div', { class: 'pt-menu' },
      h('b', { text: title || 'Usa questo punto come' }),
      h('span', { class: 'pt-coords', text: fmtCoords(lat, lon) }),
      h('div', { class: 'pt-actions' },
        h('button', { type: 'button', class: 'btn-secondary', onclick: () => pick('start') }, 'Partenza'),
        h('button', { type: 'button', class: 'btn-secondary', onclick: () => pick('via') }, 'Tappa'),
        h('button', { type: 'button', class: 'btn-secondary', onclick: () => pick('end') }, 'Arrivo')));
    L.popup({ maxWidth: 300, autoPanPadding: [20, 80] }).setLatLng(latlng).setContent(box).openOn(map);
  }
  map.on('click', (e) => { closeAc(); openPointMenu(e.latlng); });

  function setStopFromMap(where, lat, lon) {
    let s;
    if (where === 'start') s = state.stops[0];
    else if (where === 'end') s = state.stops[state.stops.length - 1];
    else {
      s = state.stops.slice(1, -1).find((x) => x.lat == null && !x.label);
      if (!s) {
        s = mkStop();
        // inserisce la tappa dove allunga meno il viaggio
        let best = state.stops.length - 1, bestCost = Infinity;
        for (let i = 0; i < state.stops.length - 1; i++) {
          const a = state.stops[i], b = state.stops[i + 1];
          if (a.lat == null || b.lat == null) continue;
          const cost = C.haversine([a.lat, a.lon], [lat, lon]) + C.haversine([lat, lon], [b.lat, b.lon]) - C.haversine([a.lat, a.lon], [b.lat, b.lon]);
          if (cost < bestCost) { bestCost = cost; best = i + 1; }
        }
        state.stops.splice(best, 0, s);
      }
    }
    s.lat = lat; s.lon = lon; s.label = fmtCoords(lat, lon);
    state.isExample = false;
    renderStops(); renderMarkers(); persist();
    reverseLabel(s);
    onStopsChanged();
  }

  function reverseLabel(s) {
    const lat = s.lat, lon = s.lon;
    API.reverse(lat, lon).then((label) => {
      if (!label || s.lat !== lat || s.lon !== lon) return;
      s.label = label;
      const input = document.getElementById('stop-' + s.id);
      if (input && document.activeElement !== input) input.value = label;
      persist();
      if (state.route) renderResult();
    }).catch(() => {});
  }

  function renderMarkers() {
    lg.stops.clearLayers();
    const n = state.stops.length;
    state.stops.forEach((s, i) => {
      if (s.lat == null) return;
      const icon = L.divIcon({ className: '', html: `<div class="pin${i === n - 1 ? ' end' : ''}"><span>${C.stopLetter(i)}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 36], popupAnchor: [0, -34] });
      const mk = L.marker([s.lat, s.lon], { icon, draggable: true, zIndexOffset: 1000, title: stopName(i, s), keyboard: false });
      mk.on('dragend', () => {
        const ll = mk.getLatLng();
        s.lat = ll.lat; s.lon = ll.lng; s.label = fmtCoords(ll.lat, ll.lng);
        state.isExample = false;
        renderStops(); persist(); reverseLabel(s); onStopsChanged(true);
      });
      mk.addTo(lg.stops);
    });
  }

  /* posizione dell'utente */
  function locate() {
    if (!navigator.geolocation) { toast('Posizione non disponibile su questo dispositivo.'); return; }
    toast('Cerco la tua posizione…');
    navigator.geolocation.getCurrentPosition((pos) => {
      const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
      lg.me.clearLayers();
      L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) })
        .on('click', () => openPointMenu(ll, 'La tua posizione'))
        .addTo(lg.me);
      hideToast();
      flyTo(ll.lat, ll.lng, 14);
      setTimeout(() => openPointMenu(ll, 'La tua posizione'), isWide() ? 300 : 650);
    }, (err) => {
      toast(err.code === 1 ? 'Permesso di posizione negato.' : 'Non riesco a leggere la posizione. Riprova.');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }

  /* ------------------------------------------------------------------ */
  /* Foglio scorrevole (telefono)                                        */
  /* ------------------------------------------------------------------ */
  const panel = $('#panel');
  let sheet = 'mid';
  function sheetPx(name) {
    const H = window.innerHeight;
    if (name === 'min') return 150;
    if (name === 'max') return Math.max(300, H - 70);
    return Math.round(Math.max(300, H * 0.52));
  }
  function setSheet(name) {
    sheet = name;
    panel.dataset.sheet = name;
    panel.style.setProperty('--sheet-h', sheetPx(name) + 'px');
  }
  setSheet(firstVisit || fromShare ? 'mid' : 'mid');

  (function sheetDrag() {
    let startY = 0, startH = 0, moved = false, active = false;
    const onDown = (e) => {
      if (isWide() || (e.target.closest && e.target.closest('button, input, select, a'))) return;
      active = true; moved = false; startY = e.clientY;
      startH = parseFloat(panel.style.getPropertyValue('--sheet-h')) || sheetPx(sheet);
      panel.classList.add('dragging');
      e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
    };
    const onMove = (e) => {
      if (!active) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 5) moved = true;
      const hgt = Math.min(window.innerHeight - 50, Math.max(110, startH - dy));
      panel.style.setProperty('--sheet-h', hgt + 'px');
    };
    const onUp = () => {
      if (!active) return;
      active = false;
      panel.classList.remove('dragging');
      if (!moved) { setSheet(sheet === 'min' ? 'mid' : sheet === 'mid' ? 'max' : 'min'); return; }
      const cur = parseFloat(panel.style.getPropertyValue('--sheet-h'));
      const order = ['min', 'mid', 'max'];
      let best = 'mid', bestD = Infinity;
      for (const n of order) { const d = Math.abs(sheetPx(n) - cur); if (d < bestD) { bestD = d; best = n; } }
      setSheet(best);
    };
    for (const el of [$('#grip'), $('#panel-head')]) {
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    }
    $('#grip').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSheet(sheet === 'max' ? 'min' : sheet === 'min' ? 'mid' : 'max'); }
    });
  })();

  window.addEventListener('resize', () => {
    if (!isWide()) setSheet(sheet);
    map.invalidateSize();
  });
  window.matchMedia('(min-width: 900px)').addEventListener('change', () => { placeControls(); if (!isWide()) setSheet(sheet); });

  /* ------------------------------------------------------------------ */
  /* Schede                                                              */
  /* ------------------------------------------------------------------ */
  const TABS = ['viaggio', 'mezzo', 'percorso'];
  function showTab(name, focus) {
    for (const t of TABS) {
      const tab = $('#tab-' + t), view = $('#view-' + t);
      const on = t === name;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      view.hidden = !on;
      if (on && focus) tab.focus();
    }
    $('#panel-body').scrollTop = 0;
    if (!isWide() && sheet === 'min') setSheet('mid');
  }
  for (const t of TABS) {
    const tab = $('#tab-' + t);
    tab.addEventListener('click', () => showTab(t));
    tab.addEventListener('keydown', (e) => {
      const i = TABS.indexOf(t);
      if (e.key === 'ArrowRight') showTab(TABS[(i + 1) % 3], true);
      if (e.key === 'ArrowLeft') showTab(TABS[(i + 2) % 3], true);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Tappe e ricerca indirizzi                                           */
  /* ------------------------------------------------------------------ */
  const DWELLS = [0, 15, 30, 45, 60, 90, 120, 180, 240];

  function renderStops() {
    const ol = $('#stops');
    ol.replaceChildren();
    const n = state.stops.length;
    state.stops.forEach((s, i) => {
      const first = i === 0, last = i === n - 1;
      const input = h('input', {
        type: 'text', id: 'stop-' + s.id,
        placeholder: first ? 'Da dove si parte?' : last ? 'Destinazione' : 'Tappa intermedia',
        autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search',
        role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list',
        'aria-label': first ? 'Partenza' : last ? 'Destinazione' : 'Tappa ' + C.stopLetter(i),
        class: s.label && s.lat == null ? 'invalid' : null,
      });
      input.value = s.label;
      attachAutocomplete(input, s);
      const main = h('div', { class: 'stop-main' }, input);
      if (!first && !last) {
        const sel = h('select', { id: 'dwell-' + s.id, 'aria-label': 'Durata della sosta' });
        for (const d of DWELLS) sel.append(h('option', { value: d, text: d ? C.fmtDur(d * 60) : 'solo passaggio' }));
        sel.value = String(DWELLS.includes(s.dwell) ? s.dwell : 0);
        sel.addEventListener('change', () => { s.dwell = Number(sel.value); persist(); if (state.route) { replan(); } });
        main.append(h('label', { class: 'stop-dwell', for: 'dwell-' + s.id }, 'Sosta', sel));
      }
      const del = h('button', { type: 'button', class: 'stop-del', title: 'Rimuovi tappa', 'aria-label': 'Rimuovi ' + (s.label || 'tappa'), disabled: n <= 2, onclick: () => removeStop(i) }, '×');
      ol.append(h('li', { class: 'stop' }, h('span', { class: 'stop-badge', 'aria-hidden': 'true' }, C.stopLetter(i)), main, del));
    });
    $('#example-chip').hidden = !state.isExample;
  }

  function removeStop(i) {
    if (state.stops.length <= 2) return;
    state.stops.splice(i, 1);
    renderStops(); renderMarkers(); persist(); onStopsChanged();
  }

  $('#btn-add-stop').addEventListener('click', () => {
    const s = mkStop();
    state.stops.splice(state.stops.length - 1, 0, s);
    renderStops();
    const input = document.getElementById('stop-' + s.id);
    if (input) input.focus();
  });
  $('#btn-reverse').addEventListener('click', () => {
    state.stops.reverse();
    state.stops.forEach((s, i) => { if (i === 0 || i === state.stops.length - 1) s.dwell = 0; });
    renderStops(); renderMarkers(); persist(); onStopsChanged();
  });

  let ac = null; // { input, stop, list, items, active, ctrl }
  function closeAc() {
    if (!ac) return;
    if (ac.ctrl) ac.ctrl.abort();
    ac.list.remove();
    ac.input.setAttribute('aria-expanded', 'false');
    ac.input.removeAttribute('aria-activedescendant');
    ac = null;
  }
  function acList(input, stop) {
    if (ac && ac.input === input) return ac;
    closeAc();
    const list = h('ul', { class: 'ac', role: 'listbox', id: 'ac-' + stop.id });
    input.parentElement.append(list);
    input.setAttribute('aria-controls', list.id);
    ac = { input, stop, list, items: [], active: -1, ctrl: null };
    return ac;
  }
  function acInfo(input, stop, text) {
    const a = acList(input, stop);
    a.items = []; a.active = -1;
    a.list.replaceChildren(h('li', { class: 'ac-info', role: 'option', 'aria-disabled': 'true' }, text));
    input.setAttribute('aria-expanded', 'true');
  }
  function acShow(input, stop, items) {
    const a = acList(input, stop);
    a.items = items; a.active = -1;
    a.list.replaceChildren(...items.map((it, k) => {
      const li = h('li', { role: 'option', id: `ac-${stop.id}-${k}`, 'aria-selected': 'false' }, h('b', { text: it.main }), it.sub ? h('small', { text: it.sub }) : null);
      li.addEventListener('pointerdown', (e) => e.preventDefault());
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', () => chooseItem(stop, it, input));
      return li;
    }));
    input.setAttribute('aria-expanded', 'true');
  }
  function acMove(delta) {
    if (!ac || !ac.items.length) return;
    ac.active = (ac.active + delta + ac.items.length) % ac.items.length;
    [...ac.list.children].forEach((li, k) => li.setAttribute('aria-selected', k === ac.active ? 'true' : 'false'));
    ac.input.setAttribute('aria-activedescendant', `ac-${ac.stop.id}-${ac.active}`);
    const li = ac.list.children[ac.active];
    if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
  }

  async function search(input, stop, q, pickFirst) {
    const a = acList(input, stop);
    if (a.ctrl) a.ctrl.abort();
    const ctrl = new AbortController();
    a.ctrl = ctrl;
    if (!a.items.length) acInfo(input, stop, 'Ricerca in corso…');
    let items = [];
    try {
      items = await API.geocode(q, map.getCenter(), ctrl.signal);
    } catch (e) {
      if (e.code === 'aborted') return;
    }
    if (!items.length && !ctrl.signal.aborted) {
      try { items = await API.geocodeFallback(q, ctrl.signal); } catch (e) { if (e.code === 'aborted') return; }
    }
    if (ctrl.signal.aborted || !ac || ac.input !== input) return;
    ac.ctrl = null;
    if (!items.length) { acInfo(input, stop, 'Nessun risultato. Prova con città e via, oppure tocca la mappa.'); return; }
    if (pickFirst) { chooseItem(stop, items[0], input); return; }
    acShow(input, stop, items);
  }

  function attachAutocomplete(input, stop) {
    let timer = null;
    input.addEventListener('input', () => {
      stop.label = input.value; stop.lat = null; stop.lon = null;
      if (state.isExample) { state.isExample = false; $('#example-chip').hidden = true; }
      input.classList.remove('invalid');
      renderMarkers(); persist();
      clearTimeout(timer);
      const q = input.value.trim();
      const c = C.parseCoords(q);
      if (c) { acShow(input, stop, [{ main: 'Usa le coordinate', sub: fmtCoords(c[0], c[1]), label: fmtCoords(c[0], c[1]), lat: c[0], lon: c[1] }]); return; }
      if (q.length < 3) { closeAc(); return; }
      timer = setTimeout(() => search(input, stop, q, false), 300);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); acMove(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); acMove(-1); }
      else if (e.key === 'Escape') closeAc();
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (ac && ac.input === input && ac.items.length) chooseItem(stop, ac.items[Math.max(0, ac.active)], input);
        else if (input.value.trim().length >= 2) { clearTimeout(timer); search(input, stop, input.value.trim(), true); }
      }
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (ac && ac.input === input && document.activeElement !== input) closeAc();
        if (stop.label && stop.lat == null) input.classList.add('invalid');
      }, 200);
    });
  }

  function chooseItem(stop, item, input) {
    stop.label = item.label; stop.lat = item.lat; stop.lon = item.lon;
    input.value = item.label;
    input.classList.remove('invalid');
    closeAc();
    input.blur();
    renderMarkers(); persist();
    const set = state.stops.filter((s) => s.lat != null);
    if (set.length === 1) flyTo(item.lat, item.lon, 12);
    else if (!state.route) fitAll();
    onStopsChanged();
  }

  let autoTimer = null;
  function onStopsChanged(immediate) {
    $('#route-error').hidden = true;
    if (!state.route) return;
    const ready = state.stops.filter((s) => s.lat != null).length >= 2 && !state.stops.some((s) => s.label && s.lat == null);
    if (!ready) { markStale(); return; }
    clearTimeout(autoTimer);
    autoTimer = setTimeout(computeRoute, immediate ? 0 : 400);
  }

  /* ------------------------------------------------------------------ */
  /* Mezzo                                                               */
  /* ------------------------------------------------------------------ */
  const DIMS = ['lunghezza', 'altezza', 'larghezza', 'peso', 'caricoAsse', 'assi'];

  function renderVehicle() {
    const v = state.vehicle;
    const sel = $('#in-preset');
    sel.replaceChildren();
    const g1 = h('optgroup', { label: 'Mezzi tipo' });
    C.PRESETS.forEach((p) => g1.append(h('option', { value: 'p:' + p.id, text: p.nome })));
    sel.append(g1);
    if (state.garage.length) {
      const g2 = h('optgroup', { label: 'Il mio garage' });
      state.garage.forEach((g) => g2.append(h('option', { value: 'g:' + g.nome, text: g.nome })));
      sel.append(g2);
    }
    sel.append(h('option', { value: 'custom', text: 'Personalizzato' }));
    sel.value = state.presetId;
    if (sel.value !== state.presetId) sel.value = 'custom';
    for (const k of DIMS) {
      const input = $('#in-' + k);
      if (document.activeElement !== input) input.value = String(v[k]);
    }
    $('#in-margin').value = String(state.margin);
    if ($('#in-margin').value === '') $('#in-margin').value = '0.1';
    renderSigns();
    renderGarage();
  }

  function renderSigns() {
    const v = state.vehicle;
    $('#vs-name').textContent = v.nome;
    $('#vs-signs').innerHTML = signSVG('altezza', dec1(v.altezza)) + signSVG('lunghezza', C.fmtNum(v.lunghezza)) + signSVG('peso', C.fmtNum(v.peso) + 't');
    $('#vehicle-strip').setAttribute('aria-label', `Mezzo: ${v.nome}, altezza ${C.fmtNum(v.altezza)} metri, lunghezza ${C.fmtNum(v.lunghezza)} metri, ${C.fmtNum(v.peso)} tonnellate. Cambia mezzo`);
    const fig = (kind, text, cap) => `<figure>${signSVG(kind, text)}<figcaption>${esc(cap)}</figcaption></figure>`;
    $('#sign-board').innerHTML =
      fig('altezza', dec1(v.altezza), 'Altezza') +
      fig('larghezza', dec1(v.larghezza), 'Larghezza') +
      fig('lunghezza', C.fmtNum(v.lunghezza), 'Lunghezza') +
      fig('peso', C.fmtNum(v.peso) + 't', 'Massa');
  }

  function renderGarage() {
    const ul = $('#garage-list');
    ul.replaceChildren();
    if (!state.garage.length) {
      ul.append(h('li', { class: 'garage-empty', style: 'border:0;padding:0' }, 'Salva qui i mezzi della tua flotta per richiamarli al volo.'));
      return;
    }
    state.garage.forEach((g) => {
      const v = g.vehicle;
      ul.append(h('li', null,
        h('span', { class: 'g-name' }, h('b', { text: g.nome }), h('small', { text: `${C.fmtNum(v.lunghezza)} × ${C.fmtNum(v.larghezza)} m · h ${C.fmtNum(v.altezza)} m · ${C.fmtNum(v.peso)} t` })),
        h('button', { type: 'button', class: 'btn-ghost', onclick: () => useGarage(g) }, 'Usa'),
        h('button', { type: 'button', class: 'btn-ghost', 'aria-label': 'Elimina ' + g.nome, onclick: () => {
          state.garage = state.garage.filter((x) => x !== g);
          if (state.presetId === 'g:' + g.nome) state.presetId = 'custom';
          persist(); renderVehicle();
        } }, 'Elimina')));
    });
  }

  function useGarage(g) {
    state.vehicle = C.sanitizeVehicle(Object.assign({}, g.vehicle, { nome: g.nome }));
    if (g.margin != null) state.margin = g.margin;
    state.presetId = 'g:' + g.nome;
    persist(); renderVehicle(); markStale();
    toast(`Mezzo selezionato: ${g.nome}`);
  }

  $('#in-preset').addEventListener('change', (e) => {
    const val = e.target.value;
    if (val.startsWith('p:')) {
      const p = C.PRESETS.find((x) => 'p:' + x.id === val);
      state.vehicle = C.sanitizeVehicle(p);
      state.presetId = val;
    } else if (val.startsWith('g:')) {
      const g = state.garage.find((x) => 'g:' + x.nome === val);
      if (g) { useGarage(g); return; }
    } else {
      state.presetId = 'custom';
      state.vehicle.nome = 'Mezzo personalizzato';
    }
    persist(); renderVehicle(); markStale();
  });

  for (const k of DIMS) {
    const input = $('#in-' + k);
    input.addEventListener('input', () => {
      const x = parseFloat(String(input.value).replace(',', '.'));
      if (!isFinite(x)) return;
      const [lo, hi] = C.LIMITS[k];
      if (x < lo || x > hi) return;
      state.vehicle[k] = x;
      if (state.presetId !== 'custom') { state.presetId = 'custom'; state.vehicle.nome = 'Mezzo personalizzato'; $('#in-preset').value = 'custom'; }
      renderSigns(); persist(); markStale();
    });
    input.addEventListener('change', () => {
      const x = parseFloat(String(input.value).replace(',', '.'));
      const tmp = Object.assign({}, state.vehicle, { [k]: isFinite(x) ? x : state.vehicle[k] });
      state.vehicle = C.sanitizeVehicle(tmp);
      input.value = String(state.vehicle[k]);
      state.presetId = matchPreset(state.vehicle);
      if (state.presetId === 'custom') state.vehicle.nome = 'Mezzo personalizzato';
      persist(); renderVehicle(); markStale();
    });
  }
  $('#in-margin').addEventListener('change', (e) => { state.margin = Number(e.target.value) || 0; persist(); markStale(); });
  $('#vehicle-strip').addEventListener('click', () => showTab('mezzo'));
  $('#btn-save-vehicle').addEventListener('click', () => {
    const name = $('#in-vname').value.trim();
    if (!name) { $('#in-vname').focus(); toast('Dai un nome al mezzo, per esempio modello e targa.'); return; }
    const entry = { nome: name.slice(0, 60), vehicle: Object.assign({}, state.vehicle, { nome: name.slice(0, 60) }), margin: state.margin };
    state.garage = state.garage.filter((g) => g.nome !== entry.nome).concat(entry);
    state.vehicle.nome = entry.nome;
    state.presetId = 'g:' + entry.nome;
    $('#in-vname').value = '';
    persist(); renderVehicle();
    toast(`Salvato nel garage: ${entry.nome}`);
  });

  /* ------------------------------------------------------------------ */
  /* Preferenze di viaggio                                               */
  /* ------------------------------------------------------------------ */
  function renderOptions() {
    const o = state.options;
    $('#in-departure').value = state.departure;
    $('#in-breaks').value = state.breakMode;
    $('#opt-hgv').checked = o.strictHgv;
    $('#opt-tolls').checked = o.avoidTolls;
    $('#opt-highways').checked = o.avoidHighways;
    $('#opt-ferries').checked = o.avoidFerries;
    $('#opt-vmax').value = String(o.vmax);
    $('#opt-engine').value = o.engine;
    $('#opt-orskey').value = o.orsKey || '';
    $('#opt-tomtomkey').value = o.tomtomKey || '';
    $('#opt-mapillary').value = o.mapillaryToken || '';
    $('#ors-key-field').hidden = o.engine !== 'ors';
  }
  $('#in-departure').addEventListener('change', (e) => {
    if (!e.target.value) return;
    state.departure = e.target.value; persist(); if (state.route) replan();
  });
  $('#in-breaks').addEventListener('change', (e) => { state.breakMode = e.target.value; persist(); if (state.route) replan(); });
  const optBind = (id, key, conv) => $(id).addEventListener('change', (e) => {
    state.options[key] = conv(e.target);
    persist(); markStale();
    if (key === 'engine') $('#ors-key-field').hidden = state.options.engine !== 'ors';
  });
  optBind('#opt-hgv', 'strictHgv', (t) => t.checked);
  optBind('#opt-tolls', 'avoidTolls', (t) => t.checked);
  optBind('#opt-highways', 'avoidHighways', (t) => t.checked);
  optBind('#opt-ferries', 'avoidFerries', (t) => t.checked);
  optBind('#opt-vmax', 'vmax', (t) => Number(t.value));
  optBind('#opt-engine', 'engine', (t) => t.value);
  $('#opt-orskey').addEventListener('change', (e) => { state.options.orsKey = e.target.value.trim(); persist(); markStale(); });
  $('#opt-tomtomkey').addEventListener('change', (e) => { state.options.tomtomKey = e.target.value.trim(); persist(); markStale(); });
  $('#opt-mapillary').addEventListener('change', (e) => { state.options.mapillaryToken = e.target.value.trim(); persist(); mapillaryCache.clear(); });

  function markStale() {
    if (!state.route) return;
    state.stale = true;
    $('#stale').hidden = false;
    $('#btn-route').textContent = 'Ricalcola percorso';
  }

  /* ------------------------------------------------------------------ */
  /* Calcolo del percorso                                                */
  /* ------------------------------------------------------------------ */
  let seq = 0, workCtrl = null;

  function setBusy(on) {
    const b = $('#btn-route');
    b.disabled = on;
    $('#btn-recalc').disabled = on;
    b.replaceChildren();
    if (on) b.append(h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Calcolo in corso…');
    else b.textContent = state.route ? 'Ricalcola percorso' : 'Calcola percorso';
  }

  function showError(msg) {
    const p = $('#route-error');
    p.textContent = msg;
    p.hidden = false;
    if ($('#view-viaggio').hidden) toast(msg, 7000);
  }

  async function computeRoute() {
    clearTimeout(autoTimer);
    closeAc();
    $('#route-error').hidden = true;
    const pending = state.stops.find((s) => s.label && s.lat == null);
    if (pending) {
      showTab('viaggio');
      showError(`Scegli “${pending.label}” dall'elenco dei risultati, oppure tocca il punto sulla mappa.`);
      const input = document.getElementById('stop-' + pending.id);
      if (input) input.classList.add('invalid');
      return;
    }
    const valid = state.stops.filter((s) => s.lat != null);
    if (valid.length < 2) { showTab('viaggio'); showError('Servono almeno una partenza e una destinazione.'); return; }
    if (state.options.engine === 'ors' && !state.options.orsKey) {
      showTab('viaggio'); $('#opt-details').open = true;
      showError('Per usare openrouteservice inserisci la chiave gratuita, oppure scegli Valhalla.');
      return;
    }

    const my = ++seq;
    if (workCtrl) workCtrl.abort();
    workCtrl = new AbortController();
    const signal = workCtrl.signal;
    setBusy(true);
    try {
      const veh = Object.assign({}, state.vehicle);
      const opt = Object.assign({}, state.options);
      const r = opt.engine === 'ors'
        ? await API.routeOrs(valid, veh, state.margin, opt, opt.orsKey, signal)
        : await API.routeValhalla(valid, veh, state.margin, opt, signal);
      if (my !== seq) return;
      r.stops = valid.map((s) => ({ id: s.id, label: s.label, lat: s.lat, lon: s.lon }));
      r.stopIdx = valid.map((s) => state.stops.indexOf(s));
      r.vehicle = veh;
      r.margin = state.margin;
      r.options = opt;
      state.route = r;
      state.analysis = { status: 'loading' };
      state.parkings = { status: 'loading' };
      state.permits = { status: 'loading' };
      state.tomtom = state.options.tomtomKey ? { status: 'loading' } : null;
      state.stale = false;
      $('#stale').hidden = true;
      drawRoute();
      lg.hazards.clearLayers(); lg.parks.clearLayers();
      replan();
      renderResult();
      showTab('percorso');
      fitAll();
      runParkings(my, signal); // richiesta breve: entra per prima nella coda di Overpass
      runAnalysis(my, signal);
      runPermits(my, signal);
      runTomTom(my, signal);
    } catch (e) {
      if (my !== seq || e.code === 'aborted') return;
      showError(e.message || 'Errore inatteso durante il calcolo.');
    } finally {
      if (my === seq) setBusy(false);
    }
  }
  $('#btn-route').addEventListener('click', computeRoute);
  $('#btn-recalc').addEventListener('click', computeRoute);

  /*
   * Controllo dei limiti un tratto alla volta (circa 25 km): richieste brevi che i server
   * pubblici completano in pochi secondi. I risultati compaiono man mano; i tratti senza
   * risposta si possono riprovare da soli.
   */
  async function runAnalysis(my, signal, only) {
    const r = state.route;
    if (r.distanceM > 2500e3) {
      state.analysis = { status: 'skipped', reason: 'Il percorso supera i 2.500 km: per il controllo automatico dividilo in più giorni con tappe intermedie.' };
      renderCheck(); renderHazards(); return;
    }
    if (!r.segments) r.segments = C.splitByDistance(r.coords, r.cumD, Math.max(25000, r.distanceM / 40));
    const prev = state.analysis || {};
    const elements = prev.elements instanceof Map ? prev.elements : new Map();
    const todo = only || r.segments.map((_, i) => i);
    const a = Object.assign({}, prev.hazards ? prev : {}, { status: 'loading', elements, done: 0, total: todo.length, failed: [] });
    state.analysis = a;
    renderCheck(); renderHazards();
    // dati scaricati: i tratti dentro la copertura (Italia) si controllano senza Overpass
    const dati = await API.dataIndex();
    if (my !== seq || state.analysis !== a) return;
    if (dati) a.datiOsm = dati.datiOsm || dati.generato;
    for (const i of todo) {
      const seg = r.segments[i];
      try {
        let els = null;
        if (dati && C.coordsCovered(seg.coords, dati.copertura)) {
          try {
            const tiles = await API.dataTiles(dati, C.tilesForCoords(seg.coords, dati.riquadro, 500), signal);
            els = tiles.flatMap(C.tileToElements);
            a.usaDati = true;
          } catch (e) {
            if (e.code === 'aborted') throw e;
            els = null; // riquadro non scaricabile: si usa Overpass per questo tratto
          }
        }
        if (!els) {
          els = await API.corridor(seg.coords, signal);
          a.usaOverpass = true;
        }
        if (my !== seq || state.analysis !== a) return;
        for (const el of els) elements.set(el.type + '/' + el.id, el);
      } catch (e) {
        if (my !== seq || state.analysis !== a || e.code === 'aborted') return;
        a.failed.push(i);
        a.lastError = e.message;
        a.lastDetail = e.detail;
      }
      a.done++;
      // con i dati scaricati i tratti arrivano in pochi millisecondi: si rianalizza al massimo una volta al secondo
      const lastOne = a.done === todo.length;
      if (lastOne || Date.now() - (a.analyzedAt || 0) > 1000) {
        Object.assign(a, C.analyzeElements(Array.from(elements.values()), r.index, r.vehicle, { streetAt: (al) => C.streetAtAlong(r, al) }));
        for (const sv of a.services) sv.T = C.timeAtAlong(r, sv.along);
        a.analyzedAt = Date.now();
        drawHazards(); renderHazards(); renderMini();
      }
      renderCheck();
    }
    a.status = !a.failed.length ? 'done' : (a.failed.length === todo.length && !elements.size ? 'error' : 'partial');
    if (a.status === 'error') a.reason = a.lastError;
    replan();
    renderResult();
  }

  function retryAnalysis(only) {
    if (!state.route) return;
    runAnalysis(seq, workCtrl ? workCtrl.signal : undefined, only);
  }

  /* Parcheggi per bus solo intorno al punto di arrivo, entro PARK_RADIUS metri */
  const PARK_RADIUS = 1000;
  const parkCache = new Map();

  async function runParkings(my, signal) {
    const r = state.route;
    const last = r.stops.length - 1;
    const dest = r.stops[last];
    const pts = [{ lat: dest.lat, lon: dest.lon, i: last }];
    const cacheKey = dest.lat.toFixed(5) + ',' + dest.lon.toFixed(5);
    try {
      let els = parkCache.get(cacheKey);
      if (!els) {
        const dati = await API.dataIndex();
        if (my !== seq) return;
        if (dati && C.pointInRings(dest.lat, dest.lon, dati.copertura)) {
          try {
            const tiles = await API.dataTiles(dati, C.tilesAround(dest.lat, dest.lon, PARK_RADIUS, dati.riquadro), signal);
            els = tiles.flatMap(C.tileToElements).filter((e) => e.tags && e.tags.amenity === 'parking');
            parkCache.set(cacheKey, els);
          } catch (e) {
            if (e.code === 'aborted') throw e;
            els = null;
          }
        }
      }
      for (let attempt = 0; !els; attempt++) {
        try {
          els = await API.parkings(pts, PARK_RADIUS, signal);
          parkCache.set(cacheKey, els);
          break;
        } catch (e) {
          if (e.code === 'aborted' || attempt >= 1) throw e;
          // un secondo tentativo automatico, dopo una pausa, prima di mostrare l'errore
          if (my !== seq) return;
          state.parkings = { status: 'retrying', reason: e.message };
          renderParkings();
          await API.sleep(20000, signal);
          if (my !== seq) return;
          state.parkings = { status: 'loading' };
          renderParkings();
        }
      }
      if (my !== seq) return;
      const seen = new Set();
      const groups = pts.map((p) => ({ stop: p.i, items: [] }));
      for (const el of els) {
        const key = el.type + '/' + el.id;
        if (seen.has(key)) continue;
        seen.add(key);
        const c = el.center || (el.lat != null ? { lat: el.lat, lon: el.lon } : null);
        if (!c) continue;
        let best = null;
        pts.forEach((p, k) => {
          const d = C.haversine([p.lat, p.lon], [c.lat, c.lon]);
          if (!best || d < best.d) best = { k, d };
        });
        if (!best || best.d > PARK_RADIUS) continue;
        const t = el.tags || {};
        const busTag = /^(yes|designated)$/.test(t.bus || '') || /^(yes|designated)$/.test(t.coach || '') || /^(yes|designated)$/.test(t.tourist_bus || '') || /^(bus|coach)/.test(t.parking || '');
        groups[best.k].items.push({ id: key, lat: c.lat, lon: c.lon, d: best.d, tags: t, bus: busTag });
      }
      for (const g of groups) g.items.sort((a, b) => (a.bus === b.bus ? a.d - b.d : a.bus ? -1 : 1)).splice(6);
      state.parkings = { status: 'done', groups };
    } catch (e) {
      if (my !== seq || e.code === 'aborted') return;
      state.parkings = { status: 'error', reason: e.message, detail: e.detail };
    }
    drawParkings();
    renderParkings();
  }

  function replan() {
    const r = state.route;
    if (!r) return;
    const dwell = r.stops.map((s, i) => {
      if (i === 0 || i === r.stops.length - 1) return 0;
      const cur = state.stops.find((x) => x.id === s.id);
      return cur ? cur.dwell : 0;
    });
    const services = (state.analysis && state.analysis.services) || [];
    state.plan = C.planTrip({ stopsT: r.legT, dwell, departureMs: depMs(), mode: state.breakMode, services });
    drawBreaks();
    if (!$('#res').hidden) { renderSummary(); renderTimeline(); renderMini(); }
  }

  /* ------------------------------------------------------------------ */
  /* Disegno sulla mappa                                                 */
  /* ------------------------------------------------------------------ */
  function drawRoute() {
    lg.route.clearLayers();
    const c = state.route.coords;
    L.polyline(c, { color: '#ffffff', weight: 11, opacity: 0.95, interactive: false, lineJoin: 'round' }).addTo(lg.route);
    L.polyline(c, { color: '#1d4f9c', weight: 6, opacity: 1, interactive: false, lineJoin: 'round' }).addTo(lg.route);
  }

  function popupBox(title, sub, extra) {
    return h('div', { class: 'pop' }, h('b', { text: title }), sub ? h('span', { text: sub }) : null, extra || null);
  }

  function drawHazards() {
    lg.hazards.clearLayers();
    const a = state.analysis;
    if ((!a || !a.hazards) && !(state.tomtom && state.tomtom.status === 'done')) return;
    hazardMarkers.clear();
    for (const hz of allHazards()) {
      const maybe = hz.rel === 'vicino';
      const icon = L.divIcon({ className: '', html: `<div class="hz-marker ${hz.severity}${maybe ? ' maybe' : ''}">${hazardSign(hz)}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      const mk = L.marker([hz.lat, hz.lon], { icon, zIndexOffset: maybe ? 400 : hz.severity === 'red' ? 600 : 500, title: hz.title + (maybe ? ' (forse non sul percorso)' : '') })
        .on('click', () => openHazardPopup(hz))
        .addTo(lg.hazards);
      hazardMarkers.set(hz.ids[0], mk);
    }
  }

  /* ---------- scheda di un punto critico ---------- */
  const hazardMarkers = new Map();
  const placeNames = new Map();

  /* orario stimato di passaggio in un punto del percorso, secondo il programma */
  function clockAtAlong(along) {
    const r = state.route, p = state.plan;
    if (!r || !p) return null;
    const T = C.timeAtAlong(r, along);
    let ev = p.events[0];
    for (const e of p.events) { if (e.T <= T) ev = e; else break; }
    return ev.depart + (T - ev.T) * 1000;
  }

  function hazardKm(hz) {
    const km = hz.alongStart / 1000;
    return `km ${C.fmtNum(km, km < 10 ? 1 : 0)}`;
  }

  function hazardWhereShort(hz) {
    const eta = clockAtAlong(hz.alongStart);
    return [hz.name || C.streetAtAlong(state.route, hz.alongStart) || 'strada senza nome', hazardKm(hz), eta ? 'verso le ' + C.fmtClock(eta, depMs()) : ''].filter(Boolean).join(' · ');
  }

  function streetViewUrl(hz) {
    return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${hz.lat.toFixed(6)},${hz.lon.toFixed(6)}`;
  }

  const TT_VERDICT = {
    passa: 'TomTom percorre questo tratto con le dimensioni del tuo mezzo.',
    evita: 'Anche TomTom evita questo tratto con il tuo mezzo: il limite è probabilmente reale.',
    altrove: 'TomTom fa passare sia il bus sia l\'auto da un\'altra strada: qui non si può confrontare.',
  };
  /* giudizio di TomTom, con l'avviso quando contraddice un limite "non transitabile" */
  function ttText(hz) {
    if (hz.tomtom === 'passa' && hz.severity === 'red') return 'TomTom invece percorre questo tratto con le dimensioni del tuo mezzo: i due dati non concordano, verifica con Street View o con le foto Mapillary.';
    return TT_VERDICT[hz.tomtom];
  }
  const mapillaryCache = new Map();
  const SIGN_IT = [[/height/i, 'altezza massima'], [/weight/i, 'peso massimo'], [/width/i, 'larghezza massima'], [/length/i, 'lunghezza massima'],
    [/axle/i, 'carico per asse'], [/bus/i, 'divieto per bus'], [/heavy|truck|goods/i, 'divieto per mezzi pesanti']];

  function fmtDay(iso) {
    const d = new Date(iso);
    return isFinite(d) ? d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  }

  /* data, versione e fonte del dato OSM, più i motivi di dubbio */
  function hazardTrust(hz) {
    const m = hz.meta;
    if (!m) return null;
    const parts = [];
    if (m.date) parts.push('modificato il ' + fmtDay(m.date) + (m.version ? ` (versione ${m.version})` : ''));
    const src = C.sourceLabel(m.source);
    parts.push(src ? 'fonte: ' + src : 'fonte non indicata');
    if (m.checked) parts.push('verificato il ' + fmtDay(m.checked));
    const box = h('div', { class: 'hzpop-trust' }, h('span', null, h('b', { text: 'Dato OpenStreetMap: ' }), parts.join(' · ') + '.'));
    for (const d of C.hazardDoubts(hz)) box.append(h('span', { class: 'hz-doubt', text: d }));
    return box;
  }

  /* foto Mapillary del punto (con token) o collegamento al visore (senza) */
  function mapillaryBlock(hz) {
    const token = state.options.mapillaryToken;
    const viewer = `https://www.mapillary.com/app/?lat=${hz.lat.toFixed(6)}&lng=${hz.lon.toFixed(6)}&z=18`;
    if (!token) return null;
    const box = h('div', { class: 'hzpop-photo' }, h('span', { class: 'hz-meta', text: 'Cerco una foto del punto su Mapillary…' }));
    const key = hz.lat.toFixed(5) + ',' + hz.lon.toFixed(5);
    const show = (res) => {
      box.replaceChildren();
      if (!res) { box.append(h('span', { class: 'hz-meta', text: 'Nessuna foto Mapillary disponibile qui.' })); return; }
      if (res.image && res.image.thumb_256_url) {
        box.append(h('a', { href: `https://www.mapillary.com/app/?pKey=${encodeURIComponent(res.image.id)}&focus=photo`, target: '_blank', rel: 'noopener' },
          h('img', { src: res.image.thumb_256_url, alt: 'Foto stradale del punto (Mapillary)', loading: 'lazy' })));
        if (res.image.captured_at) box.append(h('span', { class: 'hz-meta', text: 'Foto del ' + fmtDay(res.image.captured_at) + ' · Mapillary' }));
      } else box.append(h('a', { href: viewer, target: '_blank', rel: 'noopener' }, 'Nessuna foto qui: apri la mappa Mapillary'));
      const names = Array.from(new Set(res.signs.map((f) => { const m = SIGN_IT.find(([re]) => re.test(f.object_value)); return m ? m[1] : null; }).filter(Boolean)));
      box.append(h('span', { class: names.length ? 'tt-verdict passa' : 'hz-meta', text: names.length ? 'Cartelli rilevati nelle foto Mapillary: ' + names.join(', ') + '.' : 'Nelle foto Mapillary non risultano cartelli di limite in questo punto.' }));
      const img = box.querySelector('img');
      if (img) img.addEventListener('load', refreshPopup, { once: true });
      refreshPopup();
    };
    if (mapillaryCache.has(key)) show(mapillaryCache.get(key));
    else {
      API.mapillaryNear(hz.lat, hz.lon, token)
        .then((res) => { const v = res.image || res.signs.length ? res : null; mapillaryCache.set(key, v); show(v); })
        .catch((e) => { box.replaceChildren(h('span', { class: 'hz-meta', text: e.message || 'Mapillary non disponibile.' })); });
    }
    return box;
  }

  /* per i punti "vicino al percorso": spiegazione, indizi e decisione dell'operatore */
  function relevanceBlock(hz) {
    if (hz.promoted === 'nome') return h('p', { class: 'tt-verdict passa', text: 'Riconosciuto sul percorso: la strada del limite ha lo stesso nome o sigla di quella percorsa.' });
    if (hz.confermato) {
      return h('div', { class: 'hzpop-decide' }, h('span', { class: 'tt-verdict passa', text: 'Confermato da te: riguarda il percorso.' }),
        h('button', { type: 'button', class: 'btn-ghost', onclick: () => setDecision(hz, null) }, 'Annulla'));
    }
    if (hz.rel !== 'vicino') return null;
    const r = hz.road || {};
    const tipo = r.bridge && r.bridge !== 'no' ? 'è su un ponte o viadotto' : r.tunnel && r.tunnel !== 'no' ? 'è in galleria' : 'non risulta né su un ponte né in galleria';
    const dist = Math.max(1, Math.round(hz.distM || 0));
    return h('div', { class: 'hzpop-maybe' },
      h('b', { text: 'Forse non sul percorso' }),
      h('span', { text: `Il limite è su una strada a ${dist} m dal percorso che non coincide con quella percorsa; la strada del limite ${tipo}. Potrebbe passare sotto un viadotto o essere una laterale: controlla con Street View e indica se riguarda il tuo tragitto.` }),
      h('div', { class: 'hzpop-decide' },
        h('button', { type: 'button', class: 'btn-secondary', onclick: () => setDecision(hz, 'si') }, 'Riguarda il percorso'),
        h('button', { type: 'button', class: 'btn-secondary', onclick: () => setDecision(hz, 'no') }, 'Non riguarda il percorso')));
  }

  function hazardCard(hz) {
    const span = hz.alongEnd - hz.alongStart;
    const eta = clockAtAlong(hz.alongStart);
    const osm = hz.ids[0].split('/');
    const isOsm = !hz.ids[0].startsWith('tomtom/');
    const near = h('dd', { text: placeNames.get(hz.ids[0]) || 'ricerca…' });
    if (!placeNames.has(hz.ids[0])) {
      API.reverse(hz.lat, hz.lon)
        .then((label) => { placeNames.set(hz.ids[0], label || 'non disponibile'); near.textContent = label || 'non disponibile'; refreshPopup(); })
        .catch(() => { near.textContent = 'non disponibile'; });
    }
    const percorsa = C.streetAtAlong(state.route, hz.alongStart);
    const rows = [['Strada percorsa', percorsa || 'non indicata']];
    if (isOsm) rows.push(['Strada del limite', hz.name || 'senza nome']);
    if (hz.rel === 'vicino' && hz.distM != null) rows.push(['Distanza dal percorso', `${Math.max(1, Math.round(hz.distM))} m`]);
    rows.push(['Posizione', hazardKm(hz) + ' dalla partenza'], ['Vicino a', near]);
    if (eta) rows.push(['Ci arrivi', 'verso le ' + C.fmtClock(eta, depMs())]);
    if (span > 150) rows.push(['Tratto', C.fmtDist(span)]);
    return h('div', { class: 'hzpop' },
      h('div', { class: 'hzpop-head' },
        h('span', { class: hz.rel === 'vicino' ? 'maybe' : null, svg: hazardSign(hz) }),
        h('span', null, h('b', { text: hz.title }), h('span', { class: `sev sev-${hz.severity}-bg`, text: hz.severity === 'red' ? 'Non transitabile' : 'Da verificare' }),
          hz.rel === 'vicino' ? h('span', { class: 'maybe-tag', text: 'Forse non sul percorso' }) : null)),
      h('p', { text: hz.detail }),
      h('dl', null, rows.flatMap(([k, v]) => [h('dt', { text: k }), v.nodeType ? v : h('dd', { text: v })])),
      relevanceBlock(hz),
      hazardTrust(hz),
      hz.tomtom && hz.kind !== 'tomtom' ? h('p', { class: 'tt-verdict ' + hz.tomtom + (hz.severity === 'red' && hz.tomtom === 'passa' ? ' conflitto' : ''), text: ttText(hz) }) : null,
      !state.tomtom && isOsm ? h('p', { class: 'hz-meta', text: 'Per una seconda verifica con TomTom aggiungi la chiave nelle preferenze di percorso.' }) : null,
      mapillaryBlock(hz),
      h('p', { class: 'hzpop-advice' }, h('b', { text: 'Cosa fare: ' }), C.hazardAdvice(hz)),
      h('div', { class: 'hz-links' },
        h('a', { href: streetViewUrl(hz), target: '_blank', rel: 'noopener' }, 'Street View'),
        h('a', { href: `https://www.mapillary.com/app/?lat=${hz.lat.toFixed(6)}&lng=${hz.lon.toFixed(6)}&z=18`, target: '_blank', rel: 'noopener' }, 'Foto Mapillary'),
        h('a', { href: `https://www.openstreetmap.org/note/new#map=19/${hz.lat.toFixed(6)}/${hz.lon.toFixed(6)}`, target: '_blank', rel: 'noopener' }, isOsm ? 'Segnala un errore' : 'Segnala il limite su OSM'),
        isOsm ? h('a', { href: `https://www.openstreetmap.org/${osm[0]}/${osm[1]}`, target: '_blank', rel: 'noopener' }, 'Dati OSM') : null));
  }

  function openHazardPopup(hz) {
    for (const mk of hazardMarkers.values()) { const el = mk.getElement(); if (el && el.firstChild) el.firstChild.classList.remove('focus'); }
    const mk = hazardMarkers.get(hz.ids[0]);
    const el = mk && mk.getElement();
    if (el && el.firstChild) el.firstChild.classList.add('focus');
    const pad = mapPadding();
    // la scheda non supera lo spazio visibile della mappa: se serve, scorre al suo interno
    const bottom = isWide() ? window.innerHeight : panel.getBoundingClientRect().top;
    const maxHeight = Math.max(220, bottom - pad.paddingTopLeft[1] - 40);
    hzPopup = L.popup({ maxWidth: 300, minWidth: 230, maxHeight, className: 'hz-popup', offset: [0, -12], autoPanPaddingTopLeft: pad.paddingTopLeft, autoPanPaddingBottomRight: pad.paddingBottomRight })
      .setLatLng([hz.lat, hz.lon]).setContent(hazardCard(hz)).openOn(map);
  }

  /* dopo un aggiornamento del contenuto (località, foto) la scheda si riposiziona */
  let hzPopup = null;
  function refreshPopup() {
    if (hzPopup && hzPopup.isOpen()) hzPopup.update();
  }

  /* porta la mappa sul punto e apre la scheda */
  function focusHazard(hz) {
    flyTo(hz.lat, hz.lon, 17);
    setTimeout(() => openHazardPopup(hz), isWide() ? 350 : 700);
  }

  function drawBreaks() {
    lg.breaks.clearLayers();
    const r = state.route, p = state.plan;
    if (!r || !p) return;
    for (const ev of p.events) {
      if (ev.type !== 'pausa') continue;
      const pt = ev.place ? [ev.place.lat, ev.place.lon] : r.index.pointAt(C.alongAtTime(r, ev.T));
      ev.lat = pt[0]; ev.lon = pt[1];
      const icon = L.divIcon({ className: '', html: `<div class="brk-marker">${ev.minutes}′</div>`, iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] });
      L.marker(pt, { icon, zIndexOffset: 300, title: 'Pausa ' + ev.minutes + ' minuti' })
        .bindPopup(() => popupBox(`Pausa ${ev.minutes}′ · ${C.fmtClock(ev.arrive)}`, ev.place ? ev.place.name : 'Scegli un\'area di sosta idonea in questo tratto'))
        .addTo(lg.breaks);
    }
  }

  function parkingName(it) {
    const t = it.tags;
    return t.name || (it.bus ? 'Parcheggio bus' : 'Parcheggio mezzi pesanti');
  }
  function parkingMeta(it) {
    const t = it.tags, out = [];
    out.push(`a ${C.fmtDist(it.d)}`);
    if (t.fee === 'yes') out.push('a pagamento');
    else if (t.fee === 'no') out.push('gratuito');
    if (t['capacity:bus'] || t['capacity:coach']) out.push(`${t['capacity:bus'] || t['capacity:coach']} posti bus`);
    if (t.access === 'private' || t.access === 'customers') out.push(t.access === 'private' ? 'privato' : 'solo clienti');
    if (t.opening_hours) out.push(t.opening_hours);
    if (!it.bus) out.push('verifica che accetti bus');
    return out.join(' · ');
  }

  function drawParkings() {
    lg.parks.clearLayers();
    const p = state.parkings;
    if (!p || p.status !== 'done') return;
    for (const g of p.groups) {
      for (const it of g.items) {
        const icon = L.divIcon({ className: '', html: '<div class="pk-marker">P<small>BUS</small></div>', iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] });
        L.marker([it.lat, it.lon], { icon, zIndexOffset: 200, title: parkingName(it) })
          .bindPopup(() => popupBox(parkingName(it), parkingMeta(it)))
          .addTo(lg.parks);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Pannello dei risultati                                              */
  /* ------------------------------------------------------------------ */
  /* ---------- decisioni dell'operatore sui punti "vicino al percorso" (per viaggio, su questo dispositivo) ---------- */
  const DECISIONS_KEY = 'rotta-pullman/decisioni';
  let decisions = {};
  try { decisions = JSON.parse(localStorage.getItem(DECISIONS_KEY)) || {}; } catch (e) { decisions = {}; }
  function tripKey() {
    const r = state.route;
    return r ? r.stops.map((x) => x.lat.toFixed(4) + ',' + x.lon.toFixed(4)).join(';') : '';
  }
  function decisionOf(hz) { return decisions[tripKey() + '|' + hz.ids[0]] || null; }
  function setDecision(hz, val) {
    const k = tripKey() + '|' + hz.ids[0];
    if (val) decisions[k] = val; else delete decisions[k];
    const keys = Object.keys(decisions);
    if (keys.length > 800) for (const x of keys.slice(0, keys.length - 800)) delete decisions[x];
    try { localStorage.setItem(DECISIONS_KEY, JSON.stringify(decisions)); } catch (e) { /* memoria non disponibile */ }
    map.closePopup();
    drawHazards(); renderCheck(); renderHazards(); renderMini();
    toast(val === 'no' ? 'Punto escluso: non riguarda il percorso.' : val === 'si' ? 'Punto confermato sul percorso.' : 'Decisione annullata.');
  }

  /*
   * Tutti i punti: quelli di OpenStreetMap (sul percorso o vicino), con il giudizio di TomTom e la
   * decisione dell'operatore, più i tratti evitati solo da TomTom.
   */
  function hazardsWithStatus() {
    const a = state.analysis;
    const base = (a && a.hazards) || [];
    const tt = state.tomtom && state.tomtom.status === 'done' ? state.tomtom.cmp : null;
    const out = base.map((hz) => {
      const o = Object.assign({}, hz);
      if (tt) o.tomtom = tt.verdict(hz.alongStart, hz.alongEnd);
      o.decisione = decisionOf(hz);
      if (o.decisione === 'si' && o.rel === 'vicino') { o.rel = 'certo'; o.confermato = true; }
      return o;
    });
    if (tt) {
      tt.avoided.forEach((run, i) => {
        if (base.some((hz) => hz.alongStart <= run.alongEnd + 150 && hz.alongEnd >= run.alongStart - 150)) return; // già tra i punti OSM
        const pt = state.route.index.pointAt(Math.min(run.alongEnd, run.alongStart + 50));
        const o = {
          kind: 'tomtom', severity: 'amber', rel: 'certo', value: null, title: 'Tratto evitato da TomTom',
          detail: 'Con le dimensioni del tuo mezzo TomTom passa da un\'altra strada; con un\'auto percorre questo tratto.',
          ids: ['tomtom/' + (i + 1)], name: '', alongStart: run.alongStart, alongEnd: run.alongEnd, lat: pt[0], lon: pt[1], tomtom: 'evita', meta: null,
        };
        o.decisione = decisionOf(o);
        out.push(o);
      });
    }
    out.sort(C.hazardOrder);
    return out;
  }
  function allHazards() { return hazardsWithStatus().filter((hz) => hz.decisione !== 'no'); }
  function excludedHazards() { return hazardsWithStatus().filter((hz) => hz.decisione === 'no'); }

  function hazardCounts() {
    const a = state.analysis;
    const ttDone = state.tomtom && state.tomtom.status === 'done';
    if ((!a || !a.hazards) && !ttDone) return null;
    const list = allHazards();
    const sure = list.filter((x) => x.rel !== 'vicino');
    return {
      red: sure.filter((x) => x.severity === 'red').length,
      amber: sure.filter((x) => x.severity === 'amber').length,
      vicino: list.length - sure.length,
    };
  }

  async function runTomTom(my, signal) {
    const r = state.route;
    const key = r.options && r.options.tomtomKey;
    if (!key) { state.tomtom = null; return; }
    try {
      const [bus, car] = await Promise.all([
        API.tomtomRoute(r.stops, r.vehicle, r.margin, r.options, key, 'bus', signal),
        API.tomtomRoute(r.stops, r.vehicle, r.margin, r.options, key, 'car', signal),
      ]);
      if (my !== seq) return;
      state.tomtom = { status: 'done', cmp: C.compareRoutes(r, bus, car) };
    } catch (e) {
      if (my !== seq || e.code === 'aborted') return;
      state.tomtom = { status: 'error', reason: e.message };
    }
    drawHazards(); renderCheck(); renderHazards(); renderMini();
  }

  function tomtomNote() {
    const t = state.tomtom;
    if (!t) return null;
    if (t.status === 'loading') return 'Seconda verifica con TomTom in corso…';
    if (t.status === 'error') return 'Seconda verifica con TomTom non riuscita: ' + t.reason;
    const n = t.cmp.avoided.length, pct = Math.round(t.cmp.shared * 100);
    return `Seconda verifica con TomTom: ${n ? plural(n, 'tratto evitato', 'tratti evitati') : 'nessun tratto evitato'} con le dimensioni del tuo mezzo (percorso in comune al ${pct}%).`;
  }

  function renderResult() {
    const has = !!state.route;
    $('#res-empty').hidden = has;
    $('#res').hidden = !has;
    if (!has) return;
    renderSummary(); renderCheck(); renderPermits(); renderTimeline(); renderHazards(); renderParkings(); renderSteps(); renderMini();
  }

  function renderSummary() {
    const r = state.route, p = state.plan;
    $('#sum-km').textContent = C.fmtDist(r.distanceM);
    $('#sum-drive').textContent = C.fmtDur(p.driveS);
    const end = C.fmtClock(p.endMs, depMs());
    $('#sum-arrive').textContent = end.replace(/ \(\+(\d+) g\)/, ' +$1g');
    const chips = $('#sum-chips');
    chips.replaceChildren();
    if (r.flags.autostrada) chips.append(h('span', { class: 'chip chip-motorway' }, 'Autostrada'));
    if (r.flags.pedaggi) chips.append(h('span', { class: 'chip' }, 'Pedaggi'));
    if (r.flags.traghetto) chips.append(h('span', { class: 'chip' }, 'Traghetto'));
    const pauses = p.events.filter((e) => e.type === 'pausa');
    chips.append(h('span', { class: 'chip chip-accent' }, pauses.length ? `${pauses.length} ${pauses.length === 1 ? 'pausa' : 'pause'} autista` : 'Nessuna pausa obbligatoria'));
    chips.append(h('span', { class: 'chip' }, r.engine === 'ors' ? 'openrouteservice · bus' : 'Valhalla · mezzo pesante'));
    const needed = permitGroups().filter((g) => g.rule && g.rule.stato !== 'verifica');
    if (needed.length) {
      const names = needed.map((g) => g.place.nome).join(', ');
      chips.prepend(h('button', { type: 'button', class: 'chip chip-permit', title: 'Vai ai permessi', onclick: () => $('#permits-sec').scrollIntoView({ behavior: 'smooth', block: 'start' }) },
        `Permesso bus: ${names}`));
    }
  }

  function renderMini() {
    const mini = $('#mini-sum');
    const dot = $('#tab-dot');
    if (!state.route) { mini.textContent = 'Percorsi per bus turistici'; dot.hidden = true; return; }
    const r = state.route, p = state.plan;
    mini.replaceChildren(h('b', { text: C.fmtDist(r.distanceM) }), ' · ', C.fmtDur(p.driveS) + ' · arrivo ' + C.fmtClock(p.endMs, depMs()));
    const c = hazardCounts();
    dot.hidden = false;
    dot.className = 'tab-dot';
    if (c && c.red) { mini.append(' · ', h('span', { class: 'sev-red', text: `${c.red} critic${c.red === 1 ? 'o' : 'i'}` })); dot.className = 'tab-dot sev-red'; }
    else if (c && c.amber) { mini.append(' · ', h('span', { class: 'sev-amber', text: `${c.amber} da verificare` })); dot.className = 'tab-dot sev-amber'; }
    else if (c && c.vicino) { mini.append(' · ', h('span', { class: 'sev-amber', text: `${c.vicino} vicino al percorso` })); dot.className = 'tab-dot sev-amber'; }
  }

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  /* da dove vengono i dati del controllo, e se sono troppo vecchi */
  function dataSourceNote(a) {
    if (!a.usaDati) return a.usaOverpass ? { text: 'Dati OpenStreetMap in tempo reale (Overpass).' } : null;
    const when = new Date(a.datiOsm);
    const day = isFinite(when) ? when.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const text = `Dati OpenStreetMap del ${day}` + (a.usaOverpass ? '; per i tratti fuori Italia, dati in tempo reale.' : '.');
    const ageDays = isFinite(when) ? (Date.now() - when.getTime()) / 864e5 : 0;
    return { text, old: ageDays > 21 ? `I dati scaricati hanno ${Math.floor(ageDays)} giorni: l'aggiornamento settimanale potrebbe essersi fermato.` : null };
  }

  function checkPoints() {
    const list = allHazards();
    const ul = h('ul', { class: 'check-pts' });
    for (const hz of list.slice(0, 3)) {
      const maybe = hz.rel === 'vicino';
      ul.append(h('li', null, h('button', { type: 'button', class: 'check-pt' + (maybe ? ' maybe' : ''), onclick: () => focusHazard(hz) },
        h('span', { class: 'check-pt-sign' + (maybe ? ' maybe' : ''), svg: hazardSign(hz) }),
        h('span', { class: 'check-pt-text' }, h('b', { text: hz.title }), maybe ? h('span', { class: 'maybe-tag', text: 'Forse non sul percorso' }) : null, h('span', { text: hazardWhereShort(hz) })),
        h('span', { class: 'check-pt-go', text: 'Mappa ›' }))));
    }
    if (list.length > 3) {
      ul.append(h('li', null, h('button', { type: 'button', class: 'btn-ghost', onclick: () => $('#hazards').closest('.res-sec').scrollIntoView({ behavior: 'smooth', block: 'start' }) },
        `Vedi tutti i ${list.length} punti`)));
    }
    return ul;
  }

  function renderCheck() {
    const box = $('#check-banner');
    const a = state.analysis;
    box.className = 'osm-check';
    box.replaceChildren();
    const body = h('div', { class: 'osm-body' });
    const c = hazardCounts();
    if (!a || a.status === 'loading') {
      box.classList.add('loading');
      const tot = a && a.total;
      body.append(
        h('b', { text: tot ? `Controllo dei limiti: tratto ${Math.min(a.done + 1, tot)} di ${tot}` : 'Controllo dei limiti in corso…' }),
        'Cerco su OpenStreetMap limiti di altezza, larghezza, lunghezza, massa e divieti per bus lungo tutto il percorso.');
      if (tot) {
        body.append(h('span', { class: 'progress', role: 'progressbar', 'aria-label': 'Avanzamento del controllo', 'aria-valuemin': 0, 'aria-valuemax': tot, 'aria-valuenow': a.done },
          h('span', { style: `width:${Math.round((a.done / tot) * 100)}%` })));
      }
      if (c && (c.red || c.amber)) body.append(h('span', { class: 'so-far', text: `Finora: ${plural(c.red, 'non transitabile', 'non transitabili')}, ${c.amber} da verificare.` }));
    } else if (a.status === 'done' || a.status === 'partial') {
      const vic = c.vicino ? ` Ci sono anche ${plural(c.vicino, 'limite', 'limiti')} su strade a pochi metri, segnati con «?»: controlla se riguardano il tuo tragitto.` : '';
      if (c.red) {
        box.classList.add('red');
        body.append(h('b', { text: `${plural(c.red, 'punto non transitabile', 'punti non transitabili')} per questo mezzo` }),
          'Secondo OpenStreetMap ci sono limiti incompatibili sul percorso. Tocca un punto per vederlo sulla mappa e sapere cosa fare.' + vic);
        body.append(checkPoints());
      } else if (c.amber) {
        box.classList.add('amber');
        body.append(h('b', { text: plural(c.amber, 'punto da verificare', 'punti da verificare') }),
          'Nessun limite incompatibile, ma ci sono passaggi con margini stretti o divieti da controllare sul cartello. Tocca un punto per vederlo sulla mappa.' + vic);
        body.append(checkPoints());
      } else if (c.vicino) {
        box.classList.add('amber');
        body.append(h('b', { text: plural(c.vicino, 'limite vicino al percorso', 'limiti vicino al percorso') }),
          'Sulla strada percorsa non risultano limiti, ma ce ne sono su strade a pochi metri: potrebbero passare sotto un viadotto o essere laterali. Controlla se riguardano il tuo tragitto.');
        body.append(checkPoints());
      } else if (a.status === 'done') {
        box.classList.add('ok');
        body.append(h('b', { text: 'Nessun limite incompatibile trovato' }),
          (a.checked ? `Lungo il percorso ci sono ${plural(a.checked, 'limite segnalato', 'limiti segnalati')}, tutti compatibili con questo mezzo. ` : 'Nessun limite segnalato lungo il percorso. ') +
          'I dati possono essere incompleti: segui sempre la segnaletica.');
      } else {
        body.append(h('b', { text: 'Nessun limite incompatibile nei tratti controllati' }));
      }
      const fonte = dataSourceNote(a);
      if (fonte) body.append(h('span', { class: 'so-far src', text: fonte.text }));
      if (fonte && fonte.old) body.append(h('span', { class: 'so-far', text: fonte.old }));
      if (a.status === 'partial') {
        const tot = state.route.segments.length;
        body.append(
          h('span', { class: 'so-far', text: `${plural(a.failed.length, 'tratto', 'tratti')} su ${tot} non ${a.failed.length === 1 ? 'verificato' : 'verificati'}: i server OpenStreetMap non hanno risposto.` }),
          h('button', { type: 'button', class: 'btn-ghost', onclick: () => retryAnalysis(a.failed.slice()) }, 'Verifica i tratti mancanti'));
        if (a.lastDetail) body.append(h('span', { class: 'err-detail', text: 'Dettagli: ' + a.lastDetail }));
      }
    } else {
      body.append(h('b', { text: a.status === 'skipped' ? 'Controllo dei limiti non eseguito' : 'Controllo dei limiti non riuscito' }), a.reason || '');
      if (a.lastDetail) body.append(h('span', { class: 'err-detail', text: 'Dettagli: ' + a.lastDetail }));
      if (a.status === 'error') {
        body.append(h('br'), h('button', { type: 'button', class: 'btn-ghost', onclick: () => { state.analysis = null; retryAnalysis(); } }, 'Riprova il controllo'));
      }
    }
    const ttn = tomtomNote();
    if (ttn) body.append(h('span', { class: 'so-far src', text: ttn }));
    box.append(body);
  }

  /* ------------------------------------------------------------------ */
  /* Permessi per i bus nei comuni delle tappe                           */
  /* ------------------------------------------------------------------ */
  const comuneCache = new Map();
  const PERMIT_LABEL = { permesso: 'Serve un permesso', limitato: 'Accesso limitato', verifica: 'Da verificare' };

  function permitGroups() {
    return (state.permits && state.permits.groups) || [];
  }

  async function runPermits(my, signal) {
    const r = state.route;
    const places = [];
    let lastCall = 0;
    try {
      for (const s of r.stops) {
        const key = s.lat.toFixed(4) + ',' + s.lon.toFixed(4);
        let pl = comuneCache.get(key);
        if (!pl) {
          const wait = 1100 - (Date.now() - lastCall); // Nominatim: al massimo una richiesta al secondo
          if (lastCall && wait > 0) await API.sleep(wait, signal);
          lastCall = Date.now();
          try { pl = await API.comuneAt(s.lat, s.lon, signal); } catch (e) { if (e.code === 'aborted') throw e; pl = null; }
          if (pl) comuneCache.set(key, pl);
        }
        if (my !== seq) return;
        places.push(pl || null);
      }
    } catch (e) {
      return; // calcolo annullato
    }
    if (my !== seq) return;
    const regole = (window.RPPermessi && window.RPPermessi.regole) || [];
    state.permits = places.some(Boolean) ? { status: 'done', groups: C.groupPermits(places, regole) } : { status: 'error' };
    renderPermits();
    if (state.plan) { renderSummary(); renderTimeline(); }
  }

  function fmtDateLong(iso) {
    const [y, m, d] = String(iso || '').split('-').map(Number);
    if (!y) return '';
    return new Date(y, m - 1, d).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function renderPermits() {
    const ul = $('#permits');
    ul.replaceChildren();
    const p = state.permits;
    const r = state.route;
    if (!r) return;
    if (!p || p.status === 'loading') { ul.append(h('li', { class: 'none' }, 'Cerco il comune di ogni tappa e le regole per i bus…')); return; }
    if (p.status === 'error') {
      ul.append(h('li', { class: 'none' }, 'Non riesco a riconoscere i comuni delle tappe. ',
        h('button', { type: 'button', class: 'btn-ghost', onclick: () => {
          state.permits = { status: 'loading' }; renderPermits();
          runPermits(seq, workCtrl ? workCtrl.signal : undefined);
        } }, 'Riprova')));
      return;
    }
    const P = window.RPPermessi || { regole: [] };
    const last = r.stops.length - 1;
    p.groups.forEach((g, k) => {
      const rule = g.rule;
      const abroad = !rule && g.place && g.place.paese && g.place.paese !== 'IT';
      const kind = rule ? rule.stato : abroad ? 'estero' : 'ignoto';
      const nome = (g.place && g.place.nome) || r.stops[g.stops[0]].label || 'Tappa';
      const roles = g.stops.map((i) => (i === 0 ? 'partenza' : i === last ? 'destinazione' : 'tappa ' + C.stopLetter(i))).join(', ');
      const li = h('li', { class: 'pm pm-' + kind });
      li.append(h('div', { class: 'pm-head' },
        h('span', { class: 'pm-badge', 'aria-hidden': 'true', text: g.stops.map((i) => C.stopLetter(i)).join(' ') }),
        h('span', { class: 'pm-name' }, h('b', { text: nome }), h('span', { text: roles.charAt(0).toUpperCase() + roles.slice(1) })),
        h('span', { class: 'sev pm-sev', text: rule ? PERMIT_LABEL[rule.stato] : abroad ? 'Fuori Italia' : 'Nessuna regola nota' })));
      if (rule) {
        li.append(h('p', { class: 'pm-title', text: rule.titolo }), h('p', { text: rule.sintesi }));
        const how = h('details', { class: 'pm-how' },
          h('summary', null, rule.stato === 'permesso' ? 'Come ottenerlo' : 'Cosa fare'),
          h('ol', { class: 'pm-steps' }, rule.passi.map((t) => h('li', { text: t }))));
        if (k === 0) how.open = true;
        li.append(how);
        if (rule.discesa) li.append(h('p', null, h('b', { text: 'Salita e discesa: ' }), rule.discesa));
        if (rule.costi) li.append(h('p', null, h('b', { text: 'Costi indicativi: ' }), rule.costi));
        if (rule.contatti) li.append(h('p', null, h('b', { text: 'Contatti: ' }), rule.contatti));
        if (rule.nota) li.append(h('p', null, h('b', { text: 'Da sapere: ' }), rule.nota));
        li.append(h('div', { class: 'pm-links' }, rule.link.map((l, j) => h('a', { href: l.url, target: '_blank', rel: 'noopener', class: j === 0 ? 'pm-main' : null }, l.testo))));
        li.append(h('p', { class: 'pm-source', text: `Fonti ufficiali consultate il ${fmtDateLong(P.verificato)}${rule.affidabilita === 'parziale' ? ', alcuni dettagli non erano indicati' : ''}. Regole e tariffe cambiano: controlla la pagina ufficiale prima di partire.` }));
      } else if (abroad) {
        li.append(h('p', { text: 'Le regole per i bus all\'estero non sono nel nostro elenco: controlla il sito della città.' }));
      } else {
        li.append(h('p', { text: g.place && g.place.nome
          ? `Nel nostro elenco non ci sono regole per i bus a ${nome}. Molti comuni italiani chiedono un ticket o una prenotazione ai bus turistici: verifica sul sito del comune prima di partire.`
          : 'Non riesco a riconoscere il comune di questa tappa: verifica sul sito del comune prima di partire.' }));
        const q = encodeURIComponent(`bus turistici permesso accesso ${g.place && g.place.nome ? g.place.nome : ''}`.trim());
        li.append(h('div', { class: 'pm-links' },
          h('a', { href: 'https://www.google.com/search?q=' + q, target: '_blank', rel: 'noopener' }, 'Cerca le regole del comune'),
          P.elencoNazionale ? h('a', { href: P.elencoNazionale.url, target: '_blank', rel: 'noopener' }, P.elencoNazionale.testo) : null));
      }
      ul.append(li);
    });
  }

  function kmAt(T) { return C.alongAtTime(state.route, T) / 1000; }

  function renderTimeline() {
    const ol = $('#timeline');
    ol.replaceChildren();
    const r = state.route, p = state.plan;
    const ref = p.events[0].depart;
    p.events.forEach((ev, k) => {
      const next = p.events[k + 1];
      const time = h('div', { class: 'tl-time' });
      const body = h('div', { class: 'tl-body' });
      const stop = ev.stop != null ? r.stops[ev.stop] : null;
      const cur = stop ? state.stops.find((x) => x.id === stop.id) : null;
      const label = (cur && cur.lat === stop.lat ? cur.label : stop && stop.label) || '';
      let title = '', sub = '', target = null;
      if (ev.type === 'partenza') {
        time.append(C.fmtClock(ev.depart, ref));
        title = 'Partenza'; sub = label; target = [stop.lat, stop.lon];
      } else if (ev.type === 'tappa') {
        time.append(C.fmtClock(ev.arrive, ref));
        if (ev.dwell) time.append(h('small', { text: 'riparte ' + C.fmtClock(ev.depart, ref) }));
        title = `Tappa ${C.stopLetter(ev.stop)}: ${label}`;
        sub = ev.dwell ? `Sosta ${C.fmtDur(ev.dwell * 60)}${ev.rest === 'piena' ? ', vale come pausa dell\'autista' : ev.rest === 'prima' ? ', vale come prima parte della pausa' : ''}` : 'Solo passaggio';
        target = [stop.lat, stop.lon];
      } else if (ev.type === 'pausa') {
        time.append(C.fmtClock(ev.arrive, ref));
        title = `Pausa ${ev.minutes}′` + (ev.minutes === 15 ? ' (1ª parte)' : ev.rest === 'piena' && ev.minutes === 30 ? ' (2ª parte)' : '');
        const km = C.fmtNum(kmAt(ev.T), 0);
        sub = ev.place ? `${ev.place.name} · km ${km}` : `Nessuna area di servizio trovata: fermati in un'area idonea entro il km ${km}`;
        target = ev.lat != null ? [ev.lat, ev.lon] : null;
      } else {
        time.append(C.fmtClock(ev.arrive, ref));
        title = 'Arrivo'; sub = label; target = [stop.lat, stop.lon];
      }
      const pg = ev.stop != null ? permitGroups().find((g) => g.stops.includes(ev.stop)) : null;
      const pr = pg && pg.rule && pg.rule.stato !== 'verifica' ? pg.rule : null;
      const permitNote = pr ? h('span', { class: 'tl-permit ' + pr.stato, text: pr.stato === 'limitato' ? `${pg.place.nome}: accesso limitato ai bus` : `${pg.place.nome}: serve un permesso per il bus` }) : null;
      const btn = h('button', { type: 'button', onclick: () => target && flyTo(target[0], target[1], 15) }, h('b', { text: title }), sub ? h('span', { text: sub }) : null, permitNote);
      body.append(btn);
      ol.append(h('li', { class: 'tl tl-' + ev.type }, time, h('div', { class: 'tl-rail' }, h('span', { class: 'tl-dot' })), body));
      if (next) {
        const d = (C.alongAtTime(r, next.T) - C.alongAtTime(r, ev.T));
        ol.append(h('li', { class: 'tl tl-gap', 'aria-label': 'Guida' }, h('div'), h('div', { class: 'tl-rail' }), h('div', { class: 'tl-drive', text: `${C.fmtDur(next.T - ev.T)} di guida · ${C.fmtDist(d)}` })));
      }
    });
    const wl = $('#warnings');
    wl.replaceChildren(...p.warnings.map((w) => h('li', { class: w.level, text: w.text })));
  }

  function renderHazards() {
    const ul = $('#hazards');
    const cnt = $('#hz-count');
    ul.replaceChildren();
    cnt.textContent = '';
    const a = state.analysis;
    const loading = !a || a.status === 'loading';
    const list = allHazards();
    if ((!a || !a.hazards) && !list.length) { ul.append(h('li', { class: 'none' }, loading ? 'Controllo in corso…' : 'Elenco non disponibile.')); return; }
    if (!list.length && !excludedHazards().length) {
      ul.append(h('li', { class: 'none' }, loading ? 'Nessun punto critico finora, il controllo continua…'
        : a.status === 'partial' ? 'Nessun punto critico nei tratti controllati.'
          : 'Nessun punto critico per questo mezzo nei dati di OpenStreetMap.'));
      return;
    }
    cnt.textContent = String(list.length);
    for (const hz of list) {
      const km = hz.alongStart / 1000;
      const span = hz.alongEnd - hz.alongStart;
      const eta = clockAtAlong(hz.alongStart);
      const meta = [hz.name, `km ${C.fmtNum(km, km < 10 ? 1 : 0)}`, eta ? 'verso le ' + C.fmtClock(eta, depMs()) : '', span > 150 ? `tratto di ${C.fmtDist(span)}` : ''].filter(Boolean).join(' · ');
      const isOsm = !hz.ids[0].startsWith('tomtom/');
      const osm = hz.ids[0].split('/');
      const doubts = C.hazardDoubts(hz);
      const maybe = hz.rel === 'vicino';
      ul.append(h('li', { class: 'hz' + (maybe ? ' maybe' : '') },
        h('span', { class: maybe ? 'maybe' : null, svg: hazardSign(hz) }),
        h('div', { class: 'hz-body' },
          maybe ? h('span', { class: 'maybe-tag', text: `Forse non sul percorso · a ${Math.max(1, Math.round(hz.distM || 0))} m` }) : null,
          h('span', { class: 'hz-title' }, hz.title, h('span', { class: `sev sev-${hz.severity}-bg`, text: hz.severity === 'red' ? 'Non transitabile' : 'Da verificare' })),
          h('span', { text: hz.detail }),
          h('span', { class: 'hz-meta', text: meta }),
          hz.tomtom && hz.kind !== 'tomtom' ? h('span', { class: 'tt-verdict ' + hz.tomtom + (hz.severity === 'red' && hz.tomtom === 'passa' ? ' conflitto' : ''), text: ttText(hz) }) : null,
          doubts.length ? h('span', { class: 'hz-doubt', text: doubts.join(' ') }) : null,
          h('span', { class: 'hz-advice' }, h('b', { text: 'Cosa fare: ' }), C.hazardAdvice(hz)),
          h('span', { class: 'hz-links' },
            h('button', { type: 'button', onclick: () => focusHazard(hz) }, 'Mostra sulla mappa'),
            h('a', { href: streetViewUrl(hz), target: '_blank', rel: 'noopener' }, 'Street View'),
            isOsm ? h('a', { href: `https://www.openstreetmap.org/${osm[0]}/${osm[1]}`, target: '_blank', rel: 'noopener' }, 'Dati OSM') : null))));
    }
    if (loading) ul.append(h('li', { class: 'none' }, 'Controllo degli altri tratti in corso…'));
    const ex = excludedHazards();
    if (ex.length) {
      ul.append(h('li', { class: 'hz-excluded' }, h('details', null,
        h('summary', null, `Esclusi perché non riguardano il percorso (${ex.length})`),
        h('ul', null, ex.map((hz) => h('li', null,
          h('span', { text: `${hz.title} · ${hazardKm(hz)}` }),
          h('button', { type: 'button', class: 'btn-ghost', onclick: () => setDecision(hz, null) }, 'Ripristina')))))));
    }
  }

  function renderParkings() {
    const ul = $('#parkings');
    ul.replaceChildren();
    const p = state.parkings;
    const r = state.route;
    if (!p || p.status === 'loading') { ul.append(h('li', { class: 'none' }, 'Ricerca dei parcheggi in corso…')); return; }
    if (p.status === 'retrying') { ul.append(h('li', { class: 'none' }, `${p.reason || 'Ricerca non riuscita.'} Riprovo tra 20 secondi…`)); return; }
    if (p.status !== 'done') {
      ul.append(h('li', { class: 'none' }, 'Ricerca dei parcheggi non riuscita. ' + (p.reason || '') + ' ',
        h('button', { type: 'button', class: 'btn-ghost', onclick: () => {
          if (!state.route) return;
          state.parkings = { status: 'loading' }; renderParkings();
          runParkings(seq, workCtrl ? workCtrl.signal : undefined);
        } }, 'Riprova')));
      if (p.detail) ul.append(h('li', { class: 'err-detail', text: 'Dettagli: ' + p.detail }));
      return;
    }
    let any = false;
    for (const g of p.groups) {
      const s = r.stops[g.stop];
      ul.append(h('li', { class: 'pk-group', text: `Arrivo · ${s.label || 'destinazione'}` }));
      if (!g.items.length) { ul.append(h('li', { class: 'none' }, 'Nessun parcheggio per bus segnato su OpenStreetMap entro 1 km dall\'arrivo.')); continue; }
      any = true;
      for (const it of g.items) {
        ul.append(h('li', { class: 'pk' },
          h('span', { class: 'pk-icon', 'aria-hidden': 'true' }, 'P'),
          h('div', { class: 'hz-body' },
            h('span', { class: 'hz-title', text: parkingName(it) }),
            h('span', { class: 'hz-meta', text: parkingMeta(it) }),
            h('span', { class: 'hz-links' },
              h('button', { type: 'button', onclick: () => flyTo(it.lat, it.lon, 17) }, 'Mostra sulla mappa'),
              h('a', { href: `https://www.google.com/maps/dir/?api=1&destination=${it.lat.toFixed(6)},${it.lon.toFixed(6)}`, target: '_blank', rel: 'noopener' }, 'Naviga'),
              h('a', { href: `https://www.openstreetmap.org/${it.id}`, target: '_blank', rel: 'noopener' }, 'Dati OSM')))));
      }
    }
    if (!any && p.groups.length) ul.append(h('li', { class: 'hint' }, 'Suggerimento: cerca “parcheggio bus turistici” sul sito del comune di destinazione.'));
  }

  function renderSteps() {
    const r = state.route;
    const ol = $('#steps');
    ol.replaceChildren();
    $('#steps-count').textContent = String(r.steps.length);
    for (const st of r.steps) {
      const at = r.coords[Math.min(st.from, r.coords.length - 1)];
      const li = h('li', { class: 'step', tabindex: '0', role: 'button' },
        h('span', { svg: arrowSVG(st.icon) }),
        h('span', { class: 'step-text', text: st.text }),
        h('span', { class: 'step-dist', text: st.distM > 0 ? C.fmtDist(st.distM) : '' }));
      const go = () => flyTo(at[0], at[1], 17);
      li.addEventListener('click', go);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      ol.append(li);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Esportazione, condivisione, stampa                                  */
  /* ------------------------------------------------------------------ */
  function tripTitle() {
    const r = state.route;
    const a = r.stops[0].label.split(',')[0], b = r.stops[r.stops.length - 1].label.split(',')[0];
    return `${a} → ${b}`;
  }
  function vehicleLine(v, margin) {
    return `${v.nome} · L ${C.fmtNum(v.lunghezza)} m · H ${C.fmtNum(v.altezza)} m${margin ? ` (+${Math.round(margin * 100)} cm)` : ''} · W ${C.fmtNum(v.larghezza)} m · ${C.fmtNum(v.peso)} t`;
  }

  $('#btn-gpx').addEventListener('click', () => {
    const r = state.route;
    if (!r) return;
    const wps = r.stops.map((s, i) => ({ lat: s.lat, lon: s.lon, name: `${C.stopLetter(i)} · ${s.label}` }));
    for (const ev of state.plan.events) if (ev.type === 'pausa' && ev.lat != null) wps.push({ lat: ev.lat, lon: ev.lon, name: `Pausa ${ev.minutes}′ · ${ev.place ? ev.place.name : 'area idonea'}` });
    const a = state.analysis;
    for (const hz of allHazards()) wps.push({ lat: hz.lat, lon: hz.lon, name: `${hz.rel === 'vicino' ? 'Forse (vicino)' : hz.severity === 'red' ? 'ATTENZIONE' : 'Verifica'}: ${hz.title}`, desc: hz.detail });
    const gpx = C.buildGpx({ name: tripTitle(), desc: vehicleLine(r.vehicle, r.margin), coords: r.coords, waypoints: wps });
    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const slug = tripTitle().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const link = h('a', { href: url, download: `rotta-pullman-${slug || 'percorso'}.gpx` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('GPX pronto: aprilo nel navigatore per mezzi pesanti (es. OsmAnd, Sygic Truck).');
  });

  function shareUrl() {
    return location.href.split('#')[0] + '#v=' + C.encodeShare(state);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* riserva */ }
    const ta = h('textarea', { style: 'position:fixed;top:-1000px;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  const canShare = typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches;
  if (canShare) $('#btn-share').textContent = 'Condividi';
  $('#btn-share').addEventListener('click', async () => {
    if (!state.route) return;
    const url = shareUrl();
    if (canShare) {
      try { await navigator.share({ title: 'Rotta Pullman · ' + tripTitle(), text: vehicleLine(state.route.vehicle, state.route.margin), url }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    toast((await copyText(url)) ? 'Link copiato: chi lo apre vede lo stesso viaggio con lo stesso mezzo.' : 'Copia non riuscita. Link: ' + url, 6000);
  });

  $('#btn-print').addEventListener('click', () => {
    if (!state.route) return;
    const r = state.route;
    const ph = $('#print-head');
    ph.replaceChildren(
      h('h1', { text: 'Foglio di viaggio · ' + tripTitle() }),
      h('p', { text: vehicleLine(r.vehicle, r.margin) }),
      h('p', { text: `Partenza ${new Date(depMs()).toLocaleString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} · ${C.fmtDist(r.distanceM)} · ${C.fmtDur(state.plan.driveS)} di guida` }));
    $('#steps-wrap').open = true;
    document.querySelectorAll('.pm-how').forEach((d) => { d.open = true; });
    showTab('percorso');
    setTimeout(() => window.print(), 50);
  });

  /* ------------------------------------------------------------------ */
  /* Avvisi                                                              */
  /* ------------------------------------------------------------------ */
  let toastTimer = null;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms || 3500);
  }
  function hideToast() { $('#toast').hidden = true; }

  document.addEventListener('pointerdown', (e) => {
    if (ac && !ac.input.parentElement.contains(e.target)) closeAc();
  });

  /* ------------------------------------------------------------------ */
  /* Avvio                                                               */
  /* ------------------------------------------------------------------ */
  renderStops();
  renderMarkers();
  renderVehicle();
  renderOptions();
  renderResult();
  if (state.stops.filter((s) => s.lat != null).length) fitAll();
  if (fromShare || firstVisit) {
    persist();
    setTimeout(computeRoute, 300);
  }

  // per i test automatici
  window.__rp = { state, map, computeRoute };
})();
