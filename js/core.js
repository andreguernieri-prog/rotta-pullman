/*
 * Rotta Pullman — logica pura, senza DOM né rete.
 * Gira nel browser (window.RPCore) e in Node (require) per i test.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RPCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Mezzi tipo. Valori indicativi: fa fede la carta di circolazione.    */
  /* ------------------------------------------------------------------ */
  const PRESETS = [
    { id: 'midi', nome: 'Midibus 9–10 m', lunghezza: 9.9, altezza: 3.3, larghezza: 2.4, peso: 13.5, assi: 2, caricoAsse: 9.5 },
    { id: 'gt12', nome: 'Gran turismo 12 m', lunghezza: 12.2, altezza: 3.7, larghezza: 2.55, peso: 19.5, assi: 2, caricoAsse: 11.5 },
    { id: 'gt13', nome: 'Gran turismo 13 m · 3 assi', lunghezza: 13.3, altezza: 3.75, larghezza: 2.55, peso: 25, assi: 3, caricoAsse: 11.5 },
    { id: 'gt14', nome: 'Gran turismo 14 m · 3 assi', lunghezza: 14.1, altezza: 3.85, larghezza: 2.55, peso: 26, assi: 3, caricoAsse: 11.5 },
    { id: 'dd14', nome: 'Bipiano 14 m', lunghezza: 14, altezza: 4, larghezza: 2.55, peso: 26, assi: 3, caricoAsse: 11.5 },
    { id: 'gt15', nome: 'Gran turismo 15 m', lunghezza: 15, altezza: 3.9, larghezza: 2.55, peso: 26, assi: 3, caricoAsse: 11.5 },
    { id: 'art18', nome: 'Snodato 18 m', lunghezza: 18, altezza: 3.4, larghezza: 2.55, peso: 29, assi: 3, caricoAsse: 11.5 },
  ];

  const LIMITS = {
    lunghezza: [6, 25], altezza: [2.5, 4.5], larghezza: [2, 2.6],
    peso: [3.5, 40], caricoAsse: [5, 13], assi: [2, 5],
  };

  function sanitizeVehicle(v) {
    const base = PRESETS[2];
    const out = { nome: String((v && v.nome) || base.nome).slice(0, 80) };
    for (const k of Object.keys(LIMITS)) {
      let x = Number(v && v[k]);
      if (!isFinite(x)) x = base[k];
      const [lo, hi] = LIMITS[k];
      x = Math.min(hi, Math.max(lo, x));
      out[k] = k === 'assi' ? Math.round(x) : Math.round(x * 100) / 100;
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Geometria                                                           */
  /* ------------------------------------------------------------------ */
  const RAD = Math.PI / 180;
  const EARTH = 6371008.8;

  function haversine(a, b) {
    const dLat = (b[0] - a[0]) * RAD, dLon = (b[1] - a[1]) * RAD;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /* metri per grado alla latitudine data (approssimazione locale) */
  function metersPerDeg(lat) {
    return { kx: 111320 * Math.cos(lat * RAD), ky: 110540 };
  }

  function bearing(a, b) {
    const { kx, ky } = metersPerDeg((a[0] + b[0]) / 2);
    return Math.atan2((b[1] - a[1]) * kx, (b[0] - a[0]) * ky);
  }

  /* differenza fra direzioni senza verso, in radianti [0, PI/2] */
  function axisDiff(a, b) {
    let d = Math.abs(a - b) % Math.PI;
    if (d > Math.PI / 2) d = Math.PI - d;
    return d;
  }

  function decodePolyline(str, precision) {
    const factor = Math.pow(10, precision == null ? 6 : precision);
    const out = [];
    let index = 0, lat = 0, lon = 0;
    while (index < str.length) {
      let result = 0, shift = 0, b;
      do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      result = 0; shift = 0;
      do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lon += (result & 1) ? ~(result >> 1) : (result >> 1);
      out.push([lat / factor, lon / factor]);
    }
    return out;
  }

  function encodePolyline(coords, precision) {
    const factor = Math.pow(10, precision == null ? 6 : precision);
    let out = '', pLat = 0, pLon = 0;
    const enc = (v) => {
      v = v < 0 ? ~(v << 1) : (v << 1);
      let s = '';
      while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
      return s + String.fromCharCode(v + 63);
    };
    for (const [la, lo] of coords) {
      const iLat = Math.round(la * factor), iLon = Math.round(lo * factor);
      out += enc(iLat - pLat) + enc(iLon - pLon);
      pLat = iLat; pLon = iLon;
    }
    return out;
  }

  /* Douglas–Peucker iterativo, tolleranza in metri */
  function simplify(coords, tol) {
    const n = coords.length;
    if (n < 3) return coords.slice();
    const lat0 = coords[0][0];
    const { kx, ky } = metersPerDeg(lat0);
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    const stack = [[0, n - 1]];
    const tol2 = tol * tol;
    while (stack.length) {
      const [s, e] = stack.pop();
      const ax = coords[s][1] * kx, ay = coords[s][0] * ky;
      const bx = coords[e][1] * kx, by = coords[e][0] * ky;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      let maxD = -1, idx = -1;
      for (let i = s + 1; i < e; i++) {
        const px = coords[i][1] * kx, py = coords[i][0] * ky;
        let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + t * dx - px, qy = ay + t * dy - py;
        const d = qx * qx + qy * qy;
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > tol2 && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(coords[i]);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Indice spaziale del percorso                                        */
  /* ------------------------------------------------------------------ */
  function RouteIndex(coords) {
    this.coords = coords;
    const n = coords.length;
    const cumD = new Float64Array(n);
    for (let i = 1; i < n; i++) cumD[i] = cumD[i - 1] + haversine(coords[i - 1], coords[i]);
    this.cumD = cumD;
    this.total = n ? cumD[n - 1] : 0;
    this.cell = 0.005;
    this.grid = new Map();
    for (let i = 0; i < n - 1; i++) {
      const a = coords[i], b = coords[i + 1];
      const y0 = Math.floor(Math.min(a[0], b[0]) / this.cell), y1 = Math.floor(Math.max(a[0], b[0]) / this.cell);
      const x0 = Math.floor(Math.min(a[1], b[1]) / this.cell), x1 = Math.floor(Math.max(a[1], b[1]) / this.cell);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const k = cellKey(y, x);
          let list = this.grid.get(k);
          if (!list) { list = []; this.grid.set(k, list); }
          list.push(i);
        }
      }
    }
  }
  function cellKey(y, x) { return (y + 50000) * 200000 + (x + 100000); }

  /* punto del percorso più vicino entro maxDist metri, o null */
  RouteIndex.prototype.nearest = function (lat, lon, maxDist) {
    const cell = this.cell;
    const cy = Math.floor(lat / cell), cx = Math.floor(lon / cell);
    const { kx, ky } = metersPerDeg(lat);
    const ry = Math.ceil(maxDist / (cell * ky)), rx = Math.ceil(maxDist / (cell * kx));
    let best = null;
    const seen = new Set();
    for (let y = cy - ry; y <= cy + ry; y++) {
      for (let x = cx - rx; x <= cx + rx; x++) {
        const list = this.grid.get(cellKey(y, x));
        if (!list) continue;
        for (const i of list) {
          if (seen.has(i)) continue;
          seen.add(i);
          const a = this.coords[i], b = this.coords[i + 1];
          const ax = (a[1] - lon) * kx, ay = (a[0] - lat) * ky;
          const dx = (b[1] - a[1]) * kx, dy = (b[0] - a[0]) * ky;
          const L2 = dx * dx + dy * dy;
          let t = L2 > 0 ? -(ax * dx + ay * dy) / L2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = ax + t * dx, py = ay + t * dy;
          const d = Math.sqrt(px * px + py * py);
          if (d <= maxDist && (!best || d < best.dist)) {
            const cross = dx * (-py) - dy * (-px); // >0: punto a sinistra del verso di marcia
            best = {
              dist: d, seg: i, t,
              along: this.cumD[i] + t * (this.cumD[i + 1] - this.cumD[i]),
              bearing: Math.atan2(dx, dy),
              side: Math.abs(cross) < 1e-9 ? 'on' : cross > 0 ? 'left' : 'right',
            };
          }
        }
      }
    }
    return best;
  };

  /* vertice del percorso più vicino entro maxDist metri: il percorso passa per tutti i nodi OSM delle strade che usa */
  RouteIndex.prototype.nearestVertex = function (lat, lon, maxDist) {
    const cell = this.cell;
    const cy = Math.floor(lat / cell), cx = Math.floor(lon / cell);
    const { kx, ky } = metersPerDeg(lat);
    const ry = Math.ceil(maxDist / (cell * ky)), rx = Math.ceil(maxDist / (cell * kx));
    let best = null;
    for (let y = cy - ry; y <= cy + ry; y++) {
      for (let x = cx - rx; x <= cx + rx; x++) {
        const list = this.grid.get(cellKey(y, x));
        if (!list) continue;
        for (const i of list) {
          for (const j of [i, i + 1]) {
            const v = this.coords[j];
            const d = Math.hypot((v[1] - lon) * kx, (v[0] - lat) * ky);
            if (d <= maxDist && (!best || d < best.dist)) best = { dist: d, index: j, along: this.cumD[j] };
          }
        }
      }
    }
    return best;
  };

  /* il percorso passa entro marginM metri dal rettangolo? (filtro veloce, può dare falsi positivi) */
  RouteIndex.prototype.nearBox = function (minLat, minLon, maxLat, maxLon, marginM) {
    const { kx, ky } = metersPerDeg((minLat + maxLat) / 2);
    const dLat = marginM / ky, dLon = marginM / kx, cell = this.cell;
    const y0 = Math.floor((minLat - dLat) / cell), y1 = Math.floor((maxLat + dLat) / cell);
    const x0 = Math.floor((minLon - dLon) / cell), x1 = Math.floor((maxLon + dLon) / cell);
    if ((y1 - y0 + 1) * (x1 - x0 + 1) > 400) return true;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.grid.has(cellKey(y, x))) return true;
    return false;
  };

  RouteIndex.prototype.pointAt = function (along) {
    const c = this.coords, d = this.cumD, n = c.length;
    if (!n) return null;
    if (along <= 0) return c[0].slice();
    if (along >= this.total) return c[n - 1].slice();
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m] <= along) lo = m; else hi = m; }
    const span = d[hi] - d[lo] || 1, t = (along - d[lo]) / span;
    return [c[lo][0] + (c[hi][0] - c[lo][0]) * t, c[lo][1] + (c[hi][1] - c[lo][1]) * t];
  };

  /* indice del vertice alla distanza data */
  RouteIndex.prototype.indexAt = function (along) {
    const d = this.cumD;
    let lo = 0, hi = d.length - 1;
    if (hi <= 0) return 0;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m] <= along) lo = m; else hi = m; }
    return lo;
  };

  /* ------------------------------------------------------------------ */
  /* Tempi di guida lungo il percorso                                    */
  /* ------------------------------------------------------------------ */
  /*
   * steps: [{from, to, durS}] con indici sui vertici. Il tempo di ogni
   * manovra viene distribuito sui suoi segmenti in proporzione alla lunghezza.
   */
  function buildCumTime(cumD, steps, totalS) {
    const n = cumD.length;
    const segT = new Float64Array(Math.max(0, n - 1)).fill(NaN);
    for (const s of steps || []) {
      const from = Math.max(0, s.from | 0), to = Math.min(n - 1, s.to | 0);
      if (to <= from || !(s.durS >= 0)) continue;
      const len = cumD[to] - cumD[from];
      for (let i = from; i < to; i++) {
        const segLen = cumD[i + 1] - cumD[i];
        segT[i] = len > 0 ? s.durS * (segLen / len) : s.durS / (to - from);
      }
    }
    // segmenti non coperti: velocità media del resto
    let knownT = 0, knownD = 0;
    for (let i = 0; i < n - 1; i++) if (!isNaN(segT[i])) { knownT += segT[i]; knownD += cumD[i + 1] - cumD[i]; }
    const total = n ? cumD[n - 1] : 0;
    let speed = knownD > 0 && knownT > 0 ? knownD / knownT : (totalS > 0 && total > 0 ? total / totalS : 20);
    const cumT = new Float64Array(n);
    for (let i = 0; i < n - 1; i++) {
      const t = isNaN(segT[i]) ? (cumD[i + 1] - cumD[i]) / speed : segT[i];
      cumT[i + 1] = cumT[i] + t;
    }
    return cumT;
  }

  /* divide il percorso in tratti di circa maxM metri (i tratti condividono il punto di confine) */
  function splitByDistance(coords, cumD, maxM) {
    const out = [];
    const n = coords.length;
    if (n < 2) return out;
    let start = 0;
    for (let i = 1; i < n; i++) {
      if (cumD[i] - cumD[start] >= maxM || i === n - 1) {
        out.push({ from: start, to: i, coords: coords.slice(start, i + 1) });
        start = i;
      }
    }
    return out;
  }

  function interp(xs, ys, x) {
    const n = xs.length;
    if (!n) return 0;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
    const span = xs[hi] - xs[lo];
    return span > 0 ? ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / span : ys[lo];
  }

  /* ------------------------------------------------------------------ */
  /* Normalizzazione delle risposte dei motori di calcolo                */
  /* ------------------------------------------------------------------ */
  const VALHALLA_ANGLE = {
    1: 0, 2: 45, 3: -45, 4: 'arrive', 5: 'arrive', 6: 'arrive', 7: 0, 8: 0, 9: 30, 10: 90, 11: 135,
    12: 180, 13: 180, 14: -135, 15: -90, 16: -30, 17: 0, 18: 30, 19: -30, 20: 30, 21: -30,
    22: 0, 23: 20, 24: -20, 25: 0, 26: 'round', 27: 'round', 28: 'ferry', 29: 'ferry',
    37: 20, 38: -20,
  };
  const ORS_ANGLE = { 0: -90, 1: 90, 2: -135, 3: 135, 4: -45, 5: 45, 6: 0, 7: 'round', 8: 'round', 9: 180, 10: 'arrive', 11: 0, 12: -20, 13: 20 };

  function normalizeValhalla(data) {
    const trip = data && data.trip;
    if (!trip || !trip.legs || !trip.legs.length) throw new Error('Risposta del servizio non valida.');
    const coords = [], steps = [], legEnds = [0];
    for (const leg of trip.legs) {
      const shape = decodePolyline(leg.shape, 6);
      const offset = coords.length ? coords.length - 1 : 0;
      if (coords.length) shape.shift();
      for (const p of shape) coords.push(p);
      for (const m of leg.maneuvers || []) {
        steps.push({
          text: m.instruction || '',
          distM: (m.length || 0) * 1000,
          durS: m.time || 0,
          from: offset + (m.begin_shape_index || 0),
          to: offset + (m.end_shape_index || 0),
          icon: VALHALLA_ANGLE[m.type] != null ? VALHALLA_ANGLE[m.type] : 0,
          streets: (m.street_names || []).join(', '),
        });
      }
      legEnds.push(coords.length - 1);
    }
    const s = trip.summary || {};
    return finishRoute({
      coords, steps, legEnds,
      durationS: s.time || 0,
      flags: { pedaggi: !!s.has_toll, autostrada: !!s.has_highway, traghetto: !!s.has_ferry },
      engine: 'valhalla',
    });
  }

  function normalizeOrs(data) {
    const f = data && data.features && data.features[0];
    if (!f) throw new Error('Risposta del servizio non valida.');
    const coords = f.geometry.coordinates.map((c) => [c[1], c[0]]);
    const p = f.properties || {};
    const steps = [];
    let tolls = false;
    for (const seg of p.segments || []) {
      for (const st of seg.steps || []) {
        steps.push({
          text: st.instruction || '',
          distM: (st.distance || 0) * 1000,
          durS: st.duration || 0,
          from: st.way_points ? st.way_points[0] : 0,
          to: st.way_points ? st.way_points[1] : 0,
          icon: ORS_ANGLE[st.type] != null ? ORS_ANGLE[st.type] : 0,
          streets: st.name && st.name !== '-' ? st.name : '',
        });
      }
    }
    if (p.extras && p.extras.tollways && p.extras.tollways.summary) {
      tolls = p.extras.tollways.summary.some((x) => x.value === 1 && x.distance > 0);
    }
    const legEnds = (p.way_points && p.way_points.length) ? p.way_points.slice() : [0, coords.length - 1];
    return finishRoute({
      coords, steps, legEnds,
      durationS: (p.summary && p.summary.duration) || 0,
      flags: { pedaggi: tolls, autostrada: false, traghetto: false },
      engine: 'ors',
    });
  }

  function finishRoute(r) {
    const idx = new RouteIndex(r.coords);
    r.index = idx;
    r.cumD = idx.cumD;
    r.distanceM = idx.total;
    r.cumT = buildCumTime(idx.cumD, r.steps, r.durationS);
    r.driveS = r.cumT[r.cumT.length - 1] || r.durationS;
    r.legT = r.legEnds.map((i) => r.cumT[Math.min(i, r.cumT.length - 1)]);
    r.legD = r.legEnds.map((i) => r.cumD[Math.min(i, r.cumD.length - 1)]);
    return r;
  }

  function timeAtAlong(route, along) { return interp(route.cumD, route.cumT, along); }

  /* nome della strada percorsa in un punto (dalle manovre del calcolo) */
  function streetAtAlong(route, along) {
    const i = route.index.indexAt(along);
    for (const st of route.steps || []) if (st.from <= i && i < st.to) return st.streets || '';
    return '';
  }
  function alongAtTime(route, T) { return interp(route.cumT, route.cumD, T); }

  /* ------------------------------------------------------------------ */
  /* Valori dei cartelli OSM                                             */
  /* ------------------------------------------------------------------ */
  /* metri; 'below_default' per "altezza ridotta" senza cifra; null se assente o senza limite */
  function parseLength(raw) {
    if (raw == null) return null;
    let best = null, below = false;
    for (let part of String(raw).split(';')) {
      let s = part.trim().toLowerCase();
      if (!s || s === 'none' || s === 'default' || s === 'unsigned' || s === 'no') continue;
      if (s === 'below_default') { below = true; continue; }
      let v = null;
      let m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|’|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|”|''|in|inch|inches)?)?$/);
      if (m) v = Number(m[1]) * 0.3048 + (m[2] ? Number(m[2]) * 0.0254 : 0);
      else {
        s = s.replace(',', '.');
        m = s.match(/^(\d+(?:\.\d+)?)\s*(m|cm|mm|mt|metri)?\.?$/);
        if (m) v = Number(m[1]) * (m[2] === 'cm' ? 0.01 : m[2] === 'mm' ? 0.001 : 1);
      }
      if (v != null && isFinite(v) && v > 0 && v < 60) best = best == null ? v : Math.min(best, v);
    }
    if (best != null) return best;
    return below ? 'below_default' : null;
  }

  /* tonnellate; null se assente */
  function parseWeight(raw) {
    if (raw == null) return null;
    let best = null;
    for (const part of String(raw).split(';')) {
      const s = part.trim().toLowerCase().replace(',', '.');
      const m = s.match(/^(\d+(?:\.\d+)?)\s*(t|ton|tonn|tonnes|kg|st|lbs?|q)?\.?$/);
      if (!m) continue;
      let v = Number(m[1]);
      const u = m[2];
      if (u === 'kg') v /= 1000;
      else if (u === 'st') v *= 0.907185;
      else if (u === 'lb' || u === 'lbs') v *= 0.000453592;
      else if (u === 'q') v /= 10;
      if (isFinite(v) && v > 0 && v < 200) best = best == null ? v : Math.min(best, v);
    }
    return best;
  }

  function fmtNum(x, dec) {
    if (x == null || !isFinite(x)) return '—';
    const d = dec == null ? (Math.abs(x - Math.round(x)) < 1e-9 ? 0 : (Math.abs(x * 10 - Math.round(x * 10)) < 1e-9 ? 1 : 2)) : dec;
    return x.toFixed(d).replace('.', ',');
  }

  const YES = /^(yes|designated|permissive)$/;

  /*
   * Confronta i tag di un elemento OSM con il mezzo.
   * Restituisce i problemi: severity 'red' (non transitabile) o 'amber' (da verificare).
   */
  function evaluateTags(tags, veh, opts) {
    const out = [];
    if (!tags) return out;
    const h = [parseLength(tags.maxheight), parseLength(tags['maxheight:physical'])];
    const hNum = h.filter((x) => typeof x === 'number');
    if (hNum.length) {
      const lim = Math.min.apply(null, hNum);
      if (lim < veh.altezza) out.push({ kind: 'altezza', value: lim, severity: 'red', title: `Altezza massima ${fmtNum(lim)} m`, detail: `Il mezzo è alto ${fmtNum(veh.altezza)} m` });
      else if (lim < veh.altezza + 0.3) out.push({ kind: 'altezza', value: lim, severity: 'amber', title: `Altezza massima ${fmtNum(lim)} m`, detail: `Margine di soli ${Math.round((lim - veh.altezza) * 100)} cm` });
    } else if (h.includes('below_default')) {
      out.push({ kind: 'altezza', value: null, severity: 'amber', title: 'Altezza ridotta', detail: 'Limite segnalato senza valore: verifica sul posto' });
    }
    const w = [parseLength(tags.maxwidth), parseLength(tags['maxwidth:physical'])].filter((x) => typeof x === 'number');
    if (w.length) {
      const lim = Math.min.apply(null, w);
      if (lim < veh.larghezza) out.push({ kind: 'larghezza', value: lim, severity: 'red', title: `Larghezza massima ${fmtNum(lim)} m`, detail: `Il mezzo è largo ${fmtNum(veh.larghezza)} m` });
      else if (lim < veh.larghezza + 0.2) out.push({ kind: 'larghezza', value: lim, severity: 'amber', title: `Larghezza massima ${fmtNum(lim)} m`, detail: `Margine di soli ${Math.round((lim - veh.larghezza) * 100)} cm` });
    }
    const L = parseLength(tags.maxlength);
    if (typeof L === 'number' && L < veh.lunghezza) out.push({ kind: 'lunghezza', value: L, severity: 'red', title: `Lunghezza massima ${fmtNum(L)} m`, detail: `Il mezzo è lungo ${fmtNum(veh.lunghezza)} m` });
    const W = [parseWeight(tags.maxweight), parseWeight(tags.maxweightrating)].filter((x) => x != null);
    if (W.length) {
      const lim = Math.min.apply(null, W);
      if (lim < veh.peso) out.push({ kind: 'peso', value: lim, severity: 'red', title: `Massa massima ${fmtNum(lim)} t`, detail: `Il mezzo pesa fino a ${fmtNum(veh.peso)} t` });
    }
    const A = parseWeight(tags.maxaxleload);
    if (A != null && A < veh.caricoAsse) out.push({ kind: 'asse', value: A, severity: 'red', title: `Carico per asse max ${fmtNum(A)} t`, detail: `Il mezzo ha ${fmtNum(veh.caricoAsse)} t per asse` });

    const busOk = YES.test(tags.tourist_bus || '') || YES.test(tags.bus || '') || YES.test(tags.coach || '') || YES.test(tags.psv || '');
    const acc = accessFor(tags);
    if (acc && acc.value === 'no') {
      const perBus = acc.key === 'tourist_bus' || acc.key === 'coach' || acc.key === 'bus';
      out.push({ kind: 'bus', value: null, severity: 'red', title: perBus ? 'Divieto di transito per bus' : 'Divieto di transito', detail: ACCESS_DETAIL[acc.key] });
    } else if (opts && opts.reserved && acc && RESERVED[acc.value]) {
      out.push({ kind: 'bus', value: null, severity: 'amber', title: 'Transito riservato', detail: 'Transito ' + RESERVED[acc.value] });
    } else if (tags.hgv === 'no' && !busOk) {
      out.push({ kind: 'pesanti', value: null, severity: 'amber', title: 'Divieto per mezzi pesanti', detail: 'Verifica sul cartello se vale anche per gli autobus' });
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Divieti e limiti a giorni e orari (tag OSM ":conditional")          */
  /* ------------------------------------------------------------------ */
  // dal più specifico al più generale: per il bus vale la prima chiave presente
  const ACCESS_ORDER = ['tourist_bus', 'coach', 'bus', 'motor_vehicle', 'vehicle', 'access'];
  const ACCESS_DETAIL = {
    tourist_bus: 'Vietato ai bus turistici', coach: 'Vietato ai bus turistici', bus: 'Vietato agli autobus',
    motor_vehicle: 'Vietato a tutti i veicoli a motore', vehicle: 'Vietato a tutti i veicoli', access: 'Vietato a tutti',
  };
  const RESERVED = {
    private: 'riservato agli autorizzati', permit: 'solo con permesso', destination: 'solo per chi è diretto lì',
    delivery: 'solo per carico e scarico', customers: 'solo per i clienti', agricultural: 'solo per mezzi agricoli', forestry: 'solo per mezzi forestali',
  };
  const COND_ACCESS = ACCESS_ORDER.concat(['hgv']);
  const COND_LIMITS = ['maxheight', 'maxwidth', 'maxlength', 'maxweight', 'maxweightrating', 'maxaxleload'];
  const COND_KEYS = COND_ACCESS.concat(COND_LIMITS);
  const LIMIT_KIND = { maxheight: 'altezza', maxwidth: 'larghezza', maxlength: 'lunghezza', maxweight: 'peso', maxweightrating: 'peso', maxaxleload: 'asse' };
  const SUBJECT_IT = {
    tourist_bus: 'bus turistici', coach: 'bus turistici', bus: 'autobus', hgv: 'mezzi pesanti', motor_vehicle: 'veicoli a motore', vehicle: 'veicoli', access: 'tutti',
    maxheight: 'altezza', maxwidth: 'larghezza', maxlength: 'lunghezza', maxweight: 'massa', maxweightrating: 'massa', maxaxleload: 'carico per asse',
  };

  /* chiave di accesso che decide per un bus turistico */
  function accessFor(tags) {
    for (const k of ACCESS_ORDER) if (tags[k] != null && tags[k] !== '') return { key: k, value: String(tags[k]) };
    return null;
  }
  function issueCat(kind) { return kind === 'bus' || kind === 'pesanti' ? 'accesso' : kind; }
  function keyCat(k) { return LIMIT_KIND[k] || 'accesso'; }

  /* vero / falso / '?' (non si sa) */
  function and3(a, b) { return a === false || b === false ? false : a === '?' || b === '?' ? '?' : true; }
  function or3(a, b) { return a === true || b === true ? true : a === '?' || b === '?' ? '?' : false; }

  /* divide al separatore, ignorando quelli tra parentesi o virgolette */
  function splitTop(s, sep) {
    const out = [];
    let depth = 0, q = false, cur = '';
    for (const ch of String(s)) {
      if (ch === '"') q = !q;
      else if (!q && ch === '(') depth++;
      else if (!q && ch === ')') depth = Math.max(0, depth - 1);
      if (!q && depth === 0 && ch === sep) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim()).filter(Boolean);
  }
  /* toglie le parentesi che racchiudono tutto il testo */
  function unwrap(s) {
    s = s.trim();
    while (s[0] === '(') {
      let depth = 0, end = -1;
      for (let i = 0; i < s.length; i++) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end !== s.length - 1) break;
      s = s.slice(1, -1).trim();
    }
    return s;
  }

  /* --- orari nel formato opening_hours (la parte usata nei divieti) --- */
  const DAY_CODES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']; // come Date.getDay()
  const MONTH_CODES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MON = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
  const DATE_RE = new RegExp('^(?:(\\d{4})\\s+)?' + MON + '(?:\\s+(\\d{1,2})(?!\\d|:\\d))?(?:\\s*-\\s*(?:(?:(\\d{4})\\s+)?' + MON + '(?:\\s+(\\d{1,2})(?!\\d|:\\d))?|(\\d{1,2})(?!\\d|:\\d)))?');
  const DAY_RE = /^(?:(Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su))?|(PH|SH))(?![\w[])/;
  const TIME_TOKEN = '(\\d{1,2}:\\d{2}|sunrise|sunset|dawn|dusk)';
  const TIME_RE = new RegExp('^' + TIME_TOKEN + '\\s*(?:-\\s*' + TIME_TOKEN + '|(\\+))');
  // alba e tramonto medi in Italia, ora locale, per mese (minuti dalla mezzanotte)
  const SUNRISE = [455, 430, 395, 400, 360, 335, 345, 375, 410, 440, 420, 450];
  const SUNSET = [1020, 1060, 1095, 1190, 1220, 1245, 1245, 1210, 1160, 1110, 1010, 1000];

  function parseOHRule(str) {
    let s = str.trim();
    const eat = (re) => { const m = re.exec(s); if (!m) return null; s = s.slice(m[0].length).trim(); return m; };
    const r = { years: null, dates: null, days: null, ph: false, sh: false, times: null, off: false, unknown: false };
    let m;
    if (eat(/^24\/7/)) { /* sempre */ }
    if ((m = eat(/^(\d{4})(?:\s*-\s*(\d{4}))?(?=\s|$)(?!\s+[A-Z][a-z]{2}\b)/))) r.years = [+m[1], +(m[2] || m[1])];
    while ((m = eat(DATE_RE))) {
      // m: anno1, mese1, giorno1, anno2, mese2, giorno2, giorno2 nello stesso mese
      const y1 = m[1] ? +m[1] : null, m1 = MONTH_CODES.indexOf(m[2]) + 1, d1 = m[3] ? +m[3] : null;
      const y2 = m[4] ? +m[4] : y1, m2 = m[5] ? MONTH_CODES.indexOf(m[5]) + 1 : m1;
      const d2 = m[6] ? +m[6] : m[7] ? +m[7] : m[5] ? 31 : d1 != null ? d1 : 31;
      const a = m1 * 100 + (d1 || 1), b = m2 * 100 + d2;
      (r.dates = r.dates || []).push(y1 ? [y1 * 10000 + a, y2 * 10000 + b, true] : [a, b]);
      if (!eat(/^,/)) break;
    }
    if (r.dates || r.years) eat(/^:/); // "Jun 22-Sep 12: Mo-Su 16:00-24:00"
    while ((m = eat(DAY_RE))) {
      if (m[3] === 'PH') r.ph = true;
      else if (m[3] === 'SH') r.sh = true;
      else {
        r.days = r.days || new Set();
        const a = DAY_CODES.indexOf(m[1]), b = m[2] ? DAY_CODES.indexOf(m[2]) : a;
        for (let i = a; ; i = (i + 1) % 7) { r.days.add(i); if (i === b) break; }
      }
      if (!eat(/^,/)) break;
    }
    if (eat(/^24\/7/)) { /* tutto il giorno */ }
    while ((m = eat(TIME_RE))) {
      const t = (x) => (/:/.test(x) ? (() => { const [hh, mm] = x.split(':').map(Number); return hh * 60 + mm; })() : x);
      (r.times = r.times || []).push([t(m[1]), m[3] ? 24 * 60 : t(m[2])]);
      eat(/^,/); // fasce separate da virgola o da spazio
    }
    if ((m = eat(/^(off|closed|open|unknown)\b/i))) {
      const mod = m[1].toLowerCase();
      r.off = mod === 'off' || mod === 'closed';
      r.unknown = mod === 'unknown';
    }
    return s ? null : r; // testo non riconosciuto
  }

  const OH_WORDS = DAY_CODES.concat(MONTH_CODES, ['PH', 'SH']);
  function parseOH(str) {
    const s = String(str).replace(/"[^"]*"/g, ' ')
      .replace(/\b[a-z]{2,3}\b/gi, (w) => OH_WORDS.find((x) => x.toLowerCase() === w.toLowerCase()) || w)
      .trim();
    if (!s) return null;
    const rules = [];
    for (const part of s.split(/\s*(?:;|\|\|)\s*/)) {
      if (!part) continue;
      // "Mo-Fr 07:00-09:00, Sa 08:00-12:00": la virgola dopo un orario apre una regola aggiuntiva
      const sub = part.split(/(?<=\d|off|closed)\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b)/);
      sub.forEach((x, i) => {
        const r = parseOHRule(x);
        if (r) { r.additional = i > 0; rules.push(r); } else rules.push(null);
      });
    }
    return rules.length && rules.every(Boolean) ? { rules } : null;
  }

  /* festività nazionali italiane */
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }
  const FESTE = ['1-1', '1-6', '4-25', '5-1', '6-2', '8-15', '11-1', '12-8', '12-25', '12-26'];
  function isHolidayIT(d) {
    if (FESTE.includes((d.getMonth() + 1) + '-' + d.getDate())) return true;
    const e = easter(d.getFullYear());
    const lun = new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1);
    return [e, lun].some((x) => x.getMonth() === d.getMonth() && x.getDate() === d.getDate());
  }

  function dayMatch(r, d) {
    if (r.years && (d.getFullYear() < r.years[0] || d.getFullYear() > r.years[1])) return false;
    if (r.dates) {
      const md = (d.getMonth() + 1) * 100 + d.getDate();
      const ymd = d.getFullYear() * 10000 + md;
      if (!r.dates.some(([a, b, withYear]) => (withYear ? ymd >= a && ymd <= b : a <= b ? md >= a && md <= b : md >= a || md <= b))) return false;
    }
    if (!r.days && !r.ph && !r.sh) return true;
    if (r.days && r.days.has(d.getDay())) return true;
    if (r.ph && isHolidayIT(d)) return true;
    return r.sh ? '?' : false;
  }

  /* minuti dalla mezzanotte di d dentro una delle fasce della regola? alba e tramonto sono stimati */
  function timeIn(r, mins, d) {
    if (!r.times) return mins < 1440;
    const mo = d.getMonth();
    const ev = { sunrise: SUNRISE[mo], sunset: SUNSET[mo], dawn: SUNRISE[mo] - 30, dusk: SUNSET[mo] + 30 };
    let res = false;
    for (const [a0, b0] of r.times) {
      const approx = typeof a0 === 'string' || typeof b0 === 'string';
      const a = typeof a0 === 'string' ? ev[a0] : a0;
      let b = typeof b0 === 'string' ? ev[b0] : b0;
      if (b <= a) b += 1440;
      let hit = mins >= a && mins < b;
      if (approx && (Math.abs(mins - a) < 60 || Math.abs(mins - b) < 60)) hit = '?';
      res = or3(res, hit);
    }
    return res;
  }

  /* la fascia oraria è in vigore alla data d? vero / falso / '?' */
  function ohAt(oh, d) {
    const mins = d.getHours() * 60 + d.getMinutes();
    const prev = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12);
    let res = false, unk = false;
    for (const r of oh.rules) {
      const today = dayMatch(r, d);
      // fasce che passano la mezzanotte: "Fr 22:00-06:00" vale anche sabato fino alle 6
      const hit = or3(and3(today, timeIn(r, mins, d)), and3(dayMatch(r, prev), timeIn(r, mins + 1440, prev)));
      if (r.unknown) { if (hit !== false) unk = true; continue; }
      if (r.off) { if (hit === true || (today === true && !r.times)) res = false; else if (hit === '?') unk = true; continue; }
      if (!r.additional && today === true) res = hit === true;
      else if (hit === true) res = true;
      if (hit === '?') unk = true;
    }
    return res === true ? true : unk ? '?' : false;
  }

  /* --- condizioni: "valore @ (condizione)" separati da ";" --- */
  // per un bus turistico: vale / non si sa (dipende da permessi, destinazione, meteo) / non vale
  const GROUP_YES = ['bus', 'coach', 'tourist_bus', 'motor_vehicle', 'vehicle'];
  const GROUP_MAYBE = ['permit', 'permit_holder', 'destination', 'private', 'customers', 'psv', 'hgv', 'goods', 'wet', 'snow', 'flooding', 'winter', 'summer', 'ice', 'fog'];
  const GROUP_NO = ['delivery', 'disabled', 'emergency', 'residents', 'resident', 'taxi', 'agricultural', 'forestry', 'bicycle', 'moped', 'motorcycle', 'motorcar',
    'shuttle_service', 'designated', 'fuel=electric', 'electric', 'hov', 'carpool', 'school', 'military', 'police', 'ambulance', 'fire', 'service', 'official', 'municipality', 'occupants>1'];
  const GROUP_IT = {
    bus: 'autobus', coach: 'bus turistici', tourist_bus: 'bus turistici', motor_vehicle: 'veicoli a motore', vehicle: 'veicoli', permit: 'con permesso', permit_holder: 'con permesso',
    destination: 'diretti lì', private: 'autorizzati', customers: 'clienti', psv: 'mezzi pubblici', hgv: 'mezzi pesanti', goods: 'trasporto merci', wet: 'con fondo bagnato',
    snow: 'con neve', flooding: 'in caso di allagamento', winter: 'in inverno', summer: 'in estate', ice: 'con ghiaccio', fog: 'con nebbia', delivery: 'carico e scarico',
    disabled: 'disabili', emergency: 'soccorso', residents: 'residenti', resident: 'residenti', taxi: 'taxi', agricultural: 'mezzi agricoli', forestry: 'mezzi forestali',
    'fuel=electric': 'veicoli elettrici', electric: 'veicoli elettrici', shuttle_service: 'navette', school: 'scuolabus', military: 'mezzi militari', police: 'polizia',
  };
  function parseGroups(c) {
    const words = c.split(/\s*(?:;|,|\bOR\b)\s*/i).map((w) => w.trim().toLowerCase()).filter(Boolean);
    if (!words.length || !words.every((w) => GROUP_YES.includes(w) || GROUP_MAYBE.includes(w) || GROUP_NO.includes(w))) return null;
    return { type: 'gruppo', groups: words, text: c };
  }
  function groupCond(c) {
    if (c.groups.some((g) => GROUP_YES.includes(g))) return true;
    if (c.groups.some((g) => GROUP_MAYBE.includes(g))) return '?';
    return false;
  }

  const VEH_PROP = { weight: 'peso', maxweight: 'peso', length: 'lunghezza', height: 'altezza', width: 'larghezza', axleload: 'caricoAsse', axles: 'assi' };
  function parseCond(c) {
    c = unwrap(c);
    const m = /^(weight|maxweight|length|height|width|axleload|axles)\s*(<=|>=|<|>|=)\s*([\d.,]+)\s*(t|kg|m)?$/i.exec(c);
    if (m) {
      let n = parseFloat(m[3].replace(',', '.'));
      if ((m[4] || '').toLowerCase() === 'kg') n /= 1000;
      return { type: 'veicolo', prop: VEH_PROP[m[1].toLowerCase()], op: m[2], n, text: c };
    }
    const g = parseGroups(c);
    if (g) return g;
    const oh = parseOH(c);
    return oh ? { type: 'orario', oh, text: c } : { type: 'altro', text: c };
  }

  const condCache = new Map();
  function parseConditional(v) {
    if (v == null || v === '') return null;
    const key = String(v);
    if (condCache.has(key)) return condCache.get(key);
    // coppie valore/condizione; un pezzo senza "@" continua la condizione precedente
    // (orari con ";" scritti senza parentesi: "permit @ Jun 01-Oct 03: Mo 20:00-24:00; Tu-Sa 20:00-24:00")
    const pairs = [];
    let ok = true;
    for (const part of splitTop(key, ';')) {
      let depth = 0, at = -1;
      for (let i = 0; i < part.length; i++) {
        if (part[i] === '(') depth++;
        else if (part[i] === ')') depth--;
        else if (part[i] === '@' && depth === 0) { at = i; break; }
      }
      if (at < 0) {
        if (!pairs.length) { ok = false; break; }
        pairs[pairs.length - 1].cond += '; ' + unwrap(part);
        continue;
      }
      const value = part.slice(0, at).trim();
      const cond = unwrap(part.slice(at + 1));
      if (!value || !cond) { ok = false; break; }
      pairs.push({ value, cond });
    }
    const rules = ok && pairs.length ? pairs.map((p) => ({ value: p.value, conds: p.cond.split(/\s+AND\s+/i).map(parseCond), text: p.cond })) : null;
    if (condCache.size > 2000) condCache.clear();
    condCache.set(key, rules);
    return rules;
  }

  function vehCond(c, veh) {
    const x = veh[c.prop];
    if (typeof x !== 'number') return '?';
    switch (c.op) {
      case '>': return x > c.n;
      case '>=': return x >= c.n;
      case '<': return x < c.n;
      case '<=': return x <= c.n;
      default: return x === c.n;
    }
  }

  /*
   * Tag in vigore: applica le regole condizionali la cui condizione è vera.
   * timeFn(cond, rule) dice se una condizione di orario (o di altro tipo) è vera: true / false / '?'.
   */
  function effectiveTags(tags, veh, timeFn) {
    const eff = Object.assign({}, tags);
    let unknown = false;
    for (const k of COND_KEYS) {
      const raw = tags[k + ':conditional'];
      if (raw == null) continue;
      const rules = parseConditional(raw);
      if (!rules) { unknown = true; continue; }
      let val = null, unk = false;
      for (const r of rules) {
        let st = true;
        for (const c of r.conds) st = and3(st, c.type === 'veicolo' ? vehCond(c, veh) : isFixedCond(c) ? groupCond(c) : timeFn(c, r));
        if (st === true) { val = r.value; unk = false; } else if (st === '?') unk = true;
      }
      if (val != null) eff[k] = val;
      if (unk) unknown = true;
    }
    return { tags: eff, unknown };
  }

  /* condizione che per un bus turistico è sempre vera o sempre falsa (misure del mezzo, categorie certe) */
  function isFixedCond(c) { return c.type === 'veicolo' || (c.type === 'gruppo' && groupCond(c) !== '?'); }

  /* chiavi condizionali che dipendono da orari o da condizioni non certe (permessi, meteo) */
  function timedKeys(tags) {
    const out = [];
    for (const k of COND_KEYS) {
      const rules = tags[k + ':conditional'] != null ? parseConditional(tags[k + ':conditional']) : undefined;
      if (rules === undefined) continue;
      if (!rules || rules.some((r) => r.conds.some((c) => !isFixedCond(c)))) out.push(k);
    }
    return out;
  }

  function hasConditional(tags) {
    for (const k of COND_KEYS) if (tags[k + ':conditional'] != null) return true;
    return false;
  }

  /* testo della condizione in italiano */
  const IT_DAYS = { Mo: 'lun', Tu: 'mar', We: 'mer', Th: 'gio', Fr: 'ven', Sa: 'sab', Su: 'dom', PH: 'festivi', SH: 'vacanze scolastiche' };
  const IT_MONTHS = { Jan: 'gen', Feb: 'feb', Mar: 'mar', Apr: 'apr', May: 'mag', Jun: 'giu', Jul: 'lug', Aug: 'ago', Sep: 'set', Oct: 'ott', Nov: 'nov', Dec: 'dic' };
  const PROP_IT = { weight: 'massa', maxweight: 'massa', length: 'lunghezza', height: 'altezza', width: 'larghezza', axleload: 'carico per asse', axles: 'assi' };
  function condText(c) {
    return String(c).replace(/[()]/g, '')
      .replace(/\b(weight|maxweight|length|height|width|axleload|axles)\s*(<=|>=|<|>|=)\s*([\d.,]+)\s*(t|kg|m)?/gi, (m0, p, op, n, u) => {
        const P = p.toLowerCase();
        const unit = P === 'axles' ? '' : /weight|axleload/.test(P) ? (u && u.toLowerCase() === 'kg' ? ' kg' : ' t') : ' m';
        return `${PROP_IT[P]} ${op[0] === '>' ? 'oltre' : op[0] === '<' ? 'fino a' : ''} ${fmtNum(parseFloat(n.replace(',', '.')))}${unit}`.replace(/\s+/g, ' ');
      })
      .replace(/\bAND\b/gi, 'e')
      .replace(/\bPH\s+(off|closed)\b/g, 'esclusi i festivi')
      .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)\b/g, (x) => IT_DAYS[x])
      .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, (x) => IT_MONTHS[x])
      .replace(/\bsunrise\b|\bdawn\b/g, 'alba').replace(/\bsunset\b|\bdusk\b/g, 'tramonto')
      .replace(/\b(off|closed)\b/g, 'escluso').replace(/\bwet\b/g, 'con fondo bagnato').replace(/\bsnow\b/g, 'con neve')
      .replace(/24\/7/g, 'sempre')
      .replace(/([\da-z])-(?=[\da-z])/g, '$1–')
      .replace(/\s*;\s*/g, '; ').replace(/,(?=[^\s\d])/g, ', ')
      .trim();
  }
  function condPart(c) {
    if (c.type === 'gruppo') return (c.groups.every((g) => /^(permit|permit_holder|destination|wet|snow|flooding|winter|summer|ice|fog)$/.test(g)) ? '' : 'per ') + c.groups.map((g) => GROUP_IT[g] || g).join(', ');
    return condText(c.text);
  }
  function valueText(k, v) {
    if (LIMIT_KIND[k]) {
      const n = /weight|axle/.test(k) ? parseWeight(v) : parseLength(v);
      return typeof n === 'number' ? `max ${fmtNum(n)} ${/weight|axle/.test(k) ? 't' : 'm'}` : String(v);
    }
    if (v === 'no') return 'vietato';
    if (YES.test(v)) return 'consentito';
    return RESERVED[v] || String(v);
  }
  /* "autobus: vietato lun–ven 07:00–19:00 · massa: max 3,5 t 07:00–20:00" */
  function conditionalWhen(tags, keys) {
    const parts = [];
    for (const k of keys) {
      const raw = tags[k + ':conditional'];
      const rules = parseConditional(raw);
      if (!rules) { parts.push(`${SUBJECT_IT[k]}: ${raw}`); continue; }
      parts.push(`${SUBJECT_IT[k]}: ` + rules.map((r) => `${valueText(k, r.value)} ${r.conds.map(condPart).join(' e ')}`).join('; '));
    }
    return parts.join(' · ');
  }

  const COND_EXTRA = ['psv', 'maxheight:physical', 'maxwidth:physical'];
  function condTagsOf(tags) {
    const o = {};
    for (const k of COND_KEYS) {
      if (tags[k] != null) o[k] = tags[k];
      if (tags[k + ':conditional'] != null) o[k + ':conditional'] = tags[k + ':conditional'];
    }
    for (const k of COND_EXTRA) if (tags[k] != null) o[k] = tags[k];
    return o;
  }

  /*
   * Problemi di un elemento con tag condizionali.
   * fixed: problemi sempre validi (limiti fissi e condizioni sul solo mezzo);
   * timed: divieto o limite che vale solo in certi giorni/orari o condizioni, se può riguardare il mezzo.
   */
  function conditionalIssues(tags, veh) {
    const keys = timedKeys(tags);
    const cats = new Set(keys.map(keyCat));
    const fixedEff = effectiveTags(tags, veh, () => false);
    const fixed = evaluateTags(fixedEff.tags, veh).filter((i) => !cats.has(issueCat(i.kind)));
    // divieti che dipendono solo dal mezzo (es. "no @ (length>12)"): si aggiunge la condizione al dettaglio
    const vehKeys = COND_KEYS.filter((k) => tags[k + ':conditional'] != null && !keys.includes(k));
    for (const i of fixed) {
      const own = vehKeys.filter((k) => keyCat(k) === issueCat(i.kind));
      if (own.length) i.detail += ' · ' + conditionalWhen(tags, own);
    }
    if (!keys.length) return { fixed, timed: null };
    // scenari: nessuna regola a orario attiva, poi ciascuna da sola
    const scen = [() => false];
    for (const k of keys) for (const r of parseConditional(tags[k + ':conditional']) || []) scen.push((c, rule) => rule === r);
    let worst = null;
    for (const fn of scen) {
      const eff = effectiveTags(tags, veh, fn);
      for (const i of evaluateTags(eff.tags, veh, { reserved: true })) {
        if (!cats.has(issueCat(i.kind))) continue;
        if (!worst || (i.severity === 'red' && worst.severity !== 'red')) worst = i;
      }
    }
    const unparsable = keys.some((k) => !parseConditional(tags[k + ':conditional']));
    if (!worst && !unparsable) return { fixed, timed: null };
    // anche una condizione non leggibile, se contiene ore o giorni, è "a orario"
    const timeLike = (c) => c.type === 'orario' || (c.type === 'altro' && /\d:\d|\b(Mo|Tu|We|Th|Fr|Sa|Su|PH|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(c.text));
    const hasTime = keys.some((k) => { const rr = parseConditional(tags[k + ':conditional']); return rr ? rr.some((r) => r.conds.some(timeLike)) : /\d:\d/.test(tags[k + ':conditional']); });
    let base = worst, title;
    if (worst) title = worst.title + (hasTime ? ' in certi orari' : ' con condizioni');
    else {
      // condizione scritta in un formato che l'app non sa leggere: si mostra com'è
      const lim = keys.map((k) => LIMIT_KIND[k]).find(Boolean);
      base = { kind: lim || 'bus', value: null };
      title = lim ? 'Limite con condizioni da leggere' : 'Divieto con condizioni da leggere';
    }
    return {
      fixed,
      timed: {
        kind: 'orario', sign: base.kind, value: base.value, severity: 'amber', title,
        when: conditionalWhen(tags, keys),
        detail: 'Vale: ' + conditionalWhen(tags, keys),
        cats: Array.from(cats), cond: condTagsOf(tags),
      },
    };
  }

  /*
   * Il divieto a orario è in vigore quando passa il mezzo (ms)?
   * state: 'attivo' | 'ridosso' (entro un'ora) | 'incerto' | 'non attivo'
   */
  function conditionalAt(hz, veh, ms) {
    if (ms == null || !hz.cond) return { state: 'incerto', severity: 'amber' };
    const cats = new Set(hz.cats);
    const at = (t) => {
      const d = new Date(t);
      const e = effectiveTags(hz.cond, veh, (c) => (c.type === 'orario' ? ohAt(c.oh, d) : '?'));
      return { iss: evaluateTags(e.tags, veh, { reserved: true }).filter((i) => cats.has(issueCat(i.kind))), unknown: e.unknown };
    };
    const now = at(ms);
    if (now.iss.length) {
      const red = now.iss.find((i) => i.severity === 'red');
      return { state: 'attivo', severity: red ? 'red' : 'amber', issue: red || now.iss[0] };
    }
    if (now.unknown) return { state: 'incerto', severity: 'amber' };
    for (let k = 1; k <= 6; k++) {
      for (const s of [1, -1]) {
        const x = at(ms + s * k * 10 * 60e3);
        if (x.iss.length) return { state: 'ridosso', severity: 'amber', minutes: k * 10, after: s > 0, issue: x.iss[0] };
      }
    }
    return { state: 'non attivo', severity: 'info' };
  }

  /* ------------------------------------------------------------------ */
  /* Affidabilità del dato OSM                                           */
  /* ------------------------------------------------------------------ */
  const META_KEY = { altezza: 'maxheight', larghezza: 'maxwidth', lunghezza: 'maxlength', peso: 'maxweight', asse: 'maxaxleload', bus: 'bus', pesanti: 'hgv' };

  /* data dell'ultima modifica, versione, fonte dichiarata e data di verifica di un elemento OSM */
  function osmMeta(el, kind) {
    const t = el.tags || {};
    const key = META_KEY[kind] || '';
    const date = t._d || (el.timestamp ? String(el.timestamp).slice(0, 10) : null);
    return {
      date,
      version: Number(t._v || el.version) || null,
      source: t['source:' + key] || t.source || null,
      checked: t['check_date:' + key] || t.check_date || t['survey:date'] || null,
      highway: t.highway || null,
    };
  }

  const SOURCE_IT = {
    sign: 'cartello stradale', survey: 'rilievo sul posto', local_knowledge: 'conoscenza locale', 'local knowledge': 'conoscenza locale',
    estimate: 'stima', estimated: 'stima', bing: 'foto aeree', esri: 'foto aeree', 'aerial imagery': 'foto aeree', mapillary: 'foto Mapillary',
    gps: 'traccia GPS', 'gps survey': 'rilievo GPS', streetlevel: 'foto stradali', 'street-level imagery': 'foto stradali',
  };
  function sourceLabel(src) {
    if (!src) return null;
    return String(src).split(';').map((x) => x.trim()).filter(Boolean)
      .map((x) => SOURCE_IT[x.toLowerCase()] || (/^(bing|esri|mapbox)/i.test(x) ? 'foto aeree' : /mapillary/i.test(x) ? 'foto Mapillary' : x)).join(', ');
  }

  /* motivi per dubitare del dato: valore insolito per il tipo di strada, dato molto vecchio */
  function hazardDoubts(hz, nowMs) {
    const out = [];
    const m = hz.meta || {};
    const main = /^(motorway|trunk|primary|secondary)(_link)?$/.test(m.highway || '');
    const v = hz.value;
    if (main && typeof v === 'number') {
      if (hz.kind === 'altezza' && v < 2.5) out.push('Altezza molto bassa per una strada principale: potrebbe essere un errore di mappatura.');
      if (hz.kind === 'larghezza' && v < 2.1) out.push('Larghezza molto ridotta per una strada principale: potrebbe essere un errore di mappatura.');
      if (hz.kind === 'peso' && v < 3.5) out.push('Limite di peso molto basso per una strada principale: potrebbe essere un errore di mappatura.');
    }
    const ref = Date.parse(m.checked || m.date || '');
    if (isFinite(ref)) {
      const years = Math.floor(((nowMs || Date.now()) - ref) / (365.25 * 864e5));
      if (years >= 8) out.push(`Dato non aggiornato da ${years} anni.`);
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Confronto con un secondo servizio (TomTom)                          */
  /* ------------------------------------------------------------------ */
  /*
   * Il secondo servizio calcola lo stesso viaggio due volte: con le dimensioni del mezzo (bus)
   * e come auto (car). Dove il nostro percorso coincide con quello in auto ma il mezzo viene
   * fatto passare altrove, il secondo servizio conosce probabilmente un limite.
   */
  function compareRoutes(route, busCoords, carCoords) {
    const idx = route.index;
    const busIdx = new RouteIndex(busCoords), carIdx = new RouteIndex(carCoords);
    const STEP = 50, NEAR = 40;
    const samples = [];
    for (let s = 0; s <= idx.total; s += STEP) {
      const p = idx.pointAt(s);
      samples.push({ along: s, bus: !!busIdx.nearest(p[0], p[1], NEAR), car: !!carIdx.nearest(p[0], p[1], NEAR) });
    }
    const runs = [];
    let cur = null;
    for (const sm of samples) {
      if (!(sm.car && !sm.bus)) continue;
      if (cur && sm.along - cur.alongEnd <= 150) cur.alongEnd = sm.along;
      else { cur = { alongStart: sm.along, alongEnd: sm.along }; runs.push(cur); }
    }
    const avoided = runs.filter((r) => r.alongEnd - r.alongStart >= 200);
    const shared = samples.length ? samples.filter((x) => x.bus).length / samples.length : 0;
    function verdict(a0, a1) {
      if (avoided.some((r) => r.alongStart <= a1 + 100 && r.alongEnd >= a0 - 100)) return 'evita';
      const win = samples.filter((x) => x.along >= a0 - 100 && x.along <= a1 + 100);
      if (win.length && win.every((x) => x.bus)) return 'passa';
      return 'altrove';
    }
    return { avoided, shared, verdict };
  }

  /* Cosa fare davanti a un punto critico, in parole semplici */
  function hazardAdvice(hz) {
    if (hz.crossing) return 'Il limite è scritto sul ponte che passa sopra il percorso: di solito riguarda chi passa sotto, non chi passa sopra. Guarda il cartello con Street View prima di partire.';
    const evita = 'Per evitarlo, tocca la mappa prima di questo punto e aggiungi una tappa su un\'altra strada: il percorso verrà ricalcolato.';
    switch (hz.kind) {
      case 'altezza':
        if (hz.severity === 'red') return 'Il mezzo non passa sotto questo punto. ' + evita + ' Se pensi che il dato della mappa sia sbagliato, verifica con Street View.';
        if (hz.value == null) return 'È segnalato un passaggio basso, ma senza la misura: controlla l\'altezza sul cartello con Street View.';
        return 'Il mezzo passa, ma con poco margine. Tieni conto di carico sul tetto, neve e dossi; nel dubbio scegli un\'altra strada. ' + evita;
      case 'larghezza':
        if (hz.severity === 'red') return 'Il mezzo è più largo del passaggio. ' + evita;
        return 'Il passaggio è stretto per il mezzo, soprattutto con traffico nell\'altro senso. Controlla con Street View e valuta un\'altra strada.';
      case 'lunghezza':
      case 'peso':
      case 'asse':
        return 'Il cartello vieta il transito al tuo mezzo. ' + evita + ' Se pensi che il dato sia sbagliato, verifica con Street View.';
      case 'bus':
        return 'Divieto di transito per gli autobus. ' + evita;
      case 'tomtom':
        return 'TomTom, che raccoglie i limiti con veicoli propri, evita questo tratto con le dimensioni del tuo mezzo ma lo percorre con un\'auto: potrebbe esserci un limite che OpenStreetMap non riporta (ponte basso, strettoia, divieto), ma la scelta di TomTom può dipendere anche da altro. Controlla con Street View; se il limite c\'è, ' + evita.charAt(0).toLowerCase() + evita.slice(1);
      case 'pesanti':
        return 'Su OpenStreetMap questo divieto si usa di solito per il cartello con il camion, che vale per i veicoli che trasportano merci e non per gli autobus. Se sul cartello c\'è solo il camion, il bus può passare; se c\'è un limite di peso o il simbolo dell\'autobus, no. Controlla il cartello con Street View.';
      case 'orario': {
        const st = hz.stato && hz.stato.state;
        const evitaMin = evita.charAt(0).toLowerCase() + evita.slice(1);
        const pes = hz.sign === 'pesanti' ? ' Il divieto è per i mezzi pesanti: se sul cartello c\'è solo il camion, di solito non vale per gli autobus.' : '';
        if (st === 'attivo') return 'Quando passi il divieto è in vigore. Cambia l\'orario di partenza oppure, ' + evitaMin + pes;
        if (st === 'ridosso') return 'Passi a ridosso dell\'orario del divieto e i tempi sono stimati (traffico, soste). Anticipa o posticipa la partenza oppure, ' + evitaMin + pes;
        if (st === 'non attivo') return 'Quando passi il divieto non è in vigore. Se cambi giorno o orario di partenza l\'app ricontrolla; sul posto segui comunque il cartello.';
        return 'Non è possibile stabilire se il divieto vale al tuo passaggio: la condizione è scritta in un formato non standard o dipende dal meteo. Leggila e controlla il cartello con Street View.' + pes;
      }
      default:
        return 'Controlla il punto con Street View prima di partire.';
    }
  }

  function hasRestrictionTags(tags) {
    if (!tags) return false;
    return ['maxheight', 'maxheight:physical', 'maxwidth', 'maxwidth:physical', 'maxlength', 'maxweight', 'maxweightrating', 'maxaxleload']
      .some((k) => tags[k] != null) || ['hgv', 'bus', 'tourist_bus', 'coach'].some((k) => tags[k] === 'no') || hasConditional(tags);
  }

  /* Una via OSM corre lungo il percorso, lo attraversa o nessuna delle due? */
  /* distanza in metri di un punto da un segmento */
  function pointSegDist(p, a, b) {
    const { kx, ky } = metersPerDeg(p[0]);
    const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? -(ax * dx + ay * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(ax + t * dx, ay + t * dy);
  }

  /*
   * Una via OSM fa parte del percorso solo se ne condivide almeno un tratto intero: due punti
   * consecutivi della via sul percorso, con il tratto in mezzo allineato. Il percorso passa
   * infatti per i nodi delle strade che usa. Una strada che passa sotto un viadotto o corre
   * accanto, anche quasi parallela, non condivide tratti e viene esclusa.
   * Alla partenza e all'arrivo il percorso può cominciare a metà di un tratto: basta un punto.
   * "crosses" indica una via che passa vicino senza condividere tratti (per i ponti sopra il percorso).
   */
  function wayRelation(geom, idx, tol) {
    tol = tol || 3.5;
    const pts = geom.map((g) => [g.lat, g.lon]);
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) total += haversine(pts[i], pts[i + 1]);
    const onR = pts.map((p) => idx.nearest(p[0], p[1], tol));
    const ends = idx.coords.length ? [[idx.coords[0], 0], [idx.coords[idx.coords.length - 1], idx.total]] : [];
    let shared = 0, minA = Infinity, maxA = -Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = haversine(a, b);
      if (len < 0.5) continue;
      const wb = bearing(a, b);
      const ra = onR[i], rb = onR[i + 1];
      let range = null;
      if (ra && rb) {
        const rm = idx.nearest((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, tol);
        if (rm && axisDiff(wb, rm.bearing) < 20 * RAD) range = [Math.min(ra.along, rb.along), Math.max(ra.along, rb.along)];
      } else if (ra || rb) {
        const r = ra || rb;
        for (const [P, alongP] of ends) {
          if (pointSegDist(P, a, b) > tol) continue;
          const rp = idx.nearest(P[0], P[1], tol);
          if (rp && axisDiff(wb, rp.bearing) < 20 * RAD) range = [Math.min(r.along, alongP), Math.max(r.along, alongP)];
        }
      }
      if (!range) continue;
      shared += len;
      minA = Math.min(minA, range[0]);
      maxA = Math.max(maxA, range[1]);
    }
    let near = false;
    if (!shared) {
      const step = Math.min(50, Math.max(4, total / 150));
      for (let i = 0; i < pts.length - 1 && !near; i++) {
        const a = pts[i], b = pts[i + 1];
        const n = Math.max(1, Math.ceil(haversine(a, b) / step));
        for (let k = 0; k <= n && !near; k++) {
          const t = k / n;
          if (idx.nearest(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 6)) near = true;
        }
      }
    }
    return {
      onRoute: shared > 0, crosses: near && !shared, alongStart: minA, alongEnd: maxA,
      point: shared > 0 ? idx.pointAt(minA) : null, length: total, shared,
    };
  }

  /*
   * Regola larga (quella usata prima): la via corre entro 6 m dal percorso con direzione simile
   * per almeno 20 m. Serve a segnalare i limiti "vicino al percorso", da far controllare all'operatore.
   */
  function wayNear(geom, idx) {
    const tol = 6;
    const pts = geom.map((g) => [g.lat, g.lon]);
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) total += haversine(pts[i], pts[i + 1]);
    const step = Math.min(50, Math.max(4, total / 150));
    let alignedLen = 0, minA = Infinity, maxA = -Infinity, firstPt = null, minDist = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = haversine(a, b);
      if (len <= 0) continue;
      const wb = bearing(a, b);
      const n = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const r = idx.nearest(p[0], p[1], tol);
        if (!r) continue;
        if (r.dist < minDist) minDist = r.dist;
        if (axisDiff(wb, r.bearing) < 25 * RAD) {
          alignedLen += len / n;
          if (r.along < minA) { minA = r.along; firstPt = p; }
          if (r.along > maxA) maxA = r.along;
        }
      }
    }
    const onRoute = alignedLen > 0 && alignedLen >= Math.min(20, total * 0.5);
    return { onRoute, alongStart: minA, alongEnd: maxA, point: firstPt, minDist };
  }

  /* ordine dei punti: prima quelli sul percorso, poi i non transitabili, poi per posizione */
  /* prima i punti sul percorso, poi quelli vicini, in fondo i divieti a orario non in vigore al passaggio */
  const SEV_RANK = { red: 0, amber: 1, info: 2 };
  const groupOf = (h) => (h.rel === 'escluso' ? 3 : h.severity === 'info' ? 2 : h.rel === 'vicino' ? 1 : 0);
  function hazardOrder(a, b) {
    const ga = groupOf(a), gb = groupOf(b);
    if (ga !== gb) return ga - gb;
    if (a.severity !== b.severity) return (SEV_RANK[a.severity] || 0) - (SEV_RANK[b.severity] || 0);
    return a.alongStart - b.alongStart;
  }

  /* la strada del limite ha lo stesso nome o la stessa sigla di quella percorsa? */
  function compactRef(x) { return String(x || '').toUpperCase().replace(/[\s.\-]/g, ''); }
  function sameRoad(tags, streets) {
    if (!streets) return false;
    const mine = [tags.name, tags.ref].filter(Boolean).flatMap((x) => String(x).split(';'));
    if (!mine.length) return false;
    const theirs = String(streets).split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    return mine.some((m) => theirs.some((t) => (normName(m) && normName(m) === normName(t)) || (compactRef(m).length >= 2 && compactRef(m) === compactRef(t))));
  }

  /*
   * Analizza gli elementi Overpass rispetto al percorso.
   * Restituisce i punti critici raggruppati, le aree di servizio raggiungibili
   * e quanti tratti con limiti sono stati controllati.
   */
  /*
   * opts.streetAt(along): nome della strada percorsa in un punto, per riconoscere i limiti
   * "vicino al percorso" che sono in realtà sulla stessa strada (stesso nome o sigla).
   * Ogni punto critico ha rel = 'certo' (sulla strada percorsa) o 'vicino' (da controllare).
   */
  function analyzeElements(elements, idx, veh, opts) {
    opts = opts || {};
    const raw = [];
    const services = [];
    let checked = 0;
    for (const el of elements || []) {
      const tags = el.tags || {};
      if (tags.highway === 'services' || tags.highway === 'rest_area') {
        const c = el.center || (el.lat != null ? { lat: el.lat, lon: el.lon } : null);
        if (!c) continue;
        const r = idx.nearest(c.lat, c.lon, 450);
        if (!r) continue;
        if (r.side === 'left' && r.dist > 35) continue; // carreggiata opposta
        services.push({
          id: el.type + '/' + el.id,
          kind: tags.highway,
          name: tags.name || (tags.highway === 'services' ? 'Area di servizio' : 'Area di sosta'),
          lat: c.lat, lon: c.lon, along: r.along,
        });
        continue;
      }
      if (!hasRestrictionTags(tags)) continue;
      let rel;
      if (el.type === 'node') {
        // sul percorso se il nodo è un punto della strada percorsa; entro 6 m è solo "vicino"
        const v = idx.nearestVertex(el.lat, el.lon, 2.5);
        if (v) rel = { onRoute: true, alongStart: v.along, alongEnd: v.along, point: [el.lat, el.lon], minDist: v.dist };
        else {
          const r = idx.nearest(el.lat, el.lon, 6);
          if (!r) continue;
          rel = { onRoute: true, vicino: true, alongStart: r.along, alongEnd: r.along, point: [el.lat, el.lon], minDist: r.dist };
        }
      } else if (el.geometry && el.geometry.length > 1) {
        let a0 = Infinity, o0 = Infinity, a1 = -Infinity, o1 = -Infinity;
        for (const g of el.geometry) { if (g.lat < a0) a0 = g.lat; if (g.lat > a1) a1 = g.lat; if (g.lon < o0) o0 = g.lon; if (g.lon > o1) o1 = g.lon; }
        if (!idx.nearBox(a0, o0, a1, o1, 40)) continue;
        rel = wayRelation(el.geometry, idx);
        if (rel.onRoute) rel.minDist = 0;
        else {
          const loose = wayNear(el.geometry, idx);
          if (loose.onRoute) rel = Object.assign({}, loose, { vicino: true, crosses: rel.crosses });
        }
      } else continue;

      // strade percorse riconosciute per identificativo (Valhalla): dicono con certezza se il limite è sulla
      // strada percorsa, su un'altra che le si sovrappone sulla mappa, o sotto/sopra un ponte o una galleria
      let reason = null, excluded = null;
      const rw = opts.routeWays;
      const mid = (rel.alongStart + rel.alongEnd) / 2;
      const covered = !!(rw && rw.size && rel.onRoute && rw.covers(mid));
      if (covered) {
        const level = rw.levelAt(rel.alongStart, rel.alongEnd); // il percorso qui è su un ponte o in galleria
        const elLevel = (tags.bridge && tags.bridge !== 'no') || (tags.tunnel && tags.tunnel !== 'no');
        if (el.type === 'way') {
          if (rw.has(el.id)) { rel.vicino = false; reason = 'id'; }
          else if (level && !elLevel) excluded = 'livello';
          else { rel.vicino = true; reason = 'altra-strada'; }
        } else if (level && !elLevel && (tags.maxheight != null || tags['maxheight:physical'] != null || tags.maxwidth != null || tags['maxwidth:physical'] != null)) {
          rel.vicino = true; reason = 'ponte';
        }
      }

      // "vicino" ma con lo stesso nome o sigla della strada percorsa: è sul percorso
      let promoted = null;
      if (!covered && rel.onRoute && rel.vicino && opts.streetAt && sameRoad(tags, opts.streetAt(mid))) {
        rel.vicino = false;
        promoted = 'nome';
      }
      // senza strade riconosciute: una stradina di servizio senza nome che sulla mappa coincide con una strada
      // con un nome (es. il corsello di un parcheggio sotto un viadotto) è solo "forse" sul percorso
      if (!covered && rel.onRoute && !rel.vicino && el.type === 'way' && /^(service|track)$/.test(tags.highway || '') && !tags.name && !tags.ref && opts.streetAt && opts.streetAt(mid)) {
        rel.vicino = true;
        reason = 'servizio';
      }

      let issues;
      if (hasConditional(tags)) {
        const ci = conditionalIssues(tags, veh);
        issues = ci.timed ? ci.fixed.concat([ci.timed]) : ci.fixed;
      } else issues = evaluateTags(tags, veh);
      if (rel.onRoute) {
        if (!rel.vicino && !excluded) checked++;
        for (const is of issues) raw.push(Object.assign({}, is, {
          rel: excluded ? 'escluso' : rel.vicino ? 'vicino' : 'certo', distM: rel.minDist, promoted, reason, excluded,
          road: { bridge: tags.bridge || null, tunnel: tags.tunnel || null, layer: tags.layer || null },
          ids: [el.type + '/' + el.id], name: tags.name || tags.ref || '', meta: osmMeta(el, is.kind),
          alongStart: rel.alongStart, alongEnd: rel.alongEnd,
          lat: rel.point ? rel.point[0] : idx.pointAt(rel.alongStart)[0],
          lon: rel.point ? rel.point[1] : idx.pointAt(rel.alongStart)[1],
        }));
      } else if (rel.crosses && tags.bridge && tags.bridge !== 'no') {
        // limite d'altezza scritto sul ponte che passa sopra: spesso è un errore di mappatura, ma va guardato
        for (const is of issues) {
          if (is.kind !== 'altezza') continue;
          raw.push(Object.assign({}, is, {
            rel: 'vicino', road: { bridge: tags.bridge || null, tunnel: tags.tunnel || null, layer: tags.layer || null },
            severity: 'amber', detail: 'Limite indicato sul ponte che attraversa il percorso: verifica',
            ids: [el.type + '/' + el.id], name: tags.name || tags.ref || '', meta: osmMeta(el, is.kind),
            alongStart: rel.alongStart, alongEnd: rel.alongEnd, lat: null, lon: null, crossing: true,
          }));
        }
      }
    }
    // posizione dei ponti: punto del percorso più vicino al ponte
    for (const h of raw) {
      if (h.lat == null) {
        const el = (elements || []).find((e) => (e.type + '/' + e.id) === h.ids[0]);
        let best = null;
        for (const g of el.geometry) {
          const r = idx.nearest(g.lat, g.lon, 30);
          if (r && (!best || r.dist < best.dist)) best = r;
        }
        const p = best ? idx.pointAt(best.along) : [el.geometry[0].lat, el.geometry[0].lon];
        h.alongStart = h.alongEnd = best ? best.along : 0;
        h.lat = p[0]; h.lon = p[1];
      }
    }
    // raggruppa tratti consecutivi con lo stesso limite
    raw.sort((a, b) => a.alongStart - b.alongStart);
    const hazards = [];
    for (const h of raw) {
      const key = h.kind + '|' + h.severity + '|' + h.title + '|' + h.rel + '|' + (h.when || '');
      const prev = hazards.slice().reverse().find((x) => x._key === key);
      if (prev && h.alongStart - prev.alongEnd < 250) {
        prev.alongEnd = Math.max(prev.alongEnd, h.alongEnd);
        if (h.distM != null && (prev.distM == null || h.distM < prev.distM)) prev.distM = h.distM;
        prev.ids.push(...h.ids.filter((i) => !prev.ids.includes(i)));
        if (!prev.name && h.name) prev.name = h.name;
        continue;
      }
      hazards.push(Object.assign({ _key: key }, h));
    }
    hazards.forEach((h) => delete h._key);
    hazards.sort(hazardOrder);

    // aree di servizio: una sola per nome/posizione
    services.sort((a, b) => a.along - b.along);
    const svc = [];
    for (const s of services) {
      const dup = svc.find((x) => Math.abs(x.along - s.along) < 400 && (x.name === s.name || x.kind === s.kind));
      if (dup) { if (dup.kind === 'rest_area' && s.kind === 'services') Object.assign(dup, s); continue; }
      svc.push(s);
    }
    return { hazards, services: svc, checked };
  }

  /* ------------------------------------------------------------------ */
  /* Piano di viaggio con pause di guida (Reg. CE 561/2006)              */
  /* ------------------------------------------------------------------ */
  const H = 3600;
  const RULES = {
    blocco: 4.5 * H,        // guida continuativa massima
    pausa: 45,              // minuti
    fraz1: 15, fraz2: 30,   // pausa frazionata, in quest'ordine
    giornaliera: 9 * H,     // estendibile a 10 h due volte a settimana
    giornalieraMax: 10 * H,
    ampiezza: 13 * H,       // con riposo giornaliero di 11 h restano 13 h di impegno
  };

  /*
   * opts: {
   *   stopsT: tempi di guida (s) all'arrivo in ogni tappa (0 per la partenza),
   *   dwell: minuti di sosta per tappa,
   *   departureMs, mode: 'legge' | 'frazionata' | 'doppio',
   *   services: [{T, name, ...}] ordinati per T,
   * }
   */
  function planTrip(opts) {
    const stopsT = opts.stopsT;
    const dwell = opts.dwell || [];
    const mode = opts.mode || 'legge';
    const svc = (opts.services || []).slice().sort((a, b) => a.T - b.T);
    const events = [];
    const warnings = [];
    let pos = 0, clock = opts.departureMs, since = 0, splitTaken = false, drive = 0;
    events.push({ type: 'partenza', T: 0, arrive: clock, depart: clock, stop: 0 });

    const rest = (min) => {
      if (min >= RULES.pausa || (splitTaken && min >= RULES.fraz2)) { since = 0; splitTaken = false; return 'piena'; }
      if (min >= RULES.fraz1 && !splitTaken) { splitTaken = true; return 'prima'; }
      return null;
    };
    const pick = (lo, hi, target) => {
      let best = null;
      for (const s of svc) {
        if (s.T <= lo || s.T > hi) continue;
        if (!best || Math.abs(s.T - target) < Math.abs(best.T - target)) best = s;
      }
      return best;
    };

    let next = 1, guard = 0;
    while (next < stopsT.length && guard++ < 1000) {
      const stopT = stopsT[next];
      let brk = null;
      if (mode !== 'doppio') {
        const deadline = pos + (RULES.blocco - since);
        if (mode === 'frazionata' && !splitTaken && since <= 2.25 * H) {
          // prima parte (15') verso le 2 h 15 di guida, utile anche ai passeggeri;
          // si salta se la prossima tappa arriva entro 45' da quel momento
          const target = pos + (2.25 * H - since);
          if (stopT > target + 45 * 60) {
            const lo = pos + Math.max(5 * 60, 1.75 * H - since), hi = pos + (2.75 * H - since);
            const s = pick(lo, hi, target);
            brk = s ? { T: s.T, min: RULES.fraz1, place: s } : { T: Math.max(pos + 60, target), min: RULES.fraz1, place: null };
          }
        } else if (stopT > deadline) {
          // pausa obbligatoria solo se la tappa non si raggiunge entro 4 h 30 di guida
          const min = splitTaken ? RULES.fraz2 : RULES.pausa;
          const s = pick(pos + 20 * 60, deadline, deadline);
          brk = s ? { T: s.T, min, place: s } : { T: Math.max(pos + 60, deadline - 5 * 60), min, place: null };
        }
      }
      if (!brk || stopT <= brk.T) {
        const d = stopT - pos;
        since += d; drive += d; clock += d * 1000; pos = stopT;
        if (next === stopsT.length - 1) {
          events.push({ type: 'arrivo', T: pos, arrive: clock, depart: clock, stop: next });
        } else {
          const w = Math.max(0, Number(dwell[next]) || 0);
          const r = rest(w);
          events.push({ type: 'tappa', T: pos, arrive: clock, depart: clock + w * 60000, dwell: w, stop: next, rest: r });
          clock += w * 60000;
        }
        next++;
      } else {
        const d = brk.T - pos;
        since += d; drive += d; clock += d * 1000; pos = brk.T;
        const r = rest(brk.min);
        events.push({ type: 'pausa', T: pos, arrive: clock, depart: clock + brk.min * 60000, minutes: brk.min, place: brk.place, rest: r });
        clock += brk.min * 60000;
      }
    }

    const span = (clock - opts.departureMs) / 1000; // secondi
    if (mode === 'doppio') {
      if (drive > 2 * RULES.giornalieraMax) warnings.push({ level: 'red', text: `Guida totale di ${fmtDur(drive)}: oltre il limite anche con due autisti. Serve un pernottamento.` });
      else if (drive > 2 * RULES.giornaliera) warnings.push({ level: 'amber', text: `Guida totale di ${fmtDur(drive)}: ogni autista supera le 9 h (ammesse 10 h solo due volte a settimana).` });
    } else {
      if (drive > RULES.giornalieraMax) warnings.push({ level: 'red', text: `Guida totale di ${fmtDur(drive)}: oltre le 10 h giornaliere. Serve un secondo autista o un pernottamento.` });
      else if (drive > RULES.giornaliera) warnings.push({ level: 'amber', text: `Guida totale di ${fmtDur(drive)}: oltre le 9 h. Ammesso fino a 10 h solo due volte a settimana.` });
      if (span > RULES.ampiezza) warnings.push({ level: 'amber', text: `Il viaggio occupa ${fmtDur(span)}: con un solo autista verifica il riposo giornaliero di 11 h.` });
    }
    return { events, warnings, driveS: drive, endMs: clock };
  }

  /* ------------------------------------------------------------------ */
  /* Formattazione                                                       */
  /* ------------------------------------------------------------------ */
  function fmtDur(s) {
    s = Math.max(0, Math.round(s / 60)) * 60;
    const h = Math.floor(s / H), m = Math.round((s - h * H) / 60);
    if (!h) return `${m} min`;
    return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
  }

  function fmtDist(m) {
    if (m == null || !isFinite(m)) return '—';
    if (m < 950) return `${Math.round(m / 10) * 10} m`;
    if (m < 9950) return `${fmtNum(Math.round(m / 100) / 10, 1)} km`;
    return `${Math.round(m / 1000).toLocaleString('it-IT')} km`;
  }

  function fmtClock(ms, refMs) {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
    let suffix = '';
    if (refMs != null) {
      const r = new Date(refMs);
      const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(r.getFullYear(), r.getMonth(), r.getDate())) / 86400000);
      if (days > 0) suffix = ` (+${days} g)`;
    }
    return `${hh}:${mm}${suffix}`;
  }

  function stopLetter(i) {
    let s = '';
    i += 1;
    while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }

  /* "45.46, 9.19" o "45.46 9.19" -> [lat, lon] */
  function parseCoords(text) {
    const m = String(text || '').trim().match(/^(-?\d{1,2}(?:[.]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.]\d+)?)$/);
    if (!m) return null;
    const lat = Number(m[1]), lon = Number(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return [lat, lon];
  }

  /* ------------------------------------------------------------------ */
  /* Esportazione e condivisione                                         */
  /* ------------------------------------------------------------------ */
  function xmlEsc(s) {
    return String(s == null ? '' : s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  }

  function buildGpx(o) {
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="Rotta Pullman" xmlns="http://www.topografix.com/GPX/1/1">',
      `  <metadata><name>${xmlEsc(o.name)}</name><desc>${xmlEsc(o.desc || '')}</desc></metadata>`,
    ];
    for (const w of o.waypoints || []) {
      lines.push(`  <wpt lat="${w.lat.toFixed(6)}" lon="${w.lon.toFixed(6)}"><name>${xmlEsc(w.name)}</name>${w.desc ? `<desc>${xmlEsc(w.desc)}</desc>` : ''}</wpt>`);
    }
    lines.push(`  <trk><name>${xmlEsc(o.name)}</name><trkseg>`);
    for (const c of o.coords) lines.push(`    <trkpt lat="${c[0].toFixed(6)}" lon="${c[1].toFixed(6)}"/>`);
    lines.push('  </trkseg></trk>', '</gpx>');
    return lines.join('\n');
  }

  function toBase64Url(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromBase64Url(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function encodeShare(st) {
    const o = {
      s: st.stops.filter((x) => x.lat != null).map((x) => [+x.lat.toFixed(5), +x.lon.toFixed(5), x.label || '', x.dwell || 0]),
      v: st.vehicle, m: st.margin, b: st.breakMode,
      o: { t: st.options.avoidTolls ? 1 : 0, h: st.options.avoidHighways ? 1 : 0, f: st.options.avoidFerries ? 1 : 0, g: st.options.strictHgv ? 1 : 0, x: st.options.vmax },
    };
    return toBase64Url(JSON.stringify(o));
  }

  function decodeShare(code) {
    try {
      const o = JSON.parse(fromBase64Url(code));
      if (!o || !Array.isArray(o.s) || o.s.length < 2) return null;
      return {
        stops: o.s.slice(0, 25).map((x) => ({ lat: Number(x[0]), lon: Number(x[1]), label: String(x[2] || '').slice(0, 160), dwell: Number(x[3]) || 0 }))
          .filter((x) => isFinite(x.lat) && isFinite(x.lon)),
        vehicle: o.v ? sanitizeVehicle(o.v) : null,
        margin: isFinite(o.m) ? Math.min(0.5, Math.max(0, Number(o.m))) : null,
        breakMode: ['legge', 'frazionata', 'doppio'].includes(o.b) ? o.b : null,
        options: o.o ? { avoidTolls: !!o.o.t, avoidHighways: !!o.o.h, avoidFerries: !!o.o.f, strictHgv: o.o.g !== 0, vmax: [80, 90, 100].includes(o.o.x) ? o.o.x : 100 } : null,
      };
    } catch (e) {
      return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Riquadri dei dati scaricati (limiti, aree di servizio, parcheggi)   */
  /* ------------------------------------------------------------------ */
  function tileKey(lat, lon, size) {
    return Math.floor(lat / size) + '_' + Math.floor(lon / size);
  }

  /* riquadri che toccano un cerchio di raggio r metri */
  function tilesAround(lat, lon, r, size) {
    const { kx, ky } = metersPerDeg(lat);
    const dLat = r / ky, dLon = r / kx;
    const out = [];
    for (let y = Math.floor((lat - dLat) / size); y <= Math.floor((lat + dLat) / size); y++) {
      for (let x = Math.floor((lon - dLon) / size); x <= Math.floor((lon + dLon) / size); x++) out.push(y + '_' + x);
    }
    return out;
  }

  /* riquadri attraversati da una linea, con un margine in metri */
  function tilesForCoords(coords, size, marginM) {
    const keys = new Set();
    const step = Math.min(5000, (size * 110540) / 4);
    for (let i = 0; i < coords.length; i++) {
      const a = coords[i];
      tilesAround(a[0], a[1], marginM, size).forEach((k) => keys.add(k));
      const b = coords[i + 1];
      if (!b) break;
      const d = haversine(a, b);
      for (let s = step; s < d; s += step) {
        const t = s / d;
        tilesAround(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, marginM, size).forEach((k) => keys.add(k));
      }
    }
    return Array.from(keys);
  }

  /* punto dentro uno degli anelli [[lat, lon], ...] (copertura dei dati) */
  function pointInRings(lat, lon, rings) {
    for (const ring of rings || []) {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const yi = ring[i][0], xi = ring[i][1], yj = ring[j][0], xj = ring[j][1];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  }

  /* tutta la linea è coperta dai dati? (controlla un punto ogni ~2 km) */
  function coordsCovered(coords, rings) {
    if (!rings || !rings.length || !coords.length) return false;
    let acc = Infinity;
    for (let i = 0; i < coords.length; i++) {
      if (i > 0) acc += haversine(coords[i - 1], coords[i]);
      if (acc >= 2000 || i === coords.length - 1) {
        if (!pointInRings(coords[i][0], coords[i][1], rings)) return false;
        acc = 0;
      }
    }
    return true;
  }

  /* riquadro compatto -> elementi nella stessa forma delle risposte Overpass */
  function tileToElements(tile) {
    const out = [];
    const typeOf = (ref) => (ref[0] === 'n' ? 'node' : ref[0] === 'w' ? 'way' : 'relation');
    for (const [ref, g, tags] of tile.r || []) {
      const pts = decodePolyline(g, 5);
      if (!pts.length) continue;
      const id = Number(ref.slice(1));
      if (ref[0] === 'n') out.push({ type: 'node', id, lat: pts[0][0], lon: pts[0][1], tags });
      else out.push({ type: typeOf(ref), id, tags, geometry: pts.map((p) => ({ lat: p[0], lon: p[1] })) });
    }
    for (const [ref, lat, lon, kind, name] of tile.s || []) {
      const tags = { highway: kind ? 'services' : 'rest_area' };
      if (name) tags.name = name;
      out.push({ type: typeOf(ref), id: Number(ref.slice(1)), center: { lat, lon }, tags });
    }
    for (const [ref, lat, lon, tags] of tile.p || []) {
      out.push({ type: typeOf(ref), id: Number(ref.slice(1)), center: { lat, lon }, tags: Object.assign({ amenity: 'parking' }, tags) });
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Percorso non trovato: strade chiuse al mezzo intorno a una tappa    */
  /* ------------------------------------------------------------------ */
  const NOT_FOR_BUS = /^(footway|path|cycleway|bridleway|steps|track|pedestrian|corridor|proposed|construction|platform)$/;

  /*
   * Strade con limiti incompatibili entro radiusM metri da un punto, dalla più vicina:
   * [{ name, issues: ['altezza massima 1,9 m', ...], dist, ids }]. Vie con lo stesso nome unite.
   */
  function blockersNear(elements, point, veh, radiusM) {
    const p = [point.lat, point.lon];
    const byName = new Map();
    for (const el of elements || []) {
      const t = el.tags || {};
      if (!hasRestrictionTags(t) || NOT_FOR_BUS.test(t.highway || '')) continue;
      if (t.amenity === 'parking' || t.highway === 'services' || t.highway === 'rest_area') continue;
      let dist;
      if (el.geometry && el.geometry.length > 1) {
        dist = Infinity;
        for (let i = 1; i < el.geometry.length; i++) {
          const a = el.geometry[i - 1], b = el.geometry[i];
          dist = Math.min(dist, pointSegDist(p, [a.lat, a.lon], [b.lat, b.lon]));
        }
      } else if (el.lat != null) dist = haversine(p, [el.lat, el.lon]);
      else continue;
      if (dist > radiusM) continue;
      const issues = (hasConditional(t) ? conditionalIssues(t, veh).fixed : evaluateTags(t, veh)).filter((i) => i.severity === 'red');
      if (!issues.length) continue;
      const name = t.name || t.ref || (t.bridge && t.bridge !== 'no' ? 'ponte senza nome' : t.tunnel && t.tunnel !== 'no' ? 'galleria senza nome' : el.type === 'node' ? 'passaggio ristretto' : 'strada senza nome');
      const key = t.name || t.ref || el.type + el.id;
      const cur = byName.get(key) || { name, issues: [], dist, ids: [] };
      for (const i of issues) {
        const txt = i.title.charAt(0).toLowerCase() + i.title.slice(1);
        if (!cur.issues.includes(txt)) cur.issues.push(txt);
      }
      cur.dist = Math.min(cur.dist, dist);
      cur.ids.push(el.type + '/' + el.id);
      byName.set(key, cur);
    }
    return Array.from(byName.values()).sort((a, b) => a.dist - b.dist);
  }

  /* ------------------------------------------------------------------ */
  /* Fonti ufficiali su traffico e cantieri                              */
  /* ------------------------------------------------------------------ */
  // Siti ufficiali dei gestori, controllati il 25/10/2026 (fonti: siti dei gestori, MIT, ART).
  // Per i tratti a pagamento con più gestori si va alla pagina del traffico, se esiste.
  const OP = {
    aspi: { nome: 'Autostrade per l\'Italia', url: 'https://www.autostrade.it/' },
    anas: { nome: 'ANAS', url: 'https://www.stradeanas.it/' },
    brennero: { nome: 'Autostrada del Brennero', url: 'https://www.autobrennero.it/it/viabilita/canali-informativi/' },
    a4holding: { nome: 'A4 Holding (Brescia–Verona–Vicenza–Padova)', url: 'https://www.a4holding.it/' },
    cav: { nome: 'Concessioni Autostradali Venete', url: 'https://www.cavspa.it/' },
    altoAdriatico: { nome: 'Autostrade Alto Adriatico', url: 'https://www.autostradealtoadriatico.it/' },
    serravalle: { nome: 'Milano Serravalle – Milano Tangenziali', url: 'https://www.serravalle.it/' },
    satap: { nome: 'SATAP', url: 'https://www.satapweb.it/' },
    itp: { nome: 'Ivrea Torino Piacenza (ITP)', url: 'https://www.itpspa.it/' },
    autoviaPadana: { nome: 'Autovia Padana', url: 'https://www.autoviapadana.it/' },
    sitaf: { nome: 'SITAF', url: 'https://www.sitaf.it/' },
    sav: { nome: 'Autostrade Valdostane (SAV)', url: 'https://www.sav-a5.it/' },
    rav: { nome: 'Raccordo Autostradale Valle d\'Aosta (RAV)', url: 'https://www.ravspa.it/' },
    astiCuneo: { nome: 'Asti-Cuneo', url: 'https://www.asticuneo.it/' },
    fiori: { nome: 'Autostrada dei Fiori', url: 'https://www.autostradadeifiori.it/' },
    tirreno: { nome: 'Concessioni del Tirreno', url: 'https://www.concessionideltirreno.it/infoviabilita/' },
    salt: { nome: 'SALT', url: 'https://www.salt.it/info-traffico/' },
    sat: { nome: 'Autostrada Tirrenica (SAT)', url: 'https://www.tirrenica.it/' },
    brebemi: { nome: 'A35 Brebemi', url: 'https://www.brebemi.it/' },
    pedemontana: { nome: 'Autostrada Pedemontana Lombarda', url: 'https://www.pedemontana.com/' },
    teem: { nome: 'Tangenziale Esterna (TEEM)', url: 'https://www.tangenziale.esterna.it/infoviabilita/' },
    tangNapoli: { nome: 'Tangenziale di Napoli', url: 'https://www.tangenzialedinapoli.it/' },
    spn: { nome: 'Salerno Pompei Napoli', url: 'https://salernopompeinapolispa.it/' },
    parchi: { nome: 'Strada dei Parchi', url: 'https://www.stradadeiparchi.it/' },
    cas: { nome: 'Consorzio Autostrade Siciliane', url: 'https://www.autostradesiciliane.it/' },
  };
  const TRAFFIC_SOURCES = {
    cciss: { nome: 'CCISS Viaggiare informati', url: 'https://www.cciss.it/', nota: 'notiziario nazionale su tutte le strade' },
    anas: Object.assign({ nota: 'strade statali' }, OP.anas),
  };

  /*
   * Autostrade italiane → gestori. Ogni tratto ha un tracciato approssimato (punti lat, lon
   * lungo l'autostrada): serve a capire quale gestore ha il tratto che percorri e a non
   * confondere le autostrade estere con la stessa sigla (la A13 austriaca non è la Bologna–Padova).
   */
  const T = (op, tratto, ...linee) => Object.assign({ tratto, linee }, op);
  const ROAD_OPERATORS = {
    A1: [T(OP.aspi, '', [[45.40, 9.27], [45.30, 9.50], [45.05, 9.70], [44.87, 10.06], [44.80, 10.33], [44.70, 10.63], [44.63, 10.92], [44.53, 11.28], [44.40, 11.25], [44.00, 11.25], [43.80, 11.20], [43.65, 11.45], [43.47, 11.83], [43.03, 11.93], [42.72, 12.10], [42.45, 12.38], [42.15, 12.58], [41.98, 12.60], [41.78, 12.92], [41.62, 13.33], [41.48, 13.83], [41.30, 14.08], [41.10, 14.22], [41.05, 14.33], [40.88, 14.30]])],
    A2: [T(OP.anas, '', [[40.75, 14.78], [40.60, 15.05], [40.40, 15.58], [40.12, 15.75], [39.90, 15.98], [39.30, 16.25], [38.95, 16.30], [38.68, 16.10], [38.48, 15.98], [38.22, 15.65], [38.11, 15.65]])],
    A3: [T(OP.spn, '', [[40.85, 14.30], [40.79, 14.37], [40.70, 14.48], [40.74, 14.50], [40.74, 14.64], [40.68, 14.76]])],
    A4: [
      T(OP.satap, 'Torino–Milano', [[45.10, 7.72], [45.20, 7.95], [45.37, 8.17], [45.46, 8.62], [45.51, 9.10]]),
      T(OP.itp, 'Ivrea–Santhià', [[45.45, 7.90], [45.40, 8.05], [45.37, 8.15]]),
      T(OP.aspi, 'Milano–Brescia', [[45.52, 9.13], [45.54, 9.23], [45.58, 9.40], [45.65, 9.65], [45.56, 10.10], [45.52, 10.20]]),
      T(OP.a4holding, 'Brescia–Padova', [[45.50, 10.28], [45.46, 10.55], [45.40, 10.95], [45.45, 11.30], [45.53, 11.55], [45.43, 11.85]]),
      T(OP.cav, 'Padova–Venezia e Passante di Mestre', [[45.42, 11.95], [45.44, 12.10], [45.47, 12.20]], [[45.49, 12.15], [45.55, 12.12], [45.60, 12.25], [45.58, 12.36]]),
      T(OP.altoAdriatico, 'Venezia–Trieste', [[45.59, 12.40], [45.63, 12.57], [45.77, 12.85], [45.80, 13.05], [45.88, 13.28], [45.82, 13.50], [45.78, 13.62], [45.75, 13.66]]),
    ],
    A5: [
      T(OP.itp, 'Torino–Quincinetto', [[45.12, 7.75], [45.20, 7.78], [45.37, 7.85], [45.46, 7.87], [45.56, 7.81]], [[45.45, 7.90], [45.40, 8.05], [45.37, 8.15]]),
      T(OP.sav, 'Quincinetto–Aosta', [[45.57, 7.80], [45.60, 7.79], [45.67, 7.69], [45.74, 7.62], [45.74, 7.46], [45.735, 7.36]]),
      T(OP.rav, 'Aosta–Monte Bianco', [[45.73, 7.30], [45.75, 7.04], [45.80, 6.97], [45.82, 6.96]]),
    ],
    A6: [T(OP.fiori, '', [[44.95, 7.70], [44.85, 7.72], [44.65, 7.75], [44.40, 7.82], [44.38, 8.03], [44.37, 8.20], [44.33, 8.35], [44.30, 8.42]])],
    A7: [
      T(OP.serravalle, 'Milano–Serravalle', [[45.42, 9.17], [45.20, 9.10], [45.10, 9.00], [44.90, 8.87], [44.72, 8.85]]),
      T(OP.aspi, 'Serravalle–Genova', [[44.70, 8.86], [44.55, 8.90], [44.42, 8.92]]),
    ],
    A8: [T(OP.aspi, '', [[45.52, 9.10], [45.57, 9.03], [45.60, 8.92], [45.62, 8.85], [45.66, 8.79], [45.79, 8.83]], [[45.66, 8.79], [45.72, 8.65], [45.73, 8.60]])],
    A9: [T(OP.aspi, '', [[45.57, 9.03], [45.63, 9.03], [45.78, 9.07], [45.83, 9.03]])],
    A10: [
      T(OP.aspi, 'Genova–Savona', [[44.42, 8.88], [44.43, 8.75], [44.38, 8.55], [44.32, 8.45], [44.30, 8.43]]),
      T(OP.tirreno, 'Savona–Ventimiglia', [[44.28, 8.40], [44.06, 8.20], [43.90, 7.98], [43.83, 7.78], [43.79, 7.58]]),
    ],
    A11: [
      T(OP.aspi, 'Firenze–Pisa Nord', [[43.80, 11.18], [43.86, 11.07], [43.92, 10.92], [43.88, 10.77], [43.85, 10.65], [43.85, 10.52], [43.75, 10.42]]),
      T(OP.tirreno, 'Viareggio–Lucca', [[43.88, 10.30], [43.86, 10.42], [43.85, 10.48]]),
    ],
    A12: [
      T(OP.aspi, 'Genova–Sestri Levante, Civitavecchia–Roma', [[44.42, 8.97], [44.35, 9.20], [44.28, 9.40]], [[42.10, 11.82], [41.95, 12.10], [41.82, 12.30]]),
      T(OP.tirreno, 'Sestri Levante–Livorno', [[44.27, 9.42], [44.15, 9.75], [44.12, 9.90], [44.05, 10.05], [43.98, 10.15], [43.87, 10.27], [43.80, 10.33], [43.71, 10.42], [43.60, 10.40]]),
      T(OP.sat, 'Livorno–Rosignano, Tarquinia–Civitavecchia', [[43.57, 10.38], [43.40, 10.45], [43.33, 10.50]], [[42.25, 11.75], [42.12, 11.80]]),
    ],
    A13: [T(OP.aspi, '', [[44.53, 11.36], [44.67, 11.48], [44.83, 11.62], [45.05, 11.78], [45.24, 11.76], [45.38, 11.88]])],
    A14: [T(OP.aspi, '', [[44.52, 11.40], [44.35, 11.70], [44.29, 11.88], [44.22, 12.05], [44.15, 12.25], [44.05, 12.55], [43.90, 12.85], [43.55, 13.45], [43.30, 13.70], [42.95, 13.85], [42.45, 14.15], [42.10, 14.68], [41.98, 14.98], [41.48, 15.55], [41.25, 15.90], [41.20, 16.08], [41.08, 16.80], [40.80, 16.92], [40.55, 17.15]], [[44.30, 11.90], [44.40, 12.15]])],
    A15: [
      T(OP.salt, 'Parma–La Spezia', [[44.80, 10.30], [44.69, 10.10], [44.50, 9.98], [44.37, 9.88], [44.20, 9.97], [44.15, 9.92]]),
      T(OP.tirreno, 'raccordo di La Spezia', [[44.14, 9.90], [44.11, 9.84]]),
    ],
    A16: [T(OP.aspi, '', [[40.92, 14.35], [40.92, 14.78], [41.08, 15.05], [41.13, 15.53], [41.25, 15.90], [41.22, 16.05]])],
    A18: [T(OP.cas, '', [[38.20, 15.53], [37.85, 15.27], [37.73, 15.18], [37.62, 15.15], [37.52, 15.05]], [[37.05, 15.25], [36.90, 15.07], [36.80, 14.95], [36.83, 14.75]])],
    A19: [T(OP.anas, '', [[38.08, 13.42], [37.98, 13.80], [37.55, 14.08], [37.55, 14.30], [37.57, 14.70], [37.45, 15.03]])],
    A20: [T(OP.cas, '', [[38.20, 15.52], [38.18, 15.25], [38.12, 14.97], [38.05, 14.62], [38.02, 14.03], [37.98, 13.80]])],
    A21: [
      T(OP.itp, 'Torino–Piacenza', [[44.98, 7.80], [44.90, 8.20], [44.92, 8.60], [45.03, 8.88], [45.08, 9.30], [45.06, 9.43], [45.05, 9.66]]),
      T(OP.autoviaPadana, 'Piacenza–Brescia', [[45.06, 9.72], [45.10, 9.90], [45.13, 10.02], [45.30, 10.15], [45.45, 10.20]], [[45.03, 9.80], [44.93, 9.90]]),
    ],
    A22: [T(OP.brennero, '', [[47.00, 11.50], [46.88, 11.43], [46.70, 11.65], [46.48, 11.33], [46.07, 11.12], [45.88, 11.02], [45.55, 10.78], [45.40, 10.95], [45.15, 10.80], [44.78, 10.88], [44.62, 10.95]])],
    A23: [
      T(OP.altoAdriatico, 'Palmanova–Udine', [[45.90, 13.30], [46.03, 13.24]]),
      T(OP.aspi, 'Udine–Tarvisio', [[46.08, 13.22], [46.27, 13.13], [46.42, 13.20], [46.50, 13.58]]),
    ],
    A24: [T(OP.parchi, '', [[41.90, 12.58], [41.95, 12.80], [42.05, 12.95], [42.10, 13.08], [42.10, 13.25], [42.35, 13.40], [42.43, 13.55], [42.66, 13.70]])],
    A25: [T(OP.parchi, '', [[42.10, 13.25], [42.03, 13.42], [42.02, 13.65], [42.10, 13.88], [42.20, 13.83], [42.40, 14.15]])],
    A26: [T(OP.aspi, '', [[44.43, 8.75], [44.63, 8.65], [44.90, 8.62], [45.12, 8.48], [45.32, 8.40], [45.40, 8.37], [45.63, 8.38], [45.76, 8.55], [45.90, 8.50], [45.93, 8.43]])],
    A27: [T(OP.aspi, '', [[45.50, 12.25], [45.65, 12.25], [45.88, 12.30], [45.98, 12.30], [46.13, 12.25]])],
    A28: [T(OP.altoAdriatico, '', [[45.78, 12.84], [45.95, 12.50], [45.90, 12.33]])],
    A29: [T(OP.anas, '', [[38.15, 13.30], [37.98, 12.95], [37.65, 12.60]], [[37.98, 12.95], [38.00, 12.55]])],
    A30: [T(OP.aspi, '', [[41.05, 14.35], [40.92, 14.53], [40.78, 14.62], [40.70, 14.78]])],
    A31: [T(OP.a4holding, '', [[45.75, 11.43], [45.70, 11.48], [45.53, 11.55], [45.30, 11.55], [45.10, 11.50]])],
    A32: [T(OP.sitaf, '', [[45.07, 7.55], [45.08, 7.40], [45.13, 7.05], [45.03, 6.83], [45.08, 6.70]])],
    A33: [T(OP.astiCuneo, '', [[44.88, 8.22], [44.70, 8.03], [44.65, 7.85], [44.55, 7.65], [44.40, 7.55]])],
    A34: [T(OP.altoAdriatico, '', [[45.86, 13.45], [45.92, 13.58]])],
    A35: [T(OP.brebemi, '', [[45.48, 9.40], [45.52, 9.60], [45.53, 9.93], [45.55, 10.12]])],
    A36: [T(OP.pedemontana, '', [[45.67, 8.83], [45.68, 8.95], [45.70, 9.03], [45.68, 9.12], [45.62, 9.15], [45.62, 9.37]])],
    A50: [T(OP.serravalle, '', [[45.52, 9.08], [45.48, 9.05], [45.40, 9.13], [45.39, 9.27]])],
    A51: [T(OP.serravalle, '', [[45.40, 9.27], [45.46, 9.27], [45.53, 9.27], [45.57, 9.33]])],
    A52: [T(OP.serravalle, '', [[45.53, 9.05], [45.53, 9.13], [45.57, 9.17], [45.58, 9.27]])],
    A53: [T(OP.serravalle, '', [[45.25, 9.03], [45.20, 9.12]])],
    A54: [T(OP.serravalle, '', [[45.21, 9.10], [45.17, 9.15], [45.15, 9.18]])],
    A55: [T(OP.itp, '', [[45.15, 7.77], [45.13, 7.70], [45.10, 7.60], [45.07, 7.55], [45.00, 7.55], [44.98, 7.63], [44.98, 7.70], [44.95, 7.78]], [[44.98, 7.55], [44.88, 7.35]])],
    A56: [T(OP.tangNapoli, '', [[40.88, 14.30], [40.86, 14.22], [40.83, 14.18], [40.84, 14.10]])],
    A57: [
      T(OP.cav, 'Tangenziale di Mestre', [[45.43, 12.15], [45.46, 12.22], [45.50, 12.25], [45.53, 12.27]]),
      T(OP.altoAdriatico, 'verso Quarto d\'Altino', [[45.54, 12.29], [45.57, 12.37]]),
    ],
    A58: [T(OP.teem, '', [[45.58, 9.37], [45.50, 9.43], [45.42, 9.40], [45.35, 9.33]])],
    A59: [T(OP.pedemontana, '', [[45.77, 9.02], [45.77, 9.06], [45.80, 9.08]])],
    A60: [T(OP.pedemontana, '', [[45.77, 8.83], [45.78, 8.87]])],
    A90: [T(OP.anas, '', [[41.99, 12.50], [41.93, 12.62], [41.84, 12.56], [41.83, 12.43], [41.90, 12.37], [41.97, 12.40], [41.99, 12.50]])],
    A91: [T(OP.anas, '', [[41.85, 12.43], [41.80, 12.30]])],
  };
  const OP_MAX_M = 25000; // oltre questa distanza dal tracciato non è quell'autostrada

  /* sigle delle strade in un testo: "A1, E35" → ['A1'], "SS47 della Valsugana" → ['SS47'], "A1var" → ['A1'] */
  function roadRefs(text) {
    const out = [];
    const re = /\b(A\s?\d{1,2}(?:dir|var)?|RA\s?\d{1,2}|SS\s?\d{1,3}[a-z]{0,3}|SR\s?\d{1,3}|SP\s?\d{1,3})\b/gi;
    let m;
    while ((m = re.exec(String(text || '')))) {
      let r = m[1].toUpperCase().replace(/\s+/g, '');
      if (r[0] === 'A') r = r.replace(/(DIR|VAR)$/, '');
      if (!out.includes(r)) out.push(r);
    }
    return out;
  }

  /* distanza in metri di un punto dal tracciato di un gestore */
  function distToTratto(p, t) {
    let best = Infinity;
    for (const l of t.linee) {
      for (let i = 0; i + 1 < l.length; i++) best = Math.min(best, pointSegDist(p, l[i], l[i + 1]));
      if (l.length === 1) best = Math.min(best, haversine(p, l[0]));
    }
    return best;
  }

  /* il gestore del tratto più vicino a un punto; null se il punto non è su quell'autostrada */
  function operatorAt(ref, p) {
    let best = null, bestD = OP_MAX_M;
    for (const t of ROAD_OPERATORS[ref] || []) {
      const d = distToTratto(p, t);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  /* gestori di una strada: autostrade dalla tabella (con un punto: solo chi ha quel tratto), statali e raccordi ANAS */
  function roadOperators(ref, at) {
    if (ROAD_OPERATORS[ref]) {
      if (!at) return ROAD_OPERATORS[ref];
      const t = operatorAt(ref, at);
      return t ? [t] : [];
    }
    if (/^(SS|RA)/.test(ref)) return [OP.anas];
    return [];
  }

  /* autostrade italiane del percorso, in ordine, con i soli gestori dei tratti percorsi */
  function routeOperators(route) {
    const found = new Map();
    for (const st of (route && route.steps) || []) {
      const refs = roadRefs(st.streets).filter((r) => ROAD_OPERATORS[r]);
      if (!refs.length) continue;
      const from = Math.max(0, st.from | 0), to = Math.min(route.coords.length - 1, st.to | 0);
      const stride = Math.max(1, Math.ceil((to - from) / 12));
      for (const ref of refs) {
        for (let i = from; ; i = Math.min(to, i + stride)) {
          const t = operatorAt(ref, route.coords[i]);
          if (t) {
            if (!found.has(ref)) found.set(ref, []);
            if (!found.get(ref).includes(t)) found.get(ref).push(t);
          }
          if (i >= to) break;
        }
      }
    }
    return Array.from(found, ([ref, ops]) => ({ ref, ops }));
  }

  /* link migliore per una segnalazione: il gestore della sua strada (del tratto, se si sa dove), altrimenti il CCISS */
  function sourceForRoads(refs, at) {
    for (const r of refs || []) {
      const ref = roadRefs(r)[0] || String(r).toUpperCase().replace(/\s+/g, '');
      const op = roadOperators(ref, at).find((o) => o.url);
      if (op) return { nome: op.nome, url: op.url };
    }
    return { nome: TRAFFIC_SOURCES.cciss.nome, url: TRAFFIC_SOURCES.cciss.url };
  }

  /* ------------------------------------------------------------------ */
  /* Luoghi e attrazioni lungo il percorso                               */
  /* ------------------------------------------------------------------ */
  const PLACE_LABEL = { museo: 'Museo', castello: 'Castello', archeologia: 'Sito archeologico', chiesa: 'Chiesa o santuario', natura: 'Natura e panorami', parco: 'Parco a tema o zoo', monumento: 'Monumento', attrazione: 'Attrazione' };
  const PLACE_WEIGHT = { museo: 8, castello: 8, archeologia: 8, chiesa: 6, natura: 6, parco: 6, monumento: 4, attrazione: 5 };

  /* tipo di luogo, solo se notevole (voce su Wikipedia o Wikidata, oppure patrimonio UNESCO) */
  function placeKind(t) {
    if (!t || !t.name) return null;
    const unesco = t.heritage === '1' || /whc|unesco/i.test(t['heritage:operator'] || '');
    if (!t.wikipedia && !t.wikidata && !unesco) return null;
    const tour = t.tourism || '', hist = t.historic || '';
    if (/^(museum|gallery|aquarium)$/.test(tour)) return 'museo';
    if (/^(theme_park|zoo)$/.test(tour)) return 'parco';
    if (/^(castle|fort|palace)$/.test(hist)) return 'castello';
    if (/^(archaeological_site|ruins)$/.test(hist)) return 'archeologia';
    if (/^(church|monastery|abbey|cathedral)$/.test(hist)) return 'chiesa';
    if (t.amenity === 'place_of_worship') {
      return /^(cathedral|basilica)$/.test(t.building || '') || /\b(duomo|cattedrale|basilica|santuario|abbazia|certosa|pieve)\b/i.test(t.name) || unesco ? 'chiesa' : null;
    }
    if (/^(waterfall|cave_entrance)$/.test(t.natural || '') || tour === 'viewpoint') return 'natura';
    if (/^(monument|city_gate|tower)$/.test(hist)) return 'monumento';
    if (tour === 'attraction' || unesco) return 'attrazione';
    return null;
  }

  /* luoghi di un riquadro: [rif, lat, lon, tipo, nome, extra { w: wikipedia, d: wikidata, u: UNESCO, o: orari, s: sito }] */
  function placesFromTile(tile) {
    return ((tile && tile.l) || []).map(([ref, lat, lon, cat, name, x]) => Object.assign({ id: ref, lat, lon, cat, name }, x || {}));
  }

  /* luoghi entro maxM metri in linea d'aria dal percorso, con punto di uscita e punteggio di notorietà */
  function placeCandidates(places, idx, maxM) {
    const out = [];
    for (const p of places || []) {
      const r = idx.nearest(p.lat, p.lon, maxM);
      if (!r) continue;
      const score = (p.u ? 100 : 0) + (/^it:/.test(p.w || '') ? 20 : p.w ? 10 : 0) + (p.d ? 5 : 0) + (PLACE_WEIGHT[p.cat] || 0);
      const dup = out.find((q) => q.name === p.name && haversine([q.lat, q.lon], [p.lat, p.lon]) < 300);
      if (dup) { if (score > dup.score) Object.assign(dup, p, { along: r.along, distM: r.dist, score }); continue; }
      out.push(Object.assign({}, p, { along: r.along, distM: r.dist, score, label: PLACE_LABEL[p.cat] || 'Luogo' }));
    }
    return out;
  }

  /*
   * I più notevoli (a parità, i più vicini), distribuiti lungo il percorso: al massimo 3 entro 5 km l'uno dall'altro,
   * così una città con tanti musei non riempie l'elenco; gli altri entrano solo se avanza posto.
   * Restituiti in ordine lungo il percorso.
   */
  function pickPlaces(cands, limit) {
    const max = limit || 40;
    const sorted = cands.slice().sort((a, b) => b.score - a.score || a.distM - b.distM);
    const out = [], rest = [];
    for (const p of sorted) {
      const near = out.filter((q) => Math.abs(q.along - p.along) < 5000).length;
      if (near < 3 && out.length < max) out.push(p); else rest.push(p);
    }
    for (const p of rest) { if (out.length >= max) break; out.push(p); }
    return out.sort((a, b) => a.along - b.along);
  }

  /* tempo di andata stimato in minuti, quando il calcolo per il pullman non è disponibile */
  function placeEstimateMin(distM) { return Math.max(1, Math.round((distM * 1.3) / (50 / 3.6) / 60)); }

  /* ------------------------------------------------------------------ */
  /* Traffico e cantieri (TomTom Traffic Incidents)                      */
  /* ------------------------------------------------------------------ */
  const TRAFFIC_CAT = {
    0: { cat: 'altro', label: 'Segnalazione' }, 1: { cat: 'incidente', label: 'Incidente' }, 2: { cat: 'meteo', label: 'Nebbia' },
    3: { cat: 'pericolo', label: 'Condizioni pericolose' }, 4: { cat: 'meteo', label: 'Pioggia' }, 5: { cat: 'meteo', label: 'Ghiaccio' },
    6: { cat: 'coda', label: 'Coda' }, 7: { cat: 'corsia', label: 'Corsia chiusa' }, 8: { cat: 'chiusura', label: 'Strada chiusa' },
    9: { cat: 'cantiere', label: 'Cantiere' }, 10: { cat: 'meteo', label: 'Vento forte' }, 11: { cat: 'meteo', label: 'Allagamento' },
    14: { cat: 'veicolo', label: 'Veicolo in avaria' },
  };
  // segnalazioni passeggere: se non hanno una fine, contano solo se passi entro 3 ore
  const TRANSIENT = ['coda', 'incidente', 'veicolo', 'meteo', 'pericolo', 'altro'];

  /* riquadri [minLon, minLat, maxLon, maxLat] di circa stepM metri di percorso (il servizio accetta fino a 10.000 km²) */
  function trafficBoxes(coords, cumD, stepM) {
    const out = [];
    const step = stepM || 60000;
    let start = 0;
    for (let i = 1; i < coords.length; i++) {
      if (cumD[i] - cumD[start] < step && i < coords.length - 1) continue;
      let a0 = 90, a1 = -90, o0 = 180, o1 = -180;
      for (let k = start; k <= i; k++) {
        const [la, lo] = coords[k];
        if (la < a0) a0 = la; if (la > a1) a1 = la; if (lo < o0) o0 = lo; if (lo > o1) o1 = lo;
      }
      const pad = 0.003;
      out.push([o0 - pad, a0 - pad, o1 + pad, a1 + pad].map((x) => +x.toFixed(5)));
      start = i;
    }
    return out;
  }

  function angleDiff(a, b) {
    let d = Math.abs(a - b) % (2 * Math.PI);
    return d > Math.PI ? 2 * Math.PI - d : d;
  }

  /*
   * Segnalazioni TomTom (GeoJSON) che riguardano il percorso: punti entro 35 m e, per le linee, stesso senso
   * di marcia (la carreggiata opposta si scarta). rel 'vicino' per i punti singoli, di cui non si sa il senso.
   */
  function matchIncidents(features, idx) {
    const out = [];
    const seen = new Set();
    for (const f of features || []) {
      const p = (f && f.properties) || {};
      const g = (f && f.geometry) || {};
      const pts = g.type === 'LineString' ? (g.coordinates || []).map((c) => [c[1], c[0]])
        : g.type === 'Point' ? [[g.coordinates[1], g.coordinates[0]]] : [];
      if (!pts.length) continue;
      const id = String(p.id || pts[0].join(',') + '|' + p.iconCategory);
      if (seen.has(id)) continue; // la stessa segnalazione in due riquadri
      seen.add(id);
      const hits = [];
      let aligned = 0, opposite = 0;
      for (let i = 0; i < pts.length; i++) {
        const r = idx.nearest(pts[i][0], pts[i][1], 35);
        if (!r) continue;
        if (pts.length === 1) { hits.push(r.along); continue; }
        const a = i < pts.length - 1 ? pts[i] : pts[i - 1], b = i < pts.length - 1 ? pts[i + 1] : pts[i];
        const d = angleDiff(bearing(a, b), bearing(idx.pointAt(Math.max(0, r.along - 15)), idx.pointAt(r.along + 15)));
        if (d < Math.PI * 50 / 180) { aligned++; hits.push(r.along); } else if (d > Math.PI * 130 / 180) opposite++;
      }
      if (!hits.length) continue;
      if (pts.length > 1 && (aligned < Math.min(2, pts.length - 1) || opposite > aligned)) continue;
      const c = TRAFFIC_CAT[p.iconCategory] || TRAFFIC_CAT[0];
      const events = Array.from(new Set((p.events || []).map((e) => e && e.description).filter(Boolean)));
      const aS = Math.min.apply(null, hits), aE = Math.max.apply(null, hits);
      const at = idx.pointAt(aS);
      out.push({
        id, cat: c.cat, label: c.label, desc: events.join(' · '), roads: p.roadNumbers || [], from: p.from || '', to: p.to || '',
        delayS: Number(p.delay) || 0, lengthM: Number(p.length) || 0, magnitude: Number(p.magnitudeOfDelay) || 0,
        start: p.startTime || null, end: p.endTime || null, validity: p.timeValidity || 'present',
        alongStart: aS, alongEnd: aE, lat: at[0], lon: at[1], coords: pts, rel: pts.length === 1 ? 'vicino' : 'certo',
      });
    }
    return out.sort((x, y) => x.alongStart - y.alongStart);
  }

  /*
   * Stato di una segnalazione quando passa il mezzo:
   *   'attivo' (vale al passaggio), 'ora' (segnalata adesso, ma passi tra più di 3 ore),
   *   'futuro' (comincia dopo il passaggio), 'finito' (finisce prima del passaggio)
   */
  function incidentStatus(inc, passMs, nowMs) {
    const now = nowMs || Date.now();
    const pass = passMs == null ? now : passMs;
    const s = Date.parse(inc.start || ''), e = Date.parse(inc.end || '');
    let state;
    if (isFinite(e) && pass > e) state = 'finito';
    else if (isFinite(s) && pass < s) state = 'futuro';
    else if (TRANSIENT.includes(inc.cat) && !isFinite(e)) state = pass - now > 3 * 3600e3 ? 'ora' : 'attivo';
    else state = 'attivo';
    return { state, severity: state === 'attivo' ? (inc.cat === 'chiusura' ? 'red' : 'amber') : 'info' };
  }

  /* ritardo totale delle segnalazioni in corso ora sul percorso, in secondi */
  function trafficDelay(items, nowMs) {
    let t = 0;
    for (const x of items || []) {
      if (x.rel !== 'certo' || x.validity === 'future') continue;
      if (incidentStatus(x, nowMs, nowMs).state === 'attivo') t += x.delayS || 0;
    }
    return t;
  }

  /* ------------------------------------------------------------------ */
  /* Strade percorse, riconosciute per identificativo                    */
  /* ------------------------------------------------------------------ */
  /*
   * runs: [{ a, b, id, bridge, tunnel }], a e b in metri dalla partenza.
   *   has(id)        la via OSM è tra quelle percorse
   *   covers(along)  in quel punto le strade sono state riconosciute (un tratto può mancare)
   *   levelAt(a, b)  tra a e b il percorso passa su un ponte o in galleria
   */
  function makeRouteWays(runs) {
    const list = (runs || []).filter((x) => x && isFinite(x.a) && isFinite(x.b))
      .map((x) => ({ a: Math.min(x.a, x.b), b: Math.max(x.a, x.b), id: Number(x.id), bridge: !!x.bridge, tunnel: !!x.tunnel }))
      .sort((p, q) => p.a - q.a);
    const ids = new Set(list.map((x) => x.id));
    return {
      size: list.length,
      has: (id) => ids.has(Number(id)),
      covers: (al) => list.some((x) => al >= x.a - 40 && al <= x.b + 40),
      levelAt: (a0, a1) => list.some((x) => x.b >= a0 - 5 && x.a <= a1 + 5 && (x.bridge || x.tunnel)),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Alternative: punti da evitare, tratto a piedi                       */
  /* ------------------------------------------------------------------ */
  const AVOID_NEAR_STOP = 150; // un punto critico attaccato a una tappa non si evita cambiando strada

  /*
   * Punti non transitabili da far evitare al calcolo: rossi, sicuramente sul percorso, lontani dalle tappe.
   * Per ciascuno un punto sulla strada percorsa, a metà del tratto limitato.
   */
  function avoidPoints(hazards, route, stops) {
    const out = [];
    for (const hz of hazards || []) {
      if (hz.severity !== 'red' || hz.rel === 'vicino' || hz.kind === 'tomtom' || hz.decisione === 'no') continue;
      const p = route.index.pointAt((hz.alongStart + hz.alongEnd) / 2);
      if ((stops || []).some((s) => haversine([s.lat, s.lon], p) < AVOID_NEAR_STOP)) continue;
      out.push({ lat: p[0], lon: p[1], title: hz.title, name: hz.name || '', ids: hz.ids.slice() });
    }
    return out;
  }

  /* unisce le liste di punti da evitare senza doppioni (entro 30 m); added: quanti sono nuovi */
  function mergeAvoid(prev, add) {
    const out = (prev || []).slice();
    let added = 0;
    for (const p of add || []) {
      if (out.some((q) => haversine([q.lat, q.lon], [p.lat, p.lon]) < 30 || (q.ids && p.ids && q.ids.some((i) => p.ids.includes(i))))) continue;
      out.push(p);
      added++;
    }
    return { list: out, added };
  }

  /* tratto a piedi stimato: in linea d'aria più un quarto, a 4,5 km/h */
  function walkEstimate(a, b) {
    const m = Math.max(10, Math.round((haversine([a.lat, a.lon], [b.lat, b.lon]) * 1.25) / 10) * 10);
    return { m, min: Math.max(1, Math.round(m / 75)) };
  }

  /* ------------------------------------------------------------------ */
  /* Parcheggi vicino all'arrivo                                         */
  /* ------------------------------------------------------------------ */
  const PARK_NEAR = 1000;       // parcheggi da mostrare intorno all'arrivo
  const PARK_FAR = 5000;        // se entro 1 km non c'è un parcheggio per bus, il più vicino fino a qui
  const PARK_GEN_AREA = 1500;   // parcheggio generico abbastanza grande per entrare e girare con 13 m: almeno 1.500 m² ...
  const PARK_GEN_CAP = 40;      // ... oppure almeno 40 posti auto
  const PARK_CLOSED = /^(underground|multi-storey|rooftop|garage_boxes|carports|sheds|lane|street_side|on_kerb|half_on_kerb)$/;
  const YD = /^(yes|designated)$/;

  /* area in m² di un anello [[lat, lon], ...] */
  function ringArea(pts) {
    if (!pts || pts.length < 3) return 0;
    const { kx, ky } = metersPerDeg(pts[0][0]);
    const o = pts[0];
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      s += ((a[1] - o[1]) * kx) * ((b[0] - o[0]) * ky) - ((b[1] - o[1]) * kx) * ((a[0] - o[0]) * ky);
    }
    return Math.abs(s) / 2;
  }

  /*
   * Che parcheggio è per un pullman:
   *   'bus'      segnato per bus o pullman turistici
   *   'pesanti'  segnato per mezzi pesanti
   *   'generico' grande e all'aperto, non segnato per bus: possibile, da verificare
   *   null       non adatto o troppo piccolo
   */
  function parkingKind(tags, areaM2) {
    const t = tags || {};
    if (t.amenity !== 'parking') return null;
    if (['bus', 'coach', 'tourist_bus'].some((k) => YD.test(t[k] || '')) || /^(bus|coach)/.test(t.parking || '')) return 'bus';
    if (YD.test(t.hgv || '')) return 'pesanti';
    if (/^(private|no)$/.test(t.access || '') || PARK_CLOSED.test(t.parking || '')) return null;
    if (['bus', 'coach', 'tourist_bus', 'motor_vehicle'].some((k) => t[k] === 'no')) return null;
    const h = parseLength(t.maxheight);
    if (h === 'below_default' || (typeof h === 'number' && h < 4)) return null;
    const cap = parseInt(t.capacity, 10);
    if ((isFinite(cap) && cap >= PARK_GEN_CAP) || (areaM2 || 0) >= PARK_GEN_AREA) return 'generico';
    return null;
  }

  /*
   * Sceglie i parcheggi da mostrare intorno all'arrivo:
   *   near    per bus o mezzi pesanti entro 1 km
   *   far     se entro 1 km non ce n'è uno per bus, i più vicini fino a 5 km
   *   generic grandi parcheggi generici entro 1 km
   */
  function pickParkings(elements, dest) {
    const seen = new Set();
    const all = [];
    for (const el of elements || []) {
      const id = el.type + '/' + el.id;
      if (seen.has(id)) continue;
      seen.add(id);
      const t = el.tags || {};
      let c = el.center || (el.lat != null ? { lat: el.lat, lon: el.lon } : null);
      let area = Number(t._a) || 0;
      if (el.geometry && el.geometry.length > 2) {
        const pts = el.geometry.map((g) => [g.lat, g.lon]);
        if (!area) area = ringArea(pts);
        if (!c) {
          const ring = pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] ? pts.slice(0, -1) : pts;
          c = { lat: ring.reduce((s, p) => s + p[0], 0) / ring.length, lon: ring.reduce((s, p) => s + p[1], 0) / ring.length };
        }
      }
      if (!c) continue;
      const kind = parkingKind(t, area);
      if (!kind) continue;
      const d = haversine([dest.lat, dest.lon], [c.lat, c.lon]);
      if (d > PARK_FAR) continue;
      all.push({ id, lat: c.lat, lon: c.lon, d, tags: t, kind, bus: kind === 'bus', area: area >= 100 ? Math.round(area / 100) * 100 : null });
    }
    const marked = all.filter((x) => x.kind !== 'generico');
    const near = marked.filter((x) => x.d <= PARK_NEAR).sort((a, b) => (a.kind === b.kind ? a.d - b.d : a.kind === 'bus' ? -1 : 1)).slice(0, 6);
    const far = near.some((x) => x.kind === 'bus') ? [] : marked.filter((x) => x.d > PARK_NEAR).sort((a, b) => a.d - b.d).slice(0, 3);
    const generic = all.filter((x) => x.kind === 'generico' && x.d <= PARK_NEAR).sort((a, b) => a.d - b.d).slice(0, 4);
    return { near, far, generic };
  }

  /* parcheggi e punti di discesa ufficiali entro radiusM dall'arrivo, dal più vicino */
  function nearOfficial(list, dest, radiusM) {
    return (list || [])
      .map((p) => Object.assign({}, p, { d: haversine([dest.lat, dest.lon], [p.lat, p.lon]) }))
      .filter((p) => p.d <= (radiusM || 15000))
      .sort((a, b) => a.d - b.d)
      .slice(0, 8);
  }

  /* ------------------------------------------------------------------ */
  /* Permessi per i bus nei comuni                                       */
  /* ------------------------------------------------------------------ */
  function normName(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[’'`]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /* place: {nome, prov, paese} -> regola del comune, oppure null */
  function matchPermit(place, regole) {
    if (!place || !place.nome) return null;
    if (place.paese && place.paese !== 'IT') return null;
    const n = normName(place.nome);
    for (const r of regole || []) {
      for (const c of r.comuni) {
        if (normName(c.nome) !== n) continue;
        if (place.prov && c.prov && place.prov !== c.prov) continue;
        return r;
      }
    }
    return null;
  }

  /*
   * Raggruppa le tappe per comune. stops: [{label}], places: [{nome, prov, paese} | null]
   * Restituisce [{key, place, rule, stops: [indici]}], destinazione per prima, poi le tappe in ordine.
   */
  function groupPermits(places, regole) {
    const n = places.length;
    const order = n ? [n - 1].concat(Array.from({ length: n - 1 }, (_, i) => i)) : [];
    const out = [];
    for (const i of order) {
      const pl = places[i];
      const key = pl && pl.nome ? (normName(pl.nome) + '|' + (pl.prov || '')) : 'ignoto-' + i;
      let g = out.find((x) => x.key === key);
      if (!g) { g = { key, place: pl, rule: matchPermit(pl, regole), stops: [] }; out.push(g); }
      g.stops.push(i);
    }
    for (const g of out) g.stops.sort((a, b) => a - b);
    return out;
  }

  return {
    PRESETS, LIMITS, RULES, sanitizeVehicle,
    haversine, bearing, decodePolyline, encodePolyline, simplify, RouteIndex,
    buildCumTime, splitByDistance, normalizeValhalla, streetAtAlong, normalizeOrs, finishRoute, timeAtAlong, alongAtTime,
    parseLength, parseWeight, evaluateTags, hazardAdvice, accessFor,
    parseConditional, parseOH, ohAt, isHolidayIT, easter, effectiveTags, hasConditional, conditionalIssues, conditionalAt, condText, COND_KEYS, hasRestrictionTags, wayNear, sameRoad, hazardOrder, osmMeta, sourceLabel, hazardDoubts, compareRoutes, wayRelation, analyzeElements,
    planTrip, fmtDur, fmtDist, fmtClock, fmtNum, stopLetter, parseCoords,
    buildGpx, encodeShare, decodeShare, normName, matchPermit, groupPermits,
    tileKey, tilesAround, tilesForCoords, pointInRings, coordsCovered, tileToElements,
    PARK_NEAR, PARK_FAR, ringArea, parkingKind, pickParkings, nearOfficial, blockersNear, makeRouteWays,
    trafficBoxes, matchIncidents, incidentStatus, trafficDelay,
    PLACE_LABEL, placeKind, placesFromTile, placeCandidates, pickPlaces, placeEstimateMin,
    TRAFFIC_SOURCES, roadRefs, roadOperators, routeOperators, sourceForRoads, avoidPoints, mergeAvoid, walkEstimate,
  };
});
