/* Browse tab: file properties (tags #569, like #567, rating #568, comments #566, lock #577, watch #578, hide #649,
   archive #650, shortcut #647, direct link #646), views list/kanban/timeline/calendar/map (#632-#636),
   filters #637, 10+ sort keys #638, saved searches #639, folder tree diagram #550. */
import { esc, call, btn, pbtn, chip, card, empty, fmtBytes, lsGet, lsSet, uid, extOf, baseName, dirName, kindOf, entryBytes, sha256Hex, val, isTextEntry } from './shared.js';
import { parseGeo, geoBounds, geoSVG } from './previews.js';

const SHORTCUTS = 'ox_fmx_shortcuts_v1', SAVED = 'ox_fmx_saved_searches_v1', ARCHIVE = 'ox_fmx_archive_v1';
export const STATUSES = [['todo', 'للتنفيذ'], ['doing', 'قيد العمل'], ['review', 'مراجعة'], ['done', 'منجز']];
export const KINDS = [['code', 'كود'], ['doc', 'مستندات'], ['data', 'بيانات'], ['style', 'تنسيق'], ['image', 'صور'], ['audio', 'صوت'], ['video', 'فيديو'], ['document', 'PDF/Office'], ['archive', 'أرشيف'], ['geo', 'جغرافي'], ['3d', '3D']];

/** Flatten the project into rows used by every view (pure given the inputs). */
export function fileRows(files, meta = {}, versions = new Map()) {
    return Array.from(files.entries()).map(([path, e]) => {
        const m = meta[path] || {}, size = e.size || (e.dataUrl ? Math.round(e.dataUrl.length * 0.75) : (e.content || '').length);
        const v = versions.get ? versions.get(path) || [] : [];
        return { path, name: baseName(path), ext: extOf(path), dir: dirName(path), kind: kindOf(path), size, modified: e.timestamp || 0, created: v.length ? v[0].t : (e.timestamp || 0),
            lines: isTextEntry(e) ? (e.content.match(/\n/g) || []).length + 1 : 0, depth: path.split('/').length - 1, tags: m.tags || [], like: !!m.like, rating: m.rating || 0, comments: (m.comments || []).length, status: m.status || '', locked: !!m.locked, hidden: !!m.hidden };
    });
}
/** Filter rows (#637): { q, kinds[], minKB, maxKB, from, to (YYYY-MM-DD), tag, liked, minRating, status } */
export function filterRows(rows, f = {}) {
    const q = String(f.q || '').toLowerCase().trim();
    const from = f.from ? Date.parse(f.from + 'T00:00:00') : null, to = f.to ? Date.parse(f.to + 'T23:59:59') : null;
    return rows.filter(r => (!q || r.path.toLowerCase().includes(q) || r.tags.some(t => t.toLowerCase().includes(q)))
        && (!f.kinds || !f.kinds.length || f.kinds.includes(r.kind))
        && (f.minKB == null || f.minKB === '' || r.size >= f.minKB * 1024) && (f.maxKB == null || f.maxKB === '' || r.size <= f.maxKB * 1024)
        && (from == null || r.modified >= from) && (to == null || r.modified <= to)
        && (!f.tag || r.tags.includes(f.tag)) && (!f.liked || r.like) && (!f.minRating || r.rating >= f.minRating) && (!f.status || r.status === f.status)
        && (f.showHidden || !r.hidden));
}
/** Sort keys (#638) — 12 criteria. */
export const SORT_KEYS = [['name', 'الاسم'], ['ext', 'الامتداد'], ['size', 'الحجم'], ['modified', 'آخر تعديل'], ['created', 'تاريخ الإنشاء'], ['lines', 'عدد الأسطر'], ['depth', 'العمق'], ['dir', 'المجلد'],
    ['rating', 'التقييم'], ['like', 'الإعجاب'], ['comments', 'التعليقات'], ['tags', 'عدد الوسوم']];
