/* #165 E2E tests with a Playwright-compatible API inside the browser.
   e2eExt  — runtime extension (serialised into the sandbox): registers the `@playwright/test` builtin whose page/locator
             proxies send { type:'e2e', id, op, args } to the host and await 'e2e-res'. Matchers poll (100 ms, 5 s).
   e2eOps  — pure DOM driver (serialised into the preview iframe; also usable directly with jsdom).
   No `evaluate`: the page CSP forbids eval — everything is expressed as locator operations. */

/** Runtime extension. Must stay self-contained (serialised with toString). */
export function e2eExt(x) {
    var seq = 0, waits = {};
    var ST = x.sT || setTimeout;
    var T = x.T;
    x.onMessage(function (m) {
        if (!m || m.type !== 'e2e-res' || !waits[m.id]) return;
        var w = waits[m.id]; delete waits[m.id];
        if (m.ok) w.res(m.value); else { var e = new Error(m.error || 'E2E error'); e.code = m.code; w.rej(e); }
    });
    var rpc = function (op, args) { return new Promise(function (res, rej) { var id = ++seq; waits[id] = { res: res, rej: rej }; x.send({ type: 'e2e', id: id, op: op, args: args || {} }); }); };
    var sleep = function (ms) { return new Promise(function (r) { ST(r, ms); }); };
    var spec = function (v) { return v instanceof RegExp ? { re: v.source, f: v.flags } : v == null ? null : { s: String(v) }; };
    var TIMEOUT = 5000;
    var retry = function (fn, timeout) {
        var t0 = Date.now(), lim = timeout || TIMEOUT;
        var attempt = function () { return fn().then(null, function (e) { if (e && e.code === 'E_NOTFOUND' && Date.now() - t0 < lim) return sleep(100).then(attempt); if (e && e.code === 'E_NOTFOUND') e.message = 'Timeout ' + lim + 'ms: ' + e.message; throw e; }); };
        return attempt();
    };
    var optT = function (a, b) { var o = (b && typeof b === 'object') ? b : (a && typeof a === 'object' && !Array.isArray(a)) ? a : null; return o && o.timeout; };
    var state = function (steps, attr) { return rpc('state', { steps: steps, attr: attr }).then(null, function (e) { if (e && e.code === 'E_NOTFOUND') return { count: 0, texts: [] }; throw e; }); };

    function Locator(steps, desc) { this.__e2e = 'locator'; this.steps = steps; this.desc = desc || ''; }
    var L = Locator.prototype;
    var add = function (self, step, d) { return new Locator(self.steps.concat([step]), (self.desc ? self.desc + ' >> ' : '') + d); };
    L.toString = function () { return 'locator(' + this.desc + ')'; };
    L.locator = function (sel, o) { var n = add(this, { k: 'css', v: String(sel) }, String(sel)); return o && (o.hasText != null || o.hasNotText != null) ? n.filter(o) : n; };
    L.getByRole = function (role, o) { o = o || {}; return add(this, { k: 'role', role: role, name: spec(o.name), exact: !!o.exact, level: o.level, checked: o.checked, includeHidden: !!o.includeHidden }, 'role=' + role + (o.name != null ? '[name=' + String(o.name) + ']' : '')); };
    L.getByText = function (t, o) { return add(this, { k: 'text', m: spec(t), exact: !!(o && o.exact) }, 'text=' + String(t)); };
    L.getByLabel = function (t, o) { return add(this, { k: 'label', m: spec(t), exact: !!(o && o.exact) }, 'label=' + String(t)); };
    L.getByPlaceholder = function (t, o) { return add(this, { k: 'placeholder', m: spec(t), exact: !!(o && o.exact) }, 'placeholder=' + String(t)); };
    L.getByAltText = function (t, o) { return add(this, { k: 'alt', m: spec(t), exact: !!(o && o.exact) }, 'alt=' + String(t)); };
    L.getByTitle = function (t, o) { return add(this, { k: 'title', m: spec(t), exact: !!(o && o.exact) }, 'title=' + String(t)); };
    L.getByTestId = function (id) { return add(this, { k: 'testid', v: String(id) }, 'testid=' + id); };
    L.first = function () { return add(this, { k: 'nth', n: 0 }, 'first'); };
    L.last = function () { return add(this, { k: 'nth', n: -1 }, 'last'); };
    L.nth = function (i) { return add(this, { k: 'nth', n: i }, 'nth=' + i); };
    L.filter = function (o) { o = o || {}; return add(this, { k: 'filter', has: spec(o.hasText), not: spec(o.hasNotText) }, 'filter'); };
    var act = function (action) {
        return function (value, opts) {
            var self = this;
            return retry(function () { return rpc('act', { steps: self.steps, action: action, value: value && typeof value === 'object' && !Array.isArray(value) && action !== 'selectOption' ? undefined : value }); }, optT(value, opts)).then(function () { return undefined; }, function (e) { e.message = self.toString() + '.' + action + '(): ' + e.message; throw e; });
        };
    };
    ['click', 'dblclick', 'fill', 'type', 'pressSequentially', 'press', 'check', 'uncheck', 'setChecked', 'selectOption', 'hover', 'focus', 'blur', 'clear', 'tap'].forEach(function (a) { L[a] = act(a); });
    var need = function (self, pick, o) { return retry(function () { return state(self.steps, o && o.attr).then(function (s) { if (!s.count) { var e = new Error('لم يُعثر على العنصر ' + self.toString()); e.code = 'E_NOTFOUND'; throw e; } return pick(s); }); }, o && o.timeout); };
    L.textContent = function (o) { return need(this, function (s) { return s.raw; }, o); };
    L.innerText = function (o) { return need(this, function (s) { return s.text; }, o); };
    L.innerHTML = function (o) { return need(this, function (s) { return s.html; }, o); };
    L.inputValue = function (o) { return need(this, function (s) { return s.value; }, o); };
    L.getAttribute = function (n, o) { return need(this, function (s) { return s.attr; }, { attr: n, timeout: o && o.timeout }); };
    L.count = function () { return state(this.steps).then(function (s) { return s.count; }); };
    L.isVisible = function () { return state(this.steps).then(function (s) { return !!s.visible; }); };
    L.isHidden = function () { return state(this.steps).then(function (s) { return !s.visible; }); };
    L.isChecked = function (o) { return need(this, function (s) { return !!s.checked; }, o); };
    L.isEnabled = function (o) { return need(this, function (s) { return !!s.enabled; }, o); };
    L.isDisabled = function (o) { return need(this, function (s) { return !s.enabled; }, o); };
    L.isEditable = function (o) { return need(this, function (s) { return !!s.editable; }, o); };
    L.allTextContents = function () { return state(this.steps).then(function (s) { return s.raws || []; }); };
    L.allInnerTexts = function () { return state(this.steps).then(function (s) { return s.texts || []; }); };
    L.all = function () { var self = this; return state(this.steps).then(function (s) { var a = []; for (var i = 0; i < s.count; i++) a.push(self.nth(i)); return a; }); };
    L.waitFor = function (o) {
        var self = this, want = (o && o.state) || 'visible', t0 = Date.now(), lim = (o && o.timeout) || TIMEOUT;
        var ok = function (s) { return want === 'attached' ? s.count > 0 : want === 'detached' ? !s.count : want === 'hidden' ? !s.visible : !!s.visible; };
        var loop = function () { return state(self.steps).then(function (s) { if (ok(s)) return undefined; if (Date.now() - t0 > lim) throw new Error('Timeout ' + lim + 'ms: ' + self.toString() + ' لم يصبح ' + want); return sleep(100).then(loop); }); };
        return loop();
    };
    L.evaluate = L.evaluateAll = function () { return Promise.reject(new Error('evaluate غير مدعوم داخل المتصفح (CSP) — استخدم المحددات والمطابقات')); };
    L.screenshot = function () { return Promise.resolve(null); };
    L.scrollIntoViewIfNeeded = function () { return Promise.resolve(); };

    var root = new Locator([], '');
    var lastURL = '/';
    var page = {
        __e2e: 'page',
        goto: function (url) { return rpc('goto', { url: String(url || '/') }).then(function (r) { lastURL = (r && r.url) || url; return { ok: function () { return true; }, status: function () { return 200; }, url: function () { return lastURL; } }; }); },
        reload: function () { return rpc('reload', {}).then(function () { return null; }); },
        title: function () { return rpc('page', {}).then(function (s) { return s.title; }); },
        url: function () { return lastURL; },
        content: function () { return rpc('page', {}).then(function (s) { return s.html; }); },
        waitForTimeout: function (ms) { return sleep(ms); },
        waitForLoadState: function () { return Promise.resolve(); },
        waitForURL: function (u, o) { var t0 = Date.now(), lim = (o && o.timeout) || TIMEOUT; var loop = function () { return rpc('page', {}).then(function (s) { lastURL = s.url; if (u instanceof RegExp ? u.test(s.url) : String(s.url).indexOf(String(u).replace(/^https?:\/\/[^/]+/, '')) >= 0) return undefined; if (Date.now() - t0 > lim) throw new Error('Timeout: waitForURL ' + u); return sleep(100).then(loop); }); }; return loop(); },
        waitForSelector: function (sel, o) { return root.locator(sel).waitFor(o); },
        setViewportSize: function (v) { return rpc('viewport', v || {}); },
        evaluate: L.evaluate,
        screenshot: function () { return Promise.resolve(null); },
        on: function () {}, close: function () { return Promise.resolve(); },
        keyboard: {
            press: function (k) { return rpc('act', { steps: [{ k: 'focused' }], action: 'press', value: k }); },
            type: function (t) { return rpc('act', { steps: [{ k: 'focused' }], action: 'type', value: t }); },
            insertText: function (t) { return rpc('act', { steps: [{ k: 'focused' }], action: 'type', value: t }); }
        },
        mouse: { click: function () { return Promise.reject(new Error('mouse.click بالإحداثيات غير مدعوم — استخدم locator.click()')); } }
    };
    ['locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByAltText', 'getByTitle', 'getByTestId'].forEach(function (k) { page[k] = function () { return L[k].apply(root, arguments); }; });
    ['click', 'dblclick', 'fill', 'type', 'press', 'check', 'uncheck', 'selectOption', 'hover', 'focus', 'textContent', 'innerText', 'innerHTML', 'inputValue', 'getAttribute', 'isVisible', 'isHidden', 'isChecked', 'isEnabled', 'isDisabled'].forEach(function (k) {
        page[k] = function (sel) { var l = root.locator(sel); return l[k].apply(l, Array.prototype.slice.call(arguments, 1)); };
    });
    page.$ = function (sel) { var l = root.locator(sel); return l.count().then(function (n) { return n ? l.first() : null; }); };
    page.$$ = function (sel) { return root.locator(sel).all(); };
    var context = { pages: function () { return [page]; }, newPage: function () { return Promise.resolve(page); }, close: function () { return Promise.resolve(); } };
    var request = {
        get: function (u, o) { return x.fetch(u, o).then(wrapRes); },
        post: function (u, o) { o = o || {}; return x.fetch(u, { method: 'POST', headers: o.headers || { 'Content-Type': 'application/json' }, body: o.data != null ? (typeof o.data === 'string' ? o.data : JSON.stringify(o.data)) : o.body }).then(wrapRes); }
    };
    function wrapRes(r) { return { ok: function () { return r.ok; }, status: function () { return r.status; }, json: function () { return r.json(); }, text: function () { return r.text(); }, headers: function () { return r.headers; } }; }

    // ---------------------------------------------------------------- expect
    var norm = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); };
    var same = function (exp, got, contain) {
        if (exp instanceof RegExp) return exp.test(String(got == null ? '' : got));
        return contain ? norm(got).indexOf(norm(exp)) >= 0 : norm(got) === norm(exp);
    };
    var fmtV = function (v) { return v instanceof RegExp ? String(v) : JSON.stringify(v); };
    function AErr(msg, exp, got) { var e = new Error(msg); e.name = 'AssertionError'; if (exp !== undefined) e.expected = fmtV(exp); if (got !== undefined) e.received = fmtV(got); return e; }
    function e2eMatchers(target, negate, timeout) {
        var isPage = target.__e2e === 'page';
        var lim = timeout || TIMEOUT;
        var poll = function (name, attr, test, describe) {
            return function () {
                var args = Array.prototype.slice.call(arguments);
                var o = args[args.length - 1] && typeof args[args.length - 1] === 'object' && !(args[args.length - 1] instanceof RegExp) && !Array.isArray(args[args.length - 1]) ? args[args.length - 1] : null;
                var lim2 = (o && o.timeout) || lim, t0 = Date.now(), last = null;
                var fetch = function () { return isPage ? rpc('page', {}).then(null, function () { return {}; }) : state(target.steps, attr ? attr(args) : undefined); };
                var loop = function () {
                    return fetch().then(function (s) {
                        last = s;
                        if (!!test(s, args) !== negate) return undefined;
                        if (Date.now() - t0 >= lim2) { var d = describe(s, args); throw AErr((negate ? 'expect.not.' : 'expect.') + name + ' — ' + (isPage ? 'page' : target.toString()) + ': ' + d.msg + ' (بعد ' + lim2 + 'ms)', d.exp, d.got); }
                        return sleep(100).then(loop);
                    });
                };
                return loop();
            };
        };
        var m = {};
        m.toHaveText = poll('toHaveText', null, function (s, a) { var e = a[0]; if (Array.isArray(e)) return s.texts && s.texts.length === e.length && e.every(function (v, i) { return same(v, s.texts[i]); }); return s.count > 0 && same(e, s.text, a[1] && a[1].useInnerText === false); }, function (s, a) { return { msg: 'النص غير مطابق', exp: a[0], got: Array.isArray(a[0]) ? s.texts : s.count ? s.text : '(لا يوجد عنصر)' }; });
        m.toContainText = poll('toContainText', null, function (s, a) { var e = a[0]; if (Array.isArray(e)) return e.every(function (v) { return (s.texts || []).some(function (t) { return same(v, t, true); }); }); return s.count > 0 && same(e, s.text, true); }, function (s, a) { return { msg: 'لا يحتوي النص المتوقع', exp: a[0], got: s.count ? s.text : '(لا يوجد عنصر)' }; });
        m.toHaveValue = poll('toHaveValue', null, function (s, a) { return s.count > 0 && (a[0] instanceof RegExp ? a[0].test(s.value) : String(s.value) === String(a[0])); }, function (s, a) { return { msg: 'القيمة غير مطابقة', exp: a[0], got: s.value }; });
        m.toHaveAttribute = poll('toHaveAttribute', function (a) { return a[0]; }, function (s, a) { return s.count > 0 && s.attr != null && (a.length < 2 || (a[1] && typeof a[1] === 'object' && !(a[1] instanceof RegExp)) || (a[1] instanceof RegExp ? a[1].test(s.attr) : s.attr === String(a[1]))); }, function (s, a) { return { msg: 'السمة ' + a[0], exp: a[1], got: s.attr }; });
        m.toHaveCount = poll('toHaveCount', null, function (s, a) { return s.count === a[0]; }, function (s, a) { return { msg: 'العدد', exp: a[0], got: s.count }; });
        m.toBeVisible = poll('toBeVisible', null, function (s) { return !!s.visible; }, function (s) { return { msg: s.count ? 'العنصر مخفي' : 'لا يوجد عنصر' }; });
        m.toBeHidden = poll('toBeHidden', null, function (s) { return !s.visible; }, function () { return { msg: 'العنصر ظاهر' }; });
        m.toBeAttached = poll('toBeAttached', null, function (s) { return s.count > 0; }, function () { return { msg: 'لا يوجد عنصر' }; });
        m.toBeChecked = poll('toBeChecked', null, function (s, a) { return s.count > 0 && !!s.checked === !(a[0] && a[0].checked === false); }, function (s) { return { msg: 'حالة التحديد', got: s.checked }; });
        m.toBeEnabled = poll('toBeEnabled', null, function (s) { return s.count > 0 && !!s.enabled; }, function () { return { msg: 'العنصر معطّل' }; });
        m.toBeDisabled = poll('toBeDisabled', null, function (s) { return s.count > 0 && !s.enabled; }, function () { return { msg: 'العنصر مفعّل' }; });
        m.toBeEditable = poll('toBeEditable', null, function (s) { return s.count > 0 && !!s.editable; }, function () { return { msg: 'غير قابل للتحرير' }; });
        m.toBeFocused = poll('toBeFocused', null, function (s) { return !!s.focused; }, function () { return { msg: 'العنصر ليس في التركيز' }; });
        m.toBeEmpty = poll('toBeEmpty', null, function (s) { return s.count > 0 && !!s.empty; }, function (s) { return { msg: 'العنصر ليس فارغاً', got: s.text }; });
        m.toHaveClass = poll('toHaveClass', null, function (s, a) { return s.count > 0 && (a[0] instanceof RegExp ? a[0].test(s.cls) : norm(s.cls) === norm(a[0])); }, function (s, a) { return { msg: 'الأصناف', exp: a[0], got: s.cls }; });
        m.toContainClass = poll('toContainClass', null, function (s, a) { return s.count > 0 && String(a[0]).split(/\s+/).every(function (c) { return (' ' + norm(s.cls) + ' ').indexOf(' ' + c + ' ') >= 0; }); }, function (s, a) { return { msg: 'الأصناف', exp: a[0], got: s.cls }; });
        m.toHaveId = poll('toHaveId', null, function (s, a) { return s.count > 0 && (a[0] instanceof RegExp ? a[0].test(s.id) : s.id === String(a[0])); }, function (s, a) { return { msg: 'المعرّف', exp: a[0], got: s.id }; });
        m.toHaveTitle = poll('toHaveTitle', null, function (s, a) { return same(a[0], s.title, false); }, function (s, a) { return { msg: 'عنوان الصفحة', exp: a[0], got: s.title }; });
        m.toHaveURL = poll('toHaveURL', null, function (s, a) { lastURL = s.url || lastURL; return a[0] instanceof RegExp ? a[0].test(s.url) : String(s.url) === String(a[0]).replace(/^https?:\/\/[^/]+/, '') || String(s.url).replace(/\/index\.html?$/, '/') === String(a[0]).replace(/^https?:\/\/[^/]+/, ''); }, function (s, a) { return { msg: 'الرابط', exp: a[0], got: s.url }; });
        m.toHaveScreenshot = function () { return Promise.resolve(); };
        return m;
    }
    function expect(v, msgOrOpts) {
        var timeout = msgOrOpts && typeof msgOrOpts === 'object' ? msgOrOpts.timeout : undefined;
        if (v && (v.__e2e === 'locator' || v.__e2e === 'page')) {
            var pos = e2eMatchers(v, false, timeout || expect._timeout);
            pos.not = e2eMatchers(v, true, timeout || expect._timeout);
            return pos;
        }
        return T.expect(v);
    }
    expect.soft = expect;
    expect.configure = function (o) { var e = function (v, m) { return expect(v, m || o); }; e.soft = e; e.poll = expect.poll; e._timeout = o && o.timeout; return e; };
    expect.poll = function (fn, o) {
        var lim = (o && o.timeout) || TIMEOUT, probe = T.expect(0), out = {};
        var make = function (negate) {
            var r = {};
            Object.keys(probe).forEach(function (k) {
                if (typeof probe[k] !== 'function') return;
                r[k] = function () {
                    var args = arguments, t0 = Date.now();
                    var loop = function () { return Promise.resolve().then(fn).then(function (v) { var e = T.expect(v); (negate ? e.not : e)[k].apply(null, args); }).then(null, function (err) { if (Date.now() - t0 >= lim) throw err; return sleep(100).then(loop); }); };
                    return loop();
                };
            });
            return r;
        };
        out = make(false); out.not = make(true);
        return out;
    };
    Object.keys(T.expect).forEach(function (k) { if (!(k in expect)) expect[k] = T.expect[k]; });

    // ---------------------------------------------------------------- test()
    var fixtures = function () { return { page: page, context: context, request: request, browserName: 'chromium', baseURL: '/' }; };
    var wrap = function (fn) {
        return function () {
            return Promise.resolve().then(function () { return fn(fixtures(), { title: T.current }); }).then(null, function (err) {
                return rpc('page', {}).then(function (s) { x.send({ type: 'e2e-fail', test: T.current, file: T.currentFile, url: s.url, title: s.title, html: s.html, error: String(err && err.message || err) }); throw err; }, function () { throw err; });
            });
        };
    };
    var hook = function (fn) { return function () { return fn(fixtures(), { title: T.current }); }; };
    function test(name, a, b) { var fn = typeof a === 'function' ? a : b; T.it(name, wrap(fn), 30000); }
    test.only = function (name, a, b) { var fn = typeof a === 'function' ? a : b; T.it.only(name, wrap(fn), 30000); };
    test.skip = function (name, fn) { if (typeof name === 'string' && typeof fn === 'function') T.it.skip(name); };
    test.fixme = test.skip;
    test.fail = test.skip;
    test.slow = test.setTimeout = test.use = test.info = test.configure = function () { return { title: T.current }; };
    test.describe = function (name, a, b) { T.describe(name, typeof a === 'function' ? a : b); };
    test.describe.only = function (name, fn) { T.describe.only(name, fn); };
    test.describe.skip = function (name) { T.describe.skip(name); };
    test.describe.serial = test.describe.parallel = test.describe;
    test.describe.configure = function () {};
    test.beforeEach = function (fn) { T.beforeEach(hook(fn)); };
    test.afterEach = function (fn) { T.afterEach(hook(fn)); };
    test.beforeAll = function (fn) { T.beforeAll(hook(fn)); };
    test.afterAll = function (fn) { T.afterAll(hook(fn)); };
    test.step = function (name, fn) { return Promise.resolve().then(fn); };
    test.expect = expect;
    test.extend = function () { return test; };
    var api = { test: test, expect: expect, devices: { 'Desktop Chrome': {}, 'iPhone 13': { viewport: { width: 390, height: 844 } }, 'Pixel 5': { viewport: { width: 393, height: 851 } } }, defineConfig: function (c) { return c; },
        chromium: { launch: function () { return Promise.resolve({ newPage: function () { return Promise.resolve(page); }, newContext: function () { return Promise.resolve(context); }, close: function () { return Promise.resolve(); } }); } } };
    api.firefox = api.webkit = api.chromium;
    api.default = api;
    x.BUILTIN['@playwright/test'] = function () { return api; };
    x.BUILTIN.playwright = function () { return api; };
}

