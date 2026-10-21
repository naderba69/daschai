/* Shared helpers for the Files & Media chunk (pure where possible — unit-tested through `lib`). */
export const win = () => (typeof window !== 'undefined' ? window : globalThis);
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* quota */ } };
export const uid = (p = 'x') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const extOf = (p) => { const b = String(p || '').split('/').pop(); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
export const baseName = (p) => String(p || '').split('/').pop();
export const dirName = (p) => { const i = String(p).lastIndexOf('/'); return i > 0 ? p.slice(0, i) : ''; };
export const stemOf = (p) => baseName(p).replace(/\.[^.]+$/, '');
export const fmtBytes = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
export const fmtTime = (s) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60), r = s - m * 60; return `${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`; };
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** onclick="…" safe JS call: app.method(arg, …) with JSON args, quotes escaped for a double-quoted attribute. */
export const call = (method, ...args) => esc(`app.${method}(${args.map(a => JSON.stringify(a === undefined ? null : a)).join(',')})`);
export const btn = (icon, label, onclick, cls = 'sidebar-btn-util gh-btn', extra = '') => `<button class="${cls}" onclick="${onclick}" ${extra}><i class="fa-solid ${icon}"></i>${label ? ` <span>${label}</span>` : ''}</button>`;
export const pbtn = (icon, label, onclick, extra = '') => btn(icon, label, onclick, 'btn-new-thread gh-btn', extra);
export const chip = (label, onclick, active = false, extra = '') => `<button class="gh-chip ${active ? 'active' : ''}" onclick="${onclick}" ${extra}>${label}</button>`;
export const card = (title, body, icon = '') => `<div class="fmx-card">${title ? `<div class="fmx-card-h">${icon ? `<i class="fa-solid ${icon}"></i> ` : ''}${title}</div>` : ''}${body}</div>`;
export const empty = (msg, bad = false) => `<div class="gh-empty ${bad ? 'bad' : ''}">${msg}</div>`;
export const field = (id, label, value = '', attrs = '') => `<label class="fmx-field"><span>${label}</span><input id="${id}" class="form-input-box" value="${esc(value)}" ${attrs}></label>`;
export const area = (id, label, value = '', rows = 4, attrs = '') => `<label class="fmx-field"><span>${label}</span><textarea id="${id}" class="form-input-box" rows="${rows}" ${attrs}>${esc(value)}</textarea></label>`;
export const select = (id, label, options, value, attrs = '') => `<label class="fmx-field"><span>${label}</span><select id="${id}" class="form-input-box" ${attrs}>${options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select></label>`;
export const fileInput = (id, accept = '', multiple = false) => `<input id="${id}" type="file" class="form-input-box" ${accept ? `accept="${accept}"` : ''} ${multiple ? 'multiple' : ''}>`;
export const val = (id) => { const el = typeof document !== 'undefined' && document.getElementById(id); return el ? (el.type === 'checkbox' ? el.checked : el.value) : ''; };
export const filesOf = (id) => { const el = typeof document !== 'undefined' && document.getElementById(id); return el && el.files ? Array.from(el.files) : []; };
export const setHTML = (id, html) => { const el = typeof document !== 'undefined' && document.getElementById(id); if (el) el.innerHTML = html; return el; };

// ------------------------------------------------------------------ bytes / base64
export function bytesToB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
}
export function b64ToBytes(b64) { const s = atob(String(b64).replace(/-/g, '+').replace(/_/g, '/')); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
export const bytesToB64url = (bytes) => bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const utf8 = (s) => new TextEncoder().encode(s);
export const fromUtf8 = (b) => new TextDecoder().decode(b);
export function dataUrlToBytes(url) { const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url || ''); if (!m) return null; return { mime: m[1] || 'application/octet-stream', bytes: m[2] ? b64ToBytes(m[3]) : utf8(decodeURIComponent(m[3])) }; }
export const bytesToDataUrl = (bytes, mime) => `data:${mime};base64,${bytesToB64(bytes)}`;
export async function blobBytes(blob) {
    if (blob.arrayBuffer) return new Uint8Array(await blob.arrayBuffer());
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(new Uint8Array(r.result)); r.onerror = rej; r.readAsArrayBuffer(blob); });
}
export const makeBlob = (parts, type) => new (win().Blob)(parts, { type });
export async function sha256Hex(bytes) {
    const d = await (globalThis.crypto || win().crypto).subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}
