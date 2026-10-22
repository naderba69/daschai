/* History tab: #202 edit timeline • #204 compare two versions • #269 GitLens-style blame • #203 restore project to a point in time. */
import { esc, card, pbtn, btn, empty, setHTML, stats, table, call, ago, fmtDT, lineDiff, diffCounts, diffHTML, globMatcher } from './util.js';

const REASONS = { edit: 'تحرير', external: 'تغيير تلقائي', replace: 'بحث واستبدال', restore: 'استعادة', create: 'إنشاء', format: 'تنسيق', refactor: 'إعادة هيكلة', undo: 'تراجع', shell: 'الطرفية', snapshot: 'لقطة', 'lint-fix': 'إصلاح', 'mock-db': 'قاعدة وهمية', coverage: 'تغطية', ai: 'ذكاء اصطناعي' };
const reasonLabel = (r) => REASONS[r] || r || 'تغيير';

/** States of one file in time order: versions (content valid from t) + current. */
export function fileStates(versions, current) {
    const out = (versions || []).map(v => ({ t: v.t || v.savedAt || 0, content: v.content, reason: v.reason }));
    if (current && typeof current.content === 'string') out.push({ t: current.timestamp || Date.now(), content: current.content, reason: 'current', current: true });
    return out.sort((a, b) => a.t - b.t);
}
/** Content of a file at time T (null = did not exist yet / unknown). */
export function stateAt(states, T) {
    let hit = null;
    for (const s of states) { if (s.t <= T) hit = s; else break; }
    return hit;
}
/** Project-wide timeline entries (newest first): one per state transition. */
export function buildTimeline(map) {
    const out = [];
    Object.entries(map).forEach(([path, states]) => {
        states.forEach((s, i) => {
            const prev = states[i - 1];
            const c = prev ? diffCounts(lineDiff(prev.content, s.content, 2e5)) : { add: String(s.content || '').split('\n').length, del: 0 };
            out.push({ path, t: s.t, reason: i === 0 ? 'create' : states[i - 1].reason, idx: i, add: c.add, del: c.del, current: !!s.current });
        });
    });
    return out.sort((a, b) => b.t - a.t);
}
/** Local blame: each current line → time of the first state in which it appeared (LCS across states). */
export function localBlame(states) {
    if (!states.length) return [];
    let origin = String(states[0].content).split('\n').map(() => ({ t: states[0].t, idx: 0 }));
    for (let i = 1; i < states.length; i++) {
        const ops = lineDiff(states[i - 1].content, states[i].content, 4e6);
        const next = [];
        ops.forEach(o => { if (o.t === '=') next.push(origin[o.a - 1] || { t: states[i].t, idx: i }); else if (o.t === '+') next.push({ t: states[i].t, idx: i }); });
        origin = next;
    }
    return origin;
}
/** Flatten GitHub GraphQL blame ranges → per-line commit info (1-based index). */
export function blameFromRanges(ranges) {
    const out = [];
    (ranges || []).forEach(r => { for (let l = r.startingLine; l <= r.endingLine; l++) out[l] = { oid: r.commit.oid, short: r.commit.abbreviatedOid || String(r.commit.oid).slice(0, 7), message: String(r.commit.message || '').split('\n')[0], date: r.commit.committedDate, author: (r.commit.author && (r.commit.author.name || (r.commit.author.user && r.commit.author.user.login))) || '?', age: r.age }; });
    return out;
}
const BLAME_Q = 'query($owner:String!,$repo:String!,$expr:String!,$path:String!){repository(owner:$owner,name:$repo){object(expression:$expr){... on Commit{blame(path:$path){ranges{startingLine endingLine age commit{oid abbreviatedOid message committedDate author{name email user{login}}}}}}}}}';
/** Heat colour by relative age (0 = newest). */
const heat = (k) => `hsl(${Math.round(28 + k * 190)} 70% 50% / .55)`;

