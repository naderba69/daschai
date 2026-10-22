#!/usr/bin/env node
/* Writes the VS Code / Chrome extensions and the CLI from their single source of truth
   (src/integ/extfiles.js — the same generator the Integrations hub uses for its ZIP downloads).
   Usage: node scripts/sync-extensions.cjs [--check]   (--check fails if the committed copies are stale) */
'use strict';
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
function generated() {
    const out = esbuild.buildSync({ entryPoints: [path.join(ROOT, 'src/integ/extfiles.js')], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
    const mod = { exports: {} };
    new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
    const x = mod.exports;
    return { ...x.vscodeFiles(), ...x.chromeFiles(), ...x.cliFiles() };
}
if (require.main === module) {
    const check = process.argv.includes('--check');
    const files = generated();
    const stale = [];
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(ROOT, rel);
        const cur = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
        if (cur === content) continue;
        stale.push(rel);
        if (!check) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, content); if (/\.js$/.test(rel) && content.startsWith('#!')) fs.chmodSync(abs, 0o755); }
    }
    if (check && stale.length) { console.error('Stale generated files (run node scripts/sync-extensions.cjs):\n  ' + stale.join('\n  ')); process.exitCode = 1; }
    else console.log(check ? `✅ ${Object.keys(files).length} extension/CLI files in sync` : `✍️  wrote ${stale.length}/${Object.keys(files).length} files`);
}
module.exports = { generated };
