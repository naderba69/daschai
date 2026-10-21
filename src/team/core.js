/* Team hub shell + shared plumbing: tabs/sections, team config (.oxteam/team.json ⇄ localStorage),
   repo file helpers, identity, AI helper, background watch (comments #740, file edits #745, delays #798). */
import { esc, call, empty, lsGet, lsSet, uid, matchGlob, DAY, iso } from './util.js';

export const TAB_DEFS = {
    team: [['overview', 'نظرة عامة', 'tmOverview'], ['members', 'الأعضاء والأدوار', 'tmMembers'], ['perms', 'صلاحيات الملفات', 'tmPerms'], ['invite', 'دعوة برابط', 'tmInvite'], ['settings', 'الإعدادات', 'tmSettings']],
    chat: [['channels', 'القنوات', 'tmChannels'], ['inbox', 'الإشعارات', 'tmInbox'], ['follow', 'متابعة مطورين', 'tmFollow']],
    live: [['session', 'جلسة تحرير حية', 'tmLive'], ['board', 'رسم مشترك', 'tmBoard'], ['call', 'مكالمات الفريق', 'tmCall']],
    review: [['prs', 'مراجعة PR', 'tmReview'], ['suggest', 'الاقتراحات', 'tmSuggestions'], ['ai', 'مراجعة ذكية', 'tmAIReview']],
    share: [['snippet', 'مشاركة كود', 'tmSnippet'], ['links', 'روابطي ومن شاهد', 'tmSnipLinks'], ['embed', 'تضمين في موقع', 'tmEmbed']],
    engage: [['polls', 'تصويت', 'tmPolls'], ['surveys', 'استطلاعات', 'tmSurveys'], ['calendar', 'التقويم', 'tmCalendar'], ['leaderboard', 'لوحة الصدارة', 'tmLeaderboard'], ['rewards', 'المكافآت', 'tmRewards'], ['market', 'سوق القوالب', 'tmMarket']],
    modes: [['vote', 'وضع التصويت', 'tmVoteMode'], ['contest', 'وضع المسابقة', 'tmContest'], ['game', 'وضع اللعب', 'tmGame']],
    ai: [['assign', 'توزيع المهام', 'tmAssign'], ['meeting', 'الاجتماعات والمحاضر', 'tmMeeting'], ['alerts', 'التأخر والتنبيهات', 'tmAlerts'], ['solutions', 'حلول مقترحة', 'tmSolutions'], ['coach', 'مدرب الفريق', 'tmCoach']],
    analytics: [['coverage', 'تغطية الاختبارات', 'tmCoverage'], ['perf', 'الأداء', 'tmPerf'], ['security', 'الأمان', 'tmSecurity'], ['compare', 'مقارنة مشاريع', 'tmCompare'], ['bugs', 'تتبع الأخطاء', 'tmBugs']],
    growth: [['learn', 'تتبع التعلم', 'tmLearn'], ['path', 'مسار التعلم', 'tmPath'], ['suggest', 'اقتراحات وتوصيات', 'tmLearnSuggest'], ['certs', 'الشهادات والإنجازات', 'tmCerts'], ['me', 'إنتاجيتي', 'tmProductivity'], ['mood', 'مشاعر المحادثات', 'tmSentiment']],
    reports: [['team', 'تقرير الفريق', 'tmTeamReport'], ['members', 'مقارنة الأعضاء', 'tmMemberCompare'], ['collab', 'تحليل التعاون', 'tmCollab'], ['progress', 'تقدم المشروع', 'tmProgress'], ['risks', 'المخاطر', 'tmRisks'], ['client', 'تقرير العميل', 'tmClientReport'], ['invoice', 'فاتورة', 'tmInvoice']]
};

