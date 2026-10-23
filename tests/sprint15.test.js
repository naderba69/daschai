/* Sprint 15 — edit, regenerate, version-switch, branch and undo messages. */
require('fake-indexeddb/auto');
const { loadApp, mockOpenRouter, ok, waitFor, section } = require('./helpers');

(async () => {
    const router = mockOpenRouter(async (body, call) => ({
        text: `الرد ${call} على: ${body.messages.filter(m => m.role === 'user').at(-1)?.content || ''}`,
        usage: { prompt_tokens: 12, completion_tokens: 8, cost: 0.0001 }
    }));
    const { app, d, w } = loadApp({ fetchImpl: router.fetchImpl, indexedDB: globalThis.indexedDB });
    await waitFor(() => app && app.activeSessionId && typeof app.regenerateMessage === 'function');
    app.settings.apiKey = 'test-key';
    app.settings.model = 'test/model-a';
    app.isSmartRouterActive = false;
    const originalSid = app.activeSessionId;
    const session = app.sessions.find(s => s.id === originalSid);

    section('Actions and inline editing');
    await app.sendUserMessage('السؤال الأول');
    let user = session.messages[0], answer = session.messages[1];
    ok(router.calls.length === 1 && user.content === 'السؤال الأول' && answer.status === 'completed', 'ordinary send creates a completed user/assistant pair');
    ok(d.querySelector(`#m-${user.id} .msg-act-edit`) && d.querySelector(`#m-${answer.id} .msg-act-regen`), 'edit and regenerate actions are visible on their respective messages');
    await app.sendUserMessage('سؤال المتابعة');
    ok(session.messages.length === 4 && session.messages[3].status === 'completed', 'a later exchange is present before editing an earlier prompt');
    d.querySelector(`#m-${user.id} .msg-act-edit`)?.click();
    ok(d.querySelector(`#m-${user.id} .msg-edit-input`)?.value === 'السؤال الأول', 'clicking the edit action opens a prefilled inline editor');
    const textarea = d.querySelector(`#m-${user.id} .msg-edit-input`);
    textarea.value = 'السؤال بعد التعديل';
    await app.submitEditMessage(user.id);
    ok(router.calls.length === 3 && router.calls[2].messages.at(-1).content.includes('السؤال بعد التعديل'), 'editing resends the changed prompt to the model');
    ok(user.content === 'السؤال بعد التعديل' && user.edited && session.messages[1].status === 'completed', 'edited prompt and new answer become the current path');
    ok(user.versions?.length === 2 && user.vi === 1 && user.versions[0].tail[0].content.startsWith('الرد 1'), 'the original prompt and its answer are saved as a prior version');
    const editedTitle = session.title;

    section('Restore full conversation branch and switch back');
    d.querySelector(`#m-${user.id} .msg-ver-prev`)?.click();
    ok(user.content === 'السؤال الأول' && session.messages.length === 4 && session.messages[1].content.startsWith('الرد 1') && session.messages[2].content === 'سؤال المتابعة', 'switching back restores the original reply and the full following conversation');
    ok(session.title === 'السؤال الأول', 'switching versions restores the matching conversation title');
    d.querySelector(`#m-${user.id} .msg-ver-next`)?.click();
    ok(user.content === 'السؤال بعد التعديل' && session.messages.length === 2 && session.title === editedTitle, 'switching forward restores the edited branch and its title');

    section('Regeneration and alternate model');
    answer = session.messages[1];
    const firstAnswer = answer.content;
    d.querySelector(`#m-${answer.id} .msg-act-regen`)?.click();
    await waitFor(() => answer.status === 'completed');
    ok(router.calls.length === 4 && answer.content.startsWith('الرد 4') && answer.versions?.length === 2 && answer.vi === 1, 'regeneration requests a fresh answer while keeping the previous one');
    ok(app.switchMessageVersion(answer.id, 0) && answer.content === firstAnswer, 'the previous assistant response can be restored');
    ok(app.switchMessageVersion(answer.id, 1) && answer.content.startsWith('الرد 4'), 'the regenerated response can be restored again');
    const pending = app.regenerateWithOtherModel(answer.id);
    const modelInput = d.getElementById('oxd-regen-model');
    ok(!!modelInput, 'alternate-model picker uses the app dialog');
    if (modelInput) modelInput.value = 'test/model-a';
    d.querySelector('#ox-dialog-buttons button')?.click();
    ok(!!d.getElementById('ox-dialog-error')?.textContent && !!d.getElementById('ox-dialog')?.classList.contains('active'), 'the current model is rejected without closing the picker');
    if (modelInput) modelInput.value = 'test/model-b';
    d.querySelector('#ox-dialog-buttons button')?.click();
    await pending;
    ok(router.calls.length === 5 && router.calls[4].model === 'test/model-b', 'regeneration accepts a different model and records the result');

    section('Fork and deletion with undo');
    // The edit created two conversation branches; a fork copies only the visible/current path.
    const originalLength = session.messages.length;
    const fork = app.forkSessionAt(user.id);
    ok(fork && fork.id !== originalSid && fork.messages.length === 1 && fork.messages[0].content === user.content, 'fork makes a new conversation prefix without changing the original');
    ok(app.sessions.find(s => s.id === originalSid).messages.length === originalLength, 'the source conversation remains unchanged after forking');
    app.switchSession(originalSid);
    const activeUser = session.messages[0];
    const beforeDelete = session.messages.length;
    const titleBeforeDelete = session.title;
    ok(app.deleteMessage(activeUser.id) === 2 && session.messages.length === beforeDelete - 2 && session.title === 'محادثة جديدة', 'deleting a user message also removes its paired answer and refreshes the empty-session title');
    ok(typeof app._lastDeleted?.undo === 'function', 'delete offers an undo action');
    app._lastDeleted.undo();
    ok(session.messages.length === beforeDelete && session.messages[0].id === activeUser.id && session.title === titleBeforeDelete, 'undo restores both messages, their title and their original position');

    section('Guards and keyboard shortcut');
    app.activeStreams.set(originalSid, new AbortController());
    const blockedRegen = await app.regenerateMessage(answer.id);
    const blockedDelete = app.deleteMessage(activeUser.id);
    app.renderMessages();
    ok(blockedRegen === false && blockedDelete === false && !d.querySelector(`#m-${activeUser.id} .msg-act-edit`) && !d.querySelector(`#m-${answer.id} .msg-act-regen`), 'rewrite and delete are blocked, and their actions disappear while the conversation is streaming');
    app.activeStreams.delete(originalSid);
    const input = d.getElementById('user-input');
    input.value = '';
    input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    ok(!!d.querySelector('.msg-edit-input'), 'ArrowUp in an empty composer opens the latest user message for editing');
    app.cancelEditMessage();

    section('Version retention and durable storage');
    const cappedSession = { id: 'cap', title: 'cap', messages: [{ id: 'cap-msg', role: 'user', content: 'v0' }] };
    for (let i = 1; i <= 25; i++) { cappedSession.messages[0].content = `v${i}`; app.openNewVersion(cappedSession, 0); }
    ok(cappedSession.messages[0].versions.length === 20 && cappedSession.messages[0].vi === 19, 'version history is capped at 20 entries per message');
    const flushed = await app.flushSessionsToIDB();
    const stored = await app.idbGet('sessions');
    const persisted = stored && stored.sessions.find(s => s.id === originalSid);
    ok(flushed && persisted?.messages[0]?.versions?.[0]?.tail?.length >= 3, 'edited versions and their full conversation tails survive IndexedDB persistence');

    // Exercise the LocalStorage quota fallback for nested version tails too.
    const priorSessions = app.sessions, storageProto = w.Storage.prototype, originalSetItem = storageProto.setItem;
    let failFirstWrite = true;
    storageProto.setItem = function (key, value) {
        if (key === 'ox_alpha_sessions_v2' && failFirstWrite) { failFirstWrite = false; throw new w.DOMException('quota exceeded', 'QuotaExceededError'); }
        return originalSetItem.call(this, key, value);
    };
    const longText = 'م'.repeat(2500);
    app.sessions = [{ id: 'quota-test', messages: [{ id: 'q', role: 'user', content: 'q', versions: [null, { content: 'old', tail: [{ id: 'tail', role: 'assistant', attachments: [{ name: 'old.txt', textContent: longText }] }] }], vi: 0 }] }];
    app.safeStorageSet('ox_alpha_sessions_v2', 'oversized');
    let compact = null;
    try { compact = JSON.parse(app.lzUnpack(w.localStorage.getItem('ox_alpha_sessions_v2'))); } catch (e) {}
    const compactText = compact?.[0]?.messages?.[0]?.versions?.[1]?.tail?.[0]?.attachments?.[0]?.textContent || '';
    ok(compactText.startsWith('[محتوى المرفق: old.txt'), 'quota recovery also compacts attachments nested in saved message versions');
    app.sessions = priorSessions;
    storageProto.setItem = originalSetItem;

    w.close();
})().catch(e => { console.error(e); process.exitCode = 1; });
