/* AI chunk core: one-shot model calls, project context, applying generated files. */
import { parseFileBlocks, extractJSON, extOf, isSafePath, esc } from './shared.js';

export function installCore(P) {
    // esc imported from shared.js

    /** Model for a task category (router-aware), overridable per call. */
    P.aiModelFor = function (kind = 'coding', opts = {}) {
        if (opts.model) return opts.model;
        const s = this.getAISettings();
        if (s.model) return s.model;
        if (opts.vision) {
            const cur = (this.availableModels || []).find(m => m.id === this.settings.model);
            if (cur && cur.is_vision) return cur.id;
            const v = (this.availableModels || []).find(m => m.is_vision && m.is_free) || (this.availableModels || []).find(m => m.is_vision);
            return v ? v.id : 'google/gemma-3-27b-it:free';
        }
        return (this.routeForCategory && this.routeForCategory(kind)) || this.settings.model || 'google/gemma-3-27b-it:free';
    };

    /** One-shot completion. images: data/https URLs for vision models. Returns the text (or null without a key). */
    P.aiRun = async function (prompt, { system, maxTokens = 3000, kind = 'coding', model, signal, onDelta, images, source = 'ai-lab', history = [], quiet = false } = {}) {
        if (!this.settings.apiKey || !String(this.settings.apiKey).trim()) {
            if (!quiet) this.showToast('يلزم مفتاح OpenRouter في الإعدادات', 'warning');
            return null;
        }
        const useModel = this.aiModelFor(kind, { model, vision: !!(images && images.length) });
        const user = images && images.length
            ? { role: 'user', content: [{ type: 'text', text: prompt }, ...images.slice(0, 8).map(url => ({ type: 'image_url', image_url: { url } }))] }
            : { role: 'user', content: prompt };
        const messages = (system ? [{ role: 'system', content: system }] : []).concat(history, [user]);
        const t0 = Date.now();
        const r = await this.streamOpenRouter({ model: useModel, messages, signal, maxTokens, onDelta });
        if (this.recordUsage) this.recordUsage({ model: useModel, usage: r.usage, promptChars: JSON.stringify(messages).length, completionChars: (r.content || '').length, durationMs: r.durationMs || Date.now() - t0, source });
        this._aiLast = { model: useModel, content: r.content || '', reasoning: r.reasoning || '' };
        return r.content || '';
    };
    P.aiJSON = async function (prompt, opts = {}) {
        const text = await this.aiRun(prompt + '\n\nRespond with JSON only.', opts);
        return text == null ? null : extractJSON(text);
    };
    P.parseFileBlocks = parseFileBlocks;
    P.extractJSON = extractJSON;

    /** Compact project snapshot for prompts: tree + package.json/README + active / requested files. */
    P.aiProjectContext = function ({ maxChars = 14000, paths = [], includeActive = true } = {}) {
        const files = this.virtualProjectFiles || new Map();
        const all = Array.from(files.keys()).sort();
        if (!all.length) return '';
        const text = (p) => { const f = files.get(p); return f && typeof f.content === 'string' ? f.content : ''; };
        let out = `Project files (${all.length}):\n${all.slice(0, 200).join('\n')}\n`;
        const picks = [];
        paths.forEach(p => { if (files.has(p)) picks.push(p); });
        if (includeActive && this.activeStudioFile && files.has(this.activeStudioFile)) picks.push(this.activeStudioFile);
        ['package.json', 'README.md', 'requirements.txt', 'pyproject.toml'].forEach(p => { if (files.has(p)) picks.push(p); });
        for (const p of Array.from(new Set(picks))) {
            const body = text(p);
            if (!body) continue;
            const chunk = `\n--- ${p} ---\n${body.slice(0, 6000)}\n`;
            if (out.length + chunk.length > maxChars) break;
            out += chunk;
        }
        return out.slice(0, maxChars);
    };

    /** Current code input for generators: editor selection → active file → nothing. */
    P.aiCodeInput = function () {
        try {
            const ctl = this.codeEditor;
            if (ctl && ctl.getSelection) {
                const sel = ctl.getSelection();
                if (sel && sel.to > sel.from) return { code: ctl.getValue().slice(sel.from, sel.to), path: this.activeStudioFile, scope: 'selection' };
            }
        } catch (e) { /* editor not mounted */ }
        const f = this.activeStudioFile && this.virtualProjectFiles.get(this.activeStudioFile);
        if (f && typeof f.content === 'string') return { code: f.content, path: this.activeStudioFile, scope: 'file' };
        return { code: '', path: '', scope: 'none' };
    };

    /** Preview generated files (new / changed / unchanged) and write the chosen ones. Returns written paths. */
    P.aiApplyFiles = async function (files, { title = 'تطبيق الملفات المولدة', auto = false } = {}) {
        const list = (files || []).filter(f => f && isSafePath(f.path));
        if (!list.length) { this.showToast('لم يُعثر على ملفات في الرد', 'info'); return []; }
        const state = (f) => { const cur = this.virtualProjectFiles.get(f.path); return !cur ? 'new' : cur.content === f.content ? 'same' : 'changed'; };
        let chosen = list.filter(f => state(f) !== 'same');
        if (!auto) {
            const label = { new: 'جديد', changed: 'تعديل', same: 'بلا تغيير' };
            const r = await this.showDialog({
                title,
                body: `<p class="ox-dialog-msg">اختر الملفات التي تريد كتابتها في المشروع (يمكن التراجع من سجل الملف):</p>`,
                fields: list.map((f, i) => ({ id: 'f' + i, type: 'checkbox', label: `${f.path} — ${label[state(f)]} (${f.content.split('\n').length} سطر)`, value: state(f) !== 'same' })),
                buttons: [{ label: 'كتابة الملفات', value: 'ok', primary: true }, { label: 'إلغاء', value: null }]
            });
            if (!r) return [];
            chosen = list.filter((f, i) => r.values['f' + i]);
        }
        const written = [];
        chosen.forEach(f => {
            if (this.virtualProjectFiles.has(f.path)) this.writeProjectFile(f.path, f.content, 'ai');
            else if (this.createProjectFile) this.createProjectFile(f.path, f.content, { open: false, reason: 'ai' });
            else this.virtualProjectFiles.set(f.path, { content: f.content, lang: extOf(f.path), timestamp: Date.now() });
            written.push(f.path);
        });
        if (written.length) {
            this.activeStudioFile = written[0];
            if (this.isCodeStudioOpen && this.renderStudioWorkspace) this.renderStudioWorkspace();
            this.showToast(`✅ كُتب ${written.length} ملف في المشروع`, 'success');
        }
        return written;
    };

    /** Shared result card: markdown + copy / send to chat / apply files. */
    P.aiResultHTML = function (text, { files } = {}) {
        files = files || parseFileBlocks(text);
        return `<div class="ai-result gh-md markdown-body" dir="auto">${this.renderMarkdownSafe ? this.renderMarkdownSafe(text) : esc(text)}</div>
            <div class="gh-toolbar ai-result-actions">
                <button class="sidebar-btn-util gh-btn" onclick="app.copyToClipboard(app._aiOut || '')"><i class="fa-solid fa-copy"></i> نسخ</button>
                <button class="sidebar-btn-util gh-btn" onclick="app.aiSendToChat()"><i class="fa-solid fa-comment"></i> إلى المحادثة</button>
                ${files.length ? `<button class="btn-new-thread gh-btn" onclick="app.aiApplyFiles(app.parseFileBlocks(app._aiOut || ''))"><i class="fa-solid fa-file-circle-plus"></i> كتابة ${files.length} ملف في المشروع</button>` : ''}
            </div>`;
    };
    /** Put the last AI-lab output into the active conversation (no extra request). */
    P.aiSendToChat = function (text = this._aiOut, title = this._aiOutTitle || 'مختبر الذكاء') {
        if (!text) return false;
        let s = (this.sessions || []).find(x => x.id === this.activeSessionId);
        if (!s) { this.createNewSession(); s = (this.sessions || []).find(x => x.id === this.activeSessionId); }
        if (!s) return false;
        const now = Date.now();
        s.messages.push({ id: 'u' + now, role: 'user', content: `🧪 ${title}`, timestamp: now });
        s.messages.push({ id: 'a' + now, role: 'assistant', content: text, timestamp: now, status: 'completed', model: (this._aiLast && this._aiLast.model) || '' });
        s.updatedAt = now;
        this.saveSessions();
        this.closeModals();
        this.renderUIState ? this.renderUIState() : this.renderMessages();
        return true;
    };
}
