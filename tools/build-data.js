#!/usr/bin/env node
/*
 * Rotta Pullman — prepara i riquadri dei dati per il controllo del percorso.
 *
 * Ingresso: l'estrazione OpenStreetMap filtrata ed esportata con osmium (GeoJSON, un elemento
 * per riga), vedi .github/workflows/dati-limiti.yml.
 * Uscita:   <cartella>/index.json        indice: data, copertura, elenco dei riquadri
 *           <cartella>/riquadri/<k>.json un file per riquadro di 0,25° (circa 28 × 20 km)
 *
 * Ogni riquadro contiene, in forma compatta:
 *   r: limiti utili ai bus  [rif, geometria (polyline 5), tag]
 *   s: aree di servizio     [rif, lat, lon, 1 = servizio / 0 = sosta, nome]
 *   p: parcheggi per bus    [rif, lat, lon, tag]
 *
 * Uso: node tools/build-data.js <ingresso.geojsonseq> <cartella> [--poly italy.poly] [--osm-date <data>]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const C = require('../js/core.js');

const VERSIONE = 1;
const RIQUADRO = 0.25;

const RESTR_KEYS = ['maxheight', 'maxheight:physical', 'maxwidth', 'maxwidth:physical', 'maxlength', 'maxweight', 'maxweightrating', 'maxaxleload'];
const ACCESS_KEYS = ['hgv', 'bus', 'tourist_bus', 'coach'];
const KEEP_R = RESTR_KEYS.concat(ACCESS_KEYS, ['psv', 'name', 'ref', 'bridge']);
const KEEP_P = ['name', 'fee', 'capacity:bus', 'capacity:coach', 'access', 'opening_hours', 'bus', 'coach', 'tourist_bus', 'hgv', 'parking'];
const NON_ROAD = ['amenity', 'shop', 'building', 'tourism', 'leisure', 'man_made', 'office', 'craft'];

/* Tiene solo i limiti che un bus può incontrare: il più alto supera di poco i 4 m, il più pesante le 30 t */
function relevantRestriction(t) {
  const h = [C.parseLength(t.maxheight), C.parseLength(t['maxheight:physical'])];
  if (h.some((x) => x === 'below_default' || (typeof x === 'number' && x < 4.6))) return true;
  const w = [C.parseLength(t.maxwidth), C.parseLength(t['maxwidth:physical'])];
  if (w.some((x) => typeof x === 'number' && x < 3)) return true;
  const L = C.parseLength(t.maxlength);
  if (typeof L === 'number' && L < 25) return true;
  const W = [C.parseWeight(t.maxweight), C.parseWeight(t.maxweightrating)];
  if (W.some((x) => x != null && x < 40.5)) return true;
  const A = C.parseWeight(t.maxaxleload);
  if (A != null && A < 13) return true;
  return ACCESS_KEYS.some((k) => t[k] === 'no');
}

function isBusParking(t) {
  if (t.amenity !== 'parking') return false;
  return ['bus', 'coach', 'tourist_bus', 'hgv'].some((k) => /^(yes|designated)$/.test(t[k] || '')) || /^(bus|coach)/.test(t.parking || '');
}

function pick(t, keys) {
  const o = {};
  for (const k of keys) if (t[k] != null && t[k] !== '') o[k] = String(t[k]).slice(0, 120);
  return o;
}

const r5 = (x) => Math.round(x * 1e5) / 1e5;

/* linea principale di una geometria GeoJSON, come [[lat, lon], ...] */
function lineOf(g) {
  if (!g) return null;
  const ll = (c) => [c[1], c[0]];
  switch (g.type) {
    case 'Point': return [ll(g.coordinates)];
    case 'LineString': return g.coordinates.map(ll);
    case 'MultiLineString': return g.coordinates[0] ? g.coordinates[0].map(ll) : null;
    case 'Polygon': return g.coordinates[0] ? g.coordinates[0].map(ll) : null;
    case 'MultiPolygon': return g.coordinates[0] && g.coordinates[0][0] ? g.coordinates[0][0].map(ll) : null;
    default: return null;
  }
}

function centroid(g) {
  const pts = lineOf(g);
  if (!pts || !pts.length) return null;
  let la = 0, lo = 0;
  for (const p of pts) { la += p[0]; lo += p[1]; }
  return [la / pts.length, lo / pts.length];
}

function tilesOfBox(pts) {
  let a0 = Infinity, o0 = Infinity, a1 = -Infinity, o1 = -Infinity;
  for (const p of pts) { a0 = Math.min(a0, p[0]); a1 = Math.max(a1, p[0]); o0 = Math.min(o0, p[1]); o1 = Math.max(o1, p[1]); }
  const out = [];
  for (let y = Math.floor(a0 / RIQUADRO); y <= Math.floor(a1 / RIQUADRO); y++) {
    for (let x = Math.floor(o0 / RIQUADRO); x <= Math.floor(o1 / RIQUADRO); x++) out.push(y + '_' + x);
  }
  return out;
}

