/* #155 real terminal (xterm.js + bash-like shell over the virtual FS) and #156 npm/yarn/pnpm commands. */
import { esc, card, pbtn, btn, empty, setHTML, extOf, lineDiff, lineCol } from './util.js';
import { createShell, normPath } from './shell.js';
import { createNpm } from './npm.js';

const RUN_LANG = { js: 'js', mjs: 'js', cjs: 'js', ts: 'js', tsx: 'js', jsx: 'js', mts: 'js', arjs: 'js', py: 'py', rb: 'rb', php: 'php', go: 'go' };

export function installTerm(P) {
    /** Virtual FS adapter for the shell (paths are project-relative, no leading slash). */
    P.dvShellFS = function () {
        const app = this;
        return {
            list: () => Array.from(app.virtualProjectFiles.keys()),
            folders: () => Array.from(app.projectFolders || []),
            read: (p) => app.dvRead(p),
            isFolder: (p) => !!(app.projectFolders && app.projectFolders.has(p)),
            write: (p, text) => { if (app.virtualProjectFiles.has(p)) app.writeProjectFile(p, text, 'shell'); else app.createProjectFile(p, text, { open: false }); },
            mkdir: (p) => { app.projectFolders = app.projectFolders || new Set(); app.projectFolders.add(p); if (app.scheduleProjectSave) app.scheduleProjectSave(); },
            remove: (paths) => {
                const all = Array.from(app.virtualProjectFiles.keys());
                const hit = all.filter(f => paths.some(p => f === p || f.startsWith(p.replace(/\/$/, '') + '/')));
                hit.forEach(f => app.virtualProjectFiles.delete(f));
                if (app.projectFolders) paths.forEach(p => Array.from(app.projectFolders).forEach(d => { if (d === p || d.startsWith(p + '/')) app.projectFolders.delete(d); }));
                if (app.scheduleProjectSave) app.scheduleProjectSave();
                if (app.isCodeStudioOpen && app.renderStudioWorkspace) try { app.renderStudioWorkspace(); } catch (e) { /* ignore */ }
            },
            move: (a, b) => {
                const all = Array.from(app.virtualProjectFiles.keys());
                const moves = all.filter(f => f === a || f.startsWith(a + '/')).map(f => [f, b + f.slice(a.length)]);
                if (!moves.length) throw new Error(`mv: ${a}: لا يوجد`);
                moves.forEach(([f, t]) => { const c = app.virtualProjectFiles.get(f); app.virtualProjectFiles.delete(f); app.virtualProjectFiles.set(t, c); });
                if (app.activeStudioFile && moves.some(m => m[0] === app.activeStudioFile)) app.activeStudioFile = moves.find(m => m[0] === app.activeStudioFile)[1];
                if (app.scheduleProjectSave) app.scheduleProjectSave();
                if (app.isCodeStudioOpen && app.renderStudioWorkspace) try { app.renderStudioWorkspace(); } catch (e) { /* ignore */ }
            },
            copy: (a, b) => app.createProjectFile(b, app.dvRead(a) || '', { open: false })
        };
    };
    /** Writer that forwards runner output to the shell io (stdout/stderr). */
    const ioWriter = (io) => {
        const lines = [];
        const put = (level, text) => { const t = String(text); lines.push(t); (level === 'error' || level === 'warn' ? io.err : io.out)(t); };
        return { line: put, html: (c, h) => put(c, String(h).replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')), clear: () => io.clear(), text: () => lines.join('\n') };
    };
    P.dvShellDelegate = async function (name, args, ctx) {
        const io = ctx.io;
        const runFile = async (p, lang) => {
            const path = ctx.rel(p);
            if (!this.virtualProjectFiles.has(path)) return { code: 1, out: `${name}: لا يوجد ملف ${p}` };
            if (!(await this.ensureRunner({ quiet: true }))) return { code: 1, out: 'تعذر تحميل المشغل' };
            const env = { ...(this.getRunEnv ? await this.getRunEnv() : {}), ...ctx.env };
            const l = lang || RUN_LANG[extOf(path)] || 'js';
            const r = await this.runCode({ path, entry: path, lang: l === 'py' ? 'py' : 'js', writer: ioWriter(io), stdin: ctx.stdin || this._runStdin || '', env, footer: false, banner: false, source: 'shell', fixable: false });
            return { code: r.success ? 0 : 1, out: '', streamed: true };
        };
        switch (name) {
            case 'node': case 'run': case 'deno': case 'bun': case 'ts-node': case 'tsx': case 'python': case 'python3': case 'ruby': case 'php': case 'go': {
                const file = args.filter(a => !/^-/.test(a) && a !== 'run')[0];
                if (!file) return { code: 1, out: name === 'node' ? 'REPL غير متاح — استخدم: node ملف.js أو echo "code" > a.js && node a.js' : `${name}: يلزم ملف` };
                if (name === 'node' && (args[0] === '-e' || args[0] === '-p')) {
                    if (!(await this.ensureRunner({ quiet: true }))) return { code: 1 };
                    const src = args[0] === '-p' ? `console.log(${args.slice(1).join(' ')})` : args.slice(1).join(' ');
                    const r = await this.runJS({ code: src, virtualPath: '__shell__.js', writer: ioWriter(io), banner: false, detached: true });
                    return { code: r.success ? 0 : 1, streamed: true };
                }
                return runFile(file, { python: 'py', python3: 'py' }[name]);
            }
            case 'npm': case 'yarn': case 'pnpm': {
                const npm = this.dvNpmClient(ctx, io);
                const r = await npm.exec(name, args);
                if (this.isCodeStudioOpen && this.renderStudioWorkspace) try { this.renderStudioWorkspace(); } catch (e) { /* ignore */ }
                return r;
            }
            case 'npx': return this.dvNpx(args, ctx);
            case 'jest': case 'vitest': case 'mocha': return this.dvShellTests(io, args);
            case 'git': return this.dvShellGit(args);
            case 'open': case 'code': { const p = ctx.rel(args[0] || ''); if (!this.virtualProjectFiles.has(p)) return { code: 1, out: `open: لا يوجد ${args[0] || ''}` }; if (this.openFileAt) this.openFileAt(p, 1); else if (this.openProjectFile) this.openProjectFile(p); return { code: 0, out: '' }; }
            default: return null;
        }
    };
    P.dvShellTests = async function (io, args = []) {
        if (!(await this.ensureRunner({ quiet: true }))) return { code: 1, out: 'تعذر تحميل المشغل' };
        let tests = this.findTestFiles('all');
        const filt = args.filter(a => !/^-/.test(a));
        if (filt.length) tests = tests.filter(t => filt.some(f => t.includes(f)));
        if (!tests.length) return { code: 1, out: 'لا توجد ملفات اختبار (*.test.js, *.spec.ts, test_*.py)' };
        const env = this.getRunEnv ? await this.getRunEnv() : {};
        const js = tests.filter(p => !/\.py$/.test(p));
        if (!js.length) return { code: 1, out: 'اختبارات بايثون: شغّلها من المحرر' };
        const r = await this.runCode({ writer: ioWriter(io), lang: 'js', mode: 'test', tests: js, entry: js[0], path: js[0], env, source: 'shell', fixable: false });
        const s = r.tests && r.tests.summary;
        return { code: s && !s.fail && r.success !== false ? 0 : 1, out: s ? `Tests: ${s.pass} passed${s.fail ? ', ' + s.fail + ' failed' : ''}, ${s.total} total` : '' };
    };
    P.dvShellGit = async function (args) {
        const sub = args[0] || 'status';
        if (sub === 'status') {
            const rows = [];
            for (const [p, f] of this.virtualProjectFiles) {
                if (!f || typeof f.content !== 'string') continue;
                const base = this.getGitHubBase ? this.getGitHubBase(p) : null;
                if (!base) rows.push(`  ??         ${p}`);
                else if (base.content !== f.content) rows.push(`  modified:  ${p}`);
            }
            const { owner, repo, branch } = this.ghRepo ? this.ghRepo() : {};
            return { code: 0, out: `On branch ${branch || 'main'} (${owner}/${repo})\n` + (rows.length ? 'Changes (vs last GitHub sync; ?? = not synced):\n' + rows.slice(0, 200).join('\n') : 'nothing to commit, working tree clean') };
        }
        if (sub === 'log') {
            if (!this.gh || !this.settings.githubToken) return { code: 1, out: 'git log: أضف رمز GitHub في الإعدادات' };
            try {
                const { owner, repo, branch } = this.ghRepo();
                const n = Math.min(+((args.find(a => /^-\d+$/.test(a)) || '-10').slice(1)) || 10, 50);
                const list = await this.gh(`/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${n}`);
                return { code: 0, out: (list || []).map(c => `${c.sha.slice(0, 7)} ${String(c.commit.message).split('\n')[0]} — ${c.commit.author && c.commit.author.name}`).join('\n') };
            } catch (e) { return { code: 1, out: 'git log: ' + e.message }; }
        }
        if (sub === 'diff') {
            const p = args[1];
            const files = p ? [p] : Array.from(this.virtualProjectFiles.keys());
            const out = [];
            files.forEach(f => {
                const base = this.getGitHubBase ? this.getGitHubBase(f) : null, cur = this.dvRead(f);
                if (!base || cur == null || base.content === cur) return;
                out.push(`--- a/${f}\n+++ b/${f}`);
                lineDiff(base.content, cur).filter(o => o.t !== '=').slice(0, 200).forEach(o => out.push(o.t + o.text));
            });
            return { code: 0, out: out.join('\n') || 'لا توجد فروق مقارنة بآخر مزامنة' };
        }
        return { code: 1, out: 'git: المتاح هنا status / log / diff — بقية العمليات من مركز GitHub (Alt+G)' };
    };
    P.dvNpmClient = function (ctx, io) {
        const fs = this.dvShellFS();
        return createNpm({
            read: (p) => fs.read(ctx && ctx.cwd && ctx.cwd !== '/' ? ctx.rel(p) : p),
            write: (p, t) => fs.write(ctx && ctx.cwd && ctx.cwd !== '/' ? ctx.rel(p) : p, t),
            fetch: typeof fetch !== 'undefined' ? (u, o) => fetch(u, o) : null,
            runScript: async (name, cmd, out) => {
                if (out.length) { io.out(out.join('\n')); out.length = 0; }
                if (/^(jest|vitest|mocha)\b/.test(cmd)) { const r = await this.dvShellTests(io, cmd.split(/\s+/).slice(1)); if (r.out) out.push(r.out); return r.code; }
                const sh = this.dvShellInstance();
                return sh.exec(cmd, io);
            }
        });
    };
    /** npx prettier|eslint|tsc|stylelint on project files. */
    P.dvNpx = async function (args, ctx) {
        const [tool, ...rest] = args.filter(a => a !== '-y' && a !== '--yes');
        const targets = rest.filter(a => !/^-/.test(a)).map(a => ctx.rel(a));
        const write = rest.includes('--write') || rest.includes('--fix') || rest.includes('-w');
        const pick = (re) => (targets.length ? this.dvTextFiles(p => targets.some(t => p === t || p.startsWith(t.replace(/\/$/, '') + '/') || t === '' )) : this.dvTextFiles()).filter(([p]) => re.test(p) && !/node_modules|\.min\./.test(p));
        if (tool === 'prettier') {
            if (!this.toolsRequest) return { code: 1, out: 'أداة التنسيق غير متاحة' };
            const files = pick(/\.(m?[jt]sx?|cjs|json|css|scss|less|html?|md|ya?ml|vue)$/);
            const lines = [];
            let changed = 0;
            for (const [p, c] of files) {
                try {
                    const r = await this.toolsRequest('format', { code: c, path: p });
                    const out = r && (r.code != null ? r.code : r.formatted);
                    if (out != null && out !== c) { changed++; if (write) this.writeProjectFile(p, out, 'format'); lines.push((write ? '✎ ' : '✗ ') + p); }
                } catch (e) { lines.push('⚠ ' + p + ': ' + e.message); }
            }
            return { code: !write && changed ? 1 : 0, out: lines.join('\n') + `\n${write ? `نُسّق ${changed} ملف` : changed ? `${changed} ملف يحتاج تنسيقاً (أضف --write)` : '✓ كل الملفات منسقة'} من ${files.length}` };
        }
        if (tool === 'eslint' || tool === 'tsc' || tool === 'stylelint') {
            const re = tool === 'stylelint' ? /\.(css|scss|less)$/ : tool === 'tsc' ? /\.(tsx?|mts|cts)$/ : /\.(m?[jt]sx?|cjs)$/;
            const files = pick(re);
            if (!files.length) return { code: 0, out: 'لا توجد ملفات مطابقة' };
            const lines = [];
            let errs = 0, warns = 0;
            if ((!this.lintForEditor || this.lintForEditor.__oxLazy || !this.typecheckPayload || this.typecheckPayload.__oxLazy) && this.ensureStudio) { try { await this.ensureStudio({ quiet: true }); } catch (e) { /* offline */ } }
            for (const [p, c] of files) {
                let diags = [];
                if (tool === 'tsc') {
                    if (!this.toolsRequest || !this.typecheckPayload) return { code: 1, out: 'فحص الأنواع غير متاح' };
                    try {
                        const r = await this.toolsRequest('typecheck', { ...this.typecheckPayload(c, p), strict: !rest.includes('--no-strict') }, { timeout: 120000 });
                        if (r && r.error) throw new Error(r.error);
                        diags = (r.diagnostics || []).map(d => ({ line: d.line, col: d.column, severity: d.severity === 2 ? 'error' : 'warning', message: `TS${d.code}: ${d.message}` }));
                    } catch (e) { lines.push(`${p}: ⚠ ${e.message}`); continue; }
                } else {
                    try { diags = ((this.lintForEditor ? await this.lintForEditor(c, p) : []) || []).filter(d => (tool === 'stylelint' ? d.source === 'stylelint' : d.source !== 'stylelint' && d.source !== 'typescript')).map(d => { const lc = lineCol(c, d.from || 0); return { line: lc.line, col: lc.col, severity: d.severity, message: d.message }; }); } catch (e) { diags = []; }
                    if (tool === 'stylelint' && write && this.dvStylelintFix) this.dvStylelintFix(p);
                }
                if (!diags.length) continue;
                lines.push(p);
                diags.forEach(d => { if (d.severity === 'error') errs++; else warns++; lines.push(`  ${d.line}:${d.col}  ${d.severity}  ${d.message}`); });
            }
            const total = errs + warns;
            return { code: errs ? (tool === 'tsc' ? 2 : 1) : 0, out: (lines.length ? lines.join('\n') + '\n' : '') + (total ? `✖ ${total} مشكلة (${errs} خطأ، ${warns} تحذير)` : `✓ لا مشاكل في ${files.length} ملف`) };
        }
        if (!tool) return { code: 1, out: 'npx: يلزم اسم أداة (prettier, eslint, tsc, stylelint)' };
        return { code: 1, out: `npx ${tool}: غير متاح في المتصفح — المدعوم: prettier, eslint, tsc, stylelint` };
    };
    P.dvShellInstance = function () {
        if (this._dvShell) return this._dvShell;
        this._dvShell = createShell({ fs: this.dvShellFS(), delegate: (n, a, c) => this.dvShellDelegate(n, a, c) });
        return this._dvShell;
    };

    // ---------------------------------------------------------------- UI
    P.dvShell = async function () {
        this._dvMount = () => this.dvShellMount();
        return card('الطرفية', `<p class="hv-dim">صدفة شبيهة بـ bash تعمل على ملفات مشروعك الافتراضية: <code>ls, cd, cat, grep -rn, find, mv, cp, rm, echo &gt; ملف</code> والأنابيب <code>|</code> و<code>&amp;&amp;</code>. شغّل <code>node app.js</code> أو <code>python main.py</code> أو <code>npm install express</code>. اكتب <code>help</code> للقائمة الكاملة. ↑↓ للسجل و Tab للإكمال.</p>
            <div id="dv-term" class="dvx-xterm" dir="ltr"></div>
            <div class="gh-row">${btn('fa-eraser', 'مسح', 'app.dvShellClear()')}${btn('fa-question', 'help', "app.dvShellType('help')")}${btn('fa-folder-tree', 'tree', "app.dvShellType('tree')")}${btn('fa-vial', 'npm test', "app.dvShellType('npm test')")}</div>`, 'fa-terminal');
    };
    P.dvShellMount = async function () {
        const host = document.getElementById('dv-term');
        if (!host) return null;
        const sh = this.dvShellInstance();
        let term = null;
        if (!this._dvNoXterm) {
            try {
                const [mod, cssMod] = await Promise.all([import('@xterm/xterm'), import('@xterm/xterm/css/xterm.css')]);
                if (!document.getElementById('dvx-xterm-css')) { const st = document.createElement('style'); st.id = 'dvx-xterm-css'; st.textContent = cssMod.default || ''; document.head.appendChild(st); }
                term = new mod.Terminal({ convertEol: true, cursorBlink: true, fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 13, rows: 20, theme: { background: '#0b0f17', foreground: '#d6deeb', cursor: '#7fdbca' }, allowProposedApi: false });
                term.open(host);
                this.dvFitTerm(term, host);
            } catch (e) { term = null; host.innerHTML = ''; }
        }
        this._dvTerm = term ? this.dvXtermUI(term, sh, host) : this.dvPlainTermUI(host, sh);
        this._dvStop = () => { try { if (term) term.dispose(); } catch (e) { /* ignore */ } this._dvTerm = null; };
        return this._dvTerm;
    };
    /** Size the terminal's columns to its host (xterm defaults to 80 cols ≈ 625px, which was cut off on phones). */
    P.dvTermCols = function (width, cellW) { return Math.max(20, Math.min(240, Math.floor((width - 14) / (cellW || 7.8)))); };
    P.dvFitTerm = function (term, host) {
        let ro = null;
        const fit = () => {
            if (!host.isConnected) { if (ro) ro.disconnect(); return; }
            if (!host.clientWidth) return;
            const probe = document.createElement('span');
            probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:13px "JetBrains Mono", ui-monospace, monospace';
            probe.textContent = 'W'.repeat(20); document.body.appendChild(probe);
            const cellW = probe.getBoundingClientRect().width / 20 || 7.8; probe.remove();
            const cols = this.dvTermCols(host.clientWidth, cellW);
            if (cols !== term.cols) { try { term.resize(cols, term.rows); } catch (e) { /* disposed */ } }
        };
        fit();
        if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => fit()); ro.observe(host); }
        return fit;
    };
    /** xterm line editor: history, Tab completion, Ctrl+C/L/U, cursor keys. */
    P.dvXtermUI = function (term, sh, host) {
        const C = { dim: '\x1b[90m', red: '\x1b[31m', green: '\x1b[32m', cyan: '\x1b[36m', reset: '\x1b[0m' };
        let buf = '', pos = 0, hi = -1, busy = false;
        const io = { out: (t) => term.write(String(t).replace(/\n?$/, '\n')), err: (t) => term.write(C.red + String(t).replace(/\n?$/, '') + C.reset + '\n'), clear: () => term.clear() };
        const prompt = () => term.write(C.green + sh.prompt() + C.reset);
        const redraw = () => { term.write('\r\x1b[2K'); prompt(); term.write(buf); if (pos < buf.length) term.write(`\x1b[${buf.length - pos}D`); };
        term.write(`${C.cyan}OX shell${C.reset} ${C.dim}— اكتب help${C.reset}\n`);
        prompt();
        const runLine = async (line) => {
            busy = true;
            term.write('\n');
            try { await sh.exec(line, io); } catch (e) { io.err(e.message); }
            busy = false; buf = ''; pos = 0; hi = -1;
            prompt();
        };
        term.onData((d) => {
            if (busy) { if (d === '\x03') { if (this.stopRun) this.stopRun(); term.write('^C\n'); } return; }
            if (d === '\r') return runLine(buf);
            if (d === '\x7f') { if (pos > 0) { buf = buf.slice(0, pos - 1) + buf.slice(pos); pos--; redraw(); } return; }
            if (d === '\x03') { term.write('^C\n'); buf = ''; pos = 0; prompt(); return; }
            if (d === '\x0c') { term.clear(); redraw(); return; }
            if (d === '\x15') { buf = buf.slice(pos); pos = 0; redraw(); return; }
            if (d === '\t') {
                const head = buf.slice(0, pos), opts = sh.complete(head);
                if (opts.length === 1) { const last = head.split(/\s+/).pop(); const add = opts[0].slice(last.length) + (opts[0].endsWith('/') ? '' : ' '); buf = head + add + buf.slice(pos); pos += add.length; redraw(); }
                else if (opts.length > 1) { term.write('\n' + opts.join('  ') + '\n'); redraw(); }
                return;
            }
            if (d === '\x1b[A' || d === '\x1b[B') { const h = sh.state.history; if (!h.length) return; hi = d === '\x1b[A' ? (hi < 0 ? h.length - 1 : Math.max(0, hi - 1)) : (hi < 0 ? -1 : hi + 1); if (hi >= h.length) hi = -1; buf = hi < 0 ? '' : h[hi]; pos = buf.length; redraw(); return; }
            if (d === '\x1b[D') { if (pos > 0) { pos--; term.write(d); } return; }
            if (d === '\x1b[C') { if (pos < buf.length) { pos++; term.write(d); } return; }
            if (d === '\x1b[H' || d === '\x01') { pos = 0; redraw(); return; }
            if (d === '\x1b[F' || d === '\x05') { pos = buf.length; redraw(); return; }
            if (d.startsWith('\x1b')) return;
            const txt = d.replace(/\r?\n/g, ' ');
            if (/\r/.test(d) && d.length > 1) { buf = buf.slice(0, pos) + d.split('\r')[0]; return runLine(buf); }
            buf = buf.slice(0, pos) + txt + buf.slice(pos); pos += txt.length; redraw();
        });
        setTimeout(() => { try { term.focus(); } catch (e) { /* ignore */ } }, 50);
        return { type: 'xterm', run: (line) => { buf = line; pos = line.length; redraw(); return runLine(line); }, clear: () => { term.clear(); }, io, term, host };
    };
    /** Accessible fallback terminal (no xterm / tests): output log + input line. */
    P.dvPlainTermUI = function (host, sh) {
        host.innerHTML = `<pre class="pfx-pre dvx-pre dvx-term" id="dv-term-out" role="log" aria-live="polite"></pre><div class="dvx-term-in"><span id="dv-term-ps">${esc(sh.prompt())}</span><input id="dv-term-input" class="form-input-box" dir="ltr" autocomplete="off" spellcheck="false" aria-label="أمر"></div>`;
        const out = host.querySelector('#dv-term-out'), input = host.querySelector('#dv-term-input');
        const add = (cls, t) => { const s = document.createElement('span'); s.className = cls; s.textContent = String(t).replace(/\n?$/, '\n'); out.appendChild(s); out.scrollTop = out.scrollHeight; };
        const io = { out: (t) => add('dvx-stdout', t), err: (t) => add('dvx-stderr', t), clear: () => { out.innerHTML = ''; } };
        let hi = -1;
        const run = async (line) => { add('dvx-info', sh.prompt() + line); await sh.exec(line, io); const ps = host.querySelector('#dv-term-ps'); if (ps) ps.textContent = sh.prompt(); };
        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') { const l = input.value; input.value = ''; hi = -1; await run(l); }
            else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { const h = sh.state.history; if (!h.length) return; e.preventDefault(); hi = e.key === 'ArrowUp' ? (hi < 0 ? h.length - 1 : Math.max(0, hi - 1)) : hi + 1; if (hi >= h.length) hi = -1; input.value = hi < 0 ? '' : h[hi]; }
            else if (e.key === 'Tab') { e.preventDefault(); const opts = sh.complete(input.value); if (opts.length === 1) { const parts = input.value.split(/\s+/); parts[parts.length - 1] = opts[0]; input.value = parts.join(' ') + (opts[0].endsWith('/') ? '' : ' '); } else if (opts.length) add('dvx-info', opts.join('  ')); }
        });
        return { type: 'plain', run, clear: io.clear, io, host };
    };
    P.dvShellType = function (line) { if (this._dvTerm) return this._dvTerm.run(line); return null; };
    P.dvShellClear = function () { if (this._dvTerm) this._dvTerm.clear(); };
    /** Run a command line and capture its output (palette / tests / AI). */
    P.dvShellExec = async function (line) {
        const out = [], err = [];
        const code = await this.dvShellInstance().exec(line, { out: (t) => out.push(String(t)), err: (t) => err.push(String(t)), clear() {} });
        return { code, out: out.join('\n'), err: err.join('\n') };
    };

    // ---------------------------------------------------------------- npm UI
    P.dvNpm = async function () {
        let pkg = null;
        try { pkg = JSON.parse(this.dvRead('package.json') || 'null'); } catch (e) { pkg = null; }
        const deps = pkg ? Object.entries(pkg.dependencies || {}).map(d => [...d, false]).concat(Object.entries(pkg.devDependencies || {}).map(d => [...d, true])) : [];
        const scripts = pkg ? Object.entries(pkg.scripts || {}) : [];
        return card('مدير الحزم', `<p class="hv-dim">أوامر npm / yarn / pnpm حقيقية مقابل سجل npm: الإضافة تحلّ أحدث إصدار مطابق وتكتبه في <code>package.json</code>. التنفيذ يتم على المشغّل المدمج (الحزم الشائعة مثل express و jsonwebtoken مدمجة).</p>
            <div class="gh-row"><select id="dv-npm-tool" class="form-input-box dvx-narrow"><option>npm</option><option>yarn</option><option>pnpm</option></select><input id="dv-npm-cmd" class="form-input-box" dir="ltr" placeholder="install lodash -D" onkeydown="if(event.key==='Enter')app.dvNpmRun()">${pbtn('fa-play', 'تنفيذ', 'app.dvNpmRun()')}</div>
            <div class="gh-row">${['install', 'outdated', 'ls', 'init -y'].map(c => btn('fa-terminal', c, `app.dvNpmRun('${c}')`, 'gh-chip')).join('')}${scripts.map(([k]) => btn('fa-play', 'run ' + esc(k), `app.dvNpmRun('run ${esc(k)}')`, 'gh-chip')).join('')}</div>
            <div id="dv-npm-out"></div>`, 'fa-box')
            + card(`الاعتماديات (${deps.length})`, deps.length ? `<div class="fmx-list">${deps.map(([n, r, dev]) => `<div class="fmx-item"><div><b dir="ltr">${esc(n)}</b> <small dir="ltr">${esc(r)}</small>${dev ? ' <span class="gh-chip">dev</span>' : ''}</div>${btn('fa-circle-info', '', `app.dvNpmRun('view ${esc(n)}')`, 'gh-chip', 'title="عرض"')}${btn('fa-trash', '', `app.dvNpmRun('uninstall ${esc(n)}')`, 'gh-chip', 'title="إزالة"')}</div>`).join('')}</div>` : empty(pkg ? 'لا توجد اعتماديات' : 'لا يوجد package.json — نفّذ init'), 'fa-cubes')
            + card('بحث في npm', `<div class="gh-row"><input id="dv-npm-q" class="form-input-box" dir="ltr" placeholder="date formatting" onkeydown="if(event.key==='Enter')app.dvNpmRun('search '+this.value)">${btn('fa-magnifying-glass', 'بحث', "app.dvNpmRun('search '+document.getElementById('dv-npm-q').value)")}</div>`, 'fa-magnifying-glass');
    };
    P.dvNpmRun = async function (cmd) {
        const toolEl = document.getElementById('dv-npm-tool');
        const tool = (toolEl && toolEl.value) || 'npm';
        const line = cmd != null ? cmd : (document.getElementById('dv-npm-cmd') || {}).value || '';
        const out = [];
        const io = { out: (t) => out.push(String(t)), err: (t) => out.push('✗ ' + t), clear() {} };
        setHTML('dv-npm-out', `<pre class="pfx-pre dvx-pre dvx-term" dir="ltr">$ ${esc(tool + ' ' + line)}\n⏳ …</pre>`);
        const r = await this.dvShellDelegate(tool, line.trim().split(/\s+/).filter(Boolean), { cwd: '/', env: {}, stdin: '', io, rel: (p) => normPath('/', p).slice(1) });
        if (r && r.out) out.push(r.out);
        setHTML('dv-npm-out', `<pre class="pfx-pre dvx-pre dvx-term" dir="ltr">$ ${esc(tool + ' ' + line)}\n${esc(out.join('\n'))}\n${r && r.code ? '✗ exit ' + r.code : '✓'}</pre>`);
        if (/^(i|install|add|un|uninstall|remove|rm|init)\b/.test(line.trim())) setTimeout(() => { if (this._dvx && this._dvx.sec === 'npm') { const keep = document.getElementById('dv-npm-out'); const html = keep ? keep.innerHTML : ''; this.dvRefresh().then(() => setHTML('dv-npm-out', html)); } }, 0);
        return { ...r, text: out.join('\n') };
    };
}
