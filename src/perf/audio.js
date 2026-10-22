/* Audio: background recording (#961), background playback (#962), lock-screen controls (#963), offline voice commands (#967). */
import { esc, call, card, empty, btn, pbtn, select, win, fmtBytes, fmtDT, table, uid, download } from './util.js';

// ------------------------------------------------------------------ PURE
const N = (s) => String(s || '').toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[.,!?؟،]/g, ' ').replace(/\s+/g, ' ').trim();
const CMDS = [
    ['new', /^(محادثه جديده|ابدا محادثه|new chat|nouvelle conversation)$/],
    ['stop', /^(توقف|اوقف|قف|كفي|stop|arrête|arrete)$/],
    ['speak', /^(اقرا|اقرا الرد|اعد|كرر|read|repeat|lis)$/],
    ['next', /^(التالي|المحادثه التاليه|next)$/],
    ['prev', /^(السابق|المحادثه السابقه|previous|back)$/],
    ['tasks', /^(افتح المهام|المهام|tasks|open tasks)$/],
    ['perf', /^(افتح الاداء|الاداء|performance)$/],
    ['theme', /^(غير الثيم|الوضع الليلي|الوضع النهاري|dark mode|light mode|toggle theme)$/],
    ['send', /^(ارسل|send|envoie)$/],
    ['clear', /^(امسح|احذف النص|clear)$/],
    ['search', /^(?:ابحث عن|ابحث|بحث عن|search for|search|cherche)\s+(.+)$/],
    ['ask', /^(?:اسال|سؤال|ask)\s+(.+)$/],
    ['type', /^(?:اكتب|type|écris|ecris)\s+(.+)$/]
];
/** "ابحث عن react hooks" → { action: 'search', arg: 'react hooks' } | null (free text). */
export function parseVoiceCommand(text) {
    const n = N(text);
    if (!n) return null;
    for (const [action, re] of CMDS) {
        const m = n.match(re);
        if (m) {
            if (!m[1] || re.source.indexOf('(.+)') < 0) return { action, arg: '' };
            // keep the user's original casing/letters for the argument
            const raw = String(text).trim(), words = m[1].split(' ').length;
            return { action, arg: raw.split(/\s+/).slice(-words).join(' ') };
        }
    }
    return null;
}
export const VOICE_HELP = [['محادثة جديدة', 'new chat'], ['توقف', 'stop'], ['اقرأ الرد', 'read'], ['التالي / السابق', 'next / previous'], ['ابحث عن …', 'search …'], ['اسأل …', 'ask …'], ['اكتب …', 'type …'], ['أرسل', 'send'], ['امسح', 'clear'], ['افتح المهام', 'open tasks'], ['الوضع الليلي', 'toggle theme']];
/** Group recording chunks [{rec, seq, blob, t, mime}] → [{ id, chunks, size, start, end, mime }] newest first. */
export function groupRecordings(chunks) {
    const m = new Map();
    for (const c of chunks || []) {
        const r = m.get(c.rec) || { id: c.rec, chunks: [], size: 0, start: c.t, end: c.t, mime: c.mime || 'audio/webm', name: c.name || '' };
        r.chunks.push(c); r.size += (c.blob && c.blob.size) || c.size || 0; r.start = Math.min(r.start, c.t); r.end = Math.max(r.end, c.t); if (c.name) r.name = c.name;
        m.set(c.rec, r);
    }
    return Array.from(m.values()).map(r => ({ ...r, chunks: r.chunks.sort((a, b) => a.seq - b.seq) })).sort((a, b) => b.start - a.start);
}
export const fmtDur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function installAudio(P) {
    const W = () => win();
    // ------------------------------------------------------------------ BACKGROUND RECORDING (#961)
    P.pfRecChunks = async function () { try { const db = await this.pfDexie(); return await db.recs.toArray(); } catch (e) { return (this._pfRecMem || []).slice(); } };
    P.pfRecSave = async function (item) { try { const db = await this.pfDexie(); await db.recs.add(item); } catch (e) { (this._pfRecMem = this._pfRecMem || []).push(item); } };
    P.pfBgRec = async function () {
        const recs = groupRecordings(await this.pfRecChunks()), live = this._pfRec5;
        return card('تسجيل صوتي يستمر في الخلفية', `<p class="gh-muted">يُحفظ التسجيل كل 5 ثوانٍ في قاعدة البيانات المحلية فلا يضيع إن أُغلق التبويب أو تعطل المتصفح. يستمر عند التبديل لتطبيق آخر أو إطفاء الشاشة على Android (يظهر مؤشر الميكروفون)؛ iOS يوقف الميكروفون عند مغادرة التطبيق.</p>
                <div class="gh-row">${live ? pbtn('fa-stop', 'إيقاف التسجيل', call('pfBgRecStop')) : pbtn('fa-microphone', 'ابدأ التسجيل', call('pfBgRecStart'))}
                <label class="pfx-toggle"><input type="checkbox" id="pfx-rec-wake" ${this.settings.recWakeLock !== false ? 'checked' : ''} onchange="app.pfSet('recWakeLock', this.checked)"> <span>إبقاء الشاشة مضاءة</span></label></div>
                <div id="pfx-rec-live">${live ? `<p class="pfx-warn">● يسجّل منذ ${fmtDur(Date.now() - live.start)} — ${live.seq} مقطع</p>` : ''}</div>`, 'fa-microphone')
            + card(`التسجيلات (${recs.length})`, recs.length ? table(['', 'المدة', 'الحجم', ''], recs.map(r => [`${esc(r.name || fmtDT(r.start))}`, fmtDur(r.end - r.start + 5000), fmtBytes(r.size), `${btn('fa-play', '', call('pfRecPlay', r.id), 'sidebar-btn-util gh-btn', 'aria-label="تشغيل"')}${btn('fa-download', '', call('pfRecDownload', r.id), 'sidebar-btn-util gh-btn', 'aria-label="تنزيل"')}${btn('fa-trash', '', call('pfRecDelete', r.id), 'sidebar-btn-util gh-btn', 'aria-label="حذف"')}`])) : empty('لا تسجيلات بعد'), 'fa-list');
    };
    P.pfBgRecStart = async function () {
        if (this._pfRec5) return this._pfRec5;
        const MR = W().MediaRecorder, md = W().navigator.mediaDevices;
        if (!MR || !md || !md.getUserMedia) { this.showToast('التسجيل غير مدعوم في هذا المتصفح', 'warning'); return null; }
        try {
            const stream = await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
            const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find(t => !MR.isTypeSupported || MR.isTypeSupported(t)) || '';
            const rec = new MR(stream, mime ? { mimeType: mime } : undefined);
            const st = { id: uid('rec'), rec, stream, seq: 0, start: Date.now(), mime: rec.mimeType || mime || 'audio/webm' };
            rec.ondataavailable = (e) => { if (e.data && e.data.size) this.pfRecSave({ rec: st.id, seq: st.seq++, blob: e.data, t: Date.now(), mime: st.mime, size: e.data.size }); const el = document.getElementById('pfx-rec-live'); if (el) el.innerHTML = `<p class="pfx-warn">● يسجّل منذ ${fmtDur(Date.now() - st.start)} — ${st.seq} مقطع</p>`; };
            rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); };
            rec.start(5000);
            this._pfRec5 = st;
            if (this.settings.recWakeLock !== false) this.pfWakeLock(true);
            if ('mediaSession' in navigator) try { navigator.mediaSession.metadata = new W().MediaMetadata({ title: 'OX-Alpha — تسجيل', artist: 'تسجيل صوتي' }); } catch (e) {}
            this.showToast('🎙️ بدأ التسجيل', 'success');
            if (this._pfx && this._pfx.sec === 'bgrec') this.pfRefresh();
            return st;
        } catch (e) { return this.pfErr(e); }
    };
    P.pfBgRecStop = async function () {
        const st = this._pfRec5; if (!st) return false;
        await new Promise(res => { st.rec.addEventListener('stop', () => setTimeout(res, 50), { once: true }); try { st.rec.stop(); } catch (e) { res(); } });
        this._pfRec5 = null;
        this.pfWakeLock(false);
        this.showToast('⏹ حُفظ التسجيل', 'success');
        if (this._pfx && this._pfx.sec === 'bgrec') this.pfRefresh();
        return st.id;
    };
    P.pfWakeLock = async function (on) {
        if (!this._pfWakeHook) { // the lock is released whenever the page is hidden → take it again on return
            this._pfWakeHook = true;
            document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !this._pfWake && (this.settings.keepAwake || this._pfRec5 || this._pfDrive)) this.pfWakeLock(true); });
        }
        try {
            if (on && !this._pfWake && navigator.wakeLock) { this._pfWake = await navigator.wakeLock.request('screen'); this._pfWake.addEventListener && this._pfWake.addEventListener('release', () => { this._pfWake = null; }); }
            else if (!on && this._pfWake) { await this._pfWake.release(); this._pfWake = null; }
        } catch (e) { /* denied / unsupported */ }
        return !!this._pfWake;
    };
    P.pfRecBlob = async function (id) {
        const r = groupRecordings(await this.pfRecChunks()).find(x => x.id === id);
        return r ? new Blob(r.chunks.map(c => c.blob), { type: r.mime.split(';')[0] }) : null;
    };
    P.pfRecPlay = async function (id) {
        const b = await this.pfRecBlob(id); if (!b) return null;
        return this.pfPlayQueue([{ name: 'تسجيل ' + fmtDT(Date.now()), url: URL.createObjectURL(b) }], 0);
    };
    P.pfRecDownload = async function (id) { const b = await this.pfRecBlob(id); if (!b) return null; download(this, `ox-recording-${id}.${/mp4/.test(b.type) ? 'm4a' : /ogg/.test(b.type) ? 'ogg' : 'webm'}`, b); return true; };
    P.pfRecDelete = async function (id) {
        try { const db = await this.pfDexie(); await db.recs.where('rec').equals(id).delete(); } catch (e) { this._pfRecMem = (this._pfRecMem || []).filter(c => c.rec !== id); }
        if (this._pfx && this._pfx.sec === 'bgrec') this.pfRefresh();
        return true;
    };

    // ------------------------------------------------------------------ BACKGROUND PLAYBACK + LOCK SCREEN (#962 #963)
    P.pfProjectAudio = function () {
        const out = [];
        this.virtualProjectFiles.forEach((f, p) => { if (f && typeof f.dataUrl === 'string' && /^data:audio\//.test(f.dataUrl)) out.push({ name: p.split('/').pop(), path: p, url: f.dataUrl }); });
        return out;
    };
    /** One persistent <audio> outside the panel → keeps playing when the panel closes or the screen locks. */
    P.pfAudioEl = function () {
        let a = document.getElementById('ox-bg-audio');
        if (!a) {
            a = document.createElement('audio'); a.id = 'ox-bg-audio'; a.preload = 'auto'; a.hidden = true;
            a.addEventListener('ended', () => this.pfPlayStep(1, true));
            a.addEventListener('timeupdate', () => this.pfMediaPosition());
            document.body.appendChild(a);
        }
        return a;
    };
    P.pfPlayQueue = async function (list, index = 0) {
        if (!list || !list.length) return null;
        this._pfQueue = { list, i: Math.max(0, Math.min(index, list.length - 1)), loop: (this._pfQueue && this._pfQueue.loop) || false };
        return this.pfPlayCurrent();
    };
    P.pfPlayCurrent = async function () {
        const q = this._pfQueue; if (!q) return null;
        const t = q.list[q.i], a = this.pfAudioEl();
        a.src = t.url;
        try { await a.play(); } catch (e) { /* autoplay blocked until a gesture */ }
        this.pfMediaSession(t);
        this.pfPlayerUI();
        return t;
    };
    P.pfPlayStep = function (d, auto = false) {
        const q = this._pfQueue; if (!q) return null;
        let i = q.i + d;
        if (i >= q.list.length) { if (!q.loop && auto) { this.pfPlayerUI(); return null; } i = 0; }
        if (i < 0) i = q.list.length - 1;
        q.i = i;
        return this.pfPlayCurrent();
    };
    P.pfPlayToggle = function () { const a = this.pfAudioEl(); if (!a.src && this.pfProjectAudio().length) return this.pfPlayQueue(this.pfProjectAudio(), 0); if (a.paused) a.play().catch(() => {}); else a.pause(); this.pfPlayerUI(); return !a.paused; };
    P.pfPlayStop = function () { const a = document.getElementById('ox-bg-audio'); if (a) { a.pause(); a.removeAttribute('src'); try { a.load(); } catch (e) {} } this._pfQueue = null; if ('mediaSession' in navigator) try { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; } catch (e) {} this.pfPlayerUI(); return true; };
    P.pfMediaSession = function (t) {
        const ms = navigator.mediaSession, MM = W().MediaMetadata;
        if (!ms) return false;
        try { if (MM) ms.metadata = new MM({ title: t.name, artist: 'OX-Alpha', album: 'المشروع', artwork: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }] }); } catch (e) {}
        const a = this.pfAudioEl();
        const H = { play: () => a.play(), pause: () => a.pause(), previoustrack: () => this.pfPlayStep(-1), nexttrack: () => this.pfPlayStep(1), stop: () => this.pfPlayStop(),
            seekbackward: (d) => { a.currentTime = Math.max(0, a.currentTime - ((d && d.seekOffset) || 10)); }, seekforward: (d) => { a.currentTime = Math.min(a.duration || 0, a.currentTime + ((d && d.seekOffset) || 10)); }, seekto: (d) => { if (d && d.seekTime != null) a.currentTime = d.seekTime; } };
        Object.entries(H).forEach(([k, fn]) => { try { ms.setActionHandler(k, fn); } catch (e) { /* unsupported action */ } });
        a.onplay = () => { try { ms.playbackState = 'playing'; } catch (e) {} this.pfPlayerUI(); };
        a.onpause = () => { try { ms.playbackState = 'paused'; } catch (e) {} this.pfPlayerUI(); };
        return true;
    };
    P.pfMediaPosition = function () {
        const a = document.getElementById('ox-bg-audio'), ms = navigator.mediaSession;
        if (!a || !ms || !ms.setPositionState || !isFinite(a.duration)) return;
        try { ms.setPositionState({ duration: a.duration, playbackRate: a.playbackRate, position: Math.min(a.currentTime, a.duration) }); } catch (e) {}
    };
    P.pfPlayer = function () {
        const list = this.pfProjectAudio();
        return card('قائمة التشغيل', `<div id="pfx-player">${this.pfPlayerHTML()}</div>
                <p class="gh-muted">يستمر التشغيل عند إغلاق اللوحة أو قفل الشاشة، ويظهر في شاشة القفل/مركز التحكم وسماعات البلوتوث مع أزرار: تشغيل • إيقاف مؤقت • التالي • السابق • تقديم/ترجيع 10 ث.</p>`, 'fa-headphones')
            + card(`ملفات الصوت في المشروع (${list.length})`, list.length ? list.map((t, i) => `<button class="pfx-hit" onclick="${call('pfPlayProject', i)}"><i class="fa-solid fa-music"></i><div><b>${esc(t.name)}</b><small>${esc(t.path)}</small></div></button>`).join('') : empty('أضف ملفات صوتية (mp3/ogg/wav/m4a) إلى المشروع، أو شغّل تسجيلاً من «تسجيل في الخلفية»'), 'fa-music');
    };
    P.pfPlayProject = function (i) { return this.pfPlayQueue(this.pfProjectAudio(), i); };
    P.pfPlayerHTML = function () {
        const q = this._pfQueue, a = document.getElementById('ox-bg-audio'), playing = a && !a.paused;
        const t = q && q.list[q.i];
        return `<div class="pfx-np"><b>${t ? esc(t.name) : 'لا شيء قيد التشغيل'}</b>${q ? `<small>${q.i + 1} / ${q.list.length}</small>` : ''}</div>
            <div class="gh-row">${btn('fa-backward-step', '', call('pfPlayStep', -1), 'sidebar-btn-util gh-btn', 'aria-label="السابق"')}${pbtn(playing ? 'fa-pause' : 'fa-play', playing ? 'إيقاف مؤقت' : 'تشغيل', call('pfPlayToggle'))}${btn('fa-forward-step', '', call('pfPlayStep', 1), 'sidebar-btn-util gh-btn', 'aria-label="التالي"')}${btn('fa-stop', '', call('pfPlayStop'), 'sidebar-btn-util gh-btn', 'aria-label="إيقاف"')}${btn('fa-repeat', q && q.loop ? 'تكرار ✓' : 'تكرار', call('pfPlayLoop'))}</div>`;
    };
    P.pfPlayLoop = function () { if (this._pfQueue) this._pfQueue.loop = !this._pfQueue.loop; this.pfPlayerUI(); return this._pfQueue && this._pfQueue.loop; };
    P.pfPlayerUI = function () { const el = document.getElementById('pfx-player'); if (el) el.innerHTML = this.pfPlayerHTML(); };

    // ------------------------------------------------------------------ OFFLINE VOICE COMMANDS (#967) + VOICE SEARCH (#970)
    P.pfSR = function () { return W().SpeechRecognition || W().webkitSpeechRecognition || null; };
    P.pfVoiceLang = function () { return this.settings.voiceLang || 'ar-SA'; };
    P.pfVoiceOffline = async function () {
        const SR = this.pfSR();
        if (!SR || typeof SR.available !== 'function') return 'unsupported';
        try { return await SR.available({ langs: [this.pfVoiceLang()], processLocally: true }); } catch (e) { return 'unsupported'; }
    };
    P.pfVoice = async function () {
        const SR = this.pfSR(), off = await this.pfVoiceOffline(), on = !!this._pfVC;
        const offTxt = { available: '✅ متاح دون إنترنت', downloadable: '⬇️ قابل للتنزيل', downloading: '⏳ قيد التنزيل', unavailable: '— غير متاح لهذه اللغة', unsupported: '— المتصفح لا يدعم التعرف المحلي (يحتاج اتصالاً)' }[off] || off;
        return card('أوامر صوتية', SR ? `<p>التعرف على الجهاز (Offline): <b>${offTxt}</b> ${off === 'downloadable' ? btn('fa-download', 'نزّل حزمة اللغة', call('pfVoiceInstall')) : ''}</p>
                ${select('pfx-vlang', 'اللغة', [['ar-SA', 'العربية'], ['en-US', 'English'], ['fr-FR', 'Français']], this.pfVoiceLang(), `onchange="app.pfSet('voiceLang', this.value)"`)}
                <div class="gh-row">${on ? pbtn('fa-stop', 'إيقاف الاستماع', call('pfVoiceStop')) : pbtn('fa-microphone-lines', 'استمع للأوامر', call('pfVoiceStart'))}${btn('fa-magnifying-glass', 'بحث صوتي', call('pfVoiceSearch'))}</div>
                <div id="pfx-vc-out" class="pfx-vc">${on ? '<p class="pfx-warn">🎙️ أستمع… قل «توقف» أو «محادثة جديدة»</p>' : ''}</div>` : empty('التعرف على الكلام غير مدعوم في هذا المتصفح (جرّب Chrome أو Edge أو Safari)'), 'fa-microphone-lines')
            + card('الأوامر المتاحة', table(['بالعربية', 'English'], VOICE_HELP.map(([a, e]) => [esc(a), esc(e)])) + '<p class="gh-muted">أي كلام آخر يُكتب في مربع الرسالة (لا يُرسل إلا بقول «أرسل»).</p>', 'fa-list');
    };
    P.pfVoiceInstall = async function () {
        const SR = this.pfSR(); if (!SR || !SR.install) return false;
        try { const ok = await SR.install({ langs: [this.pfVoiceLang()], processLocally: true }); this.showToast(ok ? '✅ نُزّلت حزمة اللغة' : 'تعذر التنزيل', ok ? 'success' : 'warning'); if (this._pfx && this._pfx.sec === 'voice') this.pfRefresh(); return ok; } catch (e) { return this.pfErr(e); }
    };
    P.pfRunVoiceCommand = function (cmd, text) {
        const input = document.getElementById('user-input');
        const setInput = (v) => { if (input) { input.value = v; input.dispatchEvent(new Event('input')); } };
        if (!cmd) { setInput(((input && input.value) ? input.value + ' ' : '') + text); return 'typed'; }
        const map = {
            new: () => this.createNewSession(true), stop: () => { this.pfAction('stop'); try { W().speechSynthesis.cancel(); } catch (e) {} },
            speak: () => this.pfAction('speak'), next: () => this.pfSwitchChat(1), prev: () => this.pfSwitchChat(-1), tasks: () => this.pfAction('tasks'),
            perf: () => this.openPerfHub(), theme: () => this.toggleTheme && this.toggleTheme(), send: () => { if (input && input.value.trim()) this.sendUserMessage(); },
            clear: () => setInput(''), search: () => { this._pfSearchUI = { ...(this._pfSearchUI || { sort: 'smart', group: 'type' }), q: cmd.arg }; this.pfRecordQuery(cmd.arg); this.openPerfHub('search', 'instant'); },
            ask: () => setInput(cmd.arg), type: () => setInput(((input && input.value) ? input.value + ' ' : '') + cmd.arg)
        };
        if (!map[cmd.action]) return null;
        map[cmd.action]();
        if (this.haptic) this.haptic(10);
        return cmd.action;
    };
    P.pfVoiceStart = async function () {
        const SR = this.pfSR(); if (!SR) return null;
        if (this._pfVC) return this._pfVC;
        const rec = new SR();
        rec.lang = this.pfVoiceLang(); rec.continuous = true; rec.interimResults = false;
        if ((await this.pfVoiceOffline()) === 'available') try { rec.processLocally = true; } catch (e) {}
        const st = this._pfVC = { rec, on: true };
        rec.onresult = (e) => {
            for (let i = e.resultIndex; i < e.results.length; i++) {
                if (!e.results[i].isFinal) continue;
                const text = e.results[i][0].transcript.trim(), cmd = parseVoiceCommand(text), r = this.pfRunVoiceCommand(cmd, text);
                const el = document.getElementById('pfx-vc-out'); if (el) el.innerHTML = `<p>«${esc(text)}» → <b>${esc(r || '—')}</b></p>` + el.innerHTML.slice(0, 1500);
            }
        };
        rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { st.on = false; this.showToast('رُفض إذن الميكروفون', 'warning'); } };
        rec.onend = () => { if (st.on && this._pfVC === st) try { rec.start(); } catch (e) {} }; // keep listening
        try { rec.start(); } catch (e) { this._pfVC = null; return this.pfErr(e); }
        if (this._pfx && this._pfx.sec === 'voice') this.pfRefresh();
        return st;
    };
    P.pfVoiceStop = function () { const st = this._pfVC; if (!st) return false; st.on = false; try { st.rec.stop(); } catch (e) {} this._pfVC = null; if (this._pfx && this._pfx.sec === 'voice') this.pfRefresh(); return true; };
}
