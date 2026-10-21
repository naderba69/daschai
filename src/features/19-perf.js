/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 12: Performance & Mobile (main-bundle core)
   Everything heavy lives in the lazy chunk src/perf/perf.js → assets/studio/perf-[hash].mjs.
   This file only collects what must start at boot: Web Vitals + daily aggregate (#830/#844), heap samples
   (#848), local usage counters (#843), update policy (#862/#869/#870), SW messages (watch / lock-screen actions
   #973, background sync #826), pinch + two-finger swipe (#943), brightness (#980), kids mode at boot (#975),
   predictive prefetch (#828), widget data (#964), palette + Alt+J.
   ============================================================================== */
(function () {
    'use strict';
    if (typeof OXAlphaApp === 'undefined') return;
    const P = OXAlphaApp.prototype;
    const ls = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
    const lss = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* quota */ } };
    const day = () => new Date().toISOString().slice(0, 10);

    const STUBS = 'openPerfHub pfLoad pfRefresh pfQueueWebhook pfKidsApply pfBootModes pfVoiceSearch pfSearch'.split(' ');
    P.ensurePerf = async function (quiet) {
        try { await this.loadChunk('perf'); return true; } catch (e) {
            console.warn('[OX] perf chunk failed', e);
            if (!quiet) this.showToast('تعذر تحميل أدوات الأداء والموبايل — تحقق من الاتصال', 'error');
            return false;
        }
    };
    /** app.pf('pfLoad', 'vitals') — call a lazy Performance/Mobile method. */
    P.pf = async function (method, ...args) {
        if (!(await this.ensurePerf())) return null;
        const fn = this[method];
        if (typeof fn !== 'function' || fn.__oxLazy) throw new Error('unknown perf method ' + method);
        return fn.apply(this, args);
    };
    STUBS.forEach((name) => {
        if (P[name]) return;
        const stub = function (...args) { return this.pf(name, ...args); };
        stub.__oxLazy = 'perf';
        P[name] = stub;
    });
    P.lazyPerfMethods = () => STUBS.slice();

    // ------------------------------------------------------------------ WEB VITALS (#830) + DAILY REPORT (#844) + HEAP SAMPLES (#848)
    const V = { lcp: 0, lcpEl: '', cls: 0, clsSrc: '', inp: 0, inpName: '', fid: null, fcp: 0, ttfb: 0, shifts: 0 };
    let win = { v: 0, a: 0, b: 0 };
    const obs = (type, cb, extra) => {
        try { if ((PerformanceObserver.supportedEntryTypes || []).includes(type)) new PerformanceObserver((l) => l.getEntries().forEach(cb)).observe({ type, buffered: true, ...extra }); } catch (e) { /* unsupported */ }
    };
    const tag = (n) => (n && n.tagName ? n.tagName.toLowerCase() + (n.id ? '#' + n.id : n.className && typeof n.className === 'string' ? '.' + n.className.split(' ')[0] : '') : '');
    if (typeof PerformanceObserver !== 'undefined') {
        obs('largest-contentful-paint', (e) => { V.lcp = Math.round(e.startTime); V.lcpEl = tag(e.element); });
        obs('layout-shift', (e) => { // CLS = worst session window (gap < 1s, window < 5s)
            if (e.hadRecentInput) return;
            V.shifts++;
            if (e.startTime - win.b > 1000 || e.startTime - win.a > 5000) win = { v: 0, a: e.startTime, b: e.startTime };
            win.v += e.value; win.b = e.startTime;
            if (win.v > V.cls) { V.cls = +win.v.toFixed(4); V.clsSrc = tag(e.sources && e.sources[0] && e.sources[0].node); }
        });
        obs('event', (e) => { if (e.interactionId && e.duration > V.inp) { V.inp = Math.round(e.duration); V.inpName = e.name + (e.target ? ' → ' + tag(e.target) : ''); } }, { durationThreshold: 40 });
        obs('first-input', (e) => { V.fid = Math.round(e.processingStart - e.startTime); });
        obs('paint', (e) => { if (e.name === 'first-contentful-paint') V.fcp = Math.round(e.startTime); });
        try { const nav = performance.getEntriesByType('navigation')[0]; if (nav) V.ttfb = Math.round(nav.responseStart); } catch (e) {}
    }
    P.pfVitals = function () { return { ...V, inp: V.inp || (V.fid || 0) }; };
    P.pfSaveDaily = function () {
        const all = ls('ox_perf_daily_v1', {}), d = day(), r = all[d] || { n: 0, lcp: [], cls: [], inp: [], fcp: [], boot: [], lt: 0, heap: [] };
        const s = this.getPerfStats ? this.getPerfStats() : {};
        const push = (arr, v) => { if (v != null && v !== 0) { arr.push(v); if (arr.length > 60) arr.shift(); } };
        r.n++; push(r.lcp, V.lcp); push(r.cls, V.cls); push(r.inp, V.inp || V.fid); push(r.fcp, V.fcp); push(r.boot, s.bootMs); push(r.heap, s.heapUsed);
        r.lt += s.longTasks || 0;
        all[d] = r;
        Object.keys(all).sort().slice(0, -45).forEach(k => delete all[k]);
        lss('ox_perf_daily_v1', all);
        return r;
    };
    const heap = [];
    P.pfHeapSamples = () => heap.slice();
    P.pfSampleHeap = function () {
        const m = performance.memory;
        heap.push({ t: Date.now(), heap: m ? m.usedJSHeapSize : null, nodes: document.getElementsByTagName('*').length, sessions: (this.sessions || []).length });
        if (heap.length > 240) heap.shift();
        return heap[heap.length - 1];
    };

    // ------------------------------------------------------------------ LOCAL USAGE ANALYTICS (#843) — never leaves the device
    const usage = ls('ox_perf_usage_v1', { counts: {}, days: {} });
    P.pfTrack = function (key) {
        if (!key || (this.settings && this.settings.usageTracking === false)) return;
        key = String(key).slice(0, 60);
        usage.counts[key] = (usage.counts[key] || 0) + 1;
        const d = day(), m = usage.days[d] || (usage.days[d] = {});
        m[key] = (m[key] || 0) + 1;
        this._pfUsageDirty = true;
    };
    P.pfUsage = () => usage;
    P.pfFlushUsage = function () {
        if (!this._pfUsageDirty) return false;
        Object.keys(usage.days).sort().slice(0, -30).forEach(k => delete usage.days[k]);
        lss('ox_perf_usage_v1', usage); this._pfUsageDirty = false; return true;
    };
    const TRACK = ['toggleCodeStudio', 'openGlobalSearch', 'openCommandPalette', 'sendUserMessage', 'startVoiceAgent', 'openScanner', 'openTasks', 'openWhiteboard', 'openTeamHub', 'openFilesMedia', 'openGitHubPro', 'openAILab', 'openPerfHub', 'createNewSession'];
    const wrapTrack = (name, keyFn) => {
        const orig = P[name];
        if (typeof orig !== 'function' || orig.__oxTrack) return;
        const w = function (...args) { try { this.pfTrack(keyFn ? keyFn(args) : name); } catch (e) { /* best effort */ } return orig.apply(this, args); };
        Object.keys(orig).forEach(k => { w[k] = orig[k]; }); // keep __oxLazy & friends
        w.__oxTrack = true;
        P[name] = w;
    };
    TRACK.forEach(n => wrapTrack(n));
    wrapTrack('openPanel', (a) => 'panel:' + ((a[0] && a[0].title) || '?'));

    // ------------------------------------------------------------------ UPDATES: silent (#862), defer (#870), channel (#869)
    P.pfUpdatePrefs = () => ({ mode: 'prompt', channel: 'stable', deferUntil: 0, ...ls('ox_perf_update_v1', {}) });
    P.pfSetUpdatePrefs = function (patch) { const u = { ...this.pfUpdatePrefs(), ...patch }; lss('ox_perf_update_v1', u); if (patch.channel) this.pfSWPost({ type: 'SET_CHANNEL', channel: u.channel }); return u; };
    P.pfSWPost = function (msg) {
        try {
            const sw = navigator.serviceWorker;
            if (!sw) return Promise.resolve(null);
            return sw.ready.then((r) => new Promise((res) => {
                const t = r.active || r.waiting; if (!t) return res(null);
                const ch = new MessageChannel(); ch.port1.onmessage = (e) => res(e.data);
                t.postMessage(msg, [ch.port2]); setTimeout(() => res(null), 4000);
            }));
        } catch (e) { return Promise.resolve(null); }
    };
    P.onUpdateReady = function () {
        const u = this.pfUpdatePrefs();
        this._updateReady = true;
        if (this._updateSkipSession) return 'skipped';
        if (u.deferUntil && Date.now() < u.deferUntil) {
            clearTimeout(this._pfDeferT);
            this._pfDeferT = setTimeout(() => this.onUpdateReady(), Math.min(u.deferUntil - Date.now() + 500, 2147e6));
            return 'deferred';
        }
        if (u.mode === 'silent') {
            const go = () => {
                if (!document.hidden || (this.activeStreams && this.activeStreams.size) || this._updateRequested) return false;
                document.removeEventListener('visibilitychange', go);
                lss('ox_perf_silent', { at: Date.now() });
                this.applyUpdate(); return true;
            };
            document.addEventListener('visibilitychange', go);
            go();
            return 'silent';
        }
        this.showActionToast('✨ يتوفر إصدار جديد من OX-Alpha', 'تحديث الآن', () => this.applyUpdate(), 'info');
        return 'prompt';
    };
    P.pfDeferUpdate = function (ms) {
        if (ms === 'session') { this._updateSkipSession = true; this.showToast('⏸ سيُثبَّت التحديث عند التشغيل القادم', 'info'); return 'session'; }
        const until = Date.now() + ms;
        this.pfSetUpdatePrefs({ deferUntil: until });
        this.showToast('⏸ تم تأجيل التحديث حتى ' + new Date(until).toLocaleString('ar', { hour: '2-digit', minute: '2-digit', weekday: 'short' }), 'info');
        if (this._updateReady) this.onUpdateReady();
        return until;
    };

    // ------------------------------------------------------------------ SW MESSAGES: watch / notification actions (#972, #973), background sync (#826)
    P.pfAction = function (action) {
        const map = {
            stop: () => this.stopCurrentSessionStream && this.stopCurrentSessionStream(),
            speak: () => this.speakLastReply && this.speakLastReply(true),
            new: () => this.createNewSession(true),
            tasks: () => this.openTasks && this.openTasks(),
            reply: () => { const i = document.getElementById('user-input'); if (i) i.focus(); },
            open: () => { try { window.focus(); } catch (e) {} }
        };
        if (!map[action]) return false;
        this.pfTrack('action:' + action);
        map[action]();
        return true;
    };
    P.pfOnSWMessage = function (d) {
        if (!d || !d.type) return null;
        if (d.type === 'OX_ACTION') return this.pfAction(d.action);
        if (d.type === 'OX_BG_SYNC' && d.sent) { this.showToast(`📤 أُرسل ${d.sent} طلب مؤجل بعد عودة الاتصال`, 'success'); return d.sent; }
        return null;
    };
    const _pw = P.postWebhook;
    if (_pw) {
        P.postWebhook = async function (hook, text) {
            if (navigator.onLine === false && !this._pfNoQueue) { const n = await this.pfQueueWebhook(hook, text).catch(() => 0); if (n) return n; }
            return _pw.apply(this, arguments);
        };
    }

    // ------------------------------------------------------------------ TOUCH: pinch = text size, two-finger swipe = previous/next chat (#943)
    P.initPerfGestures = function () {
        let g = null;
        const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
        document.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 2 || !(e.target.closest && e.target.closest('#chat-messages-container, #chat-messages'))) { g = null; return; }
            g = { d: dist(e.touches), x: (e.touches[0].clientX + e.touches[1].clientX) / 2, s: (this.getUIPrefs && this.getUIPrefs().textScale) || 1, t: Date.now() };
        }, { passive: true });
        document.addEventListener('touchmove', (e) => {
            if (!g || e.touches.length !== 2 || (this.settings && this.settings.pinchZoom === false)) return;
            const r = dist(e.touches) / g.d;
            if (Math.abs(r - 1) > 0.12 && this.setTextScale) { g.pinched = true; this.setTextScale(Math.round(g.s * r * 10) / 10); }
        }, { passive: true });
        document.addEventListener('touchend', (e) => {
            if (!g || g.pinched || e.touches.length) { if (!e.touches.length) g = null; return; }
            const t = e.changedTouches[0], dx = t.clientX - g.x;
            const was = g; g = null;
            if (Date.now() - was.t > 700 || Math.abs(dx) < 80 || (this.settings && this.settings.swipeChats === false)) return;
            this.pfSwitchChat(dx < 0 ? 1 : -1);
        }, { passive: true });
    };
    P.pfSwitchChat = function (dir) {
        const list = (this.sessions || []).filter(s => !s.archived && !s.deleted);
        const i = list.findIndex(s => s.id === this.activeSessionId), n = list[i + dir];
        if (!n) return null;
        this.switchSession(n.id);
        if (this.haptic) this.haptic(8);
        return n.id;
    };

    // ------------------------------------------------------------------ BRIGHTNESS (#980) — app-level dimmer (the web cannot set the screen backlight)
    P.pfApplyBrightness = function (v = this.settings && this.settings.appBrightness) {
        const b = Math.max(0.3, Math.min(1.3, +v || 1));
        document.documentElement.style.filter = b === 1 ? '' : `brightness(${b})`;
        return b;
    };

    // ------------------------------------------------------------------ PREDICTIVE PREFETCH (#828) — warm the chunks you use most when idle on a good network
    const CHUNK_OF = { openTeamHub: 'team', openFilesMedia: 'media', openGitHubPro: 'github', openAILab: 'ai', toggleCodeStudio: 'studio', openPerfHub: 'perf', openGlobalSearch: 'ui' };
    P.pfPredictChunks = function (max = 2) {
        return Object.entries(CHUNK_OF).map(([k, c]) => [c, usage.counts[k] || 0]).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, max).map(([c]) => c);
    };
    P.pfPrefetch = function (names = this.pfPredictChunks()) {
        const c = (window.OX_BUILD && window.OX_BUILD.chunks) || {}, done = [];
        const conn = navigator.connection || {};
        if ((this.settings && this.settings.smartPrefetch === false) || (this.isDataSaver && this.isDataSaver()) || conn.saveData || /2g/.test(conn.effectiveType || '')) return done;
        for (const n of names) {
            if (!c[n] || document.querySelector(`link[rel="modulepreload"][href="${c[n]}"]`)) continue;
            const l = document.createElement('link'); l.rel = 'modulepreload'; l.href = c[n]; document.head.appendChild(l); done.push(n);
        }
        return done;
    };

    // ------------------------------------------------------------------ WIDGET DATA (#964)
    P.pfWidgetData = function () {
        const today = day(), s = this.sessions || [];
        let msgs = 0;
        s.forEach(x => (x.messages || []).forEach(m => { if (m.timestamp && new Date(m.timestamp).toISOString().slice(0, 10) === today) msgs++; }));
        const tasks = (this.tasks || []).filter(t => t && t.status !== 'done').length;
        return { sessions: s.length, tasks, today: msgs, last: ((s[0] && s[0].title) || '—').slice(0, 60), updated: new Date().toISOString() };
    };

    // ------------------------------------------------------------------ PALETTE + SHORTCUT + BOOT
    const TABS = [['vitals', 'gauge-high', 'المؤشرات'], ['speed', 'bolt', 'السرعة'], ['data', 'database', 'البيانات'], ['search', 'magnifying-glass', 'البحث'], ['update', 'rotate', 'التحديثات'],
        ['lab', 'flask', 'مختبر الأداء'], ['app', 'mobile-screen', 'التطبيق المحمول'], ['camera', 'camera', 'الكاميرا'], ['sensors', 'compass', 'المستشعرات'], ['audio', 'headphones', 'الصوت'], ['modes', 'child-reaching', 'الأوضاع']];
    P.PERF_TABS = TABS.map(([id, icon, label]) => ({ id, icon: 'fa-' + icon, label }));
    const _pal = P.buildPaletteCommands;
    P.buildPaletteCommands = function () {
        const self = this, S = 'الأداء والموبايل';
        return _pal.apply(this, arguments).concat(TABS.map(([id, icon, label]) => ({ section: S, icon: 'fa-' + icon, label: 'أداء — ' + label, hint: id, run: () => self.openPerfHub(id) })));
    };
    P.initSprint12Perf = function () {
        const flush = () => { try { this.pfFlushUsage(); this.pfSaveDaily(); } catch (e) {} if (navigator.serviceWorker && navigator.serviceWorker.controller) try { navigator.serviceWorker.controller.postMessage({ type: 'WIDGET_DATA', data: this.pfWidgetData() }); } catch (e) {} };
        let saved = false;
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { if (!saved) { saved = true; flush(); } else this.pfFlushUsage(); } });
        window.addEventListener('pagehide', () => { if (!saved) { saved = true; flush(); } });
        this._pfHeapT = setInterval(() => { this.pfSampleHeap(); this.pfFlushUsage(); }, 60000);
        this.pfSampleHeap();
        window.addEventListener('keydown', (e) => {
            if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key || '').toLowerCase() !== 'j') return;
            e.preventDefault();
            this.openPerfHub();
        });
        if (this.BUILTIN_SHORTCUTS && !this.BUILTIN_SHORTCUTS.some(x => x[0] === 'Alt+J')) this.BUILTIN_SHORTCUTS.push(['Alt+J', 'الأداء والموبايل']);
        if (navigator.serviceWorker) {
            navigator.serviceWorker.addEventListener('message', (e) => this.pfOnSWMessage(e.data));
            const u = this.pfUpdatePrefs();
            if (u.channel !== 'stable') this.pfSWPost({ type: 'SET_CHANNEL', channel: u.channel });
        }
        this.initPerfGestures();
        if (this.settings && this.settings.appBrightness && +this.settings.appBrightness !== 1) this.pfApplyBrightness();
        if (this.settings && (this.settings.kidsMode || this.settings.watchMode || this.settings.keepAwake || (this.settings.autoBrightness && this.settings.autoBrightness !== 'off'))) setTimeout(() => { this.pf('pfBootModes').catch(() => {}); }, 50);
        const idle = window.requestIdleCallback || ((f) => setTimeout(f, 3000));
        idle(() => { try { this.pfPrefetch(); } catch (e) {} });
    };
    if (window.app) {
        try { window.app.initSprint12Perf(); } catch (e) { console.error('Sprint 12 init failed', e); }
    }
})();
