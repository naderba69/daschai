/* Performance lab: benchmark (#881), before/after (#882), bottlenecks (#883), upgrade advice (#884), architecture (#885),
   load forecast (#886), auto-scale (#887), load balancer (#888), distributed cache (#889), distributed database (#890). */
import { esc, call, card, empty, btn, pbtn, select, field, area, val, win, fmtMs, percentile, table, sha256Hex, semverCmp, semverDiff, linreg, sparkline, download, textFiles, fmtDT, sevBadge } from './util.js';

const pfFiles = (app) => textFiles(app.virtualProjectFiles).map(([path, f]) => ({ path, content: f.content }));

// ------------------------------------------------------------------ PURE: statistics & comparison
export function benchStats(samples) {
    const a = (samples || []).filter(x => typeof x === 'number' && !isNaN(x));
    if (!a.length) return { n: 0, mean: null, median: null, p95: null, min: null, max: null, sd: null };
    const mean = a.reduce((s, x) => s + x, 0) / a.length;
    const sd = Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / a.length);
    return { n: a.length, mean, median: percentile(a, 0.5), p95: percentile(a, 0.95), min: Math.min(...a), max: Math.max(...a), sd };
}
/** Before/after rows: lower time is better; ±tol% is noise. */
export function compareRuns(before, after, tol = 5) {
    const names = Array.from(new Set([...Object.keys((before && before.results) || {}), ...Object.keys((after && after.results) || {})]));
    return names.map(name => {
        const b = before.results[name], a = after.results[name];
        const bm = b ? b.median : null, am = a ? a.median : null;
        const delta = bm && am != null ? ((am - bm) / bm) * 100 : null;
        return { name, before: bm, after: am, delta, verdict: delta == null ? 'n/a' : delta < -tol ? 'faster' : delta > tol ? 'slower' : 'same' };
    });
}
/** Aggregate profiler samples { method: [ms…] } → rows sorted by total time. */
export function bottleneckRows(samples, wall = 0) {
    return Object.entries(samples || {}).map(([name, arr]) => {
        const total = arr.reduce((s, x) => s + x, 0);
        return { name, calls: arr.length, total, avg: total / arr.length, max: Math.max(...arr), share: wall ? (total / wall) * 100 : null };
    }).sort((a, b) => b.total - a.total);
}

