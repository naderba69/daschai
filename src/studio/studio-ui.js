/* ==============================================================================
   Sprint 6 — editor UI: settings panel (#196-#199, #206, #207, #210, #259-#261,
   #265-#268), customizable shortcuts (#251), macros record/play/save/share/import
   (#252-#256), toolbar customization (#257), split editor (#137), tools menu,
   CSV → JSON (#190), ESLint auto-fix (#141)
   ============================================================================== */
const MACROS_KEY = 'ox_alpha_macros_v1';
export const APP_COMMANDS = {
    save: 'حفظ', format: 'تنسيق (Prettier)', toggleWrap: 'التفاف الأسطر', gotoDefinition: 'الانتقال إلى التعريف', findReferences: 'إظهار الاستخدامات',
    renameSymbol: 'إعادة تسمية الرمز', aiEdit: 'تعديل بالذكاء الاصطناعي', aiExplain: 'شرح بالذكاء الاصطناعي', runFile: 'تشغيل الملف', runSelection: 'تشغيل التحديد',
    zen: 'وضع التركيز', macroToggle: 'تسجيل ماكرو', macroPlay: 'تشغيل آخر ماكرو', togglePreview: 'المعاينة الحية', splitEditor: 'تقسيم المحرر', toggleMinimap: 'الخريطة المصغرة'
};
export const DEFAULT_KEYS = {
    save: 'Mod-s', format: 'Shift-Alt-f', toggleWrap: 'Alt-w', gotoDefinition: 'F12', findReferences: 'Shift-F12', renameSymbol: 'F2', aiEdit: 'Mod-i', aiExplain: 'Mod-Alt-e',
    runFile: 'Mod-Enter', runSelection: 'Shift-Enter', zen: 'Mod-Alt-z', macroToggle: 'Mod-Alt-r', macroPlay: 'Mod-Alt-p', togglePreview: 'Mod-Alt-v', splitEditor: 'Mod-\\', toggleMinimap: 'Mod-Alt-l',
    toggleComment: 'Mod-/', selectNextOccurrence: 'Mod-d', openSearch: 'Mod-f', gotoLine: 'Mod-g'
};
/** CodeMirror key name from a keyboard event (null for lone modifiers). */
export function keyFromEvent(e) {
    if (!e || ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead'].includes(e.key)) return null;
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Mod');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    let k = e.key;
    if (k === ' ') k = 'Space';
    else if (k.length === 1) k = k.toLowerCase();
    parts.push(k);
    return parts.join('-');
}
/** Collapse consecutive typed characters into one step. */
export function compactSteps(steps) {
    const out = [];
    (steps || []).forEach(s => {
        const last = out[out.length - 1];
        if (s.t != null && last && last.t != null && !/\n/.test(last.t)) last.t += s.t;
        else out.push({ ...s });
    });
    return out;
}

export function installUI(P, ctx) {
    const { THEMES, FONTS, PRESETS, TOOLBAR_ITEMS, DEFAULT_TOOLBAR, COMMANDS, intel, esc, createEditor, languageCount } = ctx;
    P.editorKeyboardCommands = function () {
        return Object.entries(APP_COMMANDS).map(([id, label]) => ({ id, label, app: true })).concat(Object.entries(COMMANDS).map(([id, [label]]) => ({ id, label })));
    };

    // ------------------------------------------------------------------ SETTINGS PANEL
    const sel = (k, label, options, v) => `<label class="ed-field"><span>${label}</span><select class="form-input-box" data-k="${k}" onchange="app.editorSettingChange(this)">${options.map(([val, l]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    const chk = (k, label, v, hint = '') => `<label class="gh-check ed-check"><input type="checkbox" data-k="${k}" ${v ? 'checked' : ''} onchange="app.editorSettingChange(this)"> ${label}${hint ? ` <small class="hv-dim">${hint}</small>` : ''}</label>`;
    const rng = (k, label, v, min, max, step, unit = '') => `<label class="ed-field"><span>${label} <b data-out="${k}">${v}${unit}</b></span><input type="range" data-k="${k}" data-num="1" min="${min}" max="${max}" step="${step}" value="${v}" oninput="this.previousElementSibling.querySelector('b').textContent=this.value+'${unit}'" onchange="app.editorSettingChange(this)"></label>`;
    const txt = (k, label, v, ph = '') => `<label class="ed-field"><span>${label}</span><input class="form-input-box" dir="ltr" data-k="${k}" value="${esc(v || '')}" placeholder="${esc(ph)}" onchange="app.editorSettingChange(this)"></label>`;
    const TABS = [
        { id: 'appearance', icon: 'fa-palette', label: 'المظهر' }, { id: 'editor', icon: 'fa-keyboard', label: 'المحرر' }, { id: 'ai', icon: 'fa-wand-magic-sparkles', label: 'الذكاء' },
        { id: 'keys', icon: 'fa-command', label: 'الاختصارات' }, { id: 'toolbar', icon: 'fa-screwdriver-wrench', label: 'شريط الأدوات' }, { id: 'macros', icon: 'fa-circle-dot', label: 'الماكرو' }, { id: 'sync', icon: 'fa-right-left', label: 'استيراد/تصدير' }
    ];
    P.openEditorSettings = function (tab = this._edTab || 'appearance') {
        this._edTab = tab;
        this.openPanel({
            title: 'إعدادات المحرر', icon: 'fa-sliders',
            tabs: TABS.map(t => ({ ...t, onclick: `app.openEditorSettings('${t.id}')` })), activeTab: tab,
            body: `<div class="ed-settings">${this.renderEditorSettingsTab(tab)}</div>`,
            footer: `<span class="hv-dim">${languageCount()} لغة مدعومة • CodeMirror 6</span><span class="gh-spacer"></span><button class="sidebar-btn-util gh-btn" onclick="app.resetEditorSettings(); app.openEditorSettings()"><i class="fa-solid fa-rotate-left"></i> الافتراضي</button>`
        });
    };
    P.renderEditorSettingsTab = function (tab) {
        const s = this.getEditorSettings();
        if (tab === 'appearance') {
            return `<div class="ed-themes">${Object.entries(THEMES).map(([id, t]) => `<button type="button" class="ed-theme ${s.theme === id ? 'active' : ''}" onclick="app.setEditorSettings({theme:'${id}'}); app.openEditorSettings('appearance')" style="${t.vars ? '' : `background:${t.bg};color:${t.fg}`}"><span class="ed-theme-dots">${t.vars ? '' : [t.keyword, t.string, t.fn, t.number].map(c => `<i style="background:${c}"></i>`).join('')}</span>${esc(t.label)}</button>`).join('')}</div>
                <div class="ed-grid">
                ${sel('fontFamily', 'الخط', FONTS.map(f => [f, f]), s.fontFamily)}
                ${rng('fontSize', 'حجم الخط', s.fontSize, 9, 32, 1, 'px')}
                ${rng('lineHeight', 'تباعد الأسطر', s.lineHeight, 1.1, 2.6, 0.05)}
                ${sel('lineNumbers', 'أرقام الأسطر', [['on', 'عادية'], ['relative', 'نسبية'], ['off', 'مخفية']], s.lineNumbers)}
                ${sel('direction', 'اتجاه النص', [['auto', 'تلقائي لكل سطر'], ['ltr', 'LTR'], ['rtl', 'RTL']], s.direction)}
                </div>
                ${chk('ligatures', 'دمج الرموز Ligatures', s.ligatures, '=> != === (يتطلب خطاً يدعمها مثل Fira Code)')}
                ${chk('bracketColors', 'تلوين الأقواس المتزاوجة', s.bracketColors)}
                ${chk('indentGuides', 'خطوط المسافات البادئة', s.indentGuides)}
                ${chk('errorLens', 'Error Lens — رسالة الخطأ بجانب السطر', s.errorLens)}
                ${chk('whitespace', 'إظهار المسافات غير المرئية', s.whitespace)}
                ${chk('colorSwatches', 'معاينة الألوان واختيارها', s.colorSwatches)}
                ${chk('minimap', 'الخريطة المصغرة', s.minimap)}`;
        }
        if (tab === 'editor') {
            return `<div class="ed-presets">${Object.entries(PRESETS).map(([id, p]) => `<button type="button" class="gh-card ed-preset ${s.preset === id ? 'active' : ''}" onclick="app.applyEditorPreset('${id}'); app.openEditorSettings('editor')"><b>${esc(p.label)}</b><small>${esc(p.desc)}</small></button>`).join('')}</div>
                <div class="ed-grid">
                ${sel('keymap', 'نمط المفاتيح', [['default', 'افتراضي (VS Code)'], ['sublime', 'Sublime'], ['vim', 'Vim'], ['emacs', 'Emacs']], s.keymap)}
                ${sel('tabSize', 'حجم المسافة البادئة', [[2, '2'], [4, '4'], [8, '8']], s.tabSize)}
                </div>
                ${chk('wrap', 'التفاف الأسطر', s.wrap)}
                ${chk('autocomplete', 'الإكمال التلقائي (IntelliSense + رموز المشروع)', s.autocomplete)}
                ${chk('emmet', 'Emmet لـ HTML/CSS/JSX (Tab للتوسيع)', s.emmet)}
                ${chk('hoverInfo', 'معلومات عند التمرير (تعريفات، ألوان، صور، أيقونات، روابط)', s.hoverInfo)}
                ${chk('eslint', 'فحص ESLint حي لملفات JavaScript', s.eslint)}
                ${chk('formatOnSave', 'تنسيق بـ Prettier عند الحفظ', s.formatOnSave)}
                ${chk('trimOnSave', 'حذف المسافات الزائدة عند الحفظ', s.trimOnSave)}
                ${chk('updateImportsOnMove', 'تحديث الاستيرادات عند نقل/إعادة تسمية الملفات', s.updateImportsOnMove !== false)}`;
        }
        if (tab === 'ai') {
            return `${chk('inlineAI', 'اقتراحات AI مضمنة أثناء الكتابة (مثل Copilot) — Tab للقبول', s.inlineAI)}
                <div class="ed-grid">${rng('inlineDelay', 'التأخير قبل الاقتراح', s.inlineDelay, 300, 3000, 100, 'ms')}
                ${txt('inlineModel', 'نموذج الاقتراحات المضمنة (اختياري، يفضل سريع ورخيص)', s.inlineModel, 'مثال: google/gemini-2.0-flash-001')}
                ${txt('aiModel', 'نموذج إجراءات المحرر (اختياري)', s.aiModel, 'يُستخدم توجيه فئة البرمجة افتراضياً')}</div>
                <p class="hv-dim">الإجراءات: Ctrl+I تعديل • Ctrl+Alt+E شرح • قائمة «ذكاء» في الشريط • زر «اشرح هذا السطر» عند التمرير.</p>`;
        }
        if (tab === 'keys') {
            const inv = {};
            Object.entries(s.keybindings || {}).forEach(([k, c]) => { if (c) (inv[c] = inv[c] || []).push(k); });
            return `<p class="hv-dim">اضغط «تعيين» ثم الاختصار المطلوب. الاختصارات المخصصة لها الأولوية على الافتراضية.</p>
                <div class="ed-keys">${this.editorKeyboardCommands().map(c => `<div class="ed-key-row"><span>${esc(c.label)}</span><code dir="ltr" class="hv-dim">${esc(DEFAULT_KEYS[c.id] || '')}</code><span class="ed-key-custom">${(inv[c.id] || []).map(k => `<kbd dir="ltr">${esc(k)} <button type="button" title="إزالة" onclick="app.removeKeybinding('${esc(k).replace(/\\/g, '\\\\')}')">×</button></kbd>`).join(' ')}</span><button type="button" class="gh-btn" onclick="app.captureKeybinding('${c.id}', this)">تعيين</button></div>`).join('')}</div>
                <div class="gh-card"><b>استيراد keybindings.json من VS Code</b><textarea id="ed-vsc-keys" class="form-input-box" rows="4" dir="ltr" placeholder='[{"key":"ctrl+shift+k","command":"editor.action.deleteLines"}]'></textarea><button class="btn-new-thread gh-btn" onclick="app.importVSCodeKeysFromPanel()">استيراد</button></div>`;
        }
        if (tab === 'toolbar') {
            const ids = Array.isArray(s.toolbar) && s.toolbar.length ? s.toolbar : DEFAULT_TOOLBAR;
            const order = ids.concat(TOOLBAR_ITEMS.map(t => t.id).filter(id => !ids.includes(id)));
            return `<p class="hv-dim">اختر الأزرار الظاهرة ورتبها.</p><div class="ed-toolbar-list">${order.map((id, i) => { const t = TOOLBAR_ITEMS.find(x => x.id === id); return t ? `<div class="ed-tb-row"><label class="gh-check"><input type="checkbox" ${ids.includes(id) ? 'checked' : ''} onchange="app.toggleToolbarItem('${id}', this.checked)"> ${t.icon ? `<i class="fa-solid ${t.icon}"></i>` : esc(t.text)} ${esc(t.label || t.title)}</label><span class="gh-spacer"></span><button type="button" class="gh-btn" ${i === 0 ? 'disabled' : ''} onclick="app.moveToolbarItem('${id}', -1)">▲</button><button type="button" class="gh-btn" onclick="app.moveToolbarItem('${id}', 1)">▼</button></div>` : ''; }).join('')}</div>`;
        }
        if (tab === 'macros') {
            const list = this.getMacros();
            return `<div class="gh-toolbar"><button class="btn-new-thread gh-btn" onclick="app.closeModals(); app.toggleMacroRecording()"><i class="fa-solid fa-circle-dot"></i> ${this.codeEditor && this.codeEditor.isRecording() ? 'إيقاف التسجيل' : 'تسجيل جديد'} (Ctrl+Alt+R)</button><button class="gh-btn" onclick="app.copyText(app.exportMacros())"><i class="fa-solid fa-share-nodes"></i> نسخ الكل للمشاركة</button></div>
                ${list.length ? list.map(m => `<div class="gh-card ed-macro"><b>${esc(m.name)}</b> <small class="hv-dim">${m.steps.length} خطوة • ${new Date(m.created).toLocaleDateString('ar')}</small><span class="gh-spacer"></span>
                    <button class="gh-btn" title="تشغيل" onclick="app.closeModals(); app.playMacro('${m.id}')"><i class="fa-solid fa-play"></i></button>
                    <button class="gh-btn" title="تشغيل عدة مرات" onclick="app.playMacroTimes('${m.id}')">×N</button>
                    <button class="gh-btn" title="إعادة تسمية" onclick="app.renameMacro('${m.id}')"><i class="fa-solid fa-pen"></i></button>
                    <button class="gh-btn" title="نسخ للمشاركة" onclick="app.copyText(app.exportMacros(['${m.id}']))"><i class="fa-solid fa-copy"></i></button>
                    <button class="gh-btn danger" title="حذف" onclick="app.deleteMacro('${m.id}')"><i class="fa-solid fa-trash"></i></button></div>`).join('') : '<p class="gh-empty">لا توجد ماكرو محفوظة. سجّل سلسلة تعديلات ثم أعد تشغيلها بضغطة.</p>'}
                <div class="gh-card"><b>استيراد ماكرو (JSON)</b><textarea id="ed-macro-import" class="form-input-box" rows="3" dir="ltr"></textarea><button class="btn-new-thread gh-btn" onclick="app.importMacrosFromPanel()">استيراد</button></div>`;
        }
        // sync
        return `<div class="gh-card"><b>تصدير إعدادات المحرر</b><p class="hv-dim">الإعدادات + الاختصارات + الماكرو في ملف JSON واحد.</p><button class="btn-new-thread gh-btn" onclick="app.downloadEditorSettings()"><i class="fa-solid fa-download"></i> تحميل</button> <button class="gh-btn" onclick="app.copyText(app.exportEditorSettings())"><i class="fa-solid fa-copy"></i> نسخ</button></div>
            <div class="gh-card"><b>استيراد</b><textarea id="ed-import" class="form-input-box" rows="5" dir="ltr" placeholder="الصق ملف إعدادات OX أو settings.json من VS Code"></textarea>
            <button class="btn-new-thread gh-btn" onclick="app.importSettingsFromPanel('ox')">استيراد إعدادات OX</button> <button class="gh-btn" onclick="app.importSettingsFromPanel('vscode')"><i class="fa-solid fa-code"></i> استيراد settings.json من VS Code</button></div>`;
    };
    P.editorSettingChange = function (el) {
        const k = el.dataset.k;
        let v = el.type === 'checkbox' ? el.checked : el.value;
        if (el.dataset.num || k === 'tabSize') v = parseFloat(v);
        if (k === 'inlineAI' && v && !this.hasAIKey()) { el.checked = false; this.showToast('يلزم مفتاح OpenRouter لتفعيل الاقتراحات المضمنة', 'warning'); return; }
        this.setEditorSettings({ [k]: v });
    };
    P.downloadEditorSettings = function () {
        const blob = new Blob([this.exportEditorSettings()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'ox-editor-settings.json'; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    P.importSettingsFromPanel = function (kind) {
        const t = (document.getElementById('ed-import') || {}).value || '';
        if (!t.trim()) return;
        try {
            if (kind === 'vscode') {
                const r = this.importVSCodeSettings(t);
                this.showToast(`تم استيراد ${r.applied.length} إعداد من VS Code${r.ignored.length ? ` (تجاهل ${r.ignored.length})` : ''}`, r.applied.length ? 'success' : 'warning');
            } else this.showToast(`تم استيراد ${this.importEditorSettings(t)} إعداد`, 'success');
            this.openEditorSettings('sync');
        } catch (e) { this.showToast('ملف غير صالح: ' + e.message, 'error'); }
    };
    P.importVSCodeKeysFromPanel = function () {
        const t = (document.getElementById('ed-vsc-keys') || {}).value || '';
        try { const n = this.importVSCodeKeybindings(t); this.showToast(n ? `تم استيراد ${n} اختصار` : 'لا توجد اختصارات مدعومة', n ? 'success' : 'warning'); this.openEditorSettings('keys'); } catch (e) { this.showToast('JSON غير صالح', 'error'); }
    };

    // ------------------------------------------------------------------ KEYBINDINGS (#251)
    P.setKeybinding = function (key, cmd) {
        if (!key) return false;
        const kb = { ...this.getEditorSettings().keybindings };
        if (cmd) kb[key] = cmd; else delete kb[key];
        this.setEditorSettings({ keybindings: kb });
        return true;
    };
    P.removeKeybinding = function (key) { this.setKeybinding(key, null); this.openEditorSettings('keys'); };
    P.captureKeybinding = function (cmd, btn) {
        if (btn) btn.textContent = 'اضغط الاختصار…';
        const handler = (e) => {
            const k = keyFromEvent(e);
            if (!k) return;
            e.preventDefault(); e.stopPropagation();
            window.removeEventListener('keydown', handler, true);
            if (k === 'Escape') { this.openEditorSettings('keys'); return; }
            this.setKeybinding(k, cmd);
            this.showToast(`${k} ← ${APP_COMMANDS[cmd] || (COMMANDS[cmd] || [cmd])[0]}`, 'success');
            this.openEditorSettings('keys');
        };
        window.addEventListener('keydown', handler, true);
    };

    // ------------------------------------------------------------------ TOOLBAR (#257)
    P.toggleToolbarItem = function (id, on) {
        const s = this.getEditorSettings();
        let ids = (Array.isArray(s.toolbar) && s.toolbar.length ? s.toolbar : DEFAULT_TOOLBAR).slice();
        if (on && !ids.includes(id)) ids.push(id);
        if (!on) ids = ids.filter(x => x !== id);
        this.setEditorSettings({ toolbar: ids });
        return ids;
    };
    P.moveToolbarItem = function (id, dir) {
        const s = this.getEditorSettings();
        const ids = (Array.isArray(s.toolbar) && s.toolbar.length ? s.toolbar : DEFAULT_TOOLBAR).slice();
        const i = ids.indexOf(id), j = i + dir;
        if (i < 0 || j < 0 || j >= ids.length) return ids;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        this.setEditorSettings({ toolbar: ids });
        if (document.getElementById('ox-panel-modal')?.classList.contains('active')) this.openEditorSettings('toolbar');
        return ids;
    };

    // ------------------------------------------------------------------ MACROS (#252-#256)
    P.getMacros = function () {
        try { const l = JSON.parse(localStorage.getItem(MACROS_KEY) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; }
    };
    P.saveMacros = function (list) { try { localStorage.setItem(MACROS_KEY, JSON.stringify((list || []).slice(0, 100))); } catch (e) { /* quota */ } };
    const newId = () => 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    P.toggleMacroRecording = async function () {
        const ctl = this.codeEditor;
        if (!ctl) return null;
        if (!ctl.isRecording()) {
            ctl.startRecording();
            this.showToast('● بدأ تسجيل الماكرو — Ctrl+Alt+R للإيقاف والحفظ', 'info');
            this.renderEditorToolbar(); this.updateEditorChrome();
            ctl.focus();
            return true;
        }
        const steps = compactSteps(ctl.stopRecording());
        this.renderEditorToolbar(); this.updateEditorChrome();
        if (!steps.length) { this.showToast('لم تُسجل أي خطوات', 'info'); return false; }
        const list = this.getMacros();
        const name = (await this.askText('حفظ الماكرو', `ماكرو ${list.length + 1}`, { label: 'الاسم', dir: 'auto' })) || `ماكرو ${list.length + 1}`;
        const m = { id: newId(), name, steps, created: Date.now() };
        this.saveMacros([m].concat(list));
        this._lastMacro = m.id;
        this.showToast(`تم حفظ «${name}» (${steps.length} خطوة) — Ctrl+Alt+P للتشغيل`, 'success');
        return m;
    };
    P.playMacro = function (id, times = 1) {
        const m = this.getMacros().find(x => x.id === id);
        if (!m || !this.codeEditor) return false;
        this._lastMacro = m.id;
        this.codeEditor.playMacro(m.steps, times);
        this.codeEditor.focus();
        return true;
    };
    P.playLastMacro = function () {
        const list = this.getMacros();
        const id = (this._lastMacro && list.some(m => m.id === this._lastMacro)) ? this._lastMacro : list[0] && list[0].id;
        if (!id) { this.showToast('لا توجد ماكرو — سجّل واحدة بـ Ctrl+Alt+R', 'info'); return false; }
        return this.playMacro(id);
    };
    P.playMacroTimes = async function (id) {
        const n = parseInt(await this.askText('عدد مرات التشغيل', '5', { label: 'العدد (1-500)' }), 10);
        if (!n) return false;
        this.closeModals();
        return this.playMacro(id, Math.min(500, Math.max(1, n)));
    };
    P.renameMacro = async function (id) {
        const list = this.getMacros(), m = list.find(x => x.id === id);
        if (!m) return;
        const name = await this.askText('إعادة تسمية الماكرو', m.name, { dir: 'auto' });
        if (name) { m.name = name; this.saveMacros(list); }
        this.openEditorSettings('macros');
    };
    P.deleteMacro = function (id) { this.saveMacros(this.getMacros().filter(m => m.id !== id)); this.openEditorSettings('macros'); };
    P.exportMacros = function (ids) {
        const list = this.getMacros().filter(m => !ids || ids.includes(m.id));
        return JSON.stringify({ app: 'ox-alpha-macros', version: 1, macros: list.map(({ name, steps, created }) => ({ name, steps, created })) }, null, 2);
    };
    P.importMacros = function (text) {
        const data = typeof text === 'string' ? JSON.parse(text) : text;
        const arr = Array.isArray(data) ? data : (data && data.macros) || [];
        const valid = arr.filter(m => m && Array.isArray(m.steps) && m.steps.every(s => s && (typeof s.t === 'string' || typeof s.k === 'string' || typeof s.cmd === 'string')))
            .map(m => ({ id: newId(), name: String(m.name || 'ماكرو مستورد').slice(0, 80), steps: m.steps.slice(0, 5000), created: m.created || Date.now() }));
        if (valid.length) this.saveMacros(valid.concat(this.getMacros()));
        return valid.length;
    };
    P.importMacrosFromPanel = function () {
        const t = (document.getElementById('ed-macro-import') || {}).value || '';
        try { const n = this.importMacros(t); this.showToast(n ? `تم استيراد ${n} ماكرو` : 'لا توجد ماكرو صالحة', n ? 'success' : 'warning'); } catch (e) { this.showToast('JSON غير صالح', 'error'); }
        this.openEditorSettings('macros');
    };

    // ------------------------------------------------------------------ SPLIT EDITOR (#137)
    P.isTextProjectFile = function (p) { const f = this.virtualProjectFiles.get(p); return !!(f && typeof f.content === 'string' && !f.dataUrl && !(this.isBinaryProjectFile && this.isBinaryProjectFile(p))); };
    P.toggleSplitEditor = function (path) {
        if (this._splitEditor && !path) {
            try { this._splitEditor.ctl.destroy(); } catch (e) { /* ignore */ }
            this._splitEditor.pane.remove();
            this._splitEditor = null;
            document.querySelector('.studio-editor-wrapper')?.classList.remove('cm-split-on');
            this.renderEditorToolbar();
            return false;
        }
        if (!this.isCodeEditorActive()) return false;
        const texts = this.projectPaths().filter(p => this.isTextProjectFile(p));
        path = path || (this.recentFiles || []).find(p => p !== this.activeStudioFile && texts.includes(p)) || texts.find(p => p !== this.activeStudioFile) || this.activeStudioFile;
        if (this._splitEditor) { this.openSplitFile(path); return true; }
        const wrapper = document.querySelector('.studio-editor-wrapper');
        const pane = document.createElement('div');
        pane.className = 'cm-split-pane';
        pane.innerHTML = `<div class="cm-split-head"><i class="fa-solid fa-table-columns"></i><select class="cm-split-select" aria-label="ملف المحرر الثاني" onchange="app.openSplitFile(this.value)"></select><button type="button" title="تبديل المحررين" onclick="app.swapSplitEditors()"><i class="fa-solid fa-right-left"></i></button><button type="button" title="إغلاق" onclick="app.toggleSplitEditor()"><i class="fa-solid fa-xmark"></i></button></div><div class="cm-split-body"></div>`;
        wrapper.appendChild(pane);
        wrapper.classList.add('cm-split-on');
        const f = this.virtualProjectFiles.get(path);
        const cb = this.editorCallbacks();
        const ctl = createEditor({ parent: pane.querySelector('.cm-split-body'), doc: f ? f.content : '', path, settings: this.getEditorSettings(), callbacks: { ...cb, onChange: (text, p) => this.onSplitChange(text, p), onCursor: null, onFocus: null } });
        this._splitEditor = { ctl, pane };
        this.renderSplitSelect();
        this.renderEditorToolbar();
        return true;
    };
    P.renderSplitSelect = function () {
        if (!this._splitEditor) return;
        const s = this._splitEditor.pane.querySelector('.cm-split-select');
        const cur = this._splitEditor.ctl.getPath();
        s.innerHTML = this.projectPaths().filter(p => this.isTextProjectFile(p)).map(p => `<option value="${esc(p)}" ${p === cur ? 'selected' : ''}>${esc(p)}</option>`).join('');
    };
    P.openSplitFile = function (path) {
        if (!this._splitEditor || !this.virtualProjectFiles.has(path)) return false;
        const f = this.virtualProjectFiles.get(path);
        this._splitEditor.ctl.openFile(path, f.content || '');
        this.renderSplitSelect();
        return true;
    };
    P.onSplitChange = function (text, p) {
        if (!this.virtualProjectFiles.has(p)) return;
        if (p === this.activeStudioFile && this.codeEditor) {
            this.codeEditor.setValue(text);
            const ta = document.getElementById('studio-editor-textarea');
            if (ta) ta.dispatchEvent(new Event('input', { bubbles: true }));
        } else this.writeProjectFile(p, text, 'edit');
    };
    P.swapSplitEditors = function () {
        if (!this._splitEditor) return;
        const other = this._splitEditor.ctl.getPath(), mine = this.activeStudioFile;
        this.switchStudioFile(other);
        this.openSplitFile(mine);
    };

    // ------------------------------------------------------------------ TOOLS MENU
    P.csvToJsonFromEditor = function () {
        const c = this.editorContext();
        if (!c || !this.csvToJson) return null;
        const src = c.selected || c.text;
        const data = this.csvToJson(src);
        if (!data.length) { this.showToast('لا توجد بيانات CSV صالحة', 'warning'); return null; }
        const json = JSON.stringify(data, null, 2) + '\n';
        const target = this.uniqueProjectPath(c.path.replace(/\.[^./]+$/, '') + '.json');
        this.createProjectFile(target, json, { open: true, reason: 'convert' });
        this.showToast(`تم تحويل ${data.length} صف إلى ${target}`, 'success');
        return data;
    };
    P.eslintFixFile = async function () {
        const c = this.editorContext();
        if (!c || !this.toolsRequest) return null;
        if (!intel.isJS(c.path) || /\.tsx?$/.test(c.path)) { this.showToast('الإصلاح التلقائي متاح لملفات JavaScript', 'info'); return null; }
        let res;
        try { res = await this.toolsRequest('lint', { code: c.text, path: c.path, fix: true }, { timeout: 30000 }); } catch (e) { this.showToast('تعذر تحميل ESLint: ' + e.message, 'error'); return null; }
        if (!res || typeof res.output !== 'string' || res.output === c.text) { this.showToast('لا توجد مشاكل قابلة للإصلاح التلقائي', 'info'); return res; }
        if (c.ctl.getValue() !== c.text) return null;
        c.ctl.setValue(res.output, { notify: true });
        this.showToast(`تم الإصلاح التلقائي — متبقٍ ${(res.messages || []).length} مشكلة`, 'success');
        return res;
    };
    P.openEditorToolsMenu = function (anchor) {
        const ext = intel.extOf(this.activeStudioFile);
        const run = (cmd) => () => this.codeEditor && this.codeEditor.runCommand(cmd);
        this.showMenu([
            { icon: 'fa-font', label: 'تحويل حالة الأحرف…', run: () => this.showMenu(Object.entries(intel.CASES).map(([id, [label]]) => ({ icon: 'fa-font', label, run: () => this.changeCaseSelection(id) })), anchor) },
            { icon: 'fa-arrow-down-a-z', label: 'ترتيب الأسطر…', run: () => this.showMenu(Object.entries(intel.SORTS).map(([id, label]) => ({ icon: 'fa-arrow-down-short-wide', label, run: () => this.sortSelectedLines(id) })), anchor) },
            { icon: 'fa-eraser', label: 'حذف المسافات الزائدة', run: () => this.trimTrailingWhitespace() },
            /^(js|jsx|mjs|cjs)$/.test(ext) ? { icon: 'fa-wrench', label: 'إصلاح ESLint تلقائي', run: () => this.eslintFixFile() } : null,
            '-',
            { icon: 'fa-right-left', label: 'توليد Getters/Setters', run: () => this.generateClassMembers('accessors') },
            { icon: 'fa-hammer', label: 'توليد Constructor', run: () => this.generateClassMembers('constructor') },
            { icon: 'fa-diagram-project', label: 'JSON ← Types / Model', run: () => this.jsonToTypesFromEditor() },
            { icon: 'fa-table', label: 'CSV ← JSON', run: () => this.csvToJsonFromEditor() },
            /^(js|jsx|mjs|cjs|ts)$/.test(ext) ? { icon: 'fa-box-open', label: 'CommonJS ← ES Modules', run: () => this.convertCjsToEsm() } : null,
            { icon: 'fa-user-secret', label: 'بيانات وهمية (Faker)', run: () => this.insertFakeData() },
            '-',
            { icon: 'fa-sitemap', label: 'التبعيات', run: () => this.openDependencies() },
            { icon: 'fa-code-compare', label: 'مقارنة مجلدين', run: () => this.compareFoldersUI() },
            /^html?$/.test(ext) ? { icon: 'fa-universal-access', label: 'فحص إمكانية الوصول', run: () => this.auditActiveHTML() } : null,
            { icon: 'fa-key', label: 'متغيرات البيئة', run: () => this.openRunEnv() },
            { icon: 'fa-clock-rotate-left', label: 'سجل التشغيل', run: () => this.openRunHistory() },
            '-',
            { icon: 'fa-magnifying-glass', label: 'بحث واستبدال', kbd: 'Ctrl+F', run: run('openSearch') },
            { icon: 'fa-arrow-down-1-9', label: 'انتقال إلى سطر', kbd: 'Ctrl+G', run: run('gotoLine') },
            { icon: 'fa-compress', label: 'طي الكل', run: run('foldAll') },
            { icon: 'fa-expand', label: 'فك طي الكل', run: run('unfoldAll') },
            { icon: 'fa-circle-dot', label: 'الماكرو…', run: () => this.openEditorSettings('macros') },
            { icon: 'fa-keyboard', label: 'اختصارات لوحة المفاتيح', run: () => this.openEditorSettings('keys') }
        ], anchor);
    };
}
