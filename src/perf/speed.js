/* Code splitting map (#821), predictive prefetch (#828), WebP/AVIF conversion (#823), Gzip/Brotli (#824),
   Web Worker for heavy files (#814). */
import { esc, call, card, empty, stats, table, btn, pbtn, fmtBytes, fmtMs, textFiles, download, select, win, extOf, kindOf, mimeOf } from './util.js';

// ------------------------------------------------------------------ PURE
/** assets/studio/manifest.json → { entries:[{name,file,size,gzip,br,loaded}], totals } */
export function chunkReport(manifest, loaded = []) {
    const files = (manifest && manifest.files) || [], chunks = (manifest && manifest.chunks) || {};
    const byFile = new Map(files.map(f => [f.name, f]));
    const entries = Object.entries(chunks).filter(([k, v]) => k !== 'shared' && typeof v === 'string').map(([name, file]) => ({ ...(byFile.get(file) || {}), name, file, loaded: loaded.includes(name) }));
    const sum = (k) => files.reduce((n, f) => n + (f[k] || 0), 0);
    return { entries: entries.sort((a, b) => (b.gzip || 0) - (a.gzip || 0)), totals: { files: files.length, size: sum('size'), gzip: sum('gzip'), br: sum('br') } };
}
/** Which output format is smaller for an image (bytes per format) → best */
export const bestFormat = (sizes) => Object.entries(sizes || {}).filter(([, n]) => n > 0).sort((a, b) => a[1] - b[1])[0] || null;
export const savings = (before, after) => (before ? Math.round((1 - after / before) * 100) : 0);
/** nginx / Caddy snippets that serve the precompressed .br/.gz files from `node build.js --precompress`. */
export function precompressConfig(kind = 'nginx') {
    if (kind === 'caddy') return `:8080 {\n\troot * /srv/ox-alpha\n\tencode zstd gzip\n\tfile_server {\n\t\tprecompressed br gzip\n\t}\n\ttry_files {path} /index.html\n\t@assets path /assets/*\n\theader @assets Cache-Control "public, max-age=31536000, immutable"\n}\n`;
    if (kind === 'apache') return `# .htaccess — serve .br / .gz when the browser accepts them\nRewriteEngine On\nRewriteCond %{HTTP:Accept-Encoding} br\nRewriteCond %{REQUEST_FILENAME}.br -f\nRewriteRule ^(.*)$ $1.br [L]\nRewriteCond %{HTTP:Accept-Encoding} gzip\nRewriteCond %{REQUEST_FILENAME}.gz -f\nRewriteRule ^(.*)$ $1.gz [L]\n<FilesMatch "\\.(html|mjs|js|json)\\.br$">\n  Header set Content-Encoding br\n</FilesMatch>\n<FilesMatch "\\.(html|mjs|js|json)\\.gz$">\n  Header set Content-Encoding gzip\n</FilesMatch>\n`;
    return `# nginx — needs ngx_brotli for brotli_static\nserver {\n    listen 8080;\n    root /srv/ox-alpha;\n    gzip_static on;\n    brotli_static on;\n    location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }\n    location = /sw.js { add_header Cache-Control "no-cache"; }\n    location / { try_files $uri /index.html; }\n}\n`;
}

