/* ==============================================================================
   Sprint 13 — #262 «قلم»: an Arabic-keyword dialect of JavaScript (.arjs files).
   A token-level transpiler: strings, template literals (with nested ${…}) and
   comments are left untouched; Arabic keywords, operators, punctuation and digits
   are mapped to JavaScript. Line structure is preserved 1:1 so stack traces and
   breakpoints map straight back to the .arjs source.
   ============================================================================== */

/** Arabic keyword → JS. Keys are normalised (no tashkeel/tatweel, أ/إ/آ → ا, ة/ه kept, ى → ي). */
export const AR_KEYWORDS = {
    'دالة': 'function', 'متغير': 'let', 'ثابت': 'const', 'اذا': 'if', 'والا': 'else', 'بينما': 'while', 'كرر': 'do',
    'لكل': 'for', 'من': 'of', 'في': 'in', 'ارجع': 'return', 'صحيح': 'true', 'خطا': 'false', 'عدم': 'null', 'لاشيء': 'null',
    'غير_معرف': 'undefined', 'جديد': 'new', 'هذا': 'this', 'صنف': 'class', 'يمتد': 'extends', 'الاصل': 'super', 'باني': 'constructor',
    'حاول': 'try', 'التقط': 'catch', 'اخيرا': 'finally', 'ارم': 'throw', 'اكسر': 'break', 'توقف': 'break', 'استمر': 'continue',
    'انتظر': 'await', 'متزامن': 'async', 'اختر': 'switch', 'حالة': 'case', 'افتراضي': 'default', 'نوع': 'typeof', 'مثيل': 'instanceof',
    'احذف': 'delete', 'استورد': 'import', 'صدر': 'export', 'ثابتة': 'static', 'احصل': 'get', 'عين': 'set', 'انتج': 'yield',
    'و': '&&', 'او': '||', 'ليس': '!', 'يساوي': '===', 'لايساوي': '!==', 'لا_يساوي': '!=='
};
/** Global names (only when not a property access). */
export const AR_GLOBALS = {
    'اطبع': 'console.log', 'تحذير': 'console.warn', 'خطا_طباعة': 'console.error', 'ادخل': 'prompt', 'اقرا': 'prompt',
    'رياضيات': 'Math', 'كائن': 'Object', 'مصفوفة': 'Array', 'نص': 'String', 'رقم': 'Number', 'منطقي': 'Boolean', 'وعد': 'Promise',
    'تاريخ': 'Date', 'جيسون': 'JSON', 'خريطة_جديدة': 'Map', 'مجموعة': 'Set', 'خطا_جديد': 'Error', 'مؤقت': 'setTimeout', 'مكرر': 'setInterval',
    'الغ_المؤقت': 'clearTimeout', 'الغ_المكرر': 'clearInterval', 'جلب': 'fetch', 'تطلب': 'require', 'وحدة': 'module', 'عشوائي': 'Math.random',
    'صحيح_من': 'parseInt', 'عشري_من': 'parseFloat', 'ليس_رقما': 'isNaN', 'لانهاية': 'Infinity'
};
/** Property names after a dot (obj.طول → obj.length). */
export const AR_PROPS = {
    'طول': 'length', 'اضف': 'push', 'ادفع': 'push', 'اسحب': 'pop', 'ازح': 'shift', 'خريطة': 'map', 'رشح': 'filter', 'اختزل': 'reduce',
    'لكل_عنصر': 'forEach', 'يحتوي': 'includes', 'اربط': 'join', 'قسم': 'split', 'اعكس': 'reverse', 'رتب': 'sort', 'جد': 'find',
    'موقع': 'indexOf', 'شريحة': 'slice', 'كبير': 'toUpperCase', 'صغير': 'toLowerCase', 'شذب': 'trim', 'استبدل': 'replace', 'يبدا': 'startsWith',
    'ينتهي': 'endsWith', 'مفاتيح': 'keys', 'قيم': 'values', 'مدخلات': 'entries', 'سجل': 'log', 'جذر': 'sqrt', 'قوة': 'pow', 'ارض': 'floor',
    'سقف': 'ceil', 'قرب': 'round', 'اكبر': 'max', 'اصغر': 'min', 'مطلق': 'abs', 'عشوائي': 'random', 'الى_نص': 'toString', 'ثبت': 'toFixed',
    'بعد': 'then', 'عند_الخطا': 'catch', 'الكل': 'all', 'حول_لنص': 'stringify', 'حلل': 'parse', 'الان': 'now', 'بعض': 'some', 'كل': 'every'
};
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩', FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const PUNCT = { '،': ',', '؛': ';', '؟': '?', '٪': '%', '٫': '.' };

