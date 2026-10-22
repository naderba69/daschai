/* ==============================================================================
   OX-Alpha Workbench Pro — tools worker (same-origin file, loaded on demand)
   Prettier formatting (#140) and live ESLint with auto-fix (#141), off the main
   thread. Libraries are pulled from jsDelivr the first time they are needed.
   In Node (tests) `createTools({ load })` is used directly with node_modules.
   ============================================================================== */
/* eslint-env worker */
'use strict';
var PRETTIER_VERSION = '3.9.10';
var ESLINT_VERSION = '10.13.0';
var TS_VERSION = '6.0.3';
var CDN = {
    prettier: 'https://cdn.jsdelivr.net/npm/prettier@' + PRETTIER_VERSION + '/standalone.js',
    plugin: function (n) { return 'https://cdn.jsdelivr.net/npm/prettier@' + PRETTIER_VERSION + '/plugins/' + n + '.js'; },
    eslint: 'https://cdn.jsdelivr.net/npm/eslint-linter-browserify@' + ESLINT_VERSION + '/linter.min.js',
    typescript: 'https://cdn.jsdelivr.net/npm/typescript@' + TS_VERSION + '/lib/typescript.js',
    tsLib: function (n) { return 'https://cdn.jsdelivr.net/npm/typescript@' + TS_VERSION + '/lib/' + n; }
};

var PARSERS = {
    js: ['babel', ['babel', 'estree']], mjs: ['babel', ['babel', 'estree']], cjs: ['babel', ['babel', 'estree']], jsx: ['babel', ['babel', 'estree']],
    ts: ['typescript', ['typescript', 'estree']], tsx: ['typescript', ['typescript', 'estree']], mts: ['typescript', ['typescript', 'estree']], cts: ['typescript', ['typescript', 'estree']],
    json: ['json', ['babel', 'estree']], jsonc: ['json', ['babel', 'estree']], json5: ['json5', ['babel', 'estree']], webmanifest: ['json', ['babel', 'estree']],
    css: ['css', ['postcss']], scss: ['scss', ['postcss']], less: ['less', ['postcss']],
    html: ['html', ['html', 'postcss', 'babel', 'estree']], htm: ['html', ['html', 'postcss', 'babel', 'estree']], vue: ['vue', ['html', 'postcss', 'babel', 'estree']],
    md: ['markdown', ['markdown']], markdown: ['markdown', ['markdown']], yaml: ['yaml', ['yaml']], yml: ['yaml', ['yaml']],
    graphql: ['graphql', ['graphql']], gql: ['graphql', ['graphql']]
};
function extOf(p) { var n = String(p || '').split('/').pop(); return n.indexOf('.') >= 0 ? n.split('.').pop().toLowerCase() : ''; }
function parserFor(path) { return PARSERS[extOf(path)] || null; }

var GLOBALS = {};
('window self document navigator location history localStorage sessionStorage indexedDB fetch Request Response Headers URL URLSearchParams Blob File FileReader FormData ' +
    'console setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame queueMicrotask structuredClone alert confirm prompt ' +
    'Event CustomEvent EventTarget AbortController TextEncoder TextDecoder crypto performance Worker WebSocket HTMLElement Element Node NodeList MutationObserver IntersectionObserver ResizeObserver ' +
    'Image Audio getComputedStyle matchMedia atob btoa Intl globalThis ' +
    'require module exports process __dirname __filename Buffer global setImmediate ' +
    'describe it test expect beforeEach afterEach beforeAll afterAll jest vi input').split(' ').forEach(function (g) { GLOBALS[g] = 'readonly'; });
['module', 'exports'].forEach(function (g) { GLOBALS[g] = 'writable'; });

var RECOMMENDED = ['constructor-super', 'for-direction', 'getter-return', 'no-async-promise-executor', 'no-case-declarations', 'no-class-assign', 'no-compare-neg-zero', 'no-cond-assign',
    'no-const-assign', 'no-constant-binary-expression', 'no-constant-condition', 'no-control-regex', 'no-debugger', 'no-delete-var', 'no-dupe-args', 'no-dupe-class-members', 'no-dupe-else-if',
    'no-dupe-keys', 'no-duplicate-case', 'no-empty', 'no-empty-character-class', 'no-empty-pattern', 'no-empty-static-block', 'no-ex-assign', 'no-extra-boolean-cast', 'no-fallthrough',
    'no-func-assign', 'no-global-assign', 'no-import-assign', 'no-invalid-regexp', 'no-irregular-whitespace', 'no-loss-of-precision', 'no-misleading-character-class',
    'no-new-native-nonconstructor', 'no-nonoctal-decimal-escape', 'no-obj-calls', 'no-octal', 'no-prototype-builtins', 'no-redeclare', 'no-regex-spaces', 'no-self-assign', 'no-setter-return',
    'no-shadow-restricted-names', 'no-sparse-arrays', 'no-this-before-super', 'no-unexpected-multiline', 'no-unreachable', 'no-unsafe-finally', 'no-unsafe-negation',
    'no-unsafe-optional-chaining', 'no-unused-labels', 'no-unused-private-class-members', 'no-useless-backreference', 'no-useless-catch', 'no-useless-escape', 'no-with', 'require-yield',
    'use-isnan', 'valid-typeof'];

