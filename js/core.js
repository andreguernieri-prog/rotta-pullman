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
  function evaluateTags(tags, veh) {
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
    if (tags.tourist_bus === 'no' || tags.coach === 'no' || (tags.bus === 'no' && !YES.test(tags.tourist_bus || ''))) {
      out.push({ kind: 'bus', value: null, severity: 'red', title: 'Divieto di transito per bus', detail: tags.tourist_bus === 'no' ? 'Vietato ai bus turistici' : 'Vietato agli autobus' });
    } else if (tags.hgv === 'no' && !busOk) {
      out.push({ kind: 'pesanti', value: null, severity: 'amber', title: 'Divieto per mezzi pesanti', detail: 'Verifica sul cartello se vale anche per gli autobus' });
    }
    return out;
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
      case 'pesanti':
        return 'Su OpenStreetMap questo divieto si usa di solito per il cartello con il camion, che vale per i veicoli che trasportano merci e non per gli autobus. Se sul cartello c\'è solo il camion, il bus può passare; se c\'è un limite di peso o il simbolo dell\'autobus, no. Controlla il cartello con Street View.';
      default:
        return 'Controlla il punto con Street View prima di partire.';
    }
  }

  function hasRestrictionTags(tags) {
    if (!tags) return false;
    return ['maxheight', 'maxheight:physical', 'maxwidth', 'maxwidth:physical', 'maxlength', 'maxweight', 'maxweightrating', 'maxaxleload']
      .some((k) => tags[k] != null) || ['hgv', 'bus', 'tourist_bus', 'coach'].some((k) => tags[k] === 'no');
  }

  /* Una via OSM corre lungo il percorso, lo attraversa o nessuna delle due? */
  function wayRelation(geom, idx, tol) {
    tol = tol || 6;
    const pts = geom.map((g) => [g.lat, g.lon]);
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) total += haversine(pts[i], pts[i + 1]);
    const step = Math.min(50, Math.max(4, total / 150));
    let alignedLen = 0, near = false, minA = Infinity, maxA = -Infinity, firstPt = null;
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
        near = true;
        if (axisDiff(wb, r.bearing) < 25 * RAD) {
          alignedLen += len / n;
          if (r.along < minA) { minA = r.along; firstPt = p; }
          if (r.along > maxA) maxA = r.along;
        }
      }
    }
    const onRoute = alignedLen >= Math.min(20, total * 0.5) && alignedLen > 0;
    return { onRoute, crosses: near && !onRoute, alongStart: minA, alongEnd: maxA, point: firstPt, length: total };
  }

  /*
   * Analizza gli elementi Overpass rispetto al percorso.
   * Restituisce i punti critici raggruppati, le aree di servizio raggiungibili
   * e quanti tratti con limiti sono stati controllati.
   */
  function analyzeElements(elements, idx, veh) {
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
        const r = idx.nearest(el.lat, el.lon, 6);
        if (!r) continue;
        rel = { onRoute: true, alongStart: r.along, alongEnd: r.along, point: [el.lat, el.lon] };
      } else if (el.geometry && el.geometry.length > 1) {
        let a0 = Infinity, o0 = Infinity, a1 = -Infinity, o1 = -Infinity;
        for (const g of el.geometry) { if (g.lat < a0) a0 = g.lat; if (g.lat > a1) a1 = g.lat; if (g.lon < o0) o0 = g.lon; if (g.lon > o1) o1 = g.lon; }
        if (!idx.nearBox(a0, o0, a1, o1, 40)) continue;
        rel = wayRelation(el.geometry, idx, 6);
      } else continue;

      const issues = evaluateTags(tags, veh);
      if (rel.onRoute) {
        checked++;
        for (const is of issues) raw.push(Object.assign({}, is, {
          ids: [el.type + '/' + el.id], name: tags.name || tags.ref || '',
          alongStart: rel.alongStart, alongEnd: rel.alongEnd,
          lat: rel.point ? rel.point[0] : idx.pointAt(rel.alongStart)[0],
          lon: rel.point ? rel.point[1] : idx.pointAt(rel.alongStart)[1],
        }));
      } else if (rel.crosses && tags.bridge && tags.bridge !== 'no') {
        // limite d'altezza scritto sul ponte che passa sopra: spesso è un errore di mappatura, ma va guardato
        for (const is of issues) {
          if (is.kind !== 'altezza') continue;
          raw.push(Object.assign({}, is, {
            severity: 'amber', detail: 'Limite indicato sul ponte che attraversa il percorso: verifica',
            ids: [el.type + '/' + el.id], name: tags.name || tags.ref || '',
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
      const key = h.kind + '|' + h.severity + '|' + h.title;
      const prev = hazards.slice().reverse().find((x) => x._key === key);
      if (prev && h.alongStart - prev.alongEnd < 250) {
        prev.alongEnd = Math.max(prev.alongEnd, h.alongEnd);
        prev.ids.push(...h.ids.filter((i) => !prev.ids.includes(i)));
        if (!prev.name && h.name) prev.name = h.name;
        continue;
      }
      hazards.push(Object.assign({ _key: key }, h));
    }
    hazards.forEach((h) => delete h._key);
    hazards.sort((a, b) => (a.severity === b.severity ? a.alongStart - b.alongStart : a.severity === 'red' ? -1 : 1));

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
    buildCumTime, splitByDistance, normalizeValhalla, normalizeOrs, finishRoute, timeAtAlong, alongAtTime,
    parseLength, parseWeight, evaluateTags, hazardAdvice, hasRestrictionTags, wayRelation, analyzeElements,
    planTrip, fmtDur, fmtDist, fmtClock, fmtNum, stopLetter, parseCoords,
    buildGpx, encodeShare, decodeShare, normName, matchPermit, groupPermits,
    tileKey, tilesAround, tilesForCoords, pointInRings, coordsCovered, tileToElements,
  };
});
