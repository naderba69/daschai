/* #1001 autonomous agent (idea → plan → code → verify/fix → GitHub Pages) • #124 auth system • #125 RBAC • #1002 voice coder */
import { parse as acornParse } from 'acorn';
import { esc, call, callRaw, btn, pbtn, card, empty, area, select, stats, toggle, pre } from './util.js';
import { authFiles, AUTH_DEFAULTS, RBAC_SAMPLE, RBAC_ACTIONS, resolvePolicy, makeCan, rbacMatrix, rbacFiles } from './gen.js';

const errText = (e) => (e == null ? '' : typeof e === 'string' ? e : e.message || JSON.stringify(e));
const capWriter = (sink = []) => ({ lines: sink, line(level, text) { sink.push({ level: level || 'log', text: String(text) }); }, html(cls, h) { sink.push({ level: cls, text: String(h).replace(/<[^>]+>/g, '') }); }, clear() { sink.length = 0; }, text() { return sink.map(l => l.text).join('\n'); } });
export const slugify = (s) => String(s || 'app').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'ox-app';

// ====================================================================== #1001 static verification
/** Check a generated project: JS/JSON syntax, local HTML references, imports. → [{path, line, message}] */
export function verifyProject(files) {
    const map = new Map(files), issues = [];
    const has = (p) => map.has(p);
    const norm = (base, rel) => { const parts = base ? base.split('/') : []; rel.split('/').forEach(s => { if (s === '..') parts.pop(); else if (s && s !== '.') parts.push(s); }); return parts.join('/'); };
    const dir = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
    for (const [p, t] of files) {
        if (/\.(m?js|cjs|jsx)$/.test(p) && !/\.jsx$/.test(p)) {
            try { acornParse(t, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true }); }
            catch (e) { try { acornParse(t, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: true }); } catch (e2) { issues.push({ path: p, line: (e.loc && e.loc.line) || 0, message: 'SyntaxError: ' + e.message.replace(/\s*\(\d+:\d+\)$/, '') }); } }
            const re = /(?:import\s[^'"]*?from\s*|import\s*\(|require\()\s*['"](\.{1,2}\/[^'"]+)['"]/g;
            let m;
            while ((m = re.exec(t))) { const target = norm(dir(p), m[1]); if (!['', '.js', '.mjs', '.json', '/index.js'].some(x => has(target + x))) issues.push({ path: p, line: t.slice(0, m.index).split('\n').length, message: 'import غير موجود: ' + m[1] }); }
        }
        if (/\.json$/.test(p)) { try { JSON.parse(t); } catch (e) { issues.push({ path: p, line: 0, message: 'JSON غير صالح: ' + e.message }); } }
        if (/\.html?$/.test(p)) {
            const re = /<(?:script|img|link|source)\b[^>]*?\s(?:src|href)=["']([^"'#?]+)/gi;
            let m;
            while ((m = re.exec(t))) { const u = m[1]; if (/^(https?:|\/\/|data:|mailto:|blob:)/i.test(u)) continue; const target = u.startsWith('/') ? u.slice(1) : norm(dir(p), u); if (!has(target)) issues.push({ path: p, line: t.slice(0, m.index).split('\n').length, message: 'ملف مشار إليه غير موجود: ' + u }); }
        }
    }
    return issues;
}
export function parsePlan(j) {
    if (!j || typeof j !== 'object') throw new Error('خطة غير صالحة');
    const files = (j.files || []).map(f => (typeof f === 'string' ? { path: f, purpose: '' } : f)).filter(f => f && f.path && !/\.\.|^\//.test(f.path)).slice(0, 30);
    if (!files.length) throw new Error('الخطة لا تحتوي ملفات');
    return { name: slugify(j.name || j.title), title: String(j.title || j.name || 'تطبيق'), summary: String(j.summary || ''), stack: String(j.stack || 'static'), files };
}

// ====================================================================== #1002 voice commands (local grammar, Arabic + English)
const AR_NUM = { 'واحد': 1, 'اثنين': 2, 'اثنان': 2, 'ثلاثة': 3, 'أربعة': 4, 'اربعة': 4, 'خمسة': 5, 'ستة': 6, 'سبعة': 7, 'ثمانية': 8, 'تسعة': 9, 'عشرة': 10, 'عشرين': 20 };
const num = (s) => { const t = String(s || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)); return /^\d+$/.test(t) ? +t : (AR_NUM[t] || NaN); };
export function parseVoiceCommand(text) {
    const t = String(text || '').trim().replace(/[.!؟?،,]+$/g, '').trim();
    let m;
    if (/^(توقف|أوقف|اوقف|stop( listening)?|انتهى)$/i.test(t)) return { cmd: 'stop' };
    if (/^(احفظ|حفظ|save)( الملف| file)?$/i.test(t)) return { cmd: 'save' };
    if (/^(شغل|شغّل|تشغيل|run)( الكود| الملف| code| file)?$/i.test(t)) return { cmd: 'run' };
    if (/^(تراجع|undo)$/i.test(t)) return { cmd: 'undo' };
    if (/^(أعد|اعد|إعادة|redo)$/i.test(t)) return { cmd: 'redo' };
    if (/^(نسق|نسّق|تنسيق|format)( الكود| code)?$/i.test(t)) return { cmd: 'format' };
    if ((m = /^(?:اذهب|انتقل|روح)\s+(?:إلى|الى|ل)\s*السطر\s+(\S+)$|^go\s*to\s+line\s+(\S+)$/i.exec(t))) return { cmd: 'goto', line: num(m[1] || m[2]) };
    if ((m = /^(?:احذف|امسح)\s+السطر\s+(\S+)$|^delete\s+line\s+(\S+)$/i.exec(t))) return { cmd: 'deleteLine', line: num(m[1] || m[2]) };
    if ((m = /^(?:حدد|اختر)\s+(?:الأسطر|الاسطر|السطور|من السطر)\s+(\S+)\s+(?:إلى|الى|حتى)\s+(\S+)$|^select\s+lines?\s+(\S+)\s+to\s+(\S+)$/i.exec(t))) return { cmd: 'select', from: num(m[1] || m[3]), to: num(m[2] || m[4]) };
    if ((m = /^(?:افتح|افتحي)\s+(?:الملف|ملف)\s+(.+)$|^open\s+(?:file\s+)?(.+)$/i.exec(t))) return { cmd: 'open', name: (m[1] || m[2]).trim() };
    if ((m = /^(?:أنشئ|انشئ|اعمل)\s+ملف(?:ا|اً)?\s+(?:جديد(?:ا|اً)?\s+)?(?:باسم\s+)?(.+)$|^(?:new|create)\s+file\s+(.+)$/i.exec(t))) return { cmd: 'newFile', name: (m[1] || m[2]).trim().replace(/\s+نقطة\s+/g, '.').replace(/\s+dot\s+/gi, '.').replace(/\s+/g, '') };
    return { cmd: 'ai', text: t };
}
/** Apply an AI edit {op, code, line?} to text with a selection [from, to]. */
export function applyVoiceEdit(text, sel, edit) {
    const src = String(text || ''), c = String((edit && edit.code) || '');
    const from = Math.max(0, Math.min(sel ? sel.from : src.length, src.length)), to = Math.max(from, Math.min(sel ? sel.to : src.length, src.length));
    if (!edit || !edit.op) return { text: src, cursor: from };
    if (edit.op === 'replace_file') return { text: c, cursor: c.length };
    if (edit.op === 'replace_selection') return { text: src.slice(0, from) + c + src.slice(to), cursor: from + c.length };
    if (edit.op === 'insert_at_line' && edit.line) { const lines = src.split('\n'); const i = Math.max(0, Math.min(lines.length, edit.line - 1)); lines.splice(i, 0, c); const t = lines.join('\n'); return { text: t, cursor: lines.slice(0, i + 1).join('\n').length }; }
    const ins = (from > 0 && src[from - 1] !== '\n' && /\n/.test(c) ? '\n' : '') + c;
    return { text: src.slice(0, from) + ins + src.slice(from), cursor: from + ins.length };
}

