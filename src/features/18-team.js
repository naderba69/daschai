/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 11: Team & Analytics hub (main-bundle core)
   Everything lives in the lazy chunk src/team/team.js → assets/studio/team-[hash].mjs.
   This file only: lazy stubs + app.tm() • #oxsnip= / #oxteam= / #oxlive= links •
   live-session write hook • read-only rules + live locks write guard • palette + Alt+E.
   ============================================================================== */
(function () {
    'use strict';
    if (typeof OXAlphaApp === 'undefined') return;
    const P = OXAlphaApp.prototype;

    const STUBS = 'openTeamHub tmLoad tmRefresh tmOpenSnip tmOpenInviteHash tmOpenLiveHash tmWatchStart tmPoll tmSend tmCreateSnippet tmGameEvent'.split(' ');
    P.ensureTeam = async function (opts = {}) {
        try { await this.loadChunk('team'); return true; } catch (e) {
            console.warn('[OX] team chunk failed', e);
            if (!opts.quiet) this.showToast('تعذر تحميل أدوات الفريق والتحليلات — تحقق من الاتصال', 'error');
            return false;
        }
    };
    /** Call a lazy Team method: app.tm('tmLoad', 'engage', 'polls') */
    P.tm = async function (method, ...args) {
        if (!(await this.ensureTeam(args[args.length - 1] && args[args.length - 1].__quiet ? { quiet: true } : {}))) return null;
        const fn = this[method];
        if (typeof fn !== 'function' || fn.__oxLazy) throw new Error('unknown team method ' + method);
        return fn.apply(this, args);
    };
    STUBS.forEach((name) => {
        if (P[name]) return;
        const stub = function (...args) { return this.tm(name, ...args); };
        stub.__oxLazy = 'team';
        P[name] = stub;
    });
    P.lazyTeamMethods = () => STUBS.slice();

    // ------------------------------------------------------------------ WRITE GUARD + LIVE HOOK
    const ALLOWED = new Set(['live', 'github', 'restore', 'import', 'template', 'team', 'undo', 'sync', 'pull', 'suggestion']);
    const globRe = (glob) => {
        let g = String(glob || '').trim().replace(/^\/+/, ''), re = '';
        if (!g) return /^$/;
        if (g.endsWith('/')) g += '**';
        for (let i = 0; i < g.length; i++) {
            const c = g[i];
            if (c === '*') { if (g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; } else re += '[^/]*'; }
            else if (c === '?') re += '[^/]';
            else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        }
        return g.includes('/') ? new RegExp('^' + re + '$') : new RegExp('(^|/)' + re + '$');
    };
    /** Read-only patterns for the current repo/login, cached until tmSyncRules clears `_teamRules`. */
    P.teamReadonly = function () {
        if (!this._teamRules) {
            let r = null; try { r = JSON.parse(localStorage.getItem('ox_team_rules_v1')); } catch (e) { r = null; }
            let key = ''; try { const g = this.ghRepo ? this.ghRepo() : {}; key = `${g.owner}/${g.repo}`; } catch (e) { key = ''; }
            this._teamRules = { key, res: r && r.repo === key ? (r.readonly || []).map(globRe) : [] };
        }
        return this._teamRules.res;
    };
    /** Why a local write to `path` is blocked (null = allowed). */
    P.teamWriteBlock = function (path) {
        const lk = this._teamLocks && this._teamLocks[path];
        if (lk && this._teamLive && lk.site !== this._teamLive.site) return `🔒 ${path} محجوز الآن بواسطة ${lk.by || 'زميل'}`;
        const ro = this.teamReadonly();
        if (ro.length && ro.some(re => re.test(String(path).replace(/^\/+/, '')))) return `👁️ ليست لديك صلاحية تعديل ${path} في هذا الفريق`;
        return null;
    };
    const _onWrite = P.onProjectFileWrite;
    P.onProjectFileWrite = function (path, prev, next) {
        const reason = this._writeReason || (this._typingInStudio ? 'edit' : 'external');
        if (!ALLOWED.has(reason) && (!prev || !next || prev.content !== next.content)) {
            const why = this.teamWriteBlock(path);
            if (why) {
                this._suspendFileHooks = true;
                try { if (prev) this.virtualProjectFiles.set(path, prev); else this.virtualProjectFiles.delete(path); } finally { this._suspendFileHooks = false; }
                if (prev && path === this.activeStudioFile && this.codeEditor && this.codeEditor.setValue) try { this.codeEditor.setValue(prev.content || ''); } catch (e) {}
                if (Date.now() - (this._tmGuardToast || 0) > 1500) { this._tmGuardToast = Date.now(); this.showToast(this.escapeHTML(why), 'warning'); }
                return;
            }
        }
        const r = _onWrite.apply(this, arguments);
        if (this._teamLive && reason !== 'live' && this.teamLiveOnWrite && !this.teamLiveOnWrite.__oxLazy) try { this.teamLiveOnWrite(path, prev, next); } catch (e) { console.warn('[OX] live sync', e); }
        return r;
    };

    // ------------------------------------------------------------------ PALETTE + LINKS + SHORTCUT
    const TABS = [['team', 'people-group', 'الفريق'], ['chat', 'comments', 'المحادثة'], ['live', 'tower-broadcast', 'تعاون حي'], ['review', 'code-pull-request', 'المراجعة'],
        ['share', 'share-from-square', 'مشاركة الكود'], ['engage', 'square-poll-vertical', 'التفاعل'], ['modes', 'gamepad', 'الأوضاع'], ['ai', 'robot', 'AI عضو الفريق'],
        ['analytics', 'chart-pie', 'تحليل المشروع'], ['growth', 'seedling', 'النمو الشخصي'], ['reports', 'file-contract', 'التقارير']];
    P.TEAM_TABS = TABS.map(([id, icon, label]) => ({ id, icon: 'fa-' + icon, label }));
    const _pal = P.buildPaletteCommands;
    P.buildPaletteCommands = function () {
        const self = this, S = 'الفريق والتحليلات';
        return _pal.apply(this, arguments).concat(TABS.map(([id, icon, label]) => ({ section: S, icon: 'fa-' + icon, label: 'فريق — ' + label, hint: id, run: () => self.openTeamHub(id) })));
    };
    P.handleTeamHash = function (hash = location.hash) {
        const clear = () => { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} };
        if (/^#oxsnip=/.test(hash)) return this.tmOpenSnip(hash);
        if (/^#oxteam=/.test(hash)) { clear(); return this.tmOpenInviteHash(hash); }
        if (/^#oxlive=/.test(hash)) { clear(); return this.tmOpenLiveHash(hash); }
        return null;
    };
    P.initSprint11Team = function () {
        window.addEventListener('hashchange', () => { this.handleTeamHash(); });
        if (/^#ox(snip|team|live)=/.test(location.hash)) setTimeout(() => { this.handleTeamHash(); }, 90);
        window.addEventListener('keydown', (e) => {
            if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key || '').toLowerCase() !== 'e') return;
            e.preventDefault();
            this.openTeamHub();
        });
        if (this.BUILTIN_SHORTCUTS && !this.BUILTIN_SHORTCUTS.some(x => x[0] === 'Alt+E')) this.BUILTIN_SHORTCUTS.push(['Alt+E', 'الفريق والتحليلات']);
        // Background watch (#740/#745/#798) resumes only if the user turned it on before
        let watch = null; try { watch = JSON.parse(localStorage.getItem('ox_team_watch_v1')); } catch (e) {}
        if (watch && watch.on) setTimeout(() => { this.tm('tmWatchStart', undefined, { __quiet: true }).catch(() => {}); }, 8000);
    };
    if (window.app) {
        try { window.app.initSprint11Team(); } catch (e) { console.error('Sprint 11 init failed', e); }
    }
})();
