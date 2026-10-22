/* Creative production: talking avatar (#711) + avatar video explaining code (#714), podcast from an article (#715), audiobook (#716),
   news bulletin (#717), advert (#718), comic (#719), children's book (#720). Built on aiSpeech + generateImages + fmxRenderCanvas.
   Deepfakes of real people (#712) and voice cloning (#713) are intentionally not implemented. */
import { esc, btn, pbtn, card, empty, field, area, select, clamp, fmtTime, makeBlob, blobBytes, bytesToDataUrl, newCanvas, canvasToBlob, val, win, isTextEntry, stemOf } from './shared.js';
import { sourcePicker, readSources } from './core.js';
import { aiReady, hasKey, aiSpeech, concatAudio, generateImages, AI_VOICES } from './aiio.js';
import { composeMusic } from './dsp.js';
import { tokenizeLine } from './video.js';
import { loadPdfLib } from './convert.js';

// ------------------------------------------------------------------ pure helpers
/** Per-video-frame loudness (0..1) for lip-sync. */
export function envelope(samples, rate, fps = 30) {
    const hop = Math.max(1, Math.round(rate / fps)), out = [];
    let peak = 1e-6;
    for (let o = 0; o < samples.length; o += hop) { let e = 0; const end = Math.min(samples.length, o + hop); for (let i = o; i < end; i++) e += samples[i] * samples[i]; const v = Math.sqrt(e / Math.max(1, end - o)); out.push(v); peak = Math.max(peak, v); }
    return out.map(v => clamp(Math.pow(v / peak, 0.6) * 1.15, 0, 1));
}
/** Greedy word wrap with an injected measure(text) → width. */
export function wrapLines(text, maxW, measure) {
    const out = [];
    String(text || '').split('\n').forEach(par => {
        let line = '';
        par.split(/\s+/).filter(Boolean).forEach(w => { const t = line ? line + ' ' + w : w; if (measure(t) > maxW && line) { out.push(line); line = w; } else line = t; });
        out.push(line);
    });
    return out;
}
/** Comic page layout: n panels → rows of 2 (last row full width when odd). */
export function comicLayout(n, w, h, gap = 16) {
    const rows = Math.ceil(n / 2), rh = (h - gap * (rows + 1)) / rows, out = [];
    for (let i = 0; i < n; i++) { const r = Math.floor(i / 2), solo = i === n - 1 && n % 2 === 1, cw = solo ? w - 2 * gap : (w - 3 * gap) / 2; out.push({ x: gap + (solo ? 0 : (i % 2) * (cw + gap)), y: gap + r * (rh + gap), w: cw, h: rh }); }
    return out;
}
/** "Host A: …" lines → [{speaker, text}] (fallback when the model doesn't return JSON). */
export function parseDialogue(text, names = ['A', 'B']) {
    const out = [];
    String(text || '').split('\n').forEach(l => { const m = /^\s*\**([^:*]{1,30})\**\s*:\s*(.+)$/.exec(l); if (!m) return; const who = m[1].trim(); const idx = names.findIndex(n => who.toLowerCase().includes(String(n).toLowerCase())); out.push({ speaker: idx >= 0 ? idx : out.length % 2, name: who, text: m[2].trim() }); });
    return out;
}
/** Markdown/plain text → chapters [{title, text}] split on #/## headings (or ~1500-word blocks). */
export function chaptersOf(text, maxWords = 1500) {
    const out = []; let cur = null;
    String(text || '').split('\n').forEach(l => { const h = /^#{1,2}\s+(.+)/.exec(l); if (h) { if (cur && cur.text.trim()) out.push(cur); cur = { title: h[1].trim(), text: '' }; } else { cur = cur || { title: 'المقدمة', text: '' }; cur.text += l + '\n'; } });
    if (cur && cur.text.trim()) out.push(cur);
    return out.flatMap(c => { const w = c.text.split(/\s+/).filter(Boolean); if (w.length <= maxWords) return [{ title: c.title, text: c.text.trim() }]; const parts = []; for (let i = 0; i < w.length; i += maxWords) parts.push({ title: `${c.title} (${parts.length + 1})`, text: w.slice(i, i + maxWords).join(' ') }); return parts; });
}
const mdPlain = (s) => String(s || '').replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`~\[\]()!|-]+/g, ' ').replace(/\s+/g, ' ').trim();

export function installCreate(P) {
    const W = () => win();
    const out = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; return el; };
    const busy = (msg) => out('fmx-out', `<div class="gh-empty"><span class="live-step-spinner"></span> ${esc(msg)}</div>`);
    const loadImg = (blob) => new Promise((res, rej) => { const im = new (W().Image)(); im.onload = () => res(im); im.onerror = () => rej(new Error('تعذر تحميل الصورة')); im.src = W().URL.createObjectURL(blob); });
    const genImage = async (app, prompt, aspect = '1:1') => { try { const r = await generateImages(app, { prompt, aspect }); return r && r[0] ? makeBlob([r[0].bytes], r[0].mime) : null; } catch (e) { app.showToast('🖼️ ' + e.message, 'warning'); return null; } };
    const say = async (app, text, voice, style) => aiSpeech(app, text, { voice, style, onProgress: (i, n) => busy(`🎙️ ${i}/${n}`) });
    const wavOut = (app, mix, name, note) => app.fmxOutput(makeBlob([mix.wav], 'audio/wav'), name, { note: `${fmtTime(mix.samples.length / mix.rate)}${note ? ' • ' + note : ''}` });
    const mixMusic = (voice, style = 'ambient', vol = 0.12, intro = 2.5) => {
        const rate = voice.rate, n = voice.samples.length + Math.round((intro + 2) * rate);
        const m = composeMusic({ style, bars: Math.ceil(n / rate / (60 / 70 * 4)) + 1, rate, seed: 5, density: 0.3 }).samples, outS = new Float32Array(n), off = Math.round(intro * rate);
        for (let i = 0; i < n; i++) { const v = voice.samples[i - off] || 0, duck = i < off ? 1 : i > off + voice.samples.length ? 1 : vol / 0.5; outS[i] = (m[i] || 0) * 0.5 * duck + v; }
        let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(outS[i]));
        if (pk > 0.98) for (let i = 0; i < n; i++) outS[i] *= 0.98 / pk;
        return { samples: outS, rate, offset: intro };
    };
    const progressDiv = '<div id="fmx-vid-progress"></div>';

    // ================================================================ AVATAR (#711 #714)
    const drawCartoon = (ctx, w, h, mouth, blink, bob, color = '#38bdf8') => {
        const cx = w / 2, cy = h / 2 + Math.sin(bob) * 4, r = Math.min(w, h) * 0.32;
        ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(cx, cy + r * 1.35, r * 1.1, r * 0.6, 0, Math.PI, 0); ctx.fill();
        ctx.fillStyle = '#fcd9b6'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3b2a1a'; ctx.beginPath(); ctx.arc(cx, cy - r * 0.15, r * 1.02, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
        ctx.fillStyle = '#1e293b';
        [-1, 1].forEach(s => { ctx.beginPath(); ctx.ellipse(cx + s * r * 0.38, cy - r * 0.1, r * 0.09, blink ? r * 0.015 : r * 0.11, 0, 0, Math.PI * 2); ctx.fill(); });
        ctx.fillStyle = '#7f1d1d'; ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.45, r * (0.22 + mouth * 0.06), r * (0.04 + mouth * 0.2), 0, 0, Math.PI * 2); ctx.fill();
    };
    const avatarFrame = (state) => (ctx, x, y, w, h, t) => {
        const f = Math.min(state.env.length - 1, Math.floor(t * 30)), m = t < state.dur ? (state.env[f] || 0) : 0, blink = (t % 4) > 3.85;
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.translate(x, y);
        if (state.img) {
            const im = state.img, r = Math.max(w / im.width, h / im.height), dw = im.width * r, dh = im.height * r, bob = Math.sin(t * 1.7) * 3;
            ctx.drawImage(im, (w - dw) / 2, (h - dh) / 2 + bob, dw, dh);
            const mx = state.mouth.x * dw + (w - dw) / 2, my = state.mouth.y * dh + (h - dh) / 2 + bob, mw = dw * 0.06;
            ctx.fillStyle = 'rgba(60,10,10,.85)'; ctx.beginPath(); ctx.ellipse(mx, my, mw * (1 + m * 0.2), Math.max(1, mw * m * 0.7), 0, 0, Math.PI * 2); ctx.fill();
        } else drawCartoon(ctx, w, h, m, blink, t * 1.7, state.color);
        ctx.restore();
    };
    P.fmxAvatar = function () {
        const files = this.projectPaths().filter(p => isTextEntry(this.virtualProjectFiles.get(p)) && !/\.(md|txt|json|lock)$/i.test(p));
        return card('أفاتار متحدث', `${sourcePicker(this, 'fmx-av-img', ['image'], { label: 'صورة الأفاتار (اختياري — بدونها شخصية كرتونية)', accept: 'image/*' })}
            <div class="gh-row">${field('fmx-av-mx', 'موضع الفم X ٪', '50', 'type="number" min="0" max="100"')}${field('fmx-av-my', 'موضع الفم Y ٪', '72', 'type="number" min="0" max="100"')}${btn('fa-wand-magic-sparkles', 'ولّد صورة أفاتار', 'app.fmxAvatarGenerate()')}</div>
            ${area('fmx-av-text', 'ماذا يقول؟', 'مرحباً! أنا مساعدك في OX-Alpha. دعني أشرح لك كيف تعمل هذه الأداة.', 3, 'dir="auto"')}
            <div class="gh-row">${select('fmx-av-voice', 'الصوت', AI_VOICES.map(v => [v, v]), 'nova')}${pbtn('fa-user-astronaut', 'إنتاج الفيديو', 'app.fmxAvatarRun()')}</div>`, 'fa-user-astronaut')
            + card('فيديو أفاتار يشرح الكود', `<div class="gh-row">${select('fmx-avc-path', 'الملف', files.map(p => [p, p]), files.includes(this.activeStudioFile) ? this.activeStudioFile : files[0] || '')}${select('fmx-avc-lang', 'لغة الشرح', [['Arabic', 'العربية'], ['English', 'English'], ['French', 'Français']], 'Arabic')}${pbtn('fa-chalkboard-user', 'إنتاج الشرح', 'app.fmxAvatarCode()')}</div>
                <div class="text-dim">يكتب الذكاء نص الشرح مقسماً على أجزاء الكود، يُنطق بصوت AI، ويُعرض الكود مع إبراز الجزء المشروح بجانب الأفاتار. التصيير يتم بزمن حقيقي.</div>${progressDiv}<div id="fmx-out"></div>`, 'fa-chalkboard-user');
    };
    P.fmxAvatarGenerate = async function () {
        busy('🖼️ توليد صورة…');
        const b = await genImage(this, 'Friendly professional presenter avatar, head and shoulders portrait, facing camera, mouth closed, neutral background, soft studio light, illustration style', '1:1');
        if (!b) { out('fmx-out', ''); return null; }
        this._fmxAvImg = b;
        this.fmxOutput(b, 'avatar.png', { note: 'استُخدمت كصورة الأفاتار' });
        return b;
    };
    P._fmxAvatarState = async function (voice) {
        const [f] = await readSources(this, 'fmx-av-img');
        const blob = (f && f.blob) || this._fmxAvImg || null;
        return { img: blob ? await loadImg(blob) : null, mouth: { x: (+val('fmx-av-mx') || 50) / 100, y: (+val('fmx-av-my') || 72) / 100 }, env: envelope(voice.samples, voice.rate, 30), dur: voice.samples.length / voice.rate, color: '#38bdf8' };
    };
    P.fmxAvatarRun = async function (textArg) {
        const text = textArg || val('fmx-av-text');
        if (!text || !hasKey(this)) return null;
        try {
            const voice = await say(this, text, val('fmx-av-voice') || 'nova');
            if (!voice) return null;
            const st = await this._fmxAvatarState(voice), drawAv = avatarFrame(st);
            busy('🎬 تصيير…');
            const words = text.split(/\s+/);
            const r = await this.fmxRenderCanvas({ width: 720, height: 720, duration: st.dur + 0.4, audio: voice, draw: (ctx, t, w, h) => {
                drawAv(ctx, 0, 0, w, h, t);
                const k = Math.floor(clamp(t / st.dur, 0, 1) * words.length), cap = words.slice(Math.max(0, k - 6), k + 1).join(' ');
                ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, h - 80, w, 80); ctx.fillStyle = '#fff'; ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center'; ctx.direction = 'auto'; ctx.fillText(cap, w / 2, h - 32);
            } });
            this.fmxOutput(r.blob, 'avatar.webm', { note: fmtTime(r.duration) });
            return r;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };
    P.fmxAvatarCode = async function (pathArg) {
        const path = pathArg || val('fmx-avc-path'), e = this.virtualProjectFiles.get(path);
        if (!e || !isTextEntry(e) || !hasKey(this)) { if (!e) this.showToast('اختر ملف كود', 'warning'); return null; }
        const code = e.content.split('\n').slice(0, 160), numbered = code.map((l, i) => `${i + 1}: ${l}`).join('\n');
        busy('🧠 كتابة الشرح…');
        const plan = await this.aiJSON(`You are a friendly teacher recording a short video. Explain this file (${path}) in ${val('fmx-avc-lang') || 'Arabic'} in 4-7 steps, each covering a line range, 1-3 spoken sentences per step (no code symbols read aloud). Return {"steps":[{"from":1,"to":10,"say":"…"}]}\n\n${numbered}`, { kind: 'coding', maxTokens: 2000, source: 'fmx-avatar' });
        const steps = ((plan && plan.steps) || []).filter(s => s.say);
        if (!steps.length) { out('fmx-out', empty('تعذر إنشاء الخطة', true)); return null; }
        try {
            const parts = [];
            for (let i = 0; i < steps.length; i++) { busy(`🎙️ ${i + 1}/${steps.length}`); const v = await aiSpeech(this, steps[i].say, { voice: val('fmx-av-voice') || 'nova', style: 'clear, friendly teacher' }); if (!v) return null; parts.push(v); }
            const mix = concatAudio(parts, 0.5), st = await this._fmxAvatarState(mix), drawAv = avatarFrame(st);
            const starts = mix.offsets, total = mix.samples.length / mix.rate;
            busy('🎬 تصيير…');
            const r = await this.fmxRenderCanvas({ width: 1280, height: 720, duration: total + 0.5, audio: mix, draw: (ctx, t, w, h) => {
                let k = 0; starts.forEach((s, i) => { if (t >= s) k = i; });
                const s = steps[k], lh = 22, visible = Math.floor((h - 80) / lh), mid = Math.floor((s.from + s.to) / 2), first = clamp(mid - Math.floor(visible / 2), 0, Math.max(0, code.length - visible));
                ctx.fillStyle = '#1e1e1e'; ctx.fillRect(0, 0, w, h);
                ctx.font = '16px monospace'; ctx.textAlign = 'left'; ctx.direction = 'ltr';
                for (let i = 0; i < visible && first + i < code.length; i++) {
                    const n = first + i + 1, y = 40 + i * lh, on = n >= s.from && n <= s.to;
                    if (on) { ctx.fillStyle = 'rgba(56,189,248,.16)'; ctx.fillRect(0, y - 16, 860, lh); }
                    ctx.fillStyle = '#858585'; ctx.fillText(String(n).padStart(3), 10, y);
                    let x = 56; const toks = tokenizeLine(code[n - 1]);
                    toks.forEach(tk => { ctx.fillStyle = on ? tk.c : 'rgba(212,212,212,.45)'; ctx.fillText(tk.t, x, y); x += ctx.measureText(tk.t).width; });
                }
                drawAv(ctx, 880, 0, 400, 400, t);
                ctx.fillStyle = '#0b1220'; ctx.fillRect(880, 400, 400, 320); ctx.fillStyle = '#e2e8f0'; ctx.font = '20px sans-serif'; ctx.textAlign = 'right'; ctx.direction = 'rtl';
                wrapLines(s.say, 360, (x) => ctx.measureText(x).width).slice(0, 11).forEach((l, i) => ctx.fillText(l, 1260, 440 + i * 28));
                ctx.fillStyle = '#38bdf8'; ctx.fillRect(0, h - 4, w * clamp(t / total, 0, 1), 4);
            } });
            this.fmxOutput(r.blob, `${stemOf(path)}-explained.webm`, { note: `${steps.length} أجزاء • ${fmtTime(r.duration)}` });
            return { steps, ...r };
        } catch (err) { this.showToast('❌ ' + err.message, 'error'); return null; }
    };

    // ================================================================ PODCAST (#715)
    P.fmxPodcast = function () {
        return card('بودكاست من مقال', `${sourcePicker(this, 'fmx-pod-src', ['text'], { label: 'المقال (ملف نصي/Markdown)', accept: '.md,.txt,.html' })}${area('fmx-pod-text', 'أو الصق المقال', '', 5, 'dir="auto"')}
            <div class="fmx-grid4">${field('fmx-pod-a', 'المقدّم الأول', 'سارة')}${select('fmx-pod-va', 'صوته', AI_VOICES.map(v => [v, v]), 'nova')}${field('fmx-pod-b', 'المقدّم الثاني', 'أحمد')}${select('fmx-pod-vb', 'صوته', AI_VOICES.map(v => [v, v]), 'onyx')}</div>
            <div class="gh-row">${select('fmx-pod-len', 'الطول', [['short', '~2 دقيقة'], ['medium', '~5 دقائق'], ['long', '~10 دقائق']], 'short')}${select('fmx-pod-lang', 'اللغة', [['Arabic', 'العربية'], ['English', 'English'], ['French', 'Français']], 'Arabic')}<label class="gh-check"><input id="fmx-pod-music" type="checkbox" checked> موسيقى افتتاحية</label>${pbtn('fa-podcast', 'إنتاج البودكاست', 'app.fmxPodcastRun()')}</div><div id="fmx-pod-script"></div><div id="fmx-out"></div>`, 'fa-podcast');
    };
    const sourceText = async (app, srcId, areaId) => { const t = val(areaId); if (t && t.trim()) return t; const [f] = await readSources(app, srcId); return f ? new TextDecoder().decode(f.bytes).replace(/<[^>]+>/g, ' ') : ''; };
    P.fmxPodcastRun = async function (o = {}) {
        const text = o.text || await sourceText(this, 'fmx-pod-src', 'fmx-pod-text');
        if (!text.trim() || !hasKey(this)) { if (!text.trim()) this.showToast('أضف المقال', 'warning'); return null; }
        const A = o.a || val('fmx-pod-a') || 'سارة', B = o.b || val('fmx-pod-b') || 'أحمد', len = { short: 14, medium: 30, long: 60 }[o.len || val('fmx-pod-len') || 'short'];
        busy('🧠 كتابة الحوار…');
        const j = await this.aiJSON(`Turn this article into a lively two-host podcast dialogue in ${o.lang || val('fmx-pod-lang') || 'Arabic'} with about ${len} turns. Host "${A}" leads, host "${B}" asks smart questions and adds insights. Natural spoken style, short turns, a warm intro and outro, no stage directions. Return {"title":"…","lines":[{"speaker":"${A}","text":"…"}]}\n\nARTICLE:\n${text.slice(0, 20000)}`, { kind: 'general', maxTokens: 5000, source: 'fmx-podcast' });
        const lines = ((j && j.lines) || []).map(l => ({ speaker: l.speaker === B ? 1 : 0, name: l.speaker, text: l.text })).filter(l => l.text);
        if (!lines.length) { out('fmx-out', empty('تعذر كتابة الحوار', true)); return null; }
        out('fmx-pod-script', `<div class="fmx-transcript">${lines.map(l => `<div dir="auto"><b>${esc(l.name)}:</b> ${esc(l.text)}</div>`).join('')}</div>`);
        try {
            const voices = [o.va || val('fmx-pod-va') || 'nova', o.vb || val('fmx-pod-vb') || 'onyx'], parts = [];
            for (let i = 0; i < lines.length; i++) { busy(`🎙️ ${i + 1}/${lines.length}`); const v = await aiSpeech(this, lines[i].text, { voice: voices[lines[i].speaker], style: 'conversational podcast host, natural and engaging' }); if (!v) return null; parts.push(v); }
            let mix = concatAudio(parts, 0.3);
            if (o.music != null ? o.music : val('fmx-pod-music') !== false) { const m = mixMusic(mix, 'lofi', 0.1, 3); mix = { ...m, wav: concatAudio([m], 0).wav }; }
            wavOut(this, mix, `podcast-${String((j && j.title) || 'episode').slice(0, 30).replace(/[^\p{L}\p{N}]+/gu, '-')}.wav`, `${lines.length} مداخلة`);
            return { title: j.title, lines, ...mix };
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };

    // ================================================================ AUDIOBOOK (#716)
    P.fmxAudiobook = function () {
        return card('كتاب صوتي', `${sourcePicker(this, 'fmx-ab-src', ['text'], { label: 'الكتاب (Markdown/نص — الفصول بعناوين #)', accept: '.md,.txt' })}${area('fmx-ab-text', 'أو الصق النص', '', 5, 'dir="auto"')}
            <div class="gh-row">${select('fmx-ab-voice', 'الراوي', AI_VOICES.map(v => [v, v]), 'fable')}${select('fmx-ab-style', 'الأداء', [['warm, expressive audiobook narrator, measured pace', 'راوٍ دافئ'], ['calm, neutral, clear', 'هادئ محايد'], ['dramatic storyteller with character voices', 'درامي']], 'warm, expressive audiobook narrator, measured pace')}${btn('fa-list', 'معاينة الفصول', 'app.fmxAudiobookChapters()')}${pbtn('fa-book-open-reader', 'إنتاج', 'app.fmxAudiobookRun()')}</div><div id="fmx-ab-chapters"></div><div id="fmx-out"></div>`, 'fa-book-open-reader');
    };
    P.fmxAudiobookChapters = async function () {
        const ch = chaptersOf(await sourceText(this, 'fmx-ab-src', 'fmx-ab-text'));
        out('fmx-ab-chapters', ch.map((c, i) => `<div class="gh-item static"><b>${i + 1}.</b><div class="gh-item-main"><b dir="auto">${esc(c.title)}</b><small>${c.text.split(/\s+/).length} كلمة • ~${Math.ceil(c.text.split(/\s+/).length / 150)} د</small></div></div>`).join('') || empty('لا نص'));
        return ch;
    };
    P.fmxAudiobookRun = async function (textArg) {
        const ch = chaptersOf(textArg || await sourceText(this, 'fmx-ab-src', 'fmx-ab-text'));
        if (!ch.length || !hasKey(this)) return null;
        try {
            const parts = [];
            for (let i = 0; i < ch.length; i++) { busy(`📖 الفصل ${i + 1}/${ch.length}`); const v = await aiSpeech(this, `${ch[i].title}.\n\n${mdPlain(ch[i].text)}`, { voice: val('fmx-ab-voice') || 'fable', style: val('fmx-ab-style') }); if (!v) return null; parts.push(v); }
            const mix = concatAudio(parts, 1.5);
            const chapters = ch.map((c, i) => ({ title: c.title, start: +mix.offsets[i].toFixed(2) }));
            wavOut(this, mix, 'audiobook.wav', `${ch.length} فصول`);
            const el = document.getElementById('fmx-ab-chapters');
            if (el) el.innerHTML = `<div class="fmx-card-h">الفصول (للتنقل)</div>${chapters.map(c => `<div class="text-dim">${fmtTime(c.start)} — ${esc(c.title)}</div>`).join('')}`;
            this._fmxChapters = chapters;
            return { chapters, ...mix };
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };

    // ================================================================ NEWS (#717)
    P.fmxNews = function () {
        return card('نشرة أخبار', `<div class="gh-row">${select('fmx-news-src', 'المصدر', [['project', 'أخبار المشروع (الملفات وCHANGELOG)'], ['topics', 'عناوين أكتبها']], 'project')}${select('fmx-news-voice', 'المذيع', AI_VOICES.map(v => [v, v]), 'onyx')}${select('fmx-news-fmt', 'الناتج', [['audio', 'صوت'], ['video', 'فيديو مع شريط أخبار']], 'audio')}</div>
            ${area('fmx-news-topics', 'العناوين/الملاحظات', '', 3, 'dir="auto"')}<div class="gh-row">${pbtn('fa-newspaper', 'إنتاج النشرة', 'app.fmxNewsRun()')}</div>${progressDiv}<div id="fmx-out"></div>`, 'fa-newspaper');
    };
    P.fmxNewsRun = async function (o = {}) {
        if (!hasKey(this)) return null;
        const src = o.src || val('fmx-news-src') || 'project';
        let material = o.topics || val('fmx-news-topics') || '';
        if (src === 'project') {
            await aiReady(this);
            const cl = ['CHANGELOG.md', 'changelog.md', 'HISTORY.md'].map(p => this.virtualProjectFiles.get(p)).find(Boolean);
            material = `${this.aiProjectContext ? this.aiProjectContext({ maxChars: 6000 }) : ''}\n${cl ? 'CHANGELOG:\n' + cl.content.slice(0, 5000) : ''}\n${(this.fmxWatchLog || []).slice(0, 10).map(w => 'changed: ' + w.path).join('\n')}\n${material}`;
        }
        busy('🧠 تحرير النشرة…');
        const j = await this.aiJSON(`Write a short TV-style news bulletin in Arabic (Modern Standard) from this material: greeting, 3-5 headlines each with 1-2 sentences, sign-off. Return {"title":"…","items":[{"headline":"short","body":"spoken text"}],"intro":"…","outro":"…"}\n\n${material.slice(0, 14000)}`, { kind: 'general', maxTokens: 2000, source: 'fmx-news' });
        if (!j || !j.items) { out('fmx-out', empty('تعذر التحرير', true)); return null; }
        try {
            const segs = [j.intro].concat(j.items.map(i => `${i.headline}. ${i.body}`), [j.outro]).filter(Boolean), parts = [];
            for (let i = 0; i < segs.length; i++) { busy(`🎙️ ${i + 1}/${segs.length}`); const v = await aiSpeech(this, segs[i], { voice: o.voice || val('fmx-news-voice') || 'onyx', style: 'formal, authoritative TV news anchor' }); if (!v) return null; parts.push(v); }
            const voice = concatAudio(parts, 0.6), m = mixMusic(voice, 'corporate', 0.08, 2.5), mix = { ...m, wav: concatAudio([m], 0).wav };
            if ((o.fmt || val('fmx-news-fmt')) !== 'video') { wavOut(this, mix, 'news.wav', j.title); return { ...j, ...mix }; }
            const heads = [j.title].concat(j.items.map(i => i.headline), [j.title]), starts = voice.offsets.map(s => s + m.offset), total = mix.samples.length / mix.rate, ticker = j.items.map(i => i.headline).join('   •   ');
            busy('🎬 تصيير…');
            const r = await this.fmxRenderCanvas({ width: 1280, height: 720, duration: total, audio: mix, draw: (ctx, t, w, h) => {
                let k = 0; starts.forEach((s, i) => { if (t >= s) k = i; });
                const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#0b1d3a'); g.addColorStop(1, '#13315c'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = '#c1121f'; ctx.fillRect(60, 60, 230, 54); ctx.fillStyle = '#fff'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('عاجل • OX', 175, 98);
                ctx.textAlign = 'right'; ctx.direction = 'rtl'; ctx.font = 'bold 52px sans-serif';
                wrapLines(heads[k] || '', w - 160, (x) => ctx.measureText(x).width).slice(0, 3).forEach((l, i) => ctx.fillText(l, w - 80, 300 + i * 70));
                ctx.fillStyle = '#c1121f'; ctx.fillRect(0, h - 70, w, 70); ctx.fillStyle = '#fff'; ctx.font = '28px sans-serif'; ctx.textAlign = 'left'; ctx.direction = 'rtl';
                const tw = ctx.measureText(ticker).width + w, x = w - ((t * 140) % tw); ctx.fillText(ticker, x, h - 25);
                ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '22px sans-serif'; ctx.textAlign = 'left'; ctx.direction = 'ltr'; ctx.fillText(new Date().toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' }), 60, h - 100);
            } });
            this.fmxOutput(r.blob, 'news.webm', { note: j.title });
            return { ...j, ...r };
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };

    // ================================================================ AD (#718)
    P.fmxAd = function () {
        return card('إعلان', `${area('fmx-ad-product', 'المنتج/الخدمة', 'OX-Alpha Workbench Pro — بيئة تطوير ذكية في المتصفح', 2, 'dir="auto"')}
            <div class="fmx-grid4">${select('fmx-ad-len', 'المدة', [['15', '15 ثانية'], ['30', '30 ثانية']], '15')}${select('fmx-ad-tone', 'النبرة', [['energetic', 'حماسية'], ['premium', 'فاخرة'], ['friendly', 'ودودة'], ['funny', 'مرحة']], 'energetic')}${select('fmx-ad-voice', 'الصوت', AI_VOICES.map(v => [v, v]), 'echo')}${select('fmx-ad-fmt', 'المقاس', [['16:9', 'أفقي 16:9'], ['9:16', 'عمودي 9:16 (ريلز)'], ['1:1', 'مربع']], '16:9')}</div>
            <div class="gh-row"><label class="gh-check"><input id="fmx-ad-img" type="checkbox" checked> صور مولدة بالذكاء</label>${pbtn('fa-bullhorn', 'إنتاج الإعلان', 'app.fmxAdRun()')}</div>${progressDiv}<div id="fmx-out"></div>`, 'fa-bullhorn');
    };
    P.fmxAdRun = async function (o = {}) {
        const product = o.product || val('fmx-ad-product');
        if (!product || !hasKey(this)) return null;
        const len = +(o.len || val('fmx-ad-len') || 15), tone = o.tone || val('fmx-ad-tone') || 'energetic', fmt = o.fmt || val('fmx-ad-fmt') || '16:9';
        busy('🧠 كتابة الإعلان…');
        const j = await this.aiJSON(`Write a ${len}-second ${tone} video ad in Arabic for: ${product}. 3 scenes: hook, benefit, call to action. Voiceover total ≈ ${Math.round(len * 2.2)} words. Return {"scenes":[{"voice":"spoken line","caption":"≤6 words on screen","image":"English image prompt for the scene"}],"slogan":"…"}`, { kind: 'general', maxTokens: 1200, source: 'fmx-ad' });
        const scenes = ((j && j.scenes) || []).slice(0, 4);
        if (!scenes.length) { out('fmx-out', empty('تعذر الكتابة', true)); return null; }
        try {
            const imgs = [];
            if (o.images != null ? o.images : val('fmx-ad-img') !== false) for (let i = 0; i < scenes.length; i++) { busy(`🖼️ ${i + 1}/${scenes.length}`); const b = await genImage(this, `${scenes[i].image}, advertising photography, vibrant, high quality, no text`, fmt); imgs.push(b ? await loadImg(b) : null); }
            const parts = [];
            for (let i = 0; i < scenes.length; i++) { busy(`🎙️ ${i + 1}/${scenes.length}`); const v = await aiSpeech(this, scenes[i].voice, { voice: o.voice || val('fmx-ad-voice') || 'echo', style: `${tone} commercial voiceover` }); if (!v) return null; parts.push(v); }
            const voice = concatAudio(parts, 0.25), m = mixMusic(voice, tone === 'premium' ? 'cinematic' : tone === 'friendly' ? 'lofi' : 'upbeat', 0.25, 0.8), mix = { ...m, wav: concatAudio([m], 0).wav };
            const starts = voice.offsets.map(s => s + m.offset), total = mix.samples.length / mix.rate;
            const [W0, H0] = fmt === '9:16' ? [720, 1280] : fmt === '1:1' ? [1080, 1080] : [1280, 720];
            const palette = ['#7c3aed', '#0ea5e9', '#f43f5e', '#10b981'];
            busy('🎬 تصيير…');
            const r = await this.fmxRenderCanvas({ width: W0, height: H0, duration: total, audio: mix, draw: (ctx, t, w, h) => {
                let k = 0; starts.forEach((s, i) => { if (t >= s) k = i; });
                const local = t - (starts[k] || 0), im = imgs[k], zoom = 1 + local * 0.03;
                if (im) { const sc = Math.max(w / im.width, h / im.height) * zoom; ctx.drawImage(im, (w - im.width * sc) / 2, (h - im.height * sc) / 2, im.width * sc, im.height * sc); }
                else { const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, palette[k % 4]); g.addColorStop(1, '#0f172a'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
                ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, h * 0.62, w, h * 0.38);
                const cap = k === scenes.length - 1 && local > 1 ? (j.slogan || scenes[k].caption) : scenes[k].caption, a = clamp(local * 3, 0, 1);
                ctx.globalAlpha = a; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.direction = 'rtl'; ctx.font = `bold ${Math.round(w / 14)}px sans-serif`;
                wrapLines(cap, w * 0.86, (x) => ctx.measureText(x).width).slice(0, 2).forEach((l, i) => ctx.fillText(l, w / 2, h * 0.76 + i * w / 12 - (1 - a) * 20));
                ctx.globalAlpha = 1;
            } });
            this.fmxOutput(r.blob, `ad-${len}s.webm`, { note: j.slogan || '' });
            return { ...j, ...r };
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };

    // ================================================================ COMIC (#719)
    P.fmxComic = function () {
        return card('قصة مصورة (كوميكس)', `${area('fmx-cm-story', 'فكرة القصة', 'مبرمج يطارد خطأً برمجياً يختبئ في الكود حتى يكتشف أنه فاصلة منقوطة مفقودة', 3, 'dir="auto"')}
            <div class="gh-row">${select('fmx-cm-n', 'اللوحات', ['4', '6'], '4')}${select('fmx-cm-style', 'الأسلوب', [['manga, black and white ink', 'مانغا'], ['american comic book, bold colors', 'كوميكس أمريكي'], ['pixar 3d cartoon', 'كرتون ثلاثي الأبعاد'], ['watercolor children illustration', 'ألوان مائية']], 'american comic book, bold colors')}${pbtn('fa-book', 'إنشاء', 'app.fmxComicRun()')}</div><div id="fmx-out"></div>`, 'fa-book');
    };
    const bubble = (ctx, x, y, maxW, text, font = 22) => {
        ctx.font = `bold ${font}px sans-serif`;
        const lines = wrapLines(text, maxW - 24, (s) => ctx.measureText(s).width).slice(0, 4), lh = font * 1.25, bw = Math.min(maxW, Math.max(...lines.map(l => ctx.measureText(l).width)) + 28), bh = lines.length * lh + 18;
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, 16); else ctx.rect(x, y, bw, bh); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + 24, y + bh); ctx.lineTo(x + 18, y + bh + 18); ctx.lineTo(x + 44, y + bh); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.direction = 'rtl';
        lines.forEach((l, i) => ctx.fillText(l, x + bw / 2, y + 10 + (i + 0.8) * lh));
    };
    P.fmxComicRun = async function (o = {}) {
        const story = o.story || val('fmx-cm-story');
        if (!story || !hasKey(this)) return null;
        const n = +(o.n || val('fmx-cm-n') || 4), style = o.style || val('fmx-cm-style') || 'american comic book, bold colors';
        busy('🧠 كتابة السيناريو…');
        const j = await this.aiJSON(`Write a ${n}-panel comic in Arabic from: ${story}. Keep characters visually consistent (describe them once in "characters"). Return {"title":"…","characters":"English visual description","panels":[{"scene":"English image prompt (no text in image)","caption":"short Arabic narration or empty","dialogue":[{"who":"name","text":"short Arabic line"}]}]}`, { kind: 'general', maxTokens: 1800, source: 'fmx-comic' });
        const panels = ((j && j.panels) || []).slice(0, n);
        if (!panels.length) { out('fmx-out', empty('تعذر الكتابة', true)); return null; }
        const imgs = [];
        for (let i = 0; i < panels.length; i++) { busy(`🖼️ ${i + 1}/${panels.length}`); const b = await genImage(this, `${style}. ${j.characters || ''}. ${panels[i].scene}. Comic panel, no text, no speech bubbles.`, panels.length % 2 && i === panels.length - 1 ? '16:9' : '4:3'); imgs.push(b ? await loadImg(b) : null); }
        const Wc = 1600, Hc = Math.round(Wc * (panels.length <= 4 ? 1.2 : 1.6)), c = newCanvas(Wc, Hc + 110), ctx = c.getContext('2d');
        ctx.fillStyle = '#fafafa'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = '#111'; ctx.font = 'bold 56px sans-serif'; ctx.textAlign = 'center'; ctx.direction = 'rtl'; ctx.fillText(j.title || 'قصة', Wc / 2, 74);
        comicLayout(panels.length, Wc, Hc).forEach((g, i) => {
            const y = g.y + 100, im = imgs[i], p = panels[i];
            ctx.save(); ctx.beginPath(); ctx.rect(g.x, y, g.w, g.h); ctx.clip();
            if (im) { const sc = Math.max(g.w / im.width, g.h / im.height); ctx.drawImage(im, g.x + (g.w - im.width * sc) / 2, y + (g.h - im.height * sc) / 2, im.width * sc, im.height * sc); } else { ctx.fillStyle = '#e5e7eb'; ctx.fillRect(g.x, y, g.w, g.h); }
            ctx.restore();
            ctx.strokeStyle = '#000'; ctx.lineWidth = 6; ctx.strokeRect(g.x, y, g.w, g.h);
            if (p.caption) { ctx.font = 'bold 22px sans-serif'; const cw = Math.min(g.w - 20, ctx.measureText(p.caption).width + 24); ctx.fillStyle = '#fde68a'; ctx.fillRect(g.x + g.w - cw - 10, y + 10, cw, 38); ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.strokeRect(g.x + g.w - cw - 10, y + 10, cw, 38); ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.fillText(p.caption, g.x + g.w - cw / 2 - 10, y + 37); }
            (p.dialogue || []).slice(0, 2).forEach((d, k) => bubble(ctx, g.x + 20 + k * g.w * 0.4, y + g.h * (k ? 0.55 : 0.2), g.w * 0.55, `${d.who}: ${d.text}`));
        });
        const blob = await canvasToBlob(c, 'image/png');
        if (blob) this.fmxOutput(blob, 'comic.png', { note: `${panels.length} لوحات • ${j.title || ''}` });
        return { ...j, blob, missingImages: imgs.filter(x => !x).length };
    };

    // ================================================================ KIDS BOOK (#720)
    P.fmxKidsBook = function () {
        return card('كتاب أطفال', `<div class="fmx-grid4">${field('fmx-kb-hero', 'البطل', 'القط سمسم')}${select('fmx-kb-age', 'العمر', [['3-5', '3-5 سنوات'], ['6-8', '6-8 سنوات'], ['9-11', '9-11 سنة']], '6-8')}${field('fmx-kb-moral', 'القيمة/الدرس', 'التعاون')}${select('fmx-kb-pages', 'الصفحات', ['6', '8', '10'], '8')}</div>
            <div class="gh-row">${select('fmx-kb-lang', 'اللغة', [['Arabic', 'العربية'], ['English', 'English'], ['French', 'Français']], 'Arabic')}<label class="gh-check"><input id="fmx-kb-voice" type="checkbox"> سرد صوتي</label>${pbtn('fa-child-reaching', 'تأليف الكتاب', 'app.fmxKidsBookRun()')}</div>
            <div class="text-dim">الناتج: كتاب HTML تفاعلي يقلب صفحاته (يعمل دون اتصال) + نسخة PDF للطباعة.</div><div id="fmx-out"></div>`, 'fa-child-reaching');
    };
    const renderPage = (img, text, { w = 1200, h = 1500, page, total, title } = {}) => {
        const c = newCanvas(w, h), ctx = c.getContext('2d');
        ctx.fillStyle = '#fffaf0'; ctx.fillRect(0, 0, w, h);
        const ih = Math.round(h * 0.62);
        if (img) { const sc = Math.max(w / img.width, ih / img.height); ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, ih); ctx.clip(); ctx.drawImage(img, (w - img.width * sc) / 2, (ih - img.height * sc) / 2, img.width * sc, img.height * sc); ctx.restore(); }
        else { ctx.fillStyle = '#fde68a'; ctx.fillRect(0, 0, w, ih); }
        ctx.fillStyle = '#3f2d1d'; ctx.textAlign = 'center'; ctx.direction = 'rtl';
        ctx.font = title ? 'bold 72px serif' : '44px serif';
        wrapLines(text, w - 140, (s) => ctx.measureText(s).width).slice(0, 7).forEach((l, i) => ctx.fillText(l, w / 2, ih + 110 + i * (title ? 90 : 62)));
        if (page) { ctx.font = '28px serif'; ctx.fillStyle = '#a08060'; ctx.fillText(`${page} / ${total}`, w / 2, h - 40); }
        return c;
    };
    P.fmxKidsBookRun = async function (o = {}) {
        if (!hasKey(this)) return null;
        const hero = o.hero || val('fmx-kb-hero') || 'القط سمسم', pages = +(o.pages || val('fmx-kb-pages') || 8);
        busy('🧠 تأليف القصة…');
        const j = await this.aiJSON(`Write an illustrated children's story in ${o.lang || val('fmx-kb-lang') || 'Arabic'} for ages ${o.age || val('fmx-kb-age') || '6-8'}. Hero: ${hero}. Lesson: ${o.moral || val('fmx-kb-moral') || 'cooperation'}. ${pages} pages, 1-3 simple sentences each, gentle and positive. Return {"title":"…","hero_look":"consistent English visual description of the hero","pages":[{"text":"…","image":"English illustration prompt"}]}`, { kind: 'general', maxTokens: 2500, source: 'fmx-kids' });
        const list = ((j && j.pages) || []).slice(0, pages);
        if (!list.length) { out('fmx-out', empty('تعذر التأليف', true)); return null; }
        try {
            const style = `soft watercolor children's book illustration, warm colors, ${j.hero_look || hero}`;
            const cover = await genImage(this, `${style}. Book cover scene for "${j.title}". No text.`, '4:3');
            const imgs = [cover ? await loadImg(cover) : null];
            for (let i = 0; i < list.length; i++) { busy(`🎨 ${i + 1}/${list.length}`); const b = await genImage(this, `${style}. ${list[i].image}. No text.`, '4:3'); imgs.push(b ? await loadImg(b) : null); }
            const canvases = [renderPage(imgs[0], j.title, { title: true })].concat(list.map((p, i) => renderPage(imgs[i + 1], p.text, { page: i + 1, total: list.length })));
            busy('📄 تجميع…');
            const pngs = [];
            for (const c of canvases) { const b = await canvasToBlob(c, 'image/jpeg', 0.85); pngs.push(b ? await blobBytes(b) : null); }
            let audio = [];
            if (o.voice != null ? o.voice : val('fmx-kb-voice')) for (let i = 0; i < list.length; i++) { busy(`🎙️ ${i + 1}/${list.length}`); const v = await aiSpeech(this, list[i].text, { voice: 'fable', style: 'gentle, warm bedtime-story narrator for small children' }); audio.push(v ? bytesToDataUrl(v.wav, 'audio/wav') : ''); }
            const { PDFDocument } = await loadPdfLib();
            const pdf = await PDFDocument.create();
            for (const bytes of pngs) { if (!bytes) continue; const im = await pdf.embedJpg(bytes); const pg = pdf.addPage([im.width * 0.5, im.height * 0.5]); pg.drawImage(im, { x: 0, y: 0, width: im.width * 0.5, height: im.height * 0.5 }); }
            pdf.setTitle(j.title || 'Story');
            const pdfBytes = await pdf.save();
            const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(j.title)}</title><style>body{margin:0;background:#2b2118;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:serif}img{max-width:min(92vw,600px);max-height:80vh;border-radius:12px;box-shadow:0 10px 40px #0008;transition:transform .4s}nav{margin:16px;display:flex;gap:12px}button{font-size:22px;padding:8px 22px;border-radius:999px;border:0;background:#fde68a;cursor:pointer}</style></head><body><img id="p" alt=""><nav><button onclick="go(1)">→</button><button onclick="go(-1)">←</button></nav><audio id="a"></audio><script>var P=${JSON.stringify(pngs.map(b => b ? bytesToDataUrl(b, 'image/jpeg') : ''))},A=${JSON.stringify(audio)},i=0;function show(){var p=document.getElementById('p');p.style.transform='rotateY(90deg)';setTimeout(function(){p.src=P[i];p.style.transform='none';},200);var a=document.getElementById('a');if(i>0&&A[i-1]){a.src=A[i-1];a.play().catch(function(){});}else a.pause();}function go(d){i=Math.max(0,Math.min(P.length-1,i+d));show();}document.addEventListener('keydown',function(e){if(e.key==='ArrowLeft')go(1);if(e.key==='ArrowRight')go(-1);});show();</script></body></html>`;
            const name = String(j.title || 'story').slice(0, 30).replace(/[^\p{L}\p{N}]+/gu, '-');
            this.fmxOutput(makeBlob([html], 'text/html'), `${name}.html`, { note: `${list.length} صفحات${audio.length ? ' • مع سرد' : ''}` });
            this._fmxKidsPdf = { blob: makeBlob([pdfBytes], 'application/pdf'), name: `${name}.pdf` };
            const o2 = document.getElementById('fmx-out');
            if (o2) o2.insertAdjacentHTML('beforeend', `<div class="gh-row">${btn('fa-file-pdf', 'تحميل PDF للطباعة', 'app.downloadBlob(app._fmxKidsPdf.blob, app._fmxKidsPdf.name)')}</div>`);
            return { ...j, pdfBytes, html, missingImages: imgs.filter(x => !x).length };
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };
}
