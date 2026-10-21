# 📝 سجل التغييرات — OX-Alpha Workbench Pro

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
