/* Audio studio: Audacity-style editor (#684), noise reduction (#685), voice changer (#686), voice separation (#704), clarity (#705),
   SFX generator (#688), sound library (#681) + free music library (#682), music generator (#687), text → song (#689), karaoke with code (#690). */
import { esc, call, btn, pbtn, card, empty, field, area, select, fmtTime, stemOf, makeBlob, encodeWAV, val, filesOf, win, AR_RE, isTextEntry } from './shared.js';
import { sourcePicker, readSources } from './core.js';
import { decodeAudio, toMono, aiSpeech, speak, stopSpeaking, recordMic, AI_VOICES } from './aiio.js';
import * as D from './dsp.js';

export const FREE_MUSIC = [
    ['Pixabay Music', 'https://pixabay.com/music/', 'رخصة Pixabay — استخدام تجاري بلا نسب'],
    ['YouTube Audio Library', 'https://studio.youtube.com/channel/UC/music', 'مجانية لفيديوهات يوتيوب'],
    ['Free Music Archive', 'https://freemusicarchive.org/', 'Creative Commons (تحقق من كل مقطع)'],
    ['Incompetech (Kevin MacLeod)', 'https://incompetech.com/music/royalty-free/music.html', 'CC BY 4.0 — اذكر المؤلف'],
    ['ccMixter', 'https://ccmixter.org/', 'Creative Commons'],
    ['Freesound (مؤثرات)', 'https://freesound.org/', 'CC0 / CC BY']
];

