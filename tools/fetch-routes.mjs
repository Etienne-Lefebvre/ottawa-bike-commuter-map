/**
 * Fetches candidate commuter routes (suburb → downtown Ottawa) from the
 * BRouter public routing API (OpenStreetMap data, ODbL) and writes them
 * to routes.geojson.
 *
 * Each route uses the "trekking" profile, which strongly prefers
 * car-separated cycling infrastructure (the NCC multi-use pathway
 * network), plus a via-point to pin it to the intended corridor.
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
    },
    geometry: {
      type: 'LineString',
      // strip elevation, keep [lon, lat], 5-decimal precision (~1 m)
      coordinates: f.geometry.coordinates.map(pt => [
        Math.round(pt[0] * 1e5) / 1e5,
        Math.round(pt[1] * 1e5) / 1e5,
      ]),
    },
  });
  console.log(`${km} km (~${minutes} min)`);
  await new Promise(r => setTimeout(r, 1500)); // be polite to the public server
}

const out = { type: 'FeatureCollection', features };
fs.writeFileSync(path.join(root, 'routes.geojson'), JSON.stringify(out));
console.log(`Wrote routes.geojson (${features.length} routes)`);
