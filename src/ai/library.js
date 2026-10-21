/* Prompt library (#34), persona marketplace (#36), model explorer with price/speed filters (#1), AI settings tab. */
import { esc, lsGet, lsSet, uid, templateVars, fillTemplate } from './shared.js';

export const BUILTIN_PROMPTS = [
    { id: 'p-review', cat: 'كود', title: 'مراجعة كود شاملة', text: 'راجع هذا الكود كمراجع خبير: الأخطاء، الأداء، القراءة، الحالات الحدية. رتّب الملاحظات حسب الخطورة مع إصلاح مقترح لكل منها:\n\n{{code}}' },
    { id: 'p-tests', cat: 'كود', title: 'اكتب اختبارات وحدة', text: 'اكتب اختبارات وحدة شاملة بإطار {{framework}} لهذا الكود، تغطي المسار السعيد والأخطاء والحالات الحدية:\n\n{{code}}' },
    { id: 'p-refactor', cat: 'كود', title: 'إعادة هيكلة', text: 'أعد هيكلة هذا الكود ليصبح أنظف وأسهل صيانة دون تغيير سلوكه، واشرح كل تغيير:\n\n{{code}}' },
    { id: 'p-debug', cat: 'كود', title: 'تصحيح خطأ', text: 'لدي هذا الخطأ:\n{{error}}\n\nفي هذا الكود:\n{{code}}\n\nحدد السبب الجذري، ثم أعطني الإصلاح وطريقة التأكد منه.' },
    { id: 'p-explain', cat: 'تعلم', title: 'اشرح لي مفهوماً', text: 'اشرح مفهوم {{concept}} لمستوى {{level}} بأمثلة بسيطة وتشبيه من الحياة اليومية ومثال كود قصير.' },
    { id: 'p-roadmap', cat: 'تعلم', title: 'خارطة تعلم', text: 'ضع لي خارطة تعلم لـ {{topic}} خلال {{weeks}} أسابيع، مع مصادر مجانية ومشروع تطبيقي لكل مرحلة.' },
    { id: 'p-compare', cat: 'تعلم', title: 'قارن بين تقنيتين', text: 'قارن بين {{a}} و {{b}} من حيث الأداء، سهولة التعلم، المجتمع، حالات الاستخدام المثالية. اختم بتوصية واضحة لمشروع {{project}}.' },
    { id: 'p-api', cat: 'تصميم', title: 'صمم REST API', text: 'صمم REST API لـ {{domain}}: الموارد، المسارات، أمثلة الطلب/الاستجابة، رموز الحالة، الترقيم، والتحقق من المدخلات.' },
    { id: 'p-db', cat: 'تصميم', title: 'صمم قاعدة بيانات', text: 'صمم مخطط قاعدة بيانات {{db}} لـ {{domain}}: الجداول، العلاقات، الفهارس، مع مخطط ERD بـ Mermaid و SQL لإنشائها.' },
    { id: 'p-arch', cat: 'تصميم', title: 'معمارية نظام', text: 'اقترح معمارية لنظام {{system}} يخدم {{users}} مستخدم: المكونات، تدفق البيانات، قابلية التوسع، نقاط الفشل، مع مخطط Mermaid.' },
    { id: 'p-readme', cat: 'توثيق', title: 'README احترافي', text: 'اكتب README احترافياً لمشروع {{name}} يقوم بـ {{what}}: الشارات، المميزات، التثبيت، الاستخدام، الإعداد، المساهمة، الترخيص.' },
    { id: 'p-commit', cat: 'توثيق', title: 'رسالة commit', text: 'اكتب رسالة commit بصيغة Conventional Commits لهذه التغييرات:\n{{changes}}' },
    { id: 'p-pr', cat: 'توثيق', title: 'وصف Pull Request', text: 'اكتب وصف Pull Request يتضمن: الملخص، الدافع، التغييرات، طريقة الاختبار، لقطات/ملاحظات للمراجع:\n{{changes}}' },
    { id: 'p-email', cat: 'كتابة', title: 'بريد مهني', text: 'اكتب بريداً مهنياً إلى {{to}} بخصوص {{subject}} بنبرة {{tone}}، مختصراً وواضحاً.' },
    { id: 'p-post', cat: 'كتابة', title: 'منشور تقني', text: 'اكتب منشوراً جذاباً لـ {{platform}} عن {{topic}} مع خطّاف في البداية ونقاط واضحة ودعوة للتفاعل.' },
    { id: 'p-idea', cat: 'منتج', title: 'تقييم فكرة مشروع', text: 'قيّم فكرة المشروع التالية: {{idea}}. حلل السوق، المنافسين، نقاط القوة والضعف، نموذج الربح، وأول 3 خطوات للتحقق منها.' },
    { id: 'p-mvp', cat: 'منتج', title: 'خطة MVP', text: 'حوّل الفكرة "{{idea}}" إلى خطة MVP لمدة {{weeks}} أسابيع: الميزات الأساسية فقط، التقنيات، المهام الأسبوعية، ومعايير النجاح.' },
    { id: 'p-sql', cat: 'بيانات', title: 'استعلام SQL', text: 'اكتب استعلام {{db}} يجيب عن: {{question}}\nالجداول: {{schema}}' },
    { id: 'p-regex', cat: 'بيانات', title: 'تعبير نمطي', text: 'اكتب تعبيراً نمطياً (Regex) يطابق: {{what}}. اشرحه جزءاً جزءاً وأعطني أمثلة مطابقة وغير مطابقة.' },
    { id: 'p-translate', cat: 'كتابة', title: 'ترجمة تقنية', text: 'ترجم النص التالي إلى {{lang}} ترجمة تقنية دقيقة مع الحفاظ على المصطلحات البرمجية:\n\n{{text}}' }
];

