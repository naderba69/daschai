/* Convert & archive: ZIP/TAR/GZ create+extract, 7z/RAR detection (#536), PDF split/merge/to-images (#588 #589 #590),
   PDF analysis with images & tables (#660), lossless image compression (#582), merge images (#587), heuristic file scan (#591). */
import { zipSync, unzipSync, gzipSync, gunzipSync, zlibSync, strToU8 } from 'fflate';
/** pdf-lib (~400 KB) is split into its own lazy chunk — only fetched when a PDF tool runs. */
export const loadPdfLib = () => import('pdf-lib');
import { esc, call, btn, pbtn, card, empty, select, field, fmtBytes, baseName, extOf, stemOf, kindOf, mimeOf, entryBytes, makeBlob, blobBytes, bytesToDataUrl, fromUtf8, utf8, newCanvas, ctx2d, canvasToBlob, sha256Hex, val, filesOf, isTextEntry } from './shared.js';
import { sourcePicker, readSources } from './core.js';
import { chatParts, filePart, textPart, hasKey } from './aiio.js';

// ------------------------------------------------------------------ TAR (ustar)
export function tarCreate(files) {
    const blocks = [];
    const enc = (s, len) => { const b = new Uint8Array(len); b.set(utf8(s).subarray(0, len)); return b; };
    const oct = (n, len) => enc(n.toString(8).padStart(len - 1, '0') + '\0', len);
    for (const { path, bytes } of files) {
        const h = new Uint8Array(512);
        let name = path, prefix = '';
        if (utf8(name).length > 100) { const i = name.lastIndexOf('/', 154); prefix = name.slice(0, i); name = name.slice(i + 1); }
        h.set(enc(name, 100), 0); h.set(oct(0o644, 8), 100); h.set(oct(0, 8), 108); h.set(oct(0, 8), 116); h.set(oct(bytes.length, 12), 124); h.set(oct(Math.floor(Date.now() / 1000), 12), 136);
        h.set(utf8('        '), 148); h[156] = 48; h.set(utf8('ustar\0'), 257); h.set(utf8('00'), 263); h.set(enc(prefix, 155), 345);
        let sum = 0; for (let i = 0; i < 512; i++) sum += h[i];
        h.set(enc(sum.toString(8).padStart(6, '0') + '\0 ', 8), 148);
        blocks.push(h, bytes, new Uint8Array((512 - (bytes.length % 512)) % 512));
    }
    blocks.push(new Uint8Array(1024));
    const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
    let o = 0; blocks.forEach(b => { out.set(b, o); o += b.length; });
    return out;
}
export function tarExtract(bytes) {
    const out = [];
    const str = (a, b) => fromUtf8(bytes.subarray(a, b)).replace(/\0.*$/s, '');
    let o = 0, longName = null;
    while (o + 512 <= bytes.length) {
        if (bytes.subarray(o, o + 512).every(b => b === 0)) break;
        const name = str(o, o + 100), size = parseInt(str(o + 124, o + 136).trim() || '0', 8), type = String.fromCharCode(bytes[o + 156] || 48), prefix = str(o + 345, o + 500);
        const data = bytes.slice(o + 512, o + 512 + size);
        if (type === 'L') longName = fromUtf8(data).replace(/\0.*$/s, '');
        else if (type === '0' || type === '\0') { out.push({ path: longName || (prefix ? prefix + '/' : '') + name, bytes: data }); longName = null; }
        o += 512 + Math.ceil(size / 512) * 512;
    }
    return out;
}
/** Identify archive format by magic bytes. */
export function archiveType(bytes, name = '') {
    const b = bytes;
    if (b[0] === 0x50 && b[1] === 0x4b) return 'zip';
    if (b[0] === 0x1f && b[1] === 0x8b) return /\.(tgz|tar\.gz)$/i.test(name) ? 'tgz' : 'gz';
    if (b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf) return '7z';
    if (b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21) return 'rar';
    if (b.length > 262 && fromUtf8(b.subarray(257, 262)) === 'ustar') return 'tar';
    return null;
}
export function extractArchive(bytes, name = '') {
    const t = archiveType(bytes, name);
    if (t === 'zip') return Object.entries(unzipSync(bytes)).filter(([p]) => !p.endsWith('/')).map(([path, data]) => ({ path, bytes: data }));
    if (t === 'tar') return tarExtract(bytes);
    if (t === 'tgz') return tarExtract(gunzipSync(bytes));
    if (t === 'gz') { const inner = gunzipSync(bytes); return archiveType(inner) === 'tar' ? tarExtract(inner) : [{ path: name.replace(/\.gz$/i, '') || 'file', bytes: inner }]; }
    if (t === '7z' || t === 'rar') { const e = new Error(`صيغة ${t.toUpperCase()} مكتشفة — فكّها يحتاج مكتبة WASM تمنعها سياسة الأمان (CSP) في هذا التطبيق. حوّلها إلى ZIP ثم أعد المحاولة.`); e.unsupported = t; throw e; }
    throw new Error('ليس أرشيفاً معروفاً');
}
export function createArchive(files, format = 'zip') {
    if (format === 'zip') return zipSync(Object.fromEntries(files.map(f => [f.path, [f.bytes, { level: /\.(png|jpe?g|gif|webp|zip|gz|mp[34]|webm|woff2?)$/i.test(f.path) ? 0 : 9 }]])));
    if (format === 'tar') return tarCreate(files);
    if (format === 'tgz') return gzipSync(tarCreate(files), { level: 9 });
    if (format === 'gz') return gzipSync(files[0].bytes, { level: 9 });
    throw new Error('صيغة غير مدعومة');
}