/** Normalise an Arabic word for keyword lookup. */
export function normAr(w) {
    return String(w).replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي');
}
const ID_RE = /[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*/uy;
const hasArabic = (s) => /[\u0600-\u06FF]/.test(s);

/**
 * Transpile قلم → JavaScript. Returns { code, mapped } where mapped counts translated tokens.
 * Throws nothing: an unterminated string just runs to end-of-input (the JS parser reports it).
 */
export function transpileArabic(src) {
    const s = String(src || '');
    let out = '', i = 0, mapped = 0, lastSig = '', pendingFor = false, paren = 0, forHead = -1;
    const tplStack = [];   // brace depth inside each open template ${…}
    let braceDepth = 0;
    const emit = (t) => { out += t; if (/\S/.test(t)) lastSig = t.trim().slice(-1); };
    const readString = (q) => {
        let j = i + 1;
        while (j < s.length && s[j] !== q && s[j] !== '\n') { if (s[j] === '\\') j++; j++; }
        out += s.slice(i, j + 1); i = j + 1; lastSig = q;
    };
    const readTemplate = () => {          // from a ` or the } closing a ${…} up to the next ${ or closing `
        let j = i + 1;
        while (j < s.length) {
            if (s[j] === '\\') { j += 2; continue; }
            if (s[j] === '`') { out += s.slice(i, j + 1); i = j + 1; lastSig = '`'; return; }
            if (s[j] === '$' && s[j + 1] === '{') { out += s.slice(i, j + 2); i = j + 2; tplStack.push(braceDepth); braceDepth++; lastSig = '{'; return; }
            j++;
        }
        out += s.slice(i); i = s.length;
    };
    while (i < s.length) {
        const c = s[i];
        if (c === '/' && s[i + 1] === '/') { const e = s.indexOf('\n', i); const j = e < 0 ? s.length : e; out += s.slice(i, j); i = j; continue; }
        if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); const j = e < 0 ? s.length : e + 2; out += s.slice(i, j); i = j; continue; }
        if (c === '«') { const e = s.indexOf('»', i + 1); out += JSON.stringify(s.slice(i + 1, e < 0 ? s.length : e)); i = e < 0 ? s.length : e + 1; mapped++; lastSig = '"'; continue; }
        if (c === '"' || c === "'") { readString(c); continue; }
        if (c === '`') { readTemplate(); continue; }
        if (c === '{') { braceDepth++; emit(c); i++; continue; }
        if (c === '}') {
            braceDepth--;
            if (tplStack.length && tplStack[tplStack.length - 1] === braceDepth) { tplStack.pop(); readTemplate(); continue; }
            emit(c); i++; continue;
        }
        if (c === '(') { paren++; if (pendingFor) { forHead = paren; pendingFor = false; } emit(c); i++; continue; }
        if (c === ')') { if (paren === forHead) forHead = -1; paren--; emit(c); i++; continue; }
        const di = AR_DIGITS.indexOf(c) >= 0 ? AR_DIGITS.indexOf(c) : FA_DIGITS.indexOf(c);
        if (di >= 0) { out += String(di); i++; mapped++; lastSig = '0'; continue; }
        if (PUNCT[c]) { emit(PUNCT[c]); i++; mapped++; continue; }
        ID_RE.lastIndex = i;
        const m = ID_RE.exec(s);
        if (m) {
            const w = m[0], n = normAr(w);
            let rep = w;
            if (hasArabic(w)) {
                if (lastSig === '.') rep = AR_PROPS[n] || w;
                else if (n === 'من' || n === 'في') rep = forHead === paren ? (n === 'من' ? 'of' : 'in') : (AR_GLOBALS[n] || w);
                else rep = AR_KEYWORDS[n] || AR_GLOBALS[n] || w;
            }
            if (rep !== w) mapped++;
            pendingFor = rep === 'for' || (pendingFor && rep === 'await');
            out += rep; i += w.length; lastSig = rep.slice(-1);
            continue;
        }
        if (!/\s/.test(c)) pendingFor = false;
        emit(c); i++;
    }
    // `لكل (س من قائمة)` → `for (const س of قائمة)` — an undeclared loop variable would throw in strict mode
    out = out.replace(/\bfor(\s+await)?(\s*)\((\s*)([\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*)(\s+)(of|in)(?=\s)/gu, (all, aw, sp, sp2, v, sp3, kw) => /^(let|const|var)$/.test(v) ? all : `for${aw || ''}${sp}(${sp2}const ${v}${sp3}${kw}`);
    return { code: out, mapped };
}

/** JS → قلم (the reverse map, for learning: "show me this snippet in Arabic"). */
export function toArabic(js) {
    const rev = {}, revG = {}, revP = {};
    const pref = ['دالة', 'متغير', 'ثابت', 'إذا', 'وإلا', 'بينما', 'لكل', 'ارجع', 'صحيح', 'خطأ', 'عدم', 'جديد', 'هذا', 'صنف', 'يمتد', 'حاول', 'التقط', 'أخيرا', 'ارم', 'اكسر', 'استمر', 'انتظر', 'متزامن', 'اختر', 'حالة', 'افتراضي', 'نوع'];
    pref.forEach(w => { const n = normAr(w); if (AR_KEYWORDS[n] && !rev[AR_KEYWORDS[n]]) rev[AR_KEYWORDS[n]] = w; });
    Object.entries(AR_KEYWORDS).forEach(([k, v]) => { if (!rev[v] && /^\w+$/.test(v)) rev[v] = k; });
    Object.entries(AR_GLOBALS).forEach(([k, v]) => { if (!revG[v]) revG[v] = k; });
    Object.entries(AR_PROPS).forEach(([k, v]) => { if (!revP[v]) revP[v] = k; });
    let out = '', i = 0;
    const s = String(js || '');
    while (i < s.length) {
        const c = s[i];
        if (c === '/' && s[i + 1] === '/') { const e = s.indexOf('\n', i); const j = e < 0 ? s.length : e; out += s.slice(i, j); i = j; continue; }
        if (c === '"' || c === "'" || c === '`') { let j = i + 1; while (j < s.length && s[j] !== c) { if (s[j] === '\\') j++; j++; } out += s.slice(i, j + 1); i = j + 1; continue; }
        if (s.startsWith('console.log', i) && !/[\w$.]/.test(s[i - 1] || '')) { out += 'اطبع'; i += 11; continue; }
        const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i));
        if (m) {
            const w = m[0], afterDot = out.trimEnd().endsWith('.');
            out += afterDot ? (revP[w] || w) : (rev[w] || revG[w] || w);
            i += w.length;
            continue;
        }
        if (s.startsWith('&&', i)) { out += ' و '; i += 2; continue; }
        if (s.startsWith('||', i)) { out += ' أو '; i += 2; continue; }
        out += c === ',' ? '،' : c === ';' ? '؛' : c;
        i++;
    }
    return out.replace(/ {2,}(?=\S)/g, (m, o, str) => (str[o - 1] === '\n' ? m : ' '));
}

/** A short reference sheet used by the قلم panel. */
export function arabicReference() {
    const rows = (obj) => Object.entries(obj).map(([ar, js]) => ({ ar, js }));
    return { keywords: rows(AR_KEYWORDS), globals: rows(AR_GLOBALS), props: rows(AR_PROPS) };
}

export const ARABIC_SAMPLE = `// برنامج بلغة «قلم» — جافاسكربت بكلمات عربية
دالة مضروب(ن) {
    إذا (ن <= ١) { ارجع ١؛ }
    ارجع ن * مضروب(ن - ١)؛
}
ثابت أعداد = [١، ٢، ٣، ٤، ٥]؛
لكل (ع من أعداد) {
    اطبع(«مضروب»، ع، «=»، مضروب(ع))؛
}
ثابت زوجية = أعداد.رشح(س => س % ٢ === ٠)؛
اطبع(«الأعداد الزوجية:»، زوجية.اربط(«، »))؛
`;
