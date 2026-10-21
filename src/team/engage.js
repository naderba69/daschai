/* Team engagement: polls (#757), surveys (#758), calendar + ICS (#760), team leaderboard (#769), rewards (#770),
   template marketplace (#738). GitHub-backed (issues/comments, team.json) with a local fallback. */
import { esc, call, callRaw, btn, pbtn, card, empty, field, area, select, val, setHTML, lsGet, lsSet, uid, stats, table, bar, ago, fmtDate, readMarker, marker, stripMarkers, DAY, iso, win } from './util.js';

// ------------------------------------------------------------------ PURE
/** Latest vote per user wins. votes: [{user, c:[idx…], t}] */
export function tallyPoll(options, votes) {
    const last = new Map();
    (votes || []).slice().sort((a, b) => (a.t || 0) - (b.t || 0)).forEach(v => last.set(v.user, v));
    const counts = options.map(() => 0);
    last.forEach(v => (v.c || []).forEach(i => { if (i >= 0 && i < counts.length) counts[i]++; }));
    const voters = last.size;
    const max = Math.max(0, ...counts);
    return { counts, voters, pct: counts.map(n => (voters ? Math.round(n / voters * 100) : 0)), winners: max ? counts.map((n, i) => (n === max ? i : -1)).filter(i => i >= 0) : [], byUser: Object.fromEntries([...last].map(([u, v]) => [u, v.c])) };
}
/** Survey answers: [{user, a:[…]}] → per question summary. */
export function aggregateSurvey(questions, answers) {
    const last = new Map(); (answers || []).forEach(x => last.set(x.user, x));
    const rows = [...last.values()];
    return questions.map((q, i) => {
        const vals = rows.map(r => (r.a || [])[i]).filter(v => v != null && v !== '');
        if (q.type === 'choice') { const counts = (q.options || []).map((_, k) => vals.filter(v => +v === k).length); return { q: q.q, type: q.type, counts, n: vals.length }; }
        if (q.type === 'rating') { const nums = vals.map(Number).filter(n => n >= 1 && n <= 5); return { q: q.q, type: q.type, avg: nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length * 10) / 10 : 0, n: nums.length, dist: [1, 2, 3, 4, 5].map(s => nums.filter(n => n === s).length) }; }
        return { q: q.q, type: 'text', texts: vals.map(String), n: vals.length };
    });
}
export function surveyCSV(questions, answers) {
    const cell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const head = ['user', ...questions.map(q => q.q)].map(cell).join(',');
    return [head, ...answers.map(a => [a.user, ...questions.map((q, i) => { const v = (a.a || [])[i]; return q.type === 'choice' && v != null && v !== '' ? (q.options || [])[+v] : v; })].map(cell).join(','))].join('\n') + '\n';
}
const icsDate = (t, allDay) => { const d = new Date(t); return allDay ? d.toISOString().slice(0, 10).replace(/-/g, '') : d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); };
const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => '\\' + c);
/** RFC 5545 calendar file. */
export function toICS(events, name = 'OX-Alpha Team') {
    const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OX-Alpha Workbench Pro//Team//AR', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsEsc(name)}`];
    for (const e of events) {
        const allDay = !!e.allDay;
        const end = e.end || (allDay ? e.start + DAY : e.start + 36e5);
        out.push('BEGIN:VEVENT', `UID:${icsEsc(e.id || uid('ev'))}@ox-alpha`, `DTSTAMP:${icsDate(Date.now())}`, allDay ? `DTSTART;VALUE=DATE:${icsDate(e.start, true)}` : `DTSTART:${icsDate(e.start)}`, allDay ? `DTEND;VALUE=DATE:${icsDate(end, true)}` : `DTEND:${icsDate(end)}`, `SUMMARY:${icsEsc(e.title)}`);
        if (e.desc) out.push(`DESCRIPTION:${icsEsc(e.desc)}`);
        out.push('END:VEVENT');
    }
    out.push('END:VCALENDAR');
    return out.join('\r\n') + '\r\n';
}
/** Month grid (weeks start Saturday for Arabic locales by default → configurable). */
export function monthGrid(year, month, events = [], weekStart = 6) {
    const first = new Date(Date.UTC(year, month, 1));
    const offset = (first.getUTCDay() - weekStart + 7) % 7;
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(null);
    for (let d = 1; d <= days; d++) {
        const from = Date.UTC(year, month, d), to = from + DAY;
        cells.push({ d, from, events: events.filter(e => e.start < to && (e.end || e.start + 1) > from) });
    }
    while (cells.length % 7) cells.push(null);
    return cells;
}
export const SCORE = { commits: 10, prs: 25, reviews: 15, issues: 8, comments: 2, xp: 0.1, rewards: 1 };
/** Rank members by a weighted score. stats: {login: {commits, prs, reviews, issues, comments, rewards}} */
export function leaderboard(statsByLogin, weights = SCORE) {
    return Object.entries(statsByLogin).map(([login, s]) => ({ login, ...s, score: Math.round(Object.entries(weights).reduce((n, [k, w]) => n + (s[k] || 0) * w, 0)) }))
        .sort((a, b) => b.score - a.score || a.login.localeCompare(b.login)).map((r, i) => ({ ...r, rank: i + 1, medal: ['🥇', '🥈', '🥉'][i] || '' }));
}
export const BADGES = [
    { id: 'kudos', emoji: '👏', label: 'شكراً', points: 10 }, { id: 'bugslayer', emoji: '🐛', label: 'صائد الأخطاء', points: 30 }, { id: 'reviewer', emoji: '🔍', label: 'مراجع ممتاز', points: 25 },
    { id: 'helper', emoji: '🤝', label: 'روح الفريق', points: 20 }, { id: 'shipper', emoji: '🚀', label: 'أطلق ميزة', points: 40 }, { id: 'mentor', emoji: '🎓', label: 'مُعلّم', points: 30 },
    { id: 'tests', emoji: '🧪', label: 'بطل الاختبارات', points: 25 }, { id: 'docs', emoji: '📚', label: 'كاتب التوثيق', points: 15 }
];

