/* Local code analyzers (no network, deterministic). Each returns findings the UI shows directly
   and that generators pass to the model as extra context.
   #45 regex explainer • #51 Big-O estimate • #48 N+1 queries • #57 memory leaks • #25 naming
   #24 design patterns / smells • #60 unused deps • #59/#90 lighter & newer alternatives
   #88 outdated deps (npm registry) • #56/#87 legacy → modern • #81-#84 company standards */

// ------------------------------------------------------------------ helpers
/** Blank out strings and comments (keeps offsets/line numbers). */
export function maskCode(code) {
    return String(code || '').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|#(?![!{\[])[^\n]*$|(["'`])(?:\\[\s\S]|(?!\1)[^\\\n])*\1/gm, (m) => m.replace(/[^\n]/g, ' '));
}
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

// ------------------------------------------------------------------ #45 REGEX EXPLAINER
const ESCAPES = { d: 'رقم (0-9)', D: 'أي شيء غير رقم', w: 'حرف أو رقم أو _', W: 'أي شيء غير حرف/رقم/_', s: 'مسافة بيضاء', S: 'أي شيء غير مسافة', b: 'حد كلمة', B: 'ليس حد كلمة', n: 'سطر جديد', t: 'Tab', r: 'رجوع العربة' };
const quant = (q) => {
    const lazy = q.endsWith('?') && q.length > 1 ? ' (أقل عدد ممكن)' : q.endsWith('+') && q.length > 1 ? ' (استحواذي)' : '';
    const b = lazy ? q.slice(0, -1) : q;
    if (b === '*') return 'صفر مرة أو أكثر' + lazy;
    if (b === '+') return 'مرة أو أكثر' + lazy;
    if (b === '?') return 'اختياري (صفر أو مرة)';
    const m = /^\{(\d+)(,(\d*))?\}$/.exec(b);
    if (m) return (m[2] ? (m[3] ? `من ${m[1]} إلى ${m[3]} مرات` : `${m[1]} مرات أو أكثر`) : `بالضبط ${m[1]} مرات`) + lazy;
    return b;
};
export function explainRegex(input) {
    let src = String(input || '').trim(), flags = '';
    const lit = /^\/([\s\S]+)\/([a-z]*)$/.exec(src);
    if (lit) { src = lit[1]; flags = lit[2]; }
    let valid = true, error = '';
    try { new RegExp(src, flags.replace(/[^dgimsuyv]/g, '')); } catch (e) { valid = false; error = e.message; }
    const parts = [];
    let i = 0, depth = 0;
    const push = (token, desc) => parts.push({ token, desc, depth });
    while (i < src.length) {
        const c = src[i];
        let token = c, desc = '';
        if (c === '\\') {
            const n = src[i + 1] || '';
            token = c + n; i++;
            if (ESCAPES[n]) desc = ESCAPES[n];
            else if (/\d/.test(n)) desc = `نفس نص المجموعة رقم ${n}`;
            else if (n === 'u' || n === 'x') { const m = /^(u\{[\da-f]+\}|u[\da-f]{4}|x[\da-f]{2})/i.exec(src.slice(i)); if (m) { token = '\\' + m[1]; i += m[1].length - 1; } desc = 'محرف بترميزه'; }
            else desc = `المحرف «${n}» حرفياً`;
        } else if (c === '[') {
            let j = i + 1; if (src[j] === '^') j++; if (src[j] === ']') j++;
            while (j < src.length && src[j] !== ']') { if (src[j] === '\\') j++; j++; }
            token = src.slice(i, j + 1); i = j;
            const neg = token[1] === '^';
            const inner = token.slice(neg ? 2 : 1, -1).replace(/\\([dws])/g, (_, k) => ESCAPES[k] + '، ');
            desc = `${neg ? 'أي محرف ما عدا' : 'محرف واحد من'}: ${inner}`;
        } else if (c === '(') {
            const look = { '?:': 'مجموعة بدون حفظ', '?=': 'يليه (نظرة للأمام)', '?!': 'لا يليه (نظرة سلبية للأمام)', '?<=': 'يسبقه (نظرة للخلف)', '?<!': 'لا يسبقه (نظرة سلبية للخلف)' };
            const key = Object.keys(look).sort((a, b) => b.length - a.length).find(k => src.startsWith(k, i + 1));
            const named = /^\?<([A-Za-z_]\w*)>/.exec(src.slice(i + 1));
            if (named) { token = '(?<' + named[1] + '>'; i += named[0].length; desc = `بداية مجموعة مسماة «${named[1]}»`; }
            else if (key) { token = '(' + key; i += key.length; desc = 'بداية ' + look[key]; }
            else desc = 'بداية مجموعة (تُحفظ)';
            push(token, desc); depth++; i++; continue;
        } else if (c === ')') { depth = Math.max(0, depth - 1); desc = 'نهاية المجموعة'; }
        else if (c === '|') desc = 'أو';
        else if (c === '^') desc = 'بداية النص/السطر';
        else if (c === '$') desc = 'نهاية النص/السطر';
        else if (c === '.') desc = 'أي محرف (ما عدا سطر جديد)';
        else if ('*+?'.includes(c) || c === '{') {
            const m = /^(\*|\+|\?|\{\d+(,\d*)?\})[?+]?/.exec(src.slice(i));
            if (m) { token = m[0]; i += m[0].length - 1; desc = 'تكرار السابق: ' + quant(m[0]); }
        } else desc = `المحرف «${c}»`;
        // merge runs of literal characters
        const last = parts[parts.length - 1];
        if (/^المحرف «/.test(desc) && last && last.literal && last.depth === depth) { last.token += token; last.desc = `النص «${last.token.replace(/\\(.)/g, '$1')}» حرفياً`; }
        else { push(token, desc); if (/^المحرف «/.test(desc)) parts[parts.length - 1].literal = true; }
        i++;
    }
    const FLAGS = { g: 'كل التطابقات', i: 'تجاهل حالة الأحرف', m: 'متعدد الأسطر (^ و $ لكل سطر)', s: 'النقطة تشمل السطر الجديد', u: 'Unicode', y: 'لاصق (sticky)', d: 'مواضع المجموعات' };
    return { valid, error, flags: flags.split('').filter(f => FLAGS[f]).map(f => ({ flag: f, desc: FLAGS[f] })), parts: parts.map(({ token, desc, depth: d }) => ({ token, desc, depth: d })) };
}
/** Run a regex against sample lines (safe: per-line, capped). */
export function testRegex(input, samples) {
    let src = String(input || '').trim(), flags = '';
    const lit = /^\/([\s\S]+)\/([a-z]*)$/.exec(src);
    if (lit) { src = lit[1]; flags = lit[2]; }
    let re;
    try { re = new RegExp(src, flags.replace(/[^imsuy]/g, '')); } catch (e) { return []; }
    return String(samples || '').split('\n').slice(0, 50).filter(Boolean).map(line => { const m = re.exec(line.slice(0, 500)); return { line, match: !!m, groups: m ? m.slice(1) : [] }; });
}

