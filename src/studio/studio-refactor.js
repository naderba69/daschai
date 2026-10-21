/* ==============================================================================
   Sprint 6 — code intelligence & refactoring for the CodeMirror studio
   hover: definition (#147), colour picker (#191), image (#192), icon (#193) and
   link (#194) previews • go to definition (#148) • references (#149) • rename
   symbol across the project (#150) • unused imports/variables/functions
   (#235-#237) • ESLint (#141) • import updates when moving/renaming files and
   folders (#243, #244) • safe delete (#245) • dependencies panel (#234) •
   folder compare (#249) • case / sort / trim (#183-#185) • getters/setters and
   constructors (#186, #187) • JSON → interfaces / models (#188, #189) •
   CommonJS → ESM (#145) • fake data (#170) • Prettier formatting (#140)
   ============================================================================== */
const KIND_ICON = { function: 'fa-code', method: 'fa-cube', class: 'fa-shapes', interface: 'fa-diagram-project', type: 'fa-font', enum: 'fa-list-ol', variable: 'fa-tag', struct: 'fa-shapes', trait: 'fa-shapes', module: 'fa-box' };
const IMG_RE = /([\w@./-]+\.(?:png|jpe?g|gif|svg|webp|avif|ico|bmp))(?:[?#].*)?$/i;

export function installRefactor(P, ctx) {
    const { intel, toHex, esc } = ctx;
    const files = (app) => app.virtualProjectFiles;
    const posOf = (text, line, col) => {
        let pos = 0;
        for (let i = 1; i < line; i++) { const n = text.indexOf('\n', pos); if (n < 0) return text.length; pos = n + 1; }
        return Math.min(text.length, pos + Math.max(0, (col || 1) - 1));
    };
    P.symbolIndex = function () { if (!this._symIndex) this._symIndex = new intel.SymbolIndex(); return this._symIndex; };

    // ------------------------------------------------------------------ HOVER
    P.resolveProjectAsset = function (fromPath, ref) {
        if (!ref) return null;
        const clean = ref.replace(/^['"(]+|['")]+$/g, '').split(/[?#]/)[0];
        const dir = intel.dirName(fromPath || '');
        const cands = [intel.joinPath(dir, clean), clean.replace(/^\.?\//, ''), 'public/' + clean.replace(/^\.?\//, ''), 'src/' + clean.replace(/^\.?\//, '')];
        return cands.find(p => p && this.virtualProjectFiles.has(p)) || null;
    };
    P.editorHover = function ({ word, token, line, path }) {
        const parts = [];
        const tk = String(token || '');
        const hex = toHex(tk.replace(/[;:]+$/, ''));
        if (hex && /^(#|rgb)/i.test(tk)) parts.push(`<div class="hv-row"><span class="hv-color" style="background:${esc(tk.replace(/[;:]+$/, ''))}"></span><code>${esc(hex)}</code><span class="hv-dim">${esc(tk)}</span></div>`);
        const fa = /\b(fa-[a-z0-9-]+)\b/.exec(tk);
        if (fa && !/^fa-(solid|regular|brands|light|thin|duotone|sharp|lg|xl|xs|sm|fw|spin|pulse|\dx)$/.test(fa[1])) {
            const fam = /fa-brands|fab\b/.test(tk) ? 'fa-brands' : 'fa-solid';
            parts.push(`<div class="hv-row"><i class="${fam} ${esc(fa[1])} hv-icon" aria-hidden="true"></i><code>${esc(fa[1])}</code></div>`);
        }
        const img = IMG_RE.exec(tk);
        if (img) {
            if (/^https:\/\//i.test(tk)) parts.push(`<div class="hv-img"><img src="${esc(tk)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`);
            else {
                const p = this.resolveProjectAsset(path, img[1]);
                const f = p && this.virtualProjectFiles.get(p);
                const src = f && (f.dataUrl || (/\.svg$/i.test(p) && typeof f.content === 'string' ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(f.content) : null));
                if (src) parts.push(`<div class="hv-img"><img src="${esc(src)}" alt=""><div class="hv-dim">${esc(p)}</div></div>`);
            }
        }
        const url = /^(https?:\/\/[^\s'"`<>]+?)[.,;:!?)]*$/.exec(tk);
        if (url && !img) {
            let host = '';
            try { host = new URL(url[1]).hostname; } catch (e) { host = ''; }
            if (host) parts.push(`<div class="hv-row hv-link"><img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32" alt="" width="16" height="16" referrerpolicy="no-referrer"><b dir="ltr">${esc(host)}</b><a href="${esc(url[1])}" target="_blank" rel="noopener noreferrer">فتح ↗</a></div><div class="hv-dim" dir="ltr">${esc(url[1].slice(0, 120))}</div>`);
        }
        if (word && /^[A-Za-z_$][\w$]*$/.test(word) && intel.familyOf(path)) {
            const defs = this.symbolIndex().definitions(files(this), word, path).filter(d => !(d.path === path && d.line === line)).slice(0, 3);
            const self = this.symbolIndex().definitions(files(this), word, path).find(d => d.path === path && d.line === line);
            (defs.length ? defs : self ? [self] : []).forEach(d => {
                const f = this.virtualProjectFiles.get(d.path);
                const doc = f ? intel.docFor(f.content, d.line, d.path) : '';
                parts.push(`<div class="hv-def"><div class="hv-sig"><i class="fa-solid ${KIND_ICON[d.kind] || 'fa-tag'}"></i> <code>${esc(d.signature)}</code></div>${doc ? `<div class="hv-doc">${esc(doc)}</div>` : ''}<div class="hv-dim">${esc(d.path)}:${d.line} • F12 للانتقال • Shift+F12 الاستخدامات</div></div>`);
            });
        }
        if (parts.length && this.hasAIKey && this.hasAIKey() && intel.isCodeFile(path)) parts.push(`<button type="button" class="hv-ai" onclick="app.aiExplainLine(${+line})"><i class="fa-solid fa-wand-magic-sparkles"></i> اشرح هذا السطر</button>`);
        return parts.length ? { html: `<div class="cm-ox-hover" dir="auto">${parts.join('')}</div>` } : null;
    };
    const CM_TYPE = { function: 'function', method: 'method', class: 'class', interface: 'interface', type: 'type', enum: 'enum', variable: 'variable', struct: 'class', trait: 'interface', module: 'namespace' };
    P.editorCompletions = function (prefix, path) {
        const fam = intel.familyOf(path);
        if (!fam || !prefix) return [];
        const lower = prefix.toLowerCase(), seen = new Set(), out = [];
        const idx = this.symbolIndex();
        for (const [p, f] of files(this)) {
            if (p === path || !f || typeof f.content !== 'string' || intel.familyOf(p) !== fam) continue;
            for (const sy of idx.fileSymbols(p, f.content, f.timestamp)) {
                if (seen.has(sy.name) || sy.name.length < 2 || !sy.name.toLowerCase().startsWith(lower) || sy.name === prefix) continue;
                seen.add(sy.name);
                out.push({ label: sy.name, type: CM_TYPE[sy.kind] || 'variable', detail: intel.baseName(p), info: sy.signature, boost: sy.exported ? 1 : 0 });
                if (out.length >= 60) return out;
            }
        }
        return out;
    };

    // ------------------------------------------------------------------ LINT
    P.lintForEditor = async function (doc, path) {
        const out = [];
        const s = this.getEditorSettings();
        if (intel.familyOf(path) && doc.length < 300000) {
            const map = files(this);
            const refCount = (name) => {
                for (const [p, f] of map) {
                    if (p === path || !f || typeof f.content !== 'string' || !intel.isCodeFile(p) || !f.content.includes(name)) continue;
                    if (intel.findOccurrences(f.content, name, p).length) return 1;
                }
                return 0;
            };
            try { out.push(...intel.unusedDiagnostics(doc, path, { refCount })); } catch (e) { /* best effort */ }
        }
        if (s.eslint && /^(js|jsx|mjs|cjs)$/.test(intel.extOf(path)) && this.toolsRequest && !(this.isDataSaver && this.isDataSaver()) && navigator.onLine !== false && doc.length < 200000) {
            try {
                const res = await this.toolsRequest('lint', { code: doc, path }, { timeout: 20000 });
                (res && res.messages || []).forEach(m => {
                    const from = posOf(doc, m.line || 1, m.column || 1);
                    const to = m.endLine ? Math.max(from, posOf(doc, m.endLine, m.endColumn || m.column)) : from;
                    out.push({ from, to: to === from ? Math.min(doc.length, from + 1) : to, severity: m.severity === 2 ? 'error' : 'warning', message: m.message + (m.ruleId ? ` (${m.ruleId})` : ''), source: 'eslint' });
                });
            } catch (e) { /* worker unavailable — keep local diagnostics */ }
        }
        if (this._aiDiags && this._aiDiags.path === path && this._aiDiags.doc === doc) out.push(...this._aiDiags.list);
        return out;
    };

    // ------------------------------------------------------------------ NAVIGATION
    P.openFileAt = function (path, line = 1, col = 1) {
        if (!this.virtualProjectFiles.has(path)) { this.showToast(`الملف غير موجود: ${path}`, 'warning'); return false; }
        if (!this.isCodeStudioOpen) this.toggleCodeStudio(true);
        if (this.activeStudioFile !== path) this.switchStudioFile(path);
        if (!this.isCodeEditorActive()) this.mountCodeEditor();
        const ctl = this.codeEditor;
        if (ctl) {
            const doc = ctl.view.state.doc;
            const l = doc.line(Math.max(1, Math.min(+line || 1, doc.lines)));
            ctl.setSelection(Math.min(l.to, l.from + Math.max(0, (+col || 1) - 1)));
            ctl.focus();
        }
        return true;
    };
    P.openRefRow = function (el) {
        if (!el || !el.dataset) return;
        this.closeModals();
        this.openFileAt(el.dataset.path, +el.dataset.line, +el.dataset.col || 1);
    };
    P.currentWord = function () { const w = this.codeEditor && this.codeEditor.wordAt(); return w ? w.word : ''; };
    P.gotoDefinition = function (word) {
        const ctl = this.codeEditor;
        if (!ctl) return null;
        const path = this.activeStudioFile;
        // F12 on an import specifier opens the imported file
        const head = ctl.getSelection().head, text = ctl.getValue();
        const imp = intel.parseImports(text, path).find(i => head >= i.start - 1 && head <= i.end + 1);
        if (imp) {
            const has = (p) => this.virtualProjectFiles.has(p);
            const target = intel.isPy(path) ? intel.resolvePyModule(path, imp.spec, has) : intel.resolveImport(path, imp.spec, has);
            if (target) { this.openFileAt(target, 1, 1); return { path: target, line: 1 }; }
        }
        word = word || this.currentWord();
        if (!word) return null;
        const defs = this.symbolIndex().definitions(files(this), word, path);
        if (!defs.length) { this.showToast(`لا يوجد تعريف لـ «${word}» في المشروع`, 'warning'); return null; }
        if (defs.length === 1) { this.openFileAt(defs[0].path, defs[0].line, defs[0].col); return defs[0]; }
        const anchor = ctl.view.coordsAtPos(head) || null;
        this.showMenu(defs.slice(0, 20).map(d => ({ icon: KIND_ICON[d.kind] || 'fa-tag', label: `${d.path}:${d.line} — ${d.signature.slice(0, 60)}`, run: () => this.openFileAt(d.path, d.line, d.col) })), anchor ? { x: anchor.left, y: anchor.bottom + 4 } : null);
        return defs;
    };
    P.findReferences = function (word) {
        word = word || this.currentWord();
        if (!word) { this.showToast('ضع المؤشر على اسم أولاً', 'info'); return []; }
        const refs = this.symbolIndex().references(files(this), word);
        const byFile = new Map();
        refs.forEach(r => { if (!byFile.has(r.path)) byFile.set(r.path, []); byFile.get(r.path).push(r); });
        const body = refs.length ? Array.from(byFile, ([p, list]) => `<div class="gh-card ref-group"><div class="ref-file"><i class="fa-solid fa-file-code"></i> <b dir="ltr">${esc(p)}</b> <span class="gh-badge">${list.length}</span></div>${list.slice(0, 200).map(r => `<button type="button" class="ref-row" data-path="${esc(p)}" data-line="${r.line}" data-col="${r.col}" onclick="app.openRefRow(this)"><span class="ref-ln">${r.line}</span><code dir="ltr">${esc(r.lineText.trim().slice(0, 160))}</code></button>`).join('')}</div>`).join('')
            : `<p class="gh-empty">لا توجد استخدامات لـ «${esc(word)}»</p>`;
        this.openPanel({ title: `استخدامات «${word}» — ${refs.length} في ${byFile.size} ملف`, icon: 'fa-magnifying-glass-location', body, actions: refs.length ? `<button class="gh-btn" onclick="app.renameSymbol('${esc(word)}')"><i class="fa-solid fa-i-cursor"></i> إعادة تسمية</button>` : '' });
        return refs;
    };
    P.restoreFileContents = function (list) {
        list.forEach(([p, content]) => { if (this.virtualProjectFiles.has(p)) this.writeProjectFile(p, content, 'undo'); });
        this.refreshActiveEditor();
        if (this.scheduleProjectSave) this.scheduleProjectSave();
    };
    P.refreshActiveEditor = function () {
        const ctl = this.codeEditor, p = this.activeStudioFile;
        if (!ctl || !p) return;
        const f = this.virtualProjectFiles.get(p);
        if (f && typeof f.content === 'string' && ctl.getPath() === p) ctl.setValue(f.content);
        if (this._splitEditor) { const sp = this._splitEditor.ctl.getPath(), sf = this.virtualProjectFiles.get(sp); if (sf && typeof sf.content === 'string') this._splitEditor.ctl.setValue(sf.content); }
    };
    P.applyFileUpdates = function (updates, reason = 'refactor') {
        const before = updates.filter(u => this.virtualProjectFiles.has(u.path)).map(u => [u.path, this.virtualProjectFiles.get(u.path).content]);
        updates.forEach(u => this.writeProjectFile(u.path, u.content, reason));
        this.refreshActiveEditor();
        if (this.scheduleProjectSave) this.scheduleProjectSave();
        return before;
    };
    P.renameSymbol = async function (word) {
        word = word || this.currentWord();
        if (!word) { this.showToast('ضع المؤشر على اسم أولاً', 'info'); return null; }
        const nn = await this.askText(`إعادة تسمية «${word}» في كل المشروع`, word, { label: 'الاسم الجديد', validate: (v) => (/^[A-Za-z_$][\w$]*$/.test(v) ? null : 'اسم غير صالح (حروف لاتينية وأرقام و _ $)') });
        if (!nn || nn === word) return null;
        let plan;
        try { plan = intel.planRename(files(this), word, nn); } catch (e) { this.showToast(e.message, 'error'); return null; }
        if (!plan.length) { this.showToast('لا توجد مواضع لإعادة تسميتها', 'info'); return null; }
        const total = plan.reduce((n, p) => n + p.count, 0);
        const ok = await this.askConfirm(`إعادة تسمية ${word} ← ${nn}`, `${total} موضع في ${plan.length} ملف:<br>${plan.slice(0, 25).map(p => `<code dir="ltr">${esc(p.path)}</code> (${p.count})`).join('<br>')}${plan.length > 25 ? '<br>…' : ''}`, { okLabel: 'إعادة التسمية' });
        if (!ok) return null;
        const before = this.applyFileUpdates(plan, 'refactor');
        this.showActionToast(`تمت إعادة التسمية: ${total} موضع في ${plan.length} ملف`, 'تراجع', () => this.restoreFileContents(before), 'success');
        return plan;
    };

    // ------------------------------------------------------------------ IMPORT UPDATES ON MOVE/RENAME + SAFE DELETE
    const textSnapshot = (app) => new Map(Array.from(app.virtualProjectFiles, ([p, f]) => [p, f && typeof f.content === 'string' && !f.dataUrl ? { content: f.content, timestamp: f.timestamp } : { binary: true }]));
    const wrapMove = (name) => {
        const orig = P[name];
        if (!orig || orig.__oxImports) return;
        const fn = function (...args) {
            const top = !this._moveDepth;
            if (top) { this._moveLog = []; this._moveSnapshot = textSnapshot(this); }
            this._moveDepth = (this._moveDepth || 0) + 1;
            let res;
            try {
                res = orig.apply(this, args);
                if (name === 'renameProjectFile' && res && res !== args[0]) {
                    this._moveLog.push([args[0], res]);
                    if (this.codeEditor) this.codeEditor.renamePath(args[0], res);
                }
            } finally { this._moveDepth--; }
            if (top) {
                const log = this._moveLog, snap = this._moveSnapshot;
                this._moveLog = null; this._moveSnapshot = null;
                if (log.length && this.getEditorSettings().updateImportsOnMove !== false) this.updateImportsAfterMove(snap, log);
            }
            return res;
        };
        fn.__oxImports = true;
        P[name] = fn;
    };
    ['renameProjectFile', 'renameProjectFolder', 'moveProjectPaths'].forEach(wrapMove);
    P.updateImportsAfterMove = function (snapshot, log) {
        const mapping = new Map(log);
        const { updates, total } = intel.computeImportUpdates(snapshot, mapping);
        const live = updates.filter(u => this.virtualProjectFiles.has(u.path));
        if (!live.length) return null;
        const before = this.applyFileUpdates(live, 'refactor');
        this.showActionToast(`تم تحديث ${total} استيراد في ${live.length} ملف`, 'تراجع', () => this.restoreFileContents(before), 'success');
        return { updates: live, total };
    };
    const origDelete = P.deleteProjectPaths;
    if (origDelete && !origDelete.__oxSafe) {
        const del = function (paths, opts = {}) {
            if (opts.force || opts.toast === false) return origDelete.call(this, paths, opts);
            const doomed = new Set();
            (paths || []).forEach(p => { if (this.virtualProjectFiles.has(p)) doomed.add(p); else this.projectPaths().filter(x => x.startsWith(p + '/')).forEach(x => doomed.add(x)); });
            const importers = [];
            doomed.forEach(t => intel.findImporters(files(this), t).forEach(i => { if (!doomed.has(i.path)) importers.push({ ...i, target: t }); }));
            if (!importers.length) return origDelete.call(this, paths, opts);
            return this.askConfirm('حذف آمن — هذه الملفات مستخدمة', `${importers.length} استيراد سيتعطل:<br>${importers.slice(0, 15).map(i => `<code dir="ltr">${esc(i.path)}:${i.line}</code> ← <code dir="ltr">${esc(i.spec)}</code>`).join('<br>')}${importers.length > 15 ? '<br>…' : ''}<br><br>هل تريد الحذف رغم ذلك؟`, { okLabel: 'احذف على أي حال', danger: true })
                .then(ok => (ok ? origDelete.call(this, paths, { ...opts, force: true }) : []));
        };
        del.__oxSafe = true;
        P.deleteProjectPaths = del;
    }

    // ------------------------------------------------------------------ TEXT TRANSFORMS
    P.changeCaseSelection = function (mode) {
        const ctl = this.codeEditor;
        if (!ctl || !intel.CASES[mode]) return false;
        const sel = ctl.getSelection();
        if (sel.from === sel.to) { const w = ctl.wordAt(); if (!w) return false; ctl.setSelection(w.from, w.to, { scroll: false }); }
        ctl.transformSelections((t) => intel.changeCase(t, mode));
        ctl.focus();
        return true;
    };
    P.sortSelectedLines = function (mode = 'asc') {
        const ctl = this.codeEditor;
        if (!ctl) return false;
        const sel = ctl.getSelection();
        if (sel.from === sel.to) {
            const text = ctl.getValue();
            const trail = text.endsWith('\n');
            const sorted = intel.sortLines(trail ? text.slice(0, -1) : text, mode);
            ctl.replaceRange(0, text.length, sorted + (trail ? '\n' : ''), 0);
        } else {
            const blocks = ctl.selectedLineBlocks();
            for (let i = blocks.length - 1; i >= 0; i--) { const b = blocks[i]; ctl.replaceRange(b.from, b.to, intel.sortLines(b.text, mode), b.from, b.from + b.text.length); }
        }
        ctl.focus();
        return true;
    };
    P.trimTrailingWhitespace = function ({ quiet = false } = {}) {
        const ctl = this.codeEditor;
        if (!ctl) return 0;
        const text = ctl.getValue(), out = intel.trimTrailing(text);
        if (out === text) { if (!quiet) this.showToast('لا توجد مسافات زائدة', 'info'); return 0; }
        ctl.setValue(out, { notify: true });
        if (!quiet) this.showToast('تم حذف المسافات الزائدة في نهاية الأسطر', 'success');
        return text.length - out.length;
    };

    // ------------------------------------------------------------------ GENERATORS
    P.generateClassMembers = function (what = 'accessors') {
        const ctl = this.codeEditor;
        if (!ctl) return null;
        const info = intel.classAt(ctl.getValue(), ctl.getSelection().head, this.activeStudioFile);
        if (!info) { this.showToast('ضع المؤشر داخل class أولاً', 'info'); return null; }
        if (!info.fields.length) { this.showToast('لا توجد حقول في هذا الصنف', 'info'); return null; }
        const code = what === 'constructor' ? intel.generateConstructor(info) : intel.generateAccessors(info);
        if (!code) { this.showToast(what === 'constructor' ? 'يوجد مُنشئ بالفعل' : 'لا شيء لتوليده', 'info'); return null; }
        ctl.replaceRange(info.insertPos, info.insertPos, code, info.insertPos + code.length);
        this.showToast(what === 'constructor' ? `تم توليد مُنشئ لـ ${info.name}` : `تم توليد getters/setters لـ ${info.name}`, 'success');
        return code;
    };
    P.jsonToTypesFromEditor = async function (lang) {
        const ctl = this.codeEditor;
        if (!ctl) return null;
        const sel = ctl.getSelection();
        const src = sel.from !== sel.to ? ctl.getValue().slice(sel.from, sel.to) : ctl.getValue();
        if (!lang) {
            const r = await this.showDialog({
                title: 'توليد أنواع/نماذج من JSON', body: '<p class="ox-dialog-msg">يستخدم التحديد الحالي أو الملف كاملاً.</p>',
                fields: [{ id: 'lang', label: 'اللغة', type: 'select', options: Object.entries(intel.MODEL_LANGS).map(([v, l]) => ({ value: v, label: l })), value: 'ts' }, { id: 'root', label: 'اسم النوع الجذر', value: 'Root', dir: 'ltr' }],
                buttons: [{ label: 'توليد', value: 'ok', primary: true }, { label: 'إلغاء', value: null }]
            });
            if (!r) return null;
            lang = r.values.lang; this._typesRoot = r.values.root;
        }
        let code;
        try { code = intel.jsonToTypes(src, lang, (this._typesRoot || 'Root').trim() || 'Root'); } catch (e) { this.showToast('JSON غير صالح: ' + e.message, 'error'); return null; }
        const base = intel.baseName(this.activeStudioFile || 'data.json').replace(/\.[^.]+$/, '');
        const dir = intel.dirName(this.activeStudioFile || '');
        const target = this.uniqueProjectPath ? this.uniqueProjectPath((dir ? dir + '/' : '') + base + '.types.' + intel.MODEL_EXT[lang]) : base + '.types.' + intel.MODEL_EXT[lang];
        this.createProjectFile(target, code, { open: true, reason: 'generated' });
        this.showToast(`تم إنشاء ${target}`, 'success');
        return { path: target, code };
    };
    P.convertCjsToEsm = function () {
        const ctl = this.codeEditor;
        if (!ctl) return null;
        const r = intel.cjsToEsm(ctl.getValue());
        if (!r.changes) { this.showToast('لا توجد صيغ CommonJS لتحويلها', 'info'); return r; }
        ctl.setValue(r.code, { notify: true });
        this.showToast(`تم تحويل ${r.changes} سطر إلى ES Modules`, 'success');
        return r;
    };
    P.insertFakeData = async function (preset) {
        const ctl = this.codeEditor;
        let o = preset;
        if (!o) {
            const ext = intel.extOf(this.activeStudioFile);
            const r = await this.showDialog({
                title: 'توليد بيانات وهمية', body: '',
                fields: [
                    { id: 'kind', label: 'النوع', type: 'select', options: Object.entries(intel.FAKE_KINDS).map(([v, l]) => ({ value: v, label: l })), value: 'users' },
                    { id: 'count', label: 'العدد', value: '10', dir: 'ltr' },
                    { id: 'format', label: 'الصيغة', type: 'select', options: ['json', 'csv', 'sql', 'js', 'python'].map(v => ({ value: v, label: v.toUpperCase() })), value: ext === 'csv' ? 'csv' : ext === 'sql' ? 'sql' : ext === 'py' ? 'python' : /^(js|ts|jsx|tsx|mjs)$/.test(ext) ? 'js' : 'json' },
                    { id: 'locale', label: 'اللغة', type: 'select', options: [{ value: 'en', label: 'English' }, { value: 'ar', label: 'العربية' }], value: 'en' }
                ],
                buttons: [{ label: 'إدراج', value: 'ok', primary: true }, { label: 'إلغاء', value: null }]
            });
            if (!r) return null;
            o = r.values;
        }
        const text = intel.fakeData(o.kind, Math.max(1, Math.min(1000, parseInt(o.count, 10) || 10)), { format: o.format, locale: o.locale, seed: o.seed });
        if (ctl) { ctl.insertAtCursor(text); ctl.focus(); }
        return text;
    };

    // ------------------------------------------------------------------ PRETTIER
    const _origFormat = P.formatStudioCode;
    P.formatStudioCode = async function ({ quiet = false } = {}) {
        const ctl = this.codeEditor;
        const path = this.activeStudioFile || '';
        if (!ctl || !this.isCodeEditorActive() || !this.prettierParserFor || !this.prettierParserFor(path) || !this.toolsRequest) return _origFormat ? _origFormat.apply(this, arguments) : null;
        const code = ctl.getValue();
        let res;
        try { res = await this.toolsRequest('format', { code, path, options: { tabWidth: +this.getEditorSettings().tabSize || 2 } }, { timeout: 30000 }); } catch (e) { res = { error: e.message }; }
        if (!res || res.error) {
            if (!quiet) this.showToast('تعذر التنسيق: ' + String((res && res.error) || 'خطأ').split('\n')[0].slice(0, 160), 'error');
            if (res && res.loc && res.loc.line) ctl.scrollToLine(res.loc.line);
            return null;
        }
        if (res.code === code) { if (!quiet) this.showToast('الملف منسق بالفعل ✨', 'info'); return code; }
        if (ctl.getValue() !== code) return null; // user typed meanwhile
        ctl.setValue(res.code, { notify: true });
        if (!quiet) this.showToast('تم التنسيق بـ Prettier ✨', 'success');
        return res.code;
    };

    // ------------------------------------------------------------------ DEPENDENCIES (#234) + FOLDER COMPARE (#249)
    P.projectPackageJson = function () {
        const f = this.virtualProjectFiles.get('package.json');
        try { return f ? JSON.parse(f.content) : null; } catch (e) { return null; }
    };
    P.analyzeDependencies = function (path = this.activeStudioFile) {
        const map = files(this);
        const has = (p) => map.has(p);
        const f = map.get(path);
        const imports = f && typeof f.content === 'string' ? intel.parseImports(f.content, path).map(i => {
            const target = intel.isPy(path) ? intel.resolvePyModule(path, i.spec, has) : intel.resolveImport(path, i.spec, has);
            return { ...i, target, external: !target && !/^\./.test(i.spec) };
        }) : [];
        const importers = path ? intel.findImporters(map, path) : [];
        const pkg = this.projectPackageJson();
        const declared = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {};
        const used = new Map();
        for (const [p, ff] of map) {
            if (!ff || typeof ff.content !== 'string' || !intel.isJS(p)) continue;
            intel.parseImports(ff.content, p).forEach(i => {
                if (/^[./]/.test(i.spec) || /^node:/.test(i.spec)) return;
                const name = i.spec.startsWith('@') ? i.spec.split('/').slice(0, 2).join('/') : i.spec.split('/')[0];
                if (!used.has(name)) used.set(name, []);
                used.get(name).push(p);
            });
        }
        const packages = Object.keys(declared).map(n => ({ name: n, version: declared[n], dev: !!(pkg.devDependencies && n in pkg.devDependencies), usedIn: used.get(n) || [] }));
        const missing = Array.from(used.keys()).filter(n => !(n in declared)).map(n => ({ name: n, usedIn: used.get(n) }));
        return { path, imports, importers, packages, missing };
    };
    P.openDependencies = function (path = this.activeStudioFile) {
        const d = this.analyzeDependencies(path);
        const row = (p, line, txt) => `<button type="button" class="ref-row" data-path="${esc(p)}" data-line="${line}" onclick="app.openRefRow(this)"><span class="ref-ln">${line}</span><code dir="ltr">${esc(txt)}</code></button>`;
        const body = `
            <div class="gh-card"><h4><i class="fa-solid fa-arrow-right-to-bracket"></i> يستورد (${d.imports.length})</h4>${d.imports.map(i => i.target ? row(i.target, 1, `${i.spec} → ${i.target}`) : `<div class="ref-row static"><code dir="ltr">${esc(i.spec)}</code> <span class="gh-badge">${i.external ? 'حزمة' : 'غير موجود'}</span></div>`).join('') || '<p class="gh-empty">لا توجد استيرادات</p>'}</div>
            <div class="gh-card"><h4><i class="fa-solid fa-arrow-right-from-bracket"></i> مستخدم في (${d.importers.length})</h4>${d.importers.map(i => row(i.path, i.line, `${i.path}:${i.line}  ${i.spec}`)).join('') || '<p class="gh-empty">لا يستورده أي ملف</p>'}</div>
            <div class="gh-card"><h4><i class="fa-solid fa-box"></i> حزم package.json (${d.packages.length})</h4>${d.packages.length ? `<table class="csv-table" dir="ltr"><thead><tr><th>Package</th><th>Version</th><th>Type</th><th>Used</th></tr></thead><tbody>${d.packages.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.version)}</td><td>${p.dev ? 'dev' : 'prod'}</td><td>${p.usedIn.length ? p.usedIn.length + ' files' : '<span class="text-amber">unused?</span>'}</td></tr>`).join('')}</tbody></table>` : '<p class="gh-empty">لا يوجد package.json</p>'}
            ${d.missing.length ? `<p class="text-amber">حزم مستوردة غير مُعرّفة: ${d.missing.map(m => `<code>${esc(m.name)}</code>`).join(' ')}</p>` : ''}</div>`;
        this.openPanel({ title: `التبعيات — ${path || 'المشروع'}`, icon: 'fa-sitemap', body });
        return d;
    };
    P.projectDirs = function () {
        const dirs = new Set(this.projectFolders ? Array.from(this.projectFolders) : []);
        this.projectPaths().forEach(p => { const parts = p.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')); });
        return Array.from(dirs).sort();
    };
    P.compareFoldersUI = async function (a, b) {
        if (!a || !b) {
            const dirs = this.projectDirs();
            if (dirs.length < 2) { this.showToast('تحتاج مجلدين على الأقل للمقارنة', 'info'); return null; }
            const r = await this.showDialog({
                title: 'مقارنة مجلدين', body: '',
                fields: [{ id: 'a', label: 'المجلد الأول', type: 'select', options: dirs.map(d => ({ value: d, label: d })), value: dirs[0] }, { id: 'b', label: 'المجلد الثاني', type: 'select', options: dirs.map(d => ({ value: d, label: d })), value: dirs[1] }],
                buttons: [{ label: 'مقارنة', value: 'ok', primary: true }, { label: 'إلغاء', value: null }]
            });
            if (!r) return null;
            a = r.values.a; b = r.values.b;
        }
        const res = intel.compareFolders(files(this), a, b);
        this._folderCompare = { a, b };
        const li = (rel, cls, click) => `<div class="cmp-row ${cls}">${click ? `<button type="button" class="gh-btn" data-rel="${esc(rel)}" onclick="app.diffCompared(this.dataset.rel)"><i class="fa-solid fa-code-compare"></i></button>` : ''}<code dir="ltr">${esc(rel)}</code></div>`;
        const body = `<p dir="ltr"><code>${esc(a)}</code> ⇄ <code>${esc(b)}</code> — ${res.changed.length} changed • ${res.onlyA.length} only A • ${res.onlyB.length} only B • ${res.same.length} identical</p>
            <div class="gh-card"><h4>مختلفة (${res.changed.length})</h4>${res.changed.map(r => li(r, 'changed', true)).join('') || '—'}</div>
            <div class="gh-card"><h4>فقط في ${esc(a)} (${res.onlyA.length})</h4>${res.onlyA.map(r => li(r, 'only-a')).join('') || '—'}</div>
            <div class="gh-card"><h4>فقط في ${esc(b)} (${res.onlyB.length})</h4>${res.onlyB.map(r => li(r, 'only-b')).join('') || '—'}</div>
            <div class="gh-card"><h4>متطابقة (${res.same.length})</h4>${res.same.map(r => li(r, 'same')).join('') || '—'}</div>`;
        this.openPanel({ title: 'مقارنة المجلدات', icon: 'fa-code-compare', body });
        return res;
    };
    P.diffCompared = function (rel) {
        const c = this._folderCompare;
        if (!c || !this.renderDiffHTML || !this.diffLines) return;
        const A = (this.virtualProjectFiles.get(c.a + '/' + rel) || {}).content || '';
        const B = (this.virtualProjectFiles.get(c.b + '/' + rel) || {}).content || '';
        const ol = A.split('\n'), nl = B.split('\n');
        this.showDialog({ title: `${c.a}/${rel} ⇄ ${c.b}/${rel}`, body: `<div class="diff-scroll">${this.renderDiffHTML(ol, nl, this.diffLines(ol, nl))}</div>`, buttons: [{ label: 'إغلاق', value: null }], wide: true });
    };
}
