/* Customize tab: #208 settings sync across devices • #209 editor extensions (declarative JSON — no code runs)
   • #258 customize menus • #270 file icon themes. */
import { esc, card, pbtn, btn, empty, setHTML, table, call, lsGet, lsSet, extOf, baseName, fmtDT, ago, toggle, CASES } from './util.js';

export const EXT_KEY = 'ox_dv_ext_v1';
export const ICON_KEY = 'ox_icon_theme_v1';
export const MENU_SEEN = 'ox_dv_menu_seen_v1';
const SYNC_FILE = 'ox-settings.json';

/** What a settings-sync payload can carry (localStorage keys copied verbatim). */
export const SYNC_GROUPS = [
    { id: 'editor', label: 'إعدادات المحرر والاختصارات', keys: ['ox_alpha_editor_v2'] },
    { id: 'look', label: 'المظهر (الثيم، الحجم، عرض الفروق)', keys: ['ox_alpha_theme', 'ox_alpha_ui_scale', 'ox_alpha_ui_v1', 'ox_alpha_diff_view'] },
    { id: 'app', label: 'إعدادات التطبيق (بدون المفاتيح والرموز)', keys: [], settings: true },
    { id: 'templates', label: 'قوالب الملفات والمجلدات', keys: ['ox_dv_templates_v1'] },
    { id: 'extensions', label: 'الإضافات', keys: [EXT_KEY] },
    { id: 'icons', label: 'ثيم الأيقونات', keys: [ICON_KEY] },
    { id: 'prompts', label: 'مكتبة البرومبتات', keys: ['ox_alpha_prompts_v1'] },
    { id: 'debug', label: 'نقاط التوقف', keys: ['ox_dv_bps_v1'] }
];
const SECRET_RE = /key|token|secret|password|webhook|gistid/i;

/** Build a sync payload from storage + settings (pure; storage passed in for tests). */
export function buildSyncPayload(groups, { get, settings = {}, device = '' }) {
    const data = {};
    const sel = SYNC_GROUPS.filter(g => groups.includes(g.id));
    sel.forEach(g => g.keys.forEach(k => { const v = get(k); if (v != null) data[k] = v; }));
    const out = { app: 'ox-settings-sync', v: 1, at: Date.now(), device, groups: sel.map(g => g.id), data };
    if (sel.some(g => g.settings)) out.settings = Object.fromEntries(Object.entries(settings).filter(([k, v]) => !SECRET_RE.test(k) && typeof v !== 'function'));
    return out;
}
/** Which keys differ between a payload and local storage → [{ group, key, local, remote }]. */
export function diffSyncPayload(payload, { get, settings = {} }) {
    const out = [];
    SYNC_GROUPS.forEach(g => {
        if (!(payload.groups || []).includes(g.id)) return;
        g.keys.forEach(k => { const r = (payload.data || {})[k]; if (r != null && r !== get(k)) out.push({ group: g.id, key: k, local: get(k), remote: r }); });
        if (g.settings && payload.settings) Object.entries(payload.settings).forEach(([k, v]) => { if (!SECRET_RE.test(k) && JSON.stringify(settings[k]) !== JSON.stringify(v)) out.push({ group: g.id, key: 'settings.' + k, local: settings[k], remote: v }); });
    });
    return out;
}

