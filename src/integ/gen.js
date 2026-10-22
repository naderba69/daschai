/* Code generators (pure): #124 full auth system • #125 RBAC • #991-#994 service integrations. */

// ====================================================================== #124 AUTH SYSTEM
export const AUTH_DEFAULTS = { stack: 'express', storage: 'memory', refresh: true, verify: true, reset: true, rateLimit: true, roles: true, frontend: true, port: 3000 };

const STORE = {
    memory: `// In-memory users store (swap for a database in production)
const users = [];
let seq = 0;
module.exports = {
    async findByEmail(email) { return users.find(u => u.email === String(email).toLowerCase()) || null; },
    async findById(id) { return users.find(u => u.id === id) || null; },
    async create(data) { const u = { id: String(++seq), createdAt: new Date().toISOString(), ...data, email: String(data.email).toLowerCase() }; users.push(u); return u; },
    async update(id, patch) { const u = users.find(x => x.id === id); if (u) Object.assign(u, patch); return u || null; },
    async all() { return users.slice(); },
    _reset() { users.length = 0; seq = 0; }
};
`,
    json: `// JSON-file users store (data/users.json) — fine for prototypes and small apps
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data', 'users.json');
const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return []; } };
const save = (list) => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(list, null, 2)); };
module.exports = {
    async findByEmail(email) { return load().find(u => u.email === String(email).toLowerCase()) || null; },
    async findById(id) { return load().find(u => u.id === id) || null; },
    async create(data) { const list = load(); const u = { id: String(Date.now()) + Math.random().toString(36).slice(2, 6), createdAt: new Date().toISOString(), ...data, email: String(data.email).toLowerCase() }; list.push(u); save(list); return u; },
    async update(id, patch) { const list = load(); const u = list.find(x => x.id === id); if (u) { Object.assign(u, patch); save(list); } return u || null; },
    async all() { return load(); }
};
`,
    prisma: `// Prisma users store (see prisma/schema.prisma) — run: npx prisma migrate dev --name init
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
module.exports = {
    findByEmail: (email) => prisma.user.findUnique({ where: { email: String(email).toLowerCase() } }),
    findById: (id) => prisma.user.findUnique({ where: { id } }),
    create: (data) => prisma.user.create({ data: { ...data, email: String(data.email).toLowerCase() } }),
    update: (id, patch) => prisma.user.update({ where: { id }, data: patch }),
    all: () => prisma.user.findMany()
};
`
};

