/* Sprint 14 — Integrations + UI + AI (final sprint) through the lazy Integrations hub chunk + the idle widgets chunk. */
'use strict';
require('fake-indexeddb/auto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const { loadApp, mockOpenRouter, ok, wait, section } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const NodeEvent = globalThis.Event, NodeEventTarget = globalThis.EventTarget;
function exposeGlobals(w) {
    const names = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
        'KeyboardEvent', 'MouseEvent', 'Event', 'CustomEvent', 'localStorage', 'location', 'history', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'Image', 'HTMLCanvasElement', 'FileReader', 'DOMParser',
        'Text', 'Range', 'getSelection', 'FocusEvent', 'InputEvent', 'HTMLTextAreaElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLIFrameElement', 'DocumentFragment', 'ShadowRoot', 'Window', 'Document', 'HTMLDocument', 'ClipboardEvent', 'CompositionEvent', 'UIEvent', 'PointerEvent', 'TouchEvent'];
    for (const n of names) Object.defineProperty(globalThis, n, { value: w[n], configurable: true, writable: true });
}
function browserStubs(w) {
    w.URL.createObjectURL = () => 'blob:https://daschai.vercel.app/1';
    w.URL.revokeObjectURL = () => {};
    w.HTMLCanvasElement.prototype.getContext = function () { return new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ width: 10, data: [] })), set: (t, k, v) => { t[k] = v; return true; } }); };
    w.CSS = w.CSS || { escape: (s) => String(s) };
    const rect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 });
    w.Range.prototype.getClientRects = function () { return []; };
    w.Range.prototype.getBoundingClientRect = rect;
    if (!w.document.elementFromPoint) w.document.elementFromPoint = () => null;
}
/** Stand-in for the sandboxed iframe runner: runs the bundle in a fresh Node vm context. */
function vmSandbox() {
    const timers = new Set();
    const listeners = [];
    return {
        start(script, cb) {
            const st = (fn, ms, ...a) => { const t = setTimeout(() => { timers.delete(t); fn(...a); }, ms); timers.add(t); return t; };
            const si = (fn, ms, ...a) => { const t = setInterval(fn, ms, ...a); timers.add(t); return t; };
            const ct = (t) => { clearTimeout(t); clearInterval(t); timers.delete(t); };
            const ctx = vm.createContext({ __oxPost: (m) => cb(JSON.parse(JSON.stringify(m))), setTimeout: st, setInterval: si, clearTimeout: ct, clearInterval: ct, queueMicrotask, TextEncoder, TextDecoder, URL, structuredClone, btoa, atob,
                addEventListener: (t, f) => { if (t === 'message') listeners.push(f); } });
            try { vm.runInContext(script, ctx, { timeout: 5000, filename: 'ox-run.js' }); } catch (e) { cb({ type: 'fatal', message: e.message }); }
        },
        send(req) { const data = JSON.parse(JSON.stringify({ req })); listeners.forEach(f => setTimeout(() => f({ data }), 0)); },
        stop() { timers.forEach(t => { clearTimeout(t); clearInterval(t); }); timers.clear(); listeners.length = 0; }
    };
}


