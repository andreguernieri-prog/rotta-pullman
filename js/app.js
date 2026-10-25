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
    options: Object.assign({ engine: 'valhalla', orsKey: '', tomtomKey: '', mapillaryToken: '', avoidTolls: false, avoidHighways: false, avoidFerries: true, strictHgv: true, autoAvoid: true, vmax: 100 }, saved.options || {}),
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

  const CLOCK_BADGE = '<g><circle cx="77" cy="77" r="20" fill="#fff" stroke="#111" stroke-width="5"/><path d="M77 65v13l8 5" fill="none" stroke="#111" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></g>';
  function signSVG(kind, text, clock) {
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
      case 'transito':
        inner = ''; // cerchio rosso vuoto: divieto di transito
        break;
      default:
        inner = t(60, fs);
    }
    return `<svg viewBox="0 0 100 100" role="img" aria-hidden="true">${ring}${inner}${clock ? CLOCK_BADGE : ''}</svg>`;
  }

  const DANGER_SVG = '<svg viewBox="0 0 100 100" role="img" aria-hidden="true"><path d="M50 8 94 88H6z" fill="#fff" stroke="#c8102e" stroke-width="10" stroke-linejoin="round"/><path d="M50 36v26" stroke="#111" stroke-width="9" stroke-linecap="round"/><circle cx="50" cy="74" r="5.5" fill="#111"/></svg>';

  function hazardSign(hz) {
    const v = hz.value;
    if (hz.kind === 'tomtom') return DANGER_SVG;
    const clock = hz.kind === 'orario';
    const kind = clock ? hz.sign : hz.kind;
    switch (kind) {
      case 'altezza': return signSVG('altezza', v != null ? dec1(v) : '?', clock);
      case 'larghezza': return signSVG('larghezza', v != null ? dec1(v) : '?', clock);
      case 'lunghezza': return signSVG('lunghezza', v != null ? C.fmtNum(v) : '?', clock);
      case 'peso': return signSVG('peso', v != null ? C.fmtNum(v) + 't' : '?', clock);
      case 'asse': return signSVG('asse', v != null ? C.fmtNum(v) + 't' : '?', clock);
      case 'bus': return signSVG(/per bus/.test(hz.title) ? 'bus' : 'transito', '', clock);
      default: return signSVG('pesanti', '', clock);
    }
  }

  /* etichetta della gravità; per i divieti a orario dice se è in vigore al passaggio */
  function sevLabel(hz) {
    if (hz.kind === 'orario') {
      const st = hz.stato && hz.stato.state;
      if (st === 'attivo') return hz.severity === 'red' ? 'Vietato al passaggio' : 'In vigore al passaggio';
      if (st === 'ridosso') return 'A ridosso dell\'orario';
      if (st === 'non attivo') return 'Non in vigore al passaggio';
      return 'Da verificare';
    }
    return hz.severity === 'red' ? 'Non transitabile' : 'Da verificare';
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
    $('#opt-avoid').checked = o.autoAvoid !== false;
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
  optBind('#opt-avoid', 'autoAvoid', (t) => t.checked);
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

  /* msg: testo, oppure contenuto già pronto con un testo breve per l'avviso */
  function showError(msg, short) {
    const p = $('#route-error');
    if (typeof msg === 'string') p.textContent = msg; else p.replaceChildren(msg);
    p.hidden = false;
    if ($('#view-viaggio').hidden) toast(short || (typeof msg === 'string' ? msg : 'Percorso non trovato: guarda la scheda Viaggio.'), 7000);
  }

  /*
   * Percorso non trovato: nei dati dei limiti cerca, intorno a ogni tappa, le strade chiuse al mezzo.
   * Di solito il problema è una tappa raggiungibile solo da lì (es. un'attrazione in fondo a una strada stretta).
   */
  const BLOCK_RADIUS = 300;
  async function explainNoRoute(stops, err, my) {
    showError(err.message);
    const found = await blockedStops(stops, my);
    if (my !== seq || !found.length) return;
    const role = (i) => (i === stops.length - 1 ? 'all\'arrivo' : i === 0 ? 'alla partenza' : `alla tappa ${C.stopLetter(i)}`);
    const box = h('div', { class: 'noroute' },
      h('b', { text: 'Nessun percorso per questo mezzo.' }));
    for (const f of found.slice(0, 2)) {
      box.append(
        h('span', { text: `Vicino ${role(f.i)} (${f.s.label || 'punto sulla mappa'}) ci sono strade chiuse al mezzo:` }),
        h('ul', { class: 'noroute-list' }, f.b.map((x) => h('li', null, h('b', { text: x.name }), `: ${x.issues.join(', ')} · a ${C.fmtDist(Math.max(10, Math.round(x.dist / 10) * 10))}`))),
        h('button', { type: 'button', class: 'btn-ghost', onclick: () => flyTo(f.s.lat, f.s.lon, 17) }, 'Mostra sulla mappa'));
    }
    box.append(h('span', { text: 'Ho cercato anche la strada raggiungibile più vicina e i parcheggi intorno, senza risultato. Sposta la tappa dove il pullman può fermarsi davvero, per esempio un parcheggio o il punto di discesa sulla strada principale: tocca la mappa o trascina il segnaposto.' }));
    showError(box, 'Percorso non trovato: una tappa si raggiunge solo da strade chiuse al mezzo. Dettagli nella scheda Viaggio.');
  }

  function routeWith(stops, veh, margin, opt, signal) {
    return opt.engine === 'ors'
      ? API.routeOrs(stops, veh, margin, opt, opt.orsKey, signal)
      : API.routeValhalla(stops, veh, margin, opt, signal);
  }

  /*
   * Calcola il percorso. plan (facoltativo) serve ai ricalcoli automatici:
   *   avoid    punti da evitare          round    giro di ricerca dell'alternativa
   *   fastest  km e guida del più veloce  noAvoid  mostra il più veloce, senza alternative
   *   moved    tappe spostate dove arriva il pullman
   *   pre      percorso già calcolato da applicare ({ r, moved })
   *   manual   punti da evitare scelti dall'operatore
   */
  async function computeRoute(plan) {
    if (!plan || typeof plan !== 'object' || plan instanceof Event) plan = {};
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
    state.avoiding = false;
    setBusy(true);
    const avoiding = !!(plan.avoid && plan.avoid.length);
    try {
      const veh = Object.assign({}, state.vehicle);
      const opt = Object.assign({}, state.options, { departure: state.departure, avoid: plan.avoid || [] });
      let r, moved = plan.moved || [];
      if (plan.pre) { r = plan.pre.r; moved = plan.pre.moved || []; }
      else {
        // tappe già spostate dove arriva il pullman
        const routeStops = valid.map((s, i) => { const m = moved.find((x) => x.i === i); return m ? Object.assign({}, s, m.to) : s; });
        try {
          r = await routeWith(routeStops, veh, state.margin, opt, signal);
        } catch (e) {
          if ((e.code !== 'noroute' && e.code !== 'nopoint') || avoiding || moved.length) throw e;
          if (my !== seq) return;
          // una tappa non si raggiunge: si cerca il punto più vicino dove arriva il pullman
          toast('Una tappa non si raggiunge con questo mezzo: cerco il punto più vicino dove arriva il pullman…', 6000);
          const rec = await recoverRoute(valid, veh, opt, signal, my);
          if (my !== seq) return;
          if (!rec) throw e;
          hideToast();
          r = rec.r; moved = rec.moved;
        }
      }
      if (my !== seq) return;
      r.stops = valid.map((s) => ({ id: s.id, label: s.label, lat: s.lat, lon: s.lon }));
      for (const m of moved) r.stops[m.i].bus = { lat: m.to.lat, lon: m.to.lon };
      r.moved = moved;
      r.plan = { avoid: opt.avoid, round: plan.round || 0, fastest: plan.fastest || null, noAvoid: !!plan.noAvoid, manual: !!plan.manual };
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
      r.waysPromise = loadRouteWays(my, r, signal);
      runParkings(my, signal); // richiesta breve: entra per prima nella coda di Overpass
      runAnalysis(my, signal);
      runPermits(my, signal);
      runTomTom(my, signal);
    } catch (e) {
      if (my !== seq || e.code === 'aborted') return;
      if (avoiding && (e.code === 'noroute' || e.code === 'nopoint')) showError('Non c\'è un percorso per questo mezzo che eviti quel punto: resta il percorso di prima.');
      else if (e.code === 'noroute' || e.code === 'nopoint') explainNoRoute(valid, e, my);
      else showError(e.message || 'Errore inatteso durante il calcolo.');
    } finally {
      if (my === seq) setBusy(false);
    }
  }

  /* ---------- tappa irraggiungibile: punto più vicino dove arriva il pullman ---------- */
  const RECOVER_RADIUS = 200; // metri: il raggio che i server Valhalla pubblici accettano di solito

  /* tappe circondate da strade chiuse al mezzo (dai dati dei limiti), dall'arrivo alla partenza */
  async function blockedStops(stops, my) {
    let dati = null;
    try { dati = await API.dataIndex(); } catch (e) { dati = null; }
    if (!dati || my !== seq) return [];
    const found = [];
    for (let i = stops.length - 1; i >= 0; i--) {
      const s = stops[i];
      if (!C.pointInRings(s.lat, s.lon, dati.copertura)) continue;
      try {
        const tiles = await API.dataTiles(dati, C.tilesAround(s.lat, s.lon, BLOCK_RADIUS + 100, dati.riquadro));
        const b = C.blockersNear(tiles.flatMap(C.tileToElements), s, state.vehicle, BLOCK_RADIUS);
        if (b.length) found.push({ i, s, b: b.slice(0, 4) });
      } catch (e) { /* dati non disponibili */ }
      if (my !== seq) return [];
    }
    return found;
  }

  /* parcheggi adatti vicino a una tappa, come arrivo alternativo */
  async function parkingCandidates(s, signal) {
    let els = null;
    try {
      const dati = await API.dataIndex();
      if (dati && C.pointInRings(s.lat, s.lon, dati.copertura)) {
        const tiles = await API.dataTiles(dati, C.tilesAround(s.lat, s.lon, 1500, dati.riquadro), signal);
        els = tiles.flatMap(C.tileToElements).filter((e) => e.tags && e.tags.amenity === 'parking');
      }
    } catch (e) { if (e.code === 'aborted') throw e; }
    if (!els) {
      try { els = await API.parkings([s], { near: 1000, far: 1500 }, signal); } catch (e) { if (e.code === 'aborted') throw e; return []; }
    }
    const pk = C.pickParkings(els, s);
    return pk.near.concat(pk.generic, pk.far.filter((x) => x.d <= 1500));
  }

  function movedStops(valid, idxs, ends, diag, park, via) {
    const out = [];
    for (const i of idxs) {
      const to = ends[i];
      if (!to) continue;
      const from = valid[i];
      if (!park && C.haversine([from.lat, from.lon], [to.lat, to.lon]) < 25) continue; // praticamente lo stesso punto
      const d = diag.find((x) => x.i === i);
      out.push({ i, label: from.label, from: { lat: from.lat, lon: from.lon }, to: { lat: to.lat, lon: to.lon }, walk: C.walkEstimate(from, to), blockers: d ? d.b : [], park: park ? { name: parkingName(park), kind: park.kind } : null, via });
    }
    return out;
  }

  /*
   * Percorso non trovato: 1) Valhalla con un raggio di ricerca sulle tappe sospette arriva alla strada
   * percorribile più vicina; con openrouteservice si ricalcola poi fino a quel punto. 2) Altrimenti si prova
   * ad arrivare al parcheggio adatto più vicino.
   */
  async function recoverRoute(valid, veh, opt, signal, my) {
    const diag = await blockedStops(valid, my);
    if (my !== seq) return null;
    const last = valid.length - 1;
    const sus = diag.map((d) => d.i);
    const tries = [sus.length ? sus : [last]];
    if (tries[0].length < valid.length) tries.push(valid.map((_, i) => i));
    const vopt = Object.assign({}, opt, { engine: 'valhalla', avoid: [] });
    for (const idxs of tries) {
      let r;
      try {
        r = await API.routeValhalla(valid.map((s, i) => (idxs.includes(i) ? Object.assign({}, s, { radius: RECOVER_RADIUS }) : s)), veh, state.margin, vopt, signal);
      } catch (e) { if (e.code === 'aborted') throw e; continue; }
      if (my !== seq) return null;
      const ends = r.legEnds.map((k) => ({ lat: r.coords[k][0], lon: r.coords[k][1] }));
      let via = 'valhalla';
      if (opt.engine === 'ors') {
        try {
          r = await API.routeOrs(valid.map((s, i) => (idxs.includes(i) ? Object.assign({}, s, ends[i]) : s)), veh, state.margin, opt, opt.orsKey, signal);
          via = 'ors';
        } catch (e) { if (e.code === 'aborted') throw e; via = 'valhalla-riserva'; }
      }
      return { r, moved: movedStops(valid, idxs, ends, diag, null, via) };
    }
    const i = sus.length ? sus[0] : last;
    for (const c of (await parkingCandidates(valid[i], signal)).slice(0, 2)) {
      if (my !== seq) return null;
      try {
        const r = await routeWith(valid.map((s, k) => (k === i ? Object.assign({}, s, { lat: c.lat, lon: c.lon }) : s)), veh, state.margin, opt, signal);
        return { r, moved: movedStops(valid, [i], { [i]: c }, diag, c, opt.engine) };
      } catch (e) { if (e.code === 'aborted') throw e; }
    }
    return null;
  }

  /* ---------- alternativa automatica ai punti non transitabili ---------- */
  const AVOID_ROUNDS = 3;
  async function maybeAvoid(my) {
    const r = state.route;
    if (!r || my !== seq || !r.plan || r.plan.noAvoid || state.options.autoAvoid === false) return;
    const pts = C.avoidPoints(allHazards(), r, r.stops.map((s) => s.bus || s));
    if (!pts.length) return;
    const merged = C.mergeAvoid(r.plan.avoid, pts);
    if (!merged.added) {
      r.plan.avoidFailed = 'Il servizio di calcolo non riesce a evitare questi punti: guarda le indicazioni dei punti critici o aggiungi una tappa su un\'altra strada.';
      renderRouteNotes(); return;
    }
    if (r.plan.round >= AVOID_ROUNDS) {
      r.plan.avoidFailed = 'Dopo tre tentativi restano punti non transitabili: aggiungi una tappa su un\'altra strada.';
      renderRouteNotes(); return;
    }
    state.avoiding = true;
    renderRouteNotes();
    let alt = null;
    try {
      const opt = Object.assign({}, r.options, { avoid: merged.list });
      alt = await routeWith(r.stops.map((s) => (s.bus ? Object.assign({}, s, s.bus) : s)), r.vehicle, r.margin, opt, workCtrl ? workCtrl.signal : undefined);
    } catch (e) {
      if (e.code === 'aborted') return;
    }
    if (my !== seq || state.route !== r) return;
    state.avoiding = false;
    if (!alt) {
      r.plan.avoidFailed = r.plan.round
        ? 'Non ho trovato un percorso che eviti anche gli altri punti non transitabili.'
        : 'Non esiste un percorso per questo mezzo che eviti i punti non transitabili: verifica i punti con Street View o aggiungi una tappa su un\'altra strada.';
      renderRouteNotes(); return;
    }
    computeRoute({ pre: { r: alt, moved: r.moved }, avoid: merged.list, round: r.plan.round + 1, fastest: r.plan.fastest || { distanceM: r.distanceM, driveS: r.driveS } });
  }

  /* "Evita questo punto" nella scheda di un punto critico */
  function avoidHazard(hz) {
    const r = state.route;
    if (!r) return;
    const p = r.index.pointAt((hz.alongStart + hz.alongEnd) / 2);
    const merged = C.mergeAvoid(r.plan && r.plan.avoid, [{ lat: p[0], lon: p[1], title: hz.title, name: hz.name || '', ids: hz.ids.slice() }]);
    map.closePopup();
    toast('Ricalcolo il percorso evitando questo punto…');
    computeRoute({ avoid: merged.list, round: (r.plan && r.plan.round) || 0, fastest: (r.plan && r.plan.fastest) || { distanceM: r.distanceM, driveS: r.driveS }, moved: r.moved, manual: true });
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
        analyzeNow(a, r);
        drawHazards(); renderHazards(); renderMini();
      }
      renderCheck();
    }
    // prima di chiudere il controllo si aspettano le strade riconosciute (al massimo 20 secondi)
    if (r.waysPromise && r.ways === undefined) {
      try { await Promise.race([r.waysPromise, API.sleep(20000, signal)]); } catch (e) { /* annullato */ }
      if (my !== seq || state.analysis !== a) return;
      if (r.ways) { analyzeNow(a, r); drawHazards(); renderHazards(); renderMini(); }
    }
    a.status = !a.failed.length ? 'done' : (a.failed.length === todo.length && !elements.size ? 'error' : 'partial');
    if (a.status === 'error') a.reason = a.lastError;
    replan();
    renderResult();
    if (a.status === 'done') maybeAvoid(my);
  }

  function analyzeNow(a, r) {
    Object.assign(a, C.analyzeElements(Array.from(a.elements.values()), r.index, r.vehicle, { streetAt: (al) => C.streetAtAlong(r, al), routeWays: r.ways || null }));
    for (const sv of a.services) sv.T = C.timeAtAlong(r, sv.along);
    a.analyzedAt = Date.now();
  }

  /* strade OSM percorse (Valhalla): con queste il controllo sa quali limiti sono davvero sul percorso */
  async function loadRouteWays(my, r, signal) {
    try {
      const res = await API.traceWays(r.coords, signal);
      if (my !== seq) return;
      const runs = [];
      for (const x of res.runs) {
        const a = r.index.nearest(x.from[0], x.from[1], 60), b = r.index.nearest(x.to[0], x.to[1], 60);
        if (a && b) runs.push({ a: a.along, b: b.along, id: x.id, bridge: x.bridge, tunnel: x.tunnel });
      }
      r.ways = runs.length ? C.makeRouteWays(runs) : null;
      r.waysInfo = { chunks: res.chunks, failed: res.failed };
    } catch (e) {
      if (e.code === 'aborted') return;
      r.ways = null;
    }
    // controllo già finito (strade arrivate tardi): si rifà con le strade riconosciute
    const a = state.analysis;
    if (my === seq && state.route === r && a && a.elements instanceof Map && a.elements.size && a.status !== 'loading') {
      analyzeNow(a, r); drawHazards(); renderHazards(); renderCheck(); renderMini();
    }
  }

  function retryAnalysis(only) {
    if (!state.route) return;
    runAnalysis(seq, workCtrl ? workCtrl.signal : undefined, only);
  }

  /* Parcheggi intorno al punto di arrivo: per bus entro 1 km (o il più vicino fino a 5 km), generici grandi entro 1 km */
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
            const tiles = await API.dataTiles(dati, C.tilesAround(dest.lat, dest.lon, C.PARK_FAR, dati.riquadro), signal);
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
          els = await API.parkings(pts, { near: C.PARK_NEAR, far: C.PARK_FAR }, signal);
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
      const pk = C.pickParkings(els, dest);
      const official = C.nearOfficial((window.RPPermessi || {}).parcheggi, dest, 15000);
      const groups = [{ stop: last, items: pk.near, far: pk.far, generic: pk.generic, official }];
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
    if (state.analysis && state.analysis.hazards) drawHazards();
    if (!$('#res').hidden) {
      renderSummary(); renderTimeline(); renderMini();
      if (state.analysis && state.analysis.hazards) { renderCheck(); renderHazards(); }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Disegno sulla mappa                                                 */
  /* ------------------------------------------------------------------ */
  const WALK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4" r="2.2" fill="currentColor"/><path d="M12.5 7.5 10 12l1.5 3.5L9 21 M12.5 7.5l2 4.5 3 1.2 M11.5 15.5l3 2 1 3.5 M10 12l-3 1.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function drawRoute() {
    lg.route.clearLayers();
    const c = state.route.coords;
    L.polyline(c, { color: '#ffffff', weight: 11, opacity: 0.95, interactive: false, lineJoin: 'round' }).addTo(lg.route);
    L.polyline(c, { color: '#1d4f9c', weight: 6, opacity: 1, interactive: false, lineJoin: 'round' }).addTo(lg.route);
    // tappe spostate: dove si ferma il pullman e il tratto a piedi fino alla meta
    for (const s of state.route.stops) {
      if (!s.bus) continue;
      L.polyline([[s.bus.lat, s.bus.lon], [s.lat, s.lon]], { color: '#1d4f9c', weight: 4, opacity: 0.9, dashArray: '1 8', lineCap: 'round', interactive: false }).addTo(lg.route);
      L.marker([s.bus.lat, s.bus.lon], { icon: L.divIcon({ className: '', html: `<div class="drop-marker">${WALK_SVG}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }), title: 'Il pullman si ferma qui, poi a piedi', zIndexOffset: 700 })
        .bindPopup(() => popupBox('Il pullman si ferma qui', `Poi a piedi fino a ${s.label || 'la meta'}`))
        .addTo(lg.route);
    }
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
      const info = hz.severity === 'info';
      const icon = L.divIcon({ className: '', html: `<div class="hz-marker ${hz.severity}${maybe ? ' maybe' : ''}">${hazardSign(hz)}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      const mk = L.marker([hz.lat, hz.lon], { icon, zIndexOffset: info ? 300 : maybe ? 400 : hz.severity === 'red' ? 600 : 500, title: hz.title + (maybe ? ' (forse non sul percorso)' : info ? ' (non in vigore al passaggio)' : '') })
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
    evita: 'TomTom non usa questo tratto con il tuo mezzo ma lo usa in auto: può confermare il limite, ma può dipendere anche da altro.',
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
    if (hz.reason === 'altra-strada' || hz.reason === 'ponte' || hz.reason === 'servizio') {
      const street = C.streetAtAlong(state.route, hz.alongStart);
      const why = hz.reason === 'altra-strada' ? 'Secondo il calcolo del percorso, la strada del limite non è tra quelle percorse, anche se sulla mappa le due si sovrappongono.'
        : hz.reason === 'ponte' ? 'Qui il percorso passa su un ponte o in galleria: il limite potrebbe riguardare la strada sotto o sopra.'
          : `Il limite è su una stradina di servizio senza nome che sulla mappa coincide con ${street ? '«' + street + '»' : 'la strada percorsa'}: può essere il corsello di un parcheggio o una corsia sotto un viadotto.`;
      return h('div', { class: 'hzpop-maybe' },
        h('b', { text: 'Forse non sul percorso' }),
        h('span', { text: why + ' Controlla con Street View e indica se riguarda il tuo tragitto.' }),
        h('div', { class: 'hzpop-decide' },
          h('button', { type: 'button', class: 'btn-secondary', onclick: () => setDecision(hz, 'si') }, 'Riguarda il percorso'),
          h('button', { type: 'button', class: 'btn-secondary', onclick: () => setDecision(hz, 'no') }, 'Non riguarda il percorso')));
    }
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
    if (hz.rel === 'vicino' && hz.distM >= 2) rows.push(['Distanza dal percorso', `${Math.round(hz.distM)} m`]);
    rows.push(['Posizione', hazardKm(hz) + ' dalla partenza'], ['Vicino a', near]);
    if (hz.kind === 'orario') rows.push(['Quando vale', hz.when]);
    if (eta) rows.push(['Ci arrivi', hz.kind === 'orario' ? passText(eta) : 'verso le ' + C.fmtClock(eta, depMs())]);
    if (span > 150) rows.push(['Tratto', C.fmtDist(span)]);
    return h('div', { class: 'hzpop' },
      h('div', { class: 'hzpop-head' },
        h('span', { class: hz.rel === 'vicino' ? 'maybe' : null, svg: hazardSign(hz) }),
        h('span', null, h('b', { text: hz.title }), h('span', { class: `sev sev-${hz.severity}-bg`, text: sevLabel(hz) }),
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
        hz.severity !== 'info' ? h('button', { type: 'button', class: 'hz-avoid', onclick: () => avoidHazard(hz) }, 'Evita questo punto') : null,
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
    return t.name || (it.kind === 'bus' ? 'Parcheggio bus' : it.kind === 'pesanti' ? 'Parcheggio mezzi pesanti' : 'Parcheggio');
  }
  function parkingMeta(it) {
    const t = it.tags, out = [];
    out.push(`a ${C.fmtDist(it.d)}${it.d > C.PARK_NEAR ? ' dall\'arrivo' : ''}`);
    if (it.kind === 'generico') {
      if (it.area) out.push(`circa ${it.area.toLocaleString('it-IT')} m²`);
      if (t.capacity) out.push(`${t.capacity} posti auto`);
    }
    if (t.fee === 'yes') out.push('a pagamento');
    else if (t.fee === 'no') out.push('gratuito');
    if (t['capacity:bus'] || t['capacity:coach']) out.push(`${t['capacity:bus'] || t['capacity:coach']} posti bus`);
    if (t.access === 'private' || t.access === 'customers') out.push(t.access === 'private' ? 'privato' : 'solo clienti');
    if (t.opening_hours) out.push(t.opening_hours);
    if (it.kind === 'pesanti') out.push('verifica che accetti bus');
    return out.join(' · ');
  }
  const PARK_MARK = { bus: 'P<small>BUS</small>', pesanti: 'P<small>BUS</small>', generico: 'P<small>?</small>' };

  function drawParkings() {
    lg.parks.clearLayers();
    const p = state.parkings;
    if (!p || p.status !== 'done') return;
    for (const g of p.groups) {
      for (const it of g.official || []) {
        const icon = L.divIcon({ className: '', html: `<div class="pk-marker off">${it.tipo === 'discesa' ? 'S/D' : 'P'}<small>UFF.</small></div>`, iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] });
        L.marker([it.lat, it.lon], { icon, zIndexOffset: 250, title: it.nome + ' (ufficiale)' })
          .bindPopup(() => popupBox(it.nome, `${OFFICIAL_LABEL[it.tipo]} · ufficiale`, h('span', { text: it.nota })))
          .addTo(lg.parks);
      }
      for (const it of g.items.concat(g.far || [], g.generic || [])) {
        const gen = it.kind === 'generico';
        const icon = L.divIcon({ className: '', html: `<div class="pk-marker${gen ? ' gen' : ''}">${PARK_MARK[it.kind]}</div>`, iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] });
        L.marker([it.lat, it.lon], { icon, zIndexOffset: gen ? 150 : 200, title: parkingName(it) + (gen ? ' (non segnato per bus)' : '') })
          .bindPopup(() => popupBox(parkingName(it), parkingMeta(it), gen ? h('span', { text: 'Non segnato per bus: verifica che ci sia spazio per un pullman.' }) : null))
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
      if (o.kind === 'orario') {
        const ms = clockAtAlong(o.alongStart);
        o.stato = C.conditionalAt(o, state.route.vehicle, ms);
        o.severity = o.stato.severity;
        o.detail = orarioText(o.stato, ms);
      }
      if (tt) o.tomtom = tt.verdict(hz.alongStart, hz.alongEnd);
      o.decisione = decisionOf(hz);
      if (o.decisione === 'si' && (o.rel === 'vicino' || o.rel === 'escluso')) { o.rel = 'certo'; o.confermato = true; }
      if (o.rel === 'escluso') o.autoEscluso = true;
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
  /* "sab 24 ott, 08:32" */
  function passText(ms) {
    const d = new Date(ms);
    return d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + C.fmtClock(ms);
  }
  function orarioText(st, ms) {
    if (ms == null) return 'Orario di passaggio non disponibile: controlla quando vale il divieto.';
    const when = passText(ms);
    switch (st.state) {
      case 'attivo': return `In vigore quando passi (${when}).`;
      case 'ridosso': return st.after ? `Passi ${when}: il divieto entra in vigore meno di un'ora dopo.` : `Passi ${when}: il divieto è finito meno di un'ora prima.`;
      case 'non attivo': return `Non in vigore quando passi (${when}).`;
      default: return `Non si può stabilire se vale quando passi (${when}).`;
    }
  }
  function allHazards() { return hazardsWithStatus().filter((hz) => hz.decisione !== 'no' && !hz.autoEscluso); }
  function excludedHazards() { return hazardsWithStatus().filter((hz) => hz.decisione === 'no' || hz.autoEscluso); }

  function hazardCounts() {
    const a = state.analysis;
    const ttDone = state.tomtom && state.tomtom.status === 'done';
    if ((!a || !a.hazards) && !ttDone) return null;
    const all = allHazards();
    const list = all.filter((x) => x.severity !== 'info');
    const sure = list.filter((x) => x.rel !== 'vicino');
    return {
      red: sure.filter((x) => x.severity === 'red').length,
      amber: sure.filter((x) => x.severity === 'amber').length,
      vicino: list.length - sure.length,
      orari: all.length - list.length, // divieti a orario non in vigore al passaggio
    };
  }

  async function runTomTom(my, signal) {
    const r = state.route;
    const key = r.options && r.options.tomtomKey;
    if (!key) { state.tomtom = null; return; }
    try {
      const [bus, car] = await Promise.all([
        API.tomtomRoute(r.stops.map((s) => s.bus || s), r.vehicle, r.margin, r.options, key, 'bus', signal),
        API.tomtomRoute(r.stops.map((s) => s.bus || s), r.vehicle, r.margin, r.options, key, 'car', signal),
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
    renderSummary(); renderRouteNotes(); renderCheck(); renderPermits(); renderTimeline(); renderHazards(); renderParkings(); renderSteps(); renderMini();
  }

  /* avvisi sul percorso: tappe spostate dove arriva il pullman, alternativa ai punti non transitabili */
  function stopRole(i, n) { return i === n - 1 ? 'arrivo' : i === 0 ? 'partenza' : `tappa ${C.stopLetter(i)}`; }
  function renderRouteNotes() {
    const box = $('#route-notes');
    box.replaceChildren();
    const r = state.route;
    if (!r) return;
    const n = r.stops.length;
    for (const m of r.moved || []) {
      const role = stopRole(m.i, n);
      const walk = `circa ${C.fmtDist(m.walk.m)} a piedi (${m.walk.min} min)`;
      const street = h('span');
      const key = 'drop:' + m.to.lat.toFixed(5) + ',' + m.to.lon.toFixed(5);
      // prep: 'a' (arriva a / alla) oppure 'da' (parte da / dalla)
      const where = (prep) => (m.park ? `${prep} «${m.park.name}»${m.park.kind === 'generico' ? ', un parcheggio non segnato per bus' : ''}`
        : (prep === 'a' ? 'alla' : 'dalla') + ' strada raggiungibile più vicina' + (placeNames.get(key) ? ` (${placeNames.get(key)})` : ''));
      const sentence = () => (role === 'partenza' ? `Il pullman parte ${where('da')}: il gruppo lo raggiunge a piedi, ${walk}.`
        : role === 'arrivo' ? `Il pullman arriva ${where('a')}: da lì ${walk} fino alla meta.`
          : `Il pullman si ferma ${where('a')}: da lì ${walk} fino alla tappa.`);
      street.textContent = sentence();
      if (!m.park && !placeNames.has(key)) {
        API.reverse(m.to.lat, m.to.lon).then((label) => { placeNames.set(key, label ? label.split(',').slice(0, 2).join(',') : ''); street.textContent = sentence(); }).catch(() => {});
      }
      box.append(h('div', { class: 'route-note warn' },
        h('b', { text: `${role.charAt(0).toUpperCase() + role.slice(1)} spostat${role === 'tappa' || role.startsWith('tappa') || role === 'partenza' ? 'a' : 'o'}: «${m.label || 'punto sulla mappa'}» non si raggiunge in pullman` }),
        m.blockers.length ? h('span', { text: 'Strade chiuse al mezzo: ' + m.blockers.map((b) => `${b.name} (${b.issues.join(', ')})`).join('; ') + '.' }) : null,
        street,
        h('span', { class: 'hz-meta', text: 'Verifica che lì il pullman possa fermarsi e far scendere il gruppo.' + (m.via === 'valhalla-riserva' ? ' openrouteservice non trova un percorso fino a quel punto: il percorso è calcolato con Valhalla.' : '') }),
        h('button', { type: 'button', class: 'btn-ghost', onclick: () => map.fitBounds([[m.to.lat, m.to.lon], [m.from.lat, m.from.lon]], Object.assign({ maxZoom: 17 }, mapPadding())) }, 'Mostra sulla mappa')));
    }
    const p = r.plan || {};
    if (p.fastest && p.avoid && p.avoid.length) {
      const dk = r.distanceM - p.fastest.distanceM, dt = r.driveS - p.fastest.driveS;
      const delta = (v, f) => (Math.abs(v) < 1 ? 'uguale' : (v > 0 ? '+' : '−') + f(Math.abs(v)));
      box.append(h('div', { class: 'route-note' },
        h('b', { text: p.manual ? `Percorso che evita ${p.avoid.length === 1 ? 'il punto scelto' : `i ${p.avoid.length} punti scelti`}` : `Percorso alternativo: evita ${p.avoid.length === 1 ? 'un punto non transitabile' : `${p.avoid.length} punti non transitabili`}` }),
        h('ul', null, p.avoid.map((a) => h('li', { text: a.title + (a.name ? ' · ' + a.name : '') }))),
        h('span', { text: `Rispetto al più veloce: ${delta(dk, (x) => C.fmtDist(x))} di strada, ${delta(dt, (x) => C.fmtDur(x))} di guida.` }),
        h('button', { type: 'button', class: 'btn-ghost', onclick: () => computeRoute({ noAvoid: true }) }, 'Mostra il percorso più veloce')));
    }
    if (state.avoiding) box.append(h('div', { class: 'route-note loading' }, h('b', { text: 'Cerco un percorso che eviti i punti non transitabili…' })));
    if (p.avoidFailed) box.append(h('div', { class: 'route-note warn' }, h('span', { text: p.avoidFailed })));
    const c = hazardCounts();
    if (p.noAvoid && c && c.red) {
      box.append(h('div', { class: 'route-note warn' },
        h('b', { text: 'Questo è il percorso più veloce: passa da punti non transitabili.' }),
        h('button', { type: 'button', class: 'btn-ghost', onclick: () => computeRoute() }, 'Cerca un percorso che li eviti')));
    }
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
    const list = allHazards().filter((x) => x.severity !== 'info');
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

  const CALENDARIO_NOTE = 'Il calendario nazionale dei divieti per i mezzi pesanti (festivi ed estate) vale per i veicoli che trasportano merci sopra 7,5 t, non per gli autobus.';

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
        'Cerco su OpenStreetMap limiti di altezza, larghezza, lunghezza, massa e divieti per bus, anche a giorni e orari, lungo tutto il percorso.');
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
      body.append(h('span', { class: 'so-far src', text: (c.orari ? `${plural(c.orari, 'divieto', 'divieti')} a giorni e orari sul percorso non ${c.orari === 1 ? 'è' : 'sono'} in vigore quando passi. ` : '') + CALENDARIO_NOTE }));
      const fonte = dataSourceNote(a);
      if (fonte) body.append(h('span', { class: 'so-far src', text: fonte.text }));
      const rr = state.route;
      if (rr && rr.ways === null) body.append(h('span', { class: 'so-far src', text: 'Le strade del percorso non sono state riconosciute una per una: il controllo si basa solo sulla mappa.' }));
      else if (rr && rr.ways && rr.waysInfo && rr.waysInfo.failed) body.append(h('span', { class: 'so-far src', text: 'Strade del percorso riconosciute solo in parte: per i tratti mancanti il controllo si basa solo sulla mappa.' }));
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

  function hazardItem(hz) {
    const km = hz.alongStart / 1000;
    const span = hz.alongEnd - hz.alongStart;
    const eta = clockAtAlong(hz.alongStart);
    const meta = [hz.name, `km ${C.fmtNum(km, km < 10 ? 1 : 0)}`, eta && hz.kind !== 'orario' ? 'verso le ' + C.fmtClock(eta, depMs()) : '', span > 150 ? `tratto di ${C.fmtDist(span)}` : ''].filter(Boolean).join(' · ');
    const isOsm = !hz.ids[0].startsWith('tomtom/');
    const osm = hz.ids[0].split('/');
    const doubts = C.hazardDoubts(hz);
    const maybe = hz.rel === 'vicino';
    return h('li', { class: 'hz' + (maybe ? ' maybe' : '') + (hz.severity === 'info' ? ' info' : '') },
      h('span', { class: maybe ? 'maybe' : null, svg: hazardSign(hz) }),
      h('div', { class: 'hz-body' },
        maybe ? h('span', { class: 'maybe-tag', text: 'Forse non sul percorso' + ((hz.distM || 0) >= 2 ? ` · a ${Math.round(hz.distM)} m` : '') }) : null,
        h('span', { class: 'hz-title' }, hz.title, h('span', { class: `sev sev-${hz.severity}-bg`, text: sevLabel(hz) })),
        hz.kind === 'orario' ? h('span', { class: 'hz-when' }, h('b', { text: 'Quando vale: ' }), hz.when) : null,
        h('span', { text: hz.detail }),
        h('span', { class: 'hz-meta', text: meta }),
        hz.tomtom && hz.kind !== 'tomtom' ? h('span', { class: 'tt-verdict ' + hz.tomtom + (hz.severity === 'red' && hz.tomtom === 'passa' ? ' conflitto' : ''), text: ttText(hz) }) : null,
        doubts.length ? h('span', { class: 'hz-doubt', text: doubts.join(' ') }) : null,
        h('span', { class: 'hz-advice' }, h('b', { text: 'Cosa fare: ' }), C.hazardAdvice(hz)),
        h('span', { class: 'hz-links' },
          h('button', { type: 'button', onclick: () => focusHazard(hz) }, 'Mostra sulla mappa'),
          hz.severity !== 'info' ? h('button', { type: 'button', class: 'hz-avoid', onclick: () => avoidHazard(hz) }, 'Evita questo punto') : null,
          h('a', { href: streetViewUrl(hz), target: '_blank', rel: 'noopener' }, 'Street View'),
          isOsm ? h('a', { href: `https://www.openstreetmap.org/${osm[0]}/${osm[1]}`, target: '_blank', rel: 'noopener' }, 'Dati OSM') : null)));
  }

  function renderHazards() {
    const ul = $('#hazards');
    const cnt = $('#hz-count');
    ul.replaceChildren();
    cnt.textContent = '';
    const a = state.analysis;
    const loading = !a || a.status === 'loading';
    const all = allHazards();
    const list = all.filter((hz) => hz.severity !== 'info');
    const quiet = all.filter((hz) => hz.severity === 'info'); // divieti a orario non in vigore al passaggio
    if ((!a || !a.hazards) && !all.length) { ul.append(h('li', { class: 'none' }, loading ? 'Controllo in corso…' : 'Elenco non disponibile.')); return; }
    if (!all.length && !excludedHazards().length) {
      ul.append(h('li', { class: 'none' }, loading ? 'Nessun punto critico finora, il controllo continua…'
        : a.status === 'partial' ? 'Nessun punto critico nei tratti controllati.'
          : 'Nessun punto critico per questo mezzo nei dati di OpenStreetMap.'));
      return;
    }
    if (list.length) cnt.textContent = String(list.length);
    else if (!loading) ul.append(h('li', { class: 'none' }, 'Nessun punto critico al tuo passaggio.'));
    for (const hz of list) ul.append(hazardItem(hz));
    if (loading) ul.append(h('li', { class: 'none' }, 'Controllo degli altri tratti in corso…'));
    if (quiet.length) {
      ul.append(h('li', { class: 'hz-quiet' }, h('details', null,
        h('summary', null, `Divieti a giorni e orari non in vigore quando passi (${quiet.length})`),
        h('p', { class: 'hz-meta', text: 'Se cambi giorno o orario di partenza, o se accumuli ritardo, possono diventare validi.' }),
        h('ul', { class: 'hazards' }, quiet.map(hazardItem)))));
    }
    const ex = excludedHazards();
    if (ex.length) {
      ul.append(h('li', { class: 'hz-excluded' }, h('details', null,
        h('summary', null, `Esclusi perché non riguardano il percorso (${ex.length})`),
        ex.some((x) => x.autoEscluso) ? h('p', { class: 'hz-meta', text: 'Quelli esclusi in automatico sono su strade che passano sotto o sopra il percorso: il calcolo del percorso dice che qui passi su un ponte o in galleria.' }) : null,
        h('ul', null, ex.map((hz) => h('li', null,
          h('span', { text: `${hz.title} · ${hazardKm(hz)}` + (hz.autoEscluso ? ' · su una strada che passa sotto o sopra il percorso, che qui è su un ponte o in galleria' : '') }),
          h('button', { type: 'button', class: 'btn-ghost', onclick: () => setDecision(hz, hz.autoEscluso ? 'si' : null) }, 'Ripristina')))))));
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
    for (const g of p.groups) {
      const s = r.stops[g.stop];
      const far = g.far || [], generic = g.generic || [];
      ul.append(h('li', { class: 'pk-group', text: `Arrivo · ${s.label || 'destinazione'}` }));
      const official = g.official || [];
      if (official.length) {
        const P = window.RPPermessi || {};
        const fonte = P.fontiParcheggi && P.fontiParcheggi[official[0].citta];
        ul.append(h('li', { class: 'pk-sub', text: 'Parcheggi e fermate ufficiali per i bus' }));
        for (const it of official) ul.append(officialItem(it, P.fontiParcheggi && P.fontiParcheggi[it.citta]));
        ul.append(h('li', { class: 'hint' }, `Dai siti ufficiali, verificati il ${fmtDay(P.parcheggiVerificati)}. Orari, tariffe e prenotazioni cambiano: controlla la fonte prima di partire.`,
          fonte ? ' ' : null, fonte ? h('a', { href: fonte.url, target: '_blank', rel: 'noopener' }, fonte.testo) : null));
        ul.append(h('li', { class: 'pk-sub', text: 'Da OpenStreetMap' }));
      }
      if (g.items.length) for (const it of g.items) ul.append(parkingItem(it));
      else ul.append(h('li', { class: 'none' }, 'Nessun parcheggio per bus segnato su OpenStreetMap entro 1 km dall\'arrivo.'));
      if (far.length) {
        ul.append(h('li', { class: 'pk-sub', text: far.length === 1 ? 'Il più vicino, oltre 1 km' : 'I più vicini, oltre 1 km' }));
        for (const it of far) ul.append(parkingItem(it));
      }
      if (generic.length) {
        ul.append(h('li', { class: 'pk-sub', text: 'Parcheggi grandi entro 1 km, non segnati per bus' }),
          h('li', { class: 'hint', text: 'Possono andare bene per un pullman, ma nessuno lo ha indicato: controlla con la vista satellite o Street View lo spazio di manovra, l\'ingresso e i cartelli.' }));
        for (const it of generic) ul.append(parkingItem(it));
      }
      const hasBus = g.items.concat(far).some((it) => it.kind === 'bus');
      if (!g.items.length) ul.append(h('li', { class: 'hint', text: 'Suggerimento: chiedi alla struttura di arrivo o cerca “parcheggio bus turistici” sul sito del comune.' }));
      ul.append(h('li', { class: 'pk-report' },
        h('span', { text: hasBus ? 'Conosci un altro parcheggio adatto ai bus qui vicino?' : 'Conosci un parcheggio adatto ai bus qui vicino?' }),
        h('a', { href: `https://www.openstreetmap.org/note/new#map=17/${s.lat.toFixed(6)}/${s.lon.toFixed(6)}`, target: '_blank', rel: 'noopener' }, 'Segnala un parcheggio bus'),
        h('span', { class: 'hz-meta', text: 'Si apre una nota su OpenStreetMap: scrivi dov\'è, quanti pullman ci stanno e se è a pagamento. Un volontario la aggiunge alla mappa, per tutti.' })));
      ul.append(h('li', { class: 'pk-report' },
        h('span', { text: 'Cerca anche su Park Your Bus, l\'app con i parcheggi per pullman in Europa.' }),
        h('a', { href: parkYourBusUrl(), target: '_blank', rel: 'noopener' }, 'Apri Park Your Bus'),
        h('span', { class: 'hz-meta', text: 'Si apre la pagina dell\'app nello store del telefono: lì cerchi tu la località, l\'app non riceve dati da Rotta Pullman.' })));
    }
  }

  const OFFICIAL_LABEL = { sosta: 'Sosta', terminal: 'Terminal e check point', discesa: 'Salita e discesa' };
  function officialItem(it, fonte) {
    const at = `${it.lat.toFixed(6)},${it.lon.toFixed(6)}`;
    return h('li', { class: 'pk off' },
      h('span', { class: 'pk-icon', 'aria-hidden': 'true' }, it.tipo === 'discesa' ? 'S/D' : 'P'),
      h('div', { class: 'hz-body' },
        h('span', { class: 'hz-title' }, it.nome, h('span', { class: 'sev sev-off-bg', text: OFFICIAL_LABEL[it.tipo] })),
        h('span', { class: 'hz-meta', text: `a ${C.fmtDist(it.d)} dall'arrivo` + (it.lungo ? ' · lungo la via' : '') }),
        h('span', { text: it.nota }),
        h('span', { class: 'hz-links' },
          h('button', { type: 'button', onclick: () => flyTo(it.lat, it.lon, 17) }, 'Mostra sulla mappa'),
          h('a', { href: `https://www.google.com/maps/dir/?api=1&destination=${at}`, target: '_blank', rel: 'noopener' }, 'Naviga'),
          fonte ? h('a', { href: fonte.url, target: '_blank', rel: 'noopener' }, 'Fonte ufficiale') : null)));
  }

  /* Park Your Bus: pagina dell'app nello store (iPhone: App Store; Android: ricerca su Google Play) */
  function parkYourBusUrl() {
    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'https://play.google.com/store/search?q=ParkYourBus&c=apps';
    return 'https://apps.apple.com/app/id1044449061';
  }

  function parkingItem(it) {
    const gen = it.kind === 'generico';
    const at = `${it.lat.toFixed(6)},${it.lon.toFixed(6)}`;
    return h('li', { class: 'pk' + (gen ? ' gen' : '') },
      h('span', { class: 'pk-icon', 'aria-hidden': 'true' }, 'P'),
      h('div', { class: 'hz-body' },
        h('span', { class: 'hz-title' }, parkingName(it), gen ? h('span', { class: 'sev sev-amber-bg', text: 'Da verificare' }) : null),
        h('span', { class: 'hz-meta', text: parkingMeta(it) }),
        h('span', { class: 'hz-links' },
          h('button', { type: 'button', onclick: () => flyTo(it.lat, it.lon, 17) }, 'Mostra sulla mappa'),
          gen ? h('button', { type: 'button', onclick: () => showSatellite(it.lat, it.lon) }, 'Vista satellite') : null,
          gen ? h('a', { href: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${at}`, target: '_blank', rel: 'noopener' }, 'Street View') : null,
          h('a', { href: `https://www.google.com/maps/dir/?api=1&destination=${at}`, target: '_blank', rel: 'noopener' }, 'Naviga'),
          h('a', { href: `https://www.openstreetmap.org/${it.id}`, target: '_blank', rel: 'noopener' }, 'Dati OSM'))));
  }

  /* passa alla vista satellite e inquadra il punto */
  function showSatellite(lat, lon) {
    setBase('satellite');
    const radio = document.getElementById('base-satellite');
    if (radio) radio.checked = true;
    flyTo(lat, lon, 18);
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
    const wps = [];
    r.stops.forEach((s, i) => {
      if (s.bus) {
        wps.push({ lat: s.bus.lat, lon: s.bus.lon, name: `${C.stopLetter(i)} · fermata pullman per ${s.label}` });
        wps.push({ lat: s.lat, lon: s.lon, name: `${s.label} (a piedi)` });
      } else wps.push({ lat: s.lat, lon: s.lon, name: `${C.stopLetter(i)} · ${s.label}` });
    });
    for (const ev of state.plan.events) if (ev.type === 'pausa' && ev.lat != null) wps.push({ lat: ev.lat, lon: ev.lon, name: `Pausa ${ev.minutes}′ · ${ev.place ? ev.place.name : 'area idonea'}` });
    const a = state.analysis;
    for (const hz of allHazards()) wps.push({ lat: hz.lat, lon: hz.lon, name: `${hz.severity === 'info' ? 'Divieto a orario' : hz.rel === 'vicino' ? 'Forse (vicino)' : hz.severity === 'red' ? 'ATTENZIONE' : 'Verifica'}: ${hz.title}`, desc: hz.when ? `Vale: ${hz.when}. ${hz.detail}` : hz.detail });
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
    document.querySelectorAll('.pm-how, .hz-quiet details').forEach((d) => { d.open = true; });
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
