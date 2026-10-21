/* Gists: create (#477), manage — list/edit/star/fork/delete (#478), code → Gist (#479).
   Reuses createGist/fetchGist/parseGistId from 08-collab.js. */
import { esc, call } from './shared.js';
import { card, btn, empty, input } from './core.js';

const EXT_LANG = { js: 'JavaScript', ts: 'TypeScript', py: 'Python', html: 'HTML', css: 'CSS', json: 'JSON', md: 'Markdown', sh: 'Shell', go: 'Go', rs: 'Rust', java: 'Java', php: 'PHP', rb: 'Ruby', sql: 'SQL', yml: 'YAML', yaml: 'YAML', c: 'C', cpp: 'C++', cs: 'C#', kt: 'Kotlin', swift: 'Swift' };
const LANG_EXT = { javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', python: 'py', py: 'py', html: 'html', css: 'css', json: 'json', markdown: 'md', md: 'md', bash: 'sh', shell: 'sh', sh: 'sh', go: 'go', rust: 'rs', java: 'java', php: 'php', ruby: 'rb', sql: 'sql', yaml: 'yml', yml: 'yml', c: 'c', cpp: 'cpp', 'c++': 'cpp', csharp: 'cs', kotlin: 'kt', swift: 'swift', jsx: 'jsx', tsx: 'tsx', vue: 'vue' };

/** Pick a gist filename for a snippet (pure; tested). */
export function snippetName(code, lang) {
    const ext = LANG_EXT[String(lang || '').toLowerCase()] || (/^\s*</.test(code) ? 'html' : /^\s*[{[]/.test(code) ? 'json' : /\bdef \w+\(|^\s*import \w+$/m.test(code) ? 'py' : /\b(function|const|let|=>)\b/.test(code) ? 'js' : 'txt');
    const fn = /(?:function|def|class)\s+([A-Za-z_]\w*)/.exec(code);
    return `${fn ? fn[1] : 'snippet'}.${ext}`;
}

/** PATCH body for editing gist files (rename/delete/update) (pure; tested). */
export function gistPatch({ description, edits = [] }) {
    const files = {};
    for (const e of edits) {
        if (e.delete) files[e.name] = null;
        else files[e.name] = { ...(e.content != null ? { content: e.content } : {}), ...(e.rename && e.rename !== e.name ? { filename: e.rename } : {}) };
    }
    const body = { files };
    if (description != null) body.description = description;
    return body;
}

export function installGists(P) {
    const row = (app, g, starredView) => {
        const files = Object.keys(g.files || {});
        const langs = Array.from(new Set(Object.values(g.files || {}).map(f => f.language).filter(Boolean))).slice(0, 3);
        return `<div class="gh-item" data-gist="${esc(g.id)}" onclick="${call(app, 'ghxOpenGist', g.id)}"><i class="fa-solid ${g.public ? 'fa-note-sticky text-emerald' : 'fa-lock text-warning'}"></i>
            <div class="gh-item-main"><div class="gh-item-title">${esc(g.description || files[0] || g.id)}</div>
                <div class="gh-item-meta">${starredView && g.owner ? `<b dir="ltr">${esc(g.owner.login)}</b> • ` : ''}${files.length} ملف • ${langs.map(esc).join('، ')}${langs.length ? ' • ' : ''}${app.ghTimeAgo(g.updated_at)}${g.public ? '' : ' • سري'}</div></div>
            <div class="gh-item-actions" onclick="event.stopPropagation()">${btn('', `app.ghxCopy(${JSON.stringify(g.html_url).replace(/"/g, '&quot;')})`, { icon: 'fa-link', title: 'نسخ الرابط' })}</div></div>`;
    };
    const listView = async (app, path, starredView) => {
        app.ghxNeedToken('عرض الـ Gists');
        const f = (app._ghxGistFilter || '').toLowerCase();
        const list = await app.gh(`${path}?per_page=100`);
        const shown = f ? list.filter(g => (g.description || '').toLowerCase().includes(f) || Object.keys(g.files || {}).some(n => n.toLowerCase().includes(f))) : list;
        return `<div class="gh-toolbar">${btn('Gist جديد', 'app.ghxNewGist()', { icon: 'fa-plus', primary: true })}${btn('من ملفات المشروع', 'app.ghxProjectFilesToGist()', { icon: 'fa-folder-open' })}${btn('استيراد Gist', 'app.importGistUI()', { icon: 'fa-file-import' })}<span class="gh-spacer"></span>
                ${input('ghx-gist-filter', { value: app._ghxGistFilter || '', placeholder: '🔍 تصفية', style: 'max-width:180px', dir: 'auto' }).replace('<input ', `<input oninput="app._ghxGistFilter=this.value; clearTimeout(app._ghxGT); app._ghxGT=setTimeout(()=>app.ghxReload(),300)" `)}</div>`
            + (shown.length ? `<div class="gh-list">${shown.map(g => row(app, g, starredView)).join('')}</div>` : empty(f ? 'لا نتائج' : starredView ? 'لا توجد Gists مميزة بنجمة.' : 'لا توجد Gists بعد.'));
    };
    P.ghxGists = function () { return listView(this, '/gists', false); };
    P.ghxGistsStarred = function () { return listView(this, '/gists/starred', true); };

    // ------------------------------------------------------------------ CREATE (#477)
    P.ghxNewGist = async function (o) {
        if (!o) {
            const r = await this.showDialog({ title: 'Gist جديد', wide: true, fields: [{ id: 'description', label: 'الوصف', dir: 'auto' }, { id: 'filename', label: 'اسم الملف', value: 'snippet.js', dir: 'ltr' }, { id: 'content', type: 'textarea', rows: 12, dir: 'ltr', label: 'المحتوى' }, { id: 'public', type: 'checkbox', label: 'عام (يظهر في ملفك الشخصي)' }],
                buttons: [{ label: 'إنشاء', value: 'ok', primary: true, validate: (v) => (!v.content.trim() ? 'المحتوى فارغ' : !v.filename.trim() ? 'أدخل اسم الملف' : null) }, { label: 'إلغاء', value: null }] });
            if (!r) return null;
            o = { description: r.values.description, files: { [r.values.filename.trim()]: { content: r.values.content } }, isPublic: r.values.public };
        }
        try {
            const g = await this.createGist(o);
            this.showToast('✅ أنشئ الـ Gist', 'success');
            this.ghxCopy(g.html_url, 'أنشئ الـ Gist ونُسخ رابطه ✓');
            if (this.ghTab === 'gists') { if (this.ghView) this.ghView = null; this.ghxReload(); }
            return g;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };
    /** Code → Gist (#479): from a chat code block, the editor selection, or the active file. */
    P.ghxCodeToGist = async function (code, lang, opts = {}) {
        let text = code;
        if (text == null) {
            const ta = document.getElementById('studio-editor-textarea');
            const sel = this.getEditorSelection ? this.getEditorSelection() : (ta && ta.selectionEnd > ta.selectionStart ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : '');
            text = sel || (this.activeStudioFile && this.virtualProjectFiles.get(this.activeStudioFile) || {}).content || '';
            if (!lang && this.activeStudioFile) lang = this.activeStudioFile.split('.').pop();
        }
        if (!String(text).trim()) { this.showToast('لا يوجد كود لتحويله', 'warning'); return null; }
        const name = opts.filename || (!code && this.activeStudioFile && !lang ? this.activeStudioFile.split('/').pop() : snippetName(text, lang));
        const r = opts.silent ? { values: { filename: name, description: opts.description || '', public: !!opts.isPublic } } : await this.showDialog({ title: 'تحويل الكود إلى Gist', fields: [{ id: 'filename', label: 'اسم الملف', value: name, dir: 'ltr' }, { id: 'description', label: 'الوصف', dir: 'auto', value: opts.description || '' }, { id: 'public', type: 'checkbox', label: 'عام' }], body: `<pre class="ghx-pre" dir="ltr" style="max-height:160px">${esc(String(text).slice(0, 1500))}</pre>` });
        if (!r) return null;
        return this.ghxNewGist({ description: r.values.description, isPublic: r.values.public, files: { [r.values.filename || name]: { content: text } } });
    };
    P.ghxProjectFilesToGist = async function (paths) {
        let chosen = paths;
        if (!chosen) {
            const all = this.projectPaths().filter(p => !(this.virtualProjectFiles.get(p) || {}).dataUrl).slice(0, 60);
            if (!all.length) { this.showToast('لا توجد ملفات نصية في المشروع', 'warning'); return null; }
            const r = await this.showDialog({ title: 'Gist من ملفات المشروع', fields: [{ id: 'description', label: 'الوصف', dir: 'auto', value: 'OX-Alpha project files' }, ...all.map((p, i) => ({ id: 'f' + i, type: 'checkbox', label: p, value: p === this.activeStudioFile })), { id: 'public', type: 'checkbox', label: 'عام' }] });
            if (!r) return null;
            chosen = all.filter((p, i) => r.values['f' + i]);
            if (!chosen.length) { this.showToast('اختر ملفاً واحداً على الأقل', 'warning'); return null; }
            return this.ghxNewGist({ description: r.values.description, isPublic: r.values.public, files: this.ghxGistFilesFromPaths(chosen) });
        }
        return this.ghxNewGist({ description: 'OX-Alpha project files', isPublic: false, files: this.ghxGistFilesFromPaths(chosen) });
    };
    /** Gists are flat: "src/a.js" → "src__a.js" when names collide. */
    P.ghxGistFilesFromPaths = function (paths) {
        const files = {}, seen = new Set(paths.map(p => p.split('/').pop()));
        const dup = paths.length !== seen.size;
        for (const p of paths) files[dup ? p.replace(/\//g, '__') : p.split('/').pop()] = { content: (this.virtualProjectFiles.get(p) || {}).content || ' ' };
        return files;
    };

    // ------------------------------------------------------------------ MANAGE (#478)
    P.ghxOpenGist = function (id) {
        return this.ghxView('ghxOpenGist', [id], async () => {
            const [g, starred, viewer] = await Promise.all([this.fetchGist(id), this.gh(`/gists/${id}/star`, { allow: [404] }).then(r => !(r && r.__status === 404)).catch(() => false), this.ghViewer().catch(() => null)]);
            const mine = viewer && g.owner && viewer.login === g.owner.login;
            this._ghxGist = g;
            const files = Object.values(g.files || {});
            return `<div class="gh-detail-head"><h3>${esc(g.description || files[0]?.filename || g.id)}</h3><span class="gh-badge ${g.public ? 'ok' : 'warn'}">${g.public ? 'عام' : 'سري'}</span></div>
                <div class="gh-item-meta">${g.owner ? `<b dir="ltr">${esc(g.owner.login)}</b> • ` : ''}${files.length} ملف • عُدّل ${this.ghTimeAgo(g.updated_at)} • ${(g.history || []).length} مراجعة${g.forks && g.forks.length ? ` • ${g.forks.length} تفرع` : ''}</div>
                <div class="gh-toolbar">${btn(starred ? 'إزالة النجمة' : 'نجمة', call(this, 'ghxStarGist', id, !starred), { icon: starred ? 'fa-star-half-stroke' : 'fa-star' })}
                    ${btn('نسخ الرابط', call(this, 'ghxCopy', g.html_url), { icon: 'fa-link' })}${btn('فتح في المشروع', call(this, 'ghxGistToProject', id), { icon: 'fa-folder-plus' })}
                    ${mine ? btn('تعديل الوصف', call(this, 'ghxEditGistDescription', id), { icon: 'fa-pen' }) + btn('إضافة ملف', call(this, 'ghxEditGistFile', id, ''), { icon: 'fa-file-circle-plus' }) + btn('حذف', call(this, 'ghxDeleteGist', id), { icon: 'fa-trash', danger: true }) : btn('Fork', call(this, 'ghxForkGist', id), { icon: 'fa-code-fork' })}
                    <a class="sidebar-btn-util gh-btn" href="${esc(g.html_url)}" target="_blank" rel="noopener"><i class="fa-brands fa-github"></i> GitHub</a></div>
                ${files.map(f => card(`<span dir="ltr">${esc(f.filename)}</span> <span class="text-dim" style="font-size:0.72rem">${esc(f.language || EXT_LANG[String(f.filename).split('.').pop()] || '')}</span>`,
                    `<pre class="ghx-pre ghx-code" dir="ltr">${esc(f.truncated ? (f.content || '') + '\n…' : f.content || '')}</pre>`,
                    { icon: 'fa-file-code', actions: btn('', call(this, 'ghxCopy', f.content || ''), { icon: 'fa-copy', title: 'نسخ' }) + (mine ? btn('', call(this, 'ghxEditGistFile', id, f.filename), { icon: 'fa-pen', title: 'تحرير' }) + (files.length > 1 ? btn('', call(this, 'ghxDeleteGistFile', id, f.filename), { icon: 'fa-trash', danger: true, title: 'حذف الملف' }) : '') : '') })).join('')}`;
        });
    };
    P.ghxPatchGist = async function (id, body, okMsg) {
        try { const g = await this.gh(`/gists/${id}`, { method: 'PATCH', body }); this.showToast(okMsg || '✅ حُدّث الـ Gist', 'success'); if (this.ghTab === 'gists') this.ghxReload(); return g; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };
    P.ghxEditGistFile = async function (id, filename) {
        const g = this._ghxGist && this._ghxGist.id === id ? this._ghxGist : await this.fetchGist(id);
        const f = filename ? g.files[filename] : null;
        const r = await this.showDialog({ title: filename ? `تحرير ${filename}` : 'إضافة ملف', wide: true, fields: [{ id: 'name', label: 'اسم الملف', value: filename || 'new-file.txt', dir: 'ltr' }, { id: 'content', type: 'textarea', rows: 16, dir: 'ltr', value: (f && f.content) || '' }],
            buttons: [{ label: 'حفظ', value: 'ok', primary: true, validate: (v) => (!v.content.trim() ? 'المحتوى فارغ (لحذف الملف استخدم زر الحذف)' : null) }, { label: 'إلغاء', value: null }] });
        if (!r) return null;
        return this.ghxPatchGist(id, gistPatch({ edits: [{ name: filename || r.values.name.trim(), content: r.values.content, rename: filename ? r.values.name.trim() : undefined }] }));
    };
    P.ghxDeleteGistFile = async function (id, filename) {
        if (!(await this.ghxConfirm('حذف ملف', `حذف <b dir="ltr">${esc(filename)}</b> من الـ Gist؟`, { danger: true }))) return null;
        return this.ghxPatchGist(id, gistPatch({ edits: [{ name: filename, delete: true }] }), 'حُذف الملف');
    };
    P.ghxEditGistDescription = async function (id) {
        const g = this._ghxGist && this._ghxGist.id === id ? this._ghxGist : await this.fetchGist(id);
        const d = await this.askText('وصف الـ Gist', g.description || '', { dir: 'auto' });
        if (d == null) return null;
        return this.ghxPatchGist(id, { description: d });
    };
    P.ghxStarGist = async function (id, on) {
        try { await this.gh(`/gists/${id}/star`, { method: on ? 'PUT' : 'DELETE' }); this.showToast(on ? '⭐ أضيفت النجمة' : 'أزيلت النجمة', 'success'); if (this.ghTab === 'gists') this.ghxReload(); return true; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };
    P.ghxForkGist = async function (id) {
        try { const g = await this.gh(`/gists/${id}/forks`, { method: 'POST' }); this.showToast('✅ تم الـ Fork', 'success'); this.ghxOpenGist(g.id); return g; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };
    P.ghxDeleteGist = async function (id) {
        if (!(await this.ghxConfirm('حذف الـ Gist', 'لا يمكن التراجع عن الحذف.', { danger: true }))) return false;
        try { await this.gh(`/gists/${id}`, { method: 'DELETE' }); this.showToast('حُذف الـ Gist', 'success'); this.ghView = null; if (this.ghTab === 'gists') this.ghxReload(); return true; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };
    P.ghxGistToProject = async function (id) {
        const g = await this.fetchGist(id);
        const files = Object.values(g.files || {}).filter(f => typeof f.content === 'string').map(f => ({ path: `gists/${(g.description || id).replace(/[^\w\u0600-\u06FF-]+/g, '-').slice(0, 40)}/${f.filename.replace(/__/g, '/')}`, content: f.content }));
        files.forEach(f => this.writeProjectFile(f.path, f.content, 'import'));
        if (this.isCodeStudioOpen && this.renderStudioWorkspace) this.renderStudioWorkspace();
        this.showToast(`✅ أضيف ${files.length} ملف إلى المشروع`, 'success');
        return files.map(f => f.path);
    };

}
