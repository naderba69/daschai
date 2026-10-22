/* Sprint 13 — Editor (#134-#270 remaining 38 ideas) through the lazy Developer Lab chunk. */
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

/** workers/polyglot.js driven in-process with fake Ruby/PHP runtimes and a fake Wandbox. */
function fakePolyWorker(fetchImpl) {
    const { createPolyglot } = require('../workers/polyglot.js');
    class FakePhp extends NodeEventTarget {
        run(code) { const m = /echo\s+"([^"]*)"/.exec(code); this.dispatchEvent(Object.assign(new NodeEvent('output'), { detail: [m ? m[1].replace(/\\n/g, '\n') : ''] })); return Promise.resolve(/exit\(3\)/.test(code) ? 3 : 0); }
    }
    const sink = {};
    const poly = createPolyglot({
        loadRuby: () => ({ sink, createVM: () => ({ eval(code) { if (/raise/.test(code)) throw new Error('RuntimeError: boom'); const inp = (/StringIO\.new\("([^"]*)"\)/.exec(code) || [])[1] || ''; (code.match(/puts\s+"([^"]*)"/g) || []).forEach(x => sink.out(x.slice(6, -1).replace('#{gets}', inp.split('\\n')[0]) + '\n')); } }) }),
        loadPhp: () => FakePhp,
        fetch: fetchImpl
    });
    const wk = { onmessage: null, onerror: null, terminate() {} };
    wk.postMessage = (msg) => { poly.run(msg, (stream, text) => wk.onmessage && wk.onmessage({ data: { id: msg.id, type: 'out', stream, text } })).then(r => wk.onmessage && wk.onmessage({ data: Object.assign({ id: msg.id, type: 'done' }, r) })); };
    return wk;
}

