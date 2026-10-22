/* Sprint 6 tests: Editor & Code — CodeMirror 6 chunk (lazy), settings, code intelligence (definition,
   references, rename, imports on move), transforms, Prettier + ESLint (tools worker), runner (JS sandbox,
   modules, TS, stdin, env, mocks, tests, timeouts, history), Python (Pyodide worker: run, stdin, tests),
   chat code blocks, preview, split editor, macros and editor AI. Chunks are the real build output
   (assets/studio/*.mjs) imported into Node with the jsdom window as globals. */
require('fake-indexeddb/auto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const { loadApp, mockOpenRouter, ok, wait, waitFor, section } = require('./helpers');

const ROOT = path.join(__dirname, '..');
let aiReply = 'تم';
const or = mockOpenRouter(async () => ({ text: aiReply, usage: { prompt_tokens: 10, completion_tokens: 10, cost: 0.0001 } }));
async function router(url, opts = {}) {
    url = String(url);
    if (url.includes('openrouter.ai/api/v1/chat')) return or.fetchImpl(url, opts);
    if (url.includes('openrouter.ai/api/v1/models')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
    return Promise.reject(new Error('offline: ' + url));
}

/** Expose the jsdom window as Node globals so the ESM chunks (Node realm) can use the DOM. */
function exposeGlobals(w) {
    const names = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Text', 'Range', 'MutationObserver', 'getComputedStyle', 'getSelection',
        'requestAnimationFrame', 'cancelAnimationFrame', 'KeyboardEvent', 'MouseEvent', 'FocusEvent', 'InputEvent', 'Event', 'CustomEvent', 'DOMParser', 'localStorage',
        'HTMLTextAreaElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLIFrameElement', 'DocumentFragment', 'ShadowRoot', 'Window', 'Document', 'HTMLDocument', 'ClipboardEvent', 'CompositionEvent', 'UIEvent', 'PointerEvent', 'TouchEvent', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'location'];
    for (const n of names) Object.defineProperty(globalThis, n, { value: w[n], configurable: true, writable: true });
    const rect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 });
    w.Range.prototype.getClientRects = function () { return []; };
    w.Range.prototype.getBoundingClientRect = rect;
    if (!w.document.elementFromPoint) w.document.elementFromPoint = () => null;
}

/** In-process stand-in for workers/tools.js (same code, Node modules instead of the CDN). */
function fakeToolsWorker() {
    const { createTools } = require('../workers/tools.js');
    const tools = createTools({ load: (n) => n === 'prettier' ? require('prettier/standalone') : n === 'eslint' ? require('eslint-linter-browserify') : require('prettier/plugins/' + n.slice(7)) });
    const wk = { onmessage: null, onerror: null, posted: 0, terminate() { this.dead = true; } };
    wk.postMessage = (msg) => { wk.posted++; tools.handle(msg).then(res => { if (!wk.dead && wk.onmessage) wk.onmessage({ data: Object.assign({ id: msg.id }, res) }); }); };
    return wk;
}

