/* Arabic tab — #262 «قلم»: write JavaScript with Arabic keywords (.arjs), run it, see the generated JS,
   convert JS → قلم for learning, and browse the reference. The transpiler lives in src/studio/arabic.js. */
import { esc, card, pbtn, btn, setHTML, table, lsGet, lsSet } from './util.js';
import { transpileArabic, toArabic, arabicReference, ARABIC_SAMPLE } from '../studio/arabic.js';

const DRAFT = 'ox_dv_qalam_v1';
const LESSONS = [
    ['المتغيرات والطباعة', 'متغير الاسم = "سارة"؛\nثابت العمر = ٢٥؛\nاطبع("مرحباً " + الاسم + "، عمرك " + العمر)؛'],
    ['الشروط', 'متغير الدرجة = ٧٨؛\nإذا (الدرجة >= ٩٠) { اطبع("ممتاز")؛ }\nوإلا إذا (الدرجة >= ٧٥) { اطبع("جيد جداً")؛ }\nوإلا { اطبع("حاول مجدداً")؛ }'],
    ['الحلقات', 'لكل (متغير ع = ١؛ ع <= ٥؛ ع++) {\n    اطبع("السطر رقم " + ع)؛\n}\nثابت الفواكه = ["تفاح"، "موز"، "تمر"]؛\nلكل (ثابت ف من الفواكه) اطبع(ف)؛'],
    ['الدوال', 'دالة مربع(س) { ارجع س * س؛ }\nثابت جمع = (أ، ب) => أ + ب؛\nاطبع(مربع(٧)، جمع(٢، ٣))؛'],
    ['المصفوفات', 'ثابت أرقام = [٥، ٣، ٨، ١]؛\nاطبع(أرقام.رتب((أ، ب) => أ - ب))؛\nاطبع(أرقام.رشح(ن => ن > ٢).خريطة(ن => ن * ١٠))؛\nاطبع("المجموع:"، أرقام.اختزل((م، ن) => م + ن، ٠))؛'],
    ['الأصناف', 'صنف حيوان {\n    باني(اسم) { هذا.اسم = اسم؛ }\n    تكلم() { ارجع هذا.اسم + " يصدر صوتاً"؛ }\n}\nصنف قطة يمتد حيوان {\n    تكلم() { ارجع هذا.اسم + " تقول مياو"؛ }\n}\nاطبع(جديد قطة("لولو").تكلم())؛'],
    ['الأخطاء', 'حاول {\n    ارم جديد خطا_جديد("شيء ما حدث")؛\n} التقط (خ) {\n    اطبع("التقطنا:"، خ.message)؛\n} أخيراً {\n    اطبع("انتهى")؛\n}'],
    ['متزامن', 'متزامن دالة رئيسية() {\n    ثابت انتظار = (م) => جديد وعد(ح => مؤقت(ح، م))؛\n    اطبع("ابدأ")؛\n    انتظر انتظار(٣٠٠)؛\n    اطبع("بعد ٣٠٠ مللي ثانية")؛\n}\nرئيسية()؛']
];
export { LESSONS };

