/* Camera tools: business card scan (#953), face detection (#955), object recognition (#956), live camera translation (#968),
   search by image (#969). Faces are detected, never identified. */
import { esc, call, card, empty, btn, pbtn, select, area, val, win, newCanvas, ctx2d, table, download } from './util.js';
import { cameraBlock } from './core.js';

// ------------------------------------------------------------------ PURE
const PHONE = /(?:\+|00)?\d[\d\s().-]{6,}\d/g, EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, WEB = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?/gi;
const EMAIL1 = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const TITLES = /\b(ceo|cto|cfo|coo|founder|co-founder|director|manager|engineer|developer|designer|consultant|president|head|lead|officer|sales|marketing|مدير|مهندس|مطور|مصمم|مستشار|رئيس|مؤسس|مسؤول|محاسب|طبيب|دكتور|محامي|directeur|ingénieur|gérant|responsable)\b/i;
const COMPANY = /\b(inc|llc|ltd|gmbh|sarl|sa|sas|corp|co\.|company|group|technologies|solutions|شركة|مؤسسة|مجموعة|للتقنية|للحلول)\b/i;
const ADDRESS = /\b(street|st\.|road|rd\.|avenue|ave|blvd|rue|av\.|شارع|نهج|طريق|حي|عمارة|ص\.ب|p\.?o\.? box|\d{4,5}\s+[a-z\u0600-\u06ff]+)\b/i;
/** Heuristic business-card parser (OCR text → fields). */
export function parseCardText(text) {
    const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const out = { name: '', title: '', company: '', phones: [], emails: [], website: '', address: '' };
    const all = lines.join('\n');
    out.emails = Array.from(new Set(all.match(EMAIL) || []));
    out.phones = Array.from(new Set((all.replace(EMAIL, ' ').match(PHONE) || []).map(p => p.replace(/[^\d+]/g, '')).filter(p => p.replace(/\D/g, '').length >= 8)));
    const web = (all.replace(EMAIL, ' ').match(WEB) || []).find(w => !/^\d/.test(w) && /[a-z]/i.test(w));
    if (web) out.website = /^https?:/i.test(web) ? web : 'https://' + web.replace(/^www\./i, 'www.');
    const rest = lines.filter(l => !EMAIL1.test(l) && !(l.match(PHONE) && l.replace(/[^\d]/g, '').length >= 8 && l.replace(/[\d\s+().-]/g, '').length < 6) && !(web && l.includes(web.replace(/^https?:\/\//, ''))));
    for (const l of rest) {
        if (!out.title && TITLES.test(l)) { out.title = l; continue; }
        if (!out.company && COMPANY.test(l)) { out.company = l; continue; }
        if (!out.address && ADDRESS.test(l)) { out.address = l; continue; }
    }
    out.name = rest.find(l => l !== out.title && l !== out.company && l !== out.address && /^[\p{L}][\p{L}.'\s-]{2,40}$/u.test(l) && l.split(/\s+/).length <= 4) || '';
    if (!out.company && out.website) out.company = out.website.replace(/^https?:\/\/(www\.)?/i, '').split(/[./]/)[0].replace(/^\w/, c => c.toUpperCase());
    return out;
}
const vesc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
/** vCard 3.0 */
export function toVCard(c) {
    const parts = String(c.name || '').trim().split(/\s+/), last = parts.length > 1 ? parts.pop() : '', first = parts.join(' ');
    return ['BEGIN:VCARD', 'VERSION:3.0', `N:${vesc(last)};${vesc(first)};;;`, `FN:${vesc(c.name || c.company || 'Contact')}`,
        c.company ? `ORG:${vesc(c.company)}` : '', c.title ? `TITLE:${vesc(c.title)}` : '',
        ...(c.phones || []).map((p, i) => `TEL;TYPE=${i ? 'WORK' : 'CELL'},VOICE:${p}`), ...(c.emails || []).map(e => `EMAIL;TYPE=INTERNET:${e}`),
        c.website ? `URL:${c.website}` : '', c.address ? `ADR;TYPE=WORK:;;${vesc(c.address)};;;;` : '', 'END:VCARD'].filter(Boolean).join('\r\n') + '\r\n';
}
/** Normalised (0–1) or pixel boxes → clamped pixel boxes. */
export function boxesToPx(boxes, w, h) {
    return (boxes || []).map(b => {
        const r = Array.isArray(b.box) ? { x: b.box[0], y: b.box[1], w: b.box[2], h: b.box[3] } : b.box || b;
        let { x = 0, y = 0, w: bw = 0, h: bh = 0 } = r;
        if (Math.max(x, y, bw, bh) <= 1.0001) { x *= w; y *= h; bw *= w; bh *= h; }
        x = Math.max(0, Math.min(w, x)); y = Math.max(0, Math.min(h, y));
        return { ...b, x: Math.round(x), y: Math.round(y), w: Math.round(Math.max(1, Math.min(w - x, bw))), h: Math.round(Math.max(1, Math.min(h - y, bh))) };
    }).filter(b => b.w > 1 && b.h > 1);
}
/** Difference hash from a 9×8 grayscale array (row-major, 72 values) → 16-hex string. */
export function dHashFromGray(g) {
    let bits = '';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += g[y * 9 + x] > g[y * 9 + x + 1] ? '1' : '0';
    let hex = '';
    for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex;
}
export function hamming(a, b) {
    let d = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { d += x & 1; x >>= 1; } }
    return d + Math.abs(a.length - b.length) * 4;
}
export const similarity = (a, b) => Math.round((1 - hamming(a, b) / 64) * 100);
export const LANGS = [['ar', 'العربية'], ['en', 'English'], ['fr', 'Français'], ['es', 'Español'], ['de', 'Deutsch'], ['it', 'Italiano'], ['tr', 'Türkçe'], ['zh', '中文'], ['ja', '日本語']];

const HASHES = new WeakMap();

export function installCamera(P) {
    // ------------------------------------------------------------------ helpers
    P.pfShowShot = function (url) { const i = document.getElementById('pfx-shot'); if (i) { i.src = url; i.hidden = false; } const v = document.getElementById('pfx-video'); if (v && this._pfCam) v.hidden = true; return url; };
    /** Draw boxes over the shown shot (canvas sized to the image). */
    P.pfDrawBoxes = async function (url, boxes, { color = '#22c55e', label = (b) => b.label || '' } = {}) {
        const img = await this.loadImageElement(url), c = document.getElementById('pfx-overlay');
        const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, px = boxesToPx(boxes, w, h);
        if (!c) return px;
        c.width = w; c.height = h; c.hidden = false;
        const g = c.getContext('2d'); g.clearRect(0, 0, w, h); g.lineWidth = Math.max(2, w / 300); g.font = `${Math.max(12, Math.round(w / 45))}px system-ui, sans-serif`;
        for (const b of px) {
            g.strokeStyle = color; g.strokeRect(b.x, b.y, b.w, b.h);
            const t = label(b); if (!t) continue;
            const tw = g.measureText(t).width + 8, th = Math.max(14, Math.round(w / 40));
            g.fillStyle = color; g.fillRect(b.x, Math.max(0, b.y - th), tw, th); g.fillStyle = '#fff'; g.fillText(t, b.x + 4, Math.max(th - 4, b.y - 4));
        }
        return px;
    };
    P.pfClearOverlay = function () { const c = document.getElementById('pfx-overlay'); if (c) { c.hidden = true; const g = c.getContext && c.getContext('2d'); if (g) g.clearRect(0, 0, c.width, c.height); } };
    P.pfShotOrErr = async function (outId) { try { const u = await this.pfGrabImage(); this.pfShowShot(u); return u; } catch (e) { this.pfErr(e, outId); return null; } };

    // ------------------------------------------------------------------ BUSINESS CARD (#953)
    P.pfCard = function () {
        return card('مسح بطاقة عمل', cameraBlock(pbtn('fa-id-card', 'اقرأ البطاقة', call('pfCardScan'))) + `<p class="gh-muted">يستخرج الاسم والوظيفة والشركة والهواتف والبريد والموقع ← جهة اتصال vCard. يستخدم نموذج رؤية (مفتاح OpenRouter)، أو كاشف النص المدمج في المتصفح إن توفر، أو الصق النص يدوياً.</p>
                ${area('pfx-card-text', 'أو الصق نص البطاقة', '', 3)}<div class="gh-row">${btn('fa-paste', 'حلّل النص', call('pfCardFromText'))}</div><div id="pfx-card-out"></div>`, 'fa-id-card');
    };
    P.pfCardScan = async function () {
        const url = await this.pfShotOrErr('pfx-card-out'); if (!url) return null;
        this.pfBusy('pfx-card-out', 'يقرأ البطاقة…');
        let c = null;
        const ai = await this.pfAI('This is a business card photo. Return JSON: {"name":"","title":"","company":"","phones":[],"emails":[],"website":"","address":""}. Keep the original language of each field. Phones in international format when possible.', { json: true, images: [url], quiet: true });
        if (ai && typeof ai === 'object') c = { name: '', title: '', company: '', phones: [], emails: [], website: '', address: '', ...ai };
        if (!c) {
            const TD = win().TextDetector;
            if (TD) { try { const img = await this.loadImageElement(url); const res = await new TD().detect(img); c = parseCardText(res.map(r => r.rawValue).join('\n')); } catch (e) { /* unsupported */ } }
        }
        if (!c) { const el = document.getElementById('pfx-card-out'); if (el) el.innerHTML = empty('لا يوجد مفتاح OpenRouter ولا كاشف نص في المتصفح — الصق نص البطاقة في الحقل أعلاه'); return null; }
        return this.pfCardShow(c);
    };
    P.pfCardFromText = function () { return this.pfCardShow(parseCardText(val('pfx-card-text'))); };
    P.pfCardShow = function (c) {
        this._pfCardData = c;
        const el = document.getElementById('pfx-card-out');
        if (el) el.innerHTML = table(['الحقل', 'القيمة'], [['الاسم', c.name], ['الوظيفة', c.title], ['الشركة', c.company], ['الهاتف', (c.phones || []).join('، ')], ['البريد', (c.emails || []).join('، ')], ['الموقع', c.website], ['العنوان', c.address]].map(([k, v]) => [k, esc(v || '—')]))
            + `<div class="gh-row">${pbtn('fa-address-card', 'تنزيل vCard', call('pfCardDownload'))}${btn('fa-file-circle-plus', 'حفظ في المشروع', call('pfCardSave'))}${btn('fa-copy', 'نسخ', call('pfCardCopy'))}</div>`;
        return c;
    };
    const cardName = (c) => (c.name || c.company || 'contact').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
    P.pfCardDownload = function () { const c = this._pfCardData; if (!c) return null; download(this, cardName(c) + '.vcf', toVCard(c), 'text/vcard'); return true; };
    P.pfCardSave = function () { const c = this._pfCardData; if (!c) return null; const p = 'contacts/' + cardName(c) + '.vcf'; this.writeProjectFile(p, toVCard(c), 'scan'); this.showToast('✅ ' + esc(p), 'success'); return p; };
    P.pfCardCopy = function () { const c = this._pfCardData; return c ? this.copyText(toVCard(c)) : false; };

    // ------------------------------------------------------------------ FACES (#955)
    P.pfFaces = function () {
        const native = !!win().FaceDetector;
        return card('كشف الوجوه', cameraBlock(pbtn('fa-face-smile', 'اكشف الوجوه', call('pfFacesDetect')) + btn('fa-eye-slash', 'طمس الوجوه', call('pfFacesBlur'))) + `<p class="gh-muted">${native ? '✅ كاشف الوجوه المدمج في المتصفح متاح (يعمل دون إنترنت)' : 'يستخدم نموذج رؤية (لا يوجد كاشف مدمج في هذا المتصفح)'}. يحدد مواضع الوجوه فقط — لا يتعرف على هوية الأشخاص. «طمس الوجوه» مفيد لحماية الخصوصية قبل مشاركة صورة.</p><div id="pfx-faces-out"></div>`, 'fa-face-smile');
    };
    P.pfFacesFind = async function (url) {
        const FD = win().FaceDetector;
        if (FD) {
            try { const img = await this.loadImageElement(url); const r = await new FD({ fastMode: false, maxDetectedFaces: 50 }).detect(img); return { via: 'native', faces: r.map(f => ({ box: { x: f.boundingBox.x, y: f.boundingBox.y, w: f.boundingBox.width, h: f.boundingBox.height } })) }; } catch (e) { /* fall through */ }
        }
        const ai = await this.pfAI('Detect every human face in this image. Return JSON {"faces":[{"box":[x,y,w,h],"expression":"neutral|smiling|…"}]} with box values normalised 0–1 relative to image width/height. Do NOT identify who the people are.', { json: true, images: [url] });
        return { via: 'ai', faces: (ai && Array.isArray(ai.faces) ? ai.faces : []) };
    };
    P.pfFacesDetect = async function () {
        const url = await this.pfShotOrErr('pfx-faces-out'); if (!url) return null;
        this.pfBusy('pfx-faces-out', 'يبحث عن الوجوه…');
        const r = await this.pfFacesFind(url);
        const px = await this.pfDrawBoxes(url, r.faces, { color: '#f59e0b', label: (b) => b.expression ? String(b.expression) : '' });
        this._pfFaces = { url, px };
        const el = document.getElementById('pfx-faces-out'); if (el) el.innerHTML = `<p>${px.length ? `👤 ${px.length} وجه` : 'لم يُعثر على وجوه'} <small>(${r.via === 'native' ? 'كاشف مدمج' : 'نموذج رؤية'})</small></p>`;
        return px;
    };
    P.pfFacesBlur = async function () {
        if (!this._pfFaces) await this.pfFacesDetect();
        const f = this._pfFaces; if (!f || !f.px.length) return null;
        const img = await this.loadImageElement(f.url), w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        const c = newCanvas(w, h), g = ctx2d(c); g.drawImage(img, 0, 0, w, h);
        for (const b of f.px) { // pixelate: shrink then enlarge without smoothing
            const s = newCanvas(Math.max(1, b.w / 12), Math.max(1, b.h / 12)), sg = s.getContext('2d');
            sg.drawImage(c, b.x, b.y, b.w, b.h, 0, 0, s.width, s.height);
            g.imageSmoothingEnabled = false; g.drawImage(s, 0, 0, s.width, s.height, b.x, b.y, b.w, b.h);
        }
        const url = c.toDataURL('image/jpeg', 0.9);
        this.pfShowShot(url); this.pfClearOverlay();
        this._pfLastImage = url; this._pfFaces = null;
        const el = document.getElementById('pfx-faces-out'); if (el) el.innerHTML = `<p>✅ طُمست الوجوه</p><div class="gh-row">${btn('fa-download', 'تنزيل', call('pfDownloadShot', 'blurred.jpg'))}</div>`;
        return url;
    };
    P.pfDownloadShot = async function (name = 'image.jpg') { const u = this._pfLastImage; if (!u) return null; const b = await (await fetch(u)).blob(); this.downloadBlob(b, name); return true; };

    // ------------------------------------------------------------------ OBJECTS (#956)
    P.pfObjects = function () {
        return card('التعرف على الأشياء', cameraBlock(pbtn('fa-shapes', 'تعرّف', call('pfObjectsDetect'))) + '<p class="gh-muted">يحدد الأشياء في الصورة مع مربعات وأسماء بالعربية (نموذج رؤية).</p><div id="pfx-obj-out"></div>', 'fa-shapes');
    };
    P.pfObjectsDetect = async function () {
        const url = await this.pfShotOrErr('pfx-obj-out'); if (!url) return null;
        this.pfBusy('pfx-obj-out', 'يتعرف…');
        const ai = await this.pfAI('List the distinct objects visible in this image. Return JSON {"objects":[{"label":"Arabic name","label_en":"English","confidence":0-1,"box":[x,y,w,h]}],"scene":"one Arabic sentence"} with boxes normalised 0–1. Max 25 objects.', { json: true, images: [url] });
        const objs = ai && Array.isArray(ai.objects) ? ai.objects : [];
        const px = await this.pfDrawBoxes(url, objs.filter(o => o.box), { label: (b) => b.label || b.label_en || '' });
        const el = document.getElementById('pfx-obj-out');
        if (el) el.innerHTML = ai ? `${ai.scene ? `<p>${esc(ai.scene)}</p>` : ''}${objs.length ? table(['الشيء', 'English', 'الثقة'], objs.map(o => [esc(o.label || ''), esc(o.label_en || ''), o.confidence != null ? Math.round(o.confidence * 100) + '%' : '—'])) : empty('لم يُتعرف على أشياء')}` : '';
        this._pfObjects = objs;
        return { objects: objs, px };
    };

    // ------------------------------------------------------------------ CAMERA TRANSLATE (#968)
    P.pfCamTranslate = function () {
        const live = !!this._pfCamLiveT;
        return card('ترجمة فورية بالكاميرا', cameraBlock(pbtn('fa-language', 'ترجم', call('pfCamTranslateRun')) + btn(live ? 'fa-stop' : 'fa-circle-play', live ? 'إيقاف المباشر' : 'مباشر (كل 5 ث)', call('pfCamLive'))) + `
                ${select('pfx-ct-lang', 'إلى', LANGS, this.settings.camTranslateLang || 'ar', `onchange="app.pfSet('camTranslateLang', this.value)"`)}
                <p class="gh-muted">وجّه الكاميرا إلى لافتة أو قائمة طعام أو مستند: يُرسم النص المترجم فوق موضعه في الصورة. الوضع المباشر يستهلك طلباً كل 5 ثوانٍ.</p><div id="pfx-ct-out"></div>`, 'fa-language');
    };
    P.pfCamTranslateRun = async function () {
        let url; try { url = await this.pfGrabImage(); } catch (e) { return this.pfErr(e, 'pfx-ct-out'); }
        if (!this._pfCamLiveT) this.pfShowShot(url);
        const lang = val('pfx-ct-lang') || this.settings.camTranslateLang || 'ar', name = (LANGS.find(l => l[0] === lang) || [, lang])[1];
        if (!this._pfCamLiveT) this.pfBusy('pfx-ct-out', 'يقرأ ويترجم…');
        const ai = await this.pfAI(`Read all text blocks in this image and translate each into ${name} (${lang}). Return JSON {"source_lang":"","blocks":[{"text":"original","translation":"…","box":[x,y,w,h]}]} with boxes normalised 0–1.`, { json: true, images: [url] });
        const blocks = ai && Array.isArray(ai.blocks) ? ai.blocks : [];
        await this.pfDrawBoxes(url, blocks.filter(b => b.box), { color: '#2563eb', label: (b) => String(b.translation || '').slice(0, 60) });
        const el = document.getElementById('pfx-ct-out');
        if (el) el.innerHTML = ai ? (blocks.length ? `<p class="gh-muted">اللغة المكتشفة: ${esc(ai.source_lang || '?')}</p>` + table(['الأصل', 'الترجمة'], blocks.map(b => [esc(b.text || ''), `<b dir="auto">${esc(b.translation || '')}</b>`])) : empty('لا يوجد نص واضح')) : '';
        this._pfCT = blocks;
        return blocks;
    };
    P.pfCamLive = async function () {
        if (this._pfCamLiveT) { clearInterval(this._pfCamLiveT); this._pfCamLiveT = null; if (this._pfx && this._pfx.sec === 'translate') this.pfRefresh(); return false; }
        if (!this._pfCam) { try { await this.pfCameraStart(); } catch (e) { return this.pfErr(e, 'pfx-ct-out'); } }
        let busy = false;
        this._pfCamLiveT = setInterval(async () => {
            if (busy || !document.getElementById('pfx-ct-out')) { if (!document.getElementById('pfx-ct-out')) { clearInterval(this._pfCamLiveT); this._pfCamLiveT = null; } return; }
            busy = true; try { this._pfLastImage = null; await this.pfCamTranslateRun(); } finally { busy = false; }
        }, 5000);
        const stopCam = this._pfStop;
        this._pfStop = () => { clearInterval(this._pfCamLiveT); this._pfCamLiveT = null; if (stopCam) stopCam(); };
        this.showToast('🔴 ترجمة مباشرة كل 5 ثوانٍ', 'info');
        return true;
    };

    // ------------------------------------------------------------------ SEARCH BY IMAGE (#969)
    P.pfImageSearch = function () {
        const n = Array.from(this.virtualProjectFiles.values()).filter(f => f && typeof f.dataUrl === 'string' && /^data:image\//.test(f.dataUrl)).length;
        return card('بحث بالصورة', cameraBlock(pbtn('fa-magnifying-glass', 'ابحث', call('pfImageSearchRun'))) + `<p class="gh-muted">① صور مشابهة بصرياً بين ${n} صورة في المشروع (بصمة dHash — دون إنترنت). ② وصف الصورة بالذكاء ثم البحث عن كلماتها في محادثاتك وملفاتك.</p><div id="pfx-is-out"></div>`, 'fa-images');
    };
    P.pfImageHash = async function (url) {
        const img = await this.loadImageElement(url), c = newCanvas(9, 8), g = ctx2d(c);
        g.drawImage(img, 0, 0, 9, 8);
        const d = g.getImageData(0, 0, 9, 8).data, gray = [];
        for (let i = 0; i < 72; i++) gray.push(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
        return dHashFromGray(gray);
    };
    P.pfSimilarImages = async function (url, max = 8) {
        const h = await this.pfImageHash(url), out = [];
        for (const [path, f] of this.virtualProjectFiles) {
            if (!f || typeof f.dataUrl !== 'string' || !/^data:image\//.test(f.dataUrl)) continue;
            try { let fh = HASHES.get(f); if (!fh) { fh = await this.pfImageHash(f.dataUrl); HASHES.set(f, fh); } out.push({ path, sim: similarity(h, fh), dataUrl: f.dataUrl }); } catch (e) { /* undecodable */ }
        }
        return out.sort((a, b) => b.sim - a.sim).slice(0, max);
    };
    P.pfImageSearchRun = async function () {
        const url = await this.pfShotOrErr('pfx-is-out'); if (!url) return null;
        this.pfBusy('pfx-is-out', 'يبحث…');
        const similar = await this.pfSimilarImages(url).catch(() => []);
        const ai = await this.pfAI('Describe this image for search. Return JSON {"caption":"Arabic sentence","keywords":["5-10 short keywords, Arabic and English mixed"]}.', { json: true, images: [url], quiet: true });
        const kw = ai && Array.isArray(ai.keywords) ? ai.keywords.slice(0, 10) : [];
        const hits = [];
        for (const k of kw) for (const h of this.pfSearch(String(k), { sort: 'relevance' }).slice(0, 5)) if (!hits.some(x => x.doc.id === h.doc.id)) hits.push(h);
        this._pfRes = hits;
        const el = document.getElementById('pfx-is-out');
        if (el) el.innerHTML = card('صور مشابهة', similar.length ? `<div class="pfx-thumbs">${similar.map(s => `<button class="pfx-thumb" onclick="${call('openFileFromSearch', s.path)}" title="${esc(s.path)}"><img src="${esc(s.dataUrl)}" alt=""><small>${s.sim}%</small></button>`).join('')}</div>` : empty('لا صور في المشروع للمقارنة'), 'fa-images')
            + card('من محادثاتك وملفاتك', ai ? `<p>${esc(ai.caption || '')}</p><div class="gh-row pfx-chips">${kw.map(k => `<span class="gh-chip">${esc(k)}</span>`).join('')}</div>${hits.length ? hits.slice(0, 15).map((h, i) => `<button class="pfx-hit" onclick="${call('pfOpenResult', i)}"><i class="fa-solid fa-magnifying-glass"></i><div><b>${esc(h.doc.title)}</b><small>${esc(String(h.doc.text).slice(0, 120))}</small></div></button>`).join('') : empty('لا نتائج مطابقة')}` : empty('وصف الصورة يتطلب مفتاح OpenRouter'), 'fa-comments');
        return { similar, keywords: kw, hits };
    };
}
