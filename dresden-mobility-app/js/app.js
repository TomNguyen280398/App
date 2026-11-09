/* Dresden Mobility - live parking, VVO departures, construction sites */
'use strict';
const $ = s => document.querySelector(s);
const t = k => (I18N[state.lang][k] || k);

const state = {
  lang: localStorage.getItem('dm-lang') || 'en',
  map: null,
  parkingMarkers: L.layerGroup(),
  stopMarker: null,
  constructionLayer: null,
  userMarker: null,
  depTimer: null,
  deferredPrompt: null,
};

/* ---------------- i18n ---------------- */
const I18N = {
  en: { searchPh:"Search stop (e.g. Hauptbahnhof)", install:"Install", parking:"Parking", transport:"Transport",
    construction:"Construction", free:"free", spaces:"spaces", closed:"Closed", nodata:"No live data",
    updated:"Updated", min:"min", delayed:"delayed", ontime:"on time", platform:"Platform",
    seats:"Many seats", standing:"Standing only", full:"Full", unknown:"Unknown", results:"Results",
    noResults:"No stops found", error:"Could not load data. Check your connection.", departures:"Departures",
    hint:"Search a stop or tap a marker", loading:"Loading…", invalid:"Invalid data from city server" },
  de: { searchPh:"Haltestelle suchen (z. B. Hauptbahnhof)", install:"Installieren", parking:"Parken", transport:"ÖPNV",
    construction:"Baustellen", free:"frei", spaces:"Plätze", closed:"Geschlossen", nodata:"Keine Live-Daten",
    updated:"Aktualisiert", min:"Min", delayed:"Verspätung", ontime:"pünktlich", platform:"Gleis",
    seats:"Viele Sitzplätze", standing:"Wenige Sitzplätze", full:"Voll", unknown:"Unbekannt", results:"Ergebnisse",
    noResults:"Keine Haltestellen gefunden", error:"Daten konnten nicht geladen werden. Verbindung prüfen.", departures:"Abfahrten",
    hint:"Haltestelle suchen oder Marker antippen", loading:"Laden…", invalid:"Ungültige Daten vom Stadtserver" }
};

function applyLang() {
  document.documentElement.lang = state.lang;
  $('#langBtn').textContent = state.lang === 'en' ? 'DE' : 'EN';
  document.querySelectorAll('[data-i18n]').forEach(el => el.textContent = t(el.dataset.i18n));
  document.querySelectorAll('[data-i18n-ph]').forEach(el => el.placeholder = t(el.dataset.i18nPh));
  localStorage.setItem('dm-lang', state.lang);
}

/* ---------------- fetch with CORS fallback ---------------- */
async function fetchJSON(url, opts = {}) {
  const doFetch = async u => {
    const r = await fetch(u, opts);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  };
  try { return await doFetch(url); } catch (e) {}
  try { return await doFetch('https://corsproxy.io/?url=' + encodeURIComponent(url)); } catch (e) {}
  if (opts.method && opts.method !== 'GET') throw new Error('CORS');
  const r = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(url));
  const j = await r.json();
  return JSON.parse(j.contents);
}

/* ---------------- map init (Google-look free tiles: CARTO Voyager / OSM) ---------------- */
function initMap() {
  state.map = L.map('map', { zoomControl: false }).setView([51.0504, 13.7373], 14);
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
  }).addTo(state.map);
  state.parkingMarkers.addTo(state.map);
}

/* ---------------- parking (ParkAPI / ParkenDD) ---------------- */
function lotColor(lot) {
  if (lot.state === 'closed') return '#616161';
  if (lot.free === undefined || lot.free === null) return '#9e9e9e';
  const r = lot.free / (lot.total || 1);
  return r > 0.5 ? '#34a853' : r > 0.2 ? '#fbbc04' : '#ea4335';
}

async function loadParking() {
  try {
    const data = await fetchJSON('https://api.parkendd.de/dresden.json');
    state.parkingMarkers.clearLayers();
    (data.lots || []).forEach(lot => {
      if (!lot.coords) return;
      const m = L.circleMarker([lot.coords.lat, lot.coords.lng], {
        radius: 9, color: '#fff', weight: 2, fillColor: lotColor(lot), fillOpacity: 0.95
      });
      const freeTxt = (lot.free !== undefined && lot.free !== null)
        ? '<span class="park-free" style="color:' + lotColor(lot) + '">' + lot.free + '</span> / ' + (lot.total || '?') + ' ' + t('spaces')
        : (lot.state === 'closed' ? t('closed') : t('nodata'));
      const name = (lot.name || '').replace(/</g, '&lt;');
      const addr = lot.address ? '<br>' + lot.address.replace(/</g, '&lt;') : '';
      const link = lot.url ? '<br><a href="' + lot.url + '" target="_blank" rel="noopener">Website</a>' : '';
      m.bindPopup('<b>' + name + '</b>' + addr + '<br>' + t('free') + ': ' + freeTxt + link +
        '<br><small>' + t('updated') + ': ' + (data.last_updated || '').replace('T', ' ').slice(0, 16) + '</small>');
      state.parkingMarkers.addLayer(m);
    });
  } catch (e) { console.warn('parking', e); }
}

