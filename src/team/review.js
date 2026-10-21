/* Code review: PR review with Approve / Request changes + line comments (#734), suggested changes (#747)
   accept/reject (#748) — on GitHub PRs and as local team suggestions — and AI review of the team's code (#792). */
import { esc, call, callRaw, btn, pbtn, card, empty, field, area, select, val, setHTML, lsGet, lsSet, uid, ago, sevBadge } from './util.js';

/** Unified diff patch (GitHub "patch" field) → rows with old/new line numbers. */
export function parsePatch(patch) {
    const rows = [];
    let o = 0, n = 0;
    for (const line of String(patch || '').split('\n')) {
        const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
        if (h) { o = +h[1]; n = +h[2]; rows.push({ type: 'hunk', text: line }); continue; }
        if (line.startsWith('+')) rows.push({ type: 'add', text: line.slice(1), newLine: n++ });
        else if (line.startsWith('-')) rows.push({ type: 'del', text: line.slice(1), oldLine: o++ });
        else if (line.startsWith('\\')) continue;
        else rows.push({ type: 'ctx', text: line.slice(1), oldLine: o++, newLine: n++ });
    }
    return rows;
}
export const commentableLines = (patch) => new Set(parsePatch(patch).filter(r => r.newLine != null).map(r => r.newLine));
export const suggestionBody = (replacement, note = '') => `${note ? note + '\n\n' : ''}\`\`\`suggestion\n${replacement}\n\`\`\``;
export function parseSuggestion(body) { const m = /```suggestion[^\n]*\n([\s\S]*?)\n?```/.exec(String(body || '')); return m ? m[1] : null; }
/** Replace lines [start..end] (1-based, inclusive) with the replacement text. */
export function applySuggestion(content, start, end, replacement) {
    const lines = String(content).split('\n');
    const s = Math.max(1, start || end), e = Math.max(s, end || s);
    lines.splice(s - 1, e - s + 1, ...(replacement === '' ? [] : String(replacement).split('\n')));
    return lines.join('\n');
}
const SUGG_KEY = 'ox_team_sugg_v1';

