/* Tab system for the new GitHub Hub tabs + small UI kit shared by every section. */
import { esc } from './shared.js';

export const card = (title, body, { icon, id, actions = '', cls = '' } = {}) =>
    `<div class="gh-card ghx-card ${cls}"${id ? ` id="${id}"` : ''}><div class="ghx-card-head"><b>${icon ? `<i class="fa-solid ${icon}"></i> ` : ''}${title}</b><span class="gh-spacer"></span>${actions}</div>${body}</div>`;
export const btn = (label, onclick, { icon, primary, danger, title, attrs = '' } = {}) =>
    `<button class="${primary ? 'btn-new-thread' : 'sidebar-btn-util'} gh-btn${danger ? ' danger' : ''}" onclick="${onclick}"${title ? ` title="${esc(title)}"` : ''} ${attrs}>${icon ? `<i class="fa-solid ${icon}"></i>` : ''}${label ? ` ${label}` : ''}</button>`;
export const link = (label, href, { icon = 'fa-up-right-from-square' } = {}) =>
    `<a class="sidebar-btn-util gh-btn" href="${esc(href)}" target="_blank" rel="noopener"><i class="fa-solid ${icon}"></i> ${label}</a>`;
export const empty = (msg) => `<div class="gh-empty">${msg}</div>`;
export const note = (msg, kind = '') => `<div class="ghx-note ${kind}">${msg}</div>`;
export const backBtn = (label = 'رجوع') => `<button class="sidebar-btn-util gh-btn" onclick="app.ghView=null; app.refreshGitHubHub()"><i class="fa-solid fa-arrow-right"></i> ${label}</button>`;
export const input = (id, { value = '', placeholder = '', dir = 'ltr', type = 'text', style = '', list = '' } = {}) =>
    `<input id="${id}" type="${type}" class="form-input-box" value="${esc(value)}" placeholder="${esc(placeholder)}" dir="${dir}"${style ? ` style="${style}"` : ''}${list ? ` list="${list}"` : ''} autocomplete="off">`;
