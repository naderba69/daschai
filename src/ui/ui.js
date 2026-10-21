/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 7 lazy UI chunk (assets/studio/ui-[hash].mjs)
   Rarely-used panels and tools, loaded on first use so the main page stays small:
   UI settings (#325 #328-#330), theme editor (#273), context help (#303), tour (#301),
   lightbox (#308), trash (#350), favorites (#343), global search (#304),
   conversation manager (#305-#307 #349), compare (#351), dev tools (#371-#380),
   export as image (#385 #388), Picture-in-Picture (#390), driving / audio modes (#359 #408).
   ============================================================================== */
import UI_CSS from './ui.css';

const DAY = 864e5;
const TRASH_DAYS = 30;
const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };
const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const plainSearch = (s) => String(s || '').replace(/```[\s\S]*?```/g, ' [كود] ').replace(/[#*_>`~]+/g, ' ').replace(/\s+/g, ' ').trim();
const plain = (s) => String(s || '').replace(/```[\s\S]*?```/g, ' (كتلة كود) ').replace(/<[^>]+>/g, '').replace(/[#*_>`~|]+/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();

export const UI_METHODS = ["DEVICES", "TOUR_STEPS", "bindMiniChat", "captureShortcut", "closeGlobalSearch", "closeLightbox", "cmBulk", "cmItems", "cmSelectAll", "cmToggleSelect", "compareColumnHTML", "cssPath", "devMetrics", "deviceFrameSize", "drivingMicPress", "endTour", "exportMessagesImage", "globalSearch", "layoutConversation", "lightboxAction", "miniChatHTML", "miniChatShell", "openCompareSessions", "openContextHelp", "openConversationManager", "openDeviceEmulator", "openFavorites", "openFileFromSearch", "openGlobalSearch", "openLightbox", "openMiniChat", "openThemeEditor", "openTrash", "openUISettings", "renderCMBulk", "renderConversationCanvas", "renderConversationManager", "renderDeviceFrame", "renderDrivingMode", "renderFavorites", "renderGlobalSearch", "renderLightbox", "renderMiniChat", "renderTour", "renderTrash", "runGlobalSearchItem", "setCMView", "setNetworkSim", "setVoiceConversation", "speakLastReply", "speakableText", "startInspect", "startTour", "stopInspect", "toggleDevHUD", "tourStep"];

export function install(app) {
    const P = Object.getPrototypeOf(app);
    if (P.__oxUI) return P.__oxUI;
    P.__oxUI = { methods: UI_METHODS };
    if (typeof document !== 'undefined' && !document.getElementById('ox-ui-chunk-css')) {
        const st = document.createElement('style');
        st.id = 'ox-ui-chunk-css';
        st.textContent = UI_CSS;
        document.head.appendChild(st);
    }

    // ------------------------------------------------------------------ TOUR (#301)
    P.TOUR_STEPS = [
        ['.btn-new-thread', 'محادثة جديدة', 'ابدأ محادثة جديدة من هنا أو بالاختصار Alt+N.'],
        ['.nav-model-pill', 'اختيار النموذج', 'بدّل نموذج الذكاء الاصطناعي في أي وقت — النماذج المجانية متاحة.'],
        ['#user-input', 'اكتب رسالتك', 'اكتب سؤالك هنا. ابدأ بـ / للأوامر السريعة و Ctrl+Enter للإرسال.'],
        ['#btn-mic', 'الإملاء الصوتي', 'تحدّث بالعربية أو الفرنسية أو الإنجليزية بدل الكتابة.'],
        ['#notif-bell-btn', 'الإشعارات', 'هنا تجد اكتمال الردود في الخلفية والأخطاء والتذكيرات.'],
        ['[onclick="app.openCommandPalette()"]', 'لوحة الأوامر', 'كل ميزة على بُعد Ctrl+K — جرّب كتابة «مظهر» أو «GitHub».'],
        ['[onclick="app.openSettingsModal()"]', 'الإعدادات', 'أدخل مفتاح OpenRouter المجاني ثم خصّص الواجهة كما تحب.']
    ];
    P.startTour = function (i = 0) {
        const steps = this.TOUR_STEPS.filter(([sel]) => document.querySelector(sel));
        if (!steps.length) return false;
        this._tour = { steps, i: clamp(i, 0, steps.length - 1) };
        let ov = document.getElementById('ox-tour');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'ox-tour'; ov.className = 'ox-tour';
            ov.innerHTML = '<div class="tour-spot"></div><div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title"><div class="tour-step"></div><h3 id="tour-title"></h3><p></p><div class="tour-actions"><button class="banner-btn-link" data-t="skip">تخطي</button><span class="gh-spacer"></span><button class="banner-btn-link" data-t="prev">السابق</button><button class="banner-btn-action" data-t="next">التالي</button></div></div>';
            ov.addEventListener('click', (e) => { const t = e.target.closest('[data-t]'); if (!t) return; if (t.dataset.t === 'next') this.tourStep(1); else if (t.dataset.t === 'prev') this.tourStep(-1); else this.endTour(); });
            document.body.appendChild(ov);
        }
        this.renderTour();
        return true;
    };
    P.tourStep = function (d) { if (!this._tour) return; const n = this._tour.i + d; if (n >= this._tour.steps.length) return this.endTour(true); this._tour.i = clamp(n, 0, this._tour.steps.length - 1); this.renderTour(); };
    P.renderTour = function () {
        const ov = document.getElementById('ox-tour');
        if (!ov || !this._tour) return;
        const { steps, i } = this._tour, [sel, title, text] = steps[i];
        const el = document.querySelector(sel);
        const r = el ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
        const spot = ov.querySelector('.tour-spot'), card = ov.querySelector('.tour-card');
        const vis = r.width > 0 && r.height > 0;
        spot.style.display = vis ? '' : 'none';
        if (vis) Object.assign(spot.style, { left: (r.left - 6) + 'px', top: (r.top - 6) + 'px', width: (r.width + 12) + 'px', height: (r.height + 12) + 'px' });
        ov.querySelector('.tour-step').textContent = `${i + 1} / ${steps.length}`;
        ov.querySelector('h3').textContent = title;
        ov.querySelector('p').textContent = text;
        ov.querySelector('[data-t="prev"]').disabled = i === 0;
        ov.querySelector('[data-t="next"]').textContent = i === steps.length - 1 ? 'إنهاء ✓' : 'التالي';
        const vh = window.innerHeight || 768, vw = window.innerWidth || 1024;
        if (vis) { const below = r.bottom + 190 < vh; card.style.top = (below ? r.bottom + 14 : Math.max(10, r.top - 190)) + 'px'; card.style.left = clamp(r.left + r.width / 2 - 160, 10, vw - 330) + 'px'; card.classList.remove('centered'); }
        else { card.style.top = ''; card.style.left = ''; card.classList.add('centered'); }
        const next = card.querySelector('[data-t="next"]');
        if (next) next.focus();
    };
    P.endTour = function (completed) {
        const ov = document.getElementById('ox-tour');
        if (ov) ov.remove();
        this._tour = null;
        this.setUIPrefs({ toured: true }, { apply: false });
        if (completed) this.showToast('🎉 انتهت الجولة — اضغط ? في أي وقت للمساعدة', 'success');
        return true;
    };


    // ------------------------------------------------------------------ CONTEXT HELP (#303)
    P.openContextHelp = function () {
        const studio = !!this.isCodeStudioOpen;
        const custom = Object.entries(this.getUIPrefs().shortcuts || {});
        const rows = (list) => list.map(([k, l]) => `<div class="help-row"><kbd>${this.escapeHTML(k)}</kbd><span>${this.escapeHTML(l)}</span></div>`).join('');
        const tips = studio
            ? ['انقر بالزر الأيمن على ملف في المستكشف لخيارات إضافية.', 'اسحب الفاصل بين المحادثة والمحرر لتغيير العرض.', 'مسار الملف أعلى المحرر قابل للنقر للتنقل بين ملفات المجلد.']
            : ['انقر بالزر الأيمن (أو اضغط مطولاً) على رسالة أو محادثة لقائمة سريعة.', 'حدّد نصاً في رد لنسخه أو اقتباسه أو طلب شرحه.', 'اضغط Alt+S للبحث في كل المحادثات والملفات والأوامر.'];
        this.openPanel({
            title: studio ? 'مساعدة: استوديو الكود' : 'مساعدة: المحادثة', icon: 'fa-circle-question',
            body: `<div class="help-grid">
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-lightbulb"></i> نصائح لهذا السياق</div><ul class="help-tips">${tips.map(t => `<li>${t}</li>`).join('')}</ul></div>
                ${studio ? `<div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-code"></i> اختصارات المحرر</div>${rows(this.STUDIO_SHORTCUTS)}</div>` : ''}
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-keyboard"></i> اختصارات عامة</div>${rows(this.BUILTIN_SHORTCUTS)}</div>
                ${custom.length ? `<div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-star"></i> اختصاراتك</div>${rows(custom)}</div>` : ''}
            </div>`,
            footer: `<button class="sidebar-btn-util gh-btn" onclick="app.closeModals(); app.startTour()"><i class="fa-solid fa-route"></i> الجولة التعريفية</button><button class="sidebar-btn-util gh-btn" onclick="app.openUISettings('shortcuts')"><i class="fa-solid fa-keyboard"></i> تخصيص الاختصارات</button>`
        });
    };


    // ------------------------------------------------------------------ LIGHTBOX (#308)
    P.openLightbox = function (src, gallery) {
        const list = (gallery && gallery.length ? gallery : [src]).filter(Boolean);
        const i = Math.max(0, list.indexOf(src));
        this._lb = { list, i, scale: 1, x: 0, y: 0, rot: 0 };
        let ov = document.getElementById('ox-lightbox');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'ox-lightbox'; ov.className = 'ox-lightbox';
            ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'عارض الصور');
            ov.innerHTML = `<div class="lb-stage"><img alt="" draggable="false"></div>
                <div class="lb-bar"><span class="lb-count"></span><span class="gh-spacer"></span>
                <button data-lb="prev" aria-label="السابق"><i class="fa-solid fa-chevron-right"></i></button><button data-lb="next" aria-label="التالي"><i class="fa-solid fa-chevron-left"></i></button>
                <button data-lb="out" aria-label="تصغير"><i class="fa-solid fa-magnifying-glass-minus"></i></button><button data-lb="in" aria-label="تكبير"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
                <button data-lb="rot" aria-label="تدوير"><i class="fa-solid fa-rotate-right"></i></button><button data-lb="reset" aria-label="إعادة"><i class="fa-solid fa-compress"></i></button>
                <button data-lb="dl" aria-label="تنزيل"><i class="fa-solid fa-download"></i></button><button data-lb="close" aria-label="إغلاق"><i class="fa-solid fa-xmark"></i></button></div>`;
            ov.addEventListener('click', (e) => {
                const b = e.target.closest('[data-lb]');
                if (b) return this.lightboxAction(b.dataset.lb);
                if (e.target === ov || e.target.classList.contains('lb-stage')) this.closeLightbox();
            });
            ov.addEventListener('wheel', (e) => { e.preventDefault(); this.lightboxAction(e.deltaY < 0 ? 'in' : 'out'); }, { passive: false });
            const img = ov.querySelector('img');
            let drag = null;
            img.addEventListener('pointerdown', (e) => { drag = { x: e.clientX - this._lb.x, y: e.clientY - this._lb.y }; try { img.setPointerCapture(e.pointerId); } catch (err) {} });
            img.addEventListener('pointermove', (e) => { if (!drag || this._lb.scale <= 1) return; this._lb.x = e.clientX - drag.x; this._lb.y = e.clientY - drag.y; this.renderLightbox(); });
            img.addEventListener('pointerup', () => { drag = null; });
            document.body.appendChild(ov);
        }
        ov.classList.add('active');
        this.renderLightbox();
        const close = ov.querySelector('[data-lb="close"]');
        if (close) close.focus();
        return true;
    };
    P.lightboxAction = function (a) {
        const lb = this._lb;
        if (!lb) return;
        if (a === 'close') return this.closeLightbox();
        if (a === 'next' || a === 'prev') { lb.i = (lb.i + (a === 'next' ? 1 : -1) + lb.list.length) % lb.list.length; lb.scale = 1; lb.x = lb.y = 0; lb.rot = 0; }
        if (a === 'in') lb.scale = Math.min(8, +(lb.scale * 1.25).toFixed(3));
        if (a === 'out') lb.scale = Math.max(0.25, +(lb.scale / 1.25).toFixed(3));
        if (a === 'rot') lb.rot = (lb.rot + 90) % 360;
        if (a === 'reset') { lb.scale = 1; lb.x = lb.y = 0; lb.rot = 0; }
        if (a === 'dl') { const l = document.createElement('a'); l.href = lb.list[lb.i]; l.download = 'image-' + (lb.i + 1) + '.png'; document.body.appendChild(l); l.click(); l.remove(); }
        this.renderLightbox();
    };
    P.renderLightbox = function () {
        const ov = document.getElementById('ox-lightbox'), lb = this._lb;
        if (!ov || !lb) return;
        const img = ov.querySelector('img');
        if (img.getAttribute('src') !== lb.list[lb.i]) img.setAttribute('src', lb.list[lb.i]);
        img.style.transform = `translate(${lb.x}px, ${lb.y}px) scale(${lb.scale}) rotate(${lb.rot}deg)`;
        ov.querySelector('.lb-count').textContent = `${lb.i + 1} / ${lb.list.length} • ${Math.round(lb.scale * 100)}%`;
        ov.querySelectorAll('[data-lb="prev"],[data-lb="next"]').forEach(b => { b.style.display = lb.list.length > 1 ? '' : 'none'; });
    };
    P.closeLightbox = function () { const ov = document.getElementById('ox-lightbox'); if (ov) ov.classList.remove('active'); this._lb = null; return true; };


    // ------------------------------------------------------------------ UI SETTINGS PANEL (appearance, a11y, notifications #325, brand, shortcuts, share)
    P.openUISettings = function (tab = 'appearance') {
        const u = this.getUIPrefs(), esc = (s) => this.escapeHTML(s == null ? '' : String(s));
        const toggle = (label, checked, onchange, sub = '') => `<label class="plat-toggle"><input type="checkbox" ${checked ? 'checked' : ''} onchange="${onchange}"><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span></label>`;
        const sel = (label, value, opts, onchange, sub = '') => `<label class="plat-toggle"><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span><select class="form-input-box" onchange="${onchange}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
        const tabs = [['appearance', 'fa-palette', 'المظهر'], ['a11y', 'fa-universal-access', 'الوصول'], ['notify', 'fa-bell', 'الإشعارات والأصوات'], ['brand', 'fa-signature', 'الهوية والترحيب'], ['shortcuts', 'fa-keyboard', 'الاختصارات'], ['share', 'fa-share-nodes', 'مشاركة']];
        let body = '';
        if (tab === 'appearance') {
            body = `<div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-palette"></i> السمة</div><div class="gh-toolbar"><button class="btn-new-thread gh-btn" onclick="app.openThemeEditor()"><i class="fa-solid fa-paintbrush"></i> محرر المظهر المخصص</button>${this.openThemePicker ? '<button class="sidebar-btn-util gh-btn" onclick="app.closeModals(); app.openThemePicker()"><i class="fa-solid fa-swatchbook"></i> السمات الجاهزة</button>' : ''}</div></div>
                ${sel('خط الواجهة', u.fontUI, this.UI_FONTS, "app.setUIPrefs({fontUI:this.value})", 'يُحمّل من Google Fonts عند الاختيار')}
                ${sel('خط الكود', u.fontCode, this.CODE_FONTS, "app.setUIPrefs({fontCode:this.value})")}
                ${sel('كثافة العرض', u.density, [['compact', 'مضغوط'], ['comfortable', 'مريح'], ['spacious', 'واسع']], "app.setUIPrefs({density:this.value})")}
                <label class="plat-toggle"><span><b>حجم نص الرسائل</b><small>${Math.round(u.textScale * 100)}% — Ctrl+Alt+= / Ctrl+Alt+-</small></span><input type="range" min="0.8" max="1.6" step="0.05" value="${u.textScale}" onchange="app.setTextScale(this.value)" aria-label="حجم نص الرسائل"></label>
                ${toggle('خلفية متدرجة متحركة', u.meshBg, 'app.setUIPrefs({meshBg:this.checked})', 'Gradient mesh خفيف خلف الواجهة')}
                ${toggle('إخفاء تفاصيل الرسائل', u.hideDetails, 'app.setUIPrefs({hideDetails:this.checked})', 'الوقت والنموذج وأزرار الرسائل تظهر عند المرور فقط')}
                ${toggle('طي كتل الكود الطويلة', u.collapseCode, 'app.setUIPrefs({collapseCode:this.checked})')}
                ${toggle('المظاهر الموسمية والمناسبات', u.seasonal, 'app.setUIPrefs({seasonal:this.checked})', 'لمسات حسب الفصل ورمضان والأعياد')}
                <div class="gh-toolbar">${Object.entries(this.LAYOUTS).map(([id, l]) => `<button class="sidebar-btn-util gh-btn" onclick="app.closeModals(); app.applyLayout('${id}')"><i class="fa-solid ${l.icon}"></i> ${l.label}</button>`).join('')}<button class="sidebar-btn-util gh-btn" onclick="app.closeModals(); app.toggleReadingMode(true)"><i class="fa-solid fa-book-open"></i> وضع القراءة</button></div>`;
        } else if (tab === 'a11y') {
            body = `${sel('وضع الواجهة', u.mode, [['normal', 'عادي'], ['kids', '🧒 الأطفال'], ['senior', '👓 كبار السن']], 'app.setUIMode(this.value)', 'يبسّط الواجهة ويكيّف أسلوب الإجابات')}
                ${sel('عمى الألوان', u.colorBlind, [['none', 'بدون'], ['deuteranopia', 'Deuteranopia (أخضر)'], ['protanopia', 'Protanopia (أحمر)'], ['tritanopia', 'Tritanopia (أزرق)'], ['achromatopsia', 'Achromatopsia (أحادي)']], 'app.setUIPrefs({colorBlind:this.value})', 'ألوان حالة آمنة (Okabe-Ito) ومؤشرات غير لونية')}
                ${sel('تقليل الحركة', u.reduceMotion, [['auto', 'تلقائي (حسب النظام)'], ['on', 'مفعّل'], ['off', 'معطّل']], 'app.setUIPrefs({reduceMotion:this.value})')}
                ${toggle('تلميحات منسّقة', u.tooltips, 'app.setUIPrefs({tooltips:this.checked})', 'تلميحات مع اختصارات لوحة المفاتيح')}
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-keyboard"></i> التنقل بلوحة المفاتيح</div><ul class="help-tips"><li><kbd>F6</kbd> للتنقل بين القائمة والمحادثة وحقل الكتابة والمحرر.</li><li>داخل المحادثة: <kbd>↑</kbd>/<kbd>↓</kbd> بين الرسائل، <kbd>C</kbd> نسخ، <kbd>Enter</kbd> قائمة الرسالة.</li><li><kbd>Tab</kbd> في بداية الصفحة يُظهر روابط التخطي.</li></ul></div>`;
        } else if (tab === 'notify') {
            const perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
            body = `${toggle('إشعار عند اكتمال رد في الخلفية', u.notify.reply, 'app.setUIPrefs({notify:{reply:this.checked}})', 'عند التبديل لمحادثة أخرى أو إخفاء التبويب')}
                ${toggle('تسجيل الأخطاء في مركز الإشعارات', u.notify.errors, 'app.setUIPrefs({notify:{errors:this.checked}})')}
                ${toggle('إشعارات التذكير', u.notify.reminders, 'app.setUIPrefs({notify:{reminders:this.checked}})')}
                ${toggle('إشعارات سطح المكتب', u.notify.desktop !== false && perm === 'granted', "this.checked ? app.requestDesktopNotifications() : app.setUIPrefs({notify:{desktop:false}})", perm === 'unsupported' ? 'غير مدعومة في هذا المتصفح' : perm === 'denied' ? 'الإذن مرفوض من المتصفح' : '')}
                ${toggle('سطح المكتب فقط عند إخفاء التبويب', u.notify.inactiveOnly, 'app.setUIPrefs({notify:{inactiveOnly:this.checked}})')}
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-music"></i> الأصوات</div>
                ${sel('حزمة الأصوات', u.sound.pack, [['chime', 'رنين'], ['soft', 'ناعم'], ['retro', 'ريترو 8-bit'], ['drop', 'قطرة'], ['none', 'بدون صوت']], "app.setUIPrefs({sound:{pack:this.value}}); app.playSound('notify',{force:true})")}
                <label class="plat-toggle"><span><b>مستوى الصوت</b></span><input type="range" min="0" max="1" step="0.1" value="${u.sound.volume}" onchange="app.setUIPrefs({sound:{volume:+this.value}}); app.playSound('reply',{force:true})" aria-label="مستوى الصوت"></label>
                ${toggle('صوت اكتمال الرد', u.sound.reply, 'app.setUIPrefs({sound:{reply:this.checked}})')}${toggle('صوت الأخطاء', u.sound.error, 'app.setUIPrefs({sound:{error:this.checked}})')}${toggle('صوت الإرسال', u.sound.send, 'app.setUIPrefs({sound:{send:this.checked}})')}${toggle('صوت الإشعارات', u.sound.notify, 'app.setUIPrefs({sound:{notify:this.checked}})')}</div>
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-alarm-clock"></i> التذكير اليومي</div>
                ${toggle('تذكير يومي بجلسة البرمجة والتحدي', u.reminder.enabled, 'app.setUIPrefs({reminder:{enabled:this.checked}})')}
                <label class="plat-toggle"><span><b>الوقت</b></span><input type="time" class="form-input-box" value="${esc(u.reminder.time)}" onchange="app.setUIPrefs({reminder:{time:this.value}})"></label></div>`;
        } else if (tab === 'brand') {
            body = `<div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-signature"></i> الهوية</div>
                <label class="plat-toggle"><span><b>اسم التطبيق</b></span><input class="form-input-box" maxlength="40" value="${esc(u.brand.name)}" placeholder="OX-Alpha" onchange="app.setUIPrefs({brand:{name:this.value}})"></label>
                <label class="plat-toggle"><span><b>رمز الشعار</b><small>إيموجي أو حرف</small></span><input class="form-input-box" maxlength="4" value="${esc(u.brand.emoji)}" placeholder="✦" onchange="app.setUIPrefs({brand:{emoji:this.value}})"></label>
                <label class="plat-toggle"><span><b>لون الهوية</b></span><input type="color" value="${HEX.test(u.brand.accent) ? u.brand.accent : '#8ab4f8'}" onchange="app.setUIPrefs({brand:{accent:this.value}})"></label>
                <button class="sidebar-btn-util gh-btn" onclick="app.setUIPrefs({brand:{name:'',emoji:'',accent:''}}); app.applyTheme(app.currentTheme||'dark',true); app.openUISettings('brand')"><i class="fa-solid fa-rotate-left"></i> الهوية الافتراضية</button></div>
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-hand-sparkles"></i> شاشة الترحيب</div>
                <label class="plat-toggle"><span><b>اسمك</b><small>للتحية حسب الوقت</small></span><input class="form-input-box" maxlength="40" value="${esc(u.userName)}" onchange="app.setUIPrefs({userName:this.value})"></label>
                <label class="plat-toggle"><span><b>عنوان الترحيب</b></span><input class="form-input-box" maxlength="80" value="${esc(u.welcome.title)}" placeholder="OX-Alpha Workbench Pro" onchange="app.setUIPrefs({welcome:{title:this.value}}); app.renderMessages()"></label>
                <label class="plat-toggle"><span><b>النص التعريفي</b></span><input class="form-input-box" maxlength="200" value="${esc(u.welcome.subtitle)}" onchange="app.setUIPrefs({welcome:{subtitle:this.value}}); app.renderMessages()"></label>
                ${toggle('التحية حسب الوقت', u.greeting, 'app.setUIPrefs({greeting:this.checked}); app.renderMessages()')}${toggle('نصيحة اليوم', u.tips, 'app.setUIPrefs({tips:this.checked}); app.renderMessages()')}${toggle('اقتباس اليوم', u.quotes, 'app.setUIPrefs({quotes:this.checked}); app.renderMessages()')}</div>
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-bolt"></i> الاقتراحات السريعة (${u.suggestions.length}/12)</div>
                ${u.suggestions.map((s, i) => `<div class="share-rec"><i class="fa-solid fa-bolt"></i><div class="share-rec-main"><span>${esc(s.label)}</span><small>${esc(s.prompt.slice(0, 90))}</small></div><button class="fx-link" onclick="app.removeQuickSuggestion(${i})" aria-label="حذف"><i class="fa-solid fa-trash-can"></i></button></div>`).join('') || '<p class="gh-muted">تُستخدم الاقتراحات الافتراضية.</p>'}
                <div class="gh-toolbar"><input id="sug-label" class="form-input-box" placeholder="العنوان" maxlength="60"><input id="sug-prompt" class="form-input-box" placeholder="نص الطلب" style="flex:2"><button class="btn-new-thread gh-btn" onclick="app.addQuickSuggestion(document.getElementById('sug-label').value, document.getElementById('sug-prompt').value) && app.openUISettings('brand')"><i class="fa-solid fa-plus"></i> إضافة</button></div></div>`;
        } else if (tab === 'shortcuts') {
            const cmds = this.buildPaletteCommands();
            const list = Object.entries(u.shortcuts || {});
            body = `<div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-keyboard"></i> اختصاراتك (${list.length})</div>
                ${list.map(([c, l]) => `<div class="share-rec"><kbd>${esc(c)}</kbd><div class="share-rec-main"><span>${esc(l)}</span>${this.shortcutConflict(c) ? `<small class="text-warning">يتجاوز: ${esc(this.shortcutConflict(c))}</small>` : ''}</div><button class="fx-link" onclick="app.removeShortcut('${esc(c)}')" aria-label="حذف"><i class="fa-solid fa-trash-can"></i></button></div>`).join('') || '<p class="gh-muted">لا توجد اختصارات مخصصة بعد.</p>'}
                <div class="gh-toolbar"><select id="sc-cmd" class="form-input-box" style="flex:2" aria-label="الأمر">${cmds.map(c => `<option value="${esc(c.label)}">${esc((c.section ? c.section + ' › ' : '') + c.label)}</option>`).join('')}</select><button class="btn-new-thread gh-btn" onclick="app.captureShortcut()"><i class="fa-solid fa-record-vinyl"></i> سجّل التركيبة</button><span id="sc-capture" class="sc-capture"></span></div></div>
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-list"></i> الاختصارات المدمجة</div>${this.BUILTIN_SHORTCUTS.map(([k, l]) => `<div class="help-row"><kbd>${esc(k)}</kbd><span>${esc(l)}</span></div>`).join('')}</div>`;
        } else if (tab === 'share') {
            body = `<div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-share-nodes"></i> مشاركة ونقل تخصيص الواجهة</div>
                <p class="gh-muted">يشمل المظهر المخصص والخطوط والهوية والاقتراحات والاختصارات والأصوات. التخصيص محفوظ ضمن النسخ الاحتياطية ومزامنة Gist تلقائياً.</p>
                <div class="gh-toolbar"><button class="btn-new-thread gh-btn" onclick="app.shareUIConfig()"><i class="fa-solid fa-link"></i> رابط مشاركة</button><button class="sidebar-btn-util gh-btn" onclick="app.downloadUIConfig()"><i class="fa-solid fa-file-export"></i> تصدير JSON</button>
                <label class="sidebar-btn-util gh-btn"><i class="fa-solid fa-file-import"></i> استيراد<input type="file" accept=".json,application/json" hidden onchange="this.files[0] && app.importUIConfigFile(this.files[0])"></label>
                <button class="sidebar-btn-util gh-btn danger" onclick="app.askConfirm('إعادة كل تخصيصات الواجهة للافتراضي؟').then(ok => { if (ok) { app.resetUIPrefs(); app.openUISettings('share'); } })"><i class="fa-solid fa-rotate-left"></i> إعادة الضبط</button></div></div>`;
        }
        this.openPanel({ title: 'تخصيص الواجهة', icon: 'fa-wand-magic-sparkles', tabs: tabs.map(([id, icon, label]) => ({ id, icon, label, onclick: `app.openUISettings('${id}')` })), activeTab: tab, body: `<div id="ui-settings" data-tab="${tab}">${body}</div>` });
    };


    P.openThemeEditor = function () {
        const ct = this.getUIPrefs().customTheme || this.readCurrentThemeColors();
        const field = (k, label) => `<label class="theme-color-field"><input type="color" value="${ct[k]}" oninput="app.setCustomThemeColor('${k}', this.value)" aria-label="${label}"><span>${label}</span><code>${ct[k]}</code></label>`;
        const seeds = Object.entries(P.THEME_SEEDS).map(([id, s]) => `<button class="theme-seed" style="background:${s.bg};color:${s.text};border-color:${s.accent}" onclick="app.applyThemeSeed('${id}')">${id}</button>`).join('');
        const rewards = this.rewardThemesHTML ? this.rewardThemesHTML() : '';
        this.openPanel({
            title: 'محرر المظهر المخصص', icon: 'fa-palette',
            body: `<div id="theme-editor" class="theme-editor">
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-droplet"></i> الألوان (معاينة حية)</div>
                    <div class="theme-color-grid">${field('bg', 'الخلفية')}${field('surface', 'الأسطح')}${field('card', 'البطاقات')}${field('text', 'النص')}${field('accent', 'اللون المميز')}</div>
                    <div id="theme-contrast" class="theme-contrast" aria-live="polite"></div></div>
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-swatchbook"></i> نقاط بداية</div>
                    <div class="theme-seeds"><button class="theme-seed" onclick="app.applyThemeSeed('current')">من المظهر الحالي</button>${seeds}</div></div>
                ${rewards}
                <div class="hub-section theme-preview-box"><div class="hub-section-title"><i class="fa-solid fa-eye"></i> معاينة</div>
                    <div class="msg-card usr" style="margin-bottom:6px">رسالة المستخدم</div><div class="msg-card bot"><div class="markdown-body">رد المساعد مع <a href="#">رابط</a> و <code>code</code></div></div></div>
            </div>`,
            footer: `<button class="btn-new-thread gh-btn" onclick="app.applyTheme('custom')"><i class="fa-solid fa-check"></i> اعتماد</button><button class="sidebar-btn-util gh-btn" onclick="app.copyToClipboard(app.uiShareLink(['customTheme']))"><i class="fa-solid fa-share-nodes"></i> رابط مشاركة المظهر</button><button class="sidebar-btn-util gh-btn" onclick="app.setUIPrefs({customTheme:null}); app.applyTheme('dark')"><i class="fa-solid fa-rotate-left"></i> إعادة الضبط</button>`
        });
        if (this.getUIPrefs().customTheme) this.applyTheme('custom', true);
        this.renderThemeContrast();
    };

    P.captureShortcut = function () {
        const sel = document.getElementById('sc-cmd');
        const out = document.getElementById('sc-capture');
        if (!sel || !out) return;
        out.textContent = 'اضغط التركيبة الآن…';
        out.classList.add('capturing');
        const h = (e) => {
            const combo = this.eventCombo(e);
            if (!combo) return;
            e.preventDefault(); e.stopPropagation();
            window.removeEventListener('keydown', h, true);
            out.classList.remove('capturing');
            if (combo === 'Escape') { out.textContent = 'أُلغي'; return; }
            if (!this.isValidShortcut(combo)) { out.textContent = `${combo} — يجب أن يحتوي Ctrl أو Alt (أو F2-F12)`; return; }
            const conflict = this.shortcutConflict(combo);
            this.setShortcut(combo, sel.value);
            this.showToast(`⌨️ ${combo} → ${this.escapeHTML(sel.value)}${conflict ? ` (يتجاوز: ${conflict})` : ''}`, conflict ? 'warning' : 'success');
            this.openUISettings('shortcuts');
        };
        window.addEventListener('keydown', h, true);
    };

    P.renderTrash = function () {
        const root = document.getElementById('trash-list');
        if (!root) return;
        const list = this._trash || [];
        root.innerHTML = list.length ? list.map(e => {
            const left = Math.max(0, Math.ceil((e.deletedAt + TRASH_DAYS * DAY - Date.now()) / DAY));
            const id = this.escapeHTML(e.session.id);
            return `<div class="share-rec"><i class="fa-regular fa-message"></i><div class="share-rec-main"><span>${this.escapeHTML(e.session.title || 'محادثة')}</span><small>${(e.session.messages || []).length} رسالة • حُذفت ${this.relTime ? this.relTime(e.deletedAt) : ''} • تُحذف نهائياً بعد ${left} يوم</small></div>
                <button class="fx-link" onclick="app.restoreFromTrash('${id}')"><i class="fa-solid fa-rotate-left"></i> استعادة</button><button class="fx-link danger" onclick="app.deleteForever('${id}')" aria-label="حذف نهائي"><i class="fa-solid fa-xmark"></i></button></div>`;
        }).join('') : '<div class="notif-empty"><i class="fa-solid fa-trash-can"></i><span>سلة المهملات فارغة</span></div>';
    };

    P.openTrash = async function () {
        await this.loadTrash();
        this.openPanel({ title: 'سلة المهملات', icon: 'fa-trash-arrow-up', body: `<p class="gh-muted">تبقى المحادثات المحذوفة ${TRASH_DAYS} يوماً قبل حذفها نهائياً.</p><div id="trash-list"></div>`, footer: `<button class="sidebar-btn-util gh-btn danger" onclick="app.askConfirm('إفراغ سلة المهملات نهائياً؟').then(ok => ok && app.emptyTrash())"><i class="fa-solid fa-dumpster"></i> إفراغ السلة</button>` });
        this.renderTrash();
    };

    P.renderFavorites = function () {
        const root = document.getElementById('fav-list');
        if (!root) return;
        const q = (document.getElementById('fav-q') || {}).value || '';
        const list = this.favoriteMessages().filter(f => !q || plainSearch(f.msg.content).toLowerCase().includes(q.toLowerCase()));
        root.innerHTML = list.length ? list.map(({ session, msg }) => {
            const sid = this.escapeHTML(session.id), mid = this.escapeHTML(msg.id);
            return `<div class="fav-item"><div class="fav-head"><i class="fa-solid ${msg.role === 'user' ? 'fa-user' : 'fa-robot'}"></i><b>${this.escapeHTML(session.title || 'محادثة')}</b><small>${msg.timestamp ? new Date(msg.timestamp).toLocaleString('ar') : ''}</small></div>
                <p>${this.escapeHTML(plainSearch(msg.content).slice(0, 260))}</p>
                <div class="gh-toolbar"><button class="fx-link" onclick="app.closeModals(); app.goToMessage('${sid}', '${mid}')"><i class="fa-solid fa-arrow-up-right-from-square"></i> انتقال</button><button class="fx-link" onclick="app.copyToClipboard(app.findMessage('${mid}', '${sid}').msg.content)"><i class="fa-solid fa-copy"></i> نسخ</button><button class="fx-link" onclick="app.toggleFavoriteMessage('${mid}', '${sid}')"><i class="fa-solid fa-star-half-stroke"></i> إزالة</button></div></div>`;
        }).join('') : '<div class="notif-empty"><i class="fa-regular fa-star"></i><span>لا توجد رسائل مفضلة — انقر بالزر الأيمن على رسالة ثم «مفضلة»</span></div>';
    };

    P.openFavorites = function () {
        this.openPanel({ title: 'الرسائل المفضلة', icon: 'fa-star', body: `<input id="fav-q" class="form-input-box" placeholder="بحث في المفضلة..." oninput="app.renderFavorites()" style="width:100%; margin-bottom:10px"><div id="fav-list"></div>` });
        this.renderFavorites();
    };

    // ------------------------------------------------------------------ GLOBAL SEARCH (#304)
    P.globalSearch = function (q, limit = 8) {
        q = String(q || '').trim().toLowerCase();
        const out = [];
        if (!q) return out;
        const snip = (text, i) => { const s = Math.max(0, i - 40); return (s ? '…' : '') + text.slice(s, i + q.length + 60).replace(/\s+/g, ' ') + '…'; };
        const sessions = (this.sessions || []);
        sessions.filter(s => (s.title || '').toLowerCase().includes(q) || (s.tags || []).some(t => t.toLowerCase().includes(q))).slice(0, limit)
            .forEach(s => out.push({ group: 'المحادثات', icon: s.pinned ? 'fa-thumbtack' : 'fa-message', label: s.title || 'محادثة', sub: `${(s.messages || []).length} رسالة${(s.tags || []).length ? ' • #' + s.tags.join(' #') : ''}`, run: () => this.switchSession(s.id) }));
        let n = 0;
        for (const s of sessions) {
            for (const m of (s.messages || [])) {
                const text = plainSearch(m.content);
                const i = text.toLowerCase().indexOf(q);
                if (i >= 0) { out.push({ group: 'الرسائل', icon: m.role === 'user' ? 'fa-user' : 'fa-robot', label: snip(text, i), sub: s.title || 'محادثة', run: () => this.goToMessage(s.id, m.id) }); if (++n >= limit) break; }
            }
            if (n >= limit) break;
        }
        n = 0;
        if (this.virtualProjectFiles) {
            for (const [path, f] of this.virtualProjectFiles) {
                if (n >= limit) break;
                const content = typeof f.content === 'string' ? f.content : '';
                if (path.toLowerCase().includes(q)) { out.push({ group: 'الملفات', icon: 'fa-file-code', label: path, sub: 'اسم ملف', run: () => this.openFileFromSearch(path) }); n++; continue; }
                const i = content.toLowerCase().indexOf(q);
                if (i >= 0) { const line = content.slice(0, i).split('\n').length; out.push({ group: 'الملفات', icon: 'fa-file-lines', label: `${path}:${line}`, sub: snip(content, i), run: () => this.openFileFromSearch(path, line) }); n++; }
            }
        }
        try { this.buildPaletteCommands().filter(c => (c.label + ' ' + (c.hint || '')).toLowerCase().includes(q)).slice(0, limit).forEach(c => out.push({ group: 'الأوامر', icon: c.icon || 'fa-terminal', label: c.label, sub: c.section || '', kbd: c.kbd, run: c.run })); } catch (e) {}
        return out;
    };
    P.openFileFromSearch = function (path, line) {
        this.toggleCodeStudio(true);
        if (this.switchStudioFile) this.switchStudioFile(path); else { this.activeStudioFile = path; this.renderStudioWorkspace(); }
        if (line && this.goToLine) try { this.goToLine(line); } catch (e) {}
    };
    P.openGlobalSearch = function (initial = '') {
        let ov = document.getElementById('ox-gsearch');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'ox-gsearch'; ov.className = 'ox-gsearch';
            ov.innerHTML = `<div class="gs-card" role="dialog" aria-modal="true" aria-label="البحث الشامل"><div class="gs-input-row"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input id="gs-input" type="search" placeholder="ابحث في المحادثات والرسائل والملفات والأوامر…" autocomplete="off" aria-controls="gs-results"><kbd>Esc</kbd></div><div id="gs-results" class="gs-results" role="listbox"></div></div>`;
            ov.addEventListener('mousedown', (e) => { if (e.target === ov) this.closeGlobalSearch(); });
            document.body.appendChild(ov);
            const input = ov.querySelector('#gs-input');
            input.addEventListener('input', () => { this._gsSel = 0; this.renderGlobalSearch(input.value); });
            input.addEventListener('keydown', (e) => {
                const items = this._gsItems || [];
                if (e.key === 'ArrowDown') { e.preventDefault(); this._gsSel = Math.min(items.length - 1, (this._gsSel || 0) + 1); this.renderGlobalSearch(input.value, true); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); this._gsSel = Math.max(0, (this._gsSel || 0) - 1); this.renderGlobalSearch(input.value, true); }
                else if (e.key === 'Enter') { e.preventDefault(); this.runGlobalSearchItem(this._gsSel || 0); }
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeGlobalSearch(); }
            });
            ov.querySelector('#gs-results').addEventListener('click', (e) => {
                const b = e.target.closest('[data-gi]');
                if (b) return this.runGlobalSearchItem(+b.dataset.gi);
                const r = e.target.closest('[data-rq]');
                if (r) { input.value = r.dataset.rq; this.renderGlobalSearch(r.dataset.rq); input.focus(); }
            });
        }
        ov.classList.add('active');
        const input = ov.querySelector('#gs-input');
        input.value = initial;
        this._gsSel = 0;
        this.renderGlobalSearch(initial);
        setTimeout(() => input.focus(), 20);
        return true;
    };
    P.renderGlobalSearch = function (q, keepItems) {
        const root = document.getElementById('gs-results');
        if (!root) return;
        if (!keepItems) this._gsItems = this.globalSearch(q);
        const items = this._gsItems;
        if (!String(q || '').trim()) {
            const rec = this.getRecentSearches();
            root.innerHTML = rec.length ? `<div class="gs-group">عمليات البحث الأخيرة</div><div class="gs-recent">${rec.map(r => `<button class="sess-chip" data-rq="${this.escapeHTML(r)}">${this.escapeHTML(r)}</button>`).join('')}</div>` : '<div class="gs-empty">اكتب للبحث في كل شيء — المحادثات، الرسائل، ملفات المشروع، والأوامر.</div>';
            return;
        }
        if (!items.length) { root.innerHTML = `<div class="gs-empty">لا نتائج لـ «${this.escapeHTML(q)}»</div>`; return; }
        const ql = String(q).trim().toLowerCase();
        const hl = (s) => { const e = this.escapeHTML(s); const i = e.toLowerCase().indexOf(this.escapeHTML(ql)); return i < 0 ? e : e.slice(0, i) + '<mark>' + e.slice(i, i + this.escapeHTML(ql).length) + '</mark>' + e.slice(i + this.escapeHTML(ql).length); };
        let last = '', html = '';
        items.forEach((it, i) => {
            if (it.group !== last) { html += `<div class="gs-group">${it.group}</div>`; last = it.group; }
            html += `<button class="gs-item ${i === (this._gsSel || 0) ? 'active' : ''}" role="option" aria-selected="${i === (this._gsSel || 0)}" data-gi="${i}"><i class="fa-solid ${it.icon}" aria-hidden="true"></i><span class="gs-main"><span>${hl(it.label)}</span><small>${hl(it.sub || '')}</small></span>${it.kbd ? `<kbd>${this.escapeHTML(it.kbd)}</kbd>` : ''}</button>`;
        });
        root.innerHTML = html;
        const act = root.querySelector('.gs-item.active');
        if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest' });
    };
    P.runGlobalSearchItem = function (i) {
        const it = (this._gsItems || [])[i];
        if (!it) return false;
        const input = document.getElementById('gs-input');
        if (input && input.value.trim().length >= 2) this.addRecentSearch(input.value);
        this.closeGlobalSearch();
        try { it.run(); } catch (e) { console.warn(e); }
        return true;
    };
    P.closeGlobalSearch = function () { const ov = document.getElementById('ox-gsearch'); if (ov) ov.classList.remove('active'); return true; };


    // ------------------------------------------------------------------ CONVERSATION MANAGER (#305-#307, #349)
    P.openConversationManager = function () {
        if (!this._cm) this._cm = { view: lsGet('ox_alpha_cm_view', 'grid'), sel: new Set(), query: '', filter: 'all', sort: 'updated', tag: '' };
        const cm = this._cm;
        const tags = this.allTags();
        this.openPanel({
            title: 'مدير المحادثات', icon: 'fa-table-cells',
            actions: `<button class="fx-link ${cm.view === 'grid' ? 'active' : ''}" onclick="app.setCMView('grid')" aria-label="عرض شبكي"><i class="fa-solid fa-grip"></i></button><button class="fx-link ${cm.view === 'list' ? 'active' : ''}" onclick="app.setCMView('list')" aria-label="عرض قائمة"><i class="fa-solid fa-list"></i></button>`,
            body: `<div class="cm-toolbar">
                    <input class="form-input-box" placeholder="بحث في العناوين والمحتوى والوسوم…" value="${this.escapeHTML(cm.query)}" oninput="app._cm.query=this.value; app.renderConversationManager()" style="flex:2">
                    <select class="form-input-box" onchange="app._cm.filter=this.value; app.renderConversationManager()" aria-label="تصفية">${[['all', 'الكل'], ['pinned', 'المثبتة'], ['fav', 'بها مفضلة'], ['code', 'بها كود'], ['today', 'اليوم'], ['week', 'هذا الأسبوع'], ['muted', 'المكتومة'], ['archived', 'المؤرشفة']].map(([v, l]) => `<option value="${v}" ${cm.filter === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
                    <select class="form-input-box" onchange="app._cm.sort=this.value; app.renderConversationManager()" aria-label="ترتيب">${[['updated', 'الأحدث'], ['smart', 'ذكي ✨'], ['created', 'تاريخ الإنشاء'], ['title', 'الاسم'], ['messages', 'الأطول']].map(([v, l]) => `<option value="${v}" ${cm.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
                    ${tags.length ? `<select class="form-input-box" onchange="app._cm.tag=this.value; app.renderConversationManager()" aria-label="وسم"><option value="">كل الوسوم</option>${tags.map(([t]) => `<option value="${this.escapeHTML(t)}" ${cm.tag === t ? 'selected' : ''}>#${this.escapeHTML(t)}</option>`).join('')}</select>` : ''}
                </div>
                <div id="cm-bulk" class="cm-bulk"></div>
                <div id="cm-list"></div>`
        });
        this.renderConversationManager();
    };
    P.setCMView = function (v) { this._cm.view = v; lsSet('ox_alpha_cm_view', v); this.openConversationManager(); };
    P.cmItems = function () { const cm = this._cm; return this.filteredSessions({ filter: cm.filter, sort: cm.sort, tag: cm.tag, query: cm.query }); };
    P.renderConversationManager = function () {
        const root = document.getElementById('cm-list');
        if (!root || !this._cm) return;
        const cm = this._cm, esc = (x) => this.escapeHTML(x);
        const items = this.cmItems();
        cm.sel.forEach(id => { if (!this.findSession(id)) cm.sel.delete(id); });
        root.className = cm.view === 'grid' ? 'cm-grid' : 'cm-listview';
        root.innerHTML = items.length ? items.map(s => {
            const id = esc(s.id), msgs = s.messages || [];
            const first = msgs.find(m => m.role === 'user');
            return `<div class="cm-card ${cm.sel.has(s.id) ? 'selected' : ''} ${s.id === this.activeSessionId ? 'current' : ''}">
                <label class="cm-check"><input type="checkbox" ${cm.sel.has(s.id) ? 'checked' : ''} onchange="app.cmToggleSelect('${id}', this.checked)" aria-label="تحديد"></label>
                <div class="cm-body" role="button" tabindex="0" onclick="app.closeModals(); app.switchSession('${id}')">
                    <div class="cm-title">${s.pinned ? '<i class="fa-solid fa-thumbtack"></i> ' : ''}${s.archived ? '<i class="fa-solid fa-box-archive"></i> ' : ''}${esc(s.title || 'محادثة')}${s.muted ? ' <i class="fa-solid fa-bell-slash"></i>' : ''}</div>
                    <div class="cm-snippet">${esc(first ? plainSearch(first.content).slice(0, 120) : 'فارغة')}</div>
                    <div class="cm-meta"><span>${msgs.length} رسالة</span><span>${this.relTime ? this.relTime(this.sessionTime(s)) : ''}</span>${s.folder ? `<span><i class="fa-solid fa-folder"></i> ${esc(s.folder)}</span>` : ''}${(s.tags || []).map(t => `<span class="sess-tag" style="--tag-h:${hue(t)}">#${esc(t)}</span>`).join('')}</div>
                </div>
                <button class="fx-link cm-more" onclick="app.openSessionMenu('${id}', this)" aria-label="خيارات"><i class="fa-solid fa-ellipsis-vertical"></i></button></div>`;
        }).join('') : '<div class="notif-empty"><i class="fa-regular fa-folder-open"></i><span>لا توجد محادثات مطابقة</span></div>';
        this.renderCMBulk(items);
    };
    P.cmToggleSelect = function (id, on) { if (on) this._cm.sel.add(id); else this._cm.sel.delete(id); this.renderConversationManager(); return this._cm.sel.size; };
    P.cmSelectAll = function (on) { const items = this.cmItems(); this._cm.sel = new Set(on ? items.map(s => s.id) : []); this.renderConversationManager(); return this._cm.sel.size; };
    P.renderCMBulk = function (items) {
        const bar = document.getElementById('cm-bulk');
        if (!bar) return;
        const n = this._cm.sel.size;
        bar.innerHTML = `<label class="cm-check"><input type="checkbox" ${n && n === items.length ? 'checked' : ''} onchange="app.cmSelectAll(this.checked)" aria-label="تحديد الكل"> ${n ? `${n} محددة` : `${items.length} محادثة`}</label>
            ${n ? `<span class="gh-spacer"></span><button class="fx-link" onclick="app.cmBulk('pin')"><i class="fa-solid fa-thumbtack"></i> تثبيت</button><button class="fx-link" onclick="app.cmBulk('archive')"><i class="fa-solid fa-box-archive"></i> أرشفة</button><button class="fx-link" onclick="app.cmBulk('unarchive')"><i class="fa-solid fa-box-open"></i> إلغاء الأرشفة</button><button class="fx-link" onclick="app.cmBulk('tag')"><i class="fa-solid fa-tags"></i> وسم</button><button class="fx-link" onclick="app.cmBulk('folder')"><i class="fa-solid fa-folder"></i> مجلد</button><button class="fx-link" onclick="app.cmBulk('export')"><i class="fa-solid fa-file-export"></i> تصدير</button>${n === 2 ? `<button class="fx-link" onclick="app.cmBulk('compare')"><i class="fa-solid fa-code-compare"></i> مقارنة</button>` : ''}<button class="fx-link danger" onclick="app.cmBulk('delete')"><i class="fa-solid fa-trash-can"></i> حذف</button>` : ''}`;
    };
    P.cmBulk = async function (action, arg) {
        const ids = Array.from(this._cm.sel);
        if (!ids.length) return 0;
        const each = (patch) => { ids.forEach(id => { const s = this.findSession(id); if (s) Object.assign(s, typeof patch === 'function' ? patch(s) : patch); }); this.saveSessions(); };
        if (action === 'pin') each({ pinned: true });
        else if (action === 'archive') each({ archived: true, pinned: false });
        else if (action === 'unarchive') each({ archived: false });
        else if (action === 'tag') {
            const v = arg != null ? arg : await this.askText('🏷️ وسوم تُضاف للمحادثات المحددة', '', { dir: 'auto' });
            if (!v) return 0;
            const add = this.parseTags(v);
            each(s => ({ tags: this.parseTags([...(s.tags || []), ...add].join(',')) }));
        } else if (action === 'folder') {
            const v = arg != null ? arg : await this.askText('📁 اسم المجلد (فارغ للإزالة)', '', { dir: 'auto' });
            if (v == null) return 0;
            ids.forEach(id => this.setSessionFolder(id, v));
        } else if (action === 'export') { this.exportSessionsJSON(ids); return ids.length; }
        else if (action === 'compare') { this.closeModals(); this.openCompareSessions(ids[0], ids[1]); return 2; }
        else if (action === 'delete') {
            const ok = arg === true || await this.askConfirm(`نقل ${ids.length} محادثة إلى سلة المهملات؟`, 'يمكنك استعادتها خلال 30 يوماً.');
            if (!ok) return 0;
            this.bulkDeleteSessions(ids);
            this._cm.sel.clear();
        }
        this.renderSessionList();
        if (document.getElementById('cm-list')) this.renderConversationManager();
        return ids.length;
    };


    // ------------------------------------------------------------------ SPLIT COMPARE (#351)
    P.openCompareSessions = function (a, b) {
        const list = (this.sessions || []).filter(s => (s.messages || []).length);
        a = a || this.activeSessionId;
        b = b || (list.find(s => s.id !== a) || {}).id;
        this._cmp = { a, b, sync: this._cmp ? this._cmp.sync : true };
        const opt = (sel) => list.map(s => `<option value="${this.escapeHTML(s.id)}" ${s.id === sel ? 'selected' : ''}>${this.escapeHTML(s.title || 'محادثة')}</option>`).join('');
        this.openPanel({
            title: 'مقارنة محادثتين', icon: 'fa-code-compare',
            body: `<div class="cmp-head"><select class="form-input-box" onchange="app.openCompareSessions(this.value, app._cmp.b)" aria-label="المحادثة الأولى">${opt(a)}</select><label class="cm-check"><input type="checkbox" ${this._cmp.sync ? 'checked' : ''} onchange="app._cmp.sync=this.checked"> تمرير متزامن</label><select class="form-input-box" onchange="app.openCompareSessions(app._cmp.a, this.value)" aria-label="المحادثة الثانية">${opt(b)}</select></div>
                <div class="cmp-grid"><div class="cmp-col" id="cmp-a">${this.compareColumnHTML(a)}</div><div class="cmp-col" id="cmp-b">${this.compareColumnHTML(b)}</div></div>`
        });
        const ca = document.getElementById('cmp-a'), cb = document.getElementById('cmp-b');
        if (ca && cb) {
            let lock = false;
            const sync = (src, dst) => () => { if (!this._cmp.sync || lock) return; lock = true; const r = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight); dst.scrollTop = r * (dst.scrollHeight - dst.clientHeight); requestAnimationFrame(() => { lock = false; }); };
            ca.addEventListener('scroll', sync(ca, cb)); cb.addEventListener('scroll', sync(cb, ca));
        }
        return !!(a && b);
    };
    P.compareColumnHTML = function (id) {
        const s = this.findSession(id);
        if (!s) return '<div class="notif-empty">اختر محادثة</div>';
        const md = (t) => this.renderMarkdownSafe ? this.renderMarkdownSafe(String(t).slice(0, 4000)) : this.escapeHTML(String(t).slice(0, 4000));
        const msgs = s.messages || [];
        return `<div class="cmp-title"><b>${this.escapeHTML(s.title || 'محادثة')}</b><small>${msgs.length} رسالة • ${msgs.reduce((n, m) => n + (m.content || '').length, 0).toLocaleString('ar')} حرف</small></div>` +
            msgs.map(m => `<div class="cmp-msg ${m.role === 'user' ? 'usr' : 'bot'}"><div class="cmp-role">${m.role === 'user' ? '👤 أنت' : `🤖 ${this.escapeHTML(m.model || 'AI')}`}</div><div class="markdown-body">${md(m.content || '')}</div></div>`).join('');
    };


    // ------------------------------------------------------------------ DEV TOOLS (#371-#380)
    P.devMetrics = function () {
        const perf = window.performance || {};
        const nav = perf.getEntriesByType ? perf.getEntriesByType('navigation')[0] : null;
        const t = perf.timing;
        const load = nav && nav.loadEventEnd ? Math.round(nav.loadEventEnd) : t && t.loadEventEnd && t.navigationStart ? t.loadEventEnd - t.navigationStart : null;
        const res = perf.getEntriesByType ? perf.getEntriesByType('resource') : [];
        const mem = perf.memory ? Math.round(perf.memory.usedJSHeapSize / 1048576) : null;
        return {
            fps: this._devFps || 0, memoryMB: mem, dom: document.getElementsByTagName('*').length, loadMs: load,
            resources: res.length, transferKB: Math.round(res.reduce((n, r) => n + (r.transferSize || 0), 0) / 1024),
            errors: this.getErrorLog ? this.getErrorLog().length : 0, longTasks: this._longTasks || 0,
            inflight: this._progCount || 0, net: this._netSim || 'off', sessions: (this.sessions || []).length,
            storageKB: (() => { let n = 0; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += (k.length + (localStorage.getItem(k) || '').length) * 2; } } catch (e) {} return Math.round(n / 1024); })()
        };
    };
    P.toggleDevHUD = function (force) {
        const on = force !== undefined ? !!force : !document.getElementById('ox-devhud');
        const old = document.getElementById('ox-devhud');
        if (!on) { if (old) old.remove(); cancelAnimationFrame(this._fpsRaf); clearInterval(this._devTimer); this._devHud = false; return false; }
        if (old) return true;
        this._devHud = true;
        const hud = document.createElement('div');
        hud.id = 'ox-devhud'; hud.className = 'ox-devhud'; hud.setAttribute('role', 'region'); hud.setAttribute('aria-label', 'أدوات المطور');
        hud.innerHTML = `<div class="dh-head"><b><i class="fa-solid fa-gauge-high"></i> DevTools</b><span class="gh-spacer"></span><button data-dh="close" aria-label="إغلاق">×</button></div><div class="dh-grid" id="dh-grid"></div>
            <div class="dh-actions"><button data-dh="inspect"><i class="fa-solid fa-crosshairs"></i> فحص</button><button data-dh="device"><i class="fa-solid fa-mobile-screen"></i> أجهزة</button><button data-dh="errors"><i class="fa-solid fa-bug"></i> الأخطاء</button>
            <select data-dh="net" aria-label="محاكاة الشبكة"><option value="off">شبكة عادية</option><option value="3g">3G (‎+700ms)</option><option value="slow">بطيئة (‎+2s)</option><option value="offline">بدون اتصال</option></select></div>`;
        hud.addEventListener('click', (e) => {
            const b = e.target.closest('button[data-dh]');
            if (!b) return;
            const a = b.dataset.dh;
            if (a === 'close') this.toggleDevHUD(false);
            else if (a === 'inspect') this.startInspect();
            else if (a === 'device') this.openDeviceEmulator();
            else if (a === 'errors') { if (this.openPlatform) this.openPlatform('health'); else if (this.renderPlatform) this.renderPlatform('health'); }
        });
        hud.querySelector('select[data-dh="net"]').value = this._netSim || 'off';
        hud.querySelector('select[data-dh="net"]').addEventListener('change', (e) => this.setNetworkSim(e.target.value));
        document.body.appendChild(hud);
        let frames = 0, last = performance.now();
        const loop = (ts) => { frames++; if (ts - last >= 1000) { this._devFps = Math.round(frames * 1000 / (ts - last)); frames = 0; last = ts; } this._fpsRaf = requestAnimationFrame(loop); };
        this._fpsRaf = requestAnimationFrame(loop);
        if (!this._ltObserver && typeof PerformanceObserver !== 'undefined') {
            try { this._ltObserver = new PerformanceObserver((list) => { this._longTasks = (this._longTasks || 0) + list.getEntries().length; }); this._ltObserver.observe({ entryTypes: ['longtask'] }); } catch (e) { this._ltObserver = null; }
        }
        const render = () => {
            const m = this.devMetrics(), grid = document.getElementById('dh-grid');
            if (!grid) return;
            const cell = (k, v, warn) => `<div class="dh-cell ${warn ? 'warn' : ''}"><small>${k}</small><b>${v}</b></div>`;
            grid.innerHTML = cell('FPS', m.fps || '—', m.fps && m.fps < 30) + cell('الذاكرة', m.memoryMB != null ? m.memoryMB + 'MB' : 'غير متاح', m.memoryMB > 400) + cell('عناصر DOM', m.dom.toLocaleString('en'), m.dom > 6000)
                + cell('التحميل', m.loadMs != null ? m.loadMs + 'ms' : '—', m.loadMs > 4000) + cell('الموارد', `${m.resources} • ${m.transferKB}KB`) + cell('الأخطاء', m.errors, m.errors > 0)
                + cell('مهام طويلة', m.longTasks, m.longTasks > 5) + cell('طلبات جارية', m.inflight) + cell('التخزين', m.storageKB + 'KB', m.storageKB > 4000);
        };
        render();
        this._devTimer = setInterval(render, 1000);
        return true;
    };
    P.setNetworkSim = function (mode) {
        if (!['off', '3g', 'slow', 'offline'].includes(mode)) return false;
        this._netSim = mode === 'off' ? null : mode;
        if (this.updateOnlineState) this.updateOnlineState();
        this.showToast(mode === 'off' ? '🌐 أُوقفت محاكاة الشبكة' : `🧪 محاكاة الشبكة: ${{ '3g': '3G بطيئة', slow: 'بطيئة جداً', offline: 'بدون اتصال' }[mode]}`, mode === 'off' ? 'info' : 'warning');
        return this._netSim;
    };
    P.cssPath = function (el) {
        if (!el || el.nodeType !== 1) return '';
        const parts = [];
        while (el && el.nodeType === 1 && parts.length < 5) {
            if (el.id) { parts.unshift('#' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id)); break; }
            let sel = el.tagName.toLowerCase();
            const cls = Array.from(el.classList).filter(c => !/^(active|hover|focus|open|selected)$/.test(c)).slice(0, 2);
            if (cls.length) sel += '.' + cls.join('.');
            const parent = el.parentElement;
            if (parent) { const same = Array.from(parent.children).filter(c => c.tagName === el.tagName); if (same.length > 1) sel += `:nth-of-type(${same.indexOf(el) + 1})`; }
            parts.unshift(sel);
            el = parent;
        }
        return parts.join(' > ');
    };
    P.startInspect = function () {
        if (this._inspect) return false;
        const box = document.createElement('div'); box.className = 'ox-inspect-box'; box.id = 'ox-inspect-box';
        const label = document.createElement('div'); label.className = 'ox-inspect-label';
        box.appendChild(label);
        document.body.appendChild(box);
        const ours = (t) => t.closest && t.closest('#ox-inspect-box, #ox-devhud');
        const move = (e) => {
            const t = e.target;
            if (!t || ours(t)) return;
            const r = t.getBoundingClientRect();
            Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
            label.textContent = `${this.cssPath(t)}  ${Math.round(r.width)}×${Math.round(r.height)}`;
        };
        const click = (e) => {
            if (ours(e.target)) return;
            e.preventDefault(); e.stopPropagation();
            const path = this.cssPath(e.target);
            this.stopInspect();
            this.copyToClipboard(path);
            console.log('[OX inspect]', path, e.target);
            this.showToast(`🎯 <code>${this.escapeHTML(path)}</code>`, 'success');
        };
        const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); this.stopInspect(); } };
        document.addEventListener('mousemove', move, true);
        document.addEventListener('click', click, true);
        document.addEventListener('keydown', key, true);
        this._inspect = { move, click, key };
        document.body.classList.add('inspecting');
        this.showToast('🔍 وضع الفحص: مرّر فوق أي عنصر، انقر لنسخ المحدد، Esc للخروج', 'info');
        return true;
    };
    P.stopInspect = function () {
        const i = this._inspect;
        if (!i) return false;
        document.removeEventListener('mousemove', i.move, true);
        document.removeEventListener('click', i.click, true);
        document.removeEventListener('keydown', i.key, true);
        const box = document.getElementById('ox-inspect-box');
        if (box) box.remove();
        document.body.classList.remove('inspecting');
        this._inspect = null;
        return true;
    };
    P.DEVICES = [['iphone-se', 'iPhone SE', 375, 667], ['iphone-15', 'iPhone 15', 393, 852], ['pixel-8', 'Pixel 8', 412, 915], ['galaxy-fold', 'Galaxy Fold', 344, 882], ['ipad', 'iPad', 820, 1180], ['laptop', 'Laptop', 1366, 768], ['desktop', 'Desktop', 1920, 1080]];
    P.deviceFrameSize = function (id, landscape, availW = 900, availH = 640) {
        const d = this.DEVICES.find(x => x[0] === id) || this.DEVICES[0];
        let w = d[2], h = d[3];
        if (landscape) [w, h] = [h, w];
        const scale = Math.min(1, availW / w, availH / h);
        return { w, h, scale: +scale.toFixed(3), label: d[1] };
    };
    P.openDeviceEmulator = async function (path) {
        const files = this.virtualProjectFiles ? Array.from(this.virtualProjectFiles.keys()).filter(p => /\.html?$/i.test(p)) : [];
        path = path || (this.activeStudioFile && /\.html?$/i.test(this.activeStudioFile) ? this.activeStudioFile : files[0]);
        if (!path) { this.showToast('لا يوجد ملف HTML في المشروع للمعاينة', 'warning'); return false; }
        this._emu = { path, device: (this._emu && this._emu.device) || 'iphone-15', landscape: !!(this._emu && this._emu.landscape) };
        let doc = '';
        try { doc = await this.studio('buildPreviewDoc', path, { bridge: false }); } catch (e) { doc = ''; }
        if (!doc) { const f = this.virtualProjectFiles.get(path); doc = f && typeof f.content === 'string' ? f.content : ''; }
        this._emuDoc = doc;
        this.openPanel({
            title: 'محاكي الأجهزة', icon: 'fa-mobile-screen',
            body: `<div class="emu-toolbar"><select class="form-input-box" onchange="app._emu.path=this.value; app.openDeviceEmulator(this.value)" aria-label="الملف">${files.map(f => `<option ${f === path ? 'selected' : ''}>${this.escapeHTML(f)}</option>`).join('')}</select>
                <select class="form-input-box" onchange="app._emu.device=this.value; app.renderDeviceFrame()" aria-label="الجهاز">${this.DEVICES.map(d => `<option value="${d[0]}" ${d[0] === this._emu.device ? 'selected' : ''}>${d[1]} (${d[2]}×${d[3]})</option>`).join('')}</select>
                <button class="sidebar-btn-util gh-btn" onclick="app._emu.landscape=!app._emu.landscape; app.renderDeviceFrame()"><i class="fa-solid fa-rotate"></i> تدوير</button><button class="sidebar-btn-util gh-btn" onclick="app.openDeviceEmulator(app._emu.path)"><i class="fa-solid fa-arrows-rotate"></i> إعادة تحميل</button><span id="emu-info" class="gh-muted"></span></div>
                <div class="emu-stage" id="emu-stage"></div>`
        });
        this.renderDeviceFrame();
        return true;
    };
    P.renderDeviceFrame = function () {
        const stage = document.getElementById('emu-stage');
        if (!stage || !this._emu) return;
        const avail = stage.getBoundingClientRect();
        const s = this.deviceFrameSize(this._emu.device, this._emu.landscape, (avail.width || 900) - 40, Math.max(420, (window.innerHeight || 800) - 260));
        stage.innerHTML = `<div class="emu-device" style="width:${s.w * s.scale + 24}px;height:${s.h * s.scale + 24}px"><iframe sandbox="allow-scripts allow-modals allow-forms" title="معاينة ${this.escapeHTML(s.label)}" style="width:${s.w}px;height:${s.h}px;transform:scale(${s.scale})"></iframe></div>`;
        stage.querySelector('iframe').srcdoc = this._emuDoc || '<p style="font-family:sans-serif;padding:20px">لا يوجد محتوى</p>';
        const info = document.getElementById('emu-info');
        if (info) info.textContent = `${s.label} • ${s.w}×${s.h} • ${Math.round(s.scale * 100)}%`;
    };


    // ------------------------------------------------------------------ EXPORT AS IMAGE + SHARE (#385 #388)
    /** Pure layout: wraps messages into draw lines with a pluggable text measurer. */
    P.layoutConversation = function (messages, { width = 880, pad = 28, font = 16, measure = (s) => s.length * font * 0.55 } = {}) {
        const inner = width - pad * 2 - 32;
        const lines = [];
        let y = pad + 70;
        const wrap = (text, mono) => {
            const out = [];
            String(text).split('\n').forEach(par => {
                if (!par) { out.push(''); return; }
                let cur = '';
                (mono ? par.match(/.{1,1}/g) || [] : par.split(/(\s+)/)).forEach(tok => {
                    if (measure(cur + tok, mono) > inner && cur) { out.push(cur); cur = tok.trimStart(); }
                    else cur += tok;
                });
                if (cur) out.push(cur);
            });
            return out;
        };
        messages.forEach(m => {
            const role = m.role === 'user' ? 'user' : 'bot';
            const startY = y;
            y += 30;
            const parts = String(m.content || '').slice(0, 6000).split(/```[\w-]*\n?/);
            parts.forEach((part, i) => {
                const mono = i % 2 === 1;
                const txt = mono ? part.replace(/\n$/, '') : part.replace(/[*_#>`]+/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();
                if (!txt) return;
                wrap(txt, mono).slice(0, 200).forEach(l => { lines.push({ kind: mono ? 'code' : 'text', role, text: l, y }); y += mono ? font * 1.35 : font * 1.6; });
                y += 6;
            });
            lines.push({ kind: 'bubble', role, y: startY, h: y - startY + 8, label: role === 'user' ? 'أنت' : (m.model || 'OX-Alpha') });
            y += 22;
        });
        return { width, height: Math.ceil(y + pad + 24), lines, pad };
    };
    P.renderConversationCanvas = function (messages, opts = {}) {
        const canvas = document.createElement('canvas');
        const ctx0 = canvas.getContext && canvas.getContext('2d');
        if (!ctx0) return null;
        const font = 16;
        const measure = (s, mono) => { ctx0.font = mono ? `${font - 2}px monospace` : `${font}px Cairo, system-ui, sans-serif`; return ctx0.measureText(s).width; };
        const L = this.layoutConversation(messages, { width: opts.width || 880, font, measure });
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = L.width * ratio; canvas.height = Math.min(16000, L.height) * ratio;
        const ctx = canvas.getContext('2d');
        ctx.scale(ratio, ratio);
        const css = getComputedStyle(document.documentElement);
        const v = (n, d) => (css.getPropertyValue(n) || '').trim() || d;
        const bg = v('--bg-base', '#131314'), card = v('--bg-card', '#282a2c'), text = v('--text-main', '#e3e3e3'), accent = v('--primary', '#8ab4f8');
        const g = ctx.createLinearGradient(0, 0, L.width, L.height);
        g.addColorStop(0, bg); g.addColorStop(1, card);
        ctx.fillStyle = g; ctx.fillRect(0, 0, L.width, L.height);
        ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        const brand = (this.getUIPrefs && this.getUIPrefs().brand.name) || 'OX-Alpha Workbench Pro';
        ctx.fillStyle = accent; ctx.font = `700 22px Cairo, system-ui, sans-serif`;
        ctx.fillText(`✦ ${brand}`, L.width - L.pad, L.pad);
        ctx.fillStyle = text; ctx.globalAlpha = 0.6; ctx.font = `13px Cairo, system-ui, sans-serif`;
        ctx.fillText(opts.title || new Date().toLocaleString('ar'), L.width - L.pad, L.pad + 32);
        ctx.globalAlpha = 1;
        L.lines.filter(l => l.kind === 'bubble').forEach(b => {
            ctx.fillStyle = b.role === 'user' ? 'rgba(138,180,248,0.16)' : 'rgba(255,255,255,0.06)';
            const x = L.pad, w = L.width - L.pad * 2, r = 14;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x, b.y, w, b.h, r); else ctx.rect(x, b.y, w, b.h);
            ctx.fill();
            ctx.fillStyle = accent; ctx.font = `700 13px Cairo, system-ui, sans-serif`;
            ctx.fillText(b.role === 'user' ? '👤 أنت' : `🤖 ${b.label}`, L.width - L.pad - 16, b.y + 8);
        });
        L.lines.filter(l => l.kind !== 'bubble').forEach(l => {
            if (l.kind === 'code') { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(L.pad + 12, l.y - 2, L.width - L.pad * 2 - 24, font * 1.35); ctx.fillStyle = '#a5f3fc'; ctx.font = `${font - 2}px monospace`; ctx.direction = 'ltr'; ctx.textAlign = 'left'; ctx.fillText(l.text, L.pad + 18, l.y); ctx.direction = 'rtl'; ctx.textAlign = 'right'; }
            else { ctx.fillStyle = text; ctx.font = `${font}px Cairo, system-ui, sans-serif`; ctx.fillText(l.text, L.width - L.pad - 16, l.y); }
        });
        return canvas;
    };
    P.exportMessagesImage = async function (sessionId, ids) {
        const s = this.findSession ? this.findSession(sessionId || this.activeSessionId) : null;
        if (!s || !(s.messages || []).length) { this.showToast('لا توجد رسائل للتصدير', 'warning'); return null; }
        let msgs = ids && ids.length ? s.messages.filter(m => ids.includes(m.id)) : s.messages.slice(-12);
        if (ids && ids.length === 1) { const i = s.messages.findIndex(m => m.id === ids[0]); if (i > 0 && s.messages[i].role === 'assistant' && s.messages[i - 1].role === 'user') msgs = [s.messages[i - 1], s.messages[i]]; }
        const canvas = this.renderConversationCanvas(msgs, { title: s.title });
        if (!canvas) { this.showToast('المتصفح لا يدعم الرسم على Canvas', 'error'); return null; }
        const blob = await new Promise(res => canvas.toBlob ? canvas.toBlob(res, 'image/png') : res(null));
        if (!blob) { this.showToast('تعذّر إنشاء الصورة', 'error'); return null; }
        const name = `ox-chat-${(s.title || 'chat').replace(/[^\w\u0600-\u06FF-]+/g, '_').slice(0, 30)}.png`;
        try {
            const file = new File([blob], name, { type: 'image/png' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: s.title || 'OX-Alpha' }); return blob; }
        } catch (e) { if (e && e.name === 'AbortError') return blob; }
        this.downloadBlob(blob, name);
        this.showToast('🖼️ تم حفظ الصورة', 'success');
        return blob;
    };


    // ------------------------------------------------------------------ PICTURE-IN-PICTURE MINI CHAT (#390)
    P.miniChatHTML = function () {
        const s = this.findSession ? this.findSession(this.activeSessionId) : null;
        const last = s ? (s.messages || []).slice().reverse().find(m => m.role === 'assistant') : null;
        const streaming = s && this.activeStreams && this.activeStreams.has(s.id);
        const body = last ? (this.renderMarkdownSafe ? this.renderMarkdownSafe(String(last.content || '').slice(-6000)) : this.escapeHTML(last.content)) : '<p class="gh-muted">لا توجد ردود بعد.</p>';
        return `<div class="mini-head"><b>✦ ${this.escapeHTML(s ? s.title || 'محادثة' : 'OX-Alpha')}</b>${streaming ? '<span class="session-streaming-pulse"></span>' : ''}</div><div class="mini-body markdown-body" dir="auto">${body}</div>`;
    };
    P.renderMiniChat = function () {
        const targets = [];
        if (this._pipWin && !this._pipWin.closed) targets.push(this._pipWin.document);
        if (document.getElementById('ox-mini-chat')) targets.push(document);
        targets.forEach(doc => { const c = doc.getElementById('mini-content'); if (c) { c.innerHTML = this.miniChatHTML(); const b = c.querySelector('.mini-body'); if (b) b.scrollTop = b.scrollHeight; } });
        return targets.length;
    };
    P.miniChatShell = function () {
        return `<div id="mini-content" class="mini-content"></div><form class="mini-form" id="mini-form"><input id="mini-input" placeholder="اكتب رسالة…" autocomplete="off" aria-label="رسالة"><button type="submit" aria-label="إرسال"><i class="fa-solid fa-arrow-up"></i></button></form>`;
    };
    P.bindMiniChat = function (doc) {
        const form = doc.getElementById('mini-form');
        if (!form) return;
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const input = doc.getElementById('mini-input');
            const v = input.value.trim();
            if (!v) return;
            input.value = '';
            this.sendQuickPrompt(v);
        });
        this.renderMiniChat();
    };
    P.openMiniChat = async function () {
        if (window.documentPictureInPicture && window.documentPictureInPicture.requestWindow) {
            try {
                const pip = await window.documentPictureInPicture.requestWindow({ width: 380, height: 540 });
                this._pipWin = pip;
                document.querySelectorAll('style, link[rel="stylesheet"]').forEach(n => pip.document.head.appendChild(n.cloneNode(true)));
                pip.document.documentElement.setAttribute('dir', 'rtl');
                ['data-theme', 'data-theme-preset'].forEach(a => { const v = document.documentElement.getAttribute(a); if (v) pip.document.documentElement.setAttribute(a, v); });
                pip.document.documentElement.style.cssText = document.documentElement.style.cssText;
                pip.document.body.className = 'pip-body';
                pip.document.body.innerHTML = `<div class="ox-mini-chat pip">${this.miniChatShell()}</div>`;
                this.bindMiniChat(pip.document);
                pip.addEventListener('pagehide', () => { this._pipWin = null; });
                return 'pip';
            } catch (e) { console.warn('PiP failed, using floating window', e); }
        }
        let w = document.getElementById('ox-mini-chat');
        if (w) { w.remove(); return 'closed'; }
        w = document.createElement('div');
        w.id = 'ox-mini-chat'; w.className = 'ox-mini-chat floating';
        w.setAttribute('role', 'dialog'); w.setAttribute('aria-label', 'نافذة المحادثة المصغرة');
        w.innerHTML = `<div class="mini-drag" title="اسحب للتحريك"><i class="fa-solid fa-grip"></i><span class="gh-spacer"></span><button class="mini-close" aria-label="إغلاق"><i class="fa-solid fa-xmark"></i></button></div>${this.miniChatShell()}`;
        document.body.appendChild(w);
        w.querySelector('.mini-close').onclick = () => w.remove();
        const drag = w.querySelector('.mini-drag');
        let st = null;
        drag.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; const r = w.getBoundingClientRect(); st = { dx: e.clientX - r.left, dy: e.clientY - r.top }; try { drag.setPointerCapture(e.pointerId); } catch (err) {} });
        drag.addEventListener('pointermove', (e) => { if (!st) return; w.style.left = clamp(e.clientX - st.dx, 0, (window.innerWidth || 1024) - 120) + 'px'; w.style.top = clamp(e.clientY - st.dy, 0, (window.innerHeight || 768) - 60) + 'px'; w.style.right = 'auto'; w.style.bottom = 'auto'; });
        drag.addEventListener('pointerup', () => { st = null; });
        this.bindMiniChat(document);
        return 'floating';
    };


    // ------------------------------------------------------------------ VOICE: audio mode (#408) + driving mode (#359)
    P.speakableText = function (md) { return plain(String(md || '').replace(/```[\s\S]*?```/g, ' . تم إرسال كتلة كود . ')).slice(0, 1800); };
    P.setVoiceConversation = function (mode) {
        if (!mode) {
            this._voice = null;
            const ov = document.getElementById('ox-drive');
            if (ov) ov.remove();
            document.body.classList.remove('driving-mode');
            try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
            if (this.isRecording && this.toggleRecording) this.toggleRecording();
            this.showToast('تم إيقاف وضع المحادثة الصوتية', 'info');
            return null;
        }
        this._voice = { mode };
        if (mode === 'driving') this.renderDrivingMode();
        else this.showToast('🎧 الوضع الصوتي: ستُقرأ الردود تلقائياً — استخدم زر الميكروفون للتحدث', 'success');
        return mode;
    };
    P.renderDrivingMode = function () {
        let ov = document.getElementById('ox-drive');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'ox-drive'; ov.className = 'ox-drive';
            ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'وضع القيادة');
            ov.innerHTML = `<div class="drive-top"><b><i class="fa-solid fa-car"></i> وضع القيادة</b><button class="drive-exit" aria-label="خروج">خروج ✕</button></div>
                <div class="drive-status" id="drive-status" aria-live="assertive">اضغط الزر الكبير وتحدّث</div>
                <button class="drive-mic" id="drive-mic" aria-label="تحدث"><i class="fa-solid fa-microphone"></i></button>
                <div class="drive-reply" id="drive-reply" dir="auto"></div>
                <div class="drive-actions"><button data-dv="repeat"><i class="fa-solid fa-rotate-left"></i> أعد القراءة</button><button data-dv="stop"><i class="fa-solid fa-volume-xmark"></i> إسكات</button><button data-dv="new"><i class="fa-solid fa-plus"></i> محادثة جديدة</button></div>`;
            ov.querySelector('.drive-exit').onclick = () => this.setVoiceConversation(null);
            ov.querySelector('#drive-mic').onclick = () => this.drivingMicPress();
            ov.addEventListener('click', (e) => {
                const b = e.target.closest('[data-dv]');
                if (!b) return;
                if (b.dataset.dv === 'repeat') this.speakLastReply(true);
                else if (b.dataset.dv === 'stop') { try { window.speechSynthesis.cancel(); } catch (err) {} }
                else if (b.dataset.dv === 'new') this.createNewSession(true);
            });
            document.body.appendChild(ov);
            document.body.classList.add('driving-mode');
        }
        const s = this.findSession ? this.findSession(this.activeSessionId) : null;
        const last = s ? (s.messages || []).slice().reverse().find(m => m.role === 'assistant') : null;
        const r = document.getElementById('drive-reply');
        if (r) r.textContent = last ? this.speakableText(last.content).slice(0, 400) : '';
        const mic = document.getElementById('drive-mic');
        if (mic) mic.classList.toggle('recording', !!this.isRecording);
    };
    P.drivingMicPress = function () {
        const status = document.getElementById('drive-status');
        if (!this.speechRecognition) { if (status) status.textContent = 'التعرف على الصوت غير مدعوم في هذا المتصفح'; return false; }
        if (!this.isRecording) {
            try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
            const input = document.getElementById('user-input');
            if (input) input.value = '';
            this.toggleRecording();
            if (status) status.textContent = '🎙️ أستمع… اضغط مجدداً للإرسال';
        } else {
            this.toggleRecording();
            const input = document.getElementById('user-input');
            const text = input ? input.value.trim() : '';
            if (text) { if (status) status.textContent = '⏳ جارٍ التفكير…'; this.sendUserMessage(); }
            else if (status) status.textContent = 'لم أسمع شيئاً — حاول مجدداً';
        }
        if (this.haptic) this.haptic(20);
        this.renderDrivingMode();
        return true;
    };
    P.speakLastReply = function (force) {
        const s = this.findSession ? this.findSession(this.activeSessionId) : null;
        const last = s ? (s.messages || []).slice().reverse().find(m => m.role === 'assistant') : null;
        if (!last || !last.content || !('speechSynthesis' in window)) return false;
        try { window.speechSynthesis.cancel(); } catch (e) {}
        const u = new SpeechSynthesisUtterance(this.speakableText(last.content));
        u.lang = /[\u0600-\u06FF]/.test(last.content) ? 'ar-SA' : /[éèàçù]/i.test(last.content) ? 'fr-FR' : 'en-US';
        u.rate = this._voice && this._voice.mode === 'driving' ? 1.05 : 1;
        const status = document.getElementById('drive-status');
        u.onend = () => { if (status) status.textContent = 'اضغط الزر الكبير وتحدّث'; };
        window.speechSynthesis.speak(u);
        if (status) status.textContent = '🔊 أقرأ الرد…';
        return !!force || true;
    };


    return P.__oxUI;
}
