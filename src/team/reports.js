/* Team reports: team report (#931), member comparison (#932), collaboration analysis (#933), project progress (#935),
   risk analysis (#936), client report (#939), client invoice (#940). */
import { esc, call, btn, pbtn, card, empty, field, area, select, val, setHTML, lsGet, lsSet, uid, stats, table, mdTable, bar, ago, fmtDate, DAY, iso, avg, hours, pct, win } from './util.js';
import { leaderboard, SCORE } from './engage.js';
import { busFactor, coachInsights, forecast, predictDelay } from './aiteam.js';
import { projectMetrics, securityScan, scanScore, bugStats } from './analyze.js';

// ------------------------------------------------------------------ PURE: collaboration (#933)
/** pairs [{from, to}] (author→reviewer, commenter→author, co-editors) → graph stats. */
export function collabGraph(pairs, members = []) {
    const nodes = new Set(members), edges = {};
    for (const { from, to } of pairs) {
        if (!from || !to || from === to) continue;
        nodes.add(from); nodes.add(to);
        const k = [from, to].sort().join('\u0000');
        edges[k] = (edges[k] || 0) + 1;
    }
    const list = Object.entries(edges).map(([k, n]) => { const [a, b] = k.split('\u0000'); return { a, b, n }; }).sort((x, y) => y.n - x.n);
    const ns = [...nodes];
    const degree = Object.fromEntries(ns.map(n => [n, list.filter(e => e.a === n || e.b === n).reduce((s, e) => s + e.n, 0)]));
    const possible = ns.length * (ns.length - 1) / 2;
    return { nodes: ns, edges: list, degree, density: possible ? Math.round(list.length / possible * 100) : 0, isolated: ns.filter(n => !degree[n]), hub: ns.slice().sort((a, b) => degree[b] - degree[a])[0] || null };
}
export function collabSVG(g, size = 360) {
    const c = size / 2, r = size / 2 - 50, N = g.nodes.length || 1;
    const pos = Object.fromEntries(g.nodes.map((n, i) => [n, [c + r * Math.cos(2 * Math.PI * i / N - Math.PI / 2), c + r * Math.sin(2 * Math.PI * i / N - Math.PI / 2)]]));
    const max = Math.max(1, ...g.edges.map(e => e.n)), maxD = Math.max(1, ...Object.values(g.degree));
    const e = (s) => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" class="tmx-graph">${g.edges.map(x => `<line x1="${pos[x.a][0].toFixed(1)}" y1="${pos[x.a][1].toFixed(1)}" x2="${pos[x.b][0].toFixed(1)}" y2="${pos[x.b][1].toFixed(1)}" stroke="#7c3aed" stroke-opacity="${(0.25 + 0.75 * x.n / max).toFixed(2)}" stroke-width="${(1 + 5 * x.n / max).toFixed(1)}"><title>${e(x.a)} ⟷ ${e(x.b)}: ${x.n}</title></line>`).join('')}${g.nodes.map(n => `<g><circle cx="${pos[n][0].toFixed(1)}" cy="${pos[n][1].toFixed(1)}" r="${(8 + 12 * (g.degree[n] || 0) / maxD).toFixed(1)}" fill="${g.degree[n] ? '#0ea5e9' : '#64748b'}"/><text x="${pos[n][0].toFixed(1)}" y="${(pos[n][1] + 30).toFixed(1)}" text-anchor="middle" font-size="11" fill="currentColor">@${e(n)}</text></g>`).join('')}</svg>`;
}
// ------------------------------------------------------------------ PURE: progress (#935)
/** items [{created, closed}] (ms) → remaining open at the end of each of the last `days` days. */
export function burndown(items, days = 14, now = Date.now()) {
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
        const end = now - i * DAY;
        out.push({ day: new Date(end).toISOString().slice(0, 10), remaining: items.filter(x => x.created <= end && (!x.closed || x.closed > end)).length, done: items.filter(x => x.closed && x.closed <= end).length });
    }
    return out;
}
export function progressSummary(items, milestones = [], now = Date.now()) {
    const done = items.filter(x => x.closed).length;
    const fc = forecast(items.length - done, items.filter(x => x.closed).map(x => x.closed), now);
    const ms = milestones.map(m => { const tot = (m.open || 0) + (m.closed || 0); const due = m.due ? new Date(m.due).getTime() : null; const p = pct(m.closed || 0, tot); const late = due && due < now && p < 100; const atRisk = due && !late && fc.perDay && (m.open / fc.perDay) * DAY > due - now; return { ...m, total: tot, pct: p, late, atRisk }; });
    return { total: items.length, done, open: items.length - done, pct: pct(done, items.length), forecast: fc, milestones: ms };
}
// ------------------------------------------------------------------ PURE: risks (#936)
export function riskAssessment(s = {}) {
    const r = [];
    const add = (id, title, prob, impact, why, mitigation) => r.push({ id, title, prob, impact, score: prob * impact, level: prob * impact >= 15 ? 'high' : prob * impact >= 8 ? 'medium' : 'low', why, mitigation });
    if (s.overdue) add('schedule', 'تأخر الجدول الزمني', Math.min(5, 2 + s.overdue), 4, `${s.overdue} مهمة متأخرة`, 'أعد ترتيب الأولويات، قلّص النطاق، أو أضف موارد للمهام الحرجة.');
    if (s.highRisk) add('deadline', 'مهام معرضة لتفويت الموعد', Math.min(5, 1 + s.highRisk), 3, `${s.highRisk} مهمة بخطر مرتفع`, 'قسّم المهام وابدأ بالأكثر خطراً هذا الأسبوع.');
    if (s.busFactor === 1 && s.members > 1) add('bus', 'الاعتماد على شخص واحد', 4, 5, 'عامل الحافلة = 1', 'مراجعات متبادلة، توثيق، وبرمجة ثنائية لنقل المعرفة.');
    if (s.testRatio != null && s.testRatio < 10) add('quality', 'جودة منخفضة / نقص الاختبارات', s.testRatio < 3 ? 4 : 3, 4, `نسبة ملفات الاختبار ${s.testRatio}%`, 'اشترط اختبارات للكود الجديد وأضف CI يشغلها.');
    if (s.secScore != null && s.secScore < 80) add('security', 'ثغرات أمنية محتملة', s.secScore < 50 ? 4 : 3, 5, `درجة الأمان ${s.secScore}/100`, 'عالج الملاحظات المرتفعة أولاً وأخرج الأسرار من الكود.');
    if (s.bugTrend > 0) add('bugs', 'تزايد الأخطاء', Math.min(5, 2 + s.bugTrend), 3, `الأخطاء المفتوحة تزيد (+${s.bugTrend} آخر أسبوعين)`, 'خصص وقتاً ثابتاً لإصلاح الأخطاء قبل الميزات الجديدة.');
    if (s.stalePRs) add('flow', 'تعطل تدفق العمل', Math.min(5, 1 + s.stalePRs), 2, `${s.stalePRs} PR راكد`, 'حدد SLA للمراجعة وأغلق الـ PRs المهجورة.');
    if (s.deps > 60) add('deps', 'كثرة الاعتماديات', 3, 3, `${s.deps} اعتمادية`, 'راجع الاعتماديات غير المستخدمة وفعّل Dependabot.');
    if (s.velocityDrop > 30) add('velocity', 'تراجع الإنتاجية', 3, 3, `انخفاض ${s.velocityDrop}% عن الأسبوع السابق`, 'اسأل الفريق عن العوائق في الاجتماع القادم.');
    if (s.todos > 50) add('debt', 'دين تقني', 3, 2, `${s.todos} TODO/FIXME`, 'خصص 10-20% من كل سبرنت لسداد الدين التقني.');
    return r.sort((a, b) => b.score - a.score);
}
// ------------------------------------------------------------------ PURE: invoice (#940)
export function invoiceTotals(lines, { tax = 0, discount = 0 } = {}) {
    const round = (n) => Math.round(n * 100) / 100;
    const items = lines.map(l => ({ ...l, qty: +l.qty || 0, rate: +l.rate || 0, amount: round((+l.qty || 0) * (+l.rate || 0)) }));
    const subtotal = round(items.reduce((n, l) => n + l.amount, 0));
    const disc = round(Math.min(subtotal, +discount || 0));
    const taxAmt = round((subtotal - disc) * (+tax || 0) / 100);
    return { items, subtotal, discount: disc, tax: taxAmt, total: round(subtotal - disc + taxAmt) };
}
export function invoiceHTML(inv) {
    const e = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const t = invoiceTotals(inv.lines, inv);
    const money = (n) => `${Number(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${e(inv.currency || 'USD')}`;
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>فاتورة ${e(inv.number)}</title><style>body{font-family:system-ui,Tahoma,sans-serif;color:#0f172a;margin:40px;max-width:820px}h1{margin:0;color:#4c1d95}.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #7c3aed;padding-bottom:16px;margin-bottom:24px}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{padding:10px;border-bottom:1px solid #e2e8f0;text-align:right}th{background:#f5f3ff}.num{text-align:left;direction:ltr}.tot td{border:0}.grand td{font-size:1.2em;font-weight:700;border-top:2px solid #7c3aed}.muted{color:#64748b;font-size:.9em}@media print{body{margin:0}}</style></head><body>
<div class="top"><div><h1>فاتورة</h1><div class="muted">رقم: <b>${e(inv.number)}</b><br>التاريخ: ${e(inv.date)}<br>الاستحقاق: ${e(inv.due || '—')}</div></div><div><b>${e(inv.from || '')}</b><div class="muted">${e(inv.fromInfo || '').replace(/\n/g, '<br>')}</div></div></div>
<div><div class="muted">إلى</div><b>${e(inv.client || '')}</b><div class="muted">${e(inv.clientInfo || '').replace(/\n/g, '<br>')}</div></div>
<table><thead><tr><th>الوصف</th><th class="num">الكمية/ساعات</th><th class="num">السعر</th><th class="num">المبلغ</th></tr></thead><tbody>${t.items.map(l => `<tr><td>${e(l.desc)}</td><td class="num">${l.qty}</td><td class="num">${money(l.rate)}</td><td class="num">${money(l.amount)}</td></tr>`).join('')}</tbody>
<tbody class="tot"><tr><td colspan="3">المجموع الفرعي</td><td class="num">${money(t.subtotal)}</td></tr>${t.discount ? `<tr><td colspan="3">خصم</td><td class="num">−${money(t.discount)}</td></tr>` : ''}${inv.tax ? `<tr><td colspan="3">ضريبة ${e(inv.tax)}%</td><td class="num">${money(t.tax)}</td></tr>` : ''}<tr class="grand"><td colspan="3">الإجمالي</td><td class="num">${money(t.total)}</td></tr></tbody></table>
${inv.notes ? `<p class="muted">${e(inv.notes).replace(/\n/g, '<br>')}</p>` : ''}<p class="muted">أُنشئت بواسطة OX-Alpha Workbench Pro</p></body></html>`;
}
export function nextInvoiceNumber(list, now = Date.now()) {
    const y = new Date(now).getFullYear();
    const n = list.filter(i => String(i.number).startsWith(`INV-${y}-`)).map(i => +String(i.number).split('-')[2] || 0);
    return `INV-${y}-${String((n.length ? Math.max(...n) : 0) + 1).padStart(4, '0')}`;
}

export function installReports(P) {
    // ------------------------------------------------------------------ shared data
    P.tmReportData = async function (days = 30, now = Date.now()) {
        const t = this.tmTeam();
        const statsBy = await this.tmMemberStats(days, now).catch(() => ({}));
        let pulls = [], issues = [], milestones = [];
        if (this.tmHasGH()) {
            [pulls, issues, milestones] = await Promise.all([
                this.tmList(`${this.ghRepoPath()}/pulls?state=all&sort=updated&direction=desc`, { max: 100 }).catch(() => []),
                this.tmList(`${this.ghRepoPath()}/issues?state=all&since=${encodeURIComponent(iso(now - Math.max(days, 60) * DAY))}`, { max: 300 }).catch(() => []),
                this.tmGH('/milestones?state=all&per_page=30').catch(() => [])
            ]);
            issues = issues.filter(i => !i.pull_request && !(i.labels || []).some(l => /^ox-/.test(l.name)));
        }
        const items = issues.length ? issues.map(i => ({ title: i.title, created: new Date(i.created_at).getTime(), closed: i.closed_at ? new Date(i.closed_at).getTime() : null, assignee: i.assignee && i.assignee.login, url: i.html_url, labels: (i.labels || []).map(l => l.name) }))
            : (this.tasks || []).map(x => ({ title: x.title, created: x.created, closed: x.status === 'done' ? x.done || x.created : null, assignee: x.assignee || null, deadline: x.deadline, status: x.status, estimate: x.estimate, spent: this.taskSpent ? this.taskSpent(x, now) : x.spent, id: x.id }));
        const ms = (milestones || []).map(m => ({ title: m.title, open: m.open_issues, closed: m.closed_issues, due: m.due_on, url: m.html_url, state: m.state }));
        return { team: t, days, now, stats: statsBy, board: leaderboard(statsBy), pulls, issues, items, milestones: ms };
    };
    P.tmRiskSignals = async function (d) {
        d = d || await this.tmReportData();
        const open = (this.tasks || []).filter(t => t.status !== 'done');
        const preds = open.map(t => predictDelay({ ...t, spent: this.taskSpent ? this.taskSpent(t) : t.spent }));
        const m = projectMetrics(this.virtualProjectFiles);
        const bugs = d.issues.length ? bugStats(d.issues.filter(i => (i.labels || []).some(l => /bug/i.test(l.name)))) : { trend: 0 };
        const thisWeek = d.items.filter(x => x.closed && x.closed >= d.now - 7 * DAY).length, lastWeek = d.items.filter(x => x.closed && x.closed >= d.now - 14 * DAY && x.closed < d.now - 7 * DAY).length;
        return {
            overdue: preds.filter(p => p.level === 'overdue').length + d.milestones.filter(x => x.due && new Date(x.due).getTime() < d.now && x.open > 0 && x.state === 'open').length,
            highRisk: preds.filter(p => p.level === 'high').length,
            busFactor: busFactor(Object.fromEntries(Object.entries(d.stats).map(([k, v]) => [k, v.commits]))), members: Object.keys(d.stats).length,
            testRatio: m.files ? m.testRatio : null, secScore: m.files ? scanScore(securityScan(this.virtualProjectFiles)) : null, bugTrend: bugs.trend || 0,
            stalePRs: d.pulls.filter(p => p.state === 'open' && d.now - new Date(p.updated_at || p.created_at).getTime() > 7 * DAY).length,
            deps: m.deps, todos: m.todos, velocityDrop: lastWeek ? Math.max(0, Math.round((lastWeek - thisWeek) / lastWeek * 100)) : 0
        };
    };
    const periodChips = (app, cur) => `<div class="gh-row">${[7, 14, 30, 90].map(d => `<button class="gh-chip ${d === cur ? 'active' : ''}" onclick="app._tmRepDays=${d};app.tmRefresh()">${d} يوم</button>`).join('')}</div>`;
    const saveMd = (app, name, md) => { const path = `reports/${name}-${new Date().toISOString().slice(0, 10)}.md`; app.writeProjectFile(path, md, 'team'); if (app.renderStudioExplorer) app.renderStudioExplorer(); app.showToast(`📄 ${app.escapeHTML(path)}`, 'success'); return path; };

    // ------------------------------------------------------------------ TEAM REPORT (#931)
    P.tmTeamReportMarkdown = function (d) {
        const tot = d.board.reduce((a, r) => ({ commits: a.commits + r.commits, prs: a.prs + r.prs, reviews: a.reviews + r.reviews, issues: a.issues + r.issues }), { commits: 0, prs: 0, reviews: 0, issues: 0 });
        const merged = d.pulls.filter(p => p.merged_at && new Date(p.merged_at).getTime() >= d.now - d.days * DAY);
        const closed = d.items.filter(x => x.closed && x.closed >= d.now - d.days * DAY);
        const ins = coachInsights({ stats: d.stats, pulls: d.pulls, now: d.now });
        return `# تقرير الفريق — ${d.team ? d.team.name : this.tmRepoKey()}\n\nالفترة: آخر ${d.days} يوماً (حتى ${fmtDate(d.now)})\n\n## الأرقام\n- Commits: **${tot.commits}**\n- PRs: **${tot.prs}** (مدموجة: ${merged.length})\n- مراجعات: **${tot.reviews}**\n- مهام/Issues منجزة: **${closed.length}**\n\n## الأعضاء\n${mdTable(['#', 'العضو', 'Commits', 'PRs', 'مراجعات', 'Issues', 'النقاط'], d.board.map(r => [r.medal || r.rank, '@' + r.login, r.commits, r.prs, r.reviews, r.issues, r.score]))}\n\n## أبرز ما أُنجز\n${closed.slice(0, 15).map(x => `- ✅ ${x.title}`).join('\n') || '- —'}\n${merged.slice(0, 10).map(p => `- 🔀 #${p.number} ${p.title}`).join('\n')}\n\n## ملاحظات المدرب\n${ins.map(i => `- ${i.icon} **${i.title}** — ${i.text}`).join('\n')}\n`;
    };
    P.tmTeamReport = async function () {
        const days = this._tmRepDays || 30;
        const d = await this.tmReportData(days);
        const md = this.tmTeamReportMarkdown(d);
        this._tmLastReport = { name: 'team-report', md };
        const max = Math.max(1, ...d.board.map(r => r.score));
        return card('تقرير الفريق', `${periodChips(this, days)}${stats([['أعضاء نشطون', d.board.filter(r => r.score).length], ['Commits', d.board.reduce((n, r) => n + r.commits, 0)], ['PRs', d.board.reduce((n, r) => n + r.prs, 0)], ['منجزة', d.items.filter(x => x.closed && x.closed >= d.now - days * DAY).length]])}
            ${d.board.length ? d.board.map(r => `<div class="gh-item"><span>${r.medal || r.rank} @${esc(r.login)}</span>${bar(r.score, max)}<b>${r.score}</b></div>`).join('') : empty(this.tmHasGH() ? 'لا نشاط في هذه الفترة' : 'أضف رمز GitHub لتقرير فريق كامل — يُعرض الآن نشاطك المحلي فقط')}
            <div class="gh-row">${pbtn('fa-file-export', 'حفظ Markdown', call('tmSaveLastReport'))}${btn('fa-copy', 'نسخ', call('tmCopyLastReport'))}${btn('fa-hashtag', 'نشر في القناة', call('tmPostLastReport'))}${btn('fa-robot', 'ملخص تنفيذي بالذكاء', call('tmAIReportSummary'))}</div><div id="tm-rep-ai"></div>`, 'fa-file-lines');
    };
    P.tmSaveLastReport = function () { const r = this._tmLastReport; return r ? saveMd(this, r.name, r.md) : null; };
    P.tmCopyLastReport = function () { const r = this._tmLastReport; if (r) this.copyToClipboard(r.md); return !!r; };
    P.tmPostLastReport = async function () { const r = this._tmLastReport; const ch = await this.tmChannelList().catch(() => []); if (!r || !ch[0]) { this.showToast('لا توجد قناة', 'warning'); return false; } await this.tmSend(ch[0].id, r.md, { silent: true }); this.showToast('📣 نُشر التقرير', 'success'); return true; };
    P.tmAIReportSummary = async function () {
        const r = this._tmLastReport; if (!r) return null;
        this.tmBusy('tm-rep-ai', '…');
        const out = await this.tmAI(`Write a short executive summary (Arabic, 5 bullet points max) of this team report, highlighting wins, concerns and next steps:\n\n${r.md.slice(0, 8000)}`, { maxTokens: 900 });
        setHTML('tm-rep-ai', out ? `<div class="tmx-ai-out">${this.renderMarkdownSafe ? this.renderMarkdownSafe(out) : esc(out)}</div>` : empty('لم يصل رد', true));
        return out;
    };

    // ------------------------------------------------------------------ MEMBER COMPARISON (#932)
    P.tmMemberCompare = async function () {
        const days = this._tmRepDays || 30;
        const d = await this.tmReportData(days);
        const keys = [['commits', 'Commits'], ['prs', 'PRs'], ['reviews', 'مراجعات'], ['issues', 'Issues'], ['comments', 'تعليقات'], ['rewards', 'مكافآت']];
        const max = Object.fromEntries(keys.map(([k]) => [k, Math.max(1, ...d.board.map(r => r[k] || 0))]));
        const sel = this._tmCmpMembers || d.board.slice(0, 2).map(r => r.login);
        const chosen = d.board.filter(r => sel.includes(r.login));
        const colors = ['#7c3aed', '#0ea5e9', '#22c55e', '#f59e0b', '#ef4444'];
        return card('مقارنة أعضاء الفريق', `${periodChips(this, days)}<div class="gh-row">${d.board.map(r => `<label class="gh-chip"><input type="checkbox" ${sel.includes(r.login) ? 'checked' : ''} onchange="${call('tmToggleCmpMember', r.login)}"> @${esc(r.login)}</label>`).join('')}</div>
            ${chosen.length ? keys.map(([k, l]) => `<div class="tmx-cmp-row"><b>${l}</b>${chosen.map((r, i) => `<div class="gh-item"><small>@${esc(r.login)}</small>${bar(r[k] || 0, max[k], '', colors[i % colors.length])}<span>${r[k] || 0}</span></div>`).join('')}</div>`).join('') : empty('اختر أعضاء للمقارنة')}
            ${d.board.length ? table(['العضو', ...keys.map(k => k[1]), 'النقاط', 'متوسط الفريق ±'], d.board.map(r => { const a = avg(d.board.map(x => x.score)); return ['@' + esc(r.login), ...keys.map(([k]) => r[k] || 0), r.score, `${r.score >= a ? '+' : ''}${a ? Math.round((r.score - a) / a * 100) : 0}%`]; })) : ''}
            <div class="tmx-note">⚖️ الأرقام تقيس النشاط وليس القيمة — استخدمها لتوزيع العمل والدعم، لا للحكم على الأشخاص. النقاط: commit ×${SCORE.commits}، PR ×${SCORE.prs}، مراجعة ×${SCORE.reviews}.</div>`, 'fa-users-viewfinder');
    };
    P.tmToggleCmpMember = function (login) { const s = new Set(this._tmCmpMembers || []); if (s.has(login)) s.delete(login); else s.add(login); this._tmCmpMembers = [...s]; return this.tmRefresh(); };

    // ------------------------------------------------------------------ COLLABORATION (#933)
    P.tmCollabPairs = async function (d) {
        const pairs = [];
        for (const p of d.pulls.slice(0, 25)) {
            const author = p.user && p.user.login;
            const rv = await this.tmGH(`/pulls/${p.number}/reviews?per_page=50`).catch(() => []) || [];
            rv.forEach(r => pairs.push({ from: r.user && r.user.login, to: author, kind: 'review' }));
            (p.requested_reviewers || []).forEach(r => pairs.push({ from: r.login, to: author, kind: 'request' }));
        }
        for (const i of d.issues.slice(0, 40)) if (i.assignee && i.user && i.assignee.login !== i.user.login) pairs.push({ from: i.user.login, to: i.assignee.login, kind: 'assign' });
        return pairs;
    };
    P.tmCollab = async function () {
        const d = await this.tmReportData(this._tmRepDays || 30);
        const members = ((d.team && d.team.members) || []).map(m => m.login);
        if (!this.tmHasGH()) return card('تحليل التعاون', empty('يتطلب رمز GitHub لتحليل المراجعات والإسناد بين الأعضاء'), 'fa-diagram-project');
        const pairs = await this.tmCollabPairs(d);
        const g = collabGraph(pairs, members);
        this._tmCollab = g;
        const kinds = pairs.reduce((m, p) => { m[p.kind] = (m[p.kind] || 0) + 1; return m; }, {});
        return card('شبكة التعاون', `${stats([['كثافة الشبكة', g.density + '%'], ['روابط', g.edges.length], ['المحور', g.hub ? '@' + esc(g.hub) : '—'], ['معزولون', g.isolated.length]])}
            <div class="tmx-graph-wrap">${g.nodes.length ? collabSVG(g) : empty('لا تفاعلات بعد')}</div>
            <div class="tmx-note">المصادر: مراجعات PR (${kinds.review || 0}) • طلبات مراجعة (${kinds.request || 0}) • إسناد Issues (${kinds.assign || 0}).</div>`, 'fa-diagram-project')
            + card('أقوى الثنائيات', g.edges.length ? table(['الثنائي', 'التفاعلات'], g.edges.slice(0, 10).map(e => [`@${esc(e.a)} ⟷ @${esc(e.b)}`, e.n])) : empty('—'), 'fa-handshake')
            + (g.isolated.length ? card('يحتاجون دمجاً أكبر', `${g.isolated.map(n => `<span class="fmx-tag">@${esc(n)}</span>`).join('')}<div class="tmx-note">💡 اطلب منهم مراجعة PRs زملائهم أو أسند لهم مهاماً مشتركة.</div>`, 'fa-user-plus') : '');
    };

    // ------------------------------------------------------------------ PROJECT PROGRESS (#935)
    P.tmProgress = async function () {
        const d = await this.tmReportData(Math.max(30, this._tmRepDays || 30));
        const sum = progressSummary(d.items, d.milestones, d.now);
        const bd = burndown(d.items, 21, d.now);
        const maxR = Math.max(1, ...bd.map(x => x.remaining));
        this._tmProgress = sum;
        return card('تقدم المشروع', `${stats([['الإنجاز', sum.pct + '%'], ['منجز', sum.done], ['متبقٍ', sum.open], ['الإنهاء المتوقع', sum.forecast.eta ? fmtDate(sum.forecast.eta) : sum.open ? '—' : '✅']])}${bar(sum.done, sum.total || 1, '', '#22c55e')}
            <b>Burndown — آخر 21 يوماً</b><div class="tmx-spark tmx-burn">${bd.map(x => `<span style="height:${Math.round(x.remaining / maxR * 100)}%" title="${x.day}: متبقٍ ${x.remaining}"></span>`).join('')}</div>
            <div class="tmx-note">الإنتاجية: ${sum.forecast.perDay} عنصر/يوم (آخر 14 يوماً). ${this.tmHasGH() ? 'المصدر: Issues على GitHub.' : 'المصدر: مهامك المحلية.'}</div>`, 'fa-bars-progress')
            + card('المعالم Milestones', sum.milestones.length ? sum.milestones.map(m => `<div class="tmx-ms"><div class="gh-item"><b>${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title)}</a>` : esc(m.title)}</b><small>${m.due ? fmtDate(m.due) : 'بلا موعد'} ${m.late ? '🔴 متأخر' : m.atRisk ? '🟠 معرض للتأخر' : m.pct === 100 ? '✅' : ''}</small></div>${bar(m.closed, m.total || 1, '', m.late ? '#ef4444' : m.atRisk ? '#f59e0b' : '#22c55e')}<small>${m.closed}/${m.total} • ${m.pct}%</small></div>`).join('') : empty(this.tmHasGH() ? 'لا معالم في المستودع' : 'المعالم تتطلب GitHub'), 'fa-flag-checkered');
    };

    // ------------------------------------------------------------------ RISKS (#936)
    P.tmRisks = async function () {
        const d = await this.tmReportData(30);
        const sig = await this.tmRiskSignals(d);
        const risks = riskAssessment(sig);
        this._tmRiskList = risks;
        const col = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };
        const grid = [5, 4, 3, 2, 1].map(imp => `<div class="tmx-mrow">${[1, 2, 3, 4, 5].map(pr => { const here = risks.filter(r => r.impact === imp && r.prob === pr); const sc = imp * pr; return `<span class="tmx-mcell" style="background:${sc >= 15 ? '#ef444433' : sc >= 8 ? '#f59e0b33' : '#22c55e22'}" title="احتمال ${pr} × أثر ${imp}">${here.map(r => `<i title="${esc(r.title)}">●</i>`).join('')}</span>`; }).join('')}</div>`).join('');
        return card('تحليل المخاطر', `${stats([['مرتفعة', risks.filter(r => r.level === 'high').length], ['متوسطة', risks.filter(r => r.level === 'medium').length], ['منخفضة', risks.filter(r => r.level === 'low').length]])}
            <div class="tmx-matrix"><small class="tmx-maxis">الأثر ↑ • الاحتمال →</small>${grid}</div>
            ${risks.length ? risks.map(r => `<div class="tmx-risk" style="border-inline-start-color:${col[r.level]}"><b>${esc(r.title)}</b> <small>احتمال ${r.prob}/5 × أثر ${r.impact}/5 = ${r.score}</small><div><small>السبب: ${esc(r.why)}</small></div><div>🛡️ ${esc(r.mitigation)}</div></div>`).join('') : empty('لا مخاطر ظاهرة 🎉')}
            <div class="gh-row">${btn('fa-file-export', 'سجل المخاطر Markdown', call('tmSaveRisks'))}${btn('fa-robot', 'تحليل أعمق بالذكاء', call('tmAIRisks'))}</div><div id="tm-risk-ai"></div>`, 'fa-triangle-exclamation');
    };
    P.tmSaveRisks = function () { const r = this._tmRiskList || []; return saveMd(this, 'risk-register', `# سجل المخاطر\n\n${mdTable(['المخاطرة', 'الاحتمال', 'الأثر', 'الدرجة', 'السبب', 'المعالجة'], r.map(x => [x.title, x.prob, x.impact, x.score, x.why, x.mitigation]))}\n`); };
    P.tmAIRisks = async function () {
        const r = this._tmRiskList || [];
        this.tmBusy('tm-risk-ai', '…');
        const out = await this.tmAI(`Project risk register: ${JSON.stringify(r)}. Add any likely risks we missed for a software project of this kind, and give an Arabic prioritized mitigation plan with owners (roles) and early warning signs.`, { maxTokens: 1500 });
        setHTML('tm-risk-ai', out ? `<div class="tmx-ai-out">${this.renderMarkdownSafe ? this.renderMarkdownSafe(out) : esc(out)}</div>` : empty('لم يصل رد', true));
        return out;
    };

    // ------------------------------------------------------------------ CLIENT REPORT (#939)
    P.tmClientReportMarkdown = function (d, sum, risks, opts = {}) {
        const done = d.items.filter(x => x.closed && x.closed >= d.now - d.days * DAY);
        const next = d.items.filter(x => !x.closed).slice(0, 8);
        return `# تقرير تقدم المشروع\n\n**المشروع:** ${opts.project || (d.team && d.team.name) || this.tmRepoKey()}  \n**العميل:** ${opts.client || '—'}  \n**الفترة:** ${fmtDate(d.now - d.days * DAY)} — ${fmtDate(d.now)}\n\n## الحالة العامة\n${sum.pct >= 0 ? `نسبة الإنجاز **${sum.pct}%** (${sum.done} من ${sum.total}).` : ''} ${sum.forecast.eta ? `الإنهاء المتوقع: **${fmtDate(sum.forecast.eta)}**.` : ''} ${risks.some(r => r.level === 'high') ? '🟠 توجد نقاط تحتاج انتباهاً (أدناه).' : '🟢 المشروع يسير حسب الخطة.'}\n\n## ما أُنجز في هذه الفترة\n${done.map(x => `- ✅ ${x.title}`).join('\n') || '- —'}\n\n## الخطوات القادمة\n${next.map(x => `- ⏭️ ${x.title}`).join('\n') || '- —'}\n\n${sum.milestones.length ? `## المعالم\n${sum.milestones.map(m => `- ${m.pct === 100 ? '✅' : m.late ? '🔴' : '🔵'} ${m.title} — ${m.pct}%${m.due ? ` (موعد ${fmtDate(m.due)})` : ''}`).join('\n')}\n\n` : ''}${risks.filter(r => r.level !== 'low').length ? `## نقاط الانتباه\n${risks.filter(r => r.level !== 'low').slice(0, 4).map(r => `- ${r.title}: ${r.mitigation}`).join('\n')}\n\n` : ''}${opts.notes ? `## ملاحظات\n${opts.notes}\n` : ''}`;
    };
    P.tmClientReport = async function () {
        const t = this.tmTeam();
        const days = this._tmRepDays || 14;
        const d = await this.tmReportData(days);
        const sum = progressSummary(d.items, d.milestones, d.now);
        const risks = riskAssessment(await this.tmRiskSignals(d));
        const client = (t && t.settings && t.settings.client) || '';
        const md = this.tmClientReportMarkdown(d, sum, risks, { client });
        this._tmLastReport = { name: 'client-report', md };
        return card('تقرير العميل', `${periodChips(this, days)}<div class="gh-row">${field('tm-cr-client', 'اسم العميل', client)}${btn('fa-arrows-rotate', 'تحديث', call('tmRebuildClientReport'))}</div>${area('tm-cr-notes', 'ملاحظات إضافية للعميل', '', 2)}
            <div class="tmx-ai-out" id="tm-cr-prev">${this.renderMarkdownSafe ? this.renderMarkdownSafe(md) : `<pre>${esc(md)}</pre>`}</div>
            <div class="gh-row">${pbtn('fa-print', 'طباعة / PDF', call('tmPrintClientReport'))}${btn('fa-file-export', 'حفظ Markdown', call('tmSaveLastReport'))}${btn('fa-copy', 'نسخ', call('tmCopyLastReport'))}${btn('fa-robot', 'صياغة احترافية بالذكاء', call('tmAIClientReport'))}</div>
            <div class="tmx-note">🔒 التقرير يخفي التفاصيل الداخلية (أسماء الأعضاء والنقاط والمراجعات) ويركز على التقدم والقيمة.</div>`, 'fa-user-tie');
    };
    P.tmRebuildClientReport = async function () {
        const d = await this.tmReportData(this._tmRepDays || 14);
        const md = this.tmClientReportMarkdown(d, progressSummary(d.items, d.milestones, d.now), riskAssessment(await this.tmRiskSignals(d)), { client: val('tm-cr-client'), notes: val('tm-cr-notes') });
        this._tmLastReport = { name: 'client-report', md };
        const t = this.tmTeam(); if (t && val('tm-cr-client') !== (t.settings || {}).client) { t.settings = { ...(t.settings || {}), client: val('tm-cr-client') }; this.tmSaveTeam(t, 'chore(team): client name', { push: false }); }
        setHTML('tm-cr-prev', this.renderMarkdownSafe ? this.renderMarkdownSafe(md) : `<pre>${esc(md)}</pre>`);
        return md;
    };
    P.tmAIClientReport = async function () {
        const r = this._tmLastReport; if (!r) return null;
        this.tmBusy('tm-cr-prev', 'OX-AI يعيد الصياغة…');
        const out = await this.tmAI(`Rewrite this project status report for a non-technical client: professional, positive but honest, Arabic, keep the Markdown structure, no internal jargon:\n\n${r.md}`, { maxTokens: 2000 });
        if (out) this._tmLastReport = { name: 'client-report', md: out };
        setHTML('tm-cr-prev', this.renderMarkdownSafe ? this.renderMarkdownSafe(this._tmLastReport.md) : `<pre>${esc(this._tmLastReport.md)}</pre>`);
        return out;
    };
    P.tmPrintClientReport = function () {
        const r = this._tmLastReport; if (!r) return null;
        const body = this.renderMarkdownSafe ? this.renderMarkdownSafe(r.md) : `<pre>${esc(r.md)}</pre>`;
        const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير المشروع</title><style>body{font-family:system-ui,Tahoma,sans-serif;max-width:800px;margin:40px auto;color:#0f172a;line-height:1.7}h1{color:#4c1d95;border-bottom:3px solid #7c3aed;padding-bottom:8px}h2{color:#5b21b6;margin-top:28px}</style></head><body>${body}</body></html>`;
        if (this.printHTML) this.printHTML(html); else this.downloadBlob(new (win().Blob)([html], { type: 'text/html' }), 'client-report.html');
        return html;
    };

    // ------------------------------------------------------------------ INVOICE (#940)
    const INV_KEY = 'ox_team_invoices_v1';
    P.tmInvoices = function () { return lsGet(INV_KEY, []); };
    /** Billable lines from tracked time on tasks done/worked in the period. */
    P.tmInvoiceLines = function (from, to = Date.now(), rate) {
        const t = this.tmTeam(); rate = rate != null ? rate : +((t && t.settings && t.settings.rate) || 25);
        return (this.tasks || []).map(x => ({ x, ms: this.taskSpent ? this.taskSpent(x, to) : x.spent || 0, when: x.done || x.lastWorked || x.created })).filter(r => r.ms > 0 && r.when >= from && r.when <= to)
            .map(r => ({ desc: r.x.title, qty: Math.max(0.25, Math.round(hours(r.ms) * 4) / 4), rate }));
    };
    P.tmInvoice = async function () {
        const t = this.tmTeam(); const s = (t && t.settings) || {};
        if (!this._tmInv) {
            const from = Date.now() - 30 * DAY;
            const lines = this.tmInvoiceLines(from);
            this._tmInv = { number: nextInvoiceNumber(this.tmInvoices()), date: new Date().toISOString().slice(0, 10), due: new Date(Date.now() + 14 * DAY).toISOString().slice(0, 10), client: s.client || '', clientInfo: '', from: (t && t.name) || '', fromInfo: '', currency: s.currency || 'USD', tax: +s.tax || 0, discount: 0, notes: 'شكراً لثقتكم.', lines: lines.length ? lines : [{ desc: 'تطوير', qty: 1, rate: +s.rate || 25 }] };
        }
        const inv = this._tmInv, tot = invoiceTotals(inv.lines, inv);
        const list = this.tmInvoices();
        const f = (k, label, attrs = '') => field(`tm-inv-${k}`, label, inv[k], `${attrs} onchange="app.tmInvSet('${k}',this.value)"`);
        return card(`فاتورة ${esc(inv.number)}`, `<div class="tmx-grid2">${f('client', 'العميل')}${f('from', 'من (اسمك/شركتك)')}${f('date', 'التاريخ', 'type="date"')}${f('due', 'الاستحقاق', 'type="date"')}${f('currency', 'العملة', 'dir="ltr"')}${f('tax', 'الضريبة %', 'type="number" min="0" step="0.5"')}${f('discount', 'خصم (مبلغ)', 'type="number" min="0"')}</div>
            <table class="fmx-table tmx-inv"><thead><tr><th>الوصف</th><th>ساعات/كمية</th><th>السعر</th><th>المبلغ</th><th></th></tr></thead><tbody>${tot.items.map((l, i) => `<tr><td><input class="form-input-box" value="${esc(l.desc)}" onchange="app.tmInvLine(${i},'desc',this.value)"></td><td><input class="form-input-box" type="number" step="0.25" min="0" value="${l.qty}" onchange="app.tmInvLine(${i},'qty',this.value)"></td><td><input class="form-input-box" type="number" step="0.5" min="0" value="${l.rate}" onchange="app.tmInvLine(${i},'rate',this.value)"></td><td dir="ltr">${l.amount.toFixed(2)}</td><td>${btn('fa-trash', '', call('tmInvDelLine', i))}</td></tr>`).join('')}</tbody></table>
            <div class="gh-row">${btn('fa-plus', 'سطر', call('tmInvAddLine'))}${btn('fa-clock', 'من الوقت المسجل (30 يوم)', call('tmInvFromTime', 30))}</div>
            ${stats([['المجموع الفرعي', tot.subtotal.toFixed(2)], ['الخصم', tot.discount.toFixed(2)], ['الضريبة', tot.tax.toFixed(2)], ['الإجمالي', `${tot.total.toFixed(2)} ${esc(inv.currency)}`]])}
            ${area('tm-inv-notes', 'ملاحظات', inv.notes, 2, `onchange="app.tmInvSet('notes',this.value)"`)}
            <div class="gh-row">${pbtn('fa-print', 'طباعة / PDF', call('tmPrintInvoice'))}${btn('fa-download', 'تحميل HTML', call('tmDownloadInvoice'))}${btn('fa-floppy-disk', 'حفظ في السجل', call('tmSaveInvoice'))}${btn('fa-file-circle-plus', 'فاتورة جديدة', call('tmNewInvoice'))}</div>`, 'fa-file-invoice-dollar')
            + card('الفواتير السابقة', list.length ? table(['الرقم', 'العميل', 'التاريخ', 'الإجمالي', 'الحالة', ''], list.map(x => [esc(x.number), esc(x.client), esc(x.date), `${invoiceTotals(x.lines, x).total.toFixed(2)} ${esc(x.currency)}`, x.paid ? '✅ مدفوعة' : '⏳', `${btn('fa-pen', '', call('tmOpenInvoice', x.number))}${x.paid ? '' : btn('fa-check', '', call('tmMarkPaid', x.number))}`])) : empty('لا فواتير'), 'fa-receipt');
    };
    P.tmInvSet = function (k, v) { if (!this._tmInv) return; this._tmInv[k] = ['tax', 'discount'].includes(k) ? +v || 0 : v; if (['tax', 'discount'].includes(k)) this.tmRefresh(); };
    P.tmInvLine = function (i, k, v) { const l = this._tmInv && this._tmInv.lines[i]; if (!l) return; l[k] = k === 'desc' ? v : +v || 0; if (k !== 'desc') this.tmRefresh(); };
    P.tmInvAddLine = function () { const s = ((this.tmTeam() || {}).settings) || {}; this._tmInv.lines.push({ desc: '', qty: 1, rate: +s.rate || 25 }); return this.tmRefresh(); };
    P.tmInvDelLine = function (i) { this._tmInv.lines.splice(i, 1); return this.tmRefresh(); };
    P.tmInvFromTime = function (days = 30) { const l = this.tmInvoiceLines(Date.now() - days * DAY); if (!l.length) { this.showToast('لا وقت مسجل على المهام في هذه الفترة — استخدم مؤقت المهام', 'info'); return 0; } this._tmInv.lines = l; this.tmRefresh(); return l.length; };
    P.tmPrintInvoice = function () { const html = invoiceHTML(this._tmInv); if (this.printHTML) this.printHTML(html); return html; };
    P.tmDownloadInvoice = function () { const html = invoiceHTML(this._tmInv); this.downloadBlob(new (win().Blob)([html], { type: 'text/html' }), `${this._tmInv.number}.html`); return html; };
    P.tmSaveInvoice = function () { const list = this.tmInvoices().filter(x => x.number !== this._tmInv.number); lsSet(INV_KEY, [{ ...this._tmInv, saved: Date.now() }, ...list]); this.showToast('🧾 حُفظت الفاتورة', 'success'); this.tmRefresh(); return this._tmInv.number; };
    P.tmNewInvoice = function () { this._tmInv = null; return this.tmRefresh(); };
    P.tmOpenInvoice = function (num) { const x = this.tmInvoices().find(i => i.number === num); if (x) { this._tmInv = JSON.parse(JSON.stringify(x)); this.tmRefresh(); } return !!x; };
    P.tmMarkPaid = function (num) { lsSet(INV_KEY, this.tmInvoices().map(i => (i.number === num ? { ...i, paid: Date.now() } : i))); return this.tmRefresh(); };
}