export function authFiles(o = {}) {
    o = { ...AUTH_DEFAULTS, ...o };
    const F = {};
    F['auth/config.js'] = `// Auth configuration — every secret comes from the environment (.env)
const env = (typeof process !== 'undefined' && process.env) || {};
module.exports = {
    accessSecret: env.JWT_SECRET || 'dev-access-secret-change-me',
    refreshSecret: env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me',
    accessTtl: env.JWT_TTL || '15m',
    refreshTtl: env.JWT_REFRESH_TTL || '7d',
    bcryptRounds: Number(env.BCRYPT_ROUNDS || 10),
    appUrl: env.APP_URL || 'http://localhost:${o.port}'
};
`;
    F['auth/store.js'] = STORE[o.storage] || STORE.memory;
    F['auth/validate.js'] = `// Input validation for auth forms
const EMAIL = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/;
function validateEmail(email) { return EMAIL.test(String(email || '').trim()) ? null : 'invalid email'; }
function validatePassword(pw) {
    const s = String(pw || '');
    if (s.length < 8) return 'password must be at least 8 characters';
    if (!/[A-Za-z]/.test(s) || !/\\d/.test(s)) return 'password must contain letters and numbers';
    return null;
}
module.exports = { validateEmail, validatePassword };
`;
    F['auth/tokens.js'] = `// JWT access tokens${o.refresh ? ' + rotating refresh tokens (reuse → whole family revoked)' : ''}
const jwt = require('jsonwebtoken');
const cfg = require('./config');
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const refreshStore = new Map(); // tokenId → { userId, family, revoked }

function signAccess(user) { return jwt.sign({ sub: user.id, email: user.email${o.roles ? ', role: user.role' : ''} }, cfg.accessSecret, { expiresIn: cfg.accessTtl }); }
function verifyAccess(token) { return jwt.verify(token, cfg.accessSecret); }
${o.refresh ? `function signRefresh(user, family) {
    const id = rid();
    family = family || rid();
    refreshStore.set(id, { userId: user.id, family, revoked: false });
    return jwt.sign({ sub: user.id, jti: id, fam: family }, cfg.refreshSecret, { expiresIn: cfg.refreshTtl });
}
function rotateRefresh(token) {
    const p = jwt.verify(token, cfg.refreshSecret);
    const rec = refreshStore.get(p.jti);
    if (!rec || rec.revoked) { revokeFamily(p.fam); const e = new Error('refresh token reused or revoked'); e.status = 401; throw e; }
    rec.revoked = true;
    return { userId: p.sub, family: p.fam };
}
function revokeFamily(family) { for (const r of refreshStore.values()) if (r.family === family) r.revoked = true; }
function revokeToken(token) { try { const p = jwt.verify(token, cfg.refreshSecret); revokeFamily(p.fam); } catch (e) { /* already invalid */ } }
module.exports = { signAccess, verifyAccess, signRefresh, rotateRefresh, revokeToken };` : 'module.exports = { signAccess, verifyAccess };'}
`;
    F['auth/middleware.js'] = `// Express middleware: requireAuth${o.roles ? ', requireRole' : ''}${o.rateLimit ? ', rateLimit' : ''}
const { verifyAccess } = require('./tokens');
function requireAuth(req, res, next) {
    const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
    const m = /^Bearer\\s+(.+)$/i.exec(h);
    if (!m) return res.status(401).json({ error: 'missing token' });
    try { req.user = verifyAccess(m[1]); return next(); } catch (e) { return res.status(401).json({ error: e.name === 'TokenExpiredError' ? 'token expired' : 'invalid token' }); }
}
${o.roles ? `function requireRole(...roles) {
    return (req, res, next) => (req.user && roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'forbidden' }));
}
` : ''}${o.rateLimit ? `/** Tiny fixed-window limiter (use express-rate-limit / Redis in production). */
function rateLimit({ windowMs = 60000, max = 10 } = {}) {
    const hits = new Map();
    return (req, res, next) => {
        const key = (req.ip || (req.headers && req.headers['x-forwarded-for']) || 'local') + ':' + req.path;
        const now = Date.now();
        const h = hits.get(key) || { n: 0, t: now };
        if (now - h.t > windowMs) { h.n = 0; h.t = now; }
        h.n++;
        hits.set(key, h);
        if (h.n > max) return res.status(429).json({ error: 'too many requests, try again later' });
        return next();
    };
}
` : ''}module.exports = { requireAuth${o.roles ? ', requireRole' : ''}${o.rateLimit ? ', rateLimit' : ''} };
`;
    F['auth/routes.js'] = `// /api/auth routes: register, login${o.refresh ? ', refresh, logout' : ''}, me${o.verify ? ', verify' : ''}${o.reset ? ', forgot, reset' : ''}
const express = require('express');
const bcrypt = require('bcryptjs');
const cfg = require('./config');
const store = require('./store');
const tokens = require('./tokens');
const { validateEmail, validatePassword } = require('./validate');
const { requireAuth${o.rateLimit ? ', rateLimit' : ''} } = require('./middleware');
const router = express.Router();
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name || ''${o.roles ? ', role: u.role' : ''}${o.verify ? ', verified: !!u.verified' : ''} });
const session = (u) => ({ user: publicUser(u), accessToken: tokens.signAccess(u)${o.refresh ? ', refreshToken: tokens.signRefresh(u)' : ''} });
${o.rateLimit ? "const limiter = rateLimit({ windowMs: 60000, max: 10 });\n" : ''}
router.post('/register', ${o.rateLimit ? 'limiter, ' : ''}async (req, res) => {
    const { email, password, name } = req.body || {};
    const err = validateEmail(email) || validatePassword(password);
    if (err) return res.status(400).json({ error: err });
    if (await store.findByEmail(email)) return res.status(409).json({ error: 'email already registered' });
    const first = (await store.all()).length === 0;
    const user = await store.create({ email, name: name || '', passwordHash: await bcrypt.hash(password, cfg.bcryptRounds)${o.roles ? ", role: first ? 'admin' : 'user'" : ''}${o.verify ? ', verified: false, verifyToken: rid()' : ''} });
${o.verify ? "    // TODO: send cfg.appUrl + '/api/auth/verify?token=' + user.verifyToken by email (SendGrid / Resend)\n" : ''}    return res.status(201).json(session(user));
});

router.post('/login', ${o.rateLimit ? 'limiter, ' : ''}async (req, res) => {
    const { email, password } = req.body || {};
    const user = await store.findByEmail(email || '');
    if (!user || !(await bcrypt.compare(String(password || ''), user.passwordHash))) return res.status(401).json({ error: 'invalid email or password' });
    return res.json(session(user));
});
${o.refresh ? `
router.post('/refresh', async (req, res) => {
    try {
        const { userId, family } = tokens.rotateRefresh((req.body || {}).refreshToken);
        const user = await store.findById(userId);
        if (!user) return res.status(401).json({ error: 'user not found' });
        return res.json({ accessToken: tokens.signAccess(user), refreshToken: tokens.signRefresh(user, family) });
    } catch (e) { return res.status(401).json({ error: e.message || 'invalid refresh token' }); }
});

