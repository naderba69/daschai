/* Debugging tab — record & replay debugger (the sandbox CSP forbids eval, so execution is recorded with compiled-in
   probes and then navigated): #171 breakpoints • #172 watches • #173 call stack • #174 step over/into/out
   • #175 evaluate expression (re-run with the expression compiled in) • #177 error replay. */
import { esc, card, pbtn, btn, empty, setHTML, call, lsGet, lsSet } from './util.js';
import { instrumentDebug, debugExt, navigate, parseJS } from './instrument.js';

const BP_KEY = 'ox_dv_bps_v1';
const JS_SRC = /\.(m?[jt]sx?|cjs|mts|cts|arjs)$/;
const capWriter = (sink = []) => ({ lines: sink, line(level, text) { sink.push({ level: level || 'log', text: String(text) }); }, html(cls, h) { sink.push({ level: cls, text: String(h).replace(/<[^>]+>/g, '') }); }, clear() { sink.length = 0; }, text() { return sink.map(l => l.text).join('\n'); } });

/** Lines (1-based) of `trace` steps per file — used to show which lines executed. */
export function executedLines(trace, file) {
    const out = new Map();
    trace.forEach(t => { if (t.file === file) out.set(t.line, (out.get(t.line) || 0) + 1); });
    return out;
}
/** Index of the last step that ran before the program failed (error replay). */
export function errorStep(trace, errorLine, file) {
    if (!trace.length) return -1;
    if (errorLine && file) for (let i = trace.length - 1; i >= 0; i--) if (trace[i].file === file && trace[i].line === errorLine) return i;
    return trace.length - 1;
}

