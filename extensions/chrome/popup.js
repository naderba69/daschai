const $ = (id) => document.getElementById(id);
chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
    try { const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => String(getSelection()) }); if (r && r.result) $('q').value = r.result; } catch (e) { /* chrome:// pages */ }
});
$('ask').onclick = () => chrome.runtime.sendMessage({ type: 'ask', text: $('q').value }, () => window.close());
$('open').onclick = async () => { const { url } = await chrome.storage.sync.get({ url: 'https://daschai.vercel.app/' }); chrome.tabs.create({ url }); };
$('status').onclick = () => chrome.runtime.sendMessage({ type: 'api', method: 'GET', path: '/api/v1/status' }, (r) => { $('out').textContent = JSON.stringify(r && r.body, null, 2); });
