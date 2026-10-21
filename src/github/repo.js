/* Repository administration: star (#475), watch (#476), fork (#474), rename (#520), visibility (#519),
   discussions (#510), branch protection (#508), webhooks (#487), deploy keys (#488), apps (#489),
   fork sync (#514 #515), custom Pages domain (#524), archive (#471), delete (#472), transfer (#473). */
import { esc, encRef, isValidRepoName } from './shared.js';
import { card, btn, empty, note, input, select, val, link } from './core.js';

export const WEBHOOK_EVENTS = ['push', 'pull_request', 'issues', 'issue_comment', 'release', 'workflow_run', 'star', 'fork', 'create', 'delete'];
export const isValidDomain = (d) => /^(?=.{1,253}$)(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i.test(String(d || '').trim());

/** Branch protection payload from a simple form (pure; tested). */
export function protectionPayload({ reviews = 0, checks = [], strict = true, enforceAdmins = false, linear = false, conversation = false }) {
    return {
        required_status_checks: checks.length ? { strict: !!strict, contexts: checks } : null,
        enforce_admins: !!enforceAdmins,
        required_pull_request_reviews: reviews > 0 ? { required_approving_review_count: Math.min(6, reviews), dismiss_stale_reviews: true } : null,
        restrictions: null,
        required_linear_history: !!linear,
        allow_force_pushes: false,
        allow_deletions: false,
        required_conversation_resolution: !!conversation
    };
}

export function installRepo(P) {
    const reloadIf = (app, tab = 'repo') => { if (app.ghTab === tab && !app.ghView) app.ghxReload(); };

    // ------------------------------------------------------------------ GENERAL
    P.ghxRepoGeneral = async function () {
        const rp = this.ghRepoPath();
        const info = await this.ghRepoInfo(true);
        const hasToken = !!(this.settings.githubToken || '').trim();
        let starred = null, watching = null;
        if (hasToken) {
            const { owner, repo } = this.ghRepo();
            const [s, w] = await Promise.all([
                this.gh(`/user/starred/${owner}/${repo}`, { allow: [404] }).catch(() => ({ __status: 404 })),
                this.gh(`${rp}/subscription`, { allow: [404] }).catch(() => ({ __status: 404 }))
            ]);
            starred = !(s && s.__status === 404);
            watching = !!(w && !w.__status && w.subscribed);
        }
        this._ghxSocial = { starred, watching };
        const admin = !!(info.permissions && info.permissions.admin);
        const toggle = (key, label, icon) => `<label class="gh-check ghx-toggle"><input type="checkbox" ${info[key] ? 'checked' : ''} ${admin ? '' : 'disabled'} onchange="app.ghxSetRepoFeature('${key}', this.checked)"> <i class="fa-solid ${icon}"></i> ${label}</label>`;
        return `<div class="gh-card"><b dir="ltr">${esc(info.full_name)}</b> ${info.private ? '<span class="gh-badge warn">خاص</span>' : '<span class="gh-badge ok">عام</span>'} ${info.archived ? '<span class="gh-badge dim">مؤرشف</span>' : ''} ${info.fork ? '<span class="gh-badge purple">Fork</span>' : ''}
                <div class="text-dim" style="font-size:0.78rem;margin-top:4px">${esc(info.description || '')}</div></div>
            <div class="gh-toolbar ghx-social">
                ${btn(starred ? 'إلغاء النجمة' : 'نجمة', 'app.ghxToggleStar()', { icon: starred ? 'fa-star' : 'fa-regular fa-star', primary: !starred, attrs: `data-starred="${starred}"` }).replace('fa-solid fa-regular', 'fa-regular')} <span class="gh-badge dim">${+info.stargazers_count}</span>
                ${btn(watching ? 'إلغاء المتابعة' : 'متابعة', 'app.ghxToggleWatch()', { icon: watching ? 'fa-eye-slash' : 'fa-eye', attrs: `data-watching="${watching}"` })} <span class="gh-badge dim">${+(info.subscribers_count || 0)}</span>
                ${btn('Fork', 'app.ghxForkRepo()', { icon: 'fa-code-fork' })} <span class="gh-badge dim">${+info.forks_count}</span>
                ${link('GitHub', info.html_url)}</div>
            ${card('التفاصيل', `<div class="gh-form">
                <div class="gh-row"><label style="min-width:70px">الاسم</label>${input('ghx-repo-name', { value: info.name, style: 'max-width:240px' })}${btn('إعادة تسمية', 'app.ghxRenameRepo()', { icon: 'fa-i-cursor', attrs: admin ? '' : 'disabled' })}</div>
                <div class="gh-row"><label style="min-width:70px">الوصف</label>${input('ghx-repo-desc', { value: info.description || '', dir: 'auto', style: 'flex:1' })}</div>
                <div class="gh-row"><label style="min-width:70px">الموقع</label>${input('ghx-repo-home', { value: info.homepage || '', placeholder: 'https://', style: 'flex:1' })}</div>
                <div class="gh-row"><label style="min-width:70px">المواضيع</label>${input('ghx-repo-topics', { value: (info.topics || []).join(', '), placeholder: 'react, dashboard', style: 'flex:1' })}${btn('حفظ', 'app.ghxSaveRepoDetails()', { icon: 'fa-floppy-disk', primary: true, attrs: admin ? '' : 'disabled' })}</div></div>`, { icon: 'fa-pen' })}
            ${card('الميزات', `<div class="ghx-toggles">${toggle('has_issues', 'Issues', 'fa-circle-dot')}${toggle('has_discussions', 'Discussions', 'fa-comments')}${toggle('has_wiki', 'Wiki', 'fa-book-open')}${toggle('has_projects', 'Projects', 'fa-table-columns')}
                ${toggle('allow_squash_merge', 'دمج Squash', 'fa-compress')}${toggle('allow_rebase_merge', 'دمج Rebase', 'fa-layer-group')}${toggle('delete_branch_on_merge', 'حذف الفرع بعد الدمج', 'fa-trash')}</div>
                ${admin ? '' : '<div class="text-dim" style="font-size:0.72rem">تغيير الإعدادات يحتاج صلاحية مدير على المستودع.</div>'}`, { icon: 'fa-toggle-on' })}
            ${card('الظهور', `<div class="gh-row">المستودع حالياً <b>${info.private ? 'خاص' : 'عام'}</b><span class="gh-spacer"></span>${btn(info.private ? 'جعله عاماً' : 'جعله خاصاً', 'app.ghxToggleVisibility()', { icon: info.private ? 'fa-lock-open' : 'fa-lock', danger: !info.private, attrs: admin ? '' : 'disabled' })}</div>`, { icon: 'fa-eye' })}`;
    };

    P.ghxPatchRepo = async function (body, msg) {
        if (!this.ghRequireToken()) return null;
        try {
            const r = await this.gh(this.ghRepoPath(), { method: 'PATCH', body });
            this._ghRepoInfo = null;
            if (msg) this.showToast(msg, 'success');
            return r;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };
    P.ghxSetRepoFeature = async function (key, on) {
        const r = await this.ghxPatchRepo({ [key]: !!on }, `✅ ${on ? 'فُعّلت' : 'عُطّلت'} الميزة`);
        if (!r) reloadIf(this);
        return r;
    };
    P.ghxSaveRepoDetails = async function () {
        const topics = val('ghx-repo-topics').split(/[,\s]+/).map(t => t.toLowerCase().trim()).filter(Boolean);
        const bad = topics.find(t => !/^[a-z0-9][a-z0-9-]{0,49}$/.test(t));
        if (bad) { this.showToast(`موضوع غير صالح: ${bad}`, 'warning'); return; }
        const r = await this.ghxPatchRepo({ description: val('ghx-repo-desc'), homepage: val('ghx-repo-home') });
        if (!r) return;
        try { await this.gh(`${this.ghRepoPath()}/topics`, { method: 'PUT', body: { names: topics } }); } catch (e) { this.showToast('❌ ' + e.message, 'error'); return; }
        this.showToast('✅ حُفظت التفاصيل', 'success');
        reloadIf(this);
        return true;
    };
    P.ghxRenameRepo = async function (nameArg) {
        const name = nameArg || val('ghx-repo-name');
        const { owner, repo } = this.ghRepo();
        if (!isValidRepoName(name)) { this.showToast('اسم مستودع غير صالح', 'warning'); return; }
        if (name === repo) return;
        if (!nameArg && !(await this.ghxConfirm('إعادة تسمية المستودع', `<span dir="ltr">${esc(owner)}/${esc(repo)}</span> → <b dir="ltr">${esc(owner)}/${esc(name)}</b><br>يعيد GitHub توجيه الروابط القديمة تلقائياً.`))) return;
        const r = await this.ghxPatchRepo({ name }, `✅ أعيدت التسمية إلى ${name}`);
        if (!r) return;
        this.ghxUseRepo(owner, r.name || name, this.ghRepo().branch);
        reloadIf(this);
        return r;
    };
    P.ghxToggleVisibility = async function () {
        const info = await this.ghRepoInfo(true);
        const makePrivate = !info.private;
        const ok = makePrivate
            ? await this.ghxConfirm('جعل المستودع خاصاً', 'سيختفي عن العامة، وقد تُفقد النجوم والمتابعون من خارج الفريق.', { danger: true })
            : await this.ghxTypeConfirm('جعل المستودع عاماً', 'سيصبح كل الكود والسجل مرئياً للجميع. تأكد من عدم وجود أسرار في السجل.', info.name);
        if (!ok) return;
        const r = await this.ghxPatchRepo({ private: makePrivate }, makePrivate ? '🔒 أصبح المستودع خاصاً' : '🌍 أصبح المستودع عاماً');
        reloadIf(this);
        return r;
    };

    P.ghxToggleStar = async function () {
        if (!this.ghRequireToken()) return;
        const { owner, repo } = this.ghRepo();
        const on = !(this._ghxSocial && this._ghxSocial.starred);
        try {
            await this.gh(`/user/starred/${owner}/${repo}`, { method: on ? 'PUT' : 'DELETE' });
            this._ghRepoInfo = null;
            this.showToast(on ? '⭐ أُضيفت نجمة' : 'أزيلت النجمة', 'success');
            reloadIf(this);
            return on;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };
    P.ghxToggleWatch = async function () {
        if (!this.ghRequireToken()) return;
        const on = !(this._ghxSocial && this._ghxSocial.watching);
        try {
            if (on) await this.gh(`${this.ghRepoPath()}/subscription`, { method: 'PUT', body: { subscribed: true, ignored: false } });
            else await this.gh(`${this.ghRepoPath()}/subscription`, { method: 'DELETE' });
            this._ghRepoInfo = null;
            this.showToast(on ? '👁️ تتابع المستودع الآن' : 'أُلغيت المتابعة', 'success');
            reloadIf(this);
            return on;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };
    P.ghxForkRepo = async function () {
        if (!this.ghRequireToken()) return;
        const r = await this.showDialog({
            title: '🍴 إنشاء Fork',
            fields: [{ id: 'name', label: 'اسم النسخة (اختياري)', value: this.ghRepo().repo, dir: 'ltr' }, { id: 'org', label: 'في مؤسسة (اختياري)', value: '', dir: 'ltr', placeholder: 'اتركه فارغاً لحسابك' }, { id: 'only', type: 'checkbox', label: 'الفرع الافتراضي فقط', value: true }, { id: 'use', type: 'checkbox', label: 'اجعله المستودع النشط بعد الإنشاء', value: true }],
            buttons: [{ label: 'إنشاء', value: 'ok', primary: true }, { label: 'إلغاء', value: null }]
        });
        if (!r) return;
        try {
            const body = { default_branch_only: !!r.values.only };
            if (r.values.name.trim()) body.name = r.values.name.trim();
            if (r.values.org.trim()) body.organization = r.values.org.trim();
            const f = await this.gh(`${this.ghRepoPath()}/forks`, { method: 'POST', body });
            this.showToast(`✅ أنشئ Fork: ${f.full_name} (قد يستغرق ثوانٍ ليكتمل)`, 'success');
            if (r.values.use) this.ghxUseRepo(f.owner.login, f.name, f.default_branch);
            return f;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };

    // ------------------------------------------------------------------ BRANCH PROTECTION (#508)
    P.ghxProtection = async function () {
        this.ghxNeedToken('حماية الفروع');
        const rp = this.ghRepoPath();
        const branches = await this.ghxBranches();
        const b = this._ghxProtBranch && branches.includes(this._ghxProtBranch) ? this._ghxProtBranch : ((await this.ghRepoInfo()).default_branch || branches[0]);
        const cur = await this.gh(`${rp}/branches/${encRef(b)}/protection`, { allow: [404] }).catch((e) => { if (e.status === 403) throw e; return { __status: 404 }; });
        const on = cur && !cur.__status;
        const reviews = on && cur.required_pull_request_reviews ? +cur.required_pull_request_reviews.required_approving_review_count : 0;
        const checks = on && cur.required_status_checks ? cur.required_status_checks.contexts || [] : [];
        const chk = (id, label, v) => `<label class="gh-check"><input type="checkbox" id="${id}" ${v ? 'checked' : ''}> ${label}</label>`;
        return `<div class="gh-toolbar"><label class="gh-check"><i class="fa-solid fa-code-branch"></i> ${select('ghx-prot-branch', branches, b, { style: 'width:auto' }).replace('<select ', '<select onchange="app._ghxProtBranch=this.value; app.ghxReload()" ')}</label>
                ${on ? '<span class="gh-badge ok"><i class="fa-solid fa-shield-halved"></i> محمي</span>' : '<span class="gh-badge dim">غير محمي</span>'}</div>
            ${card('قواعد الحماية', `<div class="gh-form">
                <div class="gh-row"><label>موافقات PR المطلوبة</label>${select('ghx-prot-reviews', [['0', 'بدون'], ['1', '1'], ['2', '2'], ['3', '3']], String(reviews), { style: 'width:auto' })}</div>
                <div class="gh-row"><label>فحوص CI مطلوبة</label>${input('ghx-prot-checks', { value: checks.join(', '), placeholder: 'build, test', style: 'flex:1' })}</div>
                ${chk('ghx-prot-strict', 'يجب أن يكون الفرع محدّثاً قبل الدمج', on && cur.required_status_checks ? cur.required_status_checks.strict : true)}
                ${chk('ghx-prot-admins', 'تطبيق القواعد على المدراء أيضاً', on && cur.enforce_admins && cur.enforce_admins.enabled)}
                ${chk('ghx-prot-linear', 'سجل خطي (بدون merge commits)', on && cur.required_linear_history && cur.required_linear_history.enabled)}
                ${chk('ghx-prot-conv', 'حل كل المحادثات قبل الدمج', on && cur.required_conversation_resolution && cur.required_conversation_resolution.enabled)}
                <div class="text-dim" style="font-size:0.72rem">يُمنع دائماً: الدفع القسري (force push) وحذف الفرع.</div>
                <div class="gh-row">${btn(on ? 'تحديث الحماية' : 'تفعيل الحماية', 'app.ghxSaveProtection()', { icon: 'fa-shield-halved', primary: true })}${on ? btn('إزالة الحماية', 'app.ghxRemoveProtection()', { icon: 'fa-shield', danger: true }) : ''}</div></div>`, { icon: 'fa-shield-halved' })}`;
    };
    P.ghxSaveProtection = async function (o) {
        if (!this.ghRequireToken()) return;
        const branch = (o && o.branch) || val('ghx-prot-branch');
        const form = o || { reviews: +val('ghx-prot-reviews') || 0, checks: val('ghx-prot-checks').split(',').map(s => s.trim()).filter(Boolean), strict: val('ghx-prot-strict'), enforceAdmins: val('ghx-prot-admins'), linear: val('ghx-prot-linear'), conversation: val('ghx-prot-conv') };
        try {
            await this.gh(`${this.ghRepoPath()}/branches/${encRef(branch)}/protection`, { method: 'PUT', body: protectionPayload(form) });
            this.showToast(`🛡️ حُمي الفرع ${branch}`, 'success');
            reloadIf(this);
            return true;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };
    P.ghxRemoveProtection = async function (branchArg) {
        if (!this.ghRequireToken()) return;
        const branch = branchArg || val('ghx-prot-branch');
        if (!branchArg && !(await this.ghxConfirm('إزالة الحماية', `إزالة كل قواعد حماية <b dir="ltr">${esc(branch)}</b>؟`, { danger: true }))) return;
        try { await this.gh(`${this.ghRepoPath()}/branches/${encRef(branch)}/protection`, { method: 'DELETE' }); this.showToast('أزيلت الحماية', 'success'); reloadIf(this); return true; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };

    // ------------------------------------------------------------------ WEBHOOKS (#487)
    P.ghxWebhooks = async function () {
        this.ghxNeedToken('إدارة الـ Webhooks');
        const hooks = await this.gh(`${this.ghRepoPath()}/hooks?per_page=100`);
        return card('Webhook جديد', `<div class="gh-form"><div class="gh-row">${input('ghx-hook-url', { placeholder: 'https://example.com/webhook', style: 'flex:1' })}${select('ghx-hook-type', [['json', 'JSON'], ['form', 'form']], 'json', { style: 'width:auto' })}</div>
                <div class="gh-row">${input('ghx-hook-secret', { placeholder: 'Secret للتوقيع (اختياري)', type: 'password', style: 'flex:1' })}</div>
                <div class="ghx-toggles">${WEBHOOK_EVENTS.map(e => `<label class="gh-check"><input type="checkbox" data-hook-event="${e}" ${e === 'push' ? 'checked' : ''}> <span dir="ltr">${e}</span></label>`).join('')}</div>
                <div class="gh-row">${btn('إضافة', 'app.ghxCreateWebhook()', { icon: 'fa-bolt', primary: true })}</div></div>`, { icon: 'fa-plus' })
            + (hooks.length ? `<div class="gh-list">${hooks.map(h => `<div class="gh-item static" data-hook="${+h.id}"><i class="fa-solid fa-bolt ${h.active ? 'text-warning' : 'text-dim'}"></i><div class="gh-item-main">
                <div class="gh-item-title" dir="ltr" style="text-align:right">${esc((h.config && h.config.url) || h.name)}</div>
                <div class="gh-item-meta">${(h.events || []).map(e => `<span class="gh-label" style="--c:#a78bfa">${esc(e)}</span>`).join('')} ${h.last_response && h.last_response.code ? `• آخر رد: <b>${+h.last_response.code}</b>` : ''}</div></div>
                <div class="gh-item-actions">${btn('', `app.ghxPingWebhook(${+h.id})`, { icon: 'fa-satellite-dish', title: 'Ping' })}${btn('', `app.ghxToggleWebhook(${+h.id}, ${!h.active})`, { icon: h.active ? 'fa-pause' : 'fa-play', title: h.active ? 'إيقاف' : 'تفعيل' })}${btn('', `app.ghxDeleteWebhook(${+h.id})`, { icon: 'fa-trash', danger: true, title: 'حذف' })}</div></div>`).join('')}</div>` : empty('لا توجد Webhooks.'));
    };
    P.ghxCreateWebhook = async function (o) {
        if (!this.ghRequireToken()) return;
        const url = o ? o.url : val('ghx-hook-url');
        const events = o ? o.events : Array.from(document.querySelectorAll('[data-hook-event]')).filter(x => x.checked).map(x => x.dataset.hookEvent);
        if (!/^https?:\/\/[^\s]+$/i.test(url || '')) { this.showToast('رابط غير صالح', 'warning'); return; }
        if (!events.length) { this.showToast('اختر حدثاً واحداً على الأقل', 'warning'); return; }
        const config = { url, content_type: (o ? o.type : val('ghx-hook-type')) || 'json', insecure_ssl: '0' };
        const secret = o ? o.secret : val('ghx-hook-secret');
        if (secret) config.secret = secret;
        try {
            const h = await this.gh(`${this.ghRepoPath()}/hooks`, { method: 'POST', body: { name: 'web', active: true, events, config } });
            this.showToast('✅ أضيف الـ Webhook', 'success');
            reloadIf(this);
            return h;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };
    P.ghxPingWebhook = async function (id) {
        try { await this.gh(`${this.ghRepoPath()}/hooks/${id}/pings`, { method: 'POST' }); this.showToast('📡 أرسل Ping', 'success'); return true; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };
    P.ghxToggleWebhook = async function (id, active) {
        try { await this.gh(`${this.ghRepoPath()}/hooks/${id}`, { method: 'PATCH', body: { active: !!active } }); this.showToast(active ? 'فُعّل' : 'أوقف', 'success'); reloadIf(this); return true; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };
    P.ghxDeleteWebhook = async function (id) {
        if (!(await this.ghxConfirm('حذف Webhook', 'حذف هذا الـ Webhook؟', { danger: true }))) return;
        try { await this.gh(`${this.ghRepoPath()}/hooks/${id}`, { method: 'DELETE' }); this.showToast('تم الحذف', 'success'); reloadIf(this); return true; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };

    // ------------------------------------------------------------------ DEPLOY KEYS (#488)
    P.ghxDeployKeys = async function () {
        this.ghxNeedToken('إدارة Deploy Keys');
        const keys = await this.gh(`${this.ghRepoPath()}/keys?per_page=100`);
        return card('مفتاح نشر جديد', `<div class="gh-form"><div class="gh-row">${input('ghx-dk-title', { placeholder: 'CI server', dir: 'auto', style: 'max-width:200px' })}<label class="gh-check"><input type="checkbox" id="ghx-dk-ro" checked> قراءة فقط</label></div>
                <textarea id="ghx-dk-key" class="form-input-box" rows="3" dir="ltr" placeholder="ssh-ed25519 AAAA..."></textarea>
                <div class="gh-row">${btn('إضافة', 'app.ghxAddDeployKey()', { icon: 'fa-plus', primary: true })}${btn('توليد مفتاح جديد', "app.ghxLoad('clone','ssh')", { icon: 'fa-wand-magic-sparkles' })}</div></div>`, { icon: 'fa-key' })
            + (keys.length ? `<div class="gh-list">${keys.map(k => `<div class="gh-item static" data-key="${+k.id}"><i class="fa-solid fa-key text-warning"></i><div class="gh-item-main">
                <div class="gh-item-title">${esc(k.title)} ${k.read_only ? '<span class="gh-badge dim">قراءة</span>' : '<span class="gh-badge warn">قراءة/كتابة</span>'}</div>
                <div class="gh-item-meta" dir="ltr"><code>${esc(String(k.key).slice(0, 40))}…</code> • ${this.ghTimeAgo(k.created_at)}</div></div>
                <div class="gh-item-actions">${btn('', `app.ghxDeleteDeployKey(${+k.id})`, { icon: 'fa-trash', danger: true, title: 'حذف' })}</div></div>`).join('')}</div>` : empty('لا توجد مفاتيح نشر.'));
    };
    P.ghxAddDeployKey = async function (o) {
        if (!this.ghRequireToken()) return;
        const title = (o ? o.title : val('ghx-dk-title')) || 'deploy key';
        const key = (o ? o.key : (document.getElementById('ghx-dk-key') || {}).value || '').trim();
        const read_only = o ? o.readOnly !== false : val('ghx-dk-ro');
        if (!/^(ssh-(ed25519|rsa)|ecdsa-sha2-nistp\d+|sk-)\S*\s+[A-Za-z0-9+/=]+/.test(key)) { this.showToast('مفتاح SSH عام غير صالح', 'warning'); return; }
        try {
            const k = await this.gh(`${this.ghRepoPath()}/keys`, { method: 'POST', body: { title, key, read_only } });
            this.showToast('✅ أضيف مفتاح النشر', 'success');
            reloadIf(this);
            return k;
        } catch (e) { this.showToast(e.status === 422 ? '❌ المفتاح مستخدم مسبقاً' : '❌ ' + e.message, 'error'); }
    };
    P.ghxDeleteDeployKey = async function (id) {
        if (!(await this.ghxConfirm('حذف مفتاح نشر', 'حذف المفتاح؟ ستفقد الخوادم التي تستخدمه الوصول.', { danger: true }))) return;
        try { await this.gh(`${this.ghRepoPath()}/keys/${id}`, { method: 'DELETE' }); this.showToast('تم الحذف', 'success'); reloadIf(this); return true; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };

    // ------------------------------------------------------------------ APPS (#489)
    P.ghxApps = async function () {
        const rp = this.ghRepoPath();
        const { owner, branch } = this.ghRepo();
        const info = await this.ghRepoInfo();
        const [suites, orgInst] = await Promise.all([
            this.gh(`${rp}/commits/${encRef(branch)}/check-suites?per_page=50`).then(d => d.check_suites || []).catch(() => []),
            info.owner && info.owner.type === 'Organization' && (this.settings.githubToken || '').trim() ? this.gh(`/orgs/${owner}/installations?per_page=100`).then(d => d.installations || []).catch(() => null) : Promise.resolve(null)
        ]);
        const apps = new Map();
        suites.forEach(s => { if (s.app) apps.set(s.app.slug, { app: s.app, conclusion: s.conclusion, status: s.status }); });
        return card('تطبيقات تعمل على آخر commit', apps.size ? Array.from(apps.values()).map(({ app, status, conclusion }) => `<div class="gh-check-row" data-app="${esc(app.slug)}">${this.ghStatusBadge(status, conclusion)} <b>${esc(app.name)}</b> <span class="text-dim">${esc(app.owner && app.owner.login)}</span> <a class="text-emerald" href="${esc(app.html_url)}" target="_blank" rel="noopener">↗</a></div>`).join('') : '<div class="text-dim">لا توجد تطبيقات CI/فحص على آخر commit.</div>', { icon: 'fa-puzzle-piece' })
            + (orgInst ? card(`تطبيقات مثبتة في ${esc(owner)} (${orgInst.length})`, orgInst.map(i => `<div class="gh-check-row"><b>${esc(i.app_slug)}</b> <span class="text-dim">${i.repository_selection === 'all' ? 'كل المستودعات' : 'مستودعات مختارة'}</span> <a class="text-emerald" href="${esc(i.html_url)}" target="_blank" rel="noopener">إعدادات ↗</a></div>`).join('') || '<div class="text-dim">—</div>', { icon: 'fa-building' }) : '')
            + `<div class="gh-toolbar">${link('تطبيقاتي المثبتة', 'https://github.com/settings/installations')}${link('سوق GitHub', 'https://github.com/marketplace')}${link('إنشاء GitHub App', 'https://github.com/settings/apps/new')}</div>`;
    };

    // ------------------------------------------------------------------ FORK SYNC (#514 #515)
    P.ghxForkSync = async function () {
        const info = await this.ghRepoInfo(true);
        if (!info.fork || !info.parent) return empty('هذا المستودع ليس Fork. عند العمل على نسخة Fork تظهر هنا حالة المزامنة مع الأصل.') + `<div style="text-align:center">${btn('إنشاء Fork', "app.ghxLoad('repo','general')", { icon: 'fa-code-fork' })}</div>`;
        const parent = info.parent;
        const branch = this.ghRepo().branch;
        const upBranch = branch === info.default_branch ? parent.default_branch : branch;
        let cmp = null;
        try { cmp = await this.gh(`${this.ghRepoPath()}/compare/${encRef(branch)}...${encodeURIComponent(parent.owner.login)}:${encodeURIComponent(parent.name)}:${encRef(upBranch)}`); } catch (e) { cmp = null; }
        const behind = cmp ? +cmp.ahead_by : null, ahead = cmp ? +cmp.behind_by : null;
        return card('حالة الـ Fork', `<div>الأصل: <a class="text-emerald" dir="ltr" href="${esc(parent.html_url)}" target="_blank" rel="noopener">${esc(parent.full_name)}</a></div>
                ${cmp ? `<div class="ghx-compare"><div><b>${behind}</b><span>commit في الأصل غير موجود هنا</span></div><div class="ghx-compare-vs">⇄</div><div><b>${ahead}</b><span>commit لديك غير موجود في الأصل</span></div></div>` : '<div class="text-dim">تعذرت المقارنة مع الأصل.</div>'}
                <div class="gh-row" style="margin-top:8px">${btn(`مزامنة ${esc(branch)}`, 'app.ghxSyncFork()', { icon: 'fa-rotate', primary: true, attrs: behind === 0 ? 'disabled' : '' })}${btn('تحديث كل الفروع', 'app.ghxUpdateForkBranches()', { icon: 'fa-arrows-rotate' })}
                    ${behind ? btn('PR للأصل', `window.open('${esc(parent.html_url)}/compare/${encodeURIComponent(upBranch)}...${encodeURIComponent(info.owner.login)}:${encodeURIComponent(branch)}','_blank','noopener')`, { icon: 'fa-code-pull-request' }) : ''}</div>
                ${behind === 0 ? '<div class="text-emerald" style="font-size:0.78rem;margin-top:4px">✓ محدّث مع الأصل</div>' : ''}`, { icon: 'fa-code-fork' });
    };
    P.ghxSyncFork = async function (branchArg) {
        if (!this.ghRequireToken()) return;
        const branch = branchArg || this.ghRepo().branch;
        try {
            const r = await this.gh(`${this.ghRepoPath()}/merge-upstream`, { method: 'POST', body: { branch } });
            this.showToast(r && r.merge_type === 'none' ? `ℹ️ ${branch} محدّث مسبقاً` : `✅ تمت مزامنة ${branch} مع الأصل`, 'success');
            if (!branchArg) reloadIf(this);
            return r;
        } catch (e) { this.showToast(e.status === 409 ? `⚠️ تعارض في ${branch} — ادمج يدوياً عبر PR` : '❌ ' + e.message, e.status === 409 ? 'warning' : 'error'); return null; }
    };
    P.ghxUpdateForkBranches = async function () {
        if (!this.ghRequireToken()) return;
        const info = await this.ghRepoInfo(true);
        if (!info.parent) return;
        const [mine, theirs] = await Promise.all([this.ghxBranches(), this.ghxBranches(`/repos/${info.parent.full_name}`).catch(() => [])]);
        const common = mine.filter(b => theirs.includes(b) || b === info.default_branch);
        let ok = 0, fail = 0;
        for (const b of common) { const r = await this.ghxSyncFork(b); if (r) ok++; else fail++; }
        this.showToast(`🔄 حُدّث ${ok} فرع${fail ? ` • تعذر ${fail}` : ''}`, fail ? 'warning' : 'success');
        reloadIf(this);
        return { ok, fail, branches: common };
    };

    // ------------------------------------------------------------------ CUSTOM DOMAIN (#524)
    P.ghxDomain = async function () {
        const rp = this.ghRepoPath();
        const pages = await this.gh(`${rp}/pages`, { allow: [404] }).catch(() => ({ __status: 404 }));
        if (!pages || pages.__status === 404) return empty('GitHub Pages غير مفعّل لهذا المستودع.') + `<div style="text-align:center">${btn('فتح تبويب النشر', "app.switchGhTab('deploy')", { icon: 'fa-rocket', primary: true })}</div>`;
        const { owner } = this.ghRepo();
        const cname = pages.cname || '';
        const apex = cname && cname.split('.').length === 2;
        return card('النطاق المخصص', `<div class="gh-row">${input('ghx-domain', { value: cname, placeholder: 'www.example.com', style: 'flex:1' })}${btn('حفظ', 'app.ghxSetDomain()', { icon: 'fa-globe', primary: true })}${cname ? btn('إزالة', "app.ghxSetDomain('')", { icon: 'fa-xmark', danger: true }) : ''}</div>
                <div class="gh-item-meta" style="margin-top:6px">الرابط الحالي: <a class="text-emerald" dir="ltr" href="${esc(pages.html_url)}" target="_blank" rel="noopener">${esc(pages.html_url)}</a> ${pages.https_enforced ? '<span class="gh-badge ok">HTTPS</span>' : ''}</div>
                <label class="gh-check" style="margin-top:6px"><input type="checkbox" ${pages.https_enforced ? 'checked' : ''} onchange="app.ghxSetHttps(this.checked)"> فرض HTTPS</label>`, { icon: 'fa-globe' })
            + card('إعداد DNS', `<table class="ghx-table" dir="ltr"><thead><tr><th>Type</th><th>Name</th><th>Value</th></tr></thead><tbody>
                ${!cname || !apex ? `<tr><td>CNAME</td><td>${esc(cname ? cname.split('.')[0] : 'www')}</td><td>${esc(owner.toLowerCase())}.github.io</td></tr>` : ''}
                ${!cname || apex ? ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'].map(ip => `<tr><td>A</td><td>@</td><td>${ip}</td></tr>`).join('') : ''}</tbody></table>
                <div class="text-dim" style="font-size:0.72rem">قد يستغرق انتشار DNS حتى 24 ساعة، وإصدار شهادة HTTPS بضع دقائق بعده.</div>`, { icon: 'fa-network-wired' });
    };
    P.ghxSetDomain = async function (d) {
        if (!this.ghRequireToken()) return;
        const domain = d != null ? d : val('ghx-domain');
        if (domain && !isValidDomain(domain)) { this.showToast('نطاق غير صالح', 'warning'); return; }
        try {
            await this.gh(`${this.ghRepoPath()}/pages`, { method: 'PUT', body: { cname: domain || null } });
            this.showToast(domain ? `✅ رُبط النطاق ${domain}` : 'أزيل النطاق المخصص', 'success');
            reloadIf(this);
            return true;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };
    P.ghxSetHttps = async function (on) {
        try { await this.gh(`${this.ghRepoPath()}/pages`, { method: 'PUT', body: { https_enforced: !!on } }); this.showToast('✅ تم', 'success'); return true; } catch (e) { this.showToast('❌ ' + e.message, 'error'); reloadIf(this); return false; }
    };

    // ------------------------------------------------------------------ DANGER ZONE (#471 #472 #473)
    P.ghxDanger = async function () {
        const info = await this.ghRepoInfo(true);
        const admin = !!(info.permissions && info.permissions.admin);
        const row = (title, desc, b) => `<div class="ghx-danger-row"><div><b>${title}</b><div class="text-dim" style="font-size:0.74rem">${desc}</div></div>${b}</div>`;
        return `<div class="ghx-danger">${!admin ? note('هذه العمليات تحتاج صلاحية مدير على المستودع.', 'warn') : ''}
            ${row(info.archived ? 'إلغاء الأرشفة' : 'أرشفة المستودع', info.archived ? 'إعادة المستودع للعمل (قابل للكتابة).' : 'يصبح للقراءة فقط: لا commits ولا Issues جديدة. قابل للعكس.', btn(info.archived ? 'إلغاء الأرشفة' : 'أرشفة', 'app.ghxArchiveRepo()', { icon: 'fa-box-archive', danger: !info.archived, attrs: admin ? '' : 'disabled' }))}
            ${row('نقل الملكية', 'نقل المستودع إلى مستخدم أو مؤسسة أخرى.', btn('نقل', 'app.ghxTransferRepo()', { icon: 'fa-right-left', danger: true, attrs: admin ? '' : 'disabled' }))}
            ${row('حذف المستودع', 'حذف نهائي للكود والـ Issues والـ PRs والإصدارات. لا يمكن التراجع.', btn('حذف', 'app.ghxDeleteRepo()', { icon: 'fa-trash', danger: true, attrs: admin ? '' : 'disabled' }))}</div>`;
    };
    P.ghxArchiveRepo = async function () {
        const info = await this.ghRepoInfo(true);
        const archive = !info.archived;
        if (archive && !(await this.ghxConfirm('أرشفة المستودع', `أرشفة <b dir="ltr">${esc(info.full_name)}</b>؟ يصبح للقراءة فقط.`, { danger: true }))) return;
        const r = await this.ghxPatchRepo({ archived: archive }, archive ? '📦 أُرشف المستودع' : '✅ أُلغيت الأرشفة');
        reloadIf(this);
        return r;
    };
    P.ghxTransferRepo = async function () {
        if (!this.ghRequireToken()) return;
        const info = await this.ghRepoInfo(true);
        const to = await this.askText('نقل المستودع إلى', '', { label: 'اسم المستخدم أو المؤسسة الجديدة', placeholder: 'new-owner', validate: (v) => (/^[A-Za-z0-9-]{1,39}$/.test(v) ? null : 'اسم غير صالح') });
        if (!to) return;
        if (!(await this.ghxTypeConfirm('تأكيد النقل', `سيُنقل <b dir="ltr">${esc(info.full_name)}</b> إلى <b dir="ltr">${esc(to)}</b>.`, info.full_name))) return;
        try {
            const r = await this.gh(`${this.ghRepoPath()}/transfer`, { method: 'POST', body: { new_owner: to } });
            this.showToast(`✅ بدأ النقل إلى ${to} (قد يحتاج قبول المالك الجديد)`, 'success');
            this.ghxUseRepo(to, info.name, this.ghRepo().branch);
            return r;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };
    P.ghxDeleteRepo = async function () {
        if (!this.ghRequireToken()) return;
        const info = await this.ghRepoInfo(true);
        if (!(await this.ghxTypeConfirm('⚠️ حذف المستودع نهائياً', `سيُحذف <b dir="ltr">${esc(info.full_name)}</b> بكل محتواه. <b>لا يمكن التراجع.</b>`, info.full_name))) return;
        try {
            await this.gh(this.ghRepoPath(), { method: 'DELETE' });
            this.showToast(`🗑️ حُذف ${info.full_name}`, 'success');
            this._ghRepoInfo = null;
            this.closeModals();
            return true;
        } catch (e) { this.showToast(e.status === 403 ? '❌ يحتاج الرمز صلاحية delete_repo' : '❌ ' + e.message, 'error'); return false; }
    };
}
