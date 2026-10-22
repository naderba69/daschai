/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 8: AI lab (main-bundle core)
   The heavy parts (generators, agent, memory, reasoning, library, vision, voice) live in the lazy
   chunk src/ai/ai.js → assets/studio/ai-[hash].mjs. This file keeps only what must work before it loads:
     • lazy stubs + app.aiLab(method, …)            • AI settings (ox_alpha_ai_lab_v1)
     • chat payload hook: summary (#18), memory (#5), visible reasoning (#14), standards (#81)
     • reply hook: <think> → reasoning (#14), follow-ups (#19), memory capture, auto-summary
     • agent mode in chat (#4), personas (#36), new modes (#66 #68), autocomplete wiring (#31)
     • palette section + Alt+L / Alt+P / Alt+A
   ============================================================================== */
(function () {
    'use strict';
    if (typeof OXAlphaApp === 'undefined') return;
    const P = OXAlphaApp.prototype;
    const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // ------------------------------------------------------------------ LAZY AI CHUNK
    const AI_STUBS = [
        'openAILab', 'openGenerator', 'runGenerator', 'openDependencyDoctor', 'openPaletteGenerator', 'aiChangelogFromCommits', 'aiBuildFix', 'openVisionTool',
        'treeOfThought', 'selfRefine', 'chainOfThought', 'summarizeSession', 'aiFollowups', 'runAgent', 'runAgentInChat', 'startVoiceAgent', 'stopVoiceAgent',
        'usePrompt', 'saveInputAsPrompt', 'installPersona', 'createCustomPersona', 'startInterview', 'gradeInterview', 'downloadCertificate', 'aiCareerDoc',
        'memoryContext', 'captureMemory', 'addMemory', 'searchMemories', 'aiComplete', 'checkProjectStandards', 'standardsPromptText', 'aiRun', 'aiJSON'];
    P.ensureAI = async function (opts = {}) {
        try { await this.loadChunk('ai'); return true; } catch (e) {
            console.warn('[OX] ai chunk failed', e);
            if (!opts.quiet) this.showToast('تعذر تحميل مختبر الذكاء — تحقق من الاتصال وأعد المحاولة', 'error');
            return false;
        }
    };
    /** Call a lazy AI-lab method: app.aiLab('openAILab', 'agent') */
    P.aiLab = async function (method, ...args) {
        if (!(await this.ensureAI())) return null;
        const fn = this[method];
        if (typeof fn !== 'function' || fn.__oxLazy) throw new Error('unknown ai method ' + method);
        return fn.apply(this, args);
    };
    AI_STUBS.forEach((name) => {
        if (P[name]) return;
        const stub = function (...args) { return this.aiLab(name, ...args); };
        stub.__oxLazy = 'ai';
        P[name] = stub;
    });
    P.lazyAIMethods = () => AI_STUBS.slice();
    /** Background call that never toasts (used by hooks). */
    P.aiQuiet = async function (method, ...args) {
        if (!(await this.ensureAI({ quiet: true }))) return null;
        try { return await this[method](...args); } catch (e) { console.warn('[OX] ai', method, e); return null; }
    };

    // ------------------------------------------------------------------ SETTINGS
    const AI_KEY = 'ox_alpha_ai_lab_v1';
    const AI_DEFAULTS = { model: '', memory: false, autoSummarize: true, summarizeAt: 40, followups: 'local', cot: false, standards: false, autocomplete: false, personas: [], personaDefs: {}, customPersonas: [], recentGenerators: [] };
    P.getAISettings = function () {
        if (!this._aiSettings) this._aiSettings = { ...AI_DEFAULTS, ...lsGet(AI_KEY, {}) };
        return this._aiSettings;
    };
    P.setAISettings = function (patch = {}) {
        const s = { ...this.getAISettings(), ...patch };
        s.summarizeAt = Math.max(10, Math.min(200, parseInt(s.summarizeAt, 10) || 40));
        if (!['local', 'ai', 'off'].includes(s.followups)) s.followups = 'local';
        this._aiSettings = s;
        lsSet(AI_KEY, s);
        if ('autocomplete' in patch) this.bindAutocomplete();
        return s;
    };

    // ------------------------------------------------------------------ CONVERSATION MODES (#66 #68)
    if (P.CHAT_MODES) Object.assign(P.CHAT_MODES, {
        lineByLine: { icon: 'fa-list-ol', label: 'شرح سطراً بسطر', prompt: 'LINE-BY-LINE TEACHER MODE: whenever code is involved, explain it line by line. Quote each line (or small group of lines) in a code span, then explain what it does, why it is written that way and what would break without it. Finish with a one-paragraph summary and a tiny exercise.' },
        match: { icon: 'fa-flag-checkered', label: 'مباراة ضد الذكاء', prompt: 'MATCH MODE: you compete against the user. Each round, pose a small coding problem, then let the user submit a solution first; afterwards reveal YOUR solution and judge both fairly on correctness, complexity and readability (score each out of 10). Keep a running scoreboard ("أنت 2 — الذكاء 1"), raise difficulty after each round, and never reveal your solution before the user submits.' }
    });

    // ------------------------------------------------------------------ PERSONAS (#36)
    const BASE_PERSONAS = [['fullstack', 'مطور شامل', 'fa-solid fa-code'], ['security', 'فاحص الأمان 🛡️', 'fa-solid fa-shield-halved'], ['performance', 'محسن الأداء ⚡', 'fa-solid fa-bolt'], ['architect', 'مهندس معماري 🏗️', 'fa-solid fa-sitemap'], ['tests', 'صانع الاختبارات 🧪', 'fa-solid fa-vial']];
    const personaTable = () => (typeof PERSONA_PROMPTS !== 'undefined' ? PERSONA_PROMPTS : null);
    P.registerPersona = function (p) {
        const t = personaTable();
        if (!p || !p.id || !p.prompt) return false;
        if (t) t['mk_' + p.id] = p.prompt;
        const s = this.getAISettings();
        if (!s.personaDefs[p.id]) this.setAISettings({ personaDefs: { ...s.personaDefs, [p.id]: { name: p.name, icon: p.icon, prompt: p.prompt } } });
        return true;
    };
    P.personaList = function () {
        const s = this.getAISettings();
        return BASE_PERSONAS.map(([id, name, icon]) => ({ id, name, icon })).concat((s.personas || []).filter(id => s.personaDefs[id]).map(id => ({ id: 'mk_' + id, name: s.personaDefs[id].name, icon: 'fa-solid ' + (s.personaDefs[id].icon || 'fa-user') })));
    };
    P.setPersona = function (id) {
        const p = this.personaList().find(x => x.id === id) || this.personaList()[0];
        this.activePersona = p.id;
        const label = document.getElementById('persona-label'), icon = document.getElementById('persona-icon');
        if (label) label.innerText = p.name;
        if (icon) icon.className = p.icon;
        this.showToast(`تم تعيين وضع المساعد: ${p.name} 🎭`, 'info');
        return p.id;
    };
    P.cyclePersona = function () {
        const list = this.personaList();
        const i = list.findIndex(p => p.id === this.activePersona);
        return this.setPersona(list[(i + 1) % list.length].id);
    };

    // ------------------------------------------------------------------ CHAT PAYLOAD HOOK
    const COT_PROMPT = 'VISIBLE REASONING: before the final answer, think step by step inside <think>…</think> (numbered steps, concise). Then write the answer normally outside the tags.';
    P.transformChatPayload = async function (payload, session, { autoContinuePass = 0, assistantMsgId } = {}) {
        const s = this.getAISettings();
        let out = payload;
        // #18 — replace summarised turns with the summary (keeps the recent ones verbatim)
        if (session && session.summary && session.summaryUpTo) {
            const turns = (session.messages || []).filter(m => (m.role === 'user' || m.role === 'assistant') && m.id !== assistantMsgId);
            const k = turns.findIndex(m => m.id === session.summaryUpTo) + 1;
            if (k > 0 && k < turns.length && out.length > k) out = [out[0], { role: 'system', content: `Summary of the earlier part of this conversation:\n${session.summary}` }, ...out.slice(1 + k)];
        }
        const extra = [];
        if (s.cot && !autoContinuePass) extra.push(COT_PROMPT);
        if (s.memory && !autoContinuePass) {
            const q = [...(session.messages || [])].reverse().find(m => m.role === 'user');
            const mem = q ? await this.aiQuiet('memoryContext', String(q.content || '').slice(0, 2000)) : '';
            if (mem) extra.push(mem);
        }
        if (s.standards) { const std = await this.aiQuiet('standardsPromptText'); if (std) extra.push(std); }
        if (extra.length && out[0] && out[0].role === 'system') out = [{ ...out[0], content: out[0].content + '\n\n' + extra.join('\n\n') }, ...out.slice(1)];
        return out;
    };

    // ------------------------------------------------------------------ REPLY HOOK: <think>, follow-ups, memory, auto-summary
    /** Strip <think>…</think> blocks printed in the answer → { reasoning, content }. */
    P.splitThinkingText = function (content) {
        const parts = [];
        const rest = String(content || '').replace(/<(think|thinking|reasoning)>([\s\S]*?)(<\/\1>|$)/gi, (_, __, body) => { parts.push(body.trim()); return ''; });
        return parts.length ? { reasoning: parts.join('\n\n'), content: rest.replace(/^\s+/, '') } : { reasoning: '', content: String(content || '') };
    };
    /** #19 — instant, free follow-up suggestions derived from the reply's shape. */
    P.localFollowups = function (reply, question = '') {
        const r = String(reply || ''), en = !/[\u0600-\u06FF]/.test(question || r.slice(0, 400));
        const L = (ar, e) => (en ? e : ar);
        const out = [];
        if (/```/.test(r)) out.push(L('اشرح هذا الكود سطراً بسطر', 'Explain this code line by line'), L('اكتب اختبارات لهذا الكود', 'Write tests for this code'), L('كيف أحسّن أداءه؟', 'How can I make it faster?'));
        if (/```mermaid|معمار|architecture/i.test(r)) out.unshift(L('حوّل هذا التصميم إلى هيكل مشروع وكود', 'Turn this design into project code'));
        if (/error|exception|خطأ|استثناء/i.test(question)) out.unshift(L('ما السبب الجذري وكيف أتجنبه مستقبلاً؟', 'What is the root cause and how do I prevent it?'));
        if (/^\s*(\d+\.|[-*])\s/m.test(r)) out.push(L('فصّل الخطوة الأولى أكثر', 'Expand on the first step'));
        out.push(L('أعطني مثالاً عملياً', 'Give me a practical example'), L('لخّص ذلك في 3 نقاط', 'Summarize in 3 bullet points'), L('ما البدائل الممكنة؟', 'What are the alternatives?'));
        return Array.from(new Set(out)).slice(0, 3);
    };
    P.renderFollowups = function (sessionId, qs) {
        this._followups = qs && qs.length ? { sessionId, qs } : null;
        let el = document.getElementById('ai-followups');
        if (!el) {
            const anchor = document.getElementById('session-mode-badge');
            if (!anchor || !anchor.parentNode) return false;
            el = document.createElement('div');
            el.id = 'ai-followups'; el.className = 'ai-followups'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'أسئلة متابعة مقترحة');
            el.addEventListener('click', (e) => { const b = e.target.closest('[data-fu]'); if (b && this._followups) { const q = this._followups.qs[+b.dataset.fu]; this.renderFollowups(null, []); this.sendQuickPrompt(q); } });
            anchor.parentNode.insertBefore(el, anchor);
        }
        const show = this._followups && this._followups.sessionId === this.activeSessionId;
        el.innerHTML = show ? qs.map((q, i) => `<button class="ai-fu" data-fu="${i}"><i class="fa-solid fa-reply"></i> ${esc(q)}</button>`).join('') : '';
        el.style.display = show ? '' : 'none';
        return !!show;
    };
    const _origReply = P.handleReplyComplete;
    P.handleReplyComplete = function (info) {
        const r = _origReply ? _origReply.apply(this, arguments) : false;
        try { this.aiAfterReply(info || {}); } catch (e) { console.warn('ai reply hook', e); }
        return r;
    };
    P.aiAfterReply = function (info) {
        const session = (this.sessions || []).find(x => x.id === info.sessionId);
        if (!session) return false;
        const m = session.messages.find(x => x.id === info.messageId) || [...session.messages].reverse().find(x => x.role === 'assistant');
        if (!m || m.role !== 'assistant') return false;
        if (/<(think|thinking|reasoning)>/i.test(m.content || '')) {
            const t = this.splitThinkingText(m.content);
            m.reasoning = [m.reasoning, t.reasoning].filter(Boolean).join('\n\n');
            m.content = t.content;
            this.saveSessions();
            if (info.sessionId === this.activeSessionId) setTimeout(() => this.renderMessages(), 0);
        }
        const s = this.getAISettings();
        const q = [...session.messages].reverse().find(x => x.role === 'user');
        if (info.sessionId === this.activeSessionId && s.followups !== 'off') {
            if (s.followups === 'ai') this.aiQuiet('aiFollowups', session.id);
            else this.renderFollowups(session.id, this.localFollowups(m.content, q && q.content));
        }
        if (s.memory) this.aiQuiet('captureMemory', session);
        const turns = session.messages.filter(x => x.role === 'user' || x.role === 'assistant').length;
        if (s.autoSummarize && turns >= s.summarizeAt && turns - (session.summaryTurns || 0) >= 10 && this.settings.apiKey) {
            session.summaryTurns = turns;
            this.aiQuiet('summarizeSession', session.id);
        }
        return true;
    };
    const _origRender = P.renderMessages;
    P.renderMessages = function () {
        const r = _origRender.apply(this, arguments);
        if (this._followups && this._followups.sessionId !== this.activeSessionId) this.renderFollowups(null, []);
        return r;
    };

    // ------------------------------------------------------------------ AGENT MODE IN CHAT (#4)
    const _origSend = P.sendUserMessage;
    P.sendUserMessage = async function (forcedText = null) {
        if (this._followups) this.renderFollowups(null, []);
        this.hideGhost();
        if (this.isAutonomousAgentActive && !(this.currentAttachments || []).length) {
            const input = document.getElementById('user-input');
            const text = forcedText !== null && forcedText !== undefined ? String(forcedText) : (input ? input.value.trim() : '');
            if (text) {
                if (input && forcedText == null) { input.value = ''; if (this.autoResizeTextarea) this.autoResizeTextarea(input); }
                return this.aiLab('runAgentInChat', text);
            }
        }
        return _origSend.apply(this, arguments);
    };

    // ------------------------------------------------------------------ AUTOCOMPLETE (#31) — ghost suggestion, Tab to accept
    P.hideGhost = function () { const g = document.getElementById('ai-ghost'); if (g) { g.style.display = 'none'; g.textContent = ''; } this._ghost = ''; };
    P.bindAutocomplete = function () {
        const input = document.getElementById('user-input');
        if (!input || input.__oxAC) return !!input;
        input.__oxAC = true;
        let t = null, ctl = null;
        input.addEventListener('input', () => {
            this.hideGhost();
            clearTimeout(t);
            if (!this.getAISettings().autocomplete) return;
            const v = input.value;
            if (v.trim().length < 6 || v.startsWith('/') || input.selectionStart !== v.length) return;
            t = setTimeout(async () => {
                if (ctl) ctl.abort();
                ctl = new AbortController();
                const sug = await this.aiQuiet('aiComplete', v, { signal: ctl.signal });
                if (!sug || input.value !== v || document.activeElement !== input) return;
                this.showGhost(sug);
            }, 700);
        });
        input.addEventListener('keydown', (e) => {
            if (!this._ghost) return;
            if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); this.acceptGhost(); }
            else if (e.key === 'Escape') this.hideGhost();
        });
        input.addEventListener('blur', () => setTimeout(() => this.hideGhost(), 150));
        return true;
    };
    P.showGhost = function (text) {
        const input = document.getElementById('user-input');
        if (!input) return false;
        let g = document.getElementById('ai-ghost');
        if (!g) {
            g = document.createElement('div');
            g.id = 'ai-ghost'; g.className = 'ai-ghost'; g.setAttribute('aria-live', 'polite');
            g.addEventListener('mousedown', (e) => { e.preventDefault(); this.acceptGhost(); });
            input.parentNode.insertBefore(g, input);
        }
        this._ghost = text;
        g.innerHTML = `<span class="ai-ghost-k">Tab ↹</span> <span class="ai-ghost-t" dir="auto">…${esc(input.value.slice(-30))}<b>${esc(text)}</b></span>`;
        g.style.display = '';
        return true;
    };
    P.acceptGhost = function () {
        const input = document.getElementById('user-input');
        if (!input || !this._ghost) return false;
        const needSpace = /\S$/.test(input.value) && /^[\w\u0600-\u06FF]/.test(this._ghost) && !/^\s/.test(this._ghost) && !/[\w\u0600-\u06FF]$/.test(input.value) ? ' ' : '';
        input.value += needSpace + this._ghost;
        input.dispatchEvent(new Event('input'));
        this.hideGhost();
        input.focus();
        return true;
    };

    // ------------------------------------------------------------------ AI HUB ENTRY + PALETTE + SHORTCUTS
    const _origHub = P.renderAIHub;
    if (_origHub) {
        P.renderAIHub = function () {
            const r = _origHub.apply(this, arguments);
            const body = document.getElementById('ai-hub-body');
            if (body && !body.querySelector('.ai-hub-lab')) body.insertAdjacentHTML('afterbegin', `<div class="ai-hub-lab"><button class="btn-new-thread gh-btn" onclick="app.closeModals(); app.openAILab()"><i class="fa-solid fa-flask"></i> مختبر الذكاء الاصطناعي</button><span>مولدات الكود والمشاريع، الوكيل الذاتي، الذاكرة، شجرة الأفكار، مكتبة البرومبتات والشخصيات — <kbd>Alt+L</kbd></span></div>`);
            return r;
        };
    }
    const _origPalette = P.buildPaletteCommands;
    if (_origPalette) {
        P.buildPaletteCommands = function () {
            const self = this, S = 'مختبر الذكاء';
            const go = (tab, arg) => () => self.openAILab(tab, arg);
            return _origPalette.apply(this, arguments).concat([
                { section: S, icon: 'fa-flask', label: 'مختبر الذكاء الاصطناعي', hint: 'Alt+L', run: go('generators') },
                { section: S, icon: 'fa-wand-magic-sparkles', label: 'مولدات الكود (API، أنظمة، DevOps، واجهات)', hint: 'Generators', run: go('generators') },
                { section: S, icon: 'fa-robot', label: 'الوكيل الذاتي ReAct', hint: 'Alt+A', run: go('agent') },
                { section: S, icon: 'fa-code-branch', label: 'شجرة الأفكار — 3 مسارات متوازية', hint: 'ToT', run: () => { self._thinkTech = 'tot'; self.openAILab('think'); } },
                { section: S, icon: 'fa-arrows-spin', label: 'تحسين ذاتي للإجابة ×3', hint: 'Refine', run: () => { self._thinkTech = 'refine'; self.openAILab('think'); } },
                { section: S, icon: 'fa-database', label: 'الذاكرة طويلة المدى', hint: 'Memory', run: go('memory') },
                { section: S, icon: 'fa-book-bookmark', label: 'مكتبة البرومبتات والشخصيات', hint: 'Alt+P', run: go('library') },
                { section: S, icon: 'fa-microscope', label: 'تحليل الكود محلياً (Big-O، تسريب، N+1)', hint: 'Offline', run: go('local', 'code') },
                { section: S, icon: 'fa-cubes', label: 'طبيب الاعتماديات (غير المستخدمة والتحديثات)', hint: 'Deps', run: go('local', 'deps') },
                { section: S, icon: 'fa-image', label: 'صورة تصميم إلى كود', hint: 'Vision', run: () => self.openVisionTool('image') },
                { section: S, icon: 'fa-microphone-lines', label: 'الوكيل الصوتي', hint: 'Voice', run: () => self.startVoiceAgent() },
                { section: S, icon: 'fa-user-tie', label: 'المسار المهني (سيرة، مقابلات، شهادات)', hint: 'Career', run: go('career') },
                { section: S, icon: 'fa-microchip', label: 'مستكشف النماذج حسب السعر والسرعة', hint: 'Models', run: go('models') },
                { section: S, icon: 'fa-compress', label: 'لخّص المحادثة الطويلة', hint: 'Summary', run: () => self.summarizeSession(self.activeSessionId, { quiet: false }) }
            ]);
        };
    }
    P.initSprint8AI = function () {
        const s = this.getAISettings();
        (s.personas || []).forEach(id => { const d = s.personaDefs[id]; if (d) this.registerPersona({ id, ...d }); });
        if (s.autocomplete) this.bindAutocomplete();
        window.addEventListener('keydown', (e) => {
            const ctrl = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();
            if (!e.altKey || ctrl || e.shiftKey) return;
            if (k === 'l') { e.preventDefault(); this.openAILab(); }
            else if (k === 'p') { e.preventDefault(); this.openAILab('library'); }
            else if (k === 'a') { e.preventDefault(); this.openAILab('agent'); }
        });
        if (this.BUILTIN_SHORTCUTS && !this.BUILTIN_SHORTCUTS.some(x => x[0] === 'Alt+L')) this.BUILTIN_SHORTCUTS.push(['Alt+L', 'مختبر الذكاء'], ['Alt+P', 'مكتبة البرومبتات'], ['Alt+A', 'الوكيل الذاتي']);
    };
    if (window.app) {
        try { window.app.initSprint8AI(); } catch (e) { console.error('Sprint 8 AI init failed', e); }
    }
})();
