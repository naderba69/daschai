/* Sprint 4 tests: project files (explorer, history, trash, search/replace, tools, persistence),
   uploads & documents, converters, preview, image editor, recorder, media gallery, chat export. */
require('fake-indexeddb/auto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { loadApp, mockOpenRouter, ok, wait, waitFor, section } = require('./helpers');
const ROOT = path.join(__dirname, '..');
function exposeGlobals(w) {
    const names = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
        'KeyboardEvent', 'MouseEvent', 'Event', 'CustomEvent', 'localStorage', 'location', 'history', 'innerWidth', 'innerHeight', 'devicePixelRatio'];
    for (const n of names) Object.defineProperty(globalThis, n, { value: w[n], configurable: true, writable: true });
}

const JSZIP_SRC = fs.readFileSync(require('path').join(__dirname, '..', 'node_modules/jszip/dist/jszip.min.js'), 'utf8');
const YAML_SRC = fs.readFileSync(require('path').join(__dirname, '..', 'node_modules/js-yaml/dist/js-yaml.min.js'), 'utf8');

function browserStubs(w) {
    // Real JSZip + js-yaml evaluated inside the window realm (JSZip's scheduler needs setImmediate)
    w.setImmediate = (f, ...a) => w.setTimeout(f, 0, ...a);
    w.eval(JSZIP_SRC);
    w.eval(YAML_SRC);
    let urlN = 0;
    w.URL.createObjectURL = () => `blob:https://daschai.vercel.app/${++urlN}`;
    w.URL.revokeObjectURL = () => {};
    // Canvas (jsdom has none)
    const ctx = new Proxy({ calls: [] }, { get: (t, k) => (k in t ? t[k] : (...a) => { t.calls.push([k, a]); }), set: (t, k, v) => { t[k] = v; return true; } });
    w.__ctx = ctx;
    w.HTMLCanvasElement.prototype.getContext = function () { return ctx; };
    w.HTMLCanvasElement.prototype.toDataURL = function (type = 'image/png') { return `data:${type === 'image/avif' ? 'image/png' : type};base64,AAAA`; };
    w.HTMLCanvasElement.prototype.toBlob = function (cb, type = 'image/png', q = 1) {
        const n = Math.round(this.width * this.height * (type === 'image/png' ? 0.5 : 0.1 * q)) + 10;
        cb(new w.Blob([new Uint8Array(n)], { type }));
    };
    // Document libraries
    w.pdfjsLib = {
        GlobalWorkerOptions: {},
        getDocument: () => ({ promise: Promise.resolve({ numPages: 2, getPage: async (i) => ({ getTextContent: async () => ({ items: [{ str: 'مرحبا', hasEOL: false }, { str: 'page' + i, hasEOL: true }, { str: 'end', hasEOL: false }] }) }) }) })
    };
    w.mammoth = { extractRawText: async () => ({ value: 'Word title\n\n\n\nParagraph' }) };
    w.XLSX = { read: () => ({ SheetNames: ['Sales', 'Q2'], Sheets: { Sales: 's', Q2: 'q' } }), utils: { sheet_to_csv: (s) => (s === 's' ? 'item,qty\napple,3\n' : 'x\n1\n') } };
    // Media capture
    const track = { stop() { track.stopped = true; }, addEventListener() {} };
    w.__track = track;
    const stream = { getTracks: () => [track], getVideoTracks: () => [] };
    w.navigator.mediaDevices = {
        getUserMedia: async (c) => { if (w.__denyMedia) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); return stream; },
        getDisplayMedia: async () => stream
    };
    w.MediaRecorder = class {
        constructor(s, o) { this.stream = s; this.mimeType = (o && o.mimeType) || ''; this.state = 'inactive'; }
        static isTypeSupported(t) { return /webm/.test(t); }
        start() { this.state = 'recording'; }
        pause() { this.state = 'paused'; }
        resume() { this.state = 'recording'; }
        stop() { this.state = 'inactive'; this.ondataavailable && this.ondataavailable({ data: new w.Blob(['RIFFdata'], { type: 'audio/webm' }) }); this.onstop && this.onstop(); }
    };
}