export const PERSONA_MARKET = [
    { id: 'teacher', icon: 'fa-chalkboard-user', name: 'مدرّس 👨‍🏫', desc: 'يشرح بصبر خطوة بخطوة ويتحقق من فهمك', prompt: 'أنت مدرّس برمجة صبور ومحترف. اشرح من المبادئ الأولى خطوة بخطوة، استخدم التشبيهات والأمثلة الصغيرة القابلة للتشغيل، اطرح سؤال تحقق قصيراً في النهاية، وتجنب المصطلحات دون تعريفها.' },
    { id: 'ethical', icon: 'fa-user-shield', name: 'مدقق دفاعي 🛡️', desc: 'يراجع الكود من منظور دفاعي ويقترح التحصين', prompt: 'أنت مدقق برمجي دفاعي (Ethical / Defensive Reviewer). راجع الكود لاكتشاف نقاط الضعف الشائعة واقترح إصلاحات وتحصينات عملية. لا تقدّم أبداً تعليمات لاستغلال أنظمة الآخرين أو أي محتوى هجومي.' },
    { id: 'engineer', icon: 'fa-gears', name: 'مهندس أول 👷', desc: 'حلول إنتاجية مع المفاضلات', prompt: 'أنت مهندس برمجيات أول (Staff Engineer). قدّم حلولاً جاهزة للإنتاج، اذكر المفاضلات (trade-offs) والبدائل، اهتم بالقابلية للصيانة والمراقبة والاختبار، وكن موجزاً وحاسماً.' },
    { id: 'pm', icon: 'fa-clipboard-list', name: 'مدير منتج 📋', desc: 'متطلبات، أولويات، قصص مستخدم', prompt: 'أنت مدير منتج تقني. حوّل الأفكار إلى مشكلات واضحة، قصص مستخدم، معايير قبول، وأولويات (RICE/MoSCoW). اسأل عن الهدف والمستخدم قبل الحلول.' },
    { id: 'data', icon: 'fa-chart-simple', name: 'عالم بيانات 📊', desc: 'تحليل، إحصاء، Python/pandas', prompt: 'أنت عالم بيانات خبير. استخدم Python و pandas و SQL، اشرح الافتراضات الإحصائية، اقترح التصورات المناسبة، وانتبه لتسرب البيانات والانحياز.' },
    { id: 'devops', icon: 'fa-cloud', name: 'مهندس DevOps ☁️', desc: 'CI/CD، حاويات، سحابة', prompt: 'أنت مهندس DevOps/SRE. ركّز على الأتمتة، البنية ككود، الحاويات، المراقبة، SLOs، والنشر الآمن التدريجي. قدّم ملفات إعداد كاملة.' },
    { id: 'designer', icon: 'fa-pen-ruler', name: 'مصمم UI/UX 🎨', desc: 'واجهات جميلة وسهلة الوصول', prompt: 'أنت مصمم UI/UX ومطور واجهات. اهتم بالتسلسل البصري، المسافات، الألوان المتباينة (WCAG)، سهولة الوصول، RTL، والتجاوب. قدّم HTML/CSS نظيفاً.' },
    { id: 'writer', icon: 'fa-feather', name: 'كاتب تقني ✍️', desc: 'توثيق واضح ومنظم', prompt: 'أنت كاتب تقني محترف. اكتب توثيقاً واضحاً ومنظماً بعناوين، أمثلة، وتحذيرات، بلغة بسيطة ودقيقة.' },
    { id: 'reviewer', icon: 'fa-magnifying-glass-chart', name: 'مراجع صارم 🔍', desc: 'لا يجامل في جودة الكود', prompt: 'أنت مراجع كود صارم لا يجامل. ابحث عن الأخطاء والروائح والحالات الحدية وضعف الأسماء، ورتّب الملاحظات: حرجة / مهمة / ثانوية، مع إصلاح لكل منها.' },
    { id: 'mentor', icon: 'fa-rocket', name: 'مرشد شركات ناشئة 🚀', desc: 'من الفكرة إلى المنتج', prompt: 'أنت مرشد شركات ناشئة ومؤسس سابق. ساعد في التحقق من الفكرة، تحديد MVP، التسعير، والنمو، بنصائح عملية ومباشرة.' },
    { id: 'mobile', icon: 'fa-mobile-screen', name: 'مطور موبايل 📱', desc: 'Flutter / React Native / Native', prompt: 'أنت مطور تطبيقات موبايل خبير (Flutter, React Native, Swift, Kotlin). اهتم بالأداء، إدارة الحالة، العمل دون اتصال، ومتطلبات المتاجر.' },
    { id: 'algo', icon: 'fa-diagram-project', name: 'خبير خوارزميات 🧮', desc: 'مسابقات وتعقيد زمني', prompt: 'أنت خبير خوارزميات وبرمجة تنافسية. حلّل المسألة، اقترح الحل الأمثل مع التعقيد الزمني والمكاني، وقارن بالحل البسيط.' }
];