// ------------------------------------------------------------------ PDF
/** "1-3,5,8-" → zero-based page indices */
export function parseRanges(spec, total) {
    const out = [];
    String(spec || '').split(',').map(s => s.trim()).filter(Boolean).forEach(part => {
        const m = /^(\d*)\s*-\s*(\d*)$/.exec(part);
        if (m) { const a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : total; for (let i = a; i <= Math.min(b, total); i++) out.push(i - 1); }
        else if (/^\d+$/.test(part) && +part >= 1 && +part <= total) out.push(+part - 1);
    });
    return out;
}
export async function pdfSplit(bytes, { ranges = '', every = 0 } = {}) {
    const { PDFDocument } = await loadPdfLib();
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const n = src.getPageCount();
    const groups = every > 0 ? Array.from({ length: Math.ceil(n / every) }, (_, i) => Array.from({ length: Math.min(every, n - i * every) }, (_, k) => i * every + k))
        : String(ranges).split(';').map(r => parseRanges(r, n)).filter(g => g.length);
    const out = [];
    for (const g of groups) {
        const doc = await PDFDocument.create();
        (await doc.copyPages(src, g)).forEach(p => doc.addPage(p));
        out.push({ pages: g.map(i => i + 1), bytes: await doc.save() });
    }
    return out;
}
export async function pdfMerge(list) {
    const { PDFDocument } = await loadPdfLib();
    const doc = await PDFDocument.create();
    for (const bytes of list) { const src = await PDFDocument.load(bytes, { ignoreEncryption: true }); (await doc.copyPages(src, src.getPageIndices())).forEach(p => doc.addPage(p)); }
    return doc.save();
}

// ------------------------------------------------------------------ PNG (lossless optimiser)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export const crc32 = (bytes, crc = 0xffffffff) => { for (let i = 0; i < bytes.length; i++) crc = CRC[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer); v.setUint32(0, data.length); out.set(utf8(type), 4); out.set(data, 8); v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length))); return out; };
/** Encode RGBA → smallest PNG: palette (≤256 colours) / gray / RGB / RGBA, adaptive row filters, zlib level 9. */
export function encodePNG(rgba, width, height) {
    const n = width * height;
    let opaque = true, gray = true;
    const colors = new Map();
    for (let i = 0; i < n; i++) {
        const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], a = rgba[i * 4 + 3];
        if (a !== 255) opaque = false;
        if (r !== g || g !== b) gray = false;
        if (colors.size <= 256) { const k = ((r << 24) | (g << 16) | (b << 8) | a) >>> 0; if (!colors.has(k)) colors.set(k, colors.size); }
    }
    let type, bpp, row;
    const pal = colors.size <= 256;
    if (pal) { type = 3; bpp = 1; }
    else if (gray && opaque) { type = 0; bpp = 1; }
    else if (opaque) { type = 2; bpp = 3; }
    else { type = 6; bpp = 4; }
    const raw = new Uint8Array(n * bpp);
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        if (type === 3) raw[i] = colors.get(((rgba[o] << 24) | (rgba[o + 1] << 16) | (rgba[o + 2] << 8) | rgba[o + 3]) >>> 0);
        else if (type === 0) raw[i] = rgba[o];
        else if (type === 2) { raw[i * 3] = rgba[o]; raw[i * 3 + 1] = rgba[o + 1]; raw[i * 3 + 2] = rgba[o + 2]; }
        else raw.set(rgba.subarray(o, o + 4), i * 4);
    }
    const stride = width * bpp, filtered = new Uint8Array((stride + 1) * height);
    const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
    const cand = Array.from({ length: 5 }, () => new Uint8Array(stride));
    for (let y = 0; y < height; y++) {
        row = raw.subarray(y * stride, (y + 1) * stride);
        const prev = y ? raw.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
        let best = 0, bestSum = Infinity;
        for (let f = 0; f < (type === 3 ? 1 : 5); f++) {
            const c = cand[f]; let sum = 0;
            for (let i = 0; i < stride; i++) {
                const a = i >= bpp ? row[i - bpp] : 0, b = prev[i], cc = i >= bpp ? prev[i - bpp] : 0;
                const v = (row[i] - (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? ((a + b) >> 1) : paeth(a, b, cc))) & 0xff;
                c[i] = v; sum += v < 128 ? v : 256 - v;
            }
            if (sum < bestSum) { bestSum = sum; best = f; }
        }
        filtered[y * (stride + 1)] = best;
        filtered.set(cand[best], y * (stride + 1) + 1);
    }
    const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
    v.setUint32(0, width); v.setUint32(4, height); ihdr[8] = 8; ihdr[9] = type;
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)];
    if (pal) {
        const plte = new Uint8Array(colors.size * 3), trns = new Uint8Array(colors.size);
        let hasA = false;
        for (const [k, i] of colors) { plte[i * 3] = k >>> 24; plte[i * 3 + 1] = (k >>> 16) & 255; plte[i * 3 + 2] = (k >>> 8) & 255; trns[i] = k & 255; if ((k & 255) !== 255) hasA = true; }
        parts.push(chunk('PLTE', plte));
        if (hasA) { let last = trns.length; while (last > 0 && trns[last - 1] === 255) last--; parts.push(chunk('tRNS', trns.subarray(0, last))); }
    }
    parts.push(chunk('IDAT', zlibSync(filtered, { level: 9, mem: 12 })), chunk('IEND', new Uint8Array(0)));
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; });
    return out;
}
/** Remove metadata segments (APPn except JFIF/ICC, COM) from a JPEG — lossless. */
export function stripJPEG(bytes) {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('ليس JPEG');
    const out = [bytes.subarray(0, 2)];
    let o = 2;
    while (o + 4 <= bytes.length) {
        if (bytes[o] !== 0xff) break;
        const m = bytes[o + 1];
        if (m === 0xda) { out.push(bytes.subarray(o)); break; }
        const len = (bytes[o + 2] << 8) | bytes[o + 3];
        const seg = bytes.subarray(o, o + 2 + len);
        const keep = !((m >= 0xe1 && m <= 0xef && !(m === 0xe2 && fromUtf8(seg.subarray(4, 15)).startsWith('ICC_PROFILE'))) || m === 0xfe);
        if (keep) out.push(seg);
        o += 2 + len;
    }
    const res = new Uint8Array(out.reduce((s, p) => s + p.length, 0));
    let p = 0; out.forEach(s => { res.set(s, p); p += s.length; });
    return res;
}
export function minifySVG(text) {
    return String(text).replace(/<\?xml[^>]*>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<metadata[\s\S]*?<\/metadata>/g, '').replace(/<(sodipodi|inkscape):[^>]*\/>/g, '')
        .replace(/\s(inkscape|sodipodi):[\w-]+="[^"]*"/g, '').replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').replace(/(\d+\.\d{3})\d+/g, '$1').trim();
}

