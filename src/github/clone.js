/* Clone & access: ZIP (#492), Codespaces (#490 #493), VS Code (#494), clone command (#495),
   SSH/HTTPS/GH CLI options (#496), beginner guide (#497), connection check (#498),
   SSH key test (#499) and generation (#500). */
import { esc, call } from './shared.js';
import { card, btn, link, input } from './core.js';

const SSH_PUB_KEY = 'ox_alpha_ssh_pub_v1';

/** Clone commands for each protocol (pure; tested). */
export function cloneCommands(owner, repo, branch, defaultBranch) {
    const b = branch && branch !== defaultBranch ? ` --branch ${branch}` : '';
    return {
        https: `git clone${b} https://github.com/${owner}/${repo}.git`,
        ssh: `git clone${b} git@github.com:${owner}/${repo}.git`,
        gh: `gh repo clone ${owner}/${repo}${b ? ` -- ${b.trim()}` : ''}`,
        degit: `npx degit ${owner}/${repo}${branch && branch !== defaultBranch ? '#' + branch : ''} ${repo}`
    };
}

/** devcontainer.json for the detected stack (pure; tested). */
export function devcontainerFor(stack, name) {
    const image = stack.python && !stack.node ? 'mcr.microsoft.com/devcontainers/python:3.12' : stack.node ? 'mcr.microsoft.com/devcontainers/javascript-node:20' : 'mcr.microsoft.com/devcontainers/universal:2';
    const cfg = { name: name || 'dev', image, features: { 'ghcr.io/devcontainers/features/github-cli:1': {} }, customizations: { vscode: { extensions: [] } }, forwardPorts: [] };
    if (stack.node) { cfg.postCreateCommand = 'npm install'; cfg.forwardPorts.push(3000, 5173); cfg.customizations.vscode.extensions.push('dbaeumer.vscode-eslint', 'esbenp.prettier-vscode'); }
    if (stack.python) { cfg.postCreateCommand = (cfg.postCreateCommand ? cfg.postCreateCommand + ' && ' : '') + 'pip install -r requirements.txt'; cfg.customizations.vscode.extensions.push('ms-python.python'); cfg.forwardPorts.push(8000); }
    if (stack.docker) cfg.features['ghcr.io/devcontainers/features/docker-in-docker:2'] = {};
    if (stack.static && !stack.node) cfg.forwardPorts.push(8080);
    return JSON.stringify(cfg, null, 2) + '\n';
}

