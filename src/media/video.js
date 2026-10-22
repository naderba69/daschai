/* Video: convert formats (#585 #666), compress (#669), local quality enhancement (#670), background music (#683), cut & merge (#664),
   extract audio (#586 #667), GIF (#668), auto subtitles (#665), tutorial video from code (#658). Browser-native (canvas + MediaRecorder +
   WebAudio) — processing runs in real time; no ffmpeg/wasm (blocked by CSP). */
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { esc, call, btn, pbtn, card, empty, field, area, select, clamp, fmtTime, stemOf, extOf, makeBlob, blobBytes, newCanvas, ctx2d, encodeWAV, val, filesOf, win, isTextEntry, baseName } from './shared.js';
import { sourcePicker, readSources } from './core.js';
import { decodeAudio, toMono, toSpeechWav, chatParts, audioPart, textPart, hasKey, aiSpeech, AI_VOICES } from './aiio.js';

export function pickVideoMime(prefer = 'webm') {
    const MR = win().MediaRecorder;
    const list = prefer === 'mp4' ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'] : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    return (MR && MR.isTypeSupported && list.find(m => MR.isTypeSupported(m))) || '';
}
export const QUALITY = { high: 6e6, medium: 2.5e6, low: 1e6, tiny: 4e5 };
export const ENHANCE_FILTER = 'contrast(1.08) saturate(1.18) brightness(1.03)';
// ------------------------------------------------------------------ subtitles
const ts = (s, sep) => { s = Math.max(0, s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = Math.floor(s % 60), ms = Math.round((s - Math.floor(s)) * 1000); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}${sep}${String(ms).padStart(3, '0')}`; };
export const toVTT = (cues) => 'WEBVTT\n\n' + cues.map((c, i) => `${i + 1}\n${ts(c.start, '.')} --> ${ts(c.end, '.')}\n${c.text}\n`).join('\n');
export const toSRT = (cues) => cues.map((c, i) => `${i + 1}\n${ts(c.start, ',')} --> ${ts(c.end, ',')}\n${c.text}\n`).join('\n');
export function parseSubs(text) {
    const toSec = (t) => { const m = /(?:(\d+):)?(\d+):(\d+)[.,](\d+)/.exec(t); return m ? (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0').slice(0, 3) / 1000 : 0; };
    return String(text).replace(/\r/g, '').split(/\n\n+/).map(b => { const lines = b.split('\n'); const i = lines.findIndex(l => l.includes('-->')); if (i < 0) return null; const [a, z] = lines[i].split('-->'); return { start: toSec(a), end: toSec(z), text: lines.slice(i + 1).join('\n').trim() }; }).filter(c => c && c.text);
}
/** Model output → cues (accepts {segments:[{start,end,text}]} JSON or SRT/VTT). */
export function cuesFromModel(text, offset = 0) {
    const m = /\{[\s\S]*\}/.exec(String(text || ''));
    if (m) { try { const j = JSON.parse(m[0]); const segs = j.segments || j.cues || []; if (segs.length) return segs.map(s => ({ start: +s.start + offset, end: +s.end + offset, text: String(s.text || '').trim() })).filter(c => c.text && isFinite(c.start) && isFinite(c.end)); } catch (e) { /* fall through */ } }
    return parseSubs(text).map(c => ({ ...c, start: c.start + offset, end: c.end + offset }));
}
// ------------------------------------------------------------------ code → video helpers
const KW = /\b(const|let|var|function|return|if|else|for|while|class|import|from|export|default|async|await|new|def|try|catch|throw|public|private|static|void|int|string|bool|true|false|null|undefined|this|self|elif|in|of|lambda|struct|fn|pub|use|package|func|type|interface)\b/;
export function tokenizeLine(line) {
    const re = /(\/\/.*$|#(?!include).*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|\s+|.)/g;
    const out = []; let m;
    while ((m = re.exec(line))) {
        const t = m[0];
        out.push({ t, c: /^(\/\/|#)/.test(t) ? '#6a9955' : /^["'`]/.test(t) ? '#ce9178' : /^\d/.test(t) ? '#b5cea8' : KW.test(t) && t.match(KW)[0] === t ? '#569cd6' : /^[A-Z]/.test(t) ? '#4ec9b0' : /^[A-Za-z_$]/.test(t) && line.slice(m.index + t.length).trimStart().startsWith('(') ? '#dcdcaa' : '#d4d4d4' });
        if (!t) break;
    }
    return out;
}
/** Local narration plan: comment lines become captions for the code block that follows. */
export function planFromComments(code, maxLines = 12) {
    const lines = code.split('\n'), steps = [];
    let cur = { from: 0, say: '' };
    lines.forEach((l, i) => {
        const c = /^\s*(?:\/\/|#|\*|\/\*\*?)\s*(.+?)\s*(?:\*\/)?$/.exec(l);
        if ((c && c[1].length > 6 && i > cur.from) || i - cur.from >= maxLines) { if (i > cur.from) steps.push({ ...cur, to: i - 1 }); cur = { from: i, say: c ? c[1] : '' }; }
        else if (c && !cur.say) cur.say = c[1];
    });
    steps.push({ ...cur, to: lines.length - 1 });
    return steps.map(s => ({ ...s, say: s.say || `الأسطر ${s.from + 1}–${s.to + 1}` }));
}

export function installVideo(P) {
    const W = () => win();
    const loadVideo = (blob) => new Promise((res, rej) => { const v = document.createElement('video'); v.preload = 'auto'; v.playsInline = true; v.src = W().URL.createObjectURL(blob); v.onloadedmetadata = () => res(v); v.onerror = () => rej(new Error('تعذر فتح الفيديو في هذا المتصفح')); });
    const seek = (v, t) => new Promise(res => { if (Math.abs(v.currentTime - t) < 0.01) return res(); v.onseeked = () => res(); v.currentTime = t; });
    const progress = (id, done, total, label = '') => { const el = document.getElementById(id); if (el) el.innerHTML = `<div class="fmx-progress"><div style="width:${Math.round(clamp(done / Math.max(total, 0.001), 0, 1) * 100)}%"></div></div><div class="text-dim">${label} ${fmtTime(done)} / ${fmtTime(total)}</div>`; };

    /** Core real-time transcoder: segments of one or more videos → one recording (+ optional music, filter, overlay). */
    P.fmxTranscode = async function ({ segments, width, height, fps = 30, mime, bitrate = QUALITY.medium, filter = '', music = null, musicVolume = 0.25, keepAudio = true, overlay = null, progressId = 'fmx-vid-progress' }) {
        const Wn = W(), AC = Wn.AudioContext || Wn.webkitAudioContext;
        if (!Wn.MediaRecorder) throw new Error('المتصفح لا يدعم MediaRecorder');
        const first = await loadVideo(segments[0].blob);
        const vw = width || first.videoWidth || 1280, vh = height || Math.round(vw * (first.videoHeight || 720) / (first.videoWidth || 1280));
        const canvas = newCanvas(vw, vh), ctx = canvas.getContext('2d');
        const ac = AC ? new AC() : null, dest = ac ? ac.createMediaStreamDestination() : null;
        const tracks = canvas.captureStream(fps).getVideoTracks().concat(dest ? dest.stream.getAudioTracks() : []);
        const type = mime || pickVideoMime();
        const rec = new Wn.MediaRecorder(new Wn.MediaStream(tracks), { mimeType: type || undefined, videoBitsPerSecond: bitrate, audioBitsPerSecond: 128000 });
        const chunks = [];
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        let musicSrc = null;
        if (music && ac) { const a = await decodeAudio(music); const buf = ac.createBuffer(a.channels.length, a.channels[0].length, a.sampleRate); a.channels.forEach((c, i) => buf.copyToChannel(c, i)); musicSrc = ac.createBufferSource(); musicSrc.buffer = buf; musicSrc.loop = true; const g = ac.createGain(); g.gain.value = musicVolume; musicSrc.connect(g).connect(dest); }
        const total = segments.reduce((n, s) => n + ((s.end != null ? s.end : Infinity) - (s.start || 0)), 0);
        rec.start(500);
        if (musicSrc) musicSrc.start();
        let elapsed = 0;
        for (let i = 0; i < segments.length; i++) {
            const s = segments[i], v = i === 0 ? first : await loadVideo(s.blob);
            const end = Math.min(s.end != null ? s.end : v.duration, v.duration || Infinity), start = s.start || 0;
            if (ac && keepAudio) { const src = ac.createMediaElementSource(v); const g = ac.createGain(); g.gain.value = s.volume != null ? s.volume : 1; src.connect(g).connect(dest); } else v.muted = true;
            await seek(v, start);
            await v.play();
            await new Promise(res => {
                const draw = () => {
                    ctx.filter = filter || 'none';
                    const r = Math.min(vw / v.videoWidth, vh / v.videoHeight), dw = v.videoWidth * r, dh = v.videoHeight * r;
                    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, vw, vh);
                    ctx.drawImage(v, (vw - dw) / 2, (vh - dh) / 2, dw, dh);
                    ctx.filter = 'none';
                    const t = elapsed + v.currentTime - start;
                    if (overlay) overlay(ctx, t, vw, vh);
                    progress(progressId, t, isFinite(total) ? total : t + 1, '⏺️');
                    if (v.currentTime >= end - 0.02 || v.ended) { v.pause(); return res(); }
                    requestAnimationFrame(draw);
                };
                draw();
            });
            elapsed += end - start;
        }
        if (musicSrc) try { musicSrc.stop(); } catch (e) {}
        const blob = await new Promise(res => { rec.onstop = () => res(makeBlob(chunks, (type || 'video/webm').split(';')[0])); rec.stop(); });
        tracks.forEach(t => t.stop());
        if (ac) try { ac.close(); } catch (e) {}
        return { blob, width: vw, height: vh, duration: elapsed };
    };
    /** Draw-driven recorder for synthetic videos (code tutorial, avatar, news…). draw(ctx, t) returns false to stop. */
    P.fmxRenderCanvas = async function ({ width = 1280, height = 720, fps = 30, duration, draw, audio = null, mime, bitrate = QUALITY.high, progressId = 'fmx-vid-progress' }) {
        const Wn = W(), AC = Wn.AudioContext || Wn.webkitAudioContext;
        const canvas = newCanvas(width, height), ctx = canvas.getContext('2d');
        const ac = audio && AC ? new AC() : null, dest = ac ? ac.createMediaStreamDestination() : null;
        const tracks = canvas.captureStream(fps).getVideoTracks().concat(dest ? dest.stream.getAudioTracks() : []);
        const type = mime || pickVideoMime();
        const rec = new Wn.MediaRecorder(new Wn.MediaStream(tracks), { mimeType: type || undefined, videoBitsPerSecond: bitrate });
        const chunks = [];
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        if (ac) { const buf = ac.createBuffer(1, audio.samples.length, audio.rate); buf.copyToChannel(audio.samples, 0); const src = ac.createBufferSource(); src.buffer = buf; src.connect(dest); rec.start(500); src.start(); } else rec.start(500);
        const t0 = performance.now();
        await new Promise(res => { const loop = () => { const t = (performance.now() - t0) / 1000; const more = draw(ctx, t, width, height) !== false && t < duration; progress(progressId, Math.min(t, duration), duration, '🎬'); if (more) requestAnimationFrame(loop); else res(); }; loop(); });
        const blob = await new Promise(res => { rec.onstop = () => res(makeBlob(chunks, (type || 'video/webm').split(';')[0])); rec.stop(); });
        tracks.forEach(t => t.stop());
        if (ac) try { ac.close(); } catch (e) {}
        return { blob, width, height, duration };
    };
    const outName = (name, suffix, mime) => `${stemOf(name)}-${suffix}.${/mp4/.test(mime) ? 'mp4' : 'webm'}`;

    // ---- convert / compress / enhance / music (#585 #666 #669 #670 #683)
    P.fmxVideoConvert = function () {
        const mp4 = !!pickVideoMime('mp4').startsWith('video/mp4');
        return card('تحويل وضغط وتحسين الفيديو', `${sourcePicker(this, 'fmx-vc-src', ['video'], { accept: 'video/*' })}
            <div class="fmx-grid4">${select('fmx-vc-fmt', 'الصيغة', [['webm', 'WebM (VP9/VP8)'], ...(mp4 ? [['mp4', 'MP4 (H.264)']] : [])], mp4 ? 'mp4' : 'webm')}${select('fmx-vc-q', 'الجودة / الضغط', [['high', 'عالية 6Mbps'], ['medium', 'متوسطة 2.5Mbps'], ['low', 'مضغوط 1Mbps'], ['tiny', 'مضغوط جداً 400kbps']], 'medium')}${select('fmx-vc-w', 'العرض', [['0', 'الأصلي'], ['1920', '1080p'], ['1280', '720p'], ['854', '480p'], ['640', '360p']], '0')}${select('fmx-vc-fps', 'الإطارات', ['30', '24', '60', '15'], '30')}</div>
            <div class="gh-row"><label class="gh-check"><input id="fmx-vc-enh" type="checkbox"> تحسين الجودة (تباين، تشبع، حدة، تكبير ناعم)</label><label class="gh-check"><input id="fmx-vc-mute" type="checkbox"> إزالة الصوت الأصلي</label></div>
            <div class="fmx-grid2"><label class="fmx-field"><span>موسيقى خلفية (اختياري)</span><input id="fmx-vc-music" type="file" class="form-input-box" accept="audio/*"></label>${field('fmx-vc-mvol', 'مستوى الموسيقى', '25', 'type="range" min="0" max="100"')}</div>
            <div class="gh-row">${pbtn('fa-arrows-rotate', 'بدء المعالجة', 'app.fmxVideoConvertRun()')}<span class="text-dim">المعالجة بالمتصفح وبالزمن الحقيقي (مدة المعالجة = مدة المقطع). ${mp4 ? '' : 'متصفحك لا يدعم تسجيل MP4 — استخدم WebM.'}</span></div><div id="fmx-vid-progress"></div><div id="fmx-out"></div>`, 'fa-film');
    };
    P.fmxVideoConvertRun = async function (src, o = {}) {
        const [f] = await readSources(this, src || 'fmx-vc-src');
        if (!f) { this.showToast('اختر فيديو', 'warning'); return null; }
        const fmt = o.format || val('fmx-vc-fmt') || 'webm', q = o.quality || val('fmx-vc-q') || 'medium', enh = o.enhance != null ? o.enhance : val('fmx-vc-enh');
        const music = o.music || filesOf('fmx-vc-music')[0] || null;
        try {
            const r = await this.fmxTranscode({ segments: [{ blob: f.blob }], width: +(o.width || val('fmx-vc-w')) || 0, fps: +(o.fps || val('fmx-vc-fps')) || 30, mime: pickVideoMime(fmt), bitrate: QUALITY[q], filter: enh ? ENHANCE_FILTER : '', music, musicVolume: (+(o.musicVolume != null ? o.musicVolume : val('fmx-vc-mvol') || 25)) / 100, keepAudio: !(o.mute != null ? o.mute : val('fmx-vc-mute')) });
            this.fmxOutput(r.blob, outName(f.name, enh ? 'enhanced' : q, r.blob.type), { note: `${r.width}×${r.height} • ${fmtTime(r.duration)} • ${Math.round((1 - r.blob.size / f.bytes.length) * 100)}% أصغر` });
            return r;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };

    // ---- cut & merge (#664)
    P.fmxVideoMerge = function () {
        this._fmxClips = this._fmxClips || [];
        return card('قص ودمج المقاطع', `<div class="gh-row"><input id="fmx-vm-files" type="file" class="form-input-box" accept="video/*" multiple>${btn('fa-plus', 'إضافة', 'app.fmxAddClips()')}</div><div id="fmx-vm-list">${this.fmxClipsHTML()}</div>
            <div class="gh-row">${select('fmx-vm-fmt', 'الصيغة', [['webm', 'WebM'], ['mp4', 'MP4']], pickVideoMime('mp4').startsWith('video/mp4') ? 'mp4' : 'webm')}${pbtn('fa-scissors', 'قص ودمج', 'app.fmxMergeRun()')}</div><div id="fmx-vid-progress"></div><div id="fmx-out"></div>`, 'fa-scissors');
    };
    P.fmxClipsHTML = function () {
        return (this._fmxClips || []).map((c, i) => `<div class="fmx-clip" data-clip="${i}"><b>${i + 1}. ${esc(c.name)}</b> <small>${fmtTime(c.duration)}</small>
            <label>من <input type="number" step="0.1" min="0" class="form-input-box" value="${c.start}" onchange="app._fmxClips[${i}].start=+this.value"></label><label>إلى <input type="number" step="0.1" min="0" class="form-input-box" value="${c.end}" onchange="app._fmxClips[${i}].end=+this.value"></label>
            ${btn('fa-arrow-up', '', call('fmxMoveClip', i, -1), 'gh-chip')}${btn('fa-arrow-down', '', call('fmxMoveClip', i, 1), 'gh-chip')}${btn('fa-trash', '', call('fmxMoveClip', i, 0), 'gh-chip')}</div>`).join('') || empty('أضف مقطعاً أو أكثر ثم حدد بداية ونهاية كل مقطع');
    };
    P.fmxAddClips = async function (filesArg) {
        for (const f of filesArg || filesOf('fmx-vm-files')) {
            let duration = 0;
            try { const v = await loadVideo(f); duration = v.duration || 0; } catch (e) { /* unknown */ }
            (this._fmxClips = this._fmxClips || []).push({ blob: f, name: f.name, duration, start: 0, end: +duration.toFixed(2) });
        }
        const el = document.getElementById('fmx-vm-list'); if (el) el.innerHTML = this.fmxClipsHTML();
        return this._fmxClips;
    };
    P.fmxMoveClip = function (i, d) { const l = this._fmxClips; if (d === 0) l.splice(i, 1); else if (l[i + d]) [l[i], l[i + d]] = [l[i + d], l[i]]; const el = document.getElementById('fmx-vm-list'); if (el) el.innerHTML = this.fmxClipsHTML(); return l; };
    P.fmxMergeRun = async function (o = {}) {
        const clips = (this._fmxClips || []).filter(c => c.end > c.start);
        if (!clips.length) { this.showToast('أضف مقاطع', 'warning'); return null; }
        try {
            const r = await this.fmxTranscode({ segments: clips.map(c => ({ blob: c.blob, start: c.start, end: c.end })), mime: pickVideoMime(o.format || val('fmx-vm-fmt')), bitrate: QUALITY.high });
            this.fmxOutput(r.blob, outName(clips[0].name, 'edit', r.blob.type), { note: `${clips.length} مقاطع • ${fmtTime(r.duration)}` });
            return r;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };

    // ---- extract audio (#586 #667)
    P.fmxVideoAudio = function () {
        return card('استخراج الصوت من الفيديو', `${sourcePicker(this, 'fmx-va-src', ['video', 'audio'], { accept: 'video/*,audio/*' })}
            <div class="fmx-grid4">${field('fmx-va-start', 'من (ثانية)', '0', 'type="number" min="0" step="0.1"')}${field('fmx-va-end', 'إلى (0=النهاية)', '0', 'type="number" min="0" step="0.1"')}${select('fmx-va-ch', 'القنوات', [['keep', 'كما هي'], ['mono', 'أحادي']], 'keep')}${select('fmx-va-rate', 'التردد', [['0', 'الأصلي'], ['44100', '44.1kHz'], ['22050', '22kHz'], ['16000', '16kHz (للكلام)']], '0')}</div>
            <div class="gh-row">${pbtn('fa-music', 'استخراج WAV', 'app.fmxExtractAudio()')}<span class="text-dim">فوري (لا يحتاج تشغيل الفيديو). يمكنك تحريره بعدها في «محرر الصوت».</span></div><div id="fmx-out"></div>`, 'fa-music');
    };
    P.fmxExtractAudio = async function (src, o = {}) {
        const [f] = await readSources(this, src || 'fmx-va-src');
        if (!f) return null;
        try {
            const a = await decodeAudio(f.bytes);
            const start = +(o.start != null ? o.start : val('fmx-va-start')) || 0, endIn = +(o.end != null ? o.end : val('fmx-va-end')) || 0;
            const s0 = Math.floor(start * a.sampleRate), s1 = endIn ? Math.min(a.channels[0].length, Math.floor(endIn * a.sampleRate)) : a.channels[0].length;
            let chans = a.channels.map(c => c.subarray(s0, s1)), rate = a.sampleRate;
            const target = +(o.rate || val('fmx-va-rate')) || 0;
            if ((o.channels || val('fmx-va-ch')) === 'mono' || target) { const m = toMono(chans, rate, target || rate); chans = (o.channels || val('fmx-va-ch')) === 'mono' ? [m] : chans.map(c => toMono([c], rate, target || rate)); rate = target || rate; }
            const wav = encodeWAV(chans, rate);
            this.fmxOutput(makeBlob([wav], 'audio/wav'), stemOf(f.name) + '.wav', { note: `${fmtTime(chans[0].length / rate)} • ${chans.length === 1 ? 'أحادي' : 'ستيريو'} • ${rate}Hz` });
            return { wav, rate, channels: chans.length };
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };

    // ---- GIF (#668)
    P.fmxGif = function () {
        return card('إنشاء GIF من فيديو', `${sourcePicker(this, 'fmx-gif-src', ['video'], { accept: 'video/*' })}
            <div class="fmx-grid4">${field('fmx-gif-start', 'من (ثانية)', '0', 'type="number" min="0" step="0.1"')}${field('fmx-gif-dur', 'المدة', '3', 'type="number" min="0.2" max="30" step="0.1"')}${select('fmx-gif-fps', 'الإطارات/ث', ['10', '12', '15', '20', '8'], '10')}${select('fmx-gif-w', 'العرض', ['320', '480', '240', '640'], '320')}</div>
            <div class="gh-row">${field('fmx-gif-text', 'نص فوق الصورة (اختياري)', '', 'dir="auto"')}<label class="gh-check"><input id="fmx-gif-loop" type="checkbox" checked> تكرار</label>${pbtn('fa-images', 'إنشاء GIF', 'app.fmxGifRun()')}</div><div id="fmx-vid-progress"></div><div id="fmx-out"></div>`, 'fa-images');
    };
    P.fmxGifRun = async function (src, o = {}) {
        const [f] = await readSources(this, src || 'fmx-gif-src');
        if (!f) return null;
        const v = await loadVideo(f.blob);
        const start = +(o.start != null ? o.start : val('fmx-gif-start')) || 0, dur = Math.min(30, +(o.duration || val('fmx-gif-dur')) || 3), fps = +(o.fps || val('fmx-gif-fps')) || 10, w = +(o.width || val('fmx-gif-w')) || 320;
        const h = Math.round(w * (v.videoHeight || 9) / (v.videoWidth || 16)) || Math.round(w * 9 / 16), text = o.text != null ? o.text : val('fmx-gif-text');
        const c = newCanvas(w, h), ctx = ctx2d(c), gif = GIFEncoder(), n = Math.max(1, Math.round(dur * fps));
        for (let i = 0; i < n; i++) {
            await seek(v, Math.min((v.duration || dur) - 0.01, start + i / fps));
            ctx.drawImage(v, 0, 0, w, h);
            if (text) { ctx.font = `900 ${Math.round(w / 12)}px Impact, Tahoma, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff'; ctx.strokeText(text, w / 2, h - 6); ctx.fillText(text, w / 2, h - 6); }
            const { data } = ctx.getImageData(0, 0, w, h);
            const palette = quantize(data, 256), index = applyPalette(data, palette);
            gif.writeFrame(index, w, h, { palette, delay: Math.round(1000 / fps), repeat: (o.loop != null ? o.loop : val('fmx-gif-loop')) ? 0 : -1 });
            progress('fmx-vid-progress', (i + 1) / fps, dur, '🎞️');
        }
        gif.finish();
        const bytes = gif.bytes();
        this.fmxOutput(makeBlob([bytes], 'image/gif'), stemOf(f.name) + '.gif', { note: `${w}×${h} • ${n} إطار` });
        return { bytes, frames: n, width: w, height: h };
    };

    // ---- subtitles (#665)
    P.fmxSubtitles = function () {
        this._fmxCues = this._fmxCues || [];
        return card('ترجمة مرئية تلقائية (Subtitles)', `${sourcePicker(this, 'fmx-sub-src', ['video', 'audio'], { accept: 'video/*,audio/*' })}
            <div class="gh-row">${select('fmx-sub-lang', 'لغة الكلام', [['auto', 'تلقائي'], ['ar', 'العربية'], ['en', 'English'], ['fr', 'Français']], 'auto')}${pbtn('fa-closed-captioning', 'توليد الترجمة', 'app.fmxAutoSubs()')}${select('fmx-sub-tr', 'ترجمتها إلى', [['', '—'], ['Arabic', 'العربية'], ['English', 'English'], ['French', 'Français'], ['Spanish', 'Español'], ['Turkish', 'Türkçe']], '')}${btn('fa-language', 'ترجمة', 'app.fmxTranslateSubs()')}</div>
            <div class="gh-row"><label class="fmx-field"><span>أو استورد SRT/VTT</span><input id="fmx-sub-file" type="file" class="form-input-box" accept=".srt,.vtt" onchange="app.fmxImportSubs()"></label></div>
            <video id="fmx-sub-video" class="fmx-out-img" controls></video><div id="fmx-sub-cues">${this.fmxCuesHTML()}</div>
            <div class="gh-row">${btn('fa-plus', 'سطر عند الوقت الحالي', 'app.fmxAddCue()')}${btn('fa-file-lines', 'تحميل VTT', 'app.fmxExportSubs(\'vtt\')')}${btn('fa-file', 'تحميل SRT', 'app.fmxExportSubs(\'srt\')')}${pbtn('fa-fire', 'دمجها في الفيديو', 'app.fmxBurnSubs()')}</div><div id="fmx-vid-progress"></div><div id="fmx-out"></div>`, 'fa-closed-captioning');
    };
    P.fmxCuesHTML = function () {
        return (this._fmxCues || []).map((c, i) => `<div class="fmx-cue" data-cue="${i}"><input class="form-input-box" type="number" step="0.1" value="${c.start.toFixed(2)}" onchange="app._fmxCues[${i}].start=+this.value;app.fmxSubsPreview()"><input class="form-input-box" type="number" step="0.1" value="${c.end.toFixed(2)}" onchange="app._fmxCues[${i}].end=+this.value;app.fmxSubsPreview()"><input class="form-input-box" dir="auto" value="${esc(c.text)}" onchange="app._fmxCues[${i}].text=this.value;app.fmxSubsPreview()">${btn('fa-trash', '', call('fmxDeleteCue', i), 'gh-chip')}</div>`).join('') || '<div class="text-dim">لا أسطر بعد</div>';
    };
    P.fmxSubsPreview = function () {
        const v = document.getElementById('fmx-sub-video');
        const el = document.getElementById('fmx-sub-cues');
        if (el && document.activeElement && !el.contains(document.activeElement)) el.innerHTML = this.fmxCuesHTML();
        if (!v) return;
        Array.from(v.querySelectorAll('track')).forEach(t => t.remove());
        if (!this._fmxCues.length) return;
        const t = document.createElement('track');
        t.kind = 'subtitles'; t.default = true; t.label = 'OX'; t.src = W().URL.createObjectURL(makeBlob([toVTT(this._fmxCues)], 'text/vtt'));
        v.appendChild(t);
    };
    P.fmxSetSubVideo = async function (srcId) { const [f] = await readSources(this, srcId || 'fmx-sub-src'); const v = document.getElementById('fmx-sub-video'); if (f && v) { v.src = W().URL.createObjectURL(f.blob); this._fmxSubSrc = f; } return f; };
    P.fmxAutoSubs = async function (src) {
        const f = await this.fmxSetSubVideo(src);
        if (!f) { this.showToast('اختر فيديو أو صوتاً', 'warning'); return null; }
        if (!hasKey(this)) return null;
        try {
            const a = await decodeAudio(f.bytes);
            const mono = toMono(a.channels, a.sampleRate, 16000), seg = 45 * 16000, cues = [];
            const lang = val('fmx-sub-lang') || 'auto';
            for (let o = 0; o < mono.length; o += seg) {
                progress('fmx-vid-progress', o / 16000, mono.length / 16000, '📝');
                const wav = encodeWAV([mono.subarray(o, o + seg)], 16000);
                const text = await chatParts(this, [textPart(`Transcribe this audio${lang !== 'auto' ? ' (language: ' + lang + ')' : ''} into subtitle segments of 1-2 short sentences. Timestamps are seconds from the start of THIS clip. Return JSON only: {"segments":[{"start":0.0,"end":2.5,"text":"…"}]}`), audioPart(wav)], { maxTokens: 4000 });
                cuesFromModel(text, o / 16000).forEach(c => cues.push(c));
            }
            this._fmxCues = cues;
            progress('fmx-vid-progress', 1, 1, '✅');
            this.fmxSubsPreview();
            const el = document.getElementById('fmx-sub-cues'); if (el) el.innerHTML = this.fmxCuesHTML();
            return cues;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };
    P.fmxTranslateSubs = async function (langArg) {
        const lang = langArg || val('fmx-sub-tr');
        if (!lang || !this._fmxCues.length) return null;
        const r = await this.aiJSON(`Translate these subtitle lines into ${lang}. Keep them short. Return {"lines":["…"]} with exactly ${this._fmxCues.length} items in order.\n\n${JSON.stringify(this._fmxCues.map(c => c.text))}`, { kind: 'general', maxTokens: 4000, source: 'fmx-subs' });
        if (r && Array.isArray(r.lines)) this._fmxCues = this._fmxCues.map((c, i) => ({ ...c, text: r.lines[i] != null ? String(r.lines[i]) : c.text }));
        const el = document.getElementById('fmx-sub-cues'); if (el) el.innerHTML = this.fmxCuesHTML();
        this.fmxSubsPreview();
        return this._fmxCues;
    };
    P.fmxImportSubs = async function (textArg) {
        const f = filesOf('fmx-sub-file')[0];
        const text = textArg || (f ? new TextDecoder().decode(await blobBytes(f)) : '');
        this._fmxCues = parseSubs(text);
        const el = document.getElementById('fmx-sub-cues'); if (el) el.innerHTML = this.fmxCuesHTML();
        this.fmxSubsPreview();
        return this._fmxCues;
    };
    P.fmxAddCue = function () { const v = document.getElementById('fmx-sub-video'); const t = v ? v.currentTime || 0 : 0; this._fmxCues.push({ start: t, end: t + 2.5, text: '…' }); this._fmxCues.sort((a, b) => a.start - b.start); const el = document.getElementById('fmx-sub-cues'); if (el) el.innerHTML = this.fmxCuesHTML(); this.fmxSubsPreview(); };
    P.fmxDeleteCue = function (i) { this._fmxCues.splice(i, 1); const el = document.getElementById('fmx-sub-cues'); if (el) el.innerHTML = this.fmxCuesHTML(); this.fmxSubsPreview(); };
    P.fmxExportSubs = function (fmt = 'vtt') { const text = fmt === 'srt' ? toSRT(this._fmxCues) : toVTT(this._fmxCues); const name = `${stemOf((this._fmxSubSrc && this._fmxSubSrc.name) || 'subtitles')}.${fmt}`; this.fmxOutput(makeBlob([text], fmt === 'srt' ? 'application/x-subrip' : 'text/vtt'), name, { preview: false }); return text; };
    P.fmxBurnSubs = async function () {
        const f = this._fmxSubSrc || await this.fmxSetSubVideo();
        if (!f || !this._fmxCues.length) { this.showToast('يلزم فيديو وأسطر ترجمة', 'warning'); return null; }
        const cues = this._fmxCues;
        try {
            const r = await this.fmxTranscode({ segments: [{ blob: f.blob }], bitrate: QUALITY.high, overlay: (ctx, t, w, h) => {
                const c = cues.find(x => t >= x.start && t <= x.end);
                if (!c) return;
                const size = Math.round(h / 18);
                ctx.font = `700 ${size}px Tahoma, "Segoe UI", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
                c.text.split('\n').reverse().forEach((line, i) => { const y = h - size * 0.8 - i * size * 1.3, wd = ctx.measureText(line).width; ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(w / 2 - wd / 2 - 10, y - size * 1.15, wd + 20, size * 1.3); ctx.fillStyle = '#fff'; ctx.fillText(line, w / 2, y); });
            } });
            this.fmxOutput(r.blob, outName(f.name, 'subtitled', r.blob.type));
            return r;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };

    // ---- tutorial video from code (#658)
    P.fmxCodeVideo = function () {
        const files = this.projectPaths().filter(p => isTextEntry(this.virtualProjectFiles.get(p)));
        return card('فيديو تعليمي من الكود', `<div class="fmx-grid2">${select('fmx-cv-path', 'الملف', files.map(p => [p, p]), this.activeStudioFile)}${select('fmx-cv-speed', 'سرعة الكتابة', [['40', 'بطيئة'], ['80', 'متوسطة'], ['160', 'سريعة']], '80')}</div>
            <div class="gh-row"><label class="gh-check"><input id="fmx-cv-ai" type="checkbox" checked> شرح بالذكاء الاصطناعي</label><label class="gh-check"><input id="fmx-cv-voice" type="checkbox"> تعليق صوتي AI</label>${select('fmx-cv-v', 'الصوت', AI_VOICES, 'nova')}${field('fmx-cv-max', 'أقصى عدد أسطر', '80', 'type="number" min="5" max="400"')}</div>
            <div class="gh-row">${pbtn('fa-video', 'إنشاء الفيديو', 'app.fmxCodeVideoRun()')}<span class="text-dim">كتابة متحركة مع تلوين الصياغة وشرح لكل جزء (من التعليقات محلياً أو من الذكاء الاصطناعي) — 1280×720.</span></div><div id="fmx-vid-progress"></div><div id="fmx-out"></div>`, 'fa-video');
    };
    P.fmxCodeVideoPlan = async function (path, code, useAI) {
        let steps = planFromComments(code);
        if (useAI && hasKey(this, true)) {
            const r = await this.aiJSON(`Split this code into 3-10 teaching steps for a tutorial video. For each step give the line range (1-based, inclusive, contiguous, covering the whole file) and a short Arabic narration sentence (max 25 words).\nReturn {"steps":[{"from":1,"to":10,"say":"…"}]}\n\nFile: ${path}\n${code.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n')}`, { kind: 'coding', maxTokens: 2000, source: 'fmx-codevideo' });
            if (r && Array.isArray(r.steps) && r.steps.length) steps = r.steps.map(s => ({ from: clamp((+s.from || 1) - 1, 0, code.split('\n').length - 1), to: clamp((+s.to || 1) - 1, 0, code.split('\n').length - 1), say: String(s.say || '') })).filter(s => s.to >= s.from);
        }
        return steps;
    };
    P.fmxCodeVideoRun = async function (o = {}) {
        const path = o.path || val('fmx-cv-path'), e = this.virtualProjectFiles.get(path);
        if (!e || !isTextEntry(e)) { this.showToast('اختر ملفاً نصياً', 'warning'); return null; }
        const maxL = +(o.maxLines || val('fmx-cv-max')) || 80, code = e.content.split('\n').slice(0, maxL).join('\n'), lines = code.split('\n');
        const cps = +(o.speed || val('fmx-cv-speed')) || 80;
        const steps = await this.fmxCodeVideoPlan(path, code, o.ai != null ? o.ai : val('fmx-cv-ai'));
        // timing: title 2.5s, each step = max(typing, narration)
        let narration = null; const stepAudio = [];
        if ((o.voice != null ? o.voice : val('fmx-cv-voice')) && hasKey(this, true)) {
            for (const s of steps) { const a = await aiSpeech(this, s.say, { voice: o.voiceName || val('fmx-cv-v') || 'nova' }).catch(() => null); stepAudio.push(a); }
        }
        let t = 2.5; const timeline = steps.map((s, i) => { const chars = lines.slice(s.from, s.to + 1).join('\n').length; const typing = chars / cps, talk = stepAudio[i] ? stepAudio[i].samples.length / stepAudio[i].rate : s.say.length / 14; const d = Math.max(typing + 0.8, talk + 0.4, 2); const item = { ...s, t0: t, t1: t + d, typing }; t += d; return item; });
        const duration = t + 1.5;
        if (stepAudio.some(Boolean)) {
            const rate = (stepAudio.find(Boolean) || {}).rate || 24000, buf = new Float32Array(Math.ceil(duration * rate));
            timeline.forEach((s, i) => { const a = stepAudio[i]; if (a) buf.set(a.samples.subarray(0, Math.max(0, buf.length - Math.floor(s.t0 * rate))), Math.floor(s.t0 * rate)); });
            narration = { samples: buf, rate };
        }
        const toks = lines.map(tokenizeLine), title = baseName(path);
        const draw = (ctx, now, w, h) => {
            ctx.fillStyle = '#1e1e1e'; ctx.fillRect(0, 0, w, h);
            if (now < 2.5) { ctx.fillStyle = '#e3e3e3'; ctx.textAlign = 'center'; ctx.font = '700 54px Tahoma, sans-serif'; ctx.fillText('شرح الكود', w / 2, h / 2 - 30); ctx.font = '32px Consolas, monospace'; ctx.fillStyle = '#4ec9b0'; ctx.fillText(title, w / 2, h / 2 + 30); return; }
            const step = timeline.find(s => now >= s.t0 && now < s.t1) || timeline[timeline.length - 1];
            let visible = 0;
            timeline.forEach(s => { if (now >= s.t1) visible = s.to + 1; else if (now >= s.t0) { const chars = Math.floor((now - s.t0) * cps); let acc = 0; visible = s.from; for (let i = s.from; i <= s.to; i++) { acc += lines[i].length + 1; visible = i + (acc <= chars ? 1 : (lines[i].length ? (chars - (acc - lines[i].length - 1)) / lines[i].length : 1)); if (acc > chars) break; } } });
            const lh = 26, top = 70, maxRows = Math.floor((h - 190) / lh), first = Math.max(0, Math.ceil(visible) - maxRows);
            ctx.fillStyle = '#252526'; ctx.fillRect(0, 0, w, 44); ctx.fillStyle = '#ccc'; ctx.font = '18px Tahoma, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('📄 ' + title, 16, 29);
            ctx.font = '19px Consolas, "Courier New", monospace'; ctx.textBaseline = 'alphabetic';
            for (let i = first; i < Math.min(lines.length, Math.ceil(visible)); i++) {
                const y = top + (i - first) * lh, inStep = step && i >= step.from && i <= step.to;
                if (inStep) { ctx.fillStyle = 'rgba(56,189,248,.08)'; ctx.fillRect(0, y - 19, w, lh); }
                ctx.fillStyle = '#858585'; ctx.textAlign = 'right'; ctx.fillText(String(i + 1), 56, y); ctx.textAlign = 'left';
                const partial = i === Math.floor(visible) ? (visible - i) : 1; let x = 72, budget = Math.floor(lines[i].length * partial);
                for (const tk of toks[i]) { if (budget <= 0) break; const s = tk.t.slice(0, budget); budget -= tk.t.length; ctx.fillStyle = tk.c; ctx.fillText(s.replace(/\t/g, '    '), x, y); x += ctx.measureText(s.replace(/\t/g, '    ')).width; }
                if (i === Math.floor(visible) && Math.floor(now * 2) % 2) { ctx.fillStyle = '#aeafad'; ctx.fillRect(x + 1, y - 17, 2, 21); }
            }
            if (step) { ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(0, h - 110, w, 110); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = '600 28px Tahoma, sans-serif'; const words = step.say.split(' '); const l1 = [], l2 = []; words.forEach(wd => ((ctx.measureText(l1.concat(wd).join(' ')).width < w - 120 && !l2.length) ? l1 : l2).push(wd)); ctx.fillText(l1.join(' '), w / 2, h - 66); if (l2.length) ctx.fillText(l2.join(' '), w / 2, h - 26); }
        };
        try {
            const r = await this.fmxRenderCanvas({ duration, draw, audio: narration });
            this.fmxOutput(r.blob, `${stemOf(path)}-tutorial.${/mp4/.test(r.blob.type) ? 'mp4' : 'webm'}`, { note: `${fmtTime(duration)} • ${steps.length} خطوات${narration ? ' • مع تعليق صوتي' : ''}` });
            this._fmxCodeVideoScript = timeline.map(s => `[${fmtTime(s.t0)}] (${s.from + 1}-${s.to + 1}) ${s.say}`).join('\n');
            return { ...r, steps: timeline };
        } catch (err) { this.showToast('❌ ' + err.message, 'error'); return null; }
    };
}