// ------------------------------------------------------------------ heuristic scanner (#591)
const SIGS = [['MZ', 'ملف تنفيذي Windows (PE)'], ['\x7fELF', 'ملف تنفيذي Linux (ELF)'], ['\xcf\xfa\xed\xfe', 'ملف تنفيذي macOS'], ['\xca\xfe\xba\xbe', 'ملف Java class / Mach-O']];
const MAGIC = { png: [0x89, 0x50], jpg: [0xff, 0xd8], jpeg: [0xff, 0xd8], gif: [0x47, 0x49], pdf: [0x25, 0x50], zip: [0x50, 0x4b], docx: [0x50, 0x4b], xlsx: [0x50, 0x4b], pptx: [0x50, 0x4b], gz: [0x1f, 0x8b], webp: [0x52, 0x49], wav: [0x52, 0x49], mp3: null };
export function scanBytes(name, bytes) {
    const findings = [], add = (level, msg) => findings.push({ level, msg });
    const head = String.fromCharCode(...bytes.subarray(0, 4)), ext = extOf(name);
    const text = bytes.length < 8 * 1048576 ? fromUtf8(bytes.subarray(0, 4 * 1048576)) : '';
    if (/X5O!P%@AP\[4\\PZX54\(P\^\)7CC\)7\}\$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!\$H\+H\*/.test(text)) add('high', 'توقيع EICAR (ملف اختبار مضادات الفيروسات)');
    SIGS.forEach(([sig, label]) => { if (head.startsWith(sig) && !['exe', 'dll', 'so', 'class', 'bin', 'o'].includes(ext)) add('high', `${label} متنكر بامتداد .${ext || '؟'}`); else if (head.startsWith(sig)) add('medium', label); });
    const mg = MAGIC[ext];
    if (mg && bytes.length > 2 && (bytes[0] !== mg[0] || bytes[1] !== mg[1])) add('medium', `المحتوى لا يطابق امتداد .${ext}`);
    if (/\.(pdf|docx?|xlsx?|jpg|png|txt|mp4)\.(exe|scr|bat|cmd|js|vbs|ps1|jar|com|msi)$/i.test(name)) add('high', 'امتداد مزدوج مخادع');
    if (/\u202e/.test(name)) add('high', 'حرف عكس الاتجاه (RTLO) في الاسم لإخفاء الامتداد');
    if (ext === 'svg' && /<script|\son\w+\s*=|javascript:/i.test(text)) add('high', 'SVG يحتوي سكربت أو معالجات أحداث');
    if (['html', 'htm', 'js', 'svg'].includes(ext) && /eval\s*\(\s*(atob|unescape|String\.fromCharCode)|document\.write\s*\(\s*unescape|\\x[0-9a-f]{2}(\\x[0-9a-f]{2}){40,}/i.test(text)) add('high', 'كود مُشوَّش (eval/atob/unescape) — نمط شائع في البرمجيات الخبيثة');
    if (['js', 'ts', 'mjs', 'cjs'].includes(ext) && /child_process|require\(['"]net['"]\)|curl\s+[^|]+\|\s*(sh|bash)|powershell\s+-enc/i.test(text)) add('medium', 'تشغيل أوامر نظام/شبكة');
    if (ext === 'json' && /"(pre|post)install"\s*:\s*"[^"]*(curl|wget|node -e|powershell)/i.test(text)) add('high', 'سكربت تثبيت npm يُنزّل/يشغّل كوداً');
    if (head.startsWith('%PDF')) { ['/JavaScript', '/JS ', '/OpenAction', '/Launch', '/EmbeddedFile', '/AA '].forEach(k => { if (text.includes(k)) add(k === '/OpenAction' || k === '/AA ' ? 'low' : 'high', `PDF يحتوي ${k.trim()}`); }); }
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
        try {
            let total = 0, nested = 0;
            const entries = unzipSync(bytes, { filter: (f) => { total += f.originalSize; if (/\.(zip|rar|7z|gz)$/i.test(f.name)) nested++; if (/(^|\/)\.\.(\/|$)/.test(f.name) || f.name.startsWith('/')) add('high', `مسار خطير داخل الأرشيف (Zip Slip): ${f.name}`); if (/vbaProject\.bin$/i.test(f.name)) add('high', 'مستند Office يحتوي ماكرو VBA'); if (/\.(exe|scr|bat|cmd|vbs|ps1|js|jar|msi)$/i.test(f.name)) add('medium', `ملف تنفيذي داخل الأرشيف: ${f.name}`); return false; } });
            void entries;
            if (total / Math.max(1, bytes.length) > 100) add('high', `نسبة ضغط ${Math.round(total / bytes.length)}× — قنبلة ضغط محتملة`);
            if (nested > 3) add('low', `${nested} أرشيفات متداخلة`);
        } catch (e) { add('low', 'أرشيف تالف أو مشفر'); }
    }
    return { name, size: bytes.length, findings, risk: findings.some(f => f.level === 'high') ? 'high' : findings.some(f => f.level === 'medium') ? 'medium' : findings.length ? 'low' : 'clean' };
}

export function installConvert(P) {
    const projectFiles = (app, prefix = '') => app.projectPaths().filter(p => !prefix || p === prefix || p.startsWith(prefix + '/')).map(p => ({ path: p, bytes: entryBytes(app.virtualProjectFiles.get(p)) }));
    P.fmxZipProject = async function (prefix = '') { return createArchive(projectFiles(this, prefix), 'zip'); };
    const dirs = (app) => Array.from(new Set(app.projectPaths().map(p => p.split('/').slice(0, -1)).flatMap(a => a.map((_, i) => a.slice(0, i + 1).join('/'))))).sort();

    // ---- archives (#536)
    P.fmxArchiveTools = function () {
        return card('إنشاء أرشيف', `<div class="fmx-grid2">${select('fmx-ar-dir', 'المحتوى', [['', 'كل المشروع'], ...dirs(this).map(d => [d, '📁 ' + d])], '')}${select('fmx-ar-fmt', 'الصيغة', [['zip', 'ZIP'], ['tgz', 'TAR.GZ'], ['tar', 'TAR'], ['gz', 'GZ (ملف واحد)']], 'zip')}</div>
                <label class="fmx-field"><span>أو ملفات من جهازك</span><input id="fmx-ar-files" type="file" class="form-input-box" multiple></label><div class="gh-row">${pbtn('fa-file-zipper', 'ضغط', 'app.fmxCreateArchive()')}</div>`, 'fa-file-zipper')
            + card('فك أرشيف', `${sourcePicker(this, 'fmx-ex-src', ['archive'], { accept: '.zip,.tar,.gz,.tgz,.7z,.rar' })}<div class="gh-row">${field('fmx-ex-dir', 'إلى مجلد في المشروع', '', 'dir="ltr" placeholder="extracted/"')}${pbtn('fa-box-open', 'فك', 'app.fmxExtract()')}</div><div class="text-dim">ZIP و TAR و TAR.GZ و GZ تُفك بالكامل محلياً. 7Z و RAR تُكتشف ويُشرح البديل.</div><div id="fmx-ex-out"></div>`, 'fa-box-open')
            + '<div id="fmx-out"></div>';
    };
    P.fmxCreateArchive = async function (o) {
        const fmt = o ? o.format : val('fmx-ar-fmt');
        let files = [];
        const up = filesOf('fmx-ar-files');
        if (o && o.files) files = o.files;
        else if (up.length) for (const f of up) files.push({ path: f.webkitRelativePath || f.name, bytes: await blobBytes(f) });
        else files = projectFiles(this, o ? o.dir || '' : val('fmx-ar-dir'));
        if (!files.length) { this.showToast('لا ملفات', 'warning'); return null; }
        const bytes = createArchive(fmt === 'gz' ? files.slice(0, 1) : files, fmt);
        const base = fmt === 'gz' ? baseName(files[0].path) : ((o && o.dir) || val('fmx-ar-dir') || this.ghRepo().repo || 'archive').split('/').pop();
        const name = base + ({ zip: '.zip', tgz: '.tar.gz', tar: '.tar', gz: '.gz' })[fmt];
        const before = files.reduce((n, f) => n + f.bytes.length, 0);
        this.fmxOutput(makeBlob([bytes], mimeOf(name) || 'application/octet-stream'), name, { note: `${files.length} ملف • ${fmtBytes(before)} → ${fmtBytes(bytes.length)} (${Math.round((1 - bytes.length / Math.max(1, before)) * 100)}% أصغر)` });
        return { name, bytes };
    };
    P.fmxExtract = async function (src, dirArg) {
        const [f] = await readSources(this, src || 'fmx-ex-src');
        const el = document.getElementById('fmx-ex-out');
        if (!f) { this.showToast('اختر أرشيفاً', 'warning'); return null; }
        try {
            const entries = extractArchive(f.bytes, f.name);
            const dir = (dirArg != null ? dirArg : val('fmx-ex-dir') || stemOf(f.name).replace(/\.tar$/, '') + '/').replace(/^\/+/, '');
            this._fmxExtracted = { entries, dir };
            if (el) el.innerHTML = `<div class="text-dim">${entries.length} ملف • ${fmtBytes(entries.reduce((n, e) => n + e.bytes.length, 0))}</div><div class="fmx-list">${entries.slice(0, 300).map((e, i) => `<div class="gh-item static" data-entry="${esc(e.path)}"><i class="fa-solid fa-file text-dim"></i><div class="gh-item-main"><b dir="ltr">${esc(e.path)}</b><small>${fmtBytes(e.bytes.length)}</small></div>${btn('fa-download', '', call('fmxDownloadEntry', i), 'gh-chip')}</div>`).join('')}</div><div class="gh-row">${pbtn('fa-folder-plus', `إضافة الكل إلى ${esc(dir || 'الجذر')}`, 'app.fmxExtractToProject()')}</div>`;
            return entries;
        } catch (e) { if (el) el.innerHTML = empty('⚠️ ' + esc(e.message), true); return null; }
    };
    P.fmxDownloadEntry = function (i) { const e = this._fmxExtracted.entries[i]; this.downloadBlob(makeBlob([e.bytes], mimeOf(e.path)), baseName(e.path)); };
    P.fmxExtractToProject = function () {
        const { entries, dir } = this._fmxExtracted || {};
        if (!entries) return 0;
        let n = 0;
        for (const e of entries) {
            const path = (dir ? dir.replace(/\/?$/, '/') : '') + e.path.replace(/^(\.\.\/|\/)+/g, '');
            const k = kindOf(path);
            if (['image', 'audio', 'video', 'archive', 'document', '3d'].includes(k) || e.bytes.includes(0)) { if (e.bytes.length <= 3 * 1048576) { this.virtualProjectFiles.set(path, { content: '', dataUrl: bytesToDataUrl(e.bytes, mimeOf(path)), binary: true, size: e.bytes.length, timestamp: Date.now() }); n++; } }
            else { this.writeProjectFile(path, fromUtf8(e.bytes), 'extract'); n++; }
        }
        if (this.renderStudioExplorer) this.renderStudioExplorer();
        this.showToast(`📦 أضيف ${n} ملف`, 'success');
        return n;
    };

    // ---- PDF (#588 #589 #590 #660)
    P.fmxPdfTools = function () {
        return card('تقسيم PDF', `${sourcePicker(this, 'fmx-pdf-split', ['document'], { accept: '.pdf' })}<div class="gh-row">${field('fmx-pdf-ranges', 'نطاقات الصفحات (افصل الملفات بـ ;)', '1-3;4-', 'dir="ltr"')}${field('fmx-pdf-every', 'أو كل N صفحات', '', 'type="number" min="1"')}${pbtn('fa-scissors', 'تقسيم', 'app.fmxPdfSplit()')}</div>`, 'fa-scissors')
            + card('دمج PDFs', `<input id="fmx-pdf-merge" type="file" class="form-input-box" accept=".pdf" multiple onchange="app.fmxPdfMergeList()"><div id="fmx-pdf-order"></div><div class="gh-row">${pbtn('fa-object-group', 'دمج', 'app.fmxPdfMerge()')}</div>`, 'fa-object-group')
            + card('تحويل PDF إلى صور', `${sourcePicker(this, 'fmx-pdf-img', ['document'], { accept: '.pdf' })}<div class="gh-row">${select('fmx-pdf-scale', 'الدقة', [['1', '72 DPI'], ['2', '144 DPI'], ['3', '216 DPI']], '2')}${select('fmx-pdf-fmt', 'الصيغة', [['image/png', 'PNG'], ['image/jpeg', 'JPEG']], 'image/png')}${field('fmx-pdf-pages', 'الصفحات', '1-', 'dir="ltr"')}${pbtn('fa-images', 'تحويل', 'app.fmxPdfToImages()')}</div>`, 'fa-images')
            + card('تحليل PDF مع الصور والجداول', `${sourcePicker(this, 'fmx-pdf-an', ['document'], { accept: '.pdf' })}<div class="gh-row">${select('fmx-pdf-q', 'المطلوب', [['all', 'ملخص + الجداول + وصف الصور'], ['tables', 'استخراج الجداول (Markdown + CSV)'], ['images', 'وصف الأشكال والصور والرسوم'], ['qa', 'سؤال مخصص']], 'all')}${field('fmx-pdf-ask', 'سؤالك', '', 'dir="auto"')}${pbtn('fa-magnifying-glass-chart', 'تحليل', 'app.fmxPdfAnalyze()')}</div><div class="text-dim">يُرسل الملف لنموذج يقرأ PDF أصلياً (نص + صور + جداول). بدون مفتاح: استخراج النص محلياً.</div><div id="fmx-pdf-an-out"></div>`, 'fa-magnifying-glass-chart')
            + '<div id="fmx-out"></div>';
    };
    P.fmxPdfSplit = async function (src, o) {
        const [f] = await readSources(this, src || 'fmx-pdf-split');
        if (!f) return null;
        const parts = await pdfSplit(f.bytes, o || { ranges: val('fmx-pdf-ranges'), every: +val('fmx-pdf-every') || 0 });
        if (!parts.length) { this.showToast('نطاقات غير صالحة', 'warning'); return null; }
        const stem = stemOf(f.name);
        if (parts.length === 1) this.fmxOutput(makeBlob([parts[0].bytes], 'application/pdf'), `${stem}-p${parts[0].pages[0]}-${parts[0].pages.slice(-1)[0]}.pdf`, { preview: false });
        else this.fmxOutput(makeBlob([zipSync(Object.fromEntries(parts.map(p => [`${stem}-p${p.pages[0]}-${p.pages.slice(-1)[0]}.pdf`, p.bytes])))], 'application/zip'), `${stem}-split.zip`, { note: `${parts.length} ملفات PDF` });
        return parts;
    };
    const renderMerge = (l) => { const el = document.getElementById('fmx-pdf-order'); if (el) el.innerHTML = l.map((f, i) => `<div class="gh-item static" data-merge="${i}"><span>${i + 1}.</span><div class="gh-item-main">${esc(f.name)}</div>${btn('fa-arrow-up', '', call('fmxMoveMerge', i, -1), 'gh-chip')}${btn('fa-arrow-down', '', call('fmxMoveMerge', i, 1), 'gh-chip')}</div>`).join(''); };
    P.fmxPdfMergeList = function () { this._fmxMergeFiles = filesOf('fmx-pdf-merge'); renderMerge(this._fmxMergeFiles); return this._fmxMergeFiles; };
    P.fmxMoveMerge = function (i, d) { const l = this._fmxMergeFiles || [], j = i + d; if (j < 0 || j >= l.length) return l; [l[i], l[j]] = [l[j], l[i]]; renderMerge(l); return l; };
    P.fmxPdfMerge = async function (listArg) {
        const list = listArg || await Promise.all((this._fmxMergeFiles || filesOf('fmx-pdf-merge')).map(f => blobBytes(f)));
        if (list.length < 2) { this.showToast('اختر ملفين على الأقل', 'warning'); return null; }
        const bytes = await pdfMerge(list);
        this.fmxOutput(makeBlob([bytes], 'application/pdf'), 'merged.pdf', { preview: false, note: `${list.length} ملفات` });
        return bytes;
    };
    P.fmxPdfToImages = async function (src) {
        const [f] = await readSources(this, src || 'fmx-pdf-img');
        if (!f) return null;
        const lib = await this.loadLib('pdfjs');
        if (lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        const pdf = await lib.getDocument({ data: f.bytes.slice() }).promise;
        const pages = parseRanges(val('fmx-pdf-pages') || '1-', pdf.numPages).slice(0, 200), scale = +val('fmx-pdf-scale') || 2, type = val('fmx-pdf-fmt') || 'image/png', ext = type === 'image/png' ? 'png' : 'jpg';
        const out = {};
        for (const i of pages) {
            const page = await pdf.getPage(i + 1), vp = page.getViewport({ scale });
            const c = newCanvas(vp.width, vp.height), ctx = c.getContext('2d');
            if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
            await page.render({ canvasContext: ctx, viewport: vp }).promise;
            out[`${stemOf(f.name)}-${String(i + 1).padStart(3, '0')}.${ext}`] = await blobBytes(await canvasToBlob(c, type, 0.92));
        }
        const names = Object.keys(out);
        if (names.length === 1) this.fmxOutput(makeBlob([out[names[0]]], type), names[0]);
        else this.fmxOutput(makeBlob([zipSync(out)], 'application/zip'), `${stemOf(f.name)}-images.zip`, { note: `${names.length} صورة` });
        return names;
    };
    P.fmxPdfAnalyze = async function (src, modeArg, askArg) {
        const [f] = await readSources(this, src || 'fmx-pdf-an');
        if (!f) return null;
        const mode = modeArg || val('fmx-pdf-q'), ask = askArg || val('fmx-pdf-ask');
        const el = document.getElementById('fmx-pdf-an-out');
        const prompts = { all: 'لخّص المستند بالعربية، ثم استخرج كل جدول كجدول Markdown، ثم صف كل صورة أو رسم بياني أو مخطط (ماذا يُظهر والأرقام المهمة) مع رقم الصفحة.', tables: 'استخرج كل الجداول في المستند كجداول Markdown مع رقم الصفحة، ثم كرر كل جدول بصيغة CSV داخل كتلة ```csv.', images: 'صف كل صورة/رسم/مخطط في المستند: الصفحة، النوع، المحتوى، والاستنتاج.', qa: ask || 'ما أهم ما في هذا المستند؟' };
        if (!hasKey(this, true)) {
            const r = await this.extractPdf(f.bytes.slice().buffer);
            if (el) el.innerHTML = `<div class="text-dim">بدون مفتاح OpenRouter: النص المستخرج محلياً (${r.pages} صفحة)</div><pre class="fmx-tree" dir="auto">${esc(r.text.slice(0, 40000))}</pre>`;
            return r.text;
        }
        if (el) el.innerHTML = '<div class="gh-empty"><span class="live-step-spinner"></span> يقرأ النموذج المستند…</div>';
        const text = await chatParts(this, [textPart(prompts[mode] || prompts.all), filePart(f.name, f.bytes)], { maxTokens: 6000, onDelta: (c) => { if (el) el.innerHTML = `<div class="gh-md">${this.renderMarkdownSafe ? this.renderMarkdownSafe(c) : esc(c)}</div>`; } });
        this._fmxPdfText = text;
        if (el && text != null) el.innerHTML += `<div class="gh-row">${btn('fa-file-circle-plus', 'حفظ كملف Markdown', call('fmxSaveText', stemOf(f.name) + '-analysis.md', '__pdf'))}${btn('fa-table', 'تصدير الجداول CSV', 'app.fmxPdfTablesCSV()')}</div>`;
        return text;
    };
    P.fmxSaveText = function (name, key) { const text = key === '__pdf' ? this._fmxPdfText : key; return this.fmxSaveOut('project', { blob: makeBlob([text || ''], 'text/markdown'), name }); };
    P.fmxPdfTablesCSV = function (text = this._fmxPdfText || '') {
        const tables = [];
        const md = text.split('\n'); let cur = [];
        md.forEach(l => { if (/^\s*\|.*\|\s*$/.test(l)) { if (!/^\s*\|[\s:|-]+\|\s*$/.test(l)) cur.push(l.trim().slice(1, -1).split('|').map(c => c.trim())); } else if (cur.length) { tables.push(cur); cur = []; } });
        if (cur.length) tables.push(cur);
        const csv = (t) => t.map(r => r.map(c => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(',')).join('\n');
        if (!tables.length) { this.showToast('لا جداول', 'info'); return []; }
        if (tables.length === 1) this.fmxOutput(makeBlob([csv(tables[0])], 'text/csv'), 'table.csv', { preview: false });
        else this.fmxOutput(makeBlob([zipSync(Object.fromEntries(tables.map((t, i) => [`table-${i + 1}.csv`, strToU8(csv(t))])))], 'application/zip'), 'tables.zip', { note: `${tables.length} جداول` });
        return tables;
    };

    // ---- images: lossless compress (#582) + merge (#587)
    P.fmxImageTools = function () {
        return card('ضغط الصور بدون فقدان', `<div class="text-dim">PNG: إعادة ترميز بأصغر نوع ألوان (لوحة ≤256 لون/رمادي/RGB) ومرشحات صفوف تكيفية وضغط zlib أقصى. JPEG: حذف البيانات الوصفية (EXIF/XMP/تعليقات) دون لمس الصورة. SVG: تصغير. كل بكسل يبقى كما هو.</div>
                <input id="fmx-lc-files" type="file" class="form-input-box" accept=".png,.jpg,.jpeg,.svg" multiple><div class="gh-row">${pbtn('fa-compress', 'ضغط', 'app.fmxLosslessCompress()')}${btn('fa-folder-tree', 'ضغط كل صور المشروع', 'app.fmxLosslessProject()')}</div><div id="fmx-lc-out"></div>`, 'fa-compress')
            + card('دمج صور', `<input id="fmx-mg-files" type="file" class="form-input-box" accept="image/*" multiple><div class="gh-row">${select('fmx-mg-layout', 'التخطيط', [['h', 'أفقي'], ['v', 'عمودي'], ['grid', 'شبكة']], 'h')}${field('fmx-mg-gap', 'المسافة', '8', 'type="number" min="0"')}${field('fmx-mg-bg', 'الخلفية', '#ffffff', 'type="color"')}${field('fmx-mg-h', 'ارتفاع موحد (0=الأصلي)', '0', 'type="number" min="0"')}${pbtn('fa-object-group', 'دمج', 'app.fmxMergeImages()')}</div>`, 'fa-object-group')
            + '<div id="fmx-out"></div>';
    };
    P.fmxLosslessOne = async function (name, bytes) {
        const ext = extOf(name);
        if (ext === 'svg') return utf8(minifySVG(fromUtf8(bytes)));
        if (ext === 'jpg' || ext === 'jpeg') return stripJPEG(bytes);
        if (ext === 'png') {
            const img = await this.loadImageElement(bytesToDataUrl(bytes, 'image/png'));
            const c = newCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height), ctx = ctx2d(c);
            ctx.drawImage(img, 0, 0);
            const d = ctx.getImageData(0, 0, c.width, c.height);
            return encodePNG(d.data, c.width, c.height);
        }
        throw new Error('صيغة غير مدعومة');
    };
    const lcTable = (rows) => `<table class="fmx-table"><thead><tr><th>الملف</th><th>قبل</th><th>بعد</th><th>التوفير</th></tr></thead><tbody>${rows.map(r => `<tr data-lc="${esc(r.name)}"><td dir="ltr">${esc(r.name)}</td><td>${fmtBytes(r.before)}</td><td>${fmtBytes(r.after)}</td><td>${r.error ? '❌ ' + esc(r.error) : r.after < r.before ? Math.round((1 - r.after / r.before) * 100) + '%' : 'الأصل أصغر'}</td></tr>`).join('')}</tbody></table>`;
    P.fmxLosslessCompress = async function (filesArg) {
        const files = filesArg || await Promise.all(filesOf('fmx-lc-files').map(async f => ({ name: f.name, bytes: await blobBytes(f) })));
        const rows = [], zip = {};
        for (const f of files) {
            try { const out = await this.fmxLosslessOne(f.name, f.bytes); const best = out.length < f.bytes.length ? out : f.bytes; rows.push({ name: f.name, before: f.bytes.length, after: best.length }); zip[f.name] = best; }
            catch (e) { rows.push({ name: f.name, before: f.bytes.length, after: f.bytes.length, error: e.message }); }
        }
        const el = document.getElementById('fmx-lc-out');
        if (el) el.innerHTML = lcTable(rows);
        const names = Object.keys(zip);
        if (names.length === 1) this.fmxOutput(makeBlob([zip[names[0]]], mimeOf(names[0])), names[0]);
        else if (names.length) this.fmxOutput(makeBlob([zipSync(zip)], 'application/zip'), 'optimized-images.zip', { note: `${names.length} صورة` });
        return rows;
    };
    P.fmxLosslessProject = async function () {
        const rows = [];
        for (const p of this.projectPaths().filter(p => /\.(png|jpe?g|svg)$/i.test(p))) {
            const e = this.virtualProjectFiles.get(p), bytes = entryBytes(e);
            try {
                const out = await this.fmxLosslessOne(p, bytes);
                if (out.length < bytes.length) {
                    if (extOf(p) === 'svg' && isTextEntry(e)) this.writeProjectFile(p, fromUtf8(out), 'optimize');
                    else this.virtualProjectFiles.set(p, { ...e, dataUrl: bytesToDataUrl(out, mimeOf(p)), size: out.length, timestamp: Date.now() });
                }
                rows.push({ name: p, before: bytes.length, after: Math.min(out.length, bytes.length) });
            } catch (err) { rows.push({ name: p, before: bytes.length, after: bytes.length, error: err.message }); }
        }
        const el = document.getElementById('fmx-lc-out');
        if (el) el.innerHTML = rows.length ? lcTable(rows) : empty('لا صور في المشروع');
        const saved = rows.reduce((n, r) => n + r.before - r.after, 0);
        this.showToast(`🗜️ وُفّر ${fmtBytes(saved)}`, 'success');
        return rows;
    };
    P.fmxMergeImages = async function (srcs, o) {
        const list = srcs || await Promise.all(filesOf('fmx-mg-files').map(f => this.blobToDataUrl(f)));
        if (list.length < 2) { this.showToast('اختر صورتين على الأقل', 'warning'); return null; }
        const layout = (o && o.layout) || val('fmx-mg-layout') || 'h', gap = +((o && o.gap) != null ? o.gap : val('fmx-mg-gap') || 0), bg = (o && o.bg) || val('fmx-mg-bg') || '#ffffff', H = +((o && o.height) || val('fmx-mg-h') || 0);
        const imgs = await Promise.all(list.map(u => this.loadImageElement(u)));
        const dims = imgs.map(im => { const w = im.naturalWidth || im.width || 1, h = im.naturalHeight || im.height || 1; return H ? [Math.round(w * H / h), H] : [w, h]; });
        let W, Ht, pos;
        if (layout === 'v') { W = Math.max(...dims.map(d => d[0])); Ht = dims.reduce((n, d) => n + d[1], 0) + gap * (dims.length + 1); let y = gap; pos = dims.map(d => { const p = [(W - d[0]) / 2 + gap, y]; y += d[1] + gap; return p; }); W += gap * 2; }
        else if (layout === 'grid') { const cols = Math.ceil(Math.sqrt(dims.length)), cw = Math.max(...dims.map(d => d[0])), ch = Math.max(...dims.map(d => d[1])); W = cols * cw + gap * (cols + 1); Ht = Math.ceil(dims.length / cols) * ch + gap * (Math.ceil(dims.length / cols) + 1); pos = dims.map((d, i) => [gap + (i % cols) * (cw + gap) + (cw - d[0]) / 2, gap + Math.floor(i / cols) * (ch + gap) + (ch - d[1]) / 2]); }
        else { Ht = Math.max(...dims.map(d => d[1])) + gap * 2; W = dims.reduce((n, d) => n + d[0], 0) + gap * (dims.length + 1); let x = gap; pos = dims.map(d => { const p = [x, (Ht - d[1]) / 2]; x += d[0] + gap; return p; }); }
        const c = newCanvas(W, Ht), ctx = c.getContext('2d');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, Ht);
        imgs.forEach((im, i) => ctx.drawImage(im, pos[i][0], pos[i][1], dims[i][0], dims[i][1]));
        const blob = await canvasToBlob(c, 'image/png');
        if (blob) this.fmxOutput(blob, 'merged.png', { note: `${W}×${Ht}` });
        return { width: W, height: Ht, blob };
    };

    // ---- scan (#591)
    P.fmxScan = function () {
        return card('فحص الملفات من البرمجيات الخبيثة', `<div class="text-dim">⚠️ فحص استدلالي محلي (ليس مضاد فيروسات كاملاً): يكشف الملفات التنفيذية المتنكرة، الامتدادات المزدوجة، السكربتات في SVG/PDF، الماكرو في Office، قنابل الضغط و Zip Slip، الكود المشوّش، وتوقيع EICAR. لكل ملف رابط بصمته على VirusTotal للتحقق اليدوي.</div>
            <div class="gh-row"><input id="fmx-scan-files" type="file" class="form-input-box" multiple>${pbtn('fa-shield-virus', 'فحص الملفات', 'app.fmxScanRun()')}${btn('fa-folder-tree', 'فحص المشروع كله', 'app.fmxScanRun(\'project\')')}</div><div id="fmx-scan-out"></div>`, 'fa-shield-virus');
    };
    P.fmxScanRun = async function (what) {
        const items = what === 'project' ? this.projectPaths().map(p => ({ name: p, bytes: entryBytes(this.virtualProjectFiles.get(p)) })) : Array.isArray(what) ? what : await Promise.all(filesOf('fmx-scan-files').map(async f => ({ name: f.name, bytes: await blobBytes(f) })));
        const res = [];
        for (const it of items) res.push({ ...scanBytes(it.name, it.bytes), sha: await sha256Hex(it.bytes).catch(() => '') });
        res.sort((a, b) => ['high', 'medium', 'low', 'clean'].indexOf(a.risk) - ['high', 'medium', 'low', 'clean'].indexOf(b.risk));
        const icon = { high: '🔴', medium: '🟠', low: '🟡', clean: '🟢' };
        const el = document.getElementById('fmx-scan-out');
        const bad = res.filter(r => r.risk !== 'clean');
        if (el) el.innerHTML = `<div class="gh-row"><b>${res.length} ملف</b><span class="fmx-tag">🔴 ${res.filter(r => r.risk === 'high').length}</span><span class="fmx-tag">🟠 ${res.filter(r => r.risk === 'medium').length}</span><span class="fmx-tag">🟡 ${res.filter(r => r.risk === 'low').length}</span><span class="fmx-tag">🟢 ${res.filter(r => r.risk === 'clean').length}</span></div>
            ${bad.map(r => `<div class="fmx-scan ${r.risk}" data-scan="${esc(r.name)}"><b>${icon[r.risk]} <span dir="ltr">${esc(r.name)}</span></b><ul>${r.findings.map(f => `<li>${esc(f.msg)}</li>`).join('')}</ul>${r.sha ? `<a href="https://www.virustotal.com/gui/file/${r.sha}" target="_blank" rel="noopener">VirusTotal ↗</a>` : ''}</div>`).join('') || empty('🟢 لم يُعثر على مؤشرات خطر')}`;
        return res;
    };
}