/* ---------------- VVO / DVB transport ---------------- */
function parseVvoTime(s) {
  const m = /\/Date\((\d+)(?:([+-])(\d{2})(\d{2}))?\)\//.exec(s || '');
  if (!m) return null;
  let ms = +m[1];
  if (m[2]) ms += (m[2] === '+' ? 1 : -1) * (parseInt(m[3], 10) * 60 + parseInt(m[4], 10)) * 60000;
  return new Date(ms);
}

async function searchStops() {
  const q = $('#stopSearch').value.trim();
  if (!q) return;
  sheet('<p class="hint">' + t('loading') + '</p>');
  try {
    const data = await fetchJSON('https://webapi.vvo-online.de/tr/pointfinder?query=' + encodeURIComponent(q) + '&stopsOnly=true&format=json');
    const pts = (data.Points || []).map(p => p.split('|')).filter(a => a.length > 3);
    if (!pts.length) { sheet('<p class="hint">' + t('noResults') + '</p>'); return; }
    let html = '<h3 class="sheet-title">' + t('results') + '</h3>';
    pts.slice(0, 30).forEach(a => {
      const name = (a[3] || '').replace(/\s*\[.*?\]\s*/g, '').replace(/</g, '&lt;');
      const city = a[2] || '';
      const id = a[0];
      html += '<div class="stop-item" data-stopid="' + id + '"><span>' + name + '</span><span class="sub">' + city + '</span></div>';
    });
    sheet(html);
    document.querySelectorAll('.stop-item').forEach(el => el.onclick = () => {
      const id = el.dataset.stopid;
      showStopOnMap(id, el.querySelector('span').textContent);
    });
  } catch (e) { sheet('<p class="hint">' + t('error') + '</p>'); }
}

async function showStopOnMap(stopId, name) {
  loadDepartures(stopId, name);
  try {
    const data = await fetchJSON('https://webapi.vvo-online.de/tr/pointfinder?query=' + encodeURIComponent(stopId) + '&stopsOnly=true&format=json');
    const a = (data.Points || [])[0] ? data.Points[0].split('|') : null;
    // coords at index 5/6 may be GK4 or WGS84; decimal point => WGS84
    if (a && a.length > 6 && a[5] && a[5].indexOf('.') !== -1) {
      const lat = parseFloat(a[5]), lon = parseFloat(a[6]);
      if (isFinite(lat) && isFinite(lon) && Math.abs(lat) < 90) {
        if (state.stopMarker) state.map.removeLayer(state.stopMarker);
        state.stopMarker = L.marker([lat, lon]).addTo(state.map);
        state.map.flyTo([lat, lon], 16);
      }
    }
  } catch (e) {}
}

function lineClass(mot) { // 0=tram 1=bus 2=train...
  return mot === '0' ? 'tram' : mot === '1' ? 'bus' : 'train';
}

async function loadDepartures(stopId, name) {
  clearInterval(state.depTimer);
  sheet('<p class="hint">' + t('loading') + '</p>');
  const render = async () => {
    try {
      const data = await fetchJSON('https://webapi.vvo-online.de/dm?format=json', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopid: stopId, limit: 12, mot: ['0','1','2','3','4','5','6','7','8','9','10','11'] })
      });
      const deps = data.Departures || [];
      if (!deps.length) { sheet('<h3 class="sheet-title">' + name + '</h3><p class="hint">' + t('noResults') + '</p>'); return; }
      let html = '<h3 class="sheet-title">' + t('departures') + ': ' + name.replace(/</g, '&lt;') + '</h3>';
      const now = Date.now();
      deps.forEach(d => {
        const rt = parseVvoTime(d.RealTime), st = parseVvoTime(d.ScheduledTime);
        const when = rt || st;
        const mins = when ? Math.max(0, Math.round((when - now) / 60000)) : '?';
        const delayMin = rt && st ? Math.round((rt - st) / 60000) : 0;
        const occMap = { 'ManySeats': t('seats'), 'FewSeats': t('standing'), 'StandingOnly': t('standing'), 'Full': t('full') };
        const occ = occMap[d.Occupancy] || '';
        html += '<div class="dep"><span class="badge ' + lineClass(d.Mot) + '">' + (d.LineName || '?') + '</span>' +
          '<span class="dir">' + (d.Direction || '').replace(/</g, '&lt;') + '<br><small class="occ">' +
          (d.Platform ? t('platform') + ' ' + d.Platform + ' · ' : '') + occ + '</small></span>' +
          '<span class="time">' + (mins === 0 ? '&#8776;' + t('now') : mins + ' ' + t('min')) + '</span>' +
          (delayMin > 0 ? '<span class="delay">+' + delayMin + ' ' + t('delayed') + '</span>' : '') + '</div>';
      });
      sheet(html);
    } catch (e) { sheet('<p class="hint">' + t('error') + '</p>'); clearInterval(state.depTimer); }
  };
  await render();
  state.depTimer = setInterval(render, 30000);
}
I18N.en.now = 'now'; I18N.de.now = 'sofort';