router.post('/logout', (req, res) => { tokens.revokeToken((req.body || {}).refreshToken); res.status(204).end(); });
` : ''}
router.get('/me', requireAuth, async (req, res) => {
    const user = await store.findById(req.user.sub);
    if (!user) return res.status(404).json({ error: 'not found' });
    return res.json(publicUser(user));
});
${o.verify ? `
router.get('/verify', async (req, res) => {
    const token = (req.query && req.query.token) || '';
    const user = (await store.all()).find(u => u.verifyToken && u.verifyToken === token);
    if (!user) return res.status(400).json({ error: 'invalid verification link' });
    await store.update(user.id, { verified: true, verifyToken: null });
    return res.json({ ok: true });
});
` : ''}${o.reset ? `
router.post('/forgot', ${o.rateLimit ? 'limiter, ' : ''}async (req, res) => {
    const user = await store.findByEmail((req.body || {}).email || '');
    if (user) {
        await store.update(user.id, { resetToken: rid(), resetExpires: Date.now() + 3600 * 1000 });
        // TODO: email cfg.appUrl + '/reset.html?token=' + resetToken
    }
    return res.json({ ok: true }); // same answer whether or not the email exists
});

router.post('/reset', async (req, res) => {
    const { token, password } = req.body || {};
    const err = validatePassword(password);
    if (err) return res.status(400).json({ error: err });
    const user = (await store.all()).find(u => u.resetToken && u.resetToken === token && u.resetExpires > Date.now());
    if (!user) return res.status(400).json({ error: 'invalid or expired reset token' });
    await store.update(user.id, { passwordHash: await bcrypt.hash(password, cfg.bcryptRounds), resetToken: null, resetExpires: null });
    return res.json({ ok: true });
});
` : ''}
module.exports = router;
`;
    F['server.js'] = `// API server with the generated auth system
const express = require('express');
const authRoutes = require('./auth/routes');
const { requireAuth${o.roles ? ', requireRole' : ''} } = require('./auth/middleware');
const app = express();
app.use(express.json());
${o.frontend ? "app.use(express.static('public'));\n" : ''}app.use('/api/auth', authRoutes);
app.get('/api/private', requireAuth, (req, res) => res.json({ message: 'hello ' + req.user.email }));
${o.roles ? "app.get('/api/admin', requireAuth, requireRole('admin'), (req, res) => res.json({ message: 'admin area' }));\n" : ''}
const PORT = Number((typeof process !== 'undefined' && process.env && process.env.PORT) || ${o.port});
if (typeof require !== 'undefined' && require.main === module) app.listen(PORT, () => console.log('API on http://localhost:' + PORT));
module.exports = app;
`;
    F['tests/auth.test.js'] = `// Integration tests: run in OX-Alpha (virtual ports) or with Jest/Vitest + Node 18+
const app = require('../server');
${o.storage === 'memory' ? "const store = require('../auth/store');\n" : ''}const PORT = 3999;
let server;
const call = async (method, path, body, token) => {
    const res = await fetch('http://localhost:' + PORT + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
};

describe('auth', () => {
    beforeAll(() => { server = app.listen(PORT); });
    afterAll(() => server && server.close());
${o.storage === 'memory' ? '    beforeEach(() => store._reset());\n' : ''}
    test('register → login → me', async () => {
        const r = await call('POST', '/api/auth/register', { email: 'Sara@Example.com', password: 'secret123', name: 'Sara' });
        expect(r.status).toBe(201);
        expect(r.body.user.email).toBe('sara@example.com');
${o.roles ? "        expect(r.body.user.role).toBe('admin');\n" : ''}        const l = await call('POST', '/api/auth/login', { email: 'sara@example.com', password: 'secret123' });
        expect(l.status).toBe(200);
        const me = await call('GET', '/api/auth/me', null, l.body.accessToken);
        expect(me.body.name).toBe('Sara');
    });

    test('rejects weak passwords, duplicates and bad logins', async () => {
        expect((await call('POST', '/api/auth/register', { email: 'a@b.co', password: 'short' })).status).toBe(400);
        await call('POST', '/api/auth/register', { email: 'a@b.co', password: 'secret123' });
        expect((await call('POST', '/api/auth/register', { email: 'a@b.co', password: 'secret123' })).status).toBe(409);
        expect((await call('POST', '/api/auth/login', { email: 'a@b.co', password: 'wrong-pass1' })).status).toBe(401);
        expect((await call('GET', '/api/auth/me')).status).toBe(401);
    });
${o.refresh ? `
    test('refresh tokens rotate and reuse is rejected', async () => {
        const r = await call('POST', '/api/auth/register', { email: 'r@b.co', password: 'secret123' });
        const a = await call('POST', '/api/auth/refresh', { refreshToken: r.body.refreshToken });
        expect(a.status).toBe(200);
        expect((await call('POST', '/api/auth/refresh', { refreshToken: r.body.refreshToken })).status).toBe(401);
        expect((await call('POST', '/api/auth/refresh', { refreshToken: a.body.refreshToken })).status).toBe(401);
    });