(async () => {
    const { w, d, app, errors } = loadApp({ indexedDB: globalThis.indexedDB, beforeParse: browserStubs });
    const $ = (id) => d.getElementById(id);
    await wait(80);
    const downloads = [];
    app.downloadBlob = (blob, name) => downloads.push({ blob, name });
    app.loadImageElement = async () => ({ naturalWidth: 800, naturalHeight: 600 });
    const files = app.virtualProjectFiles;
    files.clear();
    await wait(10);

    section('Dialogs');
    let p = app.askText('اسم الملف', 'src/index.js');
    await wait(5);
    ok($('ox-dialog').classList.contains('active'), 'custom dialog opens (no prompt())');
    $('oxd-text').value = 'src/main.js';
    app.resolveDialog(0);
    ok((await p) === 'src/main.js', 'askText resolves with the typed value');
    p = app.askConfirm('تأكيد', 'هل أنت متأكد؟');
    await wait(5);
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ok((await p) === false, 'Esc cancels the confirm dialog');

    section('File model + templates');
    app.createProjectFile('src/App.jsx', undefined, { open: false });
    ok(/export default function App/.test(files.get('src/App.jsx').content), 'React template applied from extension');
    app.createProjectFile('server/index.ts', '', { open: false });
    let threw = null;
    try { app.createProjectFile('src/App.jsx', 'x', { open: false }); } catch (e) { threw = e; }
    ok(threw && /بنفس الاسم/.test(threw.message), 'duplicate path rejected');
    ok(app.uniqueProjectPath('src/App.jsx') === 'src/App (2).jsx', 'uniqueProjectPath suffixes duplicates');
    app.createProjectFolder('api', 'express');
    ok(files.has('api/package.json') && files.has('api/src/index.js') && /express/.test(files.get('api/src/index.js').content), 'Express scaffold creates files');
    app.createProjectFolder('empty-dir');
    ok(app.isProjectFolder('empty-dir'), 'empty folder tracked');

    section('History (versions)');
    app.writeProjectFile('src/App.jsx', 'v1\n', 'edit-tree');
    app.writeProjectFile('src/App.jsx', 'v2\n', 'edit-tree');
    app.writeProjectFile('src/App.jsx', 'v3\n', 'edit-tree');
    const versions = app.getFileVersions('src/App.jsx');
    ok(versions.length >= 3 && versions[versions.length - 1].content === 'v2\n', 'previous contents recorded as versions');
    app._typingInStudio = true;
    for (let i = 0; i < 20; i++) files.set('src/App.jsx', { content: 'typing ' + i, lang: 'jsx' });
    app._typingInStudio = false;
    ok(app.getFileVersions('src/App.jsx').length <= versions.length + 1, 'typing burst coalesced into one version');
    app.openFileHistory('src/App.jsx');
    ok($('ox-panel-modal').classList.contains('active') && d.querySelectorAll('.hist-item').length >= 3, 'history panel lists versions');
    app.selectHistoryVersion(0);
    ok(app.restoreHistoryVersion() === true && files.get('src/App.jsx').content === app.getFileVersions('src/App.jsx')[0].content, 'restore an old version');
    app.closeModals();

    section('Rename / move / duplicate / trash');
    app.renameProjectFile('src/App.jsx', 'src/Main.jsx');
    ok(!files.has('src/App.jsx') && files.has('src/Main.jsx') && app.getFileVersions('src/Main.jsx').length > 0, 'rename keeps history');
    app.renameProjectFolder('server', 'backend');
    ok(files.has('backend/index.ts') && !files.has('server/index.ts'), 'folder rename moves children');
    app.moveProjectPaths(['backend/index.ts'], 'src');
    ok(files.has('src/index.ts'), 'move into folder');
    const dup = app.duplicateProjectFile('src/index.ts');
    ok(dup && files.has(dup) && dup !== 'src/index.ts', 'duplicate file → ' + dup);
    app.togglePinFile('src/Main.jsx');
    ok(app.pinnedFiles.has('src/Main.jsx'), 'pin file');
    const apiCount = app.projectPaths().filter(x => x.startsWith('api/')).length;
    const deleted = app.deleteProjectPaths(['src/index.ts', 'api']);
    ok(deleted.length === apiCount + 1 && !files.has('api/src/index.js') && app.fileTrash.length === apiCount + 1, 'delete file + folder → trash');
    const undoBtn = d.querySelector('#toast-container .toast-action-btn');
    ok(!!undoBtn, 'undo action shown in toast');
    undoBtn.click();
    ok(files.has('src/index.ts') && files.has('api/src/index.js') && app.fileTrash.length === 0, 'undo restores the whole batch');

    section('Explorer');
    app.toggleStudioExplorer(true);
    const ex = $('studio-explorer');
    ok(ex.classList.contains('open') && ex.querySelectorAll('.fx-row').length >= 5, 'explorer renders tree rows');
    files.set('src/<img src=x onerror=alert(1)>.js', { content: '', lang: 'js' });
    await wait(80);
    ok(!ex.querySelector('img') && /&lt;img/.test(ex.innerHTML), 'file names are escaped in explorer');
    files.delete('src/<img src=x onerror=alert(1)>.js');
    app.setExplorerFilter('main');
    ok(app.buildExplorerRows().length === 1 && app.buildExplorerRows()[0].path === 'src/Main.jsx', 'explorer filter (flat results)');
    app.setExplorerFilter('');
    app.setExplorerView('pinned');
    ok(app.buildExplorerRows().map(r => r.path).join() === 'src/Main.jsx', 'pinned view');
    app.setExplorerView('tree');
    app.explorerClick('src/Main.jsx', 'file', { ctrl: true });
    app.explorerClick('src/index.ts', 'file', { ctrl: true });
    ok(app.explorer.selected.size === 2, 'multi-select with Ctrl');
    app.clearExplorerSelection();
    app.showFileContextMenu('src/Main.jsx', 'file', { x: 10, y: 10 });
    ok(d.querySelector('.fx-menu') && d.querySelectorAll('.fx-menu [data-mi]').length > 5, 'context menu opens');
    app.hideMenu();

    section('Tabs');
    app.studioTabs = [];
    app.openProjectFile('src/Main.jsx');
    app.openProjectFile('src/index.ts');
    const tabEls = () => Array.from(d.querySelectorAll('#studio-open-files-tabs .studio-tab-item')).map(t => t.dataset.path);
    ok(tabEls().join() === 'src/Main.jsx,src/index.ts', 'open files appear as tabs');
    app.closeStudioTab('src/index.ts');
    ok(tabEls().join() === 'src/Main.jsx' && app.activeStudioFile === 'src/Main.jsx', 'close tab activates the neighbour');

    section('Batch rename');
    files.set('img/a.png.txt', { content: 'a' }); files.set('img/b.png.txt', { content: 'b' });
    const plan = app.planBatchRename(['img/a.png.txt', 'img/b.png.txt'], '', 'photo-{n:2}.{ext}').plan;
    ok(plan.map(x => x.to).join() === 'img/photo-01.txt,img/photo-02.txt', 'tokens {n:2} {ext}');
    const clash = app.planBatchRename(['img/a.png.txt', 'img/b.png.txt'], '', 'same.txt').plan;
    ok(clash[1].error === 'تكرار', 'duplicate targets flagged');
    ok(app.applyBatchRename(plan) === 2 && files.has('img/photo-02.txt'), 'batch rename applied');

    section('Search & replace');
    files.set('src/util.js', { content: 'const foo = 1;\nfoo(foo);\nfoobar();\n', lang: 'js' });
    files.set('docs/readme.md', { content: 'foo in docs\n', lang: 'md' });
    let r = app.searchProject('foo', { wholeWord: true });
    ok(r.total === 4 && r.files.length === 2, 'whole-word search across files');
    r = app.searchProject('foo', { wholeWord: true, include: 'src/**' });
    ok(r.files.length === 1 && r.files[0].path === 'src/util.js', 'glob include filter');
    ok(app.searchProject('(', { regex: true }).error, 'invalid regex reported');
    const rep = app.replaceInProject('foo(\\w*)', 'baz$1', { regex: true, include: '*.js' });
    ok(rep.replacements === 4 && files.get('src/util.js').content.includes('bazbar()') && files.get('docs/readme.md').content.includes('foo'), 'regex replace with $1 + include');
    ok(app.getFileVersions('src/util.js').length > 0, 'replace recorded in history');
    app.openProjectTools('search');
    ok($('sr-query') && $('ox-panel-modal').classList.contains('active'), 'search tool UI');

    section('Stats / duplicates / compare');
    files.set('a/copy1.txt', { content: 'same body\n' }); files.set('b/copy2.txt', { content: 'same body\n' });
    const st = app.computeProjectStats();
    ok(st.files === files.size && st.byExt.some(e => e.ext === 'js'), 'project stats');
    const groups = app.findDuplicateFiles();
    ok(groups.some(g => g.includes('a/copy1.txt') && g.includes('b/copy2.txt')), 'duplicate files detected');
    app.openProjectTools('compare', { a: 'a/copy1.txt', b: 'src/util.js' });
    ok(d.querySelector('.cmp-head') !== null, 'compare tool renders');
    app.openProjectTools('stats');
    ok(/ملف/.test($('ox-panel-body').textContent), 'stats tool renders');
    app.closeModals();

    section('ZIP download + persistence');
    await app.downloadPathsAsZip(['src/Main.jsx', 'src/util.js'], 'sel');
    const zipDl = downloads.pop();
    ok(zipDl && /\.zip$/.test(zipDl.name), 'selection downloaded as ZIP');
    const zz = await w.JSZip.loadAsync(await new Promise(res => { const fr = new w.FileReader(); fr.onload = () => res(fr.result); fr.readAsArrayBuffer(zipDl.blob); }));
    ok(Object.keys(zz.files).some(k => k.endsWith('util.js')), 'ZIP contains the files');
    await app.saveProjectNow();
    const boot2 = loadApp({ indexedDB: globalThis.indexedDB, beforeParse: browserStubs });
    await waitFor(() => boot2.app.virtualProjectFiles.has('src/util.js') && boot2.app.pinnedFiles.has('src/Main.jsx'));
    ok(boot2.app.virtualProjectFiles.has('src/util.js') && boot2.app.pinnedFiles.has('src/Main.jsx'), 'project restored from IndexedDB after reload');
    ok(!boot2.app.virtualProjectFiles.has('App.tsx') || files.has('App.tsx'), 'deleted starter files stay deleted after reload');
    boot2.w.close();

    section('Uploads');
    app.currentAttachments = [];
    files.clear();
    const mk = (body, name, type = '') => new w.File([body], name, { type });
    await app.processUniversalFiles([mk('console.log(1)', 'a.js', 'text/javascript'), mk('console.log(2)', 'a.js', 'text/javascript')]);
    ok(app.currentAttachments.map(a => a.name).join() === 'a.js,a (2).js', 'duplicate attachment names auto-renamed');
    await app.processUniversalFiles([mk('abc\u0000\u0000def', 'blob.dat')]);
    ok(app.currentAttachments.length === 2 && /ثنائي/.test(d.getElementById('toast-container').textContent), 'binary file skipped with reason');
    const big = mk('x', 'huge.bin'); Object.defineProperty(big, 'size', { value: 60 * 1024 * 1024 });
    await app.processUniversalFiles([big]);
    ok(app.currentAttachments.length === 2, 'oversized file rejected');
    await app.processUniversalFiles([mk('%PDF-1.4', 'report.pdf', 'application/pdf')]);
    let att = app.currentAttachments[app.currentAttachments.length - 1];
    ok(att.isDocument && att.docType === 'pdf' && /صفحة 2/.test(att.textContent) && /page2/.test(att.textContent) && !att.base64, 'PDF text extracted per page (no base64 → no vision routing)');
    await app.processUniversalFiles([mk('PK', 'cv.docx')]);
    att = app.currentAttachments[app.currentAttachments.length - 1];
    ok(att.docType === 'docx' && /Word title\n\nParagraph/.test(att.textContent), 'Word text extracted');
    await app.processUniversalFiles([mk('PK', 'sales.xlsx')]);
    att = app.currentAttachments[app.currentAttachments.length - 1];
    ok(att.sheets.length === 2 && /ورقة: Sales\nitem,qty/.test(att.textContent), 'Excel sheets → CSV');
    const pz = new w.JSZip();
    pz.file('ppt/slides/slide1.xml', '<p:sld><a:p><a:r><a:t>Title</a:t></a:r></a:p><a:p><a:r><a:t>Point A</a:t></a:r></a:p></p:sld>');
    pz.file('ppt/slides/slide2.xml', '<p:sld><a:p><a:r><a:t>Q &amp; A</a:t></a:r></a:p></p:sld>');
    pz.file('ppt/slides/slide10.xml', '<p:sld><a:p><a:r><a:t>Last</a:t></a:r></a:p></p:sld>');
    await app.processUniversalFiles([mk(await pz.generateAsync({ type: 'blob' }), 'deck.pptx')]);
    att = app.currentAttachments[app.currentAttachments.length - 1];
    ok(att.docType === 'pptx' && /شريحة 1 ---\nTitle\nPoint A/.test(att.textContent) && /Q & A/.test(att.textContent) && att.textContent.indexOf('Last') > att.textContent.indexOf('Q & A'), 'PowerPoint slides in numeric order');
    await app.processUniversalFiles([mk('ID3', 'song.mp3', 'audio/mpeg')]);
    att = app.currentAttachments[app.currentAttachments.length - 1];
    ok(att.isMedia && att.mediaKind === 'audio' && app.getBlob(att.blobId), 'audio kept as media blob');
    const chips = d.querySelectorAll('#attachment-chips-list .attachment-file-chip');
    ok(chips.length === app.currentAttachments.length && chips[0].classList.contains('clickable'), 'attachment chips are clickable');

    section('Folder upload + drop into explorer');
    const folder = [
        { file: mk('{"name":"demo"}', 'package.json'), path: 'demo/package.json' },
        { file: mk('export const a = 1;', 'a.js'), path: 'demo/src/a.js' },
        { file: mk('ignored', 'x.js'), path: 'demo/node_modules/x/x.js' },
        { file: mk('ignored', 'HEAD'), path: 'demo/.git/HEAD' }
    ];
    const before = app.currentAttachments.length;
    await app.processUniversalFiles(folder);
    att = app.currentAttachments[app.currentAttachments.length - 1];
    ok(files.has('demo/src/a.js') && !files.has('demo/node_modules/x/x.js') && !files.has('demo/.git/HEAD'), 'folder imported, node_modules/.git skipped');
    ok(app.currentAttachments.length === before + 1 && att.isZipProject && att.fileCount === 2, 'folder attached as one project');
    const dt = { items: [], files: [mk('body{}', 'site.css')] };
    await app.importDroppedToProject(dt, 'assets');
    ok(files.get('assets/site.css').content === 'body{}', 'drop onto explorer folder → imported into it');

    section('Converters');
    const rows = app.parseCSV('name,note\n"Doe, J","said ""hi""\nbye"\r\nAli,ok\n');
    ok(rows.length === 3 && rows[1][0] === 'Doe, J' && rows[1][1] === 'said "hi"\nbye' && rows[2][1] === 'ok', 'RFC 4180 CSV parser');
    ok(app.parseCSV(app.stringifyCSV(rows)).every((r, i) => r.join('|') === rows[i].join('|')), 'CSV round-trip');
    ok(app.parseCSV('a;b\n1;2')[1][1] === '2', 'delimiter auto-detection');
    const asJson = app.csvToJson('id,name,active\n1,Ali,true\n2,Sara,false\n');
    ok(asJson[0].id === 1 && asJson[1].active === false && asJson[1].name === 'Sara', 'CSV → JSON with type inference');
    ok(app.jsonToCsv([{ a: 1, b: { x: 1 } }, { a: 2, c: 'z' }]) === 'a,b,c\n1,"{""x"":1}",\n2,,z\n', 'JSON → CSV (union keys, nested as JSON)');
    const y = await app.convertText('{"name":"demo","list":[1,2]}', 'json', 'yaml');
    ok(/name: demo/.test(y) && /- 1/.test(y), 'JSON → YAML');
    ok(JSON.parse(await app.convertText(y, 'yaml', 'json')).list[1] === 2, 'YAML → JSON');
    files.set('data/users.csv', { content: 'id,name\n1,Ali\n', lang: 'csv' });
    const out = await app.convertProjectFile('data/users.csv', 'json');
    ok(out === 'data/users.json' && JSON.parse(files.get(out).content)[0].name === 'Ali', 'convert project file → new file');

    section('Preview');
    files.set('data/conf.json', { content: '{"name":"x","port":3000,"tags":["a"]}', lang: 'json' });
    app.openFilePreview({ path: 'data/conf.json' });
    ok(d.querySelectorAll('#pv-root .jt-val').length === 3, 'JSON tree view');
    const portEl = Array.from(d.querySelectorAll('#pv-root .jt-val')).find(e => e.textContent === '3000');
    portEl.textContent = '8080';
    const saved = app.saveJsonTree();
    ok(saved.port === 8080 && JSON.parse(files.get('data/conf.json').content).port === 8080, 'edit JSON value in tree + save');
    app.openFilePreview({ path: 'data/users.csv' });
    ok(d.querySelectorAll('#pv-root .csv-table td[data-r]').length === 2, 'CSV table view');
    d.querySelector('#pv-root td[data-r="1"][data-c="1"]').textContent = 'Omar';
    app.csvAddRow();
    ok(app._preview.rows.length === 3 && app._preview.rows[1][1] === 'Omar', 'edit cell + add row');
    app.csvSort(1);
    app.saveCsvTable();
    ok(/Omar/.test(files.get('data/users.csv').content), 'CSV saved');
    files.set('page.html', { content: '<script>parent.localStorage</script><h1>Hi</h1>', lang: 'html' });
    app.openFilePreview({ path: 'page.html' });
    const fr = d.querySelector('#pv-root iframe');
    ok(fr && fr.getAttribute('sandbox') === 'allow-scripts allow-forms allow-modals', 'HTML preview sandboxed without allow-same-origin');
    files.set('img/logo.png', { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', binary: true, size: 8, mime: 'image/png' });
    app.openFilePreview({ path: 'img/logo.png' });
    ok(d.querySelector('#pv-img') && d.querySelector('#pv-img').src.startsWith('data:image/png'), 'image preview');
    app.previewZoom(1);
    ok(d.querySelector('#pv-img').classList.contains('zoomed'), 'zoom in');
    app.openFilePreview({ attachment: app.currentAttachments.findIndex(a => a.docType === 'pdf') });
    ok(d.querySelector('#pv-root iframe.pv-frame') && d.querySelector('#pv-root iframe').src.startsWith('blob:'), 'PDF preview via blob URL');
    app.togglePreviewMode('text');
    ok(/page1/.test($('pv-root').textContent), 'PDF extracted text view');
    app.openFilePreview({ attachment: app.currentAttachments.findIndex(a => a.docType === 'xlsx') });
    ok(d.querySelectorAll('#pv-root .gh-chip').length === 2 && /apple/.test($('pv-root').textContent), 'Excel sheets as tabs');
    const csvPath = app.saveSheetToProject();
    ok(files.get(csvPath).content.startsWith('item,qty'), 'sheet saved as CSV');
    app.openFilePreview({ attachment: app.currentAttachments.findIndex(a => a.isMedia) });
    ok(d.querySelector('#pv-media') && d.querySelector('#pv-media').tagName === 'AUDIO', 'audio player');
    app.downloadPreview();
    ok(downloads.pop().name === 'song.mp3', 'download from preview');
    ok(app.openFilePreview({ path: 'nope' }) === null, 'missing file → graceful');

    section('Image editor (lazy media chunk)');
    exposeGlobals(w);
    const imported = [];
    app.importModule = (url) => { imported.push(url); return import(pathToFileURL(path.join(ROOT, url)).href); };
    ok(app.openImageEditor.__oxLazy === 'media' && app.openRecorder.__oxLazy === 'media', 'image editor + recorder are lazy stubs in the main bundle');
    app.currentAttachments.push({ name: 'photo.jpg', base64: 'data:image/jpeg;base64,/9j/AAAA', isImage: true, size: 200000, mime: 'image/jpeg' });
    const imgIdx = app.currentAttachments.length - 1;
    const ed = await app.openImageEditor({ attachment: imgIdx });
    ok(imported.length === 1 && /media-/.test(imported[0]), 'media chunk loaded on first use');
    ok(ed && ed.width === 800 && ed.height === 600 && $('ie-canvas'), 'editor opens with natural size');
    app.imgEdSize('w', 400);
    ok(ed.width === 400 && ed.height === 300, 'resize keeps aspect ratio');
    app.imgEdRotate(90);
    ok(ed.rotate === 90 && ed.width === 300 && ed.height === 400, 'rotate swaps dimensions');
    app.imgEdRotate(-90);
    app.imgEdApplyCrop({ x: 100, y: 50, w: 200, h: -100 });
    ok(ed.crop.x === 100 && ed.crop.y === 0 && ed.crop.w === 200 && ed.crop.h === 100, 'crop rectangle normalised + clamped');
    ok(JSON.stringify(app.fitDimensions(4000, 3000, 1600, 1600)) === '{"w":1600,"h":1200}' && app.fitDimensions(100, 50, 1600, 1600).w === 100, 'fitDimensions never upscales');
    app.imgEdSet('filters.brightness', 120);
    app.imgEdSet('text.value', 'OX');
    app.imgEdSet('format', 'image/webp');
    app.imgEdSet('quality', 0.6);
    w.__ctx.calls.length = 0;
    const blob = await app.imgEdExport('download');
    ok(blob && blob.type === 'image/webp' && downloads.pop().name === 'photo-edited.webp', 'export as WebP');
    ok(w.__ctx.filter === 'none' && w.__ctx.calls.some(c => c[0] === 'fillText' && c[1][0] === 'OX'), 'filters + text overlay drawn');
    ok(app.supportedImageFormats().includes('image/webp') && !app.supportedImageFormats().includes('image/avif'), 'format support detected from canvas');
    const replaced = await app.imgEdExport('attach');
    ok(app.currentAttachments[imgIdx].base64.startsWith('data:image/webp') && replaced.isImage, 'replace attachment with edited image');
    app.currentAttachments.push({ name: 'b.png', base64: 'data:image/png;base64,iVBOR', isImage: true, size: 900000 });
    await app.openImageEditor({ attachment: imgIdx });
    app.imgEdSet('format', 'image/jpeg');
    const n = await app.imgEdBatch();
    ok(n === 2 && app.currentAttachments.find(a => a.name === 'b.jpg'), 'batch convert all attached images');

    section('Recorder');
    await app.openRecorder('audio');
    ok(d.querySelector('.rec-big'), 'recorder UI');
    ok(await app.startRecording() === true && app._rec.state === 'recording', 'recording starts');
    ok(app._rec.mime === 'audio/webm;codecs=opus', 'best supported mime picked');
    app.pauseRecording();
    ok(app._rec.state === 'paused', 'pause');
    app.pauseRecording();
    app.stopRecording();
    ok(app._rec.state === 'done' && app._rec.blob.size > 0 && /^voice-memo-.*\.webm$/.test(app._rec.name), 'stop → blob + file name');
    ok(w.__track.stopped, 'microphone released after stop');
    const nAtt = app.currentAttachments.length;
    await app.saveRecording('attach');
    ok(app.currentAttachments.length === nAtt + 1 && app.currentAttachments[nAtt].isMedia, 'recording attached');
    w.__denyMedia = true;
    await app.openRecorder('camera');
    ok(await app.startRecording() === false && /رفض الإذن/.test($('toast-container').textContent), 'permission denied → friendly message');
    w.__denyMedia = false;
    app.closeModals();

    section('Media gallery + export');
    await app.addMediaItem(new w.Blob(['abc'], { type: 'audio/webm' }), 'memo.webm');
    app._mediaLoaded = false; app.mediaItems = [];
    const items = await app.loadMediaItems();
    ok(items.length === 1 && items[0].name === 'memo.webm' && items[0].blob.size === 3, 'media persisted in IndexedDB (ArrayBuffer)');
    await app.openMediaGallery();
    ok(d.querySelectorAll('#gallery-grid .gallery-card').length >= 2, 'gallery shows saved media + attached images');
    await app.openMediaGallery('audio');
    ok(d.querySelectorAll('#gallery-grid .gallery-card').length === 1, 'gallery filter by kind');
    await app.deleteMediaItem(items[0].id);
    app._mediaLoaded = false; app.mediaItems = [];
    ok((await app.loadMediaItems()).length === 0, 'delete media item');
    const s = app.sessions.find(x => x.id === app.activeSessionId);
    s.messages.push({ id: 'u1', role: 'user', content: 'سؤال <b>', timestamp: Date.now() }, { id: 'a1', role: 'assistant', model: 'm/x', content: '<think>secret</think>جواب **مهم**', timestamp: Date.now() });
    const md = await app.exportChat('markdown');
    ok(/👤 المستخدم/.test(md) && !/secret/.test(md) && downloads.pop().name.endsWith('.md'), 'Markdown export (thinking stripped)');
    const html = await app.exportChat('html');
    ok(/<html lang="ar" dir="rtl">/.test(html) && /سؤال &lt;b&gt;/.test(html), 'HTML export is standalone + escaped');
    const js = JSON.parse(await app.exportChat('json'));
    ok(js.messages.length === 2 && js.messages[1].model === 'm/x', 'JSON export');
    p = app.exportChat();
    await wait(5);
    ok($('ox-dialog').classList.contains('active') && d.querySelector('#oxd-fmt'), 'export format chooser');
    $('oxd-fmt').value = 'txt';
    app.resolveDialog(0);
    ok(/\[أنت\]/.test(await p), 'plain-text export via chooser');

    section('Multi-image payload + palette');
    const cmds = app.buildPaletteCommands().map(c => c.label);
    ok(cmds.includes('تسجيل الشاشة') && cmds.includes('معرض الوسائط') && cmds.some(l => /بحث واستبدال/.test(l)) && cmds.filter(l => /تصدير المحادثة/.test(l)).length === 1, 'palette has media + file commands');
    const or = mockOpenRouter(async () => ({ text: 'رأيت صورتين' }));
    w.fetch = or.fetchImpl;
    app.settings.apiKey = 'sk-test';
    app.currentAttachments = [
        { name: '1.png', base64: 'data:image/png;base64,AAA1', isImage: true },
        { name: '2.png', base64: 'data:image/png;base64,AAA2', isImage: true }
    ];
    await app.sendUserMessage('قارن الصورتين');
    await wait(50);
    const lastUser = or.calls.length ? or.calls[or.calls.length - 1].messages.filter(m => m.role === 'user').pop() : null;
    const imgs = lastUser && Array.isArray(lastUser.content) ? lastUser.content.filter(c => c.type === 'image_url').map(c => c.image_url.url) : [];
    ok(imgs.length === 2 && imgs[1].endsWith('AAA2'), 'all attached images are sent to the model (was: only the first)');
    app.openMediaMenu($('btn-media-menu'));
    ok(d.querySelectorAll('.fx-menu [data-mi]').length === 7 && /استوديو الملفات والوسائط/.test(d.querySelector('.fx-menu').textContent), 'media menu next to attach button (+ Files & Media studio)');
    app.hideMenu();

    ok(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
    w.close();
})().catch(e => { console.error('❌ test crashed:', e); process.exitCode = 1; });