function createTools(opts) {
    var load = opts.load;
    var prettierP = null, plugins = {}, linter = null, ruleNames = null;
    function getPrettier() { if (!prettierP) prettierP = Promise.resolve(load('prettier')); return prettierP; }
    function getPlugin(name) { if (!plugins[name]) plugins[name] = Promise.resolve(load('plugin:' + name)); return plugins[name]; }
    function getLinter() {
        if (linter) return Promise.resolve(linter);
        return Promise.resolve(load('eslint')).then(function (mod) {
            var L = mod.Linter || (mod.default && mod.default.Linter);
            linter = new L({ configType: 'flat' });
            try {
                // Keep only rules this ESLint build knows about (unknown rules are config errors)
                var known = L.prototype.getRules ? Array.from(new L({ configType: 'eslintrc' }).getRules().keys()) : null;
                ruleNames = known ? RECOMMENDED.filter(function (r) { return known.indexOf(r) >= 0; }) : RECOMMENDED;
            } catch (e) { ruleNames = RECOMMENDED; }
            return linter;
        });
    }
    function configFor(path) {
        var ext = extOf(path);
        var rules = {};
        ruleNames.forEach(function (r) { rules[r] = 'error'; });
        rules['no-undef'] = 'warn';
        rules['no-empty'] = 'warn';
        rules['no-useless-escape'] = 'warn';
        rules['no-debugger'] = 'warn';
        rules['no-unused-vars'] = 'off'; // project-aware unused detection lives in the editor
        return [{
            files: ['**/*'],
            languageOptions: { ecmaVersion: 'latest', sourceType: ext === 'cjs' ? 'commonjs' : 'module', parserOptions: { ecmaFeatures: { jsx: true } }, globals: GLOBALS },
            linterOptions: { reportUnusedDisableDirectives: 'off' },
            rules: rules
        }];
    }
    function format(msg) {
        var p = parserFor(msg.path);
        if (!p) return Promise.resolve({ error: 'لا يوجد منسق لهذا النوع من الملفات' });
        return getPrettier().then(function (prettier) {
            return Promise.all(p[1].map(getPlugin)).then(function (pl) {
                var o = msg.options || {};
                return prettier.format(msg.code, { parser: p[0], plugins: pl, filepath: msg.path, tabWidth: o.tabWidth || 2, printWidth: o.printWidth || 100, singleQuote: o.singleQuote !== undefined ? o.singleQuote : true, semi: o.semi !== undefined ? o.semi : true, trailingComma: o.trailingComma || 'es5' });
            });
        }).then(function (code) { return { code: code }; }, function (e) {
            return { error: String(e && e.message || e).split('\n')[0], loc: e && e.loc && e.loc.start ? { line: e.loc.start.line, column: e.loc.start.column } : null };
        });
    }
    function lint(msg) {
        var ext = extOf(msg.path);
        if (['js', 'mjs', 'cjs', 'jsx'].indexOf(ext) < 0) return Promise.resolve({ messages: [] });
        return getLinter().then(function (l) {
            var cfg = configFor(msg.path);
            var name = msg.path || 'file.js';
            if (msg.fix) {
                var r = l.verifyAndFix(msg.code, cfg, { filename: name });
                return { output: r.output, fixed: r.fixed, messages: r.messages.map(slim) };
            }
            return { messages: l.verify(msg.code, cfg, { filename: name }).map(slim) };
        });
    }
    function slim(m) { return { line: m.line, column: m.column, endLine: m.endLine, endColumn: m.endColumn, severity: m.severity, message: m.message, ruleId: m.ruleId || null, fatal: !!m.fatal, fix: !!m.fix }; }
    // ---------------------------------------------------------------- #143 type checking (TypeScript compiler API)
    var tsP = null, libText = {}, libSF = {}, oldProgram = null;
    function getTS() { if (!tsP) tsP = Promise.resolve(load('typescript')); return tsP; }
    function loadLibs(names) {
        var loadLib = opts.loadLib || function (n) { return Promise.resolve(load('lib:' + n)); };
        var pending = {};
        function one(file) {
            if (libText[file] != null || pending[file]) return pending[file] || Promise.resolve();
            pending[file] = Promise.resolve(loadLib(file)).then(function (text) {
                libText[file] = String(text || '');
                var refs = [], re = /\/\/\/\s*<reference\s+lib="([^"]+)"/g, m;
                while ((m = re.exec(libText[file]))) refs.push('lib.' + m[1].toLowerCase() + '.d.ts');
                return Promise.all(refs.map(one));
            });
            return pending[file];
        }
        return Promise.all(names.map(one));
    }
    var IGNORE_BARE = [2307, 7016, 2792];   // npm packages have no type definitions in the browser
    function typecheck(msg) {
        var path = String(msg.path || 'index.ts').replace(/^\/+/, '');
        var ext = extOf(path);
        if (['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'].indexOf(ext) < 0) return Promise.resolve({ diagnostics: [] });
        var libs = (msg.lib || ['es2022', 'dom']).map(function (l) { return 'lib.' + String(l).toLowerCase().replace(/^lib\.|\.d\.ts$/g, '') + '.d.ts'; });
        return getTS().then(function (ts) {
            return loadLibs(libs).then(function () {
                var files = {};
                Object.keys(msg.files || {}).forEach(function (k) { files['/' + k.replace(/^\/+/, '')] = msg.files[k]; });
                files['/' + path] = msg.code;
                var co = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.Preserve,
                    strict: msg.strict !== false, noEmit: true, allowJs: true, checkJs: /^(js|jsx|mjs|cjs)$/.test(ext), skipLibCheck: true, esModuleInterop: true, allowImportingTsExtensions: true,
                    resolveJsonModule: true, isolatedModules: false, types: [], lib: libs };
                if (msg.compilerOptions) {
                    var conv = ts.convertCompilerOptionsFromJson(msg.compilerOptions, '/');
                    Object.keys(conv.options || {}).forEach(function (k) { if (['lib', 'types', 'noEmit', 'outDir', 'rootDir', 'baseUrl', 'paths', 'typeRoots'].indexOf(k) < 0) co[k] = conv.options[k]; });
                }
                var host = {
                    getSourceFile: function (name, lang) {
                        var base = name.replace(/^.*\//, '');
                        if (libText[base] != null && (name === base || name === '/' + base)) return libSF[base] || (libSF[base] = ts.createSourceFile('/' + base, libText[base], lang, true));
                        var t = files[name];
                        return t == null ? undefined : ts.createSourceFile(name, t, lang, true);
                    },
                    getDefaultLibFileName: function () { return '/' + libs[0]; },
                    getDefaultLibLocation: function () { return '/'; },
                    writeFile: function () {}, getCurrentDirectory: function () { return '/'; }, getDirectories: function () { return []; },
                    getCanonicalFileName: function (f) { return f; }, useCaseSensitiveFileNames: function () { return true; }, getNewLine: function () { return '\n'; },
                    fileExists: function (f) { return files[f] != null || libText[f.replace(/^\//, '')] != null; },
                    readFile: function (f) { return files[f] != null ? files[f] : libText[f.replace(/^\//, '')]; },
                    directoryExists: function () { return true; }
                };
                var roots = Object.keys(files).filter(function (f) { return /\.(d\.ts|ts|tsx|mts|cts)$/.test(f) || f === '/' + path; });
                var program = ts.createProgram({ rootNames: roots, options: co, host: host, oldProgram: oldProgram || undefined });
                oldProgram = program;
                var sf = program.getSourceFile('/' + path);
                var diags = program.getSyntacticDiagnostics(sf).concat(program.getSemanticDiagnostics(sf));
                var out = [];
                diags.forEach(function (d) {
                    var text = ts.flattenDiagnosticMessageText(d.messageText, '\n');
                    if (IGNORE_BARE.indexOf(d.code) >= 0 && /['"][^.'"/][^'"]*['"]/.test(text) && !/['"]\.{1,2}\//.test(text)) return;
                    var st = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : { line: 0, character: 0 };
                    var en = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start + (d.length || 0)) : st;
                    out.push({ line: st.line + 1, column: st.character + 1, endLine: en.line + 1, endColumn: en.character + 1, start: d.start || 0, length: d.length || 0,
                        severity: d.category === ts.DiagnosticCategory.Error ? 2 : 1, message: text, code: d.code });
                });
                return { diagnostics: out, version: ts.version };
            });
        });
    }
    function handle(msg) {
        var job = msg.type === 'format' ? format(msg) : msg.type === 'lint' ? lint(msg) : msg.type === 'typecheck' ? typecheck(msg) : msg.type === 'ping' ? Promise.resolve({ ok: true }) : Promise.resolve({ error: 'unknown request ' + msg.type });
        return job.then(null, function (e) { return { error: String(e && e.message || e) }; });
    }
    return { handle: handle, format: format, lint: lint, typecheck: typecheck, parserFor: parserFor };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createTools: createTools, parserFor: parserFor, PARSERS: PARSERS, PRETTIER_VERSION: PRETTIER_VERSION, ESLINT_VERSION: ESLINT_VERSION, TS_VERSION: TS_VERSION };
} else if (typeof importScripts === 'function') {
    var tools = createTools({
        load: function (name) {
            if (name === 'prettier') { importScripts(CDN.prettier); return self.prettier; }
            if (name === 'eslint') { importScripts(CDN.eslint); return self.eslint; }
            if (name === 'typescript') { importScripts(CDN.typescript); return self.ts; }
            if (name.indexOf('lib:') === 0) return fetch(CDN.tsLib(name.slice(4))).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
            if (name.indexOf('plugin:') === 0) { var n = name.slice(7); importScripts(CDN.plugin(n)); return self.prettierPlugins[n]; }
            throw new Error('unknown library ' + name);
        }
    });
    self.onmessage = function (e) {
        var msg = e.data || {};
        tools.handle(msg).then(function (res) { self.postMessage(Object.assign({ id: msg.id }, res)); });
    };
}
