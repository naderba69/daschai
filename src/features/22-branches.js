/* ==============================================================================
   OX-Alpha Workbench Pro — v2.17: message editing, regeneration & branching
     • edit a sent message and resend it        • regenerate a reply (same or another model)
     • every edit / regeneration is a *version* — nothing is overwritten: ‹ 2/3 › switches
       between versions together with the rest of the conversation that followed each one
     • branch a conversation into a new one from any message
     • delete a message (with undo)               • ↑ in an empty input edits your last message
     • visible action row on every message + the same actions in the context menu

   Data model — the current path stays a plain linear `session.messages`, so every other
   module (export, search, stats, windowing, …) keeps working untouched:
     msg.versions = [snapshot | null, …]   one slot per version; the active slot is null
     msg.vi       = index of the active version
     snapshot     = { ...message fields except identity, tail: [messages that followed] }
   Tails carry their own nested versions, so branches inside branches survive switching.
   ============================================================================== */
(function () {
    'use strict';
    if (typeof OXAlphaApp === 'undefined') return;
    const P = OXAlphaApp.prototype;

    /** Fields that belong to the message itself, not to one of its versions. */
    const IDENTITY = new Set(['id', 'role', 'versions', 'vi', 'fav']);
    const MAX_VERSIONS = 20;
    const newId = (bump = 0) => 'msg_' + (Date.now() + bump) + '_' + Math.random().toString(36).substring(2, 6);

    const snap = (m) => { const o = {}; Object.keys(m).forEach(k => { if (!IDENTITY.has(k)) o[k] = m[k]; }); return o; };
    const load = (m, s) => {
        Object.keys(m).forEach(k => { if (!IDENTITY.has(k)) delete m[k]; });
        Object.keys(s || {}).forEach(k => { if (k !== 'tail' && k !== 'sessionTitle' && !IDENTITY.has(k)) m[k] = s[k]; });
    };

    // ------------------------------------------------------------------ LOOKUP + GUARDS
    P.locateMessage = function (msgId) {
        const session = (this.sessions || []).find(s => s.id === this.activeSessionId);
        if (!session) return null;
        const index = session.messages.findIndex(m => m.id === msgId);
        return index < 0 ? null : { session, msg: session.messages[index], index };
    };
    P.isSessionStreaming = function (sessionId) {
        return !!(this.activeStreams && this.activeStreams.has(sessionId || this.activeSessionId));
    };
    /** Rewriting history under a live stream would let the stream write into the wrong version. */
    P.canRewriteHistory = function (session) {
        if (this.isSessionStreaming(session && session.id)) { this.showToast('أوقف التوليد الجاري أولاً ⏹️', 'warning'); return false; }
        return true;
    };

    // ------------------------------------------------------------------ VERSIONS
    P.messageVersionInfo = function (m) {
        const total = Array.isArray(m && m.versions) && m.versions.length ? m.versions.length : 1;
        const raw = Number.isInteger(m && m.vi) ? m.vi : 0;
        return { index: Math.min(Math.max(0, raw), total - 1), total };
    };
    /**
     * Open a new, empty version at `index`: the current one (fields + everything after it)
     * is stored, the conversation is cut after `index`. The caller fills the message in.
     */
    P.openNewVersion = function (session, index) {
        const m = session.messages[index];
        if (!Array.isArray(m.versions) || !m.versions.length) { m.versions = [null]; m.vi = 0; }
        if (!Number.isInteger(m.vi) || m.vi < 0 || m.vi >= m.versions.length) m.vi = 0;
        m.versions[m.vi] = { ...snap(m), tail: session.messages.slice(index + 1), sessionTitle: session.title };
        m.versions.push(null);
        m.vi = m.versions.length - 1;
        while (m.versions.length > MAX_VERSIONS) { m.versions.shift(); m.vi--; } // oldest goes first
        session.messages.length = index + 1;
        return m;
    };
    P.switchMessageVersion = function (msgId, target) {
        const f = this.locateMessage(msgId);
        if (!f || !Array.isArray(f.msg.versions) || f.msg.versions.length < 2) return false;
        const { session, msg: m, index } = f;
        const numericTarget = Number.isInteger(target) ? target : this.messageVersionInfo(m).index;
        const k = Math.min(Math.max(0, numericTarget), m.versions.length - 1);
        if (k === m.vi) return false;
        if (!this.canRewriteHistory(session)) return false;
        if (this._editingMsgId) this.cancelEditMessage(true);
        const next = m.versions[k];
        if (!next) return false;
        m.versions[m.vi] = { ...snap(m), tail: session.messages.slice(index + 1), sessionTitle: session.title };
        load(m, next);
        session.messages.length = index + 1;
        session.messages.push(...(next.tail || []));
        if (typeof next.sessionTitle === 'string') session.title = next.sessionTitle;
        m.versions[k] = null;
        m.vi = k;
        session.updatedAt = Date.now();
        this.saveSessions();
        this.renderUIState();
        this.focusMessageRow(msgId);
        return true;
    };
    P.stepMessageVersion = function (msgId, delta) {
        const f = this.locateMessage(msgId);
        if (!f) return false;
        return this.switchMessageVersion(msgId, this.messageVersionInfo(f.msg).index + delta);
    };

    // ------------------------------------------------------------------ REGENERATE
    /** Regenerate an assistant reply as a new version. `model` forces a specific model for it. */
    P.regenerateMessage = async function (msgId, opts = {}) {
        const f = this.locateMessage(msgId);
        if (!f || f.msg.role !== 'assistant') return false;
        if (!this.canRewriteHistory(f.session)) return false;
        if (navigator.onLine === false) { this.showToast('أنت غير متصل — أعد المحاولة عند عودة الاتصال', 'warning'); return false; }
        const { session, msg: m, index } = f;
        const forced = opts.model || m.forcedModel || m.routedModel || m.model || null;
        this.openNewVersion(session, index);
        const now = Date.now();
        load(m, { content: '', reasoning: '', steps: [], status: 'streaming', startTime: now, timestamp: now, model: forced || this.settings.model, ...(forced ? { forcedModel: forced } : {}) });
        session.updatedAt = now;
        this.saveSessions();
        this.renderUIState();
        this.scrollToBottom && this.scrollToBottom(true);
        await this.streamChatCompletion(session.id, m.id, 0, 0);
        return true;
    };

    // ------------------------------------------------------------------ EDIT
    /** Replace a user message's text as a new version and get a fresh reply to it. */
    P.editUserMessage = async function (msgId, newText) {
        const f = this.locateMessage(msgId);
        if (!f || f.msg.role !== 'user') return false;
        const text = String(newText == null ? '' : newText).trim();
        if (!text && !(f.msg.attachments || []).length) { this.showToast('الرسالة فارغة', 'warning'); return false; }
        if (!this.canRewriteHistory(f.session)) return false;
        if (navigator.onLine === false) { this.showToast('أنت غير متصل — أعد المحاولة عند عودة الاتصال', 'warning'); return false; }
        const { session, msg: m, index } = f;
        const prev = snap(m);
        this._editingMsgId = null; this._editDraft = null;
        this.openNewVersion(session, index);
        const now = Date.now();
        load(m, { ...prev, content: text, timestamp: now, edited: true });
        const assistantMsg = { id: newId(1), role: 'assistant', content: '', reasoning: '', steps: [], status: 'streaming', startTime: now, timestamp: now, model: this.settings.model };
        session.messages.push(assistantMsg);
        if (index === 0) session.title = text.slice(0, 36) || session.title;
        session.updatedAt = now;
        this.saveSessions();
        this.renderUIState();
        this.scrollToBottom && this.scrollToBottom(true);
        await this.streamChatCompletion(session.id, assistantMsg.id, 0, 0);
        return true;
    };
    /** Inline editor in place of the bubble (survives re-renders: state lives on the app). */
    P.startEditMessage = function (msgId) {
        const f = this.locateMessage(msgId);
        if (!f || f.msg.role !== 'user') return false;
        if (!this.canRewriteHistory(f.session)) return false;
        if (this._editingMsgId && this._editingMsgId !== msgId) this.cancelEditMessage(true);
        this._editingMsgId = msgId;
        this._editDraft = f.msg.content || '';
        this.renderMessages();
        const row = document.getElementById('m-' + msgId);
        const ta = row && row.querySelector('.msg-edit-input');
        if (ta) { ta.focus(); try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {} }
        return !!ta;
    };
    P.cancelEditMessage = function (silent) {
        if (!this._editingMsgId) return false;
        this._editingMsgId = null; this._editDraft = null;
        if (!silent) this.renderMessages();
        return true;
    };
    P.submitEditMessage = function (msgId) {
        const row = document.getElementById('m-' + msgId);
        const ta = row && row.querySelector('.msg-edit-input');
        const text = ta ? ta.value : (this._editDraft || '');
        return this.editUserMessage(msgId, text);
    };
    P.mountMessageEditor = function (row, m) {
        const card = row.querySelector('.msg-card.usr');
        if (!card || card.querySelector('.msg-edit-box')) return;
        const box = document.createElement('div');
        box.className = 'msg-edit-box';
        const hint = this.settings.enterMode === 'newline' ? 'Ctrl+Enter للإرسال' : 'Enter للإرسال · Shift+Enter لسطر جديد';
        box.innerHTML = `<textarea class="msg-edit-input" dir="auto" rows="3" aria-label="تعديل الرسالة"></textarea>
            <div class="msg-edit-bar"><span class="msg-edit-hint">${hint} · Esc للإلغاء</span>
            <div class="msg-edit-btns"><button type="button" class="msg-edit-cancel">إلغاء</button>
            <button type="button" class="msg-edit-send"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i> إرسال</button></div></div>`;
        const ta = box.querySelector('textarea');
        ta.value = this._editDraft != null ? this._editDraft : (m.content || '');
        const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 320) + 'px'; };
        ta.addEventListener('input', () => { this._editDraft = ta.value; fit(); });
        ta.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancelEditMessage(); return; }
            if (e.key !== 'Enter' || e.isComposing) return;
            const send = (e.ctrlKey || e.metaKey) || (this.settings.enterMode !== 'newline' && !e.shiftKey);
            if (send) { e.preventDefault(); e.stopPropagation(); this.submitEditMessage(m.id); }
        });
        box.querySelector('.msg-edit-cancel').onclick = () => this.cancelEditMessage();
        box.querySelector('.msg-edit-send').onclick = () => this.submitEditMessage(m.id);
        // the original content stays in the DOM (hidden) — selection/search modules may read it
        Array.from(card.children).forEach(ch => { ch.hidden = true; });
        card.appendChild(box);
        card.classList.add('is-editing');
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fit); else fit();
    };
    P.editLastUserMessage = function () {
        const session = (this.sessions || []).find(s => s.id === this.activeSessionId);
        const last = session && [...session.messages].reverse().find(m => m.role === 'user');
        return last ? this.startEditMessage(last.id) : false;
    };

    // ------------------------------------------------------------------ BRANCH (fork) + DELETE
    /** New conversation containing everything up to and including this message (current path only). */
    P.forkSessionAt = function (msgId) {
        const f = this.locateMessage(msgId);
        if (!f) return null;
        const { session, index } = f;
        if (this.isSessionStreaming(session.id)) { this.showToast('أوقف التوليد الجاري قبل إنشاء فرع', 'warning'); return null; }
        const copy = JSON.parse(JSON.stringify(session.messages.slice(0, index + 1))).map(m => { delete m.versions; delete m.vi; return m; });
        copy.forEach(m => { if (m.status === 'streaming') m.status = 'aborted'; });
        const now = Date.now();
        const fork = {
            id: 'sess_' + now + '_' + Math.random().toString(36).substring(2, 7),
            title: ('فرع: ' + (session.title || 'محادثة')).slice(0, 60),
            messages: copy, createdAt: now, updatedAt: now,
            forkOf: { sessionId: session.id, msgId }
        };
        if (session.mode) fork.mode = session.mode;
        this.sessions.unshift(fork);
        this.activeSessionId = fork.id;
        this.saveSessions();
        this.renderUIState();
        this.scrollToBottom && this.scrollToBottom(true);
        this.showToast('🌿 أُنشئت محادثة فرعية — الأصلية لم تتغير', 'success');
        return fork;
    };
    /** Delete a message (a user message takes its reply with it). Undo restores it in place. */
    P.deleteMessage = function (msgId) {
        const f = this.locateMessage(msgId);
        if (!f) return false;
        if (!this.canRewriteHistory(f.session)) return false;
        const { session, msg, index } = f;
        const next = session.messages[index + 1];
        const count = msg.role === 'user' && next && next.role === 'assistant' ? 2 : 1;
        const previousTitle = session.title;
        const removed = session.messages.splice(index, count);
        if (index === 0) {
            const firstUser = session.messages.find(m => m.role === 'user');
            session.title = firstUser ? (firstUser.content || 'محادثة جديدة').slice(0, 36) : 'محادثة جديدة';
        }
        if (this._editingMsgId && removed.some(m => m.id === this._editingMsgId)) { this._editingMsgId = null; this._editDraft = null; }
        session.updatedAt = Date.now();
        this.saveSessions();
        this.renderUIState();
        const undo = () => {
            const s = (this.sessions || []).find(x => x.id === session.id);
            if (!s || s.messages.some(m => m.id === removed[0].id)) return;
            s.messages.splice(Math.min(index, s.messages.length), 0, ...removed);
            s.title = previousTitle;
            s.updatedAt = Date.now();
            this.saveSessions();
            if (this.activeSessionId === s.id) this.renderUIState();
        };
        this._lastDeleted = { undo };
        const label = count === 2 ? 'حُذفت الرسالة وردّها' : 'حُذفت الرسالة';
        if (this.showActionToast) this.showActionToast(label, 'تراجع', undo, 'info'); else this.showToast(label, 'info');
        return removed.length;
    };

    P.focusMessageRow = function (msgId) {
        const row = document.getElementById('m-' + msgId);
        if (row) { try { row.focus({ preventScroll: true }); } catch (e) {} }
    };

    // ------------------------------------------------------------------ UI: action row on every message
    const btn = (cls, icon, label, title) => `<button type="button" class="msg-act ${cls}" title="${title || label}" aria-label="${title || label}"><i class="${icon}" aria-hidden="true"></i>${label ? `<span>${label}</span>` : ''}</button>`;
    const pager = (info) => info.total < 2 ? '' : `<span class="msg-ver" role="group" aria-label="نسخ الرسالة">`
        + `<button type="button" class="msg-act msg-ver-prev" aria-label="النسخة السابقة" title="النسخة السابقة" ${info.index === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>`
        + `<span class="msg-ver-label" aria-live="polite">${info.index + 1}/${info.total}</span>`
        + `<button type="button" class="msg-act msg-ver-next" aria-label="النسخة التالية" title="النسخة التالية" ${info.index === info.total - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button></span>`;

    P.decorateMessageActions = function (row, m) {
        if (!m || !m.id || row.querySelector('.msg-actions')) return;
        const streaming = m.status === 'streaming';
        const sessionBusy = this.isSessionStreaming();
        const info = this.messageVersionInfo(m);
        const bar = document.createElement('div');
        bar.className = 'msg-actions ' + (m.role === 'user' ? 'is-user' : 'is-bot');
        if (m.role === 'user') {
            if (this._editingMsgId === m.id) this.mountMessageEditor(row, m);
            bar.innerHTML = pager(info) + (sessionBusy ? '' : btn('msg-act-edit', 'fa-solid fa-pen', '', 'تعديل وإعادة الإرسال'))
                + btn('msg-act-copy', 'fa-regular fa-copy', '', 'نسخ') + btn('msg-act-more', 'fa-solid fa-ellipsis', '', 'المزيد');
            const col = row.querySelector('.msg-content-column');
            if (!col) return;
            col.appendChild(bar);
        } else {
            if (streaming && info.total < 2) return;
            bar.innerHTML = pager(info) + (!sessionBusy && !streaming ? btn('msg-act-regen', 'fa-solid fa-rotate', 'إعادة التوليد', 'إعادة توليد الرد (يُحفظ الرد الحالي كنسخة)') : '')
                + btn('msg-act-more', 'fa-solid fa-ellipsis', '', 'المزيد');
            const footer = row.querySelector('.msg-footer-bar');
            if (footer) footer.insertBefore(bar, footer.firstChild);
            else { const card = row.querySelector('.msg-card'); if (!card) return; card.appendChild(bar); }
        }
        bar.classList.toggle('is-busy', sessionBusy || streaming);
        bar.addEventListener('click', (e) => {
            const b = e.target.closest('button');
            if (!b || b.disabled) return;
            e.stopPropagation();
            if (b.classList.contains('msg-ver-prev')) this.stepMessageVersion(m.id, -1);
            else if (b.classList.contains('msg-ver-next')) this.stepMessageVersion(m.id, +1);
            else if (b.classList.contains('msg-act-edit')) this.startEditMessage(m.id);
            else if (b.classList.contains('msg-act-regen')) this.regenerateMessage(m.id);
            else if (b.classList.contains('msg-act-copy')) this.copyToClipboard(m.content || '', b);
            else if (b.classList.contains('msg-act-more')) this.openMessageMenu ? this.openMessageMenu(m.id, b) : null;
        });
        if (m.edited && m.role === 'user') {
            const meta = row.querySelector('.msg-meta-bar');
            if (meta && !meta.querySelector('.msg-edited-tag')) meta.insertAdjacentHTML('beforeend', '<span class="msg-edited-tag">(معدّلة)</span>');
        }
    };
    P.addMessageDecorator && P.addMessageDecorator(function (row, m) { this.decorateMessageActions(row, m); });

    // ------------------------------------------------------------------ CONTEXT MENU
    const _menu = P.messageMenuItems;
    P.messageMenuItems = function (msgId) {
        const base = _menu ? _menu.apply(this, arguments) : [];
        const f = this.locateMessage(msgId);
        if (!f) return base;
        const { msg } = f;
        const busy = this.isSessionStreaming();
        const info = this.messageVersionInfo(msg);
        const extra = [
            msg.role === 'user' && !busy ? { icon: 'fa-pen', label: 'تعديل وإعادة الإرسال', run: () => this.startEditMessage(msg.id) } : null,
            msg.role === 'assistant' && !busy ? { icon: 'fa-rotate', label: 'إعادة توليد الرد', run: () => this.regenerateMessage(msg.id) } : null,
            msg.role === 'assistant' && !busy && this.settings.model ? { icon: 'fa-shuffle', label: 'إعادة التوليد بنموذج آخر…', run: () => this.regenerateWithOtherModel(msg.id) } : null,
            info.total > 1 && !busy ? { icon: 'fa-code-branch', label: `النسخة ${info.index + 1} من ${info.total} — التالية`, run: () => this.switchMessageVersion(msg.id, (info.index + 1) % info.total) } : null,
            !busy ? { icon: 'fa-code-fork', label: 'تفرّع إلى محادثة جديدة من هنا', run: () => this.forkSessionAt(msg.id) } : null,
            !busy ? { icon: 'fa-trash-can', label: msg.role === 'user' ? 'حذف الرسالة (مع ردّها)' : 'حذف الرد', danger: true, run: () => this.deleteMessage(msg.id) } : null
        ].filter(Boolean);
        // the old «resend» duplicated the message at the end; editing supersedes it
        const kept = base.filter(it => !(it && it.label === 'إعادة الإرسال'));
        return [...kept, '-', ...extra];
    };
    /** Pick a model, then regenerate with it (suggestions = models the app already loaded). */
    P.regenerateWithOtherModel = async function (msgId) {
        if (!this.showDialog) return false;
        const current = this.settings.model || '';
        const pool = Array.from(new Set((this.availableModels || []).map(m => m.id))).filter(id => id && id !== current).slice(0, 400);
        const pending = this.showDialog({
            title: 'إعادة التوليد بنموذج آخر',
            body: `<datalist id="regen-model-list">${pool.map(id => `<option value="${this.escapeHTML(id)}"></option>`).join('')}</datalist>`,
            fields: [{ id: 'regen-model', label: 'اكتب اسم النموذج أو اختره من الاقتراحات', value: '', placeholder: 'provider/model', dir: 'ltr' }],
            buttons: [{ label: 'إعادة التوليد', value: 'ok', primary: true, validate: (v) => { const model = (v['regen-model'] || '').trim(); return !model ? 'اكتب اسم نموذج' : model === current ? 'اختر نموذجاً مختلفاً عن النموذج الحالي' : ''; } }, { label: 'إلغاء', value: null }]
        });
        const field = document.getElementById('oxd-regen-model'); // dialog DOM is built synchronously
        if (field) { field.setAttribute('list', 'regen-model-list'); field.setAttribute('autocomplete', 'off'); field.dataset.selectBase = 'no'; setTimeout(() => { try { field.select(); } catch (e) {} }, 40); }
        const r = await pending;
        const model = r && r.values && String(r.values['regen-model'] || '').trim();
        if (!model) return false;
        return this.regenerateMessage(msgId, { model });
    };

    // ------------------------------------------------------------------ INIT
    P.initBranches = function () {
        const input = document.getElementById('user-input');
        if (input && !input.__oxEditUp) {
            input.__oxEditUp = true;
            input.addEventListener('keydown', (e) => {
                if (e.key !== 'ArrowUp' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
                if (input.value !== '' || (this.currentAttachments || []).length) return;
                if (this.isSessionStreaming()) return;
                if (this.editLastUserMessage()) e.preventDefault();
            });
        }
    };
    if (window.app) {
        try { window.app.initBranches(); } catch (e) { console.error('Branches init failed', e); }
    }
})();
