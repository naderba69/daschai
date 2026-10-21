/* Voice: speech-to-text (#651), text-to-speech in 20 languages / 100+ voices (#652), walkie-talkie AI call (#653), live translation (#654),
   voice commands (#655), pronunciation scoring/correction, language training, accent test (#707-#710), speech analysis — emotion (#701),
   language detection (#702), speaker diarization (#703), speaking rate (#706). */
import { esc, call, btn, pbtn, card, empty, field, area, select, fmtTime, makeBlob, encodeWAV, val, win, lsGet, lsSet, words, alignWords, baseName } from './shared.js';
import { sourcePicker, readSources } from './core.js';
import { aiReady, decodeAudio, toMono, chatParts, audioPart, textPart, hasKey, aiSpeech, AI_VOICES, speak, stopSpeaking, listen, listVoices, recordMic, speechSupported } from './aiio.js';

export const LANGS = [['ar-SA', 'العربية'], ['en-US', 'English'], ['fr-FR', 'Français'], ['es-ES', 'Español'], ['de-DE', 'Deutsch'], ['it-IT', 'Italiano'], ['tr-TR', 'Türkçe'], ['pt-BR', 'Português'], ['ru-RU', 'Русский'], ['zh-CN', '中文'], ['ja-JP', '日本語'], ['ko-KR', '한국어'], ['hi-IN', 'हिन्दी'], ['ur-PK', 'اردو'], ['fa-IR', 'فارسی'], ['id-ID', 'Indonesia'], ['nl-NL', 'Nederlands'], ['sv-SE', 'Svenska'], ['pl-PL', 'Polski'], ['sw-KE', 'Kiswahili']];
export const langName = (code) => (LANGS.find(l => l[0] === code || l[0].startsWith(code + '-')) || [code, code])[1];
const LANG_EN = { ar: 'Arabic', en: 'English', fr: 'French', es: 'Spanish', de: 'German', it: 'Italian', tr: 'Turkish', pt: 'Portuguese', ru: 'Russian', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', hi: 'Hindi', ur: 'Urdu', fa: 'Persian', id: 'Indonesian', nl: 'Dutch', sv: 'Swedish', pl: 'Polish', sw: 'Swahili' };
export const langEn = (code) => LANG_EN[String(code || '').slice(0, 2)] || code;

// ------------------------------------------------------------------ pure helpers
const DIGITS = { 'صفر': 0, 'واحد': 1, 'اثنين': 2, 'اثنان': 2, 'ثلاثة': 3, 'أربعة': 4, 'اربعة': 4, 'خمسة': 5, 'ستة': 6, 'سبعة': 7, 'ثمانية': 8, 'تسعة': 9, 'عشرة': 10, 'عشرين': 20, 'ثلاثين': 30, 'خمسين': 50, 'مئة': 100, 'مائة': 100, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20, fifty: 50, hundred: 100 };
const toNum = (s) => { const m = /\d+/.exec(s); if (m) return +m[0]; const w = String(s).trim().toLowerCase().split(/\s+/).map(x => DIGITS[x]).filter(x => x != null); return w.length ? w.reduce((a, b) => a + b, 0) : NaN; };
/** Spoken file name → best project path ("app dot ts" / "ملف ابب نقطة تي اس" → app.ts). */
export function matchSpokenPath(spoken, paths) {
    const norm = (s) => String(s).toLowerCase().replace(/\s*(dot|نقطة|point)\s*/g, '.').replace(/\s*(slash|شرطة|سلاش)\s*/g, '/').replace(/[\s_\-]+/g, '');
    const q = norm(spoken);
    if (!q) return null;
    let best = null, bestScore = 0;
    for (const p of paths) {
        const b = norm(baseName(p)), full = norm(p);
        let s = full === q || b === q ? 100 : b.startsWith(q) || q.startsWith(b) ? 80 : full.includes(q) ? 60 : b.replace(/\..*$/, '') === q.replace(/\..*$/, '') ? 70 : 0;
        if (!s) { let i = 0; for (const c of b) if (c === q[i]) i++; s = i >= Math.min(q.length, 3) && i / q.length > 0.7 ? 40 * i / q.length : 0; }
        if (s > bestScore) { bestScore = s; best = p; }
    }
    return best;
}
/** Voice command → {action, arg} (#655). Arabic + English. */
export const VOICE_COMMANDS = [
    ['open', /^(?:افتح|إفتح|اِفتح|open)\s+(?:الملف|ملف|file)?\s*(.+)$/i, 'افتح ملف app.ts'],
    ['line', /^(?:اذهب|انتقل|روح|go)\s+(?:إلى|الى|to)?\s*(?:السطر|سطر|line)\s+(.+)$/i, 'انتقل إلى السطر 20'],
    ['search', /^(?:ابحث|بحث|search|find)\s+(?:عن|for)?\s*(.+)$/i, 'ابحث عن fetch'],
    ['ask', /^(?:اسأل|اسال|سؤال|ask)\s+(.+)$/i, 'اسأل كيف أرتب مصفوفة'],
    ['save', /^(?:احفظ|حفظ|save)(?=\s|$)/i, 'احفظ'],
    ['run', /^(?:شغل|شغّل|نفذ|نفّذ|run)(?=\s|$)/i, 'شغّل'],
    ['commit', /^(?:commit|التزم|ارفع|ادفع)(?=\s|$)/i, 'ارفع التغييرات'],
    ['theme', /^(?:غير|بدل|بدّل|toggle)\s*(?:الثيم|المظهر|theme)/i, 'غيّر الثيم'],
    ['palette', /^(?:لوحة الأوامر|الأوامر|command palette|palette)/i, 'لوحة الأوامر'],
    ['studio', /^(?:الاستوديو|المحرر|studio|editor)/i, 'المحرر'],
    ['newfile', /^(?:ملف جديد|new file)\s*(.*)$/i, 'ملف جديد utils.js'],
    ['github', /^(?:جيت ?هب|github)/i, 'جيت هب'],
    ['media', /^(?:الوسائط|الملفات والوسائط|media)/i, 'الوسائط'],
    ['stop', /^(?:توقف|أوقف|اوقف|stop)(?=\s|$)/i, 'توقف']
];
export function parseVoiceCommand(text, paths = []) {
    const t = String(text || '').trim().replace(/[.!؟?،,]+$/, '');
    for (const [action, re] of VOICE_COMMANDS) {
        const m = re.exec(t);
        if (!m) continue;
        const arg = (m[1] || '').trim();
        if (action === 'open') { const p = matchSpokenPath(arg, paths); return p ? { action, arg: p } : { action: 'unknown', arg: t, reason: 'لم أجد ملفاً باسم ' + arg }; }
        if (action === 'line') { const n = toNum(arg); return isFinite(n) ? { action, arg: n } : { action: 'unknown', arg: t }; }
        return { action, arg };
    }
    return { action: 'unknown', arg: t };
}
/** Local voice-activity stats (#706): speaking time, pauses, WPM. */
export function speechStats(samples, rate, transcript = '') {
    const frame = Math.round(rate * 0.03), en = [];
    for (let o = 0; o + frame <= samples.length; o += frame) { let e = 0; for (let i = o; i < o + frame; i++) e += samples[i] * samples[i]; en.push(Math.sqrt(e / frame)); }
    const sorted = en.slice().sort((a, b) => a - b), noise = sorted[Math.floor(sorted.length * 0.1)] || 0, peak = sorted[Math.floor(sorted.length * 0.95)] || 0;
    const thr = noise + (peak - noise) * 0.15;
    let speaking = 0, pauses = 0, run = 0, pauseTotal = 0;
    const minPause = Math.round(0.35 / 0.03);
    en.forEach((e, i) => { if (e > thr) { speaking++; if (run >= minPause && i - run > 0) { pauses++; pauseTotal += run; } run = 0; } else run++; });
    const duration = samples.length / rate, speakingSec = speaking * 0.03, n = words(transcript).length;
    return { duration, speakingSec, pauses, avgPause: pauses ? pauseTotal * 0.03 / pauses : 0, words: n, wpm: speakingSec > 1 && n ? Math.round(n / (speakingSec / 60)) : 0, wpmTotal: duration > 1 && n ? Math.round(n / (duration / 60)) : 0 };
}
export const paceLabel = (wpm) => (!wpm ? '—' : wpm < 100 ? 'بطيء' : wpm < 150 ? 'مريح' : wpm < 180 ? 'سريع' : 'سريع جداً');
/** Autocorrelation pitch track (Hz per 40ms frame, 0 = unvoiced). */
export function pitchTrack(samples, rate, { min = 70, max = 400 } = {}) {
    const frame = Math.round(rate * 0.04), out = [];
    for (let o = 0; o + frame * 2 <= samples.length; o += frame) {
        let e = 0; for (let i = 0; i < frame; i++) e += samples[o + i] ** 2;
        if (Math.sqrt(e / frame) < 0.01) { out.push(0); continue; }
        let best = 0, bestLag = 0;
        for (let lag = Math.floor(rate / max); lag <= Math.floor(rate / min); lag++) { let c = 0; for (let i = 0; i < frame; i++) c += samples[o + i] * samples[o + i + lag]; if (c > best) { best = c; bestLag = lag; } }
        out.push(bestLag && best / e > 0.3 ? rate / bestLag : 0);
    }
    return out;
}
export function prosody(samples, rate) {
    const p = pitchTrack(samples, rate).filter(Boolean);
    if (!p.length) return { pitch: 0, variation: 0, energy: 0 };
    const mean = p.reduce((a, b) => a + b, 0) / p.length, sd = Math.sqrt(p.reduce((a, b) => a + (b - mean) ** 2, 0) / p.length);
    let e = 0; for (let i = 0; i < samples.length; i++) e += samples[i] ** 2;
    return { pitch: Math.round(mean), variation: Math.round(sd / mean * 100), energy: +Math.sqrt(e / samples.length).toFixed(3) };
}
export const segmentsToText = (segs, { times = true, speakers = true } = {}) => segs.map(s => `${times ? `[${fmtTime(s.start)}] ` : ''}${speakers && s.speaker ? s.speaker + ': ' : ''}${s.text}`).join('\n');
const parseSegJSON = (text, offset) => { const m = /\{[\s\S]*\}/.exec(String(text || '')); if (!m) return { segments: String(text || '').trim() ? [{ start: offset, end: offset, text: String(text).trim() }] : [] }; try { const j = JSON.parse(m[0]); return { ...j, segments: (j.segments || []).map(s => ({ ...s, start: (+s.start || 0) + offset, end: (+s.end || 0) + offset, text: String(s.text || '').trim() })).filter(s => s.text) }; } catch (e) { return { segments: [] }; } };

/** Transcribe any audio with an audio-input model in 45 s chunks. diarize → speaker/emotion/language per segment. */
export async function transcribeAudio(app, src, { lang = 'auto', diarize = false, translateTo = '', onProgress } = {}) {
    if (!hasKey(app)) return null;
    const a = await decodeAudio(src), mono = toMono(a.channels, a.sampleRate, 16000), seg = 45 * 16000, out = [], meta = {};
    const ask = `Transcribe this audio${lang && lang !== 'auto' ? ` (spoken language: ${langEn(lang)})` : ''} verbatim${translateTo ? `, then give each segment's text translated into ${translateTo}` : ''}. Timestamps are seconds from the start of THIS clip.${diarize ? ' Identify distinct speakers consistently (Speaker 1, Speaker 2, … keep the same label for the same voice) and each segment\'s emotion (neutral|happy|sad|angry|fearful|surprised|excited|calm).' : ''} Return JSON only: {"language":"ISO 639-1 code","segments":[{"start":0.0,"end":2.5,${diarize ? '"speaker":"Speaker 1","emotion":"neutral",' : ''}"text":"…"}]}`;
    for (let o = 0; o < mono.length; o += seg) {
        if (onProgress) onProgress(o / 16000, mono.length / 16000);
        const r = parseSegJSON(await chatParts(app, [textPart(ask), audioPart(encodeWAV([mono.subarray(o, o + seg)], 16000))], { maxTokens: 4000 }), o / 16000);
        if (r.language && !meta.language) meta.language = r.language;
        out.push(...r.segments);
    }
    return { segments: out, language: meta.language || '', text: out.map(s => s.text).join(' '), duration: mono.length / 16000, mono };
}

export function installVoice(P) {
    const W = () => win();
    const prog = (id, done, total, label = '') => { const el = document.getElementById(id); if (el) el.innerHTML = `<div class="fmx-progress"><div style="width:${Math.round(done / Math.max(1e-9, total) * 100)}%"></div><span>${label} ${fmtTime(done)} / ${fmtTime(total)}</span></div>`; };
    const out = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; return el; };

    // ================================================================ TTS (#652)
    P.fmxTTS = function () {
        const voices = listVoices();
        this._fmxMount = () => { this.fmxTTSVoices(); try { const ss = W().speechSynthesis; if (ss && !voices.length) ss.onvoiceschanged = () => this.fmxTTSVoices(); } catch (e) {} };
        return card('نص إلى كلام', `${area('fmx-tts-text', 'النص', '', 5, 'dir="auto"')}
            <div class="fmx-grid4">${select('fmx-tts-lang', 'اللغة', LANGS, 'ar-SA', `onchange="${call('fmxTTSVoices')}"`)}<label class="fmx-field"><span>صوت المتصفح</span><select id="fmx-tts-voice" class="form-input-box"></select></label>${field('fmx-tts-rate', 'السرعة', '1', 'type="range" min="0.5" max="2" step="0.1"')}${field('fmx-tts-pitch', 'الطبقة', '1', 'type="range" min="0" max="2" step="0.1"')}</div>
            <div class="gh-row">${pbtn('fa-play', 'استماع', 'app.fmxTTSPlay()')}${btn('fa-stop', 'إيقاف', 'app.fmxTTSStop()')}<label class="gh-check"><input id="fmx-tts-translate" type="checkbox"> ترجم النص إلى اللغة المختارة أولاً</label></div>
            <div class="fmx-card-h"><i class="fa-solid fa-robot"></i> ملف صوتي بأصوات الذكاء الاصطناعي</div>
            <div class="gh-row">${select('fmx-tts-ai', 'الصوت', AI_VOICES.map(v => [v, v]), 'nova')}${select('fmx-tts-style', 'الأداء', [['', 'طبيعي'], ['warm, friendly and calm', 'دافئ'], ['energetic and enthusiastic', 'حماسي'], ['slow, clear, educational', 'تعليمي بطيء'], ['dramatic storyteller', 'راوٍ درامي'], ['formal news anchor', 'مذيع أخبار']], '')}${pbtn('fa-file-audio', 'توليد WAV', 'app.fmxTTSFile()')}</div>
            <div class="text-dim" id="fmx-tts-count">${voices.length} صوتاً في متصفحك + ${AI_VOICES.length} أصوات ذكاء اصطناعي تتحدث ${LANGS.length} لغة وأكثر = ${voices.length + AI_VOICES.length * LANGS.length} تركيبة صوت/لغة. أصوات المتصفح لا تُحفظ كملفات — استخدم أصوات الذكاء لذلك.</div><div id="fmx-out"></div>`, 'fa-volume-high');
    };
    P.fmxTTSVoices = function () {
        const sel = document.getElementById('fmx-tts-voice');
        const lang = (val('fmx-tts-lang') || 'ar-SA').slice(0, 2);
        const list = listVoices().filter(v => (v.lang || '').toLowerCase().startsWith(lang));
        if (sel) sel.innerHTML = '<option value="">تلقائي</option>' + list.map(v => `<option value="${esc(v.voiceURI)}">${esc(v.name)} (${esc(v.lang)})</option>`).join('');
        return list;
    };
    P._fmxMaybeTranslate = async function (text, langCode) {
        if (!val('fmx-tts-translate')) return text;
        const t = await this.aiRun(`Translate into ${langEn(langCode)}. Return only the translation:\n\n${text}`, { kind: 'general', maxTokens: 3000, source: 'fmx-tts' });
        return t ? t.trim() : text;
    };
    P.fmxTTSPlay = async function (textArg) {
        const lang = val('fmx-tts-lang') || 'ar-SA';
        const text = await this._fmxMaybeTranslate(textArg || val('fmx-tts-text'), lang);
        if (!text) return null;
        stopSpeaking();
        return speak(text, { lang, voice: val('fmx-tts-voice') || undefined, rate: +val('fmx-tts-rate') || 1, pitch: +val('fmx-tts-pitch') || 1 });
    };
    P.fmxTTSStop = function () { stopSpeaking(); try { this._fmxAudioEl && this._fmxAudioEl.pause(); } catch (e) {} };
    P.fmxTTSFile = async function (textArg) {
        const lang = val('fmx-tts-lang') || 'ar-SA';
        const text = await this._fmxMaybeTranslate(textArg || val('fmx-tts-text'), lang);
        if (!text) return null;
        try {
            const r = await aiSpeech(this, text, { voice: val('fmx-tts-ai') || 'nova', style: val('fmx-tts-style'), onProgress: (i, n) => out('fmx-out', `<div class="gh-empty"><span class="live-step-spinner"></span> ${i}/${n}</div>`) });
            if (!r) return null;
            this.fmxOutput(makeBlob([r.wav], 'audio/wav'), `speech-${val('fmx-tts-ai') || 'nova'}.wav`, { note: fmtTime(r.samples.length / r.rate) });
            return r;
        } catch (e) { this.showToast('❌ ' + e.message + ' — اختر نموذج صوت يدعم الإخراج الصوتي في الإعدادات', 'error'); return null; }
    };

    // ================================================================ STT (#651)
    P.fmxSTT = function () {
        const s = speechSupported();
        return card('إملاء مباشر', `<div class="gh-row">${select('fmx-stt-lang', 'اللغة', LANGS, 'ar-SA')}${pbtn('fa-microphone', 'ابدأ الإملاء', 'app.fmxDictate()')}${btn('fa-stop', 'إيقاف', 'app.fmxDictateStop()')}</div>
                ${s.stt ? '' : '<div class="gh-empty bad">متصفحك لا يدعم التعرف على الكلام — استخدم «تفريغ ملف» بالأسفل.</div>'}${area('fmx-stt-text', 'النص', '', 6, 'dir="auto"')}<div id="fmx-stt-interim" class="text-dim"></div>
                <div class="gh-row">${btn('fa-copy', 'نسخ', 'app.copyText(document.getElementById(\'fmx-stt-text\').value)')}${btn('fa-file-circle-plus', 'حفظ كملف', 'app.fmxSTTSave()')}${btn('fa-comment', 'إرسال للمحادثة', 'app.fmxSTTToChat()')}</div>`, 'fa-microphone')
            + card('تفريغ ملف صوتي/فيديو', `${sourcePicker(this, 'fmx-stt-src', ['audio', 'video'], { accept: 'audio/*,video/*' })}<div class="gh-row">${select('fmx-stt-flang', 'لغة الكلام', [['auto', 'تلقائي']].concat(LANGS), 'auto')}<label class="gh-check"><input id="fmx-stt-ts" type="checkbox" checked> طوابع زمنية</label>${pbtn('fa-file-lines', 'تفريغ', 'app.fmxTranscribeFile()')}</div>
                <div class="text-dim">Whisper المحلي يتطلب WebAssembly وهو محظور بسياسة الأمان، لذلك يتم التفريغ بنموذج صوتي عبر OpenRouter (مقاطع 45 ثانية).</div><div id="fmx-stt-progress"></div>`, 'fa-file-audio');
    };
    P.fmxDictate = function () {
        if (this._fmxDict) return this._fmxDict;
        const ta = document.getElementById('fmx-stt-text');
        this._fmxDict = listen({ lang: val('fmx-stt-lang') || 'ar-SA', onText: (fin, tmp) => { if (fin && ta) ta.value = (ta.value ? ta.value + ' ' : '') + fin; out('fmx-stt-interim', esc(tmp)); }, onError: (e) => { this.showToast('🎙️ ' + (e.message || e.error || 'خطأ'), 'warning'); this._fmxDict = null; }, onEnd: () => { this._fmxDict = null; } });
        return this._fmxDict;
    };
    P.fmxDictateStop = function () { if (this._fmxDict) this._fmxDict.stop(); this._fmxDict = null; };
    P.fmxSTTSave = async function () { const t = val('fmx-stt-text'); if (!t) return null; const p = this.uniqueProjectPath('transcript.md'); this.writeProjectFile(p, t); this.showToast('💾 ' + p, 'success'); return p; };
    P.fmxSTTToChat = function () { const t = val('fmx-stt-text'); const input = document.getElementById('user-input'); if (t && input) { input.value = t; input.focus(); if (this.closeModals) this.closeModals(); } return t; };
    P.fmxTranscribeFile = async function (src) {
        const [f] = await readSources(this, src || 'fmx-stt-src');
        if (!f) { this.showToast('اختر ملفاً', 'warning'); return null; }
        try {
            const r = await transcribeAudio(this, f.bytes, { lang: (val('fmx-stt-flang') || 'auto').slice(0, 2), onProgress: (d, t) => prog('fmx-stt-progress', d, t, '📝') });
            if (!r) return null;
            prog('fmx-stt-progress', 1, 1, '✅');
            const ta = document.getElementById('fmx-stt-text');
            const text = segmentsToText(r.segments, { times: val('fmx-stt-ts') !== false });
            if (ta) ta.value = text;
            return { ...r, formatted: text };
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };

    // ================================================================ WALKIE-TALKIE (#653)
    P.fmxWalkie = function () {
        this._fmxTalk = this._fmxTalk || [];
        return card('مكالمة صوتية مع الذكاء (Walkie-Talkie)', `<div class="text-dim">اضغط مطولاً على الزر وتحدث، ثم اترك — يرد عليك المساعد صوتياً. أو فعّل «بدون يدين» للمحادثة المستمرة.</div>
            <div class="gh-row"><button id="fmx-ptt" class="fmx-ptt" onpointerdown="app.fmxTalkDown()" onpointerup="app.fmxTalkUp()" onpointerleave="app.fmxTalkUp()"><i class="fa-solid fa-microphone"></i><span>اضغط للتحدث</span></button></div>
            <div class="gh-row">${select('fmx-talk-lang', 'اللغة', LANGS, 'ar-SA')}${select('fmx-talk-voice', 'صوت الرد', [['browser', 'صوت المتصفح (فوري)']].concat(AI_VOICES.map(v => [v, 'AI: ' + v])), 'browser')}${btn('fa-hands', 'بدون يدين', 'app.fmxHandsFree()')}${btn('fa-trash', 'مسح', 'app.fmxTalkClear()')}</div>
            <div id="fmx-talk-log" class="fmx-talk-log">${this.fmxTalkHTML()}</div>`, 'fa-walkie-talkie');
    };
    P.fmxTalkHTML = function () { return (this._fmxTalk || []).map(m => `<div class="fmx-talk ${m.role}" dir="auto"><b>${m.role === 'user' ? '🧑' : '🤖'}</b> ${esc(m.text)}</div>`).join('') || '<div class="text-dim">لا محادثة بعد</div>'; };
    P.fmxTalkClear = function () { this._fmxTalk = []; out('fmx-talk-log', this.fmxTalkHTML()); };
    P.fmxTalkDown = async function () {
        if (this._fmxPtt || !hasKey(this)) return;
        try { this._fmxPtt = await recordMic(); const b = document.getElementById('fmx-ptt'); if (b) b.classList.add('on'); } catch (e) { this.showToast('🎙️ ' + e.message, 'error'); }
    };
    P.fmxTalkUp = async function () {
        const rec = this._fmxPtt;
        if (!rec) return null;
        this._fmxPtt = null;
        const b = document.getElementById('fmx-ptt'); if (b) b.classList.remove('on');
        const blob = await rec.stop();
        if (Date.now() - rec.started < 400) return null;
        const a = await decodeAudio(blob);
        return this.fmxTalkTurn({ wav: encodeWAV([toMono(a.channels, a.sampleRate, 16000)], 16000) });
    };
    /** One conversational turn: {wav} (audio question) or {text}. Returns the reply text. */
    P.fmxTalkTurn = async function ({ wav, text } = {}) {
        const lang = val('fmx-talk-lang') || 'ar-SA';
        const hist = (this._fmxTalk || []).slice(-10).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n');
        const sys = `You are a friendly voice assistant inside a developer workbench, in a live spoken conversation. Reply in ${langEn(lang)} unless the user speaks another language. Keep replies short (1-3 sentences), natural for speech, no markdown, no code blocks.`;
        let user = text, reply;
        if (wav) {
            const r = await chatParts(this, [textPart(`${hist ? 'Conversation so far:\n' + hist + '\n\n' : ''}The user just said the attached audio. Return JSON only: {"heard":"exact transcript of the user's audio","reply":"your spoken reply"}`), audioPart(wav)], { system: sys, maxTokens: 600 });
            if (r == null) return null;
            await aiReady(this);
            const j = this.extractJSON ? this.extractJSON(r) : null;
            user = (j && j.heard) || '🎙️'; reply = (j && j.reply) || r;
        } else {
            reply = await this.aiRun(`${hist ? hist + '\n' : ''}User: ${text}\nAssistant:`, { system: sys, kind: 'general', maxTokens: 400, source: 'fmx-talk' });
            if (reply == null) return null;
        }
        this._fmxTalk.push({ role: 'user', text: user }, { role: 'assistant', text: reply.trim() });
        out('fmx-talk-log', this.fmxTalkHTML());
        await this.fmxSay(reply.trim(), lang, val('fmx-talk-voice'));
        return reply.trim();
    };
    P.fmxSay = function (text, lang, voice) {
        return new Promise(async (res) => {
            if (!voice || voice === 'browser') { if (!speak(text, { lang, onend: res })) res(); return; }
            try { const r = await aiSpeech(this, text, { voice }); if (!r) return res(); const a = new (W().Audio)(W().URL.createObjectURL(makeBlob([r.wav], 'audio/wav'))); this._fmxAudioEl = a; a.onended = res; a.play().catch(res); } catch (e) { res(); }
        });
    };
    P.fmxHandsFree = function () {
        if (this._fmxHF) { this._fmxHF.stop(); this._fmxHF = null; this.showToast('⏹️ أوقفت المحادثة المستمرة', 'info'); return null; }
        let busy = false;
        this._fmxHF = listen({ lang: val('fmx-talk-lang') || 'ar-SA', interim: false, onText: async (fin) => { if (!fin || busy) return; busy = true; try { await this.fmxTalkTurn({ text: fin }); } finally { busy = false; } }, onError: (e) => this.showToast('🎙️ ' + (e.message || e.error), 'warning') });
        if (this._fmxHF) this.showToast('🎧 المحادثة المستمرة تعمل — تكلّم بحرية', 'success');
        return this._fmxHF;
    };

    // ================================================================ LIVE TRANSLATION (#654)
    P.fmxLiveTranslate = function () {
        return card('ترجمة فورية أثناء الكلام', `<div class="fmx-grid4">${select('fmx-lt-from', 'من', LANGS, 'ar-SA')}${select('fmx-lt-to', 'إلى', LANGS, 'en-US')}<label class="gh-check"><input id="fmx-lt-speak" type="checkbox" checked> نطق الترجمة</label><label class="gh-check"><input id="fmx-lt-both" type="checkbox"> محادثة ثنائية (تبادل تلقائي)</label></div>
            <div class="gh-row">${pbtn('fa-language', 'ابدأ', 'app.fmxLiveTranslateStart()')}${btn('fa-stop', 'إيقاف', 'app.fmxLiveTranslateStop()')}${btn('fa-right-left', 'تبديل', 'app.fmxLiveSwap()')}</div>
            <div id="fmx-lt-interim" class="text-dim"></div><div id="fmx-lt-log" class="fmx-talk-log"></div>`, 'fa-language');
    };
    P.fmxLiveSwap = function () { const a = document.getElementById('fmx-lt-from'), b = document.getElementById('fmx-lt-to'); if (a && b) { const t = a.value; a.value = b.value; b.value = t; } if (this._fmxLT) { this.fmxLiveTranslateStop(); this.fmxLiveTranslateStart(); } };
    P.fmxTranslateLine = async function (text, from, to) {
        const t = await this.aiRun(`Translate this spoken ${langEn(from)} sentence into natural ${langEn(to)}. Return only the translation.\n\n${text}`, { kind: 'general', maxTokens: 500, source: 'fmx-live' });
        if (t == null) return null;
        const log = document.getElementById('fmx-lt-log');
        if (log) log.insertAdjacentHTML('afterbegin', `<div class="fmx-talk"><div dir="auto" class="text-dim">${esc(text)}</div><div dir="auto"><b>${esc(t.trim())}</b></div></div>`);
        if (val('fmx-lt-speak') !== false) await new Promise(res => { if (!speak(t.trim(), { lang: to, onend: res })) res(); });
        return t.trim();
    };
    P.fmxLiveTranslateStart = function () {
        if (this._fmxLT || !hasKey(this)) return this._fmxLT || null;
        const from = val('fmx-lt-from') || 'ar-SA', to = val('fmx-lt-to') || 'en-US';
        this._fmxLT = listen({ lang: from, onText: async (fin, tmp) => { out('fmx-lt-interim', esc(tmp)); if (!fin) return; await this.fmxTranslateLine(fin, from, to); if (val('fmx-lt-both')) this.fmxLiveSwap(); }, onError: (e) => { this.showToast('🎙️ ' + (e.message || e.error), 'warning'); this._fmxLT = null; } });
        return this._fmxLT;
    };
    P.fmxLiveTranslateStop = function () { if (this._fmxLT) this._fmxLT.stop(); this._fmxLT = null; };

    // ================================================================ VOICE COMMANDS (#655)
    P.fmxVoiceCommands = function () {
        return card('أوامر صوتية', `<div class="gh-row">${select('fmx-vc-lang', 'اللغة', [['ar-SA', 'العربية'], ['en-US', 'English']], 'ar-SA')}${pbtn('fa-microphone', this._fmxVC ? 'إيقاف الاستماع' : 'ابدأ الاستماع', 'app.fmxVoiceToggle()')}</div>
            <div class="gh-row">${field('fmx-vc-test', 'جرّب كتابةً', '', 'dir="auto" placeholder="افتح ملف index.html"')}${btn('fa-play', 'نفّذ', 'app.fmxVoiceExec(document.getElementById(\'fmx-vc-test\').value)')}</div>
            <div id="fmx-vc-last" class="text-dim"></div>
            <div class="fmx-card-h">الأوامر المدعومة</div>${VOICE_COMMANDS.map(([a, , ex]) => `<span class="gh-chip" data-vc="${a}">«${esc(ex)}»</span>`).join(' ')}`, 'fa-microphone-lines');
    };
    P.fmxVoiceToggle = function () {
        if (this._fmxVC) { this._fmxVC.stop(); this._fmxVC = null; this.showToast('🔇 أُوقفت الأوامر الصوتية', 'info'); return null; }
        this._fmxVC = listen({ lang: val('fmx-vc-lang') || 'ar-SA', interim: false, onText: (fin) => { if (fin) this.fmxVoiceExec(fin); }, onError: (e) => { this.showToast('🎙️ ' + (e.message || e.error), 'warning'); this._fmxVC = null; } });
        if (this._fmxVC) this.showToast('🎙️ أستمع للأوامر…', 'success');
        return this._fmxVC;
    };
    P.fmxVoiceExec = function (text) {
        const c = parseVoiceCommand(text, this.projectPaths());
        out('fmx-vc-last', `«${esc(text)}» → <b>${esc(c.action)}</b> ${esc(String(c.arg || ''))}`);
        const ensureStudio = () => { if (!this.isCodeStudioOpen && this.toggleCodeStudio) this.toggleCodeStudio(); };
        switch (c.action) {
            case 'open': ensureStudio(); this.openProjectFile(c.arg); break;
            case 'line': { ensureStudio(); const ta = document.getElementById('studio-editor-textarea'); if (ta) { const lines = ta.value.split('\n'), pos = lines.slice(0, Math.max(0, c.arg - 1)).reduce((n, l) => n + l.length + 1, 0); ta.focus(); ta.setSelectionRange(pos, pos); ta.scrollTop = Math.max(0, (c.arg - 5) * 18); } break; }
            case 'search': this.openFilesHub('smart', 'search').then(() => { const i = document.getElementById('fmx-sem-q'); if (i) i.value = c.arg; }); break;
            case 'ask': if (this.closeModals) this.closeModals(); this.sendUserMessage(c.arg); break;
            case 'save': if (this.commitStudioFile) this.showToast('💾 الملفات تُحفظ تلقائياً', 'info'); break;
            case 'run': ensureStudio(); if (this.runStudioCode) this.runStudioCode(); break;
            case 'commit': if (this.commitStudioFile) this.commitStudioFile(); break;
            case 'theme': this.toggleTheme(); break;
            case 'palette': if (this.closeModals) this.closeModals(); this.openCommandPalette(); break;
            case 'studio': ensureStudio(); break;
            case 'newfile': if (c.arg) { const p = this.uniqueProjectPath(c.arg.replace(/\s*(dot|نقطة)\s*/g, '.').replace(/\s+/g, '-')); this.writeProjectFile(p, ''); ensureStudio(); this.openProjectFile(p); } else this.newProjectFileDialog(); break;
            case 'github': if (this.closeModals) this.closeModals(); this.openGitHubHub(); break;
            case 'media': this.openFilesHub(); break;
            case 'stop': if (this._fmxVC) this.fmxVoiceToggle(); stopSpeaking(); break;
            default: this.showToast('🤔 ' + esc(c.reason || 'لم أفهم الأمر: ' + text), 'warning');
        }
        return c;
    };

    // ================================================================ COACH (#707 #708 #709 #710)
    const PROG_KEY = 'ox_fmx_lang_progress_v1';
    P.fmxCoach = function () {
        const p = lsGet(PROG_KEY, { sessions: 0, total: 0, best: 0, history: [] });
        return card('مدرب النطق', `<div class="fmx-grid4">${select('fmx-co-lang', 'اللغة', LANGS, 'en-US')}${select('fmx-co-level', 'المستوى', [['A1', 'مبتدئ A1'], ['A2', 'A2'], ['B1', 'متوسط B1'], ['B2', 'B2'], ['C1', 'متقدم C1']], 'A2')}${field('fmx-co-topic', 'الموضوع', 'البرمجة', 'dir="auto"')}${btn('fa-wand-magic-sparkles', 'جمل تدريب', 'app.fmxCoachLesson()')}</div>
                ${area('fmx-co-target', 'الجملة المستهدفة', 'Clean code is easy to read and simple to change.', 2, 'dir="auto"')}
                <div class="gh-row">${btn('fa-volume-high', 'استمع للنطق الصحيح', 'app.fmxCoachHear()')}${pbtn('fa-microphone', 'انطقها الآن', 'app.fmxCoachTry()')}${btn('fa-user-graduate', 'تقييم معمّق بالذكاء', 'app.fmxCoachDeep()')}</div>
                <div id="fmx-co-lesson"></div><div id="fmx-co-result"></div>
                <div class="text-dim" id="fmx-co-progress">📈 ${p.sessions} محاولة • متوسط ${p.sessions ? Math.round(p.total / p.sessions) : 0}% • أفضل ${p.best}%</div>`, 'fa-graduation-cap')
            + card('اختبار اللهجة', `<div class="text-dim">سجّل 15-30 ثانية من الكلام الحر بأي لغة — يقدّر الذكاء اللهجة/المنطقة ومميزاتها (تقدير وليس حكماً).</div><div class="gh-row">${pbtn('fa-microphone', 'ابدأ/أوقف التسجيل', 'app.fmxAccentRecord()')}<span id="fmx-ac-state" class="text-dim"></span></div><div id="fmx-ac-result"></div>`, 'fa-earth-africa');
    };
    P.fmxCoachLesson = async function () {
        const r = await this.aiJSON(`Create a pronunciation lesson in ${langEn(val('fmx-co-lang'))} at CEFR level ${val('fmx-co-level')} about "${val('fmx-co-topic')}". Return {"sentences":[5 natural sentences],"tips":["2 short pronunciation tips in Arabic"]}`, { kind: 'general', maxTokens: 700, source: 'fmx-coach' });
        if (!r || !r.sentences) return null;
        this._fmxLesson = r.sentences;
        out('fmx-co-lesson', `<div class="fmx-lesson">${r.sentences.map((s, i) => `<button class="gh-chip" dir="auto" onclick="${call('fmxCoachPick', i)}">${esc(s)}</button>`).join('')}</div>${(r.tips || []).map(t => `<div class="text-dim">💡 ${esc(t)}</div>`).join('')}`);
        this.fmxCoachPick(0);
        return r;
    };
    P.fmxCoachPick = function (i) { const ta = document.getElementById('fmx-co-target'); if (ta && this._fmxLesson) ta.value = this._fmxLesson[i]; };
    P.fmxCoachHear = function (word) { return speak(word || val('fmx-co-target'), { lang: val('fmx-co-lang') || 'en-US', rate: word ? 0.7 : 0.9 }); };
    /** Score a heard transcript against the target (#707) and show corrections (#708). */
    P.fmxCoachScore = function (heard, target = val('fmx-co-target')) {
        const r = alignWords(target, heard);
        const p = lsGet(PROG_KEY, { sessions: 0, total: 0, best: 0, history: [] });
        p.sessions++; p.total += r.score; p.best = Math.max(p.best, r.score); p.history = [{ t: Date.now(), score: r.score, lang: val('fmx-co-lang') }].concat(p.history).slice(0, 100);
        lsSet(PROG_KEY, p);
        const grade = r.score >= 90 ? '🌟 ممتاز' : r.score >= 70 ? '👍 جيد' : r.score >= 50 ? '🙂 مقبول' : '💪 حاول مجدداً';
        out('fmx-co-result', `<div class="fmx-score"><b>${r.score}%</b> ${grade}</div><div class="fmx-words" dir="auto">${r.words.map(w => w.ok ? `<span class="ok">${esc(w.word)}</span>` : `<button class="bad" title="${w.heard ? 'سُمعت: ' + esc(w.heard) : 'لم تُسمع'}" onclick="${call('fmxCoachHear', w.word)}">${esc(w.word)}</button>`).join(' ')}</div><div class="text-dim">سمعتُ: «${esc(heard)}» — اضغط أي كلمة حمراء لسماع نطقها ببطء.</div>`);
        out('fmx-co-progress', `📈 ${p.sessions} محاولة • متوسط ${Math.round(p.total / p.sessions)}% • أفضل ${p.best}%`);
        return r;
    };
    P.fmxCoachTry = function () {
        let done = false;
        out('fmx-co-result', '<div class="gh-empty"><span class="live-step-spinner"></span> أستمع…</div>');
        const l = listen({ lang: val('fmx-co-lang') || 'en-US', continuous: false, interim: false, onText: (fin) => { if (fin && !done) { done = true; this.fmxCoachScore(fin); } }, onEnd: () => { if (!done) out('fmx-co-result', empty('لم أسمع شيئاً — حاول مجدداً')); }, onError: (e) => out('fmx-co-result', empty('🎙️ ' + esc(e.message || e.error || ''), true)) });
        return l;
    };
    P.fmxCoachDeep = async function () {
        if (this._fmxCoRec) {
            const blob = await this._fmxCoRec.stop(); this._fmxCoRec = null;
            const a = await decodeAudio(blob);
            const r = await chatParts(this, [textPart(`The learner tried to say (in ${langEn(val('fmx-co-lang'))}): "${val('fmx-co-target')}". Evaluate their pronunciation from the audio. Return JSON only: {"score":0-100,"heard":"what you heard","issues":[{"word":"…","problem":"short explanation in Arabic","tip":"how to fix in Arabic"}],"summary":"one encouraging sentence in Arabic"}`), audioPart(encodeWAV([toMono(a.channels, a.sampleRate, 16000)], 16000))], { maxTokens: 900 });
            await aiReady(this);
            const j = r && this.extractJSON ? this.extractJSON(r) : null;
            if (!j) { out('fmx-co-result', empty('تعذر التقييم', true)); return null; }
            out('fmx-co-result', `<div class="fmx-score"><b>${esc(j.score)}%</b> ${esc(j.summary || '')}</div>${(j.issues || []).map(x => `<div class="gh-item static"><button class="gh-chip" onclick="${call('fmxCoachHear', x.word)}">🔊 ${esc(x.word)}</button><div class="gh-item-main"><b>${esc(x.problem)}</b><small>${esc(x.tip)}</small></div></div>`).join('') || '<div class="text-dim">لا ملاحظات — نطق ممتاز!</div>'}`);
            return j;
        }
        if (!hasKey(this)) return null;
        this._fmxCoRec = await recordMic();
        out('fmx-co-result', '<div class="gh-empty">🔴 يسجّل — انطق الجملة ثم اضغط «تقييم معمّق» مرة أخرى</div>');
        return true;
    };
    P.fmxAccentRecord = async function () {
        if (this._fmxAcRec) {
            const blob = await this._fmxAcRec.stop(); this._fmxAcRec = null; out('fmx-ac-state', '');
            return this.fmxAccentAnalyze(blob);
        }
        if (!hasKey(this)) return null;
        this._fmxAcRec = await recordMic();
        out('fmx-ac-state', '🔴 يسجّل…');
        return true;
    };
    P.fmxAccentAnalyze = async function (blob) {
        const a = await decodeAudio(blob);
        const r = await chatParts(this, [textPart('Listen to this speaker. Estimate their language, dialect/accent and likely region. Return JSON only: {"language":"…","accent":"…","region":"…","confidence":0-100,"features":["short notes in Arabic about pronunciation features"],"tips":["tips in Arabic to sound more neutral/standard"]}'), audioPart(encodeWAV([toMono(a.channels, a.sampleRate, 16000).subarray(0, 16000 * 40)], 16000))], { maxTokens: 700 });
        await aiReady(this);
        const j = r && this.extractJSON ? this.extractJSON(r) : null;
        if (!j) { out('fmx-ac-result', empty('تعذر التحليل', true)); return null; }
        out('fmx-ac-result', `<div class="fmx-score"><b>${esc(j.accent)}</b> — ${esc(j.region)} (${esc(j.language)}) • ثقة ${esc(j.confidence)}%</div>${(j.features || []).map(f => `<div>• ${esc(f)}</div>`).join('')}${(j.tips || []).map(f => `<div class="text-dim">💡 ${esc(f)}</div>`).join('')}`);
        return j;
    };

    // ================================================================ SPEECH ANALYSIS (#701 #702 #703 #706)
    P.fmxSpeechAnalysis = function () {
        return card('تحليل الكلام', `${sourcePicker(this, 'fmx-sa-src', ['audio', 'video'], { accept: 'audio/*,video/*' })}
            <div class="gh-row">${pbtn('fa-chart-simple', 'تحليل شامل', 'app.fmxAnalyzeSpeech()')}${btn('fa-gauge', 'سرعة الكلام فقط (محلي)', 'app.fmxAnalyzeSpeech(null,{local:true})')}</div>
            <div class="text-dim">محلياً: سرعة الكلام، الوقفات، طبقة الصوت وتنوعها. بالذكاء: اللغة، المتحدثون (Diarization)، المشاعر لكل مقطع.</div><div id="fmx-sa-progress"></div><div id="fmx-sa-result"></div>`, 'fa-chart-simple');
    };
    P.fmxAnalyzeSpeech = async function (src, { local = false } = {}) {
        const [f] = await readSources(this, src || 'fmx-sa-src');
        if (!f) { this.showToast('اختر ملفاً', 'warning'); return null; }
        try {
            let r = null, mono;
            if (!local && hasKey(this, true)) r = await transcribeAudio(this, f.bytes, { diarize: true, onProgress: (d, t) => prog('fmx-sa-progress', d, t, '🧠') });
            if (r) mono = r.mono; else { const a = await decodeAudio(f.bytes); mono = toMono(a.channels, a.sampleRate, 16000); }
            const st = speechStats(mono, 16000, r ? r.text : ''), pr = prosody(mono.subarray(0, 16000 * 120), 16000);
            const segs = r ? r.segments : [];
            const speakers = {}, emotions = {};
            segs.forEach(s => { const sp = s.speaker || '—'; speakers[sp] = (speakers[sp] || 0) + Math.max(0, s.end - s.start); if (s.emotion) emotions[s.emotion] = (emotions[s.emotion] || 0) + 1; });
            const colors = ['#38bdf8', '#f472b6', '#a3e635', '#fbbf24', '#c084fc', '#fb923c'], spk = Object.keys(speakers);
            const EMO = { neutral: '😐 محايد', happy: '😊 سعيد', sad: '😢 حزين', angry: '😠 غاضب', fearful: '😨 خائف', surprised: '😮 متفاجئ', excited: '🤩 متحمس', calm: '😌 هادئ' };
            prog('fmx-sa-progress', 1, 1, '✅');
            out('fmx-sa-result', `<div class="fmx-stats"><div><b>${fmtTime(st.duration)}</b><small>المدة</small></div><div><b>${fmtTime(st.speakingSec)}</b><small>وقت الكلام</small></div><div><b>${st.wpm || '—'}</b><small>كلمة/دقيقة (${paceLabel(st.wpm)})</small></div><div><b>${st.pauses}</b><small>وقفات (متوسط ${st.avgPause.toFixed(1)}ث)</small></div><div><b>${pr.pitch || '—'} Hz</b><small>طبقة الصوت</small></div><div><b>${pr.variation}%</b><small>تنوع النبرة ${pr.variation < 10 ? '(رتيب)' : pr.variation > 25 ? '(معبّر)' : ''}</small></div>${r ? `<div><b>${esc(langName(r.language))}</b><small>اللغة المكتشفة</small></div><div><b>${spk.length}</b><small>متحدثون</small></div>` : ''}</div>
                ${r ? `<div class="fmx-card-h">المتحدثون</div><div class="fmx-diar">${segs.map(s => `<span title="${esc((s.speaker || '') + ': ' + s.text)}" style="left:${s.start / st.duration * 100}%;width:${Math.max(0.4, (s.end - s.start) / st.duration * 100)}%;background:${colors[spk.indexOf(s.speaker || '—') % colors.length]}"></span>`).join('')}</div>
                <div class="gh-row">${spk.map((s, i) => `<span class="gh-chip" style="border-color:${colors[i % colors.length]}">${esc(s)} • ${fmtTime(speakers[s])}</span>`).join('')}</div>
                <div class="fmx-card-h">المشاعر</div><div class="gh-row">${Object.entries(emotions).sort((a, b) => b[1] - a[1]).map(([e, n]) => `<span class="gh-chip">${EMO[e] || esc(e)} × ${n}</span>`).join('') || '—'}</div>
                <div class="fmx-card-h">النص</div><div class="fmx-transcript">${segs.map(s => `<div dir="auto"><small>[${fmtTime(s.start)}] <b style="color:${colors[spk.indexOf(s.speaker || '—') % colors.length]}">${esc(s.speaker || '')}</b> ${s.emotion ? (EMO[s.emotion] || '').split(' ')[0] : ''}</small> ${esc(s.text)}</div>`).join('')}</div>` : '<div class="text-dim">أضف مفتاح OpenRouter لاكتشاف اللغة والمتحدثين والمشاعر.</div>'}`);
            return { stats: st, prosody: pr, ...(r || {}), speakers, emotions };
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };
}
