/* Sprint 11 — Collaboration (#731-#810) + Analytics (#891-#940) through the lazy Team & Analytics chunk. */
'use strict';
require('fake-indexeddb/auto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { loadApp, mockOpenRouter, ok, wait, section } = require('./helpers');
const { createTeamGitHub } = require('./team-mock');

const ROOT = path.join(__dirname, '..');
function exposeGlobals(w) {
    const names = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
        'KeyboardEvent', 'MouseEvent', 'Event', 'CustomEvent', 'localStorage', 'location', 'history', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'Image', 'HTMLCanvasElement'];
    for (const n of names) Object.defineProperty(globalThis, n, { value: w[n], configurable: true, writable: true });
}
function browserStubs(w) {
    w.URL.createObjectURL = () => 'blob:https://daschai.vercel.app/1';
    w.URL.revokeObjectURL = () => {};
    w.HTMLCanvasElement.prototype.getContext = function () { return new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ data: [] })), set: (t, k, v) => { t[k] = v; return true; } }); };
    w.CSS = w.CSS || { escape: (s) => String(s) };
    w.BroadcastChannel = class { constructor(n) { this.name = n; (w.__bc = w.__bc || []).push(this); } postMessage(m) { (w.__bcSent = w.__bcSent || []).push(m); } close() { this.closed = true; } };
}

