/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 5b: Platform, Performance, Mobile & Integrations
   Ideas implemented (THOUSAND_IDEAS.md):
     #816 install prompt   #965 app shortcuts   #947 share target   #948 open files with the app
     #815 smarter service worker   #825 CDN caching   #861 update notification   #863 changelog
     #864 version info   #853 offline banner   #854 offline outbox   #851 data saver   #855 low-res images
     #856 skip auto refresh   #857 auto-detect slow network   #858 data usage meter   #859 per-host
     #860 usage warning   #852/#979 battery saver   #841 app health   #842 error log   #845 module sizes
     #846 slowness alert   #847 recommendations   #813 windowed message list   #818 auto backups
     #812 export/import everything   #817 cloud sync via Gist   #943 swipe gestures   #944 symbols bar
     #945 landscape layout   #946 haptics   #951 QR/barcode scanner   #952 document scanner
     #954 camera → image editor   #977 do-not-disturb   #984 Discord/Slack webhooks
   ============================================================================== */
(function () {
    'use strict';
    if (typeof OXAlphaApp === 'undefined') return;
    const P = OXAlphaApp.prototype;
    const BUILD = window.OX_BUILD || { version: 'dev', modules: [], builtAt: null };
    const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
    const fmtBytes = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' KB' : (b || 0) + ' B');
    P.fmtBytesShort = fmtBytes;

    // ------------------------------------------------------------------ ERROR RING BUFFER (#842) — installed first
    const errorLog = [];
    const pushError = (kind, message, stack) => {
        errorLog.push({ t: Date.now(), kind, message: String(message || '').slice(0, 500), stack: String(stack || '').slice(0, 1500) });
        if (errorLog.length > 50) errorLog.shift();
        const badge = document.getElementById('health-error-badge');
        if (badge) { badge.textContent = errorLog.length; badge.style.display = ''; }
    };
    window.addEventListener('error', (e) => { if (e.message) pushError('error', e.message, e.error && e.error.stack); });
    window.addEventListener('unhandledrejection', (e) => { const r = e.reason; pushError('promise', (r && r.message) || r, r && r.stack); });
    P.getErrorLog = () => errorLog.slice();
    P.clearErrorLog = function () { errorLog.length = 0; if (document.getElementById('health-root')) this.renderHealth(); };

    // ------------------------------------------------------------------ PERFORMANCE OBSERVERS (#841, #846)
    const perf = { longTasks: 0, longTaskMs: 0, recent: [], alerted: false };
    try {
        if (typeof PerformanceObserver !== 'undefined' && (PerformanceObserver.supportedEntryTypes || []).includes('longtask')) {
            new PerformanceObserver((list) => {
                list.getEntries().forEach(en => {
                    perf.longTasks++; perf.longTaskMs += en.duration;
                    perf.recent.push([Date.now(), en.duration]);
                });
                const cut = Date.now() - 30000;
                perf.recent = perf.recent.filter(([t]) => t > cut);
                const total = perf.recent.reduce((n, [, d]) => n + d, 0);
                if (!perf.alerted && perf.recent.length >= 6 && total > 1500 && window.app) {
                    perf.alerted = true;
                    window.app.showActionToast('🐢 التطبيق يبدو بطيئاً — راجع تقرير الصحة لمعرفة السبب', 'افتح', () => window.app.openPlatform('health'), 'warning');
                }
            }).observe({ entryTypes: ['longtask'] });
        }
    } catch (e) {}
    P.getPerfStats = function () {
        const nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || null;
        const mem = performance.memory;
        return {
            bootMs: this._bootMs || null,
            domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
            transfer: nav ? nav.transferSize : null,
            longTasks: perf.longTasks, longTaskMs: Math.round(perf.longTaskMs),
            heapUsed: mem ? mem.usedJSHeapSize : null, heapLimit: mem ? mem.jsHeapSizeLimit : null,
            domNodes: document.getElementsByTagName('*').length
        };
    };

    // ------------------------------------------------------------------ DO NOT DISTURB (#977) + HAPTICS (#946)
    if (!P.isDnd) P.isDnd = function () { return !!(this.settings.dnd || this._focusDnd); };
    P.setDnd = function (on) {
        this.settings.dnd = !!on;
        this.persistSettings();
        document.body.classList.toggle('dnd-on', !!on);
        this.showToast(on ? '🌙 عدم الإزعاج: الأصوات والاهتزاز والإشعارات مكتومة' : '🔔 تم إيقاف وضع عدم الإزعاج', 'info');
        if (document.getElementById('plat-root')) this.renderPlatform();
        return this.settings.dnd;
    };
    P.haptic = function (pattern = 12) {
        if (this.isDnd() || this.settings.haptics === false || this.isPowerSave()) return false;
        try { if (navigator.vibrate) return navigator.vibrate(pattern); } catch (e) {}
        return false;
    };
    const _origAudio = P.playCompletionAudioHaptic;
    P.playCompletionAudioHaptic = function () {
        if (this.isDnd()) return;
        return _origAudio && _origAudio.apply(this, arguments);
    };

    // ------------------------------------------------------------------ NETWORK: DATA SAVER (#851, #855-857) + METER (#858-860)
    P.isDataSaver = function () {
        const mode = this.settings.dataSaver || 'auto';
        if (mode === 'on') return true;
        if (mode === 'off') return false;
        const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        return !!(c && (c.saveData || /(^|-)(2g|3g)$/.test(c.effectiveType || '')));
    };
    const _origFetchModels = P.fetchOpenRouterModels;
    if (_origFetchModels) {
        P.fetchOpenRouterModels = function (forceRefresh = false) {
            if (!forceRefresh && this.isDataSaver() && (this.availableModels || []).length > 0) return Promise.resolve(this.availableModels);
            return _origFetchModels.apply(this, arguments);
        };
    }
    /** Downscale a data-URL image (keeps PNG transparency only if it is already small). */
    P.compressImageDataUrl = async function (dataUrl, maxDim = 1280, quality = 0.8) {
        const img = await this.loadImageElement(dataUrl);
        const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (!w || !h) return dataUrl;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.round(w * scale); c.height = Math.round(h * scale);
        const ctx = c.getContext('2d');
        if (!ctx) return dataUrl;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        // WebP when the browser can encode it (~25-35% smaller than JPEG, #823); JPEG otherwise
        const fmt = (this.settings && this.settings.imgFormat) || 'webp';
        let out = fmt === 'webp' ? c.toDataURL('image/webp', quality) : '';
        if (!/^data:image\/webp/.test(out)) out = c.toDataURL('image/jpeg', quality);
        return out && out.length < dataUrl.length ? out : dataUrl;
    };
    const _origSingle = P.processSingleFile;
    P.processSingleFile = async function (file) {
        const ext = String((file && file.name) || '').split('.').pop().toLowerCase();
        if (ext === 'zip' || ext === 'pptx') { try { await this.ensureJSZip(); } catch (e) { this.showToast('❌ ' + this.escapeHTML(e.message), 'error'); } }
        const before = this.currentAttachments.length;
        const r = await _origSingle.apply(this, arguments);
        const att = this.currentAttachments[this.currentAttachments.length - 1];
        if (this.isDataSaver() && this.currentAttachments.length > before && att && att.isImage && att.base64 && att.base64.length > 300000 && !/image\/gif/.test(att.base64.slice(0, 30))) {
            try {
                const small = await this.compressImageDataUrl(att.base64);
                if (small !== att.base64) { att.base64 = small; att.mime = 'image/jpeg'; att.size = Math.round(small.length * 0.75); att.compressed = true; }
            } catch (e) {}
        }
        return r;
    };

    const usageKey = 'ox_alpha_datausage_v1';
    const today = () => new Date().toISOString().slice(0, 10);
    P.loadDataUsage = function () { return lsGet(usageKey, {}); };
    P.recordDataUsage = function (host, bytes) {
        if (!bytes || bytes < 0) return;
        this._dataUsage = this._dataUsage || this.loadDataUsage();
        const d = today();
        const day = (this._dataUsage[d] = this._dataUsage[d] || {});
        day[host] = (day[host] || 0) + bytes;
        clearTimeout(this._dataUsageTimer);
        this._dataUsageTimer = setTimeout(() => {
            const keys = Object.keys(this._dataUsage).sort();
            while (keys.length > 62) delete this._dataUsage[keys.shift()];
            lsSet(usageKey, this._dataUsage);
            this.checkDataWarning();
        }, 1500);
    };
    P.dataUsageSummary = function (days = 30) {
        const all = this._dataUsage || this.loadDataUsage();
        const since = new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10);
        const byHost = {}, byDay = {};
        let total = 0;
        Object.entries(all).forEach(([d, hosts]) => {
            if (d < since) return;
            Object.entries(hosts).forEach(([h, b]) => { byHost[h] = (byHost[h] || 0) + b; byDay[d] = (byDay[d] || 0) + b; total += b; });
        });
        return { total, today: Object.values(all[today()] || {}).reduce((a, b) => a + b, 0), byHost: Object.entries(byHost).sort((a, b) => b[1] - a[1]), byDay };
    };
    P.checkDataWarning = function () {
        const limit = (parseFloat(this.settings.dataWarnMB) || 0) * 1048576;
        if (!limit) return false;
        const s = this.dataUsageSummary(1);
        if (s.today < limit || localStorage.getItem('ox_alpha_datawarn_day') === today()) return false;
        try { localStorage.setItem('ox_alpha_datawarn_day', today()); } catch (e) {}
        this.showActionToast(`📶 تجاوزت حد البيانات اليومي (${fmtBytes(s.today)}) — فعّل توفير البيانات؟`, 'تفعيل', () => { this.settings.dataSaver = 'on'; this.persistSettings(); }, 'warning');
        return true;
    };
    /** Count bytes per host by wrapping fetch (request body + response body, read from a clone). */
    P.installFetchMeter = function () {
        if (window.__oxFetchMeter || typeof window.fetch !== 'function') return;
        const orig = window.fetch;
        const self = this;
        const wrapped = function (input, init) {
            let host = location.host;
            try { host = new URL(typeof input === 'string' ? input : input.url, location.href).host; } catch (e) {}
            const reqBytes = init && typeof init.body === 'string' ? init.body.length : 0;
            const p = orig.apply(window, arguments);
            Promise.resolve(p).then((res) => {
                if (!res || res.type === 'opaque') { self.recordDataUsage(host, reqBytes); return; }
                const len = parseInt(res.headers && res.headers.get && res.headers.get('content-length'), 10);
                if (len > 0) { self.recordDataUsage(host, len + reqBytes); return; }
                if (!res.clone) return;
                let reader;
                try { reader = res.clone().body.getReader(); } catch (e) { self.recordDataUsage(host, reqBytes); return; }
                let n = reqBytes;
                const pump = () => reader.read().then(({ value, done }) => { if (done) { self.recordDataUsage(host, n); return; } n += value ? value.length : 0; return pump(); }).catch(() => self.recordDataUsage(host, n));
                pump();
            }, () => {});
            return p;
        };
        window.fetch = wrapped;
        window.__oxFetchMeter = true;
    };

    // ------------------------------------------------------------------ OFFLINE (#853, #854)
    P.updateOnlineState = function () {
        const online = navigator.onLine !== false;
        let el = document.getElementById('offline-banner');
        if (!online && !el) {
            el = document.createElement('div');
            el.id = 'offline-banner';
            el.className = 'offline-banner';
            el.setAttribute('role', 'status');
            document.body.appendChild(el);
        }
        if (el) {
            const q = (this.outbox || []).length;
            el.innerHTML = online ? '' : `<i class="fa-solid fa-plug-circle-xmark"></i> غير متصل — يمكنك متابعة القراءة والتحرير${q ? ` • ${q} رسالة في الانتظار وستُرسل عند عودة الاتصال` : '، وستُرسل رسائلك تلقائياً عند عودة الاتصال'}`;
            el.classList.toggle('active', !online);
        }
        document.body.classList.toggle('is-offline', !online);
        return online;
    };
    const _origSend = P.sendUserMessage;
    P.sendUserMessage = async function (forcedText = null, options = {}) {
        if (navigator.onLine === false && !options.fromOutbox) {
            const input = document.getElementById('user-input');
            const text = forcedText !== null ? forcedText : (input ? input.value.trim() : '');
            if (!text && !this.currentAttachments.length) return;
            this.outbox = this.outbox || [];
            this.outbox.push({ text, attachments: this.currentAttachments.slice(), sessionId: this.activeSessionId, t: Date.now() });
            lsSet('ox_alpha_outbox_v1', this.outbox.map(o => ({ ...o, attachments: o.attachments.filter(a => !a.blobId) })));
            if (input && forcedText === null) { input.value = ''; input.dispatchEvent(new Event('input')); }
            this.currentAttachments = [];
            this.renderAttachmentTray();
            this.updateOnlineState();
            this.showToast('📮 أنت غير متصل — حُفظت الرسالة وستُرسل تلقائياً عند عودة الاتصال', 'warning');
            return 'queued';
        }
        return _origSend.call(this, forcedText, options);
    };
    P.flushOutbox = async function () {
        if (this._flushing || !(this.outbox || []).length || navigator.onLine === false) return 0;
        this._flushing = true;
        let sent = 0;
        try {
            while (this.outbox.length && navigator.onLine !== false) {
                const item = this.outbox.shift();
                lsSet('ox_alpha_outbox_v1', this.outbox);
                if (item.sessionId && this.sessions.some(s => s.id === item.sessionId)) { this.activeSessionId = item.sessionId; this.renderUIState(); }
                this.currentAttachments = item.attachments || [];
                await this.sendUserMessage(item.text, { fromOutbox: true });
                sent++;
            }
        } finally { this._flushing = false; this.updateOnlineState(); }
        if (sent) this.showToast(`📤 أُرسلت ${sent} رسالة كانت في الانتظار`, 'success');
        return sent;
    };

    // ------------------------------------------------------------------ BATTERY SAVER (#852, #979)
    P.isPowerSave = function () {
        const mode = this.settings.powerSave || 'auto';
        return mode === 'on' || (mode === 'auto' && !!this._batteryLow);
    };
    P.applyPowerSave = function () {
        document.body.classList.toggle('power-save', this.isPowerSave());
        return this.isPowerSave();
    };
    P.watchBattery = async function () {
        try {
            if (!navigator.getBattery) return;
            const b = await navigator.getBattery();
            const upd = () => { this._battery = { level: b.level, charging: b.charging }; this._batteryLow = !b.charging && b.level <= 0.2; this.applyPowerSave(); };
            upd();
            b.addEventListener('levelchange', upd);
            b.addEventListener('chargingchange', upd);
        } catch (e) {}
    };

    // ------------------------------------------------------------------ LAZY LIBRARIES (#822, #827, #829)
    const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
    P.ensureJSZip = function () {
        if (typeof JSZip !== 'undefined') return Promise.resolve(window.JSZip);
        return this.loadScriptOnce(JSZIP_URL, 'JSZip');
    };
    ['downloadProjectAsZip', 'downloadPathsAsZip', 'extractPptx'].forEach(fn => {
        const orig = P[fn];
        if (!orig) return;
        P[fn] = async function () {
            try { await this.ensureJSZip(); } catch (e) { if (fn === 'extractPptx') throw e; this.showToast('❌ ' + this.escapeHTML(e.message), 'error'); return null; }
            return orig.apply(this, arguments);
        };
    });
    P.ensureMermaid = function () {
        if (typeof mermaid !== 'undefined') return Promise.resolve(window.mermaid);
        if (!this._mermaidLoading) {
            this._mermaidLoading = this.loadScriptOnce(MERMAID_URL, 'mermaid').then((m) => {
                m.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict', htmlLabels: false });
                return m;
            });
        }
        return this._mermaidLoading;
    };
    const _origEnhance = P.enhanceRenderedCodeBlocks;
    P.enhanceRenderedCodeBlocks = function () {
        const r = _origEnhance.apply(this, arguments);
        if (typeof mermaid === 'undefined' && document.querySelector('#chat-messages-container pre code.language-mermaid')) {
            this.ensureMermaid().then(() => this.renderMessages()).catch(() => {});
        }
        return r;
    };
    P.prefetchLazyLibs = function () {
        const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 4000));
        idle(() => { if (!this.isDataSaver() && navigator.onLine !== false) this.ensureJSZip().catch(() => {}); }, { timeout: 15000 });
    };

    // ------------------------------------------------------------------ WINDOWED MESSAGE LIST (#813)
    const WINDOW = 50;
    const _origRender = P.renderMessages;
    P.renderMessages = function () {
        const session = this.sessions.find(s => s.id === this.activeSessionId);
        const full = session && session.messages;
        if (!full || full.length <= WINDOW) return _origRender.apply(this, arguments);
        if (this._msgWindowSession !== session.id) { this._msgWindowSession = session.id; this._msgWindow = WINDOW; }
        const limit = Math.max(WINDOW, this._msgWindow || WINDOW);
        if (full.length <= limit) return _origRender.apply(this, arguments);
        session.messages = full.slice(-limit);
        let r;
        try { r = _origRender.apply(this, arguments); } finally { session.messages = full; }
        const container = document.getElementById('chat-messages-container');
        if (container) {
            const more = document.createElement('div');
            more.className = 'load-older-wrap';
            more.innerHTML = `<button class="load-older-btn" onclick="app.loadOlderMessages()"><i class="fa-solid fa-angles-up"></i> عرض ${Math.min(WINDOW, full.length - limit)} رسالة أقدم <span class="text-dim">(${full.length - limit} مخفية لتسريع العرض)</span></button>`;
            container.insertBefore(more, container.firstChild);
        }
        return r;
    };
    P.loadOlderMessages = function () {
        const container = document.getElementById('chat-messages-container');
        const scroller = container && (container.closest('.chat-scroll-area') || container.parentElement);
        const prevH = scroller ? scroller.scrollHeight : 0;
        this._msgWindow = (this._msgWindow || WINDOW) + WINDOW;
        this.renderMessages();
        if (scroller) scroller.scrollTop += scroller.scrollHeight - prevH;
    };

    // ------------------------------------------------------------------ INSTALL + LAUNCH (#816, #965, #947, #948)
    P.promptInstall = async function () {
        const ev = this._installEvent;
        if (!ev) {
            const ios = /iphone|ipad|ipod/i.test(navigator.userAgent || '');
            this.showToast(this.isStandalone() ? 'التطبيق مثبت بالفعل ✅' : ios ? 'على iPhone: زر المشاركة ⬆️ ثم «إضافة إلى الشاشة الرئيسية»' : 'التثبيت غير متاح الآن — من قائمة المتصفح اختر «تثبيت التطبيق»', 'info');
            return false;
        }
        ev.prompt();
        const choice = await ev.userChoice.catch(() => ({ outcome: 'dismissed' }));
        this._installEvent = null;
        if (document.getElementById('plat-root')) this.renderPlatform();
        return choice.outcome === 'accepted';
    };
    P.isStandalone = function () {
        try { return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; } catch (e) { return false; }
    };
    /** Handle ?action= (manifest shortcuts) and ?title/text/url (Web Share Target). */
    P.handleLaunchParams = function (search = location.search) {
        const q = new URLSearchParams(search || '');
        const action = q.get('action');
        const shared = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean);
        if (!action && !shared.length) return null;
        try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
        if (shared.length) {
            const input = document.getElementById('user-input');
            const text = Array.from(new Set(shared)).join('\n');
            if (input) { input.value = text; input.dispatchEvent(new Event('input')); input.focus(); }
            this.showToast('📥 تم استلام المحتوى المشارك — أضف تعليماتك ثم أرسل', 'info');
            return { kind: 'share', text };
        }
        const map = {
            new: () => this.createNewSession(true),
            tasks: () => this.openTasks && this.openTasks(),
            whiteboard: () => this.openWhiteboard && this.openWhiteboard(),
            studio: () => this.toggleCodeStudio(true),
            scan: () => this.openScanner(),
            voice: () => this.toggleRecording && this.toggleRecording(),
            // Assistant / Siri / widget deep links (#966): ?action=search&q=… • ?action=ask&q=… (prefill only, never auto-send)
            search: () => this.openGlobalSearch && this.openGlobalSearch(q.get('q') || ''),
            ask: () => { const i = document.getElementById('user-input'); if (i) { i.value = q.get('q') || ''; i.dispatchEvent(new Event('input')); i.focus(); } },
            agent: () => this.startVoiceAgent && this.startVoiceAgent(),
            drive: () => this.openPerfHub && this.openPerfHub('modes', 'driving'),
            perf: () => this.openPerfHub && this.openPerfHub(q.get('tab') || undefined),
            dev: () => this.openDevLab(q.get('tab') || undefined),
            integ: () => this.openIntegHub(q.get('tab') || undefined),
            // VS Code / CLI / Chrome extension (#988-#990): ?action=open&repo=owner/repo
            open: () => { const r = q.get('repo') || ''; if (/^[\w.-]+\/[\w.-]+$/.test(r) && this.ghxCloneByUrl) this.ghxCloneByUrl('https://github.com/' + r, { active: true }); }
        };
        if (map[action]) setTimeout(() => map[action](), 300);
        return { kind: 'action', action };
    };
    P.initLaunchQueue = function () {
        if (!('launchQueue' in window) || !window.launchQueue.setConsumer) return false;
        window.launchQueue.setConsumer(async (params) => {
            if (!params || !params.files || !params.files.length) return;
            const files = await Promise.all(params.files.map(h => h.getFile()));
            await this.processUniversalFiles(files);
        });
        return true;
    };

    // ------------------------------------------------------------------ SERVICE WORKER + UPDATES (#815, #861, #863, #864)
    P.registerServiceWorker = function () {
        if (!('serviceWorker' in navigator) || location.protocol === 'file:') return null;
        const promptUpdate = (worker) => { this._waitingWorker = worker; this.onUpdateReady(worker); };
        navigator.serviceWorker.register('/sw.js').then((reg) => {
            if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
            reg.addEventListener('updatefound', () => {
                const w = reg.installing;
                if (!w) return;
                w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(w); });
            });
            setInterval(() => reg.update().catch(() => {}), 60 * 60000);
        }).catch(() => {});
        let reloading = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => { if (this._updateRequested && !reloading) { reloading = true; location.reload(); } });
        return true;
    };
    /** Policy hook (Sprint 12 overrides it: silent / deferred updates). */
    P.onUpdateReady = function () { this.showActionToast('✨ يتوفر إصدار جديد من OX-Alpha', 'تحديث الآن', () => this.applyUpdate(), 'info'); };
    P.applyUpdate = function () {
        this._updateRequested = true;
        if (this._waitingWorker) this._waitingWorker.postMessage({ type: 'SKIP_WAITING' });
        else location.reload();
    };
    /** Extract the newest version section from CHANGELOG.md. */
    P.extractChangelogSection = function (md, version) {
        const lines = String(md || '').split('\n');
        let start = lines.findIndex(l => /^##\s/.test(l) && (!version || l.includes(version)));
        if (start === -1) start = lines.findIndex(l => /^##\s/.test(l));
        if (start === -1) return '';
        let end = lines.slice(start + 1).findIndex(l => /^##\s/.test(l));
        end = end === -1 ? lines.length : start + 1 + end;
        return lines.slice(start, end).join('\n').trim();
    };
    P.showChangelog = async function (version = BUILD.version) {
        try {
            const res = await fetch('/CHANGELOG.md', { cache: 'no-cache' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const section = this.extractChangelogSection(await res.text(), version);
            this.openPanel({ title: `ما الجديد في الإصدار ${version}`, icon: 'fa-gift', body: `<div class="gh-md">${this.renderMarkdownSafe(section || 'لا توجد ملاحظات.')}</div>`, footer: `<span class="text-dim">${BUILD.builtAt ? 'بُني في ' + new Date(BUILD.builtAt).toLocaleString('ar') : ''}</span>` });
            return section;
        } catch (e) { this.showToast('تعذر تحميل سجل التغييرات', 'warning'); return null; }
    };
    P.checkVersionChange = function () {
        const prev = localStorage.getItem('ox_alpha_version');
        try { localStorage.setItem('ox_alpha_version', BUILD.version); } catch (e) {}
        if (prev && prev !== BUILD.version && BUILD.version !== 'dev') {
            this.showActionToast(`🎉 تم التحديث إلى الإصدار ${BUILD.version}`, 'ما الجديد؟', () => this.showChangelog(), 'success');
            return { from: prev, to: BUILD.version };
        }
        return null;
    };

    // ------------------------------------------------------------------ BACKUPS (#818, #812) + GIST SYNC (#817)
    const SECRET_KEYS = ['apiKey', 'githubToken', 'tavilyKey', 'tavilyApiKey', 'webhooks', 'syncGistId'];
    const IDB_KEYS = ['sessions', 'project_files_v1', 'tasks_v1', 'code_comments_v1', 'activity_log_v1', 'whiteboard_v1'];
    const LS_SKIP = /^ox_alpha_(sessions_v2|sessions_saved_at|live_models_all|outbox_v1|datausage_v1|backup_meta)/;
    P.stripSecrets = function (settings) {
        const out = { ...(settings || {}) };
        Object.keys(out).forEach(k => { if (SECRET_KEYS.includes(k) || /key|token|secret|password/i.test(k)) delete out[k]; });
        return out;
    };
    P.collectBackupData = async function () {
        const ls = {};
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k || !k.startsWith('ox_alpha') || LS_SKIP.test(k)) continue;
            if (k === 'ox_alpha_settings_v2') { ls[k] = JSON.stringify(this.stripSecrets(this.settings)); continue; }
            ls[k] = localStorage.getItem(k);
        }
        const idb = {};
        if (this.flushSessionsToIDB) await this.flushSessionsToIDB().catch(() => {});
        if (this.saveProjectNow) await this.saveProjectNow().catch(() => {});
        for (const k of IDB_KEYS) { try { const v = this.idbGet ? await this.idbGet(k) : null; if (v != null) idb[k] = v; } catch (e) {} }
        if (!idb.sessions) idb.sessions = { savedAt: Date.now(), activeSessionId: this.activeSessionId, sessions: this.sessions };
        return { app: 'ox-alpha', v: 1, version: BUILD.version, createdAt: Date.now(), ls, idb };
    };
    P.gzipString = async function (str) {
        const bytes = new TextEncoder().encode(str);
        const z = this.compressBytes ? await this.compressBytes(bytes, 'gzip') : null;
        return z || bytes;
    };
    P.gunzipToString = async function (bytes) {
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const isGzip = u8[0] === 0x1f && u8[1] === 0x8b;
        return new TextDecoder().decode(isGzip ? await this.decompressBytes(u8, 'gzip') : u8);
    };
    P.backupFingerprint = function () {
        let n = 0;
        (this.sessions || []).forEach(s => { n += (s.updatedAt || 0) % 1e7 + (s.messages || []).length; });
        return [n, (this.sessions || []).length, this.virtualProjectFiles.size, Array.from(this.virtualProjectFiles.values()).reduce((a, f) => a + ((f && f.timestamp) || 0) % 1e6, 0), (this.tasks || []).length, (this.codeComments || []).length, ((this._wb && this._wb.items) || []).length].join(':');
    };
    P.listBackups = async function () { try { return (this.idbGet && (await this.idbGet('backups_v1'))) || []; } catch (e) { return []; } };
    P.createBackup = async function ({ reason = 'auto' } = {}) {
        const data = await this.collectBackupData();
        const z = await this.gzipString(JSON.stringify(data));
        const list = await this.listBackups();
        const entry = { id: 'b_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t: Date.now(), reason, size: z.length, sessions: ((data.idb.sessions || {}).sessions || []).length, files: ((data.idb.project_files_v1 || {}).files || []).length, data: z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) };
        list.unshift(entry);
        while (list.length > 5) list.pop();
        await this.idbSet('backups_v1', list);
        this._lastBackupFp = this.backupFingerprint();
        lsSet('ox_alpha_backup_meta', { t: entry.t, fp: this._lastBackupFp });
        return entry;
    };
    P.autoBackupTick = async function () {
        if (this._backingUp) return null;
        const fp = this.backupFingerprint();
        if (fp === this._lastBackupFp) return null;
        this._backingUp = true;
        try { return await this.createBackup({ reason: 'auto' }); } catch (e) { return null; } finally { this._backingUp = false; }
    };
    P.applyBackupData = async function (data) {
        if (!data || data.app !== 'ox-alpha' || !data.ls || !data.idb) throw new Error('ملف نسخة احتياطية غير صالح');
        const secrets = {};
        SECRET_KEYS.forEach(k => { if (this.settings[k] !== undefined) secrets[k] = this.settings[k]; });
        Object.entries(data.ls).forEach(([k, v]) => {
            if (!k.startsWith('ox_alpha')) return;
            if (k === 'ox_alpha_settings_v2') { try { v = JSON.stringify({ ...JSON.parse(v), ...secrets }); } catch (e) { return; } }
            try { localStorage.setItem(k, v); } catch (e) {}
        });
        for (const [k, v] of Object.entries(data.idb)) { if (IDB_KEYS.includes(k)) await this.idbSet(k, v); }
        if (data.idb.sessions && Array.isArray(data.idb.sessions.sessions)) {
            try { localStorage.setItem('ox_alpha_sessions_saved_at', String(Date.now() + 5000)); } catch (e) {}
            await this.idbSet('sessions', { ...data.idb.sessions, savedAt: Date.now() + 5000 });
        }
        return true;
    };
    P.restoreBackup = async function (id) {
        const b = (await this.listBackups()).find(x => x.id === id);
        if (!b) return false;
        if (!(await this.askConfirm('استعادة نسخة احتياطية', `سيتم استبدال المحادثات والمشروع والمهام بنسخة <b>${new Date(b.t).toLocaleString('ar')}</b>. ستُنشأ نسخة من الحالة الحالية أولاً. متابعة؟`, { danger: true, okLabel: 'استعادة' }))) return false;
        await this.createBackup({ reason: 'before-restore' });
        await this.applyBackupData(JSON.parse(await this.gunzipToString(b.data)));
        this.showToast('✅ تمت الاستعادة — جاري إعادة التحميل...', 'success');
        setTimeout(() => location.reload(), 600);
        return true;
    };
    P.exportAllData = async function () {
        const data = await this.collectBackupData();
        const z = await this.gzipString(JSON.stringify(data));
        const gz = z[0] === 0x1f && z[1] === 0x8b;
        this.downloadBlob(new Blob([z], { type: gz ? 'application/gzip' : 'application/json' }), `ox-alpha-backup-${today()}.json${gz ? '.gz' : ''}`);
        return z.length;
    };
    P.importAllData = async function (file) {
        try {
            const buf = new Uint8Array(await (file.arrayBuffer ? file.arrayBuffer() : new Response(file).arrayBuffer()));
            const data = JSON.parse(await this.gunzipToString(buf));
            if (!(await this.askConfirm('استيراد كل البيانات', `نسخة من ${new Date(data.createdAt).toLocaleString('ar')} (الإصدار ${this.escapeHTML(data.version || '?')}). ستستبدل البيانات الحالية (المفاتيح السرية تبقى كما هي). متابعة؟`, { danger: true, okLabel: 'استيراد' }))) return false;
            await this.createBackup({ reason: 'before-import' }).catch(() => {});
            await this.applyBackupData(data);
            this.showToast('✅ تم الاستيراد — جاري إعادة التحميل...', 'success');
            setTimeout(() => location.reload(), 600);
            return true;
        } catch (e) { this.showToast('❌ ' + this.escapeHTML(e.message || 'ملف غير صالح'), 'error'); return false; }
    };

    const CHUNK = 700 * 1024;
    P.syncPush = async function () {
        if (!this.settings.githubToken?.trim()) throw new Error('يلزم رمز GitHub بصلاحية gist');
        const data = await this.collectBackupData();
        const z = await this.gzipString(JSON.stringify(data));
        const b64 = this.b64urlEncode(z);
        const parts = [];
        for (let i = 0; i < b64.length; i += CHUNK) parts.push(b64.slice(i, i + CHUNK));
        const files = { 'ox-alpha-sync.json': { content: JSON.stringify({ app: 'ox-alpha-sync', v: 1, version: BUILD.version, at: Date.now(), parts: parts.length, bytes: z.length, device: (navigator.userAgent || '').slice(0, 80) }) } };
        parts.forEach((p, i) => { files[`part-${String(i).padStart(3, '0')}.b64`] = { content: p }; });
        let id = this.settings.syncGistId;
        if (id) {
            try {
                const cur = await this.gh('/gists/' + id);
                Object.keys(cur.files || {}).forEach(n => { if (/^part-\d+\.b64$/.test(n) && !files[n]) files[n] = null; });
                await this.gh('/gists/' + id, { method: 'PATCH', body: { files } });
            } catch (e) { if (e.status === 404) id = null; else throw e; }
        }
        if (!id) {
            const g = await this.gh('/gists', { method: 'POST', body: { description: 'OX-Alpha Sync (private backup — do not edit)', public: false, files } });
            id = g.id;
            this.settings.syncGistId = id;
            this.persistSettings();
        }
        lsSet('ox_alpha_sync_meta', { at: Date.now(), dir: 'push', bytes: z.length });
        return { id, bytes: z.length, parts: parts.length };
    };
    P.syncPull = async function (id = this.settings.syncGistId) {
        if (!id) throw new Error('لا يوجد Gist مزامنة — أدخل معرّفه من جهازك الآخر');
        const g = await this.gh('/gists/' + id);
        const meta = JSON.parse((g.files['ox-alpha-sync.json'] || {}).content || 'null');
        if (!meta || meta.app !== 'ox-alpha-sync') throw new Error('هذا الـ Gist ليس نسخة مزامنة OX-Alpha');
        let b64 = '';
        for (let i = 0; i < meta.parts; i++) {
            const f = g.files[`part-${String(i).padStart(3, '0')}.b64`];
            if (!f) throw new Error('النسخة ناقصة');
            b64 += f.truncated ? await (await fetch(f.raw_url)).text() : f.content;
        }
        const data = JSON.parse(await this.gunzipToString(this.b64urlDecode(b64)));
        return { meta, data };
    };
    P.syncPullUI = async function () {
        let id = this.settings.syncGistId;
        if (!id) { id = await this.askText('معرّف Gist المزامنة (من الجهاز الآخر)', '', { placeholder: 'abc123…' }); if (!id) return false; }
        try {
            const { meta, data } = await this.syncPull(id.trim());
            if (!(await this.askConfirm('استرجاع من السحابة', `نسخة من ${new Date(meta.at).toLocaleString('ar')} (${fmtBytes(meta.bytes)}). ستستبدل البيانات المحلية. متابعة؟`, { danger: true, okLabel: 'استرجاع' }))) return false;
            this.settings.syncGistId = id.trim();
            this.persistSettings();
            await this.createBackup({ reason: 'before-sync' }).catch(() => {});
            await this.applyBackupData(data);
            lsSet('ox_alpha_sync_meta', { at: Date.now(), dir: 'pull', bytes: meta.bytes });
            this.showToast('☁️ تم الاسترجاع — جاري إعادة التحميل...', 'success');
            setTimeout(() => location.reload(), 600);
            return true;
        } catch (e) { this.showToast('❌ ' + this.escapeHTML(e.message), 'error'); return false; }
    };
    P.syncPushUI = async function () {
        try {
            this.showToast('☁️ جاري الرفع...', 'info');
            const r = await this.syncPush();
            this.showToast(`☁️ تمت المزامنة (${fmtBytes(r.bytes)}) — المعرف: ${r.id.slice(0, 8)}…`, 'success');
            if (document.getElementById('plat-root')) this.renderPlatform();
            return r;
        } catch (e) { this.showToast('❌ ' + this.escapeHTML(e.message), 'error'); return null; }
    };

    // ------------------------------------------------------------------ WEBHOOKS (#984)
    const HOOK_PATTERNS = { discord: /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/, slack: /^https:\/\/hooks\.slack\.com\/services\/[\w/]+$/ };
    P.detectWebhookType = function (url) { return Object.keys(HOOK_PATTERNS).find(k => HOOK_PATTERNS[k].test(String(url || '').trim())) || null; };
    P.addWebhook = function (name, url) {
        const type = this.detectWebhookType(url);
        if (!type) throw new Error('رابط Webhook غير مدعوم — Discord أو Slack فقط');
        const hook = { id: 'wh_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name: name || type, type, url: url.trim() };
        this.settings.webhooks = (this.settings.webhooks || []).concat(hook);
        this.persistSettings();
        return hook;
    };
    P.removeWebhook = function (id) {
        this.settings.webhooks = (this.settings.webhooks || []).filter(h => h.id !== id);
        this.persistSettings();
        if (document.getElementById('plat-root')) this.renderPlatform();
    };
    P.postWebhook = async function (hook, text) {
        const msg = String(text || '').trim();
        if (!msg) throw new Error('لا يوجد نص');
        if (hook.type === 'discord') {
            const chunks = [];
            for (let i = 0; i < msg.length && chunks.length < 5; i += 1900) chunks.push(msg.slice(i, i + 1900));
            for (const c of chunks) {
                const res = await fetch(hook.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: c, username: 'OX-Alpha' }) });
                if (!res.ok && res.status !== 204) throw new Error('Discord HTTP ' + res.status);
            }
            return chunks.length;
        }
        // Slack incoming webhooks don't send CORS headers → fire-and-forget form post (response is opaque)
        await fetch(hook.url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'payload=' + encodeURIComponent(JSON.stringify({ text: msg.slice(0, 39000) })) });
        return 1;
    };
    P.sendToWebhook = async function (text, hookId) {
        const hooks = this.settings.webhooks || [];
        if (!hooks.length) { this.showActionToast('لا توجد Webhooks — أضف Discord أو Slack أولاً', 'إعداد', () => this.openPlatform('integrations'), 'warning'); return false; }
        let hook = hooks.find(h => h.id === hookId);
        if (!hook && hooks.length === 1) hook = hooks[0];
        if (!hook) {
            return new Promise(resolve => this.showMenu(hooks.map(h => ({ icon: h.type === 'slack' ? 'fa-hashtag' : 'fa-paper-plane', label: h.name, run: () => resolve(this.sendToWebhook(text, h.id)) })), { x: (window.innerWidth || 800) / 2 - 100, y: 120 }));
        }
        try {
            await this.postWebhook(hook, text);
            this.showToast(`📨 أُرسل إلى ${this.escapeHTML(hook.name)}${hook.type === 'slack' ? ' (Slack لا يؤكد الاستلام للمتصفح)' : ''}`, 'success');
            return true;
        } catch (e) { this.showToast('❌ ' + this.escapeHTML(e.message), 'error'); return false; }
    };
    P.lastAssistantText = function () {
        const s = this.sessions.find(x => x.id === this.activeSessionId);
        const m = s && s.messages.slice().reverse().find(x => x.role === 'assistant' && x.content);
        return m ? m.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim() : '';
    };

    // ------------------------------------------------------------------ MOBILE (#943-#946)
    P.initGestures = function () {
        let sx = null, sy = null, st = 0, fromEdge = false;
        document.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) { sx = null; return; }
            const t = e.touches[0];
            sx = t.clientX; sy = t.clientY; st = Date.now();
            const w = window.innerWidth || 0;
            const rtl = (document.documentElement.dir || 'rtl') === 'rtl';
            fromEdge = rtl ? sx > w - 28 : sx < 28;
        }, { passive: true });
        document.addEventListener('touchend', (e) => {
            if (sx === null || window.innerWidth > 900) return;
            const t = e.changedTouches[0];
            const dx = t.clientX - sx, dy = t.clientY - sy;
            sx = null;
            if (Date.now() - st > 600 || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
            if (e.target.closest && e.target.closest('pre, textarea, .wb-stage, .kanban, .ox-present, input, [contenteditable]')) return;
            const rtl = (document.documentElement.dir || 'rtl') === 'rtl';
            const sidebar = document.getElementById('sidebar');
            const open = sidebar && sidebar.classList.contains('active');
            const towardOpen = rtl ? dx < 0 : dx > 0;
            if (!open && fromEdge && towardOpen) { this.toggleSidebar(true); this.haptic(8); }
            else if (open && !towardOpen) { this.toggleSidebar(false); this.haptic(8); }
        }, { passive: true });
    };
    const SYMBOLS = ['{', '}', '(', ')', '[', ']', '<', '>', ';', ':', '=', '"', "'", '`', '/', '\\', '|', '&', '!', '_', '-', '+', '*', '$', '#', '@', 'Tab'];
    P.initSymbolsBar = function () {
        const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        if (!coarse || this.settings.symbolsBar === false || document.getElementById('symbols-bar')) return false;
        const bar = document.createElement('div');
        bar.id = 'symbols-bar';
        bar.className = 'symbols-bar';
        bar.setAttribute('dir', 'ltr');
        bar.innerHTML = SYMBOLS.map(s => `<button type="button" data-sym="${s === '"' ? '&quot;' : s}">${s === 'Tab' ? '⇥' : this.escapeHTML(s)}</button>`).join('');
        document.body.appendChild(bar);
        bar.addEventListener('mousedown', (e) => e.preventDefault());
        bar.addEventListener('touchstart', (e) => { if (e.target.closest('[data-sym]')) e.preventDefault(); }, { passive: false });
        bar.addEventListener('touchend', (e) => { const b = e.target.closest('[data-sym]'); if (b) { e.preventDefault(); this.insertSymbol(b.dataset.sym); } });
        bar.addEventListener('click', (e) => { const b = e.target.closest('[data-sym]'); if (b) this.insertSymbol(b.dataset.sym); });
        const isTarget = (el) => el && (el.id === 'user-input' || el.id === 'studio-editor-textarea' || el.classList?.contains('sym-target'));
        document.addEventListener('focusin', (e) => { if (isTarget(e.target)) { this._symTarget = e.target; bar.classList.add('active'); } });
        document.addEventListener('focusout', (e) => { if (isTarget(e.target)) setTimeout(() => { if (!isTarget(document.activeElement)) bar.classList.remove('active'); }, 120); });
        return true;
    };
    P.insertSymbol = function (sym) {
        const el = this._symTarget || document.activeElement;
        if (!el || typeof el.value !== 'string') return false;
        const text = sym === 'Tab' ? '    ' : sym;
        const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? s;
        el.value = el.value.slice(0, s) + text + el.value.slice(e);
        el.selectionStart = el.selectionEnd = s + text.length;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.focus();
        this.haptic(5);
        return true;
    };

    // ------------------------------------------------------------------ CAMERA: QR/BARCODE + DOCUMENT SCAN (#951, #952, #954)
    P.stopCamera = function () {
        if (this._camStream) { this._camStream.getTracks().forEach(t => t.stop()); this._camStream = null; }
        clearInterval(this._scanTimer);
    };
    P.startCamera = async function (videoId) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('الكاميرا غير مدعومة في هذا المتصفح');
        this.stopCamera();
        this._camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false });
        const v = document.getElementById(videoId);
        if (v) { v.srcObject = this._camStream; await v.play().catch(() => {}); }
        return v;
    };
    P.openScanner = async function (mode = 'code') {
        const hasDetector = typeof window.BarcodeDetector !== 'undefined';
        this.openPanel({
            title: mode === 'code' ? 'ماسح QR والباركود' : 'ماسح المستندات', icon: mode === 'code' ? 'fa-qrcode' : 'fa-file-image',
            tabs: [{ id: 'code', icon: 'fa-qrcode', label: 'QR / باركود', onclick: "app.openScanner('code')" }, { id: 'doc', icon: 'fa-file-image', label: 'مستند', onclick: "app.openScanner('doc')" }], activeTab: mode,
            body: `<div class="scan-stage"><video id="scan-video" playsinline muted></video>${mode === 'code' ? '<div class="scan-frame"></div>' : ''}</div>
                <div id="scan-result" class="scan-result">${mode === 'code' && !hasDetector ? '<div class="text-amber">⚠️ متصفحك لا يدعم BarcodeDetector (متوفر في Chrome/Edge/Android). يمكنك بدلاً من ذلك إرفاق صورة الرمز وسؤال نموذج رؤية.</div>' : '<span class="text-dim">وجّه الكاميرا نحو ' + (mode === 'code' ? 'الرمز' : 'المستند ثم اضغط «التقاط»') + '</span>'}</div>`,
            footer: mode === 'doc' ? `<label class="gh-check"><input type="checkbox" id="scan-enhance" checked> تحسين (رمادي + تباين)</label><span class="gh-spacer"></span><button class="btn-new-thread gh-btn" onclick="app.captureDocument()"><i class="fa-solid fa-camera"></i> التقاط وإرفاق</button>` : ''
        });
        const modal = document.getElementById('ox-panel-modal');
        if (modal && !modal._camWatch) {
            modal._camWatch = true;
            new MutationObserver(() => { if (!modal.classList.contains('active') || !document.getElementById('scan-video')) this.stopCamera(); }).observe(modal, { attributes: true, childList: true, subtree: true });
        }
        try { await this.startCamera('scan-video'); }
        catch (e) {
            const r = document.getElementById('scan-result');
            const note = mode === 'code' && !hasDetector ? r.innerHTML : '';
            if (r) r.innerHTML = `<div class="text-red">❌ ${this.escapeHTML(e.name === 'NotAllowedError' ? 'تم رفض إذن الكاميرا' : e.message)}</div>${note}`;
            return false;
        }
        if (mode === 'code' && hasDetector) {
            let detector;
            try { detector = new window.BarcodeDetector(); } catch (e) { return false; }
            this._scanTimer = setInterval(async () => {
                const v = document.getElementById('scan-video');
                if (!v || v.readyState < 2) return;
                try {
                    const codes = await detector.detect(v);
                    if (codes && codes.length) { clearInterval(this._scanTimer); this.haptic([30, 40, 30]); this.showScanResult(codes[0]); }
                } catch (e) {}
            }, 350);
        }
        return true;
    };
    P.showScanResult = function (code) {
        const el = document.getElementById('scan-result');
        const val = String(code.rawValue || '');
        this._scanValue = val;
        const isUrl = /^https?:\/\/\S+$/i.test(val);
        if (el) el.innerHTML = `<div class="gh-card"><div class="text-dim">${this.escapeHTML(code.format || 'code')}</div><div class="scan-value" dir="auto">${this.escapeHTML(val)}</div>
            <div class="gh-toolbar"><button class="sidebar-btn-util gh-btn" onclick="app.copyText(app._scanValue)"><i class="fa-solid fa-copy"></i> نسخ</button>
            <button class="sidebar-btn-util gh-btn" onclick="app.closeModals(); app.insertIntoInput(app._scanValue)"><i class="fa-solid fa-arrow-down"></i> إلى المحادثة</button>
            ${isUrl ? `<a class="sidebar-btn-util gh-btn" href="${this.escapeHTML(val)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-up-right-from-square"></i> فتح</a>` : ''}
            <button class="sidebar-btn-util gh-btn" onclick="app.openScanner('code')"><i class="fa-solid fa-rotate"></i> مسح آخر</button></div></div>`;
        return val;
    };
    /** Grayscale + contrast stretch, in place (document scan enhancement). */
    P.enhanceDocumentPixels = function (data, contrast = 1.6) {
        let min = 255, max = 0;
        for (let i = 0; i < data.length; i += 4) { const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; data[i] = g; if (g < min) min = g; if (g > max) max = g; }
        const range = Math.max(1, max - min);
        for (let i = 0; i < data.length; i += 4) {
            let g = ((data[i] - min) / range) * 255;
            g = Math.max(0, Math.min(255, (g - 128) * contrast + 128 + 12));
            data[i] = data[i + 1] = data[i + 2] = g;
        }
        return data;
    };
    P.captureDocument = function () {
        const v = document.getElementById('scan-video');
        if (!v || !v.videoWidth) { this.showToast('الكاميرا غير جاهزة بعد', 'warning'); return null; }
        const c = document.createElement('canvas');
        const scale = Math.min(1, 2000 / Math.max(v.videoWidth, v.videoHeight));
        c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
        const ctx = c.getContext('2d');
        ctx.drawImage(v, 0, 0, c.width, c.height);
        if (document.getElementById('scan-enhance')?.checked) {
            const img = ctx.getImageData(0, 0, c.width, c.height);
            this.enhanceDocumentPixels(img.data);
            ctx.putImageData(img, 0, 0);
        }
        const dataUrl = c.toDataURL('image/jpeg', 0.85);
        this.stopCamera();
        const name = this.uniqueAttachmentName(`scan-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.jpg`);
        this.currentAttachments.push({ name, base64: dataUrl, isImage: true, size: Math.round(dataUrl.length * 0.75), mime: 'image/jpeg' });
        this.renderAttachmentTray();
        this.closeModals();
        this.showActionToast('📄 تم إرفاق المستند', 'استخرج النص', () => this.insertIntoInput('استخرج النص الكامل من المستند المرفق كما هو (حافظ على التنسيق والجداول بصيغة Markdown).'), 'success');
        return dataUrl;
    };

    // ------------------------------------------------------------------ PLATFORM PANEL
    P.openPlatform = function (tab = 'health') {
        this._platTab = tab;
        this.openPanel({
            title: 'المنصة والأداء', icon: 'fa-gauge-high',
            tabs: [['health', 'fa-heart-pulse', 'الصحة'], ['data', 'fa-database', 'البيانات'], ['network', 'fa-wifi', 'الشبكة'], ['device', 'fa-mobile-screen', 'الجهاز'], ['integrations', 'fa-plug', 'التكاملات']].map(([id, icon, label]) => ({ id, icon, label, onclick: `app.openPlatform('${id}')` })), activeTab: tab,
            body: '<div id="plat-root"><div id="health-root"></div></div>'
        });
        this.renderPlatform();
    };
    P.renderPlatform = async function () {
        const root = document.getElementById('plat-root');
        if (!root) return;
        const tab = this._platTab || 'health';
        const esc = (x) => this.escapeHTML(x);
        const toggle = (id, label, checked, onchange, sub = '') => `<label class="plat-toggle"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''} onchange="${onchange}"><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span></label>`;
        const sel = (label, value, opts, onchange, sub = '') => `<label class="plat-toggle"><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span><select class="form-input-box" onchange="${onchange}">${opts.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
        if (tab === 'health') { root.innerHTML = '<div id="health-root"></div>'; return this.renderHealth(); }
        if (tab === 'data') {
            const backups = await this.listBackups();
            const sync = lsGet('ox_alpha_sync_meta', null);
            root.innerHTML = `<div class="gh-card"><b><i class="fa-solid fa-clock-rotate-left"></i> النسخ الاحتياطي التلقائي</b>
                    <div class="text-dim plat-help">نسخة مضغوطة كل 5 دقائق عند وجود تغييرات (المحادثات، المشروع، المهام، التعليقات، السبورة، الإعدادات بدون المفاتيح). تُحفظ آخر 5 نسخ محلياً.</div>
                    ${backups.length ? backups.map(b => `<div class="share-rec"><i class="fa-solid fa-box-archive"></i><div class="share-rec-main"><span>${new Date(b.t).toLocaleString('ar')}</span><small>${b.sessions} محادثة • ${b.files} ملف • ${fmtBytes(b.size)} • ${{ auto: 'تلقائي', manual: 'يدوي', 'before-restore': 'قبل الاستعادة', 'before-import': 'قبل الاستيراد', 'before-sync': 'قبل المزامنة' }[b.reason] || b.reason}</small></div><button class="sidebar-btn-util gh-btn" onclick="app.restoreBackup('${b.id}')"><i class="fa-solid fa-rotate-left"></i> استعادة</button></div>`).join('') : '<div class="text-dim plat-help">لا توجد نسخ بعد.</div>'}
                    <div class="gh-toolbar"><button class="sidebar-btn-util gh-btn" onclick="app.createBackup({reason:'manual'}).then(()=>{app.showToast('✅ تم إنشاء نسخة','success'); app.renderPlatform();})"><i class="fa-solid fa-plus"></i> نسخة الآن</button></div></div>
                <div class="gh-card"><b><i class="fa-solid fa-file-export"></i> تصدير / استيراد كل شيء</b>
                    <div class="text-dim plat-help">ملف واحد .json.gz لنقل بياناتك لجهاز آخر. لا يتضمن مفاتيح API ولا رموز GitHub ولا ملفات معرض الوسائط.</div>
                    <div class="gh-toolbar"><button class="btn-new-thread gh-btn" onclick="app.exportAllData()"><i class="fa-solid fa-download"></i> تصدير</button>
                    <label class="sidebar-btn-util gh-btn"><i class="fa-solid fa-upload"></i> استيراد<input type="file" accept=".gz,.json,application/gzip,application/json" hidden onchange="this.files[0] && app.importAllData(this.files[0])"></label></div></div>
                <div class="gh-card"><b><i class="fa-solid fa-cloud"></i> المزامنة السحابية (GitHub Gist سري)</b>
                    <div class="text-dim plat-help">ارفع بياناتك إلى Gist سري في حسابك واسترجعها على جهاز آخر بنفس المعرّف. المفاتيح السرية لا تُرفع أبداً.</div>
                    <div class="plat-kv"><span>المعرّف</span><code dir="ltr">${esc(this.settings.syncGistId || '—')}</code>${this.settings.syncGistId ? `<button class="fx-link" onclick="app.copyText(app.settings.syncGistId)"><i class="fa-solid fa-copy"></i></button>` : ''}</div>
                    ${sync ? `<div class="plat-kv"><span>آخر مزامنة</span><span>${new Date(sync.at).toLocaleString('ar')} • ${sync.dir === 'push' ? 'رفع' : 'استرجاع'} • ${fmtBytes(sync.bytes)}</span></div>` : ''}
                    <div class="gh-toolbar"><button class="btn-new-thread gh-btn" onclick="app.syncPushUI()"><i class="fa-solid fa-cloud-arrow-up"></i> رفع الآن</button><button class="sidebar-btn-util gh-btn" onclick="app.syncPullUI()"><i class="fa-solid fa-cloud-arrow-down"></i> استرجاع</button></div></div>`;
        } else if (tab === 'network') {
            const u = this.dataUsageSummary(30);
            const days = [];
            for (let i = 13; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); days.push([d, u.byDay[d] || 0]); }
            const maxD = Math.max(1, ...days.map(d => d[1]));
            const c = navigator.connection;
            root.innerHTML = `<div class="hub-stats-grid">
                    <div class="hub-stat-card"><div class="hub-stat-title">الحالة</div><div class="hub-stat-value">${navigator.onLine === false ? '🔴 غير متصل' : '🟢 متصل'}</div><div class="hub-stat-sub">${c ? `${esc(c.effectiveType || '')}${c.downlink ? ' • ' + c.downlink + ' Mbps' : ''}${c.saveData ? ' • Save-Data' : ''}` : ''}</div></div>
                    <div class="hub-stat-card"><div class="hub-stat-title">اليوم</div><div class="hub-stat-value">${fmtBytes(u.today)}</div><div class="hub-stat-sub">بيانات مستهلكة</div></div>
                    <div class="hub-stat-card"><div class="hub-stat-title">30 يوماً</div><div class="hub-stat-value">${fmtBytes(u.total)}</div><div class="hub-stat-sub">${(this.outbox || []).length} رسالة في الانتظار</div></div></div>
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-chart-column"></i> الاستهلاك اليومي (14 يوماً)</div><div class="hub-chart">${days.map(([d, b]) => `<div class="hub-bar-col" title="${d} — ${fmtBytes(b)}"><div class="hub-bar" style="height:${Math.max(2, Math.round(b / maxD * 100))}%"></div><span>${+d.slice(8)}</span></div>`).join('')}</div></div>
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-server"></i> حسب الخدمة</div>${u.byHost.slice(0, 10).map(([h, b]) => `<div class="hub-model-row"><span class="truncate" dir="ltr">${esc(h)}</span><div class="hub-model-bar"><i style="width:${Math.round(b / Math.max(1, u.total) * 100)}%"></i></div><span>${fmtBytes(b)}</span></div>`).join('') || '<div class="text-dim plat-help">لا بيانات بعد.</div>'}
                    <div class="text-dim plat-help">يُحتسب ما تطلبه التطبيق عبر fetch (النماذج، GitHub، البحث). تحميل الخطوط والمكتبات من CDN لا يدخل في العداد.</div></div>
                <div class="gh-card">${sel('توفير البيانات', this.settings.dataSaver || 'auto', [['auto', 'تلقائي (حسب الشبكة)'], ['on', 'مفعّل دائماً'], ['off', 'متوقف']], "app.settings.dataSaver=this.value; app.persistSettings(); app.renderPlatform()", `الحالة الآن: ${this.isDataSaver() ? 'مفعّل' : 'متوقف'} — يصغّر الصور المرفقة (1280px) ويوقف تحديث قائمة النماذج التلقائي والتحميل المسبق`)}
                    <label class="plat-toggle"><span><b>تنبيه عند تجاوز (MB يومياً)</b><small>0 = بدون تنبيه</small></span><input class="form-input-box" type="number" min="0" style="max-width:110px" value="${parseFloat(this.settings.dataWarnMB) || 0}" onchange="app.settings.dataWarnMB=+this.value; app.persistSettings()"></label></div>`;
        } else if (tab === 'device') {
            const b = this._battery;
            root.innerHTML = `<div class="gh-card"><b><i class="fa-solid fa-download"></i> التثبيت كتطبيق</b>
                    <div class="text-dim plat-help">${this.isStandalone() ? '✅ يعمل الآن كتطبيق مثبت.' : 'ثبّت OX-Alpha ليعمل في نافذة مستقلة، ويظهر في قائمة المشاركة، ويفتح ملفات الكود مباشرة.'}</div>
                    ${this.isStandalone() ? '' : `<button class="btn-new-thread gh-btn" onclick="app.promptInstall()"><i class="fa-solid fa-download"></i> ${this._installEvent ? 'تثبيت الآن' : 'كيفية التثبيت'}</button>`}</div>
                <div class="gh-card">
                    ${toggle('plat-dnd', '🌙 عدم الإزعاج', !!this.settings.dnd, 'app.setDnd(this.checked)', 'كتم الأصوات والاهتزاز وإشعارات المهام')}
                    ${sel('🔋 توفير البطارية', this.settings.powerSave || 'auto', [['auto', 'تلقائي (تحت 20% دون شحن)'], ['on', 'مفعّل'], ['off', 'متوقف']], "app.settings.powerSave=this.value; app.persistSettings(); app.applyPowerSave(); app.renderPlatform()", `${b ? `البطارية ${Math.round(b.level * 100)}%${b.charging ? ' ⚡' : ''} • ` : ''}الحالة: ${this.isPowerSave() ? 'مفعّل — الحركات والتأثيرات متوقفة' : 'متوقف'}`)}
                    ${toggle('plat-haptics', '📳 الاهتزاز اللمسي', this.settings.haptics !== false, 'app.settings.haptics=this.checked; app.persistSettings(); app.haptic(20)')}
                    ${toggle('plat-symbols', '⌨️ شريط الرموز البرمجية', this.settings.symbolsBar !== false, "app.settings.symbolsBar=this.checked; app.persistSettings(); if(!this.checked) document.getElementById('symbols-bar')?.remove(); else app.initSymbolsBar()", 'يظهر فوق لوحة المفاتيح في الأجهزة اللمسية')}</div>
                <div class="gh-card"><b><i class="fa-solid fa-camera"></i> الكاميرا</b><div class="gh-toolbar"><button class="sidebar-btn-util gh-btn" onclick="app.openScanner('code')"><i class="fa-solid fa-qrcode"></i> مسح QR / باركود</button><button class="sidebar-btn-util gh-btn" onclick="app.openScanner('doc')"><i class="fa-solid fa-file-image"></i> مسح مستند</button></div></div>
                <div class="text-dim plat-help">إيماءات الجوال: اسحب من حافة الشاشة لفتح القائمة الجانبية، واسحب في الاتجاه المعاكس لإغلاقها.</div>`;
        } else {
            const hooks = this.settings.webhooks || [];
            root.innerHTML = `<div class="gh-card"><b><i class="fa-solid fa-paper-plane"></i> Webhooks — Discord و Slack</b>
                    <div class="text-dim plat-help">أرسل رداً أو تقرير مهام إلى قناة فريقك. الروابط تُحفظ محلياً فقط ولا تدخل في النسخ أو المزامنة.</div>
                    ${hooks.map(h => `<div class="share-rec"><i class="fa-brands ${h.type === 'slack' ? 'fa-slack' : 'fa-discord'}"></i><div class="share-rec-main"><span>${esc(h.name)}</span><small dir="ltr">${esc(h.url.replace(/\/[\w-]{10,}$/, '/••••'))}</small></div>
                        <button class="sidebar-btn-util gh-btn" onclick="app.sendToWebhook('✅ اختبار من OX-Alpha Workbench Pro', '${h.id}')">اختبار</button><button class="sidebar-btn-util gh-btn danger" onclick="app.removeWebhook('${h.id}')"><i class="fa-solid fa-trash"></i></button></div>`).join('')}
                    <div class="gh-row"><input id="wh-name" class="form-input-box" placeholder="الاسم (مثلاً: قناة الفريق)" style="max-width:180px"><input id="wh-url" class="form-input-box" dir="ltr" placeholder="https://discord.com/api/webhooks/… أو https://hooks.slack.com/services/…">
                    <button class="btn-new-thread gh-btn" onclick="try{app.addWebhook(document.getElementById('wh-name').value, document.getElementById('wh-url').value); app.renderPlatform(); app.showToast('تمت الإضافة','success')}catch(e){app.showToast(e.message,'error')}"><i class="fa-solid fa-plus"></i></button></div>
                    <div class="gh-toolbar"><button class="sidebar-btn-util gh-btn" onclick="app.sendToWebhook(app.lastAssistantText())"><i class="fa-solid fa-share"></i> إرسال آخر رد</button></div></div>
                <div class="text-dim plat-help">Notion غير مدعوم حالياً: واجهته لا تسمح بالاتصال المباشر من المتصفح (CORS) وتتطلب خادماً وسيطاً.</div>`;
        }
    };
    P.buildRecommendations = function (stats, storage) {
        const rec = [];
        const msgs = (this.sessions || []).reduce((n, s) => n + (s.messages || []).length, 0);
        if ((this.sessions || []).length > 150) rec.push(['fa-box-archive', `لديك ${this.sessions.length} محادثة — أرشف أو احذف القديمة لتسريع البحث والحفظ.`]);
        const active = this.sessions.find(s => s.id === this.activeSessionId);
        if (active && active.messages.length > 120) rec.push(['fa-scissors', `المحادثة الحالية طويلة (${active.messages.length} رسالة) — لخّصها وابدأ محادثة جديدة لتقليل التكلفة.`]);
        if (storage && storage.quota && storage.usage / storage.quota > 0.8) rec.push(['fa-hard-drive', 'التخزين شبه ممتلئ — صدّر بياناتك ونظف معرض الوسائط.']);
        if (storage && storage.persisted === false) rec.push(['fa-lock', 'فعّل «التخزين الدائم» من الإعدادات حتى لا يحذف المتصفح بياناتك.']);
        if (stats.longTasks > 20) rec.push(['fa-gauge', `رُصدت ${stats.longTasks} مهمة طويلة تجمّد الواجهة — فعّل توفير البطارية أو قلل عدد الرسائل المعروضة.`]);
        if (stats.heapUsed && stats.heapLimit && stats.heapUsed / stats.heapLimit > 0.6) rec.push(['fa-memory', 'استهلاك الذاكرة مرتفع — أعد تحميل الصفحة.']);
        if (stats.domNodes > 15000) rec.push(['fa-sitemap', `عدد عناصر الصفحة كبير (${stats.domNodes.toLocaleString('en')}) — أغلق الاستوديو أو اللوحات غير المستخدمة.`]);
        if (errorLog.length) rec.push(['fa-bug', `هناك ${errorLog.length} خطأ مسجل — راجعها أدناه أو أرسلها كبلاغ.`]);
        if (!this.isStandalone()) rec.push(['fa-download', 'ثبّت التطبيق (PWA) لإقلاع أسرع وعمل دون اتصال.']);
        if (msgs > 3000 && !(this.settings.dataSaver === 'on')) rec.push(['fa-wifi', 'مع هذا الكم من البيانات، النسخ الاحتياطي التلقائي والمزامنة السحابية يحميانك من الفقدان.']);
        return rec;
    };
    P.renderHealth = async function () {
        const root = document.getElementById('health-root');
        if (!root) return;
        const esc = (x) => this.escapeHTML(x);
        const s = this.getPerfStats();
        const storage = this.getStorageReport ? await this.getStorageReport() : null;
        const mods = BUILD.modules || [];
        const maxMod = Math.max(1, ...mods.map(m => m.size));
        const rec = this.buildRecommendations(s, storage);
        const score = Math.max(0, 100 - rec.length * 8 - Math.min(30, s.longTasks) - errorLog.length * 2);
        root.innerHTML = `<div class="hub-stats-grid">
                <div class="hub-stat-card"><div class="hub-stat-title">مؤشر الصحة</div><div class="hub-stat-value" style="color:${score >= 80 ? '#34d399' : score >= 60 ? '#fbbf24' : '#f87171'}">${score}</div><div class="hub-stat-sub">من 100</div></div>
                <div class="hub-stat-card"><div class="hub-stat-title">زمن الإقلاع</div><div class="hub-stat-value">${s.bootMs ? s.bootMs + 'ms' : '—'}</div><div class="hub-stat-sub">DOM ${s.domContentLoaded ? s.domContentLoaded + 'ms' : '—'}</div></div>
                <div class="hub-stat-card"><div class="hub-stat-title">مهام طويلة</div><div class="hub-stat-value">${s.longTasks}</div><div class="hub-stat-sub">${s.longTaskMs}ms إجمالاً</div></div>
                <div class="hub-stat-card"><div class="hub-stat-title">الذاكرة</div><div class="hub-stat-value">${s.heapUsed ? fmtBytes(s.heapUsed) : '—'}</div><div class="hub-stat-sub">${s.domNodes.toLocaleString('en')} عنصر DOM</div></div>
                <div class="hub-stat-card"><div class="hub-stat-title">التخزين</div><div class="hub-stat-value">${storage && storage.usage != null ? fmtBytes(storage.usage) : '—'}</div><div class="hub-stat-sub">${storage && storage.quota ? 'من ' + fmtBytes(storage.quota) : ''}</div></div></div>
            ${rec.length ? `<div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-lightbulb"></i> توصيات</div>${rec.map(([i, t]) => `<div class="plat-rec"><i class="fa-solid ${i}"></i><span>${t}</span></div>`).join('')}</div>` : '<div class="hub-section"><div class="text-emerald">✅ كل شيء يعمل بشكل ممتاز</div></div>'}
            <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-cubes"></i> حجم الوحدات — الإصدار ${esc(BUILD.version)}${BUILD.builtAt ? ` <span class="text-dim">(${new Date(BUILD.builtAt).toLocaleDateString('ar')})</span>` : ''}</div>
                ${mods.map(m => `<div class="hub-model-row"><span class="truncate" dir="ltr">${esc(m.name)}</span><div class="hub-model-bar"><i style="width:${Math.round(m.size / maxMod * 100)}%"></i></div><span>${fmtBytes(m.size)}</span></div>`).join('') || '<div class="text-dim plat-help">غير متوفر في وضع التطوير.</div>'}
                <div class="gh-toolbar"><button class="sidebar-btn-util gh-btn" onclick="app.showChangelog()"><i class="fa-solid fa-gift"></i> ما الجديد</button><button class="sidebar-btn-util gh-btn" onclick="app.runSelfCheck()"><i class="fa-solid fa-stethoscope"></i> فحص ذاتي</button></div></div>
            <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-bug"></i> سجل الأخطاء (${errorLog.length})</div>
                ${errorLog.length ? `<div class="err-list">${errorLog.slice().reverse().map(e => `<details class="err-item"><summary><span class="text-dim">${new Date(e.t).toLocaleTimeString('ar')}</span> <code dir="ltr">${esc(e.message)}</code></summary><pre dir="ltr">${esc(e.stack || '')}</pre></details>`).join('')}</div>
                <div class="gh-toolbar"><button class="sidebar-btn-util gh-btn" onclick="app.copyText(app.buildErrorReport(), 'تم نسخ التقرير')"><i class="fa-solid fa-copy"></i> نسخ</button>
                    <button class="sidebar-btn-util gh-btn" onclick="app.explainErrorsAI()"><i class="fa-solid fa-wand-magic-sparkles"></i> اشرح بالذكاء</button>
                    <button class="sidebar-btn-util gh-btn" onclick="app.reportErrorsToGitHub()"><i class="fa-brands fa-github"></i> بلاغ GitHub</button>
                    <button class="sidebar-btn-util gh-btn" onclick="app.clearErrorLog()"><i class="fa-solid fa-broom"></i> مسح</button></div>` : '<div class="text-dim plat-help">لا أخطاء مسجلة في هذه الجلسة 🎉</div>'}</div>`;
    };
    P.buildErrorReport = function () {
        const s = this.getPerfStats();
        return `OX-Alpha ${BUILD.version} — ${new Date().toISOString()}\nUA: ${navigator.userAgent}\nLong tasks: ${s.longTasks} (${s.longTaskMs}ms) • DOM: ${s.domNodes}\n\n${errorLog.map(e => `[${new Date(e.t).toISOString()}] ${e.kind}: ${e.message}\n${e.stack}`).join('\n\n')}`;
    };
    P.explainErrorsAI = function () {
        this.closeModals();
        this.insertIntoInput(`هذه أخطاء ظهرت في تطبيق ويب (JavaScript). اشرح سبب كل خطأ ببساطة وكيف أتجنبه أو أصلحه:\n\n\`\`\`\n${this.buildErrorReport().slice(0, 6000)}\n\`\`\``);
    };
    P.reportErrorsToGitHub = function () {
        const body = `### وصف المشكلة\n\n(ماذا كنت تفعل؟)\n\n### السجل\n\n\`\`\`\n${this.buildErrorReport().slice(0, 5000)}\n\`\`\``;
        const url = `https://github.com/naderba69/daschai/issues/new?title=${encodeURIComponent('Bug: ' + ((errorLog[errorLog.length - 1] || {}).message || 'error').slice(0, 80))}&body=${encodeURIComponent(body)}`;
        window.open(url, '_blank', 'noopener');
        return url;
    };
    P.runSelfCheck = async function () {
        const checks = [];
        const add = (name, ok, note = '') => checks.push({ name, ok, note });
        add('IndexedDB', !!this.idbAvailable);
        add('Service Worker', !!(navigator.serviceWorker && navigator.serviceWorker.controller), navigator.serviceWorker ? '' : 'غير مدعوم');
        add('الضغط (CompressionStream)', typeof CompressionStream !== 'undefined');
        add('مفتاح OpenRouter', !!this.settings.apiKey?.trim());
        add('رمز GitHub', !!this.settings.githubToken?.trim(), 'اختياري');
        add('الاتصال', navigator.onLine !== false);
        add('الإشعارات', typeof Notification !== 'undefined' && Notification.permission === 'granted', typeof Notification === 'undefined' ? 'غير مدعوم' : Notification.permission);
        add('BarcodeDetector', typeof window.BarcodeDetector !== 'undefined', 'لمسح QR');
        this.openPanel({ title: 'فحص ذاتي', icon: 'fa-stethoscope', body: checks.map(c => `<div class="plat-kv"><span>${c.ok ? '✅' : '⚪'} ${c.name}</span><span class="text-dim">${this.escapeHTML(c.note)}</span></div>`).join('') });
        return checks;
    };

    // ------------------------------------------------------------------ PALETTE + INIT
    const _origPalette = P.buildPaletteCommands;
    if (_origPalette) {
        P.buildPaletteCommands = function () {
            const self = this, S = 'المنصة';
            return _origPalette.call(this).concat([
                { section: S, icon: 'fa-heart-pulse', label: 'صحة التطبيق والأداء', hint: 'Health', run: () => self.openPlatform('health') },
                { section: S, icon: 'fa-database', label: 'النسخ الاحتياطي والمزامنة', hint: 'Backup / Sync', run: () => self.openPlatform('data') },
                { section: S, icon: 'fa-file-export', label: 'تصدير كل البيانات', hint: 'Export all', run: () => self.exportAllData() },
                { section: S, icon: 'fa-wifi', label: 'استهلاك البيانات وتوفيرها', hint: 'Data usage', run: () => self.openPlatform('network') },
                { section: S, icon: 'fa-moon', label: 'تبديل وضع عدم الإزعاج', hint: 'DND', run: () => self.setDnd(!self.settings.dnd) },
                { section: S, icon: 'fa-download', label: 'تثبيت التطبيق', hint: 'Install PWA', run: () => self.promptInstall() },
                { section: S, icon: 'fa-qrcode', label: 'مسح QR / باركود', hint: 'Scan', run: () => self.openScanner('code') },
                { section: S, icon: 'fa-file-image', label: 'مسح مستند بالكاميرا', hint: 'Doc scan', run: () => self.openScanner('doc') },
                { section: S, icon: 'fa-discord', brand: true, label: 'إرسال آخر رد إلى Discord/Slack', hint: 'Webhook', run: () => self.sendToWebhook(self.lastAssistantText()) },
                { section: S, icon: 'fa-gift', label: 'ما الجديد في هذا الإصدار', hint: 'Changelog', run: () => self.showChangelog() }
            ]);
        };
    }

    P.initSprint5Platform = function () {
        this._bootMs = Math.round(performance.now());
        this.outbox = lsGet('ox_alpha_outbox_v1', []);
        const meta = lsGet('ox_alpha_backup_meta', null);
        this._lastBackupFp = meta ? meta.fp : null;
        if (this.settings.dnd) document.body.classList.add('dnd-on');
        this.installFetchMeter();
        this.applyPowerSave();
        this.watchBattery();
        this.updateOnlineState();
        window.addEventListener('online', () => { this.updateOnlineState(); this.showToast('🟢 عاد الاتصال', 'success'); this.flushOutbox(); });
        window.addEventListener('offline', () => this.updateOnlineState());
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this._installEvent = e;
            const last = parseInt(localStorage.getItem('ox_alpha_install_nag') || '0', 10);
            if (Date.now() - last > 7 * 864e5) {
                try { localStorage.setItem('ox_alpha_install_nag', String(Date.now())); } catch (er) {}
                setTimeout(() => this.showActionToast('📲 ثبّت OX-Alpha كتطبيق لإقلاع أسرع وعمل دون اتصال', 'تثبيت', () => this.promptInstall(), 'info'), 8000);
            }
        });
        window.addEventListener('appinstalled', () => { this._installEvent = null; this.showToast('✅ تم تثبيت التطبيق', 'success'); });
        this.handleLaunchParams();
        this.initLaunchQueue();
        this.registerServiceWorker();
        this.checkVersionChange();
        this.initGestures();
        this.initSymbolsBar();
        this.prefetchLazyLibs();
        this._backupTimer = setInterval(() => this.autoBackupTick(), 5 * 60000);
        if (this.outbox.length && navigator.onLine !== false) setTimeout(() => this.flushOutbox(), 2500);
    };
    if (window.app) {
        try { window.app.initSprint5Platform(); } catch (e) { console.error('Sprint 5 platform init failed', e); }
    }
})();
