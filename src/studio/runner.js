/* ==============================================================================
   Sprint 6 — code runner (lazy ESM chunk)
   JS/TS/JSX run in a blob Worker inside a sandboxed srcdoc iframe (opaque origin,
   no eval needed: Sucrase transpiles in the host and the bundle is the worker
   script). Python runs in a same-origin Pyodide worker (/workers/python.js).
   #151 JS/TS console • #152 Python + packages • #154 live preview with hot reload
   #157 errors linked to lines • #158 stop • #159/#225 env vars • #163 tests
   #169 accessibility audit • #176 interactive stack trace • #178 AI fix
   #180/#229 run history • #221 run selection • #222 run file • #223 run project
   #224 custom stdin • #227 mock API from mocks/*.json
   ============================================================================== */
import { transform } from 'sucrase';
import { runtimeSource } from './runtime.js';
import * as intel from './code-intel.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const JS_RUN = ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts'];
import { transpileArabic } from './arabic.js';
import { rtExtSource } from './rt-ext.js';
export const isTestPath = (p) => /(^|\/)__tests__\/|[._-](test|spec)\.(m|c)?[jt]sx?$/.test(p) || /(^|\/)test_[^/]+\.py$|_test\.py$/.test(p);
const RUN_ARGS = 'exports, require, module, __filename, __dirname, process, console, prompt, input, fetch, setTimeout, setInterval, clearTimeout, clearInterval, describe, it, test, expect, beforeEach, afterEach, beforeAll, afterAll, jest, vi';

/** Transpile one module to CommonJS, preserving line numbers. */
export function transpileModule(code, path) {
    const ext = intel.extOf(path);
    const transforms = ['imports'];
    if (ext === 'ts' || ext === 'mts' || ext === 'cts') transforms.push('typescript');
    else if (ext === 'tsx') transforms.push('typescript', 'jsx');
    else transforms.push('jsx');
    return transform(code, { transforms, filePath: path, production: true, disableESTransforms: true, preserveDynamicImport: false, jsxRuntime: 'classic' }).code;
}
/** Does the module use await at the top level? (then its wrapper must be async) */
export function hasTopLevelAwait(code, path) {
    if (!/\bawait\b/.test(code)) return false;
    const m = intel.maskCode(code, path);
    let depth = 0, fnDepth = [];
    const re = /\b(async)\b|\b(await)\b|[{}]|=>|\bfunction\b/g;
    let x, pendingFn = false;
    while ((x = re.exec(m))) {
        const t = x[0];
        if (t === 'function' || t === '=>' || t === 'async') pendingFn = true;
        else if (t === '{') { depth++; if (pendingFn) { fnDepth.push(depth); pendingFn = false; } }
        else if (t === '}') { if (fnDepth[fnDepth.length - 1] === depth) fnDepth.pop(); depth--; }
        else if (t === 'await' && !fnDepth.length) return true;
    }
    return false;
}
/** Build the worker script: runtime + one __ox.define per module. Returns { script, map, prelude }. */
export function buildRunBundle({ files, entry, mode = 'run', tests = [], cfg = {}, extensions = [], transform: postTransform = null }) {
    const parts = [], map = [];
    let line = 1;
    const push = (text, path) => {
        const n = text.split('\n').length;
        if (path) map.push({ start: line, end: line + n - 1, path });
        parts.push(text);
        line += n;
    };
    push(`var __ox = ${runtimeSource}(${JSON.stringify({ ...cfg, entry })}, typeof __oxPost === 'function' ? __oxPost : function (m) { postMessage(m); });`);
    (extensions || []).forEach((src) => push(`__ox.extend(${src});`));
    const prelude = line - 1;
    for (const [path, rawContent] of files) {
        const ext = intel.extOf(path);
        const content = ext === 'arjs' ? transpileArabic(rawContent).code : rawContent;
        if (ext === 'json') {
            let data;
            try { data = JSON.parse(content); } catch (e) { continue; }
            push(`__ox.defineJSON(${JSON.stringify(path)}, ${JSON.stringify(data)});`);
            continue;
        }
        if (!JS_RUN.includes(ext) && ext !== 'arjs') continue;
        let code;
        try { code = transpileModule(content, ext === 'arjs' ? path.replace(/\.arjs$/, '.js') : path); if (postTransform) code = postTransform(code, path) || code; } catch (e) {
            const loc = e.loc || (/\((\d+):(\d+)\)/.exec(e.message) ? { line: +RegExp.$1, column: +RegExp.$2 } : null);
            const err = new Error(String(e.message).replace(/^Error transforming [^:]+:\s*/, ''));
            err.compile = { path, line: loc ? loc.line : null, column: loc ? loc.column : null };
            if (path === entry || (tests || []).includes(path)) throw err;
            code = `throw new SyntaxError(${JSON.stringify(`${path}: ${err.message}`)});`;
        }
        const asy = hasTopLevelAwait(content, path) ? 'async ' : '';
        push(`__ox.define(${JSON.stringify(path)}, ${asy}function (${RUN_ARGS}) {`);
        push(code, path);
        push('});');
    }
    push(mode === 'test' ? `__ox.runTests(${JSON.stringify(tests)});` : `__ox.start(${JSON.stringify(entry)});`);
    return { script: parts.join('\n'), map, prelude };
}
export function mapLine(bundle, gLine) {
    const e = bundle.map.find(m => gLine >= m.start && gLine <= m.end);
    return e ? { path: e.path, line: gLine - e.start + 1 } : null;
}
/** Rewrite worker/vm stack frames to project paths; drops runtime frames. */
export function mapStack(stack, bundle) {
    return String(stack || '').split('\n').map(l => {
        const m = /(?:blob:[^\s)]*|ox-run\.js|<anonymous>|eval at [^)]*\)?|[\w.-]+\.js)?:(\d+):(\d+)\)?\s*$/.exec(l);
        if (!m || !/^\s*at\s/.test(l)) return l;
        const loc = mapLine(bundle, +m[1]);
        if (!loc) return null;
        return l.slice(0, m.index) + `${loc.path}:${loc.line}:${m[2]}` + (l.trim().endsWith(')') ? ')' : '');
    }).filter(x => x != null).join('\n');
}

// Runs inside the sandboxed iframe (serialised): spawns the blob worker and relays messages.
const SANDBOX_BOOT = `function (token) {
  var post = function (msg) { parent.postMessage({ token: token, msg: msg }, '*'); };
  var worker = null;
  addEventListener('message', function (e) {
    var d = e.data; if (!d || d.token !== token) return;
    if (d.stop) { if (worker) worker.terminate(); return; }
    if (d.req) { if (worker) worker.postMessage(d.req); else if (self.__oxReq) self.__oxReq(d.req); return; }
    if (typeof d.script === 'string') {
      try {
        var url = URL.createObjectURL(new Blob([d.script], { type: 'text/javascript' }));
        worker = new Worker(url);
        worker.onmessage = function (ev) { post(ev.data); };
        worker.onerror = function (ev) { if (ev.preventDefault) ev.preventDefault(); post({ type: 'fatal', message: ev.message, lineno: ev.lineno, colno: ev.colno }); };
      } catch (err) {
        self.__oxPost = post;
        var s = document.createElement('script'); s.textContent = d.script; document.body.appendChild(s);
      }
    }
  });
  parent.postMessage({ token: token, ready: true }, '*');
}`;