export function installDebug(P) {
    P.dvBps = function () { if (!this._dvBpSet) this._dvBpSet = new Set(lsGet(BP_KEY, [])); return this._dvBpSet; };
    P.dvToggleBp = function (file, line) {
        const k = file + ':' + line, s = this.dvBps();
        if (s.has(k)) s.delete(k); else s.add(k);
        lsSet(BP_KEY, Array.from(s));
        if (this._dvDbg) this.dvDbgPaint();
        return s.has(k);
    };
    P.dvDebugFiles = function () { return this.dvTextFiles(p => JS_SRC.test(p) && !/node_modules\/|\.d\.ts$/.test(p)).map(([p]) => p); };
    /** Record one execution with probes in every project module. */
    P.dvRecord = async function (path, { watches = this._dvWatches || [], maxSteps = 5000, stdin } = {}) {
        if (!(await this.ensureRunner({ quiet: true }))) throw new Error('تعذر تحميل المشغل');
        const w = capWriter();
        let trace = null;
        const failed = [];
        const transform = (code, p) => {
            if (/node_modules\//.test(p) || !JS_SRC.test(p)) return code;
            try { return instrumentDebug(code, p, { watches }).code; } catch (e) { failed.push(p + ': ' + e.message); return code; }
        };
        const env = this.getRunEnv ? await this.getRunEnv() : {};
        const base = this.runExtensions ? this.runExtensions({}) : [];
        const res = await this.runJS({ path, entry: path, writer: w, banner: false, detached: true, timeoutMs: 30000, env, stdin: stdin != null ? stdin : (this._runStdin || ''), transform, extensions: [...base, '(' + debugExt.toString() + ')'], cfg: { debug: { maxSteps } }, onMessage: (m) => { if (m.type === 'trace') trace = m; } });
        const errLoc = /\(([^():]+):(\d+)\)\s*$/.exec(res.error || '');
        return { path, at: Date.now(), watches: watches.slice(), trace: (trace && trace.trace) || [], truncated: !!(trace && trace.truncated), steps: (trace && trace.steps) || 0, exitCode: trace ? trace.exitCode : null, success: !!res.success, error: res.error || null, errorAt: errLoc ? { file: errLoc[1], line: +errLoc[2] } : null, out: w.lines.filter(l => l.level !== 'info'), failed };
    };
    P.dvDebugger = async function () {
        const files = this.dvDebugFiles();
        const def = (this._dvDbg && this._dvDbg.path) || (this.activeStudioFile && JS_SRC.test(this.activeStudioFile) ? this.activeStudioFile : (this.detectProjectEntry && this.detectProjectEntry()) || files[0] || '');
        this._dvWatches = this._dvWatches || [];
        this._dvMount = () => { if (this._dvDbg) this.dvDbgPaint(); };
        return card('المصحح (تسجيل وإعادة تشغيل)', `<p class="hv-dim">يسجّل البرنامج خطوة بخطوة (حتى 5000 خطوة) مع المتغيرات وسلسلة الاستدعاء، ثم تتنقل للأمام والخلف: <b>خطوة داخل / فوق / خروج</b>، <b>متابعة حتى نقطة التوقف</b>، وحتى الرجوع للخلف. انقر رقم السطر لإضافة نقطة توقف.</p>
            <div class="gh-row"><label class="fmx-field"><span>ملف التشغيل</span><select id="dv-dbg-file" class="form-input-box" dir="ltr">${files.map(p => `<option ${p === def ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>${pbtn('fa-circle-dot', 'تسجيل التنفيذ', 'app.dvDebugRun()', files.length ? '' : 'disabled')}</div>
            <div class="dvx-watchbar"><input id="dv-dbg-watch" class="form-input-box" dir="ltr" placeholder="تعبير للمراقبة أو التقييم، مثل: total * 2" onkeydown="if(event.key==='Enter')app.dvAddWatch()">${btn('fa-eye', 'مراقبة', 'app.dvAddWatch()')}${btn('fa-calculator', 'تقييم هنا', 'app.dvEvaluate()')}</div>
            <div id="dv-dbg-watches">${this.dvWatchChips()}</div>`, 'fa-bug')
            + '<div id="dv-dbg-view"></div>';
    };
    P.dvWatchChips = function () { return (this._dvWatches || []).map((w, i) => `<span class="gh-chip" dir="ltr">${esc(w)} <a href="#" onclick="${call('dvRemoveWatch', i)};return false" aria-label="إزالة">✕</a></span>`).join(''); };
    P.dvAddWatch = async function (expr) {
        const e = String(expr != null ? expr : (document.getElementById('dv-dbg-watch') || {}).value || '').trim();
        if (!e) return null;
        try { parseJS('(' + e + ');'); } catch (err) { this.showToast('تعبير غير صالح: ' + this.escapeHTML(err.message), 'error'); return null; }
        this._dvWatches = (this._dvWatches || []).filter(x => x !== e).concat([e]);
        const inp = document.getElementById('dv-dbg-watch'); if (inp) inp.value = '';
        setHTML('dv-dbg-watches', this.dvWatchChips());
        if (this._dvDbg) return this.dvDebugRun(this._dvDbg.path, { keep: true });
        return e;
    };
    P.dvRemoveWatch = function (i) { (this._dvWatches || []).splice(i, 1); setHTML('dv-dbg-watches', this.dvWatchChips()); if (this._dvDbg) this.dvDebugRun(this._dvDbg.path, { keep: true }); };
    /** #175 evaluate: compile the expression in, re-record, return its value at the current step. */
    P.dvEvaluate = async function (expr) {
        const e = String(expr != null ? expr : (document.getElementById('dv-dbg-watch') || {}).value || '').trim();
        if (!e) return null;
        if (!this._dvDbg) { this.showToast('سجّل التنفيذ أولاً', 'info'); return null; }
        const at = this._dvDbg.trace[this._dvDbgCur] ? this._dvDbg.trace[this._dvDbgCur].i : 0;
        const r = await this.dvRecord(this._dvDbg.path, { watches: (this._dvWatches || []).concat([e]) });
        const idx = Math.max(0, r.trace.findIndex(t => t.i === at));
        const step = r.trace[idx];
        const value = step && step.watch ? step.watch[step.watch.length - 1] : '—';
        this._dvEval = { expr: e, value, step: at };
        if (this._dvDbg) this.dvDbgPaint();
        return value;
    };
    P.dvDebugRun = async function (pathArg, { keep = false, jump } = {}) {
        const path = pathArg || (document.getElementById('dv-dbg-file') || {}).value;
        if (!path) return null;
        const prevI = keep && this._dvDbg && this._dvDbg.trace[this._dvDbgCur] ? this._dvDbg.trace[this._dvDbgCur].i : null;
        setHTML('dv-dbg-view', '<div class="gh-empty"><span class="live-step-spinner"></span> تسجيل…</div>');
        try {
            const r = await this.dvRecord(path);
            this._dvDbg = r;
            this._dvEval = null;
            let cur = 0;
            if (prevI != null) cur = Math.max(0, r.trace.findIndex(t => t.i === prevI));
            else if (jump === 'error') cur = errorStep(r.trace, r.errorAt && r.errorAt.line, r.errorAt && r.errorAt.file);
            else if (this.dvBps().size) { const b = navigate(r.trace, -1, 'continue', this.dvBps()); cur = b >= 0 ? b : 0; if (r.trace[0] && this.dvBps().has(r.trace[0].file + ':' + r.trace[0].line)) cur = 0; }
            this._dvDbgCur = Math.max(0, cur);
            this.dvDbgPaint();
            return r;
        } catch (e) { return this.dvErr(e, 'dv-dbg-view'); }
    };
    P.dvStep = function (mode) {
        const r = this._dvDbg;
        if (!r || !r.trace.length) return -1;
        this._dvDbgCur = mode === 'start' ? 0 : mode === 'end' ? r.trace.length - 1 : navigate(r.trace, this._dvDbgCur, mode, this.dvBps());
        this.dvDbgPaint();
        return this._dvDbgCur;
    };
    P.dvStepTo = function (i) { if (!this._dvDbg) return; this._dvDbgCur = Math.max(0, Math.min(this._dvDbg.trace.length - 1, +i)); this.dvDbgPaint(); };
    P.dvDbgPaint = function () {
        const r = this._dvDbg;
        if (!r || !document.getElementById('dv-dbg-view')) return;
        const tr = r.trace, cur = this._dvDbgCur || 0, t = tr[cur];
        const head = `<div class="dvx-dbg-status">${r.success ? '✅ انتهى بنجاح' : '❌ ' + esc(r.error || 'فشل')} • ${r.steps} خطوة${r.truncated ? ' (اقتُطع السجل عند 5000)' : ''}${r.failed.length ? ` • ⚠ تعذر تتبع ${r.failed.length} ملف` : ''}</div>`;
        if (!t) { setHTML('dv-dbg-view', head + empty('لا توجد خطوات مسجلة — هل الملف يحتوي كوداً قابلاً للتنفيذ؟')); return; }
        const ctrl = (icon, label, mode, key) => `<button class="sidebar-btn-util gh-btn" onclick="app.dvStep('${mode}')" title="${label}${key ? ' (' + key + ')' : ''}" aria-label="${label}"><i class="fa-solid ${icon}"></i></button>`;
        const src = this.dvRead(t.file) || '';
        const lines = src.split('\n');
        const execd = executedLines(tr, t.file);
        const bps = this.dvBps();
        const from = Math.max(0, t.line - 12), to = Math.min(lines.length, t.line + 12);
        const code = lines.slice(from, to).map((l, k) => {
            const n = from + k + 1, bp = bps.has(t.file + ':' + n);
            return `<div class="dvx-cl ${n === t.line ? 'dvx-cur' : ''} ${execd.has(n) ? 'dvx-ran' : ''}"><a href="#" class="dvx-ln dvx-bp ${bp ? 'on' : ''}" onclick="${call('dvToggleBp', t.file, n)};return false" title="نقطة توقف">${bp ? '●' : n}</a><span class="dvx-hits">${execd.get(n) ? execd.get(n) + '×' : ''}</span><code>${esc(l) || ' '}</code></div>`;
        }).join('');
        const vars = t.vars ? Object.entries(t.vars) : [];
        const prevVars = cur > 0 && tr[cur - 1].vars ? tr[cur - 1].vars : {};
        const outCount = t.out || 0;
        const logs = r.out.slice(0, outCount);
        const ev = this._dvEval;
        setHTML('dv-dbg-view', head + `<div class="dvx-dbg-ctrl" role="toolbar" aria-label="التحكم بالتنفيذ">
                ${ctrl('fa-backward-fast', 'متابعة للخلف حتى نقطة توقف', 'continueBack')}${ctrl('fa-backward-step', 'خطوة للخلف', 'back')}${ctrl('fa-arrow-down', 'خطوة داخل', 'into', 'F11')}${ctrl('fa-arrow-turn-down', 'خطوة فوق', 'over', 'F10')}${ctrl('fa-arrow-turn-up', 'خطوة خروج', 'out', 'Shift+F11')}${ctrl('fa-forward-fast', 'متابعة حتى نقطة التوقف', 'continue', 'F8')}
                <input type="range" min="0" max="${tr.length - 1}" value="${cur}" class="dvx-range" oninput="app.dvStepTo(this.value)" aria-label="الخطوة">
                <span class="dvx-pos" dir="ltr">${cur + 1}/${tr.length} • ${esc(t.file)}:${t.line}</span></div>
            <div class="dvx-dbg-grid">
                <div class="fmx-card dvx-dbg-src"><div class="fmx-card-h"><i class="fa-solid fa-file-code"></i> <span dir="ltr">${esc(t.file)}</span> ${btn('fa-up-right-from-square', '', call('openFileAt', t.file, t.line, 1), 'gh-chip', 'title="فتح في المحرر"')}</div><div class="dvx-covsrc" dir="ltr">${code}</div></div>
                <div class="dvx-dbg-side">
                    ${card('المتغيرات', vars.length ? `<table class="fmx-table dvx-vars">${vars.map(([k, v]) => `<tr class="${prevVars[k] !== undefined && prevVars[k] !== v ? 'dvx-changed' : ''}"><td dir="ltr"><b>${esc(k)}</b></td><td dir="ltr"><code>${esc(v)}</code></td></tr>`).join('')}</table>` : '<small class="hv-dim">لا توجد متغيرات في هذا النطاق</small>', 'fa-cube')}
                    ${(r.watches.length || ev) ? card('المراقبة', `<table class="fmx-table dvx-vars">${r.watches.map((w, i) => `<tr><td dir="ltr"><b>${esc(w)}</b></td><td dir="ltr"><code>${esc(t.watch ? t.watch[i] : '—')}</code></td></tr>`).join('')}${ev ? `<tr class="dvx-changed"><td dir="ltr"><b>${esc(ev.expr)}</b> <small>(تقييم)</small></td><td dir="ltr"><code>${esc(ev.value)}</code></td></tr>` : ''}</table>`, 'fa-eye') : ''}
                    ${card('سلسلة الاستدعاء', `<ol class="dvx-stack" dir="ltr">${[`<li class="on">${esc(t.file)}:${t.line}</li>`].concat(t.stack.slice().reverse().map(f => `<li>${esc(f)}</li>`)).join('')}${t.stack.length ? '' : '<li class="hv-dim">(المستوى الأعلى)</li>'}</ol>`, 'fa-layer-group')}
                    ${card(`المخرجات حتى هذه الخطوة (${logs.length}/${r.out.length})`, logs.length ? `<pre class="pfx-pre dvx-pre dvx-term" dir="ltr">${logs.map(l => `<span class="dvx-${l.level === 'error' ? 'stderr' : 'stdout'}">${esc(l.text)}</span>`).join('\n')}</pre>` : '<small class="hv-dim">—</small>', 'fa-terminal')}
                </div></div>`);
    };
    P.dvDebugKey = function (e) {
        if (!this._dvDbg || !document.getElementById('dv-dbg-view')) return false;
        const map = { F10: 'over', F11: e.shiftKey ? 'out' : 'into', F8: 'continue' };
        const mode = map[e.key];
        if (!mode) return false;
        e.preventDefault();
        this.dvStep(mode);
        return true;
    };

    // ---------------------------------------------------------------- #177 error replay
    P.dvReplay = async function () {
        const e = this._lastRunError;
        this._dvMount = () => { if (this._dvDbg && this._dvDbg.replay) this.dvDbgPaint(); };
        return card('إعادة تشغيل الأخطاء', `<p class="hv-dim">عندما يفشل تشغيل ملف JavaScript يظهر زر «إعادة تشغيل الخطأ خطوة بخطوة» في الطرفية: يُعاد تنفيذ البرنامج مع التسجيل ويُفتح المصحح عند آخر خطوة قبل الخطأ، فتعود للخلف لترى كيف وصلت القيم إلى تلك الحالة.</p>
            ${e ? `<div class="fmx-item"><div><b dir="ltr">${esc(e.path)}</b><small dir="ltr">${esc(String(e.error).slice(0, 300))}</small></div>${pbtn('fa-film', 'إعادة التشغيل', 'app.dvReplayError()')}</div>` : empty('لا يوجد خطأ تشغيل حديث')}`, 'fa-film')
            + '<div id="dv-dbg-view"></div>';
    };
    P.dvReplayError = async function () {
        const e = this._lastRunError;
        if (!e) { this.showToast('لا يوجد خطأ تشغيل حديث', 'info'); return null; }
        if (!document.getElementById('dv-dbg-view')) await this.openDevLab('debug', 'replay');
        const r = await this.dvDebugRun(e.path, { jump: 'error' });
        if (r) r.replay = true;
        return r;
    };
}
