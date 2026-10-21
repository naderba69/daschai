/* AI generators catalog (#20-#130) + the AI Lab panel shell.
   Every generator = specialised instructions + the right context (code selection / project snapshot /
   local analyzer findings) + output handling (files are previewed and written into the project). */
import { esc, fillTemplate, parseFileBlocks } from './shared.js';
import * as A from './analyzers.js';

const FILES = 'Output every file as a fenced code block whose info string is "<lang> [relative/path.ext]" (example: ```ts [src/server.ts]). Give complete file contents, no placeholders.';
const LANGS20 = ['العربية', 'English', 'Français', 'Español', 'Deutsch', 'Italiano', 'Português', 'Türkçe', 'Русский', '中文', '日本語', '한국어', 'हिन्दी', 'اردو', 'فارسی', 'Bahasa Indonesia', 'Nederlands', 'Polski', 'Svenska', 'Kiswahili'];
const PROG = ['TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'Java', 'C#', 'PHP', 'Kotlin', 'Swift', 'Dart', 'Ruby', 'C++'];
const sel = (id, label, options, value) => ({ id, label, type: 'select', options: options.map(o => (typeof o === 'string' ? { value: o, label: o } : o)), value: value || (typeof options[0] === 'string' ? options[0] : options[0].value) });
const txt = (id, label, placeholder = '', rows = 4) => ({ id, label, type: 'textarea', placeholder, rows });
const inp = (id, label, placeholder = '', value = '') => ({ id, label, type: 'text', placeholder, value });
const stack = (value = 'Node.js + Express + TypeScript') => inp('stack', 'التقنيات', 'مثال: Node.js + Express', value);

export const CATEGORIES = [
    ['all', 'fa-border-all', 'الكل'], ['code', 'fa-code', 'الكود'], ['project', 'fa-diagram-project', 'المشروع والتوثيق'], ['api', 'fa-plug', 'API'],
    ['backend', 'fa-server', 'أنظمة خلفية'], ['devops', 'fa-cloud', 'DevOps'], ['frontend', 'fa-palette', 'واجهات'], ['deps', 'fa-cubes', 'الاعتماديات'], ['career', 'fa-user-tie', 'المسار المهني']
];

/* [id, idea#, category, icon, label, fields, options] — options: { code, project, local, files, prompt, kind, max } */
export const GENERATORS = [
    // ---------------------------------------------------------------- code
    { id: 'explain-levels', idea: 22, cat: 'code', icon: 'fa-graduation-cap', label: 'شرح الكود بثلاثة مستويات', code: true, fields: [sel('level', 'المستوى', [{ value: 'all', label: 'الثلاثة معاً' }, { value: 'beginner', label: 'مبتدئ' }, { value: 'intermediate', label: 'متوسط' }, { value: 'expert', label: 'خبير' }])],
        prompt: 'Explain this code in Arabic. Level: {{level}}. If "all", give three sections: 🟢 مبتدئ (analogies, no jargon), 🟡 متوسط (how it works, key concepts), 🔴 خبير (complexity, edge cases, design trade-offs, improvements).' },
    { id: 'convert-lang', idea: 23, cat: 'code', icon: 'fa-language', label: 'تحويل الكود للغة أخرى مع اختباراته', code: true, files: true, fields: [sel('to', 'إلى', PROG, 'Python')],
        prompt: 'Translate this code to {{to}} idiomatically (same behaviour, idiomatic naming, standard library). ALSO port its tests (or write equivalent tests if none) using the standard test framework of {{to}}, so behaviour is verified to be preserved. Then list any semantic differences in Arabic.' },
    { id: 'patterns', idea: 24, cat: 'code', icon: 'fa-shapes', label: 'كشف أنماط التصميم واقتراح تحسينها', code: true, local: 'patterns',
        prompt: 'Identify the design patterns and code smells in this code (local scan results are attached). For each: where it is, whether it is used well, and a concrete refactoring with a short code example. Answer in Arabic.' },
    { id: 'naming', idea: 25, cat: 'code', icon: 'fa-signature', label: 'أسماء أفضل للمتغيرات والدوال', code: true, local: 'naming',
        prompt: 'Suggest better names for variables, functions and classes in this code (local findings attached). Return a Markdown table: current | suggested | why (Arabic). Then give the code with the renames applied.' },
    { id: 'docs', idea: 26, cat: 'code', icon: 'fa-file-lines', label: 'توليد تعليقات ووثائق تلقائياً', code: true, fields: [sel('style', 'النمط', ['JSDoc / TSDoc', 'Python docstrings (Google)', 'README للوحدة', 'الكل'])],
        prompt: 'Document this code ({{style}}): doc comments for every exported function/class (params, returns, throws, example), concise inline comments only where logic is non-obvious. Return the full documented code, then (if README requested) a Markdown README section.' },
    { id: 'sql-optimize', idea: 46, cat: 'code', icon: 'fa-database', label: 'تحسين استعلامات SQL', fields: [txt('sql', 'الاستعلام', 'SELECT ...', 6), txt('schema', 'المخطط/الفهارس (اختياري)', 'CREATE TABLE ...', 4), sel('db', 'قاعدة البيانات', ['PostgreSQL', 'MySQL', 'SQLite', 'SQL Server', 'Oracle'])],
        prompt: 'Optimize this {{db}} query.\nQuery:\n{{sql}}\nSchema/indexes:\n{{schema}}\nGive: problems found (Arabic), the rewritten query, recommended indexes (CREATE INDEX), and how to verify with EXPLAIN ANALYZE.' },
    { id: 'nl-sql', idea: 47, cat: 'code', icon: 'fa-comments', label: 'سؤال بالعربية ← SQL', project: true, fields: [txt('question', 'السؤال', 'أكثر 10 عملاء شراءً هذا الشهر', 3), sel('db', 'قاعدة البيانات', ['PostgreSQL', 'MySQL', 'SQLite', 'SQL Server'])],
        prompt: 'Write a {{db}} SQL query that answers: "{{question}}". Use the schema found in the project files (.sql / migrations / models) if present; otherwise state the assumed tables. Return the query in a ```sql block, then a short Arabic explanation.' },
    { id: 'n-plus-one', idea: 48, cat: 'code', icon: 'fa-repeat', label: 'كشف استعلامات N+1 وحلها', code: true, local: 'nplus1',
        prompt: 'Find N+1 query problems in this code (local scan attached) and rewrite the affected parts to batch the queries (eager loading / IN / joins / DataLoader / Promise.all). Explain each fix in Arabic.' },
    { id: 'migrations', idea: 49, cat: 'code', icon: 'fa-database', label: 'توليد Migrations', project: true, files: true, fields: [txt('change', 'التغيير المطلوب', 'أضف جدول orders مرتبط بـ users مع حالة ومبلغ', 3), sel('tool', 'الأداة', ['Prisma', 'Knex', 'Sequelize', 'TypeORM', 'Django', 'Alembic', 'Laravel', 'Rails', 'SQL خام'])],
        prompt: 'Generate {{tool}} migration(s) for: {{change}}. Infer the current schema from project files. Include up AND down (rollback), indexes and foreign keys. ' + FILES },
    { id: 'big-o', idea: 51, cat: 'code', icon: 'fa-chart-line', label: 'تحليل تعقيد الكود Big-O', code: true, local: 'complexity',
        prompt: 'Analyse the time and space complexity (Big-O) of each function in this code (a local estimate is attached — confirm or correct it). Explain the dominant operations and best/average/worst cases in Arabic.' },
    { id: 'faster-algo', idea: 52, cat: 'code', icon: 'fa-gauge-high', label: 'اقتراح خوارزمية أسرع', code: true, local: 'complexity',
        prompt: 'Propose a faster algorithm for this code. State the current complexity, the new complexity, the idea (Arabic), and give the full optimized implementation plus a tiny benchmark snippet comparing both.' },
    { id: 'compare-algo', idea: 53, cat: 'code', icon: 'fa-scale-balanced', label: 'مقارنة خوارزميتين واختيار الأفضل', fields: [txt('a', 'الخوارزمية أ', '', 6), txt('b', 'الخوارزمية ب', '', 6), inp('context', 'السياق', 'حجم البيانات، القيود…')],
        prompt: 'Compare these two implementations.\nA:\n{{a}}\nB:\n{{b}}\nContext: {{context}}\nCompare correctness, time/space complexity, readability, edge cases and real-world performance. Finish with a clear verdict (Arabic) and a benchmark snippet.' },
    { id: 'parallel', idea: 54, cat: 'code', icon: 'fa-layer-group', label: 'تحويل الكود إلى متوازي Multi-thread', code: true, fields: [sel('target', 'الأسلوب', ['Web Workers', 'Node worker_threads', 'Python multiprocessing / concurrent.futures', 'Go goroutines', 'Rust rayon', 'Java ExecutorService'])],
        prompt: 'Parallelise this code using {{target}}. Identify independent work, avoid shared mutable state, handle errors and cancellation, and show when parallelism is NOT worth it. Give the full code and an Arabic explanation.' },
    { id: 'async', idea: 56, cat: 'code', icon: 'fa-hourglass-half', label: 'تحويل المتزامن/Callbacks إلى async', code: true, local: 'legacy',
        prompt: 'Convert synchronous/blocking or callback-based parts of this code to async/await (Promises), preserving behaviour and error handling; run independent awaits concurrently (Promise.all). Return the full code and list the changes in Arabic.' },
    { id: 'leaks', idea: 57, cat: 'code', icon: 'fa-faucet-drip', label: 'كشف تسريب الذاكرة وإصلاحه', code: true, local: 'leaks',
        prompt: 'Find memory leaks in this code (local scan attached: listeners, timers, subscriptions, unbounded caches, detached DOM). Give the fixed code and explain each leak and how to confirm it in DevTools (heap snapshots) — Arabic.' },
    { id: 'wasm', idea: 58, cat: 'code', icon: 'fa-microchip', label: 'تحويل دالة إلى WebAssembly', code: true, files: true, fields: [sel('lang', 'لغة WASM', ['Rust (wasm-bindgen)', 'AssemblyScript', 'C (Emscripten)', 'Go (TinyGo)'])],
        prompt: 'Port the performance-critical part of this code to WebAssembly using {{lang}}. Provide the source, build commands, and the JavaScript glue to load and call it, plus a fallback to the JS version. ' + FILES },
    { id: 'diff-summary', idea: 63, cat: 'code', icon: 'fa-code-compare', label: 'تلخيص Diff للمراجع', fields: [txt('diff', 'الـ Diff (اتركه فارغاً لتغييرات المشروع غير المحفوظة)', 'git diff ...', 8)],
        prompt: 'Summarise this diff for a code reviewer (Arabic): purpose, main changes per file, risky spots to review closely, possible bugs, and a suggested review checklist.\n```diff\n{{diff}}\n```' },
    { id: 'translate-comments', idea: 64, cat: 'code', icon: 'fa-earth-africa', label: 'ترجمة تعليقات الكود (20 لغة)', code: true, fields: [sel('to', 'إلى', LANGS20, 'English')],
        prompt: 'Translate ONLY the comments and docstrings in this code to {{to}}. Do not change code, identifiers or string literals. Return the full code.' },
    { id: 'bilingual', idea: 65, cat: 'code', icon: 'fa-clone', label: 'توليد الكود بلغتين معاً', files: true, fields: [txt('task', 'المطلوب', 'دالة تتحقق من صحة بريد إلكتروني مع اختبارات', 3), sel('a', 'اللغة الأولى', PROG, 'TypeScript'), sel('b', 'اللغة الثانية', PROG, 'Python')],
        prompt: 'Implement "{{task}}" in BOTH {{a}} and {{b}} with the same API and behaviour, each with tests. Put them side by side conceptually and note language-specific differences (Arabic). ' + FILES },
    { id: 'modernize', idea: 87, cat: 'code', icon: 'fa-wand-magic', label: 'تحويل الكود القديم إلى حديث', code: true, local: 'legacy',
        prompt: 'Modernise this legacy code (local findings attached): ES2022+/modern idioms, modules, async/await, const/let, optional chaining, modern framework APIs. Keep behaviour identical. Return the full code and a change list (Arabic).' },
    // ---------------------------------------------------------------- project & docs
    { id: 'user-stories', idea: 20, cat: 'project', icon: 'fa-list-check', label: 'متطلبات ← User Stories ومعايير القبول', fields: [txt('req', 'المتطلبات', 'نظام حجز مواعيد لعيادة…', 6)],
        prompt: 'Turn these requirements into user stories (Arabic): "As a … I want … so that …", each with Acceptance Criteria in Given/When/Then, priority (MoSCoW), and estimate (story points). Group into epics. Requirements:\n{{req}}' },
    { id: 'diagrams', idea: 21, cat: 'project', icon: 'fa-sitemap', label: 'توليد UML / ERD / Sequence', fields: [txt('desc', 'الوصف', 'مستخدم يطلب منتجاً، يدفع، ويستلم إشعاراً', 4), sel('kind', 'نوع المخطط', ['Class diagram', 'ERD', 'Sequence diagram', 'Flowchart', 'State diagram', 'الكل'])],
        prompt: 'Create Mermaid diagram(s) ({{kind}}) for: {{desc}}. Put each diagram in a ```mermaid block with a one-line Arabic caption. Use clear entity/participant names.' },
    { id: 'changelog', idea: 28, cat: 'project', icon: 'fa-clock-rotate-left', label: 'CHANGELOG من الـ commits', tool: 'aiChangelogFromCommits' },
    { id: 'scaffold', idea: 29, cat: 'project', icon: 'fa-hammer', label: 'وصف منتج ← مشروع كامل', files: true, max: 12000, fields: [txt('product', 'وصف المنتج', 'تطبيق مهام مع تسجيل دخول وتذكيرات', 5), stack('React + Vite + TypeScript')],
        prompt: 'Scaffold a complete, runnable starter project for: "{{product}}" using {{stack}}. Include package.json (scripts), README (Arabic setup steps), folder structure, main entry, 2-3 core features implemented, basic tests, .gitignore and .env.example. ' + FILES },
    { id: 'build-fix', idea: 30, cat: 'project', icon: 'fa-screwdriver-wrench', label: 'إصلاح أخطاء Build من السجلات', tool: 'aiBuildFix' },
    { id: 'boilerplate', idea: 33, cat: 'project', icon: 'fa-cubes-stacked', label: 'قوالب جاهزة Boilerplates', files: true, max: 10000, fields: [sel('tpl', 'القالب', ['Next.js 15 (App Router + Tailwind)', 'Django 5 + DRF', 'Flutter (Riverpod)', 'FastAPI + SQLModel', 'Express + Prisma', 'NestJS', 'Laravel 11', 'Spring Boot 3', 'Astro', 'SvelteKit', 'Vue 3 + Pinia', 'Go (Gin)', 'Rust (Axum)', 'React Native (Expo)']), inp('name', 'اسم المشروع', 'my-app', 'my-app')],
        prompt: 'Generate a production-ready {{tpl}} boilerplate named "{{name}}": config files, folder structure, linting/formatting, env example, one example feature end-to-end, a test, Dockerfile, and README (Arabic). ' + FILES },
    { id: 'structure', idea: 50, cat: 'project', icon: 'fa-folder-tree', label: 'اقتراح هيكلة مجلدات مثالية', project: true, fields: [inp('goal', 'نوع المشروع', 'تطبيق ويب متوسط الحجم')],
        prompt: 'Propose an ideal folder structure for this project ({{goal}}) based on its current files. Show the target tree, explain each folder (Arabic), and give a step-by-step move plan (old path → new path) that keeps imports working.' },
    { id: 'eslint', idea: 85, cat: 'project', icon: 'fa-shield', label: 'إعداد ESLint ذكي', project: true, files: true, fields: [sel('strict', 'الصرامة', ['متوازن', 'صارم', 'مرن'])],
        prompt: 'Generate an ESLint flat config (eslint.config.js) tailored to this project (detect framework/TypeScript/Node/browser from files). Strictness: {{strict}}. Include the needed devDependencies list and npm scripts. ' + FILES },
    { id: 'prettier', idea: 86, cat: 'project', icon: 'fa-wand-sparkles', label: 'إعداد Prettier', project: true, files: true, fields: [inp('prefs', 'تفضيلات', 'مسافتان، علامات مفردة، 100 حرف')],
        prompt: 'Generate a .prettierrc (JSON) and .prettierignore matching this project\'s existing style (infer from files) and these preferences: {{prefs}}. Add an .editorconfig too. ' + FILES },
    { id: 'code-style', idea: 83, cat: 'project', icon: 'fa-ruler', label: 'فرض Code Style موحد', project: true, files: true,
        prompt: 'Set up a unified code style for this project: .editorconfig, Prettier config, ESLint config, lint-staged + husky pre-commit hook config, and a CONTRIBUTING.md (Arabic) style section. ' + FILES },
    { id: 'e2e', idea: 43, cat: 'project', icon: 'fa-robot', label: 'اختبارات E2E من وصف المستخدم', project: true, files: true, fields: [txt('flow', 'سيناريو المستخدم', 'المستخدم يسجل دخوله ثم يضيف منتجاً للسلة ويدفع', 4), sel('tool', 'الأداة', ['Playwright', 'Cypress', 'WebdriverIO'])],
        prompt: 'Write {{tool}} end-to-end tests for this user flow: "{{flow}}". Use resilient selectors (roles/test-ids), cover happy path + 2 failure cases, and include the config file. ' + FILES },
    { id: 'fake-data', idea: 40, cat: 'project', icon: 'fa-user-secret', label: 'بيانات وهمية واقعية متقدمة', files: true, fields: [txt('schema', 'المخطط', 'users: name, email, city (عربية), age 18-70; orders: user_id, total, status', 4), inp('count', 'العدد', '20', '20'), sel('format', 'الصيغة', ['JSON', 'CSV', 'SQL INSERT', 'Faker.js seed script'])],
        prompt: 'Generate {{count}} realistic, internally consistent records per entity for this schema: {{schema}}. Respect relations (foreign keys), realistic distributions, locale-appropriate names (Arabic where asked). Format: {{format}}. ' + FILES },
    // ---------------------------------------------------------------- API
    { id: 'openapi-api', idea: 41, cat: 'api', icon: 'fa-plug-circle-bolt', label: 'API كامل من OpenAPI Spec', files: true, max: 12000, fields: [txt('spec', 'OpenAPI (YAML/JSON) — أو اتركه فارغاً لاستخدام ملف المشروع', '', 8), stack()],
        prompt: 'Implement a complete API server from this OpenAPI spec using {{stack}}: routes, request validation, typed models, error handling, and tests for each endpoint. If the spec is empty, use the openapi/swagger file in the project.\n{{spec}}\n' + FILES, project: true },
    { id: 'graphql', idea: 42, cat: 'api', icon: 'fa-diagram-project', label: 'GraphQL Schema من REST', project: true, files: true, fields: [txt('rest', 'نقاط REST (اختياري)', 'GET /users, GET /users/:id/posts …', 4)],
        prompt: 'Design a GraphQL schema (SDL) equivalent to this REST API (from the input or the project routes), plus resolvers that call the existing REST layer, with DataLoader to avoid N+1.\n{{rest}}\n' + FILES },
    { id: 'api-docs', idea: 91, cat: 'api', icon: 'fa-book-open', label: 'وثائق API تفاعلية', project: true, files: true,
        prompt: 'Generate interactive API documentation for this project: an openapi.yaml describing all endpoints found in the code, and a self-contained docs/api.html (no build step) that renders the endpoints with a "Try it" form using fetch. ' + FILES },
    { id: 'postman', idea: 92, cat: 'api', icon: 'fa-paper-plane', label: 'Postman Collection', project: true, files: true,
        prompt: 'Generate a Postman Collection v2.1 JSON (postman_collection.json) for all API endpoints in this project, with example bodies, environment variables (baseUrl, token) and basic tests per request. ' + FILES },
    { id: 'curl', idea: 93, cat: 'api', icon: 'fa-terminal', label: 'أمثلة cURL', project: true,
        prompt: 'Write cURL examples for every API endpoint in this project (method, headers, JSON body, expected response), grouped by resource, with Arabic one-line descriptions.' },
    { id: 'sdk', idea: 94, cat: 'api', icon: 'fa-box-open', label: 'SDK بثلاث لغات', project: true, files: true, max: 12000, fields: [inp('langs', 'اللغات', 'TypeScript, Python, Go', 'TypeScript, Python, Go')],
        prompt: 'Generate typed client SDKs for this project\'s API in: {{langs}}. Each SDK: a client class, typed models, auth header support, error type, retries with backoff, and a usage example in its README. ' + FILES },
    { id: 'webhooks', idea: 95, cat: 'api', icon: 'fa-bolt', label: 'معالجات Webhooks', files: true, fields: [inp('provider', 'المزود/الحدث', 'GitHub push, Stripe payment_intent.succeeded'), stack()],
        prompt: 'Generate webhook handlers for {{provider}} using {{stack}}: signature verification, idempotency (event id store), retries/acknowledgement, typed payloads, and tests with sample payloads. ' + FILES },
    { id: 'trpc', idea: 100, cat: 'api', icon: 'fa-route', label: 'tRPC Routers', project: true, files: true, fields: [txt('procs', 'الإجراءات', 'users.list, users.byId, posts.create', 3)],
        prompt: 'Generate tRPC v11 routers with zod input validation for: {{procs}} (infer models from the project), plus the React client setup with @tanstack/react-query. ' + FILES },
    { id: 'grpc', idea: 99, cat: 'api', icon: 'fa-network-wired', label: 'خدمات gRPC', files: true, fields: [txt('service', 'الخدمة', 'UserService: GetUser, ListUsers (stream), CreateUser', 3), sel('lang', 'اللغة', ['Go', 'Node.js (TypeScript)', 'Python', 'Java', 'Rust'])],
        prompt: 'Generate a gRPC service: the .proto file for {{service}}, a {{lang}} server implementation, a client example, and build/codegen commands. ' + FILES },
    { id: 'websocket', idea: 98, cat: 'api', icon: 'fa-tower-broadcast', label: 'معالجات WebSocket', files: true, fields: [inp('use', 'الاستخدام', 'غرف دردشة مع حالة الاتصال'), stack('Node.js + ws + TypeScript')],
        prompt: 'Generate WebSocket handlers for "{{use}}" using {{stack}}: connection auth, rooms/channels, message schema validation, heartbeat/ping, reconnection on the client, broadcast, and graceful shutdown. ' + FILES },
    // ---------------------------------------------------------------- backend systems
    { id: 'serverless', idea: 55, cat: 'backend', icon: 'fa-cloud-bolt', label: 'كود Serverless', files: true, fields: [txt('fn', 'الوظيفة', 'API يحول صورة إلى مصغرة ويخزنها', 3), sel('platform', 'المنصة', ['Vercel Functions', 'Netlify Functions', 'AWS Lambda (SAM)', 'Cloudflare Workers', 'Google Cloud Functions', 'Supabase Edge Functions'])],
        prompt: 'Implement "{{fn}}" as {{platform}} function(s): handler code, config/manifest, env vars, local dev instructions, and a test. Mind cold starts and timeouts. ' + FILES },
    { id: 'cron', idea: 96, cat: 'backend', icon: 'fa-clock', label: 'مهام Cron مجدولة', files: true, fields: [txt('jobs', 'المهام', 'تنظيف الجلسات كل ساعة، تقرير يومي 8 صباحاً', 3), stack('Node.js + node-cron')],
        prompt: 'Generate scheduled jobs ({{jobs}}) with {{stack}}: cron expressions explained in Arabic, locking to avoid overlap, logging, retries, and also the equivalent GitHub Actions schedule / Vercel cron config. ' + FILES },
    { id: 'queue', idea: 97, cat: 'backend', icon: 'fa-list-ol', label: 'Queue Workers', files: true, fields: [inp('jobs', 'المهام', 'إرسال بريد، معالجة صور'), sel('lib', 'المكتبة', ['BullMQ (Redis)', 'Celery (Python)', 'RabbitMQ (amqplib)', 'AWS SQS', 'Sidekiq'])],
        prompt: 'Generate queue producers and workers for {{jobs}} using {{lib}}: job schemas, concurrency, retries with exponential backoff, dead-letter handling, progress, graceful shutdown, and a docker-compose for the broker. ' + FILES },
    { id: 'rate-limit', idea: 109, cat: 'backend', icon: 'fa-gauge', label: 'Rate Limiter', files: true, fields: [sel('algo', 'الخوارزمية', ['Token bucket', 'Sliding window', 'Fixed window', 'Leaky bucket']), stack('Express + Redis')],
        prompt: 'Implement a {{algo}} rate limiter for {{stack}} as reusable middleware: per-IP and per-user keys, Redis-backed with an in-memory fallback, standard RateLimit headers, 429 responses, and unit tests. ' + FILES },
    { id: 'caching', idea: 110, cat: 'backend', icon: 'fa-bolt-lightning', label: 'استراتيجية تخزين مؤقت', project: true, fields: [inp('hot', 'البيانات الساخنة', 'قائمة المنتجات، ملفات المستخدمين')],
        prompt: 'Design a caching strategy for this project ({{hot}}): what to cache at each layer (HTTP/CDN, app/Redis, DB), keys, TTLs, invalidation, stampede protection, and code for the main pieces. Arabic explanation.' },
    { id: 'comments-sys', idea: 122, cat: 'backend', icon: 'fa-comments', label: 'نظام تعليقات', files: true, fields: [stack('Next.js + Prisma')], prompt: 'Build a threaded comments system with {{stack}}: schema, API (create/edit/delete/reply/like), pagination, moderation flags, optimistic UI component. ' + FILES },
    { id: 'notify-sys', idea: 123, cat: 'backend', icon: 'fa-bell', label: 'نظام إشعارات', files: true, fields: [stack('Node.js + PostgreSQL')], prompt: 'Build a notification system with {{stack}}: notifications table, preferences, in-app feed API with unread counts, real-time delivery (SSE or WebSocket), email digest job, and a bell UI component. ' + FILES },
    { id: 'payments', idea: 126, cat: 'backend', icon: 'fa-credit-card', label: 'نظام اشتراكات ومدفوعات', files: true, fields: [sel('provider', 'المزود', ['Stripe', 'Paddle', 'Lemon Squeezy', 'PayPal']), stack('Next.js + Prisma')], prompt: 'Build a subscription billing system with {{provider}} and {{stack}}: plans, checkout session, customer portal, webhook handling (subscription lifecycle), entitlement checks, and a pricing page. ' + FILES },
    { id: 'search-sys', idea: 127, cat: 'backend', icon: 'fa-magnifying-glass', label: 'نظام بحث متقدم', files: true, fields: [sel('engine', 'المحرك', ['PostgreSQL full-text', 'Meilisearch', 'Typesense', 'Elasticsearch', 'MiniSearch (عميل)']), stack('Node.js')], prompt: 'Build an advanced search system using {{engine}} with {{stack}}: indexing, Arabic-aware normalization, typo tolerance, filters/facets, highlighting, pagination, and a search UI with debounce. ' + FILES },
    { id: 'upload-sys', idea: 128, cat: 'backend', icon: 'fa-cloud-arrow-up', label: 'نظام رفع ملفات', files: true, fields: [sel('storage', 'التخزين', ['S3 (presigned URLs)', 'Cloudflare R2', 'Supabase Storage', 'محلي']), stack('Express')], prompt: 'Build a file upload system ({{storage}}, {{stack}}): direct-to-storage presigned uploads, size/type validation, progress UI with drag & drop, resumable/chunked option, thumbnails for images, and metadata in DB. ' + FILES },
    { id: 'chat-sys', idea: 129, cat: 'backend', icon: 'fa-message', label: 'نظام دردشة حية', files: true, fields: [stack('Node.js + Socket.IO + React')], prompt: 'Build a live chat system with {{stack}}: rooms, typing indicators, read receipts, message history pagination, presence, and reconnect handling. ' + FILES },
    { id: 'analytics-sys', idea: 130, cat: 'backend', icon: 'fa-chart-pie', label: 'نظام إحصائيات', files: true, fields: [stack('Node.js + PostgreSQL')], prompt: 'Build a privacy-friendly analytics system with {{stack}}: tiny tracking script (page views, events), ingestion endpoint, aggregation queries (daily uniques, top pages, referrers), and a dashboard page with charts. ' + FILES },
    // ---------------------------------------------------------------- devops
    { id: 'cicd', idea: 101, cat: 'devops', icon: 'fa-gears', label: 'خط CI/CD مؤتمت', project: true, files: true, fields: [sel('ci', 'المنصة', ['GitHub Actions', 'GitLab CI', 'CircleCI', 'Azure Pipelines']), inp('deploy', 'النشر إلى', 'Vercel / Docker Hub / AWS')],
        prompt: 'Generate a {{ci}} pipeline for this project (detect stack from files): install with cache, lint, test, build, artifact, and deploy to {{deploy}} on main with environment protection. ' + FILES },
    { id: 'k8s', idea: 104, cat: 'devops', icon: 'fa-dharmachakra', label: 'Kubernetes Manifests', project: true, files: true, fields: [inp('app', 'التطبيق', 'web + api + postgres')],
        prompt: 'Generate Kubernetes manifests for {{app}}: Deployments (resources, probes), Services, Ingress, ConfigMap, Secret template, HPA, PodDisruptionBudget, and kustomization.yaml. ' + FILES },
    { id: 'terraform', idea: 105, cat: 'devops', icon: 'fa-cubes', label: 'Terraform IaC', files: true, fields: [inp('infra', 'البنية', 'VPC + RDS Postgres + ECS Fargate + S3'), sel('cloud', 'السحابة', ['AWS', 'Google Cloud', 'Azure', 'DigitalOcean', 'Cloudflare'])],
        prompt: 'Write Terraform for {{infra}} on {{cloud}}: modules, variables with descriptions, outputs, remote state backend, and tagging. ' + FILES },
    { id: 'helm', idea: 106, cat: 'devops', icon: 'fa-ship', label: 'Helm Chart', project: true, files: true, prompt: 'Create a Helm chart for this project: Chart.yaml, values.yaml (documented), templates for deployment/service/ingress/hpa/configmap, _helpers.tpl, and NOTES.txt. ' + FILES },
    { id: 'nginx', idea: 107, cat: 'devops', icon: 'fa-server', label: 'إعداد Nginx', files: true, fields: [inp('setup', 'الإعداد', 'SPA + proxy /api إلى :3000 + HTTPS')],
        prompt: 'Write an nginx config for: {{setup}}. Include gzip/brotli, caching headers for hashed assets, SPA fallback, reverse proxy with websockets, HTTP→HTTPS redirect and comments in Arabic. ' + FILES },
    { id: 'envoy', idea: 108, cat: 'devops', icon: 'fa-route', label: 'إعداد Envoy', files: true, fields: [inp('setup', 'الإعداد', 'بوابة لخدمتين مع retries و rate limit')],
        prompt: 'Write an Envoy (v3 API) config for: {{setup}}. Include listeners, routes, clusters with health checks, retries, timeouts and admin interface. ' + FILES },
    // ---------------------------------------------------------------- frontend
    { id: 'i18n', idea: 111, cat: 'frontend', icon: 'fa-language', label: 'ترجمة الواجهة i18n لعشر لغات', project: true, files: true, max: 12000, fields: [inp('langs', 'اللغات', 'ar,en,fr,es,de,tr,ur,fa,id,zh', 'ar,en,fr,es,de,tr,ur,fa,id,zh')],
        prompt: 'Internationalise this project: extract user-facing strings into locales/<lang>.json for {{langs}}, add a tiny i18n helper (or the framework\'s standard lib), language switcher, RTL handling for ar/ur/fa, and replace hard-coded strings in the main files. ' + FILES },
    { id: 'image-code', idea: 38, cat: 'frontend', icon: 'fa-image', label: 'صورة تصميم ← HTML/CSS', tool: 'openVisionTool', arg: 'image' },
    { id: 'video-code', idea: 39, cat: 'frontend', icon: 'fa-film', label: 'فيديو شرح ← كود', tool: 'openVisionTool', arg: 'video' },
    { id: 'rtl', idea: 112, cat: 'frontend', icon: 'fa-arrow-right-arrow-left', label: 'دعم RTL/LTR تلقائي', code: true, prompt: 'Convert this CSS/markup to be direction-agnostic: logical properties (margin-inline-start, inset-inline…), dir="auto" where needed, mirrored icons, and a :dir()/[dir] based switch. Return the full updated code and an Arabic checklist.' },
    { id: 'palette', idea: 113, cat: 'frontend', icon: 'fa-palette', label: 'ثيمات ألوان متناسقة', tool: 'openPaletteGenerator' },
    { id: 'svg-icons', idea: 114, cat: 'frontend', icon: 'fa-icons', label: 'توليد أيقونات SVG', files: true, fields: [inp('icons', 'الأيقونات', 'بيت، إعدادات، سلة تسوق'), sel('style', 'النمط', ['Outline 24px stroke 2', 'Filled', 'Duotone'])],
        prompt: 'Design SVG icons for: {{icons}}. Style: {{style}}, 24x24 viewBox, currentColor, optimized paths, accessible (<title>). Output each icon as a separate .svg file under icons/. ' + FILES },
    { id: 'chartjs', idea: 115, cat: 'frontend', icon: 'fa-chart-column', label: 'رسوم بيانية Chart.js', files: true, fields: [txt('data', 'البيانات/الفكرة', 'مبيعات شهرية لثلاثة منتجات خلال 2025', 3)],
        prompt: 'Create a self-contained chart page (charts.html, Chart.js from CDN) for: {{data}}. Pick the best chart types, responsive, RTL-friendly labels, tooltips, and dark-mode friendly colors. ' + FILES },
    { id: 'maps', idea: 116, cat: 'frontend', icon: 'fa-map-location-dot', label: 'خرائط تفاعلية', files: true, fields: [txt('idea', 'الفكرة', 'خريطة فروع متجر في تونس مع بحث وتجميع', 3)],
        prompt: 'Create a self-contained interactive map page (map.html, Leaflet + OpenStreetMap from CDN) for: {{idea}}. Markers from a JSON array, clustering, popups, search, fit bounds, and locate-me. ' + FILES },
    { id: 'tables', idea: 117, cat: 'frontend', icon: 'fa-table', label: 'جداول بيانات متقدمة', files: true, fields: [txt('cols', 'الأعمدة', 'الاسم، البريد، الحالة، تاريخ التسجيل', 2), sel('fw', 'الإطار', ['Vanilla JS', 'React + TanStack Table', 'Vue 3'])],
        prompt: 'Build an advanced data table ({{fw}}) with columns: {{cols}} — sorting, filtering, global search, pagination, column visibility, row selection, CSV export, sticky header, RTL support. ' + FILES },
    { id: 'forms', idea: 118, cat: 'frontend', icon: 'fa-rectangle-list', label: 'نماذج مع تحقق Validation', files: true, fields: [txt('fields', 'الحقول', 'الاسم، البريد، كلمة المرور وتأكيدها، الهاتف التونسي', 3), sel('fw', 'الإطار', ['Vanilla JS', 'React Hook Form + zod', 'Vue + VeeValidate', 'Svelte'])],
        prompt: 'Build a form ({{fw}}) with fields: {{fields}} — schema validation, inline Arabic error messages, accessible labels/aria-describedby, async field validation example, and submit state. ' + FILES },
    { id: 'wizard', idea: 119, cat: 'frontend', icon: 'fa-shoe-prints', label: 'معالج متعدد الخطوات Wizard', files: true, fields: [txt('steps', 'الخطوات', 'بيانات شخصية ← العنوان ← الدفع ← المراجعة', 2), sel('fw', 'الإطار', ['Vanilla JS', 'React', 'Vue 3'])],
        prompt: 'Build a multi-step wizard ({{fw}}): {{steps}} — progress indicator, per-step validation, back/next, save draft to localStorage, review step, keyboard accessible. ' + FILES },
    { id: 'dashboard', idea: 120, cat: 'frontend', icon: 'fa-gauge-high', label: 'لوحة تحكم كاملة', files: true, max: 12000, fields: [txt('domain', 'المجال', 'متجر إلكتروني: مبيعات، طلبات، عملاء', 2), sel('fw', 'الإطار', ['HTML + Tailwind CDN + Chart.js', 'React + Vite', 'Vue 3'])],
        prompt: 'Build a complete admin dashboard for {{domain}} ({{fw}}): sidebar navigation, KPI cards, charts, recent activity table, filters, responsive + RTL, dark mode. Use mock data. ' + FILES },
    { id: 'chatbot', idea: 121, cat: 'frontend', icon: 'fa-robot', label: 'روبوت دردشة مخصص', files: true, fields: [txt('bot', 'وصف الروبوت', 'مساعد خدمة عملاء لمطعم يجيب من قائمة الطعام', 3)],
        prompt: 'Build an embeddable custom chatbot for: {{bot}} — a widget (chat bubble + panel) in vanilla JS, a small server endpoint that calls OpenRouter with a system prompt and a knowledge JSON, streaming responses, and rate limiting. Keep the API key server-side. ' + FILES },
    // ---------------------------------------------------------------- dependencies
    { id: 'bundle-size', idea: 59, cat: 'deps', icon: 'fa-weight-hanging', label: 'تحسين حزم NPM وتقليل الحجم', project: true, local: 'deps',
        prompt: 'Reduce this project\'s bundle size: analyse package.json and imports (local findings attached), suggest lighter alternatives, tree-shaking-friendly imports, code-splitting/lazy loading points, and build config changes. Give concrete diffs and estimated savings (Arabic).' },
    { id: 'unused-deps', idea: 60, cat: 'deps', icon: 'fa-broom', label: 'إزالة الاعتماديات غير المستخدمة', tool: 'openDependencyDoctor' },
    { id: 'update-deps', idea: 88, cat: 'deps', icon: 'fa-arrows-rotate', label: 'تحديث الاعتماديات تلقائياً', tool: 'openDependencyDoctor' },
    { id: 'alternatives', idea: 90, cat: 'deps', icon: 'fa-shuffle', label: 'بدائل أحدث للمكتبات', project: true, local: 'deps',
        prompt: 'For each dependency of this project, say whether a more modern, maintained or lighter alternative exists (local suggestions attached), with migration effort (low/medium/high) and a migration example for the top 3. Arabic.' },
    // ---------------------------------------------------------------- career
    { id: 'cv', idea: 72, cat: 'career', icon: 'fa-id-card', label: 'سيرة ذاتية من مشاريعك', tool: 'aiCareerDoc', arg: 'cv' },
    { id: 'portfolio', idea: 73, cat: 'career', icon: 'fa-briefcase', label: 'Portfolio تلقائي', tool: 'aiCareerDoc', arg: 'portfolio' },
    { id: 'side-project', idea: 74, cat: 'career', icon: 'fa-lightbulb', label: 'مشروع جانبي حسب مهاراتك', tool: 'aiCareerDoc', arg: 'side' },
    { id: 'market', idea: 75, cat: 'career', icon: 'fa-chart-line', label: 'تحليل سوق العمل واقتراح تقنيات', tool: 'aiCareerDoc', arg: 'market' },
    { id: 'plan', idea: 76, cat: 'career', icon: 'fa-road', label: 'خطة تعلم مخصصة', tool: 'aiCareerDoc', arg: 'plan' },
    { id: 'interview-q', idea: 77, cat: 'career', icon: 'fa-circle-question', label: 'أسئلة مقابلة حسب مستواك', tool: 'aiCareerDoc', arg: 'questions' },
    { id: 'job', idea: 80, cat: 'career', icon: 'fa-magnifying-glass-dollar', label: 'مساعد البحث عن وظيفة', tool: 'aiCareerDoc', arg: 'job' }
];

export function installGenerators(P) {
    P.AI_GENERATORS = GENERATORS;
    P.AI_CATEGORIES = CATEGORIES;
    P.findGenerator = function (id) { return GENERATORS.find(g => g.id === id) || null; };

    /** Local analyzer output as text for prompts + HTML for the UI. */
    P.aiLocalFindings = function (kind, code, path = '') {
        if (kind === 'patterns') { const r = A.detectPatterns(code); return { data: r, text: `Patterns: ${r.patterns.map(p => p.name).join(', ') || 'none'}\nSmells: ${r.smells.map(s => s.name).join('; ') || 'none'}` }; }
        if (kind === 'naming') { const r = A.namingIssues(code, path); return { data: r, text: r.map(n => `line ${n.line}: ${n.name} — ${n.issue} → ${n.hint}`).join('\n') || 'no naming issues found locally' }; }
        if (kind === 'nplus1') { const r = A.detectNPlusOne(code); return { data: r, text: r.map(n => `line ${n.line}: ${n.code}`).join('\n') || 'no N+1 found locally' }; }
        if (kind === 'complexity') { const r = A.estimateComplexity(code); return { data: r, text: `Local estimate: time ${r.time}, space ${r.space}, loop depth ${r.loopDepth}. ${r.notes.join('. ')}` }; }
        if (kind === 'leaks') { const r = A.detectLeaks(code); return { data: r, text: r.map(n => `line ${n.line}: ${n.message}`).join('\n') || 'no leaks found locally' }; }
        if (kind === 'legacy') { const r = A.legacyFindings(code); return { data: r, text: r.map(n => `${n.id} ×${n.count} (line ${n.line}): ${n.hint}`).join('\n') || 'no legacy patterns found locally' }; }
        if (kind === 'deps') {
            const u = A.unusedDependencies(this.virtualProjectFiles);
            const alt = this.virtualProjectFiles.get('package.json') ? A.dependencyAdvice(this.virtualProjectFiles.get('package.json').content) : [];
            return { data: { unused: u, alt }, text: `Unused: ${(u.unused || []).map(d => d.name).join(', ') || 'none'}\nAlternatives: ${alt.map(a => `${a.name} → ${a.alt}`).join('; ') || 'none'}` };
        }
        return { data: null, text: '' };
    };
    P.localFindingsHTML = function (kind, data) {
        if (!data) return '';
        const row = (l, msg, extra = '') => `<div class="ai-finding"><span class="ai-line">${l ? 'س' + l : ''}</span><span>${msg}</span>${extra}</div>`;
        if (kind === 'complexity') return `<div class="ai-kpis"><div><small>الوقت</small><b dir="ltr">${esc(data.time)}</b></div><div><small>الذاكرة</small><b dir="ltr">${esc(data.space)}</b></div><div><small>عمق الحلقات</small><b>${data.loopDepth}</b></div></div>${data.notes.map(n => row('', esc(n))).join('')}`;
        if (kind === 'patterns') return `${data.patterns.map(p => row('', `🧩 <b>${esc(p.name)}</b> — ${esc(p.note)}`)).join('')}${data.smells.map(s => row('', `⚠️ <b>${esc(s.name)}</b> — ${esc(s.note)}`)).join('')}` || row('', 'لا أنماط واضحة');
        if (kind === 'naming') return data.map(n => row(n.line, `<code>${esc(n.name)}</code> — ${esc(n.issue)} ← <code>${esc(n.hint)}</code>`)).join('') || row('', '✅ الأسماء تبدو جيدة');
        if (kind === 'legacy') return data.map(n => row(n.line, `${esc(n.hint)} <small>×${n.count}</small>`)).join('') || row('', '✅ لا أنماط قديمة');
        if (kind === 'deps') return `${(data.unused.unused || []).map(d => row('', `📦 <code>${esc(d.name)}</code> غير مستخدمة${d.dev ? ' (dev)' : ''}`)).join('')}${data.alt.map(a => row('', `🔁 <code>${esc(a.name)}</code> ← ${esc(a.alt)} — ${esc(a.why)}`)).join('')}` || row('', data.unused.error ? esc(data.unused.error) : '✅ لا ملاحظات');
        return (data || []).map(n => row(n.line, esc(n.message || n.code))).join('') || row('', '✅ لا مشاكل محلياً');
    };

    /** Build the final prompt for a generator (pure given app state) → { prompt, system, missing }. */
    P.buildGeneratorPrompt = function (gen, values = {}) {
        const v = {};
        (gen.fields || []).forEach(f => { if (f.value != null && f.value !== '') v[f.id] = f.value; });
        Object.assign(v, values);
        if (gen.id === 'diff-summary' && !String(v.diff || '').trim() && this.projectDiffText) v.diff = this.projectDiffText();
        const { text, missing } = fillTemplate(gen.prompt, v);
        const optional = (gen.fields || []).filter(f => /اختياري|فارغاً/.test(f.label)).map(f => f.id);
        const req = missing.filter(m => !optional.includes(m));
        if (gen.id === 'diff-summary' && !String(v.diff || '').trim()) req.push('diff');
        let prompt = text;
        let code = null;
        if (gen.code) {
            code = v.__code != null ? { code: v.__code, path: v.__path || '' } : this.aiCodeInput();
            if (!code.code) req.push('code');
            else prompt += `\n\nCode${code.path ? ` (${code.path})` : ''}:\n\`\`\`\n${code.code.slice(0, 24000)}\n\`\`\``;
        }
        if (gen.local) {
            const f = this.aiLocalFindings(gen.local, code ? code.code : '', code ? code.path : '');
            if (f.text) prompt += `\n\nLocal static analysis (already computed in the browser):\n${f.text}`;
        }
        if (gen.project) { const ctx = this.aiProjectContext({ maxChars: 12000 }); if (ctx) prompt += `\n\n${ctx}`; }
        const std = this.getAISettings().standards && this.standardsPromptText ? this.standardsPromptText() : '';
        const system = 'You are OX-Alpha, an expert senior engineer. Write prose in Arabic (Modern Standard), keep code, identifiers and code comments in English unless asked otherwise. Be concrete and complete.' + (gen.files ? ' ' + FILES : '') + (std ? '\n' + std : '');
        return { prompt, system, missing: req };
    };

    /** Unified diff of every file vs its oldest saved version (for #63 when no diff is pasted). */
    P.projectDiffText = function (max = 20000) {
        let out = '';
        for (const [path, f] of this.virtualProjectFiles) {
            const v = this.getFileVersions ? this.getFileVersions(path) : [];
            if (!v.length || typeof f.content !== 'string' || v[0].content === f.content || !this.diffLines) continue;
            const a = v[0].content.split('\n'), b = f.content.split('\n');
            const lines = this.diffLines(a, b).filter(o => o.t !== '=').slice(0, 300).map(o => (o.t === '-' ? '-' + a[o.a] : '+' + b[o.b]));
            out += `--- a/${path}\n+++ b/${path}\n${lines.join('\n')}\n`;
            if (out.length > max) break;
        }
        return out.slice(0, max);
    };

    P.runGenerator = async function (id, values = {}, { target } = {}) {
        const gen = this.findGenerator(id);
        if (!gen) return null;
        if (gen.tool) return this[gen.tool](gen.arg);
        const { prompt, system, missing } = this.buildGeneratorPrompt(gen, values);
        if (missing.length) { this.showToast(missing.includes('code') ? 'افتح ملفاً في المحرر أو حدّد كوداً أولاً' : 'أكمل الحقول المطلوبة', 'warning'); return null; }
        const out = target || document.getElementById('ai-gen-output');
        if (out) out.innerHTML = '<div class="ai-thinking"><i class="fa-solid fa-spinner fa-spin"></i> جاري التوليد…</div>';
        this._aiAbort = new AbortController();
        let text;
        try {
            text = await this.aiRun(prompt, {
                system, maxTokens: gen.max || (gen.files ? 9000 : 3500), kind: gen.kind || 'coding', signal: this._aiAbort.signal, source: 'generator:' + id,
                onDelta: (c) => { if (out) out.innerHTML = `<div class="ai-result gh-md markdown-body" dir="auto">${this.renderMarkdownSafe ? this.renderMarkdownSafe(c) : esc(c)}</div>`; }
            });
        } catch (e) {
            if (out) out.innerHTML = `<div class="gh-card text-red">⚠️ ${esc(e.message)}</div>`;
            return null;
        }
        if (text == null) { if (out) out.innerHTML = ''; return null; }
        this._aiOut = text;
        this._aiOutTitle = gen.label;
        this.aiLogRun(gen.id);
        if (out) out.innerHTML = this.aiResultHTML(text);
        try { if (window.hljs) out && out.querySelectorAll('pre code').forEach(b => window.hljs.highlightElement(b)); } catch (e) { /* ignore */ }
        return { text, files: parseFileBlocks(text) };
    };
    P.aiLogRun = function (id) {
        const s = this.getAISettings();
        const recent = [id, ...(s.recentGenerators || []).filter(x => x !== id)].slice(0, 8);
        this.setAISettings({ recentGenerators: recent });
    };
    P.stopAI = function () { if (this._aiAbort) this._aiAbort.abort(); };

    // ------------------------------------------------------------------ LAB PANEL
    const TABS = [['generators', 'fa-wand-magic-sparkles', 'المولدات'], ['local', 'fa-microscope', 'تحليل محلي'], ['think', 'fa-brain', 'التفكير'], ['agent', 'fa-robot', 'الوكيل'], ['memory', 'fa-database', 'الذاكرة'], ['library', 'fa-book-bookmark', 'المكتبة والشخصيات'], ['career', 'fa-user-tie', 'المسار المهني'], ['models', 'fa-microchip', 'النماذج'], ['settings', 'fa-sliders', 'الإعدادات']];
    P.openAILab = function (tab = 'generators', arg) {
        this._labTab = tab;
        this.openPanel({
            title: 'مختبر الذكاء الاصطناعي', icon: 'fa-flask',
            tabs: TABS.map(([id, icon, label]) => ({ id, icon, label, onclick: `app.openAILab('${id}')` })), activeTab: tab,
            body: '<div id="ai-lab" class="ai-lab"></div>'
        });
        const root = document.getElementById('ai-lab');
        if (!root) return false;
        const map = { generators: 'renderGeneratorsTab', local: 'renderLocalTab', think: 'renderThinkTab', agent: 'renderAgentTab', memory: 'renderMemoryTab', library: 'renderLibraryTab', career: 'renderCareerTab', models: 'renderModelsTab', settings: 'renderAISettingsTab' };
        this[map[tab] || map.generators](root, arg);
        return true;
    };
    P.renderGeneratorsTab = function (root, arg) {
        if (arg) return this.openGenerator(arg);
        const s = this.getAISettings();
        const cat = this._genCat || 'all', q = (this._genQ || '').trim().toLowerCase();
        const list = GENERATORS.filter(g => (cat === 'all' || g.cat === cat) && (!q || (g.label + ' ' + g.id + ' #' + g.idea).toLowerCase().includes(q)));
        const recent = (s.recentGenerators || []).map(id => this.findGenerator(id)).filter(Boolean);
        root.innerHTML = `<div class="ai-gen-head"><input id="ai-gen-search" class="form-input-box" placeholder="ابحث في ${GENERATORS.length} مولداً…" value="${esc(this._genQ || '')}" oninput="app._genQ=this.value; app.renderGeneratorsTab(document.getElementById('ai-lab')); const i=document.getElementById('ai-gen-search'); i.focus(); i.setSelectionRange(i.value.length,i.value.length)" aria-label="بحث في المولدات"></div>
            <div class="ai-chips">${CATEGORIES.map(([id, icon, label]) => `<button class="fx-link ${cat === id ? 'active' : ''}" onclick="app._genCat='${id}'; app.renderGeneratorsTab(document.getElementById('ai-lab'))"><i class="fa-solid ${icon}"></i> ${label}</button>`).join('')}</div>
            ${recent.length && !q && cat === 'all' ? `<div class="ai-sub">الأخيرة</div><div class="ai-grid">${recent.map(g => this.generatorCardHTML(g)).join('')}</div><div class="ai-sub">كل المولدات</div>` : ''}
            <div class="ai-grid">${list.map(g => this.generatorCardHTML(g)).join('') || '<p class="gh-muted">لا نتائج</p>'}</div>`;
    };
    P.generatorCardHTML = function (g) {
        return `<button class="ai-card" data-gen="${g.id}" onclick="app.openGenerator('${g.id}')"><i class="fa-solid ${g.icon}"></i><span>${esc(g.label)}</span><small>${g.code ? 'يعمل على الكود المحدد' : g.project ? 'يقرأ المشروع' : g.tool ? 'أداة' : 'من وصف'}${g.files ? ' • يكتب ملفات' : ''}</small></button>`;
    };
    P.openGenerator = function (id) {
        const g = this.findGenerator(id);
        const root = document.getElementById('ai-lab');
        if (!g || !root) return false;
        if (g.tool) { this[g.tool](g.arg); return true; }
        const code = g.code ? this.aiCodeInput() : null;
        const field = (f) => {
            const fid = `gen-${f.id}`;
            if (f.type === 'select') return `<label class="ai-field"><span>${esc(f.label)}</span><select id="${fid}" class="form-input-box">${f.options.map(o => `<option value="${esc(o.value)}" ${o.value === f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
            if (f.type === 'textarea') return `<label class="ai-field"><span>${esc(f.label)}</span><textarea id="${fid}" class="form-input-box" rows="${f.rows || 4}" dir="auto" placeholder="${esc(f.placeholder)}"></textarea></label>`;
            return `<label class="ai-field"><span>${esc(f.label)}</span><input id="${fid}" class="form-input-box" dir="auto" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder)}"></label>`;
        };
        const local = g.local && code && code.code ? this.aiLocalFindings(g.local, code.code, code.path) : g.local === 'deps' ? this.aiLocalFindings('deps') : null;
        root.innerHTML = `<div class="ai-gen-form" data-gen="${g.id}">
            <button class="fx-link" onclick="app.renderGeneratorsTab(document.getElementById('ai-lab'))"><i class="fa-solid fa-arrow-right"></i> كل المولدات</button>
            <h3><i class="fa-solid ${g.icon}"></i> ${esc(g.label)} <small class="gh-muted">#${g.idea}</small></h3>
            ${g.code ? `<div class="ai-src ${code.code ? '' : 'warn'}"><i class="fa-solid fa-file-code"></i> ${code.code ? `${code.scope === 'selection' ? 'التحديد في' : 'الملف'} <code>${esc(code.path || '')}</code> (${code.code.split('\n').length} سطر)` : 'افتح ملفاً في المحرر أو حدّد كوداً — أو الصقه هنا:'}</div>${code.code ? '' : '<textarea id="gen-__code" class="form-input-box" rows="6" dir="ltr" placeholder="// الصق الكود"></textarea>'}` : ''}
            ${g.project ? `<div class="ai-src"><i class="fa-solid fa-folder-tree"></i> يُرسل ملخص المشروع (${this.virtualProjectFiles.size} ملف)</div>` : ''}
            ${(g.fields || []).map(field).join('')}
            ${local ? `<details class="ai-local" open><summary><i class="fa-solid fa-microscope"></i> تحليل محلي فوري (بدون إنترنت)</summary>${this.localFindingsHTML(g.local, local.data)}</details>` : ''}
            <div class="gh-toolbar"><button class="btn-new-thread gh-btn" id="ai-gen-run" onclick="app.runGeneratorFromForm('${g.id}')"><i class="fa-solid fa-wand-magic-sparkles"></i> توليد</button><button class="sidebar-btn-util gh-btn" onclick="app.stopAI()"><i class="fa-solid fa-stop"></i> إيقاف</button></div>
            <div id="ai-gen-output" class="ai-output" aria-live="polite"></div></div>`;
        return true;
    };
    P.runGeneratorFromForm = function (id) {
        const g = this.findGenerator(id);
        const values = {};
        (g.fields || []).forEach(f => { const el = document.getElementById('gen-' + f.id); values[f.id] = el ? el.value : f.value || ''; });
        const pasted = document.getElementById('gen-__code');
        if (pasted && pasted.value.trim()) values.__code = pasted.value;
        return this.runGenerator(id, values);
    };
}
