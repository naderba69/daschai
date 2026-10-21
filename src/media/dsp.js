/* Pure DSP used by the audio studio (no WebAudio needed → testable): edit ops, biquads, compressor, spectral noise reduction,
   granular pitch shift, centre-channel vocal isolation/removal, procedural SFX + music composer. */
import { fft, clamp } from './shared.js';

// ------------------------------------------------------------------ edit ops on [Float32Array] channels
export const sliceCh = (ch, a, b) => ch.map(c => c.slice(a, b));
export const cutCh = (ch, a, b) => ch.map(c => { const o = new Float32Array(c.length - (b - a)); o.set(c.subarray(0, a)); o.set(c.subarray(b), a); return o; });
export const insertCh = (ch, at, ins) => ch.map((c, k) => { const s = ins[k] || ins[0]; const o = new Float32Array(c.length + s.length); o.set(c.subarray(0, at)); o.set(s, at); o.set(c.subarray(at), at + s.length); return o; });
export const silenceCh = (ch, a, b) => ch.map(c => { const o = c.slice(); o.fill(0, a, b); return o; });
export const gainCh = (ch, a, b, g) => ch.map(c => { const o = c.slice(); for (let i = a; i < b; i++) o[i] = clamp(o[i] * g, -1, 1); return o; });
export const fadeCh = (ch, a, b, dir = 'in') => ch.map(c => { const o = c.slice(), n = Math.max(1, b - a); for (let i = a; i < b; i++) { const t = (i - a) / n; o[i] *= dir === 'in' ? t : 1 - t; } return o; });
export const reverseCh = (ch, a, b) => ch.map(c => { const o = c.slice(); o.subarray(a, b).reverse(); return o; });
export const peakOf = (ch, a = 0, b) => { let p = 0; ch.forEach(c => { for (let i = a; i < (b == null ? c.length : b); i++) p = Math.max(p, Math.abs(c[i])); }); return p; };
export const normalizeCh = (ch, a, b, target = 0.98) => { const p = peakOf(ch, a, b); return p ? gainCh(ch, a, b, target / p) : ch; };
export const speedCh = (ch, factor) => ch.map(c => { const n = Math.floor(c.length / factor), o = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i * factor, i0 = Math.floor(x), f = x - i0; o[i] = c[i0] * (1 - f) + (c[i0 + 1] || 0) * f; } return o; });
export const rms = (s) => { let e = 0; for (let i = 0; i < s.length; i++) e += s[i] * s[i]; return Math.sqrt(e / Math.max(1, s.length)); };

