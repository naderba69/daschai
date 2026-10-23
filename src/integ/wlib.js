/* UI widgets library (shared by the idle "widgets" chunk and the hub demos):
   #319 advanced data tables • #318 carousels • #314 searchable dropdowns • #299 progressive loading • #280 Lottie (SVG subset renderer) */

const AR_COLL = typeof Intl !== 'undefined' ? new Intl.Collator(['ar', 'en'], { numeric: true, sensitivity: 'base' }) : null;
const numOf = (s) => { const t = String(s).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[,\s%$€£]/g, ''); return /^-?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : NaN; };
/** Compare two cell texts: numbers numerically, otherwise Arabic/English collation. */
export function cellCmp(a, b) {
    const x = numOf(a), y = numOf(b);
    if (!isNaN(x) && !isNaN(y)) return x - y;
    return AR_COLL ? AR_COLL.compare(String(a), String(b)) : String(a).localeCompare(String(b));
}
/** Rows → CSV (RFC 4180). */
export const toCSV = (rows) => rows.map(r => r.map(c => { const s = String(c == null ? '' : c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n') + '\n';
/** Filter + sort + page a matrix (pure core of the table widget). */
export function tableView(rows, { q = '', sortCol = -1, sortDir = 1, page = 0, size = 25 } = {}) {
    const ql = String(q).trim().toLowerCase();
    let r = ql ? rows.filter(row => row.some(c => String(c).toLowerCase().includes(ql))) : rows.slice();
    if (sortCol >= 0) r = r.map((row, i) => [row, i]).sort((a, b) => (cellCmp(a[0][sortCol], b[0][sortCol]) * sortDir) || (a[1] - b[1])).map(x => x[0]);
    const pages = Math.max(1, Math.ceil(r.length / size));
    const p = Math.min(Math.max(0, page), pages - 1);
    return { rows: r.slice(p * size, p * size + size), total: r.length, pages, page: p };
}

// ====================================================================== #319 data table
export function enhanceTable(table, { size = 25, doc } = {}) {
    if (!table || table.dataset.oxTable) return null;
    doc = doc || table.ownerDocument;
    const head = table.tHead && table.tHead.rows[0] ? table.tHead.rows[0] : table.rows[0];
    const body = table.tBodies[0] || table;
    const dataRows = [...body.rows].filter(r => r !== head);
    if (!head || dataRows.length < 3) return null;
    table.dataset.oxTable = '1';
    const all = dataRows.map(tr => ({ tr, cells: [...tr.cells].map(td => td.textContent.trim()) }));
    const st = { q: '', sortCol: -1, sortDir: 1, page: 0, size };
    const bar = doc.createElement('div');
    bar.className = 'ox-tbar';
    bar.innerHTML = '<input type="search" class="ox-tq" placeholder="تصفية…" aria-label="تصفية الجدول"><span class="ox-tcount"></span><span class="ox-tpager"><button class="ox-tprev" aria-label="السابق">‹</button><span class="ox-tpage"></span><button class="ox-tnext" aria-label="التالي">›</button></span><button class="ox-tcsv" title="تنزيل CSV">CSV</button><button class="ox-tcopy" title="نسخ كـ TSV"><i class="fa-regular fa-copy" aria-hidden="true"></i></button>';
    table.parentNode.insertBefore(bar, table);
    const wrap = doc.createElement('div');
    wrap.className = 'ox-twrap';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
    [...head.cells].forEach((th, i) => {
        th.classList.add('ox-tsort');
        th.tabIndex = 0;
        th.setAttribute('aria-sort', 'none');
        const go = () => { st.sortDir = st.sortCol === i ? -st.sortDir : 1; st.sortCol = i; st.page = 0; render(); };
        th.addEventListener('click', go);
        th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    const render = () => {
        const byText = new Map(all.map(x => [x.cells, x.tr]));
        const v = tableView(all.map(x => x.cells), st);
        all.forEach(x => { x.tr.hidden = true; });
        v.rows.forEach(cells => { const tr = byText.get(cells); tr.hidden = false; body.appendChild(tr); });
        st.page = v.page;
        [...head.cells].forEach((th, i) => { th.setAttribute('aria-sort', i === st.sortCol ? (st.sortDir > 0 ? 'ascending' : 'descending') : 'none'); th.dataset.dir = i === st.sortCol ? (st.sortDir > 0 ? '▲' : '▼') : ''; });
        bar.querySelector('.ox-tcount').textContent = v.total === all.length ? `${all.length} صف` : `${v.total} / ${all.length}`;
        bar.querySelector('.ox-tpager').hidden = v.pages <= 1;
        bar.querySelector('.ox-tpage').textContent = `${v.page + 1}/${v.pages}`;
        return v;
    };
    bar.querySelector('.ox-tq').addEventListener('input', (e) => { st.q = e.target.value; st.page = 0; render(); });
    bar.querySelector('.ox-tprev').addEventListener('click', () => { st.page--; render(); });
    bar.querySelector('.ox-tnext').addEventListener('click', () => { st.page++; render(); });
    const matrix = () => [[...head.cells].map(th => th.textContent.trim()), ...tableView(all.map(x => x.cells), { ...st, page: 0, size: 1e9 }).rows];
    bar.querySelector('.ox-tcsv').addEventListener('click', () => {
        const blob = new (doc.defaultView.Blob)(['\ufeff' + toCSV(matrix())], { type: 'text/csv' });
        const a = doc.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'table.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    bar.querySelector('.ox-tcopy').addEventListener('click', () => { const t = matrix().map(r => r.join('\t')).join('\n'); if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {}); });
    const api = { state: st, render, matrix, sort: (col, dir = 1) => { st.sortCol = col; st.sortDir = dir; return render(); }, filter: (q) => { st.q = q; st.page = 0; return render(); } };
    table.__oxTable = api;
    render();
    return api;
}

// ====================================================================== #318 carousel
export function enhanceCarousel(el, { doc } = {}) {
    if (!el || el.dataset.oxCarousel) return null;
    doc = doc || el.ownerDocument;
    const slides = [...el.children].filter(c => !c.classList.contains('ox-cnav'));
    if (slides.length < 2) return null;
    el.dataset.oxCarousel = '1';
    el.classList.add('ox-carousel');
    const track = doc.createElement('div');
    track.className = 'ox-ctrack';
    track.tabIndex = 0;
    track.setAttribute('role', 'region');
    track.setAttribute('aria-roledescription', 'carousel');
    slides.forEach((s, i) => { s.classList.add('ox-cslide'); s.setAttribute('aria-label', `${i + 1} / ${slides.length}`); track.appendChild(s); });
    const dots = doc.createElement('div');
    dots.className = 'ox-cdots';
    dots.innerHTML = slides.map((_, i) => `<button aria-label="الشريحة ${i + 1}" data-i="${i}"></button>`).join('');
    const prev = doc.createElement('button'), next = doc.createElement('button');
    prev.className = 'ox-cnav ox-cprev'; prev.setAttribute('aria-label', 'السابق'); prev.textContent = '‹';
    next.className = 'ox-cnav ox-cnext'; next.setAttribute('aria-label', 'التالي'); next.textContent = '›';
    el.append(prev, track, next, dots);
    let cur = 0, timer = null;
    const go = (i) => {
        cur = (i + slides.length) % slides.length;
        const s = slides[cur];
        if (track.scrollTo) track.scrollTo({ left: s.offsetLeft - track.offsetLeft, behavior: 'smooth' });
        [...dots.children].forEach((d, k) => d.classList.toggle('active', k === cur));
        return cur;
    };
    const rtl = () => (doc.defaultView.getComputedStyle ? doc.defaultView.getComputedStyle(el).direction === 'rtl' : false);
    prev.addEventListener('click', () => go(cur + (rtl() ? 1 : -1)));
    next.addEventListener('click', () => go(cur + (rtl() ? -1 : 1)));
    dots.addEventListener('click', (e) => { if (e.target.dataset.i) go(+e.target.dataset.i); });
    track.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); go(cur - 1); } if (e.key === 'ArrowRight') { e.preventDefault(); go(cur + 1); } });
    let t;
    track.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(() => { const x = track.scrollLeft; let best = 0, bd = Infinity; slides.forEach((s, k) => { const d = Math.abs(Math.abs(s.offsetLeft - track.offsetLeft) - Math.abs(x)); if (d < bd) { bd = d; best = k; } }); cur = best; [...dots.children].forEach((d, k) => d.classList.toggle('active', k === cur)); }, 80); }, { passive: true });
    const auto = +el.dataset.autoplay;
    if (auto > 0) { timer = setInterval(() => { if (!el.isConnected) return clearInterval(timer); if (!el.matches(':hover')) go(cur + 1); }, auto); }
    go(0);
    const api = { go, next: () => go(cur + 1), prev: () => go(cur - 1), get index() { return cur; }, count: slides.length, stop: () => clearInterval(timer) };
    el.__oxCarousel = api;
    return api;
}
/** Chat replies: a paragraph holding ≥3 images becomes a carousel. */
export function autoCarousels(root) {
    let n = 0;
    (root.querySelectorAll ? root.querySelectorAll('.message-content p, .markdown-body p') : []).forEach(p => {
        if (p.dataset.oxCarousel) return;
        const imgs = p.querySelectorAll('img');
        if (imgs.length < 3 || p.textContent.trim().length > 0) return;
        [...p.childNodes].forEach(c => { if (c.nodeType === 3 || c.nodeName === 'BR') c.remove(); });
        [...p.children].forEach(c => { if (c.nodeName === 'IMG') { const f = p.ownerDocument.createElement('figure'); p.insertBefore(f, c); f.appendChild(c); } });
        if (enhanceCarousel(p)) n++;
    });
    return n;
}

// ====================================================================== #314 searchable dropdowns
export function enhanceSelect(sel, { min = 12, doc } = {}) {
    if (!sel || sel.dataset.oxSelect || sel.multiple || sel.options.length < min) return null;
    doc = doc || sel.ownerDocument;
    sel.dataset.oxSelect = '1';
    const q = doc.createElement('input');
    q.type = 'search';
    q.className = 'form-input-box ox-selq';
    q.placeholder = `ابحث في ${sel.options.length} خياراً…`;
    q.setAttribute('aria-label', 'تصفية الخيارات');
    sel.parentNode.insertBefore(q, sel);
    const filter = (text) => {
        const t = String(text).trim().toLowerCase();
        let first = null, shown = 0;
        [...sel.options].forEach(o => { const ok = !t || o.text.toLowerCase().includes(t) || o.value.toLowerCase().includes(t); o.hidden = !ok; if (ok) { shown++; if (!first) first = o; } });
        [...sel.querySelectorAll('optgroup')].forEach(g => { g.hidden = ![...g.children].some(o => !o.hidden); });
        return { shown, first };
    };
    q.addEventListener('input', () => filter(q.value));
    q.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); const { first } = filter(q.value); if (first) { sel.value = first.value; sel.dispatchEvent(new (doc.defaultView.Event)('change', { bubbles: true })); q.value = ''; filter(''); } }
        if (e.key === 'ArrowDown') { e.preventDefault(); sel.focus(); }
        if (e.key === 'Escape') { q.value = ''; filter(''); }
    });
    sel.__oxFilter = filter;
    return { input: q, filter };
}

