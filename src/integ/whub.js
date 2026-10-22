/* Hub pages for the widgets: live demos + switches + "generate for my project" (#319 #318 #314 #299 #280) */
import { esc, btn, pbtn, card, empty, toggle, table, stats, pre } from './util.js';
import { LOTTIE_ICONS, enhanceTable, enhanceCarousel, enhanceSelect, progressiveImages, progressiveList, mountLotties, playLottie, toCSV } from './wlib.js';

const SAMPLE = [['أحمد', 'تونس', 1250, '2026-03-01'], ['Sara', 'Paris', 980, '2026-01-15'], ['يوسف', 'صفاقس', 2310, '2025-12-20'], ['Lina', 'Berlin', 1505, '2026-02-11'], ['مريم', 'سوسة', 760, '2026-04-02'], ['Omar', 'Cairo', 1890, '2025-11-30'], ['هند', 'نابل', 1120, '2026-05-18'], ['Ali', 'Dubai', 2045, '2026-06-07'], ['سلمى', 'بنزرت', 640, '2026-02-28'], ['Karim', 'Rabat', 1730, '2026-07-21'], ['نور', 'قابس', 990, '2026-08-09'], ['Adam', 'Madrid', 1310, '2026-09-14']];

/** Standalone, dependency-free versions of the widgets for the user's own site. */
export function widgetFiles() {
    return {
        'components/data-table.js': `// Sortable / filterable / paginated table with CSV export. Usage: dataTable(document.querySelector('table'), { pageSize: 10 })
export function dataTable(table, { pageSize = 10 } = {}) {
    const head = table.tHead.rows[0], body = table.tBodies[0];
    const rows = [...body.rows].map(tr => ({ tr, cells: [...tr.cells].map(td => td.textContent.trim()) }));
    const coll = new Intl.Collator(['ar', 'en'], { numeric: true, sensitivity: 'base' });
    const num = (s) => { const t = s.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[,\\s%$€]/g, ''); return /^-?\\d+(\\.\\d+)?$/.test(t) ? +t : NaN; };
    const cmp = (a, b) => { const x = num(a), y = num(b); return !isNaN(x) && !isNaN(y) ? x - y : coll.compare(a, b); };
    const st = { q: '', col: -1, dir: 1, page: 0 };
    const bar = document.createElement('div');
    bar.className = 'dt-bar';
    bar.innerHTML = '<input type="search" placeholder="تصفية…"> <span class="dt-count"></span> <button data-p="-1">‹</button> <span class="dt-page"></span> <button data-p="1">›</button> <button class="dt-csv">CSV</button>';
    table.before(bar);
    const render = () => {
        let list = rows.filter(r => !st.q || r.cells.some(c => c.toLowerCase().includes(st.q)));
        if (st.col >= 0) list = list.slice().sort((a, b) => cmp(a.cells[st.col], b.cells[st.col]) * st.dir);
        const pages = Math.max(1, Math.ceil(list.length / pageSize));
        st.page = Math.min(Math.max(0, st.page), pages - 1);
        rows.forEach(r => { r.tr.hidden = true; });
        list.slice(st.page * pageSize, st.page * pageSize + pageSize).forEach(r => { r.tr.hidden = false; body.appendChild(r.tr); });
        bar.querySelector('.dt-count').textContent = list.length + ' صف';
        bar.querySelector('.dt-page').textContent = (st.page + 1) + '/' + pages;
        [...head.cells].forEach((th, i) => th.setAttribute('aria-sort', i === st.col ? (st.dir > 0 ? 'ascending' : 'descending') : 'none'));
        return list;
    };
    [...head.cells].forEach((th, i) => { th.style.cursor = 'pointer'; th.addEventListener('click', () => { st.dir = st.col === i ? -st.dir : 1; st.col = i; render(); }); });
    bar.querySelector('input').addEventListener('input', e => { st.q = e.target.value.toLowerCase(); st.page = 0; render(); });
    bar.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => { st.page += +b.dataset.p; render(); }));
    bar.querySelector('.dt-csv').addEventListener('click', () => {
        const csv = [[...head.cells].map(th => th.textContent), ...render().map(r => r.cells)].map(r => r.map(c => /[",\\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c).join(',')).join('\\n');
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\\ufeff' + csv], { type: 'text/csv' })); a.download = 'table.csv'; a.click();
    });
    render();
}
`,
        'components/carousel.js': `// Accessible scroll-snap carousel. Markup: <div class="carousel" data-autoplay="5000"><img …><img …></div>
export function carousel(el) {
    const slides = [...el.children];
    el.classList.add('carousel');
    el.innerHTML = '<button class="c-prev" aria-label="السابق">‹</button><div class="c-track" tabindex="0"></div><button class="c-next" aria-label="التالي">›</button><div class="c-dots"></div>';
    const track = el.querySelector('.c-track'), dots = el.querySelector('.c-dots');
    slides.forEach((s, i) => { const f = document.createElement('div'); f.className = 'c-slide'; f.appendChild(s); track.appendChild(f); dots.insertAdjacentHTML('beforeend', '<button aria-label="' + (i + 1) + '"></button>'); });
    let cur = 0;
    const go = (i) => { cur = (i + slides.length) % slides.length; track.children[cur].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); [...dots.children].forEach((d, k) => d.classList.toggle('on', k === cur)); };
    const rtl = getComputedStyle(el).direction === 'rtl' ? -1 : 1;
    el.querySelector('.c-prev').onclick = () => go(cur - rtl);
    el.querySelector('.c-next').onclick = () => go(cur + rtl);
    dots.onclick = (e) => { const i = [...dots.children].indexOf(e.target); if (i >= 0) go(i); };
    track.onkeydown = (e) => { if (e.key === 'ArrowLeft') go(cur - 1); if (e.key === 'ArrowRight') go(cur + 1); };
    if (+el.dataset.autoplay) setInterval(() => { if (!el.matches(':hover')) go(cur + 1); }, +el.dataset.autoplay);
    go(0);
    return { go };
}
`,
        'components/components.css': `.dt-bar { display: flex; gap: 6px; align-items: center; margin: 8px 0; }
.dt-bar input { flex: 1; padding: 6px 10px; border-radius: 8px; border: 1px solid #ccc; }
th[aria-sort="ascending"]::after { content: " ▲"; } th[aria-sort="descending"]::after { content: " ▼"; }
.carousel { position: relative; } .c-track { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; border-radius: 12px; }
.c-slide { flex: 0 0 100%; scroll-snap-align: center; display: flex; justify-content: center; } .c-slide img { max-width: 100%; }
.c-prev, .c-next { position: absolute; top: 50%; transform: translateY(-50%); z-index: 1; border: 0; border-radius: 50%; width: 36px; height: 36px; background: #0008; color: #fff; font-size: 22px; cursor: pointer; }
.c-prev { inset-inline-start: 8px; } .c-next { inset-inline-end: 8px; }
.c-dots { display: flex; gap: 6px; justify-content: center; margin-top: 6px; } .c-dots button { width: 8px; height: 8px; border-radius: 4px; border: 0; background: #bbb; } .c-dots .on { width: 20px; background: #4f46e5; }
img[loading="lazy"] { background: #eee; }
`
    };
}

