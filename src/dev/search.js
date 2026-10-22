/* #134 Project-wide regex search & replace: flags (i/m/s/word), capture-group preview, VS Code style
   case operators (\U \L \u \l), preserve-case, per-match selection, include/exclude globs, batch undo. */
import { esc, call, btn, pbtn, card, empty, field, toggle, val, setHTML, ago, globMatcher, lineCol, stats } from './util.js';

/** Build the global search RegExp. Throws SyntaxError for invalid patterns. */
export function buildSearchRegex({ pattern, regex = true, caseSensitive = false, word = false, multiline = true, dotAll = false } = {}) {
    if (!pattern) throw new Error('اكتب نمط البحث');
    let src = regex ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (word) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
    const flags = 'gu' + (caseSensitive ? '' : 'i') + (multiline ? 'm' : '') + (dotAll ? 's' : '');
    return new RegExp(src, flags);
}
/** All matches of a global regex: [{ index, end, line, col, match, groups, named, lineText }]. */
export function findMatches(text, re, max = 2000) {
    const out = [];
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = r.exec(text)) && out.length < max) {
        if (m[0] === '' ) { r.lastIndex++; if (r.lastIndex > text.length) break; continue; }
        const { line, col } = lineCol(text, m.index);
        const ls = text.lastIndexOf('\n', m.index - 1) + 1, le = text.indexOf('\n', m.index);
        out.push({ index: m.index, end: m.index + m[0].length, line, col, match: m[0], groups: m.slice(1), named: m.groups || null, lineText: text.slice(ls, le < 0 ? text.length : le) });
    }
    return out;
}
/** Expand a replacement template for one match: $& $1 $<name> $$ $` $' and \U \L \E \u \l \n \t. */
export function expandReplacement(m, template, text = '') {
    let s = String(template).replace(/\$(\$|&|`|'|<([^>]+)>|(\d{1,2}))/g, (all, t, name, num) => {
        if (t === '$') return '$';
        if (t === '&') return m.match;
        if (t === '`') return text.slice(0, m.index);
        if (t === "'") return text.slice(m.end);
        if (name != null) return (m.named && m.named[name]) || '';
        const n = +num;
        if (n >= 1 && n <= m.groups.length) return m.groups[n - 1] == null ? '' : m.groups[n - 1];
        return all;
    });
    s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    // case operators
    let out = '', mode = '', once = '';
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '\\' && /[ULEul]/.test(s[i + 1] || '')) { const c = s[++i]; if (c === 'E') mode = ''; else if (c === 'U' || c === 'L') mode = c; else once = c; continue; }
        let ch = s[i];
        if (mode === 'U') ch = ch.toUpperCase(); else if (mode === 'L') ch = ch.toLowerCase();
        if (once) { ch = once === 'u' ? ch.toUpperCase() : ch.toLowerCase(); once = ''; }
        out += ch;
    }
    return out;
}
/** Mirror the original's casing on the replacement (UPPER, lower, Capitalized). */
export function preserveCase(original, rep) {
    if (!rep || !/[a-z\u00C0-\u024F]/i.test(original)) return rep;
    if (original === original.toUpperCase() && original !== original.toLowerCase()) return rep.toUpperCase();
    if (original === original.toLowerCase()) return rep.toLowerCase();
    if (original[0] === original[0].toUpperCase() && original.slice(1) === original.slice(1).toLowerCase()) return rep[0].toUpperCase() + rep.slice(1).toLowerCase();
    if (original[0] === original[0].toUpperCase()) return rep[0].toUpperCase() + rep.slice(1);
    return rep;
}
/** Replace the selected matches (indices into `matches`, default all). Returns { text, count }. */
export function replaceMatches(text, matches, template, { selected = null, keepCase = false } = {}) {
    let out = text, count = 0;
    const pick = matches.map((m, i) => [m, i]).filter(([, i]) => !selected || selected.has(i)).sort((a, b) => b[0].index - a[0].index);
    for (const [m] of pick) {
        let rep = expandReplacement(m, template, text);
        if (keepCase) rep = preserveCase(m.match, rep);
        out = out.slice(0, m.index) + rep + out.slice(m.end);
        count++;
    }
    return { text: out, count };
}
/** Search every text file. */
export function searchFiles(files, re, { include = '', exclude = '', maxPerFile = 500 } = {}) {
    const inc = globMatcher(include), exc = String(exclude || '').trim() ? globMatcher(exclude) : () => false;
    const results = [];
    for (const [path, text] of files) {
        if (!inc(path) || exc(path) || text.length > 2e6) continue;
        const matches = findMatches(text, re, maxPerFile);
        if (matches.length) results.push({ path, matches });
    }
    return results;
}

