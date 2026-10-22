/* Testing tab: #164 coverage • #165 E2E • #166 snapshots • #167 mutation • #168 performance tests. */
import { esc, card, pbtn, btn, empty, setHTML, stats, table, pre, call, extOf, baseName, lsGet, lsSet, fmtMs, download, sparkline, ago } from './util.js';
import { instrumentCoverage, coverageExt, coverageSummary, toLcov, generateMutants, applyMutant, mutationScore } from './instrument.js';
import { e2eExt, e2eOps, E2E_SAMPLE } from './e2e.js';

const capWriter = (sink = []) => ({ lines: sink, line(level, text) { sink.push({ level: level || 'log', text: String(text) }); }, html(cls, h) { sink.push({ level: cls, text: String(h).replace(/<[^>]+>/g, '') }); }, clear() { sink.length = 0; }, text() { return sink.map(l => l.text).join('\n'); } });
const JS_SRC = /\.(m?[jt]sx?|cjs|mts|cts|arjs)$/;
const isTest = (p) => /(^|\/)__tests__\/|[._-](test|spec)\.(m|c)?[jt]sx?$/.test(p);
const pctCls = (n) => (n >= 80 ? 'good' : n >= 50 ? 'mid' : 'bad');
const pbar = (n) => `<span class="dvx-pbar ${pctCls(n)}"><i style="width:${Math.max(0, Math.min(100, n))}%"></i></span> <b>${n}%</b>`;
const BENCH_KEY = 'ox_dv_bench_v1';
const extSrc = (fn) => '(' + fn.toString() + ')';
export const SNAPSHOT_SAMPLE = `// اختبارات اللقطات: أول تشغيل يحفظ اللقطة في __snapshots__/ ، والتشغيلات التالية تقارن بها
function render(user) {
  return { title: 'مرحباً ' + user.name, items: user.roles.map(r => r.toUpperCase()) };
}

test('عرض المستخدم', () => {
  expect(render({ name: 'سارة', roles: ['admin', 'dev'] })).toMatchSnapshot();
});

test('لقطة مضمّنة', () => {
  expect(1 + 1).toMatchInlineSnapshot(\`2\`);
});
`;
export const BENCH_SAMPLE = `// اختبارات الأداء: bench(name, fn, { time }) تقيس متوسط الزمن وعدد العمليات في الثانية
const data = Array.from({ length: 2000 }, (_, i) => i);

bench('for loop', () => {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i];
});

bench('reduce', () => {
  data.reduce((a, b) => a + b, 0);
});

bench('JSON roundtrip', () => {
  JSON.parse(JSON.stringify({ a: 1, list: data.slice(0, 50) }));
}, { time: 200 });
`;

