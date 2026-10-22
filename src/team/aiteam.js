/* AI as a team member: task distribution (#794, #934), meeting summaries + minutes (#795, #796),
   delay alerts + prediction (#798, #937), suggested solutions (#799, #938), team coach (#800). */
import { esc, call, btn, pbtn, card, empty, field, area, select, val, setHTML, lsGet, lsSet, uid, stats, table, bar, ago, fmtDate, DAY, iso, avg, median, extOf, groupBy } from './util.js';

// ------------------------------------------------------------------ PURE: task distribution
const KW = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{N}+#.]+/u).filter(w => w.length > 1);
const PRIO = { high: 3, med: 2, low: 1 };
const TOPIC = { frontend: ['ui', 'css', 'html', 'react', 'vue', 'واجهة', 'تصميم', 'زر', 'صفحة', 'frontend', 'jsx', 'tsx'], backend: ['api', 'server', 'db', 'sql', 'خادم', 'قاعدة', 'backend', 'endpoint', 'node', 'auth'], devops: ['ci', 'deploy', 'docker', 'نشر', 'workflow', 'actions', 'build'], testing: ['test', 'اختبار', 'bug', 'خطأ', 'fix', 'إصلاح', 'qa'], docs: ['docs', 'readme', 'توثيق', 'شرح', 'doc'], python: ['python', 'py', 'pandas', 'data', 'بيانات'] };
export function taskTopics(title) {
    const w = KW(title);
    return Object.entries(TOPIC).filter(([, keys]) => keys.some(k => w.includes(k))).map(([t]) => t);
}
/** Greedy skill/load balanced assignment. members: [{login, skills:[], load}] → [{taskId, title, login, score, reason}] */
export function assignTasks(tasks, members, { maxLoad = 5 } = {}) {
    if (!members.length) return [];
    const load = Object.fromEntries(members.map(m => [m.login, m.load || 0]));
    const ms = members.map(m => ({ ...m, kw: new Set((m.skills || []).flatMap(s => KW(s)).concat(m.skills || []).map(s => String(s).toLowerCase())) }));
    return tasks.slice().sort((a, b) => (PRIO[b.priority] || 2) - (PRIO[a.priority] || 2) || (a.deadline || Infinity) - (b.deadline || Infinity)).map(t => {
        const tw = KW(t.title + ' ' + (t.notes || '')), topics = taskTopics(t.title + ' ' + (t.notes || ''));
        let best = null;
        for (const m of ms) {
            const skillHits = tw.filter(w => m.kw.has(w)).length + topics.filter(tp => m.kw.has(tp)).length * 2;
            const score = skillHits * 10 - load[m.login] * 4 - (load[m.login] >= maxLoad ? 50 : 0);
            if (!best || score > best.score) best = { m, score, skillHits };
        }
        load[best.m.login]++;
        const reason = best.skillHits ? `يطابق مهاراته (${[...best.m.kw].filter(k => tw.includes(k) || topics.includes(k)).slice(0, 3).join('، ')})` : 'الأقل حملاً حالياً';
        return { taskId: t.id || t.number, title: t.title, login: best.m.login, score: best.score, reason, topics };
    });
}
/** Skills inferred from what each member touched: {login: [paths]} → {login: ['frontend', 'js', …]} */
export function inferSkills(filesByLogin) {
    const out = {};
    for (const [login, paths] of Object.entries(filesByLogin)) {
        const s = new Set();
        for (const p of paths) {
            const e = extOf(p); if (e) s.add(e);
            if (/\.(css|scss|html|jsx|tsx|vue|svelte)$/.test(p) || /(^|\/)(components|pages|ui|styles)\//.test(p)) s.add('frontend');
            if (/(^|\/)(api|server|routes|db|models)\//.test(p) || /\.(sql|go|rb|php)$/.test(p)) s.add('backend');
            if (/\.github\/workflows|Dockerfile|docker-compose/.test(p)) s.add('devops');
            if (/\.(test|spec)\.|(^|\/)tests?\//.test(p)) s.add('testing');
            if (/\.md$/.test(p)) s.add('docs');
            if (/\.py$/.test(p)) s.add('python');
        }
        out[login] = [...s];
    }
    return out;
}

// ------------------------------------------------------------------ PURE: delays
/** Risk 0..1 that a task misses its deadline, using estimate, time spent, status and the team's median cycle time. */
export function predictDelay(task, now = Date.now(), { cycleDays = 3 } = {}) {
    if (task.status === 'done') return { risk: 0, level: 'done', reason: 'منجزة' };
    if (!task.deadline) {
        const age = (now - (task.created || now)) / DAY;
        return age > cycleDays * 3 ? { risk: 0.5, level: 'stale', reason: `مفتوحة منذ ${Math.round(age)} يوم بلا موعد` } : { risk: 0.1, level: 'low', reason: 'بلا موعد' };
    }
    const left = (task.deadline - now) / DAY;
    if (left < 0) return { risk: 1, level: 'overdue', reason: `متأخرة ${Math.ceil(-left)} يوم`, daysLeft: left };
    const est = (task.estimate || 0) / 60 / 6; // minutes → working days (6h/day)
    const spent = (task.spent || 0) / 36e5 / 6;
    const need = est ? Math.max(0, est - spent) : task.status === 'doing' ? cycleDays / 2 : cycleDays;
    const ratio = need / Math.max(0.05, left);
    const risk = Math.min(0.99, Math.round((task.status === 'todo' && left < 1 ? 0.3 : 0) * 100 + ratio * 70) / 100);
    const level = risk >= 0.7 ? 'high' : risk >= 0.4 ? 'medium' : 'low';
    return { risk, level, reason: `متبقٍ ${left < 1 ? Math.round(left * 24) + ' ساعة' : Math.round(left) + ' يوم'} ويلزم ≈${Math.round(need * 10) / 10} يوم عمل`, daysLeft: left };
}
export function delayAlerts(tasks, now = Date.now(), opts = {}) {
    return tasks.map(t => ({ t, p: predictDelay(t, now, opts) })).filter(x => ['overdue', 'high', 'stale'].includes(x.p.level))
        .map(({ t, p }) => ({ key: `d:${t.id || t.number}:${p.level}:${dayOfNow(now)}`, id: t.id || t.number, title: t.title, level: p.level, risk: p.risk, reason: p.reason, assignee: t.assignee || null, url: t.url || null }))
        .sort((a, b) => b.risk - a.risk);
}
const dayOfNow = (now) => new Date(now).toISOString().slice(0, 10);
/** Project ETA from throughput: open items / done-per-day. */
export function forecast(openCount, doneTimes, now = Date.now(), windowDays = 14) {
    const recent = doneTimes.filter(t => t >= now - windowDays * DAY).length;
    const perDay = recent / windowDays;
    if (!openCount) return { perDay, days: 0, eta: now };
    if (!perDay) return { perDay: 0, days: null, eta: null };
    const days = Math.ceil(openCount / perDay);
    return { perDay: Math.round(perDay * 100) / 100, days, eta: now + days * DAY };
}

// ------------------------------------------------------------------ PURE: meetings
const ACTION_RE = /(سوف|سأ|سنقوم|سيقوم|يجب|لازم|مطلوب|المهمة|todo|action|will|should|need to|assign|@[\w-]+)/i;
const DECISION_RE = /(قررنا|اتفقنا|القرار|تقرر|تم الاتفاق|decided|agreed|decision|we'll go with|approved)/i;
const QUESTION_RE = /(\?|؟)\s*$/;
/** Extractive meeting summary without AI: decisions, action items (with @owner and dates), open questions, speakers. */
export function extractMinutes(text) {
    const lines = String(text || '').split(/\n+/).map(l => l.trim()).filter(Boolean);
    const speakers = {};
    const decisions = [], actions = [], questions = [];
    for (const raw of lines) {
        const m = /^\[?([^\]:]{1,30})\]?\s*[:：]\s*(.+)$/.exec(raw);
        const who = m ? m[1].trim() : null, body = m ? m[2] : raw;
        if (who) speakers[who] = (speakers[who] || 0) + 1;
        if (DECISION_RE.test(body)) decisions.push(body);
        else if (ACTION_RE.test(body)) { const owner = (/@([\w-]+)/.exec(body) || [])[1] || who; const due = (/(\d{4}-\d{2}-\d{2})|(غداً|غدا|الأسبوع القادم|اليوم|tomorrow|next week|friday|الجمعة|الاثنين)/i.exec(body) || [])[0] || ''; actions.push({ text: body, owner: owner || '', due }); }
        else if (QUESTION_RE.test(body)) questions.push(body);
    }
    const words = lines.join(' ').split(/\s+/).length;
    return { decisions, actions, questions, speakers, lines: lines.length, words, minutes: Math.max(1, Math.round(words / 130)) };
}
export function minutesMarkdown({ title, date, attendees = [], summary = '', decisions = [], actions = [], questions = [] }) {
    return `# محضر اجتماع: ${title || 'اجتماع الفريق'}\n\n**التاريخ:** ${date || new Date().toLocaleDateString('ar')}  \n**الحضور:** ${attendees.length ? attendees.join('، ') : '—'}\n\n## الملخص\n${summary || '—'}\n\n## القرارات\n${decisions.length ? decisions.map(d => `- ✅ ${d}`).join('\n') : '- —'}\n\n## المهام المطلوبة\n| المهمة | المسؤول | الموعد |\n|---|---|---|\n${actions.length ? actions.map(a => `| ${String(a.text).replace(/\|/g, '\\|')} | ${a.owner ? '@' + String(a.owner).replace(/^@/, '') : '—'} | ${a.due || '—'} |`).join('\n') : '| — | — | — |'}\n\n## أسئلة مفتوحة\n${questions.length ? questions.map(q => `- ❓ ${q}`).join('\n') : '- —'}\n`;
}

// ------------------------------------------------------------------ PURE: solutions + coach
const tok = (s) => new Set(KW(s).filter(w => w.length > 2));
export function similarIssues(issue, pool, limit = 3) {
    const a = tok(issue.title + ' ' + (issue.body || '').slice(0, 500));
    return pool.filter(p => p.number !== issue.number).map(p => { const b = tok(p.title + ' ' + (p.body || '').slice(0, 500)); const inter = [...a].filter(x => b.has(x)).length; return { issue: p, score: inter / Math.max(1, new Set([...a, ...b]).size) }; })
        .filter(x => x.score >= 0.12).sort((x, y) => y.score - x.score).slice(0, limit);
}
/** Bus factor: smallest number of authors covering ≥50% of commits. */
export function busFactor(commitsByAuthor) {
    const arr = Object.values(commitsByAuthor).sort((a, b) => b - a), total = arr.reduce((a, b) => a + b, 0);
    let n = 0, sum = 0; for (const c of arr) { if (sum >= total / 2) break; sum += c; n++; }
    return total ? n : 0;
}
export function coachInsights({ stats = {}, pulls = [], now = Date.now() } = {}) {
    const out = [];
    const commits = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.commits || 0]));
    const total = Object.values(commits).reduce((a, b) => a + b, 0);
    const bf = busFactor(commits);
    if (total && bf <= 1 && Object.keys(commits).length > 1) { const top = Object.entries(commits).sort((a, b) => b[1] - a[1])[0]; out.push({ level: 'warn', icon: '🚌', title: 'عامل الحافلة = 1', text: `@${top[0]} كتب ${Math.round(top[1] / total * 100)}% من الكود — وزّع المعرفة بالمراجعات والبرمجة الثنائية.` }); }
    const merged = pulls.filter(p => p.merged_at);
    const cycle = merged.map(p => (new Date(p.merged_at) - new Date(p.created_at)) / 36e5);
    if (cycle.length) { const md = median(cycle); out.push({ level: md > 72 ? 'warn' : 'ok', icon: '⏱️', title: `متوسط دمج PR: ${Math.round(md)} ساعة`, text: md > 72 ? 'الـ PRs تنتظر طويلاً — حدّد هدف مراجعة خلال 24 ساعة.' : 'سرعة دمج ممتازة 👏' }); }
    const stale = pulls.filter(p => p.state === 'open' && now - new Date(p.updated_at || p.created_at).getTime() > 5 * DAY);
    if (stale.length) out.push({ level: 'warn', icon: '🕸️', title: `${stale.length} PR راكد`, text: stale.slice(0, 3).map(p => `#${p.number} ${p.title}`).join(' • ') });
    const big = pulls.filter(p => (p.additions || 0) + (p.deletions || 0) > 600);
    if (big.length) out.push({ level: 'info', icon: '📦', title: `${big.length} PR كبير (>600 سطر)`, text: 'الـ PRs الصغيرة تُراجع أسرع وبأخطاء أقل — قسّمها.' });
    const reviewers = Object.entries(stats).filter(([, v]) => v.reviews > 0).length, authors = Object.entries(stats).filter(([, v]) => v.prs > 0).length;
    if (authors && reviewers < Math.max(2, authors / 2)) out.push({ level: 'warn', icon: '🔍', title: 'المراجعات محصورة', text: `${reviewers} مراجع فقط لـ ${authors} مؤلف — أشرك المزيد في المراجعة.` });
    const silent = Object.entries(stats).filter(([, v]) => !v.commits && !v.prs && !v.reviews && !v.comments).map(([k]) => k);
    if (silent.length) out.push({ level: 'info', icon: '🤝', title: 'أعضاء بلا نشاط', text: `${silent.map(s => '@' + s).join('، ')} — تواصل معهم، ربما يحتاجون مساعدة.` });
    if (!out.length) out.push({ level: 'ok', icon: '🌟', title: 'الفريق بصحة جيدة', text: 'لا ملاحظات — استمروا!' });
    return out;
}

