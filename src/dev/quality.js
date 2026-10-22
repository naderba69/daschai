/* #142 Stylelint panel • #143 TypeScript type checking • #238 duplicate code • #240 merge small files. */
import { esc, call, btn, pbtn, card, empty, toggle, select, val, setHTML, stats, table, extOf, baseName, dirName } from './util.js';
import { lintCss, fixCss, CSS_RULES } from '../studio/css-lint.js';

// ------------------------------------------------------------------ #238 duplicate code
const TRIVIAL = /^([{}()[\];,]+|\/\/.*|#.*|\/\*.*|\*.*|end|else|\}\s*else\s*\{|return;?|break;?|<\/?\w+>|""|''|)$/;
const normLine = (l) => l.trim().replace(/\s+/g, ' ');
/** Find duplicated blocks of ≥ minLines significant lines (within and across files). */
export function findDuplicates(files, { minLines = 6, max = 200 } = {}) {
    const norm = files.map(([path, text]) => {
        const rows = [];
        String(text).split('\n').forEach((l, i) => { const n = normLine(l); if (!TRIVIAL.test(n) && !/^(import|from|export \{|require\(|const \w+ = require\(|using |#include|package )/.test(n)) rows.push({ n, line: i + 1 }); });
        return { path, rows };
    });
    const index = new Map();
    norm.forEach((f, fi) => {
        for (let i = 0; i + minLines <= f.rows.length; i++) {
            const key = f.rows.slice(i, i + minLines).map(r => r.n).join('\n');
            if (key.length < minLines * 8) continue;               // skip blocks of tiny lines
            const list = index.get(key);
            if (list) list.push([fi, i]); else index.set(key, [[fi, i]]);
        }
    });
    const blocks = [], seen = new Set();
    for (const occ of index.values()) {
        if (occ.length < 2) continue;
        for (let x = 0; x < occ.length; x++) for (let y = x + 1; y < occ.length; y++) {
            const [fa, ia] = occ[x], [fb, ib] = occ[y];
            if (fa === fb && Math.abs(ia - ib) < minLines) continue;      // overlapping window in the same file
            const A = norm[fa].rows, B = norm[fb].rows;
            if (ia > 0 && ib > 0 && A[ia - 1].n === B[ib - 1].n) continue; // continuation of a longer block
            const k = `${fa}:${ia}:${fb}:${ib}`;
            if (seen.has(k)) continue;
            seen.add(k);
            let len = minLines;
            while (ia + len < A.length && ib + len < B.length && A[ia + len].n === B[ib + len].n && (fa !== fb || ia + len < ib)) len++;
            blocks.push({ lines: len, a: { path: norm[fa].path, start: A[ia].line, end: A[ia + len - 1].line }, b: { path: norm[fb].path, start: B[ib].line, end: B[ib + len - 1].line }, sample: A.slice(ia, ia + Math.min(len, 8)).map(r => r.n).join('\n') });
            if (blocks.length >= max * 3) break;
        }
    }
    blocks.sort((p, q) => q.lines - p.lines);
    const totalLines = norm.reduce((n, f) => n + f.rows.length, 0);
    const dupLines = new Set();
    blocks.forEach(b => { for (let l = b.b.start; l <= b.b.end; l++) dupLines.add(b.b.path + ':' + l); });
    return { blocks: blocks.slice(0, max), totalLines, duplicatedLines: dupLines.size, ratio: totalLines ? Math.round(dupLines.size / totalLines * 1000) / 10 : 0 };
}

// ------------------------------------------------------------------ #240 merge small files
const CODE = /\.(m?[jt]sx?|cjs|py|css|scss|less|go|rb|php)$/;
const SPEC_RE = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\(\s*|export\s[^'"]*?from\s*|@import\s+)['"](\.{1,2}\/[^'"]+)['"]/g;
const RESOLVE_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
export function joinRel(dir, spec) {
    const parts = dir ? dir.split('/') : [];
    spec.split('/').forEach(s => { if (s === '..') parts.pop(); else if (s && s !== '.') parts.push(s); });
    return parts.join('/');
}
export function resolveSpec(fromPath, spec, has) {
    const base = joinRel(dirName(fromPath), spec);
    for (const e of RESOLVE_EXT) if (has(base + e)) return base + e;
    const stripped = base.replace(/\.(js|jsx|mjs)$/, '');
    for (const e of RESOLVE_EXT) if (has(stripped + e)) return stripped + e;
    return null;
}
/** Relative import specifier from one file to another (extension dropped for JS/TS). */
export function relSpec(fromPath, toPath) {
    const a = dirName(fromPath).split('/').filter(Boolean), b = toPath.split('/');
    let i = 0;
    while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
    const up = a.length - i;
    let s = (up ? '../'.repeat(up) : './') + b.slice(i).join('/');
    return /\.(m?[jt]sx?|cjs)$/.test(toPath) ? s.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '').replace(/\/index$/, '') || '.' : s;
}
export function importGraph(files) {
    const has = (p) => files.has(p), edges = [];
    for (const [p, text] of files) {
        if (!CODE.test(p)) continue;
        let m;
        SPEC_RE.lastIndex = 0;
        while ((m = SPEC_RE.exec(text))) { const t = resolveSpec(p, m[1], has); if (t) edges.push({ from: p, to: t, spec: m[1] }); }
    }
    return edges;
}
const sigLines = (t) => String(t).split('\n').filter(l => l.trim() && !/^\s*(\/\/|#|\*|\/\*)/.test(l)).length;
/** Merge suggestions: small sibling files of the same kind, and small files imported by exactly one importer. */
export function mergeSuggestions(fileList, { maxLines = 25 } = {}) {
    const files = new Map(fileList);
    const small = fileList.filter(([p, t]) => CODE.test(p) && !/(^|\/)(index|main|app)\.\w+$|\.(test|spec)\.|\.d\.ts$|config\./.test(p) && sigLines(t) <= maxLines && sigLines(t) > 0);
    const edges = importGraph(files);
    const out = [];
    const fam = (p) => (/\.(css|scss|less)$/.test(p) ? 'css' : /\.py$/.test(p) ? 'py' : /\.(go|rb|php)$/.test(p) ? extOf(p) : /\.tsx?$/.test(p) ? 'ts' : 'js');
    const groups = new Map();
    small.forEach(([p]) => { const k = dirName(p) + '|' + fam(p); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
    for (const [k, list] of groups) {
        if (list.length < 3) continue;
        const [dir, f] = k.split('|');
        const ext = f === 'ts' ? 'ts' : f === 'js' ? 'js' : f === 'css' ? 'css' : f;
        const target = (dir ? dir + '/' : '') + (baseName(dir) || 'shared') + '.' + ext;
        out.push({ kind: 'siblings', files: list.sort(), target, lines: list.reduce((n, p) => n + sigLines(files.get(p)), 0), reason: `${list.length} ملفات صغيرة من نفس النوع في «${dir || '/'}»` });
    }
    small.forEach(([p]) => {
        if (/\.(css|scss|less)$/.test(p)) return;
        const importers = Array.from(new Set(edges.filter(e => e.to === p).map(e => e.from)));
        if (importers.length === 1 && !edges.some(e => e.from === p && e.to === importers[0])) out.push({ kind: 'inline', files: [p], target: importers[0], lines: sigLines(files.get(p)), reason: `يستورده ملف واحد فقط (${importers[0]})` });
    });
    return out;
}
const commentFor = (p, text) => (/\.(py|rb)$/.test(p) ? `# ── ${text} ──` : /\.(css|scss|less)$/.test(p) ? `/* ── ${text} ── */` : `// ── ${text} ──`);
/** Merge `sources` into `target`; rewrites imports across the project. Returns [[path, content|null]] changes. */
export function planMerge(fileList, sources, target) {
    const files = new Map(fileList), has = (p) => files.has(p);
    const merged = new Set(sources.concat(target));
    const changes = new Map();
    const importLines = new Set();
    const body = [];
    const targetText = files.get(target);
    const parts = (targetText != null ? [target] : []).concat(sources.filter(s => s !== target));
    parts.forEach(p => {
        const lines = String(files.get(p) || '').split('\n');
        const keep = [];
        lines.forEach(l => {
            const m = /^\s*(?:import\s[^'"]*?from\s*|import\s*|const\s.+?=\s*require\(\s*|export\s[^'"]*?from\s*|@import\s+)['"]([^'"]+)['"]/.exec(l);
            if (m) {
                const r = /^\./.test(m[1]) ? resolveSpec(p, m[1], has) : null;
                if (r && merged.has(r)) return;                           // import between merged files → drop
                const fixed = r ? l.replace(m[1], relSpec(target, r)) : l;
                if (!importLines.has(fixed.trim())) { importLines.add(fixed.trim()); keep.push({ imp: true, l: fixed }); }
                return;
            }
            keep.push({ imp: false, l });
        });
        body.push({ p, lines: keep });
    });
    const imports = body.flatMap(b => b.lines.filter(x => x.imp).map(x => x.l));
    const content = (imports.length ? imports.join('\n') + '\n\n' : '') + body.map(b => commentFor(target, 'من ' + b.p) + '\n' + b.lines.filter(x => !x.imp).map(x => x.l).join('\n').replace(/^\n+|\n+$/g, '')).join('\n\n') + '\n';
    changes.set(target, content);
    sources.filter(s => s !== target).forEach(s => changes.set(s, null));
    // rewrite importers elsewhere
    for (const [p, text] of files) {
        if (merged.has(p) || !CODE.test(p)) continue;
        let next = text, seenTarget = false;
        next = next.replace(SPEC_RE, (all, spec) => {
            const r = resolveSpec(p, spec, has);
            if (!r || !merged.has(r)) return all;
            seenTarget = true;
            return all.replace(spec, relSpec(p, target));
        });
        if (seenTarget && next !== text) changes.set(p, next);
    }
    return Array.from(changes.entries());
}

export function installQuality(P) {
    // ---------------------------------------------------------------- #142 Stylelint
    P.dvStylelintRules = function () { const f = this.dvRead('.stylelintrc.json'); try { return f ? (JSON.parse(f).rules || {}) : {}; } catch (e) { return {}; } };
    P.dvStylelintScan = function () {
        const rules = this.dvStylelintRules();
        return this.dvTextFiles(p => /\.(css|scss|less)$/i.test(p)).map(([path, text]) => ({ path, issues: lintCss(text, { lang: extOf(path), rules }) }));
    };
    P.dvStylelint = async function () {
        const res = this.dvStylelintScan(), rules = { ...CSS_RULES, ...this.dvStylelintRules() };
        const all = res.flatMap(r => r.issues.map(i => ({ ...i, path: r.path })));
        const sev = (s) => all.filter(i => i.severity === s).length;
        const fixable = all.filter(i => i.fix).length;
        const list = res.filter(r => r.issues.length).map(r => `<details class="dvx-file" ${res.length < 6 ? 'open' : ''}><summary><b dir="ltr">${esc(r.path)}</b> <span class="hv-dim">${r.issues.length}</span> ${btn('fa-wand-magic-sparkles', 'إصلاح تلقائي', call('dvStylelintFix', r.path), 'gh-chip')}</summary>
            ${table(['', 'السطر', 'المشكلة'], r.issues.map(i => [`<span class="dvx-sev dvx-${i.severity}">${i.severity}</span>`, `<a href="#" onclick="${call('openFileAt', r.path, i.line, i.column)};return false">${i.line}:${i.column}</a>`, esc(i.message)]))}</details>`).join('');
        return card('Stylelint — فحص CSS / SCSS / Less', `${stats([['ملف', res.length], ['أخطاء', sev('error')], ['تحذيرات', sev('warning')], ['ملاحظات', sev('info')], ['قابلة للإصلاح', fixable]])}
            <div class="gh-row">${pbtn('fa-wand-magic-sparkles', 'إصلاح الكل', 'app.dvStylelintFix()')}${btn('fa-rotate', 'إعادة الفحص', 'app.dvRefresh()')}</div>
            ${res.length ? (list || empty('✅ لا توجد مشكلات')) : empty('لا توجد ملفات CSS في المشروع')}
            <p class="hv-dim">يعمل الفحص محلياً أثناء الكتابة في المحرر أيضاً (مصدر «stylelint»).</p>`, 'fa-palette')
            + card('القواعد (.stylelintrc.json)', `<div class="dvx-rules">${Object.keys(CSS_RULES).map(r => select('dv-rule-' + r, `<code dir="ltr">${r}</code>`, [['off', 'معطلة'], ['info', 'ملاحظة'], ['warning', 'تحذير'], ['error', 'خطأ']], rules[r] || 'off')).join('')}</div>
            <div class="gh-row">${pbtn('fa-floppy-disk', 'حفظ القواعد', 'app.dvStylelintSaveRules()')}${toggle('dv-sl-live', 'الفحص الحي في المحرر', this.dvEditorSetting('stylelint') !== false, 'onchange="app.dvEditorToggle(\'stylelint\', this.checked)"')}</div>`, 'fa-sliders');
    };
    P.dvStylelintFix = function (path) {
        const rules = this.dvStylelintRules();
        const changes = [];
        let n = 0;
        this.dvTextFiles(p => /\.(css|scss|less)$/i.test(p) && (!path || p === path)).forEach(([p, text]) => { const r = fixCss(text, { lang: extOf(p), rules }); if (r.fixed && r.code !== text) { changes.push([p, r.code]); n += r.fixed; } });
        if (!changes.length) { this.showToast('لا توجد مشكلات قابلة للإصلاح التلقائي', 'info'); return 0; }
        this.dvApply('إصلاح Stylelint', changes);
        this.showToast(`✅ تم إصلاح ${n} مشكلة في ${changes.length} ملف`, 'success');
        if (document.getElementById('dvx-sec') && this._dvx && this._dvx.sec === 'stylelint') this.dvRefresh();
        return n;
    };
    P.dvStylelintSaveRules = function () {
        const rules = {};
        Object.keys(CSS_RULES).forEach(r => { const v = val('dv-rule-' + r); if (v && v !== CSS_RULES[r]) rules[r] = v === 'off' ? false : v; });
        let cfg = {};
        try { cfg = JSON.parse(this.dvRead('.stylelintrc.json') || '{}'); } catch (e) { cfg = {}; }
        cfg.rules = rules;
        this.writeProjectFile('.stylelintrc.json', JSON.stringify(cfg, null, 2) + '\n', 'config');
        this.showToast('✅ حُفظت القواعد في .stylelintrc.json', 'success');
        return cfg;
    };
    P.dvEditorSetting = function (k) { try { return this.getEditorSettings ? this.getEditorSettings()[k] : undefined; } catch (e) { return undefined; } };
    P.dvEditorToggle = async function (k, v) {
        if ((!this.setEditorSettings || this.setEditorSettings.__oxLazy) && this.ensureStudio) await this.ensureStudio({ quiet: true });
        if (this.setEditorSettings) this.setEditorSettings({ [k]: !!v });
        this.showToast(v ? '✅ تم التفعيل' : 'تم الإيقاف', 'info');
    };

    // ---------------------------------------------------------------- #143 type checking
    P.dvTypecheck = async function () {
        const ts = this.dvTextFiles(p => /\.(ts|tsx|mts|cts)$/.test(p) && !/\.d\.ts$/.test(p));
        const last = this._dvTypecheck;
        return card('فحص الأنواع بمترجم TypeScript الحقيقي', `<p class="hv-dim">يُحمّل TypeScript 6 (واجهة المترجم) ومكتبات lib.*.d.ts من jsDelivr داخل عامل منفصل في أول استخدام (عدة ميغابايت مرة واحدة ثم من الذاكرة المؤقتة). ملفات JS تُفحص عند وجود <code>// @ts-check</code>.</p>
            <div class="dvx-flags">${toggle('dv-tc-live', 'فحص حي لملفات TS في المحرر', !!this.dvEditorSetting('typecheck'), 'onchange="app.dvEditorToggle(\'typecheck\', this.checked)"')}${toggle('dv-tc-strict', 'وضع strict', this._dvStrict !== false, 'onchange="app._dvStrict=this.checked"')}</div>
            <div class="gh-row">${pbtn('fa-spell-check', `فحص المشروع (${ts.length} ملف TS)`, 'app.dvTypecheckProject()')}</div>
            <div id="dv-tc-res">${last ? this.dvTypecheckHTML(last) : ''}</div>`, 'fa-spell-check');
    };
    P.dvTypecheckProject = async function (paths) {
        const list = paths || this.dvTextFiles(p => /\.(ts|tsx|mts|cts)$/.test(p) && !/\.d\.ts$/.test(p) || (/\.(js|jsx|mjs)$/.test(p) && /^\s*\/\/\s*@ts-check/.test(this.dvRead(p) || ''))).map(([p]) => p);
        if (!list.length) { setHTML('dv-tc-res', empty('لا توجد ملفات TypeScript (أو JS مع // @ts-check)')); return null; }
        if ((!this.typecheckPayload || this.typecheckPayload.__oxLazy) && this.ensureStudio) await this.ensureStudio({ quiet: true });
        const out = { at: Date.now(), files: [], version: '' };
        for (let i = 0; i < list.length; i++) {
            const p = list[i];
            this.dvBusy('dv-tc-res', `فحص ${i + 1}/${list.length}: ${esc(p)}`);
            try {
                const payload = this.typecheckPayload ? this.typecheckPayload(this.dvRead(p) || '', p) : { code: this.dvRead(p), path: p, files: {} };
                const res = await this.toolsRequest('typecheck', { ...payload, strict: this._dvStrict !== false }, { timeout: 120000 });
                if (res && res.error) throw new Error(res.error);
                out.version = res.version || out.version;
                out.files.push({ path: p, diagnostics: res.diagnostics || [] });
            } catch (e) { out.files.push({ path: p, error: e.message || String(e), diagnostics: [] }); }
        }
        this._dvTypecheck = out;
        setHTML('dv-tc-res', this.dvTypecheckHTML(out));
        return out;
    };
    P.dvTypecheckHTML = function (r) {
        const all = r.files.flatMap(f => f.diagnostics.map(d => ({ ...d, path: f.path })));
        const errs = all.filter(d => d.severity === 2).length;
        return stats([['ملف', r.files.length], ['أخطاء', errs], ['تحذيرات', all.length - errs], ['TypeScript', r.version || '—']])
            + (r.files.some(f => f.error) ? empty('⚠ ' + esc(r.files.find(f => f.error).error), true) : '')
            + (all.length ? table(['الملف', 'الموضع', 'الرمز', 'الرسالة'], all.slice(0, 400).map(d => [`<span dir="ltr">${esc(d.path)}</span>`, `<a href="#" onclick="${call('openFileAt', d.path, d.line, d.column)};return false">${d.line}:${d.column}</a>`, `<code>TS${d.code}</code>`, esc(d.message)])) : empty('✅ لا توجد أخطاء أنواع'));
    };

    // ---------------------------------------------------------------- #238 duplicates
    P.dvDupes = async function () {
        const min = this._dvDupMin || 6;
        const r = findDuplicates(this.dvTextFiles(p => CODE.test(p) && !/\.min\./.test(p)), { minLines: min });
        this._dvDupes = r;
        return card('الكود المكرر', `${stats([['كتل مكررة', r.blocks.length], ['أسطر مكررة', r.duplicatedLines], ['نسبة التكرار', r.ratio + '%']])}
            <div class="gh-row">${select('dv-dup-min', 'أقل عدد أسطر', [[4, '4'], [6, '6'], [8, '8'], [12, '12']], min, 'onchange="app._dvDupMin=+this.value;app.dvRefresh()"')}</div>
            ${r.blocks.length ? r.blocks.slice(0, 60).map((b, i) => `<div class="fmx-item dvx-dup"><div><b>${b.lines} سطر</b>
                <small><a href="#" onclick="${call('openFileAt', b.a.path, b.a.start, 1)};return false" dir="ltr">${esc(b.a.path)}:${b.a.start}-${b.a.end}</a> ⇄ <a href="#" onclick="${call('openFileAt', b.b.path, b.b.start, 1)};return false" dir="ltr">${esc(b.b.path)}:${b.b.start}-${b.b.end}</a></small>
                <pre class="pfx-pre dvx-pre" dir="ltr">${esc(b.sample)}</pre></div>${btn('fa-wand-magic-sparkles', 'استخراج دالة مشتركة', call('dvDupeAI', i))}</div>`).join('') : empty('✅ لم يُعثر على كود مكرر')}`, 'fa-clone');
    };
    P.dvDupeAI = async function (i) {
        const b = this._dvDupes && this._dvDupes.blocks[i];
        if (!b) return null;
        const a = (this.dvRead(b.a.path) || '').split('\n').slice(b.a.start - 1, b.a.end).join('\n'), c = (this.dvRead(b.b.path) || '').split('\n').slice(b.b.start - 1, b.b.end).join('\n');
        const r = await this.dvAI(`These two blocks are duplicated. Propose ONE shared helper function and show how each call site becomes a call to it. Return code blocks only plus a one-line Arabic summary.\n\n// ${b.a.path}:${b.a.start}\n${a}\n\n// ${b.b.path}:${b.b.start}\n${c}`);
        if (r) this.showDialog({ title: 'اقتراح إزالة التكرار', body: this.renderMarkdownSafe ? this.renderMarkdownSafe(r) : `<pre>${esc(r)}</pre>`, wide: true, buttons: [{ label: 'إغلاق', value: null }] });
        return r;
    };

    // ---------------------------------------------------------------- #240 merge
    P.dvMerge = async function () {
        const max = this._dvMergeMax || 25;
        const sug = mergeSuggestions(this.dvTextFiles(), { maxLines: max });
        this._dvMergeSug = sug;
        return card('اقتراح دمج الملفات الصغيرة', `<p class="hv-dim">ملفات صغيرة متجاورة من نفس النوع، أو ملف صغير يستورده ملف واحد فقط. الدمج يحدّث الاستيرادات في بقية المشروع ويُسجل كدفعة قابلة للتراجع.</p>
            <div class="gh-row">${select('dv-merge-max', 'الحد الأقصى للأسطر', [[15, '15'], [25, '25'], [40, '40'], [60, '60']], max, 'onchange="app._dvMergeMax=+this.value;app.dvRefresh()"')}</div>
            ${sug.length ? sug.map((s, i) => `<div class="fmx-item"><div><b>${s.kind === 'inline' ? 'دمج في المستورِد' : 'دمج الأشقاء'}</b> → <code dir="ltr">${esc(s.target)}</code><small>${esc(s.reason)} • ${s.lines} سطر</small><small dir="ltr">${s.files.map(esc).join(' • ')}</small></div>${btn('fa-object-group', 'دمج', call('dvMergeApply', i))}</div>`).join('') : empty('✅ لا توجد اقتراحات دمج')}`, 'fa-object-group');
    };
    P.dvMergeApply = async function (i, opts = {}) {
        const s = this._dvMergeSug && this._dvMergeSug[i];
        if (!s) return null;
        if (!opts.yes && !(await this.askConfirm('دمج الملفات', `سيتم دمج ${s.files.length} ملف في ${s.target} وحذف الأصل وتحديث الاستيرادات. متابعة؟`))) return null;
        const changes = planMerge(this.dvTextFiles(), s.files, s.target);
        const b = this.dvApply(`دمج ${s.files.length} ملف → ${s.target}`, changes);
        this.showToast(`✅ تم الدمج (${changes.length} تغيير) — يمكن التراجع`, 'success');
        if (document.getElementById('dvx-sec')) this.dvRefresh();
        return b;
    };
}
