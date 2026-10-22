/* Multimodal + input helpers: design image → HTML/CSS (#38), tutorial video → code (#39),
   hands-free voice agent (#37), Copilot-style ghost autocomplete in the chat input (#31). */
import { esc, parseFileBlocks } from './shared.js';

/** Clean an autocomplete continuation: one line-ish, no echo of the prefix, no quotes/fences. */
export function cleanCompletion(prefix, raw) {
    let s = String(raw || '').replace(/^```\w*\n?|```$/g, '').replace(/^["'«]|["'»]$/g, '');
    const tail = prefix.slice(-40);
    if (tail && s.startsWith(tail)) s = s.slice(tail.length);
    else if (s.startsWith(prefix)) s = s.slice(prefix.length);
    s = s.split('\n')[0];
    return s.slice(0, 120);
}

/** Voice command → action name (local, no model call). */
export function voiceCommand(text) {
    const t = String(text || '').trim().toLowerCase();
    if (/^(توقف|اسكت|إيقاف|stop|quiet)(?=\s|$|[.,!،؟?])/.test(t)) return { action: 'stop' };
    if (/^(خروج|أغلق الوكيل|انهاء|إنهاء|exit|bye)(?=\s|$|[.,!،؟?])/.test(t)) return { action: 'exit' };
    if (/(محادثة جديدة|new chat)/.test(t)) return { action: 'new' };
    if (/^(أعد|كرر|repeat)(?=\s|$|[.,!،؟?])/.test(t)) return { action: 'repeat' };
    if (/^(شغل|شغّل|نفذ|نفّذ) (الكود|الملف)|^run (the )?(code|file)/.test(t)) return { action: 'run' };
    const m = /^(?:افتح|open) (?:الملف |file )?([\w./-]+\.\w+)/.exec(t);
    if (m) return { action: 'open', arg: m[1] };
    return { action: 'ask', text: String(text || '').trim() };
}

export function installMedia(P) {
    P.cleanCompletion = cleanCompletion;
    P.voiceCommand = voiceCommand;

    // ================================================================== VISION (#38 #39)
    P.openVisionTool = function (kind = 'image') {
        if (!document.getElementById('ai-lab')) this.openAILab('generators');
        const root = document.getElementById('ai-lab');
        if (!root) return false;
        this._vision = { kind, images: [] };
        const att = (this.currentAttachments || []).filter(a => a.isImage && a.base64);
        if (kind === 'image' && att.length) this._vision.images = att.map(a => a.base64).slice(0, 4);
        root.innerHTML = `<div class="ai-gen-form" data-gen="vision-${kind}">
            <button class="fx-link" onclick="app.renderGeneratorsTab(document.getElementById('ai-lab'))"><i class="fa-solid fa-arrow-right"></i> كل المولدات</button>
            <h3><i class="fa-solid ${kind === 'video' ? 'fa-film' : 'fa-image'}"></i> ${kind === 'video' ? 'تحويل فيديو شرح إلى كود' : 'تحويل صورة تصميم إلى HTML/CSS'} <small class="gh-muted">#${kind === 'video' ? 39 : 38}</small></h3>
            <label class="ai-drop"><input type="file" accept="${kind === 'video' ? 'video/*' : 'image/*'}" ${kind === 'image' ? 'multiple' : ''} onchange="app.visionPick(this.files)" hidden><i class="fa-solid fa-cloud-arrow-up"></i> ${kind === 'video' ? 'اختر فيديو (تُلتقط منه لقطات تلقائياً)' : 'اختر صورة/لقطة شاشة للتصميم (أو أرفقها في المحادثة)'}</label>
            <div id="vision-thumbs" class="ai-thumbs"></div>
            ${kind === 'video' ? '<label class="ai-field"><span>نص الشرح/التفريغ (اختياري)</span><textarea id="vision-transcript" class="form-input-box" rows="3" dir="auto"></textarea></label><label class="ai-field"><span>عدد اللقطات</span><input id="vision-frames" type="number" min="2" max="8" value="6" class="form-input-box"></label>' : ''}
            <label class="ai-field"><span>${kind === 'video' ? 'اللغة/الإطار المتوقع' : 'التقنية'}</span><select id="vision-stack" class="form-input-box">${(kind === 'video' ? ['اكتشف تلقائياً', 'JavaScript', 'Python', 'React', 'HTML/CSS', 'Flutter'] : ['HTML + CSS', 'HTML + Tailwind CDN', 'React + CSS Modules', 'Vue 3 SFC']).map(o => `<option>${o}</option>`).join('')}</select></label>
            <div class="gh-toolbar"><button class="btn-new-thread gh-btn" onclick="app.runVision()"><i class="fa-solid fa-wand-magic-sparkles"></i> حوّل إلى كود</button><button class="sidebar-btn-util gh-btn" onclick="app.stopAI()"><i class="fa-solid fa-stop"></i></button></div>
            <div id="ai-gen-output" class="ai-output"></div><iframe id="vision-preview" class="ai-preview" sandbox="allow-scripts" title="معاينة" hidden></iframe></div>`;
        this.renderVisionThumbs();
        return true;
    };
    P.renderVisionThumbs = function () {
        const el = document.getElementById('vision-thumbs');
        if (el && this._vision) el.innerHTML = this._vision.images.map((src, i) => `<img src="${esc(src)}" alt="لقطة ${i + 1}">`).join('');
    };
    const readAsDataURL = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
    P.visionPick = async function (files) {
        if (!this._vision || !files || !files.length) return 0;
        if (this._vision.kind === 'video') {
            const n = +((document.getElementById('vision-frames') || {}).value || 6);
            this._vision.images = await this.extractVideoFrames(files[0], n);
        } else {
            this._vision.images = [];
            for (const f of Array.from(files).slice(0, 4)) { const d = await readAsDataURL(f); this._vision.images.push(this.compressImageDataUrl ? await this.compressImageDataUrl(d, 1600).catch(() => d) : d); }
        }
        this.renderVisionThumbs();
        return this._vision.images.length;
    };
    /** Capture n evenly spaced frames from a video file as JPEG data URLs (browser only). */
    P.extractVideoFrames = async function (file, n = 6) {
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.muted = true; video.preload = 'auto'; video.src = url;
        await new Promise((res, rej) => { video.onloadedmetadata = res; video.onerror = () => rej(new Error('تعذر قراءة الفيديو')); });
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 1280 / (video.videoWidth || 1280));
        canvas.width = Math.round((video.videoWidth || 1280) * scale); canvas.height = Math.round((video.videoHeight || 720) * scale);
        const ctx = canvas.getContext('2d');
        const frames = [];
        const dur = video.duration || 1;
        for (let i = 0; i < n; i++) {
            video.currentTime = Math.min(dur - 0.05, (dur * (i + 0.5)) / n);
            await new Promise(r => { video.onseeked = r; });
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            frames.push(canvas.toDataURL('image/jpeg', 0.75));
        }
        URL.revokeObjectURL(url);
        return frames;
    };
    P.runVision = async function () {
        const v = this._vision;
        if (!v || !v.images.length) { this.showToast('اختر صورة أو فيديو أولاً', 'warning'); return null; }
        const stack = (document.getElementById('vision-stack') || {}).value || 'HTML + CSS';
        const transcript = (document.getElementById('vision-transcript') || {}).value || '';
        const prompt = v.kind === 'video'
            ? `These ${v.images.length} frames are taken in order from a programming tutorial video.${transcript ? `\nNarration/transcript:\n${transcript.slice(0, 6000)}` : ''}\nReconstruct the code being written/shown (language: ${stack}). Read code visible on screen carefully, fill gaps sensibly, and make it complete and runnable. Explain in Arabic what the tutorial builds, then output each file as \`\`\`lang [path] blocks.`
            : `Convert this UI design screenshot into a faithful, responsive implementation using ${stack}. Match layout, spacing, colours, typography and icons (use Font Awesome / inline SVG). Semantic, accessible markup; RTL-aware if the text is Arabic. Output each file as \`\`\`lang [path] blocks (e.g. \`\`\`html [index.html], \`\`\`css [styles.css]). Make index.html self-contained enough to preview (link styles.css).`;
        const out = document.getElementById('ai-gen-output');
        this._aiAbort = new AbortController();
        const text = await this.aiRun(prompt, { images: v.images, kind: 'coding', maxTokens: 9000, signal: this._aiAbort.signal, source: 'vision-' + v.kind, onDelta: (c) => { if (out) out.innerHTML = `<div class="ai-result gh-md">${this.renderMarkdownSafe ? this.renderMarkdownSafe(c) : esc(c)}</div>`; } });
        if (text == null) return null;
        this._aiOut = text;
        this._aiOutTitle = v.kind === 'video' ? 'فيديو ← كود' : 'تصميم ← كود';
        const files = parseFileBlocks(text);
        if (out) out.innerHTML = this.aiResultHTML(text, { files });
        const html = files.find(f => /\.html?$/.test(f.path));
        const frame = document.getElementById('vision-preview');
        if (html && frame) {
            const css = files.filter(f => /\.css$/.test(f.path)).map(f => f.content).join('\n');
            frame.hidden = false;
            frame.srcdoc = html.content.replace(/<link[^>]+href=["'][^"']*\.css["'][^>]*>/gi, '').replace(/<\/head>/i, `<style>${css}</style></head>`);
        }
        return { text, files };
    };

    // ================================================================== VOICE AGENT (#37)
    P.startVoiceAgent = function () {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR || !('speechSynthesis' in window)) { this.showToast('المتصفح لا يدعم التعرف على الصوت/النطق — جرّب Chrome', 'warning'); return false; }
        this.stopVoiceAgent(true);
        this._voiceAgent = { on: true, lang: /^(fr)/.test(navigator.language || '') ? 'fr-FR' : 'ar-SA' };
        let ov = document.getElementById('ox-voice-agent');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'ox-voice-agent'; ov.className = 'ox-voice-agent';
            ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'الوكيل الصوتي');
            ov.innerHTML = `<div class="va-orb" id="va-orb"><i class="fa-solid fa-microphone"></i></div><div class="va-status" id="va-status" aria-live="assertive">أستمع…</div><div class="va-heard" id="va-heard" dir="auto"></div>
                <div class="va-hint">قل: «توقف»، «أعد»، «محادثة جديدة»، «شغّل الكود»، «افتح الملف app.js»، «خروج» — أو اسأل أي شيء</div><button class="banner-btn-action" onclick="app.stopVoiceAgent()">إنهاء</button>`;
            document.body.appendChild(ov);
        }
        this.voiceAgentListen();
        return true;
    };
    P.stopVoiceAgent = function (silent) {
        if (this._voiceAgent) { this._voiceAgent.on = false; try { this._voiceAgent.rec && this._voiceAgent.rec.abort(); } catch (e) { /* ignore */ } }
        clearInterval(this._vaPoll);
        this._voiceAgent = null;
        const ov = document.getElementById('ox-voice-agent');
        if (ov) ov.remove();
        try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
        if (!silent) this.showToast('تم إنهاء الوكيل الصوتي', 'info');
        return true;
    };
    const vaStatus = (t, cls) => { const s = document.getElementById('va-status'); if (s) s.textContent = t; const o = document.getElementById('va-orb'); if (o) o.className = 'va-orb ' + (cls || ''); };
    P.voiceAgentListen = function () {
        const va = this._voiceAgent;
        if (!va || !va.on) return false;
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        const rec = new SR();
        rec.lang = va.lang; rec.interimResults = true; rec.continuous = false;
        va.rec = rec;
        let final = '';
        rec.onresult = (e) => {
            const r = Array.from(e.results).map(x => x[0].transcript).join(' ');
            const h = document.getElementById('va-heard'); if (h) h.textContent = r;
            if (e.results[e.results.length - 1].isFinal) final = r;
        };
        rec.onerror = () => { };
        rec.onend = () => { if (!this._voiceAgent || !this._voiceAgent.on) return; if (final.trim()) this.voiceAgentHandle(final); else setTimeout(() => this.voiceAgentListen(), 300); };
        vaStatus('🎙️ أستمع…', 'listening');
        try { rec.start(); } catch (e) { return false; }
        return true;
    };
    P.voiceAgentSpeak = function (text, then) {
        const u = new SpeechSynthesisUtterance('');
        const plain = String(text || '').replace(/```[\s\S]*?```/g, ' (كود) ').replace(/[#*_`>|-]+/g, ' ').replace(/\s+/g, ' ').slice(0, 1500);
        u.text = plain;
        u.lang = /[\u0600-\u06FF]/.test(plain) ? 'ar-SA' : 'en-US';
        u.onend = () => { if (then) then(); };
        vaStatus('🔊 أتحدث…', 'speaking');
        try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } catch (e) { if (then) then(); }
    };
    /** Execute a recognised utterance: local command or a chat question; then speak + listen again. */
    P.voiceAgentHandle = async function (text) {
        const cmd = voiceCommand(text);
        const again = () => setTimeout(() => this.voiceAgentListen(), 250);
        if (cmd.action === 'exit') return this.stopVoiceAgent();
        if (cmd.action === 'stop') { try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } if (this.stopCurrentSessionStream) this.stopCurrentSessionStream(); again(); return cmd; }
        if (cmd.action === 'new') { this.createNewSession(true); this.voiceAgentSpeak('بدأت محادثة جديدة', again); return cmd; }
        if (cmd.action === 'repeat') { const s = this.sessions.find(x => x.id === this.activeSessionId); const last = s && [...s.messages].reverse().find(m => m.role === 'assistant'); this.voiceAgentSpeak(last ? last.content : 'لا يوجد رد بعد', again); return cmd; }
        if (cmd.action === 'run') { if (this.activeStudioFile) { this.studio('runCode', { path: this.activeStudioFile, record: true, source: 'voice' }).then(r => this.voiceAgentSpeak(r && r.success ? 'تم التشغيل بنجاح' : `فشل التشغيل: ${(r && r.error) || ''}`, again)); } else this.voiceAgentSpeak('افتح ملفاً في الاستوديو أولاً', again); return cmd; }
        if (cmd.action === 'open') { const p = Array.from(this.virtualProjectFiles.keys()).find(k => k.toLowerCase().endsWith(cmd.arg.toLowerCase())); if (p) { this.openProjectFile(p); this.voiceAgentSpeak('فتحت ' + p, again); } else this.voiceAgentSpeak('لم أجد الملف ' + cmd.arg, again); return cmd; }
        vaStatus('⏳ أفكر…', 'thinking');
        const sid = this.activeSessionId;
        await this.sendUserMessage(cmd.text);
        const s = this.sessions.find(x => x.id === sid);
        const last = s && [...s.messages].reverse().find(m => m.role === 'assistant');
        if (this._voiceAgent && this._voiceAgent.on) this.voiceAgentSpeak(last && last.content ? last.content : 'لم يصل رد', again);
        return cmd;
    };

    // ================================================================== AUTOCOMPLETE (#31)
    P.aiComplete = async function (prefix, { signal } = {}) {
        const text = String(prefix || '');
        if (text.trim().length < 6 || !this.settings.apiKey) return '';
        const s = this.sessions && this.sessions.find(x => x.id === this.activeSessionId);
        const ctx = s ? s.messages.filter(m => m.content).slice(-2).map(m => `${m.role}: ${String(m.content).slice(0, 300)}`).join('\n') : '';
        const model = (this.availableModels || []).find(m => m.is_free && /flash|mini|small|8b|gemma/i.test(m.id));
        try {
            const r = await this.streamOpenRouter({ model: (this.getAISettings().model) || (model && model.id) || this.settings.model, maxTokens: 40, signal, messages: [
                { role: 'system', content: 'You are an autocomplete engine for a chat input. Continue the user\'s unfinished message with the most likely next few words (max 12 words), same language. Output ONLY the continuation text, nothing else.' },
                { role: 'user', content: `${ctx ? `Recent conversation:\n${ctx}\n\n` : ''}Unfinished message:\n${text}` }] });
            return cleanCompletion(text, r.content || '');
        } catch (e) { return ''; }
    };
}
