/* Smart organisation: auto-organise + better folder (#621 #622), better names (#625), AI classification (#626),
   auto tags (#627), meaning-aware search (#628), folder summary (#629), missing files (#630).
   Every tool has a local (offline) result; AI refines it when a key is set. */
import { esc, call, btn, pbtn, card, empty, baseName, dirName, extOf, stemOf, kindOf, val, words, isTextEntry } from './shared.js';

const ROOT_KEEP = /^(readme|license|licence|changelog|contributing|code_of_conduct|security|package(-lock)?\.json|tsconfig.*\.json|jsconfig\.json|vite\.config\.\w+|webpack\.config\.\w+|babel\.config\.\w+|\.\w+|index\.html|manifest\.json|sw\.js|vercel\.json|netlify\.toml|dockerfile|makefile|requirements\.txt|pyproject\.toml|go\.mod|cargo\.toml|build\.js|server\.js|app\.(js|ts|py)|main\.(js|ts|py|go)|eslint.*|prettier.*)$/i;
/** Local rule-based move suggestions (#621/#622). */
export function suggestMoves(paths) {
    const set = new Set(paths), out = [];
    const target = (p) => {
        const name = baseName(p), dir = dirName(p), k = kindOf(p), lower = name.toLowerCase();
        if (/\.(test|spec)\.[jt]sx?$/.test(lower) && !/(^|\/)(tests?|__tests__|spec)(\/|$)/.test(dir)) return ['tests/' + name, 'ملفات الاختبار تُجمع في tests/'];
        if (dir) return null;
        if (ROOT_KEEP.test(lower)) return null;
        if (k === 'image' && !/^(favicon|logo|icon)/.test(lower)) return ['assets/images/' + name, 'الصور في مجلد أصول'];
        if (k === 'audio' || k === 'video') return ['assets/media/' + name, 'الوسائط في مجلد أصول'];
        if (k === 'doc') return ['docs/' + name, 'التوثيق في docs/'];
        if (k === 'style') return ['styles/' + name, 'ملفات التنسيق معاً'];
        if (k === 'data' && !/^(\.|package)/.test(lower)) return ['data/' + name, 'ملفات البيانات في data/'];
        if (/\.(sh|ps1|bat)$/.test(lower)) return ['scripts/' + name, 'السكربتات في scripts/'];
        if (/^[A-Z][A-Za-z0-9]+\.(jsx|tsx|vue|svelte)$/.test(name)) return ['src/components/' + name, 'مكوّن واجهة'];
        if (/\.(jsx?|tsx?|mjs|cjs)$/.test(lower)) return ['src/' + name, 'الكود المصدري في src/'];
        return null;
    };
    for (const p of paths) {
        const t = target(p);
        if (t && t[0] !== p && !set.has(t[0])) out.push({ from: p, to: t[0], reason: t[1] });
    }
    return out;
}
const VAGUE = /^(untitled|new[-_ ]?file|newfile|file|image|img|photo|screenshot|screen shot|copy|copy of .*|temp|tmp|document|doc|scan|download|unnamed|asdf|test\d*|lorem|bla+|aaa+|xxx+|نسخة|ملف|صورة|بدون عنوان)([-_ ]?\(?\d*\)?)*$/i;
export const isVagueName = (path) => { const s = stemOf(path); return VAGUE.test(s) || /^(IMG|DSC|DCIM|PXL|VID|WhatsApp Image)[-_ ]?\d/i.test(s) || /^\d+$/.test(s) || /^[a-f0-9]{16,}$/i.test(s); };
const kebab = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60);
/** Name derived from content (first heading / exported symbol / <title> / json name). */
export function nameFromContent(path, content) {
    if (typeof content !== 'string' || !content.trim()) return null;
    const ext = extOf(path);
    const m = /^#\s+(.+)$/m.exec(content) || /export\s+default\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/.exec(content) || /export\s+(?:async\s+)?(?:function|class|const)\s+([A-Za-z_$][\w$]*)/.exec(content)
        || /<title>([^<]+)<\/title>/i.exec(content) || /^(?:def|class)\s+([A-Za-z_]\w*)/m.exec(content) || /"name"\s*:\s*"([^"]+)"/.exec(content) || /^(?:function|class)\s+([A-Za-z_$][\w$]*)/m.exec(content);
    if (!m) return null;
    const raw = m[1].trim();
    const pascal = /^(jsx|tsx|vue|svelte)$/.test(ext) && /^[A-Z]/.test(raw);
    const stem = pascal ? raw.replace(/[^\w]/g, '') : kebab(raw);
    return stem ? (dirName(path) ? dirName(path) + '/' : '') + stem + (ext ? '.' + ext : '') : null;
}
/** Local classifier (#626) + tags (#627). */
const CATS = [['tests', 'اختبارات', /(\.test\.|\.spec\.|(^|\/)tests?\/|describe\(|it\(|assert)/], ['config', 'إعدادات', /(config|\.rc$|\.env|tsconfig|\.ya?ml$|\.toml$|dockerfile|\.github\/)/i],
    ['docs', 'توثيق', /\.(md|txt|rst)$/], ['ui', 'واجهة', /(\.(jsx|tsx|vue|svelte|html|css|scss)$|components?\/|className=|<div)/], ['api', 'خادم/API', /(express|fastify|router\.|app\.(get|post)|fetch\(|axios|api\/|endpoint|@app\.route)/i],
    ['data', 'بيانات', /\.(json|csv|sql|geojson|xml)$/], ['assets', 'أصول', /\.(png|jpe?g|gif|svg|webp|mp3|wav|mp4|webm|ttf|woff2?)$/], ['build', 'بناء ونشر', /(build|webpack|vite|rollup|esbuild|ci|deploy|workflow)/i], ['logic', 'منطق', /./]];
const TECH = [['react', /from ['"]react['"]|useState\(/], ['vue', /from ['"]vue['"]|<template>/], ['express', /require\(['"]express['"]\)|from ['"]express['"]/], ['tailwind', /className="[^"]*\b(flex|grid|px-|py-|text-)/], ['typescript', /:\s*(string|number|boolean)\b|interface\s+\w+/],
    ['async', /\basync\b|await\b|Promise/], ['dom', /document\.|querySelector/], ['node', /require\(|process\.env|module\.exports/], ['sql', /\bSELECT\b|\bINSERT\b/i], ['python', /^def |^import \w+$/m], ['todo', /TODO|FIXME/]];
export function classifyFile(path, content = '') {
    const hay = path + '\n' + (typeof content === 'string' ? content.slice(0, 6000) : '');
    const cat = CATS.find(([, , re]) => re.test(hay));
    const tags = [kindOf(path), extOf(path)].concat(TECH.filter(([, re]) => re.test(content || '')).map(([t]) => t)).filter(Boolean);
    return { category: cat[0], label: cat[1], tags: Array.from(new Set(tags)).slice(0, 8) };
}
/** Meaning-aware local search (#628): TF-IDF over identifiers with camelCase split + Arabic/English synonyms. */
const SYN = { login: ['auth', 'signin', 'session', 'password', 'تسجيل', 'دخول'], auth: ['login', 'token', 'jwt', 'oauth', 'مصادقة'], pay: ['payment', 'stripe', 'checkout', 'invoice', 'دفع'], user: ['account', 'profile', 'member', 'مستخدم'], db: ['database', 'sql', 'query', 'mongo', 'prisma', 'قاعدة'],
    style: ['css', 'theme', 'color', 'تنسيق'], test: ['spec', 'assert', 'expect', 'اختبار'], upload: ['file', 'storage', 's3', 'رفع'], error: ['exception', 'catch', 'throw', 'خطأ'], route: ['router', 'path', 'endpoint', 'navigation', 'مسار'], email: ['mail', 'smtp', 'بريد'], search: ['find', 'query', 'filter', 'بحث'],
    'تسجيل': ['login', 'auth'], 'دفع': ['payment', 'stripe'], 'مستخدم': ['user', 'account'], 'بحث': ['search', 'filter'], 'رفع': ['upload'], 'خطأ': ['error'], 'اختبار': ['test'], 'تنسيق': ['style', 'css'], 'قاعدة': ['database', 'db'] };
export const tokens = (s) => words(String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' '));
export function semanticSearch(files, query, limit = 15) {
    const q = tokens(query), expanded = new Set(q);
    q.forEach(t => { (SYN[t] || []).forEach(x => expanded.add(x)); Object.keys(SYN).forEach(k => { if (t.length > 3 && (k.startsWith(t) || t.startsWith(k))) SYN[k].concat(k).forEach(x => expanded.add(x)); }); });
    const docs = files.map(([path, content]) => { const tf = new Map(); tokens(path + ' ' + path + ' ' + (content || '').slice(0, 20000)).forEach(t => tf.set(t, (tf.get(t) || 0) + 1)); return { path, tf, len: Array.from(tf.values()).reduce((a, b) => a + b, 0) || 1 }; });
    const df = (t) => docs.filter(d => d.tf.has(t)).length;
    const idf = new Map(Array.from(expanded).map(t => [t, Math.log(1 + docs.length / (1 + df(t)))]));
    return docs.map(d => {
        let score = 0; const hits = [];
        expanded.forEach(t => { const n = d.tf.get(t) || 0; if (n) { score += (n / d.len) * 100 * idf.get(t) * (q.includes(t) ? 2 : 1); hits.push(t); } });
        return { path: d.path, score: +score.toFixed(3), hits };
    }).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}
/** Missing-file checks (#630). */
export function missingFiles(paths, read = () => '') {
    const has = (re) => paths.some(p => re.test(p)), anyText = (re) => paths.some(p => re.test(read(p) || ''));
    const out = [];
    const add = (path, why, content) => { if (!paths.includes(path)) out.push({ path, why, content }); };
    const name = (read('package.json').match(/"name"\s*:\s*"([^"]+)"/) || [])[1] || 'project';
    if (!has(/^readme(\.md)?$/i)) add('README.md', 'لا يوجد README يشرح المشروع', `# ${name}\n\n## التشغيل\n\n\`\`\`bash\nnpm install\nnpm start\n\`\`\`\n`);
    if (!has(/^licen[sc]e/i)) add('LICENSE', 'لا توجد رخصة — الكود غير قابل لإعادة الاستخدام قانونياً', `MIT License\n\nCopyright (c) ${new Date().getFullYear()}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software, to deal in the Software without restriction.\n`);
    if (!has(/^\.gitignore$/)) add('.gitignore', 'لا يوجد .gitignore', 'node_modules/\ndist/\n.env\n.DS_Store\ncoverage/\n');
    if (has(/package\.json$/) && !has(/(\.test\.|\.spec\.|^tests?\/)/)) add('tests/basic.test.js', 'لا اختبارات في المشروع', "import assert from 'node:assert';\nassert.strictEqual(1 + 1, 2);\nconsole.log('ok');\n");
    if (!has(/^changelog/i)) add('CHANGELOG.md', 'لا سجل تغييرات', '# Changelog\n\n## [Unreleased]\n');
    if (!has(/^\.editorconfig$/)) add('.editorconfig', 'لتوحيد المسافات بين المحررات', 'root = true\n\n[*]\nindent_style = space\nindent_size = 2\nend_of_line = lf\ninsert_final_newline = true\n');
    if (!has(/^\.github\/workflows\//)) add('.github/workflows/ci.yml', 'لا تكامل مستمر CI', 'name: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with: { node-version: 20 }\n      - run: npm ci\n      - run: npm test\n');
    if (anyText(/process\.env\.|import\.meta\.env\.|os\.environ/) && !has(/^\.env\.example$/)) add('.env.example', 'يستخدم الكود متغيرات بيئة بلا ملف مثال', paths.map(p => Array.from((read(p) || '').matchAll(/process\.env\.([A-Z0-9_]+)|import\.meta\.env\.([A-Z0-9_]+)/g)).map(m => (m[1] || m[2]) + '=')).flat().filter((v, i, a) => a.indexOf(v) === i).join('\n') + '\n');
    if (has(/\.tsx?$/) && !has(/tsconfig\.json$/)) add('tsconfig.json', 'ملفات TypeScript بدون tsconfig', JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'ESNext', strict: true, jsx: 'react-jsx', moduleResolution: 'bundler' } }, null, 2) + '\n');
    if (has(/\.html$/) && !has(/favicon\.(ico|svg|png)$/)) add('favicon.svg', 'موقع بلا أيقونة', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2563eb"/><text x="32" y="44" font-size="34" text-anchor="middle" fill="#fff" font-family="sans-serif">★</text></svg>\n');
    if (has(/^index\.html$/) && !has(/^robots\.txt$/)) add('robots.txt', 'موقع بلا robots.txt', 'User-agent: *\nAllow: /\n');
    if (has(/\.py$/) && !has(/(requirements\.txt|pyproject\.toml)$/)) add('requirements.txt', 'مشروع Python بلا قائمة اعتماديات', '');
    return out;
}

export function installSmart(P) {
    const textFiles = (app, dir = '') => Array.from(app.virtualProjectFiles.entries()).filter(([p, e]) => (!dir || p.startsWith(dir + '/')) && isTextEntry(e)).map(([p, e]) => [p, e.content]);
    const planTable = (plan, applyCall, cols = ['from', 'to', 'reason']) => plan.length ? `<table class="fmx-table" id="fmx-plan"><thead><tr><th><input type="checkbox" checked onchange="document.querySelectorAll('#fmx-plan .fmx-pick').forEach(c=>c.checked=this.checked)"></th><th>من</th><th>إلى</th><th>السبب</th></tr></thead><tbody>${plan.map((m, i) => `<tr><td><input type="checkbox" class="fmx-pick" data-i="${i}" checked></td><td dir="ltr">${esc(m[cols[0]])}</td><td dir="ltr"><b>${esc(m[cols[1]])}</b></td><td>${esc(m[cols[2]] || '')}</td></tr>`).join('')}</tbody></table><div class="gh-row">${pbtn('fa-check', 'تطبيق المحدد', applyCall)}</div>` : empty('✨ لا اقتراحات — الملفات منظمة');
    const picked = (plan) => { const boxes = document.querySelectorAll('#fmx-plan .fmx-pick'); return boxes.length ? plan.filter((_, i) => boxes[i] && boxes[i].checked) : plan; };
    /** Rename keeping metadata (tags, lock…). */
    P.fmxRename = function (from, to) {
        const meta = this.fileMeta(from);
        this._fmxUnlock = true;
        try { this.renameProjectFile(from, to, { silent: true }); } finally { this._fmxUnlock = false; }
        if (Object.keys(meta).length) { this.setFileMeta(to, meta); this.setFileMeta(from, Object.fromEntries(Object.keys(meta).map(k => [k, null]))); }
        return to;
    };
    P.fmxApplyMoves = function (plan) {
        let n = 0; const errors = [];
        for (const m of plan) { try { this.fmxRename(m.from, m.to); n++; } catch (e) { errors.push(`${m.from}: ${e.message}`); } }
        if (this.renderStudioExplorer) this.renderStudioExplorer();
        this.showToast(`✅ نُقل/أعيدت تسمية ${n} ملف${errors.length ? ` • ${errors.length} أخطاء` : ''}`, errors.length ? 'warning' : 'success');
        return { moved: n, errors };
    };

    // ---- organise (#621) / better folder (#622)
    P.fmxOrganize = function () {
        this._fmxPlan = suggestMoves(this.projectPaths());
        return card('تنظيم تلقائي للملفات', `<div class="text-dim">اقتراحات نقل الملفات إلى مجلدات أنسب (قواعد محلية فورية). «تحسين بالذكاء» يحلل أسماء الملفات ومحتواها لاقتراح هيكلة كاملة.</div>
            <div class="gh-row">${btn('fa-wand-magic-sparkles', 'تحسين بالذكاء الاصطناعي', 'app.fmxOrganizeAI()')}</div><div id="fmx-plan-box">${planTable(this._fmxPlan, 'app.fmxApplyMoves(app.fmxPickedPlan())')}</div>`, 'fa-folder-tree');
    };
    P.fmxPickedPlan = function () { return picked(this._fmxPlan || []); };
    P.fmxOrganizeAI = async function () {
        this.fmxBusy('fmx-plan-box', 'يحلل الذكاء الاصطناعي الهيكل…');
        const ctx = this.projectPaths().slice(0, 300).map(p => { const e = this.virtualProjectFiles.get(p); return `${p}${isTextEntry(e) ? ' :: ' + e.content.slice(0, 120).replace(/\s+/g, ' ') : ''}`; }).join('\n');
        const r = await this.aiJSON(`Suggest a cleaner folder structure for this project. Only move files that are clearly misplaced; keep root config files. Return {"moves":[{"from":"old/path","to":"new/path","reason":"short Arabic reason"}]}.\n\n${ctx}`, { kind: 'coding', maxTokens: 3000, source: 'fmx-organize' });
        const paths = new Set(this.projectPaths());
        const moves = ((r && r.moves) || []).filter(m => m && paths.has(m.from) && m.to && !paths.has(m.to) && m.to !== m.from);
        this._fmxPlan = r ? moves : suggestMoves(this.projectPaths());
        const el = document.getElementById('fmx-plan-box');
        if (el) el.innerHTML = (r ? '' : '<div class="text-dim">بدون مفتاح — عُرضت الاقتراحات المحلية</div>') + planTable(this._fmxPlan, 'app.fmxApplyMoves(app.fmxPickedPlan())');
        return this._fmxPlan;
    };

    // ---- better names (#625)
    P.fmxNameSuggestions = function () {
        const out = [];
        for (const [p, e] of this.virtualProjectFiles) {
            if (!isVagueName(p)) continue;
            const to = nameFromContent(p, isTextEntry(e) ? e.content : '');
            out.push({ from: p, to: to && !this.virtualProjectFiles.has(to) ? to : '', reason: to ? 'من محتوى الملف' : 'اسم غامض — استخدم «اقتراح بالذكاء»' });
        }
        return out;
    };
    P.fmxNames = function () {
        this._fmxPlan = this.fmxNameSuggestions().filter(x => x.to);
        const vague = this.fmxNameSuggestions().filter(x => !x.to);
        return card('اقتراح أسماء أفضل', `<div class="text-dim">يكتشف الأسماء الغامضة (untitled، IMG_1234، copy (2)…) ويقترح أسماء من المحتوى. الذكاء الاصطناعي يرى الصور أيضاً لتسميتها حسب ما فيها.</div>
            <div class="gh-row">${btn('fa-wand-magic-sparkles', `اقتراح بالذكاء (${this._fmxPlan.length + vague.length})`, 'app.fmxNamesAI()')}</div><div id="fmx-plan-box">${planTable(this._fmxPlan, 'app.fmxApplyMoves(app.fmxPickedPlan())')}${vague.length ? `<div class="text-dim">أسماء غامضة بلا اقتراح محلي: ${vague.map(v => `<code dir="ltr">${esc(v.from)}</code>`).join(' ')}</div>` : ''}</div>`, 'fa-signature');
    };
    P.fmxNamesAI = async function (pathsArg) {
        const targets = pathsArg || this.fmxNameSuggestions().map(x => x.from);
        if (!targets.length) { this.showToast('لا أسماء غامضة', 'info'); return []; }
        this.fmxBusy('fmx-plan-box', 'يقترح الذكاء الاصطناعي أسماء…');
        const images = [], lines = [];
        for (const p of targets.slice(0, 30)) {
            const e = this.virtualProjectFiles.get(p);
            if (e && e.dataUrl && kindOf(p) === 'image' && images.length < 4) { images.push(e.dataUrl); lines.push(`${p} :: [image #${images.length}]`); }
            else lines.push(`${p} :: ${isTextEntry(e) ? e.content.slice(0, 400).replace(/\s+/g, ' ') : '(binary)'}`);
        }
        const r = await this.aiJSON(`Suggest descriptive kebab-case file names (keep the extension and folder) for these vaguely named files. Return {"names":[{"from":"path","to":"new/path","reason":"short Arabic reason"}]}.\n\n${lines.join('\n')}`, { kind: 'coding', images: images.length ? images : undefined, maxTokens: 2000, source: 'fmx-names' });
        const set = new Set(this.projectPaths());
        this._fmxPlan = ((r && r.names) || []).filter(m => set.has(m.from) && m.to && !set.has(m.to) && extOf(m.to) === extOf(m.from));
        const el = document.getElementById('fmx-plan-box');
        if (el) el.innerHTML = r ? planTable(this._fmxPlan, 'app.fmxApplyMoves(app.fmxPickedPlan())') : empty('يلزم مفتاح OpenRouter');
        return this._fmxPlan;
    };

    // ---- classify (#626) + auto tags (#627)
    P.fmxClassifyAll = function () { return Array.from(this.virtualProjectFiles.entries()).map(([p, e]) => ({ path: p, ...classifyFile(p, isTextEntry(e) ? e.content : '') })); };
    P.fmxClassify = function () {
        const res = this._fmxClassRes || this.fmxClassifyAll();
        this._fmxClassRes = res;
        const groups = {};
        res.forEach(r => { (groups[r.label] = groups[r.label] || []).push(r); });
        return card('تصنيف ووسوم تلقائية', `<div class="gh-row">${pbtn('fa-tags', 'تطبيق الوسوم على كل الملفات', 'app.fmxApplyAutoTags()')}${btn('fa-wand-magic-sparkles', 'تصنيف أدق بالذكاء', 'app.fmxClassifyAI()')}${btn('fa-rotate', 'إعادة', 'app._fmxClassRes=null;app.fmxRefresh()')}</div>
            <div id="fmx-class">${Object.entries(groups).map(([label, items]) => `<details class="fmx-group" open><summary><b>${esc(label)}</b> (${items.length})</summary>${items.map(r => `<div class="fmx-class-row" data-class="${esc(r.path)}"><span dir="ltr">${esc(r.path)}</span> ${r.tags.map(t => `<span class="fmx-tag">#${esc(t)}</span>`).join('')}${r.summary ? `<small class="text-dim"> — ${esc(r.summary)}</small>` : ''}</div>`).join('')}</details>`).join('')}</div>`, 'fa-tags');
    };
    P.fmxApplyAutoTags = function (res = this._fmxClassRes || this.fmxClassifyAll()) {
        let n = 0;
        res.forEach(r => { const cur = this.fileMeta(r.path).tags || []; const tags = Array.from(new Set(cur.concat(r.tags, ['cat:' + r.category]))).slice(0, 20); if (tags.length !== cur.length) { this.setFileMeta(r.path, { tags }); n++; } });
        this.showToast(`🏷️ وُسم ${n} ملف`, 'success');
        return n;
    };
    P.fmxClassifyAI = async function () {
        this.fmxBusy('fmx-class', 'يصنف الذكاء الاصطناعي الملفات…');
        const list = this.projectPaths().slice(0, 150).map(p => { const e = this.virtualProjectFiles.get(p); return `${p} :: ${isTextEntry(e) ? e.content.slice(0, 250).replace(/\s+/g, ' ') : '(binary)'}`; }).join('\n');
        const r = await this.aiJSON(`Classify each file of this project. category ∈ [tests, config, docs, ui, api, data, assets, build, logic]. Give 2-5 short lowercase topic tags and a one-line Arabic summary. Return {"files":[{"path":"…","category":"…","tags":["…"],"summary":"…"}]}.\n\n${list}`, { kind: 'coding', maxTokens: 6000, source: 'fmx-classify' });
        const labels = Object.fromEntries(CATS.map(([id, l]) => [id, l]));
        if (r && Array.isArray(r.files)) {
            const local = Object.fromEntries(this.fmxClassifyAll().map(x => [x.path, x]));
            this._fmxClassRes = r.files.filter(f => local[f.path]).map(f => ({ path: f.path, category: labels[f.category] ? f.category : local[f.path].category, label: labels[f.category] || local[f.path].label, tags: Array.from(new Set((f.tags || []).map(t => String(t).toLowerCase().slice(0, 24)).concat(local[f.path].tags))).slice(0, 8), summary: f.summary || '' }));
        }
        this.fmxRefresh();
        return this._fmxClassRes;
    };

    // ---- semantic search (#628)
    P.fmxSemantic = function () {
        return card('بحث ذكي يفهم المعنى', `<div class="text-dim">اكتب ما تبحث عنه بكلماتك («أين يتم تسجيل الدخول؟»، «payment logic»). محلياً: مطابقة مرادفات وتقسيم المعرفات؛ وبالذكاء الاصطناعي: فهم كامل للسؤال.</div>
            <div class="gh-row"><input id="fmx-sem-q" class="form-input-box" dir="auto" placeholder="أين يتم التحقق من كلمة المرور؟" onkeydown="if(event.key==='Enter')app.fmxSemanticRun()">${pbtn('fa-magnifying-glass', 'بحث', 'app.fmxSemanticRun()')}<label class="gh-check"><input id="fmx-sem-ai" type="checkbox"> بالذكاء الاصطناعي</label></div><div id="fmx-sem-out"></div>`, 'fa-brain');
    };
    P.fmxSemanticRun = async function (qArg, useAI) {
        const q = qArg || val('fmx-sem-q'), ai = useAI != null ? useAI : val('fmx-sem-ai');
        if (!q) return [];
        const files = textFiles(this);
        let res = semanticSearch(files, q).map(r => ({ ...r, why: 'كلمات: ' + r.hits.slice(0, 6).join('، ') }));
        if (ai) {
            this.fmxBusy('fmx-sem-out', 'يبحث الذكاء الاصطناعي…');
            const digest = files.slice(0, 200).map(([p, c]) => `${p} :: ${(c.match(/(export|function|class|def|const)\s+[\w$]+/g) || []).slice(0, 12).join(', ')} :: ${c.slice(0, 160).replace(/\s+/g, ' ')}`).join('\n');
            const r = await this.aiJSON(`Question: "${q}"\nFind the files most relevant to this question (by meaning, not just keywords). Return {"results":[{"path":"…","why":"short Arabic reason"}]} best first, max 10.\n\n${digest}`, { kind: 'coding', maxTokens: 1500, source: 'fmx-search' });
            const set = new Set(files.map(f => f[0]));
            if (r && Array.isArray(r.results)) res = r.results.filter(x => set.has(x.path)).map((x, i) => ({ path: x.path, score: 10 - i, why: x.why || '' }));
        }
        const el = document.getElementById('fmx-sem-out');
        if (el) el.innerHTML = res.length ? res.map(r => `<div class="gh-item" data-hit="${esc(r.path)}" onclick="${call('fmxOpenPath', r.path)}"><i class="fa-solid fa-file-code text-blue"></i><div class="gh-item-main"><b dir="ltr">${esc(r.path)}</b><small>${esc(r.why)}</small></div><span class="text-dim">${r.score}</span></div>`).join('') : empty('لا نتائج');
        return res;
    };

    // ---- folder summary (#629)
    P.fmxSummary = function (opts = {}) {
        const dirs = Array.from(new Set(this.projectPaths().map(dirName).flatMap(d => d.split('/').map((_, i, a) => a.slice(0, i + 1).join('/'))).filter(Boolean))).sort();
        const dir = opts.dir != null ? opts.dir : (this._fmxSumDir || '');
        this._fmxSumDir = dir;
        const files = this.projectPaths().filter(p => !dir || p.startsWith(dir + '/'));
        const byKind = {}; let size = 0, todos = 0;
        files.forEach(p => { const e = this.virtualProjectFiles.get(p); byKind[kindOf(p)] = (byKind[kindOf(p)] || 0) + 1; size += e.size || (e.content || '').length; if (isTextEntry(e)) todos += (e.content.match(/TODO|FIXME/g) || []).length; });
        const exports = files.flatMap(p => { const e = this.virtualProjectFiles.get(p); return isTextEntry(e) ? Array.from(e.content.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const)\s+([A-Za-z_$][\w$]*)/g)).map(m => m[1]) : []; }).slice(0, 30);
        return card('تلخيص محتوى مجلد', `<div class="gh-row"><select class="form-input-box" onchange="app.fmxLoad('smart','summary',{dir:this.value})"><option value="">(جذر المشروع)</option>${dirs.map(d => `<option ${d === dir ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>${pbtn('fa-wand-magic-sparkles', 'تلخيص بالذكاء', call('fmxSummarizeAI', dir))}</div>
            <div class="fmx-kv"><span>الملفات</span><b>${files.length}</b><span>الأنواع</span><b>${Object.entries(byKind).map(([k, n]) => `${k}: ${n}`).join(' • ')}</b><span>الحجم</span><b>${(size / 1024).toFixed(1)} KB</b><span>TODO/FIXME</span><b>${todos}</b><span>الرموز المصدّرة</span><b dir="ltr">${esc(exports.join(', ') || '—')}</b></div><div id="fmx-sum-out"></div>`, 'fa-file-lines');
    };
    P.fmxSummarizeAI = async function (dir = '') {
        const files = textFiles(this, dir);
        this.fmxBusy('fmx-sum-out', 'يقرأ الذكاء الاصطناعي الملفات…');
        let budget = 30000;
        const ctx = files.map(([p, c]) => { const s = c.slice(0, Math.max(300, Math.min(4000, budget))); budget -= s.length; return budget > 0 ? `### ${p}\n${s}` : `### ${p}`; }).join('\n\n');
        const text = await this.aiRun(`لخّص محتوى المجلد "${dir || '/'}" بالعربية: الغرض العام، دور كل ملف في سطر، العلاقات بين الملفات، ونقاط تحتاج اهتماماً. استخدم Markdown.\n\n${ctx}`, { kind: 'general', maxTokens: 2500, source: 'fmx-summary' });
        const el = document.getElementById('fmx-sum-out');
        this._fmxSumText = text;
        if (el) el.innerHTML = text == null ? empty('يلزم مفتاح OpenRouter') : `<div class="gh-md">${this.renderMarkdownSafe ? this.renderMarkdownSafe(text) : esc(text)}</div><div class="gh-row">${btn('fa-file-circle-plus', 'حفظ كـ SUMMARY.md', call('fmxSaveSummary', dir))}${btn('fa-copy', 'نسخ', 'app.copyText(app._fmxSumText)')}</div>`;
        return text;
    };
    P.fmxSaveSummary = function (dir = '') { const p = (dir ? dir + '/' : '') + 'SUMMARY.md'; this.writeProjectFile(p, this._fmxSumText || '', 'summary'); this.showToast('📝 حُفظ ' + p, 'success'); return p; };

    // ---- missing files (#630)
    P.fmxMissing = function () {
        const read = (p) => { const e = this.virtualProjectFiles.get(p); return isTextEntry(e) ? e.content : ''; };
        this._fmxMissing = missingFiles(this.projectPaths(), read);
        return card('اقتراح ملفات ناقصة', `${this._fmxMissing.map((m, i) => `<div class="gh-item static" data-missing="${esc(m.path)}"><i class="fa-solid fa-file-circle-plus text-blue"></i><div class="gh-item-main"><b dir="ltr">${esc(m.path)}</b><small>${esc(m.why)}</small></div>${btn('fa-plus', 'إنشاء', call('fmxCreateMissing', i), 'gh-chip')}</div>`).join('') || empty('✅ لا ملفات أساسية ناقصة')}
            <div class="gh-row">${this._fmxMissing.length ? pbtn('fa-plus', 'إنشاء الكل', 'app.fmxCreateMissing(-1)') : ''}${btn('fa-wand-magic-sparkles', 'اقتراحات إضافية بالذكاء', 'app.fmxMissingAI()')}</div><div id="fmx-miss-ai"></div>`, 'fa-puzzle-piece');
    };
    P.fmxCreateMissing = function (i) {
        const list = i === -1 ? this._fmxMissing : [this._fmxMissing[i]];
        list.filter(Boolean).forEach(m => this.writeProjectFile(m.path, m.content || '', 'missing'));
        this.showToast(`➕ أُنشئ ${list.length} ملف`, 'success');
        return this.fmxRefresh();
    };
    P.fmxMissingAI = async function () {
        this.fmxBusy('fmx-miss-ai', '');
        const text = await this.aiRun(`This project has these files:\n${this.projectPaths().slice(0, 300).join('\n')}\n\nList files that are typically expected for this kind of project but missing (beyond README/LICENSE/.gitignore/CI). For each: path and one-line Arabic reason, as a Markdown list.`, { kind: 'coding', maxTokens: 1200, source: 'fmx-missing' });
        const el = document.getElementById('fmx-miss-ai');
        if (el) el.innerHTML = text == null ? empty('يلزم مفتاح OpenRouter') : `<div class="gh-md">${this.renderMarkdownSafe ? this.renderMarkdownSafe(text) : esc(text)}</div>`;
        return text;
    };
    // Tag suggestions in file properties
    P.fmxSuggestTags = function (path) {
        const e = this.virtualProjectFiles.get(path);
        const c = classifyFile(path, isTextEntry(e) ? e.content : '');
        const el = document.getElementById('fmx-tags');
        const tags = Array.from(new Set(((el && el.value) || '').split(',').map(s => s.trim()).filter(Boolean).concat(c.tags, ['cat:' + c.category])));
        if (el) el.value = tags.join(', ');
        return tags;
    };
}
