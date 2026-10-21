/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 7c: Delight, time, dev tools, view controls, modes
   Ideas implemented (THOUSAND_IDEAS.md):
     #359 driving mode   #361 copy animation   #362 save animation   #363 confetti
     #364 progress bars   #365 live counter   #368 levels / XP   #369 daily challenges   #370 rewards
     #371 developer mode HUD   #372 performance (FPS / long tasks)   #373 memory   #374 DOM
     #375 load time   #376 errors   #377 inspect mode   #378 device emulator
     #379 slow-network simulation   #380 offline simulation
     #381 density (12)   #382 hide details   #383 expand / collapse all   #385/#388 export as image + share
     #386 print styles   #389 fullscreen   #390 Picture-in-Picture mini chat
     #391 daily reminder   #392 time-based suggestions   #393 greeting   #394 seasonal themes
     #395 Hijri / Gregorian events   #396 tips   #397 quotes   #398 daily stats card
     #401 learn mode   #403 quiz mode   #405 game mode   #406 story mode   #408 audio mode
   ============================================================================== */
(function () {
    'use strict';
    if (typeof OXAlphaApp === 'undefined') return;
    const P = OXAlphaApp.prototype;
    const DAY = 864e5;
    const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
    const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
    const dkey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const dayOfYear = (t) => { const d = new Date(t); return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / DAY); };

    // ------------------------------------------------------------------ CHAT MODES (#401 #403 #405 #406)
    if (P.CHAT_MODES) Object.assign(P.CHAT_MODES, {
        learn: { icon: 'fa-graduation-cap', label: 'تعلّم', prompt: 'LEARN MODE: act as a structured tutor. First ask (once) about the learner\'s level and goal, then build a short syllabus (3-6 lessons). Teach one lesson at a time with a clear explanation, a tiny runnable example and 1-2 check questions. Wait for answers, give feedback, track progress ("Lesson 2/5") and adapt difficulty.' },
        quiz: { icon: 'fa-list-check', label: 'اختبار', prompt: 'QUIZ MODE: quiz the user on the topic they choose. Ask exactly ONE multiple-choice question at a time (A-D), wait for the answer, say if it is correct with a one-line explanation, keep a running score ("Score: 3/4"), and after 10 questions give a summary with weak areas to review.' },
        game: { icon: 'fa-gamepad', label: 'لعبة', prompt: 'GAME MODE: run an interactive text adventure that teaches programming. The player progresses through rooms; each door is unlocked by solving a small coding puzzle or predicting code output. Keep scenes short and fun, track inventory/XP, offer hints on request, and never reveal answers before an attempt.' },
        story: { icon: 'fa-book', label: 'قصة', prompt: 'STORY MODE: explain the requested technical concept as an engaging short story with characters and a plot (e.g. data packets travelling through a city). Keep the technical facts accurate, end with a short "What we learned" recap and a small code example that maps to the story.' }
    });

    // ------------------------------------------------------------------ CONFETTI (#363) + COPY / SAVE ANIMATIONS (#361 #362)
    P.confetti = function (opts = {}) {
        if (this.prefersReducedMotion && this.prefersReducedMotion()) return 0;
        const count = clamp(opts.count || 80, 10, 200);
        const stars = this.hasReward && this.hasReward('stars');
        const host = document.createElement('div');
        host.className = 'ox-confetti';
        host.setAttribute('aria-hidden', 'true');
        const colors = ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f472b6', '#22d3ee'];
        for (let i = 0; i < count; i++) {
            const s = document.createElement('span');
            s.className = stars ? 'cf-star' : 'cf-piece';
            if (stars) s.textContent = '★';
            s.style.cssText = `left:${Math.random() * 100}%;--cf-c:${colors[i % colors.length]};--cf-x:${(Math.random() - 0.5) * 260}px;--cf-r:${Math.round(Math.random() * 720)}deg;animation-delay:${(Math.random() * 0.35).toFixed(2)}s;animation-duration:${(1.6 + Math.random() * 1.2).toFixed(2)}s`;
            host.appendChild(s);
        }
        document.body.appendChild(host);
        setTimeout(() => host.remove(), 3200);
        return count;
    };
    P.floatBadge = function (anchor, text) {
        if (!anchor || !anchor.getBoundingClientRect) return null;
        const r = anchor.getBoundingClientRect();
        const b = document.createElement('div');
        b.className = 'ox-float-badge';
        b.textContent = text;
        b.style.left = (r.left + r.width / 2) + 'px';
        b.style.top = r.top + 'px';
        document.body.appendChild(b);
        setTimeout(() => b.remove(), 900);
        return b;
    };
    const _origCopy = P.copyToClipboard;
    P.copyToClipboard = function (text, btnElement) {
        const r = _origCopy.apply(this, arguments);
        if (btnElement && btnElement.classList) {
            btnElement.classList.remove('copy-pop'); void btnElement.offsetWidth; btnElement.classList.add('copy-pop');
            setTimeout(() => btnElement.classList.remove('copy-pop'), 700);
            if (!(this.prefersReducedMotion && this.prefersReducedMotion())) this.floatBadge(btnElement, '✓');
        }
        return r;
    };
    P.flashSaved = function () {
        const top = document.querySelector('#code-studio-pane .studio-topbar');
        if (!top) return false;
        let el = document.getElementById('save-indicator');
        if (!el) { el = document.createElement('span'); el.id = 'save-indicator'; el.className = 'save-indicator'; el.setAttribute('role', 'status'); top.appendChild(el); }
        el.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i> حُفظ';
        el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
        clearTimeout(this._saveFlashT);
        this._saveFlashT = setTimeout(() => el.classList.remove('show'), 1600);
        return true;
    };
    const _origSaveNow = P.saveProjectNow;
    if (_origSaveNow) {
        P.saveProjectNow = async function () {
            const r = await _origSaveNow.apply(this, arguments);
            if (this.isCodeStudioOpen) this.flashSaved();
            return r;
        };
    }

    // ------------------------------------------------------------------ XP / LEVELS (#368) + PROGRESS (#364) + REWARDS (#370)
    const GAME_KEY = 'ox_alpha_game_v1';
    P.getGame = function () {
        if (!this._game) this._game = { xp: 0, daily: {}, challenges: {}, streak: 0, lastChallenge: '', goalHit: {}, ...lsGet(GAME_KEY, {}) };
        return this._game;
    };
    P.saveGame = function () { const g = this.getGame(); const keys = Object.keys(g.daily).sort(); while (keys.length > 60) delete g.daily[keys.shift()]; lsSet(GAME_KEY, g); };
    P.levelFor = function (xp) { return Math.floor(Math.sqrt(Math.max(0, xp) / 40)) + 1; };
    P.xpForLevel = function (level) { return 40 * Math.pow(Math.max(0, level - 1), 2); };
    P.progressInfo = function (xp = this.getGame().xp) {
        const level = this.levelFor(xp), cur = this.xpForLevel(level), next = this.xpForLevel(level + 1);
        return { level, xp, cur, next, pct: Math.round((xp - cur) / Math.max(1, next - cur) * 100) };
    };
    const DAILY_CAPS = { message: 60, reply: 40, run: 45 };
    P.addXP = function (n, reason = 'misc', now = Date.now()) {
        const g = this.getGame();
        const day = dkey(now);
        g.daily[day] = g.daily[day] || {};
        const used = g.daily[day][reason] || 0;
        const cap = DAILY_CAPS[reason];
        const gain = cap ? Math.max(0, Math.min(n, cap - used)) : n;
        if (!gain) return 0;
        g.daily[day][reason] = used + gain;
        const before = this.levelFor(g.xp);
        g.xp += gain;
        const after = this.levelFor(g.xp);
        this.saveGame();
        if (after > before) this.onLevelUp(after);
        this.updateLiveStats();
        return gain;
    };
    P.onLevelUp = function (level) {
        this.confetti({ count: 120 });
        const unlocked = this.REWARDS.filter(r => r.level === level);
        unlocked.forEach(r => { if (r.type === 'theme') this.installRewardTheme(r); });
        const extra = unlocked.length ? ` — فُتحت: ${unlocked.map(r => r.label).join('، ')}` : '';
        if (this.notify) this.notify(`🎉 المستوى ${level}`, `ارتقيت إلى المستوى ${level}${extra}`, { type: 'success', desktop: false, icon: 'fa-trophy text-warning' });
        this.showToast(`🎉 <b>المستوى ${level}!</b>${this.escapeHTML(extra)}`, 'success');
    };
    P.REWARDS = [
        { level: 2, id: 'rookie', type: 'badge', label: 'شارة مبتدئ', emoji: '🌱' },
        { level: 3, id: 'gold', type: 'theme', label: 'سمة ذهبية', colors: { bg: '#17130a', surface: '#211b0e', card: '#2c2413', text: '#fbf3dc', accent: '#f5c542' } },
        { level: 4, id: 'coder', type: 'badge', label: 'شارة مبرمج', emoji: '💻' },
        { level: 5, id: 'aurora', type: 'theme', label: 'سمة الشفق', colors: { bg: '#071a1f', surface: '#0c252c', card: '#12323b', text: '#e0fbff', accent: '#5eead4' } },
        { level: 6, id: 'stars', type: 'confetti', label: 'قصاصات النجوم', emoji: '⭐' },
        { level: 8, id: 'rocket', type: 'badge', label: 'شارة صاروخ', emoji: '🚀' },
        { level: 10, id: 'neon', type: 'theme', label: 'سمة نيون', colors: { bg: '#0a0614', surface: '#130b24', card: '#1c1135', text: '#f5ecff', accent: '#e879f9' } },
        { level: 15, id: 'legend', type: 'badge', label: 'شارة أسطورة', emoji: '👑' }
    ];
    P.hasReward = function (id) { const r = this.REWARDS.find(x => x.id === id); return !!r && this.progressInfo().level >= r.level; };
    P.currentBadge = function () { const lvl = this.progressInfo().level; const b = this.REWARDS.filter(r => r.type === 'badge' && r.level <= lvl).pop(); return b ? b.emoji : '✨'; };
    P.installRewardTheme = function (r) {
        const presets = window.OX_THEME_PRESETS;
        if (!presets || !this.buildCustomTheme) return false;
        presets['reward-' + r.id] = { ...this.buildCustomTheme(r.colors), label: `🏆 ${r.label}` };
        return true;
    };
    P.installUnlockedRewards = function () { this.REWARDS.filter(r => r.type === 'theme' && this.hasReward(r.id)).forEach(r => this.installRewardTheme(r)); };
    P.rewardThemesHTML = function () {
        const lvl = this.progressInfo().level;
        return `<div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-trophy"></i> جوائز المستويات (مستواك ${lvl})</div><div class="theme-seeds">${this.REWARDS.map(r => {
            const open = lvl >= r.level;
            if (r.type === 'theme') return `<button class="theme-seed ${open ? '' : 'locked'}" ${open ? `onclick="app.installRewardTheme(app.REWARDS.find(x=>x.id==='${r.id}')); app.applyTheme('reward-${r.id}')"` : 'disabled'} style="background:${r.colors.bg};color:${r.colors.text};border-color:${r.colors.accent}">${open ? '' : '🔒 '}${r.label} <small>م${r.level}</small></button>`;
            return `<span class="theme-seed ${open ? '' : 'locked'}">${open ? r.emoji : '🔒'} ${r.label} <small>م${r.level}</small></span>`;
        }).join('')}</div></div>`;
    };

    // ------------------------------------------------------------------ DAILY CHALLENGES (#369)
    P.CHALLENGES = [
        ['عكس سلسلة نصية', 'اكتب دالة تعكس سلسلة نصية دون استخدام reverse()، مع اختبارات.'],
        ['FizzBuzz بلمسة', 'اكتب FizzBuzz من 1 إلى 100 ثم عمّمه لقواعد مخصصة تُمرَّر كمعامل.'],
        ['الكلمات المتجانسة', 'اكتب دالة تجمع الكلمات المتجانسة (anagrams) من قائمة كلمات.'],
        ['الأقواس المتوازنة', 'تحقق من توازن الأقواس ()[]{} في نص باستخدام مكدس.'],
        ['أطول تسلسل', 'جد أطول تسلسل أرقام متتالية في مصفوفة غير مرتبة بتعقيد O(n).'],
        ['محوّل الأرقام الرومانية', 'حوّل الأعداد بين العربية والرومانية في الاتجاهين.'],
        ['ذاكرة مؤقتة LRU', 'نفّذ LRU Cache بعمليتي get/put بتعقيد O(1).'],
        ['البحث الثنائي', 'نفّذ البحث الثنائي وتعامل مع العناصر المكررة (أول وآخر ظهور).'],
        ['Debounce و Throttle', 'نفّذ debounce و throttle من الصفر مع اختبارات زمنية.'],
        ['دمج فترات', 'ادمج الفترات الزمنية المتداخلة في قائمة [[1,3],[2,6],...].'],
        ['متحقق كلمات المرور', 'اكتب متحققاً لقوة كلمة المرور يعيد درجة وأسباباً.'],
        ['مصفوفة حلزونية', 'اطبع عناصر مصفوفة ثنائية الأبعاد بترتيب حلزوني.'],
        ['ضغط النصوص', 'نفّذ ضغطاً بسيطاً (aaabb → a3b2) وفكّه.'],
        ['جدول الضرب التفاعلي', 'ابنِ صفحة HTML لجدول ضرب تفاعلي مع تمييز الصف والعمود.'],
        ['العدّاد التنازلي', 'ابنِ مكوّن عدّاد تنازلي بإيقاف واستئناف وإعادة ضبط.'],
        ['تحويل JSON إلى CSV', 'حوّل مصفوفة كائنات JSON إلى CSV مع الهروب الصحيح للفواصل.'],
        ['الأعداد الأولية', 'نفّذ غربال إراتوستينس وقِس أداءه حتى مليون.'],
        ['Deep Clone', 'اكتب دالة نسخ عميق تدعم Date و Map و Set والمراجع الدائرية.'],
        ['Event Emitter', 'نفّذ EventEmitter بـ on/off/once/emit.'],
        ['المسار الأقصر', 'نفّذ BFS لإيجاد أقصر مسار في متاهة شبكية.'],
        ['قائمة مهام', 'ابنِ قائمة مهام بالتخزين المحلي والتصفية (الكل/المنجز/المتبقي).'],
        ['Promise.all يدوياً', 'نفّذ promiseAll و promiseRace من الصفر.'],
        ['تنسيق الأرقام', 'نسّق الأرقام بالفواصل والعملة بالعربية والإنجليزية دون Intl.'],
        ['لعبة الحياة', 'نفّذ Game of Life لكونواي على Canvas.'],
        ['محلل تعابير', 'اكتب آلة حاسبة تحلل تعابير مثل 2*(3+4) مع الأولويات.'],
        ['Trie للإكمال التلقائي', 'نفّذ Trie يقترح كلمات للإكمال التلقائي.'],
        ['تحويل Markdown', 'حوّل جزءاً من Markdown (عناوين، غامق، روابط) إلى HTML.'],
        ['مولّد كلمات المرور', 'ابنِ مولّد كلمات مرور بخيارات الطول والرموز.'],
        ['فرز الدمج', 'نفّذ Merge Sort واشرح تعقيده الزمني والمكاني.'],
        ['ساعة عالمية', 'ابنِ ساعة تعرض الوقت في 4 مدن بمناطق زمنية مختلفة.']
    ];
    P.challengeForDay = function (now = Date.now()) {
        const [title, prompt] = this.CHALLENGES[dayOfYear(now) % this.CHALLENGES.length];
        return { id: dkey(now), title, prompt };
    };
    P.challengeDone = function (now = Date.now()) { return !!this.getGame().challenges[dkey(now)]; };
    P.startDailyChallenge = function () {
        const c = this.challengeForDay();
        this.createNewSession(true);
        const s = this.findSession ? this.findSession(this.activeSessionId) : null;
        if (s && this.CHAT_MODES && this.CHAT_MODES.challenge) { s.mode = 'challenge'; this.saveSessions(); }
        this.sendQuickPrompt(`🎯 تحدي اليوم: ${c.title}\n\n${c.prompt}\n\nأعطني التحدي خطوة بخطوة مع تلميحات عند الطلب، ولا تكشف الحل قبل محاولتي.`);
        return c;
    };
    P.completeDailyChallenge = function (now = Date.now()) {
        const g = this.getGame(), day = dkey(now);
        if (g.challenges[day]) return false;
        const yesterday = dkey(now - DAY);
        g.streak = g.lastChallenge === yesterday ? (g.streak || 0) + 1 : 1;
        g.lastChallenge = day;
        g.challenges[day] = this.challengeForDay(now).title;
        this.saveGame();
        this.addXP(30 + Math.min(20, (g.streak - 1) * 5), 'challenge', now);
        this.confetti();
        this.showToast(`🏅 أنجزت تحدي اليوم! سلسلة ${g.streak} يوم 🔥`, 'success');
        if (document.querySelector('.welcome-today')) this.renderMessages();
        return g.streak;
    };

    // ------------------------------------------------------------------ TIME: greeting (#393), suggestions (#392), seasons (#394), events (#395), tips (#396), quotes (#397)
    P.greetingFor = function (hour, name = '') {
        const n = name ? `، ${name}` : '';
        if (hour >= 5 && hour < 12) return `صباح الخير${n} ☀️`;
        if (hour >= 12 && hour < 17) return `نهارك سعيد${n} 🌤️`;
        if (hour >= 17 && hour < 22) return `مساء الخير${n} 🌆`;
        return `سهرة برمجية موفقة${n} 🌙 — لا تنسَ الراحة`;
    };
    P.timeSuggestions = function (now = Date.now()) {
        const h = new Date(now).getHours();
        if (h >= 5 && h < 12) return [{ icon: 'fa-list-check', label: '☀️ خطة اليوم', prompt: 'ساعدني في تخطيط يوم عمل برمجي منتج: اسألني عن مهامي ثم رتبها حسب الأولوية مع تقدير زمني.' }, { icon: 'fa-magnifying-glass-chart', label: 'مراجعة كود الأمس', prompt: 'راجع آخر ملف عملت عليه في المشروع واقترح تحسينات سريعة لبداية اليوم.' }];
        if (h >= 12 && h < 17) return [{ icon: 'fa-bug', label: '🐞 جلسة إصلاح أخطاء', prompt: 'لنبدأ جلسة تصحيح أخطاء منهجية: اسألني عن العَرَض ثم اقترح فرضيات وخطوات تحقق.' }, { icon: 'fa-vial', label: 'كتابة اختبارات', prompt: 'اقترح اختبارات وحدة للملف الحالي في المشروع تغطي الحالات الحدية.' }];
        if (h >= 17 && h < 22) return [{ icon: 'fa-graduation-cap', label: '🌆 تعلّم مفهوماً جديداً', prompt: 'علّمني مفهوماً برمجياً متقدماً واحداً في 10 دقائق مع مثال عملي وسؤال تحقق.' }, { icon: 'fa-file-lines', label: 'ملخص اليوم', prompt: 'لخّص ما أنجزته اليوم في هذه المحادثات واقترح 3 مهام للغد.' }];
        return [{ icon: 'fa-bolt', label: '🌙 تحدٍّ سريع', prompt: 'أعطني تحدياً برمجياً قصيراً (10 دقائق) مناسباً لآخر الليل.' }, { icon: 'fa-book', label: 'توثيق هادئ', prompt: 'ساعدني في كتابة توثيق README واضح للمشروع الحالي.' }];
    };
    P.hijriParts = function (now = Date.now()) {
        try {
            const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(new Date(now));
            const get = (t) => +((parts.find(p => p.type === t) || {}).value || NaN);
            const r = { day: get('day'), month: get('month'), year: get('year') || +String((parts.find(p => p.type === 'relatedYear') || {}).value || '') };
            return isFinite(r.day) && isFinite(r.month) ? r : null;
        } catch (e) { return null; }
    };
    P.seasonFor = function (now = Date.now()) {
        const h = this.hijriParts(now);
        if (h && h.month === 9) return 'ramadan';
        const m = new Date(now).getMonth();
        return m === 11 || m <= 1 ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'autumn';
    };
    const SEASON_EMOJI = { winter: '❄️', spring: '🌸', summer: '☀️', autumn: '🍂', ramadan: '🌙' };
    P.applySeason = function () {
        const u = this.getUIPrefs ? this.getUIPrefs() : {};
        const root = document.documentElement;
        if (u.seasonal === false) { root.removeAttribute('data-season'); return null; }
        const s = this.seasonFor();
        root.setAttribute('data-season', s);
        return s;
    };
    P.eventsFor = function (now = Date.now()) {
        const d = new Date(now), out = [];
        const md = `${d.getMonth() + 1}-${d.getDate()}`;
        if (md === '1-1') out.push({ id: 'newyear', text: 'سنة ميلادية سعيدة! 🎆', confetti: true });
        if (dayOfYear(now) === 256) out.push({ id: 'programmers-day', text: 'يوم المبرمج العالمي سعيد! 👩‍💻 (اليوم 256 من السنة)', confetti: true });
        const h = this.hijriParts(now);
        if (h) {
            if (h.month === 1 && h.day === 1) out.push({ id: 'hijri-newyear', text: `كل عام وأنتم بخير — سنة هجرية جديدة ${h.year || ''} 🌙`, confetti: false });
            if (h.month === 9 && h.day <= 3) out.push({ id: 'ramadan', text: 'رمضان مبارك 🌙 — تقبّل الله صيامكم', confetti: false });
            if (h.month === 12 && h.day === 9) out.push({ id: 'arafah', text: 'يوم عرفة — يوم مبارك 🤲', confetti: false });
            if (h.month === 10 && h.day <= 3) out.push({ id: 'eid-fitr', text: 'عيد فطر مبارك! 🎉 كل عام وأنتم بخير', confetti: true });
            if (h.month === 12 && h.day >= 10 && h.day <= 13) out.push({ id: 'eid-adha', text: 'عيد أضحى مبارك! 🐑 كل عام وأنتم بخير', confetti: true });
        }
        return out;
    };
    P.checkEvents = function (now = Date.now()) {
        const u = this.getUIPrefs ? this.getUIPrefs() : {};
        if (u.events === false || u.seasonal === false) return [];
        const shown = [];
        this.eventsFor(now).forEach(ev => {
            const id = `event-${ev.id}-${new Date(now).getFullYear()}`;
            const el = this.showBanner && this.showBanner({ id, icon: 'fa-champagne-glasses', type: 'success', text: ev.text, once: true });
            if (el) { shown.push(ev.id); if (ev.confetti) setTimeout(() => this.confetti(), 600); }
        });
        return shown;
    };
    P.TIPS = [
        'اضغط Ctrl+K لفتح لوحة الأوامر والوصول لأي ميزة بالاسم.',
        'Alt+S يبحث في كل المحادثات والرسائل وملفات المشروع دفعة واحدة.',
        'انقر بالزر الأيمن على محادثة لتثبيتها أو وسمها أو نقلها لمجلد.',
        'حدّد نصاً في أي رد لنسخه أو اقتباسه أو طلب شرحه فوراً.',
        'اكتب / في حقل الرسالة لعرض الأوامر السريعة.',
        'اسحب الفاصل بين المحادثة والمحرر لتغيير العرض — نقرتان تعيده.',
        'Ctrl+B يطوي القائمة الجانبية على سطح المكتب لمساحة أكبر.',
        'Alt+R يفعّل وضع القراءة المريح للردود الطويلة.',
        'اضغط ? في أي مكان لعرض المساعدة والاختصارات حسب السياق.',
        'المحادثات المحذوفة تبقى 30 يوماً في سلة المهملات.',
        'خصّص المظهر بالكامل من «محرر المظهر المخصص» وشاركه برابط.',
        'F6 ينقلك بين القائمة والمحادثة وحقل الكتابة بلوحة المفاتيح.',
        'نجمة ⭐ على رسالة تحفظها في «الرسائل المفضلة» للرجوع إليها.',
        'نسخ رابط رسالة يتيح العودة إليها مباشرة لاحقاً.',
        'وضع «اختبار» يحوّل أي موضوع لأسئلة اختيار من متعدد مع نتيجة.',
        'كتم محادثة يوقف أصواتها وإشعاراتها دون التأثير على البقية.',
        'Ctrl+Alt+= و Ctrl+Alt+- لتكبير وتصغير نص الرسائل فقط.',
        'وضع القيادة يتيح المحادثة صوتياً بأزرار كبيرة وقراءة الردود تلقائياً.',
        'Ctrl+Enter يرسل الرسالة من أي مكان في حقل الكتابة.',
        'فعّل إشعارات سطح المكتب لتعرف متى يكتمل رد طويل في الخلفية.',
        'مدير المحادثات (Alt+C) يدعم التحديد المتعدد والأرشفة والحذف الجماعي.',
        'قارن محادثتين جنباً إلى جنب لاختيار أفضل إجابة.',
        'تحدي اليوم يمنحك نقاط خبرة إضافية ويبني سلسلة أيام 🔥.',
        'صدّر رسالة كصورة أنيقة لمشاركتها على الشبكات الاجتماعية.'
    ];
    P.QUOTES = [
        ['أي أحمق يستطيع كتابة كود يفهمه الحاسوب، المبرمج الجيد يكتب كوداً يفهمه البشر.', 'مارتن فاولر'],
        ['أولاً حُلّ المشكلة، ثم اكتب الكود.', 'جون جونسون'],
        ['البساطة شرط أساسي للموثوقية.', 'إدسخر دايكسترا'],
        ['الكود كالفكاهة: إذا اضطررت لشرحه فهو سيئ.', 'كوري هاوس'],
        ['اجعلها تعمل، ثم اجعلها صحيحة، ثم اجعلها سريعة.', 'كينت بيك'],
        ['أفضل رسالة خطأ هي التي لا تظهر أبداً.', 'توماس فوكس'],
        ['التحسين المبكر أصل كل الشرور.', 'دونالد كنوث'],
        ['البرمجة ليست عن ما تعرفه، بل عن ما يمكنك اكتشافه.', 'كريس باين'],
        ['التعلم لا يُرهق العقل أبداً.', 'ليوناردو دافنشي'],
        ['الخبير هو شخص ارتكب كل الأخطاء الممكنة في مجال ضيق جداً.', 'نيلز بور'],
        ['ابدأ من حيث أنت، استخدم ما لديك، افعل ما تستطيع.', 'آرثر آش'],
        ['النجاح هو مجموع جهود صغيرة تتكرر يوماً بعد يوم.', 'روبرت كولير'],
        ['لا تخف من البطء، خف من التوقف.', 'مثل صيني'],
        ['الكود الذي لا يُختبر هو كود معطّل بالتعريف.', 'مجهول'],
        ['المحادثة مع زميل تحل مشكلات أكثر من ساعات من التحديق في الشاشة.', 'مجهول'],
        ['من جدّ وجد، ومن زرع حصد.', 'مثل عربي'],
        ['اطلبوا العلم من المهد إلى اللحد.', 'حكمة مأثورة'],
        ['قليل دائم خير من كثير منقطع.', 'حكمة مأثورة'],
        ['الحذف من الكود أفضل من الإضافة إليه.', 'مجهول'],
        ['الطريقة الوحيدة لتعلم لغة برمجة جديدة هي الكتابة بها.', 'دينيس ريتشي'],
        ['الحديث رخيص، أرني الكود.', 'لينوس تورفالدز'],
        ['البرمجيات الجيدة كالحديقة: تحتاج رعاية مستمرة.', 'مجهول'],
        ['إذا كان التصحيح هو إزالة الأخطاء، فالبرمجة هي إدخالها.', 'إدسخر دايكسترا'],
        ['كل خبير كان يوماً مبتدئاً.', 'هيلين هايز']
    ];
    P.pickDaily = function (list, now = Date.now(), salt = 0) { return list[(dayOfYear(now) + salt) % list.length]; };

    // ------------------------------------------------------------------ DAILY STATS (#398) + LIVE COUNTER (#365) + REMINDER (#391)
    P.todayStats = function (now = Date.now()) {
        const d = this.dailyStats ? this.dailyStats(1, now)[0] : null;
        const from = new Date(new Date(now).toDateString()).getTime();
        const usage = (this.loadUsage ? this.loadUsage() : []).filter(r => r.t >= from);
        const tokens = usage.reduce((n, r) => n + (r.pt || 0) + (r.ct || 0), 0);
        const cost = usage.reduce((n, r) => n + (r.c || 0), 0);
        let sent = d ? d.sent : 0;
        if (!d) (this.sessions || []).forEach(s => (s.messages || []).forEach(m => { if (m.role === 'user' && m.timestamp >= from) sent++; }));
        return { sent, replies: d ? d.replies : 0, code: d ? d.code : 0, activeMin: d ? Math.round((d.active || 0) / 60) : 0, tokens, cost, requests: usage.length };
    };
    P.dailyGoalProgress = function (now = Date.now()) {
        const goal = Math.max(1, (this.getUIPrefs ? this.getUIPrefs().dailyGoal : 10) || 10);
        const sent = this.todayStats(now).sent;
        return { sent, goal, pct: Math.min(100, Math.round(sent / goal * 100)) };
    };
    const fmtK = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
    P.updateLiveStats = function () {
        const host = document.querySelector('#sidebar');
        if (!host) return;
        let el = document.getElementById('live-stats');
        if (!el) {
            el = document.createElement('button');
            el.id = 'live-stats'; el.className = 'live-stats';
            el.onclick = () => this.openInsights ? this.openInsights('activity') : null;
            const list = document.getElementById('sessions-list');
            if (list) list.insertAdjacentElement('afterend', el); else host.appendChild(el);
        }
        const t = this.todayStats(), p = this.progressInfo(), g = this.dailyGoalProgress();
        el.setAttribute('aria-label', `اليوم ${t.sent} رسالة، المستوى ${p.level}`);
        el.innerHTML = `<span class="ls-level" title="المستوى ${p.level} — ${p.xp} XP">${this.currentBadge()} م${p.level}</span>
            <span class="ls-bar" role="progressbar" aria-valuenow="${p.pct}" aria-valuemin="0" aria-valuemax="100" title="${p.xp - p.cur}/${p.next - p.cur} XP للمستوى التالي"><span style="width:${p.pct}%"></span></span>
            <span class="ls-nums"><b data-count="${t.sent}">${t.sent}</b>/${g.goal} رسالة • ${fmtK(t.tokens)} توكن</span>`;
        if (this._lastLiveSent != null && this._lastLiveSent !== t.sent) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
        this._lastLiveSent = t.sent;
        if (g.sent >= g.goal) { const gm = this.getGame(); const day = dkey(Date.now()); if (!gm.goalHit[day]) { gm.goalHit[day] = 1; this.saveGame(); this.addXP(20, 'goal'); this.showToast('🎯 حققت هدفك اليومي من الرسائل!', 'success'); this.confetti({ count: 60 }); } }
    };
    P.checkReminder = function (now = Date.now()) {
        const u = this.getUIPrefs();
        if (!u.reminder.enabled || !u.notify.reminders) return false;
        const [hh, mm] = String(u.reminder.time || '09:00').split(':').map(Number);
        const d = new Date(now);
        const due = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh || 0, mm || 0).getTime();
        const day = dkey(now);
        if (now < due || lsGet('ox_alpha_last_reminder', '') === day) return false;
        lsSet('ox_alpha_last_reminder', day);
        const c = this.challengeForDay(now);
        this.notify('⏰ وقت البرمجة اليومي', `تحدي اليوم: ${c.title}${this.challengeDone(now) ? ' (منجز ✓)' : ''}`, { type: 'info', icon: 'fa-alarm-clock text-warning' });
        return true;
    };

    // ------------------------------------------------------------------ WELCOME "TODAY" BLOCK
    P.addWelcomeDecorator && P.addWelcomeDecorator(function (box) {
        if (box.querySelector('.welcome-today')) return;
        const u = this.getUIPrefs(), now = Date.now();
        const esc = (s) => this.escapeHTML(s);
        const season = this.applySeason();
        const t = this.todayStats(now), p = this.progressInfo(), g = this.dailyGoalProgress(now), c = this.challengeForDay(now), done = this.challengeDone(now);
        const tip = this.pickDaily(this.TIPS, now), [quote, author] = this.pickDaily(this.QUOTES, now, 7);
        const el = document.createElement('div');
        el.className = 'welcome-today';
        el.innerHTML = `${u.greeting ? `<div class="welcome-greeting">${esc(this.greetingFor(new Date(now).getHours(), u.userName))} ${season ? SEASON_EMOJI[season] || '' : ''}</div>` : ''}
            <div class="today-grid">
                <div class="today-card"><div class="today-title"><i class="fa-solid fa-chart-simple"></i> إحصاءات اليوم</div><div class="today-stats"><span><b>${t.sent}</b>رسالة</span><span><b>${t.replies}</b>رد</span><span><b>${t.code}</b>كتلة كود</span><span><b>${fmtK(t.tokens)}</b>توكن</span></div></div>
                <div class="today-card"><div class="today-title"><i class="fa-solid fa-trophy"></i> المستوى ${p.level} ${this.currentBadge()}</div><div class="today-bar" role="progressbar" aria-valuenow="${p.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="تقدم المستوى"><span style="width:${p.pct}%"></span></div><small>${p.xp - p.cur}/${p.next - p.cur} XP</small>
                    <div class="today-bar goal" role="progressbar" aria-valuenow="${g.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="الهدف اليومي"><span style="width:${g.pct}%"></span></div><small>الهدف اليومي: ${g.sent}/${g.goal} رسالة</small></div>
                <div class="today-card challenge ${done ? 'done' : ''}"><div class="today-title"><i class="fa-solid fa-bullseye"></i> تحدي اليوم ${this.getGame().streak ? `<span class="streak">🔥 ${this.getGame().streak}</span>` : ''}</div><b>${esc(c.title)}</b><small>${esc(c.prompt)}</small>
                    <div class="gh-toolbar">${done ? '<span class="text-success">✓ منجز اليوم</span>' : `<button class="fx-link" onclick="app.startDailyChallenge()"><i class="fa-solid fa-play"></i> ابدأ</button><button class="fx-link" onclick="app.completeDailyChallenge()"><i class="fa-solid fa-check"></i> أنجزته</button>`}</div></div>
                ${u.tips ? `<div class="today-card"><div class="today-title"><i class="fa-solid fa-lightbulb"></i> نصيحة اليوم</div><small>${esc(tip)}</small></div>` : ''}
                ${u.quotes ? `<div class="today-card quote"><div class="today-title"><i class="fa-solid fa-quote-right"></i> اقتباس اليوم</div><q>${esc(quote)}</q><small>— ${esc(author)}</small></div>` : ''}
            </div>`;
        const sub = box.querySelector('.welcome-subtitle');
        if (sub) sub.insertAdjacentElement('afterend', el); else box.appendChild(el);
    });

    // ------------------------------------------------------------------ VIEW CONTROLS: expand/collapse (#383), fullscreen (#389), print (#386)
    P.setAllExpanded = function (open) {
        if (this.setUIPrefs) this.setUIPrefs({ collapseCode: !open });
        document.querySelectorAll('#chat-messages-container details').forEach(d => { d.open = !!open; });
        document.querySelectorAll('#chat-messages-container .code-block-box').forEach(b => b.classList.toggle('expanded', !!open));
        return open;
    };
    P.addMessageDecorator && P.addMessageDecorator(function (row) {
        row.querySelectorAll('.code-block-box').forEach(box => {
            if (box.querySelector('.code-expand-btn')) return;
            const pre = box.querySelector('pre');
            if (!pre || (pre.textContent || '').split('\n').length < 14) return;
            const b = document.createElement('button');
            b.className = 'code-expand-btn';
            b.type = 'button';
            b.innerHTML = '<i class="fa-solid fa-angles-down"></i> عرض الكل';
            b.onclick = () => { const on = box.classList.toggle('expanded'); b.innerHTML = on ? '<i class="fa-solid fa-angles-up"></i> طي' : '<i class="fa-solid fa-angles-down"></i> عرض الكل'; };
            box.appendChild(b);
        });
    });
    P.toggleFullscreen = async function () {
        try {
            if (document.fullscreenElement) { await document.exitFullscreen(); return false; }
            if (document.documentElement.requestFullscreen) { await document.documentElement.requestFullscreen(); return true; }
        } catch (e) {}
        this.showToast('ملء الشاشة غير مدعوم هنا', 'warning');
        return false;
    };
    P.printConversation = function () { window.print(); return true; };

    // ------------------------------------------------------------------ CORE WRAPPERS for lazy tools (network sim banner, voice/PiP reply hook)
    const _origOnline = P.updateOnlineState;
    if (_origOnline) {
        P.updateOnlineState = function () {
            const r = _origOnline.apply(this, arguments);
            if (this._netSim === 'offline') {
                let el = document.getElementById('offline-banner');
                if (!el) { el = document.createElement('div'); el.id = 'offline-banner'; el.className = 'offline-banner'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
                el.innerHTML = '<i class="fa-solid fa-flask"></i> محاكاة عدم الاتصال (أدوات المطور) — الطلبات الشبكية متوقفة';
                el.classList.add('active');
            }
            return r;
        };
    }
    const _origReplyHook = P.handleReplyComplete;
    P.handleReplyComplete = function (info) {
        const r = _origReplyHook ? _origReplyHook.apply(this, arguments) : false;
        try {
            this.addXP(1, 'reply');
            if (this._voice && info.sessionId === this.activeSessionId) {
                clearTimeout(this._voiceT);
                this._voiceT = setTimeout(() => {
                    if (this.activeStreams && this.activeStreams.has(info.sessionId)) return;
                    this.speakLastReply();
                    if (this._voice && this._voice.mode === 'driving') this.renderDrivingMode();
                }, 400);
            }
            if (document.getElementById('ox-mini-chat') || this._pipWin) setTimeout(() => this.renderMiniChat(), 50);
        } catch (e) {}
        return r;
    };

    // ------------------------------------------------------------------ HOOKS: XP for messages, runs, achievements
    const _origSend = P.sendUserMessage;
    P.sendUserMessage = async function () {
        const input = document.getElementById('user-input');
        const had = !!(arguments[0] || (input && input.value.trim()));
        const r = await _origSend.apply(this, arguments);
        if (had) { this.addXP(2, 'message'); }
        if (document.getElementById('ox-mini-chat') || this._pipWin) this.renderMiniChat();
        return r;
    };
    const _origCheckAch = P.checkAchievements;
    if (_origCheckAch) {
        P.checkAchievements = function () {
            const fresh = _origCheckAch.apply(this, arguments) || [];
            if (fresh.length) { this.addXP(50 * fresh.length, 'achievement'); this.confetti(); }
            return fresh;
        };
    }
    const _origLoadChunk = P.loadChunk;
    if (_origLoadChunk) {
        P.loadChunk = function (name) {
            return _origLoadChunk.apply(this, arguments).then((mod) => {
                if (name === 'runner' && this.recordRun && !this.recordRun.__oxXP) this.wrapRecordRun();
                return mod;
            });
        };
    }
    P.wrapRecordRun = function () {
        const orig = this.recordRun;
        if (!orig || orig.__oxXP) return false;
        const self = this;
        const wrapped = function (rec) {
            try {
                if (rec && rec.success) {
                    if (rec.mode === 'test') { self.addXP(10, 'run'); self.confetti({ count: 50 }); self.playSound && self.playSound('notify'); }
                    else self.addXP(3, 'run');
                }
            } catch (e) {}
            return orig.apply(this, arguments);
        };
        wrapped.__oxXP = true;
        this.recordRun = wrapped;
        return true;
    };

    // ------------------------------------------------------------------ PALETTE + INIT
    const _origPalette = P.buildPaletteCommands;
    if (_origPalette) {
        P.buildPaletteCommands = function () {
            const self = this, S = 'المتعة والأدوات';
            return _origPalette.call(this).concat([
                { section: S, icon: 'fa-bullseye', label: 'تحدي اليوم', hint: 'Challenge', run: () => self.startDailyChallenge() },
                { section: S, icon: 'fa-trophy', label: 'مستواي وجوائزي', hint: 'Level', run: () => self.openThemeEditor() },
                { section: S, icon: 'fa-calendar', label: 'التقرير الشهري', hint: 'Monthly', run: () => { self._insPeriod = 'month'; self.openInsights && self.openInsights('reports'); } },
                { section: S, icon: 'fa-gauge-high', label: 'وضع المطور (DevTools HUD)', hint: 'Dev', run: () => self.toggleDevHUD() },
                { section: S, icon: 'fa-crosshairs', label: 'فحص العناصر', hint: 'Inspect', run: () => self.startInspect() },
                { section: S, icon: 'fa-mobile-screen', label: 'محاكي الأجهزة للمعاينة', hint: 'Devices', run: () => self.openDeviceEmulator() },
                { section: S, icon: 'fa-signal', label: 'محاكاة شبكة بطيئة', hint: 'Network', run: () => self.setNetworkSim(self._netSim === 'slow' ? 'off' : 'slow') },
                { section: S, icon: 'fa-plug-circle-xmark', label: 'محاكاة عدم الاتصال', hint: 'Offline', run: () => self.setNetworkSim(self._netSim === 'offline' ? 'off' : 'offline') },
                { section: S, icon: 'fa-angles-down', label: 'توسيع كل الرسائل والكود', hint: 'Expand', run: () => self.setAllExpanded(true) },
                { section: S, icon: 'fa-angles-up', label: 'طي كل الرسائل والكود', hint: 'Collapse', run: () => self.setAllExpanded(false) },
                { section: S, icon: 'fa-eye-slash', label: 'إظهار/إخفاء تفاصيل الرسائل', hint: 'Details', run: () => self.setUIPrefs({ hideDetails: !self.getUIPrefs().hideDetails }) },
                { section: S, icon: 'fa-image', label: 'حفظ المحادثة كصورة PNG', hint: 'Image', run: () => self.exportMessagesImage(self.activeSessionId) },
                { section: S, icon: 'fa-print', label: 'طباعة المحادثة', hint: 'Print', run: () => self.printConversation() },
                { section: S, icon: 'fa-expand', label: 'ملء الشاشة', hint: 'Fullscreen', run: () => self.toggleFullscreen() },
                { section: S, icon: 'fa-clone', label: 'نافذة مصغرة (Picture-in-Picture)', hint: 'PiP', run: () => self.openMiniChat() },
                { section: S, icon: 'fa-headphones', label: 'الوضع الصوتي (قراءة الردود تلقائياً)', hint: 'Audio', run: () => self.setVoiceConversation(self._voice ? null : 'audio') },
                { section: S, icon: 'fa-car', label: 'وضع القيادة', hint: 'Driving', run: () => self.setVoiceConversation(self._voice && self._voice.mode === 'driving' ? null : 'driving') }
            ]);
        };
    }
    P.initSprint7Delight = function () {
        this.installUnlockedRewards();
        if (this.applyQuickSuggestions) this.applyQuickSuggestions();
        this.applySeason();
        this.updateLiveStats();
        setTimeout(() => { try { this.checkEvents(); } catch (e) {} }, 2500);
        this._reminderTimer = setInterval(() => { try { this.checkReminder(); } catch (e) {} }, 60000);
        if (this.recordRun && !this.recordRun.__oxXP && !this.recordRun.__oxLazy) this.wrapRecordRun();
        window.addEventListener('beforeprint', () => { this._printCollapsed = document.body.classList.contains('collapse-code'); document.body.classList.remove('collapse-code'); document.querySelectorAll('#chat-messages-container details').forEach(d => { d.dataset.wasOpen = d.open ? '1' : ''; d.open = true; }); });
        window.addEventListener('afterprint', () => { if (this._printCollapsed) document.body.classList.add('collapse-code'); document.querySelectorAll('#chat-messages-container details').forEach(d => { d.open = d.dataset.wasOpen === '1'; }); });
        if (document.querySelector('#chat-messages-container .welcome-hero-box') && this.decorateRenderedMessages) this.decorateRenderedMessages();
    };
    if (window.app) {
        try { window.app.initSprint7Delight(); } catch (e) { console.error('Sprint 7 delight init failed', e); }
    }
})();
