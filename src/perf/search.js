/* Instant indexed search (#833) with suggestions (#834), history (#835), saved searches (#836), advanced filters (#837),
   smart ranking (#838), grouping (#839), live-updating results (#840) and voice search (#970). */
import { esc, call, card, empty, btn, pbtn, select, lsGet, lsSet, uid, win, fmtDate, extOf } from './util.js';

// ------------------------------------------------------------------ PURE
const DIAC = /[\u064B-\u065F\u0670\u0640]/g;
/** Arabic-aware normalisation: no tashkeel/tatweel, unified alef/yaa/taa-marbuta/hamza seats, lowercase. */
export const normalize = (t) => String(t || '').toLowerCase().replace(DIAC, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
export const tokenize = (t) => normalize(t).split(/[^\p{L}\p{N}_]+/u).filter(w => w.length >= 2);
/** Light Arabic stemming for the index: المدرسه → مدرسه, والكتاب → كتاب (the full form stays indexed too). */
export const stripAl = (w) => { const m = /^(?:[وفبك]?ال|لل)(.{3,})$/.exec(w); return m ? m[1] : null; };
/** Edit distance ≤ 1 (substitution / insertion / deletion). */
export function within1(a, b) {
    if (a === b) return true;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < la && j < lb) {
        if (a[i] === b[j]) { i++; j++; continue; }
        if (++edits > 1) return false;
        if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
    }
    return edits + (la - i) + (lb - j) <= 1;
}
/** "foo -bar \"exact phrase\" type:file role:user ext:js after:2026-01-01 before:2026-12-31 in:sess_1" */
export function parseQuery(q) {
    const out = { terms: [], phrases: [], exclude: [], filters: {} };
    const re = /(-?)(\w+):("[^"]*"|\S+)|"([^"]+)"|(-?)(\S+)/g;
    let m;
    while ((m = re.exec(String(q || '')))) {
        if (m[2] && ['type', 'role', 'ext', 'after', 'before', 'in', 'tag'].includes(m[2].toLowerCase())) { out.filters[m[2].toLowerCase()] = m[3].replace(/"/g, ''); continue; }
        if (m[2]) { tokenize(m[2] + ' ' + m[3]).forEach(t => (m[1] ? out.exclude : out.terms).push(t)); continue; }
        if (m[4]) { out.phrases.push(normalize(m[4])); tokenize(m[4]).forEach(t => out.terms.push(t)); continue; }
        tokenize(m[6]).forEach(t => (m[5] ? out.exclude : out.terms).push(t));
    }
    return out;
}
/** docs: [{ id, type, title, text, t, session, role, path, ext, tags }] → inverted index */
export function buildIndex(docs) {
    const postings = new Map(), norm = [];
    docs.forEach((d, i) => {
        const tt = tokenize(d.title), bt = tokenize(d.text);
        norm.push(normalize((d.title || '') + '\n' + (d.text || '')));
        const tf = new Map();
        const add = (w, n) => { tf.set(w, (tf.get(w) || 0) + n); const st = stripAl(w); if (st) tf.set(st, (tf.get(st) || 0) + n); };
        tt.forEach(w => add(w, 3)); // title boost
        bt.forEach(w => add(w, 1));
        tf.forEach((n, w) => { let p = postings.get(w); if (!p) postings.set(w, (p = new Map())); p.set(i, n); });
    });
    const tokens = Array.from(postings.keys()).sort();
    return { docs, postings, tokens, norm, built: Date.now() };
}
/** Tokens starting with `prefix` (binary search over the sorted token list). */
export function prefixTokens(index, prefix, max = 50) {
    const toks = index.tokens; let lo = 0, hi = toks.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (toks[mid] < prefix) lo = mid + 1; else hi = mid; }
    const out = [];
    for (let i = lo; i < toks.length && out.length < max && toks[i].startsWith(prefix); i++) out.push(toks[i]);
    return out;
}
function expand(index, term, { prefix = true, fuzzy = true } = {}) {
    const set = new Map();
    if (index.postings.has(term)) set.set(term, 1);
    if (prefix && term.length >= 2) prefixTokens(index, term, 30).forEach(t => { if (!set.has(t)) set.set(t, 0.6); });
    if (fuzzy && term.length >= 4 && set.size === 0) index.tokens.forEach(t => { if (t[0] === term[0] && within1(t, term)) set.set(t, 0.45); });
    return set;
}
const dateOf = (s) => { const t = Date.parse(s); return isNaN(t) ? null : t; };
export function passFilters(d, f) {
    if (f.type && d.type !== f.type) return false;
    if (f.role && d.role !== f.role) return false;
    if (f.ext && extOf(d.path || '') !== String(f.ext).replace(/^\./, '').toLowerCase()) return false;
    if (f.in && d.session !== f.in) return false;
    if (f.tag && !(d.tags || []).some(t => normalize(t) === normalize(f.tag))) return false;
    if (f.after && (!d.t || d.t < dateOf(f.after))) return false;
    if (f.before && (!d.t || d.t > dateOf(f.before) + 864e5 - 1)) return false;
    return true;
}
/** Ranked hits [{ doc, score, matched[] }] — AND semantics over terms, OR over each term's expansions. */
export function searchIndex(index, query, { filters = {}, prefix = true, fuzzy = true, limit = 200 } = {}) {
    const q = typeof query === 'string' ? parseQuery(query) : query;
    const f = { ...q.filters, ...filters };
    const N = index.docs.length || 1;
    let scores = null; const matched = new Map();
    if (!q.terms.length) {
        if (!Object.keys(f).length) return [];
        scores = new Map(index.docs.map((d, i) => [i, 1]));
    } else {
        for (const term of q.terms) {
            const exp = expand(index, term, { prefix, fuzzy }), cur = new Map();
            exp.forEach((w, tok) => {
                const p = index.postings.get(tok); if (!p) return;
                const idf = Math.log(1 + N / p.size);
                p.forEach((tf, di) => { cur.set(di, (cur.get(di) || 0) + w * (1 + Math.log(tf)) * idf); if (!matched.has(di)) matched.set(di, new Set()); matched.get(di).add(tok); });
            });
            if (!scores) scores = cur; else { const nx = new Map(); scores.forEach((s, di) => { if (cur.has(di)) nx.set(di, s + cur.get(di)); }); scores = nx; }
            if (!scores.size) return [];
        }
    }
    const out = [];
    scores.forEach((score, di) => {
        const d = index.docs[di], n = index.norm[di];
        if (!passFilters(d, f)) return;
        if (q.exclude.some(t => n.includes(t))) return;
        if (q.phrases.length && !q.phrases.every(p => n.includes(p))) return;
        out.push({ doc: d, score: score * (q.phrases.length ? 1.5 : 1), matched: Array.from(matched.get(di) || []) });
    });
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
/** Smart ranking (#838): relevance × freshness × how often you opened that item. */
export function rankResults(hits, sort = 'smart', { now = Date.now(), opens = {} } = {}) {
    const fresh = (t) => (t ? 1 + 1 / (1 + (now - t) / (7 * 864e5)) : 1);
    const key = sort === 'recent' ? (h) => h.doc.t || 0 : sort === 'relevance' ? (h) => h.score : sort === 'az' ? null : (h) => h.score * fresh(h.doc.t) * (1 + Math.log(1 + (opens[h.doc.id] || 0)));
    const arr = hits.slice();
    if (!key) return arr.sort((a, b) => String(a.doc.title).localeCompare(String(b.doc.title), 'ar'));
    return arr.sort((a, b) => key(b) - key(a));
}
export const TYPE_LABEL = { message: 'الرسائل', session: 'المحادثات', file: 'الملفات', task: 'المهام' };
/** Grouping (#839): by type | session | day | none → [[label, hits]] */
export function groupResults(hits, by = 'type') {
    if (by === 'none') return [['النتائج', hits]];
    const m = new Map();
    for (const h of hits) {
        const k = by === 'session' ? (h.doc.sessionTitle || h.doc.title || '—') : by === 'day' ? (h.doc.t ? new Date(h.doc.t).toISOString().slice(0, 10) : 'بلا تاريخ') : (TYPE_LABEL[h.doc.type] || h.doc.type);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(h);
    }
    return Array.from(m.entries());
}
/** Suggestions (#834): history entries + completions of the last word (by document frequency). */
export function suggest(index, q, history = [], max = 8) {
    const s = String(q || ''), words = s.split(/\s+/), last = normalize(words.pop() || ''), head = words.join(' ');
    const out = [];
    history.filter(h => h !== s && normalize(h).startsWith(normalize(s)) && s).slice(0, 3).forEach(h => out.push({ text: h, kind: 'history' }));
    if (last.length >= 1 && index) prefixTokens(index, last, 200).filter(t => t !== last).sort((a, b) => index.postings.get(b).size - index.postings.get(a).size).slice(0, max).forEach(t => out.push({ text: (head ? head + ' ' : '') + t, kind: 'term', df: index.postings.get(t).size }));
    const seen = new Set();
    return out.filter(x => !seen.has(x.text) && seen.add(x.text)).slice(0, max);
}
/** Snippet around the first matched token, with <mark>. */
export function snippet(text, tokens, len = 160) {
    const t = String(text || ''), n = normalize(t);
    let pos = -1;
    for (const tok of tokens || []) { const i = n.indexOf(tok); if (i >= 0 && (pos < 0 || i < pos)) pos = i; }
    const s = Math.max(0, pos - 50), part = t.slice(s, s + len).replace(/\s+/g, ' ');
    let html = esc(part);
    for (const tok of (tokens || []).filter(x => x.length >= 2)) {
        try { html = html.replace(new RegExp(`(${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>'); } catch (e) { /* skip */ }
    }
    return (s ? '…' : '') + html + (t.length > s + len ? '…' : '');
}
const plain = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => (x && x.text) || '').join(' ') : '');

export function installSearch(P) {
    const KEY = 'ox_perf_search_v1';
    P.pfSearchStore = function () { return { history: [], saved: [], opens: {}, ...lsGet(KEY, {}) }; };
    P.pfSearchSave = function (st) { lsSet(KEY, st); return st; };
    /** Cheap signature of everything indexable → rebuild only when data changed (#840 live update). */
    P.pfSearchSig = function () {
        const s = this.sessions || [];
        let n = 0, last = 0;
        for (const x of s) { n += (x.messages || []).length; last = Math.max(last, x.updatedAt || 0); }
        let fs = 0; (this.virtualProjectFiles || new Map()).forEach((f, p) => { fs += p.length + (f && f.content ? f.content.length : 0); });
        return `${s.length}:${n}:${last}:${fs}:${(this.tasks || []).length}`;
    };
    P.pfSearchDocs = function () {
        const docs = [];
        for (const s of this.sessions || []) {
            docs.push({ id: 's:' + s.id, type: 'session', title: s.title || 'محادثة', text: (s.tags || []).join(' '), t: s.updatedAt || s.createdAt, session: s.id, sessionTitle: s.title, tags: s.tags || [] });
            for (const m of s.messages || []) {
                const text = plain(m.content);
                if (!text) continue;
                docs.push({ id: 'm:' + s.id + ':' + m.id, type: 'message', title: s.title || 'محادثة', text: text.slice(0, 20000), t: m.timestamp || s.updatedAt, session: s.id, sessionTitle: s.title, role: m.role, msgId: m.id, tags: s.tags || [] });
            }
        }
        (this.virtualProjectFiles || new Map()).forEach((f, p) => {
            if (!f || typeof f.content !== 'string' || f.dataUrl) return;
            docs.push({ id: 'f:' + p, type: 'file', title: p, text: p.replace(/[/._-]/g, ' ') + '\n' + f.content.slice(0, 200000), t: f.timestamp || null, path: p });
        });
        for (const t of this.tasks || []) docs.push({ id: 't:' + t.id, type: 'task', title: t.title || '', text: (t.notes || '') + ' ' + (t.tags || []).join(' '), t: t.createdAt || t.updatedAt || null, tags: t.tags || [], taskId: t.id });
        return docs;
    };
    P.pfSearchIndex = function (force = false) {
        const sig = this.pfSearchSig();
        if (!force && this._pfIdx && this._pfIdx.sig === sig) return this._pfIdx;
        const t = performance.now();
        const idx = buildIndex(this.pfSearchDocs());
        idx.sig = sig; idx.ms = Math.round(performance.now() - t);
        return (this._pfIdx = idx);
    };
    /** Public API: app.pfSearch('هوك -test type:file', { sort, group }) → hits */
    P.pfSearch = function (q, opts = {}) {
        const idx = this.pfSearchIndex(), st = this.pfSearchStore();
        const t = performance.now();
        const hits = rankResults(searchIndex(idx, q, { filters: opts.filters || {} }), opts.sort || 'smart', { opens: st.opens });
        this._pfSearchMs = Math.round((performance.now() - t) * 10) / 10;
        return hits;
    };
    P.pfRecordQuery = function (q) {
        q = String(q || '').trim(); if (q.length < 2) return;
        const st = this.pfSearchStore();
        st.history = [q, ...st.history.filter(h => h !== q)].slice(0, 30);
        this.pfSearchSave(st);
    };
    P.pfSearchPanel = function (opts = {}) {
        const st = this.pfSearchStore(), sv = this._pfSearchUI || { q: opts.q || '', type: '', role: '', sort: 'smart', group: 'type', after: '', before: '' };
        if (opts.q) sv.q = opts.q;
        this._pfSearchUI = sv;
        const idx = this.pfSearchIndex();
        this._pfMount = () => {
            const input = document.getElementById('pfx-q');
            if (input) {
                input.addEventListener('input', () => { this._pfSearchUI.q = input.value; this.pfRunSearch(); this.pfRenderSuggest(); });
                input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { this.pfRecordQuery(input.value); this.pfHideSuggest(); } });
                input.focus();
            }
            this.pfRunSearch();
            // Live update (#840): results refresh when chats/files/tasks change while the panel is open
            clearInterval(this._pfLiveT);
            this._pfLiveT = setInterval(() => {
                if (!document.getElementById('pfx-results')) { clearInterval(this._pfLiveT); return; }
                if (this._pfIdx && this._pfIdx.sig !== this.pfSearchSig()) { this.pfRunSearch(true); const b = document.getElementById('pfx-live'); if (b) { b.textContent = '🔄 تحدّثت النتائج'; setTimeout(() => { b.textContent = '● مباشر'; }, 1500); } }
            }, 1500);
            this._pfStop = () => clearInterval(this._pfLiveT);
        };
        const opt = (id, label, options, v) => select(id, label, options, v, `onchange="app.pfSearchOpt('${id.replace('pfx-s-', '')}', this.value)"`);
        return card('', `<div class="pfx-search"><div class="gh-row pfx-qrow"><i class="fa-solid fa-magnifying-glass"></i><input id="pfx-q" class="form-input-box" autocomplete="off" placeholder='ابحث… مثال: "useEffect" -test type:file ext:js after:2026-01-01' value="${esc(sv.q)}">
                ${btn('fa-microphone', '', call('pfVoiceSearch'), 'sidebar-btn-util gh-btn', 'title="بحث صوتي" aria-label="بحث صوتي"')}${btn('fa-bookmark', 'حفظ', call('pfSaveSearchUI'))}</div>
                <div id="pfx-suggest" class="pfx-suggest" hidden></div>
                <div class="fmx-grid4">${opt('pfx-s-type', 'النوع', [['', 'الكل'], ['message', 'رسائل'], ['session', 'محادثات'], ['file', 'ملفات'], ['task', 'مهام']], sv.type)}
                ${opt('pfx-s-role', 'المرسل', [['', 'الكل'], ['user', 'أنا'], ['assistant', 'المساعد']], sv.role)}
                ${opt('pfx-s-sort', 'الترتيب', [['smart', 'ذكي'], ['relevance', 'الصلة'], ['recent', 'الأحدث'], ['az', 'أبجدي']], sv.sort)}
                ${opt('pfx-s-group', 'التجميع', [['type', 'حسب النوع'], ['session', 'حسب المحادثة'], ['day', 'حسب اليوم'], ['none', 'بلا تجميع']], sv.group)}</div>
                <div class="fmx-grid2"><label class="fmx-field"><span>من تاريخ</span><input type="date" class="form-input-box" value="${esc(sv.after)}" onchange="app.pfSearchOpt('after', this.value)"></label><label class="fmx-field"><span>إلى تاريخ</span><input type="date" class="form-input-box" value="${esc(sv.before)}" onchange="app.pfSearchOpt('before', this.value)"></label></div>
                <div class="pfx-meta"><span id="pfx-live" class="pfx-live">● مباشر</span> <span id="pfx-smeta">${idx.docs.length.toLocaleString('en')} عنصر مفهرس في ${idx.ms}ms</span></div>
                <div id="pfx-results" class="pfx-results"></div></div>`)
            + (st.history.length ? card('عمليات بحث سابقة', `<div class="gh-row pfx-chips">${st.history.slice(0, 10).map(h => `<button class="gh-chip" onclick="${call('pfUseQuery', h)}">${esc(h)}</button>`).join('')}</div>`, 'fa-clock-rotate-left') : '');
    };
    P.pfSearchOpt = function (k, v) { this._pfSearchUI = { ...(this._pfSearchUI || {}), [k]: v }; return this.pfRunSearch(); };
    P.pfUseQuery = function (q) { const i = document.getElementById('pfx-q'); if (i) i.value = q; this._pfSearchUI = { ...(this._pfSearchUI || {}), q }; this.pfRecordQuery(q); this.pfHideSuggest(); return this.pfRunSearch(); };
    P.pfRunSearch = function (force) {
        const sv = this._pfSearchUI || {}, root = document.getElementById('pfx-results');
        if (force) this.pfSearchIndex(true);
        const filters = {}; ['type', 'role', 'after', 'before'].forEach(k => { if (sv[k]) filters[k] = sv[k]; });
        const hits = String(sv.q || '').trim() || Object.keys(filters).length ? this.pfSearch(sv.q || '', { filters, sort: sv.sort }) : [];
        this._pfRes = hits;
        if (!root) return hits;
        const meta = document.getElementById('pfx-smeta'); if (meta && this._pfIdx) meta.textContent = `${hits.length} نتيجة • ${this._pfSearchMs}ms • ${this._pfIdx.docs.length.toLocaleString('en')} عنصر مفهرس`;
        if (!hits.length) { root.innerHTML = String(sv.q || '').trim() ? empty('لا نتائج — جرّب كلمة أقصر (البحث يدعم البادئات والأخطاء الإملائية البسيطة)') : '<p class="gh-muted">اكتب للبحث الفوري في المحادثات والرسائل والملفات والمهام.</p>'; return hits; }
        const icon = { message: 'fa-message', session: 'fa-comments', file: 'fa-file-code', task: 'fa-list-check' };
        const pos = new Map(hits.map((h, i) => [h, i]));
        root.innerHTML = groupResults(hits.slice(0, 120), sv.group || 'type').map(([label, list]) => `<div class="pfx-group"><div class="pfx-group-h">${esc(label)} <small>(${list.length})</small></div>${list.map(h => `<button class="pfx-hit" onclick="${call('pfOpenResult', pos.get(h))}"><i class="fa-solid ${icon[h.doc.type] || 'fa-circle'}"></i><div><b>${esc(h.doc.type === 'message' ? (h.doc.role === 'user' ? 'أنت' : 'المساعد') + ' — ' + h.doc.title : h.doc.title)}</b><small>${snippet(h.doc.text, h.matched)}</small></div>${h.doc.t ? `<time>${esc(fmtDate(h.doc.t))}</time>` : ''}</button>`).join('')}</div>`).join('');
        return hits;
    };
    P.pfRenderSuggest = function () {
        const el = document.getElementById('pfx-suggest'), q = (this._pfSearchUI || {}).q || '';
        if (!el) return [];
        const list = q.trim() ? suggest(this._pfIdx, q, this.pfSearchStore().history) : [];
        el.hidden = !list.length;
        el.innerHTML = list.map(s => `<button class="pfx-sug" onclick="${call('pfUseQuery', s.text)}"><i class="fa-solid ${s.kind === 'history' ? 'fa-clock-rotate-left' : 'fa-magnifying-glass'}"></i> ${esc(s.text)}${s.df ? ` <small>${s.df}</small>` : ''}</button>`).join('');
        return list;
    };
    P.pfHideSuggest = function () { const el = document.getElementById('pfx-suggest'); if (el) el.hidden = true; };
    P.pfOpenResult = function (i) {
        const h = (this._pfRes || [])[i]; if (!h) return false;
        const d = h.doc, st = this.pfSearchStore();
        st.opens[d.id] = (st.opens[d.id] || 0) + 1;
        const keys = Object.keys(st.opens); if (keys.length > 500) keys.slice(0, keys.length - 500).forEach(k => delete st.opens[k]);
        this.pfSearchSave(st);
        this.pfRecordQuery((this._pfSearchUI || {}).q);
        if (this.closeModals) try { this.closeModals(); } catch (e) {}
        if (d.type === 'message' && this.goToMessage) this.goToMessage(d.session, d.msgId);
        else if (d.type === 'session') this.switchSession(d.session);
        else if (d.type === 'file' && this.openFileFromSearch) this.openFileFromSearch(d.path, h.matched[0] && this.virtualProjectFiles.get(d.path) ? normalize(this.virtualProjectFiles.get(d.path).content).slice(0, normalize(this.virtualProjectFiles.get(d.path).content).indexOf(h.matched[0])).split('\n').length : undefined);
        else if (d.type === 'task' && this.openTasks) this.openTasks();
        return d;
    };
    // Saved searches (#836)
    P.pfSaveSearch = function (name) {
        const sv = this._pfSearchUI || {};
        if (!String(sv.q || '').trim() && !sv.type) return null;
        const st = this.pfSearchStore();
        const item = { id: uid('ss'), name: name || sv.q, q: sv.q || '', type: sv.type || '', role: sv.role || '', sort: sv.sort || 'smart', group: sv.group || 'type', after: sv.after || '', before: sv.before || '', t: Date.now() };
        st.saved = [item, ...st.saved.filter(x => x.name !== item.name)].slice(0, 50);
        this.pfSearchSave(st);
        return item;
    };
    P.pfSaveSearchUI = async function () {
        const name = this.askText ? await this.askText('اسم البحث المحفوظ', (this._pfSearchUI || {}).q || '') : (this._pfSearchUI || {}).q;
        if (!name) return null;
        const r = this.pfSaveSearch(name);
        this.showToast(r ? '🔖 تم حفظ البحث' : 'اكتب عبارة بحث أولاً', r ? 'success' : 'warning');
        return r;
    };
    P.pfRunSaved = function (id) {
        const s = this.pfSearchStore().saved.find(x => x.id === id); if (!s) return null;
        this._pfSearchUI = { q: s.q, type: s.type, role: s.role, sort: s.sort, group: s.group, after: s.after, before: s.before };
        return this.pfLoad('search', 'instant');
    };
    P.pfDeleteSaved = function (id) { const st = this.pfSearchStore(); st.saved = st.saved.filter(x => x.id !== id); this.pfSearchSave(st); if (this._pfx && this._pfx.sec === 'saved') this.pfRefresh(); return true; };
    P.pfClearHistory = function () { const st = this.pfSearchStore(); st.history = []; this.pfSearchSave(st); if (this._pfx && this._pfx.sec === 'saved') this.pfRefresh(); return true; };
    P.pfSavedSearches = function () {
        const st = this.pfSearchStore();
        const count = (s) => { try { const f = {}; ['type', 'role', 'after', 'before'].forEach(k => { if (s[k]) f[k] = s[k]; }); return this.pfSearch(s.q, { filters: f }).length; } catch (e) { return '—'; } };
        return card(`عمليات البحث المحفوظة (${st.saved.length})`, st.saved.length ? `<div class="pfx-saved">${st.saved.map(s => `<div class="pfx-saved-row"><button class="pfx-hit" onclick="${call('pfRunSaved', s.id)}"><i class="fa-solid fa-bookmark"></i><div><b>${esc(s.name)}</b><small dir="auto">${esc(s.q)}${s.type ? ' • ' + esc(s.type) : ''}</small></div><span class="gh-chip">${count(s)}</span></button>${btn('fa-trash', '', call('pfDeleteSaved', s.id), 'sidebar-btn-util gh-btn', 'aria-label="حذف"')}</div>`).join('')}</div>` : empty('احفظ أي بحث من زر «حفظ» — يتحدث عدد نتائجه تلقائياً'), 'fa-bookmark')
            + card(`السجل (${st.history.length})`, st.history.length ? `<div class="gh-row pfx-chips">${st.history.map(h => `<button class="gh-chip" onclick="${call('pfRunHistory', h)}">${esc(h)}</button>`).join('')}</div><div class="gh-row">${btn('fa-broom', 'مسح السجل', call('pfClearHistory'))}</div>` : empty('لا سجل بعد'), 'fa-clock-rotate-left');
    };
    P.pfRunHistory = function (q) { this._pfSearchUI = { ...(this._pfSearchUI || { sort: 'smart', group: 'type' }), q }; return this.pfLoad('search', 'instant'); };
    // Voice search (#970)
    P.pfVoiceSearch = function () {
        const W = win(), SR = W.SpeechRecognition || W.webkitSpeechRecognition;
        if (!SR) { this.showToast('البحث الصوتي غير مدعوم في هذا المتصفح', 'warning'); return null; }
        const rec = new SR();
        rec.lang = /^(fr)/.test(navigator.language || '') ? 'fr-FR' : 'ar-SA'; rec.interimResults = false; rec.maxAlternatives = 1;
        if (this.settings.offlineVoice) try { rec.processLocally = true; } catch (e) {}
        rec.onresult = (e) => {
            const q = Array.from(e.results).map(r => r[0].transcript).join(' ').trim();
            if (!q) return;
            this._pfSearchUI = { ...(this._pfSearchUI || { sort: 'smart', group: 'type' }), q };
            this.pfRecordQuery(q);
            if (document.getElementById('pfx-q')) { document.getElementById('pfx-q').value = q; this.pfRunSearch(); } else this.openPerfHub('search', 'instant');
        };
        rec.onerror = (e) => this.showToast('تعذر التعرف على الصوت: ' + esc(e.error || ''), 'warning');
        try { rec.start(); this.showToast('🎙️ تكلم الآن…', 'info'); } catch (e) { return null; }
        this._pfRec = rec;
        return rec;
    };
}
