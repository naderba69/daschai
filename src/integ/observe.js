/* #997 Sentry (errors) • #998 PostHog (product analytics) — opt-in, reports OX-Alpha's own errors/usage to YOUR projects + snippets for your apps */
import { esc, btn, pbtn, card, empty, field, toggle, table, stats, pre, ago } from './util.js';

// ====================================================================== pure helpers
/** https://KEY@HOST/PROJECT → {key, host, projectId, envelope} */
export function parseDsn(dsn) {
    const m = /^(https?):\/\/([^@/]+)@([^/]+)\/(?:(.*)\/)?(\d+)\/?$/.exec(String(dsn || '').trim());
    if (!m) return null;
    const [, proto, key, host, path, projectId] = m;
    return { key, host, projectId, envelope: `${proto}://${host}/${path ? path + '/' : ''}api/${projectId}/envelope/?sentry_key=${encodeURIComponent(key)}&sentry_version=7&sentry_client=ox-alpha%2F1.0` };
}
/** Chrome/Firefox/Safari stack → Sentry frames (oldest first). */
export function parseStack(stack) {
    const frames = [];
    String(stack || '').split('\n').forEach(l => {
        let m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(l);
        if (m) { frames.push({ function: m[1] || '?', filename: m[2], lineno: +m[3], colno: +m[4] }); return; }
        m = /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/.exec(l);
        if (m) frames.push({ function: m[1] || '?', filename: m[2], lineno: +m[3], colno: +m[4] });
    });
    return frames.map(f => ({ ...f, in_app: !/(^|\/)(node_modules|cdn|cdnjs|jsdelivr)\b/.test(f.filename) })).reverse();
}
const hex32 = () => Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
export function sentryEvent(err, { release = '', environment = 'production', tags = {}, user, url = '', level = 'error', breadcrumbs = [] } = {}) {
    const e = err instanceof Error ? err : { name: 'Error', message: String((err && err.message) || err), stack: err && err.stack };
    return { event_id: hex32(), timestamp: Date.now() / 1000, platform: 'javascript', level, release, environment, tags, user, request: url ? { url } : undefined, breadcrumbs: breadcrumbs.length ? { values: breadcrumbs } : undefined, exception: { values: [{ type: e.name || 'Error', value: String(e.message || ''), stacktrace: { frames: parseStack(e.stack) } }] } };
}
export const sentryEnvelope = (event, dsn) => `${JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString(), dsn })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`;
/** PostHog batch body. */
export function phBatch(apiKey, events, distinctId) {
    return { api_key: apiKey, batch: events.map(e => ({ event: e.event, distinct_id: distinctId, timestamp: new Date(e.at || Date.now()).toISOString(), properties: { $lib: 'ox-alpha', ...(e.properties || {}) } })) };
}
/** Generated snippets for the user's own app. */
export function observeFiles(kind, c = {}) {
    if (kind === 'sentry') return {
        'monitoring/sentry-browser.html': `<!-- Sentry for the browser: paste in <head> before your scripts -->\n<script src="https://browser.sentry-cdn.com/8.33.0/bundle.tracing.min.js" crossorigin="anonymous"></script>\n<script>\n  Sentry.init({\n    dsn: '${c.dsn || 'https://PUBLIC_KEY@o0.ingest.sentry.io/0'}',\n    release: 'my-app@1.0.0',\n    tracesSampleRate: 0.2,\n    integrations: [Sentry.browserTracingIntegration()]\n  });\n</script>\n`,
        'monitoring/sentry-server.js': `// Sentry for Node/Express. npm i @sentry/node\nconst Sentry = require('@sentry/node');\nSentry.init({ dsn: (typeof process !== 'undefined' && process.env.SENTRY_DSN) || '${c.dsn || ''}', tracesSampleRate: 0.2 });\n\n/** Express error handler: report then answer 500. */\nfunction sentryErrorHandler(err, req, res, next) {\n    const id = Sentry.captureException(err);\n    res.status(500).json({ error: 'Internal error', id });\n}\nfunction safely(fn) { try { return fn(); } catch (e) { Sentry.captureException(e); return null; } }\nmodule.exports = { Sentry, sentryErrorHandler, safely };\n`,
        'monitoring/sentry.test.js': `const { safely, Sentry } = require('./sentry-server.js');\n\ntest('reports thrown errors and keeps running', () => {\n    expect(safely(() => { throw new Error('boom'); })).toBe(null);\n    expect(typeof Sentry.captureMessage('hello')).toBe('string');\n});\n`
    };
    return {
        'analytics/posthog.html': `<!-- PostHog: paste before </head> -->\n<script>\n  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);\n  posthog.init('${c.key || 'phc_YOUR_PROJECT_KEY'}', { api_host: '${c.host || 'https://us.i.posthog.com'}', person_profiles: 'identified_only' });\n</script>\n`,
        'analytics/track-server.js': `// Server-side events. npm i posthog-node\nconst { PostHog } = require('posthog-node');\nconst client = new PostHog((typeof process !== 'undefined' && process.env.POSTHOG_KEY) || '${c.key || 'phc_key'}', { host: '${c.host || 'https://us.i.posthog.com'}' });\n\nfunction track(userId, event, properties = {}) { client.capture({ distinctId: String(userId), event, properties }); }\nmodule.exports = { track, client };\n`
    };
}

