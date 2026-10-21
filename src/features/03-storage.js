/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 2: Durable storage (IndexedDB)
   Ideas implemented (THOUSAND_IDEAS.md):
     #811  Sessions mirrored to IndexedDB (hundreds of MB instead of ~5MB)
     #819  Restore after closing the browser — flush on tab hide / close
   localStorage stays as a fast synchronous cache (and may hold a trimmed copy when
   its quota is hit); IndexedDB always keeps the full sessions incl. attachments.
   ============================================================================== */
(function () {
    'use strict';
    if (typeof OXAlphaApp === 'undefined') return;
    const P = OXAlphaApp.prototype;
    const DB_NAME = 'ox-alpha-db';
    const STORE = 'kv';
    const SAVED_AT_KEY = 'ox_alpha_sessions_saved_at';

    let dbPromise = null;
    const openDB = () => {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined' || !indexedDB) return reject(new Error('IndexedDB unavailable'));
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            req.onblocked = () => reject(new Error('IndexedDB blocked'));
        });
        dbPromise.catch(() => { dbPromise = null; });
        return dbPromise;
    };
    const idbGet = async (key) => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
        });
    };
    const idbSet = async (key, value) => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    };
    P.idbGet = idbGet;
    P.idbSet = idbSet;

    // Sessions may contain non-cloneable values in edge cases; JSON round-trip guarantees a clean copy.
    const snapshot = (sessions) => JSON.parse(JSON.stringify(sessions));

    P.flushSessionsToIDB = async function () {
        clearTimeout(this._idbFlushTimer);
        this._idbFlushTimer = null;
        const savedAt = this._lastSessionsSaveAt || Date.now();
        try {
            await idbSet('sessions', { savedAt, activeSessionId: this.activeSessionId, sessions: snapshot(this.sessions) });
            this.idbAvailable = true;
            return true;
        } catch (e) {
            this.idbAvailable = false;
            console.warn('IndexedDB flush failed:', e);
            return false;
        }
    };

    const _origSave = P.saveSessions;
    P.saveSessions = function () {
        const r = _origSave.apply(this, arguments);
        this._lastSessionsSaveAt = Date.now();
        try { localStorage.setItem(SAVED_AT_KEY, String(this._lastSessionsSaveAt)); } catch (e) {}
        if (this.idbAvailable !== false) {
            clearTimeout(this._idbFlushTimer);
            this._idbFlushTimer = setTimeout(() => this.flushSessionsToIDB(), 400);
        }
        return r;
    };

    /** On boot: adopt the IndexedDB copy when it is at least as fresh as localStorage (it is never trimmed). */
    P.restoreSessionsFromIDB = async function () {
        let lsSavedAt = 0;
        try { lsSavedAt = parseInt(localStorage.getItem(SAVED_AT_KEY) || '0', 10) || 0; } catch (e) {}
        let rec;
        try { rec = await idbGet('sessions'); this.idbAvailable = true; } catch (e) { this.idbAvailable = false; return false; }
        if (!rec || !Array.isArray(rec.sessions) || rec.sessions.length === 0) {
            await this.flushSessionsToIDB(); // first run → migrate existing localStorage sessions
            return false;
        }
        if (this.activeStreams && this.activeStreams.size > 0) return false; // never swap data under a live stream
        if (rec.savedAt + 1500 < lsSavedAt) {
            await this.flushSessionsToIDB(); // localStorage is newer (e.g. tab closed before the debounce fired)
            return false;
        }
        const prevActive = this.activeSessionId;
        this.sessions = rec.sessions;
        const has = (id) => id && this.sessions.some(s => s.id === id);
        this.activeSessionId = has(rec.activeSessionId) ? rec.activeSessionId : has(prevActive) ? prevActive : this.sessions[0].id;
        this._idbRestored = true;
        this.renderUIState();
        return true;
    };

    P.getStorageReport = async function () {
        const report = { idb: !!this.idbAvailable, usage: null, quota: null, persisted: null, lsBytes: 0 };
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                report.lsBytes += (k.length + (localStorage.getItem(k) || '').length) * 2;
            }
        } catch (e) {}
        try {
            if (navigator.storage && navigator.storage.estimate) {
                const est = await navigator.storage.estimate();
                report.usage = est.usage; report.quota = est.quota;
            }
            if (navigator.storage && navigator.storage.persisted) report.persisted = await navigator.storage.persisted();
        } catch (e) {}
        return report;
    };

    P.requestPersistentStorage = async function () {
        try {
            if (!navigator.storage || !navigator.storage.persist) throw new Error('unsupported');
            const ok = await navigator.storage.persist();
            this.showToast(ok ? 'تم تفعيل التخزين الدائم 🔒 — لن يحذفه المتصفح تلقائياً' : 'رفض المتصفح التخزين الدائم (جرّب بعد تثبيت التطبيق PWA)', ok ? 'success' : 'warning');
        } catch (e) {
            this.showToast('المتصفح لا يدعم التخزين الدائم', 'warning');
        }
        if (this.renderStorageSection) this.renderStorageSection();
    };

    const fmtBytes = (b) => {
        if (b === null || b === undefined) return '—';
        if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
        if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
        if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
        return b + ' B';
    };

    P.renderStorageSection = async function () {
        const el = document.getElementById('hub-storage-section');
        if (!el) return;
        const r = await this.getStorageReport();
        const pct = r.quota ? Math.min(100, (r.usage / r.quota) * 100) : 0;
        el.innerHTML = `<div class="hub-section-title"><i class="fa-solid fa-database"></i> التخزين المحلي</div>
            <div class="hub-route-row"><span>IndexedDB (المحادثات كاملة)</span><span>${r.idb ? '🟢 مفعل' : '🔴 غير متاح — يُستخدم localStorage فقط'}</span></div>
            <div class="hub-route-row"><span>المستخدم / المتاح</span><span dir="ltr">${fmtBytes(r.usage)} / ${fmtBytes(r.quota)}</span></div>
            ${r.quota ? `<div class="hub-budget"><i style="width:${pct.toFixed(1)}%"></i></div>` : ''}
            <div class="hub-route-row"><span>localStorage (ذاكرة سريعة، حد ~5MB)</span><span dir="ltr">${fmtBytes(r.lsBytes)}</span></div>
            <div class="hub-route-row"><span>تخزين دائم (لا يحذفه المتصفح)</span><span>${r.persisted === null ? '—' : r.persisted ? '🔒 نعم' : 'لا'}</span></div>
            ${r.persisted === false ? `<button class="sidebar-btn-util" style="padding:6px 12px; margin-top:6px;" onclick="app.requestPersistentStorage()"><i class="fa-solid fa-lock"></i><span>طلب تخزين دائم</span></button>` : ''}`;
    };

    P.initDurableStorage = function () {
        const flush = () => { if (this._idbFlushTimer) this.flushSessionsToIDB(); };
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
        window.addEventListener('pagehide', flush);
        this._idbReady = this.restoreSessionsFromIDB().catch(e => { console.warn('IDB restore failed', e); return false; });
    };

    if (window.app) {
        try { window.app.initDurableStorage(); } catch (e) { console.error('Durable storage init failed', e); }
    }
})();
