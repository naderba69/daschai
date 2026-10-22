/* Analytics tab: commit chart (#462), contributors chart (#463), most modified files (#464),
   period comparison (#466), export (#467), share (#468), weekly report (#469), forecast (#470),
   traffic & clones (#458), dependency graph (#459), full insights (#530). */
import { esc, fmtNum, barsSVG, hbarsHTML, toCSV, mapLimit, sleep } from './shared.js';
import { card, btn, empty, note, select } from './core.js';
import { weeklyTotals, comparePeriods, forecast, contributorTotals, topFiles, weeklyReport, trafficSummary, sbomPackages, packageJsonDeps } from './stats.js';

/** Stats endpoints answer 202 while GitHub computes them → retry a few times. */
async function statsWithRetry(app, path, tries = 3) {
    for (let i = 0; i < tries; i++) {
        const r = await app.gh(path).catch((e) => { if (e.status === 404 || e.status === 403) return null; throw e; });
        if (Array.isArray(r) && r.length) return r;
        if (Array.isArray(r) && !r.length && i === tries - 1) return r;
        if (i < tries - 1) await sleep(app._ghxStatsDelay != null ? app._ghxStatsDelay : 1500);
    }
    return null;
}

export function installAnalytics(P) {
    P.ghxStatsData = async function (force = false) {
        const rp = this.ghRepoPath();
        if (!force && this._ghxStats && this._ghxStats.rp === rp && Date.now() - this._ghxStats.t < 120000) return this._ghxStats;
        const [activity, contributors, frequency, info] = await Promise.all([
            statsWithRetry(this, `${rp}/stats/commit_activity`),
            statsWithRetry(this, `${rp}/stats/contributors`),
            statsWithRetry(this, `${rp}/stats/code_frequency`).catch(() => null),
            this.ghRepoInfo()
        ]);
        this._ghxStats = { rp, t: Date.now(), activity, contributors, frequency, info, weeks: weeklyTotals(activity), people: contributorTotals(contributors) };
        return this._ghxStats;
    };

    // ------------------------------------------------------------------ ACTIVITY + COMPARE + FORECAST
    P.ghxActivity = async function () {
        const s = await this.ghxStatsData();
        if (!s.weeks.length) return note('⏳ GitHub يحسب إحصائيات هذا المستودع الآن (أول طلب). أعد المحاولة بعد لحظات.') + btn('إعادة المحاولة', "app._ghxStats=null; app.ghxReload()", { icon: 'fa-rotate' });
        const n = this._ghxCompareN || 4;
        const cmp = comparePeriods(s.weeks, n);
        const fc = forecast(s.weeks, 4);
        const labels = (s.activity || []).map(w => new Date(w.week * 1000).toLocaleDateString('ar', { day: 'numeric', month: 'short' }));
        const total = s.weeks.reduce((a, b) => a + b, 0);
        const days = [0, 0, 0, 0, 0, 0, 0];
        (s.activity || []).forEach(w => (w.days || []).forEach((c, i) => { days[i] += c; }));
        const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
        const freq = Array.isArray(s.frequency) ? s.frequency.slice(-26) : [];
        const arrow = (c) => (c > 0 ? `<span class="text-emerald">▲ ${c}%</span>` : c < 0 ? `<span class="text-red">▼ ${Math.abs(c)}%</span>` : '<span class="text-dim">= 0%</span>');
        const trendTxt = { up: '📈 تصاعدي', down: '📉 تنازلي', flat: '➡️ مستقر' }[fc.trend];
        return `<div class="gh-stats">
                <div class="gh-stat"><i class="fa-solid fa-code-commit"></i><b>${fmtNum(total)}</b><span>commit خلال سنة</span></div>
                <div class="gh-stat"><i class="fa-solid fa-calendar-week"></i><b>${(total / 52).toFixed(1)}</b><span>متوسط أسبوعي</span></div>
                <div class="gh-stat"><i class="fa-solid fa-users"></i><b>${s.people.length}</b><span>مساهم</span></div>
                <div class="gh-stat"><i class="fa-solid fa-star"></i><b>${fmtNum(s.info.stargazers_count)}</b><span>نجمة</span></div></div>
            ${card('الـ Commits أسبوعياً (52 أسبوعاً) + التنبؤ', `${barsSVG([...s.weeks, ...fc.next], { labels: [...labels, 'تنبؤ 1', 'تنبؤ 2', 'تنبؤ 3', 'تنبؤ 4'], highlightFrom: s.weeks.length })}
                <div class="gh-item-meta">الأعمدة الزرقاء = تنبؤ للأسابيع الأربعة القادمة</div>`, { icon: 'fa-chart-column' })}
            <div class="ghx-grid2">
            ${card('مقارنة فترتين', `<div class="gh-row" style="margin-bottom:6px"><label>آخر</label>${select('ghx-cmp-n', [['2', 'أسبوعين'], ['4', '4 أسابيع'], ['8', '8 أسابيع'], ['12', '12 أسبوعاً'], ['26', '6 أشهر']], String(n), { style: 'width:auto' }).replace('<select ', '<select onchange="app._ghxCompareN=+this.value; app.ghxReload()" ')}<label>مقابل الفترة السابقة</label></div>
                <div class="ghx-compare" data-change="${cmp.change}"><div><b>${cmp.current}</b><span>الفترة الحالية</span></div><div class="ghx-compare-vs">${arrow(cmp.change)}</div><div><b>${cmp.previous}</b><span>الفترة السابقة</span></div></div>
                <div class="gh-item-meta">متوسط أسبوعي ${cmp.avgCurrent} مقابل ${cmp.avgPrevious}</div>`, { icon: 'fa-scale-balanced' })}
            ${card('التنبؤ بالنشاط', `<div class="ghx-forecast" data-trend="${fc.trend}"><b>${trendTxt}</b> <span class="text-dim">(ميل ${fc.slope} commit/أسبوع، ثقة ${{ high: 'عالية', medium: 'متوسطة', low: 'منخفضة' }[fc.confidence]})</span></div>
                <div class="gh-item-meta">المتوقع للأسابيع الأربعة القادمة: <b>${fc.next.join(' • ')}</b> commit</div>
                <div class="text-dim" style="font-size:0.7rem">انحدار خطي على آخر 12 أسبوعاً — مؤشر تقريبي وليس وعداً.</div>`, { icon: 'fa-wand-magic-sparkles' })}
            </div>
            ${card('أكثر الأيام نشاطاً', hbarsHTML(days.map((c, i) => [dayNames[i], c])), { icon: 'fa-calendar-day' })}
            ${freq.length ? card('الإضافات والحذف (26 أسبوعاً)', `<div class="ghx-dual">${barsSVG(freq.map(f => f[1]), { h: 70, color: '#34d399' })}${barsSVG(freq.map(f => Math.abs(f[2])), { h: 70, color: '#f87171' })}</div>`, { icon: 'fa-code' }) : ''}`;
    };

    // ------------------------------------------------------------------ CONTRIBUTORS (#463)
    P.ghxContributorsChart = async function () {
        const s = await this.ghxStatsData();
        if (!s.people.length) return note('⏳ لا توجد بيانات مساهمين بعد (أو GitHub يحسبها).') + btn('إعادة المحاولة', "app._ghxStats=null; app.ghxReload()", { icon: 'fa-rotate' });
        const top = s.people.slice(0, 15);
        return card('الـ Commits لكل مساهم', hbarsHTML(top.map(p => [p.login, p.commits, `<span class="text-emerald">+${fmtNum(p.additions)}</span> <span class="text-red">−${fmtNum(p.deletions)}</span>`])), { icon: 'fa-users' })
            + card('النشاط خلال آخر 4 أسابيع', hbarsHTML(top.filter(p => p.recent).map(p => [p.login, p.recent])) || '<div class="text-dim">لا نشاط حديث</div>', { icon: 'fa-bolt' });
    };

    // ------------------------------------------------------------------ TRAFFIC (#458)
    P.ghxTraffic = async function () {
        this.ghxNeedToken('إحصائيات الزيارات');
        const rp = this.ghRepoPath();
        const [views, clones, paths, refs] = await Promise.all([
            this.gh(`${rp}/traffic/views`), this.gh(`${rp}/traffic/clones`),
            this.gh(`${rp}/traffic/popular/paths`).catch(() => []), this.gh(`${rp}/traffic/popular/referrers`).catch(() => [])
        ]);
        const v = trafficSummary(views, 'views'), c = trafficSummary(clones, 'clones');
        this._ghxTraffic = { views: v, clones: c, paths, refs };
        return `<div class="gh-stats">
                <div class="gh-stat"><i class="fa-solid fa-eye"></i><b>${fmtNum(v.count)}</b><span>مشاهدة (14 يوماً)</span></div>
                <div class="gh-stat"><i class="fa-solid fa-user"></i><b>${fmtNum(v.uniques)}</b><span>زائر فريد</span></div>
                <div class="gh-stat"><i class="fa-solid fa-clone"></i><b>${fmtNum(c.count)}</b><span>استنساخ</span></div>
                <div class="gh-stat"><i class="fa-solid fa-user-group"></i><b>${fmtNum(c.uniques)}</b><span>مستنسخ فريد</span></div></div>
            ${card('المشاهدات يومياً', v.series.length ? barsSVG(v.series.map(x => x.count), { labels: v.series.map(x => x.day), h: 90 }) : '<div class="text-dim">—</div>', { icon: 'fa-chart-line' })}
            ${card('الاستنساخ يومياً', c.series.length ? barsSVG(c.series.map(x => x.count), { labels: c.series.map(x => x.day), h: 90, color: '#60a5fa' }) : '<div class="text-dim">—</div>', { icon: 'fa-clone' })}
            <div class="ghx-grid2">${card('أكثر الصفحات زيارة', paths.length ? hbarsHTML(paths.slice(0, 10).map(p => [p.path.replace(/^\/[^/]+\/[^/]+/, '') || '/', p.count])) : '<div class="text-dim">—</div>', { icon: 'fa-file' })}
            ${card('مصادر الزيارات', refs.length ? hbarsHTML(refs.slice(0, 10).map(r => [r.referrer, r.count])) : '<div class="text-dim">—</div>', { icon: 'fa-share-nodes' })}</div>`;
    };

    // ------------------------------------------------------------------ TOP FILES (#464)
    P.ghxTopFiles = async function () {
        const cached = this._ghxTopFiles && this._ghxTopFiles.rp === this.ghRepoPath() ? this._ghxTopFiles : null;
        const intro = card('أكثر الملفات تعديلاً', `<div class="gh-row"><span class="text-dim" style="font-size:0.74rem">يحلل تفاصيل آخر الـ commits في الفرع (طلب لكل commit).</span><span class="gh-spacer"></span>
            ${select('ghx-top-n', [['20', 'آخر 20'], ['50', 'آخر 50'], ['100', 'آخر 100']], String(cached ? cached.n : 20), { style: 'width:auto' })}${btn('تحليل', "app.ghxComputeTopFiles(+document.getElementById('ghx-top-n').value)", { icon: 'fa-fire', primary: true })}</div>`, { icon: 'fa-fire' });
        if (!cached) return intro + empty('اضغط «تحليل» للبدء.');
        return intro + card(`النتيجة (${cached.n} commit)`, hbarsHTML(cached.files.map(f => [f.path, f.count, `<span class="text-emerald">+${f.additions}</span> <span class="text-red">−${f.deletions}</span>`]), { unit: '×' }), { icon: 'fa-list-ol' });
    };
    P.ghxComputeTopFiles = async function (n = 20) {
        const rp = this.ghRepoPath();
        this.showToast(`⏳ تحليل آخر ${n} commit...`, 'info');
        try {
            const list = await this.gh(`${rp}/commits?sha=${encodeURIComponent(this.ghRepo().branch)}&per_page=${Math.min(100, n)}`);
            const details = await mapLimit(list, 6, (c) => this.gh(`${rp}/commits/${c.sha}`).catch(() => null));
            this._ghxTopFiles = { rp, n: list.length, files: topFiles(details.filter(Boolean)) };
            if (this.ghTab === 'analytics' && !this.ghView) await this.ghxReload();
            return this._ghxTopFiles;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };

    // ------------------------------------------------------------------ DEPENDENCY GRAPH (#459)
    P.ghxDependencyGraph = async function () {
        const rp = this.ghRepoPath();
        let pkgs = [], source = 'sbom';
        try { pkgs = sbomPackages(await this.gh(`${rp}/dependency-graph/sbom`)); } catch (e) { pkgs = []; }
        if (!pkgs.length) {
            source = 'package.json';
            const f = await this.ghGetFile('package.json').catch(() => null);
            pkgs = f ? packageJsonDeps(f.content) : [];
        }
        const eco = new Map();
        pkgs.forEach(p => eco.set(p.ecosystem, (eco.get(p.ecosystem) || 0) + 1));
        this._ghxDeps = pkgs;
        return `<div class="gh-item-meta" style="margin-bottom:8px">${pkgs.length} اعتمادية • المصدر: ${source === 'sbom' ? 'Dependency Graph (SBOM)' : 'package.json'}</div>
            ${eco.size ? card('حسب النظام', hbarsHTML(Array.from(eco.entries()))) : ''}
            ${pkgs.length ? `<div class="gh-toolbar">${btn('تصدير CSV', 'app.ghxExportDeps()', { icon: 'fa-file-csv' })}${btn('فحص الإصدارات القديمة', "app.openDependencyDoctor ? app.openDependencyDoctor() : app.showToast('افتح مختبر الذكاء ← طبيب الاعتماديات','info')", { icon: 'fa-stethoscope' })}</div>
                <table class="ghx-table" dir="ltr"><thead><tr><th>Package</th><th>Version</th><th>Ecosystem</th></tr></thead><tbody>${pkgs.slice(0, 400).map(p => `<tr><td>${esc(p.name)}${p.dev ? ' <span class="gh-badge dim">dev</span>' : ''}</td><td><code>${esc(p.version)}</code></td><td>${esc(p.ecosystem)}</td></tr>`).join('')}</tbody></table>` : empty('لم يُعثر على اعتماديات (فعّل Dependency Graph من إعدادات المستودع).')}`;
    };
    P.ghxExportDeps = function () {
        const rows = [['name', 'version', 'ecosystem', 'dev'], ...(this._ghxDeps || []).map(p => [p.name, p.version, p.ecosystem, p.dev ? 'yes' : ''])];
        this.ghxDownload(toCSV(rows), `${this.ghRepo().repo}-dependencies.csv`, 'text/csv');
    };

    // ------------------------------------------------------------------ REPORT / EXPORT / SHARE (#467 #468 #469)
    P.ghxReport = async function () {
        const rep = this._ghxReportData;
        return card('التقرير الأسبوعي', `<div class="gh-row"><span class="text-dim" style="font-size:0.74rem">ملخص آخر 7 أيام: الـ commits والـ PRs والـ Issues والمساهمون.</span><span class="gh-spacer"></span>${btn('إنشاء التقرير', 'app.ghxWeeklyReport()', { icon: 'fa-file-lines', primary: true })}</div>
                ${rep ? `<div class="gh-md ghx-report">${this.renderMarkdownSafe(rep.markdown)}</div>
                <div class="gh-toolbar">${btn('نسخ Markdown', 'app.ghxCopy(app._ghxReportData.markdown)', { icon: 'fa-copy' })}${btn('تنزيل .md', "app.ghxDownload(app._ghxReportData.markdown, 'weekly-report.md', 'text/markdown')", { icon: 'fa-download' })}
                ${btn('صياغة بالذكاء الاصطناعي', 'app.ghxPolishReport()', { icon: 'fa-robot' })}${btn('إرسال للمحادثة', 'app.sendQuickPrompt(app._ghxReportData.markdown)', { icon: 'fa-paper-plane' })}${btn('حفظ كـ Issue', 'app.ghxReportAsIssue()', { icon: 'fa-circle-dot' })}</div><div id="ghx-report-ai" class="gh-md"></div>` : ''}`, { icon: 'fa-file-lines' })
            + card('تصدير ومشاركة الإحصائيات', `<div class="gh-row">${btn('تصدير JSON', "app.ghxExportStats('json')", { icon: 'fa-file-code' })}${btn('تصدير CSV', "app.ghxExportStats('csv')", { icon: 'fa-file-csv' })}
                ${btn('مشاركة', 'app.ghxShareStats()', { icon: 'fa-share-nodes', primary: true })}</div><div class="text-dim" style="font-size:0.72rem;margin-top:4px">المشاركة تستخدم قائمة المشاركة في جهازك أو تنسخ ملخصاً جاهزاً (Markdown).</div>`, { icon: 'fa-share-from-square' });
    };

    P.ghxWeeklyReport = async function () {
        const rp = this.ghRepoPath();
        const since = new Date(Date.now() - 7 * 86400000).toISOString();
        try {
            const [commits, prs, issues] = await Promise.all([
                this.gh(`${rp}/commits?since=${encodeURIComponent(since)}&per_page=100&sha=${encodeURIComponent(this.ghRepo().branch)}`),
                this.gh(`${rp}/pulls?state=all&sort=updated&direction=desc&per_page=50`),
                this.gh(`${rp}/issues?state=all&since=${encodeURIComponent(since)}&per_page=100`)
            ]);
            const { owner, repo } = this.ghRepo();
            this._ghxReportData = weeklyReport({ repo: `${owner}/${repo}`, commits, prs, issues, since });
            if (this.ghTab === 'analytics' && !this.ghView) await this.ghxLoad('analytics', 'report');
            return this._ghxReportData;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };
    P.ghxPolishReport = async function () {
        const rep = this._ghxReportData;
        if (!rep) return;
        const out = await this.ghAI(`أعد صياغة هذا التقرير الأسبوعي لمستودع برمجي بالعربية بأسلوب مهني موجز لمدير مشروع: فقرة ملخص، أبرز الإنجازات، المخاطر أو التأخير المحتمل، وتوصيات للأسبوع القادم. حافظ على الأرقام كما هي.\n\n${rep.markdown}`, { targetId: 'ghx-report-ai', maxTokens: 1200, source: 'github-report' });
        if (out) rep.polished = out;
        return out;
    };
    P.ghxReportAsIssue = async function () {
        const rep = this._ghxReportData;
        if (!rep || !this.ghRequireToken()) return;
        try {
            const i = await this.gh(`${this.ghRepoPath()}/issues`, { method: 'POST', body: { title: `📊 التقرير الأسبوعي — ${new Date().toLocaleDateString('ar')}`, body: rep.polished || rep.markdown } });
            this.showToast(`✅ أنشئت Issue #${i.number}`, 'success');
            return i.number;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };

    P.ghxStatsSnapshot = async function () {
        const s = await this.ghxStatsData();
        const { owner, repo } = this.ghRepo();
        return {
            repo: `${owner}/${repo}`, generatedAt: new Date().toISOString(),
            stars: s.info.stargazers_count, forks: s.info.forks_count, openIssues: s.info.open_issues_count, size: s.info.size,
            weeklyCommits: (s.activity || []).map(w => ({ week: new Date(w.week * 1000).toISOString().slice(0, 10), total: w.total })),
            contributors: s.people, compare4w: comparePeriods(s.weeks, 4), forecast: forecast(s.weeks, 4),
            traffic: this._ghxTraffic ? { views: this._ghxTraffic.views.count, uniques: this._ghxTraffic.views.uniques, clones: this._ghxTraffic.clones.count } : undefined
        };
    };
    P.ghxExportStats = async function (format = 'json') {
        try {
            const snap = await this.ghxStatsSnapshot();
            const base = `${snap.repo.replace('/', '-')}-stats`;
            if (format === 'csv') {
                const rows = [['section', 'key', 'value'], ['repo', 'stars', snap.stars], ['repo', 'forks', snap.forks], ['repo', 'open_issues', snap.openIssues],
                    ...snap.weeklyCommits.map(w => ['weekly_commits', w.week, w.total]),
                    ...snap.contributors.map(p => ['contributor', p.login, p.commits])];
                this.ghxDownload(toCSV(rows), base + '.csv', 'text/csv');
            } else this.ghxDownload(JSON.stringify(snap, null, 2), base + '.json', 'application/json');
            return snap;
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };
    P.ghxShareText = async function () {
        const s = await this.ghxStatsSnapshot();
        const c = s.compare4w;
        return `📊 ${s.repo}\n⭐ ${s.stars} نجمة • 🍴 ${s.forks} تفرع • 🐞 ${s.openIssues} Issue مفتوحة\n🧑‍💻 ${s.contributors.length} مساهم — الأكثر نشاطاً: ${s.contributors.slice(0, 3).map(p => p.login).join('، ')}\n📈 آخر 4 أسابيع: ${c.current} commit (${c.change >= 0 ? '+' : ''}${c.change}% عن الفترة السابقة)\nhttps://github.com/${s.repo}`;
    };
    P.ghxShareStats = async function () {
        try {
            const text = await this.ghxShareText();
            if (navigator.share) { try { await navigator.share({ title: 'إحصائيات المستودع', text }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; } }
            this.ghxCopy(text, 'تم نسخ ملخص الإحصائيات للمشاركة ✓');
            return 'copied';
        } catch (e) { this.showToast('❌ ' + e.message, 'error'); }
    };
}