export function install(app) {
    const P = Object.getPrototypeOf(app);
    if (P.__oxRunner) return P.__oxRunner;
    const api = { transpileModule, buildRunBundle, mapLine, mapStack, hasTopLevelAwait, isTestPath };
    P.__oxRunner = api;
    P.runnerAPI = api;

    // ------------------------------------------------------------------ TERMINAL
    P.linkifyTerm = function (html) {
        const has = (p) => this.virtualProjectFiles.has(p);
        const link = (p, ln, label) => `<a href="#" class="term-link" data-path="${esc(p)}" data-line="${ln}" onclick="app.openTermLink(this); return false;">${label}</a>`;
        return html
            .replace(/File &quot;([^&]+?)&quot;, line (\d+)/g, (m, p, ln) => (has(p) ? `File &quot;${link(p, ln, esc(p))}&quot;, line ${ln}` : m))
            .replace(/([\w@.\/-]+\.[a-z]{1,5}):(\d+)(?::(\d+))?/gi, (m, p, ln, col) => (has(p) ? link(p, ln, m) : m));
    };
    P.openTermLink = function (el) {
        const path = el.dataset.path, line = +el.dataset.line || 1;
        if (this.openFileAt) return this.openFileAt(path, line, 1);
        if (!this.isCodeStudioOpen) this.toggleCodeStudio(true);
        this.switchStudioFile(path);
        const ta = document.getElementById('studio-editor-textarea');
        if (ta) { const pos = ta.value.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0); ta.focus(); ta.setSelectionRange(pos, pos); }
        return true;
    };
    P.createTermWriter = function (el) {
        const app = this;
        if (!el) return { line() {}, html() {}, clear() {}, text: () => '' };
        el.style.display = 'block';
        el.setAttribute('role', 'log');
        el.setAttribute('aria-live', 'polite');
        el.classList.add('ox-term');
        el.innerHTML = '';
        let count = 0;
        const MAX = 3000;
        const add = (cls, html) => {
            count++;
            if (count > MAX) { if (count === MAX + 1) add2('warn', '… تم اقتطاع المخرجات (أكثر من 3000 سطر)'); return; }
            add2(cls, html);
        };
        const add2 = (cls, html) => {
            const d = document.createElement('div');
            d.className = 'term-line term-' + cls;
            d.innerHTML = html;
            el.appendChild(d);
            el.scrollTop = el.scrollHeight;
        };
        return {
            line(level, text) { add(level || 'log', app.linkifyTerm(esc(text))); },
            html(cls, html) { add(cls, html); },
            clear() { el.innerHTML = ''; count = 0; },
            text: () => el.innerText || el.textContent || ''
        };
    };

    // ------------------------------------------------------------------ SANDBOX
    P.createRunSandbox = function () {
        const token = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const iframe = document.createElement('iframe');
        iframe.setAttribute('sandbox', 'allow-scripts');
        iframe.setAttribute('aria-hidden', 'true');
        iframe.title = 'ox-runner';
        iframe.className = 'ox-run-sandbox';
        let onMsg = null, ready = false, queued = null;
        const listener = (e) => {
            if (e.source !== iframe.contentWindow || !e.data || e.data.token !== token) return;
            if (e.data.ready) { ready = true; if (queued != null) { iframe.contentWindow.postMessage({ token, script: queued }, '*'); queued = null; } return; }
            if (onMsg) onMsg(e.data.msg);
        };
        window.addEventListener('message', listener);
        iframe.srcdoc = `<!doctype html><meta charset="utf-8"><body><script>(${SANDBOX_BOOT})(${JSON.stringify(token)});<\/script></body>`;
        document.body.appendChild(iframe);
        return {
            start(script, cb) { onMsg = cb; if (ready) iframe.contentWindow.postMessage({ token, script }, '*'); else queued = script; },
            send(req) { try { iframe.contentWindow && iframe.contentWindow.postMessage({ token, req }, '*'); } catch (e) { /* gone */ } },
            stop() {
                onMsg = null;
                window.removeEventListener('message', listener);
                try { iframe.contentWindow && iframe.contentWindow.postMessage({ token, stop: true }, '*'); } catch (e) { /* gone */ }
                iframe.remove();
            }
        };
    };

    // ------------------------------------------------------------------ FILES / ENV / MOCKS
    P.collectRunFiles = function (filter) {
        const out = new Map();
        for (const [p, f] of this.virtualProjectFiles) {
            if (!f || typeof f.content !== 'string' || f.dataUrl) continue;
            if (filter ? filter(p) : (JS_RUN.includes(intel.extOf(p)) || ['json', 'arjs'].includes(intel.extOf(p)))) out.set(p, f.content);
        }
        return out;
    };
    P.collectMocks = function () {
        const mocks = {};
        for (const [p, f] of this.virtualProjectFiles) {
            if (!/^(mocks?|__mocks__)\//.test(p) || !f || typeof f.content !== 'string') continue;
            const route = '/' + p.replace(/^(mocks?|__mocks__)\//, '');
            let v = f.content;
            if (/\.json$/i.test(p)) { try { v = JSON.parse(f.content); } catch (e) { /* keep text */ } }
            mocks[route] = v;
            mocks[route.replace(/\.(json|txt)$/i, '')] = v;
        }
        return mocks;
    };
    /** #226/#228/#166 — mocks/db.json, mocks/auth.json and __snapshots__/*.snap feed the runtime extension. */
    P.collectRunServices = function () {
        const out = {}, F = this.virtualProjectFiles;
        const json = (p) => { const f = F.get(p); if (!f || typeof f.content !== 'string') return undefined; try { return JSON.parse(f.content); } catch (e) { return undefined; } };
        const db = json('mocks/db.json') || json('mock/db.json') || json('db.json');
        if (db && typeof db === 'object') out.db = db;
        const auth = json('mocks/auth.json') || json('mock/auth.json');
        if (auth && typeof auth === 'object') out.auth = Array.isArray(auth) ? { users: auth } : auth;
        const snaps = {};
        for (const [p, f] of F) {
            const m = /^(.*?)__snapshots__\/(.+)\.snap$/.exec(p);
            if (!m || !f || typeof f.content !== 'string') continue;
            try { snaps[m[1] + m[2]] = JSON.parse(f.content); } catch (e) { /* ignore malformed */ }
        }
        out.snapshots = snaps;
        if (this._updateSnapshots) out.updateSnapshots = true;
        return out;
    };
    P.snapshotPath = function (testFile) { const d = intel.dirName(testFile); return (d ? d + '/' : '') + '__snapshots__/' + intel.baseName(testFile) + '.snap'; };
    P.recordSnapshot = function (m, w) {
        this._snapStats = this._snapStats || { new: 0, match: 0, updated: 0, fail: 0 };
        this._snapStats[m.status] = (this._snapStats[m.status] || 0) + 1;
        if (m.status !== 'new' && m.status !== 'updated') return;
        const p = this.snapshotPath(m.file);
        const f = this.virtualProjectFiles.get(p);
        let data = {};
        try { data = f ? JSON.parse(f.content) : {}; } catch (e) { data = {}; }
        data[m.key] = m.value;
        const sorted = {};
        Object.keys(data).sort().forEach(k => { sorted[k] = data[k]; });
        this.writeProjectFile(p, JSON.stringify(sorted, null, 2) + '\n', 'snapshot');
        if (w) w.line('info', `📸 ${m.status === 'new' ? 'لقطة جديدة' : 'تحديث لقطة'}: ${m.key}`);
    };
    P.renderBench = function (w, st) {
        if (!st) return;
        this._benchResults = this._benchResults || [];
        this._benchResults.push({ ...st, at: Date.now() });
        const f = (n) => n < 0.01 ? n.toExponential(2) : n.toFixed(3);
        w.line('info', `⏱ ${st.name}: ${f(st.mean)}ms متوسط • ${Math.round(st.hz).toLocaleString('en')} op/s ±${st.rme.toFixed(1)}% • p99 ${f(st.p99)}ms (${st.n} عينة)`);
    };
    P.getRunEnv = async function () {
        let saved = {};
        try { saved = (this.idbGet && (await this.idbGet('run_env_v1'))) || {}; } catch (e) { saved = {}; }
        const f = this.virtualProjectFiles.get('.env');
        const fromFile = f && typeof f.content === 'string' ? intel.parseDotEnv(f.content) : {};
        return { ...fromFile, ...saved };
    };
    P.saveRunEnv = async function (obj) { if (this.idbSet) await this.idbSet('run_env_v1', obj || {}); return obj; };
    P.openRunEnv = async function () {
        let saved = {};
        try { saved = (this.idbGet && (await this.idbGet('run_env_v1'))) || {}; } catch (e) { saved = {}; }
        const f = this.virtualProjectFiles.get('.env');
        const fromFile = f ? intel.parseDotEnv(f.content || '') : {};
        const rows = Object.entries(saved).concat([['', '']]);
        this.openPanel({
            title: 'متغيرات البيئة للتشغيل', icon: 'fa-key',
            body: `<p class="hv-dim">تُمرر إلى <code>process.env</code> في JavaScript و <code>os.environ</code> في بايثون. القيم هنا تتقدم على ملف <code>.env</code> في المشروع.</p>
                ${Object.keys(fromFile).length ? `<div class="gh-card"><b>من .env (${Object.keys(fromFile).length})</b> <code dir="ltr">${Object.keys(fromFile).map(esc).join(', ')}</code></div>` : ''}
                <div id="run-env-rows">${rows.map(([k, v]) => `<div class="env-row"><input class="form-input-box" dir="ltr" placeholder="KEY" value="${esc(k)}"><input class="form-input-box" dir="ltr" placeholder="value" value="${esc(v)}"><button type="button" class="gh-btn" onclick="this.parentElement.remove()">×</button></div>`).join('')}</div>
                <button class="gh-btn" onclick="document.getElementById('run-env-rows').insertAdjacentHTML('beforeend', '<div class=&quot;env-row&quot;><input class=&quot;form-input-box&quot; dir=&quot;ltr&quot; placeholder=&quot;KEY&quot;><input class=&quot;form-input-box&quot; dir=&quot;ltr&quot; placeholder=&quot;value&quot;><button type=&quot;button&quot; class=&quot;gh-btn&quot; onclick=&quot;this.parentElement.remove()&quot;>×</button></div>')"><i class="fa-solid fa-plus"></i> متغير</button>`,
            footer: '<span class="gh-spacer"></span><button class="btn-new-thread gh-btn" onclick="app.saveRunEnvFromPanel()"><i class="fa-solid fa-floppy-disk"></i> حفظ</button>'
        });
    };
    P.saveRunEnvFromPanel = async function () {
        const obj = {};
        document.querySelectorAll('#run-env-rows .env-row').forEach(r => {
            const [k, v] = r.querySelectorAll('input');
            const key = (k.value || '').trim();
            if (/^[A-Za-z_][\w]*$/.test(key)) obj[key] = v.value;
        });
        await this.saveRunEnv(obj);
        this.showToast(`تم حفظ ${Object.keys(obj).length} متغير`, 'success');
        this.closeModals();
        return obj;
    };

    // ------------------------------------------------------------------ HISTORY (#180, #229)
    P.recordRun = async function (entry) {
        this._lastRunRecord = { at: Date.now(), ...entry };
        if (!this.idbGet || !this.idbSet) return;
        try {
            const list = (await this.idbGet('run_history_v1')) || [];
            list.unshift({ id: 'run_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: Date.now(), ...entry, output: String(entry.output || '').slice(0, 20000) });
            await this.idbSet('run_history_v1', list.slice(0, 50));
        } catch (e) { /* history is best effort */ }
    };
    P.openRunHistory = async function () {
        let list = [];
        try { list = (this.idbGet && (await this.idbGet('run_history_v1'))) || []; } catch (e) { list = []; }
        this._runHistory = list;
        const body = list.length ? list.map((r, i) => `<div class="gh-card run-hist ${r.success ? 'ok' : 'bad'}"><i class="fa-solid ${r.success ? 'fa-circle-check text-emerald' : 'fa-circle-xmark text-red'}"></i> <b dir="ltr">${esc(r.path || r.lang)}</b> <span class="gh-badge">${esc(r.mode || 'run')}</span> <small class="hv-dim">${new Date(r.at).toLocaleString('ar')} • ${r.durationMs || 0}ms</small><span class="gh-spacer"></span>
            <button class="gh-btn" onclick="app.showRunOutput(${i})" title="المخرجات"><i class="fa-solid fa-terminal"></i></button>
            ${r.path && this.virtualProjectFiles.has(r.path) ? `<button class="gh-btn" onclick="app.closeModals(); app.switchStudioFile('${esc(r.path)}'); app.runStudioCode()" title="إعادة التشغيل"><i class="fa-solid fa-rotate-right"></i></button>` : ''}</div>`).join('')
            : '<p class="gh-empty">لا توجد عمليات تشغيل بعد.</p>';
        this.openPanel({ title: `سجل التشغيل (${list.length})`, icon: 'fa-clock-rotate-left', body, footer: list.length ? '<span class="gh-spacer"></span><button class="gh-btn danger" onclick="app.clearRunHistory()">مسح السجل</button>' : '' });
        return list;
    };
    P.showRunOutput = function (i) {
        const r = (this._runHistory || [])[i];
        if (!r) return;
        this.showDialog({ title: `${r.path || r.lang} — ${new Date(r.at).toLocaleString('ar')}`, body: `<pre class="ai-code" dir="ltr">${esc(r.output || '(لا مخرجات)')}${r.error ? '\n\n' + esc(r.error) : ''}</pre>`, buttons: [{ label: 'نسخ', value: 'copy', primary: true }, { label: 'إغلاق', value: null }] })
            .then(res => { if (res && res.button === 'copy' && this.copyText) this.copyText((r.output || '') + (r.error ? '\n\n' + r.error : '')); });
    };
    P.clearRunHistory = async function () { if (this.idbSet) await this.idbSet('run_history_v1', []); this.openRunHistory(); };

    // ------------------------------------------------------------------ CORE RUN
    P.stopRun = function () {
        if (this._activeRun) { this._activeRun.stop(); return true; }
        return false;
    };
    P.runCode = async function (o = {}) {
        const lang = o.lang || (intel.isPy(o.path || '') ? 'py' : 'js');
        const w = o.writer || this.createTermWriter(o.terminal);
        if (this._activeRun) this._activeRun.stop(true);
        const t0 = Date.now();
        this.updateRunButtons(true);
        let res;
        try { res = lang === 'py' ? await this.runPython({ ...o, writer: w }) : this.dvPolyLang && this.dvPolyLang(o.path || '') && o.code == null ? await this.dvRunPoly({ ...o, writer: w }) : await this.runJS({ ...o, writer: w }); } catch (e) { res = { success: false, error: e.message, logs: '' }; w.line('error', '❌ ' + e.message); }
        finally { this._activeRun = null; this.updateRunButtons(false); }
        res.durationMs = Date.now() - t0;
        if (o.footer !== false && res.error !== 'Stopped') {
            const t = res.tests && res.tests.summary;
            if (t) w.html(t.fail ? 'error' : 'success', `<b>${t.fail ? '✗' : '✓'} ${t.pass} نجح${t.fail ? ` • ${t.fail} فشل` : ''}${t.skip ? ` • ${t.skip} تخطى` : ''}${t.todo ? ` • ${t.todo} todo` : ''}</b> — ${t.total} اختبار في ${res.durationMs}ms`);
            else if (res.success) w.line('success', `✅ اكتمل التنفيذ في ${res.durationMs}ms${res.logs ? '' : ' (بدون مخرجات)'}`);
        }
        if (!res.success && res.error && !['Stopped', 'Timeout'].includes(res.error) && o.fixable !== false && o.path && this.virtualProjectFiles.has(o.path)) {
            this._lastRunError = { path: o.path, error: res.error };
            w.html('action', `<button type="button" class="term-fix-btn" onclick="app.fixLastRunError()"><i class="fa-solid fa-wand-magic-sparkles"></i> أصلح بالذكاء الاصطناعي</button>${lang === 'js' && this.dvReplayError ? ` <button type="button" class="term-fix-btn" onclick="app.dvReplayError()"><i class="fa-solid fa-film"></i> إعادة تشغيل الخطأ خطوة بخطوة</button>` : ''}`);
        }
        if (o.record !== false) this.recordRun({ path: o.path || null, lang, mode: o.mode || 'run', success: !!res.success, durationMs: res.durationMs, output: res.logs || w.text(), error: res.error || null, source: o.source || 'studio' });
        return res;
    };
    P.fixLastRunError = async function () {
        const e = this._lastRunError;
        if (!e) return null;
        if (this.ensureStudio) await this.ensureStudio();
        return this.aiFixCode ? this.aiFixCode(e.error, e.path) : null;
    };
    P.runJS = function (o) {
        const w = o.writer;
        const files = o.files || this.collectRunFiles();
        let entry = o.entry || o.path;
        if (o.code != null) {
            const ext = intel.extOf(o.path || '') || (o.ext || 'js');
            entry = o.virtualPath || ((o.path && intel.dirName(o.path) ? intel.dirName(o.path) + '/' : '') + '__snippet__.' + (JS_RUN.includes(ext) ? ext : 'js'));
            files.set(entry, o.code);
        }
        const tests = o.tests || [];
        // #165 Playwright-style E2E tests need the Developer Lab driver (lazy chunk)
        if (o.mode === 'test' && !o.e2eAttached && tests.some(t => /['"](@playwright\/test|playwright)['"]/.test(files.get(t) || ''))) {
            if (this.dvE2EAttach && !this.dvE2EAttach.__oxLazy) return this.runJS({ ...this.dvE2EAttach(o), files });
            if (this.ensureDev) return this.ensureDev().then(() => this.runJS(this.dvE2EAttach && !this.dvE2EAttach.__oxLazy ? { ...this.dvE2EAttach(o), files } : { ...o, e2eAttached: true, files }), () => this.runJS({ ...o, e2eAttached: true, files }));
        }
        let bundle;
        try {
            bundle = buildRunBundle({ files, entry, mode: o.mode === 'test' ? 'test' : 'run', tests, cfg: { stdin: o.stdin || '', env: o.env || {}, mocks: this.collectMocks(), ...this.collectRunServices(), ...(o.cfg || {}) }, extensions: [rtExtSource, ...(o.extensions || (this.runExtensions ? this.runExtensions(o) : []))], transform: o.transform || null });
        } catch (e) {
            const c = e.compile || {};
            w.line('error', `❌ خطأ في الصياغة: ${c.path || entry}${c.line ? ':' + c.line + (c.column != null ? ':' + (c.column + 1) : '') : ''}\n${e.message}`);
            return Promise.resolve({ success: false, error: `SyntaxError: ${e.message}${c.line ? ` (${c.path}:${c.line})` : ''}`, logs: '' });
        }
        const timeoutMs = o.timeoutMs || (o.mode === 'test' ? 60000 : 15000);
        if (o.mode !== 'test' && o.banner !== false) w.line('info', `▶ ${o.code != null && !o.path ? 'JavaScript' : entry}`);
        return new Promise(resolve => {
            const sb = this.createRunSandbox();
            const logs = [], results = [];
            let done = false, error = null, summary = null, timer = null;
            const finish = (r) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                try { sb.stop(); } catch (e) { /* ignore */ }
                resolve({ ...r, logs: logs.join('\n'), tests: summary ? { summary, results } : undefined });
            };
            timer = setTimeout(() => { w.line('warn', `⏱ تجاوز المهلة (${Math.round(timeoutMs / 1000)} ث) — تم إيقاف التنفيذ. هل توجد حلقة لا نهائية؟`); finish({ success: false, error: 'Timeout' }); }, timeoutMs);
            const handle = { stop: (silent) => { if (!silent) w.line('warn', '⏹ تم إيقاف التنفيذ'); finish({ success: false, error: 'Stopped' }); }, send: (msg) => sb.send && sb.send({ __ox: true, ...msg }), bundle };
            if (!o.detached) this._activeRun = handle;
            if (o.onStart) o.onStart(handle);
            sb.start(bundle.script, (m) => {
                if (!m || done) return;
                switch (m.type) {
                    case 'listen': clearTimeout(timer); if (o.onMessage) o.onMessage(m, handle); else w.line('info', `🌐 الخادم يستمع على المنفذ ${m.port} — افتح «المنافذ» في مختبر المطور لإرسال الطلبات`); break;
                    case 'out': logs.push(m.text); w.line(m.level, m.text); break;
                    case 'clear': w.clear(); break;
                    case 'stdin': if (m.value == null) w.line('warn', '⌨ البرنامج طلب إدخالاً ولا توجد مدخلات — أضفها من زر «مدخلات» في شريط الطرفية'); break;
                    case 'test': results.push(m.result); this.renderTestResult(w, m.result, bundle); break;
                    case 'tests': summary = m.summary; break;
                    case 'snapshot': this.recordSnapshot(m, w); if (o.onMessage) o.onMessage(m, handle); break;
                    case 'bench': this.renderBench(w, m.stats); if (o.onMessage) o.onMessage(m, handle); break;
                    case 'db': this._lastMockDb = m.data; if (m.changed && o.mode !== 'test') w.line('info', '🗄 تغيّرت قاعدة البيانات الوهمية أثناء التشغيل (لم تُحفظ في mocks/db.json — احفظها من مختبر المطور)'); if (o.onMessage) o.onMessage(m, handle); break;
                    case 'error': {
                        const stack = mapStack(m.error.stack, bundle);
                        const first = /([\w@./-]+\.[a-z]{1,5}):(\d+):\d+/.exec(stack);
                        const text = `${m.error.name && !String(m.error.message).startsWith(m.error.name) ? m.error.name + ': ' : ''}${m.error.message}`;
                        error = text + (first ? ` (${first[1]}:${first[2]})` : '');
                        logs.push('❌ ' + text);
                        w.line('error', '❌ ' + text);
                        const frames = stack.split('\n').filter(l => /^\s*at\s/.test(l));
                        if (frames.length) w.html('stack', `<details class="term-stack" open><summary>Stack trace (${frames.length})</summary>${frames.slice(0, 15).map(f => `<div>${this.linkifyTerm(esc(f.trim()))}</div>`).join('')}</details>`);
                        break;
                    }
                    case 'fatal': {
                        const loc = m.lineno ? mapLine(bundle, m.lineno) : null;
                        error = String(m.message || 'Worker error') + (loc ? ` (${loc.path}:${loc.line})` : '');
                        w.line('error', '❌ ' + error);
                        finish({ success: false, error });
                        break;
                    }
                    case 'done': {
                        const failed = summary && summary.fail;
                        finish({ success: !error && !m.code && !failed, error: error || (m.code ? `exit code ${m.code}` : failed ? `${summary.fail} اختبار فشل` : undefined), exitCode: m.code || 0 });
                        break;
                    }
                    default: if (o.onMessage) o.onMessage(m, handle); break;
                }
            });
        });
    };
    P.renderTestResult = function (w, r, bundle) {
        const icon = { pass: '✓', fail: '✗', skip: '○', todo: '✎' }[r.status] || '•';
        w.html('test-' + r.status, `<span class="t-icon">${icon}</span> ${esc(r.name)} <span class="hv-dim">${r.ms ? r.ms + 'ms' : ''}</span>${r.file ? ` <span class="hv-dim" dir="ltr">${esc(intel.baseName(r.file))}</span>` : ''}`);
        if (r.status === 'fail' && r.error) {
            const stack = bundle ? mapStack(r.error.stack, bundle) : r.error.stack || '';
            const loc = /([\w@./-]+\.[a-z]{1,5}):(\d+):\d+/.exec(stack.split('\n').find(l => /^\s*at\s/.test(l) && !/runtime/.test(l)) || '');
            w.html('test-error', `<div class="t-msg">${this.linkifyTerm(esc(r.error.message))}</div>${r.error.expected !== undefined ? `<div class="t-exp">Expected: <code>${esc(r.error.expected)}</code></div>` : ''}${r.error.received !== undefined ? `<div class="t-rec">Received: <code>${esc(r.error.received)}</code></div>` : ''}${loc ? `<div>${this.linkifyTerm(esc(loc[0]))}</div>` : ''}`);
        }
    };

    // ------------------------------------------------------------------ PYTHON (#152)
    P.createPythonWorker = function () { return new Worker('/workers/python.js'); };
    P.getPythonWorker = function () {
        if (this._py && this._py.alive) return this._py;
        const worker = this.createPythonWorker();
        const py = { worker, alive: true, seq: 0, ready: false, handlers: new Map() };
        worker.onmessage = (e) => { const m = e.data || {}; if (m.type === 'ready') py.ready = true; const h = py.handlers.get(m.id); if (h) h(m); };
        worker.onerror = (e) => {
            py.alive = false; if (this._py === py) this._py = null;
            py.handlers.forEach(h => h({ type: 'done', success: false, error: 'تعذر تشغيل بيئة بايثون: ' + ((e && e.message) || 'خطأ في العامل') }));
        };
        this._py = py;
        return py;
    };
    P.killPythonWorker = function () {
        if (!this._py) return;
        try { this._py.worker.terminate(); } catch (e) { /* ignore */ }
        this._py.alive = false;
        this._py = null;
    };
    P.runPython = function (o) {
        const w = o.writer;
        const files = {};
        let total = 0;
        for (const [p, f] of this.virtualProjectFiles) {
            if (!f || typeof f.content !== 'string' || f.dataUrl) continue;
            if (!/\.(py|json|csv|tsv|txt|md|ya?ml|toml|ini|cfg|xml|html|sql|env)$/i.test(p) && p !== '.env') continue;
            if (total + f.content.length > 4e6) continue;
            files[p] = f.content; total += f.content.length;
        }
        let entry = o.entry || o.path || 'main.py';
        if (o.code != null) { entry = o.virtualPath || '__main__.py'; files[entry] = o.code; }
        const py = this.getPythonWorker();
        const id = ++py.seq;
        if (!py.ready) w.line('info', '📦 جاري تحميل بيئة بايثون (Pyodide) لأول مرة — قد يستغرق بضع ثوانٍ...');
        else if (o.banner !== false && o.mode !== 'test') w.line('info', `▶ ${o.code != null && !o.path ? 'Python' : entry}`);
        const timeoutMs = o.timeoutMs || (py.ready ? (o.mode === 'test' ? 60000 : 30000) : 180000);
        return new Promise(resolve => {
            const logs = [], results = [];
            let done = false, timer = null;
            const finish = (r) => {
                if (done) return;
                done = true; clearTimeout(timer); py.handlers.delete(id);
                resolve({ ...r, logs: logs.join('\n') });
            };
            const reset = () => { clearTimeout(timer); timer = setTimeout(() => { w.line('warn', `⏱ تجاوز المهلة — تم إيقاف بايثون وإعادة تهيئة البيئة`); this.killPythonWorker(); finish({ success: false, error: 'Timeout' }); }, timeoutMs); };
            reset();
            this._activeRun = { stop: (silent) => { if (!silent) w.line('warn', '⏹ تم إيقاف بايثون (ستُعاد تهيئة البيئة في التشغيل التالي)'); this.killPythonWorker(); finish({ success: false, error: 'Stopped' }); } };
            py.handlers.set(id, (m) => {
                switch (m.type) {
                    case 'status': w.line('info', m.text); if (m.loaded) reset(); break;
                    case 'out': logs.push(m.text); w.line(m.level || 'log', m.text); break;
                    case 'stdin': if (m.value == null) w.line('warn', '⌨ input() طلب إدخالاً ولا توجد مدخلات — أضفها من زر «مدخلات»'); break;
                    case 'test': results.push(m.result); this.renderTestResult(w, m.result, null); break;
                    case 'done': {
                        if (m.error) { logs.push(m.error); w.line('error', m.error); }
                        finish({ success: !!m.success, error: m.success ? undefined : (m.error || 'فشل التنفيذ').split('\n').filter(Boolean).slice(-1)[0], tests: m.summary ? { summary: m.summary, results } : undefined });
                        break;
                    }
                    default: break;
                }
            });
            py.worker.postMessage({ id, type: 'run', mode: o.mode === 'test' ? 'test' : 'run', entry, files, stdin: o.stdin || '', env: o.env || {}, tests: o.tests || [] });
        });
    };

    // ------------------------------------------------------------------ STUDIO INTEGRATION
    P.ensureStudioConsole = function () {
        const term = document.getElementById('studio-terminal');
        if (!term) return null;
        if (!document.getElementById('studio-console-bar')) {
            const bar = document.createElement('div');
            bar.id = 'studio-console-bar';
            bar.className = 'studio-console-bar';
            bar.innerHTML = `
                <button type="button" data-run="run" onclick="app.runStudioCode()" title="تشغيل (Ctrl+Enter)"><i class="fa-solid fa-play"></i> تشغيل</button>
                <button type="button" data-run="stop" onclick="app.stopRun()" title="إيقاف" disabled><i class="fa-solid fa-stop"></i> إيقاف</button>
                <button type="button" onclick="app.runTests('file')" title="اختبارات الملف"><i class="fa-solid fa-flask"></i> اختبارات</button>
                <button type="button" onclick="app.runTests('all')" title="كل اختبارات المشروع"><i class="fa-solid fa-vials"></i> الكل</button>
                <button type="button" onclick="app.runProject()" title="تشغيل المشروع"><i class="fa-solid fa-diagram-project"></i> المشروع</button>
                <button type="button" onclick="app.toggleRunStdin()" title="مدخلات مخصصة (stdin)"><i class="fa-solid fa-keyboard"></i> مدخلات</button>
                <button type="button" onclick="app.openRunEnv()" title="متغيرات البيئة"><i class="fa-solid fa-key"></i></button>
                <button type="button" onclick="app.openRunHistory()" title="سجل التشغيل"><i class="fa-solid fa-clock-rotate-left"></i></button>
                <span class="gh-spacer"></span>
                <button type="button" onclick="app.toggleConsoleSize()" title="تكبير/تصغير الطرفية"><i class="fa-solid fa-up-down"></i></button>
                <button type="button" onclick="document.getElementById('studio-terminal').innerHTML=''" title="مسح"><i class="fa-solid fa-trash-can"></i></button>`;
            term.parentElement.insertBefore(bar, term);
        }
        return term;
    };
    P.toggleConsoleSize = function () { const t = document.getElementById('studio-terminal'); if (t) t.classList.toggle('tall'); };
    P.toggleRunStdin = function () {
        const term = this.ensureStudioConsole();
        let box = document.getElementById('run-stdin');
        if (box) { box.remove(); return false; }
        box = document.createElement('textarea');
        box.id = 'run-stdin';
        box.className = 'run-stdin';
        box.dir = 'auto';
        box.placeholder = 'مدخلات البرنامج — سطر لكل استدعاء prompt() / input()';
        box.value = this._runStdin || '';
        box.addEventListener('input', () => { this._runStdin = box.value; });
        term.parentElement.insertBefore(box, term);
        box.focus();
        return true;
    };
    P.updateRunButtons = function (running) {
        const bar = document.getElementById('studio-console-bar');
        if (!bar) return;
        const stop = bar.querySelector('[data-run="stop"]');
        if (stop) stop.disabled = !running;
        bar.classList.toggle('running', !!running);
    };
    P.isRunnablePath = function (p) { const e = intel.extOf(p); return JS_RUN.includes(e) || e === 'py' || e === 'arjs' || (this.dvPolyLang && !!this.dvPolyLang(p)); };
    P.runStudioCode = async function () {
        const path = this.activeStudioFile || '';
        const ext = intel.extOf(path);
        if (/^(html?|svg|md|markdown|css)$/.test(ext)) return this.togglePreview(true);
        if (!this.isRunnablePath(path)) { this.showToast('هذا النوع لا يُشغل مباشرة — جرّب المعاينة أو افتح ملف JS/TS/Python', 'info'); return null; }
        if (isTestPath(path)) return this.runTests('file');
        const term = this.ensureStudioConsole();
        const ta = document.getElementById('studio-editor-textarea');
        if (ta && this.virtualProjectFiles.has(path)) this.handleStudioCodeChange(ta.value);
        return this.runCode({ path, entry: path, lang: ext === 'py' ? 'py' : 'js', terminal: term, stdin: this._runStdin || '', env: await this.getRunEnv(), source: 'studio' });
    };
    P.runStudioSelection = async function () {
        const path = this.activeStudioFile || '';
        if (!this.isRunnablePath(path)) { this.showToast('تشغيل التحديد متاح لملفات JS/TS/Python', 'info'); return null; }
        let code = '';
        const ctl = this.codeEditor;
        if (ctl) { const s = ctl.getSelection(); code = s.from === s.to ? ctl.lineAt(s.head).text : ctl.getValue().slice(s.from, s.to); }
        else { const ta = document.getElementById('studio-editor-textarea'); code = ta ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : ''; }
        if (!code.trim()) { this.showToast('حدد كوداً لتشغيله', 'info'); return null; }
        const ext = intel.extOf(path), dir = intel.dirName(path);
        const term = this.ensureStudioConsole();
        return this.runCode({ code, path, lang: ext === 'py' ? 'py' : 'js', virtualPath: ext === 'py' ? (dir ? dir + '/' : '') + '__selection__.py' : (dir ? dir + '/' : '') + '__selection__.' + ext, terminal: term, stdin: this._runStdin || '', env: await this.getRunEnv(), mode: 'selection', fixable: false, source: 'studio' });
    };
    P.detectProjectEntry = function () {
        const has = (p) => this.virtualProjectFiles.has(p);
        const pkg = (() => { try { return JSON.parse((this.virtualProjectFiles.get('package.json') || {}).content || 'null'); } catch (e) { return null; } })();
        if (pkg) {
            const start = pkg.scripts && (pkg.scripts.start || pkg.scripts.dev || '');
            const m = /node\s+([\w./-]+\.(?:m?js|ts))/.exec(start || '');
            if (m && has(m[1].replace(/^\.\//, ''))) return m[1].replace(/^\.\//, '');
            if (pkg.main && has(pkg.main.replace(/^\.\//, ''))) return pkg.main.replace(/^\.\//, '');
        }
        return ['main.py', 'app.py', 'src/main.py', 'index.html', 'src/index.ts', 'src/index.js', 'src/main.ts', 'src/main.js', 'index.ts', 'index.js', 'main.js', 'main.ts', 'app.js', 'server.js'].find(has) || null;
    };
    P.runProject = async function () {
        const entry = this.detectProjectEntry();
        if (!entry) { this.showToast('لم أجد نقطة دخول (main.py أو index.html أو package.json main أو src/index.*)', 'warning'); return null; }
        if (/\.html?$/.test(entry)) { this._previewPath = entry; return this.togglePreview(true, entry); }
        const term = this.ensureStudioConsole();
        return this.runCode({ path: entry, entry, lang: intel.isPy(entry) ? 'py' : 'js', terminal: term, stdin: this._runStdin || '', env: await this.getRunEnv(), mode: 'project', source: 'studio' });
    };
    P.findTestFiles = function (scope = 'file') {
        const all = this.projectPaths().filter(p => isTestPath(p) && this.isRunnablePath(p));
        if (scope === 'all') return all;
        const path = this.activeStudioFile || '';
        if (isTestPath(path)) return [path];
        const stem = intel.baseName(path).replace(/\.[^.]+$/, '');
        return all.filter(p => { const b = intel.baseName(p); return b.startsWith(stem + '.') || b === 'test_' + stem + '.py' || b === stem + '_test.py'; });
    };
    P.runTests = async function (scope = 'file') {
        const tests = this.findTestFiles(scope);
        const term = this.ensureStudioConsole();
        if (!tests.length) {
            const w = this.createTermWriter(term);
            w.line('warn', scope === 'all' ? 'لا توجد ملفات اختبار في المشروع (*.test.js, *.spec.ts, test_*.py)' : `لا توجد اختبارات لـ ${this.activeStudioFile}`);
            if (this.showActionToast && this.activeStudioFile && this.isRunnablePath(this.activeStudioFile)) this.showActionToast('لا توجد اختبارات لهذا الملف', 'ولّد بالذكاء الاصطناعي', async () => { if (this.ensureStudio) await this.ensureStudio(); if (this.aiGenerateTests) this.aiGenerateTests(); }, 'info');
            return null;
        }
        const env = await this.getRunEnv();
        const js = tests.filter(p => !intel.isPy(p)), pys = tests.filter(p => intel.isPy(p));
        const w = this.createTermWriter(term);
        w.html('info', `<b>🧪 تشغيل ${tests.length} ملف اختبار</b>`);
        let last = null;
        if (js.length) last = await this.runCode({ writer: w, lang: 'js', mode: 'test', tests: js, entry: js[0], path: js[0], env, source: 'tests', fixable: false });
        if (pys.length) last = await this.runCode({ writer: w, lang: 'py', mode: 'test', tests: pys, entry: pys[0], path: pys[0], env, source: 'tests', fixable: false });
        return last;
    };

    // ------------------------------------------------------------------ LIVE PREVIEW (#154) + A11Y (#169)
    P.previewTargetFor = function (path) {
        const ext = intel.extOf(path || '');
        if (/^(html?|svg|md|markdown)$/.test(ext)) return path;
        const htmls = this.projectPaths().filter(p => /\.html?$/i.test(p));
        if (/^(css|js|mjs|jsx|ts)$/.test(ext)) {
            const base = intel.baseName(path);
            const ref = htmls.find(h => ((this.virtualProjectFiles.get(h) || {}).content || '').includes(base));
            if (ref) return ref;
        }
        return htmls.find(h => /(^|\/)index\.html?$/i.test(h)) || htmls[0] || null;
    };
    const BRIDGE = (token) => `<script>(function(){var T=${JSON.stringify(token)};var s=function(l,a){try{parent.postMessage({__oxPreview:T,level:l,text:Array.prototype.map.call(a,function(x){try{return x&&typeof x==='object'?JSON.stringify(x):String(x)}catch(e){return String(x)}}).join(' ')},'*')}catch(e){}};['log','info','warn','error','debug'].forEach(function(l){var o=console[l];console[l]=function(){s(l,arguments);if(o)o.apply(console,arguments)}});addEventListener('error',function(e){s('error',[(e.message||'Error')+(e.lineno?' (line '+e.lineno+')':'')])});addEventListener('unhandledrejection',function(e){s('error',['Unhandled rejection: '+((e.reason&&e.reason.message)||e.reason)])});})();<\/script>`;
    P.buildPreviewDoc = function (path, { bridge = true } = {}) {
        const f = this.virtualProjectFiles.get(path);
        if (!f) return '<p>لا يوجد ملف للمعاينة</p>';
        const token = this._previewToken || (this._previewToken = 'p' + Math.random().toString(36).slice(2));
        const head = bridge ? BRIDGE(token) : '';
        const ext = intel.extOf(path);
        if (ext === 'svg') return `<!doctype html><meta charset="utf-8">${head}<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${f.content}</body>`;
        if (ext === 'md' || ext === 'markdown') return `<!doctype html><html dir="auto"><meta charset="utf-8">${head}<style>body{font-family:system-ui,sans-serif;max-width:820px;margin:24px auto;padding:0 16px;line-height:1.7}pre{background:#f4f4f5;padding:12px;border-radius:8px;overflow:auto}code{font-family:ui-monospace,monospace}img{max-width:100%}</style><body>${this.renderMarkdownSafe ? this.renderMarkdownSafe(f.content) : esc(f.content)}</body></html>`;
        const dir = intel.dirName(path);
        const resolve = (ref) => {
            if (!ref || /^(https?:|data:|blob:|\/\/|#|mailto:)/i.test(ref)) return null;
            const clean = ref.split(/[?#]/)[0];
            const p = clean.startsWith('/') ? clean.slice(1) : intel.joinPath(dir, clean);
            return this.virtualProjectFiles.has(p) ? p : null;
        };
        let html = String(f.content || '');
        html = html.replace(/<link\b[^>]*\brel=["']?stylesheet["']?[^>]*>/gi, (tag) => {
            const href = /\bhref=["']([^"']+)["']/i.exec(tag);
            const p = href && resolve(href[1]);
            return p ? `<style data-src="${esc(p)}">\n${(this.virtualProjectFiles.get(p).content || '').replace(/<\/style/gi, '<\\/style')}\n</style>` : tag;
        });
        html = html.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, a, src, b) => {
            const p = resolve(src);
            if (!p) return tag;
            const attrs = (a + b).replace(/\s+/g, ' ').trim();
            return `<script ${attrs} data-src="${esc(p)}">\n${(this.virtualProjectFiles.get(p).content || '').replace(/<\/script/gi, '<\\/script')}\n</script>`;
        });
        html = html.replace(/(<(?:img|source|video|audio)\b[^>]*\bsrc=["'])([^"']+)(["'])/gi, (m, a, src, b) => {
            const p = resolve(src);
            const ff = p && this.virtualProjectFiles.get(p);
            return ff && ff.dataUrl ? a + ff.dataUrl + b : ff && /\.svg$/i.test(p) ? a + 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(ff.content || '') + b : m;
        });
        if (!head) return html;
        if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + head);
        if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + head);
        return head + html;
    };
    P.togglePreview = function (force, path) {
        const open = force !== undefined ? !!force : !this._previewOpen;
        const wrapper = document.querySelector('.studio-editor-wrapper');
        let pane = document.getElementById('studio-preview-pane');
        if (!open) {
            if (pane) pane.remove();
            this._previewOpen = false;
            if (wrapper) wrapper.classList.remove('preview-on');
            if (this.renderEditorToolbar) this.renderEditorToolbar();
            return false;
        }
        if (!this.isCodeStudioOpen) this.toggleCodeStudio(true);
        const target = path || this.previewTargetFor(this.activeStudioFile) || this._previewPath;
        if (!target) { this.showToast('لا يوجد ملف HTML/Markdown/SVG للمعاينة', 'info'); return false; }
        this._previewPath = target;
        if (!pane && wrapper) {
            pane = document.createElement('div');
            pane.id = 'studio-preview-pane';
            pane.className = 'studio-preview-pane';
            pane.innerHTML = `<div class="cm-split-head"><i class="fa-solid fa-eye"></i><select class="cm-split-select" id="preview-select" aria-label="ملف المعاينة" onchange="app._previewPath=this.value; app.refreshPreview()"></select>
                <button type="button" title="تحديث" onclick="app.refreshPreview()"><i class="fa-solid fa-rotate-right"></i></button>
                <button type="button" title="فحص إمكانية الوصول" onclick="app.auditActiveHTML()"><i class="fa-solid fa-universal-access"></i></button>
                <button type="button" title="إغلاق" onclick="app.togglePreview(false)"><i class="fa-solid fa-xmark"></i></button></div>
                <iframe id="studio-preview-frame" class="studio-preview-frame" title="معاينة حية" sandbox="allow-scripts allow-forms allow-modals allow-popups"></iframe>`;
            wrapper.appendChild(pane);
            wrapper.classList.add('preview-on');
        }
        this._previewOpen = true;
        if (!this._previewListener) {
            this._previewListener = (e) => {
                const d = e.data;
                if (!d || d.__oxPreview !== this._previewToken) return;
                const term = this.ensureStudioConsole();
                if (!term) return;
                if (!term.classList.contains('ox-term')) { term.innerHTML = ''; term.classList.add('ox-term'); }
                const line = document.createElement('div');
                line.className = 'term-line term-' + (d.level || 'log');
                line.innerHTML = `<span class="hv-dim">[preview]</span> ${esc(d.text)}`;
                term.appendChild(line);
                term.scrollTop = term.scrollHeight;
            };
            window.addEventListener('message', this._previewListener);
        }
        this.refreshPreview();
        if (this.renderEditorToolbar) this.renderEditorToolbar();
        return true;
    };
    P.refreshPreview = function () {
        const frame = document.getElementById('studio-preview-frame');
        if (!frame || !this._previewPath) return false;
        const sel = document.getElementById('preview-select');
        if (sel) sel.innerHTML = this.projectPaths().filter(p => /\.(html?|svg|md|markdown)$/i.test(p)).map(p => `<option value="${esc(p)}" ${p === this._previewPath ? 'selected' : ''}>${esc(p)}</option>`).join('');
        frame.srcdoc = this.buildPreviewDoc(this._previewPath);
        return true;
    };
    P.onStudioEdit = function (path) {
        if (!this._previewOpen || !this._previewPath) return;
        const target = this._previewPath;
        const content = (this.virtualProjectFiles.get(target) || {}).content || '';
        if (path !== target && !content.includes(intel.baseName(path))) return;
        clearTimeout(this._previewTimer);
        this._previewTimer = setTimeout(() => this.refreshPreview(), 450);
    };
    P.auditActiveHTML = function () {
        const path = (this._previewOpen && this._previewPath) || this.activeStudioFile;
        if (!path || !/\.html?$/i.test(path)) { this.showToast('افتح ملف HTML لفحص إمكانية الوصول', 'info'); return null; }
        const f = this.virtualProjectFiles.get(path);
        const issues = intel.auditHTML((f && f.content) || '', typeof DOMParser !== 'undefined' ? DOMParser : null);
        const sev = { error: 'fa-circle-xmark text-red', warning: 'fa-triangle-exclamation text-amber', info: 'fa-circle-info text-blue' };
        const body = issues.length ? issues.map(i => `<button type="button" class="ref-row" data-path="${esc(path)}" data-line="${i.line || 1}" onclick="app.closeModals(); app.openTermLink(this)"><i class="fa-solid ${sev[i.severity] || sev.info}"></i> <span>${esc(i.message)}</span> <span class="gh-badge">${esc(i.rule)}</span>${i.line ? ` <span class="ref-ln">${i.line}</span>` : ''}</button>`).join('')
            : '<p class="gh-empty">✅ لم تُكتشف مشاكل وصول واضحة</p>';
        const errs = issues.filter(i => i.severity === 'error').length;
        this.openPanel({ title: `فحص إمكانية الوصول — ${path} (${issues.length})`, icon: 'fa-universal-access', body: `<p class="hv-dim">${errs} خطأ • ${issues.length - errs} تحذير/ملاحظة — فحص ثابت لأشهر قواعد WCAG.</p>${body}` });
        return issues;
    };
    return api;
}
