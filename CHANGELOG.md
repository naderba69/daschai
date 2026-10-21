# 📝 سجل التغييرات — OX-Alpha Workbench Pro

## v2.1.0 — الدفعة 1: أدوات الإنتاجية (2026-10-21)
تنفيذ أول دفعة من `THOUSAND_IDEAS.md` (بدون أفكار الأمان، حسب الطلب).

### ✨ ميزات جديدة
- **لوحة الأوامر `Ctrl+K`** (أو `Ctrl+Shift+P`): بحث تقريبي بالعربية والإنجليزية في أكثر من 50 أمراً + المحادثات + النماذج + الثيمات. البادئات: `>` للأوامر فقط، `#` للمحادثات، `@` للنماذج
- **10 ثيمات**: Obsidian، فاتح، Dracula، Nord، Monokai، Solarized، GitHub Dark، Ocean، Sunset، تباين عالٍ + وضع تلقائي حسب النظام (`Alt+T` للتبديل بين الفاتح والداكن)
- **تبويبات المحادثات** مثل المتصفح (حتى 8، تُحفظ بين الجلسات، `Ctrl+PageUp/PageDown` للتنقل)
- **16 أمراً سريعاً بالشرطة المائلة**: `/explain /fix /test /review /refactor /optimize /docs /convert /diagram /regex /sql /commit /readme /scaffold /deploy /interview` — تُدرج الملف المفتوح في الاستوديو تلقائياً عند الحاجة
- **تحسين محرر الاستوديو**: ترقيم الأسطر، شريط الحالة (السطر/العمود/التحديد)، إزاحة بـ Tab و Shift+Tab، إغلاق تلقائي للأقواس، حفظ المسافة البادئة عند Enter، `Ctrl+/` للتعليق، `Ctrl+D` لتكرار السطر، `Ctrl+S` للحفظ، تنسيق JSON/الكود، التفاف الأسطر، تكبير الخط، تحميل الملف
- **وضع التركيز** (`Alt+Z`) و**تكبير/تصغير الواجهة** (`Ctrl+=` / `Ctrl+-` / `Ctrl+0`)
- اختصارات إضافية: `Ctrl+B` للقائمة الجانبية، `Ctrl+,` للإعدادات، `` Ctrl+` `` للاستوديو، `Alt+N` لمحادثة جديدة

### 🛠️ البنية
- وحدات الميزات في `src/features/*.js` تُدمج تلقائياً عند البناء (بلا تعديل في منطق `app.js` الأساسي)
- تحويل ألوان CSS الثابتة (60 موضعاً) إلى متغيرات حتى تعمل الثيمات على الواجهة كلها
- اختبارات `npm test` (jsdom، 32 فحصاً) تعمل في CI
- تحديث ذاكرة Service Worker إلى `ox-alpha-v2.1`

## v2.0.0 — Professional Audit & Security Hardening (2026-10-20)
### 🔴 إصلاحات حرجة
- إصلاح 7 ثغرات أمان حرجة (XSS عبر eval، Mermaid loose، CSP مفقود، OAuth وهمي)
- استبدال جميع النماذج الوهمية (gemma-4) بنماذج حقيقية مجربة على OpenRouter
- إصلاح معرفات DOM المفقودة التي كانت تسبب فشل صامت (active-repo-name-text, stt-lang-label, btn-toggle-studio, sidebar-close-btn)
- إضافة Content Security Policy و HSTS و X-Frame-Options

### ⚡ الأداء
- تحميل كسول (Lazy Load) للمكتبات الثقيلة (Pyodide 7MB, Tesseract 2MB, PDF.js) — توفير 10MB في التحميل الأولي
- فهرسة GitHub متوازية (8 طلبات متوازية) بدلاً من متسلسلة — تسريع 5x
- ضغط CSS/JS في الإنتاج (--minify) — تقليل الحجم 30%
- تحسين إعادة الرسم (throttling + requestAnimationFrame)

### 🎨 UX / A11y
- إضافة aria-label لجميع الأزرار + دعم لوحة المفاتيح (Ctrl+Enter, Ctrl+K, Esc)
- إضافة تلميحات اختصارات لوحة المفاتيح
- تحسين التركيز المرئي (focus-visible) لمعايير WCAG 2.1 AA
- إضافة PWA manifest + Service Worker + SEO + OpenGraph

### 🛠️ DevOps
- إضافة package.json + vercel.json + manifest.json + sw.js
- إعادة كتابة build.js مع معالجة أخطاء وضغط وقياس حجم
- تأمين سكربت Termux (تحقق من URL، تأكيد قبل حذف .git، نسخ احتياطي)
- إضافة CI Pipeline (.github/workflows/ci.yml)

### 📚 توثيق
- إضافة AUDIT_REPORT.md (تدقيق شامل 8 محاور)
- إضافة DEPLOYMENT.md (دليل النشر المحدث)
- تحديث README مع شارات جديدة

## v1.5.0 — Mermaid & Auto-Test (c4bfea7)
- إضافة المخططات المعمارية التفاعلية Mermaid
- إضافة محرك الاختبارات التلقائي (Auto-Test Runner)
- إضافة محاكاة QA الدائمة

## v1.0.0 — الإطلاق الأولي
- واجهة Gemini Obsidian
- تكامل OpenRouter + GitHub
- فك وتصدير ZIP
- تشغيل Python Wasm + JS
