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

if (fail.length) { fail.forEach(f => console.log('❌ vercel.json: ' + f)); process.exitCode = 1; }
else console.log(`✅ vercel.json uses only schema-valid keys (${Object.keys(cfg).join(', ')})`);
