/* Sprint 3 tests: diff engine, 3-way merge, conflict-aware commits, GitHub Hub (mocked REST API). */
const crypto = require('crypto');
const { loadApp, mockOpenRouter, ok, wait, section } = require('./helpers');

// ------------------------------------------------------------------ in-memory GitHub
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const repo = {
    files: new Map([
        ['src/app.js', 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\n'],
        ['README.md', '# Demo\n'],
        ['package.json', '{"name":"demo"}\n']
    ]),
    branches: new Map([['main', 'c0ffee1'], ['feature/x', 'beef002']]),
    pulls: [{ number: 7, title: 'Add feature X', state: 'open', draft: false, merged: false, mergeable: true, user: { login: 'nader' }, head: { ref: 'feature/x', sha: 'beef002' }, base: { ref: 'main' }, body: 'desc', commits: 2, additions: 10, deletions: 3, html_url: 'https://github.com/o/r/pull/7', updated_at: new Date().toISOString() }],
    issues: [{ number: 3, title: 'Bug: crash', state: 'open', user: { login: 'u1' }, labels: [{ name: 'bug', color: 'd73a4a' }], comments: 0, body: 'it crashes', html_url: 'x', updated_at: new Date().toISOString(), created_at: new Date().toISOString() },
             { number: 7, title: 'PR shows in issues', pull_request: {}, state: 'open', user: { login: 'nader' }, labels: [], comments: 0 }],
    releases: [{ tag_name: 'v1.2.3', name: 'v1.2.3', body: 'notes', html_url: 'x', published_at: new Date().toISOString() }],
    pages: null,
    log: []
};
const shaOf = (path) => sha1(path + ':' + repo.files.get(path));
const json = (obj, status = 200) => new Response(obj === null ? null : JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '4990', 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600) }
});

