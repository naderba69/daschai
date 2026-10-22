/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 5a: Collaboration
   Ideas implemented (THOUSAND_IDEAS.md):
     #731 share a chat by link (in-link or secret/public Gist)   #737 publish project as template
     #786 revoke share   #787 copy link   #788 QR for the link   #790 code/file as Gist
     #733 comments on code lines   #749 resolve   #750 reopen   #744/#579 activity log (who/what/when)
     #759 tasks   #761 Kanban   #762 todo list   #763 time tracking   #764 estimates   #765 deadlines
     #766 reminders   #767 overdue alerts   #768 completion report   #793 AI suggests tasks
     #797 AI progress report   #755 whiteboard   #672 drawing   #1004 sketch → code
     #801 presentation mode   #802 teach   #803 review   #804 planning   #805 brainstorm
     #809 break mode   #810 focus mode (Pomodoro)   #1005 coding challenges   #1006 interview simulator
     #1007 startup generator   #1009 legacy code translation
   ============================================================================== */
(function () {
    'use strict';
    if (typeof OXAlphaApp === 'undefined') return;
    const P = OXAlphaApp.prototype;

    const QR_URL = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
    const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

    // ------------------------------------------------------------------ PACKING (compressed, URL-safe)
    const b64urlEncode = (bytes) => {
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    const b64urlDecode = (str) => {
        str = String(str).replace(/-/g, '+').replace(/_/g, '/');
        while (str.length % 4) str += '=';
        const bin = atob(str);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    };
    /** Run bytes through a Compression/DecompressionStream without Blob.stream()/Response. */
    const pipeThrough = async (bytes, ts) => {
        const writer = ts.writable.getWriter();
        writer.write(bytes).catch(() => {});
        writer.close().catch(() => {});
        const reader = ts.readable.getReader();
        const chunks = [];
        let total = 0;
        for (;;) { const { value, done } = await reader.read(); if (done) break; chunks.push(value); total += value.length; }
        const out = new Uint8Array(total);
        let o = 0;
        chunks.forEach(c => { out.set(c, o); o += c.length; });
        return out;
    };
    P.compressBytes = async function (bytes, format = 'deflate-raw') {
        if (typeof CompressionStream === 'undefined') return null;
        return pipeThrough(bytes, new CompressionStream(format));
    };
    P.decompressBytes = async function (bytes, format = 'deflate-raw') {
        if (typeof DecompressionStream === 'undefined') throw new Error('المتصفح لا يدعم فك الضغط');
        return pipeThrough(bytes, new DecompressionStream(format));
    };
    /** Object → compact URL-safe string ('z' = deflated, 'j' = plain JSON). */
    P.packData = async function (obj) {
        const json = new TextEncoder().encode(JSON.stringify(obj));
        const z = await this.compressBytes(json).catch(() => null);
        return z && z.length < json.length ? 'z' + b64urlEncode(z) : 'j' + b64urlEncode(json);
    };
    P.unpackData = async function (str) {
        const kind = str[0];
        const bytes = b64urlDecode(str.slice(1));
        const raw = kind === 'z' ? await this.decompressBytes(bytes) : bytes;
        return JSON.parse(new TextDecoder().decode(raw));
    };
    P.b64urlEncode = b64urlEncode;
    P.b64urlDecode = b64urlDecode;

    // ------------------------------------------------------------------ SHARING
    const cleanContent = (s) => String(s || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    P.buildSharePayload = function (session) {
        return {
            v: 1, kind: 'chat', t: session.title || 'محادثة', c: session.createdAt || Date.now(),
            m: (session.messages || []).filter(m => m.content).map(m => ({ r: m.role, c: cleanContent(m.content), md: m.model || undefined, ts: m.timestamp || undefined, a: (m.attachments || []).map(a => a.name) }))
        };
    };
    P.shareBaseUrl = function () { return location.origin + location.pathname; };
    P.buildShareLink = async function (session) {
        const packed = await this.packData(this.buildSharePayload(session));
        return `${this.shareBaseUrl()}#share=${packed}`;
    };
    P.loadShareRecords = function () { return lsGet('ox_alpha_shares_v1', []); };
    P.saveShareRecords = function (list) { lsSet('ox_alpha_shares_v1', list.slice(0, 100)); };

    P.createGist = async function ({ description, files, isPublic = false }) {
        if (!this.settings.githubToken?.trim()) throw new Error('يلزم رمز GitHub (بصلاحية gist) في الإعدادات');
        try {
            return await this.gh('/gists', { method: 'POST', body: { description, public: !!isPublic, files } });
        } catch (e) {
            if (e.status === 403 || e.status === 404) throw new Error('رمز GitHub لا يملك صلاحية gist — أنشئ رمزاً بصلاحية gist');
            throw e;
        }
    };
    P.fetchGist = async function (id) {
        if (!/^[a-f0-9]{8,64}$/i.test(id)) throw new Error('معرّف Gist غير صالح');
        return this.gh('/gists/' + id);
    };

    P.shareSessionViaGist = async function (sessionId, isPublic = false) {
        const session = this.sessions.find(s => s.id === (sessionId || this.activeSessionId));
        if (!session) return null;
        const payload = this.buildSharePayload(session);
        const md = this.buildChatExport ? this.buildChatExport(session, 'markdown') : payload.m.map(m => `**${m.r}**: ${m.c}`).join('\n\n');
        const gist = await this.createGist({
            description: `OX-Alpha chat: ${payload.t}`, isPublic,
            files: { 'ox-alpha-chat.json': { content: JSON.stringify(payload) }, 'chat.md': { content: md } }
        });
        const url = `${this.shareBaseUrl()}#gist=${gist.id}`;
        const rec = { id: gist.id, kind: 'chat', title: payload.t, url, html: gist.html_url, public: !!isPublic, created: Date.now() };
        this.saveShareRecords([rec, ...this.loadShareRecords()]);
        return rec;
    };
    P.revokeShare = async function (gistId) {
        try { await this.gh('/gists/' + gistId, { method: 'DELETE' }); }
        catch (e) { if (e.status !== 404) { this.showToast('❌ ' + this.escapeHTML(e.message), 'error'); return false; } }
        this.saveShareRecords(this.loadShareRecords().filter(r => r.id !== gistId));
        this.showToast('🔒 تم إلغاء المشاركة وحذف الـ Gist', 'success');
        if (document.getElementById('share-records')) this.renderShareRecords();
        return true;
    };

    P.renderQR = async function (text, targetId) {
        const el = document.getElementById(targetId);
        if (!el) return null;
        if (text.length > 2300) { el.innerHTML = '<div class="text-dim share-qr-note">الرابط أطول من سعة رمز QR — استخدم مشاركة Gist لرابط قصير</div>'; return null; }
        try {
            const lib = await this.loadScriptOnce(QR_URL, 'qrcode');
            if (lib.stringToBytesFuncs && lib.stringToBytesFuncs['UTF-8']) lib.stringToBytes = lib.stringToBytesFuncs['UTF-8'];
            const qr = lib(0, 'L');
            qr.addData(text);
            qr.make();
            el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
            return el.innerHTML;
        } catch (e) { el.innerHTML = `<div class="text-dim">تعذر إنشاء QR: ${this.escapeHTML(e.message)}</div>`; return null; }
    };

    P.openSharePanel = async function () {
        const session = this.sessions.find(s => s.id === this.activeSessionId);
        if (!session || !session.messages.length) { this.showToast('لا توجد رسائل لمشاركتها', 'warning'); return null; }
        this.openPanel({
            title: 'مشاركة المحادثة', icon: 'fa-share-nodes',
            body: `<div class="share-grid">
                <div class="gh-card"><b><i class="fa-solid fa-link"></i> رابط مباشر</b>
                    <div class="text-dim share-help">المحادثة كلها مضغوطة داخل الرابط نفسه — لا تُرفع لأي خادم. مناسب للمحادثات القصيرة والمتوسطة.</div>
                    <div class="gh-row"><input id="share-link" class="form-input-box" dir="ltr" readonly placeholder="جاري التجهيز..."><button class="sidebar-btn-util gh-btn" onclick="app.copyText(document.getElementById('share-link').value, 'تم نسخ الرابط')"><i class="fa-solid fa-copy"></i> نسخ</button></div>
                    <div id="share-link-meta" class="text-dim share-help"></div>
                    <div id="share-qr" class="share-qr"></div></div>
                <div class="gh-card"><b><i class="fa-brands fa-github"></i> رابط قصير عبر GitHub Gist</b>
                    <div class="text-dim share-help">يُنشأ Gist في حسابك (سري افتراضياً: لا يظهر في البحث لكن يفتحه من يملك الرابط). يمكنك إلغاء المشاركة لاحقاً.</div>
                    <div class="gh-row"><button class="btn-new-thread gh-btn" onclick="app.shareViaGistUI(false)"><i class="fa-solid fa-user-secret"></i> Gist سري</button><button class="sidebar-btn-util gh-btn" onclick="app.shareViaGistUI(true)"><i class="fa-solid fa-globe"></i> Gist عام</button></div>
                    <div id="share-gist-result"></div></div>
                <div class="gh-card"><b><i class="fa-solid fa-clock-rotate-left"></i> مشاركاتي</b><div id="share-records"></div></div>
            </div>`
        });
        this.renderShareRecords();
        const link = await this.buildShareLink(session);
        const input = document.getElementById('share-link');
        if (input) input.value = link;
        const meta = document.getElementById('share-link-meta');
        if (meta) meta.textContent = `${session.messages.length} رسالة • طول الرابط ${link.length.toLocaleString('en')} حرف${link.length > 60000 ? ' — طويل: قد لا تقبله بعض التطبيقات، استخدم Gist' : ''}`;
        this.renderQR(link, 'share-qr');
        return link;
    };
    P.shareViaGistUI = async function (isPublic) {
        const box = document.getElementById('share-gist-result');
        if (box) box.innerHTML = '<span class="live-step-spinner"></span> جاري إنشاء الـ Gist...';
        try {
            const rec = await this.shareSessionViaGist(null, isPublic);
            if (box) box.innerHTML = `<div class="gh-row"><input class="form-input-box" dir="ltr" readonly value="${this.escapeHTML(rec.url)}"><button class="sidebar-btn-util gh-btn" onclick="app.copyText(${JSON.stringify(rec.url).replace(/"/g, '&quot;')}, 'تم نسخ الرابط')"><i class="fa-solid fa-copy"></i></button></div><div id="share-gist-qr" class="share-qr"></div>`;
            this.renderQR(rec.url, 'share-gist-qr');
            this.renderShareRecords();
            return rec;
        } catch (e) {
            if (box) box.innerHTML = `<div class="text-red">❌ ${this.escapeHTML(e.message)}</div>`;
            return null;
        }
    };
    P.renderShareRecords = function () {
        const el = document.getElementById('share-records');
        if (!el) return;
        const list = this.loadShareRecords();
        el.innerHTML = list.length ? list.map(r => `<div class="share-rec"><i class="fa-solid ${r.kind === 'project' ? 'fa-folder-tree' : r.kind === 'file' ? 'fa-file-code' : 'fa-comments'}"></i>
            <div class="share-rec-main"><span class="truncate">${this.escapeHTML(r.title)}</span><small>${new Date(r.created).toLocaleString('ar')} • ${r.public ? 'عام' : 'سري'}</small></div>
            <button class="sidebar-btn-util gh-btn" title="نسخ" onclick="app.copyText(${JSON.stringify(r.url).replace(/"/g, '&quot;')}, 'تم نسخ الرابط')"><i class="fa-solid fa-copy"></i></button>
            <button class="sidebar-btn-util gh-btn danger" title="إلغاء المشاركة" onclick="app.revokeShare('${r.id}')"><i class="fa-solid fa-link-slash"></i></button></div>`).join('')
            : '<div class="text-dim share-help">لا توجد مشاركات عبر Gist بعد.</div>';
    };

    /** Publish the project (text files) as a Gist template that anyone can import (#737). */
    P.publishProjectTemplate = async function ({ name, isPublic = true } = {}) {
        const files = Array.from(this.virtualProjectFiles.entries()).filter(([, f]) => !f.dataUrl && typeof f.content === 'string');
        if (!files.length) throw new Error('المشروع فارغ');
        const total = files.reduce((n, [, f]) => n + f.content.length, 0);
        if (total > 8 * 1048576) throw new Error('المشروع أكبر من 8MB — انشره كمستودع GitHub');
        const payload = { v: 1, kind: 'project', name: name || 'ox-alpha-template', files: files.map(([p, f]) => [p, f.content]) };
        const readme = `# ${payload.name}\n\nقالب مشروع من OX-Alpha Workbench Pro (${files.length} ملف).\n\n${files.map(([p]) => `- \`${p}\``).join('\n')}\n`;
        const gist = await this.createGist({ description: `OX-Alpha template: ${payload.name}`, isPublic, files: { 'ox-alpha-project.json': { content: JSON.stringify(payload) }, 'README.md': { content: readme } } });
        const url = `${this.shareBaseUrl()}#gist=${gist.id}`;
        this.saveShareRecords([{ id: gist.id, kind: 'project', title: payload.name, url, html: gist.html_url, public: !!isPublic, created: Date.now() }, ...this.loadShareRecords()]);
        return { url, gist };
    };
    P.publishProjectTemplateUI = async function () {
        const r = await this.showDialog({
            title: '📦 نشر المشروع كقالب',
            body: 'يُنشر كـ Gist يمكن لأي شخص استيراده في OX-Alpha بنقرة.',
            fields: [{ id: 'name', label: 'اسم القالب', value: this.settings.githubRepo || 'my-template' }, { id: 'pub', type: 'checkbox', label: 'عام (يظهر في ملفك على GitHub)', value: true }],
            buttons: [{ label: 'نشر', value: 'ok', primary: true }, { label: 'إلغاء', value: null }]
        });
        if (!r) return null;
        try {
            const res = await this.publishProjectTemplate({ name: r.values.name, isPublic: r.values.pub });
            await this.copyText(res.url, 'تم نشر القالب ونسخ رابطه');
            return res;
        } catch (e) { this.showToast('❌ ' + this.escapeHTML(e.message), 'error'); return null; }
    };
    /** Share the active studio file as a Gist (#790). */
    P.shareFileAsGist = async function (path = this.activeStudioFile) {
        const f = path && this.virtualProjectFiles.get(path);
        if (!f || f.dataUrl) { this.showToast('افتح ملفاً نصياً أولاً', 'warning'); return null; }
        try {
            const name = path.split('/').pop();
            const gist = await this.createGist({ description: `${path} — OX-Alpha`, isPublic: false, files: { [name]: { content: f.content || ' ' } } });
            this.saveShareRecords([{ id: gist.id, kind: 'file', title: path, url: gist.html_url, html: gist.html_url, public: false, created: Date.now() }, ...this.loadShareRecords()]);
            await this.copyText(gist.html_url, 'تم إنشاء Gist ونسخ رابطه');
            return gist;
        } catch (e) { this.showToast('❌ ' + this.escapeHTML(e.message), 'error'); return null; }
    };

    // ---- Opening shared content
    P.handleShareHash = async function (hash = location.hash) {
        const m = /^#(share|gist)=([^&]+)/.exec(hash || '');
        if (!m) return null;
        try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
        try {
            if (m[1] === 'share') return this.openSharedViewer(await this.unpackData(m[2]), { source: 'link' });
            const gist = await this.fetchGist(m[2]);
            const files = gist.files || {};
            const pick = (n) => files[n] && files[n].content;
            if (pick('ox-alpha-chat.json')) return this.openSharedViewer(JSON.parse(pick('ox-alpha-chat.json')), { source: 'gist', gist });
            if (pick('ox-alpha-project.json')) return this.openSharedViewer(JSON.parse(pick('ox-alpha-project.json')), { source: 'gist', gist });
            const plain = Object.values(files).filter(f => typeof f.content === 'string').map(f => [f.filename, f.content]);
            return this.openSharedViewer({ v: 1, kind: 'project', name: gist.description || 'gist', files: plain }, { source: 'gist', gist });
        } catch (e) {
            this.showToast('❌ تعذر فتح الرابط المشترك: ' + this.escapeHTML(e.message), 'error');
            return null;
        }
    };
    /** Import any Gist (OX-Alpha chat/template or plain files) by URL or id (#480). */
    P.parseGistId = function (input) {
        const segs = String(input || '').trim().split(/[?#]/)[0].split('/').filter(Boolean);
        const hit = segs.filter(x => /^[a-f0-9]{8,64}$/i.test(x)).pop();
        return hit || null;
    };
    P.importGistUI = async function () {
        const v = await this.askText('📥 استيراد من Gist', '', { placeholder: 'https://gist.github.com/user/abc123… أو المعرّف', label: 'رابط الـ Gist أو معرّفه' });
        if (!v) return null;
        const id = this.parseGistId(v);
        if (!id) { this.showToast('رابط Gist غير صالح', 'error'); return null; }
        return this.handleShareHash('#gist=' + id);
    };
    P.openSharedViewer = function (payload, { source = 'link', gist = null } = {}) {
        if (!payload || !payload.kind) throw new Error('بيانات غير صالحة');
        this._shared = payload;
        const esc = (x) => this.escapeHTML(x);
        if (payload.kind === 'chat') {
            const msgs = payload.m || [];
            this.openPanel({
                title: `محادثة مشتركة: ${payload.t || ''}`, icon: 'fa-share-nodes',
                body: `<div class="shared-meta text-dim">${msgs.length} رسالة${gist ? ` • <a href="${esc(gist.html_url)}" target="_blank" rel="noopener">Gist</a>${gist.owner ? ' • ' + esc(gist.owner.login) : ''}` : ' • من رابط مباشر'} — للقراءة فقط</div>
                    <div class="shared-chat">${msgs.map(m => `<div class="shared-msg ${m.r === 'user' ? 'user' : 'ai'}"><div class="shared-who">${m.r === 'user' ? '👤' : '🤖 ' + esc(m.md || 'AI')}</div>${m.r === 'user' ? `<div style="white-space:pre-wrap">${esc(m.c)}</div>` : this.renderMarkdownSafe(m.c)}${(m.a || []).length ? `<div class="text-dim shared-att">📎 ${m.a.map(esc).join('، ')}</div>` : ''}</div>`).join('')}</div>`,
                footer: `<span class="gh-spacer"></span><button class="btn-new-thread gh-btn" onclick="app.importSharedChat()"><i class="fa-solid fa-file-import"></i> استيراد إلى محادثاتي</button>`
            });
        } else {
            const files = payload.files || [];
            this.openPanel({
                title: `قالب مشروع: ${payload.name || ''}`, icon: 'fa-folder-tree',
                body: `<div class="shared-meta text-dim">${files.length} ملف${gist ? ` • <a href="${esc(gist.html_url)}" target="_blank" rel="noopener">Gist</a>` : ''}</div>
                    <div class="gh-list">${files.slice(0, 400).map(([p, c]) => `<details class="sr-file"><summary dir="ltr">${esc(p)} <span class="text-dim">${(c || '').length.toLocaleString('en')}</span></summary><pre class="pv-code" dir="ltr">${esc((c || '').slice(0, 20000))}</pre></details>`).join('')}</div>`,
                footer: `<label class="gh-check"><input type="checkbox" id="shared-overwrite"> استبدال الملفات الموجودة</label><span class="gh-spacer"></span><button class="btn-new-thread gh-btn" onclick="app.importSharedProject(document.getElementById('shared-overwrite').checked)"><i class="fa-solid fa-file-import"></i> استيراد إلى المشروع</button>`
            });
        }
        return payload;
    };
    P.importSharedChat = function () {
        const p = this._shared;
        if (!p || p.kind !== 'chat') return null;
        const s = {
            id: 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            title: '📥 ' + (p.t || 'محادثة مستوردة'), createdAt: Date.now(), updatedAt: Date.now(), imported: true,
            messages: (p.m || []).map((m, i) => ({ id: uid('msg_') + i, role: m.r === 'user' ? 'user' : 'assistant', content: String(m.c || ''), model: m.md, timestamp: m.ts || Date.now(), steps: [] }))
        };
        this.sessions.unshift(s);
        this.activeSessionId = s.id;
        this.saveSessions();
        this.closeModals();
        this.renderUIState();
        this.showToast('📥 تم استيراد المحادثة', 'success');
        return s;
    };
    P.importSharedProject = function (overwrite = false) {
        const p = this._shared;
        if (!p || p.kind !== 'project') return 0;
        let n = 0, skipped = 0;
        (p.files || []).forEach(([path, content]) => {
            const clean = this.normPath ? this.normPath(path) : path;
            if (!clean || typeof content !== 'string') return;
            if (this.virtualProjectFiles.has(clean) && !overwrite) { skipped++; return; }
            this.writeProjectFile ? this.writeProjectFile(clean, content, 'import') : this.virtualProjectFiles.set(clean, { content });
            n++;
        });
        this.closeModals();
        if (this.toggleStudioExplorer) { this.toggleCodeStudio(true); this.toggleStudioExplorer(true); }
        this.showToast(`📦 تم استيراد ${n} ملف${skipped ? ` • تخطي ${skipped} موجود` : ''}`, 'success');
        return n;
    };

    // ------------------------------------------------------------------ ACTIVITY LOG (#744, #579)
    const REASONS = { edit: 'تحرير', create: 'إنشاء', external: 'تحديث خارجي (AI/GitHub)', import: 'استيراد', 'edit-tree': 'تحرير JSON', 'edit-table': 'تحرير جدول', replace: 'بحث واستبدال', restore: 'استعادة إصدار', 'restore-trash': 'استعادة من السلة', delete: 'حذف', rename: 'إعادة تسمية' };
    P.logActivity = function (entry) {
        this.activityLog = this.activityLog || [];
        const now = Date.now();
        const last = this.activityLog[this.activityLog.length - 1];
        if (last && entry.op === 'edit' && last.op === 'edit' && last.path === entry.path && last.reason === entry.reason && now - last.t < 60000) { last.t = now; last.n = (last.n || 1) + 1; }
        else this.activityLog.push({ t: now, ...entry });
        if (this.activityLog.length > 600) this.activityLog.splice(0, this.activityLog.length - 600);
        clearTimeout(this._activityTimer);
        this._activityTimer = setTimeout(() => { if (this.idbSet) this.idbSet('activity_log_v1', this.activityLog).catch(() => {}); }, 1500);
    };
    const _origOnWrite = P.onProjectFileWrite;
    if (_origOnWrite) {
        P.onProjectFileWrite = function (path, prev, next) {
            const r = _origOnWrite.apply(this, arguments);
            if (!this._activityMuted) {
                const op = !next ? 'delete' : !prev ? 'create' : 'edit';
                const reason = op === 'delete' ? 'delete' : (this._writeReason || (this._typingInStudio ? 'edit' : op === 'create' ? 'create' : 'external'));
                this.logActivity({ path, op, reason });
            }
            return r;
        };
    }
    ['renameProjectFile', 'renameProjectFolder'].forEach(fn => {
        const orig = P[fn];
        if (!orig) return;
        P[fn] = function (from, to) {
            this._activityMuted = (this._activityMuted || 0) + 1;
            let r;
            try { r = orig.apply(this, arguments); } finally { this._activityMuted--; }
            const dest = typeof r === 'string' ? r : to;
            if (!this._activityMuted && dest && dest !== from) {
                this.logActivity({ path: dest, from, op: 'rename', reason: 'rename' });
                this.moveCodeComments(from, dest, fn === 'renameProjectFolder');
            }
            return r;
        };
    });
    P.openActivityLog = function (filter = '') {
        const esc = (x) => this.escapeHTML(x);
        const list = (this.activityLog || []).slice().reverse().filter(e => !filter || e.path.includes(filter));
        const day = (t) => { const d = new Date(t), today = new Date(); const diff = Math.floor((new Date(today.toDateString()) - new Date(d.toDateString())) / 864e5); return diff === 0 ? 'اليوم' : diff === 1 ? 'أمس' : d.toLocaleDateString('ar'); };
        let lastDay = '';
        const rows = list.slice(0, 400).map(e => {
            const d = day(e.t);
            const head = d !== lastDay ? `<div class="act-day">${d}</div>` : '';
            lastDay = d;
            const icon = { create: 'fa-plus text-emerald', edit: 'fa-pen text-blue', delete: 'fa-trash text-red', rename: 'fa-i-cursor text-amber' }[e.op] || 'fa-circle';
            return `${head}<div class="act-row"><i class="fa-solid ${icon}"></i><span class="act-time">${new Date(e.t).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}</span>
                <span class="act-path" dir="ltr">${e.from ? esc(e.from) + ' → ' : ''}${esc(e.path)}</span><span class="text-dim">${esc(REASONS[e.reason] || e.reason)}${e.n > 1 ? ` ×${e.n}` : ''}</span>
                ${e.op !== 'delete' && this.virtualProjectFiles.has(e.path) ? `<button class="fx-link" onclick="app.openFileHistory(app.ghVal(${this.ghRef(e.path)}))" title="سجل الإصدارات"><i class="fa-solid fa-clock-rotate-left"></i></button>` : ''}</div>`;
        }).join('');
        this.openPanel({
            title: 'سجل النشاط', icon: 'fa-list-check',
            body: `<input class="form-input-box" placeholder="تصفية حسب المسار..." value="${esc(filter)}" onchange="app.openActivityLog(this.value)" style="margin-bottom:8px">
                <div class="act-list">${rows || '<div class="gh-empty">لا يوجد نشاط مسجل بعد — تُسجل كل عمليات الإنشاء والتحرير والحذف وإعادة التسمية في ملفات المشروع.</div>'}</div>`
        });
        return list;
    };

    // ------------------------------------------------------------------ CODE COMMENTS (#733, #749, #750)
    P.saveCodeComments = function () { if (this.idbSet) this.idbSet('code_comments_v1', this.codeComments || []).catch(() => {}); this.updateCommentBadge(); };
    P.studioCaretLine = function () {
        const ta = document.getElementById('studio-editor-textarea');
        if (!ta) return 1;
        return ta.value.slice(0, ta.selectionStart || 0).split('\n').length;
    };
    P.addCodeComment = function (path, line, text) {
        const f = this.virtualProjectFiles.get(path);
        if (!f || !text || !text.trim()) return null;
        const lines = (f.content || '').split('\n');
        const c = { id: uid('cm_'), path, line, anchor: lines[line - 1] || '', text: text.trim(), resolved: false, created: Date.now() };
        (this.codeComments = this.codeComments || []).push(c);
        this.saveCodeComments();
        return c;
    };
    /** Re-locate a comment after edits: keep its line if the anchor still matches, otherwise find the nearest identical line. */
    P.locateComment = function (c) {
        const f = this.virtualProjectFiles.get(c.path);
        if (!f || typeof f.content !== 'string') return c.line;
        const lines = f.content.split('\n');
        if (lines[c.line - 1] === c.anchor || !c.anchor.trim()) return Math.min(c.line, lines.length);
        let best = -1;
        lines.forEach((l, i) => { if (l === c.anchor && (best === -1 || Math.abs(i + 1 - c.line) < Math.abs(best - c.line))) best = i + 1; });
        if (best > 0) c.line = best;
        return Math.min(c.line, lines.length);
    };
    P.setCommentResolved = function (id, resolved) {
        const c = (this.codeComments || []).find(x => x.id === id);
        if (!c) return null;
        c.resolved = resolved; c.resolvedAt = resolved ? Date.now() : null;
        this.saveCodeComments();
        if (document.getElementById('cm-list')) this.renderComments();
        return c;
    };
    P.deleteCodeComment = function (id) {
        this.codeComments = (this.codeComments || []).filter(x => x.id !== id);
        this.saveCodeComments();
        if (document.getElementById('cm-list')) this.renderComments();
    };
    P.moveCodeComments = function (from, to, isFolder) {
        let moved = 0;
        (this.codeComments || []).forEach(c => {
            if (c.path === from) { c.path = to; moved++; }
            else if (isFolder && c.path.startsWith(from + '/')) { c.path = to + c.path.slice(from.length); moved++; }
        });
        if (moved) this.saveCodeComments();
        return moved;
    };
    P.updateCommentBadge = function () {
        const open = (this.codeComments || []).filter(c => !c.resolved).length;
        const b = document.getElementById('btn-studio-comments');
        if (b) b.innerHTML = `<i class="fa-solid fa-comments text-blue"></i><span>تعليقات</span>${open ? `<span class="cm-badge">${open}</span>` : ''}`;
    };
    P.addCommentAtCaret = async function () {
        const path = this.activeStudioFile;
        if (!path || !this.virtualProjectFiles.has(path)) { this.showToast('افتح ملفاً في الاستوديو أولاً', 'warning'); return null; }
        const line = this.studioCaretLine();
        const text = await this.askText(`💬 تعليق على ${path.split('/').pop()}:${line}`, '', { placeholder: 'ملاحظة، سؤال، أو مهمة لهذا السطر...', dir: 'auto' });
        if (!text) return null;
        const c = this.addCodeComment(path, line, text);
        this.showToast('💬 تمت إضافة التعليق', 'success');
        return c;
    };
    P.openComments = function (filter = 'open') {
        this._cmFilter = filter;
        this.openPanel({
            title: 'تعليقات الكود', icon: 'fa-comments',
            tabs: [['open', 'fa-circle-dot', 'مفتوحة'], ['resolved', 'fa-circle-check', 'محلولة'], ['all', 'fa-list', 'الكل']].map(([id, icon, label]) => ({ id, icon, label, onclick: `app.openComments('${id}')` })), activeTab: filter,
            actions: `<button class="sidebar-btn-util gh-btn" onclick="app.addCommentAtCaret()"><i class="fa-solid fa-plus"></i><span class="hide-sm">تعليق على السطر الحالي</span></button>`,
            body: '<div id="cm-list" class="cm-list"></div>'
        });
        this.renderComments();
    };
    P.renderComments = function () {
        const el = document.getElementById('cm-list');
        if (!el) return [];
        const esc = (x) => this.escapeHTML(x);
        const f = this._cmFilter || 'open';
        const list = (this.codeComments || []).filter(c => f === 'all' || (f === 'resolved' ? c.resolved : !c.resolved));
        list.forEach(c => this.locateComment(c));
        const groups = {};
        list.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line).forEach(c => (groups[c.path] = groups[c.path] || []).push(c));
        el.innerHTML = Object.keys(groups).length ? Object.entries(groups).map(([path, cs]) => `<div class="cm-file"><div class="cm-file-head" dir="ltr"><i class="fa-solid fa-file-code"></i> ${esc(path)}${this.virtualProjectFiles.has(path) ? '' : ' <span class="text-red">(محذوف)</span>'}</div>
            ${cs.map(c => `<div class="cm-item ${c.resolved ? 'resolved' : ''}">
                <div class="cm-line" onclick="app.jumpToComment('${c.id}')" title="انتقال"><span class="ln">${c.line}</span><code dir="ltr">${esc((c.anchor || '').trim().slice(0, 140))}</code></div>
                <div class="cm-text">${esc(c.text)}</div>
                <div class="cm-actions"><span class="text-dim">${new Date(c.created).toLocaleString('ar')}</span><span class="gh-spacer"></span>
                    <button class="fx-link" onclick="app.askAIAboutComment('${c.id}')"><i class="fa-solid fa-wand-magic-sparkles"></i> عالجه بالذكاء</button>
                    <button class="fx-link" onclick="app.setCommentResolved('${c.id}', ${!c.resolved})"><i class="fa-solid ${c.resolved ? 'fa-rotate-left' : 'fa-check'}"></i> ${c.resolved ? 'إعادة فتح' : 'حل'}</button>
                    <button class="fx-link" onclick="app.deleteCodeComment('${c.id}')"><i class="fa-solid fa-trash"></i></button></div></div>`).join('')}</div>`).join('')
            : `<div class="gh-empty">${f === 'open' ? 'لا توجد تعليقات مفتوحة 🎉' : 'لا توجد تعليقات'}<br><span class="text-dim" style="font-size:.8rem">ضع المؤشر على سطر في الاستوديو ثم «تعليق على السطر الحالي» (Ctrl+Alt+M)</span></div>`;
        return list;
    };
    P.jumpToComment = function (id) {
        const c = (this.codeComments || []).find(x => x.id === id);
        if (!c || !this.virtualProjectFiles.has(c.path)) return false;
        const line = this.locateComment(c);
        this.closeModals();
        this.openProjectFile(c.path);
        setTimeout(() => {
            const ta = document.getElementById('studio-editor-textarea');
            if (!ta) return;
            const lines = ta.value.split('\n');
            const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
            ta.focus();
            ta.setSelectionRange(start, start + (lines[line - 1] || '').length);
            const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
            ta.scrollTop = Math.max(0, (line - 5) * lh);
        }, 30);
        return true;
    };
    P.askAIAboutComment = function (id) {
        const c = (this.codeComments || []).find(x => x.id === id);
        const f = c && this.virtualProjectFiles.get(c.path);
        if (!f) return null;
        const line = this.locateComment(c);
        const lines = (f.content || '').split('\n');
        const from = Math.max(0, line - 15), to = Math.min(lines.length, line + 15);
        const snippet = lines.slice(from, to).map((l, i) => `${from + i + 1}${from + i + 1 === line ? ' >>' : '   '} ${l}`).join('\n');
        const prompt = `لدي تعليق مراجعة على الملف \`${c.path}\` عند السطر ${line}:\n\n> ${c.text}\n\nالمقطع (السطر المعني مُعلَّم بـ >>):\n\`\`\`${c.path.split('.').pop()}\n${snippet}\n\`\`\`\n\nعالج التعليق: اشرح المشكلة باختصار ثم أعطِ الكود المعدل.`;
        this.closeModals();
        this.insertIntoInput ? this.insertIntoInput(prompt) : (document.getElementById('user-input').value = prompt);
        return prompt;
    };

    // ------------------------------------------------------------------ TASKS (#759-#768, #793, #797)
    const PRIORITY = { high: { label: 'عالية', color: '#f87171' }, med: { label: 'متوسطة', color: '#fbbf24' }, low: { label: 'منخفضة', color: '#34d399' } };
    const STATUS = { todo: 'للتنفيذ', doing: 'قيد العمل', done: 'منجزة' };
    P.saveTasks = function () { if (this.idbSet) this.idbSet('tasks_v1', this.tasks || []).catch(() => {}); };
    /** Quick-add syntax: "عنوان !high ~30m @2026-10-25" (also !عالي, @غدا / @tomorrow / @today, ~2h). */
    P.parseQuickTask = function (text, now = new Date()) {
        let title = String(text || '');
        const t = { priority: 'med', estimate: 0, deadline: null };
        title = title.replace(/(^|\s)!(high|h|عالي|عالية|med|m|متوسط|low|l|منخفض)(?=\s|$)/i, (_, s, p) => { t.priority = /^(high|h|عالي)/i.test(p) ? 'high' : /^(low|l|منخفض)/i.test(p) ? 'low' : 'med'; return s; });
        title = title.replace(/(^|\s)~(\d+(?:\.\d+)?)(m|h|د|س)(?=\s|$)/i, (_, s, n, u) => { t.estimate = Math.round(parseFloat(n) * (/[hس]/i.test(u) ? 60 : 1)); return s; });
        title = title.replace(/(^|\s)@(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?|today|tomorrow|اليوم|غدا|غداً)(?=\s|$)/i, (_, s, d) => {
            const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0);
            if (/today|اليوم/i.test(d)) t.deadline = base.getTime();
            else if (/tomorrow|غد/i.test(d)) t.deadline = base.getTime() + 864e5;
            else { const parsed = new Date(d.length === 10 ? d + 'T18:00' : d); if (!isNaN(parsed)) t.deadline = parsed.getTime(); }
            return s;
        });
        t.title = title.replace(/\s+/g, ' ').trim();
        return t;
    };
    P.addTask = function (input, extra = {}) {
        const parsed = typeof input === 'string' ? this.parseQuickTask(input) : input;
        if (!parsed.title) return null;
        const task = { id: uid('t_'), title: parsed.title, notes: parsed.notes || '', status: 'todo', priority: parsed.priority || 'med', estimate: parsed.estimate || 0, deadline: parsed.deadline || null, created: Date.now(), done: null, spent: 0, timerStart: null, sessionId: this.activeSessionId, ...extra };
        (this.tasks = this.tasks || []).push(task);
        this.saveTasks();
        if (task.deadline) this.requestNotifyPermission();
        return task;
    };
    P.updateTask = function (id, patch) {
        const t = (this.tasks || []).find(x => x.id === id);
        if (!t) return null;
        if (patch.status && patch.status !== t.status) {
            if (patch.status === 'done') { this.stopTaskTimer(id, true); t.done = Date.now(); } else t.done = null;
            if (patch.status === 'doing' && !t.timerStart && this.settings.autoTimer !== false) this.startTaskTimer(id, true);
        }
        Object.assign(t, patch);
        this.saveTasks();
        if (document.getElementById('tasks-root')) this.renderTasks();
        return t;
    };
    P.deleteTask = function (id) {
        const t = (this.tasks || []).find(x => x.id === id);
        this.tasks = (this.tasks || []).filter(x => x.id !== id);
        this.saveTasks();
        if (document.getElementById('tasks-root')) this.renderTasks();
        if (t && this.showActionToast) this.showActionToast(`🗑️ حُذفت «${this.escapeHTML(t.title)}»`, 'تراجع', () => { this.tasks.push(t); this.saveTasks(); if (document.getElementById('tasks-root')) this.renderTasks(); });
    };
    P.taskSpent = function (t, now = Date.now()) { return (t.spent || 0) + (t.timerStart ? now - t.timerStart : 0); };
    P.startTaskTimer = function (id, silent) {
        (this.tasks || []).forEach(t => { if (t.timerStart && t.id !== id) this.stopTaskTimer(t.id, true); });
        const t = (this.tasks || []).find(x => x.id === id);
        if (!t || t.timerStart) return t;
        t.timerStart = Date.now();
        if (t.status === 'todo') t.status = 'doing';
        this.saveTasks();
        if (!silent && document.getElementById('tasks-root')) this.renderTasks();
        this.ensureTaskTicker();
        return t;
    };
    P.stopTaskTimer = function (id, silent) {
        const t = (this.tasks || []).find(x => x.id === id);
        if (!t || !t.timerStart) return t;
        t.spent = (t.spent || 0) + (Date.now() - t.timerStart);
        t.timerStart = null;
        this.saveTasks();
        if (!silent && document.getElementById('tasks-root')) this.renderTasks();
        return t;
    };
    P.ensureTaskTicker = function () {
        if (this._taskTicker) return;
        this._taskTicker = setInterval(() => {
            document.querySelectorAll('[data-task-timer]').forEach(el => { const t = (this.tasks || []).find(x => x.id === el.dataset.taskTimer); if (t) el.textContent = fmtDuration(this.taskSpent(t)); });
        }, 1000);
    };
    const fmtDuration = (ms) => { const m = Math.floor(ms / 60000), h = Math.floor(m / 60); return h ? `${h}س ${m % 60}د` : m ? `${m}د ${Math.floor(ms / 1000) % 60}ث` : `${Math.floor(ms / 1000)}ث`; };
    P.fmtDuration = fmtDuration;
    P.isOverdue = (t, now = Date.now()) => !!(t.deadline && t.status !== 'done' && t.deadline < now);

    /** Reminders: 30 min before the deadline and once when overdue (#766, #767). */
    P.checkTaskReminders = function (now = Date.now()) {
        const fired = [];
        (this.tasks || []).forEach(t => {
            if (!t.deadline || t.status === 'done') return;
            if (t.deadline < now && !t.remOverdue) { t.remOverdue = true; fired.push(['overdue', t]); }
            else if (t.deadline - now <= 30 * 60000 && t.deadline >= now && !t.remSoon) { t.remSoon = true; fired.push(['soon', t]); }
        });
        fired.forEach(([kind, t]) => {
            const msg = kind === 'overdue' ? `⏰ تأخرت مهمة: ${t.title}` : `🔔 موعد قريب (خلال 30 دقيقة): ${t.title}`;
            this.showToast(this.escapeHTML(msg), kind === 'overdue' ? 'error' : 'warning');
            this.notify('OX-Alpha — المهام', msg);
        });
        if (fired.length) this.saveTasks();
        return fired;
    };
    P.requestNotifyPermission = function () {
        try { if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); } catch (e) {}
    };
    /** Do-not-disturb: user setting (#977) or an active focus session (#810). */
    P.isDnd = function () { return !!(this.settings.dnd || this._focusDnd); };
    P.notify = function (title, body) {
        if (this.isDnd()) return false;
        try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden !== false) { new Notification(title, { body, tag: 'ox-' + title }); return true; } } catch (e) {}
        return false;
    };

    P.openTasks = function (view = 'board') {
        this._taskView = view;
        this.openPanel({
            title: 'المهام', icon: 'fa-list-check',
            tabs: [['board', 'fa-table-columns', 'لوحة Kanban'], ['list', 'fa-list-ul', 'قائمة'], ['report', 'fa-chart-pie', 'التقرير']].map(([id, icon, label]) => ({ id, icon, label, onclick: `app.openTasks('${id}')` })), activeTab: view,
            actions: `<button class="sidebar-btn-util gh-btn" onclick="app.suggestTasksAI()" title="يقترح الذكاء مهاماً من المحادثة الحالية والمشروع"><i class="fa-solid fa-wand-magic-sparkles"></i><span class="hide-sm">اقترح مهاماً</span></button>`,
            body: `<div class="task-add"><input id="task-quick" class="form-input-box" dir="auto" placeholder="مهمة جديدة… مثال: إصلاح تسجيل الدخول !high ~45m @غدا" onkeydown="if(event.key==='Enter'){app.quickAddTask(this.value); this.value='';}"><button class="btn-new-thread gh-btn" onclick="const i=document.getElementById('task-quick'); app.quickAddTask(i.value); i.value='';"><i class="fa-solid fa-plus"></i></button></div><div id="tasks-root"></div>`
        });
        this.renderTasks();
        this.ensureTaskTicker();
    };
    P.quickAddTask = function (text) {
        const t = this.addTask(text);
        if (!t) return null;
        this.renderTasks();
        document.getElementById('task-quick')?.focus();
        return t;
    };
    P.renderTasks = function () {
        const root = document.getElementById('tasks-root');
        if (!root) return;
        const esc = (x) => this.escapeHTML(x);
        const tasks = this.tasks || [];
        const view = this._taskView || 'board';
        const card = (t) => {
            const over = this.isOverdue(t);
            const pr = PRIORITY[t.priority] || PRIORITY.med;
            const est = t.estimate ? ` / ${t.estimate >= 60 ? (t.estimate / 60).toFixed(1).replace('.0', '') + 'س' : t.estimate + 'د'}` : '';
            return `<div class="task-card ${over ? 'overdue' : ''} ${t.status === 'done' ? 'done' : ''}" draggable="true" data-task="${t.id}" style="--pr:${pr.color}">
                <div class="task-title" dir="auto">${esc(t.title)}</div>
                ${t.notes ? `<div class="task-notes" dir="auto">${esc(t.notes).slice(0, 160)}</div>` : ''}
                <div class="task-meta">
                    <span class="task-pr" title="الأولوية">${pr.label}</span>
                    ${t.deadline ? `<span class="${over ? 'text-red' : ''}" title="الموعد النهائي"><i class="fa-regular fa-calendar"></i> ${new Date(t.deadline).toLocaleDateString('ar', { month: 'short', day: 'numeric' })}${over ? ' • متأخرة' : ''}</span>` : ''}
                    <span title="الوقت المستغرق / التقدير"><i class="fa-regular fa-clock"></i> <b data-task-timer="${t.id}">${fmtDuration(this.taskSpent(t))}</b>${est}</span>
                </div>
                <div class="task-actions">
                    ${t.status !== 'done' ? `<button onclick="app.${t.timerStart ? 'stopTaskTimer' : 'startTaskTimer'}('${t.id}')" title="${t.timerStart ? 'إيقاف المؤقت' : 'بدء المؤقت'}"><i class="fa-solid ${t.timerStart ? 'fa-pause' : 'fa-play'}"></i></button>` : ''}
                    ${t.status !== 'todo' ? `<button onclick="app.updateTask('${t.id}', {status:'${t.status === 'done' ? 'doing' : 'todo'}'})" title="رجوع"><i class="fa-solid fa-arrow-right"></i></button>` : ''}
                    ${t.status !== 'done' ? `<button onclick="app.updateTask('${t.id}', {status:'${t.status === 'todo' ? 'doing' : 'done'}'})" title="تقدم"><i class="fa-solid fa-arrow-left"></i></button>` : ''}
                    <button onclick="app.editTaskDialog('${t.id}')" title="تعديل"><i class="fa-solid fa-pen"></i></button>
                    <button onclick="app.deleteTask('${t.id}')" title="حذف"><i class="fa-solid fa-trash"></i></button>
                </div></div>`;
        };
        if (view === 'board') {
            root.innerHTML = `<div class="kanban">${Object.entries(STATUS).map(([st, label]) => {
                const col = tasks.filter(t => t.status === st).sort((a, b) => (b.priority === 'high') - (a.priority === 'high') || (a.deadline || 9e15) - (b.deadline || 9e15));
                return `<div class="kanban-col" data-status="${st}"><div class="kanban-head">${label} <span class="text-dim">${col.length}</span></div><div class="kanban-cards">${col.map(card).join('') || '<div class="kanban-empty">اسحب مهمة إلى هنا</div>'}</div></div>`;
            }).join('')}</div>`;
            this.bindKanbanDnD(root);
        } else if (view === 'list') {
            const sorted = tasks.slice().sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.deadline || 9e15) - (b.deadline || 9e15));
            root.innerHTML = sorted.length ? `<div class="todo-list">${sorted.map(t => `<label class="todo-row ${t.status === 'done' ? 'done' : ''} ${this.isOverdue(t) ? 'overdue' : ''}">
                <input type="checkbox" ${t.status === 'done' ? 'checked' : ''} onchange="app.updateTask('${t.id}', {status: this.checked ? 'done' : 'todo'})">
                <span class="todo-dot" style="background:${(PRIORITY[t.priority] || PRIORITY.med).color}"></span><span class="todo-title" dir="auto">${esc(t.title)}</span>
                <span class="text-dim">${t.deadline ? new Date(t.deadline).toLocaleDateString('ar') : ''}</span><span class="text-dim" data-task-timer="${t.id}">${fmtDuration(this.taskSpent(t))}</span></label>`).join('')}</div>` : '<div class="gh-empty">لا توجد مهام بعد</div>';
        } else {
            const r = this.computeTaskReport();
            const maxDay = Math.max(1, ...r.days.map(d => d.ms));
            root.innerHTML = `<div class="hub-stats-grid">
                    <div class="hub-stat-card"><div class="hub-stat-title">منجزة هذا الأسبوع</div><div class="hub-stat-value">${r.doneWeek}</div><div class="hub-stat-sub">من ${r.total} مهمة</div></div>
                    <div class="hub-stat-card"><div class="hub-stat-title">نسبة الإنجاز</div><div class="hub-stat-value">${r.completion}%</div><div class="hub-stat-sub">${r.open} مفتوحة</div></div>
                    <div class="hub-stat-card"><div class="hub-stat-title">الوقت المسجل (7 أيام)</div><div class="hub-stat-value">${fmtDuration(r.weekMs)}</div><div class="hub-stat-sub">إجمالي ${fmtDuration(r.totalMs)}</div></div>
                    <div class="hub-stat-card"><div class="hub-stat-title">دقة التقدير</div><div class="hub-stat-value">${r.accuracy === null ? '—' : r.accuracy + '%'}</div><div class="hub-stat-sub">${r.overdue.length} متأخرة</div></div></div>
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-chart-column"></i> الوقت المنجز يومياً</div><div class="hub-chart">${r.days.map(d => `<div class="hub-bar-col" title="${new Date(d.from).toLocaleDateString('ar')} — ${fmtDuration(d.ms)} • ${d.done} منجزة"><div class="hub-bar" style="height:${Math.max(2, Math.round(d.ms / maxDay * 100))}%"></div><span>${new Date(d.from).getDate()}</span></div>`).join('')}</div></div>
                ${r.overdue.length ? `<div class="hub-section"><div class="hub-section-title text-red"><i class="fa-solid fa-triangle-exclamation"></i> متأخرة</div>${r.overdue.map(t => `<div class="todo-row overdue"><span class="todo-title">${esc(t.title)}</span><span class="text-dim">${new Date(t.deadline).toLocaleString('ar')}</span></div>`).join('')}</div>` : ''}
                <div class="gh-toolbar"><button class="sidebar-btn-util gh-btn" onclick="app.taskProgressAI()"><i class="fa-solid fa-wand-magic-sparkles"></i> تقرير تقدم بالذكاء</button>
                    <button class="sidebar-btn-util gh-btn" onclick="app.copyText(app.buildTaskReportText(), 'تم نسخ التقرير')"><i class="fa-solid fa-copy"></i> نسخ التقرير</button>
                    ${this.sendToWebhook ? `<button class="sidebar-btn-util gh-btn" onclick="app.sendToWebhook(app.buildTaskReportText())"><i class="fa-brands fa-discord"></i> إرسال للفريق</button>` : ''}</div>
                <div id="task-ai-report" class="gh-card gh-md" style="display:none"></div>`;
        }
    };
    P.bindKanbanDnD = function (root) {
        root.querySelectorAll('.task-card').forEach(c => c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/ox-task', c.dataset.task); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); }));
        root.querySelectorAll('.kanban-col').forEach(col => {
            col.addEventListener('dragover', (e) => { if (Array.from(e.dataTransfer.types || []).includes('text/ox-task')) { e.preventDefault(); col.classList.add('drop-target'); } });
            col.addEventListener('dragleave', () => col.classList.remove('drop-target'));
            col.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); col.classList.remove('drop-target'); const id = e.dataTransfer.getData('text/ox-task'); if (id) this.updateTask(id, { status: col.dataset.status }); });
        });
    };
    P.editTaskDialog = async function (id) {
        const t = (this.tasks || []).find(x => x.id === id);
        if (!t) return null;
        const toLocal = (ts) => { if (!ts) return ''; const d = new Date(ts); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
        const r = await this.showDialog({
            title: '✏️ تعديل المهمة',
            fields: [
                { id: 'title', label: 'العنوان', value: t.title, dir: 'auto' },
                { id: 'notes', label: 'ملاحظات', type: 'textarea', value: t.notes || '', rows: 3 },
                { id: 'priority', label: 'الأولوية', type: 'select', value: t.priority, options: Object.entries(PRIORITY).map(([value, p]) => ({ value, label: p.label })) },
                { id: 'estimate', label: 'التقدير (دقائق)', value: String(t.estimate || ''), dir: 'ltr' },
                { id: 'deadline', label: 'الموعد النهائي (YYYY-MM-DDTHH:MM)', value: toLocal(t.deadline), dir: 'ltr' }
            ],
            buttons: [{ label: 'حفظ', value: 'ok', primary: true, validate: (v) => (!v.title.trim() ? 'العنوان مطلوب' : v.deadline && isNaN(new Date(v.deadline)) ? 'تاريخ غير صالح' : null) }, { label: 'إلغاء', value: null }]
        });
        if (!r) return null;
        const v = r.values;
        const deadline = v.deadline ? new Date(v.deadline).getTime() : null;
        return this.updateTask(id, { title: v.title.trim(), notes: v.notes, priority: v.priority, estimate: parseInt(v.estimate, 10) || 0, deadline, remSoon: deadline === t.deadline ? t.remSoon : false, remOverdue: deadline === t.deadline ? t.remOverdue : false });
    };
    const startOfDay = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
    P.computeTaskReport = function (now = Date.now()) {
        const tasks = this.tasks || [];
        const weekAgo = startOfDay(now) - 6 * 864e5;
        const done = tasks.filter(t => t.status === 'done');
        const withEst = done.filter(t => t.estimate && t.spent);
        const accuracy = withEst.length ? Math.round(100 - Math.min(100, withEst.reduce((n, t) => n + Math.abs(t.spent / 60000 - t.estimate) / t.estimate, 0) / withEst.length * 100)) : null;
        // Time per day is attributed to the day the task was last worked on (done date or now)
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const from = startOfDay(now) - i * 864e5, to = from + 864e5;
            const ts = tasks.filter(t => { const when = t.done || (t.timerStart ? now : t.lastWorked || t.created); return when >= from && when < to; });
            days.push({ from, ms: ts.reduce((n, t) => n + this.taskSpent(t, now), 0), done: ts.filter(t => t.status === 'done').length });
        }
        return {
            total: tasks.length, open: tasks.length - done.length,
            doneWeek: done.filter(t => t.done >= weekAgo).length,
            completion: tasks.length ? Math.round(done.length / tasks.length * 100) : 0,
            totalMs: tasks.reduce((n, t) => n + this.taskSpent(t, now), 0),
            weekMs: days.reduce((n, d) => n + d.ms, 0),
            accuracy, days, overdue: tasks.filter(t => this.isOverdue(t, now))
        };
    };
    P.buildTaskReportText = function () {
        const r = this.computeTaskReport();
        const tasks = this.tasks || [];
        const line = (t) => `- ${t.status === 'done' ? '✅' : t.status === 'doing' ? '🔄' : '⬜'} ${t.title}${t.deadline ? ` (موعد: ${new Date(t.deadline).toLocaleDateString('ar')})` : ''} — ${fmtDuration(this.taskSpent(t))}`;
        return `📋 تقرير المهام — ${new Date().toLocaleDateString('ar')}\nمنجزة هذا الأسبوع: ${r.doneWeek} • نسبة الإنجاز: ${r.completion}% • الوقت (7 أيام): ${fmtDuration(r.weekMs)} • متأخرة: ${r.overdue.length}\n\n${['doing', 'todo', 'done'].map(s => tasks.filter(t => t.status === s).map(line).join('\n')).filter(Boolean).join('\n')}`;
    };
    /** Extract a JSON array from a model reply (tolerates prose and code fences). */
    P.extractJsonArray = function (text) {
        const s = String(text || '');
        const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
        const src = fence ? fence[1] : s;
        const a = src.indexOf('['), b = src.lastIndexOf(']');
        if (a === -1 || b <= a) return null;
        try { const v = JSON.parse(src.slice(a, b + 1)); return Array.isArray(v) ? v : null; } catch (e) { return null; }
    };
    P.suggestTasksAI = async function () {
        if (!this.settings.apiKey?.trim() || !this.streamOpenRouter) { this.showToast('يلزم مفتاح OpenRouter', 'warning'); return null; }
        const session = this.sessions.find(s => s.id === this.activeSessionId);
        const recent = (session?.messages || []).slice(-6).map(m => `${m.role}: ${cleanContent(m.content).slice(0, 1500)}`).join('\n\n');
        const files = this.projectPaths ? this.projectPaths().slice(0, 80).join('\n') : '';
        const existing = (this.tasks || []).filter(t => t.status !== 'done').map(t => '- ' + t.title).join('\n');
        const root = document.getElementById('tasks-root');
        if (root) root.innerHTML = '<div class="gh-empty"><span class="live-step-spinner"></span> الذكاء يحلل المحادثة والمشروع...</div>';
        try {
            const model = (this.routeForCategory && this.routeForCategory('coding')) || this.settings.selectedModel;
            const r = await this.streamOpenRouter({
                model, maxTokens: 1200,
                messages: [{ role: 'user', content: `You are a pragmatic tech lead. Based on the conversation and project below, propose 3 to 8 concrete next tasks. Reply ONLY with a JSON array: [{"title": "...(in the user's language, short)", "priority": "high|med|low", "estimate": minutes}]. Do not repeat existing tasks.\n\nExisting open tasks:\n${existing || '(none)'}\n\nProject files:\n${files || '(none)'}\n\nRecent conversation:\n${recent || '(empty)'}` }]
            });
            const arr = (this.extractJsonArray(r.content) || []).filter(x => x && x.title).slice(0, 10);
            if (this.recordUsage) this.recordUsage({ model, usage: r.usage, promptChars: recent.length + files.length, completionChars: (r.content || '').length, durationMs: r.durationMs, source: 'tasks' });
            this._taskSuggestions = arr;
            if (!arr.length) { this.showToast('لم يقترح النموذج مهاماً صالحة — حاول مجدداً', 'warning'); this.renderTasks(); return []; }
            if (root) root.innerHTML = `<div class="gh-card"><b>💡 مهام مقترحة</b>${arr.map((x, i) => `<label class="todo-row"><input type="checkbox" checked data-sug="${i}"><span class="todo-dot" style="background:${(PRIORITY[x.priority] || PRIORITY.med).color}"></span><span class="todo-title" dir="auto">${this.escapeHTML(String(x.title))}</span><span class="text-dim">${x.estimate ? x.estimate + 'د' : ''}</span></label>`).join('')}
                <div class="gh-toolbar"><span class="gh-spacer"></span><button class="sidebar-btn-util gh-btn" onclick="app.renderTasks()">إلغاء</button><button class="btn-new-thread gh-btn" onclick="app.acceptSuggestedTasks()"><i class="fa-solid fa-check"></i> إضافة المحدد</button></div></div>`;
            return arr;
        } catch (e) {
            this.showToast('❌ ' + this.escapeHTML(e.message), 'error');
            this.renderTasks();
            return null;
        }
    };
    P.acceptSuggestedTasks = function () {
        const picks = Array.from(document.querySelectorAll('#tasks-root [data-sug]')).filter(c => c.checked).map(c => this._taskSuggestions[+c.dataset.sug]);
        picks.forEach(x => this.addTask({ title: String(x.title).slice(0, 200), priority: PRIORITY[x.priority] ? x.priority : 'med', estimate: parseInt(x.estimate, 10) || 0 }, { source: 'ai' }));
        this.renderTasks();
        this.showToast(`✅ أضيفت ${picks.length} مهمة`, 'success');
        return picks.length;
    };
    P.taskProgressAI = async function () {
        const box = document.getElementById('task-ai-report');
        if (!this.settings.apiKey?.trim() || !this.streamOpenRouter) { this.showToast('يلزم مفتاح OpenRouter', 'warning'); return null; }
        if (box) { box.style.display = ''; box.innerHTML = '<span class="live-step-spinner"></span>'; }
        try {
            const model = (this.routeForCategory && this.routeForCategory('chat')) || this.settings.selectedModel;
            const r = await this.streamOpenRouter({
                model, maxTokens: 900,
                messages: [{ role: 'user', content: `اكتب تقرير تقدم موجزاً (بالعربية، Markdown) لهذه المهام: ما أُنجز، ما يتأخر وما السبب المحتمل، ما الأولوية التالية، وتنبيه للمهام المتأخرة مع اقتراح حل لكل منها.\n\n${this.buildTaskReportText()}` }],
                onDelta: (c) => { if (box) box.innerHTML = this.renderMarkdownSafe(c); }
            });
            if (box) box.innerHTML = this.renderMarkdownSafe(r.content);
            return r.content;
        } catch (e) { if (box) box.innerHTML = `<span class="text-red">❌ ${this.escapeHTML(e.message)}</span>`; return null; }
    };

    // ------------------------------------------------------------------ WHITEBOARD (#755, #672, #1004)
    const WB_W = 1600, WB_H = 1000;
    const WB_COLORS = ['#f8fafc', '#38bdf8', '#34d399', '#fbbf24', '#f87171', '#c084fc', '#0f172a'];
    P.openWhiteboard = async function () {
        if (!this._wb) {
            let saved = null;
            try { saved = this.idbGet ? await this.idbGet('whiteboard_v1') : null; } catch (e) {}
            this._wb = { items: (saved && saved.items) || [], redo: [], tool: 'pen', color: '#38bdf8', size: 4, bg: (saved && saved.bg) || 'dark' };
        }
        const wb = this._wb;
        const tool = (id, icon, label) => `<button class="wb-tool ${wb.tool === id ? 'active' : ''}" data-tool="${id}" onclick="app.wbSet('tool','${id}')" title="${label}"><i class="fa-solid ${icon}"></i></button>`;
        this.openPanel({
            title: 'السبورة البيضاء', icon: 'fa-chalkboard',
            body: `<div class="wb-toolbar">
                    ${tool('pen', 'fa-pen', 'قلم')}${tool('marker', 'fa-highlighter', 'قلم تمييز')}${tool('eraser', 'fa-eraser', 'ممحاة')}${tool('line', 'fa-minus', 'خط')}${tool('arrow', 'fa-arrow-right-long', 'سهم')}${tool('rect', 'fa-square', 'مستطيل')}${tool('ellipse', 'fa-circle', 'شكل بيضاوي')}${tool('text', 'fa-font', 'نص')}
                    <span class="wb-sep"></span>${WB_COLORS.map(c => `<button class="wb-color ${wb.color === c ? 'active' : ''}" data-color="${c}" style="background:${c}" onclick="app.wbSet('color','${c}')" aria-label="لون ${c}"></button>`).join('')}<input type="color" value="${wb.color}" oninput="app.wbSet('color', this.value)" title="لون مخصص">
                    <input type="range" min="1" max="40" value="${wb.size}" oninput="app.wbSet('size', +this.value)" title="السُّمك">
                    <span class="wb-sep"></span><button class="wb-tool" onclick="app.wbUndo()" title="تراجع (Ctrl+Z)"><i class="fa-solid fa-rotate-left"></i></button><button class="wb-tool" onclick="app.wbRedo()" title="إعادة"><i class="fa-solid fa-rotate-right"></i></button>
                    <select class="form-input-box wb-bg" onchange="app.wbSet('bg', this.value)">${[['dark', 'داكن'], ['light', 'أبيض'], ['grid', 'شبكة']].map(([v, l]) => `<option value="${v}" ${wb.bg === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
                    <button class="wb-tool" onclick="app.wbClear()" title="مسح الكل"><i class="fa-solid fa-trash"></i></button></div>
                <div class="wb-stage"><canvas id="wb-canvas" width="${WB_W}" height="${WB_H}"></canvas></div>`,
            footer: `<button class="sidebar-btn-util gh-btn" onclick="app.wbExport('download')"><i class="fa-solid fa-download"></i> PNG</button>
                <button class="sidebar-btn-util gh-btn" onclick="app.wbExport('gallery')"><i class="fa-solid fa-photo-film"></i> حفظ في المعرض</button>
                <span class="gh-spacer"></span>
                <button class="sidebar-btn-util gh-btn" onclick="app.wbExport('attach')"><i class="fa-solid fa-paperclip"></i> إرفاق</button>
                <button class="btn-new-thread gh-btn" onclick="app.wbExport('code')"><i class="fa-solid fa-code"></i> حوّل الرسم إلى كود</button>`
        });
        this.bindWhiteboard();
        this.wbRender();
        return wb;
    };
    P.wbSet = function (k, v) {
        const wb = this._wb;
        wb[k] = v;
        if (k === 'tool') document.querySelectorAll('.wb-tool[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === v));
        if (k === 'color') document.querySelectorAll('.wb-color').forEach(b => b.classList.toggle('active', b.dataset.color === v));
        if (k === 'bg') { this.wbRender(); this.wbSave(); }
    };
    P.wbSave = function () {
        clearTimeout(this._wbSaveTimer);
        this._wbSaveTimer = setTimeout(() => { if (this.idbSet) this.idbSet('whiteboard_v1', { items: this._wb.items, bg: this._wb.bg }).catch(() => {}); }, 600);
    };
    P.wbAddItem = function (item) { this._wb.items.push(item); this._wb.redo = []; this.wbRender(); this.wbSave(); return item; };
    P.wbUndo = function () { const it = this._wb.items.pop(); if (it) { this._wb.redo.push(it); this.wbRender(); this.wbSave(); } return it; };
    P.wbRedo = function () { const it = this._wb.redo.pop(); if (it) { this._wb.items.push(it); this.wbRender(); this.wbSave(); } return it; };
    P.wbClear = async function () {
        if (!this._wb.items.length) return;
        const items = this._wb.items;
        this._wb.items = []; this._wb.redo = [];
        this.wbRender(); this.wbSave();
        if (this.showActionToast) this.showActionToast('🧹 تم مسح السبورة', 'تراجع', () => { this._wb.items = items; this.wbRender(); this.wbSave(); });
    };
    const drawItem = (ctx, it) => {
        ctx.save();
        ctx.strokeStyle = it.color; ctx.fillStyle = it.color; ctx.lineWidth = it.size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        if (it.tool === 'marker') { ctx.globalAlpha = 0.35; ctx.lineWidth = it.size * 3; }
        if (it.tool === 'eraser') { ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = it.size * 4; }
        if (it.points && it.pressure && it.points.length > 1) {
            // Stylus pressure (#357): per-segment width from the 3rd point component
            const base = ctx.lineWidth;
            for (let i = 1; i < it.points.length; i++) {
                const a = it.points[i - 1], b = it.points[i];
                ctx.beginPath();
                ctx.lineWidth = Math.max(0.5, base * (0.35 + 1.3 * (((a[2] == null ? 0.5 : a[2]) + (b[2] == null ? 0.5 : b[2])) / 2)));
                ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
                ctx.stroke();
            }
        } else if (it.points) {
            ctx.beginPath();
            it.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            if (it.points.length === 1) ctx.lineTo(it.points[0][0] + 0.1, it.points[0][1]);
            ctx.stroke();
        } else if (it.tool === 'text') {
            ctx.font = `600 ${it.size * 6 + 12}px Cairo, sans-serif`;
            ctx.textBaseline = 'top';
            String(it.text).split('\n').forEach((l, i) => ctx.fillText(l, it.x1, it.y1 + i * (it.size * 6 + 18)));
        } else {
            const { x1, y1, x2, y2 } = it;
            ctx.beginPath();
            if (it.tool === 'rect') ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
            else if (it.tool === 'ellipse') { ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2); ctx.stroke(); }
            else {
                ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
                if (it.tool === 'arrow') {
                    const a = Math.atan2(y2 - y1, x2 - x1), h = 14 + it.size * 2;
                    ctx.beginPath(); ctx.moveTo(x2, y2);
                    ctx.lineTo(x2 - h * Math.cos(a - 0.45), y2 - h * Math.sin(a - 0.45));
                    ctx.lineTo(x2 - h * Math.cos(a + 0.45), y2 - h * Math.sin(a + 0.45));
                    ctx.closePath(); ctx.fill();
                }
            }
        }
        ctx.restore();
    };
    /** Render background + all items (items on their own layer so the eraser doesn't erase the background). */
    P.wbRenderTo = function (canvas, extra) {
        const wb = this._wb;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const layer = document.createElement('canvas');
        layer.width = WB_W; layer.height = WB_H;
        const lctx = layer.getContext('2d');
        wb.items.concat(extra ? [extra] : []).forEach(it => drawItem(lctx, it));
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = wb.bg === 'dark' ? '#0f1115' : '#ffffff';
        ctx.fillRect(0, 0, WB_W, WB_H);
        if (wb.bg === 'grid') {
            ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
            for (let x = 0; x <= WB_W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WB_H); ctx.stroke(); }
            for (let y = 0; y <= WB_H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WB_W, y); ctx.stroke(); }
        }
        ctx.drawImage(layer, 0, 0);
        ctx.restore();
        return canvas;
    };
    P.wbRender = function (extra) { const c = document.getElementById('wb-canvas'); if (c && this._wb) this.wbRenderTo(c, extra); };
    P.bindWhiteboard = function () {
        const c = document.getElementById('wb-canvas');
        if (!c) return;
        let cur = null;
        const pt = (e) => { const r = c.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * WB_W / (r.width || WB_W)), Math.round((e.clientY - r.top) * WB_H / (r.height || WB_H))]; };
        c.addEventListener('pointerdown', async (e) => {
            const wb = this._wb, [x, y] = pt(e);
            if (wb.tool === 'text') {
                const text = await this.askText('✍️ النص', '', { dir: 'auto' });
                if (text) this.wbAddItem({ tool: 'text', color: wb.color, size: wb.size, x1: x, y1: y, text });
                return;
            }
            c.setPointerCapture?.(e.pointerId);
            const pen = e.pointerType === 'pen' && wb.tool === 'pen';
            cur = ['pen', 'marker', 'eraser'].includes(wb.tool) ? { tool: wb.tool, color: wb.color, size: wb.size, points: [pen ? [x, y, +(e.pressure || 0.5).toFixed(2)] : [x, y]], ...(pen ? { pressure: true } : {}) } : { tool: wb.tool, color: wb.color, size: wb.size, x1: x, y1: y, x2: x, y2: y };
        });
        c.addEventListener('pointermove', (e) => {
            if (!cur) return;
            const [x, y] = pt(e);
            if (cur.points) { const l = cur.points[cur.points.length - 1]; if (Math.abs(l[0] - x) + Math.abs(l[1] - y) >= 2) cur.points.push(cur.pressure ? [x, y, +(e.pressure || 0.5).toFixed(2)] : [x, y]); }
            else { cur.x2 = x; cur.y2 = y; }
            this.wbRender(cur);
        });
        const end = () => { if (cur) { this.wbAddItem(cur); cur = null; } };
        c.addEventListener('pointerup', end);
        c.addEventListener('pointercancel', () => { cur = null; this.wbRender(); });
    };
    P.wbExport = async function (target) {
        const c = document.createElement('canvas');
        c.width = WB_W; c.height = WB_H;
        this.wbRenderTo(c);
        const dataUrl = c.toDataURL('image/png');
        const name = `whiteboard-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`;
        if (target === 'download') { this.downloadBlob(this.dataUrlToBlob(dataUrl), name); return dataUrl; }
        if (target === 'gallery' && this.addMediaItem) { await this.addMediaItem(this.dataUrlToBlob(dataUrl), name); this.showToast('🖼️ حُفظت في معرض الوسائط', 'success'); return dataUrl; }
        this.currentAttachments.push({ name: this.uniqueAttachmentName ? this.uniqueAttachmentName(name) : name, base64: dataUrl, isImage: true, size: Math.round(dataUrl.length * 0.75), mime: 'image/png' });
        this.renderAttachmentTray();
        this.closeModals();
        if (target === 'code') this.insertIntoInput('حوّل هذا الرسم التخطيطي المرفق إلى واجهة حقيقية: اكتب كود HTML + CSS + JavaScript كاملاً في ملف واحد، متجاوب ويدعم RTL، مع الحفاظ على تخطيط العناصر كما في الرسم. ثم اشرح كل قسم باختصار.');
        else this.showToast('📎 تم إرفاق الرسم', 'success');
        return dataUrl;
    };

    // ------------------------------------------------------------------ CONVERSATION MODES (#802-#805, #1005-#1007, #1009)
    const MODES = {
        teach: { icon: 'fa-chalkboard-user', label: 'تدريس', prompt: 'TEACH MODE: act as a patient teacher. Explain step by step from first principles, use small runnable examples and analogies, check understanding with one short question at the end, and adapt to the learner\'s level. Never dump a full solution without explaining it.', starter: 'علّمني ' },
        review: { icon: 'fa-magnifying-glass-chart', label: 'مراجعة كود', prompt: 'REVIEW MODE: act as a strict senior code reviewer. For any code shared, list findings grouped by severity (🔴 critical, 🟠 major, 🟡 minor, 💡 suggestion) with file/line references and a concrete fix for each. End with a verdict: Approve / Request changes.', starter: 'راجع هذا الكود:\n' },
        planning: { icon: 'fa-diagram-project', label: 'تخطيط', prompt: 'PLANNING MODE: do not write implementation code yet. Produce a plan: goals, assumptions, open questions, architecture (Mermaid diagram), milestones with estimates, risks with mitigations, and a numbered task list the user can paste into a task board.', starter: 'خطط لمشروع ' },
        brainstorm: { icon: 'fa-lightbulb', label: 'عصف ذهني', prompt: 'BRAINSTORM MODE: generate many diverse ideas quickly (at least 10), from safe to bold, grouped by theme, each with a one-line pitch. Do not judge early. Finish with the top 3 and why.', starter: 'أفكار لـ ' },
        interview: { icon: 'fa-user-tie', label: 'مقابلة عمل', prompt: 'INTERVIEW SIMULATOR: you are a technical interviewer for the role the user names (ask if unknown). Ask ONE question at a time (mix of coding, system design and behavioural), wait for the answer, then score it /10 with brief feedback and a model answer before the next question. After 5 questions give an overall assessment.', starter: 'ابدأ مقابلة لوظيفة ' },
        challenge: { icon: 'fa-trophy', label: 'تحديات برمجية', prompt: 'CODING CHALLENGE GAME: give the user one programming challenge at a time with a difficulty level (1-5), input/output examples and constraints. When they answer, run through test cases mentally, award points (0-100), show a better solution if any, keep a running score and level up the difficulty when they succeed.', starter: 'أعطني تحدياً في ' },
        startup: { icon: 'fa-rocket', label: 'مولد Startup', prompt: 'STARTUP GENERATOR: turn the user\'s idea into: problem & target users, value proposition, competitors, business model & pricing, a lean feasibility study (costs, risks), MVP scope, tech stack, database schema, and then the starter code for the MVP (file by file). Keep it realistic.', starter: 'فكرة مشروعي: ' },
        legacy: { icon: 'fa-clock-rotate-left', label: 'ترجمة كود قديم', prompt: 'LEGACY MODERNIZATION: translate legacy code (COBOL, Fortran, VB6, Pascal, old PHP/Java...) to the modern target language the user names (default Python). Preserve behaviour exactly, map data types explicitly, explain non-obvious legacy semantics (e.g. COBOL PIC clauses, fixed-point decimals), and provide unit tests proving equivalence.', starter: 'حوّل هذا الكود القديم إلى Python:\n' }
    };
    P.CHAT_MODES = MODES;
    P.decorateSystemPrompt = function (systemText, session) {
        const m = session && MODES[session.mode];
        return m ? `${systemText}\n\n[${m.label}] ${m.prompt}` : systemText;
    };
    P.setChatMode = function (mode) {
        const session = this.sessions.find(s => s.id === this.activeSessionId);
        if (!session) return null;
        session.mode = MODES[mode] ? mode : undefined;
        this.saveSessions();
        this.renderModeBadge();
        const input = document.getElementById('user-input');
        if (session.mode && input && !input.value.trim() && MODES[mode].starter) { input.value = MODES[mode].starter; input.focus(); }
        this.showToast(session.mode ? `🎭 وضع المحادثة: ${MODES[mode].label}` : 'تم الرجوع للوضع العادي', 'info');
        return session.mode || null;
    };
    P.renderModeBadge = function () {
        const el = document.getElementById('session-mode-badge');
        if (!el) return;
        const session = this.sessions.find(s => s.id === this.activeSessionId);
        const m = session && MODES[session.mode];
        el.style.display = m ? '' : 'none';
        el.innerHTML = m ? `<i class="fa-solid ${m.icon}"></i> وضع: <b>${m.label}</b><button onclick="app.setChatMode(null)" aria-label="إلغاء الوضع">×</button>` : '';
        const b = document.getElementById('btn-chat-mode');
        if (b) b.classList.toggle('active', !!m);
    };
    P.openModeMenu = function (anchor) {
        const session = this.sessions.find(s => s.id === this.activeSessionId);
        this.showMenu([
            { icon: session && session.mode ? 'fa-comment' : 'fa-check', label: 'عادي', run: () => this.setChatMode(null) },
            '-',
            ...Object.entries(MODES).map(([id, m]) => ({ icon: session && session.mode === id ? 'fa-check' : m.icon, label: m.label, run: () => this.setChatMode(id) })),
            '-',
            { icon: 'fa-person-chalkboard', label: 'عرض تقديمي للمحادثة', run: () => this.openPresentation() },
            { icon: 'fa-hourglass-half', label: 'مؤقت التركيز (Pomodoro)', run: () => this.openFocusTimer() }
        ], anchor);
    };

    // ------------------------------------------------------------------ PRESENTATION MODE (#801)
    P.buildSlides = function (session) {
        const slides = [];
        (session.messages || []).forEach(m => {
            const text = cleanContent(m.content);
            if (!text) return;
            if (m.role === 'user') { slides.push({ kind: 'question', md: text.length > 600 ? text.slice(0, 600) + '…' : text }); return; }
            // Split long answers on headings / horizontal rules (outside code fences)
            const parts = [];
            let buf = [], inFence = false;
            text.split('\n').forEach(line => {
                if (/^```/.test(line)) inFence = !inFence;
                if (!inFence && (/^#{1,3}\s/.test(line) || /^---+\s*$/.test(line)) && buf.join('').trim()) { parts.push(buf.join('\n')); buf = []; }
                if (!(/^---+\s*$/.test(line) && !inFence)) buf.push(line);
            });
            if (buf.join('').trim()) parts.push(buf.join('\n'));
            parts.forEach(p => slides.push({ kind: 'answer', md: p.trim(), model: m.model }));
        });
        return slides;
    };
    P.openPresentation = function (start = 0) {
        const session = this.sessions.find(s => s.id === this.activeSessionId);
        const slides = session ? this.buildSlides(session) : [];
        if (!slides.length) { this.showToast('لا يوجد محتوى للعرض', 'warning'); return null; }
        this.closeModals();
        let el = document.getElementById('ox-present');
        if (!el) {
            el = document.createElement('div');
            el.id = 'ox-present';
            el.className = 'ox-present';
            el.setAttribute('role', 'dialog');
            el.setAttribute('aria-label', 'عرض تقديمي');
            document.body.appendChild(el);
            el.addEventListener('click', (e) => { if (e.target.closest('[data-pres]')) this.presentGo(e.target.closest('[data-pres]').dataset.pres); });
            let sx = null;
            el.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
            el.addEventListener('touchend', (e) => { if (sx === null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) this.presentGo(dx < 0 ? 'next' : 'prev'); sx = null; });
        }
        this._present = { slides, i: Math.max(0, Math.min(start, slides.length - 1)), title: session.title };
        this._presentKey = this._presentKey || ((e) => {
            if (!this._present) return;
            if (['ArrowLeft', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); this.presentGo('next'); }
            else if (['ArrowRight', 'PageUp'].includes(e.key)) { e.preventDefault(); this.presentGo('prev'); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.presentGo('close'); }
        });
        window.addEventListener('keydown', this._presentKey, true);
        el.classList.add('active');
        this.renderPresentation();
        try { el.requestFullscreen?.().catch(() => {}); } catch (e) {}
        return this._present;
    };
    P.presentGo = function (dir) {
        const p = this._present;
        if (!p) return;
        if (dir === 'close') {
            document.getElementById('ox-present')?.classList.remove('active');
            window.removeEventListener('keydown', this._presentKey, true);
            this._present = null;
            try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
            return;
        }
        p.i = Math.max(0, Math.min(p.slides.length - 1, p.i + (dir === 'next' ? 1 : -1)));
        this.renderPresentation();
    };
    P.renderPresentation = function () {
        const p = this._present, el = document.getElementById('ox-present');
        if (!p || !el) return;
        const s = p.slides[p.i];
        el.innerHTML = `<div class="present-top"><span class="truncate">${this.escapeHTML(p.title || '')}</span><span>${p.i + 1} / ${p.slides.length}</span><button data-pres="close" aria-label="إغلاق"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="present-slide ${s.kind}">${s.kind === 'question' ? `<div class="present-q">❓</div><div class="present-q-text" dir="auto">${this.escapeHTML(s.md)}</div>` : `<div class="gh-md present-md">${this.renderMarkdownSafe(s.md)}</div>`}</div>
            <div class="present-nav"><button data-pres="prev" ${p.i === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button><div class="present-progress"><i style="width:${Math.round((p.i + 1) / p.slides.length * 100)}%"></i></div><button data-pres="next" ${p.i === p.slides.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button></div>`;
    };

    // ------------------------------------------------------------------ FOCUS TIMER (#810) + BREAKS (#809)
    P.openFocusTimer = function () {
        const f = this._focus;
        const running = f && f.end > Date.now();
        const openTasks = (this.tasks || []).filter(t => t.status !== 'done');
        this.openPanel({
            title: 'مؤقت التركيز', icon: 'fa-hourglass-half',
            body: running ? `<div class="focus-big" id="focus-remaining">${this.focusRemainingText()}</div><div class="text-dim" style="text-align:center">${f.phase === 'focus' ? '🎯 جلسة تركيز' : '☕ استراحة'}${f.taskId ? ' — ' + this.escapeHTML((this.tasks.find(t => t.id === f.taskId) || {}).title || '') : ''}</div>`
                : `<div class="focus-presets">${[[25, 5], [50, 10], [90, 15]].map(([w, b]) => `<button class="hub-mode-btn" onclick="app.startFocus(${w}, ${b}, document.getElementById('focus-task')?.value || null)"><b>${w} دقيقة</b><small>ثم استراحة ${b} د</small></button>`).join('')}</div>
                    ${openTasks.length ? `<label class="ox-field">ربط بمهمة (يُسجَّل الوقت عليها)<select id="focus-task" class="form-input-box"><option value="">—</option>${openTasks.map(t => `<option value="${t.id}">${this.escapeHTML(t.title)}</option>`).join('')}</select></label>` : ''}
                    <div class="text-dim" style="font-size:.8rem;margin-top:8px">أثناء الجلسة: وضع التركيز يخفي القوائم، وتُكتم الإشعارات، وتنبيه عند انتهاء الوقت مع اقتراح استراحة.</div>`,
            footer: running ? `<span class="gh-spacer"></span><button class="sidebar-btn-util gh-btn danger" onclick="app.stopFocus()"><i class="fa-solid fa-stop"></i> إنهاء الجلسة</button>` : ''
        });
    };
    P.focusRemainingText = function () {
        const f = this._focus;
        if (!f) return '00:00';
        const ms = Math.max(0, f.end - Date.now());
        return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
    };
    P.startFocus = function (workMin = 25, breakMin = 5, taskId = null, phase = 'focus') {
        this.stopFocus(true);
        const mins = phase === 'focus' ? workMin : breakMin;
        this._focus = { phase, workMin, breakMin, taskId, end: Date.now() + mins * 60000, };
        if (phase === 'focus') {
            this._focusDnd = true;
            if (taskId) this.startTaskTimer(taskId, true);
            if (!document.body.classList.contains('zen-mode') && this.toggleZenMode) this.toggleZenMode(true);
        }
        this.renderFocusPill();
        this._focusTimer = setInterval(() => this.tickFocus(), 1000);
        this.closeModals();
        return this._focus;
    };
    P.tickFocus = function (now = Date.now()) {
        const f = this._focus;
        if (!f) return;
        const pill = document.getElementById('focus-pill');
        if (pill) pill.querySelector('b').textContent = this.focusRemainingText();
        const big = document.getElementById('focus-remaining');
        if (big) big.textContent = this.focusRemainingText();
        if (now < f.end) return;
        if (f.phase === 'focus') {
            if (f.taskId) this.stopTaskTimer(f.taskId, true);
            this._focusDnd = false;
            this.notify('OX-Alpha', 'انتهت جلسة التركيز — حان وقت الاستراحة ☕');
            if (this.playCompletionAudioHaptic) this.playCompletionAudioHaptic();
            this.showBreakOverlay(f);
        } else {
            this.stopFocus(true);
            this.showToast('⏰ انتهت الاستراحة — جاهز لجلسة جديدة؟', 'info');
        }
    };
    P.showBreakOverlay = function (f) {
        const tips = ['قف وتمدد لمدة دقيقة 🧘', 'اشرب كوب ماء 💧', 'انظر لشيء بعيد 20 ثانية لإراحة عينيك 👀', 'امشِ قليلاً 🚶', 'خذ 5 أنفاس عميقة 🌬️'];
        clearInterval(this._focusTimer);
        this._focus = { ...f, phase: 'break', end: Date.now() + f.breakMin * 60000 };
        this._focusTimer = setInterval(() => this.tickFocus(), 1000);
        this.openPanel({
            title: 'وقت الاستراحة ☕', icon: 'fa-mug-hot',
            body: `<div class="focus-big" id="focus-remaining">${this.focusRemainingText()}</div><div class="focus-tip">${tips[Math.floor(Math.random() * tips.length)]}</div>`,
            footer: `<button class="sidebar-btn-util gh-btn" onclick="app.stopFocus()">إنهاء</button><span class="gh-spacer"></span><button class="btn-new-thread gh-btn" onclick="app.startFocus(${f.workMin}, ${f.breakMin}, ${f.taskId ? `'${f.taskId}'` : 'null'})"><i class="fa-solid fa-forward"></i> تخطي وابدأ جلسة جديدة</button>`
        });
        this.renderFocusPill();
    };
    P.stopFocus = function (silent) {
        clearInterval(this._focusTimer);
        const f = this._focus;
        if (f) {
            if (f.phase === 'focus') { this._focusDnd = false; if (f.taskId) this.stopTaskTimer(f.taskId, true); }
            this._focus = null;
            if (document.body.classList.contains('zen-mode') && this.toggleZenMode && !silent) this.toggleZenMode(false);
        }
        document.getElementById('focus-pill')?.remove();
        if (!silent) this.closeModals();
    };
    P.renderFocusPill = function () {
        let pill = document.getElementById('focus-pill');
        if (!this._focus) { pill?.remove(); return; }
        if (!pill) {
            pill = document.createElement('button');
            pill.id = 'focus-pill';
            pill.className = 'focus-pill';
            pill.onclick = () => this.openFocusTimer();
            document.body.appendChild(pill);
        }
        pill.classList.toggle('break', this._focus.phase === 'break');
        pill.innerHTML = `<i class="fa-solid ${this._focus.phase === 'break' ? 'fa-mug-hot' : 'fa-hourglass-half'}"></i> <b>${this.focusRemainingText()}</b>`;
    };

    // ------------------------------------------------------------------ PALETTE + INIT
    const _origPalette = P.buildPaletteCommands;
    if (_origPalette) {
        P.buildPaletteCommands = function () {
            const self = this, S = 'التعاون';
            return _origPalette.call(this).concat([
                { section: S, icon: 'fa-share-nodes', label: 'مشاركة المحادثة برابط', hint: 'Share chat', run: () => self.openSharePanel() },
                { section: S, icon: 'fa-box-open', label: 'نشر المشروع كقالب (Gist)', hint: 'Publish template', run: () => self.publishProjectTemplateUI() },
                { section: S, icon: 'fa-github', brand: true, label: 'مشاركة الملف الحالي كـ Gist', hint: 'Gist', run: () => self.shareFileAsGist() },
                { section: S, icon: 'fa-file-import', label: 'استيراد من Gist (محادثة أو قالب أو ملفات)', hint: 'Import Gist', run: () => self.importGistUI() },
                { section: S, icon: 'fa-list-check', label: 'المهام (Kanban)', hint: 'Tasks', run: () => self.openTasks() },
                { section: S, icon: 'fa-chalkboard', label: 'السبورة البيضاء', hint: 'Whiteboard', run: () => self.openWhiteboard() },
                { section: S, icon: 'fa-comments', label: 'تعليقات الكود', hint: 'Comments', run: () => self.openComments() },
                { section: S, icon: 'fa-comment-medical', label: 'تعليق على السطر الحالي', hint: 'Ctrl+Alt+M', run: () => self.addCommentAtCaret() },
                { section: S, icon: 'fa-clock-rotate-left', label: 'سجل النشاط', hint: 'Activity', run: () => self.openActivityLog() },
                { section: S, icon: 'fa-person-chalkboard', label: 'عرض تقديمي للمحادثة', hint: 'Present', run: () => self.openPresentation() },
                { section: S, icon: 'fa-hourglass-half', label: 'مؤقت التركيز (Pomodoro)', hint: 'Focus', run: () => self.openFocusTimer() },
                ...Object.entries(MODES).map(([id, m]) => ({ section: 'أوضاع المحادثة', icon: m.icon, label: `وضع: ${m.label}`, hint: id, run: () => self.setChatMode(id) }))
            ]);
        };
    }
    const _origRenderUI = P.renderUIState;
    P.renderUIState = function () { const r = _origRenderUI.apply(this, arguments); this.renderModeBadge(); return r; };

    P.initSprint5Collab = async function () {
        this.tasks = this.tasks || [];
        this.codeComments = this.codeComments || [];
        this.activityLog = this.activityLog || [];
        if (this.idbGet) {
            try {
                const [tasks, comments, log] = await Promise.all([this.idbGet('tasks_v1'), this.idbGet('code_comments_v1'), this.idbGet('activity_log_v1')]);
                if (Array.isArray(tasks)) this.tasks = tasks.concat(this.tasks.filter(t => !tasks.some(x => x.id === t.id)));
                if (Array.isArray(comments)) this.codeComments = comments.concat(this.codeComments.filter(c => !comments.some(x => x.id === c.id)));
                if (Array.isArray(log)) this.activityLog = log.concat(this.activityLog);
            } catch (e) {}
        }
        if (this.tasks.some(t => t.timerStart)) this.ensureTaskTicker();
        this.updateCommentBadge();
        this.renderModeBadge();
        this._reminderTimer = setInterval(() => this.checkTaskReminders(), 60000);
        setTimeout(() => this.checkTaskReminders(), 3000);
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.altKey && (e.key === 'm' || e.key === 'M')) { e.preventDefault(); this.addCommentAtCaret(); }
        });
        window.addEventListener('hashchange', () => this.handleShareHash());
        if (/^#(share|gist)=/.test(location.hash)) setTimeout(() => this.handleShareHash(), 50);
    };
    if (window.app) {
        try { window.app.initSprint5Collab(); } catch (e) { console.error('Sprint 5 collab init failed', e); }
    }
})();