/** Stand-in for the sandboxed iframe + blob Worker: runs the bundle in a fresh Node vm context. */
let sandboxes = 0;
function vmSandbox() {
    const timers = new Set();
    sandboxes++;
    return {
        start(script, cb) {
            const st = (fn, ms, ...a) => { const t = setTimeout(() => { timers.delete(t); fn(...a); }, ms); timers.add(t); return t; };
            const si = (fn, ms, ...a) => { const t = setInterval(fn, ms, ...a); timers.add(t); return t; };
            const ct = (t) => { clearTimeout(t); clearInterval(t); timers.delete(t); };
            const ctx = vm.createContext({ __oxPost: (m) => cb(JSON.parse(JSON.stringify(m))), setTimeout: st, setInterval: si, clearTimeout: ct, clearInterval: ct, queueMicrotask, TextEncoder, TextDecoder, URL, structuredClone });
            try { vm.runInContext(script, ctx, { timeout: 3000, filename: 'ox-run.js' }); } catch (e) { cb({ type: 'fatal', message: e.message }); }
        },
        stop() { timers.forEach(t => { clearTimeout(t); clearInterval(t); }); timers.clear(); }
    };
}
/** Stand-in for workers/python.js: the same runtime, driven by the npm pyodide package (offline). */
let pyodideP = null, pyWorkers = 0;
function fakePythonWorker() {
    const { createRuntime } = require('../workers/python.js');
    pyWorkers++;
    const wk = { onmessage: null, onerror: null, terminate() { this.dead = true; } };
    const rt = createRuntime(() => (pyodideP = pyodideP || require('pyodide').loadPyodide()), (m) => setTimeout(() => { if (!wk.dead && wk.onmessage) wk.onmessage({ data: m }); }, 0));
    wk.postMessage = (msg) => { rt.handle(msg); };
    return wk;
}