// ------------------------------------------------------------------ PURE: upgrades (#884) & architecture (#885)
export function depsOf(pkgJson) {
    let p; try { p = typeof pkgJson === 'string' ? JSON.parse(pkgJson) : pkgJson; } catch (e) { return []; }
    const out = [];
    for (const [sec, dev] of [['dependencies', false], ['devDependencies', true]]) for (const [name, range] of Object.entries((p && p[sec]) || {})) out.push({ name, range: String(range), dev });
    return out;
}
export function upgradeAdvice(deps, latest) {
    return deps.map(d => {
        const cur = String(d.range).replace(/^[\^~>=<\s]+/, '');
        const lat = latest[d.name];
        if (!lat || !/^\d/.test(cur)) return { ...d, current: cur, latest: lat || null, kind: 'unknown' };
        const cmp = semverCmp(cur, lat);
        return { ...d, current: cur, latest: lat, kind: cmp >= 0 ? 'none' : semverDiff(cur, lat) };
    }).sort((a, b) => ({ major: 0, minor: 1, patch: 2, unknown: 3, none: 4 }[a.kind] - { major: 0, minor: 1, patch: 2, unknown: 3, none: 4 }[b.kind]));
}
const JS_EXT = /\.(m?[jt]sx?|vue|svelte)$/;
/** Relative import graph of the project's JS/TS files. */
export function importGraph(files) {
    const paths = new Set(files.map(f => f.path)), g = {};
    const resolve = (from, spec) => {
        if (!spec.startsWith('.')) return null;
        const base = from.split('/').slice(0, -1);
        for (const part of spec.split('/')) { if (part === '..') base.pop(); else if (part !== '.') base.push(part); }
        const p = base.join('/');
        for (const c of [p, p + '.js', p + '.ts', p + '.jsx', p + '.tsx', p + '.mjs', p + '/index.js', p + '/index.ts']) if (paths.has(c)) return c;
        return null;
    };
    for (const f of files) {
        if (!JS_EXT.test(f.path)) continue;
        const deps = new Set(), re = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\s*\(\s*|export\s[^'"]*?from\s*|import\s+)['"]([^'"]+)['"]/g;
        let m; while ((m = re.exec(f.content))) { const r = resolve(f.path, m[1]); if (r && r !== f.path) deps.add(r); }
        g[f.path] = Array.from(deps);
    }
    return g;
}
/** Import cycles (each reported once, rotated to start at its smallest path). */
export function findCycles(g, max = 20) {
    const out = [], seen = new Set(), state = {}, stack = [];
    const visit = (n) => {
        if (out.length >= max) return;
        state[n] = 1; stack.push(n);
        for (const d of g[n] || []) {
            if (state[d] === 1) {
                const cyc = stack.slice(stack.indexOf(d));
                const i = cyc.indexOf(cyc.slice().sort()[0]), rot = cyc.slice(i).concat(cyc.slice(0, i)), key = rot.join('>');
                if (!seen.has(key)) { seen.add(key); out.push(rot); }
            } else if (!state[d]) visit(d);
        }
        stack.pop(); state[n] = 2;
    };
    Object.keys(g).sort().forEach(n => { if (!state[n]) visit(n); });
    return out;
}
export function archFindings(files) {
    const g = importGraph(files), fanIn = {}, out = [];
    Object.values(g).forEach(ds => ds.forEach(d => { fanIn[d] = (fanIn[d] || 0) + 1; }));
    for (const c of findCycles(g)) out.push({ sev: 'high', title: 'اعتماد دائري', where: c.concat(c[0]).join(' → '), fix: 'استخرج الجزء المشترك إلى وحدة ثالثة أو اعكس الاعتماد عبر واجهة/حدث.' });
    for (const f of files) {
        if (!JS_EXT.test(f.path)) continue;
        const lines = f.content.split('\n').length;
        if (lines > 600) out.push({ sev: lines > 1500 ? 'high' : 'medium', title: `ملف ضخم (${lines} سطر)`, where: f.path, fix: 'قسّمه حسب المسؤولية (عرض / منطق / بيانات) ليسهل الاختبار والتقسيم الكسول.' });
        if ((g[f.path] || []).length > 15) out.push({ sev: 'medium', title: `يعتمد على ${(g[f.path] || []).length} وحدة`, where: f.path, fix: 'اقترب من «وحدة إله» — وزّع المسؤوليات أو أضف واجهة واجهية (facade).' });
        const isUI = /(components?|views?|pages?|ui)\//i.test(f.path);
        if (isUI && /\b(SELECT|INSERT|UPDATE|DELETE)\s/.test(f.content)) out.push({ sev: 'medium', title: 'استعلام قاعدة بيانات داخل طبقة العرض', where: f.path, fix: 'انقل الوصول للبيانات إلى طبقة خدمة/مستودع (repository).' });
    }
    Object.entries(fanIn).filter(([, n]) => n >= 10).forEach(([p, n]) => out.push({ sev: 'low', title: `مستورد من ${n} ملف`, where: p, fix: 'وحدة مركزية — حافظ على استقرار واجهتها واختبرها جيداً.' }));
    return { graph: g, findings: out, modules: Object.keys(g).length, edges: Object.values(g).reduce((s, d) => s + d.length, 0) };
}

// ------------------------------------------------------------------ PURE: forecasting (#886)
/** Holt's linear (double exponential) smoothing → h-step forecast. */
export function holt(series, h = 14, alpha = 0.5, beta = 0.3) {
    const y = series.map(Number);
    if (y.length < 2) return Array(h).fill(y[0] || 0);
    let level = y[0], trend = y[1] - y[0];
    for (let i = 1; i < y.length; i++) { const prev = level; level = alpha * y[i] + (1 - alpha) * (level + trend); trend = beta * (level - prev) + (1 - beta) * trend; }
    return Array.from({ length: h }, (_, k) => Math.max(0, level + (k + 1) * trend));
}
/** Pick the better of Holt / linear regression by one-step back-test error; returns values + 80% band. */
export function forecast(series, h = 14) {
    const y = series.map(Number).filter(x => !isNaN(x));
    if (y.length < 3) return { method: 'none', values: [], lower: [], upper: [], error: null };
    const errOf = (fn) => { let e = 0, n = 0; for (let i = Math.max(2, Math.floor(y.length / 2)); i < y.length; i++) { const p = fn(y.slice(0, i))[0]; e += (p - y[i]) ** 2; n++; } return n ? Math.sqrt(e / n) : Infinity; };
    const lin = (s) => { const r = linreg(s.map((_, i) => i), s); return Array.from({ length: h }, (_, k) => Math.max(0, r.a + r.b * (s.length + k))); };
    const hw = (s) => holt(s, h);
    const eL = errOf(lin), eH = errOf(hw);
    const method = eH <= eL ? 'holt' : 'linear', values = (method === 'holt' ? hw : lin)(y), err = Math.min(eL, eH);
    const band = (k) => 1.28 * err * Math.sqrt(1 + k / 4);
    return { method, values, lower: values.map((v, k) => Math.max(0, v - band(k))), upper: values.map((v, k) => v + band(k)), error: err, peak: Math.max(...values) };
}
/** "date,value" or "value" lines → numbers (header and blanks ignored). */
export function parseSeries(text) {
    return String(text || '').split(/\r?\n/).map(l => l.split(/[,;\t]/).map(x => x.trim()).filter(Boolean)).filter(c => c.length && !isNaN(Number(c[c.length - 1]))).map(c => Number(c[c.length - 1]));
}
/** Replicas needed for a peak request rate: ceil(peak / (capacity × target utilisation)), clamped. */
export const replicasFor = (peakRps, perReplicaRps, target = 0.7, min = 1, max = 50) => Math.min(max, Math.max(min, Math.ceil(peakRps / Math.max(0.001, perReplicaRps * target))));

// ------------------------------------------------------------------ PURE: scale configs (#887 #888 #889 #890)
const slug = (s) => String(s || 'app').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
export function k8sManifests({ name = 'ox-app', image = 'ghcr.io/me/ox-app:latest', port = 3000, min = 2, max = 10, cpu = 70 } = {}) {
    const n = slug(name);
    return `apiVersion: apps/v1
kind: Deployment
metadata: { name: ${n} }
spec:
  replicas: ${min}
  selector: { matchLabels: { app: ${n} } }
  template:
    metadata: { labels: { app: ${n} } }
    spec:
      containers:
        - name: ${n}
          image: ${image}
          ports: [{ containerPort: ${port} }]
          resources:
            requests: { cpu: 250m, memory: 256Mi }
            limits: { cpu: "1", memory: 512Mi }
          readinessProbe: { httpGet: { path: /health, port: ${port} }, periodSeconds: 5 }
          livenessProbe: { httpGet: { path: /health, port: ${port} }, initialDelaySeconds: 15 }
---
apiVersion: v1
kind: Service
metadata: { name: ${n} }
spec:
  selector: { app: ${n} }
  ports: [{ port: 80, targetPort: ${port} }]
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: ${n} }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: ${n} }
  minReplicas: ${min}
  maxReplicas: ${max}
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: ${cpu} } }
  behavior:
    scaleDown: { stabilizationWindowSeconds: 300 }
`;
}
export const flyToml = ({ name = 'ox-app', port = 3000, min = 1, max = 10 } = {}) => `app = "${slug(name)}"
primary_region = "cdg"

[http_service]
  internal_port = ${port}
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = ${min}
  [http_service.concurrency]
    type = "requests"
    soft_limit = 200
    hard_limit = 250

# fly scale count ${min}..${max}  —  Fly يشغّل الآلات ويوقفها حسب الطلب
[[http_service.checks]]
  path = "/health"
  interval = "10s"
  timeout = "2s"
`;
export function lbConfig(kind = 'nginx', { name = 'ox-app', servers = ['10.0.0.11:3000', '10.0.0.12:3000', '10.0.0.13:3000'], algo = 'least_conn', sticky = false } = {}) {
    const n = slug(name);
    if (kind === 'haproxy') return `frontend http_in
    bind *:80
    default_backend ${n}

backend ${n}
    balance ${algo === 'least_conn' ? 'leastconn' : algo === 'ip_hash' ? 'source' : 'roundrobin'}
    option httpchk GET /health
${sticky ? '    cookie SRV insert indirect nocache\n' : ''}${servers.map((s, i) => `    server s${i + 1} ${s} check inter 5s fall 3 rise 2${sticky ? ` cookie s${i + 1}` : ''}`).join('\n')}
`;
    return `upstream ${n} {
    ${algo === 'round_robin' ? '# round-robin (الافتراضي)' : algo + ';'}
${servers.map(s => `    server ${s} max_fails=3 fail_timeout=10s;`).join('\n')}
    keepalive 32;
}

server {
    listen 80;
    location / {
        proxy_pass http://${n};
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_next_upstream error timeout http_502 http_503;
    }
}
`;
}
/** FNV-1a 32-bit + murmur3 fmix32 finaliser (better avalanche for short keys). */
export function fnv1a(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; }
/** Consistent-hash ring with virtual nodes (#889 cache sharding, #890 DB sharding). */
export function ringBuild(nodes, vnodes = 100) {
    const ring = [];
    nodes.forEach(n => { for (let v = 0; v < vnodes; v++) ring.push([fnv1a(n + '#' + v), n]); });
    return ring.sort((a, b) => a[0] - b[0]);
}
export function ringGet(ring, key) {
    if (!ring.length) return null;
    const h = fnv1a(String(key)); let lo = 0, hi = ring.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ring[m][0] < h) lo = m + 1; else hi = m; }
    return ring[lo % ring.length][1];
}
export function distribution(ring, keys) { const out = {}; keys.forEach(k => { const n = ringGet(ring, k); out[n] = (out[n] || 0) + 1; }); return out; }
/** Share of keys that move when a node is added — the point of consistent hashing (≈ 1/(n+1)). */
export function movedShare(nodes, extra, keys, vnodes = 100) {
    const a = ringBuild(nodes, vnodes), b = ringBuild(nodes.concat(extra), vnodes);
    return keys.filter(k => ringGet(a, k) !== ringGet(b, k)).length / (keys.length || 1);
}
export const redisCacheAside = ({ ttl = 300, nodes = 3 } = {}) => `// Cache-aside مع Redis (ioredis) — اقرأ من الكاش أولاً، وإلا من قاعدة البيانات ثم خزّن
import Redis from 'ioredis';
${nodes > 1 ? `// Redis Cluster يوزّع المفاتيح على ${nodes} عقد (16384 slot) تلقائياً
const redis = new Redis.Cluster([${Array.from({ length: nodes }, (_, i) => `{ host: 'redis-${i + 1}', port: 6379 }`).join(', ')}]);` : `const redis = new Redis(process.env.REDIS_URL);`}

export async function cached(key, ttlSeconds, load) {
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit);
  // قفل قصير يمنع «تدافع الكاش» (cache stampede) عند انتهاء المفتاح
  const lock = await redis.set(key + ':lock', '1', 'EX', 10, 'NX');
  if (!lock) { await new Promise(r => setTimeout(r, 100)); return cached(key, ttlSeconds, load); }
  try {
    const value = await load();
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds + Math.floor(Math.random() * 30)); // jitter
    return value;
  } finally { await redis.del(key + ':lock'); }
}
export const invalidate = (key) => redis.del(key);

// مثال: const user = await cached('user:' + id, ${ttl}, () => db.users.findById(id));
`;
export const pgCompose = ({ replicas = 2 } = {}) => `# PostgreSQL: خادم رئيسي للكتابة + ${replicas} نسخة قراءة (Streaming Replication) — bitnami/postgresql
services:
  pg-primary:
    image: bitnami/postgresql:16
    environment:
      POSTGRESQL_REPLICATION_MODE: master
      POSTGRESQL_REPLICATION_USER: repl
      POSTGRESQL_REPLICATION_PASSWORD: \${PG_REPL_PASSWORD}
      POSTGRESQL_PASSWORD: \${PG_PASSWORD}
      POSTGRESQL_DATABASE: app
    volumes: [pg-primary:/bitnami/postgresql]
${Array.from({ length: replicas }, (_, i) => `  pg-replica-${i + 1}:
    image: bitnami/postgresql:16
    depends_on: [pg-primary]
    environment:
      POSTGRESQL_REPLICATION_MODE: slave
      POSTGRESQL_MASTER_HOST: pg-primary
      POSTGRESQL_REPLICATION_USER: repl
      POSTGRESQL_REPLICATION_PASSWORD: \${PG_REPL_PASSWORD}
      POSTGRESQL_PASSWORD: \${PG_PASSWORD}`).join('\n')}
  pgbouncer:
    image: bitnami/pgbouncer:latest
    environment:
      POSTGRESQL_HOST: pg-primary
      POSTGRESQL_PASSWORD: \${PG_PASSWORD}
      PGBOUNCER_POOL_MODE: transaction
    ports: ["6432:6432"]
volumes:
  pg-primary:
`;
export const shardRouter = ({ shards = 4 } = {}) => `// توجيه الاستعلامات: الكتابة للرئيسي، القراءة لنسخة عشوائية، والتقسيم الأفقي (sharding) حسب tenant_id
import pg from 'pg';
const primary = new pg.Pool({ connectionString: process.env.PG_PRIMARY });
const replicas = (process.env.PG_REPLICAS || '').split(',').filter(Boolean).map(c => new pg.Pool({ connectionString: c }));
export const write = (sql, params) => primary.query(sql, params);
export const read = (sql, params) => (replicas.length ? replicas[Math.floor(Math.random() * replicas.length)] : primary).query(sql, params);

// ${shards} أجزاء — FNV-1a ثابت حتى لا تتغير وجهة المستأجر
const SHARDS = Array.from({ length: ${shards} }, (_, i) => new pg.Pool({ connectionString: process.env['PG_SHARD_' + i] }));
const fnv1a = (s) => { let h = 0x811c9dc5; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h; };
export const shardFor = (tenantId) => SHARDS[fnv1a(String(tenantId)) % SHARDS.length];
// تنبيه: انقل المستأجرين بين الأجزاء عبر سكربت ترحيل؛ أو استعمل Citus لتقسيم شفاف.
`;

