/* Team modes: voting mode — decide proposals by 👍/👎 with quorum + deadline (#806); competition mode — timed coding
   challenges run in the sandboxed runner, scored and ranked (#807); game mode — daily quests, XP and a bug-bash boss (#808). */
import { esc, call, callRaw, btn, pbtn, card, empty, field, area, select, val, setHTML, lsGet, lsSet, uid, table, bar, ago, fmtDate, readMarker, marker, DAY, dayKey, iso } from './util.js';

// ------------------------------------------------------------------ PURE
/** Proposal outcome: needs `quorum` voters; accepted when 👍 > 👎 (ties reject). */
export function decide(up, down, quorum = 2) {
    const n = up + down;
    if (n < quorum) return { state: 'pending', need: quorum - n, net: up - down };
    return { state: up > down ? 'accepted' : 'rejected', net: up - down };
}
export const CHALLENGES = [
    { id: 'fizzbuzz', title: 'FizzBuzz', level: 1, desc: 'أعد "Fizz" لمضاعفات 3 و"Buzz" لمضاعفات 5 و"FizzBuzz" لكليهما، وإلا الرقم كنص.', starter: 'function solve(n) {\n  \n}', tests: [[[3], 'Fizz'], [[5], 'Buzz'], [[15], 'FizzBuzz'], [[7], '7'], [[30], 'FizzBuzz']] },
    { id: 'palindrome', title: 'Palindrome', level: 1, desc: 'هل النص متناظر؟ تجاهل المسافات وحالة الأحرف.', starter: 'function solve(s) {\n  \n}', tests: [[['Racecar'], true], [['hello'], false], [['A man a plan a canal Panama'], true], [[''], true]] },
    { id: 'sumdigits', title: 'مجموع الأرقام', level: 1, desc: 'أعد مجموع أرقام العدد الصحيح الموجب.', starter: 'function solve(n) {\n  \n}', tests: [[[123], 6], [[0], 0], [[9999], 36], [[1001], 2]] },
    { id: 'anagram', title: 'Anagram', level: 2, desc: 'هل الكلمتان من نفس الحروف؟ (تجاهل حالة الأحرف)', starter: 'function solve(a, b) {\n  \n}', tests: [[['listen', 'silent'], true], [['Apple', 'Paple'], true], [['abc', 'abd'], false], [['aa', 'a'], false]] },
    { id: 'fib', title: 'Fibonacci', level: 2, desc: 'أعد العنصر رقم n من متتالية فيبوناتشي (fib(0)=0, fib(1)=1) — بكفاءة.', starter: 'function solve(n) {\n  \n}', tests: [[[0], 0], [[1], 1], [[10], 55], [[50], 12586269025]] },
    { id: 'maxsub', title: 'أكبر مجموع متتالي', level: 3, desc: 'أعد أكبر مجموع لمصفوفة جزئية متتالية (Kadane).', starter: 'function solve(arr) {\n  \n}', tests: [[[[-2, 1, -3, 4, -1, 2, 1, -5, 4]], 6], [[[1]], 1], [[[-3, -1, -2]], -1], [[[5, 4, -1, 7, 8]], 23]] },
    { id: 'roman', title: 'أرقام رومانية', level: 3, desc: 'حوّل عدداً (1-3999) إلى أرقام رومانية.', starter: 'function solve(n) {\n  \n}', tests: [[[3], 'III'], [[58], 'LVIII'], [[1994], 'MCMXCIV'], [[3999], 'MMMCMXCIX']] },
    { id: 'brackets', title: 'أقواس متوازنة', level: 2, desc: 'هل الأقواس ()[]{} متوازنة؟', starter: 'function solve(s) {\n  \n}', tests: [[['()[]{}'], true], [['([)]'], false], [['{[]}'], true], [['(('], false]] }
];
/** Worker script: user code + test harness → postMessage({type:'challenge', results}). Runs inside the sandboxed runner. */
export function buildChallengeScript(code, tests) {
    return `"use strict";
var __post = (typeof postMessage === 'function') ? function (m) { postMessage(m); } : (self.__oxPost || function () {});
var __results = [];
try {
${code}
;var __fn = (typeof solve === 'function') ? solve : null;
if (!__fn) throw new Error('عرّف دالة باسم solve');
var __tests = ${JSON.stringify(tests)};
var __eq = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
for (var __i = 0; __i < __tests.length; __i++) {
  var __t = __tests[__i], __t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now()), __got, __err = null;
  try { __got = __fn.apply(null, JSON.parse(JSON.stringify(__t[0]))); } catch (e) { __err = String(e && e.message || e); }
  var __ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - __t0;
  __results.push({ ok: !__err && __eq(__got, __t[1]), got: __err ? ('Error: ' + __err) : __got, expected: __t[1], ms: __ms });
}
__post({ type: 'challenge', results: __results });
} catch (e) { __post({ type: 'challenge', error: String(e && e.message || e), results: __results }); }
`;
}
/** Score: 100/test passed + speed bonus (≤50) when everything passes. */
export function scoreSubmission(results, elapsedMs) {
    const total = results.length, passed = results.filter(r => r.ok).length;
    const bonus = passed === total && total ? Math.max(0, Math.round(50 - elapsedMs / 6000)) : 0;
    return { passed, total, score: passed * 100 + bonus, bonus };
}
export const QUESTS = [
    { id: 'edit', icon: '✍️', label: 'عدّل ملفاً في المشروع', xp: 10 }, { id: 'task', icon: '✅', label: 'أنجز مهمة', xp: 20 }, { id: 'review', icon: '🔍', label: 'راجع طلب دمج', xp: 25 },
    { id: 'test', icon: '🧪', label: 'شغّل اختبارات ناجحة', xp: 20 }, { id: 'chat', icon: '💬', label: 'شارك في قناة الفريق', xp: 10 }, { id: 'reward', icon: '🎁', label: 'كافئ زميلاً', xp: 15 },
    { id: 'vote', icon: '🗳️', label: 'صوّت على مقترح أو تصويت', xp: 10 }, { id: 'share', icon: '🔗', label: 'شارك كوداً', xp: 10 }, { id: 'contest', icon: '🏆', label: 'حل تحدياً برمجياً', xp: 30 }
];
/** 3 deterministic quests per day (same for the whole team). */
export function dailyQuests(day) {
    let h = 0; for (const c of String(day)) h = (h * 33 + c.charCodeAt(0)) >>> 0;
    const pool = QUESTS.slice(), out = [];
    while (out.length < 3 && pool.length) { out.push(pool.splice(h % pool.length, 1)[0]); h = (h * 1103515245 + 12345) >>> 0; }
    return out;
}
/** Bug-bash boss: HP = bugs open at the start of the week; damage = bugs closed since. */
export function bossState(bugs, now = Date.now()) {
    const weekStart = now - 7 * DAY;
    const openAtStart = bugs.filter(b => new Date(b.created_at).getTime() < weekStart && (!b.closed_at || new Date(b.closed_at).getTime() >= weekStart)).length;
    const newOnes = bugs.filter(b => new Date(b.created_at).getTime() >= weekStart).length;
    const closed = bugs.filter(b => b.closed_at && new Date(b.closed_at).getTime() >= weekStart).length;
    const hp = openAtStart + newOnes;
    return { hp, damage: Math.min(hp, closed), left: Math.max(0, hp - closed), defeated: hp > 0 && closed >= hp };
}

