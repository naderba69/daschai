/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 11: Team & Analytics hub (lazy chunk assets/studio/team-[hash].mjs)
   Loaded on first use of the stubs in src/features/18-team.js (Alt+E, palette, #oxsnip/#oxteam/#oxlive links).
   Tabs: team • chat • live • review • share • engage • modes • ai • analytics • growth • reports
   ============================================================================== */
import MEDIA_CSS from '../media/media.css';
import TEAM_CSS from './team.css';
import * as util from './util.js';
import { installCore, TAB_DEFS, ROLES, ROLE_CAPS, roleFromGH, defaultTeam, accessFor, readonlyPatterns, codeOwners, TEAM_FILE } from './core.js';
import { installOrg, encodeInvite, decodeInvite } from './org.js';
import { installChat, channelSlug, isAIMention, AI_PREFIX } from './chat.js';
import { RGA, mapOffset } from './crdt.js';
import { installLive, LIVE_ICE, encodeLive, decodeLive, PEER_COLORS, colorFor } from './live.js';
import { installReview, parsePatch, commentableLines, suggestionBody, parseSuggestion, applySuggestion } from './review.js';
import { installSnip, encryptText, decryptText, snipStatus, parseSnipHash, langOf, embedHTML } from './snip.js';
import { installEngage, tallyPoll, aggregateSurvey, surveyCSV, toICS, monthGrid, SCORE, leaderboard, BADGES } from './engage.js';
import { installModes, decide, CHALLENGES, buildChallengeScript, scoreSubmission, QUESTS, dailyQuests, bossState } from './modes.js';
import { installAITeam, taskTopics, assignTasks, inferSkills, predictDelay, delayAlerts, forecast, extractMinutes, minutesMarkdown, similarIssues, busFactor, coachInsights } from './aiteam.js';
import { installAnalyze, parseLcov, parseCoverageSummary, isTestPath, heuristicCoverage, PERF_RULES, SEC_RULES, perfScan, securityScan, scanScore, projectMetrics, compareMetrics, bugStats, groupErrors } from './analyze.js';
import { installGrowth, sentiment, moodSeries, LEARNING_PATHS, pathProgress, learnDelta, PROJECT_IDEAS, recommendProjects, BENCHMARK, compareToAverage, productivityTips, certificateSVG } from './growth.js';
import { installReports, collabGraph, collabSVG, burndown, progressSummary, riskAssessment, invoiceTotals, invoiceHTML, nextInvoiceNumber } from './reports.js';

/** Pure helpers exposed for unit tests (tests import the built chunk). */
export const lib = {
    ...util, TAB_DEFS, ROLES, ROLE_CAPS, roleFromGH, defaultTeam, accessFor, readonlyPatterns, codeOwners, TEAM_FILE,
    encodeInvite, decodeInvite, channelSlug, isAIMention, AI_PREFIX, RGA, mapOffset,
    LIVE_ICE, encodeLive, decodeLive, PEER_COLORS, colorFor,
    parsePatch, commentableLines, suggestionBody, parseSuggestion, applySuggestion,
    encryptText, decryptText, snipStatus, parseSnipHash, langOf, embedHTML,
    tallyPoll, aggregateSurvey, surveyCSV, toICS, monthGrid, SCORE, leaderboard, BADGES,
    decide, CHALLENGES, buildChallengeScript, scoreSubmission, QUESTS, dailyQuests, bossState,
    taskTopics, assignTasks, inferSkills, predictDelay, delayAlerts, forecast, extractMinutes, minutesMarkdown, similarIssues, busFactor, coachInsights,
    parseLcov, parseCoverageSummary, isTestPath, heuristicCoverage, PERF_RULES, SEC_RULES, perfScan, securityScan, scanScore, projectMetrics, compareMetrics, bugStats, groupErrors,
    sentiment, moodSeries, LEARNING_PATHS, pathProgress, learnDelta, PROJECT_IDEAS, recommendProjects, BENCHMARK, compareToAverage, productivityTips, certificateSVG,
    collabGraph, collabSVG, burndown, progressSummary, riskAssessment, invoiceTotals, invoiceHTML, nextInvoiceNumber
};

const injectCSS = (id, css) => {
    if (typeof document === 'undefined' || document.getElementById(id)) return;
    const st = document.createElement('style');
    st.id = id;
    st.textContent = css;
    document.head.appendChild(st);
};

export function install(app) {
    const P = Object.getPrototypeOf(app);
    if (P.__oxTeam) return P.__oxTeam;
    injectCSS('ox-media-chunk-css', MEDIA_CSS); // fmx-* primitives (same id → the media chunk won't inject twice)
    injectCSS('ox-team-chunk-css', TEAM_CSS);
    installCore(P);
    installOrg(P);
    installChat(P);
    installLive(P);
    installReview(P);
    installSnip(P);
    installEngage(P);
    installModes(P);
    installAITeam(P);
    installAnalyze(P);
    installGrowth(P);
    installReports(P);
    wireGameEvents(P);
    P.__oxTeam = { lib, tabs: Object.keys(TAB_DEFS) };
    return P.__oxTeam;
}

/** Game mode (#808): daily quests count chat / review / reward / vote / share actions. */
function wireGameEvents(P) {
    const wrap = (name, kind, ok = (r) => r != null && r !== false) => {
        const orig = P[name];
        if (typeof orig !== 'function' || orig.__oxGame) return;
        const w = async function (...args) {
            const r = await orig.apply(this, args);
            try { if (ok(r) && this.tmGameEvent) this.tmGameEvent(kind); } catch (e) { /* best effort */ }
            return r;
        };
        w.__oxGame = true;
        P[name] = w;
    };
    wrap('tmSend', 'chat');
    wrap('tmSubmitReview', 'review');
    wrap('tmGiveReward', 'reward');
    wrap('tmVote', 'vote');
    wrap('tmCreateSnippet', 'share');
}
