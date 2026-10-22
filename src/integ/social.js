/* #71 developer leaderboard (GitHub contributor stats) • #366 points leaderboard (local activity → shared team board) */
import { esc, btn, pbtn, card, empty, select, table, stats, toggle, ago } from './util.js';

// ====================================================================== pure helpers
export const LEVELS = [[0, 'مبتدئ', '🌱'], [100, 'متدرب', '🔰'], [500, 'مطوّر', '⚙️'], [1500, 'محترف', '🚀'], [4000, 'خبير', '🧠'], [10000, 'أسطورة', '👑']];
export function levelOf(points) {
    let i = 0;
    while (i + 1 < LEVELS.length && points >= LEVELS[i + 1][0]) i++;
    const next = LEVELS[i + 1];
    return { idx: i, name: LEVELS[i][1], icon: LEVELS[i][2], min: LEVELS[i][0], next: next ? next[0] : null, progress: next ? Math.round((points - LEVELS[i][0]) / (next[0] - LEVELS[i][0]) * 100) : 100 };
}
export const POINTS = { chat: 2, file: 3, push: 10, test: 5, day: 15 };
/** Ledger + live counters → score breakdown. */
export function scorePoints(ledger = {}, live = {}) {
    const c = { ...(ledger.counts || {}) };
    if (live.chat != null) c.chat = Math.max(c.chat || 0, live.chat);
    const rows = Object.keys(POINTS).map(k => [k, c[k] || 0, (c[k] || 0) * POINTS[k]]);
    const total = rows.reduce((n, r) => n + r[2], 0);
    return { rows, total, level: levelOf(total) };
}
/** GitHub /stats/contributors → ranked rows. weeks: limit to the last N weeks (0 = all). */
export function rankContributors(stats, { weeks = 0 } = {}) {
    if (!Array.isArray(stats)) return [];
    return stats.map(s => {
        const ws = weeks ? (s.weeks || []).slice(-weeks) : (s.weeks || []);
        const commits = ws.reduce((n, w) => n + (w.c || 0), 0), add = ws.reduce((n, w) => n + (w.a || 0), 0), del = ws.reduce((n, w) => n + (w.d || 0), 0);
        const active = ws.filter(w => w.c > 0).length;
        let streak = 0;
        for (let i = ws.length - 1; i >= 0 && ws[i].c > 0; i--) streak++;
        const score = Math.round(commits * 10 + Math.sqrt(add + del) * 3 + active * 8 + streak * 5);
        return { login: (s.author && s.author.login) || '?', avatar: s.author && s.author.avatar_url, commits, add, del, active, streak, score };
    }).filter(r => r.commits > 0).sort((a, b) => b.score - a.score || b.commits - a.commits);
}
/** Merge one user's entry into the shared board. */
export function mergeBoard(board, entry) {
    const list = ((board && board.entries) || []).filter(e => e.user !== entry.user);
    list.push(entry);
    list.sort((a, b) => b.points - a.points);
    return { updated: new Date().toISOString(), entries: list.slice(0, 200) };
}
const medal = (i) => ['🥇', '🥈', '🥉'][i] || String(i + 1);