export function installMaker(P) {
    // ---------------------------------------------------------------- shared editor helpers
    P.ixEditorState = function () {
        const path = this.activeStudioFile;
        const f = path && this.virtualProjectFiles.get(path);
        if (!f || typeof f.content !== 'string') return null;
        const ctl = this.codeEditor;
        if (ctl && ctl.view && typeof ctl.getPath === 'function' && ctl.getPath() === path) { const s = ctl.view.state.selection.main; return { path, text: ctl.view.state.doc.toString(), from: s.from, to: s.to, ctl }; }
        return { path, text: f.content, from: f.content.length, to: f.content.length, ctl: null };
    };
    P.ixEditorApply = function (st, text, cursor) {
        this.writeProjectFile(st.path, text, 'voice');
        if (st.ctl) {
            try { st.ctl.view.dispatch({ changes: { from: 0, to: st.ctl.view.state.doc.length, insert: text }, selection: { anchor: Math.min(cursor, text.length) } }); } catch (e) { /* editor detached */ }
        }
        if (this.scheduleProjectSave) this.scheduleProjectSave();
    };

    // ---------------------------------------------------------------- #1001 autonomous agent
    P.ixAgentLog = function (step, msg, state = 'run') {
        const a = this._ixAgent;
        if (!a) return;
        const last = a.log[a.log.length - 1];
        if (last && last.step === step && last.state === 'run') { last.msg = msg; last.state = state; } else a.log.push({ step, msg, state, at: Date.now() });
        this.ixAgentPaint();
    };
    P.ixAgentPaint = function () {
        const a = this._ixAgent, el = document.getElementById('ix-ag-log');
        if (!a || !el) return;
        const icon = { run: '<span class="live-step-spinner"></span>', ok: '✅', bad: '❌', warn: '⚠️' };
        el.innerHTML = a.log.map(l => `<div class="fmx-item ix-step ix-${l.state}"><div><b>${icon[l.state] || ''} ${esc(l.step)}</b><small>${esc(l.msg)}</small></div></div>`).join('')
            + (a.result ? `<div class="fmx-card">${stats([['ملفات', a.result.files.length], ['جولات إصلاح', a.result.fixRounds], ['مشكلات متبقية', a.result.issues.length]])}${a.result.url ? `<p>🌍 <a href="${esc(a.result.url)}" target="_blank" rel="noopener" dir="ltr">${esc(a.result.url)}</a></p>` : ''}${a.result.repo ? `<p>📦 <a href="https://github.com/${esc(a.result.repo)}" target="_blank" rel="noopener" dir="ltr">github.com/${esc(a.result.repo)}</a></p>` : ''}</div>` : '');
    };
    P.ixAgentBuild = async function (idea, opts = {}) {
        idea = String(idea || (document.getElementById('ix-ag-idea') || {}).value || '').trim();
        if (idea.length < 8) { this.showToast('صف فكرة المشروع بجملة أو أكثر', 'warning'); return null; }
        const stack = opts.stack || (document.getElementById('ix-ag-stack') || {}).value || 'static';
        const deploy = opts.deploy != null ? opts.deploy : !!(document.getElementById('ix-ag-deploy') || {}).checked;
        const maxFix = opts.maxFix != null ? opts.maxFix : 3;
        this._ixAgent = { idea, stack, log: [], stop: false };
        const a = this._ixAgent;
        const STACKS = { static: 'a static website (index.html + CSS + vanilla JS modules), no build step, works on GitHub Pages', react: 'a React 18 single-page app loaded from esm.sh CDN with import maps (no build step), works on GitHub Pages', node: 'a Node.js + Express REST API with an in-memory store, plus tests written with describe/test/expect' };
        try {
            // 1. plan
            this.ixAgentLog('التخطيط', 'تحليل الفكرة وتقسيمها إلى ملفات…');
            const planJ = await this.ixAI(`You are an autonomous software agent. Plan a complete, working project for this idea:\n"${idea}"\nTarget: ${STACKS[stack] || STACKS.static}.\nReturn JSON: {"name": "kebab-case-name", "title": "...", "summary": "one line (Arabic)", "stack": "${stack}", "files": [{"path": "index.html", "purpose": "..."}]}. 3-12 files. Include README.md${stack === 'node' ? ' and at least one *.test.js' : ''}.`, { json: true, maxTokens: 1500, quiet: true });
            const plan = parsePlan(planJ);
            a.plan = plan;
            this.ixAgentLog('التخطيط', `${plan.title} — ${plan.files.length} ملفات: ${plan.files.map(f => f.path).join('، ')}`, 'ok');
            if (a.stop) throw new Error('أُوقف');
            // 2. generate (batches of 4 files)
            const out = {};
            for (let i = 0; i < plan.files.length; i += 4) {
                const batch = plan.files.slice(i, i + 4);
                this.ixAgentLog('كتابة الكود', `${Math.min(i + 4, plan.files.length)}/${plan.files.length}: ${batch.map(f => f.path).join('، ')}`);
                const j = await this.ixAI(`Project "${plan.title}": ${plan.summary}\nStack: ${STACKS[stack] || STACKS.static}\nAll files: ${plan.files.map(f => f.path + ' — ' + f.purpose).join('; ')}\nAlready written: ${Object.keys(out).join(', ') || 'none'}\nWrite these files completely (no placeholders, no TODOs): ${batch.map(f => f.path).join(', ')}.\nReturn JSON: {"files": {"path": "full content"}}`, { json: true, maxTokens: 6000, quiet: true });
                const got = (j && j.files) || {};
                batch.forEach(f => { if (typeof got[f.path] === 'string') out[f.path] = got[f.path]; });
                if (a.stop) throw new Error('أُوقف');
            }
            if (!Object.keys(out).length) throw new Error('لم يُنتج النموذج أي ملفات');
            const root = plan.name;
            const write = (files) => this.ixWriteFiles('الوكيل', Object.fromEntries(Object.entries(files).map(([p, c]) => [root + '/' + p, c])), { open: false });
            write(out);
            this.ixAgentLog('كتابة الكود', `${Object.keys(out).length} ملفات في ${root}/`, 'ok');
            // 3. verify + fix loop
            let issues = [], fixRounds = 0;
            const check = async () => {
                const files = Object.entries(out);
                const list = verifyProject(files);
                const tests = files.map(([p]) => p).filter(p => /\.(test|spec)\.[cm]?js$/.test(p));
                if (tests.length && this.ensureRunner && (await this.ensureRunner({ quiet: true })) && this.runJS) {
                    const runFiles = new Map(files);
                    try {
                        const res = await this.runJS({ mode: 'test', tests, entry: tests[0], path: tests[0], files: runFiles, writer: capWriter(), detached: true, timeoutMs: 30000 });
                        const fails = ((res.tests && res.tests.results) || []).filter(r => r.status === 'fail');
                        fails.forEach(f => list.push({ path: f.file || tests[0], line: 0, message: `اختبار فاشل «${f.name}»: ${errText(f.error).slice(0, 300)}` }));
                        if (!res.success && !fails.length && res.error) list.push({ path: tests[0], line: 0, message: String(res.error).slice(0, 300) });
                        a.tests = (res.tests && res.tests.summary) || null;
                    } catch (e) { list.push({ path: tests[0], line: 0, message: e.message }); }
                }
                return list;
            };
            this.ixAgentLog('التحقق', 'فحص البنية والمراجع والاختبارات…');
            issues = await check();
            while (issues.length && fixRounds < maxFix && !a.stop) {
                fixRounds++;
                this.ixAgentLog('التحقق', `${issues.length} مشكلة — جولة إصلاح ${fixRounds}/${maxFix}`, 'warn');
                const paths = [...new Set(issues.map(i => i.path))].filter(p => out[p] != null || !/\//.test(p)).slice(0, 5);
                this.ixAgentLog('الإصلاح', paths.join('، '));
                const j = await this.ixAI(`Fix these problems in project "${plan.title}":\n${issues.slice(0, 20).map(i => `- ${i.path}${i.line ? ':' + i.line : ''}: ${i.message}`).join('\n')}\n\nCurrent files:\n${paths.filter(p => out[p] != null).map(p => `--- ${p}\n${out[p].slice(0, 6000)}`).join('\n')}\nAll files: ${Object.keys(out).join(', ')}\nReturn JSON {"files": {"path": "full fixed content"}} (you may add missing files).`, { json: true, maxTokens: 6000, quiet: true });
                const fixed = (j && j.files) || {};
                Object.entries(fixed).forEach(([p, c]) => { if (typeof c === 'string' && !/\.\.|^\//.test(p)) out[p] = c; });
                write(fixed);
                this.ixAgentLog('الإصلاح', `عُدّل ${Object.keys(fixed).length} ملف`, 'ok');
                this.ixAgentLog('التحقق', 'إعادة الفحص…');
                issues = await check();
            }
            this.ixAgentLog('التحقق', issues.length ? `بقيت ${issues.length} مشكلة: ${issues.slice(0, 3).map(i => i.message).join(' | ')}` : `✓ لا مشكلات${a.tests ? ` — الاختبارات ${a.tests.pass}/${a.tests.total}` : ''}`, issues.length ? 'warn' : 'ok');
            a.result = { files: Object.keys(out), root, fixRounds, issues };
            // 4. deploy
            if (deploy) {
                if (!String(this.settings.githubToken || '').trim()) this.ixAgentLog('النشر', 'يلزم رمز GitHub للنشر — تم التخطي', 'warn');
                else {
                    this.ixAgentLog('النشر', 'إنشاء مستودع ورفع الملفات…');
                    const repoName = root + '-' + Date.now().toString(36).slice(-4);
                    const repo = await this.gh('/user/repos', { method: 'POST', body: { name: repoName, description: plan.summary.slice(0, 300), auto_init: false, private: false } });
                    const full = repo.full_name || `${this.settings.githubOwner}/${repoName}`;
                    const b64 = (s) => { const bytes = new TextEncoder().encode(s); let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); }); return btoa(bin); };
                    for (const [p, c] of Object.entries(out)) await this.gh(`/repos/${full}/contents/${p.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', body: { message: 'feat: ' + p + ' (OX-Alpha agent)', content: b64(c) } });
                    a.result.repo = full;
                    if (stack !== 'node') {
                        this.ixAgentLog('النشر', 'تفعيل GitHub Pages…');
                        const pages = await this.gh(`/repos/${full}/pages`, { method: 'POST', body: { source: { branch: repo.default_branch || 'main', path: '/' } } }).catch(e => ({ error: e.message }));
                        a.result.url = (pages && pages.html_url) || `https://${full.split('/')[0].toLowerCase()}.github.io/${full.split('/')[1]}/`;
                    }
                    this.ixAgentLog('النشر', a.result.url ? 'منشور (قد يستغرق دقيقة ليظهر): ' + a.result.url : 'رُفع إلى ' + full, 'ok');
                }
            }
            this.ixAgentPaint();
            this.showToast('🤖 أنهى الوكيل المشروع: ' + this.escapeHTML(plan.title), 'success');
            return a.result;
        } catch (e) {
            this.ixAgentLog(a.log.length ? a.log[a.log.length - 1].step : 'الوكيل', e.message || String(e), 'bad');
            return null;
        }
    };
    P.ixAgent = async function () {
        this._ixMount = () => this.ixAgentPaint();
        return card('الوكيل المستقل: من الفكرة حتى النشر', `<p class="hv-dim">صف فكرتك فقط. الوكيل يخطط للملفات، ويكتب الكود، ثم يفحصه (الصياغة، والاستيرادات، والمراجع في HTML، والاختبارات في بيئة التشغيل)، ويصلح الأخطاء تلقائياً حتى 3 جولات، ثم ينشئ مستودعاً على GitHub ويفعّل GitHub Pages ويعطيك الرابط.</p>
            ${area('ix-ag-idea', 'الفكرة', (this._ixAgent && this._ixAgent.idea) || '', 3, 'placeholder="مثال: تطبيق قائمة مهام عربي مع فلترة وحفظ محلي ووضع ليلي"')}
            <div class="gh-row">${select('ix-ag-stack', 'النوع', [['static', 'موقع ثابت (HTML/CSS/JS)'], ['react', 'React بدون بناء'], ['node', 'Node + Express API']], (this._ixAgent && this._ixAgent.stack) || 'static')}${toggle('ix-ag-deploy', 'انشر على GitHub Pages', !!String(this.settings.githubToken || '').trim())}</div>
            <div class="gh-row">${pbtn('fa-robot', 'ابدأ البناء', 'app.ixAgentBuild()')}${btn('fa-stop', 'إيقاف', 'app._ixAgent&&(app._ixAgent.stop=true)')}</div>
            <div id="ix-ag-log"></div>`, 'fa-robot');
    };

    // ---------------------------------------------------------------- #124 auth generator
    P.ixAuthOpts = function () {
        const o = { ...AUTH_DEFAULTS };
        const v = (id) => document.getElementById(id);
        if (v('ix-au-storage')) o.storage = v('ix-au-storage').value;
        ['refresh', 'verify', 'reset', 'rateLimit', 'roles', 'frontend'].forEach(k => { const el = v('ix-au-' + k); if (el) o[k] = el.checked; });
        return o;
    };
    P.ixAuthGenerate = function (opts) {
        const o = opts || this.ixAuthOpts();
        const files = authFiles(o);
        const exists = Object.keys(files).filter(p => this.virtualProjectFiles.has(p));
        this._ixAuthLast = { opts: o, files: Object.keys(files), overwritten: exists };
        this.ixWriteFiles('نظام المصادقة', files, { open: false });
        this.ixOut('ix-au-res', `${empty(`✅ أُنشئ ${Object.keys(files).length} ملف${exists.length ? ` (استُبدل ${exists.length})` : ''} — شغّل <code>tests/auth.test.js</code> للتحقق`)}${pre(Object.keys(files).join('\n'))}<div class="gh-row">${pbtn('fa-vial', 'تشغيل الاختبارات الآن', 'app.ixRunTests(["tests/auth.test.js"], "ix-au-res")')}</div>`);
        return files;
    };
    P.ixRunTests = async function (tests, outId) {
        if (!(await this.ensureRunner({ quiet: true }))) return null;
        const w = capWriter();
        const res = await this.runJS({ mode: 'test', tests, entry: tests[0], path: tests[0], writer: w, detached: true, timeoutMs: 60000 });
        const s = (res.tests && res.tests.summary) || { pass: 0, fail: 0, total: 0 };
        if (s.pass && !s.fail && this.ixAward) try { this.ixAward('test'); } catch (e) { /* ignore */ }
        if (outId) this.ixOut(outId, stats([['نجح', s.pass], ['فشل', s.fail], ['الإجمالي', s.total]]) + (((res.tests && res.tests.results) || []).filter(r => r.status === 'fail').map(r => empty('✗ ' + esc(r.name) + ' — ' + esc(errText(r.error).slice(0, 300)), true)).join('')) + (res.error && !s.fail ? empty('⚠ ' + esc(res.error), true) : ''));
        return { summary: s, results: (res.tests && res.tests.results) || [], error: res.success ? null : res.error, lines: w.lines };
    };
    P.ixAuthGen = async function () {
        const o = AUTH_DEFAULTS;
        return card('توليد نظام مصادقة كامل', `<p class="hv-dim">Express + JWT + bcrypt: تسجيل ودخول، و refresh tokens دوّارة (إعادة استخدام الرمز تُلغي عائلته كلها)، وتأكيد البريد، واستعادة كلمة المرور، ومحدد معدل، وأدوار (أول مستخدم admin)، وصفحة دخول عربية، واختبارات تكامل. يعمل فوراً داخل OX-Alpha لأن express و jsonwebtoken و bcryptjs لها بدائل محلية، ويعمل كما هو في Node الحقيقي.</p>
            <div class="gh-row">${select('ix-au-storage', 'التخزين', [['memory', 'في الذاكرة (للتجربة والاختبار)'], ['json', 'ملف JSON'], ['prisma', 'Prisma + SQLite']], o.storage)}</div>
            <div class="dvx-flags">${[['refresh', 'Refresh tokens'], ['verify', 'تأكيد البريد'], ['reset', 'استعادة كلمة المرور'], ['rateLimit', 'محدد المعدل'], ['roles', 'الأدوار'], ['frontend', 'صفحة الدخول']].map(([k, l]) => toggle('ix-au-' + k, l, o[k])).join('')}</div>
            <div class="gh-row">${pbtn('fa-shield-halved', 'توليد الملفات', 'app.ixAuthGenerate()')}</div>
            <div id="ix-au-res"></div>`, 'fa-user-lock');
    };

    // ---------------------------------------------------------------- #125 RBAC
    P.ixRbacPolicy = function () { return this._ixRbac || (this._ixRbac = JSON.parse(JSON.stringify(this.ixCfg('rbac').policy || RBAC_SAMPLE))); };
    P.ixRbacSet = function (role, res, action, value) {
        const p = this.ixRbacPolicy();
        const g = (p.grants[role] = p.grants[role] || {});
        const list = (g[res] || []).filter(a => a !== action && a !== action + ':own');
        if (value === 'yes') list.push(action); else if (value === 'own') list.push(action + ':own');
        g[res] = list;
        this.ixSave('rbac', { policy: p });
        return p;
    };
    P.ixRbacCycle = function (role, res, action) {
        const own = (this.ixRbacPolicy().grants[role] || {})[res] || [];
        const cur = own.includes(action) ? 'yes' : own.includes(action + ':own') ? 'own' : 'no';
        this.ixRbacSet(role, res, action, { no: 'yes', yes: 'own', own: 'no' }[cur]);
        this.ixRbacPaint();
    };
    P.ixRbacAddRole = async function (name, inherits) {
        name = String(name || await this.askText('اسم الدور الجديد', '') || '').trim().toLowerCase();
        if (!/^[a-z][\w-]{1,30}$/.test(name)) { if (name) this.showToast('اسم دور غير صالح (حروف لاتينية)', 'warning'); return null; }
        const p = this.ixRbacPolicy();
        p.roles[name] = { inherits: inherits || [] };
        try { resolvePolicy(p); } catch (e) { delete p.roles[name]; this.showToast(e.message, 'error'); return null; }
        this.ixSave('rbac', { policy: p });
        this.ixRbacPaint();
        return name;
    };
    P.ixRbacAddResource = async function (name) {
        name = String(name || await this.askText('اسم المورد', '') || '').trim().toLowerCase();
        if (!/^[a-z][\w-]{1,30}$/.test(name)) return null;
        const p = this.ixRbacPolicy();
        if (!p.resources.includes(name)) p.resources.push(name);
        this.ixSave('rbac', { policy: p });
        this.ixRbacPaint();
        return name;
    };
    P.ixRbacInherit = function (role, value) {
        const p = this.ixRbacPolicy();
        const prev = p.roles[role].inherits;
        p.roles[role].inherits = String(value || '').split(/[,،\s]+/).filter(Boolean);
        try { resolvePolicy(p); } catch (e) { p.roles[role].inherits = prev; this.showToast(e.message, 'error'); this.ixRbacPaint(); return false; }
        this.ixSave('rbac', { policy: p });
        this.ixRbacPaint();
        return true;
    };
    P.ixRbacCheck = function () {
        const v = (id) => (document.getElementById(id) || {}).value;
        const ok = makeCan(this.ixRbacPolicy())(v('ix-rb-role'), v('ix-rb-act'), v('ix-rb-res'), { userId: 1, ownerId: v('ix-rb-own') === 'mine' ? 1 : 2 });
        this.ixOut('ix-rb-sim', `<div class="gh-empty ${ok ? '' : 'bad'}">${ok ? '✅ مسموح' : '⛔ ممنوع'}</div>`);
        return ok;
    };
    P.ixRbacPaint = function () {
        const el = document.getElementById('ix-rb-matrix');
        if (!el) return;
        const p = this.ixRbacPolicy();
        let rows;
        try { rows = rbacMatrix(p); } catch (e) { el.innerHTML = empty('❌ ' + esc(e.message), true); return; }
        const sym = { yes: '✅', own: '👤', no: '·' };
        el.innerHTML = `<div class="ix-scroll"><table class="gh-table ix-rbac"><thead><tr><th>الدور</th><th>يرث</th>${p.resources.map(r => `<th colspan="4" dir="ltr">${esc(r)}</th>`).join('')}</tr><tr><th></th><th></th>${p.resources.map(() => RBAC_ACTIONS.map(a => `<th title="${a}">${a[0].toUpperCase()}</th>`).join('')).join('')}</tr></thead><tbody>
            ${rows.map(r => `<tr><td><b dir="ltr">${esc(r.role)}</b></td><td><input class="form-input-box ix-inh" dir="ltr" value="${esc(p.roles[r.role].inherits.join(', '))}" onchange="${callRaw('ixRbacInherit', [r.role], 'this.value')}"></td>${r.cells.map((acts, ri) => acts.map((v, ai) => `<td><button class="ix-cell ix-${v}" onclick="${call('ixRbacCycle', r.role, p.resources[ri], RBAC_ACTIONS[ai])}" title="${RBAC_ACTIONS[ai]} ${esc(p.resources[ri])}">${sym[v]}</button></td>`).join('')).join('')}</tr>`).join('')}</tbody></table></div>
            <small class="hv-dim">✅ مسموح • 👤 لسجلاته فقط (own) • · ممنوع — اضغط الخلية للتبديل. الصلاحيات الموروثة تظهر في الأدوار الأعلى.</small>`;
    };
    P.ixRbacGenerate = function () {
        const files = rbacFiles(this.ixRbacPolicy());
        this.ixWriteFiles('RBAC', files, { open: false });
        this.ixOut('ix-rb-res', `${pre(Object.keys(files).join('\n'))}<div class="gh-row">${pbtn('fa-vial', 'تشغيل اختبارات الصلاحيات', 'app.ixRunTests(["rbac/rbac.test.js"], "ix-rb-res")')}</div>`);
        return files;
    };
    P.ixRbac = async function () {
        const p = this.ixRbacPolicy();
        this._ixMount = () => this.ixRbacPaint();
        return card('نظام الأدوار والصلاحيات (RBAC)', `<p class="hv-dim">مصفوفة أدوار × موارد × عمليات مع الوراثة (editor يرث user…) وصلاحيات «own» لسجلات المستخدم نفسه. يولّد <code>rbac.js</code> (الدالة <code>can()</code> ووسيط Express <code>authorize()</code>)، و<code>policy.json</code>، واختبارات تغطي كل خلية، ومساعداً للواجهة يخفي الأزرار غير المسموحة.</p>
            <div class="gh-row">${btn('fa-user-plus', 'دور', 'app.ixRbacAddRole()')}${btn('fa-cube', 'مورد', 'app.ixRbacAddResource()')}${btn('fa-rotate-left', 'المثال', "app._ixRbac=null;app.ixSave('rbac',{policy:null});app.ixRefresh()")}</div>
            <div id="ix-rb-matrix"></div>`, 'fa-user-shield')
            + card('محاكي الصلاحيات', `<div class="gh-row">${select('ix-rb-role', 'الدور', Object.keys(p.roles), 'user')}${select('ix-rb-act', 'العملية', RBAC_ACTIONS, 'update')}${select('ix-rb-res', 'المورد', p.resources, p.resources[0])}${select('ix-rb-own', 'السجل', [['mine', 'سجلّي'], ['other', 'سجل غيري']], 'mine')}${pbtn('fa-scale-balanced', 'تحقق', 'app.ixRbacCheck()')}</div><div id="ix-rb-sim"></div>`, 'fa-scale-balanced')
            + card('التوليد', `<div class="gh-row">${pbtn('fa-file-code', 'توليد ملفات RBAC', 'app.ixRbacGenerate()')}</div><div id="ix-rb-res"></div>`, 'fa-file-code');
    };

    // ---------------------------------------------------------------- #1002 voice coder
    P.ixVoiceHandle = async function (text) {
        const c = parseVoiceCommand(text);
        const log = (m, ok = true) => { this._ixVoiceLog = [{ text, msg: m, ok, at: Date.now() }, ...(this._ixVoiceLog || [])].slice(0, 30); this.ixVoicePaint(); };
        const st = this.ixEditorState();
        const lineRange = (t, n) => { const lines = t.split('\n'); const i = Math.max(1, Math.min(n, lines.length)); const from = lines.slice(0, i - 1).join('\n').length + (i > 1 ? 1 : 0); return { from, to: from + lines[i - 1].length, i }; };
        try {
            switch (c.cmd) {
                case 'stop': this.ixVoiceStop(); log('⏹ توقف الاستماع'); return c;
                case 'save': if (this.saveProjectNow) await this.saveProjectNow(); log('💾 حُفظ'); return c;
                case 'run': if (this.runStudioCode) this.runStudioCode(); log('▶ تشغيل'); return c;
                case 'undo': case 'redo': if (st && st.ctl && st.ctl.runCommand) st.ctl.runCommand(c.cmd); log(c.cmd === 'undo' ? '↩ تراجع' : '↪ إعادة'); return c;
                case 'format': if (this.formatStudioCode) { try { await this.formatStudioCode({ quiet: true }); } catch (e) { /* not available */ } } log('✨ تنسيق'); return c;
                case 'goto': if (!st || !(c.line > 0)) throw new Error('لا يوجد ملف مفتوح أو رقم سطر'); if (this.openFileAt && this.isCodeStudioOpen) this.openFileAt(st.path, c.line, 1); this._ixVoiceCursor = lineRange(st.text, c.line); log('↪ السطر ' + c.line); return c;
                case 'select': if (!st) throw new Error('لا يوجد ملف مفتوح'); { const a = lineRange(st.text, c.from), b = lineRange(st.text, c.to); this._ixVoiceCursor = { from: a.from, to: b.to }; if (st.ctl) st.ctl.view.dispatch({ selection: { anchor: a.from, head: b.to } }); } log(`▭ تحديد ${c.from}–${c.to}`); return c;
                case 'deleteLine': { if (!st || !(c.line > 0)) throw new Error('لا يوجد ملف مفتوح'); const lines = st.text.split('\n'); lines.splice(c.line - 1, 1); this.ixEditorApply(st, lines.join('\n'), lineRange(st.text, c.line).from); log('🗑 حُذف السطر ' + c.line); return c; }
                case 'open': { const want = c.name.toLowerCase().replace(/\s+نقطة\s+/g, '.').replace(/\s+/g, ''); const hit = [...this.virtualProjectFiles.keys()].find(p => p.toLowerCase() === want) || [...this.virtualProjectFiles.keys()].find(p => p.toLowerCase().split('/').pop().replace(/\.[^.]+$/, '') === want.replace(/\.[^.]+$/, '')) || [...this.virtualProjectFiles.keys()].find(p => p.toLowerCase().includes(want)); if (!hit) throw new Error('لم أجد ملفاً باسم ' + c.name); this.activeStudioFile = hit; if (this.isCodeStudioOpen && this.switchStudioFile) this.switchStudioFile(hit); log('📂 ' + hit); return { ...c, path: hit }; }
                case 'newFile': { const p = c.name.replace(/^\/+/, ''); this.createProjectFile(p, '', { open: !!this.isCodeStudioOpen }); this.activeStudioFile = p; log('📄 ' + p); return { ...c, path: p }; }
                default: {
                    if (!st) throw new Error('افتح ملفاً أولاً (أو قل: أنشئ ملف app.js)');
                    const sel = this._ixVoiceCursor || { from: st.from, to: st.to };
                    const lines = st.text.split('\n'), curLine = st.text.slice(0, sel.from).split('\n').length;
                    const j = await this.ixAI(`You are a voice-driven code editor. The user SPOKE this instruction (may be Arabic): "${c.text}"\nFile: ${st.path}\nCursor at line ${curLine}${sel.to > sel.from ? `, selected text:\n${st.text.slice(sel.from, sel.to)}` : ''}\n--- file (numbered) ---\n${lines.map((l, i) => (i + 1) + ': ' + l).join('\n').slice(0, 12000)}\n---\nReturn JSON {"op": "insert"|"replace_selection"|"insert_at_line"|"replace_file", "line": optional number, "code": "...", "say": "short Arabic confirmation"}. Prefer insert at the cursor; use replace_file only for whole-file rewrites.`, { json: true, maxTokens: 3000, quiet: true });
                    if (!j || !j.op) throw new Error('لم أفهم التعليمة');
                    const r = applyVoiceEdit(st.text, sel, j);
                    this.ixEditorApply(st, r.text, r.cursor);
                    this._ixVoiceCursor = { from: r.cursor, to: r.cursor };
                    log('✍ ' + (j.say || j.op));
                    if (this.ixCfg('voice').speak !== false && typeof speechSynthesis !== 'undefined' && j.say && typeof SpeechSynthesisUtterance !== 'undefined') { try { const u = new SpeechSynthesisUtterance(j.say); u.lang = /[\u0600-\u06FF]/.test(j.say) ? 'ar' : 'en'; speechSynthesis.speak(u); } catch (e) { /* no TTS */ } }
                    return { ...c, edit: j };
                }
            }
        } catch (e) { log('❌ ' + e.message, false); return { ...c, error: e.message }; }
    };
    P.ixVoiceCoder = function (on = true) {
        if (!on) return this.ixVoiceStop();
        const SR = (typeof window !== 'undefined') && (window.SpeechRecognition || window.webkitSpeechRecognition);
        if (!SR) { this.showToast('التعرف على الكلام غير مدعوم في هذا المتصفح (جرّب Chrome أو Edge)', 'warning'); return false; }
        if (this._ixRec) return true;
        const rec = new SR();
        rec.lang = this.ixCfg('voice').lang || 'ar-SA';
        rec.continuous = true; rec.interimResults = false;
        rec.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) this.ixVoiceHandle(e.results[i][0].transcript); };
        rec.onend = () => { if (this._ixRec === rec) { try { rec.start(); } catch (e) { this._ixRec = null; this.ixVoicePaint(); } } };
        rec.onerror = (e) => { if (e.error === 'not-allowed') { this._ixRec = null; this.showToast('لا يوجد إذن للميكروفون', 'error'); this.ixVoicePaint(); } };
        this._ixRec = rec;
        try { rec.start(); } catch (e) { /* already started */ }
        this.showToast('🎙 المبرمج الصوتي يستمع — قل «توقف» للإنهاء', 'info');
        this.ixVoicePaint();
        return true;
    };
    P.ixVoiceStop = function () { const r = this._ixRec; this._ixRec = null; if (r) try { r.stop(); } catch (e) { /* ignore */ } this.ixVoicePaint(); return false; };
    P.ixVoicePaint = function () {
        const el = document.getElementById('ix-vc-log');
        const b = document.getElementById('ix-vc-state');
        if (b) b.innerHTML = this._ixRec ? '<span class="ix-live">● يستمع</span>' : '<span class="hv-dim">متوقف</span>';
        if (el) el.innerHTML = (this._ixVoiceLog || []).map(l => `<div class="fmx-item"><div><b>«${esc(l.text)}»</b><small class="${l.ok ? '' : 'ix-bad'}">${esc(l.msg)}</small></div></div>`).join('') || empty('قل شيئاً مثل: «أضف دالة تحسب متوسط مصفوفة»');
    };
    P.ixVoice = async function () {
        const c = this.ixCfg('voice');
        this._ixMount = () => this.ixVoicePaint();
        return card('المبرمج الصوتي: تكلّم وهو يكتب', `<p class="hv-dim">بعض الأوامر تُنفَّذ محلياً فوراً: «احفظ»، «شغّل»، «تراجع»، «نسّق»، «اذهب إلى السطر 12»، «حدد الأسطر من 3 إلى 8»، «احذف السطر 5»، «افتح ملف app»، «أنشئ ملف utils.js»، «توقف». وأي كلام آخر يُحوَّل إلى تعديل على الملف المفتوح عند المؤشر، ويمكنك التراجع عنه. يعمل بالعربية والإنجليزية.</p>
            <div class="gh-row">${pbtn('fa-microphone', 'ابدأ الاستماع', 'app.ixVoiceCoder(true)')}${btn('fa-stop', 'إيقاف', 'app.ixVoiceStop()')}<span id="ix-vc-state"></span>${select('ix-vc-lang', 'اللغة', [['ar-SA', 'العربية'], ['ar-TN', 'العربية (تونس)'], ['en-US', 'English']], c.lang || 'ar-SA', "onchange=\"app.ixSave('voice',{lang:this.value})\"")}</div>
            <div class="gh-row"><input id="ix-vc-text" class="form-input-box" placeholder="أو اكتب الأمر كما لو قلته…" onkeydown="if(event.key==='Enter'){app.ixVoiceHandle(this.value);this.value=''}"></div>
            <div id="ix-vc-log"></div>`, 'fa-microphone-lines');
    };
}
