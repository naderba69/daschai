/* Local database on Dexie.js (#831), compressed storage (#812/#872), query optimisation (#849), algorithm optimisation (#850). */
import { esc, call, card, empty, stats, table, btn, pbtn, fmtBytes, fmtMs, textFiles, download, json, select, win, extOf, sevBadge } from './util.js';

// ------------------------------------------------------------------ PURE: SQL analysis (#849)
const SQL_RULES = [
    ['select-star', /\bselect\s+\*/i, 'medium', 'SELECT * يجلب أعمدة لا تحتاجها', 'حدد الأعمدة المطلوبة فقط'],
    ['like-leading', /\blike\s+'%[^']*'/i, 'high', "LIKE '%…' في البداية يمنع استعمال الفهرس", 'استعمل فهرس نصي كامل (FTS / trigram) أو ابحث بالبادئة'],
    ['order-rand', /\border\s+by\s+(rand|random)\s*\(\s*\)/i, 'high', 'ORDER BY RAND() يفرز الجدول كله', 'اختر مفتاحاً عشوائياً ضمن نطاق المعرّفات'],
    ['no-where-update', /\b(update|delete\s+from)\s+\w+\s*(set\b[^;]*)?(;|$)(?![\s\S]*\bwhere\b)/i, 'high', 'UPDATE/DELETE بلا WHERE', 'أضف شرط WHERE أو تأكد أن ذلك مقصود'],
    ['func-on-col', /\bwhere\b[^;]*\b(lower|upper|date|year|month|substr|cast)\s*\(\s*\w+/i, 'medium', 'دالة على العمود في WHERE تعطل الفهرس', 'خزن القيمة محسوبة أو أنشئ فهرساً على التعبير'],
    ['or-chain', /\bwhere\b[^;]*\bor\b[^;]*\bor\b/i, 'low', 'سلسلة OR طويلة', 'استعمل IN (...) أو UNION'],
    ['offset-big', /\boffset\s+\d{4,}/i, 'medium', 'OFFSET كبير بطيء (يمسح كل الصفوف السابقة)', 'استعمل ترقيم المفاتيح keyset: WHERE id > :last'],
    ['not-in-sub', /\bnot\s+in\s*\(\s*select/i, 'medium', 'NOT IN مع استعلام فرعي', 'استعمل NOT EXISTS أو LEFT JOIN … IS NULL'],
    ['count-star-exists', /\bcount\s*\(\s*\*\s*\)\s*>\s*0/i, 'low', 'COUNT(*) > 0 للتحقق من الوجود', 'استعمل EXISTS (يتوقف عند أول صف)'],
    ['distinct-join', /\bselect\s+distinct\b[^;]*\bjoin\b/i, 'low', 'DISTINCT مع JOIN قد يخفي تكراراً غير مقصود', 'راجع شروط الربط أو استعمل EXISTS']
];
export function sqlFindings(sql) {
    const s = String(sql || '');
    return SQL_RULES.filter(([, re]) => re.test(s)).map(([id, , sev, title, fix]) => ({ id, sev, title, fix }));
}
/** Columns used in WHERE / JOIN ON / ORDER BY → CREATE INDEX suggestions. */
export function suggestIndexes(sql) {
    const s = String(sql || '').replace(/\s+/g, ' '), out = new Map();
    const tables = []; let m;
    const reT = /\b(?:from|join|update|into)\s+([a-z_][\w.]*)(?:\s+(?:as\s+)?([a-z_]\w*))?/gi;
    while ((m = reT.exec(s))) { const al = m[2] && !/^(where|on|set|values|inner|left|right|join|order|group|limit)$/i.test(m[2]) ? m[2] : null; tables.push({ t: m[1], alias: al }); }
    const resolve = (ref) => { const [a, c] = ref.includes('.') ? ref.split('.') : [null, ref]; const t = a ? (tables.find(x => x.alias === a || x.t === a) || {}).t : (tables[0] || {}).t; return t ? { t, c } : null; };
    const add = (ref, why) => { const r = resolve(ref); if (r && !/^\d/.test(r.c)) { const k = r.t + '.' + r.c; if (!out.has(k)) out.set(k, { table: r.t, column: r.c, why, sql: `CREATE INDEX idx_${r.t.replace(/\W/g, '_')}_${r.c} ON ${r.t} (${r.c});` }); } };
    const reW = /\b(?:where|and|or)\s+([a-z_][\w.]*)\s*(=|>|<|>=|<=|in\b|between\b|like\b)/gi;
    while ((m = reW.exec(s))) add(m[1], 'WHERE');
    const reJ = /\bon\s+([a-z_][\w.]*)\s*=\s*([a-z_][\w.]*)/gi;
    while ((m = reJ.exec(s))) { add(m[1], 'JOIN'); add(m[2], 'JOIN'); }
    const reO = /\border\s+by\s+([a-z_][\w.]*)/gi;
    while ((m = reO.exec(s))) add(m[1], 'ORDER BY');
    return Array.from(out.values());
}
/** SQL statements inside .sql files and string literals of code files. */
export function extractSQL(path, content) {
    const c = String(content || '');
    if (/\.sql$/i.test(path)) return c.split(/;\s*(?:\n|$)/).map(x => x.trim()).filter(x => /^(select|update|delete|insert|with)\b/i.test(x)).map(sql => ({ path, sql }));
    const out = [], re = /(["'`])\s*((?:select|update|delete\s+from|insert\s+into|with)\b[\s\S]*?)\1/gi;
    let m; while ((m = re.exec(c)) && out.length < 200) if (m[2].length > 12) out.push({ path, sql: m[2].replace(/\$\{[^}]*\}/g, '?'), line: c.slice(0, m.index).split('\n').length });
    return out;
}
/** N+1: a DB/HTTP call awaited inside a loop body. */
export function nPlusOne(path, content) {
    const lines = String(content || '').split('\n'), out = [];
    let depth = 0; const stack = [];
    lines.forEach((l, i) => {
        if (/\b(for\s*\(|while\s*\(|\.forEach\s*\(|\.map\s*\(\s*async)/.test(l)) stack.push(depth);
        depth += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
        while (stack.length && depth <= stack[stack.length - 1] && /\}/.test(l)) stack.pop();
        if (stack.length && /\bawait\b[^;]*\b(query|find\w*|findOne|findById|get|fetch|select|execute|exec|count)\s*\(/.test(l)) out.push({ path, line: i + 1, text: l.trim().slice(0, 140) });
    });
    return out;
}

// ------------------------------------------------------------------ PURE: algorithm analysis (#850)
const ALGO_RULES = [
    ['includes-in-loop', /\.(includes|indexOf|find|findIndex|filter|some)\s*\(/, 'medium', 'بحث خطي داخل حلقة → O(n²)', 'حوّل القائمة إلى Set/Map قبل الحلقة'],
    ['sort-in-loop', /\.sort\s*\(/, 'high', 'فرز داخل حلقة → O(n² log n)', 'افرز مرة واحدة خارج الحلقة'],
    ['qs-in-loop', /document\.(querySelector|getElementById|querySelectorAll)\s*\(/, 'medium', 'استعلام DOM داخل حلقة', 'خزّن العنصر في متغير قبل الحلقة'],
    ['concat-in-loop', /\+=\s*['"`]|\w+\s*=\s*\w+\s*\+\s*['"`]/, 'low', 'بناء نص بالجمع داخل حلقة', 'اجمع في مصفوفة ثم join()'],
    ['spread-in-loop', /=\s*\[\s*\.\.\.\w+\s*,|=\s*\{\s*\.\.\.\w+\s*,/, 'medium', 'نسخ مصفوفة/كائن بالكامل في كل دورة', 'عدّل في مكانه أو اجمع ثم انسخ مرة واحدة'],
    ['regex-in-loop', /new\s+RegExp\s*\(/, 'low', 'إنشاء RegExp في كل دورة', 'أنشئه مرة واحدة خارج الحلقة'],
    ['await-in-loop', /\bawait\b/, 'medium', 'await متسلسل داخل حلقة', 'شغّل الطلبات المستقلة معاً: Promise.all']
];
const GLOBAL_RULES = [
    ['deep-clone-json', /JSON\.parse\s*\(\s*JSON\.stringify\s*\(/, 'low', 'نسخ عميق عبر JSON (بطيء ويفقد الأنواع)', 'استعمل structuredClone()'],
    ['naive-fib', /function\s+(\w+)\s*\([^)]*\)\s*\{[^}]*return[^;]*\b\1\s*\([^)]*-\s*1\)[^;]*\b\1\s*\([^)]*-\s*2\)/, 'high', 'تعاود أُسّي بلا تخزين (مثل فيبوناتشي)', 'أضف memoization أو حلاً تكرارياً O(n)'],
    ['sync-xhr', /\.open\s*\(\s*['"]\w+['"]\s*,[^,]+,\s*false\s*\)/, 'high', 'XMLHttpRequest متزامن يجمّد الواجهة', 'استعمل fetch غير المتزامن'],
    ['array-shift-loop', /while\s*\([^)]*\.length[^)]*\)\s*\{?[^}]*\.shift\s*\(\)/, 'medium', 'shift() داخل حلقة → O(n²)', 'استعمل مؤشراً (index) بدل الإزالة من البداية']
];
/** Loop-aware scan: rules that matter only inside loops + global anti-patterns + max loop nesting. */
export function algoFindings(path, content) {
    const c = String(content || ''), lines = c.split('\n'), out = [];
    let depth = 0, maxNest = 0, maxLine = 0; const loops = [];
    lines.forEach((l, i) => {
        const opens = (l.match(/\{/g) || []).length, closes = (l.match(/\}/g) || []).length;
        const isLoop = /\b(for|while)\s*\(|\.(forEach|map|reduce|filter|some|every)\s*\(\s*(\([^)]*\)|\w+)\s*=>/.test(l);
        if (isLoop) { loops.push(depth); if (loops.length > maxNest) { maxNest = loops.length; maxLine = i + 1; } }
        const inner = loops.length - (isLoop ? 1 : 0) >= 1 || (isLoop && /=>\s*[^{]/.test(l) && loops.length >= 2);
        if (loops.length >= (isLoop ? 2 : 1) || inner) {
            for (const [id, re, sev, title, fix] of ALGO_RULES) if (re.test(isLoop ? l.replace(/^.*?(for|while)\s*\([^)]*\)/, '') : l)) out.push({ path, line: i + 1, id, sev, title, fix, text: l.trim().slice(0, 140) });
        }
        depth += opens - closes;
        while (loops.length && depth <= loops[loops.length - 1]) loops.pop();
    });
    for (const [id, re, sev, title, fix] of GLOBAL_RULES) { const m = re.exec(c); if (m) out.push({ path, line: c.slice(0, m.index).split('\n').length, id, sev, title, fix, text: m[0].slice(0, 140) }); }
    if (maxNest >= 3) out.push({ path, line: maxLine, id: 'deep-nesting', sev: 'high', title: `${maxNest} حلقات متداخلة → O(n^${maxNest})`, fix: 'أعد الهيكلة: فهرسة مسبقة بـ Map، أو تقسيم المسألة', text: '' });
    const seen = new Set();
    return out.filter(f => { const k = f.id + ':' + f.line; if (seen.has(k)) return false; seen.add(k); return true; });
}
export const complexityOf = (findings) => { const n = Math.max(1, ...findings.filter(f => f.id === 'deep-nesting').map(f => +((f.title.match(/(\d+)/) || [])[1] || 1)), findings.some(f => /loop/.test(f.id)) ? 2 : 1); return n === 1 ? 'O(n)' : `O(n^${n})`; };

export function installData(P) {
    // ------------------------------------------------------------------ DEXIE (#831)
    P.pfDexie = async function () {
        if (this._pfDb) return this._pfDb;
        const mod = await import('dexie');
        const Dexie = mod.default || mod.Dexie;
        const W = win();
        const db = new Dexie('ox-perf-db', { indexedDB: W.indexedDB || globalThis.indexedDB, IDBKeyRange: W.IDBKeyRange || globalThis.IDBKeyRange });
        db.version(1).stores({ metrics: '++id, day, kind, t', searches: '++id, q, t, saved', benches: '++id, name, t', recs: '++id, rec, seq', events: '++id, t, key' });
        await db.open();
        this._pfDb = db;
        return db;
    };
    P.pfDBCounts = async function () {
        const db = await this.pfDexie(), out = {};
        for (const t of db.tables) out[t.name] = await t.count();
        return out;
    };
    /** Copy the daily aggregates from localStorage into the indexed `metrics` table (idempotent per day+kind). */
    P.pfDBImportDaily = async function () {
        const db = await this.pfDexie(), rows = this.pfDailyRows ? this.pfDailyRows() : [];
        let n = 0;
        for (const r of rows) for (const kind of ['lcp', 'cls', 'inp', 'boot']) {
            if (r[kind] == null) continue;
            const ex = await db.metrics.where('day').equals(r.day).filter(x => x.kind === kind).first();
            if (ex) await db.metrics.update(ex.id, { value: r[kind] }); else { await db.metrics.add({ day: r.day, kind, value: r[kind], t: Date.now() }); n++; }
        }
        return n;
    };
    /** Indexed range query vs. full scan over the same table (#849 on the app's own DB). */
    P.pfDBQueryDemo = async function (from, to) {
        const db = await this.pfDexie();
        if ((await db.events.count()) < 2000) await db.events.bulkAdd(Array.from({ length: 3000 }, (_, i) => ({ t: Date.now() - i * 60000, key: ['chat', 'search', 'studio', 'github'][i % 4] })));
        from = from || Date.now() - 864e5; to = to || Date.now();
        let t = performance.now();
        const idx = await db.events.where('t').between(from, to).count();
        const tIdx = performance.now() - t;
        t = performance.now();
        const scan = (await db.events.toArray()).filter(e => e.t >= from && e.t <= to).length;
        const tScan = performance.now() - t;
        return { idx, scan, tIdx, tScan, speedup: tIdx ? +(tScan / tIdx).toFixed(1) : null };
    };
    P.pfDB = async function () {
        let counts;
        try { counts = await this.pfDBCounts(); } catch (e) { return card('Dexie.js', empty('❌ IndexedDB غير متاح: ' + esc(e.message), true), 'fa-database'); }
        return card('قاعدة البيانات المحلية (Dexie.js فوق IndexedDB)', stats(Object.entries(counts).map(([k, v]) => [k, v]))
                + `<p class="gh-muted">جداول مفهرسة لمقاييس الأداء وسجل البحث ونتائج الـ Benchmark ومقاطع التسجيل — تتسع لمئات الميغابايت بدل حد localStorage (~5MB).</p>
                <div class="gh-row">${btn('fa-file-import', 'استيراد التقارير اليومية', call('pfDBImportDailyUI'))}${btn('fa-stopwatch', 'استعلام مفهرس مقابل مسح كامل', call('pfDBQueryDemoUI'))}${btn('fa-file-export', 'تصدير JSON', call('pfDBExport'))}${btn('fa-broom', 'مسح', call('pfDBClear'))}</div><div id="pfx-dbout"></div>`, 'fa-database');
    };
    P.pfDBImportDailyUI = async function () { const n = await this.pfDBImportDaily(); this.showToast(`✅ أُضيف ${n} سجل`, 'success'); this.pfRefresh(); return n; };
    P.pfDBQueryDemoUI = async function () {
        this.pfBusy('pfx-dbout', 'يقيس…');
        const r = await this.pfDBQueryDemo();
        const el = document.getElementById('pfx-dbout');
        if (el) el.innerHTML = table(['الطريقة', 'النتائج', 'الزمن'], [['فهرس t (between)', r.idx, fmtMs(r.tIdx)], ['مسح كامل + filter', r.scan, fmtMs(r.tScan)]]) + `<p>${r.speedup ? `الفهرس أسرع ×${r.speedup}` : ''}</p>`;
        return r;
    };
    P.pfDBExport = async function () {
        const db = await this.pfDexie(), out = {};
        for (const t of db.tables) out[t.name] = t.name === 'recs' ? await t.count() : await t.toArray();
        download(this, 'ox-perf-db.json', json(out), 'application/json');
        return out;
    };
    P.pfDBClear = async function () {
        if (this.askConfirm && !(await this.askConfirm('مسح قاعدة الأداء المحلية؟', 'تُحذف المقاييس وسجل البحث ونتائج القياس.'))) return false;
        const db = await this.pfDexie();
        for (const t of db.tables) await t.clear();
        this.pfRefresh();
        return true;
    };

    // ------------------------------------------------------------------ COMPRESSED STORAGE (#812, #872)
    P.pfLsKeys = function () {
        const out = [];
        try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i), v = localStorage.getItem(k) || ''; out.push({ key: k, bytes: (k.length + v.length) * 2, packed: v.startsWith('\u0001LZ') }); } } catch (e) {}
        return out.sort((a, b) => b.bytes - a.bytes);
    };
    P.pfStorageTest = function () {
        const json = JSON.stringify(this.sessions || []), t = performance.now();
        const packed = this.lzPack(json), ms = performance.now() - t;
        const t2 = performance.now(), back = this.lzUnpack(packed), ms2 = performance.now() - t2;
        return { raw: json.length, packed: packed.length, ratio: json.length ? Math.round(packed.length / json.length * 100) : 100, packMs: Math.round(ms), unpackMs: Math.round(ms2), ok: back === json };
    };
    P.pfStorage = function () {
        const st = this._lzStats || null, keys = this.pfLsKeys(), total = keys.reduce((n, k) => n + k.bytes, 0), mode = this.settings.storeCompress || 'auto';
        return card('ضغط المحادثات قبل الحفظ (LZ)', `<p>تُضغط المحادثات في localStorage بخوارزمية LZW تنتج نصاً آمناً (15 بت لكل حرف). النسخة الكاملة تبقى في IndexedDB.</p>
                ${select('pfx-lz', 'وضع الضغط', [['auto', 'تلقائي (فوق 256KB)'], ['always', 'دائماً'], ['off', 'متوقف']], mode, `onchange="app.pfSet('storeCompress', this.value); app.saveSessions(); app.pfRefresh()"`)}
                ${st ? stats([['الحجم الخام', fmtBytes(st.raw * 2)], ['بعد الضغط', fmtBytes(st.packed * 2)], ['النسبة', Math.round(st.packed / Math.max(1, st.raw) * 100) + '%'], ['زمن الضغط', fmtMs(st.ms)]]) : ''}
                <div class="gh-row">${btn('fa-flask', 'اختبار على محادثاتك', call('pfStorageTestUI'))}</div><div id="pfx-lzout"></div>`, 'fa-file-zipper')
            + card(`localStorage — ${fmtBytes(total)} من ~5MB`, table(['المفتاح', 'الحجم', 'مضغوط'], keys.slice(0, 15).map(k => [`<code>${esc(k.key)}</code>`, fmtBytes(k.bytes), k.packed ? '🗜️' : ''])), 'fa-hard-drive');
    };
    P.pfStorageTestUI = function () {
        const r = this.pfStorageTest(), el = document.getElementById('pfx-lzout');
        if (el) el.innerHTML = stats([['خام', fmtBytes(r.raw * 2)], ['مضغوط', fmtBytes(r.packed * 2)], ['النسبة', r.ratio + '%'], ['ضغط', fmtMs(r.packMs)], ['فك', fmtMs(r.unpackMs)], ['سليم', r.ok ? '✅' : '❌']]);
        return r;
    };

    // ------------------------------------------------------------------ QUERY OPTIMISATION (#849)
    P.pfQueryScan = function () {
        const files = textFiles(this.virtualProjectFiles).filter(([p]) => /\.(sql|js|ts|jsx|tsx|mjs|py|php|rb|go|java|cs)$/i.test(p));
        const stmts = files.flatMap(([p, f]) => extractSQL(p, f.content)).map(s => ({ ...s, findings: sqlFindings(s.sql), indexes: suggestIndexes(s.sql) }));
        const n1 = files.filter(([p]) => /\.(js|ts|jsx|tsx|mjs)$/i.test(p)).flatMap(([p, f]) => nPlusOne(p, f.content));
        return { stmts, n1 };
    };
    P.pfQueries = function () {
        const r = this.pfQueryScan(), idx = new Map();
        r.stmts.forEach(s => s.indexes.forEach(i => idx.set(i.sql, i)));
        const issues = r.stmts.filter(s => s.findings.length);
        return card('تحليل يدوي', `<textarea id="pfx-sql" class="form-input-box" rows="4" dir="ltr" placeholder="SELECT * FROM orders o JOIN users u ON o.user_id = u.id WHERE o.status = 'paid' ORDER BY o.created_at"></textarea>
                <div class="gh-row">${pbtn('fa-magnifying-glass-chart', 'حلّل', call('pfAnalyzeSQL'))}${btn('fa-wand-magic-sparkles', 'أعد الكتابة بالذكاء', call('pfSQLAI'))}</div><div id="pfx-sqlout"></div>`, 'fa-database')
            + card(`استعلامات المشروع (${r.stmts.length})`, issues.length ? table(['الملف', 'المشكلة', 'الخطورة', 'الحل'], issues.flatMap(s => s.findings.map(f => [`<code>${esc(s.path)}${s.line ? ':' + s.line : ''}</code>`, esc(f.title), sevBadge(f.sev), esc(f.fix)]))) : empty(r.stmts.length ? 'لا مشاكل واضحة 🎉' : 'لا استعلامات SQL في المشروع'), 'fa-list-check')
            + card(`فهارس مقترحة (${idx.size})`, idx.size ? `<pre class="pfx-pre" dir="ltr">${esc(Array.from(idx.keys()).join('\n'))}</pre>` : empty('—'), 'fa-key')
            + card(`مشكلة N+1 (${r.n1.length})`, r.n1.length ? table(['الملف', 'سطر', 'الكود'], r.n1.map(x => [`<code>${esc(x.path)}</code>`, x.line, `<code>${esc(x.text)}</code>`])) + '<p class="gh-muted">اجلب الكل باستعلام واحد (IN / JOIN) أو استعمل Promise.all.</p>' : empty('لا استدعاءات قاعدة بيانات داخل حلقات'), 'fa-repeat');
    };
    P.pfAnalyzeSQL = function (sql) {
        sql = sql || (document.getElementById('pfx-sql') || {}).value || '';
        const f = sqlFindings(sql), ix = suggestIndexes(sql), el = document.getElementById('pfx-sqlout');
        if (el) el.innerHTML = (f.length ? table(['المشكلة', 'الخطورة', 'الحل'], f.map(x => [esc(x.title), sevBadge(x.sev), esc(x.fix)])) : '<p>✅ لا مشاكل معروفة</p>') + (ix.length ? `<pre class="pfx-pre" dir="ltr">${esc(ix.map(i => i.sql).join('\n'))}</pre>` : '');
        return { findings: f, indexes: ix };
    };
    P.pfSQLAI = async function () {
        const sql = (document.getElementById('pfx-sql') || {}).value || '';
        if (!sql.trim()) return this.showToast('اكتب استعلاماً', 'warning');
        const r = await this.pfAI('حسّن أداء هذا الاستعلام. اشرح خطة التنفيذ المتوقعة، والفهارس اللازمة، وأعطِ النسخة المحسنة:\n```sql\n' + sql + '\n```');
        const el = document.getElementById('pfx-sqlout'); if (r && el) el.innerHTML = `<div class="gh-md">${this.renderMarkdownSafe(r)}</div>`;
        return r;
    };

    // ------------------------------------------------------------------ ALGORITHMS (#850)
    P.pfAlgoScan = function () {
        return textFiles(this.virtualProjectFiles).filter(([p]) => /\.(js|ts|jsx|tsx|mjs|cjs)$/i.test(p) && !/node_modules|\.min\./.test(p)).map(([p, f]) => { const fi = algoFindings(p, f.content); return { path: p, findings: fi, complexity: complexityOf(fi) }; }).filter(x => x.findings.length);
    };
    P.pfAlgo = function () {
        const r = this.pfAlgoScan(), all = r.flatMap(x => x.findings);
        return card('ملخص', stats([['ملفات بها ملاحظات', r.length], ['ملاحظات', all.length], ['مرتفعة', all.filter(f => f.sev === 'high').length]]), 'fa-microchip')
            + card('الملاحظات', all.length ? table(['الملف', 'سطر', 'المشكلة', 'الخطورة', 'الحل'], all.slice(0, 80).map(f => [`<code>${esc(f.path)}</code>`, f.line, esc(f.title) + (f.text ? `<br><small dir="ltr"><code>${esc(f.text)}</code></small>` : ''), sevBadge(f.sev), esc(f.fix)])) : empty('لا أنماط بطيئة معروفة في ملفات JS/TS 🎉'), 'fa-list')
            + card('تحسين ملف بالذكاء الاصطناعي', `<div class="gh-row">${select('pfx-algo-file', 'الملف', r.map(x => [x.path, `${x.path} (${x.complexity})`]), r[0] ? r[0].path : '')}${pbtn('fa-wand-magic-sparkles', 'اقترح نسخة أسرع', call('pfAlgoAI'))}</div><div id="pfx-algoout"></div>`, 'fa-robot');
    };
    P.pfAlgoAI = async function (path) {
        path = path || (document.getElementById('pfx-algo-file') || {}).value;
        const f = path && this.virtualProjectFiles.get(path);
        if (!f) return this.showToast('اختر ملفاً', 'warning');
        const notes = algoFindings(path, f.content).map(x => `- سطر ${x.line}: ${x.title}`).join('\n');
        const r = await this.pfAI(`حسّن تعقيد الخوارزميات في هذا الملف دون تغيير السلوك. الملاحظات:\n${notes}\n\nأعد الأجزاء المعدلة فقط مع شرح التعقيد قبل/بعد.\n\`\`\`\n${String(f.content).slice(0, 12000)}\n\`\`\``, { kind: 'coding', maxTokens: 3000 });
        const el = document.getElementById('pfx-algoout'); if (r && el) el.innerHTML = `<div class="gh-md">${this.renderMarkdownSafe(r)}</div>`;
        return r;
    };
}

