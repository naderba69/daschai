/* Live collaboration (#732): CRDT co-editing over WebRTC data channels (invite link / code, or auto-signalling
   through a team channel) and BroadcastChannel (other tabs). Presence + cursors, file locks while editing (#746),
   shared whiteboard (#756), group voice/video calls and screen sharing via the media call room (#752-#754). */
import { deflateSync, inflateSync } from 'fflate';
import { esc, call, btn, pbtn, card, empty, field, area, select, val, setHTML, uid, win, bytesToB64url, b64ToBytes, utf8, fromUtf8, ago, readMarker } from './util.js';
import { RGA } from './crdt.js';

export const LIVE_ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
export const encodeLive = (obj) => bytesToB64url(deflateSync(utf8(JSON.stringify(obj)), { level: 9 }));
export const decodeLive = (code) => JSON.parse(fromUtf8(inflateSync(b64ToBytes(String(code).trim().replace(/^.*#oxlive=/, '')))));
export const PEER_COLORS = ['#38bdf8', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb7185', '#2dd4bf', '#f97316'];
export const colorFor = (site) => PEER_COLORS[[...String(site)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % PEER_COLORS.length];
const LOCK_IDLE = 45000;

export function installLive(P) {
    const waitIce = (pc) => new Promise(res => { if (pc.iceGatheringState === 'complete') return res(); const t = setTimeout(res, 4000); pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } }); });
    const textEntry = (f) => f && typeof f.content === 'string' && !f.dataUrl && !f.binary;

    // ------------------------------------------------------------------ SESSION
    P.tmLiveStart = function ({ room, name, host = true, files } = {}) {
        if (this._teamLive) this.tmLiveStop(true);
        const site = uid('s');
        const L = this._teamLive = {
            room: String(room || uid('room')).replace(/[^\w-]/g, '').slice(0, 40), site, name: name || this.tmMeSync(), color: colorFor(site), host,
            docs: new Map(), peers: new Map(), conns: new Map(), seen: new Set(), started: Date.now(), log: [], synced: host, autoLock: true
        };
        this._teamSite = site;
        this._teamLocks = {};
        if (host) {
            const paths = files || this.projectPaths();
            for (const p of paths) { const f = this.virtualProjectFiles.get(p); if (textEntry(f)) { const d = RGA.fromText(site, f.content); d.origin = site; L.docs.set(p, d); } }
        }
        const BC = win().BroadcastChannel || globalThis.BroadcastChannel;
        if (BC) {
            try { L.bc = new BC('ox-live-' + L.room); L.bc.onmessage = (e) => this.tmLiveReceive(e.data, 'bc'); } catch (e) { L.bc = null; }
        }
        this.tmLiveSend({ t: 'hello', name: L.name, color: L.color, host });
        L.timer = setInterval(() => this.tmLiveTick(), 4000);
        this.tmLiveBar();
        if (this.addXP) this.addXP(10, 'live');
        return L;
    };
    P.tmLiveStop = function (quiet = false) {
        const L = this._teamLive;
        if (!L) return false;
        try { this.tmLiveSend({ t: 'bye' }); } catch (e) { /* closed */ }
        clearInterval(L.timer);
        Object.keys(this._teamLocks || {}).forEach(p => { if (this._teamLocks[p].site === L.site) delete this._teamLocks[p]; });
        if (L.bc) try { L.bc.close(); } catch (e) {}
        L.conns.forEach(c => { try { c.dc && c.dc.close(); c.pc && c.pc.close(); } catch (e) {} });
        this._teamLive = null;
        this._teamLocks = {};
        const bar = document.getElementById('tm-live-bar'); if (bar) bar.remove();
        if (!quiet) this.showToast('⏹ انتهت الجلسة الحية', 'info');
        if (document.getElementById('tm-live-panel')) this.tmRefresh();
        return true;
    };
    /** Send to every transport (with a message id for de-duplication / relaying). */
    P.tmLiveSend = function (msg, except) {
        const L = this._teamLive;
        if (!L) return null;
        const m = msg.mid ? msg : { ...msg, mid: uid('m'), from: L.site, fromName: L.name };
        L.seen.add(m.mid);
        const raw = JSON.stringify(m);
        if (L.bc && except !== 'bc') try { L.bc.postMessage(m); } catch (e) {}
        L.conns.forEach((c, id) => { if (id !== except && c.dc && c.dc.readyState === 'open') try { c.dc.send(raw); } catch (e) {} });
        return m;
    };
    P.tmLiveReceive = function (data, via) {
        const L = this._teamLive;
        if (!L) return;
        let d = data;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return; } }
        if (!d || !d.mid || L.seen.has(d.mid) || d.from === L.site) return;
        L.seen.add(d.mid);
        if (L.seen.size > 5000) L.seen = new Set([...L.seen].slice(-2000));
        // Star topology: the host relays WebRTC traffic so every peer sees every op.
        if (L.host && via !== 'bc') this.tmLiveSend(d, via);
        if (d.to && d.to !== L.site) return;
        const peer = L.peers.get(d.from) || { name: d.fromName || 'زميل', color: colorFor(d.from), file: null, line: 0 };
        peer.t = Date.now(); peer.name = d.fromName || peer.name;
        L.peers.set(d.from, peer);
        switch (d.t) {
            case 'hello':
                if (d.color) peer.color = d.color;
                if (L.host) this.tmLiveSend({ t: 'state', to: d.from, files: Object.fromEntries([...L.docs].map(([p, doc]) => [p, { snap: doc.snapshot(), origin: doc.origin }])), board: (this._wb && this._wb.items) || [], locks: this._teamLocks || {} });
                this.tmLiveSend({ t: 'presence', file: this.activeStudioFile || null, line: this.studioCaretLine ? this.studioCaretLine() : 0, color: L.color });
                this.tmLiveLog(`👋 انضم ${peer.name}`);
                break;
            case 'state':
                if (L.synced) break;
                L.synced = true;
                this._tmApplying = true;
                try {
                    for (const [p, f] of Object.entries(d.files || {})) {
                        const doc = RGA.fromSnapshot(L.site, f.snap); doc.origin = f.origin;
                        L.docs.set(p, doc);
                        this.writeProjectFile(p, doc.text(), 'live');
                    }
                } finally { this._tmApplying = false; }
                this._teamLocks = { ...(d.locks || {}) };
                if (Array.isArray(d.board) && d.board.length) this.tmBoardApply({ op: 'state', items: d.board });
                this.tmLiveRefreshEditor();
                if (this.renderStudioExplorer) this.renderStudioExplorer();
                this.tmLiveLog(`🔄 تمت المزامنة (${Object.keys(d.files || {}).length} ملف)`);
                this.showToast('🔄 تمت مزامنة المشروع مع الجلسة الحية', 'success');
                break;
            case 'op': this.tmLiveApplyOps(d.path, d.ops, peer); break;
            case 'file': {
                const cur = L.docs.get(d.path);
                if (cur && cur.origin && d.origin && cur.origin < d.origin) break; // deterministic winner for concurrent creates
                const doc = RGA.fromSnapshot(L.site, d.snap); doc.origin = d.origin;
                L.docs.set(d.path, doc);
                this._tmApplying = true;
                try { this.writeProjectFile(d.path, doc.text(), 'live'); } finally { this._tmApplying = false; }
                if (this.renderStudioExplorer) this.renderStudioExplorer();
                this.tmLiveLog(`📄 ${peer.name} أنشأ ${d.path}`);
                break;
            }
            case 'rm':
                if (L.docs.has(d.path)) { L.docs.delete(d.path); this._tmApplying = true; try { this.virtualProjectFiles.delete(d.path); } finally { this._tmApplying = false; } if (this.renderStudioExplorer) this.renderStudioExplorer(); this.tmLiveLog(`🗑️ ${peer.name} حذف ${d.path}`); }
                break;
            case 'presence': peer.file = d.file; peer.line = d.line; if (d.color) peer.color = d.color; break;
            case 'lock':
                if (d.on) this._teamLocks[d.path] = { by: peer.name, site: d.from, t: Date.now() };
                else if (this._teamLocks[d.path] && this._teamLocks[d.path].site === d.from) delete this._teamLocks[d.path];
                this.tmLiveLog(d.on ? `🔒 ${peer.name} يحرر ${d.path}` : `🔓 ${peer.name} حرر ${d.path}`);
                break;
            case 'wb': this.tmBoardApply(d); break;
            case 'chat': if (this.tmOnRemoteChat) this.tmOnRemoteChat(d); break;
            case 'channel': if (this.tmOnRemoteChannel) this.tmOnRemoteChannel(d); break;
            case 'suggest': if (this.tmOnRemoteSuggestion) this.tmOnRemoteSuggestion(d); break;
            case 'bye':
                L.peers.delete(d.from);
                Object.keys(this._teamLocks).forEach(p => { if (this._teamLocks[p].site === d.from) delete this._teamLocks[p]; });
                this.tmLiveLog(`👋 غادر ${peer.name}`);
                break;
        }
        this.tmLiveBar();
        if (document.getElementById('tm-live-panel') && d.t !== 'op') this.tmLiveRenderPanel();
    };
    P.tmLiveLog = function (text) { const L = this._teamLive; if (!L) return; L.log.unshift({ t: Date.now(), text }); L.log.length = Math.min(L.log.length, 60); };
    P.tmLiveApplyOps = function (path, ops, peer) {
        const L = this._teamLive;
        const doc = L && L.docs.get(path);
        if (!doc) return false;
        if (!doc.apply(ops)) return false;
        const text = doc.text();
        this._tmApplying = true;
        try { this.writeProjectFile(path, text, 'live'); } finally { this._tmApplying = false; }
        if (path === this.activeStudioFile) this.tmLiveRefreshEditor();
        if (peer && this.tmMyFiles && this.tmMyFiles().has(path) && Date.now() - (L.lastEditNote || 0) > 30000) {
            L.lastEditNote = Date.now();
            this.tmInboxPush({ key: 'le' + path + Math.floor(Date.now() / 60000), kind: 'edit', title: `✏️ ${peer.name} يعدّل ملفك ${path}`, body: 'جلسة حية' });
        }
        return true;
    };
    P.tmLiveRefreshEditor = function () {
        const p = this.activeStudioFile, f = p && this.virtualProjectFiles.get(p);
        if (f && this.codeEditor && this.codeEditor.setValue && this.codeEditor.getPath && this.codeEditor.getPath() === p) try { this.codeEditor.setValue(f.content || ''); } catch (e) { /* editor gone */ }
    };
    /** Main-bundle hook: a local write while a session is active → CRDT ops to peers (+ auto-lock #746). */
    P.teamLiveOnWrite = function (path, prev, next) {
        const L = this._teamLive;
        if (!L || this._tmApplying) return;
        if (!next) { if (L.docs.delete(path)) this.tmLiveSend({ t: 'rm', path }); return; }
        if (!textEntry(next)) return;
        let doc = L.docs.get(path);
        if (!doc) { doc = RGA.fromText(L.site, next.content); doc.origin = L.site; L.docs.set(path, doc); this.tmLiveSend({ t: 'file', path, snap: doc.snapshot(), origin: doc.origin }); return; }
        const ops = doc.localReplace(next.content);
        if (!ops.length) return;
        this.tmLiveSend({ t: 'op', path, ops });
        if (L.autoLock && (this._writeReason || 'edit') === 'edit') this.tmLiveLock(path, true, { auto: true });
    };
    P.tmLiveTick = function () {
        const L = this._teamLive;
        if (!L) return;
        const file = this.activeStudioFile || null, line = this.studioCaretLine ? this.studioCaretLine() : 0;
        if (file !== L.lastFile || line !== L.lastLine || Date.now() - (L.lastPresence || 0) > 12000) {
            L.lastFile = file; L.lastLine = line; L.lastPresence = Date.now();
            this.tmLiveSend({ t: 'presence', file, line, color: L.color });
        }
        const now = Date.now();
        L.peers.forEach((p, id) => { if (now - p.t > 30000) { L.peers.delete(id); Object.keys(this._teamLocks).forEach(k => { if (this._teamLocks[k].site === id) delete this._teamLocks[k]; }); } });
        Object.entries(this._teamLocks || {}).forEach(([p, lk]) => { if (lk.site === L.site && lk.auto && now - (lk.last || lk.t) > LOCK_IDLE) this.tmLiveLock(p, false); });
        this.tmLiveBar();
    };

    // ------------------------------------------------------------------ LOCKS (#746)
    P.tmLiveLock = function (path, on = true, { auto = false } = {}) {
        const L = this._teamLive;
        const locks = this._teamLocks = this._teamLocks || {};
        const cur = locks[path];
        if (on) {
            if (cur && L && cur.site !== L.site) { this.showToast(`🔒 ${this.escapeHTML(path)} مقفل بواسطة ${this.escapeHTML(cur.by)}`, 'warning'); return false; }
            if (cur && L && cur.site === L.site) { cur.last = Date.now(); return true; }
            locks[path] = { by: L ? L.name : this.tmMeSync(), site: L ? L.site : 'local', t: Date.now(), last: Date.now(), auto };
        } else {
            if (!cur || (L && cur.site !== L.site)) return false;
            delete locks[path];
        }
        this.tmLiveSend({ t: 'lock', path, on });
        if (document.getElementById('tm-live-panel')) this.tmLiveRenderPanel();
        return true;
    };

    // ------------------------------------------------------------------ WEBRTC SIGNALLING (invite link / code)
    P.tmLiveNewConn = function (id) {
        const W = win();
        if (!W.RTCPeerConnection) throw new Error('المتصفح لا يدعم WebRTC');
        const pc = new W.RTCPeerConnection({ iceServers: LIVE_ICE });
        const c = { id, pc, dc: null, state: 'جارٍ الاتصال' };
        const bind = (dc) => {
            c.dc = dc;
            dc.onopen = () => { c.state = 'متصل'; this.tmLiveSend({ t: 'hello', name: this._teamLive.name, color: this._teamLive.color, host: this._teamLive.host }); this.tmLiveBar(); if (document.getElementById('tm-live-panel')) this.tmLiveRenderPanel(); };
            dc.onmessage = (e) => this.tmLiveReceive(e.data, id);
            dc.onclose = () => { c.state = 'انقطع'; this.tmLiveBar(); };
        };
        c.bind = bind;
        pc.ondatachannel = (e) => bind(e.channel);
        pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) c.state = 'انقطع'; };
        this._teamLive.conns.set(id, c);
        return c;
    };
    /** Host: create an invite (offer) → link #oxlive=… */
    P.tmLiveInvite = async function () {
        let L = this._teamLive;
        if (!L) L = this.tmLiveStart({ room: val('tm-live-room') || undefined, name: val('tm-live-name') || undefined });
        if (!L.host) throw new Error('فقط مضيف الجلسة يمكنه إنشاء الدعوات');
        const id = uid('c');
        const c = this.tmLiveNewConn(id);
        c.bind(c.pc.createDataChannel('oxlive', { ordered: true }));
        await c.pc.setLocalDescription(await c.pc.createOffer());
        await waitIce(c.pc);
        const code = encodeLive({ k: 'o', id, room: L.room, from: L.name, sdp: c.pc.localDescription.sdp });
        c.state = 'بانتظار الرد';
        const url = `${this.shareBaseUrl ? this.shareBaseUrl() : location.origin + location.pathname}#oxlive=${code}`;
        L.lastInvite = { id, url, code };
        return { id, url, code };
    };
    /** Joiner: accept an offer code → answer code to send back. */
    P.tmLiveJoin = async function (code, { name } = {}) {
        let o;
        try { o = decodeLive(code); } catch (e) { throw new Error('رمز الدعوة غير صالح'); }
        if (!o || o.k !== 'o') throw new Error('هذا ليس رمز دعوة جلسة حية');
        const L = this.tmLiveStart({ room: o.room, name: name || this.tmMeSync(), host: false });
        const c = this.tmLiveNewConn(o.id);
        await c.pc.setRemoteDescription({ type: 'offer', sdp: o.sdp });
        await c.pc.setLocalDescription(await c.pc.createAnswer());
        await waitIce(c.pc);
        const answer = encodeLive({ k: 'a', id: o.id, from: L.name, sdp: c.pc.localDescription.sdp });
        L.answer = answer;
        if (o.ch && this.tmHasGH()) this.tmSend(o.ch, `🔗 رد الانضمام للجلسة الحية <!--oxliveans ${JSON.stringify({ id: o.id, code: answer })}-->`, { silent: true }).catch(() => {});
        return { answer, room: o.room, from: o.from };
    };
    /** Host: paste the joiner's answer code. */
    P.tmLiveAccept = async function (code = val('tm-live-answer')) {
        const L = this._teamLive;
        if (!L) throw new Error('لا توجد جلسة');
        let a;
        try { a = decodeLive(code); } catch (e) { throw new Error('رمز الرد غير صالح'); }
        const c = a && a.k === 'a' && L.conns.get(a.id);
        if (!c) throw new Error('الرد لا يطابق أي دعوة مفتوحة');
        await c.pc.setRemoteDescription({ type: 'answer', sdp: a.sdp });
        c.name = a.from;
        this.tmLiveLog(`🔗 اتصال مع ${a.from}`);
        return c;
    };
    /** Opened from #oxlive=… */
    P.tmOpenLiveHash = async function (hash = location.hash) {
        const code = String(hash).replace(/^#oxlive=/, '');
        await this.openTeamHub('live', 'session');
        try {
            const r = await this.tmLiveJoin(code);
            setHTML('tm-live-join-out', `<div class="fmx-invite"><b>أرسل هذا الرد إلى ${esc(r.from)}:</b><textarea class="form-input-box" dir="ltr" rows="3" readonly onclick="this.select()">${esc(r.answer)}</textarea>${btn('fa-copy', 'نسخ الرد', call('copyToClipboard', r.answer))}</div>`);
            return r;
        } catch (e) { return this.tmErr(e, 'tm-live-join-out'); }
    };
    /** Auto-signalling through a team channel: post the invite, poll for the joiner's answer. */
    P.tmLiveInviteToChannel = async function (ch = this._tmChan) {
        if (!this.tmHasGH()) { this.showToast('الإرسال عبر القناة يحتاج رمز GitHub', 'warning'); return null; }
        if (ch == null) { const list = await this.tmEnsureGeneral(); ch = list[0] && list[0].id; }
        const inv = await this.tmLiveInvite();
        const o = decodeLive(inv.code); o.ch = ch;
        const code = encodeLive(o);
        const url = inv.url.replace(/#oxlive=.*$/, '#oxlive=' + code);
        await this.tmSend(ch, `🔴 جلسة تحرير حية — انضم: ${url}`, { silent: true });
        const L = this._teamLive;
        clearInterval(L.chanPoll);
        let tries = 0;
        L.chanPoll = setInterval(async () => {
            if (!this._teamLive || ++tries > 60) return clearInterval(L.chanPoll);
            const msgs = await this.tmMessages(ch).catch(() => []);
            for (const m of msgs) { const ans = readMarker('liveans', m.body); const c = ans && L.conns.get(ans.id); if (c && c.state === 'بانتظار الرد') await this.tmLiveAccept(ans.code).catch(() => {}); }
        }, 5000);
        return { url, ch };
    };

    // ------------------------------------------------------------------ UI
    P.tmLiveBar = function () {
        const L = this._teamLive;
        let bar = document.getElementById('tm-live-bar');
        if (!L) { if (bar) bar.remove(); return; }
        if (!bar) { bar = document.createElement('div'); bar.id = 'tm-live-bar'; bar.className = 'tmx-live-bar'; bar.onclick = () => this.openTeamHub('live', 'session'); document.body.appendChild(bar); }
        const peers = [...L.peers.values()];
        bar.innerHTML = `<span class="tmx-dot"></span> مباشر • <span class="tmx-av-s" style="background:${L.color}">${esc(L.name.slice(0, 1))}</span>${peers.map(p => `<span class="tmx-av-s" style="background:${p.color}" title="${esc(p.name)}${p.file ? ' — ' + esc(p.file) + ':' + p.line : ''}">${esc(String(p.name).slice(0, 1))}</span>`).join('')}`;
    };
    P.tmLive = async function () {
        this._tmMount = () => this.tmLiveRenderPanel();
        return '<div id="tm-live-panel"></div><div id="tm-live-join-out"></div>';
    };
    P.tmLiveRenderPanel = function () {
        const L = this._teamLive;
        const el = document.getElementById('tm-live-panel');
        if (!el) return;
        if (!L) {
            el.innerHTML = card('جلسة تحرير حية', `<p class="tmx-note">اكتبوا معاً في نفس الملفات لحظياً مثل Google Docs — بدون خادم: اتصال مباشر WebRTC بين المتصفحات + تبويبات نفس المتصفح. التعارضات تُحل تلقائياً بخوارزمية CRDT.</p>
                <div class="gh-row">${field('tm-live-name', 'اسمك', this.tmMeSync())}${field('tm-live-room', 'اسم الغرفة', this.tmRepoKey().replace('/', '-'))}${pbtn('fa-tower-broadcast', 'بدء جلسة', call('tmLiveStartUI'))}</div>`, 'fa-tower-broadcast')
                + card('الانضمام برمز', `<div class="gh-row">${area('tm-live-code', 'رمز/رابط الدعوة', '', 2, 'dir="ltr"')}${btn('fa-right-to-bracket', 'انضمام', call('tmLiveJoinUI'))}</div><div class="gh-row">${field('tm-live-room2', 'أو اسم غرفة على نفس الجهاز', '')}${btn('fa-clone', 'انضمام محلي', call('tmLiveJoinLocal'))}</div>`, 'fa-right-to-bracket');
            return;
        }
        const peers = [...L.peers.entries()];
        const locks = Object.entries(this._teamLocks || {});
        const conns = [...L.conns.values()];
        el.innerHTML = card(`الغرفة ${esc(L.room)} ${L.host ? '(مضيف)' : ''}`, `<div class="gh-row">${L.host ? pbtn('fa-user-plus', 'دعوة برابط', call('tmLiveInviteUI')) + btn('fa-hashtag', 'دعوة عبر قناة الفريق', call('tmLiveInviteToChannel')) : ''}${btn('fa-stop', 'إنهاء', call('tmLiveStop'))}<label class="fmx-toggle"><input type="checkbox" ${L.autoLock ? 'checked' : ''} onchange="app._teamLive && (app._teamLive.autoLock = this.checked)"> قفل تلقائي للملف أثناء تحريره</label></div>
            <div id="tm-live-invite"></div>
            ${L.host && conns.some(c => c.state === 'بانتظار الرد') ? `<div class="gh-row">${area('tm-live-answer', 'الصق رد الزميل', '', 2, 'dir="ltr"')}${pbtn('fa-link', 'ربط', call('tmLiveAcceptUI'))}</div>` : ''}
            ${L.answer ? `<div class="fmx-invite"><b>ردّك (أرسله للمضيف):</b><textarea class="form-input-box" dir="ltr" rows="2" readonly onclick="this.select()">${esc(L.answer)}</textarea></div>` : ''}`, 'fa-tower-broadcast')
            + card(`المشاركون (${peers.length + 1})`, `<div class="gh-item"><span><span class="tmx-av-s" style="background:${L.color}">${esc(L.name.slice(0, 1))}</span> ${esc(L.name)} (أنت)</span><small>${esc(this.activeStudioFile || '—')}</small></div>${peers.map(([, p]) => `<div class="gh-item"><span><span class="tmx-av-s" style="background:${p.color}">${esc(String(p.name).slice(0, 1))}</span> ${esc(p.name)}</span><small dir="ltr">${p.file ? esc(p.file) + ':' + p.line : '—'} • ${ago(p.t)}</small>${p.file ? btn('fa-location-crosshairs', '', call('tmLiveFollowPeer', p.file, p.line), 'sidebar-btn-util gh-btn', 'title="اذهب إلى مكانه"') : ''}</div>`).join('')}
                ${conns.length ? `<div class="tmx-note">اتصالات WebRTC: ${conns.map(c => esc((c.name || c.id) + ' — ' + c.state)).join(' • ')}</div>` : ''}`, 'fa-users')
            + card('الملفات المقفلة', `${locks.length ? locks.map(([p, lk]) => `<div class="gh-item"><code dir="ltr">${esc(p)}</code><span>🔒 ${esc(lk.by)}</span>${lk.site === L.site ? btn('fa-lock-open', 'تحرير', call('tmLiveLock', p, false)) : ''}</div>`).join('') : empty('لا ملفات مقفلة')}
                <div class="gh-row">${btn('fa-lock', 'اقفل الملف الحالي', call('tmLiveLockActive'))}</div>`, 'fa-lock')
            + card('السجل', `<div class="fmx-timeline">${L.log.slice(0, 20).map(x => `<div class="fmx-tl-item"><span class="fmx-tl-time">${ago(x.t)}</span><span>${esc(x.text)}</span></div>`).join('') || empty('—')}</div>`, 'fa-list');
    };
    P.tmLiveStartUI = function () { this.tmLiveStart({ room: val('tm-live-room') || undefined, name: val('tm-live-name') || undefined }); this.showToast('🔴 بدأت الجلسة الحية — ادعُ زملاءك', 'success'); this.tmLiveRenderPanel(); return this._teamLive; };
    P.tmLiveJoinLocal = function () { const room = val('tm-live-room2'); if (!room) return null; this.tmLiveStart({ room, host: false }); this.tmLiveRenderPanel(); return this._teamLive; };
    P.tmLiveInviteUI = async function () {
        try {
            const inv = await this.tmLiveInvite();
            setHTML('tm-live-invite', `<div class="fmx-invite"><input class="form-input-box" dir="ltr" readonly value="${esc(inv.url)}" onclick="this.select()"><div class="gh-row">${btn('fa-copy', 'نسخ الرابط', call('copyToClipboard', inv.url))}</div><div id="tm-live-qr"></div></div>`);
            if (this.renderQR) this.renderQR(inv.url, 'tm-live-qr');
            setTimeout(() => this.tmLiveRenderPanel(), 0);
            return inv;
        } catch (e) { return this.tmErr(e); }
    };
    P.tmLiveJoinUI = async function () {
        try { const r = await this.tmLiveJoin(val('tm-live-code')); this.tmLiveRenderPanel(); return r; } catch (e) { return this.tmErr(e); }
    };
    P.tmLiveAcceptUI = async function () { try { const c = await this.tmLiveAccept(); this.showToast('🔗 تم الربط', 'success'); this.tmLiveRenderPanel(); return c; } catch (e) { return this.tmErr(e); } };
    P.tmLiveLockActive = function () { if (!this.activeStudioFile) { this.showToast('افتح ملفاً في الاستوديو أولاً', 'info'); return false; } return this.tmLiveLock(this.activeStudioFile, true); };
    P.tmLiveFollowPeer = function (file, line) {
        if (!this.virtualProjectFiles.has(file)) return false;
        this.closeModals();
        this.openProjectFile(file);
        setTimeout(() => {
            const ed = this.codeEditor, text = (this.virtualProjectFiles.get(file) || {}).content || '';
            const off = text.split('\n').slice(0, Math.max(0, (line || 1) - 1)).reduce((n, l) => n + l.length + 1, 0);
            if (ed && ed.setSelection) try { ed.setSelection(off, off); } catch (e) { /* editor not ready */ }
        }, 60);
        return true;
    };

    // ------------------------------------------------------------------ SHARED WHITEBOARD (#756)
    P.tmEnsureBoard = async function () {
        if (!this._wb) {
            let saved = null;
            try { saved = this.idbGet ? await this.idbGet('whiteboard_v1') : null; } catch (e) {}
            if (!this._wb) this._wb = { items: (saved && saved.items) || [], redo: [], tool: 'pen', color: '#38bdf8', size: 4, bg: (saved && saved.bg) || 'dark' };
        }
        return this._wb;
    };
    P.tmBoardApply = async function (d) {
        const wb = await this.tmEnsureBoard();
        const k = (it) => JSON.stringify(it);
        if (d.op === 'add' && d.item) { if (!wb.items.some(x => k(x) === k(d.item))) wb.items.push(d.item); }
        else if (d.op === 'del' && d.key) { const i = wb.items.map(k).lastIndexOf(d.key); if (i >= 0) wb.items.splice(i, 1); }
        else if (d.op === 'clear') wb.items = [];
        else if (d.op === 'state' && Array.isArray(d.items)) { const have = new Set(wb.items.map(k)); d.items.forEach(it => { if (!have.has(k(it))) wb.items.push(it); }); }
        if (this.wbRender) this.wbRender();
        if (this.wbSave) this.wbSave();
        return wb.items.length;
    };
    const _add = P.wbAddItem, _undo = P.wbUndo, _redo = P.wbRedo, _clear = P.wbClear;
    if (_add && !_add.__tmLive) {
        P.wbAddItem = function (item) { const r = _add.apply(this, arguments); if (this._teamLive) this.tmLiveSend({ t: 'wb', op: 'add', item }); return r; };
        P.wbAddItem.__tmLive = true;
        P.wbUndo = function () { const it = _undo.apply(this, arguments); if (it && this._teamLive) this.tmLiveSend({ t: 'wb', op: 'del', key: JSON.stringify(it) }); return it; };
        P.wbRedo = function () { const it = _redo.apply(this, arguments); if (it && this._teamLive) this.tmLiveSend({ t: 'wb', op: 'add', item: it }); return it; };
        P.wbClear = async function () { const had = this._wb && this._wb.items.length; const r = await _clear.apply(this, arguments); if (had && this._wb && !this._wb.items.length && this._teamLive) this.tmLiveSend({ t: 'wb', op: 'clear' }); return r; };
    }
    P.tmBoard = async function () {
        const L = this._teamLive, wb = this._wb;
        return card('السبورة المشتركة', `<p class="tmx-note">ارسموا معاً: كل خط أو شكل أو نص يُرسم على السبورة يظهر فوراً عند كل المشاركين في الجلسة الحية (والتراجع والمسح أيضاً).</p>
            <div class="fmx-stats"><div><b>${L ? '🟢 متصل' : '⚪ غير متصل'}</b><small>الجلسة</small></div><div><b>${L ? L.peers.size + 1 : 1}</b><small>المشاركون</small></div><div><b>${wb ? wb.items.length : 0}</b><small>عناصر الرسم</small></div></div>
            <div class="gh-row">${pbtn('fa-chalkboard', 'افتح السبورة', call('openWhiteboard'))}${L ? btn('fa-arrows-rotate', 'إرسال السبورة كاملة', call('tmBoardPush')) : btn('fa-tower-broadcast', 'ابدأ جلسة حية', call('tmLoad', 'live', 'session'))}</div>`, 'fa-chalkboard');
    };
    P.tmBoardPush = async function () { const wb = await this.tmEnsureBoard(); this.tmLiveSend({ t: 'wb', op: 'state', items: wb.items }); this.showToast('📤 أُرسلت السبورة', 'success'); return wb.items.length; };

    // ------------------------------------------------------------------ CALLS (#752 voice, #753 video, #754 screen) via the media call room
    P.tmCall = async function () {
        const r = this._fmxRoom;
        const chans = await this.tmChannelList().catch(() => []);
        return card('مكالمات الفريق', `<p class="tmx-note">مكالمة جماعية مباشرة (WebRTC) — صوت أو فيديو أو مشاركة شاشة. تُنشأ دعوة ويمكن نشرها تلقائياً في قناة الفريق ليدخل الزملاء بنقرة.</p>
            <div class="gh-row">${select('tm-call-ch', 'انشر الدعوة في', [['', '— لا تنشر —'], ...chans.map(c => [String(c.id), '#' + c.name])], chans[0] ? String(chans[0].id) : '')}</div>
            <div class="gh-row">${pbtn('fa-phone', 'مكالمة صوتية', call('tmStartCall', 'mic'))}${pbtn('fa-video', 'مكالمة فيديو', call('tmStartCall', 'cam'))}${btn('fa-display', 'مشاركة الشاشة', call('tmStartCall', 'screen'))}</div>
            ${r && Object.keys(r.peers || {}).length ? `<div class="tmx-note">🟢 مكالمة جارية مع ${Object.keys(r.peers).length} مشارك — ${btn('fa-up-right-from-square', 'افتح الغرفة', call('openFilesHub', 'call', 'room'))}</div>` : ''}`, 'fa-phone');
    };
    P.tmStartCall = async function (kind = 'mic', ch = val('tm-call-ch')) {
        try { await this.loadChunk('media'); } catch (e) { return this.tmErr(new Error('تعذر تحميل غرفة الاتصال')); }
        await this.openFilesHub('call', 'room');
        if (kind === 'screen') { await this.fmxCallMedia('mic').catch(() => null); await this.fmxShareScreen(); }
        else await this.fmxCallMedia(kind);
        const inv = await this.fmxCallInvite();
        const label = { mic: '📞 مكالمة صوتية', cam: '🎥 مكالمة فيديو', screen: '🖥️ مشاركة شاشة' }[kind];
        if (ch && inv && inv.url) await this.tmSend(isNaN(+ch) ? ch : +ch, `${label} للفريق — انضم: ${inv.url}`, { silent: true }).catch(e => this.tmErr(e));
        if (this.addXP) this.addXP(5, 'call');
        return inv;
    };
}
