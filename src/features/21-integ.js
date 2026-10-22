/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 14: Integrations & Future hub (main-bundle core)
   Heavy code lives in src/integ/integ.js → assets/studio/integ-[hash].mjs and the
   small always-on UI widgets chunk src/integ/widgets.js (dropdowns, carousel,
   data tables, progressive images, Lottie) loaded when the browser is idle.
   This file only: lazy stubs • palette + Alt+X • boot of features that must run
   from startup (direct providers, UI language, text mode, push hooks, API…).
   ============================================================================== */
(function () {
    'use strict';
    if (typeof OXAlphaApp === 'undefined') return;
    const P = OXAlphaApp.prototype;
    const ls = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
    const STUBS = 'openIntegHub ixLoad ixRefresh ixBoot ixFetch ixVoiceCoder ixVideoMode ixTextMode ixMirror ixDualScreen ixSetLang ixCodeSpace ixAgentBuild'.split(' ');
    P.ensureInteg = async function (opts = {}) {
        try { await this.loadChunk('integ'); return true; } catch (e) {
            if (!opts.quiet) this.showToast('تعذر تحميل مركز التكاملات — تحقق من الاتصال', 'error');
            return false;
        }
    };
    P.ix = async function (method, ...args) {
        if (!(await this.ensureInteg())) return null;
        const fn = this[method];
        if (typeof fn !== 'function' || fn.__oxLazy) throw new Error('unknown integ method ' + method);
        return fn.apply(this, args);
    };
    STUBS.forEach((name) => {
        if (P[name]) return;
        const stub = function (...args) { return this.ix(name, ...args); };
        stub.__oxLazy = 'integ';
        P[name] = stub;
    });
    const TABS = [['ai', 'brain', 'الذكاء'], ['build', 'robot', 'البناء الذكي'], ['data', 'database', 'البيانات'], ['services', 'plug', 'الخدمات'], ['observe', 'chart-line', 'المراقبة'],
        ['work', 'list-check', 'سير العمل'], ['design', 'pen-ruler', 'التصميم'], ['ext', 'puzzle-piece', 'الإضافات و API'], ['ui', 'language', 'الواجهة'], ['widgets', 'table-cells', 'المكونات'],
        ['social', 'trophy', 'الصدارة'], ['space', 'vr-cardboard', 'الكود في الفضاء']];
    P.IX_TABS = TABS.map(([id, icon, label]) => ({ id, icon: 'fa-' + icon, label }));
    const _pal = P.buildPaletteCommands;
    P.buildPaletteCommands = function () {
        const self = this;
        return _pal.apply(this, arguments).concat(TABS.map(([id, icon, label]) => ({ section: 'التكاملات', icon: 'fa-' + icon, label: 'تكاملات — ' + label, hint: id, run: () => self.openIntegHub(id) })));
    };
    P.initSprint14Integ = function () {
        window.addEventListener('keydown', (e) => {
            if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key || '').toLowerCase() === 'x') { e.preventDefault(); this.openIntegHub(); }
        });
        if (this.BUILTIN_SHORTCUTS && !this.BUILTIN_SHORTCUTS.some(x => x[0] === 'Alt+X')) this.BUILTIN_SHORTCUTS.push(['Alt+X', 'مركز التكاملات']);
        if (ls('ox_ix_boot_v1', []).length) setTimeout(() => { this.ensureInteg({ quiet: true }).then(ok => ok && this.ixBoot()).catch(() => {}); }, 30);
        if (ls('ox_ix_widgets_v1', 1)) (window.requestIdleCallback || ((f) => setTimeout(f, 4000)))(() => { this.loadChunk('widgets').catch(() => {}); }, { timeout: 8000 });
    };
    if (window.app) {
        try { window.app.initSprint14Integ(); } catch (e) { console.error('Sprint 14 init failed', e); }
    }
})();
