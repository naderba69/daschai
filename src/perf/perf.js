/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 12: Performance & Mobile hub (lazy chunk assets/studio/perf-[hash].mjs)
   Loaded on first use of the stubs in src/features/19-perf.js (Alt+J, palette, ?action=perf, boot modes).
   Tabs: vitals • speed • data • search • update • lab • app • camera • sensors • audio • modes
   ============================================================================== */
import MEDIA_CSS from '../media/media.css';
import PERF_CSS from './perf.css';
import * as util from './util.js';
import { installCore, TAB_DEFS } from './core.js';
import { installVitals, VITAL_TH, VITAL_WEIGHTS, metricScore, perfScore, auditChecks, checksScore, tbtFrom, dailyRows, dailyTrend, leakAnalysis, collectionSizes, growth, topUsage } from './vitals.js';
import { installSpeed, chunkReport, bestFormat, savings, precompressConfig, heavyInline } from './speed.js';
import { installData, sqlFindings, suggestIndexes, extractSQL, nPlusOne, algoFindings, complexityOf } from './data.js';
import { installSearch, normalize, tokenize, stripAl, within1, parseQuery, buildIndex, prefixTokens, passFilters, searchIndex, rankResults, TYPE_LABEL, groupResults, suggest, snippet } from './search.js';
import { installUpdate, webhookRequests, versionDelta, DEFER_OPTIONS } from './update.js';
import { installLab, benchStats, compareRuns, bottleneckRows, depsOf, upgradeAdvice, importGraph, findCycles, archFindings, holt, forecast, parseSeries, replicasFor, k8sManifests, flyToml, lbConfig, fnv1a, ringBuild, ringGet, distribution, movedShare, redisCacheAside, pgCompose, shardRouter } from './lab.js';
import { installMobile, packageIdFor, twaManifest, validFingerprint, assetLinks, urlB64ToBytes, validVapid, pushServerSample, deepLink, ASSIST_ACTIONS, classifyGesture, GESTURE_LABEL, parseHeartRate } from './mobile.js';
import { installCamera, parseCardText, toVCard, boxesToPx, dHashFromGray, hamming, similarity, LANGS } from './camera.js';
import { installSensors, createStepDetector, createShakeDetector, classifyActivity, ACTIVITY_LABEL, bearing, haversine, KAABA, qibla, cardinal, headingOf, compassSVG } from './sensors.js';
import { installAudio, parseVoiceCommand, VOICE_HELP, groupRecordings, fmtDur } from './audio.js';
import { installModes, KIDS_PROMPT, validPin, pinHash, kidsRemaining, luxToBrightness, scheduleBrightness, EXIT_WORDS } from './modes.js';

/** Pure helpers exposed for unit tests (tests import the built chunk). */
export const lib = {
    ...util, TAB_DEFS,
    VITAL_TH, VITAL_WEIGHTS, metricScore, perfScore, auditChecks, checksScore, tbtFrom, dailyRows, dailyTrend, leakAnalysis, collectionSizes, growth, topUsage,
    chunkReport, bestFormat, savings, precompressConfig, heavyInline,
    sqlFindings, suggestIndexes, extractSQL, nPlusOne, algoFindings, complexityOf,
    normalize, tokenize, stripAl, within1, parseQuery, buildIndex, prefixTokens, passFilters, searchIndex, rankResults, TYPE_LABEL, groupResults, suggest, snippet,
    webhookRequests, versionDelta, DEFER_OPTIONS,
    benchStats, compareRuns, bottleneckRows, depsOf, upgradeAdvice, importGraph, findCycles, archFindings, holt, forecast, parseSeries, replicasFor,
    k8sManifests, flyToml, lbConfig, fnv1a, ringBuild, ringGet, distribution, movedShare, redisCacheAside, pgCompose, shardRouter,
    packageIdFor, twaManifest, validFingerprint, assetLinks, urlB64ToBytes, validVapid, pushServerSample, deepLink, ASSIST_ACTIONS, classifyGesture, GESTURE_LABEL, parseHeartRate,
    parseCardText, toVCard, boxesToPx, dHashFromGray, hamming, similarity, LANGS,
    createStepDetector, createShakeDetector, classifyActivity, ACTIVITY_LABEL, bearing, haversine, KAABA, qibla, cardinal, headingOf, compassSVG,
    parseVoiceCommand, VOICE_HELP, groupRecordings, fmtDur,
    KIDS_PROMPT, validPin, pinHash, kidsRemaining, luxToBrightness, scheduleBrightness, EXIT_WORDS
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
    if (P.__oxPerf) return P.__oxPerf;
    injectCSS('ox-media-chunk-css', MEDIA_CSS); // fmx-* primitives (same id → the media chunk won't inject twice)
    injectCSS('ox-perf-chunk-css', PERF_CSS);
    installCore(P);
    installVitals(P);
    installSpeed(P);
    installData(P);
    installSearch(P);
    installUpdate(P);
    installLab(P);
    installMobile(P);
    installCamera(P);
    installSensors(P);
    installAudio(P);
    installModes(P);
    P.__oxPerf = { lib, tabs: Object.keys(TAB_DEFS) };
    return P.__oxPerf;
}
