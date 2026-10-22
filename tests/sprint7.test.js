/* Sprint 7 — UI shell, conversations, delight (ideas #271-#410) + the lazy UI chunk. */
'use strict';
require('fake-indexeddb/auto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pathToFileURL } = require('url');
const { loadApp, ok, wait, section, gzipBudgetKB } = require('./helpers');

const ROOT = path.join(__dirname, '..');

/** Expose the jsdom window as Node globals so the ESM chunk (Node realm) can use the DOM. */
function exposeGlobals(w) {
    const names = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
        'KeyboardEvent', 'MouseEvent', 'Event', 'CustomEvent', 'localStorage', 'location', 'history', 'Blob', 'innerWidth', 'innerHeight', 'devicePixelRatio'];
    for (const n of names) Object.defineProperty(globalThis, n, { value: w[n], configurable: true, writable: true });
}

let W = null;
(async () => {
    const { w, d, app, errors } = loadApp({
        indexedDB: globalThis.indexedDB,
        beforeParse(win) {
            // recording 2D context (confetti, whiteboard, image export)
            const ctx = new Proxy({ __widths: [], measureText: (s) => ({ width: String(s).length * 8 }), createLinearGradient: () => ({ addColorStop() {} }) }, {
                get(t, k) { return k in t ? t[k] : () => {}; },
                set(t, k, v) { if (k === 'lineWidth') t.__widths.push(v); t[k] = v; return true; }
            });
            win.__ctx = ctx;
            win.HTMLCanvasElement.prototype.getContext = function () { return ctx; };
            win.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new win.Blob(['png'], { type: 'image/png' })); };
            win.Notification = class { constructor(t, o) { win.__notes = (win.__notes || []).concat([[t, o && o.body]]); } static requestPermission() { return Promise.resolve('granted'); } };
            win.Notification.permission = 'granted';
        }
    });
    W = w;
    exposeGlobals(w);
    const $ = (id) => d.getElementById(id);
    const imported = [];
    app.importModule = (url) => { imported.push(url); return import(pathToFileURL(path.join(ROOT, url)).href); };
    const downloads = [];
    app.downloadBlob = (blob, name) => { downloads.push({ blob, name }); };
    app.copyToClipboard = function (text) { this._copied = text; return true; };
    const resetSessions = (list) => { app.sessions = list; app.activeSessionId = list[0] ? list[0].id : null; app.saveSessions(); app.renderSessionList(); };
    const mk = (id, title, msgs = [], extra = {}) => ({ id, title, createdAt: Date.now() - 1000, updatedAt: Date.now() - 1000, messages: msgs, ...extra });
    const msg = (id, role, content, t = Date.now()) => ({ id, role, content, timestamp: t });
    await wait(50);

    // ------------------------------------------------------------------
    section('Lazy UI chunk + bundle budget');
    const build = w.OX_BUILD;
    ok(build && /^assets\/studio\/ui-\w+\.mjs$/.test(build.chunks.ui) && fs.existsSync(path.join(ROOT, build.chunks.ui)), 'OX_BUILD.chunks.ui points to the hashed UI chunk on disk');
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/studio/manifest.json'), 'utf8'));
    ok(manifest.chunks.ui === build.chunks.ui, 'manifest.json lists the UI chunk');
    const gz = zlib.gzipSync(fs.readFileSync(path.join(ROOT, 'index.html')), { level: 9 }).length / 1024;
    ok(gz < gzipBudgetKB, `main page stays under the ${gzipBudgetKB} KB gzip budget (${gz.toFixed(1)} KB)`);
    const stubs = app.lazyUIMethods();
    ok(stubs.length > 40 && stubs.every(n => typeof app[n] === 'function' && app[n].__oxLazy === 'ui'), 'panel entry points are lazy stubs before first use (' + stubs.length + ')');
    ok(!d.getElementById('ox-ui-chunk-css'), 'panel CSS is not in the page until the chunk loads');
    ok(app.preloadUIChunk() === true && d.querySelector(`link[rel="modulepreload"][href="${build.chunks.ui}"]`) && app.preloadUIChunk() === false, 'idle modulepreload of the UI chunk (once)');
    const mod = await import(pathToFileURL(path.join(ROOT, build.chunks.ui)).href);
    const dataKeys = ['DEVICES', 'TOUR_STEPS'];
    ok(JSON.stringify(mod.UI_METHODS.filter(n => !dataKeys.includes(n)).sort()) === JSON.stringify(stubs.slice().sort()), 'stub list matches the chunk exports exactly');
    const hits = await app.globalSearch('zzz-nothing');
    ok(Array.isArray(hits) && hits.length === 0 && imported.includes(build.chunks.ui), 'first call through a stub imports the chunk and returns its result');
    ok(stubs.every(n => !app[n].__oxLazy), 'chunk install replaced every stub with the real method');
    ok(d.getElementById('ox-ui-chunk-css') && /\.ox-gsearch/.test(d.getElementById('ox-ui-chunk-css').textContent), 'chunk injects its stylesheet once');
    let threw = false;
    try { await app.ui('nope'); } catch (e) { threw = /unknown ui method/.test(e.message); }
    ok(threw, 'app.ui() rejects unknown methods');
    const n0 = imported.length;
    await app.ensureUI();
    ok(imported.length === n0, 'chunk is imported only once');

    // ------------------------------------------------------------------
    section('Preferences (#327-#330)');
    const u = app.getUIPrefs();
    ok(u.density === 'comfortable' && u.textScale === 1 && u.notify.reply === true && u.notify.desktop === null, 'defaults (desktop notifications follow permission)');
    app.setUIPrefs({ sound: { volume: 0.2 } });
    ok(app.getUIPrefs().sound.volume === 0.2 && app.getUIPrefs().sound.pack === 'chime', 'setUIPrefs deep-merges nested objects');
    ok(JSON.parse(w.localStorage.getItem('ox_alpha_ui_v1')).sound.volume === 0.2, 'prefs persisted under ox_alpha_ui_v1 (backups + Gist sync)');
    const clean = app.sanitizeUIPrefs({ textScale: 'big', density: 'compact', evil: 1, notify: { desktop: false, reply: 'yes' }, customTheme: { bg: '#000000', text: 'red' }, shortcuts: { 'Ctrl+J': 'x', '<script>': 'y' } });
    ok(!('textScale' in clean) && clean.density === 'compact' && !('evil' in clean), 'sanitize drops unknown keys and wrong types');
    ok(clean.notify.desktop === false && !('reply' in clean.notify), 'nullable boolean (notify.desktop) survives sanitizing');
    ok(!('customTheme' in clean) && clean.shortcuts['Ctrl+J'] === 'x' && !clean.shortcuts['<script>'], 'partial / non-hex themes rejected, shortcut keys validated');
    const goodTheme = app.sanitizeUIPrefs({ customTheme: { bg: '#000000', surface: '#111111', card: '#222222', text: '#ffffff', accent: '#ff0000', x: 'y' } }).customTheme;
    ok(goodTheme && Object.keys(goodTheme).length === 5 && goodTheme.accent === '#ff0000', 'complete hex themes kept (extra keys dropped)');
    app.setUIPrefs({ density: 'compact', colorBlind: 'deuteranopia', meshBg: true, hideDetails: true });
    const root = d.documentElement;
    ok(root.getAttribute('data-density') === 'compact' && root.getAttribute('data-cb') === 'deuteranopia', 'density (#381) + color-blind palette (#333) applied');
    ok(d.body.classList.contains('mesh-bg') && d.body.classList.contains('hide-msg-details'), 'gradient mesh (#279) + hidden message details (#382)');
    app.setUIPrefs({ density: 'comfortable', colorBlind: 'none', meshBg: false, hideDetails: false });
    ok(app.setTextScale(3) === 1.6 && app.setTextScale(0.1) === 0.8 && root.style.getPropertyValue('--msg-scale') === '0.8', 'text zoom clamps 80-160% (#336)');
    app.setTextScale(1);
    ok(app.setUIMode('senior') && app.getUIPrefs().textScale === 1.25 && root.getAttribute('data-uimode') === 'senior', 'seniors mode enlarges text (#332)');
    ok(app.setUIMode('kids') && /KIDS|child|طفل|أطفال/i.test(app.decorateSystemPrompt('base', {})), 'kids mode adapts the system prompt (#331)');
    ok(app.setUIMode('bogus') === false, 'unknown UI mode rejected');
    app.setUIMode('normal');
    ok(app.getUIPrefs().mode === 'normal' && app.decorateSystemPrompt('base', {}) === 'base', 'back to normal mode');

    // ------------------------------------------------------------------
    section('Custom theme (#273) + layout (#285-#287, #283)');
    const dark = app.buildCustomTheme({ bg: '#101014', surface: '#18181c', card: '#202026', text: '#f5f5f5', accent: '#22c55e' });
    const light = app.buildCustomTheme({ bg: '#fafafa', surface: '#ffffff', card: '#f0f0f0', text: '#111111', accent: '#2563eb' });
    ok(!dark.light && light.light && dark.vars['--primary'] === '#22c55e' && /^#[0-9a-f]{6}$/i.test(dark.vars['--text-muted']), 'theme builder derives a full palette (light/dark aware)');
    app.setUIPrefs({ customTheme: { bg: '#101014', surface: '#18181c', card: '#202026', text: '#f5f5f5', accent: '#22c55e' } });
    app.applyTheme('custom', true);
    ok(root.style.getPropertyValue('--bg-base') === '#101014' && root.style.getPropertyValue('--primary') === '#22c55e', 'applyTheme("custom") applies the editor colors');
    app.applyTheme('dark', true);
    await app.openThemeEditor();
    ok($('theme-editor') && d.querySelectorAll('#theme-editor input[type="color"]').length >= 5, 'theme editor panel with color pickers');
    app.closeModals();
    ok(app.setStudioWidth(95) === 80 && app.setStudioWidth(5) === 20 && app.setSidebarWidth(1000) === 440, 'column widths clamp (#286)');
    app.setUIPrefs({ studioWidth: 0, sidebarWidth: 0 });
    ok($('studio-resizer') && $('sidebar-resizer') && $('studio-resizer').getAttribute('role') === 'separator', 'keyboard-accessible resizers (#286)');
    const segs = app.breadcrumbSegments('src/app/main.js');
    ok(segs.length === 3 && segs[1].path === 'src/app' && segs[1].dir && !segs[2].dir, 'studio breadcrumbs (#283)');
    app.toggleCodeStudio(true);
    ok($('content-workspace').classList.contains('studio-open'), 'workspace gets studio-open while the studio is open');
    app.toggleCodeStudio(false);
    ok(!$('content-workspace').classList.contains('studio-open'), 'studio-open removed when closed');
    ok(app.applyLayout('nope') === false && app.applyLayout('chat') === true && !app.isCodeStudioOpen, 'layout presets (#285)');
    app.toggleReadingMode(true);
    ok(d.body.classList.contains('reading-mode'), 'reading mode (#278)');
    app.toggleReadingMode(false);

    // ------------------------------------------------------------------
    section('Toasts (#291), notification center (#292, #293), banners (#317)');
    $('toast-container').innerHTML = '';
    for (let i = 0; i < 7; i++) app.showToast('t' + i, 'info');
    ok($('toast-container').children.length === 5, 'toasts stack to at most 5');
    let undone = 0;
    const pill = app.showToast('deleted', 'info', { action: { label: 'تراجع', run: () => undone++ } });
    pill.querySelector('.toast-action-btn').click();
    ok(undone === 1 && !pill.isConnected, 'toast action button runs and dismisses');
    ok(pill.querySelector('.toast-close-btn') !== null, 'toasts have a close button');
    app.clearNotifications();
    app.showToast('boom <b>x</b>', 'error');
    const notes = app.loadNotifications();
    ok(notes.length === 1 && notes[0].msg === 'boom x' && notes[0].type === 'error', 'errors are recorded in the notification center (tags stripped)');
    app.pushNotification({ msg: 'same' }); app.pushNotification({ msg: 'same' });
    ok(app.loadNotifications().length === 2, 'duplicate notifications within 3s are merged');
    ok(app.unreadNotifications() === 2 && $('notif-bell-badge') && $('notif-bell-badge').textContent === '2', 'bell badge counts unread');
    app.markNotificationsRead();
    ok(app.unreadNotifications() === 0, 'mark all read');
    app.openNotificationCenter();
    ok($('notif-center') && $('notif-center').textContent.includes('same'), 'notification center lists entries');
    app.closeDrawer(true); app.closeModals();
    app.setDnd(true);
    ok(app.notify('a', 'b') === false, 'DND silences notify()');
    app.setDnd(false);
    w.__notes = [];
    ok(app.notify('hello', 'world') === true && app.loadNotifications()[0].msg === 'world', 'notify() lands in the center');
    ok(app.relTime(Date.now() - 10e3) === 'الآن' && /د$/.test(app.relTime(Date.now() - 5 * 60e3)) && /س$/.test(app.relTime(Date.now() - 3 * 3600e3)), 'relative times');
    const b1 = app.showBanner({ id: 'ban-test', text: 'مرحبا', once: true, actions: [{ label: 'go', run: () => {} }] });
    ok(b1 && $('ox-banners').querySelector('[data-banner="ban-test"]') && b1.querySelector('.banner-btn-link'), 'banner with actions under the navbar');
    b1.querySelector('.ox-banner-close').click();
    await wait(10);
    ok(!$('ox-banners').querySelector('[data-banner="ban-test"]') && app.showBanner({ id: 'ban-test', text: 'x', once: true }) === null, '"once" banners stay dismissed');
    app.progressStart();
    ok($('ox-progress') && app._progCount === 1, 'top progress bar starts (#296)');
    app.progressDone();
    ok(app._progCount === 0, 'top progress bar completes');

    // ------------------------------------------------------------------
    section('Shortcuts (#282, #324) + suggestions (#323) + share (#328-#330)');
    const combo = app.eventCombo({ key: 'j', ctrlKey: true, altKey: true });
    ok(combo === 'Ctrl+Alt+J' && app.eventCombo({ key: 'Shift' }) === '' && app.eventCombo({ key: 'F7' }) === 'F7', 'key combos normalised');
    ok(app.isValidShortcut('Ctrl+J') && app.isValidShortcut('F7') && !app.isValidShortcut('J') && !app.isValidShortcut('F1'), 'only Ctrl/Alt combos and F2-F12');
    const label = app.buildPaletteCommands().find(c => /مركز الإشعارات/.test(c.label));
    ok(label && app.setShortcut('Ctrl+Alt+J', label.label) && app.getUIPrefs().shortcuts['Ctrl+Alt+J'] === label.label, 'bind a palette command to a shortcut');
    ok(app.setShortcut('J', label.label) === false && app.setShortcut('Ctrl+Alt+Y', 'no such command') === false, 'invalid shortcut / unknown command rejected');
    app.closeDrawer(true);
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'j', ctrlKey: true, altKey: true, bubbles: true }));
    ok(!!$('notif-center'), 'custom shortcut runs the command');
    app.closeDrawer(true);
    ok(app.shortcutConflict('Ctrl+K') && app.shortcutConflict('Ctrl+Alt+J') === null, 'conflicts with built-in shortcuts are detected');
    app.removeShortcut('Ctrl+Alt+J');
    ok(!app.getUIPrefs().shortcuts['Ctrl+Alt+J'], 'shortcut removed');
    app.addQuickSuggestion('اختبار', 'اكتب اختبارات');
    ok(d.querySelector('[data-qs="custom:0"]') && d.querySelector('[data-qs="custom:0"]').textContent.includes('اختبار'), 'custom quick suggestions in the welcome tray (#323)');
    app.removeQuickSuggestion(0);
    app.setUIPrefs({ brand: { name: 'MyLab', emoji: '🧪' }, density: 'spacious' });
    const link = app.uiShareLink();
    const parsed = app.parseUIShareHash(link.slice(link.indexOf('#')));
    ok(parsed && parsed.prefs.brand.name === 'MyLab' && parsed.prefs.density === 'spacious' && !('toured' in parsed.prefs), 'share link round-trips customization (#330)');
    app.setUIPrefs({ brand: { name: '', emoji: '' }, density: 'comfortable' });
    ok(app.importUIConfig(parsed) > 0 && app.getUIPrefs().brand.name === 'MyLab', 'import applies shared customization (#329)');
    ok(app.importUIConfig('{bad') === false && app.importUIConfig({ app: 'other', prefs: {} }) === false && app.parseUIShareHash('#ui=@@') === null, 'bad configs rejected');
    app.downloadUIConfig();
    ok(downloads.some(x => /\.json$/.test(x.name)), 'export customization file (#328)');
    app.setUIPrefs({ brand: { name: '', emoji: '' }, density: 'comfortable' });

    // ------------------------------------------------------------------
    section('Lazy panels: settings, help, tour, lightbox (#301, #303, #308, #325)');
    for (const tab of ['appearance', 'a11y', 'notify', 'brand', 'shortcuts', 'share']) {
        await app.openUISettings(tab);
    }
    ok($('ui-settings') && d.querySelector('#ui-settings') !== null, 'UI settings panel renders every tab');
    app.closeModals();
    await app.openContextHelp();
    ok(d.querySelector('.help-grid kbd'), 'context help lists keyboard shortcuts (#303)');
    app.closeModals();
    app.setUIPrefs({ toured: false }, { apply: false });
    ok(await app.startTour() === true && $('ox-tour') && app._tour.steps.length > 0, 'onboarding tour starts (#301)');
    app.tourStep(1);
    ok(app._tour.i === Math.min(1, app._tour.steps.length - 1), 'tour advances');
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ok(!$('ox-tour') && app.getUIPrefs().toured === true, 'Esc ends the tour and remembers it');
    await app.openLightbox('data:image/png;base64,AAAA', ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB']);
    ok($('ox-lightbox') && $('ox-lightbox').classList.contains('active'), 'image lightbox opens (#308)');
    app.lightboxAction('next');
    ok(app._lb && app._lb.i === 1, 'lightbox gallery navigation');
    app.lightboxAction('close');
    ok(!app._lb, 'lightbox closes');

    // ------------------------------------------------------------------
    section('Conversations: filters, tags, folders, pin/archive/mute (#305, #306, #344-#348)');
    resetSessions([
        mk('s_a', 'Alpha React', [msg('m1', 'user', 'how to use hooks'), msg('m2', 'assistant', '```js\nuseState()\n```')], { createdAt: 1, updatedAt: Date.now() - 5000 }),
        mk('s_b', 'Beta Python', [msg('m3', 'user', 'pandas dataframe')], { createdAt: 2, updatedAt: Date.now() - 1000 }),
        mk('s_c', 'Gamma', [msg('m4', 'user', 'old talk', Date.now() - 20 * 864e5)], { createdAt: 3, updatedAt: Date.now() - 20 * 864e5 })
    ]);
    app.setSessionView({ filter: 'all', tag: '', folder: '', sort: 'updated', query: '' });
    ok(app.filteredSessions().map(s => s.id).join() === 's_b,s_a,s_c', 'sorted by last activity');
    app.togglePinSession('s_c');
    ok(app.filteredSessions()[0].id === 's_c' && app.findSession('s_c').pinned, 'pinned conversations stay on top (#346)');
    ok(app.filteredSessions({ filter: 'all', sort: 'title' }).map(s => s.id).join() === 's_c,s_a,s_b', 'sort by title, pins first (#306)');
    ok(app.filteredSessions({ filter: 'code' }).map(s => s.id).join() === 's_a', 'filter: has code');
    ok(app.filteredSessions({ filter: 'week' }).every(s => s.id !== 's_c'), 'filter: this week');
    app.toggleArchiveSession('s_b');
    ok(app.findSession('s_b').archived && !app.filteredSessions({ filter: 'all' }).some(s => s.id === 's_b') && app.filteredSessions({ filter: 'archived' })[0].id === 's_b', 'archive hides from the main list (#347)');
    app.toggleArchiveSession('s_b');
    ok(app.parseTags('#react, ui،  ui  frontend').join() === 'react,ui,frontend', 'tag parsing (Arabic comma, dedupe, #)');
    app.setSessionTags('s_a', '#react, hooks');
    ok(app.allTags().some(([t]) => t === 'react') && app.filteredSessions({ filter: 'all', tag: 'hooks' }).map(s => s.id).join() === 's_a', 'tags + tag filter (#344)');
    app.setSessionFolder('s_b', 'Data');
    ok(app.allFolders().includes('Data') && app.filteredSessions({ filter: 'all', folder: 'Data' }).map(s => s.id).join() === 's_b', 'folders (#345)');
    ok(app.sessionMatches(app.findSession('s_b'), 'dataframe') && app.sessionMatches(app.findSession('s_a'), '#hooks') && !app.sessionMatches(app.findSession('s_a'), 'pandas'), 'search covers titles, tags and message text');
    app.filterSessions('pandas');
    ok(d.querySelectorAll('#sessions-list .session-item-row').length === 1, 'sidebar search filters the list');
    app.filterSessions('');
    app.toggleMuteSession('s_b');
    ok(app.findSession('s_b').muted && d.querySelector('.session-item-row[data-sid="s_b"] .sess-muted'), 'mute a conversation (#348)');
    app.activeSessionId = 's_a';
    app.clearNotifications();
    ok(app.handleReplyComplete({ sessionId: 's_b', messageId: 'm3' }) === false && app.loadNotifications().length === 0, 'muted conversations do not notify on reply');
    app.toggleMuteSession('s_b');
    ok(app.handleReplyComplete({ sessionId: 's_b', messageId: 'm3' }) === true && app.loadNotifications()[0].sessionId === 's_b', 'background replies notify when not muted (#293)');
    const copy = app.duplicateSession('s_a');
    ok(copy && copy.id !== 's_a' && /نسخة/.test(copy.title) && copy.messages.length === 2 && !copy.pinned, 'duplicate a conversation');
    ok(app.exportSessionsJSON(['s_a', 's_b']) === 2 && downloads.some(x => x.name === 'chats-2.json'), 'export selected conversations as JSON');

    // ------------------------------------------------------------------
    section('Trash with undo (#350), favorites (#343), message links (#384), recent searches');
    app._trash = [];
    app.deleteSession(copy.id);
    ok(!app.findSession(copy.id) && app.trashCount() === 1, 'deleting moves to the trash');
    const undoBtn = Array.from(d.querySelectorAll('.toast-action-btn')).pop();
    undoBtn.click();
    ok(app.findSession(copy.id) && app.trashCount() === 0, 'undo from the toast restores it');
    app.deleteSession(copy.id);
    await app.openTrash();
    ok($('trash-list') && $('trash-list').textContent.includes('نسخة'), 'trash panel lists deleted conversations');
    app.restoreFromTrash(copy.id, { switch: false, silent: true });
    ok(app.findSession(copy.id) && app.trashCount() === 0, 'restore from the trash');
    app.closeModals();
    app._trash = [{ session: mk('old', 'x', [msg('q', 'user', 'y')]), deletedAt: Date.now() - 31 * 864e5 }];
    ok(app.purgeTrash() === 1 && app.trashCount() === 0, 'trash auto-purges after 30 days');
    app.bulkDeleteSessions([copy.id]);
    app.emptyTrash();
    ok(app.trashCount() === 0, 'empty trash');
    ok(app.toggleFavoriteMessage('m3', 's_b') === true && app.favoriteMessages().length === 1 && app.filteredSessions({ filter: 'fav' })[0].id === 's_b', 'favorite messages + "favorites" filter');
    await app.openFavorites();
    ok($('fav-list') && $('fav-list').textContent.includes('pandas'), 'favorites panel');
    app.closeModals();
    app.toggleFavoriteMessage('m3', 's_b');
    ok(app.favoriteMessages().length === 0, 'unfavorite');
    const ml = app.messageLink('s_b', 'm3');
    ok(/#s=s_b&m=m3$/.test(ml) && JSON.stringify(app.parseMessageHash(ml.slice(ml.indexOf('#')))) === '{"sessionId":"s_b","msgId":"m3"}', 'permalink to a message (#384)');
    app.clearRecentSearches();
    app.addRecentSearch('react'); app.addRecentSearch('x'); app.addRecentSearch('React'); app.addRecentSearch('vue');
    ok(app.getRecentSearches().join() === 'vue,React', 'recent searches (deduped, newest first)');

    // ------------------------------------------------------------------
    section('Global search (#304), conversation manager (#307, #349), compare (#351)');
    app.virtualProjectFiles.set('src/hooks.js', { content: 'export const useThing = () => 1;\n// pandas joke', lang: 'js' });
    const res = app.globalSearch('pandas');
    const groups = new Set(res.map(r => r.group));
    ok(groups.has('الرسائل') && groups.has('الملفات'), 'global search spans messages and files');
    ok(app.globalSearch('alpha').some(r => r.group === 'المحادثات') && app.globalSearch('مركز الإشعارات').some(r => r.group === 'الأوامر'), 'and conversations + commands');
    await app.openGlobalSearch('hooks');
    ok(d.querySelector('.ox-gsearch.active') && d.querySelectorAll('.gs-item').length > 0, 'search overlay renders results');
    app.closeGlobalSearch();
    ok(!d.querySelector('.ox-gsearch.active'), 'search overlay closes');
    await app.openConversationManager();
    ok($('cm-list') && d.querySelectorAll('#cm-list .cm-card').length >= 3, 'conversation manager grid');
    app.cmToggleSelect('s_a', true); app.cmToggleSelect('s_b', true);
    ok(await app.cmBulk('tag', 'bulk') === 2 && app.findSession('s_a').tags.includes('bulk') && app.findSession('s_b').tags.includes('bulk'), 'bulk tagging');
    ok(await app.cmBulk('archive') === 2 && app.findSession('s_a').archived, 'bulk archive');
    await app.cmBulk('unarchive');
    app.closeModals();
    ok(await app.openCompareSessions('s_a', 's_b') === true && $('cmp-a') && $('cmp-b') && $('cmp-b').textContent.includes('pandas'), 'side-by-side comparison');
    app.closeModals();

    // ------------------------------------------------------------------
    section('Delight: XP, levels, rewards, challenges (#363-#370)');
    app._game = null; w.localStorage.removeItem('ox_alpha_game_v1');
    ok(app.levelFor(0) === 1 && app.levelFor(39) === 1 && app.levelFor(40) === 2 && app.levelFor(160) === 3 && app.xpForLevel(3) === 160, 'level curve');
    const pi = app.progressInfo(100);
    ok(pi.level === 2 && pi.cur === 40 && pi.next === 160 && pi.pct === 50, 'progress to next level');
    const day0 = new Date(2026, 5, 10, 12).getTime();
    ok(app.addXP(50, 'message', day0) === 50 && app.addXP(50, 'message', day0) === 10 && app.addXP(5, 'message', day0) === 0, 'daily XP cap per activity');
    ok(app.addXP(5, 'message', day0 + 864e5) === 5, 'cap resets the next day');
    ok(app.getGame().xp === 65 && app.progressInfo().level === 2 && app.hasReward('badge-2') !== undefined, 'XP persisted, level 2 reached');
    ok(JSON.parse(w.localStorage.getItem('ox_alpha_game_v1')).xp === 65, 'game state saved');
    ok(app.REWARDS.some(r => r.type === 'theme') && typeof app.rewardThemesHTML() === 'string', 'reward themes catalogue (#370)');
    app.getGame().xp = app.xpForLevel(5);
    ok(app.hasReward('aurora') === app.REWARDS.some(r => r.id === 'aurora' && r.level <= 5), 'theme rewards unlock by level');
    await app.openThemeEditor();
    ok(/theme-seed/.test($('theme-editor').innerHTML), 'theme editor shows reward themes');
    app.closeModals();
    const c1 = app.challengeForDay(day0), c2 = app.challengeForDay(day0 + 864e5);
    ok(c1.title && c1.prompt && c1.id === '2026-06-10' && c1.title !== c2.title && app.CHALLENGES.length === 30, 'one of 30 daily challenges per day');
    ok(app.completeDailyChallenge(day0) === 1 && app.completeDailyChallenge(day0) === false && app.challengeDone(day0), 'complete today\'s challenge once');
    ok(app.completeDailyChallenge(day0 + 864e5) === 2 && app.completeDailyChallenge(day0 + 3 * 864e5) === 1, 'streak grows on consecutive days and resets after a gap');
    ok(Object.keys(app.CHAT_MODES).length === 14 && ['learn', 'quiz', 'game', 'story'].every(k => app.CHAT_MODES[k] && app.CHAT_MODES[k].prompt), 'learn / quiz / game / story modes (#401, #403, #405, #406)');
    app.confetti({ count: 20 });
    ok(true, 'confetti runs without a real canvas');

    // ------------------------------------------------------------------
    section('Time-aware content (#391-#398)');
    ok(/صباح/.test(app.greetingFor(8, 'سارة')) && /سارة/.test(app.greetingFor(8, 'سارة')) && /مساء/.test(app.greetingFor(19)) && /سهرة/.test(app.greetingFor(2)), 'greeting by time of day');
    ok(app.timeSuggestions(new Date(2026, 0, 5, 9).getTime()).length > 0 && app.timeSuggestions(new Date(2026, 0, 5, 9).getTime())[0].label !== app.timeSuggestions(new Date(2026, 0, 5, 23).getTime())[0].label, 'suggestions change with the hour');
    const hj = app.hijriParts(new Date(2026, 1, 20, 12).getTime());
    ok(hj === null || (hj.month >= 1 && hj.month <= 12 && hj.day >= 1), 'Hijri date parts (Umm al-Qura)');
    ok(['winter', 'spring', 'summer', 'autumn', 'ramadan'].includes(app.seasonFor(new Date(2026, 6, 1).getTime())) && app.seasonFor(new Date(2026, 6, 1).getTime()) !== 'winter', 'season detection');
    if (hj) ok(app.seasonFor(new Date(2026, 1, 25, 12).getTime()) === 'ramadan', 'Ramadan season from the Hijri calendar (Feb 2026)');
    else ok(true, 'Hijri calendar unavailable in this ICU — skipped');
    ok(app.eventsFor(new Date(2026, 0, 1, 10).getTime()).some(e => e.id === 'newyear') && app.eventsFor(new Date(2026, 8, 13, 10).getTime()).some(e => e.id === 'programmers-day'), 'events: new year + programmers\' day');
    ok(app.pickDaily(['a', 'b', 'c'], day0) === app.pickDaily(['a', 'b', 'c'], day0 + 3600e3) && app.TIPS.length >= 20 && app.QUOTES.length >= 20, 'daily tip / quote is stable during the day');
    app.setUIPrefs({ dailyGoal: 4 });
    const g = app.dailyGoalProgress();
    ok(g.goal === 4 && g.pct >= 0 && g.pct <= 100, 'daily goal progress (#365)');
    app.updateLiveStats();
    ok(!$('live-stats') || /\d/.test($('live-stats').textContent), 'live stats counter');

    // ------------------------------------------------------------------
    section('Dev tools (#371-#380), devices, image export, PiP, audio');
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'd', code: 'KeyD', ctrlKey: true, altKey: true, bubbles: true }));
    await wait(30);
    ok(d.querySelector('.ox-devhud'), 'Ctrl+Alt+D opens the dev HUD');
    const m = app.devMetrics();
    ok(m.dom > 100 && typeof m.storageKB === 'number' && m.sessions === app.sessions.length && m.net === 'off', 'live dev metrics');
    app.toggleDevHUD(false);
    ok(!d.querySelector('.ox-devhud'), 'HUD closes');
    ok(app.setNetworkSim('offline') === 'offline' && $('offline-banner') && /محاكاة/.test($('offline-banner').textContent), 'offline simulation shows a banner');
    ok(app.setNetworkSim('off') === null && app.setNetworkSim('warp') === false, 'network simulation off / invalid');
    const probe = d.createElement('div'); probe.className = 'a b active'; const host = d.createElement('section'); host.id = 'hostx'; host.appendChild(d.createElement('div')); host.appendChild(probe); d.body.appendChild(host);
    ok(app.cssPath(probe) === '#hostx > div.a.b:nth-of-type(2)', 'inspect: unique CSS path (#373)');
    host.remove();
    const fs1 = app.deviceFrameSize('iphone-15', false, 300, 2000);
    ok(fs1.w === 393 && fs1.h === 852 && fs1.scale < 1 && app.deviceFrameSize('iphone-15', true).w === 852, 'device emulator frame sizes (#376)');
    app.virtualProjectFiles.set('index.html', { content: '<h1>Hi</h1>', lang: 'html' });
    const realStudio = app.studio;
    app.studio = async () => '';
    ok(await app.openDeviceEmulator() === true, 'device emulator opens an HTML file');
    app.studio = realStudio;
    ok(d.querySelector('.emu-device iframe') && d.querySelector('.emu-device iframe').getAttribute('sandbox') !== null, 'device emulator uses a sandboxed iframe');
    app.closeModals();
    const lay = app.layoutConversation([msg('x1', 'user', 'hello world '.repeat(40)), msg('x2', 'assistant', 'code:\n```js\nconst a = 1;\n```')], { width: 600 });
    ok(lay.width === 600 && lay.lines.filter(l => l.kind === 'bubble').length === 2 && lay.lines.some(l => l.kind === 'code' && l.text.includes('const a')) && lay.lines.filter(l => l.kind === 'text').length > 3, 'conversation image layout wraps text and code (#385)');
    downloads.length = 0;
    await app.exportMessagesImage('s_b');
    ok(downloads.some(x => /\.png$/.test(x.name)), 'export a conversation as PNG (#388)');
    await app.openMiniChat();
    ok(d.getElementById('ox-mini-chat'), 'mini chat window (Picture-in-Picture fallback) (#390)');
    d.getElementById('ox-mini-chat').remove();
    ok(app.speakableText('# Title\n```js\ncode()\n```\n**bold** [link](http://x)').includes('Title') && !app.speakableText('```js\ncode()\n```').includes('code()'), 'audio mode reads text, skips code (#408)');
    const spoken = [];
    app.speakText = (t) => { spoken.push(t); };
    app.setVoiceConversation('driving');
    ok(d.querySelector('.ox-drive') && app._voice && app._voice.mode === 'driving', 'driving mode (#359)');
    app.setVoiceConversation(null);
    ok(!d.querySelector('.ox-drive') && !app._voice, 'driving mode exits');

    // ------------------------------------------------------------------
    section('Whiteboard pressure (#357) + monthly report (#400)');
    app._wb = { items: [{ tool: 'pen', color: '#000', size: 4, pressure: true, points: [[0, 0, 0.1], [10, 10, 0.2], [20, 20, 1]] }], bg: 'white' };
    w.__ctx.__widths.length = 0;
    app.wbRenderTo(d.createElement('canvas'));
    const widths = w.__ctx.__widths.filter(x => x !== 1);
    ok(widths.length >= 2 && Math.max(...widths) > Math.min(...widths), 'stylus pressure varies the stroke width');
    app._wb = null;
    const rep = app.buildActivityReport('month');
    ok(/الشهري/.test(rep.split('\n')[0]), 'monthly activity report');

    await wait(30);
    ok(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
    w.close();
})().catch(e => { console.error('❌ test crashed:', e); process.exitCode = 1; if (W) W.close(); });
