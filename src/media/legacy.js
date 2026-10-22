/* Image editor + recorder — moved from the main bundle (Sprint 4b, ideas #535 #548 #581 #661-#663 #671 #673)
   into the lazy media chunk in Sprint 10 to make room under the 250 KB budget. Behaviour is unchanged. */
import { win } from './shared.js';

export function installLegacy(P) {
    const newCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const canvasToBlob = (c, type, q) => new Promise(res => { if (c.toBlob) c.toBlob(b => res(b), type, q); else res(null); });

    /** Run the edit pipeline: orient (rotate/flip) → crop → resize + filters → text overlay. */
    P.renderImagePipeline = function (st, { forCrop = false } = {}) {
        const img = st.img;
        const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
        const rot = ((st.rotate % 360) + 360) % 360;
        const ow = rot % 180 ? sh : sw, oh = rot % 180 ? sw : sh;
        const o = newCanvas(ow, oh);
        const octx = o.getContext('2d');
        if (!octx) throw new Error('المتصفح لا يدعم Canvas');
        octx.save();
        octx.translate(ow / 2, oh / 2);
        octx.rotate(rot * Math.PI / 180);
        octx.scale(st.flipH ? -1 : 1, st.flipV ? -1 : 1);
        octx.drawImage(img, -sw / 2, -sh / 2);
        octx.restore();
        if (forCrop) return o;
        const cr = st.crop || { x: 0, y: 0, w: ow, h: oh };
        const out = newCanvas(Math.max(1, st.width), Math.max(1, st.height));
        const ctx = out.getContext('2d');
        const f = st.filters;
        ctx.filter = `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturate}%) grayscale(${f.grayscale}%) sepia(${f.sepia}%) blur(${f.blur}px)`;
        if (st.format === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height); }
        ctx.drawImage(o, cr.x, cr.y, cr.w, cr.h, 0, 0, out.width, out.height);
        ctx.filter = 'none';
        if (st.text && st.text.value) {
            const size = Math.round(out.height * (st.text.size || 8) / 100);
            ctx.font = `bold ${size}px Cairo, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = st.text.pos === 'top' ? 'top' : st.text.pos === 'bottom' ? 'bottom' : 'middle';
            const y = st.text.pos === 'top' ? size * 0.4 : st.text.pos === 'bottom' ? out.height - size * 0.4 : out.height / 2;
            ctx.lineWidth = Math.max(2, size / 10); ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.fillStyle = st.text.color || '#ffffff';
            ctx.strokeText(st.text.value, out.width / 2, y);
            ctx.fillText(st.text.value, out.width / 2, y);
        }
        return out;
    };

    P.openImageEditor = async function (src) {
        const s = this.resolvePreviewSource(src);
        if (!s) return null;
        let url = s.dataUrl || (s.blob ? win().URL.createObjectURL(s.blob) : this.previewUrl(s));
        let img;
        try { img = await this.loadImageElement(url); } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
        const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        const fmts = this.supportedImageFormats();
        const srcType = s.mime || this.mimeForName(s.name);
        this._imgEd = {
            src, name: s.name, img, origSize: s.size || 0, rotate: 0, flipH: false, flipV: false, crop: null,
            width: w, height: h, lock: true, cropMode: false,
            filters: { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, sepia: 0, blur: 0 },
            text: { value: '', size: 8, color: '#ffffff', pos: 'bottom' },
            format: fmts.includes(srcType) ? srcType : 'image/png', quality: 0.85
        };
        const esc = (x) => this.escapeHTML(x);
        const slider = (k, label, min, max, unit = '%') => `<label class="ie-slider"><span>${label}</span><input type="range" min="${min}" max="${max}" value="${this._imgEd.filters[k]}" oninput="app.imgEdSet('filters.${k}', +this.value)"><output id="ie-out-${k}">${this._imgEd.filters[k]}${unit}</output></label>`;
        const fmtLabel = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP', 'image/avif': 'AVIF' };
        this.openPanel({
            title: `محرر الصور: ${s.name}`, icon: 'fa-sliders',
            body: `<div class="ie-layout">
                <div class="ie-stage"><canvas id="ie-canvas"></canvas><div id="ie-crop-rect" class="ie-crop-rect" style="display:none"></div></div>
                <div class="ie-controls">
                    <div class="ie-group"><b>الأبعاد</b>
                        <div class="gh-row"><input id="ie-w" type="number" min="1" class="form-input-box" value="${w}" onchange="app.imgEdSize('w', +this.value)"> × <input id="ie-h" type="number" min="1" class="form-input-box" value="${h}" onchange="app.imgEdSize('h', +this.value)">
                        <label class="gh-check"><input type="checkbox" checked onchange="app._imgEd.lock=this.checked"> 🔗</label></div>
                        <div class="gh-row">${[25, 50, 75, 100].map(p => `<button class="gh-chip" onclick="app.imgEdScale(${p})">${p}%</button>`).join('')}</div></div>
                    <div class="ie-group"><b>تحويل</b><div class="gh-row">
                        <button class="gh-chip" onclick="app.imgEdRotate(-90)" title="تدوير يسار"><i class="fa-solid fa-rotate-left"></i></button>
                        <button class="gh-chip" onclick="app.imgEdRotate(90)" title="تدوير يمين"><i class="fa-solid fa-rotate-right"></i></button>
                        <button class="gh-chip" onclick="app.imgEdSet('flipH', !app._imgEd.flipH)" title="قلب أفقي"><i class="fa-solid fa-left-right"></i></button>
                        <button class="gh-chip" onclick="app.imgEdSet('flipV', !app._imgEd.flipV)" title="قلب عمودي"><i class="fa-solid fa-up-down"></i></button>
                        <button class="gh-chip" id="ie-crop-btn" onclick="app.imgEdToggleCrop()"><i class="fa-solid fa-crop-simple"></i> قص</button></div></div>
                    <div class="ie-group"><b>فلاتر</b>${slider('brightness', 'السطوع', 0, 200)}${slider('contrast', 'التباين', 0, 200)}${slider('saturate', 'التشبع', 0, 200)}${slider('grayscale', 'رمادي', 0, 100)}${slider('sepia', 'سيبيا', 0, 100)}${slider('blur', 'تمويه', 0, 20, 'px')}
                        <div class="gh-row"><button class="gh-chip" onclick="app.imgEdReset()">إعادة ضبط</button></div></div>
                    <div class="ie-group"><b>نص على الصورة</b>
                        <input class="form-input-box" placeholder="اكتب نصاً..." oninput="app.imgEdSet('text.value', this.value)">
                        <div class="gh-row"><input type="color" value="#ffffff" oninput="app.imgEdSet('text.color', this.value)">
                        <select class="form-input-box" style="width:auto" onchange="app.imgEdSet('text.pos', this.value)"><option value="top">أعلى</option><option value="middle">وسط</option><option value="bottom" selected>أسفل</option></select>
                        <input type="range" min="3" max="25" value="8" oninput="app.imgEdSet('text.size', +this.value)" title="الحجم"></div></div>
                    <div class="ie-group"><b>التصدير</b><div class="gh-row">
                        <select id="ie-format" class="form-input-box" style="width:auto" onchange="app.imgEdSet('format', this.value)">${fmts.map(f => `<option value="${f}" ${f === this._imgEd.format ? 'selected' : ''}>${fmtLabel[f]}</option>`).join('')}</select>
                        <input type="range" min="10" max="100" value="85" oninput="app.imgEdSet('quality', +this.value / 100)" title="الجودة"><output id="ie-q">85%</output></div>
                        <div id="ie-size" class="ie-size"></div></div>
                </div></div>`
        });
        this.setPanelFooter(`<button class="sidebar-btn-util gh-btn" onclick="app.imgEdBatch()" title="تطبيق الصيغة والجودة والحد الأقصى للعرض على كل الصور المرفقة"><i class="fa-solid fa-layer-group"></i> على كل الصور المرفقة</button>
            <span class="gh-spacer"></span>
            <button class="sidebar-btn-util gh-btn" onclick="app.imgEdExport('download')"><i class="fa-solid fa-download"></i> تحميل</button>
            <button class="sidebar-btn-util gh-btn" onclick="app.imgEdExport('project')"><i class="fa-solid fa-folder-plus"></i> حفظ في المشروع</button>
            <button class="btn-new-thread gh-btn" onclick="app.imgEdExport('attach')"><i class="fa-solid fa-paperclip"></i> ${s.attachmentIndex !== undefined ? 'استبدال المرفق' : 'إرفاق بالمحادثة'}</button>`);
        this.bindCropEvents();
        this.imgEdRender();
        return this._imgEd;
    };

    P.imgEdSet = function (key, value) {
        const st = this._imgEd;
        if (!st) return;
        const parts = key.split('.');
        let o = st;
        for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
        o[parts[parts.length - 1]] = value;
        if (parts[0] === 'filters') { const out = document.getElementById('ie-out-' + parts[1]); if (out) out.textContent = value + (parts[1] === 'blur' ? 'px' : '%'); }
        if (key === 'quality') { const q = document.getElementById('ie-q'); if (q) q.textContent = Math.round(value * 100) + '%'; }
        this.imgEdRender();
    };
    P.imgEdBaseDims = function () {
        const st = this._imgEd;
        const sw = st.img.naturalWidth || st.img.width, sh = st.img.naturalHeight || st.img.height;
        const ow = st.rotate % 180 ? sh : sw, oh = st.rotate % 180 ? sw : sh;
        return st.crop ? { w: Math.round(st.crop.w), h: Math.round(st.crop.h) } : { w: ow, h: oh };
    };
    P.imgEdSize = function (which, v) {
        const st = this._imgEd;
        if (!v || v < 1) return;
        const base = this.imgEdBaseDims();
        if (which === 'w') { st.width = Math.round(v); if (st.lock) st.height = Math.max(1, Math.round(v * base.h / base.w)); }
        else { st.height = Math.round(v); if (st.lock) st.width = Math.max(1, Math.round(v * base.w / base.h)); }
        this.imgEdSyncInputs();
        this.imgEdRender();
    };
    P.imgEdScale = function (pct) { const b = this.imgEdBaseDims(); const st = this._imgEd; st.width = Math.max(1, Math.round(b.w * pct / 100)); st.height = Math.max(1, Math.round(b.h * pct / 100)); this.imgEdSyncInputs(); this.imgEdRender(); };
    P.imgEdSyncInputs = function () { const st = this._imgEd; const w = document.getElementById('ie-w'), h = document.getElementById('ie-h'); if (w) w.value = st.width; if (h) h.value = st.height; };
    P.imgEdRotate = function (deg) {
        const st = this._imgEd;
        st.rotate = (((st.rotate + deg) % 360) + 360) % 360;
        st.crop = null;
        [st.width, st.height] = [st.height, st.width];
        this.imgEdSyncInputs();
        this.imgEdRender();
    };
    P.imgEdReset = function () {
        const st = this._imgEd;
        Object.assign(st.filters, { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, sepia: 0, blur: 0 });
        document.querySelectorAll('.ie-slider input').forEach(inp => { const k = /filters\.(\w+)/.exec(inp.getAttribute('oninput'))[1]; inp.value = st.filters[k]; const out = document.getElementById('ie-out-' + k); if (out) out.textContent = st.filters[k] + (k === 'blur' ? 'px' : '%'); });
        this.imgEdRender();
    };
    P.imgEdRender = function () {
        const st = this._imgEd;
        const canvas = document.getElementById('ie-canvas');
        if (!st || !canvas) return;
        clearTimeout(this._imgEdTimer);
        this._imgEdTimer = setTimeout(async () => {
            try {
                const src = st.cropMode ? this.renderImagePipeline(st, { forCrop: true }) : this.renderImagePipeline(st);
                canvas.width = src.width; canvas.height = src.height;
                const ctx = canvas.getContext('2d');
                if (ctx) ctx.drawImage(src, 0, 0);
                if (!st.cropMode) {
                    const blob = await canvasToBlob(src, st.format, st.quality);
                    st.lastBlob = blob;
                    const el = document.getElementById('ie-size');
                    if (el && blob) {
                        const diff = st.origSize ? Math.round((1 - blob.size / st.origSize) * 100) : null;
                        el.innerHTML = `${st.width}×${st.height} • <b>${this.fmtBytes(blob.size)}</b>${st.origSize ? ` (الأصل ${this.fmtBytes(st.origSize)}${diff !== null ? ` • ${diff >= 0 ? '−' + diff : '+' + (-diff)}%` : ''})` : ''}`;
                    }
                }
            } catch (e) {
                const el = document.getElementById('ie-size');
                if (el) el.innerHTML = `<span class="text-red">${this.escapeHTML(e.message)}</span>`;
            }
        }, 40);
    };
    P.imgEdToggleCrop = function () {
        const st = this._imgEd;
        if (st.cropMode && st._pendingCrop) this.imgEdApplyCrop(st._pendingCrop);
        st.cropMode = !st.cropMode;
        st._pendingCrop = null;
        const rect = document.getElementById('ie-crop-rect'); if (rect) rect.style.display = 'none';
        const btn = document.getElementById('ie-crop-btn');
        if (btn) btn.innerHTML = st.cropMode ? '<i class="fa-solid fa-check"></i> تطبيق القص' : '<i class="fa-solid fa-crop-simple"></i> قص';
        document.querySelector('.ie-stage')?.classList.toggle('cropping', st.cropMode);
        this.imgEdRender();
    };
    /** Apply a crop rectangle given in oriented-image pixels. */
    P.imgEdApplyCrop = function (r) {
        const st = this._imgEd;
        const sw = st.img.naturalWidth || st.img.width, sh = st.img.naturalHeight || st.img.height;
        const ow = st.rotate % 180 ? sh : sw, oh = st.rotate % 180 ? sw : sh;
        const x = Math.max(0, Math.min(ow - 1, Math.round(Math.min(r.x, r.x + r.w))));
        const y = Math.max(0, Math.min(oh - 1, Math.round(Math.min(r.y, r.y + r.h))));
        const w = Math.max(1, Math.min(ow - x, Math.round(Math.abs(r.w))));
        const h = Math.max(1, Math.min(oh - y, Math.round(Math.abs(r.h))));
        st.crop = { x, y, w, h };
        st.width = w; st.height = h;
        this.imgEdSyncInputs();
        return st.crop;
    };
    P.bindCropEvents = function () {
        const canvas = document.getElementById('ie-canvas'), rect = document.getElementById('ie-crop-rect');
        if (!canvas || !rect) return;
        let start = null;
        const toImg = (e) => { const b = canvas.getBoundingClientRect(); const sx = canvas.width / (b.width || 1), sy = canvas.height / (b.height || 1); return { x: (e.clientX - b.left) * sx, y: (e.clientY - b.top) * sy, cx: e.clientX - b.left, cy: e.clientY - b.top }; };
        canvas.addEventListener('pointerdown', (e) => { if (!this._imgEd?.cropMode) return; start = toImg(e); canvas.setPointerCapture?.(e.pointerId); rect.style.display = 'block'; });
        canvas.addEventListener('pointermove', (e) => {
            if (!start) return;
            const p = toImg(e);
            const b = canvas.getBoundingClientRect(), stage = canvas.parentElement.getBoundingClientRect();
            Object.assign(rect.style, { left: (Math.min(start.cx, p.cx) + b.left - stage.left) + 'px', top: (Math.min(start.cy, p.cy) + b.top - stage.top) + 'px', width: Math.abs(p.cx - start.cx) + 'px', height: Math.abs(p.cy - start.cy) + 'px' });
            this._imgEd._pendingCrop = { x: start.x, y: start.y, w: p.x - start.x, h: p.y - start.y };
        });
        canvas.addEventListener('pointerup', () => { start = null; });
    };
    P.imgEdExport = async function (target) {
        const st = this._imgEd;
        if (!st) return null;
        const out = this.renderImagePipeline(st);
        const blob = await canvasToBlob(out, st.format, st.quality);
        if (!blob) { this.showToast('تعذر إنشاء الصورة', 'error'); return null; }
        const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif' }[st.format] || 'png';
        const name = st.name.replace(/\.[^.]+$/, '') + '-edited.' + ext;
        if (target === 'download') { this.downloadBlob(blob, name); return blob; }
        const dataUrl = await this.blobToDataUrl(blob);
        if (target === 'project') {
            const p = this.uniqueProjectPath(`images/${name}`);
            this.virtualProjectFiles.set(p, { dataUrl, binary: true, size: blob.size, mime: st.format, lang: ext, timestamp: Date.now() });
            this.showToast(`🖼️ تم الحفظ في ${this.escapeHTML(p)}`, 'success');
            return p;
        }
        const idx = st.src.attachment;
        const att = { name: this.uniqueAttachmentName(name), base64: dataUrl, isImage: true, size: blob.size, mime: st.format };
        if (idx !== undefined && this.currentAttachments[idx]) this.currentAttachments[idx] = { ...att, name: name };
        else this.currentAttachments.push(att);
        this.renderAttachmentTray();
        this.closeModals();
        this.showToast(`📎 ${idx !== undefined ? 'تم استبدال المرفق' : 'تم إرفاق الصورة'} (${this.fmtBytes(blob.size)})`, 'success');
        return att;
    };
    /** Convert every attached image to the current format/quality, capping the long side at the current width. */
    P.imgEdBatch = async function () {
        const st = this._imgEd;
        const imgs = this.currentAttachments.map((a, i) => [a, i]).filter(([a]) => a.isImage && a.base64);
        if (!imgs.length) { this.showToast('لا توجد صور مرفقة', 'warning'); return 0; }
        const maxSide = Math.max(st.width, st.height);
        let before = 0, after = 0, n = 0;
        for (const [a, i] of imgs) {
            try {
                const img = await this.loadImageElement(a.base64);
                const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
                const { w, h } = this.fitDimensions(w0, h0, maxSide, maxSide);
                const c = newCanvas(w, h), ctx = c.getContext('2d');
                if (st.format === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
                ctx.drawImage(img, 0, 0, w, h);
                const blob = await canvasToBlob(c, st.format, st.quality);
                if (!blob) continue;
                const ext = st.format.split('/')[1].replace('jpeg', 'jpg');
                before += a.size || Math.round(a.base64.length * 0.75);
                after += blob.size;
                this.currentAttachments[i] = { ...a, base64: await this.blobToDataUrl(blob), size: blob.size, mime: st.format, name: a.name.replace(/\.[^.]+$/, '') + '.' + ext };
                n++;
            } catch (e) {}
        }
        this.renderAttachmentTray();
        this.showToast(`🗜️ تم تحويل ${n} صورة: ${this.fmtBytes(before)} → ${this.fmtBytes(after)}`, 'success');
        return n;
    };

    // ------------------------------------------------------------------ RECORDER
    const REC_MODES = { audio: { icon: 'fa-microphone', label: 'تسجيل صوت' }, screen: { icon: 'fa-display', label: 'تسجيل الشاشة' }, camera: { icon: 'fa-video', label: 'الكاميرا' } };
    P.pickRecorderMime = function (kind) {
        const cands = kind === 'audio' ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'] : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
        if (typeof win().MediaRecorder === 'undefined') return null;
        return cands.find(t => (win().MediaRecorder.isTypeSupported ? win().MediaRecorder.isTypeSupported(t) : false)) || '';
    };
    P.openRecorder = function (mode = 'audio') {
        this.stopRecorderStreams();
        this._rec = { mode, state: 'idle', chunks: [], blob: null };
        this.openPanel({
            title: 'المسجل', icon: 'fa-circle-dot',
            tabs: Object.entries(REC_MODES).map(([id, m]) => ({ id, icon: m.icon, label: m.label, onclick: `app.openRecorder('${id}')` })), activeTab: mode,
            body: '<div id="rec-root" class="rec-root"></div>'
        });
        this.renderRecorder();
        return this._rec;
    };
    P.renderRecorder = function () {
        const r = this._rec, root = document.getElementById('rec-root');
        if (!r || !root) return;
        const supported = typeof win().MediaRecorder !== 'undefined' && win().navigator.mediaDevices && (r.mode === 'screen' ? win().navigator.mediaDevices.getDisplayMedia : win().navigator.mediaDevices.getUserMedia);
        if (!supported) { root.innerHTML = '<div class="gh-empty bad">المتصفح لا يدعم التسجيل هنا (يتطلب HTTPS ومتصفحاً حديثاً).</div>'; this.setPanelFooter(''); return; }
        const t = r.elapsed || 0, mm = String(Math.floor(t / 60)).padStart(2, '0'), ss = String(t % 60).padStart(2, '0');
        const live = r.mode !== 'audio' && (r.state === 'recording' || r.state === 'paused' || r.state === 'ready');
        root.innerHTML = `
            ${live ? '<video id="rec-live" class="rec-live" autoplay muted playsinline></video>' : ''}
            ${r.state === 'done' ? (r.mode === 'audio' ? `<audio id="rec-play" controls src="${this.escapeHTML(r.url)}"></audio>` : `<video id="rec-play" class="rec-live" controls playsinline src="${this.escapeHTML(r.url)}"></video>`) : ''}
            <div class="rec-timer ${r.state === 'recording' ? 'on' : ''}"><span class="rec-dot"></span>${mm}:${ss}</div>
            <div class="rec-buttons">
                ${r.state === 'idle' ? `<button class="rec-big" onclick="app.startRecording()" aria-label="ابدأ التسجيل"><i class="fa-solid ${REC_MODES[r.mode].icon}"></i></button>` : ''}
                ${r.state === 'recording' ? `<button class="sidebar-btn-util gh-btn" onclick="app.pauseRecording()"><i class="fa-solid fa-pause"></i> إيقاف مؤقت</button><button class="rec-big stop" onclick="app.stopRecording()" aria-label="إنهاء"><i class="fa-solid fa-stop"></i></button>` : ''}
                ${r.state === 'paused' ? `<button class="sidebar-btn-util gh-btn" onclick="app.pauseRecording()"><i class="fa-solid fa-play"></i> متابعة</button><button class="rec-big stop" onclick="app.stopRecording()"><i class="fa-solid fa-stop"></i></button>` : ''}
                ${r.state === 'done' ? `<button class="sidebar-btn-util gh-btn" onclick="app.openRecorder('${r.mode}')"><i class="fa-solid fa-rotate-left"></i> تسجيل جديد</button>` : ''}
                ${r.mode !== 'audio' && (r.state === 'recording' || r.state === 'paused') ? `<button class="sidebar-btn-util gh-btn" onclick="app.snapshotRecording()"><i class="fa-solid fa-camera"></i> لقطة → إرفاق</button>` : ''}
            </div>
            ${r.state === 'idle' ? `<div class="text-dim rec-hint">${r.mode === 'audio' ? 'مذكرة صوتية من الميكروفون' : r.mode === 'screen' ? 'اختر الشاشة أو النافذة أو التبويب لتسجيله (مع الصوت إن أمكن)' : 'تسجيل فيديو من الكاميرا والميكروفون'}</div>` : ''}`;
        const live2 = document.getElementById('rec-live');
        if (live2 && r.stream) { try { live2.srcObject = r.stream; } catch (e) {} }
        this.setPanelFooter(r.state === 'done' ? `<input id="rec-name" class="form-input-box" style="max-width:260px" value="${this.escapeHTML(r.name)}" dir="auto"><span class="text-dim" style="font-size:0.76rem">${this.fmtBytes(r.blob.size)}</span><span class="gh-spacer"></span>
            <button class="sidebar-btn-util gh-btn" onclick="app.saveRecording('download')"><i class="fa-solid fa-download"></i> تحميل</button>
            <button class="sidebar-btn-util gh-btn" onclick="app.saveRecording('gallery')"><i class="fa-solid fa-photo-film"></i> حفظ في المعرض</button>
            <button class="btn-new-thread gh-btn" onclick="app.saveRecording('attach')"><i class="fa-solid fa-paperclip"></i> إرفاق</button>` : '');
    };
    P.startRecording = async function () {
        const r = this._rec;
        if (!r || r.state !== 'idle') return false;
        try {
            const md = win().navigator.mediaDevices;
            r.stream = r.mode === 'audio' ? await md.getUserMedia({ audio: true })
                : r.mode === 'camera' ? await md.getUserMedia({ video: { width: { ideal: 1280 } }, audio: true })
                    : await md.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
        } catch (e) {
            const msg = e && e.name === 'NotAllowedError' ? 'تم رفض الإذن — اسمح بالوصول من إعدادات المتصفح' : e && e.name === 'NotFoundError' ? 'لا يوجد جهاز مناسب (ميكروفون/كاميرا)' : (e && e.message) || 'تعذر بدء التسجيل';
            this.showToast('❌ ' + this.escapeHTML(msg), 'error');
            return false;
        }
        const mime = this.pickRecorderMime(r.mode === 'audio' ? 'audio' : 'video');
        r.mime = mime || (r.mode === 'audio' ? 'audio/webm' : 'video/webm');
        r.recorder = new (win().MediaRecorder)(r.stream, mime ? { mimeType: mime } : undefined);
        r.chunks = [];
        r.recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) r.chunks.push(ev.data); };
        r.recorder.onstop = () => this.finishRecording();
        // The user can end screen sharing from the browser UI
        r.stream.getVideoTracks?.().forEach(t => t.addEventListener?.('ended', () => { if (r.state === 'recording' || r.state === 'paused') this.stopRecording(); }));
        r.recorder.start(1000);
        r.state = 'recording';
        r.elapsed = 0;
        r.timer = setInterval(() => { if (r.state === 'recording') { r.elapsed++; const el = document.querySelector('.rec-timer'); if (el) el.lastChild.textContent = `${String(Math.floor(r.elapsed / 60)).padStart(2, '0')}:${String(r.elapsed % 60).padStart(2, '0')}`; } }, 1000);
        this.renderRecorder();
        return true;
    };
    P.pauseRecording = function () {
        const r = this._rec;
        if (!r || !r.recorder) return;
        if (r.state === 'recording') { r.recorder.pause?.(); r.state = 'paused'; } else if (r.state === 'paused') { r.recorder.resume?.(); r.state = 'recording'; }
        this.renderRecorder();
    };
    P.stopRecording = function () { const r = this._rec; if (r && r.recorder && r.recorder.state !== 'inactive') r.recorder.stop(); };
    P.finishRecording = function () {
        const r = this._rec;
        if (!r) return;
        clearInterval(r.timer);
        this.stopRecorderStreams(true);
        r.blob = new (win().Blob)(r.chunks, { type: (r.mime || '').split(';')[0] || 'audio/webm' });
        r.url = win().URL.createObjectURL(r.blob);
        const ext = /mp4/.test(r.mime) ? (r.mode === 'audio' ? 'm4a' : 'mp4') : /ogg/.test(r.mime) ? 'ogg' : 'webm';
        const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
        r.name = `${{ audio: 'voice-memo', screen: 'screen', camera: 'camera' }[r.mode]}-${stamp}.${ext}`;
        r.state = 'done';
        this.renderRecorder();
    };
    P.stopRecorderStreams = function (keepState) {
        const r = this._rec;
        if (!r) return;
        if (r.stream) { r.stream.getTracks().forEach(t => t.stop()); r.stream = null; }
        if (!keepState) { clearInterval(r.timer); if (r.recorder && r.recorder.state !== 'inactive') { r.recorder.onstop = null; try { r.recorder.stop(); } catch (e) {} } }
    };
    P.snapshotRecording = async function () {
        const v = document.getElementById('rec-live');
        if (!v || !v.videoWidth) { this.showToast('الفيديو غير جاهز بعد', 'warning'); return null; }
        const c = newCanvas(v.videoWidth, v.videoHeight);
        c.getContext('2d').drawImage(v, 0, 0);
        const dataUrl = c.toDataURL('image/png');
        const att = { name: this.uniqueAttachmentName(`snapshot-${Date.now()}.png`), base64: dataUrl, isImage: true, size: Math.round(dataUrl.length * 0.75), mime: 'image/png' };
        this.currentAttachments.push(att);
        this.renderAttachmentTray();
        this.showToast('📸 تم إرفاق اللقطة — يمكن للذكاء الاصطناعي تحليلها', 'success');
        return att;
    };
    P.saveRecording = async function (target) {
        const r = this._rec;
        if (!r || !r.blob) return null;
        const name = (document.getElementById('rec-name')?.value || r.name).trim() || r.name;
        if (target === 'download') { this.downloadBlob(r.blob, name); return true; }
        if (target === 'gallery') { const item = await this.addMediaItem(r.blob, name); this.showToast('🎞️ تم الحفظ في معرض الوسائط', 'success'); return item; }
        const blobId = this.putBlob(r.blob);
        const kind = r.mode === 'audio' ? 'audio' : 'video';
        this.currentAttachments.push({ name: this.uniqueAttachmentName(name), isMedia: true, mediaKind: kind, blobId, size: r.blob.size, mime: r.blob.type, textContent: `[تسجيل ${kind === 'audio' ? 'صوتي' : 'فيديو'} مرفق: ${name} — ${this.fmtBytes(r.blob.size)}، المدة ${r.elapsed || 0} ثانية]` });
        this.renderAttachmentTray();
        this.closeModals();
        this.showToast('📎 تم إرفاق التسجيل', 'success');
        return true;
    };
}
