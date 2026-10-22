/* #987 local REST API (service worker + postMessage bridge) • #988 VS Code • #989 Chrome • #990 CLI */
import { esc, btn, pbtn, card, empty, field, select, area, table, toggle, pre, code } from './util.js';
import { vscodeFiles, chromeFiles, cliFiles } from './extfiles.js';

// ====================================================================== API description
export const API_ROUTES = [
    ['GET', '/api/v1', 'معلومات ونقاط النهاية', false],
    ['GET', '/api/v1/openapi.json', 'مواصفات OpenAPI 3', false],
    ['GET', '/api/v1/status', 'الحالة: الإصدار، عدد الملفات، المستودع', true],
    ['GET', '/api/v1/files', 'قائمة ملفات المشروع (?q= للتصفية)', true],
    ['GET', '/api/v1/files/{path}', 'محتوى ملف', true],
    ['PUT', '/api/v1/files/{path}', 'إنشاء/تعديل ملف {content}', true],
    ['DELETE', '/api/v1/files/{path}', 'حذف ملف', true],
    ['GET', '/api/v1/sessions', 'المحادثات', true],
    ['POST', '/api/v1/chat', 'سؤال للذكاء {message, model?}', true],
    ['POST', '/api/v1/run', 'تشغيل JS {path} أو {code}', true],
    ['POST', '/api/v1/search', 'بحث في الكود {query}', true]
];
export function apiSpec(version = '') {
    const paths = {};
    API_ROUTES.forEach(([m, p, d, auth]) => {
        const key = p.replace('{path}', '{path}');
        paths[key] = paths[key] || {};
        paths[key][m.toLowerCase()] = { summary: d, security: auth ? [{ bearer: [] }] : [], parameters: p.includes('{path}') ? [{ name: 'path', in: 'path', required: true, schema: { type: 'string' } }] : undefined, responses: { 200: { description: 'OK' }, 401: { description: 'Unauthorized' } } };
    });
    return { openapi: '3.0.3', info: { title: 'OX-Alpha Local API', version: version || '1', description: 'Served by the OX-Alpha service worker from the open tab. Same-origin fetch or window.postMessage({oxApi}).' }, servers: [{ url: '/' }], components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } }, paths };
}
export const apiToken = () => 'oxk_' + Array.from(crypto.getRandomValues(new Uint8Array(18)), b => b.toString(16).padStart(2, '0')).join('');