` : ''}${o.roles ? `
    test('roles: admin route is forbidden for normal users', async () => {
        const admin = await call('POST', '/api/auth/register', { email: 'admin@b.co', password: 'secret123' });
        const user = await call('POST', '/api/auth/register', { email: 'user@b.co', password: 'secret123' });
        expect((await call('GET', '/api/admin', null, admin.body.accessToken)).status).toBe(200);
        expect((await call('GET', '/api/admin', null, user.body.accessToken)).status).toBe(403);
    });
` : ''}${o.reset ? `
    test('password reset', async () => {
        await call('POST', '/api/auth/register', { email: 'p@b.co', password: 'secret123' });
        expect((await call('POST', '/api/auth/forgot', { email: 'p@b.co' })).status).toBe(200);
        expect((await call('POST', '/api/auth/reset', { token: 'nope', password: 'newpass123' })).status).toBe(400);
    });
` : ''}});
`;
    if (o.frontend) {
        F['public/login.html'] = `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>تسجيل الدخول</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0}form{background:#1e293b;padding:24px;border-radius:12px;width:min(340px,90vw);display:grid;gap:10px}input,button{padding:10px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:inherit}button{background:#2563eb;border:0;cursor:pointer}.tabs{display:flex;gap:8px}.tabs button{flex:1;background:#334155}.tabs .on{background:#2563eb}#msg{min-height:1.2em;font-size:.9em}</style></head>
<body>
<form id="f">
  <div class="tabs"><button type="button" id="t-login" class="on">دخول</button><button type="button" id="t-reg">حساب جديد</button></div>
  <input id="name" placeholder="الاسم" hidden>
  <input id="email" type="email" placeholder="البريد الإلكتروني" required autocomplete="email">
  <input id="password" type="password" placeholder="كلمة المرور (8+ أحرف وأرقام)" required autocomplete="current-password">
  <button id="go">دخول</button>
  <div id="msg"></div>
</form>
<script src="auth.js"></script>
</body></html>
`;
        F['public/auth.js'] = `// Browser client: login/register + automatic token refresh
const auth = {
    access: null,
    get refresh() { return localStorage.getItem('refreshToken'); },
    set refresh(v) { if (v) localStorage.setItem('refreshToken', v); else localStorage.removeItem('refreshToken'); },
    async post(path, body) { const r = await fetch('/api/auth/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j; },
    async login(email, password) { const s = await this.post('login', { email, password }); this.access = s.accessToken; this.refresh = s.refreshToken; return s.user; },
    async register(email, password, name) { const s = await this.post('register', { email, password, name }); this.access = s.accessToken; this.refresh = s.refreshToken; return s.user; },
    async fetch(url, opts = {}) {
        const go = () => fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + this.access } });
        let r = await go();
        if (r.status === 401 && this.refresh) { const t = await this.post('refresh', { refreshToken: this.refresh }).catch(() => null); if (t) { this.access = t.accessToken; this.refresh = t.refreshToken; r = await go(); } }
        return r;
    },
    async logout() { await this.post('logout', { refreshToken: this.refresh }).catch(() => {}); this.access = null; this.refresh = null; }
};
if (typeof document !== 'undefined' && document.getElementById('f')) {
    let mode = 'login';
    const $ = (id) => document.getElementById(id);
    const setMode = (m) => { mode = m; $('t-login').className = m === 'login' ? 'on' : ''; $('t-reg').className = m === 'reg' ? 'on' : ''; $('name').hidden = m !== 'reg'; $('go').textContent = m === 'reg' ? 'إنشاء الحساب' : 'دخول'; };
    $('t-login').onclick = () => setMode('login');
    $('t-reg').onclick = () => setMode('reg');
    $('f').onsubmit = async (e) => {
        e.preventDefault();
        try {
            const u = mode === 'reg' ? await auth.register($('email').value, $('password').value, $('name').value) : await auth.login($('email').value, $('password').value);
            $('msg').textContent = 'مرحباً ' + (u.name || u.email);
        } catch (err) { $('msg').textContent = '❌ ' + err.message; }
    };
}
`;
    }
    F['.env.example'] = `JWT_SECRET=change-me-to-a-long-random-string\nJWT_REFRESH_SECRET=change-me-too\nJWT_TTL=15m\nJWT_REFRESH_TTL=7d\nBCRYPT_ROUNDS=12\nAPP_URL=http://localhost:${o.port}\nPORT=${o.port}\n${o.storage === 'prisma' ? 'DATABASE_URL="file:./dev.db"\n' : ''}`;
    if (o.storage === 'prisma') F['prisma/schema.prisma'] = `generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "sqlite"\n  url      = env("DATABASE_URL")\n}\n\nmodel User {\n  id           String   @id @default(cuid())\n  email        String   @unique\n  name         String   @default("")\n  passwordHash String\n  role         String   @default("user")\n  verified     Boolean  @default(false)\n  verifyToken  String?\n  resetToken   String?\n  resetExpires BigInt?\n  createdAt    DateTime @default(now())\n}\n`;
    F['AUTH.md'] = `# نظام المصادقة\n\n| المسار | الوصف |\n|---|---|\n| \`POST /api/auth/register\` | إنشاء حساب (أول مستخدم = admin) |\n| \`POST /api/auth/login\` | دخول ← access token${o.refresh ? ' + refresh token' : ''} |\n${o.refresh ? '| `POST /api/auth/refresh` | تدوير refresh token (إعادة الاستخدام تُلغي العائلة كلها) |\n| `POST /api/auth/logout` | إلغاء refresh token |\n' : ''}| \`GET /api/auth/me\` | المستخدم الحالي (Bearer) |\n${o.verify ? '| `GET /api/auth/verify?token=` | تأكيد البريد |\n' : ''}${o.reset ? '| `POST /api/auth/forgot` و `POST /api/auth/reset` | استعادة كلمة المرور |\n' : ''}\n## التشغيل\n\n\`\`\`bash\nnpm i express jsonwebtoken bcryptjs${o.storage === 'prisma' ? ' @prisma/client && npx prisma migrate dev --name init' : ''}\ncp .env.example .env && node server.js\n\`\`\`\n\nداخل OX-Alpha: شغّل \`tests/auth.test.js\` مباشرة (express و jsonwebtoken و bcryptjs لها بدائل محلية في بيئة التشغيل).\n\n## قبل الإنتاج\n- أسرار JWT طويلة وعشوائية من متغيرات البيئة\n- HTTPS فقط، وrefresh token في كوكي httpOnly + SameSite\n- محدد معدل مشترك (Redis) وتسجيل محاولات الدخول\n`;
    return F;
}

