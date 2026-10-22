/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 7b: Conversation management
   Ideas implemented (THOUSAND_IDEAS.md):
     #304 global search   #305 conversation filters   #306 smart sort   #307 grid / list view
     #342 recent searches   #343 favorite messages   #344 tags   #345 folders   #346 archive
     #347 pin   #348 mute   #349 bulk delete   #350 trash + restore   #351 split compare
     #384 message links (#s=…&m=…)   #289 session/message context menus   #310 session hover cards
   ============================================================================== */
(function () {
    'use strict';
    if (typeof OXAlphaApp === 'undefined') return;
    const P = OXAlphaApp.prototype;
    const DAY = 864e5;
    const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
    const VIEW_KEY = 'ox_alpha_session_view';
    const RECENT_KEY = 'ox_alpha_recent_searches';
    const FOLDERS_KEY = 'ox_alpha_folders';
    const TRASH_KEY = 'trash_v1';
    const TRASH_DAYS = 30;
    const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
    const plain = (s) => String(s || '').replace(/```[\s\S]*?```/g, ' [كود] ').replace(/[#*_>`~]+/g, ' ').replace(/\s+/g, ' ').trim();
    const sod = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

    // ------------------------------------------------------------------ VIEW STATE
    P.getSessionView = function () {
        if (!this._sessView) this._sessView = { filter: 'all', tag: '', folder: '', sort: 'updated', query: '', collapsed: {}, ...lsGet(VIEW_KEY, {}) };
        return this._sessView;
    };
    P.setSessionView = function (patch) {
        const v = Object.assign(this.getSessionView(), patch || {});
        const { query, ...persist } = v;
        lsSet(VIEW_KEY, persist);
        this.renderSessionList();
        return v;
    };
    P.findSession = function (id) { return (this.sessions || []).find(s => s.id === id) || null; };
    P.sessionTime = function (s) { return s.updatedAt || (s.messages && s.messages.length && s.messages[s.messages.length - 1].timestamp) || s.createdAt || 0; };
    P.sessionHasCode = function (s) { return (s.messages || []).some(m => /```/.test(m.content || '')); };
    P.sessionHasFavorites = function (s) { return (s.messages || []).some(m => m.fav); };
    P.sessionMatches = function (s, q) {
        q = String(q || '').toLowerCase().trim();
        if (!q) return true;
        if ((s.title || '').toLowerCase().includes(q)) return true;
        if ((s.tags || []).some(t => t.toLowerCase().includes(q.replace(/^#/, '')))) return true;
        if ((s.folder || '').toLowerCase().includes(q)) return true;
        let budget = 200000;
        for (const m of (s.messages || [])) {
            const c = String(m.content || '');
            if (c.toLowerCase().includes(q)) return true;
            budget -= c.length;
            if (budget < 0) break;
        }
        return false;
    };
    /** Smart score (#306): recency + activity + favorites, pinned always first. */
    P.smartScore = function (s, now = Date.now()) {
        const age = Math.max(0, now - this.sessionTime(s)) / DAY;
        const msgs = (s.messages || []).length;
        return Math.exp(-age / 5) * 3 + Math.log1p(msgs) * 0.4 + (this.sessionHasFavorites(s) ? 0.6 : 0) + (s.id === this.activeSessionId ? 0.5 : 0) - (s.muted ? 0.3 : 0);
    };
    P.filteredSessions = function (view = this.getSessionView(), now = Date.now()) {
        let list = (this.sessions || []).slice();
        const f = view.filter || 'all';
        list = list.filter(s => {
            if (f === 'archived') return !!s.archived;
            if (s.archived && s.id !== this.activeSessionId) return false;
            if (f === 'pinned') return !!s.pinned;
            if (f === 'fav') return this.sessionHasFavorites(s);
            if (f === 'code') return this.sessionHasCode(s);
            if (f === 'muted') return !!s.muted;
            if (f === 'today') return this.sessionTime(s) >= sod(now);
            if (f === 'week') return this.sessionTime(s) >= now - 7 * DAY;
            return true;
        });
        if (view.tag) list = list.filter(s => (s.tags || []).includes(view.tag));
        if (view.folder) list = list.filter(s => (s.folder || '') === view.folder);
        if (view.query) list = list.filter(s => this.sessionMatches(s, view.query));
        const cmp = {
            updated: (a, b) => this.sessionTime(b) - this.sessionTime(a),
            created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
            title: (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ar'),
            messages: (a, b) => (b.messages || []).length - (a.messages || []).length,
            smart: (a, b) => this.smartScore(b, now) - this.smartScore(a, now)
        }[view.sort] || ((a, b) => this.sessionTime(b) - this.sessionTime(a));
        return list.sort((a, b) => (!!b.pinned - !!a.pinned) || cmp(a, b));
    };
    P.allTags = function () { const m = new Map(); (this.sessions || []).forEach(s => (s.tags || []).forEach(t => m.set(t, (m.get(t) || 0) + 1))); return Array.from(m.entries()).sort((a, b) => b[1] - a[1]); };
    P.allFolders = function () { return Array.from(new Set([...(lsGet(FOLDERS_KEY, [])), ...(this.sessions || []).map(s => s.folder).filter(Boolean)])).sort((a, b) => a.localeCompare(b, 'ar')); };

    // ------------------------------------------------------------------ SIDEBAR LIST (pin/tags/folders/archive/mute)
    P.sessionRowHTML = function (s) {
        const esc = (x) => this.escapeHTML(x);
        const isActive = s.id === this.activeSessionId;
        const streaming = this.activeStreams && this.activeStreams.has(s.id);
        const id = esc(s.id);
        const tags = (s.tags || []).slice(0, 2).map(t => `<span class="sess-tag" style="--tag-h:${hue(t)}">#${esc(t)}</span>`).join('');
        return `<div class="session-item-row ${isActive ? 'active' : ''} ${s.pinned ? 'pinned' : ''} ${s.archived ? 'archived' : ''}" data-sid="${id}" role="button" tabindex="0" aria-current="${isActive ? 'true' : 'false'}" onclick="app.switchSession('${id}')">
                <i class="fa-${s.pinned ? 'solid fa-thumbtack' : s.archived ? 'solid fa-box-archive' : 'regular fa-message'}" style="font-size:0.8rem; margin-left:6px;" aria-hidden="true"></i>
                <span class="session-title-text">${esc(s.title || 'محادثة')}</span>${tags}
                ${s.muted ? '<i class="fa-solid fa-bell-slash sess-muted" aria-label="مكتومة"></i>' : ''}
                ${streaming ? '<span class="session-streaming-pulse" title="جاري التوليد..."></span>' : ''}
                <div class="session-actions-btns">
                    <button class="sess-act" onclick="event.stopPropagation(); app.togglePinSession('${id}')" title="${s.pinned ? 'إلغاء التثبيت' : 'تثبيت'}" aria-label="${s.pinned ? 'إلغاء التثبيت' : 'تثبيت'}"><i class="fa-solid fa-thumbtack"></i></button>
                    <button class="sess-act" onclick="event.stopPropagation(); app.openSessionMenu('${id}', this)" title="المزيد" aria-label="خيارات المحادثة"><i class="fa-solid fa-ellipsis"></i></button>
                    <button class="sess-act" onclick="app.deleteSession('${id}', event)" title="حذف" aria-label="حذف"><i class="fa-regular fa-trash-can"></i></button>
                </div>
            </div>`;
    };
    P.renderSessionFilterBar = function () {
        const host = document.querySelector('.sidebar-search-container');
        if (!host) return;
        let bar = document.getElementById('sess-filter-bar');
        if (!bar) { bar = document.createElement('div'); bar.id = 'sess-filter-bar'; bar.className = 'sess-filter-bar'; host.appendChild(bar); }
        const v = this.getSessionView();
        const chips = [['all', 'الكل'], ['pinned', '📌'], ['fav', '⭐'], ['code', '</>'], ['today', 'اليوم'], ['archived', '🗄️']];
        const tags = this.allTags();
        bar.innerHTML = `<div class="sess-chips" role="tablist" aria-label="تصفية المحادثات">${chips.map(([id, l]) => `<button role="tab" aria-selected="${v.filter === id}" class="sess-chip ${v.filter === id ? 'active' : ''}" onclick="app.setSessionView({filter:'${id}'})" title="${{ all: 'كل المحادثات', pinned: 'المثبتة', fav: 'بها رسائل مفضلة', code: 'تحتوي كوداً', today: 'نشطة اليوم', archived: 'المؤرشفة' }[id]}">${this.escapeHTML(l)}</button>`).join('')}</div>
            <div class="sess-tools">
                <select class="sess-sort" aria-label="ترتيب" onchange="app.setSessionView({sort:this.value})">${[['updated', 'الأحدث'], ['smart', 'ذكي ✨'], ['created', 'تاريخ الإنشاء'], ['title', 'الاسم'], ['messages', 'الأطول']].map(([id, l]) => `<option value="${id}" ${v.sort === id ? 'selected' : ''}>${l}</option>`).join('')}</select>
                ${tags.length ? `<select class="sess-sort" aria-label="وسم" onchange="app.setSessionView({tag:this.value})"><option value="">كل الوسوم</option>${tags.map(([t, n]) => `<option value="${this.escapeHTML(t)}" ${v.tag === t ? 'selected' : ''}>#${this.escapeHTML(t)} (${n})</option>`).join('')}</select>` : ''}
                <button class="sess-chip" onclick="app.openConversationManager()" title="مدير المحادثات (Alt+C)" aria-label="مدير المحادثات"><i class="fa-solid fa-table-cells"></i></button>
                <button class="sess-chip" onclick="app.openTrash()" title="سلة المهملات" aria-label="سلة المهملات"><i class="fa-solid fa-trash-arrow-up"></i>${this.trashCount() ? `<span class="sess-count">${this.trashCount()}</span>` : ''}</button>
            </div>`;
    };
    P.renderSessionList = function () {
        const list = document.getElementById('sessions-list');
        if (!list) return;
        this.renderSessionFilterBar();
        const v = this.getSessionView();
        const items = this.filteredSessions(v);
        if (!items.length) {
            list.innerHTML = `<div class="sess-empty"><i class="fa-regular fa-folder-open"></i><span>${v.query ? `لا نتائج لـ «${this.escapeHTML(v.query)}»` : 'لا توجد محادثات في هذا العرض'}</span>${v.filter !== 'all' || v.tag ? `<button class="fx-link" onclick="app.setSessionView({filter:'all', tag:'', folder:''})">عرض الكل</button>` : ''}</div>`;
            return;
        }
        const pinned = items.filter(s => s.pinned);
        const rest = items.filter(s => !s.pinned);
        const useFolders = v.filter !== 'archived' && rest.some(s => s.folder);
        const group = (key, title, icon, arr) => {
            const collapsed = !!(v.collapsed || {})[key];
            return `<div class="sess-group" data-group="${this.escapeHTML(key)}"><button class="sess-group-head" aria-expanded="${!collapsed}" onclick="app.toggleSessionGroup('${this.escapeHTML(key).replace(/'/g, '&#39;')}')"><i class="fa-solid ${collapsed ? 'fa-chevron-left' : 'fa-chevron-down'}" aria-hidden="true"></i><i class="fa-solid ${icon}" aria-hidden="true"></i><span>${this.escapeHTML(title)}</span><small>${arr.length}</small></button>${collapsed ? '' : arr.map(s => this.sessionRowHTML(s)).join('')}</div>`;
        };
        let html = '';
        if (pinned.length) html += group('__pinned', 'المثبتة', 'fa-thumbtack', pinned);
        if (useFolders) {
            const folders = new Map();
            rest.forEach(s => { const f = s.folder || ''; if (!folders.has(f)) folders.set(f, []); folders.get(f).push(s); });
            Array.from(folders.keys()).sort((a, b) => (!a) - (!b) || a.localeCompare(b, 'ar')).forEach(f => { html += group(f ? 'f:' + f : '__none', f || 'بدون مجلد', f ? 'fa-folder' : 'fa-inbox', folders.get(f)); });
        } else html += (pinned.length ? `<div class="sess-group-label">المحادثات</div>` : '') + rest.map(s => this.sessionRowHTML(s)).join('');
        list.innerHTML = html;
    };
    P.toggleSessionGroup = function (key) { const c = { ...(this.getSessionView().collapsed || {}) }; c[key] = !c[key]; this.setSessionView({ collapsed: c }); return c[key]; };
    P.filterSessions = function (query) {
        const q = String(query || '').trim();
        this.getSessionView().query = q;
        this.renderSessionList();
        clearTimeout(this._recentT);
        if (q.length >= 2) this._recentT = setTimeout(() => this.addRecentSearch(q), 1500);
        this.renderRecentSearches();
        return this.filteredSessions().length;
    };

    // ------------------------------------------------------------------ SESSION ACTIONS
    P.updateSessionMeta = function (id, patch, opts = {}) {
        const s = this.findSession(id);
        if (!s) return null;
        Object.assign(s, patch);
        this.saveSessions();
        this.renderSessionList();
        if (opts.toast) this.showToast(opts.toast, 'success');
        return s;
    };
    P.togglePinSession = function (id) { const s = this.findSession(id); if (!s) return false; this.updateSessionMeta(id, { pinned: !s.pinned }); if (this.haptic) this.haptic(10); return s.pinned; };
    P.toggleArchiveSession = function (id) {
        const s = this.findSession(id);
        if (!s) return false;
        const archived = !s.archived;
        this.updateSessionMeta(id, { archived, pinned: archived ? false : s.pinned });
        if (archived && this.activeSessionId === id) {
            const next = this.sessions.find(x => !x.archived && x.id !== id);
            if (next) this.switchSession(next.id);
        }
        this.showToast(archived ? '🗄️ أُرشفت المحادثة' : '📤 أُعيدت من الأرشيف', 'info', archived ? { action: { label: 'تراجع', run: () => this.toggleArchiveSession(id) } } : {});
        return archived;
    };
    P.toggleMuteSession = function (id) { const s = this.findSession(id); if (!s) return false; this.updateSessionMeta(id, { muted: !s.muted }, { toast: !s.muted ? '🔔 أُلغي كتم المحادثة' : '🔕 كُتمت أصوات وإشعارات هذه المحادثة' }); return s.muted; };
    P.parseTags = function (text) { return Array.from(new Set(String(text || '').split(/[,،\s]+/).map(t => t.replace(/^#/, '').trim().slice(0, 24)).filter(Boolean))).slice(0, 8); };
    P.setSessionTags = function (id, tags) { return this.updateSessionMeta(id, { tags: Array.isArray(tags) ? this.parseTags(tags.join(',')) : this.parseTags(tags) }); };
    P.editSessionTags = async function (id) {
        const s = this.findSession(id);
        if (!s) return false;
        const known = this.allTags().map(([t]) => '#' + t).slice(0, 8).join(' ');
        const v = await this.askText(`🏷️ وسوم المحادثة (افصل بفاصلة)${known ? ` — مستخدمة: ${known}` : ''}`, (s.tags || []).join(', '), { dir: 'auto' });
        if (v == null) return false;
        this.setSessionTags(id, v);
        return true;
    };
    P.setSessionFolder = function (id, folder) {
        folder = String(folder || '').trim().slice(0, 40);
        if (folder) { const f = lsGet(FOLDERS_KEY, []); if (!f.includes(folder)) { f.push(folder); lsSet(FOLDERS_KEY, f.slice(-50)); } }
        return this.updateSessionMeta(id, { folder });
    };
    P.moveSessionToFolder = function (id, anchor) {
        const folders = this.allFolders();
        const s = this.findSession(id);
        const newFolder = async () => { const name = await this.askText('📁 اسم المجلد الجديد', '', { dir: 'auto' }); if (name && name.trim()) this.setSessionFolder(id, name); };
        this.showMenu([
            ...folders.map(f => ({ icon: (s && s.folder === f) ? 'fa-folder-open' : 'fa-folder', label: f, run: () => this.setSessionFolder(id, f) })),
            folders.length ? '-' : null,
            { icon: 'fa-folder-plus', label: 'مجلد جديد…', run: newFolder },
            s && s.folder ? { icon: 'fa-inbox', label: 'إزالة من المجلد', run: () => this.setSessionFolder(id, '') } : null
        ], anchor || { x: 120, y: 160 });
    };
    P.renameSessionPrompt = async function (id) {
        const s = this.findSession(id);
        if (!s) return false;
        const t = await this.askText('✏️ عنوان المحادثة', s.title || '', { dir: 'auto' });
        if (!t || !t.trim()) return false;
        this.updateSessionMeta(id, { title: t.trim().slice(0, 120) });
        if (this.renderTopTabs) try { this.renderTopTabs(); } catch (e) {}
        return true;
    };
    P.duplicateSession = function (id) {
        const s = this.findSession(id);
        if (!s) return null;
        const copy = JSON.parse(JSON.stringify(s));
        copy.id = 'session_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        copy.title = (s.title || 'محادثة') + ' (نسخة)';
        copy.createdAt = copy.updatedAt = Date.now();
        copy.pinned = false; copy.archived = false;
        this.sessions.unshift(copy);
        this.saveSessions();
        this.renderSessionList();
        this.showToast('📄 تم تكرار المحادثة', 'success');
        return copy;
    };
    P.exportSessionsJSON = function (ids) {
        const list = ids.map(id => this.findSession(id)).filter(Boolean);
        if (!list.length) return 0;
        const blob = new Blob([JSON.stringify({ app: 'ox-alpha', kind: 'sessions', exportedAt: Date.now(), sessions: list }, null, 2)], { type: 'application/json' });
        this.downloadBlob(blob, list.length === 1 ? `chat-${(list[0].title || 'session').replace(/[^\w\u0600-\u06FF-]+/g, '_').slice(0, 40)}.json` : `chats-${list.length}.json`);
        return list.length;
    };
    P.sessionMenuItems = function (id) {
        const s = this.findSession(id);
        if (!s) return [];
        return [
            { icon: 'fa-pen', label: 'إعادة تسمية', run: () => this.renameSessionPrompt(id) },
            { icon: 'fa-thumbtack', label: s.pinned ? 'إلغاء التثبيت' : 'تثبيت في الأعلى', run: () => this.togglePinSession(id) },
            { icon: 'fa-tags', label: 'الوسوم…', run: () => this.editSessionTags(id) },
            { icon: 'fa-folder', label: 'نقل إلى مجلد…', run: () => this.moveSessionToFolder(id) },
            { icon: s.muted ? 'fa-bell' : 'fa-bell-slash', label: s.muted ? 'إلغاء الكتم' : 'كتم الأصوات والإشعارات', run: () => this.toggleMuteSession(id) },
            { icon: 'fa-box-archive', label: s.archived ? 'إلغاء الأرشفة' : 'أرشفة', run: () => this.toggleArchiveSession(id) },
            { icon: 'fa-clone', label: 'تكرار', run: () => this.duplicateSession(id) },
            { icon: 'fa-code-compare', label: 'مقارنة مع محادثة أخرى', run: () => this.openCompareSessions(id) },
            { icon: 'fa-file-export', label: 'تصدير JSON', run: () => this.exportSessionsJSON([id]) },
            '-',
            { icon: 'fa-trash-can', label: 'حذف (إلى السلة)', danger: true, run: () => this.deleteSession(id) }
        ];
    };
    P.sessionHoverHTML = function (id) {
        const s = this.findSession(id);
        if (!s) return '';
        const esc = (x) => this.escapeHTML(x);
        const msgs = s.messages || [];
        const users = msgs.filter(m => m.role === 'user').length;
        const lastBot = msgs.slice().reverse().find(m => m.role === 'assistant');
        const firstUser = msgs.find(m => m.role === 'user');
        const fav = msgs.filter(m => m.fav).length;
        return `<div class="hc-session"><b>${esc(s.title || 'محادثة')}</b>
            <div class="hc-meta"><span><i class="fa-regular fa-comments"></i> ${msgs.length} رسالة (${users} منك)</span>${fav ? `<span>⭐ ${fav}</span>` : ''}${s.mode && this.CHAT_MODES && this.CHAT_MODES[s.mode] ? `<span><i class="fa-solid ${this.CHAT_MODES[s.mode].icon}"></i> ${esc(this.CHAT_MODES[s.mode].label)}</span>` : ''}</div>
            ${firstUser ? `<p class="hc-snippet">${esc(plain(firstUser.content).slice(0, 140))}</p>` : '<p class="hc-snippet gh-muted">محادثة فارغة</p>'}
            <div class="hc-meta"><span>أُنشئت ${s.createdAt ? new Date(s.createdAt).toLocaleDateString('ar') : '—'}</span><span>آخر نشاط ${this.relTime ? this.relTime(this.sessionTime(s)) : ''}</span></div>
            ${lastBot && lastBot.model ? `<div class="hc-meta"><span><i class="fa-solid fa-microchip"></i> ${esc(lastBot.model)}</span></div>` : ''}
            ${(s.tags || []).length || s.folder ? `<div class="hc-meta">${s.folder ? `<span><i class="fa-solid fa-folder"></i> ${esc(s.folder)}</span>` : ''}${(s.tags || []).map(t => `<span class="sess-tag" style="--tag-h:${hue(t)}">#${esc(t)}</span>`).join('')}</div>` : ''}</div>`;
    };

    // ------------------------------------------------------------------ TRASH (#350) + DELETE WITH UNDO
    P.loadTrash = async function () {
        if (this._trash) return this._trash;
        let t = [];
        try { t = (this.idbGet ? await this.idbGet(TRASH_KEY) : null) || []; } catch (e) {}
        this._trash = (this._trash || []).concat(Array.isArray(t) ? t : []);
        this.purgeTrash();
        return this._trash;
    };
    P.saveTrash = function () { try { if (this.idbSet) this.idbSet(TRASH_KEY, this._trash || []).catch(() => {}); } catch (e) {} };
    P.trashCount = function () { return (this._trash || []).length; };
    P.purgeTrash = function (now = Date.now()) {
        const before = (this._trash || []).length;
        this._trash = (this._trash || []).filter(e => e && e.session && now - e.deletedAt < TRASH_DAYS * DAY).slice(0, 50);
        if (this._trash.length !== before) this.saveTrash();
        return before - this._trash.length;
    };
    P.addToTrash = function (session) {
        this._trash = this._trash || [];
        this._trash = this._trash.filter(e => e.session.id !== session.id);
        this._trash.unshift({ session: JSON.parse(JSON.stringify(session)), deletedAt: Date.now() });
        if (this._trash.length > 50) this._trash.length = 50;
        this.saveTrash();
    };
    P.restoreFromTrash = function (id, opts = {}) {
        const i = (this._trash || []).findIndex(e => e.session.id === id);
        if (i < 0) return false;
        const [e] = this._trash.splice(i, 1);
        this.saveTrash();
        if (!this.findSession(id)) this.sessions.unshift(e.session);
        this.saveSessions();
        if (opts.switch !== false) this.switchSession(id); else this.renderUIState();
        if (!opts.silent) this.showToast('♻️ استُعيدت المحادثة', 'success');
        if (document.getElementById('trash-list')) this.renderTrash();
        return true;
    };
    P.deleteForever = function (id) { const n = (this._trash || []).length; this._trash = (this._trash || []).filter(e => e.session.id !== id); this.saveTrash(); if (document.getElementById('trash-list')) this.renderTrash(); return n !== this._trash.length; };
    P.emptyTrash = function () { const n = (this._trash || []).length; this._trash = []; this.saveTrash(); if (document.getElementById('trash-list')) this.renderTrash(); this.renderSessionList(); return n; };
    const _origDelete = P.deleteSession;
    P.removeSessionQuiet = function (id) {
        const had = Object.prototype.hasOwnProperty.call(this, 'showToast'), prev = this.showToast;
        this.showToast = () => null;
        try { _origDelete.call(this, id); } finally { if (had) this.showToast = prev; else delete this.showToast; }
    };
    P.deleteSession = function (sessionId, ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        const s = this.findSession(sessionId);
        if (!s) return false;
        const keep = s.messages && s.messages.length;
        if (keep) this.addToTrash(s);
        this.removeSessionQuiet(sessionId);
        if (keep) this.showToast('🗑️ نُقلت المحادثة إلى سلة المهملات', 'info', { action: { label: 'تراجع', run: () => this.restoreFromTrash(sessionId) } });
        else this.showToast('تم حذف المحادثة 🗑️', 'info');
        return true;
    };
    P.bulkDeleteSessions = function (ids) {
        const list = ids.filter(id => this.findSession(id));
        list.forEach(id => { const s = this.findSession(id); if (s.messages && s.messages.length) this.addToTrash(s); this.removeSessionQuiet(id); });
        if (list.length) this.showToast(`🗑️ نُقلت ${list.length} محادثة إلى السلة`, 'info', { action: { label: 'تراجع', run: () => { list.forEach(id => this.restoreFromTrash(id, { switch: false, silent: true })); this.showToast('♻️ استُعيدت المحادثات', 'success'); } } });
        return list.length;
    };

    // ------------------------------------------------------------------ MESSAGES: favorites (#343), links (#384), context menu items
    P.findMessage = function (msgId, sessionId) {
        const sessions = sessionId ? [this.findSession(sessionId)].filter(Boolean) : [this.findSession(this.activeSessionId), ...(this.sessions || [])].filter(Boolean);
        for (const s of sessions) {
            const msgs = s.messages || [];
            let index = msgs.findIndex(m => m.id === msgId);
            if (index < 0 && /^idx\d+$/.test(msgId || '') && s.id === this.activeSessionId) index = +msgId.slice(3);
            if (index >= 0 && msgs[index]) return { session: s, msg: msgs[index], index };
        }
        return null;
    };
    P.toggleFavoriteMessage = function (msgId, sessionId) {
        const f = this.findMessage(msgId, sessionId);
        if (!f) return null;
        f.msg.fav = !f.msg.fav;
        if (!f.msg.fav) delete f.msg.fav;
        this.saveSessions();
        const row = document.getElementById('m-' + msgId);
        if (row) row.classList.toggle('is-fav', !!f.msg.fav);
        this.showToast(f.msg.fav ? '⭐ أُضيفت للمفضلة' : 'أُزيلت من المفضلة', 'info');
        if (document.getElementById('fav-list')) this.renderFavorites();
        return !!f.msg.fav;
    };
    P.favoriteMessages = function () {
        const out = [];
        (this.sessions || []).forEach(s => (s.messages || []).forEach(m => { if (m.fav) out.push({ session: s, msg: m }); }));
        return out.sort((a, b) => (b.msg.timestamp || 0) - (a.msg.timestamp || 0));
    };
    P.messageLink = function (sessionId, msgId) { return `${location.origin}${location.pathname}#s=${encodeURIComponent(sessionId)}&m=${encodeURIComponent(msgId)}`; };
    P.parseMessageHash = function (hash) { const m = String(hash || '').match(/[#&]s=([^&]+)&m=([^&]+)/); return m ? { sessionId: decodeURIComponent(m[1]), msgId: decodeURIComponent(m[2]) } : null; };
    P.goToMessage = function (sessionId, msgId) {
        const f = this.findMessage(msgId, sessionId);
        if (!f) { this.showToast('الرسالة غير موجودة (ربما حُذفت)', 'warning'); return false; }
        if (f.session.archived) f.session.archived = false;
        if (this.activeSessionId !== sessionId) this.switchSession(sessionId);
        const need = f.session.messages.length - f.index;
        if (need > (this._msgWindow || 50)) { this._msgWindowSession = sessionId; this._msgWindow = need + 5; this.renderMessages(); }
        const row = document.getElementById('m-' + msgId);
        if (!row) return false;
        if (row.scrollIntoView) row.scrollIntoView({ block: 'center', behavior: this.prefersReducedMotion && this.prefersReducedMotion() ? 'auto' : 'smooth' });
        row.classList.remove('msg-flash'); void row.offsetWidth; row.classList.add('msg-flash');
        try { row.focus({ preventScroll: true }); } catch (e) {}
        return true;
    };
    P.handleMessageHash = function () {
        const h = this.parseMessageHash(location.hash);
        if (!h) return false;
        setTimeout(() => { this.goToMessage(h.sessionId, h.msgId); try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }, 50);
        return true;
    };
    P.messageMenuItems = function (msgId) {
        const f = this.findMessage(msgId);
        if (!f) return [];
        const { session, msg } = f;
        const text = msg.content || '';
        return [
            { icon: 'fa-copy', label: 'نسخ النص', run: () => this.copyToClipboard(text) },
            { icon: 'fa-quote-right', label: 'اقتباس في الرد', run: () => this.quoteText && this.quoteText(text.slice(0, 1500)) },
            { icon: msg.fav ? 'fa-star-half-stroke' : 'fa-star', label: msg.fav ? 'إزالة من المفضلة' : 'إضافة للمفضلة', run: () => this.toggleFavoriteMessage(msg.id || msgId, session.id) },
            { icon: 'fa-link', label: 'نسخ رابط الرسالة', run: () => this.copyToClipboard(this.messageLink(session.id, msg.id || msgId)) },
            this.exportMessagesImage ? { icon: 'fa-image', label: 'تصدير كصورة / مشاركة', run: () => this.exportMessagesImage(session.id, [msg.id || msgId]) } : null,
            this.speakText ? { icon: 'fa-volume-high', label: 'قراءة بصوت', run: () => this.speakText(plain(text)) } : null,
            msg.role === 'user' ? { icon: 'fa-rotate-right', label: 'إعادة الإرسال', run: () => this.sendQuickPrompt(text) } : null
        ];
    };
    P.addMessageDecorator && P.addMessageDecorator(function (row, m) { row.classList.toggle('is-fav', !!m.fav); });

    // ------------------------------------------------------------------ RECENT SEARCHES (#342)
    P.getRecentSearches = function () { return lsGet(RECENT_KEY, []).filter(x => typeof x === 'string').slice(0, 10); };
    P.addRecentSearch = function (q) {
        q = String(q || '').trim().slice(0, 80);
        if (q.length < 2) return this.getRecentSearches();
        const list = [q, ...this.getRecentSearches().filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 10);
        lsSet(RECENT_KEY, list);
        return list;
    };
    P.clearRecentSearches = function () { lsSet(RECENT_KEY, []); this.renderRecentSearches(); };
    P.renderRecentSearches = function () {
        const input = document.getElementById('session-search-input');
        if (!input) return;
        let box = document.getElementById('recent-searches');
        const list = this.getRecentSearches();
        const show = document.activeElement === input && !input.value && list.length;
        if (!show) { if (box) box.remove(); return; }
        if (!box) {
            box = document.createElement('div');
            box.id = 'recent-searches'; box.className = 'recent-searches';
            box.addEventListener('mousedown', (e) => e.preventDefault());
            box.addEventListener('click', (e) => {
                const b = e.target.closest('[data-rq]');
                if (b) { input.value = b.dataset.rq; this.filterSessions(b.dataset.rq); return; }
                if (e.target.closest('[data-clear]')) this.clearRecentSearches();
            });
            input.closest('.sidebar-search-box').insertAdjacentElement('afterend', box);
        }
        box.innerHTML = `<div class="rs-head"><i class="fa-solid fa-clock-rotate-left"></i> عمليات البحث الأخيرة<button class="fx-link" data-clear="1">مسح</button></div>${list.map(q => `<button class="sess-chip" data-rq="${this.escapeHTML(q)}">${this.escapeHTML(q)}</button>`).join('')}`;
    };

    // ------------------------------------------------------------------ PALETTE + INIT
    const _origPalette = P.buildPaletteCommands;
    if (_origPalette) {
        P.buildPaletteCommands = function () {
            const self = this, S = 'المحادثات';
            return _origPalette.call(this).concat([
                { section: S, icon: 'fa-magnifying-glass', label: 'البحث الشامل', hint: 'Search', kbd: 'Alt+S', run: () => self.openGlobalSearch() },
                { section: S, icon: 'fa-table-cells', label: 'مدير المحادثات', hint: 'Manager', kbd: 'Alt+C', run: () => self.openConversationManager() },
                { section: S, icon: 'fa-star', label: 'الرسائل المفضلة', hint: 'Favorites', run: () => self.openFavorites() },
                { section: S, icon: 'fa-trash-arrow-up', label: 'سلة المهملات', hint: 'Trash', run: () => self.openTrash() },
                { section: S, icon: 'fa-code-compare', label: 'مقارنة محادثتين', hint: 'Compare', run: () => self.openCompareSessions() },
                { section: S, icon: 'fa-thumbtack', label: 'تثبيت/إلغاء تثبيت المحادثة الحالية', hint: 'Pin', run: () => self.togglePinSession(self.activeSessionId) },
                { section: S, icon: 'fa-box-archive', label: 'أرشفة المحادثة الحالية', hint: 'Archive', run: () => self.toggleArchiveSession(self.activeSessionId) },
                { section: S, icon: 'fa-bell-slash', label: 'كتم/إلغاء كتم المحادثة الحالية', hint: 'Mute', run: () => self.toggleMuteSession(self.activeSessionId) },
                { section: S, icon: 'fa-tags', label: 'وسوم المحادثة الحالية', hint: 'Tags', run: () => self.editSessionTags(self.activeSessionId) },
                { section: S, icon: 'fa-folder', label: 'نقل المحادثة الحالية إلى مجلد', hint: 'Folder', run: () => self.moveSessionToFolder(self.activeSessionId) }
            ]);
        };
    }
    P.initSprint7Conversations = function () {
        this.loadTrash().then(() => this.renderSessionFilterBar()).catch(() => {});
        const input = document.getElementById('session-search-input');
        if (input) {
            input.addEventListener('focus', () => this.renderRecentSearches());
            input.addEventListener('blur', () => { if (input.value.trim().length >= 2) this.addRecentSearch(input.value); setTimeout(() => this.renderRecentSearches(), 100); });
        }
        const list = document.getElementById('sessions-list');
        if (list) list.addEventListener('keydown', (e) => {
            const row = e.target.closest && e.target.closest('.session-item-row[data-sid]');
            if (!row) return;
            const rows = Array.from(list.querySelectorAll('.session-item-row[data-sid]'));
            const i = rows.indexOf(row);
            if (e.key === 'ArrowDown' && rows[i + 1]) { e.preventDefault(); rows[i + 1].focus(); }
            else if (e.key === 'ArrowUp' && rows[i - 1]) { e.preventDefault(); rows[i - 1].focus(); }
            else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.switchSession(row.dataset.sid); }
            else if (e.key === 'Delete') { e.preventDefault(); this.deleteSession(row.dataset.sid); }
            else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); this.openSessionMenu(row.dataset.sid, row); }
        });
        window.addEventListener('keydown', (e) => {
            const ctrl = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();
            if (e.altKey && !ctrl && k === 's') { e.preventDefault(); this.openGlobalSearch(); }
            else if (e.altKey && !ctrl && k === 'c') { e.preventDefault(); this.openConversationManager(); }
        });
        window.addEventListener('hashchange', () => this.handleMessageHash());
        this.renderSessionList();
        this.handleMessageHash();
    };
    if (window.app) {
        try { window.app.initSprint7Conversations(); } catch (e) { console.error('Sprint 7 conversations init failed', e); }
    }
})();
