/* #340 20 UI languages • #339 full RTL • #358 external keyboards • #407 video mode • #409 text mode • #352 mirror • #353 dual screen */
import { esc, call, btn, pbtn, card, empty, field, select, table, toggle, pre, stats } from './util.js';

// ====================================================================== #340 languages
export const LANGS = [['ar', 'العربية', 'rtl'], ['en', 'English', 'ltr'], ['fr', 'Français', 'ltr'], ['es', 'Español', 'ltr'], ['de', 'Deutsch', 'ltr'], ['it', 'Italiano', 'ltr'], ['pt', 'Português', 'ltr'], ['tr', 'Türkçe', 'ltr'], ['ru', 'Русский', 'ltr'], ['zh', '中文', 'ltr'],
    ['ja', '日本語', 'ltr'], ['ko', '한국어', 'ltr'], ['hi', 'हिन्दी', 'ltr'], ['ur', 'اردو', 'rtl'], ['fa', 'فارسی', 'rtl'], ['he', 'עברית', 'rtl'], ['id', 'Bahasa Indonesia', 'ltr'], ['ms', 'Bahasa Melayu', 'ltr'], ['nl', 'Nederlands', 'ltr'], ['sw', 'Kiswahili', 'ltr']];
/** Built-in English pack for the shell's most visible strings (other languages: AI-translated once, cached). */
export const I18N_EN = {
    'إغلاق': 'Close', 'تحديث': 'Refresh', 'محادثة جديدة': 'New chat', 'الإعدادات': 'Settings', 'الملفات': 'Files', 'جاهز': 'Ready', 'لوحة الأوامر': 'Command palette', 'المشاريع': 'Projects', 'تصدير ZIP': 'Export ZIP', 'النماذج': 'Models',
    'حلبة النماذج': 'Model arena', 'استوديو الكود': 'Code studio', 'الاستهلاك': 'Usage', 'بحث الكود': 'Code search', 'الفحص': 'Diagnostics', 'المهام': 'Tasks', 'السبورة': 'Whiteboard', 'مشاركة': 'Share', 'التقارير': 'Reports', 'المنصة': 'Platform',
    'المرفقات': 'Attachments', 'السجل': 'History', 'تشغيل': 'Run', 'ربط': 'Connect', 'إيقاف': 'Stop', 'تصدير CSV': 'Export CSV', 'مسح السجل': 'Clear log', 'اقتراح': 'Suggest', 'إلغاء': 'Cancel', 'حفظ التعديلات': 'Save changes',
    'حفظ': 'Save', 'إرسال': 'Send', 'بحث': 'Search', 'نسخ': 'Copy', 'حذف': 'Delete', 'تعديل': 'Edit', 'فتح': 'Open', 'تنزيل': 'Download', 'رفع': 'Upload', 'إضافة': 'Add', 'الكل': 'All', 'نماذج': 'Models', 'تنقل': 'Navigate', 'تنفيذ': 'Execute',
    'البحث الحي': 'Live search', 'الصوت والمفاتيح': 'Voice & keys', 'النموذج الافتراضي': 'Default model', 'إعدادات النظام والمفاتيح': 'System settings & keys', 'بحث في المحادثات...': 'Search chats...', 'بحث في المحادثات': 'Search chats', 'إنشاء محادثة جديدة': 'Create a new chat',
    'إغلاق القائمة': 'Close menu', 'القائمة الجانبية': 'Sidebar', 'فتح/إغلاق القائمة الجانبية': 'Toggle sidebar', 'انقر لتغيير النموذج': 'Click to change model', 'تبديل المظهر': 'Toggle theme', 'تبديل المظهر (فاتح/داكن)': 'Toggle theme (light/dark)', 'لوحة الأوامر (Ctrl+K)': 'Command palette (Ctrl+K)',
    'المحادثات المفتوحة': 'Open chats', 'حقل إدخال الرسالة': 'Message input', 'وضع المحادثة': 'Chat mode', 'إملاء صوتي': 'Voice dictation', 'إيقاف التوليد': 'Stop generating', 'مستكشف الملفات': 'File explorer', 'مستكشف الملفات (Ctrl+B)': 'File explorer (Ctrl+B)',
    'إغلاق استوديو الكود': 'Close code studio', 'إغلاق استوديو الأكواد': 'Close code studio', 'مستكشف ملفات المشروع': 'Project file explorer', 'سجل إصدارات الملف': 'File version history', 'قائمة الوسائط': 'Media menu', 'الأدوات والميزات المتقدمة': 'Tools & advanced features',
    'فحص الأنظمة وتشخيص الأخطاء': 'System check & diagnostics', 'بدء الفحص الشامل': 'Run full check', 'لم يفحص بعد': 'Not checked yet', 'مطور شامل': 'Full-stack developer', 'التمرير لآخر الرد': 'Scroll to latest reply', 'أفلت الملفات أو المجلدات هنا': 'Drop files or folders here',
    'مفتاح OpenRouter API Key': 'OpenRouter API key', 'معرف النموذج المخصص': 'Custom model id', 'سلوك زر Enter': 'Enter key behavior', 'فتح في الاستوديو': 'Open in studio', 'مراجعة AI': 'AI review', 'جنباً إلى جنب': 'Side by side', 'بدء المقارنة': 'Start comparison',
    'مركز التكاملات والمستقبل': 'Integrations & future hub', 'الذكاء': 'AI', 'البناء الذكي': 'Smart build', 'البيانات': 'Data', 'الخدمات': 'Services', 'المراقبة': 'Monitoring', 'سير العمل': 'Workflow', 'التصميم': 'Design', 'الإضافات و API': 'Extensions & API', 'الواجهة': 'Interface',
    'المكونات': 'Components', 'الصدارة': 'Leaderboard', 'الكود في الفضاء': 'Code in space', 'لغة الواجهة': 'UI language'
};
const SKIP = '.message-content, .markdown-body, .cm-editor, pre, code, textarea, script, style, [contenteditable="true"], [data-no-i18n], .ix-lang-list';
const AR = /[\u0600-\u06FF]/;
/** Translate text nodes + title/placeholder/aria-label under root. originals: WeakMap node→{text, attrs}. → {done, missing:Set} */
export function applyI18n(root, dict, originals) {
    const missing = new Set();
    let done = 0;
    if (!root) return { done, missing };
    const tr = (s) => { const k = s.trim(); if (!k || !AR.test(k)) return null; const v = dict[k]; if (v == null) { if (k.length < 120) missing.add(k); return null; } return s.replace(k, () => v); };
    const doc = root.ownerDocument || root;
    const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    nodes.forEach(n => {
        const el = n.parentElement;
        if (!el || el.closest(SKIP)) return;
        const orig = originals.get(n);
        const base = orig ? orig.text : n.nodeValue;
        const v = tr(base);
        if (v != null) { if (!orig) originals.set(n, { text: n.nodeValue }); if (n.nodeValue !== v) { n.nodeValue = v; done++; } }
    });
    const els = root.querySelectorAll ? root.querySelectorAll('[title], [placeholder], [aria-label]') : [];
    els.forEach(el => {
        if (el.closest(SKIP) && !el.matches('textarea, input')) return;
        let o = originals.get(el);
        ['title', 'placeholder', 'aria-label'].forEach(a => {
            const cur = el.getAttribute(a);
            if (cur == null) return;
            const base = (o && o.attrs && o.attrs[a] != null) ? o.attrs[a] : cur;
            const v = tr(base);
            if (v != null) { if (!o) { o = { attrs: {} }; originals.set(el, o); } o.attrs = o.attrs || {}; if (o.attrs[a] == null) o.attrs[a] = base; if (cur !== v) { el.setAttribute(a, v); done++; } }
        });
    });
    return { done, missing };
}
/** Undo applyI18n for every node under root. */
export function revertI18n(root, originals) {
    let n = 0;
    const doc = root.ownerDocument || root;
    const walker = doc.createTreeWalker(root, 4);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) { const o = originals.get(t); if (o && o.text != null) { t.nodeValue = o.text; originals.delete(t); n++; } }
    (root.querySelectorAll ? root.querySelectorAll('[title], [placeholder], [aria-label]') : []).forEach(el => { const o = originals.get(el); if (o && o.attrs) { Object.entries(o.attrs).forEach(([a, v]) => el.setAttribute(a, v)); originals.delete(el); n++; } });
    return n;
}

