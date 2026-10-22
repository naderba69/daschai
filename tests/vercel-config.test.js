/* vercel.json must pass Vercel's server-side schema (https://openapi.vercel.sh/vercel.json — additionalProperties: false).
   Unknown keys (e.g. the legacy "public", or "//" comments) make every deployment fail before it is created. */
'use strict';
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
// Keys this project uses, each checked against the published schema. Add new ones only after checking it.
const TOP = ['$schema', 'version', 'cleanUrls', 'trailingSlash', 'headers', 'rewrites', 'redirects', 'github', 'git', 'outputDirectory', 'buildCommand', 'installCommand', 'framework'];
const GITHUB = ['enabled', 'autoAlias', 'autoJobCancelation', 'silent'];
const fail = [];
Object.keys(cfg).forEach(k => { if (!TOP.includes(k)) fail.push(`unknown top-level key "${k}" (Vercel rejects it)`); });
Object.keys(cfg.github || {}).forEach(k => { if (!GITHUB.includes(k)) fail.push(`unknown key github.${k}`); });
(cfg.headers || []).forEach((h, i) => {
    Object.keys(h).forEach(k => { if (!['source', 'headers', 'has', 'missing'].includes(k)) fail.push(`headers[${i}].${k}`); });
    if (typeof h.source !== 'string' || !Array.isArray(h.headers)) fail.push(`headers[${i}] needs source + headers[]`);
    (h.headers || []).forEach((x, j) => { if (Object.keys(x).sort().join() !== 'key,value' || typeof x.value !== 'string') fail.push(`headers[${i}].headers[${j}] must be {key, value}`); });
});
(cfg.rewrites || []).forEach((r, i) => { if (typeof r.source !== 'string' || typeof r.destination !== 'string') fail.push(`rewrites[${i}] needs source + destination`); });
['cleanUrls', 'trailingSlash'].forEach(k => { if (k in cfg && typeof cfg[k] !== 'boolean') fail.push(`${k} must be boolean`); });

// Vercel's "Other" preset with a build script expects an output directory (STATIC_BUILD_NO_OUT_DIR otherwise):
// the build must stage the site into outputDirectory, and that directory must hold only what the browser loads.
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
if (cfg.outputDirectory !== 'public') fail.push('outputDirectory must be "public" (staged by scripts/stage-public.cjs)');
if (cfg.buildCommand !== 'npm run vercel-build' || !/stage-public\.cjs/.test(pkg.scripts['vercel-build'] || '') || !/build\.js --minify/.test(pkg.scripts['vercel-build'] || '')) fail.push('buildCommand must run the minified build + stage-public');
const { stage } = require('../scripts/stage-public.cjs');
const tmp = path.join('tests', 'tmp-stage-' + process.pid);
try {
    const r = stage(tmp);
    const has = (f) => fs.existsSync(path.join(r.out, f));
    ['index.html', 'sw.js', 'manifest.json', 'version.json', 'CHANGELOG.md', 'assets/studio/manifest.json', 'icons/icon-192.png', 'workers/python.js', 'widgets/quick.json'].forEach(f => { if (!has(f)) fail.push('staged site is missing ' + f); });
    ['src', 'tests', 'node_modules', 'package.json', 'package-lock.json', 'build.js', 'scripts', '.github', '.env.example', 'vercel.json', 'THOUSAND_IDEAS.md'].forEach(f => { if (has(f)) fail.push('staged site must not publish ' + f); });
    // every chunk listed in version.json (read by the service worker) and every asset index.html references must be deployed
    const vj = JSON.parse(fs.readFileSync(path.join(r.out, 'version.json'), 'utf8'));
    Object.keys(vj.files).forEach(f => { if (!has(f.replace(/^\//, ''))) fail.push('version.json lists ' + f + ' but it is not staged'); });
    const html = fs.readFileSync(path.join(r.out, 'index.html'), 'utf8');
    (html.match(/(?:src|href)="\/?((?:assets|icons|workers)\/[^"?#]+)"/g) || []).forEach(m => { const f = m.replace(/^(?:src|href)="\/?/, '').replace(/"$/, ''); if (!has(f)) fail.push('index.html references ' + f + ' but it is not staged'); });
    if (!fail.length) console.log(`✅ stage-public: ${r.files} files, only browser-facing (no sources/tests/package.json)`);
} catch (e) { fail.push('stage-public failed: ' + e.message); } finally { fs.rmSync(path.join(__dirname, '..', tmp), { recursive: true, force: true }); }

if (fail.length) { fail.forEach(f => console.log('❌ vercel.json: ' + f)); process.exitCode = 1; }
else console.log(`✅ vercel.json uses only schema-valid keys (${Object.keys(cfg).join(', ')})`);
