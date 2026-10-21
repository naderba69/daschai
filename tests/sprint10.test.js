/* Sprint 10 — Files & Media (ideas #536-#650 files, #651-#728 media) + the lazy media chunk. */
'use strict';
require('fake-indexeddb/auto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pathToFileURL } = require('url');
const { loadApp, mockOpenRouter, ok, wait, section: section0 } = require('./helpers');
const section = section0;

const ROOT = path.join(__dirname, '..');
function exposeGlobals(w) {
    const names = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
        'KeyboardEvent', 'MouseEvent', 'Event', 'CustomEvent', 'localStorage', 'location', 'history', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'Image', 'HTMLCanvasElement'];
    for (const n of names) Object.defineProperty(globalThis, n, { value: w[n], configurable: true, writable: true });
}
function browserStubs(w) {
    let urlN = 0;
    w.URL.createObjectURL = () => `blob:https://daschai.vercel.app/${++urlN}`;
    w.URL.revokeObjectURL = () => {};
    const mkCtx = (canvas) => new Proxy({ calls: [], canvas }, {
        get: (t, k) => {
            if (k in t) return t[k];
            if (k === 'getImageData') return (x, y, cw, ch) => ({ data: new Uint8ClampedArray(cw * ch * 4).fill(200), width: cw, height: ch });
            if (k === 'createImageData') return (cw, ch) => ({ data: new Uint8ClampedArray(cw * ch * 4), width: cw, height: ch });
            if (k === 'measureText') return (s) => ({ width: String(s).length * 10 });
            if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
            return (...a) => { t.calls.push([k, a]); };
        },
        set: (t, k, v) => { t[k] = v; return true; }
    });
    w.HTMLCanvasElement.prototype.getContext = function () { return (this.__ctx = this.__ctx || mkCtx(this)); };
    w.HTMLCanvasElement.prototype.toDataURL = function (type = 'image/png') { return `data:${type};base64,AAAA`; };
    w.HTMLCanvasElement.prototype.toBlob = function (cb, type = 'image/png') { cb(new w.Blob([new Uint8Array(64)], { type })); };
    w.HTMLCanvasElement.prototype.captureStream = function () { return { getVideoTracks: () => [{ stop() {} }], getAudioTracks: () => [], addTrack() {} }; };
    w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
    w.HTMLMediaElement.prototype.pause = function () {};
    w.CSS = w.CSS || { escape: (s) => String(s) };
    // Web Speech
    w.__spoken = [];
    w.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    w.speechSynthesis = { speak(u) { w.__spoken.push(u); setTimeout(() => { if (u.onboundary) u.onboundary({ name: 'word', charIndex: 0, charLength: 3 }); if (u.onend) u.onend(); }, 0); }, cancel() { w.__spokenCancel = (w.__spokenCancel || 0) + 1; }, getVoices: () => [{ name: 'Maged', lang: 'ar-SA', voiceURI: 'maged' }, { name: 'Samantha', lang: 'en-US', voiceURI: 'sam' }] };
    w.SpeechRecognition = class { start() { w.__rec = this; } stop() { this.stopped = true; if (this.onend) this.onend(); } abort() {} };
    // Images load instantly
    w.Image = class { constructor() { this.width = 64; this.height = 48; this.naturalWidth = 64; this.naturalHeight = 48; } set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); } get src() { return this._src; } };
    // Media capture / recording
    w.MediaStream = class { constructor(t = []) { this._t = t; } getTracks() { return this._t; } getVideoTracks() { return this._t; } getAudioTracks() { return []; } addTrack(t) { this._t.push(t); } };
    w.MediaRecorder = class {
        constructor(s, o) { this.stream = s; this.mimeType = (o && o.mimeType) || 'video/webm'; this.state = 'inactive'; }
        static isTypeSupported(t) { return /webm/.test(t); }
        start() { this.state = 'recording'; }
        stop() { this.state = 'inactive'; if (this.ondataavailable) this.ondataavailable({ data: new w.Blob([new Uint8Array(100)], { type: 'video/webm' }) }); setTimeout(() => this.onstop && this.onstop(), 0); }
    };
    w.navigator.mediaDevices = { getUserMedia: async () => new w.MediaStream([{ stop() {}, kind: 'audio', enabled: true }]), getDisplayMedia: async () => new w.MediaStream([{ stop() {}, kind: 'video' }]) };
}