/** Inline twin of workers/heavy.js (used when Workers are unavailable). */
export async function heavyInline(type, data = {}) {
    if (type === 'hash') {
        const out = [];
        for (const f of data.files || []) {
            const buf = await win().crypto.subtle.digest('SHA-256', new TextEncoder().encode(f.content || ''));
            out.push({ path: f.path, sha256: Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''), bytes: (f.content || '').length });
        }
        return out;
    }
    if (type === 'search') {
        const re = data.regex ? new RegExp(data.query, data.caseSensitive ? 'g' : 'gi') : null, q = data.caseSensitive ? data.query : String(data.query || '').toLowerCase(), hits = [];
        for (const f of data.files || []) String(f.content || '').split('\n').forEach((line, n) => {
            const ok = re ? (re.lastIndex = 0, re.test(line)) : (data.caseSensitive ? line : line.toLowerCase()).includes(q);
            if (ok && hits.length < (data.limit || 500)) hits.push({ path: f.path, line: n + 1, text: line.slice(0, 200) });
        });
        return hits;
    }
    if (type === 'stats') {
        let lines = 0, chars = 0, blank = 0; const byExt = {};
        for (const f of data.files || []) { const ls = String(f.content || '').split('\n'), e = extOf(f.path); lines += ls.length; chars += (f.content || '').length; blank += ls.filter(l => !l.trim()).length; byExt[e] = (byExt[e] || 0) + ls.length; }
        return { files: (data.files || []).length, lines, chars, blank, byExt };
    }
    if (type === 'json') { const o = JSON.parse(data.text); return data.minify ? JSON.stringify(o) : JSON.stringify(o, null, data.indent || 2); }
    if (type === 'gzip') {
        const CS = win().CompressionStream || globalThis.CompressionStream;
        if (!CS) return { raw: (data.text || '').length, gzip: null };
        const cs = new CS('gzip'), w = cs.writable.getWriter(); w.write(new TextEncoder().encode(data.text || '')); w.close();
        const ab = await new Response(cs.readable).arrayBuffer();
        return { raw: (data.text || '').length, gzip: ab.byteLength };
    }
    if (type === 'bench') {
        const res = {};
        for (const key of ['a', 'b']) {
            if (!data[key]) continue;
            const fn = new Function('i', data[key]); // eslint-disable-line no-new-func — page CSP blocks this; the worker path is the real one
            const n = data.iterations || 10000, run = () => { const t = performance.now(); for (let k = 0; k < n; k++) fn(k); return performance.now() - t; };
            run(); const times = []; for (let r = 0; r < (data.rounds || 5); r++) times.push(run());
            times.sort((x, y) => x - y); const med = times[Math.floor(times.length / 2)];
            res[key] = { ms: med, opsPerSec: Math.round(n / (med / 1000 || 1e-9)), times };
        }
        return res;
    }
    throw new Error('unknown task ' + type);
}

