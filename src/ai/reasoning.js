/* Reasoning techniques: visible Chain-of-Thought (#14), Tree-of-Thought with 3 parallel paths (#15),
   Self-Refine ×3 (#17), long-conversation summarisation (#18), AI follow-up questions (#19). */
import { esc, extractJSON, clamp } from './shared.js';

/** Parse "Step 1: … / 1. … / ### Step" lines into steps (CoT view). */
export function parseSteps(text) {
    const s = String(text || '');
    const j = extractJSON(s);
    if (j && Array.isArray(j.steps)) return { steps: j.steps.map(x => (typeof x === 'string' ? { title: x, detail: '' } : { title: x.title || x.step || '', detail: x.detail || x.reasoning || '' })), answer: j.answer || j.final || '' };
    const lines = s.split('\n');
    const steps = [];
    let answer = '', inAnswer = false;
    for (const raw of lines) {
        const l = raw.trim();
        const am = /^(?:#+\s*)?(?:\*\*)?(?:final answer|answer|الإجابة النهائية|الجواب|الخلاصة)(?:\*\*)?\s*[:：]\s*(.*)$/i.exec(l);
        if (am) { inAnswer = true; answer = am[1]; continue; }
        if (inAnswer) { answer += (answer ? '\n' : '') + raw; continue; }
        const m = /^(?:#+\s*)?(?:\*\*)?(?:step|الخطوة|خطوة)\s*(\d+)(?:\*\*)?\s*[:.)\-–]\s*(.*)$/i.exec(l) || /^(\d+)[.)]\s+(.*)$/.exec(l);
        if (m) steps.push({ title: m[2].replace(/\*\*/g, ''), detail: '' });
        else if (steps.length && l) steps[steps.length - 1].detail += (steps[steps.length - 1].detail ? '\n' : '') + raw;
    }
    return { steps, answer: answer.trim() };
}

/** Judge output → { best: 0..2, scores: [...] } (robust to prose). */
export function parseJudge(text, n = 3) {
    const j = extractJSON(text);
    if (j && Number.isFinite(+j.best)) return { best: clamp(Math.round(+j.best) - 1, 0, n - 1), scores: Array.isArray(j.scores) ? j.scores.map(Number) : [], reason: j.reason || '', synthesis: j.synthesis || '' };
    const m = /(?:best|الأفضل)[^\d]{0,20}([1-9])/i.exec(String(text || ''));
    return { best: m ? clamp(+m[1] - 1, 0, n - 1) : 0, scores: [], reason: String(text || '').slice(0, 400), synthesis: '' };
}

const APPROACHES = [
    { name: 'المسار أ: مباشر وعملي', nudge: 'Approach: the most direct, pragmatic solution. Prefer simplicity.' },
    { name: 'المسار ب: من المبادئ الأولى', nudge: 'Approach: reason from first principles; question assumptions; consider edge cases thoroughly.' },
    { name: 'المسار ج: إبداعي/بديل', nudge: 'Approach: explore an unconventional or alternative angle that others might miss.' }
];

export function installReasoning(P) {
    P.parseSteps = parseSteps;
    P.parseJudge = parseJudge;

    P.renderThinkTab = function (root) {
        const t = this._thinkTech || 'tot';
        const techs = [['tot', 'fa-code-branch', 'شجرة الأفكار ToT (3 مسارات)'], ['refine', 'fa-arrows-spin', 'تحسين ذاتي ×3'], ['cot', 'fa-shoe-prints', 'تفكير مرئي خطوة بخطوة']];
        root.innerHTML = `<div class="ai-chips">${techs.map(([id, icon, label]) => `<button class="fx-link ${t === id ? 'active' : ''}" onclick="app._thinkTech='${id}'; app.openAILab('think')"><i class="fa-solid ${icon}"></i> ${label}</button>`).join('')}</div>
            <label class="ai-field"><span>المسألة / السؤال</span><textarea id="think-q" class="form-input-box" rows="4" dir="auto" placeholder="مثال: صمّم نظام تخزين مؤقت لتطبيق يقرأ كثيراً ويكتب قليلاً">${esc(this._thinkQ || '')}</textarea></label>
            <div class="gh-toolbar"><button class="btn-new-thread gh-btn" onclick="app.runThinkFromTab()"><i class="fa-solid fa-brain"></i> فكّر</button><button class="sidebar-btn-util gh-btn" onclick="app.stopAI()"><i class="fa-solid fa-stop"></i> إيقاف</button></div>
            <div id="think-out" class="ai-output" aria-live="polite"></div>`;
    };
    P.runThinkFromTab = function () {
        const q = (document.getElementById('think-q') || {}).value || '';
        this._thinkQ = q;
        if (!q.trim()) return null;
        const t = this._thinkTech || 'tot';
        return t === 'refine' ? this.selfRefine(q) : t === 'cot' ? this.chainOfThought(q) : this.treeOfThought(q);
    };

    /** #15 — three independent reasoning paths in parallel, then a judge picks / synthesises. */
    P.treeOfThought = async function (question, { target = 'think-out' } = {}) {
        const out = () => document.getElementById(target);
        const live = ['', '', ''];
        const paint = (judge) => {
            const el = out();
            if (!el) return;
            el.innerHTML = `<div class="ai-tot">${APPROACHES.map((a, i) => `<div class="ai-tot-path ${judge && judge.best === i ? 'best' : ''}" data-path="${i}"><h5>${a.name}${judge && judge.best === i ? ' 🏆' : ''}${judge && judge.scores[i] != null ? ` <span class="ai-badge">${judge.scores[i]}/10</span>` : ''}</h5><div class="gh-md">${live[i] ? (this.renderMarkdownSafe ? this.renderMarkdownSafe(live[i]) : esc(live[i])) : '<i class="fa-solid fa-spinner fa-spin"></i>'}</div></div>`).join('')}</div>${judge ? `<div class="ai-judge"><h4>⚖️ الحكم</h4><p dir="auto">${esc(judge.reason)}</p>${judge.synthesis ? `<div class="gh-md">${this.renderMarkdownSafe ? this.renderMarkdownSafe(judge.synthesis) : esc(judge.synthesis)}</div>` : ''}</div>` : ''}`;
        };
        paint();
        this._aiAbort = new AbortController();
        const signal = this._aiAbort.signal;
        const results = await Promise.all(APPROACHES.map((a, i) => this.aiRun(question, {
            system: `Think step by step, then give a clear final answer. ${a.nudge} Answer in the user's language.`, kind: 'reasoning', maxTokens: 2000, signal, source: 'tot', quiet: i > 0,
            onDelta: (c) => { live[i] = c; paint(); }
        }).catch(e => `⚠️ ${e.message}`)));
        if (results.some(r => r == null)) return null;
        results.forEach((r, i) => { live[i] = r; });
        const jt = await this.aiRun(`Question:\n${question}\n\n${results.map((r, i) => `=== Path ${i + 1} ===\n${String(r).slice(0, 5000)}`).join('\n\n')}\n\nEvaluate the 3 paths for correctness, completeness and practicality. JSON only: {"best": 1-3, "scores": [0-10, 0-10, 0-10], "reason": "short, user's language", "synthesis": "the best final answer combining the strongest ideas (Markdown)"}`, { kind: 'reasoning', maxTokens: 2500, signal, source: 'tot-judge' });
        const judge = parseJudge(jt || '');
        paint(judge);
        this._aiOut = `${judge.synthesis || results[judge.best]}`;
        this._aiOutTitle = 'شجرة الأفكار';
        const el = out();
        if (el) el.insertAdjacentHTML('beforeend', `<div class="gh-toolbar"><button class="sidebar-btn-util gh-btn" onclick="app.aiSendToChat()"><i class="fa-solid fa-comment"></i> إلى المحادثة</button></div>`);
        return { paths: results, judge };
    };

    /** #17 — draft → critique → improve, up to 3 rounds (stops early when the critic finds nothing). */
    P.selfRefine = async function (question, { rounds = 3, target = 'think-out', draft } = {}) {
        const el = () => document.getElementById(target);
        const log = [];
        const paint = (live = '') => {
            const e = el();
            if (e) e.innerHTML = `<ol class="ai-refine">${log.map(s => `<li class="${s.kind}"><b>${s.label}</b><div class="gh-md">${this.renderMarkdownSafe ? this.renderMarkdownSafe(s.text) : esc(s.text)}</div></li>`).join('')}${live ? `<li class="live"><div class="gh-md">${this.renderMarkdownSafe ? this.renderMarkdownSafe(live) : esc(live)}</div></li>` : ''}</ol>`;
        };
        this._aiAbort = new AbortController();
        const signal = this._aiAbort.signal;
        let answer = draft || await this.aiRun(question, { kind: 'reasoning', maxTokens: 2500, signal, source: 'refine', onDelta: paint });
        if (answer == null) return null;
        log.push({ kind: 'draft', label: '📝 المسودة الأولى', text: answer });
        paint();
        let i = 0;
        for (; i < clamp(rounds, 1, 3); i++) {
            const critique = await this.aiRun(`Question:\n${question}\n\nAnswer:\n${answer}\n\nCritique this answer harshly: factual errors, bugs, missing cases, unclear parts. List concrete issues. If there is nothing meaningful to improve, reply exactly NO_ISSUES.`, { kind: 'reasoning', maxTokens: 1200, signal, source: 'refine-critic', onDelta: paint });
            if (critique == null) break;
            if (/^\s*NO_ISSUES\s*$/i.test(critique) || /NO_ISSUES/.test(critique.slice(0, 40))) { log.push({ kind: 'ok', label: `✅ الجولة ${i + 1}: لا ملاحظات إضافية`, text: '' }); break; }
            log.push({ kind: 'critique', label: `🔍 نقد الجولة ${i + 1}`, text: critique });
            paint();
            const improved = await this.aiRun(`Question:\n${question}\n\nPrevious answer:\n${answer}\n\nReviewer issues:\n${critique}\n\nRewrite the complete answer fixing every issue. Output only the improved answer.`, { kind: 'reasoning', maxTokens: 3000, signal, source: 'refine', onDelta: paint });
            if (improved == null) break;
            answer = improved;
            log.push({ kind: 'improved', label: `✨ النسخة ${i + 2}`, text: answer });
            paint();
        }
        this._aiOut = answer;
        this._aiOutTitle = 'تحسين ذاتي';
        const e = el();
        if (e) e.insertAdjacentHTML('beforeend', `<div class="gh-toolbar"><button class="sidebar-btn-util gh-btn" onclick="app.aiSendToChat()"><i class="fa-solid fa-comment"></i> إلى المحادثة</button><button class="sidebar-btn-util gh-btn" onclick="app.copyToClipboard(app._aiOut)"><i class="fa-solid fa-copy"></i> نسخ</button></div>`);
        return { answer, log, rounds: log.filter(s => s.kind === 'improved').length };
    };

    /** #14 — explicit numbered reasoning rendered as a timeline. */
    P.chainOfThought = async function (question, { target = 'think-out' } = {}) {
        const el = () => document.getElementById(target);
        const paint = (text, done) => {
            const e = el();
            if (!e) return;
            const { steps, answer } = parseSteps(text);
            e.innerHTML = `<ol class="ai-cot">${steps.map((s, i) => `<li style="--i:${i}"><b>${esc(s.title)}</b>${s.detail ? `<div class="gh-md">${this.renderMarkdownSafe ? this.renderMarkdownSafe(s.detail) : esc(s.detail)}</div>` : ''}</li>`).join('')}</ol>${answer ? `<div class="ai-judge"><h4>🎯 الإجابة النهائية</h4><div class="gh-md">${this.renderMarkdownSafe ? this.renderMarkdownSafe(answer) : esc(answer)}</div></div>` : ''}${!done && !steps.length ? '<i class="fa-solid fa-spinner fa-spin"></i>' : ''}`;
        };
        this._aiAbort = new AbortController();
        const text = await this.aiRun(question, {
            system: 'Solve the problem with explicit reasoning. Format strictly as:\nStep 1: <short title>\n<explanation>\nStep 2: ...\n...\nFinal answer: <answer>\nUse the user\'s language.', kind: 'reasoning', maxTokens: 3000, signal: this._aiAbort.signal, source: 'cot',
            onDelta: (c) => paint(c)
        });
        if (text == null) return null;
        paint(text, true);
        this._aiOut = text;
        this._aiOutTitle = 'تفكير خطوة بخطوة';
        return parseSteps(text);
    };

    /** #18 — summarise everything before the last `keep` messages into session.summary. */
    P.summarizeSession = async function (sessionId = this.activeSessionId, { keep = 6, quiet = true } = {}) {
        const s = (this.sessions || []).find(x => x.id === sessionId);
        if (!s) return null;
        const msgs = (s.messages || []).filter(m => (m.role === 'user' || m.role === 'assistant') && m.content);
        if (msgs.length <= keep + 2) return null;
        const upto = msgs[msgs.length - keep - 1];
        const older = msgs.slice(0, msgs.length - keep);
        const transcript = older.map(m => `${m.role.toUpperCase()}: ${String(m.content).slice(0, 1500)}`).join('\n\n').slice(-30000);
        const prev = s.summary ? `Previous summary:\n${s.summary}\n\n` : '';
        const text = await this.aiRun(`${prev}Summarise this conversation so it can replace the old messages as context: goals, decisions, facts, code/file names, open questions and user preferences. Bullet points, same language as the conversation, max 250 words.\n\n${transcript}`, { kind: 'writing', maxTokens: 900, quiet, source: 'summary' });
        if (!text) return null;
        s.summary = text.trim();
        s.summaryUpTo = upto.id;
        s.summaryAt = Date.now();
        this.saveSessions();
        if (!quiet) this.showToast('📝 تم تلخيص المحادثة — سيُرسل الملخص بدل الرسائل القديمة', 'success');
        if (this.renderSummaryChip) this.renderSummaryChip();
        return s.summary;
    };

    /** #19 — model-generated follow-ups (used when settings.followups === 'ai'). */
    P.aiFollowups = async function (sessionId = this.activeSessionId) {
        const s = (this.sessions || []).find(x => x.id === sessionId);
        if (!s) return [];
        const msgs = s.messages.filter(m => m.content && (m.role === 'user' || m.role === 'assistant')).slice(-4);
        if (!msgs.length) return [];
        const j = await this.aiJSON(`Given this conversation, suggest 3 short, specific follow-up questions the USER might ask next (same language as the user, max 12 words each). JSON: {"questions": ["...", "...", "..."]}\n\n${msgs.map(m => `${m.role}: ${String(m.content).slice(0, 1200)}`).join('\n\n')}`, { kind: 'chat', maxTokens: 300, quiet: true, source: 'followups' });
        const qs = (j && Array.isArray(j.questions) ? j.questions : Array.isArray(j) ? j : []).map(String).filter(Boolean).slice(0, 3);
        if (qs.length && this.renderFollowups) this.renderFollowups(sessionId, qs);
        return qs;
    };
}
