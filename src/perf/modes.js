/* Modes: kids mode with PIN + daily limit (#975), hands-free driving mode (#976), brightness control (#980). */
import { call, card, btn, pbtn, select, field, val, win, sha256Hex, utf8, lsGet, lsSet, dayKey } from './util.js';
import { parseVoiceCommand } from './audio.js';

// ------------------------------------------------------------------ PURE
export const KIDS_PROMPT = `\n\n[KIDS MODE] You are talking with a child (about 6–12 years old). Use short, simple, warm sentences in the child's language and encourage curiosity and learning.
Never produce violent, sexual, frightening, hateful or otherwise age-inappropriate content, and never help with dangerous activities. If asked, gently refuse and suggest asking a parent or teacher.
Never ask for or encourage sharing personal information (full name, address, school, phone, photos). Do not provide links to external sites.`;
export const validPin = (p) => /^\d{4,8}$/.test(String(p || ''));
export const pinHash = async (pin, salt) => sha256Hex(utf8(`ox-kids:${salt}:${pin}`));
/** Remaining kids minutes today. */
export const kidsRemaining = (limitMin, usedMs) => (limitMin ? Math.max(0, Math.round(limitMin - usedMs / 60000)) : Infinity);
/** Ambient light (lux) → app brightness 0.6–1.15 (log scale: dark room dims, sunlight boosts). */
export const luxToBrightness = (lux) => { const l = Math.max(0, +lux || 0); return Math.round(Math.max(0.6, Math.min(1.15, 0.6 + (Math.log10(l + 1) / Math.log10(10001)) * 0.55)) * 100) / 100; };
/** Night schedule: inside [from, to) (hours, may wrap midnight) → level, else 1. */
export const scheduleBrightness = (hour, { from = 21, to = 6, level = 0.8 } = {}) => ((from <= to ? hour >= from && hour < to : hour >= from || hour < to) ? level : 1);
export const EXIT_WORDS = /^(خروج|اخرج|انهاء|انهي وضع القياده|exit|quit)$/;

