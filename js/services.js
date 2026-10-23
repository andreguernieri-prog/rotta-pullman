/*
 * Rotta Pullman — chiamate ai servizi esterni (tutti basati su OpenStreetMap).
 *  - Ricerca indirizzi: Photon (komoot), con Nominatim come riserva
 *  - Calcolo percorso: Valhalla (FOSSGIS) profilo "truck" con dimensioni del mezzo,
 *    oppure openrouteservice profilo HGV con vehicle_type "bus" (serve una chiave gratuita)
 *  - Controllo limiti, aree di servizio e parcheggi bus: Overpass API
 */
(function (root) {
  'use strict';
  const C = root.RPCore;

  const URLS = {
    photon: 'https://photon.komoot.io',
    nominatim: 'https://nominatim.openstreetmap.org',
    valhalla: 'https://valhalla1.openstreetmap.de',
    ors: 'https://api.openrouteservice.org',
    overpass: [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    ],
  };

  class ServiceError extends Error {
    constructor(message, code) { super(message); this.code = code; }
  }

  async function request(url, opts = {}, timeoutMs = 25000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const outer = opts.signal;
    if (outer) {
      if (outer.aborted) ctrl.abort();
      else outer.addEventListener('abort', () => ctrl.abort(), { once: true });
    }
    try {
      const res = await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
      let data = null;
      const text = await res.text();
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
      return { ok: res.ok, status: res.status, data, text };
    } catch (e) {
      if (outer && outer.aborted) throw new ServiceError('Operazione annullata.', 'aborted');
      if (e.name === 'AbortError') throw new ServiceError('Il servizio non ha risposto in tempo. Riprova.', 'timeout');
      throw new ServiceError('Servizio non raggiungibile. Controlla la connessione a internet.', 'network');
    } finally {
      clearTimeout(timer);
    }
  }

  /* ------------------------------ Indirizzi ------------------------------ */
  function photonItem(f) {
    const p = f.properties || {};
    const [lon, lat] = f.geometry.coordinates;
    const street = p.street ? p.street + (p.housenumber ? ' ' + p.housenumber : '') : '';
    const place = p.city || p.town || p.village || p.district || p.county || '';
    const main = p.name || street || place || p.state || 'Punto senza nome';
    const sub = [p.name && street ? street : '', place && place !== main ? place : '', p.county && p.county !== place && p.county !== main ? p.county : '', p.country && p.countrycode !== 'IT' ? p.country : '']
      .filter(Boolean).join(', ');
    const label = main + (place && place !== main ? ', ' + place : '');
    return { main, sub, label, lat, lon };
  }

  async function geocode(q, near, signal) {
    const u = new URL(URLS.photon + '/api/');
    u.searchParams.set('q', q);
    u.searchParams.set('limit', '7');
    if (near) {
      u.searchParams.set('lat', near.lat.toFixed(4));
      u.searchParams.set('lon', near.lng.toFixed(4));
    }
    const r = await request(u.toString(), { signal }, 12000);
    if (!r.ok || !r.data || !Array.isArray(r.data.features)) throw new ServiceError('Ricerca indirizzi non disponibile.', 'geocode');
    return r.data.features.map(photonItem);
  }

  async function geocodeFallback(q, signal) {
    const u = new URL(URLS.nominatim + '/search');
    u.searchParams.set('q', q);
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('limit', '5');
    u.searchParams.set('accept-language', 'it');
    const r = await request(u.toString(), { signal }, 12000);
    if (!r.ok || !Array.isArray(r.data)) throw new ServiceError('Ricerca indirizzi non disponibile.', 'geocode');
    return r.data.map((x) => {
      const parts = String(x.display_name || '').split(', ');
      return { main: parts[0] || x.name, sub: parts.slice(1, 4).join(', '), label: parts.slice(0, 2).join(', '), lat: Number(x.lat), lon: Number(x.lon) };
    });
  }

  async function reverse(lat, lon) {
    const u = new URL(URLS.photon + '/reverse');
    u.searchParams.set('lat', lat.toFixed(6));
    u.searchParams.set('lon', lon.toFixed(6));
    u.searchParams.set('limit', '1');
    const r = await request(u.toString(), {}, 10000);
    const f = r.ok && r.data && r.data.features && r.data.features[0];
    return f ? photonItem(f).label : null;
  }

  /* ------------------------------ Percorso ------------------------------ */
  function valhallaBody(stops, veh, margin, opt) {
    return {
      locations: stops.map((s) => ({ lat: +s.lat.toFixed(6), lon: +s.lon.toFixed(6), type: 'break' })),
      costing: 'truck',
      costing_options: {
        truck: {
          height: +(veh.altezza + margin).toFixed(2),
          width: veh.larghezza,
          length: veh.lunghezza,
          weight: veh.peso,
          axle_load: veh.caricoAsse,
          axle_count: veh.assi,
          hazmat: false,
          top_speed: opt.vmax,
          use_highways: opt.avoidHighways ? 0 : 1,
          use_tolls: opt.avoidTolls ? 0 : 0.5,
          use_ferry: opt.avoidFerries ? 0 : 0.5,
          use_living_streets: 0,
          use_tracks: 0,
          service_penalty: 300,
          exclude_unpaved: true,
          // I divieti per i soli camion spesso non valgono per i bus: in modalità meno prudente
          // quelle strade restano percorribili ma penalizzate.
          hgv_no_access_penalty: opt.strictHgv ? 43200 : 1800,
        },
      },
      units: 'kilometers',
      language: 'it-IT',
      directions_type: 'maneuvers',
    };
  }

  async function routeValhalla(stops, veh, margin, opt, signal) {
    const body = valhallaBody(stops, veh, margin, opt);
    const url = URLS.valhalla + '/route?json=' + encodeURIComponent(JSON.stringify(body));
    const r = await request(url, { signal }, 45000);
    if (!r.ok || !r.data || !r.data.trip) {
      const code = r.data && r.data.error_code;
      if (code === 442 || code === 443) {
        throw new ServiceError('Nessun percorso compatibile con le dimensioni del mezzo. Prova a spostare le tappe su strade principali o, se il mezzo è un bus, disattiva “Evita strade vietate ai mezzi pesanti”.', 'noroute');
      }
      if (code === 171 || code === 170 || code === 172) {
        throw new ServiceError('Una tappa è troppo lontana da una strada percorribile dal mezzo. Spostala più vicino a una strada principale.', 'nopoint');
      }
      if (code === 154 || code === 150) throw new ServiceError('Percorso troppo lungo per il servizio gratuito: aggiungi tappe intermedie.', 'toolong');
      if (r.status === 429) throw new ServiceError('Troppe richieste al servizio di calcolo. Attendi un minuto e riprova.', 'rate');
      throw new ServiceError((r.data && r.data.error) ? `Il servizio di calcolo ha risposto: ${r.data.error}` : 'Il servizio di calcolo non è disponibile. Riprova tra poco.', 'route');
    }
    return C.normalizeValhalla(r.data);
  }

  async function routeOrs(stops, veh, margin, opt, key, signal) {
    if (!key) throw new ServiceError('Per usare openrouteservice inserisci la tua chiave gratuita nelle preferenze di percorso.', 'nokey');
    const avoid = [];
    if (opt.avoidTolls) avoid.push('tollways');
    if (opt.avoidHighways) avoid.push('highways');
    if (opt.avoidFerries) avoid.push('ferries');
    const body = {
      coordinates: stops.map((s) => [+s.lon.toFixed(6), +s.lat.toFixed(6)]),
      instructions: true,
      language: 'it',
      units: 'km',
      maximum_speed: Math.max(80, opt.vmax),
      extra_info: ['tollways'],
      options: {
        vehicle_type: 'bus',
        profile_params: {
          restrictions: {
            length: veh.lunghezza,
            width: veh.larghezza,
            height: +(veh.altezza + margin).toFixed(2),
            weight: veh.peso,
            axleload: veh.caricoAsse,
          },
        },
      },
    };
    if (avoid.length) body.options.avoid_features = avoid;
    const r = await request(URLS.ors + '/v2/directions/driving-hgv/geojson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: key, Accept: 'application/json, application/geo+json' },
      body: JSON.stringify(body),
      signal,
    }, 45000);
    if (!r.ok) {
      const err = r.data && r.data.error;
      const code = err && err.code;
      if (r.status === 401 || r.status === 403) throw new ServiceError('La chiave openrouteservice non è valida o è scaduta.', 'nokey');
      if (r.status === 429) throw new ServiceError('Limite giornaliero di openrouteservice raggiunto. Usa Valhalla o riprova domani.', 'rate');
      if (code === 2009) throw new ServiceError('Nessun percorso compatibile con le dimensioni del mezzo. Prova a spostare le tappe su strade principali.', 'noroute');
      if (code === 2010) throw new ServiceError('Una tappa è troppo lontana da una strada percorribile dal mezzo.', 'nopoint');
      if (code === 2004) throw new ServiceError('Percorso troppo lungo per openrouteservice (massimo circa 6.000 km).', 'toolong');
      throw new ServiceError(err && err.message ? `openrouteservice: ${err.message}` : 'openrouteservice non è disponibile. Riprova tra poco.', 'route');
    }
    return C.normalizeOrs(r.data);
  }

  /* ------------------------------ Overpass ------------------------------ */
  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new ServiceError('Operazione annullata.', 'aborted')); }, { once: true });
  });

  // l'ultimo server che ha risposto bene viene provato per primo
  let preferredOverpass = null;
  function overpassOrder() {
    const list = URLS.overpass.slice();
    if (preferredOverpass) { list.splice(list.indexOf(preferredOverpass), 1); list.unshift(preferredOverpass); }
    return list;
  }

  async function overpass(query, signal, timeoutMs) {
    let last = null;
    for (const ep of overpassOrder()) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await request(ep, { method: 'POST', body: new URLSearchParams({ data: query }), signal }, timeoutMs || 60000);
          if (r.ok && r.data && Array.isArray(r.data.elements)) {
            if (r.data.remark && /runtime error|timed out|out of memory/i.test(r.data.remark)) {
              last = new ServiceError('Il server OpenStreetMap non ha completato il controllo.', 'heavy');
              break;
            }
            preferredOverpass = ep;
            return r.data;
          }
          if (r.status === 429 && attempt === 0) { await sleep(3000, signal); continue; } // server pieno: si riprova una volta
          last = new ServiceError(r.status === 429 ? 'I server OpenStreetMap sono occupati.' : 'I server OpenStreetMap non rispondono.', 'overpass');
        } catch (e) {
          if (e.code === 'aborted') throw e;
          last = e;
        }
        break;
      }
    }
    throw last || new ServiceError('I server OpenStreetMap non rispondono.', 'overpass');
  }

  const RESTRICTION_KEYS = '^(maxheight|maxheight:physical|maxwidth|maxwidth:physical|maxlength|maxweight|maxweightrating|maxaxleload)$';

  function lineArg(points) {
    return points.map((p) => p[0].toFixed(6) + ',' + p[1].toFixed(6)).join(',');
  }
  function chunks(points, size) {
    const out = [];
    for (let i = 0; i < points.length - 1; i += size - 1) out.push(points.slice(i, Math.min(points.length, i + size)));
    return out;
  }

  /* limiti lungo un tratto di percorso + aree di servizio raggiungibili */
  const CORRIDOR_TIMEOUT = 50;
  function corridorQuery(coords) {
    const fine = chunks(C.simplify(coords, 4), 250);
    const coarse = chunks(C.simplify(coords, 60), 250);
    const near = fine.map((c) => `  way(around:10,${lineArg(c)})[highway];`).join('\n');
    const svc = coarse.map((c) => `  nw(around:400,${lineArg(c)})[highway~"^(services|rest_area)$"];`).join('\n');
    return `[out:json][timeout:${CORRIDOR_TIMEOUT}];
(
${near}
)->.near;
(
  way.near[~"${RESTRICTION_KEYS}"~"."];
  way.near[~"^(hgv|bus|tourist_bus|coach)$"~"^no$"];
  node(w.near)[~"${RESTRICTION_KEYS}"~"."];
)->.lim;
.lim out body geom;
(
${svc}
)->.svc;
.svc out body center;`;
  }

  /* un tratto alla volta: richieste brevi, che i server pubblici accettano senza scadere */
  async function corridor(coords, signal) {
    const data = await overpass(corridorQuery(coords), signal, (CORRIDOR_TIMEOUT + 15) * 1000);
    return data.elements;
  }

  /* parcheggi adatti ai bus vicino alle tappe */
  async function parkings(points, radius, signal) {
    const parts = points.map((p) => {
      const a = `around:${radius},${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
      return `  nw(${a})[amenity=parking][~"^(bus|coach|tourist_bus)$"~"^(yes|designated)$"];
  nw(${a})[amenity=parking][parking~"^(bus|coach)"];
  nw(${a})[amenity=parking][hgv~"^(yes|designated)$"];`;
    }).join('\n');
    const q = `[out:json][timeout:25];
(
${parts}
);
out body center;`;
    const data = await overpass(q, signal, 35000);
    return data.elements;
  }

  root.RPServices = { URLS, ServiceError, geocode, geocodeFallback, reverse, routeValhalla, routeOrs, corridor, corridorQuery, parkings, valhallaBody };
})(typeof self !== 'undefined' ? self : this);
