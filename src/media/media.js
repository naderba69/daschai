/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 10: Files & Media studio (lazy chunk assets/studio/media-[hash].mjs)
   Loaded on first use of the stubs in src/features/17-files-media.js (Alt+O, palette, explorer, gallery).
   Tabs: browse • smart • share • convert • start • image • video • audio • voice • call • create • player
   Also hosts the image editor + recorder moved out of the main bundle (legacy.js).
   ============================================================================== */
import MEDIA_CSS from './media.css';
import * as shared from './shared.js';
import * as aiio from './aiio.js';
import * as dsp from './dsp.js';
import { installCore, TAB_DEFS } from './core.js';
import { installLegacy } from './legacy.js';
import { installMeta, STATUSES, KINDS, fileRows, filterRows, SORT_KEYS, sortRows, asciiTree, mermaidTree, fileDate, directLinks } from './meta.js';
import { installPreviews, decodePSD, parseModel, modelBounds, renderModel, parseGeo, geoBounds, geoSVG, figmaEmbedUrl } from './previews.js';
import { installSmart, suggestMoves, isVagueName, nameFromContent, classifyFile, tokens, semanticSearch, missingFiles } from './smart.js';
import { installShare, CHUNK, encryptBytes, decryptBytes, makeSharePayload, openSharePayload, sigV4, PROVIDERS, fingerprint, chunkedUpload, syncPlan, codeOwnersFor } from './share.js';
import { installConvert, tarCreate, tarExtract, archiveType, extractArchive, createArchive, parseRanges, pdfSplit, pdfMerge, crc32, encodePNG, stripJPEG, minifySVG, scanBytes } from './convert.js';
import { installImport, TEMPLATES, cleanNotionExport, figmaFrames, figmaColorTokens } from './importx.js';
import { installImaging, removeBackgroundLocal, medianFilter, autoLevels, unsharp, kmeansPalette, traceMask, rdp, vectorize, STYLES, AI_EDITS, STICKERS } from './imaging.js';
import { installVideo, pickVideoMime, QUALITY, ENHANCE_FILTER, toVTT, toSRT, parseSubs, cuesFromModel, tokenizeLine, planFromComments } from './video.js';
import { installAudio, FREE_MUSIC } from './audio.js';
import { installVoice, LANGS, langName, langEn, matchSpokenPath, VOICE_COMMANDS, parseVoiceCommand, speechStats, paceLabel, pitchTrack, prosody, segmentsToText } from './voice.js';
import { installCall, ICE, encodeSignal, decodeSignal, gridLayout, slidesFromMarkdown } from './call.js';
import { installCreate, envelope, wrapLines, comicLayout, parseDialogue, chaptersOf } from './create.js';
import { installPlayer, defaultPlayerState, nextIndex, pushHistory, toEmbedUrl, embedCode } from './player.js';

/** Pure helpers exposed for unit tests (tests import the built chunk). */
export const lib = {
    ...shared, TAB_DEFS,
    hasKey: aiio.hasKey, splitSentences: aiio.splitSentences, pcmToFloat: aiio.pcmToFloat, concatAudio: aiio.concatAudio, readAudioStream: aiio.readAudioStream, AI_VOICES: aiio.AI_VOICES, toMono: aiio.toMono,
    STATUSES, KINDS, fileRows, filterRows, SORT_KEYS, sortRows, asciiTree, mermaidTree, fileDate, directLinks,
    decodePSD, parseModel, modelBounds, renderModel, parseGeo, geoBounds, geoSVG, figmaEmbedUrl,
    suggestMoves, isVagueName, nameFromContent, classifyFile, tokens, semanticSearch, missingFiles,
    CHUNK, encryptBytes, decryptBytes, makeSharePayload, openSharePayload, sigV4, PROVIDERS, fingerprint, chunkedUpload, syncPlan, codeOwnersFor,
    tarCreate, tarExtract, archiveType, extractArchive, createArchive, parseRanges, pdfSplit, pdfMerge, crc32, encodePNG, stripJPEG, minifySVG, scanBytes,
    TEMPLATES, cleanNotionExport, figmaFrames, figmaColorTokens,
    removeBackgroundLocal, medianFilter, autoLevels, unsharp, kmeansPalette, traceMask, rdp, vectorize, STYLES, AI_EDITS, STICKERS,
    pickVideoMime, QUALITY, ENHANCE_FILTER, toVTT, toSRT, parseSubs, cuesFromModel, tokenizeLine, planFromComments,
    dsp, FREE_MUSIC,
    LANGS, langName, langEn, matchSpokenPath, VOICE_COMMANDS, parseVoiceCommand, speechStats, paceLabel, pitchTrack, prosody, segmentsToText,
    ICE, encodeSignal, decodeSignal, gridLayout, slidesFromMarkdown,
    envelope, wrapLines, comicLayout, parseDialogue, chaptersOf,
    defaultPlayerState, nextIndex, pushHistory, toEmbedUrl, embedCode
};

export function install(app) {
    const P = Object.getPrototypeOf(app);
    if (P.__oxMedia) return P.__oxMedia;
    if (typeof document !== 'undefined' && !document.getElementById('ox-media-chunk-css')) {
        const st = document.createElement('style');
        st.id = 'ox-media-chunk-css';
        st.textContent = MEDIA_CSS;
        document.head.appendChild(st);
    }
    installLegacy(P);
    installCore(P);
    installMeta(P);
    installPreviews(P);
    installSmart(P);
    installShare(P);
    installConvert(P);
    installImport(P);
    installImaging(P);
    installVideo(P);
    installAudio(P);
    installVoice(P);
    installCall(P);
    installCreate(P);
    installPlayer(P);
    P.__oxMedia = { lib, tabs: Object.keys(TAB_DEFS) };
    return P.__oxMedia;
}