// ====================================================================== #125 RBAC
export const RBAC_ACTIONS = ['create', 'read', 'update', 'delete'];
export const RBAC_SAMPLE = {
    roles: { guest: { inherits: [] }, user: { inherits: ['guest'] }, editor: { inherits: ['user'] }, admin: { inherits: ['editor'] } },
    resources: ['posts', 'comments', 'users', 'settings'],
    grants: {
        guest: { posts: ['read'], comments: ['read'] },
        user: { comments: ['create', 'update:own', 'delete:own'], posts: ['create', 'update:own'] },
        editor: { posts: ['update', 'delete'], comments: ['update', 'delete'] },
        admin: { users: ['create', 'read', 'update', 'delete'], settings: ['read', 'update'] }
    }
};
/** Flatten inheritance → { role: { resource: Set('action' | 'action:own') } }. Throws on cycles / unknown roles. */
export function resolvePolicy(policy) {
    const out = {};
    const visit = (role, stack) => {
        if (out[role]) return out[role];
        if (stack.includes(role)) throw new Error('وراثة دائرية: ' + [...stack, role].join(' → '));
        const def = policy.roles[role];
        if (!def) throw new Error('دور غير معروف: ' + role);
        const acc = {};
        (def.inherits || []).forEach(p => { const pr = visit(p, [...stack, role]); Object.entries(pr).forEach(([res, set]) => { acc[res] = new Set([...(acc[res] || []), ...set]); }); });
        Object.entries((policy.grants || {})[role] || {}).forEach(([res, acts]) => { acc[res] = new Set([...(acc[res] || []), ...acts]); });
        out[role] = acc;
        return acc;
    };
    Object.keys(policy.roles).forEach(r => visit(r, []));
    return out;
}
/** can(policy)(role, action, resource, { userId, ownerId }) */
export function makeCan(policy) {
    const flat = resolvePolicy(policy);
    return (role, action, resource, ctx = {}) => {
        const set = (flat[role] || {})[resource];
        if (!set) return false;
        if (set.has(action) || set.has('*')) return true;
        if (set.has(action + ':own')) return ctx.userId != null && ctx.ownerId != null && String(ctx.userId) === String(ctx.ownerId);
        return false;
    };
}
export function rbacMatrix(policy) {
    const flat = resolvePolicy(policy);
    return Object.keys(policy.roles).map(role => ({ role, cells: policy.resources.map(res => { const s = (flat[role] || {})[res] || new Set(); return RBAC_ACTIONS.map(a => (s.has(a) ? 'yes' : s.has(a + ':own') ? 'own' : 'no')); }) }));
}
export function rbacFiles(policy) {
    resolvePolicy(policy);
    const roles = Object.keys(policy.roles);
    return {
        'rbac/policy.json': JSON.stringify(policy, null, 2) + '\n',
        'rbac/rbac.js': `// Role-based access control (generated by OX-Alpha) — roles inherit grants; "action:own" = only the owner's records
const policy = require('./policy.json');

function resolve() {
    const out = {};
    const visit = (role, stack) => {
        if (out[role]) return out[role];
        if (stack.includes(role)) throw new Error('circular role inheritance: ' + stack.concat(role).join(' -> '));
        const def = policy.roles[role];
        if (!def) throw new Error('unknown role: ' + role);
        const acc = {};
        (def.inherits || []).forEach(p => { const pr = visit(p, stack.concat(role)); Object.keys(pr).forEach(res => { acc[res] = new Set([...(acc[res] || []), ...pr[res]]); }); });
        const g = (policy.grants || {})[role] || {};
        Object.keys(g).forEach(res => { acc[res] = new Set([...(acc[res] || []), ...g[res]]); });
        out[role] = acc;
        return acc;
    };
    Object.keys(policy.roles).forEach(r => visit(r, []));
    return out;
}
const FLAT = resolve();

/** can('user', 'update', 'posts', { userId: 1, ownerId: 1 }) → true */
function can(role, action, resource, ctx = {}) {
    const set = (FLAT[role] || {})[resource];
    if (!set) return false;
    if (set.has(action) || set.has('*')) return true;
    if (set.has(action + ':own')) return ctx.userId != null && ctx.ownerId != null && String(ctx.userId) === String(ctx.ownerId);
    return false;
}
/** Everything a role may do: { posts: ['read', 'update:own'], … } */
function permissionsFor(role) { const r = FLAT[role] || {}; const o = {}; Object.keys(r).forEach(k => { o[k] = [...r[k]]; }); return o; }
/** Express middleware: authorize('delete', 'posts', req => ({ ownerId: req.post.authorId })) — expects req.user = { id, role } */
function authorize(action, resource, ctxFn) {
    return (req, res, next) => {
        const user = req.user || { role: 'guest' };
        const ctx = Object.assign({ userId: user.id || user.sub }, ctxFn ? ctxFn(req) : {});
        return can(user.role || 'guest', action, resource, ctx) ? next() : res.status(403).json({ error: 'forbidden', need: action + ' ' + resource });
    };
}
module.exports = { can, authorize, permissionsFor, roles: ${JSON.stringify(roles)} };
`,
        'rbac/rbac.test.js': `const { can, permissionsFor } = require('./rbac');
const policy = require('./policy.json');

describe('rbac', () => {
    test('every role is resolvable', () => {
        Object.keys(policy.roles).forEach(r => expect(typeof permissionsFor(r)).toBe('object'));
    });
${roles.map(r => {
            const lines = [];
            policy.resources.forEach(res => RBAC_ACTIONS.forEach(a => {
                const v = makeCan(policy)(r, a, res, { userId: 1, ownerId: 1 });
                const other = makeCan(policy)(r, a, res, { userId: 1, ownerId: 2 });
                if (v && !other) lines.push(`        expect(can('${r}', '${a}', '${res}', { userId: 1, ownerId: 1 })).toBe(true);\n        expect(can('${r}', '${a}', '${res}', { userId: 1, ownerId: 2 })).toBe(false);`);
                else lines.push(`        expect(can('${r}', '${a}', '${res}')).toBe(${v});`);
            }));
            return `    test('${r}', () => {\n${lines.join('\n')}\n    });`;
        }).join('\n')}
    test('unknown roles and resources are denied', () => {
        expect(can('ghost', 'read', 'posts')).toBe(false);
        expect(can('admin', 'read', 'nope')).toBe(false);
    });
});
`,
        'rbac/can.js': `// Front-end helper: hide UI the user cannot use (always re-check on the server!)
// <button data-can="delete:posts">…</button>  →  applyCan(document, user)
export function applyCan(root, user, can) {
    root.querySelectorAll('[data-can]').forEach(el => {
        const [action, resource] = el.dataset.can.split(':');
        el.hidden = !can(user.role, action, resource, { userId: user.id, ownerId: el.dataset.owner });
    });
}
`
    };
}