export const select = (id, options, value, { style = '' } = {}) =>
    `<select id="${id}" class="form-input-box"${style ? ` style="${style}"` : ''}>${options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
export const val = (id) => { const el = typeof document !== 'undefined' && document.getElementById(id); return el ? (el.type === 'checkbox' ? el.checked : String(el.value || '').trim()) : ''; };
export const avatar = (u, size = 20) => (u && u.avatar_url ? `<img class="ghx-avatar" src="${esc(u.avatar_url)}&s=${size * 2}" width="${size}" height="${size}" alt="" loading="lazy">` : '');

/** Tabs added by Sprint 9 (the ids must match src/features/16-github-pro.js). */
export const TAB_DEFS = {
    history: [['timeline', 'السجل الزمني', 'fa-timeline', 'ghxTimeline'], ['graph', 'شبكة الفروع', 'fa-diagram-project', 'ghxGraph'], ['blame', 'Blame', 'fa-user-pen', 'ghxBlame'], ['rewrite', 'إعادة كتابة السجل', 'fa-shuffle', 'ghxRewrite'], ['tags', 'الوسوم', 'fa-tags', 'ghxTags']],
    search: [['code', 'الكود', 'fa-code', 'ghxSearchCode'], ['issues', 'Issues', 'fa-circle-dot', 'ghxSearchIssues'], ['prs', 'PRs', 'fa-code-pull-request', 'ghxSearchPRs'], ['commits', 'Commits', 'fa-code-commit', 'ghxSearchCommits'], ['repos', 'المستودعات', 'fa-book', 'ghxSearchRepos']],
    planning: [['board', 'لوحة المشروع', 'fa-table-columns', 'ghxBoard'], ['labels', 'التصنيفات', 'fa-tag', 'ghxLabels'], ['milestones', 'المراحل', 'fa-flag', 'ghxMilestones'], ['people', 'المكلّفون', 'fa-user-check', 'ghxAssignees'], ['projects', 'Projects', 'fa-diagram-next', 'ghxProjects']],
    ops: [['live', 'تشغيل حي', 'fa-satellite-dish', 'ghxLiveList'], ['artifacts', 'Artifacts', 'fa-box-archive', 'ghxArtifacts'], ['runners', 'Runners', 'fa-server', 'ghxRunners'], ['secrets', 'Secrets', 'fa-key', 'ghxSecrets'], ['envs', 'Environments', 'fa-layer-group', 'ghxEnvironments'], ['vars', 'Variables', 'fa-sliders', 'ghxVariables'], ['usage', 'الاستهلاك', 'fa-gauge-high', 'ghxUsage']],
    analytics: [['activity', 'النشاط والتنبؤ', 'fa-chart-column', 'ghxActivity'], ['people', 'المساهمون', 'fa-users', 'ghxContributorsChart'], ['traffic', 'الزيارات', 'fa-eye', 'ghxTraffic'], ['files', 'أكثر الملفات تعديلاً', 'fa-fire', 'ghxTopFiles'], ['deps', 'الاعتماديات', 'fa-cubes', 'ghxDependencyGraph'], ['report', 'التقارير والتصدير', 'fa-file-lines', 'ghxReport']],
    repo: [['general', 'عام', 'fa-gear', 'ghxRepoGeneral'], ['protection', 'حماية الفروع', 'fa-shield-halved', 'ghxProtection'], ['webhooks', 'Webhooks', 'fa-bolt', 'ghxWebhooks'], ['keys', 'Deploy Keys', 'fa-key', 'ghxDeployKeys'], ['apps', 'التطبيقات', 'fa-puzzle-piece', 'ghxApps'], ['fork', 'الـ Fork', 'fa-code-fork', 'ghxForkSync'], ['domain', 'نطاق Pages', 'fa-globe', 'ghxDomain'], ['danger', 'منطقة الخطر', 'fa-triangle-exclamation', 'ghxDanger']],
    move: [['compare', 'مقارنة مستودعين', 'fa-code-compare', 'ghxRepoCompare'], ['files', 'نقل ونسخ الملفات', 'fa-right-left', 'ghxMoveFiles'], ['clone', 'استنساخ برابط', 'fa-link', 'ghxCloneUrl'], ['import', 'استيراد GitLab/Bitbucket', 'fa-file-import', 'ghxImport'], ['export', 'تصدير لمستودع جديد', 'fa-file-export', 'ghxExport'], ['mirror', 'Mirror', 'fa-clone', 'ghxMirror']],
    clone: [['options', 'خيارات الاستنساخ', 'fa-terminal', 'ghxCloneOptions'], ['ssh', 'مفاتيح SSH', 'fa-key', 'ghxSSH'], ['check', 'فحص الاتصال', 'fa-stethoscope', 'ghxConnectionCheck'], ['codespaces', 'Codespaces', 'fa-laptop-code', 'ghxCodespaces']],
    community: [['health', 'ملفات المجتمع', 'fa-heart-pulse', 'ghxCommunity'], ['wiki', 'الويكي', 'fa-book-open', 'ghxWiki'], ['sponsors', 'الرعاة', 'fa-hand-holding-heart', 'ghxSponsors']],
    gists: [['mine', 'Gists', 'fa-note-sticky', 'ghxGists'], ['starred', 'المميزة بنجمة', 'fa-star', 'ghxGistsStarred']],
    org: [['orgs', 'المؤسسات', 'fa-building', 'ghxOrgs'], ['collab', 'المتعاونون والأدوار', 'fa-user-shield', 'ghxCollaborators'], ['audit', 'سجل النشاط', 'fa-list-check', 'ghxAuditLog']]
};

export function installCore(P) {
    P.GHX_TAB_DEFS = TAB_DEFS;

    /** Render one of the Sprint 9 tabs (optionally switching its section). */
    P.ghxLoad = async function (tab, sec) {
        const defs = TAB_DEFS[tab];
        if (!defs) return;
        this._ghxSec = this._ghxSec || {};
        if (sec) this._ghxSec[tab] = sec;
        let cur = this._ghxSec[tab];
        if (!defs.some(d => d[0] === cur)) cur = defs[0][0];
        this._ghxSec[tab] = cur;
        if (this.ghTab !== tab) { this.ghTab = tab; this.ghView = null; if (this.renderGhTabs) this.renderGhTabs(); }
        this.ghLoading();
        const nav = `<div class="ghx-subnav" role="tablist">${defs.map(([id, label, icon]) => `<button class="gh-chip ${id === cur ? 'active' : ''}" data-ghx-sec="${id}" role="tab" aria-selected="${id === cur}" onclick="app.ghxLoad('${tab}','${id}')"><i class="fa-solid ${icon}"></i> ${label}</button>`).join('')}</div>`;
        const method = defs.find(d => d[0] === cur)[3];
        let html;
        try { html = await this[method](); } catch (e) { html = this.ghxErrorHTML(e); }
        if (this.ghTab !== tab || this.ghView || this._ghxSec[tab] !== cur) return;
        this.ghSetBody(nav + `<div class="ghx-sec" data-ghx-tab="${tab}" data-ghx-sec="${cur}">${html || ''}</div>`);
        if (typeof this._ghxAfter === 'function') { const f = this._ghxAfter; this._ghxAfter = null; try { f(); } catch (e) { console.warn(e); } }
    };
    /** Re-render the current Sprint 9 section (after an action). */
    P.ghxReload = function () { if (this.ghView) return this.refreshGitHubHub(); return this.ghxLoad(this.ghTab); };

    P.ghxErrorHTML = function (e) {
        const st = e && e.status;
        const noToken = !(this.settings.githubToken || '').trim();
        const hint = st === 403 && !noToken ? '<div class="text-dim" style="font-size:0.74rem;margin-top:6px">قد تحتاج صلاحيات إضافية للرمز (مثل admin أو workflow أو read:org) أو صلاحية مالك المستودع.</div>' : '';
        return `<div class="gh-empty bad">❌ ${esc((e && e.message) || String(e))}${hint}
            ${noToken && (st === 401 || st === 403 || st === 404 || e.needToken) ? `<div style="margin-top:10px">${btn('إضافة رمز GitHub', "app.closeModals(); app.openSettingsModal(); app.switchSettingsTab('tab-github')", { icon: 'fa-key', primary: true })}</div>` : ''}
            <div style="margin-top:8px">${btn('إعادة المحاولة', 'app.ghxReload()', { icon: 'fa-rotate' })}</div></div>`;
    };

    /** Throw a friendly error when the operation needs a token (rendered by ghxErrorHTML). */
    P.ghxNeedToken = function (what = 'هذه الميزة') {
        if ((this.settings.githubToken || '').trim()) return;
        const e = new Error(`${what} تحتاج رمز GitHub PAT (الإعدادات ← GitHub)`);
        e.needToken = true; e.status = 401;
        throw e;
    };

    /** Sub-view inside a Sprint 9 tab (refresh re-renders it; «رجوع» returns to the section). */
    P.ghxView = async function (fn, args, render) {
        this.ghView = { fn, args };
        this.ghLoading();
        let html;
        try { html = await render(); } catch (e) { html = this.ghxErrorHTML(e); }
        if (!this.ghView || this.ghView.fn !== fn) return;
        this.ghSetBody(`<div class="gh-toolbar">${backBtn()}</div>` + html);
        if (typeof this._ghxAfter === 'function') { const f = this._ghxAfter; this._ghxAfter = null; try { f(); } catch (e) { console.warn(e); } }
    };

    /** GitHub GraphQL (blame, sponsors, Projects v2). Needs a token. */
    P.ghGraphQL = async function (query, variables = {}) {
        this.ghxNeedToken('واجهة GraphQL');
        const r = await this.gh('/graphql', { method: 'POST', body: { query, variables } });
        if (r && r.errors && r.errors.length) { const e = new Error(r.errors.map(x => x.message).join('، ')); e.graphql = r.errors; throw e; }
        return r ? r.data : null;
    };

    /** Login of the token owner (cached). */
    P.ghViewer = async function () {
        if (!(this.settings.githubToken || '').trim()) return null;
        const tok = this.settings.githubToken.trim().slice(-6);
        if (this._ghViewer && this._ghViewer.tok === tok) return this._ghViewer.user;
        const user = await this.gh('/user');
        this._ghViewer = { tok, user };
        return user;
    };

    /** Raw fetch with token (needed when we must read response headers or post binary bodies). */
    P.ghFetch = async function (url, opts = {}) {
        const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) };
        const token = (this.settings.githubToken || '').trim();
        if (token && opts.auth !== false) headers.Authorization = `Bearer ${token}`;
        return fetch(url, { ...opts, headers });
    };

    /** Confirmation helper that works with the in-app dialog (falls back to confirm()). */
    P.ghxConfirm = async function (title, message, opts = {}) {
        if (this.askConfirm) return this.askConfirm(title, message, opts);
        return typeof confirm === 'function' ? confirm(message) : true;
    };
    /** Typed confirmation for destructive actions (type the repo/branch name). */
    P.ghxTypeConfirm = async function (title, message, expected) {
        const v = await this.askText(title, '', { body: `<p class="ox-dialog-msg">${message}</p><p class="ox-dialog-msg">اكتب <b dir="ltr">${esc(expected)}</b> للتأكيد:</p>`, okLabel: 'تأكيد', validate: (x) => (x === expected ? null : 'النص غير مطابق') });
        return v === expected;
    };

    P.ghxCopy = function (text, msg = 'تم النسخ ✓') {
        try { if (this.copyToClipboard) this.copyToClipboard(text); else navigator.clipboard.writeText(text); this.showToast(msg, 'success'); } catch (e) { this.showToast('تعذر النسخ', 'error'); }
    };
    P.ghxCopyFrom = function (id) { const el = document.getElementById(id); if (el) this.ghxCopy(el.value != null && el.tagName !== 'PRE' && el.tagName !== 'CODE' ? el.value : el.textContent); };
    P.ghxDownload = function (text, name, type = 'text/plain') { this.downloadBlob(new Blob([text], { type }), name); };

    P.ghxBranches = async function (rp) {
        const list = await this.gh(`${rp || this.ghRepoPath()}/branches?per_page=100`);
        return list.map(b => b.name);
    };
}
