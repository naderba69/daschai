/* ==============================================================================
   Sprint 6 — JS runtime that executes INSIDE the sandboxed worker (or Node vm in
   tests). It must stay self-contained: it is serialised with Function#toString.
   Provides: console (#151), CommonJS modules for the transpiled project files,
   stdin via prompt()/input() (#224), process.env (#225), tracked timers so the
   host knows when the program is finished, fetch mocks from mocks/*.json (#227),
   process.exit, and a Jest-style test runner (#163).
   ============================================================================== */
/* eslint-disable no-restricted-globals */
export function oxRuntime(cfg, post) {
    var G = typeof globalThis !== 'undefined' ? globalThis : self;
    var modules = Object.create(null), cache = Object.create(null);
    var pending = 0, finished = false, mainDone = false, exitCode = 0;
    var send = function (m) { try { post(m); } catch (e) { /* host gone */ } };

    // ------------------------------------------------------------------ formatting (util.inspect-lite)
    function fmt(v, depth, seen, nested) {
        depth = depth == null ? 3 : depth; seen = seen || [];
        var t = typeof v;
        if (v === null) return 'null';
        if (t === 'undefined') return 'undefined';
        if (t === 'string') return nested ? JSON.stringify(v) : v;
        if (t === 'number') return Object.is(v, -0) ? '-0' : String(v);
        if (t === 'bigint') return String(v) + 'n';
        if (t === 'boolean') return String(v);
        if (t === 'symbol') return v.toString();
        if (t === 'function') return /^class\s/.test(Function.prototype.toString.call(v)) ? '[class ' + (v.name || 'anonymous') + ']' : '[Function: ' + (v.name || 'anonymous') + ']';
        if (v instanceof Error) return (v.stack && String(v.stack).indexOf(v.message) >= 0 ? String(v.stack).split('\n').slice(0, nested ? 1 : 6).join('\n') : v.name + ': ' + v.message);
        if (v instanceof Date) return isNaN(v) ? 'Invalid Date' : v.toISOString();
        if (v instanceof RegExp) return String(v);
        if (seen.indexOf(v) >= 0) return '[Circular]';
        if (depth < 0) return Array.isArray(v) ? '[Array]' : '[Object]';
        seen = seen.concat([v]);
        var inner = function (x) { return fmt(x, depth - 1, seen, true); };
        if (Array.isArray(v)) {
            var items = v.slice(0, 100).map(inner);
            if (v.length > 100) items.push('... ' + (v.length - 100) + ' more items');
            return wrap('[', items, ']');
        }
        if (typeof Map !== 'undefined' && v instanceof Map) return 'Map(' + v.size + ') ' + wrap('{', Array.from(v).slice(0, 50).map(function (e) { return inner(e[0]) + ' => ' + inner(e[1]); }), '}');
        if (typeof Set !== 'undefined' && v instanceof Set) return 'Set(' + v.size + ') ' + wrap('{', Array.from(v).slice(0, 50).map(inner), '}');
        if (typeof Promise !== 'undefined' && v instanceof Promise) return 'Promise { <pending> }';
        if (ArrayBuffer.isView && ArrayBuffer.isView(v)) return v.constructor.name + '(' + v.length + ') [' + Array.prototype.slice.call(v, 0, 50).join(', ') + ']';
        var keys = Object.keys(v);
        var ctor = v.constructor && v.constructor.name && v.constructor.name !== 'Object' ? v.constructor.name + ' ' : '';
        var props = keys.slice(0, 60).map(function (k) { return (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)) + ': ' + inner(v[k]); });
        if (keys.length > 60) props.push('... ' + (keys.length - 60) + ' more');
        return ctor + wrap('{', props, '}');
    }
    function wrap(open, items, close) {
        if (!items.length) return open + close;
        var one = open + ' ' + items.join(', ') + ' ' + close;
        if (one.length <= 72 && one.indexOf('\n') < 0) return one;
        return open + '\n' + items.map(function (s) { return '  ' + s.split('\n').join('\n  '); }).join(',\n') + '\n' + close;
    }
    function format(args) {
        var a = Array.prototype.slice.call(args);
        if (typeof a[0] === 'string' && /%[sdifoOjc%]/.test(a[0])) {
            var i = 1;
            var s = a[0].replace(/%([sdifoOjc%])/g, function (m, c) {
                if (c === '%') return '%';
                if (i >= a.length) return m;
                var x = a[i++];
                if (c === 's') return typeof x === 'string' ? x : fmt(x, 1, [], true);
                if (c === 'd' || c === 'i') return String(parseInt(x, 10));
                if (c === 'f') return String(parseFloat(x));
                if (c === 'c') return '';
                return fmt(x, 3, [], true);
            });
            return [s].concat(a.slice(i).map(function (x) { return fmt(x); })).join(' ');
        }
        return a.map(function (x) { return fmt(x); }).join(' ');
    }

    // ------------------------------------------------------------------ console
    var groupDepth = 0, counts = {}, timers = {};
    var out = function (level, text) { send({ type: 'out', level: level, text: (groupDepth ? new Array(groupDepth + 1).join('  ') : '') + text }); };
    var konsole = {
        log: function () { out('log', format(arguments)); },
        info: function () { out('info', format(arguments)); },
        debug: function () { out('debug', format(arguments)); },
        warn: function () { out('warn', format(arguments)); },
        error: function () { out('error', format(arguments)); },
        trace: function () { out('debug', 'Trace: ' + format(arguments)); },
        dir: function (o) { out('log', fmt(o, 5)); },
        assert: function (c) { if (!c) out('error', 'Assertion failed' + (arguments.length > 1 ? ': ' + format(Array.prototype.slice.call(arguments, 1)) : '')); },
        count: function (l) { l = l || 'default'; counts[l] = (counts[l] || 0) + 1; out('log', l + ': ' + counts[l]); },
        countReset: function (l) { counts[l || 'default'] = 0; },
        time: function (l) { timers[l || 'default'] = Date.now(); },
        timeLog: function (l) { l = l || 'default'; if (timers[l] != null) out('log', l + ': ' + (Date.now() - timers[l]) + 'ms'); },
        timeEnd: function (l) { l = l || 'default'; if (timers[l] != null) { out('log', l + ': ' + (Date.now() - timers[l]) + 'ms'); delete timers[l]; } },
        group: function () { if (arguments.length) out('log', format(arguments)); groupDepth++; },
        groupCollapsed: function () { if (arguments.length) out('log', format(arguments)); groupDepth++; },
        groupEnd: function () { groupDepth = Math.max(0, groupDepth - 1); },
        clear: function () { send({ type: 'clear' }); },
        table: function (data) {
            if (!data || typeof data !== 'object') { out('log', fmt(data)); return; }
            var rows = Array.isArray(data) ? data : Object.keys(data).map(function (k) { return data[k]; });
            var idx = Array.isArray(data) ? rows.map(function (_, i) { return String(i); }) : Object.keys(data);
            var cols = [];
            rows.forEach(function (r) { if (r && typeof r === 'object') Object.keys(r).forEach(function (k) { if (cols.indexOf(k) < 0) cols.push(k); }); });
            var prim = cols.length === 0;
            var head = ['(index)'].concat(prim ? ['Values'] : cols);
            var body = rows.map(function (r, i) { return [idx[i]].concat(prim ? [fmt(r, 0, [], true)] : cols.map(function (c) { return r && c in r ? fmt(r[c], 0, [], true) : ''; })); });
            var w = head.map(function (h, c) { return Math.max(h.length, Math.max.apply(null, body.map(function (b) { return String(b[c]).length; }).concat([0]))); });
            var line = function (cells) { return '│ ' + cells.map(function (x, c) { x = String(x); return x + new Array(w[c] - x.length + 1).join(' '); }).join(' │ ') + ' │'; };
            var sep = function (l, m, r) { return l + w.map(function (n) { return new Array(n + 3).join('─'); }).join(m) + r; };
            out('log', [sep('┌', '┬', '┐'), line(head), sep('├', '┼', '┤')].concat(body.map(line), [sep('└', '┴', '┘')]).join('\n'));
        }
    };

    // ------------------------------------------------------------------ stdin / process
    var stdin = String(cfg.stdin || '').replace(/\r\n/g, '\n');
    var stdinLines = stdin ? stdin.split('\n') : [], stdinIdx = 0;
    function readLine(q) {
        if (q != null && q !== '') out('log', String(q));
        var v = stdinIdx < stdinLines.length ? stdinLines[stdinIdx++] : null;
        send({ type: 'stdin', value: v, index: stdinIdx });
        return v;
    }
    function ExitSignal(code) { this.code = code; }
    var process = {
        env: Object.assign({ NODE_ENV: 'development' }, cfg.env || {}),
        argv: ['node', cfg.entry || 'main.js'].concat(cfg.argv || []),
        platform: 'browser', version: 'v20.0.0-ox', versions: { node: '20.0.0-ox' },
        cwd: function () { return '/'; },
        exit: function (code) { throw new ExitSignal(code == null ? 0 : code); },
        nextTick: function (fn) { var a = Array.prototype.slice.call(arguments, 1); Promise.resolve().then(function () { fn.apply(null, a); }); },
        hrtime: Object.assign(function () { var t = (typeof performance !== 'undefined' ? performance.now() : Date.now()); return [Math.floor(t / 1000), Math.floor((t % 1000) * 1e6)]; }, { bigint: function () { return BigInt(Math.floor((typeof performance !== 'undefined' ? performance.now() : Date.now()) * 1e6)); } }),
        memoryUsage: function () { return { rss: 0, heapUsed: 0, heapTotal: 0 }; },
        stdout: { write: function (s) { out('log', String(s).replace(/\n$/, '')); return true; } },
        stderr: { write: function (s) { out('error', String(s).replace(/\n$/, '')); return true; } },
        stdin: { read: function () { return readLine(); } },
        on: function () { return process; }
    };

    // ------------------------------------------------------------------ timers (tracked so we know when the program is done)
    var nativeST = G.setTimeout.bind(G), nativeCT = G.clearTimeout.bind(G), nativeSI = G.setInterval.bind(G), nativeCI = G.clearInterval.bind(G);
    var live = new Set();
    var guard = function (fn) { return function () { try { return fn.apply(this, arguments); } catch (e) { fail(e); } }; };
    var sT = function (fn, ms) { var a = Array.prototype.slice.call(arguments, 2); pending++; var id = nativeST(function () { if (live.delete(id)) pending--; guard(typeof fn === 'function' ? fn : function () {}).apply(null, a); check(); }, ms); live.add(id); return id; };
    var cT = function (id) { if (live.delete(id)) { pending--; nativeCT(id); check(); } };
    var sI = function (fn, ms) { var a = Array.prototype.slice.call(arguments, 2); pending++; var id = nativeSI(function () { guard(fn).apply(null, a); }, ms); live.add(id); return id; };
    var cI = function (id) { if (live.delete(id)) { pending--; nativeCI(id); check(); } };

    // ------------------------------------------------------------------ fetch with mocks (#227)
    var mocks = cfg.mocks || {};
    var fetchHandlers = [], msgHandlers = [], doneHooks = [], extraMatchers = {};
    var makeRes = function (status, body, headers, url) {
        var text = body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
        var h = headers || {}; var hk = {}; Object.keys(h).forEach(function (k) { hk[k.toLowerCase()] = String(h[k]); });
        if (!hk['content-type']) hk['content-type'] = typeof body === 'string' ? 'text/plain' : 'application/json';
        var res = { ok: status >= 200 && status < 300, status: status, statusText: String(status), url: url || '', headers: { get: function (k) { return hk[String(k).toLowerCase()] || null; }, has: function (k) { return String(k).toLowerCase() in hk; }, forEach: function (f) { Object.keys(hk).forEach(function (k) { f(hk[k], k); }); } },
            json: function () { return Promise.resolve(text ? JSON.parse(text) : null); }, text: function () { return Promise.resolve(text); }, clone: function () { return res; } };
        return res;
    };
    var mockFetch = function (input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || String(input);
        for (var hi = 0; hi < fetchHandlers.length; hi++) { var hr = fetchHandlers[hi](url, init || {}); if (hr) return Promise.resolve(hr); }
        var key = url.replace(/^https?:\/\/(localhost|mock|api\.mock)(:\d+)?/, '').split('?')[0];
        var hit = mocks[key] != null ? mocks[key] : mocks[key.replace(/\/$/, '')] != null ? mocks[key.replace(/\/$/, '')] : mocks[key + '.json'];
        if (hit != null) {
            var body = typeof hit === 'string' ? hit : JSON.stringify(hit);
            var res = { ok: true, status: 200, statusText: 'OK (mock)', url: url, headers: { get: function (h) { return /content-type/i.test(h) ? 'application/json' : null; } }, json: function () { return Promise.resolve(JSON.parse(body)); }, text: function () { return Promise.resolve(body); }, clone: function () { return res; } };
            return Promise.resolve(res);
        }
        if (typeof G.fetch !== 'function') return Promise.reject(new Error('fetch غير متاح'));
        pending++;
        return G.fetch(input, init).then(function (r) { pending--; check(); return r; }, function (e) { pending--; check(); throw e; });
    };

    // ------------------------------------------------------------------ modules
    var BUILTIN = {
        assert: function () {
            var eq = function (a, b) { return deepEqual(a, b, false); };
            var A = function (v, m) { if (!v) throw new Error(m || 'Assertion failed'); };
            A.ok = A; A.equal = function (a, b, m) { if (a != b) throw new Error(m || fmt(a) + ' == ' + fmt(b)); }; // eslint-disable-line eqeqeq
            A.strictEqual = function (a, b, m) { if (!Object.is(a, b)) throw new Error(m || 'Expected ' + fmt(b, 2, [], true) + ' but got ' + fmt(a, 2, [], true)); };
            A.notStrictEqual = function (a, b, m) { if (Object.is(a, b)) throw new Error(m || 'Expected values to differ'); };
            A.deepEqual = A.deepStrictEqual = function (a, b, m) { if (!eq(a, b)) throw new Error(m || 'Expected ' + fmt(b, 3, [], true) + ' but got ' + fmt(a, 3, [], true)); };
            A.throws = function (fn, m) { try { fn(); } catch (e) { return; } throw new Error(m || 'Expected function to throw'); };
            return A;
        },
        util: function () { return { inspect: function (v, o) { return fmt(v, o && o.depth != null ? o.depth : 3); }, format: function () { return format(arguments); }, isDeepStrictEqual: function (a, b) { return deepEqual(a, b, true); }, promisify: function (fn) { return function () { var a = Array.prototype.slice.call(arguments); return new Promise(function (res, rej) { fn.apply(null, a.concat([function (e, v) { if (e) rej(e); else res(v); }])); }); }; } }; },
        events: function () {
            function EventEmitter() { this._ev = {}; }
            EventEmitter.prototype.on = EventEmitter.prototype.addListener = function (n, f) { (this._ev[n] = this._ev[n] || []).push(f); return this; };
            EventEmitter.prototype.once = function (n, f) { var s = this; var w = function () { s.off(n, w); f.apply(s, arguments); }; return this.on(n, w); };
            EventEmitter.prototype.off = EventEmitter.prototype.removeListener = function (n, f) { this._ev[n] = (this._ev[n] || []).filter(function (x) { return x !== f; }); return this; };
            EventEmitter.prototype.emit = function (n) { var a = Array.prototype.slice.call(arguments, 1), s = this, l = (this._ev[n] || []).slice(); l.forEach(function (f) { f.apply(s, a); }); return l.length > 0; };
            EventEmitter.prototype.listenerCount = function (n) { return (this._ev[n] || []).length; };
            EventEmitter.EventEmitter = EventEmitter;
            return EventEmitter;
        },
        path: function () {
            var norm = function (p) { var out = []; p.split('/').forEach(function (s) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); }); return (p[0] === '/' ? '/' : '') + out.join('/'); };
            return { sep: '/', join: function () { return norm(Array.prototype.slice.call(arguments).join('/')); }, resolve: function () { return norm('/' + Array.prototype.slice.call(arguments).join('/')); }, dirname: function (p) { var i = p.lastIndexOf('/'); return i <= 0 ? (i === 0 ? '/' : '.') : p.slice(0, i); }, basename: function (p, e) { var b = p.split('/').pop(); return e && b.slice(-e.length) === e ? b.slice(0, -e.length) : b; }, extname: function (p) { var b = p.split('/').pop(), i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; }, normalize: norm };
        },
        readline: function () { return { createInterface: function () { return { question: function (q, cb) { var v = readLine(q); Promise.resolve().then(function () { cb(v == null ? '' : v); }); }, on: function (ev, cb) { if (ev === 'line') { var v; while ((v = readLine()) != null) cb(v); } return this; }, close: function () {} }; } }; }
    };
    var dirOf = function (p) { var i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
    var joinP = function (base, rel) { var parts = base ? base.split('/') : []; rel.split('/').forEach(function (s) { if (s === '..') parts.pop(); else if (s && s !== '.') parts.push(s); }); return parts.join('/'); };
    var EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
    function resolve(from, spec) {
        var bare = spec.replace(/^node:/, '');
        if (BUILTIN[bare]) return 'builtin:' + bare;
        var base = spec[0] === '/' ? spec.slice(1) : /^\.\.?(\/|$)/.test(spec) ? joinP(dirOf(from), spec) : null;
        if (base == null) { if (modules[spec]) return spec; return null; }
        var stripped = base.replace(/\.(js|jsx|mjs|cjs)$/, '');
        for (var i = 0; i < EXTS.length; i++) { if (modules[base + EXTS[i]]) return base + EXTS[i]; if (modules[stripped + EXTS[i]]) return stripped + EXTS[i]; }
        return null;
    }
    function load(id) {
        if (id.indexOf('builtin:') === 0) { var b = id.slice(8); return cache[id] || (cache[id] = { exports: BUILTIN[b]() }).exports; }
        if (cache[id]) return cache[id].exports;
        var def = modules[id];
        var module = { exports: {}, id: id, filename: id, loaded: false };
        cache[id] = module;
        if (def.json !== undefined) { module.exports = def.json; module.loaded = true; return module.exports; }
        var req = makeRequire(id);
        var r = def.fn.call(module.exports, module.exports, req, module, id, dirOf(id), process, konsole, readLine, readLine, mockFetch, sT, sI, cT, cI,
            T.describe, T.it, T.test, T.expect, T.beforeEach, T.afterEach, T.beforeAll, T.afterAll, T.jest, T.jest);
        module.loaded = true;
        if (r && typeof r.then === 'function') module.__async = r;
        return module.exports;
    }
    function makeRequire(from) {
        var req = function (spec) {
            var id = resolve(from, String(spec));
            if (!id) {
                var bare = !/^[./]/.test(spec);
                throw new Error("Cannot find module '" + spec + "'" + (bare ? ' — الحزم الخارجية (npm) غير متاحة في مشغل المتصفح؛ المتاح: ' + Object.keys(BUILTIN).join(', ') : ' من ' + from));
            }
            return load(id);
        };
        req.resolve = function (spec) { return resolve(from, spec); };
        return req;
    }

    // ------------------------------------------------------------------ test framework
    function deepEqual(a, b, strict) {
        if (Object.is(a, b)) return true;
        if (!strict && a == b && (a === null || typeof a !== 'object')) return a == b; // eslint-disable-line eqeqeq
        if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
        if (strict && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
        if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
        if (a instanceof RegExp && b instanceof RegExp) return String(a) === String(b);
        if (a instanceof Map && b instanceof Map) { if (a.size !== b.size) return false; var ok = true; a.forEach(function (v, k) { if (!b.has(k) || !deepEqual(v, b.get(k), strict)) ok = false; }); return ok; }
        if (a instanceof Set && b instanceof Set) { if (a.size !== b.size) return false; var all = true; a.forEach(function (v) { if (!b.has(v)) all = false; }); return all; }
        if (Array.isArray(a) !== Array.isArray(b)) return false;
        var ka = Object.keys(a).filter(function (k) { return strict || a[k] !== undefined; }), kb = Object.keys(b).filter(function (k) { return strict || b[k] !== undefined; });
        if (ka.length !== kb.length) return false;
        for (var i = 0; i < ka.length; i++) if (!Object.prototype.hasOwnProperty.call(b, ka[i]) || !deepEqual(a[ka[i]], b[ka[i]], strict)) return false;
        return true;
    }
    var T = (function () {
        var root = { name: '', tests: [], children: [], before: [], after: [], beforeAll: [], afterAll: [], parent: null };
        var cur = root, hasOnly = false, currentFile = '';
        function AssertionError(msg, expected, received) { var e = new Error(msg); e.name = 'AssertionError'; e.expected = expected; e.received = received; return e; }
        function makeExpect(actual, negate, mode) {
            var p = function (cond, msg, exp) {
                if (mode) return; // handled by resolves/rejects wrappers
                if (negate ? cond : !cond) throw AssertionError((negate ? 'expected not: ' : '') + msg, exp !== undefined ? fmt(exp, 3, [], true) : undefined, fmt(actual, 3, [], true));
            };
            var m = {
                toBe: function (e) { p(Object.is(actual, e), 'expected ' + fmt(actual, 2, [], true) + ' to be ' + fmt(e, 2, [], true), e); },
                toEqual: function (e) { p(deepEqual(actual, e, false), 'expected values to be deeply equal', e); },
                toStrictEqual: function (e) { p(deepEqual(actual, e, true), 'expected values to be strictly deeply equal', e); },
                toBeTruthy: function () { p(!!actual, 'expected ' + fmt(actual, 2, [], true) + ' to be truthy'); },
                toBeFalsy: function () { p(!actual, 'expected ' + fmt(actual, 2, [], true) + ' to be falsy'); },
                toBeNull: function () { p(actual === null, 'expected null'); },
                toBeUndefined: function () { p(actual === undefined, 'expected undefined'); },
                toBeDefined: function () { p(actual !== undefined, 'expected value to be defined'); },
                toBeNaN: function () { p(Number.isNaN(actual), 'expected NaN'); },
                toContain: function (e) { p(actual != null && (typeof actual === 'string' ? actual.indexOf(e) >= 0 : Array.from(actual).some(function (x) { return Object.is(x, e); })), 'expected ' + fmt(actual, 2, [], true) + ' to contain ' + fmt(e, 2, [], true)); },
                toContainEqual: function (e) { p(Array.from(actual || []).some(function (x) { return deepEqual(x, e, false); }), 'expected collection to contain an equal item', e); },
                toHaveLength: function (n) { p(actual != null && actual.length === n, 'expected length ' + n + ' but got ' + (actual && actual.length)); },
                toMatch: function (r) { p(typeof actual === 'string' && (r instanceof RegExp ? r.test(actual) : actual.indexOf(r) >= 0), 'expected ' + fmt(actual, 1, [], true) + ' to match ' + String(r)); },
                toMatchObject: function (o) { p(actual && Object.keys(o).every(function (k) { return deepEqual(actual[k], o[k], false); }), 'expected object to match', o); },
                toBeGreaterThan: function (n) { p(actual > n, 'expected ' + actual + ' > ' + n); },
                toBeGreaterThanOrEqual: function (n) { p(actual >= n, 'expected ' + actual + ' >= ' + n); },
                toBeLessThan: function (n) { p(actual < n, 'expected ' + actual + ' < ' + n); },
                toBeLessThanOrEqual: function (n) { p(actual <= n, 'expected ' + actual + ' <= ' + n); },
                toBeCloseTo: function (n, d) { d = d == null ? 2 : d; p(Math.abs(actual - n) < Math.pow(10, -d) / 2, 'expected ' + actual + ' to be close to ' + n); },
                toBeInstanceOf: function (C) { p(actual instanceof C, 'expected instance of ' + (C && C.name)); },
                toHaveProperty: function (path, val) {
                    var parts = Array.isArray(path) ? path : String(path).split('.'), o = actual, ok = true;
                    for (var i = 0; i < parts.length; i++) { if (o == null || !(parts[i] in Object(o))) { ok = false; break; } o = o[parts[i]]; }
                    p(ok && (arguments.length < 2 || deepEqual(o, val, false)), 'expected property ' + parts.join('.') + (arguments.length > 1 ? ' = ' + fmt(val, 2, [], true) : ''));
                },
                toThrow: function (e) {
                    var threw = false, err;
                    try { actual(); } catch (x) { threw = true; err = x; }
                    var match = !threw ? false : e == null ? true : e instanceof RegExp ? e.test(err && err.message) : typeof e === 'function' ? err instanceof e : String(err && err.message).indexOf(e) >= 0;
                    p(match, threw ? 'thrown error did not match ' + String(e) : 'expected function to throw');
                },
                toHaveBeenCalled: function () { p(actual && actual.mock && actual.mock.calls.length > 0, 'expected mock to have been called'); },
                toHaveBeenCalledTimes: function (n) { p(actual && actual.mock && actual.mock.calls.length === n, 'expected ' + n + ' calls, got ' + (actual && actual.mock && actual.mock.calls.length)); },
                toHaveBeenCalledWith: function () { var args = Array.prototype.slice.call(arguments); p(actual && actual.mock && actual.mock.calls.some(function (c) { return deepEqual(c, args, false); }), 'expected mock to have been called with ' + fmt(args, 2, [], true)); }
            };
            m.toThrowError = m.toThrow; m.toBeCalled = m.toHaveBeenCalled; m.toBeCalledWith = m.toHaveBeenCalledWith;
            Object.keys(extraMatchers).forEach(function (k) { m[k] = function () { var r = extraMatchers[k].apply({ actual: actual, negate: negate, fmt: fmt, deepEqual: deepEqual, test: T.current }, arguments) || {}; p(!!r.pass, r.message || k, r.expected); }; });
            return m;
        }
        function expect(actual) {
            var m = makeExpect(actual, false); m.not = makeExpect(actual, true);
            var asy = function (rejects) {
                var wrapM = function (negate) {
                    var o = {}, base = makeExpect(null, negate);
                    Object.keys(base).forEach(function (k) {
                        o[k] = function () {
                            var args = arguments;
                            return Promise.resolve(actual).then(function (v) { if (rejects) throw AssertionError('expected promise to reject'); return v; }, function (e) { if (!rejects) throw AssertionError('expected promise to resolve but it rejected: ' + (e && e.message)); return e; })
                                .then(function (v) { var mm = makeExpect(rejects && k === 'toThrow' ? function () { throw v; } : v, negate); mm[k].apply(null, args); });
                        };
                    });
                    return o;
                };
                var r = wrapM(false); r.not = wrapM(true); return r;
            };
            m.resolves = asy(false); m.rejects = asy(true);
            return m;
        }
        expect.any = function (C) { return { asymmetricMatch: function (v) { return v != null && (v.constructor === C || v instanceof C); } }; };
        function fn(impl) {
            var f = function () { var a = Array.prototype.slice.call(arguments); f.mock.calls.push(a); var r; try { r = (f._impl || function () {}).apply(this, a); f.mock.results.push({ type: 'return', value: r }); return r; } catch (e) { f.mock.results.push({ type: 'throw', value: e }); throw e; } };
            f.mock = { calls: [], results: [] }; f._impl = impl;
            f.mockImplementation = function (i) { f._impl = i; return f; };
            f.mockReturnValue = function (v) { f._impl = function () { return v; }; return f; };
            f.mockResolvedValue = function (v) { f._impl = function () { return Promise.resolve(v); }; return f; };
            f.mockRejectedValue = function (v) { f._impl = function () { return Promise.reject(v); }; return f; };
            f.mockClear = function () { f.mock.calls = []; f.mock.results = []; return f; };
            f.mockReset = function () { f.mockClear(); f._impl = undefined; return f; };
            return f;
        }
        var jest = { fn: fn, spyOn: function (obj, key) { var orig = obj[key]; var s = fn(function () { return orig.apply(this, arguments); }); s.mockRestore = function () { obj[key] = orig; }; obj[key] = s; return s; } };
        function describe(name, body) {
            var node = { name: String(name), tests: [], children: [], before: [], after: [], beforeAll: [], afterAll: [], parent: cur, file: currentFile };
            cur.children.push(node);
            var prev = cur; cur = node;
            try { body(); } finally { cur = prev; }
        }
        describe.skip = function (name) { cur.children.push({ name: String(name), tests: [], children: [], before: [], after: [], beforeAll: [], afterAll: [], parent: cur, skip: true, file: currentFile }); };
        describe.only = function (name, body) { hasOnly = true; describe(name, body); cur.children[cur.children.length - 1].only = true; };
        function it(name, body, timeout) { cur.tests.push({ name: String(name), fn: body, timeout: timeout || 5000, file: currentFile }); }
        it.skip = function (name) { cur.tests.push({ name: String(name), skip: true, file: currentFile }); };
        it.only = function (name, body, timeout) { hasOnly = true; cur.tests.push({ name: String(name), fn: body, timeout: timeout || 5000, only: true, file: currentFile }); };
        it.todo = function (name) { cur.tests.push({ name: String(name), skip: true, todo: true, file: currentFile }); };
        it.each = function (table) { return function (name, body) { table.forEach(function (row, i) { var args = Array.isArray(row) ? row : [row]; var n = String(name).replace(/%[sdipj#]/g, function (m) { return m === '%#' ? String(i) : fmt(args.shift && args.length ? args[0] : row, 1, [], true); }); it(n, function () { return body.apply(null, Array.isArray(row) ? row : [row]); }); }); }; };
        var withTimeout = function (p, ms, name) { return new Promise(function (res, rej) { var t = nativeST(function () { rej(new Error('Timeout: «' + name + '» exceeded ' + ms + 'ms')); }, ms); Promise.resolve(p).then(function (v) { nativeCT(t); res(v); }, function (e) { nativeCT(t); rej(e); }); }); };
        var callFn = function (f, name, ms) { if (!f) return Promise.resolve(); if (f.length > 0) return withTimeout(new Promise(function (res, rej) { f(function (err) { if (err) rej(err); else res(); }); }), ms || 5000, name); try { return withTimeout(f(), ms || 5000, name); } catch (e) { return Promise.reject(e); } };
        var serialize = function (e) { return e ? { message: String(e.message || e), name: e.name, stack: String(e.stack || ''), expected: e.expected, received: e.received } : null; };
        function chainHooks(node, key) { var l = []; for (var n = node; n; n = n.parent) l = (key === 'before' ? n.before.concat(l) : l.concat(n.after)); return l; }
        function containsOnly(node) { return node.only || node.tests.some(function (t) { return t.only; }) || node.children.some(containsOnly); }
        function run() {
            var results = [], t0 = Date.now();
            function runNode(node, names, skipAll, onlyCtx) {
                var chain = Promise.resolve();
                var skip = skipAll || node.skip;
                var only = onlyCtx || node.only;
                if (!skip) node.beforeAll.forEach(function (h) { chain = chain.then(function () { return callFn(h, 'beforeAll'); }); });
                node.tests.forEach(function (t) {
                    chain = chain.then(function () {
                        var full = names.concat([t.name]);
                        var start = Date.now();
                        if (skip || t.skip || (hasOnly && !only && !t.only)) { var r0 = { file: t.file, name: full.join(' › '), status: t.todo ? 'todo' : 'skip', ms: 0 }; results.push(r0); send({ type: 'test', result: r0 }); return; }
                        var hooks = chainHooks(node, 'before'), after = chainHooks(node, 'after');
                        var p = Promise.resolve();
                        hooks.forEach(function (h) { p = p.then(function () { return callFn(h, 'beforeEach'); }); });
                        p = p.then(function () { T.current = full.join(' › '); T.currentFile = t.file; T.counter = 0; return callFn(t.fn, t.name, t.timeout); });
                        return p.then(function () { return null; }, function (e) { return e; }).then(function (err) {
                            var q = Promise.resolve();
                            after.forEach(function (h) { q = q.then(function () { return callFn(h, 'afterEach'); }); });
                            return q.then(function () { return err; }, function (e2) { return err || e2; });
                        }).then(function (err) {
                            var r = { file: t.file, name: full.join(' › '), status: err ? 'fail' : 'pass', ms: Date.now() - start, error: serialize(err) };
                            results.push(r); send({ type: 'test', result: r });
                        });
                    });
                });
                node.children.forEach(function (c) { chain = chain.then(function () { return runNode(c, names.concat([c.name]), skip, only || (hasOnly && containsOnly(c) && c.only)); }); });
                if (!skip) node.afterAll.forEach(function (h) { chain = chain.then(function () { return callFn(h, 'afterAll'); }); });
                return chain.then(null, function (e) { var r = { file: node.file, name: names.concat(['(hook)']).join(' › ') || '(hook)', status: 'fail', ms: 0, error: serialize(e) }; results.push(r); send({ type: 'test', result: r }); });
            }
            return runNode(root, [], false, false).then(function () {
                var sum = { pass: 0, fail: 0, skip: 0, todo: 0, total: results.length, ms: Date.now() - t0 };
                results.forEach(function (r) { sum[r.status]++; });
                return { results: results, summary: sum };
            });
        }
        return {
            describe: describe, it: it, test: it, expect: expect, jest: jest,
            beforeEach: function (f) { cur.before.push(f); }, afterEach: function (f) { cur.after.push(f); },
            beforeAll: function (f) { cur.beforeAll.push(f); }, afterAll: function (f) { cur.afterAll.push(f); },
            setFile: function (f) { currentFile = f; }, run: run
        };
    })();

    // ------------------------------------------------------------------ lifecycle
    var runDone = function () { doneHooks.forEach(function (h) { try { h(exitCode); } catch (e) { /* ignore */ } }); };
    function check() {
        if (finished || !mainDone || pending > 0) return;
        finished = true;
        runDone();
        send({ type: 'done', code: exitCode });
    }
    function fail(e) {
        if (e instanceof ExitSignal) { exitCode = e.code; finish(); return; }
        exitCode = 1;
        send({ type: 'error', error: { name: e && e.name, message: String(e && e.message !== undefined ? e.message : e), stack: String((e && e.stack) || '') } });
        finish();
    }
    function finish() {
        if (finished) return;
        finished = true;
        live.forEach(function (id) { nativeCT(id); nativeCI(id); });
        live.clear(); pending = 0;
        runDone();
        send({ type: 'done', code: exitCode });
    }
    if (typeof G.addEventListener === 'function') {
        G.addEventListener('message', function (ev) { var d = ev && ev.data; if (d && d.req && d.req.__ox) d = d.req; if (d && d.__ox) msgHandlers.forEach(function (f) { try { f(d); } catch (e) { fail(e); } }); });
        G.addEventListener('unhandledrejection', function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); fail(ev.reason); });
    }
    return {
        define: function (id, fn) { modules[id] = { fn: fn }; },
        /** Extensions (debugger, coverage, express/http, mock DB/auth, snapshots, bench) get the runtime internals. */
        extend: function (fn) {
            fn({ G: G, cfg: cfg, send: send, fmt: fmt, format: format, deepEqual: deepEqual, BUILTIN: BUILTIN, mocks: mocks, T: T, makeRes: makeRes, fail: fail, sT: sT, cT: cT, console: konsole,
                keep: function () { pending++; }, release: function () { pending--; check(); },
                onFetch: function (h) { fetchHandlers.push(h); }, onMessage: function (h) { msgHandlers.push(h); }, beforeDone: function (h) { doneHooks.push(h); }, matcher: function (n, f) { extraMatchers[n] = f; },
                exitCode: function () { return exitCode; }, fetch: function (u, i) { return mockFetch(u, i); } });
        },
        defineJSON: function (id, data) { modules[id] = { json: data }; },
        fail: fail,
        start: function (entry) {
            try {
                var id = resolve('', /^[./]/.test(entry) ? entry : './' + entry) || entry;
                if (!modules[id]) throw new Error('Entry not found: ' + entry);
                load(id);
                var m = cache[id];
                if (m && m.__async) { pending++; m.__async.then(function () { pending--; mainDone = true; check(); }, function (e) { fail(e); }); return; }
                mainDone = true;
                Promise.resolve().then(check);
            } catch (e) { fail(e); }
        },
        runTests: function (files) {
            try {
                (files || []).forEach(function (f) { T.setFile(f); load(f); });
            } catch (e) { fail(e); return; }
            pending++;
            T.run().then(function (r) {
                send({ type: 'tests', summary: r.summary, results: r.results });
                exitCode = r.summary.fail ? 1 : 0;
                mainDone = true; finish();
            }, function (e) { fail(e); });
        }
    };
}

export const runtimeSource = '(' + oxRuntime.toString() + ')';
