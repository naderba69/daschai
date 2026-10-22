/* ==============================================================================
   Sprint 6 — AI inside the editor
   #211 inline completion (ghost text) • #212 explain line on hover • #213 improve
   #214 complete function • #215 comment • #216 detect bugs before running
   #217/#161/#162 generate tests • #218 translate • #219 description → regex
   #220 simplify • #144 JS → TS • #146 types from JSDoc • #239 split large file
   #178/#179 AI fix with before/after diff
   ============================================================================== */
const LANG_EXT = { JavaScript: 'js', TypeScript: 'ts', Python: 'py', Go: 'go', Rust: 'rs', Java: 'java', 'C#': 'cs', PHP: 'php', Ruby: 'rb', Kotlin: 'kt', Swift: 'swift', 'C++': 'cpp', Dart: 'dart', Lua: 'lua' };

export function installAI(P, ctx) {
    const { intel, esc } = ctx;

    P.hasAIKey = function () { return !!(this.settings && this.settings.apiKey && String(this.settings.apiKey).trim() && this.streamOpenRouter); };
    P.editorAIModel = function (kind = 'coding') {
        const s = this.getEditorSettings();
        if (kind === 'inline' && s.inlineModel) return s.inlineModel;
        return s.aiModel || (this.routeForCategory && this.routeForCategory('coding')) || this.settings.model;
    };
    P.editorAI = async function (prompt, { maxTokens = 2500, system, signal, quiet = false, source = 'editor', kind = 'coding' } = {}) {
        if (!this.hasAIKey()) { if (!quiet) this.showToast('يلزم مفتاح OpenRouter في الإعدادات', 'warning'); return null; }
        const model = this.editorAIModel(kind);
        const messages = (system ? [{ role: 'system', content: system }] : []).concat([{ role: 'user', content: prompt }]);
        const t0 = Date.now();
        const r = await this.streamOpenRouter({ model, maxTokens, messages, signal, onDelta: () => {} });
        if (this.recordUsage) this.recordUsage({ model, usage: r.usage, promptChars: prompt.length, completionChars: (r.content || '').length, durationMs: r.durationMs || Date.now() - t0, source });
        return r.content || '';
    };
    /** First fenced code block (or the whole reply). */
    P.extractCodeFromAI = function (text) {
        const m = /```[\w+#.-]*[^\n]*\n([\s\S]*?)\n?```/.exec(text || '');
        return m ? m[1] : String(text || '').trim();
    };
    P.editorContext = function () {
        const ctl = this.codeEditor;
        if (!ctl) return null;
        const text = ctl.getValue(), sel = ctl.getSelection();
        const path = this.activeStudioFile || 'untitled.txt';
        return { ctl, text, path, sel, selected: text.slice(sel.from, sel.to), language: ctl.languageName() || intel.extOf(path) || 'text', line: ctl.lineAt(sel.head) };
    };
    /** Enclosing function/method around pos (brace matching for C-like, indentation for Python). */
    P.enclosingBlock = function (text, pos, path) {
        const syms = intel.extractSymbols(text, path).filter(s => /function|method/.test(s.kind) && s.pos <= pos);
        for (let i = syms.length - 1; i >= 0; i--) {
            const s = syms[i];
            const start = text.lastIndexOf('\n', s.pos - 1) + 1;
            let end = -1;
            if (intel.isPy(path)) {
                const lines = text.slice(start).split('\n');
                let off = start + lines[0].length + 1;
                end = text.length;
                for (let j = 1; j < lines.length; j++) {
                    const l = lines[j];
                    if (l.trim() && /^\s*/.exec(l)[0].length <= s.indent) { end = off - 1; break; }
                    off += l.length + 1;
                }
            } else {
                const masked = intel.maskCode(text, path);
                const open = masked.indexOf('{', s.pos);
                if (open < 0) continue;
                let depth = 0;
                for (let k = open; k < masked.length; k++) {
                    if (masked[k] === '{') depth++;
                    else if (masked[k] === '}' && --depth === 0) { end = k + 1; break; }
                }
                if (end < 0) end = text.length;
            }
            if (pos <= end) return { from: start, to: end, name: s.name };
        }
        return null;
    };
    P.showDiffApply = async function (title, oldText, newText, { okLabel = 'تطبيق' } = {}) {
        if (oldText === newText) { this.showToast('لا تغييرات مقترحة', 'info'); return false; }
        const ol = oldText.split('\n'), nl = newText.split('\n');
        const stats = this.diffStats ? this.diffStats(this.diffLines(ol, nl)) : null;
        const html = this.renderDiffHTML && this.diffLines ? this.renderDiffHTML(ol, nl, this.diffLines(ol, nl)) : `<pre dir="ltr">${esc(newText)}</pre>`;
        const r = await this.showDialog({
            title, body: `${stats ? `<p class="ox-dialog-msg"><span class="text-emerald">+${stats.add || 0}</span> <span class="text-red">−${stats.del || 0}</span> — قبل/بعد</p>` : ''}<div class="diff-scroll ai-diff" dir="ltr">${html}</div>`,
            buttons: [{ label: okLabel, value: 'ok', primary: true }, { label: 'إلغاء', value: null }],
            wide: true
        });
        return !!r;
    };
    const running = (app, msg) => app.showToast(msg + ' ✨', 'info');
    const fence = (lang, code) => '```' + (lang || '') + '\n' + code + '\n```';

    // ------------------------------------------------------------------ RANGE ACTIONS
    const PROMPTS = {
        improve: 'Improve this code: better naming, performance and readability, keep behaviour identical.',
        simplify: 'Simplify this complex code into an easier, shorter equivalent with identical behaviour.',
        comment: 'Add concise, helpful comments (docstrings/JSDoc for functions) to this code. Do not change the logic.',
        complete: 'Complete/implement this function. Fill in TODOs and missing logic. Keep the signature.',
        edit: ''
    };
    P.aiAction = async function (kind, instruction) {
        const c = this.editorContext();
        if (!c) return null;
        let from = c.sel.from, to = c.sel.to;
        if (from === to) {
            const block = kind === 'complete' || kind === 'comment' ? this.enclosingBlock(c.text, c.sel.head, c.path) : null;
            if (block) { from = block.from; to = block.to; }
            else if (kind === 'edit' && c.text.length < 30000) { from = 0; to = c.text.length; }
            else { from = c.line.from; to = c.line.to; }
        }
        const original = c.text.slice(from, to);
        if (!original.trim() && kind !== 'edit') { this.showToast('لا يوجد كود لتطبيق الإجراء عليه', 'info'); return null; }
        const task = kind === 'edit' ? instruction : PROMPTS[kind];
        if (!task) return null;
        running(this, 'الذكاء الاصطناعي يعمل');
        const prompt = `${task}\n\nFile: ${c.path} (${c.language}). Return ONLY the replacement code for the snippet in a single fenced code block — no explanations.\n\nFull file for context:\n${fence(c.language, c.text.slice(0, 20000))}\n\nSnippet to replace (lines ${c.ctl.lineAt(from).number}-${c.ctl.lineAt(to).number}):\n${fence(c.language, original)}`;
        let out;
        try { out = await this.editorAI(prompt, { maxTokens: 3000 }); } catch (e) { this.showToast('فشل طلب الذكاء الاصطناعي: ' + e.message, 'error'); return null; }
        if (out == null) return null;
        let code = this.extractCodeFromAI(out);
        if (original.endsWith('\n') && !code.endsWith('\n')) code += '\n';
        const labels = { improve: 'تحسين الكود', simplify: 'تبسيط الكود', comment: 'إضافة تعليقات', complete: 'إكمال الدالة', edit: 'تعديل بالذكاء الاصطناعي' };
        if (!(await this.showDiffApply(labels[kind] + ' — مراجعة', original, code))) return null;
        if (c.ctl.getValue().slice(from, to) !== original) { this.showToast('تغير الملف أثناء الطلب — أعد المحاولة', 'warning'); return null; }
        c.ctl.replaceRange(from, to, code, from, from + code.length);
        this.showToast('تم تطبيق التعديل ✨', 'success');
        return code;
    };
    P.aiEditSelection = async function () {
        if (!this.hasAIKey()) { this.showToast('يلزم مفتاح OpenRouter في الإعدادات', 'warning'); return null; }
        const c = this.editorContext();
        if (!c) return null;
        const ins = await this.askText('تعديل بالذكاء الاصطناعي (Ctrl+I)', '', { label: c.selected ? 'ماذا تريد أن تفعل بالتحديد؟' : 'ماذا تريد أن تغير في الملف؟', placeholder: 'مثال: أضف معالجة الأخطاء وحوّلها إلى async/await', dir: 'auto' });
        if (!ins) return null;
        return this.aiAction('edit', ins);
    };
    P.aiExplainSelection = async function (lineNo) {
        const c = this.editorContext();
        if (!c) return null;
        let snippet = c.selected;
        if (lineNo) snippet = c.ctl.view.state.doc.line(Math.max(1, Math.min(lineNo, c.ctl.lineCount()))).text;
        if (!snippet.trim()) snippet = c.line.text;
        if (!snippet.trim()) { this.showToast('ضع المؤشر على سطر به كود', 'info'); return null; }
        this.showDialog({ title: 'شرح الكود', body: '<div id="ai-explain-body" class="ai-explain md-body" dir="auto"><span class="live-step-spinner"></span> جاري الشرح...</div>', buttons: [{ label: 'إغلاق', value: null }] });
        const prompt = `اشرح هذا الكود بالعربية بإيجاز ووضوح (ماذا يفعل ولماذا، ومثال إن لزم). الملف ${c.path}.\n\nالسياق:\n${fence(c.language, c.text.slice(0, 8000))}\n\nالجزء المطلوب شرحه:\n${fence(c.language, snippet)}`;
        let out = null;
        try { out = await this.editorAI(prompt, { maxTokens: 1200 }); } catch (e) { out = '❌ ' + e.message; }
        const el = document.getElementById('ai-explain-body');
        if (el) el.innerHTML = out == null ? 'يلزم مفتاح OpenRouter' : (this.renderMarkdownSafe ? this.renderMarkdownSafe(out) : esc(out));
        return out;
    };
    P.aiExplainLine = function (line) { return this.aiExplainSelection(line); };

    P.aiDetectBugs = async function () {
        const c = this.editorContext();
        if (!c) return null;
        running(this, 'فحص الأخطاء بالذكاء الاصطناعي');
        const doc = c.text;
        const prompt = `Find real bugs, runtime errors and risky code in this ${c.language} file BEFORE it runs. Reply ONLY with a JSON array (no prose) of objects: {"line": number, "severity": "error"|"warning"|"info", "message": "short Arabic explanation"}. Return [] if there are no problems.\n\nFile ${c.path}:\n${fence(c.language, doc.slice(0, 30000))}`;
        let out;
        try { out = await this.editorAI(prompt, { maxTokens: 1500 }); } catch (e) { this.showToast(e.message, 'error'); return null; }
        if (out == null) return null;
        let list = [];
        try { const m = /\[[\s\S]*\]/.exec(out); list = JSON.parse(m ? m[0] : out); } catch (e) { list = []; }
        const lines = doc.split('\n');
        const starts = [0]; for (let i = 0; i < lines.length; i++) starts.push(starts[i] + lines[i].length + 1);
        const diags = (Array.isArray(list) ? list : []).filter(d => d && d.line >= 1 && d.line <= lines.length).slice(0, 50).map(d => {
            const l = d.line - 1, ind = /^\s*/.exec(lines[l])[0].length;
            return { from: starts[l] + ind, to: starts[l] + lines[l].length, severity: ['error', 'warning', 'info'].includes(d.severity) ? d.severity : 'warning', message: '🤖 ' + String(d.message || '').slice(0, 300), source: 'ai' };
        });
        this._aiDiags = { path: c.path, doc, list: diags };
        c.ctl.forceLint();
        this.showToast(diags.length ? `الذكاء الاصطناعي وجد ${diags.length} مشكلة محتملة` : 'لم يُعثر على مشاكل ✅', diags.length ? 'warning' : 'success');
        return diags;
    };

    P.testPathFor = function (path) {
        const dir = intel.dirName(path), base = intel.baseName(path), ext = intel.extOf(path);
        const stem = base.replace(/\.[^.]+$/, '');
        if (ext === 'py') return (dir ? dir + '/' : '') + 'test_' + stem + '.py';
        return (dir ? dir + '/' : '') + stem + '.test.' + (ext === 'ts' || ext === 'tsx' ? ext.replace('x', '') : 'js');
    };
    P.aiGenerateTests = async function () {
        const c = this.editorContext();
        if (!c) return null;
        const py = intel.isPy(c.path);
        const target = this.testPathFor(c.path);
        const spec = c.selected || c.text;
        running(this, 'توليد الاختبارات');
        const rel = intel.relativeSpec(target, c.path, './x.js').replace(/\.(ts|tsx|js|jsx|mjs)$/, '');
        const guide = py
            ? `Write pytest-style tests (plain functions named test_* using assert; you may also use unittest.TestCase). Import from the module "${intel.baseName(c.path).replace(/\.py$/, '')}". Only the standard library is available.`
            : `Write Jest/Vitest-style tests using the globals describe/it/test/expect (toBe, toEqual, toStrictEqual, toBeTruthy, toBeFalsy, toBeNull, toBeUndefined, toBeDefined, toContain, toHaveLength, toMatch, toThrow, toBeGreaterThan, toBeLessThan, toBeCloseTo, toHaveProperty, not, resolves/rejects). Import the code under test with: import { ... } from '${rel}'; beforeEach/afterEach are available. No other libraries.`;
        const prompt = `${guide}\nCover normal cases, edge cases and errors. Return ONLY the test file in one fenced code block.\n\nCode under test (${c.path}):\n${fence(c.language, spec.slice(0, 25000))}`;
        let out;
        try { out = await this.editorAI(prompt, { maxTokens: 3500 }); } catch (e) { this.showToast(e.message, 'error'); return null; }
        if (out == null) return null;
        const code = this.extractCodeFromAI(out) + '\n';
        const path = this.virtualProjectFiles.has(target) ? this.uniqueProjectPath(target) : target;
        this.createProjectFile(path, code, { open: true, reason: 'ai-tests' });
        this.showActionToast(`تم إنشاء ${path}`, 'تشغيل الاختبارات', () => this.runTests('file'), 'success');
        return { path, code };
    };
    P.aiTranslate = async function (toLang) {
        const c = this.editorContext();
        if (!c) return null;
        if (!toLang) {
            const r = await this.showDialog({ title: 'ترجمة الكود إلى لغة أخرى', body: '', fields: [{ id: 'lang', label: 'اللغة الهدف', type: 'select', options: Object.keys(LANG_EXT).map(l => ({ value: l, label: l })), value: intel.isPy(c.path) ? 'JavaScript' : 'Python' }], buttons: [{ label: 'ترجمة', value: 'ok', primary: true }, { label: 'إلغاء', value: null }] });
            if (!r) return null;
            toLang = r.values.lang;
        }
        const src = c.selected || c.text;
        running(this, 'الترجمة إلى ' + toLang);
        let out;
        try { out = await this.editorAI(`Translate this ${c.language} code to idiomatic ${toLang}. Keep behaviour and comments. Return ONLY the code in one fenced block.\n\n${fence(c.language, src.slice(0, 25000))}`, { maxTokens: 3500 }); } catch (e) { this.showToast(e.message, 'error'); return null; }
        if (out == null) return null;
        const code = this.extractCodeFromAI(out) + '\n';
        if (c.selected) {
            const r = await this.showDialog({ title: `الترجمة إلى ${toLang}`, body: `<pre class="ai-code" dir="ltr">${esc(code)}</pre>`, buttons: [{ label: 'نسخ', value: 'copy', primary: true }, { label: 'ملف جديد', value: 'file' }, { label: 'إغلاق', value: null }] });
            if (r && r.button === 'copy') { this.copyText ? this.copyText(code) : navigator.clipboard && navigator.clipboard.writeText(code); return code; }
            if (!r || r.button !== 'file') return code;
        }
        const target = this.uniqueProjectPath(c.path.replace(/\.[^./]+$/, '') + '.' + (LANG_EXT[toLang] || 'txt'));
        this.createProjectFile(target, code, { open: true, reason: 'ai-translate' });
        this.showToast(`تم إنشاء ${target}`, 'success');
        return code;
    };
    P.aiRegex = async function (desc) {
        const c = this.editorContext();
        if (!c) return null;
        desc = desc || await this.askText('وصف → تعبير نمطي Regex', c.selected || '', { label: 'صف ما تريد مطابقته (أو الصق مثالاً)', placeholder: 'مثال: بريد إلكتروني ينتهي بـ .tn', dir: 'auto' });
        if (!desc) return null;
        const flavor = intel.isPy(c.path) ? 'Python re' : 'JavaScript';
        let out;
        try { out = await this.editorAI(`Create a ${flavor} regular expression for: ${desc}\nReply ONLY as JSON: {"pattern": "...", "flags": "...", "explanation": "short Arabic explanation", "examples": ["matching example"]}`, { maxTokens: 600 }); } catch (e) { this.showToast(e.message, 'error'); return null; }
        if (out == null) return null;
        let r;
        try { const m = /\{[\s\S]*\}/.exec(out); r = JSON.parse(m ? m[0] : out); } catch (e) { r = { pattern: this.extractCodeFromAI(out).trim(), flags: '', explanation: '' }; }
        try { new RegExp(r.pattern, (r.flags || '').replace(/[^dgimsuy]/g, '')); } catch (e) { this.showToast('التعبير الناتج غير صالح: ' + e.message, 'error'); return null; }
        const literal = intel.isPy(c.path) ? `r"${r.pattern.replace(/"/g, '\\"')}"` : `/${r.pattern.replace(/(^|[^\\])\//g, '$1\\/')}/${(r.flags || '').replace(/[^dgimsuy]/g, '')}`;
        c.ctl.insertAtCursor(literal);
        c.ctl.focus();
        if (r.explanation) this.showToast(r.explanation.slice(0, 200), 'info');
        return { ...r, literal };
    };
    P.aiConvertToTS = async function () {
        const c = this.editorContext();
        if (!c) return null;
        if (!/^(js|jsx|mjs|cjs)$/.test(intel.extOf(c.path))) { this.showToast('افتح ملف JavaScript أولاً', 'info'); return null; }
        running(this, 'التحويل إلى TypeScript');
        let out;
        try { out = await this.editorAI(`Convert this JavaScript file to strict, idiomatic TypeScript: add precise types/interfaces (infer from usage and JSDoc), keep behaviour. Return ONLY the code in one fenced block.\n\n${fence('javascript', c.text.slice(0, 30000))}`, { maxTokens: 4000 }); } catch (e) { this.showToast(e.message, 'error'); return null; }
        if (out == null) return null;
        const target = this.uniqueProjectPath(c.path.replace(/\.(m|c)?js$/, '.ts').replace(/\.jsx$/, '.tsx'));
        this.createProjectFile(target, this.extractCodeFromAI(out) + '\n', { open: true, reason: 'ai-convert' });
        this.showToast(`تم إنشاء ${target}`, 'success');
        return target;
    };
    P.aiJSDocTypes = async function () {
        const c = this.editorContext();
        if (!c) return null;
        running(this, 'توليد Types من JSDoc');
        let out;
        try { out = await this.editorAI(`Generate a TypeScript declaration file (.d.ts) for this module from its JSDoc comments and code. Export every public function/class/constant with precise types. Return ONLY the .d.ts content in one fenced block.\n\n${fence(c.language, c.text.slice(0, 30000))}`, { maxTokens: 3000 }); } catch (e) { this.showToast(e.message, 'error'); return null; }
        if (out == null) return null;
        const target = this.uniqueProjectPath(c.path.replace(/\.[^./]+$/, '') + '.d.ts');
        this.createProjectFile(target, this.extractCodeFromAI(out) + '\n', { open: true, reason: 'ai-types' });
        this.showToast(`تم إنشاء ${target}`, 'success');
        return target;
    };
    P.aiSplitFileSuggest = async function () {
        const c = this.editorContext();
        if (!c) return null;
        const syms = intel.extractSymbols(c.text, c.path).map(s => `${s.kind} ${s.name} (line ${s.line})`).join('\n');
        this.showDialog({ title: 'اقتراح تقسيم الملف', body: '<div id="ai-split-body" class="md-body" dir="auto"><span class="live-step-spinner"></span> جاري التحليل...</div>', buttons: [{ label: 'إغلاق', value: null }] });
        let out = null;
        try { out = await this.editorAI(`هذا الملف كبير (${c.line && c.ctl.lineCount()} سطر). اقترح بالعربية تقسيمه إلى وحدات/ملفات أصغر: أسماء الملفات المقترحة، ما ينتقل لكل ملف، والاستيرادات اللازمة. كن عملياً ومختصراً.\n\nالملف ${c.path} — الرموز:\n${syms.slice(0, 6000)}\n\nبداية الملف:\n${fence(c.language, c.text.slice(0, 12000))}`, { maxTokens: 1500 }); } catch (e) { out = '❌ ' + e.message; }
        const el = document.getElementById('ai-split-body');
        if (el) el.innerHTML = out == null ? 'يلزم مفتاح OpenRouter' : (this.renderMarkdownSafe ? this.renderMarkdownSafe(out) : esc(out));
        return out;
    };
    /** Ask the AI to fix the file given an error, show a before/after diff and apply (#178, #179). */
    P.aiFixCode = async function (errorText, path = this.activeStudioFile) {
        const f = this.virtualProjectFiles.get(path);
        if (!f || typeof f.content !== 'string') return null;
        running(this, 'الذكاء الاصطناعي يبحث عن إصلاح');
        let out;
        try { out = await this.editorAI(`This file fails with the error below. Fix the root cause with minimal changes. Return ONLY the complete corrected file in one fenced code block.\n\nError:\n${String(errorText).slice(0, 4000)}\n\nFile ${path}:\n${fence(intel.extOf(path), f.content.slice(0, 40000))}`, { maxTokens: 6000 }); } catch (e) { this.showToast(e.message, 'error'); return null; }
        if (out == null) return null;
        let code = this.extractCodeFromAI(out);
        if (f.content.endsWith('\n') && !code.endsWith('\n')) code += '\n';
        if (!(await this.showDiffApply(`إصلاح مقترح — ${path}`, f.content, code, { okLabel: 'تطبيق الإصلاح' }))) return null;
        const before = this.applyFileUpdates([{ path, content: code }], 'ai-fix');
        this.showActionToast('تم تطبيق الإصلاح', 'تراجع', () => this.restoreFileContents(before), 'success');
        return code;
    };

    // ------------------------------------------------------------------ INLINE COMPLETION (#211)
    P.toggleInlineAI = function (force) {
        const on = force !== undefined ? !!force : !this.getEditorSettings().inlineAI;
        if (on && !this.hasAIKey()) { this.showToast('يلزم مفتاح OpenRouter لتفعيل الاقتراحات المضمنة', 'warning'); return false; }
        this.setEditorSettings({ inlineAI: on });
        this.showToast(on ? 'اقتراحات AI المضمنة: مفعلة (Tab للقبول، Esc للرفض)' : 'اقتراحات AI المضمنة: معطلة', 'info');
        return on;
    };
    P.cleanInlineSuggestion = function (text, prefix, suffix) {
        let t = String(text || '');
        const m = /```[\w+#.-]*\n?([\s\S]*?)(?:```|$)/.exec(t);
        if (m && /```/.test(t)) t = m[1];
        t = t.replace(/<\/?CURSOR>/g, '');
        const lastLine = prefix.slice(prefix.lastIndexOf('\n') + 1);
        if (lastLine.trim() && t.startsWith(lastLine)) t = t.slice(lastLine.length);
        // drop overlap with the text that already follows the cursor
        const head = suffix.replace(/^\s+/, '').slice(0, 60);
        if (head) { const k = t.indexOf(head); if (k > 0) t = t.slice(0, k); }
        const lines = t.split('\n');
        if (lines.length > 8) t = lines.slice(0, 8).join('\n');
        return t.replace(/\s+$/, '') && t.trim() ? t.replace(/[ \t]+$/, '') : '';
    };
    P.aiInlineSuggest = async function ({ prefix, suffix, path, language }) {
        if (!this.hasAIKey() || (this.isDataSaver && this.isDataSaver())) return null;
        const key = path + '|' + prefix.slice(-400) + '|' + suffix.slice(0, 100);
        this._inlineCache = this._inlineCache || new Map();
        if (this._inlineCache.has(key)) return this._inlineCache.get(key);
        if (this._inlineAbort) { try { this._inlineAbort.abort(); } catch (e) { /* ignore */ } }
        const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
        this._inlineAbort = ac;
        const prompt = `You are a code completion engine (like GitHub Copilot). Continue the code at <CURSOR> in ${path} (${language}). Reply with ONLY the exact text to insert at the cursor — no markdown fences, no explanations, never repeat code that is already before or after the cursor. At most 8 lines. If no completion makes sense reply with nothing.\n\n${prefix.slice(-3500)}<CURSOR>${suffix.slice(0, 1200)}`;
        let out;
        try { out = await this.editorAI(prompt, { maxTokens: 180, signal: ac && ac.signal, quiet: true, source: 'inline', kind: 'inline' }); } catch (e) { return null; }
        if (this._inlineAbort === ac) this._inlineAbort = null;
        const text = this.cleanInlineSuggestion(out, prefix, suffix);
        this._inlineCache.set(key, text);
        if (this._inlineCache.size > 40) this._inlineCache.delete(this._inlineCache.keys().next().value);
        return text;
    };

    P.openEditorAIMenu = function (anchor) {
        const s = this.getEditorSettings();
        this.showMenu([
            { icon: 'fa-pen-to-square', label: 'تعديل بتعليمات', kbd: 'Ctrl+I', run: () => this.aiEditSelection() },
            { icon: 'fa-circle-question', label: 'اشرح الكود', kbd: 'Ctrl+Alt+E', run: () => this.aiExplainSelection() },
            { icon: 'fa-arrow-trend-up', label: 'حسّن السطر/التحديد', run: () => this.aiAction('improve') },
            { icon: 'fa-feather', label: 'بسّط الكود المعقد', run: () => this.aiAction('simplify') },
            { icon: 'fa-wand-magic', label: 'أكمل الدالة', run: () => this.aiAction('complete') },
            { icon: 'fa-comment-dots', label: 'أضف تعليقات', run: () => this.aiAction('comment') },
            { icon: 'fa-bug', label: 'اكشف الأخطاء قبل التشغيل', run: () => this.aiDetectBugs() },
            { icon: 'fa-flask-vial', label: 'ولّد اختبارات', run: () => this.aiGenerateTests() },
            { icon: 'fa-language', label: 'ترجم إلى لغة أخرى', run: () => this.aiTranslate() },
            { icon: 'fa-asterisk', label: 'وصف ← Regex', run: () => this.aiRegex() },
            { icon: 'fa-file-code', label: 'JavaScript ← TypeScript', run: () => this.aiConvertToTS() },
            { icon: 'fa-font', label: 'Types من JSDoc (.d.ts)', run: () => this.aiJSDocTypes() },
            { icon: 'fa-scissors', label: 'اقتراح تقسيم الملف', run: () => this.aiSplitFileSuggest() },
            '-',
            { icon: s.inlineAI ? 'fa-toggle-on' : 'fa-toggle-off', label: s.inlineAI ? 'إيقاف الاقتراحات المضمنة' : 'تفعيل الاقتراحات المضمنة (Copilot)', run: () => this.toggleInlineAI() }
        ], anchor);
    };
}
