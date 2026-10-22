// OX-Alpha Chrome extension — context menus + bridge to the OX-Alpha tab (postMessage → local REST API).
const DEFAULT_URL = 'https://daschai.vercel.app/';
const getCfg = () => chrome.storage.sync.get({ url: DEFAULT_URL, token: '' });

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({ id: 'ox-ask', title: 'اسأل OX-Alpha عن «%s»', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'ox-file', title: 'احفظ التحديد كملف في مشروع OX-Alpha', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'ox-page', title: 'أرسل هذه الصفحة إلى OX-Alpha (Markdown)', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'ox-link', title: 'افتح الرابط في OX-Alpha', contexts: ['link'] });
});

async function oxTab() {
    const { url } = await getCfg();
    const tabs = await chrome.tabs.query({ url: new URL(url).origin + '/*' });
    if (tabs.length) return tabs[0];
    const t = await chrome.tabs.create({ url, active: false });
    await new Promise(r => { const l = (id, info) => { if (id === t.id && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(l); setTimeout(r, 1500); } }; chrome.tabs.onUpdated.addListener(l); });
    return t;
}
/** Call OX-Alpha's local API through the page (window.postMessage bridge, token-protected). */
async function oxApi(method, path, body) {
    const { token } = await getCfg();
    const tab = await oxTab();
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', args: [method, path, body, token],
        func: (method, path, body, token) => new Promise((resolve) => {
            const id = Math.random().toString(36).slice(2);
            const t = setTimeout(() => resolve({ status: 504, body: { error: 'OX-Alpha API is disabled (Integrations → API)' } }), 15000);
            addEventListener('message', function h(e) { if (e.data && e.data.oxApiReply === id) { clearTimeout(t); removeEventListener('message', h); resolve(e.data); } });
            postMessage({ oxApi: { id, method, path, body, token } }, location.origin);
        }) });
    return res && res.result;
}
async function openAsk(text) {
    const { url } = await getCfg();
    chrome.tabs.create({ url: url + '?action=ask&q=' + encodeURIComponent(String(text).slice(0, 1800)) });
}
const slug = (s) => String(s || 'clip').toLowerCase().replace(/[^\w\u0600-\u06FF]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'clip';

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'ox-ask') return openAsk(info.selectionText);
    if (info.menuItemId === 'ox-link') return openAsk('حلّل هذا الرابط: ' + info.linkUrl);
    if (info.menuItemId === 'ox-file') {
        const r = await oxApi('PUT', '/api/v1/files/clips/' + slug(tab.title) + '.txt', { content: info.selectionText + '\n\n— ' + tab.url + '\n' });
        return notify(r);
    }
    if (info.menuItemId === 'ox-page') {
        const [page] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ title: document.title, url: location.href, text: (document.querySelector('article, main') || document.body).innerText.slice(0, 200000) }) });
        const p = page.result;
        const r = await oxApi('PUT', '/api/v1/files/clips/' + slug(p.title) + '.md', { content: '# ' + p.title + '\n\n> ' + p.url + '\n\n' + p.text + '\n' });
        return notify(r);
    }
});
function notify(r) {
    const ok = r && r.status >= 200 && r.status < 300;
    chrome.action.setBadgeText({ text: ok ? '✓' : '!' });
    chrome.action.setBadgeBackgroundColor({ color: ok ? '#16a34a' : '#dc2626' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
    return ok;
}
chrome.runtime.onMessage.addListener((m, _s, reply) => {
    if (m && m.type === 'ask') { openAsk(m.text); reply(true); }
    if (m && m.type === 'api') { oxApi(m.method, m.path, m.body).then(reply); return true; }
});
