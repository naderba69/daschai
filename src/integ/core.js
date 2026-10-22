/* Integrations hub shell: tabs/sections, local config store, boot registry, HTTP + AI helpers. */
import { esc, call, empty, lsGet, lsSet } from '../dev/util.js';

export const TAB_DEFS = {
    ai: [['direct', 'مزودون مباشرون', 'ixDirect'], ['style', 'بصمة أسلوبك (LoRA)', 'ixStyle'], ['prompts', 'سوق البرومبتات', 'ixPrompts'], ['memory', 'ذاكرة المشاريع', 'ixMemory']],
    build: [['agent', 'الوكيل المستقل', 'ixAgent'], ['authgen', 'نظام مصادقة كامل', 'ixAuthGen'], ['rbac', 'الأدوار والصلاحيات', 'ixRbac'], ['voice', 'المبرمج الصوتي', 'ixVoice']],
    data: [['db', 'Supabase / Firebase / PlanetScale', 'ixDb'], ['algolia', 'Algolia', 'ixAlgolia'], ['cloudinary', 'Cloudinary', 'ixCloudinary']],
    services: [['payments', 'Stripe / PayPal', 'ixPayments'], ['authprov', 'Auth0 / Clerk', 'ixAuthProv'], ['email', 'SendGrid', 'ixEmail'], ['sms', 'Twilio', 'ixSms'], ['outbox', 'صندوق الصادر', 'ixOutbox']],
    observe: [['sentry', 'Sentry', 'ixSentry'], ['posthog', 'PostHog', 'ixPosthog']],
    work: [['issues', 'Jira / Linear / Trello', 'ixIssues'], ['hooks', 'Webhooks عند كل Push', 'ixHooks'], ['zapier', 'Zapier / Make', 'ixZapier']],
    design: [['figma', 'Figma → كود', 'ixFigma'], ['plugin', 'إضافة Figma', 'ixFigmaPlugin']],
    ext: [['api', 'REST API', 'ixApi'], ['vscode', 'إضافة VS Code', 'ixVscode'], ['chrome', 'إضافة Chrome', 'ixChrome'], ['cli', 'CLI', 'ixCli']],
    ui: [['lang', 'لغة الواجهة', 'ixLang'], ['rtl', 'الاتجاه RTL', 'ixRtl'], ['keyboard', 'لوحة المفاتيح', 'ixKeyboard'], ['modes', 'وضع الفيديو / النص', 'ixModes'], ['screens', 'المرآة / شاشتان', 'ixScreens']],
    widgets: [['table', 'جدول بيانات متقدم', 'ixTable'], ['carousel', 'الشرائح', 'ixCarousel'], ['dropdowns', 'القوائم المنسدلة', 'ixDropdowns'], ['progressive', 'التحميل التدريجي', 'ixProgressive'], ['lottie', 'أيقونات Lottie', 'ixLottie']],
    social: [['devs', 'صدارة المطورين', 'ixDevBoard'], ['points', 'لوحة النقاط', 'ixPoints']],
    space: [['ar', 'الكود في الفضاء (AR)', 'ixSpace']]
};

const CFG_KEY = 'ox_ix_v1', BOOT_KEY = 'ox_ix_boot_v1';