// ====================================================================== #339 RTL audit
const PHYS = [
    [/\bmargin-left\s*:/g, 'margin-inline-start:'], [/\bmargin-right\s*:/g, 'margin-inline-end:'], [/\bpadding-left\s*:/g, 'padding-inline-start:'], [/\bpadding-right\s*:/g, 'padding-inline-end:'],
    [/\bborder-left(?=[\s:-])/g, 'border-inline-start'], [/\bborder-right(?=[\s:-])/g, 'border-inline-end'],
    [/\bborder-top-left-radius\s*:/g, 'border-start-start-radius:'], [/\bborder-top-right-radius\s*:/g, 'border-start-end-radius:'], [/\bborder-bottom-left-radius\s*:/g, 'border-end-start-radius:'], [/\bborder-bottom-right-radius\s*:/g, 'border-end-end-radius:'],
    [/(^|[;{\s])left\s*:/g, '$1inset-inline-start:'], [/(^|[;{\s])right\s*:/g, '$1inset-inline-end:'],
    [/\btext-align\s*:\s*left\b/g, 'text-align: start'], [/\btext-align\s*:\s*right\b/g, 'text-align: end'], [/\bfloat\s*:\s*left\b/g, 'float: inline-start'], [/\bfloat\s*:\s*right\b/g, 'float: inline-end']
];
/** Physical (LTR-only) declarations → [{line, prop, fix}] */
export function rtlAudit(css) {
    const out = [];
    String(css).split('\n').forEach((l, i) => {
        if (/^\s*(\/\*|\*)/.test(l)) return;
        PHYS.forEach(([re, fix]) => { re.lastIndex = 0; const m = re.exec(l); if (m) out.push({ line: i + 1, prop: m[0].replace(/^[;{\s]+/, '').replace(/\s*:$/, ''), fix: fix.replace('$1', '').replace(/:$/, '') }); });
    });
    return out;
}
/** Rewrite to logical properties (direction-agnostic CSS). */
export function toLogical(css) { let s = String(css); PHYS.forEach(([re, fix]) => { re.lastIndex = 0; s = s.replace(re, fix); }); return s; }
/** HTML with Arabic text but no dir/lang → fixed HTML (or null). */
export function htmlDirFix(html) {
    const s = String(html);
    if (!AR.test(s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ''))) return null;
    const m = /<html\b([^>]*)>/i.exec(s);
    if (!m) return null;
    let attrs = m[1];
    if (/\bdir\s*=/.test(attrs) && /\blang\s*=/.test(attrs)) return null;
    if (!/\bdir\s*=/.test(attrs)) attrs += ' dir="rtl"';
    if (!/\blang\s*=/.test(attrs)) attrs += ' lang="ar"';
    return s.replace(m[0], '<html' + attrs + '>');
}

// ====================================================================== #358 keyboard: layout-independent shortcuts
/** Arabic/other layout key → latin by physical code (KeyX → x, Digit3 → 3). */
export function latinKey(e) {
    if (!e || !e.key || e.key.length !== 1 || /^[\x20-\x7e]$/.test(e.key)) return null;
    const m = /^Key([A-Z])$|^Digit(\d)$/.exec(e.code || '');
    if (!m) return null;
    return m[1] ? (e.shiftKey ? m[1] : m[1].toLowerCase()) : m[2];
}

export function installUI(P) {
    // ---------------------------------------------------------------- #340 language
    const PACK_KEY = 'ox_ix_i18n_v1';
    const packs = () => { try { return JSON.parse(localStorage.getItem(PACK_KEY)) || {}; } catch (e) { return {}; } };
    P.ixLangDict = function (code) { return { ...(code === 'en' ? I18N_EN : {}), ...(packs()[code] || {}) }; };
    P.ixSetLang = async function (code, { save = true } = {}) {
        const L = LANGS.find(l => l[0] === code) || LANGS[0];
        code = L[0];
        this._ixOrig = this._ixOrig || new WeakMap();
        const html = document.documentElement;
        const dirMode = this.ixCfg('ui').dir || 'auto';
        html.lang = code;
        html.dir = dirMode === 'auto' ? L[2] : dirMode;
        if (this._ixLangObs) { this._ixLangObs.disconnect(); this._ixLangObs = null; }
        revertI18n(document.body, this._ixOrig);   // untranslated strings of the previous language fall back to Arabic
        if (code === 'ar') this._ixMissing = new Set();
        else {
            const dict = this.ixLangDict(code);
            const r = applyI18n(document.body, dict, this._ixOrig);
            this._ixMissing = r.missing;
            let pending = false;
            this._ixLangObs = new MutationObserver(() => {
                if (pending) return;
                pending = true;
                (window.requestAnimationFrame || setTimeout)(() => { pending = false; const x = applyI18n(document.body, dict, this._ixOrig); x.missing.forEach(k => this._ixMissing.add(k)); });
            });
            this._ixLangObs.observe(document.body, { childList: true, subtree: true, characterData: false });
        }
        if (save) { this.ixSave('ui', { lang: code }); this.ixBootSet('lang', code !== 'ar' || dirMode !== 'auto'); }
        return { lang: code, dir: html.dir, missing: (this._ixMissing || new Set()).size };
    };
    P._ixBootFns.lang = function () { const c = this.ixCfg('ui'); return this.ixSetLang(c.lang || 'ar', { save: false }); };
    P.ixLangAI = async function (code) {
        code = code || this.ixCfg('ui').lang;
        if (!code || code === 'ar') { this.showToast('اختر لغة غير العربية أولاً', 'info'); return 0; }
        const missing = [...(this._ixMissing || [])].filter(k => !(k in this.ixLangDict(code)));
        if (!missing.length) { this.showToast('✅ كل نصوص الواجهة الظاهرة مترجمة', 'success'); return 0; }
        const name = (LANGS.find(l => l[0] === code) || [])[1];
        let added = 0;
        for (let i = 0; i < missing.length; i += 120) {
            this.ixBusy('ix-lang-res', `ترجمة ${Math.min(i + 120, missing.length)}/${missing.length} إلى ${esc(name)}…`);
            const j = await this.ixAI(`Translate these Arabic UI strings of a developer IDE into ${name} (${code}). Keep emojis, symbols, shortcuts (Ctrl+K), product names (GitHub, OpenRouter, ZIP) and placeholders unchanged. Short, natural UI wording.\nReturn JSON {"t": {"<arabic>": "<translation>"}}\n${JSON.stringify(missing.slice(i, i + 120))}`, { json: true, maxTokens: 6000 });
            if (!j || !j.t) break;
            const all = packs();
            all[code] = { ...(all[code] || {}), ...Object.fromEntries(Object.entries(j.t).filter(([k, v]) => typeof v === 'string' && v.trim())) };
            localStorage.setItem(PACK_KEY, JSON.stringify(all));
            added += Object.keys(j.t).length;
        }
        await this.ixSetLang(code);
        this.ixOut('ix-lang-res', empty(`✅ أُضيفت ${added} ترجمة`));
        return added;
    };
    P.ixLangExport = function () { const code = this.ixCfg('ui').lang || 'en'; this.downloadBlob(new Blob([JSON.stringify(this.ixLangDict(code), null, 2)], { type: 'application/json' }), `ox-alpha-${code}.json`); };
    P.ixLangImport = function (code, json) {
        const d = typeof json === 'string' ? JSON.parse(json) : json;
        const all = packs(); all[code] = { ...(all[code] || {}), ...d }; localStorage.setItem(PACK_KEY, JSON.stringify(all));
        return Object.keys(d).length;
    };
    P.ixLang = async function () {
        const c = this.ixCfg('ui'), cur = c.lang || 'ar', all = packs();
        return card('لغة الواجهة: 20 لغة', `<p class="hv-dim">الإنجليزية مضمّنة لأهم النصوص. أما بقية اللغات فتُترجم نصوصها الظاهرة بالذكاء مرة واحدة وتُحفظ على جهازك، ومع كل قسم جديد تفتحه تُجمع نصوصه لتترجمها بنقرة. محتوى المحادثات والكود لا يُترجم. الاتجاه (RTL أو LTR) يتبع اللغة تلقائياً.</p>
            <div class="ix-lang-list">${LANGS.map(([k, n, d]) => `<button class="gh-chip ${k === cur ? 'active' : ''}" data-lang="${k}" onclick="app.ixSetLang('${k}').then(()=>app.ixRefresh())"><b>${esc(n)}</b> <small>${k}${d === 'rtl' ? ' ⇠' : ''}${(all[k] || (k === 'en' ? I18N_EN : null)) ? ' ✓' : ''}</small></button>`).join('')}</div>
            ${stats([['اللغة', cur], ['مترجم', Object.keys(this.ixLangDict(cur)).length], ['ينقصه (ظاهر)', cur === 'ar' ? 0 : (this._ixMissing || new Set()).size]])}
            <div class="gh-row">${pbtn('fa-language', 'ترجمة الناقص بالذكاء', 'app.ixLangAI()')}${btn('fa-download', 'تصدير حزمة اللغة', 'app.ixLangExport()')}${btn('fa-rotate-left', 'العربية', "app.ixSetLang('ar').then(()=>app.ixRefresh())")}</div><div id="ix-lang-res"></div>`, 'fa-language');
    };

    // ---------------------------------------------------------------- #339 RTL
    P.ixSetDir = function (mode) {
        this.ixSave('ui', { dir: mode });
        const L = LANGS.find(l => l[0] === (this.ixCfg('ui').lang || 'ar')) || LANGS[0];
        document.documentElement.dir = mode === 'auto' ? L[2] : mode;
        this.ixBootSet('lang', (this.ixCfg('ui').lang || 'ar') !== 'ar' || mode !== 'auto');
        return document.documentElement.dir;
    };
    P.ixRtlScan = function () {
        const css = this.ixFiles(p => /\.(css|scss|less)$/i.test(p)).map(([p, t]) => ({ path: p, issues: rtlAudit(t) })).filter(x => x.issues.length);
        const html = this.ixFiles(p => /\.html?$/i.test(p)).filter(([, t]) => htmlDirFix(t)).map(([p]) => p);
        this._ixRtl = { css, html };
        const total = css.reduce((n, x) => n + x.issues.length, 0);
        this.ixOut('ix-rtl-res', (total || html.length) ? `${stats([['خصائص فيزيائية', total], ['ملفات CSS', css.length], ['HTML بلا dir', html.length]])}
            ${css.slice(0, 8).map(x => `<details class="fmx-card"><summary dir="ltr">${esc(x.path)} (${x.issues.length})</summary>${table(['السطر', 'الحالي', 'المنطقي'], x.issues.slice(0, 40).map(i => [`<a href="#" onclick="${call('openFileAt', x.path, i.line, 1)};return false">${i.line}</a>`, `<code>${esc(i.prop)}</code>`, `<code>${esc(i.fix)}</code>`]))}</details>`).join('')}
            ${html.length ? empty('HTML يحتوي عربية بدون dir/lang: ' + html.map(esc).join('، ')) : ''}<div class="gh-row">${pbtn('fa-wand-magic-sparkles', 'تحويل الكل لخصائص منطقية', 'app.ixRtlFix()')}</div>` : empty('✅ المشروع جاهز للاتجاهين (لا خصائص فيزيائية)'));
        return this._ixRtl;
    };
    P.ixRtlFix = function () {
        const r = this._ixRtl || this.ixRtlScan();
        r.css.forEach(x => { const f = this.virtualProjectFiles.get(x.path); if (f) this.writeProjectFile(x.path, toLogical(f.content), 'rtl'); });
        r.html.forEach(p => { const f = this.virtualProjectFiles.get(p); const fixed = f && htmlDirFix(f.content); if (fixed) this.writeProjectFile(p, fixed, 'rtl'); });
        this.showToast(`✅ حُوّل ${r.css.length} ملف CSS و${r.html.length} ملف HTML — يعمل الآن بالاتجاهين`, 'success');
        return this.ixRtlScan();
    };
    P.ixRtlIcons = function (on) { document.body.classList.toggle('ox-rtl-flip', !!on); this.ixSave('ui', { flipIcons: !!on }); return on; };
    P.ixRtl = async function () {
        const c = this.ixCfg('ui');
        return card('اتجاه الواجهة', `<div class="gh-row">${['auto', 'rtl', 'ltr'].map(m => `<button class="gh-chip ${(c.dir || 'auto') === m ? 'active' : ''}" onclick="app.ixSetDir('${m}');app.ixRefresh()">${{ auto: 'تلقائي حسب اللغة', rtl: 'من اليمين (RTL)', ltr: 'من اليسار (LTR)' }[m]}</button>`).join('')}</div>
            <div class="gh-row">${toggle('ix-rtl-flip', 'قلب الأيقونات الاتجاهية (الأسهم) في RTL', !!c.flipIcons, 'onchange="app.ixRtlIcons(this.checked)"')}</div>`, 'fa-arrow-right-arrow-left')
            + card('مدقق RTL لمشروعك', `<p class="hv-dim">يبحث عن الخصائص الفيزيائية مثل <code>margin-left</code> و<code>left</code> و<code>text-align: right</code> التي تنكسر عند قلب الاتجاه، ويحولها إلى خصائص منطقية (<code>margin-inline-start</code>…) تعمل في العربية والإنجليزية دون CSS مكرر. كما يضيف <code>dir="rtl" lang="ar"</code> لصفحات HTML العربية.</p>
            <div class="gh-row">${pbtn('fa-magnifying-glass', 'افحص المشروع', 'app.ixRtlScan()')}</div><div id="ix-rtl-res"></div>`, 'fa-spell-check');
    };

    // ---------------------------------------------------------------- #358 external keyboard
    P.ixKbdInstall = function () {
        if (this._ixKbdOn) return false;
        this._ixKbdOn = true;
        window.addEventListener('keydown', (e) => {
            const c = this.ixCfg('keyboard');
            if (c.layout !== false && (e.altKey || e.ctrlKey || e.metaKey) && !e.__oxRemap) {
                const k = latinKey(e);
                if (k) {
                    e.preventDefault(); e.stopImmediatePropagation();
                    const ev = new KeyboardEvent('keydown', { key: k, code: e.code, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, bubbles: true, cancelable: true });
                    Object.defineProperty(ev, '__oxRemap', { value: true });
                    (e.target || window).dispatchEvent(ev);
                    return;
                }
            }
            if (e.key === 'Tab') document.body.classList.add('ox-kbd-nav');
            if (!document.body.classList.contains('ox-hw-kbd') && e.key && e.key !== 'Unidentified' && e.key !== 'Process' && (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) {
                const vv = window.visualViewport;
                if (!vv || vv.height > window.innerHeight * 0.85) { document.body.classList.add('ox-hw-kbd'); if (c.toast !== false) this.showToast('⌨️ لوحة مفاتيح خارجية — اضغط ? لعرض الاختصارات', 'info'); }
            }
            if (c.help !== false && e.key === '?' && document.body.classList.contains('ox-hw-kbd') && !e.ctrlKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') && !(e.target && e.target.isContentEditable) && !(e.target && e.target.closest && e.target.closest('.cm-editor'))) { e.preventDefault(); e.stopImmediatePropagation(); this.ixKbdHelp(); }
        }, true);
        window.addEventListener('pointerdown', () => document.body.classList.remove('ox-kbd-nav'), true);
        return true;
    };
    P._ixBootFns.keyboard = function () { this.ixKbdInstall(); };
    P.ixKbdHelp = function () {
        const list = (this.BUILTIN_SHORTCUTS || []).concat((this.settings.customShortcuts || []).map(s => [s.keys || s.combo || '', s.label || s.action || '']));
        this.openPanel({ title: 'اختصارات لوحة المفاتيح', icon: 'fa-keyboard', body: `<div class="fmx-root"><p class="hv-dim">تعمل الاختصارات مع أي تخطيط للوحة المفاتيح، بما فيه العربي: Alt+X هو نفسه Alt+ء.</p>${table(['الاختصار', 'الوظيفة'], list.map(([k, d]) => [`<kbd dir="ltr">${esc(k)}</kbd>`, esc(d)]))}</div>` });
        return list.length;
    };
    P.ixKbdSave = function () {
        const c = this.ixSaveForm('keyboard', { layout: 'ix-kb-layout', help: 'ix-kb-help', toast: 'ix-kb-toast' }, { toast: false });
        this.ixBootSet('keyboard', true);
        this.ixKbdInstall();
        return c;
    };
    P.ixKbdTest = function (e) {
        const k = latinKey(e);
        this.ixOut('ix-kb-test', table(['key', 'code', 'المعدِّلات', 'بعد التوحيد'], [[`<kbd>${esc(e.key)}</kbd>`, `<code>${esc(e.code)}</code>`, esc(['Ctrl', 'Alt', 'Shift', 'Meta'].filter(m => e[m.toLowerCase() + 'Key']).join('+') || '—'), k ? `<kbd>${esc(k)}</kbd>` : '—']]));
    };
    P.ixKeyboard = async function () {
        const c = this.ixCfg('keyboard');
        return card('لوحة المفاتيح الخارجية', `<p class="hv-dim">مع لوحة مفاتيح Bluetooth على الجوال أو الجهاز اللوحي: يُكتشف وجودها تلقائياً وتعمل كل الاختصارات، وتظهر حلقات تركيز واضحة عند التنقل بـ Tab، ويعرض <kbd>?</kbd> قائمة الاختصارات. والأهم أن الاختصارات تعمل مع التخطيط العربي (يُعتمد الموقع الفعلي للمفتاح).</p>
            <div class="dvx-flags">${toggle('ix-kb-layout', 'اختصارات مستقلة عن التخطيط (عربي، فرنسي…)', c.layout !== false)}${toggle('ix-kb-help', '? يعرض الاختصارات', c.help !== false)}${toggle('ix-kb-toast', 'تنبيه عند اكتشاف لوحة خارجية', c.toast !== false)}</div>
            <div class="gh-row">${pbtn('fa-floppy-disk', 'حفظ وتفعيل', 'app.ixKbdSave()')}${btn('fa-keyboard', 'عرض الاختصارات', 'app.ixKbdHelp()')}</div>
            ${field('ix-kb-input', 'جرّب: اضغط أي اختصار هنا', '', 'onkeydown="app.ixKbdTest(event)" autocomplete="off"')}<div id="ix-kb-test"></div>`, 'fa-keyboard');
    };

    // ---------------------------------------------------------------- #409 text mode / #407 video mode
    P.ixTextMode = function (on) {
        on = on == null ? !document.body.classList.contains('ox-text-mode') : !!on;
        document.body.classList.toggle('ox-text-mode', on);
        this.ixSave('ui', { textMode: on });
        this.ixBootSet('textmode', on);
        return on;
    };
    P._ixBootFns.textmode = function () { if (this.ixCfg('ui').textMode) document.body.classList.add('ox-text-mode'); };
    P.ixVideoMode = async function (on, opts = {}) {
        on = on == null ? !this._ixVideo : !!on;
        const v = this._ixVideo;
        if (!on) {
            if (v) { (v.stream && v.stream.getTracks() || []).forEach(t => t.stop()); if (v.rec && v.rec.state !== 'inactive') v.rec.stop(); if (v.el) v.el.remove(); if (v.keys) v.keys.remove(); window.removeEventListener('keydown', v.onKey, true); }
            document.body.classList.remove('ox-video-mode');
            this._ixVideo = null;
            return false;
        }
        if (v) return true;
        document.body.classList.add('ox-video-mode');
        const st = this._ixVideo = { };
        if (opts.camera !== false && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
                st.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 480, facingMode: 'user' }, audio: false });
                const el = st.el = document.createElement('div');
                el.className = 'ix-cam';
                el.innerHTML = '<video autoplay muted playsinline></video><button class="ix-cam-x" title="إغلاق">×</button>';
                el.querySelector('video').srcObject = st.stream;
                el.querySelector('.ix-cam-x').onclick = () => this.ixVideoMode(false);
                let drag = null;
                el.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; drag = { x: e.clientX - el.offsetLeft, y: e.clientY - el.offsetTop }; el.setPointerCapture(e.pointerId); });
                el.addEventListener('pointermove', (e) => { if (drag) { el.style.left = (e.clientX - drag.x) + 'px'; el.style.top = (e.clientY - drag.y) + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto'; } });
                el.addEventListener('pointerup', () => { drag = null; });
                el.addEventListener('dblclick', () => el.classList.toggle('ix-cam-big'));
                document.body.appendChild(el);
            } catch (e) { this.showToast('تعذر تشغيل الكاميرا: ' + this.escapeHTML(e.message), 'warning'); }
        }
        const keys = st.keys = document.createElement('div');
        keys.className = 'ix-keys';
        document.body.appendChild(keys);
        st.onKey = (e) => {
            if (!(e.ctrlKey || e.altKey || e.metaKey) && !/^(Enter|Escape|Tab|F\d+)$/.test(e.key)) return;
            const k = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && '⌘', /^(Control|Alt|Shift|Meta)$/.test(e.key) ? '' : (e.key.length === 1 ? e.key.toUpperCase() : e.key)].filter(Boolean).join(' + ');
            if (!k) return;
            const b = document.createElement('kbd'); b.textContent = k; keys.appendChild(b);
            setTimeout(() => b.remove(), 1800);
            while (keys.children.length > 4) keys.firstChild.remove();
        };
        window.addEventListener('keydown', st.onKey, true);
        this.showToast('🎬 وضع الفيديو: كاميرا عائمة (اسحبها، انقر مرتين للتكبير) + عرض الاختصارات + خط أكبر', 'success');
        return true;
    };
    P.ixRecord = async function () {
        const v = this._ixVideo || (await this.ixVideoMode(true), this._ixVideo);
        if (!v) return null;
        if (v.rec && v.rec.state === 'recording') { v.rec.stop(); return 'stopped'; }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || typeof MediaRecorder === 'undefined') { this.showToast('تسجيل الشاشة غير مدعوم في هذا المتصفح', 'warning'); return null; }
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true, preferCurrentTab: true, selfBrowserSurface: 'include' }).catch(() => null);
        if (!screen) return null;
        let mic = null;
        try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch (e) { /* no mic */ }
        const tracks = [...screen.getVideoTracks(), ...(mic ? mic.getAudioTracks() : screen.getAudioTracks())];
        const rec = v.rec = new MediaRecorder(new MediaStream(tracks), { mimeType: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || '' });
        const chunks = [];
        rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        rec.onstop = () => { [...tracks, ...screen.getTracks()].forEach(t => t.stop()); if (mic) mic.getTracks().forEach(t => t.stop()); const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' }); this.downloadBlob(blob, `ox-alpha-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${/mp4/.test(rec.mimeType) ? 'mp4' : 'webm'}`); this.showToast('🎬 حُفظ التسجيل', 'success'); };
        screen.getVideoTracks()[0].addEventListener('ended', () => { if (rec.state !== 'inactive') rec.stop(); });
        rec.start(1000);
        this.showToast('⏺ يسجّل… اضغط «تسجيل» مرة أخرى للإيقاف', 'info');
        return 'recording';
    };
    P.ixModes = async function () {
        const c = this.ixCfg('ui');
        return card('وضع النص', `<p class="hv-dim">واجهة نصية خالصة: بلا أيقونات ولا صور ولا حركات ولا ظلال، بخط مقروء وتباين عالٍ. مناسبة للاتصالات البطيئة وقارئات الشاشة والتركيز التام. تبقى مفعلة بعد إعادة التحميل.</p>
            <div class="gh-row">${toggle('ix-md-text', 'تفعيل وضع النص', !!c.textMode, 'onchange="app.ixTextMode(this.checked)"')}</div>`, 'fa-font')
            + card('وضع الفيديو', `<p class="hv-dim">لتسجيل الشروحات والبث المباشر: كاميرا دائرية عائمة يمكن سحبها، وعرض الاختصارات المضغوطة على الشاشة، وخطوط أكبر، وتسجيل الشاشة مع الميكروفون بصيغة WebM بنقرة.</p>
            <div class="gh-row">${pbtn('fa-video', this._ixVideo ? 'إيقاف وضع الفيديو' : 'تشغيل وضع الفيديو', 'app.ixVideoMode().then(()=>app.ixRefresh())')}${btn('fa-circle-dot', 'تسجيل / إيقاف', 'app.ixRecord()')}${btn('fa-user-slash', 'بدون كاميرا', 'app.ixVideoMode(true,{camera:false}).then(()=>app.ixRefresh())')}</div>`, 'fa-video');
    };

    // ---------------------------------------------------------------- #352 mirror / #353 dual screen
    const SRC = { code: 'الملف المفتوح', preview: 'معاينة المشروع', chat: 'المحادثة' };
    P.ixScreenContent = async function (source) {
        if (source === 'preview') {
            const html = [...this.virtualProjectFiles.keys()].find(p => /(^|\/)index\.html?$/i.test(p)) || [...this.virtualProjectFiles.keys()].find(p => /\.html?$/i.test(p));
            if (!html) return { kind: 'text', text: 'لا توجد صفحة HTML في المشروع' };
            if (this.ensureRunner && (await this.ensureRunner({ quiet: true })) && this.buildPreviewDoc) return { kind: 'html', html: this.buildPreviewDoc(html, { bridge: false }), title: html };
            return { kind: 'html', html: this.virtualProjectFiles.get(html).content, title: html };
        }
        if (source === 'chat') { const el = document.getElementById('chat-container') || document.querySelector('.chat-messages, #messages'); return { kind: 'dom', html: el ? el.innerHTML : '', title: 'OX-Alpha' }; }
        const p = this.activeStudioFile, f = p && this.virtualProjectFiles.get(p);
        return { kind: 'code', text: f && typeof f.content === 'string' ? f.content : '// افتح ملفاً في الاستوديو', title: p || 'OX-Alpha' };
    };
    /** Opens/drives a same-origin popup (no scripts inside: the opener writes its DOM). */
    P.ixScreenOpen = async function (kind, { source = 'code', flip = false, fontSize = 22, features = '' } = {}) {
        const name = 'ox-' + kind;
        const w = window.open('', name, features || 'width=1000,height=700');
        if (!w) { this.showToast('اسمح بالنوافذ المنبثقة لهذا الموقع', 'warning'); return null; }
        const d = w.document;
        d.open(); d.write(`<!doctype html><html dir="${document.documentElement.dir || 'rtl'}"><head><meta charset="utf-8"><title>OX-Alpha — ${kind === 'mirror' ? 'المرآة' : 'الشاشة الثانية'}</title><style>
            html,body{margin:0;height:100%;background:#0b1020;color:#e2e8f0;font-family:system-ui,Tahoma,sans-serif}
            #bar{position:fixed;top:0;inset-inline:0;display:flex;gap:6px;padding:6px;background:#0008;z-index:2;opacity:.15;transition:opacity .2s}#bar:hover{opacity:1}
            #bar button{background:#334155;color:#fff;border:0;border-radius:6px;padding:4px 10px;cursor:pointer}
            #view{height:100%;overflow:auto;box-sizing:border-box}#view.flip{transform:scaleX(-1)}
            pre{margin:0;padding:48px 24px;white-space:pre-wrap;direction:ltr;text-align:left;font:${+fontSize || 22}px/1.5 ui-monospace,Consolas,monospace;counter-reset:l}
            pre span{display:block}pre span::before{counter-increment:l;content:counter(l);display:inline-block;width:3em;margin-inline-end:1em;color:#475569;text-align:right}
            iframe{border:0;width:100%;height:100%;background:#fff}.dom{padding:48px 24px;font-size:${+fontSize || 22}px}
        </style></head><body><div id="bar"><button id="fs">⛶ ملء الشاشة</button><button id="fl">⇋ قلب</button><button id="pl">A+</button><button id="mi">A−</button><span id="tt"></span></div><div id="view" class="${flip ? 'flip' : ''}"></div></body></html>`);
        d.close();
        const view = d.getElementById('view');
        let size = +fontSize || 22, last = '';
        d.getElementById('fs').onclick = () => { const de = d.documentElement; (de.requestFullscreen || de.webkitRequestFullscreen || (() => {})).call(de); };
        d.getElementById('fl').onclick = () => view.classList.toggle('flip');
        const font = (n) => { size = Math.max(10, Math.min(64, size + n)); d.querySelectorAll('pre, .dom').forEach(e => { e.style.fontSize = size + 'px'; }); };
        d.getElementById('pl').onclick = () => font(2);
        d.getElementById('mi').onclick = () => font(-2);
        const paint = async () => {
            if (w.closed) { clearInterval(st.timer); return; }
            const c = await this.ixScreenContent(st.source);
            const sig = c.kind + (c.text || c.html || '').length + ':' + (c.text || c.html || '').slice(-200) + c.title;
            if (sig === last) return;
            last = sig;
            d.getElementById('tt').textContent = c.title || '';
            if (c.kind === 'code' || c.kind === 'text') { const pre = d.createElement('pre'); pre.style.fontSize = size + 'px'; String(c.text).split('\n').forEach(l => { const s = d.createElement('span'); s.textContent = l || ' '; pre.appendChild(s); }); view.replaceChildren(pre); }
            else if (c.kind === 'html') { let f = view.querySelector('iframe'); if (!f) { f = d.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals'); view.replaceChildren(f); } f.srcdoc = c.html; }
            else { const div = d.createElement('div'); div.className = 'dom'; div.style.fontSize = size + 'px'; div.innerHTML = c.html; div.querySelectorAll('script, iframe').forEach(x => x.remove()); view.replaceChildren(div); }
        };
        const st = { w, source, timer: setInterval(paint, 800) };
        this['_ix_' + kind] = st;
        await paint();
        w.addEventListener('beforeunload', () => clearInterval(st.timer));
        return st;
    };
    P.ixMirror = async function (on = true, opts = {}) {
        const s = this._ix_mirror;
        if (!on) { if (s) { clearInterval(s.timer); try { s.w.close(); } catch (e) { /* closed */ } } this._ix_mirror = null; return false; }
        return this.ixScreenOpen('mirror', { source: opts.source || (document.getElementById('ix-sc-src') || {}).value || 'code', flip: opts.flip != null ? opts.flip : !!(document.getElementById('ix-sc-flip') || {}).checked });
    };
    P.ixDualScreen = async function (on = true, opts = {}) {
        const s = this._ix_dual;
        if (!on) { if (s) { clearInterval(s.timer); try { s.w.close(); } catch (e) { /* closed */ } } this._ix_dual = null; return false; }
        let features = 'width=1200,height=800';
        let placed = false;
        if (window.getScreenDetails) {
            try {
                const det = await window.getScreenDetails();
                const other = det.screens.find(x => x !== det.currentScreen) || null;
                if (other) { features = `left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`; placed = true; }
            } catch (e) { /* permission denied */ }
        }
        const st = await this.ixScreenOpen('dual', { source: opts.source || (document.getElementById('ix-sc-src2') || {}).value || 'preview', features });
        if (st) this.showToast(placed ? '🖥🖥 فُتحت على الشاشة الثانية — اضغط ⛶ لملء الشاشة' : '🖥 اسحب النافذة إلى الشاشة الثانية (متصفحك لا يدعم وضعها تلقائياً)', 'info');
        return st;
    };
    P.ixScreens = async function () {
        return card('وضع المرآة', `<p class="hv-dim">نافذة تعكس مباشرة الملف المفتوح بخط كبير وأرقام أسطر، أو معاينة المشروع، أو المحادثة. مناسبة لجهاز العرض في الدروس وللمراجعة الثنائية. خيار «القلب» يعكس الصورة أفقياً لأجهزة الملقّن (Teleprompter) والعرض الخلفي.</p>
            <div class="gh-row">${select('ix-sc-src', 'المصدر', Object.entries(SRC), 'code')}${toggle('ix-sc-flip', 'قلب أفقي', false)}${pbtn('fa-clone', 'فتح المرآة', 'app.ixMirror(true)')}${btn('fa-xmark', 'إغلاق', 'app.ixMirror(false)')}</div>`, 'fa-clone')
            + card('العرض المزدوج', `<p class="hv-dim">اكتب الكود على شاشة وشاهد المعاينة الحية على الشاشة الثانية. مع واجهة Window Management (في Chrome وEdge) تُفتح النافذة على الشاشة الأخرى بكامل مساحتها تلقائياً.</p>
            <div class="gh-row">${select('ix-sc-src2', 'المحتوى', Object.entries(SRC), 'preview')}${pbtn('fa-display', 'فتح على الشاشة الثانية', 'app.ixDualScreen(true)')}${btn('fa-xmark', 'إغلاق', 'app.ixDualScreen(false)')}</div>
            ${stats([['Window Management API', window.getScreenDetails ? 'مدعوم ✓' : 'غير مدعوم'], ['الشاشة الممتدة', window.screen && window.screen.isExtended ? 'نعم' : 'لا / غير معروف']])}`, 'fa-display');
    };
}
