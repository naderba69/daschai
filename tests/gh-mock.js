/* In-memory GitHub for Sprint 9 tests: a real git object store (blobs/trees/commits/refs) with
   3-way /merges (409 on conflict), plus the REST endpoints used by the GitHub Pro chunk. */
'use strict';
const crypto = require('crypto');

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const now = () => new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

function createGitHub({ owner = 'o', repo = 'r' } = {}) {
    const blobs = new Map();      // sha → Buffer
    const trees = new Map();      // sha → Map(path → blobSha)
    const commits = new Map();    // sha → { sha, tree, parents, message, author, date }
    const repos = new Map();      // "o/r" → { refs: Map, tags: Map, info, extra }
    const log = [];
    const state = {
        secrets: new Map(), variables: new Map([['NODE_ENV', { name: 'NODE_ENV', value: 'production', updated_at: now() }]]), envs: [{ id: 1, name: 'production', protection_rules: [], updated_at: now() }],
        hooks: [{ id: 7, name: 'web', active: true, events: ['push'], config: { url: 'https://example.com/hook', content_type: 'json' }, last_response: { code: 200, status: 'active' }, updated_at: now() }],
        keys: [{ id: 3, title: 'deploy', key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHk0 deploy', read_only: true, created_at: now() }],
        userKeys: [], protection: new Map(), labels: [{ id: 1, name: 'bug', color: 'd73a4a', description: 'Something is broken' }, { id: 2, name: 'in progress', color: 'fbca04', description: '' }],
        milestones: [{ number: 1, title: 'v1', state: 'open', open_issues: 1, closed_issues: 1, due_on: daysAgo(-10), description: 'first' }],
        issues: [
            { number: 3, title: 'Bug: crash', state: 'open', user: { login: 'u1' }, labels: [{ name: 'bug', color: 'd73a4a' }], assignees: [], milestone: null, comments: 0, body: 'it crashes', html_url: 'https://github.com/o/r/issues/3', created_at: daysAgo(3), updated_at: daysAgo(1) },
            { number: 4, title: 'Feature: dark mode', state: 'open', user: { login: 'u2' }, labels: [{ name: 'in progress', color: 'fbca04' }], assignees: [{ login: 'nader', avatar_url: 'https://a/x.png' }], milestone: { number: 1, title: 'v1' }, comments: 2, body: '', html_url: 'x', created_at: daysAgo(5), updated_at: daysAgo(2) },
            { number: 5, title: 'Done thing', state: 'closed', closed_at: daysAgo(1), user: { login: 'u1' }, labels: [], assignees: [], milestone: null, comments: 1, body: '', html_url: 'x', created_at: daysAgo(6), updated_at: daysAgo(1) }
        ],
        pulls: [{ number: 9, title: 'Add feature', state: 'closed', merged_at: daysAgo(1), user: { login: 'nader' }, head: { ref: 'feature' }, base: { ref: 'main' }, created_at: daysAgo(2), updated_at: daysAgo(1), html_url: 'x' }],
        gists: [{ id: 'abc123def456', description: 'my snippet', public: false, files: { 'a.js': { filename: 'a.js', language: 'JavaScript', content: 'const a = 1;' } }, owner: { login: 'me' }, html_url: 'https://gist.github.com/me/abc123def456', updated_at: now(), history: [{}] }],
        starredGists: new Set(), releases: [{ id: 11, tag_name: 'v1.0.0', name: 'v1.0.0', draft: false, prerelease: false, html_url: 'x', upload_url: 'https://uploads.github.com/repos/o/r/releases/11/assets{?name,label}', assets: [{ id: 21, name: 'app.zip', size: 2048, download_count: 5, browser_download_url: 'https://github.com/o/r/releases/download/v1.0.0/app.zip' }] }],
        uploads: [], collaborators: [{ login: 'nader', avatar_url: 'https://a/n.png', permissions: { admin: true, push: true, pull: true }, role_name: 'admin' }, { login: 'u1', avatar_url: 'https://a/u.png', permissions: { push: true, pull: true }, role_name: 'write' }],
        invitations: [], orgMembers: [{ login: 'nader', avatar_url: 'https://a/n.png' }, { login: 'u2', avatar_url: 'https://a/u2.png' }], orgAdmins: ['nader'], orgInvites: [], teams: [{ id: 1, slug: 'core', name: 'Core', description: 'core team', privacy: 'closed', permission: 'push', members_count: 1, repos_count: 1 }], teamMembers: new Map([['core', ['nader']]]),
        created: [], starred: false, watching: false, pages: { cname: null, https_enforced: true, status: 'built', html_url: 'https://o.github.io/r/' }, topics: ['demo']
    };
    const KP = { pub: null, sec: null };

    // ------------------------------------------------------------------ object store
    const putBlob = (buf) => { const s = sha1('blob:' + buf.toString('base64')); blobs.set(s, buf); return s; };
    const putTree = (map) => { const s = sha1('tree:' + JSON.stringify([...map].sort())); trees.set(s, new Map(map)); return s; };
    let clock = 0;
    const putCommit = ({ tree, parents, message, author }) => {
        const date = author && author.date ? author.date : new Date(Date.now() - 3600000 + (clock++) * 60000).toISOString();
        const s = sha1('commit:' + tree + parents.join(',') + message + date + clock);
        commits.set(s, { sha: s, tree, parents, message, author: { name: (author && author.name) || 'Nader', email: (author && author.email) || 'n@x', date } });
        return s;
    };
    const filesOf = (commitSha) => trees.get(commits.get(commitSha).tree);
    const ancestors = (s) => { const out = new Set(), q = [s]; while (q.length) { const x = q.shift(); if (!x || out.has(x)) continue; out.add(x); q.push(...commits.get(x).parents); } return out; };
    const mergeBase = (a, b) => { const A = ancestors(a); const q = [b], seen = new Set(); while (q.length) { const x = q.shift(); if (seen.has(x)) continue; seen.add(x); if (A.has(x)) return x; q.push(...commits.get(x).parents); } return null; };
    /** Commit files on a branch of a repo (helper for scenarios). */
    function commit(full, branch, files, message, del = []) {
        const R = repos.get(full);
        const head = R.refs.get(branch);
        const map = head ? new Map(filesOf(head)) : new Map();
        for (const [p, c] of Object.entries(files)) map.set(p, putBlob(Buffer.from(c, 'utf8')));
        del.forEach(p => map.delete(p));
        const s = putCommit({ tree: putTree(map), parents: head ? [head] : [], message });
        R.refs.set(branch, s);
        return s;
    }
    function addRepo(full, info = {}) {
        const [o, n] = full.split('/');
        repos.set(full, { refs: new Map(), tags: new Map(), info: { id: repos.size + 100, name: n, full_name: full, owner: { login: o, avatar_url: 'https://a/o.png' }, default_branch: 'main', private: false, stargazers_count: 5, forks_count: 1, open_issues_count: 2, watchers_count: 3, subscribers_count: 2, size: 2048, language: 'JavaScript', license: { spdx_id: 'MIT' }, pushed_at: now(), created_at: daysAgo(400), description: 'demo', homepage: '', topics: ['demo'], has_issues: true, has_wiki: true, has_projects: true, has_discussions: false, allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true, delete_branch_on_merge: false, archived: false, visibility: 'public', html_url: `https://github.com/${full}`, permissions: { admin: true, maintain: true, push: true, triage: true, pull: true }, fork: false, ...info } });
        return repos.get(full);
    }
    const fileContent = (full, ref, p) => { const R = repos.get(full); const head = R.refs.get(ref) || (commits.has(ref) ? ref : null); if (!head) return null; const bs = filesOf(head).get(p); return bs ? blobs.get(bs) : null; };
    const commitJSON = (s) => { const c = commits.get(s); return { sha: s, node_id: s, commit: { message: c.message, tree: { sha: c.tree }, author: c.author, committer: { name: c.author.name, date: c.author.date } }, author: { login: 'nader', avatar_url: 'https://a/n.png' }, parents: c.parents.map(p => ({ sha: p })), html_url: `https://github.com/o/r/commit/${s}` }; };
    const firstParentList = (head, n = 100) => { const out = []; const seen = new Set(); const q = [head]; while (q.length && out.length < n) { const x = q.shift(); if (!x || seen.has(x)) continue; seen.add(x); out.push(x); q.push(...commits.get(x).parents); } return out; }; // git-log order: always starts at the requested head
    const diffFiles = (fromSha, toSha) => {
        const A = fromSha ? filesOf(fromSha) : new Map(), B = filesOf(toSha);
        const out = [];
        for (const [p, s] of B) if (!A.has(p)) out.push({ filename: p, status: 'added', additions: 1, deletions: 0, changes: 1, patch: '@@ -0,0 +1 @@\n+' + blobs.get(s).toString().split('\n')[0] }); else if (A.get(p) !== s) out.push({ filename: p, status: 'modified', additions: 1, deletions: 1, changes: 2, patch: '@@ -1 +1 @@\n-old\n+new' });
        for (const p of A.keys()) if (!B.has(p)) out.push({ filename: p, status: 'removed', additions: 0, deletions: 1, changes: 1 });
        return out;
    };

    // ------------------------------------------------------------------ HTTP
    const json = (obj, status = 200, headers = {}) => new Response(obj === null ? null : JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '4990', 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600), ...headers } });
    const notFound = () => json({ message: 'Not Found' }, 404);

    async function handle(url, opts = {}) {
        const u = new URL(String(url));
        const method = (opts.method || 'GET').toUpperCase();
        let body = null;
        if (opts.body && typeof opts.body === 'string') { try { body = JSON.parse(opts.body); } catch (e) { body = opts.body; } } else if (opts.body) body = opts.body;
        const entry = { method, host: u.host, path: u.pathname, query: u.search, body, auth: opts.headers && (opts.headers.Authorization || opts.headers.authorization) };
        log.push(entry);
        let m;
        if (u.host === 'uploads.github.com') {
            const name = u.searchParams.get('name');
            const size = body && body.size != null ? body.size : String(body || '').length;
            const a = { id: 900 + state.uploads.length, name, size, download_count: 0, content_type: opts.headers && opts.headers['Content-Type'], browser_download_url: 'https://github.com/x/' + name };
            state.uploads.push(a);
            return json(a, 201);
        }
        if (u.host === 'gitlab.com') {
            if (/^\/api\/v4\/projects\/[^/]+$/.test(u.pathname)) return json({ id: 77, default_branch: 'master', path_with_namespace: 'grp/proj' });
            if (/\/repository\/tree$/.test(u.pathname)) return json(u.searchParams.get('page') === '1' ? [{ type: 'blob', path: 'README.md' }, { type: 'tree', path: 'src' }, { type: 'blob', path: 'src/main.py' }, { type: 'blob', path: 'logo.png' }] : []);
            if ((m = /\/repository\/files\/(.+)\/raw$/.exec(u.pathname))) return new Response(`gitlab:${decodeURIComponent(m[1])}@${u.searchParams.get('ref')}`, { status: 200 });
            return notFound();
        }
        if (u.host === 'api.bitbucket.org') {
            if (u.pathname === '/2.0/repositories/ws/bb') return json({ type: 'repository', mainbranch: { name: 'develop' } });
            if (/\/src\/develop\/$/.test(u.pathname)) return json({ values: [{ type: 'commit_file', path: 'index.html', size: 20 }, { type: 'commit_directory', path: 'css' }, { type: 'commit_file', path: 'css/a.css', size: 10 }] });
            if ((m = /\/src\/develop\/(.+)$/.exec(u.pathname))) return new Response('bitbucket:' + m[1], { status: 200 });
            return notFound();
        }
        if (u.host !== 'api.github.com') return notFound();
        const P = u.pathname;
        if (P === '/graphql') return graphql(body);
        if (P === '/user') return json({ login: 'nader', name: 'Nader B', email: 'nader@example.com', avatar_url: 'https://a/n.png' });
        if (P === '/rate_limit') return json({ resources: { core: { limit: 5000, remaining: 4990, reset: Math.floor(Date.now() / 1000) + 600 } } }, 200, { 'x-oauth-scopes': 'repo, gist, read:org', 'github-authentication-token-expiration': '2027-01-01 00:00:00 UTC' });
        if (P === '/user/keys') { if (method === 'POST') { const k = { id: 50 + state.userKeys.length, title: body.title, key: body.key, created_at: now() }; state.userKeys.push(k); return json(k, 201); } return json(state.userKeys); }
        if ((m = /^\/user\/keys\/(\d+)$/.exec(P)) && method === 'DELETE') { state.userKeys = state.userKeys.filter(k => k.id !== +m[1]); return new Response(null, { status: 204 }); }
        if (P === '/user/repos' && method === 'POST') return createRepo('nader', body);
        if ((m = /^\/orgs\/([^/]+)\/repos$/.exec(P)) && method === 'POST') return createRepo(m[1], body);
        if (P === '/user/orgs') return json([{ login: 'acme', description: 'Acme Inc', avatar_url: 'https://a/acme.png' }]);
        if (P === '/user/memberships/orgs') return json([{ organization: { login: 'acme' }, role: 'admin' }]);
        if (P === '/user/memberships/orgs/acme') return json({ role: 'admin', state: 'active' });
        if ((m = /^\/user\/starred\/(.+)$/.exec(P))) { if (method === 'PUT') state.starred = true; else if (method === 'DELETE') state.starred = false; else return state.starred ? new Response(null, { status: 204 }) : notFound(); return new Response(null, { status: 204 }); }
        if ((m = /^\/users\/([^/]+)$/.exec(P))) return json({ login: m[1], id: 4242 });
        if (P === '/orgs/acme') return json({ login: 'acme', name: 'Acme', public_repos: 3, total_private_repos: 2, followers: 10, html_url: 'https://github.com/acme', avatar_url: 'https://a/acme.png', plan: { name: 'team', seats: 10, filled_seats: 2, private_repos: 99 } });
        if (P === '/orgs/acme/members') return json(u.searchParams.get('role') === 'admin' ? state.orgMembers.filter(x => state.orgAdmins.includes(x.login)) : state.orgMembers);
        if (P === '/orgs/acme/invitations') { if (method === 'POST') { const i = { id: 70 + state.orgInvites.length, login: body.email ? null : 'invitee', email: body.email || null, role: body.role, created_at: now(), body }; state.orgInvites.push(i); return json(i, 201); } return json(state.orgInvites); }
        if ((m = /^\/orgs\/acme\/invitations\/(\d+)$/.exec(P))) { state.orgInvites = state.orgInvites.filter(i => i.id !== +m[1]); return new Response(null, { status: 204 }); }
        if ((m = /^\/orgs\/acme\/memberships\/([^/]+)$/.exec(P)) && method === 'PUT') { const l = decodeURIComponent(m[1]); state.orgAdmins = state.orgAdmins.filter(x => x !== l); if (body.role === 'admin') state.orgAdmins.push(l); return json({ role: body.role, state: 'active' }); }
        if ((m = /^\/orgs\/acme\/members\/([^/]+)$/.exec(P)) && method === 'DELETE') { state.orgMembers = state.orgMembers.filter(x => x.login !== decodeURIComponent(m[1])); return new Response(null, { status: 204 }); }
        if (P === '/orgs/acme/teams') { if (method === 'POST') { const t = { id: 2 + state.teams.length, slug: body.name.toLowerCase().replace(/\s+/g, '-'), name: body.name, description: body.description, privacy: body.privacy, permission: 'pull', members_count: 0, repos_count: 0 }; state.teams.push(t); return json(t, 201); } return json(state.teams); }
        if ((m = /^\/orgs\/acme\/teams\/([^/]+)$/.exec(P))) return json(state.teams.find(t => t.slug === m[1]) || {});
        if ((m = /^\/orgs\/acme\/teams\/([^/]+)\/members$/.exec(P))) return json((state.teamMembers.get(m[1]) || []).map(l => ({ login: l, avatar_url: 'https://a/x.png' })));
        if ((m = /^\/orgs\/acme\/teams\/([^/]+)\/repos$/.exec(P))) return json([{ full_name: 'acme/site', permissions: { push: true } }]);
        if ((m = /^\/orgs\/acme\/teams\/([^/]+)\/memberships\/([^/]+)$/.exec(P))) { const list = state.teamMembers.get(m[1]) || []; if (method === 'PUT') { list.push(m[2]); state.teamMembers.set(m[1], list); return json({ state: 'active', role: 'member' }); } state.teamMembers.set(m[1], list.filter(x => x !== m[2])); return new Response(null, { status: 204 }); }
        if (P === '/orgs/acme/repos') return json([{ name: 'site', owner: { login: 'acme' }, default_branch: 'main', private: true, description: 'site', stargazers_count: 2, pushed_at: now(), permissions: { admin: true } }]);
        if (P === '/organizations/acme/settings/billing/usage') return json({ usageItems: [{ product: 'actions', quantity: 120, unitType: 'minutes', netAmount: 0.96 }, { product: 'actions', quantity: 30, unitType: 'minutes', netAmount: 0.24 }, { product: 'packages', quantity: 2, unitType: 'GB', netAmount: 0 }] });
        if (P === '/orgs/acme/audit-log') return json({ message: 'Not Found' }, 404);
        if (P === '/orgs/acme/events') return json([{ type: 'PushEvent', actor: { login: 'nader', avatar_url: 'https://a/n.png' }, repo: { name: 'acme/site' }, payload: { ref: 'refs/heads/main', size: 2 }, created_at: now() }]);
        if (/^\/orgs\/[^/]+\/installations$/.test(P)) return json({ installations: [] });
        if (P === '/gists' || P === '/gists/starred') { if (method === 'POST') { const g = { id: 'f00d' + (state.gists.length + 1) + 'beef', description: body.description, public: body.public, files: Object.fromEntries(Object.entries(body.files).map(([k, v]) => [k, { filename: k, content: v.content, language: null }])), owner: { login: 'nader' }, html_url: 'https://gist.github.com/nader/new' + state.gists.length, updated_at: now(), history: [{}] }; state.gists.unshift(g); return json(g, 201); } return json(P === '/gists' ? state.gists : state.gists.filter(g => state.starredGists.has(g.id))); }
        if ((m = /^\/gists\/([a-f0-9]+)\/star$/.exec(P))) { if (method === 'PUT') state.starredGists.add(m[1]); else if (method === 'DELETE') state.starredGists.delete(m[1]); else return state.starredGists.has(m[1]) ? new Response(null, { status: 204 }) : notFound(); return new Response(null, { status: 204 }); }
        if ((m = /^\/gists\/([a-f0-9]+)\/forks$/.exec(P))) { const g = { ...state.gists.find(x => x.id === m[1]), id: 'fa11' + m[1].slice(0, 6), owner: { login: 'nader' } }; state.gists.unshift(g); return json(g, 201); }
        if ((m = /^\/gists\/([a-f0-9]+)$/.exec(P))) {
            const g = state.gists.find(x => x.id === m[1]);
            if (!g) return notFound();
            if (method === 'DELETE') { state.gists = state.gists.filter(x => x !== g); return new Response(null, { status: 204 }); }
            if (method === 'PATCH') {
                if (body.description != null) g.description = body.description;
                for (const [k, v] of Object.entries(body.files || {})) { if (v === null) delete g.files[k]; else { const name = v.filename || k; const prev = g.files[k] || {}; if (v.filename && v.filename !== k) delete g.files[k]; g.files[name] = { ...prev, filename: name, content: v.content != null ? v.content : prev.content }; } }
                return json(g);
            }
            return json(g);
        }
        if ((m = /^\/licenses\/(.+)$/.exec(P))) return json({ key: m[1], body: 'Apache License\nCopyright [yyyy] [name of copyright owner]\n' });
        if (P.startsWith('/search/')) return search(P, u.searchParams.get('q'));
        if ((m = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(P))) return repoRoute(m[1], m[2] || '', method, body, u);
        return notFound();
    }

    function createRepo(ownerName, body) {
        const full = `${ownerName}/${body.name}`;
        if (repos.has(full)) return json({ message: 'name already exists on this account', errors: [{ message: 'name already exists' }] }, 422);
        const R = addRepo(full, { private: !!body.private, description: body.description || '' });
        if (body.auto_init) commit(full, 'main', { 'README.md': `# ${body.name}\n` }, 'Initial commit');
        state.created.push(full);
        return json({ ...R.info }, 201);
    }

    function search(P, q) {
        const kind = P.split('/')[2];
        if (kind === 'code') return json({ total_count: 1, items: [{ name: 'app.js', path: 'src/app.js', repository: { full_name: 'o/r' }, html_url: 'x', text_matches: [{ fragment: 'function hello() {}', matches: [{ indices: [9, 14] }] }] }] });
        if (kind === 'issues') { const isPR = /is:pr/.test(q); return json({ total_count: 1, items: [{ number: isPR ? 9 : 3, title: isPR ? 'Add feature' : 'Bug: crash', state: 'open', user: { login: 'u1' }, labels: [], comments: 0, repository_url: 'https://api.github.com/repos/o/r', html_url: 'x', updated_at: now(), ...(isPR ? { pull_request: {} } : {}) }] }); }
        if (kind === 'commits') return json({ total_count: 1, items: [{ sha: [...commits.keys()][0], commit: { message: 'init', author: { name: 'N', date: now() } }, author: { login: 'nader' }, repository: { full_name: 'o/r' }, html_url: 'x' }] });
        if (kind === 'repositories') return json({ total_count: 1, items: [{ full_name: 'o/other', name: 'other', owner: { login: 'o' }, description: 'other repo', stargazers_count: 3, language: 'Go', updated_at: now(), default_branch: 'main', html_url: 'x' }] });
        return json({ total_count: 0, items: [] });
    }

    function repoRoute(full, p, method, body, u) {
        const R = repos.get(full);
        if (!R) return notFound();
        let m;
        const q = (k) => u.searchParams.get(k);
        if (p === '') {
            if (method === 'PATCH') { Object.assign(R.info, body); if (body.name && body.name !== R.info.name) { /* rename */ R.info.full_name = `${R.info.owner.login}/${body.name}`; } return json(R.info); }
            if (method === 'DELETE') { repos.delete(full); return new Response(null, { status: 204 }); }
            return json(R.info);
        }
        // ---- git data
        if (p === '/git/blobs' && method === 'POST') { const buf = body.encoding === 'base64' ? Buffer.from(body.content, 'base64') : Buffer.from(body.content, 'utf8'); return json({ sha: putBlob(buf) }, 201); }
        if ((m = /^\/git\/blobs\/([a-f0-9]+)$/.exec(p))) { const b = blobs.get(m[1]); return b ? json({ sha: m[1], size: b.length, encoding: 'base64', content: b.toString('base64').replace(/(.{60})/g, '$1\n') }) : notFound(); }
        if (p === '/git/trees' && method === 'POST') {
            const map = new Map(body.base_tree ? trees.get(body.base_tree) : []);
            for (const e of body.tree) { if (e.sha === null) map.delete(e.path); else map.set(e.path, e.sha); }
            return json({ sha: putTree(map) }, 201);
        }
        if ((m = /^\/git\/trees\/(.+)$/.exec(p))) {
            const ref = decodeURIComponent(m[1]);
            const tsha = trees.has(ref) ? ref : R.refs.has(ref) ? commits.get(R.refs.get(ref)).tree : commits.has(ref) ? commits.get(ref).tree : null;
            if (!tsha) return notFound();
            const items = [...trees.get(tsha)].map(([path, s]) => ({ path, type: 'blob', mode: '100644', sha: s, size: blobs.get(s).length }));
            const dirs = new Set(); items.forEach(i => { const parts = i.path.split('/'); for (let k = 1; k < parts.length; k++) dirs.add(parts.slice(0, k).join('/')); });
            return json({ sha: tsha, tree: [...items, ...[...dirs].map(d => ({ path: d, type: 'tree', mode: '040000' }))], truncated: false });
        }
        if (p === '/git/commits' && method === 'POST') { const s = putCommit({ tree: body.tree, parents: body.parents, message: body.message, author: body.author }); return json({ sha: s, tree: { sha: body.tree } }, 201); }
        if ((m = /^\/git\/commits\/([a-f0-9]+)$/.exec(p))) { const c = commits.get(m[1]); return c ? json({ sha: c.sha, tree: { sha: c.tree }, parents: c.parents.map(s => ({ sha: s })), message: c.message, author: c.author, committer: c.author }) : notFound(); }
        if ((m = /^\/git\/ref\/heads\/(.+)$/.exec(p))) { const s = R.refs.get(decodeURIComponent(m[1])); return s ? json({ ref: 'refs/heads/' + m[1], object: { sha: s, type: 'commit' } }) : notFound(); }
        if ((m = /^\/git\/ref\/tags\/(.+)$/.exec(p))) { const s = R.tags.get(decodeURIComponent(m[1])); return s ? json({ object: { sha: s, type: 'commit' } }) : notFound(); }
        if ((m = /^\/git\/refs\/heads\/(.+)$/.exec(p))) {
            const name = decodeURIComponent(m[1]);
            if (method === 'DELETE') { if (!R.refs.has(name)) return json({ message: 'Reference does not exist' }, 422); R.refs.delete(name); return new Response(null, { status: 204 }); }
            if (method === 'PATCH') {
                const cur = R.refs.get(name);
                if (!cur) return json({ message: 'Reference does not exist' }, 422);
                if (!body.force && !ancestors(body.sha).has(cur)) return json({ message: 'Update is not a fast forward' }, 422);
                R.refs.set(name, body.sha); return json({ object: { sha: body.sha } });
            }
        }
        if ((m = /^\/git\/refs\/tags\/(.+)$/.exec(p)) && method === 'DELETE') { R.tags.delete(decodeURIComponent(m[1])); return new Response(null, { status: 204 }); }
        if (p === '/git/refs' && method === 'POST') {
            const ref = body.ref;
            if (ref.startsWith('refs/tags/')) { const n = ref.slice(10); if (R.tags.has(n)) return json({ message: 'Reference already exists' }, 422); R.tags.set(n, body.sha); return json({ ref, object: { sha: body.sha } }, 201); }
            const n = ref.replace('refs/heads/', ''); if (R.refs.has(n)) return json({ message: 'Reference already exists' }, 422);
            R.refs.set(n, body.sha); return json({ ref, object: { sha: body.sha } }, 201);
        }
        if (p === '/git/tags' && method === 'POST') { const s = sha1('tag' + body.tag); return json({ sha: s, tag: body.tag, object: body.object }, 201); }
        if (p === '/merges' && method === 'POST') {
            const baseHead = R.refs.get(body.base);
            const headSha = R.refs.get(body.head) || body.head;
            if (!baseHead || !commits.has(headSha)) return notFound();
            if (ancestors(baseHead).has(headSha)) return new Response(null, { status: 204 });
            const mb = mergeBase(baseHead, headSha);
            const B = mb ? filesOf(mb) : new Map(), O = filesOf(baseHead), T = filesOf(headSha);
            const out = new Map();
            for (const path of new Set([...B.keys(), ...O.keys(), ...T.keys()])) {
                const b = B.get(path), o = O.get(path), t = T.get(path);
                let r;
                if (o === t) r = o; else if (b === o) r = t; else if (b === t) r = o; else return json({ message: 'Merge conflict' }, 409);
                if (r) out.set(path, r);
            }
            const tree = putTree(out);
            const s = putCommit({ tree, parents: [baseHead, headSha], message: body.commit_message || 'merge' });
            R.refs.set(body.base, s);
            return json({ sha: s, commit: { tree: { sha: tree }, message: body.commit_message } }, 201);
        }
        // ---- history views
        if (p === '/commits') {
            const ref = q('sha') || 'main';
            const head = R.refs.get(ref) || (commits.has(ref) ? ref : null);
            if (!head) return notFound();
            let list = firstParentList(head, +(q('per_page') || 30) * (+(q('page') || 1)));
            const per = +(q('per_page') || 30), page = +(q('page') || 1);
            if (q('since')) list = list.filter(s => commits.get(s).author.date >= q('since'));
            return json(list.slice((page - 1) * per, page * per).map(commitJSON));
        }
        if ((m = /^\/commits\/([^/]+)$/.exec(p))) { const ref = decodeURIComponent(m[1]); const s = R.refs.get(ref) || ref; const c = commits.get(s); if (!c) return notFound(); return json({ ...commitJSON(s), stats: { additions: 1, deletions: 1, total: 2 }, files: diffFiles(c.parents[0], s) }); }
        if ((m = /^\/commits\/([^/]+)\/check-suites$/.exec(p))) return json({ check_suites: [] });
        if ((m = /^\/compare\/(.+)\.\.\.(.+)$/.exec(p))) {
            const a = decodeURIComponent(m[1]), bRaw = decodeURIComponent(m[2]);
            const b = bRaw.includes(':') ? bRaw.split(':').pop() : bRaw;
            const A = R.refs.get(a) || a, B = R.refs.get(b) || b;
            if (!commits.has(A) || !commits.has(B)) return notFound();
            const anA = ancestors(A), anB = ancestors(B);
            const ahead = [...anB].filter(s => !anA.has(s)).sort((x, y) => commits.get(x).author.date.localeCompare(commits.get(y).author.date));
            const behind = [...anA].filter(s => !anB.has(s));
            return json({ status: ahead.length && behind.length ? 'diverged' : ahead.length ? 'ahead' : behind.length ? 'behind' : 'identical', ahead_by: ahead.length, behind_by: behind.length, total_commits: ahead.length, commits: ahead.map(commitJSON), files: diffFiles(mergeBase(A, B), B) });
        }
        if (p === '/branches') return json([...R.refs].map(([name, s]) => ({ name, commit: { sha: s }, protected: state.protection.has(name) })));
        if ((m = /^\/branches\/([^/]+)$/.exec(p))) { const n = decodeURIComponent(m[1]); const s = R.refs.get(n); return s ? json({ name: n, commit: { sha: s }, protected: state.protection.has(n) }) : notFound(); }
        if ((m = /^\/branches\/(.+)\/protection$/.exec(p))) {
            const n = decodeURIComponent(m[1]);
            if (method === 'PUT') { state.protection.set(n, body); return json({ url: 'x', ...body }); }
            if (method === 'DELETE') { state.protection.delete(n); return new Response(null, { status: 204 }); }
            const pr = state.protection.get(n);
            return pr ? json({ required_pull_request_reviews: pr.required_pull_request_reviews ? { required_approving_review_count: pr.required_pull_request_reviews.required_approving_review_count } : undefined, required_status_checks: pr.required_status_checks ? { strict: pr.required_status_checks.strict, contexts: pr.required_status_checks.contexts } : undefined, enforce_admins: { enabled: !!pr.enforce_admins }, required_linear_history: { enabled: !!pr.required_linear_history }, required_conversation_resolution: { enabled: !!pr.required_conversation_resolution } }) : json({ message: 'Branch not protected' }, 404);
        }
        if (p === '/tags') return json([...R.tags].map(([name, s]) => ({ name, commit: { sha: s } })));
        if ((m = /^\/contents\/(.+)$/.exec(p))) {
            const path = decodeURIComponent(m[1]);
            const ref = q('ref') || 'main';
            const head = R.refs.get(ref);
            const map = head ? filesOf(head) : new Map();
            if (map.has(path)) { const b = blobs.get(map.get(path)); return json({ type: 'file', name: path.split('/').pop(), path, sha: map.get(path), encoding: 'base64', content: b.toString('base64'), size: b.length }); }
            const kids = [...map.keys()].filter(k => k.startsWith(path + '/'));
            if (kids.length) return json(Array.from(new Set(kids.map(k => k.slice(path.length + 1).split('/')[0]))).map(n => ({ type: map.has(`${path}/${n}`) ? 'file' : 'dir', name: n, path: `${path}/${n}`, sha: map.get(`${path}/${n}`) || 'd' })));
            return notFound();
        }
        if (p === '/languages') return json({ JavaScript: 7000, CSS: 2000 });
        if (p === '/contributors') return json([{ login: 'nader', contributions: 10, avatar_url: 'https://a/n.png' }]);
        if (p === '/community/profile') return json({ health_percentage: 42, files: { readme: { url: 'x' }, license: null, contributing: null, code_of_conduct: null, issue_template: null, pull_request_template: null } });
        if (p === '/topics') { if (method === 'PUT') state.topics = body.names; return json({ names: state.topics }); }
        if (p === '/subscription') { if (method === 'PUT') state.watching = true; else if (method === 'DELETE') state.watching = false; else return state.watching ? json({ subscribed: true }) : notFound(); return method === 'PUT' ? json({ subscribed: true }) : new Response(null, { status: 204 }); }
        if (p === '/forks' && method === 'POST') return json({ full_name: 'nader/' + R.info.name, name: R.info.name, owner: { login: 'nader' }, default_branch: 'main', html_url: 'x' }, 202);
        if (p === '/merge-upstream' && method === 'POST') return json({ message: 'Successfully fetched and fast-forwarded from upstream', merge_type: 'fast-forward', base_branch: 'up:main' });
        if (p === '/transfer' && method === 'POST') return json({ ...R.info, owner: { login: body.new_owner } }, 202);
        if (p === '/pages') { if (method === 'PUT') { Object.assign(state.pages, body); return new Response(null, { status: 204 }); } return json(state.pages); }
        // ---- stats
        if (p === '/stats/commit_activity') return json(Array.from({ length: 52 }, (_, i) => ({ week: Math.floor(Date.now() / 1000) - (52 - i) * 604800, total: i % 5 + (i > 44 ? 6 : 1), days: [0, 1, 0, 0, 0, 0, 0] })));
        if (p === '/stats/contributors') return json([{ author: { login: 'nader', avatar_url: 'https://a/n.png' }, total: 40, weeks: Array.from({ length: 12 }, (_, i) => ({ w: Math.floor(Date.now() / 1000) - (12 - i) * 604800, a: 10 * i, d: i, c: i % 3 })) }, { author: { login: 'u1', avatar_url: 'https://a/u.png' }, total: 5, weeks: [{ w: 1, a: 3, d: 1, c: 5 }] }]);
        if (p === '/stats/code_frequency') return json([[1, 10, -2], [2, 30, -8]]);
        if (p === '/stats/participation') return json({ all: Array(52).fill(2), owner: Array(52).fill(1) });
        if (p === '/stats/punch_card') return json([[0, 10, 3], [1, 14, 5]]);
        if (p === '/traffic/views') return json({ count: 120, uniques: 30, views: [{ timestamp: daysAgo(2), count: 50, uniques: 10 }, { timestamp: daysAgo(1), count: 70, uniques: 20 }] });
        if (p === '/traffic/clones') return json({ count: 12, uniques: 4, clones: [{ timestamp: daysAgo(1), count: 12, uniques: 4 }] });
        if (p === '/traffic/popular/paths') return json([{ path: '/o/r', title: 'r', count: 40, uniques: 10 }]);
        if (p === '/traffic/popular/referrers') return json([{ referrer: 'google.com', count: 20, uniques: 8 }]);
        if (p === '/dependency-graph/sbom') return json({ sbom: { packages: [{ name: 'npm:react', versionInfo: '18.2.0', SPDXID: 'SPDXRef-npm-react-18.2.0', licenseConcluded: 'MIT' }, { name: 'com.github.o/r', versionInfo: 'main', SPDXID: 'SPDXRef-Repository' }] } });
        // ---- issues / planning
        if (p === '/issues') { if (method === 'POST') { const i = { number: 20 + state.issues.length, title: body.title, body: body.body, labels: (body.labels || []).map(n => ({ name: n, color: 'ededed' })), assignees: [], state: 'open', user: { login: 'nader' }, html_url: 'x', created_at: now(), updated_at: now() }; state.issues.push(i); return json(i, 201); } const st = q('state') || 'open'; return json(state.issues.filter(i => st === 'all' || i.state === st)); }
        if ((m = /^\/issues\/(\d+)$/.exec(p))) { const i = state.issues.find(x => x.number === +m[1]); if (!i) return notFound(); if (method === 'PATCH') { Object.assign(i, body); if (body.labels) i.labels = body.labels.map(n => ({ name: typeof n === 'string' ? n : n.name, color: 'ededed' })); if (body.assignees) i.assignees = body.assignees.map(l => ({ login: l })); if (body.milestone !== undefined) i.milestone = body.milestone ? state.milestones.find(x => x.number === body.milestone) : null; } return json(i); }
        if ((m = /^\/issues\/(\d+)\/labels$/.exec(p))) { const i = state.issues.find(x => x.number === +m[1]); if (method === 'POST') (body.labels || []).forEach(n => { if (!i.labels.some(l => l.name === n)) i.labels.push({ name: n, color: 'ededed' }); }); if (method === 'PUT') i.labels = body.labels.map(n => ({ name: n, color: 'ededed' })); return json(i.labels); }
        if ((m = /^\/issues\/(\d+)\/labels\/(.+)$/.exec(p)) && method === 'DELETE') { const i = state.issues.find(x => x.number === +m[1]); i.labels = i.labels.filter(l => l.name !== decodeURIComponent(m[2])); return json(i.labels); }
        if ((m = /^\/issues\/(\d+)\/comments$/.exec(p))) return method === 'POST' ? json({ id: 1, body: body.body }, 201) : json([]);
        if (p === '/labels') { if (method === 'POST') { if (state.labels.some(l => l.name.toLowerCase() === body.name.toLowerCase())) return json({ message: 'Validation Failed', errors: [{ code: 'already_exists' }] }, 422); const l = { id: 10 + state.labels.length, ...body }; state.labels.push(l); return json(l, 201); } return json(state.labels); }
        if ((m = /^\/labels\/(.+)$/.exec(p))) { const n = decodeURIComponent(m[1]); const l = state.labels.find(x => x.name === n); if (!l) return notFound(); if (method === 'DELETE') { state.labels = state.labels.filter(x => x !== l); return new Response(null, { status: 204 }); } if (method === 'PATCH') { Object.assign(l, body, body.new_name ? { name: body.new_name } : {}); return json(l); } return json(l); }
        if (p === '/milestones') { if (method === 'POST') { const ms = { number: 1 + state.milestones.length, state: 'open', open_issues: 0, closed_issues: 0, ...body }; state.milestones.push(ms); return json(ms, 201); } return json(state.milestones); }
        if ((m = /^\/milestones\/(\d+)$/.exec(p))) { const ms = state.milestones.find(x => x.number === +m[1]); if (method === 'DELETE') { state.milestones = state.milestones.filter(x => x !== ms); return new Response(null, { status: 204 }); } Object.assign(ms, body || {}); return json(ms); }
        if (p === '/assignees') return json([{ login: 'nader', avatar_url: 'https://a/n.png' }, { login: 'u1', avatar_url: 'https://a/u.png' }]);
        if (p === '/pulls') return json(state.pulls);
        if ((m = /^\/pulls\/(\d+)$/.exec(p))) return json({ ...state.pulls[0], additions: 10, deletions: 2, changed_files: 3 });
        // ---- actions
        if (p === '/actions/runs') return json({ total_count: 3, workflow_runs: [
            { id: 99, name: 'CI', display_title: 'fix build', run_number: 12, status: 'in_progress', conclusion: null, head_branch: 'main', head_sha: 'c0ffee1aa', event: 'push', created_at: daysAgo(0), updated_at: now(), run_started_at: daysAgo(0), html_url: 'x', workflow_id: 42 },
            { id: 98, name: 'CI', display_title: 'feat', run_number: 11, status: 'completed', conclusion: 'success', head_branch: 'main', head_sha: 'c0ffee1ab', event: 'push', created_at: daysAgo(1), updated_at: daysAgo(1), run_started_at: new Date(Date.now() - 86400000 - 300000).toISOString(), html_url: 'x', workflow_id: 42 },
            { id: 97, name: 'Deploy', display_title: 'deploy', run_number: 3, status: 'completed', conclusion: 'failure', head_branch: 'main', head_sha: 'c0ffee1ac', event: 'push', created_at: daysAgo(2), updated_at: daysAgo(2), run_started_at: new Date(Date.now() - 2 * 86400000 - 120000).toISOString(), html_url: 'x', workflow_id: 43 }] });
        if ((m = /^\/actions\/runs\/(\d+)$/.exec(p))) return json({ id: +m[1], name: 'CI', display_title: 'fix build', run_number: 12, status: state.liveDone ? 'completed' : 'in_progress', conclusion: state.liveDone ? 'success' : null, head_branch: 'main', head_sha: 'c0ffee1aa', html_url: 'x', created_at: now(), updated_at: now(), event: 'push' });
        if ((m = /^\/actions\/runs\/(\d+)\/jobs$/.exec(p))) return json({ jobs: [{ id: 501, name: 'test', status: state.liveDone ? 'completed' : 'in_progress', conclusion: state.liveDone ? 'success' : null, started_at: now(), steps: [{ number: 1, name: 'checkout', status: 'completed', conclusion: 'success' }, { number: 2, name: 'npm test', status: state.liveDone ? 'completed' : 'in_progress', conclusion: null }] }] });
        if ((m = /^\/actions\/jobs\/(\d+)\/logs$/.exec(p))) return new Response('2026-01-01T00:00:00.0000000Z \u001b[32mRun npm test\u001b[0m\n2026-01-01T00:00:01.0000000Z ##[group]Tests\n2026-01-01T00:00:02.0000000Z ok 1 - works', { status: 200, headers: { 'content-type': 'text/plain' } });
        if (p === '/actions/artifacts') return json({ total_count: 1, artifacts: [{ id: 61, name: 'dist', size_in_bytes: 4096, expired: false, created_at: now(), expires_at: daysAgo(-30), workflow_run: { id: 98, head_branch: 'main' } }] });
        if ((m = /^\/actions\/artifacts\/(\d+)$/.exec(p)) && method === 'DELETE') return new Response(null, { status: 204 });
        if ((m = /^\/actions\/artifacts\/(\d+)\/zip$/.exec(p))) return new Response(new Uint8Array([80, 75, 3, 4]), { status: 200, headers: { 'content-type': 'application/zip' } });
        if (p === '/actions/runners') return json({ total_count: 1, runners: [{ id: 1, name: 'self-1', os: 'Linux', status: 'online', busy: false, labels: [{ name: 'self-hosted' }, { name: 'linux' }] }] });
        if (p === '/actions/secrets/public-key') return json({ key_id: 'kid-1', key: KP.pub });
        if (p === '/actions/secrets') return json({ total_count: state.secrets.size, secrets: [...state.secrets.values()].map(s => ({ name: s.name, created_at: now(), updated_at: now() })) });
        if ((m = /^\/actions\/secrets\/([^/]+)$/.exec(p))) { const n = decodeURIComponent(m[1]); if (method === 'PUT') { state.secrets.set(n, { name: n, ...body }); return json(null, 201); } if (method === 'DELETE') { state.secrets.delete(n); return new Response(null, { status: 204 }); } }
        if (p === '/actions/variables') { if (method === 'POST') { state.variables.set(body.name, { ...body, updated_at: now() }); return json({}, 201); } return json({ total_count: state.variables.size, variables: [...state.variables.values()] }); }
        if ((m = /^\/actions\/variables\/([^/]+)$/.exec(p))) { const n = decodeURIComponent(m[1]); if (method === 'PATCH') { if (!state.variables.has(n)) return notFound(); state.variables.set(n, { ...state.variables.get(n), ...body, updated_at: now() }); return new Response(null, { status: 204 }); } if (method === 'DELETE') { state.variables.delete(n); return new Response(null, { status: 204 }); } }
        if (p === '/actions/cache/usage') return json({ active_caches_size_in_bytes: 1048576, active_caches_count: 2 });
        if (p === '/environments') return json({ total_count: state.envs.length, environments: state.envs });
        if ((m = /^\/environments\/([^/]+)$/.exec(p))) { const n = decodeURIComponent(m[1]); if (method === 'PUT') { if (!state.envs.some(e => e.name === n)) state.envs.push({ id: 2 + state.envs.length, name: n, protection_rules: [], updated_at: now() }); return json({ name: n }); } if (method === 'DELETE') { state.envs = state.envs.filter(e => e.name !== n); return new Response(null, { status: 204 }); } }
        // ---- settings
        if (p === '/hooks') { if (method === 'POST') { const h = { id: 8 + state.hooks.length, name: 'web', active: body.active !== false, events: body.events, config: body.config, updated_at: now() }; state.hooks.push(h); return json(h, 201); } return json(state.hooks); }
        if ((m = /^\/hooks\/(\d+)$/.exec(p))) { const h = state.hooks.find(x => x.id === +m[1]); if (method === 'DELETE') { state.hooks = state.hooks.filter(x => x !== h); return new Response(null, { status: 204 }); } if (method === 'PATCH') Object.assign(h, body); return json(h); }
        if ((m = /^\/hooks\/(\d+)\/pings$/.exec(p))) return new Response(null, { status: 204 });
        if (p === '/keys') { if (method === 'POST') { const k = { id: 30 + state.keys.length, title: body.title, key: body.key, read_only: body.read_only, created_at: now() }; state.keys.push(k); return json(k, 201); } return json(state.keys); }
        if ((m = /^\/keys\/(\d+)$/.exec(p)) && method === 'DELETE') { state.keys = state.keys.filter(k => k.id !== +m[1]); return new Response(null, { status: 204 }); }
        if (p === '/collaborators') return json(state.collaborators);
        if ((m = /^\/collaborators\/([^/]+)$/.exec(p))) { const l = decodeURIComponent(m[1]); if (method === 'PUT') { const ex = state.collaborators.find(c => c.login === l); if (ex) { ex.role_name = body.permission; return new Response(null, { status: 204 }); } const inv = { id: 80 + state.invitations.length, invitee: { login: l, avatar_url: 'https://a/i.png' }, permissions: body.permission, created_at: now() }; state.invitations.push(inv); return json(inv, 201); } if (method === 'DELETE') { state.collaborators = state.collaborators.filter(c => c.login !== l); return new Response(null, { status: 204 }); } }
        if (p === '/invitations') return json(state.invitations);
        if ((m = /^\/invitations\/(\d+)$/.exec(p)) && method === 'DELETE') { state.invitations = state.invitations.filter(i => i.id !== +m[1]); return new Response(null, { status: 204 }); }
        if (p === '/events') return json([{ type: 'PushEvent', actor: { login: 'nader', display_login: 'nader', avatar_url: 'https://a/n.png' }, payload: { ref: 'refs/heads/main', size: 3 }, created_at: now() }, { type: 'IssuesEvent', actor: { login: 'u1', avatar_url: 'https://a/u.png' }, payload: { action: 'opened', issue: { number: 3 } }, created_at: daysAgo(1) }, { type: 'WatchEvent', actor: { login: 'fan', avatar_url: 'https://a/f.png' }, payload: { action: 'started' }, created_at: daysAgo(2) }]);
        if (p === '/codespaces') return json({ total_count: 1, codespaces: [{ name: 'cs-1', display_name: 'fluffy', state: 'Available', git_status: { ref: 'main' }, web_url: 'https://cs' }] });
        if (p === '/releases') return json(state.releases);
        if ((m = /^\/releases\/(\d+)$/.exec(p))) return json(state.releases.find(r => r.id === +m[1]) || {});
        if ((m = /^\/releases\/assets\/(\d+)$/.exec(p)) && method === 'DELETE') { state.releases.forEach(r => { r.assets = r.assets.filter(a => a.id !== +m[1]); }); return new Response(null, { status: 204 }); }
        if (p === '/zipball/main') return new Response(new Uint8Array([80, 75, 5, 6]), { status: 200, headers: { 'content-type': 'application/zip' } });
        return notFound();
    }

    function graphql(body) {
        const qtxt = (body && body.query) || '';
        if (/blame/.test(qtxt)) {
            const shas = [...commits.keys()];
            return json({ data: { repository: { object: { blame: { ranges: [{ startingLine: 1, endingLine: 2, age: 3, commit: { oid: shas[0], abbreviatedOid: shas[0].slice(0, 7), messageHeadline: 'init', committedDate: daysAgo(10), author: { name: 'Nader', user: { login: 'nader' } } } }, { startingLine: 3, endingLine: 3, age: 9, commit: { oid: shas[1] || shas[0], abbreviatedOid: (shas[1] || shas[0]).slice(0, 7), messageHeadline: 'second', committedDate: daysAgo(1), author: { name: 'U1', user: { login: 'u1' } } } }] } } } } });
        }
        if (/sponsorsListing/.test(qtxt)) return json({ data: { repositoryOwner: { login: body.variables.login, avatarUrl: 'https://a/x.png', url: 'https://github.com/' + body.variables.login, hasSponsorsListing: true, sponsorsListing: { name: 'Sponsor me', shortDescription: 'Support OSS', tiers: { nodes: [{ name: 'Coffee', monthlyPriceInDollars: 5, isOneTime: false }] } }, sponsors: { totalCount: 1, nodes: [{ login: 'fan', avatarUrl: 'https://a/f.png', url: 'https://github.com/fan' }] }, sponsoring: { totalCount: 0, nodes: [] } } } });
        if (/projectsV2/.test(qtxt)) return json({ data: { repository: { projectsV2: { nodes: [{ id: 'PVT_1', number: 1, title: 'Roadmap', url: 'https://github.com/orgs/o/projects/1', closed: false, shortDescription: 'roadmap', items: { totalCount: 4 }, updatedAt: now() }] } }, viewer: { projectsV2: { nodes: [] } } } });
        if (/addProjectV2ItemById|createProjectV2/.test(qtxt)) return json({ data: { addProjectV2ItemById: { item: { id: 'I1' } }, createProjectV2: { projectV2: { id: 'PVT_2', number: 2, title: 'New', url: 'x' } } } });
        return json({ data: {} });
    }

    addRepo(`${owner}/${repo}`);
    addRepo('o/other');
    return { handle, log, state, repos, blobs, trees, commits, commit, addRepo, fileContent, filesOf, ancestors, KP, full: `${owner}/${repo}` };
}

module.exports = { createGitHub };