(async () => {
    let aiText = () => 'رد الذكاء';
    const or = mockOpenRouter(async (body) => ({ text: aiText(body) }));
    const http = [];        // every non-GitHub external call
    const routes = [];      // [regex, handler(url, opts, body)]
    const route = (re, fn) => routes.unshift([re, fn]);
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
    const ghLog = [];
    const fetchAll = async (url, opts = {}) => {
        const u = String(url);
        const method = (opts.method || 'GET').toUpperCase();
        let body = null;
        if (typeof opts.body === 'string') { try { body = JSON.parse(opts.body); } catch (e) { body = opts.body; } } else body = opts.body;
        if (u.includes('openrouter.ai')) return or.fetchImpl(url, opts);
        for (const [re, fn] of routes) if (re.test(u)) { http.push({ method, url: u, body, headers: opts.headers || {} }); const r = await fn(u, opts, body, method); if (r) return r; }
        if (u.startsWith('https://api.github.com/')) {
            ghLog.push(method + ' ' + u.replace('https://api.github.com', ''));
            return json({ message: 'Not Found' }, 404);
        }
        const rel = u.replace(/^https:\/\/daschai\.vercel\.app/, '').replace(/^\//, '').split('?')[0];
        if (rel && fs.existsSync(path.join(ROOT, rel)) && fs.statSync(path.join(ROOT, rel)).isFile()) return new Response(fs.readFileSync(path.join(ROOT, rel)), { status: 200 });
        http.push({ method, url: u, body, unmatched: true });
        return new Response('{}', { status: 404 });
    };
    const { w, d, app, errors } = loadApp({ fetchImpl: fetchAll, indexedDB: globalThis.indexedDB, beforeParse: browserStubs });
    w.addEventListener('error', (e) => { if (e.error && e.error.stack) console.log('STACK', e.error.stack.split('\n').slice(0, 4).join(' | ')); });
    exposeGlobals(w);
    globalThis.fetch = fetchAll;
    const imported = [];
    app.importModule = (url) => { imported.push(url); return import(pathToFileURL(path.join(ROOT, url)).href); };
    app.createRunSandbox = vmSandbox;
    const downloads = [];
    app.downloadBlob = (blob, name) => { downloads.push({ blob, name }); };
    app.askConfirm = async () => true;
    app.askText = async (t, v) => v;
    const copied = [];
    app.copyText = async (t) => { copied.push(t); return true; };
    app.settings.apiKey = 'sk-or-test';
    app.settings.githubOwner = 'o'; app.settings.githubRepo = 'r'; app.settings.githubToken = 'ghp_test';
    await wait(80);
    const files = app.virtualProjectFiles;
    const setFiles = (obj) => { files.clear(); Object.entries(obj).forEach(([p, c]) => files.set(p, { content: c, lang: p.split('.').pop(), timestamp: Date.now() })); };
    setFiles({
        'package.json': JSON.stringify({ name: 'demo', scripts: { test: 'echo ok' }, dependencies: {} }, null, 2),
        'index.html': '<!doctype html><html><body><h1>مرحبا</h1><img src="img/logo.png"><script src="src/main.js"></script></body></html>',
        'src/main.js': "import { add } from './utils/math.js';\n// TODO: handle negative numbers\nconsole.log(add(2, 3));\n",
        'src/utils/math.js': 'export function add(a, b) {\n    return a + b;\n}\n// FIXME overflow\nexport const sub = (a, b) => a - b;\n',
        'src/styles.css': '.card { margin-left: 8px; padding-right: 4px; text-align: left; float: right; }\n'
    });
    const P = Object.getPrototypeOf(app);
    const secHTML = () => (d.getElementById('ixx-sec') || {}).innerHTML || '';

    section('Lazy integ chunk + main core');
    ok(app.openIntegHub.__oxLazy === 'integ' && app.ixCodeSpace.__oxLazy === 'integ' && app.ixAgentBuild.__oxLazy === 'integ', 'hub entry points are lazy stubs');
    ok(!P.__oxInteg && !imported.some(u => /integ-/.test(u)), 'chunk not loaded at startup');
    ok(app.IX_TABS.length === 12 && app.buildPaletteCommands().filter(c => c.section === 'التكاملات').length === 12, '12 tabs in the palette');
    ok(app.BUILTIN_SHORTCUTS.some(x => x[0] === 'Alt+X'), 'Alt+X shortcut registered');
    { const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'); const csp = (/connect-src([^;]*)/.exec(html) || [])[1] || ''; ok(['api.linear.app', '*.supabase.co', '*.posthog.com', '*.algolia.net', 'api.anthropic.com', 'hooks.zapier.com'].every(h => csp.includes(h)), 'CSP allows the new integrations'); }
    ok(/window-management=\(self\)/.test(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')), 'Permissions-Policy allows window-management (dual screen)');

    section('Open every section (sweep)');
    { let got = null; app.openIntegHub = (t) => { got = t; }; app.handleLaunchParams('?action=integ&tab=widgets'); await wait(350); delete app.openIntegHub; ok(got === 'widgets', '?action=integ&tab= deep link'); }
    await app.openIntegHub('ai');
    ok(P.__oxInteg && imported.some(u => /integ-/.test(u)), 'chunk loaded on first use');
    const lib = app.ixLib();
    ok(lib && lib.TAB_DEFS && Object.keys(lib.TAB_DEFS).length === 12, 'lib exported');
    route(/raw\.githubusercontent\.com\/naderba69\/daschai\/main\/community\/prompts\.json/, () => new Response(fs.readFileSync(path.join(ROOT, 'community/prompts.json')), { status: 200 }));
    let n = 0; const bad = [];
    for (const [tab, secs] of Object.entries(lib.TAB_DEFS)) {
        for (const [sec] of secs) {
            await app.ixLoad(tab, sec);
            const el = d.getElementById('ixx-sec');
            n++;
            if (!el || /gh-empty bad/.test(el.innerHTML) || !el.innerHTML.trim()) bad.push(tab + '/' + sec + ': ' + (el ? el.textContent.slice(0, 160) : 'no el'));
        }
    }
    ok(bad.length === 0 && n === 40, `rendered ${n} sections without errors` + (bad.length ? ' — ' + bad.join(' | ') : ''));

    section('#981 direct OpenAI / Anthropic / Google');
    {
        const L = lib;
        ok(L.nativeModel('anthropic', 'anthropic/claude-3.5-sonnet') === 'claude-3-5-sonnet-latest' && L.nativeModel('openai', 'openai/gpt-4o:online') === 'gpt-4o', 'OpenRouter id → native id');
        ok(L.directRoute('anthropic/claude-3.5-haiku', { on: true, anthropic: 'k' }).provider === 'anthropic' && L.directRoute('openai/gpt-4o', { on: true, anthropic: 'k' }) === null && L.directRoute('x', { on: false }) === null, 'routing only when a key exists');
        const body = { model: 'anthropic/claude-3.5-haiku', max_tokens: 100, temperature: 1.4, messages: [{ role: 'system', content: 'SYS' }, { role: 'assistant', content: 'hi' }, { role: 'user', content: [{ type: 'text', text: 'صف' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }] };
        const an = L.toAnthropic(body, 'claude-3-5-haiku-latest');
        ok(an.system === 'SYS' && an.messages[0].role === 'user' && an.messages[2].content[1].source.data === 'AAAA' && an.temperature === 1, 'Anthropic body: system, first user turn, base64 image, temp clamp');
        const ge = L.toGemini(body);
        ok(ge.systemInstruction.parts[0].text === 'SYS' && ge.contents[0].role === 'model' && ge.contents[1].parts[1].inline_data.mime_type === 'image/png', 'Gemini body');
        ok(L.toOpenAI({ ...body, max_tokens: 50, provider: {} }, 'o3-mini').max_completion_tokens === 50 && !('provider' in L.toOpenAI({ ...body, provider: {} }, 'gpt-4o')), 'OpenAI body for reasoning models');
        ok(L.translateJSON('google', { candidates: [{ content: { parts: [{ text: 'a', thought: true }, { text: 'مرحبا' }] } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 } }, 'g').choices[0].message.content === 'مرحبا', 'Gemini JSON → chat.completion');

        await app.ixLoad('ai', 'direct');
        d.getElementById('ix-dir-on').checked = true;
        d.getElementById('ix-dir-anthropic').value = 'sk-ant-test';
        d.getElementById('ix-dir-google').value = 'AIza-test';
        d.getElementById('ix-dir-map').value = 'anthropic/claude-sonnet-4.5 => claude-sonnet-4-5-20250929';
        const cfg = app.ixDirectSave();
        ok(cfg.on && cfg.map['anthropic/claude-sonnet-4.5'] === 'claude-sonnet-4-5-20250929' && app.ixBootList().includes('direct'), 'settings saved + boot flag');
        const sse = (events) => new Response(events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
        route(/api\.anthropic\.com\/v1\/messages/, (u, o, b) => sse([{ type: 'message_start', message: { usage: { input_tokens: 7 } } }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'أهلاً ' } }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'بك' } }, { type: 'message_delta', usage: { output_tokens: 2 } }]));
        route(/generativelanguage\.googleapis\.com/, () => json({ candidates: [{ content: { parts: [{ text: 'Gemini!' }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }));
        const before = or.calls ? or.calls.length : 0;
        const res = await w.fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'anthropic/claude-sonnet-4.5', stream: true, messages: [{ role: 'user', content: 'سلام' }] }) });
        const text = await res.text();
        const call = http.filter(h => /anthropic/.test(h.url)).pop();
        ok(call && call.body.model === 'claude-sonnet-4-5-20250929' && call.headers['x-api-key'] === 'sk-ant-test' && call.headers['anthropic-dangerous-direct-browser-access'] === 'true', 'chat request re-routed to Anthropic with the mapped model');
        const deltas = text.split('\n').filter(l => l.startsWith('data: {')).map(l => JSON.parse(l.slice(6)));
        ok(deltas.map(x => (x.choices[0] || { delta: {} }).delta.content || '').join('') === 'أهلاً بك' && deltas.pop().usage.total_tokens === 9 && /\[DONE\]/.test(text), 'Anthropic SSE translated to OpenRouter SSE + usage');
        ok(!or.calls || or.calls.length === before, 'OpenRouter not called');
        const gj = await (await w.fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'google/gemini-2.0-flash', messages: [{ role: 'user', content: 'x' }] }) })).json();
        ok(gj.choices[0].message.content === 'Gemini!' && /gemini-2\.0-flash:generateContent/.test(http.filter(h => /generativelanguage/.test(h.url)).pop().url), 'non-stream Gemini');
        const orr = await w.fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'x' }] }) });
        ok(orr.status === 200 && !http.some(h => /api\.openai\.com/.test(h.url)), 'models without a direct key still go to OpenRouter');
        route(/api\.anthropic\.com\/v1\/messages/, () => json({ error: { message: 'invalid x-api-key' } }, 401));
        const er = await w.fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'anthropic/claude-3.5-haiku', messages: [{ role: 'user', content: 'x' }] }) });
        ok(er.status === 401 && /Anthropic \(مباشر\): invalid x-api-key/.test((await er.json()).error.message), 'provider errors surfaced in OpenRouter shape');
        app.ixSave('direct', { on: false });
    }

    section('#7 personal style profile + LoRA dataset');
    {
        const p = lib.styleProfile([['a.js', "const fooBar = (x) => {\n    return x + 1;\n};\nconst getName = async () => {\n    const r = await load('x');\n    return r;\n};\n// تعليق عربي\n"]]);
        ok(p.indent === '4 spaces' && p.quotes === 'single' && p.semicolons === 'always' && p.naming === 'camelCase' && p.functions === 'arrow functions' && p.comments === 'Arabic', 'profile detects indent/quotes/semicolons/naming/functions/comments');
        ok(/4 spaces/.test(lib.styleGuide(p)) && /Arabic/.test(lib.styleGuide(p)), 'style guide text');
        const ex = lib.fineTuneExamples([['src/x.js', '// Adds two numbers\nexport function add(a, b) {\n    const s = a + b;\n    return s;\n}\n']]);
        ok(ex.length === 1 && /Adds two numbers/.test(ex[0].messages[1].content) && /return s/.test(ex[0].messages[2].content), 'fine-tune example from a documented function');
        const n = app.ixStyleDataset();
        ok(n >= 1 && files.has('finetune/dataset.jsonl') && /unsloth/.test(files.get('finetune/train_lora.py').content), 'dataset.jsonl + Unsloth LoRA script written');
        app.ixStyleApply(true);
        const sess = { messages: [{ role: 'user', content: 'اكتب دالة' }] };
        const out = await app.transformChatPayload([{ role: 'system', content: 'BASE' }, { role: 'user', content: 'اكتب دالة' }], sess, {});
        ok(/USER CODING STYLE/.test(out[0].content), 'style guide injected into the chat system prompt');
        app.ixStyleApply(false);
        const out2 = await app.transformChatPayload([{ role: 'system', content: 'BASE' }, { role: 'user', content: 'x' }], sess, {});
        ok(!/USER CODING STYLE/.test(out2[0].content), 'and removed when disabled');
    }

    section('#35 community prompt market');
    {
        const market = JSON.parse(fs.readFileSync(path.join(ROOT, 'community/prompts.json'), 'utf8'));
        ok(market.prompts.length >= 10 && market.prompts.every(p => lib.validatePrompt(p).length === 0) && new Set(market.prompts.map(p => p.id)).size === market.prompts.length, 'community/prompts.json is valid (unique ids)');
        ok(lib.validatePrompt({ title: '', text: 'short' }).length === 2, 'validation');
        const f = lib.filterMarket(market.prompts, { q: 'SQL' });
        ok(f.length === 1 && f[0].id === 'sql-optimize', 'search');
        await app.ixLoad('ai', 'prompts');
        ok(d.querySelectorAll('#ix-mk-list .ix-prompt').length === market.prompts.length, 'market rendered from the GitHub index');
        const saved = app.ixMarketInstall('review-ar');
        const lib2 = JSON.parse(w.localStorage.getItem('ox_alpha_prompts_v1') || '[]');
        ok(saved && lib2.some(x => x.title === 'مراجعة كود احترافية'), 'install adds it to my prompt library');
        d.getElementById('ix-mk-title').value = 'برومبت اختبار';
        d.getElementById('ix-mk-text').value = 'اكتب لي اختبارات شاملة لكل الدوال مع حالات حدية';
        route(/api\.github\.com\/gists$/, () => json({ id: 'g1', html_url: 'https://gist.github.com/g1' }, 201));
        route(/api\.github\.com\/repos\/naderba69\/daschai\/issues$/, () => json({ number: 9, html_url: 'https://github.com/naderba69/daschai/issues/9' }, 201));
        const pub = await app.ixMarketPublish();
        ok(pub && pub.issue && pub.issue.number === 9 && (app.ixCfg('market').published || [])[0].title === 'برومبت اختبار', 'publish = public gist + review issue');
    }

    section('#1008 memory of all projects');
    {
        const card = lib.projectCard([['package.json', '{"name":"shop","description":"متجر","dependencies":{"react":"18","stripe":"1"}}'], ['src/App.jsx', '// TODO']], { repo: 'o/shop' });
        ok(card.name === 'shop' && card.stack.includes('react') && card.stack.includes('stripe') && card.todos === 1, 'project card');
        ok(lib.rankCards([card, { ...card, id: 'b', name: 'blog', repo: 'o/blog', description: 'مدونة', stack: ['vue'], readme: '', keyFiles: [] }], 'stripe checkout in shop')[0].name === 'shop', 'ranking');
        ok(/MEMORY OF THE USER/.test(lib.memoryPrompt([card], 'كل المشاريع')), 'memory prompt for “all projects”');
        app.ixMemoryToggle(true);
        ok(app.ixProjects().some(c => c.repo === 'o/r'), 'current project remembered');
        route(/api\.github\.com\/user\/repos/, () => json([{ full_name: 'o/payments-api', name: 'payments-api', description: 'Stripe payments microservice', language: 'TypeScript', topics: ['stripe'] }]));
        await app.ixLoad('ai', 'memory');
        const added = await app.ixImportRepos();
        ok(added === 1, 'GitHub repos imported as memory cards');
        const out = await app.transformChatPayload([{ role: 'system', content: 'BASE' }, { role: 'user', content: 'كيف أضيف stripe payments؟' }], { messages: [{ role: 'user', content: 'كيف أضيف stripe payments؟' }] }, {});
        ok(/payments-api/.test(out[0].content), 'relevant project injected into chat context');
        app.askText = async () => 'نستخدم Zustand';
        const c = await app.ixProjectNote('o/payments-api');
        app.askText = async (t, v) => v;
        ok(c && c.notes[0] === 'نستخدم Zustand', 'persistent project note');
        app.ixMemoryToggle(false);
    }

    section('#1001 autonomous agent: idea → code → verify/fix → deploy');
    {
        ok(lib.slugify('Todo App عربي!') === 'todo-app' && lib.parsePlan({ name: 'X Y', files: ['index.html', '../evil.js', { path: 'app.js', purpose: 'logic' }] }).files.length === 2, 'plan parsing drops unsafe paths');
        const issues = lib.verifyProject([['index.html', '<script src="app.js"></script><link href="style.css" rel="stylesheet">'], ['app.js', "import { x } from './util.js';\nconst a = ;"], ['p.json', '{bad']]);
        ok(issues.some(i => /style\.css/.test(i.message)) && issues.some(i => /SyntaxError/.test(i.message)) && issues.some(i => /util\.js/.test(i.message)) && issues.some(i => /JSON/.test(i.message)), 'verifier finds missing refs, syntax errors, missing imports, bad JSON');
        const asked = [];
        aiText = (body) => {
            const u = String(body.messages[body.messages.length - 1].content);
            asked.push(u.slice(0, 40));
            if (/Plan a complete/.test(u)) return JSON.stringify({ name: 'Arabic Todo', title: 'قائمة مهام', summary: 'تطبيق مهام', stack: 'static', files: [{ path: 'index.html', purpose: 'page' }, { path: 'app.js', purpose: 'logic' }, { path: 'app.test.js', purpose: 'tests' }] });
            if (/Write these files/.test(u)) return JSON.stringify({ files: { 'index.html': '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><ul id="l"></ul><script type="module" src="app.js"></script></body></html>', 'app.js': 'export function add(list, t) { return [...list, { t, done: false }]; }\n', 'app.test.js': "const { add } = require('./app.js');\ntest('adds', () => { expect(add([], 'x').length).toBe(1); });\n" } });
            if (/Fix these problems/.test(u)) return JSON.stringify({ files: { 'style.css': 'body { font-family: Tahoma; }\n' } });
            return '{}';
        };
        route(/api\.github\.com\/user\/repos$/, (u, o, b, m) => m === 'POST' ? json({ full_name: 'o/' + b.name, default_branch: 'main' }, 201) : null);
        route(/api\.github\.com\/repos\/o\/arabic-todo-\w+\/contents\//, () => json({ content: {} }, 201));
        route(/api\.github\.com\/repos\/o\/arabic-todo-\w+\/pages$/, () => json({ html_url: 'https://o.github.io/arabic-todo/' }, 201));
        await app.ixLoad('build', 'agent');
        const r = await app.ixAgentBuild('تطبيق قائمة مهام عربي مع حفظ محلي', { stack: 'static', deploy: true });
        ok(r && r.root === 'arabic-todo' && files.has('arabic-todo/index.html') && files.has('arabic-todo/style.css'), 'project written under its own folder');
        ok(r.fixRounds === 1 && r.issues.length === 0, 'missing style.css detected and fixed in one round');
        ok(app._ixAgent.tests && app._ixAgent.tests.pass === 1, 'generated tests executed in the sandbox: ' + JSON.stringify(app._ixAgent.tests));
        ok(r.repo && /^o\/arabic-todo-/.test(r.repo) && r.url === 'https://o.github.io/arabic-todo/' && http.filter(h => /\/contents\//.test(h.url) && h.method === 'PUT').length === 4, 'deployed: repo + 4 files + Pages');
        ok(d.querySelectorAll('#ix-ag-log .ix-step').length >= 4 && /o\.github\.io/.test(d.getElementById('ix-ag-log').innerHTML), 'live step log');
        aiText = () => 'رد الذكاء';
    }

    section('#124 complete authentication system');
    {
        const f = lib.authFiles({ storage: 'memory' });
        ok(['server.js', 'auth/routes.js', 'auth/tokens.js', 'auth/middleware.js', 'auth/store.js', 'tests/auth.test.js', '.env.example'].every(p => f[p]), 'files: server, routes, tokens, middleware, store, tests, .env.example');
        ok(Object.entries(f).filter(([p]) => /\.(c?js)$/.test(p) && !/public\//.test(p)).every(([p, t]) => { try { require('acorn').parse(t, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true }); return true; } catch (e) { console.log(p, e.message); return false; } }), 'every generated JS file parses');
        ok(/bcrypt/.test(f['auth/routes.js'] + f['auth/store.js']) && /refresh/i.test(f['auth/tokens.js']), 'bcrypt + refresh tokens');
        await app.ixLoad('build', 'authgen');
        app.ixAuthGenerate();
        ok(files.has('server.js') && files.has('tests/auth.test.js'), 'written to the project');
        const t = await app.ixRunTests(['tests/auth.test.js'], 'ix-au-res');
        if (!t || t.summary.fail || !t.summary.pass) console.log(JSON.stringify(t && t.results.filter(x => x.status === 'fail').map(x => [x.name, x.error])).slice(0, 1500), t && t.error, t && t.lines.slice(-8));
        ok(t && t.summary.pass >= 4 && t.summary.fail === 0, `generated auth tests pass in the sandbox (${t && t.summary.pass}/${t && t.summary.total})`);
    }

    section('#125 RBAC roles & permissions');
    {
        const can = lib.makeCan(lib.RBAC_SAMPLE);
        ok(can('admin', 'delete', 'posts') && can('editor', 'read', 'posts') && !can('guest', 'create', 'posts'), 'inheritance (admin ⊇ editor ⊇ user ⊇ guest)');
        ok(can('user', 'update', 'comments', { userId: 1, ownerId: 1 }) && !can('user', 'update', 'comments', { userId: 1, ownerId: 2 }), ':own permissions');
        let threw = false; try { lib.resolvePolicy({ roles: { a: { inherits: ['b'] }, b: { inherits: ['a'] } }, grants: {} }); } catch (e) { threw = /دائرية/.test(e.message); }
        ok(threw, 'cycles rejected');
        await app.ixLoad('build', 'rbac');
        ok(d.querySelectorAll('#ix-rb-matrix .ix-cell').length === 4 * 4 * 4, 'matrix 4 roles × 4 resources × 4 actions');
        app.ixRbacCycle('guest', 'users', 'read');
        ok(app.ixRbacPolicy().grants.guest.users.includes('read') && d.querySelector('#ix-rb-matrix').innerHTML.includes('✅'), 'click cycles a cell');
        const inh = d.querySelector('#ix-rb-matrix .ix-inh');
        ok(/app\.ixRbacInherit\(&quot;guest&quot;,this\.value\)|app\.ixRbacInherit\("guest",this\.value\)/.test(inh.getAttribute('onchange')), 'inherit input passes its raw value');
        ok(app.ixRbacInherit('guest', 'admin') === false && app.ixRbacPolicy().roles.guest.inherits.length === 0, 'cyclic inheritance edit refused');
        await app.ixRbacAddRole('moderator', ['user']);
        ok(app.ixRbacPolicy().roles.moderator, 'add role');
        d.getElementById('ix-rb-role').innerHTML = '<option>moderator</option>'; d.getElementById('ix-rb-act').value = 'read'; d.getElementById('ix-rb-res').value = 'posts';
        ok(app.ixRbacCheck() === true, 'simulator');
        app.ixRbacGenerate();
        ok(files.has('rbac/rbac.js') && files.has('rbac/can.js') && /moderator/.test(files.get('rbac/policy.json').content), 'files generated from the edited policy');
        const t = await app.ixRunTests(['rbac/rbac.test.js']);
        if (!t || t.summary.fail) console.log(JSON.stringify(t && t.results.filter(x => x.status === 'fail').map(x => [x.name, x.error])).slice(0, 800));
        ok(t && t.summary.pass >= 3 && t.summary.fail === 0, `generated RBAC tests pass (${t && t.summary.pass}/${t && t.summary.total})`);
        app._ixRbac = null; app.ixSave('rbac', null);
    }

    section('#1002 voice coder');
    {
        const V = lib.parseVoiceCommand;
        ok(V('احفظ').cmd === 'save' && V('اذهب إلى السطر ٣').line === 3 && V('go to line 12').line === 12 && V('احذف السطر خمسة').line === 5, 'local grammar (Arabic digits + words)');
        ok(V('حدد الأسطر 2 إلى 4').from === 2 && V('أنشئ ملف utils نقطة js').name === 'utils.js' && V('افتح الملف math').name === 'math', 'select / new file / open');
        ok(V('أضف دالة تجمع رقمين').cmd === 'ai', 'free speech goes to the AI');
        ok(lib.applyVoiceEdit('a\nb', { from: 1, to: 1 }, { op: 'insert', code: 'X' }).text === 'aX\nb' && lib.applyVoiceEdit('a\nb\nc', null, { op: 'insert_at_line', line: 2, code: 'Z' }).text === 'a\nZ\nb\nc', 'edit application');
        await app.ixLoad('build', 'voice');
        ok(app.ixVoiceCoder(true) === false, 'graceful when SpeechRecognition is missing');
        class FakeSR { start() { FakeSR.started = true; } stop() { FakeSR.stopped = true; } }
        w.webkitSpeechRecognition = FakeSR;
        ok(app.ixVoiceCoder(true) === true && FakeSR.started && /يستمع/.test(d.getElementById('ix-vc-state').innerHTML), 'listening with webkitSpeechRecognition');
        app.activeStudioFile = 'src/utils/math.js';
        await app.ixVoiceHandle('احذف السطر 4');
        ok(!/FIXME/.test(files.get('src/utils/math.js').content), '“delete line 4” applied locally');
        aiText = () => JSON.stringify({ op: 'insert', code: '\nexport const mul = (a, b) => a * b;\n', say: 'أضفت دالة الضرب' });
        const r = await app.ixVoiceHandle('أضف دالة ضرب في آخر الملف');
        aiText = () => 'رد الذكاء';
        ok(r.edit && /export const mul/.test(files.get('src/utils/math.js').content), 'free speech → AI edit written to the file');
        const nf = await app.ixVoiceHandle('أنشئ ملف notes.md');
        ok(nf.path === 'notes.md' && files.has('notes.md'), 'new file by voice');
        ok((await app.ixVoiceHandle('توقف')).cmd === 'stop' && FakeSR.stopped && !app._ixRec, '“stop” ends listening');
        ok(d.querySelectorAll('#ix-vc-log .fmx-item').length >= 4, 'spoken log');
        delete w.webkitSpeechRecognition;
    }

    section('#982 Supabase / Firebase / PlanetScale');
    {
        const sb = lib.dbRequest('supabase', { url: 'https://xyz.supabase.co/', key: 'anon' }, { table: 'todos', limit: 5 });
        ok(sb.url === 'https://xyz.supabase.co/rest/v1/todos?select=*&limit=5' && sb.headers.apikey === 'anon', 'Supabase REST request');
        ok(lib.fsValue({ mapValue: { fields: { n: { integerValue: '3' }, tags: { arrayValue: { values: [{ stringValue: 'a' }] } } } } }).n === 3, 'Firestore typed values');
        const ps = lib.dbRequest('planetscale', { host: 'aws.connect.psdb.cloud', username: 'u', password: 'p' }, { sql: 'select 1' });
        ok(/psdb\.v1alpha1\.Database\/Execute$/.test(ps.url) && ps.headers.Authorization === 'Basic ' + Buffer.from('u:p').toString('base64'), 'PlanetScale HTTP API request');
        const raw = Buffer.from('1سارة').toString('latin1');
        const pr = lib.dbParse('planetscale', { result: { fields: [{ name: 'id' }, { name: 'name' }], rows: [{ lengths: ['1', String(Buffer.byteLength('سارة'))], values: Buffer.from('1سارة').toString('base64') }] } }, { table: 'u' });
        ok(pr.rows[0].id === '1' && pr.rows.length === 1 && raw.length > 0, 'PlanetScale row decoding');
        route(/xyz\.supabase\.co\/rest\/v1\/$/, () => json({ paths: { '/': {}, '/todos': {}, '/profiles': {} } }));
        route(/xyz\.supabase\.co\/rest\/v1\/todos/, () => json([{ id: 1, title: 'اشتر حليب', done: false }, { id: 2, title: 'Ship v2.14', done: true }]));
        await app.ixLoad('data', 'db');
        d.getElementById('ix-db-url').value = 'https://xyz.supabase.co'; d.getElementById('ix-db-key').value = 'anon-key';
        const t = await app.ixDbTables();
        ok(t && t.tables.includes('todos') && t.tables.includes('profiles'), 'list tables (OpenAPI)');
        const rows = await app.ixDbRows('todos');
        ok(rows.length === 2 && /اشتر حليب/.test(d.getElementById('ix-db-rows').innerHTML), 'browse rows');
        app.ixDbCode('supabase');
        ok(/createClient\('https:\/\/xyz\.supabase\.co'/.test(files.get('db/supabase.js').content), 'client code with the project URL');
        route(/firestore\.googleapis\.com/, () => json({ documents: [{ name: 'projects/p/databases/(default)/documents/users/u1', fields: { name: { stringValue: 'Ali' }, age: { integerValue: '30' } } }] }));
        app.ixSave('db', { provider: 'firebase', firebase: { projectId: 'p', apiKey: 'AIza' } });
        const fr = await app.ixDbQuery({ table: 'users' });
        ok(fr.rows[0]._id === 'u1' && fr.rows[0].age === 30, 'Firestore documents → rows');
        app.ixSave('db', null);
    }

    section('#996 Algolia • #995 Cloudinary');
    {
        const recs = lib.algoliaRecords([['a.js', 'function hello() {}\n' + 'x'.repeat(50)]], { chunk: 30 });
        ok(recs.length === 2 && recs[0].objectID === 'a.js#0' && recs[0].title === 'hello', 'records chunked with titles');
        route(/algolia\.net\/1\/indexes\/ox_project\/(batch|clear|settings)/, () => json({ taskID: 1 }));
        route(/-dsn\.algolia\.net\/1\/indexes\/ox_project\/query/, (u, o, b) => json({ hits: [{ path: 'src/utils/math.js', line: 1, _snippetResult: { content: { value: 'export function <em>add</em>' } } }] }));
        await app.ixLoad('data', 'algolia');
        d.getElementById('ix-al-app').value = 'APP1'; d.getElementById('ix-al-admin').value = 'admin'; d.getElementById('ix-al-search').value = 'search';
        const n = await app.ixAlgoliaIndex();
        const batch = http.filter(h => /\/batch$/.test(h.url)).pop();
        ok(n >= 5 && batch.headers['X-Algolia-API-Key'] === 'admin' && batch.body.requests.every(r => r.action === 'updateObject'), 'project indexed with the admin key');
        const hits = await app.ixAlgoliaSearch('add');
        ok(hits.length === 1 && http.filter(h => /query$/.test(h.url)).pop().headers['X-Algolia-API-Key'] === 'search', 'search uses the search-only key');
        app.ixAlgoliaCode();
        const t = await app.ixRunTests(['search/search.test.js']);
        ok(t && t.summary.pass >= 1 && !t.summary.fail, 'generated search code tested against the local algoliasearch mock');

        ok(lib.cldUrl('demo', 'img/a.png', { width: 400, crop: 'fill' }) === 'https://res.cloudinary.com/demo/image/upload/w_400,c_fill,q_auto,f_auto/img/a.png', 'delivery URL with f_auto,q_auto');
        const rw = lib.rewriteImageRefs('<img src="../img/logo.png"> url(img/x.png)', 'pages/a.html', { 'img/logo.png': 'https://cdn/x' });
        ok(rw.count === 1 && rw.text.includes('src="https://cdn/x"'), 'relative refs resolved + rewritten');
        files.set('img/logo.png', { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', content: '', lang: 'png' });
        route(/api\.cloudinary\.com\/v1_1\/demo\/image\/upload/, (u, o) => json({ public_id: 'img/logo', format: 'png', secure_url: 'https://res.cloudinary.com/demo/image/upload/img/logo.png' }));
        await app.ixLoad('data', 'cloudinary');
        d.getElementById('ix-cl-cloud').value = 'demo'; d.getElementById('ix-cl-preset').value = 'unsigned1';
        const map = await app.ixCloudUpload();
        const up = http.filter(h => /api\.cloudinary\.com/.test(h.url)).pop();
        ok(map['img/logo.png'] && up.body && typeof up.body.get === 'function' && up.body.get('upload_preset') === 'unsigned1', 'unsigned upload of project images');
        const r = app.ixCloudRewrite();
        ok(r.refs === 1 && /res\.cloudinary\.com\/demo\/image\/upload\/q_auto,f_auto\/img\/logo\.png/.test(files.get('index.html').content), 'index.html now uses the CDN URL');
    }

    section('#991 Stripe/PayPal • #992 Auth0/Clerk • #993 SendGrid • #994 Twilio');
    {
        const s1 = lib.smsSegments('Hello'), s2 = lib.smsSegments('مرحبا'.repeat(15));
        ok(s1.encoding === 'GSM-7' && s1.segments === 1 && s2.encoding === 'UCS-2' && s2.segments === 2, 'SMS encoding + segments (Arabic = UCS-2)');
        ok(lib.clerkFrontendApi('pk_test_' + Buffer.from('clerk.example.com$').toString('base64')).host === 'clerk.example.com' && lib.clerkFrontendApi('sk_x') === null, 'Clerk key → Frontend API');
        const html = lib.emailHtml({ title: 'أهلاً', body: 'مرحباً **سارة**', cta: 'ابدأ', ctaUrl: 'https://x.y' });
        ok(/dir="rtl"/.test(html) && /<strong>سارة<\/strong>/.test(html) && /href="https:\/\/x\.y"/.test(html), 'RTL email template');
        app._ixOutbox = [];
        await app.ixLoad('services', 'payments');
        for (const svc of ['stripe', 'sendgrid', 'twilio']) {
            const f = app.ixService(svc);
            const tests = Object.keys(f).filter(p => /\.test\.js$/.test(p));
            const t = await app.ixRunTests(tests);
            if (!t || t.summary.fail || !t.summary.pass) console.log(svc, JSON.stringify(t && t.results.filter(x => x.status === 'fail').map(x => [x.name, x.error])).slice(0, 600), t && t.error);
            ok(t && t.summary.pass >= 1 && !t.summary.fail, `${svc}: generated code + tests pass with the local SDK mock`);
        }
        const kinds = new Set((app._ixOutbox || []).map(o => o.service));
        ok(kinds.has('stripe') && kinds.has('sendgrid') && kinds.has('twilio'), 'outbox captured charges, emails and SMS: ' + [...kinds].join(','));
        await app.ixLoad('services', 'outbox');
        ok(/💳/.test(secHTML()) && /✉️/.test(secHTML()) && /💬/.test(secHTML()), 'outbox rendered');
        app.ixService('paypal', { clientId: 'sb-123' });
        ok([...files.keys()].some(p => /paypal/i.test(p)) && /client-id=sb-123/.test(files.get('payments/paypal-buttons.html').content), 'PayPal files with the client id: ' + [...files.keys()].filter(p => /pay/.test(p)).join(','));
        route(/my-app\.eu\.auth0\.com\/\.well-known\/openid-configuration/, () => json({ issuer: 'https://my-app.eu.auth0.com/', grant_types_supported: ['authorization_code'], id_token_signing_alg_values_supported: ['RS256'] }));
        await app.ixLoad('services', 'authprov');
        d.getElementById('ix-a0-domain').value = 'my-app.eu.auth0.com';
        const oidc = await app.ixAuthProvCheck('auth0');
        ok(oidc && oidc.issuer === 'https://my-app.eu.auth0.com/', 'Auth0 tenant verified via OIDC discovery');
        d.getElementById('ix-ck-pk').value = 'pk_live_' + Buffer.from('clerk.myapp.com$').toString('base64');
        ok(app.ixAuthProvCheck('clerk') && /clerk\.myapp\.com/.test(d.getElementById('ix-ap-res').innerHTML), 'Clerk key validated');
        app.ixService('auth0', { domain: 'my-app.eu.auth0.com', clientId: 'cid' });
        app.ixService('clerk', { publishableKey: 'pk_test_x' });
        ok([...files.keys()].some(p => /auth0/i.test(p)) && [...files.keys()].some(p => /clerk/i.test(p)), 'Auth0 + Clerk client files');
    }

    section('#997 Sentry • #998 PostHog');
    {
        const dsn = lib.parseDsn('https://abc123@o9.ingest.sentry.io/4567');
        ok(dsn.projectId === '4567' && dsn.envelope === 'https://o9.ingest.sentry.io/api/4567/envelope/?sentry_key=abc123&sentry_version=7&sentry_client=ox-alpha%2F1.0' && lib.parseDsn('nope') === null, 'DSN parsing');
        const fr = lib.parseStack('Error: x\n    at foo (https://a.app/app.js:10:5)\n    at https://cdn.jsdelivr.net/x.js:1:2');
        ok(fr.length === 2 && fr[1].function === 'foo' && fr[1].lineno === 10 && fr[0].in_app === false, 'stack → frames (oldest first, in_app)');
        const env = lib.sentryEnvelope(lib.sentryEvent(new Error('boom'), { release: 'r1' }), 'https://k@h/1').split('\n');
        ok(JSON.parse(env[1]).type === 'event' && JSON.parse(env[2]).exception.values[0].value === 'boom', 'envelope format');
        route(/ingest\.sentry\.io\/api\/4567\/envelope/, () => json({ id: 'x' }));
        await app.ixLoad('observe', 'sentry');
        d.getElementById('ix-se-dsn').value = 'https://abc123@o9.ingest.sentry.io/4567';
        d.getElementById('ix-se-on').checked = true;
        app.ixSentrySave();
        ok(app.ixBootList().includes('sentry') && app._ixSentryOn, 'enabled + boot flag');
        app.showToast('خطأ تجريبي في الواجهة', 'error');
        const id = await app.ixSentrySend(new Error('OX-Alpha test error'));
        const sent = http.filter(h => /envelope/.test(h.url)).pop();
        const ev = JSON.parse(String(sent.body).split('\n')[2]);
        ok(id && ev.release.startsWith('ox-alpha@') && ev.breadcrumbs.values.some(b => /خطأ تجريبي/.test(b.message)), 'event sent with release + breadcrumbs from toasts');
        app.ixSave('sentry', { dsn: '', on: false }); app.ixBootSet('sentry', false);
        const sf = app.ixObserveFiles('sentry');
        app.ixWriteFiles('Sentry', sf, { open: false });
        const t = await app.ixRunTests(['monitoring/sentry.test.js']);
        ok(t && t.summary.pass >= 1 && !t.summary.fail, 'generated Sentry server code tested with the @sentry/node mock');

        const b = lib.phBatch('phc_1', [{ event: 'x', properties: { a: 1 } }], 'u1');
        ok(b.api_key === 'phc_1' && b.batch[0].distinct_id === 'u1' && b.batch[0].properties.$lib === 'ox-alpha', 'PostHog batch body');
        route(/us\.i\.posthog\.com\/batch\//, () => json({ status: 1 }));
        await app.ixLoad('observe', 'posthog');
        d.getElementById('ix-ph-key').value = 'phc_test'; d.getElementById('ix-ph-on').checked = true;
        app.ixPhSave();
        app.pfTrack && app.pfTrack('media:convert');
        const n = await app.ixPhFlush();
        const ph = http.filter(h => /posthog/.test(h.url)).pop();
        ok(n >= 2 && ph.body.batch.some(e => e.event === '$pageview') && ph.body.batch.some(e => e.event === 'ox_media' && e.properties.feature === 'media:convert'), 'pageview + feature usage events batched to PostHog');
        app.ixSave('posthog', { key: '', on: false }); app.ixBootSet('posthog', false);
    }

    section('#985 Jira / Linear / Trello');
    {
        const todos = lib.scanTodos([['a.js', '// TODO(sara): handle errors\nx\n# FIXME: race condition\n<!-- BUG broken link -->']]);
        ok(todos.length === 3 && todos[0].who === 'sara' && todos[1].tag === 'FIXME' && todos[2].title === 'broken link', 'TODO/FIXME/BUG scanner');
        ok(lib.jiraCsv([{ title: 'a "q"', tag: 'BUG' }]).split('\n')[1] === '"a ""q""","","Task","High","bug","OX"', 'Jira CSV');
        route(/api\.linear\.app\/graphql/, (u, o, b) => {
            if (/teams/.test(b.query)) return json({ data: { teams: { nodes: [{ id: 'T1' }] } } });
            if (/issueCreate/.test(b.query)) return json({ data: { issueCreate: { success: true, issue: { identifier: 'ENG-' + (10 + http.filter(h => /linear/.test(h.url) && /issueCreate/.test(h.body.query)).length), url: 'https://linear.app/x/issue/ENG-1' } } } });
            return json({ data: { issues: { nodes: [{ identifier: 'ENG-1', title: 'Login bug', url: 'https://linear.app/x/issue/ENG-1', state: { name: 'Todo' }, assignee: { name: 'Sara' }, updatedAt: '2026-10-20T10:00:00Z' }] } } });
        });
        await app.ixLoad('work', 'issues');
        app.ixSave('issues', { tracker: 'linear', linearKey: 'lin_api_x' });
        const items = await app.ixIssueList('linear');
        ok(items.length === 1 && /Login bug/.test(d.getElementById('ix-is-list').innerHTML) && http.filter(h => /linear/.test(h.url)).pop().headers.Authorization === 'lin_api_x', 'Linear issues listed');
        const scanned = app.ixTodoScan();
        ok(scanned.length >= 2 && scanned.some(t => t.path === 'src/main.js' && t.tag === 'TODO'), 'project TODO/FIXME scanned: ' + scanned.length);
        const done = await app.ixTodoPush();
        const created = http.filter(h => /linear/.test(h.url) && /issueCreate/.test(h.body.query));
        ok(done.length === scanned.length && created[0].body.variables.i.teamId === 'T1' && created.every(c => /github\.com\/o\/r\/blob\/main\/[\w/.-]+#L\d+/.test(c.body.variables.i.description)), 'TODOs → Linear issues with a GitHub link');
        route(/api\.trello\.com\/1\/cards/, (u, o, b, m) => m === 'POST' ? json({ id: 'abcdef123456', shortUrl: 'https://trello.com/c/x' }) : null);
        app.ixSave('issues', { tracker: 'trello', trelloKey: 'k', trelloToken: 't', trelloList: 'L1' });
        const tc = await app.ixIssueCreate({ title: 'بطاقة', body: 'x' });
        ok(tc.url === 'https://trello.com/c/x' && /idList=L1/.test(http.filter(h => /trello/.test(h.url)).pop().url), 'Trello card created');
        app.ixSave('issues', { tracker: 'jira', jiraSite: 'acme.atlassian.net', jiraEmail: 'a@b.c', jiraToken: 'tok', jiraProject: 'ACME' });
        route(/acme\.atlassian\.net\/rest\/api\/3\/issue$/, () => json({ key: 'ACME-7' }, 201));
        const jc = await app.ixIssueCreate({ title: 'Jira task' });
        const jreq = http.filter(h => /atlassian/.test(h.url)).pop();
        ok(jc.identifier === 'ACME-7' && jreq.headers.Authorization === 'Basic ' + Buffer.from('a@b.c:tok').toString('base64') && jreq.body.fields.project.key === 'ACME', 'Jira issue (REST v3 + ADF)');
        const csv = app.ixTodoCsv();
        ok(/ACME/.test(csv) && downloads.some(x => x.name === 'jira-import.csv'), 'Jira CSV export fallback');
        app.ixSave('issues', null);
    }

    section('#986 webhooks on every push • #999 Zapier / Make');
    {
        ok(lib.ghEvent('/repos/o/r/contents/src/a.js', 'PUT').file === 'src/a.js' && lib.ghEvent('/repos/o/r/git/refs/heads/main', 'PATCH').branch === 'main' && lib.ghEvent('/repos/o/r/contents/x', 'GET') === null, 'GitHub write calls → events');
        ok(lib.mergePush([{ repo: 'o/r', file: 'a' }, { repo: 'o/r', file: 'b' }, { repo: 'o/r', file: 'a' }])[0].files.length === 2, 'push burst merged');
        ok(lib.hookKind('https://hooks.zapier.com/hooks/catch/1/abc/') === 'zapier' && lib.hookKind('https://hook.eu1.make.com/xyz') === 'make' && lib.hookKind('https://discord.com/api/webhooks/1/x') === 'discord' && lib.hookKind('http://x') === null, 'URL → kind');
        const zap = [];
        route(/hooks\.zapier\.com\/hooks\/catch/, (u, o, b) => { zap.push(b); return json({ status: 'success' }); });
        route(/hook\.eu1\.make\.com/, (u, o, b) => { zap.push(b); return new Response('Accepted', { status: 200 }); });
        route(/api\.github\.com\/repos\/o\/r\/contents\//, () => json({ content: { sha: '1' } }, 201));
        route(/api\.github\.com\/repos\/o\/r\/releases$/, () => json({ id: 1 }, 201));
        await app.ixLoad('work', 'zapier');
        const h1 = app.ixHookAdd('https://hooks.zapier.com/hooks/catch/1/abc/', ['push', 'release'], 'Zap');
        const h2 = app.ixHookAdd('https://hook.eu1.make.com/xyz', ['release'], 'Make');
        ok(h1.kind === 'zapier' && h2.kind === 'make' && app.ixBootList().includes('hooks') && P.gh.__ixHooked, 'hooks saved + gh wrapped');
        await app.gh('/repos/o/r/contents/src/a.js', { method: 'PUT', body: { message: 'x', content: 'eA==' } });
        await app.gh('/repos/o/r/contents/src/b.js', { method: 'PUT', body: { message: 'x', content: 'eA==' } });
        await app.gh('/repos/o/r/releases', { method: 'POST', body: { tag_name: 'v2.14.0' } });
        await wait(60);
        ok(zap.filter(z => z.event === 'release' && z.tag === 'v2.14.0').length === 2, 'release delivered to Zapier and Make immediately');
        await wait(2600);
        const push = zap.filter(z => z.event === 'push');
        ok(push.length === 1 && push[0].files.length === 2 && push[0].repo === 'o/r' && push[0].source === 'ox-alpha' && /Push/.test(push[0].text), 'two file writes → one merged push event');
        const log = app.ixCfg('hooks').log || [];
        ok(log.length >= 3 && log.every(l => l.ok), 'delivery log');
        ok(await app.ixHookTest(h2.id) && zap.pop().event === 'test', 'test button');
        app.ixHookToggle(h1.id);
        ok(app.ixHooksList().find(h => h.id === h1.id).on === false, 'toggle');
        app.ixHookRemove(h1.id); app.ixHookRemove(h2.id);
        ok(app.ixHooksList().length === 0 && !app.ixBootList().includes('hooks'), 'remove');
    }

    section('#983 Figma → code • #1000 Figma plugin');
    {
        const frame = { type: 'FRAME', name: 'Hero Card', absoluteBoundingBox: { x: 0, y: 0, width: 360, height: 200 }, layoutMode: 'VERTICAL', itemSpacing: 12, paddingLeft: 16, paddingRight: 16, paddingTop: 16, paddingBottom: 16, cornerRadius: 12, fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
            children: [{ type: 'TEXT', name: 'Title', characters: 'مرحباً بك', style: { fontFamily: 'Tajawal', fontSize: 24, fontWeight: 700 }, fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }], absoluteBoundingBox: { x: 16, y: 16, width: 200, height: 30 } },
                { type: 'RECTANGLE', name: 'Button', cornerRadius: 8, fills: [{ type: 'GRADIENT_LINEAR', gradientStops: [{ color: { r: 0.3, g: 0.2, b: 0.9, a: 1 }, position: 0 }, { color: { r: 0.1, g: 0.7, b: 0.9, a: 1 }, position: 1 }] }], absoluteBoundingBox: { x: 16, y: 60, width: 120, height: 40 } }] };
        const out = lib.figmaToHtml(frame);
        ok(out.nodes === 3 && out.rtl && /dir="rtl"/.test(out.html) && /مرحباً بك/.test(out.html), 'HTML with Arabic text → RTL');
        ok(/display:\s*flex/.test(out.css) && /flex-direction:\s*column/.test(out.css) && /gap:\s*12px/.test(out.css) && /linear-gradient/.test(out.css) && /Tajawal/.test(out.css), 'Auto Layout → flex, gradients, fonts');
        route(/api\.figma\.com\/v1\/files\/KEY123\/nodes\?ids=1%3A2/, () => json({ nodes: { '1:2': { document: frame } } }));
        await app.ixLoad('design', 'figma');
        d.getElementById('ix-fg-url').value = 'https://www.figma.com/design/KEY123/Landing?node-id=1-2';
        d.getElementById('ix-fg-token').value = 'figd_x';
        const r = await app.ixFigmaGo();
        ok(r && files.has('design/hero-card/index.html') && files.has('design/hero-card/styles.css') && http.filter(h => /figma/.test(h.url)).pop().headers['X-Figma-Token'] === 'figd_x', 'Figma API → files');
        ok(/مرحباً بك/.test(d.getElementById('ix-fg-frame').srcdoc || ''), 'live preview');
        const pasted = await app.ixFigmaPaste(JSON.stringify({ oxFigma: 1, node: { ...frame, name: 'Pasted' } }));
        ok(pasted && files.has('design/pasted/index.html'), 'paste JSON from the plugin');
        const pf = lib.figmaPluginFiles();
        const man = JSON.parse(pf['figma-plugin/manifest.json']);
        ok(man.api && man.main === 'code.js' && man.ui === 'ui.html' && /figma\.currentPage\.selection/.test(pf['figma-plugin/code.js']), 'Figma plugin: manifest + code.js reading the selection');
        ok((() => { try { require('acorn').parse(pf['figma-plugin/code.js'], { ecmaVersion: 2020 }); return true; } catch (e) { console.log(e.message); return false; } })(), 'plugin code.js parses (ES2020 sandbox)');
        app.ixFigmaPluginMake();
        ok(files.has('figma-plugin/manifest.json'), 'plugin written to the project');
    }

    section('#987 local REST API (service worker ↔ open tab)');
    {
        const spec = lib.apiSpec('9');
        ok(spec.openapi === '3.0.3' && spec.paths['/api/v1/files/{path}'].put && spec.components.securitySchemes.bearer, 'OpenAPI 3 spec');
        await app.ixLoad('ext', 'api');
        ok((await app.ixApiHandle({ method: 'GET', path: '/api/v1/status' })).status === 503, 'disabled by default → 503');
        const c = app.ixApiEnable(true);
        ok(/^oxk_[0-9a-f]{36}$/.test(c.token) && app._ixApiOn && app.ixBootList().includes('api'), 'enable → random token + listeners');
        ok((await app.ixApiHandle({ method: 'GET', path: '/api/v1/files' })).status === 401 && (await app.ixApiHandle({ method: 'GET', path: '/api/v1/files', token: 'bad' })).status === 401, 'no/invalid token → 401');
        const T = c.token, call = (method, p, body) => app.ixApiHandle({ method, path: p, body, auth: 'Bearer ' + T });
        const put = await call('PUT', '/api/v1/files/api/hello.js', { content: 'module.exports = 42;\n' });
        ok(put.status === 201 && files.get('api/hello.js').content === 'module.exports = 42;\n', 'PUT creates a file');
        ok((await call('GET', '/api/v1/files/api/hello.js')).body.content === 'module.exports = 42;\n' && (await call('GET', '/api/v1/files/nope.js')).status === 404, 'GET file / 404');
        ok((await call('GET', '/api/v1/files/..%2F..%2Fetc')).status === 400, 'path traversal rejected');
        const list = (await app.ixApiHandle({ method: 'GET', path: '/api/v1/files', query: { q: 'hello' }, token: T })).body;
        ok(list.length === 1 && list[0].path === 'api/hello.js', 'list with ?q=');
        const run = await call('POST', '/api/v1/run', { code: 'console.log(6*7)' });
        ok(run.status === 200 && /42/.test(JSON.stringify(run.body)), 'POST /run executes JS: ' + JSON.stringify(run.body).slice(0, 80));
        const s = await call('POST', '/api/v1/search', { query: 'module.exports' });
        ok(s.body.hits.some(r => r.path === 'api/hello.js' && r.line === 1), 'POST /search');
        aiText = () => 'جواب عبر API';
        ok((await call('POST', '/api/v1/chat', { message: 'مرحبا' })).body.answer === 'جواب عبر API', 'POST /chat');
        ok((await call('DELETE', '/api/v1/files/api/hello.js')).status === 200 && !files.has('api/hello.js'), 'DELETE');

        // the real sw.js in a worker-like vm: fetch event → MessageChannel → this tab → Response
        const swL = {}, posted = [];
        const target = { url: 'https://daschai.vercel.app/', postMessage: (msg, ports) => { posted.push(msg); app.ixApiHandle(msg.req).then(r => ports[0].postMessage(r)); } };
        const swSelf = { location: new URL('https://daschai.vercel.app/sw.js'), addEventListener: (t, f) => { swL[t] = f; }, clients: { matchAll: async () => [target] }, skipWaiting() {}, registration: {} };
        const ctx = vm.createContext({ self: swSelf, URL, Request, Response, Headers, MessageChannel, setTimeout, clearTimeout, console, caches: { open: async () => ({ match: async () => null, put: async () => {} }), match: async () => null, keys: async () => [] }, fetch: async () => new Response('') });
        vm.runInContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), ctx, { filename: 'sw.js' });
        const swFetch = async (req) => { let p; swL.fetch({ request: req, respondWith: (x) => { p = x; } }); return p; };
        await call('PUT', '/api/v1/files/api/sw.txt', { content: 'via SW' });
        const r1 = await swFetch(new Request('https://daschai.vercel.app/api/v1/files/api/sw.txt', { headers: { Authorization: 'Bearer ' + T } }));
        ok(r1 && r1.status === 200 && (await r1.json()).content === 'via SW' && r1.headers.get('access-control-allow-origin') === '*', 'sw.js routes /api/v1 to the open tab (CORS headers)');
        const r2 = await swFetch(new Request('https://daschai.vercel.app/api/v1/files/api/x.md', { method: 'PUT', headers: { Authorization: 'Bearer ' + T, 'content-type': 'application/json' }, body: JSON.stringify({ content: '# x' }) }));
        ok(r2.status === 201 && files.get('api/x.md').content === '# x' && posted.pop().req.auth === 'Bearer ' + T, 'PUT through the SW');
        ok((await swFetch(new Request('https://daschai.vercel.app/api/v1/status'))).status === 401, 'SW forwards auth failures');
        ok((await swFetch(new Request('https://daschai.vercel.app/api/v1/files', { method: 'OPTIONS' }))).status === 204, 'CORS preflight');
        app.ixApiEnable(false);
        ok(!app.ixBootList().includes('api') && (await app.ixApiHandle({ method: 'GET', path: '/api/v1/status', token: T })).status === 503, 'disable');
    }

    section('#988 VS Code • #989 Chrome • #990 CLI');
    {
        const acorn = require('acorn');
        const gen = require(path.join(ROOT, 'scripts/sync-extensions.cjs')).generated();
        ok(Object.entries(gen).every(([p, t]) => fs.readFileSync(path.join(ROOT, p), 'utf8') === t), 'committed extension files match src/integ/extfiles.js (sync --check)');
        const vpkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'extensions/vscode/package.json'), 'utf8'));
        ok(vpkg.engines.vscode && vpkg.main === './extension.js' && vpkg.contributes.commands.length >= 6 && vpkg.contributes.keybindings && vpkg.contributes.configuration, 'VS Code manifest (commands, keybindings, settings)');
        // run the real extension against a fake vscode API
        const reg = {}, edits = [], sent = [];
        const doc = { getText: (sel) => sel ? 'cnst x = 1' : 'function f() {\n  cnst x = 1\n}', languageId: 'javascript', uri: 'file:///w/a.js', lineCount: 3 };
        const ed = { document: doc, selection: { isEmpty: true }, edit: async (fn) => { fn({ replace: (r, t) => edits.push(t), insert: (p, t) => edits.push(t) }); return true; } };
        const vscode = { commands: { registerCommand: (id, fn) => { reg[id] = fn; return {}; }, executeCommand() {} }, window: { activeTextEditor: ed, withProgress: (o, fn) => fn(), showInformationMessage: async () => 'تطبيق', showErrorMessage: (m) => sent.push('ERR ' + m), createStatusBarItem: () => ({ show() {} }) },
            workspace: { getConfiguration: () => ({ get: (k) => ({ apiKey: 'sk-or-test', model: 'm/x', language: 'ar' })[k] }), asRelativePath: () => 'a.js' }, Range: function () {}, StatusBarAlignment: {}, ProgressLocation: {}, ViewColumn: {} };
        const mod = { exports: {} };
        const fakeFetch = async (url, o) => { sent.push({ url, body: JSON.parse(o.body), auth: o.headers.Authorization }); return json({ choices: [{ message: { content: '```js\nfunction f() {\n  const x = 1\n}\n```' } }] }); };
        new Function('require', 'module', 'exports', 'process', 'fetch', fs.readFileSync(path.join(ROOT, 'extensions/vscode/extension.js'), 'utf8'))((m) => m === 'vscode' ? vscode : require(m), mod, mod.exports, { env: {} }, fakeFetch);
        const subs = [];
        mod.exports.activate({ subscriptions: subs });
        ok(['oxAlpha.ask', 'oxAlpha.explain', 'oxAlpha.fix', 'oxAlpha.commitMessage', 'oxAlpha.open'].every(k => reg[k]) && vpkg.contributes.commands.every(c => reg[c.command]), 'every contributed command is registered');
        await reg['oxAlpha.fix']();
        ok(sent[0].url === 'https://openrouter.ai/api/v1/chat/completions' && sent[0].auth === 'Bearer sk-or-test' && sent[0].body.model === 'm/x' && edits[0] === 'function f() {\n  const x = 1\n}', 'Fix command: OpenRouter → fenced code stripped → applied to the editor');

        const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'extensions/chrome/manifest.json'), 'utf8'));
        ok(man.manifest_version === 3 && man.background.service_worker === 'background.js' && man.permissions.includes('contextMenus') && man.action.default_popup === 'popup.html', 'Chrome MV3 manifest');
        ok(['background.js', 'popup.js', 'options.js'].every(f => { try { acorn.parse(fs.readFileSync(path.join(ROOT, 'extensions/chrome', f), 'utf8'), { ecmaVersion: 2022, sourceType: 'script' }); return true; } catch (e) { console.log(f, e.message); return false; } }), 'Chrome scripts parse');
        ok(/<script src="popup\.js"><\/script>/.test(fs.readFileSync(path.join(ROOT, 'extensions/chrome/popup.html'), 'utf8')) && !/onclick=/.test(fs.readFileSync(path.join(ROOT, 'extensions/chrome/popup.html'), 'utf8')), 'popup has no inline handlers (MV3 CSP)');
        // the background bridge talks to the same postMessage API the app installs
        ok(/oxApi: \{ id, method, path, body, token \}/.test(fs.readFileSync(path.join(ROOT, 'extensions/chrome/background.js'), 'utf8')) && /oxApiReply/.test(fs.readFileSync(path.join(ROOT, 'src/integ/ext.js'), 'utf8')), 'Chrome ↔ app bridge protocol matches');

        const cp = require('child_process');
        const cli = path.join(ROOT, 'cli/ox-alpha.js');
        ok(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).bin['ox-alpha'] === 'cli/ox-alpha.js' && (fs.statSync(cli).mode & 0o111), 'package.json bin + executable');
        ok(/init <static\|react\|express>/.test(cp.execFileSync('node', [cli, 'help']).toString()) && /^ox-alpha \d/.test(cp.execFileSync('node', [cli, 'version']).toString()), 'help / version');
        const tmp = fs.mkdtempSync(path.join(__dirname, 'tmp-cli-'));
        try {
            cp.execFileSync('node', [cli, 'init', 'express', 'api'], { cwd: tmp });
            const pj = JSON.parse(fs.readFileSync(path.join(tmp, 'api/package.json'), 'utf8'));
            ok(pj.dependencies.express && fs.existsSync(path.join(tmp, 'api/server.js')), 'init express scaffolds a project');
            let e = null; try { cp.execFileSync('node', [cli, 'ask', 'hi'], { cwd: tmp, env: { PATH: process.env.PATH }, stdio: 'pipe' }); } catch (x) { e = x; }
            ok(e && /API key/.test(String(e.stderr)), 'ask without a key → clear error');
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
        await app.ixLoad('ext', 'vscode');
        app.ixExtToProject('chrome');
        ok(files.has('extensions/chrome/manifest.json') && JSON.parse(files.get('extensions/chrome/manifest.json').content).host_permissions.some(h => /daschai\.vercel\.app/.test(h)), 'Chrome extension written into the project with this deployment URL');
    }

    section('#340 20 UI languages • #339 full RTL');
    {
        ok(lib.LANGS.length >= 20 && lib.LANGS.filter(l => l[2] === 'rtl').map(l => l[0]).join() === 'ar,ur,fa,he', '20+ languages (4 RTL)');
        await app.ixLoad('ui', 'lang');
        const uiText = () => { const out = []; const wk = d.createTreeWalker(d.body, 4); for (let n = wk.nextNode(); n; n = wk.nextNode()) if (!n.parentElement.closest('script, style, template')) out.push(n.nodeValue); return out.join(' '); };
        ok(!uiText().includes('New chat'), 'Arabic baseline');
        const r = await app.ixSetLang('en');
        ok(d.documentElement.lang === 'en' && d.documentElement.dir === 'ltr' && r.missing > 0, 'English → lang/dir switched');
        const txt = [...d.querySelectorAll('[title]')].map(e => e.getAttribute('title'));
        ok(uiText().includes('New chat') && txt.some(t => /Toggle theme|Command palette/.test(t)), 'shell strings + titles translated');
        const late = d.createElement('button'); late.textContent = 'حفظ'; d.body.appendChild(late);
        await wait(40);
        ok(late.textContent === 'Save', 'dynamically added UI translated (MutationObserver)');
        aiText = (b) => { const c = String(b.messages[b.messages.length - 1].content); const arr = JSON.parse(c.match(/\["[\s\S]*"\]/)[0]); return JSON.stringify({ t: Object.fromEntries(arr.map(k => [k, 'FR ' + k.length])) }); };
        await app.ixSetLang('fr');
        const added = await app.ixLangAI('fr');
        ok(added > 10 && d.documentElement.lang === 'fr' && /FR \d+/.test(uiText()) && !uiText().includes('New chat'), 'missing strings AI-translated once and cached: ' + added);
        ok(app.ixLangImport('de', { 'حفظ': 'Speichern' }) === 1 && app.ixLangDict('de')['حفظ'] === 'Speichern', 'import a language pack');
        await app.ixSetLang('fa');
        ok(d.documentElement.dir === 'rtl', 'Persian → RTL');
        await app.ixSetLang('ar');
        ok(d.documentElement.lang === 'ar' && d.documentElement.dir === 'rtl' && late.textContent === 'حفظ' && !uiText().includes('New chat') && !/FR \d/.test(uiText()) && !app.ixBootList().includes('lang'), 'back to Arabic restores every original string');
        late.remove();
        ok(app.ixSetDir('ltr') === 'ltr' && app.ixBootList().includes('lang') && app.ixSetDir('auto') === 'rtl', 'manual direction override');

        ok(lib.toLogical('.a{margin-left:4px;padding-right: 2px;text-align:left;left:0;border-left:1px solid}') === '.a{margin-inline-start:4px;padding-inline-end: 2px;text-align: start;inset-inline-start:0;border-inline-start:1px solid}', 'physical → logical CSS');
        ok(lib.htmlDirFix('<html><body>مرحبا</body></html>') === '<html dir="rtl" lang="ar"><body>مرحبا</body></html>' && lib.htmlDirFix('<html><body>Hi</body></html>') === null, 'Arabic HTML without dir fixed');
        files.set('rtl/site.css', { content: '.card { float: left; margin-right: 8px; }\n' });
        files.set('rtl/index.html', { content: '<html><body><h1>أهلاً</h1></body></html>' });
        await app.ixLoad('ui', 'rtl');
        const scan = app.ixRtlScan();
        ok(scan.css.some(x => x.path === 'rtl/site.css' && x.issues.length === 2) && scan.html.includes('rtl/index.html'), 'project RTL audit');
        app.ixRtlFix();
        ok(files.get('rtl/site.css').content === '.card { float: inline-start; margin-inline-end: 8px; }\n' && /dir="rtl"/.test(files.get('rtl/index.html').content), 'one-click fix');
    }

    section('#358 external keyboard • #409 text mode • #407 video mode');
    {
        const KE = w.KeyboardEvent;
        ok(lib.latinKey({ key: 'ك', code: 'Semicolon' }) === null && lib.latinKey({ key: 'ش', code: 'KeyA' }) === 'a' && lib.latinKey({ key: 'k', code: 'KeyK' }) === null && lib.latinKey({ key: '٣', code: 'Digit3' }) === '3', 'Arabic layout key → latin by physical code');
        await app.ixLoad('ui', 'keyboard');
        app.ixKbdSave();
        const seen = [];
        const spy = (e) => { if (e.ctrlKey) seen.push(e.key); };
        w.addEventListener('keydown', spy);
        d.body.dispatchEvent(new KE('keydown', { key: 'ن', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true }));
        w.removeEventListener('keydown', spy);
        ok(seen.includes('k') && !seen.includes('ن'), 'Ctrl+ن (Arabic layout) dispatched as Ctrl+K');
        d.body.dispatchEvent(new KE('keydown', { key: 'Tab', bubbles: true }));
        ok(d.body.classList.contains('ox-kbd-nav'), 'Tab → visible focus ring mode');
        d.body.classList.add('ox-hw-kbd');   // detected on touch devices with a Bluetooth keyboard
        d.body.dispatchEvent(new KE('keydown', { key: '?', bubbles: true }));
        await wait(20);
        ok(/اختصارات لوحة المفاتيح/.test(d.body.innerHTML), '? opens the shortcuts sheet (hardware keyboard on touch devices)');
        d.body.classList.remove('ox-hw-kbd');
        app.closePanel && app.closePanel();
        app.ixSave('keyboard', null); app.ixBootSet('keyboard', false);

        ok(app.ixTextMode(true) && d.body.classList.contains('ox-text-mode') && app.ixBootList().includes('textmode'), 'text mode on');
        ok(/ox-text-mode/.test(d.getElementById('ox-integ-css') ? d.getElementById('ox-integ-css').textContent : fs.readFileSync(path.join(ROOT, 'src/integ/integ.css'), 'utf8')), 'text mode styles shipped');
        ok(app.ixTextMode(false) === false && !d.body.classList.contains('ox-text-mode'), 'text mode off');

        const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
        w.navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => tracks }) };
        ok(await app.ixVideoMode(true, { record: false }) && d.querySelector('.ix-cam video') && d.body.classList.contains('ox-video-mode'), 'video mode: camera bubble');
        d.body.dispatchEvent(new KE('keydown', { key: 's', ctrlKey: true, bubbles: true }));
        ok(/Ctrl \+ S/.test(d.querySelector('.ix-keys').textContent), 'keystroke overlay');
        await app.ixVideoMode(false);
        ok(!d.querySelector('.ix-cam') && tracks[0].stopped && !d.body.classList.contains('ox-video-mode'), 'video mode off stops the camera');
        delete w.navigator.mediaDevices;
    }

    section('#352 mirror • #353 dual screen');
    {
        const frames = [];
        const fakeOpen = (u, name, features) => { const f = d.createElement('iframe'); d.body.appendChild(f); frames.push({ f, name, features }); return f.contentWindow; };
        const openOrig = w.open; w.open = fakeOpen;
        files.set('mirror/a.js', { content: 'const a = 1;\nconst b = 2;' });
        app.activeStudioFile = 'mirror/a.js';
        await app.ixLoad('ui', 'screens');
        const st = await app.ixMirror(true, { source: 'code', flip: true });
        const md = frames[0].f.contentDocument;
        ok(st && frames[0].name === 'ox-mirror' && md.querySelectorAll('pre span').length === 2 && md.getElementById('view').classList.contains('flip'), 'mirror window shows the open file (flipped)');
        files.get('mirror/a.js').content += '\nconst c = 3;';
        await wait(900);
        ok(md.querySelectorAll('pre span').length === 3, 'mirror follows edits live');
        app.ixMirror(false);
        w.getScreenDetails = async () => { const cur = { availLeft: 0 }, ext = { availLeft: 1920, availTop: 0, availWidth: 1280, availHeight: 1024 }; return { currentScreen: cur, screens: [cur, ext] }; };
        files.set('index.html', { content: '<!doctype html><html><body><h1>Preview!</h1></body></html>' });
        const dual = await app.ixDualScreen(true, { source: 'preview' });
        const dd = frames[1].f.contentDocument;
        ok(dual && frames[1].features === 'left=1920,top=0,width=1280,height=1024' && /Preview!/.test(dd.querySelector('iframe').srcdoc), 'dual screen placed on the second display with the live preview');
        app.ixDualScreen(false);
        delete w.getScreenDetails; w.open = openOrig;
        frames.forEach(x => x.f.remove());
    }

    section('#319 data table • #318 carousel • #314 dropdowns • #299 progressive • #280 Lottie');
    {
        await app.loadChunk('widgets');
        ok(imported.some(u => /widgets-/.test(u)) && app.wgEnhance, 'widgets chunk loaded (idle)');
        const host = d.createElement('div'); host.className = 'message-content';
        host.innerHTML = '<table><thead><tr><th>الاسم</th><th>العدد</th></tr></thead><tbody>' + Array.from({ length: 30 }, (_, i) => `<tr><td>ملف ${i}</td><td>${(i * 7) % 31}</td></tr>`).join('') + '</tbody></table>'
            + '<p><img src="a.png"><img src="b.png"><img src="c.png"></p>';
        d.body.appendChild(host);
        await wait(40);
        const t = host.querySelector('table').__oxTable;
        ok(t && host.querySelector('.ox-tbar .ox-tq') && host.querySelector('.ox-tcount').textContent === '30 صف', 'chat table auto-enhanced (observer)');
        ok(host.querySelectorAll('tbody tr:not([hidden])').length === 25 && !host.querySelector('.ox-tpager').hidden, 'paged (25/page)');
        host.querySelectorAll('th')[1].click(); host.querySelectorAll('th')[1].click();
        ok(host.querySelector('tbody tr:not([hidden]) td:nth-child(2)').textContent === '30' && host.querySelectorAll('th')[1].getAttribute('aria-sort') === 'descending', 'numeric sort (click header twice → descending)');
        t.filter('ملف 2');
        ok(host.querySelector('.ox-tcount').textContent === '11 / 30', 'filter');
        ok(t.matrix()[0].join() === 'الاسم,العدد' && t.matrix().length === 12, 'export matrix (CSV/copy) follows filter');
        const car = host.querySelector('p.ox-carousel');
        ok(car && car.__oxCarousel.count === 3 && car.querySelectorAll('.ox-cdots button').length === 3, 'image run → carousel');
        ok(car.__oxCarousel.next() === 1 && car.__oxCarousel.go(-1) === 2, 'carousel navigation wraps');
        const sel = d.createElement('select'); sel.innerHTML = Array.from({ length: 20 }, (_, i) => `<option value="m${i}">Model ${i}</option>`).join('');
        host.appendChild(sel);
        await wait(40);
        const q = sel.previousElementSibling;
        ok(q && q.classList.contains('ox-selq'), 'long select → search box');
        q.value = 'model 1'; q.dispatchEvent(new w.Event('input'));
        ok([...sel.options].filter(o => !o.hidden).length === 11, 'type to filter options');
        q.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter' }));
        ok(sel.value === 'm1', 'Enter picks the first match');
        const img = host.querySelector('img');
        ok(img.loading === 'lazy' && img.classList.contains('ox-prog'), 'images lazy + blur-up');
        img.dispatchEvent(new w.Event('load'));
        ok(img.classList.contains('ox-loaded') && !img.classList.contains('ox-prog'), 'blur removed on load');
        const lib2 = app.wgLib();
        ok(lib2.bezierEase(0.42, 0, 0.58, 1, 0.5) > 0.49 && lib2.bezierEase(0.42, 0, 0.58, 1, 0.5) < 0.51, 'Lottie bezier easing');
        const ic = d.createElement('span'); ic.dataset.lottie = 'check'; ic.dataset.loop = 'false'; host.appendChild(ic);
        await wait(40);
        ok(ic.__oxLottie && /<svg[^>]+viewBox="0 0 100 100"/.test(ic.innerHTML) && /<ellipse|<path/.test(ic.innerHTML), 'data-lottie icon rendered as SVG');
        ic.__oxLottie.seek(0); const a = ic.innerHTML; ic.__oxLottie.seek(30);
        ok(a !== ic.innerHTML, 'frames animate (keyframes interpolated)');
        ic.__oxLottie.pause();
        ok(Object.keys(app.ixLottieIcons ? app.ixLottieIcons() : lib2.LOTTIE_ICONS).length >= 4, 'built-in animated icons');
        app.ixWgSet('tables', false);
        const t2 = d.createElement('div'); t2.className = 'message-content'; t2.innerHTML = '<table><tr><th>a</th></tr><tr><td>1</td></tr><tr><td>2</td></tr><tr><td>3</td></tr></table>';
        d.body.appendChild(t2); await wait(40);
        ok(!t2.querySelector('table').__oxTable, 'feature switch respected');
        app.ixWgSet('tables', true);
        host.remove(); t2.remove();
        await app.ixLoad('widgets', 'table');
        ok(d.querySelector('#ixx-sec table') && d.querySelector('#ixx-sec .ox-tbar'), 'components demo in the hub');
        app.ixWgFiles();
        ok([...files.keys()].some(p => /^components\//.test(p)), 'standalone components exported to the project');
    }

    section('#366 points leaderboard • #71 developer leaderboard');
    {
        ok(lib.levelOf(0).name === 'مبتدئ' && lib.levelOf(520).name === 'مطوّر' && lib.levelOf(99999).progress === 100, 'levels');
        const rk = lib.rankContributors([{ author: { login: 'a' }, weeks: [{ c: 1, a: 10, d: 0 }, { c: 0 }, { c: 2, a: 5, d: 5 }] }, { author: { login: 'b' }, weeks: [{ c: 5, a: 100, d: 50 }, { c: 3, a: 1, d: 1 }, { c: 1, a: 1, d: 0 }] }, { author: { login: 'z' }, weeks: [{ c: 0 }] }]);
        ok(rk.length === 2 && rk[0].login === 'b' && rk[0].streak === 3 && rk[1].active === 2, 'contributors ranked (commits, lines, active weeks, streak)');
        localStorage.removeItem('ox_ix_points_v1');
        await app.ixLoad('social', 'points');
        app.ixPointsEnable(true);
        app.writeProjectFile('pts/one.js', '1', 'test'); app.writeProjectFile('pts/one.js', '2', 'test'); app.writeProjectFile('pts/two.js', '1', 'test');
        const L = app.ixLedger();
        ok(L.counts.file === 2 && L.counts.day === 1, 'points for new files + daily streak');
        app.settings.githubToken = 'ghp_x'; app.settings.githubOwner = 'o'; app.settings.githubRepo = 'r'; app.settings.githubBranch = 'main';
        route(/api\.github\.com\/repos\/o\/r\/git\/refs\/heads\/main$/, (u, o, b, m) => m === 'PATCH' ? json({ ref: 'refs/heads/main' }) : null);
        await app.gh('/repos/o/r/git/refs/heads/main', { method: 'PATCH', body: { sha: 'abc' } });
        ok(app.ixLedger().counts.push === 1 && app.ixScore().total >= 2 * 3 + 10 + 15, 'push awarded: ' + app.ixScore().total);
        let board = { updated: 'x', entries: [{ user: 'sara', points: 9999, level: 'خبير', at: '2026-10-01T00:00:00Z' }] };
        route(/api\.github\.com\/user$/, () => json({ login: 'nader' }));
        route(/api\.github\.com\/repos\/o\/r\/contents\/\.ox\/leaderboard\.json/, (u, o, b, m) => {
            if (m === 'PUT') { board = JSON.parse(Buffer.from(b.content, 'base64').toString('utf8')); return json({ content: { sha: 's2' } }); }
            return json({ content: Buffer.from(JSON.stringify(board)).toString('base64'), sha: 's1' });
        });
        const next = await app.ixBoardPublish();
        const put = http.filter(h => /leaderboard/.test(h.url) && h.method === 'PUT').pop();
        ok(next.entries.length === 2 && next.entries[0].user === 'sara' && board.entries[1].user === 'nader' && put.body.sha === 's1', 'shared team board in .ox/leaderboard.json');
        ok(/sara/.test(d.getElementById('ix-pt-board').innerHTML) && /🥇/.test(d.getElementById('ix-pt-board').innerHTML), 'board rendered with medals');
        app.ixPointsEnable(false);
        let calls = 0;
        route(/api\.github\.com\/repos\/o\/r\/stats\/contributors/, () => (++calls === 1 ? new Response('', { status: 202 }) : json([{ author: { login: 'nader', avatar_url: 'https://avatars/x?v=4' }, weeks: [{ c: 4, a: 50, d: 5 }] }])));
        app._ixTestFast = true;
        await app.ixLoad('social', 'devs');
        const rows = await app.ixDevBoardLoad();
        ok(calls === 2 && rows[0].login === 'nader' && /ix-champion/.test(d.getElementById('ix-dv-res').innerHTML), 'GitHub 202 (computing) retried → ranked board');
    }

    section('#1003 code in space (AR / VR / 3D)');
    {
        const ring = lib.ringLayout(4);
        ok(ring.map(r => r.rotY).join() === '0,90,180,270' && ring[0].z >= 900, 'ring layout');
        ok(JSON.stringify(lib.gyroToRotation({ alpha: 350, beta: 30 }, { alpha: 10, beta: 0 })) === '{"ry":-20,"rx":-30}' && lib.gyroToRotation({}) === null, 'gyroscope → rotation (wraps 360°)');
        await app.ixLoad('space', 'ar');
        ok(app.ixCodeSpace(true, { stereo: true }), 'opened');
        const root = d.getElementById('ix-space');
        const panels = root.querySelectorAll('.ix-sp-eye:first-child .ix-sp-panel');
        ok(root.classList.contains('ix-stereo') && root.querySelectorAll('.ix-sp-eye').length === 2 && panels.length >= 3 && panels.length <= 12, 'stereo (cardboard) scene with code panels: ' + panels.length);
        const before = root.querySelector('.ix-sp-scene').style.transform;
        w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight' }));
        ok(root.querySelector('.ix-sp-scene').style.transform !== before, 'keyboard rotates');
        const ev = new w.Event('deviceorientation'); Object.assign(ev, { alpha: 0, beta: 0 }); w.dispatchEvent(ev);
        const ev2 = new w.Event('deviceorientation'); Object.assign(ev2, { alpha: 30, beta: 10 }); app._ixSpace.onGyro(ev); app._ixSpace.onGyro(ev2);
        ok(app._ixSpace.ry === 30 && app._ixSpace.rx === -10, 'gyroscope drives the camera');
        w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
        ok(!d.getElementById('ix-space') && !app._ixSpace, 'Escape closes');
        ok(lib.codeCanvas(d, 't', 'const a = 1').width === 1024 && (await app.ixXRSupported()) === false, 'WebXR texture + capability check');
    }


    section('Done');
    if (errors.length) console.log(errors.join('\n'));
    ok(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
    process.exitCode = process.exitCode || 0;
    setTimeout(() => process.exit(process.exitCode), 50);
})().catch((e) => { console.error('❌ FATAL', e); process.exitCode = 1; setTimeout(() => process.exit(1), 50); });
