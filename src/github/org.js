/* Organizations (#481), teams (#482), members (#483), roles (#484), billing (#485), audit log (#486). */
import { esc, call, fmtNum, toCSV } from './shared.js';
import { card, btn, empty, note, input, select, val, avatar } from './core.js';

export const REPO_ROLES = [['pull', 'قراءة'], ['triage', 'فرز'], ['push', 'كتابة'], ['maintain', 'صيانة'], ['admin', 'مدير']];
export const roleOfPermissions = (p = {}) => (p.admin ? 'admin' : p.maintain ? 'maintain' : p.push ? 'push' : p.triage ? 'triage' : 'pull');

/** Human description of a repo event (pure; tested). */
export function describeEvent(e) {
    const p = e.payload || {};
    const ref = String(p.ref || '').replace(/^refs\/(heads|tags)\//, '');
    switch (e.type) {
        case 'PushEvent': return `دفع ${p.size != null ? p.size : (p.commits || []).length} commit إلى ${ref}`;
        case 'PullRequestEvent': return `${{ opened: 'فتح', closed: p.pull_request && p.pull_request.merged ? 'دمج' : 'أغلق', reopened: 'أعاد فتح' }[p.action] || p.action} PR #${p.number || (p.pull_request && p.pull_request.number)}`;
        case 'IssuesEvent': return `${{ opened: 'فتح', closed: 'أغلق', reopened: 'أعاد فتح' }[p.action] || p.action} Issue #${p.issue && p.issue.number}`;
        case 'IssueCommentEvent': return `علّق على #${p.issue && p.issue.number}`;
        case 'PullRequestReviewEvent': return `راجع PR #${p.pull_request && p.pull_request.number}`;
        case 'CreateEvent': return `أنشأ ${p.ref_type === 'tag' ? 'وسم' : p.ref_type === 'branch' ? 'فرع' : 'مستودع'} ${p.ref || ''}`.trim();
        case 'DeleteEvent': return `حذف ${p.ref_type === 'tag' ? 'وسم' : 'فرع'} ${p.ref || ''}`;
        case 'ReleaseEvent': return `نشر الإصدار ${p.release && p.release.tag_name}`;
        case 'WatchEvent': return 'أضاف نجمة';
        case 'ForkEvent': return 'أنشأ Fork';
        case 'MemberEvent': return `${p.action === 'added' ? 'أضاف' : p.action} متعاوناً ${p.member && p.member.login}`;
        case 'PublicEvent': return 'جعل المستودع عاماً';
        case 'GollumEvent': return 'عدّل الويكي';
        default: return e.type.replace(/Event$/, '');
    }
}

export function installOrg(P) {
    // ------------------------------------------------------------------ ORGANIZATIONS (#481)
    P.ghxOrgs = async function () {
        this.ghxNeedToken('إدارة المؤسسات');
        const orgs = await this.gh('/user/orgs?per_page=100');
        const memberships = await this.gh('/user/memberships/orgs?per_page=100').catch(() => []);
        const roleOf = new Map(memberships.map(m => [m.organization && m.organization.login, m.role]));
        return (orgs.length ? `<div class="gh-list">${orgs.map(o => `<div class="gh-item" data-org="${esc(o.login)}" onclick="${call(this, 'ghxOpenOrg', o.login)}">${avatar(o, 28)}
                <div class="gh-item-main"><div class="gh-item-title" dir="ltr">${esc(o.login)}</div><div class="gh-item-meta">${esc(o.description || '')}</div></div>
                <span class="gh-badge ${roleOf.get(o.login) === 'admin' ? 'purple' : 'dim'}">${roleOf.get(o.login) === 'admin' ? 'مالك' : roleOf.get(o.login) ? 'عضو' : '—'}</span></div>`).join('')}</div>`
            : empty('لست عضواً في أي مؤسسة (أو يحتاج الرمز صلاحية <code dir="ltr">read:org</code>).'))
            + note(`${'<a class="text-emerald" href="https://github.com/account/organizations/new" target="_blank" rel="noopener">إنشاء مؤسسة جديدة ↗</a>'} — إنشاء المؤسسات متاح من موقع GitHub فقط.`);
    };
    P.ghxOpenOrg = function (org, sec) {
        const cur = sec || (this.ghView && this.ghView.fn === 'ghxOpenOrg' && this.ghView.args[0] === org && this.ghView.args[1]) || 'members';
        return this.ghxView('ghxOpenOrg', [org, cur], async () => {
            const o = await this.gh(`/orgs/${encodeURIComponent(org)}`);
            const me = await this.gh(`/user/memberships/orgs/${encodeURIComponent(org)}`).catch(() => null);
            const isAdmin = !!(me && me.role === 'admin');
            const nav = `<div class="ghx-subnav">${[['members', 'الأعضاء والأدوار', 'fa-users'], ['teams', 'الفرق', 'fa-people-group'], ['repos', 'المستودعات', 'fa-book'], ['billing', 'الفوترة', 'fa-credit-card'], ['audit', 'سجل التدقيق', 'fa-list-check']].map(([k, l, i]) => `<button class="gh-chip ${k === cur ? 'active' : ''}" data-org-sec="${k}" onclick="${call(this, 'ghxOpenOrg', org, k)}"><i class="fa-solid ${i}"></i> ${l}</button>`).join('')}</div>`;
            let body;
            try { body = await this['ghxOrg_' + cur](org, isAdmin, o); } catch (e) { body = this.ghxErrorHTML(e); }
            return `<div class="gh-detail-head">${avatar(o, 36)}<h3 dir="ltr">${esc(o.name || o.login)}</h3><span class="gh-badge ${isAdmin ? 'purple' : 'dim'}">${isAdmin ? 'مالك' : 'عضو'}</span><span class="gh-spacer"></span><a class="sidebar-btn-util gh-btn" href="${esc(o.html_url)}" target="_blank" rel="noopener"><i class="fa-brands fa-github"></i></a></div>
                <div class="gh-stats"><div class="gh-stat"><b>${fmtNum(o.public_repos + (o.total_private_repos || 0))}</b><span>مستودع</span></div><div class="gh-stat"><b>${fmtNum(o.followers)}</b><span>متابع</span></div>${o.plan ? `<div class="gh-stat"><b>${esc(o.plan.name)}</b><span>الخطة</span></div><div class="gh-stat"><b>${fmtNum(o.plan.filled_seats || 0)}/${fmtNum(o.plan.seats || 0)}</b><span>المقاعد</span></div>` : ''}</div>${nav}${body}`;
        });
    };

    // ---- Members & roles (#483 #484)
    P.ghxOrg_members = async function (org, isAdmin) {
        const enc = encodeURIComponent(org);
        const [members, admins, invites] = await Promise.all([this.gh(`/orgs/${enc}/members?per_page=100`), this.gh(`/orgs/${enc}/members?role=admin&per_page=100`).catch(() => []), isAdmin ? this.gh(`/orgs/${enc}/invitations?per_page=50`).catch(() => []) : []]);
        const adminSet = new Set(admins.map(a => a.login));
        return (isAdmin ? `<div class="gh-toolbar">${input('ghx-org-invite', { placeholder: 'اسم المستخدم أو البريد', style: 'max-width:220px' })}${select('ghx-org-invite-role', [['direct_member', 'عضو'], ['admin', 'مالك']], 'direct_member')}${btn('دعوة', call(this, 'ghxOrgInvite', org), { icon: 'fa-user-plus', primary: true })}</div>` : '')
            + `<div class="gh-list">${members.map(m => `<div class="gh-item static" data-member="${esc(m.login)}">${avatar(m, 24)}<div class="gh-item-main"><div class="gh-item-title" dir="ltr">${esc(m.login)}</div></div>
                ${isAdmin ? `<select class="form-input-box" style="max-width:120px" onchange="${call(this, 'ghxOrgSetRole', org, m.login)}" data-role-of="${esc(m.login)}">${[['member', 'عضو'], ['admin', 'مالك']].map(([v, l]) => `<option value="${v}" ${(adminSet.has(m.login) ? 'admin' : 'member') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${btn('', call(this, 'ghxOrgRemoveMember', org, m.login), { icon: 'fa-user-minus', danger: true, title: 'إزالة' })}` : `<span class="gh-badge ${adminSet.has(m.login) ? 'purple' : 'dim'}">${adminSet.has(m.login) ? 'مالك' : 'عضو'}</span>`}</div>`).join('') || '<div class="text-dim">لا أعضاء ظاهرون.</div>'}</div>`
            + (invites.length ? card(`دعوات معلقة (${invites.length})`, invites.map(i => `<div class="gh-check-row"><b dir="ltr">${esc(i.login || i.email)}</b> <span class="gh-badge dim">${esc(i.role)}</span> <span class="text-dim">${this.ghTimeAgo(i.created_at)}</span>${btn('', call(this, 'ghxOrgCancelInvite', org, i.id), { icon: 'fa-xmark', danger: true, title: 'إلغاء' })}</div>`).join(''), { icon: 'fa-envelope' }) : '');
    };
    P.ghxOrgInvite = async function (org, who, role) {
        const target = who || val('ghx-org-invite');
        const r = role || val('ghx-org-invite-role') || 'direct_member';
        if (!target) return null;
        try {
            const body = { role: r };
            if (target.includes('@')) body.email = target; else body.invitee_id = (await this.gh(`/users/${encodeURIComponent(target)}`)).id;
            const inv = await this.gh(`/orgs/${encodeURIComponent(org)}/invitations`, { method: 'POST', body });
            this.showToast(`✅ أُرسلت الدعوة إلى ${target}`, 'success');
            this.refreshGitHubHub();
            return inv;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };
    P.ghxOrgSetRole = async function (org, login, roleArg) {
        const sel = document.querySelector(`[data-role-of="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(login) : login}"]`);
        const role = roleArg || (sel && sel.value) || 'member';
        if (role === 'admin' && !(await this.ghxConfirm('ترقية لمالك', `منح <b dir="ltr">${esc(login)}</b> صلاحية المالك الكاملة على المؤسسة؟`, { danger: true }))) { this.refreshGitHubHub(); return null; }
        try { const m = await this.gh(`/orgs/${encodeURIComponent(org)}/memberships/${encodeURIComponent(login)}`, { method: 'PUT', body: { role } }); this.showToast(`✅ ${login}: ${role === 'admin' ? 'مالك' : 'عضو'}`, 'success'); return m; } catch (e) { this.showToast('❌ ' + e.message, 'error'); this.refreshGitHubHub(); return null; }
    };
    P.ghxOrgRemoveMember = async function (org, login) {
        if (!(await this.ghxConfirm('إزالة عضو', `إزالة <b dir="ltr">${esc(login)}</b> من ${esc(org)}؟ سيفقد الوصول للمستودعات الخاصة.`, { danger: true }))) return false;
        try { await this.gh(`/orgs/${encodeURIComponent(org)}/members/${encodeURIComponent(login)}`, { method: 'DELETE' }); this.showToast('أُزيل العضو', 'success'); this.refreshGitHubHub(); return true; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };
    P.ghxOrgCancelInvite = async function (org, id) {
        try { await this.gh(`/orgs/${encodeURIComponent(org)}/invitations/${id}`, { method: 'DELETE' }); this.showToast('أُلغيت الدعوة', 'success'); this.refreshGitHubHub(); return true; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };

    // ---- Teams (#482)
    P.ghxOrg_teams = async function (org, isAdmin) {
        const teams = await this.gh(`/orgs/${encodeURIComponent(org)}/teams?per_page=100`);
        return (isAdmin ? `<div class="gh-toolbar">${btn('فريق جديد', call(this, 'ghxCreateTeam', org), { icon: 'fa-plus', primary: true })}</div>` : '')
            + (teams.length ? `<div class="gh-list">${teams.map(t => `<div class="gh-item" data-team="${esc(t.slug)}" onclick="${call(this, 'ghxOpenTeam', org, t.slug)}"><i class="fa-solid fa-people-group text-blue"></i><div class="gh-item-main"><div class="gh-item-title">${esc(t.name)}</div><div class="gh-item-meta">${esc(t.description || '')} • ${t.privacy === 'secret' ? 'سري' : 'ظاهر'}${t.parent ? ` • ضمن ${esc(t.parent.name)}` : ''}</div></div><span class="gh-badge dim">${esc(t.permission || '')}</span></div>`).join('')}</div>` : empty('لا توجد فرق.'));
    };
    P.ghxOpenTeam = function (org, slug) {
        return this.ghxView('ghxOpenTeam', [org, slug], async () => {
            const base = `/orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(slug)}`;
            const [t, members, repos] = await Promise.all([this.gh(base), this.gh(`${base}/members?per_page=100`), this.gh(`${base}/repos?per_page=100`).catch(() => [])]);
            return `<div class="gh-detail-head"><h3>${esc(t.name)}</h3><span class="gh-badge dim">${t.members_count} عضو • ${t.repos_count} مستودع</span></div><div class="text-dim">${esc(t.description || '')}</div>
                <div class="gh-toolbar">${input('ghx-team-add', { placeholder: 'اسم مستخدم', style: 'max-width:200px' })}${btn('إضافة للفريق', call(this, 'ghxTeamAddMember', org, slug), { icon: 'fa-user-plus' })}</div>
                ${card('الأعضاء', members.map(m => `<div class="gh-check-row" data-team-member="${esc(m.login)}">${avatar(m, 20)} <b dir="ltr">${esc(m.login)}</b>${btn('', call(this, 'ghxTeamRemoveMember', org, slug, m.login), { icon: 'fa-user-minus', danger: true, title: 'إزالة' })}</div>`).join('') || '<div class="text-dim">—</div>', { icon: 'fa-users' })}
                ${card('المستودعات', repos.map(r => `<div class="gh-check-row"><span dir="ltr">${esc(r.full_name)}</span> <span class="gh-badge dim">${esc(roleOfPermissions(r.permissions))}</span></div>`).join('') || '<div class="text-dim">—</div>', { icon: 'fa-book' })}`;
        });
    };
    P.ghxCreateTeam = async function (org, o) {
        if (!o) {
            const r = await this.showDialog({ title: 'فريق جديد', fields: [{ id: 'name', label: 'الاسم', dir: 'auto' }, { id: 'description', label: 'الوصف', dir: 'auto' }, { id: 'privacy', type: 'select', label: 'الظهور', value: 'closed', options: [{ value: 'closed', label: 'ظاهر لأعضاء المؤسسة' }, { value: 'secret', label: 'سري' }] }], buttons: [{ label: 'إنشاء', value: 'ok', primary: true, validate: (v) => (v.name.trim() ? null : 'أدخل اسماً') }, { label: 'إلغاء', value: null }] });
            if (!r) return null;
            o = r.values;
        }
        try { const t = await this.gh(`/orgs/${encodeURIComponent(org)}/teams`, { method: 'POST', body: { name: o.name.trim(), description: o.description || '', privacy: o.privacy || 'closed' } }); this.showToast(`✅ أنشئ الفريق ${t.name}`, 'success'); this.refreshGitHubHub(); return t; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };
    P.ghxTeamAddMember = async function (org, slug, loginArg) {
        const login = loginArg || val('ghx-team-add');
        if (!login) return null;
        try { const r = await this.gh(`/orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(slug)}/memberships/${encodeURIComponent(login)}`, { method: 'PUT', body: { role: 'member' } }); this.showToast(r && r.state === 'pending' ? `📨 دُعي ${login}` : `✅ أضيف ${login}`, 'success'); this.refreshGitHubHub(); return r; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };
    P.ghxTeamRemoveMember = async function (org, slug, login) {
        try { await this.gh(`/orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(slug)}/memberships/${encodeURIComponent(login)}`, { method: 'DELETE' }); this.showToast('أُزيل من الفريق', 'success'); this.refreshGitHubHub(); return true; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };

    P.ghxOrg_repos = async function (org) {
        const repos = await this.gh(`/orgs/${encodeURIComponent(org)}/repos?per_page=100&sort=pushed`);
        return repos.length ? `<div class="gh-list">${repos.map(r => `<div class="gh-item" onclick="${call(this, 'ghxUseRepo', r.owner.login, r.name, r.default_branch)}"><i class="fa-solid ${r.private ? 'fa-lock text-warning' : 'fa-book text-emerald'}"></i><div class="gh-item-main"><div class="gh-item-title" dir="ltr">${esc(r.name)}</div><div class="gh-item-meta">${esc(r.description || '')} • ⭐ ${fmtNum(r.stargazers_count)} • ${this.ghTimeAgo(r.pushed_at)}</div></div><span class="gh-badge dim">${esc(roleOfPermissions(r.permissions))}</span></div>`).join('')}</div>` : empty('لا مستودعات.');
    };

    // ---- Billing (#485)
    P.ghxOrg_billing = async function (org, isAdmin, o) {
        if (!isAdmin) return note('الفوترة متاحة لمالكي المؤسسة فقط.');
        const enc = encodeURIComponent(org);
        const usage = await this.gh(`/organizations/${enc}/settings/billing/usage`).catch(() => null);
        const items = (usage && usage.usageItems) || [];
        const byProduct = {};
        items.forEach(i => { const k = i.product || 'other'; byProduct[k] = byProduct[k] || { qty: 0, net: 0, unit: i.unitType }; byProduct[k].qty += +i.quantity || 0; byProduct[k].net += +i.netAmount || 0; });
        const actions = !usage ? await this.gh(`/orgs/${enc}/settings/billing/actions`).catch(() => null) : null;
        return card('الخطة', o.plan ? `<div class="gh-stats"><div class="gh-stat"><b>${esc(o.plan.name)}</b><span>الخطة</span></div><div class="gh-stat"><b>${fmtNum(o.plan.filled_seats || 0)}/${fmtNum(o.plan.seats || 0)}</b><span>المقاعد</span></div><div class="gh-stat"><b>${fmtNum(o.plan.private_repos || 0)}</b><span>مستودعات خاصة</span></div></div>` : '<div class="text-dim">غير متاح</div>', { icon: 'fa-credit-card' })
            + (items.length ? card('الاستهلاك (الشهر الحالي)', `<table class="ghx-table"><thead><tr><th>المنتج</th><th>الكمية</th><th>التكلفة الصافية</th></tr></thead><tbody>${Object.entries(byProduct).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${fmtNum(Math.round(v.qty))} ${esc(v.unit || '')}</td><td>$${v.net.toFixed(2)}</td></tr>`).join('')}</tbody></table>`, { icon: 'fa-chart-pie' })
                : actions ? card('دقائق Actions', `<div class="ghx-progress"><div style="width:${Math.min(100, Math.round((actions.total_minutes_used / Math.max(1, actions.included_minutes)) * 100))}%"></div></div><div class="text-dim">${fmtNum(actions.total_minutes_used)} / ${fmtNum(actions.included_minutes)} دقيقة • مدفوعة: ${fmtNum(actions.total_paid_minutes_used)}</div>`, { icon: 'fa-gauge-high' })
                : note('تعذر قراءة بيانات الفوترة — يحتاج الرمز صلاحية <code dir="ltr">admin:org</code> أو «Administration: read» للفوترة.'))
            + `<div class="gh-toolbar"><a class="sidebar-btn-util gh-btn" href="https://github.com/organizations/${enc}/settings/billing" target="_blank" rel="noopener"><i class="fa-solid fa-up-right-from-square"></i> إدارة الفوترة على GitHub</a></div>`;
    };

    // ---- Audit log (#486)
    P.ghxOrg_audit = async function (org, isAdmin) {
        const enc = encodeURIComponent(org);
        const audit = isAdmin ? await this.gh(`/orgs/${enc}/audit-log?per_page=50`).catch(() => null) : null;
        if (audit && Array.isArray(audit)) return `<table class="ghx-table"><thead><tr><th>الإجراء</th><th>المنفّذ</th><th>الهدف</th><th>الوقت</th></tr></thead><tbody>${audit.map(a => `<tr><td dir="ltr">${esc(a.action)}</td><td dir="ltr">${esc(a.actor || '')}</td><td dir="ltr">${esc(a.repo || a.user || a.team || '')}</td><td>${this.ghTimeAgo(new Date(a['@timestamp'] || a.created_at).toISOString())}</td></tr>`).join('')}</tbody></table>`;
        const events = await this.gh(`/orgs/${enc}/events?per_page=50`).catch(() => []);
        return note('سجل التدقيق الكامل متاح في GitHub Enterprise فقط — يُعرض هنا سجل النشاط العام للمؤسسة.') + this.ghxEventsHTML(events, true);
    };

    P.ghxEventsHTML = function (events, withRepo) {
        if (!events.length) return empty('لا يوجد نشاط حديث.');
        return `<div class="ghx-timeline">${events.map(e => `<div class="ghx-tl-item" data-event="${esc(e.type)}"><span class="ghx-tl-dot"></span>${avatar(e.actor, 18)}<b dir="ltr">${esc(e.actor && (e.actor.display_login || e.actor.login))}</b> ${esc(describeEvent(e))}${withRepo && e.repo ? ` <span class="text-dim" dir="ltr">${esc(e.repo.name)}</span>` : ''} <span class="text-dim">${this.ghTimeAgo(e.created_at)}</span></div>`).join('')}</div>`;
    };

    // ------------------------------------------------------------------ COLLABORATORS & ROLES (repo)
    P.ghxCollaborators = async function () {
        this.ghxNeedToken('إدارة المتعاونين');
        const rp = this.ghRepoPath();
        const [collabs, invites] = await Promise.all([this.gh(`${rp}/collaborators?per_page=100`), this.gh(`${rp}/invitations?per_page=50`).catch(() => [])]);
        const roleSelect = (login, cur) => `<select class="form-input-box" style="max-width:110px" data-collab-role="${esc(login)}" onchange="app.ghxSetCollaboratorRole(this.dataset.collabRole, this.value)">${REPO_ROLES.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
        return `<div class="gh-toolbar">${input('ghx-collab-user', { placeholder: 'اسم المستخدم', style: 'max-width:200px' })}${select('ghx-collab-role', REPO_ROLES, 'push')}${btn('إضافة متعاون', 'app.ghxAddCollaborator()', { icon: 'fa-user-plus', primary: true })}</div>
            <div class="gh-list">${collabs.map(c => { const role = c.role_name || roleOfPermissions(c.permissions); return `<div class="gh-item static" data-collab="${esc(c.login)}">${avatar(c, 24)}<div class="gh-item-main"><div class="gh-item-title" dir="ltr">${esc(c.login)}</div></div>${roleSelect(c.login, role === 'write' ? 'push' : role === 'read' ? 'pull' : role)}${btn('', call(this, 'ghxRemoveCollaborator', c.login), { icon: 'fa-user-minus', danger: true, title: 'إزالة' })}</div>`; }).join('')}</div>
            ${invites.length ? card(`دعوات معلقة (${invites.length})`, invites.map(i => `<div class="gh-check-row">${avatar(i.invitee, 18)} <b dir="ltr">${esc(i.invitee && i.invitee.login)}</b> <span class="gh-badge dim">${esc(i.permissions)}</span> <span class="text-dim">${this.ghTimeAgo(i.created_at)}</span>${btn('', call(this, 'ghxCancelRepoInvite', i.id), { icon: 'fa-xmark', danger: true, title: 'إلغاء' })}</div>`).join(''), { icon: 'fa-envelope' }) : ''}
            ${card('الأدوار', `<table class="ghx-table"><tbody>${[['قراءة', 'عرض واستنساخ وفتح Issues'], ['فرز', 'إدارة Issues وPRs بلا كتابة كود'], ['كتابة', 'دفع الكود ودمج PRs'], ['صيانة', 'إدارة المستودع بلا صلاحيات حساسة'], ['مدير', 'تحكم كامل يشمل الإعدادات والحذف']].map(r => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td></tr>`).join('')}</tbody></table>`, { icon: 'fa-user-shield' })}`;
    };
    P.ghxAddCollaborator = async function (loginArg, roleArg) {
        const login = loginArg || val('ghx-collab-user');
        const permission = roleArg || val('ghx-collab-role') || 'push';
        if (!login) return null;
        try {
            const r = await this.gh(`${this.ghRepoPath()}/collaborators/${encodeURIComponent(login)}`, { method: 'PUT', body: { permission } });
            this.showToast(r ? `📨 أُرسلت دعوة إلى ${login}` : `✅ حُدّثت صلاحية ${login}`, 'success');
            this.ghxReload();
            return r || true;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };
    P.ghxSetCollaboratorRole = function (login, role) { return this.ghxAddCollaborator(login, role); };
    P.ghxRemoveCollaborator = async function (login) {
        if (!(await this.ghxConfirm('إزالة متعاون', `إزالة <b dir="ltr">${esc(login)}</b> من المستودع؟`, { danger: true }))) return false;
        try { await this.gh(`${this.ghRepoPath()}/collaborators/${encodeURIComponent(login)}`, { method: 'DELETE' }); this.showToast('أُزيل المتعاون', 'success'); this.ghxReload(); return true; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };
    P.ghxCancelRepoInvite = async function (id) {
        try { await this.gh(`${this.ghRepoPath()}/invitations/${id}`, { method: 'DELETE' }); this.showToast('أُلغيت الدعوة', 'success'); this.ghxReload(); return true; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };

    // ------------------------------------------------------------------ ACTIVITY LOG (repo)
    P.ghxAuditLog = async function () {
        const events = await this.gh(`${this.ghRepoPath()}/events?per_page=100`);
        const f = this._ghxEventFilter || '';
        const types = Array.from(new Set(events.map(e => e.type)));
        const shown = f ? events.filter(e => e.type === f) : events;
        return `<div class="gh-toolbar">${select('ghx-event-filter', [['', 'كل الأنواع'], ...types.map(t => [t, t.replace(/Event$/, '')])], f).replace('<select ', `<select onchange="app._ghxEventFilter=this.value; app.ghxReload()" `)}<span class="gh-spacer"></span>${btn('تصدير CSV', 'app.ghxExportEvents()', { icon: 'fa-file-csv' })}</div>`
            + note('سجل نشاط المستودع (آخر 90 يوماً، حتى 300 حدث) — لسجل تدقيق المؤسسة افتح تبويب «المؤسسات».') + this.ghxEventsHTML(shown, false);
    };
    P.ghxExportEvents = async function () {
        const events = await this.gh(`${this.ghRepoPath()}/events?per_page=100`);
        const rows = [['time', 'actor', 'type', 'description'], ...events.map(e => [e.created_at, e.actor && e.actor.login, e.type, describeEvent(e)])];
        this.ghxDownload(toCSV(rows), `${this.ghRepo().repo}-activity.csv`, 'text/csv');
        return rows.length - 1;
    };
}