// ------------------------------------------------------------------ filters (RBJ cookbook biquads)
export function biquad(samples, rate, type, freq, q = 0.707, gainDb = 0) {
    const w = 2 * Math.PI * freq / rate, cs = Math.cos(w), sn = Math.sin(w), alpha = sn / (2 * q), A = Math.pow(10, gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lowpass') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; }
    else if (type === 'highpass') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; }
    else if (type === 'bandpass') { b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; }
    else { b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A; } // peaking
    const out = new Float32Array(samples.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < samples.length; i++) { const x = samples[i]; const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; out[i] = y; x2 = x1; x1 = x; y2 = y1; y1 = y; }
    return out;
}
export function compress(samples, rate, { threshold = -20, ratio = 3, attack = 0.005, release = 0.1, makeup = 0 } = {}) {
    const out = new Float32Array(samples.length), ga = Math.exp(-1 / (attack * rate)), gr = Math.exp(-1 / (release * rate)), mk = Math.pow(10, makeup / 20);
    let env = 0;
    for (let i = 0; i < samples.length; i++) {
        const x = Math.abs(samples[i]); env = x > env ? ga * env + (1 - ga) * x : gr * env + (1 - gr) * x;
        const db = 20 * Math.log10(env + 1e-9), over = db - threshold, g = over > 0 ? Math.pow(10, -(over - over / ratio) / 20) : 1;
        out[i] = clamp(samples[i] * g * mk, -1, 1);
    }
    return out;
}
/** Voice clarity (#705): rumble cut, mud cut, presence + air boost, compression, normalise. */
export function enhanceVoice(samples, rate) {
    let s = biquad(samples, rate, 'highpass', 85, 0.7);
    s = biquad(s, rate, 'peaking', 300, 1, -3);
    s = biquad(s, rate, 'peaking', 3200, 1, 4);
    s = biquad(s, rate, 'peaking', 9000, 0.8, 2);
    s = compress(s, rate, { threshold: -22, ratio: 3, makeup: 4 });
    return normalizeCh([s], 0, s.length, 0.95)[0];
}
/** Spectral-subtraction noise reduction (#685). Noise profile = quietest 10% frames (or the first noiseSec). */
export function denoise(input, rate, { strength = 1.5, floor = 0.08, noiseSec = 0 } = {}) {
    const N = 1024, H = 256, win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    if (input.length < 2 * N) return input.slice();
    // Reflect-pad by N at both ends so every original sample is covered by the full overlap (no edge blow-up).
    const len = input.length, samples = new Float32Array(len + 2 * N);
    samples.set(input, N);
    for (let i = 0; i < N; i++) { samples[N - 1 - i] = input[Math.min(len - 1, i + 1)]; samples[N + len + i] = input[Math.max(0, len - 2 - i)]; }
    const frames = [];
    for (let p = 0; p + N <= samples.length; p += H) frames.push(p);
    if (!frames.length) return samples.slice();
    const mags = [], specs = [];
    for (const p of frames) {
        const re = new Float32Array(N), im = new Float32Array(N);
        for (let i = 0; i < N; i++) re[i] = samples[p + i] * win[i];
        fft(re, im);
        const m = new Float32Array(N / 2 + 1);
        for (let k = 0; k <= N / 2; k++) m[k] = Math.hypot(re[k], im[k]);
        mags.push(m); specs.push([re, im]);
    }
    const energy = mags.map(m => m.reduce((a, b) => a + b, 0));
    let pick = noiseSec ? frames.map((p, i) => i).filter(i => frames[i] >= N - H && frames[i] + N <= N + noiseSec * rate + H) : [];
    if (!pick.length) pick = energy.map((e, i) => [e, i]).sort((a, b) => a[0] - b[0]).slice(0, Math.max(1, Math.floor(frames.length / 10))).map(x => x[1]);
    const noise = new Float32Array(N / 2 + 1);
    pick.forEach(i => mags[i].forEach((v, k) => { noise[k] += v / pick.length; }));
    const out = new Float32Array(samples.length), norm = new Float32Array(samples.length);
    frames.forEach((p, f) => {
        const [re, im] = specs[f], m = mags[f];
        for (let k = 0; k <= N / 2; k++) {
            const g = Math.max(floor, (m[k] - strength * noise[k]) / (m[k] + 1e-9));
            re[k] *= g; im[k] *= g;
            if (k && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; }
        }
        fft(re, im, true);
        for (let i = 0; i < N; i++) { out[p + i] += re[i] * win[i]; norm[p + i] += win[i] * win[i]; }
    });
    const res = new Float32Array(len);
    for (let i = 0; i < len; i++) { const j = i + N; res[i] = norm[j] > 1e-3 ? out[j] / norm[j] : samples[j] * floor; }
    return res;
}
/** Granular pitch shift keeping duration (#686). factor > 1 = higher. */
export function pitchShift(samples, rate, factor, grainSec = 0.04) {
    const g = Math.max(64, Math.round(grainSec * rate)), hop = g >> 1, out = new Float32Array(samples.length);
    const w = new Float32Array(g).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / g));
    for (let pos = 0; pos < samples.length; pos += hop) {
        for (let i = 0; i < g && pos + i < out.length; i++) {
            const x = pos + i * factor, i0 = Math.floor(x), f = x - i0;
            const v = (samples[i0] || 0) * (1 - f) + (samples[i0 + 1] || 0) * f;
            out[pos + i] += v * w[i];
        }
    }
    return out;
}
export const VOICES = {
    man: { label: '👨 رجل', pitch: 0.78, eq: [['peaking', 180, 1, 3]] },
    woman: { label: '👩 امرأة', pitch: 1.3, eq: [['peaking', 2800, 1, 2]] },
    child: { label: '🧒 طفل', pitch: 1.6, eq: [['highpass', 250, 0.7, 0], ['peaking', 3500, 1, 3]] },
    giant: { label: '👹 عملاق', pitch: 0.6, eq: [['lowpass', 3000, 0.7, 0]] },
    chipmunk: { label: '🐿️ سنجاب', pitch: 1.9, eq: [] },
    robot: { label: '🤖 روبوت', pitch: 1, ring: 60, eq: [] },
    radio: { label: '📻 راديو', pitch: 1, eq: [['highpass', 400, 0.8, 0], ['lowpass', 3200, 0.8, 0]], drive: 2.5 },
    echo: { label: '🏔️ صدى', pitch: 1, echo: [0.28, 0.45], eq: [] }
};
export function voiceChange(samples, rate, preset) {
    const p = VOICES[preset] || VOICES.man;
    let s = p.pitch !== 1 ? pitchShift(samples, rate, p.pitch) : samples.slice();
    p.eq.forEach(([t, f, q, g]) => { s = biquad(s, rate, t, f, q, g); });
    if (p.ring) for (let i = 0; i < s.length; i++) s[i] *= Math.sin(2 * Math.PI * p.ring * i / rate);
    if (p.drive) for (let i = 0; i < s.length; i++) s[i] = Math.tanh(s[i] * p.drive) / Math.tanh(p.drive);
    if (p.echo) { const d = Math.round(p.echo[0] * rate); for (let i = d; i < s.length; i++) s[i] += s[i - d] * p.echo[1]; }
    return normalizeCh([s], 0, s.length, 0.95)[0];
}
/** Centre-channel extraction (#704): vocals ≈ mid minus side energy; instrumental = L−R (karaoke). */
export function separateStereo(L, R, rate) {
    const n = Math.min(L.length, R.length), mid = new Float32Array(n), side = new Float32Array(n);
    for (let i = 0; i < n; i++) { mid[i] = (L[i] + R[i]) / 2; side[i] = (L[i] - R[i]) / 2; }
    const vocals = biquad(biquad(mid, rate, 'highpass', 150, 0.7), rate, 'lowpass', 7000, 0.7);
    for (let i = 0; i < n; i++) vocals[i] -= side[i] * 0.5;
    return { vocals: normalizeCh([vocals], 0, n)[0], instrumental: normalizeCh([side], 0, n)[0] };
}
/** Speech band isolation for mono recordings (speech vs background). */
export const speechBand = (s, rate) => normalizeCh([biquad(biquad(s, rate, 'highpass', 250, 0.7), rate, 'lowpass', 3800, 0.7)], 0, s.length)[0];

