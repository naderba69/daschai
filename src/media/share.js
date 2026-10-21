/* Sharing & sync: link (#562) + QR (#561) + password (#563) + expiry (#564), tracked downloads via GitHub release assets (#565),
   S3 / Google Drive / Dropbox (#571) + OneDrive (#573) with chunked (#593) + resumable (#594) uploads, GitHub sync by blob SHA (#572),
   OneDrive folder sync (#573), file permissions: git mode / CODEOWNERS / collaborators (#614 #615), open in a new window (#619). */
import { deflateSync, inflateSync } from 'fflate';
import { esc, call, btn, pbtn, card, empty, field, select, fmtBytes, lsGet, lsSet, uid, baseName, extOf, kindOf, mimeOf, entryBytes, bytesToB64url, b64ToBytes, bytesToB64, utf8, fromUtf8, makeBlob, blobBytes, sha256Hex, gitBlobSha, bytesToDataUrl, val, filesOf, win, isTextEntry } from './shared.js';
import { sourcePicker, readSources } from './core.js';

const SHARES = 'ox_fmx_shares_v1', SESSIONS = 'ox_fmx_upload_sessions_v1', CLOUD = 'ox_fmx_cloud_v1';
export const CHUNK = 5 * 1024 * 1024; // multiple of 256 KiB (Drive) and 320 KiB (OneDrive), S3 minimum part size
const subtle = () => (globalThis.crypto || win().crypto).subtle;
const rand = (n) => (globalThis.crypto || win().crypto).getRandomValues(new Uint8Array(n));

// ------------------------------------------------------------------ password encryption (AES-GCM + PBKDF2)
async function deriveKey(password, salt) {
    const base = await subtle().importKey('raw', utf8(password), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encryptBytes(bytes, password) {
    const salt = rand(16), iv = rand(12), key = await deriveKey(password, salt);
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes));
    const out = new Uint8Array(4 + 16 + 12 + ct.length);
    out.set(utf8('OXE1')); out.set(salt, 4); out.set(iv, 20); out.set(ct, 32);
    return out;
}
export async function decryptBytes(bytes, password) {
    if (fromUtf8(bytes.subarray(0, 4)) !== 'OXE1') throw new Error('ليس ملفاً مشفراً من OX-Alpha');
    const key = await deriveKey(password, bytes.subarray(4, 20));
    try { return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: bytes.subarray(20, 32) }, key, bytes.subarray(32))); } catch (e) { throw new Error('كلمة السر غير صحيحة'); }
}
/** Self-contained share link payload (#562 #563 #564): deflate → (encrypt) → base64url. */
export async function makeSharePayload({ name, bytes, mime, expires = 0, password = '' }) {
    const json = utf8(JSON.stringify({ v: 1, n: name, m: mime, e: expires || 0, d: bytesToB64(bytes) }));
    let body = deflateSync(json, { level: 9 });
    let flag = 'p';
    if (password) { body = await encryptBytes(body, password); flag = 'x'; }
    return flag + bytesToB64url(body);
}
export async function openSharePayload(payload, password = '', now = Date.now()) {
    const flag = payload[0];
    let body = b64ToBytes(payload.slice(1));
    if (flag === 'x') { if (!password) { const e = new Error('هذا الرابط محمي بكلمة سر'); e.needsPassword = true; throw e; } body = await decryptBytes(body, password); }
    const j = JSON.parse(fromUtf8(inflateSync(body)));
    if (j.e && now > j.e) { const e = new Error('انتهت صلاحية رابط المشاركة'); e.expired = true; throw e; }
    return { name: j.n, mime: j.m, expires: j.e, bytes: b64ToBytes(j.d) };
}

// ------------------------------------------------------------------ AWS SigV4 (browser, user-supplied keys)
const hex = (buf) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
const hmac = async (key, msg) => new Uint8Array(await subtle().sign('HMAC', await subtle().importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), utf8(msg)));
export async function sigV4({ method, url, region, accessKey, secretKey, headers = {}, payloadHash = 'UNSIGNED-PAYLOAD', service = 's3', date = new Date() }) {
    const u = new URL(url), amz = date.toISOString().replace(/[:-]|\.\d{3}/g, ''), day = amz.slice(0, 8);
    const h = { ...headers, host: u.host, 'x-amz-date': amz, 'x-amz-content-sha256': payloadHash };
    const names = Object.keys(h).map(k => k.toLowerCase()).sort();
    const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
    const query = Array.from(u.searchParams.entries()).map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
    const canonical = [method, u.pathname.split('/').map(s => encodeURIComponent(decodeURIComponent(s))).join('/'), query, names.map(n => `${n}:${lower[n]}`).join('\n') + '\n', names.join(';'), payloadHash].join('\n');
    const scope = `${day}/${region}/${service}/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', amz, scope, hex(await subtle().digest('SHA-256', utf8(canonical)))].join('\n');
    let k = await hmac(utf8('AWS4' + secretKey), day);
    k = await hmac(k, region); k = await hmac(k, service); k = await hmac(k, 'aws4_request');
    const sig = hex(await hmac(k, toSign));
    delete h.host;
    return { ...h, Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}` };
}

