/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 14: Integrations & Future hub (lazy chunk assets/studio/integ-[hash].mjs)
   Loaded by the stubs in src/features/21-integ.js (Alt+X, palette, ?action=integ, boot list).
   Tabs: ai • build • data • services • observe • work • design • ext • ui • widgets • social • space
   ============================================================================== */
import MEDIA_CSS from '../media/media.css';
import PERF_CSS from '../perf/perf.css';
import DEV_CSS from '../dev/dev.css';
import INTEG_CSS from './integ.css';
import * as util from './util.js';
import { installCore, TAB_DEFS } from './core.js';
import { installAI, DIRECT, nativeModel, directRoute, toAnthropic, toGemini, toOpenAI, providerEvent, translateStream, translateJSON, styleProfile, styleGuide, fineTuneExamples, MARKET_DEFAULT, filterMarket, validatePrompt, projectCard, rankCards, memoryPrompt } from './ai.js';
import { authFiles, AUTH_DEFAULTS, RBAC_ACTIONS, RBAC_SAMPLE, resolvePolicy, makeCan, rbacMatrix, rbacFiles, SERVICE_FILES } from './gen.js';
import { installMaker, verifyProject, parsePlan, slugify, parseVoiceCommand, applyVoiceEdit } from './maker.js';
import { installData, DB_PROVIDERS, dbRequest, dbParse, fsValue, dbClientFiles, algoliaRecords, cldUrl, rewriteImageRefs } from './data.js';
import { installServices, smsSegments, clerkFrontendApi, emailHtml, emailText } from './services.js';
import { installObserve, parseDsn, parseStack, sentryEvent, sentryEnvelope, phBatch, observeFiles } from './observe.js';
import { installWork, scanTodos, todoBody, jiraCsv, HOOK_EVENTS, ghEvent, mergePush, hookText, hookKind } from './work.js';
import { installDesign, figmaToHtml, figmaPluginFiles } from './design.js';
import { installExt, API_ROUTES, apiSpec } from './ext.js';
import { vscodeFiles, chromeFiles, cliFiles, OX_URL, EXT_VERSION } from './extfiles.js';
import { installUI, LANGS, I18N_EN, applyI18n, revertI18n, rtlAudit, toLogical, htmlDirFix, latinKey } from './ui.js';
import { installWidgetsHub, widgetFiles } from './whub.js';
import * as wlib from './wlib.js';
import { installSocial, LEVELS, levelOf, POINTS, scorePoints, rankContributors, mergeBoard } from './social.js';
import { installSpace, ringLayout, gyroToRotation, codeCanvas } from './space.js';

/** Pure helpers exposed for unit tests (tests import the built chunk). */
export const lib = {
    ...util, TAB_DEFS,
    DIRECT, nativeModel, directRoute, toAnthropic, toGemini, toOpenAI, providerEvent, translateStream, translateJSON, styleProfile, styleGuide, fineTuneExamples, MARKET_DEFAULT, filterMarket, validatePrompt, projectCard, rankCards, memoryPrompt,
    authFiles, AUTH_DEFAULTS, RBAC_ACTIONS, RBAC_SAMPLE, resolvePolicy, makeCan, rbacMatrix, rbacFiles, SERVICE_FILES,
    verifyProject, parsePlan, slugify, parseVoiceCommand, applyVoiceEdit,
    DB_PROVIDERS, dbRequest, dbParse, fsValue, dbClientFiles, algoliaRecords, cldUrl, rewriteImageRefs,
    smsSegments, clerkFrontendApi, emailHtml, emailText,
    parseDsn, parseStack, sentryEvent, sentryEnvelope, phBatch, observeFiles,
    scanTodos, todoBody, jiraCsv, HOOK_EVENTS, ghEvent, mergePush, hookText, hookKind,
    figmaToHtml, figmaPluginFiles, API_ROUTES, apiSpec, vscodeFiles, chromeFiles, cliFiles, OX_URL, EXT_VERSION,
    LANGS, I18N_EN, applyI18n, revertI18n, rtlAudit, toLogical, htmlDirFix, latinKey,
    widgetFiles, wlib,
    LEVELS, levelOf, POINTS, scorePoints, rankContributors, mergeBoard,
    ringLayout, gyroToRotation, codeCanvas
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
    if (P.__oxInteg) return P.__oxInteg;
    injectCSS('ox-media-chunk-css', MEDIA_CSS);
    injectCSS('ox-perf-chunk-css', PERF_CSS);
    injectCSS('ox-dev-chunk-css', DEV_CSS);
    injectCSS('ox-integ-chunk-css', INTEG_CSS);
    installCore(P);
    installAI(P);
    installMaker(P);
    installData(P);
    installServices(P);
    installObserve(P);
    installWork(P);
    installDesign(P);
    installExt(P);
    installUI(P);
    installWidgetsHub(P);
    installSocial(P);
    installSpace(P);
    P.ixLib = () => lib;
    P.__oxInteg = { lib, tabs: Object.keys(TAB_DEFS) };
    return P.__oxInteg;
}