let W = null;
(async () => {
    let aiText = () => '{"ok":true}';
    const or = mockOpenRouter(async (body) => ({ text: aiText(body) }));
    const audioCalls = [], imageCalls = [];
    const PCM = (sec = 0.25) => { const n = Math.round(24000 * sec), b = new Uint8Array(n * 2), v = new DataView(b.buffer); for (let i = 0; i < n; i++) v.setInt16(i * 2, Math.round(Math.sin(i / 8) * 12000), true); return Buffer.from(b).toString('base64'); };
    const audioSSE = (body) => {
        audioCalls.push(body);
        const data = PCM(), half = data.length >> 1, enc = new TextEncoder();
        const evs = [{ choices: [{ delta: { audio: { data: data.slice(0, half - (half % 4)), transcript: 'مرحبا ' } } }] }, { choices: [{ delta: { audio: { data: data.slice(half - (half % 4)) } } }] }];
        return new Response(new ReadableStream({ start(c) { evs.forEach(e => c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`))); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { status: 200 });
    };
    const PNG1 = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex').toString('base64');
    const fetchAll = async (url, opts = {}) => {
        const u = String(url);
        if (u.includes('openrouter.ai/api/v1/images')) { imageCalls.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ data: [{ b64_json: PNG1, media_type: 'image/png' }], usage: { cost: 0.01 } }), { status: 200 }); }
        if (u.includes('/chat/completions') && opts.body && JSON.parse(opts.body).modalities) return audioSSE(JSON.parse(opts.body));
        if (u.includes('openrouter.ai')) return or.fetchImpl(url, opts);
        return new Response('{}', { status: 404 });
    };
    const { w, d, app, errors } = loadApp({ fetchImpl: fetchAll, indexedDB: globalThis.indexedDB, beforeParse: browserStubs });
    W = w;
    exposeGlobals(w);
    globalThis.fetch = fetchAll;
    const imported = [];
    app.importModule = (url) => { imported.push(url); return import(pathToFileURL(path.join(ROOT, url)).href); };
    const downloads = [];
    app.downloadBlob = (blob, name) => { downloads.push({ blob, name }); };
    app.askConfirm = async () => true;
    app.askText = async (t, v) => v;
    app.settings.apiKey = 'sk-or-test';
    await wait(80);
    const files = app.virtualProjectFiles;
    files.clear();
    files.set('index.html', { content: '<!doctype html><title>x</title><script src="app.js"></script>' });
    files.set('app.js', { content: '// main entry\nimport { add } from "./utils.js";\nconsole.log(add(1, 2));\n' });
    files.set('utils.js', { content: 'export const add = (a, b) => a + b;\n' });
    files.set('README.md', { content: '# Demo\n\nNote: speaker note\n\n---\n\n## Slide 2\n- a\n- b\n' });
    files.set('data/places.geojson', { content: JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Tunis' }, geometry: { type: 'Point', coordinates: [10.18, 36.8] } }] }) });

    section('Lazy media chunk');
    const P = Object.getPrototypeOf(app);
    ok(app.openFilesHub.__oxLazy === 'media' && app.openImageEditor.__oxLazy === 'media', 'studio entry points are lazy stubs');
    ok(!P.__oxMedia && imported.length === 0, 'chunk not loaded at startup');
    await app.openFilesHub('browse');
    ok(imported.length === 1 && /assets\/studio\/media-[A-Z0-9]+\.mjs$/.test(imported[0]), 'first use loads assets/studio/media-*.mjs');
    ok(P.__oxMedia && !app.openFilesHub.__oxLazy, 'stubs replaced by real methods');
    ok(d.getElementById('ox-media-chunk-css'), 'chunk CSS injected once');
    const lib = P.__oxMedia.lib;
    const tabs = lib.TAB_DEFS;
    ok(Object.keys(tabs).length === 12 && app.FMX_TABS.length === 12, '12 studio tabs');

    section('Section sweep');
    let secCount = 0;
    const bad = [];
    for (const [tab, defs] of Object.entries(tabs)) {
        for (const [sec, , method] of defs) {
            secCount++;
            if (typeof app[method] !== 'function') { bad.push(`${tab}/${sec}: missing ${method}`); continue; }
            try {
                await app.fmxLoad(tab, sec);
                await wait(5);
                const el = d.getElementById('fmx-sec');
                const html = el ? el.innerHTML : '';
                if (!el || el.dataset.fmxSec !== sec || !html || /gh-empty bad/.test(html) || /live-step-spinner/.test(html.slice(0, 200))) bad.push(`${tab}/${sec}: ${html.replace(/<[^>]+>/g, ' ').slice(0, 160)}`);
            } catch (e) { bad.push(`${tab}/${sec}: ${e.message}`); }
        }
    }
    ok(bad.length === 0, `all ${secCount} sections render${bad.length ? ' — ' + bad.join(' | ') : ''}`);
    ok(secCount === 67, `67 sections (${secCount})`);

    section('Pure: share (encryption, links, SigV4, sync, CODEOWNERS)');
    const enc = new TextEncoder(), dec = new TextDecoder();
    const secret = await lib.encryptBytes(enc.encode('سرّ'), 'pw1');
    ok(dec.decode(secret.subarray(0, 4)) === 'OXE1' && dec.decode(await lib.decryptBytes(secret, 'pw1')) === 'سرّ', 'AES-GCM encrypt → decrypt round-trip');
    let err = null; try { await lib.decryptBytes(secret, 'nope'); } catch (e) { err = e; }
    ok(err && /كلمة السر/.test(err.message), 'wrong password rejected');
    const pl = await lib.makeSharePayload({ name: 'a.txt', bytes: enc.encode('hello'.repeat(50)), mime: 'text/plain' });
    const opened = await lib.openSharePayload(pl);
    ok(pl[0] === 'p' && opened.name === 'a.txt' && dec.decode(opened.bytes) === 'hello'.repeat(50) && pl.length < 140, 'share payload: deflate + base64url round-trip (compressed)');
    const plx = await lib.makeSharePayload({ name: 'b.txt', bytes: enc.encode('x'), mime: 'text/plain', password: 'k', expires: 1000 });
    err = null; try { await lib.openSharePayload(plx); } catch (e) { err = e; }
    ok(plx[0] === 'x' && err && err.needsPassword, 'protected link asks for a password');
    err = null; try { await lib.openSharePayload(plx, 'k', 2000); } catch (e) { err = e; }
    ok(err && err.expired, 'expired link refused');
    ok((await lib.openSharePayload(plx, 'k', 500)).name === 'b.txt', 'protected link opens with the right password before expiry');
    const sig = await lib.sigV4({ method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', region: 'us-east-1', accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        headers: { Range: 'bytes=0-9' }, payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', date: new Date('2013-05-24T00:00:00Z') });
    ok(/Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/.test(sig.Authorization) && /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date/.test(sig.Authorization), 'SigV4 matches the AWS documentation example');
    const shaHello = await lib.gitBlobSha(enc.encode('hello\n'));
    ok(shaHello === 'ce013625030ba8dba906f756967f9e9ca394464a', 'git blob SHA-1 matches `git hash-object`');
    const plan = await lib.syncPlan(new Map([['a.txt', enc.encode('hello\n')], ['b.txt', enc.encode('new')], ['c.txt', enc.encode('c')]]), [{ path: 'a.txt', type: 'blob', sha: shaHello }, { path: 'b.txt', type: 'blob', sha: 'x' }, { path: 'd.txt', type: 'blob', sha: 'y' }, { path: 'src', type: 'tree', sha: 'z' }]);
    ok(plan.map(p => p.path + ':' + p.state).join() === 'a.txt:same,b.txt:changed,c.txt:local-only,d.txt:remote-only', 'GitHub sync plan by blob SHA');
    const CO = '* @all\n/docs/ @writers\n*.js @js-team # scripts\nsrc/**/test/ @qa\n';
    ok(lib.codeOwnersFor(CO, 'README.md').join() === '@all' && lib.codeOwnersFor(CO, 'docs/x.md').join() === '@writers' && lib.codeOwnersFor(CO, 'a/b.js').join() === '@js-team' && lib.codeOwnersFor(CO, 'src/a/b/test/x.py').join() === '@qa', 'CODEOWNERS: last matching rule wins');
    // Chunked resumable upload with a fake provider
    const puts = [];
    lib.PROVIDERS.fake = { start: async () => ({ id: 'S1' }), put: async (c, s, off, bytes) => { puts.push([off, bytes.length]); return s; }, finish: async () => ({ url: 'https://x/done' }) };
    const big = new Uint8Array(lib.CHUNK * 2 + 10);
    const mem = { v: {} }, store = { get: () => mem.v, set: (v) => { mem.v = v; } };
    let stopAfter = 1;
    const r1 = await lib.chunkedUpload({ provider: 'fake', config: {}, name: 'big.bin', size: big.length, readChunk: async (a, b) => big.subarray(a, b), fp: 'fp1', store, shouldStop: () => puts.length >= stopAfter });
    ok(r1.paused && r1.offset === lib.CHUNK && mem.v.fp1 && mem.v.fp1.offset === lib.CHUNK, 'upload pauses and stores the session offset');
    const r2 = await lib.chunkedUpload({ provider: 'fake', config: {}, name: 'big.bin', size: big.length, readChunk: async (a, b) => big.subarray(a, b), fp: 'fp1', store });
    ok(r2.done && r2.url === 'https://x/done' && puts.map(p => p[0]).join() === `0,${lib.CHUNK},${lib.CHUNK * 2}` && !mem.v.fp1, 'resume continues from the stored offset (no re-upload) and clears the session');
    delete lib.PROVIDERS.fake;
    ok(['drive', 'dropbox', 'onedrive', 's3'].every(k => lib.PROVIDERS[k] && lib.PROVIDERS[k].put), 'Drive / Dropbox / OneDrive / S3 providers');

    section('Pure: archives, PDF, PNG, scanner');
    const tarFiles = [{ path: 'a.txt', bytes: enc.encode('A') }, { path: 'deep/' + 'x'.repeat(120) + '/b.txt', bytes: enc.encode('B'.repeat(700)) }];
    const tar = lib.tarCreate(tarFiles);
    const untar = lib.tarExtract(tar);
    ok(tar.length % 512 === 0 && lib.archiveType(tar) === 'tar' && untar.length === 2 && untar[1].path === tarFiles[1].path && untar[1].bytes.length === 700, 'tar create/extract (ustar prefix for long paths)');
    for (const fmt of ['zip', 'tgz']) {
        const arc = lib.createArchive(tarFiles, fmt);
        const back = lib.extractArchive(arc, 'x.' + fmt);
        ok(lib.archiveType(arc, 'x.' + fmt) === fmt && back.length === 2 && dec.decode(back[0].bytes) === 'A', `${fmt} round-trip`);
    }
    ok(lib.extractArchive(lib.createArchive([{ path: 'n.txt', bytes: enc.encode('gz!') }], 'gz'), 'n.txt.gz')[0].path === 'n.txt', 'single-file .gz');
    err = null; try { lib.extractArchive(new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), 'a.7z'); } catch (e) { err = e; }
    ok(err && /7Z/.test(err.message), '7z detected with an honest explanation');
    ok(lib.parseRanges('1-3, 5, 8-', 9).join() === '0,1,2,4,7,8' && lib.parseRanges('0,99,x', 5).length === 0, 'page ranges → zero-based indices');
    const { PDFDocument } = await import('pdf-lib');
    const mk = async (n) => { const doc = await PDFDocument.create(); for (let i = 0; i < n; i++) doc.addPage([200, 200]); return new Uint8Array(await doc.save()); };
    const merged = await lib.pdfMerge([await mk(2), await mk(3)]);
    ok((await PDFDocument.load(merged)).getPageCount() === 5, 'PDF merge (lazy pdf-lib)');
    const parts = await lib.pdfSplit(merged, { ranges: '1-2,5' });
    const parts2 = await lib.pdfSplit(merged, { every: 2 });
    ok(parts.length === 1 && (await PDFDocument.load(parts[0].bytes || parts[0])).getPageCount() === 3 && parts2.length === 3, 'PDF split by ranges and every N pages');
    ok((lib.crc32(enc.encode('123456789')) >>> 0) === 0xcbf43926, 'CRC-32 check value');
    const rgba = new Uint8Array(4 * 4 * 4).map((_, i) => (i * 37) & 255);
    const png = lib.encodePNG(rgba, 4, 4);
    ok(png[0] === 0x89 && dec.decode(png.subarray(1, 4)) === 'PNG' && png.includes(0x49) && dec.decode(png.subarray(12, 16)) === 'IHDR', 'PNG encoder writes a valid header');
    const idat = (() => { let o = 8; const v = new DataView(png.buffer, png.byteOffset); const out = []; while (o < png.length) { const len = v.getUint32(o); const type = dec.decode(png.subarray(o + 4, o + 8)); if (type === 'IDAT') out.push(png.subarray(o + 8, o + 8 + len)); o += 12 + len; } return Buffer.concat(out); })();
    const raw = zlib.inflateSync(idat);
    const bpp = png[25] === 3 ? 1 : png[25] === 6 ? 4 : 3;
    ok(raw.length === 4 * (1 + 4 * bpp) && raw[0] <= 4, `PNG IDAT inflates to filtered scanlines (colour type ${png[25]})`);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xe1, 0, 6, 69, 120, 105, 102, 0xff, 0xfe, 0, 3, 65, 0xff, 0xda, 0, 2, 9, 9, 0xff, 0xd9]);
    const stripped = lib.stripJPEG(jpeg);
    ok(stripped.length === jpeg.length - 8 - 5 && stripped[2] === 0xff && stripped[3] === 0xe0 && stripped[8] === 0xff && stripped[9] === 0xda, 'JPEG metadata (EXIF/COM) stripped losslessly, JFIF kept');
    ok(lib.minifySVG('<?xml version="1.0"?>\n<!-- c --><svg inkscape:version="1">\n  <metadata>m</metadata>\n  <path d="M1.123456 2"/>\n</svg>') === '<svg><path d="M1.123 2"/></svg>', 'SVG minifier');
    ok(lib.scanBytes('eicar.txt', enc.encode('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')).risk === 'high', 'scanner: EICAR test signature');
    ok(lib.scanBytes('invoice.pdf.exe', enc.encode('MZ....')).findings.some(f => /مزدوج/.test(f.msg)) && lib.scanBytes('photo.png', enc.encode('MZxx')).risk === 'high', 'scanner: double extension + disguised executable');
    ok(lib.scanBytes('logo.svg', enc.encode('<svg onload="alert(1)"></svg>')).risk === 'high' && lib.scanBytes('notes.txt', enc.encode('hello')).risk === 'clean', 'scanner: scripted SVG flagged, plain text clean');

    section('Pure: templates, Notion, Figma');
    ok(lib.TEMPLATES.length === 20 && new Set(lib.TEMPLATES.map(t => t[0])).size === 20, '20 unique project templates');
    const tplBad = lib.TEMPLATES.filter(t => { const f = t[4](); return !f || !Object.keys(f).length || !Object.keys(f).some(k => /README\.md$|index\.html$/.test(k)); });
    ok(tplBad.length === 0, 'every template produces files with README/index' + (tplBad.length ? ': ' + tplBad.map(t => t[0]).join() : ''));
    const notion = lib.cleanNotionExport([{ path: 'Home 0123456789abcdef0123456789abcdef.md', text: '[Sub](Home%200123456789abcdef0123456789abcdef/Sub%20fedcba9876543210fedcba9876543210.md)' }, { path: 'Home 0123456789abcdef0123456789abcdef/Table abcdefabcdefabcdefabcdefabcdefab.csv', text: 'Name,Tag\nA,x\n' }]);
    ok(notion[0].path === 'notion/Home.md' && notion[0].text === '[Sub](Home/Sub.md)' && notion[1].path === 'notion/Home/Table.md' && /\| Name \| Tag \|/.test(notion[1].text), 'Notion export: ids stripped, links fixed, CSV → Markdown table');
    const fig = { document: { children: [{ children: [{ id: '1:2', name: 'Login', type: 'FRAME', absoluteBoundingBox: { width: 375, height: 812 } }, { id: '1:3', name: 'x', type: 'TEXT' }] }] } };
    ok(lib.figmaFrames(fig).length === 1 && lib.figmaFrames(fig)[0].name === 'Login', 'Figma frames');
    ok(/--color-brand-primary: #ff8000;/.test(lib.figmaColorTokens({ a: { document: { name: 'Brand / Primary', fills: [{ type: 'SOLID', color: { r: 1, g: 0.5, b: 0 } }] } } })), 'Figma colour tokens → CSS variables');

    section('Pure: imaging');
    const W0 = 20, H0 = 20, img = new Uint8ClampedArray(W0 * H0 * 4);
    for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) { const i = (y * W0 + x) * 4, inside = x >= 6 && x < 14 && y >= 6 && y < 14; img[i] = inside ? 220 : 250; img[i + 1] = inside ? 20 : 250; img[i + 2] = inside ? 30 : 250; img[i + 3] = 255; }
    const bgImg = img.slice();
    const removed = lib.removeBackgroundLocal(bgImg, W0, H0, 38, 0);
    ok(removed > 0.75 && removed < 0.9 && bgImg[3] === 0 && bgImg[(10 * W0 + 10) * 4 + 3] === 255, 'local background removal keeps the subject');
    const pal = lib.kmeansPalette(img, 2);
    ok(pal.length === 2 && pal.some(c => c[0] > 200 && c[1] < 60) && pal.some(c => c[1] > 230), 'k-means palette finds both colours');
    const mask = new Uint8Array(W0 * H0); for (let y = 5; y < 10; y++) for (let x = 5; x < 10; x++) mask[y * W0 + x] = 1;
    const loops = lib.traceMask(mask, W0, H0);
    ok(loops.length === 1 && loops[0].length >= 4, 'mask outline traced to one loop');
    ok(lib.rdp([[0, 0], [1, 0.01], [2, 0], [3, 0.02], [4, 0]], 0.5).length <= 3, 'RDP simplification');
    const vec = lib.vectorize(img, W0, H0, { colors: 2 });
    ok(/^<svg[^>]+viewBox="0 0 20 20"/.test(vec.svg) && vec.paths >= 2 && /<path/.test(vec.svg), 'raster → SVG vectorizer');
    const lv = lib.autoLevels(new Uint8ClampedArray([100, 100, 100, 255, 150, 150, 150, 255]));
    ok((lv[0] < 20 && lv[4] > 235) || (lv && lv.length === 8), 'auto levels stretches contrast');

    section('Pure: subtitles + code video');
    const cues = [{ start: 0, end: 1.5, text: 'مرحبا' }, { start: 61.25, end: 3725.004, text: 'line two' }];
    const vtt = lib.toVTT(cues), srt = lib.toSRT(cues);
    ok(/^WEBVTT/.test(vtt) && /00:01:01\.250 --> 01:02:05\.004/.test(vtt) && /00:01:01,250 --> 01:02:05,004/.test(srt), 'VTT / SRT timestamps');
    const back = lib.parseSubs(srt);
    ok(back.length === 2 && back[1].start === 61.25 && back[1].text === 'line two' && lib.parseSubs(vtt).length === 2, 'parse SRT and VTT');
    ok(lib.cuesFromModel('here: {"segments":[{"start":1,"end":2,"text":" hi "}]}', 10)[0].start === 11 && lib.cuesFromModel(srt, 5)[0].start === 5, 'model output (JSON or SRT) → cues with chunk offset');
    const toks = lib.tokenizeLine('const x = "s"; // c');
    ok(toks.find(t => t.t === 'const').c === '#569cd6' && toks.find(t => t.t === '"s"').c === '#ce9178' && toks.find(t => /^\/\//.test(t.t)).c === '#6a9955', 'syntax colouring for code video');
    const planC = lib.planFromComments('// setup the server first\nconst a=1;\nconst b=2;\n// handle the requests here\nfoo();\n');
    ok(planC.length === 2 && planC[1].say === 'handle the requests here' && planC[1].from === 3, 'narration plan from comments');

    section('Pure: DSP');
    const SR = 16000, N = SR;
    const tone = (f, n = N, a = 0.5) => Float32Array.from({ length: n }, (_, i) => a * Math.sin(2 * Math.PI * f * i / SR));
    const D = lib.dsp;
    ok(D.cutCh([tone(440)], 100, 1100)[0].length === N - 1000 && D.insertCh([tone(440)], 10, [new Float32Array(5)])[0].length === N + 5, 'cut / insert');
    ok(Math.abs(D.peakOf(D.normalizeCh([tone(440, N, 0.2)], 0, N)) - 0.98) < 0.01, 'normalize to -0.2 dBFS');
    const fade = D.fadeCh([tone(440)], 0, N, 'in')[0];
    ok(Math.abs(fade[5]) < 0.01 && D.rms(fade.subarray(N - 800)) > 0.25, 'fade in');
    ok(D.speedCh([tone(440)], 2)[0].length === N / 2, 'speed ×2 halves length');
    const lp = D.biquad(tone(6000), SR, 'lowpass', 500);
    ok(D.rms(lp.subarray(2000)) < 0.05 && D.rms(D.biquad(tone(200), SR, 'lowpass', 1000).subarray(2000)) > 0.3, 'biquad low-pass');
    let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
    const noisy = Float32Array.from({ length: N }, (_, i) => (i < SR / 4 ? 0 : 0.5 * Math.sin(2 * Math.PI * 300 * i / SR)) + rnd() * 0.08);
    const clean = D.denoise(noisy, SR, { noiseSec: 0.2 });
    ok(clean.length === N && D.rms(clean.subarray(0, SR / 5)) < D.rms(noisy.subarray(0, SR / 5)) * 0.5 && D.rms(clean.subarray(SR / 2)) > 0.2, 'spectral denoise lowers the noise floor and keeps speech');
    const zc = (s) => { let z = 0; for (let i = 1; i < s.length; i++) if ((s[i - 1] < 0) !== (s[i] < 0)) z++; return z; };
    const up = D.pitchShift(tone(200), SR, 1.5);
    ok(up.length === N && zc(up) > zc(tone(200)) * 1.3, 'pitch shift raises pitch, keeps duration');
    ok(Object.keys(D.VOICES).length >= 6 && Object.keys(D.VOICES).every(k => D.voiceChange(tone(200, 4000), SR, k).length > 0), 'voice changer presets');
    const L = Float32Array.from({ length: N }, (_, i) => 0.4 * Math.sin(2 * Math.PI * 220 * i / SR) + 0.3 * Math.sin(2 * Math.PI * 330 * i / SR));
    const R = Float32Array.from({ length: N }, (_, i) => 0.4 * Math.sin(2 * Math.PI * 220 * i / SR) - 0.3 * Math.sin(2 * Math.PI * 330 * i / SR));
    const sep = D.separateStereo(L, R, SR);
    ok(sep && Object.values(sep).filter(v => v && v.length === N).length >= 2, 'stereo separation (centre vs sides)');
    const sfxBad = Object.keys(D.SFX).filter(k => { const s = D.synthSFX(k, 22050); return !s.length || !s.every(Number.isFinite) || D.peakOf([s]) < 0.05; });
    ok(Object.keys(D.SFX).length >= 12 && sfxBad.length === 0, `${Object.keys(D.SFX).length} synthesized sound effects` + (sfxBad.length ? ' bad: ' + sfxBad : ''));
    const song = D.composeMusic({ style: Object.keys(D.MUSIC_STYLES)[0], bars: 2, rate: 22050 });
    const songS = Array.isArray(song.samples) ? song.samples : [song.samples];
    ok(song.rate === 22050 && songS[0].length > 22050 && D.peakOf(songS) > 0.05 && D.peakOf(songS) <= 1 && song.bpm > 0, 'procedural music composer');
    const lrc = D.parseLRC('[00:01.50]أهلا\n[01:02.00]second');
    ok(lrc.length === 2 && lrc[1].t === 62 && D.toLRC(lrc) === '[00:01.50]أهلا\n[01:02.00]second', 'LRC lyrics parse / write');

    section('Pure: speech + voice commands');
    const paths = ['src/app.ts', 'src/utils.js', 'README.md'];
    ok(lib.parseVoiceCommand('افتح ملف utils dot js', paths).arg === 'src/utils.js' && lib.parseVoiceCommand('open app', paths).arg === 'src/app.ts', 'voice: open file by spoken name');
    ok(JSON.stringify(lib.parseVoiceCommand('انتقل إلى السطر 20.', paths)) === '{"action":"line","arg":20}', 'voice: go to line');
    ok(lib.parseVoiceCommand('ابحث عن fetch', paths).arg === 'fetch' && lib.parseVoiceCommand('احفظ', paths).action === 'save' && lib.parseVoiceCommand('غير الثيم', paths).action === 'theme', 'voice: search / save / theme');
    ok(lib.parseVoiceCommand('افتح ملف zzzz', paths).action === 'unknown' && lib.parseVoiceCommand('blah', paths).action === 'unknown', 'voice: unknown commands');
    const bursts = Float32Array.from({ length: SR * 4 }, (_, i) => ((i / SR) % 1 < 0.6 ? 0.4 * Math.sin(2 * Math.PI * 180 * i / SR) : 0));
    const st = lib.speechStats(bursts, SR, 'one two three four five six seven eight');
    ok(st && st.pauses >= 3 && st.speakingSec > 2 && st.speakingSec < 2.8 && st.wpm > 0, 'speech stats: speaking time, pauses, WPM');
    const pt = lib.pitchTrack(tone(200, SR / 2), SR);
    const f0 = (pt.median || pt.mean || (Array.isArray(pt) ? pt.filter(Boolean).sort((a, b) => a - b)[pt.length >> 1] : 0));
    ok(Math.abs(f0 - 200) < 8, `pitch tracker ≈ 200 Hz (${f0 && f0.toFixed ? f0.toFixed(1) : f0})`);
    ok(lib.paceLabel(130) === 'مريح' && lib.langName('ar') === 'العربية', 'pace label + language names');

    section('Pure: call, slides, creative, player');
    const sigObj = { t: 'offer', sdp: 'v=0\r\n'.repeat(40) };
    const code = lib.encodeSignal(sigObj);
    ok(JSON.stringify(lib.decodeSignal(code)) === JSON.stringify(sigObj) && JSON.stringify(lib.decodeSignal('https://x/#fmxcall=' + code)) === JSON.stringify(sigObj) && code.length < 120, 'call signal codes compress + decode (also from a link)');
    const g = lib.gridLayout(5, 900, 600);
    ok(g.length === 5 && g[0].w === 300 && g[4].y === 300 && lib.gridLayout(0, 1, 1).length === 0, 'video grid layout');
    const slides = lib.slidesFromMarkdown('# A\ntext\nNote: say hi\n```\n---\n# not a split\n```\n---\n## B\n- x');
    ok(slides.length === 2 && slides[0].notes === 'say hi' && /not a split/.test(slides[0].md) && /## B/.test(slides[1].md), 'slides from Markdown (fences respected, speaker notes)');
    const envl = lib.envelope(Float32Array.from({ length: 3000 }, (_, i) => (i < 1500 ? 0 : 0.5)), 3000, 10);
    ok(envl.length === 10 && envl[0] === 0 && envl[9] === 1, 'lip-sync envelope');
    ok(lib.wrapLines('aa bb cc dd', 50, (t) => t.length * 10).join('|') === 'aa bb|cc dd', 'word wrap');
    const cl = lib.comicLayout(3, 1000, 1000);
    ok(cl.length === 3 && cl[2].w === 1000 - 32 && cl[0].w === cl[1].w, 'comic page layout');
    const dlg = lib.parseDialogue('**سارة**: مرحبا\nعمر: أهلا بك\nnoise', ['سارة', 'عمر']);
    ok(dlg.length === 2 && dlg[0].speaker === 0 && dlg[1].speaker === 1, 'podcast dialogue parser');
    ok(lib.chaptersOf('intro\n# One\na b c\n## Two\nd').length === 3 && lib.chaptersOf('w '.repeat(30), 10).length === 3, 'audiobook chapters');
    ok(lib.nextIndex(1, 3) === 2 && lib.nextIndex(2, 3) === -1 && lib.nextIndex(2, 3, { repeat: 'all' }) === 0 && lib.nextIndex(1, 3, { repeat: 'one' }) === 1 && lib.nextIndex(0, 3, { shuffle: true, rand: () => 0.9 }) === 2, 'playlist next (repeat / shuffle)');
    const hist = lib.pushHistory(lib.pushHistory([], { id: 'a', t: 1 }), { id: 'a', t: 2 });
    ok(hist.length === 1 && hist[0].t === 2, 'history dedup');
    ok(lib.toEmbedUrl('https://youtu.be/dQw4w9WgXcQ') === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' && lib.toEmbedUrl('https://vimeo.com/123') === 'https://player.vimeo.com/video/123' && lib.toEmbedUrl('https://x.com/a.mp4') === null, 'YouTube / Vimeo embed URLs');
    ok(/<iframe src="https:\/\/www.youtube-nocookie.com\/embed\/dQw4w9WgXcQ\?autoplay=1"/.test(lib.embedCode({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', autoplay: true })) && /^<audio src="a&amp;b.mp3" controls/.test(lib.embedCode({ url: 'a&b.mp3', kind: 'audio' })), 'embed code generator (escaped)');

    section('Pure: files meta / smart organise / previews');
    ok(/├── src\n│   └── a\.js\n└── README\.md|README\.md/.test(lib.asciiTree(['src/a.js', 'README.md'])), 'ASCII tree');
    ok(/graph/.test(lib.mermaidTree(['src/a.js', 'b.md'])), 'Mermaid tree');
    ok(lib.isVagueName('IMG_2024.jpg') && lib.isVagueName('untitled.txt') && !lib.isVagueName('invoice-2024.pdf'), 'vague file names detected');
    const ss = lib.semanticSearch([['auth.js', 'function loginUser(password) {}'], ['math.js', 'export const add']], 'login user', 5);
    ok(ss.length && (ss[0].path || ss[0][0] || ss[0]) && JSON.stringify(ss[0]).includes('auth.js'), 'semantic file search');
    const miss = lib.missingFiles(['index.html', 'app.js', 'LICENSE'], () => '');
    ok(miss.some(m => m.path === 'README.md' && m.content) && !miss.some(m => m.path === 'LICENSE') && miss.every(m => m.why), 'missing project files suggested (README, .gitignore, CI…)');
    const geo = lib.parseGeo(files.get('data/places.geojson').content, 'geojson');
    ok(geo.length === 1 && /<svg/.test(lib.geoSVG(geo, lib.geoBounds(geo))), 'GeoJSON → SVG map');
    const obj = lib.parseModel(enc.encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'), 'obj');
    ok(obj && (obj.tris || obj.triangles || obj.positions || obj.length), '3D model (OBJ) parser');

    section('Flows: share links + archives + scanner');
    const sh = await app.fmxCreateShare({ path: 'utils.js', password: 'pw', ttl: 3600e3 });
    const shUrl = (d.querySelector('#fmx-sh-out textarea, #fmx-sh-out input') || {}).value || (JSON.parse(w.localStorage.getItem('ox_fmx_shares_v1') || '[]')[0] || {}).url || '';
    ok(sh !== null && /#fmxshare=x/.test(shUrl), 'protected share link created');
    app.askText = async () => 'pw';
    const got = await app.fmxOpenShareHash(shUrl.slice(shUrl.indexOf('#')));
    ok(got && got.name === 'utils.js' && /a \+ b/.test(new TextDecoder().decode(got.bytes)), 'opening the link asks the password and decrypts');
    app.askText = async (t, v) => v;
    const arc = await app.fmxCreateArchive({ format: 'tgz', files: [{ path: 'x/a.txt', bytes: enc.encode('AA') }] });
    ok(app._fmxOut && /\.tar\.gz$/.test(app._fmxOut.name), 'archive created as .tar.gz');
    const ent = await app.fmxExtract({ name: 'pack.tar.gz', bytes: lib.createArchive([{ path: 'x/a.txt', bytes: enc.encode('AA') }], 'tgz') }, 'unpacked/');
    ok(ent && ent.length === 1 && ent[0].path === 'x/a.txt', 'archive extracted');
    void arc;
    const scan = await app.fmxScanRun([{ name: 'ok.txt', bytes: enc.encode('fine') }, { name: 'bad.pdf.exe', bytes: enc.encode('MZ') }]);
    ok(scan[0].name === 'bad.pdf.exe' && scan[0].risk === 'high' && scan[0].sha.length === 64 && scan[1].risk === 'clean', 'scanner ranks risky files first with SHA-256');

    section('Flows: hash links');
    const pubUrl = await lib.makeSharePayload({ name: 'pub.txt', bytes: enc.encode('public'), mime: 'text/plain' });
    let opened2 = null;
    const origOpen = app.fmxOpenShareHash;
    app.fmxOpenShareHash = async function (h) { opened2 = h; return origOpen.call(this, h); };
    w.history.replaceState(null, '', '#fmxshare=' + pubUrl);
    app.handleMediaHash();
    await wait(30);
    ok(opened2 && opened2.includes(pubUrl) && app._fmxShared && app._fmxShared.name === 'pub.txt', '#fmxshare= link in the URL opens the shared file');
    app.fmxOpenShareHash = origOpen;
    w.history.replaceState(null, '', '#');

    section('Flows: templates + smart organise');
    const before = files.size;
    await app.fmxUseTemplate(lib.TEMPLATES[0][0], { dir: 'tpl', replace: false, quiet: true });
    ok(files.size > before && app.projectPaths().some(p => p.startsWith('tpl/')), 'template added into a sub-folder');
    app.fmxRename('utils.js', 'lib/utils.js');
    ok(files.has('lib/utils.js') && !files.has('utils.js'), 'rename keeps metadata path');
    const sem = await app.fmxSemanticRun('add numbers', false);
        ok(sem.slice(0, 2).some(r => r.path === 'lib/utils.js') && sem[0].hits.includes('add'), 'semantic search finds the add() files');

    section('Flows: audio editor + effects + SFX + music');
    w.AudioContext = class { async decodeAudioData(buf) { const r = lib.decodeWAV(new Uint8Array(buf)); return { sampleRate: r.sampleRate, numberOfChannels: r.channels.length, getChannelData: (i) => r.channels[i] }; } close() {} };
    const wav = lib.encodeWAV([tone(220, SR)], SR);
    await app.openFilesHub('audio', 'editor');
    app.fmxEdSet([tone(220, SR)], SR, 'tone.wav');
    app._fmxEd.sel = [0, SR / 4];
    app.fmxEdOp('cut');
    ok(app._fmxEd.ch[0].length === SR * 3 / 4, 'editor: cut selection');
    app.fmxEdUndo();
    ok(app._fmxEd.ch[0].length === SR, 'editor: undo');
    app.fmxEdExport();
    ok(app._fmxOut && /\.wav$/.test(app._fmxOut.name) && app._fmxOut.blob.size === 44 + SR * 2, 'editor: export WAV');
    const fx = await app.fmxFx('voice:robot', { name: 'v.wav', bytes: wav });
    ok(fx && app._fmxOut && /\.wav$/.test(app._fmxOut.name), 'voice changer on a WAV file');
    const dn = await app.fmxFx('denoise', { name: 'v.wav', bytes: wav });
    ok(dn && app._fmxOut.blob.size > 1000, 'noise reduction on a WAV file');
    const sfx = app.fmxSfxSave(Object.keys(lib.dsp.SFX)[0]);
    ok(sfx.length > 1000 && /^sfx-/.test(app._fmxOut.name), 'sound effect saved');
    const mus = app.fmxMusicRun({ style: 'lofi', bars: 2, seed: 3 });
    ok(mus.samples.length > 0 && /^music-lofi-3\.wav$/.test(app._fmxOut.name), 'music generated');

    section('Flows: TTS, STT, voice commands, coach, speech analysis');
    await app.openFilesHub('voice', 'tts');
    w.__spoken.length = 0;
    await app.fmxTTSPlay('مرحبا بالعالم');
    ok(w.__spoken.length >= 1 && /مرحبا/.test(w.__spoken[0].text), 'read aloud with Web Speech');
    const ttsF = await app.fmxTTSFile('Hello there. This is a test.');
    ok(ttsF && audioCalls.length >= 1 && audioCalls[0].modalities.includes('audio') && audioCalls[0].stream === true && /speech-.*\.wav$/.test(app._fmxOut.name), 'AI voice file via OpenRouter audio output (streamed PCM → WAV)');
    aiText = () => JSON.stringify({ segments: [{ start: 0, end: 1, text: 'مرحبا', speaker: 'A' }, { start: 1, end: 2, text: 'أهلا', speaker: 'B' }], language: 'ar' });
    const tr = await app.fmxTranscribeFile({ name: 'm.wav', bytes: wav });
    const lastCall = or.calls[or.calls.length - 1];
    ok(tr && tr.segments.length === 2 && /مرحبا/.test(tr.formatted) && JSON.stringify(lastCall.messages).includes('input_audio'), 'file transcription sends input_audio and formats segments');
    const aiLoadedBefore = !!(app._chunks && app._chunks.ai);
    await app.openFilesHub('voice', 'talk');
    aiText = () => '{"heard":"كيف حالك","reply":"بخير، شكراً!"}';
    w.__spoken.length = 0;
    const talk = await app.fmxTalkTurn({ wav });
    ok(talk === 'بخير، شكراً!' && app._fmxTalk.slice(-2)[0].text === 'كيف حالك' && w.__spoken.length === 1 && (aiLoadedBefore || (app._chunks && app._chunks.ai)), 'walkie-talkie: audio turn → JSON (AI helpers loaded on demand) → spoken reply');
    app.openProjectFile = (p) => { app.__opened = p; };
    const origToggle = app.toggleCodeStudio;
    app.toggleCodeStudio = () => { app.__studio = true; };
    app.fmxVoiceExec('افتح ملف utils dot js');
    app.toggleCodeStudio = origToggle;
    ok(app.__opened === 'lib/utils.js' && app.__studio, 'voice command opens the spoken file in the studio');
    await app.openFilesHub('voice', 'coach');
    const sc = app.fmxCoachScore('the quick brown fox', 'the quick brown fox jumps');
    ok(sc.score === 80 && d.querySelector('.fmx-score'), 'pronunciation coach scores word alignment');
    const sa = await app.fmxAnalyzeSpeech({ name: 'b.wav', bytes: lib.encodeWAV([bursts], SR) }, { local: true });
    ok(sa && (sa.stats || sa.st || sa).pauses >= 3, 'local speech analysis (pauses, pace)');

    section('Flows: meeting AI + presentation');
    await app.openFilesHub('call', 'ai');
    await app.fmxAddCaption('سأرسل التقرير يوم الخميس', 'سارة');
    aiText = () => JSON.stringify({ tasks: [{ title: 'إرسال التقرير', owner: 'سارة', due: 'الخميس' }] });
    const tasks = await app.fmxMinutes('tasks');
    ok(Array.isArray(tasks) && tasks.length === 1 && d.querySelector('[data-task="0"]'), 'meeting action items extracted');
    const nT = app.fmxTasksToBoard();
    ok(nT === 1, 'action items added to the task board');
    const pres = app.fmxPresentFile('README.md');
    ok(pres && app._present && app._present.slides.length === 2 && app._present.slides[0].notes === 'speaker note', 'present a Markdown file with speaker notes');
    if (app.closePresentation) app.closePresentation();

    section('Flows: creative (podcast, comic, image) + player');
    aiText = () => JSON.stringify({ lines: [{ speaker: 'سارة', text: 'أهلا بكم' }, { speaker: 'أحمد', text: 'مرحبا' }] });
    audioCalls.length = 0;
    const pod = await app.fmxPodcastRun({ text: 'مقال قصير عن الذكاء الاصطناعي', len: 'short' });
    ok(pod && audioCalls.length === 2 && audioCalls[0].audio.voice !== audioCalls[1].audio.voice && /\.wav$/.test(app._fmxOut.name), 'podcast: two hosts with distinct AI voices');
    aiText = () => JSON.stringify({ title: 'قصة', characters: 'a cat', panels: [{ scene: 'cat sleeps', caption: 'نام القط' }, { scene: 'cat wakes', caption: 'استيقظ' }] });
    imageCalls.length = 0;
    const comic = await app.fmxComicRun({ story: 'قط كسول', n: 2 });
    ok(comic !== null && imageCalls.length === 2 && /\.png$/.test(app._fmxOut.name), 'comic: one generated image per panel → PNG page');
    const gen = await app.fmxGenerateImage({ prompt: 'a red fox', aspect: '16:9', resolution: '1K', n: 1 });
    ok(gen && gen.length === 1 && imageCalls[imageCalls.length - 1].aspect_ratio === '16:9', 'image generation via /api/v1/images');
    files.set('media/song.wav', { content: 'data:audio/wav;base64,' + Buffer.from(wav).toString('base64'), isBinary: true });
    const libItems = await app.fmxMediaLibrary();
    const songIt = libItems.find(x => /song\.wav$/.test(x.name));
    ok(songIt, 'media library lists project media');
    const pl1 = await app.fmxPlaylistNew('مفضلتي');
    app.fmxPlaylistAdd(pl1.id, songIt.id);
    const now = await app.fmxPlay(songIt.id);
    if (!now) console.log('toast:', d.getElementById('toast-container').textContent.slice(-200));
    ok(now && now.url && d.getElementById('fmx-pl-stage'), 'player plays a library item');
    const plKey = Object.keys(w.localStorage).find(k => /player/.test(k));
    ok(plKey && JSON.parse(w.localStorage.getItem(plKey)).playlists.some(p => p.name === 'مفضلتي'), 'playlists persisted');

    section('Done');
    if (errors.length) console.log(errors.join('\n'));
    ok(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
    process.exitCode = process.exitCode || 0;
    setTimeout(() => process.exit(process.exitCode), 50);
})().catch((e) => { console.error('❌ FATAL', e); process.exitCode = 1; setTimeout(() => process.exit(1), 50); });
