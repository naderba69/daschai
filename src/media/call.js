/* Calls: WebRTC rooms with serverless (copy/paste/QR/link) signalling — group video call as a mesh (#693), screen share (#692),
   one-to-many live broadcast (#691), call recording (#694); AI minutes — live transcript (#695), summary (#696), action items (#697),
   live caption translation shared over the data channel (#698), suggested replies (#699); presentation mode with notes/timer/laser (#700). */
import { deflateSync, inflateSync } from 'fflate';
import { esc, call, btn, pbtn, card, empty, field, select, fmtTime, makeBlob, bytesToB64url, b64ToBytes, utf8, fromUtf8, val, win, uid, isTextEntry } from './shared.js';
import { sourcePicker, readSources } from './core.js';
import { aiReady, listen, hasKey } from './aiio.js';
import { LANGS, langEn, transcribeAudio } from './voice.js';
import { pickVideoMime } from './video.js';

export const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
/** SDP ↔ compact URL-safe code (deflate + base64url). */
export const encodeSignal = (obj) => bytesToB64url(deflateSync(utf8(JSON.stringify(obj)), { level: 9 }));
export const decodeSignal = (code) => JSON.parse(fromUtf8(inflateSync(b64ToBytes(String(code).trim().replace(/^.*#fmxcall=/, '')))));
/** Grid layout for n tiles in w×h → [{x,y,w,h}] */
export function gridLayout(n, w, h) {
    if (n <= 0) return [];
    const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), tw = w / cols, th = h / rows;
    return Array.from({ length: n }, (_, i) => ({ x: (i % cols) * tw, y: Math.floor(i / cols) * th, w: tw, h: th }));
}
/** Markdown → slides: split on --- or #/## headings outside fences; "Note:/ملاحظة:" lines become speaker notes. */
export function slidesFromMarkdown(md) {
    const out = []; let buf = [], notes = [], inFence = false;
    const flush = () => { const body = buf.join('\n').trim(); if (body) out.push({ kind: 'answer', md: body, notes: notes.join('\n') }); buf = []; notes = []; };
    String(md || '').split('\n').forEach(line => {
        if (/^\s*```/.test(line)) inFence = !inFence;
        if (!inFence && /^---+\s*$/.test(line)) { flush(); return; }
        if (!inFence && /^#{1,2}\s/.test(line) && buf.join('').trim()) flush();
        const n = !inFence && /^\s*(?:Note|Notes|ملاحظة|ملاحظات)\s*:\s*(.*)$/i.exec(line);
        if (n) notes.push(n[1]); else buf.push(line);
    });
    flush();
    return out;
}

export function installCall(P) {
    const W = () => win();
    const out = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; return el; };
    const room = (app) => (app._fmxRoom = app._fmxRoom || { peers: {}, local: null, screen: null, mode: 'call', name: 'أنا', chat: [], transcript: [], id: uid('r') });
    const waitIce = (pc) => new Promise(res => { if (pc.iceGatheringState === 'complete') return res(); const t = setTimeout(res, 4000); pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } }); });
    const shareUrl = (app, code) => `${app.shareBaseUrl ? app.shareBaseUrl() : location.origin + location.pathname}#fmxcall=${code}`;

    // ================================================================ ROOM (#691 #692 #693 #694)
    P.fmxCallRoom = function () {
        const r = room(this);
        this._fmxMount = () => this.fmxRoomRender();
        return card('غرفة الاتصال', `<div class="gh-row">${field('fmx-call-name', 'اسمك', r.name)}${select('fmx-call-mode', 'النوع', [['call', 'مكالمة جماعية (فيديو/صوت)'], ['broadcast', 'بث مباشر (مشاهدون فقط)']], r.mode)}</div>
            <div class="gh-row">${pbtn('fa-video', 'تشغيل الكاميرا', "app.fmxCallMedia('cam')")}${btn('fa-microphone', 'صوت فقط', "app.fmxCallMedia('mic')")}${btn('fa-display', 'مشاركة الشاشة', 'app.fmxShareScreen()')}${btn('fa-microphone-slash', 'كتم/إلغاء', 'app.fmxToggleMute()')}${btn('fa-circle-dot', 'تسجيل المكالمة', 'app.fmxCallRecord()')}${btn('fa-phone-slash', 'إنهاء', 'app.fmxHangup()', 'sidebar-btn-util gh-btn danger')}</div>
            <div id="fmx-call-grid" class="fmx-call-grid"></div>
            <div class="fmx-card-h"><i class="fa-solid fa-user-plus"></i> دعوة مشارك</div>
            <div class="gh-row">${pbtn('fa-link', 'إنشاء دعوة جديدة', 'app.fmxCallInvite()')}<span class="text-dim">دعوة لكل مشارك (شبكة Mesh حتى ~6 أشخاص). أرسل الرابط ثم الصق رمز الرد الذي يعيده لك.</span></div>
            <div id="fmx-call-invite"></div>
            <div class="gh-row">${field('fmx-call-code', 'الصق رمز دعوة أو رد', '', 'dir="ltr"')}${btn('fa-right-to-bracket', 'انضمام / قبول', 'app.fmxCallPaste()')}</div>
            <div class="fmx-card-h"><i class="fa-solid fa-comments"></i> الدردشة</div><div id="fmx-call-chat" class="fmx-talk-log"></div><div class="gh-row">${field('fmx-call-msg', '', '', 'dir="auto" placeholder="رسالة…" onkeydown="if(event.key===\'Enter\')app.fmxCallSend()"')}${btn('fa-paper-plane', 'إرسال', 'app.fmxCallSend()')}</div>
            <div class="text-dim">اتصال مباشر نظير-لنظير عبر WebRTC (STUN فقط، بلا خادم) — قد يفشل خلف شبكات مؤسسية صارمة تتطلب TURN. البث إلى YouTube/Twitch يتطلب RTMP غير المتاح في المتصفحات؛ «البث المباشر» هنا يرسل الصورة لمشاهديك مباشرة.</div><div id="fmx-out"></div>`, 'fa-phone');
    };
    P.fmxRoomRender = function () {
        const r = room(this), g = document.getElementById('fmx-call-grid');
        if (!g) return;
        const tiles = [];
        if (r.screen) tiles.push(['screen', '🖥️ شاشتك', r.screen, true]);
        if (r.local) tiles.push(['local', '🧑 ' + r.name, r.local, true]);
        Object.values(r.peers).forEach(p => { if (p.stream) tiles.push([p.id, (p.name || 'مشارك') + (p.state === 'connected' ? '' : ' (' + p.state + ')'), p.stream, false]); else tiles.push([p.id, (p.name || 'مشارك') + ' — ' + p.state, null, false]); });
        g.innerHTML = tiles.map(([id, label, , muted]) => `<div class="fmx-tile" data-tile="${esc(id)}"><video autoplay playsinline ${muted ? 'muted' : ''}></video><span>${esc(label)}</span></div>`).join('') || empty('شغّل الكاميرا أو الصوت للبدء');
        tiles.forEach(([id, , stream]) => { const tile = Array.from(g.querySelectorAll('[data-tile]')).find(x => x.dataset.tile === id), v = tile && tile.querySelector('video'); if (v && stream) { try { v.srcObject = stream; } catch (e) {} } });
        const c = document.getElementById('fmx-call-chat');
        if (c) c.innerHTML = r.chat.map(m => `<div class="fmx-talk" dir="auto"><b>${esc(m.from)}:</b> ${esc(m.text)}</div>`).join('');
    };
    P.fmxCallMedia = async function (kind = 'cam') {
        const r = room(this);
        r.name = val('fmx-call-name') || r.name;
        try {
            if (r.local) r.local.getTracks().forEach(t => t.stop());
            r.local = await W().navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: kind === 'cam' ? { width: 640, height: 360 } : false });
            Object.values(r.peers).forEach(p => this.fmxPeerAttach(p));
            this.fmxRoomRender();
            return r.local;
        } catch (e) { this.showToast('📷 ' + e.message, 'error'); return null; }
    };
    P.fmxShareScreen = async function () {
        const r = room(this);
        if (r.screen) { r.screen.getTracks().forEach(t => t.stop()); r.screen = null; Object.values(r.peers).forEach(p => this.fmxPeerAttach(p)); this.fmxRoomRender(); return null; }
        try {
            r.screen = await W().navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            r.screen.getVideoTracks()[0].onended = () => { r.screen = null; Object.values(r.peers).forEach(p => this.fmxPeerAttach(p)); this.fmxRoomRender(); };
            Object.values(r.peers).forEach(p => this.fmxPeerAttach(p));
            this.fmxRoomRender();
            return r.screen;
        } catch (e) { this.showToast('🖥️ ' + e.message, 'warning'); return null; }
    };
    P.fmxToggleMute = function () { const r = room(this); const t = r.local && r.local.getAudioTracks()[0]; if (t) { t.enabled = !t.enabled; this.showToast(t.enabled ? '🎙️ الميكروفون يعمل' : '🔇 مكتوم', 'info'); } return t && t.enabled; };
    /** Attach/replace outgoing tracks (screen replaces camera video). */
    P.fmxPeerAttach = function (p) {
        const r = room(this);
        if (p.viewer === 'in') return;
        const video = (r.screen && r.screen.getVideoTracks()[0]) || (r.local && r.local.getVideoTracks()[0]) || null;
        const audio = (r.local && r.local.getAudioTracks()[0]) || (r.screen && r.screen.getAudioTracks()[0]) || null;
        const stream = r.local || r.screen || new (W().MediaStream)();
        [['video', video], ['audio', audio]].forEach(([kind, track]) => {
            const tx = p.pc.getTransceivers().find(t => t.receiver && t.receiver.track && t.receiver.track.kind === kind);
            if (tx && tx.sender) { tx.sender.replaceTrack(track).catch(() => {}); if (track && tx.sender.setStreams) try { tx.sender.setStreams(stream); } catch (e) {} }
        });
    };
    P.fmxNewPeer = function ({ id = uid('p'), viewer = null } = {}) {
        const r = room(this), pc = new (W().RTCPeerConnection)({ iceServers: ICE });
        const p = { id, pc, state: 'new', name: '', stream: null, viewer };
        const dir = viewer === 'out' ? 'sendonly' : viewer === 'in' ? 'recvonly' : 'sendrecv';
        pc.addTransceiver('video', { direction: dir });
        pc.addTransceiver('audio', { direction: dir });
        pc.ontrack = (ev) => { p.stream = ev.streams[0] || p.stream || new (W().MediaStream)(); if (!ev.streams[0]) p.stream.addTrack(ev.track); this.fmxRoomRender(); };
        pc.onconnectionstatechange = () => { p.state = pc.connectionState; if (p.state === 'connected') this.showToast(`🔗 ${p.name || 'مشارك'} متصل`, 'success'); if (['failed', 'closed'].includes(p.state)) delete r.peers[id]; this.fmxRoomRender(); };
        const bindDC = (dc) => { p.dc = dc; dc.onopen = () => dc.send(JSON.stringify({ t: 'hello', name: r.name })); dc.onmessage = (ev) => this.fmxCallOnData(p, ev.data); };
        pc.ondatachannel = (ev) => bindDC(ev.channel);
        p.bindDC = bindDC;
        r.peers[id] = p;
        this.fmxPeerAttach(p);
        return p;
    };
    P.fmxCallOnData = function (p, raw) {
        const r = room(this);
        let m; try { m = JSON.parse(raw); } catch (e) { return; }
        if (m.t === 'hello') { p.name = m.name; this.fmxRoomRender(); }
        if (m.t === 'chat') { r.chat.push({ from: p.name || 'مشارك', text: m.text }); this.fmxRoomRender(); }
        if (m.t === 'caption') { r.transcript.push({ t: Date.now(), who: p.name || 'مشارك', text: m.text, tr: m.tr }); this.fmxCaptionsRender && this.fmxCaptionsRender(); this.fmxMaybeSuggest && this.fmxMaybeSuggest(); }
    };
    P.fmxCallBroadcast = function (msg) { Object.values(room(this).peers).forEach(p => { try { if (p.dc && p.dc.readyState === 'open') p.dc.send(JSON.stringify(msg)); } catch (e) {} }); };
    P.fmxCallSend = function (textArg) { const r = room(this), t = textArg || val('fmx-call-msg'); if (!t) return null; r.chat.push({ from: r.name, text: t }); this.fmxCallBroadcast({ t: 'chat', text: t }); const i = document.getElementById('fmx-call-msg'); if (i) i.value = ''; this.fmxRoomRender(); return t; };
    P.fmxCallInvite = async function () {
        const r = room(this);
        r.name = val('fmx-call-name') || r.name; r.mode = val('fmx-call-mode') || r.mode;
        const p = this.fmxNewPeer({ viewer: r.mode === 'broadcast' ? 'out' : null });
        p.bindDC(p.pc.createDataChannel('ox'));
        await p.pc.setLocalDescription(await p.pc.createOffer());
        await waitIce(p.pc);
        const code = encodeSignal({ k: 'offer', id: p.id, from: r.name, mode: r.mode, sdp: p.pc.localDescription.sdp });
        const url = shareUrl(this, code);
        p.state = 'بانتظار الرد';
        out('fmx-call-invite', `<div class="fmx-invite"><input class="form-input-box" dir="ltr" readonly value="${esc(url)}" onclick="this.select()"><div class="gh-row">${btn('fa-copy', 'نسخ الرابط', call('copyText', url))}</div><div id="fmx-call-qr"></div></div>`);
        if (this.renderQR) this.renderQR(url, 'fmx-call-qr');
        this.fmxRoomRender();
        return { peer: p, code, url };
    };
    /** Paste an offer (→ produce an answer code) or an answer (→ complete the connection). */
    P.fmxCallPaste = async function (codeArg) {
        const raw = codeArg || val('fmx-call-code');
        if (!raw) return null;
        let s; try { s = decodeSignal(raw); } catch (e) { this.showToast('رمز غير صالح', 'error'); return null; }
        const r = room(this);
        r.name = val('fmx-call-name') || r.name;
        if (s.k === 'offer') {
            if (s.mode !== 'broadcast' && !r.local) await this.fmxCallMedia('cam').catch(() => null);
            const p = this.fmxNewPeer({ id: s.id, viewer: s.mode === 'broadcast' ? 'in' : null });
            p.name = s.from;
            await p.pc.setRemoteDescription({ type: 'offer', sdp: s.sdp });
            await p.pc.setLocalDescription(await p.pc.createAnswer());
            await waitIce(p.pc);
            const code = encodeSignal({ k: 'answer', id: s.id, from: r.name, sdp: p.pc.localDescription.sdp });
            out('fmx-call-invite', `<div class="fmx-invite"><b>أرسل رمز الرد هذا إلى ${esc(s.from)}:</b><textarea class="form-input-box" dir="ltr" rows="3" readonly onclick="this.select()">${esc(code)}</textarea>${btn('fa-copy', 'نسخ رمز الرد', call('copyText', code))}</div>`);
            this.fmxRoomRender();
            return { peer: p, code };
        }
        if (s.k === 'answer') {
            const p = r.peers[s.id];
            if (!p) { this.showToast('لا توجد دعوة مطابقة لهذا الرد', 'error'); return null; }
            p.name = s.from;
            await p.pc.setRemoteDescription({ type: 'answer', sdp: s.sdp });
            out('fmx-call-invite', '');
            this.fmxRoomRender();
            return { peer: p };
        }
        return null;
    };
    P.fmxOpenCallHash = function (hash) { return this.openFilesHub('call', 'room').then(() => this.fmxCallPaste(hash)); };
    P.fmxHangup = function () {
        const r = room(this);
        Object.values(r.peers).forEach(p => { try { p.pc.close(); } catch (e) {} });
        [r.local, r.screen].forEach(s => s && s.getTracks().forEach(t => t.stop()));
        if (r.rec) this.fmxCallRecord();
        if (r.stt) { r.stt.stop(); r.stt = null; }
        this._fmxRoom = { ...room(this), peers: {}, local: null, screen: null };
        this.fmxRoomRender();
    };
    /** Record the whole call: tiles composited on a canvas + all audio mixed (#694). */
    P.fmxCallRecord = async function () {
        const r = room(this);
        if (r.rec) { const rec = r.rec; r.rec = null; clearInterval(rec.timer); const blob = await new Promise(res => { rec.mr.onstop = () => res(makeBlob(rec.chunks, rec.mr.mimeType || 'video/webm')); rec.mr.stop(); }); try { rec.ac.close(); } catch (e) {} this.fmxOutput(blob, `call-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.webm`, { note: fmtTime((Date.now() - rec.t0) / 1000) }); r.lastRecording = blob; return blob; }
        const streams = [r.screen, r.local].concat(Object.values(r.peers).map(p => p.stream)).filter(Boolean);
        if (!streams.length) { this.showToast('لا توجد وسائط لتسجيلها', 'warning'); return null; }
        const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
        const ctx = c.getContext('2d'), AC = W().AudioContext || W().webkitAudioContext, ac = new AC(), dest = ac.createMediaStreamDestination();
        streams.forEach(s => { if (s.getAudioTracks().length) try { ac.createMediaStreamSource(s).connect(dest); } catch (e) {} });
        const draw = () => { const vids = Array.from(document.querySelectorAll('#fmx-call-grid video')).filter(v => v.readyState >= 2); ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 1280, 720); gridLayout(vids.length, 1280, 720).forEach((g, i) => { try { ctx.drawImage(vids[i], g.x, g.y, g.w, g.h); } catch (e) {} }); };
        const out2 = c.captureStream(15);
        dest.stream.getAudioTracks().forEach(t => out2.addTrack(t));
        const mr = new (W().MediaRecorder)(out2, { mimeType: pickVideoMime() || undefined }), chunks = [];
        mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        mr.start(1000);
        r.rec = { mr, chunks, ac, t0: Date.now(), timer: setInterval(draw, 66) };
        this.showToast('🔴 بدأ تسجيل المكالمة', 'success');
        return r.rec;
    };

    // ================================================================ AI MINUTES (#695-#699)
    P.fmxCallAI = function () {
        const r = room(this);
        this._fmxMount = () => this.fmxCaptionsRender();
        return card('محضر الاجتماع الذكي', `<div class="gh-row">${select('fmx-cai-lang', 'لغة كلامك', LANGS, 'ar-SA')}${select('fmx-cai-tr', 'ترجمة فورية إلى', [['', '—']].concat(LANGS), '')}<label class="gh-check"><input id="fmx-cai-suggest" type="checkbox" checked> ردود مقترحة</label></div>
            <div class="gh-row">${pbtn('fa-closed-captioning', r.stt ? 'إيقاف التفريغ المباشر' : 'بدء التفريغ المباشر', 'app.fmxLiveCaptions()')}${btn('fa-file-audio', 'تفريغ تسجيل المكالمة', 'app.fmxTranscribeRecording()')}${btn('fa-trash', 'مسح', 'app.fmxClearMinutes()')}</div>
            ${sourcePicker(this, 'fmx-cai-src', ['audio', 'video'], { label: 'أو حلّل تسجيل اجتماع', accept: 'audio/*,video/*' })}<div id="fmx-cai-progress"></div>
            <div id="fmx-cai-suggestions" class="gh-row"></div><div id="fmx-cai-captions" class="fmx-transcript"></div>
            <div class="gh-row">${pbtn('fa-list', 'تلخيص', 'app.fmxMinutes(\'summary\')')}${btn('fa-list-check', 'استخراج المهام', 'app.fmxMinutes(\'tasks\')')}${btn('fa-file-lines', 'محضر كامل', 'app.fmxMinutes(\'minutes\')')}${btn('fa-download', 'حفظ النص', 'app.fmxSaveTranscript()')}</div><div id="fmx-cai-result"></div>
            <div class="text-dim">التفريغ المباشر يسمع ميكروفونك ويرسل الأسطر لكل المشاركين؛ كل مشارك يفعّله عنده لتكتمل المحادثة. للتسجيلات يُميَّز المتحدثون تلقائياً.</div>`, 'fa-user-tie');
    };
    P.fmxCaptionsRender = function () {
        const r = room(this), el = document.getElementById('fmx-cai-captions');
        if (el) { el.innerHTML = r.transcript.map(l => `<div dir="auto"><small>${new Date(l.t).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}</small> <b>${esc(l.who)}:</b> ${esc(l.text)}${l.tr ? `<div class="text-dim" dir="auto">↳ ${esc(l.tr)}</div>` : ''}</div>`).join('') || '<div class="text-dim">لا نص بعد</div>'; el.scrollTop = el.scrollHeight; }
    };
    P.fmxAddCaption = async function (text, who) {
        const r = room(this), to = val('fmx-cai-tr');
        const line = { t: Date.now(), who: who || r.name, text };
        r.transcript.push(line);
        if (to) { const tr = await this.aiRun(`Translate into ${langEn(to)}; return only the translation:\n${text}`, { kind: 'general', maxTokens: 300, source: 'fmx-call', quiet: true }); if (tr) line.tr = tr.trim(); }
        this.fmxCallBroadcast({ t: 'caption', text, tr: line.tr });
        this.fmxCaptionsRender();
        this.fmxMaybeSuggest();
        return line;
    };
    P.fmxLiveCaptions = function () {
        const r = room(this);
        if (r.stt) { r.stt.stop(); r.stt = null; this.fmxRefresh(); return null; }
        r.stt = listen({ lang: val('fmx-cai-lang') || 'ar-SA', interim: false, onText: (fin) => { if (fin) this.fmxAddCaption(fin); }, onError: (e) => { this.showToast('🎙️ ' + (e.message || e.error), 'warning'); r.stt = null; } });
        if (r.stt) this.fmxRefresh();
        return r.stt;
    };
    P.fmxMaybeSuggest = function () {
        const r = room(this);
        if (val('fmx-cai-suggest') === false || !hasKey(this, true)) return;
        const last = r.transcript[r.transcript.length - 1];
        if (!last || last.who === r.name) return;
        clearTimeout(this._fmxSugT);
        this._fmxSugT = setTimeout(() => this.fmxSuggestReplies(), 1200);
    };
    P.fmxSuggestReplies = async function () {
        const r = room(this);
        const ctx = r.transcript.slice(-12).map(l => `${l.who}: ${l.text}`).join('\n');
        if (!ctx) return null;
        const j = await this.aiJSON(`Live meeting transcript (I am "${r.name}"):\n${ctx}\n\nSuggest 3 short, helpful things I could say next (same language as the conversation). Return {"replies":["…","…","…"]}`, { kind: 'general', maxTokens: 300, source: 'fmx-call', quiet: true });
        const list = (j && j.replies) || [];
        out('fmx-cai-suggestions', list.map(s => `<button class="gh-chip" dir="auto" title="أرسلها في الدردشة" onclick="${call('fmxCallSend', s)}">💡 ${esc(s)}</button>`).join(''));
        return list;
    };
    P.fmxClearMinutes = function () { room(this).transcript = []; this.fmxCaptionsRender(); out('fmx-cai-result', ''); };
    P.fmxTranscribeRecording = async function (src) {
        const r = room(this);
        let bytesSrc = null;
        const [f] = await readSources(this, src || 'fmx-cai-src');
        if (f) bytesSrc = f.bytes; else if (r.lastRecording) bytesSrc = r.lastRecording;
        if (!bytesSrc) { this.showToast('سجّل المكالمة أولاً أو اختر ملفاً', 'warning'); return null; }
        try {
            const res = await transcribeAudio(this, bytesSrc, { diarize: true, onProgress: (d, t) => out('fmx-cai-progress', `<div class="fmx-progress"><div style="width:${Math.round(d / t * 100)}%"></div><span>📝 ${fmtTime(d)} / ${fmtTime(t)}</span></div>`) });
            if (!res) return null;
            out('fmx-cai-progress', '');
            const t0 = Date.now() - res.duration * 1000;
            r.transcript = res.segments.map(s => ({ t: t0 + s.start * 1000, who: s.speaker || '—', text: s.text }));
            this.fmxCaptionsRender();
            return res;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };
    const transcriptText = (app) => room(app).transcript.map(l => `${l.who}: ${l.text}`).join('\n');
    P.fmxMinutes = async function (kind = 'summary') {
        const t = transcriptText(this);
        if (!t) { this.showToast('لا يوجد نص للمكالمة بعد', 'warning'); return null; }
        if (kind === 'tasks') {
            const j = await this.aiJSON(`Extract action items from this meeting transcript. Return {"tasks":[{"title":"…","owner":"name or empty","due":"date/text or empty"}]} — write titles in the transcript's language.\n\n${t.slice(-24000)}`, { kind: 'general', maxTokens: 1200, source: 'fmx-call' });
            const tasks = (j && j.tasks) || [];
            this._fmxCallTasks = tasks;
            out('fmx-cai-result', tasks.length ? `${tasks.map((x, i) => `<div class="gh-item static" data-task="${i}"><i class="fa-regular fa-square-check text-blue"></i><div class="gh-item-main"><b dir="auto">${esc(x.title)}</b><small>${esc([x.owner, x.due].filter(Boolean).join(' • '))}</small></div></div>`).join('')}<div class="gh-row">${pbtn('fa-plus', 'أضف إلى مهامي', 'app.fmxTasksToBoard()')}</div>` : empty('لا مهام واضحة'));
            return tasks;
        }
        const prompt = kind === 'minutes'
            ? `اكتب محضر اجتماع منظماً بالماركداون من هذا النص: العنوان، الحضور، النقاط المناقشة، القرارات، المهام (مع المسؤول)، الأسئلة المفتوحة.\n\n${t.slice(-24000)}`
            : `لخّص هذه المكالمة في 5-8 نقاط مركزة بلغة المحادثة، ثم سطر «الخلاصة».\n\n${t.slice(-24000)}`;
        const md = await this.aiRun(prompt, { kind: 'general', maxTokens: 1800, source: 'fmx-call' });
        if (md == null) return null;
        out('fmx-cai-result', `<div class="gh-md">${this.renderMarkdownSafe ? this.renderMarkdownSafe(md) : esc(md)}</div><div class="gh-row">${btn('fa-file-circle-plus', 'حفظ في المشروع', call('fmxSaveMinutes', kind))}</div>`);
        this._fmxMinutesMd = md;
        return md;
    };
    P.fmxSaveMinutes = function (kind = 'minutes') { const md = this._fmxMinutesMd; if (!md) return null; const p = this.uniqueProjectPath(`meetings/${new Date().toISOString().slice(0, 10)}-${kind}.md`); this.writeProjectFile(p, md); this.showToast('💾 ' + p, 'success'); return p; };
    P.fmxSaveTranscript = function () { const t = transcriptText(this); if (!t) return null; const p = this.uniqueProjectPath(`meetings/${new Date().toISOString().slice(0, 10)}-transcript.md`); this.writeProjectFile(p, t); this.showToast('💾 ' + p, 'success'); return p; };
    P.fmxTasksToBoard = function () {
        const list = this._fmxCallTasks || [];
        if (!list.length) return 0;
        if (this.addTask) list.forEach(x => this.addTask({ title: x.title + (x.owner ? ` (@${x.owner})` : ''), notes: x.due ? 'الموعد: ' + x.due : '' }, { source: 'meeting' }));
        else { const p = 'TODO.md', e = this.virtualProjectFiles.get(p); this.writeProjectFile(p, ((e && e.content) || '# TODO\n') + '\n' + list.map(x => `- [ ] ${x.title}${x.owner ? ` (@${x.owner})` : ''}`).join('\n') + '\n'); }
        this.showToast(`✅ أُضيفت ${list.length} مهمة`, 'success');
        return list.length;
    };

    // ================================================================ PRESENTATION MODE (#700)
    P.fmxPresent = function () {
        const md = this.projectPaths().filter(p => /\.(md|markdown|txt)$/i.test(p) && isTextEntry(this.virtualProjectFiles.get(p)));
        return card('وضع العرض التقديمي', `<div class="gh-row">${btn('fa-comments', 'المحادثة الحالية', 'app.openPresentation()', 'gh-chip')}${select('fmx-pr-file', 'ملف Markdown', md.map(p => [p, p]), md[0] || '')}${pbtn('fa-person-chalkboard', 'اعرض الملف', 'app.fmxPresentFile()')}</div>
            <div class="gh-row">${field('fmx-pr-topic', 'أو أنشئ عرضاً بالذكاء عن', 'شرح بنية هذا المشروع', 'dir="auto"')}${select('fmx-pr-n', 'الشرائح', ['5', '8', '12'], '8')}${btn('fa-wand-magic-sparkles', 'إنشاء وعرض', 'app.fmxPresentAI()')}</div>
            <div class="text-dim">افصل الشرائح بـ <code>---</code> أو بعناوين #. أسطر <code>ملاحظة:</code> تصبح ملاحظات المقدّم. أثناء العرض: ← → للتنقل، <b>N</b> الملاحظات، <b>L</b> مؤشر الليزر، <b>T</b> المؤقت، <b>B</b> شاشة سوداء، Esc للخروج. لمشاركته في مكالمة استخدم «مشاركة الشاشة».</div>`, 'fa-person-chalkboard');
    };
    P.fmxStartPresentation = function (slides, title) {
        if (!slides || !slides.length) { this.showToast('لا شرائح للعرض', 'warning'); return null; }
        const had = Object.prototype.hasOwnProperty.call(this, 'buildSlides'), orig = this.buildSlides;
        this.buildSlides = () => slides;
        let p;
        try { p = this.openPresentation(0); } finally { if (had) this.buildSlides = orig; else delete this.buildSlides; }
        if (!p) return null;
        p.title = title; p.fmx = { t0: Date.now(), notes: false, laser: false, black: false, timer: true };
        if (!this._fmxPresKey) {
            this._fmxPresKey = (e) => {
                const q = this._present;
                if (!q || !q.fmx || e.ctrlKey || e.metaKey || e.altKey) return;
                const k = (e.key || '').toLowerCase(), map = { n: 'notes', l: 'laser', b: 'black', t: 'timer' };
                if (map[k]) { e.preventDefault(); q.fmx[map[k]] = !q.fmx[map[k]]; this.renderPresentation(); }
            };
            W().addEventListener('keydown', this._fmxPresKey, true);
            this._fmxPresTick = setInterval(() => { const q = this._present, el = document.getElementById('fmx-pres-timer'); if (q && q.fmx && el) el.textContent = fmtTime((Date.now() - q.fmx.t0) / 1000).replace(/\.\d$/, ''); }, 1000);
        }
        this.renderPresentation();
        return p;
    };
    const _render = P.renderPresentation;
    P.renderPresentation = function () {
        const r = _render.apply(this, arguments);
        const p = this._present, el = document.getElementById('ox-present');
        if (!p || !p.fmx || !el) return r;
        const s = p.slides[p.i] || {};
        el.classList.toggle('fmx-laser', !!p.fmx.laser);
        el.insertAdjacentHTML('beforeend', `${p.fmx.timer ? `<div class="fmx-pres-timer" id="fmx-pres-timer">${fmtTime((Date.now() - p.fmx.t0) / 1000).replace(/\.\d$/, '')}</div>` : ''}${p.fmx.notes ? `<div class="fmx-pres-notes" dir="auto">${s.notes ? esc(s.notes) : '<i>لا ملاحظات لهذه الشريحة</i>'}${p.slides[p.i + 1] ? `<div class="text-dim">التالية: ${esc((p.slides[p.i + 1].md || '').split('\n')[0].slice(0, 80))}</div>` : ''}</div>` : ''}${p.fmx.black ? '<div class="fmx-pres-black"></div>' : ''}<div class="fmx-laser-dot" id="fmx-laser-dot"></div>`);
        if (!el._fmxLaser) { el._fmxLaser = true; el.addEventListener('pointermove', (e) => { const d = document.getElementById('fmx-laser-dot'); if (d) { d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; } }); }
        return r;
    };
    P.fmxPresentFile = function (pathArg) {
        const path = pathArg || val('fmx-pr-file'), e = this.virtualProjectFiles.get(path);
        if (!e || !isTextEntry(e)) { this.showToast('اختر ملف Markdown', 'warning'); return null; }
        return this.fmxStartPresentation(slidesFromMarkdown(e.content), path);
    };
    P.fmxPresentAI = async function () {
        const topic = val('fmx-pr-topic') || 'هذا المشروع', n = +val('fmx-pr-n') || 8;
        await aiReady(this);
        const ctx = this.aiProjectContext ? this.aiProjectContext({ maxChars: 10000 }) : '';
        const md = await this.aiRun(`أنشئ عرضاً تقديمياً من ${n} شرائح عن: ${topic}\n${ctx ? '\nسياق المشروع:\n' + ctx : ''}\n\nالصيغة: Markdown، افصل الشرائح بسطر --- ، كل شريحة تبدأ بعنوان ## ثم 3-5 نقاط قصيرة (ويمكن مقطع كود قصير)، وأضف سطر «ملاحظة: …» بملاحظات المقدّم. أعد Markdown فقط.`, { kind: 'general', maxTokens: 3500, source: 'fmx-present' });
        if (!md) return null;
        const p = this.uniqueProjectPath('slides/' + topic.slice(0, 30).replace(/[^\p{L}\p{N}]+/gu, '-') + '.md');
        this.writeProjectFile(p, md.replace(/^```(?:markdown|md)?\n|\n```$/g, ''));
        return this.fmxPresentFile(p);
    };
}