// ====================================================================== #299 progressive loading
export function progressiveImages(root) {
    let n = 0;
    (root.querySelectorAll ? root.querySelectorAll('img:not([data-ox-prog])') : []).forEach(img => {
        if (img.closest('.ix-cam, .cm-editor, [data-no-prog]')) return;
        img.dataset.oxProg = '1';
        if (!img.hasAttribute('loading')) img.loading = 'lazy';
        img.decoding = 'async';
        if (img.complete && img.naturalWidth) { img.classList.add('ox-loaded'); return; }
        img.classList.add('ox-prog');
        const done = () => { img.classList.remove('ox-prog'); img.classList.add('ox-loaded'); };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', () => img.classList.remove('ox-prog'), { once: true });
        n++;
    });
    return n;
}
/** Render a long list in batches as the user scrolls (IntersectionObserver sentinel). */
export function progressiveList(container, items, render, { batch = 40, doc } = {}) {
    doc = doc || container.ownerDocument;
    let i = 0;
    const sentinel = doc.createElement('div');
    sentinel.className = 'ox-sentinel';
    const more = () => {
        const frag = doc.createDocumentFragment();
        const end = Math.min(items.length, i + batch);
        for (; i < end; i++) { const t = doc.createElement('template'); t.innerHTML = render(items[i], i); frag.appendChild(t.content); }
        container.insertBefore(frag, sentinel);
        if (i >= items.length) { sentinel.remove(); if (io) io.disconnect(); }
        return i;
    };
    container.appendChild(sentinel);
    const IO = doc.defaultView && doc.defaultView.IntersectionObserver;
    const io = IO ? new IO((es) => { if (es.some(e => e.isIntersecting)) more(); }, { rootMargin: '400px' }) : null;
    more();
    if (io && i < items.length) io.observe(sentinel);
    return { more, get rendered() { return i; }, total: items.length };
}

