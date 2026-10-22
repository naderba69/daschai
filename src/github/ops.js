/* Actions operations: live logs (#444), artifacts (#445), runners (#446), secrets (#447),
   environments (#448), variables (#449), usage (#450). */
import { esc, call, fmtBytes } from './shared.js';
import { card, btn, empty, note, input, val } from './core.js';
import { usageByWorkflow } from './stats.js';

const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);
export const isValidSecretName = (n) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(n || '')) && !/^GITHUB_/i.test(n);

/** Strip ANSI + timestamps from a raw Actions log (pure; tested). */
export function cleanLog(text) {
    return String(text || '').replace(/\u001b\[[0-9;]*m/g, '').replace(/^\uFEFF?\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/gm, '').replace(/^##\[group\]/gm, '▸ ').replace(/^##\[endgroup\]\n?/gm, '');
}

export function installOps(P) {
    const crypto = () => import('./crypto.js');

    // ------------------------------------------------------------------ LIVE LOGS (#444)
    P.ghxLiveList = async function () {
        const runs = (await this.gh(`${this.ghRepoPath()}/actions/runs?per_page=15`)).workflow_runs || [];
        return note('اختر تشغيلاً لمتابعة خطواته وسجله مباشرة (يتحدث كل 3 ثوانٍ حتى ينتهي).')
            + (runs.length ? `<div class="gh-list">${runs.map(r => `<div class="gh-item" onclick="app.ghxLiveRun(${+r.id})" tabindex="0" data-run="${+r.id}">${this.ghStatusBadge(r.status, r.conclusion)}
                <div class="gh-item-main"><div class="gh-item-title">${esc(r.display_title || r.name)}</div><div class="gh-item-meta">${esc(r.name)} #${+r.run_number} • <span dir="ltr">${esc(r.head_branch)}</span> • ${this.ghTimeAgo(r.created_at)}</div></div>
                <i class="fa-solid fa-satellite-dish ${ACTIVE.has(r.status) ? 'text-emerald' : 'text-dim'}"></i></div>`).join('')}</div>` : empty('لا توجد تشغيلات.'));
    };

    P.ghxLiveRun = function (id, jobId) {
        clearTimeout(this._ghxLiveTimer);
        if (jobId) this._ghxLiveJob = jobId;
        return this.ghxView('ghxLiveRun', [id], async () => {
            const rp = this.ghRepoPath();
            const [run, jobsData] = await Promise.all([this.gh(`${rp}/actions/runs/${id}`), this.gh(`${rp}/actions/runs/${id}/jobs?per_page=50`)]);
            const jobs = jobsData.jobs || [];
            let job = jobs.find(j => j.id === this._ghxLiveJob) || jobs.find(j => ACTIVE.has(j.status)) || jobs.find(j => j.conclusion === 'failure') || jobs[0];
            this._ghxLiveJob = job && job.id;
            let log = '';
            let logNote = '';
            if (job && (job.status === 'completed' || job.status === 'in_progress')) {
                try {
                    const t = await this.gh(`${rp}/actions/jobs/${job.id}/logs`, { accept: 'application/vnd.github.v3.raw' });
                    if (typeof t === 'string') log = cleanLog(t).slice(-20000);
                } catch (e) { logNote = job.status === 'in_progress' ? 'السجل الكامل يتاح عند انتهاء المهمة — الخطوات أدناه تتحدث مباشرة.' : `تعذر جلب السجل (${esc(e.message)}).`; }
            }
            const active = ACTIVE.has(run.status);
            if (active) {
                this._ghxLiveTimer = setTimeout(() => { if (this.ghView && this.ghView.fn === 'ghxLiveRun' && this.ghView.args[0] === id) this.ghxLiveRun(id); }, 3000);
            }
            return `<div class="gh-detail-head"><h3>${active ? '<span class="ghx-live-dot"></span>' : ''}${esc(run.display_title || run.name)}</h3>
                    <div class="gh-item-meta">${this.ghStatusBadge(run.status, run.conclusion)} ${esc(run.name)} #${+run.run_number} • <span dir="ltr">${esc(run.head_branch)}</span> • ${this.ghTimeAgo(run.created_at)} ${active ? '• ⟳ مباشر' : ''}</div></div>
                <div class="ghx-subnav">${jobs.map(j => `<button class="gh-chip ${job && j.id === job.id ? 'active' : ''}" onclick="app.ghxLiveRun(${+id}, ${+j.id})">${this.ghStatusBadge(j.status, j.conclusion)} ${esc(j.name)}</button>`).join('')}</div>
                ${job ? `<div class="gh-card">${(job.steps || []).map(s => `<div class="gh-check-row">${this.ghStatusBadge(s.status, s.conclusion)} ${+s.number}. ${esc(s.name)}</div>`).join('') || '<div class="text-dim">لا خطوات بعد</div>'}</div>` : ''}
                ${logNote ? note(logNote) : ''}
                ${log ? `<div class="gh-toolbar">${btn('نسخ السجل', "app.ghxCopyFrom('ghx-live-log')", { icon: 'fa-copy' })}${btn('تنزيل', `app.ghxDownload(document.getElementById('ghx-live-log').textContent,'job-${job ? +job.id : 0}.log')`, { icon: 'fa-download' })}</div><pre id="ghx-live-log" class="ghx-pre ghx-log" dir="ltr">${esc(log)}</pre>` : ''}
                <a class="text-emerald" style="font-size:0.75rem" href="${esc(run.html_url)}" target="_blank" rel="noopener">فتح على GitHub ↗</a>`;
        }).then(() => { const el = document.getElementById('ghx-live-log'); if (el) el.scrollTop = el.scrollHeight; });
    };

    // ------------------------------------------------------------------ ARTIFACTS (#445)
    P.ghxArtifacts = async function () {
        const data = await this.gh(`${this.ghRepoPath()}/actions/artifacts?per_page=50`);
        const list = data.artifacts || [];
        const total = list.reduce((a, x) => a + (+x.size_in_bytes || 0), 0);
        return `<div class="gh-item-meta" style="margin-bottom:8px">${+data.total_count || list.length} artifact • ${fmtBytes(total)}</div>`
            + (list.length ? `<div class="gh-list">${list.map(a => `<div class="gh-item static" data-artifact="${+a.id}"><i class="fa-solid fa-box-archive ${a.expired ? 'text-dim' : 'text-blue'}"></i><div class="gh-item-main">
                <div class="gh-item-title" dir="ltr" style="text-align:right">${esc(a.name)} ${a.expired ? '<span class="gh-badge dim">منتهي</span>' : ''}</div>
                <div class="gh-item-meta">${fmtBytes(a.size_in_bytes)} • ${this.ghTimeAgo(a.created_at)}${a.expires_at && !a.expired ? ` • ينتهي ${this.ghTimeAgo(a.expires_at)}` : ''}${a.workflow_run ? ` • <span dir="ltr">${esc(a.workflow_run.head_branch || '')}</span>` : ''}</div></div>
                <div class="gh-item-actions">${!a.expired ? btn('', call(this, 'ghxDownloadArtifact', a), { icon: 'fa-download', title: 'تنزيل ZIP' }) : ''}${btn('', call(this, 'ghxDeleteArtifact', a.id), { icon: 'fa-trash', danger: true, title: 'حذف' })}</div></div>`).join('')}</div>` : empty('لا توجد Artifacts. أضف خطوة <code dir="ltr">actions/upload-artifact</code> لـ Workflow.'));
    };

    P.ghxDownloadArtifact = async function (a) {
        const { owner, repo } = this.ghRepo();
        const web = a.workflow_run ? `https://github.com/${owner}/${repo}/actions/runs/${a.workflow_run.id}/artifacts/${a.id}` : `https://github.com/${owner}/${repo}/actions`;
        if (!(this.settings.githubToken || '').trim()) { window.open(web, '_blank', 'noopener'); return 'web'; }
        try {
            const res = await this.ghFetch(`https://api.github.com/repos/${owner}/${repo}/actions/artifacts/${a.id}/zip`);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            this.downloadBlob(await res.blob(), `${a.name}.zip`);
            this.showToast(`✅ تم تنزيل ${a.name}.zip`, 'success');
            return 'blob';
        } catch (e) {
            // Artifact downloads redirect to storage that may refuse cross-origin reads → open GitHub's page instead
            window.open(web, '_blank', 'noopener');
            return 'web';
        }
    };
    P.ghxDeleteArtifact = async function (id) {
        if (!this.ghRequireToken()) return;
        if (!(await this.ghxConfirm('حذف Artifact', 'حذف هذا الـ Artifact نهائياً؟', { danger: true }))) return;
        try { await this.gh(`${this.ghRepoPath()}/actions/artifacts/${id}`, { method: 'DELETE' }); this.showToast('تم الحذف', 'success'); this.ghxReload(); return true; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };

    // ------------------------------------------------------------------ RUNNERS (#446)
    P.ghxRunners = async function () {
        this.ghxNeedToken('عرض الـ Runners');
        const { owner, repo } = this.ghRepo();
        const d = await this.gh(`${this.ghRepoPath()}/actions/runners?per_page=50`);
        const list = d.runners || [];
        const hosted = ['ubuntu-latest', 'ubuntu-24.04', 'windows-latest', 'macos-latest', 'macos-14 (ARM)'];
        return card('Runners مستضافة لدى GitHub', `<div class="gh-contributors">${hosted.map(h => `<span class="gh-contrib"><i class="fa-solid fa-cloud"></i> <span dir="ltr">${h}</span></span>`).join('')}</div>`, { icon: 'fa-cloud' })
            + card(`Runners ذاتية الاستضافة (${list.length})`, list.length ? list.map(r => `<div class="gh-check-row" data-runner="${+r.id}"><span class="gh-badge ${r.status === 'online' ? (r.busy ? 'run' : 'ok') : 'dim'}">${r.status === 'online' ? (r.busy ? 'مشغول' : 'متصل') : 'غير متصل'}</span>
                <b dir="ltr">${esc(r.name)}</b> <span class="text-dim" dir="ltr">${esc(r.os)}</span> ${(r.labels || []).map(l => `<span class="gh-label" style="--c:#60a5fa">${esc(l.name)}</span>`).join('')}</div>`).join('')
                : '<div class="text-dim">لا توجد Runners ذاتية. ' + `<a class="text-emerald" href="https://github.com/${esc(owner)}/${esc(repo)}/settings/actions/runners/new" target="_blank" rel="noopener">إضافة Runner ↗</a></div>`, { icon: 'fa-server' });
    };

    // ------------------------------------------------------------------ SECRETS (#447)
    P.ghxSecrets = async function () {
        this.ghxNeedToken('إدارة الـ Secrets');
        const d = await this.gh(`${this.ghRepoPath()}/actions/secrets?per_page=100`);
        const list = d.secrets || [];
        return note('القيم تُشفَّر في متصفحك (libsodium sealed box) بمفتاح المستودع العام قبل الإرسال — لا يمكن قراءتها بعد الحفظ، حتى من هنا.')
            + card('Secret جديد أو تحديث', `<div class="gh-row">${input('ghx-secret-name', { placeholder: 'API_KEY', style: 'max-width:200px' })}<input id="ghx-secret-value" type="password" class="form-input-box" placeholder="القيمة" dir="ltr" autocomplete="new-password" style="flex:1">
                ${btn('حفظ', 'app.ghxSetSecret()', { icon: 'fa-lock', primary: true })}</div>`, { icon: 'fa-key' })
            + (list.length ? `<div class="gh-list">${list.map(s => `<div class="gh-item static" data-secret="${esc(s.name)}"><i class="fa-solid fa-lock text-warning"></i><div class="gh-item-main"><div class="gh-item-title" dir="ltr" style="text-align:right">${esc(s.name)}</div>
                <div class="gh-item-meta">حُدّث ${this.ghTimeAgo(s.updated_at)}</div></div><div class="gh-item-actions">${btn('', `document.getElementById('ghx-secret-name').value=${JSON.stringify(s.name).replace(/"/g, '&quot;')}; document.getElementById('ghx-secret-value').focus()`, { icon: 'fa-pen', title: 'تحديث القيمة' })}${btn('', call(this, 'ghxDeleteSecret', s.name), { icon: 'fa-trash', danger: true, title: 'حذف' })}</div></div>`).join('')}</div>` : empty('لا توجد Secrets.'));
    };

    P.ghxSetSecret = async function (nameArg, valueArg, rpArg) {
        if (!this.ghRequireToken()) return;
        const name = (nameArg || val('ghx-secret-name')).toUpperCase();
        const value = valueArg != null ? valueArg : (document.getElementById('ghx-secret-value') || {}).value || '';
        if (!isValidSecretName(name)) { this.showToast('اسم غير صالح: أحرف إنجليزية وأرقام و _ فقط، ولا يبدأ بـ GITHUB_', 'warning'); return; }
        if (!value) { this.showToast('القيمة فارغة', 'warning'); return; }
        const rp = rpArg || this.ghRepoPath();
        try {
            const [{ sealedBox }, key] = await Promise.all([crypto(), this.gh(`${rp}/actions/secrets/public-key`)]);
            const encrypted_value = sealedBox(value, key.key);
            await this.gh(`${rp}/actions/secrets/${encodeURIComponent(name)}`, { method: 'PUT', body: { encrypted_value, key_id: key.key_id } });
            const inp = document.getElementById('ghx-secret-value');
            if (inp) inp.value = '';
            this.showToast(`✅ حُفظ السر ${name} (مشفراً)`, 'success');
            if (this.ghTab === 'ops' && !this.ghView && !rpArg) this.ghxReload();
            return true;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };
    P.ghxDeleteSecret = async function (name) {
        if (!this.ghRequireToken()) return;
        if (!(await this.ghxConfirm('حذف Secret', `حذف <b dir="ltr">${esc(name)}</b>؟ ستفشل الـ Workflows التي تستخدمه.`, { danger: true }))) return;
        try { await this.gh(`${this.ghRepoPath()}/actions/secrets/${encodeURIComponent(name)}`, { method: 'DELETE' }); this.showToast('تم الحذف', 'success'); this.ghxReload(); return true; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };

    // ------------------------------------------------------------------ ENVIRONMENTS (#448)
    P.ghxEnvironments = async function () {
        const d = await this.gh(`${this.ghRepoPath()}/environments?per_page=100`);
        const list = d.environments || [];
        return card('بيئة جديدة', `<div class="gh-row">${input('ghx-env-name', { placeholder: 'production', style: 'max-width:200px' })}<label>انتظار (دقائق)</label>${input('ghx-env-wait', { value: '0', type: 'number', style: 'max-width:90px' })}
                ${btn('إنشاء', 'app.ghxCreateEnvironment()', { icon: 'fa-plus', primary: true })}</div>`, { icon: 'fa-layer-group' })
            + (list.length ? `<div class="gh-list">${list.map(e => `<div class="gh-item static" data-env="${esc(e.name)}"><i class="fa-solid fa-layer-group text-blue"></i><div class="gh-item-main">
                <div class="gh-item-title" dir="ltr" style="text-align:right">${esc(e.name)}</div>
                <div class="gh-item-meta">${(e.protection_rules || []).map(r => `<span class="gh-badge warn">${esc(r.type === 'wait_timer' ? `انتظار ${r.wait_timer} د` : r.type === 'required_reviewers' ? 'مراجعون مطلوبون' : r.type)}</span>`).join('') || 'بدون قواعد حماية'} • ${this.ghTimeAgo(e.updated_at)}</div></div>
                <div class="gh-item-actions"><a class="sidebar-btn-util gh-btn" href="${esc(e.html_url)}" target="_blank" rel="noopener"><i class="fa-solid fa-up-right-from-square"></i></a>${btn('', call(this, 'ghxDeleteEnvironment', e.name), { icon: 'fa-trash', danger: true, title: 'حذف' })}</div></div>`).join('')}</div>` : empty('لا توجد بيئات. البيئات تتيح أسراراً ومراجعات خاصة بالنشر.'));
    };
    P.ghxCreateEnvironment = async function (nameArg, waitArg) {
        if (!this.ghRequireToken()) return;
        const name = nameArg || val('ghx-env-name');
        const wait = Math.max(0, Math.min(43200, parseInt(waitArg != null ? waitArg : val('ghx-env-wait'), 10) || 0));
        if (!name || /[/\\]/.test(name)) { this.showToast('اسم بيئة غير صالح', 'warning'); return; }
        try {
            await this.gh(`${this.ghRepoPath()}/environments/${encodeURIComponent(name)}`, { method: 'PUT', body: wait ? { wait_timer: wait } : {} });
            this.showToast(`✅ أنشئت البيئة ${name}`, 'success');
            if (this.ghTab === 'ops' && !this.ghView) this.ghxReload();
            return true;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };
    P.ghxDeleteEnvironment = async function (name) {
        if (!this.ghRequireToken()) return;
        if (!(await this.ghxConfirm('حذف بيئة', `حذف البيئة <b dir="ltr">${esc(name)}</b> وأسرارها؟`, { danger: true }))) return;
        try { await this.gh(`${this.ghRepoPath()}/environments/${encodeURIComponent(name)}`, { method: 'DELETE' }); this.showToast('تم الحذف', 'success'); this.ghxReload(); return true; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };

    // ------------------------------------------------------------------ VARIABLES (#449)
    P.ghxVariables = async function () {
        this.ghxNeedToken('إدارة المتغيرات');
        const d = await this.gh(`${this.ghRepoPath()}/actions/variables?per_page=30`);
        const list = d.variables || [];
        return note('المتغيرات غير سرية وتُقرأ في الـ Workflow بـ <code dir="ltr">${{ vars.NAME }}</code>.')
            + card('متغير جديد أو تحديث', `<div class="gh-row">${input('ghx-var-name', { placeholder: 'NODE_VERSION', style: 'max-width:200px' })}${input('ghx-var-value', { placeholder: '20', style: 'flex:1' })}
                ${btn('حفظ', 'app.ghxSetVariable()', { icon: 'fa-floppy-disk', primary: true })}</div>`, { icon: 'fa-sliders' })
            + (list.length ? `<div class="gh-list">${list.map(v => `<div class="gh-item static" data-var="${esc(v.name)}"><i class="fa-solid fa-sliders text-blue"></i><div class="gh-item-main">
                <div class="gh-item-title" dir="ltr" style="text-align:right">${esc(v.name)}</div><div class="gh-item-meta"><code dir="ltr">${esc(v.value)}</code> • ${this.ghTimeAgo(v.updated_at)}</div></div>
                <div class="gh-item-actions">${btn('', `document.getElementById('ghx-var-name').value=${JSON.stringify(v.name).replace(/"/g, '&quot;')}; document.getElementById('ghx-var-value').value=${JSON.stringify(v.value).replace(/"/g, '&quot;')}`, { icon: 'fa-pen', title: 'تعديل' })}${btn('', call(this, 'ghxDeleteVariable', v.name), { icon: 'fa-trash', danger: true, title: 'حذف' })}</div></div>`).join('')}</div>` : empty('لا توجد متغيرات.'));
    };
    P.ghxSetVariable = async function (nameArg, valueArg) {
        if (!this.ghRequireToken()) return;
        const name = (nameArg || val('ghx-var-name')).toUpperCase();
        const value = valueArg != null ? String(valueArg) : val('ghx-var-value');
        if (!isValidSecretName(name)) { this.showToast('اسم غير صالح', 'warning'); return; }
        const rp = this.ghRepoPath();
        try {
            try { await this.gh(`${rp}/actions/variables/${encodeURIComponent(name)}`, { method: 'PATCH', body: { name, value } }); } catch (e) {
                if (e.status !== 404) throw e;
                await this.gh(`${rp}/actions/variables`, { method: 'POST', body: { name, value } });
            }
            this.showToast(`✅ حُفظ ${name}`, 'success');
            if (this.ghTab === 'ops' && !this.ghView) this.ghxReload();
            return true;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };
    P.ghxDeleteVariable = async function (name) {
        if (!this.ghRequireToken()) return;
        if (!(await this.ghxConfirm('حذف متغير', `حذف <b dir="ltr">${esc(name)}</b>؟`, { danger: true }))) return;
        try { await this.gh(`${this.ghRepoPath()}/actions/variables/${encodeURIComponent(name)}`, { method: 'DELETE' }); this.showToast('تم الحذف', 'success'); this.ghxReload(); return true; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };

    // ------------------------------------------------------------------ USAGE (#450)
    P.ghxUsage = async function () {
        const rp = this.ghRepoPath();
        const [runs, cache] = await Promise.all([
            this.gh(`${rp}/actions/runs?per_page=100`).then(d => d.workflow_runs || []),
            this.gh(`${rp}/actions/cache/usage`).catch(() => null)
        ]);
        const u = usageByWorkflow(runs);
        const fails = u.rows.reduce((a, r) => a + r.failures, 0), count = u.rows.reduce((a, r) => a + r.runs, 0);
        return `<div class="gh-stats">
                <div class="gh-stat"><i class="fa-solid fa-clock"></i><b>${u.total}</b><span>دقيقة (آخر ${runs.length} تشغيل)</span></div>
                <div class="gh-stat"><i class="fa-solid fa-receipt"></i><b>${u.billable}</b><span>دقيقة مُقرّبة للفوترة</span></div>
                <div class="gh-stat"><i class="fa-solid fa-circle-xmark"></i><b>${count ? Math.round(fails / count * 100) : 0}%</b><span>نسبة الفشل</span></div>
                <div class="gh-stat"><i class="fa-solid fa-database"></i><b>${cache ? fmtBytes(cache.active_caches_size_in_bytes) : '—'}</b><span>Cache (${cache ? +cache.active_caches_count : 0})</span></div></div>
            ${card('حسب الـ Workflow', u.rows.length ? `<table class="ghx-table"><thead><tr><th>Workflow</th><th>تشغيلات</th><th>دقائق</th><th>متوسط</th><th>فشل</th></tr></thead><tbody>${u.rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.runs}</td><td>${r.minutes}</td><td>${r.avg}</td><td>${r.failures}</td></tr>`).join('')}</tbody></table>` : '<div class="text-dim">لا تشغيلات مكتملة.</div>', { icon: 'fa-table' })}
            ${note('المستودعات العامة مجانية؛ الخاصة تحصل على 2000 دقيقة/شهر في الخطة المجانية (Linux ×1، Windows ×2، macOS ×10).')}`;
    };

    // Add a «live log» button to the classic run view (05-github-hub.js) once this chunk is loaded.
    const origOpenRun = P.ghOpenRun;
    if (origOpenRun && !origOpenRun.__ghxWrapped) {
        P.ghOpenRun = async function (id) {
            const r = await origOpenRun.call(this, id);
            const bar = document.querySelector('#gh-hub-body .gh-toolbar');
            if (bar && !bar.querySelector('[data-ghx-live]')) bar.insertAdjacentHTML('beforeend', `<button class="sidebar-btn-util gh-btn" data-ghx-live onclick="app.ghxLiveRun(${+id})"><i class="fa-solid fa-satellite-dish"></i> السجل الحي</button>`);
            return r;
        };
        P.ghOpenRun.__ghxWrapped = true;
    }
}