/** Git blob id (sha1 of "blob <len>\0" + content) — lets us diff the project with a GitHub tree without downloading. */
export async function gitBlobSha(bytes) {
    const head = utf8(`blob ${bytes.length}\0`);
    const all = new Uint8Array(head.length + bytes.length); all.set(head); all.set(bytes, head.length);
    const d = await (globalThis.crypto || win().crypto).subtle.digest('SHA-1', all);
    return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ------------------------------------------------------------------ project file access
/** Bytes of a project entry (text or data URL). */
export function entryBytes(entry) {
    if (!entry) return new Uint8Array(0);
    if (entry.dataUrl) return (dataUrlToBytes(entry.dataUrl) || {}).bytes || new Uint8Array(0);
    return utf8(entry.content || '');
}
export const isTextEntry = (e) => !!e && !e.dataUrl && typeof e.content === 'string';
export const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif', psd: 'image/vnd.adobe.photoshop',
    pdf: 'application/pdf', zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar', json: 'application/json', geojson: 'application/geo+json', csv: 'text/csv', md: 'text/markdown', txt: 'text/plain', html: 'text/html',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', webm: 'video/webm', mp4: 'video/mp4', mov: 'video/quicktime', stl: 'model/stl', obj: 'model/obj', gpx: 'application/gpx+xml', kml: 'application/vnd.google-earth.kml+xml', vtt: 'text/vtt', srt: 'application/x-subrip' };
export const mimeOf = (name) => MIME[extOf(name)] || 'application/octet-stream';
export const kindOf = (name) => {
    const e = extOf(name);
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'psd'].includes(e)) return 'image';
    if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'weba'].includes(e)) return 'audio';
    if (['mp4', 'webm', 'mov', 'mkv', 'ogv', 'm4v'].includes(e)) return 'video';
    if (['zip', 'tar', 'gz', 'tgz', '7z', 'rar'].includes(e)) return 'archive';
    if (['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'odt'].includes(e)) return 'document';
    if (['geojson', 'gpx', 'kml'].includes(e)) return 'geo';
    if (['stl', 'obj'].includes(e)) return '3d';
    if (['md', 'txt', 'rst', 'adoc'].includes(e)) return 'doc';
    if (['json', 'yaml', 'yml', 'toml', 'xml', 'csv', 'tsv', 'sql'].includes(e)) return 'data';
    if (['css', 'scss', 'less', 'sass'].includes(e)) return 'style';
    return 'code';
};

// ------------------------------------------------------------------ canvas
export const newCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
export const canvasToBlob = (c, type = 'image/png', q) => new Promise(res => { if (c.toBlob) c.toBlob(b => res(b), type, q); else res(null); });
export const ctx2d = (c) => c.getContext('2d', { willReadFrequently: true });

// ------------------------------------------------------------------ WAV (PCM 16-bit) encode / decode
export function encodeWAV(channels, sampleRate) {
    const ch = channels.length, len = channels[0] ? channels[0].length : 0;
    const buf = new ArrayBuffer(44 + len * ch * 2), v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + len * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, len * ch * 2, true);
    let o = 44;
    for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { const s = clamp(channels[c][i] || 0, -1, 1); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
    return new Uint8Array(buf);
}
export function decodeWAV(bytes) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('ليس ملف WAV');
    let o = 12, fmt = null;
    while (o + 8 <= bytes.length) {
        const id = tag(o), size = v.getUint32(o + 4, true);
        if (id === 'fmt ') fmt = { ch: v.getUint16(o + 10, true), rate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
        if (id === 'data' && fmt) {
            const n = Math.floor(size / (fmt.bits / 8) / fmt.ch), chans = Array.from({ length: fmt.ch }, () => new Float32Array(n));
            let p = o + 8;
            for (let i = 0; i < n; i++) for (let c = 0; c < fmt.ch; c++) { chans[c][i] = fmt.bits === 16 ? v.getInt16(p, true) / 0x8000 : (v.getUint8(p) - 128) / 128; p += fmt.bits / 8; }
            return { sampleRate: fmt.rate, channels: chans };
        }
        o += 8 + size + (size & 1);
    }
    throw new Error('WAV بدون بيانات');
}

// ------------------------------------------------------------------ FFT (radix-2, in place)
export function fft(re, im, inverse = false) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = (2 * Math.PI / len) * (inverse ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let cr = 1, ci = 0;
            for (let j = 0; j < len / 2; j++) {
                const ar = re[i + j], ai = im[i + j], br = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, bi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
                re[i + j] = ar + br; im[i + j] = ai + bi; re[i + j + len / 2] = ar - br; im[i + j + len / 2] = ai - bi;
                const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
            }
        }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// ------------------------------------------------------------------ text helpers
export const AR_RE = /[\u0600-\u06FF]/;
export function words(text) { return String(text || '').toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean); }
/** Levenshtein-based word alignment → per-word status (pronunciation scoring). */
export function alignWords(target, heard) {
    const a = words(target), b = words(heard);
    const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    const out = [];
    let i = a.length, j = b.length;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { out.unshift({ word: a[i - 1], heard: b[j - 1], ok: a[i - 1] === b[j - 1] }); i--; j--; }
        else if (i > 0 && d[i][j] === d[i - 1][j] + 1) { out.unshift({ word: a[i - 1], heard: null, ok: false }); i--; }
        else { j--; }
    }
    const score = a.length ? Math.round(out.filter(x => x.ok).length / a.length * 100) : 0;
    return { words: out, score };
}