export const ROLES = { owner: { label: 'مالك Owner', gh: 'admin', icon: '👑' }, editor: { label: 'محرر Editor', gh: 'push', icon: '✏️' }, viewer: { label: 'مشاهد Viewer', gh: 'pull', icon: '👁️' } };
export const ROLE_CAPS = [
    ['تعديل الملفات', ['owner', 'editor']], ['قراءة المشروع', ['owner', 'editor', 'viewer']], ['دعوة الأعضاء وإدارتهم', ['owner']], ['إنشاء القنوات وأرشفتها', ['owner', 'editor']],
    ['مراجعة PR والموافقة', ['owner', 'editor']], ['تعديل صلاحيات الملفات', ['owner']], ['إعدادات الفريق والحذف ونقل الملكية', ['owner']], ['الكتابة في القنوات والتصويت', ['owner', 'editor', 'viewer']]
];
export const roleFromGH = (p = {}) => (p.admin || p.maintain ? 'owner' : p.push || p.triage ? 'editor' : 'viewer');

export function defaultTeam(name, owner, repo = '') {
    return {
        v: 1, id: uid('team'), name: name || 'فريقي', description: '', repo, owner, created: Date.now(), updated: Date.now(),
        members: owner ? [{ login: owner, role: 'owner', added: Date.now(), skills: [] }] : [],
        rules: [], events: [], rewards: [], market: [],
        settings: { defaultRole: 'editor', enforce: true, notify: true, pollSec: 90, rate: 25, currency: 'USD', tax: 0, aiMember: true, aiName: 'OX-AI', channelLabel: 'ox-channel', client: '' }
    };
}
/** Effective access of a login on a path: owners always write; viewers read; rules restrict matching paths to listed logins. */
export function accessFor(team, login, path) {
    if (!team) return 'write';
    const m = (team.members || []).find(x => x.login === login);
    const role = m ? m.role : (login && login === team.owner ? 'owner' : 'viewer');
    if (role === 'owner') return 'write';
    if (role === 'viewer') return 'read';
    for (const r of team.rules || []) if (matchGlob(r.pattern, path) && !(r.allow || []).includes(login)) return 'read';
    return 'write';
}
/** Patterns that are read-only for a login (consumed by the main-bundle write guard). */
export function readonlyPatterns(team, login) {
    if (!team) return [];
    const m = (team.members || []).find(x => x.login === login);
    const role = m ? m.role : (login === team.owner ? 'owner' : 'viewer');
    if (role === 'owner') return [];
    if (role === 'viewer') return ['**'];
    return (team.rules || []).filter(r => !(r.allow || []).includes(login)).map(r => r.pattern);
}
/** CODEOWNERS text from the rules (+ owners as the default reviewers). */
export function codeOwners(team) {
    const owners = (team.members || []).filter(m => m.role === 'owner').map(m => '@' + m.login);
    const lines = ['# Generated by OX-Alpha Workbench Pro — team permissions', owners.length ? `* ${owners.join(' ')}` : null];
    for (const r of team.rules || []) {
        const who = [...new Set([...(r.allow || []).map(l => '@' + l), ...owners])];
        if (who.length) lines.push(`${String(r.pattern).trim()} ${who.join(' ')}`);
    }
    return lines.filter(Boolean).join('\n') + '\n';
}

const TEAM_KEY = 'ox_team_v1', RULES_KEY = 'ox_team_rules_v1', ME_KEY = 'ox_team_me_v1', WATCH_KEY = 'ox_team_watch_v1', INBOX_KEY = 'ox_team_inbox_v1';
export const TEAM_FILE = '.oxteam/team.json';