export function installExt(P) {
    // ---------------------------------------------------------------- #987 router (pure-ish: only uses app APIs)
    P.ixApiHandle = async function (req) {
        const c = this.ixCfg('api');
        const method = String(req.method || 'GET').toUpperCase();
        const p = String(req.path || '').replace(/\/+$/, '') || '/api/v1';
        const ok = (body, status = 200) => ({ status, body });
        const err = (status, error) => ({ status, body: { error } });
        if (!c.on) return err(503, 'API disabled — enable it in OX-Alpha → Integrations → REST API');
        if (p === '/api/v1' && method === 'GET') return ok({ name: 'OX-Alpha Local API', version: ((window.OX_BUILD || {}).version || ''), endpoints: API_ROUTES.map(([m, r, d]) => `${m} ${r} — ${d}`) });
        if (p === '/api/v1/openapi.json') return ok(apiSpec(((window.OX_BUILD || {}).version || '')));
        const auth = String(req.auth || (req.token ? 'Bearer ' + req.token : ''));
        if (!c.token || auth !== 'Bearer ' + c.token) return err(401, 'Missing or invalid bearer token');
        this._ixApiLog = [{ method, path: p, at: Date.now() }, ...(this._ixApiLog || [])].slice(0, 30);
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const fileRe = /^\/api\/v1\/files\/(.+)$/;
        let m;
        try {
            if (p === '/api/v1/status' && method === 'GET') return ok({ version: ((window.OX_BUILD || {}).version || ''), files: this.virtualProjectFiles.size, sessions: (this.sessions || []).length, repo: this.settings.githubOwner && this.settings.githubRepo ? `${this.settings.githubOwner}/${this.settings.githubRepo}` : null, activeFile: this.activeStudioFile || null, online: navigator.onLine });
            if (p === '/api/v1/files' && method === 'GET') { const q = String((req.query || {}).q || '').toLowerCase(); return ok([...this.virtualProjectFiles].filter(([path]) => !q || path.toLowerCase().includes(q)).map(([path, f]) => ({ path, size: (f.content || f.dataUrl || '').length, binary: !!f.dataUrl }))); }
            if ((m = fileRe.exec(p))) {
                const path = decodeURIComponent(m[1]).replace(/^\/+/, '');
                if (/(^|\/)\.\.(\/|$)/.test(path)) return err(400, 'Invalid path');
                if (method === 'GET') { const f = this.virtualProjectFiles.get(path); return f ? ok({ path, content: f.content != null ? f.content : null, dataUrl: f.dataUrl || undefined }) : err(404, 'Not found: ' + path); }
                if (method === 'PUT' || method === 'POST') { if (typeof body.content !== 'string') return err(400, 'Body must be {"content": "..."}'); const existed = this.virtualProjectFiles.has(path); this.writeProjectFile(path, body.content, 'api'); if (this.scheduleProjectSave) this.scheduleProjectSave(); return ok({ path, created: !existed, size: body.content.length }, existed ? 200 : 201); }
                if (method === 'DELETE') { if (!this.virtualProjectFiles.has(path)) return err(404, 'Not found'); if (this.deleteProjectPaths) this.deleteProjectPaths([path], { toast: false }); else this.virtualProjectFiles.delete(path); return ok({ path, deleted: true }); }
            }
            if (p === '/api/v1/sessions' && method === 'GET') return ok((this.sessions || []).slice(0, 100).map(s => ({ id: s.id, title: s.title, messages: (s.messages || []).length, updated: s.updatedAt || s.createdAt || null })));
            if (p === '/api/v1/chat' && method === 'POST') {
                if (!body.message) return err(400, 'Body must be {"message": "..."}');
                const answer = await this.ixAI(String(body.message), { system: body.system, maxTokens: Math.min(+body.maxTokens || 2000, 8000), quiet: true });
                return answer == null ? err(424, 'No AI key configured in OX-Alpha') : ok({ answer });
            }
            if (p === '/api/v1/run' && method === 'POST') {
                if (!(await this.ensureRunner({ quiet: true }))) return err(500, 'Runner unavailable');
                const lines = [];
                const w = { line: (lvl, t) => lines.push({ level: lvl, text: String(t) }), html: (cls, h) => lines.push({ level: cls, text: String(h).replace(/<[^>]+>/g, '') }), clear() {} };
                const r = await this.runJS({ writer: w, path: body.path || 'api-snippet.js', code: body.code != null ? String(body.code) : undefined, entry: body.path, detached: true, timeoutMs: Math.min(+body.timeoutMs || 15000, 60000) });
                return ok({ success: !!r.success, error: r.error || null, output: lines });
            }
            if (p === '/api/v1/search' && method === 'POST') {
                const q = String(body.query || '');
                if (!q) return err(400, 'Body must be {"query": "..."}');
                const hits = [];
                this.ixFiles().forEach(([path, t]) => t.split('\n').forEach((l, i) => { if (hits.length < 200 && l.toLowerCase().includes(q.toLowerCase())) hits.push({ path, line: i + 1, text: l.trim().slice(0, 200) }); }));
                return ok({ query: q, hits });
            }
            return err(404, `No route ${method} ${p}`);
        } catch (e) { return err(500, e.message || String(e)); }
    };
    P.ixApiInstall = function () {
        if (this._ixApiOn) return false;
        this._ixApiOn = true;
        if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', (e) => {
            if (!e.data || e.data.type !== 'ox-api' || !e.ports || !e.ports[0]) return;
            this.ixApiHandle(e.data.req).then(r => e.ports[0].postMessage(r), x => e.ports[0].postMessage({ status: 500, body: { error: x.message } }));
        });
        // postMessage bridge — same-origin frames/tabs and the Chrome extension (MAIN-world script). Other origins only if allow-listed.
        window.addEventListener('message', (e) => {
            const q = e.data && e.data.oxApi;
            if (!q || !q.id) return;
            const allowed = e.origin === location.origin || (this.ixCfg('api').origins || []).includes(e.origin);
            if (!allowed) return;
            this.ixApiHandle({ method: q.method, path: q.path, body: q.body, token: q.token, query: q.query }).then(r => { try { (e.source || window).postMessage({ oxApiReply: q.id, ...r }, e.origin === 'null' ? '*' : e.origin); } catch (x) { /* window closed */ } });
        });
        return true;
    };
    P._ixBootFns.api = function () { this.ixApiInstall(); };
    P.ixApiEnable = function (on) {
        const c = this.ixCfg('api');
        this.ixSave('api', { on: !!on, token: c.token || apiToken() });
        this.ixBootSet('api', !!on);
        if (on) this.ixApiInstall();
        this.ixRefresh();
        return this.ixCfg('api');
    };
    P.ixApiRotate = function () { this.ixSave('api', { token: apiToken() }); this.ixRefresh(); return this.ixCfg('api').token; };
    P.ixApiTry = async function () {
        const v = (id) => (document.getElementById(id) || {}).value || '';
        const method = v('ix-api-m') || 'GET', path = v('ix-api-p') || '/api/v1/status';
        let body = null;
        try { body = v('ix-api-b').trim() ? JSON.parse(v('ix-api-b')) : null; } catch (e) { this.showToast('JSON غير صالح', 'warning'); return null; }
        const t0 = performance.now();
        let r;
        try {
            const res = await fetch(path, { method, headers: { Authorization: 'Bearer ' + (this.ixCfg('api').token || ''), 'Content-Type': 'application/json' }, body: body && method !== 'GET' ? JSON.stringify(body) : undefined });
            const text = await res.text();
            r = { status: res.status, body: (() => { try { return JSON.parse(text); } catch (e) { return text; } })(), via: 'service worker' };
            if (!/json/.test(res.headers.get('content-type') || '')) throw new Error('no sw');
        } catch (e) { r = { ...(await this.ixApiHandle({ method, path, body, token: this.ixCfg('api').token })), via: 'مباشر (لا يوجد Service Worker نشط)' }; }
        this.ixOut('ix-api-out', `<small class="hv-dim">${r.status} • ${Math.round(performance.now() - t0)}ms • ${esc(r.via)}</small>${pre(JSON.stringify(r.body, null, 2))}`);
        return r;
    };
    P.ixApi = async function () {
        const c = this.ixCfg('api');
        const curl = `fetch('/api/v1/files', { headers: { Authorization: 'Bearer ${c.token || 'TOKEN'}' } }).then(r => r.json())`;
        return card('واجهة REST محلية', `<p class="hv-dim">يقدّم Service Worker واجهة <code>/api/v1/*</code> يجيب عنها تبويب OX-Alpha المفتوح: تستطيع إدارة الملفات وسؤال الذكاء وتشغيل الكود والبحث من أي صفحة أو iframe على النطاق نفسه، أو من إضافة Chrome، أو من أي أداة عبر جسر <code>postMessage</code>. كل الطلبات تتطلب رمز Bearer عدا الوصف.</p>
            <div class="gh-row">${toggle('ix-api-on', 'تفعيل الواجهة', !!c.on, 'onchange="app.ixApiEnable(this.checked)"')}</div>
            ${c.on ? `<div class="gh-row">${field('ix-api-token', 'الرمز', c.token || '', 'dir="ltr" readonly onclick="this.select()"')}${btn('fa-rotate', 'تجديد', 'app.ixApiRotate()')}${btn('fa-copy', 'نسخ', "app.copyText(document.getElementById('ix-api-token').value)")}</div>
            ${table(['', 'المسار', 'الوصف', 'رمز'], API_ROUTES.map(([m, p, d, a]) => [`<code>${m}</code>`, `<code dir="ltr">${esc(p)}</code>`, esc(d), a ? '🔒' : '']))}
            <div class="gh-row">${select('ix-api-m', 'الطريقة', ['GET', 'POST', 'PUT', 'DELETE'], 'GET')}${field('ix-api-p', 'المسار', '/api/v1/status', 'dir="ltr"')}</div>${area('ix-api-b', 'الجسم (JSON)', '', 2, 'dir="ltr" placeholder=\'{"content": "hello"}\'')}
            <div class="gh-row">${pbtn('fa-paper-plane', 'إرسال', 'app.ixApiTry()')}${btn('fa-download', 'openapi.json', "app.downloadBlob(new Blob([JSON.stringify(app.ixApiSpec(),null,2)],{type:'application/json'}),'ox-alpha-openapi.json')")}</div><div id="ix-api-out"></div>
            <p class="hv-dim">مثال:</p>${pre(curl)}` : ''}`, 'fa-server');
    };
    P.ixApiSpec = function () { return apiSpec(((window.OX_BUILD || {}).version || '')); };

    // ---------------------------------------------------------------- #988-#990 packaged tools
    const pack = async (app, files, zipName, prefix) => {
        if (app.ensureJSZip) await app.ensureJSZip();
        const Z = globalThis.JSZip;
        if (!Z) { app.ixWriteFiles(zipName, files, { open: false }); return Object.keys(files); }
        const z = new Z();
        Object.entries(files).forEach(([p, c]) => z.file(p.replace(prefix, ''), c));
        app.downloadBlob(await z.generateAsync({ type: 'blob' }), zipName);
        return Object.keys(files);
    };
    const oxUrl = () => location.origin + location.pathname;
    P.ixExtFiles = function (kind) { const o = { oxUrl: oxUrl() }; return kind === 'vscode' ? vscodeFiles(o) : kind === 'chrome' ? chromeFiles(o) : cliFiles(o); };
    P.ixExtZip = function (kind) { return pack(this, this.ixExtFiles(kind), `ox-alpha-${kind}.zip`, kind === 'cli' ? /^cli\// : new RegExp('^extensions/' + kind + '/')); };
    P.ixExtToProject = function (kind) { return this.ixWriteFiles(kind, this.ixExtFiles(kind), { open: false }); };
    const block = (kind, intro, rows, install) => `<p class="hv-dim">${intro}</p>${table(['الميزة', 'الوصف'], rows.map(([a, b]) => [esc(a), esc(b)]))}
        <div class="gh-row">${pbtn('fa-file-zipper', 'تنزيل (zip)', `app.ixExtZip('${kind}')`)}${btn('fa-folder-plus', 'إضافة للمشروع', `app.ixExtToProject('${kind}')`)}${btn('fa-code-branch', 'المصدر على GitHub', `window.open('https://github.com/naderba69/daschai/tree/main/${kind === 'cli' ? 'cli' : 'extensions/' + kind}','_blank')`)}</div>${pre(install)}`;
    P.ixVscode = async function () {
        return card('إضافة VS Code', block('vscode', 'أوامر OX-Alpha داخل VS Code بدون اعتماديات. المفتاح من متغير البيئة أو إعدادات VS Code.', [['Ask (Ctrl+Alt+X)', 'سؤال عن التحديد، والإجابة تُبث في لوحة جانبية'], ['Explain', 'شرح ومخاطر'], ['Fix', 'إصلاح مع تطبيق أو مقارنة diff'], ['Generate tests', 'اختبارات بإطار اللغة'], ['Commit message', 'Conventional Commits من المُدرج'], ['Open in OX-Alpha', 'يفتح المستودع هنا']], 'cp -r extensions/vscode ~/.vscode/extensions/naderba69.ox-alpha-1.0.0\n# أو\nnpx @vscode/vsce package && code --install-extension ox-alpha-1.0.0.vsix'), 'fa-code');
    };
    P.ixChrome = async function () {
        return card('إضافة Chrome / Edge', block('chrome', 'أرسل النصوص والصفحات من أي موقع إلى OX-Alpha. تعتمد على جسر REST المحلي (فعّله من تبويب REST API وانسخ الرمز إلى إعدادات الإضافة).', [['اسأل عن التحديد', 'قائمة الزر الأيمن، تفتح OX-Alpha مع السؤال'], ['احفظ كملف', 'التحديد يصبح ملفاً في clips/'], ['أرسل الصفحة', 'المقال كاملاً بصيغة Markdown'], ['النافذة المنبثقة (Alt+Shift+X)', 'سؤال سريع وحالة المشروع']], 'chrome://extensions → وضع المطوّر → تحميل إضافة غير مضغوطة → extensions/chrome'), 'fa-globe');
    };
    P.ixCli = async function () {
        return card('أداة سطر الأوامر', block('cli', 'أداة CLI بدون اعتماديات (Node 18+)، تُشغَّل مباشرة من GitHub عبر npx.', [['ask', 'سؤال مع ملفات كسياق (بث مباشر)'], ['review', 'مراجعة git diff'], ['commit --yes', 'رسالة commit وتنفيذه'], ['explain', 'شرح ملف'], ['init static|react|express', 'مشروع من قالب'], ['open', 'افتح المستودع الحالي في OX-Alpha'], ['prompts', 'برومبتات المجتمع']], 'export OPENROUTER_API_KEY=sk-or-...\nnpx github:naderba69/daschai ask "ما الخطأ هنا؟" app.js\nnpx github:naderba69/daschai commit --yes'), 'fa-terminal');
    };
}
