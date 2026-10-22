/* #981 direct OpenAI / Anthropic / Google • #7 personal style profile + LoRA dataset • #35 community prompt market • #1008 memory of all projects */
import { esc, call, btn, pbtn, card, empty, field, area, select, table, stats, toggle, pre, code, uid, ago } from './util.js';

// ====================================================================== #981 DIRECT PROVIDERS
export const DIRECT = {
    openai: { label: 'OpenAI', url: 'https://api.openai.com/v1/chat/completions', prefix: 'openai/', keyHint: 'sk-…' },
    anthropic: { label: 'Anthropic', url: 'https://api.anthropic.com/v1/messages', prefix: 'anthropic/', keyHint: 'sk-ant-…' },
    google: { label: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/models/', prefix: 'google/', keyHint: 'AIza…' }
};
/** OpenRouter model id → provider-native id. */
export function nativeModel(provider, id, map = {}) {
    if (map[id]) return map[id];
    let m = String(id).replace(/^[^/]+\//, '').replace(/:(beta|thinking|free|extended|online|nitro|floor)$/i, '');
    if (provider === 'anthropic') { m = m.replace(/\./g, '-'); if (/^claude-3(-\d)?-(opus|sonnet|haiku)$/.test(m)) m += '-latest'; }
    return m;
}
/** Which provider (if any) should serve `model` directly. */
export function directRoute(model, cfg = {}) {
    if (!cfg.on || !model) return null;
    for (const [p, d] of Object.entries(DIRECT)) if (String(model).startsWith(d.prefix) && String(cfg[p] || '').trim() && cfg['skip_' + p] !== true) return { provider: p, model: nativeModel(p, model, cfg.map || {}) };
    return null;
}
const partsOf = (c) => (typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [{ type: 'text', text: String(c == null ? '' : c) }]);
const dataUrl = (u) => { const m = /^data:([^;,]+);base64,(.*)$/.exec(u || ''); return m ? { mime: m[1], data: m[2] } : null; };
const textOf = (c) => partsOf(c).filter(p => p.type === 'text').map(p => p.text).join('\n');
/** OpenAI-style body → Anthropic Messages body. */
export function toAnthropic(body, model) {
    const system = body.messages.filter(m => m.role === 'system').map(m => textOf(m.content)).join('\n\n');
    const msgs = [];
    body.messages.filter(m => m.role !== 'system').forEach(m => {
        const role = m.role === 'assistant' ? 'assistant' : 'user';
        const content = partsOf(m.content).map(p => {
            if (p.type === 'image_url') { const u = (p.image_url && p.image_url.url) || p.image_url; const d = dataUrl(u); return d ? { type: 'image', source: { type: 'base64', media_type: d.mime, data: d.data } } : { type: 'image', source: { type: 'url', url: u } }; }
            return { type: 'text', text: String(p.text || '') };
        }).filter(p => p.type !== 'text' || p.text);
        if (!content.length) return;
        const last = msgs[msgs.length - 1];
        if (last && last.role === role) last.content.push(...content); else msgs.push({ role, content });
    });
    if (msgs.length && msgs[0].role !== 'user') msgs.unshift({ role: 'user', content: [{ type: 'text', text: '…' }] });
    const out = { model, messages: msgs, max_tokens: Math.min(body.max_tokens || 4096, 64000), stream: !!body.stream };
    if (system) out.system = system;
    if (body.temperature != null) out.temperature = Math.min(1, body.temperature);
    return out;
}
/** OpenAI-style body → Gemini generateContent body. */
export function toGemini(body) {
    const sys = body.messages.filter(m => m.role === 'system').map(m => textOf(m.content)).join('\n\n');
    const contents = [];
    body.messages.filter(m => m.role !== 'system').forEach(m => {
        const role = m.role === 'assistant' ? 'model' : 'user';
        const parts = partsOf(m.content).map(p => {
            if (p.type === 'image_url') { const d = dataUrl((p.image_url && p.image_url.url) || p.image_url); return d ? { inline_data: { mime_type: d.mime, data: d.data } } : { text: '[image: ' + ((p.image_url && p.image_url.url) || '') + ']' }; }
            return { text: String(p.text || '') };
        }).filter(p => p.inline_data || p.text);
        if (!parts.length) return;
        const last = contents[contents.length - 1];
        if (last && last.role === role) last.parts.push(...parts); else contents.push({ role, parts });
    });
    const out = { contents, generationConfig: { maxOutputTokens: body.max_tokens || 8192 } };
    if (body.temperature != null) out.generationConfig.temperature = body.temperature;
    if (sys) out.systemInstruction = { parts: [{ text: sys }] };
    return out;
}
export function toOpenAI(body, model) {
    const out = { ...body, model };
    ['provider', 'transforms', 'usage', 'plugins', 'reasoning', 'models', 'route'].forEach(k => delete out[k]);
    if (/^(o\d|gpt-5)/.test(model)) { if (out.max_tokens) out.max_completion_tokens = out.max_tokens; delete out.max_tokens; delete out.temperature; }
    if (out.stream) out.stream_options = { include_usage: true };
    return out;
}
const chunkLine = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
/** Parse one provider SSE `data:` payload into OpenAI-style deltas. */
export function providerEvent(provider, obj, st) {
    const out = [];
    if (provider === 'anthropic') {
        if (obj.type === 'message_start' && obj.message && obj.message.usage) st.in = obj.message.usage.input_tokens || 0;
        else if (obj.type === 'content_block_delta' && obj.delta) {
            if (obj.delta.type === 'text_delta') out.push({ content: obj.delta.text });
            else if (obj.delta.type === 'thinking_delta') out.push({ reasoning: obj.delta.thinking });
        } else if (obj.type === 'message_delta' && obj.usage) st.out = obj.usage.output_tokens || 0;
        else if (obj.type === 'error') throw new Error((obj.error && obj.error.message) || 'Anthropic error');
    } else if (provider === 'google') {
        const parts = (((obj.candidates || [])[0] || {}).content || {}).parts || [];
        parts.forEach(p => { if (p.text) out.push(p.thought ? { reasoning: p.text } : { content: p.text }); });
        if (obj.usageMetadata) { st.in = obj.usageMetadata.promptTokenCount || 0; st.out = obj.usageMetadata.candidatesTokenCount || 0; }
        if (obj.error) throw new Error(obj.error.message || 'Gemini error');
    }
    return out;
}
/** Provider SSE stream → OpenRouter/OpenAI-compatible SSE stream. */
export function translateStream(body, provider, model) {
    const enc = new TextEncoder(), dec = new TextDecoder();
    const st = { in: 0, out: 0 };
    let buf = '';
    const reader = body.getReader();
    return new ReadableStream({
        async pull(ctrl) {
            const { done, value } = await reader.read();
            const flushLines = (final) => {
                const lines = buf.split(/\r?\n/);
                buf = final ? '' : lines.pop();
                for (const line of lines) {
                    const t = line.trim();
                    if (!t.startsWith('data:')) continue;
                    const j = t.replace(/^data:\s*/, '');
                    if (!j || j === '[DONE]') continue;
                    let obj; try { obj = JSON.parse(j); } catch (e) { continue; }
                    try { providerEvent(provider, obj, st).forEach(d => ctrl.enqueue(enc.encode(chunkLine({ model, choices: [{ index: 0, delta: d }] })))); } catch (e) { ctrl.enqueue(enc.encode(chunkLine({ error: { message: e.message } }))); }
                }
            };
            if (done) {
                flushLines(true);
                ctrl.enqueue(enc.encode(chunkLine({ model, choices: [], usage: { prompt_tokens: st.in, completion_tokens: st.out, total_tokens: st.in + st.out, cost: 0, direct: provider } })));
                ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
                ctrl.close();
                return;
            }
            buf += dec.decode(value, { stream: true });
            flushLines(false);
        }
    });
}
/** Non-stream provider JSON → OpenAI chat.completion JSON. */
export function translateJSON(provider, j, model) {
    let text = '', usage = {};
    if (provider === 'anthropic') { text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join(''); usage = { prompt_tokens: (j.usage || {}).input_tokens || 0, completion_tokens: (j.usage || {}).output_tokens || 0 }; }
    else if (provider === 'google') { text = ((((j.candidates || [])[0] || {}).content || {}).parts || []).filter(p => !p.thought).map(p => p.text || '').join(''); usage = { prompt_tokens: (j.usageMetadata || {}).promptTokenCount || 0, completion_tokens: (j.usageMetadata || {}).candidatesTokenCount || 0 }; }
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
    return { id: 'direct-' + Date.now(), object: 'chat.completion', model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage };
}

// ====================================================================== #7 STYLE PROFILE
const CODE_RE = /\.(m?[jt]sx?|cjs|py|go|rb|php|java|kt|cs|rs|swift|vue|svelte)$/i;
export function styleProfile(files) {
    const src = files.filter(([p]) => CODE_RE.test(p) && !/node_modules\/|\.min\.|dist\/|build\//.test(p));
    const c = { files: src.length, lines: 0, tabs: 0, sp2: 0, sp4: 0, sq: 0, dq: 0, bt: 0, semi: 0, nosemi: 0, camel: 0, snake: 0, arrow: 0, fn: 0, await: 0, then: 0, esm: 0, cjs: 0, trailing: 0, arComments: 0, enComments: 0, lens: [], cls: 0, letc: 0, constc: 0, varc: 0 };
    for (const [, text] of src) {
        const lines = String(text).split('\n');
        c.lines += lines.length;
        for (const l of lines) {
            const ind = /^( +|\t+)\S/.exec(l);
            if (ind) { if (ind[1][0] === '\t') c.tabs++; else if (ind[1].length % 4 === 0) c.sp4++; else if (ind[1].length % 2 === 0) c.sp2++; }
            if (l.trim()) c.lens.push(l.length);
            const t = l.trim();
            if (/^(\/\/|#|\*|\/\*)/.test(t)) { if (/[\u0600-\u06FF]/.test(t)) c.arComments++; else if (/[a-z]{3}/i.test(t)) c.enComments++; continue; }
            if (/[;]\s*$/.test(t)) c.semi++; else if (/[\w)\]'"`]\s*$/.test(t) && !/^(if|for|while|else|function|class|def|return$)/.test(t) && !/[{(,[]$/.test(t)) c.nosemi++;
            if (/,\s*$/.test(t) && /^\S/.test(t) === false) c.trailing++;
        }
        c.sq += (text.match(/'[^'\n]{0,80}'/g) || []).length;
        c.dq += (text.match(/"[^"\n]{0,80}"/g) || []).length;
        c.bt += (text.match(/`[^`]{0,200}`/g) || []).length;
        (text.match(/\b(?:const|let|var|function|def)\s+([A-Za-z_]\w*)/g) || []).forEach(m => { const n = m.split(/\s+/)[1]; if (/^[a-z]+[A-Z]/.test(n)) c.camel++; else if (/^[a-z]+_[a-z]/.test(n)) c.snake++; });
        c.arrow += (text.match(/=>\s*[{(\w]/g) || []).length;
        c.fn += (text.match(/\bfunction\b/g) || []).length;
        c.await += (text.match(/\bawait\b/g) || []).length;
        c.then += (text.match(/\.then\(/g) || []).length;
        c.esm += (text.match(/^\s*(import|export)\s/mg) || []).length;
        c.cjs += (text.match(/\brequire\(|module\.exports/g) || []).length;
        c.cls += (text.match(/\bclass\s+[A-Z]/g) || []).length;
        c.constc += (text.match(/\bconst\s/g) || []).length; c.letc += (text.match(/\blet\s/g) || []).length; c.varc += (text.match(/\bvar\s/g) || []).length;
    }
    c.lens.sort((a, b) => a - b);
    const p90 = c.lens.length ? c.lens[Math.floor(c.lens.length * 0.9)] : 0;
    const pick = (pairs) => { const best = pairs.sort((a, b) => b[1] - a[1])[0]; return best && best[1] > 0 ? best[0] : null; };
    const all = files.map(([, t]) => t).join('\n');
    const frameworks = [['React', /from ['"]react['"]|React\./], ['Vue', /from ['"]vue['"]|createApp\(/], ['Svelte', /\.svelte|from ['"]svelte/], ['Express', /require\(['"]express['"]\)|from ['"]express['"]/], ['Next.js', /from ['"]next\//], ['Tailwind', /class(Name)?=["'][^"']*\b(flex|px-\d|text-(sm|lg))/], ['jQuery', /\$\(\s*['"]#/], ['Django', /from django/], ['FastAPI', /from fastapi/]].filter(([, re]) => re.test(all)).map(([n]) => n);
    const tests = [['Jest/Vitest', /\b(describe|it|test)\(\s*['"]/], ['pytest', /def test_\w+\(/]].filter(([, re]) => re.test(all)).map(([n]) => n);
    return {
        files: c.files, lines: c.lines,
        indent: pick([['tabs', c.tabs], ['2 spaces', c.sp2], ['4 spaces', c.sp4]]) || '—',
        quotes: pick([['single', c.sq], ['double', c.dq]]) || '—',
        semicolons: c.semi + c.nosemi ? (c.semi / (c.semi + c.nosemi) > 0.6 ? 'always' : c.semi / (c.semi + c.nosemi) < 0.25 ? 'never' : 'mixed') : '—',
        naming: pick([['camelCase', c.camel], ['snake_case', c.snake]]) || '—',
        functions: c.arrow > c.fn * 1.5 ? 'arrow functions' : c.fn > c.arrow * 1.5 ? 'function declarations' : 'mixed',
        async: c.await >= c.then ? 'async/await' : '.then() chains',
        modules: c.esm >= c.cjs ? (c.esm ? 'ES modules' : '—') : 'CommonJS',
        declarations: c.constc + c.letc + c.varc ? (c.varc > c.constc + c.letc ? 'var' : c.constc >= c.letc ? 'const-first' : 'let') : '—',
        comments: c.arComments > c.enComments ? 'Arabic' : c.enComments ? 'English' : '—',
        maxLine: p90, classes: c.cls, frameworks, tests
    };
}
export function styleGuide(p) {
    if (!p || !p.files) return '';
    const rules = [
        p.indent !== '—' && `indent with ${p.indent}`, p.quotes !== '—' && `${p.quotes} quotes for strings`, p.semicolons !== '—' && `semicolons: ${p.semicolons}`,
        p.naming !== '—' && `${p.naming} identifiers`, `prefer ${p.functions}`, `use ${p.async}`, p.modules !== '—' && `${p.modules}`, p.declarations !== '—' && `${p.declarations} declarations`,
        p.comments !== '—' && `write code comments in ${p.comments}`, p.maxLine && `keep lines under ~${Math.max(80, Math.ceil(p.maxLine / 10) * 10)} chars`,
        p.frameworks.length && `stack: ${p.frameworks.join(', ')}`, p.tests.length && `tests: ${p.tests.join(', ')}`
    ].filter(Boolean);
    return 'USER CODING STYLE (learned from their project — match it in every code answer): ' + rules.join('; ') + '.';
}
/** Functions in the project → chat fine-tune examples (OpenAI / Together / Unsloth JSONL). */
export function fineTuneExamples(files, { max = 400, system = 'You write code exactly in this developer\'s personal style.' } = {}) {
    const out = [];
    for (const [path, text] of files.filter(([p]) => CODE_RE.test(p) && !/node_modules\/|\.min\.|test|spec/.test(p))) {
        const lines = String(text).split('\n');
        for (let i = 0; i < lines.length && out.length < max; i++) {
            const m = /^(\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(?([^)=]*)\)?\s*=>|def\s+([A-Za-z_]\w*)\s*\(([^)]*)\))/.exec(lines[i]);
            if (!m) continue;
            const ind = m[1].length, name = m[2] || m[4] || m[6], params = (m[3] || m[5] || m[7] || '').trim();
            let j = i + 1;
            if (m[6]) { while (j < lines.length && (!lines[j].trim() || /^\s*/.exec(lines[j])[0].length > ind)) j++; }
            else { let depth = 0, seen = false; for (j = i; j < lines.length; j++) { for (const ch of lines[j]) { if (ch === '{') { depth++; seen = true; } else if (ch === '}') depth--; } if (seen && depth <= 0) { j++; break; } if (!seen && j > i && /;\s*$/.test(lines[j])) { j++; break; } } }
            const body = lines.slice(i, j).join('\n');
            const n = j - i;
            if (n < 3 || n > 80) continue;
            const doc = []; for (let k = i - 1; k >= 0 && /^\s*(\/\/|\*|\/\*\*|#)/.test(lines[k]); k--) doc.unshift(lines[k].replace(/^\s*(\/\/+|\/\*\*|\*\/|\*|#)\s?/, '').trim());
            const what = doc.filter(Boolean).join(' ') || `the \`${name}\` function used in ${path}`;
            out.push({ messages: [{ role: 'system', content: system }, { role: 'user', content: `Write \`${name}(${params})\` — ${what}` }, { role: 'assistant', content: body }] });
            i = j - 1;
        }
    }
    return out;
}
const TRAIN_PY = `# LoRA fine-tune on your own code (generated by OX-Alpha). Run on a GPU: Google Colab / Kaggle / RunPod.
# pip install unsloth trl datasets
from unsloth import FastLanguageModel
from datasets import load_dataset
from trl import SFTTrainer, SFTConfig

BASE = "unsloth/Qwen2.5-Coder-7B-Instruct-bnb-4bit"   # any chat model works
model, tok = FastLanguageModel.from_pretrained(BASE, max_seq_length=4096, load_in_4bit=True)
model = FastLanguageModel.get_peft_model(model, r=16, lora_alpha=16, lora_dropout=0,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"])
ds = load_dataset("json", data_files="dataset.jsonl", split="train")
ds = ds.map(lambda ex: {"text": tok.apply_chat_template(ex["messages"], tokenize=False)})
trainer = SFTTrainer(model=model, tokenizer=tok, train_dataset=ds,
    args=SFTConfig(dataset_text_field="text", per_device_train_batch_size=2, gradient_accumulation_steps=4,
                   num_train_epochs=2, learning_rate=2e-4, logging_steps=10, output_dir="out"))
trainer.train()
model.save_pretrained("my-style-lora")      # adapter only (~50 MB)
# model.save_pretrained_gguf("my-style-gguf", tok, quantization_method="q4_k_m")  # for Ollama / LM Studio
`;

// ====================================================================== #35 PROMPT MARKET
export const MARKET_DEFAULT = { repo: 'naderba69/daschai', branch: 'main', path: 'community/prompts.json' };
export function filterMarket(list, { q = '', cat = 'all', sort = 'stars', likes = {} } = {}) {
    const n = (s) => String(s || '').toLowerCase();
    const words = n(q).split(/\s+/).filter(Boolean);
    let out = (list || []).filter(p => p && p.text && (cat === 'all' || p.cat === cat) && words.every(w => n(p.title + ' ' + p.text + ' ' + (p.tags || []).join(' ') + ' ' + (p.author || '')).includes(w)));
    const score = (p) => (p.stars || 0) + (likes[p.id] ? 1 : 0);
    out = out.slice().sort(sort === 'new' ? (a, b) => String(b.date || '').localeCompare(String(a.date || '')) : sort === 'title' ? (a, b) => String(a.title).localeCompare(String(b.title), 'ar') : (a, b) => score(b) - score(a));
    return out;
}
export function validatePrompt(p) {
    const errs = [];
    if (!p || typeof p !== 'object') return ['ليس كائناً'];
    if (!String(p.title || '').trim()) errs.push('العنوان مطلوب');
    if (String(p.text || '').trim().length < 20) errs.push('نص البرومبت قصير جداً (20 حرفاً على الأقل)');
    if (String(p.text || '').length > 8000) errs.push('نص البرومبت طويل جداً');
    return errs;
}

// ====================================================================== #1008 PROJECT MEMORY
export function projectCard(files, { repo = '', name = '' } = {}) {
    const get = (p) => (files.find(([q]) => q === p) || [])[1];
    let pkg = null; try { pkg = JSON.parse(get('package.json') || 'null'); } catch (e) { pkg = null; }
    const exts = {};
    files.forEach(([p]) => { const e = (/\.([a-z0-9]+)$/i.exec(p) || [])[1]; if (e) exts[e.toLowerCase()] = (exts[e.toLowerCase()] || 0) + 1; });
    const deps = pkg ? Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }) : [];
    const readme = (get('README.md') || get('readme.md') || '').replace(/[#>*`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 400);
    const todos = files.reduce((n, [, t]) => n + (String(t).match(/\b(TODO|FIXME)\b/g) || []).length, 0);
    const title = name || (pkg && pkg.name) || (repo ? repo.split('/').pop() : '') || (files[0] ? files[0][0].split('/')[0] : 'project');
    return {
        id: (repo || title).toLowerCase(), name: title, repo, description: (pkg && pkg.description) || readme.slice(0, 160),
        stack: [...new Set([...Object.entries(exts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([e]) => e), ...deps.filter(d => /^(react|vue|svelte|next|express|fastify|tailwindcss|vite|typescript|prisma|mongoose|three|@supabase\/supabase-js|firebase|stripe)$/.test(d))])],
        files: files.length, todos, readme, keyFiles: files.map(([p]) => p).filter(p => !/node_modules|\.lock$|^dist\//.test(p)).slice(0, 25), updated: Date.now()
    };
}
export function rankCards(cards, query, k = 3) {
    const tok = (s) => String(s || '').toLowerCase().split(/[^a-z0-9\u0600-\u06FF]+/).filter(w => w.length > 2);
    const q = new Set(tok(query));
    if (!q.size) return [];
    return cards.map(c => { const words = tok([c.name, c.repo, c.description, c.stack.join(' '), c.readme, (c.notes || []).join(' '), c.keyFiles.join(' ')].join(' ')); let s = 0; words.forEach(w => { if (q.has(w)) s++; }); if (q.has(String(c.name).toLowerCase())) s += 5; return { c, s }; })
        .filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k).map(x => x.c);
}
export function memoryPrompt(cards, query) {
    if (!cards.length) return '';
    const all = /(مشاريعي|كل المشاريع|my projects|all (my )?projects|which project)/i.test(query || '');
    const pick = all ? cards.slice(0, 12) : rankCards(cards, query, 3);
    if (!pick.length) return '';
    return 'MEMORY OF THE USER\'S PROJECTS (persistent across sessions; use when relevant):\n' + pick.map(c => `- ${c.name}${c.repo ? ' (' + c.repo + ')' : ''}: ${c.description || '—'} | stack: ${c.stack.join(', ') || '—'} | ${c.files} files${c.todos ? ', ' + c.todos + ' TODOs' : ''}${(c.notes || []).length ? ' | notes: ' + c.notes.slice(-3).join(' / ') : ''}`).join('\n');
}

export function installAI(P) {
    // ---------------------------------------------------------------- #981 direct providers
    P.ixDirectCfg = function () { return this.ixCfg('direct'); };
    P.ixDirectRoute = function (model) { return directRoute(model, this.ixDirectCfg()); };
    P.ixDirectHook = function () {
        const app = this;
        const wrap = (G) => {
            if (!G || !G.fetch || G.fetch.__oxDirect) return;
            const orig = G.fetch;
            const f = function (u, o) {
                if (typeof u === 'string' && u.indexOf('openrouter.ai/api/v1/chat/completions') >= 0 && o && typeof o.body === 'string') {
                    let model = null; try { model = JSON.parse(o.body).model; } catch (e) { /* ignore */ }
                    if (app.ixDirectRoute(model)) return app.ixFetch(u, o, orig.bind(G));
                }
                return orig.apply(this, arguments);
            };
            f.__oxDirect = true; f.__orig = orig;
            G.fetch = f;
        };
        if (typeof window !== 'undefined') wrap(window);
        if (typeof globalThis !== 'undefined' && globalThis !== (typeof window !== 'undefined' ? window : null)) wrap(globalThis);
        return true;
    };
    P._ixBootFns.direct = function () { this.ixDirectHook(); };
    /** Serve an OpenRouter-shaped chat request from the provider directly and answer in OpenRouter format. */
    P.ixFetch = async function (url, opts = {}, origFetch) {
        const send = origFetch || ((typeof window !== 'undefined' && window.fetch && window.fetch.__orig) || fetch);
        const body = JSON.parse(opts.body || '{}');
        const r = this.ixDirectRoute(body.model);
        if (!r) return send(url, opts);
        const cfg = this.ixDirectCfg(), key = String(cfg[r.provider]).trim();
        let target, req, headers = { 'Content-Type': 'application/json' };
        if (r.provider === 'openai') { target = DIRECT.openai.url; req = toOpenAI(body, r.model); headers.Authorization = 'Bearer ' + key; }
        else if (r.provider === 'anthropic') { target = DIRECT.anthropic.url; req = toAnthropic(body, r.model); headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01'; headers['anthropic-dangerous-direct-browser-access'] = 'true'; }
        else { target = DIRECT.google.url + encodeURIComponent(r.model) + (body.stream ? ':streamGenerateContent?alt=sse' : ':generateContent'); req = toGemini(body); headers['x-goog-api-key'] = key; }
        this._ixDirectLog = [{ at: Date.now(), provider: r.provider, model: r.model }, ...(this._ixDirectLog || [])].slice(0, 20);
        const res = await send(target, { method: 'POST', headers, body: JSON.stringify(req), signal: opts.signal });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            let msg = t; try { const j = JSON.parse(t); msg = (j.error && (j.error.message || j.error)) || j.message || t; } catch (e) { /* text */ }
            return new Response(JSON.stringify({ error: { message: `${DIRECT[r.provider].label} (مباشر): ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`.slice(0, 600) } }), { status: res.status, headers: { 'content-type': 'application/json' } });
        }
        if (r.provider === 'openai') return res;
        if (body.stream) return new Response(translateStream(res.body, r.provider, body.model), { status: 200, headers: { 'content-type': 'text/event-stream' } });
        return new Response(JSON.stringify(translateJSON(r.provider, await res.json(), body.model)), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    P.ixDirectSave = function () {
        const cfg = this.ixSaveForm('direct', { on: 'ix-dir-on', openai: 'ix-dir-openai', anthropic: 'ix-dir-anthropic', google: 'ix-dir-google' }, { toast: false });
        const mapText = (document.getElementById('ix-dir-map') || {}).value || '';
        const map = {}; mapText.split('\n').forEach(l => { const m = /^\s*(\S+)\s*(?:=>|=|→)\s*(\S+)\s*$/.exec(l); if (m) map[m[1]] = m[2]; });
        this.ixSave('direct', { map });
        this.ixBootSet('direct', !!cfg.on);
        if (cfg.on) { this.ixDirectHook(); if (!String(this.settings.apiKey || '').trim()) { this.settings.apiKey = 'direct-only'; if (this.persistSettings) this.persistSettings(); } }
        this.showToast(cfg.on ? '✅ التوجيه المباشر مفعّل' : 'تم إيقاف التوجيه المباشر', 'success');
        return this.ixDirectCfg();
    };
    P.ixDirectTest = async function (provider) {
        const models = { openai: 'openai/gpt-4o-mini', anthropic: 'anthropic/claude-3.5-haiku', google: 'google/gemini-2.0-flash' };
        this.ixBusy('ix-dir-res', 'اختبار ' + DIRECT[provider].label + '…');
        try {
            const res = await this.ixFetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: models[provider], messages: [{ role: 'user', content: 'Reply with: OK' }], max_tokens: 10 }) });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error ? j.error.message : 'HTTP ' + res.status);
            const text = j.choices[0].message.content;
            this.ixOut('ix-dir-res', `<div class="gh-empty">✅ ${esc(DIRECT[provider].label)}: ${esc(text)}</div>`);
            return text;
        } catch (e) { return this.ixErr(e, 'ix-dir-res'); }
    };
    P.ixDirect = async function () {
        const c = this.ixDirectCfg();
        const map = Object.entries(c.map || {}).map(([a, b]) => a + ' => ' + b).join('\n');
        return card('مزودون مباشرون — دون المرور بـ OpenRouter', `<p class="hv-dim">عند التفعيل، أي نموذج يبدأ بـ <code>openai/</code> أو <code>anthropic/</code> أو <code>google/</code> يُرسل مباشرة إلى المزود بمفتاحك (المحادثة، والوكيل، وكل الميزات). الردود تُحوَّل إلى نفس صيغة OpenRouter، فيعمل البث والتفكير وعدّاد الرموز كما هي. النماذج الأخرى تبقى عبر OpenRouter. المفاتيح تُحفظ في هذا الجهاز فقط.</p>
            ${toggle('ix-dir-on', 'تفعيل التوجيه المباشر', !!c.on)}
            <div class="fmx-grid2">${Object.entries(DIRECT).map(([k, d]) => field('ix-dir-' + k, d.label + ' API key', c[k] || '', `type="password" dir="ltr" autocomplete="off" placeholder="${d.keyHint}"`)).join('')}</div>
            ${area('ix-dir-map', 'تحويل أسماء النماذج (اختياري): معرّف OpenRouter => المعرّف الأصلي', map, 3, 'dir="ltr" placeholder="anthropic/claude-sonnet-4.5 => claude-sonnet-4-5-20250929"')}
            <div class="gh-row">${pbtn('fa-floppy-disk', 'حفظ', 'app.ixDirectSave()')}${Object.keys(DIRECT).map(k => btn('fa-vial', 'اختبار ' + DIRECT[k].label, call('ixDirectTest', k))).join('')}</div>
            <div id="ix-dir-res"></div>
            ${(this._ixDirectLog || []).length ? table(['الوقت', 'المزود', 'النموذج'], this._ixDirectLog.map(l => [ago(l.at), DIRECT[l.provider].label, code(l.model)])) : ''}`, 'fa-route');
    };

    // ---------------------------------------------------------------- #7 style profile + LoRA dataset
    P.ixStyleProfile = function () { const p = styleProfile(this.ixFiles()); this._ixStyle = p; return p; };
    P.ixStyleApply = function (on) {
        const p = this.ixStyleProfile();
        this.ixSave('style', { on: !!on, guide: on ? styleGuide(p) : '' });
        this.ixBootSet('style', !!on);
        if (on) this.ixHookPayload();
        this.showToast(on ? '✅ سيكتب الذكاء الاصطناعي الكود بأسلوبك في المحادثة' : 'أُوقف تطبيق الأسلوب', 'success');
        return this.ixCfg('style');
    };
    P.ixStyleDataset = function () {
        const ex = fineTuneExamples(this.ixFiles());
        if (!ex.length) { this.showToast('لا توجد دوال كافية في المشروع لبناء بيانات التدريب', 'warning'); return null; }
        const jsonl = ex.map(e => JSON.stringify(e)).join('\n') + '\n';
        const readme = `# Fine-tune على أسلوبك\n\n- \`dataset.jsonl\`: ${ex.length} مثالاً بصيغة chat (OpenAI / Together / Fireworks / Unsloth)\n- \`train_lora.py\`: تدريب LoRA بـ Unsloth على GPU (Colab مجاني يكفي لنموذج 7B بدقة 4-bit)\n\nبعد التدريب: ارفع المحوّل (adapter) إلى Hugging Face، أو حوّله إلى GGUF لتشغيله في Ollama، ثم اختره في OX-Alpha عبر مزود متوافق مع OpenAI.\n\nللتدريب السحابي دون GPU: \`openai api fine_tuning.jobs.create -t dataset.jsonl -m gpt-4o-mini-2024-07-18\`.\n`;
        this.ixWriteFiles('بيانات التدريب', { 'finetune/dataset.jsonl': jsonl, 'finetune/train_lora.py': TRAIN_PY, 'finetune/README.md': readme }, { open: false });
        return ex.length;
    };
    P.ixStyle = async function () {
        const p = this.ixStyleProfile(), c = this.ixCfg('style');
        const rows = [['المسافة البادئة', p.indent], ['علامات النص', p.quotes], ['الفواصل المنقوطة', p.semicolons], ['التسمية', p.naming], ['الدوال', p.functions], ['اللاتزامن', p.async], ['الوحدات', p.modules], ['التعريفات', p.declarations], ['لغة التعليقات', p.comments], ['طول السطر (p90)', p.maxLine], ['الأطر', p.frameworks.join('، ') || '—'], ['الاختبارات', p.tests.join('، ') || '—']];
        return card('بصمة أسلوبك في الكتابة', `<p class="hv-dim">تدريب LoRA الحقيقي يحتاج GPU ولا يمكن تشغيله داخل المتصفح. لذلك هناك طريقتان: <b>(1)</b> مُحوّل أسلوب فوري يستخرج قواعدك من ملفات المشروع ويحقنها في كل محادثة، و<b>(2)</b> بيانات تدريب JSONL جاهزة مع سكربت LoRA (Unsloth) لتدريب نموذجك على Colab أو أي GPU.</p>
            ${stats([['ملفات كود', p.files], ['أسطر', p.lines]])}
            ${table(['السمة', 'أسلوبك'], rows.map(([a, b]) => [a, esc(String(b))]))}
            ${pre(styleGuide(p) || '—')}
            <div class="gh-row">${toggle('ix-style-on', 'تطبيق أسلوبي في المحادثة', !!c.on, 'onchange="app.ixStyleApply(this.checked)"')}${pbtn('fa-file-export', 'إنشاء بيانات LoRA', 'app.ixStyleDataset()', p.files ? '' : 'disabled')}</div>`, 'fa-fingerprint');
    };
    /** Inject style guide + project memory into every chat request (wraps the AI-lab payload hook). */
    P.ixHookPayload = function () {
        if (P.__ixPayloadHooked) return;
        const orig = P.transformChatPayload;
        if (!orig) return;
        P.__ixPayloadHooked = true;
        P.transformChatPayload = async function (payload, session, opts = {}) {
            let out = await orig.call(this, payload, session, opts);
            if (opts && opts.autoContinuePass) return out;
            const extra = [];
            const st = this.ixCfg('style');
            if (st.on && st.guide) extra.push(st.guide);
            if (this.ixCfg('memory').on) {
                const q = [...((session && session.messages) || [])].reverse().find(m => m.role === 'user');
                const mem = memoryPrompt(this.ixProjects(), q ? String(q.content || '') : '');
                if (mem) extra.push(mem);
            }
            if (extra.length && out && out[0] && out[0].role === 'system') out = [{ ...out[0], content: out[0].content + '\n\n' + extra.join('\n\n') }, ...out.slice(1)];
            return out;
        };
    };
    P._ixBootFns.style = function () { this.ixHookPayload(); };

    // ---------------------------------------------------------------- #35 prompt market
    P.ixMarketCfg = function () { return { ...MARKET_DEFAULT, ...this.ixCfg('market') }; };
    P.ixMarketLoad = async function (force) {
        if (this._ixMarket && !force) return this._ixMarket;
        const c = this.ixMarketCfg();
        const data = await this.ixHttp(`https://raw.githubusercontent.com/${c.repo}/${c.branch}/${c.path}`);
        const list = (Array.isArray(data) ? data : (data && data.prompts) || []).filter(p => !validatePrompt(p).length);
        this._ixMarket = list;
        return list;
    };
    P.ixMarketInstall = function (id) {
        const p = (this._ixMarket || []).find(x => x.id === id);
        if (!p) return null;
        const KEY = 'ox_alpha_prompts_v1';
        let saved;
        if (this.savePrompt && !this.savePrompt.__oxLazy) saved = this.savePrompt({ title: p.title, text: p.text, cat: p.cat || 'المجتمع', tags: [...(p.tags || []), 'community'] });
        else {
            const list = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } })();
            saved = { id: uid('up'), title: p.title, text: p.text, cat: p.cat || 'المجتمع', tags: [...(p.tags || []), 'community'], ts: Date.now() };
            list.unshift(saved); localStorage.setItem(KEY, JSON.stringify(list));
        }
        const inst = this.ixCfg('market').installed || [];
        this.ixSave('market', { installed: [...new Set([...inst, id])] });
        this.showToast('✅ أُضيف إلى مكتبة البرومبتات: ' + this.escapeHTML(p.title), 'success');
        return saved;
    };
    P.ixMarketLike = function (id) { const likes = { ...(this.ixCfg('market').likes || {}) }; likes[id] = !likes[id]; this.ixSave('market', { likes }); this.ixMarketRender(); return likes[id]; };
    P.ixMarketRender = function () {
        const el = document.getElementById('ix-mk-list');
        if (!el) return;
        const c = this.ixCfg('market');
        const q = (document.getElementById('ix-mk-q') || {}).value || '', cat = (document.getElementById('ix-mk-cat') || {}).value || 'all', sort = (document.getElementById('ix-mk-sort') || {}).value || 'stars';
        const list = filterMarket(this._ixMarket || [], { q, cat, sort, likes: c.likes || {} });
        const inst = new Set(c.installed || []);
        el.innerHTML = list.length ? list.map(p => `<div class="fmx-item ix-prompt"><div><b>${esc(p.title)}</b> <span class="gh-chip">${esc(p.cat || '')}</span> <small class="hv-dim">⭐ ${(p.stars || 0) + ((c.likes || {})[p.id] ? 1 : 0)} • ${esc(p.author || 'community')}</small><small>${esc(String(p.text).slice(0, 220))}${p.text.length > 220 ? '…' : ''}</small></div>
            <div class="gh-row">${btn((c.likes || {})[p.id] ? 'fa-heart' : 'fa-heart-crack', '', call('ixMarketLike', p.id), 'sidebar-btn-util gh-btn')}${inst.has(p.id) ? '<span class="gh-chip">✓ مثبّت</span>' : pbtn('fa-download', 'تثبيت', call('ixMarketInstall', p.id))}</div></div>`).join('') : empty('لا نتائج');
    };
    P.ixMarketPublish = async function () {
        const p = { id: 'p-' + Date.now().toString(36), title: (document.getElementById('ix-mk-title') || {}).value || '', cat: (document.getElementById('ix-mk-pcat') || {}).value || 'عام', text: (document.getElementById('ix-mk-text') || {}).value || '', tags: String((document.getElementById('ix-mk-tags') || {}).value || '').split(/[,،]\s*/).filter(Boolean), author: this.settings.githubOwner || 'anonymous', date: new Date().toISOString().slice(0, 10), stars: 0 };
        const errs = validatePrompt(p);
        if (errs.length) { this.showToast(errs.join(' • '), 'warning'); return null; }
        const c = this.ixMarketCfg();
        const json = JSON.stringify(p, null, 2);
        if (!String(this.settings.githubToken || '').trim()) {
            if (this.copyText) await this.copyText(json);
            const url = `https://github.com/${c.repo}/issues/new?title=${encodeURIComponent('[prompt] ' + p.title)}&body=${encodeURIComponent('```json\n' + json + '\n```')}`;
            window.open(url, '_blank', 'noopener');
            this.showToast('نُسخ البرومبت — أكمل النشر في صفحة GitHub', 'info');
            return { url };
        }
        try {
            const gist = await this.gh('/gists', { method: 'POST', body: { description: '#oxprompt ' + p.title, public: true, files: { 'ox-prompt.json': { content: json } } } });
            const issue = await this.gh(`/repos/${c.repo}/issues`, { method: 'POST', body: { title: '[prompt] ' + p.title, body: `برومبت جديد لسوق OX-Alpha\n\nGist: ${gist.html_url || gist.id}\n\n\`\`\`json\n${json}\n\`\`\``, labels: ['prompt-market'] } }).catch(() => null);
            const mine = this.ixCfg('market').published || [];
            this.ixSave('market', { published: [{ id: p.id, title: p.title, gist: gist.html_url || gist.id, issue: issue && issue.html_url, at: Date.now() }, ...mine].slice(0, 50) });
            this.showToast('✅ نُشر البرومبت — سيظهر في السوق بعد المراجعة', 'success');
            return { gist, issue };
        } catch (e) { return this.ixErr(e); }
    };
    P.ixPrompts = async function () {
        let list = [], err = '';
        try { list = await this.ixMarketLoad(); } catch (e) { err = e.message; }
        const cats = [...new Set(list.map(p => p.cat).filter(Boolean))];
        const c = this.ixMarketCfg();
        this._ixMount = () => this.ixMarketRender();
        return card('سوق البرومبتات', `<p class="hv-dim">برومبتات يشاركها المجتمع من فهرس عام على GitHub (<code dir="ltr">${esc(c.repo)}/${esc(c.path)}</code>). التثبيت يضيف البرومبت إلى مكتبتك. النشر ينشئ Gist عاماً ويفتح طلب مراجعة (Issue) لإضافته إلى الفهرس.</p>
            ${err ? empty('⚠ تعذر تحميل الفهرس: ' + esc(err), true) : ''}
            <div class="gh-row"><input id="ix-mk-q" class="form-input-box" placeholder="ابحث…" oninput="app.ixMarketRender()">${select('ix-mk-cat', 'الفئة', [['all', 'الكل'], ...cats.map(x => [x, x])], 'all', 'onchange="app.ixMarketRender()"')}${select('ix-mk-sort', 'الترتيب', [['stars', 'الأعلى تقييماً'], ['new', 'الأحدث'], ['title', 'الاسم']], 'stars', 'onchange="app.ixMarketRender()"')}${btn('fa-rotate', '', 'app._ixMarket=null;app.ixRefresh()')}</div>
            <div id="ix-mk-list"></div>`, 'fa-store')
            + card('انشر برومبتاً', `<div class="fmx-grid2">${field('ix-mk-title', 'العنوان', '')}${field('ix-mk-pcat', 'الفئة', 'برمجة')}</div>${area('ix-mk-text', 'نص البرومبت (استخدم {{متغير}} للحقول)', '', 4)}${field('ix-mk-tags', 'وسوم (مفصولة بفواصل)', '')}
            <div class="gh-row">${pbtn('fa-upload', 'نشر للمجتمع', 'app.ixMarketPublish()')}</div>
            ${(this.ixCfg('market').published || []).length ? table(['العنوان', 'Gist', 'المراجعة'], this.ixCfg('market').published.map(x => [esc(x.title), `<a href="${esc(x.gist)}" target="_blank" rel="noopener">Gist</a>`, x.issue ? `<a href="${esc(x.issue)}" target="_blank" rel="noopener">Issue</a>` : '—'])) : ''}`, 'fa-upload');
    };

    // ---------------------------------------------------------------- #1008 project memory
    const PKEY = 'ox_ix_projects_v1';
    P.ixProjects = function () { try { return JSON.parse(localStorage.getItem(PKEY)) || []; } catch (e) { return []; } };
    P.ixProjectsSave = function (list) { localStorage.setItem(PKEY, JSON.stringify(list.slice(0, 200))); };
    P.ixRememberProject = function () {
        const files = this.ixFiles();
        if (!files.length) return null;
        const repo = this.settings.githubOwner && this.settings.githubRepo ? `${this.settings.githubOwner}/${this.settings.githubRepo}` : '';
        const card = projectCard(files, { repo });
        const list = this.ixProjects();
        const i = list.findIndex(c => c.id === card.id);
        if (i >= 0) list[i] = { ...list[i], ...card, notes: list[i].notes || [] }; else list.unshift({ ...card, notes: [] });
        this.ixProjectsSave(list);
        return card;
    };
    P.ixImportRepos = async function () {
        if (!String(this.settings.githubToken || '').trim()) { this.showToast('يلزم رمز GitHub', 'warning'); return 0; }
        try {
            const repos = await this.gh('/user/repos?per_page=100&sort=updated');
            const list = this.ixProjects();
            let n = 0;
            (repos || []).forEach(r => {
                const id = String(r.full_name).toLowerCase();
                const card = { id, name: r.name, repo: r.full_name, description: r.description || '', stack: [r.language, ...(r.topics || [])].filter(Boolean).map(s => String(s).toLowerCase()), files: 0, todos: 0, readme: '', keyFiles: [], updated: Date.parse(r.pushed_at || r.updated_at) || Date.now(), stars: r.stargazers_count || 0 };
                const i = list.findIndex(c => c.id === id);
                if (i >= 0) list[i] = { ...card, ...list[i], description: list[i].description || card.description, stack: list[i].stack.length ? list[i].stack : card.stack }; else { list.push({ ...card, notes: [] }); n++; }
            });
            this.ixProjectsSave(list);
            this.showToast(`✅ أُضيف ${n} مستودعاً إلى الذاكرة`, 'success');
            this.ixRefresh();
            return n;
        } catch (e) { return this.ixErr(e); }
    };
    P.ixProjectNote = async function (id) {
        const text = await this.askText('ملاحظة دائمة عن المشروع', '', { placeholder: 'مثال: نستخدم Tailwind ونفضّل Zustand لإدارة الحالة' });
        if (!text) return null;
        const list = this.ixProjects();
        const c = list.find(x => x.id === id);
        if (!c) return null;
        c.notes = [...(c.notes || []), String(text).slice(0, 300)].slice(-20);
        this.ixProjectsSave(list);
        this.ixRefresh();
        return c;
    };
    P.ixProjectForget = function (id) { this.ixProjectsSave(this.ixProjects().filter(c => c.id !== id)); this.ixRefresh(); };
    P.ixMemoryToggle = function (on) {
        this.ixSave('memory', { on: !!on });
        this.ixBootSet('memory', !!on);
        if (on) { this.ixRememberProject(); this.ixHookPayload(); }
        return !!on;
    };
    P._ixBootFns.memory = function () {
        this.ixHookPayload();
        setTimeout(() => { try { this.ixRememberProject(); } catch (e) { /* ignore */ } }, 3000);
        if (!this._ixMemTimer) this._ixMemTimer = setInterval(() => { try { this.ixRememberProject(); } catch (e) { /* ignore */ } }, 10 * 60 * 1000);
    };
    P.ixMemorySearch = function () {
        const q = (document.getElementById('ix-mem-q') || {}).value || '';
        const hits = q ? rankCards(this.ixProjects(), q, 8) : [];
        this.ixOut('ix-mem-res', q ? (hits.length ? hits.map(c => `<div class="fmx-item"><div><b>${esc(c.name)}</b><small>${esc(c.description || '')}</small></div></div>`).join('') : empty('لا توجد مشاريع مطابقة')) : '');
        return hits;
    };
    P.ixMemory = async function () {
        const list = this.ixProjects(), c = this.ixCfg('memory');
        return card('مساعد يتذكر كل مشاريعك', `<p class="hv-dim">بطاقة لكل مشروع عملت عليه (التقنيات، والملفات الأساسية، والوصف، وملاحظاتك الدائمة)، وتُضاف مستودعاتك على GitHub. عند التفعيل تُرفق البطاقات المتعلقة بسؤالك في كل محادثة، مهما كانت الجلسة أو المشروع المفتوح. اسأل مثلاً: «ما المشاريع التي استخدمت فيها Stripe؟». كل البيانات محلية.</p>
            <div class="gh-row">${toggle('ix-mem-on', 'تفعيل الذاكرة في المحادثة', !!c.on, 'onchange="app.ixMemoryToggle(this.checked)"')}${pbtn('fa-camera', 'تذكّر المشروع الحالي', 'app.ixRememberProject();app.ixRefresh()')}${btn('fa-code-branch', 'استيراد مستودعاتي', 'app.ixImportRepos()')}</div>
            <div class="gh-row"><input id="ix-mem-q" class="form-input-box" placeholder="ابحث في مشاريعك…" oninput="app.ixMemorySearch()"></div><div id="ix-mem-res"></div>
            ${list.length ? table(['المشروع', 'التقنيات', 'الملفات', 'ملاحظات', ''], list.slice(0, 80).map(p => [`<b>${esc(p.name)}</b><br><small class="hv-dim">${esc((p.description || '').slice(0, 90))}</small>`, esc(p.stack.join(', ')), p.files || '—', esc((p.notes || []).slice(-1)[0] || '—'), btn('fa-note-sticky', '', call('ixProjectNote', p.id), 'gh-chip') + btn('fa-trash', '', call('ixProjectForget', p.id), 'gh-chip')])) : empty('لا توجد مشاريع محفوظة بعد')}`, 'fa-brain');
    };
}