(async () => {
    let aiText = () => 'رد الذكاء';
    const or = mockOpenRouter(async (body) => ({ text: aiText(body) }));
    const gh = createTeamGitHub({ owner: 'o', repo: 'r', me: 'nader' });
    const fetchAll = async (url, opts = {}) => {
        const u = String(url);
        if (u.startsWith('https://api.github.com')) return gh.handle(u, opts);
        if (u.includes('openrouter.ai')) return or.fetchImpl(url, opts);
        return new Response('{}', { status: 404 });
    };
    const { w, d, app, errors } = loadApp({ fetchImpl: fetchAll, indexedDB: globalThis.indexedDB, beforeParse: browserStubs });
    w.addEventListener('error', (e) => { if (e.error && e.error.stack) console.log('STACK', e.error.stack.split('\n').slice(0, 4).join(' | ')); });
    exposeGlobals(w);
    globalThis.fetch = fetchAll;
    const imported = [];
    app.importModule = (url) => { imported.push(url); return import(pathToFileURL(path.join(ROOT, url)).href); };
    const downloads = [];
    app.downloadBlob = (blob, name) => { downloads.push({ blob, name }); };
    const confirms = [];
    app.askConfirm = async (t, m) => { confirms.push([t, m]); return true; };
    app.askText = async (t, v) => v;
    app.printHTML = (html) => { app._printed = html; };
    app.settings.apiKey = 'sk-or-test';
    app.settings.githubOwner = 'o'; app.settings.githubRepo = 'r';
    await wait(80);
    const files = app.virtualProjectFiles;
    files.clear();
    files.set('index.html', { content: '<!doctype html><head><script src="app.js"></script></head><img src="a.png"><a href="x" target="_blank">x</a>' });
    files.set('app.js', { content: 'import { add } from "./utils.js";\nconst password = "hunter2secret";\nfor (let i = 0; i < 3; i++) { await fetch("/x" + i); }\neval("1+1");\nconsole.log(add(1, 2));\n' });
    files.set('utils.js', { content: 'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n' });
    files.set('utils.test.js', { content: 'import { add } from "./utils.js";\ntest("add", () => expect(add(1, 2)).toBe(3));\n' });
    files.set('README.md', { content: '# Demo\n' });

    section('Lazy team chunk');
    const P = Object.getPrototypeOf(app);
    ok(app.openTeamHub.__oxLazy === 'team' && app.tmOpenSnip.__oxLazy === 'team', 'hub entry points are lazy stubs');
    ok(!P.__oxTeam && !imported.some(u => /team-/.test(u)), 'chunk not loaded at startup');
    ok(app.TEAM_TABS.length === 11 && app.buildPaletteCommands().filter(c => c.section === 'الفريق والتحليلات').length === 11, '11 tabs in the palette');
    ok(app.BUILTIN_SHORTCUTS.some(x => x[0] === 'Alt+E'), 'Alt+E shortcut registered');
    await app.openTeamHub('team');
    ok(imported.some(u => /assets\/studio\/team-[A-Z0-9]+\.mjs$/.test(u)), 'first use loads assets/studio/team-*.mjs');
    ok(P.__oxTeam && !app.openTeamHub.__oxLazy, 'stubs replaced by real methods');
    ok(d.getElementById('ox-team-chunk-css') && d.getElementById('ox-media-chunk-css'), 'team + fmx CSS injected');
    const lib = P.__oxTeam.lib;
    const tabs = lib.TAB_DEFS;
    await app.loadChunk('ai');

    const sweep = async (label) => {
        let n = 0; const bad = [];
        for (const [tab, defs] of Object.entries(tabs)) {
            for (const [sec, , method] of defs) {
                n++;
                if (typeof app[method] !== 'function') { bad.push(`${tab}/${sec}: missing ${method}`); continue; }
                try {
                    await app.tmLoad(tab, sec);
                    await wait(5);
                    const el = d.getElementById('tmx-sec');
                    const html = el ? el.innerHTML : '';
                    if (!el || el.dataset.tmSec !== sec || !html || /gh-empty bad/.test(html) || /live-step-spinner/.test(html.slice(0, 200))) bad.push(`${tab}/${sec}: ${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200)}`);
                } catch (e) { bad.push(`${tab}/${sec}: ${e.message}`); }
            }
        }
        ok(bad.length === 0, `${label}: all ${n} sections render${bad.length ? ' — ' + bad.join(' | ') : ''}`);
        return n;
    };
    section('Section sweep — local (no GitHub)');
    const n1 = await sweep('local');
    ok(n1 === 49, `49 sections (${n1})`);
    section('Section sweep — GitHub');
    app.settings.githubToken = 'ghp_test';
    const n2 = await sweep('github');
    if (gh.misses.length) console.log('GH misses:', [...new Set(gh.misses)].join(' | '));

    section('Method sweep');
    const used = new Set();
    for (const f of fs.readdirSync(path.join(ROOT, 'src/team'))) {
        if (!f.endsWith('.js')) continue;
        const src = fs.readFileSync(path.join(ROOT, 'src/team', f), 'utf8');
        for (const m of src.matchAll(/this\.([A-Za-z_$][\w$]*)\s*\(/g)) used.add(m[1]);
        for (const m of src.matchAll(/app\.([A-Za-z_$][\w$]*)\(/g)) used.add(m[1]);
        for (const m of src.matchAll(/call(?:Raw)?\('([A-Za-z_$][\w$]*)'/g)) used.add(m[1]);
    }
    await app.loadChunk('media');
    try { await app.loadChunk('runner'); } catch (e) { /* worker-only chunk */ }
    const crdtOnly = new Set(['_visibleIndex', '_integrate', 'text', 'localDelete', 'localInsert', '_ready', '_apply', 'select']);
    const missing = [...used].filter(n => !crdtOnly.has(n) && typeof app[n] !== 'function' && n !== 'createRunSandbox');
    ok(missing.length === 0, `every app method used by the chunk exists (${used.size})${missing.length ? ' — missing: ' + missing.join(', ') : ''}`);

    section('Pure: CRDT (RGA) convergence');
    const A = lib.RGA.fromText('a', 'hello');
    const B = lib.RGA.fromSnapshot('b', A.snapshot());
    const opsA = A.localReplace('hello world');
    const opsB = B.localReplace('Hello');
    A.apply(opsB); B.apply(opsA);
    ok(A.text() === B.text() && A.text() === 'Hello world', `concurrent edits converge (${A.text()})`);
    const C = lib.RGA.fromSnapshot('c', A.snapshot());
    const o1 = A.localReplace('Hello brave world'), o2 = C.localReplace('Hello world!');
    C.apply(o1); A.apply(o2);
    ok(A.text() === C.text() && /brave/.test(A.text()) && /!$/.test(A.text()), 'insert + append from two sites converge');
    const late = lib.RGA.fromSnapshot('d', lib.RGA.fromText('x', '').snapshot());
    const src = lib.RGA.fromText('e', ''); const s1 = src.localReplace('ab'); const s2 = src.localReplace('abc');
    late.apply(s2); late.apply(s1);
    ok(late.text() === 'abc', 'out-of-order ops buffered until causally ready');
    ok(lib.mapOffset(5, 'hello', 'XXhello') === 7, 'cursor offset mapping across remote edits');

    section('Pure: team roles, invites, CODEOWNERS');
    const team = lib.defaultTeam('Alpha', 'nader', 'o/r');
    team.members.push({ login: 'u1', role: 'editor' }, { login: 'u2', role: 'viewer' });
    team.rules = [{ pattern: 'src/core/**', allow: ['u1'] }, { pattern: '*.lock', allow: [] }];
    ok(lib.accessFor(team, 'nader', 'src/core/a.js') === 'write' && lib.accessFor(team, 'u1', 'src/core/a.js') === 'write' && lib.accessFor(team, 'u1', 'yarn.lock') === 'read' && lib.accessFor(team, 'u2', 'x.js') === 'read', 'accessFor: owner / allowed editor / restricted / viewer');
    ok(JSON.stringify(lib.readonlyPatterns(team, 'u1')) === JSON.stringify(['*.lock']) && lib.readonlyPatterns(team, 'u2')[0] === '**', 'read-only patterns per login');
    ok(/^\* @nader$/m.test(lib.codeOwners(team)) && /^src\/core\/\*\* @u1 @nader$/m.test(lib.codeOwners(team)), 'CODEOWNERS generated from rules');
    ok(lib.matchGlob('src/**', 'src/a/b.js') && lib.matchGlob('*.md', 'docs/x.md') && !lib.matchGlob('src/*.js', 'src/a/b.js') && lib.matchGlob('docs/', 'docs/a/b.md'), 'glob matching (**, *, basename, folders)');
    const inv = lib.encodeInvite({ repo: 'o/r', team: 'Alpha', role: 'editor', by: 'nader', exp: Date.now() + 1000 });
    ok(lib.decodeInvite('#oxteam=' + inv).team === 'Alpha' && lib.decodeInvite('garbage') === null, 'invite link round-trip');
    ok(lib.roleFromGH({ admin: true }) === 'owner' && lib.roleFromGH({ push: true }) === 'editor' && lib.roleFromGH({ pull: true }) === 'viewer', 'GitHub permission → role');
    ok(lib.isAIMention('@ai ما هذا؟') && lib.isAIMention('سؤال @OX-AI') && !lib.isAIMention('email@aid.com'), '@ai mentions detected');

    section('Pure: review + snippets');
    const rows = lib.parsePatch(gh.state.pulls[0].files[0].patch);
    ok(rows[0].type === 'hunk' && rows.filter(r => r.type === 'add').map(r => r.newLine).join() === '2,3' && rows.find(r => r.type === 'del').oldLine === 2, 'parsePatch line numbers');
    ok(lib.parseSuggestion(lib.suggestionBody('const x = 1;', 'note')) === 'const x = 1;' && lib.applySuggestion('a\nb\nc', 2, 2, 'B1\nB2') === 'a\nB1\nB2\nc', 'suggestion body + apply');
    const encS = await lib.encryptText('سرّي جداً', 'pw');
    ok(await lib.decryptText(encS, 'pw') === 'سرّي جداً' && await lib.decryptText(encS, 'bad') === null, 'AES-GCM snippet encryption');
    ok(!lib.snipStatus({ exp: 1 }, 0, 2).ok && lib.snipStatus({ max: 3 }, 3).reason === 'limit' && lib.snipStatus({ max: 3 }, 1).remaining === 2, 'expiry + view limits');
    ok(lib.parseSnipHash('#oxsnip=g:abc&embed=1').embed && lib.parseSnipHash('#oxsnip=l:xyz').kind === 'l', 'snippet hash parsing');
    const emb = lib.embedHTML({ code: '<b>x</b>', name: 'a.html', url: 'https://x' });
    ok(/&lt;b&gt;x&lt;\/b&gt;/.test(emb) && !/<b>x<\/b>/.test(emb), 'embed HTML escapes code');

    section('Pure: engagement + modes');
    const t1 = lib.tallyPoll(['A', 'B', 'C'], [{ user: 'a', c: [0], t: 1 }, { user: 'b', c: [1], t: 2 }, { user: 'a', c: [1], t: 3 }]);
    ok(t1.voters === 2 && t1.counts.join() === '0,2,0' && t1.winners[0] === 1, 'poll tally keeps each voter\'s last vote');
    const qs = [{ q: 'لغة؟', type: 'choice', options: ['JS', 'Py'] }, { q: 'تقييم', type: 'rating' }, { q: 'رأي', type: 'text' }];
    const agg = lib.aggregateSurvey(qs, [{ user: 'a', a: [0, 5, 'ممتاز'] }, { user: 'b', a: [1, 3, ''] }]);
    ok(agg[0].counts.join() === '1,1' && agg[1].avg === 4 && agg[2].texts.length === 1, 'survey aggregation');
    ok(lib.surveyCSV(qs, [{ user: 'a', a: [1, 4, 'x,"y"'] }]).split('\n')[1] === '"a","Py","4","x,""y"""', 'survey CSV escaping');
    const ics = lib.toICS([{ id: 'e1', title: 'Sprint, review', start: Date.UTC(2026, 9, 21, 9), desc: 'a\nb' }, { id: 'e2', title: 'Release', start: Date.UTC(2026, 9, 25), allDay: true }]);
    ok(/BEGIN:VCALENDAR\r\n/.test(ics) && /SUMMARY:Sprint\\, review/.test(ics) && /DTSTART:20261021T090000Z/.test(ics) && /DTSTART;VALUE=DATE:20261025/.test(ics) && /DESCRIPTION:a\\nb/.test(ics), 'ICS export (RFC 5545 escaping, all-day)');
    const grid = lib.monthGrid(2026, 9, [{ start: Date.UTC(2026, 9, 21, 9) }]);
    ok(grid.length % 7 === 0 && grid.filter(Boolean).length === 31 && grid.find(c => c && c.d === 21).events.length === 1 && grid.indexOf(grid.find(Boolean)) === 5, 'month grid (Saturday week start)');
    const lb = lib.leaderboard({ a: { commits: 3 }, b: { prs: 2 }, c: {} });
    ok(lb[0].login === 'b' && lb[0].medal === '🥇' && lb[2].score === 0, 'leaderboard scoring');
    ok(lib.decide(1, 0, 2).state === 'pending' && lib.decide(2, 1, 2).state === 'accepted' && lib.decide(1, 1, 2).state === 'rejected', 'proposal decisions with quorum');
    ok(lib.scoreSubmission([{ ok: true }, { ok: true }], 0).score === 250 && lib.scoreSubmission([{ ok: true }, { ok: false }], 0).bonus === 0, 'contest scoring + speed bonus');
    const script = lib.buildChallengeScript('function solve(n){return n*2}', [[[2], 4], [[3], 7]]);
    let posted = null; new Function('postMessage', 'performance', script)((m) => { posted = m; }, { now: () => 0 });
    ok(posted && posted.type === 'challenge' && posted.results[0].ok && !posted.results[1].ok, 'challenge harness runs tests');
    const dq = lib.dailyQuests('2026-10-21');
    ok(dq.length === 3 && new Set(dq.map(q => q.id)).size === 3 && JSON.stringify(lib.dailyQuests('2026-10-21')) === JSON.stringify(dq), 'daily quests deterministic');
    const boss = lib.bossState([{ created_at: new Date(Date.now() - 10 * 864e5).toISOString(), closed_at: new Date().toISOString() }, { created_at: new Date().toISOString() }]);
    ok(boss.hp === 2 && boss.damage === 1 && !boss.defeated, 'bug boss HP/damage');

    section('Pure: AI team (assign, delays, minutes, coach)');
    const plan = lib.assignTasks([{ id: 1, title: 'Fix CSS button on login page', priority: 'high' }, { id: 2, title: 'Add API endpoint for users' }, { id: 3, title: 'Write docs' }],
        [{ login: 'fe', skills: ['frontend', 'css'] }, { login: 'be', skills: ['backend', 'api'] }]);
    ok(plan.find(p => p.taskId === 1).login === 'fe' && plan.find(p => p.taskId === 2).login === 'be', 'skill-based assignment');
    ok(plan.find(p => p.taskId === 3).reason === 'الأقل حملاً حالياً', 'unmatched task → least loaded');
    const inf = lib.inferSkills({ a: ['src/components/B.tsx', '.github/workflows/ci.yml'], b: ['api/users.py'] });
    ok(inf.a.includes('frontend') && inf.a.includes('devops') && inf.b.includes('backend') && inf.b.includes('python'), 'skills inferred from touched files');
    const now = Date.now();
    ok(lib.predictDelay({ deadline: now - 864e5, status: 'todo' }, now).level === 'overdue', 'overdue detected');
    ok(lib.predictDelay({ deadline: now + 0.2 * 864e5, status: 'todo', estimate: 600 }, now).level === 'high', 'tight deadline → high risk');
    ok(lib.predictDelay({ deadline: now + 20 * 864e5, status: 'doing', estimate: 60 }, now).level === 'low', 'plenty of time → low risk');
    ok(lib.delayAlerts([{ id: 'a', title: 'x', deadline: now - 1 }, { id: 'b', title: 'y', deadline: now + 30 * 864e5 }], now).length === 1, 'delay alerts list');
    const fc = lib.forecast(10, [now - 864e5, now - 2 * 864e5, now - 3 * 864e5, now - 4 * 864e5, now - 5 * 864e5, now - 6 * 864e5, now - 7 * 864e5], now);
    ok(fc.perDay === 0.5 && fc.days === 20, 'throughput forecast');
    const mins = lib.extractMinutes('أحمد: سأنهي صفحة الدخول غداً\nسارة: اتفقنا على استخدام React\nأحمد: متى نطلق النسخة؟\n@u1 يجب مراجعة PR 9');
    ok(mins.decisions.length === 1 && mins.actions.length === 2 && mins.actions[0].owner === 'أحمد' && mins.actions[0].due === 'غداً' && mins.actions[1].owner === 'u1' && mins.questions.length === 1 && mins.speakers['أحمد'] === 2, 'extractive minutes: decisions, actions (+owner, due), questions');
    const md = lib.minutesMarkdown({ title: 'T', decisions: ['d'], actions: [{ text: 'a|b', owner: 'x', due: '' }] });
    ok(/## القرارات\n- ✅ d/.test(md) && /\| a\\\|b \| @x \| — \|/.test(md), 'minutes markdown');
    ok(lib.similarIssues({ number: 1, title: 'login crash on submit' }, gh.state.issues)[0].issue.number === 3, 'similar solved issues');
    ok(lib.busFactor({ a: 90, b: 5, c: 5 }) === 1 && lib.busFactor({ a: 30, b: 30, c: 40 }) === 2, 'bus factor');
    ok(lib.coachInsights({ stats: { a: { commits: 50 }, b: { commits: 2 } } }).some(i => /الحافلة/.test(i.title)), 'coach flags bus factor');

    section('Pure: analytics');
    const lcov = lib.parseLcov('SF:src/a.js\nDA:1,1\nDA:2,0\nLF:2\nLH:1\nFNF:1\nFNH:1\nBRF:0\nBRH:0\nend_of_record\nSF:src/b.js\nLF:4\nLH:4\nend_of_record\n');
    ok(lcov.total.lines === 83.3 && lcov.files[0].path === 'src/a.js' && lcov.files[0].uncovered[0] === 2, 'lcov parsing (sorted by coverage)');
    const sum = lib.parseCoverageSummary({ total: {}, 'src/x.js': { lines: { covered: 1, total: 4 }, functions: { covered: 1, total: 1 }, branches: { covered: 0, total: 2 } } });
    ok(sum.total.lines === 25 && sum.total.branches === 0, 'istanbul summary parsing');
    const hc = lib.heuristicCoverage(files);
    ok(hc.rows.find(r => r.path === 'utils.js').tested && !hc.rows.find(r => r.path === 'app.js').tested && hc.tests === 1, 'heuristic coverage from test imports');
    const sec = lib.securityScan(files);
    ok(sec.some(f => f.rule === 'eval') && sec.some(f => f.rule === 'hardcoded-pass') && sec.some(f => f.rule === 'blank-target'), 'security scan findings');
    const perf = lib.perfScan(files);
    ok(perf.some(f => f.rule === 'await-in-loop') && perf.some(f => f.rule === 'blocking-script') && perf.some(f => f.rule === 'no-lazy-img'), 'performance scan findings');
    ok(lib.scanScore([{ severity: 'high' }, { severity: 'low' }]) === 83, 'scan score');
    const pm = lib.projectMetrics(files);
    ok(pm.files === 5 && pm.tests === 1 && pm.langs.js > 0 && pm.largest.path, 'project metrics');
    const cm = lib.compareMetrics({ tests: 5, complexity: 2 }, { tests: 2, complexity: 1 });
    ok(cm.find(r => r.key === 'tests').better === 'a' && cm.find(r => r.key === 'complexity').better === 'b', 'comparison picks the better side per metric');
    const bs = lib.bugStats(gh.state.issues.filter(i => i.labels.some(l => l.name === 'bug')));
    ok(bs.total === 2 && bs.open === 1 && bs.mttrDays === 5, 'bug stats + MTTR');
    ok(lib.groupErrors([{ message: 'x at 12' }, { message: 'x at 99' }, { message: 'y' }])[0].n === 2, 'recurring errors grouped');

    section('Pure: growth');
    ok(lib.sentiment('شكراً، ممتاز يعمل الآن 👍').label === 'positive' && lib.sentiment('ما زال لا يعمل!! خطأ مرة أخرى').frustration && lib.sentiment('the build works').label === 'positive', 'sentiment (Arabic + English, frustration)');
    ok(lib.sentiment('ليس جيد').label === 'negative', 'negation flips polarity');
    const pp = lib.pathProgress(lib.LEARNING_PATHS.frontend, { text: 'html semantic css flex grid', manual: { js: true } });
    ok(pp.done === 3 && pp.next.id === 'async' && pp.pct === 38, 'learning path progress (auto + manual)');
    ok(lib.learnDelta({ JS: 10 }, { JS: 25, Py: 5 })[0].gain === 15, 'learning delta');
    const rp = lib.recommendProjects([{ name: 'Python', level: 'مبتدئ' }]);
    ok(rp.length && rp[0].lang === 'Python' && rp[0].level === 'متوسط', 'project recommendations level up');
    const cmpAvg = lib.compareToAverage({ sent: 30, activeMin: 60 });
    ok(cmpAvg.find(r => r.key === 'sent').verdict === 'above' && cmpAvg.find(r => r.key === 'activeMin').verdict === 'below', 'comparison with the average');
    ok(lib.productivityTips({ hours: [5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 1], doing: 5, overdue: 2 }).length >= 4, 'productivity tips');
    const svg = lib.certificateSVG({ name: '<Nader>', title: 'Frontend', date: 'today', id: 'C1', hash: 'abc' });
    ok(/^<svg/.test(svg) && /&lt;Nader&gt;/.test(svg), 'certificate SVG (escaped)');

    section('Pure: reports');
    const g = lib.collabGraph([{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }, { from: 'a', to: 'c' }], ['a', 'b', 'c', 'd']);
    ok(g.edges[0].n === 2 && g.hub === 'a' && g.isolated[0] === 'd' && g.density === 33, 'collaboration graph');
    ok(/<svg/.test(lib.collabSVG(g)) && (lib.collabSVG(g).match(/<line/g) || []).length === 2, 'collaboration SVG');
    const bd = lib.burndown([{ created: now - 5 * 864e5, closed: now - 864e5 }, { created: now - 3 * 864e5, closed: null }], 7, now);
    ok(bd[bd.length - 1].remaining === 1 && bd[bd.length - 4].remaining === 2, 'burndown');
    const ps = lib.progressSummary([{ created: 1, closed: 2 }, { created: 1, closed: null }], [{ title: 'v1', open: 1, closed: 1, due: new Date(now - 864e5).toISOString() }], now);
    ok(ps.pct === 50 && ps.milestones[0].late, 'progress + late milestone');
    const risks = lib.riskAssessment({ overdue: 3, busFactor: 1, members: 3, testRatio: 0, secScore: 40 });
    ok(risks[0].score >= risks[risks.length - 1].score && risks.some(r => r.id === 'bus') && risks.some(r => r.id === 'security'), 'risk register sorted by score');
    const it = lib.invoiceTotals([{ desc: 'dev', qty: 2.5, rate: 40 }, { desc: 'x', qty: 1, rate: 10 }], { tax: 19, discount: 10 });
    ok(it.subtotal === 110 && it.discount === 10 && it.tax === 19 && it.total === 119, 'invoice totals (discount, tax)');
    ok(/INV-2026-0001/.test(lib.invoiceHTML({ number: 'INV-2026-0001', lines: [{ desc: '<x>', qty: 1, rate: 1 }], currency: 'TND' })) && /&lt;x&gt;/.test(lib.invoiceHTML({ number: 'n', lines: [{ desc: '<x>', qty: 1, rate: 1 }] })), 'invoice HTML (escaped)');
    ok(lib.nextInvoiceNumber([{ number: 'INV-2026-0007' }], Date.UTC(2026, 5, 1)) === 'INV-2026-0008', 'invoice numbering');

    section('Flows (GitHub): team, roles, rules');
    const t0 = await app.tmCreateTeam({ name: 'Alpha', description: 'd' });
    ok(t0 && gh.state.contents.has('.oxteam/team.json') && JSON.parse(gh.state.contents.get('.oxteam/team.json').content).name === 'Alpha', 'team created + pushed to .oxteam/team.json');
    await app.tmInviteMember('u1', 'editor', 'frontend, css');
    ok(gh.state.invitations.some(i => i.invitee.login === 'u1') && app.tmTeam().members.some(m => m.login === 'u1' && m.skills.includes('css')), 'invite member → GitHub collaborator invitation');
    await app.tmAddRule('src/core/**', ['u1'], 'core');
    ok(app.tmTeam().rules.length === 1, 'file rule saved');
    const link = await app.tmInviteLink('viewer', 3);
    ok(/#oxteam=/.test(link) && lib.decodeInvite(link.split('#oxteam=')[1]).role === 'viewer', 'invite link');
    confirms.length = 0;
    await app.tmRemoveMember('u1');
    if (!confirms.length || confirms[0][1] !== '') console.log('confirms:', JSON.stringify(confirms), app.tmTeam().members.map(m => m.login));
    ok(confirms.length && confirms[0][1] === '' && !/undefined/.test(confirms[0].join()), 'askConfirm called with (title, message)');

    section('Flows: write guard (read-only rules + live locks)');
    const login0 = app._tmLogin;
    app._tmLogin = 'u2';
    const tm = app.tmTeam(); tm.members.push({ login: 'u2', role: 'editor' }); tm.rules = [{ pattern: 'src/core/**', allow: ['u1'] }];
    await app.tmSaveTeam(tm, 'x', { push: false });
    app.writeProjectFile('src/core/a.js', 'v1', 'team');
    app._typingInStudio = true;
    files.set('src/core/a.js', { content: 'hacked' });
    app._typingInStudio = false;
    ok(files.get('src/core/a.js').content === 'v1', 'edit to a read-only path reverted');
    app.writeProjectFile('src/core/a.js', 'from-github', 'github');
    ok(files.get('src/core/a.js').content === 'from-github', 'sync reasons (github) pass the guard');
    app.writeProjectFile('src/core/new.js', 'x', 'ai');
    ok(!files.has('src/core/new.js'), 'new file in a read-only folder blocked');
    app.writeProjectFile('src/free.js', 'ok', 'ai');
    ok(files.get('src/free.js').content === 'ok', 'other paths writable');
    app._tmLogin = login0; app.tmSyncRules();
    app.writeProjectFile('src/core/a.js', 'owner-edit', 'edit');
    ok(files.get('src/core/a.js').content === 'owner-edit', 'owner unaffected after rules resync');

    section('Flows: live session (CRDT over BroadcastChannel)');
    w.__bcSent = [];
    app.tmLiveStart({ room: 'r1', name: 'Nader' });
    files.set('utils.js', { content: 'export const add = (a, b) => a + b;\n// live\n' });
    ok(app._teamLive && w.__bcSent.some(m => (m.t === 'file' || m.t === 'op') && m.path === 'utils.js'), 'local write → CRDT message to peers (onProjectFileWrite hook)');
    const peerSite = 'peer1';
    const peerDoc = lib.RGA.fromSnapshot(peerSite, app._teamLive.docs.get('utils.js').snapshot());
    const pops = peerDoc.localReplace(peerDoc.text() + '// from peer\n');
    const bc = w.__bc.find(b => !b.closed && b.onmessage);
    bc.onmessage({ data: { mid: 'm1', t: 'hello', from: peerSite, name: 'Sara', room: 'r1' } });
    bc.onmessage({ data: { mid: 'm2', t: 'op', from: peerSite, path: 'utils.js', ops: pops, room: 'r1' } });
    await wait(5);
    ok(/from peer/.test(files.get('utils.js').content), 'remote ops applied to the project');
    bc.onmessage({ data: { mid: 'm3', t: 'lock', from: peerSite, path: 'utils.js', on: true, room: 'r1' } });
    app._typingInStudio = true; files.set('utils.js', { content: 'overwrite' }); app._typingInStudio = false;
    ok(/from peer/.test(files.get('utils.js').content), 'file locked by a peer cannot be edited');
    app.tmLiveStop(true);
    ok(!app._teamLive, 'session stopped');

    section('Flows (GitHub): channels, polls, surveys, proposals, rewards');
    const ch = await app.tmCreateChannel('general', 'عام');
    ok(ch && gh.state.issues.some(i => i.labels.some(l => l.name === 'ox-channel')), 'channel = issue labelled ox-channel');
    const game0 = JSON.parse(w.localStorage.getItem('ox_team_game_v1') || '{"days":{}}');
    const chat0 = Object.values(game0.days).reduce((n, d) => n + (d.chat || 0), 0);
    aiText = () => 'أنا OX-AI 👋';
    await app.tmSend(ch.id, 'مرحبا @ai كيف حالك؟');
    await wait(30);
    const msgs = await app.tmMessages(ch.id);
    ok(msgs.length >= 2 && msgs.some(m => m.ai && /OX-AI/.test(m.body)), '@ai mention → AI teammate replies in the channel');
    const game1 = JSON.parse(w.localStorage.getItem('ox_team_game_v1'));
    ok(Object.values(game1.days).reduce((n, d) => n + (d.chat || 0), 0) > chat0, 'chat counts toward game quests');
    const poll = await app.tmCreatePoll({ q: 'أي إطار؟', options: ['React', 'Vue'] });
    await app.tmVote(poll.id, [1]);
    const polls = await app.tmPollList();
    const pl = polls.find(p => String(p.id) === String(poll.id));
    ok(pl && lib.tallyPoll(pl.options, pl.votes).counts[1] === 1, 'poll vote recorded as a marker comment');
    const sv = await app.tmCreateSurvey({ title: 'رضا', questions: app.tmParseSurvey('اللغة | JS | Py\nالتقييم *\nملاحظات') });
    await app.tmAnswerSurvey(sv.id, [0, 4, 'جيد']);
    const svl = (await app.tmSurveyList()).find(s => String(s.id) === String(sv.id));
    ok(svl && svl.answers.length === 1 && svl.questions[1].type === 'rating', 'survey answers');
    const prop = await app.tmPropose({ title: 'نعتمد TypeScript', quorum: 1 });
    await app.tmVoteProposal(prop.id, 'up');
    const tasks0 = (app.tasks || []).length;
    const outc = await app.tmCloseProposal(prop.id);
    ok(outc === 'accepted' && (app.tasks || []).length === tasks0 + 1 && gh.state.issues.find(i => i.number === prop.id).state === 'closed', 'proposal accepted by reactions → closed + task created');
    await app.tmGiveReward('u1', 'kudos', 'شكراً');
    ok((app.tmTeam().rewards || []).some(r => r.login === 'u1'), 'reward stored in team.rewards');
    await app.tmAddEvent({ title: 'Demo day', start: '2026-10-30T10:00' });
    await app.tmExportICS();
    ok(downloads.some(x => /\.ics$/.test(x.name)), 'calendar → .ics download');

    section('Flows (GitHub): snippets with limits + tracking');
    const snip = await app.tmCreateSnippet({ code: 'console.log(1)', name: 'a.js', hours: 1, maxViews: 1, track: true });
    ok(snip && snip.kind === 'g' && /#oxsnip=g:/.test(snip.url), 'snippet stored as a gist link');
    app._tmLogin = 'stranger';
    const v1 = await app.tmOpenSnip('#' + snip.url.split('#')[1]);
    ok(v1 && v1.code === 'console.log(1)', 'first view allowed');
    const v2 = await app.tmOpenSnip('#' + snip.url.split('#')[1]);
    ok(v2 && v2.error === 'limit', 'view limit enforced');
    app._tmLogin = login0;
    const psnip = await app.tmCreateSnippet({ code: 'secret()', name: 'b.js', password: 'pw', hours: 0, maxViews: 0, track: false });
    app._tmSnipPw = 'pw';
    const pv = await app.tmOpenSnip('#' + psnip.url.split('#')[1]);
    ok(pv && pv.code === 'secret()' && !JSON.stringify([...gh.state.gists.values()].pop()).includes('secret()'), 'password snippet encrypted at rest');

    section('Flows: contest (sandbox stub), meetings, assignment, reports');
    app.createRunSandbox = () => ({ start(script, cb) { const m = { results: [] }; try { new Function('postMessage', 'performance', script)((x) => cb(x), { now: () => 0 }); } catch (e) { cb({ type: 'error', message: e.message }); } }, stop() {} });
    const run = await app.tmRunChallenge('sumdigits', 'function solve(n){return String(n).split("").reduce((a,b)=>a+ +b,0)}');
    ok(run.passed === run.total && run.score >= 400, 'challenge solved in the sandbox');
    await app.tmSubmitScore(run);
    const board = await app.tmContestBoard('sumdigits');
    ok(board.length === 1 && board[0].score === run.score, 'contest leaderboard from score markers');
    const meet = await app.tmSummarizeMeeting({ text: 'أحمد: سأكتب الاختبارات غداً\nسارة: اتفقنا على الإطلاق يوم الجمعة', title: 'تخطيط', offline: true });
    ok(meet && meet.actions.length === 1 && meet.decisions.length === 1 && /محضر اجتماع/.test(meet.md), 'meeting minutes (offline)');
    const tasksBefore = (app.tasks || []).length;
    app.tmMinutesToTasks(meet.id);
    ok((app.tasks || []).length === tasksBefore + 1, 'minutes → tasks');
    aiText = () => JSON.stringify({ summary: 'ملخص', decisions: ['d1'], actions: [{ text: 'a1', owner: 'u1', due: '' }], questions: [], attendees: ['أحمد'] });
    const meet2 = await app.tmSummarizeMeeting({ text: 'أحمد: نص', title: 'AI' });
    ok(meet2.summary === 'ملخص' && meet2.actions[0].owner === 'u1', 'meeting summary by AI');
    const tm2 = app.tmTeam(); tm2.members = [{ login: 'nader', role: 'owner', skills: ['backend'] }, { login: 'u1', role: 'editor', skills: ['frontend', 'css', 'ui'] }]; await app.tmSaveTeam(tm2, 'x', { push: false });
    await app.tmLoad('ai', 'assign');
    ok(app._tmPlan && app._tmPlan.find(p => /dark mode/.test(p.title)).login === 'u1', 'assignment plan from GitHub issues + skills');
    await app.tmApplyPlan(true);
    ok(gh.state.issues.find(i => i.number === 2).assignee.login === 'u1', 'plan applied as GitHub assignees');
    await app.tmLoad('reports', 'team');
    ok(app._tmLastReport && /تقرير الفريق/.test(app._tmLastReport.md) && /@nader/.test(app._tmLastReport.md), 'team report markdown');
    app.tmSaveLastReport();
    ok([...files.keys()].some(k => /^reports\/team-report-/.test(k)), 'report saved to the project');
    await app.tmLoad('reports', 'client');
    ok(!/@nader|@u1/.test(app._tmLastReport.md) && /تقرير تقدم المشروع/.test(app._tmLastReport.md), 'client report hides internal details');
    app.tmPrintClientReport();
    ok(/<html lang="ar"/.test(app._printed), 'client report printable');
    app.tasks = (app.tasks || []).concat({ id: 'tinv', title: 'Build login', status: 'done', created: now - 864e5, done: now - 3600e3, spent: 2.5 * 36e5, estimate: 120 });
    app._tmInv = null;
    await app.tmLoad('reports', 'invoice');
    ok(app._tmInv.lines.some(l => l.desc === 'Build login' && l.qty === 2.5), 'invoice lines from tracked time');
    app.tmSaveInvoice();
    ok(app.tmInvoices()[0].number === app._tmInv.number, 'invoice saved');
    app.tmDownloadInvoice();
    ok(downloads.some(x => /^INV-\d{4}-\d{4}\.html$/.test(x.name)), 'invoice downloaded');

    section('Flows: growth');
    w.localStorage.setItem('ox_team_path_v1', JSON.stringify({ path: 'devops', manual: { git: true, gh: true, ci: true, docker: true, k8s: true, observe: true }, started: now }));
    const cert = await app.tmIssueCertificate();
    ok(cert && cert.hash.length === 64 && app.tmCertificates().length === 1, 'certificate issued on path completion (SHA-256)');
    app.tmDownloadCert(cert.id);
    ok(downloads.some(x => /^certificate-.*\.svg$/.test(x.name)), 'certificate SVG download');
    ok(/إنجازاتي/.test(app.tmAchievementText()), 'achievements share text');
    await app.tmLoad('analytics', 'coverage');
    files.set('coverage/lcov.info', { content: 'SF:utils.js\nDA:1,1\nDA:2,0\nLF:2\nLH:1\nend_of_record\n' });
    await app.tmLoad('analytics', 'coverage');
    ok(/50%/.test(d.getElementById('tmx-sec').textContent) && /lcov\.info/.test(d.getElementById('tmx-sec').textContent), 'coverage reads lcov.info from the project');
    await app.tmLoad('analytics', 'compare');
    app.tmSaveSnapshot('قبل');
    await app.tmCompareSnap(app.tmSnapshots()[0].id);
    ok(/قبل/.test(d.getElementById('tmx-sec').textContent), 'compare with a saved snapshot');
    await app.tmCompareRepo('acme/lib');
    ok(app._tmCmp && app._tmCmp.metrics.tests === 1, 'compare with a GitHub repo');

    section('Flows: local fallback (no GitHub)');
    app.settings.githubToken = '';
    const lch = await app.tmCreateChannel('محلي', '');
    await app.tmSend(lch.id, 'رسالة محلية');
    ok((await app.tmMessages(lch.id)).some(m => m.body === 'رسالة محلية'), 'local channel messages');
    const lsn = await app.tmCreateSnippet({ code: 'let a = 1;', name: 'a.js', hours: 1 });
    ok(lsn.kind === 'l', 'local snippet link (self-contained)');
    const lv = await app.tmOpenSnip('#' + lsn.url.split('#')[1]);
    ok(lv && lv.code === 'let a = 1;', 'local snippet opens');
    const lp = await app.tmCreatePoll({ q: 'س', options: ['أ', 'ب'] });
    await app.tmVote(lp.id, [0]);
    const lpl = (await app.tmPollList()).find(p => p.id === lp.id);
    ok(lib.tallyPoll(lpl.options, lpl.votes).counts[0] === 1, 'local poll');
    const before = JSON.parse(w.localStorage.getItem('ox_team_game_v1'));
    const d0 = Object.keys(before.days).sort().pop();
    ok((before.days[d0].vote || 0) >= 1 && (before.days[d0].share || 0) >= 1, 'votes + shares count toward quests');

    section('Done');
    if (errors.length) console.log(errors.join('\n'));
    ok(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
    process.exitCode = process.exitCode || 0;
    setTimeout(() => process.exit(process.exitCode), 50);
})().catch((e) => { console.error('❌ FATAL', e); process.exitCode = 1; setTimeout(() => process.exit(1), 50); });