export function installSocial(P) {
    const LKEY = 'ox_ix_points_v1';
    P.ixLedger = function () { try { return JSON.parse(localStorage.getItem(LKEY)) || { counts: {}, days: [] }; } catch (e) { return { counts: {}, days: [] }; } };
    P.ixAward = function (kind, n = 1) {
        if (!POINTS[kind]) return null;
        const l = this.ixLedger();
        l.counts = l.counts || {};
        l.counts[kind] = (l.counts[kind] || 0) + n;
        const day = new Date().toISOString().slice(0, 10);
        l.days = l.days || [];
        if (!l.days.includes(day)) { l.days.push(day); l.days = l.days.slice(-400); l.counts.day = (l.counts.day || 0) + 1; }
        localStorage.setItem(LKEY, JSON.stringify(l));
        const before = levelOf(this._ixLastTotal || 0).idx;
        const total = this.ixScore().total;
        if (this._ixLastTotal != null && levelOf(total).idx > before) { const lv = levelOf(total); this.showToast(`${lv.icon} ترقية! مستواك الآن: ${lv.name}`, 'success'); }
        this._ixLastTotal = total;
        return l.counts[kind];
    };
    P.ixScore = function () {
        const chat = (this.sessions || []).reduce((n, s) => n + (s.messages || []).filter(m => m.role === 'user').length, 0);
        return scorePoints(this.ixLedger(), { chat });
    };
    /** Award points from real activity: new files, GitHub pushes, test runs. */
    P.ixPointsInstall = function () {
        const proto = Object.getPrototypeOf(this);
        if (proto.writeProjectFile.__ixPts) return false;
        const wf = proto.writeProjectFile;
        const w = function (path) { const isNew = !this.virtualProjectFiles.has(path); const r = wf.apply(this, arguments); if (isNew) try { this.ixAward('file'); } catch (e) { /* ignore */ } return r; };
        w.__ixPts = true;
        proto.writeProjectFile = w;
        if (!proto.gh.__ixPts) {
            const gh = proto.gh;
            const g = async function (path, opts = {}) { const res = await gh.call(this, path, opts); if (/\/git\/refs(\/heads\/|$)/.test(path) && /PATCH|POST/i.test(opts.method || '')) try { this.ixAward('push'); } catch (e) { /* ignore */ } return res; };
            g.__ixPts = true;
            g.__ixHooked = gh.__ixHooked;
            proto.gh = g;
        }
        this._ixLastTotal = this.ixScore().total;
        return true;
    };
    P._ixBootFns.points = function () { this.ixPointsInstall(); };
    P.ixPointsEnable = function (on) { this.ixSave('points', { on: !!on }); this.ixBootSet('points', !!on); if (on) this.ixPointsInstall(); this.ixRefresh(); };
    P.ixBoardPath = () => '.ox/leaderboard.json';
    P.ixBoardLoad = async function () {
        const o = this.settings.githubOwner, r = this.settings.githubRepo;
        if (!o || !r || !String(this.settings.githubToken || '').trim()) throw new Error('اربط مستودع GitHub أولاً (يُخزن اللوح المشترك في .ox/leaderboard.json)');
        const res = await this.gh(`/repos/${o}/${r}/contents/${this.ixBoardPath()}?ref=${encodeURIComponent(this.settings.githubBranch || 'main')}`, { allow: [404] });
        if (!res || !res.content) return { board: { entries: [] }, sha: null };
        const text = new TextDecoder().decode(Uint8Array.from(atob(res.content.replace(/\s/g, '')), c => c.charCodeAt(0)));
        return { board: JSON.parse(text), sha: res.sha };
    };
    P.ixBoardPublish = async function () {
        try {
            const me = this.settings.githubOwner || 'me';
            let login = me;
            try { const u = await this.gh('/user'); login = u.login || me; } catch (e) { /* token without user scope */ }
            const s = this.ixScore();
            const { board, sha } = await this.ixBoardLoad();
            const next = mergeBoard(board, { user: login, points: s.total, level: s.level.name, icon: s.level.icon, at: new Date().toISOString() });
            const bytes = new TextEncoder().encode(JSON.stringify(next, null, 2) + '\n');
            let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); });
            await this.gh(`/repos/${this.settings.githubOwner}/${this.settings.githubRepo}/contents/${this.ixBoardPath()}`, { method: 'PUT', body: { message: `chore(leaderboard): ${login} → ${s.total} pts`, content: btoa(bin), sha: sha || undefined, branch: this.settings.githubBranch || 'main' } });
            this._ixBoard = next;
            this.showToast('🏆 نُشرت نقاطك في لوح الفريق', 'success');
            this.ixBoardPaint();
            return next;
        } catch (e) { return this.ixErr(e, 'ix-pt-board'); }
    };
    P.ixBoardPaint = function () {
        const b = this._ixBoard;
        this.ixOut('ix-pt-board', b && b.entries.length ? table(['', 'المطور', 'النقاط', 'المستوى', 'آخر تحديث'], b.entries.map((e, i) => [medal(i), `<b dir="ltr">${esc(e.user)}</b>`, String(e.points), esc((e.icon || '') + ' ' + (e.level || '')), esc(ago(new Date(e.at).getTime()))])) : empty('اللوح فارغ — كن أول من ينشر نقاطه'));
    };
    P.ixBoardRefresh = async function () { this.ixBusy('ix-pt-board', ''); try { this._ixBoard = (await this.ixBoardLoad()).board; this.ixBoardPaint(); return this._ixBoard; } catch (e) { return this.ixErr(e, 'ix-pt-board'); } };
    P.ixPoints = async function () {
        const s = this.ixScore(), lv = s.level, c = this.ixCfg('points');
        const L = { chat: 'رسائل للذكاء', file: 'ملفات أنشأتها', push: 'عمليات Push', test: 'جولات اختبار ناجحة', day: 'أيام نشاط' };
        return card('نقاطك', `<div class="ix-level"><span class="ix-level-icon">${lv.icon}</span><div><b>${esc(lv.name)}</b> — ${s.total} نقطة<div class="tmx-bar"><div style="width:${lv.progress}%"></div></div><small class="hv-dim">${lv.next ? `${lv.next - s.total} نقطة للمستوى التالي` : 'أعلى مستوى!'}</small></div></div>
            ${table(['النشاط', 'العدد', 'النقاط'], s.rows.map(([k, n, p]) => [esc(L[k]) + ` <small class="hv-dim">(${POINTS[k]}×)</small>`, String(n), String(p)]))}
            <div class="gh-row">${toggle('ix-pt-on', 'احتساب النقاط تلقائياً (الملفات وعمليات Push)', c.on !== false && this.ixBootList().includes('points'), 'onchange="app.ixPointsEnable(this.checked)"')}</div>`, 'fa-star')
            + card('لوح صدارة الفريق', `<p class="hv-dim">لوح مشترك في مستودع الفريق داخل الملف <code>.ox/leaderboard.json</code>. كل عضو ينشر نقاطه، فيرى الجميع الترتيب نفسه دون أي خادم.</p>
            <div class="gh-row">${pbtn('fa-upload', 'انشر نقاطي', 'app.ixBoardPublish()')}${btn('fa-rotate', 'تحديث', 'app.ixBoardRefresh()')}</div><div id="ix-pt-board"></div>`, 'fa-ranking-star');
    };

    // ---------------------------------------------------------------- #71 developer leaderboard
    P.ixDevStats = async function (repo, weeks = 0) {
        repo = repo || (this.settings.githubOwner && this.settings.githubRepo ? `${this.settings.githubOwner}/${this.settings.githubRepo}` : '');
        if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('حدد المستودع (owner/repo)');
        let data = null;
        for (let i = 0; i < 3; i++) {
            data = await this.gh(`/repos/${repo}/stats/contributors`, { allow: [202, 204] });
            if (Array.isArray(data)) break;
            await new Promise(r => setTimeout(r, this._ixTestFast ? 1 : 2500));
        }
        if (!Array.isArray(data)) throw new Error('GitHub ما زال يحسب الإحصاءات — أعد المحاولة بعد لحظات');
        return rankContributors(data, { weeks });
    };
    P.ixDevBoardLoad = async function () {
        const repo = (document.getElementById('ix-db-repo') || {}).value || '';
        const weeks = +((document.getElementById('ix-db-period') || {}).value || 0);
        this.ixBusy('ix-dv-res', 'جلب إحصاءات المساهمين…');
        try {
            const rows = await this.ixDevStats(repo.trim(), weeks);
            this._ixDevRows = rows;
            const top = rows[0];
            this.ixOut('ix-dv-res', rows.length ? `${top ? `<div class="ix-champion">${top.avatar ? `<img src="${esc(top.avatar)}&s=96" alt="" loading="lazy">` : ''}<div>🏆 <b dir="ltr">${esc(top.login)}</b><small>${top.commits} commit • ${top.active} أسبوع نشط • سلسلة ${top.streak}</small></div></div>` : ''}
                ${table(['', 'المطور', 'النقاط', 'Commits', '+/−', 'أسابيع نشطة', 'السلسلة'], rows.map((r, i) => [medal(i), `<a href="https://github.com/${esc(r.login)}" target="_blank" rel="noopener" dir="ltr">${esc(r.login)}</a>`, `<b>${r.score}</b>`, String(r.commits), `<span class="ix-add">+${r.add}</span> <span class="ix-del">−${r.del}</span>`, String(r.active), r.streak ? '🔥 ' + r.streak : '—']))}
                <small class="hv-dim">النقاط = Commits×10 + √(الأسطر المعدلة)×3 + الأسابيع النشطة×8 + السلسلة×5</small>` : empty('لا توجد مساهمات في هذه الفترة'));
            return rows;
        } catch (e) { return this.ixErr(e, 'ix-dv-res'); }
    };
    P.ixDevBoard = async function () {
        const repo = this.settings.githubOwner && this.settings.githubRepo ? `${this.settings.githubOwner}/${this.settings.githubRepo}` : '';
        return card('لوحة صدارة المطورين', `<p class="hv-dim">ترتيب المساهمين في أي مستودع حسب Commits والأسطر المعدلة والأسابيع النشطة وسلسلة الأسابيع المتتالية، من إحصاءات GitHub الرسمية.</p>
            <div class="gh-row"><label class="fmx-field"><span>المستودع</span><input id="ix-db-repo" class="form-input-box" dir="ltr" value="${esc(repo)}" placeholder="owner/repo"></label>${select('ix-db-period', 'الفترة', [['0', 'كل الوقت'], ['52', 'آخر سنة'], ['12', 'آخر 3 أشهر'], ['4', 'آخر شهر']], '0')}${pbtn('fa-trophy', 'عرض', 'app.ixDevBoardLoad()')}</div>
            <div id="ix-dv-res"></div>`, 'fa-trophy');
    };
}
