/**
 * Generates the standalone map styles for the CSAP commuter map.
 *
 * Imports the style builder from the whereto.bike platform
 * (https://github.com/eljojo/bike-app-astro, AGPL-3.0), which must be
 * checked out as a sibling directory named `bike-app-astro-main`.
 *
 * The upstream style points tile requests at a server-side proxy
 * (/api/tiles/...). This wrapper swaps in direct Thunderforest URLs with
 * an API key so the map works as a purely static site.
 *
 * Usage: npx tsx tools/generate-style.mts <THUNDERFOREST_API_KEY>
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  buildMapStyle,
  defaultBase, defaultCycling,
  hcBase, hcCycling,
} from '../../bike-app-astro-main/scripts/build-map-style.ts';

const apiKey = process.argv[2] || process.env.THUNDERFOREST_API_KEY;
if (!apiKey) {
  console.error('Usage: npx tsx tools/generate-style.mts <THUNDERFOREST_API_KEY>');
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, '..');

// The base map's own cycling network (teal "oasis" cycleways, on-road lane
// overlays, and — most prominently — signed cycling-route relations like the
// NCC network and Trans Canada Trail) is the hero of the upstream style. In
// this map the coloured commuter routes are the hero instead, so we mute every
// base cycling line layer to a faint background. Matched by id pattern so it
// catches casings and any future layers, in both the default and high-contrast
// variants. The commuter route overlay is added client-side (ids commuter-*),
// so it is never affected here.
const BASE_CYCLING_ID = /(^|-)(oasis|cycling-route|mtb-route|road-cycleway)/;
const MUTE_OPACITY = 0.15;

function muteBaseCycling(style: { layers: { id: string; type: string; paint?: Record<string, unknown> }[] }) {
  for (const layer of style.layers) {
    if (layer.type !== 'line') continue;
    if (!BASE_CYCLING_ID.test(layer.id)) continue;
    // Casings sit under the main line — push them fainter still.
    const target = /casing/.test(layer.id) ? MUTE_OPACITY * 0.7 : MUTE_OPACITY;
    layer.paint = { ...layer.paint, 'line-opacity': target };
  }
}

const variants = [
  { base: defaultBase, cycling: defaultCycling, name: 'Cycling', key: 'default' as const },
  { base: hcBase, cycling: hcCycling, name: 'Cycling High Contrast', key: 'high-contrast' as const },
];

for (const v of variants) {
  const style = buildMapStyle({ base: v.base, cycling: v.cycling }, v.key, v.name);
  style.sources.outdoors.tiles = [
    `https://api.thunderforest.com/thunderforest.outdoors-v2/{z}/{x}/{y}.vector.pbf?apikey=${apiKey}`,
  ];
  style.glyphs = `https://api.thunderforest.com/fonts/{fontstack}/{range}.pbf?apikey=${apiKey}`;
  muteBaseCycling(style);
  const file = path.join(root, `style-${v.key}.json`);
  fs.writeFileSync(file, JSON.stringify(style));
  console.log(`Wrote ${file} (${style.layers.length} layers)`);
}
