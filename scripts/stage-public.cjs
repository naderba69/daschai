#!/usr/bin/env node
/* Stage the deployable site into public/ (Vercel's output directory — see vercel.json).
   The app is authored and built at the repo root (index.html + assets/ …); this copies exactly the files the
   browser loads, so sources, tests, node_modules, package.json and the docs are never published.
   Usage: node scripts/stage-public.cjs [outDir]   (default: public) */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// Everything the running app requests (index.html shell, service worker + its version manifest, PWA manifest,
// lazy chunks, workers, icons, PWA widget templates, the in-app changelog).
const FILES = ['index.html', 'sw.js', 'manifest.json', 'version.json', 'CHANGELOG.md'];
const DIRS = ['assets', 'workers', 'icons', 'widgets', '.well-known'];
const REQUIRED = ['index.html', 'sw.js', 'manifest.json', 'version.json', 'assets/studio/manifest.json'];

function stage(outDir) {
    const out = path.resolve(ROOT, outDir || 'public');
    if (out === ROOT || !out.startsWith(ROOT + path.sep)) throw new Error('refusing to stage outside the repo: ' + out);
    const missing = REQUIRED.filter(f => !fs.existsSync(path.join(ROOT, f)));
    if (missing.length) throw new Error('missing build output (run node build.js --minify first): ' + missing.join(', '));
    fs.rmSync(out, { recursive: true, force: true });   // no stale files from a restored build cache
    fs.mkdirSync(out, { recursive: true });
    let n = 0;
    for (const f of FILES) if (fs.existsSync(path.join(ROOT, f))) { fs.copyFileSync(path.join(ROOT, f), path.join(out, f)); n++; }
    for (const d of DIRS) {
        const src = path.join(ROOT, d);
        if (!fs.existsSync(src)) continue;
        // precompressed .gz/.br copies are for nginx/Termux only — Vercel compresses on its own
        fs.cpSync(src, path.join(out, d), { recursive: true, filter: (p) => !/\.(gz|br)$/.test(p) });
        n += countFiles(path.join(out, d));
    }
    return { out, files: n };
}
function countFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1), 0);
}

if (require.main === module) {
    try {
        const r = stage(process.argv[2]);
        console.log(`✅ staged ${r.files} files → ${path.relative(ROOT, r.out)}/`);
    } catch (e) {
        console.error('❌ ' + e.message);
        process.exitCode = 1;
    }
}
module.exports = { stage, FILES, DIRS };