let W = null, teardown = () => {};
(async () => {
    const { w, d, app, errors } = loadApp({ indexedDB: globalThis.indexedDB, fetchImpl: router });
    W = w;
    exposeGlobals(w);
    const $ = (id) => d.getElementById(id);
    app.settings.apiKey = 'sk-test';
    let imported = [];
    app.importModule = (url) => { imported.push(url); return import(pathToFileURL(path.join(ROOT, url)).href); };
    app.createRunSandbox = vmSandbox;
    app.createPythonWorker = fakePythonWorker;
    teardown = () => {
        try { app.scheduleEditorChrome = () => {}; app.updateEditorChrome = () => {}; clearTimeout(app._chromeTimer); } catch (e) { /* ignore */ }
        try { if (app._splitEditor) app._splitEditor.ctl.destroy(); if (app.codeEditor) app.codeEditor.destroy(); } catch (e) { /* ignore */ }
        try { app.killPythonWorker && app.killPythonWorker(); app.terminateToolsWorker(); } catch (e) { /* ignore */ }
    };
    let toolsWorkers = 0;
    app.createToolsWorker = () => { toolsWorkers++; return fakeToolsWorker(); };
    const setFiles = (obj) => {
        app.virtualProjectFiles.clear();
        Object.entries(obj).forEach(([p, c]) => app.virtualProjectFiles.set(p, { content: c, lang: p.split('.').pop(), timestamp: Date.now() }));
    };

    // ------------------------------------------------------------------
    section('Build + lazy loading (#131)');
    const build = w.OX_BUILD;
    ok(build && build.chunks && /^assets\/studio\/studio-\w+\.mjs$/.test(build.chunks.studio) && /^assets\/studio\/runner-\w+\.mjs$/.test(build.chunks.runner), 'OX_BUILD.chunks lists the hashed studio + runner chunks');
    ok([build.chunks.studio, build.chunks.runner, ...build.chunks.shared].every(f => fs.existsSync(path.join(ROOT, f))), 'every chunk referenced by the build exists on disk');
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/studio/manifest.json'), 'utf8'));
    ok(manifest.chunks.studio === build.chunks.studio && manifest.files.length > 5, 'assets/studio/manifest.json matches the build');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    ok(!html.includes('@codemirror') && !/EditorView\.theme/.test(html) && !html.includes('sucrase'), 'CodeMirror and sucrase are NOT in index.html (lazy)');
    ok(/worker-src 'self' blob:/.test(html), 'page CSP allows same-origin workers (tools + python)');
    ok(app.openEditorSettings.__oxLazy === 'studio' && app.runTests.__oxLazy === 'runner' && !app.formatStudioCode.__oxLazy, 'lazy stubs for chunk entry points (never for wrapped methods)');
    ok(imported.length === 0, 'nothing imported before the studio is used');
    const cmds = app.buildPaletteCommands().map(x => x.label);
    ok(['تشغيل الملف الحالي', 'تشغيل كل الاختبارات', 'إعدادات المحرر', 'معاينة حية (HTML/Markdown/SVG)', 'سجل التشغيل'].every(l => cmds.includes(l)), 'palette: editor & run commands');
    ok(app.preloadStudioChunks() >= 2 && d.querySelectorAll('link[rel="modulepreload"]').length >= 2, 'modulepreload links for the editor chunk + its shared deps');

    // ------------------------------------------------------------------
    section('Editor mount + textarea adapter');
    setFiles({ 'src/util.js': 'export function add(a, b) {\n  return a + b;\n}\nexport const PI = 3.14;\n', 'src/main.js': "import { add } from './util.js';\nconsole.log(add(2, 3));\n" });
    app.activeStudioFile = 'src/main.js';
    app.toggleCodeStudio(true);
    await app.ensureStudio();
    await wait(30);
    const ta = $('studio-editor-textarea');
    ok(imported.some(u => u === build.chunks.studio), 'opening the studio imports the editor chunk');
    ok(app.codeEditor && d.querySelector('#studio-cm-host .cm-editor') && d.querySelector('.studio-editor-wrapper.cm-active'), 'CodeMirror mounted in the studio');
    ok(ta.value === app.virtualProjectFiles.get('src/main.js').content, 'textarea adapter: value reads from CodeMirror');
    app.codeEditor.replaceRange(0, 0, '// hi\n');
    await wait(20);
    ok(app.virtualProjectFiles.get('src/main.js').content.startsWith('// hi\n'), 'edits in CodeMirror flow into the project file');
    ta.value = "import { add } from './util.js';\nconsole.log(add(2, 3));\n";
    ok(app.codeEditor.getValue().startsWith('import'), 'textarea adapter: value setter updates CodeMirror');
    ta.setSelectionRange(9, 12);
    ok(ta.selectionStart === 9 && ta.selectionEnd === 12 && app.codeEditor.getSelection().from === 9, 'textarea adapter: selection');
    app.switchStudioFile('src/util.js');
    await wait(10);
    ok(app.codeEditor.getPath() === 'src/util.js' && app.codeEditor.getValue().includes('function add'), 'switching files swaps the editor document');
    ok($('editor-statusbar').classList.contains('cm-status') && /سطر \d+/.test($('editor-statusbar').textContent) && /JavaScript/i.test($('editor-statusbar').textContent), 'status bar: position, size, lines/words, language (#231-#233)');
    ok(d.querySelector('.editor-toolbar.cm-toolbar [data-tb="run"]'), 'customisable toolbar rendered (#257)');
    ok(app.__oxStudio.languageCount() >= 100 && app.__oxStudio.findLanguage('x.rs') && app.__oxStudio.findLanguage('a.py'), `${app.__oxStudio.languageCount()} languages detected by extension (#132)`);

    // ------------------------------------------------------------------
    section('Settings (#196-#199, #206, #207, #210)');
    app.setEditorSettings({ fontSize: 17, theme: 'dracula' });
    const stored = JSON.parse(w.localStorage.getItem('ox_alpha_editor_v2'));
    ok(stored.fontSize === 17 && stored.theme === 'dracula', 'settings persisted (ox_alpha_editor_v2)');
    const exported = app.exportEditorSettings();
    app.resetEditorSettings();
    ok(app.getEditorSettings().fontSize !== 17, 'reset to defaults');
    ok(app.importEditorSettings(exported) > 0 && app.getEditorSettings().theme === 'dracula', 'export → import round-trip');
    const vs = app.importVSCodeSettings('{ // comment\n "editor.fontSize": 15, "editor.tabSize": 4, "editor.wordWrap": "on", "workbench.colorTheme": "x", }');
    ok(vs.applied.length === 3 && vs.ignored.includes('workbench.colorTheme') && app.getEditorSettings().tabSize === 4 && app.getEditorSettings().wrap === true, 'VS Code settings.json import (JSONC) (#207)');
    ok(app.importVSCodeKeybindings('[{ "key": "ctrl+shift+k", "command": "editor.action.deleteLines" }]') === 1, 'VS Code keybindings import (#207, #251)');
    app.openEditorSettings('keys');
    ok(d.querySelectorAll('.ed-key-row').length > 10, 'keybindings editor lists commands (#251)');
    app.closeModals();
    app.resetEditorSettings();

    // ------------------------------------------------------------------
    section('Code intelligence (#147-#150, #243-#245)');
    app.switchStudioFile('src/main.js');
    await wait(10);
    const mainText = app.codeEditor.getValue();
    app.codeEditor.setSelection(mainText.indexOf('add(2'), mainText.indexOf('add(2'));
    await app.gotoDefinition();
    ok(app.activeStudioFile === 'src/util.js' && app.codeEditor.lineAt(app.codeEditor.getSelection().head).number === 1, 'go to definition across files (F12)');
    app.switchStudioFile('src/main.js');
    app.codeEditor.setSelection(mainText.indexOf('add(2'), mainText.indexOf('add(2'));
    await app.findReferences();
    ok(d.querySelectorAll('#ox-panel-body .ref-row').length >= 3 && $('ox-panel-body').textContent.includes('src/util.js'), 'find all references (Shift+F12)');
    app.closeModals();
    app.switchStudioFile('src/main.js');
    app.codeEditor.setSelection(mainText.indexOf('add(2'), mainText.indexOf('add(2'));
    app.askText = async () => 'sum';
    app.askConfirm = async () => true;
    await app.renameSymbol();
    delete app.askText; delete app.askConfirm;
    ok(app.virtualProjectFiles.get('src/util.js').content.includes('function sum(') && app.virtualProjectFiles.get('src/main.js').content.includes('import { sum }') && app.virtualProjectFiles.get('src/main.js').content.includes('sum(2, 3)'), 'rename symbol across files (F2)');
    await app.renameProjectFile('src/util.js', 'lib/util.js');
    await wait(30);
    ok(app.virtualProjectFiles.get('src/main.js').content.includes("from '../lib/util.js'"), 'moving a file updates imports in other files (#244)');
    const hover = app.editorHover({ path: 'src/main.js', word: 'sum', text: app.virtualProjectFiles.get('src/main.js').content, pos: 10, line: 1 });
    ok(hover && /sum\(a, b\)/.test(hover.html || ''), 'hover shows the signature from another file');
    setFiles({ 'a.js': "const unused = 1;\nimport fs from 'fs';\nfunction f( {\n" });
    app.switchStudioFile('a.js');
    const diags = await app.lintForEditor(app.codeEditor.getValue(), 'a.js');
    ok(diags.some(x => x.severity === 'error'), 'syntax errors reported as diagnostics (#141, #268)');

    // ------------------------------------------------------------------
    section('Transforms (#145, #183-#185) + Prettier/ESLint (#140, #141)');
    setFiles({ 't.js': 'zeta\nalpha  \nmid\n' });
    app.switchStudioFile('t.js');
    app.codeEditor.setSelection(0, app.codeEditor.getValue().length);
    app.sortSelectedLines('asc');
    ok(app.codeEditor.getValue().startsWith('alpha'), 'sort selected lines');
    app.trimTrailingWhitespace();
    ok(!/ +\n/.test(app.codeEditor.getValue()), 'trim trailing whitespace');
    app.codeEditor.setValue('hello world');
    app.codeEditor.setSelection(0, 11);
    app.changeCaseSelection('camel');
    ok(app.codeEditor.getValue() === 'helloWorld', 'change case (camelCase)');
    app.codeEditor.setValue("const fs = require('fs');\nmodule.exports = { a };\n");
    app.convertCjsToEsm();
    ok(/import fs from 'fs'/.test(app.codeEditor.getValue()) && /export/.test(app.codeEditor.getValue()), 'CommonJS → ESM');
    setFiles({ 'f.js': 'const a = {b:1,c:[1,2]}\nfunction f( x ){return x*2}' });
    app.switchStudioFile('f.js');
    await app.formatStudioCode();
    ok(app.virtualProjectFiles.get('f.js').content === 'const a = { b: 1, c: [1, 2] };\nfunction f(x) {\n  return x * 2;\n}\n', 'format with Prettier in the tools worker (#140)');
    ok(toolsWorkers === 1, 'one tools worker, created on demand');
    app.codeEditor.setValue('if (!!x) { foo(); }\n');
    const lint = await app.lintForEditor(app.codeEditor.getValue(), 'f.js');
    ok(lint.some(x => /no-undef|not defined/.test(x.message)), 'ESLint diagnostics from the tools worker (#141)');
    await app.eslintFixFile();
    ok(app.codeEditor.getValue().startsWith('if (x)'), 'ESLint auto-fix');
    const codeEl = d.createElement('code');
    codeEl.textContent = 'let x={a:1}';
    ok(await app.formatCodeBlock(codeEl, 'javascript') && codeEl.textContent === 'let x = { a: 1 };', 'chat code blocks: real Prettier formatting');

    // ------------------------------------------------------------------
    section('Macros (#252-#254) + keymaps loaded on demand (#138)');
    setFiles({ 'm.txt': '' });
    app.switchStudioFile('m.txt');
    app.codeEditor.setSelection(0, 0);
    await app.toggleMacroRecording();
    ok(app.codeEditor.isRecording() && /REC/.test($('editor-statusbar').textContent + (app.updateEditorChrome(), $('editor-statusbar').textContent)), 'recording indicator in the status bar');
    app.codeEditor.typeText('item');
    app.codeEditor.typeText(';');
    app.codeEditor.pressKey({ k: 'Enter' });
    app.askText = async () => 'semi';
    const macro = await app.toggleMacroRecording();
    delete app.askText;
    ok(macro && macro.steps.length >= 2 && macro.steps.some(x => x.k === 'Enter') && app.getMacros()[0].name === 'semi' && app.codeEditor.getValue() === 'item;\n', 'record a macro (keys + typing) and save it');
    app.playMacro(macro.id, 2);
    ok(app.codeEditor.getValue() === 'item;\nitem;\nitem;\n', 'replay the macro N times');
    const before = imported.length;
    app.setEditorSettings({ keymap: 'vim' });
    await waitFor(() => app.codeEditor.view.scrollDOM.classList.contains('cm-vimMode'));
    ok(app.codeEditor.view.scrollDOM.classList.contains('cm-vimMode') && imported.length === before, 'vim keymap: its chunk loads on demand (not part of the editor chunk) and activates');
    app.setEditorSettings({ keymap: 'default' });
    await wait(20);
    ok(!app.codeEditor.view.scrollDOM.classList.contains('cm-vimMode'), 'back to the default keymap');

    // ------------------------------------------------------------------
    section('JS runner: isolated sandbox, modules, TS (#151, #157, #158, #221-#227)');
    const term = () => $('studio-terminal').textContent;
    setFiles({ 'src/a.js': "const { double } = require('./lib');\nconsole.log('x', double(21), { ok: true });\n", 'src/lib.js': 'module.exports.double = (n) => n * 2;\n' });
    app.switchStudioFile('src/a.js');
    let res = await app.runStudioCode();
    ok(imported.includes(build.chunks.runner), 'run button loads the runner chunk on demand');
    ok(res && res.success && /x 42/.test(term()) && /ok: true|"ok": ?true/.test(term()), 'CommonJS require between project files + object logging');
    ok($('studio-console-bar') && d.querySelector('#studio-console-bar [data-run="stop"]').disabled, 'console bar with run/stop (stop disabled when idle)');
    setFiles({ 'src/m.ts': "import { add } from './calc';\nconst n: number = add(1, 2);\nconsole.log(`n=${n}`);\n", 'src/calc.ts': 'export function add(a: number, b: number): number { return a + b; }\n' });
    app.switchStudioFile('src/m.ts');
    res = await app.runStudioCode();
    ok(res.success && /n=3/.test(term()), 'TypeScript + ES modules transpiled and run (#151)');
    setFiles({ 'src/err.js': "// line 1\n\nfunction f() { throw new Error('boom'); }\nf();\n" });
    app.switchStudioFile('src/err.js');
    res = await app.runStudioCode();
    ok(!res.success && /boom/.test(res.error) && /src\/err\.js:3/.test(res.error), 'runtime errors mapped to the original file:line (#157)');
    ok(d.querySelector('#studio-terminal .term-link[data-path="src/err.js"]') && d.querySelector('#studio-terminal .term-fix-btn'), 'clickable stack links + "fix with AI" button (#176, #178)');
    setFiles({ 'src/bad.js': 'const x = ;\n' });
    app.switchStudioFile('src/bad.js');
    res = await app.runStudioCode();
    ok(!res.success && /SyntaxError/.test(res.error) && /src\/bad\.js:1/.test(res.error), 'syntax errors reported with location before running');
    setFiles({ 'src/io.js': "const name = prompt('name?');\nconst age = prompt('age?');\nconsole.log(`hi ${name} (${age})`, process.env.API_URL);\n", '.env': 'API_URL=https://api.test\n# comment\n' });
    app.switchStudioFile('src/io.js');
    app._runStdin = 'Nader\n30';
    res = await app.runStudioCode();
    ok(res.success && /hi Nader \(30\) https:\/\/api\.test/.test(term()), 'stdin lines feed prompt() + .env feeds process.env (#224, #225)');
    app._runStdin = '';
    setFiles({ 'src/api.js': "const r = await fetch('/users');\nconst users = await r.json();\nconsole.log('users:', users.length, users[0].name);\n", 'mocks/users.json': '[{"name":"Ali"},{"name":"Sara"}]' });
    app.switchStudioFile('src/api.js');
    res = await app.runStudioCode();
    ok(res.success && /users: 2 Ali/.test(term()), 'top-level await + fetch() answered from mocks/ (#227)');
    const sbBefore = sandboxes;
    res = await app.runCode({ lang: 'js', code: 'setInterval(() => {}, 5); console.log("start");', files: new Map(), terminal: $('studio-terminal'), timeoutMs: 300, record: false });
    ok(res.error === 'Timeout' && /تجاوز المهلة/.test(term()) && sandboxes === sbBefore + 1, 'never-ending programs are stopped by the timeout (#158)');
    const pending = app.runCode({ lang: 'js', code: 'setInterval(() => {}, 5);', files: new Map(), terminal: $('studio-terminal'), timeoutMs: 10000, record: false });
    await wait(50);
    ok(!d.querySelector('#studio-console-bar [data-run="stop"]').disabled, 'stop button enabled while running');
    app.stopRun();
    res = await pending;
    ok(res.error === 'Stopped' && /تم إيقاف التنفيذ/.test(term()), 'stop button ends the run');
    setFiles({ 'src/sel.js': 'const a = 1;\nconsole.log(6 * 7);\n' });
    app.switchStudioFile('src/sel.js');
    const st = app.codeEditor.getValue().indexOf('console');
    app.codeEditor.setSelection(st, st);
    res = await app.runStudioSelection();
    ok(res.success && /42/.test(term()), 'run the current line / selection (#221)');

    // ------------------------------------------------------------------
    section('JS tests (#163)');
    setFiles({
        'src/math.js': 'export const add = (a, b) => a + b;\nexport const div = (a, b) => { if (!b) throw new Error("div by zero"); return a / b; };\n',
        'src/math.test.js': "import { add, div } from './math.js';\ndescribe('math', () => {\n  it('adds', () => { expect(add(1, 2)).toBe(3); });\n  it('deep equal', () => { expect({ a: [1, 2] }).toEqual({ a: [1, 2] }); });\n  it('throws', () => { expect(() => div(1, 0)).toThrow('div by zero'); });\n  it('async', async () => { const v = await Promise.resolve(5); expect(v).toBeGreaterThan(4); });\n  it('fails', () => { expect(add(2, 2)).toBe(5); });\n  it.skip('later', () => {});\n});\n"
    });
    app.switchStudioFile('src/math.js');
    res = await app.runTests('file');
    const sum = res && res.tests && res.tests.summary;
    ok(sum && sum.pass === 4 && sum.fail === 1 && sum.skip === 1, `describe/it/expect: ${sum ? `${sum.pass} pass, ${sum.fail} fail, ${sum.skip} skip` : 'no summary'} (#163)`);
    ok(d.querySelectorAll('#studio-terminal .term-test-pass').length === 4 && d.querySelector('#studio-terminal .term-test-fail') && /5/.test(term()) && /4/.test(term()), 'per-test results with expected/received (#163)');
    app.switchStudioFile('src/math.test.js');
    res = await app.runStudioCode();
    ok(res && res.tests && res.tests.summary.total === 6, 'running a test file runs its tests');
    await app._runHistQ;
    const hist = await app.idbGet('run_history_v1');
    ok(Array.isArray(hist) && hist.length >= 8 && hist.some(h => h.mode === 'test') && hist.some(h => !h.success), `run history persisted (${hist && hist.length} runs) (#180, #229)`);
    await app.openRunHistory();
    ok(d.querySelectorAll('#ox-panel-body .run-hist').length >= 8, 'run history panel');
    app.closeModals();

    // ------------------------------------------------------------------
    section('Python (Pyodide worker) (#152, #162, #224)');
    setFiles({ 'main.py': "from utils.helper import greet\nname = input('Name? ')\nprint(greet(name))\n", 'utils/__init__.py': '', 'utils/helper.py': "def greet(n):\n    return 'hi ' + n\n" });
    app.switchStudioFile('main.py');
    app._runStdin = 'Nader';
    res = await app.runStudioCode();
    app._runStdin = '';
    ok(res && res.success && /hi Nader/.test(term()), 'Python in a worker: package imports + input() from stdin');
    ok(pyWorkers === 1, 'one Python worker, reused');
    setFiles({ 'boom.py': 'def f():\n    return 1 / 0\n\nf()\n' });
    app.switchStudioFile('boom.py');
    res = await app.runStudioCode();
    ok(!res.success && /ZeroDivisionError/.test(res.error) && d.querySelector('#studio-terminal .term-link[data-path="boom.py"]'), 'Python traceback with clickable file links');
    setFiles({ 'calc.py': 'def add(a, b):\n    return a + b\n', 'test_calc.py': "import pytest\nfrom calc import add\n\ndef test_add():\n    assert add(1, 2) == 3\n\n@pytest.mark.parametrize('a,b,c', [(1, 1, 2), (2, 2, 5)])\ndef test_param(a, b, c):\n    assert add(a, b) == c\n" });
    app.switchStudioFile('calc.py');
    res = await app.runTests('file');
    const ps = res && res.tests && res.tests.summary;
    ok(ps && ps.pass === 2 && ps.fail === 1, `pytest-style tests in Pyodide: ${ps ? `${ps.pass} pass, ${ps.fail} fail` : 'no summary'} (#162)`);
    ok(/test_param\[2-2-5\]/.test(term()) && /assert add\(a, b\) == c/.test(term()), 'failing assertion shown with parameters + source line');

    // ------------------------------------------------------------------
    section('Chat code blocks run in the sandbox (#151, #152)');
    const box = d.createElement('div');
    box.className = 'terminal-box';
    d.body.appendChild(box);
    res = await app.runJavaScriptCode('const xs = [1, 2, 3];\nconsole.log(xs.map(x => x * 2).join(","));', box);
    ok(res.success && /2,4,6/.test(box.textContent) && box.classList.contains('ox-term'), 'chat JS runs isolated (no new Function on the page)');
    res = await app.runPythonCode('def test_upper():\n    assert "a".upper() == "A"\n', box);
    ok(res.success && res.tests && res.tests.summary.pass === 1, 'chat Python test blocks run as tests');
    await app._runHistQ; // history writes are queued (fire-and-forget from the runner) — wait for them
    const histChat = await app.idbGet('run_history_v1');
    ok(histChat.some(h => h.source === 'chat'), 'chat runs recorded with source=chat');
    // Two runs finishing together: both entries must survive (read-modify-write used to drop one).
    const nBefore = histChat.length;
    await Promise.all([app.recordRun({ lang: 'js', mode: 'run', success: true, output: 'A', source: 'race-a' }), app.recordRun({ lang: 'js', mode: 'run', success: true, output: 'B', source: 'race-b' })]);
    const histRace = await app.idbGet('run_history_v1');
    ok(histRace.length === Math.min(50, nBefore + 2) && histRace.some(h => h.source === 'race-a') && histRace.some(h => h.source === 'race-b'), 'concurrent run records are both kept (history writes serialized)');

    // ------------------------------------------------------------------
    section('Preview, split editor, editor AI (#154, #137, #178, #179)');
    setFiles({ 'index.html': '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Hello</h1><script src="app.js"></script></body></html>', 'style.css': 'h1 { color: red; }', 'app.js': 'console.log("from preview");', 'README.md': '# Title' });
    app.switchStudioFile('index.html');
    await app.togglePreview(true);
    const frame = $('studio-preview-frame');
    ok(frame && /<h1>Hello<\/h1>/.test(frame.srcdoc) && /color: red/.test(frame.srcdoc) && /from preview/.test(frame.srcdoc) && frame.getAttribute('sandbox') === 'allow-scripts allow-forms allow-modals allow-popups', 'live preview inlines local CSS/JS into a sandboxed frame (#154)');
    ok(d.querySelector('.studio-editor-wrapper.preview-on'), 'editor + preview side by side');
    app.togglePreview(false);
    ok(!$('studio-preview-pane'), 'preview closes');
    app.switchStudioFile('app.js');
    app.toggleSplitEditor('style.css');
    await wait(10);
    ok(d.querySelector('.cm-split-pane .cm-editor') && app._splitEditor.ctl.getPath() === 'style.css', 'split editor with a second file (#137)');
    app._splitEditor.ctl.replaceRange(0, 0, '/* split */ ');
    await wait(20);
    ok(app.virtualProjectFiles.get('style.css').content.startsWith('/* split */'), 'edits in the split editor are saved');
    app.toggleSplitEditor();
    ok(!d.querySelector('.cm-split-pane'), 'split editor closes');
    setFiles({ 'src/x.js': 'function add(a, b) {\n  return a - b;\n}\n' });
    app.switchStudioFile('src/x.js');
    aiReply = 'The bug is the minus sign.\n```js\nfunction add(a, b) {\n  return a + b;\n}\n```';
    const fixing = app.aiFixCode('AssertionError: expected 3, got -1', 'src/x.js');
    for (let i = 0; i < 50 && !$('ox-dialog').classList.contains('active'); i++) await wait(20);
    ok($('ox-dialog').classList.contains('active') && d.querySelector('#ox-dialog .diff-scroll'), 'AI fix shows a diff before applying (#178, #179)');
    app.resolveDialog(0);
    await fixing;
    ok(app.virtualProjectFiles.get('src/x.js').content.includes('a + b') && or.calls.length >= 1, 'accepted AI fix is applied to the file');

    teardown();
    await wait(30);
    ok(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
    w.close();
})().catch(e => { console.error('❌ test crashed:', e); process.exitCode = 1; teardown(); if (W) W.close(); });
