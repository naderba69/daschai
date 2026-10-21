// Lightweight undefined-identifier check for ESM chunks (node --check cannot cover ESM imports).
const acorn = require('acorn'), fs = require('fs');
const walk = {
  full(node, cb) { (function go(n) { if (!n || typeof n.type !== 'string') return; cb(n); for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(x => x && typeof x === 'object' && go(x)); else if (v && typeof v === 'object' && k !== 'loc') go(v); } })(node); },
  ancestor(node, vis) { const anc = []; (function go(n) { if (!n || typeof n.type !== 'string') return; anc.push(n); if (vis[n.type]) vis[n.type](n, anc); for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(x => x && typeof x === 'object' && go(x)); else if (v && typeof v === 'object' && k !== 'loc') go(v); } anc.pop(); })(node); },
};
const G = new Set(Object.getOwnPropertyNames(globalThis).concat(['window','document','navigator','location','localStorage','sessionStorage','indexedDB','fetch','Blob','URL','File','FileReader','Image','HTMLElement','Event','KeyboardEvent','CustomEvent','requestAnimationFrame','cancelAnimationFrame','getComputedStyle','matchMedia','SpeechSynthesisUtterance','speechSynthesis','MediaRecorder','AbortController','TextDecoder','TextEncoder','alert','confirm','prompt','performance','crypto','Worker','MutationObserver','ResizeObserver','IntersectionObserver','DOMParser','XMLSerializer','CSS','Notification','history','screen','self','caches','btoa','atob','structuredClone','queueMicrotask','setTimeout','clearTimeout','setInterval','clearInterval','console','arguments','undefined','HTMLCanvasElement','OffscreenCanvas','ImageData','createImageBitmap','Response','Request','Headers','ReadableStream','DataTransfer','ClipboardItem','innerWidth','innerHeight','devicePixelRatio','scrollTo','open','print','Node','NodeFilter','Range','Selection','getSelection','BroadcastChannel','MessageChannel','FormData','EventSource','WebSocket','Audio','AudioContext','webkitAudioContext','PerformanceObserver','FocusEvent','MouseEvent','InputEvent','PointerEvent']));
let bad = 0;
for (const f of process.argv.slice(2)) {
  const src = fs.readFileSync(f, 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: f.includes('/features/') || f.endsWith('app.js') ? 'script' : 'module', locations: true, allowHashBang: true });
  const declared = new Set();
  const addPat = (p) => { if (!p) return; if (p.type === 'Identifier') declared.add(p.name); else if (p.type === 'ObjectPattern') p.properties.forEach(q => addPat(q.type === 'RestElement' ? q.argument : q.value)); else if (p.type === 'ArrayPattern') p.elements.forEach(addPat); else if (p.type === 'AssignmentPattern') addPat(p.left); else if (p.type === 'RestElement') addPat(p.argument); };
  walk.full(ast, (n) => {
    if (n.type === 'VariableDeclarator') addPat(n.id);
    if (/Function/.test(n.type)) { if (n.id) declared.add(n.id.name); n.params.forEach(addPat); }
    if (n.type === 'ClassDeclaration' && n.id) declared.add(n.id.name);
    if (n.type === 'CatchClause') addPat(n.param);
    if (n.type === 'ImportSpecifier' || n.type === 'ImportDefaultSpecifier' || n.type === 'ImportNamespaceSpecifier') declared.add(n.local.name);
  });
  walk.ancestor(ast, { Identifier(n, anc) {
    const p = anc[anc.length - 2];
    if (p && p.type === 'MemberExpression' && p.property === n && !p.computed) return;
    if (p && (p.type === 'Property' || p.type === 'MethodDefinition' || p.type === 'PropertyDefinition') && p.key === n && !p.computed && !(p.shorthand)) return;
    if (p && (p.type === 'LabeledStatement' || p.type === 'BreakStatement' || p.type === 'ContinueStatement')) return;
    if (p && /^(Export|Import)(Default|Namespace)?Specifier$/.test(p.type)) return;
    if (!declared.has(n.name) && !G.has(n.name)) { bad++; console.log(`${f}:${n.loc.start.line} undefined: ${n.name}`); }
  }});
}
console.log(bad ? `❌ ${bad}` : '✅ no undefined refs');
process.exitCode = bad ? 1 : 0;