// ------------------------------------------------------------------ extensions
export const EXT_SAMPLE = {
    name: 'أدواتي', version: '1.0.0', description: 'مثال إضافة: أوامر ومقتطفات وقواعد فحص',
    commands: [
        { id: 'wrap-try', title: 'تغليف التحديد بـ try/catch', action: 'wrap', before: 'try {\n', after: '\n} catch (e) {\n    console.error(e);\n}', key: 'Ctrl+Alt+T' },
        { id: 'date', title: 'إدراج التاريخ', action: 'insert', text: '{{date}}' },
        { id: 'no-logs', title: 'حذف console.log من الملف', action: 'replace', find: '^\\s*console\\.log\\(.*\\);?\\n', with: '', flags: 'gm' },
        { id: 'kebab', title: 'تحويل التحديد إلى kebab-case', action: 'transform', case: 'kebab' },
        { id: 'test', title: 'تشغيل الاختبارات', action: 'shell', command: 'npm test' }
    ],
    snippets: [
        { prefix: 'clg', title: 'console.log', body: 'console.log(${1});', lang: 'js' },
        { prefix: 'afn', title: 'دالة سهمية async', body: 'const ${1:name} = async () => {\n    $0\n};', lang: 'js' }
    ],
    lint: [
        { pattern: '\\bdebugger\\b', message: 'احذف debugger قبل الرفع', severity: 'warning', files: '**/*.{js,ts,jsx,tsx}' },
        { pattern: 'TODO(?!\\()', message: 'TODO بدون اسم مسؤول — استخدم TODO(name)', severity: 'info' }
    ],
    icons: { vue: ['fa-brands fa-vuejs', '#42b883'] }
};
const ACTIONS = ['insert', 'wrap', 'replace', 'transform', 'shell', 'open', 'palette', 'snippet'];
/** Validate an extension manifest → { ok, errors, ext } (normalises ids). */
export function validateExtension(raw) {
    const errors = [];
    let ext = raw;
    if (typeof raw === 'string') { try { ext = JSON.parse(raw); } catch (e) { return { ok: false, errors: ['JSON غير صالح: ' + e.message] }; } }
    if (!ext || typeof ext !== 'object' || Array.isArray(ext)) return { ok: false, errors: ['يجب أن تكون الإضافة كائن JSON'] };
    if (!ext.name || typeof ext.name !== 'string') errors.push('الحقل name مطلوب');
    const commands = Array.isArray(ext.commands) ? ext.commands : [];
    commands.forEach((c, i) => {
        if (!c || !c.title) errors.push(`commands[${i}]: title مطلوب`);
        else if (!ACTIONS.includes(c.action)) errors.push(`commands[${i}]: action يجب أن يكون أحد ${ACTIONS.join(', ')}`);
        else if (c.action === 'replace') { try { new RegExp(c.find || '', c.flags || 'g'); } catch (e) { errors.push(`commands[${i}]: Regex غير صالح`); } }
        else if (c.action === 'open' && !/^https:\/\//.test(c.url || '')) errors.push(`commands[${i}]: url يجب أن يبدأ بـ https://`);
        else if (c.action === 'transform' && !CASES[c.case] && !['lower', 'sort', 'reverse', 'trim', 'unique'].includes(c.case)) errors.push(`commands[${i}]: case غير معروف`);
    });
    (Array.isArray(ext.lint) ? ext.lint : []).forEach((r, i) => { try { new RegExp(r.pattern, 'g'); } catch (e) { errors.push(`lint[${i}]: Regex غير صالح`); } if (!r.message) errors.push(`lint[${i}]: message مطلوب`); });
    (Array.isArray(ext.snippets) ? ext.snippets : []).forEach((s, i) => { if (!s.prefix || typeof s.body !== 'string') errors.push(`snippets[${i}]: prefix و body مطلوبان`); });
    if (ext.icons && typeof ext.icons !== 'object') errors.push('icons يجب أن يكون كائناً');
    if (errors.length) return { ok: false, errors };
    const slug = String(ext.name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'ext';
    return { ok: true, errors: [], ext: { ...ext, id: ext.id || slug, commands: commands.map((c, i) => ({ ...c, id: c.id || 'cmd' + i })), snippets: ext.snippets || [], lint: ext.lint || [] } };
}
/** Expand snippet placeholders: ${1:default} → default, $1/${1} → '', cursor at $0 or first stop. */
export function expandSnippet(body, vars = {}) {
    let cursor = -1, first = -1;
    let out = '';
    const re = /\$\{(\d+)(?::([^}]*))?\}|\$(\d+)|\{\{\s*(\w+)\s*\}\}/g;
    let last = 0, m;
    while ((m = re.exec(body))) {
        out += body.slice(last, m.index);
        last = re.lastIndex;
        if (m[4]) { out += vars[m[4]] != null ? vars[m[4]] : m[0]; continue; }
        const n = m[1] || m[3], def = m[2] || '';
        if (n === '0' && cursor < 0) cursor = out.length;
        else if (first < 0) first = out.length;
        out += def;
    }
    out += body.slice(last);
    return { text: out, cursor: cursor >= 0 ? cursor : first >= 0 ? first : out.length };
}
/** Apply a text command to (text, selection) → { text, from, to } (pure; used by the editor and tests). */
export function applyCommand(cmd, text, from, to, vars = {}) {
    const sel = text.slice(from, to);
    const fill = (s) => String(s || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (vars[k] != null ? vars[k] : k === 'selection' ? sel : m));
    if (cmd.action === 'insert') { const t = fill(cmd.text); return { text: text.slice(0, from) + t + text.slice(to), from: from + t.length, to: from + t.length }; }
    if (cmd.action === 'wrap') { const a = fill(cmd.before), b = fill(cmd.after); return { text: text.slice(0, from) + a + sel + b + text.slice(to), from: from + a.length, to: from + a.length + sel.length }; }
    if (cmd.action === 'replace') {
        const re = new RegExp(cmd.find, (cmd.flags || 'g').includes('g') ? cmd.flags || 'g' : cmd.flags + 'g');
        if (from !== to && cmd.scope !== 'file') { const r = sel.replace(re, fill(cmd.with)); return { text: text.slice(0, from) + r + text.slice(to), from, to: from + r.length }; }
        const r = text.replace(re, fill(cmd.with));
        return { text: r, from: Math.min(from, r.length), to: Math.min(from, r.length) };
    }
    if (cmd.action === 'transform') {
        const k = cmd.case;
        let r;
        if (CASES[k]) r = sel.replace(/[\p{L}\p{N}_$-]+/gu, (w) => CASES[k](w) || w);
        else if (k === 'lower') r = sel.toLowerCase();
        else { const lines = sel.split('\n'); r = (k === 'sort' ? lines.slice().sort((a, b) => a.localeCompare(b)) : k === 'reverse' ? lines.slice().reverse() : k === 'unique' ? Array.from(new Set(lines)) : lines.map(l => l.trimEnd())).join('\n'); }
        return { text: text.slice(0, from) + r + text.slice(to), from, to: from + r.length };
    }
    return null;
}

// ------------------------------------------------------------------ icon themes
const I = (icon, color) => ['fa-solid ' + icon, color];
const B = (icon, color) => ['fa-brands ' + icon, color];
export const ICON_THEMES = {
    default: { label: 'الافتراضي', desc: 'أيقونات OX الأصلية' },
    vivid: {
        label: 'ملوّن (Material)', desc: 'لون مميز لكل نوع + أيقونات خاصة للملفات المعروفة',
        ext: { js: B('fa-js', '#facc15'), mjs: B('fa-js', '#facc15'), cjs: B('fa-js', '#eab308'), ts: I('fa-code', '#3b82f6'), tsx: B('fa-react', '#38bdf8'), jsx: B('fa-react', '#22d3ee'), vue: B('fa-vuejs', '#42b883'), svelte: I('fa-fire', '#ff3e00'), py: B('fa-python', '#3b82f6'), rb: I('fa-gem', '#ef4444'), php: B('fa-php', '#8b5cf6'), go: B('fa-golang', '#22d3ee'), rs: B('fa-rust', '#f97316'), java: B('fa-java', '#f97316'), html: B('fa-html5', '#f97316'), css: B('fa-css3-alt', '#3b82f6'), scss: B('fa-sass', '#ec4899'), md: B('fa-markdown', '#e2e8f0'), json: I('fa-file-code', '#fbbf24'), yml: I('fa-sliders', '#f87171'), yaml: I('fa-sliders', '#f87171'), sql: I('fa-database', '#f59e0b'), sh: I('fa-terminal', '#4ade80'), svg: I('fa-bezier-curve', '#fb923c'), png: I('fa-image', '#a78bfa'), jpg: I('fa-image', '#a78bfa'), gif: I('fa-image', '#a78bfa'), webp: I('fa-image', '#a78bfa'), mp3: I('fa-music', '#f472b6'), mp4: I('fa-film', '#fb7185'), zip: I('fa-box-archive', '#fbbf24'), pdf: I('fa-file-pdf', '#ef4444'), csv: I('fa-table', '#22c55e'), env: I('fa-key', '#fbbf24'), lock: I('fa-lock', '#64748b'), txt: I('fa-align-left', '#94a3b8'), arjs: I('fa-pen-nib', '#10b981') },
        names: { 'package.json': B('fa-npm', '#ef4444'), 'readme.md': I('fa-book-open', '#38bdf8'), license: I('fa-scale-balanced', '#fbbf24'), 'license.md': I('fa-scale-balanced', '#fbbf24'), dockerfile: B('fa-docker', '#38bdf8'), '.gitignore': B('fa-git-alt', '#f87171'), 'tsconfig.json': I('fa-gear', '#3b82f6'), 'vite.config.js': I('fa-bolt', '#a855f7'), 'vite.config.ts': I('fa-bolt', '#a855f7'), '.env': I('fa-key', '#fbbf24'), 'changelog.md': I('fa-clock-rotate-left', '#a3e635'), 'sw.js': I('fa-satellite-dish', '#22d3ee'), 'manifest.json': I('fa-mobile-screen', '#a78bfa') },
        suffix: { '.test.js': I('fa-flask', '#22c55e'), '.spec.js': I('fa-flask', '#22c55e'), '.test.ts': I('fa-flask', '#22c55e'), '.spec.ts': I('fa-flask', '#22c55e'), '.d.ts': I('fa-shapes', '#60a5fa'), '.min.js': I('fa-compress', '#a3a3a3') },
        folders: { src: I('fa-folder-tree', '#60a5fa'), test: I('fa-vial', '#22c55e'), tests: I('fa-vial', '#22c55e'), components: I('fa-cubes', '#38bdf8'), assets: I('fa-photo-film', '#a78bfa'), public: I('fa-globe', '#4ade80'), docs: I('fa-book', '#f59e0b'), '.github': B('fa-github', '#e2e8f0'), node_modules: B('fa-npm', '#64748b'), scripts: I('fa-terminal', '#4ade80'), styles: B('fa-css3-alt', '#3b82f6'), api: I('fa-plug', '#f472b6'), utils: I('fa-screwdriver-wrench', '#94a3b8'), lib: I('fa-book-bookmark', '#94a3b8') }
    },
    mono: { label: 'أحادي اللون', desc: 'نفس الأشكال بلون واحد هادئ', mono: '#94a3b8', folder: '#94a3b8' },
    minimal: { label: 'بسيط', desc: 'ملف ومجلد فقط — أقل تشتيتاً', minimal: true, folder: '#64748b' },
    neon: { label: 'نيون', desc: 'ألوان مشبعة على الخلفيات الداكنة', mono: '#22d3ee', folder: '#f0abfc', ext: { js: I('fa-file-code', '#fde047'), ts: I('fa-file-code', '#60a5fa'), css: I('fa-file-code', '#f472b6'), html: I('fa-file-code', '#fb923c'), py: I('fa-file-code', '#4ade80'), md: I('fa-file-lines', '#e879f9') } }
};
/** Resolve a theme id + user overrides into the compact map the main bundle reads. */
export function resolveIconTheme(id, custom = {}) {
    const t = ICON_THEMES[id] || ICON_THEMES.default;
    if (id === 'default' && !Object.keys(custom.ext || {}).length && !Object.keys(custom.names || {}).length && !Object.keys(custom.folders || {}).length) return null;
    return { id, ext: { ...(t.ext || {}), ...(custom.ext || {}) }, names: { ...(t.names || {}), ...(custom.names || {}) }, suffix: { ...(t.suffix || {}) }, folders: { ...(t.folders || {}), ...(custom.folders || {}) }, mono: t.mono || null, minimal: !!t.minimal, folder: custom.folder || t.folder || null, custom };
}
/** Same lookup as the main-bundle fileIcon hook (kept in sync; used by previews and tests). */
export function iconFor(T, path, fallback) {
    if (!T) return fallback;
    const name = baseName(path).toLowerCase();
    const hit = T.names[name] || Object.keys(T.suffix || {}).sort((a, b) => b.length - a.length).map(s => (name.endsWith(s) ? T.suffix[s] : null)).find(Boolean) || T.ext[extOf(path)];
    if (hit) return hit;
    if (T.minimal) return ['fa-regular fa-file', '#94a3b8'];
    return T.mono ? [fallback[0], T.mono] : fallback;
}

export function installCustom(P) {
    // ---------------------------------------------------------------- #208 sync
    P.dvSyncGroups = function () { return lsGet('ox_dv_sync_groups_v1', ['editor', 'look', 'app', 'templates', 'extensions', 'icons']); };
    P.dvSync = async function () {
        const groups = this.dvSyncGroups();
        const meta = lsGet('ox_dv_sync_meta_v1', null);
        const hasTok = !!String(this.settings.githubToken || '').trim();
        return card('مزامنة الإعدادات بين الأجهزة', `<p class="hv-dim">زامن إعدادات المحرر والمظهر والقوالب والإضافات بين أجهزتك عبر Gist خاص في حسابك على GitHub — بشكل انتقائي وخفيف (بدون المحادثات والملفات، وبدون أي مفاتيح أو رموز). للنسخ الاحتياطي الكامل استخدم «المزامنة الكاملة» في الإعدادات.</p>
            ${hasTok ? '' : '<div class="gh-empty bad">يلزم رمز GitHub بصلاحية gist في الإعدادات</div>'}
            <div class="dvx-flags dvx-col">${SYNC_GROUPS.map(g => toggle('dv-sg-' + g.id, g.label, groups.includes(g.id), `onchange="app.dvSyncToggle('${g.id}',this.checked)"`)).join('')}</div>
            <div class="gh-row"><label class="fmx-field"><span>معرّف Gist المزامنة</span><input id="dv-sync-id" class="form-input-box" dir="ltr" placeholder="يُنشأ تلقائياً عند أول رفع" value="${esc(this.settings.syncGistId || '')}"></label></div>
            <div class="gh-row">${pbtn('fa-cloud-arrow-up', 'رفع إعدادات هذا الجهاز', 'app.dvSyncPushUI()', hasTok ? '' : 'disabled')}${btn('fa-cloud-arrow-down', 'جلب ومقارنة', 'app.dvSyncPullUI()', 'sidebar-btn-util gh-btn', hasTok ? '' : 'disabled')}</div>
            ${toggle('dv-sync-auto', 'مزامنة تلقائية عند بدء التشغيل: جلب إن كانت النسخة البعيدة أحدث، وإلا رفع تغييرات هذا الجهاز', !!this.settings.dvAutoSync, 'onchange="app.dvSet(\'dvAutoSync\',this.checked)"')}
            <small class="hv-dim">${meta ? `آخر ${meta.dir === 'push' ? 'رفع' : 'جلب'}: ${esc(ago(meta.at))} • ${meta.keys} عنصر` : 'لم تتم المزامنة بعد'}</small>
            <div id="dv-sync-res"></div>`, 'fa-arrows-rotate');
    };
    P.dvSyncToggle = function (id, on) { const g = new Set(this.dvSyncGroups()); if (on) g.add(id); else g.delete(id); lsSet('ox_dv_sync_groups_v1', Array.from(g)); return Array.from(g); };
    const lsRaw = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    P.dvSyncPush = async function ({ groups = this.dvSyncGroups() } = {}) {
        if (!String(this.settings.githubToken || '').trim()) throw new Error('يلزم رمز GitHub بصلاحية gist');
        const payload = buildSyncPayload(groups, { get: lsRaw, settings: this.stripSecrets ? this.stripSecrets(this.settings) : this.settings, device: (navigator.userAgent || '').slice(0, 80) });
        const files = { [SYNC_FILE]: { content: JSON.stringify(payload) } };
        let id = this.settings.syncGistId;
        if (id) { try { await this.gh('/gists/' + id, { method: 'PATCH', body: { files } }); } catch (e) { if (e.status === 404) id = null; else throw e; } }
        if (!id) {
            const g = await this.gh('/gists', { method: 'POST', body: { description: 'OX-Alpha Sync (private — do not edit)', public: false, files } });
            id = g.id;
            this.dvSet('syncGistId', id);
        }
        const keys = Object.keys(payload.data).length + (payload.settings ? 1 : 0);
        lsSet('ox_dv_sync_meta_v1', { at: payload.at, dir: 'push', keys, remoteAt: payload.at });
        return { id, keys, payload };
    };
    P.dvSyncFetch = async function (id = this.settings.syncGistId) {
        if (!id) throw new Error('لا يوجد Gist مزامنة — أدخل معرّفه من جهازك الآخر');
        const g = await this.gh('/gists/' + id);
        const f = (g.files || {})[SYNC_FILE];
        if (!f) throw new Error('لا توجد إعدادات مرفوعة في هذا الـ Gist بعد');
        const payload = JSON.parse(f.truncated ? await (await fetch(f.raw_url)).text() : f.content);
        if (!payload || payload.app !== 'ox-settings-sync') throw new Error('ملف المزامنة غير صالح');
        return payload;
    };
    P.dvSyncDiff = function (payload) { return diffSyncPayload(payload, { get: lsRaw, settings: this.settings }); };
    /** Apply the selected groups from a remote payload. */
    P.dvSyncApply = function (payload, groups = payload.groups || []) {
        const sel = SYNC_GROUPS.filter(g => groups.includes(g.id) && (payload.groups || []).includes(g.id));
        let n = 0;
        sel.forEach(g => {
            g.keys.forEach(k => { const v = (payload.data || {})[k]; if (v != null) { try { localStorage.setItem(k, v); n++; } catch (e) { /* quota */ } } });
            if (g.settings && payload.settings) { Object.entries(payload.settings).forEach(([k, v]) => { if (!SECRET_RE.test(k)) this.settings[k] = v; }); if (this.persistSettings) this.persistSettings(); n++; }
        });
        if (sel.some(g => g.id === 'editor')) { this._edSettings = null; if (this.applyEditorSettings && this.codeEditor) try { this.applyEditorSettings(); } catch (e) { /* studio closed */ } }
        if (sel.some(g => g.id === 'icons')) { this._iconTheme = undefined; if (this.renderStudioExplorer) try { this.renderStudioExplorer(); } catch (e) {} }
        if (sel.some(g => g.id === 'extensions')) this._dvExtCache = null;
        if (sel.some(g => g.id === 'look') && this.applyTheme) { try { const t = lsRaw('ox_alpha_theme'); if (t) this.applyTheme(t.replace(/^"|"$/g, '')); } catch (e) {} }
        lsSet('ox_dv_sync_meta_v1', { at: Date.now(), dir: 'pull', keys: n, remoteAt: payload.at });
        return n;
    };
    P.dvSyncPushUI = async function () {
        const idIn = (document.getElementById('dv-sync-id') || {}).value;
        if (idIn && idIn.trim() !== (this.settings.syncGistId || '')) this.dvSet('syncGistId', idIn.trim());
        this.dvBusy('dv-sync-res');
        try {
            const r = await this.dvSyncPush();
            setHTML('dv-sync-res', `<div class="gh-empty">✅ رُفع ${r.keys} عنصر إلى Gist <code dir="ltr">${esc(r.id)}</code> — أدخل هذا المعرّف في جهازك الآخر.</div>`);
            return r;
        } catch (e) { return this.dvErr(e, 'dv-sync-res'); }
    };
    P.dvSyncPullUI = async function () {
        const idIn = ((document.getElementById('dv-sync-id') || {}).value || '').trim();
        if (idIn && idIn !== (this.settings.syncGistId || '')) this.dvSet('syncGistId', idIn);
        this.dvBusy('dv-sync-res');
        try {
            const p = await this.dvSyncFetch();
            const d = this.dvSyncDiff(p);
            this._dvSyncPayload = p;
            const groups = Array.from(new Set(d.map(x => x.group)));
            const show = (v) => esc(String(v == null ? '—' : typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 80));
            setHTML('dv-sync-res', `<p class="hv-dim">نسخة من ${esc(fmtDT(p.at))}${p.device ? ' — ' + esc(p.device.slice(0, 40)) : ''}</p>`
                + (d.length ? table(['المجموعة', 'العنصر', 'هنا', 'البعيد'], d.slice(0, 60).map(x => [esc((SYNC_GROUPS.find(g => g.id === x.group) || {}).label || x.group), `<code dir="ltr">${esc(x.key)}</code>`, `<small dir="ltr">${show(x.local)}</small>`, `<small dir="ltr">${show(x.remote)}</small>`]))
                + `<div class="dvx-flags dvx-col">${groups.map(g => toggle('dv-sp-' + g, (SYNC_GROUPS.find(x => x.id === g) || {}).label || g, true)).join('')}</div><div class="gh-row">${pbtn('fa-download', 'تطبيق المحدد', 'app.dvSyncApplyUI()')}</div>` : empty('✅ الإعدادات متطابقة')));
            return d;
        } catch (e) { return this.dvErr(e, 'dv-sync-res'); }
    };
    P.dvSyncApplyUI = function () {
        const p = this._dvSyncPayload;
        if (!p) return 0;
        const groups = SYNC_GROUPS.map(g => g.id).filter(g => (document.getElementById('dv-sp-' + g) || {}).checked);
        const n = this.dvSyncApply(p, groups);
        this.showToast(`✅ طُبّق ${n} عنصر من المزامنة`, 'success');
        this.dvRefresh();
        return n;
    };
    /** Boot/auto sync: pull when remote is newer than our last sync, else push if local changed. */
    P.dvAutoSyncRun = async function () {
        if (!this.settings.dvAutoSync || !this.settings.syncGistId || !String(this.settings.githubToken || '').trim()) return null;
        const meta = lsGet('ox_dv_sync_meta_v1', {}) || {};
        try {
            const p = await this.dvSyncFetch();
            if (p.at > (meta.remoteAt || 0) && this.dvSyncDiff(p).length) { const n = this.dvSyncApply(p, this.dvSyncGroups()); this.showToast(`🔄 مزامنة الإعدادات: طُبّق ${n} عنصر من جهاز آخر`, 'info'); return { pulled: n }; }
            const local = buildSyncPayload(this.dvSyncGroups(), { get: lsRaw, settings: this.stripSecrets ? this.stripSecrets(this.settings) : this.settings });
            if (diffSyncPayload(local, { get: (k) => (p.data || {})[k], settings: p.settings || {} }).length) { await this.dvSyncPush(); return { pushed: true }; }
            return { same: true };
        } catch (e) { return { error: e.message }; }
    };

    // ---------------------------------------------------------------- #209 extensions
    P.dvExtList = function () { return lsGet(EXT_KEY, []); };
    P.dvExtSave = function (list) { lsSet(EXT_KEY, list); this._dvExtCache = null; if (this.refreshPaletteCommands) try { this.refreshPaletteCommands(); } catch (e) {} return list; };
    P.dvExtensions = async function () {
        const list = this.dvExtList();
        return card('إضافات المحرر', `<p class="hv-dim">إضافات تصريحية بصيغة JSON — بلا أي كود قابل للتنفيذ، فهي آمنة تماماً: <b>أوامر</b> (إدراج، تغليف، استبدال Regex، تحويل حالة، أمر طرفية، فتح رابط) تظهر في لوحة الأوامر مع اختصار اختياري، <b>مقتطفات</b> بعلامات <code>\${1:اسم}</code>، <b>قواعد فحص</b> تظهر كتحذيرات في المحرر، و<b>أيقونات</b> لامتدادات جديدة.</p>
            <div class="gh-row">${pbtn('fa-plus', 'إضافة جديدة', 'app.dvExtEdit()')}${btn('fa-wand-magic-sparkles', 'تثبيت المثال', 'app.dvExtInstall(app.dvLib().EXT_SAMPLE)')}${btn('fa-file-import', 'استيراد من ملف المشروع', 'app.dvExtImportFile()')}${btn('fa-robot', 'إنشاء بالذكاء الاصطناعي', 'app.dvExtAI()')}</div>`, 'fa-puzzle-piece')
            + card(`المثبتة (${list.length})`, list.length ? `<div class="fmx-list">${list.map(x => `<div class="fmx-item ${x.enabled === false ? 'dvx-off' : ''}"><div><b>${esc(x.name)}</b> <small class="hv-dim">v${esc(x.version || '1.0.0')}</small><small>${esc(x.description || '')}</small><small class="hv-dim">${(x.commands || []).length} أمر • ${(x.snippets || []).length} مقتطف • ${(x.lint || []).length} قاعدة • ${Object.keys(x.icons || {}).length} أيقونة</small></div>
                ${toggle('dv-ext-' + x.id, 'مفعّلة', x.enabled !== false, `onchange="${call('dvExtEnable', x.id)}"`)}${btn('fa-pen', '', call('dvExtEdit', x.id), 'gh-chip', 'title="تعديل"')}${btn('fa-download', '', call('dvExtExport', x.id), 'gh-chip', 'title="تصدير"')}${btn('fa-trash', '', call('dvExtRemove', x.id), 'gh-chip', 'title="حذف"')}</div>`).join('')}</div>` : empty('لا توجد إضافات مثبتة'), 'fa-plug')
            + (list.some(x => x.enabled !== false && (x.commands || []).length) ? card('الأوامر', `<div class="dvx-chips">${this.dvExtCommands().map(c => `<button class="gh-chip" onclick="${call('dvExtRun', c.extId, c.id)}">${esc(c.title)}${c.key ? ` <kbd>${esc(c.key)}</kbd>` : ''}</button>`).join('')}</div>`, 'fa-terminal') : '')
            + (list.some(x => x.enabled !== false && (x.snippets || []).length) ? card('المقتطفات', `<div class="dvx-chips">${this.dvExtSnippets().map(s => `<button class="gh-chip" onclick="${call('dvExtSnippet', s.extId, s.prefix)}" title="${esc(s.body.slice(0, 120))}"><code>${esc(s.prefix)}</code> ${esc(s.title || '')}</button>`).join('')}</div><small class="hv-dim">في المحرر: اكتب البادئة ثم اضغط <kbd>Ctrl+Alt+Space</kbd> لتوسيعها.</small>`, 'fa-scissors') : '');
    };
    P.dvExtInstall = function (raw, { quiet = false } = {}) {
        const v = validateExtension(raw);
        if (!v.ok) { if (!quiet) this.showToast('❌ ' + this.escapeHTML(v.errors.slice(0, 3).join(' • ')), 'error'); return v; }
        const list = this.dvExtList().filter(x => x.id !== v.ext.id);
        list.push({ ...v.ext, enabled: true, installedAt: Date.now() });
        this.dvExtSave(list);
        if (!quiet) this.showToast(`🧩 ثُبّتت «${this.escapeHTML(v.ext.name)}»`, 'success');
        if (this._dvx && this._dvx.sec === 'extensions') this.dvRefresh();
        return v;
    };
    P.dvExtEnable = function (id) { const list = this.dvExtList().map(x => (x.id === id ? { ...x, enabled: x.enabled === false } : x)); this.dvExtSave(list); return list.find(x => x.id === id); };
    P.dvExtRemove = async function (id) { if (!(await this.askConfirm('حذف الإضافة', 'سيتم حذف الإضافة وأوامرها.'))) return false; this.dvExtSave(this.dvExtList().filter(x => x.id !== id)); this.dvRefresh(); return true; };
    P.dvExtExport = function (id) { const x = this.dvExtList().find(e => e.id === id); if (!x) return null; const { enabled, installedAt, ...clean } = x; const p = this.uniqueProjectPath('.ox/extensions/' + x.id + '.json'); this.createProjectFile(p, JSON.stringify(clean, null, 2) + '\n'); return p; };
    P.dvExtImportFile = async function (pathArg) {
        const cands = this.projectPaths().filter(p => /\.json$/.test(p) && /ext|plugin|\.ox\//i.test(p));
        const p = pathArg || await this.askText('مسار ملف الإضافة (JSON)', cands[0] || '.ox/extensions/my-ext.json');
        if (!p) return null;
        const text = this.dvRead(p);
        if (text == null) { this.showToast('الملف غير موجود', 'error'); return null; }
        return this.dvExtInstall(text);
    };
    P.dvExtEdit = async function (id) {
        const cur = this.dvExtList().find(x => x.id === id);
        const { enabled, installedAt, ...clean } = cur || {};
        const r = await this.showDialog({ title: cur ? 'تعديل الإضافة' : 'إضافة جديدة', fields: [{ id: 'json', label: 'manifest (JSON)', type: 'textarea', rows: 16, dir: 'ltr', value: JSON.stringify(cur ? clean : { name: 'إضافتي', version: '1.0.0', commands: [], snippets: [], lint: [] }, null, 2) }], buttons: [{ label: 'حفظ', value: 'ok', primary: true, validate: (v) => { const x = validateExtension(v.json); return x.ok ? null : x.errors[0]; } }, { label: 'إلغاء', value: null }] });
        if (!r) return null;
        const v = this.dvExtInstall(r.values.json);
        if (v.ok && cur && v.ext.id !== cur.id) this.dvExtSave(this.dvExtList().filter(x => x.id !== cur.id));
        return v;
    };
    P.dvExtAI = async function () {
        const want = await this.askText('صف الإضافة المطلوبة', '', { placeholder: 'مثال: أوامر لـ React: تغليف بـ useMemo، مقتطف مكوّن، تحذير من useEffect بدون مصفوفة' , dir: 'auto' });
        if (!want) return null;
        const ans = await this.dvAI(`Create an OX editor extension manifest (pure JSON, no code) for: ${want}\nSchema: {"name","version","description","commands":[{"id","title","action":"insert|wrap|replace|transform|shell|open","text?","before?","after?","find?","with?","flags?","case?":"kebab|snake|camel|pascal|upper|lower|sort|unique","command?","url?","key?":"Ctrl+Alt+X"}],"snippets":[{"prefix","title","body","lang"}],"lint":[{"pattern","message","severity":"warning|info|error","files?"}]}\nTitles/messages in Arabic. Return ONLY the JSON object.`, { json: true, maxTokens: 3000 });
        if (!ans) return null;
        return this.dvExtInstall(ans);
    };
    P.dvExtActive = function () { return this.dvExtList().filter(x => x.enabled !== false); };
    P.dvExtCommands = function () { return this.dvExtActive().flatMap(x => (x.commands || []).map(c => ({ ...c, extId: x.id, extName: x.name }))); };
    P.dvExtSnippets = function () { return this.dvExtActive().flatMap(x => (x.snippets || []).map(s => ({ ...s, extId: x.id }))); };
    const vars = (app) => ({ date: new Date().toISOString().slice(0, 10), time: new Date().toTimeString().slice(0, 5), file: app.activeStudioFile || '', filename: baseName(app.activeStudioFile || ''), year: String(new Date().getFullYear()) });
    P.dvExtRun = async function (extId, cmdId) {
        const c = this.dvExtCommands().find(x => x.extId === extId && x.id === cmdId);
        if (!c) return null;
        if (c.action === 'shell') { await this.openDevLab('term', 'shell'); if (this.dvShellExec) return this.dvShellExec(c.command); return null; }
        if (c.action === 'open') { if (/^https:\/\//.test(c.url)) window.open(c.url, '_blank', 'noopener'); return c.url; }
        if (c.action === 'palette') { const cmd = (this.buildPaletteCommands() || []).find(x => x.label === c.label); if (cmd) cmd.run(); return !!cmd; }
        if (c.action === 'snippet') return this.dvExtSnippet(extId, c.prefix);
        const ctl = this.codeEditor;
        if (!ctl || !this.activeStudioFile) { this.showToast('افتح ملفاً في المحرر أولاً', 'info'); return null; }
        const text = ctl.getValue(), s = ctl.getSelection();
        const r = applyCommand(c, text, s.from, s.to, vars(this));
        if (!r || r.text === text) { this.showToast('لا تغيير', 'info'); return r; }
        let a = 0; while (a < text.length && a < r.text.length && text[a] === r.text[a]) a++;
        let bt = text.length, br = r.text.length; while (bt > a && br > a && text[bt - 1] === r.text[br - 1]) { bt--; br--; }
        ctl.replaceRange(a, bt, r.text.slice(a, br), r.from, r.to);
        ctl.focus();
        return r;
    };
    /** Insert a snippet (by prefix). If the word before the cursor equals the prefix it is replaced. */
    P.dvExtSnippet = function (extId, prefix) {
        const sn = this.dvExtSnippets().find(s => (!extId || s.extId === extId) && s.prefix === prefix);
        const ctl = this.codeEditor;
        if (!sn || !ctl) return null;
        const { text, cursor } = expandSnippet(sn.body, vars(this));
        const doc = ctl.getValue(), s = ctl.getSelection();
        const from = s.from === s.to && doc.slice(Math.max(0, s.from - prefix.length), s.from) === prefix ? s.from - prefix.length : s.from;
        const ind = (/[ \t]*$/.exec(doc.slice(doc.lastIndexOf('\n', from - 1) + 1, from)) || [''])[0];
        const t = text.replace(/\n/g, '\n' + ind);
        const cur = from + text.slice(0, cursor).replace(/\n/g, '\n' + ind).length;
        ctl.replaceRange(from, s.to, t, cur, cur);
        ctl.focus();
        return { from, text: t };
    };
    /** Ctrl+Alt+Space: expand the snippet whose prefix is the word before the cursor. */
    P.dvExtExpandAtCursor = function () {
        const ctl = this.codeEditor;
        if (!ctl) return null;
        const doc = ctl.getValue(), s = ctl.getSelection();
        const w = (/[\w$-]+$/.exec(doc.slice(Math.max(0, s.from - 40), s.from)) || [''])[0];
        const lang = extOf(this.activeStudioFile || '');
        const sn = this.dvExtSnippets().find(x => x.prefix === w && (!x.lang || x.lang === lang || (x.lang === 'js' && /^(m?[jt]sx?|cjs|vue|svelte)$/.test(lang))));
        if (!sn) { this.showToast(w ? `لا يوجد مقتطف بالبادئة «${this.escapeHTML(w)}»` : 'اكتب بادئة المقتطف أولاً', 'info'); return null; }
        return this.dvExtSnippet(sn.extId, sn.prefix);
    };

    // ---------------------------------------------------------------- #258 menus
    P.dvMenus = async function () {
        const prefs = this.settings.menuPrefs || { hidden: [], top: [] };
        const seen = lsGet(MENU_SEEN, []);
        const pal = (this.buildPaletteCommands() || []).map(c => c.label);
        const hiddenPal = new Set(prefs.palHidden || []);
        const row = (l) => `<tr><td>${esc(l)}</td><td>${toggle('', 'إخفاء', (prefs.hidden || []).includes(l), `onchange="${call('dvMenuToggle', 'hidden', l)}"`)}</td><td>${toggle('', 'في الأعلى', (prefs.top || []).includes(l), `onchange="${call('dvMenuToggle', 'top', l)}"`)}</td></tr>`;
        return card('تخصيص القوائم', `<p class="hv-dim">أخفِ عناصر قوائم السياق (النقر بالزر الأيمن على الملفات والمجلدات…) التي لا تستخدمها، أو ثبّت الأكثر استخداماً في أعلاها. تظهر هنا كل العناصر التي فتحتها مرة واحدة على الأقل.</p>
            ${seen.length ? `<div class="table-wrap"><table class="gh-table"><thead><tr><th>العنصر</th><th></th><th></th></tr></thead><tbody>${seen.slice().sort((a, b) => a.localeCompare(b, 'ar')).map(row).join('')}</tbody></table></div>` : empty('افتح قائمة سياق (زر أيمن على ملف) ثم عد إلى هنا')}
            <div class="gh-row">${btn('fa-rotate-left', 'استعادة الافتراضي', 'app.dvMenuReset()')}</div>`, 'fa-bars')
            + card('لوحة الأوامر', `<p class="hv-dim">أخفِ أوامر من لوحة الأوامر (Ctrl+K) — ${hiddenPal.size} مخفي من ${pal.length}.</p>
            <input class="form-input-box" placeholder="تصفية..." oninput="app.dvMenuFilter(this.value)"><div id="dv-pal-list" class="dvx-pal">${pal.slice(0, 400).map(l => `<label class="pfx-toggle" data-l="${esc(l.toLowerCase())}"><input type="checkbox" ${hiddenPal.has(l) ? '' : 'checked'} onchange="${call('dvMenuToggle', 'palHidden', l)}"><span>${esc(l)}</span></label>`).join('')}</div>`, 'fa-terminal');
    };
    P.dvMenuFilter = function (q) { const s = String(q || '').toLowerCase(); document.querySelectorAll('#dv-pal-list [data-l]').forEach(el => { el.style.display = !s || el.dataset.l.includes(s) ? '' : 'none'; }); };
    P.dvMenuToggle = function (kind, label) {
        const prefs = { hidden: [], top: [], palHidden: [], ...(this.settings.menuPrefs || {}) };
        const set = new Set(prefs[kind] || []);
        if (set.has(label)) set.delete(label); else set.add(label);
        prefs[kind] = Array.from(set);
        this.dvSet('menuPrefs', prefs);
        return prefs;
    };
    P.dvMenuReset = function () { this.dvSet('menuPrefs', { hidden: [], top: [], palHidden: [] }); this.dvRefresh(); return true; };

    // ---------------------------------------------------------------- #270 file icons
    P.dvIcons = async function () {
        const cur = lsGet(ICON_KEY, null);
        const id = (cur && cur.id) || 'default';
        const custom = (cur && cur.custom) || {};
        const sample = ['index.html', 'src/app.js', 'src/types.ts', 'src/App.tsx', 'styles.css', 'README.md', 'package.json', 'src/app.test.js', 'main.py', 'logo.svg', 'data.csv', 'Dockerfile', '.env', 'notes.txt', 'برنامج.arjs'];
        const fb = (p) => (this._fileIconBase || this.fileIcon).call(this, p);
        const prev = (tid) => { const T = resolveIconTheme(tid, tid === id ? custom : {}); return sample.slice(0, 10).map(p => { const [ic, col] = iconFor(T, p, fb(p)); return `<span class="dvx-ic" title="${esc(p)}"><i class="${esc(ic)}" style="color:${esc(col)}"></i></span>`; }).join(''); };
        return card('ثيم أيقونات الملفات', `<div class="dvx-themes">${Object.entries(ICON_THEMES).map(([k, t]) => `<button class="dvx-theme ${k === id ? 'active' : ''}" onclick="${call('dvIconSet', k)}"><b>${esc(t.label)}</b><small>${esc(t.desc)}</small><div class="dvx-icrow">${prev(k)}</div></button>`).join('')}</div>`, 'fa-icons')
            + card('أيقونات مخصصة', `<p class="hv-dim">خصّص أيقونة ولون أي امتداد أو اسم ملف أو مجلد (أسماء أيقونات Font Awesome مثل <code>fa-solid fa-leaf</code>).</p>
            ${table(['النوع', 'المفتاح', 'الأيقونة', ''], [...Object.entries(custom.ext || {}).map(([k, v]) => ['امتداد', k, v]), ...Object.entries(custom.names || {}).map(([k, v]) => ['اسم', k, v]), ...Object.entries(custom.folders || {}).map(([k, v]) => ['مجلد', k, v])].map(([t, k, v]) => [t, `<code dir="ltr">${esc(k)}</code>`, `<i class="${esc(v[0])}" style="color:${esc(v[1])}"></i> <small dir="ltr">${esc(v[0])}</small>`, btn('fa-xmark', '', call('dvIconRemove', t === 'امتداد' ? 'ext' : t === 'اسم' ? 'names' : 'folders', k), 'gh-chip')]))}
            <div class="gh-row"><select id="dv-ic-kind" class="form-input-box"><option value="ext">امتداد</option><option value="names">اسم ملف</option><option value="folders">مجلد</option></select><input id="dv-ic-key" class="form-input-box" dir="ltr" placeholder="vue / readme.md / src"><input id="dv-ic-icon" class="form-input-box" dir="ltr" placeholder="fa-solid fa-leaf"><input id="dv-ic-color" type="color" value="#42b883"></div>
            <div class="gh-row">${pbtn('fa-plus', 'إضافة', "app.dvIconAdd(document.getElementById('dv-ic-kind').value,document.getElementById('dv-ic-key').value,document.getElementById('dv-ic-icon').value,document.getElementById('dv-ic-color').value)")}</div>`, 'fa-paintbrush')
            + card('معاينة', `<div class="dvx-icprev">${sample.map(p => { const [ic, col] = iconFor(resolveIconTheme(id, custom), p, fb(p)); return `<div><i class="${esc(ic)}" style="color:${esc(col)}"></i> <span dir="ltr">${esc(p)}</span></div>`; }).join('')}<div><i class="${esc(this.folderIcon ? this.folderIcon('src', false)[0] : 'fa-solid fa-folder')}" style="color:${esc(this.folderIcon ? this.folderIcon('src', false)[1] : '#fbbf24')}"></i> <span dir="ltr">src/</span></div></div>`, 'fa-eye');
    };
    P.dvIconApply = function (id, custom) {
        const T = resolveIconTheme(id, custom);
        if (T) lsSet(ICON_KEY, T); else { try { localStorage.removeItem(ICON_KEY); } catch (e) {} }
        this._iconTheme = undefined;
        if (this.renderStudioExplorer && this.isCodeStudioOpen) try { this.renderStudioExplorer(); } catch (e) {}
        return T;
    };
    P.dvIconSet = function (id) { const cur = lsGet(ICON_KEY, null); const T = this.dvIconApply(id, (cur && cur.custom) || {}); if (this._dvx && this._dvx.sec === 'icons') this.dvRefresh(); return T; };
    P.dvIconAdd = function (kind, key, icon, color) {
        const k = String(key || '').trim().toLowerCase().replace(/^\./, kind === 'ext' ? '' : '.');
        let ic = String(icon || '').trim();
        if (!k || !/^(fa-(solid|regular|brands)\s+)?fa-[a-z0-9-]+$/.test(ic)) { this.showToast('أدخل مفتاحاً واسم أيقونة صالحاً مثل fa-solid fa-leaf', 'warning'); return null; }
        if (!/^fa-(solid|regular|brands)\s/.test(ic)) ic = 'fa-solid ' + ic;
        const cur = lsGet(ICON_KEY, null);
        const custom = { ext: {}, names: {}, folders: {}, ...((cur && cur.custom) || {}) };
        custom[kind] = { ...(custom[kind] || {}), [k]: [ic, /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#94a3b8'] };
        const T = this.dvIconApply((cur && cur.id) || 'default', custom);
        if (this._dvx && this._dvx.sec === 'icons') this.dvRefresh();
        return T;
    };
    P.dvIconRemove = function (kind, key) {
        const cur = lsGet(ICON_KEY, null);
        if (!cur || !cur.custom || !cur.custom[kind]) return null;
        const custom = { ...cur.custom, [kind]: { ...cur.custom[kind] } };
        delete custom[kind][key];
        const T = this.dvIconApply(cur.id, custom);
        this.dvRefresh();
        return T;
    };
}
