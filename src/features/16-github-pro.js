/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 9: GitHub Pro (main-bundle core)
   Everything heavy lives in the lazy chunk src/github/github.js → assets/studio/github-[hash].mjs.
   This file only:  • adds 11 tabs to the GitHub Hub  • lazy stubs + app.ghx(method, …)
                    • routes refresh to the chunk     • "Gist" button on chat code blocks (#479)
                    • release assets entry (#453)     • palette section + Alt+K (GitHub search)
   ============================================================================== */
(function () {
    'use strict';
    if (typeof OXAlphaApp === 'undefined') return;
    const P = OXAlphaApp.prototype;

    const NEW_TABS = [
        { id: 'history', icon: 'fa-clock-rotate-left', label: 'السجل' },
        { id: 'search', icon: 'fa-magnifying-glass', label: 'بحث' },
        { id: 'planning', icon: 'fa-table-columns', label: 'التخطيط' },
        { id: 'ops', icon: 'fa-gears', label: 'DevOps' },
        { id: 'analytics', icon: 'fa-chart-line', label: 'التحليلات' },
        { id: 'repo', icon: 'fa-sliders', label: 'الإعدادات' },
        { id: 'move', icon: 'fa-right-left', label: 'بين المستودعات' },
        { id: 'clone', icon: 'fa-download', label: 'استنساخ' },
        { id: 'community', icon: 'fa-people-roof', label: 'المجتمع' },
        { id: 'gists', icon: 'fa-note-sticky', label: 'Gists' },
        { id: 'org', icon: 'fa-building', label: 'المؤسسات' }
    ];
    const GHX_TABS = new Set(NEW_TABS.map(t => t.id));
    if (Array.isArray(P.GH_TABS)) NEW_TABS.forEach(t => { if (!P.GH_TABS.some(x => x.id === t.id)) P.GH_TABS.push(t); });
    P.isGhxTab = (id) => GHX_TABS.has(id);

    // ------------------------------------------------------------------ LAZY CHUNK
    const GHX_STUBS = [
        'ghxLoad', 'ghxReload', 'ghxView', 'ghxReleaseAssetsList', 'ghxCodeToGist', 'ghxProjectFilesToGist', 'ghxNewGist', 'ghxOpenGist',
        'ghxCloneByUrl', 'ghxImportExternal', 'ghxExportToNewRepo', 'ghxCompareRepos', 'ghxRunConnectionCheck', 'ghxGenerateSSHKey',
        'ghxWeeklyReport', 'ghxStatsData', 'ghxGenLicense', 'ghxCommitView', 'ghxOpenRemoteFile', 'ghxUseRepo', 'ghxLiveRun'];
    P.ensureGHX = async function (opts = {}) {
        try { await this.loadChunk('github'); return true; } catch (e) {
            console.warn('[OX] github chunk failed', e);
            if (!opts.quiet) this.showToast('تعذر تحميل أدوات GitHub المتقدمة — تحقق من الاتصال وأعد المحاولة', 'error');
            return false;
        }
    };
    /** Call a lazy GitHub Pro method: app.ghx('ghxLoad', 'history', 'graph') */
    P.ghx = async function (method, ...args) {
        if (!(await this.ensureGHX())) return null;
        const fn = this[method];
        if (typeof fn !== 'function' || fn.__oxLazy) throw new Error('unknown github method ' + method);
        return fn.apply(this, args);
    };
    GHX_STUBS.forEach((name) => {
        if (P[name]) return;
        const stub = function (...args) { return this.ghx(name, ...args); };
        stub.__oxLazy = 'github';
        P[name] = stub;
    });
    P.lazyGHXMethods = () => GHX_STUBS.slice();

    // ------------------------------------------------------------------ HUB ROUTING
    const _origRefresh = P.refreshGitHubHub;
    if (_origRefresh) {
        P.refreshGitHubHub = async function () {
            const v = this.ghView;
            const needsChunk = v ? (typeof this[v.fn] !== 'function' || this[v.fn].__oxLazy || /^ghx/.test(v.fn)) : GHX_TABS.has(this.ghTab);
            if (!needsChunk) return _origRefresh.apply(this, arguments);
            const icon = document.getElementById('gh-hub-refresh-icon');
            if (icon) icon.classList.add('fa-spin');
            try {
                if (this.ghLoading) this.ghLoading('جاري تحميل أدوات GitHub المتقدمة...');
                if (!(await this.ensureGHX())) { if (this.ghError) this.ghError(new Error('تعذر تحميل أدوات GitHub المتقدمة')); return null; }
                if (v && typeof this[v.fn] === 'function' && !this[v.fn].__oxLazy) return await this[v.fn](...(v.args || []));
                if (!v && GHX_TABS.has(this.ghTab)) return await this.ghxLoad(this.ghTab);
                return await _origRefresh.apply(this, arguments);
            } finally { if (icon) icon.classList.remove('fa-spin'); }
        };
    }

    /** Open the hub directly on a Sprint 9 tab/section. */
    P.openGitHubPro = function (tab = 'history', sec) {
        if (sec) { this._ghxSec = this._ghxSec || {}; this._ghxSec[tab] = sec; }
        return this.openGitHubHub ? this.openGitHubHub(tab) : null;
    };

    // Release assets entry (#453) on the existing releases tab
    const _origReleases = P.ghLoadReleases;
    if (_origReleases) {
        P.ghLoadReleases = async function () {
            const r = await _origReleases.apply(this, arguments);
            const body = this.ghBody && this.ghBody();
            if (body && this.ghTab === 'releases' && !this.ghView && !body.querySelector('[data-ghx-assets]') && !body.querySelector('.gh-empty.bad')) {
                const bar = document.createElement('div');
                bar.className = 'gh-toolbar';
                bar.innerHTML = '<button class="sidebar-btn-util gh-btn" data-ghx-assets onclick="app.ghxReleaseAssetsList()"><i class="fa-solid fa-paperclip"></i> ملفات الإصدارات (Assets)</button>';
                body.insertBefore(bar, body.firstChild);
            }
            return r;
        };
    }

    // "Gist" button on chat code blocks (#479)
    const _origEnhance = P.enhanceRenderedCodeBlocks;
    if (_origEnhance) {
        P.enhanceRenderedCodeBlocks = function () {
            const r = _origEnhance.apply(this, arguments);
            try {
                document.querySelectorAll('.code-block-box .code-actions-group').forEach(g => {
                    if (g.querySelector('[data-gist-btn]')) return;
                    const b = document.createElement('button');
                    b.className = 'code-tool-btn';
                    b.dataset.gistBtn = '1';
                    b.title = 'تحويل إلى Gist';
                    b.innerHTML = '<i class="fa-solid fa-note-sticky"></i> <span>Gist</span>';
                    b.onclick = () => {
                        const box = b.closest('.code-block-box');
                        const code = box && box.querySelector('pre code');
                        const lang = code && (/language-([\w+#-]+)/.exec(code.className) || [])[1];
                        this.ghxCodeToGist(code ? code.textContent : '', lang || '');
                    };
                    g.insertBefore(b, g.lastElementChild);
                });
            } catch (e) {}
            return r;
        };
    }

    // ------------------------------------------------------------------ PALETTE + SHORTCUT
    const _origPalette = P.buildPaletteCommands;
    if (_origPalette) {
        P.buildPaletteCommands = function () {
            const self = this, S = 'GitHub Pro';
            const go = (tab, sec) => () => self.openGitHubPro(tab, sec);
            return _origPalette.apply(this, arguments).concat(NEW_TABS.map(t => ({ section: S, icon: t.icon, label: 'GitHub — ' + t.label, hint: t.id, run: go(t.id) })), [
                ['user-pen', 'Blame — من كتب كل سطر', 'Blame', 'history', 'blame'],
                ['diagram-project', 'شبكة الفروع (Network Graph)', 'Graph', 'history', 'graph'],
                ['magnifying-glass', 'بحث في كود GitHub', 'Alt+K', 'search', 'code'],
                ['file-lines', 'التقرير الأسبوعي للمستودع', 'Report', 'analytics', 'report'],
                ['shield-halved', 'حماية الفروع', 'Protect', 'repo', 'protection'],
                ['link', 'استنساخ مستودع برابط إلى المشروع', 'Clone', 'move', 'clone'],
                ['file-export', 'رفع المشروع إلى مستودع GitHub جديد', 'Export', 'move', 'export'],
                ['key', 'توليد مفتاح SSH وفحصه', 'SSH', 'clone', 'ssh'],
                ['note-sticky', 'تحويل الكود المحدد إلى Gist', 'Gist']
            ].map(([icon, label, hint, tab, sec]) => ({ section: S, icon: 'fa-' + icon, label, hint, run: tab ? go(tab, sec) : () => self.ghxCodeToGist() })));
        };
    }
    P.initSprint9GitHub = function () {
        window.addEventListener('keydown', (e) => {
            const ctrl = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();
            if (!e.altKey || ctrl || e.shiftKey || k !== 'k') return;
            e.preventDefault();
            this.openGitHubPro('search', 'code');
        });
        if (this.BUILTIN_SHORTCUTS && !this.BUILTIN_SHORTCUTS.some(x => x[0] === 'Alt+K')) this.BUILTIN_SHORTCUTS.push(['Alt+K', 'بحث GitHub']);
    };
    if (window.app) {
        try { window.app.initSprint9GitHub(); } catch (e) { console.error('Sprint 9 GitHub init failed', e); }
    }
})();
