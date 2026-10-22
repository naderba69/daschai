/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 3b: GitHub Hub (PRs, Actions, Issues, Branches,
   Releases, Deploy, Insights) — all from inside the workbench.
   Ideas implemented (THOUSAND_IDEAS.md):
     #411-#414 branches (list, create, delete, compare)   #415 direct branch merge
     #416-#418 PRs (create, list, review + comments)      #419/#420 approve / request changes
     #424 squash merge   #434/#435 issues   #441-#443 Actions (list, manual run, rerun failed)
     #451/#452/#454 releases + generated notes   #457/#461 contributors + languages
     #501 .gitignore   #521-#523 GitHub Pages   #62 AI PR description   #102/#103 CI + Docker
   Requires 04-git-diff.js (gh client, commit review flow, patch renderer).
   ============================================================================== */
(function () {
    'use strict';
    if (typeof OXAlphaApp === 'undefined') return;
    const P = OXAlphaApp.prototype;

    const TABS = [
        { id: 'prs', icon: 'fa-code-pull-request', label: 'Pull Requests' },
        { id: 'actions', icon: 'fa-circle-play', label: 'Actions' },
        { id: 'issues', icon: 'fa-circle-dot', label: 'Issues' },
        { id: 'branches', icon: 'fa-code-branch', label: 'الفروع' },
        { id: 'releases', icon: 'fa-tag', label: 'الإصدارات' },
        { id: 'deploy', icon: 'fa-rocket', label: 'النشر' },
        { id: 'insights', icon: 'fa-chart-simple', label: 'إحصائيات' }
    ];
    P.GH_TABS = TABS;

    // ------------------------------------------------------------------ HELPERS
    const rtf = (typeof Intl !== 'undefined' && Intl.RelativeTimeFormat) ? new Intl.RelativeTimeFormat('ar', { numeric: 'auto' }) : null;
    function timeAgo(iso) {
        if (!iso) return '';
        const s = (new Date(iso).getTime() - Date.now()) / 1000;
        const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
        for (const [u, sec] of units) if (Math.abs(s) >= sec) return rtf ? rtf.format(Math.round(s / sec), u) : new Date(iso).toLocaleString();
        return rtf ? rtf.format(Math.round(s), 'second') : 'الآن';
    }
    P.ghTimeAgo = timeAgo;

    /** Next semantic version for a tag like v1.2.3 */
    function nextSemver(tag, kind = 'patch') {
        const m = /^(v?)(\d+)\.(\d+)\.(\d+)/.exec(tag || '');
        if (!m) return 'v1.0.0';
        let [maj, min, pat] = [+m[2], +m[3], +m[4]];
        if (kind === 'major') { maj++; min = 0; pat = 0; } else if (kind === 'minor') { min++; pat = 0; } else pat++;
        return `${m[1]}${maj}.${min}.${pat}`;
    }
    P.nextSemver = nextSemver;

    P.renderMarkdownSafe = function (md) {
        if (!md) return '';
        try {
            if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') return DOMPurify.sanitize(marked.parse(String(md)));
        } catch (e) {}
        return `<div style="white-space:pre-wrap">${this.escapeHTML(md)}</div>`;
    };

    /** Values used in onclick handlers are stored by index (no quoting/escaping pitfalls). */
    P.ghRef = function (v) { (this._ghRefs = this._ghRefs || []).push(v); return this._ghRefs.length - 1; };
    P.ghVal = function (i) { return (this._ghRefs || [])[i]; };
    P.ghCall = function (method, ...refIdx) { const fn = this[method]; if (typeof fn === 'function') return fn.apply(this, refIdx.map(i => this.ghVal(i))); };
    const call = (app, method, ...vals) => `app.ghCall('${method}'${vals.map(v => ',' + app.ghRef(v)).join('')})`;

    const statusBadge = (status, conclusion) => {
        const s = status !== 'completed' ? status : conclusion;
        const map = {
            success: ['ok', 'fa-circle-check', 'نجح'], failure: ['bad', 'fa-circle-xmark', 'فشل'], cancelled: ['dim', 'fa-ban', 'أُلغي'],
            skipped: ['dim', 'fa-forward', 'تخطي'], timed_out: ['bad', 'fa-clock', 'انتهت المهلة'], action_required: ['warn', 'fa-hand', 'يتطلب إجراء'],
            neutral: ['dim', 'fa-circle', 'محايد'], in_progress: ['run', 'fa-spinner fa-spin', 'قيد التشغيل'], queued: ['warn', 'fa-hourglass', 'في الانتظار'],
            waiting: ['warn', 'fa-hourglass', 'ينتظر'], pending: ['warn', 'fa-hourglass', 'معلق']
        };
        const [cls, icon, label] = map[s] || ['dim', 'fa-circle', s || '—'];
        return `<span class="gh-badge ${cls}"><i class="fa-solid ${icon}"></i> ${label}</span>`;
    };
    P.ghStatusBadge = statusBadge;

    P.ghBody = function () { return document.getElementById('gh-hub-body'); };
    P.ghSetBody = function (html) { const b = this.ghBody(); if (b) b.innerHTML = html; };
    P.ghLoading = function (msg = 'جاري التحميل من GitHub...') {
        this._ghRefs = [];
        this.ghSetBody(`<div class="gh-empty"><span class="live-step-spinner"></span> ${msg}</div>`);
    };
    P.ghError = function (e) {
        const needToken = e && (e.status === 401 || e.status === 403 || e.status === 404) && !this.settings.githubToken?.trim();
        this.ghSetBody(`<div class="gh-empty bad">❌ ${this.escapeHTML(e?.message || String(e))}
            ${needToken ? `<div style="margin-top:10px"><button class="btn-new-thread gh-btn" onclick="app.closeModals(); app.openSettingsModal(); app.switchSettingsTab('tab-github')"><i class="fa-solid fa-key"></i> إضافة رمز GitHub</button></div>` : ''}
            <div style="margin-top:8px"><button class="sidebar-btn-util gh-btn" onclick="app.refreshGitHubHub()"><i class="fa-solid fa-rotate"></i> إعادة المحاولة</button></div></div>`);
    };
    P.ghRequireToken = function () {
        if (this.settings.githubToken?.trim()) return true;
        this.showToast('⚠️ هذه العملية تحتاج رمز GitHub PAT (الإعدادات ← GitHub)', 'warning');
        return false;
    };
    P.ghRepoPath = function () { const { owner, repo } = this.ghRepo(); return `/repos/${owner}/${repo}`; };

    P.renderGhRate = function () {
        const el = document.getElementById('gh-hub-rate');
        const r = this._ghRate;
        if (!el || !r) return;
        const mins = r.reset ? Math.max(0, Math.round((r.reset * 1000 - Date.now()) / 60000)) : 0;
        el.textContent = `API ${r.remaining}/${r.limit}`;
        el.className = 'gh-rate' + (r.remaining < Math.max(10, r.limit * 0.1) ? ' low' : '');
        el.title = `طلبات GitHub المتبقية: ${r.remaining} من ${r.limit} — تتجدد خلال ${mins} دقيقة`;
    };

    P.ghRepoInfo = async function (force = false) {
        const key = this.ghRepoPath();
        if (!force && this._ghRepoInfo && this._ghRepoInfo.key === key) return this._ghRepoInfo.data;
        const data = await this.gh(key);
        this._ghRepoInfo = { key, data };
        return data;
    };

    // ------------------------------------------------------------------ HUB SHELL
    P.openGitHubHub = function (tab) {
        this.closeModals();
        const modal = document.getElementById('gh-hub-modal');
        if (!modal) return;
        const { owner, repo, branch } = this.ghRepo();
        document.getElementById('gh-hub-repo').textContent = `${owner}/${repo}@${branch}`;
        modal.classList.add('active');
        return this.switchGhTab(tab || this.ghTab || 'prs');
    };
    P.openBranchManagerModal = function () { this.openGitHubHub('branches'); };

    P.renderGhTabs = function () {
        const el = document.getElementById('gh-hub-tabs');
        if (!el) return;
        el.innerHTML = TABS.map(t => `<button class="gh-tab ${t.id === this.ghTab ? 'active' : ''}" role="tab" aria-selected="${t.id === this.ghTab}" onclick="app.switchGhTab('${t.id}')"><i class="fa-solid ${t.icon}"></i><span>${t.label}</span></button>`).join('');
    };

    P.switchGhTab = function (tab) {
        if (!TABS.some(t => t.id === tab)) tab = 'prs';
        this.ghTab = tab;
        this.ghView = null;
        clearTimeout(this._ghActionsTimer);
        this.renderGhTabs();
        return this.refreshGitHubHub();
    };

    P.refreshGitHubHub = async function () {
        const icon = document.getElementById('gh-hub-refresh-icon');
        if (icon) icon.classList.add('fa-spin');
        try {
            const v = this.ghView;
            if (v && typeof this[v.fn] === 'function') return await this[v.fn](...(v.args || []));
            const loaders = { prs: 'ghLoadPRs', actions: 'ghLoadRuns', issues: 'ghLoadIssues', branches: 'ghLoadBranches', releases: 'ghLoadReleases', deploy: 'ghLoadDeploy', insights: 'ghLoadInsights' };
            return await this[loaders[this.ghTab || 'prs']]();
        } finally { if (icon) icon.classList.remove('fa-spin'); }
    };
    const setView = (app, fn, ...args) => { app.ghView = { fn, args }; };
    const backBtn = (label = 'رجوع') => `<button class="sidebar-btn-util gh-btn" onclick="app.ghView=null; app.refreshGitHubHub()"><i class="fa-solid fa-arrow-right"></i> ${label}</button>`;

    // ------------------------------------------------------------------ AI HELPER
    P.ghAI = async function (prompt, { category = 'coding', maxTokens = 1500, targetId, source = 'github' } = {}) {
        if (!this.settings.apiKey?.trim() || !this.streamOpenRouter) { this.showToast('يلزم مفتاح OpenRouter في الإعدادات', 'warning'); return null; }
        const model = (this.routeForCategory && this.routeForCategory(category)) || this.settings.model;
        const target = targetId ? document.getElementById(targetId) : null;
        if (target) target.innerHTML = '<span class="live-step-spinner"></span> الذكاء الاصطناعي يحلل...';
        try {
            const r = await this.streamOpenRouter({
                model, maxTokens,
                messages: [{ role: 'user', content: prompt }],
                onDelta: (c) => { if (target) target.innerHTML = this.renderMarkdownSafe(c); }
            });
            if (target) target.innerHTML = this.renderMarkdownSafe(r.content);
            if (this.recordUsage) this.recordUsage({ model, usage: r.usage, promptChars: prompt.length, completionChars: (r.content || '').length, durationMs: r.durationMs, source });
            return r.content;
        } catch (e) {
            if (target) target.innerHTML = `<span class="text-red">❌ ${this.escapeHTML(e.message)}</span>`;
            return null;
        }
    };

    // ================================================================== PULL REQUESTS
    P.ghLoadPRs = async function (state) {
        this._ghPrState = state || this._ghPrState || 'open';
        this.ghLoading();
        try {
            const prs = await this.gh(`${this.ghRepoPath()}/pulls?state=${this._ghPrState}&per_page=30&sort=updated&direction=desc`);
            const filter = ['open', 'closed', 'all'].map(s => `<button class="gh-chip ${s === this._ghPrState ? 'active' : ''}" onclick="app.ghLoadPRs('${s}')">${{ open: 'مفتوحة', closed: 'مغلقة', all: 'الكل' }[s]}</button>`).join('');
            this.ghSetBody(`
                <div class="gh-toolbar">${filter}<span class="gh-spacer"></span>
                    <button class="btn-new-thread gh-btn" onclick="app.ghShowCreatePR()"><i class="fa-solid fa-plus"></i> PR جديد</button></div>
                ${prs.length ? `<div class="gh-list">${prs.map(pr => `
                    <div class="gh-item" onclick="app.ghOpenPR(${+pr.number})" tabindex="0">
                        <i class="fa-solid ${pr.merged_at ? 'fa-code-merge text-purple' : pr.state === 'open' ? 'fa-code-pull-request text-emerald' : 'fa-circle-xmark text-red'}"></i>
                        <div class="gh-item-main">
                            <div class="gh-item-title">${this.escapeHTML(pr.title)} ${pr.draft ? '<span class="gh-badge dim">مسودة</span>' : ''}</div>
                            <div class="gh-item-meta">#${+pr.number} • <span dir="ltr">${this.escapeHTML(pr.head?.ref)} → ${this.escapeHTML(pr.base?.ref)}</span> • ${this.escapeHTML(pr.user?.login)} • ${timeAgo(pr.updated_at)}</div>
                        </div>
                    </div>`).join('')}</div>` : '<div class="gh-empty">لا توجد Pull Requests هنا.</div>'}`);
        } catch (e) { this.ghError(e); }
    };

    P.ghShowCreatePR = async function (head) {
        if (!this.ghRequireToken()) return;
        setView(this, 'ghShowCreatePR', head);
        this.ghLoading('جاري تحميل الفروع...');
        try {
            const [info, branches] = await Promise.all([this.ghRepoInfo(), this.gh(`${this.ghRepoPath()}/branches?per_page=100`)]);
            const def = info.default_branch || 'main';
            const cur = head || (this.ghRepo().branch !== def ? this.ghRepo().branch : (branches.find(b => b.name !== def) || {}).name || '');
            const opts = (sel) => branches.map(b => `<option value="${this.escapeHTML(b.name)}" ${b.name === sel ? 'selected' : ''}>${this.escapeHTML(b.name)}</option>`).join('');
            this.ghSetBody(`
                <div class="gh-toolbar">${backBtn()}<b>Pull Request جديد</b></div>
                <div class="gh-form">
                    <div class="gh-row"><label>من الفرع (head)</label><select id="gh-pr-head" class="form-input-box" dir="ltr">${opts(cur)}</select>
                        <label>إلى (base)</label><select id="gh-pr-base" class="form-input-box" dir="ltr">${opts(def)}</select></div>
                    <input id="gh-pr-title" class="form-input-box" placeholder="عنوان الـ PR" value="${this.escapeHTML(cur ? cur.replace(/[-_/]/g, ' ') : '')}">
                    <textarea id="gh-pr-body" class="form-input-box" rows="8" placeholder="الوصف (Markdown)"></textarea>
                    <label class="gh-check"><input type="checkbox" id="gh-pr-draft"> مسودة (Draft)</label>
                    <div class="gh-toolbar">
                        <button class="sidebar-btn-util gh-btn" onclick="app.ghAIDescribePR()"><i class="fa-solid fa-wand-magic-sparkles"></i> وصف بالذكاء الاصطناعي</button>
                        <span class="gh-spacer"></span>
                        <button class="btn-new-thread gh-btn" id="gh-pr-create-btn" onclick="app.ghCreatePR()"><i class="fa-solid fa-code-pull-request"></i> إنشاء PR</button>
                    </div>
                </div>`);
        } catch (e) { this.ghError(e); }
    };

    P.ghCompare = function (base, head) {
        return this.gh(`${this.ghRepoPath()}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
    };

    P.ghAIDescribePR = async function () {
        const base = document.getElementById('gh-pr-base')?.value, head = document.getElementById('gh-pr-head')?.value;
        const bodyEl = document.getElementById('gh-pr-body');
        if (!base || !head || base === head) { this.showToast('اختر فرعين مختلفين', 'warning'); return; }
        try {
            const cmp = await this.ghCompare(base, head);
            const commits = (cmp.commits || []).map(c => '- ' + (c.commit?.message || '').split('\n')[0]).join('\n');
            const files = (cmp.files || []).slice(0, 30).map(f => `### ${f.filename} (+${f.additions} -${f.deletions})\n${(f.patch || '').slice(0, 1500)}`).join('\n');
            if (bodyEl) bodyEl.value = '✨ ...';
            const text = await this.ghAI(`Write a GitHub pull request description in Markdown (in the same language as the commit messages; Arabic if unsure). Sections: ## الملخص, ## التغييرات (bullets), ## الاختبار. Be concise. First line must be "TITLE: <short title>".\nCommits:\n${commits}\n\nDiff:\n${files.slice(0, 14000)}`, { source: 'pr-desc', maxTokens: 900 });
            if (text && bodyEl) {
                const m = /^\s*TITLE:\s*(.+)$/m.exec(text);
                if (m) { const t = document.getElementById('gh-pr-title'); if (t) t.value = m[1].trim(); }
                bodyEl.value = text.replace(/^\s*TITLE:.*$/m, '').trim();
            } else if (bodyEl && bodyEl.value === '✨ ...') bodyEl.value = '';
        } catch (e) { this.showToast(e.message, 'error'); }
    };

    P.ghCreatePR = async function () {
        if (!this.ghRequireToken()) return;
        const head = document.getElementById('gh-pr-head')?.value, base = document.getElementById('gh-pr-base')?.value;
        const title = document.getElementById('gh-pr-title')?.value.trim();
        if (!title) { this.showToast('اكتب عنواناً للـ PR', 'warning'); return; }
        if (head === base) { this.showToast('فرع المصدر والهدف متطابقان', 'warning'); return; }
        try {
            const pr = await this.gh(`${this.ghRepoPath()}/pulls`, { method: 'POST', body: { title, head, base, body: document.getElementById('gh-pr-body')?.value || '', draft: !!document.getElementById('gh-pr-draft')?.checked } });
            this.showToast(`✅ تم إنشاء PR #${pr.number}`, 'success');
            return this.ghOpenPR(pr.number);
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };

    P.ghOpenPR = async function (number) {
        setView(this, 'ghOpenPR', number);
        this.ghLoading();
        const rp = this.ghRepoPath();
        try {
            const pr = await this.gh(`${rp}/pulls/${number}`);
            const [files, checks, comments] = await Promise.all([
                this.gh(`${rp}/pulls/${number}/files?per_page=100`),
                this.gh(`${rp}/commits/${pr.head.sha}/check-runs?per_page=50`).catch(() => ({ check_runs: [] })),
                this.gh(`${rp}/issues/${number}/comments?per_page=50`).catch(() => [])
            ]);
            this._ghPR = { pr, files };
            const state = pr.merged ? '<span class="gh-badge purple"><i class="fa-solid fa-code-merge"></i> مدموج</span>'
                : pr.state === 'open' ? '<span class="gh-badge ok">مفتوح</span>' : '<span class="gh-badge bad">مغلق</span>';
            const mergeable = pr.mergeable === false ? '<span class="gh-badge bad">يوجد تعارض مع الفرع الهدف</span>' : pr.mergeable ? '<span class="gh-badge ok">قابل للدمج</span>' : '';
            const runs = checks.check_runs || [];
            this.ghSetBody(`
                <div class="gh-toolbar">${backBtn()}<a class="sidebar-btn-util gh-btn" href="${this.escapeHTML(pr.html_url)}" target="_blank" rel="noopener"><i class="fa-solid fa-up-right-from-square"></i> GitHub</a></div>
                <div class="gh-detail-head">
                    <h3>${this.escapeHTML(pr.title)} <span class="text-dim">#${+pr.number}</span></h3>
                    <div class="gh-item-meta">${state} ${mergeable} <span dir="ltr">${this.escapeHTML(pr.head.ref)} → ${this.escapeHTML(pr.base.ref)}</span> • ${this.escapeHTML(pr.user?.login)} • ${+pr.commits} commits • <span class="text-emerald">+${+pr.additions}</span> <span class="text-red">−${+pr.deletions}</span></div>
                </div>
                <div class="gh-card gh-md">${this.renderMarkdownSafe(pr.body) || '<span class="text-dim">بدون وصف</span>'}</div>
                ${runs.length ? `<div class="gh-card"><b>الفحوصات (${runs.length})</b>${runs.map(c => `<div class="gh-check-row">${statusBadge(c.status, c.conclusion)} ${this.escapeHTML(c.name)}</div>`).join('')}</div>` : ''}
                ${pr.state === 'open' && !pr.merged ? `
                <div class="gh-card gh-toolbar">
                    <select id="gh-merge-method" class="form-input-box" style="width:auto">
                        <option value="squash">Squash and merge</option><option value="merge">Merge commit</option><option value="rebase">Rebase and merge</option></select>
                    <button class="btn-new-thread gh-btn" onclick="app.ghMergePR(${+pr.number})" ${pr.draft ? 'disabled title="مسودة"' : ''}><i class="fa-solid fa-code-merge"></i> دمج</button>
                    <span class="gh-spacer"></span>
                    <button class="sidebar-btn-util gh-btn" onclick="app.ghAIReviewPR(${+pr.number})"><i class="fa-solid fa-robot"></i> مراجعة AI</button>
                    <button class="sidebar-btn-util gh-btn" onclick="app.ghReviewPR(${+pr.number}, 'APPROVE')" title="Approve"><i class="fa-solid fa-thumbs-up"></i> موافقة</button>
                    <button class="sidebar-btn-util gh-btn" onclick="app.ghReviewPR(${+pr.number}, 'REQUEST_CHANGES')" title="Request changes"><i class="fa-solid fa-pen-to-square"></i> طلب تغييرات</button>
                    <button class="sidebar-btn-util gh-btn danger" onclick="app.ghSetPRState(${+pr.number}, 'closed')"><i class="fa-solid fa-xmark"></i> إغلاق</button>
                </div>` : (!pr.merged ? `<div class="gh-toolbar"><button class="sidebar-btn-util gh-btn" onclick="app.ghSetPRState(${+pr.number}, 'open')"><i class="fa-solid fa-rotate-left"></i> إعادة فتح</button></div>` : '')}
                <div id="gh-ai-review" class="gh-card gh-md" style="display:none"></div>
                <div class="gh-card"><b>الملفات (${files.length})</b>
                    ${files.map(f => `<details class="gh-file"><summary><span class="gh-file-status ${this.escapeHTML(f.status)}">${this.escapeHTML(f.status)}</span> <span dir="ltr">${this.escapeHTML(f.filename)}</span> <span class="text-emerald">+${+f.additions}</span> <span class="text-red">−${+f.deletions}</span></summary>
                        <div class="git-diff-output-box gh-patch">${this.renderPatchHTML(f.patch)}</div></details>`).join('')}
                </div>
                <div class="gh-card"><b>التعليقات (${comments.length})</b>
                    ${comments.map(c => `<div class="gh-comment"><div class="gh-item-meta"><b>${this.escapeHTML(c.user?.login)}</b> • ${timeAgo(c.created_at)}</div><div class="gh-md">${this.renderMarkdownSafe(c.body)}</div></div>`).join('')}
                    <textarea id="gh-comment-input" class="form-input-box" rows="3" placeholder="أضف تعليقاً..."></textarea>
                    <div class="gh-toolbar"><span class="gh-spacer"></span><button class="btn-new-thread gh-btn" onclick="app.ghComment(${+pr.number})"><i class="fa-solid fa-comment"></i> تعليق</button></div>
                </div>`);
        } catch (e) { this.ghError(e); }
    };

    P.ghMergePR = async function (number) {
        if (!this.ghRequireToken()) return;
        const merge_method = document.getElementById('gh-merge-method')?.value || 'squash';
        try {
            const r = await this.gh(`${this.ghRepoPath()}/pulls/${number}/merge`, { method: 'PUT', body: { merge_method } });
            this.showToast(`✅ تم دمج PR #${number} (${merge_method}) ${String(r?.sha || '').slice(0, 7)}`, 'success');
            return this.ghOpenPR(number);
        } catch (e) {
            this.showToast(e.status === 405 ? '❌ لا يمكن الدمج: فحوصات مطلوبة أو تعارض أو قواعد حماية' : '❌ ' + e.message, 'error');
        }
    };

    P.ghSetPRState = async function (number, state) {
        if (!this.ghRequireToken()) return;
        try {
            await this.gh(`${this.ghRepoPath()}/pulls/${number}`, { method: 'PATCH', body: { state } });
            this.showToast(state === 'closed' ? 'تم إغلاق الـ PR' : 'تمت إعادة فتح الـ PR', 'success');
            return this.ghOpenPR(number);
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };

    P.ghComment = async function (number, reopenFn = 'ghOpenPR') {
        if (!this.ghRequireToken()) return;
        const input = document.getElementById('gh-comment-input');
        const body = input?.value.trim();
        if (!body) return;
        try {
            await this.gh(`${this.ghRepoPath()}/issues/${number}/comments`, { method: 'POST', body: { body } });
            this.showToast('تم نشر التعليق', 'success');
            return this[reopenFn](number);
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };

    /** Submit a formal review. The text box (comment input) is used as the review body. */
    P.ghReviewPR = async function (number, event) {
        if (!this.ghRequireToken()) return;
        const input = document.getElementById('gh-comment-input');
        const body = input?.value.trim() || '';
        if (event === 'REQUEST_CHANGES' && !body) { this.showToast('اكتب التغييرات المطلوبة في خانة التعليق أولاً', 'warning'); input?.focus(); return; }
        try {
            await this.gh(`${this.ghRepoPath()}/pulls/${number}/reviews`, { method: 'POST', body: { event, ...(body ? { body } : {}) } });
            this.showToast(event === 'APPROVE' ? '👍 تمت الموافقة على الـ PR' : '📝 تم طلب التغييرات', 'success');
            return this.ghOpenPR(number);
        } catch (e) {
            this.showToast(e.status === 422 ? '❌ لا يمكنك مراجعة PR أنشأته بنفسك' : '❌ ' + e.message, 'error');
        }
    };

    P.ghAIReviewPR = async function (number) {
        const st = this._ghPR;
        if (!st || st.pr.number !== number) return;
        const box = document.getElementById('gh-ai-review');
        if (box) box.style.display = '';
        const diff = st.files.slice(0, 40).map(f => `### ${f.filename}\n${(f.patch || '(binary)').slice(0, 2500)}`).join('\n');
        const text = await this.ghAI(`أنت مراجع كود خبير. راجع هذا الـ Pull Request بالعربية: ابدأ بحكم عام (✅ جاهز / ⚠️ يحتاج تعديلات)، ثم قائمة مرقمة بالمشاكل (الملف، السطر، الخطورة، الاقتراح)، ثم ملاحظات إيجابية مختصرة.\nالعنوان: ${st.pr.title}\nالوصف: ${(st.pr.body || '').slice(0, 2000)}\n\nDiff:\n${diff.slice(0, 24000)}`, { targetId: 'gh-ai-review', source: 'pr-review', maxTokens: 2000 });
        if (text && box) {
            const ref = this.ghRef(text);
            box.insertAdjacentHTML('beforeend', `<div class="gh-toolbar"><span class="gh-spacer"></span><button class="sidebar-btn-util gh-btn" onclick="app.ghPostReviewComment(${number}, app.ghVal(${ref}))"><i class="fa-solid fa-paper-plane"></i> نشر كتعليق</button></div>`);
        }
    };
    P.ghPostReviewComment = async function (number, text) {
        if (!this.ghRequireToken() || !text) return;
        try {
            await this.gh(`${this.ghRepoPath()}/issues/${number}/comments`, { method: 'POST', body: { body: `🤖 **مراجعة OX-Alpha AI**\n\n${text}` } });
            this.showToast('تم نشر المراجعة كتعليق', 'success');
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };

    // ================================================================== ACTIONS
    const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);
    P.ghScheduleActionsRefresh = function (active) {
        clearTimeout(this._ghActionsTimer);
        if (!active) return;
        this._ghActionsTimer = setTimeout(() => {
            const modal = document.getElementById('gh-hub-modal');
            if (modal && modal.classList.contains('active') && this.ghTab === 'actions' && !document.hidden) this.refreshGitHubHub();
        }, 8000);
    };

    P.ghLoadRuns = async function (branchOnly) {
        if (branchOnly !== undefined) this._ghRunsBranchOnly = branchOnly;
        this.ghLoading();
        try {
            const { branch } = this.ghRepo();
            const q = this._ghRunsBranchOnly ? `&branch=${encodeURIComponent(branch)}` : '';
            const [data, wf] = await Promise.all([
                this.gh(`${this.ghRepoPath()}/actions/runs?per_page=20${q}`),
                this.gh(`${this.ghRepoPath()}/actions/workflows?per_page=50`).catch(() => ({ workflows: [] }))
            ]);
            const runs = data.workflow_runs || [];
            const workflows = (wf.workflows || []).filter(x => x.state === 'active');
            this.ghSetBody(`
                <div class="gh-toolbar"><label class="gh-check"><input type="checkbox" ${this._ghRunsBranchOnly ? 'checked' : ''} onchange="app.ghLoadRuns(this.checked)"> الفرع الحالي فقط (<span dir="ltr">${this.escapeHTML(branch)}</span>)</label>
                    <span class="gh-spacer"></span><span class="text-dim" style="font-size:0.72rem">${runs.some(r => ACTIVE.has(r.status)) ? '⟳ تحديث تلقائي' : ''}</span>
                    ${workflows.length ? `<select id="gh-wf-select" class="form-input-box" style="width:auto;font-size:0.76rem">${workflows.map(x => `<option value="${+x.id}">${this.escapeHTML(x.name)}</option>`).join('')}</select>
                    <button class="btn-new-thread gh-btn" onclick="app.ghDispatchWorkflow(+document.getElementById('gh-wf-select').value)" title="workflow_dispatch"><i class="fa-solid fa-play"></i> تشغيل يدوي</button>` : ''}</div>
                ${runs.length ? `<div class="gh-list">${runs.map(r => `
                    <div class="gh-item" onclick="app.ghOpenRun(${+r.id})" tabindex="0">
                        ${statusBadge(r.status, r.conclusion)}
                        <div class="gh-item-main">
                            <div class="gh-item-title">${this.escapeHTML(r.display_title || r.name)}</div>
                            <div class="gh-item-meta">${this.escapeHTML(r.name)} #${+r.run_number} • <span dir="ltr">${this.escapeHTML(r.head_branch)}</span> • ${this.escapeHTML(r.event)} • ${timeAgo(r.created_at)}</div>
                        </div>
                    </div>`).join('')}</div>` : '<div class="gh-empty">لا توجد تشغيلات GitHub Actions بعد. أضف Workflow من تبويب «النشر».</div>'}`);
            this.ghScheduleActionsRefresh(runs.some(r => ACTIVE.has(r.status)));
        } catch (e) { this.ghError(e); }
    };

    /** Trigger a workflow manually on the active branch (needs `on: workflow_dispatch`). */
    P.ghDispatchWorkflow = async function (workflowId) {
        if (!this.ghRequireToken() || !workflowId) return;
        const { branch } = this.ghRepo();
        try {
            await this.gh(`${this.ghRepoPath()}/actions/workflows/${workflowId}/dispatches`, { method: 'POST', body: { ref: branch } });
            this.showToast(`▶️ تم تشغيل الـ Workflow على ${branch} — سيظهر خلال ثوانٍ`, 'success');
            setTimeout(() => { if (this.ghTab === 'actions' && !this.ghView) this.ghLoadRuns(); }, 3000);
            return true;
        } catch (e) {
            this.showToast(e.status === 422 ? '❌ هذا الـ Workflow لا يدعم التشغيل اليدوي (أضف workflow_dispatch)' : '❌ ' + e.message, 'error');
            return false;
        }
    };

    P.ghOpenRun = async function (id) {
        setView(this, 'ghOpenRun', id);
        this.ghLoading();
        const rp = this.ghRepoPath();
        try {
            const [run, jobsData] = await Promise.all([this.gh(`${rp}/actions/runs/${id}`), this.gh(`${rp}/actions/runs/${id}/jobs?per_page=50`)]);
            const jobs = jobsData.jobs || [];
            this._ghRun = { run, jobs };
            const failed = run.conclusion === 'failure' || jobs.some(j => j.conclusion === 'failure');
            const active = ACTIVE.has(run.status);
            this.ghSetBody(`
                <div class="gh-toolbar">${backBtn()}<a class="sidebar-btn-util gh-btn" href="${this.escapeHTML(run.html_url)}" target="_blank" rel="noopener"><i class="fa-solid fa-up-right-from-square"></i> GitHub</a></div>
                <div class="gh-detail-head"><h3>${this.escapeHTML(run.display_title || run.name)}</h3>
                    <div class="gh-item-meta">${statusBadge(run.status, run.conclusion)} ${this.escapeHTML(run.name)} #${+run.run_number} • <span dir="ltr">${this.escapeHTML(run.head_branch)} @ ${this.escapeHTML(String(run.head_sha).slice(0, 7))}</span> • ${timeAgo(run.created_at)}</div></div>
                <div class="gh-toolbar">
                    ${active ? `<button class="sidebar-btn-util gh-btn danger" onclick="app.ghRunAction(${+id}, 'cancel')"><i class="fa-solid fa-stop"></i> إلغاء</button>` : `
                    <button class="sidebar-btn-util gh-btn" onclick="app.ghRunAction(${+id}, 'rerun')"><i class="fa-solid fa-rotate"></i> إعادة التشغيل</button>
                    ${failed ? `<button class="sidebar-btn-util gh-btn" onclick="app.ghRunAction(${+id}, 'rerun-failed-jobs')"><i class="fa-solid fa-rotate-right"></i> إعادة الفاشلة فقط</button>
                    <button class="btn-new-thread gh-btn" onclick="app.ghExplainFailure(${+id})"><i class="fa-solid fa-robot"></i> اشرح الفشل بالذكاء الاصطناعي</button>` : ''}`}
                </div>
                <div id="gh-ai-failure" class="gh-card gh-md" style="display:none"></div>
                ${jobs.map(j => `<details class="gh-card gh-job" ${j.conclusion === 'failure' ? 'open' : ''}>
                    <summary>${statusBadge(j.status, j.conclusion)} <b>${this.escapeHTML(j.name)}</b> <span class="text-dim">${j.started_at && j.completed_at ? Math.round((new Date(j.completed_at) - new Date(j.started_at)) / 1000) + 'ث' : ''}</span></summary>
                    ${(j.steps || []).map(s => `<div class="gh-check-row">${statusBadge(s.status, s.conclusion)} ${+s.number}. ${this.escapeHTML(s.name)}</div>`).join('')}
                </details>`).join('')}`);
            this.ghScheduleActionsRefresh(active);
        } catch (e) { this.ghError(e); }
    };

    P.ghRunAction = async function (id, action) {
        if (!this.ghRequireToken()) return;
        try {
            await this.gh(`${this.ghRepoPath()}/actions/runs/${id}/${action}`, { method: 'POST' });
            this.showToast({ cancel: 'تم طلب الإلغاء', rerun: 'تمت إعادة التشغيل ⟳', 'rerun-failed-jobs': 'تمت إعادة المهام الفاشلة ⟳' }[action] || 'تم', 'success');
            setTimeout(() => this.ghView && this.ghView.fn === 'ghOpenRun' && this.refreshGitHubHub(), 1500);
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };

    /** Collect failure evidence: failed steps, check-run annotations, and (best effort) the log tail. */
    P.ghCollectFailure = async function (runId) {
        const rp = this.ghRepoPath();
        const st = this._ghRun && this._ghRun.run.id === runId ? this._ghRun : { run: await this.gh(`${rp}/actions/runs/${runId}`), jobs: (await this.gh(`${rp}/actions/runs/${runId}/jobs`)).jobs || [] };
        const failedJobs = st.jobs.filter(j => j.conclusion === 'failure').slice(0, 3);
        const parts = [];
        for (const j of failedJobs) {
            const steps = (j.steps || []).filter(s => s.conclusion === 'failure').map(s => s.name).join(', ');
            let ann = [];
            try { ann = await this.gh(`${rp}/check-runs/${j.id}/annotations`); } catch (e) {}
            let log = '';
            try {
                const t = await this.gh(`${rp}/actions/jobs/${j.id}/logs`, { accept: 'application/vnd.github.v3.raw' });
                if (typeof t === 'string') log = t.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z /gm, '').slice(-6000);
            } catch (e) {}
            parts.push(`## Job: ${j.name}\nFailed steps: ${steps || '?'}\nAnnotations:\n${(ann || []).map(a => `- [${a.annotation_level}] ${a.path}:${a.start_line} ${a.message}`).join('\n') || '(none)'}\n${log ? 'Log tail:\n' + log : ''}`);
        }
        return { run: st.run, text: parts.join('\n\n') || 'No failed jobs found' };
    };

    P.ghExplainFailure = async function (runId) {
        const box = document.getElementById('gh-ai-failure');
        if (box) { box.style.display = ''; box.innerHTML = '<span class="live-step-spinner"></span> جمع سجلات الفشل...'; }
        try {
            const { run, text } = await this.ghCollectFailure(runId);
            return await this.ghAI(`فشل تشغيل GitHub Actions "${run.name}" على الفرع ${run.head_branch}. اشرح بالعربية وبإيجاز: 1) سبب الفشل الأرجح، 2) الملف/الخطوة المعنية، 3) الإصلاح المقترح مع كود إن لزم.\n\n${text.slice(0, 16000)}`, { targetId: 'gh-ai-failure', source: 'ci-explain', maxTokens: 1500 });
        } catch (e) { if (box) box.innerHTML = `❌ ${this.escapeHTML(e.message)}`; }
    };

    // ================================================================== ISSUES
    P.ghLoadIssues = async function (state) {
        this._ghIssueState = state || this._ghIssueState || 'open';
        this.ghLoading();
        try {
            const all = await this.gh(`${this.ghRepoPath()}/issues?state=${this._ghIssueState}&per_page=40&sort=updated`);
            const issues = all.filter(i => !i.pull_request);
            const filter = ['open', 'closed'].map(s => `<button class="gh-chip ${s === this._ghIssueState ? 'active' : ''}" onclick="app.ghLoadIssues('${s}')">${s === 'open' ? 'مفتوحة' : 'مغلقة'}</button>`).join('');
            this.ghSetBody(`
                <div class="gh-toolbar">${filter}<span class="gh-spacer"></span><button class="btn-new-thread gh-btn" onclick="app.ghShowCreateIssue()"><i class="fa-solid fa-plus"></i> Issue جديدة</button></div>
                ${issues.length ? `<div class="gh-list">${issues.map(i => `
                    <div class="gh-item" onclick="app.ghOpenIssue(${+i.number})" tabindex="0">
                        <i class="fa-solid ${i.state === 'open' ? 'fa-circle-dot text-emerald' : 'fa-circle-check text-purple'}"></i>
                        <div class="gh-item-main">
                            <div class="gh-item-title">${this.escapeHTML(i.title)} ${(i.labels || []).map(l => `<span class="gh-label" style="--c:#${/^[0-9a-f]{6}$/i.test(l.color) ? l.color : '888888'}">${this.escapeHTML(l.name)}</span>`).join('')}</div>
                            <div class="gh-item-meta">#${+i.number} • ${this.escapeHTML(i.user?.login)} • ${timeAgo(i.updated_at)} • 💬 ${+i.comments}</div>
                        </div>
                    </div>`).join('')}</div>` : '<div class="gh-empty">لا توجد Issues.</div>'}`);
        } catch (e) { this.ghError(e); }
    };

    P.ghShowCreateIssue = function () {
        if (!this.ghRequireToken()) return;
        setView(this, 'ghShowCreateIssue');
        this._ghRefs = [];
        this.ghSetBody(`
            <div class="gh-toolbar">${backBtn()}<b>Issue جديدة</b></div>
            <div class="gh-form">
                <input id="gh-issue-title" class="form-input-box" placeholder="العنوان">
                <textarea id="gh-issue-body" class="form-input-box" rows="8" placeholder="الوصف (Markdown)"></textarea>
                <input id="gh-issue-labels" class="form-input-box" placeholder="تسميات مفصولة بفواصل (اختياري): bug, enhancement" dir="ltr">
                <div class="gh-toolbar"><span class="gh-spacer"></span><button class="btn-new-thread gh-btn" onclick="app.ghCreateIssue()"><i class="fa-solid fa-circle-dot"></i> إنشاء</button></div>
            </div>`);
    };

    P.ghCreateIssue = async function () {
        if (!this.ghRequireToken()) return;
        const title = document.getElementById('gh-issue-title')?.value.trim();
        if (!title) { this.showToast('اكتب عنواناً', 'warning'); return; }
        const labels = (document.getElementById('gh-issue-labels')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
        try {
            const body = { title, body: document.getElementById('gh-issue-body')?.value || '' };
            if (labels.length) body.labels = labels;
            const issue = await this.gh(`${this.ghRepoPath()}/issues`, { method: 'POST', body });
            this.showToast(`✅ تم إنشاء Issue #${issue.number}`, 'success');
            return this.ghOpenIssue(issue.number);
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };

    P.ghOpenIssue = async function (number) {
        setView(this, 'ghOpenIssue', number);
        this.ghLoading();
        const rp = this.ghRepoPath();
        try {
            const [issue, comments] = await Promise.all([this.gh(`${rp}/issues/${number}`), this.gh(`${rp}/issues/${number}/comments?per_page=50`).catch(() => [])]);
            this._ghIssue = { issue, comments };
            this.ghSetBody(`
                <div class="gh-toolbar">${backBtn()}<a class="sidebar-btn-util gh-btn" href="${this.escapeHTML(issue.html_url)}" target="_blank" rel="noopener"><i class="fa-solid fa-up-right-from-square"></i> GitHub</a></div>
                <div class="gh-detail-head"><h3>${this.escapeHTML(issue.title)} <span class="text-dim">#${+issue.number}</span></h3>
                    <div class="gh-item-meta">${issue.state === 'open' ? '<span class="gh-badge ok">مفتوحة</span>' : '<span class="gh-badge purple">مغلقة</span>'} ${this.escapeHTML(issue.user?.login)} • ${timeAgo(issue.created_at)}</div></div>
                <div class="gh-card gh-md">${this.renderMarkdownSafe(issue.body) || '<span class="text-dim">بدون وصف</span>'}</div>
                <div class="gh-toolbar">
                    <button class="btn-new-thread gh-btn" onclick="app.ghSolveIssueWithAI(${+issue.number})"><i class="fa-solid fa-robot"></i> حلها بالذكاء الاصطناعي</button>
                    <span class="gh-spacer"></span>
                    ${issue.state === 'open'
                        ? `<button class="sidebar-btn-util gh-btn" onclick="app.ghSetIssueState(${+issue.number}, 'closed')"><i class="fa-solid fa-check"></i> إغلاق</button>`
                        : `<button class="sidebar-btn-util gh-btn" onclick="app.ghSetIssueState(${+issue.number}, 'open')"><i class="fa-solid fa-rotate-left"></i> إعادة فتح</button>`}
                </div>
                <div class="gh-card"><b>التعليقات (${comments.length})</b>
                    ${comments.map(c => `<div class="gh-comment"><div class="gh-item-meta"><b>${this.escapeHTML(c.user?.login)}</b> • ${timeAgo(c.created_at)}</div><div class="gh-md">${this.renderMarkdownSafe(c.body)}</div></div>`).join('')}
                    <textarea id="gh-comment-input" class="form-input-box" rows="3" placeholder="أضف تعليقاً..."></textarea>
                    <div class="gh-toolbar"><span class="gh-spacer"></span><button class="btn-new-thread gh-btn" onclick="app.ghComment(${+issue.number}, 'ghOpenIssue')"><i class="fa-solid fa-comment"></i> تعليق</button></div>
                </div>`);
        } catch (e) { this.ghError(e); }
    };

    P.ghSetIssueState = async function (number, state) {
        if (!this.ghRequireToken()) return;
        try {
            await this.gh(`${this.ghRepoPath()}/issues/${number}`, { method: 'PATCH', body: { state, ...(state === 'closed' ? { state_reason: 'completed' } : {}) } });
            this.showToast(state === 'closed' ? 'تم إغلاق الـ Issue' : 'تمت إعادة فتح الـ Issue', 'success');
            return this.ghOpenIssue(number);
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };

    /** Hand the issue to the main chat (with project context) so the agent proposes a fix. */
    P.ghSolveIssueWithAI = function (number) {
        const st = this._ghIssue;
        if (!st || st.issue.number !== number) return;
        const { owner, repo, branch } = this.ghRepo();
        const comments = st.comments.slice(-8).map(c => `- ${c.user?.login}: ${(c.body || '').slice(0, 600)}`).join('\n');
        const prompt = `حل هذه المشكلة من مستودع ${owner}/${repo} (الفرع ${branch}).\n\n### Issue #${number}: ${st.issue.title}\n${(st.issue.body || '').slice(0, 4000)}\n${comments ? '\n### التعليقات\n' + comments : ''}\n\nحلّل السبب، ثم اكتب الكود المعدّل كاملاً لكل ملف (مع مسار الملف في أول سطر من كل كتلة كود) حتى أستطيع مراجعته ورفعه.`;
        this.closeModals();
        if (this.sendUserMessage) this.sendUserMessage(prompt);
    };

    // ================================================================== BRANCHES
    P.ghLoadBranches = async function () {
        this.ghLoading();
        try {
            const [info, branches] = await Promise.all([this.ghRepoInfo(), this.gh(`${this.ghRepoPath()}/branches?per_page=100`)]);
            const def = info.default_branch;
            const active = this.ghRepo().branch;
            this._ghRefs = [];
            const opts = branches.map(b => `<option value="${this.escapeHTML(b.name)}" ${b.name === active ? 'selected' : ''}>${this.escapeHTML(b.name)}</option>`).join('');
            this.ghSetBody(`
                <div class="gh-card gh-form">
                    <b><i class="fa-solid fa-plus"></i> فرع جديد</b>
                    <div class="gh-row"><input id="gh-new-branch" class="form-input-box" placeholder="feature/new-ui" dir="ltr">
                        <label>من</label><select id="gh-new-branch-base" class="form-input-box" dir="ltr">${opts}</select>
                        <button class="btn-new-thread gh-btn" onclick="app.ghCreateBranch()"><i class="fa-solid fa-code-branch"></i> إنشاء</button></div>
                    <label class="gh-check"><input type="checkbox" id="gh-new-branch-activate" checked> اجعله الفرع النشط بعد الإنشاء</label>
                </div>
                <div class="gh-list">${branches.map(b => `
                    <div class="gh-item static">
                        <i class="fa-solid fa-code-branch ${b.name === active ? 'text-emerald' : 'text-dim'}"></i>
                        <div class="gh-item-main">
                            <div class="gh-item-title" dir="ltr" style="text-align:right">${this.escapeHTML(b.name)}
                                ${b.name === def ? '<span class="gh-badge ok">افتراضي</span>' : ''} ${b.name === active ? '<span class="gh-badge run">نشط</span>' : ''} ${b.protected ? '<span class="gh-badge warn"><i class="fa-solid fa-lock"></i> محمي</span>' : ''}</div>
                            <div class="gh-item-meta" dir="ltr" style="text-align:right">${this.escapeHTML(String(b.commit?.sha || '').slice(0, 7))}</div>
                        </div>
                        <div class="gh-item-actions">
                            ${b.name !== active ? `<button class="sidebar-btn-util gh-btn" onclick="${call(this, 'ghActivateBranch', b.name)}" title="تعيين كفرع نشط"><i class="fa-solid fa-check"></i></button>` : ''}
                            ${b.name !== def ? `<button class="sidebar-btn-util gh-btn" onclick="${call(this, 'ghOpenCompare', def, b.name)}" title="مقارنة مع ${this.escapeHTML(def)}"><i class="fa-solid fa-code-compare"></i></button>
                            <button class="sidebar-btn-util gh-btn" onclick="${call(this, 'ghShowCreatePR', b.name)}" title="PR"><i class="fa-solid fa-code-pull-request"></i></button>
                            ${!b.protected ? `<button class="sidebar-btn-util gh-btn danger" onclick="${call(this, 'ghDeleteBranch', b.name)}" title="حذف"><i class="fa-solid fa-trash"></i></button>` : ''}` : ''}
                        </div>
                    </div>`).join('')}</div>`);
        } catch (e) { this.ghError(e); }
    };

    /** Change the active branch without touching any other setting (never use saveSettings() here). */
    P.ghActivateBranch = function (name) {
        this.settings.githubBranch = name;
        this.safeStorageSet('ox_alpha_settings_v2', JSON.stringify(this.settings));
        this.renderUIState();
        const { owner, repo } = this.ghRepo();
        const label = document.getElementById('gh-hub-repo');
        if (label) label.textContent = `${owner}/${repo}@${name}`;
        this.showToast(`الفرع النشط الآن: ${name}`, 'success');
        if (this.ghTab === 'branches' && !this.ghView) this.ghLoadBranches();
    };

    P.ghCreateBranch = async function () {
        if (!this.ghRequireToken()) return;
        const name = (document.getElementById('gh-new-branch')?.value || '').trim().replace(/\s+/g, '-');
        const base = document.getElementById('gh-new-branch-base')?.value || this.ghRepo().branch;
        if (!name || /[~^:?*[\\]|\.\.|@\{|\/$|^\//.test(name)) { this.showToast('اسم فرع غير صالح', 'warning'); return; }
        try {
            const ref = await this.gh(`${this.ghRepoPath()}/git/ref/heads/${base.split('/').map(encodeURIComponent).join('/')}`);
            await this.gh(`${this.ghRepoPath()}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${name}`, sha: ref.object.sha } });
            this.showToast(`✅ تم إنشاء الفرع ${name} من ${base}`, 'success');
            if (document.getElementById('gh-new-branch-activate')?.checked !== false) this.ghActivateBranch(name);
            else this.ghLoadBranches();
            return true;
        } catch (e) { this.showToast(e.status === 422 ? '❌ الفرع موجود مسبقاً' : '❌ ' + e.message, 'error'); return false; }
    };

    P.ghDeleteBranch = async function (name) {
        if (!this.ghRequireToken()) return;
        if (typeof confirm === 'function' && !confirm(`حذف الفرع "${name}" من GitHub نهائياً؟`)) return;
        try {
            await this.gh(`${this.ghRepoPath()}/git/refs/heads/${name.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' });
            if (this.ghRepo().branch === name) {
                const info = await this.ghRepoInfo();
                this.ghActivateBranch(info.default_branch || 'main');
            }
            this.showToast(`تم حذف الفرع ${name}`, 'success');
            return this.ghLoadBranches();
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };

    P.ghOpenCompare = async function (base, head) {
        setView(this, 'ghOpenCompare', base, head);
        this.ghLoading('جاري المقارنة...');
        try {
            const cmp = await this.ghCompare(base, head);
            const files = cmp.files || [];
            this.ghSetBody(`
                <div class="gh-toolbar">${backBtn()}<b dir="ltr">${this.escapeHTML(base)}...${this.escapeHTML(head)}</b><span class="gh-spacer"></span>
                    ${+cmp.ahead_by > 0 ? `<button class="sidebar-btn-util gh-btn" onclick="${call(this, 'ghMergeBranches', base, head)}" title="دمج مباشر بدون PR"><i class="fa-solid fa-code-merge"></i> دمج في ${this.escapeHTML(base)}</button>` : ''}
                    <button class="btn-new-thread gh-btn" onclick="${call(this, 'ghShowCreatePR', head)}"><i class="fa-solid fa-code-pull-request"></i> إنشاء PR</button></div>
                <div class="gh-card gh-item-meta">متقدم بـ <b>${+cmp.ahead_by}</b> commit • متأخر بـ <b>${+cmp.behind_by}</b> • ${files.length} ملف</div>
                <div class="gh-card"><b>Commits</b>${(cmp.commits || []).map(c => `<div class="gh-check-row"><code dir="ltr">${this.escapeHTML(c.sha.slice(0, 7))}</code> ${this.escapeHTML((c.commit?.message || '').split('\n')[0])}</div>`).join('') || '<div class="text-dim">—</div>'}</div>
                <div class="gh-card">${files.map(f => `<details class="gh-file"><summary><span class="gh-file-status ${this.escapeHTML(f.status)}">${this.escapeHTML(f.status)}</span> <span dir="ltr">${this.escapeHTML(f.filename)}</span> <span class="text-emerald">+${+f.additions}</span> <span class="text-red">−${+f.deletions}</span></summary>
                    <div class="git-diff-output-box gh-patch">${this.renderPatchHTML(f.patch)}</div></details>`).join('') || '<div class="text-dim">لا فروقات</div>'}</div>`);
        } catch (e) { this.ghError(e); }
    };

    /** Merge head into base directly (POST /merges). 409 = conflict → suggest a PR. */
    P.ghMergeBranches = async function (base, head) {
        if (!this.ghRequireToken()) return;
        if (typeof confirm === 'function' && !confirm(`دمج "${head}" في "${base}" مباشرة على GitHub؟`)) return;
        try {
            const r = await this.gh(`${this.ghRepoPath()}/merges`, { method: 'POST', body: { base, head, commit_message: `Merge branch '${head}' into ${base}` } });
            this.showToast(r ? `✅ تم دمج ${head} في ${base} (${String(r.sha || '').slice(0, 7)})` : `لا يوجد جديد للدمج — ${base} محدّث`, 'success');
            return this.ghOpenCompare(base, head);
        } catch (e) {
            this.showToast(e.status === 409 ? '⚠️ يوجد تعارض — أنشئ PR وحل التعارض' : '❌ ' + e.message, 'error');
        }
    };

    // ================================================================== RELEASES
    P.ghLoadReleases = async function () {
        this.ghLoading();
        try {
            const rp = this.ghRepoPath();
            const [releases, tags] = await Promise.all([this.gh(`${rp}/releases?per_page=20`), this.gh(`${rp}/tags?per_page=20`).catch(() => [])]);
            const latestTag = (releases[0] && releases[0].tag_name) || (tags[0] && tags[0].name) || '';
            this._ghLatestTag = latestTag;
            const sugg = nextSemver(latestTag, 'patch');
            this.ghSetBody(`
                <div class="gh-card gh-form">
                    <b><i class="fa-solid fa-tag"></i> إصدار جديد</b> <span class="text-dim" style="font-size:0.74rem">آخر وسم: <span dir="ltr">${this.escapeHTML(latestTag || '—')}</span></span>
                    <div class="gh-row">
                        <input id="gh-rel-tag" class="form-input-box" value="${this.escapeHTML(sugg)}" dir="ltr" style="max-width:140px">
                        ${['patch', 'minor', 'major'].map(k => `<button class="gh-chip" onclick="document.getElementById('gh-rel-tag').value=app.nextSemver(app._ghLatestTag,'${k}')">${k}</button>`).join('')}
                        <input id="gh-rel-name" class="form-input-box" placeholder="اسم الإصدار (اختياري)">
                    </div>
                    <textarea id="gh-rel-body" class="form-input-box" rows="4" placeholder="ملاحظات الإصدار — اتركها فارغة ليولّدها GitHub تلقائياً من الـ PRs والـ commits"></textarea>
                    <div class="gh-row">
                        <label class="gh-check"><input type="checkbox" id="gh-rel-draft"> مسودة</label>
                        <label class="gh-check"><input type="checkbox" id="gh-rel-pre"> إصدار تجريبي</label>
                        <span class="gh-spacer"></span>
                        <button class="btn-new-thread gh-btn" onclick="app.ghCreateRelease()"><i class="fa-solid fa-rocket"></i> نشر الإصدار</button>
                    </div>
                </div>
                ${releases.length ? `<div class="gh-list">${releases.map(r => `
                    <details class="gh-card"><summary><b dir="ltr">${this.escapeHTML(r.tag_name)}</b> ${this.escapeHTML(r.name && r.name !== r.tag_name ? r.name : '')}
                        ${r.draft ? '<span class="gh-badge dim">مسودة</span>' : ''} ${r.prerelease ? '<span class="gh-badge warn">تجريبي</span>' : ''} <span class="text-dim">${timeAgo(r.published_at || r.created_at)}</span></summary>
                        <div class="gh-md">${this.renderMarkdownSafe(r.body) || '<span class="text-dim">—</span>'}</div>
                        <a href="${this.escapeHTML(r.html_url)}" target="_blank" rel="noopener" class="text-emerald" style="font-size:0.75rem">فتح على GitHub ↗</a></details>`).join('')}</div>` : '<div class="gh-empty">لا توجد إصدارات بعد.</div>'}`);
        } catch (e) { this.ghError(e); }
    };

    P.ghCreateRelease = async function () {
        if (!this.ghRequireToken()) return;
        const tag = document.getElementById('gh-rel-tag')?.value.trim();
        if (!tag) { this.showToast('أدخل الوسم', 'warning'); return; }
        const notes = document.getElementById('gh-rel-body')?.value.trim() || '';
        const body = {
            tag_name: tag, target_commitish: this.ghRepo().branch, name: document.getElementById('gh-rel-name')?.value.trim() || tag,
            draft: !!document.getElementById('gh-rel-draft')?.checked, prerelease: !!document.getElementById('gh-rel-pre')?.checked
        };
        if (notes) body.body = notes; else body.generate_release_notes = true;
        try {
            const r = await this.gh(`${this.ghRepoPath()}/releases`, { method: 'POST', body });
            this.showToast(`✅ تم نشر الإصدار ${r.tag_name}`, 'success');
            return this.ghLoadReleases();
        } catch (e) { this.showToast(e.status === 422 ? '❌ الوسم موجود مسبقاً أو غير صالح' : '❌ ' + e.message, 'error'); }
    };

    // ================================================================== DEPLOY
    /** Detect the project stack from the file list (paths only). */
    P.detectStack = function (paths) {
        const has = (re) => paths.some(p => re.test(p));
        const pkgPaths = paths.filter(p => /(^|\/)package\.json$/.test(p));
        return {
            node: pkgPaths.length > 0,
            python: has(/(^|\/)(requirements\.txt|pyproject\.toml|setup\.py)$/),
            static: has(/(^|\/)index\.html$/),
            docker: has(/(^|\/)Dockerfile$/),
            ci: has(/^\.github\/workflows\/.+\.ya?ml$/),
            vercel: has(/(^|\/)vercel\.json$/),
            netlify: has(/(^|\/)netlify\.toml$/),
            gitignore: has(/^\.gitignore$/),
            pages: has(/^\.github\/workflows\/.*pages.*\.ya?ml$/i)
        };
    };

    P.ghDeployTemplate = function (kind, stack) {
        const node = stack.node, py = stack.python;
        const T = {
            ci: {
                path: '.github/workflows/ci.yml',
                content: node ? `name: CI\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20\n          cache: npm\n      - run: npm ci || npm install\n      - run: npm run build --if-present\n      - run: npm test --if-present\n`
                    : py ? `name: CI\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.12'\n          cache: pip\n      - run: pip install -r requirements.txt || pip install .\n      - run: python -m pytest || echo "no tests"\n`
                    : `name: CI\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - name: HTML sanity check\n        run: test -f index.html && grep -qi "<html" index.html\n`
            },
            docker: {
                path: 'Dockerfile',
                content: node ? `# syntax=docker/dockerfile:1\nFROM node:20-alpine AS build\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci || npm install\nCOPY . .\nRUN npm run build --if-present\n\nFROM nginx:alpine\nCOPY --from=build /app /usr/share/nginx/html\nEXPOSE 80\n`
                    : py ? `FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nEXPOSE 8000\nCMD ["python", "-m", "http.server", "8000"]\n`
                    : `FROM nginx:alpine\nCOPY . /usr/share/nginx/html\nEXPOSE 80\n`
            },
            vercel: { path: 'vercel.json', content: JSON.stringify({ cleanUrls: true, trailingSlash: false, headers: [{ source: '/(.*)', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }] }] }, null, 2) + '\n' },
            netlify: { path: 'netlify.toml', content: node ? `[build]\n  command = "npm run build"\n  publish = "."\n` : `[build]\n  publish = "."\n` },
            gitignore: { path: '.gitignore', content: `node_modules/\ndist/\nbuild/\n.env\n.env.*\n__pycache__/\n*.pyc\n.venv/\n.DS_Store\ncoverage/\n` },
            pages: {
                path: '.github/workflows/pages.yml',
                content: `name: Deploy to GitHub Pages\non:\n  push:\n    branches: [${this.ghRepo().branch}]\n  workflow_dispatch:\npermissions:\n  contents: read\n  pages: write\n  id-token: write\nconcurrency:\n  group: pages\n  cancel-in-progress: true\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    environment:\n      name: github-pages\n      url: \${{ steps.deployment.outputs.page_url }}\n    steps:\n      - uses: actions/checkout@v4\n${node ? `      - uses: actions/setup-node@v4\n        with:\n          node-version: 20\n      - run: npm ci || npm install\n      - run: npm run build --if-present\n` : ''}      - uses: actions/configure-pages@v5\n      - uses: actions/upload-pages-artifact@v3\n        with:\n          path: '.'\n      - id: deployment\n        uses: actions/deploy-pages@v4\n`
            }
        };
        return T[kind];
    };

    P.ghRepoPaths = async function () {
        const { owner, repo, branch } = this.ghRepo();
        const key = `${owner}/${repo}@${branch}`;
        if (this._ghPathsCache && this._ghPathsCache.key === key && Date.now() - this._ghPathsCache.t < 60000) return this._ghPathsCache.paths;
        const tree = await this.gh(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
        const paths = (tree.tree || []).filter(i => i.type === 'blob').map(i => i.path);
        this._ghPathsCache = { key, paths, t: Date.now() };
        return paths;
    };

    P.ghLoadDeploy = async function () {
        this.ghLoading();
        try {
            const { owner, repo } = this.ghRepo();
            const [paths, pages] = await Promise.all([this.ghRepoPaths(), this.gh(`${this.ghRepoPath()}/pages`, { allow: [404] }).catch(() => ({ __status: 404 }))]);
            const stack = this.detectStack(paths);
            this._ghStack = stack;
            const repoUrl = encodeURIComponent(`https://github.com/${owner}/${repo}`);
            const stackLabel = [stack.node && 'Node.js', stack.python && 'Python', stack.static && 'HTML ثابت', stack.docker && 'Docker'].filter(Boolean).join(' + ') || 'غير محدد';
            const pagesOn = pages && !pages.__status;
            const tpl = [
                ['ci', 'fa-circle-play', 'GitHub Actions CI', stack.ci],
                ['pages', 'fa-globe', 'نشر Pages تلقائي', stack.pages],
                ['docker', 'fa-brands fa-docker', 'Dockerfile', stack.docker],
                ['vercel', 'fa-solid fa-play', 'vercel.json', stack.vercel],
                ['netlify', 'fa-solid fa-cloud', 'netlify.toml', stack.netlify],
                ['gitignore', 'fa-solid fa-eye-slash', '.gitignore', stack.gitignore]
            ];
            this.ghSetBody(`
                <div class="gh-card"><b>المشروع المكتشف:</b> ${this.escapeHTML(stackLabel)} <span class="text-dim">(${paths.length} ملف)</span></div>
                <div class="gh-deploy-grid">
                    <a class="gh-deploy-card" href="https://vercel.com/new/clone?repository-url=${repoUrl}" target="_blank" rel="noopener"><i class="fa-solid fa-play" style="transform:rotate(-90deg)"></i><b>Vercel</b><span>نشر بنقرة واحدة</span></a>
                    <a class="gh-deploy-card" href="https://app.netlify.com/start/deploy?repository=${repoUrl}" target="_blank" rel="noopener"><i class="fa-solid fa-cloud"></i><b>Netlify</b><span>نشر بنقرة واحدة</span></a>
                    <div class="gh-deploy-card"><i class="fa-solid fa-globe"></i><b>GitHub Pages</b>
                        ${pagesOn ? `<span>${statusBadge(pages.status === 'built' ? 'completed' : 'in_progress', pages.status === 'built' ? 'success' : null)}</span><a href="${this.escapeHTML(pages.html_url)}" target="_blank" rel="noopener" dir="ltr" class="text-emerald">${this.escapeHTML(pages.html_url)}</a>`
                            : `<button class="btn-new-thread gh-btn" onclick="app.ghEnablePages()">تفعيل</button>`}
                    </div>
                </div>
                <div class="gh-card"><b>قوالب جاهزة حسب مشروعك</b> <span class="text-dim" style="font-size:0.74rem">— تُفتح للمراجعة (Diff) قبل الـ Commit</span>
                    <div class="gh-template-grid">${tpl.map(([k, icon, label, exists]) => `
                        <button class="gh-template ${exists ? 'exists' : ''}" onclick="app.ghAddTemplate('${k}')"><i class="${icon.startsWith('fa-brands') || icon.startsWith('fa-solid') ? icon : 'fa-solid ' + icon}"></i> ${label} ${exists ? '<span class="gh-badge ok">موجود</span>' : ''}</button>`).join('')}</div>
                </div>`);
        } catch (e) { this.ghError(e); }
    };

    P.ghAddTemplate = function (kind) {
        const t = this.ghDeployTemplate(kind, this._ghStack || {});
        if (!t) return;
        return this.openCommitReview(t.path, t.content, { message: `chore: add ${t.path}` });
    };

    P.ghEnablePages = async function () {
        if (!this.ghRequireToken()) return;
        const { branch } = this.ghRepo();
        try {
            const r = await this.gh(`${this.ghRepoPath()}/pages`, { method: 'POST', body: { source: { branch, path: '/' } } });
            this.showToast(`✅ تم تفعيل GitHub Pages: ${r?.html_url || ''}`, 'success');
            return this.ghLoadDeploy();
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };

    // ================================================================== INSIGHTS
    P.ghLoadInsights = async function () {
        this.ghLoading();
        const rp = this.ghRepoPath();
        try {
            const [info, langs, commits, contributors] = await Promise.all([
                this.ghRepoInfo(true), this.gh(`${rp}/languages`).catch(() => ({})),
                this.gh(`${rp}/commits?per_page=10&sha=${encodeURIComponent(this.ghRepo().branch)}`).catch(() => []),
                this.gh(`${rp}/contributors?per_page=10`).catch(() => [])
            ]);
            const total = Object.values(langs).reduce((a, b) => a + b, 0) || 1;
            const colors = ['#34d399', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#f87171', '#2dd4bf', '#94a3b8'];
            const langList = Object.entries(langs).sort((a, b) => b[1] - a[1]);
            const stat = (icon, label, val) => `<div class="gh-stat"><i class="fa-solid ${icon}"></i><b>${val}</b><span>${label}</span></div>`;
            this.ghSetBody(`
                <div class="gh-card"><b>${this.escapeHTML(info.full_name)}</b> ${info.private ? '<span class="gh-badge warn">خاص</span>' : '<span class="gh-badge ok">عام</span>'}
                    <div class="text-dim" style="font-size:0.78rem;margin-top:4px">${this.escapeHTML(info.description || '')}</div></div>
                <div class="gh-stats">
                    ${stat('fa-star', 'نجوم', +info.stargazers_count)}${stat('fa-code-fork', 'تفرعات', +info.forks_count)}
                    ${stat('fa-circle-dot', 'Issues مفتوحة', +info.open_issues_count)}${stat('fa-eye', 'متابعون', +(info.subscribers_count || info.watchers_count || 0))}
                    ${stat('fa-hard-drive', 'الحجم', ((info.size || 0) / 1024).toFixed(1) + ' MB')}${stat('fa-clock', 'آخر دفع', timeAgo(info.pushed_at))}
                </div>
                ${langList.length ? `<div class="gh-card"><b>اللغات</b>
                    <div class="gh-lang-bar">${langList.map(([l, n], i) => `<span style="width:${(n / total * 100).toFixed(2)}%;background:${colors[i % colors.length]}" title="${this.escapeHTML(l)}"></span>`).join('')}</div>
                    <div class="gh-lang-legend">${langList.slice(0, 8).map(([l, n], i) => `<span><i style="background:${colors[i % colors.length]}"></i>${this.escapeHTML(l)} ${(n / total * 100).toFixed(1)}%</span>`).join('')}</div></div>` : ''}
                <div class="gh-card"><b>آخر الـ Commits</b>${commits.map(c => `<div class="gh-check-row"><code dir="ltr">${this.escapeHTML(c.sha.slice(0, 7))}</code> ${this.escapeHTML((c.commit?.message || '').split('\n')[0])} <span class="text-dim">— ${this.escapeHTML(c.author?.login || c.commit?.author?.name || '')} ${timeAgo(c.commit?.author?.date)}</span></div>`).join('') || '<div class="text-dim">—</div>'}</div>
                ${contributors.length ? `<div class="gh-card"><b>المساهمون</b><div class="gh-contributors">${contributors.map(u => `<span class="gh-contrib"><b>${this.escapeHTML(u.login)}</b> ${+u.contributions}</span>`).join('')}</div></div>` : ''}`);
        } catch (e) { this.ghError(e); }
    };

    // ------------------------------------------------------------------ FILE EXPLORER UPGRADE
    // The old tree view stopped at 100 files and injected raw paths into onclick handlers.
    P.refreshGitHubTree = async function () {
        const tree = document.getElementById('repo-file-tree');
        if (!tree) return;
        tree.innerHTML = '<div class="gh-empty">جاري جلب الملفات...</div>';
        try {
            this._ghPathsCache = null;
            const paths = await this.ghRepoPaths();
            this._ghTreePaths = paths;
            this.renderGitHubTreeList('');
        } catch (e) {
            tree.innerHTML = `<div class="gh-empty bad">❌ ${this.escapeHTML(e.message)}</div>`;
        }
    };
    P.renderGitHubTreeList = function (q) {
        const tree = document.getElementById('repo-file-tree');
        if (!tree) return;
        const all = this._ghTreePaths || [];
        const ql = (q || '').toLowerCase();
        const list = ql ? all.filter(p => p.toLowerCase().includes(ql)) : all;
        this._ghRefs = [];
        tree.innerHTML = `<input class="form-input-box gh-tree-search" placeholder="🔍 بحث في ${all.length} ملف..." value="${this.escapeHTML(q || '')}" oninput="app.renderGitHubTreeList(this.value)" dir="ltr">`
            + list.slice(0, 500).map(p => `<div class="session-item-row" style="padding:6px 10px" onclick="${call(this, 'previewGitHubFile', p)}"><i class="fa-solid fa-file-code" style="font-size:0.75rem;color:#34d399"></i><span class="truncate" style="font-family:var(--font-mono);font-size:0.76rem" dir="ltr">${this.escapeHTML(p)}</span></div>`).join('')
            + (list.length > 500 ? `<div class="gh-empty">+${list.length - 500} ملف — استخدم البحث</div>` : '');
        const input = tree.querySelector('input');
        if (input && q) { input.focus(); input.setSelectionRange(q.length, q.length); }
    };

    // ------------------------------------------------------------------ PALETTE INTEGRATION
    const _origBuildPalette = P.buildPaletteCommands;
    if (_origBuildPalette) {
        P.buildPaletteCommands = function () {
            const cmds = _origBuildPalette.call(this);
            const self = this;
            const S = 'الكود و GitHub';
            const old = cmds.findIndex(c => c.label === 'الفروع و Pull Requests');
            if (old !== -1) cmds.splice(old, 1);
            const extra = [
                { section: S, icon: 'fa-github', brand: true, label: 'GitHub Hub', hint: 'PRs, Actions, Issues…', kbd: 'Alt+G', run: () => self.openGitHubHub() },
                ...TABS.map(t => ({ section: S, icon: t.icon, label: `GitHub: ${t.label}`, hint: t.id, run: () => self.openGitHubHub(t.id) })),
                { section: S, icon: 'fa-folder-tree', label: 'GitHub: مستكشف الملفات', hint: 'File explorer', run: () => self.openGitHubWorkbench() },
                { section: S, icon: 'fa-cloud-arrow-up', label: 'مراجعة ورفع الملف النشط (Commit)', hint: 'Commit active file', run: () => self.activeStudioFile ? self.commitStudioFile() : self.showToast('افتح ملفاً في الاستوديو أولاً', 'warning') }
            ];
            let at = -1;
            cmds.forEach((c, i) => { if (c.section === S) at = i; });
            cmds.splice(at === -1 ? cmds.length : at + 1, 0, ...extra);
            return cmds;
        };
    }

    // ------------------------------------------------------------------ INIT
    P.initSprint3 = function () {
        window.addEventListener('keydown', (e) => {
            const ctrl = e.ctrlKey || e.metaKey;
            if (e.altKey && !ctrl && e.key.toLowerCase() === 'g') { e.preventDefault(); this.openGitHubHub(); }
        });
    };
    if (window.app) {
        try { window.app.initSprint3(); } catch (e) { console.error('Sprint 3 init failed', e); }
    }
})();
