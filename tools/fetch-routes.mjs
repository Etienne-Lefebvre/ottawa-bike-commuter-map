/**
 * Fetches candidate commuter routes (suburb → downtown Ottawa) from the
 * BRouter public routing API (OpenStreetMap data, ODbL) and writes them
 * to routes.geojson.
 *
 * Each route uses the "trekking" profile, which strongly prefers
 * car-separated cycling infrastructure (the NCC multi-use pathway
 * network), plus a via-point to pin it to the intended corridor.
 *
 * BRouter's response includes the OSM way tags for every segment. We use
 * them to classify each stretch by how protected it is from car traffic:
 *
 *   carfree — dedicated cycleway, multi-use pathway, or protected track
 *   lane    — painted on-street bike lane
 *   road    — shared with car traffic, no bike infrastructure
 *
 * Routes are emitted as one Feature per contiguous safety stretch, all
 * sharing the route's id and display properties. The map scales line
 * thickness by the `safety` property when a route is selected.
 *
 * Usage: node tools/fetch-routes.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DOWNTOWN = [-75.6994, 45.4215]; // Wellington St, near Parliament Hill

const CORRIDORS = [
  {
    id: 'orleans',
    name_en: 'Orléans → Downtown',
    name_fr: 'Orléans → Centre-ville',
    desc_en: 'Ottawa River Pathway east along the Sir George-Étienne Cartier Parkway',
    desc_fr: 'Sentier de la rivière des Outaouais, le long de la promenade Sir-George-Étienne-Cartier',
    color: '#E6194B',
    points: [[-75.5205, 45.4782], [-75.6470, 45.4560], DOWNTOWN],
  },
  {
    id: 'kanata',
    name_en: 'Kanata → Downtown',
    name_fr: 'Kanata → Centre-ville',
    desc_en: 'Watts Creek Pathway to the Ottawa River Pathway at Andrew Haydon Park',
    desc_fr: 'Sentier du ruisseau Watts jusqu’au sentier de la rivière des Outaouais au parc Andrew-Haydon',
    color: '#4363D8',
    points: [[-75.9128, 45.3049], [-75.7995, 45.3552], DOWNTOWN],
  },
  {
    id: 'stittsville',
    name_en: 'Stittsville → Downtown',
    name_fr: 'Stittsville → Centre-ville',
    desc_en: 'Trans Canada Trail through Bells Corners, joining the Watts Creek Pathway',
    desc_fr: 'Sentier transcanadien via Bells Corners, rejoignant le sentier du ruisseau Watts',
    color: '#911EB4',
    points: [[-75.9250, 45.2585], [-75.8330, 45.3210], DOWNTOWN],
  },
  {
    id: 'barrhaven',
    name_en: 'Barrhaven → Downtown',
    name_fr: 'Barrhaven → Centre-ville',
    desc_en: 'North to Hog’s Back, then the Rideau Canal Western Pathway',
    desc_fr: 'Vers le nord jusqu’à Hog’s Back, puis le sentier ouest du canal Rideau',
    color: '#F58231',
    points: [[-75.7359, 45.2733], [-75.6980, 45.3710], DOWNTOWN],
  },
  {
    id: 'south-keys',
    name_en: 'South Keys / Hunt Club → Downtown',
    name_fr: 'South Keys / Hunt Club → Centre-ville',
    desc_en: 'Sawmill Creek Pathway to the Rideau Canal Eastern Pathway',
    desc_fr: 'Sentier du ruisseau Sawmill jusqu’au sentier est du canal Rideau',
    color: '#F032E6',
    points: [[-75.6478, 45.3524], [-75.6770, 45.3840], DOWNTOWN],
  },
  {
    id: 'gatineau-hull',
    name_en: 'Gatineau (Hull) → Downtown',
    name_fr: 'Gatineau (Hull) → Centre-ville',
    desc_en: 'Voyageurs Pathway along the river, crossing the Portage Bridge',
    desc_fr: 'Sentier des Voyageurs le long de la rivière, traversée du pont du Portage',
    color: '#3CB44B',
    points: [[-75.7530, 45.4400], [-75.7080, 45.4230], DOWNTOWN],
  },
];

// ---------------------------------------------------------------------------
// Safety classification from OSM way tags
// ---------------------------------------------------------------------------

const CAR_FREE_HIGHWAYS = new Set([
  'cycleway', 'path', 'footway', 'pedestrian', 'track', 'bridleway', 'steps',
]);

function parseWayTags(str) {
  const tags = {};
  for (const kv of String(str || '').split(' ')) {
    const i = kv.indexOf('=');
    if (i > 0) tags[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return tags;
}

function classify(wayTagsStr) {
  const tags = parseWayTags(wayTagsStr);
  if (CAR_FREE_HIGHWAYS.has(tags.highway)) return 'carfree';

  const cyclewayValues = [
    tags.cycleway, tags['cycleway:left'], tags['cycleway:right'], tags['cycleway:both'],
  ].filter(Boolean);
  if (cyclewayValues.some(v => v === 'track' || v === 'separate')) return 'carfree';
  if (cyclewayValues.some(v => /lane|shared|share_busway|opposite/.test(v))) return 'lane';

  return 'road';
}

// ---------------------------------------------------------------------------
// Split a BRouter track into contiguous safety stretches
// ---------------------------------------------------------------------------

/**
 * BRouter's `messages` property is a table: header row, then one row per
 * segment whose end point is (Longitude/1e6, Latitude/1e6) and whose
 * WayTags describe the OSM way leading to it.
 */