export function installLab(P) {
    // ------------------------------------------------------------------ BENCHMARK (#881)
    const SAMPLE_MD = '# عنوان\n\n' + Array.from({ length: 40 }, (_, i) => `- عنصر **${i}** مع \`code\` و [رابط](https://example.com/${i})\n\n\`\`\`js\nconst x${i} = [1,2,3].map(n => n * ${i});\n\`\`\``).join('\n');
    P.pfBenchSuite = function () {
        const app = this;
        const sessions = () => JSON.stringify(this.sessions || []);
        return [
            { name: 'markdown', label: 'عرض Markdown (40 كتلة)', fn: () => { app.renderMarkdownSafe ? app.renderMarkdownSafe(SAMPLE_MD) : SAMPLE_MD.length; } },
            { name: 'json', label: 'JSON المحادثات (تسلسل + تحليل)', fn: () => { JSON.parse(sessions()); } },
            { name: 'lz', label: 'ضغط LZ للمحادثات', fn: () => { app.lzPack ? app.lzPack(sessions().slice(0, 200000)) : 0; } },
            { name: 'search', label: 'بناء فهرس البحث', fn: () => { app.pfSearchIndex(true); } },
            { name: 'dom', label: 'رسم 300 عنصر DOM', fn: () => { const d = document.createElement('div'); d.innerHTML = Array.from({ length: 300 }, (_, i) => `<div class="msg"><b>${i}</b><span>نص تجريبي ${i}</span></div>`).join(''); void d.querySelectorAll('.msg').length; } },
            { name: 'sha', label: 'SHA-256 لـ 256KB', fn: async () => { await sha256Hex(new Uint8Array(262144)); } }
        ];
    };
    P.pfRunBench = async function ({ budget = 250, minRuns = 3, maxRuns = 30, label = '' } = {}) {
        const results = {};
        for (const t of this.pfBenchSuite()) {
            const times = []; const start = performance.now();
            try {
                await t.fn(); // warm-up
                while (times.length < minRuns || (times.length < maxRuns && performance.now() - start < budget)) { const s = performance.now(); await t.fn(); times.push(performance.now() - s); }
                results[t.name] = { label: t.label, ...benchStats(times) };
            } catch (e) { results[t.name] = { label: t.label, error: String(e.message || e) }; }
            await new Promise(r => setTimeout(r, 0)); // let the UI breathe between tests
        }
        const run = { name: label || 'تشغيل ' + new Date().toLocaleString('ar'), t: Date.now(), version: (win().OX_BUILD || {}).version || '', ua: (navigator.userAgent || '').slice(0, 120), results };
        await this.pfSaveBench(run);
        return run;
    };
    P.pfSaveBench = async function (run) {
        try { const db = await this.pfDexie(); run.id = await db.benches.add(run); return run; } catch (e) {
            const list = JSON.parse(localStorage.getItem('ox_perf_bench_v1') || '[]'); run.id = Date.now(); list.push(run); localStorage.setItem('ox_perf_bench_v1', JSON.stringify(list.slice(-30))); return run;
        }
    };
    P.pfBenchHistory = async function () {
        try { const db = await this.pfDexie(); return (await db.benches.orderBy('t').toArray()).slice(-30); } catch (e) { try { return JSON.parse(localStorage.getItem('ox_perf_bench_v1') || '[]'); } catch (e2) { return []; } }
    };
    P.pfBench = async function () {
        const hist = await this.pfBenchHistory(), last = hist[hist.length - 1];
        return card('اختبار أداء التطبيق', `<p class="gh-muted">يقيس العمليات الثقيلة الحقيقية في التطبيق على جهازك (الوسيط بعد الإحماء). احفظ نتيجة قبل تغيير وبعده للمقارنة.</p>
                ${field('pfx-bench-label', 'وسم التشغيل (اختياري)', '', 'placeholder="مثال: قبل تفعيل الضغط"')}
                <div class="gh-row">${pbtn('fa-play', 'تشغيل', call('pfBenchUI'))}${hist.length ? btn('fa-file-export', 'تصدير JSON', call('pfExportBench')) : ''}</div><div id="pfx-bench-out">${last ? this.pfBenchTable(last) : ''}</div>`, 'fa-stopwatch')
            + (hist.length > 1 ? card('التاريخ', Object.keys(last.results).map(k => { const v = hist.map(h => h.results[k] && h.results[k].median).filter(x => x != null); return `<div class="pfx-barrow"><span>${esc(last.results[k].label || k)}</span>${sparkline(v, { w: 160, h: 28 })}<b>${fmtMs(v[v.length - 1])}</b></div>`; }).join(''), 'fa-chart-line') : '');
    };
    P.pfBenchTable = function (run) {
        return `<p class="gh-muted">${esc(run.name)} — ${esc(fmtDT(run.t))} ${run.version ? '• v' + esc(run.version) : ''}</p>` + table(['الاختبار', 'الوسيط', 'p95', 'أدنى', 'العينات'], Object.values(run.results).map(r => [esc(r.label), r.error ? '❌ ' + esc(r.error) : fmtMs(r.median), fmtMs(r.p95), fmtMs(r.min), String(r.n || 0)]));
    };
    P.pfBenchUI = async function () {
        this.pfBusy('pfx-bench-out', 'جاري القياس…');
        try { const run = await this.pfRunBench({ label: val('pfx-bench-label') }); const el = document.getElementById('pfx-bench-out'); if (el) el.innerHTML = this.pfBenchTable(run); this.showToast('⏱️ اكتمل الاختبار', 'success'); return run; } catch (e) { return this.pfErr(e, 'pfx-bench-out'); }
    };
    P.pfExportBench = async function () { const h = await this.pfBenchHistory(); download(this, 'ox-benchmarks.json', JSON.stringify(h, null, 2), 'application/json'); return h.length; };

    // ------------------------------------------------------------------ BEFORE / AFTER (#882)
    P.pfBenchCompare = async function () {
        const hist = await this.pfBenchHistory();
        const opts = hist.map(h => [String(h.id), `${h.name} (${fmtDT(h.t)})`]);
        return card('مقارنة تشغيلين', hist.length >= 2 ? `<div class="fmx-grid2">${select('pfx-cmp-a', 'قبل', opts, String(hist[hist.length - 2].id))}${select('pfx-cmp-b', 'بعد', opts, String(hist[hist.length - 1].id))}</div>
                <div class="gh-row">${pbtn('fa-code-compare', 'قارن', call('pfCompareUI'))}</div><div id="pfx-cmp-out"></div>` : empty('شغّل «Benchmark» مرتين على الأقل (قبل التغيير وبعده)'), 'fa-code-compare')
            + card('قارن نسختين من كود (A / B)', `<p class="gh-muted">يُنفّذ في Web Worker منفصل فلا يتجمد التطبيق. المتغير <code>i</code> هو رقم التكرار.</p>
                <div class="fmx-grid2">${area('pfx-ab-a', 'A (قبل)', 'const a = []; for (let k = 0; k < 100; k++) a.push(k * i); return a.length;', 5, 'dir="ltr" spellcheck="false"')}${area('pfx-ab-b', 'B (بعد)', 'return Array.from({ length: 100 }, (_, k) => k * i).length;', 5, 'dir="ltr" spellcheck="false"')}</div>
                ${field('pfx-ab-n', 'التكرارات', '10000', 'type="number" min="100" max="10000000"')}<div class="gh-row">${pbtn('fa-flask', 'قِس', call('pfABRun'))}</div><div id="pfx-ab-out"></div>`, 'fa-flask');
    };
    P.pfCompareRuns = async function (idA, idB) {
        const hist = await this.pfBenchHistory();
        const a = hist.find(h => String(h.id) === String(idA)), b = hist.find(h => String(h.id) === String(idB));
        if (!a || !b) return null;
        return { a, b, rows: compareRuns(a, b) };
    };
    P.pfCompareUI = async function () {
        const r = await this.pfCompareRuns(val('pfx-cmp-a'), val('pfx-cmp-b'));
        const el = document.getElementById('pfx-cmp-out'); if (!r || !el) return r;
        const icon = { faster: '🟢 أسرع', slower: '🔴 أبطأ', same: '⚪ نفس الأداء', 'n/a': '—' };
        el.innerHTML = table(['الاختبار', 'قبل', 'بعد', 'الفرق', ''], r.rows.map(x => [esc((r.b.results[x.name] || r.a.results[x.name] || {}).label || x.name), fmtMs(x.before), fmtMs(x.after), x.delta == null ? '—' : (x.delta > 0 ? '+' : '') + x.delta.toFixed(1) + '%', icon[x.verdict]]));
        return r;
    };
    P.pfABRun = async function () {
        this.pfBusy('pfx-ab-out', 'يُقاس في Worker…');
        try {
            const r = await this.pfHeavy('bench', { a: val('pfx-ab-a'), b: val('pfx-ab-b'), iterations: Math.min(1e7, Math.max(100, parseInt(val('pfx-ab-n'), 10) || 10000)) });
            const el = document.getElementById('pfx-ab-out');
            if (el && r.a && r.b) { const f = r.a.ms / (r.b.ms || 1e-9); el.innerHTML = table(['', 'الوسيط', 'عملية/ث'], [['A', fmtMs(r.a.ms), r.a.opsPerSec.toLocaleString('en')], ['B', fmtMs(r.b.ms), r.b.opsPerSec.toLocaleString('en')]]) + `<p><b>${f >= 1 ? `B أسرع ×${f.toFixed(2)}` : `A أسرع ×${(1 / f).toFixed(2)}`}</b></p>`; }
            return r;
        } catch (e) { return this.pfErr(e, 'pfx-ab-out'); }
    };

    // ------------------------------------------------------------------ BOTTLENECK (#883)
    const SKIP = /^(constructor|pf|lazy|ensure|loadChunk|importModule|escapeHTML|showToast|haptic|t$)/;
    P.pfProfileStart = function () {
        if (this._pfProf) return this._pfProf;
        const proto = Object.getPrototypeOf(this), originals = new Map(), samples = {}, depth = {};
        const prof = { start: performance.now(), samples, originals, longtasks: [] };
        for (const name of Object.getOwnPropertyNames(proto)) {
            const fn = proto[name];
            if (typeof fn !== 'function' || fn.__oxLazy || SKIP.test(name) || Object.prototype.hasOwnProperty.call(this, name)) continue;
            originals.set(name, fn);
            const wrapped = function () {
                if (!prof.active || depth[name]) return fn.apply(this, arguments);
                depth[name] = 1; const t = performance.now();
                try { return fn.apply(this, arguments); } finally { depth[name] = 0; (samples[name] = samples[name] || []).push(performance.now() - t); }
            };
            Object.keys(fn).forEach(k => { wrapped[k] = fn[k]; });
            proto[name] = wrapped;
        }
        try {
            const PO = win().PerformanceObserver;
            if (PO && (PO.supportedEntryTypes || []).includes('longtask')) { prof.po = new PO(l => l.getEntries().forEach(e => prof.longtasks.push({ t: e.startTime, ms: e.duration }))); prof.po.observe({ type: 'longtask' }); }
        } catch (e) { /* unsupported */ }
        prof.active = true;
        this._pfProf = prof;
        this._pfProfT = setTimeout(() => this.pfProfileStop(), 60000); // never leave methods wrapped
        return prof;
    };
    P.pfProfileStop = function () {
        const prof = this._pfProf; if (!prof) return null;
        clearTimeout(this._pfProfT);
        prof.active = false;
        const proto = Object.getPrototypeOf(this);
        prof.originals.forEach((fn, name) => { proto[name] = fn; });
        if (prof.po) try { prof.po.disconnect(); } catch (e) {}
        const wall = performance.now() - prof.start;
        this._pfProf = null;
        const res = { wall, rows: bottleneckRows(prof.samples, wall), longtasks: prof.longtasks };
        this._pfLastProfile = res;
        if (document.getElementById('pfx-prof-out')) this.pfRefresh();
        return res;
    };
    P.pfProfileScenario = async function () {
        this.pfProfileStart();
        try {
            if (this.renderMessages) this.renderMessages();
            if (this.renderSessionList) this.renderSessionList();
            this.pfSearch && this.pfSearch('function');
            if (this.renderMarkdownSafe) this.renderMarkdownSafe(SAMPLE_MD);
            if (this.saveSessions) this.saveSessions();
            await new Promise(r => setTimeout(r, 50));
        } finally { this.pfProfileStop(); }
        return this._pfLastProfile;
    };
    P.pfBottleneck = function () {
        const r = this._pfLastProfile, live = !!this._pfProf;
        return card('تحليل عنق الزجاجة', `<p class="gh-muted">يغلّف دوال التطبيق مؤقتاً ويقيس زمن كل منها أثناء استعمالك الحقيقي (حتى 60 ثانية)، مع رصد المهام الطويلة (&gt;50ms) التي تجمّد الواجهة. تُعاد الدوال الأصلية فور التوقف.</p>
                <div class="gh-row">${live ? pbtn('fa-stop', 'إيقاف وعرض النتائج', call('pfProfileStop')) : pbtn('fa-record-vinyl', 'ابدأ التسجيل', call('pfProfileStartUI'))}${btn('fa-robot', 'سيناريو تلقائي', call('pfProfileScenarioUI'))}</div>
                ${live ? '<p class="pfx-warn">● يسجّل الآن — استعمل التطبيق ثم عُد هنا</p>' : ''}<div id="pfx-prof-out">${r ? this.pfProfileHTML(r) : ''}</div>`, 'fa-magnifying-glass-chart');
    };
    P.pfProfileHTML = function (r) {
        const top = r.rows.slice(0, 15);
        const lt = r.longtasks || [];
        return `<p>المدة ${fmtMs(r.wall)} • ${r.rows.length} دالة • ${lt.length} مهمة طويلة (${fmtMs(lt.reduce((s, x) => s + x.ms, 0))})</p>`
            + (top.length ? table(['الدالة', 'الاستدعاءات', 'الإجمالي', 'المتوسط', 'الأقصى'], top.map(x => [`<code>${esc(x.name)}</code>`, String(x.calls), fmtMs(x.total), fmtMs(x.avg), fmtMs(x.max)])) : empty('لم تُستدعَ دوال مقيسة'))
            + (top[0] && top[0].max > 50 ? `<p class="pfx-warn">⚠️ <code>${esc(top[0].name)}</code> تستغرق حتى ${fmtMs(top[0].max)} في استدعاء واحد — مرشحة للتأجيل (requestIdleCallback) أو النقل إلى Web Worker أو التخزين المؤقت.</p>` : '');
    };
    P.pfProfileStartUI = function () { this.pfProfileStart(); this.showToast('● بدأ التسجيل — استعمل التطبيق ثم أوقفه من هنا', 'info'); this.pfRefresh(); return true; };
    P.pfProfileScenarioUI = async function () { const r = await this.pfProfileScenario(); this.pfRefresh(); return r; };

    // ------------------------------------------------------------------ UPGRADES (#884) + ARCHITECTURE (#885)
    P.pfNpmLatest = async function (names) {
        const out = {};
        await Promise.all(names.slice(0, 60).map(async n => {
            try { const r = await fetch('https://registry.npmjs.org/' + n.replace('/', '%2F') + '/latest'); if (r.ok) out[n] = (await r.json()).version; } catch (e) { /* offline */ }
        }));
        return out;
    };
    P.pfAdvice = function () {
        const files = pfFiles(this);
        const pkg = this.virtualProjectFiles.get('package.json');
        return card('اقتراحات الترقية', pkg ? `<p class="gh-muted">يقارن إصدارات <code>package.json</code> بأحدث إصدار على npm.</p><div class="gh-row">${pbtn('fa-arrow-up-right-dots', 'افحص', call('pfAdviceUI'))}</div><div id="pfx-adv-out"></div>` : empty('لا يوجد package.json في المشروع'), 'fa-arrow-up-right-dots')
            + card('توصيات البنية', `<p class="gh-muted">${files.filter(f => JS_EXT.test(f.path)).length} ملف JS/TS — يحلل الاعتماديات الدائرية والملفات الضخمة والوحدات المركزية.</p><div class="gh-row">${pbtn('fa-sitemap', 'حلّل', call('pfArchUI'))}${btn('fa-wand-magic-sparkles', 'توصيات بالذكاء', call('pfArchAI'))}</div><div id="pfx-arch-out"></div>`, 'fa-sitemap');
    };
    P.pfAdviceData = async function () {
        const pkg = this.virtualProjectFiles.get('package.json');
        const deps = depsOf(pkg && pkg.content);
        return upgradeAdvice(deps, await this.pfNpmLatest(deps.map(d => d.name)));
    };
    P.pfAdviceUI = async function () {
        this.pfBusy('pfx-adv-out', 'يسأل npm…');
        try {
            const rows = await this.pfAdviceData(), el = document.getElementById('pfx-adv-out');
            const lab = { major: '🔴 رئيسي (تغييرات كاسرة)', minor: '🟡 ثانوي', patch: '🟢 تصحيح', none: '✅ محدث', unknown: '—' };
            if (el) el.innerHTML = table(['الحزمة', 'الحالي', 'الأحدث', 'النوع'], rows.map(r => [esc(r.name) + (r.dev ? ' <small>dev</small>' : ''), esc(r.current), esc(r.latest || '—'), lab[r.kind]]))
                + `<p class="gh-muted">ابدأ بالتصحيحات والثانوية (آمنة عادة)، وراجع سجل التغييرات قبل الترقيات الرئيسية: <code>npx npm-check-updates -i</code></p>`;
            return rows;
        } catch (e) { return this.pfErr(e, 'pfx-adv-out'); }
    };
    P.pfArchData = function () { return archFindings(pfFiles(this)); };
    P.pfArchUI = function () {
        const r = this.pfArchData(), el = document.getElementById('pfx-arch-out');
        if (el) el.innerHTML = `<p>${r.modules} وحدة • ${r.edges} اعتماد • ${r.findings.length} ملاحظة</p>` + (r.findings.length ? table(['', 'الملاحظة', 'المكان', 'الاقتراح'], r.findings.map(f => [sevBadge(f.sev), esc(f.title), `<code>${esc(f.where)}</code>`, esc(f.fix)])) : empty('✅ لا مشاكل بنيوية واضحة'));
        return r;
    };
    P.pfArchAI = async function () {
        const r = this.pfArchData();
        const tree = pfFiles(this).map(f => `${f.path} (${f.content.split('\n').length})`).slice(0, 200).join('\n');
        this.pfBusy('pfx-arch-out', 'يحلل…');
        const out = await this.pfAI(`اقترح تحسينات لبنية هذا المشروع (طبقات، فصل المسؤوليات، الأداء، قابلية التوسع). شجرة الملفات (عدد الأسطر):\n${tree}\n\nملاحظات آلية:\n${r.findings.map(f => '- ' + f.title + ': ' + f.where).join('\n') || 'لا شيء'}`);
        const el = document.getElementById('pfx-arch-out'); if (el && out) el.innerHTML = this.renderMarkdownSafe(out); else if (el) el.innerHTML = '';
        return out;
    };

    // ------------------------------------------------------------------ LOAD FORECAST (#886)
    P.pfForecast = function () {
        return card('توقع الحمل', `<p class="gh-muted">مصدر البيانات: زيارات مستودع GitHub (آخر 14 يوماً)، أو استخدامك لهذا التطبيق، أو أرقامك الخاصة (CSV: <code>date,value</code>).</p>
                ${select('pfx-fc-src', 'المصدر', [['usage', 'استخدام التطبيق (يومي)'], ['github', 'زيارات GitHub'], ['csv', 'CSV / أرقام']], 'usage')}
                ${area('pfx-fc-csv', 'بيانات CSV (للمصدر CSV)', '', 4, 'dir="ltr" placeholder="2026-10-01,120&#10;2026-10-02,135"')}
                <div class="fmx-grid2">${field('pfx-fc-cap', 'سعة النسخة الواحدة (طلب/ث)', '50', 'type="number"')}${field('pfx-fc-rpv', 'طلبات لكل زيارة', '20', 'type="number"')}</div>
                <div class="gh-row">${pbtn('fa-chart-line', 'توقّع 14 يوماً', call('pfForecastUI'))}</div><div id="pfx-fc-out"></div>`, 'fa-chart-line');
    };
    P.pfForecastSeries = async function (src) {
        if (src === 'csv') return parseSeries(val('pfx-fc-csv'));
        if (src === 'github') {
            const { githubOwner: o, githubRepo: r, githubToken: tok } = this.settings;
            if (!o || !r) throw new Error('اختر مستودع GitHub من الإعدادات');
            const res = await fetch(`https://api.github.com/repos/${o}/${r}/traffic/views`, { headers: { Accept: 'application/vnd.github+json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) } });
            if (!res.ok) throw new Error(res.status === 403 ? 'إحصاءات الزيارات تتطلب صلاحية push على المستودع' : 'GitHub HTTP ' + res.status);
            return ((await res.json()).views || []).map(v => v.count);
        }
        const days = this.pfUsage().days || {};
        return Object.keys(days).sort().map(k => Object.values(days[k]).reduce((a, b) => a + b, 0));
    };
    P.pfForecastUI = async function () {
        try {
            const series = await this.pfForecastSeries(val('pfx-fc-src'));
            const f = forecast(series, 14), el = document.getElementById('pfx-fc-out');
            if (f.method === 'none') { if (el) el.innerHTML = empty('يلزم 3 نقاط بيانات على الأقل'); return f; }
            const rpv = Number(val('pfx-fc-rpv')) || 20, cap = Number(val('pfx-fc-cap')) || 50;
            const peakRps = (f.peak * rpv) / 86400 * 10; // ×10: peak hour ≈ 10× the daily average rate
            const rep = replicasFor(peakRps, cap);
            this._pfForecast = { ...f, replicas: rep };
            if (el) el.innerHTML = `<div class="pfx-barrow"><span>الماضي</span>${sparkline(series, { w: 220, h: 40 })}</div><div class="pfx-barrow"><span>التوقع</span>${sparkline(f.values, { w: 220, h: 40, color: '#f6ae2d' })}</div>
                <p>الطريقة: <b>${f.method === 'holt' ? 'Holt (تمهيد أسي مزدوج)' : 'انحدار خطي'}</b> • الخطأ ±${f.error.toFixed(1)} • الذروة المتوقعة <b>${Math.round(f.peak)}</b>/يوم</p>
                <p>≈ ${peakRps.toFixed(2)} طلب/ث في ساعة الذروة → <b>${rep}</b> نسخة (استغلال 70%) — استعملها في «التوسع والتوزيع».</p>`
                + table(['اليوم', 'التوقع', 'المدى 80%'], f.values.map((v, i) => ['+' + (i + 1), String(Math.round(v)), `${Math.round(f.lower[i])} – ${Math.round(f.upper[i])}`]));
            return f;
        } catch (e) { return this.pfErr(e, 'pfx-fc-out'); }
    };

    // ------------------------------------------------------------------ SCALE: HPA (#887), LB (#888), cache (#889), DB (#890)
    P.pfScale = function () {
        const rep = (this._pfForecast && this._pfForecast.replicas) || 2;
        const keys = Array.from({ length: 3000 }, (_, i) => 'user:' + i), nodes = ['cache-a', 'cache-b', 'cache-c'];
        const dist = distribution(ringBuild(nodes), keys), moved = movedShare(nodes, 'cache-d', keys);
        return card('توسع تلقائي', `<div class="fmx-grid4">${field('pfx-sc-name', 'الاسم', 'ox-app')}${field('pfx-sc-port', 'المنفذ', '3000', 'type="number"')}${field('pfx-sc-min', 'أدنى', String(Math.max(1, Math.ceil(rep / 2))), 'type="number"')}${field('pfx-sc-max', 'أقصى', String(Math.max(rep * 2, 4)), 'type="number"')}</div>
                ${field('pfx-sc-image', 'صورة Docker', 'ghcr.io/me/ox-app:latest', 'dir="ltr"')}
                <div class="gh-row">${btn('fa-dharmachakra', 'Kubernetes HPA', call('pfScaleGen', 'k8s'))}${btn('fa-paper-plane', 'Fly.io', call('pfScaleGen', 'fly'))}</div>`, 'fa-up-right-and-down-left-from-center')
            + card('موزّع الحمل', `${area('pfx-sc-servers', 'الخوادم (سطر لكل خادم)', '10.0.0.11:3000\n10.0.0.12:3000\n10.0.0.13:3000', 3, 'dir="ltr"')}
                <div class="fmx-grid2">${select('pfx-sc-algo', 'الخوارزمية', [['least_conn', 'أقل اتصالات'], ['round_robin', 'تناوب'], ['ip_hash', 'حسب IP (جلسة ثابتة)']], 'least_conn')}${select('pfx-sc-sticky', 'جلسات لاصقة', [['0', 'لا'], ['1', 'نعم (cookie)']], '0')}</div>
                <div class="gh-row">${btn('fa-server', 'Nginx', call('pfScaleGen', 'nginx'))}${btn('fa-server', 'HAProxy', call('pfScaleGen', 'haproxy'))}</div>`, 'fa-scale-balanced')
            + card('تخزين مؤقت موزّع', `<p class="gh-muted">التجزئة المتسقة (consistent hashing) توزّع المفاتيح على العقد، وعند إضافة عقدة لا ينتقل إلا ~1/n من المفاتيح.</p>
                <p>3000 مفتاح على 3 عقد: ${Object.entries(dist).map(([n, c]) => `<code>${n}</code> ${c}`).join(' • ')} — إضافة عقدة رابعة تنقل <b>${Math.round(moved * 100)}%</b> فقط (مقابل ~75% مع hash % n).</p>
                <div class="gh-row">${btn('fa-memory', 'Redis cache-aside', call('pfScaleGen', 'redis'))}</div>`, 'fa-memory')
            + card('قاعدة بيانات موزعة', `<p class="gh-muted">نسخ قراءة (replicas) لتوزيع القراءة + PgBouncer لتجميع الاتصالات + تقسيم أفقي حسب المستأجر.</p>
                <div class="gh-row">${btn('fa-database', 'Postgres + نسخ قراءة', call('pfScaleGen', 'pg'))}${btn('fa-diagram-project', 'موجّه Sharding', call('pfScaleGen', 'shard'))}</div>`, 'fa-database')
            + '<div id="pfx-sc-out"></div>';
    };
    P.pfScaleConfig = function (kind) {
        const o = { name: val('pfx-sc-name') || 'ox-app', port: parseInt(val('pfx-sc-port'), 10) || 3000, min: parseInt(val('pfx-sc-min'), 10) || 2, max: parseInt(val('pfx-sc-max'), 10) || 10, image: val('pfx-sc-image') || undefined };
        const servers = String(val('pfx-sc-servers') || '').split(/\s*\n\s*/).filter(Boolean);
        const lb = { name: o.name, servers: servers.length ? servers : undefined, algo: val('pfx-sc-algo') || 'least_conn', sticky: val('pfx-sc-sticky') === '1' };
        const map = {
            k8s: ['deploy/k8s.yaml', () => k8sManifests(o)], fly: ['fly.toml', () => flyToml(o)],
            nginx: ['deploy/lb.nginx.conf', () => lbConfig('nginx', lb)], haproxy: ['deploy/haproxy.cfg', () => lbConfig('haproxy', lb)],
            redis: ['src/cache.js', () => redisCacheAside({})], pg: ['deploy/postgres-compose.yml', () => pgCompose({ replicas: 2 })], shard: ['src/db-router.js', () => shardRouter({ shards: 4 })]
        };
        const m = map[kind]; if (!m) return null;
        return { path: m[0], content: m[1]() };
    };
    P.pfScaleGen = function (kind) {
        const c = this.pfScaleConfig(kind); if (!c) return null;
        this._pfScaleOut = c;
        const el = document.getElementById('pfx-sc-out');
        if (el) el.innerHTML = card(esc(c.path), `<pre class="pfx-pre" dir="ltr">${esc(c.content)}</pre><div class="gh-row">${btn('fa-copy', 'نسخ', call('pfScaleCopy'))}${pbtn('fa-file-circle-plus', 'أضف إلى المشروع', call('pfScaleAdd'))}</div>`, 'fa-file-code');
        return c;
    };
    P.pfScaleCopy = function () { return this._pfScaleOut ? this.copyText(this._pfScaleOut.content) : false; };
    P.pfScaleAdd = function () { const c = this._pfScaleOut; if (!c) return null; this.writeProjectFile(c.path, c.content, 'template'); this.showToast('✅ أُضيف ' + c.path, 'success'); return c.path; };
}
