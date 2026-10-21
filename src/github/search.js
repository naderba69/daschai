/* Search tab: code across all your repositories (#431), issues (#432), PRs (#433), commits, repositories. */
import { esc, call, encPath, shortSha, headline } from './shared.js';
import { btn, empty, input, select, val, avatar } from './core.js';

const SCOPES = {
    code: { placeholder: 'useState  أو  function login', where: [['mine', 'كل مستودعاتي'], ['this', 'هذا المستودع'], ['all', 'كل GitHub العام']] },
    issues: { placeholder: 'خطأ في تسجيل الدخول', where: [['open', 'مفتوحة'], ['closed', 'مغلقة'], ['all', 'الكل']] },
    prs: { placeholder: 'refactor', where: [['open', 'مفتوحة'], ['closed', 'مغلقة'], ['merged', 'مدموجة'], ['all', 'الكل']] },
    commits: { placeholder: 'fix: login', where: [['this', 'هذا المستودع'], ['mine', 'كل مستودعاتي']] },
    repos: { placeholder: 'react dashboard', where: [['all', 'كل GitHub'], ['mine', 'مستودعاتي']] }
};

/** Escape a text-match fragment and wrap the matched index ranges in <mark> (pure; tested). */
export function highlightFragment(fragment, matches) {
    const f = String(fragment || '');
    const ranges = (matches || []).map(m => m.indices || []).filter(r => r.length === 2 && r[0] < r[1] && r[1] <= f.length).sort((a, b) => a[0] - b[0]);
    let out = '', pos = 0;
    for (const [a, b] of ranges) { if (a < pos) continue; out += esc(f.slice(pos, a)) + '<mark>' + esc(f.slice(a, b)) + '</mark>'; pos = b; }
    return out + esc(f.slice(pos));
}

/** Build the GitHub search query string for a scope (pure; tested). */
export function buildSearchQuery(scope, q, where, { owner, repo, login }) {
    const parts = [String(q || '').trim()];
    const self = `repo:${owner}/${repo}`;
    if (scope === 'code') parts.push(where === 'this' ? self : where === 'mine' ? `user:${login || owner}` : '');
    if (scope === 'issues' || scope === 'prs') {
        parts.push(self, scope === 'issues' ? 'is:issue' : 'is:pr');
        if (where === 'open' || where === 'closed') parts.push(`is:${where}`);
        if (where === 'merged') parts.push('is:merged');
    }
    if (scope === 'commits') parts.push(where === 'mine' ? `user:${login || owner}` : self);
    if (scope === 'repos' && where === 'mine') parts.push(`user:${login || owner}`);
    return parts.filter(Boolean).join(' ');
}