// ------------------------------------------------------------------ #51 BIG-O ESTIMATE
export function estimateComplexity(code) {
    const src = maskCode(code);
    const lines = src.split('\n');
    const notes = [];
    let maxDepth = 0, depth = 0;
    const stack = [];
    const py = /^\s*(def|for|while|if)\b.*:\s*$/m.test(src) && !/[{};]\s*$/m.test(src);
    if (py) {
        const indentStack = [];
        lines.forEach((l) => {
            if (!l.trim()) return;
            const ind = /^\s*/.exec(l)[0].length;
            while (indentStack.length && indentStack[indentStack.length - 1] >= ind) indentStack.pop();
            if (/^\s*(for|while)\b/.test(l) || /\[[^\]]*\bfor\b[^\]]*\]/.test(l)) { indentStack.push(ind); maxDepth = Math.max(maxDepth, indentStack.length); }
        });
    } else {
        let pending = 0;
        const loopG = /\b(for|while)\s*\(|\.(forEach|map|filter|reduce|some|every|find|findIndex|flatMap)\s*\(/g;
        for (const l of lines) {
            const starts = new Set();
            let lm;
            loopG.lastIndex = 0;
            while ((lm = loopG.exec(l))) starts.add(lm.index);
            for (let ci = 0; ci < l.length; ci++) {
                const ch = l[ci];
                if (starts.has(ci)) pending++;
                if (ch === '{') { stack.push(pending > 0); if (pending > 0) { depth++; pending--; maxDepth = Math.max(maxDepth, depth); } }
                else if (ch === '}') { if (stack.pop()) depth--; }
            }
            if (pending > 0 && /\)\s*[^{\s]/.test(l) && !/\{\s*$/.test(l)) { maxDepth = Math.max(maxDepth, depth + 1); pending = 0; }
        }
    }
    const fnNames = Array.from(src.matchAll(/(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>)|def\s+(\w+))/g)).map(m => m[1] || m[2] || m[3]);
    const recursive = fnNames.filter(n => (src.match(new RegExp(`\\b${n}\\s*\\(`, 'g')) || []).length > 1);
    const sorts = /\.sort\s*\(|\bsorted\s*\(|\.sort\(\)/.test(src);
    const halving = /(\/\s*2|>>\s*1|\/\/\s*2|mid\b|Math\.floor\([^)]*\/\s*2\))/.test(src) && /while|for/.test(src);
    const memo = /memo|cache|dp\[|lru_cache|new Map\(\)/i.test(src);
    let time;
    if (recursive.length && !memo) {
        const multi = recursive.some(n => (src.match(new RegExp(`\\b${n}\\s*\\(`, 'g')) || []).length > 2);
        time = multi ? 'O(2ⁿ)' : halving ? 'O(log n)' : 'O(n)';
        notes.push(multi ? `استدعاء ذاتي متعدد في ${recursive.join('، ')} بدون تخزين مؤقت — نمو أُسّي محتمل` : `استدعاء ذاتي في ${recursive.join('، ')}`);
    } else if (halving && maxDepth <= 1) time = maxDepth === 1 && !/while/.test(src) ? 'O(n log n)' : 'O(log n)';
    else time = maxDepth === 0 ? 'O(1)' : maxDepth === 1 ? 'O(n)' : maxDepth === 2 ? 'O(n²)' : `O(n^${maxDepth})`;
    if (sorts) { notes.push('يوجد ترتيب (sort) — O(n log n) على الأقل'); if (time === 'O(n)' || time === 'O(1)' || time === 'O(log n)') time = 'O(n log n)'; }
    if (maxDepth >= 2) notes.push(`حلقات متداخلة بعمق ${maxDepth}`);
    if (/\.(includes|indexOf)\s*\(/.test(src) && maxDepth >= 1) notes.push('includes/indexOf داخل حلقة = بحث خطي متكرر؛ استخدم Set/Map');
    if (memo && recursive.length) notes.push('يوجد تخزين مؤقت (memoization) يقلل التعقيد');
    const space = /new Array\(|\[\]\s*;|\bdict\(|\{\}\s*;|new (Map|Set)\(/.test(src) ? (maxDepth >= 2 ? 'O(n²)' : 'O(n)') : recursive.length ? 'O(n) (مكدس الاستدعاء)' : 'O(1)';
    return { time, space, loopDepth: maxDepth, recursive, notes };
}

// ------------------------------------------------------------------ #48 N+1 QUERIES
const QUERY_RE = /\b(await\s+)?([\w$.]+\.)?(find(One|ById|Unique|First|All)?|findMany|query|execute|get|fetch|select|where|load|aggregate|count|populate)\s*\(|\bfetch\s*\(|\b(SELECT|INSERT|UPDATE|DELETE)\b|\.objects\.(get|filter)\(|cursor\.execute\(/i;
export function detectNPlusOne(code) {
    const raw = String(code || ''), src = maskCode(raw);
    const lines = raw.split('\n'), mlines = src.split('\n');
    const findings = [];
    const loopStart = /\b(for|while)\b|\.(forEach|map|flatMap|reduce)\s*\(/;
    let loopUntil = -1, loopIndent = -1, braceDepth = 0, loopBrace = -1;
    mlines.forEach((l, i) => {
        const ind = /^\s*/.exec(l)[0].length;
        const inPyLoop = loopIndent >= 0 && l.trim() && ind > loopIndent;
        if (loopIndent >= 0 && l.trim() && ind <= loopIndent && !loopStart.test(l)) loopIndent = -1;
        const inLoop = i <= loopUntil || inPyLoop || (loopBrace >= 0 && braceDepth > loopBrace);
        const sqlInString = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(lines[i]);
        if (inLoop && (QUERY_RE.test(l) || sqlInString) && !/\.(get|set|has)\s*\(\s*\w+\s*\)/.test(l) && !/Promise\.all/.test(l)) {
            findings.push({ line: i + 1, code: lines[i].trim().slice(0, 140), message: 'استعلام داخل حلقة — كل عنصر يرسل طلباً منفصلاً (N+1). اجلب البيانات دفعة واحدة (IN / include / join / Promise.all مع DataLoader).' });
        }
        if (loopStart.test(l)) {
            if (/:\s*$/.test(l)) loopIndent = ind;
            if (/\{\s*$|\(\s*(async\s*)?\(?[\w,\s{}]*\)?\s*=>\s*\{?\s*$/.test(l) || /\{/.test(l)) loopBrace = braceDepth;
            if (!/\{|:\s*$/.test(l)) loopUntil = i + 1;
        }
        for (const ch of l) { if (ch === '{') braceDepth++; else if (ch === '}') { braceDepth--; if (braceDepth <= loopBrace) loopBrace = -1; } }
    });
    return findings;
}

// ------------------------------------------------------------------ #57 MEMORY LEAKS
export function detectLeaks(code) {
    const src = maskCode(code), raw = String(code || '');
    const f = [];
    const count = (re) => (src.match(re) || []).length;
    const add = (re, message) => { const m = re.exec(src); if (m) f.push({ line: lineOf(src, m.index), code: raw.split('\n')[lineOf(src, m.index) - 1].trim().slice(0, 140), message }); };
    if (count(/addEventListener\s*\(/g) > count(/removeEventListener\s*\(/g)) add(/addEventListener\s*\(/, 'مستمع أحداث بدون removeEventListener — يبقى العنصر/الدالة في الذاكرة. أزله عند التنظيف أو استخدم { once: true } / AbortController.');
    if (count(/setInterval\s*\(/g) > count(/clearInterval\s*\(/g)) add(/setInterval\s*\(/, 'setInterval بدون clearInterval — مؤقت يعمل للأبد ويحتجز ما يستخدمه.');
    if (count(/\.subscribe\s*\(/g) > count(/unsubscribe|\.off\s*\(|takeUntil|dispose/g)) add(/\.subscribe\s*\(/, 'اشتراك (subscribe) بدون إلغاء — ألغِه عند انتهاء المكوّن.');
    if (/useEffect\s*\(\s*\(\)\s*=>\s*\{(?:(?!return)[\s\S])*?(addEventListener|setInterval|subscribe|on\()[\s\S]*?\}\s*,/.test(src)) add(/useEffect\s*\(/, 'useEffect يسجّل مستمعاً/مؤقتاً بدون دالة تنظيف (return () => …).');
    if (/new\s+(ResizeObserver|MutationObserver|IntersectionObserver)/.test(src) && !/\.disconnect\s*\(/.test(src)) add(/new\s+(ResizeObserver|MutationObserver|IntersectionObserver)/, 'Observer بدون disconnect().');
    const caches = Array.from(src.matchAll(/^(?:const|let|var)\s+(\w+)\s*=\s*(\[\]|\{\}|new Map\(\)|new Set\(\))/gm));
    caches.forEach(m => {
        const name = m[1];
        const grows = new RegExp(`\\b${name}\\s*(\\.push|\\.set|\\.add|\\[[^\\]]+\\]\\s*=)`).test(src);
        const shrinks = new RegExp(`\\b${name}\\s*(\\.(shift|splice|delete|clear|pop)|\\.length\\s*=|=\\s*(\\[\\]|\\{\\}|new))`).test(src.slice(m.index + m[0].length));
        if (grows && !shrinks) f.push({ line: lineOf(src, m.index), code: raw.split('\n')[lineOf(src, m.index) - 1].trim().slice(0, 140), message: `المجموعة العامة «${name}» تكبر بلا حد — أضف حداً أقصى أو استخدم WeakMap/LRU.` });
    });
    if (/\bwindow\.\w+\s*=|\bglobalThis\.\w+\s*=/.test(src)) add(/\bwindow\.\w+\s*=|\bglobalThis\.\w+\s*=/, 'تخزين بيانات على window/globalThis يمنع تحريرها.');
    if (/document\.(getElementById|querySelector)[\s\S]{0,80}\.remove\(\)/.test(src) && /(const|let|var)\s+\w+\s*=\s*document\./.test(src)) add(/(const|let|var)\s+\w+\s*=\s*document\./, 'مرجع لعنصر DOM قد يبقى بعد حذفه (detached node) — صفّر المرجع بعد الحذف.');
    return f;
}

// ------------------------------------------------------------------ #25 NAMING
const GENERIC = ['data', 'tmp', 'temp', 'foo', 'bar', 'baz', 'obj', 'val', 'value2', 'stuff', 'thing', 'things', 'info', 'res2', 'arr', 'str', 'num', 'item2', 'x1', 'my', 'test1', 'aaa', 'abc', 'qwe', 'asd'];
const OK_SHORT = ['i', 'j', 'k', 'x', 'y', 'z', 'e', '_', '$', 'n', 'a', 'b', 'id', 'el', 'fn', 'cb', 'db', 'io', 'ok', 'os', 're', 'h', 'w', 't', 'r', 'c', 'm', 'p', 'v', 's', 'd', 'f', 'g'];
export function namingIssues(code, path = '') {
    const src = maskCode(code);
    const py = /\.py$/.test(path) || (/^\s*def\s+\w+/m.test(src) && !/function|=>/.test(src));
    const seen = new Set();
    const out = [];
    const decl = py ? /^\s*(?:def\s+(\w+)|(\w+)\s*=(?!=))/gm : /\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)|\b([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
    let m;
    while ((m = decl.exec(src))) {
        const name = m[1] || m[2];
        if (!name || seen.has(name) || ['if', 'for', 'while', 'switch', 'catch', 'function', 'return'].includes(name)) continue;
        seen.add(name);
        const line = lineOf(src, m.index);
        const lower = name.toLowerCase();
        if (name.length === 1 && !OK_SHORT.includes(name)) out.push({ name, line, issue: 'اسم من حرف واحد', hint: 'استخدم اسماً يصف المحتوى' });
        else if (GENERIC.includes(lower)) out.push({ name, line, issue: 'اسم عام جداً', hint: 'سمّه حسب ما يحتويه (users، totalPrice…)' });
        else if (!py && /_/.test(name) && !/^[A-Z0-9_]+$/.test(name) && !/^_/.test(name)) out.push({ name, line, issue: 'snake_case في JavaScript', hint: name.replace(/_(\w)/g, (_, c) => c.toUpperCase()) });
        else if (py && /[a-z][A-Z]/.test(name) && !/^[A-Z]/.test(name)) out.push({ name, line, issue: 'camelCase في Python', hint: name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase() });
        else if (/^(flag|check|status)\d*$/i.test(name)) out.push({ name, line, issue: 'اسم منطقي غامض', hint: 'ابدأ بـ is/has/should (isReady…)' });
        else if (/\d$/.test(name) && !/^(v|h|x|y|md5|sha|utf|base|int|float|vec|mat|ipv|oauth|es)\d*$/i.test(name)) out.push({ name, line, issue: 'اسم ينتهي برقم', hint: 'رقم في نهاية الاسم يدل غالباً على تكرار؛ وضّح الفرق' });
    }
    const boolAssign = /\b(?:const|let|var)\s+([a-z]\w*)\s*=\s*(true|false)\b/g;
    while ((m = boolAssign.exec(src))) if (!/^(is|has|should|can|did|was|will|needs?|allow|enable|show|hide)/.test(m[1]) && !out.some(o => o.name === m[1])) out.push({ name: m[1], line: lineOf(src, m.index), issue: 'متغير منطقي بلا بادئة', hint: 'is' + m[1][0].toUpperCase() + m[1].slice(1) });
    return out.slice(0, 60);
}

// ------------------------------------------------------------------ #24 PATTERNS + SMELLS
export function detectPatterns(code) {
    const src = maskCode(code);
    const patterns = [], smells = [];
    const has = (re) => re.test(src);
    if (has(/static\s+(getInstance|instance)\b|let\s+instance\s*(=\s*null)?;[\s\S]*if\s*\(\s*!instance/)) patterns.push({ name: 'Singleton', note: 'نسخة وحيدة — فكّر في حقن الاعتماديات لتسهيل الاختبار' });
    if (has(/function\s+create\w+\s*\(|static\s+create\w*\s*\(|\bfactory\b/i)) patterns.push({ name: 'Factory', note: 'إنشاء الكائنات عبر دالة مصنع' });
    if (has(/\b(subscribe|addListener|on)\s*\([\s\S]*\b(emit|notify|dispatch|trigger)\s*\(/)) patterns.push({ name: 'Observer / Pub-Sub', note: 'تأكد من إلغاء الاشتراكات لتجنب التسريب' });
    if (has(/return\s+this\s*;[\s\S]*return\s+this\s*;/)) patterns.push({ name: 'Builder / Fluent API', note: 'سلسلة استدعاءات تُرجع this' });
    if (has(/\{\s*\w+\s*:\s*(\([^)]*\)\s*=>|function)[\s\S]*,\s*\w+\s*:\s*(\([^)]*\)\s*=>|function)/) && has(/\[\s*\w+\s*\]\s*\(/)) patterns.push({ name: 'Strategy (خريطة دوال)', note: 'اختيار السلوك من جدول — بديل جيد لـ switch الطويل' });
    if (has(/\(function\s*\([^)]*\)\s*\{[\s\S]*\}\s*\)\s*\(/)) patterns.push({ name: 'Module (IIFE)', note: 'يمكن تحويله إلى ES Modules' });
    if (has(/function\s+\w+\s*\(\s*(fn|func|callback|wrapped)\b[\s\S]*return\s+(function|\()/)) patterns.push({ name: 'Decorator / Higher-order', note: 'تغليف دالة بأخرى' });
    if (has(/class\s+\w+\s+extends\s+\w+[\s\S]*class\s+\w+\s+extends\s+\w+[\s\S]*class\s+\w+\s+extends/)) smells.push({ name: 'وراثة عميقة', note: 'فضّل التركيب (composition) على الوراثة' });
    const switchCases = (src.match(/\bcase\s+/g) || []).length;
    if (switchCases >= 8) smells.push({ name: `switch كبير (${switchCases} حالة)`, note: 'استخدم Strategy/خريطة كائنات' });
    // long functions, deep nesting, long parameter lists
    const fnRe = /(function\s+(\w+)\s*\(([^)]*)\)|(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>|^\s*(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*\{)/gm;
    let m;
    while ((m = fnRe.exec(src))) {
        const name = m[2] || m[4] || m[6];
        const params = (m[3] || m[5] || m[7] || '').split(',').filter(p => p.trim());
        if (['if', 'for', 'while', 'switch', 'catch'].includes(name)) continue;
        if (params.length > 5) smells.push({ name: `معاملات كثيرة في ${name} (${params.length})`, note: 'مرّر كائن خيارات' });
        const open = src.indexOf('{', m.index + m[0].length - 1);
        if (open < 0 || open - m.index > m[0].length + 3) continue;
        let d = 0, maxD = 0, end = open;
        for (let k = open; k < src.length; k++) { if (src[k] === '{') { d++; maxD = Math.max(maxD, d); } else if (src[k] === '}' && --d === 0) { end = k; break; } }
        const len = src.slice(open, end).split('\n').length;
        if (len > 80) smells.push({ name: `دالة طويلة: ${name} (${len} سطر)`, note: 'قسّمها إلى دوال أصغر بمسؤولية واحدة' });
        if (maxD > 4) smells.push({ name: `تداخل عميق في ${name} (${maxD} مستويات)`, note: 'استخدم return مبكر (guard clauses)' });
    }
    const dup = new Map();
    src.split('\n').map(l => l.trim()).filter(l => l.length > 30).forEach(l => dup.set(l, (dup.get(l) || 0) + 1));
    const repeated = Array.from(dup.values()).filter(n => n >= 3).length;
    if (repeated) smells.push({ name: `أسطر مكررة (${repeated})`, note: 'استخرجها إلى دالة مشتركة (DRY)' });
    return { patterns, smells };
}

// ------------------------------------------------------------------ #60 UNUSED DEPENDENCIES
const TOOLING = /^(@types\/|eslint|prettier|typescript$|ts-node|vite|webpack|rollup|esbuild|parcel|jest|vitest|mocha|chai|nodemon|husky|lint-staged|@babel\/|babel-|postcss|autoprefixer|tailwindcss|sass$|less$|concurrently|cross-env|rimraf|npm-run-all|@vitejs\/|@testing-library\/|playwright|cypress|serve$|http-server|dotenv-cli|terser|sucrase|@commitlint|commitlint|semantic-release|turbo$|nx$|tsx$|ts-jest|@swc\/)/;
export function unusedDependencies(files) {
    const get = (p) => { const f = files instanceof Map ? files.get(p) : files[p]; return f && typeof f === 'object' ? f.content : f; };
    const pkgText = get('package.json');
    if (!pkgText) return { error: 'لا يوجد package.json في المشروع', unused: [], used: [] };
    let pkg;
    try { pkg = JSON.parse(pkgText); } catch (e) { return { error: 'package.json غير صالح', unused: [], used: [] }; }
    const deps = { ...(pkg.dependencies || {}) }, dev = { ...(pkg.devDependencies || {}) };
    const paths = (files instanceof Map ? Array.from(files.keys()) : Object.keys(files)).filter(p => /\.(m?[jt]sx?|cjs|vue|svelte|astro|html|css|scss)$/.test(p));
    const used = new Set();
    const scripts = JSON.stringify(pkg.scripts || {}) + JSON.stringify(pkg.babel || {}) + JSON.stringify(pkg.eslintConfig || {}) + JSON.stringify(pkg.prettier || '');
    paths.forEach(p => {
        const t = String(get(p) || '');
        for (const m of t.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+|@import\s+(?:url\()?)["']([^"'./][^"']*)["']/g)) {
            const spec = m[1];
            used.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
        }
    });
    const config = paths.concat((files instanceof Map ? Array.from(files.keys()) : Object.keys(files)).filter(p => /(^|\/)(\.\w+rc(\.\w+)?|[\w.-]+\.config\.\w+)$/.test(p))).map(p => String(get(p) || '')).join('\n');
    const unused = [];
    Object.keys(deps).forEach(d => { if (!used.has(d) && !scripts.includes(d) && !config.includes(`'${d}'`) && !config.includes(`"${d}"`)) unused.push({ name: d, dev: false, version: deps[d] }); });
    Object.keys(dev).forEach(d => { if (!used.has(d) && !TOOLING.test(d) && !scripts.includes(d) && !config.includes(d)) unused.push({ name: d, dev: true, version: dev[d] }); });
    const missing = Array.from(used).filter(u => !deps[u] && !dev[u] && !/^(node:|fs$|path$|os$|http$|https$|url$|crypto$|util$|events$|stream$|child_process$|zlib$|assert$|buffer$|process$|react-dom\/client)/.test(u));
    return { unused, used: Array.from(used), missing, pkg };
}
export function removeDependencies(pkgText, names) {
    const pkg = JSON.parse(pkgText);
    names.forEach(n => { if (pkg.dependencies) delete pkg.dependencies[n]; if (pkg.devDependencies) delete pkg.devDependencies[n]; });
    return JSON.stringify(pkg, null, 2) + '\n';
}

// ------------------------------------------------------------------ #59 #90 ALTERNATIVES
export const ALTERNATIVES = {
    moment: { alt: 'dayjs أو date-fns', why: 'moment في وضع الصيانة وحجمه ~70KB؛ dayjs ~2KB بنفس الواجهة تقريباً', saveKB: 65 },
    'moment-timezone': { alt: 'Intl.DateTimeFormat أو date-fns-tz', why: 'المتصفح يدعم المناطق الزمنية أصلاً', saveKB: 90 },
    request: { alt: 'fetch المدمج أو undici', why: 'request متوقفة منذ 2020', saveKB: 0 },
    'request-promise': { alt: 'fetch المدمج', why: 'مبنية على request المتوقفة', saveKB: 0 },
    lodash: { alt: 'lodash-es (استيراد دوال محددة) أو دوال JS الأصلية', why: 'استيراد lodash كاملة ~70KB؛ معظم دوالها موجودة أصلاً (map/filter/Object.entries/structuredClone)', saveKB: 60 },
    underscore: { alt: 'دوال JS الأصلية', why: 'ES2015+ يغطي معظمها', saveKB: 17 },
    jquery: { alt: 'DOM APIs الأصلية (querySelector، fetch، classList)', why: '~30KB غير ضرورية في المتصفحات الحديثة', saveKB: 30 },
    axios: { alt: 'fetch المدمج (أو ky ~4KB)', why: 'fetch متوفر في المتصفح وNode 18+', saveKB: 13 },
    'node-sass': { alt: 'sass (Dart Sass)', why: 'node-sass متوقفة ولا تدعم الإصدارات الحديثة من Node', saveKB: 0 },
    tslint: { alt: 'eslint + typescript-eslint', why: 'tslint متوقفة منذ 2019', saveKB: 0 },
    uuid: { alt: 'crypto.randomUUID()', why: 'مدمجة في المتصفح وNode 16+', saveKB: 4 },
    'left-pad': { alt: 'String.prototype.padStart', why: 'مدمجة', saveKB: 1 },
    bluebird: { alt: 'Promise الأصلية', why: 'Promise الأصلية سريعة ومكتملة', saveKB: 18 },
    q: { alt: 'Promise الأصلية + async/await', why: 'قديمة', saveKB: 6 },
    async: { alt: 'async/await + Promise.all', why: 'لغة JS تغطيها الآن', saveKB: 9 },
    'core-js': { alt: 'browserslist حديث أو استيراد polyfills محددة', why: 'غالباً تُحمَّل كاملة دون حاجة', saveKB: 40 },
    'babel-polyfill': { alt: 'core-js/stable مع useBuiltIns: usage', why: 'متوقفة', saveKB: 30 },
    'body-parser': { alt: 'express.json() / express.urlencoded()', why: 'مدمجة في Express 4.16+', saveKB: 0 },
    'node-fetch': { alt: 'fetch المدمج في Node 18+', why: 'لم تعد ضرورية', saveKB: 0 },
    'cross-fetch': { alt: 'fetch المدمج', why: 'لم تعد ضرورية', saveKB: 0 },
    'isomorphic-fetch': { alt: 'fetch المدمج', why: 'لم تعد ضرورية', saveKB: 0 },
    mkdirp: { alt: "fs.mkdir(p, { recursive: true })", why: 'مدمجة في Node 10+', saveKB: 0 },
    rimraf: { alt: "fs.rm(p, { recursive: true, force: true })", why: 'مدمجة في Node 14+', saveKB: 0 },
    'object-assign': { alt: 'Object.assign / spread', why: 'مدمجة', saveKB: 1 },
    'es6-promise': { alt: 'Promise الأصلية', why: 'مدمجة', saveKB: 6 },
    classnames: { alt: 'clsx', why: 'أصغر وأسرع بنفس الواجهة', saveKB: 1 },
    'react-scripts': { alt: 'Vite', why: 'Create React App متوقفة؛ Vite أسرع بكثير', saveKB: 0 },
    enzyme: { alt: '@testing-library/react', why: 'enzyme لا تدعم React 18+', saveKB: 0 },
    'chart.js': { alt: 'استيراد المكونات المطلوبة فقط (tree-shaking)', why: 'التسجيل الكامل يضيف ~60KB', saveKB: 30 },
    'font-awesome': { alt: '@fortawesome/fontawesome-svg-core مع أيقونات محددة', why: 'الحزمة الكاملة كبيرة', saveKB: 50 },
    xmldom: { alt: '@xmldom/xmldom', why: 'الحزمة القديمة غير مصانة', saveKB: 0 },
    'querystring': { alt: 'URLSearchParams', why: 'مدمجة', saveKB: 3 },
    'faker': { alt: '@faker-js/faker', why: 'الحزمة الأصلية حُذفت', saveKB: 0 }
};
export function dependencyAdvice(pkgText) {
    let pkg;
    try { pkg = JSON.parse(pkgText); } catch (e) { return []; }
    const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    return Object.keys(all).filter(n => ALTERNATIVES[n]).map(n => ({ name: n, version: all[n], ...ALTERNATIVES[n] })).sort((a, b) => b.saveKB - a.saveKB);
}

// ------------------------------------------------------------------ #88 OUTDATED (semver)
export function parseSemver(v) {
    const m = /(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/.exec(String(v || ''));
    return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || '' } : null;
}
export function compareSemver(a, b) {
    const x = parseSemver(a), y = parseSemver(b);
    if (!x || !y) return 0;
    return (x.major - y.major) || (x.minor - y.minor) || (x.patch - y.patch) || (x.pre && !y.pre ? -1 : !x.pre && y.pre ? 1 : 0);
}
/** Classify an update: range in package.json vs latest published version. */
export function updateKind(range, latest) {
    const cur = parseSemver(range), lat = parseSemver(latest);
    if (!cur || !lat) return 'unknown';
    if (compareSemver(range, latest) >= 0) return 'current';
    if (lat.major !== cur.major) return 'major';
    if (lat.minor !== cur.minor) return 'minor';
    return 'patch';
}
export function bumpRange(range, latest) {
    const prefix = (/^[\^~]/.exec(String(range).trim()) || [''])[0];
    return prefix + latest;
}

// ------------------------------------------------------------------ #56 #87 LEGACY → MODERN
export function legacyFindings(code) {
    const src = maskCode(code), raw = String(code || '');
    const rules = [
        [/\bvar\s+/g, 'var', 'استخدم const/let (نطاق الكتلة)'],
        [/\brequire\s*\(\s*['"][^'"]+['"]\s*\)/g, 'require', 'CommonJS ← ES Modules (import)'],
        [/module\.exports\s*=/g, 'module.exports', 'export / export default'],
        [/\.then\s*\([\s\S]{0,200}?\.then\s*\(/g, 'then-chain', 'سلسلة then ← async/await'],
        [/function\s*\(\s*err(or)?\s*,/g, 'callback', 'Callbacks بنمط (err, data) ← Promises/async (util.promisify)'],
        [/new\s+XMLHttpRequest/g, 'XHR', 'XMLHttpRequest ← fetch'],
        [/\barguments\b/g, 'arguments', 'arguments ← معاملات rest (...args)'],
        [/function\s*\([^)]*\)\s*\{[\s\S]{0,300}?\}\s*\.bind\(\s*this\s*\)/g, 'bind', '.bind(this) ← دالة سهمية'],
        [/['"][^'"\n]*['"]\s*\+\s*\w+\s*\+\s*['"]/g, 'concat', 'دمج النصوص بـ + ← Template literals'],
        [/\.indexOf\([^)]*\)\s*(!==|!=|>=|>|===)\s*-?[01]/g, 'indexOf', 'indexOf ← includes'],
        [/Object\.assign\(\s*\{\}/g, 'Object.assign', 'Object.assign({}, …) ← spread {...}'],
        [/for\s*\(\s*(var|let)\s+\w+\s*=\s*0\s*;[^;]+\.length\s*;/g, 'for-index', 'حلقة بالفهرس ← for…of / map'],
        [/\.apply\(\s*(null|this)\s*,/g, 'apply', '.apply ← spread (...args)'],
        [/document\.write\s*\(/g, 'document.write', 'document.write ← DOM APIs'],
        [/\$\(\s*document\s*\)\.ready|\$\(\s*['"]/g, 'jQuery', 'jQuery ← querySelector / addEventListener'],
        [/componentWillMount|componentWillReceiveProps|componentWillUpdate/g, 'react-legacy', 'دورات حياة React المتقادمة ← hooks / getDerivedStateFromProps'],
        [/React\.createClass|createReactClass/g, 'createClass', 'createClass ← مكونات دالية + hooks'],
        [/\bprint\s+["'\w]/g, 'py2-print', 'print بنمط Python 2 ← print()'],
        [/%\s*\(|"\s*%\s*\w/g, 'py-format', 'تنسيق % ← f-strings']
    ];
    const out = [];
    for (const [re, id, hint] of rules) {
        const m = re.exec(id === 'concat' || id === 'py-format' || id === 'py2-print' ? raw : src);
        if (m) out.push({ id, line: lineOf(src, m.index), count: ((id === 'concat' ? raw : src).match(re) || []).length || 1, hint });
        re.lastIndex = 0;
    }
    return out;
}

// ------------------------------------------------------------------ #81-#84 COMPANY STANDARDS
export const STANDARD_PRESETS = [
    { id: 'no-console', label: 'منع console.log في الكود', pattern: 'console\\.log\\(', files: '\\.(m?[jt]sx?)$', severity: 'warning', message: 'أزل console.log أو استخدم logger' },
    { id: 'no-var', label: 'منع var', pattern: '\\bvar\\s+', files: '\\.(m?[jt]sx?)$', severity: 'error', message: 'استخدم const/let' },
    { id: 'no-todo', label: 'TODO يجب أن يحمل رقم تذكرة', pattern: 'TODO(?!\\s*\\(?[A-Z]+-\\d+)', files: '.*', severity: 'warning', message: 'اكتب TODO(ABC-123)' },
    { id: 'max-line', label: 'أقصى طول للسطر 120', pattern: '^.{121,}$', files: '\\.(m?[jt]sx?|py|css|go|java)$', severity: 'info', message: 'السطر أطول من 120 محرفاً' },
    { id: 'no-any', label: 'منع any في TypeScript', pattern: ':\\s*any\\b', files: '\\.tsx?$', severity: 'warning', message: 'حدد نوعاً بدل any' },
    { id: 'strict-eq', label: 'المساواة الصارمة', pattern: '[^=!]==[^=]', files: '\\.(m?[jt]sx?)$', severity: 'warning', message: 'استخدم === بدل ==' },
    { id: 'no-debugger', label: 'منع debugger', pattern: '\\bdebugger\\b', files: '\\.(m?[jt]sx?)$', severity: 'error', message: 'أزل debugger' },
    { id: 'no-print', label: 'منع print في Python', pattern: '^\\s*print\\(', files: '\\.py$', severity: 'info', message: 'استخدم logging' },
    { id: 'kebab-files', label: 'أسماء الملفات kebab-case', pattern: '__FILENAME__[A-Z_]', files: '\\.(m?[jt]sx?|css)$', severity: 'info', message: 'سمّ الملفات بأحرف صغيرة وشرطات' },
    { id: 'no-secrets', label: 'منع مفاتيح API مكتوبة في الكود', pattern: '(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})', files: '.*', severity: 'error', message: 'انقل المفتاح إلى متغيرات البيئة' }
];
export function checkStandards(files, rules) {
    const out = [];
    const entries = files instanceof Map ? Array.from(files.entries()) : Object.entries(files);
    for (const r of rules) {
        if (r.enabled === false) continue;
        let re, fre;
        try { re = new RegExp(r.pattern, 'gm'); fre = new RegExp(r.files || '.*'); } catch (e) { continue; }
        for (const [path, f] of entries) {
            const text = f && typeof f === 'object' ? f.content : f;
            if (typeof text !== 'string' || !fre.test(path) || text.length > 400000) continue;
            if (r.pattern.startsWith('__FILENAME__')) {
                const base = path.split('/').pop();
                if (new RegExp(r.pattern.slice(12)).test(base.replace(/\.\w+$/, '')) && !/^(README|LICENSE|CHANGELOG|Dockerfile|Makefile)/.test(base)) out.push({ rule: r.id, severity: r.severity, path, line: 1, message: r.message, code: base });
                continue;
            }
            const mask = /\.(m?[jt]sx?|py)$/.test(path) && !/secret|TODO/.test(r.id + r.pattern) ? maskCode(text) : text;
            let m, n = 0;
            re.lastIndex = 0;
            while ((m = re.exec(mask)) && n < 50) {
                const line = lineOf(mask, m.index);
                out.push({ rule: r.id, severity: r.severity, path, line, message: r.message, code: text.split('\n')[line - 1].trim().slice(0, 140) });
                n++;
                if (m[0] === '') re.lastIndex++;
            }
        }
    }
    return out;
}
export function standardsPrompt(rules) {
    const on = (rules || []).filter(r => r.enabled !== false);
    return on.length ? 'Follow these team coding standards strictly:\n' + on.map(r => `- ${r.label}${r.message ? ` (${r.message})` : ''}`).join('\n') : '';
}
