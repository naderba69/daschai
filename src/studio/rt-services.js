/* ==============================================================================
   Sprint 14 — runtime extension for third-party SDKs (serialised with toString, runs
   INSIDE the sandbox next to runtime.js). Self-contained: no imports, no outer names.
   Test-mode stand-ins so generated integration code runs offline:
   stripe (#991) • @sendgrid/mail (#993) • twilio (#994) • cloudinary (#995) •
   algoliasearch (#996) • @sentry/node (#997) • posthog-node (#998).
   Every outgoing message/charge is reported to the host "outbox" (Integrations hub).
   ============================================================================== */
/* eslint-disable no-var */
export function oxServicesExt(x) {
    var seq = 0;
    var id = function (p) { seq++; return p + (Date.now().toString(36) + seq.toString(36) + Math.random().toString(36).slice(2, 8)).slice(0, 24); };
    var out = function (service, kind, data) { x.send({ type: 'outbox', service: service, kind: kind, data: JSON.parse(JSON.stringify(data || {})), at: Date.now() }); };
    var reject = function (msg, type) { var e = new Error(msg); e.type = type || 'invalid_request_error'; e.statusCode = 400; return Promise.reject(e); };

    // ------------------------------------------------------------------ stripe
    function Stripe(key) {
        if (!(this instanceof Stripe)) return new Stripe(key);
        if (!key || !/^sk_(test|live)_/.test(String(key))) throw new Error('Stripe: invalid API key (expected sk_test_…)');
        var customers = {}, sessions = {}, intents = {};
        this.checkout = { sessions: {
            create: function (p) {
                p = p || {};
                if (!p.line_items || !p.line_items.length) return reject('Missing required param: line_items.');
                if (!p.success_url) return reject('Missing required param: success_url.');
                var total = 0, currency = 'usd';
                p.line_items.forEach(function (li) { var pd = li.price_data || {}; currency = pd.currency || currency; total += (pd.unit_amount || 0) * (li.quantity || 1); });
                var s = { id: id('cs_test_'), object: 'checkout.session', mode: p.mode || 'payment', amount_total: total, currency: currency, status: 'open', payment_status: 'unpaid', url: 'https://checkout.stripe.com/c/pay/mock', success_url: p.success_url, metadata: p.metadata || {} };
                sessions[s.id] = s;
                out('stripe', 'checkout.session', s);
                return Promise.resolve(s);
            },
            retrieve: function (sid) { return sessions[sid] ? Promise.resolve(sessions[sid]) : reject('No such checkout session: ' + sid); }
        } };
        this.paymentIntents = {
            create: function (p) { p = p || {}; if (!(p.amount > 0)) return reject('Missing required param: amount.'); var pi = { id: id('pi_'), object: 'payment_intent', amount: p.amount, currency: p.currency || 'usd', status: 'requires_payment_method', client_secret: id('pi_secret_') }; intents[pi.id] = pi; out('stripe', 'payment_intent', pi); return Promise.resolve(pi); },
            confirm: function (pid) { var pi = intents[pid]; if (!pi) return reject('No such payment_intent'); pi.status = 'succeeded'; out('stripe', 'payment_intent.succeeded', pi); return Promise.resolve(pi); }
        };
        this.customers = {
            create: function (p) { var c = Object.assign({ id: id('cus_'), object: 'customer' }, p || {}); customers[c.id] = c; return Promise.resolve(c); },
            retrieve: function (cid) { return customers[cid] ? Promise.resolve(customers[cid]) : reject('No such customer'); }
        };
        this.webhooks = { constructEvent: function (body) { return typeof body === 'string' ? JSON.parse(body) : body; } };
    }
    x.BUILTIN.stripe = function () { return Stripe; };

    // ------------------------------------------------------------------ @sendgrid/mail
    var sg = { key: null, setApiKey: function (k) { sg.key = k; },
        send: function (msg) {
            var list = Array.isArray(msg) ? msg : [msg];
            for (var i = 0; i < list.length; i++) {
                var m = list[i] || {};
                if (!m.to || !m.from || !(m.subject || m.templateId) || !(m.text || m.html || m.templateId)) { var e = new Error('Bad Request: to, from, subject and content are required'); e.code = 400; return Promise.reject(e); }
            }
            list.forEach(function (m) { out('sendgrid', 'email', { to: m.to, from: m.from, subject: m.subject, text: m.text, html: m.html, templateId: m.templateId }); });
            return Promise.resolve([{ statusCode: 202, headers: { 'x-message-id': id('sg_') } }, {}]);
        } };
    sg.default = sg;
    x.BUILTIN['@sendgrid/mail'] = function () { return sg; };

    // ------------------------------------------------------------------ twilio
    function twilio(sid, token) {
        if (!sid || !token) throw new Error('twilio: accountSid and authToken are required');
        return { messages: { create: function (p) {
            p = p || {};
            if (!p.to || !(p.from || p.messagingServiceSid) || !(p.body || p.mediaUrl)) { var e = new Error("Required parameter 'to', 'from' and 'body' missing."); e.status = 400; return Promise.reject(e); }
            var m = { sid: id('SM'), status: 'queued', to: p.to, from: p.from, body: p.body, dateCreated: new Date().toISOString() };
            out('twilio', /^whatsapp:/.test(p.to) ? 'whatsapp' : 'sms', m);
            return Promise.resolve(m);
        } } };
    }
    x.BUILTIN.twilio = function () { return twilio; };

    // ------------------------------------------------------------------ cloudinary
    var cloud = { config: function (c) { cloud._c = c; return c; }, uploader: { upload: function (file, opts) { var pid = (opts && opts.public_id) || id('img_'); var r = { public_id: pid, secure_url: 'https://res.cloudinary.com/demo/image/upload/' + pid + '.jpg', bytes: String(file || '').length, format: 'jpg' }; out('cloudinary', 'upload', r); return Promise.resolve(r); } },
        url: function (pid, t) { t = t || {}; var tr = [t.width && 'w_' + t.width, t.height && 'h_' + t.height, t.crop && 'c_' + t.crop, t.quality && 'q_' + t.quality, t.fetch_format && 'f_' + t.fetch_format].filter(Boolean).join(','); return 'https://res.cloudinary.com/' + ((cloud._c && cloud._c.cloud_name) || 'demo') + '/image/upload/' + (tr ? tr + '/' : '') + pid; } };
    x.BUILTIN.cloudinary = function () { return { v2: cloud }; };

    // ------------------------------------------------------------------ algoliasearch
    function algoliasearch() {
        var idx = {};
        var api = function (name) { var recs = idx[name] = idx[name] || []; return {
            saveObjects: function (objs) { objs.forEach(function (o) { var i = recs.findIndex(function (r) { return r.objectID === o.objectID; }); if (i >= 0) recs[i] = o; else recs.push(o); }); return Promise.resolve({ objectIDs: objs.map(function (o) { return o.objectID; }) }); },
            search: function (q) { var w = String(q || '').toLowerCase(); var hits = recs.filter(function (r) { return JSON.stringify(r).toLowerCase().indexOf(w) >= 0; }); return Promise.resolve({ hits: hits, nbHits: hits.length, query: q }); }
        }; };
        return { initIndex: api, searchSingleIndex: function (p) { return api(p.indexName).search(p.searchParams && p.searchParams.query); }, saveObjects: function (p) { return api(p.indexName).saveObjects(p.objects); } };
    }
    x.BUILTIN.algoliasearch = function () { return Object.assign(algoliasearch, { algoliasearch: algoliasearch }); };

    // ------------------------------------------------------------------ @sentry/node + posthog-node
    var sentry = { init: function (o) { sentry._o = o; }, captureException: function (e) { out('sentry', 'exception', { message: String((e && e.message) || e), stack: e && e.stack ? String(e.stack).split('\n').slice(0, 5).join('\n') : '' }); return id(''); }, captureMessage: function (m) { out('sentry', 'message', { message: String(m) }); return id(''); }, setUser: function () {}, setTag: function () {} };
    x.BUILTIN['@sentry/node'] = x.BUILTIN['@sentry/browser'] = function () { return sentry; };
    function PostHog() { return { capture: function (e) { out('posthog', 'event', e || {}); }, identify: function (e) { out('posthog', 'identify', e || {}); }, shutdown: function () { return Promise.resolve(); }, flush: function () { return Promise.resolve(); } }; }
    x.BUILTIN['posthog-node'] = function () { return { PostHog: PostHog }; };
}
export const rtServicesSource = '(' + oxServicesExt.toString() + ')';
