/* Developer Lab hub shell: tabs/sections, settings helpers, AI helper, project-file helpers. */
import { esc, call, empty } from './util.js';

export const TAB_DEFS = {
    search: [['regex', 'بحث واستبدال Regex', 'dvRegex'], ['batches', 'سجل الاستبدال', 'dvBatches']],
    quality: [['stylelint', 'Stylelint', 'dvStylelint'], ['typecheck', 'فحص الأنواع TS', 'dvTypecheck'], ['dupes', 'الكود المكرر', 'dvDupes'], ['merge', 'دمج الملفات الصغيرة', 'dvMerge']],
    run: [['polyglot', 'Go / PHP / Ruby', 'dvPolyglot'], ['mockdb', 'قاعدة بيانات وهمية', 'dvMockDB'], ['mockauth', 'مصادقة وهمية', 'dvMockAuth'], ['ports', 'المنافذ والخوادم', 'dvPorts'], ['share', 'مشاركة النتيجة', 'dvShare']],
    term: [['shell', 'الطرفية', 'dvShell'], ['npm', 'npm / yarn / pnpm', 'dvNpm']],
    test: [['coverage', 'التغطية', 'dvCoverage'], ['e2e', 'اختبارات E2E', 'dvE2E'], ['snapshot', 'اللقطات', 'dvSnapshots'], ['mutation', 'اختبار الطفرات', 'dvMutation'], ['perf', 'اختبارات الأداء', 'dvBench']],
    debug: [['debugger', 'المصحح', 'dvDebugger'], ['replay', 'إعادة الأخطاء', 'dvReplay']],
    history: [['timeline', 'الخط الزمني', 'dvTimeline'], ['compare', 'مقارنة نسختين', 'dvCompare'], ['blame', 'Blame / GitLens', 'dvBlame'], ['restore', 'استعادة', 'dvRestore']],
    refactor: [['multiedit', 'تحرير متعدد', 'dvMultiEdit'], ['folder', 'إعادة هيكلة مجلد', 'dvFolder'], ['templates', 'قوالب الملفات', 'dvTemplates'], ['scaffold', 'قوالب المجلدات', 'dvScaffold'], ['fileops', 'نسخ وضغط', 'dvFileOps']],
    custom: [['sync', 'مزامنة الإعدادات', 'dvSync'], ['extensions', 'الإضافات', 'dvExtensions'], ['menus', 'القوائم', 'dvMenus'], ['icons', 'أيقونات الملفات', 'dvIcons']],
    arabic: [['qalam', 'لغة قلم', 'dvQalam'], ['reference', 'مرجع قلم', 'dvQalamRef']]
};