export function installWidgetsHub(P) {
    const sw = (key, label, on) => toggle('ix-wg-' + key, label, on, `onchange="app.ixWgSet('${key}', this.checked)"`);
    P.ixWgCfg = function () { return { tables: true, carousel: true, dropdowns: true, progressive: true, lottie: true, lottieToasts: false, ...this.ixCfg('widgets') }; };
    P.ixWgSet = function (key, on) {
        this.ixSave('widgets', { [key]: !!on });
        const any = Object.values(this.ixWgCfg()).some(Boolean);
        try { localStorage.setItem('ox_ix_widgets_v1', JSON.stringify(any ? 1 : 0)); } catch (e) { /* quota */ }
        if (on && this.loadChunk) this.loadChunk('widgets').then(() => this.wgEnhance && this.wgEnhance()).catch(() => {});
        return this.ixWgCfg();
    };
    P.ixWgFiles = function () { return this.ixWriteFiles('مكونات الواجهة', widgetFiles(), { open: false }); };
    const genBtn = btn('fa-file-code', 'نسخة مستقلة لموقعك', 'app.ixWgFiles()');
    P.ixTable = async function () {
        const c = this.ixWgCfg();
        this._ixMount = () => { const t = document.getElementById('ix-wg-table'); if (t) enhanceTable(t, { size: 5 }); };
        return card('جدول بيانات متقدم', `<p class="hv-dim">كل جدول في ردود الذكاء (Markdown) يصبح تلقائياً قابلاً للفرز بالنقر على العمود (أرقام أو ترتيب أبجدي عربي)، والتصفية الفورية، والتقسيم إلى صفحات، والتصدير إلى CSV أو النسخ إلى Excel.</p>
            <div class="gh-row">${sw('tables', 'تفعيل على جداول المحادثة', c.tables)}${genBtn}</div>
            ${table(['الاسم', 'المدينة', 'النقاط', 'التاريخ'], SAMPLE.map(r => r.map(x => esc(x))), 'ix-demo-table" id="ix-wg-table')}`, 'fa-table');
    };
    P.ixCarousel = async function () {
        const c = this.ixWgCfg();
        const colors = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4'];
        const svg = (i) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="300"><rect width="640" height="300" rx="16" fill="${colors[i]}"/><text x="320" y="170" font-size="64" text-anchor="middle" fill="#fff" font-family="Arial">${i + 1}</text></svg>`);
        this._ixMount = () => { const el = document.getElementById('ix-wg-car'); if (el) enhanceCarousel(el); };
        return card('الشرائح', `<p class="hv-dim">عندما يحتوي رد الذكاء على ثلاث صور أو أكثر متتالية، تتحول إلى شرائح قابلة للسحب، مع أزرار للتنقل ونقاط ودعم لأسهم لوحة المفاتيح، وتحترم اتجاه RTL. ويمكن استخدامها في أي مكان بإضافة الصنف <code>ox-carousel</code>.</p>
            <div class="gh-row">${sw('carousel', 'تفعيل في المحادثة', c.carousel)}${genBtn}</div>
            <div id="ix-wg-car" data-autoplay="4000">${colors.map((_, i) => `<figure><img src="${svg(i)}" alt="شريحة ${i + 1}"></figure>`).join('')}</div>`, 'fa-images');
    };
    P.ixDropdowns = async function () {
        const c = this.ixWgCfg();
        const opts = ['JavaScript', 'TypeScript', 'Python', 'Go', 'Rust', 'Java', 'Kotlin', 'Swift', 'C', 'C++', 'C#', 'PHP', 'Ruby', 'Dart', 'Elixir', 'Haskell', 'Lua', 'R', 'Julia', 'Scala', 'SQL', 'Bash', 'العربية (قلم)'];
        this._ixMount = () => { const s = document.getElementById('ix-wg-sel'); if (s) enhanceSelect(s); };
        return card('القوائم المنسدلة المحسنة', `<p class="hv-dim">أي قائمة منسدلة فيها أكثر من 12 خياراً (النماذج، والمستودعات، واللغات…) يُضاف لها حقل بحث فوري. اكتب جزءاً من الاسم ثم اضغط Enter لاختيار أول نتيجة، أو السهم للأسفل للتنقل. تبقى القائمة الأصلية كما هي، فلا يتأثر أي سلوك.</p>
            <div class="gh-row">${sw('dropdowns', 'تفعيل على كل القوائم الطويلة', c.dropdowns)}</div>
            <label class="fmx-field"><span>لغة البرمجة</span><select id="ix-wg-sel" class="form-input-box">${opts.map(o => `<option>${esc(o)}</option>`).join('')}</select></label>`, 'fa-list');
    };
    P.ixProgressive = async function () {
        const c = this.ixWgCfg();
        this._ixMount = () => {
            const box = document.getElementById('ix-wg-list');
            if (box) this._ixProgList = progressiveList(box, Array.from({ length: 1000 }, (_, i) => i + 1), (n) => `<div class="fmx-item"><div><b>عنصر ${n}</b><small>يُرسم عند الاقتراب منه فقط</small></div></div>`, { batch: 30 });
            const g = document.getElementById('ix-wg-imgs'); if (g) progressiveImages(g);
        };
        return card('التحميل التدريجي', `<p class="hv-dim">الصور تُحمّل كسولاً (lazy) مع فك ترميز غير متزامن وتأثير ضبابي حتى تكتمل، فلا تقفز الصفحة. والقوائم الطويلة تُرسم على دفعات أثناء التمرير، فيبقى الأداء ثابتاً حتى مع آلاف العناصر.</p>
            <div class="gh-row">${sw('progressive', 'تفعيل على صور التطبيق', c.progressive)}</div>
            <div id="ix-wg-imgs" class="ix-grid">${[1, 2, 3, 4].map(i => `<figure class="ix-thumb"><img src="icons/icon-192.png?v=${i}" alt="" width="96" height="96"></figure>`).join('')}</div>
            <div id="ix-wg-list" class="ix-scroll ix-prog-list"></div>`, 'fa-spinner');
    };
    P.ixLottieLoad = async function (path) {
        const f = this.virtualProjectFiles.get(path);
        if (!f) return null;
        try {
            const data = JSON.parse(f.content);
            if (!data.layers || !data.w) throw new Error('ليس ملف Lottie (bodymovin)');
            const box = document.getElementById('ix-wg-lplay');
            if (box) { if (this._ixLt) this._ixLt.pause(); this._ixLt = playLottie(box, data); }
            const unsupported = [...new Set(JSON.stringify(data.layers).match(/"ty":\s*(\d|"[a-z]{2}")/g) || [])].filter(t => !/"ty":\s*(4|3|"(gr|rc|el|sh|fl|st|tm|tr)")/.test(t));
            this.ixOut('ix-wg-linfo', stats([['الإطارات', `${data.ip || 0}–${data.op}`], ['FPS', data.fr], ['الطبقات', data.layers.length], ['أنواع غير مدعومة', unsupported.length ? unsupported.join(' ') : '—']]));
            return data;
        } catch (e) { return this.ixErr(e, 'ix-wg-linfo'); }
    };
    P.ixLottie = async function () {
        const c = this.ixWgCfg();
        const jsons = this.ixFiles(p => /\.json$/i.test(p)).filter(([, t]) => /"layers"\s*:/.test(t) && /"fr"\s*:/.test(t)).map(([p]) => p);
        this._ixMount = () => { const r = document.getElementById('ix-wg-lot'); if (r) mountLotties(r); };
        return card('أيقونات Lottie المتحركة', `<p class="hv-dim">مشغّل Lottie (bodymovin JSON) خفيف يرسم بـ SVG، ويدعم طبقات الأشكال والمجموعات والمستطيلات والقطوع والمسارات والتعبئة والحدود و Trim Paths والتحويلات المتحركة مع منحنيات Bézier، وكل ذلك بأقل من 5KB ودون مكتبة خارجية. ضع <code>&lt;span data-lottie="check"&gt;</code> في أي مكان.</p>
            <div id="ix-wg-lot" class="ix-lottie-row">${Object.keys(LOTTIE_ICONS).map(k => `<figure><span data-lottie="${k}"></span><figcaption>${k}</figcaption></figure>`).join('')}</div>
            <div class="gh-row">${sw('lottie', 'تفعيل [data-lottie]', c.lottie)}${sw('lottieToasts', 'علامة صح متحركة في إشعارات النجاح', c.lottieToasts)}${btn('fa-download', 'تنزيل الأيقونات (JSON)', "app.downloadBlob(new Blob([JSON.stringify(app.ixLottieIcons())],{type:'application/json'}),'ox-lottie-icons.json')")}</div>`, 'fa-wand-sparkles')
            + card('شغّل ملف Lottie من مشروعك', jsons.length ? `<div class="gh-row">${jsons.slice(0, 12).map(p => btn('fa-play', esc(p), `app.ixLottieLoad(${esc(JSON.stringify(p))})`)).join('')}</div><div id="ix-wg-lplay" class="ix-lottie-big"></div><div id="ix-wg-linfo"></div>` : empty('ارفع ملف Lottie (.json من LottieFiles أو After Effects) إلى المشروع ليظهر هنا'), 'fa-play');
    };
    P.ixLottieIcons = () => LOTTIE_ICONS;
    P.ixCsv = (rows) => toCSV(rows);
}