(async () => {
    let aiText = () => 'رد الذكاء';
    const or = mockOpenRouter(async (body) => ({ text: aiText(body) }));
    const gists = {};
    let gistSeq = 0;
    const ghLog = [];
    let graphql = null;
    const fetchAll = async (url, opts = {}) => {
        const u = String(url);
        const method = (opts.method || 'GET').toUpperCase();
        if (u.includes('openrouter.ai')) return or.fetchImpl(url, opts);
        if (u.startsWith('https://api.github.com/')) {
            ghLog.push(method + ' ' + u.replace('https://api.github.com', ''));
            const body = opts.body ? JSON.parse(opts.body) : null;
            const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
            let m;
            if (u === 'https://api.github.com/gists' && method === 'POST') { const id = 'g' + (++gistSeq); gists[id] = { id, files: {} }; Object.entries(body.files).forEach(([n, f]) => { gists[id].files[n] = { content: f.content }; }); return json(gists[id], 201); }
            if ((m = /\/gists\/(\w+)$/.exec(u))) {
                const g = gists[m[1]];
                if (!g) return json({ message: 'Not Found' }, 404);
                if (method === 'PATCH') Object.entries(body.files).forEach(([n, f]) => { if (f === null) delete g.files[n]; else g.files[n] = { content: f.content }; });
                return json(g);
            }
            if (u === 'https://api.github.com/graphql') return json(graphql ? graphql(body) : { data: null });
            if (/\/repos\/o\/r\/commits\?/.test(u)) return json([{ sha: 'abc1234567', commit: { message: 'init math\n\nbody', author: { date: '2026-10-01T10:00:00Z' } } }]);
            if ((m = /\/repos\/o\/r\/contents\/(.+)\?ref=(\w+)/.exec(u))) return json({ content: Buffer.from('export function add(a, b) {\n    return a + b; // v0\n}\n').toString('base64') });
            return json({ message: 'Not Found' }, 404);
        }
        if (u === 'https://wandbox.org/api/list.json') return new Response(JSON.stringify([{ name: 'go-1.23.2', language: 'Go' }, { name: 'go-head', language: 'Go' }]), { status: 200 });
        if (u === 'https://wandbox.org/api/compile.json') { const b = JSON.parse(opts.body); return new Response(JSON.stringify(/syntax/.test(b.code) ? { status: '1', compiler_error: 'prog.go:1: syntax error' } : { status: '0', program_output: 'Hello, Go ' + b.compiler + '\n' }), { status: 200 }); }
        if (u.startsWith('https://registry.npmjs.org/')) {
            const n = decodeURIComponent(u.slice('https://registry.npmjs.org/'.length));
            const vers = { 'left-pad': ['1.0.0', '1.3.0'], lodash: ['4.17.20', '4.17.21'] }[n];
            if (!vers) return new Response('{"error":"Not found"}', { status: 404 });
            return new Response(JSON.stringify({ name: n, 'dist-tags': { latest: vers[vers.length - 1] }, versions: Object.fromEntries(vers.map(v => [v, { name: n, version: v, dependencies: {} }])) }), { status: 200 });
        }
        const rel = u.replace(/^https:\/\/daschai\.vercel\.app/, '').replace(/^\//, '').split('?')[0];
        if (rel && fs.existsSync(path.join(ROOT, rel)) && fs.statSync(path.join(ROOT, rel)).isFile()) return new Response(fs.readFileSync(path.join(ROOT, rel)), { status: 200 });
        return new Response('{}', { status: 404 });
    };
    const { w, d, app, errors } = loadApp({ fetchImpl: fetchAll, indexedDB: globalThis.indexedDB, beforeParse: browserStubs });
    w.addEventListener('error', (e) => { if (e.error && e.error.stack) console.log('STACK', e.error.stack.split('\n').slice(0, 4).join(' | ')); });
    exposeGlobals(w);
    globalThis.fetch = fetchAll;
    const imported = [];
    app.importModule = (url) => { imported.push(url); return import(pathToFileURL(path.join(ROOT, url)).href); };
    app.createRunSandbox = vmSandbox;
    app.createPolyglotWorker = () => fakePolyWorker(fetchAll);
    const downloads = [];
    app.downloadBlob = (blob, name) => { downloads.push({ blob, name }); };
    app.askConfirm = async () => true;
    app.askText = async (t, v) => v;
    app.copyText = async () => true;
    app.settings.apiKey = 'sk-or-test';
    app.settings.githubOwner = 'o'; app.settings.githubRepo = 'r'; app.settings.githubToken = 'ghp_test';
    await wait(80);
    const files = app.virtualProjectFiles;
    const setFiles = (obj) => { files.clear(); Object.entries(obj).forEach(([p, c]) => files.set(p, { content: c, lang: p.split('.').pop(), timestamp: Date.now() })); };
    setFiles({
        'package.json': JSON.stringify({ name: 'demo', scripts: { test: 'echo ok' }, dependencies: {} }, null, 2),
        'index.html': '<!doctype html><html><body><h1>مرحبا</h1><script src="src/main.js"></script></body></html>',
        'src/main.js': "import { add } from './utils/math.js';\nimport { greet } from './utils/text.js';\nconsole.log(add(2, 3), greet('سارة'));\n",
        'src/utils/math.js': 'export function add(a, b) {\n    return a + b;\n}\nexport function sub(a, b) { return a - b; }\n',
        'src/utils/text.js': "export const greet = (n) => 'مرحبا ' + n;\n",
        'src/styles.css': 'a { color: red; }\n'
    });

    section('Lazy dev chunk + main core');
    const P = Object.getPrototypeOf(app);
    ok(app.openDevLab.__oxLazy === 'dev' && app.dvRunPoly.__oxLazy === 'dev' && app.dvE2EAttach.__oxLazy === 'dev', 'Developer Lab entry points are lazy stubs');
    ok(!P.__oxDev && !imported.some(u => /dev-/.test(u)), 'chunk not loaded at startup');
    ok(app.DEV_TABS.length === 10 && app.buildPaletteCommands().filter(c => c.section === 'مختبر المطوّر').length === 10, '10 tabs in the palette');
    ok(app.BUILTIN_SHORTCUTS.some(x => x[0] === 'Alt+I'), 'Alt+I shortcut registered');
    ok(app.dvPolyLang('a/b.rb') === 'ruby' && app.dvPolyLang('x.go') === 'go' && app.dvPolyLang('x.js') === null, '#153 polyglot detection in the main bundle');
    ok(app.folderIcon('src', true)[0].includes('fa-folder-open') && app.fileIcon('a.js')[0], 'default folder/file icons');

    section('Open every section (sweep)');
    { let got = null; app.openDevLab = (t) => { got = t; }; app.handleLaunchParams('?action=dev&tab=debug'); await wait(350); delete app.openDevLab; ok(got === 'debug', '?action=dev&tab= deep link'); }
    await app.openDevLab('search');
    ok(P.__oxDev && imported.some(u => /dev-/.test(u)), 'chunk loaded on first use');
    const lib = app.dvLib();
    ok(lib && lib.TAB_DEFS && Object.keys(lib.TAB_DEFS).length === 10, 'lib exported');
    let n = 0, bad = [];
    for (const [tab, secs] of Object.entries(lib.TAB_DEFS)) {
        for (const [sec] of secs) {
            if (tab === 'term' && sec === 'shell') continue; // xterm needs a real DOM layout — tested below via dvShellExec
            await app.dvLoad(tab, sec);
            const el = d.getElementById('dvx-sec');
            n++;
            if (!el || /gh-empty bad/.test(el.innerHTML) || !el.innerHTML.trim()) bad.push(tab + '/' + sec + ': ' + (el ? el.textContent.slice(0, 120) : 'no el'));
        }
    }
    ok(bad.length === 0 && n === 34, `rendered ${n} sections without errors` + (bad.length ? ' — ' + bad.join(' | ') : ''));

    section('#134 Regex search & replace across the project');
    {
        const L = lib;
        const re = L.buildSearchRegex({ pattern: '(\\w+)\\(a, b\\)', regex: true });
        const ms = L.findMatches(files.get('src/utils/math.js').content, re);
        ok(ms.length === 2 && ms[0].groups[0] === 'add' && ms[0].line === 1, 'findMatches with groups + line numbers');
        ok(L.expandReplacement({ match: 'userName', groups: ['user', 'Name'], index: 0, end: 8 }, '\\U$1\\E_$2') === 'USER_Name', 'replacement case operators \\U \\E');
        ok(L.preserveCase('Hello', 'world') === 'World' && L.preserveCase('HELLO', 'world') === 'WORLD', 'preserve case');
        await app.dvLoad('search', 'regex');
        const st = app.dvSearchRun({ pattern: 'function (\\w+)\\(', replace: 'function $1_v2(', include: 'src/**' });
        ok(st && st.results.length === 1 && st.results[0].matches.length === 2, 'project search honours include globs');
        const r = app.dvReplaceSelected();
        if (!r || r.replaced !== 2) console.log('REPL', JSON.stringify(r), files.get('src/utils/math.js').content);
        ok(r && r.replaced === 2 && files.get('src/utils/math.js').content.includes('function add_v2(') && files.get('src/utils/math.js').content.includes('function sub_v2('), 'replace selected matches');
        ok(app._dvBatches.length === 1, 'replacement recorded as one batch');
        app.dvUndoBatch(app._dvBatches[0].id);
        ok(files.get('src/utils/math.js').content.includes('function add(a, b)'), 'undo the whole batch');
        const ar = app.dvSearchRun({ pattern: 'مرحبا', regex: false, include: '' });
        ok(ar.results.length >= 2, 'Arabic literal search');
    }

    section('#241 multi-file edit • #242 folder refactor');
    {
        const L = lib;
        ok(L.renderTemplate('{{Name}}-{{name_kebab}}-{{ name | snake }}', L.templateVars('userCard')) === 'UserCard-user-card-user_card', 'template variables + filters');
        ok(L.templatize('class UserCard {} // user-card', 'UserCard') === 'class {{Name}} {} // {{name_kebab}}', 'templatize concrete text');
        ok(L.renameSymbol('const add = 1; addAll(add); obj.add', 'add', 'sum').count === 3, 'symbol rename keeps longer identifiers');
        const fm = new Map(Array.from(files).map(([p, f]) => [p, f.content]));
        const plan = L.planMoves(fm, [['src/utils/math.js', 'src/lib/math.js']]);
        const main = plan.changes.find(([p]) => p === 'src/main.js');
        ok(main && main[1].text.includes("from './lib/math.js'") && plan.rewired === 1, 'planMoves rewrites importers');
        ok(plan.changes.some(([p, v]) => p === 'src/utils/math.js' && v === null) && plan.changes.some(([p, v]) => p === 'src/lib/math.js' && v.from), 'planMoves deletes source + creates target');
        const plan2 = L.planMoves(fm, [['src/main.js', 'app/main.js']]);
        const moved = plan2.changes.find(([p]) => p === 'app/main.js');
        const html = plan2.changes.find(([p]) => p === 'index.html');
        ok(moved && moved[1].text.includes("from '../src/utils/math.js'"), 'moved file rewrites its own relative imports');
        ok(html && html[1].text.includes('src="app/main.js"'), 'HTML script src updated');
        ok(L.casePath('src/UserCard.test.js', 'kebab') === 'src/user-card.test.js', 'filename case conversion');
        ok(L.barrelFor('src/utils', Array.from(files.keys())).text === "export * from './math';\nexport * from './text';\n", 'index barrel');

        await app.dvLoad('refactor', 'multiedit');
        let edits = await app.dvMultiEditPlan({ glob: 'src/**/*.js', op: 'header', a: '// {{path}}' });
        ok(edits.length === 3 && edits.every(([p, t]) => t.startsWith('// ' + p + '\n')), 'header banner on every matching file');
        edits = await app.dvMultiEditPlan({ glob: 'src/utils/*.js', op: 'import', a: "import { log } from '../log.js';" });
        ok(edits.length === 2 && edits[0][1].startsWith("import { log }"), 'add import if missing');
        edits = await app.dvMultiEditPlan({ glob: 'src/**', op: 'rename', a: 'greet', b: 'welcome' });
        ok(edits.length === 2, 'symbol rename across files');
        edits = await app.dvMultiEditPlan({ glob: 'src/**', op: 'replace', a: 'a + b', b: '$a', regex: false });
        ok(edits.length === 1 && edits[0][1].includes('return $a;'), 'literal replace keeps $ literal');
        edits = await app.dvMultiEditPlan({ glob: 'src/**', op: 'strip', a: '^console\\.log' });
        ok(edits.length === 1 && !edits[0][1].includes('console.log'), 'strip matching lines');
        aiText = (body) => { const m = /File: (\S+)/.exec(JSON.stringify(body)); return '```js\n// AI ' + (m ? m[1] : '') + '\nexport const x = 1;\n```'; };
        edits = await app.dvMultiEditPlan({ glob: 'src/utils/*.js', op: 'ai', a: 'add a comment' });
        ok(edits.length === 2 && edits[0][1].startsWith('// AI src/utils/'), 'AI per-file instruction');
        app.dvRfPreview('test', [['src/main.js', '// x\n' + files.get('src/main.js').content]], 'dvx-sec');
        ok(d.getElementById('dvx-sec').innerHTML.includes('+1'), 'preview shows diff counts');
        const b = app.dvRfApply();
        ok(b && files.get('src/main.js').content.startsWith('// x\n'), 'apply as one batch');
        app.dvUndoBatch(b.id);

        await app.dvLoad('refactor', 'folder');
        const r = await app.dvFolderPlan({ dir: 'src/utils', op: 'move', to: 'src/shared' });
        if (r.rewired !== 2) console.log(JSON.stringify(r.edits), r.rewired);
        ok(r.rewired === 2 && r.edits.length === 5, 'folder move plan: 2 imports rewired');
        app.dvRfPreview(r.label, r.edits, 'dvx-sec'); app._dvRf.plan = r.plan;
        const fb = app.dvRfApply();
        ok(files.has('src/shared/math.js') && !files.has('src/utils/math.js') && files.get('src/main.js').content.includes("'./shared/math.js'"), 'folder moved + imports updated');
        app.dvUndoBatch(fb.id);
        ok(files.has('src/utils/math.js') && !files.has('src/shared/math.js') && files.get('src/main.js').content.includes("'./utils/math.js'"), 'folder move undone');
        let err = null; try { await app.dvFolderPlan({ dir: 'src', op: 'move', to: 'src/inner' }); } catch (e) { err = e.message; }
        ok(err && /نفسه/.test(err), 'cannot move a folder into itself');
        files.set('src/utils/StringHelpers.js', { content: 'export const h = 1;\n' });
        files.set('src/use.js', { content: "import { h } from './utils/StringHelpers.js';\n" });
        const cr = await app.dvFolderPlan({ dir: 'src/utils', op: 'case', kind: 'kebab' });
        ok(cr.plan.changes.some(([p]) => p === 'src/utils/string-helpers.js') && cr.plan.changes.find(([p]) => p === 'src/use.js')[1].text.includes('./utils/string-helpers.js'), 'case conversion renames + rewires');
        files.delete('src/utils/StringHelpers.js'); files.delete('src/use.js');
        const br = await app.dvFolderPlan({ dir: 'src/utils', op: 'barrel' });
        ok(br.edits[0][0] === 'src/utils/index.js', 'barrel plan');
        aiText = () => '{"moves":[["src/utils/text.js","src/utils/strings/text.js"]],"reason":"فصل النصوص"}';
        const ai = await app.dvFolderPlan({ dir: 'src/utils', op: 'ai', instruction: 'organize' });
        ok(ai.plan && ai.reason === 'فصل النصوص' && ai.plan.changes.find(([p]) => p === 'src/main.js')[1].text.includes('./utils/strings/text.js'), 'AI folder refactor → safe move plan');
    }

    section('#246 file templates • #247 folder templates • #248 duplicate • #250 zip');
    {
        await app.dvLoad('refactor', 'templates');
        app.activeStudioFile = 'src/utils/math.js';
        const t = app.dvTemplateFromFile('src/utils/math.js');
        ok(t && t.path === 'src/utils/{{name_kebab}}.js', 'save current file as template (name → variable)');
        const p = await app.dvTemplateUse(t.id, 'geometry');
        ok(p === 'src/utils/geometry.js' && files.get(p).content.includes('export function add'), 'create file from user template');
        const fk = app.dvTemplateFork('react');
        ok(fk && /\{\{Name\}\}/.test(fk.content), 'fork built-in template into my templates');
        const bp = await app.dvTemplateUseBuiltin('css', 'src/theme.css');
        ok(bp === 'src/theme.css' && files.has('src/theme.css'), 'create from built-in template');
        await app.dvLoad('refactor', 'scaffold');
        const ft = app.dvScaffoldFromFolder('src/utils', 'utils-kit');
        ok(ft && ft.kind === 'folder' && Object.keys(ft.files).length >= 2, 'save folder as template');
        const made = await app.dvScaffoldUse(ft.id, 'helpers', 'lib');
        ok(Array.isArray(made) && made.includes('lib/helpers/math.js'), 'create folder with files from template');
        ok(app.dvTemplatesList().length === 3, 'templates persisted in localStorage');

        await app.dvLoad('refactor', 'fileops');
        files.set('src/UserCard.jsx', { content: 'export function UserCard() { return <div className="user-card">UserCard</div>; }\n' });
        const dp = app.dvDuplicate('src/UserCard.jsx', 'src/ProductCard.jsx');
        ok(dp === 'src/ProductCard.jsx' && files.get(dp).content.includes('function ProductCard') && files.get(dp).content.includes('product-card'), 'smart duplicate renames identifiers');
        const dup2 = app.dvDuplicate('src/UserCard.jsx');
        ok(dup2 && dup2 !== 'src/UserCard.jsx' && files.has(dup2), 'plain duplicate');
        const copied = app.dvDuplicateFolder('src/utils', 'src/tools');
        ok(copied.includes('src/tools/math.js') && files.has('src/utils/math.js'), 'duplicate folder');
        if (typeof w.JSZip === 'undefined') { globalThis.JSZip = require('jszip'); w.JSZip = globalThis.JSZip; }
        let z = null; try { z = await app.dvZipFolder('src/utils'); } catch (e) { console.log('ZIP', e.stack); }
        ok(z && z.count === 3 && z.name === 'utils.zip' && z.blob.size > 50, 'zip a folder');
        const zz = await (await new globalThis.JSZip().loadAsync(await z.blob.arrayBuffer()));
        ok(Object.keys(zz.files).includes('math.js'), 'zip paths relative to folder');
    }

    section('#202 timeline • #204 compare • #269 blame • #203 restore');
    {
        const L = lib;
        const T0 = Date.now() - 3 * 3600e3, T1 = Date.now() - 2 * 3600e3, T2 = Date.now() - 3600e3;
        files.set('hist.js', { content: 'line1\nline2 changed\nline3\nline4 new\n', timestamp: T2 });
        app.fileVersions.set('hist.js', [{ t: T0, content: 'line1\nline2\nline3\n', reason: 'edit' }, { t: T1, content: 'line1\nline2 changed\nline3\n', reason: 'replace' }]);
        const st = app.dvStates('hist.js');
        ok(st.length === 3 && st[2].current, 'fileStates: versions + current');
        ok(L.stateAt(st, T0 + 1000).content === 'line1\nline2\nline3\n' && L.stateAt(st, T0 - 1) === null, 'stateAt(T)');
        const tl = L.buildTimeline({ 'hist.js': st });
        ok(tl.length === 3 && tl[0].current && tl[1].reason === 'edit' && tl[0].reason === 'replace', 'timeline transitions carry the reason');
        const lb = L.localBlame(st);
        ok(lb[0].idx === 0 && lb[1].idx === 1 && lb[3].idx === 2, 'local blame per line');
        await app.dvLoad('history', 'timeline');
        ok(d.getElementById('dvx-sec').innerHTML.includes('hist.js'), 'timeline lists edited files');
        await app.dvCompareOpen('hist.js', '0', 'current');
        await wait(30);
        ok(/\+2/.test(d.getElementById('dv-cmp-res').textContent), 'compare version 0 with current');
        await app.dvCompareGitHub();
        ok(app._dvGhVers['hist.js'][0].sha === 'abc1234567', 'GitHub versions listed for compare');
        app._dvCmp.a.ver = 'gh:abc1234567';
        const txt = await app.dvCompareText('a');
        ok(/v0/.test(txt), 'GitHub version content via contents?ref');
        graphql = (body) => ({ data: { repository: { object: { blame: { ranges: [{ startingLine: 1, endingLine: 2, age: 1, commit: { oid: 'aaa1111', abbreviatedOid: 'aaa1111', message: 'first', committedDate: '2026-10-01T00:00:00Z', author: { name: 'Nader' } } }, { startingLine: 3, endingLine: 3, age: 5, commit: { oid: 'bbb2222', abbreviatedOid: 'bbb2222', message: 'second', committedDate: '2026-10-10T00:00:00Z', author: { user: { login: 'sara' } } } }] } } } } });
        const bl = L.blameFromRanges(graphql().data.repository.object.blame.ranges);
        ok(bl[1].author === 'Nader' && bl[3].author === 'sara', 'blameFromRanges');
        const r = await app.dvBlameCompute('hist.js', 'github');
        ok(r.rows[0].who === 'Nader' && r.rows[2].label === 'bbb2222' && ghLog.some(x => x === 'POST /graphql'), 'GitHub GraphQL blame');
        graphql = () => ({ errors: [{ message: 'rate limited' }] });
        await app.dvLoad('history', 'blame');
        await app.dvBlameRun('hist.js', 'github');
        ok(/rate limited/.test(d.getElementById('dv-blame-res').textContent) && d.getElementById('dv-blame-res').querySelectorAll('.dvx-bl').length === 5, 'blame falls back to local history');
        const plan = app.dvRestorePlan(T0 + 1000);
        ok(plan.some(p => p.path === 'hist.js' && p.action === 'modify' && p.to === 'line1\nline2\nline3\n'), 'restore plan to time T');
        const nRestored = await app.dvRestoreApply(T0 + 1000, { yes: true });
        ok(nRestored >= 1 && files.get('hist.js').content === 'line1\nline2\nline3\n', 'project restored to T');
        app.dvUndoBatch(app._dvBatches[0].id);
        ok(files.get('hist.js').content === 'line1\nline2 changed\nline3\nline4 new\n', 'restore undone');
    }

    section('#208 settings sync • #209 extensions • #258 menus • #270 icons');
    {
        const L = lib;
        w.localStorage.setItem('ox_alpha_editor_v2', JSON.stringify({ fontSize: 17, theme: 'ox' }));
        const pl = L.buildSyncPayload(['editor', 'app'], { get: (k) => w.localStorage.getItem(k), settings: { apiKey: 'x', githubToken: 'y', theme: 'dark', syncGistId: 'z' } });
        ok(pl.data.ox_alpha_editor_v2 && pl.settings.theme === 'dark' && !('apiKey' in pl.settings) && !('githubToken' in pl.settings) && !('syncGistId' in pl.settings), 'sync payload excludes secrets');
        await app.dvLoad('custom', 'sync');
        delete app.settings.syncGistId;
        const pushed = await app.dvSyncPush({ groups: ['editor', 'extensions'] });
        ok(pushed.id === 'g1' && app.settings.syncGistId === 'g1' && JSON.parse(gists.g1.files['ox-settings.json'].content).data.ox_alpha_editor_v2, 'push creates a private gist');
        // simulate another device
        const remote = JSON.parse(gists.g1.files['ox-settings.json'].content);
        remote.data.ox_alpha_editor_v2 = JSON.stringify({ fontSize: 20, theme: 'ox' }); remote.at = Date.now() + 5000;
        gists.g1.files['ox-settings.json'].content = JSON.stringify(remote);
        const fetched = await app.dvSyncFetch();
        const diff = app.dvSyncDiff(fetched);
        ok(diff.length === 1 && diff[0].key === 'ox_alpha_editor_v2', 'diff remote vs local');
        await app.dvSyncPullUI();
        ok(d.getElementById('dv-sync-res').querySelector('#dv-sp-editor'), 'pull UI lists differing groups');
        const applied = app.dvSyncApplyUI();
        ok(applied >= 1 && JSON.parse(w.localStorage.getItem('ox_alpha_editor_v2')).fontSize === 20 && (!app.getEditorSettings || app.getEditorSettings().fontSize === 20), 'apply remote editor settings');
        app.settings.dvAutoSync = true;
        const auto = await app.dvAutoSyncRun();
        ok(auto && (auto.same || auto.pushed), 'auto-sync: nothing newer remotely');
        app.settings.dvAutoSync = false;

        ok(!L.validateExtension('{bad').ok && !L.validateExtension({ name: 'x', commands: [{ title: 't', action: 'eval' }] }).ok, 'invalid manifests rejected (no code actions)');
        const sn = L.expandSnippet('const ${1:name} = () => {\n    $0\n};');
        ok(sn.text === 'const name = () => {\n    \n};' && sn.cursor === sn.text.indexOf('\n    ') + 5, 'snippet placeholders + cursor');
        const wr = L.applyCommand({ action: 'wrap', before: '(', after: ')' }, 'a b c', 2, 3);
        ok(wr.text === 'a (b) c' && wr.from === 3 && wr.to === 4, 'wrap command');
        ok(L.applyCommand({ action: 'transform', case: 'kebab' }, 'userName', 0, 8).text === 'user-name', 'transform command');
        ok(L.applyCommand({ action: 'replace', find: '^\\s*console\\.log\\(.*\\);?\\n', with: '', flags: 'gm' }, 'a\nconsole.log(1);\nb', 0, 0).text === 'a\nb', 'regex replace command');
        await app.dvLoad('custom', 'extensions');
        const v = app.dvExtInstall(L.EXT_SAMPLE);
        ok(v.ok && app.dvExtList().length === 1, 'install sample extension');
        ok(app.buildPaletteCommands().some(c => c.label === 'تغليف التحديد بـ try/catch' && c.kbd === 'Ctrl+Alt+T'), 'extension commands in the palette');
        ok(app.fileIcon('App.vue')[0] === 'fa-brands fa-vuejs', 'extension icons in the explorer');
        await app.ensureStudio();
        const lint = app.dvExtLint('let a = 1;\ndebugger;\n// TODO fix\n', 'src/a.js');
        ok(lint.length === 2 && lint.some(x => x.message.startsWith('احذف debugger')) && lint.every(x => x.source === 'ext'), 'extension lint rules → diagnostics');
        ok(app.dvExtLint('debugger; // TODO x', 'notes.md').length === 1, 'files glob limits a rule (TODO rule has no glob)');
        app.dvExtEnable(v.ext.id);
        ok(app.dvExtActiveList().length === 0 && !app.buildPaletteCommands().some(c => c.label === 'تغليف التحديد بـ try/catch'), 'disable extension');
        app.dvExtEnable(v.ext.id);
        aiText = () => '{"name":"React","commands":[{"title":"useMemo","action":"wrap","before":"useMemo(() => ","after":", [])"}]}';
        const ai = await app.dvExtAI.call(Object.assign(Object.create(app), { askText: async () => 'react helpers' }));
        ok(ai && ai.ok && app.dvExtList().length === 2, 'AI-generated extension manifest');

        await app.dvLoad('custom', 'menus');
        const items = [{ label: 'فتح', run() {} }, { label: 'إعادة تسمية', run() {} }, '-', { label: 'حذف', danger: true, run() {} }];
        app.applyMenuPrefs(items);
        ok(JSON.parse(w.localStorage.getItem('ox_dv_menu_seen_v1')).includes('حذف'), 'menu labels remembered for the customizer');
        app.dvMenuToggle('hidden', 'إعادة تسمية'); app.dvMenuToggle('top', 'حذف');
        const out = app.applyMenuPrefs(items);
        ok(out[0].label === 'حذف' && out[1] === '-' && !out.some(x => x.label === 'إعادة تسمية') && out[out.length - 1] !== '-', 'menu prefs hide + pin items');
        const palN = app.buildPaletteCommands().length;
        app.dvMenuToggle('palHidden', 'مطوّر — قلم');
        ok(app.buildPaletteCommands().length === palN - 1, 'hide palette commands');
        app.dvMenuReset();
        ok(app.applyMenuPrefs(items).length === 4, 'reset menus');

        await app.dvLoad('custom', 'icons');
        app.dvIconSet('vivid');
        ok(app.fileIcon('src/a.test.js')[0] === 'fa-solid fa-flask' && app.fileIcon('README.md')[0] === 'fa-solid fa-book-open', 'vivid theme: suffix + filename icons');
        ok(app.folderIcon('tests', false)[0] === 'fa-solid fa-vial', 'theme folder icons');
        app.dvIconAdd('ext', 'astro', 'fa-rocket', '#ff5d01');
        ok(app.fileIcon('page.astro')[0] === 'fa-solid fa-rocket' && app.fileIcon('page.astro')[1] === '#ff5d01', 'custom extension icon');
        ok(app.dvIconAdd('ext', 'x', 'javascript:alert(1)', '#fff') === null, 'invalid icon class rejected');
        app.dvIconSet('mono');
        ok(app.fileIcon('a.py')[1] === '#94a3b8' && app.fileIcon('page.astro')[0] === 'fa-solid fa-rocket', 'mono theme keeps custom icons');
        app.dvIconRemove('ext', 'astro'); app.dvIconSet('default');
        ok(w.localStorage.getItem('ox_icon_theme_v1') === null && app.folderIcon('src', false)[1] === '#fbbf24', 'default theme clears the map');
    }

    section('#262 Arabic programming (قلم)');
    {
        await app.dvLoad('arabic', 'qalam');
        ok(d.getElementById('dv-ql-js').textContent.includes('function'), 'live transpile preview');
        app.dvQalamLesson(3);
        const r = await app.dvQalamRun();
        ok(r && r.success && /49/.test(d.getElementById('dv-ql-out').textContent), 'run قلم code in the sandbox');
        files.set('conv.js', { content: 'function sq(x) { return x * x; }\nconsole.log(sq(3));\n' });
        const ar = app.dvQalamFromFile('conv.js');
        ok(/دالة/.test(ar) && /ارجع/.test(ar), 'convert JS → قلم');
        const sp = await app.dvQalamSave('lesson.arjs');
        ok(sp === 'lesson.arjs' && files.has('lesson.arjs'), 'save as .arjs');
        await app.dvLoad('arabic', 'reference');
        app.dvQalamRefFilter('function');
        ok([...d.querySelectorAll('#dv-ql-ref tbody tr')].filter(tr => tr.style.display !== 'none').length >= 1, 'reference filter');
    }

    section('#153 Go/PHP/Ruby • #226 mock DB • #228 mock auth • #160 ports • #230 share');
    {
        await app.dvLoad('run', 'polyglot');
        const out = [];
        let r = await app.dvPolyRun({ lang: 'ruby', code: 'puts "مرحبا #{gets}"', stdin: 'سارة', onOut: (s, t) => out.push(t) });
        ok(r.exitCode === 0 && out.join('').includes('مرحبا سارة'), 'Ruby (WASM) with stdin');
        r = await app.dvPolyRun({ lang: 'ruby', code: 'raise "x"' });
        ok(r.exitCode === 1 && /boom/.test(r.error), 'Ruby error → exit 1');
        out.length = 0;
        r = await app.dvPolyRun({ lang: 'php', code: 'echo "hi php";', onOut: (s, t) => out.push(t) });
        if (out.join('') !== 'hi php') console.log('PHP', JSON.stringify(r), JSON.stringify(out));
        ok(r.exitCode === 0 && out.join('') === 'hi php', 'PHP (WASM)');
        out.length = 0;
        r = await app.dvPolyRun({ lang: 'go', code: 'package main', onOut: (s, t) => out.push(t) });
        ok(r.exitCode === 0 && r.remote && out.join('').includes('Hello, Go go-1.23.2'), 'Go via Wandbox (stable compiler picked)');
        r = await app.dvPolyRun({ lang: 'go', code: 'syntax' });
        ok(r.exitCode === 1 && r.error === 'خطأ ترجمة', 'Go compile error');
        files.set('main.rb', { content: 'puts "from file"\n' });
        ok(app.isRunnablePath ? true : true, 'runnable');
        await app.ensureRunner({ quiet: true });
        ok(app.isRunnablePath('main.rb') && app.isRunnablePath('x.go'), 'runner treats .rb/.go as runnable');
        const lines = [];
        const wr = { line: (l, t) => lines.push(t), html: (c, h) => lines.push(h), clear() {}, text: () => lines.join('\n') };
        const rr = await app.runCode({ path: 'main.rb', writer: wr, record: false });
        ok(rr.success && lines.some(l => l === 'from file'), 'runCode dispatches .rb to the polyglot worker');

        await app.dvLoad('run', 'mockdb');
        app.dvMockDBCreate();
        ok(files.has('mocks/db.json'), 'create mocks/db.json sample');
        let res = await app.dvMockRequest({ method: 'GET', path: '/api/users?_sort=id&_order=desc' });
        ok(res && res.status === 200 && JSON.parse(res.body)[0].id === 2, 'GET /api/users with sort');
        res = await app.dvMockRequest({ method: 'POST', path: '/api/users', body: { name: 'Lina' } });
        ok(res && res.status === 201 && JSON.parse(res.body).id === 3, 'POST creates with next id');
        res = await app.dvMockRequest({ method: 'GET', path: '/api/nothing/1' });
        if (!res || res.status !== 404) console.log('404', JSON.stringify(res), d.getElementById('dv-db-res').textContent);
        ok(res && res.status === 404, '404 for unknown collection');

        await app.dvLoad('run', 'mockauth');
        app.dvMockAuthCreate();
        res = await app.dvMockLogin('admin@example.com', 'admin123');
        if (!res || !res.me) console.log('LOGIN', JSON.stringify(res), d.getElementById('dv-au-res').textContent);
        ok(res && res.status === 200 && res.body.token && res.me && res.me.email === 'admin@example.com', 'login → JWT → /auth/me');
        ok(lib.decodeJwt(res.body.token).payload.role === 'admin', 'JWT payload decodes');
        res = await app.dvMockLogin('admin@example.com', 'wrong');
        ok(res && res.status === 401, 'wrong password → 401');

        await app.dvLoad('run', 'ports');
        files.set('server.js', { content: "const express = require('express');\nconst app = express();\napp.get('/hi', (req, res) => res.json({ hello: req.query.name || 'world' }));\napp.listen(3000, () => console.log('up'));\n" });
        const port = await app.dvStartServer('server.js');
        ok(port === 3000 && app.dvServers().has(3000), 'server listens on a virtual port');
        const resp = await app.dvRequest(3000, { method: 'GET', path: '/hi?name=OX' });
        ok(resp.status === 200 && JSON.parse(resp.body).hello === 'OX', 'request routed to the virtual server');
        app.dvStopServer(3000);
        await wait(30);
        ok(!app.dvServers().has(3000), 'server stopped');

        await app.dvLoad('run', 'share');
        const url = await app.dvShareRun({ path: 'main.rb', lang: 'ruby', output: 'from file', success: true, durationMs: 12 });
        ok(/#oxrun=[zu]/.test(url), 'share link with compressed payload');
        const shown = [];
        const _sd = app.showDialog; app.showDialog = async (o) => { shown.push(o); return null; };
        await app.dvOpenShareHash(url.slice(url.indexOf('#')));
        app.showDialog = _sd;
        ok(shown.length === 1 && /from file/.test(shown[0].body), 'opening the link shows the shared result');
    }

    section('#155 terminal (shell) • #156 npm/yarn/pnpm');
    {
        let r = await app.dvShellExec('mkdir -p tmp && echo "hello" > tmp/a.txt && cat tmp/a.txt');
        ok(r.code === 0 && r.out.includes('hello') && files.get('tmp/a.txt').content.trim() === 'hello', 'mkdir + redirect + cat');
        r = await app.dvShellExec('ls src/utils | grep math');
        ok(r.code === 0 && /math\.js/.test(r.out), 'pipes');
        r = await app.dvShellExec('cd src && pwd');
        ok(r.out.trim() === '/src', 'cd/pwd');
        await app.dvShellExec('cd /');
        r = await app.dvShellExec('nosuchcmd');
        ok(r.code !== 0, 'unknown command → non-zero exit');
        r = await app.dvShellExec('node src/utils/text.js && echo done');
        ok(r.code === 0 && /done/.test(r.out), 'node runs a file in the sandbox');
        r = await app.dvShellExec('npm install left-pad');
        const pkg = JSON.parse(files.get('package.json').content);
        ok(r.code === 0 && pkg.dependencies['left-pad'] === '^1.3.0', 'npm install resolves latest from the registry');
        r = await app.dvShellExec('yarn add -E lodash@4.17.20');
        ok(JSON.parse(files.get('package.json').content).dependencies.lodash === '4.17.20', 'yarn add with exact version');
        r = await app.dvShellExec('pnpm remove lodash');
        ok(!JSON.parse(files.get('package.json').content).dependencies.lodash, 'pnpm remove');
        r = await app.dvShellExec('npm install not-a-real-pkg-xyz');
        ok(r.code !== 0, 'unknown package fails');
        r = await app.dvShellExec('npm run test');
        ok(/ok/.test(r.out), 'npm run script');
        ok(lib.satisfies('1.3.0', '^1.0.0') && !lib.satisfies('2.0.0', '^1.0.0') && lib.maxSatisfying(['1.0.0', '1.3.0', '2.0.0'], '~1.0.0') === '1.0.0', 'semver helpers');
        await app.dvLoad('term', 'npm');
        const nr = await app.dvNpmRun('ls');
        ok(nr && /left-pad/.test(nr.text), 'npm UI runs commands');
    }

    section('#238 dupes • #240 merge • #242 stylelint • #142/#143 typecheck');
    {
        const block = 'export function total(items) {\n    let sum = 0, count = 0;\n    for (const it of items) {\n        if (!it || it.qty <= 0) continue;\n        const line = it.price * it.qty;\n        sum += line - (it.discount || 0);\n        count += it.qty;\n    }\n    const tax = sum * 0.19;\n    return { sum: Math.round((sum + tax) * 100) / 100, count };\n}\n';
        setFiles({
            'package.json': JSON.stringify({ name: 'demo', scripts: { test: 'echo ok' } }, null, 2),
            'src/cart.js': block + 'export const a = 1;\n',
            'src/order.js': '// order\n' + block.replace('total', 'orderTotal'),
            'src/main.js': "import { tiny } from './lib/tiny.js';\nconsole.log(tiny());\n",
            'src/lib/tiny.js': 'export function tiny() { return 1; }\n',
            'src/styles.css': 'a { color: #FFF; color: red }\n.x {}\n',
            'src/types.ts': 'const n: number = "x";\nexport default n;\n'
        });
        await app.dvLoad('quality', 'dupes');
        ok(app._dvDupes && app._dvDupes.blocks.length >= 1 && app._dvDupes.blocks[0].lines >= 6, '#238 duplicate block found across files');
        await app.dvLoad('quality', 'merge');
        const si = (app._dvMergeSug || []).findIndex(x => x.target === 'src/main.js' && x.files.includes('src/lib/tiny.js'));
        ok(si >= 0, '#240 small single-import file suggested for inlining');
        if (si >= 0) {
            await app.dvMergeApply(si, { yes: true });
            ok(!files.has('src/lib/tiny.js') && /function tiny/.test(files.get('src/main.js').content) && !/from '\.\/lib\/tiny\.js'/.test(files.get('src/main.js').content), 'merge inlines and removes the import');
        }
        const scan = app.dvStylelintScan();
        const iss = (scan.find(x => x.path === 'src/styles.css') || { issues: [] }).issues;
        ok(iss.length >= 2, '#242 stylelint issues found: ' + iss.map(i => i.rule).join(','));
        await app.dvLoad('quality', 'stylelint');
        app.dvStylelintFix();
        ok(app.dvStylelintScan().find(x => x.path === 'src/styles.css').issues.filter(i => i.fix).length === 0, 'stylelint auto-fix applied');
        const { createTools } = require('../workers/tools.js');
        const tools = createTools({ load: (n) => n === 'typescript' ? require('typescript') : fs.readFileSync(path.join(ROOT, 'node_modules/typescript/lib', n.slice(4)), 'utf8') });
        app.toolsRequest = async (type, payload) => tools.typecheck(payload);
        await app.dvLoad('quality', 'typecheck');
        const tc = await app.dvTypecheckProject();
        const d = tc && tc.files[0] && tc.files[0].diagnostics;
        ok(d && d.some(x => x.code === 2322 && x.line === 1), '#142 real TypeScript diagnostics (TS2322)');
        ok(/2322/.test(document.getElementById('dv-tc-res').textContent), 'typecheck report rendered');
    }

    section('#164 coverage • #165 E2E • #166 snapshots • #167 mutation • #168 bench');
    {
        setFiles({
            'package.json': JSON.stringify({ name: 'demo' }, null, 2),
            'index.html': '<!doctype html><html><head><title>Demo</title></head><body><h1>مرحبا</h1><button id="b" onclick="document.getElementById(\'o\').textContent=\'clicked\'">اضغط</button><p id="o"></p></body></html>',
            'src/math.js': 'function clamp(x, lo, hi) {\n    if (x < lo) return lo;\n    if (x > hi) return hi;\n    return x;\n}\nfunction unused() { return 42; }\nmodule.exports = { clamp, unused };\n',
            'src/math.test.js': "const { clamp } = require('./math.js');\ntest('clamp low', () => { expect(clamp(-1, 0, 10)).toBe(0); });\ntest('clamp mid', () => { expect(clamp(5, 0, 10)).toBe(5); });\n"
        });
        await app.dvLoad('test', 'coverage');
        const cov = await app.dvCoverageRun();
        const fm = cov && cov.files['src/math.js'];
                ok(cov && cov.summary && cov.summary.pass === 2, '#164 tests pass under instrumentation');
        ok(fm && cov.totals && cov.totals.functions === 50 && cov.totals.branches === 75 && cov.totals.lines > 0, 'coverage totals: functions/branches partially covered');
        ok(['if (a) if (b) x(); else y();', 'if (a) if (b) x();', 'for (;;) if (a) break;', 'if (a) x(); else if (b) y();'].every(c => { try { new Function(lib.instrumentCoverage(c, 'f').code); return true; } catch (e) { return false; } }), 'instrumented if/else nesting stays valid');
        const lcov = app.dvCoverageExport(true);
        ok(/SF:src\/math\.js/.test(lcov) && /end_of_record/.test(lcov) && files.has('coverage/lcov.info'), 'LCOV export');

        app.dvCreateSample('e2e/home.e2e.js', "import { test, expect } from '@playwright/test';\ntest('home', async ({ page }) => {\n  await page.goto('/');\n  await expect(page).toHaveTitle('Demo');\n  await page.getByRole('button', { name: 'اضغط' }).click();\n  await expect(page.locator('#o')).toHaveText('clicked');\n});\ntest('fails', async ({ page }) => {\n  await page.goto('/');\n  await expect(page.locator('h1')).toHaveText('nope', { timeout: 300 });\n});\n");
        const { JSDOM } = require('jsdom');
        app.dvE2EDriver = app.dvE2EDomDriver(async (html) => { const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true }); return { document: dom.window.document, window: dom.window }; });
        await app.dvLoad('test', 'e2e');
        const e2 = await app.dvE2ERun();
        if (!e2 || !e2.summary || e2.summary.pass !== 1) console.log('E2E', e2 && JSON.stringify({ e: e2.error, s: e2.summary, r: e2.results, log: e2.log.slice(-6) }).slice(0, 1500));
        ok(e2 && e2.summary && e2.summary.pass === 1 && e2.summary.fail === 1, '#165 Playwright-style E2E: 1 pass, 1 fail');
        ok(e2 && e2.fails.length === 1 && /h1|nope/.test(JSON.stringify(e2.fails[0]) + JSON.stringify(e2.results)), 'failure captured with page snapshot');
        app.dvE2EDriver = null;
        files.delete('e2e/home.e2e.js');

        files.set('src/snap.test.js', { content: "test('obj', () => { expect({ a: 1, b: [1, 2] }).toMatchSnapshot(); });\n", lang: 'js', timestamp: Date.now() });
        await app.dvLoad('test', 'snapshot');
        await app.dvSnapRun();
        const snapFile = [...files.keys()].find(k => /__snapshots__\/.*snap\.test\.js\.snap$/.test(k));
        ok(snapFile && app._snapStats.new === 1, '#166 first run writes the snapshot');
        await app.dvSnapRun();
        ok(app._snapStats.match === 1 && app._snapStats.fail === 0, 'second run matches');
        files.set('src/snap.test.js', { content: "test('obj', () => { expect({ a: 2, b: [1, 2] }).toMatchSnapshot(); });\n", lang: 'js', timestamp: Date.now() });
        await app.dvSnapRun();
        ok(app._snapStats.fail === 1, 'changed value fails the snapshot');
        await app.dvSnapRun(true);
        ok(app._snapStats.updated === 1 && /"a": 2|a: 2/.test(files.get(snapFile).content), '-u updates the snapshot');
        files.delete('src/snap.test.js'); files.delete(snapFile);

        await app.dvLoad('test', 'mutation');
        const mut = await app.dvMutationRun('src/math.js', 10);
        const killed = mut ? mut.results.filter(x => x.status === 'killed').length : 0, survived = mut ? mut.results.filter(x => x.status === 'survived').length : 0;
        ok(mut && mut.done && mut.total > 0 && killed > 0, '#167 mutants generated and some killed');
        ok(survived > 0, 'surviving mutants reported (untested branch/function)');

        files.set('src/perf.bench.js', { content: "const arr = Array.from({ length: 100 }, (_, i) => i);\nbench('sum', () => { let s = 0; for (const x of arr) s += x; }, { time: 50 });\nbench('reduce', () => arr.reduce((a, b) => a + b, 0), { time: 50 });\n", lang: 'js', timestamp: Date.now() });
        await app.dvLoad('test', 'perf');
        const b1 = await app.dvBenchRun();
                ok(b1 && b1.rows && b1.rows.length === 2 && b1.rows.every(r => r.mean > 0 && r.hz > 0), '#168 benchmarks measured');
        const b2 = await app.dvBenchRun();
        ok(b2 && b2.rows.every(r => typeof r.delta === 'number'), 'second run compares against the previous');
    }

    section('#171-175 debugger • #177 replay');
    {
        setFiles({
            'package.json': JSON.stringify({ name: 'demo' }, null, 2),
            'src/calc.js': 'function sq(n) {\n    const r = n * n;\n    return r;\n}\nlet total = 0;\nfor (let i = 1; i <= 3; i++) {\n    total += sq(i);\n}\nconsole.log(total);\n',
            'src/bad.js': 'const list = [1, 2];\nfunction pick(i) {\n    return list[i].toFixed(1);\n}\nconsole.log(pick(0));\nconsole.log(pick(5));\n'
        });
        await app.dvLoad('debug', 'debugger');
        const r = await app.dvDebugRun('src/calc.js');
        if (!r || !r.trace || !r.trace.length) console.log('DBG', JSON.stringify(r).slice(0, 800));
        ok(r && r.trace.length > 5 && r.success, '#171 execution recorded step by step');
        const last = r.trace[r.trace.length - 1];
        ok(r.trace.some(t => t.file === 'src/calc.js' && t.line === 2), 'steps carry file/line');
        const inSq = r.trace.find(t => t.line === 3);
        ok(inSq && JSON.stringify(inSq).includes('sq'), '#173 call stack recorded');
        const s0 = app.dvStep('start'), s1 = app.dvStep('into');
        ok(s0 === 0 && s1 > 0, '#172 step into');
        app.dvStep('start');
        const ov = app.dvStep('over');
        ok(r.trace[ov] && r.trace[ov].line !== 2, 'step over skips the function body');
        app.dvToggleBp && app.dvToggleBp('src/calc.js', 7);
        if (app.dvBps().size) { app.dvStep('start'); const c = app.dvStep('continue'); ok(r.trace[c].line === 7, '#174 breakpoint continue'); app.dvToggleBp('src/calc.js', 7); }
        else ok(false, '#174 breakpoint toggled');
        app.dvStep('end');
        const v = await app.dvEvaluate('total * 2');
        ok(String(v) === '28', '#175 evaluate at the current step: ' + v);
        await app.dvAddWatch('total');
        ok(app._dvDbg && app._dvDbg.watches.includes('total') && app._dvDbg.trace.some(t => t.watch && String(t.watch[0]) === '14'), 'watch expression tracked');
        app._dvWatches = [];
        app._lastRunError = { path: 'src/bad.js', error: "TypeError: Cannot read properties of undefined (reading 'toFixed') (src/bad.js:3)" };
        const rp = await app.dvReplayError();
        ok(rp && rp.replay && !rp.success, '#177 replay of the failing run');
        const at = rp && rp.trace[app._dvDbgCur];
        ok(at && at.line === 3, 'replay jumps to the failing line');
    }

    section('Done');
    if (errors.length) console.log(errors.join('\n'));
    ok(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
    process.exitCode = process.exitCode || 0;
    setTimeout(() => process.exit(process.exitCode), 50);
})().catch((e) => { console.error('❌ FATAL', e); process.exitCode = 1; setTimeout(() => process.exit(1), 50); });