export function installCore(P) {
    P.openDevLab = async function (tab = 'search', sec, opts = {}) {
        if (!TAB_DEFS[tab]) tab = 'search';
        this.openPanel({
            title: 'مختبر المطوّر', icon: 'fa-flask-vial',
            tabs: (this.DEV_TABS || []).map(t => ({ ...t, onclick: `app.openDevLab('${t.id}')` })), activeTab: tab,
            body: '<div id="dvx-root" class="fmx-root dvx-root"></div>'
        });
        return this.dvLoad(tab, sec, opts);
    };
    P.dvLoad = async function (tab, sec, opts = {}) {
        const defs = TAB_DEFS[tab] || TAB_DEFS.search;
        const def = defs.find(d => d[0] === sec) || defs.find(d => d[0] === ((this._dvSec || {})[tab])) || defs[0];
        this._dvSec = { ...(this._dvSec || {}), [tab]: def[0] };
        this._dvx = { tab, sec: def[0], opts };
        if (this._dvStop) { try { this._dvStop(); } catch (e) { /* ignore */ } this._dvStop = null; }
        document.querySelectorAll('#ox-panel-tabs .gh-tab').forEach((b, i) => b.classList.toggle('active', ((this.DEV_TABS || [])[i] || {}).id === tab));
        const root = document.getElementById('dvx-root');
        if (!root) { await this.openDevLab(tab, def[0], opts); return; }
        root.innerHTML = `<div class="ghx-subnav fmx-subnav">${defs.map(([id, label]) => `<button class="gh-chip ${id === def[0] ? 'active' : ''}" data-dv-sec="${id}" onclick="${call('dvLoad', tab, id)}">${label}</button>`).join('')}</div>
            <div id="dvx-sec" class="fmx-sec" data-dv-tab="${tab}" data-dv-sec="${def[0]}"><div class="gh-empty"><span class="live-step-spinner"></span></div></div>`;
        this.setPanelFooter('');
        if (this.pfTrack) this.pfTrack('dev:' + tab + '/' + def[0]);
        let html;
        try { html = await this[def[2]](opts); } catch (e) { console.error(e); html = empty('❌ ' + esc(e.message || e), true); }
        const el = document.getElementById('dvx-sec');
        if (el && el.dataset.dvSec === def[0] && el.dataset.dvTab === tab && html != null) {
            el.innerHTML = html;
            const m = this._dvMount; this._dvMount = null;
            if (typeof m === 'function') try { await m(); } catch (e) { console.error(e); }
        }
        return el;
    };
    P.dvRefresh = function () { const c = this._dvx; return c ? this.dvLoad(c.tab, c.sec, c.opts) : this.openDevLab(); };
    P.dvBusy = function (id, msg) { const el = document.getElementById(id); if (el) el.innerHTML = `<div class="gh-empty"><span class="live-step-spinner"></span> ${msg || ''}</div>`; };
    P.dvErr = function (e, id) {
        const msg = (e && e.message) || String(e);
        if (id) { const el = document.getElementById(id); if (el) el.innerHTML = empty('❌ ' + esc(msg), true); }
        this.showToast('❌ ' + this.escapeHTML(msg), 'error');
        return null;
    };
    /** Persist one setting without the settings modal (saveSettings would wipe keys). */
    P.dvSet = function (key, value) { this.settings[key] = value; if (this.persistSettings) this.persistSettings(); return value; };
    P.dvAI = async function (prompt, { json = false, system, maxTokens = 2500, quiet = false } = {}) {
        if (!String(this.settings.apiKey || '').trim()) { if (!quiet) this.showToast('يلزم مفتاح OpenRouter في الإعدادات لهذه الميزة الذكية', 'warning'); return null; }
        if ((!this.aiRun || this.aiRun.__oxLazy) && this.loadChunk) { try { await this.loadChunk('ai'); } catch (e) { /* offline */ } }
        if (!this.aiRun) return null;
        const opts = { system: system || 'You are OX-AI, a senior software engineer. Answer in Arabic unless code is requested. Be concise and practical.', maxTokens, kind: 'code', source: 'dev', quiet: true };
        try { return json ? await this.aiJSON(prompt, opts) : await this.aiRun(prompt, opts); } catch (e) { if (!quiet) this.showToast('❌ ' + this.escapeHTML(e.message || String(e)), 'error'); return null; }
    };
    /** Text files of the project as [path, content] (binary entries skipped). */
    P.dvTextFiles = function (filter) {
        const out = [];
        for (const [p, f] of this.virtualProjectFiles) if (f && typeof f.content === 'string' && !f.dataUrl && !f.binary && (!filter || filter(p))) out.push([p, f.content]);
        return out.sort((a, b) => a[0].localeCompare(b[0]));
    };
    P.dvRead = function (p) { const f = this.virtualProjectFiles.get(p); return f && typeof f.content === 'string' ? f.content : null; };
    /** Record a multi-file edit batch so it can be undone as one step (#134 / #241 / #242). */
    P.dvBatch = function (label, before) {
        this._dvBatches = this._dvBatches || [];
        const b = { id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), label, at: Date.now(), files: before };
        this._dvBatches.unshift(b);
        this._dvBatches.length = Math.min(this._dvBatches.length, 30);
        return b;
    };
    /** Write many files as one batch: changes = [[path, newContent|null(delete)]]. */
    P.dvApply = function (label, changes) {
        const before = changes.map(([p]) => ({ path: p, content: this.dvRead(p), existed: this.virtualProjectFiles.has(p), entry: this.virtualProjectFiles.get(p) }));
        changes.forEach(([p, c]) => {
            if (c == null) { if (this.virtualProjectFiles.has(p)) { this._writeReason = 'refactor'; try { this.virtualProjectFiles.delete(p); } finally { this._writeReason = null; } } }
            else if (typeof c === 'object' && c.entry) { this._writeReason = 'refactor'; try { this.virtualProjectFiles.set(p, { ...c.entry, timestamp: Date.now() }); } finally { this._writeReason = null; } }
            else this.writeProjectFile(p, c, 'refactor');
        });
        if (this.activeStudioFile && changes.some(([p, c]) => p === this.activeStudioFile && c == null)) { const mv = changes.find(([, c]) => c && typeof c === 'object' && c.from === this.activeStudioFile); if (mv) this.activeStudioFile = mv[0]; }
        if (this.scheduleProjectSave) this.scheduleProjectSave();
        const b = this.dvBatch(label, before);
        if (this.isCodeStudioOpen && this.renderStudioWorkspace) try { this.renderStudioWorkspace(); } catch (e) { /* ignore */ }
        return b;
    };
    P.dvUndoBatch = function (id) {
        const list = this._dvBatches || [];
        const i = id ? list.findIndex(b => b.id === id) : 0;
        const b = list[i];
        if (!b) { this.showToast('لا توجد دفعة للتراجع عنها', 'info'); return false; }
        b.files.forEach(f => {
            if (!f.existed) { if (this.virtualProjectFiles.has(f.path)) this.virtualProjectFiles.delete(f.path); }
            else if (f.content != null && this.virtualProjectFiles.has(f.path)) this.writeProjectFile(f.path, f.content, 'undo');
            else if (f.entry) { this._writeReason = 'undo'; try { this.virtualProjectFiles.set(f.path, f.entry); } finally { this._writeReason = null; } }
        });
        list.splice(i, 1);
        if (this.scheduleProjectSave) this.scheduleProjectSave();
        if (this.isCodeStudioOpen && this.renderStudioWorkspace) try { this.renderStudioWorkspace(); } catch (e) { /* ignore */ }
        this.showToast(`↩️ تم التراجع: ${b.label} (${b.files.length} ملف)`, 'success');
        return true;
    };
}