/* Raccoglie gli elementi e li divide in riquadri */
function createBuilder() {
  const tiles = new Map();
  const seen = new Set();
  const stats = { limiti: 0, aree: 0, parcheggi: 0, scartati: 0 };
  const get = (k) => {
    let t = tiles.get(k);
    if (!t) { t = { r: [], s: [], p: [] }; tiles.set(k, t); }
    return t;
  };

  function add(feature) {
    const pr = feature && feature.properties;
    if (!pr || !feature.geometry) return;
    const type = pr['@type'], id = pr['@id'];
    if (!type || id == null) return;
    const t = {};
    for (const k of Object.keys(pr)) if (k[0] !== '@') t[k] = pr[k];
    const ref = (type === 'node' ? 'n' : type === 'way' ? 'w' : 'r') + id;

    if (t.highway === 'services' || t.highway === 'rest_area') {
      if (seen.has('s' + ref)) return;
      seen.add('s' + ref);
      const c = centroid(feature.geometry);
      if (!c) return;
      get(C.tileKey(c[0], c[1], RIQUADRO)).s.push([ref, r5(c[0]), r5(c[1]), t.highway === 'services' ? 1 : 0, String(t.name || '').slice(0, 80)]);
      stats.aree++;
      return;
    }
    if (isBusParking(t)) {
      if (seen.has('p' + ref)) return;
      seen.add('p' + ref);
      const c = centroid(feature.geometry);
      if (!c) return;
      get(C.tileKey(c[0], c[1], RIQUADRO)).p.push([ref, r5(c[0]), r5(c[1]), pick(t, KEEP_P)]);
      stats.parcheggi++;
      return;
    }
    if (type === 'relation') return;
    if (type === 'way' && !t.highway) { stats.scartati++; return; }
    if (type === 'node' && NON_ROAD.some((k) => t[k] != null)) { stats.scartati++; return; }
    if (!relevantRestriction(t)) { stats.scartati++; return; }
    if (seen.has('r' + ref)) return;
    seen.add('r' + ref);
    let pts = lineOf(feature.geometry);
    if (!pts || !pts.length) return;
    if (pts.length > 2) pts = C.simplify(pts, 2);
    const rec = [ref, C.encodePolyline(pts, 5), pick(t, KEEP_R)];
    for (const k of tilesOfBox(pts)) get(k).r.push(rec);
    stats.limiti++;
  }

  function finish(meta) {
    const index = {
      versione: VERSIONE,
      generato: meta.generato,
      datiOsm: meta.datiOsm || null,
      fonte: meta.fonte || 'OpenStreetMap',
      riquadro: RIQUADRO,
      copertura: meta.copertura || null,
      conteggi: stats,
      riquadri: {},
    };
    const keys = Array.from(tiles.keys()).sort();
    for (const k of keys) {
      const t = tiles.get(k);
      index.riquadri[k] = t.r.length + t.s.length + t.p.length;
    }
    return { index, tiles };
  }

  return { add, finish, stats };
}

/* File .poly di Geofabrik -> anelli esterni [[lat, lon], ...], semplificati */
function parsePoly(text, tolM) {
  const rings = [];
  let cur = null, hole = false;
  const lines = String(text).split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    if (l === 'END') {
      if (!cur) break;
      if (!hole && cur.length > 2) rings.push(cur);
      cur = null;
      continue;
    }
    if (!cur) { hole = l.startsWith('!'); cur = []; continue; }
    const [lon, lat] = l.split(/\s+/).map(Number);
    if (isFinite(lat) && isFinite(lon)) cur.push([lat, lon]);
  }
  return rings.map((ring) => C.simplify(ring, tolM || 300).map((p) => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4]));
}

async function main(argv) {
  const args = argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
  const polyPath = opt('--poly');
  const osmDate = opt('--osm-date');
  const [input, outDir] = args;
  if (!input || !outDir) {
    console.error('Uso: node tools/build-data.js <ingresso.geojsonseq> <cartella> [--poly italy.poly] [--osm-date <data>]');
    process.exit(2);
  }
  const b = createBuilder();
  const rl = readline.createInterface({ input: fs.createReadStream(input, { encoding: 'utf8' }), crlfDelay: Infinity });
  let n = 0;
  for await (let line of rl) {
    line = line.replace(/^\u001e/, '').trim();
    if (!line) continue;
    n++;
    try { b.add(JSON.parse(line)); } catch (e) { /* riga non valida: si salta */ }
  }
  const copertura = polyPath ? parsePoly(fs.readFileSync(polyPath, 'utf8'), 300) : null;
  const { index, tiles } = b.finish({ generato: new Date().toISOString(), datiOsm: osmDate, fonte: 'OpenStreetMap, estrazione Geofabrik Italia', copertura });

  fs.mkdirSync(path.join(outDir, 'riquadri'), { recursive: true });
  let bytes = 0, max = 0, maxKey = '';
  for (const [k, t] of tiles) {
    const body = JSON.stringify(Object.assign({ v: VERSIONE, k }, t));
    fs.writeFileSync(path.join(outDir, 'riquadri', k + '.json'), body);
    bytes += body.length;
    if (body.length > max) { max = body.length; maxKey = k; }
  }
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index));
  console.log(`Elementi letti: ${n}`);
  console.log(`Limiti: ${b.stats.limiti} · aree di servizio: ${b.stats.aree} · parcheggi bus: ${b.stats.parcheggi} · scartati: ${b.stats.scartati}`);
  console.log(`Riquadri: ${tiles.size} · totale ${(bytes / 1048576).toFixed(1)} MB (non compressi) · il più grande ${maxKey} ${(max / 1024).toFixed(0)} KB`);
  console.log(`Copertura: ${copertura ? copertura.length + ' anelli, ' + copertura.reduce((s, r) => s + r.length, 0) + ' punti' : 'nessuna'}`);
}

if (require.main === module) {
  main(process.argv).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { createBuilder, parsePoly, relevantRestriction, isBusParking, RIQUADRO, VERSIONE };
