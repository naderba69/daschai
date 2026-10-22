/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 6: Code Studio (lazy ESM chunk)
   Loaded on demand by src/features/11-studio.js; patches the app prototype.
   Mounts CodeMirror 6 over the legacy <textarea> while keeping its API
   (value / selectionStart / setSelectionRange / setRangeText / focus) so every
   existing caller keeps working.
   ============================================================================== */
import { createEditor, DEFAULT_SETTINGS, THEMES, COMMANDS, languageCount, languageNames, findLanguage, toHex, tokenAt } from './editor-core.js';
import * as intel from './code-intel.js';
import { installRefactor } from './studio-refactor.js';
import { installAI } from './studio-ai.js';
import { installUI } from './studio-ui.js';
import STUDIO_CSS from './studio.css';

export const SETTINGS_KEY = 'ox_alpha_editor_v2';
export const FONTS = ['JetBrains Mono', 'Fira Code', 'Source Code Pro', 'IBM Plex Mono', 'Roboto Mono', 'Ubuntu Mono', 'Inconsolata', 'Space Mono', 'Noto Sans Mono'];
export const PRESETS = {
    beginner: { label: 'مبتدئ', desc: 'خط كبير، التفاف، تلميحات وفحص أخطاء واضح، بدون اختصارات متقدمة', settings: { fontSize: 15, lineHeight: 1.75, wrap: true, minimap: false, keymap: 'default', errorLens: true, hoverInfo: true, autocomplete: true, inlineAI: false, bracketColors: true, indentGuides: true, whitespace: false, formatOnSave: true, lineNumbers: 'on' } },
    expert: { label: 'محترف', desc: 'خط مضغوط، خريطة مصغرة، أرقام نسبية، اقتراحات AI مضمّنة', settings: { fontSize: 12, lineHeight: 1.5, wrap: false, minimap: true, errorLens: true, hoverInfo: true, autocomplete: true, inlineAI: true, bracketColors: true, indentGuides: true, whitespace: true, formatOnSave: true, lineNumbers: 'relative' } },
    minimal: { label: 'بسيط', desc: 'محرر هادئ بلا زخارف', settings: { minimap: false, errorLens: false, bracketColors: false, indentGuides: false, whitespace: false, colorSwatches: false, hoverInfo: false, inlineAI: false, lineNumbers: 'off' } }
};
export const TOOLBAR_ITEMS = [
    { id: 'format', icon: 'fa-align-left', label: 'تنسيق', title: 'تنسيق بـ Prettier (Shift+Alt+F)', run: 'formatStudioCode' },
    { id: 'wrap', icon: 'fa-text-width', label: 'التفاف', title: 'التفاف الأسطر (Alt+W)', run: 'toggleStudioWrap' },
    { id: 'fontUp', text: 'A+', title: 'تكبير الخط', run: 'changeStudioFont', args: [1] },
    { id: 'fontDown', text: 'A-', title: 'تصغير الخط', run: 'changeStudioFont', args: [-1] },
    { id: 'run', icon: 'fa-play', label: 'تشغيل', title: 'تشغيل الملف (Ctrl+Enter) — التحديد: Shift+Enter', run: 'runStudioCode' },
    { id: 'tests', icon: 'fa-flask', label: 'اختبارات', title: 'تشغيل الاختبارات', run: 'runTests' },
    { id: 'preview', icon: 'fa-eye', label: 'معاينة', title: 'معاينة حية (Ctrl+Alt+V)', run: 'togglePreview' },
    { id: 'split', icon: 'fa-table-columns', title: 'تقسيم المحرر (Ctrl+\\)', run: 'toggleSplitEditor' },
    { id: 'ai', icon: 'fa-wand-magic-sparkles', label: 'ذكاء', title: 'إجراءات الذكاء الاصطناعي (Ctrl+I للتعديل)', menu: 'openEditorAIMenu' },
    { id: 'tools', icon: 'fa-screwdriver-wrench', label: 'أدوات', title: 'أدوات الكود', menu: 'openEditorToolsMenu' },
    { id: 'minimap', icon: 'fa-map', title: 'الخريطة المصغرة (Ctrl+Alt+L)', run: 'toggleMinimap' },
    { id: 'macro', icon: 'fa-circle-dot', title: 'تسجيل ماكرو (Ctrl+Alt+R) — تشغيل: Ctrl+Alt+P', run: 'toggleMacroRecording' },
    { id: 'zen', icon: 'fa-expand', title: 'وضع التركيز (Ctrl+Alt+Z)', run: 'toggleEditorZen' },
    { id: 'download', icon: 'fa-download', title: 'تحميل الملف', run: 'downloadStudioFile' },
    { id: 'settings', icon: 'fa-sliders', title: 'إعدادات المحرر', run: 'openEditorSettings' }
];
export const DEFAULT_TOOLBAR = ['format', 'run', 'ai', 'tools', 'preview', 'split', 'wrap', 'fontUp', 'fontDown', 'zen', 'settings'];

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtBytes = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';

