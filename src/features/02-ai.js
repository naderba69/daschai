/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 2: AI Intelligence
   Ideas implemented (THOUSAND_IDEAS.md):
     #2 / #3   Multi-model arena (2–8 models streamed in parallel, Mega Arena) + voting
     #6        Local RAG over attached codebases (BM25, no data leaves the browser)
     #8        Smart Router v2 (task classification + model scoring)
     #9        Token & cost estimate before sending
     #10–#12   Router modes: economy / balanced / speed / quality
     #13       Model recommendation from arena voting history
     #16       Critic mode (second model reviews the last answer)
     #891–#900 Usage dashboard: tokens, cost, latency, per-model, budget alerts, CSV
   Extends OXAlphaApp.prototype; relies on hooks in src/app.js:
     pickSmartModel(), buildAttachmentContext(), onStreamPassComplete()
   ============================================================================== */
(function () {
    'use strict';
    if (typeof OXAlphaApp === 'undefined') return;
    const P = OXAlphaApp.prototype;
    const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

    // ------------------------------------------------------------------ HELPERS
    const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g;
    /** Rough, tokenizer-free estimate: Arabic script packs fewer chars per token than Latin. */
    const estimateTokens = (text) => {
        if (!text) return 0;
        const s = typeof text === 'string' ? text : JSON.stringify(text);
        const ar = (s.match(ARABIC_RE) || []).length;
        return Math.ceil(ar / 2.2 + (s.length - ar) / 3.8);
    };
    const fmtTokens = (n) => {
        n = Number(n) || 0;
        if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k';
        return String(Math.round(n));
    };
    const fmtUSD = (x) => {
        if (x === null || x === undefined || isNaN(x)) return '—';
        if (x === 0) return 'مجاني';
        if (x < 0.0001) return '<$0.0001';
        if (x < 0.01) return '$' + x.toFixed(4);
        if (x < 1) return '$' + x.toFixed(3);
        return '$' + x.toFixed(2);
    };
    const shortModel = (id) => String(id || '').split('/').pop().replace(/:free$/, ' (free)');
    P.estimateTokens = estimateTokens;
    P.formatTokens = fmtTokens;
    P.formatUSD = fmtUSD;

    P.persistSettings = function () {
        this.safeStorageSet('ox_alpha_settings_v2', JSON.stringify(this.settings));
    };

    P.getModelMeta = function (id) {
        return (this.availableModels || []).find(m => m.id === id) || null;
    };

    P.isFreeModel = function (id) {
        if (!id) return false;
        if (id.endsWith(':free') || id === 'openrouter/free') return true;
        const m = this.getModelMeta(id);
        return !!(m && m.pricing && m.pricing.prompt === 0 && m.pricing.completion === 0);
    };

    /** USD cost for a request, or null when pricing is unknown. */
    P.estimateCost = function (modelId, promptTokens, completionTokens) {
        if (this.isFreeModel(modelId)) return 0;
        const m = this.getModelMeta(modelId);
        if (!m || !m.pricing) return null;
        return (promptTokens || 0) * (m.pricing.prompt || 0) + (completionTokens || 0) * (m.pricing.completion || 0);
    };

    // ------------------------------------------------------------------ SMART ROUTER v2
    const ROUTER_MODES = {
        economy:  { label: 'اقتصادي', icon: 'fa-piggy-bank', desc: 'نماذج مجانية فقط' },
        balanced: { label: 'متوازن', icon: 'fa-scale-balanced', desc: 'أفضل نموذج مجاني مناسب للمهمة (افتراضي)' },
        speed:    { label: 'سريع', icon: 'fa-gauge-high', desc: 'أصغر وأسرع نموذج مناسب' },
        quality:  { label: 'جودة', icon: 'fa-gem', desc: 'أقوى نموذج متاح حتى لو كان مدفوعاً' }
    };
    const CATEGORIES = {
        vision:    { label: 'تحليل صورة 🖼️' },
        long:      { label: 'سياق طويل 📚' },
        reasoning: { label: 'تفكير عميق 🧠' },
        coding:    { label: 'برمجة 💻' },
        chat:      { label: 'محادثة عامة 💬' }
    };
    const RE_REASONING = /(حلل|حلّل|فكّر|فكر|استنتج|برهن|اثبت|أثبت|رياضيات|معادلة|خوارزمي|تعقيد|منطق|احتمال|استراتيجي|قارن بين|reason|prove|math|equation|algorithm|complexity|logic|probabilit|trade-?off|pourquoi|démontr|raisonn|calcul)/i;
    const RE_CODING = /(```|كود|برمج|دالة|دوال|كلاس|خطأ|أخطاء|اختبار|مستودع|مكتبة|واجهة برمجية|قاعدة بيانات|github|code|function|class|refactor|debug|bug|error|exception|stack ?trace|api|sql|regex|typescript|javascript|python|react|node|docker|deploy|test|compile|fonction|erreur|\.(js|ts|py|go|rs|java|php|tsx|jsx)\b)/i;
    // Curated priority per category (bonus when present in the live catalogue)
    const PREFERRED = {
        coding:    ['qwen/qwen3-coder:free', 'deepseek/deepseek-chat-v3.1:free', 'z-ai/glm-4.5-air:free', 'google/gemma-3-27b-it:free', 'meta-llama/llama-3.3-70b-instruct:free'],
        reasoning: ['deepseek/deepseek-r1:free', 'deepseek/deepseek-r1-0528:free', 'qwen/qwq-32b:free', 'z-ai/glm-4.5-air:free'],
        vision:    ['google/gemma-3-27b-it:free', 'openrouter/free', 'google/gemma-3-12b-it:free'],
        long:      ['qwen/qwen3-coder:free', 'openrouter/free', 'google/gemma-3-27b-it:free'],
        chat:      ['google/gemma-3-27b-it:free', 'meta-llama/llama-3.3-70b-instruct:free', 'z-ai/glm-4.5-air:free', 'openrouter/free']
    };
    const RE_NON_CHAT = /(embed|tts|whisper|dall-?e|image-gen|moderation|guard|rerank|audio|lyria|veo|imagen)/i;
    const RE_VISION_ID = /(gemma-3|vision|-vl|vl-|gpt-4o|gpt-4\.1|gpt-5|claude|gemini|llama-4|pixtral|qwen2\.5-vl|qwen-vl|grok-4|openrouter\/free)/i;
    const RE_REASON_ID = /(r1|\/o1|\/o3|\/o4|thinking|reason|qwq|magistral)/i;
    const RE_CODE_ID = /(coder|code|devstral|codestral|qwen3|deepseek|claude|gpt-4|gpt-5|kimi|glm-4)/i;
    const RE_SPEED_ID = /(nano|mini|flash|lite|haiku|small|\b[1-9]b\b|-[1-9]b|12b|tiny)/i;
    const RE_QUALITY_ID = /(claude|gpt-4o|gpt-4\.1|gpt-5|gemini-(1\.5|2\.0|2\.5)-pro|405b|70b|r1|\/o1|\/o3|opus|sonnet|grok-4|kimi-k2)/i;

    P.getRouterMode = function () {
        return ROUTER_MODES[this.settings.routerMode] ? this.settings.routerMode : 'balanced';
    };

    P.setRouterMode = function (mode) {
        if (!ROUTER_MODES[mode]) return;
        this.settings.routerMode = mode;
        this.persistSettings();
        if (!this.isSmartRouterActive) this.toggleSmartRouter();
        this.showToast(`وضع الموجّه: ${ROUTER_MODES[mode].label} — ${ROUTER_MODES[mode].desc}`, 'success');
        this.updateTokenEstimate();
        if (document.getElementById('ai-hub-modal')?.classList.contains('active')) this.renderAIHub();
    };

    P.classifyTask = function (lastMsg, contextTokens) {
        const q = String(lastMsg?.content || '');
        const atts = lastMsg?.attachments || [];
        if (atts.some(a => a.isImage || a.base64)) return 'vision';
        if (contextTokens > 60000) return 'long';
        const codeAttached = atts.some(a => a.isGitHubProject || a.isZipProject || /\.(js|ts|py|go|rs|java|php|tsx|jsx|json|html|css)$/i.test(a.name || ''));
        if (RE_REASONING.test(q) && !/```/.test(q)) return 'reasoning';
        if (codeAttached || RE_CODING.test(q)) return 'coding';
        return 'chat';
    };

    P.scoreModelForTask = function (m, category, mode, neededTokens, currentModel) {
        const id = (m.id || '').toLowerCase();
        if (!id || RE_NON_CHAT.test(id) || id === 'openrouter/auto') return -Infinity;
        const free = this.isFreeModel(m.id);
        const ctx = m.context_length || 0;
        if (neededTokens && ctx && neededTokens > ctx * 0.9) return -Infinity;
        if (category === 'vision' && !(m.is_vision || RE_VISION_ID.test(id))) return -Infinity;
        if (mode === 'economy' && !free) return -Infinity;

        let score = 0;
        const pref = PREFERRED[category] || [];
        const pi = pref.indexOf(m.id);
        if (pi !== -1) score += 5 - pi * 0.6;
        if (category === 'coding' && RE_CODE_ID.test(id)) score += 3;
        if (category === 'reasoning' && (m.is_reasoning || RE_REASON_ID.test(id))) score += 4;
        if (category === 'coding' && (m.is_reasoning || RE_REASON_ID.test(id))) score += 0.5;
        if (category === 'chat' && (m.is_reasoning || RE_REASON_ID.test(id))) score -= 1.5; // slow for small talk
        if (category === 'long') score += Math.min(4, ctx / 100000);

        if (mode === 'balanced') score += free ? 4 : -3;
        if (mode === 'economy') score += 2;
        if (mode === 'speed') { score += free ? 2 : -1; if (RE_SPEED_ID.test(id)) score += 3; if (m.is_reasoning || RE_REASON_ID.test(id)) score -= 3; }
        if (mode === 'quality') { if (RE_QUALITY_ID.test(id)) score += 4; if (!free) score += 1.5; if (RE_SPEED_ID.test(id)) score -= 2; }

        // Learn from the user's arena votes (needs at least 3 battles)
        const v = (this.loadArenaVotes() || {})[m.id];
        if (v && v.battles >= 3) score += Math.min(3, (v.wins / v.battles) * 3);
        if (m.id === currentModel) score += 1.5; // stickiness to the user's choice
        return score;
    };

    P.routeForCategory = function (category, opts = {}) {
        const mode = opts.mode || this.getRouterMode();
        const exclude = new Set(opts.exclude || []);
        let best = null, bestScore = -Infinity;
        (this.availableModels || []).forEach(m => {
            if (exclude.has(m.id)) return;
            const sc = this.scoreModelForTask(m, category, mode, opts.neededTokens || 0, opts.currentModel);
            if (sc > bestScore) { bestScore = sc; best = m; }
        });
        return best ? best.id : null;
    };

    P.estimateSessionTokens = function (session, extraText = '', extraAttachments = []) {
        let total = 0;
        const ragOn = this.settings.ragEnabled !== false;
        const threshold = this.settings.ragThreshold || 40000;
        const budget = this.settings.ragBudget || 24000;
        const attTokens = (atts) => {
            const chars = (atts || []).reduce((n, a) => n + (a.textContent ? a.textContent.length : 0), 0);
            const effective = ragOn && chars > threshold ? Math.min(chars, budget) : chars;
            return Math.ceil(effective / 3.4);
        };
        (session?.messages || []).forEach(m => {
            total += estimateTokens(m.content);
            if (m.attachments) total += attTokens(m.attachments);
        });
        total += estimateTokens(extraText) + attTokens(extraAttachments);
        const persona = (typeof PERSONA_PROMPTS !== 'undefined' && PERSONA_PROMPTS[this.activePersona]) || '';
        total += estimateTokens(persona + (this.settings.systemPrompt || ''));
        return total;
    };

    // Override of the core default router
    P.pickSmartModel = function (lastMsg, session, currentModel) {
        const needed = this.estimateSessionTokens(session);
        const category = this.classifyTask(lastMsg, needed);
        const mode = this.getRouterMode();
        const model = this.routeForCategory(category, { mode, neededTokens: needed, currentModel }) || currentModel;
        return { model, category, label: `${CATEGORIES[category].label} • ${ROUTER_MODES[mode].label}` };
    };

    // ------------------------------------------------------------------ LOCAL RAG (BM25)
    const STOP = new Set(('the a an and or of to in is are be for on with this that it as at by from was were what how why which when where who '
        + 'من في على إلى الى عن ما ماذا هل هذا هذه ذلك التي الذي الذين مع أن ان إن كيف لماذا او أو ثم كل قم اشرح لي هو هي كان يكون عند بين '
        + 'de la le les et des un une du en pour que qui est dans sur avec').split(/\s+/));
    const normalizeArabic = (s) => s.replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
    const tokenize = (text) => {
        const spaced = String(text || '')
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/[_\-./\\]/g, ' ');
        const raw = normalizeArabic(spaced.toLowerCase()).match(/[\p{L}\p{N}]+/gu) || [];
        const out = [];
        for (let t of raw) {
            if (t.length < 2 || STOP.has(t)) continue;
            if (/^[a-z]+$/.test(t) && t.length > 4) t = t.replace(/(ing|ed|es|s)$/, '');
            else if (/^\p{Script=Arabic}+$/u.test(t) && t.length > 4) t = t.replace(/^(وال|بال|كال|فال|لل|ال)/, '');
            out.push(t);
        }
        return out;
    };
    P.ragTokenize = tokenize;

    const FILE_HEADER_RE = /--- \[الملف: (.+?)\] ---\n/g;
    const splitIntoFiles = (text, fallbackName) => {
        const files = [];
        const matches = [...String(text).matchAll(FILE_HEADER_RE)];
        if (matches.length === 0) return [{ path: fallbackName || 'attachment', content: String(text) }];
        matches.forEach((m, i) => {
            const start = m.index + m[0].length;
            const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
            files.push({ path: m[1].trim(), content: text.slice(start, end).replace(/\s+$/, '') });
        });
        return files;
    };

    const chunkFile = (path, content, size = 1400) => {
        const lines = content.split('\n');
        const chunks = [];
        let buf = [], len = 0, startLine = 1;
        lines.forEach((line, i) => {
            buf.push(line); len += line.length + 1;
            if (len >= size) {
                chunks.push({ path, startLine, text: buf.join('\n') });
                buf = []; len = 0; startLine = i + 2;
            }
        });
        if (buf.join('').trim()) chunks.push({ path, startLine, text: buf.join('\n') });
        return chunks;
    };

    const buildIndex = (files) => {
        const chunks = [];
        files.forEach(f => chunkFile(f.path, f.content).forEach(c => chunks.push(c)));
        const df = new Map();
        let totalLen = 0;
        chunks.forEach(c => {
            const toks = tokenize(c.text);
            c.len = toks.length || 1;
            totalLen += c.len;
            c.tf = new Map();
            toks.forEach(t => c.tf.set(t, (c.tf.get(t) || 0) + 1));
            c.pathTokens = new Set(tokenize(c.path));
            c.tf.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1));
        });
        return { chunks, df, avgdl: totalLen / Math.max(1, chunks.length), files: files.map(f => f.path) };
    };

    const searchIndex = (index, query, limit = 50) => {
        const qt = Array.from(new Set(tokenize(query)));
        if (!qt.length || !index.chunks.length) return [];
        const N = index.chunks.length, k1 = 1.2, b = 0.75;
        const results = [];
        index.chunks.forEach(c => {
            let s = 0;
            qt.forEach(t => {
                const f = c.tf.get(t);
                if (f) {
                    const n = index.df.get(t) || 0;
                    const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
                    s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * c.len / index.avgdl));
                }
                if (c.pathTokens.has(t)) s += 1.5;
            });
            if (s > 0) results.push({ chunk: c, score: s });
        });
        results.sort((a, b2) => b2.score - a.score);
        return results.slice(0, limit);
    };
    P.ragBuildIndex = buildIndex;
    P.ragSearch = searchIndex;
    P.ragSplitFiles = splitIntoFiles;

    const indexCache = new WeakMap();
    P.getAttachmentIndex = function (att) {
        let idx = indexCache.get(att);
        if (!idx || idx._srcLen !== att.textContent.length) {
            idx = buildIndex(splitIntoFiles(att.textContent, att.name));
            idx._srcLen = att.textContent.length;
            indexCache.set(att, idx);
        }
        return idx;
    };

    /** Pick the most relevant chunks of a large attachment within a char budget. */
    P.selectRelevantChunks = function (att, query, budgetChars) {
        const idx = this.getAttachmentIndex(att);
        let ranked = searchIndex(idx, query, idx.chunks.length).map(r => r.chunk);
        const seen = new Set(ranked);
        // Fallback / padding: the first chunk of each file (entry points, configs, READMEs) in original order
        idx.chunks.forEach(c => { if (c.startLine === 1 && !seen.has(c)) { ranked.push(c); seen.add(c); } });
        const picked = [];
        let used = 0;
        for (const c of ranked) {
            const cost = c.text.length + c.path.length + 40;
            if (used + cost > budgetChars) continue;
            picked.push(c); used += cost;
            if (used > budgetChars * 0.97) break;
        }
        const order = new Map(idx.chunks.map((c, i) => [c, i]));
        picked.sort((a, b) => order.get(a) - order.get(b));
        return { picked, total: idx.chunks.length, files: idx.files };
    };

    // Override of the core default attachment builder
    P.buildAttachmentContext = function (message, ctx = {}) {
        const atts = (message.attachments || []).filter(a => a.textContent);
        if (!atts.length) return '';
        const totalChars = atts.reduce((n, a) => n + a.textContent.length, 0);
        const enabled = this.settings.ragEnabled !== false;
        const threshold = this.settings.ragThreshold || 40000;
        if (!enabled || totalChars <= threshold) {
            return atts.map(att => `\n\n[محتوى الملف المرفق: ${att.name}]:\n${att.textContent}`).join('');
        }
        const fullBudget = this.settings.ragBudget || 24000;
        const budget = ctx.isLatest ? fullBudget : Math.round(fullBudget / 3);
        const query = ctx.isLatest ? (message.content || '') : `${message.content || ''} ${ctx.query || ''}`;
        let out = '', pickedTotal = 0, chunkTotal = 0, sentChars = 0;
        atts.forEach(att => {
            const share = Math.max(4000, Math.round(budget * (att.textContent.length / totalChars)));
            if (att.textContent.length <= share) {
                out += `\n\n[محتوى الملف المرفق: ${att.name}]:\n${att.textContent}`;
                sentChars += att.textContent.length;
                return;
            }
            // The file map counts against the budget too (capped at 25% of it)
            const allFiles = this.getAttachmentIndex(att).files;
            let map = '';
            for (const f of allFiles) {
                if (map.length + f.length + 2 > share * 0.25) { map += ' …'; break; }
                map += (map ? ', ' : '') + f;
            }
            const { picked, total } = this.selectRelevantChunks(att, query, Math.max(2000, share - map.length - 300));
            pickedTotal += picked.length; chunkTotal += total;
            const body = picked.map(c => `--- [الملف: ${c.path} • من السطر ${c.startLine}] ---\n${c.text}`).join('\n\n');
            const block = `\n\n[محتوى الملف المرفق: ${att.name} — مقتطفات RAG محلية: ${picked.length} من ${total} مقطعاً هي الأكثر صلة بالسؤال]\n`
                + `[خريطة ملفات المشروع (${allFiles.length}): ${map}]\n`
                + `[ملاحظة: إذا احتجت ملفاً غير ظاهر هنا فاطلب من المستخدم ذكر اسمه]\n\n${body}`;
            sentChars += block.length;
            out += block;
        });
        if (ctx.isLatest && ctx.assistantMsg && !ctx.autoContinuePass && chunkTotal) {
            const saved = Math.max(0, totalChars - sentChars);
            ctx.assistantMsg.steps = ctx.assistantMsg.steps || [];
            ctx.assistantMsg.steps.push({ text: `📚 RAG محلي: اختيار ${pickedTotal} من ${chunkTotal} مقطعاً (توفير ≈ ${fmtTokens(saved / 3.4)} توكن)`, done: true });
            ctx.assistantMsg.rag = { picked: pickedTotal, total: chunkTotal, savedChars: saved };
        }
        return out;
    };

    P.toggleRAG = function (force) {
        this.settings.ragEnabled = force !== undefined ? !!force : this.settings.ragEnabled === false;
        this.persistSettings();
        this.showToast(this.settings.ragEnabled ? 'RAG المحلي مفعل 📚 — تُرسل المقاطع الأكثر صلة فقط' : 'RAG معطل — تُرسل المرفقات كاملة', 'info');
        this.updateTokenEstimate();
    };

    // ------------------------------------------------------------------ CODE SEARCH MODAL
    P.collectSearchableFiles = function () {
        const files = new Map();
        this.virtualProjectFiles.forEach((v, path) => { if (v && v.content) files.set(path, v.content); });
        const addAtt = (att) => {
            if (!att || !att.textContent || att.isImage) return;
            splitIntoFiles(att.textContent, att.name).forEach(f => { if (!files.has(f.path)) files.set(f.path, f.content); });
        };
        (this.currentAttachments || []).forEach(addAtt);
        const session = this.sessions.find(s => s.id === this.activeSessionId);
        (session?.messages || []).forEach(m => (m.attachments || []).forEach(addAtt));
        return Array.from(files, ([path, content]) => ({ path, content }));
    };

    P.openCodeSearch = function (prefill = '') {
        const modal = document.getElementById('code-search-modal');
        const input = document.getElementById('code-search-input');
        if (!modal || !input) return;
        const files = this.collectSearchableFiles();
        const sig = files.length + ':' + files.reduce((n, f) => n + f.content.length, 0);
        if (this._codeSearchSig !== sig) {
            this._codeSearchIndex = buildIndex(files);
            this._codeSearchSig = sig;
        }
        modal.classList.add('active');
        input.value = prefill;
        if (!input.dataset.bound) {
            input.dataset.bound = '1';
            let t;
            input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.renderCodeSearch(input.value), 120); });
        }
        this.renderCodeSearch(prefill);
        setTimeout(() => input.focus(), 30);
    };

    P.renderCodeSearch = function (query) {
        const box = document.getElementById('code-search-results');
        const meta = document.getElementById('code-search-meta');
        const idx = this._codeSearchIndex;
        if (!box || !idx) return;
        if (meta) meta.textContent = `الفهرس: ${idx.files.length} ملف • ${idx.chunks.length} مقطع — ابحث بالعربية أو الإنجليزية (يدعم camelCase و snake_case)`;
        if (!idx.files.length) {
            box.innerHTML = `<div class="cmd-palette-empty">لا توجد ملفات مفهرسة بعد. اجلب مستودع GitHub (أيقونة ☁️) أو ارفع مشروع ZIP أولاً.</div>`;
            return;
        }
        if (!query.trim()) {
            box.innerHTML = `<div class="cmd-palette-empty">اكتب كلمات للبحث في ${idx.files.length} ملف...</div>`;
            return;
        }
        const t0 = performance.now();
        const results = searchIndex(idx, query, 30);
        const ms = (performance.now() - t0).toFixed(1);
        this._codeSearchResults = results;
        if (!results.length) { box.innerHTML = `<div class="cmd-palette-empty">لا نتائج لـ "${this.escapeHTML(query)}"</div>`; return; }
        const words = query.split(/\s+/).filter(w => w.length > 1).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const hlRe = words.length ? new RegExp('(' + words.join('|') + ')', 'gi') : null;
        const top = results[0].score;
        box.innerHTML = `<div style="font-size:0.7rem;color:var(--text-dim);padding:0 4px 8px;">${results.length} نتيجة في ${ms}ms</div>` + results.map((r, i) => {
            const lines = r.chunk.text.split('\n');
            let best = 0;
            if (hlRe) { const f = lines.findIndex(l => { hlRe.lastIndex = 0; return hlRe.test(l); }); best = f === -1 ? 0 : f; }
            const snippet = lines.slice(Math.max(0, best - 2), best + 4).join('\n');
            let safe = this.escapeHTML(snippet);
            if (hlRe) safe = safe.replace(hlRe, '<mark>$1</mark>');
            return `<div class="code-search-hit" onclick="app.openCodeSearchHit(${i})">
                <div class="code-search-hit-head"><i class="fa-solid fa-file-code"></i><span class="truncate" dir="ltr">${this.escapeHTML(r.chunk.path)}:${r.chunk.startLine + Math.max(0, best - 2)}</span><span class="code-search-score" style="--w:${Math.round(r.score / top * 100)}%"></span></div>
                <pre dir="ltr">${safe}</pre>
            </div>`;
        }).join('');
    };

    P.openCodeSearchHit = function (i) {
        const r = (this._codeSearchResults || [])[i];
        if (!r) return;
        const path = r.chunk.path;
        if (!this.virtualProjectFiles.has(path)) {
            const full = this.collectSearchableFiles().find(f => f.path === path);
            if (full) this.virtualProjectFiles.set(path, { content: full.content, lang: path.split('.').pop(), timestamp: Date.now() });
        }
        this.closeModals();
        this.toggleCodeStudio(true);
        this.switchStudioFile(path);
        const editor = document.getElementById('studio-editor-textarea');
        if (editor) {
            const lines = editor.value.split('\n');
            const target = Math.max(0, r.chunk.startLine - 1);
            const pos = lines.slice(0, target).reduce((n, l) => n + l.length + 1, 0);
            editor.focus();
            editor.setSelectionRange(pos, pos);
            const lh = parseFloat(getComputedStyle(editor).lineHeight) || 20;
            editor.scrollTop = Math.max(0, target * lh - 60);
            if (this.updateEditorChrome) this.updateEditorChrome();
        }
    };

    // ------------------------------------------------------------------ USAGE TRACKING
    const USAGE_KEY = 'ox_alpha_usage_v1';
    const VOTES_KEY = 'ox_alpha_arena_votes_v1';
    P.loadUsage = function () {
        try { const a = JSON.parse(localStorage.getItem(USAGE_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
    };
    P.saveUsage = function (arr) {
        try { localStorage.setItem(USAGE_KEY, JSON.stringify(arr.slice(-3000))); } catch (e) { console.warn('usage save failed', e); }
    };

    P.recordUsage = function ({ model, usage, promptChars = 0, completionChars = 0, durationMs = 0, sessionId = '', source = 'chat' }) {
        const pt = usage?.prompt_tokens ?? Math.ceil(promptChars / 3.2);
        const ct = usage?.completion_tokens ?? Math.ceil(completionChars / 3.5);
        let cost = typeof usage?.cost === 'number' ? usage.cost : this.estimateCost(model, pt, ct);
        const rec = { t: Date.now(), m: model, pt, ct, c: cost ?? 0, cu: cost === null, ms: durationMs, e: !usage, s: sessionId, src: source };
        const all = this.loadUsage();
        all.push(rec);
        this.saveUsage(all);
        this.checkBudget();
        return rec;
    };

    // Core hook
    P.onStreamPassComplete = function (info) {
        this.recordUsage({ ...info, source: 'chat' });
        this.updateTokenEstimate();
    };

    const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    P.summarizeUsage = function (records = this.loadUsage()) {
        const now = new Date();
        const ranges = {
            today: startOfDay(now),
            week: startOfDay(now) - 6 * 864e5,
            month: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
            all: 0
        };
        const sum = {};
        Object.entries(ranges).forEach(([k, from]) => {
            const rs = records.filter(r => r.t >= from);
            sum[k] = { requests: rs.length, tokens: rs.reduce((n, r) => n + r.pt + r.ct, 0), cost: rs.reduce((n, r) => n + (r.c || 0), 0) };
        });
        const days = [];
        for (let i = 13; i >= 0; i--) {
            const from = startOfDay(now) - i * 864e5, to = from + 864e5;
            const rs = records.filter(r => r.t >= from && r.t < to);
            days.push({ from, tokens: rs.reduce((n, r) => n + r.pt + r.ct, 0), cost: rs.reduce((n, r) => n + (r.c || 0), 0), requests: rs.length });
        }
        const byModel = new Map();
        records.forEach(r => {
            const e = byModel.get(r.m) || { model: r.m, requests: 0, tokens: 0, cost: 0, ms: 0, unknownCost: false };
            e.requests++; e.tokens += r.pt + r.ct; e.cost += r.c || 0; e.ms += r.ms || 0; if (r.cu) e.unknownCost = true;
            byModel.set(r.m, e);
        });
        const models = Array.from(byModel.values()).sort((a, b) => b.tokens - a.tokens);
        return { ...sum, days, models };
    };

    P.checkBudget = function () {
        const budget = parseFloat(this.settings.monthlyBudget) || 0;
        if (!budget) return;
        const spent = this.summarizeUsage().month.cost;
        const ym = new Date().toISOString().slice(0, 7);
        let warned = '';
        try { warned = localStorage.getItem('ox_alpha_budget_warn') || ''; } catch (e) {}
        const level = spent >= budget ? '100' : spent >= budget * 0.8 ? '80' : '';
        if (level && warned !== `${ym}:${level}` && !(level === '80' && warned === `${ym}:100`)) {
            try { localStorage.setItem('ox_alpha_budget_warn', `${ym}:${level}`); } catch (e) {}
            this.showToast(level === '100'
                ? `🚨 تجاوزت ميزانية الشهر (${fmtUSD(spent)} من $${budget}) — فعّل وضع الموجّه الاقتصادي`
                : `⚠️ استهلكت 80% من ميزانية الشهر (${fmtUSD(spent)} من $${budget})`, level === '100' ? 'error' : 'warning');
        }
    };

    P.buildUsageCSV = function () {
        const rows = [['timestamp', 'model', 'prompt_tokens', 'completion_tokens', 'cost_usd', 'duration_ms', 'estimated', 'source']];
        this.loadUsage().forEach(r => rows.push([new Date(r.t).toISOString(), r.m, r.pt, r.ct, (r.c || 0).toFixed(6), r.ms, r.e ? 'yes' : 'no', r.src || 'chat']));
        return rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',')).join('\n');
    };

    P.exportUsageCSV = function () {
        const csv = this.buildUsageCSV();
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `ox-alpha-usage-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.showToast('تم تصدير سجل الاستهلاك CSV 📊', 'success');
    };

    P.clearUsageData = function () {
        if (!confirm('مسح سجل الاستهلاك ونتائج الحلبة نهائياً؟')) return;
        try { localStorage.removeItem(USAGE_KEY); localStorage.removeItem(VOTES_KEY); } catch (e) {}
        this.renderAIHub();
        this.showToast('تم مسح سجل الاستهلاك 🧹', 'info');
    };

    // ------------------------------------------------------------------ TOKEN ESTIMATE CHIP
    P.updateTokenEstimate = function () {
        clearTimeout(this._tokenEstTimer);
        this._tokenEstTimer = setTimeout(() => this._renderTokenEstimate(), 120);
    };

    P._renderTokenEstimate = function () {
        const chip = document.getElementById('token-estimate-chip');
        if (!chip) return;
        const input = document.getElementById('user-input');
        const text = input ? input.value : '';
        const atts = this.currentAttachments || [];
        const session = this.sessions.find(s => s.id === this.activeSessionId);
        if (!text.trim() && !atts.length) { chip.innerHTML = ''; chip.className = 'token-estimate-chip'; return; }
        const tokens = this.estimateSessionTokens(session, text, atts);
        let model = this.settings.model;
        let routedLabel = '';
        if (this.isSmartRouterActive) {
            const r = this.pickSmartModel({ content: text, attachments: atts }, { messages: [...(session?.messages || []), { content: text, attachments: atts }] }, model);
            if (r && r.model) { model = r.model; routedLabel = '🧭 '; }
        }
        const meta = this.getModelMeta(model);
        const cost = this.estimateCost(model, tokens, 0);
        const ctx = meta?.context_length || 0;
        const pct = ctx ? tokens / ctx : 0;
        chip.className = 'token-estimate-chip' + (pct > 0.9 ? ' danger' : pct > 0.6 ? ' warn' : '');
        chip.innerHTML = `<i class="fa-solid fa-coins"></i> ≈ ${fmtTokens(tokens)} توكن`
            + `<span class="sep">•</span>${routedLabel}<span dir="ltr">${this.escapeHTML(shortModel(model))}</span>`
            + `<span class="sep">•</span>${cost === null ? 'السعر غير معروف' : fmtUSD(cost) + (cost ? ' للإدخال' : '')}`
            + (ctx ? `<span class="sep">•</span>${Math.round(pct * 100)}% من السياق` : '');
    };

    const _origRenderAttachmentTray = P.renderAttachmentTray;
    P.renderAttachmentTray = function () {
        const r = _origRenderAttachmentTray.apply(this, arguments);
        this.updateTokenEstimate();
        return r;
    };
    const _origRenderUI = P.renderUIState;
    P.renderUIState = function () {
        const r = _origRenderUI.apply(this, arguments);
        this.updateTokenEstimate();
        const btn = document.getElementById('btn-smart-router');
        if (btn) btn.title = `التوجيه الذكي التلقائي للنموذج — الوضع: ${ROUTER_MODES[this.getRouterMode()].label} (Alt+U للإعدادات)`;
        return r;
    };

    // ------------------------------------------------------------------ STREAMING HELPER
    /** Stream one OpenRouter completion. Returns { content, reasoning, usage, ttftMs, durationMs }. */
    P.streamOpenRouter = async function ({ model, messages, signal, onDelta, maxTokens = 4096 }) {
        const apiKey = this.settings.apiKey?.trim();
        if (!apiKey) throw new Error('يلزم مفتاح OpenRouter في الإعدادات');
        const t0 = Date.now();
        const res = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': window.location.origin || 'https://daschai.vercel.app',
                'X-Title': 'OX-Alpha Workbench Pro'
            },
            body: JSON.stringify({ model, messages, stream: true, max_tokens: maxTokens, usage: { include: true } }),
            signal
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || err.message || `HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '', content = '', reasoning = '', usage = null, ttftMs = null;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
                const tr = line.trim();
                if (!tr.startsWith('data:')) continue;
                const json = tr.replace(/^data:\s*/, '');
                if (json === '[DONE]') continue;
                try {
                    const p = JSON.parse(json);
                    if (p.usage) usage = p.usage;
                    if (p.error) throw new Error(p.error.message || 'provider error');
                    const d = p.choices?.[0]?.delta;
                    if (!d) continue;
                    if (d.reasoning || d.reasoning_content) reasoning += d.reasoning || d.reasoning_content;
                    if (d.content) {
                        if (ttftMs === null) ttftMs = Date.now() - t0;
                        content += d.content;
                    }
                    if (onDelta) onDelta(content, reasoning);
                } catch (e) { if (e.message && !/JSON/.test(e.message)) throw e; }
            }
        }
        return { content, reasoning, usage, ttftMs, durationMs: Date.now() - t0 };
    };

    // ------------------------------------------------------------------ MULTI-MODEL ARENA
    const ARENA_DEFAULTS = ['google/gemma-3-27b-it:free', 'qwen/qwen3-coder:free', 'meta-llama/llama-3.3-70b-instruct:free', 'deepseek/deepseek-r1:free',
        'mistralai/mistral-small-3.2-24b-instruct:free', 'z-ai/glm-4.5-air:free', 'moonshotai/kimi-k2:free', 'openai/gpt-oss-20b:free']; // Mega Arena: up to 8 (#3)
    P.loadArenaVotes = function () {
        if (this._arenaVotesCache) return this._arenaVotesCache;
        try { this._arenaVotesCache = JSON.parse(localStorage.getItem(VOTES_KEY) || '{}') || {}; } catch (e) { this._arenaVotesCache = {}; }
        return this._arenaVotesCache;
    };
    P.saveArenaVotes = function (v) {
        this._arenaVotesCache = v;
        try { localStorage.setItem(VOTES_KEY, JSON.stringify(v)); } catch (e) {}
    };

    P.getArenaModels = function () {
        let saved = [];
        try { saved = JSON.parse(localStorage.getItem('ox_alpha_arena_models') || '[]'); } catch (e) {}
        return [0, 1, 2, 3, 4, 5, 6, 7].map(i => saved[i] || ARENA_DEFAULTS[i]);
    };

    P.setArenaCount = function (n) {
        this.arenaCount = Math.min(8, Math.max(2, parseInt(n, 10) || 2));
        try { localStorage.setItem('ox_alpha_arena_count', String(this.arenaCount)); } catch (e) {}
        this.renderArenaGrid();
    };

    P.renderArenaGrid = function () {
        const grid = document.getElementById('arena-grid');
        if (!grid) return;
        const n = this.arenaCount || parseInt(localStorage.getItem('ox_alpha_arena_count') || '2', 10) || 2;
        this.arenaCount = n;
        const sel = document.getElementById('arena-count-select');
        if (sel) sel.value = String(n);
        grid.dataset.count = String(n);
        const chosen = this.getArenaModels();
        const pool = [...(this.availableModels || [])];
        chosen.forEach(id => { if (!pool.some(m => m.id === id)) pool.unshift({ id, name: id }); });
        const optionsFor = (current) => pool.slice(0, 250).map(m =>
            `<option value="${this.escapeHTML(m.id)}" ${m.id === current ? 'selected' : ''}>${this.isFreeModel(m.id) ? '🟢 ' : ''}${this.escapeHTML(m.name || m.id)}</option>`).join('');
        grid.innerHTML = Array.from({ length: n }, (_, i) => `
            <div class="arena-column-card" id="arena-col-${i}">
                <div class="arena-header-bar">
                    <select class="form-input-box arena-model-select" data-idx="${i}" style="padding:4px 8px; font-size:0.74rem; width:auto; max-width:70%;" aria-label="النموذج ${i + 1}" onchange="app.saveArenaModelChoice(${i}, this.value)">${optionsFor(chosen[i])}</select>
                    <span class="arena-gauge" id="arena-gauge-${i}">جاهز</span>
                </div>
                <div class="arena-body-scroll markdown-body" id="arena-output-${i}" dir="auto"><span style="color:var(--text-dim)">بانتظار بدء المقارنة...</span></div>
                <div class="arena-vote-row"><button class="sidebar-btn-util arena-vote-btn" id="arena-vote-${i}" disabled onclick="app.voteArena(${i})"><i class="fa-solid fa-trophy"></i><span>الأفضل</span></button></div>
            </div>`).join('');
    };

    P.saveArenaModelChoice = function (i, id) {
        const models = this.getArenaModels();
        models[i] = id;
        try { localStorage.setItem('ox_alpha_arena_models', JSON.stringify(models)); } catch (e) {}
    };

    // Override: open the multi-model arena
    P.openDualModelArena = function () {
        const modal = document.getElementById('arena-modal');
        if (!modal) return;
        modal.classList.add('active');
        this.renderArenaGrid();
        this.renderArenaLeaderboardMini();
        const prompt = document.getElementById('arena-prompt-input');
        if (prompt && !prompt.dataset.bound) {
            prompt.dataset.bound = '1';
            prompt.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.executeArenaComparison(); }
            });
        }
        if (prompt) setTimeout(() => prompt.focus(), 30);
    };

    P.stopArena = function () {
        if (this._arenaAbort) this._arenaAbort.abort();
    };

    P.executeArenaComparison = async function () {
        const prompt = document.getElementById('arena-prompt-input');
        const text = prompt?.value.trim();
        if (!text) { this.showToast('أدخل مسألة أو كوداً لبدء المقارنة', 'warning'); return; }
        if (!this.settings.apiKey?.trim()) { this.showToast('يلزم إدخال مفتاح OpenRouter في الإعدادات', 'warning'); this.openSettingsModal(); return; }
        if (this._arenaRunning) return;
        const n = this.arenaCount || 2;
        const models = Array.from({ length: n }, (_, i) => document.querySelector(`.arena-model-select[data-idx="${i}"]`)?.value || ARENA_DEFAULTS[i]);
        this._arenaAbort = new AbortController();
        this._arenaRunning = true;
        this._arenaLastModels = models;
        this._arenaVoted = false;
        const runBtn = document.getElementById('arena-run-btn');
        const stopBtn = document.getElementById('arena-stop-btn');
        if (runBtn) runBtn.disabled = true;
        if (stopBtn) stopBtn.style.display = '';
        const render = (el, md) => {
            const html = (window.marked ? marked.parse(this.repairMarkdownForStreaming(md)) : this.escapeHTML(md));
            el.innerHTML = window.DOMPurify ? DOMPurify.sanitize(html) : html;
        };
        const runOne = async (model, i) => {
            const out = document.getElementById(`arena-output-${i}`);
            const gauge = document.getElementById(`arena-gauge-${i}`);
            const vote = document.getElementById(`arena-vote-${i}`);
            if (vote) vote.disabled = true;
            if (out) out.innerHTML = '<span class="live-step-spinner"></span> جاري الاتصال...';
            if (gauge) { gauge.textContent = '⚡ ...'; gauge.className = 'arena-gauge'; }
            let last = 0;
            try {
                const r = await this.streamOpenRouter({
                    model, messages: [{ role: 'user', content: text }], signal: this._arenaAbort.signal,
                    onDelta: (content, reasoning) => {
                        const now = Date.now();
                        if (now - last < 80) return;
                        last = now;
                        if (out) render(out, content || (reasoning ? `> 💭 ${reasoning.slice(-400)}` : '...'));
                    }
                });
                if (out) render(out, r.content || '_(لا يوجد رد)_');
                const pt = r.usage?.prompt_tokens ?? estimateTokens(text);
                const ct = r.usage?.completion_tokens ?? estimateTokens(r.content);
                const rec = this.recordUsage({ model, usage: r.usage, promptChars: text.length, completionChars: r.content.length, durationMs: r.durationMs, sessionId: 'arena', source: 'arena' });
                if (gauge) {
                    gauge.innerHTML = `⏱️ ${(r.durationMs / 1000).toFixed(1)}s${r.ttftMs !== null ? ` • أول رد ${(r.ttftMs / 1000).toFixed(1)}s` : ''} • ${fmtTokens(ct)} tok • ${fmtUSD(rec.c)}`;
                    gauge.className = 'arena-gauge ok';
                    gauge.dataset.duration = String(r.durationMs);
                }
                if (vote) vote.disabled = false;
                return { model, ok: true, durationMs: r.durationMs, tokens: pt + ct };
            } catch (err) {
                const aborted = err.name === 'AbortError';
                if (out) out.innerHTML = aborted ? '⏹️ تم الإيقاف' : `❌ خطأ: ${this.escapeHTML(err.message)}`;
                if (gauge) { gauge.textContent = aborted ? 'متوقف' : 'فشل'; gauge.className = 'arena-gauge fail'; }
                return { model, ok: false };
            }
        };
        const results = await Promise.all(models.map((m, i) => runOne(m, i)));
        this._arenaRunning = false;
        if (runBtn) runBtn.disabled = false;
        if (stopBtn) stopBtn.style.display = 'none';
        const okRuns = results.filter(r => r.ok);
        if (okRuns.length > 1) {
            const fastest = okRuns.reduce((a, b) => (a.durationMs <= b.durationMs ? a : b));
            const idx = results.indexOf(fastest);
            const g = document.getElementById(`arena-gauge-${idx}`);
            if (g) g.innerHTML = '🚀 ' + g.innerHTML;
            this.showToast(`اكتملت المقارنة — الأسرع: ${shortModel(fastest.model)}. صوّت للأفضل لتحسين الموجّه 🏆`, 'success');
        } else if (okRuns.length === 1) {
            this.showToast('اكتملت المقارنة (نجح نموذج واحد فقط)', 'warning');
        }
        return results;
    };

    P.voteArena = function (i) {
        if (this._arenaVoted || !this._arenaLastModels) return;
        const models = this._arenaLastModels;
        const winner = models[i];
        const votes = { ...this.loadArenaVotes() };
        const counted = new Set(); // the same model in two columns counts as one battle
        models.forEach((m, j) => {
            const okGauge = document.getElementById(`arena-gauge-${j}`)?.classList.contains('ok');
            if (!okGauge || counted.has(m)) return;
            counted.add(m);
            const v = votes[m] || { wins: 0, battles: 0 };
            v.battles++;
            if (m === winner) v.wins++;
            votes[m] = v;
        });
        this.saveArenaVotes(votes);
        this._arenaVoted = true;
        document.querySelectorAll('.arena-vote-btn').forEach(b => { b.disabled = true; });
        const col = document.getElementById(`arena-col-${i}`);
        if (col) col.classList.add('winner');
        this.renderArenaLeaderboardMini();
        this.showToast(`🏆 تم تسجيل الفوز لـ ${shortModel(winner)} — سيأخذه الموجّه الذكي بالحسبان`, 'success');
    };

    P.getArenaLeaderboard = function () {
        return Object.entries(this.loadArenaVotes())
            .map(([model, v]) => ({ model, wins: v.wins, battles: v.battles, rate: v.battles ? v.wins / v.battles : 0 }))
            .sort((a, b) => b.rate - a.rate || b.battles - a.battles);
    };

    P.renderArenaLeaderboardMini = function () {
        const el = document.getElementById('arena-leaderboard-mini');
        if (!el) return;
        const top = this.getArenaLeaderboard().slice(0, 3);
        el.innerHTML = top.length
            ? '🏆 ' + top.map((r, i) => `<span>${['🥇', '🥈', '🥉'][i]} ${this.escapeHTML(shortModel(r.model))} <b>${Math.round(r.rate * 100)}%</b> (${r.wins}/${r.battles})</span>`).join(' ')
            : '<span style="color:var(--text-dim)">صوّت لأفضل إجابة بعد كل مقارنة لبناء ترتيب النماذج</span>';
    };

    // ------------------------------------------------------------------ CRITIC MODE
    P.critiqueLastAnswer = function () {
        const session = this.sessions.find(s => s.id === this.activeSessionId);
        const last = session && [...session.messages].reverse().find(m => m.role === 'assistant' && m.content && m.status !== 'streaming');
        if (!last) { this.showToast('لا توجد إجابة مكتملة لمراجعتها بعد', 'warning'); return; }
        if (this.activeStreams.has(this.activeSessionId)) { this.showToast('انتظر انتهاء التوليد الحالي', 'warning'); return; }
        const critic = this.routeForCategory('reasoning', { exclude: [last.model], mode: this.getRouterMode() === 'quality' ? 'quality' : 'balanced' })
            || this.routeForCategory('coding', { exclude: [last.model] });
        if (!critic) { this.showToast('لا يوجد نموذج ناقد متاح', 'error'); return; }
        const text = `🧐 **مراجعة ناقدة بنموذج ثانٍ (${critic})**\n\n`
            + `راجع الإجابة السابقة (من ${last.model}) كمراجع خبير مستقل: اكتشف الأخطاء المنطقية والبرمجية، الحالات الحدية المنسية، الافتراضات غير المبررة، وأي معلومة غير دقيقة. `
            + `قيّم الإجابة من 10، ثم قدّم النسخة المصححة والمحسنة فقط للأجزاء التي تحتاج تعديلاً. لا تكرر ما هو صحيح.`;
        this.sendUserMessage(text, { model: critic });
    };

    // ------------------------------------------------------------------ AI HUB (dashboard)
    P.openAIHub = function () {
        const modal = document.getElementById('ai-hub-modal');
        if (!modal) return;
        modal.classList.add('active');
        this.renderAIHub();
    };

    P.renderAIHub = function () {
        const body = document.getElementById('ai-hub-body');
        if (!body) return;
        const s = this.summarizeUsage();
        const mode = this.getRouterMode();
        const budget = parseFloat(this.settings.monthlyBudget) || 0;
        const card = (title, d) => `<div class="hub-stat-card"><div class="hub-stat-title">${title}</div><div class="hub-stat-value">${fmtTokens(d.tokens)} <small>توكن</small></div><div class="hub-stat-sub">${d.requests} طلب • ${fmtUSD(d.cost)}</div></div>`;
        const maxDay = Math.max(1, ...s.days.map(d => d.tokens));
        const chart = s.days.map(d => {
            const date = new Date(d.from);
            return `<div class="hub-bar-col" title="${date.toLocaleDateString('ar')} — ${fmtTokens(d.tokens)} توكن • ${d.requests} طلب • ${fmtUSD(d.cost)}"><div class="hub-bar" style="height:${Math.max(2, Math.round(d.tokens / maxDay * 100))}%"></div><span>${date.getDate()}</span></div>`;
        }).join('');
        const totalTokens = Math.max(1, s.models.reduce((n, m) => n + m.tokens, 0));
        const modelRows = s.models.slice(0, 12).map(m => `<tr><td dir="ltr" class="truncate" style="max-width:220px">${this.escapeHTML(m.model)}</td><td>${m.requests}</td><td>${fmtTokens(m.tokens)}<div class="hub-share"><i style="width:${Math.round(m.tokens / totalTokens * 100)}%"></i></div></td><td>${m.unknownCost && !m.cost ? '—' : fmtUSD(m.cost)}</td><td>${(m.ms / m.requests / 1000).toFixed(1)}s</td></tr>`).join('')
            || `<tr><td colspan="5" style="text-align:center;color:var(--text-dim)">لا يوجد استهلاك مسجل بعد — أرسل رسالة لتظهر الإحصائيات</td></tr>`;
        const preview = Object.keys(CATEGORIES).map(c => {
            const id = this.routeForCategory(c, { mode });
            return `<div class="hub-route-row"><span>${CATEGORIES[c].label}</span><span dir="ltr">${this.escapeHTML(id ? shortModel(id) : '—')}</span></div>`;
        }).join('');
        const board = this.getArenaLeaderboard().slice(0, 8).map((r, i) => `<tr><td>${i + 1}</td><td dir="ltr">${this.escapeHTML(shortModel(r.model))}</td><td>${r.wins}/${r.battles}</td><td>${Math.round(r.rate * 100)}%</td></tr>`).join('')
            || `<tr><td colspan="4" style="text-align:center;color:var(--text-dim)">لا توجد نتائج حلبة بعد</td></tr>`;
        const budgetPct = budget ? Math.min(100, Math.round(s.month.cost / budget * 100)) : 0;
        const estimatedShare = (() => { const u = this.loadUsage(); return u.length ? Math.round(u.filter(r => r.e).length / u.length * 100) : 0; })();

        body.innerHTML = `
            <div class="hub-stats-grid">${card('اليوم', s.today)}${card('آخر 7 أيام', s.week)}${card('هذا الشهر', s.month)}${card('الإجمالي', s.all)}</div>
            ${estimatedShare ? `<div class="hub-note">ℹ️ ${estimatedShare}% من السجلات أرقامها تقديرية (لم يُرجع المزود بيانات الاستهلاك الفعلية).</div>` : ''}

            <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-chart-column"></i> الاستهلاك اليومي (14 يوماً)</div><div class="hub-chart">${chart}</div></div>

            <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-microchip"></i> حسب النموذج</div>
                <div style="overflow-x:auto"><table class="hub-table"><thead><tr><th>النموذج</th><th>طلبات</th><th>توكن</th><th>التكلفة</th><th>متوسط الزمن</th></tr></thead><tbody>${modelRows}</tbody></table></div></div>

            <div class="hub-two-col">
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-route"></i> الموجّه الذكي ${this.isSmartRouterActive ? '<span class="hub-pill on">مفعل</span>' : '<span class="hub-pill">معطل</span>'}</div>
                    <div class="hub-mode-grid">${Object.entries(ROUTER_MODES).map(([k, m]) => `<button class="hub-mode-btn ${k === mode ? 'active' : ''}" onclick="app.setRouterMode('${k}')"><i class="fa-solid ${m.icon}"></i><b>${m.label}</b><small>${m.desc}</small></button>`).join('')}</div>
                    <div class="hub-sub-title">ماذا سيختار الآن لكل نوع مهمة:</div>${preview}
                </div>
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-book-open"></i> RAG المحلي للمشاريع الكبيرة</div>
                    <label class="hub-toggle"><input type="checkbox" ${this.settings.ragEnabled !== false ? 'checked' : ''} onchange="app.toggleRAG(this.checked)"> إرسال المقاطع الأكثر صلة فقط بدل المشروع كاملاً</label>
                    <label class="hub-field">يُفعَّل عندما تتجاوز المرفقات (حرف)<input type="number" min="5000" step="5000" class="form-input-box" value="${this.settings.ragThreshold || 40000}" onchange="app.updateAISetting('ragThreshold', this.value)"></label>
                    <label class="hub-field">ميزانية السياق المرسل (حرف)<input type="number" min="4000" step="2000" class="form-input-box" value="${this.settings.ragBudget || 24000}" onchange="app.updateAISetting('ragBudget', this.value)"></label>
                    <div class="hub-sub-title">الفهرسة والبحث تتم داخل المتصفح (BM25) — لا يُرسل شيء لخادم خارجي.</div>
                    <button class="sidebar-btn-util" style="padding:6px 12px; margin-top:6px;" onclick="app.closeModals(); app.openCodeSearch()"><i class="fa-solid fa-magnifying-glass-chart"></i><span>جرّب البحث في الكود</span></button>
                </div>
            </div>

            <div class="hub-two-col">
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-wallet"></i> الميزانية الشهرية</div>
                    <label class="hub-field">الحد الشهري بالدولار (0 = بلا حد)<input type="number" min="0" step="0.5" class="form-input-box" value="${budget}" onchange="app.updateAISetting('monthlyBudget', this.value)"></label>
                    ${budget ? `<div class="hub-budget"><i style="width:${budgetPct}%" class="${budgetPct >= 100 ? 'over' : budgetPct >= 80 ? 'warn' : ''}"></i></div><div class="hub-sub-title">${fmtUSD(s.month.cost)} من $${budget} (${budgetPct}%) — تنبيه عند 80% و 100%</div>` : '<div class="hub-sub-title">حدد ميزانية لتلقي تنبيهات عند الاقتراب منها.</div>'}
                </div>
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-trophy"></i> ترتيب الحلبة</div>
                    <table class="hub-table"><thead><tr><th>#</th><th>النموذج</th><th>فوز</th><th>النسبة</th></tr></thead><tbody>${board}</tbody></table>
                </div>
            </div>
            <div class="hub-section" id="hub-storage-section"></div>`;
        if (this.renderStorageSection) this.renderStorageSection();
    };

    P.updateAISetting = function (key, value) {
        const num = parseFloat(value);
        if (['ragThreshold', 'ragBudget', 'monthlyBudget'].includes(key)) {
            if (isNaN(num) || num < 0) return;
            this.settings[key] = num;
        } else {
            this.settings[key] = value;
        }
        this.persistSettings();
        this.updateTokenEstimate();
        if (key === 'monthlyBudget') { this.renderAIHub(); this.checkBudget(); }
        this.showToast('تم الحفظ ✓', 'success');
    };

    // ------------------------------------------------------------------ PALETTE INTEGRATION
    const _origBuildPalette = P.buildPaletteCommands;
    if (_origBuildPalette) {
        P.buildPaletteCommands = function () {
            const cmds = _origBuildPalette.call(this);
            const self = this;
            const extra = [
                { section: 'الذكاء الاصطناعي', icon: 'fa-chart-line', label: 'مركز الذكاء: الاستهلاك والتكلفة', hint: 'Usage dashboard', kbd: 'Alt+U', run: () => self.openAIHub() },
                { section: 'الذكاء الاصطناعي', icon: 'fa-magnifying-glass-chart', label: 'البحث الذكي في كود المشروع', hint: 'Code search (RAG)', kbd: 'Ctrl+Shift+F', run: () => self.openCodeSearch() },
                { section: 'الذكاء الاصطناعي', icon: 'fa-user-check', label: 'مراجعة آخر رد بنموذج ناقد ثانٍ', hint: 'Critic review', run: () => self.critiqueLastAnswer() },
                { section: 'الذكاء الاصطناعي', icon: 'fa-book-open', label: 'تفعيل/إيقاف RAG المحلي', hint: 'Toggle RAG', run: () => self.toggleRAG() },
                ...Object.entries(ROUTER_MODES).map(([k, m]) => ({ section: 'الذكاء الاصطناعي', icon: m.icon, label: `وضع الموجّه: ${m.label}`, hint: m.desc, run: () => self.setRouterMode(k) }))
            ];
            let at = -1;
            cmds.forEach((c, i) => { if (c.section === 'الذكاء الاصطناعي') at = i; });
            cmds.splice(at === -1 ? cmds.length : at + 1, 0, ...extra);
            const arena = cmds.find(c => c.label === 'حلبة مقارنة النماذج');
            if (arena) arena.label = 'حلبة النماذج المتعددة (2–8)';
            return cmds;
        };
    }

    // ------------------------------------------------------------------ INIT
    P.initSprint2 = function () {
        if (!this.settings.routerMode) this.settings.routerMode = 'balanced';
        const input = document.getElementById('user-input');
        if (input) input.addEventListener('input', () => this.updateTokenEstimate());
        window.addEventListener('keydown', (e) => {
            const ctrl = e.ctrlKey || e.metaKey;
            if (e.altKey && !ctrl && e.key.toLowerCase() === 'u') { e.preventDefault(); this.openAIHub(); }
            if (ctrl && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); this.openCodeSearch(); }
        });
        this.updateTokenEstimate();
    };

    window.OX_ROUTER_MODES = ROUTER_MODES;
    if (window.app) {
        try { window.app.initSprint2(); } catch (e) { console.error('Sprint 2 init failed', e); }
    }
})();
