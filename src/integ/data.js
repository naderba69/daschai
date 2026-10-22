/* #982 Supabase / Firebase / PlanetScale • #996 Algolia • #995 Cloudinary */
import { esc, call, btn, pbtn, card, empty, field, select, table, toggle, pre, code, bytesToB64 } from './util.js';

// ====================================================================== pure helpers
export const DB_PROVIDERS = {
    supabase: { label: 'Supabase', fields: [['url', 'Project URL', 'https://xyz.supabase.co'], ['key', 'anon key', 'eyJ…']] },
    firebase: { label: 'Firebase (Firestore)', fields: [['projectId', 'Project ID', 'my-app'], ['apiKey', 'Web API key', 'AIza…']] },
    planetscale: { label: 'PlanetScale', fields: [['host', 'Host', 'aws.connect.psdb.cloud'], ['username', 'Username', ''], ['password', 'Password', 'pscale_pw_…']] }
};
/** Build a provider request for "list rows of a table/collection" or "run SQL". → {url, method, headers, body} */
export function dbRequest(provider, cfg, { table: t, sql, limit = 50 } = {}) {
    cfg = cfg || {};
    if (provider === 'supabase') {
        const base = String(cfg.url || '').replace(/\/+$/, '');
        if (!/^https:\/\//.test(base) || !cfg.key) throw new Error('أدخل رابط المشروع و anon key');
        const h = { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key };
        return t ? { url: `${base}/rest/v1/${encodeURIComponent(t)}?select=*&limit=${limit}`, method: 'GET', headers: h } : { url: `${base}/rest/v1/`, method: 'GET', headers: { ...h, Accept: 'application/openapi+json' } };
    }
    if (provider === 'firebase') {
        if (!cfg.projectId) throw new Error('أدخل Project ID');
        const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/(default)/documents`;
        const key = cfg.apiKey ? 'key=' + encodeURIComponent(cfg.apiKey) : '';
        return t ? { url: `${base}/${t.split('/').map(encodeURIComponent).join('/')}?pageSize=${limit}${key ? '&' + key : ''}`, method: 'GET', headers: {} } : { url: `${base}:listCollectionIds${key ? '?' + key : ''}`, method: 'POST', headers: {}, body: { pageSize: 100 } };
    }
    if (provider === 'planetscale') {
        if (!cfg.host || !cfg.username || !cfg.password) throw new Error('أدخل Host و Username و Password');
        return { url: `https://${String(cfg.host).replace(/^https?:\/\//, '')}/psdb.v1alpha1.Database/Execute`, method: 'POST', headers: { Authorization: 'Basic ' + bytesToB64(new TextEncoder().encode(cfg.username + ':' + cfg.password)) }, body: { query: sql || (t ? `SELECT * FROM \`${String(t).replace(/`/g, '')}\` LIMIT ${limit}` : 'SHOW TABLES'), session: null } };
    }
    throw new Error('مزود غير معروف');
}
/** Firestore typed value → plain JS. */
export function fsValue(v) {
    if (!v || typeof v !== 'object') return v;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue' in v) return null;
    if ('timestampValue' in v) return v.timestampValue;
    if ('referenceValue' in v) return v.referenceValue;
    if ('geoPointValue' in v) return v.geoPointValue;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsValue);
    if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fsValue(x)]));
    return v;
}
/** Normalise a provider response → {tables?: [], rows?: [{}]} */
export function dbParse(provider, data, { table: t } = {}) {
    if (provider === 'supabase') {
        if (!t) return { tables: Object.keys((data && (data.definitions || (data.components && data.components.schemas))) || {}).concat(Object.keys((data && data.paths) || {}).map(p => p.replace(/^\//, '')).filter(p => p && !p.startsWith('rpc/'))).filter((x, i, a) => a.indexOf(x) === i).sort() };
        return { rows: Array.isArray(data) ? data : [] };
    }
    if (provider === 'firebase') {
        if (!t) return { tables: (data && data.collectionIds) || [] };
        return { rows: ((data && data.documents) || []).map(d => ({ _id: String(d.name || '').split('/').pop(), ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, fsValue(v)])) })) };
    }
    if (provider === 'planetscale') {
        if (data && data.error) throw new Error(data.error.message || 'PlanetScale error');
        const r = (data && data.result) || {};
        const cols = (r.fields || []).map(f => f.name);
        const rows = (r.rows || []).map(row => {
            const lens = (row.lengths || []).map(Number), raw = row.values ? atob(row.values) : '';
            let off = 0;
            const o = {};
            cols.forEach((c, i) => { const n = lens[i]; o[c] = n < 0 ? null : raw.slice(off, off + n); if (n > 0) off += n; });
            return o;
        });
        return t ? { rows } : { tables: rows.map(o => Object.values(o)[0]) };
    }
    return { rows: [] };
}
/** Client code for the user's project. */
export function dbClientFiles(provider, cfg = {}) {
    if (provider === 'supabase') return {
        'db/supabase.js': `// Supabase client (browser or Node 18+) — npm i @supabase/supabase-js  (or ESM CDN below)\nimport { createClient } from 'https://esm.sh/@supabase/supabase-js@2';\n\nexport const supabase = createClient('${cfg.url || 'https://YOUR-PROJECT.supabase.co'}', '${cfg.key ? 'YOUR_ANON_KEY' : 'YOUR_ANON_KEY'}');\n\nexport const list = (table, limit = 50) => supabase.from(table).select('*').limit(limit).then(r => { if (r.error) throw r.error; return r.data; });\nexport const insert = (table, row) => supabase.from(table).insert(row).select().single().then(r => { if (r.error) throw r.error; return r.data; });\nexport const update = (table, id, patch) => supabase.from(table).update(patch).eq('id', id).select().single().then(r => { if (r.error) throw r.error; return r.data; });\nexport const remove = (table, id) => supabase.from(table).delete().eq('id', id).then(r => { if (r.error) throw r.error; });\nexport const onChange = (table, cb) => supabase.channel('rt-' + table).on('postgres_changes', { event: '*', schema: 'public', table }, cb).subscribe();\n`,
        'db/README.md': `# Supabase\n\n- ضع anon key فقط في الواجهة، وفعّل **Row Level Security** على كل جدول.\n- \`list('todos')\`، \`insert('todos', {title})\`، \`onChange('todos', console.log)\` للتحديث اللحظي.\n`
    };
    if (provider === 'firebase') return {
        'db/firebase.js': `// Firebase v10 (modular) via CDN\nimport { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';\nimport { getFirestore, collection, getDocs, addDoc, doc, updateDoc, deleteDoc, onSnapshot, query, limit as lim } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';\n\nconst app = initializeApp({ apiKey: '${cfg.apiKey ? 'YOUR_API_KEY' : 'YOUR_API_KEY'}', projectId: '${cfg.projectId || 'your-project'}' });\nexport const db = getFirestore(app);\n\nexport const list = async (col, n = 50) => (await getDocs(query(collection(db, col), lim(n)))).docs.map(d => ({ id: d.id, ...d.data() }));\nexport const insert = (col, data) => addDoc(collection(db, col), data).then(r => r.id);\nexport const update = (col, id, patch) => updateDoc(doc(db, col, id), patch);\nexport const remove = (col, id) => deleteDoc(doc(db, col, id));\nexport const onChange = (col, cb) => onSnapshot(collection(db, col), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))));\n`,
        'db/firestore.rules': `rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /{collection}/{id} {\n      allow read: if true;\n      allow write: if request.auth != null;\n    }\n  }\n}\n`
    };
    if (provider === 'planetscale') return {
        'db/planetscale.js': `// PlanetScale serverless driver (Node / edge) — npm i @planetscale/database\nconst { connect } = require('@planetscale/database');\n\nconst conn = connect({ host: process.env.DATABASE_HOST || '${cfg.host || 'aws.connect.psdb.cloud'}', username: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD });\n\nasync function list(table, limit = 50) { const r = await conn.execute('SELECT * FROM ' + table.replace(/[^\\w]/g, '') + ' LIMIT ?', [limit]); return r.rows; }\nasync function insert(table, row) { const cols = Object.keys(row); const r = await conn.execute('INSERT INTO ' + table.replace(/[^\\w]/g, '') + ' (' + cols.join(',') + ') VALUES (' + cols.map(() => '?').join(',') + ')', cols.map(c => row[c])); return r.insertId; }\nmodule.exports = { conn, list, insert };\n`,
        '.env.example': 'DATABASE_HOST=aws.connect.psdb.cloud\nDATABASE_USERNAME=\nDATABASE_PASSWORD=\n'
    };
    return {};
}

/** Project files → Algolia records (one per file chunk). */
export function algoliaRecords(files, { chunk = 4000 } = {}) {
    const out = [];
    files.forEach(([path, text]) => {
        const lines = String(text).split('\n');
        let buf = [], start = 1, size = 0, part = 0;
        const flush = () => { if (!buf.length) return; out.push({ objectID: path + '#' + part, path, part, line: start, ext: (path.split('.').pop() || '').toLowerCase(), title: (/(?:function|class|const|def)\s+([\w$]+)/.exec(buf.join('\n')) || [])[1] || path.split('/').pop(), content: buf.join('\n') }); part++; buf = []; size = 0; };
        lines.forEach((l, i) => { if (size + l.length > chunk) { flush(); start = i + 1; } buf.push(l); size += l.length + 1; });
        flush();
    });
    return out;
}
/** Cloudinary delivery URL with transformations. */
export function cldUrl(cloud, publicId, t = {}) {
    const parts = [t.width && 'w_' + t.width, t.height && 'h_' + t.height, t.crop && 'c_' + t.crop, t.gravity && 'g_' + t.gravity, t.radius != null && t.radius !== '' && 'r_' + t.radius, t.effect && 'e_' + t.effect, 'q_' + (t.quality || 'auto'), 'f_' + (t.format || 'auto')].filter(Boolean);
    return `https://res.cloudinary.com/${encodeURIComponent(cloud || 'demo')}/image/upload/${parts.join(',')}/${String(publicId).replace(/^\/+/, '')}`;
}
/** Replace local image references in HTML/CSS/MD with uploaded URLs. map: {localPath: url} */
export function rewriteImageRefs(text, fromPath, map) {
    const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
    const resolve = (u) => { const parts = dir ? dir.split('/') : []; String(u).split('/').forEach(s => { if (s === '..') parts.pop(); else if (s && s !== '.') parts.push(s); }); return parts.join('/'); };
    let n = 0;
    const out = String(text).replace(/(src=["']|href=["']|url\(\s*["']?|\]\()([^"')\s]+\.(?:png|jpe?g|gif|webp|svg|avif))/gi, (m, pre, u) => {
        if (/^(https?:|data:|\/\/)/i.test(u)) return m;
        const key = u.startsWith('/') ? u.slice(1) : resolve(u);
        if (!map[key]) return m;
        n++;
        return pre + map[key];
    });
    return { text: out, count: n };
}

export function installData(P) {
    // ---------------------------------------------------------------- #982 databases
    P.ixDbQuery = async function (opts = {}) {
        const c = this.ixCfg('db'), prov = opts.provider || c.provider || 'supabase';
        const req = dbRequest(prov, c[prov] || {}, opts);
        const data = await this.ixHttp(req.url, { method: req.method, headers: req.headers, body: req.body });
        return dbParse(prov, data, opts);
    };
    P.ixDbSave = function () {
        const prov = (document.getElementById('ix-db-prov') || {}).value || 'supabase';
        const patch = {};
        DB_PROVIDERS[prov].fields.forEach(([k]) => { const el = document.getElementById('ix-db-' + k); if (el) patch[k] = el.value.trim(); });
        this.ixSave('db', { provider: prov, [prov]: patch });
        this.showToast('✅ حُفظ محلياً', 'success');
    };
    P.ixDbTables = async function () {
        this.ixDbSave();
        this.ixBusy('ix-db-res', 'الاتصال…');
        try {
            const r = await this.ixDbQuery();
            this._ixDbTables = r.tables || [];
            this.ixOut('ix-db-res', r.tables && r.tables.length ? `<div class="gh-row">${r.tables.map(t => btn('fa-table', esc(t), call('ixDbRows', t))).join('')}</div><div id="ix-db-rows"></div>` : empty('✅ متصل — لا توجد جداول ظاهرة (أو أن الصلاحيات تمنع عرضها). اكتب اسم الجدول يدوياً.') + `<div class="gh-row">${field('ix-db-table', 'جدول/مجموعة', '')}${btn('fa-play', 'عرض', "app.ixDbRows(document.getElementById('ix-db-table').value)")}</div><div id="ix-db-rows"></div>`);
            return r;
        } catch (e) { return this.ixErr(e, 'ix-db-res'); }
    };
    P.ixDbRows = async function (t) {
        if (!t) return null;
        this.ixBusy('ix-db-rows', esc(t));
        try {
            const r = await this.ixDbQuery({ table: t });
            const rows = r.rows || [];
            this._ixDbRows = { table: t, rows };
            const cols = [...new Set(rows.flatMap(o => Object.keys(o)))].slice(0, 12);
            this.ixOut('ix-db-rows', rows.length ? `<div class="ix-scroll">${table(cols.map(esc), rows.map(o => cols.map(c => esc(typeof o[c] === 'object' && o[c] !== null ? JSON.stringify(o[c]) : o[c]).slice(0, 120))), 'ix-datatable')}</div><small class="hv-dim">${rows.length} صف</small><div class="gh-row">${btn('fa-file-export', 'حفظ كـ JSON في المشروع', `app.writeProjectFile('data/${esc(t).replace(/[^\w-]/g, '_')}.json', JSON.stringify(app._ixDbRows.rows, null, 2), 'db');app.showToast('✅ data/${esc(t).replace(/[^\w-]/g, '_')}.json','success')`)}</div>` : empty('الجدول فارغ'));
            return rows;
        } catch (e) { return this.ixErr(e, 'ix-db-rows'); }
    };
    P.ixDbCode = function (prov) {
        const c = this.ixCfg('db');
        prov = prov || c.provider || 'supabase';
        return this.ixWriteFiles(DB_PROVIDERS[prov].label, dbClientFiles(prov, c[prov] || {}));
    };
    P.ixDb = async function () {
        const c = this.ixCfg('db'), prov = c.provider || 'supabase', pc = c[prov] || {};
        return card('قواعد البيانات السحابية', `<p class="hv-dim">اتصل مباشرة من المتصفح لتصفح الجداول والمجموعات وتصدير البيانات، ثم ولّد كود العميل لمشروعك. المفاتيح تُحفظ على جهازك فقط.</p>
            <div class="gh-row">${select('ix-db-prov', 'المزود', Object.entries(DB_PROVIDERS).map(([k, v]) => [k, v.label]), prov, `onchange="app.ixSave('db',{provider:this.value});app.ixRefresh()"`)}</div>
            <div class="gh-row">${DB_PROVIDERS[prov].fields.map(([k, l, ph]) => field('ix-db-' + k, l, pc[k] || '', `dir="ltr" placeholder="${esc(ph)}" ${/password|key/i.test(k) ? 'type="password"' : ''}`)).join('')}</div>
            <div class="gh-row">${pbtn('fa-plug', 'اتصال وعرض الجداول', 'app.ixDbTables()')}${btn('fa-file-code', 'توليد كود العميل', call('ixDbCode', prov))}</div>
            <div id="ix-db-res"></div>`, 'fa-database');
    };

    // ---------------------------------------------------------------- #996 Algolia
    P.ixAlgoliaIndex = async function () {
        const c = this.ixSaveForm('algolia', { appId: 'ix-al-app', searchKey: 'ix-al-search', adminKey: 'ix-al-admin', index: 'ix-al-index' }, { toast: false });
        if (!c.appId || !c.adminKey) { this.showToast('أدخل App ID و Admin key للفهرسة', 'warning'); return null; }
        const recs = algoliaRecords(this.ixFiles(p => !/(^|\/)(node_modules|dist|build)\//.test(p) && !/\.(min\.js|lock)$/.test(p)));
        this.ixBusy('ix-al-res', `رفع ${recs.length} سجل…`);
        try {
            const idx = encodeURIComponent(c.index || 'ox_project');
            const H = { 'X-Algolia-Application-Id': c.appId, 'X-Algolia-API-Key': c.adminKey };
            await this.ixHttp(`https://${c.appId}.algolia.net/1/indexes/${idx}/clear`, { method: 'POST', headers: H, body: {} }).catch(() => null);
            for (let i = 0; i < recs.length; i += 500) await this.ixHttp(`https://${c.appId}.algolia.net/1/indexes/${idx}/batch`, { method: 'POST', headers: H, body: { requests: recs.slice(i, i + 500).map(body => ({ action: 'updateObject', body })) } });
            await this.ixHttp(`https://${c.appId}.algolia.net/1/indexes/${idx}/settings`, { method: 'PUT', headers: H, body: { searchableAttributes: ['title', 'path', 'content'], attributesForFaceting: ['ext'], attributesToSnippet: ['content:20'] } }).catch(() => null);
            this.ixOut('ix-al-res', empty(`✅ فُهرس ${recs.length} سجل في <code>${esc(c.index || 'ox_project')}</code>`));
            return recs.length;
        } catch (e) { return this.ixErr(e, 'ix-al-res'); }
    };
    P.ixAlgoliaSearch = async function (q) {
        const c = this.ixCfg('algolia');
        q = q != null ? q : (document.getElementById('ix-al-q') || {}).value || '';
        if (!c.appId || !(c.searchKey || c.adminKey)) { this.showToast('أدخل App ID و Search key', 'warning'); return null; }
        try {
            const r = await this.ixHttp(`https://${c.appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(c.index || 'ox_project')}/query`, { method: 'POST', headers: { 'X-Algolia-Application-Id': c.appId, 'X-Algolia-API-Key': c.searchKey || c.adminKey }, body: { query: q, hitsPerPage: 20, attributesToSnippet: ['content:20'] } });
            const hits = r.hits || [];
            this.ixOut('ix-al-hits', hits.length ? hits.map(h => `<div class="fmx-item" onclick="${call('openFileAt', h.path, h.line || 1, 1)}"><div><b dir="ltr">${esc(h.path)}:${h.line || 1}</b><small dir="ltr">${String((h._snippetResult && h._snippetResult.content && h._snippetResult.content.value) || '').replace(/<(?!\/?em>)[^>]*>/g, '').slice(0, 300)}</small></div></div>`).join('') + `<small class="hv-dim">${r.nbHits} نتيجة • ${r.processingTimeMS}ms</small>` : empty('لا نتائج'));
            return hits;
        } catch (e) { return this.ixErr(e, 'ix-al-hits'); }
    };
    P.ixAlgoliaCode = function () {
        const c = this.ixCfg('algolia');
        return this.ixWriteFiles('Algolia', {
            'search/algolia.js': `// Algolia InstantSearch-lite (no build) — search-only key is safe in the browser\nconst APP_ID = '${c.appId || 'YOUR_APP_ID'}', SEARCH_KEY = 'YOUR_SEARCH_ONLY_KEY', INDEX = '${c.index || 'products'}';\n\nexport async function search(query, { hitsPerPage = 10, filters = '' } = {}) {\n    const r = await fetch(\`https://\${APP_ID}-dsn.algolia.net/1/indexes/\${INDEX}/query\`, {\n        method: 'POST',\n        headers: { 'X-Algolia-Application-Id': APP_ID, 'X-Algolia-API-Key': SEARCH_KEY },\n        body: JSON.stringify({ query, hitsPerPage, filters })\n    });\n    if (!r.ok) throw new Error('Algolia ' + r.status);\n    return r.json();\n}\n\n/** Wire a search box: searchBox(input, resultsEl, hit => '<li>' + hit.name + '</li>') */\nexport function searchBox(input, results, render) {\n    let t;\n    input.addEventListener('input', () => {\n        clearTimeout(t);\n        t = setTimeout(async () => {\n            const { hits } = await search(input.value);\n            results.innerHTML = hits.map(render).join('');\n        }, 150);\n    });\n}\n`,
            'search/index-server.js': `// Index records from the server (admin key stays on the server)\nconst algoliasearch = require('algoliasearch');\nconst client = algoliasearch('${c.appId || 'YOUR_APP_ID'}', (typeof process !== 'undefined' && process.env.ALGOLIA_ADMIN_KEY) || 'admin_key');\nconst index = client.initIndex('${c.index || 'products'}');\n\nasync function reindex(records) {\n    const res = await index.saveObjects(records.map(r => ({ objectID: String(r.id), ...r })));\n    return res.objectIDs.length;\n}\nmodule.exports = { reindex, index };\n`,
            'search/search.test.js': `const { reindex, index } = require('./index-server.js');\n\ntest('indexes and finds records (local Algolia mock)', async () => {\n    expect(await reindex([{ id: 1, name: 'Red shoes' }, { id: 2, name: 'Blue hat' }])).toBe(2);\n    const r = await index.search('shoes');\n    expect(r.nbHits).toBe(1);\n    expect(r.hits[0].name).toBe('Red shoes');\n});\n`
        });
    };
    P.ixAlgolia = async function () {
        const c = this.ixCfg('algolia');
        return card('بحث فوري بـ Algolia', `<p class="hv-dim">افهرس ملفات مشروعك في Algolia وابحث فيها بسرعة البرق (مع تحمّل الأخطاء الإملائية)، أو ولّد كود بحث جاهزاً لموقعك مع اختبار يعمل محلياً.</p>
            <div class="gh-row">${field('ix-al-app', 'Application ID', c.appId || '', 'dir="ltr"')}${field('ix-al-search', 'Search-only key', c.searchKey || '', 'dir="ltr" type="password"')}${field('ix-al-admin', 'Admin key (للفهرسة)', c.adminKey || '', 'dir="ltr" type="password"')}${field('ix-al-index', 'الفهرس', c.index || 'ox_project', 'dir="ltr"')}</div>
            <div class="gh-row">${pbtn('fa-upload', 'فهرسة المشروع', 'app.ixAlgoliaIndex()')}${btn('fa-file-code', 'كود البحث لموقعك', 'app.ixAlgoliaCode()')}</div><div id="ix-al-res"></div>
            <div class="gh-row">${field('ix-al-q', 'بحث', '', `onkeydown="if(event.key==='Enter')app.ixAlgoliaSearch()"`)}${btn('fa-magnifying-glass', 'ابحث', 'app.ixAlgoliaSearch()')}</div><div id="ix-al-hits"></div>`, 'fa-magnifying-glass');
    };

    // ---------------------------------------------------------------- #995 Cloudinary
    P.ixCloudImages = function () { return [...this.virtualProjectFiles].filter(([p, f]) => f && /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(p) && (f.dataUrl || (typeof f.content === 'string' && /\.svg$/i.test(p)))).map(([p]) => p); };
    P.ixCloudUpload = async function (paths) {
        const c = this.ixSaveForm('cloudinary', { cloud: 'ix-cl-cloud', preset: 'ix-cl-preset', folder: 'ix-cl-folder' }, { toast: false });
        if (!c.cloud || !c.preset) { this.showToast('أدخل Cloud name و Upload preset (unsigned)', 'warning'); return null; }
        paths = paths || this.ixCloudImages();
        if (!paths.length) { this.showToast('لا توجد صور في المشروع', 'info'); return {}; }
        const map = { ...(this.ixCfg('cloudinary').map || {}) };
        for (let i = 0; i < paths.length; i++) {
            const p = paths[i], f = this.virtualProjectFiles.get(p);
            this.ixBusy('ix-cl-res', `${i + 1}/${paths.length} ${esc(p)}`);
            const fd = new FormData();
            fd.append('file', f.dataUrl || ('data:image/svg+xml;base64,' + bytesToB64(new TextEncoder().encode(f.content))));
            fd.append('upload_preset', c.preset);
            if (c.folder) fd.append('folder', c.folder);
            fd.append('public_id', p.replace(/\.[^.]+$/, '').replace(/[^\w/-]/g, '_'));
            try { const r = await this.ixHttp(`https://api.cloudinary.com/v1_1/${encodeURIComponent(c.cloud)}/image/upload`, { method: 'POST', body: fd }); map[p] = cldUrl(c.cloud, r.public_id + (r.format ? '.' + r.format : '')); } catch (e) { this.ixErr(e, 'ix-cl-res'); break; }
        }
        this.ixSave('cloudinary', { map });
        this.ixCloudPaint();
        return map;
    };
    P.ixCloudRewrite = function () {
        const map = this.ixCfg('cloudinary').map || {};
        let files = 0, refs = 0;
        this.ixFiles(p => /\.(html?|css|md|jsx?|tsx?|vue|svelte)$/i.test(p)).forEach(([p, t]) => { const r = rewriteImageRefs(t, p, map); if (r.count) { this.writeProjectFile(p, r.text, 'cloudinary'); files++; refs += r.count; } });
        this.showToast(`✅ استُبدل ${refs} مرجع صورة في ${files} ملف بروابط Cloudinary (WebP/AVIF تلقائي)`, refs ? 'success' : 'info');
        return { files, refs };
    };
    P.ixCloudPaint = function () {
        const map = this.ixCfg('cloudinary').map || {};
        const t = { width: (document.getElementById('ix-cl-w') || {}).value, crop: (document.getElementById('ix-cl-crop') || {}).value, effect: (document.getElementById('ix-cl-fx') || {}).value };
        const c = this.ixCfg('cloudinary');
        this.ixOut('ix-cl-res', Object.keys(map).length ? `<div class="ix-grid">${Object.entries(map).slice(0, 24).map(([p, u]) => { const id = u.split('/upload/')[1].split('/').slice(1).join('/'); const url = cldUrl(c.cloud, id, t); return `<figure class="ix-thumb"><img loading="lazy" src="${esc(url)}" alt=""><figcaption dir="ltr" title="${esc(url)}" onclick="${call('copyText', url)}">${esc(p)}</figcaption></figure>`; }).join('')}</div>` : empty('لم تُرفع صور بعد'));
    };
    P.ixCloudinary = async function () {
        const c = this.ixCfg('cloudinary');
        this._ixMount = () => this.ixCloudPaint();
        return card('الصور عبر Cloudinary', `<p class="hv-dim">ارفع صور المشروع إلى CDN عالمي برفع غير موقّع (unsigned preset، فلا تحتاج المفتاح السري)، ثم استبدل المراجع المحلية بروابط محسّنة تلقائياً (جودة وصيغة تلقائيتان، وتغيير الحجم والقص والمؤثرات من الرابط نفسه).</p>
            <div class="gh-row">${field('ix-cl-cloud', 'Cloud name', c.cloud || '', 'dir="ltr"')}${field('ix-cl-preset', 'Upload preset (unsigned)', c.preset || '', 'dir="ltr"')}${field('ix-cl-folder', 'مجلد', c.folder || 'ox-alpha', 'dir="ltr"')}</div>
            <div class="gh-row">${pbtn('fa-cloud-arrow-up', `رفع صور المشروع (${this.ixCloudImages().length})`, 'app.ixCloudUpload()')}${btn('fa-right-left', 'استبدال المراجع في الكود', 'app.ixCloudRewrite()')}</div>
            <div class="gh-row">${field('ix-cl-w', 'العرض', '400', 'type="number" oninput="app.ixCloudPaint()"')}${select('ix-cl-crop', 'القص', [['', '—'], ['fill', 'fill'], ['fit', 'fit'], ['thumb', 'thumb'], ['scale', 'scale']], 'fill', 'onchange="app.ixCloudPaint()"')}${select('ix-cl-fx', 'مؤثر', [['', '—'], ['grayscale', 'رمادي'], ['sepia', 'سيبيا'], ['blur:300', 'ضبابي'], ['sharpen', 'حدة'], ['background_removal', 'إزالة الخلفية']], '', 'onchange="app.ixCloudPaint()"')}</div>
            <div id="ix-cl-res"></div>`, 'fa-cloud');
    };
}
