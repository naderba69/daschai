/* Autonomous ReAct agent (#4) and long-term vector memory in IndexedDB (#5). */
import { esc, extractJSON, uid, clamp, isSafePath } from './shared.js';

// ------------------------------------------------------------------ TF-IDF VECTOR MEMORY (#5)
const STOP = new Set('the a an and or of to in on for is are was were be it this that with as at by from في من على إلى الى عن مع هذا هذه ذلك التي الذي هو هي ما لا لم أن ان كان كانت ثم أو او و يا قد كل'.split(' '));
export function tokenize(text) {
    return String(text || '').toLowerCase()
        .replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
        .split(/[^\p{L}\p{N}_]+/u).filter(w => w.length > 1 && !STOP.has(w))
        .map(w => (/^ال[\u0600-\u06FF]{3,}/.test(w) ? w.slice(2) : w));
}
export const termFreq = (tokens) => { const tf = {}; tokens.forEach(t => { tf[t] = (tf[t] || 0) + 1; }); return tf; };
/** Rank docs [{id, text, tf}] against a query with TF-IDF cosine similarity. */
export function rankMemories(docs, query, k = 3) {
    const q = termFreq(tokenize(query));
    const qTerms = Object.keys(q);
    if (!qTerms.length || !docs.length) return [];
    const N = docs.length, df = {};
    docs.forEach(d => Object.keys(d.tf || {}).forEach(t => { df[t] = (df[t] || 0) + 1; }));
    const idf = (t) => Math.log(1 + N / (1 + (df[t] || 0)));
    const qv = {}; let qn = 0;
    qTerms.forEach(t => { qv[t] = q[t] * idf(t); qn += qv[t] * qv[t]; });
    qn = Math.sqrt(qn) || 1;
    return docs.map(d => {
        let dot = 0, dn = 0;
        Object.entries(d.tf || {}).forEach(([t, n]) => { const w = n * idf(t); dn += w * w; if (qv[t]) dot += w * qv[t]; });
        return { doc: d, score: dot / ((Math.sqrt(dn) || 1) * qn) };
    }).filter(x => x.score > 0.05).sort((a, b) => b.score - a.score).slice(0, k);
}

// ------------------------------------------------------------------ AGENT TOOLS (#4)
export const AGENT_TOOLS = {
    list_files: 'List project files. args: {"filter": "optional substring"}',
    read_file: 'Read a project file. args: {"path": "src/a.js"}',
    search: 'Search text in all project files. args: {"query": "text or regex"}',
    write_file: 'Create/overwrite a file (staged; the user reviews before saving). args: {"path": "...", "content": "full content"}',
    run_js: 'Run JavaScript in the sandboxed runner and get console output. args: {"code": "console.log(1+1)"}',
    recall: 'Search long-term memory. args: {"query": "..."}',
    finish: 'Stop and give the final answer. args: {"answer": "Markdown summary for the user"}'
};
/** Parse one ReAct step from model output → { thought, tool, args } (JSON preferred; "Action:" lines as fallback). */
export function parseAgentStep(text) {
    const j = extractJSON(text);
    if (j && typeof j === 'object' && !Array.isArray(j) && (j.tool || j.action)) return { thought: String(j.thought || ''), tool: String(j.tool || j.action), args: j.args || j.input || {} };
    const t = /Thought:\s*([\s\S]*?)(?:\n(?:Action|Tool):|$)/i.exec(text || '');
    const a = /(?:Action|Tool):\s*(\w+)/i.exec(text || '');
    const i = /(?:Action Input|Args|Input):\s*([\s\S]+)/i.exec(text || '');
    if (a) { let args = {}; if (i) { args = extractJSON(i[1]) || {}; } return { thought: t ? t[1].trim() : '', tool: a[1], args }; }
    return { thought: '', tool: 'finish', args: { answer: String(text || '').trim() } };
}

