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
  const file = path.join(root, `style-${v.key}.json`);
  fs.writeFileSync(file, JSON.stringify(style));
  console.log(`Wrote ${file} (${style.layers.length} layers)`);
}
