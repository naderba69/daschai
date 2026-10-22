/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 13: Developer Lab (main-bundle core)
   Everything heavy lives in the lazy chunk src/dev/dev.js → assets/studio/dev-[hash].mjs.
   This file only: lazy stubs + app.dv() • Go/PHP/Ruby detection for the runner (#153) •
   file icon theme (#270) • menu/palette customisation (#258) • extension lint rules,
   commands and keybindings (#209) • settings auto-sync at boot (#208) • #oxrun= links (#230) •
   debugger keys F8/F10/F11 • palette + Alt+I.
   ============================================================================== */
(function () {
    'use strict';
    if (typeof OXAlphaApp === 'undefined') return;
    const P = OXAlphaApp.prototype;
    const ls = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };

    const STUBS = ('openDevLab dvLoad dvRefresh dvRunPoly dvReplayError dvE2EAttach dvOpenShareHash dvExtRun dvExtSnippet dvExtExpandAtCursor '
        + 'dvAutoSyncRun dvTemplateFromFile dvShellExec dvQalamFromFile').split(' ');
    P.ensureDev = async function (opts = {}) {
        try { await this.loadChunk('dev'); return true; } catch (e) {
            console.warn('[OX] dev chunk failed', e);
            if (!opts.quiet) this.showToast('تعذر تحميل مختبر المطوّر — تحقق من الاتصال', 'error');
            return false;
        }
    };
    /** Call a lazy Developer Lab method: app.dv('dvLoad', 'test', 'coverage') */
    P.dv = async function (method, ...args) {
        if (!(await this.ensureDev())) return null;
        const fn = this[method];
        if (typeof fn !== 'function' || fn.__oxLazy) throw new Error('unknown dev method ' + method);
        return fn.apply(this, args);
    };
    STUBS.forEach((name) => {
        if (P[name]) return;
        const stub = function (...args) { return this.dv(name, ...args); };
        stub.__oxLazy = 'dev';
        P[name] = stub;
    });
    P.lazyDevMethods = () => STUBS.slice();

    // ------------------------------------------------------------------ #153 Go / PHP / Ruby files are runnable
    const POLY = { rb: 'ruby', php: 'php', go: 'go' };
    P.dvPolyLang = function (path) { const m = /\.([a-z]+)$/i.exec(String(path || '')); return (m && POLY[m[1].toLowerCase()]) || null; };

    // ------------------------------------------------------------------ #270 file icon themes
    P.iconTheme = function () {
        if (this._iconTheme === undefined) { const t = ls('ox_icon_theme_v1', null); this._iconTheme = t && typeof t === 'object' && t.ext && t.names ? t : null; }
        return this._iconTheme;
    };
    const _fileIcon = P.fileIcon;
    P._fileIconBase = _fileIcon;
    P.fileIcon = function (path) {
        const base = _fileIcon.call(this, path);
        const T = this.iconTheme();
        const extIcons = this.dvExtIcons();
        const name = String(path || '').split('/').pop().toLowerCase(), ext = (/\.([^.]+)$/.exec(name) || [])[1] || '';
        if (!T) return extIcons[ext] || base;
        let hit = T.names[name] || T.ext[ext] || extIcons[ext];
        if (!T.names[name]) for (const s of Object.keys(T.suffix || {})) if (name.endsWith(s) && (!hit || hit === T.ext[ext])) { hit = T.suffix[s]; break; }
        if (hit) return hit;
        if (T.minimal) return ['fa-regular fa-file', '#94a3b8'];
        return T.mono ? [base[0], T.mono] : base;
    };
    /** Folder icon for the explorer: [class, color]. */
    P.folderIcon = function (name, open) {
        const T = this.iconTheme();
        const n = String(name || '').split('/').pop().toLowerCase();
        const hit = T && T.folders && T.folders[n];
        if (hit) return hit;
        return ['fa-solid ' + (open ? 'fa-folder-open' : 'fa-folder'), (T && T.folder) || '#fbbf24'];
    };

    // ------------------------------------------------------------------ #209 extensions (declarative JSON)
    P.dvExtActiveList = function () {
        if (!this._dvExtCache) { const l = ls('ox_dv_ext_v1', []); this._dvExtCache = Array.isArray(l) ? l.filter(x => x && x.enabled !== false) : []; }
        return this._dvExtCache;
    };
    P.dvExtIcons = function () {
        const out = {};
        this.dvExtActiveList().forEach(x => { if (x.icons && typeof x.icons === 'object') Object.entries(x.icons).forEach(([k, v]) => { if (Array.isArray(v) && /^fa-(solid|regular|brands) fa-[a-z0-9-]+$/.test(v[0])) out[k.toLowerCase()] = v; }); });
        return out;
    };
    const keyOf = (e) => [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', (e.key || '').length === 1 ? e.key.toUpperCase() : e.key].filter(Boolean).join('+');
    P.dvExtKeydown = function (e) {
        const list = this.dvExtActiveList();
        if (!list.length) return false;
        const k = keyOf(e);
        if (k === 'Ctrl+Alt+ ' || k === 'Ctrl+Alt+Space') { if (list.some(x => (x.snippets || []).length)) { e.preventDefault(); this.dvExtExpandAtCursor(); return true; } return false; }
        for (const x of list) for (const c of (x.commands || [])) {
            if (c.key && c.key.replace(/\s+/g, '').toLowerCase() === k.toLowerCase()) { e.preventDefault(); this.dvExtRun(x.id, c.id); return true; }
        }
        return false;
    };

    // ------------------------------------------------------------------ #258 menus + palette
    P.applyMenuPrefs = function (items) {
        const list = (items || []).filter(Boolean);
        const seen = ls('ox_dv_menu_seen_v1', []);
        let added = false;
        list.forEach(it => { if (it !== '-' && it.label && !seen.includes(it.label)) { seen.push(it.label); added = true; } });
        if (added) { try { localStorage.setItem('ox_dv_menu_seen_v1', JSON.stringify(seen.slice(-400))); } catch (e) {} }
        const pr = (this.settings && this.settings.menuPrefs) || null;
        if (!pr || (!(pr.hidden || []).length && !(pr.top || []).length)) return list;
        const hidden = new Set(pr.hidden || []), top = pr.top || [];
        const kept = list.filter(it => it === '-' || !hidden.has(it.label));
        const pinned = top.map(l => kept.find(it => it !== '-' && it.label === l)).filter(Boolean);
        let rest = kept.filter(it => !pinned.includes(it));
        rest = rest.filter((it, i) => !(it === '-' && (i === 0 || rest[i - 1] === '-' || i === rest.length - 1)));
        return pinned.length ? [...pinned, ...(rest.length ? ['-'] : []), ...rest] : rest;
    };
    const _showMenu = P.showMenu;
    P.showMenu = function (items, anchor) { return _showMenu.call(this, this.applyMenuPrefs(items), anchor); };

    // ------------------------------------------------------------------ PALETTE + SHORTCUT + BOOT
    const TABS = [['search', 'magnifying-glass', 'بحث Regex'], ['quality', 'spell-check', 'الجودة'], ['run', 'play', 'التشغيل'], ['term', 'terminal', 'الطرفية'],
        ['test', 'vial-circle-check', 'الاختبارات'], ['debug', 'bug', 'المصحح'], ['history', 'clock-rotate-left', 'التاريخ'], ['refactor', 'diagram-project', 'إعادة الهيكلة'],
        ['custom', 'sliders', 'التخصيص'], ['arabic', 'pen-nib', 'قلم']];
    P.DEV_TABS = TABS.map(([id, icon, label]) => ({ id, icon: 'fa-' + icon, label }));
    const _pal = P.buildPaletteCommands;
    P.buildPaletteCommands = function () {
        const self = this, S = 'مختبر المطوّر';
        let cmds = _pal.apply(this, arguments).concat(TABS.map(([id, icon, label]) => ({ section: S, icon: 'fa-' + icon, label: 'مطوّر — ' + label, hint: id, run: () => self.openDevLab(id) })));
        this.dvExtActiveList().forEach(x => (x.commands || []).forEach(c => { if (c && c.title) cmds.push({ section: '🧩 ' + x.name, icon: 'fa-puzzle-piece', label: c.title, hint: x.name, kbd: c.key || '', run: () => self.dvExtRun(x.id, c.id) }); }));
        const hid = (this.settings && this.settings.menuPrefs && this.settings.menuPrefs.palHidden) || [];
        if (hid.length) { const h = new Set(hid); cmds = cmds.filter(c => !h.has(c.label)); }
        return cmds;
    };
    P.handleDevHash = function (hash = location.hash) {
        if (/^#oxrun=/.test(hash)) { const h = hash; try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} return this.dvOpenShareHash(h); }
        return null;
    };
    P.initSprint13Dev = function () {
        window.addEventListener('hashchange', () => { this.handleDevHash(); });
        if (/^#oxrun=/.test(location.hash)) setTimeout(() => { this.handleDevHash(); }, 120);
        window.addEventListener('keydown', (e) => {
            if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key || '').toLowerCase() === 'i') { e.preventDefault(); this.openDevLab(); return; }
            if (/^F(8|10|11)$/.test(e.key || '') && this._dvx && this._dvx.tab === 'debug' && document.getElementById('dvx-root') && this.dvDebugKey && !this.dvDebugKey.__oxLazy) { this.dvDebugKey(e); return; }
            if ((e.ctrlKey || e.metaKey) && e.altKey) this.dvExtKeydown(e);
        });
        if (this.BUILTIN_SHORTCUTS && !this.BUILTIN_SHORTCUTS.some(x => x[0] === 'Alt+I')) this.BUILTIN_SHORTCUTS.push(['Alt+I', 'مختبر المطوّر']);
        window.addEventListener('storage', (e) => { if (e.key === 'ox_icon_theme_v1') this._iconTheme = undefined; if (e.key === 'ox_dv_ext_v1') this._dvExtCache = null; });
        const s = this.settings || {};
        if (s.dvAutoSync && s.syncGistId && String(s.githubToken || '').trim()) setTimeout(() => { this.ensureDev({ quiet: true }).then(ok => ok && this.dvAutoSyncRun()).catch(() => {}); }, 6000);
    };
    if (window.app) {
        try { window.app.initSprint13Dev(); } catch (e) { console.error('Sprint 13 init failed', e); }
    }
})();