export function installHistory(P) {
    P.dvStates = function (path) { return fileStates(this.getFileVersions ? this.getFileVersions(path) : [], this.virtualProjectFiles.get(path)); };
    P.dvAllStates = function () {
        const map = {};
        const paths = new Set([...this.virtualProjectFiles.keys(), ...((this.fileVersions && this.fileVersions.keys()) || [])]);
        paths.forEach(p => { const s = this.dvStates(p); if (s.length) map[p] = s; });
        return map;
    };
    P.dvStateText = function (path, idx) {
        if (idx === 'current') return this.dvRead(path);
        const s = this.dvStates(path)[+idx];
        return s ? s.content : null;
    };

    // ---------------------------------------------------------------- #202 timeline
    P.dvTimeline = async function () {
        const f = this._dvTlFilter || '';
        const match = globMatcher(f);
        const all = buildTimeline(this.dvAllStates()).filter(e => match(e.path) && !(e.current && e.idx === 0));
        const days = {};
        all.slice(0, 400).forEach(e => { const d = new Date(e.t).toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long' }); (days[d] = days[d] || []).push(e); });
        const files = new Set(all.map(e => e.path)).size;
        return card('الخط الزمني للتحرير', `<p class="hv-dim">كل تغيير محفوظ محلياً لكل ملف (جلسات التحرير، الاستبدال الجماعي، الذكاء الاصطناعي، الطرفية…) مرتباً زمنياً. انقر أي نقطة لمقارنتها بالحالي أو بالنسخة التي قبلها.</p>
            <div class="gh-row"><input id="dv-tl-f" class="form-input-box" dir="ltr" placeholder="تصفية: src/**, *.css" value="${esc(f)}" onkeydown="if(event.key==='Enter'){app._dvTlFilter=this.value;app.dvRefresh()}">${btn('fa-filter', 'تصفية', "app._dvTlFilter=document.getElementById('dv-tl-f').value;app.dvRefresh()")}</div>
            ${stats([['تغيير', all.length], ['ملف', files], ['أقدم', all.length ? ago(all[all.length - 1].t) : '—']])}
            ${all.length ? Object.entries(days).map(([d, list]) => `<div class="dvx-day"><h4>${esc(d)}</h4>${list.map(e => `<div class="dvx-tl-item"><span class="dvx-tl-dot ${e.current ? 'cur' : ''}"></span><time>${new Date(e.t).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}</time><b dir="ltr">${esc(e.path)}</b><span class="gh-chip">${e.current ? 'الحالي' : esc(reasonLabel(e.reason))}</span><small><span class="dvx-good">+${e.add}</span> <span class="dvx-bad">−${e.del}</span></small>${e.current ? '' : btn('fa-code-compare', '', call('dvCompareOpen', e.path, e.idx, 'current'), 'gh-chip', 'title="مقارنة بالحالي"')}${e.idx > 0 ? btn('fa-backward-step', '', call('dvCompareOpen', e.path, e.idx - 1, e.current ? 'current' : e.idx), 'gh-chip', 'title="ما الذي تغيّر هنا"') : ''}</div>`).join('')}</div>`).join('') : empty('لا يوجد سجل تغييرات بعد — يُحفظ إصدار تلقائياً عند التحرير')}`, 'fa-timeline');
    };

    // ---------------------------------------------------------------- #204 compare
    P.dvCompare = async function (o = {}) {
        const paths = Array.from(new Set([...this.virtualProjectFiles.keys(), ...((this.fileVersions && this.fileVersions.keys()) || [])])).filter(p => typeof (this.virtualProjectFiles.get(p) || { content: '' }).content === 'string').sort();
        const c = this._dvCmp = { a: { path: o.pathA || (this._dvCmp && this._dvCmp.a.path) || this.activeStudioFile || paths[0] || '', ver: o.verA != null ? o.verA : (this._dvCmp ? this._dvCmp.a.ver : null) }, b: { path: o.pathB || (this._dvCmp && this._dvCmp.b.path) || this.activeStudioFile || paths[0] || '', ver: o.verB != null ? o.verB : 'current' } };
        const opts = (side) => {
            const st = this.dvStates(c[side].path);
            const list = st.map((s, i) => [s.current ? 'current' : String(i), s.current ? 'الحالي' : `${fmtDT(s.t)} — ${reasonLabel(s.reason)}`]).reverse();
            if (this._dvGhVers && this._dvGhVers[c[side].path]) this._dvGhVers[c[side].path].forEach(g => list.push(['gh:' + g.sha, `GitHub ${g.sha.slice(0, 7)} — ${g.message.slice(0, 40)}`]));
            if (c[side].ver == null) c[side].ver = list[side === 'a' && list.length > 1 ? 1 : 0] ? list[side === 'a' && list.length > 1 ? 1 : 0][0] : 'current';
            return list.map(([v, l]) => `<option value="${esc(v)}" ${String(c[side].ver) === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
        };
        const side = (k, label) => `<div class="dvx-cmp-side"><b>${label}</b><select class="form-input-box" dir="ltr" onchange="app.dvCompareSet('${k}','path',this.value)">${paths.map(p => `<option ${p === c[k].path ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select><select class="form-input-box" onchange="app.dvCompareSet('${k}','ver',this.value)">${opts(k)}</select></div>`;
        this._dvMount = () => this.dvComparePaint();
        return card('مقارنة نسختين', `<p class="hv-dim">قارن أي نسختين: إصدارين محليين لنفس الملف، أو ملفين مختلفين، أو نسخة من سجل GitHub.</p>
            <div class="dvx-cmp">${side('a', 'الأصل')}${btn('fa-right-left', '', 'app.dvCompareSwap()', 'sidebar-btn-util gh-btn', 'title="تبديل" aria-label="تبديل"')}${side('b', 'المعدّل')}</div>
            <div class="gh-row">${btn('fa-code-branch', 'جلب نسخ GitHub لهذا الملف', 'app.dvCompareGitHub()')}${btn('fa-rotate-left', 'استعادة «الأصل» للملف', 'app.dvCompareRestore()')}</div>
            <div id="dv-cmp-res"></div>`, 'fa-code-compare');
    };
    P.dvCompareSet = function (k, field, v) { const c = this._dvCmp; if (!c) return; c[k][field] = v; if (field === 'path') c[k].ver = k === 'b' ? 'current' : null; this.dvLoad('history', 'compare', {}); };
    P.dvCompareSwap = function () { const c = this._dvCmp; if (!c) return; [c.a, c.b] = [c.b, c.a]; this.dvLoad('history', 'compare', {}); };
    P.dvCompareOpen = function (path, a, b) { this._dvCmp = null; return this.openDevLab('history', 'compare', { pathA: path, pathB: path, verA: String(a), verB: String(b) }); };
    P.dvCompareText = async function (side) {
        const s = this._dvCmp[side];
        const v = String(s.ver);
        if (v.startsWith('gh:')) {
            const sha = v.slice(3), { owner, repo } = this.ghRepo();
            const r = await this.gh(`/repos/${owner}/${repo}/contents/${s.path.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`);
            return r && r.content ? (this.b64ToUtf8 ? this.b64ToUtf8(r.content) : atob(r.content.replace(/\s/g, ''))) : '';
        }
        return this.dvStateText(s.path, v === 'current' ? 'current' : +v) || '';
    };
    P.dvComparePaint = async function () {
        if (!this._dvCmp) return null;
        try {
            const [a, b] = await Promise.all([this.dvCompareText('a'), this.dvCompareText('b')]);
            const ops = lineDiff(a, b);
            const c = diffCounts(ops);
            setHTML('dv-cmp-res', stats([['أسطر مضافة', '+' + c.add], ['أسطر محذوفة', '−' + c.del], ['الأصل', a.split('\n').length + ' سطر'], ['المعدّل', b.split('\n').length + ' سطر']]) + diffHTML(ops));
            return c;
        } catch (e) { return this.dvErr(e, 'dv-cmp-res'); }
    };
    P.dvCompareGitHub = async function () {
        const c = this._dvCmp;
        if (!c) return null;
        if (!this.settings.githubToken) { this.showToast('أضف رمز GitHub في الإعدادات', 'warning'); return null; }
        try {
            const { owner, repo, branch } = this.ghRepo();
            const list = await this.gh(`/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&path=${encodeURIComponent(c.a.path)}&per_page=20`);
            this._dvGhVers = { ...(this._dvGhVers || {}), [c.a.path]: (list || []).map(x => ({ sha: x.sha, message: String(x.commit.message).split('\n')[0], date: x.commit.author && x.commit.author.date })) };
            this.showToast(`✅ ${list.length} نسخة من GitHub`, 'success');
            return this.dvLoad('history', 'compare', {});
        } catch (e) { return this.dvErr(e); }
    };
    P.dvCompareRestore = async function () {
        const c = this._dvCmp;
        if (!c || String(c.a.ver) === 'current') return null;
        const text = await this.dvCompareText('a');
        if (!(await this.askConfirm('استعادة النسخة', `استبدال محتوى ${c.a.path} بالنسخة المختارة؟ (يمكن التراجع من سجل الدفعات)`))) return null;
        this.dvApply('استعادة ' + c.a.path, [[c.a.path, text]]);
        this.showToast('↶ تمت الاستعادة', 'success');
        return this.dvLoad('history', 'compare', {});
    };

    // ---------------------------------------------------------------- #269 blame / GitLens
    P.dvBlame = async function (o = {}) {
        const paths = this.dvTextFiles().map(([p]) => p);
        const path = o.path || (this._dvBlame && this._dvBlame.path) || (this.activeStudioFile && this.virtualProjectFiles.has(this.activeStudioFile) ? this.activeStudioFile : paths[0]);
        this._dvMount = () => (path ? this.dvBlameRun(path, this._dvBlameSrc || (this.settings.githubToken ? 'github' : 'local')) : null);
        return card('Blame / GitLens', `<p class="hv-dim">لكل سطر: من غيّره ومتى وفي أي commit. مع رمز GitHub يُستخدم GraphQL blame للفرع الحالي (للأسطر غير المعدّلة محلياً)، وبدونه يُحسب blame محلي من سجل التحرير. الألوان: الأحدث دافئ والأقدم بارد.</p>
            <div class="gh-row"><select id="dv-blame-file" class="form-input-box" dir="ltr" onchange="app.dvBlameRun(this.value)">${paths.map(p => `<option ${p === path ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
            <select id="dv-blame-src" class="form-input-box dvx-narrow" onchange="app._dvBlameSrc=this.value;app.dvBlameRun()"><option value="github" ${(this._dvBlameSrc || (this.settings.githubToken ? 'github' : 'local')) === 'github' ? 'selected' : ''}>GitHub</option><option value="local" ${(this._dvBlameSrc || (this.settings.githubToken ? 'github' : 'local')) === 'local' ? 'selected' : ''}>محلي</option></select></div>
            <div id="dv-blame-res"></div>`, 'fa-user-pen');
    };
    P.dvBlameGitHub = async function (path) {
        const { owner, repo, branch } = this.ghRepo();
        const r = await this.gh('/graphql', { method: 'POST', body: { query: BLAME_Q, variables: { owner, repo, expr: branch, path } } });
        if (r && r.errors && r.errors.length) throw new Error(r.errors[0].message);
        const obj = r && r.data && r.data.repository && r.data.repository.object;
        if (!obj || !obj.blame) throw new Error('الملف غير موجود على الفرع ' + branch);
        return blameFromRanges(obj.blame.ranges);
    };
    P.dvBlameRun = async function (pathArg, srcArg) {
        const path = pathArg || (document.getElementById('dv-blame-file') || {}).value;
        const src = srcArg || this._dvBlameSrc || (document.getElementById('dv-blame-src') || {}).value || 'local';
        if (!path) return null;
        this.dvBusy('dv-blame-res');
        let r;
        try { r = await this.dvBlameCompute(path, src); } catch (e) {
            if (src !== 'github') return this.dvErr(e, 'dv-blame-res');
            try { r = await this.dvBlameCompute(path, 'local'); r.note = '⚠ تعذر GitHub blame (' + esc(e.message || String(e)) + ') — يُعرض السجل المحلي'; } catch (e2) { return this.dvErr(e2, 'dv-blame-res'); }
        }
        const { rows, note, lines } = r;
        const ts = rows.map(x => x.t).filter(Boolean), min = Math.min(...ts), max = Math.max(...ts);
        const k = (t) => (max === min ? 0 : (max - t) / (max - min));
        const authors = {};
        rows.forEach(r => { authors[r.who] = (authors[r.who] || 0) + 1; });
        let prevLabel = null;
        const body = lines.map((l, i) => {
            const r = rows[i], same = r.label === prevLabel;
            prevLabel = r.label;
            return `<div class="dvx-bl"><span class="dvx-bl-meta" style="border-inline-start:4px solid ${heat(k(r.t))}" title="${esc(r.msg)}">${same ? '' : `<b>${esc(r.who)}</b> <small>${esc(r.label)}</small>`}</span><span class="dvx-ln">${i + 1}</span><code>${esc(l) || ' '}</code></div>`;
        }).join('');
        setHTML('dv-blame-res', stats(Object.entries(authors).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([a, n]) => [esc(a), Math.round(n / rows.length * 100) + '%']))
            + (note ? `<small class="hv-dim">${note}</small>` : '') + `<div class="dvx-blame" dir="ltr">${body}</div>`);
        return this._dvBlame;
    };
    P.dvBlameCompute = async function (path, src) {
        const cur = this.dvRead(path) || '';
        const lines = cur.split('\n');
        let rows = [], note = '';
        if (src === 'github') {
            if (!this.settings.githubToken) throw new Error('GraphQL blame يتطلب رمز GitHub — استخدم «محلي»');
            const gh = await this.dvBlameGitHub(path);
            const base = this.getGitHubBase ? this.getGitHubBase(path) : null;
            const remote = base ? base.content : null;
            // lines changed locally since the synced copy are attributed to "uncommitted"
            let map = lines.map((_, i) => i + 1);
            if (remote != null && remote !== cur) {
                map = [];
                lineDiff(remote, cur).forEach(o => { if (o.t === '=') map[o.b - 1] = o.a; else if (o.t === '+') map[o.b - 1] = null; });
                note = 'الأسطر المميزة بـ «غير مرفوع» عُدّلت محلياً بعد آخر مزامنة';
            }
            rows = lines.map((l, i) => { const g = map[i] != null ? gh[map[i]] : null; return g ? { who: g.author, t: Date.parse(g.date), label: g.short, msg: g.message, oid: g.oid } : { who: 'أنت', t: Date.now(), label: 'غير مرفوع', msg: 'تعديل محلي' }; });
        } else {
            const states = this.dvStates(path);
            const origin = localBlame(states);
            rows = lines.map((l, i) => { const o = origin[i] || { t: Date.now(), idx: states.length - 1 }; const st = states[o.idx] || {}; return { who: o.idx === 0 ? 'الأصل' : reasonLabel((states[o.idx - 1] || {}).reason || (st.current ? 'edit' : st.reason)), t: o.t, label: o.idx === 0 ? 'أول نسخة' : ago(o.t), msg: fmtDT(o.t) }; });
            if (states.length <= 1) note = 'لا يوجد سجل تحرير لهذا الملف بعد — كل الأسطر تُنسب للنسخة الأولى';
        }
        this._dvBlame = { path, src, rows, at: Date.now() };
        return { rows, note, lines };
    };
    /** GitLens-style hint for one line (used by the editor status/palette). */
    P.dvBlameLine = async function (path, line) {
        if (!this._dvBlame || this._dvBlame.path !== path || Date.now() - this._dvBlame.at > 60000) {
            try { await this.dvBlameCompute(path, this._dvBlameSrc || (this.settings.githubToken ? 'github' : 'local')); } catch (e) { await this.dvBlameCompute(path, 'local'); }
        }
        const r = this._dvBlame && this._dvBlame.rows[line - 1];
        if (r) this.showToast(`🔎 سطر ${line}: ${this.escapeHTML(r.who)} • ${this.escapeHTML(r.label)} — ${this.escapeHTML(r.msg)}`, 'info');
        return r || null;
    };

    // ---------------------------------------------------------------- #203 restore to time T
    P.dvRestore = async function () {
        const map = this.dvAllStates();
        const times = Object.values(map).flat().map(s => s.t).filter(Boolean);
        const min = times.length ? Math.min(...times) : Date.now(), max = Date.now();
        const T = this._dvRestoreT || max;
        this._dvMount = () => this.dvRestorePreview(T);
        const local = (t) => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
        return card('استعادة المشروع إلى لحظة سابقة', `<p class="hv-dim">اختر وقتاً فيُحسب محتوى كل ملف كما كان حينها من السجل المحلي. راجع الفروق ثم طبّق — العملية دفعة واحدة قابلة للتراجع.</p>
            <div class="gh-row"><input type="range" id="dv-rs-range" class="dvx-range" min="${min}" max="${max}" step="1000" value="${T}" oninput="document.getElementById('dv-rs-at').value=app.dvLocalDT(+this.value)" onchange="app.dvRestorePreview(+this.value)" aria-label="الوقت">
            <input type="datetime-local" id="dv-rs-at" class="form-input-box dvx-narrow" value="${local(T)}" onchange="app.dvRestorePreview(new Date(this.value).getTime())"></div>
            <div class="dvx-flags"><label class="pfx-toggle"><input type="checkbox" id="dv-rs-del" ${this._dvRestoreDel ? 'checked' : ''} onchange="app._dvRestoreDel=this.checked;app.dvRestorePreview()"><span>حذف الملفات التي أُنشئت بعد هذا الوقت</span></label></div>
            <div id="dv-rs-res"></div>`, 'fa-clock-rotate-left');
    };
    P.dvLocalDT = function (t) { const d = new Date(t - new Date(t).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
    /** Plan: [{ path, from, to, action:'modify'|'delete', add, del }]. */
    P.dvRestorePlan = function (T, { deleteNew = false } = {}) {
        const plan = [];
        Object.entries(this.dvAllStates()).forEach(([path, states]) => {
            const cur = this.dvRead(path);
            if (cur == null) return; // deleted files are restored from the trash, not here
            const at = stateAt(states, T);
            if (!at) { if (deleteNew) plan.push({ path, action: 'delete', add: 0, del: cur.split('\n').length }); return; }
            if (at.content === cur) return;
            const c = diffCounts(lineDiff(cur, at.content, 2e5));
            plan.push({ path, action: 'modify', to: at.content, at: at.t, add: c.add, del: c.del });
        });
        return plan.sort((a, b) => a.path.localeCompare(b.path));
    };
    P.dvRestorePreview = function (Targ) {
        const T = Targ || this._dvRestoreT || Date.now();
        this._dvRestoreT = T;
        const plan = this.dvRestorePlan(T, { deleteNew: !!this._dvRestoreDel });
        this._dvRestorePlanCache = plan;
        setHTML('dv-rs-res', `<p>الحالة في <b>${esc(fmtDT(T))}</b> (${ago(T)})</p>` + (plan.length ? table(['الملف', 'الإجراء', 'الفرق', ''], plan.map((p, i) => [`<span dir="ltr">${esc(p.path)}</span>`, p.action === 'delete' ? '🗑 حذف' : '↶ استعادة', `<span class="dvx-good">+${p.add}</span> <span class="dvx-bad">−${p.del}</span>`, p.action === 'modify' ? btn('fa-eye', '', call('dvRestoreDiff', i), 'gh-chip', 'title="معاينة"') : ''])) + `<div class="gh-row">${pbtn('fa-clock-rotate-left', `استعادة ${plan.length} ملف`, 'app.dvRestoreApply()')}</div><div id="dv-rs-diff"></div>` : empty('المشروع مطابق لهذه اللحظة — لا شيء للاستعادة')));
        return plan;
    };
    P.dvRestoreDiff = function (i) { const p = (this._dvRestorePlanCache || [])[i]; if (!p) return; setHTML('dv-rs-diff', card(`<span dir="ltr">${esc(p.path)}</span>`, diffHTML(lineDiff(this.dvRead(p.path) || '', p.to)), 'fa-code-compare')); };
    P.dvRestoreApply = async function (Targ, opts = {}) {
        const T = Targ || this._dvRestoreT;
        const plan = this.dvRestorePlan(T, { deleteNew: opts.deleteNew != null ? opts.deleteNew : !!this._dvRestoreDel });
        if (!plan.length) return 0;
        if (!opts.yes && !(await this.askConfirm('استعادة المشروع', `سيتم تعديل ${plan.length} ملف إلى حالتها في ${fmtDT(T)}. يمكن التراجع من «سجل الاستبدال».`))) return 0;
        this.dvApply('استعادة إلى ' + fmtDT(T), plan.map(p => [p.path, p.action === 'delete' ? null : p.to]));
        this.showToast(`↶ تمت استعادة ${plan.length} ملف`, 'success');
        if (document.getElementById('dv-rs-res')) this.dvRestorePreview(T);
        return plan.length;
    };
}