export function installLibrary(P) {
    P.BUILTIN_PROMPTS = BUILTIN_PROMPTS;
    P.PERSONA_MARKET = PERSONA_MARKET;

    // ================================================================== PROMPT LIBRARY (#34)
    const PKEY = 'ox_alpha_prompts_v1';
    P.getUserPrompts = function () { return lsGet(PKEY, []); };
    P.saveUserPrompts = function (list) { lsSet(PKEY, list); };
    P.allPrompts = function () {
        const meta = lsGet('ox_alpha_prompt_meta_v1', {});
        return [...this.getUserPrompts().map(p => ({ ...p, user: true })), ...BUILTIN_PROMPTS].map(p => ({ ...p, uses: (meta[p.id] || {}).uses || p.uses || 0, fav: !!(meta[p.id] || {}).fav }));
    };
    P.searchPrompts = function (q = '', cat = 'all') {
        const s = q.trim().toLowerCase();
        return this.allPrompts().filter(p => (cat === 'all' || (cat === 'fav' ? p.fav : p.cat === cat)) && (!s || `${p.title} ${p.text} ${(p.tags || []).join(' ')}`.toLowerCase().includes(s)))
            .sort((a, b) => (b.fav - a.fav) || (b.uses - a.uses));
    };
    P.savePrompt = function ({ id, title, text, cat = 'مخصص', tags = [] }) {
        if (!String(text || '').trim()) return null;
        const list = this.getUserPrompts();
        const i = id ? list.findIndex(p => p.id === id) : -1;
        const p = { id: i >= 0 ? id : uid('up'), title: String(title || text.slice(0, 40)).trim(), text, cat, tags: Array.isArray(tags) ? tags : String(tags).split(/[,،]\s*/).filter(Boolean), ts: Date.now() };
        if (i >= 0) list[i] = p; else list.unshift(p);
        this.saveUserPrompts(list);
        return p;
    };
    P.deletePrompt = function (id) { this.saveUserPrompts(this.getUserPrompts().filter(p => p.id !== id)); };
    P.togglePromptFav = function (id) {
        const meta = lsGet('ox_alpha_prompt_meta_v1', {});
        meta[id] = { ...(meta[id] || {}), fav: !(meta[id] || {}).fav };
        lsSet('ox_alpha_prompt_meta_v1', meta);
        return meta[id].fav;
    };
    /** Fill {{variables}} (asks the user) then put the prompt in the chat input. */
    P.usePrompt = async function (id, { send = false, values } = {}) {
        const p = this.allPrompts().find(x => x.id === id);
        if (!p) return null;
        const vars = templateVars(p.text);
        let vals = values || {};
        if (vars.length && !values) {
            const code = vars.includes('code') ? this.aiCodeInput().code : '';
            const r = await this.showDialog({ title: p.title, wide: true, fields: vars.map(v => ({ id: v, type: v === 'code' || v === 'text' || v === 'changes' ? 'textarea' : 'text', label: v, value: v === 'code' ? code : '' })), buttons: [{ label: send ? 'إرسال' : 'إدراج', value: 'ok', primary: true }, { label: 'إلغاء', value: null }] });
            if (!r) return null;
            vals = r.values;
        }
        const { text } = fillTemplate(p.text, vals);
        const meta = lsGet('ox_alpha_prompt_meta_v1', {});
        meta[id] = { ...(meta[id] || {}), uses: ((meta[id] || {}).uses || 0) + 1 };
        lsSet('ox_alpha_prompt_meta_v1', meta);
        if (this.closeModals) this.closeModals();
        if (send) this.sendQuickPrompt(text);
        else { const input = document.getElementById('user-input'); if (input) { input.value = text; input.focus(); if (this.autoResizeTextarea) this.autoResizeTextarea(input); } }
        return text;
    };
    P.saveInputAsPrompt = async function () {
        const input = document.getElementById('user-input');
        const text = input ? input.value.trim() : '';
        if (!text) { this.showToast('اكتب البرومبت في حقل الإدخال أولاً — استخدم {{متغير}} للحقول', 'info'); return null; }
        const r = await this.showDialog({ title: 'حفظ في مكتبة البرومبتات', fields: [{ id: 'title', type: 'text', label: 'العنوان', value: text.slice(0, 40) }, { id: 'cat', type: 'text', label: 'التصنيف', value: 'مخصص' }, { id: 'tags', type: 'text', label: 'وسوم (مفصولة بفواصل)', value: '' }], buttons: [{ label: 'حفظ', value: 'ok', primary: true }, { label: 'إلغاء', value: null }] });
        if (!r) return null;
        const p = this.savePrompt({ ...r.values, text });
        this.showToast('📚 حُفظ البرومبت', 'success');
        return p;
    };
    P.exportPrompts = function () { this.downloadBlob(new Blob([JSON.stringify({ version: 1, prompts: this.getUserPrompts() }, null, 2)], { type: 'application/json' }), 'ox-prompts.json'); };
    P.importPrompts = function (json) {
        let data;
        try { data = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { this.showToast('ملف غير صالح', 'error'); return 0; }
        const incoming = (Array.isArray(data) ? data : data.prompts || []).filter(p => p && p.text);
        const list = this.getUserPrompts();
        let n = 0;
        incoming.forEach(p => { if (!list.some(x => x.text === p.text)) { list.push({ id: uid('up'), title: p.title || p.text.slice(0, 40), text: p.text, cat: p.cat || 'مستورد', tags: p.tags || [], ts: Date.now() }); n++; } });
        this.saveUserPrompts(list);
        return n;
    };

    // ================================================================== PERSONAS (#36)
    P.installPersona = function (id) {
        const p = PERSONA_MARKET.find(x => x.id === id) || (this.getAISettings().customPersonas || []).find(x => x.id === id);
        if (!p) return false;
        const s = this.getAISettings();
        const installed = Array.from(new Set([...(s.personas || []), id]));
        this.setAISettings({ personas: installed });
        this.registerPersona(p);
        return true;
    };
    P.uninstallPersona = function (id) {
        const s = this.getAISettings();
        this.setAISettings({ personas: (s.personas || []).filter(x => x !== id) });
        if (this.activePersona === 'mk_' + id) this.setPersona('fullstack');
        return true;
    };
    P.createCustomPersona = async function (data) {
        if (!data) {
            const r = await this.showDialog({ title: 'شخصية مخصصة', wide: true, fields: [{ id: 'name', type: 'text', label: 'الاسم', value: '' }, { id: 'desc', type: 'text', label: 'وصف قصير', value: '' }, { id: 'prompt', type: 'textarea', label: 'التعليمات (System prompt)', value: '' }], buttons: [{ label: 'إنشاء', value: 'ok', primary: true }, { label: 'إلغاء', value: null }] });
            if (!r || !r.values.prompt) return null;
            data = r.values;
        }
        const p = { id: uid('cp'), icon: 'fa-user-astronaut', name: data.name || 'شخصيتي', desc: data.desc || '', prompt: data.prompt, custom: true };
        const s = this.getAISettings();
        this.setAISettings({ customPersonas: [...(s.customPersonas || []), p] });
        this.installPersona(p.id);
        if (document.getElementById('ai-lab')) this.openAILab('library');
        return p;
    };
    P.renderLibraryTab = function (root) {
        const q = this._plQ || '', cat = this._plCat || 'all';
        const cats = ['all', 'fav', ...Array.from(new Set(this.allPrompts().map(p => p.cat)))];
        const list = this.searchPrompts(q, cat);
        const s = this.getAISettings();
        const installed = new Set(s.personas || []);
        const personas = [...PERSONA_MARKET, ...(s.customPersonas || [])];
        root.innerHTML = `<h4><i class="fa-solid fa-book-bookmark"></i> مكتبة البرومبتات (${this.allPrompts().length})</h4>
            <div class="gh-toolbar"><input id="pl-q" class="form-input-box" dir="auto" placeholder="ابحث…" value="${esc(q)}" oninput="app._plQ=this.value; clearTimeout(app._plT); app._plT=setTimeout(()=>{app.openAILab('library'); const i=document.getElementById('pl-q'); if(i){i.focus(); i.setSelectionRange(i.value.length,i.value.length);}},250)">
            <button class="sidebar-btn-util gh-btn" onclick="app.saveInputAsPrompt().then(()=>app.openAILab('library'))"><i class="fa-solid fa-floppy-disk"></i> حفظ نص الإدخال</button>
            <button class="sidebar-btn-util gh-btn" onclick="app.exportPrompts()"><i class="fa-solid fa-file-export"></i></button></div>
            <div class="ai-chips">${cats.map(c => `<button class="fx-link ${c === cat ? 'active' : ''}" onclick="app._plCat='${esc(c)}'; app.openAILab('library')">${c === 'all' ? 'الكل' : c === 'fav' ? '⭐ المفضلة' : esc(c)}</button>`).join('')}</div>
            <div class="ai-prompts">${list.slice(0, 80).map(p => `<div class="ai-prompt" data-prompt="${p.id}"><div><b>${esc(p.title)}</b> <small class="gh-muted">${esc(p.cat)}${p.uses ? ` • ${p.uses}×` : ''}</small><p dir="auto">${esc(p.text.slice(0, 140))}</p></div><div class="ai-prompt-actions"><button class="fx-link" onclick="app.togglePromptFav('${p.id}'); app.openAILab('library')" aria-label="مفضلة">${p.fav ? '⭐' : '☆'}</button><button class="fx-link" onclick="app.usePrompt('${p.id}')" title="إدراج"><i class="fa-solid fa-arrow-down"></i></button><button class="fx-link" onclick="app.usePrompt('${p.id}',{send:true})" title="إرسال"><i class="fa-solid fa-paper-plane"></i></button>${p.user ? `<button class="fx-link" onclick="app.deletePrompt('${p.id}'); app.openAILab('library')" aria-label="حذف"><i class="fa-solid fa-trash"></i></button>` : ''}</div></div>`).join('') || '<p class="gh-muted">لا نتائج</p>'}</div>
            <h4><i class="fa-solid fa-masks-theater"></i> سوق الشخصيات</h4>
            <div class="ai-grid">${personas.map(p => `<div class="ai-card persona ${this.activePersona === 'mk_' + p.id ? 'active' : ''}" data-persona="${p.id}"><i class="fa-solid ${p.icon}"></i><span>${esc(p.name)}</span><small>${esc(p.desc)}</small><div class="ai-card-actions">${installed.has(p.id) ? `<button class="fx-link" onclick="app.setPersona('mk_${p.id}'); app.openAILab('library')">تفعيل</button><button class="fx-link" onclick="app.uninstallPersona('${p.id}'); app.openAILab('library')">إزالة</button>` : `<button class="fx-link" onclick="app.installPersona('${p.id}'); app.openAILab('library')"><i class="fa-solid fa-download"></i> تثبيت</button>`}</div></div>`).join('')}
            <button class="ai-card" onclick="app.createCustomPersona()"><i class="fa-solid fa-plus"></i><span>شخصية مخصصة</span><small>اكتب تعليماتك الخاصة</small></button></div>`;
    };

    // ================================================================== MODEL EXPLORER (#1)
    /** Measured speed (tokens/s) and latency from local usage history. */
    P.modelSpeedStats = function () {
        const by = {};
        (this.loadUsage ? this.loadUsage() : []).forEach(r => {
            if (!r.m || !r.ms || !r.ct) return;
            const b = by[r.m] = by[r.m] || { n: 0, tps: 0 };
            b.n++; b.tps += r.ct / (r.ms / 1000);
        });
        Object.values(by).forEach(b => { b.tps = Math.round(b.tps / b.n); });
        return by;
    };
    /** Pure filter/sort over model metadata. price = USD per 1M prompt tokens. */
    P.filterModels = function (models, f = {}) {
        const speed = f.speed || {};
        const per1M = (m) => (m.pricing ? m.pricing.prompt * 1e6 : 0);
        const q = String(f.q || '').toLowerCase();
        const out = (models || []).filter(m => {
            if (q && !`${m.id} ${m.name || ''}`.toLowerCase().includes(q)) return false;
            if (f.free === 'free' && !m.is_free) return false;
            if (f.free === 'paid' && m.is_free) return false;
            if (f.maxPrice != null && f.maxPrice !== '' && per1M(m) > +f.maxPrice) return false;
            if (f.minContext && (m.context_length || 0) < +f.minContext) return false;
            if (f.vision && !m.is_vision) return false;
            if (f.reasoning && !m.is_reasoning) return false;
            if (f.provider && f.provider !== 'all' && m.provider !== f.provider) return false;
            return true;
        });
        const key = { price: (m) => per1M(m), context: (m) => -(m.context_length || 0), speed: (m) => -((speed[m.id] || {}).tps || 0), name: (m) => (m.name || m.id) }[f.sort || 'price'];
        return out.sort((a, b) => { const x = key(a), y = key(b); return typeof x === 'string' ? x.localeCompare(y) : x - y; });
    };
    P.renderModelsTab = function (root) {
        const f = this._mf = this._mf || { free: 'all', sort: 'price', maxPrice: '', minContext: '', provider: 'all', q: '' };
        const models = this.availableModels || [];
        const speed = this.modelSpeedStats();
        const list = this.filterModels(models, { ...f, speed });
        const providers = Array.from(new Set(models.map(m => m.provider))).sort();
        const set = (k) => `app._mf.${k}=this.type==='checkbox'?this.checked:this.value; app.openAILab('models')`;
        root.innerHTML = `<div class="ai-grid2">
            <input class="form-input-box" placeholder="ابحث في ${models.length} نموذج…" value="${esc(f.q)}" onchange="${set('q')}">
            <select class="form-input-box" onchange="${set('free')}">${[['all', 'الكل'], ['free', 'مجاني'], ['paid', 'مدفوع']].map(([v, l]) => `<option value="${v}" ${f.free === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <select class="form-input-box" onchange="${set('sort')}">${[['price', 'الأرخص'], ['speed', 'الأسرع (مقاس)'], ['context', 'أكبر سياق'], ['name', 'الاسم']].map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>ترتيب: ${l}</option>`).join('')}</select>
            <select class="form-input-box" onchange="${set('provider')}"><option value="all">كل المزودين</option>${providers.map(p => `<option ${f.provider === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
            <input class="form-input-box" type="number" min="0" step="0.1" placeholder="أقصى سعر $/مليون" value="${esc(f.maxPrice)}" onchange="${set('maxPrice')}">
            <input class="form-input-box" type="number" min="0" step="1000" placeholder="أدنى سياق" value="${esc(f.minContext)}" onchange="${set('minContext')}"></div>
            <div class="ai-chips"><label class="ai-check"><input type="checkbox" ${f.vision ? 'checked' : ''} onchange="${set('vision')}"> رؤية</label><label class="ai-check"><input type="checkbox" ${f.reasoning ? 'checked' : ''} onchange="${set('reasoning')}"> تفكير</label><button class="fx-link" onclick="app.fetchOpenRouterModels && app.fetchOpenRouterModels(true).then(()=>app.openAILab('models'))"><i class="fa-solid fa-rotate"></i> تحديث القائمة</button><span class="gh-muted">${list.length} نتيجة</span></div>
            <table class="ai-table"><thead><tr><th>النموذج</th><th>$/مليون (دخل/خرج)</th><th>السياق</th><th>السرعة</th><th></th></tr></thead><tbody>
            ${list.slice(0, 150).map(m => `<tr data-model="${esc(m.id)}" class="${m.id === this.settings.model ? 'active' : ''}"><td><b>${esc(m.name || m.id)}</b><br><small dir="ltr">${esc(m.id)}</small> ${m.is_free ? '<span class="ai-badge green">free</span>' : ''}${m.is_vision ? ' 👁️' : ''}${m.is_reasoning ? ' 🧠' : ''}</td><td dir="ltr">${m.is_free ? '0' : `${(m.pricing.prompt * 1e6).toFixed(2)} / ${(m.pricing.completion * 1e6).toFixed(2)}`}</td><td>${Math.round((m.context_length || 0) / 1000)}K</td><td>${speed[m.id] ? `${speed[m.id].tps} t/s` : '—'}</td><td><button class="fx-link" onclick="app.selectModel('${esc(m.id)}'); app.openAILab('models')">استخدام</button></td></tr>`).join('')}
            </tbody></table>${list.length > 150 ? `<p class="gh-muted">يُعرض أول 150 — ضيّق الفلاتر.</p>` : ''}`;
    };

    // ================================================================== SETTINGS TAB
    P.renderAISettingsTab = function (root) {
        const s = this.getAISettings();
        const chk = (k, label) => `<label class="ai-check"><input type="checkbox" data-aiset="${k}" ${s[k] ? 'checked' : ''} onchange="app.setAISettings({${k}: this.checked})"> ${label}</label>`;
        root.innerHTML = `<div class="ai-settings">
            ${chk('memory', '🧠 ذاكرة طويلة المدى (#5) — استرجاع ما يتعلق بسؤالك من المحادثات السابقة')}
            ${chk('autoSummarize', '📝 تلخيص المحادثات الطويلة تلقائياً (#18) — يرسل الملخص بدل الرسائل القديمة')}
            <label class="ai-field"><span>التلخيص بعد عدد رسائل</span><input type="number" min="10" max="200" class="form-input-box" value="${s.summarizeAt}" onchange="app.setAISettings({summarizeAt: +this.value})"></label>
            ${chk('cot', '🪜 إظهار التفكير خطوة بخطوة في المحادثة (#14)')}
            ${chk('standards', '📏 فرض معايير الفريق على المولدات (#81)')}
            ${chk('autocomplete', '✨ إكمال تلقائي في حقل الإدخال مثل Copilot (#31) — Tab للقبول')}
            <label class="ai-field"><span>أسئلة المتابعة (#19)</span><select class="form-input-box" onchange="app.setAISettings({followups: this.value})">${[['local', 'محلية سريعة (بدون تكلفة)'], ['ai', 'بالذكاء الاصطناعي (أدق)'], ['off', 'إيقاف']].map(([v, l]) => `<option value="${v}" ${s.followups === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="ai-field"><span>نموذج المختبر (فارغ = التوجيه الذكي حسب المهمة)</span><input class="form-input-box" dir="ltr" value="${esc(s.model || '')}" placeholder="مثال: deepseek/deepseek-chat-v3-0324:free" onchange="app.setAISettings({model: this.value.trim()})"></label>
            <div class="gh-toolbar"><button class="sidebar-btn-util gh-btn" onclick="app.summarizeSession(app.activeSessionId,{quiet:false})"><i class="fa-solid fa-compress"></i> لخّص المحادثة الحالية الآن</button></div></div>`;
    };
}
