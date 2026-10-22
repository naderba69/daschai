/* Planning tab: project board (#439), labels & milestones (#437), assignees (#438),
   issue ↔ PR links (#436), Projects v2 listing. */
import { esc, call } from './shared.js';
import { card, btn, empty, note, input, val, avatar } from './core.js';

export const DOING_LABELS = ['in progress', 'in-progress', 'doing', 'wip', 'قيد التنفيذ'];
export const DEFAULT_LABELS = [
    ['bug', 'd73a4a', 'خطأ يحتاج إصلاحاً'], ['enhancement', 'a2eeef', 'ميزة أو تحسين جديد'], ['documentation', '0075ca', 'تحسين التوثيق'],
    ['in progress', 'fbca04', 'قيد التنفيذ'], ['good first issue', '7057ff', 'مناسب للمساهمين الجدد'], ['help wanted', '008672', 'نحتاج مساعدة'],
    ['question', 'd876e3', 'سؤال أو استفسار'], ['priority: high', 'b60205', 'أولوية عالية']
];

/** Board column for an issue (pure; tested). */
export function boardColumn(issue) {
    if (issue.state === 'closed') return 'done';
    const names = (issue.labels || []).map(l => String(typeof l === 'string' ? l : l.name).toLowerCase());
    return names.some(n => DOING_LABELS.includes(n)) ? 'doing' : 'todo';
}

/** "Closes #n" appended once to a PR body (pure; tested). */
export function withClosingRef(body, n) {
    const b = String(body || '');
    if (new RegExp(`\\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\\s+#${n}\\b`, 'i').test(b)) return b;
    return (b.trim() ? b.trim() + '\n\n' : '') + `Closes #${n}`;
}