// ====================================================================== #280 Lottie (bodymovin JSON) — SVG renderer for the common subset
const lerp = (a, b, t) => (Array.isArray(a) ? a.map((x, i) => x + ((Array.isArray(b) ? b[i] : b) - x) * t) : a + (b - a) * t);
/** cubic-bezier(x1,y1,x2,y2) easing at x (Newton). */
export function bezierEase(x1, y1, x2, y2, x) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    let t = x;
    for (let i = 0; i < 8; i++) { const fx = ((ax * t + bx) * t + cx) * t - x; const d = (3 * ax * t + 2 * bx) * t + cx; if (Math.abs(fx) < 1e-5 || !d) break; t -= fx / d; }
    t = Math.max(0, Math.min(1, t));
    return ((ay * t + by) * t + cy) * t;
}
const first = (v) => (Array.isArray(v) ? v[0] : v);
/** Value of an (animated) Lottie property at frame f. */
export function propAt(prop, f) {
    if (!prop) return undefined;
    if (!prop.a) return prop.k;
    const ks = prop.k;
    if (!Array.isArray(ks) || !ks.length) return prop.k;
    if (f <= ks[0].t) return ks[0].s;
    for (let i = 0; i < ks.length - 1; i++) {
        const k = ks[i], n = ks[i + 1];
        if (f < n.t) {
            const end = k.e != null ? k.e : n.s;
            if (k.h) return k.s;
            let t = (f - k.t) / (n.t - k.t);
            if (k.o && k.i) t = bezierEase(first(k.o.x), first(k.o.y), first(k.i.x), first(k.i.y), t);
            return lerp(k.s, end, t);
        }
    }
    const last = ks[ks.length - 1];
    return last.s != null ? last.s : (ks[ks.length - 2] && ks[ks.length - 2].e);
}
const num1 = (v) => (Array.isArray(v) ? v[0] : v);
const rgba = (c, o = 100) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${(c[3] == null ? 1 : c[3]) * o / 100})`;
const transformAttr = (tr, f) => {
    if (!tr) return '';
    const a = propAt(tr.a, f) || [0, 0], p = propAt(tr.p, f) || [0, 0], s = propAt(tr.s, f) || [100, 100], r = num1(propAt(tr.r, f)) || 0;
    return `translate(${p[0]},${p[1]}) rotate(${r}) scale(${s[0] / 100},${s[1] / 100}) translate(${-a[0]},${-a[1]})`;
};
/** Bezier path {i,o,v,c} → SVG d */
export function shapePath(sh) {
    if (!sh || !sh.v || !sh.v.length) return '';
    const { v, i, o, c } = sh;
    let d = `M${v[0][0]},${v[0][1]}`;
    const seg = (a, b) => ` C${v[a][0] + o[a][0]},${v[a][1] + o[a][1]} ${v[b][0] + i[b][0]},${v[b][1] + i[b][1]} ${v[b][0]},${v[b][1]}`;
    for (let k = 1; k < v.length; k++) d += seg(k - 1, k);
    if (c) d += seg(v.length - 1, 0) + 'Z';
    return d;
}
function shapesToSVG(items, f) {
    let geo = [], fill = null, stroke = null, trim = null, tr = null, out = '';
    (items || []).forEach(it => {
        if (it.hd) return;
        if (it.ty === 'gr') out += shapesToSVG(it.it, f);
        else if (it.ty === 'rc') { const s = propAt(it.s, f), p = propAt(it.p, f), r = num1(propAt(it.r, f)) || 0; geo.push(`<rect x="${p[0] - s[0] / 2}" y="${p[1] - s[1] / 2}" width="${s[0]}" height="${s[1]}" rx="${r}" pathLength="100"/>`); }
        else if (it.ty === 'el') { const s = propAt(it.s, f), p = propAt(it.p, f); geo.push(`<ellipse cx="${p[0]}" cy="${p[1]}" rx="${s[0] / 2}" ry="${s[1] / 2}" pathLength="100"/>`); }
        else if (it.ty === 'sh') geo.push(`<path d="${shapePath(propAt(it.ks, f))}" pathLength="100"/>`);
        else if (it.ty === 'fl') fill = rgba(propAt(it.c, f), num1(propAt(it.o, f)) ?? 100);
        else if (it.ty === 'st') stroke = { c: rgba(propAt(it.c, f), num1(propAt(it.o, f)) ?? 100), w: num1(propAt(it.w, f)) || 1, cap: ['butt', 'butt', 'round', 'square'][it.lc || 2], join: ['miter', 'miter', 'round', 'bevel'][it.lj || 2] };
        else if (it.ty === 'tm') trim = { s: num1(propAt(it.s, f)) || 0, e: num1(propAt(it.e, f)) ?? 100, o: num1(propAt(it.o, f)) || 0 };
        else if (it.ty === 'tr') tr = it;
    });
    if (geo.length) {
        let style = `fill:${fill || 'none'};`;
        if (stroke) style += `stroke:${stroke.c};stroke-width:${stroke.w};stroke-linecap:${stroke.cap};stroke-linejoin:${stroke.join};`;
        if (trim) { const len = Math.max(0, Math.abs(trim.e - trim.s)); style += `stroke-dasharray:${len} ${100 - len + 0.001};stroke-dashoffset:${-(Math.min(trim.s, trim.e) + trim.o / 3.6)};`; }
        out = `<g style="${style}">${geo.join('')}</g>` + out;
    }
    if (tr) { const o = num1(propAt(tr.o, f)); return `<g transform="${transformAttr(tr, f)}"${o != null && o < 100 ? ` opacity="${o / 100}"` : ''}>${out}</g>`; }
    return out;
}
/** Lottie JSON → SVG markup at frame f (pure; testable). */
export function lottieFrameSVG(data, f) {
    const layers = data.layers || [];
    const byInd = new Map(layers.map(l => [l.ind, l]));
    const wrap = (l, inner) => { const o = num1(propAt(l.ks && l.ks.o, f)); let g = `<g transform="${transformAttr(l.ks, f)}"${o != null && o < 100 ? ` opacity="${o / 100}"` : ''}>${inner}</g>`; let p = l.parent != null ? byInd.get(l.parent) : null; let guard = 0; while (p && guard++ < 20) { g = `<g transform="${transformAttr(p.ks, f)}">${g}</g>`; p = p.parent != null ? byInd.get(p.parent) : null; } return g; };
    const body = layers.slice().reverse().filter(l => l.ty === 4 && !l.hd && f >= (l.ip ?? -Infinity) && f < (l.op ?? Infinity)).map(l => wrap(l, shapesToSVG(l.shapes, f))).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${data.w} ${data.h}" width="100%" height="100%" aria-hidden="true">${body}</svg>`;
}
/** Play a Lottie animation inside el. → controller */
export function playLottie(el, data, { loop = true, autoplay = true, speed = 1 } = {}) {
    const fr = data.fr || 30, ip = data.ip || 0, op = data.op || 60;
    let f = ip, raf = 0, last = 0, playing = false;
    const win = el.ownerDocument.defaultView;
    const draw = () => { el.innerHTML = lottieFrameSVG(data, f); };
    const tick = (t) => {
        if (!playing) return;
        if (!el.isConnected && last) { playing = false; return; }
        if (last) f += ((t - last) / 1000) * fr * speed;
        last = t;
        if (f >= op) { if (loop) f = ip + ((f - ip) % (op - ip)); else { f = op - 0.001; playing = false; } }
        draw();
        if (playing) raf = (win.requestAnimationFrame || ((cb) => setTimeout(() => cb(Date.now()), 16)))(tick);
    };
    const ctl = {
        play() { if (playing) return; playing = true; last = 0; raf = (win.requestAnimationFrame || ((cb) => setTimeout(() => cb(Date.now()), 16)))(tick); },
        pause() { playing = false; (win.cancelAnimationFrame || clearTimeout)(raf); },
        stop() { ctl.pause(); f = ip; draw(); },
        seek(frame) { f = Math.max(ip, Math.min(op, frame)); draw(); },
        get frame() { return f; }, get playing() { return playing; }, data
    };
    draw();
    if (autoplay && !(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches)) ctl.play();
    return ctl;
}
// Built-in animated icons (real Lottie JSON, authored here; 60fps-ready, 1s loops)
const K = (frames) => ({ a: 1, k: frames.map(([t, s], i) => ({ t, s, ...(i < frames.length - 1 ? { o: { x: [0.33], y: [0] }, i: { x: [0.67], y: [1] } } : {}) })) });
const TR = (o = {}) => ({ ty: 'tr', a: { a: 0, k: [0, 0] }, p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, ...o });
const layer = (shapes, ks = {}, extra = {}) => ({ ty: 4, ind: 1, ip: 0, op: 60, ks: { a: { a: 0, k: [0, 0] }, p: { a: 0, k: [50, 50] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, ...ks }, shapes, ...extra });
const anim = (layers, op = 60) => ({ v: '5.7.0', fr: 60, ip: 0, op, w: 100, h: 100, layers });
const C = { brand: [0.388, 0.4, 0.945, 1], green: [0.133, 0.773, 0.369, 1], red: [0.937, 0.267, 0.267, 1], amber: [0.961, 0.62, 0.043, 1] };
export const LOTTIE_ICONS = {
    check: anim([layer([{ ty: 'gr', it: [{ ty: 'el', s: { a: 0, k: [76, 76] }, p: { a: 0, k: [0, 0] } }, { ty: 'st', c: { a: 0, k: C.green }, o: { a: 0, k: 100 }, w: { a: 0, k: 6 }, lc: 2, lj: 2 }, { ty: 'tm', s: { a: 0, k: 0 }, e: K([[0, 0], [24, 100]]), o: { a: 0, k: 0 } }, TR()] },
        { ty: 'gr', it: [{ ty: 'sh', ks: { a: 0, k: { c: false, v: [[-17, 1], [-5, 13], [19, -12]], i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]] } } }, { ty: 'st', c: { a: 0, k: C.green }, o: { a: 0, k: 100 }, w: { a: 0, k: 7 }, lc: 2, lj: 2 }, { ty: 'tm', s: { a: 0, k: 0 }, e: K([[18, 0], [40, 100]]), o: { a: 0, k: 0 } }, TR()] }],
    { s: K([[0, [80, 80]], [20, [108, 108]], [34, [100, 100]]]) })]),
    spinner: anim([layer([{ ty: 'gr', it: [{ ty: 'el', s: { a: 0, k: [70, 70] }, p: { a: 0, k: [0, 0] } }, { ty: 'st', c: { a: 0, k: C.brand }, o: { a: 0, k: 100 }, w: { a: 0, k: 8 }, lc: 2 }, { ty: 'tm', s: K([[0, 0], [30, 10], [60, 0]]), e: K([[0, 25], [30, 75], [60, 25]]), o: { a: 0, k: 0 } }, TR()] }], { r: { a: 1, k: [{ t: 0, s: [0] }, { t: 60, s: [360] }] } })]),
    bell: anim([layer([{ ty: 'gr', it: [{ ty: 'sh', ks: { a: 0, k: { c: true, v: [[0, -28], [22, -4], [26, 18], [-26, 18], [-22, -4]], i: [[-14, 0], [0, -14], [0, 0], [0, 0], [0, 12]], o: [[14, 0], [0, 12], [0, 0], [0, 0], [0, -14]] } } }, { ty: 'fl', c: { a: 0, k: C.amber }, o: { a: 0, k: 100 } }, TR()] },
        { ty: 'gr', it: [{ ty: 'el', s: { a: 0, k: [14, 14] }, p: { a: 0, k: [0, 26] } }, { ty: 'fl', c: { a: 0, k: C.amber }, o: { a: 0, k: 100 } }, TR()] }],
    { a: { a: 0, k: [0, -28] }, p: { a: 0, k: [50, 26] }, r: K([[0, 0], [8, 18], [18, -16], [28, 12], [38, -8], [48, 0], [60, 0]]) })]),
    heart: anim([layer([{ ty: 'gr', it: [{ ty: 'sh', ks: { a: 0, k: { c: true, v: [[0, 26], [-30, -4], [0, -16], [30, -4]], i: [[0, 0], [8, 18], [-14, -22], [0, -22]], o: [[0, 0], [-6, -26], [14, -22], [-8, 18]] } } }, { ty: 'fl', c: { a: 0, k: C.red }, o: { a: 0, k: 100 } }, TR()] }], { s: K([[0, [100, 100]], [10, [120, 120]], [20, [96, 96]], [30, [112, 112]], [44, [100, 100]], [60, [100, 100]]]) })])
};
/** Render all [data-lottie] elements under root (built-in name or JSON URL handled by caller). */
export function mountLotties(root, { icons = LOTTIE_ICONS } = {}) {
    let n = 0;
    (root.querySelectorAll ? root.querySelectorAll('[data-lottie]:not([data-ox-lottie])') : []).forEach(el => {
        const data = icons[el.dataset.lottie];
        if (!data) return;
        el.dataset.oxLottie = '1';
        el.__oxLottie = playLottie(el, data, { loop: el.dataset.loop !== 'false' });
        n++;
    });
    return n;
}