/** Merge per-file summaries into totals. */
export function coverageTotals(files) {
    const t = { statements: [0, 0], branches: [0, 0], functions: [0, 0], lines: [0, 0] };
    Object.values(files).forEach(({ meta, hits }) => {
        const s = coverageSummary(meta, hits);
        ['statements', 'branches', 'functions', 'lines'].forEach(k => { t[k][0] += s[k].hit; t[k][1] += s[k].total; });
    });
    const pc = ([c, n]) => (n ? Math.round(c / n * 1000) / 10 : 100);
    return { statements: pc(t.statements), branches: pc(t.branches), functions: pc(t.functions), lines: pc(t.lines), raw: t };
}
/** Compare a bench run with the previous one for the same name → { delta%, regression }. */
export function benchCompare(prev, cur, threshold = 10) {
    if (!prev || !cur || !prev.mean) return { delta: null, regression: false };
    const delta = Math.round((cur.mean - prev.mean) / prev.mean * 1000) / 10;
    return { delta, regression: delta > threshold, improvement: delta < -threshold };
}
/** Resolve a page.goto URL against the project (→ html path or null). */
export function resolvePage(url, current, has, fallback) {
    let u = String(url || '/').replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0];
    if (u === '' || u === '/') return fallback || null;
    let base;
    if (u.startsWith('/')) base = u.slice(1);
    else { const dir = String(current || '').replace(/^\//, '').split('/').slice(0, -1); u.split('/').forEach(s => { if (s === '..') dir.pop(); else if (s && s !== '.') dir.push(s); }); base = dir.join('/'); }
    const cands = base.endsWith('/') || base === '' ? [base + 'index.html'] : [base, base + '.html', base + '/index.html'];
    return cands.find(has) || null;
}

export function installTest(P) {
    // ---------------------------------------------------------------- shared
    P.dvTestFiles = function (kind = 'unit') {
        const all = this.dvTextFiles(p => JS_SRC.test(p) && !/node_modules\//.test(p));
        const e2e = ([p, c]) => /['"]@playwright\/test['"]|['"]playwright['"]/.test(c) || /\.e2e\.[jt]s$/.test(p);
        if (kind === 'e2e') return all.filter(e2e).map(f => f[0]);
        if (kind === 'bench') return all.filter(([, c]) => /(^|[^.\w])bench\s*\(/.test(c)).map(f => f[0]);
        return all.filter(f => isTest(f[0]) && !e2e(f)).map(f => f[0]);
    };
    /** Run test files silently; returns { res, results, summary, lines }. */
    P.dvRunTests = async function (tests, { transform, extensions = [], onMessage, timeoutMs = 60000, writer, cfg } = {}) {
        if (!(await this.ensureRunner({ quiet: true }))) throw new Error('تعذر تحميل المشغل');
        const w = writer || capWriter();
        const env = this.getRunEnv ? await this.getRunEnv() : {};
        const base = this.runExtensions ? this.runExtensions({}) : [];
        const res = await this.runJS({ mode: 'test', tests, entry: tests[0], path: tests[0], writer: w, detached: true, timeoutMs, env, transform, extensions: [...base, ...extensions], onMessage, cfg });
        return { res, results: (res.tests && res.tests.results) || [], summary: res.tests && res.tests.summary, lines: w.lines || [] };
    };
    P.dvCreateSample = function (path, content) {
        const p = this.virtualProjectFiles.has(path) ? this.uniqueProjectPath(path) : path;
        this.createProjectFile(p, content, { open: false });
        this.showToast('✅ أُنشئ ' + this.escapeHTML(p), 'success');
        this.dvRefresh();
        return p;
    };
    const testList = (results) => (results.length ? `<div class="dvx-tests">${results.map(r => `<div class="dvx-t dvx-t-${r.status}"><span>${r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '○'}</span><div><b>${esc(r.name)}</b> <small class="hv-dim">${r.ms || 0}ms • ${esc(r.file || '')}</small>${r.error ? `<pre class="pfx-pre dvx-pre" dir="ltr">${esc(r.error.message)}${r.error.expected !== undefined ? `\nExpected: ${esc(r.error.expected)}\nReceived: ${esc(r.error.received)}` : ''}</pre>` : ''}</div></div>`).join('')}</div>` : '');
    P.dvTestListHTML = testList;

    // ---------------------------------------------------------------- #164 coverage
    P.dvCoverage = async function () {
        const tests = this.dvTestFiles('unit');
        const last = this._dvCov;
        this._dvMount = () => { if (last) this.dvCoveragePaint(last); };
        return card('تقرير التغطية', `<p class="hv-dim">يشغّل اختبارات الوحدة بعد حقن عدّادات في ملفات المصدر (عبارات، فروع، دوال، أسطر) ثم يعرض النسب ويُبرز الأسطر غير المغطاة. التصدير بصيغة LCOV متوافق مع Codecov و Coveralls.</p>
            <div class="gh-row">${pbtn('fa-play', `تشغيل مع التغطية (${tests.length} ملف اختبار)`, 'app.dvCoverageRun()', tests.length ? '' : 'disabled')}${last ? btn('fa-file-export', 'تصدير LCOV', 'app.dvCoverageExport()') + btn('fa-floppy-disk', 'حفظ coverage/lcov.info', 'app.dvCoverageExport(true)') : ''}</div>
            ${tests.length ? '' : empty('لا توجد ملفات اختبار (*.test.js / *.spec.ts / __tests__)')}
            <div id="dv-cov-res"></div><div id="dv-cov-file"></div>`, 'fa-chart-pie');
    };
    P.dvCoverageRun = async function (testsArg) {
        const tests = testsArg || this.dvTestFiles('unit');
        if (!tests.length) return null;
        this.dvBusy('dv-cov-res', 'تشغيل الاختبارات مع العدّادات…');
        const metas = {}, skipped = [];
        let hits = {};
        const transform = (code, path) => {
            if (isTest(path) || /node_modules\/|__snapshots__/.test(path) || !JS_SRC.test(path)) return code;
            try { const r = instrumentCoverage(code, path); metas[path] = r.meta; return r.code; } catch (e) { skipped.push(path); return code; }
        };
        try {
            const r = await this.dvRunTests(tests, { transform, extensions: [extSrc(coverageExt)], onMessage: (m) => { if (m.type === 'coverage') hits = m.data || {}; } });
            const files = {};
            Object.keys(metas).forEach(p => { files[p] = { meta: metas[p], hits: hits[p] || { s: {}, f: {}, b: {} } }; });
            const out = { at: Date.now(), files, totals: coverageTotals(files), summary: r.summary, results: r.results, skipped, error: r.res.success ? null : r.res.error };
            this._dvCov = out;
            this.dvCoveragePaint(out);
            return out;
        } catch (e) { return this.dvErr(e, 'dv-cov-res'); }
    };
    P.dvCoveragePaint = function (c) {
        const rows = Object.entries(c.files).map(([p, f]) => [p, coverageSummary(f.meta, f.hits)]).sort((a, b) => a[1].lines.pct - b[1].lines.pct);
        const t = c.totals;
        setHTML('dv-cov-res', stats([['العبارات', t.statements + '%'], ['الفروع', t.branches + '%'], ['الدوال', t.functions + '%'], ['الأسطر', t.lines + '%'], ['الاختبارات', c.summary ? `${c.summary.pass}/${c.summary.total}` : '—']])
            + (c.error ? empty('⚠ ' + esc(c.error), true) : '')
            + (rows.length ? table(['الملف', 'الأسطر', 'الفروع', 'الدوال', 'غير مغطاة'], rows.map(([p, s]) => [`<a href="#" onclick="${call('dvCoverageFile', p)};return false" dir="ltr">${esc(p)}</a>`, pbar(s.lines.pct), pbar(s.branches.pct), pbar(s.functions.pct), `<small dir="ltr">${s.uncoveredLines.slice(0, 12).join(', ')}${s.uncoveredLines.length > 12 ? '…' : ''}</small>`])) : empty('لم تُحمَّل أي ملفات مصدر أثناء الاختبارات'))
            + (c.skipped.length ? `<small class="hv-dim">تعذر حقن: ${c.skipped.map(esc).join(', ')}</small>` : ''));
    };
    P.dvCoverageFile = function (path) {
        const c = this._dvCov;
        const f = c && c.files[path];
        if (!f) return null;
        const s = coverageSummary(f.meta, f.hits);
        const src = this.dvRead(path) || '';
        const fnLines = new Set(s.uncoveredFunctions.map(x => x.line)), brLines = new Set(s.uncoveredBranches.map(x => x.line));
        const html = src.split('\n').map((l, i) => {
            const n = i + 1, h = s.lineHits[n];
            const cls = h == null ? '' : h > 0 ? 'dvx-cov-hit' : 'dvx-cov-miss';
            return `<div class="dvx-cl ${cls}${brLines.has(n) ? ' dvx-cov-br' : ''}"><span class="dvx-ln">${n}</span><span class="dvx-hits">${h == null ? '' : h + '×'}</span><code>${esc(l) || ' '}</code>${fnLines.has(n) ? '<span class="dvx-tag">ƒ لم تُستدعَ</span>' : ''}${brLines.has(n) ? '<span class="dvx-tag">فرع غير مغطى</span>' : ''}</div>`;
        }).join('');
        setHTML('dv-cov-file', card(`<span dir="ltr">${esc(path)}</span> — ${s.lines.pct}%`, `<div class="dvx-covsrc" dir="ltr">${html}</div>`, 'fa-file-code'));
        const el = document.getElementById('dv-cov-file');
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
        return s;
    };
    P.dvCoverageExport = function (save) {
        const c = this._dvCov;
        if (!c) return null;
        const lcov = toLcov(c.files);
        if (save) { this.writeProjectFile('coverage/lcov.info', lcov, 'coverage'); this.showToast('✅ حُفظ coverage/lcov.info', 'success'); }
        else download(this, 'lcov.info', lcov, 'text/plain');
        return lcov;
    };

    // ---------------------------------------------------------------- #165 E2E
    /** Called by runner.runJS for test runs that import @playwright/test. */
    P.dvE2EAttach = function (o) {
        const drv = this.dvE2EDriver || this._dvE2EDrv || (this._dvE2EDrv = this.dvE2EIframeDriver());
        const prev = o.onMessage;
        const exts = o.extensions || (this.runExtensions ? this.runExtensions(o) : []);
        const log = this._dvE2ELog = [];
        this._dvE2EFails = [];
        return {
            ...o, e2eAttached: true, extensions: [...exts, extSrc(e2eExt)], timeoutMs: Math.max(o.timeoutMs || 0, 180000),
            onMessage: async (m, handle) => {
                if (m.type === 'e2e-fail') { this._dvE2EFails.push(m); return prev ? prev(m, handle) : undefined; }
                if (m.type !== 'e2e') return prev ? prev(m, handle) : undefined;
                let res;
                try {
                    if (m.op === 'goto') res = { ok: true, value: await drv.goto(m.args.url) };
                    else if (m.op === 'reload') res = { ok: true, value: await drv.goto(drv.url) };
                    else if (m.op === 'viewport') res = { ok: true, value: drv.viewport ? await drv.viewport(m.args) : null };
                    else { const r = await drv.exec(m.op, m.args); res = r && r.ok ? { ok: true, value: r.value } : { ok: false, error: (r && r.error) || 'خطأ', code: r && r.code }; }
                } catch (e) { res = { ok: false, error: e.message || String(e), code: e.code }; }
                if (log.length < 2000) log.push({ op: m.op, args: m.op === 'page' ? undefined : m.args, ok: res.ok, error: res.error, t: Date.now() });
                handle.send({ type: 'e2e-res', id: m.id, ...res });
            }
        };
    };
    P.dvE2EResolve = function (url, current) {
        const has = (p) => this.virtualProjectFiles.has(p);
        const fallback = ['index.html', 'public/index.html', 'src/index.html'].find(has) || (this.previewTargetFor ? this.previewTargetFor(null) : null);
        return resolvePage(url, current, has, fallback);
    };
    /** Inject the E2E agent (ops + messaging) right after <head>. */
    P.dvE2EDoc = function (path, token) {
        const html = this.buildPreviewDoc(path, { bridge: false });
        const agent = `<script>(function(){var T=${JSON.stringify(token)};var ops=${e2eOps.toString()};var post=function(m){m.__oxE2E=T;try{parent.postMessage(m,'*')}catch(e){}};
['log','info','warn','error'].forEach(function(k){var o=console[k];console[k]=function(){try{post({log:{level:k,text:Array.prototype.map.call(arguments,function(x){try{return typeof x==='object'?JSON.stringify(x):String(x)}catch(e){return String(x)}}).join(' ')}})}catch(e){}return o.apply(console,arguments)}});
window.addEventListener('error',function(e){post({log:{level:'error',text:String(e.message||e)}})});
window.addEventListener('message',function(e){var d=e.data;if(!d||d.__oxE2E!==T||!d.id)return;var r;try{r={ok:true,value:ops(document,window,d.op,d.args||{})}}catch(err){r={ok:false,error:String(err&&err.message||err),code:err&&err.code}}post({id:d.id,res:r})});
document.addEventListener('click',function(e){if(e.defaultPrevented)return;var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href');if(!h||/^(#|javascript:|mailto:|tel:)/i.test(h)||a.target==='_blank')return;e.preventDefault();if(/^https?:/i.test(h))return;post({nav:h})});
document.addEventListener('submit',function(e){if(e.defaultPrevented)return;e.preventDefault();var f=e.target;var act=f.getAttribute('action');if(act&&!/^(https?:|#)/i.test(act))post({nav:act})});
if(document.readyState==='complete')post({ready:1});else window.addEventListener('load',function(){post({ready:1})});})();<\/script>`;
        if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + agent);
        if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + agent);
        return agent + html;
    };
    /** Default driver: a sandboxed iframe (shown in the E2E section when open, otherwise off-screen). */
    P.dvE2EIframeDriver = function () {
        const app = this;
        const token = 'e' + Math.random().toString(36).slice(2);
        let frame = null, seq = 0, readyRes = null, url = '/', path = null;
        const pending = new Map(), logs = [];
        const listener = (e) => {
            const d = e.data;
            if (!d || d.__oxE2E !== token || (frame && e.source && e.source !== frame.contentWindow)) return;
            if (d.ready) { if (readyRes) { readyRes(); readyRes = null; } }
            else if (d.nav) drv.goto(d.nav).catch((err) => logs.push({ level: 'error', text: err.message }));
            else if (d.log) { logs.push(d.log); if (logs.length > 500) logs.shift(); }
            else if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); p(d.res); }
        };
        window.addEventListener('message', listener);
        const ensureFrame = () => {
            const host = document.getElementById('dv-e2e-view');
            if (frame && frame.isConnected && (!host || frame.parentNode === host)) return frame;
            if (frame) frame.remove();
            frame = document.createElement('iframe');
            frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
            frame.className = 'dvx-e2e-frame';
            frame.title = 'E2E';
            if (host) host.appendChild(frame); else { frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:800px;border:0'; document.body.appendChild(frame); }
            return frame;
        };
        const drv = {
            logs,
            get url() { return url; },
            async goto(u) {
                const p = app.dvE2EResolve(u, path || '');
                if (!p) { const e = new Error('صفحة غير موجودة في المشروع: ' + u); throw e; }
                path = p;
                url = '/' + p;
                const f = ensureFrame();
                const ready = new Promise((r) => { readyRes = r; });
                f.srcdoc = app.dvE2EDoc(p, token);
                let to;
                await Promise.race([ready, new Promise((_, rej) => { to = setTimeout(() => rej(new Error('انتهت مهلة تحميل الصفحة ' + p)), 15000); })]);
                clearTimeout(to);
                return { url };
            },
            exec(op, args) {
                if (!frame || !frame.contentWindow) return Promise.resolve({ ok: false, error: 'استدعِ page.goto() أولاً' });
                return new Promise((res) => {
                    const id = ++seq;
                    pending.set(id, (r) => res(op === 'page' && r && r.ok ? { ...r, value: { ...r.value, url } } : r));
                    try { frame.contentWindow.postMessage({ __oxE2E: token, id, op, args }, '*'); } catch (e) { pending.delete(id); res({ ok: false, error: e.message, code: 'E_NOTFOUND' }); return; }
                    setTimeout(() => { if (pending.has(id)) { pending.delete(id); res({ ok: false, error: 'لا استجابة من الصفحة (قيد التحميل؟)', code: 'E_NOTFOUND' }); } }, 3000);
                });
            },
            viewport(v) { if (frame && v) { if (v.width) frame.style.width = v.width + 'px'; if (v.height) frame.style.height = v.height + 'px'; } return true; },
            dispose() { window.removeEventListener('message', listener); if (frame) frame.remove(); frame = null; }
        };
        return drv;
    };
    /** In-realm driver over a DOM document (used with jsdom in tests or a same-origin frame). */
    P.dvE2EDomDriver = function (makeDoc) {
        const app = this;
        let cur = null, url = '/', path = null;
        return {
            get url() { return url; },
            async goto(u) { const p = app.dvE2EResolve(u, path || ''); if (!p) throw new Error('صفحة غير موجودة في المشروع: ' + u); path = p; url = '/' + p; cur = await makeDoc(app.buildPreviewDoc(p, { bridge: false }), p); return { url }; },
            async exec(op, args) { if (!cur) return { ok: false, error: 'استدعِ page.goto() أولاً' }; try { const v = e2eOps(cur.document, cur.window, op, { ...args, url }); return { ok: true, value: v }; } catch (e) { return { ok: false, error: e.message, code: e.code }; } }
        };
    };
    P.dvE2E = async function () {
        const files = this.dvTestFiles('e2e');
        const last = this._dvE2ELast;
        this._dvMount = () => { if (last) this.dvE2EPaint(last); };
        return card('اختبارات طرف-لطرف (E2E)', `<p class="hv-dim">واجهة متوافقة مع Playwright تعمل داخل المتصفح: <code>page.goto / getByRole / getByText / locator / fill / click / press</code> والمطابقات <code>toHaveText / toBeVisible / toHaveURL / toHaveCount</code>… مع إعادة محاولة تلقائية حتى 5 ثوانٍ. الصفحات تُبنى من ملفات HTML في مشروعك داخل إطار معزول. <code>evaluate</code> غير متاح (سياسة الأمان).</p>
            <div class="gh-row">${pbtn('fa-play', `تشغيل (${files.length})`, 'app.dvE2ERun()', files.length ? '' : 'disabled')}${btn('fa-file-circle-plus', 'مثال e2e/home.spec.js', `app.dvCreateSample('e2e/home.spec.js', app.dvLib().E2E_SAMPLE)`)}</div>
            ${files.length ? `<div class="dvx-chips">${files.map(f => `<button class="gh-chip" onclick="${call('dvE2ERun', [f])}" dir="ltr">${esc(f)}</button>`).join('')}</div>` : empty('لا توجد اختبارات E2E — ملفات تستورد <code>@playwright/test</code>')}
            <div class="dvx-e2e"><div id="dv-e2e-view" class="dvx-e2e-view"></div><div id="dv-e2e-res"></div></div>`, 'fa-robot');
    };
    P.dvE2ERun = async function (filesArg) {
        const files = filesArg || this.dvTestFiles('e2e');
        if (!files.length) return null;
        this.dvBusy('dv-e2e-res', 'تشغيل اختبارات E2E…');
        if (this._dvE2EDrv && !this.dvE2EDriver) { try { this._dvE2EDrv.dispose(); } catch (e) { /* ignore */ } this._dvE2EDrv = null; }
        try {
            const t0 = Date.now();
            const r = await this.dvRunTests(files, { timeoutMs: 180000 });
            const out = { at: Date.now(), ms: Date.now() - t0, files, results: r.results, summary: r.summary, error: r.res.success ? null : r.res.error, fails: (this._dvE2EFails || []).slice(), log: (this._dvE2ELog || []).slice(-200), console: ((this._dvE2EDrv && this._dvE2EDrv.logs) || []).slice(-100) };
            this._dvE2ELast = out;
            this.dvE2EPaint(out);
            return out;
        } catch (e) { return this.dvErr(e, 'dv-e2e-res'); }
    };
    P.dvE2EPaint = function (o) {
        const s = o.summary || { pass: 0, fail: 0, total: 0 };
        setHTML('dv-e2e-res', stats([['نجح', s.pass], ['فشل', s.fail], ['الإجمالي', s.total], ['المدة', fmtMs(o.ms)]])
            + (o.error && !s.fail ? empty('⚠ ' + esc(o.error), true) : '')
            + testList(o.results)
            + (o.fails.length ? card('لقطات الفشل', o.fails.map((f, i) => `<details ${i === 0 ? 'open' : ''}><summary><b>${esc(f.test || '')}</b> <small dir="ltr">${esc(f.url || '')}</small></summary><iframe class="dvx-frame" sandbox="" srcdoc="${esc(f.html || '')}" title="لقطة"></iframe></details>`).join(''), 'fa-camera') : '')
            + (o.log.length ? `<details><summary>سجل العمليات (${o.log.length})</summary>${pre(o.log.map(l => `${l.ok ? '✓' : '✗'} ${l.op} ${l.args ? JSON.stringify(l.args).slice(0, 160) : ''}${l.error ? ' — ' + l.error : ''}`).join('\n'))}</details>` : '')
            + (o.console.length ? `<details><summary>طرفية الصفحة (${o.console.length})</summary>${pre(o.console.map(l => `[${l.level}] ${l.text}`).join('\n'))}</details>` : ''));
    };

    // ---------------------------------------------------------------- #166 snapshots
    P.dvSnapFiles = function () {
        return this.dvTextFiles(p => /__snapshots__\/.+\.snap$/.test(p)).map(([p, c]) => { let data = {}; try { data = JSON.parse(c); } catch (e) { data = null; } return { path: p, data, test: p.replace(/__snapshots__\//, '').replace(/\.snap$/, '') }; });
    };
    P.dvSnapshots = async function () {
        const snaps = this.dvSnapFiles();
        const tests = this.dvTestFiles('unit').filter(p => /toMatch(Inline)?Snapshot/.test(this.dvRead(p) || ''));
        const used = this._dvSnapUsed;
        const obsolete = used ? snaps.flatMap(s => Object.keys(s.data || {}).filter(k => !(used[s.test] || []).includes(k)).map(k => [s.path, k])) : [];
        const st = this._snapStats;
        return card('اختبارات اللقطات', `<p class="hv-dim"><code>expect(value).toMatchSnapshot()</code> يحفظ القيمة المنسّقة في <code>__snapshots__/*.snap</code> أول مرة، ثم يفشل الاختبار عند أي تغيير. <code>toMatchInlineSnapshot</code> يقارن بنص داخل الاختبار.</p>
            <div class="gh-row">${pbtn('fa-play', `تشغيل (${tests.length})`, 'app.dvSnapRun()', tests.length ? '' : 'disabled')}${btn('fa-arrows-rotate', 'تحديث اللقطات (-u)', 'app.dvSnapRun(true)', 'sidebar-btn-util gh-btn', tests.length ? '' : 'disabled')}${btn('fa-file-circle-plus', 'مثال', `app.dvCreateSample('snapshot.test.js', app.dvLib().SNAPSHOT_SAMPLE)`)}</div>
            ${st ? stats([['جديدة', st.new || 0], ['مطابقة', st.match || 0], ['محدّثة', st.updated || 0], ['فاشلة', st.fail || 0]]) : ''}
            <div id="dv-snap-res"></div>`, 'fa-camera-retro')
            + card(`ملفات اللقطات (${snaps.length})`, snaps.length ? snaps.map(s => `<details class="dvx-file"><summary><b dir="ltr">${esc(s.path)}</b> <span class="hv-dim">${s.data ? Object.keys(s.data).length : '⚠ JSON غير صالح'}</span> ${btn('fa-trash', '', call('dvSnapDelete', s.path), 'gh-chip', 'title="حذف"')}</summary>${s.data ? Object.entries(s.data).map(([k, v]) => `<div class="dvx-snap"><div class="dvx-snap-h"><b>${esc(k)}</b>${btn('fa-xmark', '', call('dvSnapDelete', s.path, k), 'gh-chip', 'title="حذف اللقطة"')}</div>${pre(v)}</div>`).join('') : ''}</details>`).join('') : empty('لا توجد لقطات محفوظة بعد'), 'fa-images')
            + (obsolete.length ? card(`لقطات قديمة غير مستخدمة (${obsolete.length})`, `${pre(obsolete.map(([p, k]) => p + ' › ' + k).join('\n'))}<div class="gh-row">${btn('fa-broom', 'حذف القديمة', 'app.dvSnapPrune()')}</div>`, 'fa-broom') : '');
    };
    P.dvSnapRun = async function (update) {
        const tests = this.dvTestFiles('unit').filter(p => /toMatch(Inline)?Snapshot/.test(this.dvRead(p) || ''));
        if (!tests.length) return null;
        this.dvBusy('dv-snap-res');
        this._snapStats = { new: 0, match: 0, updated: 0, fail: 0 };
        const used = {};
        this._updateSnapshots = !!update;
        try {
            const r = await this.dvRunTests(tests, { onMessage: (m) => { if (m.type === 'snapshot') this.recordSnapshot(m, null); if (m.type === 'snapshots-used') Object.entries(m.used || {}).forEach(([f, keys]) => { used[f] = (used[f] || []).concat(keys); }); } });
            this._dvSnapUsed = used;
            this._dvSnapLast = r;
            await this.dvRefresh();
            setHTML('dv-snap-res', testList(r.results));
            return r;
        } catch (e) { return this.dvErr(e, 'dv-snap-res'); } finally { this._updateSnapshots = false; }
    };
    P.dvSnapDelete = function (path, key) {
        if (key == null) { this.dvApply('حذف ملف لقطات', [[path, null]]); this.dvRefresh(); return true; }
        let data = {};
        try { data = JSON.parse(this.dvRead(path) || '{}'); } catch (e) { return false; }
        delete data[key];
        this.dvApply('حذف لقطة', [[path, Object.keys(data).length ? JSON.stringify(data, null, 2) + '\n' : null]]);
        this.dvRefresh();
        return true;
    };
    P.dvSnapPrune = function () {
        const used = this._dvSnapUsed || {};
        const changes = [];
        this.dvSnapFiles().forEach(s => {
            if (!s.data) return;
            const keep = {};
            Object.keys(s.data).forEach(k => { if ((used[s.test] || []).includes(k)) keep[k] = s.data[k]; });
            if (Object.keys(keep).length !== Object.keys(s.data).length) changes.push([s.path, Object.keys(keep).length ? JSON.stringify(keep, null, 2) + '\n' : null]);
        });
        if (changes.length) this.dvApply('تنظيف اللقطات', changes);
        this.showToast(`🧹 نُظّف ${changes.length} ملف`, 'success');
        this.dvRefresh();
        return changes.length;
    };

    // ---------------------------------------------------------------- #167 mutation
    P.dvMutation = async function () {
        const tests = this.dvTestFiles('unit');
        const srcs = this.dvTextFiles(p => JS_SRC.test(p) && !isTest(p) && !/node_modules\/|\.d\.ts$|\.config\./.test(p)).map(([p]) => p).filter(p => tests.some(t => (this.dvRead(t) || '').includes(baseName(p).replace(/\.[^.]+$/, ''))));
        const last = this._dvMut;
        this._dvMount = () => { if (last) this.dvMutationPaint(last); };
        return card('اختبار الطفرات', `<p class="hv-dim">يُدخل أخطاء صغيرة متعمَّدة في ملف المصدر (عكس المقارنات، تبديل && و ||، إرجاع undefined…) ويشغّل الاختبارات لكل طفرة. الطفرة «الناجية» تعني أن اختباراتك لا تكشف هذا الخطأ. النتيجة = نسبة الطفرات المقتولة.</p>
            ${srcs.length ? `<div class="gh-row"><label class="fmx-field"><span>ملف المصدر</span><select id="dv-mut-file" class="form-input-box" dir="ltr">${srcs.map(p => `<option ${last && last.path === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label><label class="fmx-field"><span>الحد الأقصى</span><select id="dv-mut-max" class="form-input-box"><option>10</option><option selected>25</option><option>50</option></select></label></div>
            <div class="gh-row">${pbtn('fa-dna', 'بدء', 'app.dvMutationRun()')}${btn('fa-stop', 'إيقاف', 'app._dvMutStop=true')}</div>` : empty('لا توجد ملفات مصدر مرتبطة باختبارات (يجب أن يذكر ملف الاختبار اسم الملف)')}
            <div id="dv-mut-res"></div>`, 'fa-dna');
    };
    P.dvMutationRun = async function (pathArg, maxArg) {
        const path = pathArg || (document.getElementById('dv-mut-file') || {}).value;
        const max = +(maxArg || (document.getElementById('dv-mut-max') || {}).value || 25);
        if (!path) return null;
        const stem = baseName(path).replace(/\.[^.]+$/, '');
        let tests = this.dvTestFiles('unit').filter(t => (this.dvRead(t) || '').includes(stem));
        if (!tests.length) tests = this.dvTestFiles('unit');
        if (!tests.length) return this.dvErr(new Error('لا توجد اختبارات'), 'dv-mut-res');
        this._dvMutStop = false;
        this.dvBusy('dv-mut-res', 'تشغيل الأساس…');
        let compiled = null;
        const base = await this.dvRunTests(tests, { transform: (code, p) => { if (p === path) compiled = code; return code; }, timeoutMs: 30000 });
        if (!base.res.success) return this.dvErr(new Error('يجب أن تنجح الاختبارات قبل اختبار الطفرات: ' + (base.res.error || '')), 'dv-mut-res');
        if (compiled == null) return this.dvErr(new Error('الاختبارات لا تستورد ' + path), 'dv-mut-res');
        let mutants;
        try { mutants = generateMutants(compiled, { max }); } catch (e) { return this.dvErr(new Error('تعذر تحليل الملف: ' + e.message), 'dv-mut-res'); }
        const baseMs = Math.max(500, base.summary ? base.summary.ms : 1000);
        const results = [];
        const out = { path, at: Date.now(), results, total: mutants.length, done: false };
        this._dvMut = out;
        for (const m of mutants) {
            if (this._dvMutStop) break;
            const mutated = applyMutant(compiled, m);
            let status;
            try {
                const r = await this.dvRunTests(tests, { transform: (code, p) => (p === path ? mutated : code), timeoutMs: Math.min(20000, baseMs * 5 + 2000) });
                status = r.res.error === 'Timeout' ? 'timeout' : /SyntaxError|خطأ في الصياغة/.test(r.res.error || '') ? 'error' : (r.summary && r.summary.fail) || !r.res.success ? 'killed' : 'survived';
                const killer = r.results.find(x => x.status === 'fail');
                results.push({ ...m, status, killer: killer ? killer.name : null });
            } catch (e) { results.push({ ...m, status: 'error', killer: e.message }); }
            this.dvMutationPaint(out);
        }
        out.done = true;
        this.dvMutationPaint(out);
        return out;
    };
    P.dvMutationPaint = function (o) {
        const sc = mutationScore(o.results);
        const surv = o.results.filter(r => r.status === 'survived');
        setHTML('dv-mut-res', stats([['النتيجة', sc.score + '%'], ['مقتولة', sc.killed], ['ناجية', sc.survived], ['التقدم', `${o.results.length}/${o.total}`]])
            + `<div class="dvx-pbar ${pctCls(sc.score)} dvx-wide"><i style="width:${sc.score}%"></i></div>`
            + (surv.length ? card('الطفرات الناجية — أضف اختبارات تكشفها', table(['السطر', 'الأصل', 'الطفرة', 'النوع'], surv.map(r => [`<a href="#" onclick="${call('openFileAt', o.path, r.line, r.column)};return false">${r.line}</a>`, `<code dir="ltr">${esc(r.original.slice(0, 60))}</code>`, `<code dir="ltr">${esc(r.replacement.slice(0, 60))}</code>`, esc(r.op)])) + `<div class="gh-row">${btn('fa-wand-magic-sparkles', 'اقترح اختبارات بالذكاء الاصطناعي', 'app.dvMutationAI()')}</div><div id="dv-mut-ai"></div>`, 'fa-bug') : o.done && o.results.length ? empty('🎉 كل الطفرات قُتلت') : '')
            + (o.results.length ? `<details><summary>كل النتائج</summary>${table(['#', 'السطر', 'الطفرة', 'الحالة', 'كشفها'], o.results.map(r => [r.id, r.line, `<code dir="ltr">${esc(r.original.slice(0, 40))} → ${esc(r.replacement.slice(0, 40))}</code>`, { killed: '✅ مقتولة', survived: '⚠ ناجية', timeout: '⏱ مهلة', error: '💥 خطأ' }[r.status], esc(r.killer || '')]))}</details>` : ''));
    };
    P.dvMutationAI = async function () {
        const o = this._dvMut;
        if (!o) return null;
        const surv = o.results.filter(r => r.status === 'survived').slice(0, 12);
        this.dvBusy('dv-mut-ai');
        const ans = await this.dvAI(`File ${o.path}:\n\`\`\`\n${(this.dvRead(o.path) || '').slice(0, 8000)}\n\`\`\`\nThese mutants survived the test suite (line: original → mutated):\n${surv.map(r => `${r.line}: ${r.original} → ${r.replacement}`).join('\n')}\nWrite additional Jest-style test cases (test()/expect()) that would kill them. Output one code block.`);
        setHTML('dv-mut-ai', ans ? `<div class="gh-md">${this.renderMarkdownSafe ? this.renderMarkdownSafe(ans) : esc(ans)}</div>` : '');
        return ans;
    };

    // ---------------------------------------------------------------- #168 performance tests
    P.dvBench = async function () {
        const files = this.dvTestFiles('bench');
        const hist = lsGet(BENCH_KEY, {});
        const last = this._dvBenchLast;
        return card('اختبارات الأداء', `<p class="hv-dim"><code>bench(name, fn, { time })</code> يكرر الدالة لمدة محددة ويحسب المتوسط و op/s و p99 وهامش الخطأ. تُحفظ النتائج لمقارنة كل تشغيل بالسابق وكشف التراجع (أبطأ بأكثر من 10%).</p>
            <div class="gh-row">${pbtn('fa-gauge-high', `تشغيل (${files.length})`, 'app.dvBenchRun()', files.length ? '' : 'disabled')}${btn('fa-file-circle-plus', 'مثال', `app.dvCreateSample('bench/array.bench.js', app.dvLib().BENCH_SAMPLE)`)}${Object.keys(hist).length ? btn('fa-trash', 'مسح السجل', 'app.dvBenchClear()') : ''}</div>
            ${files.length ? '' : empty('لا توجد ملفات تحتوي bench()')}
            <div id="dv-bench-res">${last ? this.dvBenchHTML(last) : ''}</div>`, 'fa-gauge-high')
            + (Object.keys(hist).length ? card('السجل', table(['الاسم', 'آخر متوسط', 'op/s', 'الاتجاه', 'منذ'], Object.entries(hist).map(([name, runs]) => { const l = runs[runs.length - 1]; return [esc(name), fmtMs(l.mean), Math.round(l.hz).toLocaleString('en'), sparkline(runs.map(r => r.mean), { w: 90, h: 22, fill: false }), ago(l.at)]; })), 'fa-chart-line') : '');
    };
    P.dvBenchRun = async function (filesArg) {
        const files = filesArg || this.dvTestFiles('bench');
        if (!files.length) return null;
        this.dvBusy('dv-bench-res', 'قياس… (لا تستخدم المتصفح أثناء القياس)');
        const runs = [];
        try {
            const r = await this.dvRunTests(files, { timeoutMs: 120000, onMessage: (m) => { if (m.type === 'bench' && m.stats) runs.push(m.stats); } });
            const hist = lsGet(BENCH_KEY, {});
            const rows = runs.map(st => { const prev = (hist[st.name] || []).slice(-1)[0]; const cmp = benchCompare(prev, st); hist[st.name] = (hist[st.name] || []).concat([{ mean: st.mean, hz: st.hz, rme: st.rme, p99: st.p99, at: Date.now() }]).slice(-20); return { ...st, ...cmp }; });
            lsSet(BENCH_KEY, hist);
            const out = { at: Date.now(), rows, error: r.res.success ? null : r.res.error };
            this._dvBenchLast = out;
            setHTML('dv-bench-res', this.dvBenchHTML(out));
            return out;
        } catch (e) { return this.dvErr(e, 'dv-bench-res'); }
    };
    P.dvBenchHTML = function (o) {
        if (!o.rows.length) return empty(o.error ? '⚠ ' + esc(o.error) : 'لم تُسجل أي قياسات', !!o.error);
        const fastest = Math.min(...o.rows.map(r => r.mean));
        const f = (n) => (n < 0.01 ? n.toExponential(2) : n.toFixed(4)) + 'ms';
        return (o.rows.some(r => r.regression) ? empty('⚠ تراجع في الأداء: ' + o.rows.filter(r => r.regression).map(r => esc(r.name)).join('، '), true) : '')
            + table(['الاسم', 'المتوسط', 'op/s', '±', 'p99', 'العينات', 'مقارنة', 'مقابل السابق'], o.rows.map(r => [esc(r.name) + (r.mean === fastest && o.rows.length > 1 ? ' 🏆' : ''), f(r.mean), Math.round(r.hz).toLocaleString('en'), r.rme.toFixed(1) + '%', f(r.p99), r.n, r.mean === fastest ? '—' : (r.mean / fastest).toFixed(2) + '× أبطأ', r.delta == null ? 'جديد' : `<span class="${r.regression ? 'dvx-bad' : r.improvement ? 'dvx-good' : ''}">${r.delta > 0 ? '+' : ''}${r.delta}%</span>`]));
    };
    P.dvBenchClear = function () { lsSet(BENCH_KEY, {}); this.dvRefresh(); };

}