export function installCore(P) {
    P.openIntegHub = async function (tab = 'ai', sec, opts = {}) {
        if (!TAB_DEFS[tab]) tab = 'ai';
        this.openPanel({
            title: 'مركز التكاملات والمستقبل', icon: 'fa-plug-circle-bolt',
            tabs: (this.IX_TABS || []).map(t => ({ ...t, onclick: `app.openIntegHub('${t.id}')` })), activeTab: tab,
            body: '<div id="ixx-root" class="fmx-root dvx-root ixx-root"></div>'
        });
        return this.ixLoad(tab, sec, opts);
    };
    P.ixLoad = async function (tab, sec, opts = {}) {
        const defs = TAB_DEFS[tab] || TAB_DEFS.ai;
        const def = defs.find(d => d[0] === sec) || defs.find(d => d[0] === ((this._ixSec || {})[tab])) || defs[0];
        this._ixSec = { ...(this._ixSec || {}), [tab]: def[0] };
        this._ixx = { tab, sec: def[0], opts };
        if (this._ixStop) { try { this._ixStop(); } catch (e) { /* ignore */ } this._ixStop = null; }
        document.querySelectorAll('#ox-panel-tabs .gh-tab').forEach((b, i) => b.classList.toggle('active', ((this.IX_TABS || [])[i] || {}).id === tab));
        const root = document.getElementById('ixx-root');
        if (!root) { await this.openIntegHub(tab, def[0], opts); return document.getElementById('ixx-sec'); }
        root.innerHTML = `<div class="ghx-subnav fmx-subnav">${defs.map(([id, label]) => `<button class="gh-chip ${id === def[0] ? 'active' : ''}" data-ix-sec="${id}" onclick="${call('ixLoad', tab, id)}">${label}</button>`).join('')}</div>
            <div id="ixx-sec" class="fmx-sec" data-ix-tab="${tab}" data-ix-sec="${def[0]}"><div class="gh-empty"><span class="live-step-spinner"></span></div></div>`;
        this.setPanelFooter('');
        if (this.pfTrack) this.pfTrack('integ:' + tab + '/' + def[0]);
        let html;
        try { html = await this[def[2]](opts); } catch (e) { console.error(e); html = empty('❌ ' + esc(e.message || e), true); }
        const el = document.getElementById('ixx-sec');
        if (el && el.dataset.ixSec === def[0] && el.dataset.ixTab === tab && html != null) {
            el.innerHTML = html;
            const m = this._ixMount; this._ixMount = null;
            if (typeof m === 'function') try { await m(); } catch (e) { console.error(e); }
        }
        return el;
    };
    P.ixRefresh = function () { const c = this._ixx; return c ? this.ixLoad(c.tab, c.sec, c.opts) : this.openIntegHub(); };
    P.ixBusy = function (id, msg) { const el = document.getElementById(id); if (el) el.innerHTML = `<div class="gh-empty"><span class="live-step-spinner"></span> ${msg || ''}</div>`; };
    P.ixErr = function (e, id) {
        const msg = (e && e.message) || String(e);
        if (id) { const el = document.getElementById(id); if (el) el.innerHTML = empty('❌ ' + esc(msg), true); }
        this.showToast('❌ ' + this.escapeHTML(msg), 'error');
        return null;
    };
    P.ixOut = function (id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; return el; };

    // ---------------------------------------------------------------- local config (keys never leave the device / never synced)
    P.ixCfg = function (ns) { const all = lsGet(CFG_KEY, {}) || {}; return ns ? (all[ns] || {}) : all; };
    P.ixSave = function (ns, patch) {
        const all = lsGet(CFG_KEY, {}) || {};
        all[ns] = patch == null ? undefined : { ...(all[ns] || {}), ...patch };
        if (patch == null) delete all[ns];
        lsSet(CFG_KEY, all);
        return all[ns] || null;
    };
    /** Read form fields into the namespace: ixSaveForm('sentry', {dsn: 'ix-sentry-dsn'}) */
    P.ixSaveForm = function (ns, map, { toast = true } = {}) {
        const patch = {};
        Object.entries(map).forEach(([k, id]) => { const el = document.getElementById(id); if (el) patch[k] = el.type === 'checkbox' ? el.checked : String(el.value || '').trim(); });
        this.ixSave(ns, patch);
        if (toast) this.showToast('✅ حُفظ محلياً', 'success');
        return patch;
    };

    // ---------------------------------------------------------------- boot registry (features that must run from startup)
    P._ixBootFns = P._ixBootFns || {};
    P.ixBootList = () => lsGet(BOOT_KEY, []) || [];
    P.ixBootSet = function (id, on) {
        const s = new Set(this.ixBootList());
        if (on) s.add(id); else s.delete(id);
        lsSet(BOOT_KEY, [...s]);
        return on;
    };
    P.ixBoot = async function () {
        if (this._ixBooted) return this._ixBooted;
        const done = [];
        for (const id of this.ixBootList()) {
            const fn = this._ixBootFns[id];
            if (!fn) continue;
            try { await fn.call(this); done.push(id); } catch (e) { console.warn('[OX] integ boot', id, e); }
        }
        this._ixBooted = done;
        return done;
    };

    // ---------------------------------------------------------------- HTTP helper (JSON in/out, readable errors)
    P.ixHttp = async function (url, { method = 'GET', headers = {}, body, form, raw = false } = {}) {
        const h = { ...headers };
        let b = body;
        if (form) { b = new URLSearchParams(form).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; }
        else if (body != null && typeof body !== 'string' && !(typeof FormData !== 'undefined' && body instanceof FormData) && !(typeof Blob !== 'undefined' && body instanceof Blob)) { b = JSON.stringify(body); h['Content-Type'] = h['Content-Type'] || 'application/json'; }
        let res;
        try { res = await fetch(url, { method, headers: h, body: b }); } catch (e) { throw new Error('تعذر الاتصال بـ ' + (/^https?:\/\/([^/]+)/.exec(url) || [])[1] + ' — تحقق من الشبكة أو سياسة CORS للخدمة'); }
        if (raw) return res;
        const text = await res.text();
        let data = text;
        try { data = text ? JSON.parse(text) : null; } catch (e) { /* text */ }
        if (!res.ok) {
            const m = data && typeof data === 'object' ? (data.message || data.error_description || (data.error && (data.error.message || data.error)) || data.msg || (data.errors && data.errors[0] && (data.errors[0].message || data.errors[0].detail))) : String(text).slice(0, 200);
            const e = new Error(`HTTP ${res.status}: ${typeof m === 'string' ? m : JSON.stringify(m)}`);
            e.status = res.status; e.data = data;
            throw e;
        }
        return data;
    };
    P.ixAI = async function (prompt, { json = false, system, maxTokens = 3000, quiet = false, images } = {}) {
        if (!String(this.settings.apiKey || '').trim()) { if (!quiet) this.showToast('يلزم مفتاح OpenRouter (أو مزود مباشر) في الإعدادات لهذه الميزة الذكية', 'warning'); return null; }
        if ((!this.aiRun || this.aiRun.__oxLazy) && this.loadChunk) { try { await this.loadChunk('ai'); } catch (e) { /* offline */ } }
        if (!this.aiRun) return null;
        const opts = { system: system || 'You are OX-AI, a senior full-stack engineer. Answer in Arabic unless code is requested. Be concise and practical.', maxTokens, kind: 'code', source: 'integ', quiet: true, images };
        try { return json ? await this.aiJSON(prompt, opts) : await this.aiRun(prompt, opts); } catch (e) { if (!quiet) this.showToast('❌ ' + this.escapeHTML(e.message || String(e)), 'error'); return null; }
    };
    /** Write generated files into the project as one undoable batch (reuses the Developer Lab batch log when loaded). */
    P.ixWriteFiles = function (label, files, { open = true } = {}) {
        const list = Object.entries(files).filter(([, c]) => typeof c === 'string');
        list.forEach(([p, c]) => this.writeProjectFile(p, c, 'generate'));
        if (this.scheduleProjectSave) this.scheduleProjectSave();
        if (this.isCodeStudioOpen && this.renderStudioWorkspace) try { this.renderStudioWorkspace(); } catch (e) { /* ignore */ }
        if (open && list.length && this.isCodeStudioOpen && this.switchStudioFile) try { this.switchStudioFile(list[0][0]); } catch (e) { /* ignore */ }
        this.showToast(`✅ ${label}: ${list.length} ملف`, 'success');
        return list.map(([p]) => p);
    };
    P.ixFiles = function (filter) {
        const out = [];
        for (const [p, f] of this.virtualProjectFiles) if (f && typeof f.content === 'string' && !f.dataUrl && !f.binary && (!filter || filter(p))) out.push([p, f.content]);
        return out.sort((a, b) => a[0].localeCompare(b[0]));
    };
}
