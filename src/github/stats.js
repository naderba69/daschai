/* Pure statistics helpers for the analytics tab (#462-#470, #450, #464). */

/** /stats/commit_activity → weekly totals (oldest first). GitHub answers 202 + {} while computing. */
export const weeklyTotals = (activity) => (Array.isArray(activity) ? activity.map(w => +w.total || 0) : []);

/** Compare the last n weeks with the n weeks before (#466). */
export function comparePeriods(weeks, n = 4) {
    const cur = weeks.slice(-n), prev = weeks.slice(-2 * n, -n);
    const a = cur.reduce((s, v) => s + v, 0), b = prev.reduce((s, v) => s + v, 0);
    const change = b === 0 ? (a === 0 ? 0 : 100) : Math.round(((a - b) / b) * 100);
    return { current: a, previous: b, change, n, avgCurrent: +(a / Math.max(1, cur.length)).toFixed(1), avgPrevious: +(b / Math.max(1, prev.length)).toFixed(1) };
}

/** Least-squares trend over the last `window` points → next `n` values (≥0) (#470). */
export function forecast(values, n = 4, window = 12) {
    const ys = values.slice(-window);
    const k = ys.length;
    if (!k) return { next: Array(n).fill(0), slope: 0, trend: 'flat', confidence: 'low' };
    const xs = ys.map((_, i) => i);
    const mx = xs.reduce((a, b) => a + b, 0) / k, my = ys.reduce((a, b) => a + b, 0) / k;
    let num = 0, den = 0;
    xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
    const slope = den ? num / den : 0;
    const icpt = my - slope * mx;
    const next = Array.from({ length: n }, (_, i) => Math.max(0, Math.round(icpt + slope * (k + i))));
    const resid = ys.reduce((s, y, i) => s + (y - (icpt + slope * i)) ** 2, 0) / k;
    const cv = my ? Math.sqrt(resid) / my : 1;
    const rel = my ? slope / my : 0;
    return { next, slope: +slope.toFixed(2), trend: rel > 0.03 ? 'up' : rel < -0.03 ? 'down' : 'flat', confidence: k < 6 ? 'low' : cv < 0.35 ? 'high' : cv < 0.8 ? 'medium' : 'low', mean: +my.toFixed(1) };
}

/** /stats/contributors → [{ login, commits, additions, deletions, weeks }] sorted by commits. */
export function contributorTotals(stats) {
    if (!Array.isArray(stats)) return [];
    return stats.map(s => ({
        login: (s.author && s.author.login) || 'ghost',
        commits: +s.total || 0,
        additions: (s.weeks || []).reduce((a, w) => a + (+w.a || 0), 0),
        deletions: (s.weeks || []).reduce((a, w) => a + (+w.d || 0), 0),
        recent: (s.weeks || []).slice(-4).reduce((a, w) => a + (+w.c || 0), 0)
    })).sort((a, b) => b.commits - a.commits);
}

/** Commit details (GET /commits/{sha}) → most modified files (#464). */
export function topFiles(details, limit = 15) {
    const m = new Map();
    for (const d of details || []) {
        for (const f of (d && d.files) || []) {
            const cur = m.get(f.filename) || { path: f.filename, count: 0, additions: 0, deletions: 0 };
            cur.count++; cur.additions += +f.additions || 0; cur.deletions += +f.deletions || 0;
            m.set(f.filename, cur);
        }
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count || (b.additions + b.deletions) - (a.additions + a.deletions)).slice(0, limit);
}

/** Actions minutes per workflow from run objects (#450). */
export function usageByWorkflow(runs) {
    const m = new Map();
    let total = 0;
    for (const r of runs || []) {
        const start = Date.parse(r.run_started_at || r.created_at), end = Date.parse(r.updated_at);
        if (!(end > start) || r.status !== 'completed') continue;
        const min = (end - start) / 60000;
        total += min;
        const cur = m.get(r.name) || { name: r.name, runs: 0, minutes: 0, failures: 0 };
        cur.runs++; cur.minutes += min; if (r.conclusion === 'failure') cur.failures++;
        m.set(r.name, cur);
    }
    const rows = Array.from(m.values()).map(x => ({ ...x, minutes: +x.minutes.toFixed(1), avg: +(x.minutes / x.runs).toFixed(1) })).sort((a, b) => b.minutes - a.minutes);
    return { rows, total: +total.toFixed(1), billable: rows.reduce((a, x) => a + Math.ceil(x.minutes), 0) };
}

