/* Sprint 13 — acorn-based source instrumentation (pure, unit-tested through `lib`):
   #164 coverage counters • #171-#175/#177 record-&-replay debugger probes • #167 mutants.
   Input is the runner's transpiled CommonJS (sucrase keeps line numbers), so lines map 1:1 to the source. */
import { parse } from 'acorn';

const OPTS = { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowHashBang: true, allowImportExportEverywhere: true, locations: true };
export const parseJS = (code) => parse(code, OPTS);

/** Minimal recursive walker: visit(node, parent, key) before children. */
export function walk(node, visit, parent = null, key = null) {
    if (!node || typeof node.type !== 'string') return;
    if (visit(node, parent, key) === false) return;
    for (const k of Object.keys(node)) {
        if (k === 'loc' || k === 'start' || k === 'end' || k === 'type') continue;
        const v = node[k];
        if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && walk(c, visit, node, k));
        else if (v && typeof v.type === 'string') walk(v, visit, node, k);
    }
}
/**
 * Apply [{at, text, end?, pr?}] insertions and [{from,to,text}] replacements (non-overlapping).
 * At one position: closers (end:true) come before openers; higher `pr` comes first; openers keep
 * visit order (outer first) and closers reverse it (inner first) so nested wrappers stay balanced.
 */