export function install(app) {
    const P = Object.getPrototypeOf(app);
    if (P.__oxStudio) return P.__oxStudio;
    const ctx = { intel, THEMES, DEFAULT_SETTINGS, COMMANDS, FONTS, PRESETS, TOOLBAR_ITEMS, DEFAULT_TOOLBAR, createEditor, languageCount, languageNames, findLanguage, toHex, tokenAt, esc, fmtBytes };
    P.__oxStudio = ctx;
    if (typeof document !== 'undefined' && !document.getElementById('ox-studio-css')) { const st = document.createElement('style'); st.id = 'ox-studio-css'; st.textContent = STUDIO_CSS; document.head.appendChild(st); }
    P.codeIntel = intel;
    P.editorThemes = THEMES;

    // ------------------------------------------------------------------ SETTINGS (#139-#141, #193-#199, #257-#270)
    P.getEditorSettings = function () {
        if (this._edSettings) return this._edSettings;
        let s = null;
        try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (e) { s = null; }
        if (!s || typeof s !== 'object') {
            s = {};
            try {
                const f = parseFloat(localStorage.getItem('ox_alpha_editor_font') || '0');
                if (f) s.fontSize = f;
                if (localStorage.getItem('ox_alpha_editor_wrap') === '1') s.wrap = true;
            } catch (e) { /* storage blocked */ }
        }
        this._edSettings = { ...DEFAULT_SETTINGS, ...s, keybindings: { ...((s && s.keybindings) || {}) } };
        if (!THEMES[this._edSettings.theme]) this._edSettings.theme = 'ox';
        return this._edSettings;
    };
    P.setEditorSettings = function (patch = {}) {
        const next = { ...this.getEditorSettings(), ...patch };
        if (!('preset' in patch)) next.preset = 'custom';
        this._edSettings = next;
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (e) { /* quota */ }
        this.applyEditorSettings();
        return next;
    };
    P.applyEditorPreset = function (id) {
        const p = PRESETS[id];
        if (!p) return null;
        const s = this.setEditorSettings({ ...p.settings, preset: id });
        this.showToast(`تم تطبيق إعداد «${p.label}»`, 'success');
        return s;
    };
    P.resetEditorSettings = function () {
        this._edSettings = null;
        try { localStorage.removeItem(SETTINGS_KEY); localStorage.removeItem('ox_alpha_editor_font'); localStorage.removeItem('ox_alpha_editor_wrap'); } catch (e) { /* ignore */ }
        this.applyEditorSettings();
    };
    P.applyEditorSettings = function () {
        const s = this.getEditorSettings();
        this.ensureEditorFont(s.fontFamily);
        if (this.codeEditor) this.codeEditor.configure(s);
        if (this._splitEditor) this._splitEditor.ctl.configure(s);
        this._studioFont = s.fontSize;
        const ta = document.getElementById('studio-editor-textarea');
        if (ta) ta.classList.toggle('wrap', !!s.wrap);
        this.renderEditorToolbar();
        this.updateEditorChrome();
    };
    P.ensureEditorFont = function (name) {
        if (!name || name === 'JetBrains Mono' || !FONTS.includes(name)) return false;
        const id = 'ox-font-' + name.replace(/\W+/g, '-').toLowerCase();
        if (document.getElementById(id)) return true;
        const l = document.createElement('link');
        l.id = id; l.rel = 'stylesheet';
        l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}:wght@400;500;600&display=swap`;
        document.head.appendChild(l);
        return true;
    };
    P.exportEditorSettings = function () { return JSON.stringify({ app: 'ox-alpha-editor', version: 2, settings: this.getEditorSettings(), macros: this.getMacros() }, null, 2); };
    P.importEditorSettings = function (text) {
        const data = typeof text === 'string' ? intel.parseJSONC(text) : text;
        if (!data || typeof data !== 'object') throw new Error('ملف إعدادات غير صالح');
        const s = data.settings || data;
        const clean = {};
        Object.keys(DEFAULT_SETTINGS).forEach(k => { if (k in s) clean[k] = s[k]; });
        if (clean.theme && !THEMES[clean.theme]) delete clean.theme;
        this.setEditorSettings(clean);
        if (Array.isArray(data.macros)) this.saveMacros(data.macros);
        return Object.keys(clean).length;
    };
    P.importVSCodeSettings = function (text) {
        const r = intel.fromVSCodeSettings(text, Object.keys(THEMES));
        if (Object.keys(r.settings).length) this.setEditorSettings(r.settings);
        return r;
    };
    P.importVSCodeKeybindings = function (text) {
        const kb = intel.fromVSCodeKeybindings(text);
        const n = Object.keys(kb).length;
        if (n) this.setEditorSettings({ keybindings: { ...this.getEditorSettings().keybindings, ...kb } });
        return n;
    };

    // ------------------------------------------------------------------ MOUNT + TEXTAREA ADAPTER (#131)
    P.editorCallbacks = function () {
        return {
            onChange: (text, path) => this.onCodeEditorChange(text, path),
            onCursor: () => this.scheduleEditorChrome(),
            onLanguage: () => this.scheduleEditorChrome(),
            onFocus: (focused) => {
                const ta = document.getElementById('studio-editor-textarea');
                if (ta) ta.dispatchEvent(new FocusEvent(focused ? 'focusin' : 'focusout', { bubbles: true }));
            },
            hover: (info) => this.editorHover(info),
            completions: (prefix, path) => this.editorCompletions(prefix, path),
            lint: (doc, path) => this.lintForEditor(doc, path),
            inlineSuggest: (c) => this.aiInlineSuggest(c),
            command: (name, arg) => this.editorCommand(name, arg)
        };
    };
    P.mountCodeEditor = function () {
        const ta = document.getElementById('studio-editor-textarea');
        if (!ta) return null;
        if (this.codeEditor && ta.__cm === this.codeEditor && document.body.contains(this.codeEditor.dom)) {
            const p = this.activeStudioFile;
            if (p && p !== this.codeEditor.getPath()) { const f = this.virtualProjectFiles.get(p); this.codeEditor.openFile(p, f ? f.content || '' : ''); }
            return this.codeEditor;
        }
        const wrapper = ta.parentElement;
        const host = document.createElement('div');
        host.className = 'ox-cm';
        host.id = 'studio-cm-host';
        wrapper.insertBefore(host, ta.nextSibling);
        const nativeValue = ta.value;
        const s = this.getEditorSettings();
        this.ensureEditorFont(s.fontFamily);
        const ctl = createEditor({ parent: host, doc: nativeValue, path: this.activeStudioFile || 'untitled.txt', settings: s, callbacks: this.editorCallbacks() });
        this.codeEditor = ctl;
        this.installTextareaAdapter(ta, ctl);
        wrapper.classList.add('cm-active');
        this._studioFont = s.fontSize;
        this.renderEditorToolbar();
        this.updateEditorChrome();
        return ctl;
    };
    P.installTextareaAdapter = function (ta, ctl) {
        const app = this;
        const def = (name, get, set) => Object.defineProperty(ta, name, { configurable: true, enumerable: true, get, set });
        def('value', () => ctl.getValue(), (v) => {
            const p = app.activeStudioFile || ctl.getPath();
            if (p !== ctl.getPath()) ctl.openFile(p, v);
            else ctl.setValue(v);
            if (app._splitEditor && app._splitEditor.ctl.getPath() === p) app._splitEditor.ctl.setValue(v);
        });
        def('selectionStart', () => ctl.getSelection().from, (v) => { const s = ctl.getSelection(); ctl.setSelection(v, Math.max(v, s.to), { scroll: false }); });
        def('selectionEnd', () => ctl.getSelection().to, (v) => { const s = ctl.getSelection(); ctl.setSelection(Math.min(s.from, v), v, { scroll: false }); });
        def('scrollTop', () => ctl.scrollTop, () => { /* CodeMirror scrolls the selection into view itself */ });
        ta.setSelectionRange = (a, b) => ctl.setSelection(a, b == null ? a : b);
        ta.select = () => ctl.setSelection(0, ctl.getValue().length, { scroll: false });
        ta.focus = () => ctl.focus();
        ta.blur = () => ctl.view.contentDOM.blur();
        ta.setRangeText = (text, start, end, mode = 'preserve') => {
            const sel = ctl.getSelection();
            if (start == null) { start = sel.from; end = sel.to; }
            const delta = text.length - (end - start);
            let a, b;
            if (mode === 'select') { a = start; b = start + text.length; }
            else if (mode === 'start') { a = b = start; }
            else if (mode === 'end') { a = b = start + text.length; }
            else {
                const adj = (p) => p <= start ? p : p >= end ? p + delta : start;
                a = adj(sel.from); b = adj(sel.to);
            }
            ctl.replaceRange(start, end, text, a, b);
        };
        ta.__cm = ctl;
    };
    P.onCodeEditorChange = function (text, path) {
        if (path !== this.activeStudioFile) {
            if (this.writeProjectFile && this.virtualProjectFiles.has(path)) this.writeProjectFile(path, text, 'edit');
            return;
        }
        const ta = document.getElementById('studio-editor-textarea');
        if (ta) ta.dispatchEvent(new Event('input', { bubbles: true }));
        else this.handleStudioCodeChange(text);
        if (this._splitEditor && this._splitEditor.ctl.getPath() === path && this._splitEditor.ctl.getValue() !== text) this._splitEditor.ctl.setValue(text);
        if (this._aiDiags && this._aiDiags.path === path && this._aiDiags.doc !== text) this._aiDiags = null;
        if (this.onStudioEdit) this.onStudioEdit(path, text);
        this.scheduleEditorChrome();
    };
    P.isCodeEditorActive = function () {
        return !!(this.codeEditor && document.body.contains(this.codeEditor.dom));
    };
    P.editorFiles = function () { return this.virtualProjectFiles; };

    // keep the textarea-era helpers working on top of CodeMirror
    const _origReplace = P.editorReplaceRange;
    P.editorReplaceRange = function (editor, start, end, text, selStart, selEnd) {
        if (editor && editor.__cm && editor.__cm === this.codeEditor) { this.codeEditor.replaceRange(start, end, text, selStart, selEnd); this.codeEditor.focus(); return true; }
        return _origReplace ? _origReplace.apply(this, arguments) : false;
    };
    const _origWrap = P.toggleStudioWrap;
    P.toggleStudioWrap = function () {
        if (!this.isCodeEditorActive()) return _origWrap && _origWrap.apply(this, arguments);
        const on = !this.getEditorSettings().wrap;
        this.setEditorSettings({ wrap: on });
        this.showToast(on ? 'التفاف الأسطر: مفعل' : 'التفاف الأسطر: معطل', 'info');
        return on;
    };
    const _origFont = P.applyStudioFont;
    P.applyStudioFont = function (px) {
        if (!this.isCodeEditorActive()) return _origFont && _origFont.apply(this, arguments);
        px = Math.min(32, Math.max(9, +px || 13));
        this._studioFont = px;
        if (this.getEditorSettings().fontSize !== px) this.setEditorSettings({ fontSize: px });
    };
    const _origChangeFont = P.changeStudioFont;
    P.changeStudioFont = function (delta) {
        if (!this.isCodeEditorActive()) return _origChangeFont && _origChangeFont.apply(this, arguments);
        this.applyStudioFont((this.getEditorSettings().fontSize || 13) + delta);
    };
    P.toggleMinimap = function () {
        const on = !this.getEditorSettings().minimap;
        this.setEditorSettings({ minimap: on });
        return on;
    };
    const _origInsertSymbol = P.insertSymbol;
    P.insertSymbol = function (sym) {
        if (this.isCodeEditorActive() && this._symTarget && this._symTarget.__cm === this.codeEditor) {
            const ctl = this.codeEditor;
            if (sym === 'Tab') ctl.runCommand('indentMore') || ctl.insertAtCursor('  ');
            else ctl.typeText(sym);
            ctl.focus();
            if (this.haptic) this.haptic(5);
            return true;
        }
        return _origInsertSymbol ? _origInsertSymbol.apply(this, arguments) : false;
    };

    // ------------------------------------------------------------------ SAVE (#201 autosave is 1s in 06-files, Ctrl+S here)
    P.saveStudioFile = async function () {
        const ctl = this.codeEditor;
        const s = this.getEditorSettings();
        if (ctl) {
            if (s.formatOnSave && this.prettierParserFor && this.prettierParserFor(this.activeStudioFile)) await this.formatStudioCode({ quiet: true });
            if (s.trimOnSave) this.trimTrailingWhitespace({ quiet: true });
            this.handleStudioCodeChange(ctl.getValue());
        }
        if (this.saveProjectNow) await this.saveProjectNow();
        this.showToast(`تم حفظ ${this.activeStudioFile} محلياً 💾 (استخدم Commit للرفع إلى GitHub)`, 'success');
        return true;
    };

    // ------------------------------------------------------------------ COMMAND DISPATCH
    P.editorCommand = function (name, arg) {
        const map = {
            save: () => this.saveStudioFile(),
            format: () => this.formatStudioCode(),
            toggleWrap: () => this.toggleStudioWrap(),
            gotoDefinition: () => this.gotoDefinition(arg && arg.word),
            findReferences: () => this.findReferences(),
            renameSymbol: () => this.renameSymbol(),
            aiEdit: () => this.aiEditSelection(),
            aiExplain: () => this.aiExplainSelection(),
            runFile: () => this.runStudioCode(),
            runSelection: () => this.runStudioSelection(),
            zen: () => this.toggleEditorZen(),
            macroToggle: () => this.toggleMacroRecording(),
            macroPlay: () => this.playLastMacro(),
            togglePreview: () => this.togglePreview(),
            splitEditor: () => this.toggleSplitEditor(),
            toggleMinimap: () => this.toggleMinimap()
        };
        if (map[name]) return map[name]();
        if (COMMANDS[name] && this.codeEditor) return this.codeEditor.runCommand(name);
        if (typeof this[name] === 'function') return this[name](arg);
        return undefined;
    };
    P.editorToolbar = function (id, btn) {
        const it = TOOLBAR_ITEMS.find(x => x.id === id);
        if (!it) return;
        if (it.menu) return this[it.menu](btn);
        if (typeof this[it.run] === 'function') return this[it.run](...(it.args || []));
    };
    P.renderEditorToolbar = function () {
        const bar = document.querySelector('#code-studio-pane .editor-toolbar');
        if (!bar || !this.codeEditor) return;
        const s = this.getEditorSettings();
        const ids = Array.isArray(s.toolbar) && s.toolbar.length ? s.toolbar : DEFAULT_TOOLBAR;
        const on = { wrap: s.wrap, minimap: s.minimap, macro: this.codeEditor.isRecording(), zen: document.body.classList.contains('editor-zen'), split: !!this._splitEditor, preview: !!this._previewOpen };
        bar.classList.add('cm-toolbar');
        bar.innerHTML = ids.map(id => TOOLBAR_ITEMS.find(x => x.id === id)).filter(Boolean).map(it =>
            `<button type="button" data-tb="${it.id}" class="${on[it.id] ? 'active' : ''}" onclick="app.editorToolbar('${it.id}', this)" title="${esc(it.title)}" aria-label="${esc(it.title)}">${it.icon ? `<i class="fa-solid ${it.icon}" aria-hidden="true"></i>` : ''}${it.text ? esc(it.text) : ''}${it.label ? ` <span class="tb-label">${esc(it.label)}</span>` : ''}</button>`
        ).join('') + `<span class="cm-toolbar-hint" dir="ltr">F12 • Shift+F12 • F2 • Ctrl+I • Ctrl+Space</span>`;
    };

    // ------------------------------------------------------------------ STATUS BAR (#252-#254, #189)
    P.scheduleEditorChrome = function () {
        if (this._chromeTimer) return;
        this._chromeTimer = setTimeout(() => { this._chromeTimer = null; this.updateEditorChrome(); }, 60);
    };
    const _origChrome = P.updateEditorChrome;
    P.updateEditorChrome = function () {
        if (!this.isCodeEditorActive()) return _origChrome ? _origChrome.apply(this, arguments) : undefined;
        const status = document.getElementById('editor-statusbar');
        if (!status) return;
        const ctl = this.codeEditor, s = this.getEditorSettings();
        const text = ctl.getValue();
        const sel = ctl.getSelection();
        const line = ctl.lineAt(sel.head);
        const st = intel.fileStats(text);
        const selLen = sel.ranges.reduce((n, r) => n + (r.to - r.from), 0);
        const diags = ctl.diagnostics();
        const errs = diags.filter(d => d.severity === 'error').length, warns = diags.filter(d => d.severity === 'warning').length;
        const cx = this.editorComplexity(this.activeStudioFile, text);
        const eol = /\r\n/.test(text) ? 'CRLF' : 'LF';
        const lang = ctl.languageName() || intel.extOf(this.activeStudioFile).toUpperCase() || 'Text';
        status.classList.add('cm-status');
        status.innerHTML = [
            `<span class="sb-pos">سطر ${line.number}، عمود ${sel.head - line.from + 1}</span>`,
            selLen ? `<span class="sb-sel">${sel.ranges.length > 1 ? sel.ranges.length + ' مؤشرات، ' : ''}${selLen} حرف محدد</span>` : '',
            `<span title="${st.chars} حرف">${st.lines} سطر</span>`,
            `<span>${st.words} كلمة</span>`,
            `<span title="حجم الملف">${fmtBytes(st.bytes)}</span>`,
            cx != null ? `<span title="التعقيد الدوري التقريبي (Cyclomatic)" class="${cx > 30 ? 'sb-warn' : ''}"><i class="fa-solid fa-diagram-project"></i> ${cx}</span>` : '',
            `<button type="button" class="sb-btn ${errs ? 'sb-err' : warns ? 'sb-warn' : ''}" onclick="app.editorCommand('openLintPanel')" title="المشاكل"><i class="fa-solid fa-circle-xmark"></i> ${errs} <i class="fa-solid fa-triangle-exclamation"></i> ${warns}</button>`,
            st.lines > 400 ? `<button type="button" class="sb-btn sb-warn" onclick="app.aiSplitFileSuggest()" title="الملف كبير — اقتراح تقسيمه بالذكاء الاصطناعي"><i class="fa-solid fa-scissors"></i> ملف كبير</button>` : '',
            ctl.isRecording() ? '<span class="sb-rec">● REC</span>' : '',
            s.keymap !== 'default' ? `<span class="sb-mode">${esc(s.keymap.toUpperCase())}</span>` : '',
            s.inlineAI ? '<span title="اقتراحات AI المضمنة مفعلة"><i class="fa-solid fa-wand-magic-sparkles"></i></span>' : '',
            `<span>Spaces: ${s.tabSize}</span>`, `<span>UTF-8</span>`, `<span>${eol}</span>`,
            `<button type="button" class="sb-btn sb-lang" onclick="app.openEditorSettings()" title="${languageCount()} لغة مدعومة">${esc(lang)}</button>`
        ].filter(Boolean).join('');
    };
    P.editorComplexity = function (path, text) {
        if (!this.analyzeFile || !path || !intel.isCodeFile(path) || text.length > 400000) return null;
        const key = path + ':' + text.length;
        if (this._cxCache && this._cxCache.key === key) return this._cxCache.value;
        if (!this._cxTimer) {
            this._cxTimer = setTimeout(() => {
                this._cxTimer = null;
                try { const r = this.analyzeFile(path, this.codeEditor ? this.codeEditor.getValue() : text); this._cxCache = { key: path + ':' + (this.codeEditor ? this.codeEditor.getValue().length : text.length), value: r ? r.complexity : null }; } catch (e) { this._cxCache = { key, value: null }; }
                this.scheduleEditorChrome();
            }, 500);
        }
        return this._cxCache && this._cxCache.key.startsWith(path + ':') ? this._cxCache.value : null;
    };

    // ------------------------------------------------------------------ ZEN (#200)
    P.toggleEditorZen = function (force) {
        if (!this.isCodeStudioOpen) this.toggleCodeStudio(true);
        const on = force !== undefined ? !!force : !document.body.classList.contains('editor-zen');
        document.body.classList.toggle('editor-zen', on);
        if (on && !this._zenKey) {
            this._zenKey = (e) => { if (e.key === 'Escape' && document.body.classList.contains('editor-zen') && !document.querySelector('.cm-panel, .cm-tooltip-autocomplete')) this.toggleEditorZen(false); };
            window.addEventListener('keydown', this._zenKey);
        }
        if (this.codeEditor) setTimeout(() => { this.codeEditor.view.requestMeasure(); this.codeEditor.focus(); }, 30);
        this.renderEditorToolbar();
        if (on) this.showToast('وضع التركيز — Esc للخروج', 'info');
        return on;
    };

    installRefactor(P, ctx);
    installAI(P, ctx);
    installUI(P, ctx);
    return ctx;
}

export { intel, THEMES, DEFAULT_SETTINGS, COMMANDS };
