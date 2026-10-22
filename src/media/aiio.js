/* AI + speech I/O used by every media tool: OpenRouter Image API, audio-capable chat (input_audio),
   PDF-as-file chat, Web Speech (TTS / recognition), audio decode → mono WAV. All honest: no key → null + toast. */
import { win, b64ToBytes, bytesToB64, encodeWAV, blobBytes, makeBlob, AR_RE } from './shared.js';

export const IMAGE_MODEL = 'google/gemini-2.5-flash-image';
export const AUDIO_MODEL = 'google/gemini-2.5-flash';
const BASE = 'https://openrouter.ai/api/v1';

const headers = (app) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${String(app.settings.apiKey || '').trim()}`, 'HTTP-Referer': (typeof location !== 'undefined' && location.origin) || 'https://daschai.vercel.app', 'X-Title': 'OX-Alpha Workbench Pro' });
/** Helpers like extractJSON / aiProjectContext live in the lazy AI chunk — make sure it is installed. */
export async function aiReady(app) {
    if ((!app.extractJSON || !app.aiProjectContext) && app.loadChunk) { try { await app.loadChunk('ai'); } catch (e) { /* offline build without the AI chunk */ } }
    return app;
}
export const hasKey = (app, quiet = false) => {
    const ok = !!String((app.settings && app.settings.apiKey) || '').trim();
    if (!ok && !quiet) app.showToast('يلزم مفتاح OpenRouter في الإعدادات لهذه الأداة', 'warning');
    return ok;
};

/** POST /api/v1/images → [{bytes, mime}] */
export async function generateImages(app, { prompt, refs = [], aspect = '1:1', resolution = '1K', n = 1, model, background, format } = {}) {
    if (!hasKey(app)) return null;
    const body = { model: model || app.settings.imageModel || IMAGE_MODEL, prompt, n: Math.max(1, Math.min(4, n)) };
    if (aspect && aspect !== 'auto') body.aspect_ratio = aspect;
    if (resolution) body.resolution = resolution;
    if (background) body.background = background;
    if (format) body.output_format = format;
    if (refs.length) body.input_references = refs.slice(0, 4).map(url => ({ type: 'image_url', image_url: { url } }));
    const res = await fetch(`${BASE}/images`, { method: 'POST', headers: headers(app), body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j.error && j.error.message) || j.message || `HTTP ${res.status}`);
    if (app.recordUsage && j.usage) try { app.recordUsage({ model: body.model, usage: j.usage, promptChars: prompt.length, completionChars: 0, durationMs: 0, source: 'image-gen' }); } catch (e) {}
    return (j.data || []).map(d => ({ bytes: b64ToBytes(d.b64_json || ''), mime: d.media_type || 'image/png' })).filter(x => x.bytes.length);
}

/** Chat with arbitrary content parts (audio / file / image). Returns text or null without a key. */
export async function chatParts(app, parts, { system, model, maxTokens = 2500, onDelta } = {}) {
    if (!hasKey(app)) return null;
    const messages = (system ? [{ role: 'system', content: system }] : []).concat([{ role: 'user', content: parts }]);
    const useModel = model || app.settings.audioModel || AUDIO_MODEL;
    const r = await app.streamOpenRouter({ model: useModel, messages, maxTokens, onDelta });
    if (app.recordUsage) try { app.recordUsage({ model: useModel, usage: r.usage, promptChars: 1000, completionChars: (r.content || '').length, durationMs: r.durationMs || 0, source: 'media' }); } catch (e) {}
    return r.content || '';
}
export const audioPart = (wavBytes, format = 'wav') => ({ type: 'input_audio', input_audio: { data: bytesToB64(wavBytes), format } });
export const filePart = (name, bytes, mime = 'application/pdf') => ({ type: 'file', file: { filename: name, file_data: `data:${mime};base64,${bytesToB64(bytes)}` } });
export const textPart = (text) => ({ type: 'text', text });

/** Decode any browser-playable audio/video blob → {sampleRate, channels[]} via WebAudio. */
export async function decodeAudio(blobOrBytes) {
    const W = win(), AC = W.AudioContext || W.webkitAudioContext;
    if (!AC) throw new Error('المتصفح لا يدعم Web Audio');
    const bytes = blobOrBytes instanceof Uint8Array ? blobOrBytes : await blobBytes(blobOrBytes);
    const ctx = new AC();
    try {
        const buf = await ctx.decodeAudioData(bytes.slice().buffer);
        return { sampleRate: buf.sampleRate, channels: Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i).slice()) };
    } finally { try { ctx.close(); } catch (e) {} }
}
/** Mix to mono and resample (linear) → Float32Array */
export function toMono(channels, fromRate, toRate = fromRate) {
    const n = channels[0].length, mono = new Float32Array(n);
    for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / channels.length;
    if (toRate === fromRate) return mono;
    const ratio = fromRate / toRate, out = new Float32Array(Math.floor(n / ratio));
    for (let i = 0; i < out.length; i++) { const x = i * ratio, i0 = Math.floor(x), f = x - i0; out[i] = mono[i0] * (1 - f) + (mono[i0 + 1] || 0) * f; }
    return out;
}
/** Any audio → 16 kHz mono WAV bytes (what audio models want), capped at maxSec. */
export async function toSpeechWav(blob, maxSec = 600) {
    const a = await decodeAudio(blob);
    const mono = toMono(a.channels, a.sampleRate, 16000);
    return encodeWAV([mono.subarray(0, maxSec * 16000)], 16000);
}

// ------------------------------------------------------------------ Web Speech
export const speechSupported = () => { const W = win(); return { tts: !!W.speechSynthesis, stt: !!(W.SpeechRecognition || W.webkitSpeechRecognition) }; };
export function listVoices() { const W = win(); try { return W.speechSynthesis ? W.speechSynthesis.getVoices() : []; } catch (e) { return []; } }
export function speak(text, { lang, rate = 1, pitch = 1, voice, volume = 1, onend, onboundary } = {}) {
    const W = win();
    if (!W.speechSynthesis || !W.SpeechSynthesisUtterance) { if (onend) onend(); return null; }
    const u = new W.SpeechSynthesisUtterance(String(text || '').slice(0, 30000));
    u.lang = lang || (AR_RE.test(text) ? 'ar-SA' : 'en-US');
    u.rate = rate; u.pitch = pitch; u.volume = volume;
    if (voice) { const v = listVoices().find(x => x.voiceURI === voice || x.name === voice); if (v) { u.voice = v; u.lang = v.lang; } }
    if (onend) u.onend = onend;
    if (onboundary) u.onboundary = onboundary;
    W.speechSynthesis.speak(u);
    return u;
}
export function stopSpeaking() { try { win().speechSynthesis.cancel(); } catch (e) {} }
/** Continuous recognition helper → {stop()}; onText(final, interim) */
export function listen({ lang = 'ar-SA', continuous = true, interim = true, onText, onEnd, onError } = {}) {
    const W = win(), SR = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!SR) { if (onError) onError(new Error('التعرف على الكلام غير مدعوم في هذا المتصفح — جرّب Chrome أو Edge')); return null; }
    const r = new SR();
    r.lang = lang; r.continuous = continuous; r.interimResults = interim;
    let stopped = false;
    r.onresult = (ev) => {
        let fin = '', tmp = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) { const res = ev.results[i]; if (res.isFinal) fin += res[0].transcript; else tmp += res[0].transcript; }
        if (onText) onText(fin.trim(), tmp.trim(), ev);
    };
    r.onerror = (e) => { if (onError) onError(e); };
    r.onend = () => { if (!stopped && continuous) { try { r.start(); return; } catch (e) {} } if (onEnd) onEnd(); };
    try { r.start(); } catch (e) { if (onError) onError(e); return null; }
    return { stop() { stopped = true; try { r.stop(); } catch (e) {} }, rec: r };
}

/** Record mic (or a given stream) → Promise<Blob> controller. */
export async function recordMic({ stream } = {}) {
    const W = win();
    const s = stream || await W.navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'].find(m => W.MediaRecorder && W.MediaRecorder.isTypeSupported && W.MediaRecorder.isTypeSupported(m)) || '';
    const rec = new W.MediaRecorder(s, mime ? { mimeType: mime } : undefined), chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.start(250);
    const t0 = Date.now();
    return {
        stream: s, rec, started: t0,
        stop: () => new Promise(res => { rec.onstop = () => { if (!stream) s.getTracks().forEach(t => t.stop()); res(makeBlob(chunks, rec.mimeType || mime || 'audio/webm')); }; try { rec.stop(); } catch (e) { res(makeBlob(chunks, 'audio/webm')); } })
    };
}

// ------------------------------------------------------------------ AI speech (audio output models, streamed pcm16)
export const SPEECH_MODEL = 'openai/gpt-4o-audio-preview';
export const AI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];
/** Split long text at sentence boundaries into ≤max-char chunks. */
export function splitSentences(text, max = 1200) {
    const parts = String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?؟。!،\n])\s+/);
    const out = []; let cur = '';
    for (const p of parts) { if ((cur + ' ' + p).length > max && cur) { out.push(cur.trim()); cur = p; } else cur += ' ' + p; }
    if (cur.trim()) out.push(cur.trim());
    return out.flatMap(c => (c.length <= max ? [c] : c.match(new RegExp(`.{1,${max}}`, 'g'))));
}
/** Parse an OpenRouter SSE stream collecting delta.audio.data / transcript. */
export async function readAudioStream(res) {
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '', b64 = '', transcript = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith('data:')) continue;
            const d = t.slice(5).trim();
            if (d === '[DONE]') continue;
            try { const j = JSON.parse(d); if (j.error) throw new Error(j.error.message || 'provider error'); const a = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.audio; if (a && a.data) b64 += a.data; if (a && a.transcript) transcript += a.transcript; } catch (e) { if (/provider|error/i.test(e.message)) throw e; }
        }
    }
    return { b64, transcript };
}
/** PCM16 (24 kHz mono) or WAV bytes → Float32 samples + rate */
export function pcmToFloat(bytes, rate = 24000) {
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) { const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); rate = v.getUint32(24, true); bytes = bytes.subarray(44); }
    const n = bytes.length >> 1, out = new Float32Array(n), v = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
    for (let i = 0; i < n; i++) out[i] = v.getInt16(i * 2, true) / 0x8000;
    return { samples: out, rate };
}
/** Text → WAV via an audio-output model. Returns {wav, samples, rate, transcript} or null without a key. */
export async function aiSpeech(app, text, { voice = 'alloy', model, style = '', onProgress } = {}) {
    if (!hasKey(app)) return null;
    const chunks = splitSentences(text, 1200), all = [];
    let rate = 24000, transcript = '';
    for (let i = 0; i < chunks.length; i++) {
        const res = await fetch(`${BASE}/chat/completions`, { method: 'POST', headers: headers(app), body: JSON.stringify({
            model: model || app.settings.speechModel || SPEECH_MODEL, stream: true, modalities: ['text', 'audio'], audio: { voice, format: 'pcm16' },
            messages: [{ role: 'system', content: `You are a professional voice actor and text-to-speech engine. Read the user's text aloud EXACTLY as written (verbatim, same language, no additions, no answers).${style ? ' Delivery: ' + style : ''}` }, { role: 'user', content: chunks[i] }] }) });
        if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error((j.error && j.error.message) || `HTTP ${res.status}`); }
        const r = await readAudioStream(res);
        const p = pcmToFloat(b64ToBytes(r.b64 || ''), 24000);
        rate = p.rate; all.push(p.samples); transcript += r.transcript;
        if (onProgress) onProgress(i + 1, chunks.length);
    }
    const len = all.reduce((n, a) => n + a.length, 0), samples = new Float32Array(len);
    let o = 0; all.forEach(a => { samples.set(a, o); o += a.length; });
    return { wav: encodeWAV([samples], rate), samples, rate, transcript };
}
/** Concatenate [{samples, rate}] with gaps (seconds) → WAV (resamples to the first rate). */
export function concatAudio(parts, gap = 0.35) {
    const rate = (parts[0] && parts[0].rate) || 24000;
    const res = parts.map(p => (p.rate === rate ? p.samples : toMono([p.samples], p.rate, rate)));
    const g = Math.round(gap * rate), len = res.reduce((n, s) => n + s.length + g, 0), out = new Float32Array(len);
    let o = 0; res.forEach(s => { out.set(s, o); o += s.length + g; });
    return { samples: out, rate, wav: encodeWAV([out], rate), offsets: res.reduce((acc, s, i) => { acc.push(i ? acc[i - 1] + (res[i - 1].length + g) / rate : 0); return acc; }, []) };
}