export function installModes(P) {
    const LOCAL = 'ox_team_modes_v1';
    const store = (app) => { const all = lsGet(LOCAL, {}); return all[app.tmRepoKey()] || { proposals: [], scores: [] }; };
    const save = (app, st) => { const all = lsGet(LOCAL, {}); all[app.tmRepoKey()] = st; lsSet(LOCAL, all); };

    // ------------------------------------------------------------------ GAME EVENTS (feed quests)
    P.tmGameEvent = function (kind, n = 1) {
        const g = lsGet('ox_team_game_v1', { days: {}, claimed: {} });
        const d = dayKey(Date.now());
        g.days[d] = g.days[d] || {}; g.days[d][kind] = (g.days[d][kind] || 0) + n;
        Object.keys(g.days).sort().slice(0, -14).forEach(k => delete g.days[k]);
        lsSet('ox_team_game_v1', g);
        return g.days[d][kind];
    };

    // ------------------------------------------------------------------ VOTING MODE (#806)
    P.tmProposals = async function () {
        if (!this.tmHasGH()) return store(this).proposals;
        const issues = await this.tmGH('/issues?labels=ox-proposal&state=all&per_page=50') || [];
        return issues.map(i => { const m = readMarker('proposal', i.body) || {}; return { id: i.number, title: String(i.title || '').replace(/^🗳️\s*/, ''), body: String(i.body || '').replace(/<!--[\s\S]*?-->/g, '').trim(), up: (i.reactions && i.reactions['+1']) || 0, down: (i.reactions && i.reactions['-1']) || 0, quorum: m.quorum || 2, deadline: m.deadline || 0, closed: i.state === 'closed', outcome: (i.labels || []).map(l => l.name || l).find(n => /^(accepted|rejected)$/.test(n)) || null, by: i.user && i.user.login }; });
    };
    P.tmPropose = async function ({ title, body = '', quorum = 2, days = 3 } = {}) {
        if (!title) { this.showToast('اكتب عنوان المقترح', 'warning'); return null; }
        const meta = { quorum: Math.max(1, +quorum || 2), deadline: days > 0 ? Date.now() + days * DAY : 0 };
        if (this.tmHasGH()) {
            await this.tmEnsureLabel('ox-proposal', 'fef2c0', 'Team proposal (voting mode)');
            const i = await this.tmGH('/issues', { method: 'POST', body: { title: '🗳️ ' + title, body: `${body}\n\nصوّتوا بـ 👍 أو 👎 على هذا الـ Issue.\n\n${marker('proposal', meta)}`, labels: ['ox-proposal'] } });
            return { id: i.number, title, up: 0, down: 0, ...meta };
        }
        const st = store(this); const p = { id: uid('pr'), title, body, up: 0, down: 0, votes: {}, ...meta, by: this.tmMeSync() };
        st.proposals.unshift(p); save(this, st); return p;
    };
    P.tmVoteProposal = async function (id, dir = 'up') {
        const me = await this.tmMe();
        if (this.tmHasGH()) {
            const content = dir === 'up' ? '+1' : '-1', other = dir === 'up' ? '-1' : '+1';
            const mine = ((await this.tmGH(`/issues/${+id}/reactions?per_page=100`).catch(() => [])) || []).filter(r => r.user && r.user.login === me && r.content === other);
            for (const r of mine) await this.tmGH(`/issues/${+id}/reactions/${r.id}`, { method: 'DELETE' }).catch(() => {});
            await this.tmGH(`/issues/${+id}/reactions`, { method: 'POST', body: { content } });
        } else {
            const st = store(this); const p = st.proposals.find(x => x.id === id); if (!p) return null;
            p.votes = { ...(p.votes || {}), [me]: dir };
            p.up = Object.values(p.votes).filter(v => v === 'up').length; p.down = Object.values(p.votes).filter(v => v === 'down').length;
            save(this, st);
        }
        this.tmGameEvent('vote');
        if (document.getElementById('tmx-sec')) this.tmRefresh();
        return dir;
    };
    P.tmCloseProposal = async function (id) {
        const list = await this.tmProposals();
        const p = list.find(x => String(x.id) === String(id)); if (!p) return null;
        const d = decide(p.up, p.down, p.quorum);
        const outcome = d.state === 'pending' ? 'rejected' : d.state;
        if (this.tmHasGH()) {
            await this.tmEnsureLabel(outcome, outcome === 'accepted' ? '0e8a16' : 'b60205', 'Voting outcome');
            await this.tmGH(`/issues/${+id}/labels`, { method: 'POST', body: { labels: [outcome] } }).catch(() => {});
            await this.tmGH(`/issues/${+id}/comments`, { method: 'POST', body: { body: `${outcome === 'accepted' ? '✅ قُبل' : '❌ رُفض'} المقترح بنتيجة 👍 ${p.up} / 👎 ${p.down}` } }).catch(() => {});
            await this.tmGH(`/issues/${+id}`, { method: 'PATCH', body: { state: 'closed', state_reason: outcome === 'accepted' ? 'completed' : 'not_planned' } });
        } else { const st = store(this); const q = st.proposals.find(x => x.id === id); if (q) { q.closed = true; q.outcome = outcome; } save(this, st); }
        if (outcome === 'accepted' && this.addTask) this.addTask(p.title, { notes: 'مقترح مقبول بالتصويت' });
        if (document.getElementById('tmx-sec')) this.tmRefresh();
        return outcome;
    };
    P.tmVoteMode = async function () {
        const list = await this.tmProposals();
        const now = Date.now();
        // Auto-close proposals past their deadline
        for (const p of list) if (!p.closed && p.deadline && now > p.deadline) { await this.tmCloseProposal(p.id).catch(() => {}); p.closed = true; }
        const open = list.filter(p => !p.closed).sort((a, b) => (b.up - b.down) - (a.up - a.down));
        const done = list.filter(p => p.closed);
        const row = (p) => { const d = decide(p.up, p.down, p.quorum); return `<div class="tmx-proposal"><div class="tmx-vote-box">${btn('fa-thumbs-up', String(p.up), call('tmVoteProposal', p.id, 'up'))}${btn('fa-thumbs-down', String(p.down), call('tmVoteProposal', p.id, 'down'))}</div><div><b>${esc(p.title)}</b>${p.body ? `<div><small>${esc(p.body).slice(0, 200)}</small></div>` : ''}<small>${d.state === 'pending' ? `يحتاج ${d.need} صوت للنصاب` : d.state === 'accepted' ? '🟢 يتجه للقبول' : '🔴 يتجه للرفض'}${p.deadline ? ' • ينتهي ' + fmtDate(p.deadline) : ''}</small></div>${btn('fa-gavel', 'حسم', call('tmCloseProposal', p.id))}</div>`; };
        return card('مقترح جديد للتصويت', `<div class="gh-row">${field('tm-pp-title', 'المقترح', '', 'placeholder="اعتماد TypeScript في المشروع"')}${field('tm-pp-q', 'النصاب', 2, 'type="number" min="1"')}${field('tm-pp-days', 'المدة (أيام)', 3, 'type="number" min="0"')}${pbtn('fa-plus', 'طرح', call('tmProposeUI'))}</div>${area('tm-pp-body', 'التفاصيل', '', 2)}`, 'fa-check-to-slot')
            + card('قيد التصويت', open.map(row).join('') || empty('لا مقترحات مفتوحة'), 'fa-scale-balanced')
            + card('القرارات', done.map(p => `<div class="gh-item"><span>${p.outcome === 'accepted' ? '✅' : '❌'} ${esc(p.title)}</span><small>👍 ${p.up} / 👎 ${p.down}</small></div>`).join('') || empty('لا قرارات بعد'), 'fa-gavel');
    };
    P.tmProposeUI = async function () { const p = await this.tmPropose({ title: val('tm-pp-title'), body: val('tm-pp-body'), quorum: +val('tm-pp-q'), days: +val('tm-pp-days') }).catch(e => this.tmErr(e)); if (p) this.tmRefresh(); return p; };

    // ------------------------------------------------------------------ COMPETITION MODE (#807)
    /** Run a script in the sandboxed runner (iframe + worker) and resolve with its 'challenge' message. */
    P.tmSandboxRun = async function (script, timeoutMs = 8000) {
        if (!this.createRunSandbox || this.createRunSandbox.__oxLazy) await this.loadChunk('runner');
        return new Promise((resolve) => {
            const sb = this.createRunSandbox();
            const timer = setTimeout(() => { try { sb.stop(); } catch (e) {} resolve({ error: 'Timeout — هل توجد حلقة لا نهائية؟', results: [] }); }, timeoutMs);
            sb.start(script, (m) => {
                if (!m) return;
                if (m.type === 'challenge') { clearTimeout(timer); try { sb.stop(); } catch (e) {} resolve(m); }
                else if (m.type === 'fatal' || m.type === 'error') { clearTimeout(timer); try { sb.stop(); } catch (e) {} resolve({ error: (m.error && m.error.message) || m.message || 'خطأ', results: [] }); }
            });
        });
    };
    P.tmRunChallenge = async function (id, code) {
        const ch = CHALLENGES.find(c => c.id === id) || (lsGet('ox_team_custom_ch_v1', [])).find(c => c.id === id);
        if (!ch) return null;
        const started = (this._tmContest && this._tmContest.id === id && this._tmContest.started) || Date.now();
        const r = await this.tmSandboxRun(buildChallengeScript(code, ch.tests));
        const elapsed = Date.now() - started;
        const sc = scoreSubmission(r.results || [], elapsed);
        const res = { challenge: id, ...sc, elapsed, error: r.error || null, results: r.results || [] };
        this._tmContestLast = res;
        return res;
    };
    P.tmSubmitScore = async function (res = this._tmContestLast) {
        if (!res) return null;
        const me = await this.tmMe();
        const entry = { challenge: res.challenge, passed: res.passed, total: res.total, score: res.score, elapsed: res.elapsed, t: Date.now() };
        if (this.tmHasGH()) {
            const title = `🏆 مسابقة: ${res.challenge}`;
            let issue = ((await this.tmGH('/issues?labels=ox-contest&state=open&per_page=50').catch(() => [])) || []).find(i => i.title === title);
            if (!issue) { await this.tmEnsureLabel('ox-contest', 'f9d0c4', 'Coding contest'); issue = await this.tmGH('/issues', { method: 'POST', body: { title, body: `تحدي ${res.challenge} — أرسل حلك من «أوضاع الفريق ← المسابقة».`, labels: ['ox-contest'] } }); }
            await this.tmGH(`/issues/${issue.number}/comments`, { method: 'POST', body: { body: `🏁 ${res.passed}/${res.total} — ${res.score} نقطة في ${Math.round(res.elapsed / 1000)}ث ${marker('score', entry)}` } });
        } else { const st = store(this); st.scores.push({ ...entry, user: me }); save(this, st); }
        this.tmGameEvent('contest');
        if (res.passed === res.total && this.addXP) this.addXP(30, 'contest');
        this.showToast(`🏆 سُجّلت نتيجتك: ${res.score} نقطة`, 'success');
        return entry;
    };
    P.tmContestBoard = async function (id) {
        let rows = [];
        if (this.tmHasGH()) {
            const issue = ((await this.tmGH('/issues?labels=ox-contest&state=open&per_page=50').catch(() => [])) || []).find(i => i.title === `🏆 مسابقة: ${id}`);
            if (issue) rows = ((await this.tmList(`${this.ghRepoPath()}/issues/${issue.number}/comments`, { max: 300 }).catch(() => [])) || []).map(c => ({ user: c.user && c.user.login, ...(readMarker('score', c.body) || {}) })).filter(r => r.score != null);
        } else rows = store(this).scores.filter(s => s.challenge === id);
        const best = new Map();
        rows.forEach(r => { const b = best.get(r.user); if (!b || r.score > b.score || (r.score === b.score && r.elapsed < b.elapsed)) best.set(r.user, r); });
        return [...best.values()].sort((a, b) => b.score - a.score || a.elapsed - b.elapsed);
    };
    P.tmContest = async function (opts = {}) {
        const custom = lsGet('ox_team_custom_ch_v1', []);
        const all = [...CHALLENGES, ...custom];
        const id = opts.id || (this._tmContest && this._tmContest.id) || all[0].id;
        const ch = all.find(c => c.id === id) || all[0];
        if (!this._tmContest || this._tmContest.id !== ch.id) this._tmContest = { id: ch.id, started: Date.now() };
        const board = await this.tmContestBoard(ch.id);
        return card('اختر التحدي', `<div class="gh-row">${all.map(c => `<button class="gh-chip ${c.id === ch.id ? 'active' : ''}" onclick="${call('tmLoad', 'modes', 'contest', { id: c.id })}">${'⭐'.repeat(c.level || 1)} ${esc(c.title)}</button>`).join('')}</div>`, 'fa-trophy')
            + card(esc(ch.title), `<p>${esc(ch.desc)}</p><div class="tmx-note">⏱ بدأ المؤقت ${ago(this._tmContest.started)} — السرعة تمنح حتى 50 نقطة إضافية. ${ch.tests.length} اختبار مخفي النتائج حتى التشغيل.</div>
                ${area('tm-ct-code', 'حلك (JavaScript)', (lsGet('ox_team_ct_draft_v1', {})[ch.id]) || ch.starter, 8, `dir="ltr" spellcheck="false" oninput="app.tmContestDraft('${ch.id}', this.value)"`)}
                <div class="gh-row">${pbtn('fa-play', 'تشغيل الاختبارات', call('tmRunChallengeUI', ch.id))}${btn('fa-flag-checkered', 'إرسال النتيجة', call('tmSubmitScoreUI'))}${btn('fa-rotate-left', 'إعادة المؤقت', call('tmContestRestart', ch.id))}</div><div id="tm-ct-out"></div>`, 'fa-code')
            + card('ترتيب المتسابقين', board.length ? table(['#', 'المتسابق', 'الاختبارات', 'النقاط', 'الوقت'], board.map((r, i) => [['🥇', '🥈', '🥉'][i] || i + 1, '@' + esc(r.user), `${r.passed}/${r.total}`, `<b>${r.score}</b>`, Math.round((r.elapsed || 0) / 1000) + 'ث'])) : empty('كن أول من يحل هذا التحدي!'), 'fa-ranking-star')
            + card('تحدٍ مخصص للفريق', `<div class="gh-row">${field('tm-cc-title', 'العنوان', '')}${field('tm-cc-desc', 'الوصف', '')}</div>${area('tm-cc-tests', 'الاختبارات JSON: [[[args], expected], …]', '[[[1, 2], 3], [[5, 5], 10]]', 2, 'dir="ltr"')}<div class="gh-row">${btn('fa-plus', 'إضافة التحدي', call('tmAddChallengeUI'))}${btn('fa-robot', 'ولّد تحدياً بالذكاء', call('tmAIChallenge'))}</div>`, 'fa-wand-magic-sparkles');
    };
    P.tmContestDraft = function (id, code) { const d = lsGet('ox_team_ct_draft_v1', {}); d[id] = code; lsSet('ox_team_ct_draft_v1', d); };
    P.tmContestRestart = function (id) { this._tmContest = { id, started: Date.now() }; return this.tmRefresh(); };
    P.tmRunChallengeUI = async function (id) {
        this.tmBusy('tm-ct-out', 'جارٍ التشغيل في بيئة معزولة…');
        const r = await this.tmRunChallenge(id, val('tm-ct-code'));
        if (!r) return null;
        setHTML('tm-ct-out', `${r.error ? empty('❌ ' + esc(r.error), true) : ''}<div class="fmx-score"><b>${r.score}</b> نقطة • ${r.passed}/${r.total} اختبار${r.bonus ? ` • ⚡ +${r.bonus} سرعة` : ''}</div>${r.results.map((x, i) => `<div class="gh-item">${x.ok ? '✅' : '❌'} اختبار ${i + 1}<small dir="ltr">${x.ok ? x.ms.toFixed(2) + 'ms' : `got ${esc(JSON.stringify(x.got))} • expected ${esc(JSON.stringify(x.expected))}`}</small></div>`).join('')}`);
        if (r.passed === r.total && r.total && this.confetti) this.confetti({ count: 50 });
        return r;
    };
    P.tmSubmitScoreUI = async function () { const e = await this.tmSubmitScore().catch(err => this.tmErr(err)); if (e) this.tmRefresh(); return e; };
    P.tmAddChallenge = function ({ title, desc, tests }) {
        let parsed; try { parsed = typeof tests === 'string' ? JSON.parse(tests) : tests; } catch (e) { this.showToast('صيغة الاختبارات غير صالحة', 'error'); return null; }
        if (!title || !Array.isArray(parsed) || !parsed.length) { this.showToast('أكمل العنوان والاختبارات', 'warning'); return null; }
        const ch = { id: 'c-' + uid(''), title, desc: desc || '', level: 2, starter: 'function solve(...args) {\n  \n}', tests: parsed };
        lsSet('ox_team_custom_ch_v1', [...lsGet('ox_team_custom_ch_v1', []), ch]);
        return ch;
    };
    P.tmAddChallengeUI = function () { const ch = this.tmAddChallenge({ title: val('tm-cc-title'), desc: val('tm-cc-desc'), tests: val('tm-cc-tests') }); if (ch) this.tmLoad('modes', 'contest', { id: ch.id }); return ch; };
    P.tmAIChallenge = async function () {
        const r = await this.tmAI('Create one short JavaScript coding challenge for a developer team contest. Return JSON {"title": "Arabic title", "desc": "Arabic description; the function must be named solve", "tests": [[[args...], expected], ...5 tests]}', { json: true, kind: 'coding' });
        if (!r) return null;
        const ch = this.tmAddChallenge(r);
        if (ch) this.tmLoad('modes', 'contest', { id: ch.id });
        return ch;
    };

    // ------------------------------------------------------------------ GAME MODE (#808)
    P.tmQuestProgress = function (now = Date.now(), runs = this._tmRuns || this._runHistory || []) {
        const d = dayKey(now), g = lsGet('ox_team_game_v1', { days: {}, claimed: {} }), ev = g.days[d] || {};
        const from = new Date(d + 'T00:00:00Z').getTime();
        const derived = {
            edit: (this.activityLog || []).filter(a => a.t >= from && a.op === 'edit').length,
            task: (this.tasks || []).filter(t => t.status === 'done' && (t.done || 0) >= from).length,
            test: runs.filter(r => r.mode === 'test' && r.success && (r.at || 0) >= from).length
        };
        return dailyQuests(d).map(q => ({ ...q, done: ((ev[q.id] || 0) + (derived[q.id] || 0)) > 0, claimed: !!(g.claimed[d] || {})[q.id] }));
    };
    P.tmClaimQuest = function (id) {
        const d = dayKey(Date.now());
        const q = this.tmQuestProgress().find(x => x.id === id);
        if (!q || !q.done || q.claimed) return 0;
        const g = lsGet('ox_team_game_v1', { days: {}, claimed: {} });
        g.claimed[d] = { ...(g.claimed[d] || {}), [id]: true };
        lsSet('ox_team_game_v1', g);
        if (this.addXP) this.addXP(q.xp, 'quest');
        if (this.confetti) this.confetti({ count: 40 });
        if (document.getElementById('tmx-sec')) this.tmRefresh();
        return q.xp;
    };
    P.tmGame = async function () {
        await this._runHistQ; // pending history writes land first
        try { this._tmRuns = (this.idbGet && (await this.idbGet('run_history_v1'))) || []; } catch (e) { this._tmRuns = []; }
        const quests = this.tmQuestProgress();
        const info = this.progressInfo ? this.progressInfo() : null;
        let bugs = [];
        if (this.tmHasGH()) bugs = ((await this.tmGH(`/issues?labels=bug&state=all&since=${encodeURIComponent(iso(Date.now() - 30 * DAY))}&per_page=100`).catch(() => [])) || []).filter(i => !i.pull_request);
        else bugs = (this.tasks || []).filter(t => /bug|خطأ|إصلاح/i.test(t.title)).map(t => ({ created_at: iso(t.created), closed_at: t.status === 'done' && t.done ? iso(t.done) : null }));
        const boss = bossState(bugs);
        const lb = leaderboardLite(this);
        return card('مهام اليوم', quests.map(q => `<div class="tmx-quest ${q.done ? 'done' : ''}"><span>${q.icon} ${esc(q.label)}</span><small>+${q.xp} XP</small>${q.claimed ? '<span class="fmx-tag">✔ استُلمت</span>' : q.done ? pbtn('fa-gift', 'استلم', call('tmClaimQuest', q.id)) : '<span class="fmx-tag">⏳</span>'}</div>`).join(''), 'fa-scroll')
            + card('👾 زعيم الأخطاء الأسبوعي', boss.hp ? `<div class="tmx-boss">${boss.defeated ? '🏆 هُزم الزعيم! أحسنتم' : `HP ${boss.left}/${boss.hp}`}</div>${bar(boss.left, boss.hp, 'HP', '#ef4444')}<div class="tmx-note">كل خطأ يُغلق هذا الأسبوع = ضربة للزعيم (${boss.damage} ضربة حتى الآن).</div>` : empty('لا أخطاء مفتوحة — الزعيم نائم 😴'), 'fa-dragon')
            + (info ? card('مستواك', `<div class="fmx-score"><b>Lv ${info.level}</b> ${info.xp} XP</div>${bar(info.xp - info.cur, Math.max(1, info.next - info.cur), 'XP')}<small>${info.next - info.xp} XP للمستوى التالي</small>`, 'fa-star') : '')
            + card('أبطال اليوم', lb || empty('—'), 'fa-crown');
    };
    function leaderboardLite(app) {
        const g = lsGet('ox_team_game_v1', { days: {} }); const d = g.days[dayKey(Date.now())] || {};
        const entries = Object.entries(d).filter(([, n]) => n > 0);
        return entries.length ? entries.map(([k, n]) => { const q = QUESTS.find(x => x.id === k); return `<span class="fmx-tag">${q ? q.icon : '•'} ${esc(q ? q.label : k)} ×${n}</span>`; }).join('') : '';
    }
}
