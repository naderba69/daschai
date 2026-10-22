/* Team chat: project rooms (#735, #751) as GitHub issues labelled ox-channel (or local when offline), create (#775),
   archive (#776), leave (#777), @ai team member (#791), comment notifications inbox (#740), follow developers (#739). */
import { esc, call, callRaw, btn, pbtn, card, empty, field, area, val, setHTML, lsGet, lsSet, uid, ago, fmtDT, readMarker, stripMarkers } from './util.js';

const LOCAL_KEY = 'ox_team_chan_v1', MUTE_KEY = 'ox_team_muted_v1', FOLLOW_KEY = 'ox_team_follow_v1';
export const channelSlug = (name) => String(name || '').trim().replace(/^#+/, '').toLowerCase().replace(/[\s_]+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '').slice(0, 40);
export const isAIMention = (text, aiName = 'OX-AI') => new RegExp(`(^|\\s)@(ai|${String(aiName).replace(/[^\w-]/g, '')})(?=\\s|$|[.,،!?؟:])`, 'i').test(String(text || ''));
export const AI_PREFIX = (name) => `🤖 **${name}**:\n\n`;

export function installChat(P) {
    const label = (app) => { const t = app.tmTeam(); return (t && t.settings && t.settings.channelLabel) || 'ox-channel'; };
    const local = (app) => { const all = lsGet(LOCAL_KEY, {}); return { all, list: all[app.tmRepoKey()] || [] }; };
    const saveLocal = (app, list) => { const all = lsGet(LOCAL_KEY, {}); all[app.tmRepoKey()] = list; lsSet(LOCAL_KEY, all); };
    P.tmMuted = function () { return new Set((lsGet(MUTE_KEY, {})[this.tmRepoKey()]) || []); };
    const setMuted = (app, set) => { const all = lsGet(MUTE_KEY, {}); all[app.tmRepoKey()] = [...set]; lsSet(MUTE_KEY, all); };

    // ------------------------------------------------------------------ DATA
    P.tmChannelList = async function ({ archived = false } = {}) {
        if (!this.tmHasGH()) return local(this).list.filter(c => !!c.archived === archived).map(c => ({ id: c.id, name: c.name, desc: c.desc || '', archived: !!c.archived, count: (c.messages || []).length, updated: c.updated || c.created, local: true }));
        const issues = await this.tmGH(`/issues?labels=${encodeURIComponent(label(this))}&state=${archived ? 'closed' : 'open'}&per_page=100&sort=updated`) || [];
        return issues.filter(i => !i.pull_request).map(i => ({ id: i.number, name: String(i.title || '').replace(/^#\s*/, ''), desc: stripMarkers(i.body || ''), archived: i.state === 'closed', locked: !!i.locked, count: i.comments || 0, updated: i.updated_at, url: i.html_url }));
    };
    P.tmCreateChannel = async function (name = val('tm-ch-name'), desc = val('tm-ch-desc')) {
        const slug = channelSlug(name);
        if (!slug) { this.showToast('اكتب اسم القناة', 'warning'); return null; }
        const existing = await this.tmChannelList().catch(() => []);
        if (existing.some(c => channelSlug(c.name) === slug)) { this.showToast(`القناة #${this.escapeHTML(slug)} موجودة`, 'info'); return existing.find(c => channelSlug(c.name) === slug); }
        let ch;
        if (this.tmHasGH()) {
            await this.tmEnsureLabel(label(this), '1d76db', 'OX-Alpha team channel');
            const t = this.tmTeam();
            const i = await this.tmGH('/issues', { method: 'POST', body: { title: '#' + slug, body: `${desc || 'قناة فريق'}\n\n<!--oxchannel ${JSON.stringify({ name: slug, team: t && t.id })}-->`, labels: [label(this)] } });
            ch = { id: i.number, name: slug, desc: desc || '' };
        } else {
            const { list } = local(this);
            ch = { id: uid('ch'), name: slug, desc: desc || '', created: Date.now(), messages: [] };
            list.push(ch); saveLocal(this, list);
        }
        if (this.tmLiveSend) this.tmLiveSend({ t: 'channel', ch: { id: ch.id, name: ch.name, desc: ch.desc } });
        this.showToast(`#️⃣ أُنشئت القناة #${this.escapeHTML(slug)}`, 'success');
        return ch;
    };
    /** #751 — every project gets a #general room. */
    P.tmEnsureGeneral = async function () {
        const list = await this.tmChannelList();
        if (list.length || (this.tmHasGH() && this.tmRole() === 'viewer')) return list;
        await this.tmCreateChannel('general', `غرفة دردشة مشروع ${this.tmRepoKey()}`);
        return this.tmChannelList();
    };
    P.tmArchiveChannel = async function (id, archive = true) {
        if (this.tmHasGH()) {
            await this.tmGH(`/issues/${+id}`, { method: 'PATCH', body: { state: archive ? 'closed' : 'open', ...(archive ? { state_reason: 'completed' } : {}) } });
            if (archive) await this.tmGH(`/issues/${+id}/lock`, { method: 'PUT', body: { lock_reason: 'resolved' } }).catch(() => null);
            else await this.tmGH(`/issues/${+id}/lock`, { method: 'DELETE' }).catch(() => null);
        } else {
            const { list } = local(this); const c = list.find(x => x.id === id); if (c) c.archived = archive; saveLocal(this, list);
        }
        if (this._tmChan === id && archive) this._tmChan = null;
        this.showToast(archive ? '🗄️ أُرشفت القناة (للقراءة فقط)' : '♻️ أُعيدت القناة', 'success');
        if (document.getElementById('tmx-sec')) this.tmRefresh();
        return true;
    };
    P.tmLeaveChannel = function (id, leave = true) {
        const m = this.tmMuted(); if (leave) m.add(String(id)); else m.delete(String(id)); setMuted(this, m);
        if (leave && String(this._tmChan) === String(id)) this._tmChan = null;
        this.showToast(leave ? '🚪 غادرت القناة — لن تصلك إشعاراتها' : '👋 انضممت للقناة', 'info');
        if (document.getElementById('tmx-sec')) this.tmRefresh();
        return [...m];
    };
    P.tmMessages = async function (id) {
        if (!this.tmHasGH()) { const c = local(this).list.find(x => x.id === id); return c ? (c.messages || []).slice() : []; }
        const list = await this.tmList(`${this.ghRepoPath()}/issues/${+id}/comments`, { max: 300 });
        return list.map(c => ({ id: c.id, user: c.user && c.user.login, avatar: c.user && c.user.avatar_url, body: c.body || '', t: new Date(c.created_at).getTime(), ai: /<!--oxai-->/.test(c.body || ''), url: c.html_url }));
    };
    P.tmSend = async function (id = this._tmChan, text = val('tm-msg'), { ai = false, silent = false } = {}) {
        text = String(text || '').trim();
        if (!id || !text) return null;
        const me = await this.tmMe();
        const t = this.tmTeam(), s = (t && t.settings) || {};
        const name = s.aiName || 'OX-AI';
        const body = ai ? AI_PREFIX(name) + text + '\n\n<!--oxai-->' : text;
        let msg;
        if (this.tmHasGH()) {
            const c = await this.tmGH(`/issues/${+id}/comments`, { method: 'POST', body: { body } });
            msg = { id: c && c.id, user: me, body, t: Date.now(), ai };
        } else {
            const { list } = local(this); const c = list.find(x => x.id === id);
            if (!c) return null;
            msg = { id: uid('m'), user: me, body, t: Date.now(), ai };
            (c.messages = c.messages || []).push(msg); c.updated = Date.now(); saveLocal(this, list);
        }
        if (this.tmLiveSend) this.tmLiveSend({ t: 'chat', ch: id, msg });
        const box = document.getElementById('tm-msg'); if (box && !ai) box.value = '';
        if (!silent && document.getElementById('tm-chat-log')) await this.tmRenderMessages(id);
        if (!ai && s.aiMember !== false && isAIMention(text, name)) await this.tmAIReply(id, text);
        return msg;
    };
    /** #791 — OX-AI answers in the channel with the conversation + project context. */
    P.tmAIReply = async function (id, question) {
        const msgs = (await this.tmMessages(id).catch(() => [])).slice(-20);
        let ctx = '';
        try { if (this.aiProjectContext) ctx = String(await this.aiProjectContext({ maxChars: 6000 }) || '').slice(0, 6000); } catch (e) { /* no context */ }
        const conv = msgs.map(m => `${m.ai ? 'OX-AI' : '@' + m.user}: ${stripMarkers(m.body).replace(/^🤖 \*\*[^*]+\*\*:\s*/, '').slice(0, 800)}`).join('\n');
        const ans = await this.tmAI(`You are a member of a developer team chat. Reply to the latest message that mentions you.\n\nProject context:\n${ctx || '(none)'}\n\nConversation:\n${conv}\n\nLatest: ${question}`, { maxTokens: 1500 });
        if (!ans) return null;
        return this.tmSend(id, ans, { ai: true });
    };

    // ------------------------------------------------------------------ UI
    P.tmChannels = async function () {
        const list = await (this.tmTeam() ? this.tmEnsureGeneral() : this.tmChannelList());
        const muted = this.tmMuted();
        const visible = list.filter(c => !muted.has(String(c.id)));
        if (this._tmChan == null || !list.some(c => String(c.id) === String(this._tmChan))) this._tmChan = visible.length ? visible[0].id : null;
        const left = list.filter(c => muted.has(String(c.id)));
        const archived = await this.tmChannelList({ archived: true }).catch(() => []);
        this._tmMount = () => { if (this._tmChan != null) this.tmRenderMessages(this._tmChan); this.tmChatPollStart(); };
        const item = (c) => `<div class="gh-item tmx-ch ${String(c.id) === String(this._tmChan) ? 'active' : ''}"><a href="#" onclick="${call('tmOpenChannel', c.id)};return false"># ${esc(c.name)}</a><span class="fmx-count-badge">${c.count}</span>
            <span class="tmx-actions">${btn('fa-box-archive', '', call('tmArchiveChannel', c.id, true), 'sidebar-btn-util gh-btn', 'title="أرشفة"')}${btn('fa-right-from-bracket', '', call('tmLeaveChannel', c.id, true), 'sidebar-btn-util gh-btn', 'title="مغادرة"')}</span></div>`;
        return `<div class="tmx-chat"><div class="tmx-chat-side">${card('القنوات', `${visible.map(item).join('') || empty('لا قنوات')}
                <div class="gh-row">${field('tm-ch-name', 'قناة جديدة', '', 'placeholder="frontend"')}${pbtn('fa-plus', '', call('tmCreateChannelUI'), 'title="إنشاء"')}</div>`, 'fa-hashtag')}
            ${left.length ? card('قنوات غادرتها', left.map(c => `<div class="gh-item"><span># ${esc(c.name)}</span>${btn('fa-right-to-bracket', 'انضمام', call('tmLeaveChannel', c.id, false))}</div>`).join(''), 'fa-door-open') : ''}
            ${archived.length ? card('الأرشيف', archived.map(c => `<div class="gh-item"><a href="#" onclick="${call('tmOpenChannel', c.id)};return false">🗄️ ${esc(c.name)}</a>${btn('fa-box-open', '', call('tmArchiveChannel', c.id, false), 'sidebar-btn-util gh-btn', 'title="استعادة"')}</div>`).join(''), 'fa-box-archive') : ''}</div>
            <div class="tmx-chat-main">${this._tmChan == null ? empty('أنشئ قناة للبدء') : `<div id="tm-chat-log" class="fmx-talk-log tmx-chat-log"><div class="gh-empty"><span class="live-step-spinner"></span></div></div>
                <div class="gh-row">${area('tm-msg', '', '', 2, `placeholder="اكتب رسالة… استخدم @ai لسؤال عضو الذكاء" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();app.tmSend()}"`)}${pbtn('fa-paper-plane', 'إرسال', call('tmSend'))}</div>`}</div></div>
            <div class="tmx-note">${this.tmHasGH() ? 'القنوات Issues بوسم <code>ox-channel</code> والرسائل تعليقات — يراها كل أعضاء المستودع، والأرشفة تقفلها.' : 'وضع محلي: الرسائل محفوظة في المتصفح وتُبث للمشاركين في الجلسة الحية.'}</div>`;
    };
    P.tmCreateChannelUI = async function () { const c = await this.tmCreateChannel(val('tm-ch-name'), ''); if (c) { this._tmChan = c.id; this.tmRefresh(); } return c; };
    P.tmOpenChannel = function (id) { this._tmChan = id; document.querySelectorAll('.tmx-ch').forEach(el => el.classList.remove('active')); return this.tmRenderMessages(id); };
    P.tmRenderMessages = async function (id) {
        const el = document.getElementById('tm-chat-log');
        if (!el) return [];
        let msgs;
        try { msgs = await this.tmMessages(id); } catch (e) { el.innerHTML = empty('❌ ' + esc(e.message), true); return []; }
        const me = this.tmMeSync();
        const md = (s) => (this.renderMarkdownSafe ? this.renderMarkdownSafe(s) : esc(s).replace(/\n/g, "<br>"));
        el.innerHTML = msgs.length ? msgs.map(m => `<div class="fmx-talk ${m.ai ? 'assistant' : ''} ${m.user === me ? 'tmx-mine' : ''}"><div class="tmx-msg-h">${m.ai ? '🤖' : m.avatar ? `<img class="tmx-av" src="${esc(m.avatar)}" alt="">` : '👤'} <b>${m.ai ? 'OX-AI' : '@' + esc(m.user)}</b> <small>${fmtDT(m.t)}</small></div><div class="tmx-msg-b">${md(stripMarkers(m.body).replace(/^🤖 \*\*[^*]+\*\*:\s*/, ''))}</div></div>`).join('') : empty('لا رسائل بعد — ابدأ المحادثة');
        el.scrollTop = el.scrollHeight;
        this._tmChatSeen = msgs.length;
        return msgs;
    };
    P.tmChatPollStart = function () {
        clearInterval(this._tmChatPoll);
        this._tmChatPoll = setInterval(() => {
            if (!document.getElementById('tm-chat-log')) { clearInterval(this._tmChatPoll); this._tmChatPoll = null; return; }
            if (!document.hidden && this._tmChan != null && this.tmHasGH()) this.tmRenderMessages(this._tmChan).catch(() => {});
        }, 20000);
    };
    /** Live-session relay: a chat message from a peer (local mode). */
    P.tmOnRemoteChat = function (d) {
        if (this.tmHasGH()) { if (String(d.ch) === String(this._tmChan) && document.getElementById('tm-chat-log')) this.tmRenderMessages(d.ch); return; }
        const { list } = local(this);
        let c = list.find(x => x.id === d.ch);
        if (!c) { c = { id: d.ch, name: d.name || 'live', messages: [], created: Date.now() }; list.push(c); }
        if (!(c.messages || []).some(m => m.id === d.msg.id)) (c.messages = c.messages || []).push(d.msg);
        saveLocal(this, list);
        if (!this.tmMuted().has(String(d.ch))) this.tmInboxPush({ key: 'lm' + d.msg.id, kind: 'chat', title: `💬 @${d.msg.user} في #${c.name}`, body: stripMarkers(d.msg.body).slice(0, 140) });
        if (String(d.ch) === String(this._tmChan) && document.getElementById('tm-chat-log')) this.tmRenderMessages(d.ch);
    };
    P.tmOnRemoteChannel = function (d) {
        if (this.tmHasGH() || !d.ch) return;
        const { list } = local(this);
        if (!list.some(x => x.id === d.ch.id)) { list.push({ ...d.ch, created: Date.now(), messages: [] }); saveLocal(this, list); }
    };

    // ------------------------------------------------------------------ INBOX (#740, #745)
    P.tmInbox = async function () {
        const list = this.tmInboxList();
        return card('صندوق الإشعارات', `<div class="gh-row">${pbtn('fa-rotate', 'فحص الآن', call('tmCheckNow'))}${btn('fa-check-double', 'تعليم الكل كمقروء', call('tmInboxReadAll'))}${btn('fa-trash', 'مسح', call('tmInboxClear'))}${this._tmWatch ? btn('fa-bell-slash', 'إيقاف المراقبة', call('tmWatchOff')) : btn('fa-bell', 'تفعيل المراقبة', call('tmWatchOn'))}</div>
            ${list.length ? list.map(n => `<div class="gh-item ${n.read ? '' : 'tmx-unread'}"><span>${esc(n.title)}<br><small>${esc(n.body || '')} • ${ago(n.t)}</small></span>${n.url ? btn('fa-arrow-up-right-from-square', '', call('tmInboxOpen', n.id)) : ''}</div>`).join('') : empty('لا إشعارات. فعّل المراقبة لتصلك التعليقات الجديدة وتعديلات الزملاء على ملفاتك.')}`, 'fa-inbox')
            + card('ملفاتي المراقبة', `<div class="tmx-note">تصلك إشعارات عند تعديل زميل لأي ملف كتبته مؤخراً أو حدّدته هنا.</div><div class="gh-row">${field('tm-mine-path', 'مسار', '', 'dir="ltr" list="tm-paths"')}<datalist id="tm-paths">${this.projectPaths().slice(0, 300).map(p => `<option value="${esc(p)}">`).join('')}</datalist>${btn('fa-plus', 'مراقبة', callRaw('tmMarkMine', [], "document.getElementById('tm-mine-path').value"))}</div>
                <div>${[...this.tmMyFiles()].slice(0, 40).map(p => `<span class="fmx-tag" dir="ltr">${esc(p)}</span>`).join('') || empty('لا ملفات بعد')}</div>`, 'fa-eye');
    };
    P.tmCheckNow = async function () { try { const r = await this.tmPoll(); this.showToast(`🔔 ${r.comments} تعليق • ${r.edits} تعديل • ${r.delays} تنبيه تأخر`, 'info'); } catch (e) { this.tmErr(e); } return this.tmRefresh(); };
    P.tmInboxReadAll = function () { lsSet('ox_team_inbox_v1', this.tmInboxList().map(n => ({ ...n, read: true }))); this.tmBadge(); return this.tmRefresh(); };
    P.tmInboxClear = function () { lsSet('ox_team_inbox_v1', []); this.tmBadge(); return this.tmRefresh(); };
    P.tmInboxOpen = function (id) { const list = this.tmInboxList(); const n = list.find(x => x.id === id); if (!n) return; n.read = true; lsSet('ox_team_inbox_v1', list); this.tmBadge(); if (n.url) window.open(n.url, '_blank', 'noopener'); };

    // ------------------------------------------------------------------ FOLLOW DEVELOPERS (#739)
    P.tmFollowing = async function () {
        if (this.tmHasGH()) { const r = await this.gh('/user/following?per_page=100').catch(() => null); if (r) return r.map(u => ({ login: u.login, avatar: u.avatar_url })); }
        return (lsGet(FOLLOW_KEY, [])).map(login => ({ login }));
    };
    P.tmFollow = async function () {
        const list = await this.tmFollowing();
        this._tmMount = () => { if (list.length) this.tmLoadFeed(list.slice(0, 6).map(u => u.login)); };
        return card('المطورون الذين تتابعهم', `<div class="gh-row">${field('tm-follow', 'اسم المستخدم', '', 'dir="ltr" placeholder="torvalds"')}${pbtn('fa-user-plus', 'متابعة', call('tmFollowUser'))}</div>
            ${list.map(u => `<div class="gh-item"><span>${u.avatar ? `<img class="tmx-av" src="${esc(u.avatar)}" alt="">` : '👤'} <a href="https://github.com/${esc(u.login)}" target="_blank" rel="noopener">@${esc(u.login)}</a></span>${btn('fa-user-minus', 'إلغاء', call('tmUnfollowUser', u.login))}</div>`).join('') || empty('لا تتابع أحداً بعد')}`, 'fa-user-group')
            + card('آخر نشاطاتهم', '<div id="tm-feed" class="fmx-timeline"></div>', 'fa-stream');
    };
    P.tmFollowUser = async function (login = val('tm-follow')) {
        login = String(login || '').trim().replace(/^@/, '');
        if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) { this.showToast('اسم مستخدم غير صالح', 'warning'); return false; }
        if (this.tmHasGH()) { try { await this.gh(`/user/following/${encodeURIComponent(login)}`, { method: 'PUT' }); } catch (e) { return this.tmErr(e); } }
        else lsSet(FOLLOW_KEY, [...new Set([...lsGet(FOLLOW_KEY, []), login])]);
        this.showToast(`➕ تتابع الآن @${this.escapeHTML(login)}`, 'success');
        if (document.getElementById('tmx-sec')) this.tmRefresh();
        return true;
    };
    P.tmUnfollowUser = async function (login) {
        if (this.tmHasGH()) await this.gh(`/user/following/${encodeURIComponent(login)}`, { method: 'DELETE' }).catch(e => this.tmErr(e));
        lsSet(FOLLOW_KEY, lsGet(FOLLOW_KEY, []).filter(l => l !== login));
        if (document.getElementById('tmx-sec')) this.tmRefresh();
        return true;
    };
    const EV = { PushEvent: '⬆️ دفع إلى', PullRequestEvent: '🔀 PR في', IssuesEvent: '🐞 Issue في', WatchEvent: '⭐ أضاف نجمة لـ', CreateEvent: '✨ أنشأ', ForkEvent: '🍴 نسخ', ReleaseEvent: '🏷️ إصدار في', IssueCommentEvent: '💬 علّق في' };
    P.tmLoadFeed = async function (logins) {
        const all = [];
        for (const l of logins) { const ev = await this.gh(`/users/${encodeURIComponent(l)}/events/public?per_page=5`).catch(() => []) || []; ev.forEach(e => all.push({ login: l, type: e.type, repo: e.repo && e.repo.name, t: e.created_at })); }
        all.sort((a, b) => String(b.t).localeCompare(String(a.t)));
        setHTML('tm-feed', all.length ? all.slice(0, 30).map(e => `<div class="fmx-tl-item"><span class="fmx-tl-time">${ago(e.t)}</span><span>@${esc(e.login)} ${EV[e.type] || esc(e.type)} <a href="https://github.com/${esc(e.repo)}" target="_blank" rel="noopener" dir="ltr">${esc(e.repo)}</a></span></div>`).join('') : empty('لا نشاط عام حديث'));
        return all;
    };
    P.tmReadMarker = readMarker;
}