async function github(url, opts = {}) {
    const u = new URL(url);
    const method = (opts.method || 'GET').toUpperCase();
    const p = u.pathname.replace(/^\/repos\/o\/r/, '');
    const body = opts.body ? JSON.parse(opts.body) : null;
    repo.log.push({ method, path: p, body, auth: (opts.headers || {})['Authorization'] });
    let m;
    if (p === '' && method === 'GET') return json({ full_name: 'o/r', default_branch: 'main', private: false, stargazers_count: 5, forks_count: 1, open_issues_count: 2, size: 2048, pushed_at: new Date().toISOString(), description: 'demo' });
    if ((m = /^\/contents\/(.+)$/.exec(p))) {
        const path = decodeURIComponent(m[1]);
        if (method === 'GET') return repo.files.has(path) ? json({ sha: shaOf(path), encoding: 'base64', content: b64(repo.files.get(path)) }) : json({ message: 'Not Found' }, 404);
        if (method === 'PUT') {
            if (repo.files.has(path)) {
                if (!body.sha) return json({ message: '"sha" wasn\'t supplied.' }, 422);
                if (body.sha !== shaOf(path)) return json({ message: 'is at X but expected Y' }, 409);
            }
            repo.files.set(path, Buffer.from(body.content, 'base64').toString('utf8'));
            return json({ content: { sha: shaOf(path) }, commit: { sha: sha1('commit' + Date.now()) } }, 201);
        }
    }
    if (p === '/pulls' && method === 'GET') return json(repo.pulls.filter(x => u.searchParams.get('state') === 'all' || x.state === u.searchParams.get('state')));
    if (p === '/pulls' && method === 'POST') { const pr = { ...repo.pulls[0], number: 8, title: body.title, head: { ref: body.head, sha: 'beef002' }, base: { ref: body.base }, body: body.body }; repo.pulls.push(pr); return json(pr, 201); }
    if ((m = /^\/pulls\/(\d+)$/.exec(p))) { const pr = repo.pulls.find(x => x.number === +m[1]); if (method === 'PATCH') Object.assign(pr, body); return json(pr); }
    if (/^\/pulls\/\d+\/files$/.test(p)) return json([{ filename: 'src/x.js', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1,2 +1,2 @@\n-old\n+new\n ctx' }]);
    if ((m = /^\/pulls\/(\d+)\/merge$/.exec(p)) && method === 'PUT') { const pr = repo.pulls.find(x => x.number === +m[1]); pr.merged = true; pr.state = 'closed'; pr.merge_method = body.merge_method; return json({ sha: 'abc1234def', merged: true }); }
    if (/^\/commits\/[^/]+\/check-runs$/.test(p)) return json({ check_runs: [{ name: 'build', status: 'completed', conclusion: 'success' }] });
    if (/^\/issues\/\d+\/comments$/.test(p)) return method === 'POST' ? json({ id: 1, body: body.body }, 201) : json([]);
    if (p === '/issues' && method === 'GET') return json(repo.issues);
    if (p === '/issues' && method === 'POST') { const i = { number: 11, title: body.title, body: body.body, labels: (body.labels || []).map(n => ({ name: n, color: 'ededed' })), state: 'open', user: { login: 'me' }, html_url: 'x', created_at: new Date().toISOString() }; repo.issues.push(i); return json(i, 201); }
    if ((m = /^\/issues\/(\d+)$/.exec(p))) { const i = repo.issues.find(x => x.number === +m[1]); if (method === 'PATCH') Object.assign(i, body); return json(i); }
    if (p === '/actions/workflows') return json({ workflows: [{ id: 42, name: 'CI', state: 'active' }, { id: 43, name: 'Old', state: 'disabled_manually' }] });
    if (p === '/actions/workflows/42/dispatches' && method === 'POST') return new Response(null, { status: 204 });
    if (/^\/pulls\/\d+\/reviews$/.test(p) && method === 'POST') return json({ id: 5, state: body.event }, 200);
    if (p === '/merges' && method === 'POST') return json({ sha: 'merge123abc' }, 201);
    if (p === '/actions/runs') return json({ workflow_runs: [{ id: 99, name: 'CI', display_title: 'fix build', run_number: 12, status: 'completed', conclusion: 'failure', head_branch: 'main', head_sha: 'c0ffee1aa', event: 'push', created_at: new Date().toISOString(), html_url: 'x' }] });
    if (p === '/actions/runs/99') return json({ id: 99, name: 'CI', display_title: 'fix build', run_number: 12, status: 'completed', conclusion: 'failure', head_branch: 'main', head_sha: 'c0ffee1aa', html_url: 'x', created_at: new Date().toISOString() });
    if (p === '/actions/runs/99/jobs') return json({ jobs: [{ id: 501, name: 'test', status: 'completed', conclusion: 'failure', steps: [{ number: 1, name: 'checkout', status: 'completed', conclusion: 'success' }, { number: 2, name: 'npm test', status: 'completed', conclusion: 'failure' }] }] });
    if (/^\/actions\/runs\/99\/(rerun|rerun-failed-jobs|cancel)$/.test(p) && method === 'POST') return json(null, 201);
    if (p === '/check-runs/501/annotations') return json([{ annotation_level: 'failure', path: 'tests/a.test.js', start_line: 4, message: 'Expected 2 but got 3' }]);
    if (p === '/actions/jobs/501/logs') return new Response('2026-01-01T00:00:00.000Z npm ERR! Test failed: Expected 2 but got 3', { status: 200, headers: { 'content-type': 'text/plain' } });
    if (p === '/branches') return json([...repo.branches].map(([name, s]) => ({ name, commit: { sha: s }, protected: name === 'main' })));
    if ((m = /^\/git\/ref\/heads\/(.+)$/.exec(p))) { const s = repo.branches.get(decodeURIComponent(m[1])); return s ? json({ object: { sha: s } }) : json({ message: 'Not Found' }, 404); }
    if (p === '/git/refs' && method === 'POST') { const name = body.ref.replace('refs/heads/', ''); if (repo.branches.has(name)) return json({ message: 'Reference already exists' }, 422); repo.branches.set(name, body.sha); return json({ ref: body.ref }, 201); }
    if ((m = /^\/git\/refs\/heads\/(.+)$/.exec(p)) && method === 'DELETE') { repo.branches.delete(decodeURIComponent(m[1])); return new Response(null, { status: 204 }); }
    if (/^\/compare\//.test(p)) return json({ ahead_by: 2, behind_by: 0, commits: [{ sha: 'beef002aaa', commit: { message: 'feat: x' } }], files: [{ filename: 'a.js', status: 'added', additions: 3, deletions: 0, patch: '@@ -0,0 +1,3 @@\n+a\n+b\n+c' }] });
    if (p === '/releases' && method === 'GET') return json(repo.releases);
    if (p === '/releases' && method === 'POST') { repo.releases.unshift({ ...body, html_url: 'x' }); return json(body, 201); }
    if (p === '/tags') return json([{ name: 'v1.2.3' }]);
    if (/^\/git\/trees\//.test(p)) return json({ tree: [...repo.files.keys()].map(path => ({ path, type: 'blob' })).concat([{ path: 'src', type: 'tree' }]) });
    if (p === '/pages') {
        if (method === 'POST') { repo.pages = { status: 'building', html_url: 'https://o.github.io/r/', source: body.source }; return json(repo.pages, 201); }
        return repo.pages ? json(repo.pages) : json({ message: 'Not Found' }, 404);
    }
    if (p === '/languages') return json({ JavaScript: 7000, CSS: 2000, HTML: 1000 });
    if (p === '/commits') return json([{ sha: 'c0ffee1abc', commit: { message: 'init', author: { name: 'n', date: new Date().toISOString() } } }]);
    if (p === '/contributors') return json([{ login: 'nader', contributions: 42 }]);
    return json({ message: 'unmocked ' + method + ' ' + p }, 404);
}

(async () => {
    let aiPrompt = '';
    const or = mockOpenRouter(async (body) => {
        aiPrompt = body.messages[body.messages.length - 1].content;
        if (/Conventional Commits/.test(aiPrompt)) return { text: 'feat(app): add line between 2 and 3' };
        if (/TITLE:/.test(aiPrompt)) return { text: 'TITLE: Add feature X\n## الملخص\nإضافة X' };
        return { text: '**السبب:** فشل الاختبار Expected 2 but got 3' };
    });
    const fetchImpl = (url, opts) => String(url).startsWith('https://api.github.com') ? github(url, opts) : or.fetchImpl(url, opts);
    const settings = { apiKey: 'sk-or-test', githubToken: 'ghp_test', githubOwner: 'o', githubRepo: 'r', githubBranch: 'main', model: 'google/gemma-3-27b-it:free' };
    const { w, d, app, errors } = loadApp({ fetchImpl, localStorageSeed: { ox_alpha_settings_v2: JSON.stringify(settings) } });
    await wait(150);
    const $ = (id) => d.getElementById(id);
    const lastPut = () => [...repo.log].reverse().find(l => l.method === 'PUT' && l.path.startsWith('/contents/'));

    section('Myers diff engine');
    const a = ['a', 'b', 'c', 'd', 'e'], b = ['a', 'b', 'X', 'c', 'd', 'e'];
    let st = app.diffStats(app.diffLines(a, b));
    ok(st.add === 1 && st.del === 0, `insert one line → +1 −0 (got +${st.add} −${st.del}; old engine reported +4 −3)`);
    st = app.diffStats(app.diffLines(['1', '2', '3'], ['1', '3']));
    ok(st.add === 0 && st.del === 1, 'delete one line → +0 −1');
    st = app.diffStats(app.diffLines(['x', 'y'], ['x', 'z']));
    ok(st.add === 1 && st.del === 1, 'change one line → +1 −1');
    const big = Array.from({ length: 3000 }, (_, i) => 'L' + i);
    const big2 = big.slice(); big2.splice(1500, 0, 'NEW'); big2[10] = 'CHANGED';
    const t0 = Date.now(); st = app.diffStats(app.diffLines(big, big2));
    ok(st.add === 2 && st.del === 1 && Date.now() - t0 < 1500, `3000-line file diffed exactly in ${Date.now() - t0}ms`);
    const ops = app.diffLines(['const a = 1;'], ['const a = 2;']);
    const html = app.renderDiffHTML(['const a = 1;'], ['const a = 2;'], ops, 'unified');
    ok(/diff-word">1</.test(html) && /diff-word">2</.test(html), 'word-level highlight on changed line');
    ok(/@@ -1,1 \+1,1 @@/.test(html), 'hunk header with line numbers');
    ok(/diff-split-row/.test(app.renderDiffHTML(['a'], ['b'], app.diffLines(['a'], ['b']), 'split')), 'side-by-side renderer');
    ok(/&lt;script&gt;/.test(app.renderDiffHTML([], ['<script>'], app.diffLines([], ['<script>']))), 'diff output is escaped');
    const ph = app.renderPatchHTML('@@ -10,2 +10,2 @@\n-old\n+new\n ctx');
    ok(/>10</.test(ph) && /diff-line add/.test(ph), 'GitHub patch renderer keeps line numbers');

    // Fuzz: ops must rebuild both sides and be minimal (= LCS length from DP)
    let rng = 12345; const rand = (n) => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng % n; };
    const lcs = (x, y) => { const dp = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0)); for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) dp[i][j] = x[i - 1] === y[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]); return dp[x.length][y.length]; };
    let fuzzOk = true, mergeOk = true;
    for (let t = 0; t < 300; t++) {
        const x = Array.from({ length: rand(25) }, () => 'abcde'[rand(5)]), y = Array.from({ length: rand(25) }, () => 'abcde'[rand(5)]);
        const o = app.diffLines(x, y);
        const ra = o.filter(q => q.t !== '+').map(q => x[q.a]), rb = o.filter(q => q.t !== '-').map(q => y[q.b]);
        if (ra.join() !== x.join() || rb.join() !== y.join() || o.filter(q => q.t === '=').length !== lcs(x, y)) { fuzzOk = false; break; }
        const m1 = app.merge3(x.join('\n'), y.join('\n'), x.join('\n'));
        if (m1.conflicts || m1.segments.map(s => s.lines.join('\n')).join('\n') !== y.join('\n')) { mergeOk = false; }
    }
    ok(fuzzOk, 'fuzz: 300 random diffs rebuild both sides and are minimal (LCS)');
    ok(mergeOk, 'fuzz: merge3(base, ours, base) === ours');

    section('3-way merge');
    const base = 'a\nb\nc\nd\ne\nf\ng';
    let r = app.merge3(base, 'A\nb\nc\nd\ne\nf\ng', 'a\nb\nc\nd\ne\nf\nG');
    ok(r.conflicts === 0 && r.segments.map(s => s.lines.join('\n')).join('\n') === 'A\nb\nc\nd\ne\nf\nG', 'non-overlapping edits merge cleanly');
    r = app.merge3(base, 'a\nb\nMINE\nd\ne\nf\ng', 'a\nb\nTHEIRS\nd\ne\nf\ng');
    ok(r.conflicts === 1 && r.segments[1].ours[0] === 'MINE' && r.segments[1].theirs[0] === 'THEIRS', 'overlapping edits → 1 conflict with both sides');
    r = app.merge3(base, 'a\nb\nSAME\nd\ne\nf\ng', 'a\nb\nSAME\nd\ne\nf\ng');
    ok(r.conflicts === 0, 'identical changes on both sides → no conflict');
    r = app.merge3(base, 'a\nb\nc\nd\ne\nf\ng\nh', base);
    ok(r.conflicts === 0 && r.segments.map(s => s.lines.join('\n')).join('\n').endsWith('g\nh'), 'one-sided append');

    section('Conflict-aware commit flow');
    const orig = repo.files.get('src/app.js');
    app.recordGitHubBase('src/app.js', orig, shaOf('src/app.js'));
    ok(app.getGitHubBase('src/app.js')?.sha === shaOf('src/app.js'), 'base sha recorded per repo/branch/path');
    // 1) Simple commit: remote unchanged
    const local1 = orig.replace('line2\n', 'line2\nINSERTED\n');
    await app.openCommitReview('src/app.js', local1);
    ok($('diff-modal').classList.contains('active'), 'review dialog opens');
    ok($('diff-stats').textContent.includes('+1') && $('diff-stats').textContent.includes('−0'), 'stats show +1 −0');
    await app.suggestCommitMessage();
    ok($('diff-commit-message').value === 'feat(app): add line between 2 and 3' && /INSERTED/.test(aiPrompt), 'AI commit message from the real diff');
    const shaBefore = shaOf('src/app.js');
    await app.confirmCommitFromDiff();
    let put = lastPut();
    ok(put && put.body.sha === shaBefore && repo.files.get('src/app.js') === local1, 'PUT with the reviewed sha applied to GitHub');
    ok(put.body.message === 'feat(app): add line between 2 and 3' && put.body.branch === 'main', 'commit message + branch sent');
    ok(app.getGitHubBase('src/app.js').content === local1, 'base updated after commit');
    // 2) Remote changed meanwhile (non-overlapping) → auto merge
    repo.files.set('src/app.js', local1.replace('line8', 'line8-remote'));
    const local2 = local1.replace('line1', 'line1-local');
    await app.openCommitReview('src/app.js', local2);
    await wait(20);
    ok(/دمج تلقائي/.test($('diff-context-note').textContent), 'remote change detected → auto-merged note');
    await app.confirmCommitFromDiff();
    ok(/line1-local/.test(repo.files.get('src/app.js')) && /line8-remote/.test(repo.files.get('src/app.js')), 'merged result keeps both local and remote edits');
    // 3) Overlapping change → resolver UI
    const baseNow = repo.files.get('src/app.js');
    repo.files.set('src/app.js', baseNow.replace('line4', 'line4-REMOTE'));
    await app.openCommitReview('src/app.js', baseNow.replace('line4', 'line4-LOCAL'));
    await wait(20);
    ok($('merge-modal').classList.contains('active') && d.querySelectorAll('.merge-conflict').length === 1, 'conflict → merge resolver with 1 conflict');
    ok($('merge-continue-btn').disabled, 'continue disabled until resolved');
    app.mergeChooseAll('ours');
    ok(!$('merge-continue-btn').disabled, 'choose ours → continue enabled');
    app.finishMerge();
    await wait(20);
    await app.confirmCommitFromDiff();
    ok(/line4-LOCAL/.test(repo.files.get('src/app.js')) && !/line4-REMOTE/.test(repo.files.get('src/app.js')), 'resolved (ours) committed with the latest sha');
    // 4) New file → PUT without sha
    await app.openCommitReview('docs/new.md', '# new\n');
    ok(/ملف جديد/.test($('diff-context-note').textContent), 'new file noted');
    await app.confirmCommitFromDiff();
    put = lastPut();
    ok(put.path === '/contents/docs/new.md' && !('sha' in put.body) && repo.files.get('docs/new.md') === '# new\n', 'new file PUT without sha');
    // 5) Identical → commit disabled
    await app.openCommitReview('README.md', '# Demo\n');
    ok($('btn-diff-confirm-commit').disabled, 'no changes → commit button disabled');
    app.closeModals();
    // 6) Race: remote changes between review and confirm → 409 → re-review with merge
    await app.openCommitReview('README.md', '# Demo\nlocal line\n');
    repo.files.set('README.md', 'remote title\n# Demo\n');
    await app.confirmCommitFromDiff();
    await wait(20);
    ok(/دمج تلقائي/.test($('diff-context-note').textContent), '409 during commit → re-fetch and auto-merge');
    await app.confirmCommitFromDiff();
    ok(repo.files.get('README.md') === 'remote title\n# Demo\nlocal line\n', 'race resolved without losing remote change');
    // UTF-8 / Arabic
    await app.openCommitReview('ar.md', 'مرحبا بالعالم ✓\n');
    await app.confirmCommitFromDiff();
    ok(repo.files.get('ar.md') === 'مرحبا بالعالم ✓\n', 'UTF-8 (Arabic + emoji) round-trips');
    // Studio commit uses the active file, not the last previewed one
    app.virtualProjectFiles.set('src/app.js', { content: repo.files.get('src/app.js'), name: 'app.js' });
    app.selectedFileContent = { path: 'README.md', content: 'other' };
    app.activeStudioFile = 'src/app.js';
    const ta = $('studio-editor-textarea') || d.body.appendChild(Object.assign(d.createElement('textarea'), { id: 'studio-editor-textarea' }));
    ta.value = repo.files.get('src/app.js') + 'tail\n';
    await app.openDiffViewerForActiveStudioFile();
    await wait(20);
    ok($('diff-file-path-title').innerText === 'src/app.js' && $('diff-stats').textContent.includes('+1'), 'Diff button compares the active studio file with GitHub');
    app.closeModals();
    // Chat code-block buttons go through the review
    await app.openDiffModal('src/z.js', '', 'x');
    ok($('diff-modal').classList.contains('active') && /ملف جديد/.test($('diff-context-note').textContent), 'chat Diff button → real review');
    app.closeModals();

    section('GitHub Hub — shell');
    app.openGitHubHub('prs');
    await wait(30);
    ok($('gh-hub-modal').classList.contains('active') && d.querySelectorAll('.gh-tab').length === 18, 'hub opens with 18 tabs (7 + 11 GitHub Pro)');
    ok($('gh-hub-repo').textContent === 'o/r@main', 'repo label');
    ok(/4990\/5000/.test($('gh-hub-rate').textContent), 'rate limit shown');
    const lastReq = repo.log[repo.log.length - 1];
    ok(lastReq.auth === 'Bearer ghp_test', 'token sent as Bearer');
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'g', altKey: true, bubbles: true }));
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'g', altKey: true }));
    ok($('gh-hub-modal').classList.contains('active'), 'Alt+G opens the hub');
    const pal = app.buildPaletteCommands();
    ok(pal.some(c => c.label === 'GitHub Hub') && pal.some(c => c.label === 'GitHub: Actions') && !pal.some(c => c.label === 'الفروع و Pull Requests'), 'palette has hub commands (old branch-modal entry removed)');
    ok(!$('branch-modal'), 'old branch modal removed');
    app.openBranchManagerModal(); await wait(30);
    ok(app.ghTab === 'branches', 'openBranchManagerModal → hub branches tab');

    section('Pull Requests');
    await app.switchGhTab('prs');
    ok(/Add feature X/.test($('gh-hub-body').textContent), 'PR list');
    await app.ghOpenPR(7);
    ok(/build/.test($('gh-hub-body').textContent) && d.querySelector('.gh-patch .diff-line.add'), 'PR detail: checks + file patches');
    await app.ghReviewPR(7, 'REQUEST_CHANGES');
    ok(!repo.log.some(l => l.path === '/pulls/7/reviews'), 'request changes needs a body');
    $('gh-comment-input').value = 'please rename';
    await app.ghReviewPR(7, 'REQUEST_CHANGES');
    ok(repo.log.some(l => l.path === '/pulls/7/reviews' && l.body.event === 'REQUEST_CHANGES' && l.body.body === 'please rename'), 'request changes review sent');
    await app.ghReviewPR(7, 'APPROVE');
    ok(repo.log.some(l => l.path === '/pulls/7/reviews' && l.body.event === 'APPROVE'), 'approve review sent');
    $('gh-merge-method').value = 'squash';
    await app.ghMergePR(7);
    ok(repo.pulls[0].merged && repo.pulls[0].merge_method === 'squash', 'PR merged with squash');
    await app.ghShowCreatePR('feature/x');
    ok($('gh-pr-head').value === 'feature/x' && $('gh-pr-base').value === 'main', 'create PR form defaults head/base');
    await app.ghAIDescribePR();
    ok($('gh-pr-title').value === 'Add feature X' && /الملخص/.test($('gh-pr-body').value), 'AI PR description fills title + body');
    await app.ghCreatePR();
    ok(repo.pulls.some(x => x.number === 8 && x.head.ref === 'feature/x'), 'PR created');

    section('Actions');
    await app.switchGhTab('actions');
    ok(/fix build/.test($('gh-hub-body').textContent) && /فشل/.test($('gh-hub-body').textContent), 'runs list with status');
    ok($('gh-wf-select') && $('gh-wf-select').options.length === 1, 'active workflows listed for manual run');
    ok(await app.ghDispatchWorkflow(42) && repo.log.some(l => l.path === '/actions/workflows/42/dispatches' && l.body.ref === 'main'), 'manual workflow_dispatch on active branch');
    await app.ghOpenRun(99);
    ok(/npm test/.test($('gh-hub-body').textContent), 'jobs + steps');
    await app.ghRunAction(99, 'rerun-failed-jobs');
    ok(repo.log.some(l => l.method === 'POST' && l.path === '/actions/runs/99/rerun-failed-jobs'), 'rerun failed jobs');
    await app.ghExplainFailure(99);
    ok(/Expected 2 but got 3/.test(aiPrompt) && /tests\/a\.test\.js:4/.test(aiPrompt), 'AI failure explanation gets annotations + log');
    ok(/السبب/.test($('gh-ai-failure').textContent), 'explanation rendered');
    clearTimeout(app._ghActionsTimer);

    section('Issues');
    await app.switchGhTab('issues');
    ok(/Bug: crash/.test($('gh-hub-body').textContent) && !/PR shows in issues/.test($('gh-hub-body').textContent), 'issues list excludes PRs');
    app.ghShowCreateIssue();
    $('gh-issue-title').value = 'New idea'; $('gh-issue-labels').value = 'enhancement, ui';
    await app.ghCreateIssue();
    const ni = repo.issues.find(i => i.number === 11);
    ok(ni && ni.labels.length === 2, 'issue created with labels');
    await app.ghSetIssueState(11, 'closed');
    ok(ni.state === 'closed', 'issue closed');

    section('Branches');
    const keyBefore = JSON.parse(w.localStorage.getItem('ox_alpha_settings_v2') || '{}').apiKey;
    await app.switchGhTab('branches');
    $('gh-new-branch').value = 'feature/new ui';
    await app.ghCreateBranch();
    ok(repo.branches.get('feature/new-ui') === 'c0ffee1', 'branch created from base sha (spaces → dashes)');
    ok(app.settings.githubBranch === 'feature/new-ui', 'new branch activated');
    const saved = JSON.parse(w.localStorage.getItem('ox_alpha_settings_v2'));
    ok(saved.apiKey === 'sk-or-test' && saved.githubToken === 'ghp_test' && keyBefore === 'sk-or-test', 'API keys preserved (old flow wiped them via saveSettings)');
    await app.ghDeleteBranch('feature/new-ui');
    ok(!repo.branches.has('feature/new-ui') && app.settings.githubBranch === 'main', 'delete active branch → falls back to default');
    await app.ghOpenCompare('main', 'feature/x');
    ok(/متقدم بـ 2/.test($('gh-hub-body').textContent), 'compare view');
    await app.ghMergeBranches('main', 'feature/x');
    ok(repo.log.some(l => l.path === '/merges' && l.body.base === 'main' && l.body.head === 'feature/x'), 'direct branch merge');

    section('Releases');
    ok(app.nextSemver('v1.2.3') === 'v1.2.4' && app.nextSemver('v1.2.3', 'minor') === 'v1.3.0' && app.nextSemver('1.9.9', 'major') === '2.0.0' && app.nextSemver('') === 'v1.0.0', 'semver suggestions');
    await app.switchGhTab('releases');
    ok($('gh-rel-tag').value === 'v1.2.4', 'next tag pre-filled');
    await app.ghCreateRelease();
    ok(repo.releases[0].tag_name === 'v1.2.4' && repo.releases[0].generate_release_notes === true && repo.releases[0].target_commitish === 'main', 'release with generated notes');

    section('Deploy');
    const stack = app.detectStack(['package.json', 'index.html', '.github/workflows/ci.yml']);
    ok(stack.node && stack.static && stack.ci && !stack.docker && !stack.python, 'stack detection');
    ok(/setup-node/.test(app.ghDeployTemplate('ci', { node: true }).content) && /python/.test(app.ghDeployTemplate('docker', { python: true }).content), 'templates adapt to stack');
    await app.switchGhTab('deploy');
    ok(/Node\.js/.test($('gh-hub-body').textContent) && /vercel\.com\/new\/clone\?repository-url=https%3A%2F%2Fgithub\.com%2Fo%2Fr/.test($('gh-hub-body').innerHTML), 'deploy tab: stack + Vercel link');
    await app.ghEnablePages();
    ok(repo.pages && repo.pages.source.branch === 'main', 'GitHub Pages enabled on active branch');
    await app.ghAddTemplate('docker');
    await wait(20);
    ok($('diff-modal').classList.contains('active') && $('diff-file-path-title').innerText === 'Dockerfile' && $('diff-commit-message').value === 'chore: add Dockerfile', 'template opens in commit review');
    app.closeModals();

    section('Insights + errors');
    app.openGitHubHub('insights'); await wait(40);
    ok(/JavaScript 70\.0%/.test($('gh-hub-body').textContent) && /nader/.test($('gh-hub-body').textContent), 'languages + contributors');
    let err;
    try { await app.gh('/repos/o/r/unknown-endpoint'); } catch (e) { err = e; }
    ok(err && err.status === 404 && /غير موجود/.test(err.message), 'friendly Arabic 404 error');
    app.settings.githubToken = '';
    app.closeModals();
    await app.openCommitReview('x.js', 'x');
    ok($('settings-modal')?.classList.contains('active'), 'commit without token → opens settings');
    app.settings.githubToken = 'ghp_test';
    app.closeModals();

    section('File explorer');
    app.openGitHubWorkbench(); await wait(40);
    ok(d.querySelectorAll('#repo-file-tree .session-item-row').length === repo.files.size, 'tree lists all files');
    app.renderGitHubTreeList('readme');
    ok(d.querySelectorAll('#repo-file-tree .session-item-row').length === 1, 'tree search filter');
    await app.previewGitHubFile('README.md');
    ok(app.getGitHubBase('README.md')?.sha === shaOf('README.md'), 'preview records base sha (contents API)');

    ok(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
    w.close();
})().catch(e => { console.error('❌ test crashed:', e); process.exitCode = 1; });
