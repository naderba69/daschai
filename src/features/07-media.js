/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 4b: Upload, documents, preview, converters,
   image editor, recorder, media gallery, chat export.
   Ideas implemented (THOUSAND_IDEAS.md):
     #532 folder upload   #533/#642 drag & drop from desktop   #534 preview many formats
     #535/#671 image editor (crop, resize, rotate, filters)   #673 text on images
     #537 JSON↔YAML, CSV↔JSON   #548 batch image conversion   #551 PDF preview
     #552 Word / Excel / PowerPoint   #554 audio & video   #555 fonts   #558 data preview
     #559 CSV as an editable table   #560 JSON as an editable tree   #581 WebP/AVIF/PNG/JPEG
     #592 size check   #595 progress   #596 cancel   #597 preview before sending
     #598 type validation   #599 auto-rename duplicates   #659 OCR (vision model)
     #661 screen recording   #662 voice memo   #663 camera   #721 media gallery
     #726 download   #729 fullscreen   #730 picture-in-picture   #736/#387 chat export
   ============================================================================== */
(function () {
    'use strict';
    if (typeof OXAlphaApp === 'undefined') return;
    const P = OXAlphaApp.prototype;

    const MAX_FILE = 50 * 1024 * 1024;          // hard limit per file
    const MAX_TEXT = 5 * 1024 * 1024;           // text files larger than this are not read
    const MAX_PROJECT_BINARY = 3 * 1024 * 1024; // images/fonts kept inside the project (data URL)
    const IGNORED = /(^|\/)(node_modules|\.git|\.next|dist|build|out|coverage|__pycache__|\.venv|venv|\.cache|\.idea|\.DS_Store)(\/|$)/;
    const CDN = {
        pdfjs: ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'pdfjsLib'],
        pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
        mammoth: ['https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js', 'mammoth'],
        xlsx: ['https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', 'XLSX'],
        yaml: ['https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js', 'jsyaml']
    };
    const extOf = (p) => { const b = String(p).split('/').pop(); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
    const baseName = (p) => String(p).split('/').pop();
    const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg'];
    const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'weba'];
    const VIDEO_EXT = ['mp4', 'webm', 'mov', 'mkv', 'ogv', 'm4v'];
    const FONT_EXT = ['ttf', 'otf', 'woff', 'woff2'];
    const DOC_EXT = ['pdf', 'docx', 'xlsx', 'xls', 'pptx'];
    const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml', pdf: 'application/pdf', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', webm: 'video/webm', mp4: 'video/mp4', mov: 'video/quicktime', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
    P.mimeForName = (name) => MIME[extOf(name)] || 'application/octet-stream';

    // ------------------------------------------------------------------ SMALL HELPERS
    P.loadScriptOnce = function (url, globalName) {
        if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
        this._scriptLoads = this._scriptLoads || {};
        if (this._scriptLoads[url]) return this._scriptLoads[url];
        this._scriptLoads[url] = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = url; s.async = true; s.crossOrigin = 'anonymous';
            s.onload = () => (globalName && !window[globalName] ? reject(new Error('library failed to initialise')) : resolve(window[globalName]));
            s.onerror = () => { delete this._scriptLoads[url]; reject(new Error('تعذر تحميل المكتبة (تحقق من الاتصال)')); };
            document.head.appendChild(s);
        });
        return this._scriptLoads[url];
    };
    P.loadLib = function (key) { const [url, g] = CDN[key]; return this.loadScriptOnce(url, g); };

    const readAs = (file, how) => new Promise((resolve, reject) => {
        if (how === 'arrayBuffer' && file.arrayBuffer) return file.arrayBuffer().then(resolve, reject);
        if (how === 'text' && file.text) return file.text().then(resolve, reject);
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error || new Error('read failed'));
        if (how === 'dataUrl') r.readAsDataURL(file); else if (how === 'arrayBuffer') r.readAsArrayBuffer(file); else r.readAsText(file);
    });
    P.readFileAs = readAs;
    const looksBinary = (text) => { const sample = text.slice(0, 8000); return sample.includes('\u0000') || (sample.match(/\uFFFD/g) || []).length > 20; };
    P.looksBinary = looksBinary;

    /** In-memory blobs for media/documents attached this session (kept out of localStorage). */
    P.putBlob = function (blob) { this.mediaBlobs = this.mediaBlobs || new Map(); const id = 'b_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); this.mediaBlobs.set(id, blob); return id; };
    P.getBlob = function (id) { return this.mediaBlobs ? this.mediaBlobs.get(id) : null; };
    const blobToDataUrl = (blob) => readAs(blob, 'dataUrl');
    P.blobToDataUrl = blobToDataUrl;

    P.uniqueAttachmentName = function (name) {
        const names = new Set((this.currentAttachments || []).map(a => a.name));
        if (!names.has(name)) return name;
        const dot = name.lastIndexOf('.');
        const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
        for (let i = 2; ; i++) { const c = `${stem} (${i})${ext}`; if (!names.has(c)) return c; }
    };

    // ------------------------------------------------------------------ DOCUMENT EXTRACTION
    P.extractPdf = async function (buf) {
        const lib = await this.loadLib('pdfjs');
        if (lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
        const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
        const pages = [];
        for (let i = 1; i <= Math.min(pdf.numPages, 300); i++) {
            const page = await pdf.getPage(i);
            const tc = await page.getTextContent();
            let text = '';
            tc.items.forEach(it => { text += it.str + (it.hasEOL ? '\n' : ' '); });
            pages.push(text.replace(/[ \t]+\n/g, '\n').trim());
        }
        return { pages: pdf.numPages, text: pages.map((t, i) => `--- صفحة ${i + 1} ---\n${t}`).join('\n\n') };
    };
    P.extractDocx = async function (buf) {
        const lib = await this.loadLib('mammoth');
        const r = await lib.extractRawText({ arrayBuffer: buf });
        return { text: (r.value || '').replace(/\n{3,}/g, '\n\n').trim() };
    };
    P.extractXlsx = async function (buf) {
        const lib = await this.loadLib('xlsx');
        const wb = lib.read(new Uint8Array(buf), { type: 'array' });
        const sheets = wb.SheetNames.map(name => ({ name, csv: lib.utils.sheet_to_csv(wb.Sheets[name]) }));
        return { sheets, text: sheets.map(s => `## ورقة: ${s.name}\n${s.csv}`).join('\n\n') };
    };
    /** PowerPoint: slides are XML inside a ZIP — no extra library needed. */
    P.extractPptx = async function (buf) {
        if (typeof JSZip === 'undefined') throw new Error('مكتبة ZIP غير محملة');
        const zip = await JSZip.loadAsync(buf);
        const slides = Object.keys(zip.files).filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => +a.match(/(\d+)\.xml/)[1] - +b.match(/(\d+)\.xml/)[1]);
        const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
        const out = [];
        for (const p of slides) {
            const xml = await zip.file(p).async('string');
            const paras = xml.split(/<\/a:p>/).map(chunk => (chunk.match(/<a:t>([^<]*)<\/a:t>/g) || []).map(t => decode(t.replace(/<\/?a:t>/g, ''))).join('')).filter(Boolean);
            out.push(paras.join('\n'));
        }
        return { slides: out.length, text: out.map((t, i) => `--- شريحة ${i + 1} ---\n${t}`).join('\n\n') };
    };

    // ------------------------------------------------------------------ UPLOAD PIPELINE
    const toItems = (files) => Array.from(files || []).map(f => (f && f.file ? f : { file: f, path: (f.webkitRelativePath || f.name || 'file').replace(/^\/+/, '') }));

    P.showUploadProgress = function (done, total, label) {
        const box = document.getElementById('upload-progress');
        if (!box) return;
        if (done === null) { box.style.display = 'none'; return; }
        box.style.display = '';
        document.getElementById('upload-progress-label').textContent = `${label || ''} — ${done}/${total}`;
        document.getElementById('upload-progress-bar').style.width = `${total ? Math.round(done / total * 100) : 0}%`;
    };
    P.cancelUpload = function () { this._uploadCancelled = true; this.showToast('تم إلغاء الرفع', 'warning'); };

    const _origProcessSingle = P.processSingleFile;
    /** Attach one file to the next message. Returns a short status string. */
    P.processSingleFile = async function (file) {
        const name = this.uniqueAttachmentName(file.name || 'file');
        const ext = extOf(name);
        const size = file.size || 0;
        if (size > MAX_FILE) return this._skip(name, `أكبر من ${MAX_FILE / 1048576}MB`);
        const before = this.currentAttachments.length;
        try {
            if (ext === 'zip' || (file.type || '').startsWith('image/') && ext !== 'svg') {
                await _origProcessSingle.call(this, file);
                const att = this.currentAttachments[this.currentAttachments.length - 1];
                if (this.currentAttachments.length > before && att) { att.name = name; att.size = size; if (att.isImage) att.mime = file.type; }
                return 'ok';
            }
            if (DOC_EXT.includes(ext)) {
                const buf = await readAs(file, 'arrayBuffer');
                const r = ext === 'pdf' ? await this.extractPdf(buf) : ext === 'docx' ? await this.extractDocx(buf) : ext === 'pptx' ? await this.extractPptx(buf) : await this.extractXlsx(buf);
                const blobId = this.putBlob(new Blob([buf], { type: file.type || this.mimeForName(name) }));
                const meta = r.pages ? `${r.pages} صفحة` : r.slides ? `${r.slides} شريحة` : r.sheets ? `${r.sheets.length} ورقة` : '';
                this.currentAttachments.push({ name, isDocument: true, docType: ext, blobId, size, sheets: r.sheets, textContent: `=== مستند ${ext.toUpperCase()}: ${name}${meta ? ' (' + meta + ')' : ''} ===\n${r.text || '(لا يحتوي نصاً قابلاً للاستخراج — قد يكون ممسوحاً ضوئياً)'}` });
                return 'ok';
            }
            if (AUDIO_EXT.includes(ext) || VIDEO_EXT.includes(ext) || /^(audio|video)\//.test(file.type || '')) {
                const kind = (file.type || '').startsWith('video') || VIDEO_EXT.includes(ext) ? 'video' : 'audio';
                const blobId = this.putBlob(file);
                this.currentAttachments.push({ name, isMedia: true, mediaKind: kind, blobId, size, mime: file.type || this.mimeForName(name), textContent: `[ملف ${kind === 'video' ? 'فيديو' : 'صوتي'} مرفق: ${name} — ${this.fmtBytes(size)}. لا يمكن للنموذج سماعه/مشاهدته مباشرة.]` });
                return 'ok';
            }
            if (FONT_EXT.includes(ext)) {
                const blobId = this.putBlob(file);
                this.currentAttachments.push({ name, isFont: true, blobId, size, textContent: `[خط مرفق: ${name}]` });
                return 'ok';
            }
            if (size > MAX_TEXT) return this._skip(name, `ملف نصي أكبر من ${MAX_TEXT / 1048576}MB`);
            const text = await readAs(file, 'text');
            if (looksBinary(text)) return this._skip(name, 'ملف ثنائي غير مدعوم');
            this.virtualProjectFiles.set(name, { content: text, lang: ext, timestamp: Date.now() });
            this.currentAttachments.push({ name, textContent: text, isCode: true, size });
            return 'ok';
        } catch (e) {
            return this._skip(name, e.message || 'فشل القراءة');
        }
    };
    P._skip = function (name, reason) { (this._uploadSkipped = this._uploadSkipped || []).push({ name, reason }); return 'skipped'; };

    P.processUniversalFiles = async function (files) {
        const items = toItems(files).filter(x => !IGNORED.test(x.path));
        if (!items.length) return { attached: 0, skipped: 0 };
        if (items.some(x => x.path.includes('/'))) return this.importFolderItems(items, { attach: true });
        this._uploadCancelled = false;
        this._uploadSkipped = [];
        const total = items.reduce((n, x) => n + (x.file.size || 0), 0);
        const showBar = items.length > 1 || total > 2 * 1048576;
        let attached = 0;
        for (let i = 0; i < items.length; i++) {
            if (this._uploadCancelled) break;
            if (showBar) this.showUploadProgress(i, items.length, items[i].file.name);
            if ((await this.processSingleFile(items[i].file)) === 'ok') attached++;
        }
        this.showUploadProgress(null);
        this.renderAttachmentTray();
        this.reportUpload(attached, 'إرفاق');
        return { attached, skipped: this._uploadSkipped.length };
    };

    P.reportUpload = function (n, verb) {
        const sk = this._uploadSkipped || [];
        if (n) this.showToast(`📎 تم ${verb} ${n} ملف${sk.length ? ` • تخطي ${sk.length}` : ''}`, 'success');
        if (sk.length) {
            const list = sk.slice(0, 4).map(s => `${this.escapeHTML(s.name)}: ${this.escapeHTML(s.reason)}`).join('<br>');
            this.showToast(`⚠️ تم تخطي ${sk.length}:<br>${list}${sk.length > 4 ? '<br>…' : ''}`, 'warning');
        }
    };

    /** Import a folder (or many dropped files) into the project, optionally attaching it to the chat. */
    P.importFolderItems = async function (items, { attach = true, baseDir = '' } = {}) {
        items = items.filter(x => !IGNORED.test(x.path));
        this._uploadCancelled = false;
        this._uploadSkipped = [];
        const root = (items[0] && items[0].path.includes('/')) ? items[0].path.split('/')[0] : 'files';
        const entries = [];
        let text = `=== مجلد مشروع: ${root} (${items.length} ملف) ===\n\n`;
        let imported = 0;
        for (let i = 0; i < items.length; i++) {
            if (this._uploadCancelled) break;
            const { file, path: rel } = items[i];
            const path = this.normPath(baseDir ? `${baseDir}/${rel}` : rel);
            if (i % 5 === 0 || items.length < 50) this.showUploadProgress(i, items.length, rel);
            const ext = extOf(path), size = file.size || 0;
            if (!path) continue;
            if (size > MAX_FILE) { this._skip(rel, 'حجم كبير'); continue; }
            try {
                if (IMAGE_EXT.includes(ext) || FONT_EXT.includes(ext) || ext === 'pdf' || AUDIO_EXT.includes(ext) || VIDEO_EXT.includes(ext)) {
                    if (size > MAX_PROJECT_BINARY) { this._skip(rel, 'ملف وسائط كبير على المشروع'); continue; }
                    const dataUrl = await blobToDataUrl(file);
                    this.virtualProjectFiles.set(path, { dataUrl, binary: true, size, mime: file.type || this.mimeForName(path), lang: ext, timestamp: Date.now() });
                    imported++;
                    continue;
                }
                if (size > MAX_TEXT) { this._skip(rel, 'ملف نصي كبير'); continue; }
                const content = await readAs(file, 'text');
                if (looksBinary(content)) { this._skip(rel, 'ملف ثنائي'); continue; }
                this.virtualProjectFiles.set(path, { content, lang: ext, timestamp: Date.now() });
                entries.push({ path, content });
                if (text.length < 200000) text += `--- [الملف: ${path}] ---\n${content.slice(0, 8000)}\n\n`;
                imported++;
            } catch (e) { this._skip(rel, e.message); }
        }
        this.showUploadProgress(null);
        if (attach && entries.length) {
            this.currentAttachments.push({ name: this.uniqueAttachmentName(root + '/'), textContent: text, isZipProject: true, isFolder: true, zipEntries: entries, fileCount: imported });
            this.renderAttachmentTray();
        }
        if (this.explorerExpandTo && entries[0]) this.explorerExpandTo(entries[0].path);
        if (this.isCodeStudioOpen) this.renderStudioWorkspace(); else if (this.renderStudioExplorer) this.renderStudioExplorer();
        this.reportUpload(imported, attach ? 'استيراد وإرفاق' : 'استيراد');
        return { imported, skipped: this._uploadSkipped.length };
    };

    /** Walk a DataTransfer (supports dropped folders via webkitGetAsEntry). */
    P.collectDroppedItems = async function (dt) {
        const items = Array.from(dt.items || []);
        const entries = items.map(it => (it.kind === 'file' && it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
        if (!entries.length) return toItems(dt.files);
        const out = [];
        const readDir = (dir) => new Promise((resolve) => {
            const reader = dir.createReader();
            const all = [];
            const next = () => reader.readEntries((batch) => { if (!batch.length) resolve(all); else { all.push(...batch); next(); } }, () => resolve(all));
            next();
        });
        const walk = async (entry, prefix) => {
            const path = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (IGNORED.test(path)) return;
            if (entry.isFile) { const file = await new Promise((res, rej) => entry.file(res, rej)).catch(() => null); if (file) out.push({ file, path }); }
            else if (entry.isDirectory) { for (const child of await readDir(entry)) await walk(child, path); }
        };
        for (const e of entries) await walk(e, '');
        return out;
    };

    P.importDroppedToProject = async function (dt, dir) {
        const items = await this.collectDroppedItems(dt);
        return this.importFolderItems(items, { attach: false, baseDir: dir || '' });
    };

    P.pickFolderUpload = function () { document.getElementById('folder-file-input')?.click(); };

    P.initDragDrop = function () {
        const overlay = document.getElementById('drop-overlay');
        let depth = 0;
        const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
        window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; depth++; overlay?.classList.add('active'); });
        window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) overlay?.classList.remove('active'); });
        window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
        window.addEventListener('drop', async (e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            depth = 0;
            overlay?.classList.remove('active');
            const items = await this.collectDroppedItems(e.dataTransfer);
            this.processUniversalFiles(items);
        });
        const folder = document.getElementById('folder-file-input');
        if (folder) folder.addEventListener('change', () => { this.processUniversalFiles(folder.files); folder.value = ''; });
        // Paste images / files straight into the message box
        const input = document.getElementById('user-input');
        if (input) input.addEventListener('paste', (e) => {
            const files = Array.from(e.clipboardData?.files || []);
            if (files.length) { e.preventDefault(); this.processUniversalFiles(files); }
        });
    };

    // Attachment chips → click to preview (#597), document/media icons, size tooltip
    const _origTray = P.renderAttachmentTray;
    P.renderAttachmentTray = function () {
        const r = _origTray.apply(this, arguments);
        const chips = document.querySelectorAll('#attachment-chips-list .attachment-file-chip');
        chips.forEach((chip, idx) => {
            const att = this.currentAttachments[idx];
            if (!att) return;
            const icon = chip.querySelector('i');
            if (icon) {
                if (att.isDocument) icon.className = `${this.fileIcon(att.name)[0]}`, icon.style.color = this.fileIcon(att.name)[1];
                else if (att.isMedia) icon.className = `fa-solid ${att.mediaKind === 'video' ? 'fa-film' : 'fa-music'}`, icon.style.color = '#f472b6';
                else if (att.isFont) icon.className = 'fa-solid fa-font';
                else if (att.isFolder) icon.className = 'fa-solid fa-folder-open text-amber';
            }
            if (att.isImage && att.base64 && icon) {
                const img = document.createElement('img');
                img.src = att.base64; img.alt = ''; img.className = 'attachment-thumb';
                icon.replaceWith(img);
            }
            chip.classList.add('clickable');
            chip.title = `${att.name}${att.size ? ' • ' + this.fmtBytes(att.size) : ''} — انقر للمعاينة`;
            chip.addEventListener('click', (e) => { if (e.target.closest('.attachment-remove-btn')) return; this.openFilePreview({ attachment: idx }); });
        });
        return r;
    };

    // ------------------------------------------------------------------ CONVERTERS
    /** RFC 4180 CSV parser (quotes, escaped quotes, newlines inside quotes, CRLF). */
    P.parseCSV = function (text, delim) {
        text = String(text || '').replace(/^\uFEFF/, '');
        if (!delim) { const first = text.split('\n')[0]; delim = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ','; }
        const rows = []; let row = [], field = '', q = false;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (q) {
                if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
                else field += c;
            } else if (c === '"' && field === '') q = true;
            else if (c === delim) { row.push(field); field = ''; }
            else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
            else field += c;
        }
        if (field !== '' || row.length) { row.push(field); rows.push(row); }
        return rows;
    };
    P.stringifyCSV = function (rows, delim = ',') {
        return rows.map(r => r.map(v => { const s = v == null ? '' : String(v); return /["\n\r]/.test(s) || s.includes(delim) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(delim)).join('\n') + '\n';
    };
    const inferValue = (s) => { if (s === '') return ''; if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(s) && s.length < 16) return Number(s); if (s === 'true' || s === 'false') return s === 'true'; if (s === 'null') return null; return s; };
    P.csvToJson = function (text) {
        const rows = this.parseCSV(text).filter(r => r.some(c => c !== ''));
        if (!rows.length) return [];
        const head = rows[0].map((h, i) => h.trim() || `col${i + 1}`);
        return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, inferValue(r[i] ?? '')])));
    };
    P.jsonToCsv = function (data) {
        let arr = Array.isArray(data) ? data : (data && typeof data === 'object' ? (Object.values(data).find(Array.isArray) || [data]) : [data]);
        if (arr.every(x => x === null || typeof x !== 'object')) arr = arr.map(v => ({ value: v }));
        const keys = [];
        arr.forEach(o => Object.keys(o || {}).forEach(k => { if (!keys.includes(k)) keys.push(k); }));
        const cell = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
        return this.stringifyCSV([keys, ...arr.map(o => keys.map(k => cell(o ? o[k] : '')))]);
    };
    P.convertText = async function (text, from, to) {
        let data;
        if (from === 'json' || from === 'geojson') data = JSON.parse(text);
        else if (from === 'csv' || from === 'tsv') data = this.csvToJson(text);
        else if (from === 'yaml' || from === 'yml') data = (await this.loadLib('yaml')).load(text);
        else throw new Error('صيغة غير مدعومة');
        if (to === 'json') return JSON.stringify(data, null, 2) + '\n';
        if (to === 'csv') return this.jsonToCsv(data);
        if (to === 'yaml') return (await this.loadLib('yaml')).dump(data, { lineWidth: 120, noRefs: true });
        throw new Error('صيغة غير مدعومة');
    };
    /** Convert a project file and open the result next to it. */
    P.convertProjectFile = async function (path, to) {
        const f = this.virtualProjectFiles.get(path);
        if (!f) return null;
        try {
            const out = await this.convertText(f.content || '', extOf(path), to);
            const target = this.uniqueProjectPath(path.replace(/\.[^./]+$/, '') + '.' + to);
            this.createProjectFile(target, out, { open: false });
            this.closeModals();
            this.openProjectFile(target);
            this.showToast(`🔄 تم التحويل إلى ${this.escapeHTML(baseName(target))}`, 'success');
            return target;
        } catch (e) { this.showToast('❌ فشل التحويل: ' + this.escapeHTML(e.message), 'error'); return null; }
    };

    // ------------------------------------------------------------------ PREVIEW
    /** Resolve a preview source to { name, ext, text, blob, dataUrl, size, path, attachmentIndex, extra } */
    P.resolvePreviewSource = function (src) {
        if (src.path) {
            const f = this.virtualProjectFiles.get(src.path);
            if (!f) return null;
            return { name: baseName(src.path), path: src.path, ext: extOf(src.path), text: f.dataUrl ? null : (f.content || ''), dataUrl: f.dataUrl || null, size: f.size != null ? f.size : (f.content || '').length, mime: f.mime };
        }
        if (src.attachment !== undefined) {
            const a = this.currentAttachments[src.attachment];
            if (!a) return null;
            const blob = a.blobId ? this.getBlob(a.blobId) : null;
            return { name: a.name, ext: a.docType || extOf(a.name), attachmentIndex: src.attachment, text: a.isImage || a.isMedia || a.isFont || a.isDocument ? null : a.textContent, docText: a.isDocument ? a.textContent : null, dataUrl: a.base64 || null, blob, size: a.size || (a.textContent || '').length, sheets: a.sheets, isFolder: a.isFolder || a.isZipProject, att: a, mime: a.mime };
        }
        if (src.media) {
            const m = (this.mediaItems || []).find(x => x.id === src.media);
            if (!m) return null;
            return { name: m.name, ext: extOf(m.name), blob: m.blob, size: m.size, mediaId: m.id, mime: m.type };
        }
        if (src.blob) return { name: src.name || 'file', ext: extOf(src.name || ''), blob: src.blob, size: src.blob.size, mime: src.blob.type };
        return null;
    };

    P.previewKind = function (s) {
        const e = s.ext;
        if (s.isFolder) return 'folder';
        if (e === 'svg') return 'svg';
        if (IMAGE_EXT.includes(e) || (s.mime || '').startsWith('image/')) return 'image';
        if (e === 'pdf') return 'pdf';
        if (['docx', 'pptx'].includes(e)) return 'doc';
        if (['xlsx', 'xls'].includes(e)) return 'sheet';
        if (AUDIO_EXT.includes(e) || (s.mime || '').startsWith('audio/')) return 'audio';
        if (VIDEO_EXT.includes(e) || (s.mime || '').startsWith('video/')) return 'video';
        if (FONT_EXT.includes(e)) return 'font';
        if (e === 'md' || e === 'markdown') return 'markdown';
        if (['json', 'geojson', 'ipynb'].includes(e)) return 'json';
        if (['csv', 'tsv'].includes(e)) return 'csv';
        if (['html', 'htm'].includes(e)) return 'html';
        return 'text';
    };

    P.previewUrl = function (s) {
        if (s._url) return s._url;
        if (s.blob) { s._url = URL.createObjectURL(s.blob); (this._previewUrls = this._previewUrls || []).push(s._url); return s._url; }
        // Images may use data: URLs; PDF/audio/video/fonts need blob: (CSP frame-src/media-src)
        if (s.dataUrl && /^data:image\//.test(s.dataUrl)) return (s._url = s.dataUrl);
        if (s.dataUrl) { s.blob = this.dataUrlToBlob(s.dataUrl); return this.previewUrl(s); }
        if (s.text != null) return (s._url = 'data:' + (s.ext === 'svg' ? 'image/svg+xml' : 'text/plain') + ';charset=utf-8,' + encodeURIComponent(s.text));
        return '';
    };

    P.openFilePreview = function (src) {
        const s = this.resolvePreviewSource(src);
        if (!s) { this.showToast('الملف غير متاح للمعاينة (ربما بعد إعادة تحميل الصفحة)', 'warning'); return null; }
        (this._previewUrls || []).forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
        this._previewUrls = [];
        this._preview = { src, s, kind: this.previewKind(s), mode: 'view' };
        const esc = (x) => this.escapeHTML(x);
        const k = this._preview.kind;
        const btn = (icon, label, onclick, extra = '') => `<button class="sidebar-btn-util gh-btn" onclick="${onclick}" title="${label}" ${extra}><i class="fa-solid ${icon}"></i><span class="hide-sm">${label}</span></button>`;
        const actions = [
            s.path && s.text != null ? btn('fa-pen-to-square', 'المحرر', `app.closeModals(); app.openProjectFile(app._preview.s.path)`) : '',
            ['image', 'svg'].includes(k) ? btn('fa-sliders', 'تحرير', 'app.openImageEditor(app._preview.src)') : '',
            ['image'].includes(k) ? btn('fa-font', 'استخراج النص', 'app.ocrPreviewImage()') : '',
            ['video'].includes(k) ? btn('fa-clone', 'PiP', 'app.previewPiP()') : '',
            btn('fa-expand', 'ملء الشاشة', 'app.previewFullscreen()'),
            btn('fa-download', 'تحميل', 'app.downloadPreview()')
        ].join('');
        this.openPanel({ title: `${s.name}${s.size ? ' • ' + this.fmtBytes(s.size) : ''}`, icon: 'fa-eye', actions, body: '<div id="pv-root" class="pv-root"></div>' });
        this.renderPreviewBody();
        return this._preview;
    };

    P.renderPreviewBody = function () {
        const pv = this._preview, s = pv.s;
        const root = document.getElementById('pv-root');
        if (!root) return;
        const esc = (x) => this.escapeHTML(x);
        const code = (t) => `<pre class="pv-code" dir="ltr">${esc(t || '')}</pre>`;
        const footer = [];
        const conv = (to) => s.path ? `<button class="sidebar-btn-util gh-btn" onclick="app.convertProjectFile(app._preview.s.path, '${to}')"><i class="fa-solid fa-right-left"></i> → ${to.toUpperCase()}</button>` : '';
        let html = '';
        switch (pv.kind) {
            case 'image':
                html = `<div class="pv-image-wrap" id="pv-zoom-wrap"><img id="pv-img" src="${esc(this.previewUrl(s))}" alt="${esc(s.name)}" style="--z:1"></div>
                    <div class="pv-zoom"><button onclick="app.previewZoom(-1)">−</button><button onclick="app.previewZoom(0)">ملاءمة</button><button onclick="app.previewZoom(1)">+</button><span id="pv-dim"></span></div>
                    <div id="pv-ocr" class="gh-card gh-md" style="display:none"></div>`;
                setTimeout(() => { const img = document.getElementById('pv-img'); if (img) img.onload = () => { const d = document.getElementById('pv-dim'); if (d) d.textContent = `${img.naturalWidth}×${img.naturalHeight}`; }; }, 0);
                break;
            case 'svg':
                html = pv.mode === 'source' ? code(s.text) : `<div class="pv-image-wrap checker"><img src="${esc(this.previewUrl(s))}" alt="${esc(s.name)}"></div>`;
                footer.push(`<button class="sidebar-btn-util gh-btn" onclick="app.togglePreviewMode()"><i class="fa-solid fa-code"></i> ${pv.mode === 'source' ? 'المعاينة' : 'المصدر'}</button>`);
                break;
            case 'markdown':
                html = pv.mode === 'source' ? code(s.text) : `<div class="gh-md pv-md">${this.renderMarkdownSafe ? this.renderMarkdownSafe(s.text) : esc(s.text)}</div>`;
                footer.push(`<button class="sidebar-btn-util gh-btn" onclick="app.togglePreviewMode()"><i class="fa-solid fa-code"></i> ${pv.mode === 'source' ? 'المعاينة' : 'المصدر'}</button>`);
                break;
            case 'json': {
                let data, err = null;
                try { data = JSON.parse(s.text || ''); } catch (e) { err = e.message; }
                if (err) html = `<div class="gh-card bad-card">❌ JSON غير صالح: ${esc(err)}</div>${code(s.text)}`;
                else if (pv.mode === 'source') html = code(JSON.stringify(data, null, 2));
                else { pv.json = data; html = this.renderJsonTree(data); }
                footer.push(`<button class="sidebar-btn-util gh-btn" onclick="app.togglePreviewMode()"><i class="fa-solid fa-code"></i> ${pv.mode === 'source' ? 'الشجرة' : 'المصدر'}</button>`, conv('yaml'), conv('csv'));
                if (!err && s.path) footer.push('<span class="gh-spacer"></span><button class="btn-new-thread gh-btn" onclick="app.saveJsonTree()"><i class="fa-solid fa-floppy-disk"></i> حفظ التعديلات</button>');
                break;
            }
            case 'csv': {
                const rows = this.parseCSV(s.text || '', s.ext === 'tsv' ? '\t' : undefined);
                pv.rows = rows; pv.delim = s.ext === 'tsv' ? '\t' : ((s.text || '').split('\n')[0].includes(';') && !(s.text || '').split('\n')[0].includes(',') ? ';' : ',');
                html = this.renderCsvTable(rows, !!s.path);
                footer.push(conv('json'), conv('yaml'));
                if (s.path) footer.push(`<button class="sidebar-btn-util gh-btn" onclick="app.csvAddRow()"><i class="fa-solid fa-plus"></i> صف</button><button class="sidebar-btn-util gh-btn" onclick="app.csvAddCol()"><i class="fa-solid fa-plus"></i> عمود</button><span class="gh-spacer"></span><button class="btn-new-thread gh-btn" onclick="app.saveCsvTable()" ${rows.length > 2000 ? 'disabled title="الجدول كبير — حرر في المحرر"' : ''}><i class="fa-solid fa-floppy-disk"></i> حفظ</button>`);
                break;
            }
            case 'html':
                // Sandboxed (no allow-same-origin): user HTML cannot reach this app's storage or keys
                html = pv.mode === 'source' ? code(s.text) : `<iframe class="pv-frame" sandbox="allow-scripts allow-forms allow-modals" srcdoc="${esc(s.text || '')}" title="معاينة HTML"></iframe>`;
                footer.push(`<button class="sidebar-btn-util gh-btn" onclick="app.togglePreviewMode()"><i class="fa-solid fa-code"></i> ${pv.mode === 'source' ? 'المعاينة' : 'المصدر'}</button>`);
                break;
            case 'pdf': {
                const url = this.previewUrl(s);
                html = pv.mode === 'text' ? code(s.docText || '') : url ? `<iframe class="pv-frame tall" src="${esc(url)}" title="PDF"></iframe>` : code(s.docText || 'لا توجد بيانات');
                if (s.docText) footer.push(`<button class="sidebar-btn-util gh-btn" onclick="app.togglePreviewMode('text')"><i class="fa-solid fa-align-right"></i> ${pv.mode === 'text' ? 'عرض PDF' : 'النص المستخرج'}</button>`);
                break;
            }
            case 'doc':
                html = `<div class="pv-doc">${esc(s.docText || '').replace(/\n/g, '<br>')}</div>`;
                break;
            case 'sheet': {
                const sheets = s.sheets || [];
                pv.sheet = Math.min(pv.sheet || 0, Math.max(0, sheets.length - 1));
                html = sheets.length ? `<div class="gh-toolbar">${sheets.map((sh, i) => `<button class="gh-chip ${i === pv.sheet ? 'active' : ''}" onclick="app._preview.sheet=${i}; app.renderPreviewBody()">${esc(sh.name)}</button>`).join('')}</div>${this.renderCsvTable(this.parseCSV(sheets[pv.sheet].csv, ','), false)}` : code(s.docText);
                if (sheets.length) footer.push(`<button class="sidebar-btn-util gh-btn" onclick="app.saveSheetToProject()"><i class="fa-solid fa-file-csv"></i> حفظ الورقة كـ CSV في المشروع</button>`);
                break;
            }
            case 'audio':
                html = `<div class="pv-media"><i class="fa-solid fa-music pv-media-icon"></i><audio id="pv-media" controls preload="metadata" src="${esc(this.previewUrl(s))}"></audio></div>`;
                footer.push(this.speedSelect());
                break;
            case 'video':
                html = `<div class="pv-media"><video id="pv-media" controls preload="metadata" playsinline src="${esc(this.previewUrl(s))}"></video></div>`;
                footer.push(this.speedSelect());
                break;
            case 'font': {
                const fam = 'oxfont_' + Math.random().toString(36).slice(2, 8);
                html = `<div class="pv-font" style="font-family:'${fam}', sans-serif">${[48, 32, 20, 14].map(px => `<div style="font-size:${px}px">أبجد هوز حطي كلمن — The quick brown fox 0123456789</div>`).join('')}<div class="text-dim" style="font-family:var(--font-mono);font-size:12px">ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz !@#$%&*()</div></div>`;
                setTimeout(async () => {
                    try { if (typeof FontFace !== 'undefined') { const ff = new FontFace(fam, `url(${this.previewUrl(s)})`); await ff.load(); document.fonts.add(ff); } } catch (e) { const el = root.querySelector('.pv-font'); if (el) el.insertAdjacentHTML('afterbegin', '<div class="text-red">تعذر تحميل الخط</div>'); }
                }, 0);
                break;
            }
            case 'folder': {
                const list = (s.att.zipEntries || []).map(x => x.path);
                html = `<div class="gh-card">${s.att.fileCount || list.length} ملف</div><div class="gh-list">${list.slice(0, 500).map(p => `<div class="gh-check-row" dir="ltr">${esc(p)}</div>`).join('')}</div>`;
                break;
            }
            default:
                html = code(s.text != null ? s.text : (s.docText || ''));
        }
        root.innerHTML = html;
        this.setPanelFooter(footer.filter(Boolean).join(''));
    };
    P.togglePreviewMode = function (alt = 'source') { this._preview.mode = this._preview.mode === alt ? 'view' : alt; this.renderPreviewBody(); };
    P.speedSelect = () => `<label class="gh-check">السرعة <select class="form-input-box" style="width:auto" onchange="document.getElementById('pv-media').playbackRate=+this.value">${[0.5, 0.75, 1, 1.25, 1.5, 2].map(v => `<option ${v === 1 ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`;
    P.previewZoom = function (d) {
        const img = document.getElementById('pv-img');
        if (!img) return;
        const z = d === 0 ? 1 : Math.max(0.1, Math.min(8, (parseFloat(img.style.getPropertyValue('--z')) || 1) * (d > 0 ? 1.25 : 0.8)));
        img.style.setProperty('--z', String(z));
        img.classList.toggle('zoomed', z !== 1);
    };
    P.previewFullscreen = function () {
        const el = document.getElementById('pv-media') || document.getElementById('pv-root');
        if (el && el.requestFullscreen) el.requestFullscreen().catch(() => {});
    };
    P.previewPiP = async function () {
        const v = document.getElementById('pv-media');
        try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else if (v && v.requestPictureInPicture) await v.requestPictureInPicture(); else this.showToast('المتصفح لا يدعم صورة داخل صورة', 'warning'); }
        catch (e) { this.showToast('تعذر تفعيل PiP: ' + this.escapeHTML(e.message), 'error'); }
    };
    P.downloadPreview = function () {
        const s = this._preview?.s;
        if (!s) return;
        const blob = s.blob || (s.dataUrl ? this.dataUrlToBlob(s.dataUrl) : new Blob([s.text != null ? s.text : (s.docText || '')], { type: 'text/plain;charset=utf-8' }));
        this.downloadBlob(blob, s.name.replace(/\/$/, '') || 'file');
    };

    // ---- JSON tree (view + edit leaf values)
    P.renderJsonTree = function (data) {
        const esc = (x) => this.escapeHTML(x);
        let nodes = 0;
        const LIMIT = 4000;
        const leaf = (v, path) => {
            const t = v === null ? 'null' : typeof v;
            const text = t === 'string' ? v : JSON.stringify(v);
            return `<span class="jt-val jt-${t}" contenteditable="true" spellcheck="false" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}" data-path="${esc(JSON.stringify(path))}" data-type="${t}">${esc(text)}</span>`;
        };
        const walk = (v, path, key) => {
            nodes++;
            const label = key === undefined ? '' : `<span class="jt-key">${esc(typeof key === 'number' ? `[${key}]` : key)}</span>: `;
            if (nodes > LIMIT) return '';
            if (v && typeof v === 'object') {
                const isArr = Array.isArray(v);
                const entries = isArr ? v.map((x, i) => [i, x]) : Object.entries(v);
                return `<details class="jt-node" ${path.length < 2 ? 'open' : ''}><summary>${label}<span class="jt-brace">${isArr ? `[${entries.length}]` : `{${entries.length}}`}</span></summary>${entries.map(([k, x]) => walk(x, path.concat([k]), k)).join('')}</details>`;
            }
            return `<div class="jt-leaf">${label}${leaf(v, path)}</div>`;
        };
        const html = walk(data, [], undefined);
        return `<div class="jt-root" dir="ltr">${html}</div>${nodes > LIMIT ? `<div class="gh-card">يعرض أول ${LIMIT} عقدة فقط — استخدم «المصدر» أو المحرر للملفات الضخمة</div>` : ''}`;
    };
    const setByPath = (obj, path, value) => {
        if (!path.length) return value;
        let o = obj;
        for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
        o[path[path.length - 1]] = value;
        return obj;
    };
    P.setByPath = setByPath;
    P.collectJsonTreeEdits = function () {
        const pv = this._preview;
        let data = JSON.parse(JSON.stringify(pv.json));
        document.querySelectorAll('#pv-root .jt-val').forEach(el => {
            const path = JSON.parse(el.dataset.path);
            const raw = el.textContent;
            let v;
            if (el.dataset.type === 'string') { try { const p = JSON.parse(raw); v = typeof p === 'string' ? p : raw; } catch (e) { v = raw; } }
            else { try { v = JSON.parse(raw); } catch (e) { v = raw; } }
            data = setByPath(data, path, v);
        });
        return data;
    };
    P.saveJsonTree = function () {
        const pv = this._preview;
        if (!pv || !pv.s.path) return null;
        const data = this.collectJsonTreeEdits();
        const text = JSON.stringify(data, null, 2) + '\n';
        this.writeProjectFile(pv.s.path, text, 'edit-tree');
        pv.s.text = text; pv.json = data;
        this.showToast('💾 تم حفظ JSON (الإصدار السابق في السجل)', 'success');
        if (this.isCodeStudioOpen && this.activeStudioFile === pv.s.path) this.renderStudioWorkspace();
        return data;
    };

    // ---- CSV table (view + edit)
    P.renderCsvTable = function (rows, editable) {
        const esc = (x) => this.escapeHTML(x);
        if (!rows.length) return '<div class="gh-empty">جدول فارغ</div>';
        const shown = rows.slice(0, 2001);
        const ce = editable ? 'contenteditable="true" onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();this.blur()}"' : '';
        const width = Math.max(...shown.map(r => r.length));
        const pad = (r) => r.concat(Array(Math.max(0, width - r.length)).fill(''));
        return `<div class="csv-wrap"><table class="csv-table" dir="auto"><thead><tr><th class="csv-n">#</th>${pad(shown[0]).map((h, c) => `<th ${ce} data-r="0" data-c="${c}" onclick="if(!event.target.isContentEditable||event.altKey)app.csvSort(${c})">${esc(h)}</th>`).join('')}</tr></thead>
            <tbody>${shown.slice(1).map((r, i) => `<tr><td class="csv-n">${editable ? `<button class="csv-del" onclick="app.csvDeleteRow(${i + 1})" title="حذف الصف">×</button>` : ''}${i + 1}</td>${pad(r).map((v, c) => `<td ${ce} data-r="${i + 1}" data-c="${c}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
            <div class="text-dim" style="font-size:0.74rem;margin-top:4px">${rows.length - 1} صف × ${width} عمود${rows.length > 2001 ? ' — يُعرض أول 2000 صف' : ''}${editable ? ' • عدّل الخلايا مباشرة • Alt+نقر على العنوان للترتيب' : ''}</div>`;
    };
    P.readCsvEdits = function () {
        const pv = this._preview;
        const rows = pv.rows.map(r => r.slice());
        document.querySelectorAll('#pv-root [data-r]').forEach(el => {
            const r = +el.dataset.r, c = +el.dataset.c;
            if (!rows[r]) rows[r] = [];
            while (rows[r].length <= c) rows[r].push('');
            rows[r][c] = el.textContent;
        });
        return rows;
    };
    P.csvAddRow = function () { const pv = this._preview; pv.rows = this.readCsvEdits(); pv.rows.push(Array((pv.rows[0] || ['']).length).fill('')); this.rerenderCsv(); };
    P.csvAddCol = function () { const pv = this._preview; pv.rows = this.readCsvEdits(); pv.rows.forEach((r, i) => r.push(i === 0 ? `col${r.length + 1}` : '')); this.rerenderCsv(); };
    P.csvDeleteRow = function (i) { const pv = this._preview; pv.rows = this.readCsvEdits(); pv.rows.splice(i, 1); this.rerenderCsv(); };
    P.csvSort = function (c) {
        const pv = this._preview; pv.rows = this.readCsvEdits();
        const dir = pv.sortCol === c && pv.sortDir === 1 ? -1 : 1;
        pv.sortCol = c; pv.sortDir = dir;
        const [head, ...body] = pv.rows;
        const num = body.every(r => r[c] === '' || r[c] === undefined || !isNaN(+r[c]));
        body.sort((a, b) => dir * (num ? (+a[c] || 0) - (+b[c] || 0) : String(a[c] || '').localeCompare(String(b[c] || ''), 'ar')));
        pv.rows = [head, ...body];
        this.rerenderCsv();
    };
    P.rerenderCsv = function () { const root = document.getElementById('pv-root'); if (root) root.innerHTML = this.renderCsvTable(this._preview.rows, !!this._preview.s.path); };
    P.saveCsvTable = function () {
        const pv = this._preview;
        if (!pv || !pv.s.path) return null;
        const rows = this.readCsvEdits();
        const text = this.stringifyCSV(rows, pv.delim || ',');
        this.writeProjectFile(pv.s.path, text, 'edit-table');
        pv.s.text = text; pv.rows = rows;
        this.showToast('💾 تم حفظ الجدول (الإصدار السابق في السجل)', 'success');
        return text;
    };
    P.saveSheetToProject = function () {
        const pv = this._preview, sh = (pv.s.sheets || [])[pv.sheet || 0];
        if (!sh) return null;
        const path = this.uniqueProjectPath(`${pv.s.name.replace(/\.[^.]+$/, '')}-${sh.name}.csv`.replace(/[\\/:*?"<>|]+/g, '_'));
        this.createProjectFile(path, sh.csv.endsWith('\n') ? sh.csv : sh.csv + '\n', { open: false });
        this.showToast(`📄 تم حفظ ${this.escapeHTML(path)}`, 'success');
        return path;
    };

    // ---- OCR through a vision model
    P.ocrImageDataUrl = async function (dataUrl, targetId) {
        if (!this.settings.apiKey?.trim() || !this.streamOpenRouter) { this.showToast('يلزم مفتاح OpenRouter لاستخراج النص', 'warning'); return null; }
        const model = (this.routeForCategory && this.routeForCategory('vision')) || 'google/gemma-3-27b-it:free';
        const box = targetId ? document.getElementById(targetId) : null;
        if (box) { box.style.display = ''; box.innerHTML = '<span class="live-step-spinner"></span> نموذج الرؤية يقرأ الصورة...'; }
        try {
            const r = await this.streamOpenRouter({
                model, maxTokens: 3000,
                messages: [{ role: 'user', content: [
                    { type: 'text', text: 'Extract ALL text in this image exactly as written (any language, keep Arabic as Arabic). Preserve line breaks; render tables as Markdown tables. Output only the extracted text, no commentary. If there is no text, output: (لا يوجد نص)' },
                    { type: 'image_url', image_url: { url: dataUrl } }
                ] }],
                onDelta: (c) => { if (box) box.innerHTML = `<pre class="pv-ocr-text">${this.escapeHTML(c)}</pre>`; }
            });
            this._lastOcr = r.content || '';
            if (box) {
                const ref = this.ghRef ? this.ghRef(this._lastOcr) : 0;
                box.innerHTML = `<pre class="pv-ocr-text">${this.escapeHTML(this._lastOcr)}</pre><div class="gh-toolbar"><span class="gh-spacer"></span>
                    <button class="sidebar-btn-util gh-btn" onclick="app.copyText(app._lastOcr, 'تم نسخ النص')"><i class="fa-solid fa-copy"></i> نسخ</button>
                    <button class="sidebar-btn-util gh-btn" onclick="app.insertIntoInput(app._lastOcr)"><i class="fa-solid fa-arrow-turn-down"></i> إلى حقل الرسالة</button>
                    <button class="sidebar-btn-util gh-btn" onclick="app.saveOcrToProject()"><i class="fa-solid fa-floppy-disk"></i> حفظ كملف</button></div>`;
            }
            if (this.recordUsage) this.recordUsage({ model, usage: r.usage, promptChars: 200, completionChars: (r.content || '').length, durationMs: r.durationMs, source: 'ocr' });
            return this._lastOcr;
        } catch (e) {
            if (box) box.innerHTML = `<span class="text-red">❌ ${this.escapeHTML(e.message)}</span>`;
            return null;
        }
    };
    P.ocrPreviewImage = async function () {
        const s = this._preview?.s;
        if (!s) return null;
        const dataUrl = s.dataUrl || (s.blob ? await blobToDataUrl(s.blob) : null);
        if (!dataUrl) return null;
        return this.ocrImageDataUrl(dataUrl, 'pv-ocr');
    };
    P.insertIntoInput = function (text) {
        const input = document.getElementById('user-input');
        if (!input) return;
        input.value = (input.value ? input.value + '\n\n' : '') + text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        this.closeModals();
        input.focus();
    };
    P.saveOcrToProject = function () {
        const name = (this._preview?.s?.name || 'image').replace(/\.[^.]+$/, '');
        const p = this.uniqueProjectPath(`ocr/${name}.md`);
        this.createProjectFile(p, this._lastOcr || '', { open: false });
        this.showToast(`📄 تم حفظ ${this.escapeHTML(p)}`, 'success');
        return p;
    };

    // ------------------------------------------------------------------ IMAGE EDITOR
    P.loadImageElement = function (url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('تعذر تحميل الصورة'));
            img.src = url;
        });
    };
    /** Fit (w,h) inside (maxW,maxH) keeping aspect ratio; never upscales. */
    P.fitDimensions = function (w, h, maxW, maxH) {
        const r = Math.min(1, (maxW || Infinity) / w, (maxH || Infinity) / h);
        return { w: Math.max(1, Math.round(w * r)), h: Math.max(1, Math.round(h * r)) };
    };
    P.supportedImageFormats = function () {
        if (this._imgFormats) return this._imgFormats;
        const out = ['image/png', 'image/jpeg'];
        try {
            const c = document.createElement('canvas'); c.width = c.height = 1;
            ['image/webp', 'image/avif'].forEach(t => { try { if (c.toDataURL(t).startsWith('data:' + t)) out.push(t); } catch (e) {} });
        } catch (e) {}
        return (this._imgFormats = out);
    };
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
        let url = s.dataUrl || (s.blob ? URL.createObjectURL(s.blob) : this.previewUrl(s));
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
        const dataUrl = await blobToDataUrl(blob);
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
                this.currentAttachments[i] = { ...a, base64: await blobToDataUrl(blob), size: blob.size, mime: st.format, name: a.name.replace(/\.[^.]+$/, '') + '.' + ext };
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
        if (typeof MediaRecorder === 'undefined') return null;
        return cands.find(t => (MediaRecorder.isTypeSupported ? MediaRecorder.isTypeSupported(t) : false)) || '';
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
        const supported = typeof MediaRecorder !== 'undefined' && navigator.mediaDevices && (r.mode === 'screen' ? navigator.mediaDevices.getDisplayMedia : navigator.mediaDevices.getUserMedia);
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
            const md = navigator.mediaDevices;
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
        r.recorder = new MediaRecorder(r.stream, mime ? { mimeType: mime } : undefined);
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
        r.blob = new Blob(r.chunks, { type: (r.mime || '').split(';')[0] || 'audio/webm' });
        r.url = URL.createObjectURL(r.blob);
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

    // ------------------------------------------------------------------ MEDIA GALLERY (IndexedDB)
    const MEDIA_INDEX = 'media_index_v1';
    P.loadMediaItems = async function () {
        if (this._mediaLoaded) return this.mediaItems;
        this.mediaItems = this.mediaItems || [];
        if (!this.idbGet) { this._mediaLoaded = true; return this.mediaItems; }
        try {
            const index = (await this.idbGet(MEDIA_INDEX)) || [];
            for (const meta of index) {
                if (this.mediaItems.some(m => m.id === meta.id)) continue;
                const data = await this.idbGet('media:' + meta.id);
                if (data) this.mediaItems.push({ ...meta, blob: new Blob([data], { type: meta.type }) });
            }
        } catch (e) {}
        this._mediaLoaded = true;
        return this.mediaItems;
    };
    P.saveMediaIndex = async function () {
        if (!this.idbSet) return;
        try { await this.idbSet(MEDIA_INDEX, this.mediaItems.map(({ blob, ...meta }) => meta)); } catch (e) {}
    };
    P.addMediaItem = async function (blob, name) {
        await this.loadMediaItems();
        const type = blob.type || this.mimeForName(name);
        const item = { id: 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, type, kind: type.split('/')[0], size: blob.size, created: Date.now(), blob };
        this.mediaItems.unshift(item);
        if (this.idbSet) {
            try { await this.idbSet('media:' + item.id, await (blob.arrayBuffer ? blob.arrayBuffer() : readAs(blob, 'arrayBuffer'))); await this.saveMediaIndex(); }
            catch (e) { this.showToast('⚠️ تعذر الحفظ الدائم (المساحة ممتلئة؟) — سيبقى حتى إغلاق الصفحة', 'warning'); }
        }
        return item;
    };
    P.deleteMediaItem = async function (id) {
        this.mediaItems = (this.mediaItems || []).filter(m => m.id !== id);
        if (this.idbSet) { try { await this.idbSet('media:' + id, null); await this.saveMediaIndex(); } catch (e) {} }
        if (document.getElementById('gallery-grid')) this.renderMediaGallery();
    };
    /** Images from all chats (attachments) + saved media. */
    P.collectGalleryItems = function () {
        const items = (this.mediaItems || []).map(m => ({ key: m.id, source: { media: m.id }, name: m.name, kind: m.kind, size: m.size, created: m.created, url: null, blob: m.blob, deletable: true }));
        const seen = new Set();
        const pushImg = (a, when, where) => {
            if (!a || !a.isImage || !a.base64 || seen.has(a.base64.length + a.name)) return;
            seen.add(a.base64.length + a.name);
            items.push({ key: 'img' + items.length, source: { blob: this.dataUrlToBlob(a.base64), name: a.name }, name: a.name, kind: 'image', size: a.size || Math.round(a.base64.length * 0.75), created: when, url: a.base64, where });
        };
        (this.currentAttachments || []).forEach(a => pushImg(a, Date.now(), 'مرفق حالي'));
        (this.sessions || []).forEach(s => (s.messages || []).forEach(m => (m.attachments || []).forEach(a => pushImg(a, m.timestamp || s.updatedAt || 0, s.title))));
        return items.sort((a, b) => (b.created || 0) - (a.created || 0));
    };
    P.openMediaGallery = async function (filter = 'all') {
        this._galleryFilter = filter;
        this.openPanel({
            title: 'معرض الوسائط', icon: 'fa-photo-film',
            actions: `<button class="sidebar-btn-util gh-btn" onclick="app.openRecorder('audio')"><i class="fa-solid fa-circle-dot"></i><span class="hide-sm">تسجيل جديد</span></button>`,
            tabs: [['all', 'fa-border-all', 'الكل'], ['image', 'fa-image', 'صور'], ['audio', 'fa-music', 'صوت'], ['video', 'fa-film', 'فيديو']].map(([id, icon, label]) => ({ id, icon, label, onclick: `app.openMediaGallery('${id}')` })),
            activeTab: filter, body: '<div id="gallery-grid" class="gallery-grid"><div class="gh-empty"><span class="live-step-spinner"></span></div></div>'
        });
        await this.loadMediaItems();
        this.renderMediaGallery();
    };
    P.renderMediaGallery = function () {
        const grid = document.getElementById('gallery-grid');
        if (!grid) return [];
        (this._galleryUrls || []).forEach(u => URL.revokeObjectURL(u));
        this._galleryUrls = [];
        const f = this._galleryFilter || 'all';
        const items = this.collectGalleryItems().filter(x => f === 'all' || x.kind === f);
        this._galleryItems = items;
        const esc = (x) => this.escapeHTML(x);
        const thumb = (x) => {
            const url = x.url || (x.blob ? (this._galleryUrls.push(URL.createObjectURL(x.blob)), this._galleryUrls[this._galleryUrls.length - 1]) : '');
            if (x.kind === 'image') return `<img src="${esc(url)}" alt="" loading="lazy">`;
            if (x.kind === 'video') return `<video src="${esc(url)}" preload="metadata" muted></video><i class="fa-solid fa-play gallery-play"></i>`;
            return `<i class="fa-solid fa-music gallery-audio"></i>`;
        };
        grid.innerHTML = items.length ? items.map((x, i) => `
            <div class="gallery-card" tabindex="0" onclick="app.openGalleryItem(${i})" onkeydown="if(event.key==='Enter')app.openGalleryItem(${i})">
                <div class="gallery-thumb">${thumb(x)}</div>
                <div class="gallery-meta"><span class="truncate" title="${esc(x.name)}">${esc(x.name)}</span><span>${this.fmtBytes(x.size || 0)}${x.where ? ' • ' + esc(x.where) : ''}</span></div>
                ${x.deletable ? `<button class="gallery-del" onclick="event.stopPropagation(); app.deleteMediaItem(app._galleryItems[${i}].key)" aria-label="حذف"><i class="fa-solid fa-trash"></i></button>` : ''}
            </div>`).join('') : `<div class="gh-empty">لا توجد وسائط بعد.<br><span class="text-dim" style="font-size:0.8rem">الصور المرفقة في المحادثات والتسجيلات المحفوظة تظهر هنا.</span></div>`;
        return items;
    };
    P.openGalleryItem = function (i) { const x = this._galleryItems?.[i]; if (x) this.openFilePreview(x.source); };

    // ------------------------------------------------------------------ CHAT EXPORT
    const _origExport = P.exportChat;
    P.buildChatExport = function (session, format) {
        const title = session.title || 'محادثة OX-Alpha Pro';
        const msgs = (session.messages || []).filter(m => m.content || (m.attachments || []).length);
        const clean = (s) => String(s || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        if (format === 'json') {
            return JSON.stringify({ title, exportedAt: new Date().toISOString(), app: 'OX-Alpha Workbench Pro', messages: msgs.map(m => ({ role: m.role, model: m.model || undefined, time: m.timestamp ? new Date(m.timestamp).toISOString() : undefined, content: clean(m.content), attachments: (m.attachments || []).map(a => a.name) })) }, null, 2);
        }
        if (format === 'txt') return `${title}\n${'='.repeat(40)}\n\n` + msgs.map(m => `[${m.role === 'user' ? 'أنت' : 'OX-Alpha' + (m.model ? ' — ' + m.model : '')}]\n${clean(m.content)}\n`).join('\n');
        if (format === 'markdown') return `# ${title}\n*تاريخ التصدير: ${new Date().toLocaleString('ar')}*\n\n---\n\n` + msgs.map(m => `### ${m.role === 'user' ? '👤 المستخدم' : `🤖 OX-Alpha (${m.model || 'AI'})`}\n${clean(m.content)}${(m.attachments || []).length ? `\n\n📎 ${(m.attachments || []).map(a => a.name).join('، ')}` : ''}\n`).join('\n');
        // HTML (also used for PDF printing): self-contained, sanitized
        const esc = (x) => this.escapeHTML(x);
        const md = (t) => (this.renderMarkdownSafe ? this.renderMarkdownSafe(t) : esc(t).replace(/\n/g, '<br>'));
        return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:Cairo,'Segoe UI',Tahoma,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#1e293b;line-height:1.8;background:#fff}
h1{font-size:1.5rem;border-bottom:2px solid #e2e8f0;padding-bottom:8px}.meta{color:#64748b;font-size:.85rem}
.msg{margin:18px 0;padding:14px 16px;border-radius:12px;border:1px solid #e2e8f0;break-inside:avoid}.user{background:#eff6ff;border-color:#bfdbfe}.ai{background:#f8fafc}
.who{font-weight:700;font-size:.85rem;color:#475569;margin-bottom:6px}pre{background:#0f172a;color:#e2e8f0;padding:12px;border-radius:8px;overflow:auto;direction:ltr;text-align:left;white-space:pre-wrap;word-break:break-word}
code{font-family:'JetBrains Mono',Consolas,monospace;font-size:.86em}:not(pre)>code{background:#e2e8f0;padding:1px 5px;border-radius:4px}table{border-collapse:collapse}td,th{border:1px solid #cbd5e1;padding:4px 8px}
.att{font-size:.8rem;color:#64748b;margin-top:6px}img{max-width:100%}@media print{body{margin:0}.msg{border-color:#cbd5e1}}</style></head><body>
<h1>${esc(title)}</h1><div class="meta">OX-Alpha Workbench Pro • ${esc(new Date().toLocaleString('ar'))} • ${msgs.length} رسالة</div>
${msgs.map(m => `<div class="msg ${m.role === 'user' ? 'user' : 'ai'}"><div class="who">${m.role === 'user' ? '👤 أنت' : `🤖 OX-Alpha${m.model ? ' — ' + esc(m.model) : ''}`}</div>${m.role === 'user' ? `<div style="white-space:pre-wrap">${esc(clean(m.content))}</div>` : md(clean(m.content))}${(m.attachments || []).length ? `<div class="att">📎 ${(m.attachments || []).map(a => esc(a.name)).join('، ')}</div>` : ''}</div>`).join('\n')}
</body></html>`;
    };
    P.exportChat = async function (format) {
        const session = this.sessions.find(s => s.id === this.activeSessionId);
        if (!session || !session.messages.length) { this.showToast('لا توجد رسائل لتصديرها في هذه الجلسة', 'warning'); return null; }
        if (!format) {
            const r = await this.showDialog({
                title: '📤 تصدير المحادثة',
                fields: [{ id: 'fmt', label: 'الصيغة', type: 'select', value: 'pdf', options: [{ value: 'pdf', label: 'PDF (طباعة / حفظ كـ PDF)' }, { value: 'html', label: 'HTML صفحة مستقلة' }, { value: 'markdown', label: 'Markdown' }, { value: 'json', label: 'JSON' }, { value: 'txt', label: 'نص عادي' }] }],
                buttons: [{ label: 'تصدير', value: 'ok', primary: true }, { label: 'إلغاء', value: null }]
            });
            if (!r) return null;
            format = r.values.fmt;
        }
        const slug = (session.title || 'chat').replace(/[^\w\u0600-\u06FF]+/g, '-').slice(0, 40) || 'chat';
        const content = this.buildChatExport(session, format === 'pdf' ? 'html' : format);
        if (format === 'pdf') return this.printHTML(content);
        const types = { html: ['text/html', 'html'], markdown: ['text/markdown', 'md'], json: ['application/json', 'json'], txt: ['text/plain', 'txt'] };
        const [type, ext] = types[format] || types.markdown;
        this.downloadBlob(new Blob([content], { type: type + ';charset=utf-8' }), `ox-alpha-${slug}.${ext}`);
        this.showToast(`📥 تم تصدير المحادثة (${ext.toUpperCase()})`, 'success');
        return content;
    };
    /** Print through a hidden iframe → the browser's "Save as PDF". */
    P.printHTML = function (html) {
        const f = document.createElement('iframe');
        f.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0';
        f.setAttribute('aria-hidden', 'true');
        document.body.appendChild(f);
        const doc = f.contentDocument || (f.contentWindow && f.contentWindow.document);
        if (doc) { doc.open(); doc.write(html); doc.close(); }
        setTimeout(() => {
            try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { this.showToast('تعذر فتح الطباعة', 'error'); }
            setTimeout(() => f.remove(), 2000);
        }, 300);
        this.showToast('🖨️ اختر «حفظ كـ PDF» في نافذة الطباعة', 'info');
        return html;
    };

    // ------------------------------------------------------------------ PALETTE + INIT
    const _origPalette = P.buildPaletteCommands;
    if (_origPalette) {
        P.buildPaletteCommands = function () {
            const cmds = _origPalette.call(this).filter(c => c.label !== 'تصدير المحادثة الحالية Markdown');
            const self = this, S = 'الوسائط';
            return cmds.concat([
                { section: 'عام', icon: 'fa-file-export', label: 'تصدير المحادثة (PDF / HTML / MD / JSON)', hint: 'Export chat', run: () => self.exportChat() },
                { section: S, icon: 'fa-microphone', label: 'تسجيل مذكرة صوتية', hint: 'Voice memo', run: () => self.openRecorder('audio') },
                { section: S, icon: 'fa-display', label: 'تسجيل الشاشة', hint: 'Screen recording', run: () => self.openRecorder('screen') },
                { section: S, icon: 'fa-video', label: 'تسجيل من الكاميرا', hint: 'Camera', run: () => self.openRecorder('camera') },
                { section: S, icon: 'fa-photo-film', label: 'معرض الوسائط', hint: 'Gallery', run: () => self.openMediaGallery() },
                { section: S, icon: 'fa-folder-open', label: 'رفع مجلد كامل', hint: 'Folder upload', run: () => self.pickFolderUpload() },
                { section: S, icon: 'fa-sliders', label: 'تحرير/ضغط صورة مرفقة', hint: 'Image editor', run: () => { const i = self.currentAttachments.findIndex(a => a.isImage); if (i === -1) self.showToast('أرفق صورة أولاً', 'warning'); else self.openImageEditor({ attachment: i }); } }
            ]);
        };
    }

    P.openMediaMenu = function (anchor) {
        this.showMenu([
            { icon: 'fa-folder-open', label: 'رفع مجلد كامل', run: () => this.pickFolderUpload() },
            '-',
            { icon: 'fa-microphone-lines', label: 'تسجيل مذكرة صوتية', run: () => this.openRecorder('audio') },
            { icon: 'fa-display', label: 'تسجيل الشاشة', run: () => this.openRecorder('screen') },
            { icon: 'fa-video', label: 'تسجيل من الكاميرا', run: () => this.openRecorder('camera') },
            '-',
            { icon: 'fa-photo-film', label: 'معرض الوسائط', run: () => this.openMediaGallery() },
            { icon: 'fa-file-export', label: 'تصدير المحادثة', run: () => this.exportChat() }
        ], anchor);
    };

    P.initSprint4Media = function () {
        this.initDragDrop();
        const origClose = this.closeModals;
        this.closeModals = function () {
            if (this._rec && this._rec.state !== 'done') this.stopRecorderStreams();
            try { const v = document.getElementById('pv-media'); if (v && !v.paused) v.pause(); } catch (e) {}
            return origClose.apply(this, arguments);
        };
    };
    if (window.app) {
        try { window.app.initSprint4Media(); } catch (e) { console.error('Sprint 4 media init failed', e); }
    }
})();
