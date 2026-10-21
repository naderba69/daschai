/* Updates: silent / deferred updates (#862, #870), channels (#869), delta updates (#866), rollback (#865), background sync (#826). */
import { esc, call, card, empty, btn, pbtn, select, uid, win, fmtBytes, fmtDT, table } from './util.js';

// ------------------------------------------------------------------ PURE
/** The exact requests postWebhook would make — queued while offline and replayed by the service worker. */
export function webhookRequests(hook, text) {
    const msg = String(text || '').trim();
    if (!msg || !hook || !hook.url) return [];
    if (hook.type === 'discord') {
        const out = [];
        for (let i = 0; i < msg.length && out.length < 5; i += 1900) out.push({ url: hook.url, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: msg.slice(i, i + 1900), username: 'OX-Alpha' }), mode: 'cors' });
        return out;
    }
    return [{ url: hook.url, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'payload=' + encodeURIComponent(JSON.stringify({ text: msg.slice(0, 39000) })), mode: 'no-cors' }];
}
/** Compare two version.json file maps ({ path: { h, gz } | hash }) → what a delta update downloads. */
export function versionDelta(prev, next) {
    const pf = (prev && prev.files) || {}, nf = (next && next.files) || {};
    const out = { added: [], removed: [], same: [], bytes: 0, total: 0 };
    for (const [p, info] of Object.entries(nf)) {
        const size = (info && (info.gz || info.gzip || info.size)) || 0, h = (x) => (x && typeof x === 'object' ? x.h : x);
        out.total += size;
        if (p in pf && h(pf[p]) === h(info)) out.same.push(p); else { out.added.push(p); out.bytes += size; }
    }
    for (const p of Object.keys(pf)) if (!(p in nf)) out.removed.push(p);
    out.saved = out.total ? Math.round((1 - out.bytes / out.total) * 100) : 0;
    return out;
}
export const DEFER_OPTIONS = [['h1', 'ساعة', 36e5], ['h4', '4 ساعات', 4 * 36e5], ['d1', 'غداً', 864e5], ['w1', 'أسبوع', 7 * 864e5]];