export function installClone(P) {
    const crypto = () => import('./crypto.js');

    // ------------------------------------------------------------------ OPTIONS
    P.ghxCloneOptions = async function () {
        const { owner, repo, branch } = this.ghRepo();
        const info = await this.ghRepoInfo().catch(() => ({ default_branch: branch, private: false }));
        const cmds = cloneCommands(owner, repo, branch, info.default_branch);
        const proto = this._ghxProto || 'https';
        this._ghxCmds = cmds;
        const zip = `https://github.com/${owner}/${repo}/archive/refs/heads/${encodeURIComponent(branch)}.zip`;
        const paths = await this.ghRepoPaths().catch(() => []);
        const stack = this.detectStack ? this.detectStack(paths) : {};
        const steps = [
            ['ثبّت Git', 'من <a class="text-emerald" href="https://git-scm.com/downloads" target="_blank" rel="noopener">git-scm.com</a> ثم تحقق: <code dir="ltr">git --version</code>'],
            ['انسخ المستودع', `<code dir="ltr">${esc(cmds[proto] || cmds.https)}</code>`],
            ['ادخل المجلد', `<code dir="ltr">cd ${esc(repo)}</code>`],
            ...(stack.node ? [['ثبّت الاعتماديات', '<code dir="ltr">npm install</code> (يتطلب Node.js)'], ['شغّل المشروع', '<code dir="ltr">npm run dev</code> أو <code dir="ltr">npm start</code>']] : []),
            ...(stack.python ? [['أنشئ بيئة افتراضية', '<code dir="ltr">python -m venv .venv && source .venv/bin/activate</code>'], ['ثبّت المتطلبات', '<code dir="ltr">pip install -r requirements.txt</code>']] : []),
            ...(!stack.node && !stack.python && stack.static ? [['افتح الموقع', 'افتح <code dir="ltr">index.html</code> في المتصفح أو شغّل <code dir="ltr">npx serve</code>']] : []),
            ['بعد التعديل', '<code dir="ltr">git add . && git commit -m "وصف التغيير" && git push</code>']
        ];
        return card('أمر الاستنساخ', `<div class="ghx-subnav">${[['https', 'HTTPS'], ['ssh', 'SSH'], ['gh', 'GitHub CLI'], ['degit', 'بدون سجل (degit)']].map(([k, l]) => `<button class="gh-chip ${k === proto ? 'active' : ''}" data-proto="${k}" onclick="app._ghxProto='${k}'; app.ghxReload()">${l}</button>`).join('')}</div>
                <div class="ghx-cmd" dir="ltr"><code id="ghx-clone-cmd">${esc(cmds[proto])}</code>${btn('', "app.ghxCopyFrom('ghx-clone-cmd')", { icon: 'fa-copy', title: 'نسخ' })}</div>
                <div class="text-dim" style="font-size:0.72rem">${{ https: 'الأسهل — يطلب اسم المستخدم ورمز PAT عند الدفع.', ssh: 'بدون كلمة مرور بعد إضافة مفتاح SSH لحسابك (تبويب «مفاتيح SSH»).', gh: 'يتطلب GitHub CLI مسجلاً (gh auth login).', degit: 'نسخة نظيفة بدون سجل Git — مثالية للقوالب.' }[proto]}</div>`, { icon: 'fa-terminal' })
            + `<div class="gh-deploy-grid">
                <a class="gh-deploy-card" href="${esc(zip)}" target="_blank" rel="noopener" data-zip><i class="fa-solid fa-file-zipper"></i><b>تحميل ZIP</b><span dir="ltr">${esc(branch)}.zip</span></a>
                <a class="gh-deploy-card" href="https://codespaces.new/${esc(owner)}/${esc(repo)}?quickstart=1&ref=${encodeURIComponent(branch)}" target="_blank" rel="noopener"><i class="fa-solid fa-laptop-code"></i><b>فتح في Codespaces</b><span>بيئة تطوير سحابية</span></a>
                <a class="gh-deploy-card" href="vscode://vscode.git/clone?url=${encodeURIComponent(`https://github.com/${owner}/${repo}.git`)}"><i class="fa-solid fa-code"></i><b>فتح في VS Code</b><span>استنساخ مباشر للتطبيق</span></a>
                <a class="gh-deploy-card" href="https://vscode.dev/github/${esc(owner)}/${esc(repo)}/tree/${encodeURIComponent(branch)}" target="_blank" rel="noopener"><i class="fa-solid fa-globe"></i><b>vscode.dev</b><span>محرر في المتصفح</span></a>
                <a class="gh-deploy-card" href="https://github.dev/${esc(owner)}/${esc(repo)}/tree/${encodeURIComponent(branch)}" target="_blank" rel="noopener"><i class="fa-brands fa-github"></i><b>github.dev</b><span>اضغط . على GitHub</span></a></div>
            ${info.private ? `<div class="gh-toolbar">${btn('تحميل ZIP (مستودع خاص)', 'app.ghxDownloadZip()', { icon: 'fa-download' })}</div>` : ''}
            ${card('تعليمات للمبتدئين', `<ol class="ghx-steps">${steps.map(([t, d]) => `<li><b>${t}</b><div>${d}</div></li>`).join('')}</ol>`, { icon: 'fa-graduation-cap' })}`;
    };

    P.ghxDownloadZip = async function () {
        const { owner, repo, branch } = this.ghRepo();
        try {
            const res = await this.ghFetch(`https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(branch)}`);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            this.downloadBlob(await res.blob(), `${repo}-${branch}.zip`);
            return true;
        } catch (e) {
            window.open(`https://github.com/${owner}/${repo}/archive/refs/heads/${encodeURIComponent(branch)}.zip`, '_blank', 'noopener');
            return false;
        }
    };

    // ------------------------------------------------------------------ CODESPACES (#490 #493)
    P.ghxCodespaces = async function () {
        const { owner, repo, branch } = this.ghRepo();
        const paths = await this.ghRepoPaths().catch(() => []);
        const has = paths.some(p => /^\.devcontainer\/(devcontainer\.json|.+\/devcontainer\.json)$/.test(p) || p === '.devcontainer.json');
        const stack = this.detectStack ? this.detectStack(paths) : {};
        let list = null;
        if ((this.settings.githubToken || '').trim()) list = await this.gh(`/repos/${owner}/${repo}/codespaces?per_page=20`).then(d => d.codespaces || []).catch(() => null);
        return card('إعداد Codespaces', `<div class="gh-row">${has ? '<span class="gh-badge ok">✓ يوجد devcontainer</span>' : '<span class="gh-badge warn">لا يوجد devcontainer</span>'}<span class="text-dim" style="font-size:0.74rem">بيئة مُعدة: ${[stack.node && 'Node.js', stack.python && 'Python', stack.docker && 'Docker'].filter(Boolean).join(' + ') || 'عامة'}</span><span class="gh-spacer"></span>
                ${btn(has ? 'استبدال الإعداد' : 'إنشاء .devcontainer', 'app.ghxAddDevcontainer()', { icon: 'fa-wand-magic-sparkles', primary: !has })}
                ${link('فتح Codespace', `https://codespaces.new/${owner}/${repo}?quickstart=1&ref=${encodeURIComponent(branch)}`, { icon: 'fa-laptop-code' })}</div>`, { icon: 'fa-laptop-code' })
            + (list ? card(`Codespaces الخاصة بك (${list.length})`, list.map(c => `<div class="gh-check-row"><span class="gh-badge ${c.state === 'Available' ? 'ok' : 'dim'}">${esc(c.state)}</span> <b>${esc(c.display_name || c.name)}</b> <span class="text-dim" dir="ltr">${esc(c.git_status && c.git_status.ref)}</span> <a class="text-emerald" href="${esc(c.web_url)}" target="_blank" rel="noopener">فتح ↗</a></div>`).join('') || '<div class="text-dim">لا توجد Codespaces لهذا المستودع.</div>', { icon: 'fa-list' }) : '');
    };
    P.ghxAddDevcontainer = async function () {
        const paths = await this.ghRepoPaths().catch(() => []);
        const stack = this.detectStack ? this.detectStack(paths) : {};
        return this.openCommitReview('.devcontainer/devcontainer.json', devcontainerFor(stack, this.ghRepo().repo), { message: 'chore: add devcontainer for Codespaces' });
    };

    // ------------------------------------------------------------------ CONNECTION CHECK (#498)
    P.ghxConnectionCheck = async function () {
        const r = this._ghxCheck;
        return card('فحص الاتصال بـ GitHub', `<div class="gh-row"><span class="text-dim" style="font-size:0.74rem">يفحص الوصول للـ API، صلاحية الرمز ونطاقاته، حد الطلبات، والوصول للمستودع والفرع.</span><span class="gh-spacer"></span>${btn('بدء الفحص', 'app.ghxRunConnectionCheck()', { icon: 'fa-stethoscope', primary: true })}</div>
            ${r ? `<div class="ghx-checks">${r.map(c => `<div class="ghx-check ${c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'warn'}" data-check="${esc(c.id)}"><i class="fa-solid ${c.ok === true ? 'fa-circle-check' : c.ok === false ? 'fa-circle-xmark' : 'fa-circle-exclamation'}"></i><b>${esc(c.label)}</b><span>${c.detail}</span></div>`).join('')}</div>` : ''}`, { icon: 'fa-stethoscope' });
    };
    P.ghxRunConnectionCheck = async function () {
        const out = [];
        const { owner, repo, branch } = this.ghRepo();
        const t0 = Date.now();
        let res = null;
        try { res = await this.ghFetch('https://api.github.com/rate_limit'); } catch (e) { res = null; }
        const ms = Date.now() - t0;
        out.push({ id: 'api', label: 'الوصول إلى api.github.com', ok: !!res, detail: res ? `${ms} ms` : 'تعذر الاتصال — تحقق من الإنترنت أو جدار الحماية' });
        if (res) {
            const token = (this.settings.githubToken || '').trim();
            if (res.status === 401) out.push({ id: 'token', label: 'رمز PAT', ok: false, detail: 'الرمز غير صالح أو منتهي' });
            else if (!token) out.push({ id: 'token', label: 'رمز PAT', ok: null, detail: 'غير مضبوط — القراءة العامة فقط (60 طلباً/ساعة)' });
            else {
                const scopes = res.headers.get('x-oauth-scopes');
                const exp = res.headers.get('github-authentication-token-expiration');
                out.push({ id: 'token', label: 'رمز PAT', ok: true, detail: (scopes != null ? `نطاقات: <code dir="ltr">${esc(scopes || '(fine-grained)')}</code>` : 'رمز Fine-grained') + (exp ? ` • ينتهي ${esc(exp)}` : '') });
                try { const u = await this.ghViewer(); out.push({ id: 'user', label: 'الحساب', ok: true, detail: `<b dir="ltr">${esc(u.login)}</b>${u.name ? ' — ' + esc(u.name) : ''}` }); } catch (e) { out.push({ id: 'user', label: 'الحساب', ok: false, detail: esc(e.message) }); }
            }
            try {
                const j = await res.json();
                const core = j.resources && j.resources.core;
                if (core) out.push({ id: 'rate', label: 'حد الطلبات', ok: core.remaining > core.limit * 0.1, detail: `${core.remaining}/${core.limit} — يتجدد ${this.ghTimeAgo(new Date(core.reset * 1000).toISOString())}` });
            } catch (e) {}
            try {
                const info = await this.ghRepoInfo(true);
                const perm = info.permissions || {};
                out.push({ id: 'repo', label: 'المستودع', ok: true, detail: `<span dir="ltr">${esc(info.full_name)}</span> • ${perm.admin ? 'مدير' : perm.push ? 'كتابة' : 'قراءة فقط'}` });
                const b = await this.gh(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`).catch(() => null);
                out.push({ id: 'branch', label: 'الفرع النشط', ok: !!b, detail: b ? `<span dir="ltr">${esc(branch)}</span> @ <code dir="ltr">${esc(String(b.commit.sha).slice(0, 7))}</code>${b.protected ? ' • محمي' : ''}` : `<span dir="ltr">${esc(branch)}</span> غير موجود` });
            } catch (e) { out.push({ id: 'repo', label: 'المستودع', ok: false, detail: `<span dir="ltr">${esc(owner)}/${esc(repo)}</span>: ${esc(e.message)}` }); }
        }
        out.push({ id: 'online', label: 'حالة الشبكة', ok: navigator.onLine !== false, detail: navigator.onLine !== false ? 'متصل' : 'غير متصل' });
        this._ghxCheck = out;
        if (this.ghTab === 'clone' && !this.ghView) await this.ghxLoad('clone', 'check');
        return out;
    };

    // ------------------------------------------------------------------ SSH KEYS (#499 #500)
    P.ghxSSH = async function () {
        const g = this._ghxNewKey;
        const savedPub = (() => { try { return localStorage.getItem(SSH_PUB_KEY) || ''; } catch (e) { return ''; } })();
        let keys = null, err = '';
        if ((this.settings.githubToken || '').trim()) { try { keys = await this.gh('/user/keys?per_page=100'); } catch (e) { err = e.message; } }
        let fps = [];
        if (keys && keys.length) { const { fingerprintOfPublicLine } = await crypto(); fps = await Promise.all(keys.map(k => fingerprintOfPublicLine(k.key))); }
        const savedFp = savedPub ? await (await crypto()).fingerprintOfPublicLine(savedPub) : null;
        const registered = savedFp && fps.includes(savedFp);
        return card('توليد مفتاح SSH جديد (Ed25519)', `<div class="gh-row">${input('ghx-ssh-comment', { value: (this._ghViewer && this._ghViewer.user && this._ghViewer.user.login ? this._ghViewer.user.login + '@' : '') + 'ox-alpha', style: 'max-width:240px' })}${btn('توليد', 'app.ghxGenerateSSHKey()', { icon: 'fa-wand-magic-sparkles', primary: true })}</div>
                <div class="text-dim" style="font-size:0.72rem">يُولَّد في متصفحك فقط. المفتاح الخاص لا يُحفظ ولا يُرسل — نزّله فوراً واحفظه في <code dir="ltr">~/.ssh/id_ed25519</code>.</div>
                ${g ? `<div class="ghx-key"><b>المفتاح العام</b> <code dir="ltr">${esc(g.fingerprint)}</code><pre id="ghx-ssh-pub" class="ghx-pre" dir="ltr">${esc(g.publicKey)}</pre>
                    <div class="gh-row">${btn('نسخ', "app.ghxCopyFrom('ghx-ssh-pub')", { icon: 'fa-copy' })}${btn('تنزيل المفتاح الخاص', 'app.ghxDownloadSSHKey()', { icon: 'fa-download', primary: true })}${btn('إضافة لحسابي', 'app.ghxAddSSHKeyToAccount()', { icon: 'fa-user-plus' })}${btn('كمفتاح نشر لهذا المستودع', 'app.ghxAddGeneratedAsDeployKey()', { icon: 'fa-key' })}</div>
                    <div class="text-dim" style="font-size:0.72rem">على Linux/macOS: <code dir="ltr">chmod 600 ~/.ssh/id_ed25519</code></div></div>` : ''}`, { icon: 'fa-key' })
            + card('اختبار مفتاح SSH', `${savedFp ? `<div class="ghx-check ${registered ? 'ok' : 'warn'}" data-check="ssh-registered"><i class="fa-solid ${registered ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i><b>آخر مفتاح ولّدته</b><span><code dir="ltr">${esc(savedFp)}</code> — ${keys ? (registered ? 'مسجل في حسابك ✓' : 'غير مسجل في حسابك') : 'أضف رمز PAT للتحقق'}</span></div>` : ''}
                <div class="ghx-cmd" dir="ltr"><code id="ghx-ssh-test">ssh -T git@github.com</code>${btn('', "app.ghxCopyFrom('ghx-ssh-test')", { icon: 'fa-copy' })}</div>
                <div class="text-dim" style="font-size:0.74rem">النتيجة المتوقعة: <code dir="ltr">Hi USERNAME! You've successfully authenticated…</code> — إن ظهر <code dir="ltr">Permission denied (publickey)</code> فأضف المفتاح لحسابك أو شغّل <code dir="ltr">ssh-add ~/.ssh/id_ed25519</code>.</div>
                ${btn('ألصق مفتاحاً عاماً لفحص بصمته', 'app.ghxCheckPublicKey()', { icon: 'fa-fingerprint' })}`, { icon: 'fa-vial' })
            + card(`مفاتيح SSH في حسابك${keys ? ` (${keys.length})` : ''}`, keys ? (keys.map((k, i) => `<div class="gh-check-row" data-ssh-key="${+k.id}"><i class="fa-solid fa-key text-warning"></i> <b>${esc(k.title || '')}</b> <code dir="ltr">${esc(fps[i] || '')}</code> <span class="text-dim">${this.ghTimeAgo(k.created_at)}</span>${btn('', call(this, 'ghxDeleteSSHKey', k.id), { icon: 'fa-trash', danger: true, title: 'حذف' })}</div>`).join('') || '<div class="text-dim">لا توجد مفاتيح.</div>')
                : `<div class="text-dim">${err ? esc(err) + ' — يحتاج الرمز صلاحية <code dir="ltr">read:public_key</code>' : 'أضف رمز PAT لعرض مفاتيحك.'}</div>`, { icon: 'fa-list' });
    };
    P.ghxGenerateSSHKey = async function (commentArg) {
        const comment = (commentArg || (document.getElementById('ghx-ssh-comment') || {}).value || 'ox-alpha').trim().replace(/\s+/g, '-');
        try {
            const { generateSSHKey } = await crypto();
            const k = await generateSSHKey(comment);
            this._ghxNewKey = { ...k, comment };
            try { localStorage.setItem(SSH_PUB_KEY, k.publicKey); } catch (e) {}
            this.showToast('🔑 وُلّد مفتاح جديد — نزّل المفتاح الخاص الآن', 'success');
            if (this.ghTab === 'clone' && !this.ghView) await this.ghxLoad('clone', 'ssh');
            return { publicKey: k.publicKey, fingerprint: k.fingerprint };
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };
    P.ghxDownloadSSHKey = function () {
        const k = this._ghxNewKey;
        if (!k) return;
        this.downloadBlob(new Blob([k.privateKey], { type: 'application/x-pem-file' }), 'id_ed25519');
        setTimeout(() => this.downloadBlob(new Blob([k.publicKey + '\n'], { type: 'text/plain' }), 'id_ed25519.pub'), 300);
    };
    P.ghxAddSSHKeyToAccount = async function () {
        const k = this._ghxNewKey;
        if (!k || !this.ghRequireToken()) return;
        try {
            await this.gh('/user/keys', { method: 'POST', body: { title: `${k.comment} (${new Date().toISOString().slice(0, 10)})`, key: k.publicKey } });
            this.showToast('✅ أضيف المفتاح لحسابك — جرّب ssh -T git@github.com', 'success');
            if (this.ghTab === 'clone' && !this.ghView) this.ghxReload();
            return true;
        } catch (e) { this.showToast(e.status === 404 || e.status === 403 ? '❌ يحتاج الرمز صلاحية write:public_key' : '❌ ' + e.message, 'error'); return false; }
    };
    P.ghxAddGeneratedAsDeployKey = async function () {
        const k = this._ghxNewKey;
        if (!k) return;
        return this.ghxAddDeployKey({ title: k.comment, key: k.publicKey, readOnly: true });
    };
    P.ghxDeleteSSHKey = async function (id) {
        if (!(await this.ghxConfirm('حذف مفتاح SSH', 'حذف المفتاح من حسابك؟', { danger: true }))) return;
        try { await this.gh(`/user/keys/${id}`, { method: 'DELETE' }); this.showToast('تم الحذف', 'success'); this.ghxReload(); return true; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };
    P.ghxCheckPublicKey = async function (line) {
        const key = line || await this.askText('فحص مفتاح عام', '', { label: 'محتوى id_ed25519.pub', placeholder: 'ssh-ed25519 AAAA…' });
        if (!key) return null;
        const { fingerprintOfPublicLine } = await crypto();
        const fp = await fingerprintOfPublicLine(key);
        if (!fp) { this.showToast('صيغة مفتاح غير صالحة', 'warning'); return null; }
        let registered = null;
        if ((this.settings.githubToken || '').trim()) {
            try { const keys = await this.gh('/user/keys?per_page=100'); registered = (await Promise.all(keys.map(k => fingerprintOfPublicLine(k.key)))).includes(fp); } catch (e) {}
        }
        this.showToast(`${fp}${registered === true ? ' — مسجل في حسابك ✓' : registered === false ? ' — غير مسجل في حسابك' : ''}`, registered === false ? 'warning' : 'info');
        return { fingerprint: fp, registered };
    };
}