export function installAudio(P) {
    const W = () => win();
    const loadAudio = async (app, src) => { const [f] = await readSources(app, src); if (!f) { app.showToast('اختر ملفاً صوتياً', 'warning'); return null; } const a = await decodeAudio(f.bytes); return { ...a, name: f.name }; };
    const outWav = (app, channels, rate, name, note = '') => app.fmxOutput(makeBlob([encodeWAV(channels, rate)], 'audio/wav'), name, { note: `${fmtTime(channels[0].length / rate)}${note ? ' • ' + note : ''}` });
    const play = (app, samples, rate) => { const blob = makeBlob([encodeWAV([samples], rate)], 'audio/wav'); try { app._fmxAudioEl && app._fmxAudioEl.pause(); } catch (e) {} const a = new (W().Audio)(W().URL.createObjectURL(blob)); app._fmxAudioEl = a; a.play().catch(() => {}); return a; };

    // ================================================================ EDITOR (#684)
    P.fmxAudioEditor = function () {
        this._fmxMount = () => this.fmxEdBind();
        return card('محرر الصوت', `${sourcePicker(this, 'fmx-ed-src', ['audio', 'video'], { accept: 'audio/*,video/*' })}
            <div class="gh-row">${pbtn('fa-folder-open', 'فتح', 'app.fmxEdLoad()')}${btn('fa-microphone', 'تسجيل', 'app.fmxEdRecord()')}<span id="fmx-ed-info" class="text-dim"></span></div>
            <canvas id="fmx-ed-wave" class="fmx-wave" width="1000" height="160"></canvas>
            <div class="gh-row fmx-ed-tools">${[['fa-play', 'تشغيل', 'app.fmxEdPlay()'], ['fa-stop', 'إيقاف', 'app.fmxEdStop()'], ['fa-scissors', 'قص', "app.fmxEdOp('cut')"], ['fa-copy', 'نسخ', "app.fmxEdOp('copy')"], ['fa-paste', 'لصق', "app.fmxEdOp('paste')"], ['fa-trash', 'حذف', "app.fmxEdOp('delete')"], ['fa-crop', 'اقتصاص', "app.fmxEdOp('trim')"], ['fa-volume-xmark', 'صمت', "app.fmxEdOp('silence')"], ['fa-arrow-up-right-dots', 'تلاشي داخل', "app.fmxEdOp('fadein')"], ['fa-arrow-down-wide-short', 'تلاشي خارج', "app.fmxEdOp('fadeout')"], ['fa-maximize', 'تطبيع', "app.fmxEdOp('normalize')"], ['fa-volume-high', '+3dB', "app.fmxEdOp('louder')"], ['fa-volume-low', '-3dB', "app.fmxEdOp('quieter')"], ['fa-backward', 'عكس', "app.fmxEdOp('reverse')"], ['fa-gauge-high', 'سرعة ×1.25', "app.fmxEdOp('faster')"], ['fa-gauge', 'سرعة ×0.8', "app.fmxEdOp('slower')"], ['fa-rotate-left', 'تراجع', 'app.fmxEdUndo()']].map(([i, l, c]) => btn(i, l, c, 'gh-chip')).join('')}</div>
            <div class="text-dim">اسحب على الموجة لتحديد جزء (بدون تحديد = كامل الملف). التحرير غير متلف — «تراجع» حتى 30 خطوة.</div>
            <div class="gh-row">${pbtn('fa-file-export', 'تصدير WAV', 'app.fmxEdExport()')}</div><div id="fmx-out"></div>`, 'fa-wave-square');
    };
    P.fmxEdSet = function (channels, rate, name) { this._fmxEd = { ch: channels, rate, name: name || 'audio.wav', sel: null, undo: [], clip: (this._fmxEd && this._fmxEd.clip) || null }; this.fmxEdDraw(); return this._fmxEd; };
    P.fmxEdLoad = async function (src) { const a = await loadAudio(this, src || 'fmx-ed-src'); return a ? this.fmxEdSet(a.channels, a.sampleRate, a.name) : null; };
    P.fmxEdRecord = async function () {
        if (this._fmxEdRec) { const blob = await this._fmxEdRec.stop(); this._fmxEdRec = null; const a = await decodeAudio(blob); return this.fmxEdSet(a.channels, a.sampleRate, 'recording.wav'); }
        this._fmxEdRec = await recordMic();
        this.showToast('🎙️ يسجّل… اضغط «تسجيل» مرة أخرى للإيقاف', 'info');
        return true;
    };
    const range = (app) => { const e = app._fmxEd, n = e.ch[0].length; return e.sel && e.sel[1] - e.sel[0] > 10 ? [Math.max(0, e.sel[0]), Math.min(n, e.sel[1])] : [0, n]; };
    P.fmxEdOp = function (op) {
        const e = this._fmxEd;
        if (!e) { this.showToast('افتح ملفاً صوتياً', 'warning'); return null; }
        const [a, b] = range(this);
        if (op === 'copy') { e.clip = D.sliceCh(e.ch, a, b); this.showToast('📋 نُسخ ' + fmtTime((b - a) / e.rate), 'info'); return e.clip; }
        e.undo.push(e.ch); if (e.undo.length > 30) e.undo.shift();
        const ops = { cut: () => { e.clip = D.sliceCh(e.ch, a, b); e.sel = null; return D.cutCh(e.ch, a, b); }, delete: () => { e.sel = null; return D.cutCh(e.ch, a, b); }, paste: () => (e.clip ? D.insertCh(e.ch, e.sel ? e.sel[0] : e.ch[0].length, e.clip) : e.ch), trim: () => { e.sel = null; return D.sliceCh(e.ch, a, b); }, silence: () => D.silenceCh(e.ch, a, b), fadein: () => D.fadeCh(e.ch, a, b, 'in'), fadeout: () => D.fadeCh(e.ch, a, b, 'out'), normalize: () => D.normalizeCh(e.ch, a, b), louder: () => D.gainCh(e.ch, a, b, 1.4125), quieter: () => D.gainCh(e.ch, a, b, 0.708), reverse: () => D.reverseCh(e.ch, a, b), faster: () => { e.sel = null; return D.speedCh(e.ch, 1.25); }, slower: () => { e.sel = null; return D.speedCh(e.ch, 0.8); } };
        if (!ops[op]) return null;
        e.ch = ops[op]();
        this.fmxEdDraw();
        return e.ch;
    };
    P.fmxEdUndo = function () { const e = this._fmxEd; if (e && e.undo.length) { e.ch = e.undo.pop(); this.fmxEdDraw(); } return e && e.ch; };
    P.fmxEdDraw = function () {
        const e = this._fmxEd, c = document.getElementById('fmx-ed-wave');
        const info = document.getElementById('fmx-ed-info');
        if (info && e) info.textContent = `${e.name} • ${fmtTime(e.ch[0].length / e.rate)} • ${e.ch.length === 1 ? 'أحادي' : 'ستيريو'} • ${e.rate}Hz${e.sel ? ` • التحديد ${fmtTime((e.sel[1] - e.sel[0]) / e.rate)}` : ''}`;
        const ctx = c && c.getContext && c.getContext('2d');
        if (!ctx || !e) return;
        const w = c.width, h = c.height, s = e.ch[0], step = Math.max(1, Math.floor(s.length / w));
        ctx.fillStyle = '#131314'; ctx.fillRect(0, 0, w, h);
        if (e.sel) { ctx.fillStyle = 'rgba(56,189,248,.18)'; ctx.fillRect(e.sel[0] / s.length * w, 0, (e.sel[1] - e.sel[0]) / s.length * w, h); }
        ctx.fillStyle = '#38bdf8';
        for (let x = 0; x < w; x++) { let mn = 1, mx = -1; for (let i = x * step; i < Math.min(s.length, (x + 1) * step); i++) { if (s[i] < mn) mn = s[i]; if (s[i] > mx) mx = s[i]; } if (mx >= mn) ctx.fillRect(x, (1 - mx) * h / 2, 1, Math.max(1, (mx - mn) * h / 2)); }
        if (this._fmxEdHead != null) { ctx.fillStyle = '#f472b6'; ctx.fillRect(this._fmxEdHead / s.length * w, 0, 2, h); }
    };
    P.fmxEdBind = function () {
        const c = document.getElementById('fmx-ed-wave');
        if (!c) return;
        let down = null;
        const pos = (ev) => { const r = c.getBoundingClientRect(); const e = this._fmxEd; return e ? Math.round(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * e.ch[0].length) : 0; };
        c.addEventListener('pointerdown', (ev) => { down = pos(ev); if (this._fmxEd) this._fmxEd.sel = null; });
        c.addEventListener('pointermove', (ev) => { if (down == null || !this._fmxEd) return; const p = pos(ev); this._fmxEd.sel = [Math.min(down, p), Math.max(down, p)]; this.fmxEdDraw(); });
        W().addEventListener('pointerup', () => { down = null; });
    };
    P.fmxEdPlay = function () {
        const e = this._fmxEd;
        if (!e) return null;
        const [a, b] = range(this), a0 = play(this, e.ch.length > 1 ? toMono(D.sliceCh(e.ch, a, b), e.rate) : e.ch[0].subarray(a, b), e.rate);
        const tick = () => { if (!a0 || a0.paused || a0.ended) { this._fmxEdHead = null; this.fmxEdDraw(); return; } this._fmxEdHead = a + a0.currentTime * e.rate; this.fmxEdDraw(); requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        return a0;
    };
    P.fmxEdStop = function () { try { this._fmxAudioEl && this._fmxAudioEl.pause(); } catch (e) {} };
    P.fmxEdExport = function () { const e = this._fmxEd; if (!e) return null; return outWav(this, e.ch, e.rate, stemOf(e.name) + '-edited.wav'); };

    // ================================================================ FX (#685 #686 #704 #705)
    P.fmxAudioFx = function () {
        return card('تنقية الصوت وتغييره', `${sourcePicker(this, 'fmx-fx-src', ['audio', 'video'], { accept: 'audio/*,video/*' })}
            <div class="fmx-card-h"><i class="fa-solid fa-broom"></i> تنقية</div>
            <div class="gh-row">${btn('fa-broom', 'إزالة الضوضاء', "app.fmxFx('denoise')", 'gh-chip')}${select('fmx-fx-str', 'القوة', [['1.2', 'خفيفة'], ['1.8', 'متوسطة'], ['2.6', 'قوية']], '1.8')}${btn('fa-wand-magic', 'تحسين وضوح الكلام', "app.fmxFx('clarity')", 'gh-chip')}${btn('fa-filter', 'عزل نطاق الكلام', "app.fmxFx('speech')", 'gh-chip')}</div>
            <div class="fmx-card-h"><i class="fa-solid fa-masks-theater"></i> تغيير الصوت</div>
            <div class="gh-row">${Object.entries(D.VOICES).map(([id, v]) => `<button class="gh-chip" data-voice="${id}" onclick="${call('fmxFx', 'voice:' + id)}">${v.label}</button>`).join('')}</div>
            <div class="fmx-card-h"><i class="fa-solid fa-people-arrows"></i> فصل الأصوات المتداخلة</div>
            <div class="gh-row">${btn('fa-microphone', 'عزل الصوت البشري', "app.fmxFx('vocals')", 'gh-chip')}${btn('fa-guitar', 'إزالة الصوت (موسيقى فقط)', "app.fmxFx('instrumental')", 'gh-chip')}</div>
            <div class="text-dim">معالجة إشارة رقمية محلية (طرح طيفي، مرشحات، إزاحة طبقة حبيبية، استخراج القناة الوسطى). الفصل يعمل على التسجيلات الستيريو حيث الصوت في المنتصف. لتمييز المتحدثين استخدم «تحليل الكلام».</div><div id="fmx-out"></div>`, 'fa-sliders');
    };
    P.fmxFx = async function (op, src) {
        const a = await loadAudio(this, src || 'fmx-fx-src');
        if (!a) return null;
        const rate = a.sampleRate, mono = () => toMono(a.channels, rate);
        let ch, note = '';
        if (op === 'denoise') { ch = a.channels.map(c => D.denoise(c, rate, { strength: +val('fmx-fx-str') || 1.8 })); note = 'إزالة ضوضاء'; }
        else if (op === 'clarity') { ch = a.channels.map(c => D.enhanceVoice(c, rate)); note = 'وضوح الكلام'; }
        else if (op === 'speech') { ch = [D.speechBand(mono(), rate)]; note = 'نطاق الكلام'; }
        else if (op.startsWith('voice:')) { ch = [D.voiceChange(mono(), rate, op.slice(6))]; note = D.VOICES[op.slice(6)].label; }
        else if (op === 'vocals' || op === 'instrumental') {
            if (a.channels.length < 2) { this.showToast('الفصل يحتاج تسجيلاً ستيريو — استخدم «عزل نطاق الكلام» للأحادي', 'warning'); return null; }
            const r = D.separateStereo(a.channels[0], a.channels[1], rate); ch = [r[op]]; note = op === 'vocals' ? 'الصوت البشري' : 'الموسيقى';
        } else return null;
        outWav(this, ch, rate, `${stemOf(a.name)}-${op.replace(':', '-')}.wav`, note);
        return ch;
    };

    // ================================================================ SFX (#688)
    P.fmxSfx = function () {
        const cats = {};
        Object.entries(D.SFX).forEach(([id, s]) => { (cats[s.cat] = cats[s.cat] || []).push([id, s]); });
        return card('توليد مؤثرات صوتية', `<div class="gh-row">${field('fmx-sfx-pitch', 'الطبقة', '1', 'type="range" min="0.5" max="2" step="0.05"')}${field('fmx-sfx-dur', 'المدة (0=افتراضي)', '0', 'type="number" min="0" max="10" step="0.1"')}</div>
            ${Object.entries(cats).map(([cat, list]) => `<div class="fmx-card-h">${esc(cat)}</div><div class="gh-row">${list.map(([id, s]) => `<span class="fmx-sfx" data-sfx="${id}">${btn('fa-play', s.label, call('fmxSfxPlay', id), 'gh-chip')}<button class="gh-chip" title="حفظ" onclick="${call('fmxSfxSave', id)}"><i class="fa-solid fa-floppy-disk"></i></button></span>`).join('')}</div>`).join('')}
            <div class="fmx-card-h"><i class="fa-solid fa-wand-magic-sparkles"></i> صمم مؤثراً بالوصف</div><div class="gh-row">${field('fmx-sfx-desc', 'الوصف', '', 'dir="auto" placeholder="صوت سفينة فضاء تقلع ببطء"')}${pbtn('fa-wand-magic-sparkles', 'توليد', 'app.fmxSfxAI()')}</div><div id="fmx-out"></div>`, 'fa-bolt');
    };
    const sfxOpts = () => ({ pitch: +val('fmx-sfx-pitch') || 1, duration: +val('fmx-sfx-dur') || undefined });
    P.fmxSfxPlay = function (id) { const s = D.synthSFX(id, 44100, sfxOpts()); play(this, s, 44100); return s; };
    P.fmxSfxSave = function (id) { const s = D.synthSFX(id, 44100, sfxOpts()); outWav(this, [s], 44100, `sfx-${id}.wav`, D.SFX[id].label); return s; };
    P.fmxSfxAI = async function (descArg) {
        const desc = descArg || val('fmx-sfx-desc');
        if (!desc) return null;
        const r = await this.aiJSON(`Design a synthesized sound effect for: "${desc}". Return a recipe JSON: {"dur":seconds(0.1-6),"tone":{"wave":"sine|square|saw|triangle","f0":startHz,"f1":endHz,"amount":0-1},"noise":{"amount":0-1,"filter":"lowpass|highpass|bandpass","freq":Hz},"env":{"a":0-0.5 attack fraction,"r":0-1 release curve},"tremolo":Hz or 0}`, { kind: 'general', maxTokens: 300, source: 'fmx-sfx' });
        if (!r) return null;
        const s = D.synthRecipe(r, 44100);
        play(this, s, 44100);
        outWav(this, [s], 44100, `sfx-${desc.slice(0, 24).replace(/[^\p{L}\p{N}]+/gu, '-')}.wav`, 'مصمم بالذكاء');
        return { recipe: r, samples: s };
    };

    // ================================================================ LIBRARY (#681 #682)
    P.fmxSoundLibrary = async function () {
        await this.loadMediaItems();
        const mine = (this.mediaItems || []).filter(m => (m.type || '').startsWith('audio'));
        return card('مكتبة الأصوات', `<div class="text-dim">${Object.keys(D.SFX).length} مؤثراً مولّداً (CC0 — لك بالكامل) في «مؤثرات صوتية»، وموسيقى مولدة بلا حقوق في «توليد موسيقى». أصواتك المحفوظة:</div>
            ${mine.map(m => `<div class="gh-item static" data-sound="${esc(m.id)}"><i class="fa-solid fa-music text-blue"></i><div class="gh-item-main"><b>${esc(m.name)}</b><small>${new Date(m.created).toLocaleDateString('ar')}</small></div><audio controls preload="none" src="${esc(W().URL.createObjectURL(m.blob))}"></audio></div>`).join('') || empty('لا أصوات محفوظة — احفظ أي ناتج في «المعرض»')}`, 'fa-book-open')
            + card('موسيقى حرة', `<div class="fmx-card-h">مقطوعات جاهزة بلا حقوق (تُولَّد فوراً)</div><div class="gh-row">${Object.entries(D.MUSIC_STYLES).map(([id, s]) => `<span>${btn('fa-play', s.label, call('fmxMusicPreview', id), 'gh-chip')}<button class="gh-chip" onclick="${call('fmxMusicRun', { style: id })}"><i class="fa-solid fa-floppy-disk"></i></button></span>`).join('')}</div>
                <div class="fmx-card-h">مصادر موسيقى مجانية موثوقة</div>${FREE_MUSIC.map(([n, u, lic]) => `<div class="gh-item static"><i class="fa-solid fa-arrow-up-right-from-square text-dim"></i><div class="gh-item-main"><a href="${esc(u)}" target="_blank" rel="noopener">${esc(n)}</a><small>${esc(lic)}</small></div></div>`).join('')}<div id="fmx-out"></div>`, 'fa-compact-disc');
    };

    // ================================================================ MUSIC (#687) + TEXT → SONG (#689)
    P.fmxMusicGen = function () {
        return card('توليد موسيقى', `<div class="fmx-grid4">${select('fmx-mu-style', 'النمط', Object.entries(D.MUSIC_STYLES).map(([id, s]) => [id, s.label]), 'lofi')}${select('fmx-mu-key', 'المقام', ['C', 'D', 'E', 'F', 'G', 'A', 'B'], 'A')}${field('fmx-mu-bpm', 'السرعة BPM (0=تلقائي)', '0', 'type="number" min="0" max="200"')}${field('fmx-mu-bars', 'عدد المازورات', '16', 'type="number" min="2" max="64"')}</div>
                <div class="gh-row">${field('fmx-mu-seed', 'البذرة (لحن مختلف)', String(Math.floor(Math.random() * 1000)), 'type="number"')}${pbtn('fa-music', 'توليد', 'app.fmxMusicRun()')}</div>
                <div class="gh-row">${field('fmx-mu-desc', 'أو صف الموسيقى', '', 'dir="auto" placeholder="موسيقى حماسية لفيديو تقني قصير"')}${btn('fa-wand-magic-sparkles', 'توليد من الوصف', 'app.fmxMusicFromText()')}</div>
                <div class="text-dim">مؤلف إجرائي محلي (طبول، باص، كوردات، لحن) — النتيجة ملكك بالكامل. الوصف يختار له الذكاء الاصطناعي النمط والسرعة والمقام والتتابع الهارموني.</div>`, 'fa-music')
            + card('تحويل نص إلى أغنية', `${area('fmx-song-lyrics', 'الكلمات (أو موضوع ليكتبها الذكاء)', '', 4, 'dir="auto"')}
                <div class="gh-row">${btn('fa-pen-nib', 'اكتب الكلمات من الموضوع', 'app.fmxWriteLyrics()')}${select('fmx-song-style', 'الإيقاع', [['hiphop', 'راب'], ['upbeat', 'بوب'], ['oriental', 'شرقي'], ['lofi', 'هادئ']], 'hiphop')}${select('fmx-song-voice', 'الصوت', AI_VOICES, 'onyx')}${pbtn('fa-microphone-lines', 'إنتاج', 'app.fmxSongRun()')}</div>
                <div class="text-dim">الأداء إلقاء إيقاعي (راب/شعر) بصوت ذكاء اصطناعي فوق لحن مولّد — النماذج المتاحة لا تغني بلحن حقيقي.</div><div id="fmx-out"></div>`, 'fa-microphone-lines');
    };
    P.fmxMusicPreview = function (style) { const m = D.composeMusic({ style, bars: 4, seed: 7 }); play(this, m.samples, m.rate); return m; };
    P.fmxMusicRun = function (o = {}) {
        const opts = { style: o.style || val('fmx-mu-style') || 'lofi', key: o.key || val('fmx-mu-key') || 'A', bpm: +(o.bpm || val('fmx-mu-bpm')) || undefined, bars: +(o.bars || val('fmx-mu-bars')) || 16, seed: +(o.seed || val('fmx-mu-seed')) || 42, mode: o.mode, prog: o.prog };
        const m = D.composeMusic(opts);
        outWav(this, [m.samples], m.rate, `music-${opts.style}-${opts.seed}.wav`, `${D.MUSIC_STYLES[opts.style] ? D.MUSIC_STYLES[opts.style].label : opts.style} • ${m.bpm} BPM`);
        return m;
    };
    P.fmxMusicFromText = async function (descArg) {
        const desc = descArg || val('fmx-mu-desc');
        if (!desc) return null;
        const r = await this.aiJSON(`Choose parameters for a short instrumental matching: "${desc}". Return {"style":one of [${Object.keys(D.MUSIC_STYLES).join(',')}],"bpm":60-160,"key":"C|D|E|F|G|A|B","mode":"major|minor|dorian|hijaz|pentatonic","prog":[4 scale degrees 1-7],"bars":8-32}`, { kind: 'general', maxTokens: 200, source: 'fmx-music' });
        return this.fmxMusicRun(r ? { ...r, seed: Math.floor(Math.random() * 1000) } : { style: 'lofi' });
    };
    P.fmxWriteLyrics = async function () {
        const el = document.getElementById('fmx-song-lyrics');
        if (!el || !el.value.trim()) return null;
        const t = await this.aiRun(`اكتب كلمات أغنية قصيرة (مقطعان وقرار، 12-16 سطراً قصيراً، قافية واضحة وإيقاع منتظم) عن: ${el.value}\nأعد الكلمات فقط بلا عناوين.`, { kind: 'general', maxTokens: 600, source: 'fmx-lyrics' });
        if (t) el.value = t.trim();
        return t;
    };
    P.fmxSongRun = async function (o = {}) {
        const lyrics = o.lyrics || val('fmx-song-lyrics');
        if (!lyrics.trim()) { this.showToast('اكتب الكلمات', 'warning'); return null; }
        const style = o.style || val('fmx-song-style') || 'hiphop';
        const voice = await aiSpeech(this, lyrics, { voice: o.voice || val('fmx-song-voice') || 'onyx', style: 'rhythmic, energetic rap / spoken-word delivery locked to a steady beat, clear pauses at line ends' });
        if (!voice) return null;
        const dur = voice.samples.length / voice.rate + 3;
        const beat = D.composeMusic({ style, bars: Math.ceil(dur / (60 / D.MUSIC_STYLES[style].bpm * 4)) + 1, seed: 11, rate: voice.rate, density: 0.35 });
        const n = Math.max(beat.samples.length, voice.samples.length + 2 * voice.rate), mix = new Float32Array(n);
        for (let i = 0; i < n; i++) mix[i] = (beat.samples[i] || 0) * 0.35 + (voice.samples[i - 2 * voice.rate] || 0) * 1.0;
        const out = D.normalizeCh([D.compress(mix, voice.rate, { threshold: -12, ratio: 2 })], 0, n, 0.95)[0];
        outWav(this, [out], voice.rate, 'song.wav', `${D.MUSIC_STYLES[style].label} + صوت AI`);
        return { samples: out, rate: voice.rate };
    };

    // ================================================================ KARAOKE (#690)
    P.fmxKaraoke = function () {
        const files = this.projectPaths().filter(p => isTextEntry(this.virtualProjectFiles.get(p)));
        return card('كاريوكي الكود', `<div class="text-dim">يقرأ الكود أو النص بصوت عالٍ مع إبراز كل كلمة لحظة نطقها — لتعلم القراءة والمراجعة الصوتية.</div>
                <div class="gh-row">${select('fmx-kc-path', 'الملف', files.map(p => [p, p]), this.activeStudioFile)}${select('fmx-kc-rate', 'السرعة', [['0.8', 'بطيئة'], ['1', 'عادية'], ['1.3', 'سريعة']], '1')}${pbtn('fa-play', 'ابدأ', 'app.fmxCodeKaraoke()')}${btn('fa-stop', 'إيقاف', 'app.fmxKaraokeStop()')}</div><pre id="fmx-kc-view" class="fmx-karaoke" dir="ltr"></pre>`, 'fa-microphone')
            + card('كاريوكي الأغاني', `<div class="gh-row"><label class="fmx-field"><span>الأغنية</span><input id="fmx-ks-audio" type="file" class="form-input-box" accept="audio/*"></label><label class="fmx-field"><span>كلمات LRC (اختياري)</span><input id="fmx-ks-lrc" type="file" class="form-input-box" accept=".lrc,.txt"></label><label class="gh-check"><input id="fmx-ks-novocal" type="checkbox"> إزالة صوت المغني</label>${pbtn('fa-play', 'تحميل', 'app.fmxSongKaraoke()')}</div>
                ${area('fmx-ks-text', 'أو الصق الكلمات (سطر لكل جملة) ثم اضغط «مزامنة» عند بداية كل سطر', '', 4, 'dir="auto"')}
                <div class="gh-row">${btn('fa-hand-pointer', 'مزامنة السطر التالي', 'app.fmxKaraokeTap()')}${btn('fa-download', 'حفظ LRC', 'app.fmxKaraokeSaveLRC()')}</div><audio id="fmx-ks-player" controls></audio><div id="fmx-ks-lines" class="fmx-ks-lines"></div>`, 'fa-music');
    };
    P.fmxCodeKaraoke = function (textArg) {
        const path = val('fmx-kc-path'), e = this.virtualProjectFiles.get(path);
        const text = textArg || (e && e.content) || '';
        const view = document.getElementById('fmx-kc-view');
        if (!text) return null;
        const spoken = text.slice(0, 6000);
        if (view) view.innerHTML = esc(spoken);
        const u = speak(spoken, { rate: +val('fmx-kc-rate') || 1, lang: AR_RE.test(spoken) ? 'ar-SA' : 'en-US', onboundary: (ev) => { if (!view || ev.name === 'sentence') return; const i = ev.charIndex, len = ev.charLength || (/^\S+/.exec(spoken.slice(i)) || [''])[0].length; view.innerHTML = `${esc(spoken.slice(0, i))}<mark class="fmx-kc-word">${esc(spoken.slice(i, i + len))}</mark>${esc(spoken.slice(i + len))}`; const m = view.querySelector('mark'); if (m && m.scrollIntoView) m.scrollIntoView({ block: 'center' }); }, onend: () => { if (view) view.innerHTML = esc(spoken); } });
        if (!u) this.showToast('المتصفح لا يدعم النطق', 'warning');
        return u;
    };
    P.fmxKaraokeStop = function () { stopSpeaking(); };
    P.fmxSongKaraoke = async function () {
        const f = filesOf('fmx-ks-audio')[0], lrc = filesOf('fmx-ks-lrc')[0], player = document.getElementById('fmx-ks-player');
        if (!f || !player) { this.showToast('اختر ملف الأغنية', 'warning'); return null; }
        let blob = f;
        if (val('fmx-ks-novocal')) { const a = await decodeAudio(f); if (a.channels.length > 1) { const r = D.separateStereo(a.channels[0], a.channels[1], a.sampleRate); blob = makeBlob([encodeWAV([r.instrumental], a.sampleRate)], 'audio/wav'); } }
        player.src = W().URL.createObjectURL(blob);
        this._fmxKLines = lrc ? D.parseLRC(new TextDecoder().decode(new Uint8Array(await lrc.arrayBuffer()))) : val('fmx-ks-text').split('\n').filter(Boolean).map(text => ({ t: null, text }));
        this._fmxKTap = 0;
        this.fmxKaraokeRender();
        player.ontimeupdate = () => this.fmxKaraokeRender(player.currentTime);
        return this._fmxKLines;
    };
    P.fmxKaraokeTap = function () { const p = document.getElementById('fmx-ks-player'), l = this._fmxKLines || []; if (!l.length) { this._fmxKLines = val('fmx-ks-text').split('\n').filter(Boolean).map(text => ({ t: null, text })); } const L = this._fmxKLines; const i = L.findIndex(x => x.t == null); if (i >= 0) L[i].t = p ? p.currentTime : 0; this.fmxKaraokeRender(p ? p.currentTime : 0); return L; };
    P.fmxKaraokeRender = function (t = 0) {
        const el = document.getElementById('fmx-ks-lines'), L = this._fmxKLines || [];
        let cur = -1; L.forEach((l, i) => { if (l.t != null && t >= l.t) cur = i; });
        if (el) { el.innerHTML = L.map((l, i) => `<div class="fmx-ks-line ${i === cur ? 'on' : ''} ${l.t == null ? 'pending' : ''}" dir="auto">${esc(l.text)}</div>`).join(''); const on = el.querySelector('.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'center' }); }
        return cur;
    };
    P.fmxKaraokeSaveLRC = function () { const L = (this._fmxKLines || []).filter(l => l.t != null); if (!L.length) return null; const text = D.toLRC(L); this.fmxOutput(makeBlob([text], 'text/plain'), 'lyrics.lrc', { preview: false, targetId: 'fmx-ks-lines' }); return text; };
}