export function installReview(P) {
    // ------------------------------------------------------------------ PR REVIEW (#734)
    P.tmReview = async function (opts = {}) {
        if (!this.tmHasGH()) return empty('مراجعة PR تحتاج رمز GitHub — استخدم «الاقتراحات» للمراجعة المحلية داخل الفريق');
        const prs = await this.tmGH('/pulls?state=open&per_page=50') || [];
        const n = opts.pr || this._tmPR;
        this._tmMount = () => { if (n) this.tmReviewOpen(n); };
        return card('طلبات الدمج المفتوحة', prs.length ? prs.map(p => `<div class="gh-item ${+n === p.number ? 'active' : ''}"><a href="#" onclick="${call('tmReviewOpen', p.number)};return false">#${p.number} ${esc(p.title)}</a><small>@${esc(p.user && p.user.login)} • ${esc(p.head && p.head.ref)} → ${esc(p.base && p.base.ref)} • ${ago(p.updated_at || p.created_at)}</small></div>`).join('') : empty('لا طلبات دمج مفتوحة'), 'fa-code-pull-request')
            + '<div id="tm-pr"></div>';
    };
    P.tmReviewOpen = async function (num) {
        this._tmPR = +num;
        this._tmPending = this._tmPending && this._tmPending.pr === +num ? this._tmPending : { pr: +num, comments: [] };
        this.tmBusy('tm-pr', 'جارٍ تحميل التغييرات…');
        try {
            const [pr, files, comments] = await Promise.all([this.tmGH(`/pulls/${+num}`), this.tmList(`${this.ghRepoPath()}/pulls/${+num}/files`, { max: 100 }), this.tmList(`${this.ghRepoPath()}/pulls/${+num}/comments`, { max: 200 })]);
            this._tmPRData = { pr, files, comments };
            const byLine = {};
            comments.forEach(c => { const k = c.path + ':' + (c.line || c.original_line); (byLine[k] = byLine[k] || []).push(c); });
            const pend = this._tmPending.comments;
            const fileHtml = files.map(f => {
                const rows = parsePatch(f.patch).map(r => {
                    if (r.type === 'hunk') return `<tr class="tmx-hunk"><td colspan="3">${esc(r.text)}</td></tr>`;
                    const k = f.filename + ':' + r.newLine;
                    const thread = (byLine[k] || []).map(c => `<div class="tmx-rc"><b>@${esc(c.user && c.user.login)}</b> ${parseSuggestion(c.body) != null ? '💡 اقتراح' : ''}<div>${esc(c.body).slice(0, 600)}</div></div>`).join('') + pend.filter(c => c.path === f.filename && c.line === r.newLine).map(c => `<div class="tmx-rc pending">⏳ ${esc(c.body).slice(0, 300)}</div>`).join('');
                    return `<tr class="tmx-dl tmx-${r.type}" ${r.newLine != null ? `onclick="${call('tmReviewLineDialog', f.filename, r.newLine)}"` : ''}><td>${r.oldLine || ''}</td><td>${r.newLine || ''}</td><td><code>${r.type === 'add' ? '+' : r.type === 'del' ? '-' : ' '}${esc(r.text)}</code>${thread}</td></tr>`;
                }).join('');
                return `<details class="tmx-file" open><summary><code dir="ltr">${esc(f.filename)}</code> <span class="tmx-add">+${f.additions}</span> <span class="tmx-del">-${f.deletions}</span></summary><table class="tmx-diff" dir="ltr">${rows || `<tr><td>${esc(f.status)}</td></tr>`}</table></details>`;
            }).join('');
            setHTML('tm-pr', card(`#${pr.number} ${esc(pr.title)}`, `<div class="tmx-note">@${esc(pr.user && pr.user.login)} • ${files.length} ملف • انقر أي سطر جديد لإضافة تعليق أو اقتراح تعديل.</div>${fileHtml}
                ${area('tm-rev-body', 'ملخص المراجعة', '', 3)}
                <div class="gh-row"><span>تعليقات معلقة: <b>${pend.length}</b></span>${pbtn('fa-thumbs-up', 'Approve', call('tmSubmitReview', 'APPROVE'))}${btn('fa-pen-to-square', 'Request changes', call('tmSubmitReview', 'REQUEST_CHANGES'))}${btn('fa-comment', 'تعليق فقط', call('tmSubmitReview', 'COMMENT'))}${btn('fa-robot', 'مراجعة ذكية', call('tmAIReviewPR', pr.number))}</div>`, 'fa-code-compare'));
            return { pr, files, comments };
        } catch (e) { return this.tmErr(e, 'tm-pr'); }
    };
    P.tmReviewLineDialog = async function (path, line) {
        const f = ((this._tmPRData || {}).files || []).find(x => x.filename === path);
        const cur = f ? (parsePatch(f.patch).find(r => r.newLine === line) || {}).text || '' : '';
        const r = await this.showDialog({ title: `تعليق على ${path}:${line}`, fields: [{ id: 'body', label: 'التعليق', type: 'textarea', value: '' }, { id: 'sugg', label: 'اقتراح تعديل (اتركه فارغاً لتعليق عادي)', type: 'textarea', value: cur }, { id: 'is', label: 'إرسال كاقتراح Suggestion', type: 'checkbox', value: false }], buttons: [{ label: 'إضافة', value: 'ok', primary: true }, { label: 'إلغاء', value: null }] });
        if (!r) return null;
        return this.tmAddReviewComment(path, line, r.values.body, r.values.is ? r.values.sugg : null);
    };
    P.tmAddReviewComment = function (path, line, body, suggestion = null) {
        if (!this._tmPending) this._tmPending = { pr: this._tmPR, comments: [] };
        const text = suggestion != null ? suggestionBody(suggestion, body) : String(body || '').trim();
        if (!text) return null;
        const c = { path, line: +line, side: 'RIGHT', body: text };
        this._tmPending.comments.push(c);
        if (document.getElementById('tm-pr') && this._tmPR) this.tmReviewOpen(this._tmPR);
        return c;
    };
    P.tmSubmitReview = async function (event = 'COMMENT', body = val('tm-rev-body')) {
        const num = this._tmPR, data = this._tmPRData;
        if (!num || !data) return null;
        const comments = (this._tmPending && this._tmPending.pr === num ? this._tmPending.comments : []);
        if (event === 'REQUEST_CHANGES' && !String(body || '').trim() && !comments.length) { this.showToast('اكتب التغييرات المطلوبة أو أضف تعليقات على الأسطر', 'warning'); return null; }
        try {
            const r = await this.tmGH(`/pulls/${num}/reviews`, { method: 'POST', body: { commit_id: data.pr.head && data.pr.head.sha, event, body: body || (event === 'APPROVE' ? 'LGTM 👍' : ''), comments } });
            this._tmPending = { pr: num, comments: [] };
            this.showToast({ APPROVE: '👍 تمت الموافقة', REQUEST_CHANGES: '📝 طُلبت تغييرات', COMMENT: '💬 أُرسلت المراجعة' }[event], 'success');
            if (this.addXP) this.addXP(15, 'review');
            if (document.getElementById('tm-pr')) this.tmReviewOpen(num);
            return r;
        } catch (e) { return this.tmErr(e); }
    };

    // ------------------------------------------------------------------ SUGGESTIONS (#747, #748)
    P.tmLocalSuggestions = function () { return lsGet(SUGG_KEY, {})[this.tmRepoKey()] || []; };
    const saveSugg = (app, list) => { const all = lsGet(SUGG_KEY, {}); all[app.tmRepoKey()] = list.slice(0, 200); lsSet(SUGG_KEY, all); };
    /** Local team suggestion on a project file (shared with live-session peers). */
    P.tmSuggest = function ({ path, start, end, replacement, note = '', by } = {}) {
        const f = this.virtualProjectFiles.get(path);
        if (!f || typeof f.content !== 'string') { this.showToast('الملف غير موجود', 'warning'); return null; }
        const lines = f.content.split('\n');
        start = Math.max(1, +start || 1); end = Math.min(lines.length, Math.max(start, +end || start));
        const s = { id: uid('sg'), path, start, end, original: lines.slice(start - 1, end).join('\n'), replacement: String(replacement == null ? '' : replacement), note, by: by || this.tmMeSync(), t: Date.now(), status: 'open' };
        saveSugg(this, [s, ...this.tmLocalSuggestions()]);
        if (this.tmLiveSend) this.tmLiveSend({ t: 'suggest', s });
        return s;
    };
    P.tmOnRemoteSuggestion = function (d) {
        if (!d.s || this.tmLocalSuggestions().some(x => x.id === d.s.id)) { if (d.s) saveSugg(this, this.tmLocalSuggestions().map(x => (x.id === d.s.id ? d.s : x))); return; }
        saveSugg(this, [d.s, ...this.tmLocalSuggestions()]);
        this.tmInboxPush({ key: 'sg' + d.s.id, kind: 'suggest', title: `💡 ${d.s.by} اقترح تعديلاً على ${d.s.path}`, body: d.s.note || '' });
    };
    P.tmResolveSuggestion = function (id, accept = true) {
        const list = this.tmLocalSuggestions();
        const s = list.find(x => x.id === id);
        if (!s || s.status !== 'open') return null;
        if (accept) {
            const f = this.virtualProjectFiles.get(s.path);
            if (!f) { this.showToast('الملف لم يعد موجوداً', 'warning'); return null; }
            const lines = f.content.split('\n');
            // Re-anchor if the file moved: find the original block near the recorded position
            let start = s.start;
            if (lines.slice(start - 1, s.end).join('\n') !== s.original) {
                const idx = f.content.indexOf(s.original);
                if (idx < 0) { this.showToast('تغيّر الكود منذ الاقتراح — راجعه يدوياً', 'warning'); return null; }
                start = f.content.slice(0, idx).split('\n').length;
            }
            const end = start + (s.end - s.start);
            this.writeProjectFile(s.path, applySuggestion(f.content, start, end, s.replacement), 'suggestion');
            if (s.path === this.activeStudioFile && this.codeEditor && this.codeEditor.setValue) try { this.codeEditor.setValue(this.virtualProjectFiles.get(s.path).content); } catch (e) {}
        }
        s.status = accept ? 'accepted' : 'rejected';
        s.resolvedBy = this.tmMeSync(); s.resolved = Date.now();
        saveSugg(this, list);
        if (this.tmLiveSend) this.tmLiveSend({ t: 'suggest', s });
        this.showToast(accept ? '✅ طُبق الاقتراح' : '❌ رُفض الاقتراح', accept ? 'success' : 'info');
        if (document.getElementById('tmx-sec') && this._tm && this._tm.sec === 'suggest') this.tmRefresh();
        return s;
    };
    /** GitHub PR suggestion → commit the change on the PR branch (#748 accept) or reply (reject). */
    P.tmResolveGHSuggestion = async function (commentId, accept = true) {
        const c = await this.tmGH(`/pulls/comments/${+commentId}`);
        const num = +(/\/pulls\/(\d+)$/.exec(c.pull_request_url || '') || [])[1];
        const repl = parseSuggestion(c.body);
        if (!num || repl == null) throw new Error('ليس اقتراحاً');
        if (accept) {
            const pr = await this.tmGH(`/pulls/${num}`);
            const ref = pr.head.ref;
            const f = await this.tmGH(`/contents/${this.ghEncodePath(c.path)}?ref=${encodeURIComponent(ref)}`);
            const content = this.b64ToUtf8(f.content || '');
            const end = c.line || c.original_line, start = c.start_line || c.original_start_line || end;
            const next = applySuggestion(content, start, end, repl);
            await this.tmGH(`/contents/${this.ghEncodePath(c.path)}`, { method: 'PUT', body: { message: `Apply suggestion from @${c.user && c.user.login}`, content: this.utf8ToB64(next), sha: f.sha, branch: ref } });
        }
        await this.tmGH(`/pulls/${num}/comments/${+commentId}/replies`, { method: 'POST', body: { body: accept ? '✅ تم قبول الاقتراح وتطبيقه على الفرع.' : '❌ شكراً — لن نطبق هذا الاقتراح.' } }).catch(() => null);
        const done = lsGet('ox_team_sugg_done_v1', {}); done[commentId] = accept ? 'accepted' : 'rejected'; lsSet('ox_team_sugg_done_v1', done);
        this.showToast(accept ? '✅ طُبق الاقتراح على فرع الـ PR' : '❌ رُفض الاقتراح', accept ? 'success' : 'info');
        if (document.getElementById('tmx-sec') && this._tm && this._tm.sec === 'suggest') this.tmRefresh();
        return { pr: num, accepted: accept };
    };
    P.tmSuggestions = async function () {
        const local = this.tmLocalSuggestions();
        let gh = [];
        if (this.tmHasGH()) {
            const done = lsGet('ox_team_sugg_done_v1', {});
            gh = ((await this.tmGH('/pulls/comments?sort=created&direction=desc&per_page=50').catch(() => [])) || []).filter(c => parseSuggestion(c.body) != null).map(c => ({ ...c, status: done[c.id] || 'open' }));
        }
        const paths = this.projectPaths().filter(p => typeof (this.virtualProjectFiles.get(p) || {}).content === 'string');
        const row = (s) => `<div class="tmx-sugg ${s.status}"><div class="tmx-msg-h"><b>💡 ${esc(s.by)}</b> <code dir="ltr">${esc(s.path)}:${s.start}${s.end > s.start ? '-' + s.end : ''}</code> <small>${ago(s.t)}</small> ${s.status !== 'open' ? `<span class="fmx-tag">${s.status === 'accepted' ? '✅ مقبول' : '❌ مرفوض'}</span>` : ''}</div>${s.note ? `<div>${esc(s.note)}</div>` : ''}
            <pre class="tmx-del" dir="ltr">${esc(s.original)}</pre><pre class="tmx-add" dir="ltr">${esc(s.replacement)}</pre>${s.status === 'open' ? `<div class="gh-row">${pbtn('fa-check', 'قبول', call('tmResolveSuggestion', s.id, true))}${btn('fa-xmark', 'رفض', call('tmResolveSuggestion', s.id, false))}</div>` : ''}</div>`;
        return card('اقترح تعديلاً', `<div class="gh-row">${select('tm-sg-path', 'الملف', paths.map(p => [p, p]), this.activeStudioFile || paths[0] || '')}${field('tm-sg-start', 'من السطر', 1, 'type="number" min="1"')}${field('tm-sg-end', 'إلى السطر', 1, 'type="number" min="1"')}</div>
                ${area('tm-sg-repl', 'الكود المقترح', '', 4, 'dir="ltr"')}${field('tm-sg-note', 'لماذا؟', '')}<div class="gh-row">${pbtn('fa-lightbulb', 'إرسال الاقتراح', call('tmSuggestUI'))}</div>`, 'fa-lightbulb')
            + card('اقتراحات الفريق', local.map(row).join('') || empty('لا اقتراحات محلية'), 'fa-list-check')
            + (this.tmHasGH() ? card('اقتراحات على طلبات الدمج', gh.map(c => `<div class="tmx-sugg ${c.status}"><div class="tmx-msg-h"><b>@${esc(c.user && c.user.login)}</b> <code dir="ltr">${esc(c.path)}:${c.line || c.original_line}</code> ${c.status !== 'open' ? `<span class="fmx-tag">${c.status === 'accepted' ? '✅' : '❌'}</span>` : ''}</div><pre class="tmx-add" dir="ltr">${esc(parseSuggestion(c.body))}</pre>${c.status === 'open' ? `<div class="gh-row">${pbtn('fa-check', 'قبول وتطبيق', call('tmResolveGHSuggestionUI', c.id, true))}${btn('fa-xmark', 'رفض', call('tmResolveGHSuggestionUI', c.id, false))}</div>` : ''}</div>`).join('') || empty('لا اقتراحات على PR'), 'fa-code-pull-request') : '');
    };
    P.tmSuggestUI = function () { const s = this.tmSuggest({ path: val('tm-sg-path'), start: val('tm-sg-start'), end: val('tm-sg-end'), replacement: val('tm-sg-repl'), note: val('tm-sg-note') }); if (s) { this.showToast('💡 أُرسل الاقتراح', 'success'); this.tmRefresh(); } return s; };
    P.tmResolveGHSuggestionUI = async function (id, accept) { try { return await this.tmResolveGHSuggestion(id, accept); } catch (e) { return this.tmErr(e); } };

    // ------------------------------------------------------------------ AI REVIEW (#792)
    const REVIEW_PROMPT = 'Review this code change like a senior engineer on the team. Find bugs, security issues, performance problems, readability issues. Return JSON: {"summary": "Arabic summary", "verdict": "approve|changes|comment", "comments": [{"path": "file", "line": <new line number>, "severity": "high|medium|low", "body": "Arabic explanation", "suggestion": "optional replacement code for that line"}]}';
    P.tmAIReview = async function () {
        const prs = this.tmHasGH() ? (await this.tmGH('/pulls?state=open&per_page=30').catch(() => [])) || [] : [];
        const paths = this.projectPaths().filter(p => typeof (this.virtualProjectFiles.get(p) || {}).content === 'string');
        return card('مراجعة ذكية لكود الفريق', `<div class="gh-row">${prs.length ? select('tm-air-pr', 'طلب دمج', prs.map(p => [String(p.number), `#${p.number} ${p.title}`]), '') + pbtn('fa-robot', 'راجع الـ PR', callRaw('tmAIReviewPR', [], "+document.getElementById('tm-air-pr').value")) : ''}</div>
            <div class="gh-row">${select('tm-air-file', 'أو ملف من المشروع', paths.map(p => [p, p]), this.activeStudioFile || paths[0] || '')}${btn('fa-robot', 'راجع الملف', callRaw('tmAIReviewFile', [], "document.getElementById('tm-air-file').value"))}</div><div id="tm-air-out"></div>`, 'fa-robot');
    };
    P.tmAIReviewPR = async function (num) {
        if (!num) return null;
        const target = document.getElementById('tm-air-out') ? 'tm-air-out' : 'tm-pr';
        this.tmBusy(target, 'OX-AI يراجع التغييرات…');
        const files = await this.tmList(`${this.ghRepoPath()}/pulls/${+num}/files`, { max: 60 }).catch(e => this.tmErr(e, target));
        if (!files) return null;
        let budget = 30000;
        const diff = files.map(f => { const s = `--- ${f.filename}\n${f.patch || '(binary)'}\n`; const out = s.slice(0, Math.max(0, budget)); budget -= out.length; return out; }).join('\n');
        const r = await this.tmAI(`${REVIEW_PROMPT}\n\nDiff:\n${diff}`, { json: true, maxTokens: 3000, kind: 'coding' });
        if (!r) { setHTML(target, empty('لم يصل رد من الذكاء الاصطناعي', true)); return null; }
        const allowed = new Map(files.map(f => [f.filename, commentableLines(f.patch)]));
        const comments = (r.comments || []).filter(c => allowed.has(c.path) && allowed.get(c.path).has(+c.line));
        this._tmAIRev = { pr: +num, comments, summary: r.summary || '', verdict: r.verdict };
        setHTML(target, card(`نتيجة المراجعة الذكية — #${+num}`, `<p>${esc(r.summary || '')}</p>${(r.comments || []).map(c => `<div class="tmx-rc">${sevBadge(c.severity || 'low')} <code dir="ltr">${esc(c.path)}:${+c.line}</code> ${esc(c.body)}${c.suggestion ? `<pre class="tmx-add" dir="ltr">${esc(c.suggestion)}</pre>` : ''}</div>`).join('') || empty('لا ملاحظات — يبدو جيداً 👍')}
            ${comments.length ? `<div class="gh-row">${pbtn('fa-paper-plane', `انشر ${comments.length} تعليق كمراجعة`, call('tmPostAIReview'))}</div>` : ''}`, 'fa-robot'));
        return this._tmAIRev;
    };
    P.tmPostAIReview = async function () {
        const a = this._tmAIRev;
        if (!a) return null;
        const pr = await this.tmGH(`/pulls/${a.pr}`);
        const comments = a.comments.map(c => ({ path: c.path, line: +c.line, side: 'RIGHT', body: `🤖 ${c.body}${c.suggestion ? '\n\n```suggestion\n' + c.suggestion + '\n```' : ''}` }));
        const r = await this.tmGH(`/pulls/${a.pr}/reviews`, { method: 'POST', body: { commit_id: pr.head && pr.head.sha, event: 'COMMENT', body: `🤖 **مراجعة OX-AI**\n\n${a.summary}`, comments } }).catch(e => this.tmErr(e));
        if (r) this.showToast('🤖 نُشرت المراجعة الذكية على الـ PR', 'success');
        return r;
    };
    P.tmAIReviewFile = async function (path) {
        const f = this.virtualProjectFiles.get(path);
        if (!f || typeof f.content !== 'string') return null;
        this.tmBusy('tm-air-out', 'OX-AI يراجع الملف…');
        const numbered = f.content.split('\n').slice(0, 800).map((l, i) => `${i + 1}| ${l}`).join('\n');
        const r = await this.tmAI(`${REVIEW_PROMPT}\n\nFile ${path} (line-numbered):\n${numbered}`, { json: true, maxTokens: 3000, kind: 'coding' });
        if (!r) { setHTML('tm-air-out', empty('لم يصل رد من الذكاء الاصطناعي', true)); return null; }
        this._tmAIFile = { path, comments: r.comments || [] };
        setHTML('tm-air-out', card(`مراجعة ${esc(path)}`, `<p>${esc(r.summary || '')}</p>${(r.comments || []).map((c, i) => `<div class="tmx-rc">${sevBadge(c.severity || 'low')} <b>سطر ${+c.line}</b> ${esc(c.body)}${c.suggestion ? `<pre class="tmx-add" dir="ltr">${esc(c.suggestion)}</pre>${btn('fa-lightbulb', 'حوّله لاقتراح للفريق', call('tmAIToSuggestion', i))}` : ''}</div>`).join('') || empty('لا ملاحظات 👍')}`, 'fa-robot'));
        return this._tmAIFile;
    };
    P.tmAIToSuggestion = function (i) {
        const a = this._tmAIFile, c = a && a.comments[+i];
        if (!c) return null;
        const s = this.tmSuggest({ path: a.path, start: +c.line, end: +c.line, replacement: c.suggestion, note: '🤖 ' + c.body, by: 'OX-AI' });
        if (s) this.showToast('💡 أُضيف الاقتراح لقائمة الفريق', 'success');
        return s;
    };
}
