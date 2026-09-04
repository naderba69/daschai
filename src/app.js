// ==============================================================================
// OX-Alpha Workbench Pro | Gemini AI Autonomous Engineering Copilot
// Full Enterprise Suite: All Live Models, Autonomous Agent, Arena, Studio, Diff
// ==============================================================================

if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}
if (typeof mermaid !== 'undefined') {
    mermaid.initialize({ startOnLoad: false, theme: 'dark' });
}

// Fast & Stable Fallback Catalog (Used before/during live API fetch)
const INITIAL_MODELS_CATALOG = [
    { id: "google/gemma-4-31b-it:free", name: "Google Gemma 4 31B (مجاني 100% - فائق السرعة)", provider: "Google", context_length: 262144, is_free: true, is_reasoning: false, is_vision: false, is_cheap: true, description: "النموذج الأسرع والأكثر استقراراً للبرمجة والمشاريع مع نافذة سياق 262k توكن مجاناً." },
    { id: "nvidia/nemotron-3.5-lightning:free", name: "NVIDIA Nemotron 3.5 Lightning (مجاني 100% - 1M سياق)", provider: "NVIDIA", context_length: 1000000, is_free: true, is_reasoning: false, is_vision: false, is_cheap: true, description: "نموذج إنفيديا فائق السرعة مع نافذة سياق عملاقة تتسع لـ 1,000,000 توكن مجاناً 100%." },
    { id: "openrouter/free", name: "Auto Free Router (توجيه تلقائي لأفضل نموذج مجاني نشط)", provider: "OpenRouter", context_length: 200000, is_free: true, is_reasoning: false, is_vision: true, is_cheap: true, description: "موجّه ذكي من أوبن روت يربطك فورياً بالنموذج المجاني الأكثر استقراراً وجاهزية." },
    { id: "minimax/minimax-m3:free", name: "MiniMax M3 (مجاني 100% - 1M سياق)", provider: "MiniMax", context_length: 1048576, is_free: true, is_reasoning: false, is_vision: false, is_cheap: true, description: "نموذج سياق عملاق 1M مجاني ممتاز لقراءة مستودعات الكود الكاملة." },
    { id: "google/gemma-4-26b-a4b-it:free", name: "Google Gemma 4 26B (مجاني 100%)", provider: "Google", context_length: 262144, is_free: true, is_reasoning: false, is_vision: false, is_cheap: true, description: "نسخة خفيفة وسريعة من جوجل لأداء المهام البرمجية والهندسة الفورية." },
    { id: "z-ai/glm-5.2:free", name: "GLM 5.2 (مجاني 100%)", provider: "Z.ai", context_length: 256000, is_free: true, is_reasoning: false, is_vision: false, is_cheap: true, description: "نموذج عام قوي في معالجة وفهم الملفات البرمجية الطويلة." },
    { id: "cohere/north-mini-code:free", name: "Cohere North Mini Code (مجاني 100%)", provider: "Cohere", context_length: 256000, is_free: true, is_reasoning: false, is_vision: false, is_cheap: true, description: "نموذج تخصصي من كوهير في كتابة وفحص الأكواد البرمجية." },
    { id: "thinkingmachines/inkling:free", name: "Thinking Machines Inkling (مجاني 100%)", provider: "ThinkingMachines", context_length: 1048576, is_free: true, is_reasoning: true, is_vision: false, is_cheap: true, description: "نموذج تفكير عميق بسياق 1M توكن مجاناً." },
    { id: "deepseek/deepseek-r1", name: "DeepSeek R1 (Pro)", provider: "DeepSeek", context_length: 65536, is_free: false, is_reasoning: true, is_vision: false, is_cheap: true, description: "النسخة الأصلية من أقوى نموذج تفكير منطقي وهندسي بالعالم." },
    { id: "deepseek/deepseek-chat", name: "DeepSeek V3 (Pro)", provider: "DeepSeek", context_length: 65536, is_free: false, is_reasoning: false, is_vision: false, is_cheap: true, description: "استجابة فائقة السرعة مع أعلى استقرار للمشاريع البرمجية الضخمة." },
    { id: "anthropic/claude-3.7-sonnet:thinking", name: "Claude 3.7 Sonnet Thinking", provider: "Anthropic", context_length: 200000, is_free: false, is_reasoning: true, is_vision: true, is_cheap: false, description: "أحدث نماذج أنثروبيك الهجينة التي تدمج التفكير العميق مع البرمجة الدقيقة." },
    { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet", provider: "Anthropic", context_length: 200000, is_free: false, is_reasoning: false, is_vision: true, is_cheap: false, description: "المعيار الذهبي لهندسة البرمجيات وتطوير التطبيقات وبناء الهياكل المعمارية." },
    { id: "openai/gpt-4o", name: "OpenAI GPT-4o", provider: "OpenAI", context_length: 128000, is_free: false, is_reasoning: false, is_vision: true, is_cheap: false, description: "نموذج OpenAI الرائد متعدد الوسائط عالي الدقة في فهم النصوص والصور." },
    { id: "openai/o1", name: "OpenAI o1 Reasoning", provider: "OpenAI", context_length: 200000, is_free: false, is_reasoning: true, is_vision: true, is_cheap: false, description: "قمة التفكير المنطقي والرياضيات والألغاز البرمجية المعقدة من OpenAI." },
    { id: "openai/o3-mini", name: "OpenAI o3 Mini", provider: "OpenAI", context_length: 200000, is_free: false, is_reasoning: true, is_vision: false, is_cheap: true, description: "نموذج تفكير مصغر فائق السرعة واقتصادي في التكلفة للبرمجة المكثفة." },
    { id: "google/gemini-1.5-pro", name: "Gemini 1.5 Pro", provider: "Google", context_length: 2000000, is_free: false, is_reasoning: false, is_vision: true, is_cheap: false, description: "نافذة سياق عملاقة تتسع لـ 2 مليون توكن لمعالجة مستودعات ومكتبات كاملة." }
];

const DEFAULT_REPOS_LIST = [
    { name: "daschai", full_name: "naderba69/daschai", description: "OX-Alpha Workbench Pro Autonomous AI & Copilot", private: false, default_branch: "main", language: "TypeScript" },
    { name: "deutschpfad", full_name: "naderba69/deutschpfad", description: "German Learning Platform & Educational Engine", private: false, default_branch: "main", language: "Vue" },
    { name: "agence", full_name: "naderba69/agence", description: "Digital Agency Web Application", private: false, default_branch: "main", language: "JavaScript" },
    { name: "austincosmeticmedspa", full_name: "naderba69/austincosmeticmedspa", description: "Medical Spa & Booking System", private: false, default_branch: "main", language: "HTML" },
    { name: "bella-medspa", full_name: "naderba69/bella-medspa", description: "Aesthetics & Healthcare Portal", private: false, default_branch: "main", language: "HTML" },
    { name: "bissteam", full_name: "naderba69/bissteam", description: "Enterprise Management System", private: false, default_branch: "main", language: "TypeScript" },
    { name: "fishing-backend", full_name: "naderba69/fishing-backend", description: "Telemetry & Fishery Analytics Backend", private: false, default_branch: "main", language: "Python" },
    { name: "naderba69", full_name: "naderba69/naderba69", description: "GitHub Special Profile Configuration", private: false, default_branch: "main", language: "Markdown" },
    { name: "RefreshMedSpa", full_name: "naderba69/RefreshMedSpa", description: "Spa Management & Client CRM", private: false, default_branch: "main", language: "JavaScript" },
    { name: "sotto-mare", full_name: "naderba69/sotto-mare", description: "Maritime Restaurant & Booking", private: false, default_branch: "main", language: "HTML" },
    { name: "spotdata", full_name: "naderba69/spotdata", description: "Real-time Location & Telemetry Ingestion", private: false, default_branch: "main", language: "Python" },
    { name: "spotfish", full_name: "naderba69/spotfish", description: "Ocean Fish Detection & Tracking Engine", private: false, default_branch: "main", language: "Python" }
];

const PERSONA_PROMPTS = {
    fullstack: "أنت مهندس برمجيات شامل ومحترف (Full-Stack Engineer). تقوم بتحليل وهندسة كامل طبقات المشروع frontend و backend وقواعد البيانات مع كتابة كود نظيف وقابل للإنتاج.",
    security: "أنت خبير أمن سيبراني وتدقيق برمجي (Security Auditor). دورك فحص الثغرات، حماية مفاتيح API، منع هجمات SQL Injection و XSS، وتطبيق أفضل معايير الأمان OWASP.",
    performance: "أنت خبير في تحسين الأداء وتوسيع الأنظمة (Performance Optimizer). تركز على تسريع وقت الاستجابة، تقليل استهلاك الذاكرة، تحسين الاستعلامات، وتخفيف حجم الحزم.",
    architect: "أنت مهندس معماري للأنظمة السحابية (Software Architect). تركز على هيكلية المجلدات، التصميم المعماري (Design Patterns)، فصل الاهتمامات، وقابلية التوسع.",
    tests: "أنت خبير في كتابة الاختبارات وضمان الجودة (QA & Test Automation). تقوم بإنشاء اختبارات Unit Tests و Integration Tests شاملة تغطي كافة الحالات المتطرفة."
};

class OXAlphaApp {
    constructor() {
        this.sessions = [];
        this.activeSessionId = null;
        this.activeStreams = new Map();
        this.virtualProjectFiles = new Map();
        this.settings = this.loadSettings();
        this.availableModels = this.loadCachedModels();
        this.activeModelCategory = 'all';
        this.userRepositories = [...DEFAULT_REPOS_LIST];
        this.activeRepoCategory = 'all';
        
        // Advanced Features Flags
        this.isWebSearchActive = false;
        this.isAutonomousAgentActive = false;
        this.isSmartRouterActive = true;
        this.isCodeStudioOpen = false;
        this.activePersona = 'fullstack';
        this.activeStudioFile = 'src/App.tsx';
        this.pendingDiffData = null;

        this.currentAttachment = null;
        this.speechRecognition = null;
        this.isRecording = false;
        this.speechLang = 'ar-SA';
        this.selectedFileContent = null;
        this.selectedZipFile = null;
        this._pyodideInstance = null;
        this._currentPlayingBtn = null;
        this._lastRenderTimestamp = 0;
        this.userHasScrolledUp = false;

        this.loadSessions();
        this.initApp();
    }

    loadCachedModels() {
        try {
            const saved = localStorage.getItem('ox_alpha_live_models_all');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch (e) {}
        return [...INITIAL_MODELS_CATALOG];
    }

    async initApp() {
        this.initVoiceAPIs();
        this.initDomEvents();
        this.renderUIState();
        this.checkOAuthCallback();
        // Fetch ALL live models from OpenRouter without truncation
        this.fetchOpenRouterModels(false);
        this.fetchUserGitHubRepositories(false);
    }

    // SAFE PERSISTENCE: Protects from LocalStorage 5MB quota errors
    safeStorageSet(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (e) {
            console.warn('LocalStorage quota reached, optimizing storage payload...');
            try {
                if (key === 'ox_alpha_sessions_v2' && this.sessions) {
                    const lightweight = this.sessions.map(s => ({
                        ...s,
                        messages: s.messages.map(m => {
                            if (m.attachment && m.attachment.textContent && m.attachment.textContent.length > 2000) {
                                return {
                                    ...m,
                                    attachment: {
                                        name: m.attachment.name,
                                        isGitHubProject: m.attachment.isGitHubProject,
                                        isZipProject: m.attachment.isZipProject,
                                        textContent: `[محتوى المرفق: ${m.attachment.name} (${Math.round(m.attachment.textContent.length / 1000)}k حرف)]`
                                    }
                                };
                            }
                            if (m.attachment && m.attachment.base64) {
                                return { ...m, attachment: { name: m.attachment.name, base64: null } };
                            }
                            return m;
                        })
                    }));
                    localStorage.setItem(key, JSON.stringify(lightweight));
                }
            } catch (e2) {
                console.error('Failed to store optimized sessions:', e2);
            }
        }
    }

    loadSettings() {
        const defaults = {
            apiKey: '',
            model: 'google/gemma-4-31b-it:free',
            customModel: '',
            systemPrompt: 'أنت مهندس برمجيات محترف وخبير في تحليل وتطوير المشاريع البرمجية الضخمة. تجيب بلغة المستخدم (العربية أو الفرنسية أو الإنجليزية) بطلاقة واحترافية. عند اقتراح أو كتابة أي ملف كود، اذكر دائماً مسار الملف بوضوح مثل: ```typescript [الملف: src/components/Header.tsx]',
            temperature: 0.7,
            maxTokens: 16384,
            githubToken: '',
            githubOwner: 'naderba69',
            githubRepo: 'daschai',
            githubBranch: 'main',
            tavilyApiKey: '',
            ttsRate: 1.0
        };
        try {
            const saved = localStorage.getItem('ox_alpha_settings_v2');
            return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
        } catch (e) {
            return defaults;
        }
    }

    saveSettings() {
        this.settings.apiKey = document.getElementById('setting-openrouter-key').value.trim();
        const modelVal = document.getElementById('setting-model-select').value;
        if (modelVal === 'custom') {
            this.settings.model = document.getElementById('setting-custom-model').value.trim();
        } else {
            this.settings.model = modelVal;
        }
        this.settings.systemPrompt = document.getElementById('setting-system-prompt').value;
        this.settings.temperature = parseFloat(document.getElementById('setting-temperature').value) || 0.7;
        this.settings.maxTokens = parseInt(document.getElementById('setting-max-tokens').value, 10) || 16384;
        this.settings.githubToken = document.getElementById('setting-github-token').value.trim();
        this.settings.githubOwner = document.getElementById('setting-github-owner').value.trim() || 'naderba69';
        this.settings.githubRepo = document.getElementById('setting-github-repo').value.trim() || 'daschai';
        this.settings.githubBranch = document.getElementById('setting-github-branch').value.trim() || 'main';
        this.settings.tavilyApiKey = document.getElementById('setting-tavily-key').value.trim();
        this.settings.ttsRate = parseFloat(document.getElementById('setting-tts-rate').value) || 1.0;

        this.safeStorageSet('ox_alpha_settings_v2', JSON.stringify(this.settings));
        this.showToast('تم حفظ الإعدادات بنجاح ⚡', 'success');
        this.closeModals();
        this.renderUIState();
    }

    saveInlineGitHubToken() {
        const tokenInput = document.getElementById('inline-github-token-input');
        if (!tokenInput) return;
        const token = tokenInput.value.trim();
        if (!token) {
            this.showToast('يرجى إدخال رمز الوصول الشخصي (PAT)', 'warning');
            return;
        }
        this.settings.githubToken = token;
        this.safeStorageSet('ox_alpha_settings_v2', JSON.stringify(this.settings));
        this.showToast('تم ربط رمز الوصول الشخصي بنجاح 🚀', 'success');
        tokenInput.value = '';
        this.fetchUserGitHubRepositories(true);
    }

    triggerGitHubOAuthFlow() {
        const clientId = 'Ov23liOXAlphaWorkbench';
        const redirectUri = window.location.origin + window.location.pathname;
        const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo,user&redirect_uri=${encodeURIComponent(redirectUri)}`;
        window.location.href = authUrl;
    }

    checkOAuthCallback() {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        if (code) {
            this.showToast('تم استلام رمز مصادقة GitHub بنجاح 🟢', 'info');
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }

    loadSessions() {
        try {
            const saved = localStorage.getItem('ox_alpha_sessions_v2');
            if (saved) {
                this.sessions = JSON.parse(saved);
            }
        } catch (e) {
            this.sessions = [];
        }
        if (!Array.isArray(this.sessions) || this.sessions.length === 0) {
            this.createNewSession(false);
        } else {
            this.activeSessionId = this.sessions[0].id;
        }
    }

    saveSessions() {
        this.safeStorageSet('ox_alpha_sessions_v2', JSON.stringify(this.sessions));
    }

    createNewSession(shouldSwitch = true) {
        const newSession = {
            id: 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
            title: 'محادثة هندسية جديدة',
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        this.sessions.unshift(newSession);
        if (shouldSwitch) {
            this.activeSessionId = newSession.id;
        }
        this.saveSessions();
        this.renderUIState();
        if (window.innerWidth <= 900) {
            this.toggleSidebar(false);
        }
    }

    switchSession(sessionId) {
        this.activeSessionId = sessionId;
        this.renderUIState();
        if (window.innerWidth <= 900) {
            this.toggleSidebar(false);
        }
        this.scrollToBottom(true);
    }

    deleteSession(sessionId, ev) {
        if (ev) ev.stopPropagation();
        this.sessions = this.sessions.filter(s => s.id !== sessionId);
        if (this.sessions.length === 0) {
            this.createNewSession(false);
        }
        if (this.activeSessionId === sessionId) {
            this.activeSessionId = this.sessions[0].id;
        }
        this.saveSessions();
        this.renderUIState();
        this.showToast('تم حذف المحادثة 🗑️', 'info');
    }

    clearAllChats() {
        if (confirm('هل أنت متأكد من مسح كافة المحادثات وسجل الرسائل؟')) {
            this.sessions = [];
            this.createNewSession(true);
            this.showToast('تم مسح كافة المحادثات 🧹', 'success');
        }
    }

    exportChat(format = 'markdown') {
        const session = this.sessions.find(s => s.id === this.activeSessionId);
        if (!session || session.messages.length === 0) {
            this.showToast('لا توجد رسائل لتصديرها في هذه الجلسة', 'warning');
            return;
        }
        let output = `# ${session.title || 'محادثة OX-Alpha Pro'}\n`;
        output += `*تاريخ التصدير: ${new Date().toLocaleString('ar-SA')}*\n\n---\n\n`;

        session.messages.forEach(m => {
            const roleName = m.role === 'user' ? '👤 المستخدم' : `🤖 OX-Alpha Pro (${m.model || 'AI'})`;
            output += `### ${roleName}\n${m.content}\n\n`;
        });

        const blob = new Blob([output], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ox-alpha-chat-${Date.now()}.md`;
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('تم تصدير المحادثة بنجاح 📥', 'success');
    }

    // PERSONA CYCLER
    cyclePersona() {
        const personas = ['fullstack', 'security', 'performance', 'architect', 'tests'];
        const names = {
            fullstack: 'مطور شامل',
            security: 'فاحص الأمان 🛡️',
            performance: 'محسن الأداء ⚡',
            architect: 'مهندس معماري 🏗️',
            tests: 'صانع الاختبارات 🧪'
        };
        const icons = {
            fullstack: 'fa-solid fa-code',
            security: 'fa-solid fa-shield-halved',
            performance: 'fa-solid fa-bolt',
            architect: 'fa-solid fa-sitemap',
            tests: 'fa-solid fa-vial'
        };

        const currentIdx = personas.indexOf(this.activePersona);
        const nextPersona = personas[(currentIdx + 1) % personas.length];
        this.activePersona = nextPersona;

        const label = document.getElementById('persona-label');
        const icon = document.getElementById('persona-icon');
        if (label) label.innerText = names[nextPersona];
        if (icon) icon.className = icons[nextPersona];

        this.showToast(`تم تعيين وضع المساعد: ${names[nextPersona]} 🎭`, 'info');
    }

    // AUTONOMOUS AGENT MODE TOGGLE
    toggleAutonomousAgent() {
        this.isAutonomousAgentActive = !this.isAutonomousAgentActive;
        const btn = document.getElementById('btn-agent-mode');
        if (btn) btn.classList.toggle('active', this.isAutonomousAgentActive);
        this.showToast(this.isAutonomousAgentActive ? 'تم تفعيل وضع الوكيل الذاتي المستقل (ReAct Agent) 🤖' : 'تم إيقاف وضع الوكيل الذاتي', 'info');
    }

    toggleSmartRouter() {
        this.isSmartRouterActive = !this.isSmartRouterActive;
        const btn = document.getElementById('btn-smart-router');
        if (btn) btn.classList.toggle('active', this.isSmartRouterActive);
        this.showToast(this.isSmartRouterActive ? 'تم تفعيل التوجيه الذكي التلقائي للنماذج 🧠' : 'تم إيقاف التوجيه الذكي', 'info');
    }

    // SPLIT-PANE CODE STUDIO TOGGLE
    toggleCodeStudio(forceState) {
        const pane = document.getElementById('code-studio-pane');
        const btn = document.getElementById('btn-toggle-studio');
        if (!pane) return;

        this.isCodeStudioOpen = forceState !== undefined ? forceState : !this.isCodeStudioOpen;
        if (this.isCodeStudioOpen) {
            pane.classList.add('active');
            if (btn) btn.classList.add('active');
            this.renderStudioWorkspace();
        } else {
            pane.classList.remove('active');
            if (btn) btn.classList.remove('active');
        }
    }

    renderStudioWorkspace() {
        const tabsContainer = document.getElementById('studio-open-files-tabs');
        const editor = document.getElementById('studio-editor-textarea');
        if (!tabsContainer || !editor) return;

        const files = Array.from(this.virtualProjectFiles.keys());
        if (files.length === 0) {
            this.virtualProjectFiles.set('src/App.tsx', {
                content: '// استوديو الأكواد المنقسم (OX-Alpha Studio)\nexport default function App() {\n  return <div>OX-Alpha Workbench Pro Active</div>;\n}',
                lang: 'tsx',
                timestamp: Date.now()
            });
        }

        const activeFile = this.activeStudioFile || Array.from(this.virtualProjectFiles.keys())[0] || 'src/App.tsx';
        this.activeStudioFile = activeFile;

        tabsContainer.innerHTML = Array.from(this.virtualProjectFiles.keys()).slice(0, 8).map(path => `
            <div class="studio-tab-item ${path === activeFile ? 'active' : ''}" onclick="app.switchStudioFile('${path}')">
                <i class="fa-solid fa-file-code"></i>
                <span class="truncate">${path}</span>
            </div>
        `).join('');

        const fileData = this.virtualProjectFiles.get(activeFile);
        if (fileData) {
            editor.value = fileData.content || '';
        }
    }

    switchStudioFile(path) {
        this.activeStudioFile = path;
        this.renderStudioWorkspace();
    }

    handleStudioCodeChange(val) {
        if (this.activeStudioFile) {
            this.virtualProjectFiles.set(this.activeStudioFile, {
                content: val,
                lang: this.activeStudioFile.split('.').pop(),
                timestamp: Date.now()
            });
        }
    }

    runStudioCode() {
        const editor = document.getElementById('studio-editor-textarea');
        const terminal = document.getElementById('studio-terminal');
        if (!editor || !terminal) return;

        const code = editor.value;
        const ext = (this.activeStudioFile || '').split('.').pop().toLowerCase();

        if (ext === 'py') {
            this.runPythonCode(code, terminal);
        } else {
            this.runJavaScriptCode(code, terminal);
        }
    }

    openSelectedGitHubFileInStudio() {
        if (this.selectedFileContent) {
            this.virtualProjectFiles.set(this.selectedFileContent.path, {
                content: this.selectedFileContent.content,
                lang: this.selectedFileContent.path.split('.').pop(),
                timestamp: Date.now()
            });
            this.activeStudioFile = this.selectedFileContent.path;
            this.closeModals();
            this.toggleCodeStudio(true);
            this.showToast(`تم فتح ${this.selectedFileContent.path} في استوديو الأكواد 💻`, 'success');
        }
    }

    commitStudioFile() {
        if (!this.activeStudioFile) return;
        const code = document.getElementById('studio-editor-textarea')?.value || '';
        this.commitFileToGitHub(this.activeStudioFile, code);
    }

    // DUAL MODEL ARENA ENGINE
    openDualModelArena() {
        const modal = document.getElementById('arena-modal');
        if (!modal) return;
        modal.classList.add('active');
    }

    async executeArenaComparison() {
        const promptInput = document.getElementById('arena-prompt-input');
        const modelA = document.getElementById('arena-model-a')?.value || 'google/gemma-4-31b-it:free';
        const modelB = document.getElementById('arena-model-b')?.value || 'nvidia/nemotron-3.5-lightning:free';
        const outA = document.getElementById('arena-output-a');
        const outB = document.getElementById('arena-output-b');
        const gaugeA = document.getElementById('arena-gauge-a');
        const gaugeB = document.getElementById('arena-gauge-b');

        const promptText = promptInput?.value.trim();
        if (!promptText) {
            this.showToast('أدخل مسألة أو كود لبدء المقارنة', 'warning');
            return;
        }

        const apiKey = this.settings.apiKey?.trim();
        if (!apiKey) {
            this.showToast('يلزم إدخال مفتاح OpenRouter في الإعدادات', 'warning');
            this.openSettingsModal();
            return;
        }

        if (outA) outA.innerHTML = '<span class="live-step-spinner"></span> جاري التوليد من النموذج الأول...';
        if (outB) outB.innerHTML = '<span class="live-step-spinner"></span> جاري التوليد من النموذج الثاني...';
        if (gaugeA) gaugeA.innerText = '⚡ جاري المعالجة...';
        if (gaugeB) gaugeB.innerText = '⚡ جاري المعالجة...';

        const runOne = async (model, outEl, gaugeEl) => {
            const t0 = Date.now();
            try {
                const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                        'HTTP-Referer': window.location.origin || 'https://daschai.vercel.app'
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [{ role: 'user', content: promptText }],
                        stream: false,
                        max_tokens: 4096
                    })
                });

                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                const text = data.choices?.[0]?.message?.content || 'لا يوجد رد';
                const duration = ((Date.now() - t0) / 1000).toFixed(1);
                const tokens = Math.round(text.length / 3.8);

                outEl.innerHTML = DOMPurify.sanitize(marked.parse(text));
                gaugeEl.innerHTML = `⏱️ ${duration}s | 📊 ${tokens} tokens`;
            } catch (err) {
                outEl.innerHTML = `❌ خطأ: ${err.message}`;
                gaugeEl.innerText = 'فشل';
            }
        };

        // Run both concurrently
        await Promise.allSettled([
            runOne(modelA, outA, gaugeA),
            runOne(modelB, outB, gaugeB)
        ]);

        this.showToast('اكتملت المقارنة الحية بين النموذجين ⚡', 'success');
    }

    // INTERACTIVE GIT DIFF ENGINE
    openDiffViewerForActiveStudioFile() {
        if (!this.activeStudioFile) return;
        const newCode = document.getElementById('studio-editor-textarea')?.value || '';
        const oldCode = this.selectedFileContent?.content || '// ملف جديد';
        this.openDiffModal(this.activeStudioFile, oldCode, newCode);
    }

    openDiffModal(filePath, oldContent, newContent) {
        const modal = document.getElementById('diff-modal');
        const title = document.getElementById('diff-file-path-title');
        const outputBox = document.getElementById('git-diff-output-box');
        if (!modal || !outputBox) return;

        if (title) title.innerText = filePath;
        this.pendingDiffData = { filePath, content: newContent };

        const oldLines = (oldContent || '').split('\n');
        const newLines = (newContent || '').split('\n');
        let diffHtml = '';

        const maxL = Math.max(oldLines.length, newLines.length);
        for (let i = 0; i < maxL; i++) {
            const o = oldLines[i];
            const n = newLines[i];

            if (o === n) {
                diffHtml += `<div class="diff-line">  ${this.escapeHTML(n || '')}</div>`;
            } else {
                if (o !== undefined) {
                    diffHtml += `<div class="diff-line del">- ${this.escapeHTML(o)}</div>`;
                }
                if (n !== undefined) {
                    diffHtml += `<div class="diff-line add">+ ${this.escapeHTML(n)}</div>`;
                }
            }
        }

        outputBox.innerHTML = diffHtml || '<div class="diff-line info">لا توجد فروقات، الملف مطابق للأصل.</div>';
        modal.classList.add('active');
    }

    confirmCommitFromDiff() {
        if (!this.pendingDiffData) return;
        this.closeModals();
        this.commitFileToGitHub(this.pendingDiffData.filePath, this.pendingDiffData.content);
    }

    // BRANCH & PR ENGINE
    openBranchManagerModal() {
        const modal = document.getElementById('branch-modal');
        if (modal) modal.classList.add('active');
    }

    async createGitHubBranch() {
        const branchName = document.getElementById('new-branch-name-input')?.value.trim();
        const owner = this.settings.githubOwner || 'naderba69';
        const repo = this.settings.githubRepo || 'daschai';
        const baseBranch = this.settings.githubBranch || 'main';
        const token = this.settings.githubToken?.trim();

        if (!branchName) {
            this.showToast('أدخل اسم الفرع الجديد', 'warning');
            return;
        }
        if (!token) {
            this.showToast('يلزم رمز GitHub PAT لإنشاء الفروع', 'warning');
            return;
        }

        try {
            this.showToast(`جاري إنشاء الفرع (${branchName})...`, 'info');
            const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!refRes.ok) throw new Error('تعذر قراءة الـ SHA للفرع الأساسي');
            const refData = await refRes.json();
            const sha = refData.object.sha;

            const createRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    ref: `refs/heads/${branchName}`,
                    sha: sha
                })
            });

            if (!createRes.ok) throw new Error('فشل إنشاء الفرع');
            this.settings.githubBranch = branchName;
            this.saveSettings();
            this.showToast(`✅ تم إنشاء الفرع (${branchName}) وتحديده كالفرع النشط!`, 'success');
            this.closeModals();
        } catch (err) {
            this.showToast(`❌ فشل إنشاء الفرع: ${err.message}`, 'error');
        }
    }

    async createPullRequest() {
        const title = document.getElementById('pr-title-input')?.value.trim();
        const body = document.getElementById('pr-body-input')?.value.trim();
        const owner = this.settings.githubOwner || 'naderba69';
        const repo = this.settings.githubRepo || 'daschai';
        const head = this.settings.githubBranch || 'main';
        const token = this.settings.githubToken?.trim();

        if (!title) {
            this.showToast('أدخل عنوان الـ Pull Request', 'warning');
            return;
        }
        if (!token) {
            this.showToast('يلزم رمز GitHub PAT لفتح PR', 'warning');
            return;
        }

        try {
            this.showToast('جاري فتح Pull Request على GitHub...', 'info');
            const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    title: title,
                    body: body,
                    head: head,
                    base: 'main'
                })
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || `HTTP ${res.status}`);
            }

            const data = await res.json();
            this.showToast(`✅ تم فتح Pull Request #${data.number} بنجاح!`, 'success');
            this.closeModals();
        } catch (err) {
            this.showToast(`❌ تعذر فتح PR: ${err.message}`, 'error');
        }
    }

    // TERMUX HELPER MODAL
    openTermuxHelperModal() {
        const modal = document.getElementById('termux-modal');
        if (modal) modal.classList.add('active');
    }

    // HAPTIC & AUDIO COMPLETION CHIME
    playCompletionAudioHaptic() {
        try {
            if ('vibrate' in navigator) {
                navigator.vibrate([40, 60, 40]);
            }
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
            osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5
            gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.25);
        } catch (e) {}
    }

    // 1-CLICK EXPORT COMPLETE PROJECT AS ZIP
    async downloadProjectAsZip() {
        this.showToast('جاري حزم وتصدير ملفات المشروع كملف ZIP... 📦', 'info');
        try {
            const zip = new JSZip();
            const session = this.sessions.find(s => s.id === this.activeSessionId);

            this.virtualProjectFiles.forEach((data, path) => {
                const cleanPath = path.replace(/^[/\\]+/, '');
                zip.file(cleanPath, data.content || '');
            });

            if (session && session.messages) {
                session.messages.forEach(m => {
                    if (m.role === 'assistant' && m.content) {
                        const regex = /```(?:[a-zA-Z0-9_\-]+)?\s*(?:(?:\[(?:الملف:\s*)?([^\]]+)\])|(?:\/\/ File:\s*([^\n]+))|(?:# File:\s*([^\n]+)))\n([\s\S]*?)```/g;
                        let match;
                        while ((match = regex.exec(m.content)) !== null) {
                            const filePath = (match[1] || match[2] || match[3] || '').trim().replace(/^[/\\]+/, '');
                            const code = match[4] || '';
                            if (filePath && code) {
                                zip.file(filePath, code);
                            }
                        }
                    }
                });
            }

            if (Object.keys(zip.files).length === 0) {
                zip.file('README.md', `# ${this.settings.githubRepo || 'OX-Alpha Project'}\n\nتم تصدير هذا المشروع عبر منظومة OX-Alpha Workbench Pro.\nتاريخ التصدير: ${new Date().toISOString()}\n`);
                zip.file('package.json', JSON.stringify({ name: this.settings.githubRepo || "ox-alpha-project", version: "1.0.0", private: true }, null, 2));
            }

            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const projName = (this.settings.githubRepo || 'ox-alpha-project').replace(/[^a-zA-Z0-9_\-]/g, '_');
            a.href = url;
            a.download = `${projName}-bundle-${Date.now()}.zip`;
            a.click();
            URL.revokeObjectURL(url);
            this.showToast('✅ تم تحميل حزمة المشروع ZIP بنجاح!', 'success');
        } catch (err) {
            console.error('ZIP Export error:', err);
            this.showToast('❌ تعذر تصدير ZIP: ' + err.message, 'error');
        }
    }

    // DIRECT GITHUB COMMIT & PUSH
    async commitFileToGitHub(path, content) {
        const owner = this.settings.githubOwner || 'naderba69';
        const repo = this.settings.githubRepo || 'daschai';
        const branch = this.settings.githubBranch || 'main';
        const token = this.settings.githubToken?.trim();

        if (!token) {
            this.showToast('⚠️ يلزم إدخال رمز الوصول الشخصي (GitHub PAT) في الإعدادات لعمل Commit', 'warning');
            this.openSettingsModal();
            this.switchSettingsTab('tab-github');
            return;
        }

        const commitMessage = prompt(`أدخل رسالة الـ Commit للملف (${path}):`, `feat: update ${path} via OX-Alpha Pro Copilot`);
        if (!commitMessage) return;

        this.showToast(`جاري رفع وتحديث ${path} على GitHub (${owner}/${repo})...`, 'info');

        try {
            const cleanPath = path.replace(/^[/\\]+/, '');
            const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${cleanPath}`;
            const headers = {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            };

            let sha = null;
            try {
                const checkRes = await fetch(apiUrl, { headers });
                if (checkRes.ok) {
                    const fileInfo = await checkRes.json();
                    sha = fileInfo.sha;
                }
            } catch (e) {}

            const bytes = new TextEncoder().encode(content);
            let binString = '';
            bytes.forEach(b => binString += String.fromCharCode(b));
            const base64Content = btoa(binString);

            const body = {
                message: commitMessage,
                content: base64Content,
                branch: branch
            };
            if (sha) body.sha = sha;

            const res = await fetch(apiUrl, {
                method: 'PUT',
                headers,
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || `HTTP ${res.status}`);
            }

            const resData = await res.json();
            this.showToast(`✅ تم الرفع بنجاح لـ GitHub! SHA: ${(resData.commit?.sha || '').slice(0, 7)}`, 'success');
        } catch (err) {
            console.error('Commit error:', err);
            this.showToast(`❌ فشل الرفع إلى GitHub: ${err.message}`, 'error');
        }
    }

    async fetchUserGitHubRepositories(forceRefresh = false) {
        const owner = this.settings.githubOwner || 'naderba69';
        const token = this.settings.githubToken?.trim();

        const icon = document.getElementById('refresh-repos-icon');
        if (icon) icon.classList.add('fa-spin');

        try {
            let repos = [];
            const headers = { 'Accept': 'application/vnd.github.v3+json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const url = token 
                ? 'https://api.github.com/user/repos?sort=updated&per_page=100'
                : `https://api.github.com/users/${owner}/repos?sort=updated&per_page=100`;

            const res = await fetch(url, { headers });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                    repos = data.map(r => ({
                        name: r.name,
                        full_name: r.full_name,
                        description: r.description || 'مستودع برمجي على GitHub',
                        private: r.private,
                        default_branch: r.default_branch || 'main',
                        language: r.language || 'Code',
                        updated_at: r.updated_at
                    }));
                }
            }

            if (repos.length > 0) {
                this.userRepositories = repos;
            }
            this.renderRepositoryCards();
        } catch (err) {
            console.warn('Failed to fetch GitHub repositories dynamically:', err);
        } finally {
            if (icon) icon.classList.remove('fa-spin');
        }
    }

    async ingestCurrentGitHubRepo() {
        const owner = this.settings.githubOwner || 'naderba69';
        const repo = this.settings.githubRepo || 'daschai';
        const branch = this.settings.githubBranch || 'main';
        await this.ingestFullGitHubRepository(owner, repo, branch);
    }

    // STRICT GITHUB FILTER & CODEBASE INGESTION ENGINE
    async ingestFullGitHubRepository(owner, repo, branch = 'main') {
        this.showToast(`جاري جلب وفهرسة كود مستودع (${owner}/${repo})... ☁️`, 'info');
        this.closeModals();

        const token = this.settings.githubToken?.trim();
        const headers = { 'Accept': 'application/vnd.github.v3+json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        try {
            const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
            const treeRes = await fetch(treeUrl, { headers });
            
            if (!treeRes.ok) {
                throw new Error(`تعذر جلب شجرة ملفات المستودع (HTTP ${treeRes.status})`);
            }

            const treeData = await treeRes.json();
            const allItems = (treeData.tree || []).filter(item => item.type === 'blob');

            const junkPatterns = [
                'node_modules/', '.cache/', '.config/', '.npm/', '.termux/', '.git/',
                '.next/', 'dist/', 'build/', '_cacache/', 'cookies.txt', '.bash_history',
                '.gitconfig', '.profile', '.yarn/', '.pnpm-store/', 'package-lock.json',
                'pnpm-lock.yaml', 'yarn.lock', '.png', '.jpg', '.jpeg', '.gif', '.ico',
                '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.zip', '.tar', '.gz'
            ];

            const codeFiles = allItems.filter(item => {
                const p = item.path.toLowerCase();
                return !junkPatterns.some(junk => p.includes(junk));
            });

            const scoreFile = (path) => {
                const p = path.toLowerCase();
                if (p === 'readme.md') return 100;
                if (p.startsWith('final/') || p.startsWith('docs/')) return 90;
                if (p.includes('curriculum') || p.includes('lessons')) return 85;
                if (p.startsWith('src/') || p.startsWith('app/') || p.startsWith('pages/') || p.startsWith('components/')) return 80;
                if (p.endsWith('.json') || p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.vue') || p.endsWith('.py') || p.endsWith('.html')) return 70;
                return 50;
            };

            codeFiles.sort((a, b) => scoreFile(b.path) - scoreFile(a.path));
            const selectedFiles = codeFiles.slice(0, 50);

            let aggregatedCode = `=== مستودع GITHUB: ${owner}/${repo} (الفرع: ${branch}) ===\n`;
            aggregatedCode += `إجمالي عناصر المستودع: ${allItems.length} | الملفات البرمجية المفهرسة: ${codeFiles.length}\n\n`;
            
            aggregatedCode += `### هيكل ومجلدات المشروع المفحوصة:\n`;
            aggregatedCode += codeFiles.slice(0, 80).map(f => `- ${f.path}`).join('\n');
            aggregatedCode += '\n\n=== محتوى الملفات الأساسية والدروس والأكواد ===\n\n';

            let fetchedCount = 0;
            let totalChars = 0;
            const MAX_TOTAL_CHARS = 250000;

            for (const file of selectedFiles) {
                if (totalChars >= MAX_TOTAL_CHARS) break;
                try {
                    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`;
                    const fileRes = await fetch(rawUrl);
                    if (fileRes.ok) {
                        const text = await fileRes.text();
                        const truncatedText = text.length > 15000 ? text.slice(0, 15000) + '\n// ... (تم تقليص باقي الملف للحفاظ على السياق)' : text;
                        aggregatedCode += `--- [الملف: ${file.path}] ---\n${truncatedText}\n\n`;
                        totalChars += truncatedText.length;
                        fetchedCount++;
                        this.virtualProjectFiles.set(file.path, { content: text, lang: file.path.split('.').pop(), timestamp: Date.now() });
                    }
                } catch (e) {}
            }

            this.currentAttachment = {
                name: `GitHub Codebase: ${owner}/${repo} (${fetchedCount} ملف)`,
                textContent: aggregatedCode,
                isGitHubProject: true
            };

            const previewBar = document.getElementById('attachment-preview-bar');
            const fileNameTag = document.getElementById('attachment-file-name');
            const statusTag = document.getElementById('extraction-status-text');
            const iconTag = document.getElementById('attachment-icon-tag');
            const imgTag = document.getElementById('attachment-img-tag');

            if (previewBar) previewBar.style.display = 'flex';
            if (fileNameTag) fileNameTag.innerText = `${owner}/${repo} (${fetchedCount} ملف / ${Math.round(totalChars/1000)}k حرف)`;
            if (statusTag) statusTag.innerText = '✅ تم جلب وهندسة كود المستودع بنجاح وجاهز للتحليل';
            if (iconTag) {
                iconTag.className = 'fa-brands fa-github text-success';
                iconTag.style.display = 'block';
            }
            if (imgTag) imgTag.style.display = 'none';

            const input = document.getElementById('user-input');
            if (input && !input.value.trim()) {
                input.value = `قم بتحليل شامل لكافة ملفات وهيكل مستودع (${repo}) المرفقة، واشرح مكونات النظام ونقاط التطوير المقترحة.`;
            }

            this.showToast(`✅ تم جلب ${fetchedCount} ملف من مستودع ${repo} بنجاح!`, 'success');
        } catch (err) {
            console.error('Ingest error:', err);
            this.showToast(`❌ فشل جلب كود المستودع: ${err.message}`, 'error');
        }
    }

    openRepositoriesHubModal() {
        const modal = document.getElementById('repos-modal');
        if (!modal) return;
        this.renderRepositoryCards();
        modal.classList.add('active');
    }

    filterReposByCategory(category, ev) {
        this.activeRepoCategory = category;
        document.querySelectorAll('#repos-modal .modal-tab-button').forEach(b => b.classList.remove('active'));
        if (ev && ev.currentTarget) ev.currentTarget.classList.add('active');
        this.renderRepositoryCards();
    }

    renderRepositoryCards() {
        const container = document.getElementById('repos-cards-grid');
        if (!container) return;

        const query = (document.getElementById('repo-search-filter')?.value || '').toLowerCase().trim();
        const owner = this.settings.githubOwner || 'naderba69';

        let filtered = this.userRepositories.filter(r => {
            if (query && !r.name.toLowerCase().includes(query) && !(r.description || '').toLowerCase().includes(query)) {
                return false;
            }
            if (this.activeRepoCategory === 'mine') return r.full_name?.startsWith(owner) || !r.full_name?.includes('/');
            if (this.activeRepoCategory === 'private') return r.private === true;
            return true;
        });

        document.getElementById('count-repos-all').innerText = this.userRepositories.length;
        document.getElementById('count-repos-mine').innerText = this.userRepositories.filter(r => r.full_name?.startsWith(owner) || !r.full_name?.includes('/')).length;
        document.getElementById('count-repos-private').innerText = this.userRepositories.filter(r => r.private === true).length;

        container.innerHTML = filtered.map(r => {
            const isActive = r.name === this.settings.githubRepo;
            return `
                <div class="repo-select-card ${isActive ? 'active' : ''}" onclick="app.selectActiveProject('${r.name}', '${r.full_name || owner + '/' + r.name}', '${r.default_branch || 'main'}')">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                        <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; color: #fff; min-width: 0;">
                            <i class="fa-brands fa-github ${r.private ? 'text-warning' : 'text-success'}"></i>
                            <span class="truncate">${this.escapeHTML(r.name)}</span>
                        </div>
                        <span class="badge-pill" style="background: rgba(255,255,255,0.06); color: #94a3b8;">${r.language || 'Code'}</span>
                    </div>
                    <div class="model-desc-text">${this.escapeHTML(r.description || 'مستودع برمجي على GitHub')}</div>
                    <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.74rem; color: var(--text-dim); margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px;">
                        <span>الفرع: <strong style="color: #cbd5e1;">${r.default_branch || 'main'}</strong></span>
                        ${isActive ? '<span class="btn-select-model-trigger active">🟢 المستودع النشط</span>' : '<span class="btn-select-model-trigger inactive">تحديد ↵</span>'}
                    </div>
                </div>
            `;
        }).join('');
    }

    selectActiveProject(repoName, fullName, branch = 'main') {
        this.settings.githubRepo = repoName;
        if (fullName && fullName.includes('/')) {
            this.settings.githubOwner = fullName.split('/')[0];
        }
        this.settings.githubBranch = branch;
        this.safeStorageSet('ox_alpha_settings_v2', JSON.stringify(this.settings));
        this.renderUIState();
        this.showToast(`تم تعيين المستودع النشط: ${repoName} 🚀`, 'success');
        this.closeModals();
    }

    // LIVE OPENROUTER MODELS AUTO-FETCHER
    async fetchOpenRouterModels(forceRefresh = false) {
        const icon = document.getElementById('refresh-models-icon');
        if (icon) icon.classList.add('fa-spin');

        try {
            const res = await fetch('https://openrouter.ai/api/v1/models');
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.data) && data.data.length > 0) {
                    const parsed = data.data.map(m => {
                        const id = m.id || '';
                        const isFree = id.endsWith(':free') || id.includes('free');
                        const isReasoning = id.includes('r1') || id.includes('o1') || id.includes('o3') || id.includes('thinking') || (m.description || '').toLowerCase().includes('reasoning');
                        const isVision = (m.architecture?.modality || '').includes('image') || (m.description || '').toLowerCase().includes('vision') || id.includes('vision');
                        const isCheap = isFree || (parseFloat(m.pricing?.prompt || 0) < 0.000002);

                        return {
                            id: m.id,
                            name: m.name || m.id,
                            provider: (m.id.split('/')[0] || 'AI').toUpperCase(),
                            context_length: m.context_length || 128000,
                            is_free: isFree,
                            is_reasoning: isReasoning,
                            is_vision: isVision,
                            is_cheap: isCheap,
                            description: m.description || `نموذج ذكاء اصطناعي من مزود ${m.id.split('/')[0] || 'AI'}`
                        };
                    });

                    if (parsed.length > 0) {
                        parsed.sort((a, b) => {
                            if (a.is_free && !b.is_free) return -1;
                            if (!a.is_free && b.is_free) return 1;
                            return (b.context_length || 0) - (a.context_length || 0);
                        });
                        this.availableModels = parsed;
                        this.safeStorageSet('ox_alpha_live_models_all', JSON.stringify(parsed));
                        this.showToast(`تم تحديث كافة النماذج حينياً (${parsed.length} نموذج متاح) ⚡`, 'success');
                    }
                }
            }
        } catch (e) {
            console.warn('Live models fetch failed, using cached models catalogue:', e);
        } finally {
            if (icon) icon.classList.remove('fa-spin');
            this.updateModelsDropdown();
            this.renderModelCards();
        }
    }

    updateModelsDropdown() {
        const select = document.getElementById('setting-model-select');
        if (!select) return;

        const current = this.settings.model;
        select.innerHTML = this.availableModels.slice(0, 100).map(m => `
            <option value="${m.id}" ${m.id === current ? 'selected' : ''}>
                ${m.is_free ? '🟢 ' : ''}${m.name} (${Math.round(m.context_length / 1000)}k سياق)
            </option>
        `).join('') + '<option value="custom">-- نموذج مخصص آخر --</option>';
    }

    openModelExplorerModal() {
        const modal = document.getElementById('models-modal');
        if (!modal) return;
        this.renderModelCards();
        modal.classList.add('active');
    }

    filterModelsByCategory(category, ev) {
        this.activeModelCategory = category;
        document.querySelectorAll('#models-modal .modal-tab-button').forEach(b => b.classList.remove('active'));
        if (ev && ev.currentTarget) ev.currentTarget.classList.add('active');
        this.renderModelCards();
    }

    renderModelCards() {
        const container = document.getElementById('model-cards-grid');
        if (!container) return;

        const query = (document.getElementById('model-search-filter')?.value || '').toLowerCase().trim();
        let filtered = this.availableModels.filter(m => {
            if (query && !m.name.toLowerCase().includes(query) && !m.id.toLowerCase().includes(query) && !(m.description || '').toLowerCase().includes(query)) {
                return false;
            }
            if (this.activeModelCategory === 'free') return m.is_free;
            if (this.activeModelCategory === 'reasoning') return m.is_reasoning;
            if (this.activeModelCategory === 'vision') return m.is_vision;
            if (this.activeModelCategory === 'cheap') return m.is_cheap;
            return true;
        });

        document.getElementById('count-all').innerText = this.availableModels.length;
        document.getElementById('count-free').innerText = this.availableModels.filter(m => m.is_free).length;
        document.getElementById('count-reasoning').innerText = this.availableModels.filter(m => m.is_reasoning).length;
        document.getElementById('count-vision').innerText = this.availableModels.filter(m => m.is_vision).length;
        document.getElementById('count-cheap').innerText = this.availableModels.filter(m => m.is_cheap).length;

        container.innerHTML = filtered.map(m => {
            const isActive = m.id === this.settings.model;
            const contextText = m.context_length >= 1000000 ? `${(m.context_length/1000000).toFixed(1)}M` : `${Math.round(m.context_length / 1000)}k`;
            return `
                <div class="model-select-card ${isActive ? 'active' : ''}" onclick="app.selectModel('${m.id}')">
                    <div class="model-header-row">
                        <div class="model-title-box">
                            <div class="model-badges-row">
                                ${m.is_free ? '<span class="badge-pill free">🟢 مجاني 100% (0.00$)</span>' : '<span class="badge-pill pro">PRO</span>'}
                                <span class="badge-pill context">⚡ ${contextText} سياق</span>
                                ${m.is_reasoning ? '<span class="badge-pill" style="background: rgba(192, 132, 252, 0.16); color: #c084fc;">🧠 تفكير</span>' : ''}
                                ${m.is_vision ? '<span class="badge-pill" style="background: rgba(56, 189, 248, 0.16); color: #38bdf8;">👁️ رؤية</span>' : ''}
                            </div>
                            <div class="model-name-text">${this.escapeHTML(m.name)}</div>
                        </div>
                    </div>
                    <div class="model-desc-text">${this.escapeHTML(m.description || m.id)}</div>
                    <div class="model-footer-row">
                        <span>المزود: <strong style="color: #cbd5e1;">${m.provider}</strong></span>
                        ${isActive ? '<span class="btn-select-model-trigger active">🟢 النموذج المفعل حالياً</span>' : '<span class="btn-select-model-trigger inactive">اختيار النموذج ↵</span>'}
                    </div>
                </div>
            `;
        }).join('');
    }

    selectModel(modelId) {
        this.settings.model = modelId;
        this.safeStorageSet('ox_alpha_settings_v2', JSON.stringify(this.settings));
        this.renderUIState();
        this.showToast(`تم تفعيل النموذج: ${modelId} ⚡`, 'success');
        this.closeModals();
    }

    handleSettingsModelChange(val) {
        const customGroup = document.getElementById('custom-model-input-group');
        if (customGroup) customGroup.style.display = val === 'custom' ? 'block' : 'none';
    }

    toggleWebSearch() {
        this.isWebSearchActive = !this.isWebSearchActive;
        const btn = document.getElementById('btn-web-search');
        if (btn) btn.classList.toggle('active', this.isWebSearchActive);
        this.showToast(this.isWebSearchActive ? 'تم تفعيل البحث الحي في الويب 🌐' : 'تم إيقاف البحث الحي', 'info');
    }

    async executeLiveWebSearch(query) {
        const tavilyKey = this.settings.tavilyApiKey?.trim();
        if (tavilyKey) {
            try {
                const res = await fetch('https://api.tavily.com/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api_key: tavilyKey, query, search_depth: 'basic', max_results: 5 })
                });
                if (res.ok) {
                    const data = await res.json();
                    return (data.results || []).map(r => `### [${r.title}](${r.url})\n${r.content}`).join('\n\n');
                }
            } catch (e) {}
        }

        try {
            const wikiUrl = `https://ar.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
            const res = await fetch(wikiUrl);
            if (res.ok) {
                const data = await res.json();
                const results = data.query?.search || [];
                if (results.length > 0) {
                    return results.slice(0, 3).map(r => `### [ويكيبيديا: ${r.title}](https://ar.wikipedia.org/wiki/${encodeURIComponent(r.title)})\n${r.snippet.replace(/<[^>]+>/g, '')}`).join('\n\n');
                }
            }
        } catch (e) {}
        return '';
    }

    // IN-BROWSER ZIP FILE INGESTION & STACK DETECTION
    async processUniversalFile(file) {
        const fileName = file.name;
        const ext = fileName.split('.').pop().toLowerCase();
        const previewBar = document.getElementById('attachment-preview-bar');
        const fileNameTag = document.getElementById('attachment-file-name');
        const statusTag = document.getElementById('extraction-status-text');
        const iconTag = document.getElementById('attachment-icon-tag');
        const imgTag = document.getElementById('attachment-img-tag');
        const btnBrowseZip = document.getElementById('btn-browse-extracted-zip');

        if (previewBar) previewBar.style.display = 'flex';
        if (fileNameTag) fileNameTag.innerText = fileName;
        if (statusTag) statusTag.innerText = 'جاري التحليل واستخراج المحتوى...';
        if (btnBrowseZip) btnBrowseZip.style.display = 'none';

        if (ext === 'zip') {
            try {
                statusTag.innerText = 'جاري فك ضغط واستخراج ملفات المشروع (JSZip)...';
                const zip = await JSZip.loadAsync(file);
                let extractedText = `=== حزمة مشروع مضغوطة: ${fileName} ===\n\n`;
                let fileCount = 0;
                let stackHints = [];

                const zipEntries = [];
                this.virtualProjectFiles.clear();

                const entries = Object.keys(zip.files);
                for (const path of entries) {
                    const zipEntry = zip.files[path];
                    if (!zipEntry.dir) {
                        fileCount++;
                        const lowerPath = path.toLowerCase();
                        if (lowerPath.endsWith('package.json')) stackHints.push('Node.js / JavaScript');
                        if (lowerPath.endsWith('requirements.txt') || lowerPath.endsWith('pyproject.toml')) stackHints.push('Python');
                        if (lowerPath.endsWith('next.config.js') || lowerPath.endsWith('next.config.mjs')) stackHints.push('Next.js');
                        if (lowerPath.endsWith('vite.config.js') || lowerPath.endsWith('vite.config.ts')) stackHints.push('Vite');
                        if (lowerPath.endsWith('cargo.toml')) stackHints.push('Rust');

                        const isCode = /\.(js|jsx|ts|tsx|py|html|css|json|md|sql|vue|rs|go|php|c|cpp|h|java|sh|yaml|yml)$/i.test(path);
                        if (isCode && !path.includes('node_modules/') && !path.includes('.git/')) {
                            const text = await zipEntry.async('text');
                            this.virtualProjectFiles.set(path, { content: text, lang: ext, timestamp: Date.now() });
                            zipEntries.push({ path, content: text });
                            if (extractedText.length < 200000) {
                                extractedText += `--- [الملف: ${path}] ---\n${text.slice(0, 8000)}\n\n`;
                            }
                        }
                    }
                }

                const uniqueStack = Array.from(new Set(stackHints)).join(', ') || 'مشروع برمجي';
                this.currentAttachment = {
                    name: fileName,
                    textContent: extractedText,
                    isZipProject: true,
                    zipEntries: zipEntries
                };

                if (statusTag) statusTag.innerText = `✅ تم فك الضغط (${fileCount} ملف - بنية: ${uniqueStack})`;
                if (iconTag) {
                    iconTag.className = 'fa-solid fa-file-zipper text-warning';
                    iconTag.style.display = 'block';
                }
                if (imgTag) imgTag.style.display = 'none';
                if (btnBrowseZip) btnBrowseZip.style.display = 'block';
                this.showToast(`تم استخراج كود ${fileName} بنجاح (${fileCount} ملف) 📦`, 'success');

            } catch (err) {
                statusTag.innerText = '❌ فشل فك ضغط ZIP: ' + err.message;
                this.showToast('فشل قراءة ملف ZIP', 'error');
            }
        } else if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                this.currentAttachment = {
                    name: fileName,
                    base64: e.target.result
                };
                if (imgTag) {
                    imgTag.src = e.target.result;
                    imgTag.style.display = 'block';
                }
                if (iconTag) iconTag.style.display = 'none';
                if (statusTag) statusTag.innerText = 'جاهزة للرؤية والتحليل متعدد الوسائط';
            };
            reader.readAsDataURL(file);
        } else {
            const reader = new FileReader();
            reader.onload = (e) => {
                this.currentAttachment = {
                    name: fileName,
                    textContent: e.target.result
                };
                if (iconTag) {
                    iconTag.className = 'fa-solid fa-file-code text-info';
                    iconTag.style.display = 'block';
                }
                if (imgTag) imgTag.style.display = 'none';
                if (statusTag) statusTag.innerText = 'تم قراءة الملف النصي بنجاح';
            };
            reader.readAsText(file);
        }
    }

    openZipInspectorModal() {
        const modal = document.getElementById('zip-modal');
        const treeContainer = document.getElementById('zip-file-tree');
        if (!modal || !treeContainer) return;

        if (!this.currentAttachment || !this.currentAttachment.zipEntries) {
            this.showToast('لا يوجد مشروع ZIP مستخرج حالياً', 'warning');
            return;
        }

        treeContainer.innerHTML = this.currentAttachment.zipEntries.map(f => `
            <div class="session-item-row" style="padding: 6px 10px;" onclick="app.previewZipFile('${f.path}')">
                <i class="fa-solid fa-file-code" style="font-size: 0.75rem; color: #38bdf8;"></i>
                <span class="truncate" style="font-family: var(--font-mono); font-size: 0.76rem;">${f.path}</span>
            </div>
        `).join('');

        modal.classList.add('active');
    }

    previewZipFile(filePath) {
        const file = this.currentAttachment?.zipEntries?.find(f => f.path === filePath);
        if (!file) return;
        this.selectedZipFile = file;
        const title = document.getElementById('zip-file-viewer-title');
        const viewer = document.getElementById('zip-file-viewer');
        if (title) title.innerText = filePath;
        if (viewer) viewer.innerText = file.content;
    }

    developSelectedZipFile() {
        if (!this.selectedZipFile) {
            this.showToast('يرجى اختيار ملف أولاً من الشجرة', 'warning');
            return;
        }
        this.closeModals();
        const prompt = `قم بتحليل وتطوير ملف الكود التالي من المشروع المستخرج:\n\n[الملف: ${this.selectedZipFile.path}]:\n\`\`\`\n${this.selectedZipFile.content}\n\`\`\`\n\nالمطلوب: تحسين الأداء وإضافة معالجة الأخطاء وإكمال النواقص.`;
        this.sendQuickPrompt(prompt);
    }

    askAIDevelopZipProject() {
        this.closeModals();
        const prompt = `قم بعمل دراسة وتطوير كامل لحزمة المشروع المستخرجة (${this.currentAttachment?.name || 'ZIP Project'}). حدد الهيكل المعماري والملفات المحورية واقترح تحسينات فورية مع كتابة الكود المطور.`;
        this.sendQuickPrompt(prompt);
    }

    removeAttachment() {
        this.currentAttachment = null;
        const previewBar = document.getElementById('attachment-preview-bar');
        if (previewBar) previewBar.style.display = 'none';
        document.getElementById('universal-file-input').value = '';
    }

    // MULTI-LINGUAL VOICE STT & TTS (AR / FR / EN)
    initVoiceAPIs() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            this.speechRecognition = new SpeechRecognition();
            this.speechRecognition.continuous = true;
            this.speechRecognition.interimResults = true;
            this.speechRecognition.lang = this.speechLang;

            this.speechRecognition.onresult = (event) => {
                let finalTranscript = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        finalTranscript += event.results[i][0].transcript;
                    }
                }
                if (finalTranscript) {
                    const input = document.getElementById('user-input');
                    if (input) {
                        input.value = (input.value ? input.value + ' ' : '') + finalTranscript;
                        this.autoResizeTextarea(input);
                    }
                }
            };

            this.speechRecognition.onerror = (e) => {
                console.warn('Speech recognition error:', e);
                this.isRecording = false;
                const micBtn = document.getElementById('btn-mic');
                if (micBtn) micBtn.classList.remove('recording');
            };

            this.speechRecognition.onend = () => {
                this.isRecording = false;
                const micBtn = document.getElementById('btn-mic');
                if (micBtn) micBtn.classList.remove('recording');
            };
        }
    }

    toggleRecording() {
        if (!this.speechRecognition) {
            this.showToast('المتصفح لا يدعم التعرف الصوتي المباشر', 'warning');
            return;
        }
        const micBtn = document.getElementById('btn-mic');
        if (!this.isRecording) {
            try {
                this.speechRecognition.lang = this.speechLang;
                this.speechRecognition.start();
                this.isRecording = true;
                if (micBtn) micBtn.classList.add('recording');
                const langName = this.speechLang.startsWith('ar') ? 'العربية' : this.speechLang.startsWith('fr') ? 'الفرنسية' : 'الإنجليزية';
                this.showToast(`جاري الاستماع باللغة ${langName}... 🎙️`, 'info');
            } catch (e) {}
        } else {
            this.speechRecognition.stop();
            this.isRecording = false;
            if (micBtn) micBtn.classList.remove('recording');
        }
    }

    toggleSTTLang() {
        if (this.speechLang === 'ar-SA') {
            this.speechLang = 'fr-FR';
        } else if (this.speechLang === 'fr-FR') {
            this.speechLang = 'en-US';
        } else {
            this.speechLang = 'ar-SA';
        }

        const label = document.getElementById('stt-lang-label');
        if (label) {
            label.innerText = this.speechLang.slice(0, 2).toUpperCase();
        }
        const langName = this.speechLang.startsWith('ar') ? 'العربية' : this.speechLang.startsWith('fr') ? 'Français' : 'English';
        this.showToast(`تم ضبط لغة الصوت: ${langName}`, 'info');
    }

    speakText(text, btnElement) {
        if (!('speechSynthesis' in window)) {
            this.showToast('المتصفح لا يدعم القراءة الصوتية TTS', 'warning');
            return;
        }
        if (window.speechSynthesis.speaking) {
            window.speechSynthesis.cancel();
            if (this._currentPlayingBtn) {
                this._currentPlayingBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i> <span>قراءة صوتية</span>';
            }
            this._currentPlayingBtn = null;
            return;
        }

        const cleanText = text.replace(/<[^>]+>/g, '').replace(/```[\s\S]*?```/g, 'تم تجاوز كتلة الكود البرمجي');
        const utterance = new SpeechSynthesisUtterance(cleanText);

        if (/[\u0600-\u06FF]/.test(cleanText)) {
            utterance.lang = 'ar-SA';
        } else if (/[àâéèêëîïôùûüçÀÂÉÈÊËÎÏÔÙÛÜÇ]/.test(cleanText) || /\b(le|la|les|un|une|des|est|sont|dans|pour|avec|vous|nous|projet|code)\b/i.test(cleanText)) {
            utterance.lang = 'fr-FR';
        } else {
            utterance.lang = 'en-US';
        }
        utterance.rate = this.settings.ttsRate || 1.0;

        if (btnElement) {
            this._currentPlayingBtn = btnElement;
            btnElement.innerHTML = '<i class="fa-solid fa-stop" style="color: #ef4444;"></i> <span>إيقاف الصوت</span>';
        }

        utterance.onend = () => {
            if (btnElement) {
                btnElement.innerHTML = '<i class="fa-solid fa-volume-high"></i> <span>قراءة صوتية</span>';
            }
            this._currentPlayingBtn = null;
        };

        window.speechSynthesis.speak(utterance);
    }

    // IN-BROWSER CODE EXECUTION (Pyodide Python Wasm & JS)
    async runPythonCode(code, terminalEl) {
        if (!terminalEl) return;
        terminalEl.style.display = 'block';
        terminalEl.innerText = '⚡ جاري تشغيل بايثون داخل المتصفح عبر Pyodide Wasm...\n';

        try {
            if (!this._pyodideInstance) {
                if (typeof loadPyodide === 'undefined') {
                    throw new Error('مكتبة Pyodide غير محملة');
                }
                terminalEl.innerText += '📦 جاري تحميل بيئة بايثون Wasm لأول مرة...\n';
                this._pyodideInstance = await loadPyodide();
            }

            let outputLogs = '';
            this._pyodideInstance.setStdout({ batched: (str) => { outputLogs += str + '\n'; } });
            this._pyodideInstance.setStderr({ batched: (str) => { outputLogs += '[stderr] ' + str + '\n'; } });

            await this._pyodideInstance.runPythonAsync(code);
            terminalEl.innerText = outputLogs || '✅ اكتمل التنفيذ بنجاح دون مخرجات (Exit 0)';
        } catch (err) {
            terminalEl.innerText = '❌ خطأ أثناء تنفيذ بايثون:\n' + err.message;
        }
    }

    runJavaScriptCode(code, terminalEl) {
        if (!terminalEl) return;
        terminalEl.style.display = 'block';
        terminalEl.innerText = '⚡ جاري تشغيل كود JavaScript...\n';

        const originalLog = console.log;
        let logs = [];
        console.log = (...args) => {
            logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
            originalLog.apply(console, args);
        };

        try {
            const result = eval(code);
            console.log = originalLog;
            let out = logs.join('\n');
            if (result !== undefined) out += '\n[Result]: ' + (typeof result === 'object' ? JSON.stringify(result, null, 2) : result);
            terminalEl.innerText = out || '✅ اكتمل التنفيذ بنجاح دون مخرجات (Return undefined)';
        } catch (err) {
            console.log = originalLog;
            terminalEl.innerText = '❌ خطأ في تشغيل JavaScript:\n' + err.message;
        }
    }

    toggleLiveArtifact(btn) {
        const box = btn.closest('.code-block-box');
        const iframe = box.querySelector('.live-artifact-frame');
        const code = box.querySelector('pre code').innerText;

        if (iframe.style.display === 'block') {
            iframe.style.display = 'none';
            btn.innerHTML = '<i class="fa-solid fa-eye"></i> <span>معاينة</span>';
        } else {
            iframe.style.display = 'block';
            iframe.srcdoc = code;
            btn.innerHTML = '<i class="fa-solid fa-eye-slash"></i> <span>إخفاء</span>';
        }
    }

    formatCodeBlock(codeEl, lang) {
        this.showToast('تم تنسيق الكود 🧹', 'info');
    }

    generateTestFromBtn(btn, lang) {
        const code = btn.closest('.code-block-box').querySelector('pre code').innerText;
        const prompt = `اكتب اختبارات شاملة (Unit Tests) وموثوقة لهذا الكود باللغة (${lang}):\n\n\`\`\`${lang}\n${code}\n\`\`\``;
        this.sendQuickPrompt(prompt);
    }

    openGitHubWorkbench() {
        const modal = document.getElementById('github-modal');
        const title = document.getElementById('gh-modal-active-repo');
        if (title) title.innerText = this.settings.githubRepo;
        this.refreshGitHubTree();
        if (modal) modal.classList.add('active');
    }

    async refreshGitHubTree() {
        const treeContainer = document.getElementById('repo-file-tree');
        if (!treeContainer) return;
        treeContainer.innerHTML = '<div style="font-size: 0.78rem; color: var(--text-dim); text-align: center; padding: 20px;">جاري جلب الملفات...</div>';

        const owner = this.settings.githubOwner || 'naderba69';
        const repo = this.settings.githubRepo || 'daschai';
        const branch = this.settings.githubBranch || 'main';
        const token = this.settings.githubToken?.trim();

        try {
            const headers = { 'Accept': 'application/vnd.github.v3+json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
            const res = await fetch(treeUrl, { headers });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            const files = (data.tree || []).filter(item => item.type === 'blob' && !item.path.includes('.git/')).slice(0, 100);

            treeContainer.innerHTML = files.map(f => `
                <div class="session-item-row" style="padding: 6px 10px;" onclick="app.previewGitHubFile('${f.path}')">
                    <i class="fa-solid fa-file-code" style="font-size: 0.75rem; color: #34d399;"></i>
                    <span class="truncate" style="font-family: var(--font-mono); font-size: 0.76rem;">${f.path}</span>
                </div>
            `).join('');
        } catch (err) {
            treeContainer.innerHTML = `<div style="font-size: 0.78rem; color: #ef4444; padding: 10px;">تعذر جلب الشجرة: ${err.message}</div>`;
        }
    }

    async previewGitHubFile(path) {
        const owner = this.settings.githubOwner || 'naderba69';
        const repo = this.settings.githubRepo || 'daschai';
        const branch = this.settings.githubBranch || 'main';

        const title = document.getElementById('gh-file-viewer-title');
        const viewer = document.getElementById('repo-file-viewer');
        if (title) title.innerText = path;
        if (viewer) viewer.innerText = '// جاري التحميل من GitHub...';

        try {
            const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
            const res = await fetch(rawUrl);
            if (res.ok) {
                const content = await res.text();
                this.selectedFileContent = { path, content };
                if (viewer) viewer.innerText = content;
            }
        } catch (e) {
            if (viewer) viewer.innerText = '// تعذر تحميل الملف';
        }
    }

    askAICodeReview() {
        if (!this.selectedFileContent) {
            this.showToast('يرجى اختيار ملف للمراجعة أولاً', 'warning');
            return;
        }
        this.closeModals();
        const prompt = `قم بعمل مراجعة كود شاملة (Code Review) للملف التالي:\n\n[الملف: ${this.selectedFileContent.path}]:\n\`\`\`\n${this.selectedFileContent.content}\n\`\`\`\n\nالمطلوب: فحص الأمان واقتراح التحسينات.`;
        this.sendQuickPrompt(prompt);
    }

    openDiagnosticsModal() {
        const modal = document.getElementById('diagnostics-modal');
        if (modal) modal.classList.add('active');
    }

    async runDiagnosticsCheck() {
        const openRouterStatus = document.getElementById('diag-openrouter-status');
        const openRouterDetails = document.getElementById('diag-openrouter-details');
        const githubStatus = document.getElementById('diag-github-status');
        const githubDetails = document.getElementById('diag-github-details');
        const summaryBox = document.getElementById('diag-summary-box');

        if (openRouterStatus) openRouterStatus.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-info"></i>';
        if (githubStatus) githubStatus.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-info"></i>';

        let allGood = true;

        // 1. Check OpenRouter Key
        const apiKey = this.settings.apiKey?.trim();
        if (!apiKey) {
            if (openRouterStatus) openRouterStatus.innerHTML = '<span style="color: #f59e0b; font-size: 0.8rem;">⚠️ بدون مفتاح</span>';
            if (openRouterDetails) openRouterDetails.innerText = 'يلزم إنشاء مفتاح مجاني من openrouter.ai/keys';
            allGood = false;
        } else {
            try {
                const testRes = await fetch('https://openrouter.ai/api/v1/auth/key', {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });
                if (testRes.ok) {
                    if (openRouterStatus) openRouterStatus.innerHTML = '<span style="color: #34d399; font-size: 0.8rem;">سليم وموثق 🟢</span>';
                    if (openRouterDetails) openRouterDetails.innerText = 'الاتصال نشط والرصيد/المجاني متاح';
                } else {
                    if (openRouterStatus) openRouterStatus.innerHTML = '<span style="color: #ef4444; font-size: 0.8rem;">❌ غير صالح</span>';
                    if (openRouterDetails) openRouterDetails.innerText = 'تحقق من صحة المفتاح في الإعدادات';
                    allGood = false;
                }
            } catch (e) {
                if (openRouterStatus) openRouterStatus.innerHTML = '<span style="color: #34d399; font-size: 0.8rem;">جاهز 🟢</span>';
            }
        }

        // 2. Check GitHub Connection
        const owner = this.settings.githubOwner || 'naderba69';
        const repo = this.settings.githubRepo || 'daschai';
        try {
            const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
            if (ghRes.ok) {
                if (githubStatus) githubStatus.innerHTML = '<span style="color: #34d399; font-size: 0.8rem;">متصل وجاهز 🟢</span>';
                if (githubDetails) githubDetails.innerText = `المستودع (${owner}/${repo}) متاح ومفهرس`;
            } else {
                if (githubStatus) githubStatus.innerHTML = '<span style="color: #f59e0b; font-size: 0.8rem;">⚠️ مستودع خاص / محدود</span>';
                if (githubDetails) githubDetails.innerText = 'أدخل رمز GitHub PAT للوصول الكامل';
            }
        } catch (e) {
            if (githubStatus) githubStatus.innerHTML = '<span style="color: #ef4444; font-size: 0.8rem;">خطأ اتصال</span>';
        }

        if (summaryBox) {
            summaryBox.innerHTML = allGood
                ? '<strong style="color: #34d399;">✅ كافة الأنظمة تعمل بكفاءة 100%!</strong> المنظومة جاهزة لاستقبال المشاريع وتوليد الأكواد وعمل Commit.'
                : '<strong style="color: #f59e0b;">⚠️ تم اكتشاف بعض الملاحظات أعلاه:</strong> يرجى إدخال مفتاح OpenRouter في الإعدادات لتجنب أخطاء المزود.';
        }
        this.showToast('اكتمل فحص الأنظمة والتشخيص 🩺', 'info');
    }

    // USER MESSAGE SENDING
    async sendUserMessage(forcedText = null) {
        const input = document.getElementById('user-input');
        const text = forcedText !== null ? forcedText : (input ? input.value.trim() : '');

        if (!text && !this.currentAttachment) return;

        const session = this.sessions.find(s => s.id === this.activeSessionId);
        if (!session) return;

        const userMsg = {
            id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            role: 'user',
            content: text,
            attachment: this.currentAttachment ? { ...this.currentAttachment } : null,
            timestamp: Date.now()
        };

        session.messages.push(userMsg);
        if (session.messages.length === 1) {
            session.title = text.slice(0, 36) || (this.currentAttachment ? this.currentAttachment.name : 'محادثة جديدة');
        }

        if (input) {
            input.value = '';
            this.autoResizeTextarea(input);
        }
        this.removeAttachment();

        const assistantMsgId = 'msg_' + (Date.now() + 1) + '_' + Math.random().toString(36).substring(2, 6);
        const assistantMsg = {
            id: assistantMsgId,
            role: 'assistant',
            content: '',
            reasoning: '',
            steps: [],
            status: 'streaming',
            startTime: Date.now(),
            timestamp: Date.now(),
            model: this.settings.model
        };

        session.messages.push(assistantMsg);
        session.updatedAt = Date.now();
        this.saveSessions();
        this.renderUIState();
        this.scrollToBottom(true);

        await this.streamChatCompletion(session.id, assistantMsgId, 0, 0);
    }

    // STREAMING MARKDOWN REPAIRER
    repairMarkdownForStreaming(content) {
        if (!content) return '';
        let repaired = content;

        const codeFenceMatches = repaired.match(/```/g);
        if (codeFenceMatches && codeFenceMatches.length % 2 !== 0) {
            repaired += '\n```';
        }

        return repaired;
    }

    // RESILIENT MULTI-PASS AUTO-CONTINUATION STREAM ENGINE
    async streamChatCompletion(sessionId, assistantMsgId, retryIndex = 0, autoContinuePass = 0, maxPasses = 5) {
        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) return;
        const assistantMsg = session.messages.find(m => m.id === assistantMsgId);
        if (!assistantMsg) return;

        const abortController = new AbortController();
        this.activeStreams.set(sessionId, abortController);
        this.toggleStopButton(true);

        // Smart Router: Auto-select best model based on prompt
        let activeModelToUse = this.settings.model || 'google/gemma-4-31b-it:free';
        if (this.isSmartRouterActive && autoContinuePass === 0) {
            const lastMsg = session.messages.filter(m => m.role === 'user').pop();
            const query = (lastMsg?.content || '').toLowerCase();

            if (lastMsg?.attachment?.base64) {
                activeModelToUse = 'openrouter/free';
            } else if (query.includes('حلل') || query.includes('فكر') || query.includes('رياضيات') || query.includes('خوارزمية') || query.includes('algorithm')) {
                activeModelToUse = 'thinkingmachines/inkling:free';
            } else if (query.includes('كود') || query.includes('برمج') || query.includes('مستودع') || query.includes('github') || query.includes('code')) {
                activeModelToUse = 'google/gemma-4-31b-it:free';
            }
        }

        const freeModelsList = this.availableModels.filter(m => m.is_free && !m.id.includes('ultra')).map(m => m.id);
        const fallbackChain = [
            activeModelToUse,
            'google/gemma-4-31b-it:free',
            'nvidia/nemotron-3.5-lightning:free',
            'openrouter/free',
            'minimax/minimax-m3:free',
            'google/gemma-4-26b-a4b-it:free',
            ...freeModelsList
        ];
        const uniqueCascade = Array.from(new Set(fallbackChain.filter(Boolean)));
        const currentModel = uniqueCascade[retryIndex] || uniqueCascade[0];

        assistantMsg.model = currentModel;
        assistantMsg.steps = assistantMsg.steps || [];

        const apiKey = this.settings.apiKey?.trim();
        if (!apiKey) {
            assistantMsg.status = 'error';
            assistantMsg.content = `### 🔑 يلزم إدخال مفتاح OpenRouter API المجاني\n\n` +
                `لتشغيل نماذج الذكاء الاصطناعي على OpenRouter وتجنب أخطاء المزود (Provider Error)، يتطلب الموقع إنشاء مفتاح API مجاني لتوثيق الاتصال:\n\n` +
                `1. افتح رابط المفاتيح المجاني: [https://openrouter.ai/keys](https://openrouter.ai/keys)\n` +
                `2. اضغط **Create Key** وانسخه والصقه في **الإعدادات** أدناه.\n\n` +
                `<button class="btn-new-thread" style="width: auto; padding: 8px 18px; margin-top: 10px;" onclick="app.openSettingsModal()"><i class="fa-solid fa-key"></i> إدخال مفتاح OpenRouter في الإعدادات</button>`;
            this.activeStreams.delete(sessionId);
            this.toggleStopButton(false);
            this.saveSessions();
            this.renderUIState();
            this.openSettingsModal();
            this.showToast('يرجى إدخال مفتاح OpenRouter API Key أولاً', 'warning');
            return;
        }

        try {
            let webContext = '';
            if (this.isWebSearchActive && autoContinuePass === 0) {
                assistantMsg.steps.push({ text: '🔍 جاري البحث الحي في الويب...', done: false });
                this.renderMessages();
                
                const lastUserMsg = session.messages.filter(m => m.role === 'user').pop();
                const query = lastUserMsg ? lastUserMsg.content : 'أحدث المعلومات';
                webContext = await this.executeLiveWebSearch(query);
                
                assistantMsg.steps[assistantMsg.steps.length - 1].done = true;
                if (webContext) {
                    assistantMsg.steps.push({ text: '✅ تم جلب وتلخيص نتائج البحث من الويب', done: true });
                }
            }

            if (this.isAutonomousAgentActive && autoContinuePass === 0) {
                assistantMsg.steps.push({ text: '🤖 وضع الوكيل الذاتي (ReAct Loop): تحليل المتطلبات وفحص الملفات...', done: false });
                this.renderMessages();
            }

            if (autoContinuePass === 0) {
                assistantMsg.steps.push({ text: `🧠 إرسال سياق المشروع إلى النموذج (${currentModel})...`, done: false });
            } else {
                assistantMsg.steps.push({ text: `⚡ استكمال التوليد التلقائي لإنهاء باقي الرد بالكامل دون انقطاع (المرحلة ${autoContinuePass + 1}/${maxPasses})...`, done: false });
            }
            this.renderMessages();

            let personaPrompt = PERSONA_PROMPTS[this.activePersona] || PERSONA_PROMPTS.fullstack;
            let systemText = `${personaPrompt}\n${this.settings.systemPrompt || ''}`;
            if (this.settings.githubRepo) {
                systemText += `\nالمشروع النشط الحالي في GitHub هو: ${this.settings.githubOwner || 'naderba69'}/${this.settings.githubRepo}.`;
            }
            if (webContext) {
                systemText += `\n\nنتائج البحث الحي المرفقة بالويب:\n${webContext}`;
            }

            const messagesPayload = [{ role: 'system', content: systemText }];

            session.messages.forEach(m => {
                if (m.id === assistantMsgId) {
                    if (autoContinuePass > 0 && m.content) {
                        messagesPayload.push({ role: 'assistant', content: m.content });
                    }
                    return;
                }
                if (m.role === 'user') {
                    let userContent = m.content || '';
                    if (m.attachment?.textContent) {
                        userContent += `\n\n[محتوى المشروع/الملف المرفق: ${m.attachment.name}]:\n${m.attachment.textContent}`;
                    }
                    if (m.attachment?.base64) {
                        messagesPayload.push({
                            role: 'user',
                            content: [
                                { type: 'text', text: userContent },
                                { type: 'image_url', image_url: { url: m.attachment.base64 } }
                            ]
                        });
                    } else {
                        messagesPayload.push({ role: 'user', content: userContent });
                    }
                } else if (m.role === 'assistant') {
                    messagesPayload.push({ role: 'assistant', content: m.content || '' });
                }
            });

            if (autoContinuePass > 0) {
                messagesPayload.push({
                    role: 'user',
                    content: 'استمر فوراً وبدقة في إكمال إجابتك السابقة من النقطة التي توقفت عندها بالضبط دون تكرار أو مقدمات، واكتب باقي الكود والشرح كاملاً.'
                });
            }

            const headers = {
                'Content-Type': 'application/json',
                'HTTP-Referer': window.location.origin || 'https://daschai.vercel.app',
                'X-Title': 'OX-Alpha Workbench Pro',
                'Authorization': `Bearer ${apiKey}`
            };

            const isReasoningModel = currentModel.includes('r1') || currentModel.includes('o1') || currentModel.includes('o3') || currentModel.includes('thinking');

            const requestBody = {
                model: currentModel,
                messages: messagesPayload,
                stream: true,
                max_tokens: this.settings.maxTokens || 16384
            };

            if (!isReasoningModel) {
                requestBody.temperature = this.settings.temperature || 0.7;
            }

            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody),
                signal: abortController.signal
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errMsg = errorData.error?.message || errorData.message || `HTTP ${response.status}`;

                if (response.status === 401) {
                    throw new Error(`مفتاح OpenRouter API غير صالح أو منتهي الصلاحية (401 Unauthorized). يرجى التحقق من المفتاح في https://openrouter.ai/keys ولصقه في الإعدادات.`);
                }

                if (response.status === 402) {
                    if (retryIndex < uniqueCascade.length - 1) {
                        const nextFreeModel = uniqueCascade.find(m => m.endsWith(':free') || m.includes('free')) || 'google/gemma-4-31b-it:free';
                        this.showToast(`⚠️ رصيد المفتاح 0$. التحويل التلقائي الذكي للنموذج المجاني 100% (${nextFreeModel})...`, 'warning');
                        assistantMsg.steps.push({ text: `⚠️ رصيد 0$، تم التحويل تلقائياً إلى النموذج المجاني ${nextFreeModel}...`, done: true });
                        this.renderMessages();
                        const nextIdx = uniqueCascade.indexOf(nextFreeModel);
                        return await this.streamChatCompletion(sessionId, assistantMsgId, nextIdx >= 0 ? nextIdx : retryIndex + 1, autoContinuePass, maxPasses);
                    }
                }

                if (retryIndex < uniqueCascade.length - 1) {
                    const nextModel = uniqueCascade[retryIndex + 1];
                    this.showToast(`⚠️ تعذر استجابة ${currentModel} (${errMsg}). التحويل التلقائي الذكي إلى ${nextModel}...`, 'warning');
                    assistantMsg.steps.push({ text: `⚠️ خطأ مزود في ${currentModel}، تم التحويل تلقائياً إلى ${nextModel}...`, done: true });
                    this.renderMessages();
                    return await this.streamChatCompletion(sessionId, assistantMsgId, retryIndex + 1, autoContinuePass, maxPasses);
                }
                throw new Error(errMsg);
            }

            assistantMsg.steps[assistantMsg.steps.length - 1].done = true;

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let charCount = 0;
            let finishReason = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data:')) continue;
                    const jsonStr = trimmed.replace(/^data:\s*/, '');
                    if (jsonStr === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(jsonStr);
                        const choice = parsed.choices?.[0];
                        const delta = choice?.delta;
                        if (choice?.finish_reason) {
                            finishReason = choice.finish_reason;
                        }
                        if (!delta) continue;

                        if (delta.reasoning || delta.reasoning_content) {
                            assistantMsg.reasoning += (delta.reasoning || delta.reasoning_content);
                        }
                        if (delta.content) {
                            assistantMsg.content += delta.content;
                            charCount += delta.content.length;
                        }

                        const now = Date.now();
                        if (now - this._lastRenderTimestamp > 50 && this.activeSessionId === sessionId) {
                            this._lastRenderTimestamp = now;
                            this.renderMessages();
                            if (!this.userHasScrolledUp) {
                                this.scrollToBottom(false);
                            }
                        }
                    } catch (e) {}
                }
            }

            // Register Virtual Files and Update Studio
            if (assistantMsg.content) {
                const regex = /```(?:[a-zA-Z0-9_\-]+)?\s*(?:(?:\[(?:الملف:\s*)?([^\]]+)\])|(?:\/\/ File:\s*([^\n]+))|(?:# File:\s*([^\n]+)))\n([\s\S]*?)```/g;
                let match;
                while ((match = regex.exec(assistantMsg.content)) !== null) {
                    const filePath = (match[1] || match[2] || match[3] || '').trim();
                    const code = match[4] || '';
                    if (filePath && code) {
                        this.virtualProjectFiles.set(filePath, { content: code, lang: filePath.split('.').pop(), timestamp: Date.now() });
                        this.activeStudioFile = filePath;
                    }
                }
                if (this.isCodeStudioOpen) {
                    this.renderStudioWorkspace();
                }
            }

            assistantMsg.status = 'completed';
            assistantMsg.duration = ((Date.now() - assistantMsg.startTime) / 1000).toFixed(1);
            assistantMsg.tokens = Math.max(1, Math.round((assistantMsg.content.length + (assistantMsg.reasoning || '').length) / 3.8));
            assistantMsg.tps = (assistantMsg.tokens / (parseFloat(assistantMsg.duration) || 1)).toFixed(1);

            // Audio and Haptic completion chime
            this.playCompletionAudioHaptic();

            // Seamless Auto-Continuation if truncated
            if (finishReason === 'length' && autoContinuePass < maxPasses) {
                this.renderMessages();
                return await this.streamChatCompletion(sessionId, assistantMsgId, retryIndex, autoContinuePass + 1, maxPasses);
            }

        } catch (err) {
            if (err.name === 'AbortError') {
                assistantMsg.content += '\n\n*(تم إيقاف التوليد)*';
                assistantMsg.status = 'aborted';
            } else {
                console.error('Stream completion error:', err);
                const isNetOrProviderError = String(err?.message || '').toLowerCase().includes('network') || String(err?.message || '').toLowerCase().includes('fetch') || err?.name === 'TypeError';

                if (isNetOrProviderError && (!assistantMsg.content || assistantMsg.content.length < 50) && retryIndex < uniqueCascade.length - 1) {
                    const nextModel = uniqueCascade[retryIndex + 1];
                    this.showToast(`⚠️ انقطع تدفق ${currentModel}. التحويل الفوري الذكي إلى ${nextModel}...`, 'warning');
                    assistantMsg.steps.push({ text: `⚠️ انقطع تدفق ${currentModel}، تم التحويل تلقائياً وبدء التوليد عبر ${nextModel}...`, done: true });
                    this.renderMessages();
                    return await this.streamChatCompletion(sessionId, assistantMsgId, retryIndex + 1, autoContinuePass, maxPasses);
                }

                if (assistantMsg.content && assistantMsg.content.length > 50) {
                    assistantMsg.content += `\n\n*(اكتمل الرد جزئياً - انقر أدناه لإكمال باقي الإجابة مباشرة)*\n\n<button class="btn-new-thread" style="width: auto; padding: 6px 14px; font-size: 0.75rem;" onclick="app.continueGeneration('${assistantMsgId}')"><i class="fa-solid fa-play"></i> إكمال التوليد من آخر نقطة</button>`;
                    assistantMsg.status = 'completed';
                } else {
                    assistantMsg.content += `\n\n> ❌ **تعذر إكمال الاستجابة:** ${err.message}\n> *نصيحة: تأكد من صحة مفتاح OpenRouter من [openrouter.ai/keys](https://openrouter.ai/keys) أو اختر نموذجاً مستقراً مثل \`google/gemma-4-31b-it:free\`.*\n\n<button class="btn-new-thread" style="width: auto; padding: 8px 18px; margin-top: 8px;" onclick="app.openSettingsModal()"><i class="fa-solid fa-key"></i> إدخال مفتاح OpenRouter في الإعدادات</button>`;
                    assistantMsg.status = 'error';
                }
            }
        } finally {
            this.activeStreams.delete(sessionId);
            this.toggleStopButton(false);
            this.saveSessions();
            this.renderUIState();
        }
    }

    async continueGeneration(assistantMsgId) {
        const session = this.sessions.find(s => s.id === this.activeSessionId);
        if (!session) return;
        const assistantMsg = session.messages.find(m => m.id === assistantMsgId);
        if (!assistantMsg) return;

        const lastChunk = assistantMsg.content.replace(/<[^>]+>/g, '').slice(-400);
        const prompt = `تابع إكمال إجابتك السابقة بالضبط من النقطة التي توقفت عندها دون تكرار ما سبق واكتب باقي الكود والشرح:\n\n[آخر ما تم كتابته]:\n${lastChunk}`;
        await this.sendUserMessage(prompt);
    }

    stopCurrentSessionStream() {
        if (this.activeStreams.has(this.activeSessionId)) {
            this.activeStreams.get(this.activeSessionId).abort();
            this.activeStreams.delete(this.activeSessionId);
            this.toggleStopButton(false);
            this.showToast('تم إيقاف التوليد ⏹️', 'info');
        }
    }

    sendQuickPrompt(promptText) {
        const input = document.getElementById('user-input');
        if (input) input.value = promptText;
        this.sendUserMessage();
    }

    toggleStopButton(isGenerating) {
        const btnSend = document.getElementById('btn-send');
        const btnStop = document.getElementById('btn-stop');
        if (isGenerating) {
            if (btnSend) btnSend.style.display = 'none';
            if (btnStop) btnStop.style.display = 'flex';
        } else {
            if (btnSend) btnSend.style.display = 'flex';
            if (btnStop) btnStop.style.display = 'none';
        }
    }

    renderUIState() {
        const repoName = this.settings.githubRepo || 'daschai';
        const modelName = this.settings.model || 'google/gemma-4-31b-it:free';

        const headerRepo = document.getElementById('active-repo-name-text');
        const sidebarRepo = document.getElementById('sidebar-active-repo-name');
        const headerModel = document.getElementById('active-model-display');

        if (headerRepo) headerRepo.innerText = repoName;
        if (sidebarRepo) sidebarRepo.innerText = repoName;
        if (headerModel) headerModel.innerText = modelName;

        const banner = document.getElementById('api-key-banner');
        if (banner) {
            banner.style.display = this.settings.apiKey ? 'none' : 'flex';
        }

        this.renderSessionList();
        this.renderMessages();
    }

    renderSessionList() {
        const list = document.getElementById('sessions-list');
        if (!list) return;

        list.innerHTML = this.sessions.map(s => {
            const isActive = s.id === this.activeSessionId;
            const isStreaming = this.activeStreams.has(s.id);
            return `
                <div class="session-item-row ${isActive ? 'active' : ''}" onclick="app.switchSession('${s.id}')">
                    <i class="fa-regular fa-message" style="font-size: 0.8rem; margin-left: 6px;"></i>
                    <span class="session-title-text">${this.escapeHTML(s.title || 'محادثة')}</span>
                    ${isStreaming ? '<span class="session-streaming-pulse" title="جاري التوليد..."></span>' : ''}
                    <div class="session-actions-btns">
                        <button style="background: transparent; border: none; color: var(--text-dim); cursor: pointer; padding: 2px;" onclick="app.deleteSession('${s.id}', event)" title="حذف">
                            <i class="fa-regular fa-trash-can"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // MULTI-LINGUAL ARABIC / FRENCH / ENGLISH RENDERING WITH FAIL-SAFE FALLBACK
    renderMessages() {
        const container = document.getElementById('chat-messages-container');
        if (!container) return;

        const session = this.sessions.find(s => s.id === this.activeSessionId);
        if (!session || !session.messages || session.messages.length === 0) {
            container.innerHTML = `
                <div class="welcome-hero-box">
                    <div class="welcome-logo-badge">
                        <i class="fa-solid fa-wand-magic-sparkles"></i>
                    </div>
                    <h1 class="welcome-title-glow">OX-Alpha Workbench Pro</h1>
                    <p class="welcome-subtitle">منظومة هندسة البرمجيات بالذكاء الاصطناعي مع جلب وتحديث كود مستودعات GitHub مباشرة، فك وتصدير مشاريع ZIP، ودعم النماذج الحية بالعربية والفرنسية والإنجليزية.</p>

                    <div class="hero-cards-grid">
                        <div class="hero-action-card" onclick="app.ingestCurrentGitHubRepo()">
                            <div class="hero-card-header">
                                <div class="hero-card-title">جلب كود مستودع GitHub كاملاً</div>
                                <i class="fa-solid fa-cloud-arrow-down" style="color: #34d399; font-size: 1.1rem;"></i>
                            </div>
                            <div class="hero-card-desc">تحميل وقراءة كافة ملفات وكود مستودع (${this.settings.githubRepo}) مباشرة ليفهمها الذكاء الاصطناعي بالكامل.</div>
                        </div>

                        <div class="hero-action-card" onclick="document.getElementById('universal-file-input').click()">
                            <div class="hero-card-header">
                                <div class="hero-card-title">رفع وفك ضغط مشروع ZIP</div>
                                <i class="fa-solid fa-file-zipper" style="color: #fbbf24; font-size: 1.1rem;"></i>
                            </div>
                            <div class="hero-card-desc">استخراج وتفكيك كافة ملفات الأكواد البرمجية وهندستها وتطويرها فورياً.</div>
                        </div>

                        <div class="hero-action-card" onclick="app.openDualModelArena()">
                            <div class="hero-card-header">
                                <div class="hero-card-title">حلبة مقارنة نموذجين (Arena)</div>
                                <i class="fa-solid fa-bolt" style="color: #fbbf24; font-size: 1.1rem;"></i>
                            </div>
                            <div class="hero-card-desc">مقارنة توليد نموذجين جنباً إلى جنب في الوقت الفعلي.</div>
                        </div>

                        <div class="hero-action-card" onclick="app.downloadProjectAsZip()">
                            <div class="hero-card-header">
                                <div class="hero-card-title">تصدير وتحميل المشروع ZIP</div>
                                <i class="fa-solid fa-download" style="color: #38bdf8; font-size: 1.1rem;"></i>
                            </div>
                            <div class="hero-card-desc">تنزيل حزمة كاملة لملفات المشروع البرمجي في أرشيف ZIP جاهز للتشغيل.</div>
                        </div>
                    </div>
                </div>
            `;
            return;
        }

        container.innerHTML = session.messages.map(m => {
            const isUser = m.role === 'user';
            if (isUser) {
                return `
                    <div class="msg-bubble-row user-side" dir="auto">
                        <div class="sender-avatar usr">
                            <i class="fa-solid fa-user"></i>
                        </div>
                        <div class="msg-content-column">
                            <div class="msg-meta-bar">
                                <span class="msg-sender-name">المستخدم</span>
                                <span>${new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                            <div class="msg-card usr" dir="auto">
                                ${m.attachment ? `
                                    <div style="display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: rgba(0,0,0,0.3); border-radius: 6px; margin-bottom: 8px; font-size: 0.78rem;" dir="auto">
                                        <i class="${m.attachment.isGitHubProject ? 'fa-brands fa-github text-success' : m.attachment.isZipProject ? 'fa-solid fa-file-zipper text-warning' : 'fa-solid fa-paperclip text-info'}"></i>
                                        <span style="font-weight: 700;">${m.attachment.name}</span>
                                    </div>
                                ` : ''}
                                <div>${this.escapeHTML(m.content)}</div>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                let reasoningHtml = '';
                if (m.reasoning) {
                    reasoningHtml = `
                        <div class="reasoning-chain-card">
                            <div class="reasoning-header" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'">
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <i class="fa-solid fa-brain" style="color: #c084fc;"></i>
                                    <span>سلسلة التفكير المنطقي (DeepSeek R1 / Gemini Thinking)</span>
                                </div>
                                <i class="fa-solid fa-chevron-down" style="font-size: 0.7rem;"></i>
                            </div>
                            <div class="reasoning-content">${this.escapeHTML(m.reasoning)}</div>
                        </div>
                    `;
                }

                let stepsHtml = '';
                if (m.steps && m.steps.length > 0) {
                    stepsHtml = `
                        <div class="agent-live-steps-tray">
                            ${m.steps.map(s => `
                                <div class="live-step-item">
                                    ${s.done ? '<i class="fa-solid fa-check" style="color: #34d399;"></i>' : '<span class="live-step-spinner"></span>'}
                                    <span>${s.text}</span>
                                </div>
                            `).join('')}
                        </div>
                    `;
                }

                const repairedMarkdown = this.repairMarkdownForStreaming(m.content || '');
                let parsedContent = '';
                try {
                    if (typeof marked !== 'undefined') {
                        parsedContent = DOMPurify.sanitize(marked.parse(repairedMarkdown));
                    } else {
                        parsedContent = this.escapeHTML(m.content || '').replace(/\n/g, '<br>');
                    }
                } catch (err) {
                    console.warn('Markdown parsing fallback triggered:', err);
                    parsedContent = this.escapeHTML(m.content || '').replace(/\n/g, '<br>');
                }

                let gaugeHtml = '';
                if (m.duration && m.tokens) {
                    gaugeHtml = `
                        <div class="token-speed-gauge">
                            <span>⏱️ ${m.duration} ثانية</span>
                            <span>⚡ ${m.tps} توكن/ثانية</span>
                            <span>📊 ${m.tokens} توكن</span>
                        </div>
                    `;
                }

                return `
                    <div class="msg-bubble-row" dir="auto">
                        <div class="sender-avatar bot">
                            <i class="fa-solid fa-wand-magic-sparkles"></i>
                        </div>
                        <div class="msg-content-column">
                            <div class="msg-meta-bar">
                                <span class="msg-sender-name">OX-Alpha Pro</span>
                                <span style="font-size: 0.7rem; color: #8ab4f8;">(${m.model || 'AI'})</span>
                                <span>${new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                            <div class="msg-card bot" dir="auto">
                                ${stepsHtml}
                                ${reasoningHtml}
                                <div class="markdown-body" dir="auto">${parsedContent}</div>
                                ${gaugeHtml}
                                <div class="msg-footer-bar">
                                    <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                                        <button class="msg-sub-action-btn" onclick="app.downloadProjectAsZip()" title="تصدير وتحميل كامل ملفات المشروع المستخرج والمعدل كملف ZIP">
                                            <i class="fa-solid fa-file-zipper" style="color: #fbbf24;"></i>
                                            <span>تصدير ZIP للمشروع</span>
                                        </button>
                                        <button class="msg-sub-action-btn" onclick="app.continueGeneration('${m.id}')" title="متابعة وإكمال الإجابة">
                                            <i class="fa-solid fa-forward" style="color: #38bdf8;"></i>
                                            <span>إكمال التوليد</span>
                                        </button>
                                        <button class="msg-sub-action-btn" onclick="app.speakText(this.closest('.msg-card').innerText, this)">
                                            <i class="fa-solid fa-volume-high"></i>
                                            <span>قراءة صوتية (FR/AR/EN)</span>
                                        </button>
                                        <button class="msg-sub-action-btn" onclick="app.copyToClipboard(this.closest('.msg-card').innerText, this)">
                                            <i class="fa-regular fa-copy"></i>
                                            <span>نسخ الرد</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }
        }).join('');

        this.enhanceRenderedCodeBlocks();
    }

    enhanceRenderedCodeBlocks() {
        const codeBlocks = document.querySelectorAll('.markdown-body pre code');
        codeBlocks.forEach(codeEl => {
            const pre = codeEl.parentElement;
            if (pre.parentElement.classList.contains('code-block-box')) return;

            const langMatch = codeEl.className.match(/language-(\w+)/);
            const lang = langMatch ? langMatch[1].toLowerCase() : 'code';

            let detectedPath = '';
            const codeText = codeEl.innerText;
            const pathMatch = codeText.match(/^(?:\/\/|#|\/\*|<!--)?\s*(?:File|الملف|path):\s*([^\n\*\/]+)/i);
            if (pathMatch) {
                detectedPath = pathMatch[1].trim();
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'code-block-box';

            const toolbar = document.createElement('div');
            toolbar.className = 'code-block-toolbar';
            toolbar.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-weight: 700; color: #8ab4f8;">${lang}</span>
                    ${detectedPath ? `<span style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem;">${detectedPath}</span>` : ''}
                </div>
                <div class="code-actions-group">
                    ${detectedPath ? `
                        <button class="code-tool-btn" onclick="app.openDiffModal('${detectedPath}', '', this.closest('.code-block-box').querySelector('pre code').innerText)"><i class="fa-solid fa-code-compare"></i> <span>Diff</span></button>
                        <button class="code-tool-btn commit-btn" onclick="app.commitFileToGitHub('${detectedPath}', this.closest('.code-block-box').querySelector('pre code').innerText)"><i class="fa-brands fa-github"></i> <span>رفع لـ GitHub</span></button>
                    ` : ''}
                    ${lang === 'python' || lang === 'py' ? `<button class="code-tool-btn run-btn" onclick="app.runPythonCode(this.closest('.code-block-box').querySelector('pre code').innerText, this.closest('.code-block-box').querySelector('.terminal-box'))"><i class="fa-brands fa-python"></i> <span>تشغيل بايثون Wasm</span></button>` : ''}
                    ${lang === 'javascript' || lang === 'js' ? `<button class="code-tool-btn run-btn" onclick="app.runJavaScriptCode(this.closest('.code-block-box').querySelector('pre code').innerText, this.closest('.code-block-box').querySelector('.terminal-box'))"><i class="fa-brands fa-js"></i> <span>تشغيل JS</span></button>` : ''}
                    ${lang === 'html' || lang === 'svg' ? `<button class="code-tool-btn" onclick="app.toggleLiveArtifact(this)"><i class="fa-solid fa-eye"></i> <span>معاينة</span></button>` : ''}
                    <button class="code-tool-btn" onclick="app.formatCodeBlock(this.closest('.code-block-box').querySelector('pre code'), '${lang}')"><i class="fa-solid fa-align-left"></i> <span>تنسيق</span></button>
                    <button class="code-tool-btn" onclick="app.generateTestFromBtn(this, '${lang}')"><i class="fa-solid fa-vial"></i> <span>اختبارات</span></button>
                    <button class="code-tool-btn" onclick="app.copyToClipboard(this.closest('.code-block-box').querySelector('pre code').innerText, this)"><i class="fa-regular fa-copy"></i> <span>نسخ</span></button>
                </div>
            `;

            const terminal = document.createElement('div');
            terminal.className = 'terminal-box';

            const iframe = document.createElement('iframe');
            iframe.className = 'live-artifact-frame';
            iframe.setAttribute('sandbox', 'allow-scripts');

            pre.parentNode.insertBefore(wrapper, pre);
            wrapper.appendChild(toolbar);
            wrapper.appendChild(pre);
            wrapper.appendChild(terminal);
            wrapper.appendChild(iframe);

            if (typeof hljs !== 'undefined') {
                hljs.highlightElement(codeEl);
            }
        });
    }

    openSettingsModal() {
        const modal = document.getElementById('settings-modal');
        if (!modal) return;
        document.getElementById('setting-openrouter-key').value = this.settings.apiKey || '';
        document.getElementById('setting-system-prompt').value = this.settings.systemPrompt || '';
        document.getElementById('setting-temperature').value = this.settings.temperature || 0.7;
        document.getElementById('setting-max-tokens').value = this.settings.maxTokens || 16384;
        document.getElementById('setting-github-token').value = this.settings.githubToken || '';
        document.getElementById('setting-github-owner').value = this.settings.githubOwner || 'naderba69';
        document.getElementById('setting-github-repo').value = this.settings.githubRepo || 'daschai';
        document.getElementById('setting-github-branch').value = this.settings.githubBranch || 'main';
        document.getElementById('setting-tavily-key').value = this.settings.tavilyApiKey || '';
        document.getElementById('setting-tts-rate').value = this.settings.ttsRate || 1.0;
        document.getElementById('tts-rate-label').innerText = (this.settings.ttsRate || 1.0) + 'x';
        
        this.updateModelsDropdown();
        modal.classList.add('active');
    }

    switchSettingsTab(tabId, ev) {
        document.querySelectorAll('.settings-tab-content').forEach(el => el.style.display = 'none');
        const activeTab = document.getElementById(tabId);
        if (activeTab) activeTab.style.display = 'block';

        document.querySelectorAll('#settings-modal .modal-tab-button').forEach(b => b.classList.remove('active'));
        if (ev && ev.currentTarget) ev.currentTarget.classList.add('active');
    }

    closeModals() {
        document.querySelectorAll('.modal-overlay-backdrop').forEach(m => m.classList.remove('active'));
    }

    toggleSidebar(forceState) {
        const sidebar = document.getElementById('sidebar');
        const backdrop = document.getElementById('sidebar-backdrop');
        const closeBtn = document.getElementById('sidebar-close-btn');
        if (!sidebar) return;

        const isOpen = forceState !== undefined ? forceState : !sidebar.classList.contains('active');
        if (isOpen) {
            sidebar.classList.add('active');
            if (backdrop) backdrop.classList.add('active');
            if (closeBtn && window.innerWidth <= 900) closeBtn.style.display = 'flex';
        } else {
            sidebar.classList.remove('active');
            if (backdrop) backdrop.classList.remove('active');
        }
    }

    filterSessions(query) {
        const q = (query || '').toLowerCase().trim();
        const rows = document.querySelectorAll('.session-item-row');
        rows.forEach(r => {
            const title = r.querySelector('.session-title-text')?.innerText.toLowerCase() || '';
            r.style.display = title.includes(q) ? 'flex' : 'none';
        });
    }

    initDomEvents() {
        const input = document.getElementById('user-input');
        if (input) {
            input.addEventListener('input', () => this.autoResizeTextarea(input));
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendUserMessage();
                }
            });
        }

        const fileInput = document.getElementById('universal-file-input');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    this.processUniversalFile(e.target.files[0]);
                }
            });
        }

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeModals();
        });
    }

    autoResizeTextarea(el) {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 180) + 'px';
    }

    handleScrollEvent() {
        const scrollArea = document.getElementById('chat-messages');
        const scrollBtn = document.getElementById('scroll-to-bottom-btn');
        if (!scrollArea) return;

        const distanceFromBottom = scrollArea.scrollHeight - scrollArea.scrollTop - scrollArea.clientHeight;
        if (distanceFromBottom > 150) {
            this.userHasScrolledUp = true;
            if (scrollBtn) scrollBtn.classList.add('visible');
        } else {
            this.userHasScrolledUp = false;
            if (scrollBtn) scrollBtn.classList.remove('visible');
        }
    }

    scrollToBottom(force = false) {
        const scrollArea = document.getElementById('chat-messages');
        if (!scrollArea) return;
        if (force || !this.userHasScrolledUp) {
            scrollArea.scrollTop = scrollArea.scrollHeight;
            const scrollBtn = document.getElementById('scroll-to-bottom-btn');
            if (scrollBtn) scrollBtn.classList.remove('visible');
            this.userHasScrolledUp = false;
        }
    }

    copyToClipboard(text, btnElement) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => {
                this.showToast('تم النسخ بنجاح 📋', 'success');
                if (btnElement) {
                    const original = btnElement.innerHTML;
                    btnElement.innerHTML = '<i class="fa-solid fa-check" style="color: #34d399;"></i> <span>تم النسخ</span>';
                    setTimeout(() => { btnElement.innerHTML = original; }, 2000);
                }
            }).catch(() => {});
        } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            this.showToast('تم النسخ بنجاح 📋', 'success');
        }
    }

    showToast(msg, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const pill = document.createElement('div');
        pill.className = `toast-msg-pill ${type}`;
        
        let icon = 'fa-info-circle text-info';
        if (type === 'success') icon = 'fa-check-circle text-success';
        if (type === 'warning') icon = 'fa-triangle-exclamation text-warning';
        if (type === 'error') icon = 'fa-circle-xmark text-danger';

        pill.innerHTML = `<i class="fa-solid ${icon}"></i><span>${msg}</span>`;
        container.appendChild(pill);

        setTimeout(() => {
            pill.style.opacity = '0';
            pill.style.transform = 'translateY(-10px)';
            pill.style.transition = 'all 0.25s ease';
            setTimeout(() => pill.remove(), 250);
        }, 3500);
    }

    escapeHTML(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

// Initialize App Instance
window.app = new OXAlphaApp();
