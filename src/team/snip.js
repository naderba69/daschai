/* Code sharing: temporary links (#781) with password (#782), expiry (#783), view limits (#784) and viewer tracking (#785),
   backed by secret gists (views = gist comments by signed-in viewers) or self-contained links offline; embeds (#789). */
import { esc, call, btn, pbtn, card, empty, field, area, select, val, setHTML, lsGet, lsSet, uid, bytesToB64url, b64ToBytes, utf8, fromUtf8, extOf, baseName, ago, fmtDT, readMarker, marker, win } from './util.js';
import { encodeLive, decodeLive } from './live.js';

const SNIPS_KEY = 'ox_team_snips_v1';
const subtle = () => (globalThis.crypto || win().crypto).subtle;
async function deriveKey(password, salt) {
    const base = await subtle().importKey('raw', utf8(password), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encryptText(text, password) {
    const c = globalThis.crypto || win().crypto;
    const salt = c.getRandomValues(new Uint8Array(16)), iv = c.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, await deriveKey(password, salt), utf8(text)));
    return { ct: bytesToB64url(ct), iv: bytesToB64url(iv), salt: bytesToB64url(salt) };
}
export async function decryptText(enc, password) {
    try {
        const pt = await subtle().decrypt({ name: 'AES-GCM', iv: b64ToBytes(enc.iv) }, await deriveKey(password, b64ToBytes(enc.salt)), b64ToBytes(enc.ct));
        return fromUtf8(new Uint8Array(pt));
    } catch (e) { return null; }
}
/** Can this snippet still be viewed? */
export function snipStatus(meta, views = 0, now = Date.now()) {
    if (meta.exp && now > meta.exp) return { ok: false, reason: 'expired' };
    if (meta.max && views >= meta.max) return { ok: false, reason: 'limit' };
    return { ok: true, remaining: meta.max ? meta.max - views : null, left: meta.exp ? meta.exp - now : null };
}
export const parseSnipHash = (hash) => { const m = /#?oxsnip=([gl]):([^&]+)(&embed=1)?/.exec(String(hash || '')); return m ? { kind: m[1], ref: m[2], embed: !!m[3] } : null; };
const LANG = { js: 'javascript', ts: 'typescript', py: 'python', html: 'html', css: 'css', json: 'json', md: 'markdown', sh: 'bash', java: 'java', go: 'go', rs: 'rust', php: 'php', rb: 'ruby', c: 'c', cpp: 'cpp', cs: 'csharp', sql: 'sql', jsx: 'jsx', tsx: 'tsx', vue: 'vue' };
export const langOf = (name) => LANG[extOf(name)] || extOf(name) || 'text';
/** Self-contained HTML embed that works on any website (no scripts, no iframes). */
export function embedHTML({ code, name = 'snippet', url = '', theme = 'dark' }) {
    const dark = theme !== 'light';
    const bg = dark ? '#0f172a' : '#f8fafc', fg = dark ? '#e2e8f0' : '#0f172a', bd = dark ? '#1e293b' : '#e2e8f0', mu = dark ? '#94a3b8' : '#64748b';
    const lines = String(code).split('\n');
    const gut = lines.map((_, i) => i + 1).join('\n');
    return `<div style="font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;border:1px solid ${bd};border-radius:10px;overflow:hidden;background:${bg};color:${fg};direction:ltr;text-align:left;max-width:100%">
<div style="display:flex;justify-content:space-between;padding:6px 12px;border-bottom:1px solid ${bd};font:12px system-ui,sans-serif;color:${mu}"><span>${esc(name)}</span>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener" style="color:${mu};text-decoration:none">OX-Alpha ↗</a>` : '<span>OX-Alpha</span>'}</div>
<div style="display:flex;overflow:auto;max-height:480px"><pre style="margin:0;padding:10px 8px;color:${mu};text-align:right;user-select:none;border-right:1px solid ${bd}">${gut}</pre><pre style="margin:0;padding:10px 12px;white-space:pre">${esc(code)}</pre></div></div>`;
}

export function installSnip(P) {
    P.tmSnipList = function () { return lsGet(SNIPS_KEY, []); };
    const saveList = (list) => lsSet(SNIPS_KEY, list.slice(0, 200));

    P.tmCreateSnippet = async function ({ code, name = 'snippet.txt', title = '', password = '', hours = 24, maxViews = 0, track = true } = {}) {
        code = String(code == null ? '' : code);
        if (!code.trim()) { this.showToast('لا يوجد كود للمشاركة', 'warning'); return null; }
        if (code.length > 900000) { this.showToast('الكود أكبر من 900KB', 'warning'); return null; }
        const by = await this.tmMe();
        const meta = { v: 1, name: baseName(name) || 'snippet.txt', lang: langOf(name), title: title || baseName(name), by, created: Date.now(), exp: +hours > 0 ? Date.now() + hours * 36e5 : 0, max: Math.max(0, +maxViews || 0), track: !!track };
        const payload = { ...meta, ...(password ? { enc: await encryptText(code, password) } : { code }) };
        const base = this.shareBaseUrl ? this.shareBaseUrl() : location.origin + location.pathname;
        let rec;
        if (this.tmHasGH()) {
            const files = { 'oxsnip.json': { content: JSON.stringify(payload) } };
            if (!password) files[meta.name] = { content: code };
            const g = await this.gh('/gists', { method: 'POST', body: { description: `OX-Alpha snippet: ${meta.title}${meta.exp ? ` (حتى ${new Date(meta.exp).toISOString().slice(0, 16)})` : ''}`, public: false, files } });
            rec = { id: g.id, kind: 'g', title: meta.title, name: meta.name, url: `${base}#oxsnip=g:${g.id}`, gist: g.html_url, owner: g.owner && g.owner.login, exp: meta.exp, max: meta.max, track: meta.track, password: !!password, created: meta.created };
        } else {
            if (meta.max || meta.track) meta.note = 'offline';
            rec = { id: uid('ls'), kind: 'l', title: meta.title, name: meta.name, url: `${base}#oxsnip=l:${encodeLive(payload)}`, exp: meta.exp, max: 0, track: false, password: !!password, created: meta.created };
        }
        saveList([rec, ...this.tmSnipList()]);
        if (this.addXP) this.addXP(5, 'share');
        return rec;
    };
    /** Load a snippet's payload + recorded views. */
    P.tmFetchSnippet = async function (parsed) {
        if (parsed.kind === 'l') return { payload: decodeLive(parsed.ref), views: [], gist: null };
        const g = await this.gh(`/gists/${encodeURIComponent(parsed.ref)}`, { allow: [404] });
        if (!g || g.__status === 404) return { gone: true };
        const f = g.files && g.files['oxsnip.json'];
        let content = f && f.content;
        if (f && f.truncated && f.raw_url) content = await (await fetch(f.raw_url)).text();
        const payload = JSON.parse(content || '{}');
        let views = [];
        if (payload.track || payload.max) {
            const comments = await this.gh(`/gists/${encodeURIComponent(parsed.ref)}/comments?per_page=100`).catch(() => []) || [];
            views = comments.filter(c => readMarker('view', c.body)).map(c => ({ login: c.user && c.user.login, t: new Date(c.created_at).getTime(), id: c.id }));
        }
        return { payload, views, gist: g };
    };
    P.tmOpenSnip = async function (hash = location.hash) {
        const parsed = parseSnipHash(hash);
        if (!parsed) { this.showToast('رابط مشاركة غير صالح', 'error'); return null; }
        let data;
        try { data = await this.tmFetchSnippet(parsed); } catch (e) { return this.tmErr(e); }
        if (data.gone) { this.tmSnipShow({ error: '🗑️ هذا الرابط أُلغي أو انتهت صلاحيته' }, parsed); return { error: 'gone' }; }
        const { payload, views } = data;
        const me = this.tmHasGH() ? await this.tmMe() : null;
        const owner = me && payload.by === me;
        const st = snipStatus(payload, views.length);
        if (!st.ok && !owner) {
            this.tmSnipShow({ error: st.reason === 'expired' ? '⌛ انتهت صلاحية هذا الرابط' : '🚫 بلغ هذا الرابط الحد الأقصى للمشاهدات' }, parsed);
            return { error: st.reason };
        }
        if (parsed.kind === 'g' && (payload.track || payload.max) && !owner) {
            if (!this.tmHasGH()) {
                if (payload.max) { this.tmSnipShow({ error: '🔐 هذا الرابط محدود المشاهدات — سجّل برمز GitHub (الإعدادات) ليُحتسب عرضك' }, parsed); return { error: 'auth' }; }
            } else {
                await this.gh(`/gists/${parsed.ref}/comments`, { method: 'POST', body: { body: `👁️ مشاهدة ${marker('view', { t: Date.now() })}` } }).catch(() => null);
            }
        }
        let code = payload.code;
        if (payload.enc) {
            const pw = this._tmSnipPw != null ? this._tmSnipPw : await this.askText('🔐 هذا الكود محمي بكلمة سر', '', { label: 'كلمة السر', okLabel: 'فتح' });
            this._tmSnipPw = null;
            if (pw == null) return { error: 'cancelled' };
            code = await decryptText(payload.enc, pw);
            if (code == null) { this.showToast('❌ كلمة السر غير صحيحة', 'error'); return { error: 'password' }; }
        }
        const res = { payload, code, views: views.length + (owner ? 0 : 1), status: st };
        this.tmSnipShow(res, parsed);
        return res;
    };
    P.tmSnipShow = function (res, parsed) {
        this._tmSnipOpen = res;
        if (parsed && parsed.embed) {
            let el = document.getElementById('tm-embed-view');
            if (!el) { el = document.createElement('div'); el.id = 'tm-embed-view'; el.className = 'tmx-embed-view'; document.body.appendChild(el); }
            el.innerHTML = res.error ? `<div class="gh-empty">${esc(res.error)}</div>` : embedHTML({ code: res.code, name: res.payload.name });
            return el;
        }
        const p = res.payload || {};
        this.openPanel({
            title: res.error ? 'رابط مشاركة' : `كود مشارك: ${p.title || p.name}`, icon: 'fa-share-nodes',
            body: res.error ? empty(esc(res.error), true) : `<div class="tmx-note">من @${esc(p.by)} • ${fmtDT(p.created)}${p.exp ? ` • ينتهي ${fmtDT(p.exp)}` : ''}${p.max ? ` • المشاهدات ${res.views}/${p.max}` : ''}${p.enc ? ' • 🔐 مشفر' : ''}</div><pre class="tmx-code" dir="ltr">${esc(res.code)}</pre>`,
            footer: res.error ? '' : `${btn('fa-copy', 'نسخ', call('tmSnipCopy'))}${btn('fa-folder-plus', 'إضافة للمشروع', call('tmSnipImport'))}`
        });
        return res;
    };
    P.tmSnipCopy = function () { const r = this._tmSnipOpen; if (r && r.code != null) this.copyToClipboard(r.code); };
    P.tmSnipImport = function () {
        const r = this._tmSnipOpen; if (!r || r.code == null) return null;
        const path = this.uniqueProjectPath ? this.uniqueProjectPath(r.payload.name) : r.payload.name;
        this.writeProjectFile(path, r.code, 'import');
        if (this.renderStudioExplorer) this.renderStudioExplorer();
        this.showToast(`📁 أُضيف ${this.escapeHTML(path)}`, 'success');
        return path;
    };

    // ------------------------------------------------------------------ UI
    P.tmSnippet = async function () {
        const paths = this.projectPaths().filter(p => typeof (this.virtualProjectFiles.get(p) || {}).content === 'string');
        return card('مشاركة كود برابط', `<div class="gh-row">${select('tm-sn-file', 'من ملف', [['', '— لصق كود —'], ...paths.map(p => [p, p])], this.activeStudioFile || '')}${field('tm-sn-title', 'العنوان', '')}</div>
            ${area('tm-sn-code', 'أو الصق الكود', '', 5, 'dir="ltr"')}
            <div class="fmx-grid4">${field('tm-sn-pw', '🔐 كلمة سر (اختياري)', '', 'type="password" autocomplete="new-password"')}${select('tm-sn-exp', '⌛ ينتهي بعد', [['1', 'ساعة'], ['24', 'يوم'], ['168', 'أسبوع'], ['720', 'شهر'], ['0', 'بدون انتهاء']], '24')}${field('tm-sn-max', '👁️ أقصى مشاهدات (0 = بلا حد)', 0, 'type="number" min="0"')}${select('tm-sn-track', 'تتبع من شاهد', [['1', 'نعم'], ['0', 'لا']], '1')}</div>
            <div class="gh-row">${pbtn('fa-link', 'إنشاء الرابط', call('tmSnippetUI'))}</div><div id="tm-sn-out"></div>
            <div class="tmx-note">${this.tmHasGH() ? 'يُحفظ كـ Gist سري؛ المشاهدات تُسجل كتعليقات (اسم المشاهد ووقته)، وعند انتهاء الصلاحية أو بلوغ الحد يُحذف الـ Gist من «روابطي».' : 'بدون رمز GitHub: الرابط مكتفٍ ذاتياً (الكود داخله) مع كلمة السر والانتهاء — أما حد المشاهدات والتتبع فيحتاجان GitHub.'}</div>`, 'fa-share-nodes');
    };
    P.tmSnippetUI = async function () {
        const file = val('tm-sn-file');
        const code = file ? (this.virtualProjectFiles.get(file) || {}).content : val('tm-sn-code');
        try {
            const rec = await this.tmCreateSnippet({ code, name: file || 'snippet.txt', title: val('tm-sn-title'), password: val('tm-sn-pw'), hours: +val('tm-sn-exp'), maxViews: +val('tm-sn-max'), track: val('tm-sn-track') !== '0' });
            if (rec) { setHTML('tm-sn-out', `<div class="fmx-invite"><input class="form-input-box" dir="ltr" readonly value="${esc(rec.url)}" onclick="this.select()"><div class="gh-row">${btn('fa-copy', 'نسخ', call('copyToClipboard', rec.url))}${btn('fa-code', 'كود التضمين', call('tmLoad', 'share', 'embed', { id: rec.id }))}</div><div id="tm-sn-qr"></div></div>`); if (this.renderQR && rec.url.length < 1500) this.renderQR(rec.url, 'tm-sn-qr'); }
            return rec;
        } catch (e) { return this.tmErr(e); }
    };
    P.tmSnipLinks = async function () {
        const list = this.tmSnipList();
        const me = this.tmHasGH() ? await this.tmMe() : null;
        const rows = [];
        for (const r of list.slice(0, 30)) {
            let views = [], gone = false;
            if (r.kind === 'g' && this.tmHasGH()) {
                const d = await this.tmFetchSnippet({ kind: 'g', ref: r.id }).catch(() => null);
                if (!d || d.gone) gone = true; else views = d.views.filter(v => v.login !== me);
                const st = snipStatus(r, views.length);
                if (!gone && !st.ok) { await this.gh(`/gists/${r.id}`, { method: 'DELETE' }).catch(() => {}); gone = true; r.revoked = st.reason; }
            }
            const st = gone ? { ok: false, reason: r.revoked || 'gone' } : snipStatus(r, views.length);
            rows.push(`<div class="tmx-snip ${st.ok ? '' : 'off'}"><div class="tmx-msg-h"><b>${esc(r.title)}</b> ${r.password ? '🔐' : ''} <small>${fmtDT(r.created)}</small> <span class="fmx-tag">${st.ok ? (r.exp ? '⌛ ' + fmtDT(r.exp) : 'دائم') : { expired: 'منتهي', limit: 'بلغ الحد', gone: 'ملغى' }[st.reason] || 'ملغى'}</span>${r.max ? `<span class="fmx-tag">👁️ ${views.length}/${r.max}</span>` : r.kind === 'g' ? `<span class="fmx-tag">👁️ ${views.length}</span>` : ''}</div>
                ${views.length ? `<div class="tmx-viewers">${views.map(v => `<span class="fmx-tag">@${esc(v.login)} • ${ago(v.t)}</span>`).join('')}</div>` : ''}
                <div class="gh-row">${st.ok ? btn('fa-copy', 'نسخ', call('copyToClipboard', r.url)) + btn('fa-code', 'تضمين', call('tmLoad', 'share', 'embed', { id: r.id })) + btn('fa-ban', 'إلغاء الرابط', call('tmRevokeSnip', r.id)) : ''}${btn('fa-trash', '', call('tmForgetSnip', r.id))}</div></div>`);
        }
        saveList(list);
        return card('روابطي ومن شاهدها', rows.join('') || empty('لم تشارك أي كود بعد'), 'fa-eye');
    };
    P.tmRevokeSnip = async function (id) {
        const list = this.tmSnipList(), r = list.find(x => x.id === id);
        if (!r) return false;
        if (r.kind === 'g') await this.gh(`/gists/${id}`, { method: 'DELETE' }).catch(e => this.tmErr(e));
        else r.exp = Date.now() - 1; // self-contained links can't be recalled — mark expired locally
        r.revoked = 'gone';
        saveList(list);
        this.showToast(r.kind === 'g' ? '🚫 أُلغي الرابط وحُذف الـ Gist' : 'الروابط الذاتية لا يمكن سحبها — ستنتهي في موعدها', r.kind === 'g' ? 'success' : 'warning');
        if (document.getElementById('tmx-sec')) this.tmRefresh();
        return true;
    };
    P.tmForgetSnip = function (id) { saveList(this.tmSnipList().filter(x => x.id !== id)); return this.tmRefresh(); };
    P.tmEmbed = async function (opts = {}) {
        const list = this.tmSnipList().filter(r => !r.password);
        const paths = this.projectPaths().filter(p => typeof (this.virtualProjectFiles.get(p) || {}).content === 'string');
        const pick = opts.id ? list.find(r => r.id === opts.id) : null;
        this._tmMount = () => this.tmEmbedRender(pick ? pick.id : '', pick ? '' : (this.activeStudioFile || paths[0] || ''));
        return card('تضمين الكود في موقع', `<div class="gh-row">${select('tm-em-snip', 'رابط مشاركة', [['', '—'], ...list.map(r => [r.id, r.title])], pick ? pick.id : '', `onchange="app.tmEmbedRender(this.value, '')"`)}${select('tm-em-file', 'أو ملف', [['', '—'], ...paths.map(p => [p, p])], pick ? '' : (this.activeStudioFile || paths[0] || ''), `onchange="app.tmEmbedRender('', this.value)"`)}${select('tm-em-theme', 'السمة', [['dark', 'داكن'], ['light', 'فاتح']], 'dark', `onchange="app.tmEmbedRender(document.getElementById('tm-em-snip').value, document.getElementById('tm-em-file').value)"`)}</div><div id="tm-em-out"></div>
            <div class="tmx-note">التضمين HTML ثابت يعمل في أي موقع (بدون سكربت). للروابط المرفوعة كـ Gist يتوفر أيضاً تضمين GitHub الرسمي. (تضمين التطبيق نفسه في iframe معطل عمداً لحماية الموقع.)</div>`, 'fa-code');
    };
    P.tmEmbedRender = async function (id, path) {
        const theme = val('tm-em-theme') || 'dark';
        let code = '', name = 'snippet', url = '', gist = null;
        if (id) {
            const r = this.tmSnipList().find(x => x.id === id);
            if (!r) return null;
            url = r.url; name = r.name || r.title;
            if (r.kind === 'g') { const d = await this.tmFetchSnippet({ kind: 'g', ref: r.id }).catch(() => null); code = d && d.payload ? d.payload.code || '' : ''; gist = r.owner ? `https://gist.github.com/${r.owner}/${r.id}.js` : null; }
            else code = decodeLive(r.url.split('#oxsnip=l:')[1]).code || '';
        } else if (path) { code = (this.virtualProjectFiles.get(path) || {}).content || ''; name = baseName(path); }
        if (!code) { setHTML('tm-em-out', empty('اختر رابطاً أو ملفاً')); return null; }
        const html = embedHTML({ code, name, url, theme });
        const script = gist ? `<script src="${gist}"></script>` : '';
        this._tmEmbed = { html, script };
        setHTML('tm-em-out', `<div class="tmx-embed-prev">${html}</div>${area('tm-em-html', 'كود HTML للتضمين', html, 4, 'dir="ltr" readonly onclick="this.select()"')}<div class="gh-row">${btn('fa-copy', 'نسخ HTML', call('tmEmbedCopy', 'html'))}${btn('fa-download', 'تحميل كملف', call('tmEmbedDownload'))}</div>
            ${script ? `${field('tm-em-gist', 'تضمين Gist', script, 'dir="ltr" readonly onclick="this.select()"')}${btn('fa-copy', 'نسخ', call('tmEmbedCopy', 'script'))}` : ''}`);
        return this._tmEmbed;
    };
    P.tmEmbedCopy = function (k = 'html') { const e = this._tmEmbed; if (e && e[k]) this.copyToClipboard(e[k]); };
    P.tmEmbedDownload = function () { const e = this._tmEmbed; if (!e) return; const W = win(); this.downloadBlob(new W.Blob([`<!doctype html><meta charset="utf-8"><title>snippet</title><body style="margin:16px">${e.html}</body>`], { type: 'text/html' }), 'snippet-embed.html'); };
}
