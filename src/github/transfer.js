/* Between repositories: compare two repos (#511), move files (#512), copy a folder (#513),
   clone by URL into the workspace (#491), import from GitLab/Bitbucket (#517), export the workspace
   to a new repository (#518), mirror workflow (#516). */
import { esc, encRef, encPath, parseRepoInput, isValidRepoName, fmtBytes, mapLimit, bytesFromB64 } from './shared.js';
import { card, btn, empty, note, input, select, val } from './core.js';
import { gitOps } from './gitops.js';

const MAX_FILES = 400, MAX_BYTES = 8 * 1024 * 1024, MAX_FILE = 1024 * 1024;
const TEXT_EXT = /\.(m?[jt]sx?|cjs|json|md|markdown|txt|html?|css|scss|sass|less|vue|svelte|py|rb|go|rs|java|kt|kts|c|h|cc|cpp|hpp|cs|php|swift|sh|bash|zsh|ps1|ya?ml|toml|ini|cfg|conf|env|xml|svg|sql|graphql|gql|lua|r|dart|ex|exs|erl|hs|scala|clj|gradle|properties|lock|gitignore|gitattributes|editorconfig|dockerignore|npmrc|nvmrc|prettierrc|eslintrc|babelrc|csv|tsv|tex|rst|adoc|bat|cmd|makefile|mk)$/i;
export const isTextPath = (p) => TEXT_EXT.test(p) || /(^|\/)(Dockerfile|Makefile|LICENSE|README|CHANGELOG|Procfile|Gemfile|Rakefile|CODEOWNERS)$/i.test(p);

/** Diff two path→sha maps (pure; tested). */
export function diffTrees(a, b) {
    const onlyA = [], onlyB = [], changed = [], same = [];
    for (const [p, s] of a) { if (!b.has(p)) onlyA.push(p); else if (b.get(p) !== s) changed.push(p); else same.push(p); }
    for (const p of b.keys()) if (!a.has(p)) onlyB.push(p);
    return { onlyA: onlyA.sort(), onlyB: onlyB.sort(), changed: changed.sort(), same: same.length };
}

/** Map source paths into a destination folder (pure; tested). */
export function retarget(paths, fromPrefix, toPrefix) {
    const from = String(fromPrefix || '').replace(/^\/+|\/+$/g, ''), to = String(toPrefix || '').replace(/^\/+|\/+$/g, '');
    return paths.map(p => {
        const rel = from && p.startsWith(from + '/') ? p.slice(from.length + 1) : from && p === from ? p.split('/').pop() : p;
        return { from: p, to: to ? `${to}/${rel}` : rel };
    });
}