/** Weekly report (#469) from raw lists of the last 7 days. */
export function weeklyReport({ repo, commits = [], prs = [], issues = [], since, until = new Date().toISOString() }) {
    const day = (iso) => String(iso || '').slice(0, 10);
    const authors = new Map();
    commits.forEach(c => { const a = (c.author && c.author.login) || (c.commit && c.commit.author && c.commit.author.name) || '?'; authors.set(a, (authors.get(a) || 0) + 1); });
    const merged = prs.filter(p => p.merged_at && p.merged_at >= since);
    const openedPRs = prs.filter(p => p.created_at >= since);
    const closedIssues = issues.filter(i => !i.pull_request && i.closed_at && i.closed_at >= since);
    const openedIssues = issues.filter(i => !i.pull_request && i.created_at >= since);
    const top = Array.from(authors.entries()).sort((a, b) => b[1] - a[1]);
    const lines = [
        `# 📊 التقرير الأسبوعي — ${repo}`, '', `**الفترة:** ${day(since)} → ${day(until)}`, '',
        '## الأرقام', '',
        `| المؤشر | العدد |`, `|---|---|`,
        `| Commits | ${commits.length} |`, `| PRs مدموجة | ${merged.length} |`, `| PRs جديدة | ${openedPRs.length} |`,
        `| Issues مغلقة | ${closedIssues.length} |`, `| Issues جديدة | ${openedIssues.length} |`, `| مساهمون نشطون | ${authors.size} |`, ''
    ];
    if (top.length) lines.push('## المساهمون', '', ...top.map(([a, n]) => `- **${a}** — ${n} commit`), '');
    if (merged.length) lines.push('## PRs مدموجة', '', ...merged.map(p => `- #${p.number} ${p.title}`), '');
    if (closedIssues.length) lines.push('## Issues مغلقة', '', ...closedIssues.map(i => `- #${i.number} ${i.title}`), '');
    if (commits.length) lines.push('## أبرز الـ Commits', '', ...commits.slice(0, 15).map(c => `- \`${String(c.sha).slice(0, 7)}\` ${String((c.commit && c.commit.message) || '').split('\n')[0]}`), '');
    return { markdown: lines.join('\n'), numbers: { commits: commits.length, merged: merged.length, openedPRs: openedPRs.length, closedIssues: closedIssues.length, openedIssues: openedIssues.length, contributors: authors.size } };
}

/** Sum traffic {count, uniques, views|clones:[…]} safely. */
export const trafficSummary = (t, key) => ({ count: +(t && t.count) || 0, uniques: +(t && t.uniques) || 0, series: ((t && t[key]) || []).map(x => ({ day: String(x.timestamp).slice(0, 10), count: +x.count || 0, uniques: +x.uniques || 0 })) });

/** SPDX SBOM (/dependency-graph/sbom) → [{ name, version, ecosystem }] without the root package. */
export function sbomPackages(sbom) {
    const pk = (sbom && sbom.sbom && sbom.sbom.packages) || [];
    return pk.filter(p => !/^com\.github\./.test(p.name || '') || (p.externalRefs || []).length).map(p => {
        const purl = ((p.externalRefs || []).find(r => r.referenceType === 'purl') || {}).referenceLocator || '';
        const eco = (/^pkg:([^/]+)\//.exec(purl) || [])[1] || '';
        return { name: p.name, version: p.versionInfo || '', ecosystem: eco };
    }).filter(p => p.ecosystem);
}

/** package.json → dependency list (fallback when the SBOM endpoint is unavailable). */
export function packageJsonDeps(text) {
    try {
        const j = JSON.parse(text);
        return [...Object.entries(j.dependencies || {}).map(([n, v]) => ({ name: n, version: v, ecosystem: 'npm', dev: false })),
            ...Object.entries(j.devDependencies || {}).map(([n, v]) => ({ name: n, version: v, ecosystem: 'npm', dev: true }))];
    } catch (e) { return []; }
}
