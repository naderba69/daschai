/* #991 Stripe/PayPal • #992 Auth0/Clerk • #993 SendGrid • #994 Twilio — generators + local SDK mocks (rt-services) + outbox */
import { esc, call, btn, pbtn, card, empty, field, area, select, table, stats, pre, ago } from './util.js';
import { SERVICE_FILES } from './gen.js';

// ====================================================================== pure helpers
const GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT = '^{}\\[~]|€';
/** SMS encoding + segment count (GSM-7 160/153, UCS-2 70/67 — Arabic is UCS-2). */
export function smsSegments(text) {
    const s = String(text || '');
    let gsm = true, units = 0;
    for (const ch of s) { if (GSM.includes(ch)) units++; else if (GSM_EXT.includes(ch)) units += 2; else { gsm = false; break; } }
    if (!gsm) units = [...s].reduce((n, ch) => n + (ch.codePointAt(0) > 0xffff ? 2 : 1), 0);
    const single = gsm ? 160 : 70, multi = gsm ? 153 : 67;
    const segments = units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / multi);
    return { encoding: gsm ? 'GSM-7' : 'UCS-2', units, segments, perSegment: segments > 1 ? multi : single, remaining: segments <= 1 ? single - units : segments * multi - units };
}
/** Clerk publishable key → Frontend API host (pk_test_<base64("host$")>). */
export function clerkFrontendApi(pk) {
    const m = /^pk_(test|live)_(.+)$/.exec(String(pk || '').trim());
    if (!m) return null;
    try { const host = atob(m[2].replace(/-/g, '+').replace(/_/g, '/')).replace(/\$$/, ''); return /^[\w.-]+\.[a-z]{2,}$/i.test(host) ? { env: m[1], host } : null; } catch (e) { return null; }
}
const mdInline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" style="color:#4f46e5">$1</a>');
/** Responsive, inline-styled transactional email (works in Gmail/Outlook), RTL aware. */
export function emailHtml({ title = '', body = '', cta = '', ctaUrl = '', brand = 'OX-Alpha', color = '#4f46e5', dir } = {}) {
    dir = dir || (/[\u0600-\u06FF]/.test(title + body) ? 'rtl' : 'ltr');
    const align = dir === 'rtl' ? 'right' : 'left';
    const paras = String(body).split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => `<p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#334155">${mdInline(p).replace(/\n/g, '<br>')}</p>`).join('');
    return `<!doctype html><html lang="${dir === 'rtl' ? 'ar' : 'en'}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Tahoma,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden" dir="${dir}">
<tr><td style="background:${esc(color)};padding:20px 28px;color:#fff;font-size:20px;font-weight:bold;text-align:${align}">${esc(brand)}</td></tr>
<tr><td style="padding:28px;text-align:${align}"><h1 style="margin:0 0 16px;font-size:22px;color:#0f172a">${esc(title)}</h1>${paras}
${cta && ctaUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 0"><tr><td style="background:${esc(color)};border-radius:8px"><a href="${esc(ctaUrl)}" style="display:inline-block;padding:12px 24px;color:#fff;text-decoration:none;font-weight:bold">${esc(cta)}</a></td></tr></table>` : ''}
</td></tr><tr><td style="padding:16px 28px;background:#f8fafc;color:#94a3b8;font-size:12px;text-align:${align}">© ${new Date().getFullYear()} ${esc(brand)}</td></tr></table>
</td></tr></table></body></html>`;
}
/** Plain-text alternative (spam filters like multipart mails). */
export const emailText = ({ title = '', body = '', cta = '', ctaUrl = '' } = {}) => `${title}\n\n${String(body).replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')}${cta && ctaUrl ? `\n\n${cta}: ${ctaUrl}` : ''}\n`;

export function installServices(P) {
    const runBtn = (tests, out) => pbtn('fa-vial', 'تشغيل الاختبار محلياً', `app.ixRunTests(${esc(JSON.stringify(tests))}, '${out}')`);
    P.ixService = function (name, cfg, out) {
        const gen = SERVICE_FILES[name];
        if (!gen) throw new Error('unknown service ' + name);
        const files = gen(cfg || this.ixCfg(name));
        this.ixWriteFiles(name, files, { open: false });
        const tests = Object.keys(files).filter(p => /\.test\.js$/.test(p));
        if (out) this.ixOut(out, pre(Object.keys(files).join('\n')) + (tests.length ? `<div class="gh-row">${runBtn(tests, out)}</div>` : ''));
        return files;
    };

    // ---------------------------------------------------------------- #991 payments
    P.ixPayments = async function () {
        return card('مدفوعات Stripe', `<p class="hv-dim">Checkout على الخادم (المفتاح السري لا يصل إلى المتصفح أبداً) مع زر دفع ومعالج Webhook واختبار. يعمل الاختبار هنا مباشرة لأن <code>stripe</code> له بديل محلي في وضع الاختبار يُنشئ جلسات <code>cs_test_…</code> ويسجلها في صندوق الصادر.</p>
            <div class="gh-row">${pbtn('fa-credit-card', 'توليد ملفات Stripe', "app.ixService('stripe',null,'ix-pay-res')")}</div>`, 'fa-credit-card')
            + card('PayPal', `<p class="hv-dim">أزرار PayPal الذكية (Smart Buttons) في الواجهة، والتقاط الطلب (capture) على الخادم عبر Orders v2. ضع Client ID الخاص بـ sandbox.</p>
            <div class="gh-row">${field('ix-pp-id', 'Client ID (sandbox)', this.ixCfg('paypal').clientId || '', 'dir="ltr"')}${btn('fa-wallet', 'توليد ملفات PayPal', "app.ixSave('paypal',{clientId:document.getElementById('ix-pp-id').value.trim()});app.ixService('paypal',null,'ix-pay-res')")}</div>`, 'fa-wallet')
            + '<div id="ix-pay-res"></div>';
    };

    // ---------------------------------------------------------------- #992 Auth0 / Clerk
    P.ixAuthProvCheck = async function (which) {
        if (which === 'auth0') {
            const c = this.ixSaveForm('auth0', { domain: 'ix-a0-domain', clientId: 'ix-a0-client', audience: 'ix-a0-aud' }, { toast: false });
            const d = String(c.domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
            if (!/^[\w.-]+\.(auth0\.com|[a-z]{2,})$/i.test(d)) { this.showToast('أدخل نطاق Auth0 مثل my-app.eu.auth0.com', 'warning'); return null; }
            try {
                const oidc = await this.ixHttp(`https://${d}/.well-known/openid-configuration`);
                this.ixOut('ix-ap-res', empty(`✅ مستأجر Auth0 صالح — issuer: <code>${esc(oidc.issuer)}</code>`) + stats([['طرق الدخول', (oidc.grant_types_supported || []).length], ['الخوارزميات', (oidc.id_token_signing_alg_values_supported || []).join(', ')]]));
                return oidc;
            } catch (e) { return this.ixErr(e, 'ix-ap-res'); }
        }
        const c = this.ixSaveForm('clerk', { publishableKey: 'ix-ck-pk' }, { toast: false });
        const fe = clerkFrontendApi(c.publishableKey);
        this.ixOut('ix-ap-res', fe ? empty(`✅ مفتاح Clerk صالح (${fe.env === 'test' ? 'تطوير' : 'إنتاج'}) — Frontend API: <code>${esc(fe.host)}</code>`) : empty('❌ مفتاح غير صالح: يبدأ بـ pk_test_ أو pk_live_', true));
        return fe;
    };
    P.ixAuthProv = async function () {
        const a = this.ixCfg('auth0'), k = this.ixCfg('clerk');
        return card('Auth0', `<p class="hv-dim">دخول عالمي (Universal Login) مع PKCE في الواجهة، ووسيط التحقق من JWT على الخادم.</p>
            <div class="gh-row">${field('ix-a0-domain', 'Domain', a.domain || '', 'dir="ltr" placeholder="my-app.eu.auth0.com"')}${field('ix-a0-client', 'Client ID', a.clientId || '', 'dir="ltr"')}${field('ix-a0-aud', 'API Audience', a.audience || '', 'dir="ltr"')}</div>
            <div class="gh-row">${btn('fa-stethoscope', 'تحقق من المستأجر', "app.ixAuthProvCheck('auth0')")}${pbtn('fa-file-code', 'توليد ملفات Auth0', "app.ixSaveForm('auth0',{domain:'ix-a0-domain',clientId:'ix-a0-client',audience:'ix-a0-aud'},{toast:false});app.ixService('auth0',null,'ix-ap-res')")}</div>`, 'fa-lock')
            + card('Clerk', `<p class="hv-dim">مكونات دخول جاهزة (SignIn وUserButton) وحماية مسارات Express بـ <code>@clerk/express</code>.</p>
            <div class="gh-row">${field('ix-ck-pk', 'Publishable key', k.publishableKey || '', 'dir="ltr" placeholder="pk_test_…"')}${btn('fa-stethoscope', 'تحقق من المفتاح', "app.ixAuthProvCheck('clerk')")}${pbtn('fa-file-code', 'توليد ملفات Clerk', "app.ixSaveForm('clerk',{publishableKey:'ix-ck-pk'},{toast:false});app.ixService('clerk',null,'ix-ap-res')")}</div>`, 'fa-user-check')
            + '<div id="ix-ap-res"></div>';
    };

    // ---------------------------------------------------------------- #993 SendGrid
    P.ixEmailDraft = function () {
        const v = (id) => (document.getElementById(id) || {}).value || '';
        return { title: v('ix-em-title'), body: v('ix-em-body'), cta: v('ix-em-cta'), ctaUrl: v('ix-em-url'), brand: v('ix-em-brand') || 'OX-Alpha', color: v('ix-em-color') || '#4f46e5' };
    };
    P.ixEmailPreview = function () {
        const d = this.ixEmailDraft();
        this.ixSave('email', { draft: d });
        const f = document.getElementById('ix-em-frame');
        if (f) f.srcdoc = emailHtml(d);
        return d;
    };
    P.ixEmailAI = async function () {
        const want = (document.getElementById('ix-em-title') || {}).value || 'رسالة ترحيب';
        const j = await this.ixAI(`اكتب بريداً إلكترونياً تجارياً قصيراً بالعربية بعنوان/غرض: "${want}". أعد JSON {"title":"","body":"فقرات مفصولة بسطر فارغ، يمكن **غامق**","cta":"نص الزر","ctaUrl":"https://example.com"}`, { json: true, maxTokens: 800 });
        if (!j) return null;
        ['title', 'body', 'cta', 'ctaUrl'].forEach(k => { const el = document.getElementById(k === 'ctaUrl' ? 'ix-em-url' : 'ix-em-' + k); if (el && j[k]) el.value = j[k]; });
        return this.ixEmailPreview();
    };
    P.ixEmailSave = function () {
        const d = this.ixEmailPreview();
        const slug = (d.title || 'email').toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'template';
        this.ixWriteFiles('قالب البريد', { [`email/templates/${slug}.html`]: emailHtml(d), [`email/templates/${slug}.txt`]: emailText(d) }, { open: false });
        return slug;
    };
    P.ixEmail = async function () {
        const d = this.ixCfg('email').draft || { title: 'مرحباً بك في OX-Alpha 👋', body: 'شكراً لانضمامك! حسابك جاهز الآن.\n\nابدأ أول مشروع لك في **دقيقة واحدة**.', cta: 'ابدأ الآن', ctaUrl: 'https://example.com', brand: 'OX-Alpha', color: '#4f46e5' };
        this._ixMount = () => this.ixEmailPreview();
        return card('بريد SendGrid', `<p class="hv-dim">إرسال من الخادم عبر <code>@sendgrid/mail</code> (لا يسمح SendGrid بالإرسال من المتصفح). الاختبار يعمل هنا: البديل المحلي يتحقق من الحقول ويعيد 202 ويضع الرسالة في صندوق الصادر.</p>
            <div class="gh-row">${pbtn('fa-envelope', 'توليد ملفات SendGrid', "app.ixService('sendgrid',null,'ix-em-res')")}</div><div id="ix-em-res"></div>`, 'fa-envelope')
            + card('مصمم قوالب البريد', `<div class="ix-split"><div>
                ${field('ix-em-title', 'العنوان', d.title, 'oninput="app.ixEmailPreview()"')}${area('ix-em-body', 'النص (فقرات، **غامق**، [رابط](https://…))', d.body, 6, 'oninput="app.ixEmailPreview()"')}
                <div class="gh-row">${field('ix-em-cta', 'نص الزر', d.cta, 'oninput="app.ixEmailPreview()"')}${field('ix-em-url', 'رابط الزر', d.ctaUrl, 'dir="ltr" oninput="app.ixEmailPreview()"')}</div>
                <div class="gh-row">${field('ix-em-brand', 'العلامة', d.brand, 'oninput="app.ixEmailPreview()"')}${field('ix-em-color', 'اللون', d.color, 'type="color" oninput="app.ixEmailPreview()"')}</div>
                <div class="gh-row">${btn('fa-wand-magic-sparkles', 'اكتبه بالذكاء', 'app.ixEmailAI()')}${pbtn('fa-floppy-disk', 'حفظ HTML + نص', 'app.ixEmailSave()')}</div>
            </div><iframe id="ix-em-frame" class="ix-frame" sandbox title="معاينة البريد"></iframe></div>`, 'fa-paintbrush');
    };

    // ---------------------------------------------------------------- #994 Twilio
    P.ixSmsCount = function () {
        const s = smsSegments((document.getElementById('ix-sms-text') || {}).value || '');
        this.ixOut('ix-sms-count', stats([['الترميز', s.encoding], ['الأحرف', s.units], ['الرسائل', s.segments], ['المتبقي', s.remaining]]));
        return s;
    };
    P.ixSms = async function () {
        this._ixMount = () => this.ixSmsCount();
        return card('رسائل Twilio (SMS / WhatsApp)', `<p class="hv-dim">رموز تحقق OTP وإشعارات عبر SMS أو WhatsApp من الخادم. يتحقق البديل المحلي من الحقول، ويعيد معرّف <code>SM…</code>، ويسجل الرسالة في صندوق الصادر.</p>
            <div class="gh-row">${pbtn('fa-comment-sms', 'توليد ملفات Twilio', "app.ixService('twilio',null,'ix-sms-res')")}</div><div id="ix-sms-res"></div>`, 'fa-comment-sms')
            + card('حاسبة أجزاء الرسالة', `<p class="hv-dim">الرسائل العربية تستخدم ترميز UCS-2، أي 70 حرفاً للرسالة الواحدة و67 لكل جزء عند التقسيم. كل جزء يُحاسب كرسالة مستقلة.</p>${area('ix-sms-text', 'نص الرسالة', 'رمز التحقق الخاص بك هو 482913. لا تشاركه مع أحد.', 3, 'oninput="app.ixSmsCount()"')}<div id="ix-sms-count"></div>`, 'fa-calculator');
    };

    // ---------------------------------------------------------------- outbox (everything the SDK mocks "sent")
    P.ixOutbox = async function () {
        const list = this._ixOutbox || [];
        const icon = { stripe: '💳', sendgrid: '✉️', twilio: '💬', cloudinary: '🖼', sentry: '🐞', posthog: '📊' };
        const summary = (o) => { const d = o.data || {}; return d.subject || d.body || (d.amount_total != null ? (d.amount_total / 100).toFixed(2) + ' ' + String(d.currency || '').toUpperCase() : '') || d.message || d.event || d.secure_url || ''; };
        return card('صندوق الصادر (وضع الاختبار)', `<p class="hv-dim">كل ما «أرسله» كودك عبر بدائل الخدمات المحلية أثناء التشغيل والاختبار: الرسائل، والمدفوعات، والأخطاء، والأحداث. لا يخرج أي شيء إلى الإنترنت.</p>
            <div class="gh-row">${btn('fa-trash', 'مسح', 'app._ixOutbox=[];app.ixRefresh()')}${btn('fa-rotate', 'تحديث', 'app.ixRefresh()')}</div>
            ${list.length ? `<div class="ix-scroll">${table(['', 'الخدمة', 'النوع', 'إلى', 'المحتوى', 'متى'], list.map(o => [icon[o.service] || '📤', esc(o.service), esc(o.kind), `<span dir="ltr">${esc([].concat((o.data || {}).to || '').map(t => (t && t.email) || t).join(', '))}</span>`, esc(String(summary(o)).slice(0, 80)), esc(ago(o.at))]))}</div>` : empty('فارغ — شغّل أحد اختبارات الخدمات (Stripe أو SendGrid أو Twilio)')}`, 'fa-inbox');
    };
}