export function installUpdate(P) {
    // ------------------------------------------------------------------ POLICY (#862 #869 #870)
    P.pfUpdatePolicy = function () {
        const u = this.pfUpdatePrefs(), deferred = u.deferUntil && u.deferUntil > Date.now();
        const silent = (() => { try { return JSON.parse(localStorage.getItem('ox_perf_silent') || 'null'); } catch (e) { return null; } })();
        const status = this._updateReady ? (this._updateSkipSession ? '⏸ مؤجل حتى التشغيل القادم' : deferred ? '⏸ مؤجل' : '✨ إصدار جديد جاهز') : '✅ أنت على أحدث إصدار متاح';
        return card('الحالة', `<p><b>${status}</b> — الإصدار الحالي <code>${esc((win().OX_BUILD || {}).version || '')}</code></p>
                ${deferred ? `<p class="gh-muted">التحديث مؤجل حتى ${esc(fmtDT(u.deferUntil))} ${btn('fa-xmark', 'إلغاء التأجيل', call('pfCancelDefer'))}</p>` : ''}
                ${silent ? `<p class="gh-muted">آخر تحديث صامت: ${esc(fmtDT(silent.at))}</p>` : ''}
                <div class="gh-row">${pbtn('fa-rotate', 'تحقق الآن', call('pfCheckUpdate'))}${this._updateReady ? btn('fa-download', 'ثبّت الآن', call('applyUpdate')) : ''}</div>`, 'fa-circle-info')
            + card('طريقة التحديث', `<div class="pfx-radio">${[['prompt', 'اسألني (افتراضي)', 'إشعار «يتوفر إصدار جديد» وتختار متى'], ['silent', 'صامت', 'يُثبَّت تلقائياً عندما تكون الصفحة في الخلفية ولا يوجد رد قيد التوليد — لن يقاطعك أبداً']].map(([v, l, d]) => `<label class="pfx-radio-row"><input type="radio" name="pfx-umode" value="${v}" ${u.mode === v ? 'checked' : ''} onchange="${call('pfSetUpdateMode', v)}"><span><b>${l}</b><small>${d}</small></span></label>`).join('')}</div>`, 'fa-gears')
            + card('تأجيل التحديث', `<p class="gh-muted">أجّل تثبيت الإصدار الجديد إن كنت في منتصف عمل مهم.</p><div class="gh-row">${DEFER_OPTIONS.map(([id, l]) => btn('fa-clock', l, call('pfDeferPreset', id))).join('')}${btn('fa-power-off', 'حتى التشغيل القادم', call('pfDeferUpdate', 'session'))}</div>`, 'fa-hourglass-half')
            + card('قناة التحديث', `${select('pfx-channel', 'القناة', [['stable', 'مستقر — الإصدارات المختبرة فقط'], ['beta', 'تجريبي (Beta) — الميزات الجديدة أولاً']], u.channel, `onchange="app.pfSetChannel(this.value)"`)}
                <p class="gh-muted">على القناة المستقرة يرفض Service Worker تثبيت أي بناء موسوم <code>beta</code> في <code>version.json</code> ويبقى الإصدار الحالي. للنشر التجريبي: <code>OX_CHANNEL=beta node build.js</code>.</p>`, 'fa-code-branch');
    };
    P.pfSetUpdateMode = function (mode) { this.pfSetUpdatePrefs({ mode: mode === 'silent' ? 'silent' : 'prompt' }); this.showToast(mode === 'silent' ? '🤫 التحديثات صامتة الآن' : '🔔 سيُطلب إذنك قبل كل تحديث', 'success'); if (this._updateReady) this.onUpdateReady(); return mode; };
    P.pfSetChannel = function (ch) { const u = this.pfSetUpdatePrefs({ channel: ch === 'beta' ? 'beta' : 'stable' }); this.showToast('قناة التحديث: ' + (u.channel === 'beta' ? 'تجريبي' : 'مستقر'), 'success'); return u.channel; };
    P.pfDeferPreset = function (id) { const o = DEFER_OPTIONS.find(x => x[0] === id); if (!o) return null; const r = this.pfDeferUpdate(o[2]); if (this._pfx && this._pfx.sec === 'policy') this.pfRefresh(); return r; };
    P.pfCancelDefer = function () { this.pfSetUpdatePrefs({ deferUntil: 0 }); this._updateSkipSession = false; if (this._updateReady) this.onUpdateReady(); if (this._pfx && this._pfx.sec === 'policy') this.pfRefresh(); return true; };
    P.pfCheckUpdate = async function () {
        const sw = navigator.serviceWorker;
        if (!sw || !sw.getRegistration) { this.showToast('Service Worker غير متاح هنا', 'warning'); return null; }
        try {
            const reg = await sw.getRegistration();
            if (!reg) { this.showToast('لا يوجد Service Worker مسجل (وضع التطوير؟)', 'warning'); return null; }
            await reg.update();
            const r = reg.installing || reg.waiting ? 'found' : 'latest';
            this.showToast(r === 'found' ? '✨ وُجد إصدار جديد — جاري التحضير' : '✅ لا يوجد إصدار أحدث', r === 'found' ? 'info' : 'success');
            return r;
        } catch (e) { return this.pfErr(e); }
    };

    // ------------------------------------------------------------------ VERSIONS: delta (#866) + rollback (#865)
    P.pfVersionInfo = async function () {
        const [status, remote] = await Promise.all([this.pfSWPost({ type: 'STATUS' }), fetch('/version.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null)]);
        return { status, remote };
    };
    P.pfVersions = async function () {
        const { status, remote } = await this.pfVersionInfo();
        const cur = (status && status.version) || null;
        const delta = cur && remote && cur.version !== remote.version ? versionDelta(cur, remote) : null;
        const last = status && status.delta;
        return card('الإصدار', status ? table(['', 'القيمة'], [
            ['Service Worker', esc(status.sw || '—')],
            ['الإصدار المثبت', esc((cur && cur.version) || '—') + (cur && cur.builtAt ? ` <small>${esc(fmtDT(cur.builtAt))}</small>` : '')],
            ['على الخادم', esc((remote && remote.version) || '—') + (remote && remote.channel === 'beta' ? ' <span class="gh-chip">beta</span>' : '')],
            ['القناة', esc(status.channel || 'stable')],
            ['طلبات مؤجلة', String(status.queue || 0)],
            ['الذاكرة المخبئية', esc((status.caches || []).join('، '))]
        ]) + (status.skipped ? `<p class="gh-muted">⏭ تم تخطي ${esc(status.skipped.version)} (قناة ${esc(status.skipped.channel)})</p>` : '') : empty('Service Worker غير نشط — يعمل هذا القسم في النسخة المنشورة (HTTPS)'), 'fa-tag')
            + card('التحديثات التفاضلية (Delta)', `<p class="gh-muted">الأجزاء مُسماة ببصمة محتواها؛ عند التحديث لا يُنزَّل إلا ما تغيّر فعلاً، والأجزاء غير المستخدمة تبقى كسولة.</p>
                ${delta ? `<p>التحديث القادم: <b>${delta.added.length}</b> ملف جديد (${fmtBytes(delta.bytes)} gzip) • <b>${delta.same.length}</b> بلا تغيير • توفير <b>${delta.saved}%</b></p>` : ''}
                ${last ? `<p>آخر تحديث (${esc(last.version)}): أعيد استخدام <b>${last.reused}</b> • نُزّل <b>${last.fetched}</b> (${fmtBytes(last.bytes)}) • تُرك كسولاً <b>${last.skipped}</b></p>` : '<p class="gh-muted">لا إحصاءات بعد — ستظهر بعد أول تحديث.</p>'}`, 'fa-code-compare')
            + card('التراجع إلى الإصدار السابق', status && status.prev ? `<p>الإصدار السابق: <b>${esc(status.prev.version)}</b> (${esc(fmtDT(status.prev.at))})</p>
                ${status.pin ? `<p class="pfx-warn">📌 الواجهة مثبتة حالياً على ${esc(status.pin.version)}</p>${pbtn('fa-arrow-up', 'العودة إلى الأحدث', call('pfUnpin'))}` : `${btn('fa-clock-rotate-left', 'تراجع إلى ' + esc(status.prev.version), call('pfRollback'))}`}
                <p class="gh-muted">ملاحظة صادقة: التراجع يعيد واجهة الإصدار السابق، والأجزاء الكسولة المتاحة له هي ما بقي في الذاكرة المخبئية فقط.</p>` : empty('لا يوجد إصدار سابق محفوظ بعد'), 'fa-clock-rotate-left');
    };
    P.pfRollback = async function () {
        if (this.askConfirm && !(await this.askConfirm('التراجع إلى الإصدار السابق', 'ستُعاد تحميل الصفحة بواجهة الإصدار السابق حتى تختار «العودة إلى الأحدث». متابعة؟'))) return false;
        const r = await this.pfSWPost({ type: 'PIN_PREV' });
        if (!r || !r.ok) { this.showToast('لا يوجد إصدار سابق للتراجع إليه', 'warning'); return false; }
        this.showToast('↩️ جاري التراجع إلى ' + esc(r.prev.version), 'info');
        setTimeout(() => location.reload(), 500);
        return true;
    };
    P.pfUnpin = async function () {
        await this.pfSWPost({ type: 'UNPIN' });
        this.showToast('⬆️ جاري العودة إلى أحدث إصدار', 'info');
        setTimeout(() => location.reload(), 400);
        return true;
    };

    // ------------------------------------------------------------------ BACKGROUND SYNC (#826)
    const db = () => new Promise((resolve, reject) => {
        const idb = win().indexedDB || globalThis.indexedDB;
        if (!idb) return reject(new Error('IndexedDB غير متاح'));
        const r = idb.open('ox-alpha-bg', 1);
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('q')) r.result.createObjectStore('q', { keyPath: 'id' }); };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
    const tx = (mode, fn) => db().then(d => new Promise((resolve, reject) => {
        const t = d.transaction('q', mode), store = t.objectStore('q'); let out;
        const req = fn(store); if (req) req.onsuccess = () => { out = req.result; };
        t.oncomplete = () => resolve(out); t.onerror = () => reject(t.error);
    }));
    P.pfQueueAll = function () { return tx('readonly', s => s.getAll()).then(x => x || []).catch(() => []); };
    P.pfQueuePut = function (item) { return tx('readwrite', s => s.put(item)); };
    P.pfQueueClear = function () { return tx('readwrite', s => s.clear()); };
    /** Queue requests while offline; the SW replays them on `sync` — or the page does on `online` (Safari/Firefox). */
    P.pfQueueRequests = async function (reqs, label = '') {
        if (!reqs.length) return 0;
        for (const r of reqs) await this.pfQueuePut({ id: uid('bg'), t: Date.now(), label, tries: 0, ...r });
        let viaSW = false;
        try { const reg = navigator.serviceWorker && (await navigator.serviceWorker.ready); if (reg && reg.sync) { await reg.sync.register('ox-bg-sync'); viaSW = true; } } catch (e) { /* not supported */ }
        if (!viaSW && !this._pfOnlineHook) { this._pfOnlineHook = () => this.pfReplayQueue(); window.addEventListener('online', this._pfOnlineHook); }
        this.showToast(`📥 لا يوجد اتصال — حُفظ الطلب وسيُرسل تلقائياً عند عودة الشبكة`, 'info');
        return reqs.length;
    };
    P.pfQueueWebhook = function (hook, text) { return this.pfQueueRequests(webhookRequests(hook, text), (hook && hook.name) || 'webhook'); };
    /** Replay from the page (fallback without Background Sync) — same rules as the SW. */
    P.pfReplayQueue = async function () {
        const viaSW = await this.pfSWPost({ type: 'BG_SYNC_NOW' });
        if (viaSW) { if (this._pfx && this._pfx.sec === 'sync') this.pfRefresh(); return viaSW; }
        const items = await this.pfQueueAll(), out = { sent: 0, failed: 0, dropped: 0 };
        for (const it of items) {
            try {
                const res = await fetch(it.url, { method: it.method || 'POST', headers: it.headers || {}, body: it.body == null ? undefined : it.body, mode: it.mode || 'cors' });
                if (res.ok || res.type === 'opaque' || (res.status >= 400 && res.status < 500)) { await tx('readwrite', s => s.delete(it.id)); if (res.ok || res.type === 'opaque') out.sent++; else out.dropped++; }
                else { it.tries = (it.tries || 0) + 1; await this.pfQueuePut(it); out.failed++; }
            } catch (e) { it.tries = (it.tries || 0) + 1; await this.pfQueuePut(it); out.failed++; }
        }
        if (out.sent) this.showToast(`📤 أُرسل ${out.sent} طلب مؤجل`, 'success');
        if (this._pfx && this._pfx.sec === 'sync') this.pfRefresh();
        return out;
    };
    P.pfBgSync = async function () {
        const items = await this.pfQueueAll();
        let support = 'لا — يُعاد الإرسال عند حدث online أثناء فتح التطبيق';
        try { const reg = navigator.serviceWorker && navigator.serviceWorker.getRegistration && (await navigator.serviceWorker.getRegistration()); if (reg && reg.sync) support = 'نعم — يُرسل حتى لو أغلقت التبويب'; } catch (e) {}
        return card('المزامنة في الخلفية', `<p>Background Sync: <b>${support}</b></p><p class="gh-muted">رسائل Webhooks (Discord/Slack) المرسلة دون اتصال تُحفظ في IndexedDB وتُرسل تلقائياً عند عودة الشبكة.</p>
                <div class="gh-row">${pbtn('fa-paper-plane', 'أرسل الآن', call('pfReplayQueue'))}${btn('fa-flask', 'طلب تجريبي', call('pfQueueTest'))}${items.length ? btn('fa-trash', 'إفراغ', call('pfQueueClearUI')) : ''}</div>`, 'fa-arrows-rotate')
            + card(`قائمة الانتظار (${items.length})`, items.length ? table(['الوجهة', 'الوقت', 'المحاولات'], items.map(i => [esc(i.label || new URL(i.url).host), esc(fmtDT(i.t)), String(i.tries || 0)])) : empty('لا طلبات معلقة ✓'), 'fa-inbox');
    };
    P.pfQueueTest = async function () {
        const hook = (this.settings.webhooks || [])[0];
        if (!hook) { this.showToast('أضف Webhook (Discord/Slack) من «المنصة ← التكاملات» أولاً', 'warning'); return 0; }
        const n = await this.pfQueueWebhook(hook, '🧪 رسالة اختبار للمزامنة الخلفية من OX-Alpha — ' + new Date().toLocaleString('ar'));
        if (this._pfx && this._pfx.sec === 'sync') this.pfRefresh();
        return n;
    };
    P.pfQueueClearUI = async function () { await this.pfQueueClear(); if (this._pfx && this._pfx.sec === 'sync') this.pfRefresh(); return true; };
}