export function installObserve(P) {
    // ---------------------------------------------------------------- #997 Sentry
    P.ixSentrySend = async function (err, extra = {}) {
        const c = this.ixCfg('sentry'), d = parseDsn(c.dsn);
        if (!d) return null;
        const ev = sentryEvent(err, { release: 'ox-alpha@' + ((window.OX_BUILD || {}).version || ''), environment: c.env || 'production', tags: { lang: document.documentElement.lang || 'ar', ...extra.tags }, url: location.href.split('#')[0].split('?')[0], level: extra.level || 'error', breadcrumbs: (this._ixCrumbs || []).slice(-20) });
        try {
            await fetch(d.envelope, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: sentryEnvelope(ev, c.dsn) });
            const log = [{ id: ev.event_id, msg: ev.exception.values[0].value, at: Date.now() }, ...(c.log || [])].slice(0, 30);
            this.ixSave('sentry', { log });
            return ev.event_id;
        } catch (e) { return null; }
    };
    P.ixSentryInstall = function () {
        if (this._ixSentryOn) return false;
        this._ixSentryOn = true;
        const seen = new Set();
        let count = 0;
        const report = (err, tags) => { const k = String((err && err.message) || err).slice(0, 200); if (seen.has(k) || count >= 25) return; seen.add(k); count++; this.ixSentrySend(err, { tags }); };
        window.addEventListener('error', (e) => { if (this.ixCfg('sentry').dsn) report(e.error || e.message, { mechanism: 'onerror' }); });
        window.addEventListener('unhandledrejection', (e) => { if (this.ixCfg('sentry').dsn) report(e.reason instanceof Error ? e.reason : new Error(String(e.reason)), { mechanism: 'unhandledrejection' }); });
        this._ixCrumbs = [];
        const _toast = this.showToast;
        this.showToast = function (msg, type) { try { this._ixCrumbs.push({ timestamp: Date.now() / 1000, category: 'ui.toast', level: type === 'error' ? 'error' : 'info', message: String(msg).replace(/<[^>]+>/g, '').slice(0, 200) }); if (this._ixCrumbs.length > 40) this._ixCrumbs.shift(); } catch (e) { /* ignore */ } return _toast.apply(this, arguments); };
        return true;
    };
    P._ixBootFns.sentry = function () { this.ixSentryInstall(); };
    P.ixSentrySave = function () {
        const c = this.ixSaveForm('sentry', { dsn: 'ix-se-dsn', env: 'ix-se-env', on: 'ix-se-on' });
        if (c.dsn && !parseDsn(c.dsn)) { this.showToast('DSN غير صالح', 'warning'); return null; }
        this.ixBootSet('sentry', !!(c.on && c.dsn));
        if (c.on && c.dsn) this.ixSentryInstall();
        return c;
    };
    P.ixSentry = async function () {
        const c = this.ixCfg('sentry');
        return card('Sentry: تتبع الأخطاء', `<p class="hv-dim">عند التفعيل تُرسل أخطاء OX-Alpha غير المعالجة إلى مشروعك في Sentry، مع تتبع المكدس (Stack trace) وآخر 20 حدثاً في الواجهة. تُرسل مباشرة إلى Sentry دون أي وسيط، وبحد أقصى 25 خطأ مختلفاً في الجلسة. ويمكنك أيضاً توليد إعداد Sentry لمشاريعك.</p>
            <div class="gh-row">${field('ix-se-dsn', 'DSN', c.dsn || '', 'dir="ltr" placeholder="https://key@o123.ingest.sentry.io/456"')}${field('ix-se-env', 'البيئة', c.env || 'production', 'dir="ltr"')}${toggle('ix-se-on', 'إرسال أخطاء OX-Alpha', !!c.on)}</div>
            <div class="gh-row">${pbtn('fa-floppy-disk', 'حفظ', 'app.ixSentrySave()')}${btn('fa-bug', 'إرسال خطأ تجريبي', "app.ixSentrySend(new Error('OX-Alpha test error')).then(id=>{app.showToast(id?'🐞 أُرسل: '+id:'❌ تحقق من DSN',id?'success':'error');app.ixRefresh()})")}${btn('fa-file-code', 'توليد إعداد Sentry لمشروعك', "app.ixWriteFiles('Sentry', app.ixObserveFiles('sentry'))")}</div>`, 'fa-bug')
            + card('آخر الأخطاء المرسلة', (c.log || []).length ? table(['المعرّف', 'الرسالة', 'متى'], c.log.map(l => [`<code>${esc(l.id.slice(0, 8))}</code>`, esc(l.msg), esc(ago(l.at))])) : empty('لا شيء بعد'), 'fa-list');
    };
    P.ixObserveFiles = function (kind) { return observeFiles(kind, this.ixCfg(kind)); };

    // ---------------------------------------------------------------- #998 PostHog
    P.ixPhId = function () { let id = localStorage.getItem('ox_ph_id'); if (!id) { id = 'ox_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); localStorage.setItem('ox_ph_id', id); } return id; };
    P.ixPh = function (event, properties = {}) {
        const c = this.ixCfg('posthog');
        if (!c.key) return false;
        (this._ixPhQ = this._ixPhQ || []).push({ event, properties: { $current_url: location.origin + location.pathname, ...properties }, at: Date.now() });
        clearTimeout(this._ixPhT);
        this._ixPhT = setTimeout(() => this.ixPhFlush(), this._ixPhQ.length >= 20 ? 0 : 8000);
        return true;
    };
    P.ixPhFlush = async function () {
        const c = this.ixCfg('posthog'), q = this._ixPhQ || [];
        if (!c.key || !q.length) return 0;
        this._ixPhQ = [];
        const body = JSON.stringify(phBatch(c.key, q, this.ixPhId()));
        try { await fetch((c.host || 'https://us.i.posthog.com').replace(/\/+$/, '') + '/batch/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }); this.ixSave('posthog', { sent: (c.sent || 0) + q.length, last: Date.now() }); return q.length; } catch (e) { return 0; }
    };
    P.ixPhInstall = function () {
        if (this._ixPhOn) return false;
        this._ixPhOn = true;
        this.ixPh('$pageview', { app_version: (window.OX_BUILD || {}).version || '' });
        const proto = Object.getPrototypeOf(this);
        if (proto.pfTrack && !proto.pfTrack.__ixPh) {
            const orig = proto.pfTrack;
            const w = function (key) { try { if (this.ixCfg('posthog').on) this.ixPh('ox_' + String(key).split(':')[0], { feature: String(key) }); } catch (e) { /* ignore */ } return orig.apply(this, arguments); };
            w.__ixPh = true;
            proto.pfTrack = w;
        }
        window.addEventListener('pagehide', () => this.ixPhFlush());
        return true;
    };
    P._ixBootFns.posthog = function () { this.ixPhInstall(); };
    P.ixPhSave = function () {
        const c = this.ixSaveForm('posthog', { key: 'ix-ph-key', host: 'ix-ph-host', on: 'ix-ph-on' });
        this.ixBootSet('posthog', !!(c.on && c.key));
        if (c.on && c.key) this.ixPhInstall();
        return c;
    };
    P.ixPosthog = async function () {
        const c = this.ixCfg('posthog');
        return card('PostHog: تحليلات المنتج', `<p class="hv-dim">عند التفعيل تُرسل أحداث استخدام OX-Alpha (فتح الأقسام والميزات) إلى مشروعك في PostHog بمعرّف مجهول، على دفعات كل 8 ثوانٍ، دون إرسال أي محتوى أو كود. ويمكنك أيضاً توليد كود PostHog لمواقعك وخوادمك.</p>
            <div class="gh-row">${field('ix-ph-key', 'Project API key', c.key || '', 'dir="ltr" placeholder="phc_…"')}${field('ix-ph-host', 'Host', c.host || 'https://us.i.posthog.com', 'dir="ltr"')}${toggle('ix-ph-on', 'إرسال استخدام OX-Alpha', !!c.on)}</div>
            <div class="gh-row">${pbtn('fa-floppy-disk', 'حفظ', 'app.ixPhSave()')}${btn('fa-paper-plane', 'حدث تجريبي', "app.ixPh('ox_test',{ok:true});app.ixPhFlush().then(n=>app.showToast(n?'📊 أُرسل':'❌ تحقق من المفتاح',n?'success':'error'))")}${btn('fa-file-code', 'توليد كود PostHog لمشروعك', "app.ixWriteFiles('PostHog', app.ixObserveFiles('posthog'))")}</div>
            ${stats([['أحداث مرسلة', c.sent || 0], ['في الانتظار', (this._ixPhQ || []).length], ['آخر إرسال', c.last ? ago(c.last) : '—']])}`, 'fa-chart-line');
    };
}
