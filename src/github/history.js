/* History tab: timeline (#428), network graph (#430), blame (#429), cherry-pick (#422), rebase (#423),
   reorder (#425), reword (#426), revert (#427), commit↔issue links (#440), tags (#455 #456). */
import { esc, call, encRef, encPath, shortSha, headline, groupByDay, linkIssues, issueRefs, isValidRefName } from './shared.js';
import { card, btn, empty, note, input, select, val, avatar } from './core.js';
import { gitOps, layoutGraph, graphSVG } from './gitops.js';

const dayLabel = (day) => { const d = new Date(day + 'T12:00:00'); return isNaN(d) ? day : d.toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); };

export function installHistory(P) {
    P.ghxHistBranch = function () { return this._ghxHistBranch || this.ghRepo().branch; };
    P.ghxSetHistBranch = function (b) { this._ghxHistBranch = b; this._ghxTimelinePage = 1; this._ghxReorder = null; return this.ghxReload(); };
    const branchPicker = (app, branches, cur) => `<label class="gh-check"><i class="fa-solid fa-code-branch"></i> ${select('ghx-hist-branch', branches.includes(cur) ? branches : [cur, ...branches], cur, { style: 'width:auto;font-size:0.76rem' })}</label>`
        .replace('<select ', `<select onchange="app.ghxSetHistBranch(this.value)" `);

    // ------------------------------------------------------------------ TIMELINE (#428 #440)
    P.ghxTimeline = async function () {
        const rp = this.ghRepoPath();
        const branch = this.ghxHistBranch();
        const page = this._ghxTimelinePage || 1;
        const [branches, commits] = await Promise.all([this.ghxBranches().catch(() => [branch]), this.gh(`${rp}/commits?sha=${encodeURIComponent(branch)}&per_page=40&page=${page}`)]);
        this._ghxTimeline = { branch, commits };
        const groups = groupByDay(commits, c => (c.commit.author && c.commit.author.date) || (c.commit.committer && c.commit.committer.date));
        const row = (c) => {
            const msg = c.commit.message || '';
            const refs = issueRefs(msg);
            return `<div class="ghx-tl-item" data-sha="${esc(c.sha)}">
                <span class="ghx-tl-dot"></span>
                ${avatar(c.author)}
                <div class="gh-item-main">
                    <div class="gh-item-title">${linkIssues(this, esc(headline(msg)))} ${c.parents && c.parents.length > 1 ? '<span class="gh-badge purple">دمج</span>' : ''} ${c.commit.verification && c.commit.verification.verified ? '<span class="gh-badge ok" title="موقّع"><i class="fa-solid fa-certificate"></i></span>' : ''}</div>
                    <div class="gh-item-meta"><b>${esc((c.author && c.author.login) || (c.commit.author && c.commit.author.name) || '')}</b> • ${this.ghTimeAgo(c.commit.author && c.commit.author.date)} • <code dir="ltr">${esc(shortSha(c.sha))}</code>${refs.length ? ` • <i class="fa-solid fa-link"></i> ${refs.map(n => `#${n}`).join(' ')}` : ''}</div>
                </div>
                <div class="gh-item-actions">
                    ${btn('', call(this, 'ghxCommitView', c.sha), { icon: 'fa-eye', title: 'التفاصيل والفروقات' })}
                    ${btn('', call(this, 'ghxCherryPickUI', c.sha), { icon: 'fa-cherries', title: 'Cherry-pick إلى فرع آخر' })}
                    ${btn('', call(this, 'ghxRevertUI', c.sha), { icon: 'fa-rotate-left', title: 'التراجع (Revert)' })}
                    ${btn('', call(this, 'ghxRewordUI', c.sha), { icon: 'fa-pen', title: 'تعديل رسالة الـ Commit' })}
                    ${btn('', call(this, 'ghxLinkCommitIssue', c.sha), { icon: 'fa-link', title: 'ربط بـ Issue' })}
                </div></div>`;
        };
        return `<div class="gh-toolbar">${branchPicker(this, branches, branch)}<span class="gh-spacer"></span>
                ${page > 1 ? btn('الأحدث', `app._ghxTimelinePage=${page - 1}; app.ghxReload()`, { icon: 'fa-chevron-right' }) : ''}
                <span class="text-dim" style="font-size:0.74rem">صفحة ${page}</span>
                ${commits.length === 40 ? btn('الأقدم', `app._ghxTimelinePage=${page + 1}; app.ghxReload()`, { icon: 'fa-chevron-left' }) : ''}</div>
            ${commits.length ? `<div class="ghx-timeline">${groups.map(g => `<div class="ghx-tl-day"><div class="ghx-tl-head"><i class="fa-regular fa-calendar"></i> ${esc(dayLabel(g.day))} <span class="text-dim">(${g.items.length})</span></div>${g.items.map(row).join('')}</div>`).join('')}</div>` : empty('لا توجد commits في هذا الفرع.')}`;
    };

    P.ghxCommitView = function (sha) {
        return this.ghxView('ghxCommitView', [sha], async () => {
            const c = await this.gh(`${this.ghRepoPath()}/commits/${sha}`);
            const files = c.files || [];
            const refs = issueRefs(c.commit.message);
            return `<div class="gh-detail-head"><h3>${linkIssues(this, esc(headline(c.commit.message)))}</h3>
                    <div class="gh-item-meta">${avatar(c.author)} <b>${esc((c.author && c.author.login) || c.commit.author.name)}</b> • ${this.ghTimeAgo(c.commit.author.date)} • <code dir="ltr">${esc(c.sha)}</code></div></div>
                ${c.commit.message.includes('\n') ? `<pre class="ghx-pre">${esc(c.commit.message.split('\n').slice(1).join('\n').trim())}</pre>` : ''}
                <div class="gh-card gh-item-meta">${files.length} ملف • <span class="text-emerald">+${+(c.stats && c.stats.additions) || 0}</span> <span class="text-red">−${+(c.stats && c.stats.deletions) || 0}</span>
                    • الآباء: ${(c.parents || []).map(p => `<a href="#" onclick="event.preventDefault(); ${call(this, 'ghxCommitView', p.sha)}"><code dir="ltr">${esc(shortSha(p.sha))}</code></a>`).join(' ')}
                    ${refs.length ? `• Issues: ${refs.map(n => `<a href="#" onclick="event.preventDefault(); app.ghOpenIssue(${n})">#${n}</a>`).join(' ')}` : ''}</div>
                <div class="gh-toolbar">${btn('Cherry-pick', call(this, 'ghxCherryPickUI', sha), { icon: 'fa-cherries' })}${btn('Revert', call(this, 'ghxRevertUI', sha), { icon: 'fa-rotate-left' })}${btn('ربط بـ Issue', call(this, 'ghxLinkCommitIssue', sha), { icon: 'fa-link' })}
                    <a class="sidebar-btn-util gh-btn" href="${esc(c.html_url)}" target="_blank" rel="noopener"><i class="fa-solid fa-up-right-from-square"></i> GitHub</a></div>
                <div class="gh-card">${files.map(f => `<details class="gh-file"><summary><span class="gh-file-status ${esc(f.status)}">${esc(f.status)}</span> <span dir="ltr">${esc(f.filename)}</span> <span class="text-emerald">+${+f.additions}</span> <span class="text-red">−${+f.deletions}</span></summary>
                    <div class="git-diff-output-box gh-patch">${this.renderPatchHTML(f.patch)}</div></details>`).join('') || '<div class="text-dim">لا ملفات</div>'}</div>`;
        });
    };

    P.ghxRunGitOp = async function (label, fn) {
        if (!this.ghRequireToken()) return null;
        this.showToast(`⏳ ${label}...`, 'info');
        try {
            const r = await fn(gitOps(this));
            return r;
        } catch (e) {
            this.showToast((e.conflict ? '⚠️ ' : '❌ ') + e.message, e.conflict ? 'warning' : 'error');
            return null;
        }
    };

    // ------------------------------------------------------------------ CHERRY-PICK (#422)
    P.ghxCherryPickUI = async function (sha) {
        if (!this.ghRequireToken()) return;
        const branches = await this.ghxBranches().catch(() => []);
        const from = this.ghxHistBranch();
        const targets = branches.filter(b => b !== from);
        if (!targets.length) { this.showToast('لا يوجد فرع آخر للتطبيق عليه — أنشئ فرعاً أولاً', 'warning'); return; }
        const r = await this.showDialog({
            title: `🍒 Cherry-pick ${shortSha(sha)}`,
            body: '<p class="ox-dialog-msg">يُطبَّق هذا الـ commit فوق آخر commit في الفرع المختار (دمج ثلاثي يجريه GitHub). عند التعارض لن يتغير شيء.</p>',
            fields: [{ id: 'target', type: 'select', label: 'الفرع الهدف', value: targets[0], options: targets.map(b => ({ value: b, label: b })) }],
            buttons: [{ label: 'تطبيق', value: 'ok', primary: true }, { label: 'إلغاء', value: null }]
        });
        if (!r) return;
        const target = r.values.target;
        const res = await this.ghxRunGitOp('جاري الـ Cherry-pick', (ops) => ops.cherryPick(target, sha));
        if (!res) return;
        this.showToast(res.empty ? `ℹ️ التغييرات موجودة مسبقاً في ${target}` : `✅ تم تطبيق ${shortSha(sha)} على ${target} (${shortSha(res.sha)})`, res.empty ? 'info' : 'success');
        return res;
    };

    // ------------------------------------------------------------------ REVERT (#427)
    P.ghxRevertUI = async function (sha) {
        if (!this.ghRequireToken()) return;
        const branch = this.ghxHistBranch();
        if (!(await this.ghxConfirm('التراجع عن commit', `إنشاء commit جديد في <b dir="ltr">${esc(branch)}</b> يعكس تغييرات <code dir="ltr">${esc(shortSha(sha))}</code>؟ (لا يُعاد كتابة السجل)`))) return;
        const res = await this.ghxRunGitOp('جاري التراجع', (ops) => ops.revert(branch, sha));
        if (!res) return;
        this.showToast(res.empty ? 'ℹ️ لا يوجد ما يُتراجع عنه — التغييرات أزيلت مسبقاً' : `✅ تم التراجع (${shortSha(res.sha)})`, res.empty ? 'info' : 'success');
        if (this.ghTab === 'history' && !this.ghView) this.ghxReload();
        return res;
    };

    // ------------------------------------------------------------------ REWORD (#426)
    P.ghxRewordUI = async function (sha) {
        if (!this.ghRequireToken()) return;
        const branch = this.ghxHistBranch();
        let msg = '';
        try { msg = (await this.gh(`${this.ghRepoPath()}/git/commits/${sha}`)).message; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return; }
        const r = await this.showDialog({
            title: `✏️ تعديل رسالة ${shortSha(sha)}`,
            body: `<p class="ox-dialog-msg">⚠️ يعيد كتابة السجل (force push) من هذا الـ commit حتى آخر الفرع <b dir="ltr">${esc(branch)}</b>. الملفات لا تتغير — فقط معرّفات الـ commits.</p>`,
            fields: [{ id: 'msg', type: 'textarea', label: 'الرسالة الجديدة', value: msg, rows: 5, dir: 'auto' }],
            buttons: [{ label: 'حفظ', value: 'ok', primary: true, validate: (v) => (v.msg.trim() ? null : 'الرسالة فارغة') }, { label: 'إلغاء', value: null }]
        });
        if (!r || r.values.msg.trim() === msg.trim()) return;
        const res = await this.ghxRunGitOp('جاري إعادة الكتابة', (ops) => ops.reword(branch, sha, r.values.msg.trim()));
        if (!res) return;
        this.showToast(`✅ تم تعديل الرسالة — أُعيد إنشاء ${res.rewritten} commit`, 'success');
        if (this.ghTab === 'history') { this.ghView = null; this.ghxReload(); }
        return res;
    };

    // ------------------------------------------------------------------ COMMIT ↔ ISSUE (#440)
    P.ghxLinkCommitIssue = async function (sha) {
        if (!this.ghRequireToken()) return;
        const n = await this.askText('ربط الـ commit بـ Issue', '', { label: 'رقم الـ Issue', placeholder: '42', validate: (v) => (/^#?\d+$/.test(v) ? null : 'أدخل رقماً') });
        if (!n) return;
        const num = +n.replace('#', '');
        try {
            await this.gh(`${this.ghRepoPath()}/issues/${num}/comments`, { method: 'POST', body: { body: `🔗 مرتبط بالـ commit ${sha}` } });
            this.showToast(`✅ تم ربط ${shortSha(sha)} بالـ Issue #${num}`, 'success');
            return true;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };

    // ------------------------------------------------------------------ NETWORK GRAPH (#430)
    P.ghxGraph = async function () {
        const rp = this.ghRepoPath();
        const branches = (await this.gh(`${rp}/branches?per_page=100`)).slice(0, 8);
        const lists = await Promise.all(branches.map(b => this.gh(`${rp}/commits?sha=${encodeURIComponent(b.name)}&per_page=30`).catch(() => [])));
        const by = new Map();
        lists.flat().forEach(c => by.set(c.sha, c));
        const commits = Array.from(by.values()).sort((a, b) => Date.parse(b.commit.committer.date) - Date.parse(a.commit.committer.date)).slice(0, 80);
        const labels = {};
        branches.forEach(b => { const s = b.commit && b.commit.sha; if (s) (labels[s] = labels[s] || []).push(b.name); });
        const layout = layoutGraph(commits.map(c => ({ sha: c.sha, parents: (c.parents || []).map(p => p.sha) })));
        const g = graphSVG(layout, { labels });
        return `<div class="gh-item-meta" style="margin-bottom:8px">${branches.length} فرع • ${commits.length} commit • ${layout.width} مسار</div>
            <div class="ghx-graph" dir="ltr"><div class="ghx-graph-lanes" style="width:${g.width}px">${g.svg}</div>
            <div class="ghx-graph-rows">${commits.map(c => `<div class="ghx-graph-row" style="height:${g.rowH}px" onclick="${call(this, 'ghxCommitView', c.sha)}" title="${esc(c.commit.message)}">
                ${(labels[c.sha] || []).map(n => `<span class="gh-badge run">${esc(n)}</span>`).join('')}<code>${esc(shortSha(c.sha))}</code> <span class="ghx-graph-msg">${esc(headline(c.commit.message))}</span> <span class="text-dim">${esc((c.author && c.author.login) || c.commit.author.name)} · ${this.ghTimeAgo(c.commit.committer.date)}</span></div>`).join('')}</div></div>`;
    };

    // ------------------------------------------------------------------ BLAME (#429)
    P.ghxBlame = async function () {
        const branch = this.ghxHistBranch();
        const path = this._ghxBlamePath || '';
        const paths = await this.ghRepoPaths().catch(() => []);
        const form = `<div class="gh-card gh-form"><div class="gh-row">${input('ghx-blame-path', { value: path, placeholder: 'src/app.js', list: 'ghx-blame-list', style: 'flex:1' })}
            <datalist id="ghx-blame-list">${paths.slice(0, 1500).map(p => `<option value="${esc(p)}">`).join('')}</datalist>
            ${btn('عرض', "app._ghxBlamePath=document.getElementById('ghx-blame-path').value.trim(); app.ghxReload()", { icon: 'fa-user-pen', primary: true })}</div>
            <div class="text-dim" style="font-size:0.72rem">الفرع: <span dir="ltr">${esc(branch)}</span> — من عدّل كل سطر ومتى (GraphQL، يحتاج رمز PAT)</div></div>`;
        if (!path) return form + empty('اختر ملفاً لعرض Blame.');
        this.ghxNeedToken('Blame');
        const { owner, repo } = this.ghRepo();
        const q = `query($o:String!,$r:String!,$e:String!,$p:String!){repository(owner:$o,name:$r){object(expression:$e){... on Commit{blame(path:$p){ranges{startingLine endingLine age commit{oid abbreviatedOid messageHeadline committedDate author{name user{login}}}}}}}}}`;
        const [data, file] = await Promise.all([
            this.ghGraphQL(q, { o: owner, r: repo, e: branch, p: path }),
            this.gh(`${this.ghRepoPath()}/contents/${encPath(path)}?ref=${encodeURIComponent(branch)}`)
        ]);
        const ranges = (data && data.repository && data.repository.object && data.repository.object.blame && data.repository.object.blame.ranges) || [];
        const text = file && file.content ? this.b64ToUtf8(file.content) : '';
        const lines = text.split('\n');
        const authors = new Map();
        ranges.forEach(r => { const a = (r.commit.author.user && r.commit.author.user.login) || r.commit.author.name; authors.set(a, (authors.get(a) || 0) + (r.endingLine - r.startingLine + 1)); });
        const rows = [];
        for (const r of ranges) {
            for (let ln = r.startingLine; ln <= Math.min(r.endingLine, 3000); ln++) {
                const first = ln === r.startingLine;
                const a = (r.commit.author.user && r.commit.author.user.login) || r.commit.author.name;
                rows.push(`<tr class="${first ? 'ghx-blame-start' : ''}" data-age="${+r.age}"><td class="ghx-blame-meta">${first ? `<a href="#" onclick="event.preventDefault(); ${call(this, 'ghxCommitView', r.commit.oid)}" title="${esc(r.commit.messageHeadline)}"><code>${esc(r.commit.abbreviatedOid)}</code></a> <b>${esc(a)}</b> <span class="text-dim">${this.ghTimeAgo(r.commit.committedDate)}</span>` : ''}</td><td class="ghx-blame-ln">${ln}</td><td class="ghx-blame-code"><pre>${esc(lines[ln - 1] || '')}</pre></td></tr>`);
            }
        }
        const total = Array.from(authors.values()).reduce((a, b) => a + b, 0) || 1;
        return form + `<div class="gh-card"><b>المساهمة في الملف</b><div class="gh-contributors">${Array.from(authors.entries()).sort((a, b) => b[1] - a[1]).map(([a, n]) => `<span class="gh-contrib"><b>${esc(a)}</b> ${(n / total * 100).toFixed(0)}%</span>`).join('')}</div></div>
            <div class="ghx-blame-wrap" dir="ltr"><table class="ghx-blame"><tbody>${rows.join('') || '<tr><td>—</td></tr>'}</tbody></table></div>`;
    };

    // ------------------------------------------------------------------ REWRITE: reorder (#425), rebase (#423), squash
    P.ghxRewrite = async function () {
        const rp = this.ghRepoPath();
        const branch = this.ghxHistBranch();
        const [info, branches] = await Promise.all([this.ghRepoInfo(), this.ghxBranches().catch(() => [branch])]);
        const def = info.default_branch;
        if (!this._ghxReorder || this._ghxReorder.branch !== branch) {
            const ops = gitOps(this);
            const chain = await ops.firstParentChain(branch, null, 12).catch(() => []);
            const last = chain.slice(-8);
            this._ghxReorder = { branch, original: last.map(c => c.sha), list: last.map(c => ({ sha: c.sha, msg: headline(c.commit.message), merge: (c.parents || []).length > 1 })) };
        }
        const R = this._ghxReorder;
        const changed = R.list.map(x => x.sha).join() !== R.original.join();
        const isDefault = branch === def;
        const reorderCard = card('إعادة ترتيب آخر الـ Commits', `
            <div class="text-dim" style="font-size:0.74rem;margin-bottom:6px">الأقدم في الأعلى. يعيد GitHub تطبيقها بالترتيب الجديد ثم يُحدَّث الفرع (force push).</div>
            <div class="ghx-reorder">${R.list.map((x, i) => `<div class="ghx-reorder-item${x.merge ? ' merge' : ''}" data-sha="${esc(x.sha)}"><span class="ghx-reorder-n">${i + 1}</span><code dir="ltr">${esc(shortSha(x.sha))}</code><span class="ghx-reorder-msg">${esc(x.msg)}</span>
                ${btn('', `app.ghxReorderMove(${i},-1)`, { icon: 'fa-arrow-up', title: 'أعلى', attrs: i === 0 ? 'disabled' : '' })}${btn('', `app.ghxReorderMove(${i},1)`, { icon: 'fa-arrow-down', title: 'أسفل', attrs: i === R.list.length - 1 ? 'disabled' : '' })}</div>`).join('') || '<div class="text-dim">—</div>'}</div>
            <div class="gh-row" style="margin-top:8px">${btn('تطبيق الترتيب', 'app.ghxApplyReorder()', { icon: 'fa-check', primary: true, attrs: changed ? '' : 'disabled' })}${changed ? btn('إلغاء التغييرات', "app._ghxReorder=null; app.ghxReload()", { icon: 'fa-xmark' }) : ''}</div>`, { icon: 'fa-arrow-down-up-across-line' });
        const rebaseCard = card('Rebase مرئي', `
            <div class="gh-row"><span dir="ltr">${esc(branch)}</span> <span class="text-dim">فوق</span> ${select('ghx-rebase-base', branches.filter(b => b !== branch), def !== branch ? def : branches.find(b => b !== branch), { style: 'width:auto' })}
                ${btn('معاينة', 'app.ghxRebasePreview()', { icon: 'fa-eye' })}${btn('Rebase', 'app.ghxRebase()', { icon: 'fa-code-branch', primary: true })}</div>
            <div id="ghx-rebase-preview" class="ghx-rebase-preview"></div>`, { icon: 'fa-layer-group' });
        const squashCard = card('دمج آخر الـ Commits في واحد (Squash)', `
            <div class="gh-row"><label>عدد الـ commits</label>${input('ghx-squash-n', { value: '2', type: 'number', style: 'max-width:80px' })}${btn('Squash', 'app.ghxSquashLast()', { icon: 'fa-compress', primary: true })}</div>`, { icon: 'fa-compress' });
        return `<div class="gh-toolbar">${branchPicker(this, branches, branch)}</div>
            ${isDefault ? note(`⚠️ <b dir="ltr">${esc(branch)}</b> هو الفرع الافتراضي — إعادة كتابة سجله تؤثر على كل من استنسخه. يُفضل العمل على فرع آخر.`, 'warn') : ''}
            ${reorderCard}${rebaseCard}${squashCard}`;
    };

    P.ghxReorderMove = function (i, d) {
        const R = this._ghxReorder;
        if (!R) return;
        const j = i + d;
        if (j < 0 || j >= R.list.length) return;
        [R.list[i], R.list[j]] = [R.list[j], R.list[i]];
        return this.ghxReload();
    };

    P.ghxApplyReorder = async function () {
        const R = this._ghxReorder;
        if (!R || !this.ghRequireToken()) return;
        if (R.list.some(x => x.merge)) { this.showToast('لا يمكن إعادة ترتيب commits دمج', 'warning'); return; }
        if (!(await this.ghxConfirm('إعادة ترتيب الـ Commits', `سيُعاد كتابة سجل <b dir="ltr">${esc(R.branch)}</b> (force push). متابعة؟`, { danger: true }))) return;
        const res = await this.ghxRunGitOp('جاري إعادة الترتيب', (ops) => ops.reorder(R.branch, R.list.map(x => x.sha)));
        if (!res) return;
        this.showToast(`✅ أعيد ترتيب ${res.applied.length} commit${res.skipped.length ? ` (تخطي ${res.skipped.length} فارغ)` : ''}`, 'success');
        this._ghxReorder = null;
        this.ghxReload();
        return res;
    };

    P.ghxRebasePreview = async function () {
        const base = val('ghx-rebase-base'), head = this.ghxHistBranch();
        const box = document.getElementById('ghx-rebase-preview');
        if (!box || !base) return;
        box.innerHTML = '<span class="live-step-spinner"></span>';
        try {
            const cmp = await this.gh(`${this.ghRepoPath()}/compare/${encRef(base)}...${encRef(head)}`);
            box.innerHTML = `<div class="gh-item-meta">متقدم بـ <b>${+cmp.ahead_by}</b> • متأخر بـ <b>${+cmp.behind_by}</b> ${+cmp.behind_by === 0 ? '— <span class="text-emerald">محدّث، لا حاجة لـ Rebase</span>' : ''}</div>
                ${(cmp.commits || []).map((c, i) => `<div class="gh-check-row"><span class="ghx-reorder-n">${i + 1}</span><code dir="ltr">${esc(shortSha(c.sha))}</code> ${esc(headline(c.commit.message))} ${(c.parents || []).length > 1 ? '<span class="gh-badge warn">دمج</span>' : ''}</div>`).join('')}`;
            return cmp;
        } catch (e) { box.innerHTML = `<span class="text-red">❌ ${esc(e.message)}</span>`; }
    };

    P.ghxRebase = async function (baseArg) {
        const base = baseArg || val('ghx-rebase-base'), head = this.ghxHistBranch();
        if (!base || !this.ghRequireToken()) return;
        if (!(await this.ghxConfirm('Rebase', `إعادة تطبيق commits <b dir="ltr">${esc(head)}</b> فوق <b dir="ltr">${esc(base)}</b> ثم force push؟`, { danger: true }))) return;
        const box = document.getElementById('ghx-rebase-preview');
        const res = await this.ghxRunGitOp('جاري الـ Rebase', (ops) => ops.rebase(head, base, { onStep: (i, n, sha) => { if (box) box.innerHTML = `<span class="live-step-spinner"></span> تطبيق ${i + 1}/${n} <code dir="ltr">${esc(shortSha(sha))}</code>`; } }));
        if (!res) { if (box) box.innerHTML = ''; return; }
        this.showToast(res.upToDate ? 'ℹ️ الفرع محدّث مسبقاً' : `✅ تم الـ Rebase: ${res.applied.length} commit فوق ${base}`, res.upToDate ? 'info' : 'success');
        this._ghxReorder = null;
        if (this.ghTab === 'history') this.ghxReload();
        return res;
    };

    P.ghxSquashLast = async function (nArg) {
        const n = parseInt(nArg || val('ghx-squash-n'), 10);
        const branch = this.ghxHistBranch();
        if (!(n >= 2) || !this.ghRequireToken()) { if (!(n >= 2)) this.showToast('اختر 2 أو أكثر', 'warning'); return; }
        const ops = gitOps(this);
        let chain;
        try { chain = (await ops.firstParentChain(branch, null, n + 1)).slice(-n); } catch (e) { this.showToast('❌ ' + e.message, 'error'); return; }
        if (chain.length < n || chain.some(c => (c.parents || []).length !== 1)) { this.showToast('لا يمكن الدمج: commits غير كافية أو تتضمن دمجاً', 'warning'); return; }
        const msg = await this.showDialog({
            title: `🗜️ Squash آخر ${n} commits`,
            fields: [{ id: 'msg', type: 'textarea', label: 'رسالة الـ commit الموحّد', rows: 6, dir: 'auto', value: chain.slice().reverse().map(c => '- ' + headline(c.commit.message)).join('\n') }],
            buttons: [{ label: 'دمج (force push)', value: 'ok', primary: true }, { label: 'إلغاء', value: null }]
        });
        if (!msg) return;
        const res = await this.ghxRunGitOp('جاري الدمج', async () => {
            const head = chain[chain.length - 1];
            const c = await ops.createCommit({ message: msg.values.msg.trim() || 'squash', tree: head.commit.tree.sha, parents: [chain[0].parents[0].sha] });
            await ops.setRef(branch, c.sha, true);
            return c;
        });
        if (!res) return;
        this.showToast(`✅ دُمجت ${n} commits في ${shortSha(res.sha)}`, 'success');
        this._ghxReorder = null;
        this.ghxReload();
        return res;
    };

    // ------------------------------------------------------------------ TAGS (#455 #456)
    P.ghxTags = async function () {
        const rp = this.ghRepoPath();
        const [tags, branches] = await Promise.all([this.gh(`${rp}/tags?per_page=100`), this.ghxBranches().catch(() => [this.ghRepo().branch])]);
        const form = card('وسم جديد', `<div class="gh-row">${input('ghx-tag-name', { placeholder: 'v1.2.0', style: 'max-width:160px' })}<label>على</label>${select('ghx-tag-target', branches, this.ghxHistBranch(), { style: 'width:auto' })}
                ${input('ghx-tag-sha', { placeholder: 'أو SHA محدد (اختياري)', style: 'max-width:200px' })}</div>
            <div class="gh-row"><label class="gh-check"><input type="checkbox" id="ghx-tag-annotated"> وسم موصوف (Annotated)</label>${input('ghx-tag-msg', { placeholder: 'رسالة الوسم', dir: 'auto', style: 'flex:1' })}${btn('إنشاء', 'app.ghxCreateTag()', { icon: 'fa-tag', primary: true })}</div>`, { icon: 'fa-plus' });
        return form + (tags.length ? `<div class="gh-list">${tags.map(t => `<div class="gh-item static" data-tag="${esc(t.name)}"><i class="fa-solid fa-tag text-emerald"></i><div class="gh-item-main"><div class="gh-item-title" dir="ltr" style="text-align:right">${esc(t.name)}</div>
                <div class="gh-item-meta"><code dir="ltr">${esc(shortSha(t.commit && t.commit.sha))}</code></div></div>
                <div class="gh-item-actions">${btn('', call(this, 'ghxCommitView', t.commit && t.commit.sha), { icon: 'fa-eye', title: 'الـ commit' })}
                    <a class="sidebar-btn-util gh-btn" href="${esc(t.zipball_url || '#')}" target="_blank" rel="noopener" title="ZIP"><i class="fa-solid fa-file-zipper"></i></a>
                    ${btn('', call(this, 'ghxDeleteTag', t.name), { icon: 'fa-trash', danger: true, title: 'حذف' })}</div></div>`).join('')}</div>` : empty('لا توجد وسوم بعد.'));
    };

    P.ghxCreateTag = async function (opts) {
        if (!this.ghRequireToken()) return;
        const o = opts || { name: val('ghx-tag-name'), target: val('ghx-tag-target'), sha: val('ghx-tag-sha'), annotated: val('ghx-tag-annotated'), message: val('ghx-tag-msg') };
        if (!isValidRefName(o.name)) { this.showToast('اسم وسم غير صالح', 'warning'); return; }
        const rp = this.ghRepoPath();
        try {
            const sha = o.sha || (await gitOps(this).headOf(o.target || this.ghRepo().branch));
            let refSha = sha;
            if (o.annotated) {
                const tag = await this.gh(`${rp}/git/tags`, { method: 'POST', body: { tag: o.name, message: o.message || o.name, object: sha, type: 'commit' } });
                refSha = tag.sha;
            }
            await this.gh(`${rp}/git/refs`, { method: 'POST', body: { ref: `refs/tags/${o.name}`, sha: refSha } });
            this.showToast(`✅ تم إنشاء الوسم ${o.name}`, 'success');
            if (this.ghTab === 'history' && !this.ghView) this.ghxReload();
            return refSha;
        } catch (e) { this.showToast(e.status === 422 ? '❌ الوسم موجود مسبقاً' : '❌ ' + e.message, 'error'); return null; }
    };

    P.ghxDeleteTag = async function (name) {
        if (!this.ghRequireToken()) return;
        if (!(await this.ghxConfirm('حذف وسم', `حذف الوسم <b dir="ltr">${esc(name)}</b> من GitHub؟`, { danger: true }))) return;
        try {
            await this.gh(`${this.ghRepoPath()}/git/refs/tags/${encRef(name)}`, { method: 'DELETE' });
            this.showToast(`تم حذف ${name}`, 'success');
            if (this.ghTab === 'history' && !this.ghView) this.ghxReload();
            return true;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };
}
