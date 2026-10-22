/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 7a: UI shell (appearance, layout, feedback, a11y)
   Ideas implemented (THOUSAND_IDEAS.md):
     #273 custom theme editor   #274 font loader   #278 reading mode   #279 gradient mesh
     #282/#324 custom shortcuts   #283 studio breadcrumbs   #285 three-column layout
     #286 column resizers   #287 collapsible desktop sidebar   #289 context menus
     #291 toasts (close/pause/stack)   #292 notification center   #293 desktop notifications
     #294/#326 sound packs   #296 top progress bar   #297/#298 skeleton + shimmer
     #300 message animations   #301 onboarding tour   #302 styled tooltips   #303 context help
     #308 image lightbox   #309 link preview   #310 hover cards   #312 mobile FAB
     #313 selection toolbar   #315 accessible modals   #316 drawer   #317 banners
     #321 brand   #322 welcome message   #323 quick suggestions   #325 notification prefs
     #327 synced with Gist (ox_alpha_* keys)   #328-#330 export / import / share customization
     #331 kids mode   #332 seniors mode   #333 color-blind palettes   #334 screen readers
     #335 keyboard navigation   #336 text zoom   #338 reduce motion   #354-#356 ultrawide/4K/touch
   ============================================================================== */
(function () {
    'use strict';
    if (typeof OXAlphaApp === 'undefined') return;
    const P = OXAlphaApp.prototype;
    const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
    const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
    const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
    const stripTags = (s) => String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    const HEX = /^#[0-9a-f]{6}$/i;
    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
    const cssEsc = (v) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(String(v)) : String(v).replace(/[^\w-]/g, (c) => '\\' + c));
    const isTyping = (el) => !!(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));

    // ------------------------------------------------------------------ LAZY UI CHUNK (assets/studio/ui-[hash].mjs, src/ui/ui.js)
    // Rarely-used panels (settings, theme editor, help, tour, lightbox, manager, search, dev tools, PiP…) load on first use.
    const UI_STUBS = [
        'bindMiniChat', 'captureShortcut', 'closeGlobalSearch', 'closeLightbox', 'cmBulk', 'cmItems', 'cmSelectAll', 'cmToggleSelect',
        'compareColumnHTML', 'cssPath', 'devMetrics', 'deviceFrameSize', 'drivingMicPress', 'endTour', 'exportMessagesImage', 'globalSearch',
        'layoutConversation', 'lightboxAction', 'miniChatHTML', 'miniChatShell', 'openCompareSessions', 'openContextHelp', 'openConversationManager', 'openDeviceEmulator',
        'openFavorites', 'openFileFromSearch', 'openGlobalSearch', 'openLightbox', 'openMiniChat', 'openThemeEditor', 'openTrash', 'openUISettings',
        'renderCMBulk', 'renderConversationCanvas', 'renderConversationManager', 'renderDeviceFrame', 'renderDrivingMode', 'renderFavorites', 'renderGlobalSearch', 'renderLightbox',
        'renderMiniChat', 'renderTour', 'renderTrash', 'runGlobalSearchItem', 'setCMView', 'setNetworkSim', 'setVoiceConversation', 'speakLastReply',
        'speakableText', 'startInspect', 'startTour', 'stopInspect', 'toggleDevHUD', 'tourStep'];
    P.ensureUI = async function (opts = {}) {
        try { await this.loadChunk('ui'); return true; } catch (e) {
            console.warn('[OX] ui chunk failed', e);
            if (!opts.quiet) this.showToast('تعذر تحميل هذه اللوحة — تحقق من الاتصال وأعد المحاولة', 'error');
            return false;
        }
    };
    /** Call a lazy UI method by name: app.ui('openUISettings', 'a11y') */
    P.ui = async function (method, ...args) {
        if (!(await this.ensureUI())) return null;
        const fn = this[method];
        if (typeof fn !== 'function' || fn.__oxLazy) throw new Error('unknown ui method ' + method);
        return fn.apply(this, args);
    };
    UI_STUBS.forEach((name) => {
        if (P[name]) return;
        const stub = function (...args) { return this.ui(name, ...args); };
        stub.__oxLazy = 'ui';
        P[name] = stub;
    });
    P.lazyUIMethods = () => UI_STUBS.slice();
    P.preloadUIChunk = function () {
        const c = (window.OX_BUILD && window.OX_BUILD.chunks) || {};
        if (!c.ui || document.querySelector(`link[rel="modulepreload"][href="${c.ui}"]`)) return false;
        const l = document.createElement('link'); l.rel = 'modulepreload'; l.href = c.ui; document.head.appendChild(l);
        return true;
    };

    // ------------------------------------------------------------------ PREFERENCES (stored under ox_alpha_* → included in backups + Gist sync, #327)
    const UI_KEY = 'ox_alpha_ui_v1';
    const DEFAULT_UI = {
        customTheme: null, fontUI: '', fontCode: '', textScale: 1, density: 'comfortable', reduceMotion: 'auto',
        colorBlind: 'none', mode: 'normal', meshBg: false, hideDetails: false, collapseCode: false, tooltips: true,
        sidebarCollapsed: false, studioWidth: 0, sidebarWidth: 0,
        brand: { name: '', emoji: '', accent: '' }, welcome: { title: '', subtitle: '' }, userName: '', suggestions: [], shortcuts: {},
        notify: { reply: true, errors: true, reminders: true, desktop: null, inactiveOnly: true }, // desktop: null = follow browser permission
        sound: { pack: 'chime', volume: 0.5, reply: true, error: true, send: false, notify: true },
        seasonal: true, events: true, tips: true, quotes: true, greeting: true, dailyGoal: 10,
        reminder: { enabled: false, time: '09:00' }, toured: false
    };
    const SHAREABLE = ['customTheme', 'fontUI', 'fontCode', 'textScale', 'density', 'reduceMotion', 'colorBlind', 'mode', 'meshBg', 'hideDetails', 'collapseCode', 'tooltips', 'brand', 'welcome', 'suggestions', 'shortcuts', 'notify', 'sound', 'seasonal', 'events', 'tips', 'quotes', 'greeting', 'dailyGoal', 'reminder'];
    const deepMerge = (base, patch) => {
        const out = { ...base };
        Object.keys(patch || {}).forEach(k => { out[k] = isObj(base[k]) && isObj(patch[k]) ? deepMerge(base[k], patch[k]) : patch[k]; });
        return out;
    };
    /** Keep only known keys whose type matches the defaults (used for imports and shared links). */
    const sanitizePrefs = (src, def = DEFAULT_UI, depth = 0) => {
        const out = {};
        if (!isObj(src) || depth > 3) return out;
        Object.keys(src).forEach(k => {
            if (!(k in def)) return;
            const v = src[k], d = def[k];
            if (k === 'customTheme') { if (v === null) out[k] = null; else if (isObj(v)) { const t = {}; ['bg', 'surface', 'card', 'text', 'accent'].forEach(c => { if (HEX.test(v[c] || '')) t[c] = v[c]; }); if (Object.keys(t).length === 5) out[k] = t; } return; }
            if (k === 'suggestions') { if (Array.isArray(v)) out[k] = v.filter(isObj).slice(0, 12).map(s => ({ label: String(s.label || '').slice(0, 60), prompt: String(s.prompt || '').slice(0, 2000) })).filter(s => s.label && s.prompt); return; }
            if (k === 'shortcuts') { if (isObj(v)) { const o = {}; Object.keys(v).slice(0, 40).forEach(c => { if (/^[\w+,.`=\-/\\[\]';]{1,32}$/.test(c) && typeof v[c] === 'string') o[c] = v[c].slice(0, 120); }); out[k] = o; } return; }
            if (isObj(d)) { if (isObj(v)) out[k] = sanitizePrefs(v, d, depth + 1); return; }
            if (d === null) { if (v === null || typeof v === 'boolean') out[k] = v; return; } // nullable booleans (notify.desktop)
            if (typeof d === 'number') { if (typeof v === 'number' && isFinite(v)) out[k] = v; return; }
            if (typeof d === 'boolean') { if (typeof v === 'boolean') out[k] = v; return; }
            if (typeof d === 'string' && typeof v === 'string') out[k] = (k === 'accent' ? (HEX.test(v) || !v ? v : '') : v.slice(0, 300));
        });
        return out;
    };
    P.UI_DEFAULTS = DEFAULT_UI;
    P.sanitizeUIPrefs = function (src) { return sanitizePrefs(src); };
    P.getUIPrefs = function () {
        if (!this._ui) this._ui = deepMerge(DEFAULT_UI, sanitizePrefs(lsGet(UI_KEY, {})));
        return this._ui;
    };
    P.setUIPrefs = function (patch, opts = {}) {
        this._ui = deepMerge(this.getUIPrefs(), patch || {});
        lsSet(UI_KEY, this._ui);
        if (opts.apply !== false) this.applyUIPrefs();
        return this._ui;
    };
    P.prefersReducedMotion = function () {
        const u = this.getUIPrefs();
        if (u.reduceMotion === 'on') return true;
        if (u.reduceMotion === 'off') return false;
        if (u.mode === 'senior') return true;
        try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
    };
    P.applyUIPrefs = function () {
        const u = this.getUIPrefs(), root = document.documentElement, b = document.body;
        if (!b) return;
        root.style.setProperty('--msg-scale', String(clamp(+u.textScale || 1, 0.8, 1.6)));
        root.setAttribute('data-density', u.density === 'compact' ? 'compact' : u.density === 'spacious' ? 'spacious' : 'comfortable');
        root.setAttribute('data-cb', u.colorBlind || 'none');
        root.setAttribute('data-uimode', u.mode || 'normal');
        b.classList.toggle('reduce-motion', this.prefersReducedMotion());
        b.classList.toggle('mesh-bg', !!u.meshBg);
        b.classList.toggle('hide-msg-details', !!u.hideDetails);
        b.classList.toggle('collapse-code', !!u.collapseCode);
        b.classList.toggle('sidebar-collapsed', !!u.sidebarCollapsed);
        const ws = document.getElementById('content-workspace');
        if (ws) { if (u.studioWidth) ws.style.setProperty('--studio-width', clamp(u.studioWidth, 20, 80) + '%'); else ws.style.removeProperty('--studio-width'); }
        if (u.sidebarWidth) root.style.setProperty('--sidebar-width', clamp(u.sidebarWidth, 200, 440) + 'px'); else root.style.removeProperty('--sidebar-width');
        if (u.fontUI) { this.loadWebFont(u.fontUI); root.style.setProperty('--font-arabic', `${u.fontUI === 'system-ui' ? 'system-ui' : `'${u.fontUI}'`}, 'IBM Plex Sans Arabic', system-ui, sans-serif`); } else root.style.removeProperty('--font-arabic');
        if (u.fontCode) { this.loadWebFont(u.fontCode); root.style.setProperty('--font-mono', `'${u.fontCode}', 'Fira Code', ui-monospace, monospace`); } else root.style.removeProperty('--font-mono');
        this.applyBrand();
        this.applyQuickSuggestions();
        if (this.applySeason) this.applySeason();
    };

    // ------------------------------------------------------------------ COLORS + CUSTOM THEME (#273)
    const parseColor = (c) => {
        c = String(c || '').trim();
        let m = c.match(/^#([0-9a-f]{3})$/i);
        if (m) return m[1].split('').map(x => parseInt(x + x, 16));
        m = c.match(/^#([0-9a-f]{6})$/i);
        if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
        m = c.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
        if (m) return [+m[1], +m[2], +m[3]];
        return null;
    };
    const toHex = (rgb) => '#' + rgb.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
    const mix = (a, b, t) => { const x = parseColor(a) || [0, 0, 0], y = parseColor(b) || [0, 0, 0]; return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
    const luminance = (c) => { const rgb = parseColor(c) || [0, 0, 0]; const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const contrast = (a, b) => { const l1 = luminance(a), l2 = luminance(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    P.colorUtils = { parseColor, toHex, mix, luminance, contrast };

    const CUSTOM_EXTRA = ['--bg-input', '--text-main', '--text-muted', '--text-dim', '--text-soft', '--border-subtle', '--border-light'];
    const THEME_SEEDS = {
        midnight: { bg: '#0b1020', surface: '#121a33', card: '#1a2547', text: '#e6ebff', accent: '#7c9cff' },
        forest: { bg: '#0f1a14', surface: '#16241c', card: '#1e3127', text: '#e3f2e8', accent: '#4ade80' },
        rose: { bg: '#1c1117', surface: '#26171f', card: '#33202a', text: '#fbe7ef', accent: '#f472b6' },
        paper: { bg: '#faf7f0', surface: '#f1ece1', card: '#ffffff', text: '#2b2620', accent: '#b45309' },
        mint: { bg: '#f3fbf8', surface: '#e6f5ef', card: '#ffffff', text: '#12322a', accent: '#0f9d76' },
        mono: { bg: '#111111', surface: '#1a1a1a', card: '#242424', text: '#f2f2f2', accent: '#d4d4d4' }
    };
    P.THEME_SEEDS = THEME_SEEDS;
    P.buildCustomTheme = function (c) {
        const light = luminance(c.bg) > 0.45;
        const ink = light ? '#000000' : '#ffffff';
        return {
            label: 'مخصص ✏️', swatch: c.bg, light,
            vars: {
                '--bg-base': c.bg, '--bg-surface': c.surface, '--bg-card': c.card, '--bg-card-hover': mix(c.card, c.text, 0.08),
                '--bg-sidebar': mix(c.bg, ink === '#ffffff' ? '#000000' : '#ffffff', 0.25), '--bg-code': mix(c.bg, '#000000', light ? 0.04 : 0.25),
                '--bg-elevated': mix(c.card, c.text, 0.05), '--bg-elevated-2': mix(c.card, c.text, 0.1), '--bg-input': c.surface,
                '--primary': c.accent, '--gemini-blue': c.accent,
                '--text-main': c.text, '--text-soft': mix(c.text, c.bg, 0.15), '--text-muted': mix(c.text, c.bg, 0.3), '--text-dim': mix(c.text, c.bg, 0.5),
                '--border-subtle': mix(c.bg, c.text, 0.12), '--border-light': mix(c.bg, c.text, 0.2)
            }
        };
    };
    const _origApplyTheme = P.applyTheme;
    if (_origApplyTheme) {
        P.applyTheme = function (name, silent) {
            const root = document.documentElement, presets = window.OX_THEME_PRESETS;
            CUSTOM_EXTRA.forEach(k => root.style.removeProperty(k));
            if (name === 'custom') {
                const ct = this.getUIPrefs().customTheme;
                if (!ct || !presets) name = 'dark';
                else presets.custom = this.buildCustomTheme(ct);
            }
            const r = _origApplyTheme.call(this, name, silent);
            this.applyBrand();
            // redraw on-screen Mermaid diagrams in the new palette (rare event; only when diagrams exist)
            if (typeof mermaid !== 'undefined' && document.querySelector('.mermaid-diagram-container') && this.renderMessages) { try { this.renderMessages(); } catch (e) { } }
            return r;
        };
    }
    P.readCurrentThemeColors = function () {
        const cs = getComputedStyle(document.documentElement);
        const get = (v, d) => { const c = parseColor(cs.getPropertyValue(v)); return c ? toHex(c) : d; };
        return { bg: get('--bg-base', '#131314'), surface: get('--bg-surface', '#1e1f20'), card: get('--bg-card', '#282a2c'), text: get('--text-main', '#e3e3e3'), accent: get('--primary', '#8ab4f8') };
    };
    /** Mermaid config that follows the active theme: 'base' theme fed with the live design tokens
     *  (so diagrams match Obsidian, Light, Dracula, custom…), instead of a fixed dark palette. */
    P.mermaidConfig = function () {
        const cs = getComputedStyle(document.documentElement);
        const light = document.documentElement.getAttribute('data-theme') === 'light';
        const c = this.readCurrentThemeColors();
        const muted = (() => { const x = parseColor(cs.getPropertyValue('--text-muted')); return x ? toHex(x) : (light ? '#5b606b' : '#a0a3ab'); })();
        return {
            startOnLoad: false, securityLevel: 'strict', htmlLabels: false, theme: 'base',
            // natural-size SVGs: CSS fits them on wide screens and lets narrow ones scroll (readable text)
            ...Object.fromEntries(['flowchart', 'sequence', 'class', 'state', 'er', 'gantt', 'journey', 'pie', 'mindmap', 'timeline', 'gitGraph', 'quadrantChart', 'requirement'].map(k => [k, { useMaxWidth: false }])),
            themeVariables: {
                darkMode: !light, fontFamily: 'Inter, "IBM Plex Sans Arabic", sans-serif', fontSize: '14px',
                background: c.surface, mainBkg: c.card, textColor: c.text, titleColor: c.text, lineColor: muted,
                primaryColor: c.card, primaryTextColor: c.text, primaryBorderColor: c.accent, nodeBorder: c.accent,
                secondaryColor: c.surface, secondaryTextColor: c.text, secondaryBorderColor: muted,
                tertiaryColor: c.bg, tertiaryTextColor: c.text, tertiaryBorderColor: muted,
                clusterBkg: c.surface, clusterBorder: muted, edgeLabelBackground: c.surface,
                noteBkgColor: c.surface, noteTextColor: c.text, noteBorderColor: muted,
                actorBkg: c.card, actorBorder: c.accent, actorTextColor: c.text, actorLineColor: muted,
                signalColor: muted, signalTextColor: c.text, labelBoxBkgColor: c.card, labelBoxBorderColor: muted, labelTextColor: c.text,
            },
        };
    };
    P.setCustomThemeColor = function (key, value) {
        if (!HEX.test(value || '')) return false;
        const ct = { ...(this.getUIPrefs().customTheme || this.readCurrentThemeColors()), [key]: value };
        this.setUIPrefs({ customTheme: ct }, { apply: false });
        this.applyTheme('custom', true);
        this.renderThemeContrast();
        return true;
    };
    P.applyThemeSeed = function (id) {
        const seed = THEME_SEEDS[id] || (id === 'current' ? this.readCurrentThemeColors() : null);
        if (!seed) return false;
        this.setUIPrefs({ customTheme: { ...seed } }, { apply: false });
        this.applyTheme('custom', true);
        if (document.getElementById('theme-editor')) this.openThemeEditor();
        return true;
    };
    P.renderThemeContrast = function () {
        const el = document.getElementById('theme-contrast');
        const ct = this.getUIPrefs().customTheme;
        if (!el || !ct) return;
        const r = contrast(ct.text, ct.bg), ra = contrast(ct.accent, ct.bg);
        el.innerHTML = `تباين النص: <b class="${r >= 4.5 ? 'text-success' : 'text-danger'}">${r.toFixed(1)}:1</b> ${r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : '⚠️ ضعيف'} • تباين اللون المميز: <b class="${ra >= 3 ? 'text-success' : 'text-danger'}">${ra.toFixed(1)}:1</b>`;
    };

    // ------------------------------------------------------------------ FONTS (#274)
    P.UI_FONTS = [['', 'IBM Plex Sans Arabic (افتراضي)'], ['Cairo', 'Cairo'], ['Tajawal', 'Tajawal'], ['Noto Kufi Arabic', 'Noto Kufi Arabic'], ['Almarai', 'Almarai'], ['Readex Pro', 'Readex Pro'], ['Inter', 'Inter'], ['system-ui', 'خط النظام']];
    P.CODE_FONTS = [['', 'افتراضي'], ['Fira Code', 'Fira Code'], ['JetBrains Mono', 'JetBrains Mono'], ['Source Code Pro', 'Source Code Pro'], ['IBM Plex Mono', 'IBM Plex Mono'], ['Roboto Mono', 'Roboto Mono']];
    P.loadWebFont = function (name) {
        if (!name || name === 'system-ui' || name === 'IBM Plex Sans Arabic' || name === 'Inter' || name === 'JetBrains Mono') return false;
        this._fontsLoaded = this._fontsLoaded || new Set();
        if (this._fontsLoaded.has(name)) return false;
        this._fontsLoaded.add(name);
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}:wght@400;600;700&display=swap`;
        l.dataset.oxFont = name;
        document.head.appendChild(l);
        return true;
    };

    // ------------------------------------------------------------------ READING MODE (#278) + LAYOUTS (#285)
    P.toggleReadingMode = function (force) {
        const on = force !== undefined ? !!force : !document.body.classList.contains('reading-mode');
        document.body.classList.toggle('reading-mode', on);
        if (on) this.showToast('📖 وضع القراءة — اضغط Esc للخروج', 'info');
        return on;
    };
    P.LAYOUTS = {
        chat: { label: 'محادثة فقط', icon: 'fa-comments' },
        split: { label: 'محادثة + محرر', icon: 'fa-table-columns' },
        three: { label: 'ثلاثي: ملفات + محرر + معاينة', icon: 'fa-table-cells-large' },
        focus: { label: 'تركيز على المحرر', icon: 'fa-expand' }
    };
    P.applyLayout = function (id) {
        if (!this.LAYOUTS[id]) return false;
        this.toggleReadingMode(false);
        if (id === 'chat') { this.toggleCodeStudio(false); }
        else {
            this.toggleCodeStudio(true);
            if (this.toggleStudioExplorer) try { this.toggleStudioExplorer(id === 'three' || id === 'focus'); } catch (e) {}
            if (id === 'three' && this.togglePreview) try { this.togglePreview(true); } catch (e) {}
        }
        this.setUIPrefs({ studioWidth: id === 'focus' ? 72 : id === 'three' ? 62 : this.getUIPrefs().studioWidth });
        document.body.classList.toggle('layout-focus', id === 'focus');
        this._layout = id;
        return true;
    };

    // ------------------------------------------------------------------ RESIZERS (#286) + COLLAPSIBLE SIDEBAR (#287)
    P.setStudioWidth = function (pct) { const v = Math.round(clamp(pct, 20, 80)); this.setUIPrefs({ studioWidth: v }); const r = document.getElementById('studio-resizer'); if (r) r.setAttribute('aria-valuenow', String(v)); return v; };
    P.setSidebarWidth = function (px) { const v = Math.round(clamp(px, 200, 440)); this.setUIPrefs({ sidebarWidth: v }); return v; };
    P.installResizers = function () {
        const ws = document.getElementById('content-workspace'), pane = document.getElementById('code-studio-pane');
        if (ws && pane && !document.getElementById('studio-resizer')) {
            const r = document.createElement('div');
            r.id = 'studio-resizer'; r.className = 'col-resizer';
            r.setAttribute('role', 'separator'); r.setAttribute('aria-orientation', 'vertical'); r.setAttribute('tabindex', '0');
            r.setAttribute('aria-label', 'تغيير عرض المحرر (الأسهم)'); r.setAttribute('aria-valuemin', '20'); r.setAttribute('aria-valuemax', '80');
            r.setAttribute('aria-valuenow', String(this.getUIPrefs().studioWidth || 50));
            ws.insertBefore(r, pane);
            this.bindDrag(r, (e) => { const rect = ws.getBoundingClientRect(); if (!rect.width) return; const rtl = getComputedStyle(ws).direction !== 'ltr'; const x = e.clientX - rect.left; this.setStudioWidth((rtl ? x : rect.width - x) / rect.width * 100); });
            r.addEventListener('dblclick', () => { this.setUIPrefs({ studioWidth: 0 }); });
            r.addEventListener('keydown', (e) => { const cur = this.getUIPrefs().studioWidth || 50; if (e.key === 'ArrowLeft') { e.preventDefault(); this.setStudioWidth(cur + 2); } if (e.key === 'ArrowRight') { e.preventDefault(); this.setStudioWidth(cur - 2); } });
        }
        const sb = document.getElementById('sidebar');
        if (sb && !document.getElementById('sidebar-resizer')) {
            const r = document.createElement('div');
            r.id = 'sidebar-resizer'; r.className = 'sidebar-resizer';
            r.setAttribute('role', 'separator'); r.setAttribute('aria-orientation', 'vertical'); r.setAttribute('tabindex', '0'); r.setAttribute('aria-label', 'تغيير عرض القائمة الجانبية');
            sb.appendChild(r);
            this.bindDrag(r, (e) => { const rect = sb.getBoundingClientRect(); const rtl = getComputedStyle(sb).direction !== 'ltr'; this.setSidebarWidth(rtl ? rect.right - e.clientX : e.clientX - rect.left); });
            r.addEventListener('dblclick', () => this.setUIPrefs({ sidebarWidth: 0 }));
            r.addEventListener('keydown', (e) => { const cur = this.getUIPrefs().sidebarWidth || 280; if (e.key === 'ArrowLeft') { e.preventDefault(); this.setSidebarWidth(cur + 10); } if (e.key === 'ArrowRight') { e.preventDefault(); this.setSidebarWidth(cur - 10); } });
        }
    };
    P.bindDrag = function (el, onMove) {
        el.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            try { el.setPointerCapture(e.pointerId); } catch (err) {}
            document.body.classList.add('is-resizing');
            const move = (ev) => onMove(ev);
            const up = () => { document.body.classList.remove('is-resizing'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
            el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
        });
    };
    P.isDesktop = function () { return (window.innerWidth || 1024) > 900; };
    const _origToggleSidebar = P.toggleSidebar;
    P.toggleSidebar = function (force) {
        if (this.isDesktop() && force === undefined) {
            const collapsed = !this.getUIPrefs().sidebarCollapsed;
            this.setUIPrefs({ sidebarCollapsed: collapsed });
            const btn = document.getElementById('sidebar-toggle-btn');
            if (btn) btn.setAttribute('aria-expanded', String(!collapsed));
            return !collapsed;
        }
        if (this.isDesktop() && force === true && this.getUIPrefs().sidebarCollapsed) this.setUIPrefs({ sidebarCollapsed: false });
        return _origToggleSidebar.apply(this, arguments);
    };

    const _origToggleStudio = P.toggleCodeStudio;
    P.toggleCodeStudio = function () {
        const r = _origToggleStudio.apply(this, arguments);
        const ws = document.getElementById('content-workspace');
        if (ws) ws.classList.toggle('studio-open', !!this.isCodeStudioOpen);
        return r;
    };

    // ------------------------------------------------------------------ STUDIO BREADCRUMBS (#283)
    P.breadcrumbSegments = function (path) {
        const parts = String(path || '').split('/').filter(Boolean);
        return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/'), dir: i < parts.length - 1 }));
    };
    P.renderStudioBreadcrumbs = function () {
        const pane = document.getElementById('code-studio-pane');
        if (!pane) return;
        let bc = document.getElementById('studio-breadcrumbs');
        if (!bc) {
            bc = document.createElement('nav');
            bc.id = 'studio-breadcrumbs'; bc.className = 'studio-breadcrumbs'; bc.setAttribute('aria-label', 'مسار الملف');
            const top = pane.querySelector('.studio-topbar');
            if (top) top.insertAdjacentElement('afterend', bc); else pane.insertBefore(bc, pane.firstChild);
        }
        const segs = this.breadcrumbSegments(this.activeStudioFile);
        bc.innerHTML = `<i class="fa-solid fa-folder-tree" aria-hidden="true"></i>` + segs.map((s, i) => `${i ? '<span class="bc-sep" aria-hidden="true">›</span>' : ''}<button class="bc-seg ${s.dir ? '' : 'current'}" data-bc="${this.escapeHTML(s.path)}" ${s.dir ? '' : 'aria-current="page"'}>${this.escapeHTML(s.name)}</button>`).join('');
        bc.onclick = (e) => {
            const b = e.target.closest('[data-bc]');
            if (!b) return;
            const p = b.dataset.bc;
            const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
            const dir = b.classList.contains('current') ? parent : p + '/';
            const files = Array.from(this.virtualProjectFiles.keys()).filter(f => f.startsWith(dir) && !f.slice(dir.length).includes('/')).sort();
            if (!files.length) return;
            this.showMenu(files.map(f => ({ icon: 'fa-file-code', label: f.slice(dir.length), run: () => this.switchStudioFile ? this.switchStudioFile(f) : (this.activeStudioFile = f, this.renderStudioWorkspace()) })), b);
        };
    };
    const _origRenderStudio = P.renderStudioWorkspace;
    P.renderStudioWorkspace = function () {
        const r = _origRenderStudio.apply(this, arguments);
        try { this.renderStudioBreadcrumbs(); } catch (e) {}
        return r;
    };

    // ------------------------------------------------------------------ TOASTS (#291) + SOUND (#294/#326)
    P.showToast = function (msg, type = 'info', opts = {}) {
        const container = document.getElementById('toast-container');
        if (!container) return null;
        if (!container.hasAttribute('role')) { container.setAttribute('role', 'status'); container.setAttribute('aria-live', 'polite'); }
        const pill = document.createElement('div');
        pill.className = `toast-msg-pill ${type}`;
        const icon = { success: 'fa-check-circle text-success', warning: 'fa-triangle-exclamation text-warning', error: 'fa-circle-xmark text-danger' }[type] || 'fa-info-circle text-info';
        pill.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span class="toast-text">${msg}</span><button class="toast-close-btn" aria-label="إغلاق الإشعار" title="إغلاق">×</button>`;
        while (container.children.length >= 5) container.firstElementChild.remove();
        container.appendChild(pill);
        if (opts.action && opts.action.label) {
            const b = document.createElement('button');
            b.className = 'toast-action-btn'; b.textContent = opts.action.label;
            b.onclick = () => { try { opts.action.run(); } finally { pill.remove(); } };
            pill.appendChild(b);
        }
        let remaining = opts.duration || (type === 'error' ? 6000 : opts.action ? 6000 : 3500), started = 0, timer = null;
        const dismiss = () => { clearTimeout(timer); pill.classList.add('toast-leaving'); setTimeout(() => pill.remove(), 250); };
        const arm = () => { started = Date.now(); clearTimeout(timer); timer = setTimeout(dismiss, remaining); };
        pill.addEventListener('mouseenter', () => { clearTimeout(timer); remaining = Math.max(800, remaining - (Date.now() - started)); });
        pill.addEventListener('mouseleave', arm);
        pill.querySelector('.toast-close-btn').onclick = dismiss;
        arm();
        const u = this.getUIPrefs();
        if ((type === 'error' && u.notify.errors) || type === 'warning' || opts.record) this.pushNotification({ msg: stripTags(msg), type, sessionId: opts.sessionId });
        if (type === 'error') this.playSound('error');
        return pill;
    };
    const SOUND_PACKS = {
        chime: { type: 'sine', reply: [[587, 880, 0.18]], send: [[700, 760, 0.06]], error: [[330, 220, 0.25]], notify: [[880, 1175, 0.12], [1175, 1568, 0.12, 0.12]] },
        soft: { type: 'triangle', reply: [[440, 523, 0.25]], send: [[392, 392, 0.05]], error: [[262, 196, 0.3]], notify: [[523, 659, 0.2]] },
        retro: { type: 'square', reply: [[523, 523, 0.07], [784, 784, 0.1, 0.08]], send: [[880, 880, 0.04]], error: [[200, 120, 0.3]], notify: [[660, 660, 0.06], [990, 990, 0.08, 0.07]] },
        drop: { type: 'sine', reply: [[1200, 400, 0.22]], send: [[900, 600, 0.06]], error: [[180, 90, 0.35]], notify: [[1400, 700, 0.15]] }
    };
    P.SOUND_PACKS = SOUND_PACKS;
    P.soundSequence = function (event, packName) {
        const pack = SOUND_PACKS[packName || this.getUIPrefs().sound.pack];
        return pack && pack[event] ? pack[event].map(([f1, f2, d, at]) => ({ type: pack.type, f1, f2, d, at: at || 0 })) : [];
    };
    P.playSound = function (event, opts = {}) {
        const s = this.getUIPrefs().sound;
        if (!opts.force && (s.pack === 'none' || s[event] === false || (this.isDnd && this.isDnd()))) return false;
        const seq = this.soundSequence(event, opts.pack);
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!seq.length || !AC) return false;
        try {
            const ctx = this._audioCtx || (this._audioCtx = new AC());
            if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
            const vol = 0.15 * clamp(+s.volume || 0, 0, 1);
            seq.forEach(t => {
                const osc = ctx.createOscillator(), gain = ctx.createGain(), t0 = ctx.currentTime + t.at;
                osc.type = t.type; osc.connect(gain); gain.connect(ctx.destination);
                osc.frequency.setValueAtTime(t.f1, t0);
                if (t.f2 !== t.f1) osc.frequency.exponentialRampToValueAtTime(t.f2, t0 + t.d);
                gain.gain.setValueAtTime(vol || 0.0001, t0);
                gain.gain.exponentialRampToValueAtTime(0.0001, t0 + t.d + 0.05);
                osc.start(t0); osc.stop(t0 + t.d + 0.06);
            });
            return true;
        } catch (e) { return false; }
    };
    P.playCompletionAudioHaptic = function () {
        if (this.isDnd && this.isDnd()) return;
        const s = (this.sessions || []).find(x => x.id === this._lastCompletedSessionId);
        if (s && s.muted) return;
        if (this.haptic) this.haptic([40, 60, 40]);
        this.playSound('reply');
    };

    // ------------------------------------------------------------------ NOTIFICATION CENTER (#292) + DESKTOP (#293) + DRAWER (#316) + BANNERS (#317)
    const NOTIF_KEY = 'ox_alpha_notifs_v1';
    P.loadNotifications = function () { if (!this._notifs) this._notifs = lsGet(NOTIF_KEY, []).filter(isObj).slice(0, 100); return this._notifs; };
    P.pushNotification = function ({ msg, type = 'info', title = '', sessionId = null, icon = '' }) {
        const list = this.loadNotifications();
        const text = String(msg || '').slice(0, 300);
        if (list[0] && list[0].msg === text && Date.now() - list[0].t < 3000) return list[0];
        const n = { id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t: Date.now(), msg: text, type, title, sessionId, icon, read: false };
        list.unshift(n);
        if (list.length > 100) list.length = 100;
        lsSet(NOTIF_KEY, list);
        this.updateBell();
        if (document.getElementById('notif-center')) this.renderNotificationCenter();
        return n;
    };
    /** Extends 08's notify(title, body): DND still silences everything (returns false); otherwise the alert lands in
        the notification center (+ desktop per prefs, sound, screen reader) and returns true. */
    P.notify = function (title, body, opts = {}) {
        if (this.isDnd && this.isDnd()) return false;
        this.pushNotification({ msg: body, type: opts.type || 'info', title, sessionId: opts.sessionId, icon: opts.icon });
        if (opts.desktop !== false) this.desktopNotify(title, body, opts);
        if (opts.sound !== false) this.playSound(opts.sound || 'notify');
        this.announce(`${title}: ${body}`);
        return true;
    };
    P.unreadNotifications = function () { return this.loadNotifications().filter(n => !n.read).length; };
    P.markNotificationsRead = function () { this.loadNotifications().forEach(n => { n.read = true; }); lsSet(NOTIF_KEY, this._notifs); this.updateBell(); };
    P.clearNotifications = function () { this._notifs = []; lsSet(NOTIF_KEY, []); this.updateBell(); if (document.getElementById('notif-center')) this.renderNotificationCenter(); };
    P.updateBell = function () {
        const badge = document.getElementById('notif-bell-badge');
        if (!badge) return;
        const n = this.unreadNotifications();
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.style.display = n ? '' : 'none';
        const btn = document.getElementById('notif-bell-btn');
        if (btn) btn.setAttribute('aria-label', n ? `الإشعارات (${n} غير مقروءة)` : 'الإشعارات');
    };
    P.relTime = function (t, now = Date.now()) {
        const s = Math.round((now - t) / 1000);
        if (s < 45) return 'الآن';
        if (s < 3600) return `منذ ${Math.round(s / 60)} د`;
        if (s < 86400) return `منذ ${Math.round(s / 3600)} س`;
        return new Date(t).toLocaleDateString('ar', { day: 'numeric', month: 'short' });
    };
    P.renderNotificationCenter = function () {
        const root = document.getElementById('notif-center');
        if (!root) return;
        const list = this.loadNotifications();
        const icon = { success: 'fa-circle-check text-success', error: 'fa-circle-xmark text-danger', warning: 'fa-triangle-exclamation text-warning' };
        root.innerHTML = list.length ? list.map(n => `<div class="notif-item ${n.read ? '' : 'unread'}" ${n.sessionId ? `role="button" tabindex="0" onclick="app.closeDrawer(); app.switchSession('${this.escapeHTML(n.sessionId)}')"` : ''}>
                <i class="fa-solid ${n.icon || icon[n.type] || 'fa-bell text-info'}" aria-hidden="true"></i>
                <div class="notif-main">${n.title ? `<b>${this.escapeHTML(n.title)}</b>` : ''}<span>${this.escapeHTML(n.msg)}</span><small>${this.relTime(n.t)}</small></div></div>`).join('')
            : '<div class="notif-empty"><i class="fa-regular fa-bell-slash"></i><span>لا توجد إشعارات</span></div>';
    };
    P.openNotificationCenter = function () {
        this.openDrawer({
            id: 'notifications', title: 'الإشعارات', icon: 'fa-bell',
            body: '<div id="notif-center" class="notif-center"></div>',
            footer: `<button class="sidebar-btn-util gh-btn" onclick="app.markNotificationsRead(); app.renderNotificationCenter()"><i class="fa-solid fa-check-double"></i> قراءة الكل</button><button class="sidebar-btn-util gh-btn" onclick="app.clearNotifications()"><i class="fa-solid fa-broom"></i> مسح</button><button class="sidebar-btn-util gh-btn" onclick="app.closeDrawer(); app.openUISettings('notify')"><i class="fa-solid fa-gear"></i> التفضيلات</button>`
        });
        this.renderNotificationCenter();
        setTimeout(() => this.markNotificationsRead(), 1200);
    };
    P.desktopNotify = function (title, body, opts = {}) {
        const u = this.getUIPrefs();
        if (u.notify.desktop === false || typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
        if (this.isDnd && this.isDnd()) return false;
        if (u.notify.inactiveOnly && !opts.always && document.hidden === false) return false;
        try {
            const n = new Notification(title, { body: String(body || '').slice(0, 180), tag: opts.tag || opts.sessionId || 'ox-alpha', icon: 'icon-192.png', silent: true });
            n.onclick = () => { try { window.focus(); } catch (e) {} if (opts.sessionId) this.switchSession(opts.sessionId); n.close(); };
            return true;
        } catch (e) { return false; }
    };
    P.requestDesktopNotifications = async function () {
        if (typeof Notification === 'undefined') { this.showToast('المتصفح لا يدعم إشعارات سطح المكتب', 'warning'); return false; }
        let p = Notification.permission;
        if (p === 'default') p = await Notification.requestPermission().catch(() => 'denied');
        this.setUIPrefs({ notify: { desktop: p === 'granted' } });
        this.showToast(p === 'granted' ? '🔔 تم تفعيل إشعارات سطح المكتب' : 'تم رفض الإذن — فعّله من إعدادات المتصفح', p === 'granted' ? 'success' : 'warning');
        if (document.getElementById('ui-settings')) this.openUISettings('notify');
        return p === 'granted';
    };
    const _origPass = P.onStreamPassComplete;
    P.onStreamPassComplete = function (info) {
        const r = _origPass ? _origPass.apply(this, arguments) : undefined;
        try { this._lastCompletedSessionId = info && info.sessionId; this.handleReplyComplete(info || {}); } catch (e) { console.warn('reply hook', e); }
        return r;
    };
    P.handleReplyComplete = function (info) {
        const s = (this.sessions || []).find(x => x.id === info.sessionId);
        if (!s) return false;
        this.announce('اكتمل الرد');
        if (s.muted || !this.getUIPrefs().notify.reply) return false;
        const away = info.sessionId !== this.activeSessionId || document.hidden === true;
        if (!away) return false;
        const m = s.messages.find(x => x.id === info.messageId) || s.messages[s.messages.length - 1];
        const snippet = stripTags(m && m.content || '').replace(/[#*`>_\-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
        this.pushNotification({ msg: `اكتمل الرد في «${s.title || 'محادثة'}»${snippet ? ' — ' + snippet : ''}`, type: 'success', sessionId: s.id, icon: 'fa-robot text-info' });
        this.desktopNotify(`✦ ${s.title || 'OX-Alpha'}`, snippet || 'اكتمل الرد', { sessionId: s.id });
        return true;
    };
    P.openDrawer = function ({ id = 'drawer', title = '', icon = 'fa-layer-group', body = '', footer = '', side = 'start' }) {
        this.closeDrawer(true);
        const back = document.createElement('div');
        back.className = 'ox-drawer-backdrop'; back.id = 'ox-drawer-backdrop';
        back.onclick = () => this.closeDrawer();
        const d = document.createElement('aside');
        d.className = `ox-drawer side-${side}`; d.id = 'ox-drawer'; d.dataset.drawer = id;
        d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'ox-drawer-title');
        d.innerHTML = `<div class="ox-drawer-head"><i class="fa-solid ${icon}" aria-hidden="true"></i><h2 id="ox-drawer-title">${this.escapeHTML(title)}</h2><button class="nav-icon-btn" onclick="app.closeDrawer()" aria-label="إغلاق"><i class="fa-solid fa-xmark"></i></button></div><div class="ox-drawer-body">${body}</div>${footer ? `<div class="ox-drawer-foot">${footer}</div>` : ''}`;
        this._drawerReturn = document.activeElement;
        document.body.appendChild(back); document.body.appendChild(d);
        requestAnimationFrame(() => { back.classList.add('active'); d.classList.add('active'); const f = d.querySelector(FOCUSABLE); if (f) f.focus(); });
        return d;
    };
    P.closeDrawer = function (instant) {
        const d = document.getElementById('ox-drawer'), b = document.getElementById('ox-drawer-backdrop');
        if (!d && !b) return false;
        [d, b].forEach(el => { if (!el) return; el.id = ''; el.classList.remove('active'); if (instant) el.remove(); else setTimeout(() => el.remove(), 260); });
        const ret = this._drawerReturn; this._drawerReturn = null;
        if (!instant && ret && ret.focus) try { ret.focus(); } catch (e) {}
        return true;
    };
    const BANNER_KEY = 'ox_alpha_banners_dismissed';
    P.showBanner = function ({ id, icon = 'fa-circle-info', text = '', type = 'info', actions = [], once = false }) {
        if (!id) id = 'b' + Date.now();
        if (once && lsGet(BANNER_KEY, []).includes(id)) return null;
        let host = document.getElementById('ox-banners');
        if (!host) {
            host = document.createElement('div');
            host.id = 'ox-banners'; host.className = 'ox-banners';
            const nav = document.querySelector('header.top-navbar');
            if (nav) nav.insertAdjacentElement('afterend', host); else document.body.prepend(host);
        }
        const old = host.querySelector(`[data-banner="${cssEsc(id)}"]`);
        if (old) old.remove();
        const el = document.createElement('div');
        el.className = `ox-banner ${type}`; el.dataset.banner = id; el.setAttribute('role', 'status');
        el.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span class="ox-banner-text">${text}</span><span class="ox-banner-actions"></span><button class="ox-banner-close" aria-label="إغلاق">×</button>`;
        const acts = el.querySelector('.ox-banner-actions');
        actions.forEach(a => { const b = document.createElement('button'); b.className = a.primary ? 'banner-btn-action' : 'banner-btn-link'; b.textContent = a.label; b.onclick = () => { try { a.run && a.run(); } finally { if (a.keep !== true) this.dismissBanner(id, once); } }; acts.appendChild(b); });
        el.querySelector('.ox-banner-close').onclick = () => this.dismissBanner(id, once);
        host.appendChild(el);
        return el;
    };
    P.dismissBanner = function (id, remember) {
        const el = document.querySelector(`#ox-banners [data-banner="${cssEsc(id)}"]`);
        if (el) el.remove();
        if (remember) { const l = lsGet(BANNER_KEY, []); if (!l.includes(id)) { l.push(id); lsSet(BANNER_KEY, l.slice(-100)); } }
        return !!el;
    };

    // ------------------------------------------------------------------ TOP PROGRESS BAR (#296) + network wrapper (also used by dev tools)
    P.progressStart = function () {
        this._progCount = (this._progCount || 0) + 1;
        let bar = document.getElementById('ox-progress');
        if (!bar) { bar = document.createElement('div'); bar.id = 'ox-progress'; bar.className = 'ox-progress'; bar.setAttribute('aria-hidden', 'true'); document.body.appendChild(bar); }
        if (this._progCount === 1) {
            clearTimeout(this._progHide); clearInterval(this._progTrickle);
            this._progValue = 8;
            bar.classList.add('active'); bar.style.transform = 'scaleX(0.08)';
            this._progTrickle = setInterval(() => { this._progValue = Math.min(90, this._progValue + (90 - this._progValue) * 0.12); bar.style.transform = `scaleX(${this._progValue / 100})`; }, 300);
        }
        return this._progCount;
    };
    P.progressDone = function () {
        this._progCount = Math.max(0, (this._progCount || 0) - 1);
        const bar = document.getElementById('ox-progress');
        if (!this._progCount && bar) {
            clearInterval(this._progTrickle);
            bar.style.transform = 'scaleX(1)';
            this._progHide = setTimeout(() => { bar.classList.remove('active'); bar.style.transform = 'scaleX(0)'; }, 280);
        }
        return this._progCount;
    };
    P.installFetchWrapper = function () {
        if (!window.fetch || window.fetch.__oxUI) return;
        const orig = window.fetch, self = this;
        const wrapped = function (input, init) {
            const sim = self._netSim;
            if (sim === 'offline') return Promise.reject(new TypeError('Failed to fetch (محاكاة عدم الاتصال)'));
            self.progressStart();
            const delay = sim === 'slow' ? 2000 : sim === '3g' ? 700 : 0;
            const go = () => orig.call(this, input, init);
            const p = delay ? new Promise(res => setTimeout(res, delay)).then(go) : go();
            return Promise.resolve(p).finally(() => self.progressDone());
        };
        wrapped.__oxUI = true;
        window.fetch = wrapped;
    };

    // ------------------------------------------------------------------ MESSAGE DECORATION: ids, animation (#300), skeleton (#297/#298), a11y
    P._msgDecorators = [];
    P.addMessageDecorator = function (fn) { if (typeof fn === 'function') P._msgDecorators.push(fn); };
    P._welcomeDecorators = [];
    P.addWelcomeDecorator = function (fn) { if (typeof fn === 'function') P._welcomeDecorators.push(fn); };
    P.skeletonHTML = function (lines = 3) { return `<div class="ox-skeleton" aria-label="جارٍ التحميل" role="progressbar">${Array.from({ length: lines }, (_, i) => `<span class="sk-line" style="width:${[92, 78, 60, 85, 70][i % 5]}%"></span>`).join('')}</div>`; };
    const _origRenderMessages = P.renderMessages;
    P.renderMessages = function () {
        const r = _origRenderMessages.apply(this, arguments);
        try { this.decorateRenderedMessages(); } catch (e) { console.warn('decorate messages', e); }
        return r;
    };
    P.decorateRenderedMessages = function () {
        const container = document.getElementById('chat-messages-container');
        if (!container) return;
        if (!container.hasAttribute('role')) { container.setAttribute('role', 'log'); container.setAttribute('aria-label', 'سجل المحادثة'); }
        const session = (this.sessions || []).find(s => s.id === this.activeSessionId);
        const welcome = container.querySelector('.welcome-hero-box');
        if (welcome) { this.decorateWelcome(welcome); return; }
        if (!session) return;
        const rows = Array.from(container.children).filter(el => el.classList.contains('msg-bubble-row'));
        const msgs = session.messages.slice(-rows.length);
        const first = this._seenSession !== session.id;
        if (first) { this._seenSession = session.id; this._seenMsgs = new Set(); }
        const animate = !first && !this.prefersReducedMotion();
        rows.forEach((row, i) => {
            const m = msgs[i];
            if (!m) return;
            const id = m.id || `idx${session.messages.length - rows.length + i}`;
            row.dataset.msgId = id; row.id = 'm-' + id; row.dataset.role = m.role;
            row.setAttribute('tabindex', '-1');
            row.setAttribute('aria-label', m.role === 'user' ? 'رسالتك' : 'رد المساعد');
            if (animate && !this._seenMsgs.has(id)) row.classList.add('msg-enter');
            this._seenMsgs.add(id);
            if (m.role === 'assistant' && m.status === 'streaming' && !(m.content || '').trim()) {
                const body = row.querySelector('.markdown-body');
                if (body && !body.textContent.trim()) body.innerHTML = this.skeletonHTML(3);
            }
            P._msgDecorators.forEach(fn => { try { fn.call(this, row, m, session); } catch (e) {} });
        });
        this.autoAriaLabels(container);
    };
    P.decorateWelcome = function (box) {
        const u = this.getUIPrefs();
        if (u.welcome.title) { const t = box.querySelector('.welcome-title-glow'); if (t) t.textContent = u.welcome.title; }
        if (u.welcome.subtitle) { const s = box.querySelector('.welcome-subtitle'); if (s) s.textContent = u.welcome.subtitle; }
        P._welcomeDecorators.forEach(fn => { try { fn.call(this, box); } catch (e) {} });
    };

    // ------------------------------------------------------------------ BRAND (#321) + QUICK SUGGESTIONS (#323)
    P.applyBrand = function () {
        const b = this.getUIPrefs().brand || {};
        const name = (b.name || '').trim();
        if (this._origTitle == null) this._origTitle = document.title;
        const navName = document.querySelector('.nav-brand-text');
        if (navName) navName.textContent = name || 'OX-Alpha';
        const title = document.querySelector('.brand-title');
        if (title && title.firstChild && title.firstChild.nodeType === 3) title.firstChild.textContent = (name || 'OX-Alpha') + ' ';
        document.querySelectorAll('.nav-sparkle, .gemini-sparkle-icon').forEach(el => { if (b.emoji) el.textContent = b.emoji; else el.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>'; });
        document.title = name ? `${name} — Workbench` : this._origTitle;
        if (b.accent && HEX.test(b.accent)) { document.documentElement.style.setProperty('--primary', b.accent); document.documentElement.style.setProperty('--brand-accent', b.accent); }
        else document.documentElement.style.removeProperty('--brand-accent');
    };
    P.applyQuickSuggestions = function () {
        const tray = document.getElementById('quick-prompts-tray');
        if (!tray) return;
        if (this._origTray == null) this._origTray = tray.innerHTML;
        const list = this.getUIPrefs().suggestions || [];
        const extra = this.timeSuggestions ? this.timeSuggestions() : [];
        const chip = (s, i, kind) => `<div class="suggestion-chip ${kind}" role="button" tabindex="0" data-qs="${kind}:${i}"><i class="fa-solid ${s.icon || 'fa-bolt'}" aria-hidden="true"></i><span>${this.escapeHTML(s.label)}</span></div>`;
        if (list.length) tray.innerHTML = list.map((s, i) => chip(s, i, 'custom')).join('') + extra.map((s, i) => chip(s, i, 'time')).join('');
        else tray.innerHTML = extra.map((s, i) => chip(s, i, 'time')).join('') + this._origTray;
        tray.onclick = (e) => {
            const c = e.target.closest('[data-qs]');
            if (!c) return;
            const [kind, i] = c.dataset.qs.split(':');
            const s = (kind === 'custom' ? list : extra)[+i];
            if (s) this.sendQuickPrompt(s.prompt);
        };
    };
    P.addQuickSuggestion = function (label, prompt) {
        if (!label || !prompt) return false;
        const list = (this.getUIPrefs().suggestions || []).concat([{ label: String(label).slice(0, 60), prompt: String(prompt).slice(0, 2000) }]).slice(-12);
        this.setUIPrefs({ suggestions: list });
        return list.length;
    };
    P.removeQuickSuggestion = function (i) { const list = (this.getUIPrefs().suggestions || []).slice(); list.splice(i, 1); this.setUIPrefs({ suggestions: list }); if (document.getElementById('ui-settings')) this.openUISettings('brand'); };

    // ------------------------------------------------------------------ CUSTOM SHORTCUTS (#282/#324)
    P.BUILTIN_SHORTCUTS = [
        ['Ctrl+K', 'لوحة الأوامر'], ['Ctrl+Enter', 'إرسال الرسالة'], ['Ctrl+B', 'إظهار/طي القائمة الجانبية'], ['Ctrl+,', 'الإعدادات'], ['Ctrl+`', 'استوديو الكود'],
        ['Ctrl+=', 'تكبير الواجهة'], ['Ctrl+-', 'تصغير الواجهة'], ['Ctrl+0', 'حجم الواجهة الافتراضي'], ['Ctrl+PageDown', 'التبويب التالي'], ['Ctrl+Shift+F', 'بحث في الكود'],
        ['Alt+Z', 'وضع التركيز'], ['Alt+T', 'تبديل المظهر'], ['Alt+N', 'محادثة جديدة'], ['Alt+U', 'مركز الذكاء الاصطناعي'], ['Alt+G', 'GitHub Hub'],
        ['Alt+S', 'البحث الشامل'], ['Alt+B', 'مركز الإشعارات'], ['Alt+R', 'وضع القراءة'], ['Alt+C', 'مدير المحادثات'], ['Ctrl+Alt+=', 'تكبير نص الرسائل'], ['Ctrl+Alt+-', 'تصغير نص الرسائل'],
        ['?', 'مساعدة السياق'], ['F1', 'مساعدة السياق'], ['F6', 'التنقل بين مناطق الواجهة'], ['Esc', 'إغلاق / الخروج من وضع القراءة']
    ];
    P.STUDIO_SHORTCUTS = [['Ctrl+S', 'حفظ'], ['Ctrl+/', 'تعليق السطر'], ['Ctrl+D', 'تكرار السطر'], ['Alt+Shift+F', 'تنسيق الكود'], ['Alt+W', 'التفاف الأسطر'], ['Ctrl+Alt+M', 'تعليق مراجعة']];
    P.eventCombo = function (e) {
        if (!e || !e.key || ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return '';
        const parts = [];
        if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey && e.key.length > 1) parts.push('Shift');
        else if (e.shiftKey && /^[a-z]$/i.test(e.key)) parts.push('Shift');
        const k = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
        parts.push(k);
        return parts.join('+');
    };
    P.isValidShortcut = function (combo) { return /^(Ctrl|Alt)\+/.test(combo) || /^F([2-9]|1[0-2])$/.test(combo) || /^(Ctrl|Alt)\+.*F\d+$/.test(combo); };
    P.setShortcut = function (combo, label) {
        if (!this.isValidShortcut(combo)) return false;
        const cmd = this.buildPaletteCommands().find(c => c.label === label);
        if (!cmd) return false;
        this.setUIPrefs({ shortcuts: { ...this.getUIPrefs().shortcuts, [combo]: label } }, { apply: false });
        return true;
    };
    P.removeShortcut = function (combo) { const s = { ...this.getUIPrefs().shortcuts }; delete s[combo]; this._ui.shortcuts = s; lsSet(UI_KEY, this._ui); if (document.getElementById('ui-settings')) this.openUISettings('shortcuts'); return true; };
    P.shortcutConflict = function (combo) { const b = this.BUILTIN_SHORTCUTS.concat(this.STUDIO_SHORTCUTS).find(([c]) => c.toUpperCase() === combo.toUpperCase()); return b ? b[1] : null; };
    P.runCustomShortcut = function (combo) {
        const label = this.getUIPrefs().shortcuts[combo];
        if (!label) return false;
        const cmd = this.buildPaletteCommands().find(c => c.label === label);
        if (!cmd) return false;
        try { cmd.run(); } catch (e) { console.warn(e); }
        return true;
    };

    // ------------------------------------------------------------------ TOOLTIPS (#302) + HOVER CARDS (#309/#310)
    P.tooltipHTML = function (text) {
        return this.escapeHTML(text).replace(/\(([^()]*(?:Ctrl|Alt|Shift|Esc|F\d)[^()]*)\)/g, (m, k) => `<kbd>${k}</kbd>`);
    };
    P.showTooltip = function (el) {
        const text = el.dataset.tip;
        if (!text) return;
        let tip = document.getElementById('ox-tooltip');
        if (!tip) { tip = document.createElement('div'); tip.id = 'ox-tooltip'; tip.className = 'ox-tooltip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
        tip.innerHTML = this.tooltipHTML(text);
        tip.classList.add('active');
        const r = el.getBoundingClientRect(), tw = tip.offsetWidth || 120, th = tip.offsetHeight || 28;
        const vw = window.innerWidth || 1024;
        const above = r.top > th + 12;
        tip.style.left = clamp(r.left + r.width / 2 - tw / 2, 6, vw - tw - 6) + 'px';
        tip.style.top = (above ? r.top - th - 8 : r.bottom + 8) + 'px';
        el.setAttribute('aria-describedby', 'ox-tooltip');
        this._tipEl = el;
    };
    P.hideTooltip = function () { clearTimeout(this._tipTimer); const t = document.getElementById('ox-tooltip'); if (t) t.classList.remove('active'); if (this._tipEl) this._tipEl.removeAttribute('aria-describedby'); this._tipEl = null; };
    P.prepareTooltip = function (el) {
        if (el.hasAttribute('title')) {
            const t = el.getAttribute('title');
            el.removeAttribute('title');
            if (t) { el.dataset.tip = t; if (!el.getAttribute('aria-label') && !(el.textContent || '').trim()) el.setAttribute('aria-label', t); }
        }
        return el.dataset.tip || '';
    };
    P.showHoverCard = function (anchor, html) {
        let c = document.getElementById('ox-hovercard');
        if (!c) { c = document.createElement('div'); c.id = 'ox-hovercard'; c.className = 'ox-hovercard'; c.addEventListener('mouseleave', () => this.hideHoverCard()); document.body.appendChild(c); }
        c.innerHTML = html;
        c.classList.add('active');
        const r = anchor.getBoundingClientRect(), w = c.offsetWidth || 280, h = c.offsetHeight || 120;
        const vw = window.innerWidth || 1024, vh = window.innerHeight || 768;
        c.style.left = clamp(r.left, 8, vw - w - 8) + 'px';
        c.style.top = (r.bottom + h + 10 < vh ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + 'px';
        return c;
    };
    P.hideHoverCard = function () { clearTimeout(this._hcTimer); const c = document.getElementById('ox-hovercard'); if (c) c.classList.remove('active'); };
    P.linkPreviewHTML = function (href) {
        let u;
        try { u = new URL(href, location.href); } catch (e) { return ''; }
        const secure = u.protocol === 'https:';
        const fav = this.isDataSaver && this.isDataSaver() ? '' : `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=32" alt="" width="16" height="16" loading="lazy">`;
        const kind = /github\.com$/.test(u.hostname) ? 'GitHub' : /\.(png|jpe?g|gif|webp|svg)$/i.test(u.pathname) ? 'صورة' : /\.pdf$/i.test(u.pathname) ? 'PDF' : /youtube\.com|youtu\.be/.test(u.hostname) ? 'فيديو' : 'صفحة ويب';
        return `<div class="hc-link"><div class="hc-head">${fav}<b>${this.escapeHTML(u.hostname)}</b><span class="hc-kind">${kind}</span></div><div class="hc-path" dir="ltr">${this.escapeHTML((u.pathname + u.search).slice(0, 120))}</div><div class="hc-foot">${secure ? '<span class="text-success"><i class="fa-solid fa-lock"></i> اتصال آمن HTTPS</span>' : '<span class="text-warning"><i class="fa-solid fa-lock-open"></i> اتصال غير مشفّر</span>'}<span>يفتح في تبويب جديد ↗</span></div></div>`;
    };

    // ------------------------------------------------------------------ SELECTION TOOLBAR (#313)
    P.quoteText = function (text) {
        const input = document.getElementById('user-input');
        if (!input || !text) return false;
        const q = String(text).trim().split('\n').map(l => '> ' + l).join('\n');
        input.value = q + '\n\n' + input.value;
        if (this.autoResizeTextarea) this.autoResizeTextarea(input);
        input.focus();
        return true;
    };
    P.selectionAction = function (action, text) {
        text = String(text || '').trim();
        if (!text) return false;
        this.hideSelectionToolbar();
        if (action === 'copy') this.copyToClipboard(text);
        else if (action === 'quote') this.quoteText(text);
        else if (action === 'explain') this.sendQuickPrompt(`اشرح هذا المقطع بالتفصيل وبأمثلة:\n\n> ${text.split('\n').join('\n> ')}`);
        else if (action === 'translate') this.sendQuickPrompt(`${/[\u0600-\u06FF]/.test(text) ? 'Translate to English' : 'ترجم إلى العربية'}:\n\n${text}`);
        else if (action === 'speak' && this.speakText) this.speakText(text);
        return true;
    };
    P.updateSelectionToolbar = function () {
        const sel = window.getSelection ? window.getSelection() : null;
        const text = sel ? sel.toString().trim() : '';
        const node = sel && sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : null;
        if (!text || text.length < 2 || !node || !node.closest || !node.closest('#chat-messages-container .msg-card')) return this.hideSelectionToolbar();
        let bar = document.getElementById('ox-sel-toolbar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'ox-sel-toolbar'; bar.className = 'ox-sel-toolbar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'إجراءات النص المحدد');
            bar.innerHTML = [['copy', 'fa-copy', 'نسخ'], ['quote', 'fa-quote-right', 'اقتباس'], ['explain', 'fa-lightbulb', 'اشرح'], ['translate', 'fa-language', 'ترجم'], ['speak', 'fa-volume-high', 'استمع']].map(([a, i, l]) => `<button data-sa="${a}" title="${l}"><i class="fa-solid ${i}" aria-hidden="true"></i><span>${l}</span></button>`).join('');
            bar.addEventListener('mousedown', (e) => e.preventDefault());
            bar.addEventListener('click', (e) => { const b = e.target.closest('[data-sa]'); if (b) this.selectionAction(b.dataset.sa, this._selText); });
            document.body.appendChild(bar);
        }
        this._selText = text;
        let r = { left: 100, top: 100, width: 0 };
        try { r = sel.getRangeAt(0).getBoundingClientRect(); } catch (e) {}
        const vw = window.innerWidth || 1024;
        bar.style.left = clamp(r.left + r.width / 2 - 140, 6, vw - 290) + 'px';
        bar.style.top = Math.max(6, r.top - 46) + 'px';
        bar.classList.add('active');
        return true;
    };
    P.hideSelectionToolbar = function () { const b = document.getElementById('ox-sel-toolbar'); if (b) b.classList.remove('active'); return false; };

    // ------------------------------------------------------------------ MOBILE FAB (#312)
    P.installFab = function () {
        if (document.getElementById('ox-fab')) return;
        const fab = document.createElement('div');
        fab.id = 'ox-fab'; fab.className = 'ox-fab';
        const items = [['new', 'fa-plus', 'محادثة جديدة'], ['mic', 'fa-microphone', 'إملاء صوتي'], ['studio', 'fa-code', 'المحرر'], ['search', 'fa-magnifying-glass', 'بحث شامل'], ['palette', 'fa-terminal', 'الأوامر']];
        fab.innerHTML = `<div class="fab-menu" role="menu">${items.map(([a, i, l]) => `<button role="menuitem" data-fab="${a}"><span>${l}</span><i class="fa-solid ${i}" aria-hidden="true"></i></button>`).join('')}</div><button class="fab-main" aria-label="إجراءات سريعة" aria-expanded="false"><i class="fa-solid fa-bolt" aria-hidden="true"></i></button>`;
        fab.addEventListener('click', (e) => {
            if (e.target.closest('.fab-main')) { const open = fab.classList.toggle('open'); fab.querySelector('.fab-main').setAttribute('aria-expanded', String(open)); if (this.haptic) this.haptic(10); return; }
            const b = e.target.closest('[data-fab]');
            if (!b) return;
            fab.classList.remove('open');
            this.fabAction(b.dataset.fab);
        });
        document.body.appendChild(fab);
    };
    P.fabAction = function (a) {
        if (a === 'new') this.createNewSession(true);
        else if (a === 'mic' && this.toggleRecording) this.toggleRecording();
        else if (a === 'studio') this.toggleCodeStudio();
        else if (a === 'search' && this.openGlobalSearch) this.openGlobalSearch();
        else if (a === 'palette') this.openCommandPalette();
        return a;
    };

    // ------------------------------------------------------------------ A11Y: modals (#315), live region + labels (#334), keyboard nav (#335)
    P.announce = function (text) {
        let live = document.getElementById('ox-live');
        if (!live) { live = document.createElement('div'); live.id = 'ox-live'; live.className = 'sr-only'; live.setAttribute('aria-live', 'polite'); live.setAttribute('role', 'status'); document.body.appendChild(live); }
        live.textContent = '';
        setTimeout(() => { live.textContent = String(text || ''); }, 30);
        return true;
    };
    const ICON_LABELS = { 'fa-xmark': 'إغلاق', 'fa-trash-can': 'حذف', 'fa-copy': 'نسخ', 'fa-pen': 'تعديل', 'fa-pen-to-square': 'محادثة جديدة', 'fa-sliders': 'الإعدادات', 'fa-gear': 'الإعدادات', 'fa-plus': 'إضافة', 'fa-download': 'تنزيل', 'fa-play': 'تشغيل', 'fa-stop': 'إيقاف', 'fa-arrow-up': 'إرسال', 'fa-microphone': 'إملاء صوتي', 'fa-paperclip': 'إرفاق ملف', 'fa-volume-high': 'استماع', 'fa-star': 'مفضلة', 'fa-thumbtack': 'تثبيت', 'fa-ellipsis': 'المزيد', 'fa-ellipsis-vertical': 'المزيد', 'fa-bars': 'القائمة', 'fa-magnifying-glass': 'بحث', 'fa-share-nodes': 'مشاركة', 'fa-rotate': 'تحديث', 'fa-expand': 'ملء الشاشة' };
    P.autoAriaLabels = function (root = document) {
        let n = 0;
        root.querySelectorAll('button:not([aria-label]), [role="button"]:not([aria-label])').forEach(b => {
            if ((b.textContent || '').trim()) return;
            let label = b.getAttribute('title') || b.dataset.tip || '';
            if (!label) { const i = b.querySelector('i[class*="fa-"]'); if (i) { const cls = Array.from(i.classList).find(c => ICON_LABELS[c]); if (cls) label = ICON_LABELS[cls]; } }
            if (label) { b.setAttribute('aria-label', label); n++; }
        });
        return n;
    };
    P.trapFocusKey = function (e) {
        if (e.key !== 'Tab') return false;
        const modals = Array.from(document.querySelectorAll('.modal-overlay-backdrop.active, #ox-drawer.active, #ox-lightbox.active, #ox-tour, #cmd-palette-overlay.active'));
        const top = modals[modals.length - 1];
        if (!top) return false;
        const items = Array.from(top.querySelectorAll(FOCUSABLE)).filter(el => !el.closest('[hidden]') && el.offsetParent !== null || el === document.activeElement);
        if (!items.length) return false;
        const first = items[0], last = items[items.length - 1];
        if (!top.contains(document.activeElement)) { e.preventDefault(); first.focus(); return true; }
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); return true; }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); return true; }
        return false;
    };
    P.observeModals = function () {
        if (this._modalObserver || typeof MutationObserver === 'undefined') return;
        this._modalStack = [];
        this._modalObserver = new MutationObserver((muts) => {
            muts.forEach(m => {
                const el = m.target;
                if (!el.classList || !el.classList.contains('modal-overlay-backdrop')) return;
                const was = /\bactive\b/.test(m.oldValue || ''), now = el.classList.contains('active');
                if (now && !was) {
                    this._modalStack.push(document.activeElement);
                    if (!el.hasAttribute('role')) el.setAttribute('role', 'dialog');
                    el.setAttribute('aria-modal', 'true');
                    setTimeout(() => { if (!el.contains(document.activeElement)) { const f = el.querySelector('input:not([type="hidden"]), textarea, select, button'); if (f) try { f.focus(); } catch (e) {} } }, 30);
                } else if (!now && was) {
                    const ret = this._modalStack.pop();
                    if (ret && ret.focus && document.body.contains(ret)) try { ret.focus(); } catch (e) {}
                }
            });
        });
        this._modalObserver.observe(document.body, { attributes: true, attributeFilter: ['class'], attributeOldValue: true, subtree: true });
    };
    P.installSkipLinks = function () {
        if (document.getElementById('ox-skip')) return;
        const nav = document.createElement('div');
        nav.id = 'ox-skip'; nav.className = 'skip-links';
        nav.innerHTML = '<a href="#user-input" class="skip-link">تخطَّ إلى حقل الكتابة</a><a href="#chat-messages" class="skip-link">تخطَّ إلى المحادثة</a><a href="#sessions-list" class="skip-link">تخطَّ إلى قائمة المحادثات</a>';
        nav.addEventListener('click', (e) => { const a = e.target.closest('a'); if (!a) return; e.preventDefault(); this.focusRegion(a.getAttribute('href').slice(1)); });
        document.body.prepend(nav);
    };
    P.REGIONS = ['sessions-list', 'chat-messages', 'user-input', 'code-studio-pane'];
    P.focusRegion = function (id) {
        const el = document.getElementById(id);
        if (!el) return false;
        if (!isTyping(el) && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
        if (id === 'chat-messages') { const rows = el.querySelectorAll('.msg-bubble-row'); const last = rows[rows.length - 1]; if (last) { last.focus(); return true; } }
        el.focus();
        return true;
    };
    P.cycleRegion = function (dir = 1) {
        const avail = this.REGIONS.filter(id => { const el = document.getElementById(id); return el && (id !== 'code-studio-pane' || el.classList.contains('active')) && !(id === 'sessions-list' && document.body.classList.contains('sidebar-collapsed')); });
        const cur = avail.findIndex(id => { const el = document.getElementById(id); return el && el.contains(document.activeElement); });
        const next = avail[(cur + dir + avail.length) % avail.length];
        this.focusRegion(next);
        return next;
    };
    P.handleMessageKeys = function (e) {
        const row = e.target && e.target.classList && e.target.classList.contains('msg-bubble-row') ? e.target : null;
        if (!row) return false;
        const rows = Array.from(document.querySelectorAll('#chat-messages-container > .msg-bubble-row'));
        const i = rows.indexOf(row);
        let target = null;
        if (e.key === 'ArrowDown' || e.key === 'j') target = rows[i + 1];
        else if (e.key === 'ArrowUp' || e.key === 'k') target = rows[i - 1];
        else if (e.key === 'Home') target = rows[0];
        else if (e.key === 'End') target = rows[rows.length - 1];
        else if (e.key === 'c' && !e.ctrlKey && !e.metaKey) { const t = row.querySelector('.markdown-body, .msg-card'); if (t) this.copyToClipboard(t.innerText || t.textContent); e.preventDefault(); return true; }
        else if (e.key === 'Enter' || e.key === 'ContextMenu') { e.preventDefault(); const r = row.getBoundingClientRect(); this.openMessageMenu(row.dataset.msgId, { x: r.left + 20, y: r.top + 20 }); return true; }
        if (target) { e.preventDefault(); target.focus(); target.scrollIntoView && target.scrollIntoView({ block: 'nearest' }); return true; }
        return false;
    };
    P.setTextScale = function (v) { const s = +clamp(+v || 1, 0.8, 1.6).toFixed(2); this.setUIPrefs({ textScale: s }); this.showToast(`🔠 حجم نص الرسائل ${Math.round(s * 100)}%`, 'info'); return s; };

    // ------------------------------------------------------------------ CONTEXT MENUS (#289) + touch long-press (#356)
    P.openMessageMenu = function (msgId, pos) {
        const items = this.messageMenuItems ? this.messageMenuItems(msgId) : [];
        if (!items.length) return false;
        this.showMenu(items, pos);
        return true;
    };
    P.openSessionMenu = function (sid, pos) {
        const items = this.sessionMenuItems ? this.sessionMenuItems(sid) : [];
        if (!items.length) return false;
        this.showMenu(items, pos);
        return true;
    };
    P.handleContextMenu = function (e) {
        const t = e.target;
        if (!t || !t.closest) return false;
        const sessionRow = t.closest('#sessions-list .session-item-row[data-sid]');
        if (sessionRow) { e.preventDefault(); return this.openSessionMenu(sessionRow.dataset.sid, { x: e.clientX, y: e.clientY }); }
        const row = t.closest('#chat-messages-container .msg-bubble-row[data-msg-id]');
        if (!row || t.closest('a, pre, input, textarea') || (window.getSelection && window.getSelection().toString())) return false;
        e.preventDefault();
        return this.openMessageMenu(row.dataset.msgId, { x: e.clientX, y: e.clientY });
    };

    // ------------------------------------------------------------------ MODES: kids (#331) + seniors (#332)
    P.setUIMode = function (mode) {
        if (!['normal', 'kids', 'senior'].includes(mode)) return false;
        const patch = { mode };
        if (mode === 'senior' && (this.getUIPrefs().textScale || 1) < 1.2) patch.textScale = 1.25;
        if (mode === 'normal' && this.getUIPrefs().mode === 'senior') patch.textScale = 1;
        this.setUIPrefs(patch);
        this.showToast({ kids: '🧒 وضع الأطفال: واجهة مبسطة وإجابات مناسبة للأطفال', senior: '👓 وضع كبار السن: خط أكبر وواجهة أبسط', normal: 'تم الرجوع للوضع العادي' }[mode], 'success');
        return true;
    };
    const MODE_PROMPTS = {
        kids: 'KIDS MODE: the user is a child (8-14 years old). Use very simple words and short sentences, friendly emojis and an encouraging tone. Explain programming with everyday analogies (Lego, recipes, games) and tiny examples. Kindly refuse unsafe, violent or adult topics and suggest asking a parent or teacher.',
        senior: 'SENIOR-FRIENDLY MODE: use clear, plain language and avoid jargon (explain any technical term). Go step by step with numbered steps, short paragraphs and a brief recap at the end. Be patient and reassuring.'
    };
    const _origDecorate = P.decorateSystemPrompt;
    P.decorateSystemPrompt = function (systemText, session) {
        let out = _origDecorate ? _origDecorate.call(this, systemText, session) : systemText;
        const extra = MODE_PROMPTS[this.getUIPrefs().mode];
        if (extra) out = (out || '') + '\n\n' + extra;
        return out;
    };

    // ------------------------------------------------------------------ EXPORT / IMPORT / SHARE CUSTOMIZATION (#328-#330)
    const b64urlEncode = (str) => { const bytes = new TextEncoder().encode(str); let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); }); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
    const b64urlDecode = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); };
    P.exportUIConfig = function (keys) {
        const u = this.getUIPrefs(), prefs = {};
        (keys || SHAREABLE).forEach(k => { if (k in u) prefs[k] = u[k]; });
        return { app: 'ox-alpha-ui', v: 1, createdAt: Date.now(), theme: (keys && !keys.includes('customTheme')) ? undefined : (this.currentTheme || 'dark'), prefs };
    };
    P.importUIConfig = function (obj) {
        if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch (e) { return false; } }
        if (!isObj(obj) || obj.app !== 'ox-alpha-ui' || !isObj(obj.prefs)) return false;
        const clean = sanitizePrefs(obj.prefs);
        delete clean.toured;
        this.setUIPrefs(clean);
        const theme = typeof obj.theme === 'string' ? obj.theme : null;
        if (theme && (theme === 'custom' ? this.getUIPrefs().customTheme : (window.OX_THEME_PRESETS || {})[theme] || theme === 'auto')) this.applyTheme(theme, true);
        else if (clean.customTheme) this.applyTheme('custom', true);
        return Object.keys(clean).length;
    };
    P.downloadUIConfig = function () {
        const json = JSON.stringify(this.exportUIConfig(), null, 2);
        this.downloadBlob(new Blob([json], { type: 'application/json' }), 'ox-alpha-ui-config.json');
        return json.length;
    };
    P.importUIConfigFile = async function (file) {
        if (!file) return false;
        const n = this.importUIConfig(await file.text());
        this.showToast(n ? `✅ تم استيراد ${n} إعداد للواجهة` : 'ملف تخصيص غير صالح', n ? 'success' : 'error');
        if (n && document.getElementById('ui-settings')) this.openUISettings('share');
        return n;
    };
    P.uiShareLink = function (keys) { return `${location.origin}${location.pathname}#ui=${b64urlEncode(JSON.stringify(this.exportUIConfig(keys)))}`; };
    P.shareUIConfig = async function () {
        const url = this.uiShareLink();
        if (navigator.share) { try { await navigator.share({ title: 'تخصيص OX-Alpha', url }); return url; } catch (e) {} }
        this.copyToClipboard(url);
        return url;
    };
    P.parseUIShareHash = function (hash) {
        const m = String(hash || '').match(/[#&]ui=([\w-]+)/);
        if (!m) return null;
        try { const obj = JSON.parse(b64urlDecode(m[1])); return obj && obj.app === 'ox-alpha-ui' ? obj : null; } catch (e) { return null; }
    };
    P.checkUIShareHash = function () {
        const obj = this.parseUIShareHash(location.hash);
        if (!obj) return false;
        try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
        this.showBanner({ id: 'ui-share', icon: 'fa-palette', type: 'info', text: `🎨 رابط تخصيص مشترك (${Object.keys(obj.prefs || {}).length} إعداد). هل تريد تطبيقه؟`, actions: [{ label: 'تطبيق', primary: true, run: () => { const n = this.importUIConfig(obj); this.showToast(n ? '✅ طُبّق التخصيص المشترك' : 'تعذر التطبيق', n ? 'success' : 'error'); } }, { label: 'تجاهل' }] });
        return true;
    };
    P.resetUIPrefs = function () { this._ui = deepMerge(DEFAULT_UI, { toured: true }); lsSet(UI_KEY, this._ui); this.applyUIPrefs(); if (this.currentTheme === 'custom') this.applyTheme('dark', true); return true; };

    // ------------------------------------------------------------------ NAVBAR BELL + GLOBAL LISTENERS
    P.installNavExtras = function () {
        const right = document.querySelector('.navbar-right');
        if (right && !document.getElementById('notif-bell-btn')) {
            const b = document.createElement('button');
            b.id = 'notif-bell-btn'; b.className = 'nav-icon-btn notif-bell-btn'; b.title = 'الإشعارات (Alt+B)';
            b.setAttribute('aria-label', 'الإشعارات');
            b.innerHTML = '<i class="fa-regular fa-bell" aria-hidden="true"></i><span id="notif-bell-badge" class="notif-badge" style="display:none">0</span>';
            b.onclick = () => this.openNotificationCenter();
            const theme = document.getElementById('theme-toggle-btn');
            right.insertBefore(b, theme || right.firstChild);
        }
        this.updateBell();
    };
    P.installUIListeners = function () {
        if (this._uiListeners) return;
        this._uiListeners = true;
        window.addEventListener('keydown', (e) => {
            const combo = this.eventCombo(e);
            if (combo && this.getUIPrefs().shortcuts[combo] && this.runCustomShortcut(combo)) { e.preventDefault(); e.stopPropagation(); }
        }, true);
        window.addEventListener('keydown', (e) => {
            if (this.trapFocusKey(e)) return;
            const ctrl = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();
            if (this._tour) { if (e.key === 'Escape') this.endTour(); else if (e.key === 'ArrowLeft') this.tourStep(1); else if (e.key === 'ArrowRight') this.tourStep(-1); return; }
            if (this._lb) { const map = { Escape: 'close', ArrowLeft: 'next', ArrowRight: 'prev', '+': 'in', '=': 'in', '-': 'out', '0': 'reset', r: 'rot' }; if (map[e.key]) { e.preventDefault(); this.lightboxAction(map[e.key]); } return; }
            if (e.key === 'Escape') {
                if (document.getElementById('ox-drawer')) { this.closeDrawer(); return; }
                if (document.body.classList.contains('reading-mode') && !document.querySelector('.modal-overlay-backdrop.active')) { this.toggleReadingMode(false); return; }
                this.hideSelectionToolbar(); this.hideTooltip(); this.hideHoverCard();
            }
            if (e.key === 'F6') { e.preventDefault(); this.cycleRegion(e.shiftKey ? -1 : 1); return; }
            if (ctrl && e.altKey && !e.shiftKey && e.code === 'KeyD') { e.preventDefault(); this.toggleDevHUD(); return; }
            if (e.key === 'F1' || (e.key === '?' && !ctrl && !e.altKey && !isTyping(e.target))) { e.preventDefault(); this.openContextHelp(); return; }
            if (e.altKey && !ctrl && k === 'b') { e.preventDefault(); this.openNotificationCenter(); return; }
            if (e.altKey && !ctrl && k === 'r') { e.preventDefault(); this.toggleReadingMode(); return; }
            if (ctrl && e.altKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); this.setTextScale((this.getUIPrefs().textScale || 1) + 0.1); return; }
            if (ctrl && e.altKey && e.key === '-') { e.preventDefault(); this.setTextScale((this.getUIPrefs().textScale || 1) - 0.1); return; }
            if (ctrl && e.altKey && e.key === '0') { e.preventDefault(); this.setTextScale(1); return; }
            this.handleMessageKeys(e);
        });
        document.addEventListener('contextmenu', (e) => this.handleContextMenu(e));
        // touch long-press → context menu
        let lp = null;
        document.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'touch') return;
            const target = e.target.closest && e.target.closest('#chat-messages-container .msg-bubble-row[data-msg-id], #sessions-list .session-item-row[data-sid]');
            if (!target) return;
            const x = e.clientX, y = e.clientY;
            lp = { x, y, t: setTimeout(() => { lp = null; if (this.haptic) this.haptic(15); if (target.dataset.sid) this.openSessionMenu(target.dataset.sid, { x, y }); else if (!(window.getSelection && window.getSelection().toString())) this.openMessageMenu(target.dataset.msgId, { x, y }); }, 560) };
        }, { passive: true });
        const cancel = (e) => { if (lp && (!e || e.type !== 'pointermove' || Math.abs(e.clientX - lp.x) + Math.abs(e.clientY - lp.y) > 10)) { clearTimeout(lp.t); lp = null; } };
        ['pointerup', 'pointercancel', 'pointermove', 'scroll'].forEach(ev => document.addEventListener(ev, cancel, { passive: true, capture: ev === 'scroll' }));
        // tooltips + hover cards
        document.addEventListener('mouseover', (e) => {
            const t = e.target;
            if (!t || !t.closest) return;
            const link = t.closest('#chat-messages-container .markdown-body a[href^="http"]');
            if (link) { clearTimeout(this._hcTimer); this._hcTimer = setTimeout(() => this.showHoverCard(link, this.linkPreviewHTML(link.href)), 450); return; }
            const srow = t.closest('#sessions-list .session-item-row[data-sid]');
            if (srow && this.sessionHoverHTML) { clearTimeout(this._hcTimer); this._hcTimer = setTimeout(() => { const html = this.sessionHoverHTML(srow.dataset.sid); if (html) this.showHoverCard(srow, html); }, 650); }
            if (!this.getUIPrefs().tooltips) return;
            const el = t.closest('[title], [data-tip]');
            if (!el || el.matches('input, textarea, select, iframe, svg *') || el === this._tipEl) return;
            if (!this.prepareTooltip(el)) return;
            clearTimeout(this._tipTimer);
            this._tipTimer = setTimeout(() => this.showTooltip(el), 380);
        });
        document.addEventListener('mouseout', (e) => {
            const t = e.target;
            if (!t || !t.closest) return;
            if (this._tipEl && (!e.relatedTarget || !this._tipEl.contains(e.relatedTarget))) this.hideTooltip();
            else clearTimeout(this._tipTimer);
            if (t.closest('#chat-messages-container a, #sessions-list .session-item-row')) { clearTimeout(this._hcTimer); const hc = document.getElementById('ox-hovercard'); if (!e.relatedTarget || !hc || !hc.contains(e.relatedTarget)) setTimeout(() => { const c = document.getElementById('ox-hovercard'); if (c && !c.matches(':hover')) this.hideHoverCard(); }, 200); }
        });
        document.addEventListener('focusin', (e) => {
            const el = e.target && e.target.closest && e.target.closest('[title], [data-tip]');
            if (el && this.getUIPrefs().tooltips && document.body.classList.contains('kb-nav') && this.prepareTooltip(el)) this.showTooltip(el);
        });
        document.addEventListener('focusout', () => this.hideTooltip());
        document.addEventListener('keydown', (e) => { if (e.key === 'Tab') document.body.classList.add('kb-nav'); });
        document.addEventListener('pointerdown', () => document.body.classList.remove('kb-nav'), { passive: true });
        window.addEventListener('scroll', () => { this.hideTooltip(); }, { passive: true, capture: true });
        // lightbox on chat images
        document.addEventListener('click', (e) => {
            const img = e.target && e.target.closest && e.target.closest('#chat-messages-container .markdown-body img, #chat-messages-container .msg-card img');
            if (!img || img.closest('a')) return;
            const all = Array.from(document.querySelectorAll('#chat-messages-container .markdown-body img, #chat-messages-container .msg-card img')).map(i => i.currentSrc || i.src).filter(Boolean);
            this.openLightbox(img.currentSrc || img.src, all);
        });
        // selection toolbar
        let selT = null;
        document.addEventListener('selectionchange', () => { clearTimeout(selT); selT = setTimeout(() => this.updateSelectionToolbar(), 220); });
        // send sound
        const sendBtn = document.getElementById('btn-send');
        if (sendBtn) sendBtn.addEventListener('click', () => this.playSound('send'));
    };

    // ------------------------------------------------------------------ PALETTE + INIT
    const _origPalette = P.buildPaletteCommands;
    if (_origPalette) {
        P.buildPaletteCommands = function () {
            const self = this, S = 'الواجهة';
            return _origPalette.call(this).concat([
                { section: S, icon: 'fa-wand-magic-sparkles', label: 'تخصيص الواجهة', hint: 'UI', run: () => self.openUISettings() },
                { section: S, icon: 'fa-paintbrush', label: 'محرر المظهر المخصص', hint: 'Theme', run: () => self.openThemeEditor() },
                { section: S, icon: 'fa-book-open', label: 'وضع القراءة', hint: 'Reading', kbd: 'Alt+R', run: () => self.toggleReadingMode() },
                { section: S, icon: 'fa-bell', label: 'مركز الإشعارات', hint: 'Notifications', kbd: 'Alt+B', run: () => self.openNotificationCenter() },
                { section: S, icon: 'fa-route', label: 'الجولة التعريفية', hint: 'Tour', run: () => self.startTour() },
                { section: S, icon: 'fa-circle-question', label: 'مساعدة السياق', hint: 'Help', kbd: '?', run: () => self.openContextHelp() },
                { section: S, icon: 'fa-keyboard', label: 'تخصيص الاختصارات', hint: 'Shortcuts', run: () => self.openUISettings('shortcuts') },
                { section: S, icon: 'fa-universal-access', label: 'إعدادات الوصول', hint: 'A11y', run: () => self.openUISettings('a11y') },
                { section: S, icon: 'fa-child', label: 'وضع الأطفال', hint: 'Kids', run: () => self.setUIMode(self.getUIPrefs().mode === 'kids' ? 'normal' : 'kids') },
                { section: S, icon: 'fa-glasses', label: 'وضع كبار السن', hint: 'Seniors', run: () => self.setUIMode(self.getUIPrefs().mode === 'senior' ? 'normal' : 'senior') },
                { section: S, icon: 'fa-table-cells-large', label: 'تخطيط من 3 أعمدة (ملفات + محرر + معاينة)', hint: 'Layout', run: () => self.applyLayout('three') },
                { section: S, icon: 'fa-table-columns', label: 'تخطيط محادثة + محرر', hint: 'Layout', run: () => self.applyLayout('split') },
                { section: S, icon: 'fa-comments', label: 'تخطيط محادثة فقط', hint: 'Layout', run: () => self.applyLayout('chat') },
                { section: S, icon: 'fa-text-height', label: 'تكبير نص الرسائل', hint: 'Zoom', kbd: 'Ctrl+Alt+=', run: () => self.setTextScale((self.getUIPrefs().textScale || 1) + 0.1) },
                { section: S, icon: 'fa-text-slash', label: 'تصغير نص الرسائل', hint: 'Zoom', kbd: 'Ctrl+Alt+-', run: () => self.setTextScale((self.getUIPrefs().textScale || 1) - 0.1) },
                { section: S, icon: 'fa-share-nodes', label: 'مشاركة تخصيص الواجهة', hint: 'Share', run: () => self.shareUIConfig() }
            ]);
        };
    }
    // ------------------------------------------------------------------ SIDEBAR TOOLS: collapsible section (clean layout, state remembered)
    P.toggleSidebarTools = function (open) {
        const nav = document.querySelector('.sidebar-footer-nav'), btn = document.getElementById('tools-toggle');
        if (!nav) return false;
        const on = typeof open === 'boolean' ? open : !nav.classList.contains('open');
        nav.classList.toggle('open', on);
        if (btn) btn.setAttribute('aria-expanded', String(on));
        try { localStorage.setItem('ox_tools_open', on ? '1' : '0'); } catch (e) { /* private mode */ }
        return on;
    };
    P.initSidebarTools = function () { let v = null; try { v = localStorage.getItem('ox_tools_open'); } catch (e) { /* ignore */ } this.toggleSidebarTools(v === '1'); };
    P.initSprint7UI = function () {
        this.getUIPrefs();
        this.initSidebarTools();
        this.installNavExtras();
        this.installResizers();
        const ws = document.getElementById('content-workspace');
        if (ws) ws.classList.toggle('studio-open', !!this.isCodeStudioOpen);
        this.installFab();
        this.installSkipLinks();
        this.installUIListeners();
        this.installFetchWrapper();
        this.observeModals();
        const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 6000));
        if (!(this.isDataSaver && this.isDataSaver())) idle(() => { try { this.preloadUIChunk(); } catch (e) { /* ignore */ } });
        if (this.currentTheme === 'custom') this.applyTheme('custom', true);
        this.applyUIPrefs();
        this.autoAriaLabels(document);
        this.decorateRenderedMessages();
        this.checkUIShareHash();
        const u = this.getUIPrefs();
        const fresh = !(this.sessions || []).some(s => s.messages && s.messages.length);
        if (!u.toured && fresh) this.showBanner({ id: 'tour-offer', icon: 'fa-route', text: '👋 جديد هنا؟ جولة سريعة في 30 ثانية تعرّفك على أهم الميزات.', actions: [{ label: 'ابدأ الجولة', primary: true, run: () => this.startTour() }, { label: 'لاحقاً' }], once: true });
        if (window.matchMedia) {
            try { window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => this.applyUIPrefs()); } catch (e) {}
        }
    };
    if (window.app) {
        try { window.app.initSprint7UI(); } catch (e) { console.error('Sprint 7 UI init failed', e); }
    }
})();