export function splice(code, edits) {
    const list = edits.map((e, i) => ({ from: e.at != null ? e.at : e.from, to: e.at != null ? e.at : e.to, text: e.text, i, ins: e.at != null, end: !!e.end, pr: e.pr || 0 }));
    // sort in APPLY order: an insertion applied later lands before the earlier ones at the same position
    list.sort((a, b) => b.from - a.from || (a.ins !== b.ins ? (a.ins ? 1 : -1) : a.end !== b.end ? (a.end ? 1 : -1) : a.pr - b.pr || (a.end ? a.i - b.i : b.i - a.i)));
    let out = code;
    for (const e of list) out = out.slice(0, e.from) + e.text + out.slice(e.to);
    return out;
}
const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const isStmtList = (parent, key) => (key === 'body' && (parent.type === 'Program' || parent.type === 'BlockStatement' || parent.type === 'StaticBlock')) || (key === 'consequent' && parent.type === 'SwitchCase');
const SKIP_STMT = new Set(['FunctionDeclaration', 'ClassDeclaration', 'EmptyStatement']);
const fnName = (n, parent) => (n.id && n.id.name) || (parent && parent.type === 'VariableDeclarator' && parent.id && parent.id.name) || (parent && (parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && parent.key && (parent.key.name || parent.key.value)) || (parent && parent.type === 'AssignmentExpression' && parent.left && (parent.left.property ? parent.left.property.name : parent.left.name)) || '(anonymous)';
/** Wrap a non-block statement position (if/loop bodies) so we can insert before it. */
const wrapBody = (edits, node, pre, post = '') => { edits.push({ at: node.start, text: '{' + pre }); edits.push({ at: node.end, text: '}' + post, end: true }); };

// ------------------------------------------------------------------ #164 COVERAGE
/** Returns { code, meta: { s:[line], f:[{name,line}], b:[{line,type,n}] } }. Counters live in G.__oxc[file]. */
export function instrumentCoverage(code, file) {
    const ast = parseJS(code);
    const meta = { s: [], f: [], b: [] }, edits = [];
    const F = JSON.stringify(file);
    const S = (line) => { meta.s.push(line); return `__oxc.s(${F},${meta.s.length - 1});`; };
    walk(ast, (n, parent, key) => {
        if (parent && isStmtList(parent, key) && !SKIP_STMT.has(n.type) && !(n.type === 'ExpressionStatement' && n.directive)) edits.push({ at: n.start, text: S(n.loc.start.line) });
        if (FN.has(n.type)) {
            meta.f.push({ name: fnName(n, parent), line: n.loc.start.line });
            const id = meta.f.length - 1;
            if (n.body.type === 'BlockStatement') edits.push({ at: n.body.start + 1, text: `__oxc.f(${F},${id});`, pr: 1 });
            else { edits.push({ at: n.body.start, text: `(__oxc.f(${F},${id}),` }); edits.push({ at: n.body.end, text: ')', end: true }); }
        }
        if (n.type === 'IfStatement') {
            meta.b.push({ line: n.loc.start.line, type: 'if', n: 2 });
            const id = meta.b.length - 1;
            // a missing else arm is emitted together with the consequent's closer so nested closers stay balanced
            const els = n.alternate ? '' : ` else {__oxc.b(${F},${id},1);}`;
            const arm = (node, k, post) => node.type === 'BlockStatement' ? (edits.push({ at: node.start + 1, text: `__oxc.b(${F},${id},${k});`, pr: 2 }), post && edits.push({ at: node.end, text: post, end: true }))
                : wrapBody(edits, node, `__oxc.b(${F},${id},${k});` + (node.type === 'IfStatement' ? '' : S(node.loc.start.line)), post);
            arm(n.consequent, 0, els);
            if (n.alternate) arm(n.alternate, 1);
        }
        if (n.type === 'ConditionalExpression') {
            meta.b.push({ line: n.loc.start.line, type: 'cond', n: 2 });
            const id = meta.b.length - 1;
            edits.push({ at: n.consequent.start, text: `(__oxc.b(${F},${id},0),` }, { at: n.consequent.end, text: ')', end: true });
            edits.push({ at: n.alternate.start, text: `(__oxc.b(${F},${id},1),` }, { at: n.alternate.end, text: ')', end: true });
        }
        if (n.type === 'LogicalExpression' && (n.operator === '&&' || n.operator === '||' || n.operator === '??')) {
            meta.b.push({ line: n.loc.start.line, type: 'logic', n: 2 });
            const id = meta.b.length - 1;
            edits.push({ at: n.left.start, text: `(__oxc.b(${F},${id},0),` }, { at: n.left.end, text: ')', end: true });
            edits.push({ at: n.right.start, text: `(__oxc.b(${F},${id},1),` }, { at: n.right.end, text: ')', end: true });
        }
        if (n.type === 'SwitchCase') {
            meta.b.push({ line: n.loc.start.line, type: 'case', n: 1 });
            const id = meta.b.length - 1;
            edits.push({ at: n.consequent.length ? n.consequent[0].start : n.end, text: `__oxc.b(${F},${id},0);`, pr: 3 });
        }
        if (parent && (parent.type === 'IfStatement' || /^(For|ForIn|ForOf|While|DoWhile)Statement$/.test(parent.type)) && (key === 'consequent' || key === 'alternate' || key === 'body') && n.type !== 'BlockStatement' && n.type !== 'IfStatement') {
            if (parent.type !== 'IfStatement') wrapBody(edits, n, S(n.loc.start.line));
        }
    });
    return { code: splice(code, edits), meta };
}
/** Coverage prelude for the runtime (serialised): counters + report on done. */
export function coverageExt(x) {
    var data = {};
    var get = function (f) { return data[f] || (data[f] = { s: {}, f: {}, b: {} }); };
    x.G.__oxc = {
        s: function (f, i) { var d = get(f); d.s[i] = (d.s[i] || 0) + 1; },
        f: function (f, i) { var d = get(f); d.f[i] = (d.f[i] || 0) + 1; },
        b: function (f, i, k) { var d = get(f); var a = d.b[i] || (d.b[i] = []); a[k] = (a[k] || 0) + 1; }
    };
    x.beforeDone(function () { x.send({ type: 'coverage', data: data }); });
}
/** Merge meta + hit counts into a per-file summary (statements / branches / functions / lines). */
export function coverageSummary(meta, hits) {
    const h = hits || { s: {}, f: {}, b: {} };
    const sTot = meta.s.length, sHit = meta.s.filter((_, i) => h.s[i] > 0).length;
    const fTot = meta.f.length, fHit = meta.f.filter((_, i) => h.f[i] > 0).length;
    let bTot = 0, bHit = 0;
    meta.b.forEach((b, i) => { bTot += b.n; for (let k = 0; k < b.n; k++) if (h.b[i] && h.b[i][k] > 0) bHit++; });
    const lines = {};
    meta.s.forEach((line, i) => { lines[line] = Math.max(lines[line] || 0, h.s[i] || 0); });
    const lTot = Object.keys(lines).length, lHit = Object.values(lines).filter(v => v > 0).length;
    const pct = (a, b) => (b ? Math.round(a / b * 1000) / 10 : 100);
    const uncoveredBranches = [];
    meta.b.forEach((b, i) => { for (let k = 0; k < b.n; k++) if (!(h.b[i] && h.b[i][k] > 0)) uncoveredBranches.push({ line: b.line, type: b.type, arm: k }); });
    return { statements: { total: sTot, hit: sHit, pct: pct(sHit, sTot) }, functions: { total: fTot, hit: fHit, pct: pct(fHit, fTot) }, branches: { total: bTot, hit: bHit, pct: pct(bHit, bTot) },
        lines: { total: lTot, hit: lHit, pct: pct(lHit, lTot) }, lineHits: lines, uncoveredLines: Object.keys(lines).filter(l => !lines[l]).map(Number).sort((a, b) => a - b),
        uncoveredFunctions: meta.f.filter((_, i) => !(h.f[i] > 0)), uncoveredBranches };
}
/** LCOV export (works with Codecov/Coveralls/VS Code Coverage Gutters). */
export function toLcov(files) {
    return Object.entries(files).map(([path, { meta, hits }]) => {
        const h = hits || { s: {}, f: {}, b: {} }, sum = coverageSummary(meta, h), out = ['TN:', 'SF:' + path];
        meta.f.forEach((f, i) => out.push(`FN:${f.line},${f.name}`, `FNDA:${h.f[i] || 0},${f.name}`));
        out.push(`FNF:${sum.functions.total}`, `FNH:${sum.functions.hit}`);
        meta.b.forEach((b, i) => { for (let k = 0; k < b.n; k++) out.push(`BRDA:${b.line},${i},${k},${h.b[i] && h.b[i][k] ? h.b[i][k] : '-'}`); });
        out.push(`BRF:${sum.branches.total}`, `BRH:${sum.branches.hit}`);
        Object.entries(sum.lineHits).forEach(([l, c]) => out.push(`DA:${l},${c}`));
        out.push(`LF:${sum.lines.total}`, `LH:${sum.lines.hit}`, 'end_of_record');
        return out.join('\n');
    }).join('\n') + '\n';
}

// ------------------------------------------------------------------ #171-#175 DEBUGGER (record & replay)
/** Names visible at each statement: params + declarations of every enclosing scope (hoisting-aware enough for display). */
function declaredIn(node) {
    const names = [];
    const pat = (p) => {
        if (!p) return;
        if (p.type === 'Identifier') names.push(p.name);
        else if (p.type === 'ObjectPattern') p.properties.forEach(q => pat(q.type === 'RestElement' ? q.argument : q.value));
        else if (p.type === 'ArrayPattern') p.elements.forEach(pat);
        else if (p.type === 'RestElement') pat(p.argument);
        else if (p.type === 'AssignmentPattern') pat(p.left);
    };
    const body = node.type === 'Program' || node.type === 'BlockStatement' ? node.body : node.type === 'SwitchCase' ? node.consequent : [];
    body.forEach(s => {
        if (s.type === 'VariableDeclaration') s.declarations.forEach(d => pat(d.id));
        else if ((s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') && s.id) names.push(s.id.name);
        else if (/^For(In|Of)?Statement$/.test(s.type)) { const d = s.init || s.left; if (d && d.type === 'VariableDeclaration' && d.kind === 'var') d.declarations.forEach(x => pat(x.id)); }
    });
    if (FN.has(node.type)) node.params.forEach(pat);
    if (node.type === 'CatchClause' && node.param) pat(node.param);
    if (/^For(In|Of)?Statement$/.test(node.type)) { const d = node.init || node.left; if (d && d.type === 'VariableDeclaration') d.declarations.forEach(x => pat(x.id)); }
    return names;
}
const RESERVED_SCOPE = new Set(['exports', 'require', 'module', '__filename', '__dirname', 'arguments']);
/**
 * Insert probes before every statement: __oxd.s(file, line, depthInfo, getters, watches).
 * Getters are per-variable thunks (TDZ-safe at call time) so no eval is needed — the sandbox CSP forbids it.
 * Watch expressions are compiled in as thunks; "evaluate" re-runs the program with the expression added.
 */
export function instrumentDebug(code, file, { watches = [], maxVars = 30 } = {}) {
    const ast = parseJS(code);
    const edits = [], lines = new Set();
    const F = JSON.stringify(file);
    const W = watches.length ? '[' + watches.map(w => `function(){return (${w});}`).join(',') + ']' : 'null';
    const scopes = [];
    const visibleNames = () => { const seen = new Set(), out = []; for (let i = scopes.length - 1; i >= 0; i--) for (const n of scopes[i]) if (!seen.has(n) && !RESERVED_SCOPE.has(n)) { seen.add(n); out.push(n); } return out.slice(0, maxVars); };
    const getters = () => { const names = visibleNames(); return names.length ? '{' + names.map(n => `${JSON.stringify(n)}:function(){return ${n};}`).join(',') + '}' : 'null'; };
    const probe = (n) => { lines.add(n.loc.start.line); return `__oxd.s(${F},${n.loc.start.line},${getters()},${W});`; };
    (function visit(n, parent, key) {
        if (!n || typeof n.type !== 'string') return;
        const opens = n.type === 'Program' || n.type === 'BlockStatement' || FN.has(n.type) || n.type === 'CatchClause' || /^For(In|Of)?Statement$/.test(n.type) || n.type === 'SwitchCase';
        if (opens) scopes.push(declaredIn(n));
        if (parent && isStmtList(parent, key) && !SKIP_STMT.has(n.type) && !(n.type === 'ExpressionStatement' && n.directive)) edits.push({ at: n.start, text: probe(n) });
        if (parent && /^(If|For|ForIn|ForOf|While|DoWhile)Statement$/.test(parent.type) && (key === 'consequent' || key === 'alternate' || key === 'body') && n.type !== 'BlockStatement' && !(parent.type === 'IfStatement' && n.type === 'IfStatement')) {
            edits.push({ at: n.start, text: '{' + probe(n) }, { at: n.end, text: '}', end: true });
        }
        if (FN.has(n.type)) {
            const name = JSON.stringify(fnName(n, parent)), line = n.loc.start.line;
            if (n.body.type === 'BlockStatement') { edits.push({ at: n.body.start + 1, text: `__oxd.enter(${name},${F},${line});try{`, pr: 5 }); edits.push({ at: n.body.end - 1, text: '}finally{__oxd.exit();}', end: true, pr: -5 }); }
            else { edits.push({ at: n.body.start, text: `{__oxd.enter(${name},${F},${line});try{return (` }); edits.push({ at: n.body.end, text: ');}finally{__oxd.exit();}}', end: true }); }
        }
        for (const k of Object.keys(n)) {
            if (k === 'loc' || k === 'start' || k === 'end' || k === 'type') continue;
            const v = n[k];
            if (Array.isArray(v)) v.forEach(c => visit(c, n, k)); else if (v && typeof v.type === 'string') visit(v, n, k);
        }
        if (opens) scopes.pop();
    })(ast, null, null);
    return { code: splice(code, edits), lines: Array.from(lines).sort((a, b) => a - b) };
}
/** Debugger runtime prelude (serialised). Records a bounded trace; reports it on done. */
export function debugExt(x) {
    var cfg = (x.cfg && x.cfg.debug) || {};
    var max = cfg.maxSteps || 5000, trace = [], stack = [], truncated = false, step = 0;
    var outN = 0;
    if (x.console) ['log', 'info', 'warn', 'error', 'debug', 'table'].forEach(function (k) { var o = x.console[k]; if (typeof o === 'function') x.console[k] = function () { outN++; return o.apply(this, arguments); }; });
    var snap = function (getters) {
        if (!getters) return null;
        var o = {};
        Object.keys(getters).forEach(function (k) { try { var v = getters[k](); if (typeof v === 'function') { o[k] = 'ƒ ' + (v.name || ''); } else o[k] = x.fmt(v, 2); } catch (e) { o[k] = '‹غير مهيأ›'; } });
        return o;
    };
    x.G.__oxd = {
        s: function (file, line, getters, watches) {
            step++;
            if (trace.length >= max) { truncated = true; return; }
            var w = null;
            if (watches) w = watches.map(function (f) { try { return x.fmt(f(), 2); } catch (e) { return '⚠ ' + (e && e.message || e); } });
            trace.push({ i: step, file: file, line: line, depth: stack.length, stack: stack.map(function (f) { return f.name + '@' + f.file + ':' + f.line; }), vars: snap(getters), watch: w, out: outN });
        },
        enter: function (name, file, line) { stack.push({ name: name, file: file, line: line }); },
        exit: function () { stack.pop(); }
    };
    x.beforeDone(function (code) { x.send({ type: 'trace', trace: trace, truncated: truncated, steps: step, exitCode: code }); });
}
/** Step navigation over a recorded trace (pure). mode: into | over | out | back | continue | continueBack. */
export function navigate(trace, cur, mode, breakpoints = new Set()) {
    if (!trace.length) return -1;
    const bp = (t) => breakpoints.has(t.file + ':' + t.line);
    const d = trace[cur] ? trace[cur].depth : 0;
    if (mode === 'into') return Math.min(trace.length - 1, cur + 1);
    if (mode === 'back') return Math.max(0, cur - 1);
    if (mode === 'over') { for (let i = cur + 1; i < trace.length; i++) if (trace[i].depth <= d) return i; return trace.length - 1; }
    if (mode === 'out') { for (let i = cur + 1; i < trace.length; i++) if (trace[i].depth < d) return i; return trace.length - 1; }
    if (mode === 'continue') { for (let i = cur + 1; i < trace.length; i++) if (bp(trace[i])) return i; return trace.length - 1; }
    if (mode === 'continueBack') { for (let i = cur - 1; i >= 0; i--) if (bp(trace[i])) return i; return 0; }
    return cur;
}

// ------------------------------------------------------------------ #167 MUTATION TESTING
const BIN_SWAP = { '+': '-', '-': '+', '*': '/', '/': '*', '%': '*', '<': '<=', '<=': '<', '>': '>=', '>=': '>', '===': '!==', '!==': '===', '==': '!=', '!=': '==' };
const LOGIC_SWAP = { '&&': '||', '||': '&&', '??': '&&' };
/** Generate mutants over transpiled JS. Each: { id, line, column, from, to, original, replacement, op }. */
export function generateMutants(code, { max = 60, skipLines = [] } = {}) {
    const ast = parseJS(code), out = [];
    const skip = new Set(skipLines);
    const add = (node, from, to, replacement, op) => {
        if (skip.has(node.loc.start.line)) return;
        const original = code.slice(from, to);
        if (original === replacement) return;
        out.push({ id: out.length, line: node.loc.start.line, column: node.loc.start.column + 1, from, to, original, replacement, op });
    };
    const isRequire = (n) => n && n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'require';
    walk(ast, (n, parent) => {
        if (isRequire(n)) return false;
        if (n.type === 'ExpressionStatement' && n.expression.type === 'Literal' && typeof n.expression.value === 'string') return false; // 'use strict'
        if (n.type === 'BinaryExpression' && BIN_SWAP[n.operator]) {
            const opStart = code.indexOf(n.operator, n.left.end);
            if (opStart >= 0 && opStart < n.right.start) add(n, opStart, opStart + n.operator.length, BIN_SWAP[n.operator], 'معامل حسابي/مقارنة');
        }
        if (n.type === 'LogicalExpression' && LOGIC_SWAP[n.operator]) {
            const opStart = code.indexOf(n.operator, n.left.end);
            if (opStart >= 0 && opStart < n.right.start) add(n, opStart, opStart + n.operator.length, LOGIC_SWAP[n.operator], 'معامل منطقي');
        }
        if (n.type === 'Literal' && typeof n.value === 'boolean') add(n, n.start, n.end, String(!n.value), 'قيمة منطقية');
        if (n.type === 'Literal' && typeof n.value === 'number' && !(parent && parent.type === 'MemberExpression' && parent.property === n)) add(n, n.start, n.end, n.value === 0 ? '1' : '0', 'ثابت رقمي');
        if (n.type === 'Literal' && typeof n.value === 'string' && n.value && !(parent && (parent.type === 'Property' && parent.key === n))) add(n, n.start, n.end, '""', 'نص');
        if (n.type === 'UnaryExpression' && n.operator === '!') add(n, n.start, n.argument.start, '', 'حذف النفي');
        if (n.type === 'IfStatement' || n.type === 'WhileStatement' || n.type === 'ConditionalExpression') {
            if (n.test.type !== 'Literal') { add(n.test, n.test.start, n.test.end, 'true', 'شرط دائماً صحيح'); add(n.test, n.test.start, n.test.end, 'false', 'شرط دائماً خاطئ'); }
        }
        if (n.type === 'ReturnStatement' && n.argument && !(n.argument.type === 'Identifier' && n.argument.name === 'undefined')) add(n, n.argument.start, n.argument.end, 'undefined', 'إرجاع undefined');
        if (n.type === 'UpdateExpression') add(n, n.start, n.end, code.slice(n.start, n.end).replace(n.operator, n.operator === '++' ? '--' : '++'), 'زيادة/نقصان');
        if (n.type === 'BlockStatement' && parent && FN.has(parent.type) && n.body.length) add(n, n.start, n.end, '{}', 'جسم دالة فارغ');
    });
    // spread across the file rather than the first N
    if (out.length <= max) return out;
    const step = out.length / max;
    return Array.from({ length: max }, (_, i) => ({ ...out[Math.floor(i * step)], id: i }));
}
export const applyMutant = (code, m) => code.slice(0, m.from) + m.replacement + code.slice(m.to);
export function mutationScore(results) {
    const total = results.length, killed = results.filter(r => r.status === 'killed' || r.status === 'timeout' || r.status === 'error').length;
    return { total, killed, survived: results.filter(r => r.status === 'survived').length, score: total ? Math.round(killed / total * 1000) / 10 : 0 };
}