/** Pure DOM operations for E2E (runs inside the preview iframe, or directly on a jsdom document). Self-contained. */
export function e2eOps(doc, win, op, args) {
    args = args || {};
    var norm = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); };
    var mt = function (m, txt, exact) {
        if (!m) return true;
        var t = norm(txt);
        if (m.re != null) return new RegExp(m.re, m.f || '').test(t);
        return exact ? t === norm(m.s) : t.toLowerCase().indexOf(norm(m.s).toLowerCase()) >= 0;
    };
    var NF = function (msg) { var e = new Error(msg); e.code = 'E_NOTFOUND'; return e; };
    var SKIP = /^(SCRIPT|STYLE|HEAD|META|LINK|TITLE|TEMPLATE|NOSCRIPT)$/;
    var hidden = function (el) {
        for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
            if (e.hidden || SKIP.test(e.tagName)) return true;
            var cs = win && win.getComputedStyle ? win.getComputedStyle(e) : null;
            if (cs && (cs.display === 'none' || (e === el && (cs.visibility === 'hidden' || cs.visibility === 'collapse')))) return true;
            if (e.tagName === 'DETAILS' && !e.open && e !== el && !(el.closest && el.closest('summary'))) return true;
        }
        return false;
    };
    var visible = function (el) { return !!el && el.isConnected !== false && !(el.tagName === 'INPUT' && String(el.type).toLowerCase() === 'hidden') && !hidden(el); };
    var raw = function (el) { return el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) ? el.value : el.textContent || ''; };
    var inner = function (el) {
        if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type)) return el.value;
        var out = '';
        (function rec(n) { if (n.nodeType === 3) { out += n.nodeValue; return; } if (n.nodeType !== 1 || (n !== el && !visible(n))) return; if (n.tagName === 'BR') { out += '\n'; return; } for (var c = n.firstChild; c; c = c.nextSibling) rec(c); if (/^(P|DIV|LI|H[1-6]|TR|SECTION|ARTICLE|HEADER|FOOTER)$/.test(n.tagName)) out += ' '; })(el);
        return norm(out);
    };
    var byIds = function (ids) { return String(ids || '').split(/\s+/).map(function (id) { var e = id && doc.getElementById(id); return e ? e.textContent : ''; }).join(' '); };
    var labelOf = function (el) {
        var t = [];
        if (el.labels && el.labels.length) Array.prototype.forEach.call(el.labels, function (l) { t.push(l.textContent); });
        else if (el.id) Array.prototype.forEach.call(doc.querySelectorAll('label[for="' + el.id.replace(/"/g, '\\"') + '"]'), function (l) { t.push(l.textContent); });
        var wrap = el.closest && el.closest('label');
        if (wrap && t.indexOf(wrap.textContent) < 0) t.push(wrap.textContent);
        return norm(t.join(' '));
    };
    var role = function (el) {
        var r = el.getAttribute('role');
        if (r) return r.split(/\s+/)[0];
        var t = el.tagName.toLowerCase(), ty = String(el.getAttribute('type') || '').toLowerCase();
        if (t === 'button' || (t === 'input' && /^(button|submit|reset|image)$/.test(ty))) return 'button';
        if ((t === 'a' || t === 'area') && el.hasAttribute('href')) return 'link';
        if (/^h[1-6]$/.test(t)) return 'heading';
        if (t === 'input') { if (ty === 'checkbox') return 'checkbox'; if (ty === 'radio') return 'radio'; if (ty === 'range') return 'slider'; if (ty === 'number') return 'spinbutton'; if (ty === 'search') return 'searchbox'; if (!ty || /^(text|email|tel|url|password)$/.test(ty)) return 'textbox'; return ''; }
        if (t === 'textarea') return 'textbox';
        if (t === 'select') return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
        if (t === 'img') return el.getAttribute('alt') === '' ? 'presentation' : 'img';
        if (t === 'section') return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? 'region' : '';
        if (t === 'header') return el.closest('article,aside,main,nav,section') ? '' : 'banner';
        if (t === 'footer') return el.closest('article,aside,main,nav,section') ? '' : 'contentinfo';
        return { ul: 'list', ol: 'list', li: 'listitem', nav: 'navigation', main: 'main', aside: 'complementary', form: 'form', table: 'table', tr: 'row', td: 'cell', th: 'columnheader', dialog: 'dialog', p: 'paragraph', article: 'article', hr: 'separator', progress: 'progressbar', fieldset: 'group', option: 'option', dl: 'list', menu: 'list', output: 'status', summary: 'button', meter: 'meter' }[t] || '';
    };
    var NAME_FROM_CONTENT = /^(button|link|heading|listitem|cell|columnheader|option|tab|menuitem|checkbox|radio|switch|treeitem|row|tooltip|paragraph)$/;
    var accName = function (el) {
        if (el.hasAttribute('aria-labelledby')) { var b = norm(byIds(el.getAttribute('aria-labelledby'))); if (b) return b; }
        if (el.hasAttribute('aria-label')) { var a = norm(el.getAttribute('aria-label')); if (a) return a; }
        var t = el.tagName;
        if (/^(INPUT|SELECT|TEXTAREA|METER|PROGRESS|OUTPUT)$/.test(t)) {
            if (t === 'INPUT' && /^(button|submit|reset)$/i.test(el.type)) return norm(el.value || ({ submit: 'Submit', reset: 'Reset' })[String(el.type).toLowerCase()] || '');
            if (t === 'INPUT' && /^image$/i.test(el.type)) return norm(el.getAttribute('alt') || '');
            var l = labelOf(el); if (l) return l;
            return norm(el.getAttribute('title') || el.getAttribute('placeholder') || '');
        }
        if (t === 'IMG' || t === 'AREA') return norm(el.getAttribute('alt') || el.getAttribute('title') || '');
        if (t === 'FIELDSET') { var lg = el.querySelector('legend'); if (lg) return norm(lg.textContent); }
        if (t === 'TABLE') { var cap = el.querySelector('caption'); if (cap) return norm(cap.textContent); }
        if (NAME_FROM_CONTENT.test(role(el))) {
            var s = '';
            (function rec(n) { if (n.nodeType === 3) { s += n.nodeValue; return; } if (n.nodeType !== 1 || (n !== el && hidden(n) && !n.hasAttribute('aria-label'))) return; if (n !== el && n.hasAttribute('aria-label')) { s += ' ' + n.getAttribute('aria-label') + ' '; return; } if (n.tagName === 'IMG') { s += ' ' + (n.getAttribute('alt') || '') + ' '; return; } for (var c = n.firstChild; c; c = c.nextSibling) rec(c); })(el);
            if (norm(s)) return norm(s);
        }
        return norm(el.getAttribute('title') || '');
    };
    var within = function (ctx, isRoot) {
        var out = [], seen = new Set();
        ctx.forEach(function (c) { var list = (isRoot ? doc : c).querySelectorAll('*'); for (var i = 0; i < list.length; i++) if (!seen.has(list[i])) { seen.add(list[i]); out.push(list[i]); } });
        return out;
    };
    var resolve = function (steps) {
        var cur = [doc.documentElement], isRoot = true;
        (steps || []).forEach(function (s) {
            var next = [];
            if (s.k === 'focused') next = doc.activeElement && doc.activeElement !== doc.body ? [doc.activeElement] : [doc.body];
            else if (s.k === 'css') {
                var v = String(s.v).trim(), m;
                if ((m = /^text=(["']?)(.*)\1$/.exec(v))) next = textStep(cur, isRoot, { s: m[2] }, !!m[1]);
                else if ((m = /^(.*?):has-text\((["'])(.*)\2\)$/.exec(v))) next = css(cur, isRoot, m[1] || '*').filter(function (e) { return mt({ s: m[3] }, e.textContent); });
                else if ((m = /^(.*?):text\((["'])(.*)\2\)$/.exec(v))) next = textStep(m[1] ? css(cur, isRoot, m[1]) : cur, !m[1] && isRoot, { s: m[3] }, false, !!m[1]);
                else if ((m = /^(.*?):visible$/.exec(v))) next = css(cur, isRoot, m[1] || '*').filter(visible);
                else if ((m = /^data-testid=(.*)$/.exec(v))) next = css(cur, isRoot, '[data-testid="' + m[1].replace(/^["']|["']$/g, '') + '"]');
                else next = css(cur, isRoot, v);
            } else if (s.k === 'nth') { var e = s.n < 0 ? cur[cur.length + s.n] : cur[s.n]; next = e ? [e] : []; }
            else if (s.k === 'filter') next = cur.filter(function (e) { return (!s.has || mt(s.has, e.textContent)) && !(s.not && mt(s.not, e.textContent)); });
            else if (s.k === 'text') next = textStep(cur, isRoot, s.m, s.exact);
            else {
                var all = within(cur, isRoot);
                if (s.k === 'role') next = all.filter(function (el) {
                    if (role(el) !== s.role) return false;
                    if (!s.includeHidden && !visible(el)) return false;
                    if (s.level && !(/^H([1-6])$/.test(el.tagName) && +el.tagName[1] === s.level) && +el.getAttribute('aria-level') !== s.level) return false;
                    if (s.checked != null && !!(el.checked || el.getAttribute('aria-checked') === 'true') !== !!s.checked) return false;
                    return !s.name || mt(s.name, accName(el), s.exact);
                });
                else if (s.k === 'label') next = all.filter(function (el) { return /^(INPUT|SELECT|TEXTAREA|BUTTON|METER|PROGRESS)$/.test(el.tagName) || el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? ((el.hasAttribute('aria-label') && mt(s.m, el.getAttribute('aria-label'), s.exact)) || (el.hasAttribute('aria-labelledby') && mt(s.m, byIds(el.getAttribute('aria-labelledby')), s.exact)) || (/^(INPUT|SELECT|TEXTAREA|METER|PROGRESS)$/.test(el.tagName) && labelOf(el) && mt(s.m, labelOf(el), s.exact))) : false; });
                else if (s.k === 'placeholder') next = all.filter(function (el) { return el.hasAttribute('placeholder') && mt(s.m, el.getAttribute('placeholder'), s.exact); });
                else if (s.k === 'alt') next = all.filter(function (el) { return el.hasAttribute('alt') && mt(s.m, el.getAttribute('alt'), s.exact); });
                else if (s.k === 'title') next = all.filter(function (el) { return el.hasAttribute('title') && mt(s.m, el.getAttribute('title'), s.exact); });
                else if (s.k === 'testid') next = all.filter(function (el) { return el.getAttribute('data-testid') === s.v; });
            }
            cur = next; isRoot = false;
        });
        return isRoot ? [] : cur;
    };
    function css(cur, isRoot, sel) {
        var out = [], seen = new Set();
        cur.forEach(function (c) { var list; try { list = (isRoot ? doc : c).querySelectorAll(sel); } catch (e) { throw new Error('محدد CSS غير صالح: ' + sel); } for (var i = 0; i < list.length; i++) if (!seen.has(list[i])) { seen.add(list[i]); out.push(list[i]); } });
        return out;
    }
    function textStep(cur, isRoot, m, exact, self) {
        var pool = self ? cur : within(cur, isRoot);
        var hit = pool.filter(function (el) { return !SKIP.test(el.tagName) && mt(m, raw(el), exact); });
        return self ? hit : hit.filter(function (el) { for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (!SKIP.test(c.tagName) && mt(m, raw(c), exact)) return false; return true; });
    }
    var fire = function (el, type, init) {
        var C = (/^key/.test(type) ? win.KeyboardEvent : /^(mouse|click|dblclick)/.test(type) ? win.MouseEvent : /^(focus|blur)/.test(type) ? win.FocusEvent : win.Event) || win.Event;
        var ev = new C(type, Object.assign({ bubbles: !/^(focus|blur|mouseenter|mouseleave)$/.test(type), cancelable: true }, init || {}));
        return el.dispatchEvent(ev);
    };
    var setValue = function (el, v) {
        var proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype;
        var d = Object.getOwnPropertyDescriptor(proto, 'value');
        if (d && d.set) d.set.call(el, v); else el.value = v;
    };
    var editable = function (el) { return !!el && ((/^(INPUT|TEXTAREA)$/.test(el.tagName) && !el.readOnly && !el.disabled && !/^(button|submit|reset|checkbox|radio|file|image|hidden|range|color)$/i.test(el.type)) || el.isContentEditable || el.getAttribute('contenteditable') === 'true'); };
    var enabled = function (el) { return !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !(el.closest && el.closest('fieldset[disabled]')); };
    var focus = function (el) { if (doc.activeElement !== el && typeof el.focus === 'function') el.focus(); };
    var typeText = function (el, text) {
        String(text).split('').forEach(function (ch) {
            fire(el, 'keydown', { key: ch }); fire(el, 'keypress', { key: ch });
            if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') el.textContent += ch; else setValue(el, (el.value || '') + ch);
            fire(el, 'input', { data: ch, inputType: 'insertText' }); fire(el, 'keyup', { key: ch });
        });
    };
    var press = function (el, combo) {
        var key = String(combo).split('+').pop();
        var mods = { ctrlKey: /Control\+|Ctrl\+|ControlOrMeta\+/.test(combo), shiftKey: /Shift\+/.test(combo), altKey: /Alt\+/.test(combo), metaKey: /Meta\+/.test(combo) };
        var init = Object.assign({ key: key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key }, mods);
        var ok = fire(el, 'keydown', init);
        if (ok && key.length === 1 && !mods.ctrlKey && !mods.metaKey && editable(el)) { fire(el, 'keypress', init); setValue(el, (el.value || '') + key); fire(el, 'input', { data: key }); }
        if (ok && key === 'Backspace' && editable(el)) { setValue(el, String(el.value || '').slice(0, -1)); fire(el, 'input', { inputType: 'deleteContentBackward' }); }
        if (ok && key === 'Enter') {
            if (el.tagName === 'INPUT' && el.form) { if (el.form.requestSubmit) { try { el.form.requestSubmit(); } catch (e) { fire(el.form, 'submit'); } } else fire(el.form, 'submit'); }
            else if (/^(BUTTON|A)$/.test(el.tagName)) el.click();
        }
        if (ok && key === ' ' && /^(BUTTON)$/.test(el.tagName)) el.click();
        if (ok && mods.ctrlKey && /^a$/i.test(key) && typeof el.select === 'function') el.select();
        fire(el, 'keyup', init);
    };
    var state = function () {
        var els = resolve(args.steps), f = els[0];
        return {
            count: els.length,
            raws: els.map(function (e) { return raw(e); }), texts: els.map(function (e) { return inner(e); }),
            raw: f ? raw(f) : null, text: f ? inner(f) : null, html: f ? String(f.innerHTML).slice(0, 20000) : null,
            value: f && 'value' in f ? f.value : null,
            visible: !!f && visible(f),
            checked: !!f && (!!f.checked || f.getAttribute('aria-checked') === 'true' || f.getAttribute('aria-pressed') === 'true'),
            enabled: !!f && enabled(f), editable: !!f && editable(f),
            focused: !!f && f === doc.activeElement,
            cls: f ? f.getAttribute('class') || '' : '', id: f ? f.id || '' : '',
            attr: f && args.attr ? f.getAttribute(args.attr) : null,
            empty: !!f && ('value' in f && /^(INPUT|TEXTAREA)$/.test(f.tagName) ? !f.value : !norm(f.textContent) && !f.children.length),
            tag: f ? f.tagName.toLowerCase() : null
        };
    };
    if (op === 'state') return state();
    if (op === 'page') return { title: doc.title, html: doc.documentElement ? doc.documentElement.outerHTML.slice(0, 200000) : '', url: args.url || '' };
    if (op === 'act') {
        var els = resolve(args.steps), el = els[0], a = args.action, v = args.value;
        if (!el) throw NF('لم يُعثر على العنصر');
        var needsVisible = !/^(focus|blur|selectOption|fill|clear|type|pressSequentially|press)$/.test(a) || (a === 'fill' && !visible(el));
        if (needsVisible && !visible(el) && args.steps[0].k !== 'focused') throw NF('العنصر غير ظاهر');
        if (/^(click|dblclick|tap|check|uncheck|setChecked|fill|clear|type|pressSequentially|selectOption)$/.test(a) && !enabled(el)) throw NF('العنصر معطّل');
        if (a === 'click' || a === 'tap' || a === 'dblclick') {
            fire(el, 'pointerdown'); fire(el, 'mousedown', { button: 0 }); focus(el); fire(el, 'pointerup'); fire(el, 'mouseup', { button: 0 });
            el.click();
            if (a === 'dblclick') { el.click(); fire(el, 'dblclick'); }
        } else if (a === 'fill' || a === 'clear') {
            if (!editable(el)) throw new Error('العنصر ليس حقل إدخال قابلاً للتحرير');
            focus(el);
            var val = a === 'clear' ? '' : String(v == null ? '' : v);
            if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') el.textContent = val; else setValue(el, val);
            fire(el, 'input', { inputType: 'insertText', data: val }); fire(el, 'change');
        } else if (a === 'type' || a === 'pressSequentially') { focus(el); typeText(el, v == null ? '' : v); }
        else if (a === 'press') { focus(el); press(el, v); }
        else if (a === 'check' || a === 'uncheck' || a === 'setChecked') {
            var want = a === 'check' ? true : a === 'uncheck' ? false : !!v;
            var cur = !!(el.checked || el.getAttribute('aria-checked') === 'true');
            if (cur !== want) el.click();
            if (!!(el.checked || el.getAttribute('aria-checked') === 'true') !== want) throw new Error('تعذر تغيير حالة التحديد');
        } else if (a === 'selectOption') {
            if (el.tagName !== 'SELECT') throw new Error('selectOption يتطلب عنصر <select>');
            var wanted = (Array.isArray(v) ? v : [v]).map(function (o) { return o && typeof o === 'object' ? o : { value: o, label: o }; });
            var picked = [];
            Array.prototype.forEach.call(el.options, function (o) {
                var hit = wanted.some(function (w) { return (w.value != null && o.value === String(w.value)) || (w.label != null && norm(o.label || o.textContent) === norm(w.label)) || (w.index != null && o.index === w.index); });
                if (el.multiple) o.selected = hit; else if (hit && !picked.length) o.selected = true;
                if (hit) picked.push(o.value);
            });
            if (!picked.length) throw NF('لا يوجد خيار مطابق');
            fire(el, 'input'); fire(el, 'change');
            return picked;
        } else if (a === 'hover') { fire(el, 'pointerover'); fire(el, 'mouseover'); fire(el, 'mouseenter'); fire(el, 'mousemove'); }
        else if (a === 'focus') focus(el);
        else if (a === 'blur') { if (typeof el.blur === 'function') el.blur(); }
        else throw new Error('إجراء غير مدعوم: ' + a);
        return true;
    }
    throw new Error('عملية غير معروفة: ' + op);
}

export const E2E_SAMPLE = `// اختبار طرف-لطرف بواجهة Playwright — يعمل داخل المتصفح على صفحات مشروعك
import { test, expect } from '@playwright/test';

test.describe('الصفحة الرئيسية', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('العنوان والعناصر الأساسية', async ({ page }) => {
    await expect(page).toHaveTitle(/.+/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('الأزرار قابلة للنقر', async ({ page }) => {
    const buttons = page.getByRole('button');
    if (await buttons.count()) {
      await buttons.first().click();
    }
  });
});
`;
