/* Refactor tab: #241 multi-file edit • #242 refactor a whole folder • #246 file from template • #247 folder from
   template • #248 duplicate file/folder • #250 zip a folder. Every change is previewed and applied as one undoable batch. */
import { esc, card, pbtn, btn, empty, setHTML, stats, table, call, lsGet, lsSet, uid, baseName, dirName, extOf, globMatcher, lineDiff, diffCounts, diffHTML, CASES } from './util.js';
import { resolveSpec, relSpec } from './quality.js';
import { buildSearchRegex, findMatches, replaceMatches } from './search.js';

const TPL_KEY = 'ox_dv_templates_v1';
const SPEC_RE = /((?:import\s[^'"]*?from\s*|import\s*\(\s*|require\(\s*|export\s[^'"]*?from\s*|@import\s+(?:url\()?)['"])(\.{1,2}\/[^'"]+)(['"])/g;
const HTML_REF = /(<(?:script|img|link|a|source)\b[^>]*\b(?:src|href)=["'])(?!https?:|data:|\/\/|#|mailto:)([^"']+)(["'])/gi;
const SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|build)\//;

/** Variables available in templates for a given name. */
export function templateVars(name, extra = {}) {
    const n = String(name || 'item').replace(/\.[^.]+$/, '');
    return { name: n, Name: CASES.pascal(n) || n, NAME: CASES.upper(n) || n, name_kebab: CASES.kebab(n) || n, name_snake: CASES.snake(n) || n, name_camel: CASES.camel(n) || n, date: new Date().toISOString().slice(0, 10), year: String(new Date().getFullYear()), ...extra };
}
/** {{var}} substitution (unknown vars are kept). Supports {{ name | kebab }} filters. */
export function renderTemplate(str, vars) {
    return String(str || '').replace(/\{\{\s*([\w.]+)\s*(?:\|\s*(\w+)\s*)?\}\}/g, (m, k, f) => {
        if (vars[k] == null) return m;
        const v = String(vars[k]);
        return f && CASES[f] ? CASES[f](v) : f === 'lower' ? v.toLowerCase() : v;
    });
}
/** Turn concrete text back into a template by replacing every casing of `name` with the matching variable. */
export function templatize(text, name) {
    const v = templateVars(name);
    const pairs = [['Name', v.Name], ['name_kebab', v.name_kebab], ['name_snake', v.name_snake], ['name_camel', v.name_camel], ['NAME', v.NAME], ['name', v.name]]
        .filter(([, x]) => x && x.length > 1).sort((a, b) => b[1].length - a[1].length);
    const seen = new Set();
    let out = String(text);
    pairs.forEach(([k, x]) => { if (seen.has(x)) return; seen.add(x); out = out.split(x).join(`{{${k}}}`); });
    return out;
}
/**
 * Plan moving/renaming files while keeping relative imports working.
 * files: Map(path → text|null for binary). moves: [[from, to]]. Returns [[path, newText|{entry-move}|null]] + stats.
 */
export function planMoves(files, moves) {
    const map = new Map(moves);
    const newPath = (p) => map.get(p) || p;
    const has = (p) => files.has(p);
    const out = new Map();
    let rewired = 0;
    for (const [p, text] of files) {
        if (text == null) continue;
        const np = newPath(p);
        let changed = text;
        if (/\.(m?[jt]sx?|cjs|mts|cts|vue|svelte|css|scss|less)$/.test(p)) {
            changed = text.replace(SPEC_RE, (m, a, spec, b) => {
                const target = resolveSpec(p, spec, has);
                if (!target) return m;
                const nt = newPath(target);
                if (nt === target && np === p) return m;
                let ns = relSpec(np, nt);
                if (/\.(css|scss|less|json|svg|png)$/.test(spec) || /\.(m?js|cjs)$/.test(spec) && /\.(m?js|cjs)$/.test(nt)) { const keepExt = (spec.match(/\.[^./]+$/) || [''])[0]; if (keepExt && !ns.endsWith(keepExt)) ns = ns.replace(/(\.[^./]+)?$/, '') + keepExt; }
                if (ns.endsWith('/index') && !spec.endsWith('index')) ns = ns.slice(0, -6) || '.';
                if (ns === spec) return m;
                rewired++;
                return a + ns + b;
            });
        } else if (/\.html?$/.test(p)) {
            changed = text.replace(HTML_REF, (m, a, ref, b) => {
                const clean = ref.split(/[?#]/)[0];
                const target = resolveSpec(p, clean.startsWith('.') ? clean : './' + clean, has);
                if (!target) return m;
                const nt = newPath(target);
                if (nt === target && np === p) return m;
                let ns = relSpec(np, nt);
                if (!ns.endsWith(extOf(nt)) && extOf(nt)) ns = ns.replace(/\/index$/, '/index') + (ns.endsWith('.' + extOf(nt)) ? '' : '.' + extOf(nt));
                ns = ns.replace(/^\.\//, '');
                rewired++;
                return a + ns + ref.slice(clean.length) + b;
            });
        }
        if (np !== p) out.set(np, { text: changed, from: p });
        else if (changed !== text) out.set(p, { text: changed });
    }
    for (const [from, to] of moves) if (!out.has(to)) out.set(to, { from, binary: true });
    const changes = [];
    out.forEach((v, p) => changes.push([p, v]));
    const targets = new Set(moves.map(m => m[1]));
    moves.forEach(([from]) => { if (!targets.has(from)) changes.push([from, null]); });
    return { changes, rewired };
}
/** Rename a whole-word identifier (JS-ish word boundaries, Unicode-aware). */
export function renameSymbol(text, from, to) {
    if (!from || from === to) return { text, count: 0 };
    const re = new RegExp(`(?<![\\p{L}\\p{N}_$])${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_$])`, 'gu');
    let count = 0;
    const out = String(text).replace(re, () => { count++; return to; });
    return { text: out, count };
}
/** index.(js|ts) barrel re-exporting every module of a folder. */
export function barrelFor(dir, paths, ts = false) {
    const mods = paths.filter(p => dirName(p) === dir && /\.(m?[jt]sx?)$/.test(p) && !/(^|\/)index\.[jt]sx?$/.test(p) && !/\.(test|spec|d)\.[jt]sx?$/.test(p)).sort();
    return { path: (dir ? dir + '/' : '') + (ts ? 'index.ts' : 'index.js'), text: mods.map(p => `export * from './${baseName(p).replace(/\.[^.]+$/, '')}';`).join('\n') + '\n', count: mods.length };
}
/** Rename a path's file name to a casing (keeps extension and .test/.module suffixes). */
export function casePath(p, kind) {
    const b = baseName(p), m = /^([^.]+)(\..+)?$/.exec(b);
    if (!m || !CASES[kind]) return p;
    const nb = (CASES[kind](m[1]) || m[1]) + (m[2] || '');
    return (dirName(p) ? dirName(p) + '/' : '') + nb;
}

export function installRefactor(P) {
    P.dvFileMap = function () { const m = new Map(); for (const [p, f] of this.virtualProjectFiles) m.set(p, f && typeof f.content === 'string' && !f.dataUrl && !f.binary ? f.content : null); return m; };
    P.dvFolders = function () {
        const s = new Set(this.projectFolders || []);
        for (const p of this.virtualProjectFiles.keys()) { const parts = p.split('/'); for (let i = 1; i < parts.length; i++) s.add(parts.slice(0, i).join('/')); }
        return Array.from(s).filter(d => d && !SKIP_DIRS.test(d + '/')).sort();
    };
    /** Apply a planMoves() result as a single batch. */
    P.dvApplyPlan = function (label, plan) {
        const changes = plan.changes.map(([p, v]) => {
            if (v === null) return [p, null];
            if (v.binary || v.text == null) return [p, { entry: this.virtualProjectFiles.get(v.from), from: v.from }];
            if (v.from) return [p, { entry: { ...(this.virtualProjectFiles.get(v.from) || {}), content: v.text, lang: extOf(p) }, from: v.from }];
            return [p, v.text];
        });
        // write targets before deleting sources
        changes.sort((a, b) => (a[1] === null) - (b[1] === null));
        return this.dvApply(label, changes);
    };
    const previewHTML = (rows) => (rows.length ? table(['الملف', 'التغيير', ''], rows.map((r, i) => [`<span dir="ltr">${esc(r.label || r.path)}</span>`, r.kind === 'move' ? '↪ نقل' : r.kind === 'delete' ? '🗑' : `<span class="dvx-good">+${r.add}</span> <span class="dvx-bad">−${r.del}</span>`, r.kind === 'edit' ? btn('fa-eye', '', call('dvRfShow', i), 'gh-chip', 'title="معاينة"') : ''])) : empty('لا توجد تغييرات'));
    P.dvRfPreview = function (label, edits, holder) {
        this._dvRf = { label, edits };
        const rows = edits.map(([p, v]) => {
            if (v === null) return { path: p, kind: 'delete' };
            if (v && typeof v === 'object') return { path: p, label: `${v.from} → ${p}`, kind: 'move' };
            const c = diffCounts(lineDiff(this.dvRead(p) || '', v, 2e5));
            return { path: p, kind: 'edit', ...c };
        });
        setHTML(holder, stats([['ملفات', edits.length]]) + previewHTML(rows) + (edits.length ? `<div class="gh-row">${pbtn('fa-check', 'تطبيق كدفعة واحدة', 'app.dvRfApply()')}</div><div id="dv-rf-diff"></div>` : ''));
        return rows;
    };
    P.dvRfShow = function (i) { const e = this._dvRf && this._dvRf.edits[i]; if (!e || typeof e[1] !== 'string') return; setHTML('dv-rf-diff', card(`<span dir="ltr">${esc(e[0])}</span>`, diffHTML(lineDiff(this.dvRead(e[0]) || '', e[1])), 'fa-code-compare')); };
    P.dvRfApply = function () {
        const r = this._dvRf;
        if (!r || !r.edits.length) return null;
        const b = r.plan ? this.dvApplyPlan(r.label, r.plan) : this.dvApply(r.label, r.edits);
        this._dvRf = null;
        this.showToast(`✅ ${this.escapeHTML(r.label)}: ${r.edits.length} ملف — يمكن التراجع من «سجل الاستبدال»`, 'success');
        this.dvRefresh();
        return b;
    };

    // ---------------------------------------------------------------- #241 multi-file edit
    P.dvMultiEdit = async function () {
        const o = this._dvMe || (this._dvMe = { glob: 'src/**', op: 'replace' });
        const ops = [['replace', 'بحث واستبدال'], ['rename', 'إعادة تسمية معرّف'], ['header', 'إضافة ترويسة أعلى الملف'], ['footer', 'إضافة تذييل'], ['import', 'إضافة سطر import إن لم يوجد'], ['strip', 'حذف أسطر تطابق نمطاً'], ['ai', 'تعليمات للذكاء الاصطناعي']];
        const files = this.dvTextFiles(globMatcher(o.glob)).filter(([p]) => !SKIP_DIRS.test(p));
        return card('تحرير متعدد الملفات', `<p class="hv-dim">طبّق تعديلاً واحداً على مجموعة ملفات تختارها بنمط glob، مع معاينة الفروق قبل التطبيق.</p>
            <div class="gh-row"><label class="fmx-field"><span>الملفات (glob)</span><input id="dv-me-glob" class="form-input-box" dir="ltr" value="${esc(o.glob)}" onchange="app._dvMe.glob=this.value;app.dvRefresh()"></label>
            <label class="fmx-field"><span>العملية</span><select id="dv-me-op" class="form-input-box" onchange="app._dvMe.op=this.value;app.dvRefresh()">${ops.map(([v, l]) => `<option value="${v}" ${v === o.op ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
            <small class="hv-dim">${files.length} ملف مطابق${files.length ? ': ' + files.slice(0, 8).map(f => esc(f[0])).join('، ') + (files.length > 8 ? '…' : '') : ''}</small>
            ${o.op === 'replace' ? `<div class="dvx-grid2"><input id="dv-me-a" class="form-input-box" dir="ltr" placeholder="ابحث عن (Regex مدعوم)"><input id="dv-me-b" class="form-input-box" dir="ltr" placeholder="استبدل بـ ($1 …)"></div><div class="dvx-flags"><label class="pfx-toggle"><input type="checkbox" id="dv-me-re"><span>Regex</span></label><label class="pfx-toggle"><input type="checkbox" id="dv-me-case"><span>مطابقة الحالة</span></label></div>`
            : o.op === 'rename' ? `<div class="dvx-grid2"><input id="dv-me-a" class="form-input-box" dir="ltr" placeholder="الاسم الحالي"><input id="dv-me-b" class="form-input-box" dir="ltr" placeholder="الاسم الجديد"></div>`
            : o.op === 'strip' ? `<input id="dv-me-a" class="form-input-box" dir="ltr" placeholder="Regex للأسطر المراد حذفها، مثل: ^\\s*console\\.log">`
            : o.op === 'ai' ? `<textarea id="dv-me-a" class="form-input-box" rows="3" placeholder="مثال: أضف JSDoc لكل دالة مصدّرة"></textarea><small class="hv-dim">يُرسل كل ملف (حتى 20 ملفاً، 12 ألف حرف لكل ملف) إلى النموذج.</small>`
            : `<textarea id="dv-me-a" class="form-input-box" dir="ltr" rows="3" placeholder="${o.op === 'import' ? "import { t } from './i18n';" : '// © {{year}} — {{name}}'}"></textarea><small class="hv-dim">متغيرات: {{name}} {{path}} {{date}} {{year}}</small>`}
            <div class="gh-row">${pbtn('fa-eye', 'معاينة', 'app.dvMultiEditPreview()')}</div><div id="dv-me-res"></div>`, 'fa-pen-to-square');
    };
    /** Compute edits for the multi-edit form (pure-ish; exposed for tests). */
    P.dvMultiEditPlan = async function ({ glob, op, a, b, regex = false, matchCase = false }) {
        const files = this.dvTextFiles(globMatcher(glob)).filter(([p]) => !SKIP_DIRS.test(p));
        const edits = [];
        if (op === 'ai') {
            for (const [p, text] of files.slice(0, 20)) {
                if (text.length > 12000) continue;
                const ans = await this.dvAI(`Apply this instruction to the file and return ONLY the complete updated file in one code block.\nInstruction: ${a}\nFile: ${p}\n\`\`\`\n${text}\n\`\`\``, { quiet: true, maxTokens: 6000 });
                const m = ans && /```[\w-]*\n([\s\S]*?)```/.exec(ans);
                const out = m ? m[1] : null;
                if (out != null && out.trim() && out !== text) edits.push([p, out.endsWith('\n') || !text.endsWith('\n') ? out : out + '\n']);
            }
            return edits;
        }
        files.forEach(([p, text]) => {
            const vars = templateVars(baseName(p), { path: p });
            let out = text;
            if (op === 'replace') { if (!a) return; const re = buildSearchRegex({ pattern: a, regex, caseSensitive: matchCase }); out = replaceMatches(text, findMatches(text, re), regex ? (b || '') : String(b || '').replace(/\$/g, '$$$$')).text; }
            else if (op === 'rename') out = renameSymbol(text, a, b).text;
            else if (op === 'header') { const h = renderTemplate(a, vars); if (h && !text.startsWith(h)) out = h.replace(/\n?$/, '\n') + text; }
            else if (op === 'footer') { const f = renderTemplate(a, vars); if (f && !text.trimEnd().endsWith(f.trim())) out = text.replace(/\n?$/, '\n') + f.replace(/\n?$/, '\n'); }
            else if (op === 'import') { const line = renderTemplate(a, vars).trim(); if (line && !text.includes(line)) { const lines = text.split('\n'); let at = 0; lines.forEach((l, i) => { if (/^\s*(import\s|const\s+\w+\s*=\s*require\()/.test(l)) at = i + 1; }); if (/^['"]use strict['"]/.test(lines[0]) && !at) at = 1; lines.splice(at, 0, line); out = lines.join('\n'); } }
            else if (op === 'strip') { if (!a) return; let re; try { re = new RegExp(a); } catch (e) { throw new Error('Regex غير صالح: ' + e.message); } out = text.split('\n').filter(l => !re.test(l)).join('\n'); }
            if (out !== text) edits.push([p, out]);
        });
        return edits;
    };
    P.dvMultiEditPreview = async function () {
        const o = this._dvMe;
        const v = (id) => (document.getElementById(id) || {}).value || '';
        const chk = (id) => !!(document.getElementById(id) || {}).checked;
        this.dvBusy('dv-me-res');
        try {
            const edits = await this.dvMultiEditPlan({ glob: v('dv-me-glob') || o.glob, op: o.op, a: v('dv-me-a'), b: v('dv-me-b'), regex: chk('dv-me-re'), matchCase: chk('dv-me-case') });
            this.dvRfPreview('تحرير متعدد: ' + o.op, edits, 'dv-me-res');
            return edits;
        } catch (e) { return this.dvErr(e, 'dv-me-res'); }
    };

    // ---------------------------------------------------------------- #242 folder refactor
    P.dvFolder = async function () {
        const folders = this.dvFolders();
        const o = this._dvFo || (this._dvFo = { dir: folders[0] || '', op: 'move' });
        const ops = [['move', 'نقل / إعادة تسمية المجلد (مع تحديث الاستيرادات)'], ['case', 'توحيد أسماء الملفات (kebab / camel / Pascal / snake)'], ['barrel', 'إنشاء index يعيد تصدير كل الوحدات'], ['flatten', 'تسطيح المجلدات الفرعية'], ['ai', 'إعادة هيكلة بالذكاء الاصطناعي']];
        const inDir = this.projectPaths().filter(p => p.startsWith(o.dir + '/'));
        return card('إعادة هيكلة مجلد كامل', `<p class="hv-dim">عمليات على مستوى المجلد تحافظ على عمل المشروع: كل نقل أو إعادة تسمية يحدّث مسارات <code>import / require / @import</code> و <code>src/href</code> في HTML تلقائياً.</p>
            <div class="gh-row"><label class="fmx-field"><span>المجلد</span><select id="dv-fo-dir" class="form-input-box" dir="ltr" onchange="app._dvFo.dir=this.value;app.dvRefresh()">${folders.map(d => `<option ${d === o.dir ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></label>
            <label class="fmx-field"><span>العملية</span><select class="form-input-box" onchange="app._dvFo.op=this.value;app.dvRefresh()">${ops.map(([v, l]) => `<option value="${v}" ${v === o.op ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
            <small class="hv-dim">${inDir.length} ملف في المجلد</small>
            ${o.op === 'move' ? `<input id="dv-fo-to" class="form-input-box" dir="ltr" placeholder="المسار الجديد، مثل: src/features/${esc(baseName(o.dir))}" value="${esc(o.dir)}">`
            : o.op === 'case' ? `<select id="dv-fo-case" class="form-input-box">${Object.keys(CASES).filter(k => k !== 'upper').map(k => `<option>${k}</option>`).join('')}</select>`
            : o.op === 'barrel' ? '<label class="pfx-toggle"><input type="checkbox" id="dv-fo-ts"><span>TypeScript (index.ts)</span></label>'
            : o.op === 'ai' ? '<textarea id="dv-fo-ai" class="form-input-box" rows="3" placeholder="مثال: افصل المكونات عن الأدوات المساعدة في مجلدين components و utils"></textarea>' : ''}
            <div class="gh-row">${pbtn('fa-eye', 'معاينة', 'app.dvFolderPreview()', folders.length ? '' : 'disabled')}</div><div id="dv-fo-res"></div>`, 'fa-folder-tree');
    };
    /** Build the plan for a folder operation → { label, plan?, edits }. */
    P.dvFolderPlan = async function ({ dir, op, to, kind, ts, instruction }) {
        const files = this.dvFileMap();
        const inDir = Array.from(files.keys()).filter(p => p.startsWith(dir + '/'));
        const asPlan = (label, moves) => {
            const clash = moves.find(([f, t]) => f !== t && files.has(t) && !moves.some(([f2]) => f2 === t));
            if (clash) throw new Error('يوجد ملف بالمسار ' + clash[1]);
            const plan = planMoves(files, moves.filter(([f, t]) => f !== t));
            return { label, plan, edits: plan.changes.map(([p, v]) => [p, v === null ? null : v.from ? { from: v.from } : v.text]), rewired: plan.rewired };
        };
        if (op === 'move') {
            const nd = String(to || '').replace(/^\/+|\/+$/g, '');
            if (!nd || nd === dir) throw new Error('أدخل مساراً جديداً مختلفاً');
            if ((nd + '/').startsWith(dir + '/')) throw new Error('لا يمكن نقل مجلد داخل نفسه');
            return asPlan(`نقل ${dir} → ${nd}`, inDir.map(p => [p, nd + p.slice(dir.length)]));
        }
        if (op === 'case') return asPlan(`توحيد الأسماء (${kind}) في ${dir}`, inDir.map(p => [p, casePath(p, kind)]));
        if (op === 'flatten') {
            const moves = inDir.filter(p => p.slice(dir.length + 1).includes('/')).map(p => { const nb = dir + '/' + p.slice(dir.length + 1).split('/').join('-'); return [p, nb]; });
            return asPlan(`تسطيح ${dir}`, moves);
        }
        if (op === 'barrel') { const b = barrelFor(dir, inDir, ts); if (!b.count) throw new Error('لا توجد وحدات JS/TS مباشرة في المجلد'); return { label: 'إنشاء ' + b.path, edits: [[b.path, b.text]] }; }
        if (op === 'ai') {
            const list = inDir.slice(0, 60);
            const ans = await this.dvAI(`Folder "${dir}" contains:\n${list.map(p => `- ${p} (${(files.get(p) || '').split('\n').length} lines)`).join('\n')}\n\nFirst lines of each file:\n${list.slice(0, 25).map(p => `## ${p}\n${(files.get(p) || '').split('\n').slice(0, 12).join('\n')}`).join('\n')}\n\nInstruction: ${instruction}\nReturn ONLY JSON: {"moves":[["old/path","new/path"]], "reason":"short Arabic explanation"}. Only move/rename files inside the folder; do not invent files.`, { json: true, maxTokens: 3000 });
            const moves = ((ans && ans.moves) || []).filter(m => Array.isArray(m) && files.has(m[0]) && typeof m[1] === 'string' && m[1].trim()).map(([f, t]) => [f, t.replace(/^\/+/, '')]);
            if (!moves.length) throw new Error('لم يقترح النموذج أي نقل');
            const r = asPlan('إعادة هيكلة ذكية: ' + dir, moves);
            r.reason = ans.reason;
            return r;
        }
        throw new Error('عملية غير معروفة');
    };
    P.dvFolderPreview = async function () {
        const o = this._dvFo;
        const v = (id) => (document.getElementById(id) || {}).value || '';
        this.dvBusy('dv-fo-res');
        try {
            const r = await this.dvFolderPlan({ dir: v('dv-fo-dir') || o.dir, op: o.op, to: v('dv-fo-to'), kind: v('dv-fo-case') || 'kebab', ts: !!(document.getElementById('dv-fo-ts') || {}).checked, instruction: v('dv-fo-ai') });
            this.dvRfPreview(r.label, r.edits, 'dv-fo-res');
            if (r.plan) this._dvRf.plan = r.plan;
            if (r.rewired) setHTML('dv-fo-res', document.getElementById('dv-fo-res').innerHTML.replace('</div>', `</div><small class="hv-dim">🔗 سيُحدَّث ${r.rewired} مسار استيراد</small>`));
            if (r.reason) this.showToast(this.escapeHTML(r.reason), 'info');
            return r;
        } catch (e) { return this.dvErr(e, 'dv-fo-res'); }
    };

    // ---------------------------------------------------------------- #246 templates
    P.dvTemplatesList = function () { return lsGet(TPL_KEY, []); };
    P.dvTemplatesSave = function (list) { lsSet(TPL_KEY, list); return list; };
    P.dvTemplates = async function () {
        const user = this.dvTemplatesList().filter(t => t.kind !== 'folder');
        const builtins = Object.entries(this.FILE_TEMPLATES || {});
        return card('قوالب الملفات', `<p class="hv-dim">أنشئ ملفاً من قالب مع متغيرات: <code>{{name}} {{Name}} {{name_kebab}} {{name_snake}} {{name_camel}} {{NAME}} {{date}} {{year}}</code> — وفلاتر مثل <code>{{ name | pascal }}</code>. احفظ أي ملف كقالب خاص بك (يُستبدل اسمه تلقائياً بالمتغيرات).</p>
            <div class="gh-row">${btn('fa-floppy-disk', 'حفظ الملف الحالي كقالب', 'app.dvTemplateFromFile()', 'sidebar-btn-util gh-btn', this.activeStudioFile ? '' : 'disabled')}${btn('fa-plus', 'قالب جديد', 'app.dvTemplateEdit()')}</div>`, 'fa-file-lines')
            + card(`قوالبي (${user.length})`, user.length ? `<div class="fmx-list">${user.map(t => `<div class="fmx-item"><div><b>${esc(t.name)}</b><small dir="ltr">${esc(t.path)}</small></div>${pbtn('fa-file-circle-plus', 'إنشاء', call('dvTemplateUse', t.id))}${btn('fa-pen', '', call('dvTemplateEdit', t.id), 'gh-chip', 'title="تعديل"')}${btn('fa-trash', '', call('dvTemplateDelete', t.id), 'gh-chip', 'title="حذف"')}</div>`).join('')}</div>` : empty('لا توجد قوالب خاصة بعد'), 'fa-user')
            + card('قوالب مدمجة', `<div class="dvx-chips">${builtins.map(([k, t]) => `<span class="dvx-chipgrp"><button class="gh-chip" onclick="${call('dvTemplateUseBuiltin', k)}">${esc(t.label)}</button><button class="gh-chip" title="نسخ إلى قوالبي للتعديل" onclick="${call('dvTemplateFork', k)}"><i class="fa-solid fa-code-fork"></i></button></span>`).join('')}</div>`, 'fa-box');
    };
    P.dvTemplateFromFile = function (path = this.activeStudioFile) {
        const text = this.dvRead(path);
        if (text == null) return null;
        const stem = baseName(path).replace(/\..*$/, '');
        const t = { id: uid(), kind: 'file', name: baseName(path), path: templatize(path, stem), content: templatize(text, stem), at: Date.now() };
        this.dvTemplatesSave(this.dvTemplatesList().concat([t]));
        this.showToast('✅ حُفظ القالب: ' + this.escapeHTML(t.path), 'success');
        if (this._dvx && this._dvx.sec === 'templates') this.dvRefresh();
        return t;
    };
    P.dvTemplateEdit = async function (id) {
        const list = this.dvTemplatesList();
        const t = list.find(x => x.id === id) || { id: uid(), kind: 'file', name: '', path: 'src/{{name}}.js', content: '' };
        const r = await this.showDialog({ title: id ? 'تعديل القالب' : 'قالب جديد', fields: [{ id: 'name', label: 'الاسم', value: t.name }, { id: 'path', label: 'مسار الملف (بمتغيرات)', value: t.path, dir: 'ltr' }, { id: 'content', label: 'المحتوى', type: 'textarea', value: t.content, dir: 'ltr', rows: 10 }], buttons: [{ label: 'حفظ', value: 'ok', primary: true }, { label: 'إلغاء', value: null }] });
        if (!r || !r.values) return null;
        const nt = { ...t, ...r.values, at: Date.now() };
        this.dvTemplatesSave(list.some(x => x.id === nt.id) ? list.map(x => (x.id === nt.id ? nt : x)) : list.concat([nt]));
        this.dvRefresh();
        return nt;
    };
    P.dvTemplateDelete = async function (id) { this.dvTemplatesSave(this.dvTemplatesList().filter(t => t.id !== id)); this.dvRefresh(); return true; };
    P.dvTemplateUse = async function (id, nameArg, dirArg) {
        const t = this.dvTemplatesList().find(x => x.id === id);
        if (!t) return null;
        const name = nameArg || await this.askText('اسم العنصر', 'my-item', { label: 'يُستخدم في {{name}}' });
        if (!name) return null;
        const vars = templateVars(name);
        if (t.kind === 'folder') {
            const base = dirArg != null ? dirArg : '';
            const files = Object.entries(t.files || {}).map(([p, c]) => [(base ? base + '/' : '') + renderTemplate(p, vars), renderTemplate(c, vars)]);
            const clash = files.find(([p]) => this.virtualProjectFiles.has(p));
            if (clash) { this.showToast('يوجد ملف بالمسار ' + this.escapeHTML(clash[0]), 'error'); return null; }
            this.dvApply('من قالب: ' + t.name, files);
            this.showToast(`📁 أُنشئ ${files.length} ملف من «${this.escapeHTML(t.name)}»`, 'success');
            return files.map(f => f[0]);
        }
        let p = renderTemplate(t.path, vars);
        if (this.virtualProjectFiles.has(p)) p = this.uniqueProjectPath(p);
        this.createProjectFile(p, renderTemplate(t.content, vars));
        this.showToast('📄 ' + this.escapeHTML(p), 'success');
        return p;
    };
    P.dvTemplateUseBuiltin = async function (key, pathArg) {
        const t = (this.FILE_TEMPLATES || {})[key];
        if (!t) return null;
        const p = pathArg || await this.askText('مسار الملف الجديد', 'src/new-file.' + ((t.ext || [])[0] || 'txt'));
        if (!p) return null;
        const path = this.virtualProjectFiles.has(p) ? this.uniqueProjectPath(p) : p;
        this.createProjectFile(path, t.body(baseName(path)));
        this.showToast('📄 ' + this.escapeHTML(path), 'success');
        return path;
    };
    /** Copy a built-in template into «my templates» so it can be edited. */
    P.dvTemplateFork = function (key) {
        const t = (this.FILE_TEMPLATES || {})[key];
        if (!t) return null;
        const ext = (t.ext || [])[0] || 'txt';
        const nt = { id: uid(), kind: 'file', name: t.label + ' (نسختي)', path: 'src/{{name}}.' + ext, content: templatize(t.body('Example.' + ext), 'Example'), at: Date.now() };
        this.dvTemplatesSave(this.dvTemplatesList().concat([nt]));
        if (this._dvx && this._dvx.sec === 'templates') this.dvRefresh();
        return nt;
    };

    // ---------------------------------------------------------------- #247 folder templates
    P.dvScaffold = async function () {
        const user = this.dvTemplatesList().filter(t => t.kind === 'folder');
        const folders = this.dvFolders();
        return card('قوالب المجلدات', `<p class="hv-dim">أنشئ مجلداً كاملاً بملفاته من قالب (مكوّن React مع CSS واختبار، API، حزمة Python…)، أو احفظ أي مجلد موجود كقالب قابل لإعادة الاستخدام مع متغيرات في المسارات والمحتوى.</p>
            <div class="gh-row"><select id="dv-sc-dir" class="form-input-box" dir="ltr">${folders.map(d => `<option>${esc(d)}</option>`).join('')}</select>${btn('fa-floppy-disk', 'حفظ المجلد كقالب', "app.dvScaffoldFromFolder(document.getElementById('dv-sc-dir').value)", 'sidebar-btn-util gh-btn', folders.length ? '' : 'disabled')}</div>`, 'fa-folder-plus')
            + card(`قوالبي (${user.length})`, user.length ? `<div class="fmx-list">${user.map(t => `<div class="fmx-item"><div><b>${esc(t.name)}</b><small dir="ltr">${Object.keys(t.files || {}).slice(0, 5).map(esc).join(' • ')}${Object.keys(t.files || {}).length > 5 ? ' …' : ''}</small></div>${pbtn('fa-folder-plus', 'إنشاء', call('dvScaffoldUse', t.id))}${btn('fa-trash', '', call('dvTemplateDelete', t.id), 'gh-chip', 'title="حذف"')}</div>`).join('')}</div>` : empty('لا توجد قوالب مجلدات خاصة'), 'fa-user')
            + card('هياكل مدمجة', `<div class="dvx-chips">${Object.entries(this.FOLDER_SCAFFOLDS || {}).filter(([k]) => k !== 'empty').map(([k, t]) => `<button class="gh-chip" onclick="${call('dvScaffoldBuiltin', k)}">${esc(t.label)}</button>`).join('')}</div>`, 'fa-box');
    };
    P.dvScaffoldFromFolder = function (dir, nameArg) {
        if (!dir) return null;
        const stem = baseName(dir);
        const files = {};
        this.dvTextFiles(p => p.startsWith(dir + '/')).forEach(([p, c]) => { files[templatize(p.slice(dir.length + 1), stem)] = templatize(c, stem); });
        if (!Object.keys(files).length) { this.showToast('المجلد لا يحتوي ملفات نصية', 'warning'); return null; }
        const t = { id: uid(), kind: 'folder', name: nameArg || stem, root: '{{name}}', files: Object.fromEntries(Object.entries(files).map(([p, c]) => ['{{name}}/' + p, c])), at: Date.now() };
        this.dvTemplatesSave(this.dvTemplatesList().concat([t]));
        this.showToast(`✅ حُفظ قالب المجلد «${this.escapeHTML(t.name)}» (${Object.keys(files).length} ملف)`, 'success');
        if (this._dvx && this._dvx.sec === 'scaffold') this.dvRefresh();
        return t;
    };
    P.dvScaffoldUse = async function (id, nameArg, parentArg) {
        const parent = parentArg != null ? parentArg : await this.askText('المجلد الأب', '', { label: 'اتركه فارغاً للجذر' });
        if (parent == null) return null;
        return this.dvTemplateUse(id, nameArg, String(parent).replace(/^\/+|\/+$/g, ''));
    };
    P.dvScaffoldBuiltin = async function (key) {
        const name = await this.askText('مسار المجلد', 'src/components/Card');
        if (!name) return null;
        return this.createProjectFolder ? this.createProjectFolder(name.replace(/^\/+|\/+$/g, ''), key) : null;
    };

    // ---------------------------------------------------------------- #248 duplicate • #250 zip
    P.dvFileOps = async function () {
        const files = this.projectPaths();
        const folders = this.dvFolders();
        const cur = this.activeStudioFile && this.virtualProjectFiles.has(this.activeStudioFile) ? this.activeStudioFile : files[0];
        return card('نسخ الملفات', `<p class="hv-dim">نسخ ذكي: اختر الاسم الجديد ويُستبدل الاسم القديم داخل المحتوى بكل حالاته (مثل <code>UserCard → ProductCard</code> و <code>user-card → product-card</code>).</p>
            <div class="gh-row"><select id="dv-dup-src" class="form-input-box" dir="ltr">${files.map(p => `<option ${p === cur ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select><input id="dv-dup-to" class="form-input-box" dir="ltr" placeholder="المسار الجديد (اختياري)"></div>
            <div class="dvx-flags"><label class="pfx-toggle"><input type="checkbox" id="dv-dup-ren" checked><span>استبدال الاسم داخل المحتوى</span></label></div>
            <div class="gh-row">${pbtn('fa-copy', 'نسخ الملف', 'app.dvDuplicateUI()')}</div>`, 'fa-copy')
            + card('نسخ مجلد كامل', `<div class="gh-row"><select id="dv-dupd-src" class="form-input-box" dir="ltr">${folders.map(d => `<option>${esc(d)}</option>`).join('')}</select><input id="dv-dupd-to" class="form-input-box" dir="ltr" placeholder="المسار الجديد"></div><div class="gh-row">${pbtn('fa-clone', 'نسخ المجلد', 'app.dvDuplicateFolderUI()', folders.length ? '' : 'disabled')}</div>`, 'fa-clone')
            + card('ضغط مجلد ZIP', `<div class="gh-row"><select id="dv-zip-dir" class="form-input-box" dir="ltr"><option value="">(المشروع كاملاً)</option>${folders.map(d => `<option>${esc(d)}</option>`).join('')}</select></div>
            <div class="dvx-flags"><label class="pfx-toggle"><input type="checkbox" id="dv-zip-nm" checked><span>استبعاد node_modules و dist و .git</span></label><label class="pfx-toggle"><input type="checkbox" id="dv-zip-root" checked><span>المسارات نسبية للمجلد</span></label></div>
            <div class="gh-row">${pbtn('fa-file-zipper', 'تنزيل ZIP', 'app.dvZipUI()')}</div><div id="dv-zip-res"></div>`, 'fa-file-zipper');
    };
    /** Smart duplicate: copy + rename identifiers of the old name inside. */
    P.dvDuplicate = function (src, to, { rename = true } = {}) {
        const f = this.virtualProjectFiles.get(src);
        if (!f) return null;
        let dest = to ? String(to).replace(/^\/+/, '') : null;
        if (!dest) return this.duplicateProjectFile(src);
        if (this.virtualProjectFiles.has(dest)) dest = this.uniqueProjectPath(dest);
        let entry = { ...f };
        if (rename && typeof f.content === 'string' && !f.dataUrl) {
            const a = templateVars(baseName(src).replace(/\..*$/, '')), b = templateVars(baseName(dest).replace(/\..*$/, ''));
            let text = f.content;
            ['Name', 'name_kebab', 'name_snake', 'name_camel', 'NAME', 'name'].forEach(k => { if (a[k] && a[k].length > 1 && a[k] !== b[k]) text = text.split(a[k]).join(b[k]); });
            entry = { ...f, content: text, lang: extOf(dest) };
        }
        this.dvApply('نسخ ' + src, [[dest, { entry }]]);
        return dest;
    };
    P.dvDuplicateUI = function () {
        const src = (document.getElementById('dv-dup-src') || {}).value, to = (document.getElementById('dv-dup-to') || {}).value;
        const p = this.dvDuplicate(src, to, { rename: !!(document.getElementById('dv-dup-ren') || {}).checked });
        if (p) { this.showToast('📄 ' + this.escapeHTML(p), 'success'); this.dvRefresh(); }
        return p;
    };
    P.dvDuplicateFolder = function (dir, to, { rename = true } = {}) {
        const nd = String(to || '').replace(/^\/+|\/+$/g, '') || dir + '-copy';
        if ((nd + '/').startsWith(dir + '/')) throw new Error('لا يمكن النسخ داخل المجلد نفسه');
        const a = templateVars(baseName(dir)), b = templateVars(baseName(nd));
        const swap = (s) => { let t = s; if (rename) ['Name', 'name_kebab', 'name_snake', 'name_camel', 'NAME', 'name'].forEach(k => { if (a[k] && a[k].length > 1 && a[k] !== b[k]) t = t.split(a[k]).join(b[k]); }); return t; };
        const changes = this.projectPaths().filter(p => p.startsWith(dir + '/')).map(p => {
            const f = this.virtualProjectFiles.get(p);
            const np = nd + '/' + swap(p.slice(dir.length + 1));
            return [np, { entry: typeof f.content === 'string' && !f.dataUrl ? { ...f, content: swap(f.content), lang: extOf(np) } : { ...f } }];
        });
        const clash = changes.find(([p]) => this.virtualProjectFiles.has(p));
        if (clash) throw new Error('يوجد ملف بالمسار ' + clash[0]);
        this.dvApply(`نسخ ${dir} → ${nd}`, changes);
        return changes.map(c => c[0]);
    };
    P.dvDuplicateFolderUI = function () {
        try {
            const list = this.dvDuplicateFolder((document.getElementById('dv-dupd-src') || {}).value, (document.getElementById('dv-dupd-to') || {}).value);
            this.showToast(`📁 نُسخ ${list.length} ملف`, 'success');
            this.dvRefresh();
            return list;
        } catch (e) { return this.dvErr(e); }
    };
    /** Build a ZIP for a folder (Blob). Exposed for tests (needs JSZip). */
    P.dvZipFolder = async function (dir, { exclude = true, relative = true } = {}) {
        if (typeof JSZip === 'undefined' && this.ensureJSZip) await this.ensureJSZip();
        if (typeof JSZip === 'undefined') throw new Error('مكتبة ZIP غير محملة');
        const zip = new JSZip();
        const paths = this.projectPaths().filter(p => (!dir || p.startsWith(dir + '/')) && !(exclude && SKIP_DIRS.test(p)));
        paths.forEach(p => {
            const f = this.virtualProjectFiles.get(p);
            const name = relative && dir ? p.slice(dir.length + 1) : p;
            if (f.dataUrl) zip.file(name, f.dataUrl.split(',')[1] || '', { base64: true }); else zip.file(name, f.content || '');
        });
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        return { blob, count: paths.length, name: (dir ? baseName(dir) : 'project') + '.zip' };
    };
    P.dvZipUI = async function () {
        const dir = (document.getElementById('dv-zip-dir') || {}).value || '';
        try {
            const r = await this.dvZipFolder(dir, { exclude: !!(document.getElementById('dv-zip-nm') || {}).checked, relative: !!(document.getElementById('dv-zip-root') || {}).checked });
            this.downloadBlob(r.blob, r.name);
            setHTML('dv-zip-res', `<small class="hv-dim">📦 ${esc(r.name)} — ${r.count} ملف • ${(r.blob.size / 1024).toFixed(1)} KB</small>`);
            return r;
        } catch (e) { return this.dvErr(e, 'dv-zip-res'); }
    };
}