// ------------------------------------------------------------------ procedural SFX (#688) + library (#681)
const rng = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const env = (i, n, a = 0.01, r = 0.3) => { const t = i / n; return t < a ? t / a : Math.pow(1 - (t - a) / (1 - a), 1 + r * 4); };
export const SFX = {
    beep: { label: 'صفارة', cat: 'واجهة', dur: 0.25, fn: (t, i, n) => Math.sin(2 * Math.PI * 880 * t) * env(i, n, 0.02, 0.1) },
    click: { label: 'نقرة', cat: 'واجهة', dur: 0.05, fn: (t, i, n, r) => (r() * 2 - 1) * Math.exp(-i / (n * 0.08)) },
    pop: { label: 'فقاعة', cat: 'واجهة', dur: 0.12, fn: (t, i, n) => Math.sin(2 * Math.PI * (400 + 1400 * (1 - i / n)) * t) * env(i, n, 0.01, 0.6) },
    success: { label: 'نجاح', cat: 'واجهة', dur: 0.6, fn: (t) => { const f = t < 0.15 ? 523 : t < 0.3 ? 659 : 784; return Math.sin(2 * Math.PI * f * t) * Math.exp(-((t % 0.15) * 6)) * 0.8; } },
    error: { label: 'خطأ', cat: 'واجهة', dur: 0.45, fn: (t) => Math.sign(Math.sin(2 * Math.PI * (t < 0.2 ? 220 : 180) * t)) * 0.35 * (t % 0.22 < 0.18 ? 1 : 0) },
    notify: { label: 'إشعار', cat: 'واجهة', dur: 0.8, fn: (t) => (Math.sin(2 * Math.PI * 1046 * t) + 0.5 * Math.sin(2 * Math.PI * 1568 * t)) * Math.exp(-t * 5) * 0.6 },
    coin: { label: 'عملة', cat: 'ألعاب', dur: 0.4, fn: (t) => Math.sign(Math.sin(2 * Math.PI * (t < 0.08 ? 988 : 1319) * t)) * 0.3 * Math.exp(-t * 6) },
    laser: { label: 'ليزر', cat: 'ألعاب', dur: 0.35, fn: (t, i, n) => Math.sign(Math.sin(2 * Math.PI * (1800 - 1500 * i / n) * t)) * 0.35 * env(i, n, 0.01, 0.2) },
    jump: { label: 'قفزة', cat: 'ألعاب', dur: 0.3, fn: (t, i, n) => Math.sin(2 * Math.PI * (300 + 600 * i / n) * t) * env(i, n, 0.01, 0.3) },
    powerup: { label: 'تقوية', cat: 'ألعاب', dur: 0.8, fn: (t, i, n) => Math.sign(Math.sin(2 * Math.PI * (300 + 900 * (i / n) + 80 * Math.sin(t * 60)) * t)) * 0.25 * env(i, n, 0.02, 0.1) },
    explosion: { label: 'انفجار', cat: 'ألعاب', dur: 1.4, noise: true, lp: 900, fn: (t, i, n, r) => (r() * 2 - 1) * Math.exp(-t * 3) },
    whoosh: { label: 'اندفاع', cat: 'انتقالات', dur: 0.8, noise: true, bp: [600, 2.5], fn: (t, i, n, r) => (r() * 2 - 1) * Math.sin(Math.PI * i / n) },
    swoosh: { label: 'انزلاق', cat: 'انتقالات', dur: 0.5, noise: true, hp: 2000, fn: (t, i, n, r) => (r() * 2 - 1) * Math.sin(Math.PI * i / n) * 0.7 },
    riser: { label: 'تصاعد', cat: 'انتقالات', dur: 2, fn: (t, i, n, r) => (Math.sin(2 * Math.PI * (200 + 1200 * (i / n) ** 2) * t) * 0.5 + (r() * 2 - 1) * 0.2 * i / n) * (i / n) },
    rain: { label: 'مطر', cat: 'طبيعة', dur: 4, noise: true, lp: 6000, hp: 400, fn: (t, i, n, r) => (r() * 2 - 1) * 0.5 * (r() > 0.997 ? 3 : 1) },
    wind: { label: 'رياح', cat: 'طبيعة', dur: 4, noise: true, bp: [500, 0.8], fn: (t, i, n, r) => (r() * 2 - 1) * (0.6 + 0.4 * Math.sin(t * 1.3)) },
    thunder: { label: 'رعد', cat: 'طبيعة', dur: 3, noise: true, lp: 300, fn: (t, i, n, r) => (r() * 2 - 1) * Math.exp(-t * 1.2) * (1 + Math.sin(t * 9) * 0.5) },
    heartbeat: { label: 'نبض قلب', cat: 'طبيعة', dur: 2, fn: (t) => { const p = t % 1; return Math.sin(2 * Math.PI * 55 * t) * (Math.exp(-((p - 0.05) ** 2) * 3000) + 0.7 * Math.exp(-((p - 0.3) ** 2) * 3000)); } },
    typing: { label: 'كتابة', cat: 'مكتب', dur: 2, fn: (t, i, n, r) => { const k = (t * 9) % 1; return k < 0.02 ? (r() * 2 - 1) * (1 - k / 0.02) : 0; } },
    bell: { label: 'جرس', cat: 'مكتب', dur: 2, fn: (t) => [1, 2.76, 5.4].reduce((a, h, j) => a + Math.sin(2 * Math.PI * 660 * h * t) * Math.exp(-t * (2 + j * 2)) / (j + 1), 0) * 0.5 },
    camera: { label: 'كاميرا', cat: 'مكتب', dur: 0.3, fn: (t, i, n, r) => (r() * 2 - 1) * (t < 0.04 || (t > 0.12 && t < 0.16) ? 1 : 0) * 0.8 },
    footstep: { label: 'خطوات', cat: 'حركة', dur: 2, noise: true, lp: 500, fn: (t, i, n, r) => { const k = (t * 2) % 1; return (r() * 2 - 1) * Math.exp(-k * 25); } },
    door: { label: 'باب', cat: 'حركة', dur: 0.9, fn: (t, i, n, r) => Math.sin(2 * Math.PI * (90 + 40 * Math.sin(t * 30)) * t) * Math.exp(-t * 4) + (t < 0.03 ? (r() * 2 - 1) : 0) },
    applause: { label: 'تصفيق', cat: 'حركة', dur: 3, noise: true, bp: [2000, 1], fn: (t, i, n, r) => (r() > 0.6 ? (r() * 2 - 1) : 0) * Math.sin(Math.PI * i / n) }
};
export function synthSFX(name, rate = 44100, { pitch = 1, duration, seed = 7 } = {}) {
    const d = SFX[name];
    if (!d) throw new Error('unknown sfx ' + name);
    const dur = duration || d.dur, n = Math.round(dur * rate), r = rng(seed);
    let s = new Float32Array(n);
    for (let i = 0; i < n; i++) s[i] = d.fn((i / rate) * pitch, i, n, r);
    if (d.lp) s = biquad(s, rate, 'lowpass', d.lp, 0.7);
    if (d.hp) s = biquad(s, rate, 'highpass', d.hp, 0.7);
    if (d.bp) s = biquad(s, rate, 'bandpass', d.bp[0] * pitch, d.bp[1]);
    return normalizeCh([s], 0, n, 0.9)[0];
}
/** Parametric SFX from an AI-designed recipe: {dur, tone:{wave,f0,f1}, noise:{amount,filter,freq}, env:{a,r}, tremolo} */
export function synthRecipe(rec, rate = 44100) {
    const dur = clamp(+rec.dur || 1, 0.05, 8), n = Math.round(dur * rate), r = rng(3), s = new Float32Array(n);
    const t0 = rec.tone || {}, nz = rec.noise || {}, e = rec.env || {}, wave = { sine: Math.sin, square: (x) => Math.sign(Math.sin(x)), saw: (x) => 2 * ((x / (2 * Math.PI)) % 1) - 1, triangle: (x) => 2 * Math.abs(2 * ((x / (2 * Math.PI)) % 1) - 1) - 1 }[t0.wave] || Math.sin;
    let ph = 0;
    for (let i = 0; i < n; i++) {
        const k = i / n, f = (+t0.f0 || 440) * Math.pow((+t0.f1 || +t0.f0 || 440) / (+t0.f0 || 440), k);
        ph += 2 * Math.PI * f / rate;
        const trem = rec.tremolo ? 1 - 0.5 * (1 + Math.sin(2 * Math.PI * rec.tremolo * i / rate)) * 0.5 : 1;
        s[i] = ((t0.amount != null ? +t0.amount : 1) * wave(ph) + (+nz.amount || 0) * (r() * 2 - 1)) * env(i, n, +e.a || 0.01, +e.r || 0.3) * trem;
    }
    const out = nz.filter && nz.freq ? biquad(s, rate, nz.filter, +nz.freq, 0.8) : s;
    return normalizeCh([out], 0, n, 0.9)[0];
}