/* ---------------- construction (opendata.dresden.de CKAN) ---------------- */
async function loadConstruction() {
  try {
    const search = await fetchJSON('https://opendata.dresden.de/api/3/action/package_search?q=Baustelle&rows=10');
    const pkgs = search.result && search.result.results ? search.result.results : [];
    let geoRes = null;
    for (const p of pkgs) {
      const detail = await fetchJSON('https://opendata.dresden.de/api/3/action/package_show?id=' + encodeURIComponent(p.name));
      const res = (detail.result.resources || []).find(r => /geojson/i.test(r.format || '') || /geojson/i.test(r.url || ''));
      if (res) { geoRes = res; break; }
    }
    if (!geoRes) return;
    const geo = await fetchJSON(geoRes.url);
    if (!geo || !geo.type) { console.warn(t('invalid')); return; }
    if (state.constructionLayer) state.map.removeLayer(state.constructionLayer);
    state.constructionLayer = L.geoJSON(geo, {
      style: { color: '#fbbc04', weight: 3, fillColor: '#fbbc04', fillOpacity: 0.25 },
      pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 8, color: '#fff', weight: 2, fillColor: '#fbbc04', fillOpacity: 0.95 }),
      onEachFeature: (f, layer) => {
        const p = f.properties || {};
        let title = p.NAME || p.Name || p.name || p.BAUMASSNAHME || p.BEZEICHNUNG || t('construction');
        let desc = p.BESCHREIBUNG || p.DESCRIPTION || p.BEMERKUNG || p.ART || '';
        let extra = '';
        ['ORTSBEREICH','STRASSE','ZEITRAUM','BEGINN','ENDE','STATUS'].forEach(k => { if (p[k]) extra += '<br><small>' + k + ': ' + String(p[k]).replace(/</g,'&lt;') + '</small>'; });
        layer.bindPopup('<div class="constr-title">&#9888; ' + String(title).replace(/</g,'&lt;') + '</div>' +
          String(desc).replace(/</g,'&lt;') + extra);
      }
    }).addTo(state.map);
  } catch (e) { console.warn('construction', e); }
}

/* ---------------- UI helpers ---------------- */
function sheet(html) { $('#sheetContent').innerHTML = html; }
$('#sheetHandle').addEventListener('click', () => {
  const s = $('#sheet'); s.style.display = s.style.display === 'none' ? 'flex' : 'none';
});

function bindUI() {
  $('#langBtn').onclick = () => { state.lang = state.lang === 'en' ? 'de' : 'en'; applyLang(); loadParking(); };
  $('#searchBtn').onclick = searchStops;
  $('#stopSearch').addEventListener('keydown', e => { if (e.key === 'Enter') searchStops(); });
  $('#lyrParking').onchange = e => e.target.checked ? state.parkingMarkers.addTo(state.map) : state.map.removeLayer(state.parkingMarkers);
  $('#lyrTransport').onchange = e => { if (!e.target.checked && state.stopMarker) { state.map.removeLayer(state.stopMarker); state.stopMarker = null; clearInterval(state.depTimer); } };
  $('#lyrConstruction').onchange = e => { if (state.constructionLayer) e.target.checked ? state.constructionLayer.addTo(state.map) : state.map.removeLayer(state.constructionLayer); };
  $('#locateBtn').onclick = () => {
    navigator.geolocation && navigator.geolocation.getCurrentPosition(pos => {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      if (state.userMarker) state.map.removeLayer(state.userMarker);
      state.userMarker = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 2, fillColor: '#1a73e8', fillOpacity: 1 }).addTo(state.map);
      state.map.flyTo(ll, 15);
    });
  };
  // PWA install
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.deferredPrompt = e; $('#installBtn').hidden = false; });
  $('#installBtn').onclick = async () => {
    if (!state.deferredPrompt) return;
    state.deferredPrompt.prompt();
    await state.deferredPrompt.userChoice;
    state.deferredPrompt = null; $('#installBtn').hidden = true;
  };
}

/* ---------------- boot ---------------- */
initMap(); applyLang(); bindUI();
loadParking(); setInterval(loadParking, 60000);
loadConstruction();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js');
}