export function installTransfer(P) {
    P.ghxTree = async function (fullName, ref) {
        const r = await this.gh(`/repos/${fullName}/git/trees/${encRef(ref)}?recursive=1`);
        return { items: (r.tree || []).filter(i => i.type === 'blob'), truncated: !!r.truncated };
    };
    P.ghxRepoMeta = async function (input) {
        const p = parseRepoInput(input);
        if (!p || p.host !== 'github.com') throw new Error(`مستودع GitHub غير صالح: ${input}`);
        const info = await this.gh(`/repos/${p.owner}/${p.repo}`);
        return { ...p, info, branch: p.branch || info.default_branch };
    };

    // ------------------------------------------------------------------ COMPARE TWO REPOS (#511)
    P.ghxRepoCompare = async function () {
        const { owner, repo } = this.ghRepo();
        const st = this._ghxCmp || { a: `${owner}/${repo}`, b: '' };
        const form = card('مقارنة مستودعين', `<div class="gh-row">${input('ghx-cmp-a', { value: st.a, placeholder: 'owner/repo', style: 'flex:1' })}<span>⇄</span>${input('ghx-cmp-b', { value: st.b, placeholder: 'owner/other-repo أو رابط', style: 'flex:1' })}
            ${btn('قارن', "app.ghxCompareRepos(document.getElementById('ghx-cmp-a').value, document.getElementById('ghx-cmp-b').value)", { icon: 'fa-code-compare', primary: true })}</div>`, { icon: 'fa-code-compare' });
        if (!st.result) return form + empty('أدخل مستودعين للمقارنة: الإحصائيات، اللغات، والملفات المختلفة.');
        const { A, B, d, la, lb } = st.result;
        const rows = [['النجوم', A.info.stargazers_count, B.info.stargazers_count], ['التفرعات', A.info.forks_count, B.info.forks_count], ['Issues مفتوحة', A.info.open_issues_count, B.info.open_issues_count],
            ['الحجم', fmtBytes(A.info.size * 1024), fmtBytes(B.info.size * 1024)], ['الملفات', A.count, B.count], ['اللغة الرئيسية', A.info.language || '—', B.info.language || '—'],
            ['الترخيص', (A.info.license && A.info.license.spdx_id) || '—', (B.info.license && B.info.license.spdx_id) || '—'], ['آخر دفع', this.ghTimeAgo(A.info.pushed_at), this.ghTimeAgo(B.info.pushed_at)]];
        const langs = Array.from(new Set([...Object.keys(la), ...Object.keys(lb)])).slice(0, 10);
        const list = (arr, cls) => arr.slice(0, 200).map(p => `<div class="ghx-path ${cls}" dir="ltr">${esc(p)}</div>`).join('') + (arr.length > 200 ? `<div class="text-dim">+${arr.length - 200}</div>` : '');
        return form + `<table class="ghx-table ghx-cmp-table"><thead><tr><th></th><th dir="ltr">${esc(A.full)}</th><th dir="ltr">${esc(B.full)}</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r[0]}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody></table>
            ${langs.length ? card('اللغات', `<table class="ghx-table"><tbody>${langs.map(l => `<tr><td>${esc(l)}</td><td>${fmtBytes(la[l] || 0)}</td><td>${fmtBytes(lb[l] || 0)}</td></tr>`).join('')}</tbody></table>`, { icon: 'fa-code' }) : ''}
            ${card(`الملفات: ${d.same} متطابق • ${d.changed.length} مختلف • ${d.onlyA.length} في الأول فقط • ${d.onlyB.length} في الثاني فقط`, `<div class="ghx-grid3"><div><b>مختلف</b>${list(d.changed, 'changed')}</div><div><b>في <span dir="ltr">${esc(A.full)}</span> فقط</b>${list(d.onlyA, 'only-a')}</div><div><b>في <span dir="ltr">${esc(B.full)}</span> فقط</b>${list(d.onlyB, 'only-b')}</div></div>`, { icon: 'fa-file-circle-question' })}`;
    };
    P.ghxCompareRepos = async function (a, b) {
        try {
            const [A, B] = await Promise.all([this.ghxRepoMeta(a), this.ghxRepoMeta(b)]);
            const [ta, tb, la, lb] = await Promise.all([this.ghxTree(A.path, A.branch), this.ghxTree(B.path, B.branch), this.gh(`/repos/${A.path}/languages`).catch(() => ({})), this.gh(`/repos/${B.path}/languages`).catch(() => ({}))]);
            const d = diffTrees(new Map(ta.items.map(i => [i.path, i.sha])), new Map(tb.items.map(i => [i.path, i.sha])));
            this._ghxCmp = { a, b, result: { A: { ...A, full: A.path, count: ta.items.length }, B: { ...B, full: B.path, count: tb.items.length }, d, la, lb } };
            if (this.ghTab === 'move' && !this.ghView) await this.ghxLoad('move', 'compare');
            return this._ghxCmp.result;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };

    // ------------------------------------------------------------------ MOVE / COPY FILES (#512 #513)
    P.ghxMoveFiles = async function () {
        const { owner, repo, branch } = this.ghRepo();
        const tree = await this.ghxTree(`${owner}/${repo}`, branch);
        const paths = tree.items.map(i => i.path);
        const dirs = Array.from(new Set(paths.flatMap(p => { const parts = p.split('/'); return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/')); }))).sort();
        this._ghxMoveTree = tree.items;
        const st = this._ghxMove || { filter: '' };
        const f = st.filter.toLowerCase();
        const shown = (f ? paths.filter(p => p.toLowerCase().includes(f)) : paths).slice(0, 300);
        return note(`المصدر: <b dir="ltr">${esc(owner)}/${esc(repo)}@${esc(branch)}</b> — تُنسخ الملفات كما هي (حتى الثنائية) عبر Git Data API.`)
            + card('نسخ مجلد كامل إلى مستودع آخر', `<div class="gh-row">${select('ghx-copy-dir', dirs.length ? dirs : [''], dirs[0] || '', { style: 'max-width:240px' })}<span>→</span>${input('ghx-copy-target', { placeholder: 'owner/target-repo', style: 'flex:1' })}${input('ghx-copy-prefix', { placeholder: 'مجلد الوجهة (اختياري)', style: 'max-width:180px' })}
                ${btn('نسخ المجلد', 'app.ghxCopyFolder()', { icon: 'fa-folder-tree', primary: true })}</div>`, { icon: 'fa-folder-tree' })
            + card('نقل/نسخ ملفات مختارة', `<div class="gh-row">${input('ghx-move-filter', { value: st.filter, placeholder: '🔍 تصفية', style: 'flex:1' }).replace('<input ', `<input oninput="app._ghxMove={filter:this.value}; clearTimeout(app._ghxMoveT); app._ghxMoveT=setTimeout(()=>app.ghxReload(),300)" `)}
                ${btn('تحديد الظاهر', "document.querySelectorAll('[data-move-path]').forEach(c=>c.checked=true)", { icon: 'fa-check-double' })}</div>
                <div class="ghx-pick">${shown.map(p => `<label class="gh-check ghx-path"><input type="checkbox" data-move-path="${esc(p)}"> <span dir="ltr">${esc(p)}</span></label>`).join('') || '<div class="text-dim">—</div>'}</div>
                ${paths.length > 300 && !f ? `<div class="text-dim" style="font-size:0.72rem">يُعرض 300 من ${paths.length} — استخدم التصفية</div>` : ''}
                <div class="gh-row" style="margin-top:8px">${input('ghx-move-target', { placeholder: 'owner/target-repo', style: 'flex:1' })}${input('ghx-move-prefix', { placeholder: 'مجلد الوجهة (اختياري)', style: 'max-width:180px' })}
                    <label class="gh-check"><input type="checkbox" id="ghx-move-delete"> حذف من المصدر (نقل)</label>${btn('تنفيذ', 'app.ghxMoveSelected()', { icon: 'fa-right-left', primary: true })}</div>`, { icon: 'fa-right-left' });
    };

    /** Copy blobs (by sha) from the active repo into another repo, then optionally delete them here. */
    P.ghxTransferFiles = async function ({ paths, target, prefix = '', fromPrefix = '', deleteSource = false, message }) {
        if (!this.ghRequireToken()) return null;
        const src = this.ghRepo();
        const T = await this.ghxRepoMeta(target);
        if (T.path.toLowerCase() === `${src.owner}/${src.repo}`.toLowerCase() && !prefix) throw new Error('الوجهة هي نفس المصدر');
        const items = new Map((this._ghxMoveTree || (await this.ghxTree(`${src.owner}/${src.repo}`, src.branch)).items).map(i => [i.path, i]));
        const plan = retarget(paths, fromPrefix, prefix);
        const files = await mapLimit(plan, 4, async ({ from, to }) => {
            const it = items.get(from);
            if (!it) throw new Error(`غير موجود: ${from}`);
            const blob = await this.gh(`/repos/${src.owner}/${src.repo}/git/blobs/${it.sha}`);
            return { path: to, content: String(blob.content || '').replace(/\n/g, ''), encoding: 'base64', mode: it.mode };
        });
        const msg = message || `chore: ${deleteSource ? 'move' : 'copy'} ${paths.length} file(s) from ${src.owner}/${src.repo}`;
        const sha = await gitOps(this, `/repos/${T.path}`).commitFiles({ branch: T.branch, files, message: msg });
        let delSha = null;
        if (deleteSource) delSha = await gitOps(this).commitFiles({ branch: src.branch, files: paths.map(p => ({ path: p, delete: true })), message: `chore: move ${paths.length} file(s) to ${T.path}` });
        this._ghPathsCache = null;
        return { target: T.path, branch: T.branch, sha, delSha, count: files.length };
    };
    P.ghxMoveSelected = async function () {
        const paths = Array.from(document.querySelectorAll('[data-move-path]')).filter(c => c.checked).map(c => c.dataset.movePath);
        const target = val('ghx-move-target'), prefix = val('ghx-move-prefix'), del = val('ghx-move-delete');
        if (!paths.length) { this.showToast('اختر ملفاً واحداً على الأقل', 'warning'); return; }
        if (!target) { this.showToast('حدد المستودع الهدف', 'warning'); return; }
        if (!(await this.ghxConfirm(del ? 'نقل الملفات' : 'نسخ الملفات', `${paths.length} ملف → <b dir="ltr">${esc(target)}${prefix ? '/' + esc(prefix) : ''}</b>${del ? '<br>⚠️ ستُحذف من المستودع الحالي بعد النسخ.' : ''}`, { danger: del }))) return;
        try {
            const r = await this.ghxTransferFiles({ paths, target, prefix, deleteSource: del });
            if (r) this.showToast(`✅ ${del ? 'نُقل' : 'نُسخ'} ${r.count} ملف إلى ${r.target}@${r.branch}`, 'success');
            this.ghxReload();
            return r;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };
    P.ghxCopyFolder = async function (dirArg, targetArg, prefixArg) {
        const dir = dirArg != null ? dirArg : val('ghx-copy-dir');
        const target = targetArg || val('ghx-copy-target');
        const prefix = prefixArg != null ? prefixArg : val('ghx-copy-prefix');
        if (!target) { this.showToast('حدد المستودع الهدف', 'warning'); return; }
        const tree = this._ghxMoveTree || (await this.ghxTree(`${this.ghRepo().owner}/${this.ghRepo().repo}`, this.ghRepo().branch)).items;
        const paths = tree.map(i => i.path).filter(p => !dir || p.startsWith(dir + '/'));
        if (!paths.length) { this.showToast('المجلد فارغ', 'warning'); return; }
        try {
            const r = await this.ghxTransferFiles({ paths, target, prefix: prefix || (dir ? dir.split('/').pop() : ''), fromPrefix: dir });
            if (r) this.showToast(`✅ نُسخ ${r.count} ملف من ${dir || '/'} إلى ${r.target}`, 'success');
            return r;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };

    // ------------------------------------------------------------------ LOAD FILES INTO THE WORKSPACE
    P.ghxLoadIntoWorkspace = async function (files, { replace = false, label = '' } = {}) {
        if (replace) this.virtualProjectFiles.clear();
        files.forEach(f => this.writeProjectFile(f.path, f.content, 'import'));
        if (this.isCodeStudioOpen && this.renderStudioWorkspace) this.renderStudioWorkspace();
        this.showToast(`✅ حُمّل ${files.length} ملف${label ? ' من ' + label : ''} في المشروع`, 'success');
        return files.length;
    };
    const pickText = (items) => {
        const out = [];
        let bytes = 0, skipped = 0;
        for (const it of items) {
            const size = +it.size || 0;
            if (!isTextPath(it.path) || size > MAX_FILE || out.length >= MAX_FILES || bytes + size > MAX_BYTES) { skipped++; continue; }
            bytes += size; out.push(it);
        }
        return { list: out, skipped, bytes };
    };

    // ------------------------------------------------------------------ CLONE BY URL (#491)
    P.ghxCloneUrl = async function () {
        return card('استنساخ مستودع GitHub إلى المشروع', `<div class="gh-row">${input('ghx-clone-url', { placeholder: 'https://github.com/owner/repo  أو  owner/repo/tree/branch', style: 'flex:1' })}${btn('استنساخ', 'app.ghxCloneByUrl()', { icon: 'fa-download', primary: true })}</div>
            <div class="gh-row"><label class="gh-check"><input type="checkbox" id="ghx-clone-replace"> استبدال ملفات المشروع الحالية</label><label class="gh-check"><input type="checkbox" id="ghx-clone-active"> اجعله المستودع النشط</label></div>
            <div class="text-dim" style="font-size:0.72rem">تُحمّل الملفات النصية فقط (حتى ${MAX_FILES} ملف و${fmtBytes(MAX_BYTES)}). الخاصة تحتاج رمز PAT.</div>`, { icon: 'fa-link' });
    };
    P.ghxCloneByUrl = async function (urlArg, opts = {}) {
        const url = urlArg || val('ghx-clone-url');
        const replace = opts.replace != null ? opts.replace : val('ghx-clone-replace');
        const makeActive = opts.active != null ? opts.active : val('ghx-clone-active');
        try {
            const M = await this.ghxRepoMeta(url);
            const tree = await this.ghxTree(M.path, M.branch);
            const { list, skipped } = pickText(tree.items);
            this.showToast(`⏳ تنزيل ${list.length} ملف من ${M.path}...`, 'info');
            const files = await mapLimit(list, 6, async (it) => {
                const b = await this.gh(`/repos/${M.path}/git/blobs/${it.sha}`);
                return { path: it.path, content: new TextDecoder().decode(bytesFromB64(b.content || '')) };
            });
            await this.ghxLoadIntoWorkspace(files, { replace, label: M.path });
            if (makeActive) this.ghxUseRepo(M.owner, M.repo, M.branch);
            if (skipped || tree.truncated) this.showToast(`ℹ️ تُخطي ${skipped} ملف (ثنائي/كبير)${tree.truncated ? ' — الشجرة مقطوعة (مستودع ضخم)' : ''}`, 'info');
            return { repo: M.path, branch: M.branch, count: files.length, skipped };
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };

    // ------------------------------------------------------------------ IMPORT GITLAB / BITBUCKET (#517)
    P.ghxImport = async function () {
        return card('استيراد من GitLab أو Bitbucket', `<div class="gh-row">${input('ghx-import-url', { placeholder: 'https://gitlab.com/group/project  أو  https://bitbucket.org/workspace/repo', style: 'flex:1' })}${input('ghx-import-ref', { placeholder: 'الفرع (اختياري)', style: 'max-width:150px' })}</div>
            <div class="gh-row">${btn('استيراد إلى المشروع', 'app.ghxImportExternal()', { icon: 'fa-file-import', primary: true })}<span class="text-dim" style="font-size:0.72rem">مستودعات عامة. بعد الاستيراد يمكنك رفعها لمستودع GitHub جديد من «تصدير لمستودع جديد».</span></div>`, { icon: 'fa-file-import' })
            + note('🦊 GitLab: <code dir="ltr">gitlab.com/api/v4</code> • 🪣 Bitbucket: <code dir="ltr">api.bitbucket.org/2.0</code> — الطلبات تتم مباشرة من متصفحك.');
    };
    P.ghxExternalList = async function (p, ref) {
        if (p.host === 'gitlab.com') {
            const id = encodeURIComponent(p.path);
            const meta = await (await fetch(`https://gitlab.com/api/v4/projects/${id}`)).json();
            if (!meta || !meta.id) throw new Error('مشروع GitLab غير موجود أو خاص');
            const branch = ref || meta.default_branch;
            const items = [];
            for (let page = 1; page <= 20; page++) {
                const res = await fetch(`https://gitlab.com/api/v4/projects/${id}/repository/tree?recursive=true&per_page=100&page=${page}&ref=${encodeURIComponent(branch)}`);
                if (!res.ok) throw new Error('GitLab HTTP ' + res.status);
                const batch = await res.json();
                batch.filter(x => x.type === 'blob').forEach(x => items.push({ path: x.path, size: 0 }));
                if (batch.length < 100) break;
            }
            return { branch, items, raw: (path) => `https://gitlab.com/api/v4/projects/${id}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(branch)}` };
        }
        if (p.host === 'bitbucket.org') {
            const base = `https://api.bitbucket.org/2.0/repositories/${p.owner}/${p.repo}`;
            const meta = await (await fetch(base)).json();
            if (!meta || meta.type === 'error') throw new Error('مستودع Bitbucket غير موجود أو خاص');
            const branch = ref || (meta.mainbranch && meta.mainbranch.name) || 'main';
            const items = [];
            let next = `${base}/src/${encodeURIComponent(branch)}/?pagelen=100&max_depth=20`;
            for (let i = 0; next && i < 30; i++) {
                const res = await fetch(next);
                if (!res.ok) throw new Error('Bitbucket HTTP ' + res.status);
                const d = await res.json();
                (d.values || []).filter(x => x.type === 'commit_file').forEach(x => items.push({ path: x.path, size: +x.size || 0 }));
                next = d.next;
            }
            return { branch, items, raw: (path) => `${base}/src/${encodeURIComponent(branch)}/${encPath(path)}` };
        }
        throw new Error('يدعم GitLab وBitbucket فقط');
    };
    P.ghxImportExternal = async function (urlArg, refArg) {
        const url = urlArg || val('ghx-import-url');
        const p = parseRepoInput(url);
        if (!p || p.host === 'github.com') { this.showToast(p ? 'لمستودعات GitHub استخدم «استنساخ برابط»' : 'رابط غير صالح', 'warning'); return null; }
        try {
            const src = await this.ghxExternalList(p, refArg != null ? refArg : (val('ghx-import-ref') || p.branch));
            const { list, skipped } = pickText(src.items);
            this.showToast(`⏳ استيراد ${list.length} ملف من ${p.host}...`, 'info');
            const files = await mapLimit(list, 6, async (it) => {
                const res = await fetch(src.raw(it.path));
                if (!res.ok) throw new Error(`${it.path}: HTTP ${res.status}`);
                return { path: it.path, content: await res.text() };
            });
            await this.ghxLoadIntoWorkspace(files, { replace: false, label: `${p.host}/${p.path}` });
            this._ghxImported = { source: `${p.host}/${p.path}`, branch: src.branch, name: p.repo };
            return { count: files.length, skipped, branch: src.branch };
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };

    // ------------------------------------------------------------------ EXPORT TO A NEW REPO (#518)
    P.ghxExport = async function () {
        const n = this.virtualProjectFiles ? this.virtualProjectFiles.size : 0;
        const suggested = (this._ghxImported && this._ghxImported.name) || 'my-new-project';
        return card('تصدير ملفات المشروع إلى مستودع GitHub جديد', `<div class="gh-form">
            <div class="gh-row"><label style="min-width:70px">الاسم</label>${input('ghx-export-name', { value: suggested, style: 'max-width:240px' })}<label class="gh-check"><input type="checkbox" id="ghx-export-private" checked> خاص</label></div>
            <div class="gh-row"><label style="min-width:70px">المالك</label>${input('ghx-export-org', { placeholder: 'حسابي (أو اسم مؤسسة)', style: 'max-width:240px' })}</div>
            <div class="gh-row"><label style="min-width:70px">الوصف</label>${input('ghx-export-desc', { dir: 'auto', style: 'flex:1', value: this._ghxImported ? `Imported from ${this._ghxImported.source}` : '' })}</div>
            <div class="gh-row"><label class="gh-check"><input type="checkbox" id="ghx-export-use" checked> اجعله المستودع النشط</label><span class="gh-spacer"></span>${btn(`إنشاء ورفع ${n} ملف`, 'app.ghxExportToNewRepo()', { icon: 'fa-file-export', primary: true, attrs: n ? '' : 'disabled' })}</div></div>`, { icon: 'fa-file-export' });
    };
    P.ghxExportToNewRepo = async function (o) {
        if (!this.ghRequireToken()) return null;
        const name = o ? o.name : val('ghx-export-name');
        const isPrivate = o ? !!o.private : val('ghx-export-private');
        const org = o ? o.org || '' : val('ghx-export-org');
        const description = o ? o.description || '' : val('ghx-export-desc');
        const use = o ? o.use !== false : val('ghx-export-use');
        if (!isValidRepoName(name)) { this.showToast('اسم مستودع غير صالح', 'warning'); return null; }
        const files = Array.from(this.virtualProjectFiles.entries()).map(([path, f]) => {
            if (f && f.dataUrl) { const m = /^data:[^;]*;base64,(.*)$/.exec(f.dataUrl); return m ? { path, content: m[1], encoding: 'base64' } : null; }
            return { path, content: (f && f.content) || '' };
        }).filter(Boolean);
        if (!files.length) { this.showToast('المشروع فارغ', 'warning'); return null; }
        try {
            const repo = await this.gh(org ? `/orgs/${encodeURIComponent(org)}/repos` : '/user/repos', { method: 'POST', body: { name, private: isPrivate, description, auto_init: true } });
            const branch = repo.default_branch || 'main';
            const sha = await gitOps(this, `/repos/${repo.full_name}`).commitFiles({ branch, files, message: `feat: initial import (${files.length} files) from OX-Alpha Workbench` });
            this.showToast(`✅ أنشئ ${repo.full_name} ورُفع ${files.length} ملف`, 'success');
            if (use) this.ghxUseRepo(repo.owner.login, repo.name, branch);
            return { repo: repo.full_name, sha, count: files.length, url: repo.html_url };
        } catch (e) { this.showToast(e.status === 422 ? '❌ يوجد مستودع بهذا الاسم' : '❌ ' + e.message, 'error'); return null; }
    };

    // ------------------------------------------------------------------ MIRROR (#516)
    P.ghxMirrorWorkflow = function (target) {
        return `name: Mirror\non:\n  push:\n    branches: ['**']\n    tags: ['**']\n  workflow_dispatch:\njobs:\n  mirror:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n      - name: Push mirror\n        env:\n          MIRROR_URL: ${target}\n          MIRROR_TOKEN: \${{ secrets.MIRROR_TOKEN }}\n        run: |\n          git remote add mirror "https://x-access-token:\${MIRROR_TOKEN}@\${MIRROR_URL#https://}"\n          git push --prune mirror '+refs/remotes/origin/*:refs/heads/*' '+refs/tags/*:refs/tags/*'\n`;
    };
    P.ghxMirror = async function () {
        return card('مرآة تلقائية (Mirror)', `<div class="text-dim" style="font-size:0.76rem;margin-bottom:6px">ينشئ Workflow يدفع كل الفروع والوسوم إلى مستودع آخر (GitHub أو GitLab أو Bitbucket) عند كل push.</div>
            <div class="gh-form"><div class="gh-row"><label style="min-width:90px">مستودع المرآة</label>${input('ghx-mirror-url', { placeholder: 'https://gitlab.com/me/project.git', style: 'flex:1' })}</div>
            <div class="gh-row"><label style="min-width:90px">رمز الوصول</label><input id="ghx-mirror-token" type="password" class="form-input-box" dir="ltr" placeholder="يُحفظ كـ Secret مشفّر باسم MIRROR_TOKEN (اختياري)" style="flex:1" autocomplete="new-password"></div>
            <div class="gh-row">${btn('إنشاء المرآة', 'app.ghxCreateMirror()', { icon: 'fa-clone', primary: true })}${btn('مستودع مرآة جديد على GitHub', "app.ghxLoad('move','export')", { icon: 'fa-plus' })}</div></div>`, { icon: 'fa-clone' });
    };
    P.ghxCreateMirror = async function (urlArg, tokenArg) {
        const url = urlArg || val('ghx-mirror-url');
        const token = tokenArg != null ? tokenArg : ((document.getElementById('ghx-mirror-token') || {}).value || '');
        if (!/^https:\/\/[^\s]+$/i.test(url)) { this.showToast('أدخل رابط HTTPS لمستودع المرآة', 'warning'); return null; }
        if (token) { const ok = await this.ghxSetSecret('MIRROR_TOKEN', token, this.ghRepoPath()); if (!ok) return null; }
        return this.openCommitReview('.github/workflows/mirror.yml', this.ghxMirrorWorkflow(url), { message: 'ci: add repository mirror workflow' });
    };
}