// ------------------------------------------------------------------ procedural music composer (#687 #682)
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], hijaz: [0, 1, 4, 5, 7, 8, 10], pentatonic: [0, 2, 4, 7, 9] };
export const MUSIC_STYLES = {
    lofi: { label: 'Lo-fi هادئ', bpm: 78, mode: 'minor', prog: [1, 6, 3, 7], drums: 'lofi', lead: 'triangle', pad: 0.35, swing: 0.12 },
    upbeat: { label: 'مرح نشيط', bpm: 120, mode: 'major', prog: [1, 5, 6, 4], drums: 'pop', lead: 'square', pad: 0.25, swing: 0 },
    ambient: { label: 'أجواء Ambient', bpm: 64, mode: 'major', prog: [1, 4, 6, 5], drums: 'none', lead: 'sine', pad: 0.6, swing: 0 },
    cinematic: { label: 'سينمائي ملحمي', bpm: 90, mode: 'minor', prog: [1, 6, 4, 5], drums: 'epic', lead: 'saw', pad: 0.5, swing: 0 },
    oriental: { label: 'شرقي (حجاز)', bpm: 100, mode: 'hijaz', prog: [1, 2, 1, 7], drums: 'darbuka', lead: 'saw', pad: 0.2, swing: 0.05 },
    corporate: { label: 'إعلاني', bpm: 110, mode: 'major', prog: [1, 5, 4, 5], drums: 'pop', lead: 'triangle', pad: 0.3, swing: 0 },
    hiphop: { label: 'Hip-hop (للراب)', bpm: 90, mode: 'minor', prog: [1, 1, 6, 7], drums: 'hiphop', lead: 'sine', pad: 0.2, swing: 0.15 }
};
const freqOf = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
export function composeMusic({ style = 'lofi', bpm, key = 'A', mode, bars = 8, seed = 42, rate = 44100, prog, density = 0.6 } = {}) {
    const S = MUSIC_STYLES[style] || MUSIC_STYLES.lofi, tempo = bpm || S.bpm, scale = SCALES[mode || S.mode] || SCALES.minor, root = 57 + (NOTE[key] != null ? NOTE[key] : 0) - 9;
    const beat = 60 / tempo, barLen = beat * 4, n = Math.ceil(bars * barLen * rate) + rate, out = new Float32Array(n), r = rng(seed);
    const P = prog || S.prog, deg = (d, oct = 0) => { const i = ((d - 1) % scale.length + scale.length) % scale.length; return root + scale[i] + 12 * (oct + Math.floor((d - 1) / scale.length)); };
    const osc = { sine: (p) => Math.sin(p), triangle: (p) => 2 * Math.abs(2 * ((p / (2 * Math.PI)) % 1) - 1) - 1, square: (p) => (Math.sin(p) > 0 ? 0.6 : -0.6), saw: (p) => 2 * ((p / (2 * Math.PI)) % 1) - 1 };
    const note = (t, dur, f, amp, wave = 'sine', a = 0.01, rel = 0.2) => { const s0 = Math.floor(t * rate), len = Math.floor((dur + rel) * rate); for (let i = 0; i < len && s0 + i < n; i++) { const tt = i / rate, e = tt < a ? tt / a : tt < dur ? 1 : Math.max(0, 1 - (tt - dur) / rel); out[s0 + i] += osc[wave](2 * Math.PI * f * tt) * amp * e; } };
    const kick = (t) => { const s0 = Math.floor(t * rate); for (let i = 0; i < 0.3 * rate && s0 + i < n; i++) { const tt = i / rate; out[s0 + i] += Math.sin(2 * Math.PI * (50 + 100 * Math.exp(-tt * 30)) * tt) * Math.exp(-tt * 9) * 0.9; } };
    const snare = (t, amp = 0.35) => { const s0 = Math.floor(t * rate); for (let i = 0; i < 0.2 * rate && s0 + i < n; i++) { const tt = i / rate; out[s0 + i] += ((r() * 2 - 1) * 0.8 + Math.sin(2 * Math.PI * 190 * tt) * 0.3) * Math.exp(-tt * 18) * amp; } };
    const hat = (t, amp = 0.12) => { const s0 = Math.floor(t * rate); let prev = 0; for (let i = 0; i < 0.05 * rate && s0 + i < n; i++) { const x = r() * 2 - 1; out[s0 + i] += (x - prev) * Math.exp(-i / rate * 70) * amp; prev = x; } };
    const doum = (t) => { const s0 = Math.floor(t * rate); for (let i = 0; i < 0.35 * rate && s0 + i < n; i++) { const tt = i / rate; out[s0 + i] += Math.sin(2 * Math.PI * (80 + 40 * Math.exp(-tt * 20)) * tt) * Math.exp(-tt * 7) * 0.8; } };
    const tek = (t) => { const s0 = Math.floor(t * rate); for (let i = 0; i < 0.08 * rate && s0 + i < n; i++) { const tt = i / rate; out[s0 + i] += (Math.sin(2 * Math.PI * 900 * tt) * 0.4 + (r() * 2 - 1) * 0.3) * Math.exp(-tt * 45) * 0.5; } };
    let melodyDeg = 5;
    for (let b = 0; b < bars; b++) {
        const t0 = b * barLen, chord = P[b % P.length];
        [chord, chord + 2, chord + 4].forEach(d => note(t0, barLen * 0.95, freqOf(deg(d)), 0.07 * S.pad / 0.3, 'triangle', 0.3, 0.6));
        for (let q = 0; q < 4; q++) note(t0 + q * beat, beat * 0.8, freqOf(deg(chord, -1)), 0.18, 'sine', 0.01, 0.05);
        for (let e = 0; e < 8; e++) {
            const t = t0 + e * beat / 2 + (e % 2 ? S.swing * beat : 0);
            if (r() < density) { melodyDeg += Math.round((r() - 0.5) * 4); melodyDeg = clamp(melodyDeg, 1, 10); if (e % 4 === 0) melodyDeg = chord + [0, 2, 4][Math.floor(r() * 3)]; note(t, beat * (r() < 0.3 ? 0.9 : 0.42), freqOf(deg(melodyDeg, 1)), 0.09, S.lead, 0.01, 0.15); }
            if (S.drums === 'none') continue;
            if (S.drums === 'darbuka') { if (e === 0 || e === 3) doum(t); else if (e === 2 || e === 4 || e === 6 || e === 7) tek(t); continue; }
            if (e === 0 || (S.drums !== 'lofi' && e === 4) || (S.drums === 'hiphop' && e === 5) || (S.drums === 'epic' && e === 6)) kick(t);
            if (e === 2 || e === 6) snare(t, S.drums === 'lofi' ? 0.22 : 0.35);
            hat(t, S.drums === 'lofi' ? 0.06 : 0.1);
        }
    }
    let s = biquad(out, rate, 'lowpass', style === 'lofi' ? 5000 : 12000, 0.7);
    s = compress(s, rate, { threshold: -14, ratio: 2.5, makeup: 2 });
    const fadeN = Math.min(s.length, rate);
    for (let i = 0; i < fadeN; i++) s[s.length - 1 - i] *= i / fadeN;
    return { samples: normalizeCh([s], 0, s.length, 0.9)[0], rate, bpm: tempo, beat, bars };
}
/** LRC lyrics ↔ cues */
export function parseLRC(text) {
    const out = [];
    String(text).split('\n').forEach(l => { const tags = Array.from(l.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)); const txt = l.replace(/\[[^\]]*\]/g, '').trim(); tags.forEach(m => out.push({ t: +m[1] * 60 + +m[2], text: txt })); });
    return out.sort((a, b) => a.t - b.t);
}
export const toLRC = (lines) => lines.map(l => `[${String(Math.floor(l.t / 60)).padStart(2, '0')}:${(l.t % 60).toFixed(2).padStart(5, '0')}]${l.text}`).join('\n');
