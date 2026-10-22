/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 1: Productivity Essentials
   Ideas implemented (THOUSAND_IDEAS.md):
     #281  Command Palette (Ctrl+K)        #32   Slash commands
     #271 / #272 / #337  Light/Dark/Auto + 10 theme presets incl. high contrast
     #275  UI zoom (Ctrl + = / - / 0)      #276  Zen / Focus mode (Alt+Z)
     #284  Browser-like tabs for conversations
     #195  Editor font size + line numbers, Tab indent, auto-close brackets,
           comment toggle, JSON format, word wrap, status bar
   This module extends OXAlphaApp.prototype without touching core logic.
   ============================================================================== */
(function () {
    'use strict';
    if (typeof OXAlphaApp === 'undefined') return;
    const P = OXAlphaApp.prototype;

    // ------------------------------------------------------------------ THEMES
    const THEME_PRESETS = {
        dark:      { label: 'Obsidian (افتراضي)', swatch: '#131314', vars: {} },
        light:     { label: 'فاتح Light', swatch: '#f8fafc', light: true, vars: {} },
        dracula:   { label: 'Dracula', swatch: '#282a36', vars: { '--bg-base': '#282a36', '--bg-surface': '#2f3142', '--bg-card': '#383a4f', '--bg-card-hover': '#44475a', '--bg-sidebar': '#21222c', '--bg-code': '#1e1f29', '--bg-elevated': '#2b2d3c', '--bg-elevated-2': '#3a3c4e', '--primary': '#bd93f9', '--gemini-blue': '#bd93f9' } },
        nord:      { label: 'Nord', swatch: '#2e3440', vars: { '--bg-base': '#2e3440', '--bg-surface': '#3b4252', '--bg-card': '#434c5e', '--bg-card-hover': '#4c566a', '--bg-sidebar': '#272c36', '--bg-code': '#242933', '--bg-elevated': '#353c4a', '--bg-elevated-2': '#434c5e', '--primary': '#88c0d0', '--gemini-blue': '#5e81ac' } },
        monokai:   { label: 'Monokai', swatch: '#272822', vars: { '--bg-base': '#272822', '--bg-surface': '#2f302a', '--bg-card': '#3a3b34', '--bg-card-hover': '#49483e', '--bg-sidebar': '#1e1f1c', '--bg-code': '#1b1c18', '--bg-elevated': '#2d2e28', '--bg-elevated-2': '#3e3d32', '--primary': '#a6e22e', '--gemini-blue': '#66d9ef' } },
        solarized: { label: 'Solarized Dark', swatch: '#002b36', vars: { '--bg-base': '#002b36', '--bg-surface': '#073642', '--bg-card': '#0b4252', '--bg-card-hover': '#114e60', '--bg-sidebar': '#00212b', '--bg-code': '#001e26', '--bg-elevated': '#04313d', '--bg-elevated-2': '#0b4252', '--primary': '#2aa198', '--gemini-blue': '#268bd2' } },
        github:    { label: 'GitHub Dark', swatch: '#0d1117', vars: { '--bg-base': '#0d1117', '--bg-surface': '#161b22', '--bg-card': '#21262d', '--bg-card-hover': '#30363d', '--bg-sidebar': '#010409', '--bg-code': '#0a0d12', '--bg-elevated': '#161b22', '--bg-elevated-2': '#21262d', '--primary': '#58a6ff', '--gemini-blue': '#1f6feb' } },
        ocean:     { label: 'Ocean', swatch: '#0f1c2e', vars: { '--bg-base': '#0f1c2e', '--bg-surface': '#15263d', '--bg-card': '#1c3150', '--bg-card-hover': '#243c60', '--bg-sidebar': '#0a1524', '--bg-code': '#08111d', '--bg-elevated': '#132239', '--bg-elevated-2': '#1c3150', '--primary': '#38bdf8', '--gemini-blue': '#0ea5e9' } },
        sunset:    { label: 'Sunset', swatch: '#1f1520', vars: { '--bg-base': '#1f1520', '--bg-surface': '#2a1c2b', '--bg-card': '#362336', '--bg-card-hover': '#432b43', '--bg-sidebar': '#170f18', '--bg-code': '#140d15', '--bg-elevated': '#261a27', '--bg-elevated-2': '#362336', '--primary': '#fb923c', '--gemini-blue': '#f472b6' } },
        contrast:  { label: 'تباين عالٍ', swatch: '#000000', vars: { '--bg-base': '#000000', '--bg-surface': '#0a0a0a', '--bg-card': '#141414', '--bg-card-hover': '#222222', '--bg-sidebar': '#000000', '--bg-code': '#000000', '--bg-elevated': '#0f0f0f', '--bg-elevated-2': '#1c1c1c', '--border-subtle': 'rgba(255,255,255,0.35)', '--border-light': 'rgba(255,255,255,0.55)', '--text-muted': '#e5e7eb', '--text-dim': '#cbd5e1', '--primary': '#ffd60a', '--gemini-blue': '#ffd60a' } }
    };
    const THEME_VAR_KEYS = Array.from(new Set(Object.values(THEME_PRESETS).flatMap(t => Object.keys(t.vars))));

    P.applyTheme = function (name, silent) {
        let resolved = name;
        if (name === 'auto') {
            resolved = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        }
        const preset = THEME_PRESETS[resolved] || THEME_PRESETS.dark;
        const root = document.documentElement;
        THEME_VAR_KEYS.forEach(k => root.style.removeProperty(k));
        Object.entries(preset.vars).forEach(([k, v]) => root.style.setProperty(k, v));
        root.setAttribute('data-theme', preset.light ? 'light' : 'dark');
        root.setAttribute('data-theme-preset', resolved);
        this.currentTheme = name;
        try { localStorage.setItem('ox_alpha_theme', name); } catch (e) {}
        const icon = document.getElementById('theme-toggle-icon');
        if (icon) icon.className = 'fa-solid ' + (preset.light ? 'fa-sun' : 'fa-moon');
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', preset.light ? '#f8fafc' : (preset.vars['--bg-base'] || '#131314'));
        if (!silent) this.showToast(`المظهر: ${name === 'auto' ? 'تلقائي (حسب النظام)' : preset.label} 🎨`, 'success');
    };

    P.toggleTheme = function () {
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        this.applyTheme(isLight ? 'dark' : 'light');
    };

    // ------------------------------------------------------------------ ZOOM
    P.setUIScale = function (scale) {
        const s = Math.min(1.4, Math.max(0.8, Math.round(scale * 100) / 100));
        this.uiScale = s;
        document.documentElement.style.setProperty('--ui-scale', String(s));
        try { localStorage.setItem('ox_alpha_ui_scale', String(s)); } catch (e) {}
        this.showToast(`حجم الواجهة: ${Math.round(s * 100)}%`, 'info');
    };

    // ------------------------------------------------------------------ ZEN MODE
    P.toggleZenMode = function (force) {
        const on = force !== undefined ? force : !document.body.classList.contains('zen-mode');
        document.body.classList.toggle('zen-mode', on);
        if (on) this.toggleSidebar(false);
        this.showToast(on ? 'وضع التركيز مفعل 🧘 (Alt+Z للخروج)' : 'تم الخروج من وضع التركيز', 'info');
    };

    // ------------------------------------------------------------------ SESSION TABS
    P.loadOpenTabs = function () {
        try {
            const saved = JSON.parse(localStorage.getItem('ox_alpha_open_tabs') || '[]');
            this.openTabs = Array.isArray(saved) ? saved : [];
        } catch (e) { this.openTabs = []; }
    };

    P.saveOpenTabs = function () {
        try { localStorage.setItem('ox_alpha_open_tabs', JSON.stringify(this.openTabs)); } catch (e) {}
    };

    P.syncOpenTabs = function () {
        if (!Array.isArray(this.openTabs)) this.loadOpenTabs();
        const ids = new Set(this.sessions.map(s => s.id));
        this.openTabs = this.openTabs.filter(id => ids.has(id));
        if (this.activeSessionId && !this.openTabs.includes(this.activeSessionId)) {
            this.openTabs.push(this.activeSessionId);
            if (this.openTabs.length > 8) this.openTabs.shift();
        }
        this.saveOpenTabs();
    };

    P.renderTabsBar = function () {
        const bar = document.getElementById('top-tabs-bar');
        if (!bar) return;
        this.syncOpenTabs();
        if (this.openTabs.length < 2) { bar.classList.remove('visible'); bar.innerHTML = ''; return; }
        bar.classList.add('visible');
        bar.innerHTML = this.openTabs.map(id => {
            const s = this.sessions.find(x => x.id === id);
            if (!s) return '';
            const active = id === this.activeSessionId;
            const streaming = this.activeStreams.has(id);
            return `<div class="top-tab ${active ? 'active' : ''}" role="tab" aria-selected="${active}" title="${this.escapeHTML(s.title || '')}" onclick="app.switchSession('${id}')">
                ${streaming ? '<span class="tab-dot"></span>' : '<i class="fa-regular fa-message" style="font-size:0.7rem"></i>'}
                <span class="tab-title">${this.escapeHTML(s.title || 'محادثة')}</span>
                <span class="close-tab" role="button" aria-label="إغلاق التبويب" onclick="app.closeTab('${id}', event)"><i class="fa-solid fa-xmark"></i></span>
            </div>`;
        }).join('') + `<button class="top-tab-new" title="محادثة جديدة" aria-label="محادثة جديدة" onclick="app.createNewSession(true)"><i class="fa-solid fa-plus"></i></button>`;
    };

    P.closeTab = function (id, ev) {
        if (ev) ev.stopPropagation();
        const idx = this.openTabs.indexOf(id);
        if (idx === -1) return;
        this.openTabs.splice(idx, 1);
        this.saveOpenTabs();
        if (id === this.activeSessionId && this.openTabs.length > 0) {
            this.switchSession(this.openTabs[Math.max(0, idx - 1)]);
        } else {
            this.renderTabsBar();
        }
    };

    P.cycleTab = function (dir) {
        this.syncOpenTabs();
        if (this.openTabs.length < 2) return;
        const i = this.openTabs.indexOf(this.activeSessionId);
        const next = this.openTabs[(i + dir + this.openTabs.length) % this.openTabs.length];
        this.switchSession(next);
    };

    // Hook tabs into the core render cycle
    const _origRenderUIState = P.renderUIState;
    P.renderUIState = function () {
        const r = _origRenderUIState.apply(this, arguments);
        try { this.renderTabsBar(); } catch (e) { console.warn('tabs render failed', e); }
        return r;
    };

    // ------------------------------------------------------------------ SLASH COMMANDS
    const SLASH_COMMANDS = [
        { cmd: '/explain',  icon: 'fa-lightbulb',        color: '#fbbf24', title: 'شرح الكود',              desc: 'شرح مفصل سطراً بسطر بثلاث مستويات', prompt: 'اشرح الكود التالي بالتفصيل سطراً بسطر، بثلاث مستويات (مبتدئ / متوسط / خبير):\n\n' },
        { cmd: '/fix',      icon: 'fa-wrench',           color: '#f87171', title: 'إصلاح الأخطاء',          desc: 'اكتشاف الأخطاء وإصلاحها مع الشرح', prompt: 'اكتشف كل الأخطاء في الكود التالي وأصلحها، ثم اعرض الكود المصحح كاملاً مع شرح كل إصلاح:\n\n' },
        { cmd: '/test',     icon: 'fa-vial',             color: '#34d399', title: 'توليد اختبارات',         desc: 'اختبارات وحدة شاملة تغطي الحالات الحدية', prompt: 'اكتب اختبارات وحدة شاملة (Jest/Vitest أو Pytest حسب اللغة) تغطي 100% من الدوال والحالات الحدية للكود التالي:\n\n' },
        { cmd: '/review',   icon: 'fa-magnifying-glass-chart', color: '#38bdf8', title: 'مراجعة كود',       desc: 'مراجعة احترافية بتقييم ونقاط تحسين', prompt: 'قم بمراجعة كود احترافية (Code Review) للكود التالي: الجودة، القابلية للقراءة، الأداء، أفضل الممارسات. أعط تقييماً من 10 وقائمة تحسينات مرتبة حسب الأولوية:\n\n' },
        { cmd: '/refactor', icon: 'fa-recycle',          color: '#a78bfa', title: 'إعادة هيكلة',            desc: 'كود أنظف وأسهل صيانة بنفس السلوك', prompt: 'أعد هيكلة الكود التالي ليصبح أنظف وأسهل في الصيانة مع الحفاظ على نفس السلوك تماماً، واشرح التغييرات:\n\n' },
        { cmd: '/optimize', icon: 'fa-gauge-high',       color: '#fb923c', title: 'تحسين الأداء',           desc: 'تحليل Big-O وتسريع الكود', prompt: 'حلل تعقيد الكود التالي (Big-O) واقترح نسخة أسرع وأقل استهلاكاً للذاكرة مع قياس مقارن:\n\n' },
        { cmd: '/docs',     icon: 'fa-book',             color: '#60a5fa', title: 'توثيق',                  desc: 'تعليقات JSDoc/Docstrings + README', prompt: 'أضف توثيقاً كاملاً (JSDoc أو Docstrings حسب اللغة) للكود التالي، ثم اكتب قسم README مختصر يشرح الاستخدام:\n\n' },
        { cmd: '/convert',  icon: 'fa-right-left',       color: '#2dd4bf', title: 'تحويل لغة',              desc: 'تحويل الكود إلى لغة أخرى', prompt: 'حوّل الكود التالي إلى لغة [اكتب اللغة هنا] مع الحفاظ على نفس السلوك واستخدام أفضل ممارسات اللغة الهدف:\n\n' },
        { cmd: '/diagram',  icon: 'fa-diagram-project',  color: '#e879f9', title: 'مخطط Mermaid',           desc: 'توليد مخطط معماري / تسلسلي', prompt: 'ارسم مخطط Mermaid (flowchart أو sequenceDiagram أو classDiagram حسب الأنسب) يوضح بنية وتدفق ما يلي:\n\n' },
        { cmd: '/regex',    icon: 'fa-asterisk',         color: '#facc15', title: 'توليد Regex',            desc: 'تعبير نمطي من وصف عربي مع أمثلة', prompt: 'اكتب تعبيراً نمطياً (Regex) يطابق ما يلي، مع شرح كل جزء و5 أمثلة مطابقة و5 غير مطابقة:\n\n' },
        { cmd: '/sql',      icon: 'fa-database',         color: '#4ade80', title: 'استعلام SQL',            desc: 'تحويل طلب طبيعي إلى SQL محسن', prompt: 'حوّل الطلب التالي إلى استعلام SQL محسّن (PostgreSQL) مع شرح والفهارس المقترحة:\n\n' },
        { cmd: '/commit',   icon: 'fa-code-commit',      color: '#f472b6', title: 'رسالة Commit',           desc: 'رسالة Conventional Commit من التغييرات', prompt: 'اكتب رسالة Commit احترافية بصيغة Conventional Commits (عنوان + جسم) للتغييرات التالية:\n\n' },
        { cmd: '/readme',   icon: 'fa-file-lines',       color: '#93c5fd', title: 'توليد README',           desc: 'README احترافي كامل للمشروع', prompt: 'اكتب ملف README.md احترافي كامل (الوصف، الميزات، التثبيت، الاستخدام، البنية، المساهمة، الترخيص) للمشروع التالي:\n\n' },
        { cmd: '/scaffold', icon: 'fa-cubes',            color: '#c084fc', title: 'هيكل مشروع',             desc: 'Scaffold كامل من وصف المنتج', prompt: 'أنشئ هيكل مشروع كامل (شجرة المجلدات + محتوى كل ملف أساسي) لما يلي، باستخدام أفضل الممارسات الحديثة:\n\n' },
        { cmd: '/deploy',   icon: 'fa-rocket',           color: '#f97316', title: 'دليل نشر',               desc: 'خطوات نشر Vercel/Docker/CI', prompt: 'اكتب دليل نشر خطوة بخطوة (Vercel + Dockerfile متعدد المراحل + GitHub Actions) للمشروع التالي:\n\n' },
        { cmd: '/interview', icon: 'fa-user-tie',        color: '#94a3b8', title: 'محاكاة مقابلة',          desc: 'أسئلة مقابلة تقنية بمستواك', prompt: 'حاكِ مقابلة عمل تقنية في المجال التالي: اطرح سؤالاً واحداً في كل مرة، انتظر إجابتي، ثم قيّمها:\n\n' }
    ];
    P.getSlashCommands = function () { return SLASH_COMMANDS; };

    P.updateSlashAutocomplete = function () {
        const input = document.getElementById('user-input');
        const box = document.getElementById('slash-autocomplete');
        if (!input || !box) return;
        const val = input.value;
        const m = /^\/([\w-]*)$/.exec(val.trimStart());
        if (!m || val.includes('\n')) { this.hideSlashAutocomplete(); return; }
        const q = m[1].toLowerCase();
        const items = SLASH_COMMANDS.filter(c => c.cmd.slice(1).startsWith(q) || c.title.includes(q));
        if (items.length === 0) { this.hideSlashAutocomplete(); return; }
        this._slashItems = items;
        this._slashIndex = Math.min(this._slashIndex || 0, items.length - 1);
        box.innerHTML = `<div class="slash-autocomplete-header">الأوامر السريعة — ↑↓ للتنقل، Enter/Tab للاختيار</div>` +
            items.map((c, i) => `<div class="slash-item ${i === this._slashIndex ? 'focused' : ''}" role="option" aria-selected="${i === this._slashIndex}" onmousedown="event.preventDefault(); app.applySlashCommand(${i})">
                <div class="slash-item-icon" style="background:${c.color}22; color:${c.color}"><i class="fa-solid ${c.icon}"></i></div>
                <div><div class="slash-item-title">${c.cmd} <span style="font-weight:500;color:var(--text-muted)">— ${c.title}</span></div><div class="slash-item-desc">${c.desc}</div></div>
            </div>`).join('');
        box.classList.add('visible');
        const focused = box.querySelector('.slash-item.focused');
        if (focused) focused.scrollIntoView({ block: 'nearest' });
    };

    P.hideSlashAutocomplete = function () {
        const box = document.getElementById('slash-autocomplete');
        if (box) box.classList.remove('visible');
        this._slashItems = null;
        this._slashIndex = 0;
    };

    P.applySlashCommand = function (i) {
        const items = this._slashItems || [];
        const c = items[i];
        const input = document.getElementById('user-input');
        if (!c || !input) return;
        let text = c.prompt;
        // Smart context: pre-fill with the active Code Studio file if open
        if (this.isCodeStudioOpen && this.activeStudioFile) {
            const f = this.virtualProjectFiles.get(this.activeStudioFile);
            if (f && f.content && ['/explain', '/fix', '/test', '/review', '/refactor', '/optimize', '/docs', '/convert'].includes(c.cmd)) {
                text += '```' + (f.lang || '') + '\n' + f.content + '\n```';
            }
        }
        input.value = text;
        this.hideSlashAutocomplete();
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        this.autoResizeTextarea(input);
    };

    // ------------------------------------------------------------------ COMMAND PALETTE
    P.buildPaletteCommands = function () {
        const self = this;
        const cmds = [
            { section: 'عام', icon: 'fa-plus', label: 'محادثة جديدة', hint: 'New chat', kbd: 'Alt+N', run: () => self.createNewSession(true) },
            { section: 'عام', icon: 'fa-bars', label: 'إظهار/إخفاء القائمة الجانبية', hint: 'Toggle sidebar', kbd: 'Ctrl+B', run: () => self.toggleSidebar() },
            { section: 'عام', icon: 'fa-spa', label: 'وضع التركيز Zen', hint: 'Focus mode', kbd: 'Alt+Z', run: () => self.toggleZenMode() },
            { section: 'عام', icon: 'fa-gear', label: 'الإعدادات والمفاتيح', hint: 'Settings', kbd: 'Ctrl+,', run: () => self.openSettingsModal() },
            { section: 'عام', icon: 'fa-keyboard', label: 'تبديل سلوك Enter (إرسال / سطر جديد)', hint: 'Enter mode', run: () => self.toggleEnterMode() },
            { section: 'عام', icon: 'fa-file-export', label: 'تصدير المحادثة الحالية Markdown', hint: 'Export chat', run: () => self.exportChat('markdown') },
            { section: 'عام', icon: 'fa-broom', label: 'مسح كل المحادثات', hint: 'Clear all', run: () => self.clearAllChats() },
            { section: 'الذكاء الاصطناعي', icon: 'fa-cube', label: 'مستكشف النماذج', hint: 'Models', run: () => self.openModelExplorerModal() },
            { section: 'الذكاء الاصطناعي', icon: 'fa-bolt', label: 'حلبة مقارنة النماذج', hint: 'Arena', run: () => self.openDualModelArena() },
            { section: 'الذكاء الاصطناعي', icon: 'fa-robot', label: 'تفعيل/إيقاف الوكيل الذاتي', hint: 'Agent mode', run: () => self.toggleAutonomousAgent() },
            { section: 'الذكاء الاصطناعي', icon: 'fa-brain', label: 'تفعيل/إيقاف التوجيه الذكي', hint: 'Smart router', run: () => self.toggleSmartRouter() },
            { section: 'الذكاء الاصطناعي', icon: 'fa-globe', label: 'تفعيل/إيقاف البحث في الويب', hint: 'Web search', run: () => self.toggleWebSearch() },
            { section: 'الذكاء الاصطناعي', icon: 'fa-user-gear', label: 'تبديل تخصص المهندس (Persona)', hint: 'Persona', run: () => self.cyclePersona() },
            { section: 'الكود و GitHub', icon: 'fa-columns', label: 'استوديو الكود', hint: 'Code studio', kbd: 'Ctrl+`', run: () => self.toggleCodeStudio() },
            { section: 'الكود و GitHub', icon: 'fa-github', brand: true, label: 'مستودعات GitHub', hint: 'Repositories', run: () => self.openRepositoriesHubModal() },
            { section: 'الكود و GitHub', icon: 'fa-cloud-arrow-down', label: 'جلب كود المستودع النشط', hint: 'Ingest repo', run: () => self.ingestCurrentGitHubRepo() },
            { section: 'الكود و GitHub', icon: 'fa-code-branch', label: 'الفروع و Pull Requests', hint: 'Branches', run: () => self.openBranchManagerModal() },
            { section: 'الكود و GitHub', icon: 'fa-file-zipper', label: 'تصدير المشروع ZIP', hint: 'Export ZIP', run: () => self.downloadProjectAsZip() },
            { section: 'الكود و GitHub', icon: 'fa-terminal', label: 'أوامر Termux', hint: 'Termux', run: () => self.openTermuxHelperModal() },
            { section: 'الكود و GitHub', icon: 'fa-stethoscope', label: 'فحص وتشخيص الأنظمة', hint: 'Diagnostics', run: () => self.openDiagnosticsModal() },
            { section: 'الواجهة', icon: 'fa-circle-half-stroke', label: 'تبديل فاتح/داكن', hint: 'Toggle theme', kbd: 'Alt+T', run: () => self.toggleTheme() },
            { section: 'الواجهة', icon: 'fa-wand-magic-sparkles', label: 'مظهر تلقائي حسب النظام', hint: 'Auto theme', run: () => self.applyTheme('auto') },
            { section: 'الواجهة', icon: 'fa-magnifying-glass-plus', label: 'تكبير الواجهة', hint: 'Zoom in', kbd: 'Ctrl+=', run: () => self.setUIScale((self.uiScale || 1) + 0.1) },
            { section: 'الواجهة', icon: 'fa-magnifying-glass-minus', label: 'تصغير الواجهة', hint: 'Zoom out', kbd: 'Ctrl+-', run: () => self.setUIScale((self.uiScale || 1) - 0.1) },
            { section: 'الواجهة', icon: 'fa-arrows-rotate', label: 'إعادة حجم الواجهة 100%', hint: 'Reset zoom', kbd: 'Ctrl+0', run: () => self.setUIScale(1) }
        ];
        Object.entries(THEME_PRESETS).forEach(([key, t]) => cmds.push({
            section: 'الثيمات', icon: 'fa-palette', swatch: t.swatch, label: `ثيم: ${t.label}`, hint: key, run: () => self.applyTheme(key)
        }));
        SLASH_COMMANDS.forEach((c, i) => cmds.push({
            section: 'أوامر سريعة', icon: c.icon, label: `${c.cmd} — ${c.title}`, hint: c.desc, run: () => {
                self._slashItems = SLASH_COMMANDS; self.applySlashCommand(i);
            }
        }));
        this.sessions.slice(0, 50).forEach(s => cmds.push({
            section: 'المحادثات', type: 'session', icon: 'fa-message', label: s.title || 'محادثة', hint: new Date(s.updatedAt || s.createdAt || Date.now()).toLocaleDateString('ar'), run: () => self.switchSession(s.id)
        }));
        (this.availableModels || []).slice(0, 300).forEach(m => cmds.push({
            section: 'النماذج', type: 'model', icon: 'fa-microchip', label: m.name || m.id, hint: m.id, run: () => self.selectModel(m.id)
        }));
        return cmds;
    };

    // Simple subsequence fuzzy scorer (works for Arabic + Latin)
    const fuzzyScore = (text, q) => {
        text = text.toLowerCase();
        if (!q) return 1;
        const idx = text.indexOf(q);
        if (idx !== -1) return 1000 - idx;
        let ti = 0, score = 0, first = -1;
        for (const ch of q) {
            if (ch === ' ') continue;
            const f = text.indexOf(ch, ti);
            if (f === -1) return 0;
            if (first === -1) first = f;
            score += f === ti ? 5 : 1;
            ti = f + 1;
        }
        // Reject scattered matches (letters spread across unrelated words)
        if (first !== -1 && ti - first > q.length * 3 + 2) return 0;
        return score;
    };

    P.openCommandPalette = function () {
        const overlay = document.getElementById('cmd-palette-overlay');
        const input = document.getElementById('cmd-palette-input');
        if (!overlay || !input) return;
        this._paletteCommands = this.buildPaletteCommands();
        this._paletteIndex = 0;
        input.value = '';
        overlay.classList.add('active');
        this.renderCommandPalette('');
        setTimeout(() => input.focus(), 20);
    };

    P.closeCommandPalette = function () {
        const overlay = document.getElementById('cmd-palette-overlay');
        if (overlay) overlay.classList.remove('active');
    };

    P.renderCommandPalette = function (query) {
        const list = document.getElementById('cmd-palette-list');
        if (!list) return;
        let q = (query || '').trim().toLowerCase();
        let pool = this._paletteCommands || [];
        if (q.startsWith('>')) { pool = pool.filter(c => !c.type); q = q.slice(1).trim(); }
        else if (q.startsWith('#')) { pool = pool.filter(c => c.type === 'session'); q = q.slice(1).trim(); }
        else if (q.startsWith('@')) { pool = pool.filter(c => c.type === 'model'); q = q.slice(1).trim(); }
        else if (!q) { pool = pool.filter(c => c.type !== 'model'); }

        let results = pool.map(c => ({ c, s: Math.max(fuzzyScore(c.label, q), fuzzyScore(c.hint || '', q) * 0.8) }))
            .filter(r => r.s > 0);
        if (q) results.sort((a, b) => b.s - a.s);
        results = results.slice(0, 60);
        this._paletteResults = results.map(r => r.c);
        if (this._paletteIndex >= this._paletteResults.length) this._paletteIndex = 0;

        if (results.length === 0) {
            list.innerHTML = `<div class="cmd-palette-empty">لا توجد نتائج لـ "${this.escapeHTML(query)}"</div>`;
            return;
        }
        const hl = (txt) => {
            const safe = this.escapeHTML(txt);
            if (!q) return safe;
            const i = txt.toLowerCase().indexOf(q);
            if (i === -1) return safe;
            return this.escapeHTML(txt.slice(0, i)) + '<mark>' + this.escapeHTML(txt.slice(i, i + q.length)) + '</mark>' + this.escapeHTML(txt.slice(i + q.length));
        };
        let html = '', lastSection = null;
        this._paletteResults.forEach((c, i) => {
            if (!q && c.section !== lastSection) { html += `<div class="cmd-palette-section">${c.section}</div>`; lastSection = c.section; }
            const icon = c.swatch ? `<span class="theme-swatch" style="background:${c.swatch}"></span>` : `<i class="${c.brand ? 'fa-brands' : 'fa-solid'} ${c.icon} cmd-icon"></i>`;
            html += `<div class="cmd-palette-item ${i === this._paletteIndex ? 'focused' : ''}" data-idx="${i}" role="option" aria-selected="${i === this._paletteIndex}" onclick="app.runPaletteItem(${i})" onmousemove="app.focusPaletteItem(${i})">
                ${icon}
                <div style="min-width:0; flex:1"><div class="cmd-label truncate">${hl(c.label)}</div>${c.hint ? `<div class="cmd-hint truncate">${hl(c.hint)}</div>` : ''}</div>
                ${c.kbd ? `<kbd>${c.kbd}</kbd>` : ''}
            </div>`;
        });
        list.innerHTML = html;
        const f = list.querySelector('.cmd-palette-item.focused');
        if (f) f.scrollIntoView({ block: 'nearest' });
    };

    P.focusPaletteItem = function (i) {
        if (this._paletteIndex === i) return;
        this._paletteIndex = i;
        const list = document.getElementById('cmd-palette-list');
        if (!list) return;
        list.querySelectorAll('.cmd-palette-item').forEach(el => el.classList.toggle('focused', Number(el.dataset.idx) === i));
    };

    P.runPaletteItem = function (i) {
        const c = (this._paletteResults || [])[i];
        if (!c) return;
        this.closeCommandPalette();
        try { c.run(); } catch (e) { this.showToast('تعذر تنفيذ الأمر: ' + e.message, 'error'); }
    };

    // ------------------------------------------------------------------ ENHANCED EDITOR
    const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
    const COMMENT_TOKENS = { py: '#', rb: '#', sh: '#', yml: '#', yaml: '#', toml: '#', r: '#', sql: '--', lua: '--', html: null, css: null };

    P.initEnhancedEditor = function () {
        const editor = document.getElementById('studio-editor-textarea');
        if (!editor || editor.dataset.enhanced) return;
        editor.dataset.enhanced = '1';
        const wrapper = editor.parentElement;
        wrapper.classList.add('with-linenumbers');
        editor.classList.add('enhanced');

        const gutter = document.createElement('div');
        gutter.className = 'line-numbers-gutter';
        gutter.setAttribute('aria-hidden', 'true');
        wrapper.insertBefore(gutter, editor);

        const pane = document.getElementById('code-studio-pane');
        const toolbar = document.createElement('div');
        toolbar.className = 'editor-toolbar';
        toolbar.innerHTML = `
            <button onclick="app.formatStudioCode()" title="تنسيق (Shift+Alt+F)"><i class="fa-solid fa-align-left"></i> تنسيق</button>
            <button onclick="app.toggleStudioWrap()" title="التفاف الأسطر (Alt+W)"><i class="fa-solid fa-text-width"></i> التفاف</button>
            <button onclick="app.changeStudioFont(1)" title="تكبير الخط">A+</button>
            <button onclick="app.changeStudioFont(-1)" title="تصغير الخط">A-</button>
            <button onclick="app.downloadStudioFile()" title="تحميل الملف"><i class="fa-solid fa-download"></i></button>
            <span style="margin-right:auto; direction:ltr">Tab • Ctrl+/ • Ctrl+S • Ctrl+D</span>`;
        pane.insertBefore(toolbar, wrapper);

        const status = document.createElement('div');
        status.className = 'editor-statusbar';
        status.id = 'editor-statusbar';
        pane.insertBefore(status, wrapper.nextSibling);

        const sync = () => this.updateEditorChrome();
        editor.addEventListener('input', sync);
        editor.addEventListener('click', sync);
        editor.addEventListener('keyup', sync);
        editor.addEventListener('scroll', () => { gutter.scrollTop = editor.scrollTop; });
        editor.addEventListener('keydown', (e) => this.handleEditorKeydown(e, editor));

        const savedSize = parseFloat(localStorage.getItem('ox_alpha_editor_font') || '0');
        if (savedSize) this.applyStudioFont(savedSize);
        if (localStorage.getItem('ox_alpha_editor_wrap') === '1') { editor.classList.add('wrap'); wrapper.classList.add('wrapping'); }
        sync();
    };

    P.updateEditorChrome = function () {
        const editor = document.getElementById('studio-editor-textarea');
        const gutter = document.querySelector('.line-numbers-gutter');
        const status = document.getElementById('editor-statusbar');
        if (!editor) return;
        const lines = editor.value.split('\n').length;
        if (gutter && gutter.childElementCount !== lines) {
            const frag = [];
            for (let i = 1; i <= lines; i++) frag.push(`<div>${i}</div>`);
            gutter.innerHTML = frag.join('');
            gutter.scrollTop = editor.scrollTop;
        }
        if (status) {
            const before = editor.value.slice(0, editor.selectionStart);
            const ln = before.split('\n').length;
            const col = before.length - before.lastIndexOf('\n');
            const sel = Math.abs(editor.selectionEnd - editor.selectionStart);
            const lang = (this.activeStudioFile || '').split('.').pop().toUpperCase();
            status.innerHTML = `<span>Ln ${ln}, Col ${col}</span>${sel ? `<span>(${sel} selected)</span>` : ''}<span>${lines} lines</span><span>${editor.value.length} chars</span><span>${this.escapeHTML(lang)}</span><span>UTF-8</span><span>Spaces: 2</span>`;
        }
    };

    P.editorReplaceRange = function (editor, start, end, text, selStart, selEnd) {
        editor.focus();
        editor.setSelectionRange(start, end);
        // execCommand keeps the native undo stack; fall back to setRangeText
        let ok = false;
        try { ok = document.execCommand('insertText', false, text); } catch (e) {}
        if (!ok) editor.setRangeText(text, start, end, 'end');
        if (selStart !== undefined) editor.setSelectionRange(selStart, selEnd !== undefined ? selEnd : selStart);
        this.handleStudioCodeChange(editor.value);
        this.updateEditorChrome();
    };

    P.handleEditorKeydown = function (e, editor) {
        const { selectionStart: s, selectionEnd: en, value: v } = editor;
        const ctrl = e.ctrlKey || e.metaKey;

        if (e.key === 'Tab') {
            e.preventDefault();
            const lineStart = v.lastIndexOf('\n', s - 1) + 1;
            if (s === en && !e.shiftKey) { this.editorReplaceRange(editor, s, en, '  ', s + 2); return; }
            const block = v.slice(lineStart, en);
            const updated = e.shiftKey ? block.replace(/^ {1,2}/gm, '') : block.replace(/^/gm, '  ');
            this.editorReplaceRange(editor, lineStart, en, updated, lineStart, lineStart + updated.length);
            return;
        }
        if (e.key === 'Enter' && !ctrl) {
            e.preventDefault();
            const lineStart = v.lastIndexOf('\n', s - 1) + 1;
            const indent = (/^\s*/.exec(v.slice(lineStart, s)) || [''])[0];
            const prev = v[s - 1], next = v[en];
            const extra = /[{[(:]/.test(prev || '') ? '  ' : '';
            if (extra && PAIRS[prev] === next) {
                const ins = '\n' + indent + extra + '\n' + indent;
                this.editorReplaceRange(editor, s, en, ins, s + 1 + indent.length + extra.length);
            } else {
                const ins = '\n' + indent + extra;
                this.editorReplaceRange(editor, s, en, ins, s + ins.length);
            }
            return;
        }
        if (PAIRS[e.key] && !ctrl) {
            e.preventDefault();
            const close = PAIRS[e.key];
            const selected = v.slice(s, en);
            this.editorReplaceRange(editor, s, en, e.key + selected + close, s + 1, s + 1 + selected.length);
            return;
        }
        if (Object.values(PAIRS).includes(e.key) && s === en && v[s] === e.key) {
            e.preventDefault();
            editor.setSelectionRange(s + 1, s + 1);
            return;
        }
        if (e.key === 'Backspace' && s === en && PAIRS[v[s - 1]] && PAIRS[v[s - 1]] === v[s]) {
            e.preventDefault();
            this.editorReplaceRange(editor, s - 1, s + 1, '', s - 1);
            return;
        }
        if (ctrl && e.key === '/') { e.preventDefault(); this.toggleStudioComment(editor); return; }
        if (ctrl && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            this.handleStudioCodeChange(editor.value);
            this.showToast(`تم حفظ ${this.activeStudioFile} محلياً 💾 (استخدم Commit للرفع إلى GitHub)`, 'success');
            return;
        }
        if (ctrl && (e.key === 'd' || e.key === 'D')) {
            e.preventDefault();
            const lineStart = v.lastIndexOf('\n', s - 1) + 1;
            let lineEnd = v.indexOf('\n', en); if (lineEnd === -1) lineEnd = v.length;
            const line = v.slice(lineStart, lineEnd);
            this.editorReplaceRange(editor, lineEnd, lineEnd, '\n' + line, s + line.length + 1, en + line.length + 1);
            return;
        }
        if (e.altKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); this.formatStudioCode(); return; }
        if (e.altKey && (e.key === 'w' || e.key === 'W')) { e.preventDefault(); this.toggleStudioWrap(); }
    };

    P.toggleStudioComment = function (editor) {
        const ext = (this.activeStudioFile || '').split('.').pop().toLowerCase();
        const v = editor.value, s = editor.selectionStart, en = editor.selectionEnd;
        const lineStart = v.lastIndexOf('\n', s - 1) + 1;
        const endPos = (en > s && v[en - 1] === '\n') ? en - 1 : en;
        let lineEnd = v.indexOf('\n', endPos); if (lineEnd === -1) lineEnd = v.length;
        const block = v.slice(lineStart, lineEnd);
        let updated;
        if (ext === 'html' || ext === 'xml' || ext === 'svg' || ext === 'md' || ext === 'vue') {
            updated = /^\s*<!--[\s\S]*-->\s*$/.test(block) ? block.replace(/<!--\s?/, '').replace(/\s?-->/, '') : `<!-- ${block} -->`;
        } else if (ext === 'css' || ext === 'scss') {
            updated = /^\s*\/\*[\s\S]*\*\/\s*$/.test(block) ? block.replace(/\/\*\s?/, '').replace(/\s?\*\//, '') : `/* ${block} */`;
        } else {
            const tok = COMMENT_TOKENS[ext] || '//';
            const lines = block.split('\n');
            const esc = tok.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
            const allCommented = lines.filter(l => l.trim()).every(l => new RegExp('^\\s*' + esc).test(l));
            updated = lines.map(l => {
                if (!l.trim()) return l;
                return allCommented ? l.replace(new RegExp('^(\\s*)' + esc + ' ?'), '$1') : l.replace(/^(\s*)/, `$1${tok} `);
            }).join('\n');
        }
        this.editorReplaceRange(editor, lineStart, lineEnd, updated, lineStart, lineStart + updated.length);
    };

    P.formatStudioCode = function () {
        const editor = document.getElementById('studio-editor-textarea');
        if (!editor) return;
        const ext = (this.activeStudioFile || '').split('.').pop().toLowerCase();
        let out = editor.value;
        try {
            if (ext === 'json') {
                out = JSON.stringify(JSON.parse(out), null, 2);
            } else {
                // Generic tidy: normalise line endings, tabs → 2 spaces, strip trailing spaces, collapse 3+ blank lines
                out = out.replace(/\r\n?/g, '\n').replace(/\t/g, '  ').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
                if (!out.endsWith('\n')) out += '\n';
            }
        } catch (e) {
            this.showToast('تعذر التنسيق: JSON غير صالح — ' + e.message, 'error');
            return;
        }
        if (out === editor.value) { this.showToast('الملف منسق بالفعل ✨', 'info'); return; }
        this.editorReplaceRange(editor, 0, editor.value.length, out, 0);
        this.showToast('تم تنسيق الكود ✨', 'success');
    };

    P.toggleStudioWrap = function () {
        const editor = document.getElementById('studio-editor-textarea');
        if (!editor) return;
        const on = editor.classList.toggle('wrap');
        if (editor.parentElement) editor.parentElement.classList.toggle('wrapping', on);
        try { localStorage.setItem('ox_alpha_editor_wrap', on ? '1' : '0'); } catch (e) {}
        this.showToast(on ? 'التفاف الأسطر: مفعل' : 'التفاف الأسطر: معطل', 'info');
    };

    P.applyStudioFont = function (px) {
        const editor = document.getElementById('studio-editor-textarea');
        const gutter = document.querySelector('.line-numbers-gutter');
        if (!editor) return;
        editor.style.fontSize = px + 'px';
        if (gutter) {
            gutter.style.fontSize = px + 'px';
            gutter.style.setProperty('--gutter-line', (px * 1.6) + 'px');
        }
        this._studioFont = px;
    };

    P.changeStudioFont = function (delta) {
        const editor = document.getElementById('studio-editor-textarea');
        if (!editor) return;
        const cur = this._studioFont || parseFloat(getComputedStyle(editor).fontSize) || 13;
        const next = Math.min(24, Math.max(10, cur + delta));
        this.applyStudioFont(next);
        try { localStorage.setItem('ox_alpha_editor_font', String(next)); } catch (e) {}
    };

    P.downloadStudioFile = function () {
        const editor = document.getElementById('studio-editor-textarea');
        if (!editor) return;
        const name = (this.activeStudioFile || 'file.txt').split('/').pop();
        const blob = new Blob([editor.value], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    // Keep the gutter in sync when the studio switches files
    const _origRenderStudio = P.renderStudioWorkspace;
    P.renderStudioWorkspace = function () {
        const r = _origRenderStudio.apply(this, arguments);
        try {
            this.initEnhancedEditor();
            this.updateEditorChrome();
            if (this._studioFont) this.applyStudioFont(this._studioFont);
        } catch (e) { console.warn('editor enhance failed', e); }
        return r;
    };

    // ------------------------------------------------------------------ GLOBAL SHORTCUTS & INIT
    P.initSprint1 = function () {
        // Theme & scale restore
        let theme = 'dark';
        try { theme = localStorage.getItem('ox_alpha_theme') || 'dark'; } catch (e) {}
        this.applyTheme(theme, true);
        if (window.matchMedia) {
            const mq = window.matchMedia('(prefers-color-scheme: light)');
            const onChange = () => { if (this.currentTheme === 'auto') this.applyTheme('auto', true); };
            if (mq.addEventListener) mq.addEventListener('change', onChange);
        }
        const scale = parseFloat((() => { try { return localStorage.getItem('ox_alpha_ui_scale'); } catch (e) { return null; } })() || '1');
        this.uiScale = scale;
        document.documentElement.style.setProperty('--ui-scale', String(scale));

        this.loadOpenTabs();
        this.renderTabsBar();

        // Slash commands on the main input (capture phase so it runs before core Enter handler)
        const input = document.getElementById('user-input');
        if (input) {
            input.addEventListener('input', () => this.updateSlashAutocomplete());
            input.addEventListener('blur', () => setTimeout(() => this.hideSlashAutocomplete(), 120));
            input.addEventListener('keydown', (e) => {
                if (!this._slashItems || !this._slashItems.length) return;
                const n = this._slashItems.length;
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault(); e.stopImmediatePropagation();
                    this._slashIndex = (this._slashIndex + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
                    this.updateSlashAutocomplete();
                } else if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault(); e.stopImmediatePropagation();
                    this.applySlashCommand(this._slashIndex || 0);
                } else if (e.key === 'Escape') {
                    e.preventDefault(); e.stopImmediatePropagation();
                    this.hideSlashAutocomplete();
                }
            }, true);
        }

        // Command palette keyboard navigation
        const pInput = document.getElementById('cmd-palette-input');
        if (pInput) {
            pInput.addEventListener('input', () => { this._paletteIndex = 0; this.renderCommandPalette(pInput.value); });
            pInput.addEventListener('keydown', (e) => {
                const n = (this._paletteResults || []).length;
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (!n) return;
                    this._paletteIndex = (this._paletteIndex + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
                    this.renderCommandPalette(pInput.value);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    this.runPaletteItem(this._paletteIndex || 0);
                } else if (e.key === 'Escape') {
                    e.preventDefault(); e.stopPropagation();
                    this.closeCommandPalette();
                }
            });
        }

        // Global shortcuts
        window.addEventListener('keydown', (e) => {
            const ctrl = e.ctrlKey || e.metaKey;
            const k = e.key.toLowerCase();
            const paletteOpen = document.getElementById('cmd-palette-overlay')?.classList.contains('active');
            if (ctrl && (k === 'k' || (e.shiftKey && k === 'p'))) {
                e.preventDefault();
                paletteOpen ? this.closeCommandPalette() : this.openCommandPalette();
                return;
            }
            if (e.key === 'Escape' && paletteOpen) { this.closeCommandPalette(); return; }
            if (ctrl && k === 'b') { e.preventDefault(); this.toggleSidebar(); return; }
            if (ctrl && k === ',') { e.preventDefault(); this.openSettingsModal(); return; }
            if (ctrl && e.key === '`') { e.preventDefault(); this.toggleCodeStudio(); return; }
            if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); this.setUIScale((this.uiScale || 1) + 0.1); return; }
            if (ctrl && e.key === '-') { e.preventDefault(); this.setUIScale((this.uiScale || 1) - 0.1); return; }
            if (ctrl && e.key === '0') { e.preventDefault(); this.setUIScale(1); return; }
            if (e.altKey && !ctrl && k === 'z') { e.preventDefault(); this.toggleZenMode(); return; }
            if (e.altKey && !ctrl && k === 't') { e.preventDefault(); this.toggleTheme(); return; }
            if (e.altKey && !ctrl && k === 'n') { e.preventDefault(); this.createNewSession(true); return; }
            if (ctrl && e.key === 'PageDown') { e.preventDefault(); this.cycleTab(1); return; }
            if (ctrl && e.key === 'PageUp') { e.preventDefault(); this.cycleTab(-1); }
        });

        if (this.isCodeStudioOpen) this.initEnhancedEditor();
    };

    // Expose for tests / other modules
    window.OX_THEME_PRESETS = THEME_PRESETS;
    window.OX_SLASH_COMMANDS = SLASH_COMMANDS;

    if (window.app) {
        try { window.app.initSprint1(); } catch (e) { console.error('Sprint 1 init failed', e); }
    }
})();
