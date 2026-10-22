/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 10: Files & Media studio (main-bundle core)
   Everything heavy lives in the lazy chunk src/media/media.js → assets/studio/media-[hash].mjs
   (including the image editor + recorder, moved out of 07-media.js to stay under budget).
   This file only: lazy stubs + app.fmx() • file metadata used at startup (lock #577, watch #578,
   hide #649, archive #650) • palette section + Alt+O.
   ============================================================================== */
(function () {
    'use strict';
    if (typeof OXAlphaApp === 'undefined') return;
    const P = OXAlphaApp.prototype;

    const STUBS = ('openFilesHub fmxLoad fmxFileProps openMediaPlayer openPresentation renderImagePipeline openImageEditor imgEdSet imgEdBaseDims imgEdSize imgEdScale ' +
        'imgEdSyncInputs imgEdRotate imgEdReset imgEdRender imgEdToggleCrop imgEdApplyCrop bindCropEvents imgEdExport imgEdBatch pickRecorderMime openRecorder ' +
        'renderRecorder startRecording pauseRecording stopRecording finishRecording stopRecorderStreams snapshotRecording saveRecording').split(' ');
    P.ensureFMX = async function (opts = {}) {
        try { await this.loadChunk('media'); return true; } catch (e) {
            console.warn('[OX] media chunk failed', e);
            if (!opts.quiet) this.showToast('تعذر تحميل أدوات الملفات والوسائط — تحقق من الاتصال', 'error');
            return false;
        }
    };
    /** Call a lazy Files & Media method: app.fmx('fmxLoad', 'audio', 'editor') */
    P.fmx = async function (method, ...args) {
        if (!(await this.ensureFMX())) return null;
        const fn = this[method];
        if (typeof fn !== 'function' || fn.__oxLazy) throw new Error('unknown media method ' + method);
        return fn.apply(this, args);
    };
    STUBS.forEach((name) => {
        if (P[name]) return;
        const stub = function (...args) { return this.fmx(name, ...args); };
        stub.__oxLazy = 'media';
        P[name] = stub;
    });
    P.lazyFMXMethods = () => STUBS.slice();

    // ------------------------------------------------------------------ FILE METADATA (tags, likes, lock, watch, hide…)
    const META_KEY = 'ox_fmx_meta_v1';
    P.fileMetaAll = function () {
        if (!this._fmxMeta) { try { this._fmxMeta = JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch (e) { this._fmxMeta = {}; } }
        return this._fmxMeta;
    };
    P.fileMeta = function (path) { return this.fileMetaAll()[path] || {}; };
    P.setFileMeta = function (path, patch) {
        const all = this.fileMetaAll(), m = { ...(all[path] || {}), ...patch };
        Object.keys(m).forEach(k => { if (m[k] == null || m[k] === false || (Array.isArray(m[k]) && !m[k].length)) delete m[k]; });
        if (Object.keys(m).length) all[path] = m; else delete all[path];
        try { localStorage.setItem(META_KEY, JSON.stringify(all)); } catch (e) {}
        return m;
    };

    // Lock (#577): writes to a locked file are reverted. Watch (#578): notify when a watched file changes.
    const _onWrite = P.onProjectFileWrite;
    P.onProjectFileWrite = function (path, prev, next) {
        const m = this.fileMeta(path);
        if (m.locked && prev && !this._fmxUnlock && (!next || next.content !== prev.content)) {
            this._suspendFileHooks = true;
            try { this.virtualProjectFiles.set(path, prev); } finally { this._suspendFileHooks = false; }
            if (path === this.activeStudioFile && this.codeEditor && this.codeEditor.setValue) try { this.codeEditor.setValue(prev.content || ''); } catch (e) {}
            if (Date.now() - (this._fmxLockToast || 0) > 1500) { this._fmxLockToast = Date.now(); this.showToast(`🔒 ${this.escapeHTML(path)} مقفل — افتحه من «خصائص الملف» للتعديل`, 'warning'); }
            return;
        }
        const r = _onWrite.apply(this, arguments);
        if (this._fmxWins && this.fmxWinPost && !this.fmxWinPost.__oxLazy) try { this.fmxWinPost(path, next); } catch (e) {}
        if (m.watch && prev && next && prev.content !== next.content && (this._writeReason || 'external') !== 'edit') {
            const msg = `👁️ تغيّر الملف المراقَب ${path}`;
            this.showToast(this.escapeHTML(msg), 'info');
            (this.fmxWatchLog = this.fmxWatchLog || []).unshift({ path, t: Date.now() });
            try { if (window.Notification && Notification.permission === 'granted' && document.hidden) new Notification('OX-Alpha', { body: msg }); } catch (e) {}
        }
        return r;
    };

    // Hide (#649) / archive (#650): hidden files leave the explorer unless "show hidden" is on.
    const _rows = P.buildExplorerRows;
    P.buildExplorerRows = function () {
        const rows = _rows.apply(this, arguments);
        const st = this.getExplorerState ? this.getExplorerState() : {};
        if (st.showHidden) return rows;
        const all = this.fileMetaAll();
        return rows.filter(r => r.kind !== 'file' || !(all[r.path] && all[r.path].hidden));
    };

    // ------------------------------------------------------------------ PALETTE + SHORTCUT
    const TABS = [['browse', 'folder-tree', 'متصفح الملفات'], ['smart', 'wand-magic-sparkles', 'تنظيم ذكي'], ['share', 'share-nodes', 'مشاركة ومزامنة'], ['convert', 'arrows-rotate', 'تحويل وأرشفة'],
        ['start', 'rocket', 'قوالب واستيراد'], ['image', 'image', 'استوديو الصور'], ['video', 'film', 'الفيديو'], ['audio', 'wave-square', 'الصوت'], ['voice', 'microphone-lines', 'الكلام'],
        ['call', 'phone', 'المكالمات'], ['create', 'clapperboard', 'الإنتاج'], ['player', 'circle-play', 'المشغل']];
    P.FMX_TABS = TABS.map(([id, icon, label]) => ({ id, icon: 'fa-' + icon, label }));
    const _pal = P.buildPaletteCommands;
    P.buildPaletteCommands = function () {
        const self = this, S = 'الملفات والوسائط';
        return _pal.apply(this, arguments).concat(TABS.map(([id, icon, label]) => ({ section: S, icon: 'fa-' + icon, label: 'استوديو — ' + label, hint: id, run: () => self.openFilesHub(id) })));
    };
    /** #fmxshare=… (shared file link #562-#565) and #fmxcall=… (call invitation #693) open the lazy studio. */
    P.handleMediaHash = function (hash = location.hash) {
        if (/^#fmxshare=/.test(hash)) return this.fmx('fmxOpenShareHash', hash);
        if (/^#fmxcall=/.test(hash)) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} return this.fmx('fmxOpenCallHash', hash); }
        return null;
    };
    P.initSprint10Media = function () {
        window.addEventListener('hashchange', () => { this.handleMediaHash(); });
        if (/^#fmx(share|call)=/.test(location.hash)) setTimeout(() => { this.handleMediaHash(); }, 80);
        window.addEventListener('keydown', (e) => {
            if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key || '').toLowerCase() !== 'o') return;
            e.preventDefault();
            this.openFilesHub();
        });
        if (this.BUILTIN_SHORTCUTS && !this.BUILTIN_SHORTCUTS.some(x => x[0] === 'Alt+O')) this.BUILTIN_SHORTCUTS.push(['Alt+O', 'استوديو الملفات والوسائط']);
    };
    if (window.app) {
        try { window.app.initSprint10Media(); } catch (e) { console.error('Sprint 10 init failed', e); }
    }
})();