function splitBySafety(coordinates, messages) {
  const header = messages[0];
  const iLon = header.indexOf('Longitude');
  const iLat = header.indexOf('Latitude');
  const iDist = header.indexOf('Distance');
  const iTags = header.indexOf('WayTags');

  const coordKey = c => `${Math.round(c[0] * 1e6)},${Math.round(c[1] * 1e6)}`;

  const stretches = []; // { safety, coords, meters }
  let cur = 0; // index into coordinates of current stretch start

  for (const row of messages.slice(1)) {
    const endKey = `${row[iLon]},${row[iLat]}`;
    let end = cur;
    while (end < coordinates.length - 1 && coordKey(coordinates[end]) !== endKey) end++;
    if (end === cur) continue; // zero-length segment

    const safety = classify(row[iTags]);
    const meters = Number(row[iDist]) || 0;
    const coords = coordinates.slice(cur, end + 1);

    const prev = stretches[stretches.length - 1];
    if (prev && prev.safety === safety) {
      prev.coords.push(...coords.slice(1));
      prev.meters += meters;
    } else {
      stretches.push({ safety, coords: [...coords], meters });
    }
    cur = end;
  }

  // Any trailing coordinates (shouldn't happen, but be safe)
  if (cur < coordinates.length - 1 && stretches.length) {
    stretches[stretches.length - 1].coords.push(...coordinates.slice(cur + 1));
  }

  return stretches;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const root = path.resolve(import.meta.dirname, '..');
const features = [];

for (const c of CORRIDORS) {
  const lonlats = c.points.map(p => p.join(',')).join('|');
  const url = `https://brouter.de/brouter?lonlats=${lonlats}&profile=trekking&alternativeidx=0&format=geojson`;
  process.stdout.write(`Fetching ${c.id}... `);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`FAILED: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const gj = await res.json();
  const f = gj.features[0];
  const km = Math.round(Number(f.properties['track-length']) / 100) / 10;
  const minutes = Math.round((km / 18) * 60); // 18 km/h relaxed commuting pace

  const stretches = splitBySafety(f.geometry.coordinates, f.properties.messages);
  const carFreeMeters = stretches
    .filter(s => s.safety === 'carfree')
    .reduce((sum, s) => sum + s.meters, 0);
  const carfreePct = Math.round((carFreeMeters / (km * 1000)) * 100);

  for (const s of stretches) {
    features.push({
      type: 'Feature',
      properties: {
        id: c.id,
        name_en: c.name_en,
        name_fr: c.name_fr,
        desc_en: c.desc_en,
        desc_fr: c.desc_fr,
        color: c.color,
        distance_km: km,
        minutes,
        carfree_pct: carfreePct,
        safety: s.safety,
      },
      geometry: {
        type: 'LineString',
        // strip elevation, keep [lon, lat], 5-decimal precision (~1 m)
        coordinates: s.coords.map(pt => [
          Math.round(pt[0] * 1e5) / 1e5,
          Math.round(pt[1] * 1e5) / 1e5,
        ]),
      },
    });
  }

  console.log(`${km} km (~${minutes} min), ${stretches.length} stretches, ${carfreePct}% car-free`);
  await new Promise(r => setTimeout(r, 1500)); // be polite to the public server
}

const out = { type: 'FeatureCollection', features };
fs.writeFileSync(path.join(root, 'routes.geojson'), JSON.stringify(out));
console.log(`Wrote routes.geojson (${features.length} features, ${CORRIDORS.length} routes)`);
