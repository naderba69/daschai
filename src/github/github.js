/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 9: GitHub Pro (lazy chunk assets/studio/github-[hash].mjs)
   Loaded on first use of the new GitHub Hub tabs / the stubs in src/features/16-github-pro.js.
   Tabs: history • search • planning • ops • analytics • repo • move • clone • community • gists • org
   Ideas: #422 #423 #425-#433 #436-#440 #444-#450 #453 #455 #456 #458 #459 #462-#464 #466-#479
          #481-#500 #502-#520 #524-#530
   ============================================================================== */
import GH_CSS from './github.css';
import * as shared from './shared.js';
import * as stats from './stats.js';
import { installCore, TAB_DEFS } from './core.js';
import { gitOps, layoutGraph, graphSVG } from './gitops.js';
import { installHistory } from './history.js';
import { installSearch, buildSearchQuery, highlightFragment } from './search.js';
import { installPlanning, boardColumn, withClosingRef, DOING_LABELS, DEFAULT_LABELS } from './planning.js';
import { installOps, cleanLog, isValidSecretName } from './ops.js';
import { installAnalytics } from './analytics.js';
import { installRepo, protectionPayload, isValidDomain, WEBHOOK_EVENTS } from './repo.js';
import { installTransfer, diffTrees, retarget, isTextPath } from './transfer.js';
import { installClone, cloneCommands, devcontainerFor } from './clone.js';
import { installCommunity, licenseText, fillLicense, contributingMd, codeOfConductMd, fundingYml, issueTemplates, PR_TEMPLATE, codeownersText, wikiFileName, LICENSES, WIKI_DIR } from './community.js';
import { installGists, snippetName, gistPatch } from './gists.js';
import { installOrg, describeEvent, roleOfPermissions, REPO_ROLES } from './org.js';
import { installReleases, assetUploadUrl } from './releases.js';

/** Pure helpers exposed for unit tests (tests import the built chunk). */
export const lib = {
    ...shared, ...stats, TAB_DEFS, gitOps, layoutGraph, graphSVG, buildSearchQuery, highlightFragment, boardColumn, withClosingRef, DOING_LABELS, DEFAULT_LABELS,
    cleanLog, isValidSecretName, protectionPayload, isValidDomain, WEBHOOK_EVENTS, diffTrees, retarget, isTextPath, cloneCommands, devcontainerFor,
    licenseText, fillLicense, contributingMd, codeOfConductMd, fundingYml, issueTemplates, PR_TEMPLATE, codeownersText, wikiFileName, LICENSES, WIKI_DIR,
    snippetName, gistPatch, describeEvent, roleOfPermissions, REPO_ROLES, assetUploadUrl,
    crypto: () => import('./crypto.js')
};

export function install(app) {
    const P = Object.getPrototypeOf(app);
    if (P.__oxGH) return P.__oxGH;
    if (typeof document !== 'undefined' && !document.getElementById('ox-gh-chunk-css')) {
        const st = document.createElement('style');
        st.id = 'ox-gh-chunk-css';
        st.textContent = GH_CSS;
        document.head.appendChild(st);
    }
    installCore(P);
    installHistory(P);
    installSearch(P);
    installPlanning(P);
    installOps(P);
    installAnalytics(P);
    installRepo(P);
    installTransfer(P);
    installClone(P);
    installCommunity(P);
    installGists(P);
    installOrg(P);
    installReleases(P);
    P.__oxGH = { lib, tabs: Object.keys(TAB_DEFS) };
    return P.__oxGH;
}