export function installPlanning(P) {
    const labelChip = (l) => `<span class="gh-label" style="--c:#${esc(l.color || '888')}" title="${esc(l.description || '')}">${esc(l.name)}</span>`;

    // ------------------------------------------------------------------ BOARD (#439)
    P.ghxBoard = async function () {
        const rp = this.ghRepoPath();
        const [open, closed] = await Promise.all([
            this.gh(`${rp}/issues?state=open&per_page=100`),
            this.gh(`${rp}/issues?state=closed&per_page=20&sort=updated`).catch(() => [])
        ]);
        const issues = [...open, ...closed].filter(i => !i.pull_request);
        this._ghxBoard = issues;
        const cols = { todo: [], doing: [], done: [] };
        issues.forEach(i => cols[boardColumn(i)].push(i));
        const order = ['todo', 'doing', 'done'];
        const meta = { todo: ['للتنفيذ', 'fa-regular fa-circle'], doing: ['قيد التنفيذ', 'fa-solid fa-spinner'], done: ['منجز', 'fa-solid fa-circle-check'] };
        const cardHTML = (i, col) => {
            const k = order.indexOf(col);
            return `<div class="ghx-kcard" data-issue="${+i.number}">
                <div class="ghx-kcard-title"><a href="#" onclick="event.preventDefault(); app.ghOpenIssue(${+i.number})">#${+i.number}</a> ${esc(i.title)}</div>
                <div class="ghx-kcard-meta">${(i.labels || []).map(labelChip).join('')}${i.milestone ? `<span class="gh-badge dim"><i class="fa-solid fa-flag"></i> ${esc(i.milestone.title)}</span>` : ''}${(i.assignees || []).map(a => avatar(a, 18)).join('')}</div>
                <div class="ghx-kcard-actions">
                    ${k > 0 ? btn('', `app.ghxBoardMove(${+i.number},'${order[k - 1]}')`, { icon: 'fa-arrow-right', title: 'نقل للعمود السابق' }) : ''}
                    ${k < 2 ? btn('', `app.ghxBoardMove(${+i.number},'${order[k + 1]}')`, { icon: 'fa-arrow-left', title: 'نقل للعمود التالي' }) : ''}
                    ${btn('', `app.ghxAssignUI(${+i.number})`, { icon: 'fa-user-plus', title: 'إسناد' })}
                    ${btn('', `app.ghxIssueLabelsUI(${+i.number})`, { icon: 'fa-tag', title: 'التصنيفات' })}
                    ${btn('', `app.ghxIssueMilestoneUI(${+i.number})`, { icon: 'fa-flag', title: 'المرحلة' })}
                    ${btn('', `app.ghxLinkIssuePR(${+i.number})`, { icon: 'fa-code-pull-request', title: 'ربط بـ PR' })}
                    ${btn('', `app.ghxIssueLinks(${+i.number})`, { icon: 'fa-link', title: 'الـ Commits والـ PRs المرتبطة' })}
                </div></div>`;
        };
        return `<div class="gh-toolbar"><span class="text-dim" style="font-size:0.74rem">اللوحة مبنية على Issues: عمود «قيد التنفيذ» = تصنيف <code dir="ltr">in progress</code>، «منجز» = مغلقة.</span><span class="gh-spacer"></span>${btn('Issue جديدة', 'app.ghShowCreateIssue()', { icon: 'fa-plus', primary: true })}</div>
            <div class="ghx-board">${order.map(col => `<div class="ghx-kcol" data-col="${col}"><div class="ghx-kcol-head"><i class="${meta[col][1]}"></i> ${meta[col][0]} <span class="gh-badge dim">${cols[col].length}</span></div>
                ${cols[col].map(i => cardHTML(i, col)).join('') || '<div class="text-dim ghx-kempty">—</div>'}</div>`).join('')}</div>`;
    };

    P.ghxEnsureLabel = async function (name, color = 'fbca04', description = '') {
        try { await this.gh(`${this.ghRepoPath()}/labels`, { method: 'POST', body: { name, color, description } }); } catch (e) { if (e.status !== 422) throw e; }
    };

    P.ghxBoardMove = async function (n, to) {
        if (!this.ghRequireToken()) return;
        const rp = this.ghRepoPath();
        const issue = await this.gh(`${rp}/issues/${n}`).catch(() => (this._ghxBoard || []).find(i => i.number === n)); // fresh labels (cache may be stale)
        if (!issue) return;
        const doing = (issue.labels || []).map(l => l.name).filter(x => DOING_LABELS.includes(String(x).toLowerCase()));
        try {
            if (to === 'doing') {
                await this.ghxEnsureLabel('in progress', 'fbca04', 'قيد التنفيذ');
                if (issue.state === 'closed') await this.gh(`${rp}/issues/${n}`, { method: 'PATCH', body: { state: 'open' } });
                await this.gh(`${rp}/issues/${n}/labels`, { method: 'POST', body: { labels: ['in progress'] } });
            } else {
                for (const l of doing) await this.gh(`${rp}/issues/${n}/labels/${encodeURIComponent(l)}`, { method: 'DELETE' }).catch(() => null);
                await this.gh(`${rp}/issues/${n}`, { method: 'PATCH', body: { state: to === 'done' ? 'closed' : 'open' } });
            }
            this.showToast(`✅ #${n} → ${{ todo: 'للتنفيذ', doing: 'قيد التنفيذ', done: 'منجز' }[to]}`, 'success');
            if (this.ghTab === 'planning' && !this.ghView) this.ghxReload();
            return true;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };

    // ------------------------------------------------------------------ ASSIGNEES (#438)
    P.ghxAssignUI = async function (n) {
        if (!this.ghRequireToken()) return;
        const rp = this.ghRepoPath();
        try {
            const [people, issue] = await Promise.all([this.gh(`${rp}/assignees?per_page=100`), this.gh(`${rp}/issues/${n}`)]);
            const cur = new Set((issue.assignees || []).map(a => a.login));
            const r = await this.showDialog({
                title: `👤 إسناد #${n}`,
                body: people.length ? '' : '<p class="ox-dialog-msg">لا يوجد أشخاص قابلون للإسناد في هذا المستودع.</p>',
                fields: people.map((u, i) => ({ id: 'u' + i, type: 'checkbox', label: u.login, value: cur.has(u.login) })),
                buttons: [{ label: 'حفظ', value: 'ok', primary: true }, { label: 'إلغاء', value: null }]
            });
            if (!r) return;
            const assignees = people.filter((u, i) => r.values['u' + i]).map(u => u.login);
            await this.gh(`${rp}/issues/${n}`, { method: 'PATCH', body: { assignees } });
            this.showToast(assignees.length ? `✅ أُسندت #${n} إلى ${assignees.join('، ')}` : `أزيل الإسناد عن #${n}`, 'success');
            if (this.ghTab === 'planning' && !this.ghView) this.ghxReload();
            return assignees;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };

    P.ghxIssueLabelsUI = async function (n) {
        if (!this.ghRequireToken()) return;
        const rp = this.ghRepoPath();
        try {
            const [labels, issue] = await Promise.all([this.gh(`${rp}/labels?per_page=100`), this.gh(`${rp}/issues/${n}`)]);
            const cur = new Set((issue.labels || []).map(l => l.name));
            const r = await this.showDialog({
                title: `🏷️ تصنيفات #${n}`,
                fields: labels.map((l, i) => ({ id: 'l' + i, type: 'checkbox', label: l.name, value: cur.has(l.name) })),
                buttons: [{ label: 'حفظ', value: 'ok', primary: true }, { label: 'إلغاء', value: null }]
            });
            if (!r) return;
            const chosen = labels.filter((l, i) => r.values['l' + i]).map(l => l.name);
            await this.gh(`${rp}/issues/${n}/labels`, { method: 'PUT', body: { labels: chosen } });
            this.showToast(`✅ حُدّثت تصنيفات #${n}`, 'success');
            if (this.ghTab === 'planning' && !this.ghView) this.ghxReload();
            return chosen;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };

    P.ghxIssueMilestoneUI = async function (n) {
        if (!this.ghRequireToken()) return;
        const rp = this.ghRepoPath();
        try {
            const [ms, issue] = await Promise.all([this.gh(`${rp}/milestones?state=open&per_page=100`), this.gh(`${rp}/issues/${n}`)]);
            const r = await this.showDialog({
                title: `🚩 مرحلة #${n}`,
                fields: [{ id: 'm', type: 'select', label: 'المرحلة', value: String(issue.milestone ? issue.milestone.number : ''), options: [{ value: '', label: '— بدون —' }, ...ms.map(m => ({ value: String(m.number), label: m.title }))] }],
                buttons: [{ label: 'حفظ', value: 'ok', primary: true }, { label: 'إلغاء', value: null }]
            });
            if (!r) return;
            await this.gh(`${rp}/issues/${n}`, { method: 'PATCH', body: { milestone: r.values.m ? +r.values.m : null } });
            this.showToast('✅ حُدّثت المرحلة', 'success');
            if (this.ghTab === 'planning' && !this.ghView) this.ghxReload();
            return r.values.m;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };

    // ------------------------------------------------------------------ ISSUE ↔ PR (#436)
    P.ghxLinkIssuePR = async function (n) {
        if (!this.ghRequireToken()) return;
        const rp = this.ghRepoPath();
        try {
            const prs = await this.gh(`${rp}/pulls?state=open&per_page=50`);
            if (!prs.length) { this.showToast('لا توجد PRs مفتوحة للربط', 'info'); return; }
            const r = await this.showDialog({
                title: `🔗 ربط #${n} بـ Pull Request`,
                body: '<p class="ox-dialog-msg">يُضاف <code dir="ltr">Closes #n</code> لوصف الـ PR، فتُغلق الـ Issue تلقائياً عند دمجه.</p>',
                fields: [{ id: 'pr', type: 'select', label: 'الـ PR', value: String(prs[0].number), options: prs.map(p => ({ value: String(p.number), label: `#${p.number} ${p.title}` })) }],
                buttons: [{ label: 'ربط', value: 'ok', primary: true }, { label: 'إلغاء', value: null }]
            });
            if (!r) return;
            const pr = prs.find(p => String(p.number) === r.values.pr);
            const body = withClosingRef(pr.body, n);
            if (body !== String(pr.body || '')) await this.gh(`${rp}/pulls/${pr.number}`, { method: 'PATCH', body: { body } });
            this.showToast(`✅ الـ PR #${pr.number} سيغلق #${n} عند الدمج`, 'success');
            return pr.number;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };

    /** Commits & PRs that mention an issue (#440 + #436). */
    P.ghxIssueLinks = function (n) {
        return this.ghxView('ghxIssueLinks', [n], async () => {
            const { owner, repo } = this.ghRepo();
            const [commits, prs] = await Promise.all([
                this.gh(`/search/commits?q=${encodeURIComponent(`repo:${owner}/${repo} #${n}`)}&per_page=30`).catch(() => ({ items: [] })),
                this.gh(`/search/issues?q=${encodeURIComponent(`repo:${owner}/${repo} is:pr #${n}`)}&per_page=30`).catch(() => ({ items: [] }))
            ]);
            return `<div class="gh-detail-head"><h3>روابط الـ Issue #${n}</h3></div>
                ${card('Commits تذكرها', (commits.items || []).map(c => `<div class="gh-check-row"><a href="#" onclick="event.preventDefault(); ${call(this, 'ghxCommitView', c.sha)}"><code dir="ltr">${esc(c.sha.slice(0, 7))}</code></a> ${esc(c.commit.message.split('\n')[0])}</div>`).join('') || '<div class="text-dim">—</div>', { icon: 'fa-code-commit' })}
                ${card('Pull Requests', (prs.items || []).map(p => `<div class="gh-check-row"><a href="#" onclick="event.preventDefault(); app.ghOpenPR(${+p.number})">#${+p.number}</a> ${esc(p.title)} <span class="gh-badge ${p.state === 'open' ? 'ok' : 'dim'}">${esc(p.state)}</span></div>`).join('') || '<div class="text-dim">—</div>', { icon: 'fa-code-pull-request', actions: btn('ربط بـ PR', `app.ghxLinkIssuePR(${n})`, { icon: 'fa-link' }) })}`;
        });
    };

    // ------------------------------------------------------------------ LABELS (#437)
    P.ghxLabels = async function () {
        const labels = await this.gh(`${this.ghRepoPath()}/labels?per_page=100`);
        const missing = DEFAULT_LABELS.filter(([n]) => !labels.some(l => l.name.toLowerCase() === n));
        return card('تصنيف جديد', `<div class="gh-row">${input('ghx-label-name', { placeholder: 'bug', dir: 'auto', style: 'max-width:180px' })}<input type="color" id="ghx-label-color" value="#34d399" class="ghx-color">
                ${input('ghx-label-desc', { placeholder: 'الوصف (اختياري)', dir: 'auto', style: 'flex:1' })}${btn('إضافة', 'app.ghxCreateLabel()', { icon: 'fa-plus', primary: true })}</div>
                ${missing.length ? `<div class="gh-row" style="margin-top:6px">${btn(`إضافة المجموعة القياسية (${missing.length})`, 'app.ghxCreateDefaultLabels()', { icon: 'fa-wand-magic-sparkles' })}<span class="text-dim" style="font-size:0.72rem">${missing.map(m => esc(m[0])).join('، ')}</span></div>` : ''}`, { icon: 'fa-tag' })
            + (labels.length ? `<div class="gh-list">${labels.map(l => `<div class="gh-item static" data-label="${esc(l.name)}">${labelChip(l)}<div class="gh-item-main"><div class="gh-item-meta">${esc(l.description || '')}</div></div>
                <div class="gh-item-actions">${btn('', call(this, 'ghxEditLabel', l.name), { icon: 'fa-pen', title: 'تعديل' })}${btn('', call(this, 'ghxDeleteLabel', l.name), { icon: 'fa-trash', danger: true, title: 'حذف' })}</div></div>`).join('')}</div>` : empty('لا توجد تصنيفات.'));
    };

    P.ghxCreateLabel = async function (o) {
        if (!this.ghRequireToken()) return;
        const name = o ? o.name : val('ghx-label-name');
        const color = String(o ? o.color : val('ghx-label-color')).replace('#', '') || '34d399';
        const description = o ? o.description || '' : val('ghx-label-desc');
        if (!name) { this.showToast('اكتب اسم التصنيف', 'warning'); return; }
        try {
            await this.gh(`${this.ghRepoPath()}/labels`, { method: 'POST', body: { name, color, description } });
            this.showToast(`✅ أضيف التصنيف ${name}`, 'success');
            if (this.ghTab === 'planning' && !this.ghView) this.ghxReload();
            return true;
        } catch (e) { this.showToast(e.status === 422 ? '❌ التصنيف موجود' : '❌ ' + e.message, 'error'); return false; }
    };
    P.ghxCreateDefaultLabels = async function () {
        if (!this.ghRequireToken()) return;
        let n = 0;
        for (const [name, color, description] of DEFAULT_LABELS) {
            try { await this.gh(`${this.ghRepoPath()}/labels`, { method: 'POST', body: { name, color, description } }); n++; } catch (e) { if (e.status !== 422) { this.showToast('❌ ' + e.message, 'error'); break; } }
        }
        this.showToast(`✅ أضيف ${n} تصنيف`, 'success');
        if (this.ghTab === 'planning' && !this.ghView) this.ghxReload();
        return n;
    };
    P.ghxEditLabel = async function (name) {
        if (!this.ghRequireToken()) return;
        const rp = this.ghRepoPath();
        const l = await this.gh(`${rp}/labels/${encodeURIComponent(name)}`).catch(() => ({ name, color: '888888', description: '' }));
        const r = await this.showDialog({
            title: `تعديل التصنيف ${name}`,
            fields: [{ id: 'name', label: 'الاسم', value: l.name, dir: 'auto' }, { id: 'color', label: 'اللون (hex)', value: l.color }, { id: 'description', label: 'الوصف', value: l.description || '', dir: 'auto' }],
            buttons: [{ label: 'حفظ', value: 'ok', primary: true, validate: (v) => (/^#?[0-9a-f]{6}$/i.test(v.color.trim()) ? null : 'لون غير صالح') }, { label: 'إلغاء', value: null }]
        });
        if (!r) return;
        try {
            await this.gh(`${rp}/labels/${encodeURIComponent(name)}`, { method: 'PATCH', body: { new_name: r.values.name.trim(), color: r.values.color.trim().replace('#', ''), description: r.values.description } });
            this.showToast('✅ حُدّث التصنيف', 'success');
            if (this.ghTab === 'planning' && !this.ghView) this.ghxReload();
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };
    P.ghxDeleteLabel = async function (name) {
        if (!this.ghRequireToken()) return;
        if (!(await this.ghxConfirm('حذف تصنيف', `حذف <b>${esc(name)}</b> من المستودع وكل الـ Issues؟`, { danger: true }))) return;
        try {
            await this.gh(`${this.ghRepoPath()}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' });
            this.showToast('تم الحذف', 'success');
            if (this.ghTab === 'planning' && !this.ghView) this.ghxReload();
            return true;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };

    // ------------------------------------------------------------------ MILESTONES (#437)
    P.ghxMilestones = async function () {
        const ms = await this.gh(`${this.ghRepoPath()}/milestones?state=all&per_page=100&sort=due_on`);
        return card('مرحلة جديدة', `<div class="gh-row">${input('ghx-ms-title', { placeholder: 'v2.0', dir: 'auto', style: 'max-width:200px' })}<label>الموعد</label><input type="date" id="ghx-ms-due" class="form-input-box" style="width:auto">
                ${input('ghx-ms-desc', { placeholder: 'الوصف', dir: 'auto', style: 'flex:1' })}${btn('إضافة', 'app.ghxCreateMilestone()', { icon: 'fa-plus', primary: true })}</div>`, { icon: 'fa-flag' })
            + (ms.length ? `<div class="gh-list">${ms.map(m => {
                const total = (+m.open_issues || 0) + (+m.closed_issues || 0);
                const pct = total ? Math.round((+m.closed_issues / total) * 100) : 0;
                const overdue = m.state === 'open' && m.due_on && Date.parse(m.due_on) < Date.now();
                return `<div class="gh-item static" data-milestone="${+m.number}"><i class="fa-solid fa-flag ${m.state === 'open' ? 'text-emerald' : 'text-dim'}"></i><div class="gh-item-main">
                    <div class="gh-item-title">${esc(m.title)} ${m.state === 'closed' ? '<span class="gh-badge dim">مغلقة</span>' : ''} ${overdue ? '<span class="gh-badge bad">متأخرة</span>' : ''}</div>
                    <div class="ghx-progress"><i style="width:${pct}%"></i></div>
                    <div class="gh-item-meta">${pct}% • ${+m.closed_issues} مغلقة • ${+m.open_issues} مفتوحة${m.due_on ? ` • الموعد ${esc(new Date(m.due_on).toLocaleDateString('ar'))}` : ''}</div></div>
                    <div class="gh-item-actions">${btn('', `app.ghxSetMilestoneState(${+m.number},'${m.state === 'open' ? 'closed' : 'open'}')`, { icon: m.state === 'open' ? 'fa-check' : 'fa-rotate-left', title: m.state === 'open' ? 'إغلاق' : 'إعادة فتح' })}${btn('', `app.ghxDeleteMilestone(${+m.number})`, { icon: 'fa-trash', danger: true, title: 'حذف' })}</div></div>`;
            }).join('')}</div>` : empty('لا توجد مراحل.'));
    };
    P.ghxCreateMilestone = async function (o) {
        if (!this.ghRequireToken()) return;
        const title = o ? o.title : val('ghx-ms-title');
        const due = o ? o.due : val('ghx-ms-due');
        const description = o ? o.description || '' : val('ghx-ms-desc');
        if (!title) { this.showToast('اكتب عنوان المرحلة', 'warning'); return; }
        const body = { title, description };
        if (due) body.due_on = new Date(due + 'T23:59:59Z').toISOString();
        try {
            const m = await this.gh(`${this.ghRepoPath()}/milestones`, { method: 'POST', body });
            this.showToast(`✅ أضيفت المرحلة ${title}`, 'success');
            if (this.ghTab === 'planning' && !this.ghView) this.ghxReload();
            return m;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };
    P.ghxSetMilestoneState = async function (n, state) {
        if (!this.ghRequireToken()) return;
        try { await this.gh(`${this.ghRepoPath()}/milestones/${n}`, { method: 'PATCH', body: { state } }); this.showToast('✅ تم', 'success'); if (this.ghTab === 'planning' && !this.ghView) this.ghxReload(); } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };
    P.ghxDeleteMilestone = async function (n) {
        if (!this.ghRequireToken()) return;
        if (!(await this.ghxConfirm('حذف مرحلة', 'حذف المرحلة؟ لن تُحذف الـ Issues.', { danger: true }))) return;
        try { await this.gh(`${this.ghRepoPath()}/milestones/${n}`, { method: 'DELETE' }); this.showToast('تم الحذف', 'success'); if (this.ghTab === 'planning' && !this.ghView) this.ghxReload(); } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };

    // ------------------------------------------------------------------ PEOPLE (#438)
    P.ghxAssignees = async function () {
        const rp = this.ghRepoPath();
        const [people, issues] = await Promise.all([this.gh(`${rp}/assignees?per_page=100`), this.gh(`${rp}/issues?state=open&per_page=100`)]);
        const load = new Map();
        const unassigned = [];
        issues.filter(i => !i.pull_request).forEach(i => { if (!(i.assignees || []).length) unassigned.push(i); (i.assignees || []).forEach(a => { const l = load.get(a.login) || []; l.push(i); load.set(a.login, l); }); });
        return `<div class="gh-list">${people.map(u => {
            const list = load.get(u.login) || [];
            return `<details class="gh-card" data-person="${esc(u.login)}"><summary>${avatar(u)} <b>${esc(u.login)}</b> <span class="gh-badge ${list.length ? 'run' : 'dim'}">${list.length} مفتوحة</span></summary>
                ${list.map(i => `<div class="gh-check-row"><a href="#" onclick="event.preventDefault(); app.ghOpenIssue(${+i.number})">#${+i.number}</a> ${esc(i.title)}</div>`).join('') || '<div class="text-dim">لا مهام</div>'}</details>`;
        }).join('') || empty('لا يوجد أشخاص قابلون للإسناد.')}</div>
            ${card(`غير مُسندة (${unassigned.length})`, unassigned.map(i => `<div class="gh-check-row"><a href="#" onclick="event.preventDefault(); app.ghOpenIssue(${+i.number})">#${+i.number}</a> ${esc(i.title)} ${btn('إسناد', `app.ghxAssignUI(${+i.number})`, { icon: 'fa-user-plus' })}</div>`).join('') || '<div class="text-dim">كل الـ Issues مُسندة 👌</div>', { icon: 'fa-user-slash' })}`;
    };

    // ------------------------------------------------------------------ PROJECTS v2 (GraphQL)
    P.ghxProjects = async function () {
        if (!(this.settings.githubToken || '').trim()) return note('عرض GitHub Projects (v2) يحتاج رمز PAT بصلاحية <code dir="ltr">read:project</code>. لوحة «لوحة المشروع» تعمل بدونه.') + btn('فتح لوحة المشروع', "app.ghxLoad('planning','board')", { icon: 'fa-table-columns' });
        const { owner, repo } = this.ghRepo();
        const q = `query($o:String!,$r:String!){repository(owner:$o,name:$r){projectsV2(first:20){nodes{number title url shortDescription closed updatedAt items{totalCount}}}}}`;
        const d = await this.ghGraphQL(q, { o: owner, r: repo });
        const nodes = (d && d.repository && d.repository.projectsV2 && d.repository.projectsV2.nodes) || [];
        return nodes.length ? `<div class="gh-list">${nodes.map(p => `<div class="gh-item static"><i class="fa-solid fa-diagram-next text-blue"></i><div class="gh-item-main"><div class="gh-item-title">${esc(p.title)} ${p.closed ? '<span class="gh-badge dim">مغلق</span>' : ''}</div>
            <div class="gh-item-meta">${esc(p.shortDescription || '')} • ${+(p.items && p.items.totalCount)} عنصر • ${this.ghTimeAgo(p.updatedAt)}</div></div>
            <div class="gh-item-actions"><a class="sidebar-btn-util gh-btn" href="${esc(p.url)}" target="_blank" rel="noopener"><i class="fa-solid fa-up-right-from-square"></i></a></div></div>`).join('')}</div>`
            : empty('لا توجد Projects مرتبطة بهذا المستودع.') + `<div style="text-align:center">${btn('استخدم لوحة المشروع المدمجة', "app.ghxLoad('planning','board')", { icon: 'fa-table-columns', primary: true })}</div>`;
    };
}