export function installSearch(P) {
    const opts = (app) => app._dvSearchOpts || (app._dvSearchOpts = { pattern: '', replace: '', regex: true, caseSensitive: false, word: false, multiline: true, dotAll: false, keepCase: false, include: '', exclude: 'node_modules/**, dist/**, *.min.js' });
    P.dvRegex = async function (o = {}) {
        const s = { ...opts(this), ...(o.pattern ? { pattern: o.pattern } : {}), ...(o.include ? { include: o.include } : {}) };
        this._dvSearchOpts = s;
        this._dvMount = () => { if (o.pattern) this.dvSearchRun(); else if (this._dvSearch) this.dvSearchRender(); };
        return card('بحث واستبدال في كل المشروع', `
            <div class="dvx-grid2">${field('dv-q', 'النمط (Regex)', s.pattern, 'dir="ltr" placeholder="(\\w+)Service" onkeydown="if(event.key===\'Enter\')app.dvSearchRun()"')}${field('dv-r', 'الاستبدال — $1 $<name> \\U$1 \\u$1', s.replace, 'dir="ltr" placeholder="$1Repository" oninput="app.dvSearchPreview()"')}</div>
            <div class="dvx-flags">${toggle('dv-f-re', 'Regex', s.regex)}${toggle('dv-f-case', 'مطابقة حالة الأحرف', s.caseSensitive)}${toggle('dv-f-word', 'كلمة كاملة', s.word)}${toggle('dv-f-m', 'متعدد الأسطر (m)', s.multiline)}${toggle('dv-f-s', 'النقطة تطابق السطر الجديد (s)', s.dotAll)}${toggle('dv-f-keep', 'حفظ حالة الأحرف', s.keepCase)}</div>
            <div class="dvx-grid2">${field('dv-inc', 'تضمين (globs)', s.include, 'dir="ltr" placeholder="src/**/*.ts"')}${field('dv-exc', 'استثناء', s.exclude, 'dir="ltr"')}</div>
            <div class="gh-row">${pbtn('fa-magnifying-glass', 'بحث', 'app.dvSearchRun()')}${btn('fa-check-double', 'تحديد الكل', 'app.dvSearchSelect(true)')}${btn('fa-square', 'إلغاء التحديد', 'app.dvSearchSelect(false)')}${btn('fa-right-left', 'استبدال المحدد', 'app.dvReplaceSelected()')}${btn('fa-rotate-left', 'تراجع عن آخر دفعة', 'app.dvUndoBatch()')}</div>
            <div id="dv-search-res">${this._dvSearch ? '' : empty('اكتب نمطاً ثم «بحث». الاستبدال يُعرض قبل التطبيق، ويمكن التراجع عن الدفعة كاملة.')}</div>`, 'fa-magnifying-glass');
    };
    P.dvSearchReadOpts = function () {
        const s = opts(this);
        if (document.getElementById('dv-q')) Object.assign(s, { pattern: val('dv-q'), replace: val('dv-r'), regex: !!val('dv-f-re'), caseSensitive: !!val('dv-f-case'), word: !!val('dv-f-word'), multiline: !!val('dv-f-m'), dotAll: !!val('dv-f-s'), keepCase: !!val('dv-f-keep'), include: val('dv-inc'), exclude: val('dv-exc') });
        return s;
    };
    P.dvSearchRun = function (override) {
        const s = { ...this.dvSearchReadOpts(), ...(override || {}) };
        if (override) { [['dv-q', 'pattern'], ['dv-r', 'replace'], ['dv-inc', 'include'], ['dv-exc', 'exclude']].forEach(([id, k]) => { const el = document.getElementById(id); if (el && override[k] != null) el.value = override[k]; }); [['dv-f-re', 'regex'], ['dv-f-case', 'caseSensitive'], ['dv-f-word', 'word']].forEach(([id, k]) => { const el = document.getElementById(id); if (el && override[k] != null) el.checked = !!override[k]; }); }
        this._dvSearchOpts = s;
        let re;
        try { re = buildSearchRegex(s); } catch (e) { setHTML('dv-search-res', empty('❌ نمط غير صالح: ' + esc(e.message), true)); return null; }
        const results = searchFiles(this.dvTextFiles(), re, s);
        this._dvSearch = { re, opts: s, results, selected: new Map(results.map(r => [r.path, new Set(r.matches.map((_, i) => i))])) };
        this.dvSearchRender();
        return this._dvSearch;
    };
    P.dvSearchRender = function () {
        const st = this._dvSearch;
        if (!st) return;
        const total = st.results.reduce((n, r) => n + r.matches.length, 0);
        const s = st.opts, hasRep = s.replace !== '' || document.getElementById('dv-r');
        const html = !st.results.length ? empty('لا توجد نتائج') : stats([['ملف', st.results.length], ['تطابق', total], ['محدد', Array.from(st.selected.values()).reduce((n, x) => n + x.size, 0)]]) + st.results.map(r => {
            const sel = st.selected.get(r.path) || new Set();
            return `<details class="dvx-file" open><summary><i class="fa-solid fa-file-code"></i> <b dir="ltr">${esc(r.path)}</b> <span class="hv-dim">${r.matches.length}</span> ${btn('fa-right-left', 'استبدال في الملف', call('dvReplaceSelected', r.path), 'gh-chip')}</summary>
                ${r.matches.slice(0, 200).map((m, i) => {
                    const rep = hasRep ? (s.keepCase ? preserveCase(m.match, expandReplacement(m, s.replace)) : expandReplacement(m, s.replace)) : null;
                    const ls = m.col - 1, before = m.lineText.slice(Math.max(0, ls - 40), ls), after = m.lineText.slice(ls + m.match.length, ls + m.match.length + 60);
                    const g = m.groups.length ? `<span class="dvx-groups">${m.groups.map((x, k) => `<code>$${k + 1}=${esc(x == null ? '∅' : x)}</code>`).join(' ')}</span>` : '';
                    return `<label class="dvx-match"><input type="checkbox" data-dv-m="${esc(r.path)}|${i}" ${sel.has(i) ? 'checked' : ''} onchange="app.dvSearchToggle(this)"><a href="#" onclick="${call('openFileAt', r.path, m.line, m.col)};return false" class="hv-dim">${m.line}:${m.col}</a>
                        <span dir="ltr" class="dvx-ctx">${esc(before)}<mark class="${rep != null ? 'dvx-old' : ''}">${esc(m.match.split('\n')[0])}</mark>${rep != null ? `<mark class="dvx-new">${esc(rep.split('\n')[0]) || '∅'}</mark>` : ''}${esc(after)}</span>${g}</label>`;
                }).join('')}${r.matches.length > 200 ? `<div class="hv-dim">… و${r.matches.length - 200} أخرى</div>` : ''}</details>`;
        }).join('');
        setHTML('dv-search-res', html);
    };
    P.dvSearchPreview = function () { if (!this._dvSearch) return; this._dvSearch.opts = { ...this._dvSearch.opts, ...this.dvSearchReadOpts() }; this.dvSearchRender(); };
    P.dvSearchToggle = function (el) {
        const [path, i] = el.dataset.dvM.split(/\|(?=\d+$)/);
        const set = this._dvSearch.selected.get(path) || new Set();
        if (el.checked) set.add(+i); else set.delete(+i);
        this._dvSearch.selected.set(path, set);
    };
    P.dvSearchSelect = function (all) {
        const st = this._dvSearch;
        if (!st) return;
        st.results.forEach(r => st.selected.set(r.path, new Set(all ? r.matches.map((_, i) => i) : [])));
        this.dvSearchRender();
    };
    /** Replace the selected matches (optionally only in one file) as one undoable batch. */
    P.dvReplaceSelected = function (onlyPath) {
        const st = this._dvSearch;
        if (!st) return null;
        const s = { ...st.opts, ...(document.getElementById('dv-r') ? { replace: val('dv-r'), keepCase: !!val('dv-f-keep') } : {}) };
        const changes = [];
        let n = 0;
        st.results.forEach(r => {
            if (onlyPath && r.path !== onlyPath) return;
            const text = this.dvRead(r.path);
            if (text == null) return;
            const fresh = findMatches(text, st.re, 100000);
            const sel = st.selected.get(r.path);
            if (!sel || !sel.size) return;
            const res = replaceMatches(text, fresh, s.replace, { selected: sel, keepCase: s.keepCase });
            if (res.count && res.text !== text) { changes.push([r.path, res.text]); n += res.count; }
        });
        if (!changes.length) { this.showToast('لا يوجد ما يُستبدل', 'info'); return null; }
        const b = this.dvApply(`استبدال «${s.pattern.slice(0, 30)}» → «${s.replace.slice(0, 30)}»`, changes);
        this.showToast(`✅ ${n} استبدال في ${changes.length} ملف — يمكن التراجع من «سجل الاستبدال»`, 'success');
        this.dvSearchRun(s);
        return { batch: b.id, files: changes.length, replaced: n };
    };
    P.dvBatches = async function () {
        const list = this._dvBatches || [];
        return card('دفعات التعديل الجماعي', list.length ? `<div class="fmx-list">${list.map(b => `<div class="fmx-item"><div><b>${esc(b.label)}</b><small>${b.files.length} ملف • ${ago(b.at)}</small><small dir="ltr">${b.files.slice(0, 6).map(f => esc(f.path)).join(' • ')}${b.files.length > 6 ? ' …' : ''}</small></div>${btn('fa-rotate-left', 'تراجع', call('dvUndoBatch', b.id) + ';app.dvRefresh()')}</div>`).join('')}</div>`
            : empty('لا توجد دفعات بعد — الاستبدال الجماعي والتحرير المتعدد وإعادة هيكلة المجلدات تُسجل هنا ويمكن التراجع عنها دفعة واحدة.'), 'fa-layer-group');
    };
}