export function installQalam(P) {
    P.dvQalamSrc = function () { const el = document.getElementById('dv-ql-src'); return el ? el.value : (lsGet(DRAFT, null) || ARABIC_SAMPLE); };
    P.dvQalam = async function (opts = {}) {
        const src = opts.code || lsGet(DRAFT, null) || ARABIC_SAMPLE;
        const cur = this.activeStudioFile;
        this._dvMount = () => this.dvQalamCompile();
        return card('لغة «قلم» — برمجة بالعربية', `<p class="hv-dim">جافاسكربت بكلمات عربية: <code>دالة، متغير، ثابت، إذا، وإلا، لكل، بينما، ارجع، اطبع…</code> مع الأرقام العربية (٠-٩) والفاصلة «،» والفاصلة المنقوطة «؛». الملفات بامتداد <code>.arjs</code> تعمل مباشرة في المشغّل ومع الاختبارات والمصحح، وتُحفظ أرقام الأسطر كما هي.</p>
            <div class="dvx-chips">${LESSONS.map(([t], i) => `<button class="gh-chip" onclick="app.dvQalamLesson(${i})">${esc(t)}</button>`).join('')}</div>
            <div class="dvx-cmp"><div class="dvx-cmp-side"><b>قلم</b><textarea id="dv-ql-src" class="form-input-box dvx-code" dir="rtl" rows="16" spellcheck="false" oninput="app.dvQalamCompile()">${esc(src)}</textarea></div>
            <div class="dvx-cmp-side"><b>JavaScript الناتج</b><pre id="dv-ql-js" class="pfx-pre dvx-pre" dir="ltr"></pre></div></div>
            <div class="gh-row">${pbtn('fa-play', 'تشغيل', 'app.dvQalamRun()')}${btn('fa-floppy-disk', 'حفظ كملف .arjs', 'app.dvQalamSave()')}${btn('fa-language', 'تحويل الملف المفتوح إلى قلم', 'app.dvQalamFromFile()', 'sidebar-btn-util gh-btn', cur && /\.(m?js|cjs)$/.test(cur) ? '' : 'disabled')}${btn('fa-file-code', 'حفظ JS الناتج', 'app.dvQalamSaveJS()')}</div>
            <div id="dv-ql-out"></div>`, 'fa-pen-nib');
    };
    P.dvQalamLesson = function (i) { const l = LESSONS[i]; const el = document.getElementById('dv-ql-src'); if (!l || !el) return null; el.value = l[1]; this.dvQalamCompile(); return l; };
    P.dvQalamCompile = function () {
        const src = this.dvQalamSrc();
        lsSet(DRAFT, src);
        let r;
        try { r = transpileArabic(src); } catch (e) { r = { code: '', error: e.message }; }
        const el = document.getElementById('dv-ql-js');
        if (el) el.textContent = r.code || '';
        return r;
    };
    P.dvQalamRun = async function () {
        const r = this.dvQalamCompile();
        setHTML('dv-ql-out', '<div class="gh-empty"><span class="live-step-spinner"></span></div>');
        try {
            const res = await this.dvRunSnippet(this.dvQalamSrc(), { path: '__dv__/qalam.arjs', timeoutMs: 10000 });
            const lines = (res.lines || []).filter(l => l.level !== 'info');
            setHTML('dv-ql-out', card(res.success ? '✅ المخرجات' : '❌ خطأ', `<pre class="pfx-pre dvx-pre dvx-term" dir="auto">${lines.map(l => `<span class="dvx-${l.level === 'error' || l.level === 'stderr' ? 'stderr' : 'stdout'}">${esc(l.text)}</span>`).join('\n') || '<span class="dvx-info">(بدون مخرجات)</span>'}${res.error ? `\n<span class="dvx-stderr">${esc(res.error)}</span>` : ''}</pre>`, 'fa-terminal'));
            return { ...res, js: r.code };
        } catch (e) { return this.dvErr(e, 'dv-ql-out'); }
    };
    P.dvQalamSave = async function (nameArg) {
        const name = nameArg || await this.askText('اسم الملف', 'برنامج.arjs');
        if (!name) return null;
        const p = this.uniqueProjectPath(/\.arjs$/.test(name) ? name : name + '.arjs');
        this.createProjectFile(p, this.dvQalamSrc());
        return p;
    };
    P.dvQalamSaveJS = function () {
        const r = this.dvQalamCompile();
        const p = this.uniqueProjectPath('qalam-output.js');
        this.createProjectFile(p, r.code);
        return p;
    };
    P.dvQalamFromFile = function (path = this.activeStudioFile) {
        const text = this.dvRead(path);
        if (text == null) return null;
        const ar = toArabic(text);
        const el = document.getElementById('dv-ql-src');
        if (el) { el.value = ar; this.dvQalamCompile(); } else lsSet(DRAFT, ar);
        return ar;
    };
    P.dvQalamRef = async function () {
        const ref = arabicReference();
        const t = (rows) => table(['قلم', 'JavaScript'], rows.map(r => [`<b>${esc(r.ar)}</b>`, `<code dir="ltr">${esc(r.js)}</code>`]));
        return card('مرجع «قلم»', `<input class="form-input-box" placeholder="ابحث بالعربية أو الإنجليزية..." oninput="app.dvQalamRefFilter(this.value)">
            <p class="hv-dim">تُقبل الكلمات بالهمزات أو بدونها (أ/إ/آ = ا، ى = ي) ومع التشكيل. داخل النصوص والتعليقات لا يُغيَّر شيء.</p>`, 'fa-book')
            + `<div id="dv-ql-ref">` + card('الكلمات المحجوزة', t(ref.keywords), 'fa-key') + card('الدوال والكائنات العامة', t(ref.globals), 'fa-globe') + card('الخصائص والتوابع (بعد النقطة)', t(ref.props), 'fa-list') + card('الرموز', table(['قلم', 'JavaScript'], [['،', ','], ['؛', ';'], ['٠١٢٣٤٥٦٧٨٩', '0123456789'], ['٫', '. (عشري)']].map(([a, b]) => [`<b>${esc(a)}</b>`, `<code dir="ltr">${esc(b)}</code>`])), 'fa-hashtag') + '</div>';
    };
    P.dvQalamRefFilter = function (q) {
        const s = String(q || '').trim().toLowerCase();
        document.querySelectorAll('#dv-ql-ref tr').forEach(tr => { if (tr.closest('thead')) return; tr.style.display = !s || tr.textContent.toLowerCase().includes(s) ? '' : 'none'; });
    };
}
