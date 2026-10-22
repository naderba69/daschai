/* ==============================================================================
   Sprint 13 — runtime extension (serialised with Function#toString, runs INSIDE the
   sandboxed worker next to runtime.js). Self-contained: no imports, no outer names.
   #160 virtual ports: require('http') / require('express') servers that the host
   (and fetch inside the program) can call • #226 mock database (json-server style
   REST over mocks/db.json + require('ox-db')) • #228 mock auth (/auth/register,
   /auth/login, /auth/me + require('ox-auth'), jsonwebtoken / bcryptjs stand-ins)
   • #166 snapshot tests (toMatchSnapshot / toMatchInlineSnapshot) • #168 bench().
   ============================================================================== */
/* eslint-disable no-var */
export function oxRuntimeExt(x) {
    var G = x.G, cfg = x.cfg || {};
    var clone = function (v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
    var now = function () { return G.performance && G.performance.now ? G.performance.now() : Date.now(); };

    // ------------------------------------------------------------------ URL helpers
    function parseUrl(url) {
        var m = /^(?:([a-z]+:)\/\/([^/:?#]+)(?::(\d+))?)?([^?#]*)(\?[^#]*)?/i.exec(String(url || '')) || [];
        var query = {};
        String(m[5] || '').replace(/^\?/, '').split('&').forEach(function (kv) {
            if (!kv) return;
            var i = kv.indexOf('='), k = decodeURIComponent((i < 0 ? kv : kv.slice(0, i)).replace(/\+/g, ' ')), v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
            if (k in query) query[k] = [].concat(query[k], v); else query[k] = v;
        });
        return { host: m[2] || '', port: m[3] ? +m[3] : (m[1] ? (m[1] === 'https:' ? 443 : 80) : 0), path: (m[4] || '/').replace(/^(?!\/)/, '/'), search: m[5] || '', query: query };
    }
    var isLocal = function (u) { return !u.host || /^(localhost|127\.0\.0\.1|0\.0\.0\.0|mock|api\.mock)$/i.test(u.host); };
    function readBody(init) {
        var b = init && init.body;
        if (b == null) return undefined;
        if (typeof b === 'string') { try { return JSON.parse(b); } catch (e) { return b; } }
        return b;
    }
    var lowerHeaders = function (h) {
        var o = {};
        if (!h) return o;
        if (typeof h.forEach === 'function' && !Array.isArray(h)) { h.forEach(function (v, k) { o[String(k).toLowerCase()] = String(v); }); return o; }
        if (Array.isArray(h)) { h.forEach(function (p) { o[String(p[0]).toLowerCase()] = String(p[1]); }); return o; }
        Object.keys(h).forEach(function (k) { o[k.toLowerCase()] = String(h[k]); });
        return o;
    };

    // ------------------------------------------------------------------ #160 http servers + express-lite
    var servers = {};
    function makeReq(r) {
        var u = parseUrl(r.url || r.path || '/');
        var headers = lowerHeaders(r.headers);
        var req = { method: String(r.method || 'GET').toUpperCase(), url: u.path + u.search, originalUrl: u.path + u.search, path: u.path, query: u.query, headers: headers, body: r.body, params: {}, ip: '127.0.0.1', protocol: 'http', hostname: 'localhost',
            get: function (h) { return headers[String(h).toLowerCase()]; }, on: function (ev, cb) { if (ev === 'data' && r.raw != null) cb(r.raw); if (ev === 'end') Promise.resolve().then(cb); return req; } };
        req.header = req.get;
        return req;
    }
    function makeResObj(done) {
        var res = { statusCode: 200, headers: {}, _chunks: [], finished: false, locals: {} };
        res.status = function (c) { res.statusCode = c; return res; };
        res.setHeader = res.set = res.header = function (k, v) { if (typeof k === 'object') Object.keys(k).forEach(function (n) { res.headers[n.toLowerCase()] = String(k[n]); }); else res.headers[String(k).toLowerCase()] = String(v); return res; };
        res.getHeader = res.get = function (k) { return res.headers[String(k).toLowerCase()]; };
        res.type = function (t) { return res.set('content-type', /\//.test(t) ? t : t === 'json' ? 'application/json' : t === 'html' ? 'text/html' : 'text/plain'); };
        res.writeHead = function (c, h) { res.statusCode = c; if (h) res.set(h); return res; };
        res.write = function (c) { res._chunks.push(String(c)); return true; };
        res.end = function (c) { if (res.finished) return res; if (c != null) res._chunks.push(typeof c === 'string' ? c : String(c)); res.finished = true; done({ status: res.statusCode, headers: res.headers, body: res._chunks.join('') }); return res; };
        res.json = function (o) { if (!res.headers['content-type']) res.set('content-type', 'application/json'); return res.end(JSON.stringify(o === undefined ? null : o)); };
        res.send = function (b) { if (b && typeof b === 'object') return res.json(b); if (typeof b === 'number') { res.statusCode = b; return res.end(String(b)); } if (!res.headers['content-type']) res.set('content-type', /^\s*</.test(String(b)) ? 'text/html' : 'text/plain'); return res.end(b == null ? '' : String(b)); };
        res.sendStatus = function (c) { res.statusCode = c; return res.end(String(c)); };
        res.redirect = function (a, b) { var code = typeof a === 'number' ? a : 302; res.statusCode = code; res.set('location', typeof a === 'number' ? b : a); return res.end(''); };
        res.cookie = function (k, v) { res.set('set-cookie', k + '=' + v); return res; };
        res.clearCookie = function () { return res; };
        return res;
    }
    function dispatch(port, r) {
        var handler = servers[port];
        if (!handler) return Promise.resolve({ status: 502, headers: { 'content-type': 'text/plain' }, body: 'لا يوجد خادم على المنفذ ' + port });
        return new Promise(function (resolve) {
            var t = setTimeout(function () { resolve({ status: 504, headers: { 'content-type': 'text/plain' }, body: 'انتهت المهلة: لم يستدعِ الخادم res.end()' }); }, 10000);
            var res = makeResObj(function (out) { clearTimeout(t); resolve(out); });
            try { handler(makeReq(r), res); } catch (e) { clearTimeout(t); resolve({ status: 500, headers: { 'content-type': 'text/plain' }, body: String(e && e.stack || e) }); }
        });
    }
    function createServer(opts, h) {
        var handler = typeof opts === 'function' ? opts : h;
        var srv = { _port: null, listening: false };
        srv.listen = function (port, host, cb) {
            var done = typeof host === 'function' ? host : cb;
            var p = +port || 3000;
            if (servers[p]) { var e = new Error('listen EADDRINUSE: address already in use :::' + p); e.code = 'EADDRINUSE'; throw e; }
            servers[p] = function (req, res) { return handler && handler(req, res); };
            srv._port = p; srv.listening = true;
            x.keep();
            x.send({ type: 'listen', port: p });
            if (done) Promise.resolve().then(done);
            return srv;
        };
        srv.close = function (cb) { if (srv._port != null && servers[srv._port]) { delete servers[srv._port]; x.send({ type: 'close', port: srv._port }); srv.listening = false; x.release(); } if (cb) Promise.resolve().then(cb); return srv; };
        srv.address = function () { return { port: srv._port, address: '::', family: 'IPv6' }; };
        srv.on = srv.once = function () { return srv; };
        return srv;
    }
    function compilePath(p) {
        if (p instanceof RegExp) return { re: p, keys: [] };
        var keys = [];
        var src = String(p || '/').replace(/\/+$/, '') || '';
        var re = src.replace(/[.+?^${}()|[\]\\]/g, function (c) { return c === '?' ? '?' : '\\' + c; })
            .replace(/\\\(|\\\)/g, '')
            .replace(/\/:(\w+)(\?)?/g, function (m, k, opt) { keys.push(k); return opt ? '(?:/([^/]+))?' : '/([^/]+)'; })
            .replace(/\*/g, '(.*)');
        return { re: new RegExp('^' + re + '/?$', 'i'), prefix: new RegExp('^' + re + '(?=/|$)', 'i'), keys: keys };
    }
    function express() {
        var stack = [], settings = {};
        var app = function (req, res, outNext) { handle(req, res, outNext); };
        function add(method, path, fns, isUse) {
            if (typeof path === 'function' || (path && path.__router)) { fns = [path].concat(fns); path = '/'; }
            fns.forEach(function (fn) { stack.push({ method: method, path: path, m: compilePath(path), fn: fn, use: isUse }); });
        }
        function handle(req, res, outNext) {
            var i = 0, base = req.baseUrl || '';
            var origPath = req.path;
            function next(err) {
                if (res.finished) return;
                var layer = stack[i++];
                if (!layer) {
                    req.path = origPath;
                    if (outNext) return outNext(err);
                    if (err) { res.status(err.status || 500).json({ error: String(err.message || err) }); return; }
                    res.status(404).set('content-type', 'text/plain').end('Cannot ' + req.method + ' ' + req.path);
                    return;
                }
                if (!layer.use && layer.method !== 'ALL' && layer.method !== req.method && !(layer.method === 'GET' && req.method === 'HEAD')) return next(err);
                var hit = layer.use ? (layer.path === '/' ? [''] : layer.m.prefix.exec(req.path)) : layer.m.re.exec(req.path);
                if (!hit) return next(err);
                var params = {};
                layer.m.keys.forEach(function (k, j) { if (hit[j + 1] !== undefined) params[k] = decodeURIComponent(hit[j + 1]); });
                req.params = Object.assign({}, req.params, params);
                var fn = layer.fn;
                var arity = fn.length;
                try {
                    if (err) { if (arity === 4) return fn(err, req, res, next); return next(err); }
                    if (arity === 4) return next();
                    if (layer.use && layer.path !== '/' && (fn.__router || fn.__app)) {
                        var stripped = req.path.slice(hit[0].length) || '/';
                        req.baseUrl = base + hit[0];
                        req.path = stripped;
                        return fn(req, res, function (e) { req.path = origPath; req.baseUrl = base; next(e); });
                    }
                    var r = fn(req, res, next);
                    if (r && typeof r.then === 'function') r.then(null, next);
                } catch (e) { next(e); }
            }
            next();
        }
        ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all'].forEach(function (m) {
            app[m] = function (path) {
                if (m === 'get' && arguments.length === 1 && typeof path === 'string') return settings[path];
                add(m.toUpperCase(), path, Array.prototype.slice.call(arguments, 1));
                return app;
            };
        });
        app.del = app['delete'];
        app.use = function (path) { add('USE', path, Array.prototype.slice.call(arguments, 1), true); return app; };
        app.route = function (path) { var r = {}; ['get', 'post', 'put', 'patch', 'delete', 'all'].forEach(function (m) { r[m] = function () { add(m.toUpperCase(), path, Array.prototype.slice.call(arguments)); return r; }; }); return r; };
        app.set = function (k, v) { settings[k] = v; return app; };
        app.enable = function (k) { settings[k] = true; return app; };
        app.disable = function (k) { settings[k] = false; return app; };
        app.listen = function (port, host, cb) { return createServer(app).listen(port, host, cb); };
        app.locals = {};
        app.__app = true;
        return app;
    }
    express.json = function () { return function (req, res, next) { if (typeof req.body === 'string') { try { req.body = JSON.parse(req.body); } catch (e) { /* keep text */ } } next(); }; };
    express.urlencoded = function () { return function (req, res, next) { if (typeof req.body === 'string' && /=/.test(req.body)) { var o = {}; req.body.split('&').forEach(function (kv) { var i = kv.indexOf('='); o[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); }); req.body = o; } next(); }; };
    express.text = function () { return function (req, res, next) { next(); }; };
    express.static = function () { return function (req, res, next) { next(); }; };
    express.Router = function () { var r = express(); r.__router = true; return r; };
    var cors = function () { return function (req, res, next) { res.set('access-control-allow-origin', '*'); res.set('access-control-allow-headers', '*'); res.set('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS'); if (req.method === 'OPTIONS') return res.sendStatus(204); next(); }; };
    var httpMod = { createServer: createServer, STATUS_CODES: { 200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 500: 'Internal Server Error' } };
    x.BUILTIN.http = function () { return httpMod; };
    x.BUILTIN.https = function () { return httpMod; };
    x.BUILTIN.express = function () { return express; };
    x.BUILTIN.cors = function () { return cors; };
    x.BUILTIN['body-parser'] = function () { return { json: express.json, urlencoded: express.urlencoded, text: express.text }; };
    x.onMessage(function (d) {
        if (d.type !== 'req') return;
        var t0 = now();
        dispatch(+d.port, d).then(function (out) { x.send({ type: 'res', id: d.id, status: out.status, headers: out.headers, body: out.body, ms: Math.round(now() - t0) }); });
    });

    // ------------------------------------------------------------------ #228 mock auth (+ jsonwebtoken / bcryptjs stand-ins)
    var b64u = function (s) { var b = typeof G.btoa === 'function' ? G.btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'); return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
    var unb64u = function (s) { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return typeof G.atob === 'function' ? decodeURIComponent(escape(G.atob(s))) : Buffer.from(s, 'base64').toString('utf8'); };
    var fnv = function (s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; };
    var mockSig = function (data, secret) { var a = fnv(secret + '.' + data), b = fnv(data + '.' + secret + '.' + a); return b64u(a.toString(16) + b.toString(16) + '.mock'); };
    var parseExp = function (v) { if (v == null) return null; if (typeof v === 'number') return v; var m = /^(\d+)\s*([smhd])?$/.exec(String(v)); return m ? +m[1] * ({ s: 1, m: 60, h: 3600, d: 86400 }[m[2] || 's']) : null; };
    var jwt = {
        sign: function (payload, secret, opts) {
            opts = opts || {};
            var p = Object.assign({}, payload, { iat: Math.floor(Date.now() / 1000) });
            var ex = parseExp(opts.expiresIn);
            if (ex) p.exp = p.iat + ex;
            var head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT', mock: true })), body = b64u(JSON.stringify(p));
            return head + '.' + body + '.' + mockSig(head + '.' + body, String(secret || 'ox-mock-secret'));
        },
        decode: function (token) { try { return JSON.parse(unb64u(String(token).split('.')[1])); } catch (e) { return null; } },
        verify: function (token, secret) {
            var parts = String(token || '').split('.');
            var err = function (m, n) { var e = new Error(m); e.name = n || 'JsonWebTokenError'; throw e; };
            if (parts.length !== 3) err('jwt malformed');
            if (mockSig(parts[0] + '.' + parts[1], String(secret || 'ox-mock-secret')) !== parts[2]) err('invalid signature');
            var p = jwt.decode(token);
            if (p && p.exp && p.exp < Date.now() / 1000) err('jwt expired', 'TokenExpiredError');
            return p;
        }
    };
    var bcrypt = {
        hashSync: function (pw) { return '$2b$mock$' + fnv('salt:' + pw).toString(36) + fnv(pw + ':pepper').toString(36); },
        compareSync: function (pw, hash) { return bcrypt.hashSync(pw) === hash; },
        hash: function (pw, r, cb) { var h = bcrypt.hashSync(pw); if (typeof cb === 'function') { cb(null, h); return; } return Promise.resolve(h); },
        compare: function (pw, hash, cb) { var ok = bcrypt.compareSync(pw, hash); if (typeof cb === 'function') { cb(null, ok); return; } return Promise.resolve(ok); },
        genSaltSync: function () { return '$2b$10$mock'; }, genSalt: function () { return Promise.resolve('$2b$10$mock'); }
    };
    x.BUILTIN.jsonwebtoken = function () { return jwt; };
    x.BUILTIN.bcryptjs = x.BUILTIN.bcrypt = function () { return bcrypt; };
    var authCfg = cfg.auth || null;
    var AUTH = { secret: (authCfg && authCfg.secret) || 'ox-mock-secret', expiresIn: (authCfg && authCfg.expiresIn) || '1h', users: clone((authCfg && authCfg.users) || []) };
    var publicUser = function (u) { var o = Object.assign({}, u); delete o.password; delete o.passwordHash; return o; };
    var auth = {
        users: AUTH.users,
        sign: function (user) { return jwt.sign({ sub: user.id, email: user.email, role: user.role || 'user', name: user.name }, AUTH.secret, { expiresIn: AUTH.expiresIn }); },
        verify: function (token) { try { return jwt.verify(token, AUTH.secret); } catch (e) { return null; } },
        fromRequest: function (headers) { var h = lowerHeaders(headers).authorization || ''; var m = /^Bearer\s+(.+)$/i.exec(h); return m ? auth.verify(m[1]) : null; },
        register: function (b) {
            b = b || {};
            if (!b.email || !b.password) return { status: 400, body: { error: 'البريد وكلمة المرور مطلوبان' } };
            if (AUTH.users.some(function (u) { return String(u.email).toLowerCase() === String(b.email).toLowerCase(); })) return { status: 409, body: { error: 'البريد مسجل مسبقاً' } };
            var u = { id: AUTH.users.reduce(function (m, u2) { return Math.max(m, +u2.id || 0); }, 0) + 1, email: b.email, name: b.name || String(b.email).split('@')[0], role: 'user', password: b.password };
            AUTH.users.push(u);
            return { status: 201, body: { token: auth.sign(u), user: publicUser(u) } };
        },
        login: function (b) {
            b = b || {};
            var u = AUTH.users.find(function (x2) { return String(x2.email).toLowerCase() === String(b.email || '').toLowerCase() && (x2.password === b.password || (x2.passwordHash && bcrypt.compareSync(b.password, x2.passwordHash))); });
            return u ? { status: 200, body: { token: auth.sign(u), user: publicUser(u) } } : { status: 401, body: { error: 'بيانات الدخول غير صحيحة' } };
        },
        middleware: function (role) {
            return function (req, res, next) {
                var p = auth.fromRequest(req.headers);
                if (!p) return res.status(401).json({ error: 'غير مصرح — أرسل Authorization: Bearer <token>' });
                if (role && p.role !== role && p.role !== 'admin') return res.status(403).json({ error: 'صلاحيات غير كافية' });
                req.user = p;
                next();
            };
        }
    };
    x.BUILTIN['ox-auth'] = function () { return auth; };

    // ------------------------------------------------------------------ #226 mock database (json-server semantics)
    var db = clone(cfg.db || {}) || {};
    var dbChanged = false;
    var nextId = function (list) { var nums = list.map(function (r) { return +r.id; }).filter(function (n) { return !isNaN(n); }); return nums.length === list.length ? (nums.length ? Math.max.apply(null, nums) : 0) + 1 : Date.now().toString(36) + Math.random().toString(36).slice(2, 6); };
    var sameId = function (a, b) { return String(a) === String(b); };
    function queryList(list, q) {
        var out = list.slice();
        Object.keys(q).forEach(function (k) {
            if (/^_/.test(k) || k === 'q') return;
            var v = q[k], m = /^(.+)_(gte|lte|ne|like)$/.exec(k), f = m ? m[1] : k, op = m ? m[2] : 'eq';
            var get = function (r) { return f.split('.').reduce(function (o, p) { return o == null ? o : o[p]; }, r); };
            out = out.filter(function (r) {
                var x2 = get(r), vals = [].concat(v);
                if (op === 'gte') return x2 >= (+v || v);
                if (op === 'lte') return x2 <= (+v || v);
                if (op === 'ne') return vals.every(function (y) { return String(x2) !== y; });
                if (op === 'like') return new RegExp(v, 'i').test(String(x2));
                return vals.some(function (y) { return String(x2) === y; });
            });
        });
        if (q.q) { var t = String(q.q).toLowerCase(); out = out.filter(function (r) { return JSON.stringify(r).toLowerCase().indexOf(t) >= 0; }); }
        if (q._sort) {
            var keys = String(q._sort).split(','), ord = String(q._order || 'asc').split(',');
            out.sort(function (a, b) { for (var i = 0; i < keys.length; i++) { var k = keys[i].replace(/^-/, ''), d = (keys[i][0] === '-' || ord[i] === 'desc') ? -1 : 1; if (a[k] < b[k]) return -d; if (a[k] > b[k]) return d; } return 0; });
        }
        var total = out.length;
        if (q._start != null || q._end != null || q._limit != null) { var st = +(q._start || 0); out = out.slice(st, q._end != null ? +q._end : st + +(q._limit || out.length)); }
        if (q._page) { var per = +(q._limit || q._per_page || 10), pg = +q._page; out = list.length ? out.slice(0, out.length) : out; out = queryList(list, Object.assign({}, q, { _page: undefined, _limit: undefined, _start: (pg - 1) * per, _end: pg * per })); }
        return { rows: out, total: total };
    }
    function dbRequest(method, col, id, query, body) {
        if (!(col in db)) return null;
        var coll = db[col];
        if (!Array.isArray(coll)) {
            if (method === 'GET') return { status: 200, body: coll };
            if (method === 'PUT') { db[col] = body; dbChanged = true; return { status: 200, body: body }; }
            if (method === 'PATCH') { db[col] = Object.assign({}, coll, body); dbChanged = true; return { status: 200, body: db[col] }; }
            return { status: 405, body: { error: 'Method not allowed' } };
        }
        var idx = id == null ? -1 : coll.findIndex(function (r) { return sameId(r.id, id); });
        if (method === 'GET') {
            if (id != null) return idx < 0 ? { status: 404, body: {} } : { status: 200, body: coll[idx] };
            var r = queryList(coll, query || {});
            return { status: 200, body: r.rows, headers: { 'x-total-count': String(r.total) } };
        }
        if (method === 'POST') { if (id != null) return { status: 404, body: {} }; var row = Object.assign({ id: nextId(coll) }, body && typeof body === 'object' ? body : {}); if (body && body.id != null) row.id = body.id; coll.push(row); dbChanged = true; return { status: 201, body: row }; }
        if (idx < 0) return { status: 404, body: {} };
        if (method === 'PUT') { coll[idx] = Object.assign({}, body, { id: coll[idx].id }); dbChanged = true; return { status: 200, body: coll[idx] }; }
        if (method === 'PATCH') { coll[idx] = Object.assign({}, coll[idx], body, { id: coll[idx].id }); dbChanged = true; return { status: 200, body: coll[idx] }; }
        if (method === 'DELETE') { coll.splice(idx, 1); dbChanged = true; return { status: 200, body: {} }; }
        return { status: 405, body: { error: 'Method not allowed' } };
    }
    var dbApi = {
        data: db,
        collections: function () { return Object.keys(db); },
        all: function (c) { return (db[c] || []).slice(); },
        get: function (c, id) { return (db[c] || []).find(function (r) { return sameId(r.id, id); }) || null; },
        find: function (c, pred) { var list = db[c] || []; return typeof pred === 'function' ? list.filter(pred) : queryList(list, pred || {}).rows; },
        insert: function (c, row) { if (!db[c]) db[c] = []; return dbRequest('POST', c, null, {}, row).body; },
        update: function (c, id, patch) { var r = dbRequest('PATCH', c, id, {}, patch); return r && r.status === 200 ? r.body : null; },
        remove: function (c, id) { var r = dbRequest('DELETE', c, id, {}); return !!(r && r.status === 200); },
        reset: function () { Object.keys(db).forEach(function (k) { delete db[k]; }); Object.assign(db, clone(cfg.db || {})); dbChanged = false; }
    };
    x.BUILTIN['ox-db'] = function () { return dbApi; };
    x.beforeDone(function () { if (cfg.db) x.send({ type: 'db', data: db, changed: dbChanged }); });

    // ------------------------------------------------------------------ fetch routing: servers → auth → db
    x.onFetch(function (url, init) {
        var u = parseUrl(url);
        if (!isLocal(u)) return null;
        var method = String(init.method || 'GET').toUpperCase();
        if (u.port && servers[u.port]) {
            return dispatch(u.port, { method: method, url: u.path + u.search, headers: init.headers, body: readBody(init) }).then(function (r) { return x.makeRes(r.status, r.body, r.headers, url); });
        }
        var p = u.path.replace(/\/+$/, '') || '/';
        if (authCfg && /^\/(api\/)?auth\/(register|signup|login|me|logout)$/.test(p)) {
            var op = /(register|signup|login|me|logout)$/.exec(p)[1];
            var out;
            if (op === 'me') { var pl = auth.fromRequest(init.headers); var usr = pl && AUTH.users.find(function (z) { return sameId(z.id, pl.sub); }); out = usr ? { status: 200, body: publicUser(usr) } : { status: 401, body: { error: 'غير مصرح' } }; }
            else if (op === 'logout') out = { status: 204, body: '' };
            else out = op === 'login' ? auth.login(readBody(init)) : auth.register(readBody(init));
            return x.makeRes(out.status, out.body, null, url);
        }
        var m = /^\/(?:api\/)?([\w-]+)(?:\/([^/]+))?$/.exec(p);
        if (m && cfg.db && m[1] in db) {
            var r2 = dbRequest(method, m[1], m[2] != null ? decodeURIComponent(m[2]) : null, u.query, readBody(init));
            if (r2) return x.makeRes(r2.status, r2.body, r2.headers, url);
        }
        // json-server semantics: with a mock DB, unknown /api/* routes are a local 404 (not a network call)
        if (cfg.db && /^\/api\//.test(p)) return x.makeRes(404, { error: 'لا توجد مجموعة بهذا الاسم في mocks/db.json', collections: Object.keys(db) }, null, url);
        return null;
    });

    // ------------------------------------------------------------------ #166 snapshots
    var snaps = cfg.snapshots || {}, used = {};
    var serialize = function (v) { return typeof v === 'string' ? JSON.stringify(v) : x.fmt(v, 12); };
    var dedent = function (s) { var lines = String(s).replace(/^\n/, '').replace(/\n\s*$/, '').split('\n'); var ind = Math.min.apply(null, lines.filter(function (l) { return l.trim(); }).map(function (l) { return /^\s*/.exec(l)[0].length; }).concat([1e9])); return lines.map(function (l) { return l.slice(ind === 1e9 ? 0 : ind); }).join('\n'); };
    x.matcher('toMatchSnapshot', function (hint) {
        var file = x.T.currentFile || '(unknown)', key = (this.test || '') + (typeof hint === 'string' ? ': ' + hint : '') + ' ' + (++x.T.counter);
        var value = serialize(this.actual), store = snaps[file] || (snaps[file] = {});
        (used[file] = used[file] || []).push(key);
        if (!(key in store)) { store[key] = value; x.send({ type: 'snapshot', file: file, key: key, value: value, status: 'new' }); return { pass: !this.negate }; }
        if (store[key] === value) { x.send({ type: 'snapshot', file: file, key: key, status: 'match' }); return { pass: true }; }
        if (cfg.updateSnapshots) { store[key] = value; x.send({ type: 'snapshot', file: file, key: key, value: value, status: 'updated' }); return { pass: !this.negate }; }
        x.send({ type: 'snapshot', file: file, key: key, value: value, status: 'fail' });
        return { pass: false, message: 'لقطة «' + key + '» لا تطابق المحفوظة — حدّثها إن كان التغيير مقصوداً', expected: store[key] };
    });
    x.matcher('toMatchInlineSnapshot', function (inline) {
        var value = serialize(this.actual);
        if (inline === undefined) return { pass: false, message: 'أضف اللقطة: toMatchInlineSnapshot(`' + value + '`)' };
        return { pass: dedent(inline) === dedent(value), message: 'اللقطة المضمنة لا تطابق', expected: dedent(inline) };
    });
    x.beforeDone(function () { if (Object.keys(used).length) x.send({ type: 'snapshots-used', used: used }); });

    // ------------------------------------------------------------------ #168 bench()
    function runBench(name, fn, opts) {
        opts = opts || {};
        var budget = opts.time || 300, minIter = opts.iterations || 5, samples = [], t0 = now();
        var one = function () { var s = now(); var r = fn(); if (r && typeof r.then === 'function') return r.then(function () { samples.push(now() - s); }); samples.push(now() - s); return null; };
        var loop = function () {
            while (samples.length < (opts.maxIterations || 100000) && (now() - t0 < budget || samples.length < minIter)) { var p = one(); if (p) return p.then(loop); }
            return null;
        };
        var warm = opts.warmup == null ? 3 : opts.warmup;
        var w = Promise.resolve();
        for (var i = 0; i < warm; i++) w = w.then(function () { return fn(); });
        return w.then(function () { samples = []; t0 = now(); return loop(); }).then(function () {
            var s = samples.slice().sort(function (a, b) { return a - b; }), n = s.length;
            var mean = s.reduce(function (a, b) { return a + b; }, 0) / (n || 1);
            var sd = Math.sqrt(s.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / Math.max(1, n - 1));
            var q = function (p) { return s[Math.min(n - 1, Math.floor(p * (n - 1)))] || 0; };
            var st = { name: name, file: x.T.currentFile || '', n: n, mean: mean, min: s[0] || 0, max: s[n - 1] || 0, p75: q(0.75), p99: q(0.99), sd: sd, rme: n > 1 && mean ? (1.96 * sd / Math.sqrt(n)) / mean * 100 : 0, hz: mean ? 1000 / mean : 0 };
            x.send({ type: 'bench', stats: st });
            if (opts.maxMs != null && mean > opts.maxMs) { var e = new Error('«' + name + '» أبطأ من الحد: ' + mean.toFixed(3) + 'ms > ' + opts.maxMs + 'ms'); e.name = 'AssertionError'; throw e; }
            return st;
        });
    }
    G.bench = function (name, fn, opts) { x.T.it('⏱ ' + name, function () { return runBench(name, fn, opts); }, ((opts && opts.time) || 300) * 4 + 5000); };
    G.bench.run = runBench;
}
export const rtExtSource = '(' + oxRuntimeExt.toString() + ')';