export function installModes(P) {
    const W = () => win();
    // ------------------------------------------------------------------ KIDS MODE (#975)
    P.pfKidsState = function () { return { day: '', ms: 0, ...lsGet('ox_perf_kids_v1', {}) }; };
    P.pfKidsUsed = function () { const s = this.pfKidsState(); return s.day === dayKey(Date.now()) ? s.ms : 0; };
    P.pfKids = function () {
        const s = this.settings, on = !!s.kidsMode, left = kidsRemaining(s.kidsLimit || 0, this.pfKidsUsed());
        return card('وضع الأطفال', on ? `<p>✅ <b>مفعّل</b> — ${s.kidsLimit ? `متبقٍ اليوم: <b>${left}</b> دقيقة من ${s.kidsLimit}` : 'بلا حد يومي'}</p><div class="gh-row">${pbtn('fa-lock-open', 'إيقاف (يتطلب الرمز)', call('pfKidsDisableUI'))}</div>`
            : `<p class="gh-muted">واجهة مبسطة بخط كبير، تُخفى الإعدادات وGitHub والطرفية والأدوات المتقدمة، ويُوجَّه المساعد لردود آمنة ومناسبة للأطفال، مع حد يومي للاستخدام. الخروج يتطلب رمز الوالدين.</p>
                <div class="fmx-grid2">${field('pfx-kids-pin', 'رمز الوالدين (4–8 أرقام)', '', 'type="password" inputmode="numeric" autocomplete="new-password"')}${select('pfx-kids-limit', 'الحد اليومي', [['0', 'بلا حد'], ['15', '15 دقيقة'], ['30', '30 دقيقة'], ['45', '45 دقيقة'], ['60', 'ساعة'], ['90', 'ساعة ونصف']], String(s.kidsLimit || 30))}</div>
                <div class="gh-row">${pbtn('fa-child-reaching', 'فعّل وضع الأطفال', call('pfKidsEnableUI'))}</div>`, 'fa-child-reaching')
            + card('ما الذي يتغير؟', '<ul class="pfx-steps"><li>تعليمات أمان دائمة للنموذج (لغة بسيطة، لا محتوى غير لائق، لا طلب بيانات شخصية)</li><li>إخفاء: الإعدادات، مفاتيح API، GitHub، الطرفية، الاستوديو، الحذف</li><li>خط أكبر وأزرار أوضح</li><li>قفل الشاشة عند انتهاء الوقت اليومي</li></ul><p class="gh-muted">ملاحظة صادقة: هذه حماية على مستوى التطبيق؛ لحماية الجهاز كاملاً استعمل Family Link (Android) أو مدة استخدام الجهاز (iOS).</p>', 'fa-shield-heart');
    };
    P.pfKidsEnable = async function (pin, limit = 30) {
        if (!validPin(pin)) throw new Error('الرمز يجب أن يكون من 4 إلى 8 أرقام');
        const salt = Math.random().toString(36).slice(2, 10);
        this.settings.kidsSalt = salt;
        this.settings.kidsPin = await pinHash(pin, salt);
        this.settings.kidsLimit = Math.max(0, parseInt(limit, 10) || 0);
        this.pfSet('kidsMode', true);
        this.pfKidsApply();
        return true;
    };
    P.pfKidsEnableUI = async function () {
        try { await this.pfKidsEnable(val('pfx-kids-pin'), val('pfx-kids-limit')); this.showToast('🧒 وضع الأطفال مفعّل', 'success'); if (this.closeModals) try { this.closeModals(); } catch (e) {} return true; } catch (e) { return this.pfErr(e); }
    };
    P.pfKidsCheckPin = async function (pin) { return !!this.settings.kidsPin && (await pinHash(String(pin || ''), this.settings.kidsSalt || '')) === this.settings.kidsPin; };
    P.pfKidsDisable = async function (pin) {
        if (!(await this.pfKidsCheckPin(pin))) { this._pfKidsFails = (this._pfKidsFails || 0) + 1; return false; }
        this._pfKidsFails = 0;
        this.settings.kidsPin = ''; this.settings.kidsSalt = '';
        this.pfSet('kidsMode', false);
        this.pfKidsApply(false);
        return true;
    };
    P.pfKidsAskPin = async function (title = 'رمز الوالدين') {
        if ((this._pfKidsFails || 0) >= 5 && Date.now() - (this._pfKidsFailT || 0) < 60000) { this.showToast('محاولات كثيرة — انتظر دقيقة', 'warning'); return null; }
        const r = await this.showDialog({ title, fields: [{ id: 'pin', label: 'الرمز', type: 'password', value: '' }], buttons: [{ label: 'تأكيد', value: 'ok', primary: true }, { label: 'إلغاء', value: null }] });
        if (!r) return null;
        return String((r.values || {}).pin || '');
    };
    P.pfKidsDisableUI = async function () {
        const pin = await this.pfKidsAskPin('إيقاف وضع الأطفال'); if (pin == null) return false;
        const ok = await this.pfKidsDisable(pin);
        if (!ok) { this._pfKidsFailT = Date.now(); this.showToast('❌ رمز غير صحيح', 'error'); return false; }
        this.showToast('🔓 أُوقف وضع الأطفال', 'success');
        if (this._pfx && this._pfx.sec === 'kids') this.pfRefresh();
        return true;
    };
    const GUARDED = ['openSettingsModal', 'openGitHubPro', 'openGitHubHub', 'toggleCodeStudio', 'deleteSession', 'openPlatform', 'openTrash'];
    P.pfKidsApply = function (on = !!this.settings.kidsMode) {
        document.body.classList.toggle('pfx-kids', on);
        this._kidsPrompt = on ? KIDS_PROMPT : '';
        clearInterval(this._pfKidsT);
        if (on) {
            GUARDED.forEach(name => {
                if (typeof this[name] !== 'function' || Object.prototype.hasOwnProperty.call(this, name)) return;
                this[name] = function () { this.showToast('🔒 غير متاح في وضع الأطفال', 'warning'); return null; };
            });
            let last = Date.now();
            this._pfKidsT = setInterval(() => {
                const now = Date.now(), dt = Math.min(now - last, 60000); last = now;
                if (document.hidden) return;
                const st = this.pfKidsState(), d = dayKey(now);
                if (st.day !== d) { st.day = d; st.ms = 0; }
                st.ms += dt; lsSet('ox_perf_kids_v1', st);
                if (this.settings.kidsLimit && kidsRemaining(this.settings.kidsLimit, st.ms) <= 0) this.pfKidsLock();
            }, 15000);
            if (this.settings.kidsLimit && kidsRemaining(this.settings.kidsLimit, this.pfKidsUsed()) <= 0) this.pfKidsLock();
        } else {
            GUARDED.forEach(name => { if (Object.prototype.hasOwnProperty.call(this, name)) delete this[name]; });
            const lock = document.getElementById('pfx-kids-lock'); if (lock) lock.remove();
        }
        return on;
    };
    P.pfKidsLock = function () {
        if (document.getElementById('pfx-kids-lock')) return true;
        const el = document.createElement('div');
        el.id = 'pfx-kids-lock'; el.className = 'pfx-kids-lock'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
        el.innerHTML = `<div><div class="pfx-kids-emoji">🌙</div><h2>انتهى وقت اليوم!</h2><p>أحسنت 👏 — نلتقي غداً. اطلب من أحد والديك إن احتجت وقتاً إضافياً.</p><button class="btn-new-thread gh-btn" onclick="app.pfKidsExtend()"><i class="fa-solid fa-key"></i> وقت إضافي (رمز الوالدين)</button></div>`;
        document.body.appendChild(el);
        if (this.stopCurrentSessionStream) try { this.stopCurrentSessionStream(); } catch (e) {}
        return true;
    };
    P.pfKidsExtend = async function (pin, minutes = 15) {
        if (pin == null) pin = await this.pfKidsAskPin('وقت إضافي (15 دقيقة)');
        if (pin == null) return false;
        if (!(await this.pfKidsCheckPin(pin))) { this._pfKidsFails = (this._pfKidsFails || 0) + 1; this._pfKidsFailT = Date.now(); this.showToast('❌ رمز غير صحيح', 'error'); return false; }
        const st = this.pfKidsState(); st.day = dayKey(Date.now()); st.ms = Math.max(0, st.ms - minutes * 60000); lsSet('ox_perf_kids_v1', st);
        const lock = document.getElementById('pfx-kids-lock'); if (lock) lock.remove();
        this.showToast(`⏱️ +${minutes} دقيقة`, 'success');
        return true;
    };

    // ------------------------------------------------------------------ HANDS-FREE DRIVING (#976)
    P.pfDriving = function () {
        const on = !!this._pfDrive, SR = W().SpeechRecognition || W().webkitSpeechRecognition;
        return card('وضع القيادة بدون لمس', `<p class="gh-muted">حلقة صوتية كاملة: تتكلم ← يُرسل تلقائياً ← يُقرأ الرد بصوت ← يستمع مجدداً. الشاشة تبقى مضاءة، والأزرار كبيرة. قل «توقف» لإسكات القراءة و«خروج» لإنهاء الوضع.</p>
                ${SR ? `<div class="gh-row">${on ? pbtn('fa-stop', 'إنهاء وضع القيادة', call('pfDriveStop')) : pbtn('fa-car', 'ابدأ وضع القيادة', call('pfDriveStart'))}</div>` : '<p class="pfx-warn">التعرف على الكلام غير مدعوم في هذا المتصفح</p>'}
                <label class="pfx-toggle"><input type="checkbox" ${this.settings.driveAutoSuggest !== false ? 'checked' : ''} onchange="app.pfSet('driveAutoSuggest', this.checked)"> <span>اقترح وضع القيادة عند رصد سرعة &gt; 20 كم/س (من «البوصلة و GPS»)</span></label>
                <p class="gh-muted">⚠️ لا تنظر إلى الشاشة أثناء القيادة. الردود الطويلة تُختصر للقراءة.</p>`, 'fa-car');
    };
    P.pfDriveOverlay = function (status, reply) {
        let ov = document.getElementById('pfx-drive');
        if (!ov) {
            ov = document.createElement('div'); ov.id = 'pfx-drive'; ov.className = 'pfx-drive'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'وضع القيادة');
            ov.innerHTML = `<div class="pfx-drive-top"><b><i class="fa-solid fa-car"></i> وضع القيادة</b><button onclick="app.pfDriveStop()" aria-label="خروج"><i class="fa-solid fa-xmark" aria-hidden="true"></i> خروج</button></div><div id="pfx-drive-status" class="pfx-drive-status" aria-live="assertive"></div><button class="pfx-drive-big" onclick="app.pfDriveTap()" aria-label="إيقاف / تحدث"><i class="fa-solid fa-microphone"></i></button><div id="pfx-drive-reply" class="pfx-drive-reply" dir="auto"></div>`;
            document.body.appendChild(ov);
        }
        if (status != null) { const s = document.getElementById('pfx-drive-status'); if (s) s.textContent = status; }
        if (reply != null) { const r = document.getElementById('pfx-drive-reply'); if (r) r.textContent = reply; }
        return ov;
    };
    const plainText = (app, md) => (app.speakableText ? app.speakableText(md) : String(md || '').replace(/```[\s\S]*?```/g, ' . كتلة كود . ').replace(/[#*_`>|[\]()-]/g, ' ')).replace(/\s+/g, ' ').slice(0, 900);
    P.pfDriveSpeak = function (text) {
        return new Promise((resolve) => {
            const ss = W().speechSynthesis, U = W().SpeechSynthesisUtterance;
            if (!ss || !U || !text) return resolve(false);
            try { ss.cancel(); } catch (e) {}
            const u = new U(text); u.lang = this.settings.voiceLang || (/[\u0600-\u06FF]/.test(text) ? 'ar-SA' : 'en-US'); u.rate = 1.02;
            u.onend = () => resolve(true); u.onerror = () => resolve(false);
            this._pfDriveUtter = u;
            ss.speak(u);
        });
    };
    P.pfDriveListen = function () {
        const d = this._pfDrive; if (!d) return;
        const SR = W().SpeechRecognition || W().webkitSpeechRecognition;
        const rec = new SR(); rec.lang = this.settings.voiceLang || 'ar-SA'; rec.interimResults = false; rec.continuous = false;
        if (this.settings.offlineVoice) try { rec.processLocally = true; } catch (e) {}
        d.rec = rec; d.state = 'listening'; let got = false;
        this.pfDriveOverlay('🎙️ أستمع…');
        rec.onresult = (e) => { got = true; this.pfDriveHeard(Array.from(e.results).map(r => r[0].transcript).join(' ').trim()); };
        rec.onerror = (e) => { if (e.error === 'not-allowed') { this.pfDriveStop(); this.showToast('رُفض إذن الميكروفون', 'warning'); } };
        rec.onend = () => { if (!got && this._pfDrive === d && d.state === 'listening') setTimeout(() => this.pfDriveListen(), 300); };
        try { rec.start(); } catch (e) { setTimeout(() => this.pfDriveListen(), 800); }
    };
    P.pfDriveHeard = async function (text) {
        const d = this._pfDrive; if (!d || !text) return null;
        const n = text.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/[.,!?؟،]/g, '').trim();
        if (EXIT_WORDS.test(n)) { this.pfDriveStop(); return 'exit'; }
        const cmd = parseVoiceCommand(text);
        if (cmd && cmd.action !== 'ask' && cmd.action !== 'type') {
            if (cmd.action === 'speak') { const s = (this.sessions || []).find(x => x.id === this.activeSessionId); const m = s && (s.messages || []).slice().reverse().find(x => x.role === 'assistant'); d.state = 'speaking'; await this.pfDriveSpeak(m ? plainText(this, m.content) : 'لا يوجد رد'); }
            else if (this.pfRunVoiceCommand) this.pfRunVoiceCommand(cmd, text);
            if (this._pfDrive === d) this.pfDriveListen();
            return cmd.action;
        }
        const q = cmd ? cmd.arg : text;
        d.state = 'thinking';
        this.pfDriveOverlay('🤔 أفكر…', '«' + q + '»');
        const before = (this.sessions || []).find(x => x.id === this.activeSessionId);
        const count = before ? (before.messages || []).length : 0;
        try { await this.sendUserMessage(q); } catch (e) { /* surfaced by the chat */ }
        // wait for the stream to finish (sendUserMessage may resolve early)
        const t0 = Date.now();
        while (this._pfDrive === d && Date.now() - t0 < 180000 && ((this.activeStreams && this.activeStreams.size) || Date.now() - t0 < 600)) await new Promise(r => setTimeout(r, 300));
        if (this._pfDrive !== d) return 'stopped';
        const s = (this.sessions || []).find(x => x.id === this.activeSessionId);
        const reply = s && (s.messages || []).length > count ? (s.messages || []).slice().reverse().find(x => x.role === 'assistant') : null;
        const txt = reply ? plainText(this, reply.content) : 'لم يصل رد';
        d.state = 'speaking';
        this.pfDriveOverlay('🔊 أقرأ الرد… (المس الزر للإيقاف)', txt.slice(0, 300));
        await this.pfDriveSpeak(txt);
        if (this._pfDrive === d) this.pfDriveListen();
        return 'sent';
    };
    P.pfDriveTap = function () {
        const d = this._pfDrive; if (!d) return null;
        if (d.state === 'speaking') { try { W().speechSynthesis.cancel(); } catch (e) {} return 'muted'; }
        if (d.state === 'thinking') { this.pfAction('stop'); return 'stopped'; }
        return 'listening';
    };
    P.pfDriveStart = async function () {
        const SR = W().SpeechRecognition || W().webkitSpeechRecognition;
        if (!SR) { this.showToast('التعرف على الكلام غير مدعوم', 'warning'); return null; }
        if (this._pfDrive) return this._pfDrive;
        this._pfDrive = { state: 'idle' };
        document.body.classList.add('driving-mode');
        if (this.pfWakeLock) this.pfWakeLock(true);
        if (this.closeModals) try { this.closeModals(); } catch (e) {}
        this.pfDriveOverlay('جاهز', '');
        this._pfDrive.state = 'speaking';
        await this.pfDriveSpeak('وضع القيادة جاهز. تفضل.');
        if (this._pfDrive) this.pfDriveListen();
        return this._pfDrive;
    };
    P.pfDriveStop = function () {
        const d = this._pfDrive; if (!d) return false;
        this._pfDrive = null;
        try { if (d.rec) d.rec.abort ? d.rec.abort() : d.rec.stop(); } catch (e) {}
        try { W().speechSynthesis.cancel(); } catch (e) {}
        if (this.pfWakeLock) this.pfWakeLock(false);
        document.body.classList.remove('driving-mode');
        const ov = document.getElementById('pfx-drive'); if (ov) ov.remove();
        this.showToast('🚗 انتهى وضع القيادة', 'info');
        return true;
    };

    // ------------------------------------------------------------------ BRIGHTNESS (#980)
    P.pfBrightness = function () {
        const s = this.settings, v = +s.appBrightness || 1, auto = s.autoBrightness || 'off';
        const hasALS = !!W().AmbientLightSensor;
        return card('سطوع التطبيق', `<label class="fmx-field"><span>السطوع: <b id="pfx-br-v">${Math.round(v * 100)}%</b></span><input type="range" min="30" max="130" step="5" value="${Math.round(v * 100)}" oninput="app.pfSetBrightness(this.value / 100)" aria-label="السطوع"></label>
                <div class="gh-row">${[[0.6, '🌙 ليلي'], [0.85, 'مريح'], [1, 'عادي'], [1.15, '☀️ ساطع']].map(([b, l]) => btn('fa-sun', l, call('pfSetBrightness', b))).join('')}</div>
                <p class="gh-muted">بصراحة: المتصفح لا يستطيع تغيير إضاءة الشاشة نفسها؛ هذا مرشح سطوع على التطبيق كله (يقلل الوهج ليلاً ويرفع الوضوح في الشمس). يمكنك أيضاً استعمال «إبقاء الشاشة مضاءة».</p>`, 'fa-sun')
            + card('سطوع تلقائي', `${select('pfx-br-auto', 'الوضع', [['off', 'يدوي'], ['schedule', 'جدول ليلي'], ...(hasALS ? [['sensor', 'مستشعر الإضاءة المحيطة']] : [])], auto, `onchange="app.pfSetAutoBrightness(this.value)"`)}
                <div class="fmx-grid4">${field('pfx-br-from', 'من الساعة', String(s.nightFrom != null ? s.nightFrom : 21), 'type="number" min="0" max="23" onchange="app.pfSet(\'nightFrom\', +this.value)"')}${field('pfx-br-to', 'إلى الساعة', String(s.nightTo != null ? s.nightTo : 6), 'type="number" min="0" max="23" onchange="app.pfSet(\'nightTo\', +this.value)"')}${field('pfx-br-level', 'سطوع الليل %', String(Math.round((s.nightLevel || 0.8) * 100)), 'type="number" min="30" max="100" onchange="app.pfSet(\'nightLevel\', this.value / 100)"')}</div>
                ${hasALS ? '' : '<p class="gh-muted">مستشعر الإضاءة المحيطة غير متاح في هذا المتصفح (متاح في Chrome مع تفعيل الميزات التجريبية).</p>'}
                <div class="gh-row">${btn('fa-lightbulb', s.keepAwake ? 'إبقاء الشاشة مضاءة ✓' : 'إبقاء الشاشة مضاءة', call('pfToggleAwake'))}</div>`, 'fa-circle-half-stroke');
    };
    P.pfSetBrightness = function (v) {
        const b = Math.max(0.3, Math.min(1.3, +v || 1));
        this.settings.appBrightness = b;
        clearTimeout(this._pfBrSave); this._pfBrSave = setTimeout(() => this.pfSet('appBrightness', b), 300);
        this.pfApplyBrightness(b);
        const l = document.getElementById('pfx-br-v'); if (l) l.textContent = Math.round(b * 100) + '%';
        return b;
    };
    P.pfSetAutoBrightness = function (mode) { this.pfSet('autoBrightness', mode); this.pfAutoBrightness(); return mode; };
    P.pfAutoBrightness = function () {
        const mode = this.settings.autoBrightness || 'off', s = this.settings;
        clearInterval(this._pfBrT);
        if (this._pfALS) { try { this._pfALS.stop(); } catch (e) {} this._pfALS = null; }
        if (mode === 'schedule') {
            const tick = () => this.pfApplyBrightness((+s.appBrightness || 1) * scheduleBrightness(new Date().getHours(), { from: s.nightFrom != null ? s.nightFrom : 21, to: s.nightTo != null ? s.nightTo : 6, level: s.nightLevel || 0.8 }));
            tick(); this._pfBrT = setInterval(tick, 5 * 60000);
        } else if (mode === 'sensor' && W().AmbientLightSensor) {
            try {
                const als = new (W().AmbientLightSensor)({ frequency: 0.5 });
                als.addEventListener('reading', () => this.pfApplyBrightness(luxToBrightness(als.illuminance)));
                als.addEventListener('error', () => { this.pfSet('autoBrightness', 'schedule'); this.pfAutoBrightness(); });
                als.start(); this._pfALS = als;
            } catch (e) { /* permission */ }
        } else this.pfApplyBrightness();
        return mode;
    };
    P.pfToggleAwake = async function () {
        const on = !this.settings.keepAwake;
        this.pfSet('keepAwake', on);
        const r = this.pfWakeLock ? await this.pfWakeLock(on) : false;
        if (on && !r) this.showToast('المتصفح لا يدعم إبقاء الشاشة مضاءة', 'warning');
        if (this._pfx && this._pfx.sec === 'brightness') this.pfRefresh();
        return on;
    };
}