export function sortRows(rows, key = 'name', dir = 'asc') {
    const get = (r) => (key === 'tags' ? r.tags.length : key === 'like' ? (r.like ? 1 : 0) : r[key]);
    const s = rows.slice().sort((a, b) => { const x = get(a), y = get(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) || a.path.localeCompare(b.path); });
    return dir === 'desc' ? s.reverse() : s;
}
/** ASCII tree (#550) like `tree`. */
export function asciiTree(paths, root = '.') {
    const tree = {};
    paths.forEach(p => { let n = tree; p.split('/').forEach((part, i, arr) => { n[part] = n[part] || (i === arr.length - 1 ? null : {}); if (n[part]) n = n[part]; }); });
    const lines = [root];
    const walk = (node, prefix) => {
        const keys = Object.keys(node).sort((a, b) => (node[a] === null) - (node[b] === null) || a.localeCompare(b));
        keys.forEach((k, i) => { const last = i === keys.length - 1; lines.push(prefix + (last ? '└── ' : '├── ') + k + (node[k] ? '/' : '')); if (node[k]) walk(node[k], prefix + (last ? '    ' : '│   ')); });
    };
    walk(tree, '');
    return lines.join('\n');
}
export function mermaidTree(paths, maxNodes = 80) {
    const ids = new Map(), out = ['graph LR'];
    const id = (p) => { if (!ids.has(p)) ids.set(p, 'n' + ids.size); return ids.get(p); };
    const seen = new Set();
    for (const p of paths) {
        const parts = p.split('/');
        for (let i = 0; i < parts.length && ids.size < maxNodes; i++) {
            const cur = parts.slice(0, i + 1).join('/'), par = i ? parts.slice(0, i).join('/') : '.';
            if (seen.has(cur)) continue;
            seen.add(cur);
            out.push(`  ${id(par)}["${par === '.' ? '📦 .' : baseName(par) + '/'}"] --> ${id(cur)}["${i === parts.length - 1 ? '' : '📁 '}${parts[i].replace(/"/g, "'")}"]`);
        }
    }
    return out.join('\n');
}
/** Date of a file for the calendar (#636): name YYYY-MM-DD → front-matter date: → modified. */
export function fileDate(path, entry) {
    const m = /(\d{4})-(\d{2})-(\d{2})/.exec(baseName(path));
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const fm = entry && typeof entry.content === 'string' && /^---[\s\S]*?\ndate:\s*["']?(\d{4}-\d{2}-\d{2})/.exec(entry.content);
    if (fm) return fm[1];
    return entry && entry.timestamp ? new Date(entry.timestamp).toISOString().slice(0, 10) : null;
}
export const directLinks = (path, { owner, repo, branch }, origin = 'https://daschai.vercel.app') => ({
    github: `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`,
    raw: `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`,
    app: `${origin}/#file=${encodeURIComponent(path)}`
});

export function installMeta(P) {
    const rows = (app) => fileRows(app.virtualProjectFiles, app.fileMetaAll(), app.fileVersions || new Map());
    const filePick = (app, cur) => `<select class="form-input-box" onchange="app.fmxLoad('browse','props',{path:this.value})"><option value="">— اختر ملفاً —</option>${app.projectPaths().map(p => `<option ${p === cur ? 'selected' : ''} value="${esc(p)}">${esc(p)}</option>`).join('')}</select>`;

    // ------------------------------------------------------------------ PROPERTIES
    P.fmxProps = async function (opts = {}) {
        const path = opts.path || this._fmxPropsPath || this.activeStudioFile;
        if (!path || !this.virtualProjectFiles.has(path)) return card('خصائص الملف', filePick(this, '') + empty('اختر ملفاً لعرض وسومه وتقييمه وتعليقاته وخيارات القفل والمشاركة'));
        this._fmxPropsPath = path;
        const e = this.virtualProjectFiles.get(path), m = this.fileMeta(path), bytes = entryBytes(e);
        const sha = await sha256Hex(bytes).catch(() => '');
        const links = directLinks(path, this.ghRepo(), (typeof location !== 'undefined' && location.origin) || undefined);
        const stars = [1, 2, 3, 4, 5].map(n => `<button class="fmx-star ${n <= (m.rating || 0) ? 'on' : ''}" data-star="${n}" onclick="${call('fmxSetMeta', path, { rating: n === m.rating ? 0 : n })}" aria-label="${n}" aria-pressed="${n <= (m.rating || 0)}"><i class="fa-${n <= (m.rating || 0) ? 'solid' : 'regular'} fa-star" aria-hidden="true"></i></button>`).join('');
        const comments = (m.comments || []).map((c, i) => `<div class="fmx-comment" data-comment="${i}"><b>${esc(c.author || 'أنا')}</b> <small class="text-dim">${new Date(c.t).toLocaleString('ar')}</small>${c.line ? ` <code>L${c.line}</code>` : ''}<div dir="auto">${esc(c.text)}</div>${btn('fa-trash', '', call('fmxDeleteComment', path, i), 'gh-chip')}</div>`).join('') || '<div class="text-dim">لا تعليقات بعد</div>';
        const toggle = (key, on, icon, label) => `<label class="gh-check fmx-toggle" data-meta-toggle="${key}"><input type="checkbox" ${on ? 'checked' : ''} onchange="${call('fmxToggleMeta', path, key)}"> <i class="fa-solid ${icon}"></i> ${label}</label>`;
        return `${filePick(this, path)}
        <div class="fmx-grid2">
            ${card('المعلومات', `<div class="fmx-kv"><span>المسار</span><b dir="ltr">${esc(path)}</b><span>النوع</span><b>${esc(kindOf(path))} (.${esc(extOf(path))})</b><span>الحجم</span><b>${fmtBytes(bytes.length)}</b><span>آخر تعديل</span><b>${e.timestamp ? new Date(e.timestamp).toLocaleString('ar') : '—'}</b><span>الإصدارات</span><b>${(this.getFileVersions(path) || []).length}</b><span>SHA-256</span><code class="fmx-hash" dir="ltr">${sha.slice(0, 24)}…</code></div>`, 'fa-circle-info')}
            ${card('التقييم والإعجاب', `<div class="gh-row">${btn(m.like ? 'fa-heart' : 'fa-heart-crack', m.like ? 'أعجبني ✓' : 'إعجاب', call('fmxSetMeta', path, { like: !m.like }), 'gh-chip fmx-like' + (m.like ? ' active' : ''))}<span class="fmx-stars">${stars}</span></div>
                <div class="fmx-field"><span>الوسوم (افصل بفاصلة)</span><div class="gh-row"><input id="fmx-tags" class="form-input-box" value="${esc((m.tags || []).join(', '))}">${btn('fa-check', 'حفظ', call('fmxSaveTags', path))}${btn('fa-wand-magic-sparkles', 'اقتراح', call('fmxSuggestTags', path))}</div></div>
                ${'<div class="fmx-field"><span>الحالة (لعرض Kanban)</span><div class="gh-row">' + STATUSES.map(([id, l]) => chip(l, call('fmxSetMeta', path, { status: m.status === id ? null : id }), m.status === id)).join('') + '</div></div>'}`, 'fa-star')}
            ${card('الحماية والتنبيهات', `${toggle('locked', m.locked, 'fa-lock', 'قفل الملف (يمنع أي تعديل حتى من الذكاء الاصطناعي)')}${toggle('watch', m.watch, 'fa-bell', 'إشعار عند تعديل الملف')}${toggle('hidden', m.hidden, 'fa-eye-slash', 'إخفاء من المستكشف')}
                <div class="gh-row">${btn('fa-box-archive', 'أرشفة', call('fmxArchivePaths', [path]))}${btn('fa-link', 'اختصار', call('fmxAddShortcut', path))}</div>`, 'fa-shield')}
            ${card('روابط ومشاركة', `<div class="gh-row">${btn('fa-brands fa-github', 'رابط GitHub', call('copyText', links.github, 'تم نسخ الرابط'))}${btn('fa-file-code', 'رابط Raw', call('copyText', links.raw, 'تم نسخ الرابط'))}${btn('fa-link', 'رابط داخل التطبيق', call('copyText', links.app, 'تم نسخ الرابط'))}</div>
                <div class="gh-row">${btn('fa-share-nodes', 'رابط مشاركة / QR', call('fmxLoad', 'share', 'link', { path }))}${btn('fa-up-right-from-square', 'نافذة جديدة', call('fmxOpenWindow', path))}${btn('fa-user-lock', 'الصلاحيات', call('fmxLoad', 'share', 'perms', { path }))}</div>`, 'fa-share-nodes')}
        </div>
        ${card(`التعليقات (${(m.comments || []).length})`, `<div class="fmx-comments">${comments}</div><div class="gh-row"><input id="fmx-comment" class="form-input-box" placeholder="أضف تعليقاً..." dir="auto"><input id="fmx-comment-line" class="form-input-box" type="number" min="1" placeholder="سطر" style="width:80px">${pbtn('fa-paper-plane', 'إضافة', call('fmxAddComment', path))}</div>`, 'fa-comments')}`;
    };
    P.fmxSetMeta = function (path, patch) { const m = this.setFileMeta(path, patch); if (this._fmx && this._fmx.tab === 'browse') this.fmxRefresh(); return m; };
    P.fmxToggleMeta = async function (path, key) {
        const on = !this.fileMeta(path)[key];
        if (key === 'watch' && on && typeof Notification !== 'undefined' && Notification.permission === 'default') try { await Notification.requestPermission(); } catch (e) {}
        this.setFileMeta(path, { [key]: on });
        if (key === 'hidden' && this.renderStudioExplorer) this.renderStudioExplorer();
        this.showToast({ locked: on ? '🔒 قُفل الملف' : '🔓 فُتح الملف', watch: on ? '🔔 ستصلك إشعارات عند تعديله' : 'أوقفت المراقبة', hidden: on ? 'أُخفي من المستكشف' : 'أصبح ظاهراً' }[key] || '✓', 'success');
        return on;
    };
    P.fmxSaveTags = function (path, tagsArg) {
        const tags = Array.from(new Set((tagsArg || String(val('fmx-tags')).split(',')).map(t => String(t).trim().replace(/^#/, '')).filter(Boolean))).slice(0, 20);
        this.fmxSetMeta(path, { tags });
        return tags;
    };
    P.fmxAddComment = function (path, text, line) {
        const t = (text != null ? text : val('fmx-comment')).trim();
        if (!t) return null;
        const ln = +(line != null ? line : val('fmx-comment-line')) || null;
        const c = { text: t, t: Date.now(), author: (this.settings && this.settings.displayName) || 'أنا', line: ln };
        this.fmxSetMeta(path, { comments: [...(this.fileMeta(path).comments || []), c] });
        return c;
    };
    P.fmxDeleteComment = function (path, i) { const list = (this.fileMeta(path).comments || []).slice(); list.splice(i, 1); this.fmxSetMeta(path, { comments: list }); };

    // ------------------------------------------------------------------ FILTER BAR + SAVED SEARCHES
    const getF = (app) => (app._fmxFilter = app._fmxFilter || { q: '', kinds: [], sort: 'name', dir: 'asc' });
    const filterBar = (app) => {
        const f = getF(app), saved = lsGet(SAVED, []);
        const tags = Array.from(new Set(rows(app).flatMap(r => r.tags))).sort();
        return `<div class="fmx-filter">
            <input id="fmx-f-q" class="form-input-box" placeholder="بحث في المسار أو الوسوم..." value="${esc(f.q)}" onchange="${call('fmxSetFilter', { q: '__v' }).replace('&quot;__v&quot;', 'this.value')}">
            <div class="gh-row">${KINDS.map(([k, l]) => chip(l, call('fmxToggleKind', k), (f.kinds || []).includes(k), `data-kind="${k}"`)).join('')}</div>
            <div class="gh-row fmx-f-more">
                <label>الحجم KB <input id="fmx-f-min" type="number" class="form-input-box" value="${esc(f.minKB ?? '')}" placeholder="من"> – <input id="fmx-f-max" type="number" class="form-input-box" value="${esc(f.maxKB ?? '')}" placeholder="إلى"></label>
                <label>التاريخ <input id="fmx-f-from" type="date" class="form-input-box" value="${esc(f.from || '')}"> – <input id="fmx-f-to" type="date" class="form-input-box" value="${esc(f.to || '')}"></label>
                <select id="fmx-f-tag" class="form-input-box"><option value="">كل الوسوم</option>${tags.map(t => `<option ${t === f.tag ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
                <label class="gh-check"><input id="fmx-f-liked" type="checkbox" ${f.liked ? 'checked' : ''}> ❤️</label>
                <select id="fmx-f-rating" class="form-input-box"><option value="0">أي تقييم</option>${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${+f.minRating === n ? 'selected' : ''}>${'★'.repeat(n)}+</option>`).join('')}</select>
                ${btn('fa-filter', 'تطبيق', 'app.fmxApplyFilterForm()')}
            </div>
            <div class="gh-row"><label>ترتيب <select id="fmx-f-sort" class="form-input-box" onchange="app.fmxApplyFilterForm()">${SORT_KEYS.map(([k, l]) => `<option value="${k}" ${k === f.sort ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
                ${chip(f.dir === 'desc' ? '⬇ تنازلي' : '⬆ تصاعدي', call('fmxSetFilter', { dir: f.dir === 'desc' ? 'asc' : 'desc' }))}
                <span class="gh-spacer"></span>${saved.map(s => `<span class="fmx-saved" data-saved="${esc(s.id)}">${chip('🔖 ' + esc(s.name), call('fmxApplySaved', s.id))}<button class="gh-chip" onclick="${call('fmxDeleteSaved', s.id)}">×</button></span>`).join('')}${btn('fa-bookmark', 'حفظ البحث', 'app.fmxSaveSearch()')}${chip('مسح', call('fmxSetFilter', { q: '', kinds: [], minKB: '', maxKB: '', from: '', to: '', tag: '', liked: false, minRating: 0 }))}</div>
        </div>`;
    };
    P.fmxSetFilter = function (patch) { Object.assign(getF(this), patch); return this.fmxRefresh(); };
    P.fmxToggleKind = function (k) { const f = getF(this); f.kinds = (f.kinds || []).includes(k) ? f.kinds.filter(x => x !== k) : [...(f.kinds || []), k]; return this.fmxRefresh(); };
    P.fmxApplyFilterForm = function () {
        return this.fmxSetFilter({ q: val('fmx-f-q'), minKB: val('fmx-f-min'), maxKB: val('fmx-f-max'), from: val('fmx-f-from'), to: val('fmx-f-to'), tag: val('fmx-f-tag'), liked: !!val('fmx-f-liked'), minRating: +val('fmx-f-rating') || 0, sort: val('fmx-f-sort') || getF(this).sort });
    };
    P.fmxSaveSearch = async function (nameArg) {
        const name = nameArg || await this.askText('حفظ البحث', '', { label: 'اسم البحث', placeholder: 'صور كبيرة هذا الأسبوع' });
        if (!name) return null;
        const s = { id: uid('s'), name, filter: JSON.parse(JSON.stringify(getF(this))) };
        lsSet(SAVED, [...lsGet(SAVED, []), s]);
        this.fmxRefresh();
        return s;
    };
    P.fmxApplySaved = function (id) { const s = lsGet(SAVED, []).find(x => x.id === id); if (s) { this._fmxFilter = { ...s.filter }; return this.fmxRefresh(); } };
    P.fmxDeleteSaved = function (id) { lsSet(SAVED, lsGet(SAVED, []).filter(x => x.id !== id)); return this.fmxRefresh(); };
    P.fmxFilteredRows = function () { const f = getF(this); return sortRows(filterRows(rows(this), f), f.sort, f.dir); };

    // ------------------------------------------------------------------ VIEWS
    const openCall = (p) => call('fmxOpenPath', p);
    P.fmxOpenPath = function (p) { if (this.isBinaryProjectFile && this.isBinaryProjectFile(p) && this.openFilePreview) return this.openFilePreview({ path: p }); this.closeModals(); return this.openProjectFile(p); };
    const badges = (r) => `${r.locked ? '🔒' : ''}${r.like ? '❤️' : ''}${r.rating ? `<span class="fmx-r">${'★'.repeat(r.rating)}</span>` : ''}${r.comments ? `💬${r.comments}` : ''}${r.tags.map(t => `<span class="fmx-tag">#${esc(t)}</span>`).join('')}`;
    P.fmxViewList = function () {
        const list = this.fmxFilteredRows();
        const sc = lsGet(SHORTCUTS, []);
        return `${sc.length ? `<div class="gh-row fmx-shortcut-bar">${sc.map(s => chip('↗ ' + esc(s.name), call('fmxOpenShortcut', s.id))).join('')}</div>` : ''}${filterBar(this)}
            <div class="text-dim fmx-count">${list.length} ملف</div>
            <table class="fmx-table"><thead><tr><th>الاسم</th><th>المجلد</th><th>النوع</th><th>الحجم</th><th>آخر تعديل</th><th>أسطر</th><th></th></tr></thead><tbody>
            ${list.slice(0, 500).map(r => `<tr data-row="${esc(r.path)}"><td><a href="#" onclick="${openCall(r.path)};return false"><i class="fa-solid ${esc(this.fileIcon ? this.fileIcon(r.path) : 'fa-file')}"></i> ${esc(r.name)}</a> ${badges(r)}</td><td dir="ltr">${esc(r.dir || '/')}</td><td>${esc(r.kind)}</td><td>${fmtBytes(r.size)}</td><td>${r.modified ? new Date(r.modified).toLocaleDateString('ar') : '—'}</td><td>${r.lines || ''}</td><td>${btn('fa-tags', '', call('fmxLoad', 'browse', 'props', { path: r.path }), 'gh-chip')}</td></tr>`).join('')}
            </tbody></table>`;
    };
    P.fmxViewKanban = function () {
        const list = this.fmxFilteredRows();
        this._fmxMount = () => {
            document.querySelectorAll('.fmx-kcard').forEach(c => c.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', c.dataset.path); }));
            document.querySelectorAll('.fmx-kcol').forEach(col => {
                col.addEventListener('dragover', (ev) => ev.preventDefault());
                col.addEventListener('drop', (ev) => { ev.preventDefault(); const p = ev.dataTransfer.getData('text/plain'); if (p) this.fmxSetMeta(p, { status: col.dataset.col === 'none' ? null : col.dataset.col }); });
            });
        };
        const cols = [['none', 'بدون حالة'], ...STATUSES];
        return `<div class="text-dim">اسحب الملفات بين الأعمدة لتتبع حالة العمل عليها (تُحفظ كخاصية للملف).</div><div class="fmx-kanban">${cols.map(([id, label]) => {
            const items = list.filter(r => (r.status || 'none') === id);
            return `<div class="fmx-kcol" data-col="${id}"><div class="fmx-kcol-h">${label} <span>${items.length}</span></div>${items.slice(0, 200).map(r => `<div class="fmx-kcard" draggable="true" data-path="${esc(r.path)}"><a href="#" onclick="${openCall(r.path)};return false">${esc(r.name)}</a><small dir="ltr">${esc(r.dir)}</small><div class="gh-row">${STATUSES.filter(s => s[0] !== id).map(([s, l]) => `<button class="gh-chip" title="${l}" onclick="${call('fmxSetMeta', r.path, { status: s })}">${l}</button>`).join('')}</div></div>`).join('')}</div>`;
        }).join('')}</div>`;
    };
    P.fmxViewTimeline = function () {
        const list = sortRows(this.fmxFilteredRows(), 'modified', 'desc');
        const groups = new Map();
        list.forEach(r => { const d = r.modified ? new Date(r.modified).toISOString().slice(0, 10) : 'غير معروف'; if (!groups.has(d)) groups.set(d, []); groups.get(d).push(r); });
        return filterBar(this) + `<div class="fmx-timeline">${Array.from(groups).map(([d, items]) => `<div class="fmx-tl-day" data-day="${d}"><div class="fmx-tl-h">${d === 'غير معروف' ? d : new Date(d + 'T12:00:00').toLocaleDateString('ar', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} <span>${items.length}</span></div>
            ${items.map(r => `<div class="fmx-tl-item"><span class="fmx-tl-time">${r.modified ? new Date(r.modified).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' }) : ''}</span><a href="#" onclick="${openCall(r.path)};return false" dir="ltr">${esc(r.path)}</a> ${badges(r)}</div>`).join('')}</div>`).join('') || empty('لا ملفات')}</div>`;
    };
    P.fmxViewCalendar = function (opts = {}) {
        const now = new Date();
        const ym = opts.month || this._fmxMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        this._fmxMonth = ym;
        const [y, mo] = ym.split('-').map(Number);
        const byDay = new Map();
        for (const [p, e] of this.virtualProjectFiles) { const d = fileDate(p, e); if (d && d.startsWith(ym)) { if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(p); } }
        const first = new Date(y, mo - 1, 1), days = new Date(y, mo, 0).getDate(), lead = (first.getDay() + 1) % 7; // week starts Saturday
        const shift = (d) => { const t = new Date(y, mo - 1 + d, 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`; };
        const cells = [];
        for (let i = 0; i < lead; i++) cells.push('<div class="fmx-cal-cell off"></div>');
        for (let d = 1; d <= days; d++) {
            const key = `${ym}-${String(d).padStart(2, '0')}`, items = byDay.get(key) || [];
            cells.push(`<div class="fmx-cal-cell ${items.length ? 'has' : ''}" data-date="${key}"><b>${d}</b>${items.slice(0, 4).map(p => `<a href="#" onclick="${openCall(p)};return false" title="${esc(p)}">${esc(baseName(p))}</a>`).join('')}${items.length > 4 ? `<small>+${items.length - 4}</small>` : ''}</div>`);
        }
        return `<div class="gh-row">${btn('fa-chevron-right', '', call('fmxLoad', 'browse', 'calendar', { month: shift(-1) }), 'gh-chip')}<b class="fmx-cal-title">${first.toLocaleDateString('ar', { month: 'long', year: 'numeric' })}</b>${btn('fa-chevron-left', '', call('fmxLoad', 'browse', 'calendar', { month: shift(1) }), 'gh-chip')}<span class="text-dim">التاريخ من اسم الملف (YYYY-MM-DD) أو حقل date في الترويسة أو آخر تعديل</span></div>
            <div class="fmx-cal">${['سبت', 'أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة'].map(d => `<div class="fmx-cal-h">${d}</div>`).join('')}${cells.join('')}</div>`;
    };
    P.fmxViewMap = function () {
        const feats = [];
        for (const [p, e] of this.virtualProjectFiles) {
            if (!isTextEntry(e)) continue;
            const ext = extOf(p);
            if (!['geojson', 'gpx', 'kml', 'csv', 'json'].includes(ext)) continue;
            try { parseGeo(e.content, ext).forEach(f => feats.push({ ...f, file: p })); } catch (err) { /* not geographic */ }
        }
        if (!feats.length) return empty('لا ملفات جغرافية في المشروع (GeoJSON / GPX / KML / CSV بأعمدة lat و lon)');
        const files = Array.from(new Set(feats.map(f => f.file)));
        return `<div class="text-dim">${feats.length} معلم من ${files.length} ملف: ${files.map(f => `<a href="#" onclick="${openCall(f)};return false">${esc(f)}</a>`).join('، ')}</div>${geoSVG(feats, geoBounds(feats), { colorBy: 'file' })}`;
    };
    P.fmxTreeDiagram = function () {
        const paths = this.projectPaths().filter(p => !this.fileMeta(p).hidden);
        this._fmxTree = asciiTree(paths, (this.ghRepo && this.ghRepo().repo) || '.');
        return `<div class="gh-row">${btn('fa-copy', 'نسخ الشجرة', 'app.copyText(app._fmxTree, \'تم النسخ\')')}${btn('fa-file-circle-plus', 'إدراج في README', 'app.fmxTreeToReadme()')}${btn('fa-diagram-project', 'مخطط Mermaid', 'app.fmxTreeMermaid()')}${btn('fa-download', 'تحميل', 'app.downloadBlob(new Blob([app._fmxTree],{type:\'text/plain\'}),\'tree.txt\')')}</div>
            <pre class="fmx-tree" dir="ltr">${esc(this._fmxTree)}</pre><div id="fmx-mermaid"></div>`;
    };
    P.fmxTreeToReadme = function () {
        const block = '## 📁 هيكل المشروع\n\n```text\n' + this._fmxTree + '\n```\n';
        const cur = (this.virtualProjectFiles.get('README.md') || {}).content || '# ' + ((this.ghRepo && this.ghRepo().repo) || 'Project') + '\n';
        const next = /## 📁 هيكل المشروع\n\n```text\n[\s\S]*?\n```\n/.test(cur) ? cur.replace(/## 📁 هيكل المشروع\n\n```text\n[\s\S]*?\n```\n/, block) : cur.replace(/\s*$/, '\n\n') + block;
        this.writeProjectFile('README.md', next, 'tree');
        this.showToast('📁 أُدرجت الشجرة في README.md', 'success');
        return next;
    };
    P.fmxTreeMermaid = function () {
        const m = mermaidTree(this.projectPaths());
        const el = document.getElementById('fmx-mermaid');
        if (el) el.innerHTML = `<pre class="fmx-tree" dir="ltr">${esc('```mermaid\n' + m + '\n```')}</pre>${btn('fa-copy', 'نسخ', call('copyText', '```mermaid\n' + m + '\n```', 'تم النسخ'))}`;
        return m;
    };

    // ------------------------------------------------------------------ SHORTCUTS (#647)
    P.fmxShortcuts = function () {
        const list = lsGet(SHORTCUTS, []);
        return card('الاختصارات', `<div class="text-dim">روابط سريعة لملفات أو مجلدات أو سطر محدد — تظهر أعلى عرض القائمة.</div>
            ${list.map(s => `<div class="gh-item static" data-shortcut="${esc(s.id)}"><i class="fa-solid fa-arrow-up-right-from-square text-blue"></i><div class="gh-item-main"><b>${esc(s.name)}</b><small dir="ltr">${esc(s.path)}${s.line ? ':' + s.line : ''}</small></div>${btn('fa-play', 'فتح', call('fmxOpenShortcut', s.id), 'gh-chip')}${btn('fa-trash', '', call('fmxDeleteShortcut', s.id), 'gh-chip')}</div>`).join('') || empty('لا اختصارات بعد — أنشئها من خصائص أي ملف')}
            <div class="gh-row"><select id="fmx-sc-path" class="form-input-box">${this.projectPaths().map(p => `<option>${esc(p)}</option>`).join('')}</select><input id="fmx-sc-line" type="number" min="1" placeholder="سطر" class="form-input-box" style="width:80px">${pbtn('fa-plus', 'اختصار', 'app.fmxAddShortcut(document.getElementById(\'fmx-sc-path\').value, null, +document.getElementById(\'fmx-sc-line\').value||null)')}</div>`, 'fa-link');
    };
    P.fmxAddShortcut = async function (path, nameArg, line = null) {
        const name = nameArg || await this.askText('إنشاء اختصار', baseName(path), { label: 'اسم الاختصار' });
        if (!name) return null;
        const s = { id: uid('sc'), name, path, line };
        lsSet(SHORTCUTS, [...lsGet(SHORTCUTS, []), s]);
        this.showToast('↗ أُنشئ الاختصار', 'success');
        if (this._fmx && this._fmx.tab === 'browse') this.fmxRefresh();
        return s;
    };
    P.fmxOpenShortcut = function (id) {
        const s = lsGet(SHORTCUTS, []).find(x => x.id === id);
        if (!s) return;
        if (!this.virtualProjectFiles.has(s.path)) { this.showToast('الملف لم يعد موجوداً', 'warning'); return; }
        this.fmxOpenPath(s.path);
        const ed = s.line && document.getElementById('studio-editor-textarea');
        if (ed) { const lines = ed.value.split('\n'), pos = lines.slice(0, s.line - 1).reduce((n, l) => n + l.length + 1, 0); try { ed.focus(); ed.setSelectionRange(pos, pos + (lines[s.line - 1] || '').length); ed.scrollTop = Math.max(0, (s.line - 5) * 20); } catch (e) {} }
        return s;
    };
    P.fmxDeleteShortcut = function (id) { lsSet(SHORTCUTS, lsGet(SHORTCUTS, []).filter(x => x.id !== id)); return this.fmxRefresh(); };

    // ------------------------------------------------------------------ ARCHIVE (#650) + HIDDEN (#649)
    const archiveList = async (app) => (app.idbGet ? (await app.idbGet(ARCHIVE).catch(() => null)) : null) || lsGet(ARCHIVE, []);
    const saveArchive = async (app, list) => { if (app.idbSet) { try { await app.idbSet(ARCHIVE, list); return; } catch (e) {} } lsSet(ARCHIVE, list); };
    P.fmxArchivePaths = async function (paths) {
        const list = await archiveList(this);
        const done = [];
        this._fmxUnlock = true;
        try {
            for (const p of paths) {
                const e = this.virtualProjectFiles.get(p);
                if (!e) continue;
                list.unshift({ path: p, entry: e, meta: this.fileMeta(p), at: Date.now() });
                this.virtualProjectFiles.delete(p);
                this.setFileMeta(p, { locked: null, watch: null, hidden: null, tags: null, comments: null, rating: null, like: null, status: null });
                done.push(p);
            }
        } finally { this._fmxUnlock = false; }
        await saveArchive(this, list);
        if (this.renderStudioExplorer) this.renderStudioExplorer();
        this.showToast(`🗄️ أُرشف ${done.length} ملف`, 'success');
        if (this._fmx && this._fmx.tab === 'browse') this.fmxLoad('browse', 'archive');
        return done;
    };
    P.fmxRestoreArchived = async function (path) {
        const list = await archiveList(this);
        const i = list.findIndex(x => x.path === path);
        if (i < 0) return false;
        const [it] = list.splice(i, 1);
        const target = this.virtualProjectFiles.has(it.path) && this.uniqueProjectPath ? this.uniqueProjectPath(it.path) : it.path;
        this.virtualProjectFiles.set(target, { ...it.entry, timestamp: Date.now() });
        if (it.meta) this.setFileMeta(target, it.meta);
        await saveArchive(this, list);
        if (this.renderStudioExplorer) this.renderStudioExplorer();
        this.showToast(`↩️ استُعيد ${this.escapeHTML(target)}`, 'success');
        if (this._fmx && this._fmx.tab === 'browse') this.fmxRefresh();
        return target;
    };
    P.fmxArchive = async function () {
        const list = await archiveList(this);
        const hidden = this.projectPaths().filter(p => this.fileMeta(p).hidden);
        return `${card(`الأرشيف (${list.length})`, list.map(x => `<div class="gh-item static" data-archived="${esc(x.path)}"><i class="fa-solid fa-box-archive text-dim"></i><div class="gh-item-main"><b dir="ltr">${esc(x.path)}</b><small>${new Date(x.at).toLocaleString('ar')}</small></div>${btn('fa-rotate-left', 'استعادة', call('fmxRestoreArchived', x.path), 'gh-chip')}</div>`).join('') || empty('الأرشيف فارغ — الملفات المؤرشفة تخرج من المشروع وتبقى محفوظة هنا'), 'fa-box-archive')}
            ${card(`الملفات المخفية (${hidden.length})`, hidden.map(p => `<div class="gh-item static" data-hidden="${esc(p)}"><i class="fa-solid fa-eye-slash text-dim"></i><div class="gh-item-main"><b dir="ltr">${esc(p)}</b></div>${btn('fa-eye', 'إظهار', call('fmxToggleMeta', p, 'hidden'), 'gh-chip')}</div>`).join('') || empty('لا ملفات مخفية'), 'fa-eye-slash')}`;
    };
}