export function installCore(P) {
    // ------------------------------------------------------------------ SHELL
    P.openTeamHub = async function (tab = 'team', sec, opts = {}) {
        if (!TAB_DEFS[tab]) tab = 'team';
        this.openPanel({
            title: 'الفريق والتحليلات', icon: 'fa-people-group',
            tabs: (this.TEAM_TABS || []).map(t => ({ ...t, onclick: `app.openTeamHub('${t.id}')` })), activeTab: tab,
            body: '<div id="tmx-root" class="fmx-root tmx-root"></div>'
        });
        return this.tmLoad(tab, sec, opts);
    };
    P.tmLoad = async function (tab, sec, opts = {}) {
        const defs = TAB_DEFS[tab] || TAB_DEFS.team;
        const def = defs.find(d => d[0] === sec) || defs.find(d => d[0] === ((this._tmSec || {})[tab])) || defs[0];
        this._tmSec = { ...(this._tmSec || {}), [tab]: def[0] };
        this._tm = { tab, sec: def[0], opts };
        document.querySelectorAll('#ox-panel-tabs .gh-tab').forEach((b, i) => b.classList.toggle('active', ((this.TEAM_TABS || [])[i] || {}).id === tab));
        const root = document.getElementById('tmx-root');
        if (!root) { await this.openTeamHub(tab, def[0], opts); return; }
        root.innerHTML = `<div class="ghx-subnav fmx-subnav">${defs.map(([id, label]) => `<button class="gh-chip ${id === def[0] ? 'active' : ''}" data-tm-sec="${id}" onclick="${call('tmLoad', tab, id)}">${label}</button>`).join('')}</div>
            <div id="tmx-sec" class="fmx-sec" data-tm-tab="${tab}" data-tm-sec="${def[0]}"><div class="gh-empty"><span class="live-step-spinner"></span></div></div>`;
        this.setPanelFooter('');
        let html;
        try { html = await this[def[2]](opts); } catch (e) { console.error(e); html = empty('❌ ' + esc(e.message || e), true); }
        const el = document.getElementById('tmx-sec');
        if (el && el.dataset.tmSec === def[0] && el.dataset.tmTab === tab && html != null) {
            el.innerHTML = html;
            const m = this._tmMount; this._tmMount = null;
            if (typeof m === 'function') try { m(); } catch (e) { console.error(e); }
        }
        return el;
    };
    P.tmRefresh = function () { const c = this._tm; return c ? this.tmLoad(c.tab, c.sec, c.opts) : this.openTeamHub(); };
    P.tmBusy = function (id, msg) { const el = document.getElementById(id); if (el) el.innerHTML = `<div class="gh-empty"><span class="live-step-spinner"></span> ${msg || ''}</div>`; };
    P.tmErr = function (e, id) {
        const msg = (e && e.message) || String(e);
        if (id) { const el = document.getElementById(id); if (el) el.innerHTML = empty('❌ ' + esc(msg), true); }
        this.showToast('❌ ' + this.escapeHTML(msg), 'error');
        return null;
    };

    // ------------------------------------------------------------------ GITHUB + IDENTITY
    P.tmHasGH = function () { return !!String(this.settings.githubToken || '').trim(); };
    P.tmRepoKey = function () { const { owner, repo } = this.ghRepo(); return `${owner}/${repo}`; };
    /** Repo-relative REST call: app.tmGH('/issues', {...}) → /repos/{o}/{r}/issues */
    P.tmGH = function (path, opts) { return this.gh(this.ghRepoPath() + path, opts); };
    /** Fetch all pages (max `max` items) of a list endpoint. */
    P.tmList = async function (path, { max = 300, key } = {}) {
        const out = [];
        for (let page = 1; out.length < max && page <= 10; page++) {
            const r = await this.gh(path + (path.includes('?') ? '&' : '?') + `per_page=100&page=${page}`);
            const arr = key ? (r && r[key]) || [] : r || [];
            out.push(...arr);
            if (arr.length < 100) break;
        }
        return out.slice(0, max);
    };
    P.tmMe = async function () {
        if (this._tmLogin) return this._tmLogin;
        const cached = lsGet(ME_KEY, null);
        if (this.tmHasGH()) {
            try { const u = await this.gh('/user'); if (u && u.login) { this._tmLogin = u.login; lsSet(ME_KEY, { login: u.login, name: u.name || '', avatar: u.avatar_url || '' }); return u.login; } } catch (e) { /* offline */ }
        }
        // Offline fallback is not cached → the real login is picked up once a token is added
        return (cached && cached.login) || String(this.settings.githubOwner || '').trim() || 'me';
    };
    P.tmMeSync = function () { return this._tmLogin || (lsGet(ME_KEY, null) || {}).login || String(this.settings.githubOwner || '').trim() || 'me'; };
    P.tmRepoFile = async function (path) { return this.ghGetFile(path); };
    P.tmWriteRepoFile = async function (path, content, message) {
        const { branch } = this.ghRepo();
        const cur = await this.ghGetFile(path).catch(() => null);
        if (cur && cur.content === content) return { unchanged: true };
        return this.tmGH(`/contents/${this.ghEncodePath(path)}`, { method: 'PUT', body: { message: message || `chore(team): update ${path}`, content: this.utf8ToB64(content), branch, ...(cur ? { sha: cur.sha } : {}) } });
    };
    P.tmDeleteRepoFile = async function (path, message) {
        const { branch } = this.ghRepo();
        const cur = await this.ghGetFile(path).catch(() => null);
        if (!cur) return false;
        await this.tmGH(`/contents/${this.ghEncodePath(path)}`, { method: 'DELETE', body: { message: message || `chore(team): delete ${path}`, sha: cur.sha, branch } });
        return true;
    };
    /** Make sure a label exists (422 = already there). */
    P.tmEnsureLabel = async function (name, color = '7c3aed', description = 'OX-Alpha team') {
        this._tmLabels = this._tmLabels || new Set();
        const k = this.tmRepoKey() + ':' + name;
        if (this._tmLabels.has(k)) return;
        await this.tmGH('/labels', { method: 'POST', body: { name, color, description }, allow: [422] }).catch(() => null);
        this._tmLabels.add(k);
    };

    // ------------------------------------------------------------------ TEAM CONFIG
    P.tmAllTeams = function () { return lsGet(TEAM_KEY, {}); };
    P.tmTeam = function () { return this.tmAllTeams()[this.tmRepoKey()] || null; };
    P.tmSaveTeam = async function (team, message, { push = true } = {}) {
        const all = this.tmAllTeams();
        team.updated = Date.now();
        if (team) all[this.tmRepoKey()] = team; else delete all[this.tmRepoKey()];
        lsSet(TEAM_KEY, all);
        this.tmSyncRules();
        if (push && team && this.tmHasGH()) {
            try { await this.tmWriteRepoFile(TEAM_FILE, JSON.stringify(team, null, 2) + '\n', message || 'chore(team): update team settings'); team._pushed = Date.now(); }
            catch (e) { this.showToast('⚠️ حُفظ محلياً فقط — تعذر رفع إعدادات الفريق: ' + this.escapeHTML(e.message), 'warning'); return false; }
        }
        return true;
    };
    P.tmPullTeam = async function () {
        if (!this.tmHasGH()) return this.tmTeam();
        const f = await this.ghGetFile(TEAM_FILE).catch(() => null);
        if (!f) return this.tmTeam();
        let t; try { t = JSON.parse(f.content); } catch (e) { throw new Error('ملف .oxteam/team.json تالف'); }
        const all = this.tmAllTeams(); all[this.tmRepoKey()] = t; lsSet(TEAM_KEY, all);
        this.tmSyncRules();
        return t;
    };
    /** Persist the read-only patterns for the current login → enforced by the main-bundle write guard. */
    P.tmSyncRules = function () {
        const t = this.tmTeam(), login = this.tmMeSync();
        const ro = t && t.settings && t.settings.enforce !== false ? readonlyPatterns(t, login) : [];
        lsSet(RULES_KEY, { repo: this.tmRepoKey(), login, role: t ? ((t.members || []).find(m => m.login === login) || {}).role || null : null, readonly: ro });
        this._teamRules = null;
        return ro;
    };
    P.tmRole = function (login = this.tmMeSync()) { const t = this.tmTeam(); if (!t) return 'owner'; const m = (t.members || []).find(x => x.login === login); return m ? m.role : (login === t.owner ? 'owner' : 'viewer'); };
    P.tmCan = function (cap) { const row = ROLE_CAPS.find(r => r[0] === cap); return !row || row[1].includes(this.tmRole()); };
    P.tmRequireTeam = function () { const t = this.tmTeam(); if (!t) { this.showToast('أنشئ فريقاً أولاً (تبويب الفريق ← نظرة عامة)', 'warning'); } return t; };

    // ------------------------------------------------------------------ AI
    P.tmAI = async function (prompt, { json = false, system, maxTokens = 2500, kind = 'chat', quiet = false } = {}) {
        if (!String(this.settings.apiKey || '').trim()) { if (!quiet) this.showToast('يلزم مفتاح OpenRouter في الإعدادات لهذه الميزة الذكية', 'warning'); return null; }
        if ((!this.aiRun || this.aiRun.__oxLazy) && this.loadChunk) { try { await this.loadChunk('ai'); } catch (e) { /* offline */ } }
        if (!this.aiRun) return null;
        const sys = system || 'You are OX-AI, a helpful senior engineer and team coach embedded in a developer team. Answer in Arabic unless code is requested. Be concise and practical.';
        return json ? this.aiJSON(prompt, { system: sys, maxTokens, kind, source: 'team', quiet: true }) : this.aiRun(prompt, { system: sys, maxTokens, kind, source: 'team', quiet: true });
    };

    // ------------------------------------------------------------------ INBOX + WATCH (#740 comments, #745 my files, #798 delays)
    P.tmInboxList = function () { return lsGet(INBOX_KEY, []); };
    P.tmInboxPush = function (item) {
        const list = this.tmInboxList();
        if (item.key && list.some(x => x.key === item.key)) return null;
        const it = { id: uid('n'), t: Date.now(), read: false, ...item };
        list.unshift(it);
        lsSet(INBOX_KEY, list.slice(0, 200));
        const t = this.tmTeam();
        if (!t || !t.settings || t.settings.notify !== false) this.notify(it.title, it.body || '', { tag: it.key || it.id });
        this.tmBadge();
        return it;
    };
    P.tmBadge = function () {
        const n = this.tmInboxList().filter(x => !x.read).length;
        document.querySelectorAll('[data-tm-badge]').forEach(el => { el.textContent = n ? String(n) : ''; el.style.display = n ? '' : 'none'; });
        return n;
    };
    /** Files "I own": authored by me in recent commits, edited by me locally, or rules that list me. */
    P.tmMyFiles = function (myCommitsFiles = []) {
        const set = new Set(myCommitsFiles);
        (this.activityLog || []).slice(-300).forEach(a => { if (a && a.path && (a.op === 'edit' || a.op === 'write' || a.op === 'create')) set.add(a.path); });
        const t = this.tmTeam(), me = this.tmMeSync();
        if (t) (t.rules || []).filter(r => (r.allow || []).includes(me)).forEach(r => this.projectPaths().filter(p => matchGlob(r.pattern, p)).forEach(p => set.add(p)));
        (lsGet(WATCH_KEY, {}).mine || []).forEach(p => set.add(p));
        return set;
    };
    P.tmPoll = async function (now = Date.now()) {
        if (!this.tmHasGH()) return { comments: 0, edits: 0, delays: 0 };
        const st = lsGet(WATCH_KEY, {});
        const since = st.since || iso(now - DAY);
        const me = await this.tmMe();
        const res = { comments: 0, edits: 0, delays: 0 };
        // #740 — new comments anywhere in the repo (issues, PRs, channels)
        const comments = await this.tmGH(`/issues/comments?since=${encodeURIComponent(since)}&sort=created&direction=asc&per_page=50`).catch(() => []) || [];
        for (const c of comments) {
            if (!c || !c.user || c.user.login === me || new Date(c.created_at).getTime() <= new Date(since).getTime()) continue;
            const num = (/\/issues\/(\d+)$/.exec(c.issue_url || '') || [])[1];
            if (num && this.tmMuted && this.tmMuted().has(String(num))) continue;
            const mention = new RegExp('@' + me + '(?![\\w-])', 'i').test(c.body || '');
            if (this.tmInboxPush({ key: 'c' + c.id, kind: mention ? 'mention' : 'comment', title: `💬 ${mention ? 'ذكرك' : 'علّق'} ${c.user.login}${num ? ' على #' + num : ''}`, body: String(c.body || '').replace(/<!--[\s\S]*?-->/g, '').slice(0, 160), url: c.html_url, issue: num ? +num : null })) res.comments++;
        }
        // #745 — commits by others that touched files I own
        const commits = await this.tmGH(`/commits?since=${encodeURIComponent(since)}&per_page=20`).catch(() => []) || [];
        const others = commits.filter(c => ((c.author && c.author.login) || (c.commit && c.commit.author && c.commit.author.name)) !== me);
        if (others.length) {
            const mineCommits = commits.filter(c => c.author && c.author.login === me).slice(0, 5);
            const myFiles = [];
            for (const c of mineCommits) { const d = await this.tmGH(`/commits/${c.sha}`).catch(() => null); (d && d.files || []).forEach(f => myFiles.push(f.filename)); }
            const mine = this.tmMyFiles(myFiles);
            for (const c of others.slice(0, 8)) {
                const d = await this.tmGH(`/commits/${c.sha}`).catch(() => null);
                const hit = (d && d.files || []).map(f => f.filename).filter(p => mine.has(p));
                if (hit.length && this.tmInboxPush({ key: 'e' + c.sha, kind: 'edit', title: `✏️ ${(c.author && c.author.login) || 'زميل'} عدّل ملفك ${hit[0]}${hit.length > 1 ? ` (+${hit.length - 1})` : ''}`, body: (c.commit && c.commit.message || '').split('\n')[0], url: c.html_url, paths: hit })) res.edits++;
            }
        }
        // #798 — overdue / at-risk work
        if (this.tmDelayAlerts) { const al = await this.tmDelayAlerts({ now, quiet: true }).catch(() => []); res.delays = al.length; }
        lsSet(WATCH_KEY, { ...st, since: iso(now) });
        return res;
    };
    P.tmWatchStart = function (sec) {
        this.tmWatchStop();
        const t = this.tmTeam();
        const every = Math.max(30, +(sec || (t && t.settings && t.settings.pollSec) || 90));
        this._tmWatch = setInterval(() => { if (!document.hidden) this.tmPoll().catch(() => {}); }, every * 1000);
        lsSet(WATCH_KEY, { ...lsGet(WATCH_KEY, {}), on: true });
        return every;
    };
    P.tmWatchStop = function () { if (this._tmWatch) clearInterval(this._tmWatch); this._tmWatch = null; };
    P.tmWatchOff = function () { this.tmWatchStop(); lsSet(WATCH_KEY, { ...lsGet(WATCH_KEY, {}), on: false }); this.tmRefresh(); };
    P.tmWatchOn = function () { this.tmWatchStart(); this.showToast('🔔 مراقبة التعليقات والتعديلات مفعّلة', 'success'); this.tmRefresh(); };
    P.tmMarkMine = function (path, on = true) { const st = lsGet(WATCH_KEY, {}); const s = new Set(st.mine || []); if (on) s.add(path); else s.delete(path); lsSet(WATCH_KEY, { ...st, mine: [...s] }); return [...s]; };
}
