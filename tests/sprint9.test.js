/* Sprint 9 — GitHub/DevOps (ideas #411-#530) + the lazy GitHub Pro chunk. */
'use strict';
require('fake-indexeddb/auto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pathToFileURL } = require('url');
const { loadApp, mockOpenRouter, ok, wait, section, gzipBudgetKB } = require('./helpers');
const { createGitHub } = require('./gh-mock');

const ROOT = path.join(__dirname, '..');
function exposeGlobals(w) {
    const names = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
        'KeyboardEvent', 'MouseEvent', 'Event', 'CustomEvent', 'localStorage', 'location', 'history', 'innerWidth', 'innerHeight', 'devicePixelRatio'];
    for (const n of names) Object.defineProperty(globalThis, n, { value: w[n], configurable: true, writable: true });
}

let W = null;
(async () => {
    const GH = createGitHub();
    const or = mockOpenRouter(async () => ({ text: '## ملخص\nتقرير مصقول' }));
    const fetchAll = async (url, opts) => (String(url).includes('openrouter.ai') ? or.fetchImpl(url, opts) : GH.handle(url, opts));
    const { w, d, app, errors } = loadApp({ fetchImpl: fetchAll, indexedDB: globalThis.indexedDB });
    W = w;
    exposeGlobals(w);
    globalThis.fetch = fetchAll; // chunk code runs in the Node realm
    const imported = [];
    app.importModule = (url) => { imported.push(url); return import(pathToFileURL(path.join(ROOT, url)).href); };
    const downloads = [];
    app.downloadBlob = (blob, name) => { downloads.push({ blob, name }); };
    app.copyToClipboard = function (text) { this._copied = text; return true; };
    let dialogValues = {};
    const dialogs = [];
    app.showDialog = async (o) => { dialogs.push(o); const v = Object.fromEntries((o.fields || []).map(f => [f.id, f.value])); Object.assign(v, dialogValues); dialogValues = {}; const b = (o.buttons || [])[0]; if (b && b.validate) { const err = b.validate(v); if (err) return null; } return { button: 'ok', values: v }; };
    let confirmAnswer = true;
    app.askConfirm = async () => confirmAnswer;
    let textAnswer = null;
    app.askText = async (title, value, opts = {}) => { const v = textAnswer != null ? textAnswer : value; textAnswer = null; if (opts.validate && opts.validate(v)) return null; return v; };
    const reviews = [];
    app.openCommitReview = async (p, content, opts = {}) => { reviews.push({ path: p, content, opts }); return true; };
    const toasts = [];
    const _toast = app.showToast.bind(app);
    app.showToast = (m, t) => { toasts.push([String(m), t]); if (process.env.DBG) console.log('   toast:', String(m).slice(0, 200)); };
    app.settings.githubToken = 'ghp_test';
    app.settings.githubOwner = 'o'; app.settings.githubRepo = 'r'; app.settings.githubBranch = 'main';
    app.settings.apiKey = 'sk-test';
    const body = () => d.getElementById('gh-hub-body');
    const $ = (id) => d.getElementById(id);
    const lastReq = (re, method) => [...GH.log].reverse().find(l => re.test(l.path) && (!method || l.method === method));
    await wait(50);

    // ------------------------------------------------------------------ repository history used by the git tests
    const c1 = GH.commit('o/r', 'main', { 'a.txt': 'one\ntwo\nthree\n', 'b.txt': 'bee\n', 'src/app.js': 'line1\nline2\nline3\n', 'package.json': '{"name":"demo","dependencies":{"react":"^18.2.0"},"devDependencies":{"eslint":"^9.0.0"}}\n' }, 'init');
    const c2 = GH.commit('o/r', 'main', { 'a.txt': 'ONE\ntwo\nthree\n' }, 'feat: capitalize a');
    const c3 = GH.commit('o/r', 'main', { 'c.txt': 'sea\n' }, 'feat: add c (#3)');
    GH.repos.get('o/r').refs.set('feature', c1);
    const f1 = GH.commit('o/r', 'feature', { 'b.txt': 'BEE\n' }, 'feat: b upper');
    GH.repos.get('o/r').tags.set('v1.0.0', c2);
    GH.commit('o/other', 'main', { 'a.txt': 'different\n', 'b.txt': 'bee\n', 'only-other.md': '# other\n' }, 'init other');
    const files = (p) => Object.fromEntries([...GH.filesOf(GH.repos.get('o/r').refs.get(p))].map(([k, s]) => [k, GH.blobs.get(s).toString()]));

    // ------------------------------------------------------------------
    section('Lazy GitHub Pro chunk + bundle budget');
    const build = w.OX_BUILD;
    ok(build && /^assets\/studio\/github-\w+\.mjs$/.test(build.chunks.github) && fs.existsSync(path.join(ROOT, build.chunks.github)), 'OX_BUILD.chunks.github points to the hashed chunk on disk');
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/studio/manifest.json'), 'utf8'));
    ok(manifest.chunks.github === build.chunks.github, 'manifest.json lists the GitHub chunk');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const gz = zlib.gzipSync(html, { level: 9 }).length / 1024;
    ok(gz < gzipBudgetKB, `main page stays under the ${gzipBudgetKB} KB gzip budget (${gz.toFixed(1)} KB)`);
    const csp = html.match(/connect-src[^;]*/)[0];
    ok(['uploads.github.com', 'codeload.github.com', 'gitlab.com', 'api.bitbucket.org', 'registry.npmjs.org', '*.blob.core.windows.net'].every(h => csp.includes(h)), 'CSP connect-src allows release uploads, GitLab/Bitbucket import and artifact downloads');
    ok(!/tweetnacl|blake2b/.test(html), 'crypto libraries are not in the main bundle');
    ok(app.GH_TABS.length === 18 && ['history', 'search', 'planning', 'ops', 'analytics', 'repo', 'move', 'clone', 'community', 'gists', 'org'].every(t => app.isGhxTab(t)), '11 new hub tabs registered (18 total)');
    const stubs = app.lazyGHXMethods();
    ok(stubs.length >= 20 && stubs.every(n => typeof app[n] === 'function' && app[n].__oxLazy === 'github'), `GitHub Pro entry points are lazy stubs before first use (${stubs.length})`);
    ok(!$('ox-gh-chunk-css') && !imported.length, 'nothing loaded until a new tab is used');
    await app.openGitHubHub('history');
    await wait(30);
    ok(imported.includes(build.chunks.github), 'opening a new tab imports the chunk');
    ok(stubs.every(n => !app[n].__oxLazy), 'chunk install replaced every stub');
    ok($('ox-gh-chunk-css') && /\.ghx-subnav/.test($('ox-gh-chunk-css').textContent), 'chunk injects its stylesheet once');
    ok(d.querySelectorAll('.gh-tab').length === 18 && d.querySelector('.gh-tab.active').textContent.includes('السجل'), 'hub shows 18 tabs with the new one active');
    ok(body().querySelector('.ghx-subnav [data-ghx-sec="timeline"].active'), 'section sub-navigation rendered');
    const mod = await import(pathToFileURL(path.join(ROOT, build.chunks.github)).href);
    const L = mod.lib;
    let threw = false;
    try { await app.ghx('nope'); } catch (e) { threw = /unknown github method/.test(e.message); }
    ok(threw, 'app.ghx() rejects unknown methods');

    // ------------------------------------------------------------------
    section('Pure helpers');
    ok(JSON.stringify(L.parseRepoInput('https://github.com/a/b/tree/dev/src')) === JSON.stringify({ host: 'github.com', owner: 'a', repo: 'b', path: 'a/b', branch: 'dev' }) && L.parseRepoInput('git@github.com:a/b.git').repo === 'b' && L.parseRepoInput('a/b.git').repo === 'b', 'parseRepoInput: URL with branch, SSH, owner/repo');
    const gl = L.parseRepoInput('https://gitlab.com/grp/sub/proj/-/tree/main');
    ok(gl.host === 'gitlab.com' && gl.path === 'grp/sub/proj' && gl.branch === 'main' && L.parseRepoInput('bitbucket.org/ws/bb/src/dev').branch === 'dev' && L.parseRepoInput('https://example.com/x') === null, 'parseRepoInput: GitLab subgroups, Bitbucket, rejects other hosts');
    ok(L.isValidRefName('feature/x-1') && !L.isValidRefName('a..b') && !L.isValidRefName('x.lock') && !L.isValidRefName('-x') && !L.isValidRefName('a b'), 'git ref-name rules');
    ok(L.isValidRepoName('my.repo_1') && !L.isValidRepoName('..') && !L.isValidRepoName('a/b'), 'repo-name rules');
    ok(L.issueRefs('fixes #12, closes #34 and GH-5 #12').join() === '12,34,5', 'issue references extracted and deduped');
    ok(L.toCSV([['a', 'b'], ['x,y', 'say "hi"']]) === 'a,b\n"x,y","say ""hi"""\n', 'CSV escaping');
    ok(/<svg class="ghx-chart"/.test(L.barsSVG([1, 5, 3], { labels: ['a', 'b', 'c'], highlightFrom: 2 })) && (L.barsSVG([1, 5, 3]).match(/<rect/g) || []).length === 3, 'SVG bar chart');
    ok(L.fmtBytes(1536) === '1.5 KB' || /1\.5\s?KB/.test(L.fmtBytes(1536)), 'fmtBytes');
    const cp = L.comparePeriods([1, 1, 1, 1, 2, 2, 2, 2], 4);
    ok(cp.current === 8 && cp.previous === 4 && cp.change === 100, 'compare two periods (#462)');
    const fc = L.forecast([1, 2, 3, 4, 5, 6, 7, 8], 4);
    ok(fc.trend === 'up' && fc.next.length === 4 && fc.next[0] > 8 - 1, `activity forecast (#463): ${fc.next.join(',')}`);
    const ct = L.contributorTotals([{ author: { login: 'a' }, total: 3, weeks: [{ a: 5, d: 1, c: 3 }] }]);
    ok(ct[0].login === 'a' && ct[0].additions === 5 && ct[0].commits === 3, 'contributor totals (#458)');
    const tf = L.topFiles([{ files: [{ filename: 'x', changes: 3 }, { filename: 'y', changes: 1 }] }, { files: [{ filename: 'x', changes: 2 }] }]);
    ok(tf[0].path === 'x' || tf[0].file === 'x' || tf[0][0] === 'x', 'most-changed files (#466)');
    const wr = L.weeklyReport({ repo: 'o/r', commits: [{ sha: 'abc1234', commit: { message: 'feat: a', author: { name: 'N', date: new Date().toISOString() } }, author: { login: 'n' } }], prs: [{ number: 1, title: 'P', merged_at: new Date().toISOString(), user: { login: 'n' } }], issues: [{ number: 2, title: 'I', state: 'closed', closed_at: new Date().toISOString(), created_at: new Date().toISOString(), user: { login: 'n' } }], since: new Date(Date.now() - 7 * 864e5).toISOString() });
    ok(/o\/r/.test(wr.markdown) && /feat: a/.test(wr.markdown), 'weekly report markdown (#468)');
    ok(L.trafficSummary({ count: 3, uniques: 2, views: [{ timestamp: '2026-01-01T00:00:00Z', count: 3 }] }, 'views').series[0].day === '2026-01-01', 'traffic summary (#464)');
    ok(L.packageJsonDeps('{"dependencies":{"a":"1"},"devDependencies":{"b":"2"}}').length === 2, 'package.json dependencies (#467)');
    const ub = L.usageByWorkflow([{ name: 'CI', status: 'completed', conclusion: 'failure', run_started_at: new Date(Date.now() - 120000).toISOString(), updated_at: new Date().toISOString() }]);
    ok(ub.rows[0].name === 'CI' && ub.rows[0].failures === 1 && ub.rows[0].minutes >= 2, 'Actions usage per workflow (#450)');
    const lay = L.layoutGraph([{ sha: 'c', parents: [{ sha: 'b' }, { sha: 'x' }] }, { sha: 'x', parents: [{ sha: 'a' }] }, { sha: 'b', parents: [{ sha: 'a' }] }, { sha: 'a', parents: [] }]);
    ok(lay && (lay.rows || lay.nodes || lay).length === 4 && (lay.lanes || lay.width || 2) >= 2, 'network-graph lane layout (#430)');
    ok(/repo:o\/r/.test(L.buildSearchQuery('code', 'hello', 'this', { owner: 'o', repo: 'r' })) && /is:pr/.test(L.buildSearchQuery('prs', 'x', 'this', { owner: 'o', repo: 'r' })), 'search query builder (#431-#433)');
    ok(L.highlightFragment('a <b> hello', [{ indices: [6, 11] }]) === 'a &lt;b&gt; <mark>hello</mark>', 'search fragments escaped + matches highlighted');
    ok(L.boardColumn({ state: 'closed', labels: [] }) === 'done' && L.boardColumn({ state: 'open', labels: [{ name: 'in progress' }] }) === 'doing' && L.boardColumn({ state: 'open', labels: [] }) === 'todo', 'Kanban column from issue state/labels (#436)');
    ok(/Closes #7/.test(L.withClosingRef('body', 7)) && L.withClosingRef('Fixes #7', 7) === 'Fixes #7', 'closing reference added once (#440)');
    ok(!/\u001b|##\[group\]/.test(L.cleanLog('\u001b[32mok\u001b[0m\n##[group]x')), 'Actions log cleaned (ANSI + group markers)');
    ok(L.isValidSecretName('API_KEY') && !L.isValidSecretName('GITHUB_TOKEN') && !L.isValidSecretName('1X') && !L.isValidSecretName('a-b'), 'secret-name rules (#447)');
    const pp = L.protectionPayload({ reviews: 2, checks: ['build'], linear: true });
    ok(pp.required_pull_request_reviews.required_approving_review_count === 2 && pp.required_status_checks.contexts[0] === 'build' && pp.required_linear_history === true && pp.restrictions === null, 'branch-protection payload (#471)');
    ok(L.isValidDomain('docs.example.com') && !L.isValidDomain('http://x') && !L.isValidDomain('-a.com'), 'custom domain validation (#524)');
    const dt = L.diffTrees(new Map([['a', '1'], ['b', '2'], ['c', '3']]), new Map([['a', '1'], ['b', 'X'], ['d', '4']]));
    ok(dt.changed.join() === 'b' && dt.onlyA.join() === 'c' && dt.onlyB.join() === 'd' && dt.same === 1, 'diff two repository trees (#511)');
    ok(JSON.stringify(L.retarget(['src/ui/a.js', 'src/ui/x/b.js'], 'src/ui', 'lib')) === JSON.stringify([{ from: 'src/ui/a.js', to: 'lib/a.js' }, { from: 'src/ui/x/b.js', to: 'lib/x/b.js' }]), 'paths re-targeted into a destination folder (#513)');
    ok(L.isTextPath('src/a.ts') && L.isTextPath('Dockerfile') && !L.isTextPath('logo.png'), 'text vs binary paths');
    const cc = L.cloneCommands('o', 'r', 'dev', 'main');
    ok(cc.https === 'git clone --branch dev https://github.com/o/r.git' && cc.ssh.includes('git@github.com:o/r.git') && cc.gh.startsWith('gh repo clone o/r') && /degit o\/r#dev/.test(cc.degit), 'clone commands for HTTPS/SSH/CLI/degit (#495 #496)');
    const dc = JSON.parse(L.devcontainerFor({ node: true, docker: true }, 'r'));
    ok(/javascript-node/.test(dc.image) && dc.postCreateCommand === 'npm install' && dc.features['ghcr.io/devcontainers/features/docker-in-docker:2'], 'devcontainer for the detected stack (#490)');
    ok(/MIT License[\s\S]*2026 Nader/.test(L.licenseText('mit', '2026', 'Nader')) && L.licenseText('gpl-3.0', '2026', 'x') === null && L.fillLicense('Copyright [yyyy] [name of copyright owner]', '2026', 'N') === 'Copyright 2026 N', 'license texts (#502)');
    ok(L.fundingYml({ github: 'a, b', ko_fi: 'k', custom: 'https://paypal.me/x' }) === 'github: [a, b]\nko_fi: k\ncustom: ["https://paypal.me/x"]\n', 'FUNDING.yml (#505)');
    ok(Object.keys(L.issueTemplates()).length === 3 && /pull_request|نوع التغيير/.test(L.PR_TEMPLATE), 'issue + PR templates (#506 #507)');
    ok(/\*\.js @a @org\/team/.test(L.codeownersText([{ pattern: '*.js', owners: 'a @org/team' }])), 'CODEOWNERS (#509)');
    ok(L.wikiFileName('دليل البدء: v2') === 'دليل-البدء-v2.md', 'wiki page file names keep Arabic (#526)');
    ok(L.snippetName('function hello() {}', 'javascript') === 'hello.js' && L.snippetName('<div></div>') === 'snippet.html', 'snippet file names (#479)');
    ok(JSON.stringify(L.gistPatch({ description: 'd', edits: [{ name: 'a.js', delete: true }, { name: 'b.js', content: 'x', rename: 'c.js' }] })) === JSON.stringify({ files: { 'a.js': null, 'b.js': { content: 'x', filename: 'c.js' } }, description: 'd' }), 'gist PATCH body (#478)');
    ok(/دفع 3 commit إلى main/.test(L.describeEvent({ type: 'PushEvent', payload: { ref: 'refs/heads/main', size: 3 } })) && L.roleOfPermissions({ push: true }) === 'push', 'activity descriptions + roles (#484 #486)');
    ok(L.assetUploadUrl('https://uploads.github.com/repos/o/r/releases/1/assets{?name,label}', 'my file.zip') === 'https://uploads.github.com/repos/o/r/releases/1/assets?name=my%20file.zip', 'release asset upload URL (#453)');

    // ------------------------------------------------------------------
    section('Crypto: sealed boxes (#447) + SSH keys (#500)');
    const C = await L.crypto();
    const kp = C.boxKeyPair();
    GH.KP.pub = kp.publicKey; GH.KP.sec = kp.secretKey;
    const sealed = C.sealedBox('s3cret ✓', kp.publicKey);
    ok(C.openSealedBox(sealed, kp.publicKey, kp.secretKey) === 's3cret ✓' && C.sealedBox('s3cret ✓', kp.publicKey) !== sealed, 'libsodium-compatible sealed box round-trips (ephemeral keys)');
    const key = await C.generateSSHKey('me@ox');
    const parsed = C.parseOpenSSHPrivate(key.privateKey);
    ok(/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA\S+ me@ox$/.test(key.publicKey) && /^-----BEGIN OPENSSH PRIVATE KEY-----\n/.test(key.privateKey) && parsed.comment === 'me@ox', 'OpenSSH Ed25519 key pair format');
    const msgBytes = new TextEncoder().encode('hello');
    ok(C.verifyDetached(msgBytes, C.signDetached(msgBytes, parsed.secret), parsed.pub), 'private key signs, public key verifies');
    ok(key.fingerprint === await C.fingerprintOfPublicLine(key.publicKey) && /^SHA256:[A-Za-z0-9+/]{43}$/.test(key.fingerprint), 'SHA256 fingerprint matches ssh-keygen format');

    // ------------------------------------------------------------------
    section('Git operations through the REST git-data API (#422-#427)');
    const ops = L.gitOps(app, '/repos/o/r');
    let r = await ops.cherryPick('feature', c3);
    ok(!r.empty && files('feature')['c.txt'] === 'sea\n' && files('feature')['b.txt'] === 'BEE\n' && files('feature')['a.txt'] === 'one\ntwo\nthree\n', 'cherry-pick applies only that commit\'s change (3-way via /merges)');
    ok(GH.commits.get(GH.repos.get('o/r').refs.get('feature')).parents[0] === f1 && ![...GH.repos.get('o/r').refs.keys()].some(k => k.startsWith('ox-tmp/')), 'linear result on the target branch; temp refs cleaned up');
    GH.commit('o/r', 'feature', { 'a.txt': 'uno\ntwo\nthree\n' }, 'conflicting change');
    const before = GH.repos.get('o/r').refs.get('feature');
    let conflict = null;
    try { await ops.cherryPick('feature', c2); } catch (e) { conflict = e; }
    ok(conflict && conflict.conflict === c2 && conflict.status === 409 && GH.repos.get('o/r').refs.get('feature') === before && ![...GH.repos.get('o/r').refs.keys()].some(k => k.startsWith('ox-tmp/')), 'conflicts abort cleanly (409, branch untouched)');
    r = await ops.revert('main', c3);
    ok(!files('main')['c.txt'] && files('main')['a.txt'] === 'ONE\ntwo\nthree\n' && /^Revert "feat: add c/.test(GH.commits.get(GH.repos.get('o/r').refs.get('main')).message), 'revert removes the commit\'s change with a Revert message (#427)');
    const mainHead = GH.repos.get('o/r').refs.get('main');
    const treeBefore = GH.commits.get(mainHead).tree;
    r = await ops.reword('main', c2, 'feat: capitalise a (reworded)');
    const chain = [];
    for (let s = GH.repos.get('o/r').refs.get('main'); s; s = GH.commits.get(s).parents[0]) chain.push(GH.commits.get(s));
    ok(r.rewritten === 3 && chain.some(c => c.message === 'feat: capitalise a (reworded)') && GH.commits.get(GH.repos.get('o/r').refs.get('main')).tree === treeBefore && chain[chain.length - 1].sha === c1, 'reword rewrites the message, keeps trees and older history (#426)');
    const x1 = GH.commit('o/r', 'main', { 'x.txt': 'x\n' }, 'add x');
    const y1 = GH.commit('o/r', 'main', { 'y.txt': 'y\n' }, 'add y');
    const t2 = GH.commits.get(y1).tree;
    r = await ops.reorder('main', [y1, x1]);
    const h = GH.repos.get('o/r').refs.get('main');
    ok(GH.commits.get(h).message === 'add x' && GH.commits.get(GH.commits.get(h).parents[0]).message === 'add y' && GH.commits.get(h).tree === t2, 'reorder replays commits in the new order with the same final tree (#425)');
    GH.repos.get('o/r').refs.set('topic', c1);
    GH.commit('o/r', 'topic', { 'b.txt': 'topic-bee\n' }, 'topic change');
    r = await ops.rebase('topic', 'main');
    ok(!r.upToDate && r.applied.length === 1 && files('topic')['b.txt'] === 'topic-bee\n' && files('topic')['x.txt'] === 'x\n' && GH.ancestors(GH.repos.get('o/r').refs.get('topic')).has(GH.repos.get('o/r').refs.get('main')), 'rebase replays the branch on top of main (#423)');
    const sha = await ops.commitFiles({ branch: 'docs', from: 'main', files: [{ path: 'docs/a.md', content: 'مرحبا ✓' }, { path: 'bin.dat', content: Buffer.from([0, 1, 2]).toString('base64'), encoding: 'base64' }, { path: 'b.txt', delete: true }], message: 'docs' });
    ok(sha && files('docs')['docs/a.md'] === 'مرحبا ✓' && !files('docs')['b.txt'] && GH.fileContent('o/r', 'docs', 'bin.dat').equals(Buffer.from([0, 1, 2])), 'multi-file commit (UTF-8, binary, delete) creating a new branch');

    // ------------------------------------------------------------------
    section('Every section of every new tab renders');
    const JS_ERR = /Cannot read|is not a function|is not defined|undefined|NaN|\[object Object\]/;
    const broken = [];
    let count = 0;
    for (const [tab, defs] of Object.entries(L.TAB_DEFS)) {
        for (const [sec] of defs) {
            app.ghView = null;
            await app.ghxLoad(tab, sec);
            await wait(5);
            count++;
            const el = body().querySelector(`.ghx-sec[data-ghx-tab="${tab}"][data-ghx-sec="${sec}"]`);
            const bad = !el ? 'not rendered' : el.querySelector('.gh-empty.bad') ? el.querySelector('.gh-empty.bad').textContent.trim().slice(0, 140) : JS_ERR.test(el.textContent) ? (el.textContent.match(new RegExp('.{0,60}(' + JS_ERR.source + ').{0,40}')) || [''])[0] : null;
            if (bad) broken.push(`${tab}/${sec}: ${bad}`);
        }
    }
    ok(count === 54 && broken.length === 0, `${count} sections render without errors` + (broken.length ? ' — ' + broken.join(' | ') : ''));

    require('./sprint9.flows')({ app, d, w, GH, L, C, ok, wait, section, body, $, lastReq, reviews, toasts, downloads, dialogs, setDialog: (v) => { dialogValues = v; }, setConfirm: (v) => { confirmAnswer = v; }, setText: (v) => { textAnswer = v; }, files, c1, c2, kp }).then(async () => {
        app.showToast = _toast;
        await wait(30);
        ok(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
        clearTimeout(app._ghxLiveTimer);
        w.close();
    }).catch(e => { console.error('❌ flows crashed:', e.message, String(e.stack).split('\n').slice(1, 4).join('\n').slice(0, 600)); process.exitCode = 1; w.close(); });
})().catch(e => { console.error('❌ test crashed:', e); process.exitCode = 1; if (W) W.close(); });
