/* Mobile app: Android TWA (#941), iOS (#942), touch gestures (#943), Web Push (#949), widgets (#964),
   Google Assistant / Siri deep links (#966), smart-watch sync (#971), watch notifications (#972), watch control (#973). */
import { esc, call, card, btn, pbtn, field, val, win, table } from './util.js';

// ------------------------------------------------------------------ PURE
const host = (origin) => { try { return new URL(origin).host; } catch (e) { return 'example.com'; } };
export const packageIdFor = (origin) => host(origin).split(':')[0].split('.').filter(Boolean).reverse().join('.').replace(/[^a-z0-9.]/gi, '_').replace(/\.(\d)/g, '._$1') + '.twa';
/** Bubblewrap twa-manifest.json from the web manifest. */
export function twaManifest(manifest, origin, { packageId, fingerprint } = {}) {
    const m = manifest || {}, h = host(origin);
    return {
        packageId: packageId || packageIdFor(origin), host: h, name: m.name || 'OX-Alpha', launcherName: m.short_name || 'OX-Alpha',
        display: m.display || 'standalone', orientation: 'default', themeColor: m.theme_color || '#0b0f19', navigationColor: m.background_color || '#0b0f19',
        backgroundColor: m.background_color || '#0b0f19', enableNotifications: true, startUrl: m.start_url || '/',
        iconUrl: `https://${h}/icons/icon-512.png`, maskableIconUrl: `https://${h}/icons/icon-maskable-512.png`, webManifestUrl: `https://${h}/manifest.json`,
        shortcuts: (m.shortcuts || []).slice(0, 4).map((s, i) => ({ name: s.name, shortName: s.short_name || s.name, url: s.url, chosenIconUrl: `https://${h}/icons/icon-192.png`, id: 'sc' + i })),
        fallbackType: 'customtabs', enableSiteSettingsShortcut: true, isChromeOSOnly: false, appVersionName: '1.0.0', appVersionCode: 1,
        signingKey: { path: './android.keystore', alias: 'android' }, generatorApp: 'bubblewrap-cli', ...(fingerprint ? { fingerprints: [{ value: fingerprint }] } : {})
    };
}
const FP = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
export const validFingerprint = (s) => FP.test(String(s || '').trim().toUpperCase());
/** Digital Asset Links proving the site owns the Android app (served at /.well-known/assetlinks.json). */
export const assetLinks = (packageId, fingerprints) => [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: packageId, sha256_cert_fingerprints: (fingerprints || []).map(f => String(f).trim().toUpperCase()).filter(validFingerprint) } }];
/** VAPID public key (base64url) → Uint8Array for pushManager.subscribe. */
export function urlB64ToBytes(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4), s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
export const validVapid = (k) => { try { const b = urlB64ToBytes(String(k || '').trim()); return b.length === 65 && b[0] === 4; } catch (e) { return false; } };
export const pushServerSample = (sub) => `// خادم Push بسيط (Node) — npm i web-push
// المفاتيح: npx web-push generate-vapid-keys
import webpush from 'web-push';
webpush.setVapidDetails('mailto:you@example.com', process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);

const subscription = ${sub ? JSON.stringify(sub, null, 2).replace(/\n/g, '\n') : '/* الصق هنا الاشتراك المنسوخ من التطبيق */ {}'};

await webpush.sendNotification(subscription, JSON.stringify({
  title: 'OX-Alpha', body: 'اكتمل تقرير الأداء اليومي ✅', url: '/?action=perf',
  actions: [{ action: 'open', title: 'فتح' }, { action: 'tasks', title: 'المهام' }]
}));
`;
/** Deep links for widgets, Google Assistant and Siri Shortcuts (#964 #966). */
export function deepLink(origin, action, params = {}) {
    const u = new URL('/', origin || 'https://example.com');
    u.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') u.searchParams.set(k, v); });
    return u.toString();
}
export const ASSIST_ACTIONS = [['new', 'محادثة جديدة'], ['ask', 'اسأل OX (نص مسبق)'], ['search', 'بحث'], ['tasks', 'المهام'], ['voice', 'تسجيل صوتي'], ['agent', 'الوكيل الصوتي'], ['drive', 'وضع القيادة'], ['perf', 'لوحة الأداء'], ['scan', 'مسح QR']];
/** Gesture classifier for the test pad (pure: start/end points + timing). */
export function classifyGesture({ dx = 0, dy = 0, ms = 0, taps = 1, scale = 1, fingers = 1 }) {
    if (fingers >= 2 && Math.abs(scale - 1) > 0.12) return scale > 1 ? 'pinch-out' : 'pinch-in';
    const d = Math.hypot(dx, dy);
    if (d >= 50 && ms < 800) { const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'); return (fingers >= 2 ? 'two-finger-swipe-' : 'swipe-') + dir; }
    if (d < 12 && ms >= 500) return 'long-press';
    if (d < 12) return taps >= 2 ? 'double-tap' : 'tap';
    return 'drag';
}
export const GESTURE_LABEL = { tap: 'نقرة', 'double-tap': 'نقرة مزدوجة', 'long-press': 'ضغطة طويلة', drag: 'سحب', 'pinch-in': 'تصغير بإصبعين', 'pinch-out': 'تكبير بإصبعين' };
const gLabel = (g) => GESTURE_LABEL[g] || g.replace('two-finger-swipe-', 'سحب بإصبعين ').replace('swipe-', 'سحب ').replace('left', '←').replace('right', '→').replace('up', '↑').replace('down', '↓');
/** Heart Rate Measurement characteristic (0x2A37) → bpm. */
export function parseHeartRate(view) {
    const flags = view.getUint8(0);
    return flags & 0x1 ? view.getUint16(1, true) : view.getUint8(1);
}

export function installMobile(P) {
    const origin = () => { try { return win().location.origin; } catch (e) { return 'https://example.com'; } };
    const standalone = () => { const W = win(); try { return !!(W.matchMedia && W.matchMedia('(display-mode: standalone)').matches) || W.navigator.standalone === true; } catch (e) { return false; } };
    const ua = () => (navigator.userAgent || '');

    // ------------------------------------------------------------------ INSTALL: Android TWA (#941) + iOS (#942)
    P.pfWebManifest = async function () { try { const r = await fetch('/manifest.json'); return r.ok ? await r.json() : {}; } catch (e) { return {}; } };
    P.pfInstall = async function () {
        const m = await this.pfWebManifest(), ios = /iPhone|iPad|iPod/.test(ua()), android = /Android/.test(ua());
        return card('الحالة', `<p>${standalone() ? '✅ يعمل كتطبيق مثبت' : '🌐 يعمل في المتصفح'} • ${ios ? 'iOS' : android ? 'Android' : 'سطح المكتب'}</p>
                ${this._installEvent ? pbtn('fa-download', 'ثبّت الآن', call('promptInstall')) : ''}`, 'fa-mobile-screen')
            + card('Android — تطبيق TWA على Google Play', `<p class="gh-muted">Trusted Web Activity تغلّف الموقع في تطبيق Android حقيقي (بلا شريط عنوان) يُنشر على Play. يتولى Bubblewrap البناء والتوقيع.</p>
                ${field('pfx-twa-pkg', 'معرّف الحزمة', packageIdFor(origin()), 'dir="ltr"')}
                ${field('pfx-twa-fp', 'بصمة SHA-256 لمفتاح التوقيع (من Play Console ← App integrity)', '', 'dir="ltr" placeholder="AB:CD:…"')}
                <div class="gh-row">${pbtn('fa-box-archive', 'أنشئ ملفات TWA', call('pfTwaGenerate'))}</div>
                <ol class="pfx-steps"><li><code>npm i -g @bubblewrap/cli</code></li><li><code>bubblewrap init --manifest ${esc(origin())}/manifest.json</code> (أو استعمل twa-manifest.json المُنشأ)</li><li><code>bubblewrap build</code> → <code>app-release-signed.apk</code> + <code>.aab</code></li><li>انشر <code>assetlinks.json</code> على <code>/.well-known/</code> ثم ارفع الـ AAB إلى Play</li></ol><div id="pfx-twa-out"></div>`, 'fa-robot')
            + card('iOS — تطبيق على الشاشة الرئيسية', `<ol class="pfx-steps"><li>افتح الموقع في <b>Safari</b></li><li>زر المشاركة <i class="fa-solid fa-arrow-up-from-bracket"></i> ← <b>إضافة إلى الشاشة الرئيسية</b></li><li>يفتح بملء الشاشة مع أيقونة وشاشة بدء، ويدعم إشعارات Push (iOS 16.4+) بعد التثبيت</li></ol>
                <p class="gh-muted">للنشر على App Store: غلّف الموقع بـ <a href="https://www.pwabuilder.com" target="_blank" rel="noopener">PWABuilder</a> (حزمة iOS بـ WKWebView) أو Capacitor — مع مراعاة إرشادات Apple 4.2 (يجب أن يقدّم التطبيق قيمة تتجاوز الموقع).</p>
                ${table(['المتطلب', 'الحالة'], [['manifest + أيقونات PNG', m.icons && m.icons.some(i => /png/.test(i.type || i.src)) ? '✅' : '❌'], ['apple-touch-icon', document.querySelector('link[rel="apple-touch-icon"]') ? '✅' : '❌'], ['apple-mobile-web-app-capable', document.querySelector('meta[name="apple-mobile-web-app-capable"],meta[name="mobile-web-app-capable"]') ? '✅' : '❌'], ['Service Worker', navigator.serviceWorker && navigator.serviceWorker.controller ? '✅' : '⚠️ غير نشط هنا'], ['HTTPS', /^https:/.test(origin()) ? '✅' : '⚠️']])}`, 'fa-mobile-screen-button');
    };
    P.pfTwaFiles = async function () {
        const m = await this.pfWebManifest(), pkg = val('pfx-twa-pkg') || packageIdFor(origin()), fp = String(val('pfx-twa-fp') || '').trim();
        if (fp && !validFingerprint(fp)) throw new Error('البصمة يجب أن تكون 32 بايت بصيغة AB:CD:… (95 حرفاً)');
        return { 'twa-manifest.json': JSON.stringify(twaManifest(m, origin(), { packageId: pkg, fingerprint: fp || undefined }), null, 2), '.well-known/assetlinks.json': JSON.stringify(assetLinks(pkg, fp ? [fp] : []), null, 2) };
    };
    P.pfTwaGenerate = async function () {
        try {
            const files = await this.pfTwaFiles();
            Object.entries(files).forEach(([p, c]) => this.writeProjectFile('android/' + p, c, 'template'));
            const el = document.getElementById('pfx-twa-out');
            if (el) el.innerHTML = Object.entries(files).map(([p, c]) => `<p><b>android/${esc(p)}</b></p><pre class="pfx-pre" dir="ltr">${esc(c)}</pre>`).join('') + (files['.well-known/assetlinks.json'].includes('sha256_cert_fingerprints": []') ? '<p class="pfx-warn">⚠️ أضف بصمة مفتاح التوقيع وإلا سيظهر شريط العنوان داخل التطبيق.</p>' : '');
            this.showToast('✅ أُضيفت ملفات TWA إلى مجلد android/', 'success');
            return files;
        } catch (e) { return this.pfErr(e, 'pfx-twa-out'); }
    };

    // ------------------------------------------------------------------ GESTURES (#943)
    P.pfGestures = function () {
        const s = this.settings || {};
        this._pfMount = () => this.pfGesturePad();
        return card('الإيماءات في المحادثة', `<label class="pfx-toggle"><input type="checkbox" ${s.pinchZoom === false ? '' : 'checked'} onchange="app.pfSet('pinchZoom', this.checked)"> <span><b>قرص بإصبعين</b> لتكبير/تصغير نص المحادثة</span></label>
                <label class="pfx-toggle"><input type="checkbox" ${s.swipeChats === false ? '' : 'checked'} onchange="app.pfSet('swipeChats', this.checked)"> <span><b>سحب بإصبعين</b> يميناً/يساراً للانتقال بين المحادثات</span></label>
                <p class="gh-muted">إيماءات موجودة مسبقاً: سحب من الحافة لفتح الشريط الجانبي، سحب رسالة للرد، ضغطة طويلة لقائمة الرسالة.</p>`, 'fa-hand-pointer')
            + card('جرّب الإيماءات', `<div id="pfx-gpad" class="pfx-gpad" tabindex="0">المس هنا: نقرة، نقرتان، ضغطة طويلة، سحب، قرص…</div><div id="pfx-glog" class="pfx-glog"></div>`, 'fa-fingerprint');
    };
    P.pfGesturePad = function () {
        const pad = document.getElementById('pfx-gpad'); if (!pad) return false;
        let st = null, lastTap = 0;
        const log = (g) => { const l = document.getElementById('pfx-glog'); if (l) l.innerHTML = `<span class="gh-chip">${esc(gLabel(g))}</span>` + l.innerHTML.slice(0, 2000); pad.textContent = gLabel(g); if (this.haptic) this.haptic(6); };
        const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
        pad.addEventListener('touchstart', (e) => { const t = e.touches; st = { x: t[0].clientX, y: t[0].clientY, t: Date.now(), f: t.length, d: t.length > 1 ? dist(t) : 0, scale: 1 }; }, { passive: true });
        pad.addEventListener('touchmove', (e) => { if (!st) return; const t = e.touches; if (t.length > 1) { st.f = Math.max(st.f, t.length); if (st.d) st.scale = dist(t) / st.d; else st.d = dist(t); } }, { passive: true });
        pad.addEventListener('touchend', (e) => {
            if (!st || e.touches.length) return;
            const c = e.changedTouches[0], now = Date.now();
            let g = classifyGesture({ dx: c.clientX - st.x, dy: c.clientY - st.y, ms: now - st.t, fingers: st.f, scale: st.scale, taps: 1 });
            if (g === 'tap') { if (now - lastTap < 300) { g = 'double-tap'; lastTap = 0; } else lastTap = now; }
            st = null; log(g);
        }, { passive: true });
        // Mouse fallback for desktop testing
        let md = null;
        pad.addEventListener('mousedown', (e) => { md = { x: e.clientX, y: e.clientY, t: Date.now() }; });
        pad.addEventListener('mouseup', (e) => { if (!md) return; log(classifyGesture({ dx: e.clientX - md.x, dy: e.clientY - md.y, ms: Date.now() - md.t, taps: e.detail || 1 })); md = null; });
        return true;
    };

    // ------------------------------------------------------------------ WEB PUSH (#949)
    P.pfReg = async function () { const sw = navigator.serviceWorker; if (!sw) return null; try { return (await sw.getRegistration()) || null; } catch (e) { return null; } };
    P.pfPush = async function () {
        const W = win(), perm = typeof W.Notification === 'undefined' ? 'unsupported' : W.Notification.permission;
        const reg = await this.pfReg(), sub = reg && reg.pushManager ? await reg.pushManager.getSubscription().catch(() => null) : null;
        const saved = this.settings.vapidPublic || '';
        return card('الإذن', `<p>إذن الإشعارات: <b>${{ granted: '✅ مسموح', denied: '⛔ مرفوض (من إعدادات المتصفح)', default: 'لم يُطلب بعد', unsupported: 'غير مدعوم' }[perm]}</b>${/iPhone|iPad/.test(ua()) && !standalone() ? ' — على iOS ثبّت التطبيق على الشاشة الرئيسية أولاً' : ''}</p>
                <div class="gh-row">${perm === 'default' ? pbtn('fa-bell', 'اطلب الإذن', call('pfPushPermission')) : ''}${btn('fa-paper-plane', 'إشعار تجريبي بأزرار', call('pfTestNotification'))}</div>`, 'fa-bell')
            + card('اشتراك Push (خادمك)', `<p class="gh-muted">لإرسال إشعارات والتطبيق مغلق تحتاج خادماً بمفاتيح VAPID. التطبيق يشترك ويعطيك JSON تلصقه في الخادم.</p>
                ${field('pfx-vapid', 'مفتاح VAPID العام', saved, 'dir="ltr" placeholder="BEl62i…"')}
                <div class="gh-row">${pbtn('fa-plug', sub ? 'تحديث الاشتراك' : 'اشترك', call('pfPushSubscribe'))}${sub ? btn('fa-plug-circle-xmark', 'إلغاء', call('pfPushUnsubscribe')) : ''}${btn('fa-file-code', 'مثال خادم Node', call('pfPushSample'))}</div>
                <div id="pfx-push-out">${sub ? `<pre class="pfx-pre" dir="ltr">${esc(JSON.stringify(sub.toJSON ? sub.toJSON() : sub, null, 2))}</pre>${btn('fa-copy', 'نسخ', call('pfPushCopy'))}` : ''}</div>`, 'fa-tower-broadcast');
    };
    P.pfPushPermission = async function () {
        const W = win(); if (typeof W.Notification === 'undefined') return 'unsupported';
        const p = await W.Notification.requestPermission().catch(() => 'denied');
        if (this.setUIPrefs && p === 'granted') this.setUIPrefs({ notify: { desktop: true } });
        if (this._pfx && this._pfx.sec === 'push') this.pfRefresh();
        return p;
    };
    /** Rich notification via the SW (actions work on Android + paired watches; desktop shows them as buttons). */
    P.pfNotify = async function (title, body, { actions = [], tag = 'ox-alpha', data = {}, requireInteraction = false } = {}) {
        const W = win();
        if (typeof W.Notification === 'undefined' || W.Notification.permission !== 'granted') return false;
        const reg = await this.pfReg();
        const opts = { body: String(body || '').slice(0, 240), tag, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', data, vibrate: [60, 30, 60], requireInteraction, actions: actions.slice(0, 2) };
        if (reg && reg.showNotification) { await reg.showNotification(title, opts); return 'sw'; }
        try { new W.Notification(title, { body: opts.body, tag, icon: opts.icon }); return 'page'; } catch (e) { return false; }
    };
    P.pfTestNotification = async function () {
        if ((win().Notification || {}).permission !== 'granted') { const p = await this.pfPushPermission(); if (p !== 'granted') { this.showToast('يلزم إذن الإشعارات', 'warning'); return false; } }
        const r = await this.pfNotify('OX-Alpha 🔔', 'إشعار تجريبي — جرّب الأزرار (تعمل أيضاً من الساعة الذكية)', { actions: [{ action: 'speak', title: '🔊 اقرأ آخر رد' }, { action: 'new', title: '➕ محادثة' }], tag: 'ox-test' });
        this.showToast(r ? '✅ أُرسل الإشعار' : 'تعذر عرض الإشعار', r ? 'success' : 'warning');
        return r;
    };
    P.pfPushSubscribe = async function () {
        const key = String(val('pfx-vapid') || this.settings.vapidPublic || '').trim();
        if (!validVapid(key)) { this.showToast('مفتاح VAPID العام غير صالح (65 بايت base64url يبدأ بـ B)', 'warning'); return null; }
        try {
            if ((await this.pfPushPermission()) !== 'granted') throw new Error('يلزم إذن الإشعارات');
            const reg = await this.pfReg();
            if (!reg || !reg.pushManager) throw new Error('Push غير مدعوم هنا (يتطلب HTTPS و Service Worker)');
            const old = await reg.pushManager.getSubscription(); if (old) await old.unsubscribe();
            const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(key) });
            this.pfSet('vapidPublic', key);
            this._pfPushSub = sub.toJSON ? sub.toJSON() : sub;
            this.showToast('✅ تم الاشتراك — انسخ JSON إلى خادمك', 'success');
            if (this._pfx && this._pfx.sec === 'push') this.pfRefresh();
            return this._pfPushSub;
        } catch (e) { return this.pfErr(e); }
    };
    P.pfPushUnsubscribe = async function () { const reg = await this.pfReg(); const s = reg && reg.pushManager && (await reg.pushManager.getSubscription()); if (s) await s.unsubscribe(); this._pfPushSub = null; if (this._pfx && this._pfx.sec === 'push') this.pfRefresh(); return !!s; };
    P.pfPushCopy = async function () { const reg = await this.pfReg(); const s = reg && reg.pushManager && (await reg.pushManager.getSubscription()); return this.copyText(JSON.stringify(s ? s.toJSON() : this._pfPushSub || {}, null, 2)); };
    P.pfPushSample = function () { const c = pushServerSample(this._pfPushSub); this.writeProjectFile('server/push.js', c, 'template'); this.showToast('✅ أُضيف server/push.js', 'success'); return c; };

    // ------------------------------------------------------------------ WIDGETS (#964) + ASSISTANTS (#966)
    P.pfWidgets = function () {
        const d = this.pfWidgetData();
        return card('ودجة التطبيق', `<div class="pfx-widget"><b>OX-Alpha</b><div class="pfx-widget-row"><span>${d.sessions}<small>محادثة</small></span><span>${d.tasks}<small>مهمة مفتوحة</small></span><span>${d.today}<small>رسالة اليوم</small></span></div><small>آخر محادثة: ${esc(d.last)}</small></div>
                <p class="gh-muted">على Windows 11 تظهر في لوحة الودجات بعد تثبيت التطبيق (Adaptive Card من <code>widgets/quick.json</code>) وتتحدث عند إخفاء التطبيق. على Android/iOS: اختصارات الأيقونة (ضغطة طويلة) — ${((this._pfManifest || {}).shortcuts || []).length || 7} اختصارات.</p>
                <div class="gh-row">${pbtn('fa-rotate', 'حدّث الودجة الآن', call('pfWidgetPush'))}</div>`, 'fa-table-cells-large')
            + card('مساعد Google و Siri', `<p class="gh-muted">أنشئ رابطاً عميقاً ثم أضفه كاختصار: <b>Siri</b> ← تطبيق «الاختصارات» ← إضافة إجراء «فتح عناوين URL» ثم سمِّه («اسأل أوكس»). <b>Google Assistant</b> على Android: «Hey Google, open OX-Alpha» تفتح التطبيق المثبت، وللاختصارات المخصصة استعمل Routines ← «فتح موقع».</p>
                <div class="fmx-grid2"><label class="fmx-field"><span>الإجراء</span><select id="pfx-dl-action" class="form-input-box">${ASSIST_ACTIONS.map(([a, l]) => `<option value="${a}">${esc(l)}</option>`).join('')}</select></label>${field('pfx-dl-q', 'نص (للسؤال / البحث)', '')}</div>
                <div class="gh-row">${pbtn('fa-link', 'أنشئ الرابط', call('pfDeepLinkUI'))}</div><div id="pfx-dl-out"></div>
                <p class="gh-muted">للأمان: رابط «اسأل» يملأ مربع الكتابة فقط ولا يرسل تلقائياً.</p>`, 'fa-microphone-lines');
    };
    P.pfWidgetPush = async function () {
        const data = this.pfWidgetData();
        const r = await this.pfSWPost({ type: 'WIDGET_DATA', data });
        this.showToast(r ? '✅ تم تحديث الودجة' : 'Service Worker غير نشط — ستتحدث الودجة عند النشر', r ? 'success' : 'info');
        return data;
    };
    P.pfDeepLink = function (action, q) { return deepLink(origin(), action, action === 'ask' || action === 'search' ? { q } : action === 'perf' ? { tab: q } : {}); };
    P.pfDeepLinkUI = function () {
        const url = this.pfDeepLink(val('pfx-dl-action') || 'new', val('pfx-dl-q'));
        const el = document.getElementById('pfx-dl-out');
        if (el) el.innerHTML = `<pre class="pfx-pre" dir="ltr">${esc(url)}</pre><div class="gh-row">${btn('fa-copy', 'نسخ', call('copyText', url))}<a class="sidebar-btn-util gh-btn" href="${esc(url)}" target="_blank" rel="noopener"><i class="fa-solid fa-up-right-from-square"></i> جرّب</a></div>`;
        return url;
    };

    // ------------------------------------------------------------------ SMART WATCH (#971 #972 #973)
    P.pfWatch = function () {
        const s = this.settings || {}, hr = this._pfHR;
        return card('إشعارات على الساعة', `<label class="pfx-toggle"><input type="checkbox" ${s.watchMode ? 'checked' : ''} onchange="app.pfSetWatchMode(this.checked)"> <span><b>وضع الساعة</b>: إشعارات غنية بأزرار عند اكتمال الرد والتطبيق في الخلفية</span></label>
                <p class="gh-muted">Wear OS و Apple Watch تعرض إشعارات الهاتف تلقائياً مع أزرارها: <b>⏹ إيقاف التوليد</b> • <b>🔊 اقرأ الرد</b> • <b>فتح</b> — فتتحكم في التطبيق من معصمك.</p>
                <div class="gh-row">${btn('fa-paper-plane', 'أرسل إشعار تحكم تجريبي', call('pfWatchTest'))}</div>`, 'fa-clock')
            + card('مزامنة مع الساعة / السوار (Bluetooth)', `<p class="gh-muted">يقرأ نبض القلب مباشرة من ساعة أو سوار يدعم خدمة Heart Rate القياسية عبر Web Bluetooth (Chrome على Android/سطح المكتب؛ غير مدعوم في Safari).</p>
                <div class="gh-row">${hr ? pbtn('fa-link-slash', 'قطع الاتصال', call('pfWatchDisconnect')) : pbtn('fa-link', 'اتصل بالساعة', call('pfWatchConnect'))}</div>
                <div id="pfx-hr" class="pfx-hr">${hr ? `❤️ <b>${hr.bpm || '—'}</b> نبضة/د <small>${esc(hr.name || '')}</small>` : ''}</div>`, 'fa-heart-pulse');
    };
    P.pfSetWatchMode = function (on) {
        this.pfSet('watchMode', !!on);
        if (on) { this.pfWatchApply(); this.pfPushPermission(); } else this.pfWatchApply(false);
        this.showToast(on ? '⌚ وضع الساعة مفعّل' : 'وضع الساعة متوقف', 'success');
        return !!on;
    };
    /** Route reply notifications through the SW with watch-friendly actions. */
    P.pfWatchApply = function (on = !!(this.settings && this.settings.watchMode)) {
        if (on && !this._pfDN) {
            const orig = this.desktopNotify; this._pfDN = orig;
            this.desktopNotify = function (title, body, opts = {}) {
                if (!this.settings.watchMode || (this.isDnd && this.isDnd())) return orig.apply(this, arguments);
                if (document.hidden === false && !opts.always) return false;
                this.pfNotify(title, body, { tag: opts.tag || opts.sessionId || 'ox-alpha', data: { sessionId: opts.sessionId || null }, actions: [{ action: 'speak', title: '🔊 اقرأ' }, { action: 'open', title: 'فتح' }] }).then(r => { if (!r) orig.call(this, title, body, opts); });
                return true;
            };
            // While generating, a persistent "stop" control on the watch
            const _send = this.sendUserMessage;
            if (_send && !this._pfSendW) {
                this._pfSendW = _send;
                this.sendUserMessage = async function () {
                    if (this.settings.watchMode && document.hidden) this.pfNotify('OX-Alpha يكتب…', 'اضغط إيقاف لإلغاء التوليد', { tag: 'ox-gen', actions: [{ action: 'stop', title: '⏹ إيقاف' }, { action: 'open', title: 'فتح' }] });
                    return _send.apply(this, arguments);
                };
            }
        } else if (!on && this._pfDN) {
            delete this.desktopNotify; this._pfDN = null;
            if (this._pfSendW) { delete this.sendUserMessage; this._pfSendW = null; }
        }
        return on;
    };
    P.pfWatchTest = async function () {
        if ((await this.pfPushPermission()) !== 'granted') { this.showToast('يلزم إذن الإشعارات', 'warning'); return false; }
        return this.pfNotify('OX-Alpha ⌚', 'جرّب التحكم من الساعة', { tag: 'ox-watch', actions: [{ action: 'stop', title: '⏹ إيقاف' }, { action: 'speak', title: '🔊 اقرأ' }] });
    };
    P.pfWatchConnect = async function () {
        const bt = win().navigator && win().navigator.bluetooth;
        if (!bt) { this.showToast('Web Bluetooth غير مدعوم في هذا المتصفح', 'warning'); return null; }
        try {
            const dev = await bt.requestDevice({ filters: [{ services: ['heart_rate'] }], optionalServices: ['battery_service'] });
            const server = await dev.gatt.connect();
            const ch = await (await server.getPrimaryService('heart_rate')).getCharacteristic('heart_rate_measurement');
            this._pfHR = { name: dev.name || 'جهاز', bpm: null, dev, ch, log: [] };
            ch.addEventListener('characteristicvaluechanged', (e) => {
                const bpm = parseHeartRate(e.target.value); const h = this._pfHR; if (!h) return;
                h.bpm = bpm; h.log.push({ t: Date.now(), bpm }); if (h.log.length > 600) h.log.shift();
                const el = document.getElementById('pfx-hr'); if (el) el.innerHTML = `❤️ <b>${bpm}</b> نبضة/د <small>${esc(h.name)}</small>`;
            });
            await ch.startNotifications();
            dev.addEventListener('gattserverdisconnected', () => { this._pfHR = null; const el = document.getElementById('pfx-hr'); if (el) el.textContent = 'انقطع الاتصال'; });
            this.showToast('⌚ متصل بـ ' + esc(this._pfHR.name), 'success');
            if (this._pfx && this._pfx.sec === 'watch') this.pfRefresh();
            return this._pfHR;
        } catch (e) { if (e && e.name === 'NotFoundError') return null; return this.pfErr(e); }
    };
    P.pfWatchDisconnect = function () { const h = this._pfHR; if (h && h.dev && h.dev.gatt) try { h.dev.gatt.disconnect(); } catch (e) {} this._pfHR = null; if (this._pfx && this._pfx.sec === 'watch') this.pfRefresh(); return true; };

    // ------------------------------------------------------------------ BOOT
    P.pfBootModes = function () {
        if (this.settings.watchMode) this.pfWatchApply(true);
        if (this.settings.kidsMode && this.pfKidsApply) this.pfKidsApply();
        if (this.settings.autoBrightness && this.settings.autoBrightness !== 'off' && this.pfAutoBrightness) this.pfAutoBrightness();
        if (this.settings.keepAwake && this.pfWakeLock) this.pfWakeLock(true);
        return true;
    };
}
