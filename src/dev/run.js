/* #153 Go / PHP / Ruby • #226 mock DB • #228 mock auth • #160 virtual ports (http/express servers) • #230 share a run via link. */
import { esc, call, btn, pbtn, card, empty, field, area, select, val, setHTML, stats, table, extOf, baseName, ago, json, bytesToB64url, b64ToBytes, utf8, fromUtf8, pre, fmtMs } from './util.js';

export const POLY_LANGS = { rb: 'ruby', php: 'php', go: 'go' };
export const POLY_SAMPLES = {
    ruby: `# Ruby 3.4 (ruby.wasm) — يعمل بالكامل في المتصفح\nname = gets&.strip || "OX"\nputs "مرحباً #{name}!"\n[1, 2, 3].each { |n| puts n * n }\n`,
    php: `<?php\n// PHP 8 (php-wasm) — يعمل بالكامل في المتصفح\n$items = [3, 1, 2];\nsort($items);\necho "Sorted: " . implode(', ', $items) . "\\n";\nprintf("PHP %s\\n", PHP_VERSION);\n`,
    go: `// Go — يُترجم ويُشغَّل عبر Wandbox (يتطلب اتصالاً)\npackage main\n\nimport "fmt"\n\nfunc main() {\n\tfor i := 1; i <= 3; i++ {\n\t\tfmt.Println("سطر", i)\n\t}\n}\n`
};
export const SAMPLE_DB = { users: [{ id: 1, name: 'سارة', email: 'sara@example.com', role: 'admin' }, { id: 2, name: 'Omar', email: 'omar@example.com', role: 'user' }], posts: [{ id: 1, title: 'أول منشور', userId: 1, published: true }, { id: 2, title: 'Hello', userId: 2, published: false }], profile: { name: 'OX' } };
export const SAMPLE_AUTH = { secret: 'change-me', expiresIn: '1h', users: [{ id: 1, email: 'admin@example.com', password: 'admin123', name: 'Admin', role: 'admin' }, { id: 2, email: 'user@example.com', password: 'user123', name: 'User', role: 'user' }] };
/** json-server style routes for a db object. */
export function dbRoutes(db) {
    const out = [];
    Object.entries(db || {}).forEach(([k, v]) => {
        if (Array.isArray(v)) out.push(`GET /api/${k}`, `GET /api/${k}/:id`, `POST /api/${k}`, `PUT /api/${k}/:id`, `PATCH /api/${k}/:id`, `DELETE /api/${k}/:id`, `GET /api/${k}?_sort=id&_order=desc&_page=1&_limit=10&q=…`);
        else out.push(`GET /api/${k}`, `PUT /api/${k}`, `PATCH /api/${k}`);
    });
    return out;
}
/** Decode a JWT payload (no verification). */
export function decodeJwt(token) {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    try { return { header: JSON.parse(fromUtf8(b64ToBytes(parts[0]))), payload: JSON.parse(fromUtf8(b64ToBytes(parts[1]))) }; } catch (e) { return null; }
}
/** Share payload ⇄ URL-safe string (deflate-raw when CompressionStream exists; 'z' / 'u' prefix). */
export async function encodeShare(obj) {
    const bytes = utf8(JSON.stringify(obj));
    const CS = globalThis.CompressionStream;
    if (CS) {
        try {
            const buf = await new Response(new Blob([bytes]).stream().pipeThrough(new CS('deflate-raw'))).arrayBuffer();
            return 'z' + bytesToB64url(new Uint8Array(buf));
        } catch (e) { /* fall through */ }
    }
    return 'u' + bytesToB64url(bytes);
}
export async function decodeShare(s) {
    const str = String(s || '').replace(/^#?oxrun=/, '');
    const kind = str[0], data = b64ToBytes(str.slice(1));
    if (kind === 'u') return JSON.parse(fromUtf8(data));
    if (kind === 'z') {
        const DS = globalThis.DecompressionStream;
        if (!DS) throw new Error('المتصفح لا يدعم فك الضغط');
        const buf = await new Response(new Blob([data]).stream().pipeThrough(new DS('deflate-raw'))).arrayBuffer();
        return JSON.parse(fromUtf8(new Uint8Array(buf)));
    }
    throw new Error('رابط مشاركة غير صالح');
}
const capWriter = (sink = []) => ({ lines: sink, line(level, text) { sink.push({ level: level || 'log', text: String(text) }); }, html(cls, h) { sink.push({ level: cls, text: String(h).replace(/<[^>]+>/g, '') }); }, clear() { sink.length = 0; }, text() { return sink.map(l => l.text).join('\n'); } });

export function installRun(P) {
    // ---------------------------------------------------------------- #153 polyglot
    P.createPolyglotWorker = function () { return new Worker('/workers/polyglot.js'); };
    P.dvPolyWorker = function () {
        if (this._dvPoly && this._dvPoly.alive) return this._dvPoly;
        const worker = this.createPolyglotWorker();
        const st = { worker, alive: true, seq: 0, jobs: new Map() };
        worker.onmessage = (e) => { const m = e.data || {}; const j = st.jobs.get(m.id); if (!j) return; if (m.type === 'out') j.onOut(m.stream, m.text); else if (m.type === 'done') { st.jobs.delete(m.id); j.resolve(m); } };
        worker.onerror = (e) => { st.alive = false; st.jobs.forEach(j => j.resolve({ exitCode: 1, error: 'تعذر تشغيل عامل اللغات: ' + ((e && e.message) || 'خطأ') })); st.jobs.clear(); if (this._dvPoly === st) this._dvPoly = null; };
        this._dvPoly = st;
        return st;
    };
    P.dvPolyRun = function ({ lang, code, stdin = '', onOut = () => {} }) {
        const st = this.dvPolyWorker();
        const id = ++st.seq;
        return new Promise((resolve) => { st.jobs.set(id, { onOut, resolve }); st.worker.postMessage({ id, type: 'run', lang, code, stdin }); });
    };
    /** Runner hook: run a .rb / .php / .go file in the terminal. */
    P.dvRunPoly = async function (o) {
        const w = o.writer, lang = this.dvPolyLang(o.path || '') || o.lang;
        const code = o.code != null ? o.code : this.dvRead(o.path) || '';
        if (o.banner !== false) w.line('info', `▶ ${o.path || lang} (${lang}${lang === 'go' ? ' — Wandbox' : ' — WASM'})`);
        const logs = [];
        const r = await this.dvPolyRun({ lang, code, stdin: o.stdin || '', onOut: (stream, text) => { String(text).replace(/\n$/, '').split('\n').forEach(l => { logs.push(l); w.line(stream === 'stderr' ? 'error' : stream === 'info' ? 'info' : 'log', l); }); } });
        if (r.error) w.line('error', '❌ ' + r.error);
        return { success: !r.exitCode && !r.error, error: r.error || (r.exitCode ? 'exit code ' + r.exitCode : undefined), logs: logs.join('\n'), exitCode: r.exitCode || 0 };
    };
    P.dvPolyglot = async function (o = {}) {
        const act = this.activeStudioFile && POLY_LANGS[extOf(this.activeStudioFile)] ? this.activeStudioFile : null;
        const lang = o.lang || (act ? POLY_LANGS[extOf(act)] : (this._dvPolyLang || 'ruby'));
        const codeTxt = act && POLY_LANGS[extOf(act)] === lang ? this.dvRead(act) : (this._dvPolyCode && this._dvPolyCode[lang]) || POLY_SAMPLES[lang];
        return card('تشغيل Go / PHP / Ruby', `<p class="hv-dim">Ruby و PHP يعملان محلياً عبر WebAssembly داخل عامل منفصل (تحميل أول مرة بعدة ميغابايت). Go يُرسل إلى خدمة Wandbox العامة للترجمة — يتطلب اتصالاً ويغادر الكود جهازك. ملفات <code>.rb / .php / .go</code> تعمل أيضاً من زر «تشغيل» في المحرر.</p>
            <div class="gh-row">${select('dv-poly-lang', 'اللغة', [['ruby', 'Ruby 3.4 (WASM)'], ['php', 'PHP 8 (WASM)'], ['go', 'Go (Wandbox)']], lang, `onchange="app._dvPolyLang=this.value;app.dvLoad('run','polyglot',{lang:this.value})"`)}</div>
            ${area('dv-poly-code', act ? 'الكود — ' + esc(act) : 'الكود', codeTxt, 12, 'dir="ltr" spellcheck="false" class="form-input-box dvx-code"')}
            ${area('dv-poly-stdin', 'مدخلات (stdin)', '', 2, 'dir="ltr"')}
            <div class="gh-row">${pbtn('fa-play', 'تشغيل', 'app.dvPolyRunUI()')}${btn('fa-file-circle-plus', 'حفظ كملف', 'app.dvPolySave()')}</div>
            <div id="dv-poly-out"></div>`, 'fa-language');
    };
    P.dvPolyRunUI = async function () {
        const lang = val('dv-poly-lang'), code = val('dv-poly-code');
        this._dvPolyCode = { ...(this._dvPolyCode || {}), [lang]: code };
        const lines = [];
        const paint = () => setHTML('dv-poly-out', `<pre class="pfx-pre dvx-pre dvx-term" dir="ltr">${lines.map(l => `<span class="dvx-${l.s}">${esc(l.t)}</span>`).join('')}</pre>`);
        lines.push({ s: 'info', t: '⏳ …\n' }); paint();
        const r = await this.dvPolyRun({ lang, code, stdin: val('dv-poly-stdin'), onOut: (s, t) => { lines.push({ s, t }); paint(); } });
        lines.push({ s: r.exitCode || r.error ? 'stderr' : 'info', t: `\n${r.error ? '❌ ' + r.error : '✅ انتهى'} • ${fmtMs(r.ms)}${r.remote ? ' • Wandbox' : ''}\n` });
        paint();
        return r;
    };
    P.dvPolySave = async function () {
        const lang = val('dv-poly-lang'), ext = { ruby: 'rb', php: 'php', go: 'go' }[lang];
        const name = await this.askText('اسم الملف', `main.${ext}`);
        if (!name) return null;
        this.createProjectFile(this.uniqueProjectPath ? this.uniqueProjectPath(name) : name, val('dv-poly-code'));
        return name;
    };

    // ---------------------------------------------------------------- shared: run a JS snippet in the sandbox and capture its output
    P.dvRunSnippet = async function (codeText, { cfg, timeoutMs = 15000, path = '__dv__/request.js' } = {}) {
        if (!(await this.ensureRunner({ quiet: true }))) throw new Error('تعذر تحميل المشغل');
        const w = capWriter();
        const res = await this.runJS({ code: codeText, virtualPath: path, writer: w, banner: false, detached: true, timeoutMs, cfg });
        return { ...res, lines: w.lines, out: w.lines.filter(l => l.level !== 'info').map(l => l.text).join('\n') };
    };

    // ---------------------------------------------------------------- #226 mock DB
    P.dvDbPath = function () { return ['mocks/db.json', 'mock/db.json', 'db.json'].find(p => this.virtualProjectFiles.has(p)) || null; };
    P.dvMockDB = async function () {
        const p = this.dvDbPath();
        let db = null;
        try { db = p ? JSON.parse(this.dvRead(p)) : null; } catch (e) { db = null; }
        const cols = db ? Object.entries(db).map(([k, v]) => [k, Array.isArray(v) ? v.length + ' سجل' : 'كائن مفرد']) : [];
        return card('قاعدة بيانات وهمية (REST على نمط json-server)', `<p class="hv-dim">كل تشغيل JS يقرأ <code>mocks/db.json</code> ويخدم <code>/api/&lt;مجموعة&gt;</code> و<code>/&lt;مجموعة&gt;</code> عبر fetch (GET/POST/PUT/PATCH/DELETE، الفلترة، الترتيب، الصفحات، البحث q) — بالإضافة إلى <code>require('ox-db')</code> للوصول المباشر. التغييرات تبقى في الذاكرة أثناء التشغيل.</p>
            ${db ? stats([['مجموعات', cols.length], ['ملف', `<span dir="ltr">${esc(p)}</span>`]]) + table(['المجموعة', 'المحتوى'], cols.map(([k, v]) => [`<code>${esc(k)}</code>`, v])) : empty('لا يوجد mocks/db.json بعد')}
            <div class="gh-row">${db ? '' : pbtn('fa-database', 'إنشاء قاعدة نموذجية', 'app.dvMockDBCreate()')}${p ? btn('fa-pen', 'تحرير', call('openProjectFile', p)) : ''}${this._lastMockDb ? btn('fa-floppy-disk', 'حفظ حالة آخر تشغيل', 'app.dvMockDBSave()') : ''}${btn('fa-code', 'إدراج مثال عميل', 'app.dvMockDBSample()')}</div>
            ${db ? `<details><summary>المسارات المتاحة</summary>${pre(dbRoutes(db).join('\n'))}</details>` : ''}`, 'fa-database')
            + card('اختبار طلب', `<div class="dvx-grid3">${select('dv-db-m', 'الطريقة', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(x => [x, x]), 'GET')}${field('dv-db-path', 'المسار', db ? `/api/${Object.keys(db)[0]}` : '/api/users', 'dir="ltr"')}</div>${area('dv-db-body', 'الجسم (JSON)', '', 3, 'dir="ltr" placeholder=\'{"name":"Ali"}\'')}
            <div class="gh-row">${pbtn('fa-paper-plane', 'إرسال', 'app.dvMockRequest()')}</div><div id="dv-db-res"></div>`, 'fa-paper-plane');
    };
    P.dvMockDBCreate = function () { this.createProjectFile('mocks/db.json', JSON.stringify(SAMPLE_DB, null, 2) + '\n', { open: false }); this.dvRefresh(); return 'mocks/db.json'; };
    P.dvMockDBSave = function () { if (!this._lastMockDb) return null; const p = this.dvDbPath() || 'mocks/db.json'; this.writeProjectFile(p, JSON.stringify(this._lastMockDb, null, 2) + '\n', 'mock-db'); this.showToast('✅ حُفظت حالة القاعدة في ' + p, 'success'); return p; };
    P.dvMockDBSample = function () {
        const code = `// عميل لقاعدة البيانات الوهمية (mocks/db.json)\nconst api = (p, o = {}) => fetch('/api' + p, { headers: { 'Content-Type': 'application/json' }, ...o }).then(r => r.json());\n\nconst users = await api('/users?_sort=name');\nconsole.log('users:', users.length);\nconst created = await api('/users', { method: 'POST', body: JSON.stringify({ name: 'Ali', role: 'user' }) });\nconsole.log('created id', created.id);\nawait api('/users/' + created.id, { method: 'PATCH', body: JSON.stringify({ role: 'admin' }) });\nconsole.log(await api('/users/' + created.id));\n\n// أو مباشرة:\nconst db = require('ox-db');\nconsole.log(db.find('posts', { published: 'true' }));\n`;
        const p = this.uniqueProjectPath ? this.uniqueProjectPath('db-client.js') : 'db-client.js';
        this.createProjectFile(p, code);
        return p;
    };
    P.dvMockRequest = async function (req) {
        const r = req || { method: val('dv-db-m'), path: val('dv-db-path'), body: val('dv-db-body') };
        const init = { method: r.method || 'GET', headers: { 'Content-Type': 'application/json', ...(r.headers || {}) } };
        if (r.body && !/^(GET|DELETE)$/.test(init.method)) init.body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
        const snippet = `const __r = await fetch(${JSON.stringify(r.path)}, ${JSON.stringify(init)});\nconst __t = await __r.text();\nconsole.log('@@' + JSON.stringify({ status: __r.status, total: __r.headers.get('x-total-count'), body: __t }));\n`;
        this.dvBusy('dv-db-res');
        try {
            const out = await this.dvRunSnippet(snippet);
            const line = out.lines.find(l => /^@@/.test(l.text));
            if (!line) throw new Error(out.error || 'لا استجابة');
            const res = JSON.parse(line.text.slice(2));
            let body = res.body;
            try { body = JSON.stringify(JSON.parse(res.body), null, 2); } catch (e) { /* text */ }
            setHTML('dv-db-res', `${stats([['الحالة', res.status], ...(res.total ? [['x-total-count', res.total]] : [])])}${pre(body)}`);
            return res;
        } catch (e) { return this.dvErr(e, 'dv-db-res'); }
    };

    // ---------------------------------------------------------------- #228 mock auth
    P.dvMockAuth = async function () {
        const p = ['mocks/auth.json', 'mock/auth.json'].find(x => this.virtualProjectFiles.has(x));
        let cfg = null;
        try { cfg = p ? JSON.parse(this.dvRead(p)) : null; } catch (e) { cfg = null; }
        const users = cfg ? (Array.isArray(cfg) ? cfg : cfg.users || []) : [];
        return card('مصادقة وهمية (JWT)', `<p class="hv-dim">مع وجود <code>mocks/auth.json</code> يوفّر كل تشغيل: <code>POST /auth/register</code>، <code>POST /auth/login</code>، <code>GET /auth/me</code> (Bearer)، <code>POST /auth/logout</code>، و<code>require('ox-auth')</code> (sign / verify / middleware(role) لـ Express). كما تتوفر بدائل وهمية لـ <code>jsonwebtoken</code> و<code>bcryptjs</code> — للتطوير والاختبار فقط، لا تشفير حقيقي.</p>
            ${cfg ? table(['البريد', 'الدور', 'كلمة المرور'], users.map(u => [esc(u.email), esc(u.role || 'user'), u.password ? '••••' : (u.passwordHash ? 'hash' : '—')])) : empty('لا يوجد mocks/auth.json بعد')}
            <div class="gh-row">${cfg ? btn('fa-pen', 'تحرير', call('openProjectFile', p)) : pbtn('fa-user-shield', 'إنشاء مستخدمين نموذجيين', 'app.dvMockAuthCreate()')}${btn('fa-code', 'مثال Express محمي', 'app.dvMockAuthSample()')}</div>`, 'fa-user-shield')
            + card('تجربة تسجيل الدخول', `<div class="dvx-grid2">${field('dv-au-email', 'البريد', users[0] ? users[0].email : 'admin@example.com', 'dir="ltr"')}${field('dv-au-pass', 'كلمة المرور', users[0] && users[0].password ? users[0].password : '', 'dir="ltr" type="password"')}</div>
            <div class="gh-row">${pbtn('fa-right-to-bracket', 'دخول', 'app.dvMockLogin()')}</div><div id="dv-au-res"></div>`, 'fa-key')
            + card('فك رمز JWT', `${field('dv-jwt', 'الرمز', this._dvToken || '', 'dir="ltr" oninput="app.dvJwtDecodeUI()"')}<div id="dv-jwt-res">${this._dvToken ? pre(json(decodeJwt(this._dvToken))) : ''}</div>`, 'fa-unlock');
    };
    P.dvMockAuthCreate = function () { this.createProjectFile('mocks/auth.json', JSON.stringify(SAMPLE_AUTH, null, 2) + '\n', { open: false }); this.dvRefresh(); return 'mocks/auth.json'; };
    P.dvMockAuthSample = function () {
        const code = `const express = require('express');\nconst auth = require('ox-auth');\nconst app = express();\napp.use(express.json());\n\napp.post('/login', (req, res) => {\n    const r = auth.login(req.body);\n    res.status(r.status).json(r.body);\n});\napp.get('/me', auth.middleware(), (req, res) => res.json({ user: req.user }));\napp.get('/admin', auth.middleware('admin'), (req, res) => res.json({ secret: 42 }));\n\napp.listen(3000, () => console.log('API على المنفذ 3000 — جرّبها من مختبر المطور › المنافذ'));\n`;
        const p = this.uniqueProjectPath ? this.uniqueProjectPath('auth-server.js') : 'auth-server.js';
        this.createProjectFile(p, code);
        return p;
    };
    P.dvMockLogin = async function (email, password) {
        const body = { email: email || val('dv-au-email'), password: password != null ? password : val('dv-au-pass') };
        const snippet = `const __r = await fetch('/auth/login', { method: 'POST', body: ${JSON.stringify(JSON.stringify(body))} });\nconst __b = await __r.json();\nlet __me = null;\nif (__b.token) __me = await (await fetch('/auth/me', { headers: { Authorization: 'Bearer ' + __b.token } })).json();\nconsole.log('@@' + JSON.stringify({ status: __r.status, body: __b, me: __me }));\n`;
        this.dvBusy('dv-au-res');
        try {
            const out = await this.dvRunSnippet(snippet);
            const line = out.lines.find(l => /^@@/.test(l.text));
            if (!line) throw new Error(out.error || 'لا استجابة — هل يوجد mocks/auth.json؟');
            const res = JSON.parse(line.text.slice(2));
            if (res.body && res.body.token) this._dvToken = res.body.token;
            setHTML('dv-au-res', `${stats([['الحالة', res.status]])}${pre(json(res.body))}${res.me ? '<b>GET /auth/me</b>' + pre(json(res.me)) : ''}`);
            const jt = document.getElementById('dv-jwt'); if (jt && this._dvToken) { jt.value = this._dvToken; this.dvJwtDecodeUI(); }
            return res;
        } catch (e) { return this.dvErr(e, 'dv-au-res'); }
    };
    P.dvJwtDecodeUI = function () { const d = decodeJwt(val('dv-jwt')); setHTML('dv-jwt-res', d ? pre(json(d)) + (d.payload.exp ? `<small class="hv-dim">ينتهي ${new Date(d.payload.exp * 1000).toLocaleString('ar')}</small>` : '') : empty('رمز غير صالح')); };

    // ---------------------------------------------------------------- #160 ports
    P.dvServers = function () { return this._dvServers || (this._dvServers = new Map()); };
    P.dvStartServer = async function (path) {
        const entry = path || val('dv-srv-file') || (this.detectProjectEntry && this.detectProjectEntry());
        if (!entry || !this.virtualProjectFiles.has(entry)) { this.showToast('اختر ملف الخادم (JS/TS)', 'warning'); return null; }
        if (!(await this.ensureRunner({ quiet: true }))) return null;
        const logs = [];
        let env = {};
        try { env = this.getRunEnv ? await this.getRunEnv() : {}; } catch (e) { env = {}; }
        const srv = { path: entry, ports: [], logs, startedAt: Date.now(), pending: new Map(), seq: 0, handle: null };
        const w = { line: (level, text) => { logs.push({ level, text: String(text), t: Date.now() }); if (logs.length > 300) logs.shift(); this.dvPortsPaintLog(); }, html: (c, h) => w.line(c, String(h).replace(/<[^>]+>/g, '')), clear: () => { logs.length = 0; }, text: () => logs.map(l => l.text).join('\n') };
        const started = new Promise((resolve) => {
            const done = this.runJS({ path: entry, entry, writer: w, detached: true, env, onStart: (h) => { srv.handle = h; },
                onMessage: (m) => {
                    if (m.type === 'listen') { srv.ports.push(m.port); this.dvServers().set(m.port, srv); resolve(m.port); this.dvPortsPaint(); }
                    else if (m.type === 'close') { srv.ports = srv.ports.filter(p => p !== m.port); this.dvServers().delete(m.port); this.dvPortsPaint(); }
                    else if (m.type === 'res') { const p = srv.pending.get(m.id); if (p) { srv.pending.delete(m.id); p(m); } }
                } });
            done.then((r) => { srv.ports.forEach(p => this.dvServers().delete(p)); srv.ports = []; srv.ended = r; resolve(null); this.dvPortsPaint(); });
        });
        const port = await started;
        if (!port) this.showToast('انتهى البرنامج دون أن يستمع على منفذ — استخدم app.listen(PORT) أو http.createServer().listen(PORT)', 'warning');
        return port;
    };
    P.dvRequest = function (port, req = {}) {
        const srv = this.dvServers().get(+port);
        if (!srv || !srv.handle) return Promise.reject(new Error('لا يوجد خادم على المنفذ ' + port));
        const id = ++srv.seq;
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => { srv.pending.delete(id); reject(new Error('انتهت مهلة الطلب')); }, 15000);
            srv.pending.set(id, (m) => { clearTimeout(t); resolve(m); });
            srv.handle.send({ type: 'req', id, port: +port, method: req.method || 'GET', url: req.path || req.url || '/', headers: req.headers || {}, body: req.body });
        });
    };
    P.dvStopServer = function (port) {
        const srv = this.dvServers().get(+port);
        if (!srv) return false;
        try { srv.handle.stop(true); } catch (e) { /* gone */ }
        srv.ports.forEach(p => this.dvServers().delete(p));
        this.dvPortsPaint();
        return true;
    };
    P.dvPorts = async function () {
        const files = this.dvTextFiles(p => /\.(m?[jt]s|cjs)$/.test(p) && /listen\s*\(/.test(this.dvRead(p) || '')).map(([p]) => p);
        const def = files[0] || (this.detectProjectEntry && this.detectProjectEntry()) || '';
        this._dvMount = () => this.dvPortsPaint();
        return card('المنافذ والخوادم الافتراضية', `<p class="hv-dim">شغّل خادم <code>express</code> أو <code>http.createServer</code> من مشروعك داخل الصندوق المعزول؛ كل <code>listen(PORT)</code> يظهر هنا كمنفذ مفتوح يمكنك إرسال طلبات إليه ومعاينة الاستجابة. داخل البرنامج نفسه يعمل <code>fetch('http://localhost:PORT/...')</code> أيضاً.</p>
            <div class="gh-row">${files.length ? select('dv-srv-file', 'ملف الخادم', files.map(f => [f, f]), def) : field('dv-srv-file', 'ملف الخادم', def, 'dir="ltr"')}${pbtn('fa-play', 'تشغيل الخادم', 'app.dvStartServer()')}${btn('fa-code', 'مثال Express', 'app.dvMockAuthSample()')}</div>
            <div id="dv-ports"></div>`, 'fa-network-wired')
            + card('إرسال طلب', `<div class="dvx-grid3">${select('dv-rq-m', 'الطريقة', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(x => [x, x]), 'GET')}${field('dv-rq-port', 'المنفذ', '3000', 'dir="ltr" type="number"')}${field('dv-rq-path', 'المسار', '/', 'dir="ltr"')}</div>
            ${area('dv-rq-headers', 'الترويسات (JSON)', '{"Content-Type":"application/json"}', 2, 'dir="ltr"')}${area('dv-rq-body', 'الجسم', '', 3, 'dir="ltr"')}
            <div class="gh-row">${pbtn('fa-paper-plane', 'إرسال', 'app.dvRequestUI()')}</div><div id="dv-rq-res"></div>`, 'fa-paper-plane')
            + card('سجل الخادم', '<div id="dv-srv-log"></div>', 'fa-scroll');
    };
    P.dvPortsPaint = function () {
        const list = Array.from(this.dvServers().entries());
        setHTML('dv-ports', list.length ? table(['المنفذ', 'الملف', 'منذ', ''], list.map(([port, s]) => [`<b>:${port}</b>`, `<span dir="ltr">${esc(s.path)}</span>`, ago(s.startedAt), btn('fa-paper-plane', 'طلب', `document.getElementById('dv-rq-port').value=${port}`, 'gh-chip') + btn('fa-stop', 'إيقاف', call('dvStopServer', port), 'gh-chip')])) : empty('لا توجد منافذ مفتوحة'));
    };
    P.dvPortsPaintLog = function () {
        const el = document.getElementById('dv-srv-log');
        if (!el) return;
        const all = Array.from(new Set(Array.from(this.dvServers().values()))).flatMap(s => s.logs).slice(-80);
        el.innerHTML = all.length ? `<pre class="pfx-pre dvx-pre" dir="ltr">${all.map(l => esc(l.text)).join('\n')}</pre>` : '';
    };
    P.dvRequestUI = async function () {
        let headers = {};
        try { headers = JSON.parse(val('dv-rq-headers') || '{}'); } catch (e) { return this.dvErr(new Error('ترويسات JSON غير صالحة'), 'dv-rq-res'); }
        const body = val('dv-rq-body');
        this.dvBusy('dv-rq-res');
        try {
            let parsed = body;
            if (body && /json/i.test(headers['Content-Type'] || headers['content-type'] || '')) { try { parsed = JSON.parse(body); } catch (e) { parsed = body; } }
            const r = await this.dvRequest(+val('dv-rq-port'), { method: val('dv-rq-m'), path: val('dv-rq-path'), headers, body: body ? parsed : undefined });
            const ct = (r.headers && r.headers['content-type']) || '';
            let shown = r.body;
            if (/json/.test(ct)) { try { shown = JSON.stringify(JSON.parse(r.body), null, 2); } catch (e) { /* raw */ } }
            setHTML('dv-rq-res', `${stats([['الحالة', r.status], ['الزمن', fmtMs(r.ms)], ['الحجم', (r.body || '').length + ' B']])}
                <details><summary>الترويسات</summary>${pre(Object.entries(r.headers || {}).map(([k, v]) => k + ': ' + v).join('\n'))}</details>
                ${/html/.test(ct) ? `<iframe class="dvx-frame" sandbox="" srcdoc="${esc(r.body)}" title="معاينة"></iframe>` : ''}${pre(shown)}`);
            return r;
        } catch (e) { return this.dvErr(e, 'dv-rq-res'); }
    };

    // ---------------------------------------------------------------- #230 share
    P.dvShare = async function () {
        let hist = [];
        await this._runHistQ; // pending history writes land first
        try { hist = (this.idbGet && (await this.idbGet('run_history_v1'))) || []; } catch (e) { hist = []; }
        const last = this._lastRunRecord;
        const list = (last && !hist.some(h => h.at === last.at) ? [last] : []).concat(hist).slice(0, 15);
        this._dvShareList = list;
        return card('مشاركة نتيجة تشغيل برابط', `<p class="hv-dim">يُضغط الكود والمخرجات داخل الرابط نفسه (بعد #) — لا يُرفع شيء إلى أي خادم. من يفتح الرابط يرى الكود والنتيجة ويمكنه إعادة التشغيل.</p>
            ${list.length ? `<div class="fmx-list">${list.map((r, i) => `<div class="fmx-item"><div><b dir="ltr">${esc(r.path || r.lang || 'snippet')}</b> ${r.success ? '✅' : '❌'}<small>${ago(r.at)} • ${r.durationMs || 0}ms • ${esc(r.mode || 'run')}</small><small dir="ltr">${esc(String(r.output || r.error || '').slice(0, 120))}</small></div>${btn('fa-link', 'رابط', call('dvShareRun', i))}</div>`).join('')}</div>` : empty('لا توجد تشغيلات بعد — شغّل ملفاً من المحرر ثم عد هنا')}
            <div id="dv-share-res"></div>`, 'fa-share-nodes');
    };
    P.dvShareRun = async function (i) {
        const r = typeof i === 'object' ? i : (this._dvShareList || [])[i];
        if (!r) return null;
        const code = r.code != null ? r.code : (r.path && this.dvRead(r.path)) || '';
        const payload = { v: 1, path: r.path || null, lang: r.lang || 'js', code: code.slice(0, 30000), output: String(r.output || '').slice(0, 10000), error: r.error || null, success: !!r.success, ms: r.durationMs || 0, at: r.at || Date.now() };
        const enc = await encodeShare(payload);
        const loc = typeof location !== 'undefined' ? location : { origin: '', pathname: '/' };
        const url = `${loc.origin}${loc.pathname}#oxrun=${enc}`;
        this._dvShareUrl = url;
        setHTML('dv-share-res', `${field('dv-share-url', `الرابط (${url.length} حرفاً${url.length > 8000 ? ' — طويل، قد لا تقبله بعض المنصات' : ''})`, url, 'dir="ltr" readonly onclick="this.select()"')}<div class="gh-row">${pbtn('fa-copy', 'نسخ', 'app.copyText(app._dvShareUrl, \'تم نسخ الرابط\')')}${typeof navigator !== 'undefined' && navigator.share ? btn('fa-share-nodes', 'مشاركة', 'navigator.share({title:\'OX run\', url: app._dvShareUrl}).catch(()=>{})') : ''}</div>`);
        return url;
    };
    P.dvOpenShareHash = async function (hash) {
        let d;
        try { d = await decodeShare(hash || (typeof location !== 'undefined' ? location.hash : '')); } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
        this._dvShared = d;
        const body = `<div class="dvx-share"><p><b dir="ltr">${esc(d.path || d.lang)}</b> ${d.success ? '✅ نجح' : '❌ فشل'} • ${d.ms}ms • ${new Date(d.at).toLocaleString('ar')}</p>
            <b>الكود</b><pre class="pfx-pre dvx-pre" dir="ltr">${esc(d.code)}</pre><b>المخرجات</b><pre class="pfx-pre dvx-pre dvx-term" dir="ltr">${esc(d.output || '')}${d.error ? '\n❌ ' + esc(d.error) : ''}</pre></div>`;
        const res = await this.showDialog({ title: 'نتيجة تشغيل مُشاركة', body, wide: true, buttons: [{ label: 'فتح كملف', value: 'open', primary: true }, { label: 'تشغيل', value: 'run' }, { label: 'إغلاق', value: null }] });
        if (res && (res.button === 'open' || res.button === 'run')) {
            const name = 'shared/' + baseName(d.path || ('snippet.' + (d.lang === 'py' ? 'py' : 'js')));
            const p = this.uniqueProjectPath ? this.uniqueProjectPath(name) : name;
            this.createProjectFile(p, d.code);
            if (res.button === 'run' && this.runStudioCode) { this.activeStudioFile = p; await this.studio('runCode', { path: p, entry: p, lang: d.lang === 'py' ? 'py' : 'js', terminal: this.ensureStudioConsole ? this.ensureStudioConsole() : null, source: 'share' }); }
            return p;
        }
        return d;
    };
}
