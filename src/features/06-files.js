/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 4a: Project files
   Studio file explorer, version history, trash, bulk operations, project-wide
   search & replace, compare, stats, duplicates, templates, auto-backup.
   Ideas implemented (THOUSAND_IDEAS.md):
     #531 interactive tree + drag & drop   #538 compare two files   #539/#575/#576/#580 file versions
     #540 trash / undo delete              #542 regex search        #543 bulk search & replace
     #544 batch rename   #545 bulk move    #546 bulk delete         #547 bulk ZIP
     #549 folder stats   #570/#620/#648 pin / favourites            #574 auto-backup (IndexedDB)
     #600 sort by type   #601 new file from template               #602 folder scaffolds
     #603 duplicate file #611 hidden files #612/#613 sizes & dates   #616/#617/#645 paths
     #618 open in new tab  #623/#624 duplicate detection           #640 recent files
     #641 file shortcuts   #643/#644 Ctrl/Shift multi-select
   ============================================================================== */
(function () {
    'use strict';
    if (typeof OXAlphaApp === 'undefined') return;
    const P = OXAlphaApp.prototype;

    const MAX_VERSIONS = 30;
    const MAX_VERSIONED_SIZE = 512 * 1024;
    const EDIT_SESSION_MS = 60 * 1000;   // typing within a minute = one checkpoint
    const MAX_TRASH = 50;
    const MAX_TABS = 12;
    const IDB_KEY = 'project_files_v1';

    // ------------------------------------------------------------------ UTILITIES
    const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
    const byteLen = (s) => (s == null ? 0 : (enc && s.length < 4e6 ? enc.encode(s).length : String(s).length));
    const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
    const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16) + ':' + s.length; };
    const baseName = (p) => String(p).split('/').pop();
    const dirName = (p) => { const i = String(p).lastIndexOf('/'); return i === -1 ? '' : p.slice(0, i); };
    const extOf = (p) => { const b = baseName(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
    const joinPath = (dir, name) => (dir ? `${dir.replace(/\/+$/, '')}/${name}` : name);
    function normPath(p) {
        const parts = String(p || '').replace(/\\/g, '/').split('/').map(s => s.trim()).filter(s => s && s !== '.');
        if (parts.some(s => s === '..')) return '';
        return parts.join('/');
    }
    const isHidden = (p) => String(p).split('/').some(s => s.startsWith('.'));
    P.fmtBytes = fmtBytes;
    P.normPath = normPath;
    P.fileExt = extOf;
    P.contentHash = fnv;

    const ICONS = {
        js: ['fa-brands fa-js', '#facc15'], mjs: ['fa-brands fa-js', '#facc15'], cjs: ['fa-brands fa-js', '#facc15'], jsx: ['fa-brands fa-react', '#38bdf8'],
        ts: ['fa-solid fa-code', '#60a5fa'], tsx: ['fa-brands fa-react', '#60a5fa'], py: ['fa-brands fa-python', '#60a5fa'], html: ['fa-brands fa-html5', '#fb923c'],
        css: ['fa-brands fa-css3-alt', '#38bdf8'], scss: ['fa-brands fa-sass', '#f472b6'], json: ['fa-solid fa-brackets-curly', '#fbbf24'], md: ['fa-brands fa-markdown', '#cbd5e1'],
        vue: ['fa-brands fa-vuejs', '#34d399'], php: ['fa-brands fa-php', '#a78bfa'], java: ['fa-brands fa-java', '#f87171'], rs: ['fa-brands fa-rust', '#fb923c'],
        go: ['fa-brands fa-golang', '#22d3ee'], sh: ['fa-solid fa-terminal', '#34d399'], yml: ['fa-solid fa-sliders', '#f472b6'], yaml: ['fa-solid fa-sliders', '#f472b6'],
        sql: ['fa-solid fa-database', '#fbbf24'], csv: ['fa-solid fa-table', '#34d399'], tsv: ['fa-solid fa-table', '#34d399'], xlsx: ['fa-solid fa-file-excel', '#22c55e'],
        pdf: ['fa-solid fa-file-pdf', '#f87171'], docx: ['fa-solid fa-file-word', '#60a5fa'], pptx: ['fa-solid fa-file-powerpoint', '#fb923c'], svg: ['fa-solid fa-bezier-curve', '#fbbf24'],
        png: ['fa-solid fa-file-image', '#c084fc'], jpg: ['fa-solid fa-file-image', '#c084fc'], jpeg: ['fa-solid fa-file-image', '#c084fc'], gif: ['fa-solid fa-file-image', '#c084fc'],
        webp: ['fa-solid fa-file-image', '#c084fc'], avif: ['fa-solid fa-file-image', '#c084fc'], mp3: ['fa-solid fa-file-audio', '#f472b6'], wav: ['fa-solid fa-file-audio', '#f472b6'],
        ogg: ['fa-solid fa-file-audio', '#f472b6'], webm: ['fa-solid fa-file-video', '#fb7185'], mp4: ['fa-solid fa-file-video', '#fb7185'], zip: ['fa-solid fa-file-zipper', '#fbbf24'],
        ttf: ['fa-solid fa-font', '#e2e8f0'], otf: ['fa-solid fa-font', '#e2e8f0'], woff: ['fa-solid fa-font', '#e2e8f0'], woff2: ['fa-solid fa-font', '#e2e8f0'],
        gitignore: ['fa-brands fa-git-alt', '#f87171'], env: ['fa-solid fa-key', '#fbbf24'], lock: ['fa-solid fa-lock', '#94a3b8'], txt: ['fa-solid fa-file-lines', '#94a3b8']
    };
    P.fileIcon = function (path) {
        const name = baseName(path).toLowerCase();
        if (name === 'dockerfile') return ['fa-brands fa-docker', '#38bdf8'];
        if (name === 'package.json') return ['fa-brands fa-npm', '#f87171'];
        if (name.startsWith('.git')) return ICONS.gitignore;
        return ICONS[extOf(path)] || ['fa-solid fa-file-code', '#94a3b8'];
    };

    /** A project entry is "binary" when it carries a data URL / media payload instead of text. */
    const isBinaryEntry = (f) => !!(f && (f.dataUrl || f.binary));
    P.isBinaryProjectFile = function (path) { return isBinaryEntry(this.virtualProjectFiles.get(path)); };
    const entrySize = (f) => (f ? (f.size != null ? f.size : byteLen(f.content || '')) : 0);

    // ------------------------------------------------------------------ DIALOG (replaces prompt/confirm)
    P.showDialog = function ({ title, body = '', fields = [], buttons = [{ label: 'موافق', value: 'ok', primary: true }, { label: 'إلغاء', value: null }], wide = false }) {
        const modal = document.getElementById('ox-dialog');
        if (!modal) return Promise.resolve(null);
        const box = modal.querySelector('.ox-dialog-box');
        if (box) box.classList.toggle('wide', !!wide);
        if (this._dialogResolve) this.resolveDialog(null);
        this._dialogButtons = buttons;
        this._dialogFields = fields;
        document.getElementById('ox-dialog-title').textContent = title || '';
        const esc = (x) => this.escapeHTML(x);
        document.getElementById('ox-dialog-body').innerHTML = body + fields.map(f => {
            const id = `oxd-${f.id}`;
            const label = f.label ? `<label class="form-label-title" for="${id}">${esc(f.label)}</label>` : '';
            if (f.type === 'select') return `<div class="ox-field">${label}<select id="${id}" class="form-input-box">${(f.options || []).map(o => `<option value="${esc(o.value)}" ${o.value === f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>`;
            if (f.type === 'textarea') return `<div class="ox-field">${label}<textarea id="${id}" class="form-input-box" rows="${f.rows || 4}" placeholder="${esc(f.placeholder || '')}" dir="${f.dir || 'auto'}">${esc(f.value || '')}</textarea></div>`;
            if (f.type === 'checkbox') return `<label class="gh-check ox-field"><input type="checkbox" id="${id}" ${f.value ? 'checked' : ''}> ${esc(f.label)}</label>`;
            return `<div class="ox-field">${label}<input id="${id}" ${f.type === 'password' ? 'type="password" inputmode="numeric"' : ''} class="form-input-box" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" dir="${f.dir || 'auto'}" autocomplete="off"></div>`;
        }).join('') + '<div id="ox-dialog-error" class="ox-dialog-error"></div>';
        document.getElementById('ox-dialog-buttons').innerHTML = buttons.map((b, i) => `<button class="${b.primary ? 'btn-new-thread' : 'sidebar-btn-util'} gh-btn ${b.danger ? 'danger' : ''}" onclick="app.resolveDialog(${i})">${esc(b.label)}</button>`).join('');
        modal.classList.add('active');
        const first = modal.querySelector('input:not([type=checkbox]), textarea, select');
        if (first) {
            setTimeout(() => {
                first.focus();
                if (first.select && first.dataset.selectBase !== 'no') {
                    const v = first.value, dot = v.lastIndexOf('.'), slash = v.lastIndexOf('/');
                    if (dot > slash + 1) first.setSelectionRange(slash + 1, dot); else first.select();
                }
            }, 30);
            modal.querySelectorAll('input:not([type=checkbox])').forEach(inp => inp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); const pi = buttons.findIndex(b => b.primary); this.resolveDialog(pi === -1 ? 0 : pi); }
            }));
        }
        return new Promise(resolve => { this._dialogResolve = resolve; });
    };

    P.resolveDialog = function (index) {
        const resolve = this._dialogResolve;
        if (!resolve) return;
        const btn = index === null || index === undefined ? null : this._dialogButtons[index];
        const values = {};
        (this._dialogFields || []).forEach(f => {
            const el = document.getElementById(`oxd-${f.id}`);
            values[f.id] = el ? (f.type === 'checkbox' ? el.checked : el.value) : undefined;
        });
        if (btn && btn.value !== null && btn.validate) {
            const err = btn.validate(values);
            if (err) { const e = document.getElementById('ox-dialog-error'); if (e) e.textContent = err; return; }
        }
        this._dialogResolve = null;
        document.getElementById('ox-dialog')?.classList.remove('active');
        resolve(!btn || btn.value === null ? null : { button: btn.value, values });
    };

    P.askText = async function (title, value = '', opts = {}) {
        const r = await this.showDialog({
            title, body: opts.body || '',
            fields: [{ id: 'text', label: opts.label, value, placeholder: opts.placeholder, dir: opts.dir || 'ltr' }],
            buttons: [{ label: opts.okLabel || 'موافق', value: 'ok', primary: true, validate: opts.validate ? (v) => opts.validate(v.text.trim()) : null }, { label: 'إلغاء', value: null }]
        });
        return r ? r.values.text.trim() : null;
    };

    P.askConfirm = async function (title, message, opts = {}) {
        const r = await this.showDialog({
            title, body: `<p class="ox-dialog-msg">${message}</p>`,
            buttons: [{ label: opts.okLabel || 'تأكيد', value: 'ok', primary: !opts.danger, danger: !!opts.danger }, { label: 'إلغاء', value: null }]
        });
        return !!r;
    };

    /** Toast with an inline action button (e.g. Undo). */
    P.showActionToast = function (msg, actionLabel, fn, type = 'info') {
        this.showToast(msg, type);
        const container = document.getElementById('toast-container');
        const pill = container && container.lastElementChild;
        if (!pill) return;
        const b = document.createElement('button');
        b.className = 'toast-action-btn';
        b.textContent = actionLabel;
        b.onclick = () => { try { fn(); } finally { pill.remove(); } };
        pill.appendChild(b);
    };

    // ------------------------------------------------------------------ PANEL (wide modal)
    P.openPanel = function ({ title, icon = 'fa-folder-open', actions = '', tabs = null, activeTab = null, body = '', footer = '' }) {
        this.closeModals();
        const m = document.getElementById('ox-panel-modal');
        if (!m) return;
        document.getElementById('ox-panel-title').textContent = title;
        document.getElementById('ox-panel-icon').className = `fa-solid ${icon} text-blue`;
        document.getElementById('ox-panel-actions').innerHTML = actions;
        const t = document.getElementById('ox-panel-tabs');
        t.innerHTML = tabs ? tabs.map(x => `<button class="gh-tab ${x.id === activeTab ? 'active' : ''}" onclick="${x.onclick}"><i class="fa-solid ${x.icon}"></i><span>${x.label}</span></button>`).join('') : '';
        t.style.display = tabs ? '' : 'none';
        document.getElementById('ox-panel-body').innerHTML = body;
        const f = document.getElementById('ox-panel-footer');
        f.innerHTML = footer; f.style.display = footer ? '' : 'none';
        m.classList.add('active');
    };
    P.setPanelBody = function (html) { const b = document.getElementById('ox-panel-body'); if (b) b.innerHTML = html; };
    P.setPanelFooter = function (html) { const f = document.getElementById('ox-panel-footer'); if (f) { f.innerHTML = html; f.style.display = html ? '' : 'none'; } };

    // ------------------------------------------------------------------ PROJECT FILE MODEL
    P.projectPaths = function () { return Array.from(this.virtualProjectFiles.keys()).sort((a, b) => a.localeCompare(b)); };

    /** Write a text file with a reason (recorded in history). */
    P.writeProjectFile = function (path, content, reason = 'external') {
        const prev = this.virtualProjectFiles.get(path) || {};
        this._writeReason = reason;
        try {
            this.virtualProjectFiles.set(path, { ...prev, content, lang: extOf(path), timestamp: Date.now(), size: undefined, dataUrl: undefined, binary: undefined });
        } finally { this._writeReason = null; }
    };

    P.installProjectFileHooks = function () {
        const map = this.virtualProjectFiles;
        if (!map || map.__oxHooked) return;
        // Remember the built-in starter files so a saved project can replace them on restore
        this._initialFileRefs = new Map(map);
        const set = map.set.bind(map), del = map.delete.bind(map), clear = map.clear.bind(map);
        map.set = (k, v) => {
            const prev = map.get(k);
            set(k, v);
            if (!this._suspendFileHooks) this.onProjectFileWrite(k, prev, v);
            return map;
        };
        map.delete = (k) => { const r = del(k); if (r && !this._suspendFileHooks) this.scheduleProjectSave(); return r; };
        map.clear = () => { clear(); if (!this._suspendFileHooks) this.scheduleProjectSave(); };
        map.__oxHooked = true;
        this.fileVersions = this.fileVersions || new Map();
        this.fileTrash = this.fileTrash || [];
        this.pinnedFiles = this.pinnedFiles || new Set();
        this.recentFiles = this.recentFiles || [];
        this.projectFolders = this.projectFolders || new Set();
        this._editSessions = {};
    };

    P.onProjectFileWrite = function (path, prev, next) {
        const reason = this._writeReason || (this._typingInStudio ? 'edit' : 'external');
        if (prev && typeof prev.content === 'string' && next && prev.content !== next.content && !isBinaryEntry(prev)) {
            const now = Date.now();
            const inSession = reason === 'edit' && this._editSessions[path] && now - this._editSessions[path] < EDIT_SESSION_MS;
            if (!inSession) this.recordFileVersion(path, prev.content, reason, prev.timestamp);
            this._editSessions[path] = reason === 'edit' ? (inSession ? this._editSessions[path] : now) : 0;
        }
        // Typing in an existing file doesn't change the tree → skip the explorer re-render
        this.scheduleProjectSave(!(prev && reason === 'edit'));
    };

    P.recordFileVersion = function (path, content, reason, t) {
        if (content == null || content.length > MAX_VERSIONED_SIZE) return;
        const list = this.fileVersions.get(path) || [];
        if (list.length && list[list.length - 1].content === content) return;
        list.push({ t: t || Date.now(), savedAt: Date.now(), content, reason });
        while (list.length > MAX_VERSIONS) list.shift();
        this.fileVersions.set(path, list);
    };

    P.getFileVersions = function (path) { return (this.fileVersions && this.fileVersions.get(path)) || []; };

    // ------------------------------------------------------------------ PERSISTENCE (auto-backup)
    P.scheduleProjectSave = function (renderExplorer = true) {
        clearTimeout(this._projectSaveTimer);
        this._projectSaveTimer = setTimeout(() => this.saveProjectNow(), 1000);
        if (!renderExplorer || this._explorerRenderQueued) return;
        this._explorerRenderQueued = true;
        setTimeout(() => { this._explorerRenderQueued = false; this.renderStudioExplorer(); }, 60);
    };

    P.saveProjectNow = async function () {
        clearTimeout(this._projectSaveTimer);
        if (!this.idbSet) return false;
        try {
            const files = Array.from(this.virtualProjectFiles.entries()).map(([k, v]) => [k, { content: v.content, lang: v.lang, timestamp: v.timestamp, dataUrl: v.dataUrl, binary: v.binary, size: v.size, mime: v.mime }]);
            // Keep the backup bounded (~40 MB of text): drop oldest versions first
            let versions = Array.from(this.fileVersions.entries());
            let total = files.reduce((n, [, v]) => n + (v.content ? v.content.length : 0) + (v.dataUrl ? v.dataUrl.length : 0), 0);
            let vtotal = versions.reduce((n, [, l]) => n + l.reduce((m, x) => m + x.content.length, 0), 0);
            while (total + vtotal > 40e6 && versions.some(([, l]) => l.length)) {
                let oldest = null;
                versions.forEach(([, l]) => { if (l.length && (!oldest || l[0].savedAt < oldest[0].savedAt)) oldest = l; });
                vtotal -= oldest.shift().content.length;
            }
            versions = versions.filter(([, l]) => l.length);
            await this.idbSet(IDB_KEY, {
                files, versions, trash: this.fileTrash.slice(-MAX_TRASH), pins: Array.from(this.pinnedFiles),
                recent: this.recentFiles.slice(0, 20), folders: Array.from(this.projectFolders), tabs: this.studioTabs || [],
                active: this.activeStudioFile || null, savedAt: Date.now()
            });
            return true;
        } catch (e) { console.warn('project backup failed', e); return false; }
    };

    P.restoreProjectFromIDB = async function () {
        if (!this.idbGet) return false;
        try {
            const data = await this.idbGet(IDB_KEY);
            if (!data || !Array.isArray(data.files)) return false;
            this._suspendFileHooks = true;
            try {
                // Files ingested in this session (before the restore finished) win over the backup;
                // untouched built-in starter files are replaced (or removed if the user had deleted them)
                const initial = this._initialFileRefs || new Map();
                const untouched = (k) => initial.has(k) && initial.get(k) === this.virtualProjectFiles.get(k);
                const saved = new Set(data.files.map(([k]) => k));
                data.files.forEach(([k, v]) => { if (!this.virtualProjectFiles.has(k) || untouched(k)) this.virtualProjectFiles.set(k, v); });
                if (data.files.length) Array.from(initial.keys()).forEach(k => { if (!saved.has(k) && untouched(k)) this.virtualProjectFiles.delete(k); });
            } finally { this._suspendFileHooks = false; }
            (data.versions || []).forEach(([k, l]) => { if (!this.fileVersions.has(k)) this.fileVersions.set(k, l); });
            this.fileTrash = data.trash || [];
            this.pinnedFiles = new Set(data.pins || []);
            this.recentFiles = data.recent || [];
            this.projectFolders = new Set(data.folders || []);
            this.studioTabs = (data.tabs || []).filter(p => this.virtualProjectFiles.has(p));
            if (!this.activeStudioFile && data.active && this.virtualProjectFiles.has(data.active)) this.activeStudioFile = data.active;
            this._projectRestored = data.files.length;
            if (this.isCodeStudioOpen) this.renderStudioWorkspace(); else this.renderStudioExplorer();
            return true;
        } catch (e) { return false; }
    };

    // ------------------------------------------------------------------ FILE OPERATIONS
    P.uniqueProjectPath = function (path) {
        if (!this.virtualProjectFiles.has(path)) return path;
        const dir = dirName(path), base = baseName(path), dot = base.lastIndexOf('.');
        const stem = dot > 0 ? base.slice(0, dot) : base, ext = dot > 0 ? base.slice(dot) : '';
        for (let i = 2; i < 1000; i++) {
            const cand = joinPath(dir, `${stem} (${i})${ext}`);
            if (!this.virtualProjectFiles.has(cand)) return cand;
        }
        return joinPath(dir, `${stem}-${Date.now()}${ext}`);
    };

    P.createProjectFile = function (path, content, { open = true, reason = 'create' } = {}) {
        const p = normPath(path);
        if (!p) throw new Error('مسار غير صالح');
        if (this.virtualProjectFiles.has(p)) throw new Error('يوجد ملف بنفس الاسم');
        // No content given → start from the smart template for this file type
        if (content === undefined || content === null) content = (FILE_TEMPLATES[this.templateForPath(p)] || FILE_TEMPLATES.empty).body(baseName(p));
        this._writeReason = reason;
        try { this.virtualProjectFiles.set(p, { content, lang: extOf(p), timestamp: Date.now() }); } finally { this._writeReason = null; }
        const d = dirName(p);
        if (d) this.projectFolders.delete(d);
        if (open) this.openProjectFile(p);
        return p;
    };

    /** Move/rename one file, carrying its history, pin, tab and active state. */
    P.renameProjectFile = function (oldPath, newPath, { silent = false } = {}) {
        const np = normPath(newPath);
        if (!np) throw new Error('مسار غير صالح');
        if (np === oldPath) return np;
        if (!this.virtualProjectFiles.has(oldPath)) throw new Error('الملف غير موجود');
        if (this.virtualProjectFiles.has(np)) throw new Error(`يوجد ملف باسم ${np}`);
        const data = this.virtualProjectFiles.get(oldPath);
        this._suspendFileHooks = true;
        try {
            this.virtualProjectFiles.delete(oldPath);
            this.virtualProjectFiles.set(np, { ...data, lang: extOf(np) });
        } finally { this._suspendFileHooks = false; }
        if (this.fileVersions.has(oldPath)) { this.fileVersions.set(np, this.fileVersions.get(oldPath)); this.fileVersions.delete(oldPath); }
        if (this.pinnedFiles.delete(oldPath)) this.pinnedFiles.add(np);
        this.recentFiles = this.recentFiles.map(p => (p === oldPath ? np : p));
        if (this.studioTabs) this.studioTabs = this.studioTabs.map(p => (p === oldPath ? np : p));
        if (this.activeStudioFile === oldPath) this.activeStudioFile = np;
        if (this.explorer && this.explorer.selected.delete(oldPath)) this.explorer.selected.add(np);
        const nd = dirName(np); if (nd) this.projectFolders.delete(nd);
        if (!silent) { this.scheduleProjectSave(); if (this.isCodeStudioOpen) this.renderStudioWorkspace(); }
        return np;
    };

    P.renameProjectFolder = function (oldDir, newDir) {
        const nd = normPath(newDir);
        if (!nd) throw new Error('مسار غير صالح');
        if (nd === oldDir) return nd;
        if (nd.startsWith(oldDir + '/')) throw new Error('لا يمكن نقل مجلد داخل نفسه');
        const moves = this.projectPaths().filter(p => p.startsWith(oldDir + '/')).map(p => [p, nd + p.slice(oldDir.length)]);
        const clash = moves.find(([, to]) => this.virtualProjectFiles.has(to));
        if (clash) throw new Error(`يوجد ملف باسم ${clash[1]}`);
        moves.forEach(([from, to]) => this.renameProjectFile(from, to, { silent: true }));
        Array.from(this.projectFolders).forEach(f => { if (f === oldDir || f.startsWith(oldDir + '/')) { this.projectFolders.delete(f); this.projectFolders.add(nd + f.slice(oldDir.length)); } });
        if (this.explorer && this.explorer.collapsed.has(oldDir)) { this.explorer.collapsed.delete(oldDir); this.explorer.collapsed.add(nd); }
        this.scheduleProjectSave();
        if (this.isCodeStudioOpen) this.renderStudioWorkspace();
        return nd;
    };

    /** Move files (and whole folders) into a target directory. Returns the number of moved files. */
    P.moveProjectPaths = function (paths, targetDir) {
        const td = targetDir ? normPath(targetDir) : '';
        let moved = 0;
        paths.forEach(p => {
            if (this.virtualProjectFiles.has(p)) {
                const to = joinPath(td, baseName(p));
                if (to !== p) { this.renameProjectFile(p, this.virtualProjectFiles.has(to) ? this.uniqueProjectPath(to) : to, { silent: true }); moved++; }
            } else if (this.isProjectFolder(p)) {
                const to = joinPath(td, baseName(p));
                if (to !== p && !(td + '/').startsWith(p + '/')) { moved += this.projectPaths().filter(x => x.startsWith(p + '/')).length; this.renameProjectFolder(p, to); }
            }
        });
        this.scheduleProjectSave();
        if (this.isCodeStudioOpen) this.renderStudioWorkspace();
        return moved;
    };

    P.isProjectFolder = function (dir) {
        if (!dir) return false;
        if (this.projectFolders.has(dir)) return true;
        for (const p of this.virtualProjectFiles.keys()) if (p.startsWith(dir + '/')) return true;
        return false;
    };

    P.duplicateProjectFile = function (path) {
        const f = this.virtualProjectFiles.get(path);
        if (!f) return null;
        const dir = dirName(path), base = baseName(path), dot = base.lastIndexOf('.');
        const stem = dot > 0 ? base.slice(0, dot) : base, ext = dot > 0 ? base.slice(dot) : '';
        let cand = joinPath(dir, `${stem} copy${ext}`);
        for (let i = 2; this.virtualProjectFiles.has(cand); i++) cand = joinPath(dir, `${stem} copy ${i}${ext}`);
        this._writeReason = 'create';
        try { this.virtualProjectFiles.set(cand, { ...f, timestamp: Date.now() }); } finally { this._writeReason = null; }
        return cand;
    };

    /** Delete files (folders expand to their files). Everything goes to the trash. */
    P.deleteProjectPaths = function (paths, { toast = true } = {}) {
        const files = new Set();
        paths.forEach(p => {
            if (this.virtualProjectFiles.has(p)) files.add(p);
            else this.projectPaths().filter(x => x.startsWith(p + '/')).forEach(x => files.add(x));
            if (this.projectFolders.has(p)) this.projectFolders.delete(p);
        });
        if (!files.size) { this.scheduleProjectSave(); return []; }
        const batch = 'del_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        files.forEach(p => {
            const data = this.virtualProjectFiles.get(p);
            this.fileTrash.push({ id: batch + ':' + p, batch, path: p, data, versions: this.fileVersions.get(p) || [], deletedAt: Date.now() });
            this.virtualProjectFiles.delete(p);
            this.pinnedFiles.delete(p);
            if (this.explorer) this.explorer.selected.delete(p);
        });
        while (this.fileTrash.length > MAX_TRASH) this.fileTrash.shift();
        this.recentFiles = this.recentFiles.filter(p => !files.has(p));
        if (this.studioTabs) this.studioTabs = this.studioTabs.filter(p => !files.has(p));
        if (files.has(this.activeStudioFile)) this.activeStudioFile = (this.studioTabs && this.studioTabs[0]) || this.projectPaths()[0] || null;
        this.scheduleProjectSave();
        if (this.isCodeStudioOpen) this.renderStudioWorkspace();
        if (toast) {
            const label = files.size === 1 ? `تم حذف ${this.escapeHTML(baseName([...files][0]))}` : `تم حذف ${files.size} ملفات`;
            this.showActionToast(label, 'تراجع', () => this.restoreTrashBatch(batch), 'info');
        }
        return [...files];
    };

    P.restoreTrashItem = function (id) {
        const i = this.fileTrash.findIndex(t => t.id === id);
        if (i === -1) return null;
        const item = this.fileTrash.splice(i, 1)[0];
        const path = this.virtualProjectFiles.has(item.path) ? this.uniqueProjectPath(item.path) : item.path;
        this._suspendFileHooks = true;
        try { this.virtualProjectFiles.set(path, item.data); } finally { this._suspendFileHooks = false; }
        if (item.versions && item.versions.length) this.fileVersions.set(path, item.versions);
        this.scheduleProjectSave();
        return path;
    };
    P.restoreTrashBatch = function (batch) {
        const ids = this.fileTrash.filter(t => t.batch === batch).map(t => t.id);
        const restored = ids.map(id => this.restoreTrashItem(id)).filter(Boolean);
        if (this.isCodeStudioOpen) this.renderStudioWorkspace();
        if (restored.length) this.showToast(`↶ تمت استعادة ${restored.length} ملف`, 'success');
        return restored;
    };

    P.togglePinFile = function (path) {
        if (this.pinnedFiles.has(path)) this.pinnedFiles.delete(path); else this.pinnedFiles.add(path);
        this.scheduleProjectSave();
        return this.pinnedFiles.has(path);
    };

    P.copyText = async function (text, label = 'تم النسخ') {
        try { await navigator.clipboard.writeText(text); this.showToast(`📋 ${label}`, 'success'); return true; }
        catch (e) {
            const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); } catch (x) {}
            ta.remove(); this.showToast(`📋 ${label}`, 'success'); return false;
        }
    };

    P.downloadBlob = function (blob, name) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    };

    const dataUrlToBlob = (dataUrl) => {
        const [head, b64] = String(dataUrl).split(',');
        const mime = (/data:([^;]+)/.exec(head) || [])[1] || 'application/octet-stream';
        const bin = atob(b64 || ''); const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        return new Blob([u], { type: mime });
    };
    P.dataUrlToBlob = dataUrlToBlob;
    P.projectFileBlob = function (path) {
        const f = this.virtualProjectFiles.get(path);
        if (!f) return null;
        if (f.dataUrl) return dataUrlToBlob(f.dataUrl);
        return new Blob([f.content || ''], { type: 'text/plain;charset=utf-8' });
    };

    P.downloadProjectFile = function (path) { const b = this.projectFileBlob(path); if (b) this.downloadBlob(b, baseName(path)); };

    /** Open in a new browser tab. Text is always served as text/plain (never executes user HTML on our origin). */
    P.openProjectFileInNewTab = function (path) {
        const b = this.projectFileBlob(path);
        if (!b) return;
        const safe = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|application\/pdf|audio\/|video\/)/.test(b.type) ? b : new Blob([b], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(safe);
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    };

    P.downloadPathsAsZip = async function (paths, name = 'project') {
        if (typeof JSZip === 'undefined') { this.showToast('مكتبة ZIP غير محملة', 'error'); return null; }
        const zip = new JSZip();
        const files = new Set();
        paths.forEach(p => { if (this.virtualProjectFiles.has(p)) files.add(p); else this.projectPaths().filter(x => x.startsWith(p + '/')).forEach(x => files.add(x)); });
        files.forEach(p => {
            const f = this.virtualProjectFiles.get(p);
            if (f.dataUrl) zip.file(p, f.dataUrl.split(',')[1] || '', { base64: true }); else zip.file(p, f.content || '');
        });
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        this.downloadBlob(blob, `${name.replace(/[^\w\u0600-\u06FF.-]+/g, '_')}.zip`);
        this.showToast(`📦 تم تجهيز ZIP (${files.size} ملف)`, 'success');
        return blob;
    };

    // ------------------------------------------------------------------ TEMPLATES
    const pascal = (s) => String(s).replace(/\.[^.]+$/, '').replace(/(^|[-_\s.]+)(\w)/g, (_, __, c) => c.toUpperCase()).replace(/[^\w]/g, '') || 'Component';
    const FILE_TEMPLATES = {
        empty: { label: 'ملف فارغ', ext: [], body: () => '' },
        html: { label: 'صفحة HTML5', ext: ['html', 'htm'], body: (n) => `<!DOCTYPE html>\n<html lang="ar" dir="rtl">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>${pascal(n)}</title>\n    <link rel="stylesheet" href="styles.css">\n</head>\n<body>\n    <main>\n        <h1>مرحباً 👋</h1>\n    </main>\n    <script src="script.js" defer></script>\n</body>\n</html>\n` },
        react: { label: 'مكوّن React', ext: ['jsx', 'tsx'], body: (n) => `import { useState } from 'react';\n\nexport default function ${pascal(n)}() {\n    const [count, setCount] = useState(0);\n    return (\n        <div>\n            <h2>${pascal(n)}</h2>\n            <button onClick={() => setCount(c => c + 1)}>clicked {count} times</button>\n        </div>\n    );\n}\n` },
        vue: { label: 'مكوّن Vue', ext: ['vue'], body: (n) => `<script setup>\nimport { ref } from 'vue';\nconst count = ref(0);\n</script>\n\n<template>\n    <div>\n        <h2>${pascal(n)}</h2>\n        <button @click="count++">clicked {{ count }} times</button>\n    </div>\n</template>\n\n<style scoped>\nh2 { margin: 0 0 8px; }\n</style>\n` },
        express: { label: 'خادم Express (Node)', ext: [], body: () => `const express = require('express');\n\nconst app = express();\napp.use(express.json());\n\napp.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));\n\nconst PORT = process.env.PORT || 3000;\napp.listen(PORT, () => console.log(\`Server running on http://localhost:\${PORT}\`));\n` },
        js: { label: 'وحدة JavaScript', ext: ['js', 'mjs', 'ts'], body: (n) => `/**\n * ${baseName(n)}\n */\nexport function main() {\n    // TODO\n}\n` },
        py: { label: 'سكربت Python', ext: ['py'], body: () => `"""Module description."""\n\n\ndef main() -> None:\n    print("Hello from OX-Alpha")\n\n\nif __name__ == "__main__":\n    main()\n` },
        test: { label: 'ملف اختبار (Jest/Vitest)', ext: [], body: (n) => `import { describe, it, expect } from 'vitest';\nimport { main } from './${baseName(n).replace(/\.(test|spec)\.[jt]sx?$/, '')}';\n\ndescribe('${baseName(n)}', () => {\n    it('works', () => {\n        expect(typeof main).toBe('function');\n    });\n});\n` },
        css: { label: 'CSS حديث (Reset)', ext: ['css', 'scss'], body: () => `*, *::before, *::after { box-sizing: border-box; }\n* { margin: 0; }\nhtml { color-scheme: light dark; }\nbody { font-family: system-ui, sans-serif; line-height: 1.6; -webkit-font-smoothing: antialiased; }\nimg, picture, video, canvas, svg { display: block; max-width: 100%; }\ninput, button, textarea, select { font: inherit; }\n` },
        md: { label: 'README', ext: ['md'], body: (n) => `# ${pascal(dirName(n) || 'Project')}\n\nوصف قصير للمشروع.\n\n## التشغيل\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\n## الترخيص\nMIT\n` },
        json: { label: 'package.json', ext: ['json'], body: (n) => JSON.stringify({ name: (dirName(n).split('/').pop() || 'my-app').toLowerCase().replace(/[^a-z0-9-]/g, '-'), version: '0.1.0', private: true, type: 'module', scripts: { dev: 'vite', build: 'vite build', test: 'vitest' } }, null, 2) + '\n' },
        gitignore: { label: '.gitignore', ext: ['gitignore'], body: () => `node_modules/\ndist/\nbuild/\n.env\n.env.*\n__pycache__/\n*.pyc\n.venv/\n.DS_Store\ncoverage/\n` }
    };
    P.FILE_TEMPLATES = FILE_TEMPLATES;
    P.templateForPath = function (path) {
        const name = baseName(path).toLowerCase(), ext = extOf(path);
        if (/\.(test|spec)\.[jt]sx?$/.test(name)) return 'test';
        if (name === 'package.json') return 'json';
        if (name === 'readme.md') return 'md';
        if (name === '.gitignore') return 'gitignore';
        if (/^(server|app|index)\.js$/.test(name) && /server/.test(name)) return 'express';
        const hit = Object.entries(FILE_TEMPLATES).find(([k, t]) => k !== 'json' && t.ext.includes(ext));
        return hit ? hit[0] : 'empty';
    };

    const SCAFFOLDS = {
        empty: { label: 'مجلد فارغ', files: () => ({}) },
        react: { label: 'مكوّن React (index + CSS + اختبار)', files: (n) => { const C = pascal(baseName(n)); return { [`${n}/index.tsx`]: FILE_TEMPLATES.react.body(C), [`${n}/${C}.module.css`]: `.root {\n    display: flex;\n    gap: 8px;\n}\n`, [`${n}/${C}.test.tsx`]: `import { render, screen } from '@testing-library/react';\nimport ${C} from './index';\n\ntest('renders ${C}', () => {\n    render(<${C} />);\n    expect(screen.getByText('${C}')).toBeTruthy();\n});\n` }; } },
        express: { label: 'واجهة API (Express)', files: (n) => ({ [`${n}/package.json`]: JSON.stringify({ name: baseName(n).toLowerCase(), version: '0.1.0', main: 'src/index.js', scripts: { start: 'node src/index.js', dev: 'node --watch src/index.js' }, dependencies: { express: '^4.19.2' } }, null, 2) + '\n', [`${n}/src/index.js`]: FILE_TEMPLATES.express.body(), [`${n}/src/routes/health.js`]: `module.exports = (req, res) => res.json({ ok: true });\n`, [`${n}/.gitignore`]: FILE_TEMPLATES.gitignore.body(), [`${n}/README.md`]: `# ${baseName(n)}\n\n\`npm install && npm run dev\`\n` }) },
        python: { label: 'حزمة Python + اختبارات', files: (n) => { const pkg = baseName(n).toLowerCase().replace(/[^a-z0-9_]/g, '_'); return { [`${n}/${pkg}/__init__.py`]: '', [`${n}/${pkg}/main.py`]: FILE_TEMPLATES.py.body(), [`${n}/tests/test_main.py`]: `from ${pkg}.main import main\n\n\ndef test_main(capsys):\n    main()\n    assert "Hello" in capsys.readouterr().out\n`, [`${n}/requirements.txt`]: 'pytest\n', [`${n}/README.md`]: `# ${baseName(n)}\n\n\`python -m ${pkg}.main\`\n` }; } },
        site: { label: 'موقع ثابت (HTML + CSS + JS)', files: (n) => ({ [`${n}/index.html`]: FILE_TEMPLATES.html.body('index'), [`${n}/styles.css`]: FILE_TEMPLATES.css.body(), [`${n}/script.js`]: `document.addEventListener('DOMContentLoaded', () => {\n    console.log('ready');\n});\n`, [`${n}/README.md`]: `# ${baseName(n)}\n` }) }
    };
    P.FOLDER_SCAFFOLDS = SCAFFOLDS;

    P.newProjectFileDialog = async function (dir = '') {
        const r = await this.showDialog({
            title: '📄 ملف جديد',
            fields: [
                { id: 'path', label: 'المسار', value: dir ? dir + '/' : '', placeholder: 'src/components/Button.jsx', dir: 'ltr' },
                { id: 'tpl', label: 'القالب', type: 'select', value: 'auto', options: [{ value: 'auto', label: '✨ تلقائي حسب الامتداد' }, ...Object.entries(FILE_TEMPLATES).map(([k, t]) => ({ value: k, label: t.label }))] }
            ],
            buttons: [{ label: 'إنشاء', value: 'ok', primary: true, validate: (v) => { const p = normPath(v.path); if (!p || p.endsWith('/') || !baseName(p)) return 'أدخل اسم ملف صالح'; if (this.virtualProjectFiles.has(p)) return 'يوجد ملف بهذا الاسم'; return null; } }, { label: 'إلغاء', value: null }]
        });
        if (!r) return null;
        const p = normPath(r.values.path);
        const tpl = r.values.tpl === 'auto' ? this.templateForPath(p) : r.values.tpl;
        const created = this.createProjectFile(p, (FILE_TEMPLATES[tpl] || FILE_TEMPLATES.empty).body(baseName(p)));
        this.showToast(`📄 تم إنشاء ${this.escapeHTML(created)}`, 'success');
        return created;
    };

    P.newProjectFolderDialog = async function (dir = '') {
        const r = await this.showDialog({
            title: '📁 مجلد جديد',
            fields: [
                { id: 'path', label: 'اسم المجلد', value: dir ? dir + '/' : '', placeholder: 'src/components/Card', dir: 'ltr' },
                { id: 'tpl', label: 'الهيكل', type: 'select', value: 'empty', options: Object.entries(SCAFFOLDS).map(([k, t]) => ({ value: k, label: t.label })) }
            ],
            buttons: [{ label: 'إنشاء', value: 'ok', primary: true, validate: (v) => (normPath(v.path) ? null : 'أدخل اسماً صالحاً') }, { label: 'إلغاء', value: null }]
        });
        if (!r) return null;
        return this.createProjectFolder(normPath(r.values.path), r.values.tpl);
    };

    P.createProjectFolder = function (dir, scaffold = 'empty') {
        const files = (SCAFFOLDS[scaffold] || SCAFFOLDS.empty).files(dir);
        const paths = Object.keys(files);
        if (!paths.length) { this.projectFolders.add(dir); this.explorerExpandTo(dir + '/x'); this.scheduleProjectSave(); return []; }
        const created = paths.map(p => this.createProjectFile(this.virtualProjectFiles.has(p) ? this.uniqueProjectPath(p) : p, files[p], { open: false }));
        this.explorerExpandTo(created[0]);
        this.openProjectFile(created.find(p => /index\.|main\.py/.test(p)) || created[0]);
        this.showToast(`📁 تم إنشاء ${this.escapeHTML(dir)} (${created.length} ملفات)`, 'success');
        return created;
    };

    P.renameProjectPathDialog = async function (path) {
        const isFile = this.virtualProjectFiles.has(path);
        const np = await this.askText(isFile ? '✏️ إعادة تسمية / نقل الملف' : '✏️ إعادة تسمية المجلد', path, {
            label: 'المسار الجديد', okLabel: 'حفظ',
            validate: (v) => { const p = normPath(v); if (!p) return 'مسار غير صالح'; if (p !== path && this.virtualProjectFiles.has(p)) return 'يوجد ملف بهذا الاسم'; return null; }
        });
        if (!np || normPath(np) === path) return null;
        try {
            const r = isFile ? this.renameProjectFile(path, np) : this.renameProjectFolder(path, np);
            this.explorerExpandTo(isFile ? r : r + '/x');
            return r;
        } catch (e) { this.showToast('❌ ' + this.escapeHTML(e.message), 'error'); return null; }
    };

    // ------------------------------------------------------------------ OPEN FILES / TABS
    P.openProjectFile = function (path) {
        if (!this.virtualProjectFiles.has(path)) return;
        if (this.isBinaryProjectFile(path) && this.openFilePreview) { this.openFilePreview({ path }); return; }
        this.recentFiles = [path, ...this.recentFiles.filter(p => p !== path)].slice(0, 20);
        this.activeStudioFile = path;
        if (!this.isCodeStudioOpen) this.toggleCodeStudio(true); else this.renderStudioWorkspace();
        this.scheduleProjectSave();
    };

    P.closeStudioTab = function (path) {
        this.studioTabs = (this.studioTabs || []).filter(p => p !== path);
        if (this.activeStudioFile === path) this.activeStudioFile = this.studioTabs[this.studioTabs.length - 1] || null;
        this.renderStudioWorkspace();
    };

    P.renderStudioTabs = function () {
        const el = document.getElementById('studio-open-files-tabs');
        if (!el) return;
        this.studioTabs = (this.studioTabs || []).filter(p => this.virtualProjectFiles.has(p));
        const a = this.activeStudioFile;
        if (a && !this.studioTabs.includes(a)) {
            this.studioTabs.push(a);
            while (this.studioTabs.length > MAX_TABS) { const i = this.studioTabs.findIndex(p => p !== a); this.studioTabs.splice(i, 1); }
        }
        el.innerHTML = this.studioTabs.map(p => {
            const [icon, color] = this.fileIcon(p);
            return `<div class="studio-tab-item ${p === a ? 'active' : ''}" data-path="${this.escapeHTML(p)}" title="${this.escapeHTML(p)}">
                <i class="${icon}" style="color:${color}"></i><span class="truncate">${this.escapeHTML(baseName(p))}</span>
                <button class="studio-tab-close" data-close="1" aria-label="إغلاق ${this.escapeHTML(baseName(p))}">×</button></div>`;
        }).join('');
        if (!el.dataset.bound) {
            el.dataset.bound = '1';
            el.addEventListener('click', (e) => {
                const tab = e.target.closest('.studio-tab-item');
                if (!tab) return;
                if (e.target.closest('[data-close]')) { e.stopPropagation(); this.closeStudioTab(tab.dataset.path); return; }
                this.switchStudioFile(tab.dataset.path);
            });
            el.addEventListener('auxclick', (e) => { const tab = e.target.closest('.studio-tab-item'); if (tab && e.button === 1) { e.preventDefault(); this.closeStudioTab(tab.dataset.path); } });
        }
    };

    const _origRender = P.renderStudioWorkspace;
    P.renderStudioWorkspace = function () {
        if (this.activeStudioFile && !this.virtualProjectFiles.has(this.activeStudioFile)) this.activeStudioFile = null;
        const r = _origRender.apply(this, arguments);
        try { this.renderStudioTabs(); this.renderStudioExplorer(); } catch (e) { console.warn('explorer render failed', e); }
        return r;
    };
    P.switchStudioFile = function (path) {
        if (this.isBinaryProjectFile(path) && this.openFilePreview) { this.openFilePreview({ path }); return; }
        this.activeStudioFile = path;
        this.recentFiles = [path, ...this.recentFiles.filter(p => p !== path)].slice(0, 20);
        this.renderStudioWorkspace();
    };
    const _origChange = P.handleStudioCodeChange;
    P.handleStudioCodeChange = function (val) {
        if (this.activeStudioFile && this.isBinaryProjectFile(this.activeStudioFile)) return;
        this._typingInStudio = true;
        try {
            const prev = this.virtualProjectFiles.get(this.activeStudioFile);
            _origChange.call(this, val);
            // keep extra metadata (mime etc.) that the core setter drops
            const cur = this.virtualProjectFiles.get(this.activeStudioFile);
            if (prev && cur && prev.mime && !cur.mime) cur.mime = prev.mime;
        } finally { this._typingInStudio = false; }
    };

    // ------------------------------------------------------------------ EXPLORER
    const ensureExplorerState = (app) => {
        if (!app.explorer) {
            let open = true;
            try { open = localStorage.getItem('ox_alpha_explorer_open') !== '0'; } catch (e) {}
            app.explorer = { open, collapsed: new Set(), selected: new Set(), anchor: null, filter: '', showHidden: false, sort: 'name', view: 'tree', autoCollapsed: false };
        }
        return app.explorer;
    };
    P.getExplorerState = function () { return ensureExplorerState(this); };

    P.toggleStudioExplorer = function (force) {
        const st = ensureExplorerState(this);
        st.open = force !== undefined ? !!force : !st.open;
        try { localStorage.setItem('ox_alpha_explorer_open', st.open ? '1' : '0'); } catch (e) {}
        if (!this.isCodeStudioOpen && st.open) this.toggleCodeStudio(true);
        this.renderStudioExplorer();
    };

    P.explorerExpandTo = function (path) {
        const st = ensureExplorerState(this);
        const parts = String(path).split('/');
        for (let i = 1; i < parts.length; i++) st.collapsed.delete(parts.slice(0, i).join('/'));
    };

    P.setExplorerFilter = function (q) { ensureExplorerState(this).filter = q || ''; this.renderStudioExplorer(true); };
    P.setExplorerView = function (v) { ensureExplorerState(this).view = v; this.renderStudioExplorer(); };
    P.setExplorerSort = function (s) { ensureExplorerState(this).sort = s; this.renderStudioExplorer(); };
    P.toggleHiddenFiles = function () { const st = ensureExplorerState(this); st.showHidden = !st.showHidden; this.renderStudioExplorer(); return st.showHidden; };

    /** Build the visible row model (also used for Shift+click ranges and keyboard navigation). */
    P.buildExplorerRows = function () {
        const st = ensureExplorerState(this);
        let paths = this.projectPaths();
        const folders = Array.from(this.projectFolders);
        if (!st.showHidden) paths = paths.filter(p => !isHidden(p) || this.pinnedFiles.has(p));
        const q = st.filter.trim().toLowerCase();
        if (q) return paths.filter(p => p.toLowerCase().includes(q)).map(p => ({ kind: 'file', path: p, depth: 0, flat: true }));
        if (st.view === 'recent') return this.recentFiles.filter(p => this.virtualProjectFiles.has(p)).map(p => ({ kind: 'file', path: p, depth: 0, flat: true }));
        if (st.view === 'pinned') return Array.from(this.pinnedFiles).filter(p => this.virtualProjectFiles.has(p)).sort().map(p => ({ kind: 'file', path: p, depth: 0, flat: true }));
        // Large projects start with top-level folders collapsed
        if (!st.autoCollapsed && paths.length > 40) {
            st.autoCollapsed = true;
            paths.forEach(p => { const d = p.split('/'); if (d.length > 1) st.collapsed.add(d[0]); });
            if (this.activeStudioFile) this.explorerExpandTo(this.activeStudioFile);
        }
        const root = { dirs: new Map(), files: [] };
        const ensureDir = (parts) => {
            let node = root;
            parts.forEach(part => { if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] }); node = node.dirs.get(part); });
            return node;
        };
        paths.forEach(p => { const parts = p.split('/'); const name = parts.pop(); ensureDir(parts).files.push(p); });
        folders.forEach(f => { if (st.showHidden || !isHidden(f)) ensureDir(f.split('/')); });
        const sizeOf = (p) => entrySize(this.virtualProjectFiles.get(p));
        const sorters = {
            name: (a, b) => baseName(a).localeCompare(baseName(b)),
            type: (a, b) => extOf(a).localeCompare(extOf(b)) || baseName(a).localeCompare(baseName(b)),
            size: (a, b) => sizeOf(b) - sizeOf(a),
            date: (a, b) => (this.virtualProjectFiles.get(b).timestamp || 0) - (this.virtualProjectFiles.get(a).timestamp || 0)
        };
        const rows = [];
        const walk = (node, prefix, depth) => {
            Array.from(node.dirs.keys()).sort((a, b) => a.localeCompare(b)).forEach(name => {
                const path = prefix ? `${prefix}/${name}` : name;
                const collapsed = st.collapsed.has(path);
                rows.push({ kind: 'folder', path, depth, collapsed });
                if (!collapsed) walk(node.dirs.get(name), path, depth + 1);
            });
            node.files.slice().sort(sorters[st.sort] || sorters.name).forEach(p => rows.push({ kind: 'file', path: p, depth }));
        };
        walk(root, '', 0);
        return rows;
    };

    P.renderStudioExplorer = function (keepSearchFocus) {
        const el = document.getElementById('studio-explorer');
        if (!el) return;
        const st = ensureExplorerState(this);
        el.classList.toggle('open', !!st.open);
        document.getElementById('btn-studio-explorer')?.classList.toggle('active', !!st.open);
        if (!st.open) return;
        this.bindExplorerEvents(el);
        const rows = this.buildExplorerRows();
        this._fxRows = rows;
        const esc = (x) => this.escapeHTML(x);
        const q = st.filter.trim();
        const hl = (text) => {
            if (!q) return esc(text);
            const i = text.toLowerCase().indexOf(q.toLowerCase());
            return i === -1 ? esc(text) : esc(text.slice(0, i)) + `<mark>${esc(text.slice(i, i + q.length))}</mark>` + esc(text.slice(i + q.length));
        };
        const all = this.projectPaths();
        const totalSize = all.reduce((n, p) => n + entrySize(this.virtualProjectFiles.get(p)), 0);
        const sel = st.selected;
        const searchHasFocus = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('fx-search');
        const caret = searchHasFocus ? document.activeElement.selectionStart : null;
        const rowHTML = rows.map((r, i) => {
            if (r.kind === 'folder') {
                const count = all.filter(p => p.startsWith(r.path + '/')).length;
                return `<div class="fx-row folder ${sel.has(r.path) ? 'selected' : ''}" role="treeitem" aria-expanded="${!r.collapsed}" tabindex="-1" draggable="true" data-i="${i}" data-path="${esc(r.path)}" data-kind="folder" style="--depth:${r.depth}">
                    <i class="fa-solid fa-chevron-${r.collapsed ? 'left' : 'down'} fx-caret"></i>${(() => { const fi = this.folderIcon ? this.folderIcon(r.path, !r.collapsed) : ['fa-solid fa-folder' + (r.collapsed ? '' : '-open'), '#fbbf24']; return `<i class="${fi[0]} fx-icon" style="color:${fi[1]}"></i>`; })()}
                    <span class="fx-name">${esc(baseName(r.path))}</span><span class="fx-meta">${count || ''}</span><button class="fx-more" data-more="1" aria-label="خيارات">⋯</button></div>`;
            }
            const f = this.virtualProjectFiles.get(r.path) || {};
            const [icon, color] = this.fileIcon(r.path);
            const size = entrySize(f);
            const title = `${r.path}\n${fmtBytes(size)}${f.timestamp ? ' • ' + new Date(f.timestamp).toLocaleString() : ''}`;
            const label = r.flat ? `<span class="fx-name">${hl(baseName(r.path))}</span><span class="fx-dir">${hl(dirName(r.path))}</span>` : `<span class="fx-name">${esc(baseName(r.path))}</span>`;
            const versions = this.getFileVersions(r.path).length;
            return `<div class="fx-row file ${r.path === this.activeStudioFile ? 'active' : ''} ${sel.has(r.path) ? 'selected' : ''}" role="treeitem" tabindex="-1" draggable="true" data-i="${i}" data-path="${esc(r.path)}" data-kind="file" style="--depth:${r.depth}" title="${esc(title)}">
                <span class="fx-caret"></span><i class="${icon} fx-icon" style="color:${color}"></i>${label}
                ${this.pinnedFiles.has(r.path) ? '<i class="fa-solid fa-thumbtack fx-pin"></i>' : ''}${versions ? `<span class="fx-ver" title="${versions} إصدار سابق">${versions}</span>` : ''}
                <span class="fx-meta">${fmtBytes(size)}</span><button class="fx-more" data-more="1" aria-label="خيارات">⋯</button></div>`;
        }).join('');
        const view = (v, label, icon) => `<button class="fx-view ${st.view === v && !q ? 'active' : ''}" onclick="app.setExplorerView('${v}')" title="${label}"><i class="fa-solid ${icon}"></i> ${label}</button>`;
        el.innerHTML = `
            <div class="fx-head">
                <input class="fx-search form-input-box" placeholder="🔍 بحث في ${all.length} ملف" value="${esc(st.filter)}" oninput="app.setExplorerFilter(this.value)" aria-label="بحث في الملفات">
                <div class="fx-tools">
                    <button onclick="app.newProjectFileDialog()" title="ملف جديد"><i class="fa-solid fa-file-circle-plus"></i></button>
                    <button onclick="app.newProjectFolderDialog()" title="مجلد جديد"><i class="fa-solid fa-folder-plus"></i></button>
                    <button onclick="app.pickFolderUpload ? app.pickFolderUpload() : null" title="رفع مجلد"><i class="fa-solid fa-upload"></i></button>
                    <button onclick="app.openProjectTools('search')" title="بحث واستبدال في المشروع"><i class="fa-solid fa-magnifying-glass-arrow-right"></i></button>
                    <button data-menu="explorer" title="المزيد"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                </div>
            </div>
            <div class="fx-views">${view('tree', 'الشجرة', 'fa-sitemap')}${view('recent', 'الأخيرة', 'fa-clock')}${view('pinned', 'المثبتة', 'fa-thumbtack')}</div>
            ${sel.size ? `<div class="fx-bulk"><b>${sel.size} محدد</b>
                <button onclick="app.bulkDeleteSelected()" title="حذف"><i class="fa-solid fa-trash"></i></button>
                <button onclick="app.bulkMoveSelected()" title="نقل"><i class="fa-solid fa-folder-tree"></i></button>
                <button onclick="app.batchRenameDialog()" title="إعادة تسمية جماعية"><i class="fa-solid fa-i-cursor"></i></button>
                <button onclick="app.downloadPathsAsZip(Array.from(app.explorer.selected), 'selection')" title="تحميل ZIP"><i class="fa-solid fa-file-zipper"></i></button>
                <button onclick="app.clearExplorerSelection()" title="إلغاء التحديد"><i class="fa-solid fa-xmark"></i></button></div>` : ''}
            <div class="fx-tree" role="tree" tabindex="0" aria-label="ملفات المشروع">${rowHTML || `<div class="fx-empty">${q ? 'لا نتائج' : st.view === 'pinned' ? 'لا توجد ملفات مثبتة' : st.view === 'recent' ? 'لم تفتح ملفات بعد' : 'لا توجد ملفات بعد.<br>أنشئ ملفاً، أو اسحب ملفات/مجلداً إلى هنا.'}</div>`}</div>
            <div class="fx-foot">${all.length} ملف • ${fmtBytes(totalSize)}${this.fileTrash.length ? ` • <button class="fx-link" onclick="app.openProjectTools('trash')"><i class="fa-solid fa-trash-can"></i> ${this.fileTrash.length}</button>` : ''}</div>`;
        if (searchHasFocus || keepSearchFocus === true) {
            const s = el.querySelector('.fx-search');
            if (s) { s.focus(); const c = caret == null ? s.value.length : caret; s.setSelectionRange(c, c); }
        }
    };

    P.clearExplorerSelection = function () { const st = ensureExplorerState(this); st.selected.clear(); st.anchor = null; this.renderStudioExplorer(); };

    P.explorerClick = function (path, kind, { ctrl = false, shift = false } = {}) {
        const st = ensureExplorerState(this);
        if (ctrl) {
            if (st.selected.has(path)) st.selected.delete(path); else st.selected.add(path);
            st.anchor = path;
            this.renderStudioExplorer();
            return;
        }
        if (shift && st.anchor) {
            const rows = this._fxRows || this.buildExplorerRows();
            const a = rows.findIndex(r => r.path === st.anchor), b = rows.findIndex(r => r.path === path);
            if (a !== -1 && b !== -1) {
                st.selected.clear();
                rows.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(r => st.selected.add(r.path));
                this.renderStudioExplorer();
                return;
            }
        }
        st.anchor = path;
        if (st.selected.size) st.selected.clear();
        if (kind === 'folder') {
            if (st.collapsed.has(path)) st.collapsed.delete(path); else st.collapsed.add(path);
            this.renderStudioExplorer();
        } else this.openProjectFile(path);
    };

    P.bindExplorerEvents = function (el) {
        if (el.dataset.bound) return;
        el.dataset.bound = '1';
        const rowOf = (e) => e.target.closest && e.target.closest('.fx-row');
        el.addEventListener('click', (e) => {
            const menuBtn = e.target.closest('[data-menu="explorer"]');
            if (menuBtn) { e.stopPropagation(); this.showExplorerMenu(menuBtn); return; }
            const row = rowOf(e);
            if (!row) return;
            if (e.target.closest('[data-more]')) { e.stopPropagation(); this.showFileContextMenu(row.dataset.path, row.dataset.kind, e.target.closest('[data-more]')); return; }
            this.explorerClick(row.dataset.path, row.dataset.kind, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
            const r = el.querySelector(`.fx-row[data-i="${row.dataset.i}"]`);
            if (r) r.focus({ preventScroll: true });
        });
        el.addEventListener('contextmenu', (e) => {
            const row = rowOf(e);
            if (!row) return;
            e.preventDefault();
            this.showFileContextMenu(row.dataset.path, row.dataset.kind, { x: e.clientX, y: e.clientY });
        });
        el.addEventListener('keydown', (e) => {
            if (e.target.classList.contains('fx-search')) {
                if (e.key === 'ArrowDown') { e.preventDefault(); el.querySelector('.fx-row')?.focus(); }
                if (e.key === 'Enter') { const first = (this._fxRows || []).find(r => r.kind === 'file'); if (first) this.openProjectFile(first.path); }
                return;
            }
            const row = rowOf(e);
            const rows = Array.from(el.querySelectorAll('.fx-row'));
            const idx = row ? rows.indexOf(row) : -1;
            const st = ensureExplorerState(this);
            const targets = () => (st.selected.size ? Array.from(st.selected) : row ? [row.dataset.path] : []);
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const n = rows[Math.max(0, Math.min(rows.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)))];
                if (n) n.focus();
            } else if (e.key === 'Enter' && row) { e.preventDefault(); this.explorerClick(row.dataset.path, row.dataset.kind); }
            else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && row && row.dataset.kind === 'folder') {
                e.preventDefault();
                const collapse = e.key === 'ArrowRight'; // RTL: right = collapse
                if (collapse) st.collapsed.add(row.dataset.path); else st.collapsed.delete(row.dataset.path);
                this.renderStudioExplorer();
                const again = Array.from(el.querySelectorAll('.fx-row')).find(x => x.dataset.path === row.dataset.path); if (again) again.focus();
            } else if (e.key === 'F2' && row) { e.preventDefault(); this.renameProjectPathDialog(row.dataset.path); }
            else if (e.key === 'Delete' && targets().length) { e.preventDefault(); this.deleteProjectPaths(targets()); }
            else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                (this._fxRows || []).filter(r => r.kind === 'file').forEach(r => st.selected.add(r.path));
                this.renderStudioExplorer();
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && row && row.dataset.kind === 'file') {
                e.preventDefault(); const c = this.duplicateProjectFile(row.dataset.path); if (c) this.renderStudioExplorer();
            } else if (e.key === 'Escape' && st.selected.size) { e.preventDefault(); e.stopPropagation(); this.clearExplorerSelection(); }
        });
        // Drag & drop inside the tree (move) — external files are handled by the media module
        el.addEventListener('dragstart', (e) => {
            const row = rowOf(e);
            if (!row) return;
            const st = ensureExplorerState(this);
            const paths = st.selected.has(row.dataset.path) ? Array.from(st.selected) : [row.dataset.path];
            e.dataTransfer.setData('application/x-ox-paths', JSON.stringify(paths));
            e.dataTransfer.setData('text/plain', paths.join('\n'));
            e.dataTransfer.effectAllowed = 'move';
            this._fxDragging = paths;
        });
        el.addEventListener('dragend', () => { this._fxDragging = null; el.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target')); });
        const dropDir = (e) => { const row = rowOf(e); if (!row) return ''; return row.dataset.kind === 'folder' ? row.dataset.path : dirName(row.dataset.path); };
        el.addEventListener('dragover', (e) => {
            const types = Array.from(e.dataTransfer?.types || []);
            if (!types.includes('application/x-ox-paths') && !types.includes('Files')) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = types.includes('Files') ? 'copy' : 'move';
            el.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target'));
            const row = rowOf(e);
            if (row && row.dataset.kind === 'folder') row.classList.add('drop-target'); else el.querySelector('.fx-tree')?.classList.add('drop-target');
        });
        el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target')); });
        el.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            el.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target'));
            if (typeof document !== 'undefined') document.getElementById('drop-overlay')?.classList.remove('active');
            const dir = dropDir(e);
            const raw = e.dataTransfer.getData('application/x-ox-paths');
            if (raw) {
                let paths = [];
                try { paths = JSON.parse(raw); } catch (x) {}
                const n = this.moveProjectPaths(paths, dir);
                if (n) { this.explorerExpandTo(dir + '/x'); this.showToast(`📂 تم نقل ${n} ملف إلى ${this.escapeHTML(dir || 'الجذر')}`, 'success'); }
                return;
            }
            if (e.dataTransfer.files && e.dataTransfer.files.length && this.importDroppedToProject) this.importDroppedToProject(e.dataTransfer, dir);
        });
    };

    // ------------------------------------------------------------------ CONTEXT MENU
    P.showMenu = function (items, anchor) {
        this.hideMenu();
        const m = document.createElement('div');
        m.className = 'fx-menu';
        m.setAttribute('role', 'menu');
        this._menuItems = items.filter(Boolean);
        m.innerHTML = this._menuItems.map((it, i) => it === '-' ? '<div class="fx-menu-sep"></div>'
            : `<button role="menuitem" class="${it.danger ? 'danger' : ''}" data-mi="${i}"><i class="fa-solid ${it.icon || 'fa-circle'}"></i><span>${this.escapeHTML(it.label)}</span>${it.kbd ? `<kbd>${it.kbd}</kbd>` : ''}</button>`).join('');
        document.body.appendChild(m);
        let x, y;
        if (anchor && anchor.getBoundingClientRect) { const r = anchor.getBoundingClientRect(); x = r.left; y = r.bottom + 4; } else { x = (anchor && anchor.x) || 20; y = (anchor && anchor.y) || 20; }
        const w = m.offsetWidth || 220, h = m.offsetHeight || 300;
        const vw = window.innerWidth || 1024, vh = window.innerHeight || 768;
        m.style.left = Math.max(6, Math.min(x, vw - w - 6)) + 'px';
        m.style.top = Math.max(6, Math.min(y, vh - h - 6)) + 'px';
        m.addEventListener('click', (e) => {
            const b = e.target.closest('[data-mi]');
            if (!b) return;
            const it = this._menuItems[+b.dataset.mi];
            this.hideMenu();
            if (it && it.run) it.run();
        });
        m.addEventListener('keydown', (e) => {
            const btns = Array.from(m.querySelectorAll('button'));
            const i = btns.indexOf(document.activeElement);
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length].focus(); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.hideMenu(); }
        });
        this._menuEl = m;
        setTimeout(() => {
            const off = (e) => { if (!m.contains(e.target)) this.hideMenu(); };
            this._menuOff = off;
            document.addEventListener('mousedown', off, true);
            document.addEventListener('touchstart', off, true);
            m.querySelector('button')?.focus();
        }, 0);
        return m;
    };
    P.hideMenu = function () {
        if (this._menuEl) { this._menuEl.remove(); this._menuEl = null; }
        if (this._menuOff) { document.removeEventListener('mousedown', this._menuOff, true); document.removeEventListener('touchstart', this._menuOff, true); this._menuOff = null; }
    };

    P.showFileContextMenu = function (path, kind, anchor) {
        if (kind === 'folder') {
            return this.showMenu([
                { icon: 'fa-file-circle-plus', label: 'ملف جديد هنا', run: () => this.newProjectFileDialog(path) },
                { icon: 'fa-folder-plus', label: 'مجلد جديد هنا', run: () => this.newProjectFolderDialog(path) },
                '-',
                { icon: 'fa-i-cursor', label: 'إعادة تسمية / نقل', kbd: 'F2', run: () => this.renameProjectPathDialog(path) },
                { icon: 'fa-copy', label: 'نسخ المسار', run: () => this.copyText(path, 'تم نسخ المسار') },
                { icon: 'fa-file-zipper', label: 'تحميل المجلد ZIP', run: () => this.downloadPathsAsZip([path], baseName(path)) },
                { icon: 'fa-magnifying-glass', label: 'بحث داخل المجلد', run: () => this.openProjectTools('search', { include: path + '/**' }) },
                { icon: 'fa-wand-magic-sparkles', label: 'تلخيص المجلد وتنظيمه', run: () => this.openFilesHub('smart', 'summary', { dir: path }) },
                '-',
                { icon: 'fa-trash', label: 'حذف المجلد', danger: true, kbd: 'Del', run: () => this.deleteProjectPaths([path]) }
            ], anchor);
        }
        const pinned = this.pinnedFiles.has(path);
        const binary = this.isBinaryProjectFile(path);
        return this.showMenu([
            !binary && { icon: 'fa-pen-to-square', label: 'فتح في المحرر', run: () => this.openProjectFile(path) },
            this.openFilePreview && { icon: 'fa-eye', label: 'معاينة', run: () => this.openFilePreview({ path }) },
            { icon: 'fa-up-right-from-square', label: 'فتح في تبويب جديد', run: () => this.openProjectFileInNewTab(path) },
            '-',
            { icon: 'fa-i-cursor', label: 'إعادة تسمية / نقل', kbd: 'F2', run: () => this.renameProjectPathDialog(path) },
            { icon: 'fa-clone', label: 'نسخة مكررة', kbd: 'Ctrl+D', run: () => { const c = this.duplicateProjectFile(path); if (c) this.showToast(`تم إنشاء ${this.escapeHTML(baseName(c))}`, 'success'); } },
            { icon: 'fa-copy', label: 'نسخ المسار', run: () => this.copyText(path, 'تم نسخ المسار') },
            { icon: 'fa-thumbtack', label: pinned ? 'إلغاء التثبيت' : 'تثبيت في المفضلة', run: () => { this.togglePinFile(path); this.renderStudioExplorer(); } },
            { icon: 'fa-tags', label: 'خصائص: وسوم، قفل، مشاركة…', run: () => this.fmxFileProps(path) },
            '-',
            !binary && { icon: 'fa-clock-rotate-left', label: `سجل الإصدارات (${this.getFileVersions(path).length})`, run: () => this.openFileHistory(path) },
            !binary && { icon: 'fa-code-compare', label: 'مقارنة مع ملف آخر', run: () => this.openProjectTools('compare', { a: path }) },
            !binary && this.openCommitReview && { icon: 'fa-cloud-arrow-up', label: 'مراجعة ورفع إلى GitHub', run: () => this.openCommitReview(path, this.virtualProjectFiles.get(path).content || '') },
            { icon: 'fa-download', label: 'تحميل', run: () => this.downloadProjectFile(path) },
            '-',
            { icon: 'fa-trash', label: 'حذف', danger: true, kbd: 'Del', run: () => this.deleteProjectPaths([path]) }
        ], anchor);
    };

    P.showExplorerMenu = function (anchor) {
        const st = ensureExplorerState(this);
        const sortItem = (k, label) => ({ icon: st.sort === k ? 'fa-check' : 'fa-arrow-down-short-wide', label: `ترتيب: ${label}`, run: () => this.setExplorerSort(k) });
        return this.showMenu([
            { icon: 'fa-magnifying-glass-arrow-right', label: 'بحث واستبدال في المشروع', kbd: 'Ctrl+Shift+H', run: () => this.openProjectTools('search') },
            { icon: 'fa-code-compare', label: 'مقارنة ملفين', run: () => this.openProjectTools('compare') },
            { icon: 'fa-chart-pie', label: 'إحصائيات المشروع', run: () => this.openProjectTools('stats') },
            { icon: 'fa-clone', label: 'الملفات المكررة', run: () => this.openProjectTools('dupes') },
            { icon: 'fa-trash-can', label: `سلة المحذوفات (${this.fileTrash.length})`, run: () => this.openProjectTools('trash') },
            '-',
            sortItem('name', 'الاسم'), sortItem('type', 'النوع'), sortItem('size', 'الحجم'), sortItem('date', 'آخر تعديل'),
            { icon: st.showHidden ? 'fa-eye-slash' : 'fa-eye', label: st.showHidden ? 'إخفاء الملفات المخفية' : 'إظهار الملفات المخفية (.)', run: () => this.toggleHiddenFiles() },
            { icon: 'fa-compress', label: 'طي كل المجلدات', run: () => { this.projectPaths().forEach(p => { const d = p.split('/'); for (let i = 1; i < d.length; i++) st.collapsed.add(d.slice(0, i).join('/')); }); this.renderStudioExplorer(); } },
            '-',
            { icon: 'fa-file-zipper', label: 'تحميل المشروع ZIP', run: () => this.downloadPathsAsZip(this.projectPaths(), 'project') },
            { icon: 'fa-broom', label: 'مسح كل ملفات المشروع', danger: true, run: () => this.clearProjectDialog() }
        ], anchor);
    };

    P.clearProjectDialog = async function () {
        const n = this.virtualProjectFiles.size;
        if (!n) return;
        if (!(await this.askConfirm('مسح ملفات المشروع', `سيتم نقل <b>${n}</b> ملف إلى سلة المحذوفات (آخر ${MAX_TRASH} فقط تبقى قابلة للاستعادة). متابعة؟`, { danger: true, okLabel: 'مسح' }))) return;
        this.deleteProjectPaths(this.projectPaths(), { toast: false });
        this.projectFolders.clear();
        this.showToast('تم مسح ملفات المشروع', 'success');
    };

    // ------------------------------------------------------------------ BULK OPERATIONS
    P.bulkDeleteSelected = function () {
        const st = ensureExplorerState(this);
        const paths = Array.from(st.selected);
        if (!paths.length) return;
        st.selected.clear();
        this.deleteProjectPaths(paths);
    };

    P.bulkMoveSelected = async function () {
        const st = ensureExplorerState(this);
        const paths = Array.from(st.selected);
        if (!paths.length) return;
        const dir = await this.askText(`📂 نقل ${paths.length} عنصر إلى مجلد`, dirName(paths[0]), { label: 'المجلد الهدف (فارغ = الجذر)', okLabel: 'نقل', validate: (v) => (v === '' || normPath(v) ? null : 'مسار غير صالح') });
        if (dir === null) return;
        const n = this.moveProjectPaths(paths, dir);
        st.selected.clear();
        this.explorerExpandTo(normPath(dir) + '/x');
        this.showToast(`📂 تم نقل ${n} ملف`, 'success');
        this.renderStudioExplorer();
    };

    /** Batch-rename plan: regex/literal find on the file name, tokens {n} {name} {ext}. */
    P.planBatchRename = function (paths, find, replace, { regex = false, start = 1 } = {}) {
        let re;
        try { re = find ? (regex ? new RegExp(find, 'g') : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) : null; }
        catch (e) { return { error: 'تعبير Regex غير صالح: ' + e.message, plan: [] }; }
        const plan = paths.filter(p => this.virtualProjectFiles.has(p)).map((p, i) => {
            const name = baseName(p), dot = name.lastIndexOf('.');
            const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot + 1) : '';
            const tokens = (s) => s.replace(/\{n(?::(\d+))?\}/g, (_, w) => String(start + i).padStart(+w || 0, '0')).replace(/\{name\}/g, stem).replace(/\{ext\}/g, ext);
            const newName = re ? name.replace(re, regex ? tokens(replace) : tokens(replace).replace(/\$/g, '$$$$')) : tokens(replace || name);
            return { from: p, to: joinPath(dirName(p), newName) };
        });
        const targets = new Map();
        plan.forEach(x => {
            if (!baseName(x.to) || /[\\]/.test(x.to)) x.error = 'اسم غير صالح';
            else if (targets.has(x.to)) x.error = 'تكرار';
            else if (x.to !== x.from && this.virtualProjectFiles.has(x.to) && !plan.some(y => y.from === x.to)) x.error = 'موجود مسبقاً';
            targets.set(x.to, true);
        });
        return { plan, error: null };
    };

    P.applyBatchRename = function (plan) {
        const ok = plan.filter(x => !x.error && x.to !== x.from);
        // Two phases avoid collisions when names swap (a→b, b→a)
        const tmp = ok.map(x => { const t = `${x.from}.__ox_tmp_${Math.random().toString(36).slice(2, 8)}`; this.renameProjectFile(x.from, t, { silent: true }); return [t, x.to]; });
        tmp.forEach(([t, to]) => this.renameProjectFile(t, to, { silent: true }));
        this.scheduleProjectSave();
        if (this.isCodeStudioOpen) this.renderStudioWorkspace();
        return ok.length;
    };

    P.batchRenameDialog = async function () {
        const st = ensureExplorerState(this);
        const paths = Array.from(st.selected).filter(p => this.virtualProjectFiles.has(p));
        if (!paths.length) { this.showToast('حدد ملفات أولاً (Ctrl+نقر)', 'warning'); return; }
        const preview = () => {
            const f = document.getElementById('oxd-find')?.value || '', r = document.getElementById('oxd-replace')?.value || '', rx = !!document.getElementById('oxd-regex')?.checked;
            const { plan, error } = this.planBatchRename(paths, f, r, { regex: rx });
            const box = document.getElementById('batch-rename-preview');
            if (box) box.innerHTML = error ? `<div class="text-red">${this.escapeHTML(error)}</div>` : plan.map(x => `<div class="br-row ${x.error ? 'bad' : x.to === x.from ? 'same' : ''}"><span dir="ltr">${this.escapeHTML(baseName(x.from))}</span> ← <span dir="ltr">${this.escapeHTML(baseName(x.to))}</span>${x.error ? ` <b>${x.error}</b>` : ''}</div>`).join('');
        };
        const pending = this.showDialog({
            title: `✏️ إعادة تسمية ${paths.length} ملف`,
            body: '<p class="ox-dialog-msg">الرموز: <code>{n}</code> رقم تسلسلي، <code>{n:3}</code> بثلاث خانات، <code>{name}</code> الاسم بدون امتداد، <code>{ext}</code> الامتداد</p>',
            fields: [
                { id: 'find', label: 'ابحث عن (اتركه فارغاً لاستبدال الاسم كاملاً)', value: '', dir: 'ltr' },
                { id: 'replace', label: 'استبدل بـ', value: '{name}-{n}.{ext}', dir: 'ltr' },
                { id: 'regex', label: 'تعبير نمطي Regex', type: 'checkbox', value: false }
            ],
            buttons: [{ label: 'إعادة التسمية', value: 'ok', primary: true }, { label: 'إلغاء', value: null }]
        });
        const body = document.getElementById('ox-dialog-body');
        if (body) {
            body.insertAdjacentHTML('beforeend', '<div id="batch-rename-preview" class="br-preview"></div>');
            body.querySelectorAll('input').forEach(i => i.addEventListener('input', preview));
            body.querySelectorAll('input[type=checkbox]').forEach(i => i.addEventListener('change', preview));
            preview();
        }
        const r = await pending;
        if (!r) return 0;
        const { plan, error } = this.planBatchRename(paths, r.values.find, r.values.replace, { regex: r.values.regex });
        if (error) { this.showToast(this.escapeHTML(error), 'error'); return 0; }
        const n = this.applyBatchRename(plan);
        st.selected.clear();
        plan.forEach(x => { if (!x.error) st.selected.add(x.to); });
        this.showToast(`✏️ تمت إعادة تسمية ${n} ملف`, 'success');
        this.renderStudioExplorer();
        return n;
    };

    // ------------------------------------------------------------------ SEARCH & REPLACE
    const globToRegex = (glob) => {
        const parts = String(glob || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!parts.length) return null;
        const res = parts.map(g => {
            let r = '';
            for (let i = 0; i < g.length; i++) {
                const c = g[i];
                if (c === '*') { if (g[i + 1] === '*') { r += '.*'; i++; if (g[i + 1] === '/') i++; } else r += '[^/]*'; }
                else if (c === '?') r += '[^/]';
                else r += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
            }
            return { re: new RegExp('^' + r + '$', 'i'), base: !g.includes('/') };
        });
        return (path) => res.some(({ re, base }) => re.test(path) || (base && re.test(baseName(path))));
    };
    P.globMatcher = globToRegex;

    P.buildSearchRegex = function (query, { regex = false, caseSensitive = false, wholeWord = false } = {}) {
        if (!query) return null;
        let src = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (wholeWord) src = `(?<![\\w\\u0600-\\u06FF])(?:${src})(?![\\w\\u0600-\\u06FF])`;
        return new RegExp(src, caseSensitive ? 'gm' : 'gim');
    };

    /** Search all text files. Returns { files: [{path, count, lines:[{n, text, ranges}]}], total, error } */
    P.searchProject = function (query, opts = {}) {
        let re;
        try { re = this.buildSearchRegex(query, opts); } catch (e) { return { files: [], total: 0, error: 'تعبير Regex غير صالح: ' + e.message }; }
        if (!re) return { files: [], total: 0, error: null };
        const include = globToRegex(opts.include), exclude = globToRegex(opts.exclude);
        const files = [];
        let total = 0;
        for (const path of this.projectPaths()) {
            const f = this.virtualProjectFiles.get(path);
            if (isBinaryEntry(f) || typeof f.content !== 'string') continue;
            if (include && !include(path)) continue;
            if (exclude && exclude(path)) continue;
            const lines = [];
            let count = 0;
            f.content.split('\n').forEach((line, n) => {
                re.lastIndex = 0;
                const ranges = [];
                let m;
                while ((m = re.exec(line)) !== null) {
                    if (m[0] === '') { re.lastIndex++; continue; }
                    ranges.push([m.index, m.index + m[0].length]);
                    if (ranges.length > 50) break;
                }
                if (ranges.length) { count += ranges.length; if (lines.length < 200) lines.push({ n: n + 1, text: line.length > 400 ? line.slice(0, 400) + '…' : line, ranges }); }
            });
            if (count) { files.push({ path, count, lines }); total += count; }
            if (total > 20000) break;
        }
        return { files, total, error: null };
    };

    /** Replace in the given files; writes go through history (reason "replace"). Returns { files, replacements }. */
    P.replaceInProject = function (query, replacement, opts = {}, onlyPaths = null) {
        const re = this.buildSearchRegex(query, opts);
        if (!re) return { files: 0, replacements: 0 };
        const rep = opts.regex ? replacement : String(replacement).replace(/\$/g, '$$$$');
        const { files } = this.searchProject(query, opts);
        let nFiles = 0, nRep = 0;
        files.forEach(({ path, count }) => {
            if (onlyPaths && !onlyPaths.includes(path)) return;
            const f = this.virtualProjectFiles.get(path);
            re.lastIndex = 0;
            const next = f.content.replace(re, rep);
            if (next !== f.content) { this.writeProjectFile(path, next, 'replace'); nFiles++; nRep += count; }
        });
        if (nFiles && this.isCodeStudioOpen) this.renderStudioWorkspace();
        return { files: nFiles, replacements: nRep };
    };

    // ------------------------------------------------------------------ PROJECT TOOLS PANEL
    const TOOL_TABS = [
        { id: 'search', icon: 'fa-magnifying-glass-arrow-right', label: 'بحث واستبدال' },
        { id: 'compare', icon: 'fa-code-compare', label: 'مقارنة' },
        { id: 'stats', icon: 'fa-chart-pie', label: 'إحصائيات' },
        { id: 'dupes', icon: 'fa-clone', label: 'المكررات' },
        { id: 'trash', icon: 'fa-trash-can', label: 'المحذوفات' }
    ];

    P.openProjectTools = function (tab = 'search', opts = {}) {
        this._toolsTab = tab;
        this.openPanel({
            title: 'أدوات ملفات المشروع', icon: 'fa-toolbox',
            tabs: TOOL_TABS.map(t => ({ ...t, onclick: `app.openProjectTools('${t.id}')` })), activeTab: tab, body: ''
        });
        const r = { search: 'renderSearchTool', compare: 'renderCompareTool', stats: 'renderStatsTool', dupes: 'renderDupesTool', trash: 'renderTrashTool' }[tab];
        this[r](opts);
    };

    P.renderSearchTool = function (opts = {}) {
        const s = this._searchState = { query: '', replace: '', regex: false, caseSensitive: false, wholeWord: false, include: '', exclude: '', ...(this._searchState || {}), ...opts };
        const esc = (x) => this.escapeHTML(x);
        const tog = (k, label, title) => `<button class="sr-toggle ${s[k] ? 'active' : ''}" onclick="app.toggleSearchOpt('${k}')" title="${title}">${label}</button>`;
        this.setPanelBody(`
            <div class="sr-form">
                <div class="sr-row"><input id="sr-query" class="form-input-box" dir="auto" placeholder="ابحث في كل ملفات المشروع..." value="${esc(s.query)}">
                    ${tog('caseSensitive', 'Aa', 'مطابقة حالة الأحرف')}${tog('wholeWord', '<u>ab</u>', 'كلمة كاملة')}${tog('regex', '.*', 'تعبير نمطي Regex')}</div>
                <div class="sr-row"><input id="sr-replace" class="form-input-box" dir="auto" placeholder="استبدال بـ... (يدعم $1 مع Regex)" value="${esc(s.replace)}"></div>
                <div class="sr-row"><input id="sr-include" class="form-input-box" dir="ltr" placeholder="الملفات المشمولة: *.js, src/**" value="${esc(s.include)}">
                    <input id="sr-exclude" class="form-input-box" dir="ltr" placeholder="المستثناة: *.min.js, dist/**" value="${esc(s.exclude)}"></div>
            </div>
            <div id="sr-results" class="sr-results"></div>`);
        const run = () => {
            ['query', 'replace', 'include', 'exclude'].forEach(k => { s[k] = document.getElementById('sr-' + k)?.value || ''; });
            this.runProjectSearchUI();
        };
        ['query', 'replace', 'include', 'exclude'].forEach(k => {
            const el = document.getElementById('sr-' + k);
            if (el) el.addEventListener('input', () => { clearTimeout(this._srTimer); this._srTimer = setTimeout(run, 180); });
        });
        setTimeout(() => document.getElementById('sr-query')?.focus(), 30);
        this.runProjectSearchUI();
    };
    P.toggleSearchOpt = function (k) {
        const s = this._searchState;
        ['query', 'replace', 'include', 'exclude'].forEach(x => { const el = document.getElementById('sr-' + x); if (el) s[x] = el.value; });
        s[k] = !s[k];
        this.renderSearchTool();
    };

    P.runProjectSearchUI = function () {
        const s = this._searchState;
        const box = document.getElementById('sr-results');
        if (!box) return null;
        const esc = (x) => this.escapeHTML(x);
        if (!s.query) { box.innerHTML = `<div class="gh-empty">اكتب للبحث في ${this.virtualProjectFiles.size} ملف</div>`; this.setPanelFooter(''); return null; }
        const res = this.searchProject(s.query, s);
        this._searchResult = res;
        this._srExcluded = new Set();
        if (res.error) { box.innerHTML = `<div class="gh-empty bad">${esc(res.error)}</div>`; this.setPanelFooter(''); return res; }
        const mark = (text, ranges) => {
            let out = '', pos = 0;
            ranges.forEach(([a, b]) => { if (a >= text.length) return; out += esc(text.slice(pos, a)) + `<mark>${esc(text.slice(a, Math.min(b, text.length)))}</mark>`; pos = Math.min(b, text.length); });
            return out + esc(text.slice(pos));
        };
        box.innerHTML = `<div class="sr-summary">${res.total} نتيجة في ${res.files.length} ملف</div>` + res.files.map((f, fi) => `
            <details class="sr-file" open>
                <summary><input type="checkbox" checked onclick="event.stopPropagation(); app.toggleSearchFile(${fi}, this.checked)" title="تضمين في الاستبدال">
                    <i class="${this.fileIcon(f.path)[0]}" style="color:${this.fileIcon(f.path)[1]}"></i> <span dir="ltr">${esc(f.path)}</span> <span class="gh-badge dim">${f.count}</span></summary>
                ${f.lines.map(l => `<div class="sr-line" onclick="app.openSearchHit(${fi}, ${l.n})"><span class="ln">${l.n}</span><code dir="ltr">${mark(l.text, l.ranges)}</code></div>`).join('')}
            </details>`).join('');
        this.setPanelFooter(res.files.length ? `<span class="text-dim" style="font-size:0.78rem">الاستبدال يُحفظ في سجل إصدارات كل ملف (قابل للتراجع)</span><span class="gh-spacer"></span><button class="btn-new-thread gh-btn" onclick="app.confirmProjectReplace()"><i class="fa-solid fa-right-left"></i> استبدال الكل</button>` : '');
        return res;
    };
    P.toggleSearchFile = function (i, on) { const f = this._searchResult?.files[i]; if (!f) return; if (on) this._srExcluded.delete(f.path); else this._srExcluded.add(f.path); };
    P.openSearchHit = function (fi, line) {
        const f = this._searchResult?.files[fi];
        if (!f) return;
        this.closeModals();
        this.openProjectFile(f.path);
        const ed = document.getElementById('studio-editor-textarea');
        if (ed) {
            const lines = ed.value.split('\n');
            const pos = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
            ed.focus(); ed.setSelectionRange(pos, pos + (lines[line - 1] || '').length);
            ed.scrollTop = Math.max(0, (line - 5) * 20);
        }
    };
    P.confirmProjectReplace = async function () {
        const s = this._searchState, res = this._searchResult;
        if (!res || !res.files.length) return null;
        const targets = res.files.filter(f => !this._srExcluded.has(f.path)).map(f => f.path);
        const n = res.files.filter(f => targets.includes(f.path)).reduce((a, f) => a + f.count, 0);
        if (!(await this.askConfirm('استبدال في المشروع', `استبدال <b>${n}</b> نتيجة في <b>${targets.length}</b> ملف بـ «<code>${this.escapeHTML(s.replace)}</code>»؟`, { okLabel: 'استبدال' }))) return null;
        const r = this.replaceInProject(s.query, s.replace, s, targets);
        this.showToast(`✅ تم استبدال ${r.replacements} نتيجة في ${r.files} ملف`, 'success');
        this.runProjectSearchUI();
        return r;
    };

    // ---- compare two files / versions
    P.renderCompareTool = function (opts = {}) {
        const paths = this.projectPaths().filter(p => !this.isBinaryProjectFile(p));
        const c = this._compareState = { a: paths[0] || '', b: paths[1] || paths[0] || '', ...(this._compareState || {}), ...opts };
        if (opts.a && !opts.b) c.b = paths.find(p => p !== opts.a && extOf(p) === extOf(opts.a)) || paths.find(p => p !== opts.a) || opts.a;
        const esc = (x) => this.escapeHTML(x);
        const sel = (id, v) => `<select id="${id}" class="form-input-box" dir="ltr" onchange="app.updateCompare()">${paths.map(p => `<option value="${esc(p)}" ${p === v ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>`;
        if (paths.length < 2) { this.setPanelBody('<div class="gh-empty">تحتاج ملفين نصيين على الأقل في المشروع للمقارنة.</div>'); return; }
        this.setPanelBody(`
            <div class="cmp-head">${sel('cmp-a', c.a)}<button class="sidebar-btn-util gh-btn" onclick="app.swapCompare()" title="تبديل"><i class="fa-solid fa-right-left"></i></button>${sel('cmp-b', c.b)}
                <button class="sidebar-btn-util gh-btn" onclick="app.toggleCompareView()"><i class="fa-solid fa-table-columns"></i> <span>${this.diffViewMode === 'split' ? 'موحد' : 'جنباً إلى جنب'}</span></button></div>
            <div id="cmp-stats" class="diff-stats" style="margin:6px 0"></div>
            <div class="git-diff-container" id="cmp-output"></div>`);
        this.updateCompare();
    };
    P.updateCompare = function () {
        const c = this._compareState;
        const a = document.getElementById('cmp-a'), b = document.getElementById('cmp-b');
        if (a) c.a = a.value; if (b) c.b = b.value;
        const A = (this.virtualProjectFiles.get(c.a)?.content || '').split('\n'), B = (this.virtualProjectFiles.get(c.b)?.content || '').split('\n');
        const ops = this.diffLines(A, B), st = this.diffStats(ops);
        const out = document.getElementById('cmp-output');
        if (out) { out.innerHTML = this.renderDiffHTML(A, B, ops, this.diffViewMode || 'unified'); out.classList.toggle('split', this.diffViewMode === 'split'); }
        const s = document.getElementById('cmp-stats');
        if (s) s.innerHTML = `<span class="add">+${st.add}</span> <span class="del">−${st.del}</span>`;
        return st;
    };
    P.swapCompare = function () { const c = this._compareState; [c.a, c.b] = [c.b, c.a]; this.renderCompareTool(); };
    P.toggleCompareView = function () { this.diffViewMode = this.diffViewMode === 'split' ? 'unified' : 'split'; this.renderCompareTool(); };

    // ---- stats
    P.computeProjectStats = function () {
        const byExt = new Map();
        let files = 0, bytes = 0, lines = 0;
        const sizes = [];
        this.projectPaths().forEach(p => {
            const f = this.virtualProjectFiles.get(p);
            const size = entrySize(f);
            const l = isBinaryEntry(f) ? 0 : (f.content || '').split('\n').length;
            const ext = extOf(p) || '(بدون)';
            const e = byExt.get(ext) || { ext, files: 0, bytes: 0, lines: 0 };
            e.files++; e.bytes += size; e.lines += l; byExt.set(ext, e);
            files++; bytes += size; lines += l; sizes.push({ path: p, size });
        });
        const folders = new Set();
        this.projectPaths().forEach(p => { const d = p.split('/'); for (let i = 1; i < d.length; i++) folders.add(d.slice(0, i).join('/')); });
        return { files, bytes, lines, folders: folders.size, byExt: Array.from(byExt.values()).sort((a, b) => b.bytes - a.bytes), largest: sizes.sort((a, b) => b.size - a.size).slice(0, 10) };
    };
    P.renderStatsTool = function () {
        const s = this.computeProjectStats();
        const esc = (x) => this.escapeHTML(x);
        if (!s.files) { this.setPanelBody('<div class="gh-empty">لا توجد ملفات في المشروع.</div>'); return s; }
        const colors = ['#34d399', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#f87171', '#2dd4bf', '#94a3b8'];
        const stat = (icon, label, val) => `<div class="gh-stat"><i class="fa-solid ${icon}"></i><b>${val}</b><span>${label}</span></div>`;
        this.setPanelBody(`
            <div class="gh-stats">${stat('fa-file', 'ملف', s.files)}${stat('fa-folder', 'مجلد', s.folders)}${stat('fa-hard-drive', 'الحجم', fmtBytes(s.bytes))}${stat('fa-align-left', 'سطر', s.lines.toLocaleString('en'))}${stat('fa-clock-rotate-left', 'إصدار محفوظ', Array.from(this.fileVersions.values()).reduce((n, l) => n + l.length, 0))}</div>
            <div class="gh-card"><b>حسب النوع</b>
                <div class="gh-lang-bar">${s.byExt.map((e, i) => `<span style="width:${(e.bytes / s.bytes * 100).toFixed(2)}%;background:${colors[i % colors.length]}" title="${esc(e.ext)}"></span>`).join('')}</div>
                <table class="fx-table"><thead><tr><th>النوع</th><th>ملفات</th><th>أسطر</th><th>الحجم</th></tr></thead><tbody>
                ${s.byExt.map((e, i) => `<tr><td><i style="background:${colors[i % colors.length]}" class="fx-dot"></i> <span dir="ltr">.${esc(e.ext)}</span></td><td>${e.files}</td><td>${e.lines.toLocaleString('en')}</td><td>${fmtBytes(e.bytes)}</td></tr>`).join('')}</tbody></table></div>
            <div class="gh-card"><b>أكبر الملفات</b>${s.largest.map(x => `<div class="gh-check-row" style="cursor:pointer" onclick="app.closeModals(); app.openProjectFile(app.ghVal(${this.ghRef(x.path)}))"><span dir="ltr" class="truncate" style="flex:1">${esc(x.path)}</span><b>${fmtBytes(x.size)}</b></div>`).join('')}</div>`);
        return s;
    };

    // ---- duplicates
    P.findDuplicateFiles = function () {
        const groups = new Map();
        this.projectPaths().forEach(p => {
            const f = this.virtualProjectFiles.get(p);
            const body = f.dataUrl || f.content || '';
            if (!body.length) return;
            const h = fnv(body);
            if (!groups.has(h)) groups.set(h, []);
            groups.get(h).push(p);
        });
        return Array.from(groups.values()).filter(g => g.length > 1).map(g => g.sort((a, b) => a.length - b.length || a.localeCompare(b)));
    };
    P.renderDupesTool = function () {
        const groups = this.findDuplicateFiles();
        const esc = (x) => this.escapeHTML(x);
        const extra = groups.reduce((n, g) => n + g.length - 1, 0);
        const wasted = groups.reduce((n, g) => n + entrySize(this.virtualProjectFiles.get(g[0])) * (g.length - 1), 0);
        this.setPanelBody(groups.length ? `
            <div class="gh-card">${groups.length} مجموعة متطابقة المحتوى • ${extra} نسخة زائدة • ${fmtBytes(wasted)} مهدرة</div>
            ${groups.map(g => `<div class="gh-card"><b>${fmtBytes(entrySize(this.virtualProjectFiles.get(g[0])))}</b>${g.map((p, i) => `<div class="gh-check-row"><span class="gh-badge ${i ? 'warn' : 'ok'}">${i ? 'نسخة' : 'يُبقى'}</span> <span dir="ltr">${esc(p)}</span></div>`).join('')}</div>`).join('')}` : '<div class="gh-empty">✅ لا توجد ملفات مكررة.</div>');
        this.setPanelFooter(groups.length ? `<span class="gh-spacer"></span><button class="btn-new-thread gh-btn danger" onclick="app.deleteDuplicateFiles()"><i class="fa-solid fa-trash"></i> حذف ${extra} نسخة (تبقى في السلة)</button>` : '');
        return groups;
    };
    P.deleteDuplicateFiles = function () {
        const extra = this.findDuplicateFiles().flatMap(g => g.slice(1));
        if (!extra.length) return [];
        const del = this.deleteProjectPaths(extra);
        if (this._toolsTab === 'dupes') this.renderDupesTool();
        return del;
    };

    // ---- trash
    P.renderTrashTool = function () {
        const esc = (x) => this.escapeHTML(x);
        const items = this.fileTrash.slice().reverse();
        this.setPanelBody(items.length ? `<div class="gh-list">${items.map(t => `
            <div class="gh-item static"><i class="${this.fileIcon(t.path)[0]}" style="color:${this.fileIcon(t.path)[1]}"></i>
                <div class="gh-item-main"><div class="gh-item-title" dir="ltr" style="text-align:right">${esc(t.path)}</div>
                <div class="gh-item-meta">${this.ghTimeAgo ? this.ghTimeAgo(new Date(t.deletedAt).toISOString()) : new Date(t.deletedAt).toLocaleString()} • ${fmtBytes(entrySize(t.data))}${t.versions?.length ? ` • ${t.versions.length} إصدار` : ''}</div></div>
                <div class="gh-item-actions"><button class="sidebar-btn-util gh-btn" onclick="app.restoreTrashItemUI(${this.ghRef(t.id)})"><i class="fa-solid fa-rotate-left"></i> استعادة</button></div></div>`).join('')}</div>`
            : '<div class="gh-empty">🗑️ سلة المحذوفات فارغة.</div>');
        this.setPanelFooter(items.length ? `<span class="text-dim" style="font-size:0.76rem">آخر ${MAX_TRASH} ملف محذوف فقط</span><span class="gh-spacer"></span><button class="sidebar-btn-util gh-btn danger" onclick="app.emptyTrash()"><i class="fa-solid fa-trash"></i> إفراغ السلة</button>` : '');
    };
    P.restoreTrashItemUI = function (ref) {
        const p = this.restoreTrashItem(this.ghVal(ref));
        if (p) { this.showToast(`↶ تمت استعادة ${this.escapeHTML(p)}`, 'success'); this.explorerExpandTo(p); }
        if (this.isCodeStudioOpen) this.renderStudioWorkspace();
        this.renderTrashTool();
    };
    P.emptyTrash = async function () {
        if (!(await this.askConfirm('إفراغ السلة', `حذف ${this.fileTrash.length} ملف نهائياً؟ لا يمكن التراجع.`, { danger: true, okLabel: 'حذف نهائي' }))) return;
        this.fileTrash = [];
        this.scheduleProjectSave();
        this.renderTrashTool();
    };

    // ------------------------------------------------------------------ VERSION HISTORY UI
    const REASONS = { edit: 'تحرير', external: 'تغيير تلقائي', replace: 'بحث واستبدال', restore: 'قبل الاستعادة', create: 'إنشاء', format: 'تنسيق' };
    P.openFileHistory = function (path) {
        path = path || this.activeStudioFile;
        if (!path || !this.virtualProjectFiles.has(path)) { this.showToast('افتح ملفاً أولاً', 'warning'); return; }
        this._historyPath = path;
        this._historySel = this._historySel && this._historySel.path === path ? this._historySel : { path, index: this.getFileVersions(path).length - 1 };
        this.openPanel({
            title: `سجل الإصدارات: ${path}`, icon: 'fa-clock-rotate-left',
            actions: `<button class="sidebar-btn-util gh-btn" onclick="app.toggleHistoryView()" title="تبديل العرض"><i class="fa-solid fa-table-columns"></i></button>`
        });
        this.renderFileHistory();
    };
    P.toggleHistoryView = function () { this.diffViewMode = this.diffViewMode === 'split' ? 'unified' : 'split'; this.renderFileHistory(); };
    P.renderFileHistory = function () {
        const path = this._historyPath;
        const versions = this.getFileVersions(path);
        const cur = this.virtualProjectFiles.get(path)?.content || '';
        const esc = (x) => this.escapeHTML(x);
        if (!versions.length) {
            this.setPanelBody('<div class="gh-empty">لا توجد إصدارات سابقة لهذا الملف بعد.<br><span class="text-dim" style="font-size:0.8rem">يُحفظ إصدار تلقائياً عند كل جلسة تحرير (دقيقة)، وقبل أي استبدال أو كود من الذكاء الاصطناعي أو دمج.</span></div>');
            this.setPanelFooter('');
            return;
        }
        let idx = this._historySel.index;
        if (idx < 0 || idx >= versions.length) idx = this._historySel.index = versions.length - 1;
        const curLines = cur.split('\n');
        const list = versions.map((v, i) => {
            const st = this.diffStats(this.diffLines(v.content.split('\n'), curLines));
            return { v, i, st };
        }).reverse();
        const sel = versions[idx];
        const selLines = sel.content.split('\n');
        const ops = this.diffLines(curLines, selLines);
        const when = (t) => (this.ghTimeAgo ? this.ghTimeAgo(new Date(t).toISOString()) : new Date(t).toLocaleString());
        this.setPanelBody(`
            <div class="hist-layout">
                <div class="hist-list">
                    <div class="hist-item current"><b>الحالي</b><span>${fmtBytes(byteLen(cur))}</span></div>
                    ${list.map(({ v, i, st }) => `<button class="hist-item ${i === idx ? 'active' : ''}" onclick="app.selectHistoryVersion(${i})">
                        <b>${when(v.savedAt || v.t)}</b><span>${REASONS[v.reason] || esc(v.reason)} • <span class="text-emerald">+${st.del}</span> <span class="text-red">−${st.add}</span></span></button>`).join('')}
                </div>
                <div class="hist-diff">
                    <div class="diff-context-note">التغييرات التي ستحدث عند استعادة إصدار <b>${when(sel.savedAt || sel.t)}</b> (${new Date(sel.savedAt || sel.t).toLocaleString()})</div>
                    <div class="git-diff-container ${this.diffViewMode === 'split' ? 'split' : ''}" id="hist-output">${this.renderDiffHTML(curLines, selLines, ops, this.diffViewMode || 'unified')}</div>
                </div>
            </div>`);
        this.setPanelFooter(`<button class="sidebar-btn-util gh-btn" onclick="app.downloadHistoryVersion()"><i class="fa-solid fa-download"></i> تحميل هذا الإصدار</button>
            <span class="gh-spacer"></span><button class="btn-new-thread gh-btn" onclick="app.restoreHistoryVersion()" ${sel.content === cur ? 'disabled' : ''}><i class="fa-solid fa-rotate-left"></i> استعادة هذا الإصدار</button>`);
    };
    P.selectHistoryVersion = function (i) { this._historySel.index = i; this.renderFileHistory(); };
    P.restoreHistoryVersion = function () {
        const path = this._historyPath, v = this.getFileVersions(path)[this._historySel.index];
        if (!v) return false;
        this.writeProjectFile(path, v.content, 'restore');   // the current text becomes a version → restore is undoable
        this._historySel.index = this.getFileVersions(path).length - 1;
        this.showToast(`↶ تمت استعادة الإصدار — يمكنك التراجع من نفس السجل`, 'success');
        if (this.isCodeStudioOpen && this.activeStudioFile === path) this.renderStudioWorkspace();
        this.closeModals();
        return true;
    };
    P.downloadHistoryVersion = function () {
        const path = this._historyPath, v = this.getFileVersions(path)[this._historySel.index];
        if (!v) return;
        const stamp = new Date(v.savedAt || v.t).toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const name = baseName(path), dot = name.lastIndexOf('.');
        this.downloadBlob(new Blob([v.content], { type: 'text/plain;charset=utf-8' }), dot > 0 ? `${name.slice(0, dot)}.${stamp}${name.slice(dot)}` : `${name}.${stamp}`);
    };

    // ------------------------------------------------------------------ PALETTE + SHORTCUTS + INIT
    const _origPalette = P.buildPaletteCommands;
    if (_origPalette) {
        P.buildPaletteCommands = function () {
            const cmds = _origPalette.call(this);
            const self = this, S = 'الملفات';
            const extra = [
                { section: S, icon: 'fa-folder-tree', label: 'مستكشف ملفات المشروع', hint: 'Explorer', kbd: 'Ctrl+Shift+E', run: () => self.toggleStudioExplorer(true) },
                { section: S, icon: 'fa-file-circle-plus', label: 'ملف جديد من قالب', hint: 'New file', run: () => self.newProjectFileDialog() },
                { section: S, icon: 'fa-folder-plus', label: 'مجلد جديد بهيكل جاهز', hint: 'New folder / scaffold', run: () => self.newProjectFolderDialog() },
                { section: S, icon: 'fa-magnifying-glass-arrow-right', label: 'بحث واستبدال في المشروع', hint: 'Find & replace', kbd: 'Ctrl+Shift+H', run: () => self.openProjectTools('search') },
                { section: S, icon: 'fa-clock-rotate-left', label: 'سجل إصدارات الملف الحالي', hint: 'File history', run: () => self.openFileHistory() },
                { section: S, icon: 'fa-code-compare', label: 'مقارنة ملفين', hint: 'Compare files', run: () => self.openProjectTools('compare') },
                { section: S, icon: 'fa-chart-pie', label: 'إحصائيات المشروع', hint: 'Project stats', run: () => self.openProjectTools('stats') },
                { section: S, icon: 'fa-clone', label: 'كشف الملفات المكررة', hint: 'Duplicates', run: () => self.openProjectTools('dupes') },
                { section: S, icon: 'fa-trash-can', label: 'سلة المحذوفات', hint: 'Trash', run: () => self.openProjectTools('trash') },
                ...self.recentFiles.filter(p => self.virtualProjectFiles.has(p)).slice(0, 8).map(p => ({ section: 'ملفات حديثة', icon: 'fa-file-code', label: baseName(p), hint: p, run: () => self.openProjectFile(p) }))
            ];
            return cmds.concat(extra);
        };
    }

    P.initSprint4Files = function () {
        this.installProjectFileHooks();
        ensureExplorerState(this);
        window.addEventListener('keydown', (e) => {
            const ctrl = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();
            const dialog = document.getElementById('ox-dialog');
            if (e.key === 'Escape' && dialog && dialog.classList.contains('active')) { e.preventDefault(); e.stopImmediatePropagation(); this.resolveDialog(null); return; }
            if (e.key === 'Escape' && this._menuEl) { e.preventDefault(); e.stopImmediatePropagation(); this.hideMenu(); return; }
            if (ctrl && e.shiftKey && k === 'e') { e.preventDefault(); this.toggleStudioExplorer(); }
            if (ctrl && e.shiftKey && k === 'h') { e.preventDefault(); this.openProjectTools('search'); }
        }, true);
        window.addEventListener('pagehide', () => { if (this._projectSaveTimer) this.saveProjectNow(); });
        const origClose = this.closeModals;
        this.closeModals = function () { if (this._dialogResolve) this.resolveDialog(null); this.hideMenu(); return origClose.apply(this, arguments); };
        this._projectReady = this.restoreProjectFromIDB();
        this.renderStudioExplorer();
    };

    if (window.app) {
        try { window.app.initSprint4Files(); } catch (e) { console.error('Sprint 4 files init failed', e); }
    }
})();
