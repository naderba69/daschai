/* Sprint 8 — AI category (ideas #1-#130) + the lazy AI-lab chunk. */
'use strict';
require('fake-indexeddb/auto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pathToFileURL } = require('url');
const { loadApp, mockOpenRouter, ok, wait, section, gzipBudgetKB } = require('./helpers');

const ROOT = path.join(__dirname, '..');
function exposeGlobals(w) {
    const names = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
        'KeyboardEvent', 'MouseEvent', 'Event', 'CustomEvent', 'localStorage', 'location', 'history', 'Blob', 'innerWidth', 'innerHeight', 'devicePixelRatio'];
    for (const n of names) Object.defineProperty(globalThis, n, { value: w[n], configurable: true, writable: true });
}

let W = null;
(async () => {
    // Every OpenRouter request goes through H(body) → { text } ; tests swap H per scenario.
    let H = () => ({ text: 'ok' });
    const or = mockOpenRouter(async (body, n) => H(body, n));
    const registry = { react: '19.1.0', lodash: '4.17.21', express: '5.1.0', moment: '2.30.1' };
    const netCalls = [];
    const fetchAll = async (url, opts) => {
        netCalls.push(String(url));
        const m = /registry\.npmjs\.org\/(.+)\/latest$/.exec(String(url));
        if (m) { const name = decodeURIComponent(m[1]); return registry[name] ? new Response(JSON.stringify({ version: registry[name] }), { status: 200 }) : new Response('{}', { status: 404 }); }
        return or.fetchImpl(url, opts);
    };
    const { w, d, app, errors } = loadApp({ fetchImpl: fetchAll, indexedDB: globalThis.indexedDB });
    W = w;
    exposeGlobals(w);
    const imported = [];
    app.importModule = (url) => { imported.push(url); return import(pathToFileURL(path.join(ROOT, url)).href); };
    const downloads = [];
    app.downloadBlob = (blob, name) => { downloads.push({ blob, name }); };
    app.copyToClipboard = function (text) { this._copied = text; return true; };
    const autoDialog = async (o) => ({ button: 'ok', values: Object.fromEntries((o.fields || []).map(f => [f.id, f.value])) });
    app.showDialog = autoDialog;
    app.settings.apiKey = 'sk-test';
    const lastUser = (body) => { const u = [...body.messages].reverse().find(m => m.role === 'user'); return typeof u.content === 'string' ? u.content : u.content.map(c => c.text || '').join(' '); };
    const sys = (body) => (body.messages.find(m => m.role === 'system') || {}).content || '';
    const files = (obj) => { app.virtualProjectFiles = new Map(Object.entries(obj).map(([p, c]) => [p, { content: c, lang: p.split('.').pop(), timestamp: Date.now() }])); };
    const resetSessions = (list) => { app.sessions = list; app.activeSessionId = list[0] ? list[0].id : null; app.saveSessions(); };
    const mk = (id, title, msgs = [], extra = {}) => ({ id, title, createdAt: Date.now(), updatedAt: Date.now(), messages: msgs, ...extra });
    const msg = (id, role, content) => ({ id, role, content, timestamp: Date.now() });
    await wait(50);

    // ------------------------------------------------------------------
    section('Lazy AI chunk + bundle budget');
    const build = w.OX_BUILD;
    ok(build && /^assets\/studio\/ai-\w+\.mjs$/.test(build.chunks.ai) && fs.existsSync(path.join(ROOT, build.chunks.ai)), 'OX_BUILD.chunks.ai points to the hashed AI chunk on disk');
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/studio/manifest.json'), 'utf8'));
    ok(manifest.chunks.ai === build.chunks.ai, 'manifest.json lists the AI chunk');
    const gz = zlib.gzipSync(fs.readFileSync(path.join(ROOT, 'index.html')), { level: 9 }).length / 1024;
    ok(gz < gzipBudgetKB, `main page stays under the ${gzipBudgetKB} KB gzip budget (${gz.toFixed(1)} KB)`);
    ok(/registry\.npmjs\.org/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/connect-src[^;]*/)[0]), 'CSP allows the npm registry (outdated check #88)');
    const stubs = app.lazyAIMethods();
    ok(stubs.length >= 30 && stubs.every(n => typeof app[n] === 'function' && app[n].__oxLazy === 'ai'), `AI entry points are lazy stubs before first use (${stubs.length})`);
    ok(!d.getElementById('ox-ai-chunk-css'), 'AI lab CSS is not in the page until the chunk loads');
    const mod = await import(pathToFileURL(path.join(ROOT, build.chunks.ai)).href);
    const L = mod.lib;
    await app.openAILab();
    ok(imported.includes(build.chunks.ai) && d.getElementById('ai-lab'), 'first call through a stub imports the chunk and opens the lab');
    ok(stubs.every(n => !app[n].__oxLazy), 'chunk install replaced every stub with the real method');
    ok(d.getElementById('ox-ai-chunk-css') && /\.ai-card/.test(d.getElementById('ox-ai-chunk-css').textContent), 'chunk injects its stylesheet once');
    let threw = false;
    try { await app.aiLab('nope'); } catch (e) { threw = /unknown ai method/.test(e.message); }
    ok(threw, 'app.aiLab() rejects unknown methods');

    // ------------------------------------------------------------------
    section('Shared parsing helpers');
    const fb = L.parseFileBlocks('intro\n```js [src/a.js]\nconst a = 1;\n```\n### src/b.ts\n```ts\nlet b = 2;\n```\n```py\n# file: tools/c.py\nprint(1)\n```\n```html title="index.html"\n<p></p>\n```\n```js [../../etc/passwd]\nx\n```\n```js [src/a.js]\nconst a = 2;\n```');
    ok(fb.length === 4 && fb[0].path === 'src/a.js' && fb[0].content === 'const a = 2;\n' && fb.some(f => f.path === 'src/b.ts') && fb.some(f => f.path === 'tools/c.py' && f.content === 'print(1)\n') && fb.some(f => f.path === 'index.html'), 'parseFileBlocks: [path], heading, first-line comment, title=, dedupe, rejects ../');
    ok(L.extractJSON('blah ```json\n{"a":1}\n```') .a === 1 && L.extractJSON('x {"b": "}"} y').b === '}' && L.extractJSON('[1,2]')[1] === 2 && L.extractJSON('none') === null, 'extractJSON (fenced, bare, strings with braces, arrays)');
    const ft = L.fillTemplate('Hi {{name}} {{x}}', { name: 'Ali' });
    ok(ft.text === 'Hi Ali ' && ft.missing.join() === 'x' && L.templateVars('{{a}} {{b}} {{a}}').join() === 'a,b', 'fillTemplate / templateVars');
    const st = L.splitThinking('<think>step 1\nstep 2</think>\nAnswer');
    ok(st.reasoning === 'step 1\nstep 2' && st.content === 'Answer' && L.splitThinking('plain').content === 'plain', 'splitThinking moves <think> blocks out of the answer');

    // ------------------------------------------------------------------
    section('Local analyzers (#24 #25 #45 #48 #51 #57 #60 #87 #88 #90)');
    const rx = L.explainRegex('/^(\\+216)?[2-9]\\d{7}$/g');
    ok(rx.valid && rx.parts.length >= 5 && rx.parts.some(p => p.token === '^') && rx.flags.some(f => f.flag === 'g'), 'regex explained token by token with flags (#45)');
    ok(!L.explainRegex('(abc').valid, 'invalid regex reported');
    const rt = L.testRegex('/^(\\d+)-(\\w+)$/', '12-ab\nnope');
    ok(rt[0].match && rt[0].groups.join() === '12,ab' && !rt[1].match, 'regex tester with capture groups');
    const cx = L.estimateComplexity('function f(a){ for (let i=0;i<a.length;i++){ for (let j=0;j<a.length;j++){ if (a[i]===a[j]) c++; } } }');
    ok(cx.time === 'O(n²)' || /n\^?²|n\^2/.test(cx.time), `nested loops → quadratic (${cx.time}) (#51)`);
    ok(/log/.test(L.estimateComplexity('const s = arr.sort((a,b)=>a-b);').time), 'sort → n log n');
    ok(L.detectNPlusOne('for (const u of users) {\n  const posts = await db.query("SELECT * FROM posts WHERE uid=?", [u.id]);\n}').length === 1, 'N+1 query inside a loop (#48)');
    ok(L.detectLeaks('setInterval(() => tick(), 1000);\nwindow.addEventListener("resize", onResize);').length >= 2, 'timers / listeners without cleanup (#57)');
    const nm = L.namingIssues('const q = getData();\nlet data = 1;\nlet user_name = "a";', 'a.js');
    ok(nm.some(n => n.name === 'q') && nm.some(n => n.name === 'data') && nm.some(n => n.name === 'user_name' && n.hint === 'userName'), 'naming suggestions (#25)');
    const pt = L.detectPatterns('class Db { static getInstance() { if (!Db.instance) Db.instance = new Db(); return Db.instance; } }\nfunction createUser(n) { return { n }; }');
    ok(pt.patterns.some(p => p.name === 'Singleton') && pt.patterns.some(p => p.name === 'Factory'), 'design patterns detected (#24)');
    const pkg = JSON.stringify({ name: 'x', version: '1.2.3', dependencies: { react: '^18.2.0', lodash: '^4.17.0', moment: '^2.29.0' }, devDependencies: { express: '~4.18.0', eslint: '^9.0.0' } });
    const deps = L.unusedDependencies({ 'package.json': pkg, 'src/a.js': "import React from 'react';\nimport dayjs from 'dayjs';\nconst m = require('moment');" });
    ok(deps.unused.some(u => u.name === 'lodash') && !deps.unused.some(u => u.name === 'react' || u.name === 'eslint') && deps.missing.includes('dayjs'), 'unused + missing dependencies (#60)');
    ok(!JSON.parse(L.removeDependencies(pkg, ['lodash'])).dependencies.lodash, 'removeDependencies edits package.json');
    ok(L.dependencyAdvice(pkg).some(a => a.name === 'moment'), 'modern alternatives suggested (#90)');
    ok(L.compareSemver('1.10.0', '1.9.9') > 0 && L.updateKind('^18.2.0', '19.1.0') === 'major' && L.updateKind('^4.17.0', '4.17.21') === 'patch' && L.bumpRange('~4.18.0', '5.1.0') === '~5.1.0', 'semver compare / update kind / range bump (#88)');
    ok(L.legacyFindings('var a = 1;\nmodule.exports = a;\nfs.readFile("x", function (err, d) {});').length >= 2, 'legacy code findings (#87)');
    const viol = L.checkStandards({ 'src/a.js': 'console.log(1);\nvar x = 2;\n// TODO fix', 'README.md': 'console.log' }, L.STANDARD_PRESETS);
    ok(viol.length >= 2 && viol.every(v => v.path === 'src/a.js'), 'team standards checker (#84)');
    ok(/Follow these team coding standards/.test(L.standardsPrompt(L.STANDARD_PRESETS)), 'standards → system prompt (#81)');

    // ------------------------------------------------------------------
    section('Generators catalog (#20-#130)');
    const G = L.GENERATORS;
    const ids = new Set(G.map(g => g.id));
    ok(G.length >= 80 && ids.size === G.length, `${G.length} generators with unique ids`);
    const skip = [7, 35, 71, 89, 124, 125];
    ok(G.every(g => g.idea >= 1 && g.idea <= 130 && !skip.includes(g.idea)), 'every generator maps to an AI idea (security ideas excluded)');
    ok(G.every(g => g.tool || /\S/.test(g.prompt)), 'every generator has instructions or a dedicated tool');
    ok(d.querySelectorAll('#ai-lab .ai-card[data-gen]').length === G.length, 'lab grid shows every generator');
    app._genQ = 'kubernetes'; app.renderGeneratorsTab(d.getElementById('ai-lab'));
    ok(d.querySelectorAll('#ai-lab .ai-card[data-gen]').length === 1, 'search filters generators');
    app._genQ = ''; app._genCat = 'devops'; app.renderGeneratorsTab(d.getElementById('ai-lab'));
    ok(d.querySelectorAll('#ai-lab .ai-card[data-gen]').length === G.filter(g => g.cat === 'devops').length, 'category chips filter generators');
    app._genCat = 'all';
    files({ 'package.json': pkg, 'src/a.js': 'function sum(a, b) {\n  return a + b;\n}\n', 'README.md': '# demo' });
    app.activeStudioFile = 'src/a.js';
    app.codeEditor = null;
    const bp = app.buildGeneratorPrompt(app.findGenerator('convert-lang'), { to: 'Go' });
    ok(bp.missing.length === 0 && /to Go/.test(bp.prompt) && /function sum/.test(bp.prompt) && /\[relative\/path/.test(bp.system), 'code generator embeds the active file + file-output contract');
    const bp2 = app.buildGeneratorPrompt(app.findGenerator('migrations'), {});
    ok(bp2.missing.includes('change') && /Project files \(3\)/.test(bp2.prompt), 'required fields reported; project generators get the project snapshot');
    const bp3 = app.buildGeneratorPrompt(app.findGenerator('naming'), {});
    ok(/Local static analysis/.test(bp3.prompt), 'local analyzer findings are attached to the prompt');
    app.openGenerator('cicd');
    ok(d.querySelector('.ai-gen-form[data-gen="cicd"]') && d.getElementById('gen-ci') && d.getElementById('gen-deploy'), 'generator form renders its fields');
    H = (body) => ({ text: /GitHub Actions/.test(lastUser(body)) ? 'Pipeline:\n```yaml [.github/workflows/ci.yml]\nname: CI\non: push\n```\n' : 'x' });
    d.getElementById('gen-deploy').value = 'Vercel';
    const gr = await app.runGeneratorFromForm('cicd');
    ok(gr && gr.files.length === 1 && gr.files[0].path === '.github/workflows/ci.yml', 'generator runs with the model and parses output files (#101)');
    ok(d.querySelector('#ai-gen-output .ai-result') && /كتابة 1 ملف/.test(d.getElementById('ai-gen-output').textContent), 'result card offers to write the files');
    const written = await app.aiApplyFiles(gr.files);
    ok(written.length === 1 && app.virtualProjectFiles.get('.github/workflows/ci.yml').content.includes('name: CI'), 'generated files are written into the project after preview');
    ok((app.getAISettings().recentGenerators || [])[0] === 'cicd', 'recent generators remembered');
    app.codeEditor = null; app.activeStudioFile = null;
    const toasts = [];
    const _toast = app.showToast; app.showToast = (m, t) => { toasts.push([m, t]); };
    ok(await app.runGenerator('big-o', {}) === null && toasts.some(t => /افتح ملفاً/.test(t[0])), 'code generators ask for code when none is open');
    app.showToast = _toast;
    H = () => ({ text: 'Big-O: O(n)' });
    ok((await app.runGenerator('big-o', { __code: 'for (const x of a) s += x;' })).text === 'Big-O: O(n)', 'pasted code works without an open file');
    app.activeStudioFile = 'src/a.js';

    // ------------------------------------------------------------------
    section('Local tools: code health, regex lab, dependency doctor, standards, palette (#113)');
    app.openAILab('local', 'code');
    ok(d.querySelectorAll('#ai-local-body details.ai-local').length === 6, 'offline code health report (6 analyzers)');
    app.openAILab('local', 'regex');
    ok(d.getElementById('rx-input') && d.querySelectorAll('.ai-rx li').length >= 4 && d.querySelectorAll('.ai-rx-tests .ok').length === 2, 'regex lab explains and tests live');
    H = () => ({ text: '{"regex": "/^\\\\d{4}$/", "explanation": "أربعة أرقام", "matches": ["1234"], "nonMatches": ["12a4"]}' });
    d.getElementById('rx-desc').value = 'أربعة أرقام';
    const rg = await app.aiRegexFromText();
    ok(rg && d.getElementById('rx-input').value === '/^\\d{4}$/' && d.querySelectorAll('.ai-rx-tests .ok').length === 1, 'regex generated from a description and re-tested');
    files({ 'package.json': pkg, 'src/a.js': "import React from 'react';\nconst m = require('moment');\nconst e = require('express');" });
    app.openAILab('local', 'deps');
    ok(d.querySelector('tr[data-dep="lodash"] .ai-badge.amber'), 'dependency doctor flags unused packages');
    const outd = await app.checkOutdatedDeps();
    ok(outd.react.latest === '19.1.0' && outd.lodash.latest === '4.17.21' && netCalls.some(u => /registry\.npmjs\.org\/react\/latest/.test(u)), 'latest versions fetched from the npm registry');
    ok(d.querySelector('tr[data-dep="react"] .ai-badge.red') && d.querySelector('tr[data-dep="react"] .dep-upd:not(:checked)') && d.querySelector('tr[data-dep="lodash"] .dep-upd:checked'), 'major updates unchecked by default, minor/patch checked');
    ok(app.applyDepUpdates(['lodash', 'express']) === 2 && JSON.parse(app.virtualProjectFiles.get('package.json').content).devDependencies.express === '~5.1.0', 'selected updates written to package.json (#88)');
    app.askConfirm = async () => true;
    ok(await app.removeUnusedDeps() >= 1 && !JSON.parse(app.virtualProjectFiles.get('package.json').content).dependencies.lodash, 'unused dependencies removed (#60)');
    files({ 'src/a.js': 'console.log(1);\nvar x = 1;', 'src/b.js': 'export const ok = 1;' });
    const before = app.checkProjectStandards().length;
    const rule = await app.addStandardRule({ label: 'no alert', pattern: '\\balert\\(', files: '\\.js$', message: 'لا تستخدم alert' });
    app.virtualProjectFiles.set('src/c.js', { content: 'alert(1)', lang: 'js' });
    ok(rule && app.checkProjectStandards().length === before + 1, 'custom lint rule (#82) detects violations');
    app.openAILab('local', 'standards');
    ok(d.querySelector(`.ai-rule[data-rule="${rule.id}"]`) && d.querySelectorAll('.ai-violations .ai-finding').length === before + 1, 'standards panel lists rules and violations');
    app.setAISettings({ standards: true });
    ok(/no alert/.test(app.buildGeneratorPrompt(app.findGenerator('webhooks'), { provider: 'x' }).system), 'standards injected into generators when enforced (#81)');
    app.setAISettings({ standards: false });
    const pal = L.generatePalette('#2563eb', 'triadic');
    ok(pal.colors.length === 3 && pal.checks.every(c => c.text >= 4.5) && /--color-primary:/.test(pal.css) && /prefers-color-scheme: dark/.test(pal.css), 'harmonious palette with WCAG-checked light/dark themes');
    ok(L.contrastRatio('#000000', '#ffffff') === 21 && L.generatePalette('nope') === null, 'contrast ratio + invalid colour');
    app.openAILab('local', 'palette');
    ok(d.querySelectorAll('.ai-swatch').length >= 10 && app._palette.css.includes(':root'), 'palette generator panel');

    // ------------------------------------------------------------------
    section('CHANGELOG (#28) + build fix (#30)');
    const groups = app.groupCommits('a1b2c3d feat(ui): dark mode\nb2c3d4e fix: crash on save\nc3d4e5f Merge branch x\nd4e5f6a chore: deps');
    ok(groups.Added[0] === '**ui:** dark mode' && groups.Fixed.length === 1 && groups.Changed.length === 1 && !JSON.stringify(groups).includes('Merge'), 'conventional commits grouped');
    app.openAILab('local', 'changelog');
    d.getElementById('cl-commits').value = 'a1b2c3d feat: export PDF\nb2c3d4e fix: login loop';
    d.getElementById('cl-version').value = '2.0.0';
    app.virtualProjectFiles.set('CHANGELOG.md', { content: '# Changelog\n\n## [1.0.0] - 2025-01-01\n- init\n', lang: 'md' });
    H = () => ({ text: '## [2.0.0] - 2026-10-21\n### Added\n- PDF export\n### Fixed\n- Login loop' });
    const cl = await app.generateChangelog();
    ok(cl && /^# Changelog\n\n## \[2\.0\.0\]/.test(cl.content) && cl.content.indexOf('[2.0.0]') < cl.content.indexOf('[1.0.0]'), 'new entry inserted above older releases');
    files({ 'src/app.ts': 'const a: number = "x";', 'package.json': '{}' });
    ok(app.pathsInLog('src/app.ts(1,7): error TS2322: Type string is not assignable\n at /home/runner/work/x/src/app.ts:1').join() === 'src/app.ts', 'files mentioned in a build log are detected');
    H = (body) => ({ text: /const a: number/.test(lastUser(body)) ? 'السبب: نوع خاطئ\n```ts [src/app.ts]\nconst a: number = 1;\n```' : 'no context' });
    const bf = await app.runBuildFix('src/app.ts(1,7): error TS2322');
    ok(bf && bf.files[0].path === 'src/app.ts' && bf.paths[0] === 'src/app.ts', 'build fix sends the failing file and returns the patch');

    // ------------------------------------------------------------------
    section('Reasoning: ToT (#15), self-refine (#17), CoT (#14), summary (#18), follow-ups (#19)');
    app.openAILab('think');
    H = (body) => {
        const s = sys(body);
        if (/pragmatic/.test(s)) return { text: 'Path A answer' };
        if (/first principles/.test(s)) return { text: 'Path B answer' };
        if (/unconventional/.test(s)) return { text: 'Path C answer' };
        return { text: '{"best": 2, "scores": [6, 9, 5], "reason": "B أدق", "synthesis": "Final B+"}' };
    };
    const tot = await app.treeOfThought('How to cache?');
    ok(tot && tot.paths.join('|') === 'Path A answer|Path B answer|Path C answer' && tot.judge.best === 1 && app._aiOut === 'Final B+', 'three parallel paths + judge synthesis');
    ok(d.querySelectorAll('.ai-tot-path').length === 3 && d.querySelector('.ai-tot-path.best[data-path="1"]'), 'ToT view highlights the winning path');
    let round = 0;
    H = (body) => {
        const u = lastUser(body);
        if (/Critique this answer/.test(u)) { round++; return { text: round === 1 ? '- missing edge case' : 'NO_ISSUES' }; }
        if (/Reviewer issues/.test(u)) return { text: 'v2 answer' };
        return { text: 'v1 answer' };
    };
    const sr = await app.selfRefine('Q?');
    ok(sr.answer === 'v2 answer' && sr.rounds === 1 && sr.log.some(l => l.kind === 'ok'), 'self-refine improves then stops when the critic finds nothing');
    H = () => ({ text: 'Step 1: Understand\nRead it.\nStep 2: Solve\nDo it.\nFinal answer: 42' });
    const cot = await app.chainOfThought('Q');
    ok(cot.steps.length === 2 && cot.answer === '42' && d.querySelectorAll('.ai-cot li').length === 2, 'visible chain-of-thought timeline');
    ok(L.parseSteps('{"steps":[{"title":"a"},"b"],"answer":"c"}').steps.length === 2 && L.parseJudge('the best is path 3', 3).best === 2, 'step / judge parsers are robust');
    const long = Array.from({ length: 12 }, (_, i) => msg('m' + i, i % 2 ? 'assistant' : 'user', 'message ' + i));
    resetSessions([mk('s1', 'long', long)]);
    H = () => ({ text: '- user builds a todo app' });
    const sum = await app.summarizeSession('s1', { keep: 4 });
    const s1 = app.sessions[0];
    ok(sum && s1.summary === '- user builds a todo app' && s1.summaryUpTo === 'm7', 'summary stored with the last summarised message');
    const payload = [{ role: 'system', content: 'SYS' }, ...long.map(m => ({ role: m.role, content: m.content }))];
    const tp = await app.transformChatPayload(payload, s1, {});
    ok(tp.length === 6 && /Summary of the earlier part/.test(tp[1].content) && tp[2].content === 'message 8', 'old turns replaced by the summary in the request (#18)');
    H = () => ({ text: '{"questions": ["لماذا؟", "كيف؟", "متى؟"]}' });
    const fq = await app.aiFollowups('s1');
    ok(fq.length === 3 && d.querySelectorAll('#ai-followups [data-fu]').length === 3, 'AI follow-up questions rendered as chips');
    ok(app.localFollowups('```js\nx\n```', 'عندي خطأ').length === 3 && /root cause/i.test(app.localFollowups('text', 'I have an error')[0]), 'instant local follow-ups adapt to content and language');

    // ------------------------------------------------------------------
    section('Long-term memory (#5)');
    ok(L.tokenize('المشروعات والكتب').includes('مشروعات') && L.tokenize('the API').join() === 'api', 'tokenizer normalises Arabic + drops stopwords');
    const docs = [{ id: 1, tf: { react: 2, hooks: 1 } }, { id: 2, tf: { python: 1, django: 2 } }];
    ok(L.rankMemories(docs, 'django python')[0].doc.id === 2 && L.rankMemories(docs, 'zzz').length === 0, 'TF-IDF cosine ranking');
    await app.addMemory('المستخدم يفضّل TypeScript و Tailwind في مشاريعه', { pinned: true });
    await app.addMemory('قاعدة البيانات المستخدمة هي PostgreSQL');
    ok((await app.searchMemories('ما قاعدة البيانات؟'))[0].doc.text.includes('PostgreSQL'), 'semantic-ish recall over IndexedDB memories');
    app._memories = null;
    ok((await app.loadMemories()).length === 2, 'memories persist in IndexedDB');
    const sm = mk('s2', 'mem', [msg('u1', 'user', 'تذكر: اسمي نادر وأعمل على daschai'), msg('a1', 'assistant', 'حسناً')]);
    resetSessions([sm]);
    ok(await app.captureMemory(sm) === 2 && (await app.loadMemories()).some(m => m.pinned && /اسمي نادر/.test(m.text)), 'explicit "تذكر" requests + Q/A traces captured');
    app.setAISettings({ memory: true });
    sm.messages.push(msg('u2', 'user', 'ما هي قاعدة البيانات؟'));
    const mp = await app.transformChatPayload([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'x' }], sm, {});
    ok(/Relevant long-term memory/.test(mp[0].content) && /PostgreSQL/.test(mp[0].content), 'relevant memories injected into the system prompt');
    app.setAISettings({ memory: false });
    app.openAILab('memory');
    await wait(20);
    ok(d.querySelectorAll('.ai-mem-list [data-mem]').length >= 3, 'memory tab lists memories');

    // ------------------------------------------------------------------
    section('ReAct agent (#4)');
    files({ 'src/util.js': 'export const add = (a, b) => a + b;\n' });
    let step = 0;
    H = (body) => {
        step++;
        const obs = lastUser(body);
        if (step === 1) return { text: '{"thought": "أستكشف الملفات", "tool": "list_files", "args": {}}' };
        if (step === 2) return { text: obs.includes('src/util.js') ? '{"thought": "أقرأ", "tool": "read_file", "args": {"path": "src/util.js"}}' : '{"tool":"finish","args":{"answer":"bad"}}' };
        if (step === 3) return { text: obs.includes('export const add') ? '{"thought": "أضيف", "tool": "write_file", "args": {"path": "src/sub.js", "content": "export const sub = (a, b) => a - b;\\n"}}' : '{"tool":"finish","args":{"answer":"bad"}}' };
        if (step === 4) return { text: 'Thought: تحقق\nAction: search\nAction Input: {"query": "sub"}' };
        return { text: obs.includes('src/sub.js:1') ? '{"thought": "تم", "tool": "finish", "args": {"answer": "أضفت sub في src/sub.js"}}' : '{"tool":"finish","args":{"answer":"search failed"}}' };
    };
    const seen = [];
    const run = await app.runAgent('أضف دالة طرح', { onStep: (s) => seen.push(s.tool) });
    ok(run.status === 'done' && seen.join() === 'list_files,read_file,write_file,search,finish' && run.answer === 'أضفت sub في src/sub.js', 'plan → act → observe loop with tool observations');
    ok(run.files.length === 1 && run.files[0].path === 'src/sub.js' && !app.virtualProjectFiles.has('src/sub.js'), 'writes are staged until the user approves');
    ok(L.parseAgentStep('nonsense').tool === 'finish' && L.parseAgentStep('{"action":"read_file","input":{"path":"a"}}').args.path === 'a', 'step parser handles JSON, Action: lines and plain text');
    const fakeRun = { staged: new Map() };
    ok(/invalid path/.test(await app.agentTool('write_file', { path: '../x.js', content: '' }, fakeRun)) && /unknown tool/.test(await app.agentTool('rm', {}, fakeRun)), 'unsafe paths and unknown tools rejected');
    const _studio = app.studio;
    app.studio = async (m, o) => ({ success: true, logs: m === 'runCode' && /1\+1/.test(o.code) ? '2' : '' });
    ok(/^OK\n2/.test(await app.agentTool('run_js', { code: 'console.log(1+1)' }, fakeRun)), 'run_js executes through the sandboxed runner');
    app.studio = _studio;
    let n8 = 0;
    H = () => { n8++; return { text: '{"thought":"loop","tool":"list_files","args":{}}' }; };
    const capped = await app.runAgent('loop forever');
    ok(n8 === 8 && capped.steps.length === 8 && capped.status === 'done', 'agent is capped at 8 steps');
    resetSessions([mk('s3', 'agent chat', [])]);
    app.isAutonomousAgentActive = true;
    step = 0;
    H = () => ({ text: '{"thought":"done","tool":"finish","args":{"answer":"تم بنجاح"}}' });
    d.getElementById('user-input').value = 'نظّم المشروع';
    await app.sendUserMessage();
    const am = app.sessions[0].messages;
    ok(am.length === 2 && am[0].content === 'نظّم المشروع' && am[1].content === 'تم بنجاح' && am[1].status === 'completed' && am[1].steps.length >= 2, 'agent mode in the chat runs the ReAct loop as a message (#4)');
    app.isAutonomousAgentActive = false;

    // ------------------------------------------------------------------
    section('Prompt library (#34) + personas (#36)');
    const all0 = app.allPrompts().length;
    ok(all0 >= 20 && app.searchPrompts('SQL').length >= 1, 'built-in prompt library with search');
    const up = app.savePrompt({ title: 'ترجمة', text: 'ترجم {{text}} إلى {{lang}}', cat: 'لغة', tags: 'ترجمة, لغات' });
    ok(app.allPrompts().length === all0 + 1 && up.tags.length === 2 && app.searchPrompts('', 'لغة')[0].id === up.id, 'save custom prompts with category and tags');
    const used = await app.usePrompt(up.id, { values: { text: 'hello', lang: 'Arabic' } });
    ok(used === 'ترجم hello إلى Arabic' && d.getElementById('user-input').value === used, 'variables filled and inserted into the input');
    app.togglePromptFav(up.id);
    ok(app.searchPrompts('', 'fav')[0].id === up.id && app.allPrompts().find(p => p.id === up.id).uses === 1, 'favourites + usage counts');
    ok(app.importPrompts({ prompts: [{ title: 'a', text: 'imported prompt' }, { text: 'ترجم {{text}} إلى {{lang}}' }] }) === 1, 'import skips duplicates');
    app.openAILab('library');
    ok(d.querySelectorAll('.ai-prompt').length >= 20 && d.querySelectorAll('.ai-card.persona').length >= 12, 'library tab shows prompts and the persona marketplace');
    ok(app.installPersona('teacher') && w.eval('PERSONA_PROMPTS.mk_teacher').includes('مدرّس'), 'installing a persona registers its system prompt');
    app.activePersona = 'tests';
    app.cyclePersona();
    ok(app.activePersona === 'mk_teacher' && d.getElementById('persona-label').innerText.includes('مدرّس'), 'persona pill cycles through installed personas');
    resetSessions([mk('s4', 'persona', [])]);
    H = () => ({ text: 'hi' });
    const callsBefore = or.calls.length;
    await app.sendUserMessage('مرحبا');
    await wait(30);
    ok(or.calls.length > callsBefore && /مدرّس برمجة صبور/.test(or.calls[or.calls.length - 1].messages[0].content), 'active persona drives the chat system prompt');
    const cp = await app.createCustomPersona({ name: 'محامي', desc: 'عقود', prompt: 'أنت محامٍ تقني.' });
    ok(cp && app.personaList().some(p => p.id === 'mk_' + cp.id), 'custom personas');
    app.setPersona('fullstack');

    // ------------------------------------------------------------------
    section('Model explorer (#1)');
    const models = [
        { id: 'a/free-small', name: 'Free Small', provider: 'A', is_free: true, context_length: 32000, pricing: { prompt: 0, completion: 0 } },
        { id: 'b/cheap', name: 'Cheap', provider: 'B', is_free: false, is_vision: true, context_length: 128000, pricing: { prompt: 0.0000002, completion: 0.0000006 } },
        { id: 'c/pricey', name: 'Pricey', provider: 'C', is_free: false, is_reasoning: true, context_length: 200000, pricing: { prompt: 0.00001, completion: 0.00003 } }
    ];
    ok(app.filterModels(models, { free: 'paid', maxPrice: 1 }).map(m => m.id).join() === 'b/cheap', 'filter by paid + max price per 1M tokens');
    ok(app.filterModels(models, { sort: 'context' })[0].id === 'c/pricey' && app.filterModels(models, { vision: true }).length === 1 && app.filterModels(models, { minContext: 100000 }).length === 2, 'sort by context, capability filters');
    ok(app.filterModels(models, { sort: 'speed', speed: { 'b/cheap': { tps: 90 }, 'a/free-small': { tps: 30 } } })[0].id === 'b/cheap', 'sort by measured speed');
    localStorage.setItem('ox_alpha_usage_v1', JSON.stringify([{ t: 1, m: 'b/cheap', pt: 10, ct: 100, ms: 2000 }, { t: 2, m: 'b/cheap', pt: 10, ct: 300, ms: 2000 }]));
    ok(app.modelSpeedStats()['b/cheap'].tps === 100, 'speed measured from local usage history');
    app.availableModels = models;
    app.openAILab('models');
    ok(d.querySelectorAll('tr[data-model]').length === 3, 'explorer table');

    // ------------------------------------------------------------------
    section('Career kit (#67 #72-#80)');
    app.openAILab('career');
    d.getElementById('car-role').value = 'Backend Developer';
    d.getElementById('car-skills').value = 'Node.js, PostgreSQL';
    H = (body) => ({ text: /Backend Developer/.test(lastUser(body)) && /Node\.js, PostgreSQL/.test(lastUser(body)) ? '# CV\n- Node.js' : 'missing profile' });
    ok(await app.aiCareerDoc('cv') === '# CV\n- Node.js', 'CV generated from the profile (#72)');
    H = () => ({ text: 'Q1?' });
    const sid = app.startInterview();
    await wait(30);
    const isess = app.sessions.find(s => s.id === sid);
    ok(isess && isess.mode === 'interview' && /Backend Developer/.test(isess.messages[0].content), 'mock interview session in interview mode (#67)');
    isess.messages.push(msg('u9', 'user', 'answer 1'), msg('a9', 'assistant', 'Q2?'));
    H = () => ({ text: '{"score": 72, "verdict": "lean hire", "answers": [{"question": "Q1", "score": 7, "feedback": "جيد", "better": "..."}], "strengths": ["وضوح"], "improve": ["العمق"], "next": "راجع الفهارس"}' });
    const grade = await app.gradeInterview();
    ok(grade && grade.score === 72 && /72\/100/.test(d.getElementById('ai-gen-output').textContent), 'interview graded with per-answer feedback (#78)');
    downloads.length = 0;
    const svg = await app.downloadCertificate({ name: 'نادر', title: 'تحدي 30 يوماً', detail: '500 XP', level: 4 });
    ok(/<svg/.test(svg) && svg.includes('نادر') && downloads[0] && /\.svg$/.test(downloads[0].name), 'achievement certificate download (#79)');
    ok(!L.certificateSVG({ name: '<script>' }).includes('<script>'), 'certificate escapes user text');

    // ------------------------------------------------------------------
    section('Vision (#38 #39), voice agent (#37), autocomplete (#31)');
    app.openVisionTool('image');
    app._vision.images = ['data:image/png;base64,AAAA'];
    H = (body) => {
        const u = [...body.messages].reverse().find(m => m.role === 'user');
        const hasImg = Array.isArray(u.content) && u.content.some(c => c.type === 'image_url');
        return { text: hasImg ? '```html [index.html]\n<html><head><link rel="stylesheet" href="styles.css"></head><body><h1>Hi</h1></body></html>\n```\n```css [styles.css]\nh1{color:red}\n```' : 'no image' };
    };
    const vis = await app.runVision();
    const frame = d.getElementById('vision-preview');
    ok(vis && vis.files.length === 2 && !frame.hidden && /<style>h1\{color:red\}/.test(frame.srcdoc) && frame.getAttribute('sandbox') === 'allow-scripts', 'design image → HTML/CSS with sandboxed live preview (#38)');
    app.openVisionTool('video');
    ok(d.getElementById('vision-transcript') && d.getElementById('vision-frames'), 'video tool collects frames + transcript (#39)');
    ok(L.voiceCommand('توقف').action === 'stop' && L.voiceCommand('افتح الملف app.js').arg === 'app.js' && L.voiceCommand('ما هو React؟').action === 'ask', 'voice commands parsed locally');
    const spoken = [];
    app.voiceAgentSpeak = (t, then) => { spoken.push(t); };
    app.voiceAgentListen = () => true;
    app._voiceAgent = { on: true };
    files({ 'src/app.js': 'x' });
    const _open = app.openProjectFile;
    app.openProjectFile = function (p) { this.activeStudioFile = p; }; // keep CodeMirror out of jsdom
    await app.voiceAgentHandle('افتح الملف app.js');
    app.openProjectFile = _open;
    ok(app.activeStudioFile === 'src/app.js' && /فتحت/.test(spoken.pop()), 'voice agent executes commands');
    resetSessions([mk('s5', 'voice', [])]);
    H = () => ({ text: 'React مكتبة واجهات' });
    await app.voiceAgentHandle('ما هو React؟');
    ok(spoken.pop() === 'React مكتبة واجهات', 'voice agent asks the chat and speaks the reply (#37)');
    app._voiceAgent = null;
    ok(L.cleanCompletion('كيف أكتب', 'كيف أكتب دالة في بايثون\nmore') === ' دالة في بايثون' && L.cleanCompletion('hello', '"world"') === 'world', 'completion cleanup');
    H = (body) => ({ text: /Unfinished message/.test(lastUser(body)) ? ' دالة تكرارية' : '' });
    ok(await app.aiComplete('اكتب لي مثالاً عن') === ' دالة تكرارية', 'autocomplete asks a small model for the continuation (#31)');
    app.setAISettings({ autocomplete: true });
    const inp = d.getElementById('user-input');
    inp.value = 'اكتب لي';
    ok(inp.__oxAC && app.showGhost(' مثالاً') && d.getElementById('ai-ghost').style.display === '', 'ghost suggestion shown above the input');
    inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    ok(inp.value === 'اكتب لي مثالاً' && !app._ghost, 'Tab accepts the suggestion');
    app.setAISettings({ autocomplete: false });

    // ------------------------------------------------------------------
    section('Chat hooks: modes (#66 #68), <think> (#14), follow-ups (#19), Mega Arena (#3), palette');
    ok(Object.keys(app.CHAT_MODES).length === 14 && app.CHAT_MODES.lineByLine.prompt && app.CHAT_MODES.match.prompt, 'line-by-line teacher + match-against-AI modes');
    resetSessions([mk('s6', 'think', [])]);
    app.setAISettings({ cot: true, followups: 'local' });
    H = () => ({ text: '<think>1. read\n2. answer</think>\nالجواب هو 4\n```js\nconsole.log(4)\n```' });
    await app.sendUserMessage('كم 2+2؟');
    await wait(40);
    const tm = app.sessions[0].messages[1];
    ok(/VISIBLE REASONING/.test(or.calls[or.calls.length - 1].messages[0].content), 'CoT instruction added to the request when enabled');
    ok(tm.reasoning.includes('1. read') && !tm.content.includes('<think>') && tm.content.startsWith('الجواب'), '<think> moved into the reasoning panel');
    ok(d.querySelectorAll('#ai-followups [data-fu]').length === 3 && /اشرح هذا الكود/.test(d.getElementById('ai-followups').textContent), 'follow-up chips after the reply');
    H = () => ({ text: 'شرح' });
    d.querySelector('#ai-followups [data-fu="0"]').click();
    const hiddenOnSend = d.getElementById('ai-followups').style.display === 'none';
    await wait(40);
    ok(app.sessions[0].messages.length === 4 && /اشرح هذا الكود/.test(app.sessions[0].messages[2].content) && hiddenOnSend, 'clicking a follow-up sends it (chips hide while sending)');
    app.setAISettings({ cot: false });
    app.setArenaCount(8);
    ok(app.arenaCount === 8 && app.getArenaModels().length === 8 && new Set(app.getArenaModels()).size === 8, 'Mega Arena: 8 models (#3)');
    ok(d.querySelector('#arena-count-select option[value="8"]') && d.getElementById('arena-grid').dataset.count === '8', 'arena selector offers 8 slots');
    app.setArenaCount(12);
    ok(app.arenaCount === 8, 'arena count clamped to 8');
    app.setArenaCount(2);
    const cmds = app.buildPaletteCommands().filter(c => c.section === 'مختبر الذكاء');
    ok(cmds.length >= 12, `palette section for the AI lab (${cmds.length})`);
    app.closeModals();
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'l', altKey: true }));
    await wait(20);
    ok(d.getElementById('ox-panel-modal').classList.contains('active') && d.getElementById('ai-lab'), 'Alt+L opens the AI lab');
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'p', altKey: true }));
    await wait(20);
    ok(d.querySelector('.ai-prompts'), 'Alt+P opens the prompt library');
    app.openAIHub();
    ok(d.querySelector('#ai-hub-body .ai-hub-lab'), 'AI hub links to the lab');
    app.openAILab('settings');
    ok(d.querySelectorAll('[data-aiset]').length === 5, 'AI lab settings tab');

    await wait(30);
    ok(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
    w.close();
})().catch(e => { console.error('❌ test crashed:', e); process.exitCode = 1; if (W) W.close(); });