export function installAgent(P) {
    P.tokenize = tokenize;
    P.rankMemories = rankMemories;
    P.parseAgentStep = parseAgentStep;
    P.AGENT_TOOLS = AGENT_TOOLS;

    // ================================================================== MEMORY
    const MEM_KEY = 'ai_memory_v1';
    P.loadMemories = async function () {
        if (this._memories) return this._memories;
        let list = [];
        try { list = (this.idbGet && (await this.idbGet(MEM_KEY))) || []; } catch (e) { /* no idb */ }
        this._memories = Array.isArray(list) ? list : [];
        return this._memories;
    };
    P.saveMemories = async function () { try { if (this.idbSet) await this.idbSet(MEM_KEY, this._memories || []); } catch (e) { /* quota */ } };
    P.addMemory = async function (text, { source = 'manual', sessionId = null, pinned = false } = {}) {
        text = String(text || '').trim();
        if (text.length < 4) return null;
        const list = await this.loadMemories();
        const tf = termFreq(tokenize(text));
        if (list.some(m => m.text === text)) return null;
        const m = { id: uid('mem'), text: text.slice(0, 2000), tf, source, sessionId, pinned, ts: Date.now() };
        list.unshift(m);
        // keep pinned + newest; cap 600
        if (list.length > 600) { const keep = list.filter(x => x.pinned).concat(list.filter(x => !x.pinned).slice(0, 600)); this._memories = keep.slice(0, 650); }
        await this.saveMemories();
        return m;
    };
    P.deleteMemory = async function (id) { const list = await this.loadMemories(); this._memories = list.filter(m => m.id !== id); await this.saveMemories(); return true; };
    P.searchMemories = async function (query, k = 5) { return rankMemories(await this.loadMemories(), query, k); };
    /** System-prompt block with the most relevant memories (used by transformChatPayload). */
    P.memoryContext = async function (query, k = 4) {
        const hits = await this.searchMemories(query, k);
        if (!hits.length) return '';
        return 'Relevant long-term memory about the user/project (use if helpful, do not mention it unless asked):\n' + hits.map(h => `- ${h.doc.text.replace(/\s+/g, ' ').slice(0, 400)}`).join('\n');
    };
    /** Auto-capture after a reply: explicit "remember …" requests + a compact Q/A trace. */
    P.captureMemory = async function (session) {
        if (!session) return 0;
        const msgs = session.messages.filter(m => m.content && (m.role === 'user' || m.role === 'assistant'));
        const lastU = [...msgs].reverse().find(m => m.role === 'user');
        const lastA = [...msgs].reverse().find(m => m.role === 'assistant');
        if (!lastU) return 0;
        let n = 0;
        const rm = /(?:^|\s)(?:تذكر|تذكّر|احفظ في ذاكرتك|remember(?: that)?)\s*[:،,]?\s*(.{4,500})/i.exec(lastU.content);
        if (rm && await this.addMemory(rm[1], { source: 'explicit', sessionId: session.id, pinned: true })) n++;
        if (lastA && String(lastU.content).length > 20 && await this.addMemory(`Q: ${String(lastU.content).slice(0, 300)}\nA: ${String(lastA.content).replace(/```[\s\S]*?```/g, '[code]').slice(0, 400)}`, { source: 'chat', sessionId: session.id })) n++;
        return n;
    };
    P.renderMemoryTab = async function (root) {
        const list = await this.loadMemories();
        const q = this._memQ || '';
        const shown = q ? (await this.searchMemories(q, 30)).map(h => ({ ...h.doc, score: h.score })) : list.slice(0, 60);
        const s = this.getAISettings();
        root.innerHTML = `<label class="ai-check"><input type="checkbox" ${s.memory ? 'checked' : ''} onchange="app.setAISettings({memory:this.checked})"> تفعيل الذاكرة طويلة المدى في المحادثات (تُحفظ محلياً في IndexedDB فقط)</label>
            <div class="gh-toolbar"><input id="mem-q" class="form-input-box" dir="auto" placeholder="ابحث دلالياً في ${list.length} ذكرى…" value="${esc(q)}" onkeydown="if(event.key==='Enter'){app._memQ=this.value; app.openAILab('memory')}"><button class="sidebar-btn-util gh-btn" onclick="app._memQ=document.getElementById('mem-q').value; app.openAILab('memory')"><i class="fa-solid fa-magnifying-glass"></i></button></div>
            <div class="gh-toolbar"><input id="mem-new" class="form-input-box" dir="auto" placeholder="أضف معلومة: أفضّل TypeScript و Tailwind…"><button class="btn-new-thread gh-btn" onclick="app.addMemory(document.getElementById('mem-new').value,{pinned:true}).then(()=>app.openAILab('memory'))"><i class="fa-solid fa-plus"></i> حفظ</button>
            <button class="sidebar-btn-util gh-btn" onclick="app.memorizeSessionSummaries()"><i class="fa-solid fa-file-import"></i> استيراد ملخصات المحادثات</button></div>
            <div class="ai-mem-list">${shown.map(m => `<div class="ai-finding" data-mem="${m.id}"><span class="ai-line">${m.pinned ? '📌' : m.source === 'chat' ? '💬' : '🧠'}${m.score ? ` ${(m.score * 100).toFixed(0)}%` : ''}</span><span dir="auto">${esc(m.text.slice(0, 300))}</span><button class="fx-link" onclick="app.deleteMemory('${m.id}').then(()=>app.openAILab('memory'))" aria-label="حذف"><i class="fa-solid fa-trash"></i></button></div>`).join('') || '<p class="gh-muted">لا ذكريات بعد.</p>'}</div>`;
    };
    P.memorizeSessionSummaries = async function () {
        let n = 0;
        for (const s of this.sessions || []) if (s.summary && await this.addMemory(`[${s.title || 'محادثة'}] ${s.summary}`, { source: 'summary', sessionId: s.id })) n++;
        this.showToast(n ? `🧠 أضيف ${n} ملخص للذاكرة` : 'لا ملخصات جديدة — لخّص المحادثات الطويلة أولاً', n ? 'success' : 'info');
        if (document.getElementById('ai-lab')) this.openAILab('memory');
        return n;
    };

    // ================================================================== REACT AGENT
    P.agentTool = async function (tool, args = {}, run) {
        const files = this.virtualProjectFiles;
        const content = (p) => (run.staged.has(p) ? run.staged.get(p) : files.has(p) ? files.get(p).content : null);
        switch (tool) {
            case 'list_files': {
                const all = Array.from(new Set([...files.keys(), ...run.staged.keys()])).sort();
                const f = String(args.filter || '').toLowerCase();
                const list = all.filter(p => !f || p.toLowerCase().includes(f));
                return list.length ? list.slice(0, 300).join('\n') + (list.length > 300 ? `\n… (+${list.length - 300})` : '') : '(no files)';
            }
            case 'read_file': {
                const c = content(String(args.path || ''));
                return c == null ? `ERROR: file not found: ${args.path}` : typeof c !== 'string' ? 'ERROR: binary file' : c.length > 9000 ? c.slice(0, 9000) + `\n… [truncated, ${c.length} chars]` : c;
            }
            case 'search': {
                const q = String(args.query || '');
                if (!q) return 'ERROR: empty query';
                let re;
                try { re = new RegExp(q, 'i'); } catch (e) { re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
                const hits = [];
                for (const p of new Set([...files.keys(), ...run.staged.keys()])) {
                    const c = content(p);
                    if (typeof c !== 'string') continue;
                    c.split('\n').forEach((l, i) => { if (hits.length < 40 && re.test(l)) hits.push(`${p}:${i + 1}: ${l.trim().slice(0, 160)}`); });
                }
                return hits.join('\n') || 'no matches';
            }
            case 'write_file': {
                const p = String(args.path || '').replace(/^\.?\//, '');
                if (!isSafePath(p)) return `ERROR: invalid path ${p}`;
                if (typeof args.content !== 'string') return 'ERROR: content must be a string';
                run.staged.set(p, args.content);
                return `staged ${p} (${args.content.split('\n').length} lines). The user will review it at the end.`;
            }
            case 'run_js': {
                const code = String(args.code || '');
                if (!code) return 'ERROR: empty code';
                const out = [];
                const writer = { line: (t, s) => out.push(String(s)), html: (t, h) => out.push(String(h).replace(/<[^>]+>/g, '')), clear: () => { out.length = 0; }, text: () => out.join('\n') };
                try {
                    const r = await this.studio('runCode', { code, path: 'agent-snippet.js', writer, record: false, footer: false, fixable: false, source: 'agent', timeout: 8000 });
                    const log = (r && r.logs) || out.join('\n');
                    return `${r && r.success ? 'OK' : 'FAILED'}${r && r.error ? ': ' + r.error : ''}\n${String(log).slice(0, 3000)}`;
                } catch (e) { return 'ERROR: ' + e.message; }
            }
            case 'recall': {
                const hits = await this.searchMemories(String(args.query || ''), 4);
                return hits.map(h => '- ' + h.doc.text.slice(0, 300)).join('\n') || 'nothing relevant';
            }
            default: return `ERROR: unknown tool "${tool}". Available: ${Object.keys(AGENT_TOOLS).join(', ')}`;
        }
    };
    /** Plan → act → observe loop (max 8 steps). onStep(step, run) is called after every step. */
    P.runAgent = async function (goal, { maxSteps = 8, onStep, auto = false } = {}) {
        goal = String(goal || '').trim();
        if (!goal) return null;
        if (!this.settings.apiKey) { this.showToast('يلزم مفتاح OpenRouter في الإعدادات', 'warning'); return null; }
        const run = { id: uid('run'), goal, steps: [], staged: new Map(), answer: '', status: 'running' };
        this._agentRun = run;
        this._aiAbort = new AbortController();
        const system = `You are an autonomous software agent working inside the user's project (in the browser). Use the ReAct loop: think, call ONE tool, read the observation, repeat. Verify your work (read files back, run code) before finishing.
Tools:\n${Object.entries(AGENT_TOOLS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}
Reply with JSON ONLY on each turn: {"thought": "short reasoning (user's language)", "tool": "<tool name>", "args": {...}}
Finish within ${maxSteps} steps. The final "finish" answer should summarise what you did and list staged files.`;
        const history = [{ role: 'system', content: system }, { role: 'user', content: `Goal: ${goal}\n\nProject has ${this.virtualProjectFiles.size} files${this.activeStudioFile ? `; active file: ${this.activeStudioFile}` : ''}.` }];
        maxSteps = clamp(maxSteps, 1, 8);
        for (let i = 0; i < maxSteps; i++) {
            if (this._aiAbort.signal.aborted) { run.status = 'stopped'; break; }
            const model = this.aiModelFor('coding');
            let r;
            try { r = await this.streamOpenRouter({ model, messages: history, signal: this._aiAbort.signal, maxTokens: 4000 }); } catch (e) { run.status = 'error'; run.error = e.message; break; }
            if (this.recordUsage) this.recordUsage({ model, usage: r.usage, promptChars: JSON.stringify(history).length, completionChars: (r.content || '').length, durationMs: r.durationMs, source: 'agent' });
            const step = parseAgentStep(r.content || '');
            step.n = i + 1;
            history.push({ role: 'assistant', content: r.content || '' });
            if (step.tool === 'finish') { run.answer = String(step.args.answer || step.thought || ''); step.observation = ''; run.steps.push(step); run.status = 'done'; if (onStep) onStep(step, run); break; }
            step.observation = await this.agentTool(step.tool, step.args || {}, run);
            run.steps.push(step);
            if (onStep) onStep(step, run);
            history.push({ role: 'user', content: `Observation (${step.tool}):\n${String(step.observation).slice(0, 9000)}${i === maxSteps - 2 ? '\n\nOnly one step left: call "finish" next.' : ''}` });
        }
        if (run.status === 'running') { run.status = 'done'; run.answer = run.answer || 'انتهت الخطوات المتاحة (8). راجع الخطوات والملفات المرحلية.'; }
        if (run.staged.size) {
            run.files = Array.from(run.staged, ([path, content]) => ({ path, content }));
            if (auto) await this.aiApplyFiles(run.files, { auto: true });
        }
        if (this.addXP) this.addXP(5, 'agent');
        return run;
    };
    P.renderAgentTab = function (root) {
        const run = this._agentRun;
        root.innerHTML = `<p class="gh-muted">الوكيل يخطط وينفذ ويتحقق ذاتياً على ملفات مشروعك (قراءة، بحث، كتابة مرحلية، تشغيل JavaScript) — حتى 8 خطوات. الملفات لا تُكتب إلا بعد موافقتك.</p>
            <label class="ai-field"><span>الهدف</span><textarea id="agent-goal" class="form-input-box" rows="3" dir="auto" placeholder="مثال: أضف دالة slugify في src/utils.js مع اختبار وتأكد أنها تعمل">${esc(run ? run.goal : '')}</textarea></label>
            <div class="gh-toolbar"><button class="btn-new-thread gh-btn" id="agent-run" onclick="app.startAgentFromTab()"><i class="fa-solid fa-robot"></i> تشغيل الوكيل</button><button class="sidebar-btn-util gh-btn" onclick="app.stopAI()"><i class="fa-solid fa-stop"></i> إيقاف</button></div>
            <div id="agent-out" class="ai-output">${run ? this.agentRunHTML(run) : ''}</div>`;
    };
    P.agentRunHTML = function (run) {
        const icon = { list_files: 'fa-folder-tree', read_file: 'fa-file-lines', search: 'fa-magnifying-glass', write_file: 'fa-file-pen', run_js: 'fa-play', recall: 'fa-brain', finish: 'fa-flag-checkered' };
        return `<ol class="ai-agent-steps">${run.steps.map(s => `<li data-tool="${esc(s.tool)}"><div class="ai-step-head"><i class="fa-solid ${icon[s.tool] || 'fa-gear'}"></i> <b>${s.n}. ${esc(s.tool)}</b> <code dir="ltr">${esc(JSON.stringify(s.args || {}).replace(/"content":"(?:[^"\\]|\\.){80,}"/, '"content":"…"').slice(0, 140))}</code></div>${s.thought ? `<div class="ai-thought">💭 ${esc(s.thought)}</div>` : ''}${s.observation ? `<details><summary>الملاحظة</summary><pre dir="ltr">${esc(String(s.observation).slice(0, 2500))}</pre></details>` : ''}</li>`).join('')}</ol>
            ${run.status === 'running' ? '<div class="ai-thinking"><i class="fa-solid fa-spinner fa-spin"></i> الوكيل يعمل…</div>' : ''}
            ${run.error ? `<div class="gh-card text-red">⚠️ ${esc(run.error)}</div>` : ''}
            ${run.answer ? `<div class="ai-judge"><h4>✅ النتيجة</h4><div class="gh-md">${this.renderMarkdownSafe ? this.renderMarkdownSafe(run.answer) : esc(run.answer)}</div></div>` : ''}
            ${run.staged && run.staged.size && run.status !== 'running' ? `<button class="btn-new-thread gh-btn" onclick="app.aiApplyFiles(app._agentRun.files, {title:'ملفات الوكيل'})"><i class="fa-solid fa-file-circle-check"></i> مراجعة وكتابة ${run.staged.size} ملف</button>` : ''}`;
    };
    P.startAgentFromTab = async function () {
        const goal = (document.getElementById('agent-goal') || {}).value || '';
        const paint = () => { const el = document.getElementById('agent-out'); if (el && this._agentRun) el.innerHTML = this.agentRunHTML(this._agentRun); };
        const p = this.runAgent(goal, { onStep: paint });
        setTimeout(paint, 0);
        const run = await p;
        paint();
        if (run && run.answer) { this._aiOut = run.answer; this._aiOutTitle = 'الوكيل الذاتي'; }
        return run;
    };
    /** Agent mode in the chat (navbar robot toggle): user message → ReAct run rendered as message steps. */
    P.runAgentInChat = async function (goal) {
        const session = (this.sessions || []).find(x => x.id === this.activeSessionId);
        if (!session || !String(goal || '').trim()) return null;
        const now = Date.now();
        session.messages.push({ id: 'msg_' + now + '_u', role: 'user', content: goal, timestamp: now });
        if (session.messages.length === 1) session.title = '🤖 ' + goal.slice(0, 34);
        const m = { id: 'msg_' + (now + 1) + '_a', role: 'assistant', content: '', reasoning: '', steps: [{ text: '🤖 الوكيل الذاتي (ReAct): تخطيط وتنفيذ وتحقق…', done: false }], status: 'streaming', startTime: now, timestamp: now, model: this.aiModelFor('coding') };
        session.messages.push(m);
        session.updatedAt = now;
        this.saveSessions();
        this.renderUIState();
        if (this.scrollToBottom) this.scrollToBottom(true);
        const short = (o) => JSON.stringify(o || {}).replace(/"content":"(?:[^"\\]|\\.)*"/, '"content":"…"').slice(0, 90);
        const run = await this.runAgent(goal, {
            onStep: (st) => {
                m.steps[m.steps.length - 1].done = true;
                m.steps.push({ text: `${st.n}. ${st.tool} ${st.tool !== 'finish' ? short(st.args) : ''}${st.thought ? ' — ' + st.thought.slice(0, 120) : ''}`, done: true });
                m.reasoning = (m.reasoning ? m.reasoning + '\n\n' : '') + `**${st.n}. ${st.tool}** ${st.thought || ''}${st.observation ? '\n```\n' + String(st.observation).slice(0, 600) + '\n```' : ''}`;
                this.renderMessages();
            }
        });
        m.steps.forEach(x => { x.done = true; });
        if (!run) { m.status = 'error'; m.content = '⚠️ تعذر تشغيل الوكيل (تحقق من مفتاح OpenRouter).'; }
        else {
            m.status = run.status === 'error' ? 'error' : 'completed';
            m.content = (run.answer || (run.error ? '⚠️ ' + run.error : '')) + (run.files && run.files.length ? `\n\n**📁 ملفات مرحلية (${run.files.length}):**\n${run.files.map(f => `- \`${f.path}\``).join('\n')}\n\nاضغط «مراجعة وكتابة» في مختبر الذكاء ← الوكيل لحفظها.` : '');
        }
        m.endTime = Date.now();
        this.saveSessions();
        this.renderUIState();
        if (run && run.files && run.files.length) this.aiApplyFiles(run.files, { title: 'ملفات الوكيل الذاتي' });
        return run;
    };
}