export function installSpeed(P) {
    // ------------------------------------------------------------------ CODE SPLITTING (#821)
    P.pfManifest = async function () {
        if (this._pfChunkManifest) return this._pfChunkManifest;
        const r = await fetch('assets/studio/manifest.json', { cache: 'force-cache' });
        if (!r.ok) throw new Error('تعذر قراءة assets/studio/manifest.json');
        return (this._pfChunkManifest = await r.json());
    };
    P.pfChunks = async function () {
        let m = null; try { m = await this.pfManifest(); } catch (e) { m = { chunks: (win().OX_BUILD || {}).chunks || {}, files: [] }; }
        const rep = chunkReport(m, Object.keys(this._chunks || {}));
        const mods = ((win().OX_BUILD || {}).modules || []).filter(x => !x.lazy), main = mods.reduce((n, x) => n + x.size, 0);
        return card('الحزمة الرئيسية مقابل الأجزاء الكسولة', stats([['الحزمة الرئيسية (خام)', fmtBytes(main)], ['أجزاء كسولة', rep.totals.files], ['مجموع الأجزاء gzip', fmtBytes(rep.totals.gzip)], ['مجموع الأجزاء brotli', rep.totals.br ? fmtBytes(rep.totals.br) : '—']])
                + '<p class="gh-muted">كل ميزة كبيرة في جزء منفصل لا يُحمَّل إلا عند أول استعمال. قائمة الملفات الكاملة لم تعد داخل index.html (وفّر ~3KB gzip من كل تحميل).</p>', 'fa-cubes')
            + card('الأجزاء الرئيسية', table(['الجزء', 'خام', 'gzip', 'brotli', 'الحالة'], rep.entries.map(e => [`<b>${esc(e.name)}</b><br><small dir="ltr">${esc(e.file)}</small>`, e.size ? fmtBytes(e.size) : '—', e.gzip ? fmtBytes(e.gzip) : '—', e.br ? fmtBytes(e.br) : '—', e.loaded ? '🟢 محمّل' : '⚪ لم يُحمّل']))
                + `<div class="gh-row">${btn('fa-download', 'حمّل الكل الآن (للعمل دون اتصال)', call('pfWarmAll'))}</div>`, 'fa-puzzle-piece')
            + card('وحدات الحزمة الرئيسية', table(['الوحدة', 'الحجم'], mods.slice().sort((a, b) => b.size - a.size).slice(0, 12).map(x => [esc(x.name), fmtBytes(x.size)])), 'fa-box');
    };
    P.pfWarmAll = async function () {
        const names = Object.keys((win().OX_BUILD || {}).chunks || {}).filter(k => k !== 'shared' && k !== 'studio');
        let ok = 0;
        for (const n of names) { try { await this.loadChunk(n); ok++; } catch (e) { /* offline */ } }
        this.showToast(`✅ تم تحميل ${ok}/${names.length} جزء — متاحة الآن دون اتصال`, 'success');
        if (this._pfx && this._pfx.sec === 'chunks') this.pfRefresh();
        return ok;
    };

    // ------------------------------------------------------------------ PREDICTIVE PREFETCH (#828)
    P.pfPrefetchPanel = function () {
        const pred = this.pfPredictChunks ? this.pfPredictChunks(4) : [], on = this.settings.smartPrefetch !== false;
        const conn = navigator.connection || {};
        const pre = Array.from(document.querySelectorAll('link[rel="modulepreload"]')).map(l => l.getAttribute('href'));
        return card('التحميل المسبق الذكي', `<p>عند خمول المتصفح وعلى شبكة جيدة، يُحمَّل مسبقاً الجزء الذي تستعمله أكثر حتى يفتح فوراً (modulepreload). يتوقف تلقائياً مع توفير البيانات أو شبكة 2G.</p>
                <label class="fmx-check"><input type="checkbox" ${on ? 'checked' : ''} onchange="app.pfSet('smartPrefetch', this.checked)"> تفعيل</label>
                ${stats([['التوقع', pred.length ? pred.join('، ') : '— (استعمل الميزات أكثر)'], ['الشبكة', esc(conn.effectiveType || 'غير معروفة')], ['توفير البيانات', conn.saveData || (this.isDataSaver && this.isDataSaver()) ? 'مفعل' : 'لا'], ['محمّل مسبقاً', pre.length]])}
                <div class="gh-row">${pbtn('fa-bolt', 'حمّل المتوقع الآن', call('pfPrefetchNow'))}</div>`, 'fa-forward-fast')
            + card('روابط modulepreload الحالية', pre.length ? `<ul dir="ltr">${pre.map(p => `<li><code>${esc(p)}</code></li>`).join('')}</ul>` : empty('لا شيء بعد'), 'fa-link');
    };
    P.pfPrefetchNow = function () { const d = this.pfPrefetch(this.pfPredictChunks(4).length ? this.pfPredictChunks(4) : ['ui', 'ai']); this.showToast(d.length ? '⚡ تحميل مسبق: ' + d.join('، ') : 'لا جديد للتحميل (أو الشبكة/توفير البيانات تمنع)', 'info'); this.pfRefresh(); return d; };

    // ------------------------------------------------------------------ WebP / AVIF (#823)
    P.pfEncodeSupport = function () {
        const c = document.createElement('canvas'); c.width = c.height = 2;
        const t = (m) => { try { return String(c.toDataURL(m)).startsWith('data:' + m); } catch (e) { return false; } };
        return { webp: t('image/webp'), avif: t('image/avif') };
    };
    P.pfProjectImages = function () {
        return Array.from(this.virtualProjectFiles || []).filter(([p, f]) => f && f.dataUrl && /^(png|jpe?g|gif|bmp|webp)$/i.test(extOf(p))).map(([p, f]) => ({ path: p, bytes: Math.round((f.dataUrl.length - f.dataUrl.indexOf(',') - 1) * 0.75) }));
    };
    P.pfImages = function () {
        const sup = this.pfEncodeSupport(), imgs = this.pfProjectImages();
        return card('التحويل', `${stats([['WebP', sup.webp ? '✅ مدعوم' : '❌'], ['AVIF', sup.avif ? '✅ مدعوم' : '❌ (المتصفح لا يرمّز AVIF)'], ['صور المشروع', imgs.length]])}
                <div class="fmx-grid2">${select('pfx-img-fmt', 'الصيغة', [['image/webp', 'WebP'], ...(sup.avif ? [['image/avif', 'AVIF']] : []), ['auto', 'الأصغر تلقائياً']], 'auto')}${select('pfx-img-q', 'الجودة', [['0.9', '90%'], ['0.8', '80% (موصى به)'], ['0.7', '70%'], ['0.6', '60%']], '0.8')}</div>
                <label class="fmx-check"><input type="checkbox" ${this.settings.imgFormat !== 'jpeg' ? 'checked' : ''} onchange="app.pfSet('imgFormat', this.checked ? 'webp' : 'jpeg')"> إرسال الصور المرفقة للنموذج بصيغة WebP (أصغر بـ 25-35%)</label>
                <div class="gh-row"><input id="pfx-img-file" type="file" accept="image/*" multiple class="form-input-box">${pbtn('fa-arrows-rotate', 'حوّل الملفات المختارة', call('pfConvertPicked'))}</div>`, 'fa-image')
            + card('صور المشروع', imgs.length ? table(['الملف', 'الحجم', ''], imgs.map(i => [`<code>${esc(i.path)}</code>`, fmtBytes(i.bytes), btn('fa-arrows-rotate', 'حوّل', call('pfConvertProjectImage', i.path))]))
                + `<div class="gh-row">${pbtn('fa-wand-magic-sparkles', 'حوّل الكل', call('pfConvertAllProject'))}</div>` : empty('لا صور في المشروع'), 'fa-images')
            + '<div id="pfx-img-out"></div>';
    };
    /** Encode one image (data URL) → { best: {type, dataUrl, bytes}, sizes } */
    P.pfEncodeImage = async function (dataUrl, { type = 'auto', quality = 0.8 } = {}) {
        const img = await this.loadImageElement(dataUrl);
        const c = document.createElement('canvas'); c.width = img.naturalWidth || img.width || 1; c.height = img.naturalHeight || img.height || 1;
        const ctx = c.getContext('2d'); if (!ctx) throw new Error('canvas غير متاح');
        ctx.drawImage(img, 0, 0);
        const sup = this.pfEncodeSupport(), types = type === 'auto' ? ['image/webp', ...(sup.avif ? ['image/avif'] : [])] : [type];
        const sizes = {}, outs = {};
        for (const t of types) { const u = c.toDataURL(t, quality); if (u.startsWith('data:' + t)) { outs[t] = u; sizes[t] = Math.round((u.length - u.indexOf(',') - 1) * 0.75); } }
        const b = bestFormat(sizes);
        if (!b) throw new Error('المتصفح لا يدعم ترميز هذه الصيغة');
        return { best: { type: b[0], dataUrl: outs[b[0]], bytes: b[1] }, sizes, before: Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75) };
    };
    P.pfConvertProjectImage = async function (path, { quiet = false } = {}) {
        const f = this.virtualProjectFiles.get(path); if (!f || !f.dataUrl) return null;
        const r = await this.pfEncodeImage(f.dataUrl, { type: document.getElementById('pfx-img-fmt') ? document.getElementById('pfx-img-fmt').value : 'auto', quality: +(document.getElementById('pfx-img-q') || {}).value || 0.8 });
        if (r.best.bytes >= r.before) { if (!quiet) this.showToast(`${path}: الأصل أصغر بالفعل`, 'info'); return { path, skipped: true, ...r }; }
        const ext = r.best.type === 'image/avif' ? 'avif' : 'webp', np = path.replace(/\.[^./]+$/, '.' + ext);
        this._writeReason = 'import';
        try { this.virtualProjectFiles.set(np, { ...f, dataUrl: r.best.dataUrl, mime: r.best.type, size: r.best.bytes, updatedAt: Date.now() }); } finally { this._writeReason = null; }
        if (!quiet) { this.showToast(`✅ ${np} — وفّرت ${savings(r.before, r.best.bytes)}%`, 'success'); this.pfRefresh(); }
        return { path, out: np, ...r };
    };
    P.pfConvertAllProject = async function () {
        const res = [];
        for (const i of this.pfProjectImages()) { try { res.push(await this.pfConvertProjectImage(i.path, { quiet: true })); } catch (e) { res.push({ path: i.path, error: e.message }); } }
        const done = res.filter(r => r && r.out), before = done.reduce((n, r) => n + r.before, 0), after = done.reduce((n, r) => n + r.best.bytes, 0);
        this.showToast(`✅ حُوّلت ${done.length} صورة — وفّرت ${fmtBytes(before - after)} (${savings(before, after)}%)`, 'success');
        if (this.saveProjectNow) try { this.saveProjectNow(); } catch (e) {}
        this.pfRefresh();
        return res;
    };
    P.pfConvertPicked = async function () {
        const el = document.getElementById('pfx-img-file'), files = el && el.files ? Array.from(el.files) : [];
        if (!files.length) return this.showToast('اختر صوراً أولاً', 'warning');
        const out = [];
        for (const f of files) {
            const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
            try { const r = await this.pfEncodeImage(url, { type: (document.getElementById('pfx-img-fmt') || {}).value || 'auto', quality: +(document.getElementById('pfx-img-q') || {}).value || 0.8 }); out.push({ name: f.name, ...r }); } catch (e) { out.push({ name: f.name, error: e.message }); }
        }
        const el2 = document.getElementById('pfx-img-out');
        if (el2) el2.innerHTML = card('النتيجة', table(['الملف', 'قبل', 'بعد', 'التوفير', ''], out.map((r, i) => r.error ? [esc(r.name), '—', '—', esc(r.error), ''] : [esc(r.name), fmtBytes(r.before), fmtBytes(r.best.bytes), savings(r.before, r.best.bytes) + '%', btn('fa-download', '', call('pfDownloadConverted', i))])), 'fa-check');
        this._pfConverted = out;
        return out;
    };
    P.pfDownloadConverted = function (i) {
        const r = (this._pfConverted || [])[i]; if (!r || !r.best) return false;
        const a = document.createElement('a'); a.href = r.best.dataUrl; a.download = r.name.replace(/\.[^.]+$/, '') + (r.best.type === 'image/avif' ? '.avif' : '.webp'); a.click();
        return true;
    };

    // ------------------------------------------------------------------ GZIP / BROTLI (#824)
    P.pfCompressReport = async function () {
        let html = '';
        try { const r = await fetch('/index.html', { cache: 'force-cache' }); if (r.ok) html = await r.text(); } catch (e) { /* offline */ }
        const files = textFiles(this.virtualProjectFiles).slice(0, 200), text = files.map(([, f]) => f.content).join('\n');
        const page = html ? await this.pfHeavy('gzip', { text: html }) : null, proj = text ? await this.pfHeavy('gzip', { text }) : null;
        let m = null; try { m = await this.pfManifest(); } catch (e) {}
        const tot = m ? chunkReport(m).totals : null;
        return { page, proj, tot };
    };
    P.pfCompress = async function () {
        const r = await this.pfCompressReport();
        return card('القياس', stats([['index.html خام', r.page ? fmtBytes(r.page.raw) : '—'], ['index.html gzip', r.page && r.page.gzip ? fmtBytes(r.page.gzip) : '—'], ['الأجزاء gzip', r.tot ? fmtBytes(r.tot.gzip) : '—'], ['الأجزاء brotli', r.tot && r.tot.br ? fmtBytes(r.tot.br) : '—'], ['ملفات مشروعك خام', r.proj ? fmtBytes(r.proj.raw) : '—'], ['مشروعك gzip', r.proj && r.proj.gzip ? fmtBytes(r.proj.gzip) : '—']])
                + '<p class="gh-muted">Vercel يضغط تلقائياً (Brotli أولاً ثم Gzip). للخوادم الثابتة (Termux / nginx / Apache) استعمل <code>node build.js --minify --precompress</code> لتوليد ملفات .br و .gz جاهزة مع الإعداد أدناه.</p>', 'fa-file-zipper')
            + card('إعداد الخادم', `<div class="gh-row">${['nginx', 'caddy', 'apache'].map(k => btn('fa-file-code', k, call('pfShowServerConfig', k))).join('')}</div><pre id="pfx-srv" class="pfx-pre" dir="ltr">${esc(precompressConfig('nginx'))}</pre>
                <div class="gh-row">${btn('fa-copy', 'نسخ', call('pfCopyServerConfig'))}${btn('fa-file-circle-plus', 'أضف إلى المشروع', call('pfAddServerConfig'))}</div>`, 'fa-server');
    };
    P.pfShowServerConfig = function (k) { this._pfSrv = k; const el = document.getElementById('pfx-srv'); if (el) el.textContent = precompressConfig(k); return precompressConfig(k); };
    P.pfCopyServerConfig = function () { const t = precompressConfig(this._pfSrv || 'nginx'); if (this.copyText) this.copyText(t, 'تم النسخ'); return t; };
    P.pfAddServerConfig = function () {
        const k = this._pfSrv || 'nginx', path = { nginx: 'deploy/nginx.conf', caddy: 'deploy/Caddyfile', apache: 'deploy/.htaccess' }[k];
        this.writeProjectFile(path, precompressConfig(k), 'template');
        this.showToast('✅ أُضيف ' + path, 'success');
        return path;
    };

    // ------------------------------------------------------------------ WEB WORKER (#814)
    /** Run a heavy task in workers/heavy.js (falls back to the same code inline). */
    P.pfHeavy = function (type, data) {
        const W = win();
        if (!W.Worker || this._pfNoWorker) return heavyInline(type, data);
        if (!this._pfWorker) {
            try { this._pfWorker = new W.Worker('/workers/heavy.js'); this._pfJobs = new Map(); this._pfJobId = 0; } catch (e) { this._pfNoWorker = true; return heavyInline(type, data); }
            this._pfWorker.onmessage = (e) => { const j = this._pfJobs.get(e.data.id); if (!j) return; this._pfJobs.delete(e.data.id); e.data.error ? j.reject(new Error(e.data.error)) : j.resolve(e.data.result); };
            this._pfWorker.onerror = () => { this._pfNoWorker = true; this._pfJobs.forEach(j => j.fallback()); this._pfJobs.clear(); this._pfWorker = null; };
        }
        return new Promise((resolve, reject) => {
            const id = ++this._pfJobId;
            this._pfJobs.set(id, { resolve, reject, fallback: () => heavyInline(type, data).then(resolve, reject) });
            this._pfWorker.postMessage({ id, type, data });
        });
    };
    P.pfWorkerPanel = function () {
        const n = textFiles(this.virtualProjectFiles).length;
        return card('معالجة الملفات الثقيلة خارج الواجهة', `<p>العمليات التالية تعمل في <b>Web Worker</b> (<code>workers/heavy.js</code>) فلا تتجمد الواجهة مهما كبر المشروع (${n} ملف نصي).</p>
                <div class="gh-row">${btn('fa-fingerprint', 'بصمات SHA-256 لكل الملفات', call('pfWorkerRun', 'hash'))}${btn('fa-chart-simple', 'إحصاءات المشروع', call('pfWorkerRun', 'stats'))}</div>
                <div class="gh-row"><input id="pfx-wq" class="form-input-box" placeholder="بحث (نص أو regex)"><label class="fmx-check"><input id="pfx-wre" type="checkbox"> regex</label>${btn('fa-magnifying-glass', 'ابحث في كل الملفات', call('pfWorkerRun', 'search'))}</div>
                <div id="pfx-wout"></div>`, 'fa-gears');
    };
    P.pfWorkerRun = async function (type) {
        const files = textFiles(this.virtualProjectFiles).map(([path, f]) => ({ path, content: f.content }));
        const data = { files, query: (document.getElementById('pfx-wq') || {}).value || '', regex: !!(document.getElementById('pfx-wre') || {}).checked };
        if (type === 'search' && !data.query) return this.showToast('اكتب عبارة البحث', 'warning');
        this.pfBusy('pfx-wout', 'يعمل في الخلفية…');
        const t = performance.now();
        try {
            const r = await this.pfHeavy(type, data), ms = performance.now() - t;
            const html = type === 'hash' ? table(['الملف', 'SHA-256', 'الحجم'], r.map(x => [`<code>${esc(x.path)}</code>`, `<small dir="ltr">${x.sha256.slice(0, 16)}…</small>`, fmtBytes(x.bytes)]))
                : type === 'stats' ? stats([['ملفات', r.files], ['أسطر', r.lines.toLocaleString('en')], ['أسطر فارغة', r.blank], ['أحرف', r.chars.toLocaleString('en')]]) + table(['الامتداد', 'أسطر'], Object.entries(r.byExt).sort((a, b) => b[1] - a[1]).map(([e, n]) => [esc(e || '—'), n]))
                    : r.length ? table(['الملف', 'سطر', 'النص'], r.slice(0, 100).map(h => [`<code>${esc(h.path)}</code>`, h.line, `<code>${esc(h.text)}</code>`])) : empty('لا نتائج');
            const el = document.getElementById('pfx-wout'); if (el) el.innerHTML = `<p class="gh-muted">⏱ ${fmtMs(ms)} ${this._pfWorker ? '(Worker)' : '(مباشر)'}</p>` + html;
            return r;
        } catch (e) { return this.pfErr(e, 'pfx-wout'); }
    };
}
