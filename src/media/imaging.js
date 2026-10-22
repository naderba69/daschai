/* Image studio: generation via OpenRouter Image API (#656), AI edits — background removal (#583 #657), upscale (#584 #679),
   cartoon (#676), colourise (#677), restore (#678) — with local fallbacks, meme maker (#675) + stickers (#674), raster → SVG vectoriser (#680). */
import { esc, call, btn, pbtn, card, empty, field, area, select, clamp, stemOf, makeBlob, blobBytes, bytesToDataUrl, newCanvas, ctx2d, canvasToBlob, val } from './shared.js';
import { sourcePicker, readSources } from './core.js';
import { generateImages, hasKey } from './aiio.js';

// ------------------------------------------------------------------ pure pixel helpers
/** Local background removal: flood fill from the borders over pixels close to the edge colours. Mutates rgba. */
export function removeBackgroundLocal(rgba, w, h, tol = 38, feather = 2) {
    const idx = (x, y) => y * w + x, n = w * h;
    const edge = [];
    for (let x = 0; x < w; x += Math.max(1, w >> 5)) edge.push(idx(x, 0), idx(x, h - 1));
    for (let y = 0; y < h; y += Math.max(1, h >> 5)) edge.push(idx(0, y), idx(w - 1, y));
    const refs = edge.map(i => [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
    const near = (i) => { const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2]; return refs.some(c => Math.abs(c[0] - r) + Math.abs(c[1] - g) + Math.abs(c[2] - b) < tol * 3 / 2 * 2); };
    const bg = new Uint8Array(n), stack = [];
    for (let x = 0; x < w; x++) stack.push(idx(x, 0), idx(x, h - 1));
    for (let y = 0; y < h; y++) stack.push(idx(0, y), idx(w - 1, y));
    while (stack.length) {
        const i = stack.pop();
        if (bg[i] || !near(i)) continue;
        bg[i] = 1;
        const x = i % w, y = (i / w) | 0;
        if (x > 0) stack.push(i - 1); if (x < w - 1) stack.push(i + 1); if (y > 0) stack.push(i - w); if (y < h - 1) stack.push(i + w);
    }
    let removed = 0;
    for (let i = 0; i < n; i++) {
        if (bg[i]) { rgba[i * 4 + 3] = 0; removed++; continue; }
        if (feather) {
            const x = i % w, y = (i / w) | 0; let c = 0, t = 0;
            for (let dy = -feather; dy <= feather; dy++) for (let dx = -feather; dx <= feather; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; t++; if (bg[idx(xx, yy)]) c++; }
            if (c) rgba[i * 4 + 3] = Math.round(rgba[i * 4 + 3] * (1 - c / t * 0.8));
        }
    }
    return removed / n;
}
export function medianFilter(rgba, w, h) {
    const src = rgba.slice(), win = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) for (let c = 0; c < 3; c++) {
        win.length = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) win.push(src[((y + dy) * w + x + dx) * 4 + c]);
        win.sort((a, b) => a - b);
        rgba[(y * w + x) * 4 + c] = win[4];
    }
    return rgba;
}
export function autoLevels(rgba) {
    const lo = [255, 255, 255], hi = [0, 0, 0], hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)], n = rgba.length / 4;
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) hist[c][rgba[i * 4 + c]]++;
    for (let c = 0; c < 3; c++) { let s = 0; for (let v = 0; v < 256; v++) { s += hist[c][v]; if (s > n * 0.005) { lo[c] = v; break; } } s = 0; for (let v = 255; v >= 0; v--) { s += hist[c][v]; if (s > n * 0.005) { hi[c] = v; break; } } }
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) rgba[i * 4 + c] = clamp(Math.round((rgba[i * 4 + c] - lo[c]) * 255 / Math.max(1, hi[c] - lo[c])), 0, 255);
    return rgba;
}
export function unsharp(rgba, w, h, amount = 0.6) {
    const src = rgba.slice();
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) for (let c = 0; c < 3; c++) {
        const i = (y * w + x) * 4 + c;
        const blur = (src[i - 4] + src[i + 4] + src[i - w * 4] + src[i + w * 4] + src[i] * 4) / 8;
        rgba[i] = clamp(Math.round(src[i] + (src[i] - blur) * amount * 2), 0, 255);
    }
    return rgba;
}
// ------------------------------------------------------------------ vectoriser (#680)
/** k-means colour palette (deterministic init). */
export function kmeansPalette(rgba, k = 8, iters = 8) {
    const n = rgba.length / 4, step = Math.max(1, Math.floor(n / 4000)), pts = [];
    for (let i = 0; i < n; i += step) if (rgba[i * 4 + 3] > 127) pts.push([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
    if (!pts.length) return [[0, 0, 0]];
    let cents = Array.from({ length: Math.min(k, pts.length) }, (_, i) => pts[Math.floor(i * pts.length / Math.min(k, pts.length))].slice());
    for (let it = 0; it < iters; it++) {
        const sum = cents.map(() => [0, 0, 0, 0]);
        pts.forEach(p => { let b = 0, bd = Infinity; cents.forEach((c, j) => { const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2; if (d < bd) { bd = d; b = j; } }); sum[b][0] += p[0]; sum[b][1] += p[1]; sum[b][2] += p[2]; sum[b][3]++; });
        cents = cents.map((c, j) => (sum[j][3] ? [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]] : c));
    }
    return cents.map(c => c.map(Math.round));
}
/** Trace region boundaries of a binary mask into closed loops of grid points (region on the left). */
export function traceMask(mask, w, h) {
    const out = new Map(), key = (x, y) => y * (w + 1) + x;
    const add = (x1, y1, x2, y2) => { const k = key(x1, y1); if (!out.has(k)) out.set(k, []); out.get(k).push([x2, y2]); };
    const m = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        if (!m(x, y - 1)) add(x, y, x + 1, y);
        if (!m(x + 1, y)) add(x + 1, y, x + 1, y + 1);
        if (!m(x, y + 1)) add(x + 1, y + 1, x, y + 1);
        if (!m(x - 1, y)) add(x, y + 1, x, y);
    }
    const loops = [];
    for (const [k0, list] of out) {
        while (list.length) {
            const start = [k0 % (w + 1), Math.floor(k0 / (w + 1))], loop = [start];
            let cur = list.pop(), guard = 0;
            while (guard++ < 1e6) {
                if (cur[0] === start[0] && cur[1] === start[1]) break;
                loop.push(cur);
                const nxt = out.get(key(cur[0], cur[1]));
                if (!nxt || !nxt.length) break;
                cur = nxt.pop();
            }
            if (loop.length > 2) loops.push(loop);
        }
    }
    return loops;
}
/** Ramer–Douglas–Peucker on a closed loop. */
export function rdp(pts, eps) {
    if (pts.length < 4) return pts;
    const dist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy; if (!l) return Math.hypot(p[0] - a[0], p[1] - a[1]); const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l, 0, 1); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
    const rec = (a, b) => { let md = 0, mi = -1; for (let i = a + 1; i < b; i++) { const d = dist(pts[i], pts[a], pts[b]); if (d > md) { md = d; mi = i; } } return md > eps ? rec(a, mi).slice(0, -1).concat(rec(mi, b)) : [pts[a], pts[b]]; };
    const half = Math.floor(pts.length / 2);
    return rec(0, half).slice(0, -1).concat(rec(half, pts.length - 1));
}
export function vectorize(rgba, w, h, { colors = 8, simplify = 0.8, minArea = 4 } = {}) {
    const pal = kmeansPalette(rgba, colors);
    const label = new Int16Array(w * h).fill(-1);
    for (let i = 0; i < w * h; i++) {
        if (rgba[i * 4 + 3] < 128) continue;
        let b = 0, bd = Infinity;
        pal.forEach((c, j) => { const d = (c[0] - rgba[i * 4]) ** 2 + (c[1] - rgba[i * 4 + 1]) ** 2 + (c[2] - rgba[i * 4 + 2]) ** 2; if (d < bd) { bd = d; b = j; } });
        label[i] = b;
    }
    const counts = pal.map((_, j) => label.reduce((n, l) => n + (l === j ? 1 : 0), 0));
    const order = pal.map((_, j) => j).sort((a, b) => counts[b] - counts[a]);
    const paths = [];
    for (const j of order) {
        if (!counts[j]) continue;
        const mask = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) mask[i] = label[i] === j ? 1 : 0;
        const d = traceMask(mask, w, h).filter(l => l.length >= minArea).map(l => rdp(l, simplify)).filter(l => l.length > 2).map(l => 'M' + l.map(p => p.join(' ')).join('L') + 'Z').join('');
        if (d) paths.push(`<path fill="rgb(${pal[j].join(',')})" fill-rule="evenodd" d="${d}"/>`);
    }
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="geometricPrecision">${paths.join('')}</svg>`, palette: pal, paths: paths.length };
}

export const STYLES = [['', 'بدون'], ['photorealistic, 85mm, natural light', 'واقعي'], ['digital illustration, vibrant', 'رسم رقمي'], ['3D render, Pixar style', 'ثلاثي الأبعاد'], ['anime style', 'أنمي'], ['watercolor painting', 'ألوان مائية'], ['flat vector illustration, minimal', 'فيكتور مسطح'], ['isometric pixel art', 'بكسل آرت'], ['product photo on white background, studio lighting', 'صورة منتج'], ['app icon, rounded square, glossy', 'أيقونة تطبيق']];
export const AI_EDITS = {
    bg: { label: 'إزالة الخلفية', prompt: 'Remove the background completely. Keep the main subject exactly as it is, with clean edges. Output the subject on a fully transparent background.', background: 'transparent' },
    upscale: { label: 'تكبير ×4 بالذكاء', prompt: 'Upscale this image to a much higher resolution. Enhance fine details, textures and sharpness while keeping the content, composition and colours identical.', resolution: '4K' },
    cartoon: { label: 'تحويل لكارتون', prompt: 'Redraw this image as a high-quality cartoon illustration ({style}). Keep the same composition, pose, identity and colours.' },
    colorize: { label: 'تلوين صورة قديمة', prompt: 'Colorize this black-and-white photo with realistic, historically plausible natural colours. Keep every detail and the identity of people unchanged.' },
    restore: { label: 'استعادة صورة تالفة', prompt: 'Restore this damaged old photo: remove scratches, tears, dust, stains and noise, recover faded areas and sharpen softly. Keep identity and composition unchanged.' }
};
export const STICKERS = ['😂', '😍', '🔥', '👍', '🎉', '💯', '😎', '🤔', '❤️', '⭐', '🚀', '💡', '✅', '❌', '👀', '🙏', '💪', '🐱', '🌟', '🏆', '😭', '🤯', '🥳', '👑'];

export function installImaging(P) {
    const srcImg = async (app, id) => { const [f] = await readSources(app, id); if (!f) { app.showToast('اختر صورة', 'warning'); return null; } return { ...f, dataUrl: bytesToDataUrl(f.bytes, f.mime || 'image/png') }; };
    const showMany = (app, outs, targetId = 'fmx-img-out') => {
        app._fmxOuts = outs;
        const el = document.getElementById(targetId);
        if (el) el.innerHTML = `<div class="fmx-img-grid">${outs.map((o, i) => `<div class="fmx-img-cell" data-img="${i}"><img src="${esc(win2().URL.createObjectURL(o.blob))}" alt=""><div class="gh-row">${btn('fa-download', '', call('fmxSaveOutAt', i, 'download'), 'gh-chip')}${btn('fa-folder-plus', '', call('fmxSaveOutAt', i, 'project'), 'gh-chip')}${btn('fa-photo-film', '', call('fmxSaveOutAt', i, 'gallery'), 'gh-chip')}${btn('fa-paperclip', '', call('fmxSaveOutAt', i, 'attach'), 'gh-chip')}${btn('fa-sliders', '', call('fmxEditOut', i), 'gh-chip')}</div></div>`).join('')}</div>`;
    };
    const win2 = () => (typeof window !== 'undefined' ? window : globalThis);
    P.fmxSaveOutAt = function (i, target) { return this.fmxSaveOut(target, (this._fmxOuts || [])[i]); };
    P.fmxEditOut = async function (i) { const o = (this._fmxOuts || [])[i]; if (!o) return; return this.openImageEditor({ dataUrl: bytesToDataUrl(await blobBytes(o.blob), o.blob.type || 'image/png'), name: o.name }); };

    // ---- generate (#656)
    P.fmxImgGenerate = function () {
        return card('توليد صور بالذكاء الاصطناعي', `${area('fmx-ig-prompt', 'الوصف', '', 3, 'dir="auto" placeholder="قطة رائد فضاء تطفو فوق مدينة تونس ليلاً"')}
            <div class="fmx-grid4">${select('fmx-ig-style', 'النمط', STYLES, '')}${select('fmx-ig-aspect', 'الأبعاد', ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'], '1:1')}${select('fmx-ig-res', 'الدقة', ['512', '1K', '2K', '4K'], '1K')}${select('fmx-ig-n', 'العدد', ['1', '2', '3', '4'], '1')}</div>
            <div class="fmx-grid2">${field('fmx-ig-model', 'النموذج', this.settings.imageModel || 'google/gemini-2.5-flash-image', 'dir="ltr" list="fmx-ig-models"')}<label class="fmx-field"><span>صور مرجعية (اختياري)</span><input id="fmx-ig-refs" type="file" class="form-input-box" accept="image/*" multiple></label></div>
            <datalist id="fmx-ig-models"><option value="google/gemini-2.5-flash-image"><option value="openai/gpt-image-1"><option value="black-forest-labs/flux-1.1-pro"><option value="bytedance/seedream-4"></datalist>
            <div class="gh-row">${pbtn('fa-wand-magic-sparkles', 'توليد', 'app.fmxGenerateImage()')}${btn('fa-pen-fancy', 'تحسين الوصف', 'app.fmxEnhancePrompt()')}<span class="text-dim">عبر OpenRouter Image API — التكلفة حسب النموذج (لا تُحتسب الطلبات الفاشلة).</span></div><div id="fmx-img-out"></div>`, 'fa-image');
    };
    P.fmxEnhancePrompt = async function () {
        const el = document.getElementById('fmx-ig-prompt');
        if (!el || !el.value.trim()) return null;
        const t = await this.aiRun(`Rewrite this image prompt into a rich, specific English prompt for an image model (subject, setting, lighting, composition, style, details). Output only the prompt.\n\n${el.value}`, { kind: 'general', maxTokens: 300, source: 'fmx-prompt' });
        if (t) el.value = t.trim().replace(/^"|"$/g, '');
        return t;
    };
    P.fmxGenerateImage = async function (o) {
        const prompt = o ? o.prompt : val('fmx-ig-prompt'), style = o ? o.style || '' : val('fmx-ig-style');
        if (!prompt || !prompt.trim()) { this.showToast('اكتب وصفاً', 'warning'); return null; }
        const refs = o && o.refs ? o.refs : await Promise.all(Array.from((document.getElementById('fmx-ig-refs') || {}).files || []).slice(0, 4).map(f => this.blobToDataUrl(f)));
        this.fmxBusy('fmx-img-out', 'يولّد النموذج الصورة…');
        try {
            const model = o ? o.model : val('fmx-ig-model');
            if (model && model !== this.settings.imageModel) { this.settings.imageModel = model; if (this.persistSettings) this.persistSettings(); }
            const imgs = await generateImages(this, { prompt: style ? `${prompt}. Style: ${style}` : prompt, refs, aspect: o ? o.aspect : val('fmx-ig-aspect'), resolution: o ? o.resolution : val('fmx-ig-res'), n: +(o ? o.n || 1 : val('fmx-ig-n')), model });
            if (!imgs) { const el = document.getElementById('fmx-img-out'); if (el) el.innerHTML = empty('يلزم مفتاح OpenRouter'); return null; }
            const outs = imgs.map((im, i) => ({ blob: makeBlob([im.bytes], im.mime), name: `ai-image-${Date.now().toString(36)}-${i + 1}.${(im.mime.split('/')[1] || 'png').replace('jpeg', 'jpg')}` }));
            showMany(this, outs);
            return outs;
        } catch (e) { const el = document.getElementById('fmx-img-out'); if (el) el.innerHTML = empty('❌ ' + esc(e.message), true); return null; }
    };

    // ---- AI edits (#583 #584 #657 #676 #677 #678 #679)
    P.fmxImgAI = function () {
        return card('تحرير الصور بالذكاء الاصطناعي', `${sourcePicker(this, 'fmx-ia-src', ['image'], { accept: 'image/*' })}
            <div class="gh-row">${Object.entries(AI_EDITS).map(([id, e]) => `<button class="gh-chip" data-edit="${id}" onclick="${call('fmxAIEdit', id)}">${e.label}</button>`).join('')}</div>
            <div class="gh-row">${select('fmx-ia-cartoon', 'نمط الكارتون', [['Pixar-like 3D', 'Pixar 3D'], ['Japanese anime', 'أنمي'], ['American comic book with ink outlines', 'كوميكس'], ['flat vector cartoon', 'مسطح'], ['Studio Ghibli-like hand painted', 'مرسوم يدوياً']], 'Pixar-like 3D')}${field('fmx-ia-extra', 'تعليمات إضافية', '', 'dir="auto"')}</div>
            <div class="text-dim">بدون مفتاح OpenRouter: إزالة الخلفية والتكبير والاستعادة تعمل بخوارزميات محلية أبسط.</div><div id="fmx-img-out"></div>`, 'fa-wand-magic-sparkles');
    };
    P.fmxAIEdit = async function (op, srcArg, o = {}) {
        const s = await srcImg(this, srcArg || 'fmx-ia-src');
        if (!s) return null;
        const E = AI_EDITS[op];
        if (!hasKey(this, true)) {
            if (['bg', 'upscale', 'restore'].includes(op)) return this.fmxLocalEffect(op === 'bg' ? 'removebg' : op === 'upscale' ? 'upscale2x' : 'restore', s);
            this.showToast('هذه الأداة تحتاج مفتاح OpenRouter', 'warning'); return null;
        }
        this.fmxBusy('fmx-img-out', `${E.label}…`);
        try {
            const extra = o.extra != null ? o.extra : val('fmx-ia-extra');
            const prompt = E.prompt.replace('{style}', o.style || val('fmx-ia-cartoon') || 'Pixar-like 3D') + (extra ? ' ' + extra : '');
            const imgs = await generateImages(this, { prompt, refs: [s.dataUrl], aspect: 'auto', resolution: E.resolution || '2K', background: E.background, format: E.background ? 'png' : undefined });
            const outs = (imgs || []).map(im => ({ blob: makeBlob([im.bytes], im.mime), name: `${stemOf(s.name)}-${op}.${(im.mime.split('/')[1] || 'png').replace('jpeg', 'jpg')}` }));
            showMany(this, outs);
            return outs;
        } catch (e) { const el = document.getElementById('fmx-img-out'); if (el) el.innerHTML = empty('❌ ' + esc(e.message), true); return null; }
    };

    // ---- local effects
    P.fmxImgLocal = function () {
        return card('تأثيرات محلية (بدون إنترنت)', `${sourcePicker(this, 'fmx-il-src', ['image'], { accept: 'image/*' })}
            <div class="gh-row">${[['removebg', 'إزالة خلفية موحّدة'], ['upscale2x', 'تكبير ×2 مع حدة'], ['restore', 'إزالة ضوضاء + توازن ألوان'], ['grayscale', 'أبيض وأسود'], ['sepia', 'سيبيا'], ['invert', 'عكس'], ['pixelate', 'بكسلة'], ['sharpen', 'زيادة الحدة']].map(([id, l]) => `<button class="gh-chip" data-fx="${id}" onclick="${call('fmxLocalEffect', id)}">${l}</button>`).join('')}</div>
            ${field('fmx-il-tol', 'حساسية إزالة الخلفية', '38', 'type="range" min="5" max="120"')}<div id="fmx-out"></div>`, 'fa-sliders');
    };
    P.fmxLocalEffect = async function (fx, srcArg) {
        const s = srcArg && srcArg.dataUrl ? srcArg : await srcImg(this, srcArg || 'fmx-il-src');
        if (!s) return null;
        const img = await this.loadImageElement(s.dataUrl);
        const W0 = img.naturalWidth || img.width, H0 = img.naturalHeight || img.height, scale = fx === 'upscale2x' ? 2 : 1;
        const c = newCanvas(W0 * scale, H0 * scale), ctx = ctx2d(c);
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const d = ctx.getImageData(0, 0, c.width, c.height), px = d.data;
        if (fx === 'removebg') removeBackgroundLocal(px, c.width, c.height, +val('fmx-il-tol') || 38);
        else if (fx === 'upscale2x' || fx === 'sharpen') unsharp(px, c.width, c.height, fx === 'sharpen' ? 0.9 : 0.5);
        else if (fx === 'restore') { medianFilter(px, c.width, c.height); autoLevels(px); }
        else for (let i = 0; i < px.length; i += 4) {
            const r = px[i], g = px[i + 1], b = px[i + 2], y = 0.299 * r + 0.587 * g + 0.114 * b;
            if (fx === 'grayscale') px[i] = px[i + 1] = px[i + 2] = y;
            else if (fx === 'sepia') { px[i] = clamp(y * 1.07 + 40, 0, 255); px[i + 1] = clamp(y * 0.95 + 20, 0, 255); px[i + 2] = clamp(y * 0.75, 0, 255); }
            else if (fx === 'invert') { px[i] = 255 - r; px[i + 1] = 255 - g; px[i + 2] = 255 - b; }
        }
        if (fx === 'pixelate') { const b = Math.max(4, Math.round(c.width / 64)); for (let y = 0; y < c.height; y += b) for (let x = 0; x < c.width; x += b) { const i = (y * c.width + x) * 4; for (let yy = y; yy < Math.min(c.height, y + b); yy++) for (let xx = x; xx < Math.min(c.width, x + b); xx++) { const j = (yy * c.width + xx) * 4; px[j] = px[i]; px[j + 1] = px[i + 1]; px[j + 2] = px[i + 2]; } } }
        ctx.putImageData(d, 0, 0);
        const blob = await canvasToBlob(c, 'image/png');
        if (blob) { if (document.getElementById('fmx-out')) this.fmxOutput(blob, `${stemOf(s.name)}-${fx}.png`, { note: `${c.width}×${c.height}` }); else showMany(this, [{ blob, name: `${stemOf(s.name)}-${fx}.png` }]); }
        return { width: c.width, height: c.height, blob };
    };

    // ---- meme (#675) + stickers (#674)
    P.fmxMeme = function () {
        this._fmxMemeSt = { stickers: [], sticker: '😂', size: 96 };
        this._fmxMount = () => {
            const c = document.getElementById('fmx-meme-canvas');
            if (c) c.addEventListener('click', (e) => { const r = c.getBoundingClientRect(); this.fmxAddSticker((e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height); });
        };
        return card('صانع Meme والملصقات', `${sourcePicker(this, 'fmx-meme-src', ['image'], { accept: 'image/*' })}
            <div class="fmx-grid2">${field('fmx-meme-top', 'النص العلوي', '', 'dir="auto" oninput="app.fmxMemeRender()"')}${field('fmx-meme-bottom', 'النص السفلي', '', 'dir="auto" oninput="app.fmxMemeRender()"')}</div>
            <div class="gh-row">${btn('fa-image', 'تحميل الصورة', 'app.fmxMemeLoad()')}${btn('fa-wand-magic-sparkles', 'اقتراح نص مضحك', 'app.fmxMemeSuggest()')}${field('fmx-meme-size', 'حجم الملصق', '96', 'type="range" min="32" max="256" oninput="app._fmxMemeSt.size=+this.value"')}</div>
            <div class="fmx-stickers">${STICKERS.map(s => `<button class="fmx-sticker" onclick="${call('fmxPickSticker', s)}">${s}</button>`).join('')}</div>
            <div class="text-dim">اختر ملصقاً ثم انقر على الصورة لوضعه. ${btn('fa-rotate-left', 'تراجع', 'app._fmxMemeSt.stickers.pop();app.fmxMemeRender()', 'gh-chip')}</div>
            <canvas id="fmx-meme-canvas" class="fmx-pv-canvas" width="600" height="400"></canvas><div class="gh-row">${pbtn('fa-check', 'تصدير PNG', 'app.fmxMemeExport()')}</div><div id="fmx-out"></div>`, 'fa-face-laugh-squint');
    };
    P.fmxPickSticker = function (s) { this._fmxMemeSt.sticker = s; };
    P.fmxMemeLoad = async function (srcArg) {
        const s = await srcImg(this, srcArg || 'fmx-meme-src');
        if (!s) return null;
        this._fmxMemeSt.img = await this.loadImageElement(s.dataUrl);
        this._fmxMemeSt.name = stemOf(s.name);
        return this.fmxMemeRender();
    };
    P.fmxAddSticker = function (x, y, s) { const st = this._fmxMemeSt; st.stickers.push({ x, y, s: s || st.sticker, size: st.size }); return this.fmxMemeRender(); };
    P.fmxMemeRender = function () {
        const st = this._fmxMemeSt, c = document.getElementById('fmx-meme-canvas');
        if (!c || !st) return null;
        const img = st.img, w = img ? Math.min(1200, img.naturalWidth || img.width) : 600, h = img ? Math.round(w * (img.naturalHeight || img.height) / (img.naturalWidth || img.width)) : 400;
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = '#222'; ctx.fillRect(0, 0, w, h);
        if (img) ctx.drawImage(img, 0, 0, w, h);
        const text = (t, y, base) => {
            if (!t) return;
            let size = Math.round(w / 9);
            ctx.font = `900 ${size}px Impact, "Arial Black", Tahoma, sans-serif`;
            while (ctx.measureText(t).width > w * 0.94 && size > 14) { size -= 2; ctx.font = `900 ${size}px Impact, "Arial Black", Tahoma, sans-serif`; }
            ctx.textAlign = 'center'; ctx.textBaseline = base; ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, size / 8); ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff';
            const s = /[a-z]/i.test(t) && !/[\u0600-\u06FF]/.test(t) ? t.toUpperCase() : t;
            ctx.strokeText(s, w / 2, y); ctx.fillText(s, w / 2, y);
        };
        text(val('fmx-meme-top'), h * 0.03, 'top');
        text(val('fmx-meme-bottom'), h * 0.97, 'bottom');
        st.stickers.forEach(k => { ctx.font = `${k.size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(k.s, k.x, k.y); });
        return c;
    };
    P.fmxMemeSuggest = async function () {
        const st = this._fmxMemeSt;
        if (!st || !st.img) { this.showToast('حمّل صورة أولاً', 'warning'); return null; }
        const c = document.getElementById('fmx-meme-canvas');
        const r = await this.aiJSON('Look at this image and write a funny meme caption in the same language as the user interface (Arabic). Return {"top":"…","bottom":"…"} (short, punchy).', { images: c && c.toDataURL ? [c.toDataURL('image/jpeg', 0.7)] : undefined, kind: 'general', maxTokens: 200, source: 'fmx-meme' });
        if (r) { const t = document.getElementById('fmx-meme-top'), b = document.getElementById('fmx-meme-bottom'); if (t) t.value = r.top || ''; if (b) b.value = r.bottom || ''; this.fmxMemeRender(); }
        return r;
    };
    P.fmxMemeExport = async function () {
        const c = this.fmxMemeRender();
        if (!c) return null;
        const blob = await canvasToBlob(c, 'image/png');
        if (blob) this.fmxOutput(blob, `${(this._fmxMemeSt && this._fmxMemeSt.name) || 'meme'}-meme.png`);
        return blob;
    };

    // ---- vectorise (#680)
    P.fmxVectorize = function () {
        return card('تحويل صورة إلى SVG (فيكتور)', `${sourcePicker(this, 'fmx-vec-src', ['image'], { accept: 'image/*' })}
            <div class="fmx-grid4">${select('fmx-vec-colors', 'عدد الألوان', ['2', '4', '6', '8', '12', '16'], '8')}${select('fmx-vec-size', 'الدقة', [['128', 'منخفضة (سريع)'], ['256', 'متوسطة'], ['400', 'عالية']], '256')}${select('fmx-vec-simplify', 'التبسيط', [['0.5', 'دقيق'], ['1', 'متوازن'], ['2', 'ناعم']], '1')}</div>
            <div class="gh-row">${pbtn('fa-bezier-curve', 'تحويل', 'app.fmxVectorizeRun()')}<span class="text-dim">تكميم ألوان k-means ثم تتبع الحدود وتبسيطها (Douglas-Peucker) — محلياً بالكامل. الأنسب للشعارات والرسومات.</span></div><div id="fmx-out"></div>`, 'fa-bezier-curve');
    };
    P.fmxVectorizeRun = async function (srcArg, o = {}) {
        const s = await srcImg(this, srcArg || 'fmx-vec-src');
        if (!s) return null;
        const img = await this.loadImageElement(s.dataUrl);
        const max = +(o.size || val('fmx-vec-size') || 256), W0 = img.naturalWidth || img.width, H0 = img.naturalHeight || img.height, k = Math.min(1, max / Math.max(W0, H0));
        const c = newCanvas(W0 * k, H0 * k), ctx = ctx2d(c);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const d = ctx.getImageData(0, 0, c.width, c.height);
        const r = vectorize(d.data, c.width, c.height, { colors: +(o.colors || val('fmx-vec-colors') || 8), simplify: +(o.simplify || val('fmx-vec-simplify') || 1) });
        const svg = r.svg.replace(`width="${c.width}" height="${c.height}"`, `width="${W0}" height="${H0}"`);
        this.fmxOutput(makeBlob([svg], 'image/svg+xml'), stemOf(s.name) + '.svg', { note: `${r.palette.length} لون • ${r.paths} طبقة` });
        return { ...r, svg };
    };
}