export function installSearch(P) {
    P.ghxSearchState = function () { return (this._ghxSearch = this._ghxSearch || {}); };

    const section = async (app, scope) => {
        const st = app.ghxSearchState()[scope] || { q: '', where: SCOPES[scope].where[0][0] };
        const form = `<div class="gh-card gh-form"><div class="gh-row">${input('ghx-search-q', { value: st.q, placeholder: SCOPES[scope].placeholder, dir: 'auto', style: 'flex:1' })}
            ${select('ghx-search-where', SCOPES[scope].where, st.where, { style: 'width:auto' })}
            ${btn('بحث', `app.ghxDoSearch('${scope}')`, { icon: 'fa-magnifying-glass', primary: true })}</div>
            ${scope === 'code' ? '<div class="text-dim" style="font-size:0.72rem">يدعم صيغ GitHub: <code dir="ltr">language:js</code> <code dir="ltr">path:src</code> <code dir="ltr">extension:py</code> — البحث في الكود يحتاج رمز PAT</div>' : ''}</div>`
            .replace('<input id="ghx-search-q"', `<input onkeydown="if(event.key==='Enter')app.ghxDoSearch('${scope}')" id="ghx-search-q"`);
        if (!st.items) return form + empty('اكتب كلمة البحث ثم اضغط «بحث» أو Enter.');
        const head = `<div class="gh-item-meta" style="margin:6px 0">${(+st.total || 0).toLocaleString('en-US')} نتيجة لـ <code dir="ltr">${esc(st.query)}</code>${st.incomplete ? ' (جزئية)' : ''}</div>`;
        if (!st.items.length) return form + head + empty('لا نتائج.');
        return form + head + `<div class="gh-list">${st.items.map(it => renderItem(app, scope, it)).join('')}</div>`;
    };

    const renderItem = (app, scope, it) => {
        const { owner, repo } = app.ghRepo();
        const here = (full) => full && full.toLowerCase() === `${owner}/${repo}`.toLowerCase();
        if (scope === 'code') {
            const frag = (it.text_matches || []).map(m => `<pre class="ghx-frag">${highlightFragment(m.fragment, m.matches)}</pre>`).join('');
            return `<div class="gh-item ghx-result" onclick="${call(app, 'ghxOpenRemoteFile', it.repository.full_name, it.path)}" tabindex="0"><i class="fa-solid fa-file-code text-blue"></i><div class="gh-item-main">
                <div class="gh-item-title" dir="ltr" style="text-align:right">${esc(it.path)}</div><div class="gh-item-meta" dir="ltr">${esc(it.repository.full_name)}</div>${frag}</div></div>`;
        }
        if (scope === 'issues' || scope === 'prs') {
            const isPR = !!it.pull_request;
            const st = it.state === 'open' ? '<span class="gh-badge ok">مفتوح</span>' : (it.pull_request && it.pull_request.merged_at ? '<span class="gh-badge purple">مدموج</span>' : '<span class="gh-badge dim">مغلق</span>');
            const open = here((it.repository_url || '').split('/repos/')[1]) ? `app.${isPR ? 'ghOpenPR' : 'ghOpenIssue'}(${+it.number})` : `window.open(${JSON.stringify(it.html_url).replace(/"/g, '&quot;')},'_blank','noopener')`;
            return `<div class="gh-item ghx-result" onclick="${open}" tabindex="0"><i class="fa-solid ${isPR ? 'fa-code-pull-request' : 'fa-circle-dot'} text-emerald"></i><div class="gh-item-main">
                <div class="gh-item-title">${esc(it.title)} ${st}</div><div class="gh-item-meta">#${+it.number} • ${esc(it.user && it.user.login)} • ${app.ghTimeAgo(it.updated_at)} • 💬 ${+it.comments}
                ${(it.labels || []).map(l => `<span class="gh-label" style="--c:#${esc(l.color || '888')}">${esc(l.name)}</span>`).join('')}</div></div></div>`;
        }
        if (scope === 'commits') {
            return `<div class="gh-item ghx-result" ${here(it.repository && it.repository.full_name) ? `onclick="${call(app, 'ghxCommitView', it.sha)}"` : `onclick="window.open('${esc(it.html_url)}','_blank','noopener')"`} tabindex="0">${avatar(it.author)}<div class="gh-item-main">
                <div class="gh-item-title">${esc(headline(it.commit.message))}</div><div class="gh-item-meta"><code dir="ltr">${esc(shortSha(it.sha))}</code> • ${esc((it.author && it.author.login) || it.commit.author.name)} • ${app.ghTimeAgo(it.commit.author.date)} • <span dir="ltr">${esc(it.repository && it.repository.full_name)}</span></div></div></div>`;
        }
        return `<div class="gh-item static ghx-result"><i class="fa-solid fa-book text-blue"></i><div class="gh-item-main">
            <div class="gh-item-title" dir="ltr" style="text-align:right">${esc(it.full_name)} ${it.private ? '<span class="gh-badge warn">خاص</span>' : ''}</div>
            <div class="gh-item-meta">${esc(it.description || '')} • ⭐ ${+it.stargazers_count} • ${esc(it.language || '')} • ${app.ghTimeAgo(it.pushed_at)}</div></div>
            <div class="gh-item-actions">${btn('', call(app, 'ghxUseRepo', it.owner.login, it.name, it.default_branch), { icon: 'fa-check', title: 'تعيينه كمستودع نشط' })}<a class="sidebar-btn-util gh-btn" href="${esc(it.html_url)}" target="_blank" rel="noopener"><i class="fa-solid fa-up-right-from-square"></i></a></div></div>`;
    };

    P.ghxSearchCode = function () { return section(this, 'code'); };
    P.ghxSearchIssues = function () { return section(this, 'issues'); };
    P.ghxSearchPRs = function () { return section(this, 'prs'); };
    P.ghxSearchCommits = function () { return section(this, 'commits'); };
    P.ghxSearchRepos = function () { return section(this, 'repos'); };

    P.ghxDoSearch = async function (scope, qArg, whereArg) {
        const q = qArg != null ? qArg : val('ghx-search-q');
        const where = whereArg || val('ghx-search-where') || SCOPES[scope].where[0][0];
        const st = this.ghxSearchState();
        if (!q) { this.showToast('اكتب كلمة البحث', 'warning'); return; }
        if (scope === 'code' && !(this.settings.githubToken || '').trim()) { this.showToast('البحث في الكود يحتاج رمز GitHub PAT', 'warning'); return; }
        const { owner, repo } = this.ghRepo();
        let login = owner;
        if (where === 'mine') { try { const v = await this.ghViewer(); if (v) login = v.login; } catch (e) {} }
        const query = buildSearchQuery(scope, q, where, { owner, repo, login });
        const ep = { code: 'code', issues: 'issues', prs: 'issues', commits: 'commits', repos: 'repositories' }[scope];
        const accept = scope === 'code' ? 'application/vnd.github.text-match+json' : undefined;
        try {
            const r = await this.gh(`/search/${ep}?q=${encodeURIComponent(query)}&per_page=30`, { accept });
            st[scope] = { q, where, query, items: r.items || [], total: r.total_count, incomplete: r.incomplete_results };
        } catch (e) { st[scope] = { q, where, query, items: [], total: 0 }; this.showToast('❌ ' + e.message, 'error'); }
        if (this.ghTab === 'search' && !this.ghView) await this.ghxLoad('search', scope);
        return st[scope];
    };

    /** View any file of any repo (search results) + copy it into the workspace. */
    P.ghxOpenRemoteFile = function (fullName, path) {
        return this.ghxView('ghxOpenRemoteFile', [fullName, path], async () => {
            const f = await this.gh(`/repos/${fullName}/contents/${encPath(path)}`);
            const text = f && f.content ? this.b64ToUtf8(f.content) : '';
            this._ghxRemoteFile = { fullName, path, text };
            return `<div class="gh-detail-head"><h3 dir="ltr" style="text-align:right">${esc(path)}</h3><div class="gh-item-meta" dir="ltr">${esc(fullName)} • ${text.split('\n').length} lines</div></div>
                <div class="gh-toolbar">${btn('نسخ إلى مشروعي', 'app.ghxRemoteToWorkspace()', { icon: 'fa-file-import', primary: true })}${btn('نسخ', "app.ghxCopy(app._ghxRemoteFile.text)", { icon: 'fa-copy' })}
                    <a class="sidebar-btn-util gh-btn" href="${esc(f.html_url)}" target="_blank" rel="noopener"><i class="fa-solid fa-up-right-from-square"></i> GitHub</a></div>
                <pre class="ghx-pre ghx-code" dir="ltr">${esc(text.slice(0, 200000))}</pre>`;
        });
    };
    P.ghxRemoteToWorkspace = function () {
        const f = this._ghxRemoteFile;
        if (!f) return;
        this.writeProjectFile(f.path, f.text, 'github');
        this.showToast(`✅ أضيف ${f.path} إلى المشروع`, 'success');
    };

    /** Switch the active repository (used by search results, export, fork…). */
    P.ghxUseRepo = function (owner, repo, branch) {
        this.settings.githubOwner = owner;
        this.settings.githubRepo = repo;
        this.settings.githubBranch = branch || 'main';
        this.safeStorageSet('ox_alpha_settings_v2', JSON.stringify(this.settings));
        this._ghRepoInfo = null; this._ghPathsCache = null; this._ghxHistBranch = null; this._ghxReorder = null;
        if (this.renderUIState) this.renderUIState();
        const label = document.getElementById('gh-hub-repo');
        if (label) label.textContent = `${owner}/${repo}@${this.settings.githubBranch}`;
        this.showToast(`المستودع النشط: ${owner}/${repo}`, 'success');
    };
}