// ====================================================================== #991-#994 SERVICE SNIPPETS
export const SERVICE_FILES = {
    stripe: () => ({
        'payments/stripe-server.js': `// Stripe Checkout — server side (secret key stays on the server!)
const express = require('express');
const Stripe = require('stripe');
const stripe = Stripe((typeof process !== 'undefined' && process.env.STRIPE_SECRET_KEY) || 'sk_test_mock');
const router = express.Router();

router.post('/checkout', async (req, res) => {
    const { items = [{ name: 'Pro plan', amount: 1900, quantity: 1 }], currency = 'usd' } = req.body || {};
    const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: items.map(i => ({ price_data: { currency, product_data: { name: i.name }, unit_amount: i.amount }, quantity: i.quantity || 1 })),
        success_url: 'http://localhost:3000/success.html?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'http://localhost:3000/cancel.html'
    });
    res.json({ id: session.id, url: session.url });
});

// Webhook: verify the signature with the raw body (express.raw) in production
router.post('/webhook', (req, res) => {
    const event = req.body || {};
    if (event.type === 'checkout.session.completed') console.log('💰 paid:', event.data.object.id);
    res.json({ received: true });
});
module.exports = router;
`,
        'payments/checkout-button.html': `<button id="buy">ادفع 19$</button>
<script>
document.getElementById('buy').onclick = async () => {
  const r = await fetch('/api/pay/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ name: 'Pro plan', amount: 1900, quantity: 1 }] }) });
  const { url } = await r.json();
  location.href = url; // Stripe-hosted checkout page
};
</script>
`,
        'payments/stripe.test.js': `const Stripe = require('stripe');
test('creates a checkout session (mock in OX-Alpha, test mode with a real key)', async () => {
    const stripe = Stripe('sk_test_mock');
    const s = await stripe.checkout.sessions.create({ mode: 'payment', line_items: [{ price_data: { currency: 'usd', product_data: { name: 'Pro' }, unit_amount: 1900 }, quantity: 2 }], success_url: 'http://x/s', cancel_url: 'http://x/c' });
    expect(s.id).toMatch(/^cs_test_/);
    expect(s.amount_total).toBe(3800);
});
`
    }),
    paypal: (c = {}) => ({
        'payments/paypal-buttons.html': `<!-- PayPal Smart Buttons: replace YOUR_CLIENT_ID (sandbox client id from developer.paypal.com) -->
<div id="paypal"></div>
<script src="https://www.paypal.com/sdk/js?client-id=${c.clientId || 'YOUR_CLIENT_ID'}&currency=USD"></script>
<script>
paypal.Buttons({
  createOrder: (data, actions) => actions.order.create({ purchase_units: [{ amount: { value: '19.00' }, description: 'Pro plan' }] }),
  onApprove: async (data, actions) => { const d = await actions.order.capture(); alert('شكراً ' + d.payer.name.given_name); },
  onError: (err) => console.error(err)
}).render('#paypal');
</script>
`,
        'payments/paypal-server.js': `// Verify/capture on the server with the Orders v2 REST API
const BASE = 'https://api-m.sandbox.paypal.com';
async function token(id, secret) {
    const r = await fetch(BASE + '/v1/oauth2/token', { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
    return (await r.json()).access_token;
}
async function captureOrder(orderId, env = process.env) {
    const t = await token(env.PAYPAL_CLIENT_ID, env.PAYPAL_SECRET);
    const r = await fetch(BASE + '/v2/checkout/orders/' + orderId + '/capture', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } });
    return r.json();
}
module.exports = { captureOrder };
`
    }),
    auth0: (c = {}) => ({
        'auth/auth0.js': `// Auth0 SPA login (Universal Login + PKCE). npm i @auth0/auth0-spa-js
import { createAuth0Client } from '@auth0/auth0-spa-js';
export const auth0 = await createAuth0Client({
    domain: '${c.domain || 'YOUR_TENANT.auth0.com'}',
    clientId: '${c.clientId || 'YOUR_CLIENT_ID'}',
    authorizationParams: { redirect_uri: window.location.origin${c.audience ? `, audience: '${c.audience}'` : ''} },
    cacheLocation: 'localstorage', useRefreshTokens: true
});
if (location.search.includes('code=') && location.search.includes('state=')) { await auth0.handleRedirectCallback(); history.replaceState({}, '', location.pathname); }
export const login = () => auth0.loginWithRedirect();
export const logout = () => auth0.logout({ logoutParams: { returnTo: window.location.origin } });
export const user = () => auth0.getUser();
export const api = async (url, opts = {}) => fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + await auth0.getTokenSilently() } });
`
    }),
    clerk: (c = {}) => ({
        'auth/clerk.js': `// Clerk drop-in UI. npm i @clerk/clerk-js
import { Clerk } from '@clerk/clerk-js';
export const clerk = new Clerk('${c.publishableKey || 'pk_test_YOUR_KEY'}');
await clerk.load();
export function mount(el) {
    if (clerk.user) clerk.mountUserButton(el);
    else clerk.mountSignIn(el);
}
export const token = () => clerk.session && clerk.session.getToken();
`,
        'auth/clerk-server.js': `// Verify Clerk session tokens on your API. npm i @clerk/express
const { clerkMiddleware, requireAuth, getAuth } = require('@clerk/express');
module.exports = (app) => {
    app.use(clerkMiddleware());
    app.get('/api/me', requireAuth(), (req, res) => res.json({ userId: getAuth(req).userId }));
};
`
    }),
    sendgrid: () => ({
        'email/send.js': `// Transactional email with SendGrid (server side). npm i @sendgrid/mail
const sg = require('@sendgrid/mail');
sg.setApiKey((typeof process !== 'undefined' && process.env.SENDGRID_API_KEY) || 'SG.mock');
async function sendWelcome(to, name) {
    const [res] = await sg.send({
        to, from: { email: 'no-reply@example.com', name: 'My App' },
        subject: 'مرحباً ' + name,
        text: 'أهلاً ' + name + '، شكراً لتسجيلك.',
        html: '<h2>أهلاً ' + name + '</h2><p>شكراً لتسجيلك.</p>'
    });
    return res.statusCode;
}
module.exports = { sendWelcome };
`,
        'email/send.test.js': `const { sendWelcome } = require('./send');
test('welcome email is accepted (lands in the OX-Alpha outbox when mocked)', async () => {
    expect(await sendWelcome('sara@example.com', 'سارة')).toBe(202);
});
`
    }),
    twilio: () => ({
        'sms/send.js': `// SMS / WhatsApp with Twilio (server side). npm i twilio
const twilio = require('twilio');
const env = (typeof process !== 'undefined' && process.env) || {};
const client = twilio(env.TWILIO_ACCOUNT_SID || 'AC_mock', env.TWILIO_AUTH_TOKEN || 'mock');
async function sendCode(to) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const msg = await client.messages.create({ to, from: env.TWILIO_FROM || '+15005550006', body: 'رمز التحقق: ' + code });
    return { sid: msg.sid, status: msg.status, code };
}
module.exports = { sendCode };
`,
        'sms/send.test.js': `const { sendCode } = require('./send');
test('verification SMS is queued', async () => {
    const r = await sendCode('+21612345678');
    expect(r.sid).toMatch(/^SM/);
    expect(r.code).toHaveLength(6);
});
`
    })
};
