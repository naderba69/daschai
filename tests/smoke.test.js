/* Smoke tests for the built index.html (run: npm test). Uses jsdom — no browser or network needed. */
const fs=require('fs');const {JSDOM,VirtualConsole}=require('jsdom');
let html=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
// strip external scripts (no network) & SW
html=html.replace(/<script src=[^>]*><\/script>/g,'');
const errors=[];
const vc=new VirtualConsole();
vc.on('jsdomError',e=>errors.push('jsdomError: '+e.message));
vc.on('error',(...a)=>errors.push('console.error: '+a.join(' ')));
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://daschai.vercel.app/',virtualConsole:vc,
 beforeParse(w){
  w.marked={parse:s=>s,setOptions(){},use(){}}; w.hljs={highlightElement(){},highlightAuto:s=>({value:s}),getLanguage(){return null}};
  w.DOMPurify={sanitize:s=>s}; w.fetch=()=>Promise.reject(new Error('offline'));
  w.matchMedia=q=>({matches:false,addEventListener(){},removeEventListener(){}});
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.speechSynthesis={getVoices:()=>[],cancel(){},speak(){}};
  w.document.execCommand=()=>false;
 }});
const w=dom.window,d=w.document,app=w.app;
const ok=(c,m)=>{console.log((c?'✅':'❌')+' '+m); if(!c) process.exitCode=1;};
setTimeout(()=>{
 ok(!!app,'app instance');
 ok(typeof app.openCommandPalette==='function','palette method');
 ok(d.documentElement.getAttribute('data-theme')==='dark','default dark theme');
 app.toggleTheme(); ok(d.documentElement.getAttribute('data-theme')==='light','toggle → light');
 app.applyTheme('dracula'); ok(d.documentElement.style.getPropertyValue('--bg-base')==='#282a36','dracula vars');
 app.applyTheme('dark'); ok(d.documentElement.style.getPropertyValue('--bg-base')==='','dark resets vars');
 // palette
 w.dispatchEvent(new w.KeyboardEvent('keydown',{key:'k',ctrlKey:true}));
 ok(d.getElementById('cmd-palette-overlay').classList.contains('active'),'Ctrl+K opens palette');
 const items=d.querySelectorAll('.cmd-palette-item').length; ok(items>20,'palette items: '+items);
 const pi=d.getElementById('cmd-palette-input'); pi.value='ثيم'; pi.dispatchEvent(new w.Event('input'));
 ok(d.querySelectorAll('.cmd-palette-item').length===10,'filter "ثيم" → 10 themes ('+d.querySelectorAll('.cmd-palette-item').length+')');
 pi.value='>nord'; pi.dispatchEvent(new w.Event('input'));
 pi.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter'}));
 ok(d.documentElement.getAttribute('data-theme-preset')==='nord','Enter runs nord theme');
 ok(!d.getElementById('cmd-palette-overlay').classList.contains('active'),'palette closes after run');
 // slash
 const ui=d.getElementById('user-input'); ui.value='/te'; ui.dispatchEvent(new w.Event('input'));
 ok(d.getElementById('slash-autocomplete').classList.contains('visible'),'slash box visible');
 ok(d.querySelectorAll('.slash-item').length===1,'"/te" → 1 match (/test)');
 let sent=false; const orig=app.sendUserMessage; app.sendUserMessage=()=>{sent=true};
 ui.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 ok(ui.value.startsWith('اكتب اختبارات'),'Enter applies /test template');
 ok(!sent,'Enter did not send message while autocomplete open');
 app.sendUserMessage=orig;
 ui.value='/'; ui.dispatchEvent(new w.Event('input')); ok(d.querySelectorAll('.slash-item').length===16,'"/" lists 16 commands');
 ui.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 ok(!d.getElementById('slash-autocomplete').classList.contains('visible'),'Esc hides slash box');
 // tabs
 app.createNewSession(true); app.createNewSession(true);
 ok(d.getElementById('top-tabs-bar').classList.contains('visible'),'tabs bar visible with 2+ sessions');
 const tabs=d.querySelectorAll('.top-tab').length; ok(tabs>=2,'tabs: '+tabs);
 const before=app.activeSessionId; app.cycleTab(-1); ok(app.activeSessionId!==before,'cycleTab switches');
 const closing=app.activeSessionId; app.closeTab(closing); ok(!app.openTabs.includes(closing),'closeTab removes tab');
 // zen + zoom
 app.toggleZenMode(true); ok(d.body.classList.contains('zen-mode'),'zen on'); app.toggleZenMode(false);
 app.setUIScale(1.2); ok(d.documentElement.style.getPropertyValue('--ui-scale')==='1.2','zoom 120%'); app.setUIScale(1);
 // editor
 app.toggleCodeStudio(true);
 ok(!!d.querySelector('.line-numbers-gutter'),'gutter injected');
 ok(!!d.getElementById('editor-statusbar'),'statusbar injected');
 const ed=d.getElementById('studio-editor-textarea');
 ok(d.querySelector('.line-numbers-gutter').childElementCount===ed.value.split('\n').length,'line numbers match ('+ed.value.split('\n').length+')');
 ed.setSelectionRange(0,0); ed.dispatchEvent(new w.KeyboardEvent('keydown',{key:'/',ctrlKey:true,cancelable:true}));
 ok(ed.value.split('\n')[0]==='استوديو الأكواد المنقسم (OX-Alpha Studio)','Ctrl+/ uncomments an already-commented line');
 ed.dispatchEvent(new w.KeyboardEvent('keydown',{key:'/',ctrlKey:true,cancelable:true}));
 ok(ed.value.split('\n')[0]==='// استوديو الأكواد المنقسم (OX-Alpha Studio)','Ctrl+/ comments it again');
 app.virtualProjectFiles.set('a.json',{content:'{"a":1,"b":[1,2]}',lang:'json'}); app.switchStudioFile('a.json');
 app.formatStudioCode(); ok(ed.value.includes('\n  "a": 1'),'JSON format');
 ok(app.virtualProjectFiles.get('a.json').content===ed.value,'format persisted to virtual FS');
 // slash with studio context
 ui.value='/ex'; ui.dispatchEvent(new w.Event('input')); app.applySlashCommand(0);
 ok(ui.value.includes('```json'),'slash injects active studio file');
 ok(errors.length===0,'no runtime errors'+(errors.length?': '+errors.slice(0,5).join(' | '):''));
 w.close();
},300);
