/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 8: AI lab (lazy chunk assets/studio/ai-[hash].mjs)
   Loaded on first use through app.aiLab(...) / the stubs in src/features/15-ai-lab.js.
   Ideas: #1 #4 #5 #14 #15 #17-#26 #28-#31 #33 #34 #36-#43 #45-#60 #63-#65 #72-#88 #90-#101 #104-#123 #126-#130
   ============================================================================== */
import AI_CSS from './ai.css';
import * as shared from './shared.js';
import * as analyzers from './analyzers.js';
import { installCore } from './core.js';
import { installGenerators, GENERATORS } from './generators.js';
import { installTools, generatePalette, contrastRatio, certificateSVG } from './tools.js';
import { installReasoning, parseSteps, parseJudge } from './reasoning.js';
import { installAgent, tokenize, rankMemories, parseAgentStep } from './agent.js';
import { installLibrary } from './library.js';
import { installMedia, cleanCompletion, voiceCommand } from './media.js';

/** Pure helpers exposed for unit tests (tests import the built chunk). */
export const lib = { ...shared, ...analyzers, generatePalette, contrastRatio, certificateSVG, parseSteps, parseJudge, tokenize, rankMemories, parseAgentStep, cleanCompletion, voiceCommand, GENERATORS };

export function install(app) {
    const P = Object.getPrototypeOf(app);
    if (P.__oxAI) return P.__oxAI;
    if (typeof document !== 'undefined' && !document.getElementById('ox-ai-chunk-css')) {
        const st = document.createElement('style');
        st.id = 'ox-ai-chunk-css';
        st.textContent = AI_CSS;
        document.head.appendChild(st);
    }
    installCore(P);
    installGenerators(P);
    installTools(P);
    installReasoning(P);
    installAgent(P);
    installLibrary(P);
    installMedia(P);
    P.__oxAI = { lib, generators: GENERATORS.length };
    return P.__oxAI;
}