export function installEngage(P) {
    const LOCAL = 'ox_team_engage_v1';
    const localStore = (app) => { const all = lsGet(LOCAL, {}); return all[app.tmRepoKey()] || { polls: [], surveys: [], events: [] }; };
    const saveStore = (app, st) => { const all = lsGet(LOCAL, {}); all[app.tmRepoKey()] = st; lsSet(LOCAL, all); };

    // ------------------------------------------------------------------ POLLS (#757)
    P.tmPollList = async function () {
        if (!this.tmHasGH()) return localStore(this).polls;
        const issues = await this.tmGH('/issues?labels=ox-poll&state=all&per_page=30') || [];
        const out = [];
        for (const i of issues) {
            const meta = readMarker('poll', i.body); if (!meta) continue;
            const comments = i.comments ? await this.tmList(`${this.ghRepoPath()}/issues/${i.number}/comments`, { max: 300 }).catch(() => []) : [];
            out.push({ id: i.number, q: String(i.title || '').replace(/^📊\s*/, ''), options: meta.options, multi: !!meta.multi, closes: meta.closes || 0, closed: i.state === 'closed', by: i.user && i.user.login, t: new Date(i.created_at).getTime(), votes: comments.map(c => ({ user: c.user && c.user.login, c: (readMarker('vote', c.body) || {}).c, t: new Date(c.created_at).getTime() })).filter(v => v.c) });
        }
        return out;
    };
    P.tmCreatePoll = async function ({ q, options, multi = false, days = 0 } = {}) {
        options = (options || []).map(s => String(s).trim()).filter(Boolean);
        if (!q || options.length < 2) { this.showToast('اكتب سؤالاً وخيارين على الأقل', 'warning'); return null; }
        const meta = { options, multi: !!multi, closes: days > 0 ? Date.now() + days * DAY : 0 };
        if (this.tmHasGH()) {
            await this.tmEnsureLabel('ox-poll', 'c5def5', 'Team poll');
            const i = await this.tmGH('/issues', { method: 'POST', body: { title: '📊 ' + q, body: `${options.map((o, k) => `${k + 1}. ${o}`).join('\n')}\n\nصوّت من «الفريق ← تصويت» في OX-Alpha.\n\n${marker('poll', meta)}`, labels: ['ox-poll'] } });
            return { id: i.number, q, ...meta, votes: [] };
        }
        const st = localStore(this); const p = { id: uid('poll'), q, ...meta, votes: [], by: this.tmMeSync(), t: Date.now() };
        st.polls.unshift(p); saveStore(this, st); return p;
    };
    P.tmVote = async function (id, choices) {
        choices = [].concat(choices).map(Number);
        const me = await this.tmMe();
        if (this.tmHasGH()) await this.tmGH(`/issues/${+id}/comments`, { method: 'POST', body: { body: `🗳️ صوّت ${marker('vote', { c: choices })}` } });
        else { const st = localStore(this); const p = st.polls.find(x => x.id === id); if (!p) return null; p.votes.push({ user: me, c: choices, t: Date.now() }); saveStore(this, st); }
        if (this.addXP) this.addXP(2, 'vote');
        if (document.getElementById('tmx-sec')) this.tmRefresh();
        return choices;
    };
    P.tmClosePoll = async function (id) {
        if (this.tmHasGH()) await this.tmGH(`/issues/${+id}`, { method: 'PATCH', body: { state: 'closed' } });
        else { const st = localStore(this); const p = st.polls.find(x => x.id === id); if (p) p.closed = true; saveStore(this, st); }
        return this.tmRefresh();
    };
    P.tmPolls = async function () {
        const polls = await this.tmPollList();
        const me = this.tmMeSync();
        const html = polls.map(p => {
            const r = tallyPoll(p.options, p.votes);
            const closed = p.closed || (p.closes && Date.now() > p.closes);
            const mine = r.byUser[me] || [];
            return `<div class="tmx-poll"><div class="tmx-msg-h"><b>📊 ${esc(p.q)}</b> <small>${r.voters} مصوّت${p.closes ? ' • ' + (closed ? 'مغلق' : 'يغلق ' + fmtDate(p.closes)) : ''}</small></div>
                ${p.options.map((o, i) => `<div class="tmx-opt ${r.winners.includes(i) && closed ? 'win' : ''}">${closed ? '' : `<input type="${p.multi ? 'checkbox' : 'radio'}" name="tm-poll-${esc(p.id)}" value="${i}" ${mine.includes(i) ? 'checked' : ''}>`} <span>${esc(o)}</span> ${bar(r.counts[i], Math.max(1, r.voters))} <small>${r.counts[i]} (${r.pct[i]}%)</small></div>`).join('')}
                ${closed ? '' : `<div class="gh-row">${pbtn('fa-check-to-slot', 'صوّت', callRaw('tmVote', [p.id], `Array.from(document.querySelectorAll('input[name="tm-poll-${String(p.id).replace(/[^\w-]/g, '')}"]:checked')).map(x => +x.value)`))}${p.by === me ? btn('fa-lock', 'إغلاق', call('tmClosePoll', p.id)) : ''}</div>`}</div>`;
        }).join('');
        return card('تصويت جديد', `${field('tm-poll-q', 'السؤال', '')}${area('tm-poll-opts', 'الخيارات (سطر لكل خيار)', '', 3)}<div class="gh-row">${select('tm-poll-multi', 'النوع', [['0', 'خيار واحد'], ['1', 'خيارات متعددة']], '0')}${field('tm-poll-days', 'يغلق بعد (أيام، 0 = يدوياً)', 0, 'type="number" min="0"')}${pbtn('fa-square-poll-vertical', 'نشر', call('tmCreatePollUI'))}</div>`, 'fa-square-poll-vertical')
            + card('التصويتات', html || empty('لا تصويتات بعد'), 'fa-list');
    };
    P.tmCreatePollUI = async function () { const p = await this.tmCreatePoll({ q: val('tm-poll-q'), options: val('tm-poll-opts').split('\n'), multi: val('tm-poll-multi') === '1', days: +val('tm-poll-days') }).catch(e => this.tmErr(e)); if (p) this.tmRefresh(); return p; };

    // ------------------------------------------------------------------ SURVEYS (#758)
    P.tmSurveyList = async function () {
        if (!this.tmHasGH()) return localStore(this).surveys;
        const issues = await this.tmGH('/issues?labels=ox-survey&state=all&per_page=20') || [];
        const out = [];
        for (const i of issues) {
            const meta = readMarker('survey', i.body); if (!meta) continue;
            const comments = i.comments ? await this.tmList(`${this.ghRepoPath()}/issues/${i.number}/comments`, { max: 300 }).catch(() => []) : [];
            out.push({ id: i.number, title: String(i.title || '').replace(/^📝\s*/, ''), questions: meta.questions, closed: i.state === 'closed', by: i.user && i.user.login, answers: comments.map(c => ({ user: c.user && c.user.login, a: (readMarker('answer', c.body) || {}).a })).filter(x => x.a) });
        }
        return out;
    };
    /** questions text: one per line — "سؤال؟ | خيار1 | خيار2" (choice), "سؤال؟ *" (rating 1-5), else free text. */
    P.tmParseSurvey = function (text) {
        return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
            if (l.includes('|')) { const [q, ...opts] = l.split('|').map(s => s.trim()); return { q, type: 'choice', options: opts.filter(Boolean) }; }
            if (/\*\s*$/.test(l)) return { q: l.replace(/\*\s*$/, '').trim(), type: 'rating' };
            return { q: l, type: 'text' };
        });
    };
    P.tmCreateSurvey = async function ({ title, questions } = {}) {
        if (!title || !(questions || []).length) { this.showToast('اكتب عنواناً وسؤالاً واحداً على الأقل', 'warning'); return null; }
        if (this.tmHasGH()) {
            await this.tmEnsureLabel('ox-survey', 'bfd4f2', 'Team survey');
            const i = await this.tmGH('/issues', { method: 'POST', body: { title: '📝 ' + title, body: `${questions.map((q, k) => `${k + 1}. ${q.q}`).join('\n')}\n\nأجب من «الفريق ← استطلاعات» في OX-Alpha.\n\n${marker('survey', { questions })}`, labels: ['ox-survey'] } });
            return { id: i.number, title, questions, answers: [] };
        }
        const st = localStore(this); const s = { id: uid('sv'), title, questions, answers: [], by: this.tmMeSync(), t: Date.now() };
        st.surveys.unshift(s); saveStore(this, st); return s;
    };
    P.tmAnswerSurvey = async function (id, answers) {
        const me = await this.tmMe();
        if (this.tmHasGH()) await this.tmGH(`/issues/${+id}/comments`, { method: 'POST', body: { body: `✅ أجاب على الاستطلاع ${marker('answer', { a: answers })}` } });
        else { const st = localStore(this); const s = st.surveys.find(x => x.id === id); if (!s) return null; s.answers = s.answers.filter(a => a.user !== me).concat({ user: me, a: answers }); saveStore(this, st); }
        this.showToast('✅ شكراً على إجابتك', 'success');
        if (document.getElementById('tmx-sec')) this.tmRefresh();
        return answers;
    };
    P.tmSurveys = async function () {
        const list = await this.tmSurveyList();
        this._tmSurveys = list;
        const me = this.tmMeSync();
        const html = list.map(s => {
            const agg = aggregateSurvey(s.questions, s.answers);
            const answered = s.answers.some(a => a.user === me);
            const sid = String(s.id).replace(/[^\w-]/g, '');
            const form = s.questions.map((q, i) => q.type === 'choice' ? select(`tm-sv-${sid}-${i}`, esc(q.q), [['', '—'], ...q.options.map((o, k) => [String(k), o])], '') : q.type === 'rating' ? select(`tm-sv-${sid}-${i}`, esc(q.q) + ' (1-5)', [['', '—'], '1', '2', '3', '4', '5'], '') : field(`tm-sv-${sid}-${i}`, esc(q.q), '')).join('');
            const res = agg.map(a => `<div class="tmx-sv-q"><b>${esc(a.q)}</b> <small>(${a.n})</small>${a.type === 'choice' ? s.questions.find(q => q.q === a.q).options.map((o, k) => `<div class="tmx-opt"><span>${esc(o)}</span>${bar(a.counts[k], Math.max(1, a.n))}<small>${a.counts[k]}</small></div>`).join('') : a.type === 'rating' ? `<div>⭐ ${a.avg} / 5</div>` : `<ul>${a.texts.slice(0, 8).map(t => `<li>${esc(t)}</li>`).join('')}</ul>`}</div>`).join('');
            return `<details class="tmx-survey" ${answered ? '' : 'open'}><summary><b>📝 ${esc(s.title)}</b> <small>${s.answers.length} إجابة</small></summary>${answered || s.closed ? '' : `<div class="fmx-grid2">${form}</div><div class="gh-row">${pbtn('fa-paper-plane', 'إرسال الإجابة', call('tmAnswerSurveyUI', s.id))}</div>`}<div class="tmx-sv-res">${res}</div><div class="gh-row">${btn('fa-file-csv', 'CSV', call('tmSurveyCSV', s.id))}</div></details>`;
        }).join('');
        return card('استطلاع جديد', `${field('tm-sv-title', 'العنوان', '')}${area('tm-sv-qs', 'الأسئلة — سطر لكل سؤال. «سؤال | خيار | خيار» = اختيار، «سؤال *» = تقييم 1-5، غير ذلك نص', '', 4)}<div class="gh-row">${pbtn('fa-clipboard-question', 'نشر الاستطلاع', call('tmCreateSurveyUI'))}</div>`, 'fa-clipboard-question')
            + card('الاستطلاعات', html || empty('لا استطلاعات'), 'fa-list');
    };
    P.tmCreateSurveyUI = async function () { const s = await this.tmCreateSurvey({ title: val('tm-sv-title'), questions: this.tmParseSurvey(val('tm-sv-qs')) }).catch(e => this.tmErr(e)); if (s) this.tmRefresh(); return s; };
    P.tmAnswerSurveyUI = function (id) { const s = (this._tmSurveys || []).find(x => String(x.id) === String(id)); if (!s) return null; const sid = String(id).replace(/[^\w-]/g, ''); return this.tmAnswerSurvey(id, s.questions.map((_, i) => val(`tm-sv-${sid}-${i}`))); };
    P.tmSurveyCSV = function (id) { const s = (this._tmSurveys || []).find(x => String(x.id) === String(id)); if (!s) return null; const csv = surveyCSV(s.questions, s.answers); this.downloadBlob(new (win().Blob)([csv], { type: 'text/csv' }), `survey-${id}.csv`); return csv; };

    // ------------------------------------------------------------------ CALENDAR (#760)
    P.tmCalendarEvents = async function () {
        const t = this.tmTeam();
        const ev = [...((t && t.events) || localStore(this).events || [])].map(e => ({ ...e, kind: e.kind || 'event' }));
        (this.tasks || []).filter(x => x.deadline).forEach(x => ev.push({ id: 'task-' + x.id, title: `📋 ${x.title}`, start: new Date(x.deadline).getTime(), allDay: true, kind: 'task', done: x.status === 'done' }));
        if (this.tmHasGH()) {
            const ms = await this.tmGH('/milestones?state=open&per_page=50').catch(() => []) || [];
            ms.filter(m => m.due_on).forEach(m => ev.push({ id: 'ms-' + m.number, title: `🏁 ${m.title}`, start: new Date(m.due_on).getTime(), allDay: true, kind: 'milestone' }));
        }
        return ev.sort((a, b) => a.start - b.start);
    };
    P.tmAddEvent = async function ({ title, start, end, desc = '', allDay = false } = {}) {
        start = typeof start === 'number' ? start : new Date(start).getTime();
        if (!title || !start || isNaN(start)) { this.showToast('اكتب العنوان والتاريخ', 'warning'); return null; }
        const e = { id: uid('ev'), title, start, end: end ? (typeof end === 'number' ? end : new Date(end).getTime()) : 0, desc, allDay, by: this.tmMeSync() };
        const t = this.tmTeam();
        if (t) { t.events = [...(t.events || []), e]; await this.tmSaveTeam(t, `chore(team): event ${title}`); }
        else { const st = localStore(this); st.events.push(e); saveStore(this, st); }
        if (document.getElementById('tmx-sec')) this.tmRefresh();
        return e;
    };
    P.tmDeleteEvent = async function (id) {
        const t = this.tmTeam();
        if (t) { t.events = (t.events || []).filter(e => e.id !== id); await this.tmSaveTeam(t, 'chore(team): remove event'); }
        else { const st = localStore(this); st.events = st.events.filter(e => e.id !== id); saveStore(this, st); }
        return this.tmRefresh();
    };
    P.tmCalNav = function (d) { const c = this._tmCal || { y: new Date().getUTCFullYear(), m: new Date().getUTCMonth() }; const m = c.m + d; this._tmCal = { y: c.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 }; return this.tmRefresh(); };
    P.tmCalendar = async function () {
        const c = this._tmCal || (this._tmCal = { y: new Date().getUTCFullYear(), m: new Date().getUTCMonth() });
        const events = await this.tmCalendarEvents();
        this._tmEvents = events;
        const cells = monthGrid(c.y, c.m, events);
        const title = new Date(Date.UTC(c.y, c.m, 1)).toLocaleDateString('ar', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        const days = ['سبت', 'أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة'];
        const today = new Date(); const tkey = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
        const upcoming = events.filter(e => e.start >= Date.now() - DAY).slice(0, 8);
        return card('تقويم الفريق', `<div class="gh-row">${btn('fa-chevron-right', '', call('tmCalNav', -1))}<b class="tmx-cal-title">${esc(title)}</b>${btn('fa-chevron-left', '', call('tmCalNav', 1))}<span class="gh-spacer"></span>${btn('fa-calendar-plus', 'تصدير ICS', call('tmExportICS'))}</div>
            <div class="fmx-cal">${days.map(d => `<div class="fmx-cal-h">${d}</div>`).join('')}${cells.map(x => x ? `<div class="fmx-cal-cell ${x.from === tkey ? 'tmx-today' : ''}"><b>${x.d}</b>${x.events.slice(0, 3).map(e => `<div class="tmx-ev tmx-ev-${e.kind}" title="${esc(e.title)}">${esc(e.title)}</div>`).join('')}${x.events.length > 3 ? `<small>+${x.events.length - 3}</small>` : ''}</div>` : '<div></div>').join('')}</div>`, 'fa-calendar-days')
            + card('موعد جديد', `<div class="gh-row">${field('tm-ev-title', 'العنوان', '', 'placeholder="اجتماع التخطيط"')}${field('tm-ev-start', 'البداية', '', 'type="datetime-local"')}${field('tm-ev-end', 'النهاية', '', 'type="datetime-local"')}${pbtn('fa-plus', 'إضافة', call('tmAddEventUI'))}</div>`, 'fa-plus')
            + card('القادم', upcoming.map(e => `<div class="gh-item"><span>${esc(e.title)}</span><small>${fmtDate(e.start)}</small>${e.kind === 'event' ? btn('fa-trash', '', call('tmDeleteEvent', e.id)) : ''}</div>`).join('') || empty('لا مواعيد قادمة'), 'fa-clock');
    };
    P.tmAddEventUI = function () { return this.tmAddEvent({ title: val('tm-ev-title'), start: val('tm-ev-start'), end: val('tm-ev-end') }); };
    P.tmExportICS = async function () {
        const ev = this._tmEvents || await this.tmCalendarEvents();
        const ics = toICS(ev, (this.tmTeam() || {}).name || 'OX-Alpha Team');
        this.downloadBlob(new (win().Blob)([ics], { type: 'text/calendar' }), 'team-calendar.ics');
        return ics;
    };

    // ------------------------------------------------------------------ LEADERBOARD (#769)
    P.tmMemberStats = async function (days = 30, now = Date.now()) {
        const since = iso(now - days * DAY);
        const s = {};
        const add = (login, k, n = 1) => { if (!login) return; s[login] = s[login] || { commits: 0, prs: 0, reviews: 0, issues: 0, comments: 0, rewards: 0, lines: 0 }; s[login][k] += n; };
        const t = this.tmTeam();
        ((t && t.members) || []).forEach(m => add(m.login, 'commits', 0));
        if (this.tmHasGH()) {
            const [commits, pulls, issues, comments] = await Promise.all([
                this.tmList(`${this.ghRepoPath()}/commits?since=${encodeURIComponent(since)}`, { max: 500 }).catch(() => []),
                this.tmList(`${this.ghRepoPath()}/pulls?state=all&sort=updated&direction=desc`, { max: 100 }).catch(() => []),
                this.tmList(`${this.ghRepoPath()}/issues?state=closed&since=${encodeURIComponent(since)}`, { max: 300 }).catch(() => []),
                this.tmList(`${this.ghRepoPath()}/issues/comments?since=${encodeURIComponent(since)}`, { max: 500 }).catch(() => [])
            ]);
            commits.forEach(c => add((c.author && c.author.login) || (c.commit && c.commit.author && c.commit.author.name), 'commits'));
            const recent = pulls.filter(p => new Date(p.created_at).getTime() >= now - days * DAY || (p.merged_at && new Date(p.merged_at).getTime() >= now - days * DAY));
            recent.forEach(p => add(p.user && p.user.login, 'prs'));
            for (const p of recent.slice(0, 15)) { const rv = await this.tmGH(`/pulls/${p.number}/reviews?per_page=50`).catch(() => []) || []; rv.forEach(r => add(r.user && r.user.login, 'reviews')); }
            issues.filter(i => !i.pull_request && i.closed_at && new Date(i.closed_at).getTime() >= now - days * DAY).forEach(i => add((i.assignee && i.assignee.login) || (i.user && i.user.login), 'issues'));
            comments.forEach(c => add(c.user && c.user.login, 'comments'));
        } else {
            const me = this.tmMeSync();
            add(me, 'issues', (this.tasks || []).filter(x => x.status === 'done' && (x.done || 0) >= now - days * DAY).length);
        }
        ((t && t.rewards) || []).filter(r => r.t >= now - days * DAY).forEach(r => add(r.login, 'rewards', r.points || 0));
        return s;
    };
    P.tmLeaderboard = async function (opts = {}) {
        const days = opts.days || this._tmLbDays || 30;
        const rows = leaderboard(await this.tmMemberStats(days));
        const max = Math.max(1, ...rows.map(r => r.score));
        return card('لوحة صدارة الفريق', `<div class="gh-row">${[7, 30, 90].map(d => `<button class="gh-chip ${d === days ? 'active' : ''}" onclick="app._tmLbDays=${d};app.tmRefresh()">${d} يوم</button>`).join('')}</div>
            ${rows.length ? table(['#', 'العضو', 'Commits', 'PRs', 'مراجعات', 'Issues', 'تعليقات', 'مكافآت', 'النقاط', ''], rows.map(r => [r.medal || r.rank, '@' + esc(r.login), r.commits, r.prs, r.reviews, r.issues, r.comments, r.rewards, `<b>${r.score}</b>`, bar(r.score, max)])) : empty('لا بيانات في هذه الفترة')}
            <div class="tmx-note">النقاط: commit ×${SCORE.commits} • PR ×${SCORE.prs} • مراجعة ×${SCORE.reviews} • issue مغلق ×${SCORE.issues} • تعليق ×${SCORE.comments} • + نقاط المكافآت.</div>`, 'fa-ranking-star');
    };

    // ------------------------------------------------------------------ REWARDS (#770)
    P.tmGiveReward = async function (login, badgeId, reason = '') {
        const t = this.tmRequireTeam(); if (!t) return null;
        const b = BADGES.find(x => x.id === badgeId) || BADGES[0];
        login = String(login || '').replace(/^@/, '');
        if (!login) return null;
        const me = await this.tmMe();
        if (login === me) { this.showToast('لا يمكنك مكافأة نفسك 😉', 'info'); return null; }
        const r = { id: uid('rw'), login, badge: b.id, points: b.points, reason, by: me, t: Date.now() };
        t.rewards = [...(t.rewards || []), r];
        await this.tmSaveTeam(t, `chore(team): ${b.emoji} reward @${login}`);
        const ch = await this.tmChannelList().catch(() => []);
        if (ch[0]) await this.tmSend(ch[0].id, `${b.emoji} @${me} منح @${login} شارة **${b.label}** (+${b.points})${reason ? ' — ' + reason : ''}`, { silent: true }).catch(() => {});
        if (this.confetti) this.confetti({ count: 60 });
        if (document.getElementById('tmx-sec')) this.tmRefresh();
        return r;
    };
    /** Rewards I received but haven't claimed yet → XP. */
    P.tmClaimRewards = function () {
        const t = this.tmTeam(); const me = this.tmMeSync();
        if (!t) return 0;
        const claimed = new Set(lsGet('ox_team_claimed_v1', []));
        const mine = (t.rewards || []).filter(r => r.login === me && !claimed.has(r.id));
        mine.forEach(r => { claimed.add(r.id); if (this.addXP) this.addXP(r.points, 'reward'); });
        lsSet('ox_team_claimed_v1', [...claimed]);
        if (mine.length) this.showToast(`🎁 استلمت ${mine.length} مكافأة (+${mine.reduce((n, r) => n + r.points, 0)} XP)`, 'success');
        return mine.length;
    };
    P.tmRewards = async function () {
        const t = this.tmTeam();
        if (!t) return empty('أنشئ فريقاً أولاً');
        this.tmClaimRewards();
        const totals = {};
        (t.rewards || []).forEach(r => { totals[r.login] = totals[r.login] || { points: 0, badges: {} }; totals[r.login].points += r.points; totals[r.login].badges[r.badge] = (totals[r.login].badges[r.badge] || 0) + 1; });
        const members = (t.members || []).map(m => m.login).filter(l => l !== this.tmMeSync());
        return card('امنح مكافأة', `<div class="gh-row">${select('tm-rw-login', 'العضو', members.map(l => [l, '@' + l]), members[0] || '')}${select('tm-rw-badge', 'الشارة', BADGES.map(b => [b.id, `${b.emoji} ${b.label} (+${b.points})`]), 'kudos')}${field('tm-rw-reason', 'السبب', '')}${pbtn('fa-gift', 'منح', call('tmGiveRewardUI'))}</div>`, 'fa-gift')
            + card('خزانة الشارات', Object.keys(totals).length ? table(['العضو', 'النقاط', 'الشارات'], Object.entries(totals).sort((a, b) => b[1].points - a[1].points).map(([l, x]) => ['@' + esc(l), x.points, Object.entries(x.badges).map(([id, n]) => { const b = BADGES.find(y => y.id === id) || {}; return `<span class="fmx-tag" title="${esc(b.label)}">${b.emoji || '🏅'}×${n}</span>`; }).join('')])) : empty('لا مكافآت بعد'), 'fa-medal')
            + card('آخر المكافآت', (t.rewards || []).slice(-15).reverse().map(r => { const b = BADGES.find(y => y.id === r.badge) || {}; return `<div class="gh-item"><span>${b.emoji || '🏅'} @${esc(r.by)} ← @${esc(r.login)} — ${esc(b.label || r.badge)}${r.reason ? ': ' + esc(r.reason) : ''}</span><small>${ago(r.t)}</small></div>`; }).join('') || empty('—'), 'fa-clock-rotate-left');
    };
    P.tmGiveRewardUI = function () { return this.tmGiveReward(val('tm-rw-login'), val('tm-rw-badge'), val('tm-rw-reason')); };

    // ------------------------------------------------------------------ MARKETPLACE (#738)
    P.tmMarket = async function (opts = {}) {
        const t = this.tmTeam();
        const items = (t && t.market) || lsGet('ox_team_market_v1', []);
        const q = opts.q || this._tmMarketQ || '';
        this._tmMount = () => this.tmMarketSearch(q);
        const stars = (it) => { const r = Object.values(it.ratings || {}); return r.length ? (r.reduce((a, b) => a + b, 0) / r.length).toFixed(1) : '—'; };
        return card('انشر مشروعك كقالب', `<div class="gh-row">${field('tm-mk-name', 'اسم القالب', '')}${field('tm-mk-desc', 'الوصف', '')}${field('tm-mk-tags', 'الوسوم', '', 'placeholder="react, dashboard"')}${pbtn('fa-store', 'نشر في السوق', call('tmPublishTemplate'))}</div>`, 'fa-upload')
            + card('قوالب الفريق', items.length ? items.map(it => `<div class="tmx-market"><div><b>${esc(it.name)}</b> <small>@${esc(it.by)} • ⭐ ${stars(it)} • ${ago(it.t)}</small><div>${esc(it.desc || '')}</div>${(it.tags || []).map(x => `<span class="fmx-tag">${esc(x)}</span>`).join('')}</div><div class="gh-row">${pbtn('fa-download', 'استخدام', call('tmUseTemplate', it.id))}${[1, 2, 3, 4, 5].map(n => `<button class="fmx-star" onclick="${call('tmRateTemplate', it.id, n)}" title="${n}">${n <= Math.round(+stars(it) || 0) ? '★' : '☆'}</button>`).join('')}</div></div>`).join('') : empty('لا قوالب منشورة بعد'), 'fa-store')
            + card('قوالب GitHub العامة', `<div class="gh-row">${field('tm-mk-q', 'بحث', q, 'placeholder="react starter"')}${btn('fa-magnifying-glass', 'بحث', callRaw('tmMarketSearch', [], "document.getElementById('tm-mk-q').value"))}</div><div id="tm-mk-gh"></div>`, 'fa-github');
    };
    P.tmPublishTemplate = async function (opts = {}) {
        const name = opts.name || val('tm-mk-name') || ((this.tmTeam() || {}).name || 'template');
        if (!this.tmHasGH()) { this.showToast('النشر في السوق يحتاج رمز GitHub (يُحفظ القالب كـ Gist)', 'warning'); return null; }
        try {
            const { gist } = await this.publishProjectTemplate({ name, isPublic: true });
            const it = { id: gist.id, name, desc: opts.desc != null ? opts.desc : val('tm-mk-desc'), tags: String(opts.tags != null ? opts.tags : val('tm-mk-tags')).split(/[,،]/).map(s => s.trim()).filter(Boolean), by: await this.tmMe(), t: Date.now(), ratings: {}, files: this.virtualProjectFiles.size };
            const t = this.tmTeam();
            if (t) { t.market = [it, ...(t.market || [])]; await this.tmSaveTeam(t, `chore(team): publish template ${name}`); }
            else lsSet('ox_team_market_v1', [it, ...lsGet('ox_team_market_v1', [])]);
            this.showToast('🏪 نُشر القالب في السوق', 'success');
            if (document.getElementById('tmx-sec')) this.tmRefresh();
            return it;
        } catch (e) { return this.tmErr(e); }
    };
    P.tmUseTemplate = function (id) { return this.handleShareHash('#gist=' + id); };
    P.tmRateTemplate = async function (id, n) {
        const t = this.tmTeam(); const me = this.tmMeSync();
        const list = t ? t.market || [] : lsGet('ox_team_market_v1', []);
        const it = list.find(x => x.id === id); if (!it) return null;
        it.ratings = { ...(it.ratings || {}), [me]: Math.max(1, Math.min(5, +n)) };
        if (t) await this.tmSaveTeam(t, 'chore(team): rate template'); else lsSet('ox_team_market_v1', list);
        if (document.getElementById('tmx-sec')) this.tmRefresh();
        return it.ratings;
    };
    P.tmMarketSearch = async function (q = '') {
        this._tmMarketQ = q;
        const el = document.getElementById('tm-mk-gh');
        if (el) el.innerHTML = '<div class="gh-empty"><span class="live-step-spinner"></span></div>';
        const r = await this.gh(`/search/repositories?q=${encodeURIComponent(((q || 'starter') + ' template:true').trim())}&sort=stars&per_page=12`).catch(() => null);
        const items = (r && r.items) || [];
        setHTML('tm-mk-gh', items.length ? items.map(x => `<div class="tmx-market"><div><b><a href="${esc(x.html_url)}" target="_blank" rel="noopener" dir="ltr">${esc(x.full_name)}</a></b> <small>⭐ ${x.stargazers_count} • ${esc(x.language || '')}</small><div>${esc(x.description || '')}</div></div><div class="gh-row">${this.tmHasGH() ? pbtn('fa-code-branch', 'مستودع جديد منه', call('tmGenerateFromTemplate', x.full_name)) : ''}${btn('fa-file-import', 'استيراد الملفات', call('tmImportRepoTemplate', x.full_name, x.default_branch || 'main'))}</div></div>`).join('') : empty('لا نتائج'));
        return items;
    };
    P.tmGenerateFromTemplate = async function (full) {
        const name = await this.askText('اسم المستودع الجديد', full.split('/')[1] + '-app');
        if (!name) return null;
        try {
            const me = await this.tmMe();
            const r = await this.gh(`/repos/${full}/generate`, { method: 'POST', body: { owner: me, name, private: true, include_all_branches: false } });
            this.showToast(`📦 أُنشئ ${this.escapeHTML(r.full_name || me + '/' + name)}`, 'success');
            if (await this.askConfirm('التبديل إلى المستودع الجديد؟', '')) { this.settings.githubOwner = me; this.settings.githubRepo = name; this.settings.githubBranch = r.default_branch || 'main'; if (this.persistSettings) this.persistSettings(); }
            return r;
        } catch (e) { return this.tmErr(e); }
    };
    P.tmImportRepoTemplate = async function (full, branch = 'main') {
        try {
            const tree = await this.gh(`/repos/${full}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
            const files = (tree.tree || []).filter(f => f.type === 'blob' && f.size < 300000 && !/\.(png|jpe?g|gif|ico|woff2?|ttf|zip|pdf|mp4|webp)$/i.test(f.path)).slice(0, 80);
            let n = 0;
            for (const f of files) {
                const res = await fetch(`https://raw.githubusercontent.com/${full}/${encodeURIComponent(branch)}/${f.path.split('/').map(encodeURIComponent).join('/')}`).catch(() => null);
                if (!res || !res.ok) continue;
                this.writeProjectFile(f.path, await res.text(), 'template'); n++;
            }
            if (this.renderStudioExplorer) this.renderStudioExplorer();
            this.showToast(`📥 استُورد ${n} ملف من ${this.escapeHTML(full)}`, 'success');
            return n;
        } catch (e) { return this.tmErr(e); }
    };
}
