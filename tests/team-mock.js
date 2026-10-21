/* In-memory GitHub REST for Sprint 11 (Team & Analytics): issues/comments/labels/reactions, pulls + reviews,
   commits, collaborators/invitations, contents, gists, milestones, search, following. */
'use strict';
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

function createTeamGitHub({ owner = 'o', repo = 'r', me = 'nader' } = {}) {
    let nextId = 1000;
    const id = () => ++nextId;
    const R = `/repos/${owner}/${repo}`;
    const html = (p) => `https://github.com/${owner}/${repo}${p}`;
    const state = {
        me, labels: [{ name: 'bug', color: 'd73a4a' }],
        issues: [
            { number: 1, title: 'Bug: login page crashes on submit', body: 'TypeError: cannot read properties of undefined', state: 'open', user: { login: 'u1' }, labels: [{ name: 'bug' }], assignee: null, assignees: [], created_at: daysAgo(12), closed_at: null, comments: [], reactions: [], milestone: { title: 'v1', due_on: daysAgo(-5) } },
            { number: 2, title: 'Add dark mode toggle to the UI', body: 'css + react component', state: 'open', user: { login: 'u2' }, labels: [], assignee: null, assignees: [], created_at: daysAgo(4), closed_at: null, comments: [], reactions: [], milestone: null },
            { number: 3, title: 'Bug: login crash when password empty', body: 'fixed by validating input', state: 'closed', user: { login: me }, labels: [{ name: 'bug' }], assignee: { login: me }, assignees: [{ login: me }], created_at: daysAgo(20), closed_at: daysAgo(15), comments: [], reactions: [], milestone: null },
            { number: 4, title: 'Write API docs', body: '', state: 'closed', user: { login: 'u1' }, labels: [], assignee: { login: 'u1' }, assignees: [{ login: 'u1' }], created_at: daysAgo(9), closed_at: daysAgo(2), comments: [], reactions: [], milestone: null }
        ],
        pulls: [
            { number: 9, title: 'Add feature', body: 'feature body', state: 'open', user: { login: 'u1' }, merged_at: null, created_at: daysAgo(3), updated_at: daysAgo(1), additions: 12, deletions: 2, head: { ref: 'feature', sha: 'h9' }, base: { ref: 'main' }, requested_reviewers: [{ login: me }],
                files: [{ filename: 'utils.js', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1,2 +1,3 @@\n export const add = (a, b) => a + b;\n-export const sub = (a, b) => a - b;\n+export const sub = (a, b) => a - b; // fixed\n+export const mul = (a, b) => a * b;' }], reviews: [], comments: [] },
            { number: 8, title: 'Refactor utils', body: '', state: 'closed', user: { login: me }, merged_at: daysAgo(2), created_at: daysAgo(4), updated_at: daysAgo(2), additions: 30, deletions: 10, head: { ref: 'refactor', sha: 'h8' }, base: { ref: 'main' }, requested_reviewers: [], files: [], reviews: [{ id: 81, user: { login: 'u1' }, state: 'APPROVED', body: 'lgtm' }], comments: [] }
        ],
        commits: [
            { sha: 'c1', author: { login: me }, commit: { message: 'feat: utils', author: { name: me, date: daysAgo(1) } }, files: [{ filename: 'utils.js' }, { filename: 'app.js' }] },
            { sha: 'c2', author: { login: 'u1' }, commit: { message: 'fix: utils', author: { name: 'u1', date: daysAgo(0.5) } }, files: [{ filename: 'utils.js' }, { filename: 'styles/main.css' }] },
            { sha: 'c3', author: { login: me }, commit: { message: 'docs', author: { name: me, date: daysAgo(3) } }, files: [{ filename: 'README.md' }] }
        ],
        issueComments: [], // flat list for /issues/comments
        collaborators: [{ login: me, avatar_url: 'https://a/n.png', permissions: { admin: true, push: true, pull: true } }, { login: 'u1', avatar_url: 'https://a/u1.png', permissions: { push: true, pull: true } }, { login: 'u2', avatar_url: 'https://a/u2.png', permissions: { pull: true } }],
        invitations: [], milestones: [{ number: 1, title: 'v1', state: 'open', open_issues: 1, closed_issues: 2, due_on: daysAgo(-5), html_url: html('/milestone/1') }],
        contents: new Map(), gists: new Map(), gistComments: new Map(), following: new Set(['octocat']), transfers: [], generated: []
    };
    const log = [], misses = [];
    const J = (data, status = 200) => new Response(data == null ? '' : JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    const page = (arr, q) => { const per = +(q.get('per_page') || 30), p = +(q.get('page') || 1); return arr.slice((p - 1) * per, p * per); };
    const issueOut = (i) => ({ ...i, comments: i.comments.length, reactions: { total_count: i.reactions.length, '+1': i.reactions.filter(r => r.content === '+1').length, '-1': i.reactions.filter(r => r.content === '-1').length }, html_url: html('/issues/' + i.number), url: `https://api.github.com${R}/issues/${i.number}` });
    const findIssue = (n) => state.issues.find(i => i.number === +n);
    const allNumbers = () => state.issues.map(i => i.number).concat(state.pulls.map(p => p.number));

    async function handle(url, opts = {}) {
        const u = new URL(url);
        const p = decodeURIComponent(u.pathname), q = u.searchParams, m = (opts.method || 'GET').toUpperCase();
        const body = opts.body ? JSON.parse(opts.body) : {};
        log.push(`${m} ${p}${u.search}`);
        let x;
        if (p === '/user' && m === 'GET') return J({ login: me, name: 'Nader', avatar_url: 'https://a/n.png' });
        if (p === '/user/following') return J([...state.following].map(l => ({ login: l, avatar_url: '' })));
        if ((x = /^\/user\/following\/(.+)$/.exec(p))) { if (m === 'PUT') state.following.add(x[1]); if (m === 'DELETE') state.following.delete(x[1]); return J(null, 204); }
        if ((x = /^\/users\/([^/]+)\/events\/public$/.exec(p))) return J([{ id: 'e1', type: 'PushEvent', repo: { name: x[1] + '/proj' }, created_at: daysAgo(0.1), payload: {} }]);
        if (p === '/user/repository_invitations') return J([]);
        if (p === '/search/issues') return J({ items: [{ title: 'Good first issue: typo', html_url: 'https://github.com/x/y/issues/1', repository_url: 'https://api.github.com/repos/x/y' }] });
        if (p === '/search/repositories') return J({ items: [{ full_name: 'acme/starter', description: 'A template', stargazers_count: 5, html_url: 'https://github.com/acme/starter', default_branch: 'main', is_template: true, owner: { login: 'acme' }, name: 'starter' }] });
        if (p === '/gists' && m === 'POST') { const g = { id: 'g' + id(), html_url: 'https://gist.github.com/g', owner: { login: me }, description: body.description, public: body.public, files: Object.fromEntries(Object.entries(body.files).map(([k, v]) => [k, { filename: k, content: v.content }])) }; state.gists.set(g.id, g); return J(g, 201); }
        if ((x = /^\/gists\/([^/]+)\/comments$/.exec(p))) { const list = state.gistComments.get(x[1]) || []; if (m === 'POST') { const c = { id: id(), body: body.body, user: { login: me }, created_at: new Date().toISOString() }; list.push(c); state.gistComments.set(x[1], list); return J(c, 201); } return J(list); }
        if ((x = /^\/gists\/([^/]+)$/.exec(p))) { const g = state.gists.get(x[1]); if (!g) return J({ message: 'Not Found' }, 404); if (m === 'DELETE') { state.gists.delete(x[1]); return J(null, 204); } if (m === 'PATCH') { Object.entries(body.files || {}).forEach(([k, v]) => { if (v === null) delete g.files[k]; else g.files[k] = { filename: k, content: v.content }; }); return J(g); } return J(g); }
        if ((x = /^\/repos\/([^/]+\/[^/]+)\/languages$/.exec(p))) return J({ JavaScript: 52000, CSS: 8000 });
        if ((x = /^\/repos\/([^/]+\/[^/]+)\/git\/trees\/.+$/.exec(p))) return J({ tree: [{ path: 'src/a.js', type: 'blob' }, { path: 'src/a.test.js', type: 'blob' }, { path: 'README.md', type: 'blob' }] });
        if ((x = /^\/repos\/([^/]+\/[^/]+)\/generate$/.exec(p))) { state.generated.push(body); return J({ full_name: `${body.owner}/${body.name}`, html_url: 'https://github.com/' + body.owner + '/' + body.name }, 201); }
        if (!p.startsWith(R)) { if ((x = /^\/repos\/([^/]+)\/([^/]+)$/.exec(p))) return J({ full_name: `${x[1]}/${x[2]}`, default_branch: 'main', stargazers_count: 10, open_issues_count: 2, size: 100 }); misses.push(`${m} ${p}`); return J({ message: 'Not Found' }, 404); }
        const r = p.slice(R.length) || '/';
        if (r === '/' && m === 'GET') return J({ full_name: `${owner}/${repo}`, default_branch: 'main', permissions: { admin: true, push: true, pull: true }, stargazers_count: 3, open_issues_count: 2 });
        if (r === '/transfer' && m === 'POST') { state.transfers.push(body); return J({ full_name: `${body.new_owner}/${repo}` }, 202); }
        if (r === '/labels' && m === 'POST') { if (state.labels.some(l => l.name === body.name)) return J({ message: 'Validation Failed' }, 422); state.labels.push({ name: body.name, color: body.color }); return J(body, 201); }
        if (r === '/labels') return J(state.labels);
        if (r === '/collaborators') return J(page(state.collaborators, q));
        if ((x = /^\/collaborators\/([^/]+)$/.exec(r))) {
            if (m === 'PUT') { const inv = { id: id(), invitee: { login: x[1] }, permissions: body.permission || 'push', created_at: new Date().toISOString() }; state.invitations.push(inv); return J(inv, 201); }
            if (m === 'DELETE') { state.collaborators = state.collaborators.filter(c => c.login !== x[1]); return J(null, 204); }
            return state.collaborators.some(c => c.login === x[1]) ? J(null, 204) : J({ message: 'Not Found' }, 404);
        }
        if (r === '/invitations') return J(state.invitations);
        if ((x = /^\/invitations\/(\d+)$/.exec(r))) { if (m === 'DELETE') state.invitations = state.invitations.filter(i => i.id !== +x[1]); if (m === 'PATCH') { const i = state.invitations.find(v => v.id === +x[1]); if (i) i.permissions = body.permissions; } return J(null, 204); }
        if (r === '/milestones') return J(state.milestones);
        // contents
        if ((x = /^\/contents\/(.+)$/.exec(r))) {
            const path = x[1];
            if (m === 'PUT') { state.contents.set(path, { content: Buffer.from(body.content, 'base64').toString('utf8'), sha: 's' + id() }); return J({ content: { path, sha: state.contents.get(path).sha } }, 201); }
            if (m === 'DELETE') { state.contents.delete(path); return J({ commit: {} }); }
            const f = state.contents.get(path);
            return f ? J({ path, sha: f.sha, encoding: 'base64', content: Buffer.from(f.content, 'utf8').toString('base64') }) : J({ message: 'Not Found' }, 404);
        }
        // commits
        if (r === '/commits') { const since = q.get('since') ? new Date(q.get('since')).getTime() : 0; return J(page(state.commits.filter(c => new Date(c.commit.author.date).getTime() >= since), q)); }
        if ((x = /^\/commits\/([^/]+)$/.exec(r))) { const c = state.commits.find(v => v.sha === x[1]); return c ? J(c) : J({ message: 'Not Found' }, 404); }
        // pulls
        if (r === '/pulls/comments') return J(page(state.pulls.flatMap(pr => pr.comments.map(c => ({ ...c, pull_request_url: `https://api.github.com${R}/pulls/${pr.number}` }))), q));
        if ((x = /^\/pulls\/comments\/(\d+)$/.exec(r))) { for (const pr of state.pulls) { const c = pr.comments.find(v => v.id === +x[1]); if (c) { if (m === 'PATCH') Object.assign(c, body); if (m === 'DELETE') pr.comments = pr.comments.filter(v => v !== c); return J(c); } } return J({ message: 'Not Found' }, 404); }
        if (r === '/pulls') { const st = q.get('state') || 'open'; return J(page(state.pulls.filter(pr => st === 'all' || pr.state === st).map(({ files, reviews, comments, ...rest }) => ({ ...rest, html_url: html('/pull/' + rest.number) })), q)); }
        if ((x = /^\/pulls\/(\d+)(\/.*)?$/.exec(r))) {
            const pr = state.pulls.find(v => v.number === +x[1]); if (!pr) return J({ message: 'Not Found' }, 404);
            const sub = x[2] || '';
            if (sub === '/files') return J(page(pr.files, q));
            if (sub === '/reviews' && m === 'POST') { const rv = { id: id(), user: { login: me }, state: body.event === 'APPROVE' ? 'APPROVED' : body.event === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : 'COMMENTED', body: body.body, submitted_at: new Date().toISOString() }; pr.reviews.push(rv); (body.comments || []).forEach(c => pr.comments.push({ id: id(), user: { login: me }, body: c.body, path: c.path, line: c.line, side: c.side || 'RIGHT', created_at: new Date().toISOString(), html_url: html('/pull/' + pr.number) })); return J(rv, 200); }
            if (sub === '/reviews') return J(pr.reviews);
            if (sub === '/comments' && m === 'POST') { const c = { id: id(), user: { login: me }, body: body.body, path: body.path, line: body.line, side: body.side || 'RIGHT', commit_id: body.commit_id, created_at: new Date().toISOString(), html_url: html('/pull/' + pr.number) }; pr.comments.push(c); return J(c, 201); }
            if (sub === '/comments') return J(pr.comments);
            if ((x = /^\/comments\/(\d+)\/replies$/.exec(sub))) { const c = { id: id(), user: { login: me }, body: body.body, in_reply_to_id: +x[1], created_at: new Date().toISOString() }; pr.comments.push(c); return J(c, 201); }
            if (m === 'PATCH') { Object.assign(pr, body); return J(pr); }
            const { files, reviews, comments, ...rest } = pr;
            return J({ ...rest, html_url: html('/pull/' + pr.number) });
        }
        // issues
        if (r === '/issues/comments') { const since = q.get('since') ? new Date(q.get('since')).getTime() : 0; return J(page(state.issueComments.filter(c => new Date(c.created_at).getTime() > since), q)); }
        if (r === '/issues' && m === 'POST') {
            const n = Math.max(...allNumbers()) + 1;
            (body.labels || []).forEach(l => { if (!state.labels.some(v => v.name === l)) state.labels.push({ name: l }); });
            const i = { number: n, title: body.title, body: body.body || '', state: 'open', user: { login: me }, labels: (body.labels || []).map(name => ({ name })), assignee: null, assignees: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), closed_at: null, comments: [], reactions: [], milestone: null, locked: false };
            state.issues.push(i); return J(issueOut(i), 201);
        }
        if (r === '/issues') {
            const st = q.get('state') || 'open', labels = (q.get('labels') || '').split(',').filter(Boolean), since = q.get('since') ? new Date(q.get('since')).getTime() : 0;
            const list = state.issues.filter(i => (st === 'all' || i.state === st) && labels.every(l => i.labels.some(v => v.name === l)) && new Date(i.updated_at || i.closed_at || i.created_at).getTime() >= since).sort((a, b) => b.number - a.number);
            return J(page(list.map(issueOut), q));
        }
        if ((x = /^\/issues\/(\d+)(\/.*)?$/.exec(r))) {
            const i = findIssue(x[1]); if (!i) return J({ message: 'Not Found' }, 404);
            const sub = x[2] || '';
            if (sub === '/comments' && m === 'POST') { const c = { id: id(), user: { login: me, avatar_url: '' }, body: body.body, created_at: new Date(Date.now() + i.comments.length).toISOString(), html_url: html('/issues/' + i.number), issue_url: `https://api.github.com${R}/issues/${i.number}` }; i.comments.push(c); state.issueComments.push(c); i.updated_at = c.created_at; return J(c, 201); }
            if (sub === '/comments') return J(page(i.comments, q));
            if (sub === '/reactions' && m === 'POST') { if (!i.reactions.some(v => v.user.login === me && v.content === body.content)) i.reactions.push({ id: id(), user: { login: me }, content: body.content }); return J(i.reactions[i.reactions.length - 1], 201); }
            if (sub === '/reactions') return J(i.reactions);
            if ((x = /^\/reactions\/(\d+)$/.exec(sub))) { i.reactions = i.reactions.filter(v => v.id !== +x[1]); return J(null, 204); }
            if (sub === '/labels' && m === 'POST') { (body.labels || []).forEach(l => { if (!i.labels.some(v => v.name === l)) i.labels.push({ name: l }); }); return J(i.labels); }
            if (sub === '/assignees' && m === 'POST') { i.assignees = (body.assignees || []).map(login => ({ login })); i.assignee = i.assignees[0] || null; return J(issueOut(i), 201); }
            if (sub === '/lock') { i.locked = m === 'PUT'; return J(null, 204); }
            if (m === 'PATCH') { if (body.state === 'closed' && i.state !== 'closed') i.closed_at = new Date().toISOString(); if (body.state === 'open') i.closed_at = null; if (body.labels) body.labels = body.labels.map(l => (typeof l === 'string' ? { name: l } : l)); Object.assign(i, body); i.updated_at = new Date().toISOString(); return J(issueOut(i)); }
            return J(issueOut(i));
        }
        misses.push(`${m} ${p}`);
        return J({ message: 'Not Found' }, 404);
    }
    return { handle, state, log, misses };
}

module.exports = { createTeamGitHub };