export function installAITeam(P) {
    // ------------------------------------------------------------------ data sources
    /** Unified work items: GitHub open issues (if connected) or local tasks. */
    P.tmWorkItems = async function () {
        if (this.tmHasGH()) {
            const issues = await this.tmList(`${this.ghRepoPath()}/issues?state=open`, { max: 200 }).catch(() => null);
            if (issues) return issues.filter(i => !i.pull_request && !(i.labels || []).some(l => /^ox-(channel|poll|survey|proposal|contest)$/.test(l.name))).map(i => ({ id: i.number, number: i.number, title: i.title, notes: (i.body || '').slice(0, 300), status: (i.labels || []).some(l => /progress|doing/i.test(l.name)) ? 'doing' : 'todo', priority: (i.labels || []).some(l => /high|urgent|critical|p0|p1/i.test(l.name)) ? 'high' : 'med', deadline: i.milestone && i.milestone.due_on ? new Date(i.milestone.due_on).getTime() : null, created: new Date(i.created_at).getTime(), assignee: i.assignee ? i.assignee.login : null, url: i.html_url, gh: true }));
        }
        return (this.tasks || []).filter(t => t.status !== 'done').map(t => ({ ...t, spent: this.taskSpent ? this.taskSpent(t) : t.spent }));
    };
    P.tmTeamMembers = async function () {
        const t = this.tmTeam();
        let members = ((t && t.members) || []).filter(m => m.role !== 'viewer').map(m => ({ login: m.login, skills: m.skills || [] }));
        if (!members.length) members = [{ login: this.tmMeSync(), skills: (this.skillMap ? this.skillMap() : []).map(s => s.name) }];
        if (this.tmHasGH() && members.length > 1) {
            const commits = await this.tmList(`${this.ghRepoPath()}/commits?since=${encodeURIComponent(iso(Date.now() - 60 * DAY))}`, { max: 60 }).catch(() => []);
            const files = {};
            for (const c of commits.slice(0, 25)) { const login = c.author && c.author.login; if (!login) continue; const d = await this.tmGH(`/commits/${c.sha}`).catch(() => null); (files[login] = files[login] || []).push(...((d && d.files) || []).map(f => f.filename)); }
            const inferred = inferSkills(files);
            members = members.map(m => ({ ...m, skills: [...new Set([...(m.skills || []), ...(inferred[m.login] || [])])] }));
        }
        return members;
    };

    // ------------------------------------------------------------------ ASSIGN (#794, #934)
    P.tmAssign = async function () {
        const items = await this.tmWorkItems();
        const members = await this.tmTeamMembers();
        const load = groupBy(items.filter(i => i.assignee), i => i.assignee);
        const unassigned = items.filter(i => !i.assignee);
        const plan = assignTasks(unassigned, members.map(m => ({ ...m, load: (load[m.login] || []).length })));
        this._tmPlan = plan;
        return card('اقتراح توزيع المهام', `${stats([['مهام بلا مسؤول', unassigned.length], ['أعضاء', members.length], ['موزعة', items.length - unassigned.length]])}
            ${plan.length ? table(['', 'المهمة', 'المقترح', 'السبب'], plan.map((p, i) => [`<input type="checkbox" class="tm-plan-chk" data-i="${i}" checked>`, esc(p.title), select(`tm-plan-${i}`, '', members.map(m => [m.login, '@' + m.login]), p.login), esc(p.reason)])) : empty('كل المهام لها مسؤول 👍')}
            <div class="gh-row">${plan.length ? pbtn('fa-user-check', 'طبّق التوزيع', call('tmApplyPlan')) : ''}${btn('fa-robot', 'توزيع بالذكاء', call('tmAIAssign'))}</div><div id="tm-assign-ai"></div>`, 'fa-people-arrows')
            + card('حمل العمل الحالي', members.map(m => `<div class="gh-item"><span>@${esc(m.login)} ${(m.skills || []).slice(0, 5).map(s => `<span class="fmx-tag">${esc(s)}</span>`).join('')}</span>${bar((load[m.login] || []).length, Math.max(5, ...Object.values(load).map(x => x.length)), '', (load[m.login] || []).length > 5 ? '#ef4444' : '')}<b>${(load[m.login] || []).length}</b></div>`).join(''), 'fa-weight-scale');
    };
    P.tmAIAssign = async function () {
        const items = (await this.tmWorkItems()).filter(i => !i.assignee).slice(0, 25);
        const members = await this.tmTeamMembers();
        if (!items.length) return null;
        this.tmBusy('tm-assign-ai', 'OX-AI يوزع المهام…');
        const r = await this.tmAI(`Assign each task to the best team member balancing skills and load. Members: ${JSON.stringify(members)}. Tasks: ${JSON.stringify(items.map(i => ({ id: i.id, title: i.title, priority: i.priority })))}. Return JSON {"assignments": [{"id": task id, "login": "member", "reason": "short Arabic reason"}]}`, { json: true });
        if (!r || !Array.isArray(r.assignments)) { setHTML('tm-assign-ai', empty('لم يصل رد', true)); return null; }
        const known = new Set(members.map(m => m.login));
        this._tmPlan = r.assignments.filter(a => known.has(a.login)).map(a => { const it = items.find(i => String(i.id) === String(a.id)); return it ? { taskId: it.id, title: it.title, login: a.login, reason: '🤖 ' + (a.reason || '') } : null; }).filter(Boolean);
        setHTML('tm-assign-ai', table(['المهمة', 'المقترح', 'السبب'], this._tmPlan.map(p => [esc(p.title), '@' + esc(p.login), esc(p.reason)])) + pbtn('fa-user-check', 'طبّق توزيع الذكاء', call('tmApplyPlan', true)));
        return this._tmPlan;
    };
    P.tmApplyPlan = async function (all = false) {
        const plan = this._tmPlan || [];
        const rows = plan.map((p, i) => { const chk = document.querySelector(`.tm-plan-chk[data-i="${i}"]`); const sel = document.getElementById(`tm-plan-${i}`); return all || !chk ? p : chk.checked ? { ...p, login: (sel && sel.value) || p.login } : null; }).filter(Boolean);
        let n = 0;
        for (const p of rows) {
            if (this.tmHasGH() && typeof p.taskId === 'number') { const ok = await this.tmGH(`/issues/${p.taskId}/assignees`, { method: 'POST', body: { assignees: [p.login] } }).catch(() => null); if (ok) n++; }
            else if (this.updateTask && this.updateTask(p.taskId, { assignee: p.login })) n++;
        }
        this.showToast(`👥 وُزعت ${n} مهمة`, n ? 'success' : 'warning');
        this.tmRefresh();
        return n;
    };

    // ------------------------------------------------------------------ MEETINGS (#795, #796)
    const MEET_KEY = 'ox_team_meetings_v1';
    P.tmMeetings = function () { return lsGet(MEET_KEY, []); };
    P.tmMeeting = async function () {
        const list = this.tmMeetings();
        const chans = await this.tmChannelList().catch(() => []);
        return card('لخّص اجتماعاً واكتب محضره', `${field('tm-meet-title', 'عنوان الاجتماع', '', 'placeholder="اجتماع التخطيط الأسبوعي"')}
            ${area('tm-meet-text', 'النص / التفريغ (مثال: «أحمد: سأنهي صفحة الدخول غداً»)', '', 8)}
            <div class="gh-row">${chans.length ? select('tm-meet-chan', 'أو من قناة (آخر 24 ساعة)', [['', '—'], ...chans.map(c => [String(c.id), '# ' + c.name])], '') + btn('fa-download', 'جلب الرسائل', call('tmMeetFromChannel')) : ''}<label class="fmx-field"><span>أو ملف تفريغ</span><input type="file" class="form-input-box" accept=".txt,.vtt,.srt,.md" onchange="app.tmMeetFile(this)"></label></div>
            <div class="gh-row">${pbtn('fa-robot', 'لخّص واكتب المحضر', call('tmSummarizeMeeting'))}${btn('fa-list-check', 'استخراج سريع بلا ذكاء', call('tmSummarizeMeeting', { offline: true }))}</div><div id="tm-meet-out"></div>`, 'fa-people-group')
            + card('المحاضر السابقة', list.length ? list.slice(0, 20).map(m => `<div class="gh-item"><span>📝 ${esc(m.title)} <small>${fmtDate(m.t)} • ${m.actions.length} مهمة</small></span><span>${btn('fa-eye', '', call('tmShowMinutes', m.id))}${btn('fa-file-export', '', call('tmSaveMinutes', m.id))}</span></div>`).join('') : empty('لا محاضر بعد'), 'fa-folder-open');
    };
    P.tmMeetFile = async function (input) { const f = input && input.files && input.files[0]; if (!f) return; const t = (await f.text()).replace(/^WEBVTT.*$/m, '').replace(/^\d+\s*$/gm, '').replace(/^[\d:.,]+ --> [\d:.,]+.*$/gm, '').replace(/\n{2,}/g, '\n'); const el = document.getElementById('tm-meet-text'); if (el) el.value = t.trim(); return t; };
    P.tmMeetFromChannel = async function (id = val('tm-meet-chan')) {
        if (!id) return '';
        const msgs = await this.tmMessages(id).catch(() => []);
        const since = Date.now() - DAY;
        const text = msgs.filter(m => (m.t || 0) >= since).map(m => `${m.user}: ${String(m.body || m.text || '').replace(/<!--[\s\S]*?-->/g, '').trim()}`).join('\n');
        const el = document.getElementById('tm-meet-text'); if (el) el.value = text;
        return text;
    };
    P.tmSummarizeMeeting = async function (opts = {}) {
        const text = opts.text != null ? opts.text : val('tm-meet-text');
        const title = opts.title || val('tm-meet-title') || 'اجتماع الفريق';
        if (!String(text).trim()) { this.showToast('أدخل نص الاجتماع', 'warning'); return null; }
        const ex = extractMinutes(text);
        let data = { title, date: new Date().toLocaleDateString('ar'), attendees: Object.keys(ex.speakers), summary: '', decisions: ex.decisions, actions: ex.actions, questions: ex.questions };
        if (!opts.offline) {
            this.tmBusy('tm-meet-out', 'OX-AI يلخص الاجتماع…');
            const r = await this.tmAI(`Summarize this meeting transcript. Return JSON {"summary": "Arabic paragraph", "decisions": ["…"], "actions": [{"text": "…", "owner": "name or empty", "due": "date or empty"}], "questions": ["…"], "attendees": ["…"]}.\n\n${String(text).slice(0, 14000)}`, { json: true, quiet: true });
            if (r && r.summary) data = { ...data, summary: r.summary, decisions: r.decisions || data.decisions, actions: (r.actions || []).map(a => (typeof a === 'string' ? { text: a, owner: '', due: '' } : a)), questions: r.questions || data.questions, attendees: r.attendees && r.attendees.length ? r.attendees : data.attendees };
        }
        if (!data.summary) data.summary = `اجتماع من ${ex.lines} مداخلة (~${ex.minutes} دقيقة) بمشاركة ${data.attendees.length || 'غير محدد'} — ${data.decisions.length} قرار و${data.actions.length} مهمة.`;
        const m = { id: uid('meet'), t: Date.now(), ...data, md: minutesMarkdown(data) };
        lsSet(MEET_KEY, [m, ...this.tmMeetings()].slice(0, 100));
        this._tmLastMeeting = m;
        setHTML('tm-meet-out', this.tmMinutesHTML(m));
        return m;
    };
    P.tmMinutesHTML = function (m) {
        return `<div class="tmx-ai-out">${this.renderMarkdownSafe ? this.renderMarkdownSafe(m.md) : `<pre>${esc(m.md)}</pre>`}</div><div class="gh-row">${btn('fa-copy', 'نسخ', call('tmCopyMinutes', m.id))}${btn('fa-file-export', 'حفظ في المشروع', call('tmSaveMinutes', m.id))}${m.actions.length ? btn('fa-list-check', `حوّل ${m.actions.length} مهمة`, call('tmMinutesToTasks', m.id)) : ''}${btn('fa-hashtag', 'انشر في قناة', call('tmPostMinutes', m.id))}</div>`;
    };
    P.tmShowMinutes = function (id) { const m = this.tmMeetings().find(x => x.id === id); if (!m) return null; return this.showDialog({ title: '📝 ' + m.title, body: this.tmMinutesHTML(m), buttons: [{ label: 'إغلاق', value: null }] }); };
    P.tmCopyMinutes = function (id) { const m = this.tmMeetings().find(x => x.id === id); if (m) this.copyToClipboard(m.md); return !!m; };
    P.tmSaveMinutes = function (id) { const m = this.tmMeetings().find(x => x.id === id); if (!m) return null; const path = `docs/meetings/${new Date(m.t).toISOString().slice(0, 10)}-${m.id.slice(-4)}.md`; this.writeProjectFile(path, m.md, 'team'); if (this.renderStudioExplorer) this.renderStudioExplorer(); this.showToast(`📄 ${this.escapeHTML(path)}`, 'success'); return path; };
    P.tmMinutesToTasks = function (id) { const m = this.tmMeetings().find(x => x.id === id); if (!m) return 0; m.actions.forEach(a => this.addTask(`${a.text}`, { notes: `من محضر: ${m.title}`, assignee: a.owner ? String(a.owner).replace(/^@/, '') : undefined })); if (this.renderTasks) this.renderTasks(); this.showToast(`✅ أُضيفت ${m.actions.length} مهمة`, 'success'); return m.actions.length; };
    P.tmPostMinutes = async function (id) { const m = this.tmMeetings().find(x => x.id === id); const ch = await this.tmChannelList().catch(() => []); if (!m || !ch[0]) { this.showToast('لا توجد قناة', 'warning'); return false; } await this.tmSend(ch[0].id, m.md, { silent: true }); this.showToast('📣 نُشر المحضر', 'success'); return true; };

    // ------------------------------------------------------------------ DELAYS (#798, #937)
    P.tmCycleDays = function () { const d = (this.tasks || []).filter(t => t.done && t.created).map(t => (t.done - t.created) / DAY); return d.length ? Math.max(0.5, median(d)) : 3; };
    P.tmDelayAlerts = async function ({ now = Date.now(), quiet = false } = {}) {
        const items = await this.tmWorkItems().catch(() => this.tasks || []);
        const al = delayAlerts(items, now, { cycleDays: this.tmCycleDays() });
        if (quiet) al.filter(a => a.level !== 'stale').slice(0, 5).forEach(a => this.tmInboxPush({ key: a.key, kind: 'delay', title: `${a.level === 'overdue' ? '⏰ متأخرة' : '⚠️ معرضة للتأخر'}: ${a.title}`, body: a.reason, url: a.url }));
        return al;
    };
    P.tmAlerts = async function () {
        const items = await this.tmWorkItems();
        const cyc = this.tmCycleDays();
        const rows = items.map(t => ({ t, p: predictDelay(t, Date.now(), { cycleDays: cyc }) })).sort((a, b) => b.p.risk - a.p.risk);
        const fc = forecast(items.length, (this.tasks || []).filter(t => t.done).map(t => t.done));
        const col = { overdue: '#ef4444', high: '#f97316', medium: '#f59e0b', stale: '#a855f7', low: '#22c55e' };
        const lbl = { overdue: 'متأخرة', high: 'خطر مرتفع', medium: 'متوسط', stale: 'راكدة', low: 'منخفض' };
        return card('توقع التأخر', `${stats([['متأخرة', rows.filter(r => r.p.level === 'overdue').length], ['خطر مرتفع', rows.filter(r => r.p.level === 'high').length], ['زمن الإنجاز المعتاد', Math.round(cyc * 10) / 10 + ' يوم'], ['الإنجاز المتوقع للكل', fc.eta ? fmtDate(fc.eta) : '—']])}
            ${rows.length ? table(['المهمة', 'المسؤول', 'الخطر', '', 'السبب'], rows.slice(0, 40).map(({ t, p }) => [t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.title)}</a>` : esc(t.title), t.assignee ? '@' + esc(t.assignee) : '—', `<span style="color:${col[p.level]}">${lbl[p.level] || p.level}</span>`, bar(Math.round(p.risk * 100), 100, '', col[p.level]), esc(p.reason)])) : empty('لا مهام مفتوحة 🎉')}
            <div class="gh-row">${btn('fa-bell', 'أرسل التنبيهات الآن', call('tmSendDelayAlerts'))}${btn('fa-robot', 'خطة إنقاذ بالذكاء', call('tmAIRescue'))}</div><div id="tm-alerts-ai"></div>
            <div class="tmx-note">التنبيهات تصل تلقائياً للإشعارات عند تفعيل المراقبة (تبويب المحادثة ← الإشعارات). الإنتاجية الحالية: ${fc.perDay} مهمة/يوم.</div>`, 'fa-hourglass-half');
    };
    P.tmSendDelayAlerts = async function () { const al = await this.tmDelayAlerts({ quiet: true }); this.showToast(al.length ? `🔔 ${al.length} تنبيه` : 'لا تأخير 👍', al.length ? 'warning' : 'success'); return al; };
    P.tmAIRescue = async function () {
        const al = await this.tmDelayAlerts();
        if (!al.length) { setHTML('tm-alerts-ai', empty('لا مهام متأخرة 👍')); return null; }
        this.tmBusy('tm-alerts-ai', '…');
        const out = await this.tmAI(`These tasks are late or at risk: ${JSON.stringify(al.slice(0, 12).map(a => ({ title: a.title, reason: a.reason, assignee: a.assignee })))}. Give an Arabic rescue plan: what to cut, re-scope, re-assign or parallelize, in priority order.`, { maxTokens: 1500 });
        setHTML('tm-alerts-ai', out ? `<div class="tmx-ai-out">${this.renderMarkdownSafe ? this.renderMarkdownSafe(out) : esc(out)}</div>` : empty('لم يصل رد', true));
        return out;
    };

    // ------------------------------------------------------------------ SOLUTIONS (#799, #938)
    P.tmSolutions = async function () {
        const items = await this.tmWorkItems();
        const blocked = items.filter(i => /blocked|متوقف|عالق|bug|خطأ/i.test(i.title + ' ' + (i.notes || ''))).concat(items).filter((x, i, a) => a.indexOf(x) === i).slice(0, 15);
        let closed = [];
        if (this.tmHasGH()) closed = await this.tmList(`${this.ghRepoPath()}/issues?state=closed`, { max: 200 }).catch(() => []);
        const sims = blocked.map(b => ({ b, s: similarIssues({ number: b.number, title: b.title, body: b.notes }, closed.filter(c => !c.pull_request)) }));
        return card('حلول مقترحة للمشاكل المفتوحة', blocked.length ? sims.map(({ b, s }) => `<div class="tmx-sol"><div class="gh-item"><b>${esc(b.title)}</b>${btn('fa-robot', 'اقترح حلاً', call('tmSuggestSolution', b.id))}</div>${s.length ? `<small>🔁 مشاكل مشابهة حُلّت سابقاً: ${s.map(x => `<a href="${esc(x.issue.html_url)}" target="_blank" rel="noopener">#${x.issue.number} ${esc(x.issue.title)}</a>`).join(' • ')}</small>` : ''}<div id="tm-sol-${esc(String(b.id))}"></div></div>`).join('') : empty('لا مشاكل مفتوحة 🎉'), 'fa-lightbulb')
            + card('اسأل عن مشكلة', `${area('tm-sol-q', 'صف المشكلة أو الصق الخطأ', '', 4)}${pbtn('fa-wand-magic-sparkles', 'اقترح حلولاً', call('tmSuggestSolution', null))}<div id="tm-sol-null"></div>`, 'fa-circle-question');
    };
    P.tmSuggestSolution = async function (id, text) {
        const items = await this.tmWorkItems();
        const it = id != null ? items.find(i => String(i.id) === String(id)) : null;
        const q = text || (it ? `${it.title}\n${it.notes || ''}` : val('tm-sol-q'));
        if (!String(q).trim()) return null;
        const target = `tm-sol-${id == null ? 'null' : id}`;
        this.tmBusy(target, 'OX-AI يفكر…');
        if ((!this.aiProjectContext || this.aiProjectContext.__oxLazy) && this.loadChunk) await this.loadChunk('ai').catch(() => null);
        let ctx = ''; try { ctx = this.aiProjectContext ? this.aiProjectContext({ maxChars: 6000 }) : ''; } catch (e) { ctx = ''; }
        const out = await this.tmAI(`Problem: ${q}\n\nProject context:\n${String(ctx).slice(0, 6000)}\n\nPropose 2-3 alternative solutions (Arabic), with pros/cons and concrete code changes for the recommended one.`, { kind: 'coding', maxTokens: 2500 });
        setHTML(target, out ? `<div class="tmx-ai-out">${this.renderMarkdownSafe ? this.renderMarkdownSafe(out) : esc(out)}</div>${it && it.gh ? btn('fa-comment', 'انشره كتعليق على الـ Issue', call('tmPostSolution', it.number)) : ''}` : empty('لم يصل رد', true));
        this._tmLastSolution = out;
        return out;
    };
    P.tmPostSolution = async function (num) { if (!this._tmLastSolution) return null; return this.tmGH(`/issues/${num}/comments`, { method: 'POST', body: { body: `🤖 **اقتراح OX-AI:**\n\n${this._tmLastSolution}` } }).then(r => { this.showToast('💬 نُشر', 'success'); return r; }).catch(e => this.tmErr(e)); };

    // ------------------------------------------------------------------ COACH (#800)
    P.tmCoach = async function () {
        const s = await this.tmMemberStats(30).catch(() => ({}));
        const pulls = this.tmHasGH() ? await this.tmList(`${this.ghRepoPath()}/pulls?state=all&sort=updated&direction=desc`, { max: 60 }).catch(() => []) : [];
        const ins = coachInsights({ stats: s, pulls });
        this._tmCoachData = { stats: s, insights: ins };
        return card('مدرب الفريق', ins.map(i => `<div class="tmx-insight ${i.level}"><span>${i.icon}</span><div><b>${esc(i.title)}</b><div>${esc(i.text)}</div></div></div>`).join('')
            + `<div class="gh-row">${pbtn('fa-chalkboard-user', 'جلسة تدريب بالذكاء', call('tmAICoach'))}${btn('fa-hashtag', 'انشر نصيحة الأسبوع في القناة', call('tmCoachTip'))}</div><div id="tm-coach-ai"></div>`, 'fa-chalkboard-user')
            + card('اسأل المدرب', `${area('tm-coach-q', 'سؤالك عن العمل الجماعي أو الممارسات', '', 3, 'placeholder="كيف نقلل التعارضات في الدمج؟"')}${btn('fa-paper-plane', 'اسأل', call('tmAskCoach'))}<div id="tm-coach-ans"></div>`, 'fa-comments');
    };
    P.tmAICoach = async function () {
        const d = this._tmCoachData || { stats: {}, insights: [] };
        this.tmBusy('tm-coach-ai', 'المدرب يحلل الفريق…');
        const out = await this.tmAI(`You are an engineering team coach. Team stats (30 days): ${JSON.stringify(d.stats)}. Observations: ${JSON.stringify(d.insights.map(i => i.title + ': ' + i.text))}. Give (Arabic) a coaching session: 3 strengths, 3 improvements with concrete practices, and a personal tip per member.`, { maxTokens: 2000 });
        setHTML('tm-coach-ai', out ? `<div class="tmx-ai-out">${this.renderMarkdownSafe ? this.renderMarkdownSafe(out) : esc(out)}</div>` : empty('لم يصل رد', true));
        return out;
    };
    P.tmAskCoach = async function (q = val('tm-coach-q')) {
        if (!q) return null;
        this.tmBusy('tm-coach-ans', '…');
        const out = await this.tmAI(q, { system: 'You are OX-AI, an experienced engineering manager and team coach. Answer in Arabic with practical, actionable advice for software teams.', maxTokens: 1500 });
        setHTML('tm-coach-ans', out ? `<div class="tmx-ai-out">${this.renderMarkdownSafe ? this.renderMarkdownSafe(out) : esc(out)}</div>` : empty('لم يصل رد', true));
        return out;
    };
    P.tmCoachTip = async function () {
        const d = this._tmCoachData || { insights: coachInsights({}) };
        const top = d.insights.find(i => i.level === 'warn') || d.insights[0];
        const ch = await this.tmChannelList().catch(() => []);
        if (!ch[0]) { this.showToast('لا توجد قناة', 'warning'); return null; }
        const text = `🎓 **نصيحة الأسبوع من المدرب**\n\n${top.icon} ${top.title}\n${top.text}`;
        await this.tmSend(ch[0].id, text, { silent: true });
        this.showToast('📣 نُشرت', 'success');
        return text;
    };
}
