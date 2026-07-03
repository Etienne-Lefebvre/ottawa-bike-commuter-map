/**
 * Watches fetch-routes.mjs and re-runs it on every save, so route edits
 * show up in the browser after a refresh.
 *
 * Usage: node tools/watch-routes.mjs   (Ctrl+C to stop)
 */
import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const script = path.join(import.meta.dirname, 'fetch-routes.mjs');

let running = false;
let queued = false;
let debounce = null;

function run() {
  if (running) { queued = true; return; }
  running = true;
  console.log(`\n[${new Date().toLocaleTimeString()}] change detected — fetching routes...`);
  const child = spawn(process.execPath, [script], { stdio: 'inherit' });
  child.on('exit', (code) => {
    running = false;
    console.log(code === 0 ? 'done — refresh the browser' : `fetch failed (exit ${code})`);
    if (queued) { queued = false; run(); }
  });
}

watch(script, () => {
  clearTimeout(debounce);
  debounce = setTimeout(run, 400); // editors fire several events per save
});

console.log(`Watching ${script}\nSave the file to regenerate routes.geojson. Ctrl+C to stop.`);
run(); // initial run so state matches the file from the start
