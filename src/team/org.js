/* Team organisation: create (#771), invite (#772, link #741), manage members (#773), roles Owner/Editor/Viewer (#742, #774),
   per-file permissions + CODEOWNERS (#743), delete team (#778), transfer ownership (#779), team settings (#780). */
import { esc, call, callRaw, btn, pbtn, card, empty, field, area, select, val, stats, table, lsGet, lsSet, uid, bytesToB64url, b64ToBytes, utf8, fromUtf8, ago, DAY } from './util.js';
import { ROLES, ROLE_CAPS, roleFromGH, defaultTeam, accessFor, codeOwners, TEAM_FILE } from './core.js';

const roleOpts = Object.entries(ROLES).map(([k, r]) => [k, r.icon + ' ' + r.label]);
export const encodeInvite = (o) => bytesToB64url(utf8(JSON.stringify(o)));
export function decodeInvite(code) { try { const o = JSON.parse(fromUtf8(b64ToBytes(String(code).replace(/^#?oxteam=/, '')))); return o && o.repo ? o : null; } catch (e) { return null; } }
const JOIN_LABEL = 'ox-join';

export function installOrg(P) {
    // ------------------------------------------------------------------ OVERVIEW / CREATE (#771)
    P.tmOverview = async function () {
        const t = this.tmTeam(), me = await this.tmMe(), repo = this.tmRepoKey();
        if (!t) {
            return card('إنشاء فريق', `<p class="tmx-note">الفريق مرتبط بالمستودع <b dir="ltr">${esc(repo)}</b>: يُحفظ في <code>${TEAM_FILE}</code> داخل المستودع ليراه كل الأعضاء، والدعوات تتم عبر GitHub Collaborators.</p>
                <div class="gh-row">${field('tm-new-name', 'اسم الفريق', repo.split('/')[1] + ' team')}${field('tm-new-desc', 'الوصف', '')}</div>
                <div class="gh-row">${pbtn('fa-people-group', 'إنشاء الفريق', call('tmCreateTeam'))}${this.tmHasGH() ? btn('fa-cloud-arrow-down', 'تحميل فريق موجود من المستودع', call('tmPullAndRefresh')) : ''}</div>
                ${this.tmHasGH() ? '' : '<div class="tmx-note">💡 بدون رمز GitHub يعمل الفريق محلياً فقط (قنوات وجلسات حية عبر الروابط).</div>'}`, 'fa-people-group');
        }
        const role = this.tmRole(me), members = t.members || [];
        const counts = Object.keys(ROLES).map(r => [ROLES[r].icon + ' ' + ROLES[r].label, members.filter(m => m.role === r).length]);
        return card(esc(t.name), `${t.description ? `<p>${esc(t.description)}</p>` : ''}
            ${stats([['الأعضاء', members.length], ...counts, ['قواعد صلاحيات', (t.rules || []).length], ['دورك', ROLES[role] ? ROLES[role].icon + ' ' + role : role]])}
            <div class="tmx-note">المستودع <b dir="ltr">${esc(repo)}</b> • المالك <b>@${esc(t.owner)}</b> • آخر تحديث ${ago(t.updated)}${t._pushed ? ' • ✅ متزامن مع GitHub' : ''}</div>
            <div class="gh-row">${btn('fa-user-plus', 'دعوة عضو', call('tmLoad', 'team', 'members'))}${btn('fa-link', 'رابط دعوة', call('tmLoad', 'team', 'invite'))}${btn('fa-hashtag', 'القنوات', call('openTeamHub', 'chat'))}${btn('fa-tower-broadcast', 'جلسة حية', call('openTeamHub', 'live'))}${this.tmHasGH() ? btn('fa-rotate', 'مزامنة من GitHub', call('tmPullAndRefresh')) : ''}</div>`, 'fa-people-group')
            + card('الإشعارات', `<div class="gh-row">${this._tmWatch ? btn('fa-bell-slash', 'إيقاف المراقبة', call('tmWatchOff')) : pbtn('fa-bell', 'مراقبة التعليقات وتعديلات ملفاتي', call('tmWatchOn'))}${btn('fa-inbox', 'صندوق الإشعارات', call('tmLoad', 'chat', 'inbox'))}</div>`, 'fa-bell');
    };
    P.tmPullAndRefresh = async function () { try { const t = await this.tmPullTeam(); this.showToast(t ? '✅ تم تحميل إعدادات الفريق' : 'لا يوجد فريق في هذا المستودع بعد', t ? 'success' : 'info'); } catch (e) { this.tmErr(e); } return this.tmRefresh(); };
    P.tmCreateTeam = async function (opts = {}) {
        const me = await this.tmMe();
        const t = defaultTeam(opts.name || val('tm-new-name') || 'فريقي', me, this.tmRepoKey());
        t.description = opts.description != null ? opts.description : val('tm-new-desc');
        await this.tmSaveTeam(t, `chore(team): create team "${t.name}"`);
        if (this.addXP) this.addXP(20, 'team');
        this.showToast(`👥 أُنشئ الفريق «${this.escapeHTML(t.name)}»`, 'success');
        if (document.getElementById('tmx-root')) this.tmRefresh();
        return t;
    };

    // ------------------------------------------------------------------ MEMBERS (#772, #773, #742, #774)
    P.tmMembers = async function () {
        const t = this.tmTeam();
        if (!t) return empty('أنشئ فريقاً أولاً من «نظرة عامة»');
        let gh = null, invites = [], joins = [];
        if (this.tmHasGH()) {
            [gh, invites, joins] = await Promise.all([
                this.tmGH('/collaborators?per_page=100').catch(() => null),
                this.tmGH('/invitations?per_page=100').catch(() => []),
                this.tmGH(`/issues?labels=${JOIN_LABEL}&state=open&per_page=50`).catch(() => [])
            ]);
        }
        const merged = new Map((t.members || []).map(m => [m.login, { ...m }]));
        (gh || []).forEach(c => { const m = merged.get(c.login) || { login: c.login, role: roleFromGH(c.permissions), added: null, fromGH: true }; m.avatar = c.avatar_url; m.ghRole = c.role_name || roleFromGH(c.permissions); merged.set(c.login, m); });
        const owner = this.tmRole() === 'owner';
        const rows = [...merged.values()].map(m => [
            `${m.avatar ? `<img class="tmx-av" src="${esc(m.avatar)}" alt="">` : '👤'} <b>@${esc(m.login)}</b>${m.fromGH && !(t.members || []).some(x => x.login === m.login) ? ' <span class="fmx-tag">GitHub فقط</span>' : ''}`,
            owner ? `<select class="form-input-box" onchange="${callRaw('tmSetRole', [m.login], 'this.value')}">${roleOpts.map(([v, l]) => `<option value="${v}" ${v === m.role ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>` : esc((ROLES[m.role] || {}).label || m.role),
            esc(m.ghRole || '—'), esc((m.skills || []).join('، ') || '—'),
            owner && m.login !== t.owner ? btn('fa-user-minus', '', call('tmRemoveMember', m.login), 'sidebar-btn-util gh-btn', 'title="إزالة"') : ''
        ]);
        return card('أعضاء الفريق', table(['العضو', 'الدور', 'صلاحية GitHub', 'المهارات', ''], rows), 'fa-users')
            + (owner ? card('دعوة عضو', `<div class="gh-row">${field('tm-inv-login', 'اسم المستخدم على GitHub', '', 'dir="ltr" placeholder="octocat"')}${select('tm-inv-role', 'الدور', roleOpts, t.settings.defaultRole || 'editor')}${field('tm-inv-skills', 'المهارات (اختياري)', '', 'placeholder="react, css"')}${pbtn('fa-paper-plane', 'دعوة', call('tmInviteMember'))}</div>
                <div class="tmx-note">${this.tmHasGH() ? 'تُرسل دعوة GitHub حقيقية (Collaborator) بالصلاحية المقابلة للدور: Owner→admin، Editor→push، Viewer→pull.' : 'بدون رمز GitHub تُضاف الدعوة محلياً فقط.'}</div>`, 'fa-user-plus') : '')
            + (invites.length ? card('دعوات معلّقة', invites.map(i => `<div class="gh-item"><span>📨 @${esc(i.invitee && i.invitee.login)} — ${esc(i.permissions)} • ${ago(i.created_at)}</span>${owner ? btn('fa-xmark', 'إلغاء', call('tmCancelInvite', i.id)) : ''}</div>`).join(''), 'fa-envelope') : '')
            + (joins.length ? card('طلبات انضمام عبر الرابط', joins.map(j => { const d = (/<!--oxjoin ([\s\S]*?)-->/.exec(j.body || '') || [])[1]; let req = {}; try { req = JSON.parse(d || '{}'); } catch (e) {} return `<div class="gh-item"><span>🙋 @${esc(j.user && j.user.login)} يطلب دور ${esc((ROLES[req.role] || {}).label || req.role || 'editor')} • ${ago(j.created_at)}</span>${owner ? `${pbtn('fa-check', 'قبول', call('tmAcceptJoin', j.number, j.user && j.user.login, req.role || 'editor'))}${btn('fa-xmark', 'رفض', call('tmRejectJoin', j.number))}` : ''}</div>`; }).join(''), 'fa-hand') : '')
            + card('تقسيم الصلاحيات حسب الدور', table(['القدرة', ...Object.values(ROLES).map(r => r.icon + ' ' + r.label)], ROLE_CAPS.map(([cap, roles]) => [esc(cap), ...Object.keys(ROLES).map(r => roles.includes(r) ? '✅' : '—')])), 'fa-shield-halved');
    };
    P.tmInviteMember = async function (login = val('tm-inv-login'), role = val('tm-inv-role') || 'editor', skills = val('tm-inv-skills')) {
        login = String(login || '').trim().replace(/^@/, '');
        if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) { this.showToast('اسم مستخدم GitHub غير صالح', 'warning'); return null; }
        const t = this.tmRequireTeam(); if (!t) return null;
        if (this.tmHasGH()) {
            try { await this.tmGH(`/collaborators/${encodeURIComponent(login)}`, { method: 'PUT', body: { permission: ROLES[role].gh } }); }
            catch (e) { return this.tmErr(e); }
        }
        t.members = (t.members || []).filter(m => m.login !== login).concat({ login, role, added: Date.now(), skills: String(skills || '').split(/[,،]/).map(s => s.trim()).filter(Boolean), invited: true });
        await this.tmSaveTeam(t, `chore(team): invite @${login} as ${role}`);
        this.showToast(`📨 دُعي @${this.escapeHTML(login)} كـ ${ROLES[role].label}`, 'success');
        if (document.getElementById('tmx-sec')) this.tmRefresh();
        return t.members.find(m => m.login === login);
    };
    P.tmSetRole = async function (login, role) {
        const t = this.tmRequireTeam(); if (!t || !ROLES[role]) return null;
        if (login === t.owner && role !== 'owner') { this.showToast('لا يمكن تخفيض المالك — استخدم «نقل الملكية»', 'warning'); return null; }
        const m = (t.members || []).find(x => x.login === login) || (t.members.push({ login, role, added: Date.now(), skills: [] }), t.members[t.members.length - 1]);
        m.role = role;
        if (this.tmHasGH()) await this.tmGH(`/collaborators/${encodeURIComponent(login)}`, { method: 'PUT', body: { permission: ROLES[role].gh } }).catch(e => this.tmErr(e));
        await this.tmSaveTeam(t, `chore(team): @${login} → ${role}`);
        this.showToast(`🔁 @${this.escapeHTML(login)} أصبح ${ROLES[role].label}`, 'success');
        return m;
    };
    P.tmRemoveMember = async function (login) {
        const t = this.tmRequireTeam(); if (!t || login === t.owner) return false;
        if (!(await this.askConfirm(`إزالة @${login} من الفريق${this.tmHasGH() ? ' وسحب صلاحيته على المستودع' : ''}؟`, ''))) return false;
        if (this.tmHasGH()) await this.tmGH(`/collaborators/${encodeURIComponent(login)}`, { method: 'DELETE' }).catch(e => this.tmErr(e));
        t.members = (t.members || []).filter(m => m.login !== login);
        t.rules = (t.rules || []).map(r => ({ ...r, allow: (r.allow || []).filter(l => l !== login) }));
        await this.tmSaveTeam(t, `chore(team): remove @${login}`);
        if (document.getElementById('tmx-sec')) this.tmRefresh();
        return true;
    };
    P.tmCancelInvite = async function (id) { await this.tmGH(`/invitations/${+id}`, { method: 'DELETE' }).catch(e => this.tmErr(e)); return this.tmRefresh(); };
    P.tmAcceptJoin = async function (num, login, role = 'editor') {
        const m = await this.tmInviteMember(login, role, '');
        if (m && this.tmHasGH()) { await this.tmGH(`/issues/${+num}/comments`, { method: 'POST', body: { body: `✅ تم قبول @${login} كـ ${ROLES[role].label} — ستصلك دعوة GitHub.` } }).catch(() => {}); await this.tmGH(`/issues/${+num}`, { method: 'PATCH', body: { state: 'closed' } }).catch(() => {}); }
        if (document.getElementById('tmx-sec')) this.tmRefresh();
        return m;
    };
    P.tmRejectJoin = async function (num) { await this.tmGH(`/issues/${+num}`, { method: 'PATCH', body: { state: 'closed', state_reason: 'not_planned' } }).catch(e => this.tmErr(e)); return this.tmRefresh(); };

    // ------------------------------------------------------------------ PER-FILE PERMISSIONS (#743) + CODEOWNERS
    P.tmPerms = async function () {
        const t = this.tmTeam();
        if (!t) return empty('أنشئ فريقاً أولاً من «نظرة عامة»');
        const owner = this.tmRole() === 'owner', me = this.tmMeSync();
        const members = (t.members || []).map(m => m.login);
        const rules = (t.rules || []).map((r, i) => [`<code dir="ltr">${esc(r.pattern)}</code>`, (r.allow || []).map(l => '@' + esc(l)).join(' ') || '<i>المالكون فقط</i>', esc(r.note || ''), owner ? btn('fa-trash', '', call('tmRemoveRule', i)) : '']);
        const sample = this.projectPaths().slice(0, 30).map(p => { const a = accessFor(t, me, p); return `<div class="gh-item"><code dir="ltr">${esc(p)}</code><span>${a === 'write' ? '✏️ تعديل' : '🔒 قراءة فقط'}</span></div>`; }).join('');
        return card('قواعد الملفات', `<p class="tmx-note">كل قاعدة تحصر تعديل الملفات المطابقة في الأعضاء المحددين (+ المالكين). البقية يرون الملفات للقراءة فقط — ويُفرض ذلك داخل المحرر (يُلغى أي تعديل غير مسموح) وعلى GitHub عبر CODEOWNERS.</p>
            ${rules.length ? table(['النمط', 'المسموح لهم', 'ملاحظة', ''], rules) : empty('لا قواعد — كل المحررين يعدّلون كل الملفات')}
            ${owner ? `<div class="gh-row">${field('tm-rule-pat', 'نمط (glob)', '', 'dir="ltr" placeholder="src/api/** أو *.sql أو docs/"')}<label class="fmx-field"><span>المسموح لهم</span><select id="tm-rule-allow" class="form-input-box" multiple size="3">${members.map(l => `<option value="${esc(l)}">@${esc(l)}</option>`).join('')}</select></label>${field('tm-rule-note', 'ملاحظة', '')}${pbtn('fa-plus', 'إضافة قاعدة', call('tmAddRule'))}</div>
            <label class="fmx-toggle"><input type="checkbox" ${t.settings.enforce !== false ? 'checked' : ''} onchange="${callRaw('tmSetSetting', ['enforce'], 'this.checked')}"> فرض الصلاحيات في المحرر</label>
            <div class="gh-row">${btn('fa-file-shield', 'توليد CODEOWNERS في المشروع', call('tmWriteCodeOwners', false))}${this.tmHasGH() ? btn('fa-cloud-arrow-up', 'رفع CODEOWNERS إلى GitHub', call('tmWriteCodeOwners', true)) : ''}</div>` : ''}`, 'fa-lock')
            + card(`صلاحياتك (@${esc(me)})`, `<div class="fmx-pick">${sample || empty('لا ملفات')}</div>`, 'fa-user-shield');
    };
    P.tmAddRule = async function (pattern = val('tm-rule-pat'), allow, note = val('tm-rule-note')) {
        const t = this.tmRequireTeam(); if (!t) return null;
        pattern = String(pattern || '').trim();
        if (!pattern) { this.showToast('اكتب نمط الملفات', 'warning'); return null; }
        if (!allow) { const el = document.getElementById('tm-rule-allow'); allow = el ? Array.from(el.selectedOptions || []).map(o => o.value) : []; }
        t.rules = (t.rules || []).filter(r => r.pattern !== pattern).concat({ id: uid('r'), pattern, allow, note: note || '' });
        await this.tmSaveTeam(t, `chore(team): file rule ${pattern}`);
        if (document.getElementById('tmx-sec')) this.tmRefresh();
        return t.rules[t.rules.length - 1];
    };
    P.tmRemoveRule = async function (i) { const t = this.tmRequireTeam(); if (!t) return; t.rules.splice(+i, 1); await this.tmSaveTeam(t, 'chore(team): remove file rule'); this.tmRefresh(); };
    P.tmWriteCodeOwners = async function (push = false) {
        const t = this.tmRequireTeam(); if (!t) return null;
        const text = codeOwners(t);
        this.writeProjectFile('.github/CODEOWNERS', text, 'team');
        if (this.renderStudioExplorer) this.renderStudioExplorer();
        if (push && this.tmHasGH()) { try { await this.tmWriteRepoFile('.github/CODEOWNERS', text, 'chore(team): update CODEOWNERS'); this.showToast('✅ رُفع CODEOWNERS — فعّل «Require review from Code Owners» في حماية الفرع', 'success'); } catch (e) { return this.tmErr(e); } }
        else this.showToast('📄 أُنشئ .github/CODEOWNERS في المشروع', 'success');
        return text;
    };

    // ------------------------------------------------------------------ INVITE LINK (#741)
    P.tmInviteLink = async function (role = 'editor', days = 7) {
        const t = this.tmRequireTeam(); if (!t) return null;
        const code = encodeInvite({ v: 1, repo: this.tmRepoKey(), team: t.name, role, by: await this.tmMe(), exp: Date.now() + days * DAY, n: uid('i') });
        return `${this.shareBaseUrl ? this.shareBaseUrl() : location.origin + location.pathname}#oxteam=${code}`;
    };
    P.tmInvite = async function () {
        const t = this.tmTeam();
        if (!t) return empty('أنشئ فريقاً أولاً من «نظرة عامة»');
        return card('رابط دعوة للفريق', `<div class="gh-row">${select('tm-link-role', 'الدور المطلوب', roleOpts, t.settings.defaultRole || 'editor')}${select('tm-link-days', 'الصلاحية', [['1', 'يوم'], ['7', 'أسبوع'], ['30', 'شهر']], '7')}${pbtn('fa-link', 'إنشاء الرابط', call('tmMakeInviteLink'))}</div>
            <div id="tm-link-out"></div>
            <div class="tmx-note">يفتح الزميل الرابط ← يُضبط المستودع لديه ← إن وُجدت دعوة GitHub يقبلها تلقائياً، وإلا يُرسل طلب انضمام يظهر لك في «الأعضاء» لتقبله بنقرة.</div>`, 'fa-link');
    };
    P.tmMakeInviteLink = async function () {
        const url = await this.tmInviteLink(val('tm-link-role') || 'editor', +(val('tm-link-days') || 7));
        if (!url) return null;
        const el = document.getElementById('tm-link-out');
        if (el) { el.innerHTML = `<div class="fmx-invite"><input class="form-input-box" dir="ltr" readonly value="${esc(url)}" onclick="this.select()"><div class="gh-row">${btn('fa-copy', 'نسخ', call('copyToClipboard', url))}</div><div id="tm-link-qr"></div></div>`; if (this.renderQR) this.renderQR(url, 'tm-link-qr'); }
        return url;
    };
    /** Opened from #oxteam=… */
    P.tmOpenInviteHash = async function (hash = location.hash) {
        const inv = decodeInvite(String(hash).replace(/^#?oxteam=/, ''));
        if (!inv) { this.showToast('رابط الدعوة غير صالح', 'error'); return null; }
        if (inv.exp && Date.now() > inv.exp) { this.showToast('⌛ انتهت صلاحية رابط الدعوة — اطلب رابطاً جديداً', 'warning'); return { expired: true }; }
        const [owner, repo] = inv.repo.split('/');
        if (!(await this.askConfirm(`👥 دعوة للانضمام إلى فريق «${inv.team}» (${inv.repo}) بدور ${(ROLES[inv.role] || {}).label || inv.role} من @${inv.by}. متابعة؟`, ''))) return null;
        this.settings.githubOwner = owner; this.settings.githubRepo = repo;
        if (this.persistSettings) this.persistSettings();
        if (!this.tmHasGH()) { this.showToast('أضف رمز GitHub في الإعدادات لإكمال الانضمام', 'warning'); return { needsToken: true }; }
        const me = await this.tmMe();
        const invs = await this.gh('/user/repository_invitations').catch(() => []) || [];
        const mine = invs.find(i => i.repository && i.repository.full_name && i.repository.full_name.toLowerCase() === inv.repo.toLowerCase());
        if (mine) {
            await this.gh(`/user/repository_invitations/${mine.id}`, { method: 'PATCH' });
            await this.tmPullTeam().catch(() => null);
            this.showToast(`🎉 انضممت إلى ${this.escapeHTML(inv.repo)}`, 'success');
            return { accepted: true };
        }
        await this.tmEnsureLabel(JOIN_LABEL, '0e8a16', 'Team join request');
        const issue = await this.tmGH('/issues', { method: 'POST', body: { title: `🙋 طلب انضمام: @${me}`, body: `@${inv.by} طلب انضمام عبر رابط الدعوة.\n\n<!--oxjoin ${JSON.stringify({ login: me, role: inv.role, n: inv.n })}-->`, labels: [JOIN_LABEL] } });
        this.showToast('📨 أُرسل طلب الانضمام — سيصلك إشعار بالقبول', 'success');
        return { requested: true, issue: issue && issue.number };
    };

    // ------------------------------------------------------------------ SETTINGS (#780), DELETE (#778), TRANSFER (#779)
    P.tmSettings = async function () {
        const t = this.tmTeam();
        if (!t) return empty('أنشئ فريقاً أولاً من «نظرة عامة»');
        const s = t.settings || {}, owner = this.tmRole() === 'owner';
        const dis = owner ? '' : 'disabled';
        return card('إعدادات الفريق', `<div class="fmx-grid2">${field('tm-set-name', 'الاسم', t.name, dis)}${field('tm-set-desc', 'الوصف', t.description || '', dis)}
            ${select('tm-set-role', 'الدور الافتراضي للمدعوين', roleOpts, s.defaultRole || 'editor', dis)}${field('tm-set-poll', 'فترة المراقبة (ثانية)', s.pollSec || 90, `type="number" min="30" ${dis}`)}
            ${field('tm-set-rate', 'سعر الساعة', s.rate || 0, `type="number" min="0" step="0.5" ${dis}`)}${field('tm-set-cur', 'العملة', s.currency || 'USD', dis)}
            ${field('tm-set-tax', 'الضريبة %', s.tax || 0, `type="number" min="0" ${dis}`)}${field('tm-set-client', 'اسم العميل', s.client || '', dis)}
            ${field('tm-set-ainame', 'اسم عضو الذكاء', s.aiName || 'OX-AI', dis)}${select('tm-set-ai', 'عضو الذكاء في القنوات (@ai)', [['1', 'مفعّل'], ['0', 'معطّل']], s.aiMember === false ? '0' : '1', dis)}
            ${select('tm-set-notify', 'الإشعارات', [['1', 'مفعّلة'], ['0', 'صامتة']], s.notify === false ? '0' : '1', dis)}</div>
            ${owner ? `<div class="gh-row">${pbtn('fa-floppy-disk', 'حفظ', call('tmSaveSettings'))}</div>` : '<div class="tmx-note">الإعدادات للمالك فقط.</div>'}`, 'fa-gear')
            + (owner ? card('نقل الملكية', `<div class="gh-row">${select('tm-xfer-to', 'المالك الجديد', (t.members || []).filter(m => m.login !== t.owner).map(m => [m.login, '@' + m.login]), '')}<label class="fmx-toggle"><input type="checkbox" id="tm-xfer-repo"> نقل المستودع نفسه على GitHub أيضاً</label>${btn('fa-right-left', 'نقل الملكية', call('tmTransferOwnership'))}</div>`, 'fa-crown')
                + card('منطقة الخطر', `<label class="fmx-toggle"><input type="checkbox" id="tm-del-collab"> سحب صلاحيات الأعضاء على GitHub أيضاً</label><div class="gh-row">${btn('fa-trash', 'حذف الفريق', call('tmDeleteTeam'), 'sidebar-btn-util gh-btn danger')}</div><div class="tmx-note">يحذف ${TEAM_FILE} ويؤرشف كل القنوات. المستودع وملفاته لا تُمس.</div>`, 'fa-triangle-exclamation') : '');
    };
    P.tmSetSetting = async function (key, value) { const t = this.tmRequireTeam(); if (!t) return null; t.settings = { ...(t.settings || {}), [key]: value }; await this.tmSaveTeam(t, `chore(team): ${key}`); return t.settings; };
    P.tmSaveSettings = async function (patch) {
        const t = this.tmRequireTeam(); if (!t) return null;
        if (!patch) patch = { name: val('tm-set-name'), description: val('tm-set-desc'), settings: { defaultRole: val('tm-set-role'), pollSec: +val('tm-set-poll') || 90, rate: +val('tm-set-rate') || 0, currency: val('tm-set-cur') || 'USD', tax: +val('tm-set-tax') || 0, client: val('tm-set-client'), aiName: val('tm-set-ainame') || 'OX-AI', aiMember: val('tm-set-ai') !== '0', notify: val('tm-set-notify') !== '0' } };
        if (patch.name) t.name = patch.name;
        if (patch.description != null) t.description = patch.description;
        t.settings = { ...(t.settings || {}), ...(patch.settings || {}) };
        await this.tmSaveTeam(t, 'chore(team): settings');
        if (this._tmWatch) this.tmWatchStart();
        this.showToast('✅ حُفظت إعدادات الفريق', 'success');
        return t;
    };
    P.tmTransferOwnership = async function (to = val('tm-xfer-to'), repoToo = val('tm-xfer-repo')) {
        const t = this.tmRequireTeam(); if (!t || !to) return null;
        if (!(await this.askConfirm(`نقل ملكية الفريق إلى @${to}${repoToo ? ' ونقل المستودع على GitHub' : ''}؟ ستصبح محرراً.`, ''))) return null;
        const old = t.owner;
        t.members = (t.members || []).map(m => (m.login === to ? { ...m, role: 'owner' } : m.login === old ? { ...m, role: 'editor' } : m));
        if (!t.members.some(m => m.login === to)) t.members.push({ login: to, role: 'owner', added: Date.now(), skills: [] });
        t.owner = to;
        if (this.tmHasGH()) await this.tmGH(`/collaborators/${encodeURIComponent(to)}`, { method: 'PUT', body: { permission: 'admin' } }).catch(() => {});
        await this.tmSaveTeam(t, `chore(team): transfer ownership @${old} → @${to}`);
        if (repoToo && this.tmHasGH()) { try { await this.tmGH('/transfer', { method: 'POST', body: { new_owner: to } }); this.showToast('📦 طُلب نقل المستودع — على المالك الجديد قبوله من GitHub', 'info'); } catch (e) { this.tmErr(e); } }
        this.showToast(`👑 @${this.escapeHTML(to)} هو المالك الجديد`, 'success');
        if (document.getElementById('tmx-sec')) this.tmRefresh();
        return t;
    };
    P.tmDeleteTeam = async function (revoke = val('tm-del-collab')) {
        const t = this.tmRequireTeam(); if (!t) return false;
        if (!(await this.askConfirm(`حذف الفريق «${t.name}» نهائياً؟`, ''))) return false;
        if (this.tmHasGH()) {
            const label = (t.settings && t.settings.channelLabel) || 'ox-channel';
            const chans = await this.tmGH(`/issues?labels=${label}&state=open&per_page=100`).catch(() => []) || [];
            for (const c of chans) await this.tmGH(`/issues/${c.number}`, { method: 'PATCH', body: { state: 'closed' } }).catch(() => {});
            if (revoke) for (const m of t.members || []) if (m.login !== t.owner) await this.tmGH(`/collaborators/${encodeURIComponent(m.login)}`, { method: 'DELETE' }).catch(() => {});
            await this.tmDeleteRepoFile(TEAM_FILE, `chore(team): delete team "${t.name}"`).catch(() => {});
        }
        const all = this.tmAllTeams(); delete all[this.tmRepoKey()]; lsSet('ox_team_v1', all);
        this.tmSyncRules();
        this.showToast('🗑️ حُذف الفريق', 'success');
        if (document.getElementById('tmx-sec')) this.tmLoad('team', 'overview');
        return true;
    };
}