// ------------------------------------------------------------------ chunked + resumable providers
export const PROVIDERS = {
    s3: {
        label: 'Amazon S3', fields: [['bucket', 'Bucket'], ['region', 'Region (مثل eu-west-1)'], ['accessKey', 'Access Key ID'], ['secretKey', 'Secret Access Key', 'password'], ['prefix', 'مجلد (اختياري)']],
        url: (c, key) => `https://${c.bucket}.s3.${c.region}.amazonaws.com/${(c.prefix ? c.prefix.replace(/\/$/, '') + '/' : '') + key}`,
        async start(c, name, size, mime) {
            const url = this.url(c, encodeURIComponent(name)) + '?uploads=';
            const h = await sigV4({ method: 'POST', url, region: c.region, accessKey: c.accessKey, secretKey: c.secretKey, headers: { 'content-type': mime } });
            const res = await fetch(url, { method: 'POST', headers: h });
            const t = await res.text();
            if (!res.ok) throw new Error('S3: ' + ((/<Message>([^<]+)/.exec(t) || [])[1] || res.status));
            return { uploadId: (/<UploadId>([^<]+)/.exec(t) || [])[1], key: encodeURIComponent(name), parts: [] };
        },
        async put(c, s, offset, bytes) {
            const n = Math.floor(offset / CHUNK) + 1, url = `${this.url(c, s.key)}?partNumber=${n}&uploadId=${encodeURIComponent(s.uploadId)}`;
            const h = await sigV4({ method: 'PUT', url, region: c.region, accessKey: c.accessKey, secretKey: c.secretKey });
            const res = await fetch(url, { method: 'PUT', headers: h, body: bytes });
            if (!res.ok) throw new Error('S3 part ' + n + ': HTTP ' + res.status);
            const etag = res.headers.get('ETag');
            if (!etag) throw new Error('S3 لا يعرض ETag — أضف ExposeHeaders: ETag في CORS للحاوية');
            s.parts = s.parts.filter(p => p.n !== n).concat({ n, etag });
            return s;
        },
        async finish(c, s) {
            const url = `${this.url(c, s.key)}?uploadId=${encodeURIComponent(s.uploadId)}`;
            const xml = `<CompleteMultipartUpload>${s.parts.sort((a, b) => a.n - b.n).map(p => `<Part><PartNumber>${p.n}</PartNumber><ETag>${p.etag}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
            const h = await sigV4({ method: 'POST', url, region: c.region, accessKey: c.accessKey, secretKey: c.secretKey, headers: { 'content-type': 'application/xml' } });
            const res = await fetch(url, { method: 'POST', headers: h, body: xml });
            if (!res.ok) throw new Error('S3 complete: HTTP ' + res.status);
            return { url: this.url(c, s.key) };
        }
    },
    drive: {
        label: 'Google Drive', fields: [['token', 'OAuth Access Token (drive.file)', 'password'], ['folder', 'معرّف المجلد (اختياري)']],
        async start(c, name, size, mime) {
            const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', { method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) }, body: JSON.stringify({ name, parents: c.folder ? [c.folder] : undefined }) });
            if (!res.ok) throw new Error('Drive: HTTP ' + res.status);
            return { location: res.headers.get('Location') };
        },
        async status(c, s, size) {
            const res = await fetch(s.location, { method: 'PUT', headers: { 'Content-Range': `bytes */${size}` } });
            if (res.status === 200 || res.status === 201) return size;
            const r = res.headers.get('Range');
            return r ? +r.split('-')[1] + 1 : 0;
        },
        async put(c, s, offset, bytes, size) {
            const res = await fetch(s.location, { method: 'PUT', headers: { 'Content-Range': `bytes ${offset}-${offset + bytes.length - 1}/${size}` }, body: bytes });
            if (res.status !== 308 && !res.ok) throw new Error('Drive chunk: HTTP ' + res.status);
            if (res.ok) s.result = await res.json().catch(() => ({}));
            return s;
        },
        async finish(c, s) { return { url: s.result && s.result.id ? `https://drive.google.com/file/d/${s.result.id}/view` : '' }; }
    },
    dropbox: {
        label: 'Dropbox', fields: [['token', 'Access Token', 'password'], ['folder', 'المجلد (مثل /OX-Alpha)']],
        async start(c) {
            const res = await fetch('https://content.dropboxapi.com/2/files/upload_session/start', { method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Dropbox-API-Arg': JSON.stringify({ close: false }), 'Content-Type': 'application/octet-stream' } });
            if (!res.ok) throw new Error('Dropbox: HTTP ' + res.status);
            return { id: (await res.json()).session_id };
        },
        async put(c, s, offset, bytes) {
            const res = await fetch('https://content.dropboxapi.com/2/files/upload_session/append_v2', { method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Dropbox-API-Arg': JSON.stringify({ cursor: { session_id: s.id, offset }, close: false }), 'Content-Type': 'application/octet-stream' }, body: bytes });
            if (!res.ok) throw new Error('Dropbox chunk: HTTP ' + res.status);
            return s;
        },
        async finish(c, s, name, size) {
            const path = `${(c.folder || '').replace(/\/$/, '')}/${name}`;
            const res = await fetch('https://content.dropboxapi.com/2/files/upload_session/finish', { method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Dropbox-API-Arg': JSON.stringify({ cursor: { session_id: s.id, offset: size }, commit: { path, mode: 'add', autorename: true } }), 'Content-Type': 'application/octet-stream' } });
            if (!res.ok) throw new Error('Dropbox finish: HTTP ' + res.status);
            return { url: 'https://www.dropbox.com/home' + encodeURI(path.replace(/\/[^/]*$/, '')) };
        }
    },
    onedrive: {
        label: 'OneDrive', fields: [['token', 'Microsoft Graph Access Token (Files.ReadWrite)', 'password'], ['folder', 'المجلد (مثل OX-Alpha)']],
        async start(c, name) {
            const p = `${(c.folder || 'OX-Alpha').replace(/^\/|\/$/g, '')}/${name}`.split('/').map(encodeURIComponent).join('/');
            const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${p}:/createUploadSession`, { method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' } }) });
            if (!res.ok) throw new Error('OneDrive: HTTP ' + res.status);
            return { uploadUrl: (await res.json()).uploadUrl };
        },
        async status(c, s) {
            const res = await fetch(s.uploadUrl);
            if (!res.ok) return 0;
            const j = await res.json();
            return j.nextExpectedRanges && j.nextExpectedRanges[0] ? +j.nextExpectedRanges[0].split('-')[0] : 0;
        },
        async put(c, s, offset, bytes, size) {
            const res = await fetch(s.uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${offset}-${offset + bytes.length - 1}/${size}` }, body: bytes });
            if (!res.ok && res.status !== 202) throw new Error('OneDrive chunk: HTTP ' + res.status);
            if (res.status === 200 || res.status === 201) s.result = await res.json().catch(() => ({}));
            return s;
        },
        async finish(c, s) { return { url: (s.result && s.result.webUrl) || '' }; }
    }
};
/** File fingerprint used to resume (#594): name + size + sha256(first 1 MiB). */
export async function fingerprint(name, size, headBytes) { return `${name}|${size}|${(await sha256Hex(headBytes)).slice(0, 16)}`; }

/** Drive a chunked upload; resumes from a stored session with the same fingerprint. */
export async function chunkedUpload({ provider, config, name, size, mime, readChunk, fp, onProgress, shouldStop, store = { get: () => lsGet(SESSIONS, {}), set: (v) => lsSet(SESSIONS, v) } }) {
    const P = PROVIDERS[provider];
    const all = store.get();
    let rec = all[fp] && all[fp].provider === provider ? all[fp] : null;
    let offset = 0;
    if (rec) { offset = rec.offset || 0; if (P.status) { try { offset = await P.status(config, rec.session, size); } catch (e) { /* keep stored offset */ } } }
    else { rec = { provider, name, size, started: Date.now(), offset: 0, session: await P.start(config, name, size, mime) }; }
    const save = () => { const a = store.get(); a[fp] = { ...rec, offset, updated: Date.now() }; store.set(a); };
    save();
    while (offset < size) {
        if (shouldStop && shouldStop()) { save(); return { paused: true, offset }; }
        const bytes = await readChunk(offset, Math.min(size, offset + CHUNK));
        rec.session = await P.put(config, rec.session, offset, bytes, size);
        offset += bytes.length;
        save();
        if (onProgress) onProgress(offset, size);
    }
    const result = await P.finish(config, rec.session, name, size);
    const a = store.get(); delete a[fp]; store.set(a);
    return { done: true, offset, ...result };
}

/** Diff project files vs a GitHub tree by git blob SHA (#572). */
export async function syncPlan(local, remoteTree) {
    const remote = new Map(remoteTree.filter(t => t.type === 'blob').map(t => [t.path, t.sha]));
    const out = [];
    for (const [path, bytes] of local) {
        const sha = await gitBlobSha(bytes);
        if (!remote.has(path)) out.push({ path, state: 'local-only', sha });
        else out.push({ path, state: remote.get(path) === sha ? 'same' : 'changed', sha, remoteSha: remote.get(path) });
    }
    for (const [path, sha] of remote) if (!local.has(path)) out.push({ path, state: 'remote-only', remoteSha: sha });
    return out.sort((a, b) => a.path.localeCompare(b.path));
}
/** CODEOWNERS matching (last matching rule wins). */
export function codeOwnersFor(text, path) {
    let owners = [];
    String(text || '').split('\n').forEach(line => {
        const l = line.replace(/#.*/, '').trim();
        if (!l) return;
        const [pat, ...who] = l.split(/\s+/);
        let re = pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '§').replace(/\*/g, '[^/]*').replace(/§/g, '.*').replace(/\?/g, '.');
        re = pat.startsWith('/') ? '^' + re.slice(1) : '(^|/)' + re;
        re += pat.endsWith('/') ? '' : '($|/)';
        if (new RegExp(re).test(path)) owners = who;
    });
    return owners;
}

export function installShare(P) {
    const pathPick = (app, id, cur) => `<select id="${id}" class="form-input-box">${app.projectPaths().map(p => `<option ${p === cur ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>`;
    const shares = () => lsGet(SHARES, []);
    const cloudCfg = () => lsGet(CLOUD, {});

    // ------------------------------------------------------------------ LINK + QR + PASSWORD + EXPIRY
    P.fmxShareLink = function (opts = {}) {
        const cur = opts.path || this._fmxPropsPath || this.activeStudioFile;
        return card('رابط مشاركة لملف', `<div class="text-dim">الرابط يحمل الملف نفسه (مضغوطاً) داخل الجزء # من العنوان — لا يُرفع لأي خادم. مع كلمة سر يُشفَّر بـ AES-256-GCM. للملفات الكبيرة استخدم «مشاركة مع تتبع».</div>
            <div class="fmx-grid2"><label class="fmx-field"><span>الملف</span>${pathPick(this, 'fmx-sh-path', cur)}</label>
            ${select('fmx-sh-exp', 'انتهاء الصلاحية', [['0', 'بدون'], ['3600000', 'ساعة'], ['86400000', 'يوم'], ['604800000', 'أسبوع'], ['2592000000', 'شهر']], '0')}
            ${field('fmx-sh-pass', 'كلمة سر (اختياري)', '', 'type="password" autocomplete="new-password"')}</div>
            <div class="gh-row">${pbtn('fa-link', 'إنشاء الرابط', 'app.fmxCreateShare()')}</div><div id="fmx-sh-out"></div>`, 'fa-share-nodes');
    };
    P.fmxCreateShare = async function (o) {
        const path = o ? o.path : val('fmx-sh-path'), ttl = +(o ? o.ttl || 0 : val('fmx-sh-exp')), password = o ? o.password || '' : val('fmx-sh-pass');
        const e = this.virtualProjectFiles.get(path);
        if (!e) { this.showToast('اختر ملفاً', 'warning'); return null; }
        const expires = ttl ? Date.now() + ttl : 0;
        const payload = await makeSharePayload({ name: baseName(path), bytes: entryBytes(e), mime: mimeOf(path), expires, password });
        const url = `${this.shareBaseUrl ? this.shareBaseUrl() : location.origin + location.pathname}#fmxshare=${payload}`;
        const rec = { id: uid('sh'), kind: 'link', path, url: url.length > 300 ? url.slice(0, 120) + '…' : url, created: Date.now(), expires, protected: !!password, size: url.length };
        lsSet(SHARES, [rec, ...shares()].slice(0, 100));
        const el = document.getElementById('fmx-sh-out');
        if (el) {
            el.innerHTML = `<div class="gh-row"><input class="form-input-box" dir="ltr" readonly value="${esc(url)}">${btn('fa-copy', 'نسخ', call('copyText', url, 'تم نسخ الرابط'))}</div><div class="text-dim">طول الرابط ${url.length.toLocaleString('ar')} حرف${expires ? ` • ينتهي ${new Date(expires).toLocaleString('ar')}` : ''}${password ? ' • 🔒 محمي' : ''}${url.length > 8000 ? ' • ⚠️ طويل — بعض التطبيقات تقصّه' : ''}</div><div id="fmx-sh-qr" class="share-qr"></div>`;
            if (this.renderQR) this.renderQR(url, 'fmx-sh-qr');
        }
        this._fmxLastShare = url;
        return url;
    };
    /** Opened from #fmxshare=… */
    P.fmxOpenShareHash = async function (hash, passwordArg) {
        const payload = String(hash).replace(/^#?fmxshare=/, '');
        let f;
        try { f = await openSharePayload(payload, passwordArg || ''); } catch (e) {
            if (e.needsPassword) {
                const pw = passwordArg == null ? await this.askText('🔒 ملف محمي', '', { label: 'كلمة السر', type: 'password' }) : null;
                if (pw) return this.fmxOpenShareHash(hash, pw);
            }
            this.showToast('❌ ' + e.message, 'error');
            return null;
        }
        this._fmxShared = f;
        const isText = !['image', 'audio', 'video', 'archive', 'document'].includes(kindOf(f.name));
        this.openPanel({ title: '📥 ملف مُشارك: ' + f.name, icon: 'fa-share-nodes', body: `<div class="fmx-root"><div class="fmx-kv"><span>الاسم</span><b dir="ltr">${esc(f.name)}</b><span>الحجم</span><b>${fmtBytes(f.bytes.length)}</b>${f.expires ? `<span>ينتهي</span><b>${new Date(f.expires).toLocaleString('ar')}</b>` : ''}</div>
            ${isText ? `<pre class="fmx-tree" dir="ltr">${esc(fromUtf8(f.bytes).slice(0, 20000))}</pre>` : kindOf(f.name) === 'image' ? `<img class="fmx-out-img" src="${esc(bytesToDataUrl(f.bytes, f.mime))}" alt="">` : ''}
            <div class="gh-row">${pbtn('fa-folder-plus', 'إضافة للمشروع', 'app.fmxSaveShared(\'project\')')}${btn('fa-download', 'تحميل', 'app.fmxSaveShared(\'download\')')}</div></div>` });
        try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
        return f;
    };
    P.fmxSaveShared = function (target) {
        const f = this._fmxShared;
        if (!f) return null;
        return this.fmxSaveOut(target, { blob: makeBlob([f.bytes], f.mime), name: f.name });
    };

    // ------------------------------------------------------------------ TRACKED SHARES (release assets) #565
    const shareRepo = (app) => { const r = app.ghRepo(); return `/repos/${r.owner}/${r.repo}`; };
    P.fmxTrackedShares = async function () {
        const list = shares().filter(s => s.kind === 'asset');
        return card('مشاركة مع تتبع التحميلات', `<div class="text-dim">يُرفع الملف كأصل (asset) في إصدار مخفي <code>ox-share</code> بمستودعك النشط على GitHub — يعطيك رابط تحميل مباشر ويعدّ GitHub مرات التحميل. يمكن تشفيره بكلمة سر (يفكّه المستلم في «فك ملف مشفّر» أدناه) وتحديد صلاحية تُحذف بعدها.</div>
            <div class="fmx-grid2">${'<div>' + sourcePicker(this, 'fmx-tr-src', ['code', 'doc', 'data', 'style', 'image', 'audio', 'video', 'archive', 'document', 'geo', '3d']) + '</div>'}
            <div>${select('fmx-tr-exp', 'الصلاحية', [['0', 'دائم'], ['86400000', 'يوم'], ['604800000', 'أسبوع'], ['2592000000', 'شهر']], '0')}${field('fmx-tr-pass', 'كلمة سر (تشفير قبل الرفع)', '', 'type="password" autocomplete="new-password"')}</div></div>
            <div class="gh-row">${pbtn('fa-cloud-arrow-up', 'رفع ومشاركة', 'app.fmxTrackedUpload()')}${btn('fa-rotate', 'تحديث العدادات', 'app.fmxTrackedRefresh()')}${btn('fa-broom', 'حذف المنتهية', 'app.fmxTrackedCleanup()')}</div>
            <div id="fmx-tr-list">${list.map(s => `<div class="gh-item static" data-asset="${esc(s.assetId)}"><i class="fa-solid ${s.protected ? 'fa-lock' : 'fa-file-arrow-down'} text-blue"></i><div class="gh-item-main"><b dir="ltr">${esc(s.name)}</b><small>${fmtBytes(s.size || 0)} • ${new Date(s.created).toLocaleDateString('ar')}${s.expires ? ' • ينتهي ' + new Date(s.expires).toLocaleDateString('ar') : ''}</small></div><span class="fmx-count-badge" title="مرات التحميل">⬇ ${s.downloads || 0}</span>${btn('fa-copy', '', call('copyText', s.url, 'تم نسخ الرابط'), 'gh-chip')}${btn('fa-trash', '', call('fmxTrackedDelete', s.assetId), 'gh-chip')}</div>`).join('') || empty('لا مشاركات بعد')}</div>`, 'fa-chart-simple')
            + card('فك ملف مشفّر (.oxenc)', `<div class="gh-row"><input id="fmx-dec-file" type="file" class="form-input-box" accept=".oxenc">${field('fmx-dec-pass', 'كلمة السر', '', 'type="password"')}${btn('fa-unlock', 'فك التشفير', 'app.fmxDecryptFile()')}</div><div id="fmx-out"></div>`, 'fa-unlock');
    };
    P.fmxShareRelease = async function () {
        const base = shareRepo(this);
        const r = await this.gh(`${base}/releases/tags/ox-share`, { allow: [404] });
        if (r && !r.__status) return r;
        return this.gh(`${base}/releases`, { method: 'POST', body: { tag_name: 'ox-share', name: 'OX-Alpha shared files', body: 'ملفات مشاركة من OX-Alpha Workbench (تتبع التحميلات).', prerelease: true } });
    };
    P.fmxTrackedUpload = async function (src, o = {}) {
        if (this.ghRequireToken && !this.ghRequireToken()) return null;
        const [f] = await readSources(this, src || 'fmx-tr-src');
        if (!f) { this.showToast('اختر ملفاً', 'warning'); return null; }
        const password = o.password != null ? o.password : val('fmx-tr-pass'), ttl = +(o.ttl != null ? o.ttl : val('fmx-tr-exp'));
        let bytes = f.bytes, name = f.name.replace(/[^\w.\-]+/g, '_');
        if (password) { bytes = await encryptBytes(bytes, password); name += '.oxenc'; }
        this.showToast('⏳ رفع ' + name + '…', 'info');
        const rel = await this.fmxShareRelease();
        const up = String(rel.upload_url || '').replace(/\{.*$/, '') || `https://uploads.github.com${shareRepo(this)}/releases/${rel.id}/assets`;
        const res = await fetch(`${up}?name=${encodeURIComponent(Date.now().toString(36) + '-' + name)}`, { method: 'POST', headers: { Authorization: `Bearer ${String(this.settings.githubToken || '').trim()}`, 'Content-Type': password ? 'application/octet-stream' : (f.mime || 'application/octet-stream'), Accept: 'application/vnd.github+json' }, body: bytes });
        const a = await res.json().catch(() => ({}));
        if (!res.ok) { this.showToast('❌ ' + (a.message || res.status), 'error'); return null; }
        const rec = { id: uid('sh'), kind: 'asset', assetId: a.id, name, url: a.browser_download_url, size: bytes.length, created: Date.now(), expires: ttl ? Date.now() + ttl : 0, protected: !!password, downloads: a.download_count || 0, repo: shareRepo(this) };
        lsSet(SHARES, [rec, ...shares()]);
        this.showToast('🔗 جاهز — نُسخ الرابط', 'success');
        try { await this.copyText(rec.url, 'تم نسخ الرابط'); } catch (e) {}
        if (document.getElementById('fmx-tr-list')) this.fmxRefresh();
        return rec;
    };
    P.fmxTrackedRefresh = async function () {
        const list = shares();
        const rels = new Map();
        for (const s of list.filter(x => x.kind === 'asset')) {
            if (!rels.has(s.repo)) { const r = await this.gh(`${s.repo}/releases/tags/ox-share`, { allow: [404] }).catch(() => null); rels.set(s.repo, r && !r.__status ? r.assets || [] : []); }
            const a = rels.get(s.repo).find(x => x.id === s.assetId);
            if (a) s.downloads = a.download_count; else s.missing = true;
        }
        lsSet(SHARES, list);
        if (document.getElementById('fmx-tr-list')) this.fmxRefresh();
        return list.filter(x => x.kind === 'asset');
    };
    P.fmxTrackedDelete = async function (assetId) {
        const s = shares().find(x => x.assetId === assetId);
        if (s) await this.gh(`${s.repo}/releases/assets/${assetId}`, { method: 'DELETE', allow: [404] }).catch(() => null);
        lsSet(SHARES, shares().filter(x => x.assetId !== assetId));
        if (document.getElementById('fmx-tr-list')) this.fmxRefresh();
        return true;
    };
    P.fmxTrackedCleanup = async function (now = Date.now()) {
        const expired = shares().filter(s => s.kind === 'asset' && s.expires && s.expires < now);
        for (const s of expired) await this.fmxTrackedDelete(s.assetId);
        this.showToast(`🧹 حُذف ${expired.length} ملف منتهي الصلاحية`, 'success');
        return expired.length;
    };
    P.fmxDecryptFile = async function (fileArg, pwArg) {
        const f = fileArg || filesOf('fmx-dec-file')[0];
        if (!f) return null;
        try {
            const bytes = await decryptBytes(await blobBytes(f), pwArg || val('fmx-dec-pass'));
            const name = f.name.replace(/\.oxenc$/, '').replace(/^[a-z0-9]+-/, '');
            return this.fmxOutput(makeBlob([bytes], mimeOf(name)), name);
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };

    // ------------------------------------------------------------------ CLOUD (chunked + resumable)
    P.fmxCloud = function (opts = {}) {
        const prov = opts.provider || this._fmxProv || 's3', cfg = cloudCfg()[prov] || {};
        this._fmxProv = prov;
        const pending = Object.entries(lsGet(SESSIONS, {}));
        return card('رفع إلى التخزين السحابي', `<div class="gh-row">${Object.entries(PROVIDERS).map(([id, p]) => `<button class="gh-chip ${id === prov ? 'active' : ''}" data-provider="${id}" onclick="${call('fmxLoad', 'share', 'cloud', { provider: id })}">${p.label}</button>`).join('')}</div>
            <div class="text-dim">الرفع مباشرة من متصفحك على أجزاء ${CHUNK / 1048576}MB — إن انقطع الاتصال أعد اختيار الملف نفسه ليُستأنف من آخر جزء. البيانات تُحفظ محلياً في هذا المتصفح فقط.${prov === 's3' ? ' يلزم إعداد CORS للحاوية (AllowedMethods PUT/POST، ExposeHeaders ETag).' : ''}</div>
            <div class="fmx-grid2">${PROVIDERS[prov].fields.map(([k, l, type]) => field('fmx-cl-' + k, l, cfg[k] || '', `dir="ltr" ${type ? `type="${type}"` : ''}`)).join('')}</div>
            <div class="gh-row">${btn('fa-floppy-disk', 'حفظ الإعدادات', call('fmxSaveCloud', prov))}</div>
            <div class="gh-row"><input id="fmx-cl-file" type="file" class="form-input-box" multiple>${pbtn('fa-cloud-arrow-up', 'رفع', call('fmxCloudUpload', prov))}${btn('fa-pause', 'إيقاف مؤقت', 'app._fmxStopUpload=true')}${btn('fa-folder-tree', 'رفع ملفات المشروع (ZIP)', call('fmxCloudUploadProject', prov))}</div>
            <div id="fmx-cl-progress"></div>
            ${pending.length ? card('رفع غير مكتمل (يمكن استئنافه)', pending.map(([fp, s]) => `<div class="gh-item static" data-session="${esc(fp)}"><i class="fa-solid fa-circle-pause text-dim"></i><div class="gh-item-main"><b dir="ltr">${esc(s.name)}</b><small>${PROVIDERS[s.provider] ? PROVIDERS[s.provider].label : s.provider} • ${fmtBytes(s.offset || 0)} / ${fmtBytes(s.size)} (${Math.round((s.offset || 0) / s.size * 100)}%)</small></div>${btn('fa-trash', '', call('fmxForgetSession', fp), 'gh-chip')}</div>`).join('')) : ''}`, 'fa-cloud');
    };
    P.fmxSaveCloud = function (prov, values) {
        const all = cloudCfg();
        all[prov] = values || Object.fromEntries(PROVIDERS[prov].fields.map(([k]) => [k, val('fmx-cl-' + k)]));
        lsSet(CLOUD, all);
        this.showToast('💾 حُفظت إعدادات ' + PROVIDERS[prov].label, 'success');
        return all[prov];
    };
    P.fmxForgetSession = function (fp) { const a = lsGet(SESSIONS, {}); delete a[fp]; lsSet(SESSIONS, a); return this.fmxRefresh(); };
    P.fmxCloudUpload = async function (prov, filesArg) {
        const cfg = PROVIDERS[prov].fields.every(([k]) => val('fmx-cl-' + k) === '' ) ? (cloudCfg()[prov] || {}) : Object.fromEntries(PROVIDERS[prov].fields.map(([k]) => [k, val('fmx-cl-' + k)]));
        const files = filesArg || filesOf('fmx-cl-file');
        if (!files.length) { this.showToast('اختر ملفاً', 'warning'); return []; }
        const results = [];
        this._fmxStopUpload = false;
        for (const f of files) {
            const bar = document.getElementById('fmx-cl-progress');
            const show = (o, s) => { if (bar) bar.innerHTML = `<div class="fmx-progress"><div style="width:${Math.round(o / s * 100)}%"></div></div><div class="text-dim">${esc(f.name)} — ${fmtBytes(o)} / ${fmtBytes(s)}</div>`; };
            try {
                const head = await blobBytes(f.slice(0, 1048576));
                const fp = await fingerprint(f.name, f.size, head);
                const r = await chunkedUpload({ provider: prov, config: cfg, name: f.name, size: f.size, mime: f.type || mimeOf(f.name), fp, readChunk: async (a, b) => blobBytes(f.slice(a, b)), onProgress: show, shouldStop: () => this._fmxStopUpload });
                results.push({ name: f.name, ...r });
                if (r.paused) { this.showToast(`⏸️ أُوقف ${f.name} عند ${fmtBytes(r.offset)} — أعد اختياره للاستئناف`, 'info'); break; }
                this.showToast(`☁️ رُفع ${f.name}`, 'success');
                if (bar && r.url) bar.innerHTML += `<div><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a></div>`;
            } catch (e) { results.push({ name: f.name, error: e.message }); this.showToast('❌ ' + e.message, 'error'); break; }
        }
        return results;
    };
    P.fmxCloudUploadProject = async function (prov) {
        const zip = await this.fmxZipProject();
        return this.fmxCloudUpload(prov, [Object.assign(makeBlob([zip], 'application/zip'), { name: `${(this.ghRepo().repo || 'project')}-${new Date().toISOString().slice(0, 10)}.zip` })]);
    };

    // ------------------------------------------------------------------ GITHUB SYNC (#572) + ONEDRIVE SYNC (#573)
    P.fmxGitSync = function () {
        const r = this.ghRepo();
        return card('مزامنة مع GitHub', `<div class="text-dim">يقارن كل ملف في المشروع بالملف على <b dir="ltr">${esc(r.owner)}/${esc(r.repo)}@${esc(r.branch)}</b> عبر بصمة git (SHA-1) دون تنزيل المحتوى، ثم يسحب أو يدفع الفروقات فقط.</div>
            <div class="gh-row">${pbtn('fa-code-compare', 'مقارنة', 'app.fmxSyncCompare()')}</div><div id="fmx-sync-out"></div>`, 'fa-brands fa-github')
            + card('مزامنة مع OneDrive', `<div class="text-dim">يدفع ملفات المشروع إلى مجلد في OneDrive أو يسحبها منه (يستخدم رمز OneDrive المحفوظ في «التخزين السحابي»).</div>
            <div class="gh-row">${field('fmx-od-folder', 'المجلد', (cloudCfg().onedrive || {}).folder || 'OX-Alpha/project', 'dir="ltr"')}${btn('fa-arrow-up', 'دفع', 'app.fmxOneDriveSync(\'push\')')}${btn('fa-arrow-down', 'سحب', 'app.fmxOneDriveSync(\'pull\')')}</div><div id="fmx-od-out"></div>`, 'fa-cloud');
    };
    P.fmxSyncCompare = async function () {
        const r = this.ghRepo();
        this.fmxBusy('fmx-sync-out', 'جلب شجرة المستودع…');
        try {
            const tree = await this.gh(`/repos/${r.owner}/${r.repo}/git/trees/${encodeURIComponent(r.branch)}?recursive=1`);
            const local = new Map(this.projectPaths().map(p => [p, entryBytes(this.virtualProjectFiles.get(p))]));
            const plan = await syncPlan(local, tree.tree || []);
            this._fmxSync = plan;
            const counts = plan.reduce((m, x) => ((m[x.state] = (m[x.state] || 0) + 1), m), {});
            const label = { same: '✓ متطابق', changed: '✏️ مختلف', 'local-only': '⬆ محلي فقط', 'remote-only': '⬇ على GitHub فقط' };
            const el = document.getElementById('fmx-sync-out');
            if (el) el.innerHTML = `<div class="gh-row">${Object.entries(label).map(([k, l]) => `<span class="fmx-tag">${l}: ${counts[k] || 0}</span>`).join('')}</div>
                <div class="gh-row">${pbtn('fa-arrow-down', 'سحب المختلف والجديد', 'app.fmxSyncPull()')}${btn('fa-arrow-up', 'دفع المختلف والمحلي', 'app.fmxSyncPush()')}</div>
                <table class="fmx-table"><tbody>${plan.filter(x => x.state !== 'same').slice(0, 400).map(x => `<tr data-sync="${esc(x.path)}" data-state="${x.state}"><td dir="ltr">${esc(x.path)}</td><td>${label[x.state]}</td></tr>`).join('') || '<tr><td>✅ كل الملفات متطابقة</td></tr>'}</tbody></table>`;
            return plan;
        } catch (e) { const el = document.getElementById('fmx-sync-out'); if (el) el.innerHTML = empty('❌ ' + esc(e.message), true); return null; }
    };
    P.fmxSyncPull = async function () {
        const r = this.ghRepo(), plan = (this._fmxSync || []).filter(x => x.state === 'changed' || x.state === 'remote-only');
        let n = 0;
        for (const x of plan) {
            const b = await this.gh(`/repos/${r.owner}/${r.repo}/git/blobs/${x.remoteSha}`);
            const bytes = b64ToBytes(String(b.content || '').replace(/\n/g, ''));
            if (['image', 'audio', 'video', 'archive', 'document', '3d'].includes(kindOf(x.path))) this.virtualProjectFiles.set(x.path, { content: '', dataUrl: bytesToDataUrl(bytes, mimeOf(x.path)), binary: true, size: bytes.length, timestamp: Date.now() });
            else this.writeProjectFile(x.path, fromUtf8(bytes), 'sync');
            if (this.recordGitHubBase) this.recordGitHubBase(x.path, fromUtf8(bytes), x.remoteSha);
            n++;
        }
        if (this.renderStudioExplorer) this.renderStudioExplorer();
        this.showToast(`⬇ سُحب ${n} ملف`, 'success');
        await this.fmxSyncCompare();
        return n;
    };
    P.fmxSyncPush = async function (message) {
        if (this.ghRequireToken && !this.ghRequireToken()) return null;
        const r = this.ghRepo(), base = `/repos/${r.owner}/${r.repo}`;
        const plan = (this._fmxSync || []).filter(x => x.state === 'changed' || x.state === 'local-only');
        if (!plan.length) { this.showToast('لا تغييرات للدفع', 'info'); return null; }
        const ref = await this.gh(`${base}/git/ref/heads/${encodeURIComponent(r.branch)}`);
        const head = await this.gh(`${base}/git/commits/${ref.object.sha}`);
        const tree = [];
        for (const x of plan) {
            const bytes = entryBytes(this.virtualProjectFiles.get(x.path));
            const blob = await this.gh(`${base}/git/blobs`, { method: 'POST', body: { content: bytesToB64(bytes), encoding: 'base64' } });
            tree.push({ path: x.path, mode: this.fileMeta(x.path).exec ? '100755' : '100644', type: 'blob', sha: blob.sha });
        }
        const t = await this.gh(`${base}/git/trees`, { method: 'POST', body: { base_tree: head.tree.sha, tree } });
        const c = await this.gh(`${base}/git/commits`, { method: 'POST', body: { message: message || `sync: ${plan.length} files from OX-Alpha`, tree: t.sha, parents: [ref.object.sha] } });
        await this.gh(`${base}/git/refs/heads/${encodeURIComponent(r.branch)}`, { method: 'PATCH', body: { sha: c.sha } });
        this.showToast(`⬆ دُفع ${plan.length} ملف في commit ${c.sha.slice(0, 7)}`, 'success');
        await this.fmxSyncCompare();
        return c.sha;
    };
    P.fmxOneDriveSync = async function (dir, folderArg) {
        const token = (cloudCfg().onedrive || {}).token;
        if (!token) { this.showToast('أضف رمز OneDrive في «التخزين السحابي» أولاً', 'warning'); return null; }
        const folder = (folderArg || val('fmx-od-folder') || 'OX-Alpha/project').replace(/^\/|\/$/g, '');
        const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
        const H = { Authorization: `Bearer ${token}` };
        const out = document.getElementById('fmx-od-out');
        let n = 0;
        try {
            if (dir === 'push') {
                for (const p of this.projectPaths()) {
                    const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${enc(folder + '/' + p)}:/content`, { method: 'PUT', headers: H, body: entryBytes(this.virtualProjectFiles.get(p)) });
                    if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
                    n++;
                    if (out) out.textContent = `⬆ ${n} / ${this.projectPaths().length}`;
                }
            } else {
                const walk = async (path) => {
                    const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${enc(path)}:/children?$top=200`, { headers: H });
                    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
                    for (const it of (await res.json()).value || []) {
                        const rel = (path + '/' + it.name).slice(folder.length + 1);
                        if (it.folder) await walk(path + '/' + it.name);
                        else if (it['@microsoft.graph.downloadUrl'] && it.size < 5 * 1048576) {
                            const bytes = new Uint8Array(await (await fetch(it['@microsoft.graph.downloadUrl'])).arrayBuffer());
                            if (['image', 'audio', 'video', 'archive', 'document', '3d'].includes(kindOf(rel))) this.virtualProjectFiles.set(rel, { content: '', dataUrl: bytesToDataUrl(bytes, mimeOf(rel)), binary: true, size: bytes.length, timestamp: Date.now() });
                            else this.writeProjectFile(rel, fromUtf8(bytes), 'sync');
                            n++;
                            if (out) out.textContent = `⬇ ${n}`;
                        }
                    }
                };
                await walk(folder);
                if (this.renderStudioExplorer) this.renderStudioExplorer();
            }
            this.showToast(`☁️ ${dir === 'push' ? 'دُفع' : 'سُحب'} ${n} ملف`, 'success');
            return n;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };

    // ------------------------------------------------------------------ PERMISSIONS (#614 #615)
    P.fmxPerms = async function (opts = {}) {
        const path = opts.path || this._fmxPropsPath || this.activeStudioFile || this.projectPaths()[0];
        if (!path) return empty('المشروع فارغ');
        this._fmxPropsPath = path;
        const m = this.fileMeta(path), r = this.ghRepo(), base = `/repos/${r.owner}/${r.repo}`;
        let mode = '—', owners = [], collabs = null, remoteErr = '';
        try {
            const tree = await this.gh(`${base}/git/trees/${encodeURIComponent(r.branch)}?recursive=1`);
            const t = (tree.tree || []).find(x => x.path === path);
            mode = t ? t.mode : 'غير موجود على GitHub';
            const co = (tree.tree || []).find(x => /^(\.github\/|docs\/)?CODEOWNERS$/.test(x.path));
            if (co) { const b = await this.gh(`${base}/git/blobs/${co.sha}`); owners = codeOwnersFor(fromUtf8(b64ToBytes(String(b.content || '').replace(/\n/g, ''))), path); }
            if (this.settings.githubToken) collabs = await this.gh(`${base}/collaborators?per_page=50`).catch(() => null);
        } catch (e) { remoteErr = e.message; }
        const levels = ['pull', 'triage', 'push', 'maintain', 'admin'];
        const level = (p) => (p ? levels.slice().reverse().find(l => p[l]) || 'pull' : '?');
        return `<div class="gh-row"><select class="form-input-box" onchange="app.fmxLoad('share','perms',{path:this.value})">${this.projectPaths().map(p => `<option ${p === path ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div>
            ${card('صلاحيات الملف', `<div class="fmx-kv"><span>محلياً</span><b>${m.locked ? '🔒 للقراءة فقط (مقفل)' : '✏️ قراءة وكتابة'}${m.hidden ? ' • مخفي' : ''}</b><span>وضع git</span><b dir="ltr">${esc(mode)}${mode === '100755' ? ' (قابل للتنفيذ)' : mode === '100644' ? ' (ملف عادي)' : ''}</b><span>المالكون (CODEOWNERS)</span><b dir="ltr">${owners.length ? esc(owners.join(' ')) : '—'}</b></div>${remoteErr ? `<div class="text-dim">GitHub: ${esc(remoteErr)}</div>` : ''}
                <div class="gh-row">${btn(m.locked ? 'fa-lock-open' : 'fa-lock', m.locked ? 'السماح بالكتابة' : 'جعله للقراءة فقط', call('fmxToggleMeta', path, 'locked'))}${btn('fa-terminal', m.exec ? 'إلغاء قابلية التنفيذ' : 'جعله قابلاً للتنفيذ (chmod +x)', call('fmxSetExec', path, !m.exec))}</div>`, 'fa-user-lock')}
            ${card('المتعاونون على المستودع', collabs ? collabs.map(c => `<div class="gh-item static" data-collab="${esc(c.login)}"><img class="fmx-avatar" src="${esc(c.avatar_url)}" alt=""><div class="gh-item-main"><b>${esc(c.login)}</b><small>${level(c.permissions)}</small></div><select class="form-input-box" onchange="${call('fmxSetCollabPerm', c.login, '__v').replace('&quot;__v&quot;', 'this.value')}">${levels.map(l => `<option ${l === level(c.permissions) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`).join('') || empty('لا متعاونون') : empty('يلزم رمز GitHub بصلاحية المستودع لعرض المتعاونين'), 'fa-users')}`;
    };
    P.fmxSetExec = async function (path, on) {
        this.setFileMeta(path, { exec: on });
        const r = this.ghRepo(), base = `/repos/${r.owner}/${r.repo}`;
        if (this.settings.githubToken) {
            try {
                const ref = await this.gh(`${base}/git/ref/heads/${encodeURIComponent(r.branch)}`), head = await this.gh(`${base}/git/commits/${ref.object.sha}`);
                const tree = await this.gh(`${base}/git/trees/${head.tree.sha}?recursive=1`), t = (tree.tree || []).find(x => x.path === path);
                if (t) {
                    const nt = await this.gh(`${base}/git/trees`, { method: 'POST', body: { base_tree: head.tree.sha, tree: [{ path, mode: on ? '100755' : '100644', type: 'blob', sha: t.sha }] } });
                    const c = await this.gh(`${base}/git/commits`, { method: 'POST', body: { message: `chore: chmod ${on ? '+x' : '-x'} ${path}`, tree: nt.sha, parents: [ref.object.sha] } });
                    await this.gh(`${base}/git/refs/heads/${encodeURIComponent(r.branch)}`, { method: 'PATCH', body: { sha: c.sha } });
                    this.showToast(`✅ ${on ? 'chmod +x' : 'chmod -x'} على GitHub (${c.sha.slice(0, 7)})`, 'success');
                }
            } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
        } else this.showToast('حُفظ محلياً — سيُطبق عند الدفع', 'info');
        if (this._fmx && this._fmx.sec === 'perms') this.fmxRefresh();
        return on;
    };
    P.fmxSetCollabPerm = async function (login, permission) {
        const r = this.ghRepo();
        try { await this.gh(`/repos/${r.owner}/${r.repo}/collaborators/${encodeURIComponent(login)}`, { method: 'PUT', body: { permission } }); this.showToast(`✅ ${login} ← ${permission}`, 'success'); return true; }
        catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };

    // ------------------------------------------------------------------ NEW WINDOW (#619)
    P.fmxWindows = function () {
        return card('فتح في نافذة جديدة', `<div class="text-dim">افتح أي ملف في نافذة مستقلة (لشاشة ثانية) تتحدث تلقائياً عند تعديله هنا.</div>
            <div class="gh-row">${pathPick(this, 'fmx-win-path', this.activeStudioFile)}${pbtn('fa-up-right-from-square', 'فتح', 'app.fmxOpenWindow(document.getElementById(\'fmx-win-path\').value)')}${btn('fa-window-restore', 'نسخة من التطبيق', 'window.open(location.href,\'_blank\',\'noopener\')')}</div>`, 'fa-window-restore');
    };
    const winHTML = (path, e) => {
        const k = kindOf(path), body = e.dataUrl ? (k === 'image' ? `<img src="${esc(e.dataUrl)}" style="max-width:100%">` : k === 'audio' ? `<audio controls src="${esc(e.dataUrl)}"></audio>` : k === 'video' ? `<video controls style="max-width:100%" src="${esc(e.dataUrl)}"></video>` : `<p>${esc(path)}</p>`) : `<pre id="c">${esc(e.content || '')}</pre>`;
        return `<!doctype html><html dir="ltr"><head><meta charset="utf-8"><title>${esc(path)} — OX-Alpha</title><style>body{margin:0;background:#131314;color:#e3e3e3;font:13px/1.55 ui-monospace,Consolas,monospace}header{position:sticky;top:0;background:#1e1f20;padding:8px 14px;border-bottom:1px solid #333;font-family:system-ui}pre{margin:0;padding:14px;white-space:pre-wrap;word-break:break-word}img,video,audio{display:block;margin:14px auto}</style></head><body><header>📄 ${esc(path)} <small id="s" style="opacity:.6"></small></header>${body}
            <script>try{var bc=new BroadcastChannel('ox-fmx-win');bc.onmessage=function(m){if(m.data&&m.data.path===${JSON.stringify(path)}&&typeof m.data.content==='string'){var c=document.getElementById('c');if(c){c.textContent=m.data.content;document.getElementById('s').textContent='· حُدّث '+new Date().toLocaleTimeString();}}};}catch(e){}</script></body></html>`;
    };
    P.fmxOpenWindow = function (path) {
        const e = this.virtualProjectFiles.get(path);
        if (!e) return null;
        const url = win().URL.createObjectURL(makeBlob([winHTML(path, e)], 'text/html'));
        const w = win().open(url, '_blank', 'popup,width=900,height=720');
        if (!w) { this.showToast('اسمح بالنوافذ المنبثقة لهذا الموقع', 'warning'); return null; }
        (this._fmxWins = this._fmxWins || new Set()).add(path);
        return w;
    };
    P.fmxWinPost = function (path, next) {
        if (!this._fmxWins || !this._fmxWins.has(path) || !next || typeof next.content !== 'string') return;
        try { (this._fmxBC = this._fmxBC || new (win().BroadcastChannel)('ox-fmx-win')).postMessage({ path, content: next.content }); } catch (e) {}
    };
}
