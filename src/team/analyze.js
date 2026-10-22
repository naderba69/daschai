/* Project analytics: test coverage (#905), performance (#906), security (#907), project comparison (#909), bug tracking (#913). */
import { esc, call, callRaw, btn, pbtn, card, empty, field, select, val, setHTML, lsGet, lsSet, uid, stats, table, bar, sevBadge, extOf, baseName, textFiles, groupBy, ago, fmtDate, DAY, iso, pct } from './util.js';

// ------------------------------------------------------------------ PURE: coverage
export function parseLcov(text) {
    const files = [];
    let cur = null;
    for (const raw of String(text || '').split('\n')) {
        const line = raw.trim();
        if (line.startsWith('SF:')) cur = { path: line.slice(3).replace(/\\/g, '/'), lf: 0, lh: 0, fnf: 0, fnh: 0, brf: 0, brh: 0, uncovered: [] };
        else if (!cur) continue;
        else if (line.startsWith('DA:')) { const [ln, hits] = line.slice(3).split(',').map(Number); if (hits === 0) cur.uncovered.push(ln); }
        else if (line.startsWith('LF:')) cur.lf = +line.slice(3);
        else if (line.startsWith('LH:')) cur.lh = +line.slice(3);
        else if (line.startsWith('FNF:')) cur.fnf = +line.slice(4);
        else if (line.startsWith('FNH:')) cur.fnh = +line.slice(4);
        else if (line.startsWith('BRF:')) cur.brf = +line.slice(4);
        else if (line.startsWith('BRH:')) cur.brh = +line.slice(4);
        else if (line === 'end_of_record') { files.push(cur); cur = null; }
    }
    return summarizeCoverage(files.map(f => ({ path: f.path, lines: [f.lh, f.lf], funcs: [f.fnh, f.fnf], branches: [f.brh, f.brf], uncovered: f.uncovered })));
}
/** Istanbul coverage-summary.json */
export function parseCoverageSummary(json) {
    const obj = typeof json === 'string' ? JSON.parse(json) : json;
    return summarizeCoverage(Object.entries(obj).filter(([k]) => k !== 'total').map(([path, v]) => ({ path: path.replace(/\\/g, '/'), lines: [v.lines.covered, v.lines.total], funcs: [v.functions.covered, v.functions.total], branches: [v.branches.covered, v.branches.total], uncovered: [] })));
}
function summarizeCoverage(files) {
    const sum = (k) => files.reduce((a, f) => [a[0] + f[k][0], a[1] + f[k][1]], [0, 0]);
    const p = ([h, t]) => (t ? Math.round(h / t * 1000) / 10 : 100);
    const tl = sum('lines'), tf = sum('funcs'), tb = sum('branches');
    return { files: files.map(f => ({ ...f, pct: p(f.lines) })).sort((a, b) => a.pct - b.pct), total: { lines: p(tl), funcs: p(tf), branches: p(tb), linesHit: tl[0], linesTotal: tl[1] } };
}
export const isTestPath = (p) => /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(py|go)$|(^|\/)test_[^/]+\.py$/i.test(p);
const SRC_EXT = ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'go', 'vue', 'svelte', 'rb', 'php', 'java', 'cs'];
/** No coverage report → estimate: which source files are referenced by a test file. */
export function heuristicCoverage(map) {
    const files = textFiles(map);
    const tests = files.filter(([p]) => isTestPath(p));
    const sources = files.filter(([p]) => !isTestPath(p) && SRC_EXT.includes(extOf(p)) && !/(^|\/)(node_modules|dist|build|vendor)\//.test(p) && !/\.config\.[cm]?[jt]s$/.test(p));
    const testText = tests.map(([p, f]) => p + '\n' + f.content).join('\n');
    const rows = sources.map(([p]) => {
        const stem = baseName(p).replace(/\.[^.]+$/, '');
        const re = new RegExp(`(['"/\\\\]|\\b)${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.[a-z]+)?['"]|${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(test|spec)\\.`, 'i');
        return { path: p, tested: stem.length > 1 && re.test(testText) };
    });
    const tested = rows.filter(r => r.tested).length;
    return { rows: rows.sort((a, b) => a.tested - b.tested || a.path.localeCompare(b.path)), tested, total: rows.length, ratio: rows.length ? Math.round(tested / rows.length * 100) : 0, tests: tests.length };
}

// ------------------------------------------------------------------ PURE: static scans
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;
function scan(map, rules) {
    const out = [];
    for (const [path, f] of textFiles(map)) {
        if (/(^|\/)(node_modules|dist|vendor)\/|\.min\.(js|css)$/.test(path)) continue;
        const ext = extOf(path), text = f.content;
        for (const r of rules) {
            if (r.ext && !r.ext.includes(ext)) continue;
            if (r.file) { const res = r.file(path, text, f); if (res) out.push({ path, line: res.line || 1, rule: r.id, severity: r.sev, msg: res.msg || r.msg }); continue; }
            r.re.lastIndex = 0;
            let m, n = 0;
            while ((m = r.re.exec(text)) && n < 20) { n++; out.push({ path, line: lineOf(text, m.index), rule: r.id, severity: r.sev, msg: r.msg, snippet: m[0].slice(0, 80) }); if (!r.re.global) break; }
        }
    }
    return out;
}
const JS = ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'svelte', 'html'];
export const PERF_RULES = [
    { id: 'big-file', sev: 'medium', msg: 'ملف كبير (>200KB) يبطئ التحميل', file: (p, t) => (t.length > 200000 && !/\.(json|md|csv|txt|lock)$/.test(p) ? { msg: `ملف كبير ${(t.length / 1024).toFixed(0)}KB يبطئ التحميل` } : null) },
    { id: 'big-image', sev: 'medium', msg: 'صورة كبيرة — اضغطها أو استخدم WebP/AVIF', file: (p, t, f) => (f.dataUrl && f.dataUrl.length > 400000 ? { msg: `صورة ${(f.dataUrl.length * 0.75 / 1024).toFixed(0)}KB — اضغطها أو حوّلها إلى WebP` } : null) },
    { id: 'await-in-loop', sev: 'medium', msg: 'await داخل حلقة — نفّذ بالتوازي بـ Promise.all', ext: JS, re: /for\s*\([^)]*\)\s*\{[^{}]{0,300}?\bawait\b/g },
    { id: 'dom-in-loop', sev: 'medium', msg: 'استعلام DOM داخل حلقة — خزّنه خارجها', ext: JS, re: /(for|while)\s*\([^)]*\)\s*\{[^{}]{0,200}?document\.(querySelector|getElementById)/g },
    { id: 'nested-loops', sev: 'low', msg: 'حلقات متداخلة (O(n²)) — فكّر في Map/Set', ext: JS.concat(['py']), re: /for\s*\([^)]*\)\s*\{[^{}]{0,200}?for\s*\(/g },
    { id: 'sync-xhr', sev: 'high', msg: 'XMLHttpRequest متزامن يجمّد الواجهة', ext: JS, re: /\.open\(\s*['"][A-Z]+['"]\s*,[^,)]+,\s*false\s*\)/g },
    { id: 'document-write', sev: 'high', msg: 'document.write يعطّل التحليل ويبطئ الصفحة', ext: JS, re: /document\.write\s*\(/g },
    { id: 'blocking-script', sev: 'medium', msg: 'سكربت في <head> بدون defer/async يعيق العرض', ext: ['html'], re: /<head[\s\S]*?<script(?![^>]*\b(defer|async|type=["']module))[^>]*\bsrc=[^>]*>/gi },
    { id: 'no-lazy-img', sev: 'low', msg: 'صورة بدون loading="lazy"', ext: ['html', 'jsx', 'tsx', 'vue'], re: /<img(?![^>]*loading=)[^>]*>/gi },
    { id: 'interval-leak', sev: 'low', msg: 'setInterval بدون clearInterval في الملف', ext: JS, file: (p, t) => (/setInterval\s*\(/.test(t) && !/clearInterval\s*\(/.test(t) ? { line: lineOf(t, t.search(/setInterval\s*\(/)), msg: 'setInterval بدون clearInterval — تسرب محتمل' } : null) },
    { id: 'console-spam', sev: 'low', msg: 'console.log كثيرة في كود الإنتاج', ext: JS, file: (p, t) => { const n = (t.match(/console\.log\(/g) || []).length; return n > 10 ? { msg: `${n} استدعاء console.log` } : null; } },
    { id: 'json-clone', sev: 'low', msg: 'JSON.parse(JSON.stringify()) للنسخ — استخدم structuredClone', ext: JS, re: /JSON\.parse\(\s*JSON\.stringify\(/g }
];
export const SEC_RULES = [
    { id: 'secret-aws', sev: 'high', msg: 'مفتاح AWS مكشوف في الكود', re: /AKIA[0-9A-Z]{16}/g },
    { id: 'secret-gh', sev: 'high', msg: 'رمز GitHub مكشوف في الكود', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g },
    { id: 'secret-key', sev: 'high', msg: 'مفتاح API مكشوف (sk-…)', re: /\bsk-(?:or-|ant-|proj-)?[A-Za-z0-9_-]{20,}/g },
    { id: 'private-key', sev: 'high', msg: 'مفتاح خاص داخل المشروع', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
    { id: 'hardcoded-pass', sev: 'medium', msg: 'كلمة سر مكتوبة في الكود', re: /\b(password|passwd|secret|api_?key)\s*[:=]\s*['"][^'"\s]{6,}['"]/gi },
    { id: 'eval', sev: 'high', msg: 'eval/new Function — تنفيذ كود ديناميكي خطير', ext: JS.concat(['py']), re: /\beval\s*\(|new\s+Function\s*\(/g },
    { id: 'inner-html', sev: 'medium', msg: 'innerHTML بقيمة متغيرة — خطر XSS (استخدم textContent أو التعقيم)', ext: JS, re: /\.innerHTML\s*[+]?=\s*(?!['"`]\s*['"`]?;?$)[^;\n]*(\$\{|\+\s*\w)/g },
    { id: 'dangerous-html', sev: 'medium', msg: 'dangerouslySetInnerHTML — تأكد من التعقيم', ext: ['jsx', 'tsx', 'js'], re: /dangerouslySetInnerHTML/g },
    { id: 'sql-concat', sev: 'high', msg: 'استعلام SQL بدمج نصوص — استخدم معاملات Parameterized', re: /(SELECT|INSERT|UPDATE|DELETE)\s[^'"`;]{0,80}(['"`]\s*\+\s*\w|\$\{)/gi },
    { id: 'http-link', sev: 'low', msg: 'رابط http غير مشفر', ext: JS.concat(['css']), re: /['"(]http:\/\/(?!localhost|127\.0\.0\.1|www\.w3\.org)[^'")\s]+/g },
    { id: 'blank-target', sev: 'low', msg: 'target="_blank" بدون rel="noopener"', ext: ['html', 'jsx', 'tsx', 'vue'], re: /<a\b(?![^>]*\brel=)[^>]*target=["']_blank["'][^>]*>/gi },
    { id: 'weak-random', sev: 'medium', msg: 'Math.random لتوليد رموز/معرفات أمنية — استخدم crypto.getRandomValues', ext: JS, re: /(token|secret|password|otp|nonce)\w*\s*=\s*[^;\n]*Math\.random/gi },
    { id: 'token-storage', sev: 'low', msg: 'تخزين رمز دخول في localStorage', ext: JS, re: /localStorage\.setItem\(\s*['"][^'"]*(token|jwt|auth)[^'"]*['"]/gi },
    { id: 'env-file', sev: 'high', msg: 'ملف .env داخل المشروع — لا ترفعه إلى Git', file: (p) => (/(^|\/)\.env(\.|$)/.test(p) && !/\.example$/.test(p) ? { msg: 'ملف أسرار .env داخل المشروع' } : null) }
];
export const perfScan = (map) => scan(map, PERF_RULES);
export const securityScan = (map) => scan(map, SEC_RULES);
/** 100 − weighted findings (high 15, medium 6, low 2), floored at 0. */
export const scanScore = (findings) => Math.max(0, 100 - findings.reduce((n, f) => n + ({ high: 15, medium: 6, low: 2 }[f.severity] || 1), 0));

// ------------------------------------------------------------------ PURE: metrics + comparison
export function projectMetrics(map) {
    const files = textFiles(map);
    const all = Array.from(map || []);
    let lines = 0, blank = 0, comments = 0, branches = 0, todos = 0, bytes = 0;
    const langs = {};
    let largest = { path: '', lines: 0 };
    for (const [p, f] of files) {
        const ls = f.content.split('\n');
        const e = extOf(p) || 'other';
        langs[e] = (langs[e] || 0) + ls.length;
        lines += ls.length; bytes += f.content.length;
        for (const l of ls) { const t = l.trim(); if (!t) blank++; else if (/^(\/\/|#|\/\*|\*|<!--|--)/.test(t)) comments++; }
        branches += (f.content.match(/\b(if|for|while|case|catch)\b|&&|\|\||\?[^?:]*:/g) || []).length;
        todos += (f.content.match(/\b(TODO|FIXME|HACK)\b/g) || []).length;
        if (ls.length > largest.lines) largest = { path: p, lines: ls.length };
    }
    let deps = 0;
    const pkg = map && map.get && map.get('package.json');
    if (pkg && pkg.content) { try { const j = JSON.parse(pkg.content); deps = Object.keys(j.dependencies || {}).length + Object.keys(j.devDependencies || {}).length; } catch (e) { /* invalid */ } }
    const tests = files.filter(([p]) => isTestPath(p)).length;
    const code = lines - blank - comments;
    return { files: all.length, textFiles: files.length, lines, code, blank, comments, bytes, tests, testRatio: files.length ? Math.round(tests / files.length * 100) : 0, commentRatio: lines ? Math.round(comments / lines * 100) : 0, complexity: code ? Math.round(branches / code * 1000) / 10 : 0, todos, deps, largest, langs, avgLines: files.length ? Math.round(lines / files.length) : 0 };
}
const CMP = [['files', 'عدد الملفات', 0], ['lines', 'الأسطر', 0], ['code', 'أسطر الكود', 0], ['tests', 'ملفات الاختبار', 1], ['testRatio', 'نسبة الاختبارات %', 1], ['commentRatio', 'نسبة التعليقات %', 1], ['complexity', 'التعقيد (فروع/100 سطر)', -1], ['avgLines', 'متوسط أسطر الملف', -1], ['todos', 'TODO/FIXME', -1], ['deps', 'الاعتماديات', -1], ['bytes', 'الحجم (بايت)', 0]];
/** Rows comparing two metric objects; better = 'a' | 'b' | '' using each metric's direction. */
export function compareMetrics(a, b) {
    return CMP.filter(([k]) => a[k] != null || b[k] != null).map(([k, label, dir]) => {
        const x = a[k] == null ? null : a[k], y = b[k] == null ? null : b[k];
        const better = x == null || y == null || dir === 0 || x === y ? '' : (dir > 0 ? (x > y ? 'a' : 'b') : (x < y ? 'a' : 'b'));
        return { key: k, label, a: x, b: y, diff: x != null && y != null ? Math.round((x - y) * 10) / 10 : null, better };
    });
}

// ------------------------------------------------------------------ PURE: bugs
export function bugStats(issues, now = Date.now(), weeks = 8) {
    const bugs = issues.filter(i => !i.pull_request);
    const closed = bugs.filter(i => i.closed_at);
    const ttr = closed.map(i => (new Date(i.closed_at) - new Date(i.created_at)) / DAY).filter(n => n >= 0);
    const wk = (t) => Math.floor((now - new Date(t).getTime()) / (7 * DAY));
    const opened = Array(weeks).fill(0), fixed = Array(weeks).fill(0);
    bugs.forEach(i => { const w = wk(i.created_at); if (w >= 0 && w < weeks) opened[weeks - 1 - w]++; });
    closed.forEach(i => { const w = wk(i.closed_at); if (w >= 0 && w < weeks) fixed[weeks - 1 - w]++; });
    const labels = {};
    bugs.forEach(i => (i.labels || []).forEach(l => { const n = l.name || l; if (n !== 'bug') labels[n] = (labels[n] || 0) + 1; }));
    const open = bugs.length - closed.length;
    return { total: bugs.length, open, closed: closed.length, mttrDays: ttr.length ? Math.round(ttr.reduce((a, b) => a + b, 0) / ttr.length * 10) / 10 : null, opened, fixed, trend: opened.slice(-2).reduce((a, b) => a + b, 0) - fixed.slice(-2).reduce((a, b) => a + b, 0), labels, oldest: bugs.filter(i => !i.closed_at).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).slice(0, 5) };
}
/** Group runtime errors by message → recurring problems. */
export function groupErrors(errors) {
    const g = {};
    for (const e of errors) { const k = String(e.message || e.msg || e).replace(/\d+/g, 'N').slice(0, 120); (g[k] = g[k] || { msg: String(e.message || e.msg || e).slice(0, 200), n: 0, last: 0 }).n++; g[k].last = Math.max(g[k].last, e.t || e.time || 0); }
    return Object.values(g).sort((a, b) => b.n - a.n);
}

const findingsTable = (list) => list.length ? `<div class="tmx-findings">${list.slice(0, 200).map(f => `<div class="gh-item">${sevBadge(f.severity)} <span>${esc(f.msg)}</span><a href="#" dir="ltr" onclick="${call('tmGotoFinding', f.path, f.line)};return false">${esc(f.path)}:${f.line}</a></div>`).join('')}</div>` : empty('✅ لا ملاحظات');
const sparkBars = (arr, color) => { const m = Math.max(1, ...arr); return `<div class="tmx-spark">${arr.map(v => `<span style="height:${Math.round(v / m * 100)}%;${color ? 'background:' + color : ''}" title="${v}"></span>`).join('')}</div>`; };

export function installAnalyze(P) {
    P.tmGotoFinding = function (path, line) { return this.tmLiveFollowPeer ? this.tmLiveFollowPeer(path, line) : null; };

    // ------------------------------------------------------------------ COVERAGE (#905)
    P.tmCoverageData = function () {
        const files = this.virtualProjectFiles;
        const lcovPath = [...files.keys()].find(p => /(^|\/)lcov\.info$/.test(p));
        if (lcovPath) return { source: lcovPath, report: parseLcov(files.get(lcovPath).content) };
        const sumPath = [...files.keys()].find(p => /coverage-summary\.json$/.test(p));
        if (sumPath) { try { return { source: sumPath, report: parseCoverageSummary(files.get(sumPath).content) }; } catch (e) { /* invalid */ } }
        return { source: null, heuristic: heuristicCoverage(files) };
    };
    P.tmCoverage = async function () {
        const d = this.tmCoverageData();
        if (d.report) {
            const r = d.report;
            return card('تغطية الاختبارات', `${stats([['الأسطر', r.total.lines + '%'], ['الدوال', r.total.funcs + '%'], ['الفروع', r.total.branches + '%'], ['الملفات', r.files.length]])}<div class="tmx-note">المصدر: <code>${esc(d.source)}</code></div>
                ${table(['الملف', 'الأسطر', '', 'غير مغطى'], r.files.slice(0, 80).map(f => [`<code dir="ltr">${esc(f.path)}</code>`, f.pct + '%', bar(f.pct, 100, '', f.pct < 50 ? '#ef4444' : f.pct < 80 ? '#f59e0b' : '#22c55e'), f.uncovered.slice(0, 8).join(', ')]))}
                <div class="gh-row">${btn('fa-robot', 'اقترح اختبارات للملفات الأقل تغطية', call('tmSuggestTests'))}</div><div id="tm-cov-ai"></div>`, 'fa-vial-circle-check');
        }
        const h = d.heuristic;
        return card('تغطية الاختبارات (تقدير)', `<div class="tmx-note">لا يوجد تقرير تغطية (lcov.info أو coverage-summary.json) في المشروع — هذا تقدير بحسب الملفات التي تشير إليها الاختبارات. شغّل <code dir="ltr">npx vitest --coverage</code> أو <code dir="ltr">jest --coverage</code> وارفع التقرير لنتيجة دقيقة.</div>
            ${stats([['ملفات مختبرة', `${h.tested}/${h.total}`], ['التغطية التقديرية', h.ratio + '%'], ['ملفات اختبار', h.tests]])}${bar(h.ratio, 100, '', h.ratio < 50 ? '#ef4444' : '#22c55e')}
            ${h.rows.length ? table(['الملف', 'الحالة'], h.rows.slice(0, 80).map(r => [`<code dir="ltr">${esc(r.path)}</code>`, r.tested ? '✅ له اختبار' : '⚠️ بدون اختبار'])) : empty('لا ملفات مصدرية')}
            <div class="gh-row"><label class="fmx-field"><span>ارفع تقرير تغطية</span><input type="file" id="tm-cov-file" class="form-input-box" accept=".info,.json" onchange="app.tmCoverageUpload(this)"></label>${btn('fa-robot', 'اقترح اختبارات للملفات غير المختبرة', call('tmSuggestTests'))}</div><div id="tm-cov-ai"></div>`, 'fa-vial');
    };
    P.tmCoverageUpload = async function (input) {
        const f = input && input.files && input.files[0]; if (!f) return null;
        const text = await f.text();
        const path = /\.json$/i.test(f.name) ? 'coverage/coverage-summary.json' : 'coverage/lcov.info';
        this.writeProjectFile(path, text, 'import');
        return this.tmRefresh();
    };
    P.tmSuggestTests = async function () {
        const d = this.tmCoverageData();
        const targets = d.report ? d.report.files.filter(f => f.pct < 80).slice(0, 3).map(f => f.path) : d.heuristic.rows.filter(r => !r.tested).slice(0, 3).map(r => r.path);
        const files = targets.map(p => [p, this.virtualProjectFiles.get(p) || this.virtualProjectFiles.get(p.replace(/^.*?\/(src\/)/, '$1'))]).filter(([, f]) => f && typeof f.content === 'string');
        if (!files.length) { setHTML('tm-cov-ai', empty('لا ملفات تحتاج اختبارات 👍')); return null; }
        this.tmBusy('tm-cov-ai', 'OX-AI يكتب الاختبارات…');
        const out = await this.tmAI(`Write focused unit tests (same language/framework conventions as the project) for these files. Output each test file as a fenced code block preceded by its path in the form "### path/to/file.test.js".\n\n${files.map(([p, f]) => `### ${p}\n\`\`\`\n${f.content.slice(0, 6000)}\n\`\`\``).join('\n\n')}`, { kind: 'coding', maxTokens: 4000 });
        if (!out) { setHTML('tm-cov-ai', empty('لم يصل رد', true)); return null; }
        const blocks = this.parseFileBlocks ? this.parseFileBlocks(out) : [];
        this._tmTestBlocks = blocks;
        setHTML('tm-cov-ai', `<div class="tmx-ai-out">${this.renderMarkdownSafe ? this.renderMarkdownSafe(out) : esc(out)}</div>${blocks.length ? pbtn('fa-floppy-disk', `أضف ${blocks.length} ملف اختبار للمشروع`, call('tmSaveTestBlocks')) : ''}`);
        return out;
    };
    P.tmSaveTestBlocks = function () { const b = this._tmTestBlocks || []; b.forEach(x => this.writeProjectFile(x.path, x.content, 'ai')); if (this.renderStudioExplorer) this.renderStudioExplorer(); this.showToast(`🧪 أُضيف ${b.length} ملف اختبار`, 'success'); return b.length; };

    // ------------------------------------------------------------------ PERFORMANCE (#906) + SECURITY (#907)
    const scanCard = (app, title, icon, findings, kind) => {
        const score = scanScore(findings);
        const by = groupBy(findings, f => f.severity);
        return card(title, `${stats([['الدرجة', `${score}/100`], ['مرتفع', (by.high || []).length], ['متوسط', (by.medium || []).length], ['منخفض', (by.low || []).length]])}${bar(score, 100, '', score < 50 ? '#ef4444' : score < 80 ? '#f59e0b' : '#22c55e')}
            ${findingsTable(findings)}<div class="gh-row">${btn('fa-robot', 'اشرح وأصلح بالذكاء', call('tmScanFixAI', kind))}${btn('fa-file-export', 'تقرير Markdown', call('tmScanReport', kind))}</div><div id="tm-scan-ai"></div>`, icon);
    };
    P.tmPerf = async function () {
        const f = perfScan(this.virtualProjectFiles); this._tmScan = { perf: f };
        const m = projectMetrics(this.virtualProjectFiles);
        const big = textFiles(this.virtualProjectFiles).filter(([p]) => /\.(js|mjs|css)$/.test(p)).map(([p, x]) => [p, x.content.length]).sort((a, b) => b[1] - a[1]).slice(0, 5);
        return scanCard(this, 'تحليل الأداء', 'fa-gauge-high', f, 'perf')
            + card('أكبر ملفات JS/CSS (وزن التحميل)', big.length ? table(['الملف', 'الحجم'], big.map(([p, n]) => [`<code dir="ltr">${esc(p)}</code>`, (n / 1024).toFixed(1) + ' KB'])) : empty('—'), 'fa-weight-hanging')
            + card('مؤشرات', stats([['أسطر الكود', m.code], ['متوسط أسطر الملف', m.avgLines], ['التعقيد', m.complexity], ['أكبر ملف', esc(baseName(m.largest.path)) + ` (${m.largest.lines})`]]), 'fa-chart-simple');
    };
    P.tmSecurity = async function () {
        const f = securityScan(this.virtualProjectFiles); this._tmScan = { sec: f };
        return scanCard(this, 'تحليل الأمان', 'fa-shield-halved', f, 'sec') + '<div class="tmx-note">فحص ثابت محلي للكود — لا يُرسل شيء خارج المتصفح ما لم تطلب الشرح بالذكاء.</div>';
    };
    P.tmScanReport = function (kind) {
        const f = (this._tmScan || {})[kind] || (kind === 'perf' ? perfScan(this.virtualProjectFiles) : securityScan(this.virtualProjectFiles));
        const md = `# ${kind === 'perf' ? 'تقرير الأداء' : 'تقرير الأمان'}\n\nالدرجة: **${scanScore(f)}/100** — ${f.length} ملاحظة\n\n${f.map(x => `- [${x.severity}] ${x.msg} — \`${x.path}:${x.line}\``).join('\n')}\n`;
        const path = `reports/${kind === 'perf' ? 'performance' : 'security'}-${new Date().toISOString().slice(0, 10)}.md`;
        this.writeProjectFile(path, md, 'team');
        if (this.renderStudioExplorer) this.renderStudioExplorer();
        this.showToast(`📄 حُفظ ${this.escapeHTML(path)}`, 'success');
        return md;
    };
    P.tmScanFixAI = async function (kind) {
        const f = ((this._tmScan || {})[kind] || []).slice(0, 15);
        if (!f.length) return null;
        this.tmBusy('tm-scan-ai', 'OX-AI يحلل الملاحظات…');
        const ctx = f.map(x => { const file = this.virtualProjectFiles.get(x.path); const lines = file && typeof file.content === 'string' ? file.content.split('\n') : []; return `- ${x.msg} @ ${x.path}:${x.line}\n\`\`\`\n${lines.slice(Math.max(0, x.line - 3), x.line + 2).join('\n')}\n\`\`\``; }).join('\n');
        const out = await this.tmAI(`These are ${kind === 'perf' ? 'performance' : 'security'} findings from a static scan. Prioritize them, explain the risk briefly in Arabic and give the concrete fixed code for each.\n\n${ctx}`, { kind: 'coding', maxTokens: 3000 });
        setHTML('tm-scan-ai', out ? `<div class="tmx-ai-out">${this.renderMarkdownSafe ? this.renderMarkdownSafe(out) : esc(out)}</div>` : empty('لم يصل رد', true));
        return out;
    };

    // ------------------------------------------------------------------ COMPARE PROJECTS (#909)
    const SNAP_KEY = 'ox_team_snapshots_v1';
    P.tmSnapshots = function () { return lsGet(SNAP_KEY, []); };
    P.tmSaveSnapshot = function (name = val('tm-snap-name')) {
        const m = projectMetrics(this.virtualProjectFiles);
        const s = { id: uid('snap'), name: name || `لقطة ${new Date().toLocaleDateString('ar')}`, t: Date.now(), metrics: { ...m, sec: scanScore(securityScan(this.virtualProjectFiles)), perf: scanScore(perfScan(this.virtualProjectFiles)) } };
        lsSet(SNAP_KEY, [s, ...this.tmSnapshots()].slice(0, 30));
        if (document.getElementById('tmx-sec')) this.tmRefresh();
        return s;
    };
    P.tmRepoMetrics = async function (full) {
        full = String(full || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
        if (!/^[\w.-]+\/[\w.-]+$/.test(full)) throw new Error('اكتب المستودع بالشكل owner/repo');
        const [info, langs] = await Promise.all([this.gh(`/repos/${full}`), this.gh(`/repos/${full}/languages`).catch(() => ({}))]);
        const tree = await this.gh(`/repos/${full}/git/trees/${encodeURIComponent(info.default_branch || 'main')}?recursive=1`).catch(() => ({ tree: [] }));
        const blobs = (tree.tree || []).filter(x => x.type === 'blob');
        const tests = blobs.filter(x => isTestPath(x.path)).length;
        return { name: full, files: blobs.length, tests, testRatio: blobs.length ? Math.round(tests / blobs.length * 100) : 0, bytes: Object.values(langs).reduce((a, b) => a + b, 0), stars: info.stargazers_count, openIssues: info.open_issues_count, langs };
    };
    P.tmCompare = async function (opts = {}) {
        const snaps = this.tmSnapshots();
        const cur = projectMetrics(this.virtualProjectFiles);
        const other = opts.metrics || this._tmCmp;
        const rows = other ? compareMetrics(cur, other.metrics || other) : [];
        const fmt = (v) => (v == null ? '—' : typeof v === 'number' ? v.toLocaleString('en') : esc(v));
        return card('قارن المشروع الحالي مع…', `<div class="gh-row">${select('tm-cmp-snap', 'لقطة محفوظة', [['', '—'], ...snaps.map(s => [s.id, `${s.name} (${new Date(s.t).toLocaleDateString('ar')})`])], '')}${btn('fa-code-compare', 'قارن', callRaw('tmCompareSnap', [], "document.getElementById('tm-cmp-snap').value"))}</div>
            <div class="gh-row">${field('tm-cmp-repo', 'أو مستودع GitHub', '', 'dir="ltr" placeholder="vercel/next.js"')}${btn('fa-github', 'قارن', callRaw('tmCompareRepo', [], "document.getElementById('tm-cmp-repo').value"))}</div>
            <div class="gh-row">${field('tm-snap-name', 'احفظ لقطة للحالة الحالية', '', 'placeholder="قبل إعادة الهيكلة"')}${btn('fa-camera', 'حفظ لقطة', call('tmSaveSnapshot'))}</div>`, 'fa-code-compare')
            + (other ? card(`الحالي ⟷ ${esc(other.name)}`, table(['المقياس', 'الحالي', esc(other.name), 'الفرق'], rows.map(r => [esc(r.label), `${fmt(r.a)}${r.better === 'a' ? ' 🏆' : ''}`, `${fmt(r.b)}${r.better === 'b' ? ' 🏆' : ''}`, r.diff == null ? '—' : (r.diff > 0 ? '+' : '') + r.diff]))
                + `<div class="tmx-langs">${Object.entries(cur.langs).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `<span class="fmx-tag">${esc(k)} ${pct(v, cur.lines)}%</span>`).join('')}</div>`, 'fa-scale-balanced') : '');
    };
    P.tmCompareSnap = function (id) { const s = this.tmSnapshots().find(x => x.id === id); if (!s) return null; this._tmCmp = { name: s.name, metrics: s.metrics }; return this.tmRefresh(); };
    P.tmCompareRepo = async function (full) { try { const m = await this.tmRepoMetrics(full); this._tmCmp = { name: m.name, metrics: m }; return this.tmRefresh(); } catch (e) { return this.tmErr(e); } };

    // ------------------------------------------------------------------ BUG TRACKING (#913)
    P.tmBugs = async function () {
        const errs = groupErrors((this.getErrorLog ? this.getErrorLog() : []) || []);
        let runs = [];
        await this._runHistQ; // pending history writes land first
        try { runs = ((this.idbGet && (await this.idbGet('run_history_v1'))) || []).filter(r => !r.success && r.error); } catch (e) { runs = []; }
        let issues = [];
        if (this.tmHasGH()) issues = await this.tmList(`${this.ghRepoPath()}/issues?labels=bug&state=all&since=${encodeURIComponent(iso(Date.now() - 90 * DAY))}`, { max: 300 }).catch(() => []);
        const localBugs = (this.tasks || []).filter(t => /bug|خطأ|إصلاح|fix/i.test(t.title)).map(t => ({ title: t.title, created_at: iso(t.created), closed_at: t.status === 'done' && t.done ? iso(t.done) : null, labels: [] }));
        const st = bugStats(issues.length ? issues : localBugs);
        this._tmBugStats = st;
        return card('الأخطاء المبلّغ عنها', `${stats([['مفتوحة', st.open], ['مغلقة', st.closed], ['متوسط زمن الإصلاح', st.mttrDays == null ? '—' : st.mttrDays + ' يوم'], ['الاتجاه', st.trend > 0 ? '📈 يتزايد' : st.trend < 0 ? '📉 يتناقص' : '➖ ثابت']])}
            <div class="tmx-twin"><div><small>فُتحت أسبوعياً</small>${sparkBars(st.opened, '#ef4444')}</div><div><small>أُغلقت أسبوعياً</small>${sparkBars(st.fixed, '#22c55e')}</div></div>
            ${st.oldest.length ? `<b>الأقدم المفتوح</b>${st.oldest.map(i => `<div class="gh-item"><span>🐞 ${esc(i.title)}</span><small>${ago(i.created_at)}</small></div>`).join('')}` : ''}
            <div class="tmx-note">${issues.length ? 'من Issues بوسم bug على GitHub (آخر 90 يوماً).' : 'من مهامك المحلية التي تحتوي «bug/خطأ/إصلاح» — أضف رمز GitHub لتتبع Issues.'}</div>`, 'fa-bug')
            + card('أخطاء التشغيل المتكررة', errs.length ? errs.slice(0, 10).map(e => `<div class="gh-item"><span>⚠️ ${esc(e.msg)}</span><span class="fmx-count-badge">×${e.n}</span></div>`).join('') : empty('لا أخطاء تشغيل مسجلة 🎉'), 'fa-triangle-exclamation')
            + card('تشغيلات فاشلة', runs.length ? runs.slice(0, 8).map(r => `<div class="gh-item"><span dir="ltr">${esc(r.path || 'snippet')}: ${esc(String(r.error).slice(0, 140))}</span><small>${ago(r.at)}</small></div>`).join('') : empty('لا تشغيلات فاشلة'), 'fa-circle-xmark')
            + (this.tmHasGH() ? card('أبلغ عن خطأ', `<div class="gh-row">${field('tm-bug-title', 'العنوان', '')}${pbtn('fa-bug', 'إنشاء Issue', call('tmReportBug'))}</div>`, 'fa-plus') : '');
    };
    P.tmReportBug = async function (title = val('tm-bug-title'), body = '') {
        if (!title) return null;
        await this.tmEnsureLabel('bug', 'd73a4a', 'Something is broken');
        const errs = groupErrors((this.getErrorLog ? this.getErrorLog() : []) || []).slice(0, 3);
        const i = await this.tmGH('/issues', { method: 'POST', body: { title, body: body || `أُبلغ من OX-Alpha.\n\n${errs.length ? 'أخطاء حديثة:\n' + errs.map(e => `- ${e.msg} (×${e.n})`).join('\n') : ''}`, labels: ['bug'] } }).catch(e => this.tmErr(e));
        if (i) { this.showToast(`🐞 أُنشئ #${i.number}`, 'success'); this.tmRefresh(); }
        return i;
    };
}
