/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 13: Developer Lab (lazy chunk assets/studio/dev-[hash].mjs)
   Loaded on first use of the stubs in src/features/20-dev.js (Alt+I, palette, run hooks, #oxrun= links).
   Tabs: search • quality • run • term • test • debug • history • refactor • custom • arabic
   ============================================================================== */
import MEDIA_CSS from '../media/media.css';
import PERF_CSS from '../perf/perf.css';
import DEV_CSS from './dev.css';
import * as util from './util.js';
import { installCore, TAB_DEFS } from './core.js';
import { installSearch, buildSearchRegex, findMatches, expandReplacement, preserveCase, replaceMatches, searchFiles } from './search.js';
import { installQuality, findDuplicates, joinRel, resolveSpec, relSpec, importGraph, mergeSuggestions, planMerge } from './quality.js';
import { installRun, POLY_LANGS, POLY_SAMPLES, SAMPLE_DB, SAMPLE_AUTH, dbRoutes, decodeJwt } from './run.js';
import { installTerm } from './term.js';
import { tokenize, parse as parseShell, normPath, globToRegex, createShell } from './shell.js';
import { parseSpec, parseVer, cmpVer, satisfies, maxSatisfying, resolveVersion, createNpm } from './npm.js';
import { e2eExt, e2eOps, E2E_SAMPLE } from './e2e.js';
import { installTest, SNAPSHOT_SAMPLE, BENCH_SAMPLE, coverageTotals, benchCompare, resolvePage } from './test.js';
import { installDebug, executedLines, errorStep } from './debug.js';
import { installHistory, fileStates, stateAt, buildTimeline, localBlame, blameFromRanges } from './history.js';
import { installRefactor, templateVars, renderTemplate, templatize, planMoves, renameSymbol, barrelFor, casePath } from './refactor.js';
import { installCustom, EXT_KEY, ICON_KEY, SYNC_GROUPS, buildSyncPayload, diffSyncPayload, EXT_SAMPLE, validateExtension, expandSnippet, applyCommand, ICON_THEMES, resolveIconTheme, iconFor } from './custom.js';
import { installQalam, LESSONS } from './qalam.js';
import { parseJS, instrumentCoverage, coverageSummary, toLcov, instrumentDebug, navigate, generateMutants, applyMutant, mutationScore } from './instrument.js';
import { transpileArabic, toArabic, arabicReference, ARABIC_SAMPLE } from '../studio/arabic.js';

/** Pure helpers exposed for unit tests (tests import the built chunk). */
export const lib = {
    ...util, TAB_DEFS,
    buildSearchRegex, findMatches, expandReplacement, preserveCase, replaceMatches, searchFiles,
    findDuplicates, joinRel, resolveSpec, relSpec, importGraph, mergeSuggestions, planMerge,
    POLY_LANGS, POLY_SAMPLES, SAMPLE_DB, SAMPLE_AUTH, dbRoutes, decodeJwt,
    tokenize, parseShell, normPath, globToRegex, createShell,
    parseSpec, parseVer, cmpVer, satisfies, maxSatisfying, resolveVersion, createNpm,
    e2eExt, e2eOps, E2E_SAMPLE, SNAPSHOT_SAMPLE, BENCH_SAMPLE, coverageTotals, benchCompare, resolvePage,
    executedLines, errorStep,
    fileStates, stateAt, buildTimeline, localBlame, blameFromRanges,
    templateVars, renderTemplate, templatize, planMoves, renameSymbol, barrelFor, casePath,
    EXT_KEY, ICON_KEY, SYNC_GROUPS, buildSyncPayload, diffSyncPayload, EXT_SAMPLE, validateExtension, expandSnippet, applyCommand, ICON_THEMES, resolveIconTheme, iconFor,
    LESSONS, transpileArabic, toArabic, arabicReference, ARABIC_SAMPLE,
    parseJS, instrumentCoverage, coverageSummary, toLcov, instrumentDebug, navigate, generateMutants, applyMutant, mutationScore
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
    if (P.__oxDev) return P.__oxDev;
    injectCSS('ox-media-chunk-css', MEDIA_CSS); // fmx-* primitives (same id → other chunks won't inject twice)
    injectCSS('ox-perf-chunk-css', PERF_CSS);   // pfx-toggle / pfx-pre
    injectCSS('ox-dev-chunk-css', DEV_CSS);
    installCore(P);
    installSearch(P);
    installQuality(P);
    installRun(P);
    installTerm(P);
    installTest(P);
    installDebug(P);
    installHistory(P);
    installRefactor(P);
    installCustom(P);
    installQalam(P);
    P.dvLib = () => lib;
    P.__oxDev = { lib, tabs: Object.keys(TAB_DEFS) };
    return P.__oxDev;
}
