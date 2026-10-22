/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 6: Editor & Code (loader)
   The editor (CodeMirror 6, #131) and the runner (#151-#180, #211-#230) are ES
   module chunks built by esbuild into assets/studio/ and loaded on first use, so
   the main bundle stays small. This file wires them into the app:
     • loadChunk / ensureStudio / ensureRunner + lazy stubs for UI entry points
     • mounts the editor when the studio opens, idle modulepreload (not on data saver)
     • tools worker (Prettier #140, ESLint #141) — workers/tools.js
     • chat code blocks run in the isolated runner + real formatting (#151, #152, #140)
   ============================================================================== */
(function () {
    'use strict';
    if (typeof OXAlphaApp === 'undefined') return;
    const P = OXAlphaApp.prototype;
    const chunkMap = () => ((typeof window !== 'undefined' && window.OX_BUILD && window.OX_BUILD.chunks) || {});

    // ------------------------------------------------------------------ CHUNK LOADING
    /** Overridable (tests import the built chunk with Node). */
    P.importModule = function (url) {
        return import(new URL(url, document.baseURI).href);
    };
    P.loadChunk = function (name) {
        this._chunks = this._chunks || {};
        if (!this._chunks[name]) {
            const url = chunkMap()[name];
            if (!url) return Promise.reject(new Error(`الجزء «${name}» غير متوفر في هذا البناء`));
            this._chunks[name] = Promise.resolve()
                .then(() => this.importModule(url))
                .then((mod) => { mod.install(this); return mod; })
                .catch((e) => { delete this._chunks[name]; throw e; });
        }
        return this._chunks[name];
    };
    const ensure = (name, failMsg) => async function (opts = {}) {
        try { await this.loadChunk(name); return true; } catch (e) {
            console.warn(`[OX] ${name} chunk failed`, e);
            if (!opts.quiet) this.showToast(failMsg, 'error');
            return false;
        }
    };
    P.ensureStudio = ensure('studio', 'تعذر تحميل المحرر المتقدم — يُستخدم المحرر البسيط (تحقق من الاتصال)');
    P.ensureRunner = ensure('runner', 'تعذر تحميل مشغل الأكواد — تحقق من الاتصال وأعد المحاولة');
    /** Call a chunk method by name, loading the chunk first: app.studio('openEditorSettings', 'keys') */
    P.studio = async function (method, ...args) {
        const chunk = RUNNER_STUBS.includes(method) ? 'runner' : 'studio';
        const ok = chunk === 'runner' ? await this.ensureRunner() : await this.ensureStudio();
        if (!ok) return null;
        if (chunk === 'studio' && this.isCodeStudioOpen && this.mountCodeEditor) this.mountCodeEditor();
        const fn = this[method];
        if (typeof fn !== 'function' || fn.__oxLazy) throw new Error('unknown studio method ' + method);
        return fn.apply(this, args);
    };

    // UI entry points that live in the chunks. Only methods no chunk wraps (_orig…) may be stubbed.
    const STUDIO_STUBS = ['openEditorSettings', 'openEditorToolsMenu', 'openEditorAIMenu', 'toggleSplitEditor', 'toggleMacroRecording', 'playLastMacro', 'toggleEditorZen',
        'gotoDefinition', 'findReferences', 'renameSymbol', 'openDependencies', 'compareFoldersUI', 'aiFixCode', 'aiExplainSelection', 'aiGenerateTests', 'aiDetectBugs',
        'toggleInlineAI', 'eslintFixFile', 'csvToJsonFromEditor', 'changeCaseSelection', 'sortSelectedLines', 'trimTrailingWhitespace', 'jsonToTypesFromEditor', 'convertCjsToEsm',
        'insertFakeData', 'generateClassMembers', 'resetEditorSettings', 'exportEditorSettings', 'importEditorSettings', 'importVSCodeSettings', 'importVSCodeKeybindings'];
    const RUNNER_STUBS = ['runCode', 'runProject', 'runTests', 'togglePreview', 'refreshPreview', 'openRunHistory', 'clearRunHistory', 'openRunEnv', 'stopRun', 'toggleRunStdin',
        'runStudioSelection', 'fixLastRunError', 'auditActiveHTML'];
    const defineLazy = (name, chunk) => {
        if (P[name]) return; // never shadow an existing implementation (chunks may wrap it)
        const stub = function (...args) { return this.studio(name, ...args); };
        stub.__oxLazy = chunk;
        P[name] = stub;
    };
    STUDIO_STUBS.forEach((n) => defineLazy(n, 'studio'));
    RUNNER_STUBS.forEach((n) => defineLazy(n, 'runner'));
    P.lazyStudioMethods = () => ({ studio: STUDIO_STUBS.slice(), runner: RUNNER_STUBS.slice() });

    // ------------------------------------------------------------------ STUDIO HOOKS
    const _toggleStudio = P.toggleCodeStudio;
    P.toggleCodeStudio = function (forceState) {
        const r = _toggleStudio.apply(this, arguments);
        if (this.isCodeStudioOpen && chunkMap().studio) {
            this.ensureStudio({ quiet: true }).then((ok) => {
                if (ok && this.isCodeStudioOpen && this.mountCodeEditor) this.mountCodeEditor();
            });
        }
        return r;
    };
    // Run button before the runner chunk is loaded → load it, then the chunk's runStudioCode takes over
    const _runStudio = P.runStudioCode;
    const loaderRun = async function () {
        if (!(await this.ensureRunner())) return _runStudio.apply(this, arguments);
        if (this.runStudioCode === loaderRun) return _runStudio.apply(this, arguments);
        return this.runStudioCode.apply(this, arguments);
    };
    P.runStudioCode = loaderRun;

    // ------------------------------------------------------------------ TOOLS WORKER (Prettier + ESLint)
    const PRETTIER_EXT = ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'json', 'jsonc', 'json5', 'webmanifest', 'css', 'scss', 'less', 'html', 'htm', 'vue', 'md', 'markdown', 'yaml', 'yml', 'graphql', 'gql'];
    P.prettierParserFor = function (path) {
        const name = String(path || '').split('/').pop();
        const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
        return PRETTIER_EXT.includes(ext) ? ext : null;
    };
    /** Overridable (tests provide an in-process worker). */
    P.createToolsWorker = function () {
        return new Worker(new URL('workers/tools.js', document.baseURI).href);
    };
    P.toolsRequest = function (type, payload = {}, { timeout = 30000 } = {}) {
        if (!this._tools) {
            let worker;
            try { worker = this.createToolsWorker(); } catch (e) { return Promise.reject(e); }
            const T = { worker, seq: 0, pending: new Map() };
            const failAll = (err) => {
                T.pending.forEach((p) => { clearTimeout(p.timer); p.reject(err); });
                T.pending.clear();
                try { worker.terminate(); } catch (e) { /* ignore */ }
                if (this._tools === T) this._tools = null;
            };
            worker.onmessage = (e) => {
                const m = e.data || {};
                const p = T.pending.get(m.id);
                if (!p) return;
                T.pending.delete(m.id);
                clearTimeout(p.timer);
                p.resolve(m);
            };
            worker.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); failAll(new Error('تعطل عامل الأدوات: ' + ((e && e.message) || 'خطأ غير معروف'))); };
            T.failAll = failAll;
            this._tools = T;
        }
        const T = this._tools;
        const id = ++T.seq;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                T.pending.delete(id);
                reject(new Error(`انتهت مهلة ${type} (${Math.round(timeout / 1000)} ث)`));
            }, timeout);
            T.pending.set(id, { resolve, reject, timer });
            T.worker.postMessage(Object.assign({}, payload, { id, type }));
        });
    };
    P.terminateToolsWorker = function () { if (this._tools) this._tools.failAll(new Error('terminated')); };

    // ------------------------------------------------------------------ CHAT CODE BLOCKS
    const LANG_EXT = { javascript: 'js', js: 'js', jsx: 'jsx', typescript: 'ts', ts: 'ts', tsx: 'tsx', json: 'json', css: 'css', scss: 'scss', less: 'less', html: 'html', xml: 'html', vue: 'vue', markdown: 'md', md: 'md', yaml: 'yaml', yml: 'yaml', graphql: 'graphql' };
    P.formatCodeBlock = async function (codeEl, lang) {
        if (!codeEl) return false;
        const ext = LANG_EXT[String(lang || '').toLowerCase()];
        if (!ext) { this.showToast('التنسيق التلقائي غير متاح لهذه اللغة بعد', 'info'); return false; }
        let res;
        try { res = await this.toolsRequest('format', { code: codeEl.textContent, path: 'snippet.' + ext }, { timeout: 30000 }); } catch (e) { this.showToast('تعذر التنسيق: ' + e.message, 'error'); return false; }
        if (!res || res.error) { this.showToast('تعذر التنسيق: ' + ((res && res.error) || 'خطأ'), 'error'); return false; }
        if (res.code === codeEl.textContent) { this.showToast('الكود منسق بالفعل ✓', 'info'); return true; }
        codeEl.textContent = res.code.replace(/\n$/, '');
        if (typeof hljs !== 'undefined') {
            codeEl.removeAttribute('data-highlighted');
            codeEl.classList.remove('hljs');
            try { hljs.highlightElement(codeEl); } catch (e) { /* ignore */ }
        }
        this.showToast('تم تنسيق الكود بـ Prettier 🧹', 'success');
        return true;
    };
    const looksLikeJSTests = (code) => /\b(describe|it|test)\s*\(/.test(code) && /\bexpect\s*\(/.test(code);
    const looksLikePyTests = (code) => /^\s*(async\s+)?def\s+test_\w*\s*\(/m.test(code) || /unittest\.TestCase/.test(code);
    P.runJavaScriptCode = async function (code, terminalEl) {
        if (!terminalEl) return undefined;
        terminalEl.style.display = 'block';
        if (!(await this.ensureRunner({ quiet: true }))) {
            terminalEl.textContent = '❌ تعذر تحميل مشغل الأكواد المعزول — تحقق من الاتصال وأعد المحاولة.';
            return { success: false, error: 'runner unavailable' };
        }
        terminalEl.textContent = '';
        const test = looksLikeJSTests(code);
        const vp = test ? 'snippet.test.js' : 'snippet.js';
        return this.runCode({ lang: 'js', code, files: new Map(), virtualPath: vp, mode: test ? 'test' : 'run', tests: test ? [vp] : undefined, terminal: terminalEl, source: 'chat', fixable: false });
    };
    P.runPythonCode = async function (code, terminalEl) {
        if (!terminalEl) return undefined;
        terminalEl.style.display = 'block';
        if (!(await this.ensureRunner({ quiet: true }))) {
            terminalEl.textContent = '❌ تعذر تحميل مشغل الأكواد — تحقق من الاتصال وأعد المحاولة.';
            return { success: false, error: 'runner unavailable' };
        }
        terminalEl.textContent = '';
        const test = looksLikePyTests(code);
        const vp = test ? 'test_snippet.py' : 'snippet.py';
        return this.runCode({ lang: 'py', code, virtualPath: vp, mode: test ? 'test' : 'run', tests: test ? [vp] : undefined, terminal: terminalEl, source: 'chat', fixable: false });
    };

    // ------------------------------------------------------------------ PALETTE
    const _origPalette = P.buildPaletteCommands;
    if (_origPalette) {
        P.buildPaletteCommands = function () {
            const self = this, S = 'المحرر والتشغيل';
            const open = (fn) => () => { if (!self.isCodeStudioOpen) self.toggleCodeStudio(true); return fn(); };
            return _origPalette.call(this).concat([
                { section: S, icon: 'fa-play', label: 'تشغيل الملف الحالي', hint: 'Ctrl+Enter', run: open(() => self.runStudioCode()) },
                { section: S, icon: 'fa-diagram-project', label: 'تشغيل المشروع (نقطة الدخول)', hint: 'Run project', run: open(() => self.runProject()) },
                { section: S, icon: 'fa-vial-circle-check', label: 'تشغيل اختبارات الملف', hint: 'Test file', run: open(() => self.runTests('file')) },
                { section: S, icon: 'fa-vials', label: 'تشغيل كل الاختبارات', hint: 'Test all', run: open(() => self.runTests('all')) },
                { section: S, icon: 'fa-eye', label: 'معاينة حية (HTML/Markdown/SVG)', hint: 'Preview', run: open(() => self.togglePreview()) },
                { section: S, icon: 'fa-clock-rotate-left', label: 'سجل التشغيل', hint: 'Run history', run: () => self.openRunHistory() },
                { section: S, icon: 'fa-key', label: 'متغيرات البيئة للتشغيل', hint: '.env', run: () => self.openRunEnv() },
                { section: S, icon: 'fa-sliders', label: 'إعدادات المحرر', hint: 'Editor settings', run: () => self.openEditorSettings() },
                { section: S, icon: 'fa-keyboard', label: 'اختصارات المحرر', hint: 'Keybindings', run: () => self.openEditorSettings('keys') },
                { section: S, icon: 'fa-toolbox', label: 'أدوات المحرر (تحويل، ترتيب، بيانات وهمية...)', hint: 'Tools', run: open(() => self.openEditorToolsMenu()) },
                { section: S, icon: 'fa-wand-magic-sparkles', label: 'الذكاء الاصطناعي في المحرر', hint: 'Editor AI', run: open(() => self.openEditorAIMenu()) },
                { section: S, icon: 'fa-table-columns', label: 'تقسيم المحرر', hint: 'Split', run: open(() => self.toggleSplitEditor()) },
                { section: S, icon: 'fa-expand', label: 'وضع التركيز للمحرر', hint: 'Zen', run: open(() => self.toggleEditorZen()) },
                { section: S, icon: 'fa-cubes', label: 'تحليل الاعتماديات', hint: 'Dependencies', run: () => self.openDependencies() },
                { section: S, icon: 'fa-folder-tree', label: 'مقارنة مجلدين', hint: 'Compare folders', run: () => self.compareFoldersUI() }
            ]);
        };
    }

    // ------------------------------------------------------------------ PRELOAD
    P.preloadStudioChunks = function () {
        const c = chunkMap();
        const urls = [c.studio].concat(c.shared || []).filter(Boolean);
        urls.forEach((u) => {
            if (document.querySelector(`link[rel="modulepreload"][href="${u}"]`)) return;
            const l = document.createElement('link');
            l.rel = 'modulepreload';
            l.href = u;
            document.head.appendChild(l);
        });
        return urls.length;
    };
    P.initSprint6Studio = function () {
        if (!chunkMap().studio) return;
        if (this.isCodeStudioOpen) this.toggleCodeStudio(true); // studio restored before this module loaded → mount now
        const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 4000));
        if (!(this.isDataSaver && this.isDataSaver())) idle(() => { try { this.preloadStudioChunks(); } catch (e) { /* ignore */ } });
    };
    if (window.app) {
        try { window.app.initSprint6Studio(); } catch (e) { console.error('Sprint 6 studio init failed', e); }
    }
})();
