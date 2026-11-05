
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/* ==========================================
   JAI'S BAYOU COMMAND CENTER
   Owner: Jai Davis
   Public Course Garden + Private Admin
========================================== */

const cfg = window.BAYOU_CONFIG || {};
const ready = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);

const sb = ready
    ? createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
    : null;

const app = document.querySelector('#app');

let session = null;
let owner = false;
const bayouPages = new Set(['home','catalog','publicCourse','resources','login','dashboard','courses','study','vault','planner','private','admin']);
function bayouInitialView() {
    const route = decodeURIComponent(location.hash.slice(1).split('?')[0]);
    return bayouPages.has(route) ? route : 'home';
}
let view = bayouInitialView();

let courses = [];
let resources = [];
let cards = [];
let questions = [];
let attempts = [];
let publicItems = [];
let publicCourses = [];
let studySessions = [];
let plannerMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let plannerSelectedDay = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-${String(new Date().getDate()).padStart(2,'0')}`;
let plannerEditingId = null;

let activeCourse = null;
let selectedPublicCourse = null;
let studyTab = 'overview';
let flashIndex = 0;
let flipped = false;
let quizIndex = 0;
let quizAnswers = {};
let quizDone = false;
let search = '';
let bayouGardenFilter = 'All';
let bayouResourceFilter = 'All';
// D658 pre-assessment is fetched from the owner-only Supabase question bank.
let d658ReviewIndex = 0;
let d658ReviewAnswers = {};
let d658ReviewDone = false;
let d658ReviewSaving = false;
const isD658PreAssessment = q => String(q.topic || '').startsWith('D658 Pre-Assessment |');
const d658ReviewQuestions = courseId => questions
    .filter(q => q.course_id === courseId && isD658PreAssessment(q))
    .sort((a,b) => Number((a.topic || '').match(/Q(\d+)/)?.[1] || 0) - Number((b.topic || '').match(/Q(\d+)/)?.[1] || 0));


/* ==========================================
   HELPERS
========================================== */

const esc = value =>
    String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));

const fmt = n => Number(n || 0).toLocaleString();

const pct = (a, b) =>
    b ? Math.round((a / b) * 100) : 0;

const $ = selector => document.querySelector(selector);

const button = (label, action, cls = 'btn') =>
    `<button class="${cls}" data-action="${action}">
        ${esc(label)}
    </button>`;

const clampProgress = value =>
    Math.min(100, Math.max(0, Number(value) || 0));

/* ==========================================
   OFFICIAL BAYOU STATUSES
   Database values remain spreadsheet-compatible
========================================== */

const statusOptions = [
    'Needs Evaluation',
    'Not Started',
    'In Progress',
    'Passed',
    'Transferred',
    'On Hold'
];

const bayouStatuses = {
    'Needs Evaluation': {
        name: '🌱 Seeds Awaiting',
        color: '#B99AD9',
        badge: '🌱 AWAITING THE BLOOM'
    },
    'Not Started': {
        name: '🪷 Lily Pad Locked',
        color: '#A9B5A7',
        badge: '🔒 QUEST LOCKED'
    },
    'In Progress': {
        name: '✨ Bayou in Bloom',
        color: '#FF9FCB',
        badge: '⚡ IN THE LAB'
    },
    'Passed': {
        name: '👑 Royal Bloom',
        color: '#78D6A2',
        badge: '✨ QUEST CLEARED'
    },
    'Transferred': {
        name: '🗝️ Golden Passage',
        color: '#E7C987',
        badge: '🔓 CREDIT UNLOCKED'
    },
    'On Hold': {
        name: '🌙 Moonlit Pause',
        color: '#82A6BE',
        badge: '🌙 QUEST PAUSED'
    }
};

const getBayouStatus = status =>
    bayouStatuses[status] || bayouStatuses['Not Started'];

const isDone = course =>
    ['Passed', 'Transferred'].includes(course.status);

const courseProgress = course =>
    isDone(course) ? 100 : clampProgress(course.progress);

const opt = (items, selected) =>
    items.map(value => `
        <option value="${esc(value)}"
            ${value === selected ? 'selected' : ''}>
            ${esc(getBayouStatus(value).name)}
        </option>
    `).join('');

const active = () =>
    courses.find(c => c.id === activeCourse) ||
    courses.find(c => c.code === 'D658') ||
    courses[0];

function progressStats(items) {
    const completed = items.filter(isDone);
    const earned = completed.reduce(
        (sum, c) => sum + Number(c.cu || 0), 0
    );
    const total = items.reduce(
        (sum, c) => sum + Number(c.cu || 0), 0
    );

    return {
        count: items.length,
        completed: completed.length,
        earned,
        total,
        percent: pct(earned, total)
    };
}

/* ==========================================
   SUPABASE DATA
========================================== */

async function load() {
    if (!ready) {
        render();
        return;
    }

    try {
        const { data, error } = await sb.auth.getSession();
        if (error) throw error;

        session = data.session;
        owner = false;

        if (session) {
            const result = await sb
                .from('owner_accounts')
                .select('user_id')
                .eq('user_id', session.user.id)
                .maybeSingle();

            if (result.error) {
                console.error(result.error);
            }

            owner = !!result.data;
        }

        await loadPublic();

        if (owner) {
            await loadPrivate();
        }

    } catch (error) {
        console.error('Bayou loading error:', error);
    }

    render();
}

async function loadPublic() {
    if (!ready) return;

    const [resourceResult, courseResult] = await Promise.all([
        sb.from('public_resources')
            .select('*')
            .eq('published', true)
            .order('created_at', { ascending: false }),

        sb.from('course_showcase')
            .select('title,code,cu,domain,status,progress')
            .order('title')
    ]);

    if (resourceResult.error) {
        console.error(
            'Public resource error:',
            resourceResult.error.message
        );
    }

    if (courseResult.error) {
        console.error(
            'Public course error:',
            courseResult.error.message
        );
    }

    publicItems = resourceResult.data || [];
    publicCourses = courseResult.data || [];
}

async function loadPrivate() {
    if (!owner) return;

    const tables = [
        'courses',
        'resources',
        'flashcards',
        'quiz_questions',
        'quiz_attempts',
        'study_sessions'
    ];

    const results = await Promise.all(
        tables.map(table =>
            sb.from(table)
                .select('*')
                .order('created_at', { ascending: true })
        )
    );

    results.forEach((result, index) => {
        if (result.error) {
            console.error(tables[index], result.error);
        }
    });

    [
        courses,
        resources,
        cards,
        questions,
        attempts,
        studySessions
    ] = results.map(result => result.data || []);
}

/* ==========================================
   NAVIGATION
========================================== */

function nav() {
    document.querySelectorAll('#nav button').forEach(b => {
        const selected =
            b.dataset.view === view ||
            (b.dataset.view === 'catalog' &&
                view === 'publicCourse');

        b.classList.toggle('active', selected);
    });

    const loginLink = $('#loginLink');

    if (loginLink) {
        loginLink.textContent = owner
            ? '👑 My Command Center'
            : '🔐 Private Entrance';
    }
}

function render() {
    // Keep the address bar in sync so refresh restores the current page.
    // replaceState avoids a duplicate browser-history entry on every render.
    if (bayouPages.has(view) && location.hash !== '#' + view) {
        history.replaceState(null, '', '#' + view);
    }
    nav();

    if (view === 'home') return home();
    if (view === 'catalog') return courseGarden();
    if (view === 'publicCourse') return publicCourseDetail();
    if (view === 'resources') return publicPage();
    if (view === 'login') return loginPage();

    if (!owner) {
        view = 'login';
        return loginPage();
    }

    if (view === 'dashboard') return dashboard();
    if (view === 'courses') return coursePage();
    if (view === 'study') return studyPage();
    if (view === 'vault') return vaultPage();
    if (view === 'planner') return plannerPage();
    if (view === 'private') return privatePage();
    if (view === 'admin') return adminPage();

    view = 'home';
    home();
}

/* ==========================================
   PUBLIC HOME
========================================== */

function home() {
    const stats = progressStats(publicCourses);

    app.innerHTML = `
        <section class="hero">
            <div class="eyebrow">
                ✦ Jai Davis · WGU Academic Journey ✦
            </div>

            <h1>
                Big dreams bloom
                <em>in the bayou.</em>
            </h1>

            <p>
                Welcome to Jai's Bayou Command Center!
                Follow my WGU journey, explore my course
                progress, and discover the study resources
                I'm sharing along the way.
            </p>

            ${button('🪷 Explore My Course Garden', 'catalog')}

            ${button(
                '📚 Study Resources',
                'resources',
                'btn secondary'
            )}
        </section>

        <div class="sectionhead">
            <div>
                <div class="eyebrow">
                    ✨ Growing toward my dreams
                </div>
                <h2>My WGU Journey</h2>
            </div>
        </div>

        ${publicCourses.length ? `
            <div class="stats">
                <div class="card stat">
                    <strong>${stats.count}</strong>
                    <small>Total Courses</small>
                </div>

                <div class="card stat">
                    <strong>${stats.completed}</strong>
                    <small>Completed Courses</small>
                </div>

                <div class="card stat">
                    <strong>${stats.earned}/${stats.total}</strong>
                    <small>Credit Units</small>
                </div>

                <div class="card stat">
                    <strong>${stats.percent}%</strong>
                    <small>Overall Progress</small>
                </div>
            </div>

            <div class="card" style="margin-top:18px">
                <h3>👑 My Royal Progress</h3>

                <div class="bar">
                    <i style="width:${stats.percent}%"></i>
                </div>

                <p class="small muted">
                    Student-maintained progress, not an official
                    WGU transcript or degree audit.
                </p>
            </div>
        ` : `
            <div class="notice">
                My course garden is being planted.
                Progress will appear here soon! 🌱
            </div>
        `}

        <div class="sectionhead">
            <h2>🪷 Explore the Bayou</h2>
        </div>

        <div class="grid">
            <div class="card">
                <div class="icon">🪷</div>
                <h3>The Course Garden</h3>
                <p>
                    Browse my WGU courses, completion
                    percentages, and colorful Bayou statuses.
                </p>
                ${button('View Courses', 'catalog')}
            </div>

            <div class="card">
                <div class="icon">📚</div>
                <h3>The Study Lounge</h3>
                <p>
                    Explore published study guides,
                    mnemonics, and learning resources.
                </p>
                ${button('Explore Resources', 'resources')}
            </div>

            <div class="card">
                <div class="icon">💗</div>
                <h3>Meet Jai Davis</h3>
                <p>
                    One course, one milestone, and one
                    beautiful dream at a time.
                </p>
                <span class="pill">WGU Student</span>
            </div>
        </div>
    `;
}

/* ==========================================
   PUBLIC COURSE GARDEN
========================================== */

function courseGarden() {
    const stats = progressStats(publicCourses);
    const visibleCourses = bayouGardenFilter === 'All' ? publicCourses : publicCourses.filter(c => c.status === bayouGardenFilter);

    app.innerHTML = `
        <div class="eyebrow">
            ✨ Jai Davis · WGU Course Garden
        </div>

        <h2>🪷 The Bayou Course Garden</h2>

        <p class="muted">
            Every course is another lily pad on my journey.
            Explore my progress and click any course to
            view its published study resources!
        </p>

        <div class="stats">
            <div class="card stat">
                <strong>${stats.count}</strong>
                <small>Total Courses</small>
            </div>

            <div class="card stat">
                <strong>${stats.completed}</strong>
                <small>Completed Courses</small>
            </div>

            <div class="card stat">
                <strong>${stats.earned}/${stats.total}</strong>
                <small>Credit Units Earned</small>
            </div>

            <div class="card stat">
                <strong>${stats.percent}%</strong>
                <small>Degree Progress</small>
            </div>
        </div>

        <div class="card" style="margin:20px 0">
            <h3>👑 My Royal Progress</h3>

            <div class="bar">
                <i style="width:${stats.percent}%"></i>
            </div>
        </div>

        <div class="status-legend" aria-label="Filter courses by status">
            <button class="legend-item" data-garden-filter="All" aria-pressed="${bayouGardenFilter === 'All'}" style="border-color:${bayouGardenFilter === 'All' ? '#FF9FCB' : 'var(--line)'}">✨ All Courses</button>
            ${statusOptions.map(status => {
                const b = getBayouStatus(status);

                return `
                    <button class="legend-item" data-garden-filter="${esc(status)}" aria-pressed="${bayouGardenFilter === status}" style="border-color:${b.color};${bayouGardenFilter === status ? 'box-shadow:0 0 0 2px '+b.color+';font-weight:800;' : ''}cursor:pointer">
                        ${esc(b.name)}
                    </button>
                `;
            }).join('')}
        </div>

        <div class="bayou-course-grid">
            ${visibleCourses.map(courseTile).join('') || `
                <div class="card empty">
                    🌱 My course garden is waiting to bloom!
                    No courses match this filter. Try All Courses.
                </div>
            `}
        </div>

        <p class="small muted" style="margin-top:22px">
            Course statuses and progress are maintained by
            Jai Davis and may change as records are updated.
        </p>
    `;
}

function courseTile(course) {
    const status = getBayouStatus(course.status);
    const progress = courseProgress(course);

    return `
        <button
            class="bayou-course-tile"
            data-public-course="${esc(course.code || course.title)}"
            style="--tile-color:${status.color}"
        >
            <span class="bayou-status">
                ${esc(status.name)}
            </span>

            <span class="eyebrow">
                ${esc(course.code || 'WGU Course')}
            </span>

            <h3>${esc(course.title)}</h3>

            <span class="mission-badge">
                ${esc(status.badge)}
            </span>

            <div class="tile-bottom">
                <span>${Number(course.cu || 0)} CUs</span>
                <strong>${progress}%</strong>
            </div>

            <div class="bar">
                <i style="width:${progress}%"></i>
            </div>

            <span class="tile-open">
                Explore Course Resources →
            </span>
        </button>
    `;
}

/* ==========================================
   PUBLIC COURSE DETAIL
========================================== */

function resourceCards(items) {
    return `
        <div class="grid">
            ${items.map(resource => `
                <article class="card">
                    <span class="pill">
                        ${esc(resource.course_code || 'WGU')}
                        ·
                        ${esc(resource.kind || 'Study Resource')}
                    </span>

                    <h3>${resource.url ? `<a href="${esc(resource.url)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;text-decoration-color:#f58ec4;text-underline-offset:4px" title="Open resource in a new tab">${esc(resource.title)} ↗</a>` : esc(resource.title)}</h3>

                    <p>${esc(resource.description || '')}</p>

                    ${resource.url ? `
                        <a href="${esc(resource.url)}"
                            target="_blank"
                            rel="noopener noreferrer">
                            Open Resource ↗
                        </a>
                    ` : ''}

                    ${resource.body ? `
                        <details>
                            <summary>Read Study Guide</summary>
                            <p style="white-space:pre-wrap">
                                ${esc(resource.body)}
                            </p>
                        </details>
                    ` : ''}
                </article>
            `).join('') || `
                <div class="card empty">
                    No public resources have been published
                    for this course yet. ✨
                </div>
            `}
        </div>
    `;
}


/* Public D658 memory tricks — created from Jai's supplied memory tool. */
const bayouD658Mnemonics = [["🎯", "Learning Objectives", "C-B-C", "Condition • Behavior • Criterion"], ["🧠", "Bloom’s Taxonomy", "R-U-A-A-E-C", "Remember • Understand • Apply • Analyze • Evaluate • Create"], ["🔁", "Behaviorism", "A-R-R", "Action • Reinforcement • Repeat"], ["🧩", "Constructivism", "B-B-B", "Build knowledge based on experiences by exploring"], ["👀", "Social Learning", "W-M-L", "Watch • Model • Learn"], ["🪜", "Scaffolding", "I DO → WE DO → YOU DO", "Gradually remove teacher support"], ["📖", "Direct vs. Indirect", "TELL & SHOW / GUIDE & DISCOVER", "Teacher-led vs. student exploration"], ["📝", "Formative vs. Summative", "CHECK ALONG / CHECK AT END", "Monitor learning vs. evaluate mastery"], ["📊", "Assessment Data", "C-A-A", "Collect • Analyze • Adjust"], ["🌸", "Differentiation", "C-P-P-E", "Content • Process • Product • Environment"], ["🔑", "Accommodations vs. Modifications", "HOW VS. WHAT", "Change access vs. change expectations"], ["🌱", "Zone of Proximal Development", "CAN DO + HELP = CAN GROW", "Support tasks just beyond independent ability"]];
function bayouPublicMemoryTricks() {
    return `<section class="card" style="margin:22px 0;background:#1C1519;color:#FFF6F9;border:2px solid #F5A4C9">
        <div class="eyebrow" style="color:#F5A4C9">D658 · OA Study Strategies</div>
        <h2 style="color:#FFFFFF">💗 D658 Memory Tricks</h2>
        <p style="color:#F0D9DD">Pink, brown & black study mnemonics · connect each memory trick to a classroom scenario.</p>

        <div class="grid two" style="margin-top:16px">
        ${bayouD658Mnemonics.map(([icon,topic,trick,meaning]) => `<article style="padding:16px;border:1px solid #8C5A69;border-radius:14px;background:#332329">
            <div style="color:#F5A4C9;font-weight:700">${icon} ${esc(topic)}</div>
            <h3 style="color:#FFFFFF;margin:8px 0">${esc(trick)}</h3>
            <p style="color:#EEDCE0;margin:0">${esc(meaning)}</p>
        </article>`).join('')}
        </div><p style="color:#EEDCE0;font-size:.9em">Personal study aids; not official WGU materials.</p>
    </section>`;
}

function publicCourseDetail() {
    const course = publicCourses.find(c =>
        (c.code || c.title) === selectedPublicCourse
    );

    if (!course) {
        view = 'catalog';
        return courseGarden();
    }

    const status = getBayouStatus(course.status);
    const progress = courseProgress(course);

    const matching = publicItems.filter(resource =>
        String(resource.course_code || '')
            .trim().toLowerCase() ===
        String(course.code || '')
            .trim().toLowerCase()
    );

    app.innerHTML = `
        ${button(
            '← Back to Course Garden',
            'catalog',
            'btn secondary'
        )}

        <div class="card"
            style="margin-top:20px;
            border-color:${status.color}">

            <div class="eyebrow">
                ${esc(course.code || 'WGU Course')}
            </div>

            <h2>${esc(course.title)}</h2>

            <p>${esc(status.name)}</p>

            <span class="mission-badge">
                ${esc(status.badge)}
            </span>

            <p class="muted">
                ${esc(course.domain || 'WGU Coursework')}
                · ${Number(course.cu || 0)} Credit Units
            </p>

            <h3>${progress}% Complete</h3>

            <div class="bar">
                <i style="width:${progress}%"></i>
            </div>
        </div>

        <div class="sectionhead">
            <h2>📚 Course Study Resources</h2>
        </div>

        ${String(course.code || '').toUpperCase() === 'D658' ? bayouPublicMemoryTricks() : ''}
        ${resourceCards(matching)}

        <p class="small muted" style="margin-top:20px">
            Only resources intentionally published by
            Jai Davis appear here.
        </p>
    `;
}

function publicPage() {
    const kinds = [...new Set(publicItems.map(r => String(r.kind || 'Study Resource').trim()).filter(Boolean))].sort();
    const shown = bayouResourceFilter === 'All' ? publicItems : publicItems.filter(r => String(r.kind || 'Study Resource').trim() === bayouResourceFilter);
    app.innerHTML = `
        <div class="eyebrow">
            ✨ Jai Davis · Open Study Collection
        </div>

        <h2>📚 The Bayou Study Lounge</h2>

        <p class="muted">
            Welcome! Browse the study resources I've
            chosen to share publicly.
        </p>

        ${!ready ? `
            <div class="notice">
                Connect Supabase to display resources.
            </div>
        ` : ''}

        <div class="status-legend" aria-label="Filter resources by type" style="margin:16px 0">
            <button class="legend-item" data-resource-filter="All" aria-pressed="${bayouResourceFilter === 'All'}">✨ All Resources</button>
            ${kinds.map(k => `<button class="legend-item" data-resource-filter="${esc(k)}" aria-pressed="${bayouResourceFilter === k}">${esc(k)}</button>`).join('')}
        </div>
        ${bayouPublicMemoryTricks()}
        ${resourceCards(shown)}
    `;
}

/* ==========================================
   PRIVATE LOGIN
========================================== */

function loginPage() {
    if (owner) {
        app.innerHTML = `
            <div class="narrow card">
                <div class="eyebrow">
                    👑 Private Access Verified
                </div>

                <h2>Welcome back, Jai! 💗</h2>

                <p class="muted">
                    Your Royal Command Center is ready.
                </p>

                ${button('Open Dashboard', 'dashboard')}
                ${button('Sign Out', 'logout', 'btn secondary')}
            </div>
        `;
        return;
    }

    app.innerHTML = `
        <div class="narrow card">
            <div class="eyebrow">
                🔐 Private Bayou Entrance
            </div>

            <h2>Jai's Royal Command Center</h2>

            <p class="muted">
                Authorized owner access only.
            </p>

            ${!ready ? `
                <div class="notice">
                    Configure Supabase in config.js
                    before signing in.
                </div>
            ` : ''}

            <form id="loginForm">
                <div class="field">
                    <label>Email</label>
                    <input name="email" type="email"
                        required autocomplete="email">
                </div>

                <div class="field">
                    <label>Password</label>
                    <input name="password" type="password"
                        required autocomplete="current-password">
                </div>

                <button class="btn"
                    ${!ready ? 'disabled' : ''}>
                    Unlock My Command Center
                </button>
            </form>

            <p id="authMsg" class="muted small"></p>
        </div>
    `;
}

/* ==========================================
   PRIVATE ADMIN SHELL
========================================== */

function shell(title, content) {
    const pages = [
        ['dashboard', '👑 Dashboard'],
        ['courses', '🪷 Course Console'],
        ['study', '📚 Study Studio'],
        ['vault', '✨ Resource Vault'],
        ['planner', '🌙 Study Planner'],
        ['private', '🔐 Private Plans'],
        ['admin', '⚙ Admin HQ']
    ];

    app.innerHTML = `
        <div class="layout">
            <aside class="card sidebar">
                ${pages.map(([page, label]) => `
                    <button data-view="${page}"
                        class="${view === page ? 'active' : ''}">
                        ${label}
                    </button>
                `).join('')}

                <hr style="border:0;
                    border-top:1px solid var(--line)">

                <button data-action="logout">
                    ⇥ Sign Out
                </button>
            </aside>

            <section>
                <div class="eyebrow">
                    Jai Davis · Private Bayou
                </div>

                <h2>${esc(title)}</h2>

                ${content}
            </section>
        </div>
    `;
}

/* ==========================================
   PRIVATE DASHBOARD
========================================== */

/* ==========================================
   🏆 ROYAL STUDY REWARDS
   Computed from saved quiz_attempts (no new tables).
========================================== */
const bayouRewardCatalog = [
    { id: 'first', icon: '🪷', title: 'First Bloom', description: 'Complete your first practice attempt.', goal: 1, metric: 'attempts' },
    { id: 'fire', icon: '🔥', title: 'Bayou on Fire', description: 'Complete 5 practice attempts.', goal: 5, metric: 'attempts' },
    { id: 'knowledge', icon: '🧠', title: 'Knowledge Royalty', description: 'Score at least 80% on an assessment.', goal: 1, metric: 'highScores' },
    { id: 'mock', icon: '👑', title: 'Mock OA Queen', description: 'Complete your first tracked Mock OA.', goal: 1, metric: 'mockOAs' },
    { id: 'perfect', icon: '💎', title: 'Royal Perfection', description: 'Earn 100% on an assessment.', goal: 1, metric: 'perfectScores' },
    { id: 'scholar', icon: '🌸', title: 'Study Scholar', description: 'Complete 10 practice attempts.', goal: 10, metric: 'attempts' }
];

function bayouStudyRewards(savedAttempts = attempts) {
    const valid = savedAttempts.filter(a => Number(a.total) > 0);
    const metrics = {
        attempts: valid.length,
        highScores: valid.filter(a => Number(a.score) / Number(a.total) >= 0.8).length,
        perfectScores: valid.filter(a => Number(a.score) === Number(a.total)).length,
        mockOAs: valid.filter(a =>
            a.answers && typeof a.answers === 'object' &&
            ['timed', 'untimed'].includes(a.answers.__bayouExamType)
        ).length
    };
    return bayouRewardCatalog.map(reward => {
        const count = metrics[reward.metric] || 0;
        return { ...reward, count, unlocked: count >= reward.goal,
            percent: Math.min(100, pct(count, reward.goal)) };
    });
}

function bayouRewardCard(reward, compact = false) {
    return `<div class="card" style="border-color:${reward.unlocked ? '#E7C987' : 'var(--line)'};opacity:${reward.unlocked ? '1' : '.78'};${compact ? 'padding:14px' : ''}">
        <div style="font-size:${compact ? '26px' : '34px'}">${reward.unlocked ? reward.icon : '🔒'}</div>
        <h3 style="margin:8px 0">${esc(reward.title)}</h3>
        ${compact ? '' : `<p class="small muted">${esc(reward.description)}</p>`}
        <span class="pill">${reward.unlocked ? '✨ Unlocked' : `${Math.min(reward.count, reward.goal)}/${reward.goal} progress`}</span>
        ${reward.unlocked ? '' : `<div class="bar" style="margin-top:12px"><i style="width:${reward.percent}%"></i></div>`}
    </div>`;
}


/* ==========================================
   PHASE 12 — ROYAL DEGREE MILESTONES
========================================== */
function royalMilestones() {
    const stats = progressStats(courses);
    const milestones = [25, 50, 75, 100].map((level, index) => {
        const target = Math.ceil(stats.total * level / 100);
        return {level, target, unlocked: stats.total > 0 && stats.earned >= target,
            icon: ['🌸','🪷','👑','🏰'][index],
            name: ['First Bloom','Bayou Blossoms','Royal Crown','Degree Royalty'][index]};
    });
    const next = milestones.find(m => !m.unlocked);
    return {stats, milestones, next};
}
function royalAchievementPanel() {
    const {stats, milestones, next} = royalMilestones();
    const finished = courses.filter(isDone);
    const history = [...finished].sort((a,b) => {
        const ad = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const bd = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        return bd - ad;
    });
    return `
        <div class="card" style="margin:20px 0;border-color:#e7c987">
            <div class="row" style="flex-wrap:wrap;gap:12px">
                <div><div class="eyebrow">👑 Phase 12 · Degree Achievements</div><h3>Royal Bayou Milestones</h3></div>
                <span class="pill">${stats.earned}/${stats.total} CUs earned</span>
            </div>
            <div class="grid" style="margin:14px 0">
                ${milestones.map(m => `<div class="card" style="text-align:center;opacity:${m.unlocked ? '1' : '.65'}">
                    <div style="font-size:32px">${m.unlocked ? m.icon : '🔒'}</div>
                    <strong>${m.level}% · ${esc(m.name)}</strong>
                    <p class="small muted">${m.target} CUs · ${m.unlocked ? '✨ Unlocked!' : 'Not yet unlocked'}</p>
                </div>`).join('')}
            </div>
            <h3>✨ Next Milestone</h3>
            <p>${!stats.total ? 'Add your program courses and credit units to begin.' : next ? `<strong>${Math.max(0,next.target-stats.earned)} more CUs</strong> until ${next.level}% — ${esc(next.name)}!` : '🏆 All four degree milestones unlocked!'}</p>
            <div class="bar"><i style="width:${stats.percent}%"></i></div>
        </div>
        <div class="card" style="margin:20px 0;border-color:var(--pink)">
            <div class="eyebrow">🪷 Every completed course makes the garden grow</div>
            <h3>Bayou Achievement Garden</h3>
            <div style="display:flex;flex-wrap:wrap;gap:10px;margin:18px 0;font-size:30px;line-height:1.5" aria-label="${finished.length} completed courses">
                ${finished.length ? finished.map((c,i) => `<span title="${esc(c.code || c.title)}" aria-label="${esc(c.title)}">${['🌸','🪷','🌺','🌷','🌼'][i%5]}</span>`).join('') : '<span class="muted small">Your first flower blooms when a course is Passed or Transferred. 🌱</span>'}
            </div>
            <p class="small muted">${finished.length} flowers grown · One for each Passed or Transferred course. Changes automatically with your Course Console.</p>
        </div>
        <div class="card" style="margin:20px 0">
            <h3>📚 Course Completion History</h3>
            <p class="small muted">Completion dates are saved when you mark a course Passed or Transferred. For older completions, use Edit to enter the real date.</p>
            ${history.length ? `<div class="tablewrap"><table><thead><tr><th>Course</th><th>Code</th><th>CUs</th><th>Completion date</th></tr></thead><tbody>
                ${history.map(c => `<tr><td>${esc(c.title)}</td><td>${esc(c.code)}</td><td>${fmt(c.cu)}</td><td>${c.completed_at ? esc(String(c.completed_at).slice(0,10)) : 'Date not recorded'}</td></tr>`).join('')}
            </tbody></table></div>` : '<p class="muted">No completed courses recorded yet.</p>'}
        </div>`;
}

function dashboard() {
    const stats = progressStats(courses);
    const rewards = bayouStudyRewards();
    const unlockedRewards = rewards.filter(r => r.unlocked);
    
    const remainingCU = stats.total - stats.earned;

    const awaitingCU = courses
        .filter(c => c.status === 'Needs Evaluation')
        .reduce((sum, c) => sum + Number(c.cu || 0), 0);


    const last = attempts.length
        ? attempts[attempts.length - 1]
        : null;

    shell('Your Royal Bayou Dashboard', `
        <p class="muted">
            Welcome back, Jai! Your dreams are worth the work. 💗
        </p>

        <div class="stats">
            <div class="card stat">
                <strong>${stats.completed}</strong>
                <small>Completed Courses</small>
            </div>

            <div class="card stat">
                <strong>${stats.earned}</strong>
                <small>CUs Earned</small>
            </div>

            <div class="card stat">
                <strong>${stats.count - stats.completed}</strong>
                <small>Courses Remaining</small>
            </div>

            <div class="card stat">
                <strong>${stats.percent}%</strong>
                <small>Degree Progress</small>
            </div>
        </div>

        
        <div class="stats" style="margin-top:16px">
            <div class="card stat">
                <strong>${remainingCU}</strong>
                <small>🪷 CUs Remaining</small>
            </div>

            <div class="card stat">
                <strong>${awaitingCU}</strong>
                <small>🌱 CUs Awaiting Evaluation</small>
            </div>

            <div class="card stat">
                <strong>${stats.total}</strong>
                <small>👑 Total Program CUs Tracked</small>
            </div>
        </div>

        <div class="card" style="margin-top:16px">
            <div class="row">
                <h3>👑 Royal Degree Progress</h3>
                <span class="pill">
                    ${stats.earned}/${stats.total} CUs
                </span>
            </div>

            <div class="bar">
                <i style="width:${stats.percent}%"></i>
            </div>

            <p class="small muted">
                Based on your course tracker.
                Verify official credits with WGU.
            </p>
        </div>

        <div class="card" style="margin-top:16px;border-color:#E7C987">
            <div class="row" style="gap:12px;flex-wrap:wrap">
                <div><div class="eyebrow">✨ Your Study Milestones</div><h3>🏆 Royal Trophy Case</h3></div>
                <span class="pill">${unlockedRewards.length}/${rewards.length} Badges Unlocked</span>
            </div>
            <div class="grid" style="margin:14px 0">
                ${(unlockedRewards.length ? [...unlockedRewards].reverse().slice(0, 3) : rewards.slice(0, 3))
                    .map(r => bayouRewardCard(r, true)).join('')}
            </div>
            <p class="small muted">${unlockedRewards.length ? 'Your hard work is blooming! 💗' : 'Your first badge unlocks after your first saved practice attempt.'}</p>
            ${button('👑 View All Achievements', 'studyRewards')}
        </div>

        <div class="grid two" style="margin-top:16px">
            <div class="card">
                <span class="eyebrow">Priority Course</span>

                <h3>D658 · Meaningful Learning</h3>

                <p>
                    Study theories, assessment strategies,
                    differentiation, and OA retake topics.
                </p>

                ${button('Open Study Studio', 'study')}
            </div>

            <div class="card">
                <span class="eyebrow">Recent Practice</span>

                <h3>
                    ${last
                        ? `${last.score}/${last.total}`
                        : 'No Recorded Quiz'}
                </h3>

                <p>
                    Review practice history and revisit
                    difficult concepts.
                </p>

                ${button(
                    'Practice Now',
                    'study',
                    'btn secondary'
                )}
            </div>
        </div>
    `);
}

/* ==========================================
   PRIVATE COURSE CONSOLE
========================================== */

function coursePage() {
    const stats = progressStats(courses);
    const remainingCourses = stats.count - stats.completed;
    const remainingCU = Math.max(0, stats.total - stats.earned);
    const statusCounts = statusOptions.map(status => ({
        status,
        count: courses.filter(course => course.status === status).length
    }));
    const filtered = courses.filter(c =>
        [c.title, c.code, c.domain]
            .join(' ')
            .toLowerCase()
            .includes(search.toLowerCase())
    );

    shell('🪷 Course Console', `
        <p class="muted">
            Manage your courses, Bayou statuses,
            and progress percentages.
            Changes update your public Course Garden.
        </p>

        <div class="card" style="margin:20px 0;border-color:var(--pink)">
            <div class="row" style="gap:12px;flex-wrap:wrap">
                <div>
                    <div class="eyebrow">👑 Live from your Course Console</div>
                    <h3>Royal Degree Progress</h3>
                </div>
                <span class="pill">${stats.percent}% Complete</span>
            </div>
            <div class="stats" style="margin:14px 0">
                <div class="card stat"><strong>${stats.completed}</strong><small>Completed Courses</small></div>
                <div class="card stat"><strong>${remainingCourses}</strong><small>Courses Remaining</small></div>
                <div class="card stat"><strong>${stats.earned}</strong><small>CUs Earned</small></div>
                <div class="card stat"><strong>${remainingCU}</strong><small>CUs Remaining</small></div>
            </div>
            <div class="row" style="gap:12px;flex-wrap:wrap">
                <strong>${stats.earned} / ${stats.total} CUs</strong>
                <span class="small muted">${stats.count} courses tracked</span>
            </div>
            <div class="bar" role="progressbar" aria-label="Degree credit progress" aria-valuenow="${stats.percent}" aria-valuemin="0" aria-valuemax="100" style="margin-top:10px">
                <i style="width:${stats.percent}%"></i>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:16px">
                ${statusCounts.map(({status,count}) => `<span class="pill">${esc(getBayouStatus(status).name)}: ${count}</span>`).join('')}
            </div>
            <p class="small muted" style="margin-top:12px">Updates automatically when you save a course. Passed and Transferred count toward earned CUs. This is your personal tracker, not an official WGU record.</p>
        </div>

        ${royalAchievementPanel()}

        <div class="row" style="margin:16px 0">
            <input id="courseSearch"
                placeholder="Search courses or codes…"
                value="${esc(search)}"
                style="max-width:400px">

            ${button('+ Add Course', 'addCourse')}
        </div>

        <div class="tablewrap">
            <table>
                <thead>
                    <tr>
                        <th>Course</th>
                        <th>Code</th>
                        <th>CUs</th>
                        <th>Bayou Status</th>
                        <th>Progress</th>
                        <th></th>
                    </tr>
                </thead>

                <tbody>
                    ${filtered.map(c => {
                        const status = getBayouStatus(c.status);
                        const progress = courseProgress(c);

                        return `
                            <tr>
                                <td>
                                    <button class="coursebutton"
                                        data-course="${esc(c.id)}">
                                        ${esc(c.title)}
                                    </button>

                                    <div class="muted small">
                                        ${esc(c.domain || '')}
                                    </div>

                                    <div class="small"
                                        style="color:${status.color}">
                                        ${esc(status.badge)}
                                    </div>
                                </td>

                                <td>${esc(c.code || '—')}</td>
                                <td>${fmt(c.cu)}</td>

                                <td>
                                    <select data-status="${esc(c.id)}">
                                        ${opt(statusOptions, c.status)}
                                    </select>
                                </td>

                                <td style="min-width:120px">
                                    <div class="bar">
                                        <i style="width:${progress}%"></i>
                                    </div>

                                    <span class="small muted">
                                        ${progress}%
                                    </span>
                                </td>

                                <td>
                                    <button class="linkbtn"
                                        data-editcourse="${esc(c.id)}">
                                        Edit
                                    </button>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>

        <div class="card" style="margin:22px 0;border-color:var(--pink)">
            <div class="row">
                <div>
                    <div class="eyebrow">Your Official Progress Guide</div>
                    <h3>🪷 Bayou Status Key</h3>
                </div>
                <span class="pill">6 Course Statuses</span>
            </div>

            <div class="bayou-status-key">

                <div class="bayou-key-item" style="--key-color:#B99AD9">
                    <span class="bayou-key-icon">🌱</span>
                    <div>
                        <strong>Seeds Awaiting</strong>
                        <p>Courses awaiting evaluation or confirmation.</p>
                        <small>Maps to: Needs Evaluation</small>
                    </div>
                </div>

                <div class="bayou-key-item" style="--key-color:#A9B5A7">
                    <span class="bayou-key-icon">🪷</span>
                    <div>
                        <strong>Lily Pad Locked</strong>
                        <p>Courses waiting for their turn in your journey.</p>
                        <small>Maps to: Not Started</small>
                    </div>
                </div>

                <div class="bayou-key-item" style="--key-color:#FF9FCB">
                    <span class="bayou-key-icon">✨</span>
                    <div>
                        <strong>Bayou in Bloom</strong>
                        <p>The course you're actively working on.</p>
                        <small>Maps to: In Progress</small>
                    </div>
                </div>

                <div class="bayou-key-item" style="--key-color:#78D6A2">
                    <span class="bayou-key-icon">👑</span>
                    <div>
                        <strong>Royal Bloom</strong>
                        <p>Courses you've successfully completed.</p>
                        <small>Maps to: Passed</small>
                    </div>
                </div>

                <div class="bayou-key-item" style="--key-color:#E7C987">
                    <span class="bayou-key-icon">🗝️</span>
                    <div>
                        <strong>Golden Passage</strong>
                        <p>Credits you've already earned through transfer.</p>
                        <small>Maps to: Transferred</small>
                    </div>
                </div>

                <div class="bayou-key-item" style="--key-color:#82A6BE">
                    <span class="bayou-key-icon">🌙</span>
                    <div>
                        <strong>Moonlit Pause</strong>
                        <p>Courses temporarily paused.</p>
                        <small>Maps to: On Hold</small>
                    </div>
                </div>

            </div>
        </div>
    `);
}

/* ==========================================
   PRIVATE STUDY STUDIO
========================================== */

let bayouQuizMode = 'standard';
let bayouQuizQuestionIds = [];

/* ==========================================
   👑 BAYOU MOCK OA EXAM SETTINGS
========================================== */

let bayouExamType = 'practice';
let bayouExamTimed = false;
let bayouExamMinutes = 60;
let bayouExamQuestionLimit = 25;
let bayouExamQuestionIds = [];
let bayouExamStarted = false;
let bayouExamDeadline = null;
let bayouExamTimer = null;
let bayouExamSaveFailed = false;

function bayouExamTimeRemaining() {
    if (!bayouExamDeadline) return 0;

    return Math.max(
        0,
        Math.ceil((bayouExamDeadline - Date.now()) / 1000)
    );
}


function bayouStartExamCountdown() {
    if (bayouExamTimer !== null) {
        clearInterval(bayouExamTimer);
    }

    if (!bayouExamStarted || !bayouExamTimed) return;

    bayouExamTimer = setInterval(async () => {
        if (!bayouExamStarted || quizDone) {
            clearInterval(bayouExamTimer);
            bayouExamTimer = null;
            return;
        }

        const remaining = bayouExamTimeRemaining();
        const display = document.querySelector('#bayouExamClock');

        if (display) {
            display.textContent = bayouFormatExamTime(remaining);
        }

        if (remaining <= 0) {
            clearInterval(bayouExamTimer);
            bayouExamTimer = null;

            try {
                await bayouSubmitMockOA();
            } catch (error) {
                console.error('Mock OA submission failed:', error);
                bayouExamSaveFailed = true;
                render();
                alert('Your answers are still here. Use Retry Save to save your Mock OA.');
            }
        }
    }, 1000);
}

function bayouFormatExamTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    return [hours, minutes, remainingSeconds]
        .map(value => String(value).padStart(2, '0'))
        .join(':');
}

function bayouResetExamSession() {
    if (bayouExamTimer !== null) {
        clearInterval(bayouExamTimer);
        bayouExamTimer = null;
    }

    bayouExamStarted = false;
    bayouExamSaveFailed = false;
    bayouExamDeadline = null;
    bayouExamTimed = false;

    quizIndex = 0;
    quizAnswers = {};
    quizDone = false;

    bayouQuizQuestionIds = [];
    bayouExamQuestionIds = [];
}


function bayouActiveQuestions(questionList) {
    if (bayouExamStarted) {
        return bayouExamQuestionIds
            .map(id => questionList.find(q => q.id === id))
            .filter(Boolean);
    }

    return bayouQuizQuestions(questionList);
}

function bayouShuffleQuestions(questionList) {
    const shuffled = [...questionList];

    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));

        [shuffled[i], shuffled[j]] =
            [shuffled[j], shuffled[i]];
    }

    return shuffled;
}

function bayouQuizQuestions(questionList) {
    if (bayouQuizMode !== 'random') {
        return questionList;
    }

    if (bayouQuizQuestionIds.length !== questionList.length ||
        !questionList.every(q => bayouQuizQuestionIds.includes(q.id))) {
        bayouQuizQuestionIds = bayouShuffleQuestions(questionList)
            .map(q => q.id);
    }

    return bayouQuizQuestionIds
        .map(id => questionList.find(q => q.id === id))
        .filter(Boolean);
}

/* ==========================================
   📊 BAYOU COMPETENCY PERFORMANCE
   Derived from saved answers; no new DB tables.
========================================== */
function bayouCompetencyStats(courseQuestions, courseAttempts) {
    const byId = new Map(courseQuestions.map(q => [String(q.id), q]));
    const topics = new Map();
    const topicFor = q => String(q.topic || '').trim() || 'Uncategorized';

    for (const q of courseQuestions) {
        const name = topicFor(q);
        if (!topics.has(name)) {
            topics.set(name, { name, available: 0, answered: 0, correct: 0 });
        }
        topics.get(name).available++;
    }

    for (const attempt of courseAttempts) {
        const answers = attempt.answers;
        if (!answers || typeof answers !== 'object' || Array.isArray(answers)) continue;
        for (const [id, answer] of Object.entries(answers)) {
            const q = byId.get(String(id));
            if (!q || answer === null || answer === undefined || answer === '') continue;
            const row = topics.get(topicFor(q));
            row.answered++;
            if (Number(answer) === Number(q.correct_index)) row.correct++;
        }
    }

    return [...topics.values()].map(row => ({
        ...row,
        accuracy: row.answered ? pct(row.correct, row.answered) : null
    })).sort((a, b) => {
        if (a.accuracy === null) return 1;
        if (b.accuracy === null) return -1;
        return a.accuracy - b.accuracy || a.name.localeCompare(b.name);
    });
}

function studyPage() {
    const c = active();

    if (!c) {
        shell('The Bayou Study Studio',
            '<div class="card empty">Add or import a course first.</div>');
        return;
    }

    const cc = cards.filter(x => x.course_id === c.id);
        const qq = bayouActiveQuestions(
        questions.filter(x => x.course_id === c.id && !isD658PreAssessment(x))
    );
    const aa = attempts.filter(x => x.course_id === c.id);
    const competencyStats = bayouCompetencyStats(
        questions.filter(x => x.course_id === c.id), aa
    );

    
    // ==========================================
    // BAYOU STUDY STUDIO 2.0 — LIVE STATISTICS
    // ==========================================

    const latestAttempt = aa.length
        ? [...aa].sort((a, b) =>
            new Date(b.created_at) - new Date(a.created_at)
        )[0]
        : null;

    const bestAttempt = aa.length
        ? Math.max(...aa.map(a => pct(a.score, a.total)))
        : null;

    const studyTopics = [
        ...new Set(
            qq.map(q => (q.topic || '').trim())
                .filter(Boolean)
        )
    ];

    const totalPracticeQuestions = qq.length;
    const totalFlashcards = cc.length;
    const totalAttempts = aa.length;

    const tabs = [
        ['overview', 'Overview'],
        ['flashcards', `Flashcards (${cc.length})`],
        ['quiz', `Practice Quiz (${qq.length})`],
        ...(c.code === 'D658' ? [['preassessment', `🔐 Pre-Assessment (${d658ReviewQuestions(c.id).length})`]] : []),
        ['mastery', '📊 Competencies'],
        ['rewards', '🏆 Achievements'],
        ['history', 'Attempt History']
    ];

    let body = `
        <div class="row" style="margin:14px 0">
            <select id="studyCourse" style="max-width:520px">
                ${courses.map(x => `
                    <option value="${esc(x.id)}"
                        ${x.id === c.id ? 'selected' : ''}>
                        ${esc(x.code ? x.code + ' · ' : '')}
                        ${esc(x.title)}
                    </option>
                `).join('')}
            </select>

            <span class="pill">
                ${esc(getBayouStatus(c.status).name)}
            </span>
        </div>

        <div class="tabs">
            ${tabs.map(([id, label]) => `
                <button data-tab="${id}"
                    class="${studyTab === id ? 'active' : ''}">
                    ${esc(label)}
                </button>
            `).join('')}
        </div>
    `;

    if (studyTab === 'overview') {
        
        body += `
            <div class="card" style="margin:18px 0;border-color:#FF9FCB">
                <div class="eyebrow">
                    ✨ Your Personal Learning Headquarters
                </div>

                <h3>💗 My Study Progress</h3>

                <p class="muted">
                    Live study statistics for
                    <strong>${esc(c.title)}</strong>
                </p>

                <div class="stats" style="margin-top:16px">
                    <div class="card stat">
                        <strong>${totalFlashcards}</strong>
                        <small>🧠 Flashcards</small>
                    </div>

                    <div class="card stat">
                        <strong>${totalPracticeQuestions}</strong>
                        <small>📝 Practice Questions</small>
                    </div>

                    <div class="card stat">
                        <strong>${totalAttempts}</strong>
                        <small>📚 Quiz Attempts</small>
                    </div>

                    <div class="card stat">
                        <strong>
                            ${bestAttempt === null
                                ? '—'
                                : bestAttempt + '%'}
                        </strong>
                        <small>👑 Best Quiz Score</small>
                    </div>
                </div>

                <div class="grid two" style="margin-top:16px">
                    <div>
                        <h4>🌸 Latest Practice</h4>
                        <p>
                            ${latestAttempt
                                ? `${latestAttempt.score}/${latestAttempt.total}
                                   (${pct(latestAttempt.score, latestAttempt.total)}%)`
                                : 'No practice attempts yet.'}
                        </p>
                    </div>

                    <div>
                        <h4>🪷 Competencies Being Studied</h4>
                        <p>
                            ${studyTopics.length
                                ? studyTopics.map(esc).join(' · ')
                                : 'Add topics to your practice questions to track them here.'}
                        </p>
                    </div>
                </div>
            </div>
        `;

        body += `
            <div class="grid two">
                <div class="card">
                    <div class="eyebrow">Private Course Notes</div>
                    <h3>${esc(c.title)}</h3>

                    <p style="white-space:pre-wrap">
                        ${esc(c.notes || 'No notes yet.')}
                    </p>
                </div>

                <div class="card">
                    <div class="eyebrow">Your Study Toolkit</div>
                    <h3>Build Your Mastery</h3>

                    <p>
                        Create flashcards, practice questions,
                        and track your improvement.
                    </p>

                    ${button('Add Flashcard', 'addFlash')}

                    ${button(
                        'Add Question',
                        'addQuestion',
                        'btn secondary'
                    )}
                </div>
            </div>
        `;

        if (c.code === 'D658') {
            body += `
                <div class="card" style="margin-top:16px">
                    <span class="eyebrow">
                        D658 · Study Reference
                    </span>

                    <h3>Three Competency Areas</h3>

                    <p>
                        <strong>Instructional Practices:</strong>
                        Learning theories, Bloom's taxonomy,
                        scaffolding, standards alignment.
                    </p>

                    <p>
                        <strong>Assessment:</strong>
                        Diagnostic, formative, summative,
                        feedback, and objective alignment.
                    </p>

                    <p>
                        <strong>Differentiation:</strong>
                        Content, process, product, environment,
                        accommodations, and ELL support.
                    </p>

                    <div class="notice">
                        Official OA attempts and retake
                        information stay private.
                    </div>
                </div>
            `;
        }
    }

    if (studyTab === 'flashcards') {
        if (!cc.length) {
            body += `
                <div class="card empty">
                    No flashcards for this course yet.

                    <p>
                        ${button('Create First Card', 'addFlash')}
                    </p>
                </div>
            `;
        } else {
            const card = cc[flashIndex % cc.length];

            body += `
                <div class="card">
                    <div class="row">
                        <span class="pill">
                            Card ${flashIndex % cc.length + 1}
                            / ${cc.length}
                        </span>

                        ${button(
                            '+ New Card',
                            'addFlash',
                            'btn secondary'
                        )}
                    </div>

                    <div class="flashcard"
                        data-action="flip"
                        style="margin:20px 0;cursor:pointer"
                        role="button"
                        tabindex="0">

                        ${esc(flipped ? card.back : card.front)}

                        <div class="small muted"
                            style="margin-top:18px">
                            Tap to flip
                        </div>
                    </div>

                    <div class="row">
                        ${button(
                            '← Previous',
                            'prevFlash',
                            'btn secondary'
                        )}

                        ${button('Next →', 'nextFlash')}
                    </div>
                </div>
            `;
        }
    }

    if (studyTab === 'quiz') {
        const isMock = bayouExamStarted;
        const isFinished = quizDone;
        const allAvailable = questions.filter(x => x.course_id === c.id && !isD658PreAssessment(x)).length;
        if (isMock && !isFinished) {
            body += `
                <div class="card" style="margin-bottom:16px;border:2px solid #E7C987;text-align:center">
                    <div class="eyebrow">👑 Royal Mock OA In Progress</div>
                    <h3>${bayouExamTimed ? '⏱️ Time Remaining' : '🌙 Untimed Assessment'}</h3>
                    ${bayouExamTimed ? `<div id="bayouExamClock" style="font-size:32px;font-weight:800;color:#FF9FCB;margin:12px 0">${bayouFormatExamTime(bayouExamTimeRemaining())}</div>` : '<p>Take your time, future educator! 💗</p>'}
                    <span class="pill">📝 ${qq.length} Exam Questions</span>
                    <p class="small muted">Your answers are revealed after submission.</p>
                    ${bayouExamSaveFailed ? `<div class="notice">⚠️ Your last save did not complete. Your answers are preserved.</div>${button('💾 Retry Save', 'retryMockOASave')}` : ''}
                </div>`;
        }
        if (!isMock || isFinished) {
            body += `
                <div class="card" style="margin-bottom:16px;border-color:#FF9FCB">
                    <div class="eyebrow">👑 Bayou Practice Exam Center</div>
                    <h3>🧠 Choose Your Practice Mode</h3>
                    <div class="row" style="gap:12px;flex-wrap:wrap">
                        <label><input type="radio" name="bayouMode" value="standard" ${bayouQuizMode === 'standard' ? 'checked' : ''}> 🪷 Standard Practice</label>
                        <label><input type="radio" name="bayouMode" value="random" ${bayouQuizMode === 'random' ? 'checked' : ''}> ✨ Randomized Practice</label>
                    </div>
                </div>
                <div class="card" style="margin-bottom:18px;border-color:#E7C987">
                    <div class="eyebrow">✨ Royal Assessment Preparation</div>
                    <h3>👑 Bayou Mock OA Center</h3>
                    <p class="muted">Practice with questions from your private course question bank. Not an official WGU assessment.</p>
                    <div class="grid two" style="margin-top:16px">
                        <div class="field"><label>Exam Experience</label>
                            <select id="bayouExamType">
                                <option value="practice" ${bayouExamType === 'practice' ? 'selected' : ''}>📚 Regular Practice</option>
                                <option value="untimed" ${bayouExamType === 'untimed' ? 'selected' : ''}>🌙 Untimed Mock OA</option>
                                <option value="timed" ${bayouExamType === 'timed' ? 'selected' : ''}>⏱️ Timed Mock OA</option>
                            </select>
                        </div>
                        <div class="field"><label>Number of Questions</label><input type="number" id="bayouExamQuestionLimit" min="1" max="${Math.max(1, allAvailable)}" value="${Math.min(bayouExamQuestionLimit, Math.max(1, allAvailable))}"></div>
                        <div class="field"><label>Time Limit (Minutes)</label><input type="number" id="bayouExamMinutes" min="1" max="240" value="${bayouExamMinutes}"></div>
                        <div class="field"><label>Questions Available</label><div class="pill">🧠 ${allAvailable} Questions</div></div>
                    </div>
                    <div style="margin-top:16px">${button('👑 Start My Mock OA', 'startMockOA')}</div>
                </div>`;
        }
        if (!qq.length) {
            body += `<div class="card empty">No practice questions yet.<p>${button('Add Question', 'addQuestion')}</p></div>`;
        } else if (isFinished) {
            const correct = qq.filter(q => quizAnswers[q.id] === Number(q.correct_index)).length;
            const accuracy = pct(correct, qq.length);
            body += `
                <div class="card" style="border:2px solid #E7C987;text-align:center">
                    <div class="eyebrow">${isMock ? '👑 Royal Mock OA Results' : '🪷 Practice Complete'}</div>
                    <h2>${accuracy}%</h2><h3>${correct} / ${qq.length} Correct</h3>
                    <p>${accuracy >= 80 ? '✨ Royal Mastery! Beautiful work!' : accuracy >= 70 ? '💗 Growing Stronger! Keep practicing!' : '🌱 Every Question Helps You Bloom!'}</p>
                    <p class="muted">Saved to your private attempt history. These are practice milestones, not WGU passing thresholds.</p>
                    <div class="stats" style="margin:20px 0">
                        <div class="card stat"><strong>${correct}</strong><small>Correct</small></div>
                        <div class="card stat"><strong>${qq.length - correct}</strong><small>Incorrect / Unanswered</small></div>
                        <div class="card stat"><strong>${accuracy}%</strong><small>Accuracy</small></div>
                    </div>
                    <h3>📚 Review Your Answers</h3>
                </div>
                ${qq.map((q, index) => `
                    <details class="card" style="margin:10px 0">
                        <summary>Question ${index + 1} · ${quizAnswers[q.id] === Number(q.correct_index) ? '✓ Correct' : '✕ Review'}</summary>
                        <p>${esc(q.prompt)}</p>
                        <p><strong>Your Answer:</strong> ${quizAnswers[q.id] === undefined ? 'Not answered' : esc((q.options || [])[quizAnswers[q.id]] ?? 'Not answered')}</p>
                        <p><strong>Correct Answer:</strong> ${esc((q.options || [])[Number(q.correct_index)])}</p>
                        <p>${esc(q.explanation || '')}</p>
                    </details>`).join('')}
                <div style="margin-top:20px">${button(isMock ? '👑 New Mock OA' : '🪷 Retake Practice', 'restartQuiz')}</div>`;
        } else {
            const q = qq[Math.min(quizIndex, qq.length - 1)];
            body += `
                <div class="card">
                    <div class="row"><span class="pill">Question ${quizIndex + 1} / ${qq.length}</span><span class="muted small">${esc(q.topic || 'Practice')}</span></div>
                    <h3>${esc(q.prompt)}</h3>
                    ${(q.options || []).map((choice, index) => `
                        <label class="answer"><input type="radio" name="quizAnswer" value="${index}" ${quizAnswers[q.id] === index ? 'checked' : ''}>
                            ${String.fromCharCode(65 + index)}. ${esc(choice)}
                        </label>`).join('')}
                    <div style="margin-top:20px">${button(quizIndex === qq.length - 1 ? (isMock ? '👑 Submit Mock OA' : 'Submit Practice') : 'Next Question →', 'quizNext')}</div>
                </div>`;
        }
    }

    if (studyTab === 'preassessment' && c.code === 'D658') {
        const review = d658ReviewQuestions(c.id);
        const answered = review.filter(q => d658ReviewAnswers[q.id] !== undefined).length;
        const score = review.filter(q => d658ReviewAnswers[q.id] === Number(q.correct_index)).length;
        const history = aa.filter(a => a.answers && review.some(q => Object.prototype.hasOwnProperty.call(a.answers, q.id)));
        body += `<div class="card" style="margin:18px 0;border:2px solid #FF9FCB;background:linear-gradient(145deg,#24171e,#38252b);color:#fff">
            <div class="eyebrow" style="color:#FF9FCB">🔐 Owner-Only · D658</div>
            <h3 style="color:#fff">🧠 My Original Pre-Assessment Review</h3>
            <p style="color:#f6dce9">45 imported questions, organized by competency. Your answers and scores stay in your private Study Studio.</p>
            <div class="row"><span class="pill">${review.length} questions</span><span class="pill">${answered} answered</span><span class="pill">${history.length} saved review attempts</span></div>
        </div>`;
        if (!review.length) {
            body += '<div class="card empty">No D658 pre-assessment questions are available to this account. Check the private quiz_questions access policies.</div>';
        } else if (d658ReviewDone) {
            body += `<div class="card" style="border:2px solid #FF9FCB;text-align:center"><h3>💗 Review Complete!</h3><h2>${pct(score, review.length)}%</h2><p>${score} of ${review.length} correct</p>
                <p class="muted">Saved as a practice attempt, not an official WGU assessment result.</p>
                ${button('🌸 Start Another Review', 'restartD658Review')}</div>`;
            for (const category of ['Instructional Practices', 'Assessment', 'Differentiated Instruction']) {
                const subset = review.filter(q => q.topic.includes(`| ${category} |`));
                const correct = subset.filter(q => d658ReviewAnswers[q.id] === Number(q.correct_index)).length;
                body += `<div class="card" style="margin:12px 0"><strong>${esc(category)} · ${correct}/${subset.length}</strong>
                    <div class="muted small">${pct(correct, subset.length)}% correct in this review</div></div>`;
            }
            body += review.map((q,i) => `<details class="card" style="margin:10px 0"><summary>Q${i+1} · ${d658ReviewAnswers[q.id] === Number(q.correct_index) ? '✓ Correct' : '✕ Review'}</summary>
                <p><strong>${esc(q.prompt)}</strong></p><p>Your answer: ${d658ReviewAnswers[q.id] === undefined ? 'Unanswered' : esc(q.options[d658ReviewAnswers[q.id]] || '')}</p>
                <p>Correct answer: ${esc(q.options[Number(q.correct_index)] || '')}</p><p class="muted">${esc(q.explanation || '')}</p></details>`).join('');
        } else {
            const q = review[Math.min(d658ReviewIndex, review.length-1)];
            body += `<div class="card" style="margin:14px 0"><div class="row"><span class="pill">Question ${d658ReviewIndex+1} / ${review.length}</span><span class="pill">${answered} answered</span></div>
                <p class="muted small">${esc(q.topic.replace(/^D658 Pre-Assessment \| /,'').replace(/ \| Q\d+$/,''))}</p>
                <h3>${esc(q.prompt)}</h3>${(q.options || []).map((choice,i) => `<label class="answer"><input type="radio" name="d658ReviewAnswer" value="${i}" ${d658ReviewAnswers[q.id] === i ? 'checked' : ''}> ${String.fromCharCode(65+i)}. ${esc(choice)}</label>`).join('')}
                <div class="row" style="margin-top:18px">${d658ReviewIndex ? button('← Previous', 'd658ReviewPrev', 'btn secondary') : ''}
                ${button(d658ReviewIndex === review.length-1 ? (d658ReviewSaving ? 'Saving…' : '💗 Submit My Review') : 'Next Question →', 'd658ReviewNext')}
                ${button(d658ReviewSaving ? 'Saving…' : '💗 Submit Early', 'd658ReviewSubmitEarly', 'btn secondary')}</div>
                <p class="muted small">Submit Early saves your current answers. Unanswered questions count as incorrect, and all 45 answers are revealed afterward.</p></div>`;
        }
    }

    if (studyTab === 'mastery') {
        const practiced = competencyStats.filter(t => t.answered > 0);
        const needsWork = practiced.filter(t => t.accuracy < 70).length;
        const totalAnswered = practiced.reduce((sum, t) => sum + t.answered, 0);
        const totalCorrect = practiced.reduce((sum, t) => sum + t.correct, 0);

        body += `
            <div class="card" style="margin:18px 0;border-color:#FF9FCB">
                <div class="eyebrow">📊 Your Private Learning Insights</div>
                <h3>👑 Competency Performance Tracker</h3>
                <p class="muted">Built from your saved practice answers and Mock OA attempts for ${esc(c.title)}.</p>
                <div class="stats" style="margin:16px 0">
                    <div class="card stat"><strong>${competencyStats.length}</strong><small>Topics in Question Bank</small></div>
                    <div class="card stat"><strong>${totalAnswered}</strong><small>Recorded Answers</small></div>
                    <div class="card stat"><strong>${totalAnswered ? pct(totalCorrect, totalAnswered) + '%' : '—'}</strong><small>Overall Accuracy</small></div>
                    <div class="card stat"><strong>${needsWork}</strong><small>Topics to Revisit</small></div>
                </div>
                <p class="small muted">Personal study guide only. The 70% and 80% bands below are custom goals, not WGU passing standards. Unanswered questions are not included in topic accuracy.</p>
            </div>
            ${competencyStats.length ? competencyStats.map(t => `
                <div class="card" style="margin:12px 0">
                    <div class="row" style="gap:10px;flex-wrap:wrap">
                        <h3 style="margin:0">${esc(t.name)}</h3>
                        <span class="pill">${t.accuracy === null ? '🌱 Not practiced' : t.accuracy >= 80 ? '👑 Strong' : t.accuracy >= 70 ? '🪷 Developing' : '💗 Review next'}</span>
                    </div>
                    <p class="small muted">${t.available} questions available · ${t.answered} recorded answers · ${t.correct} correct</p>
                    <div class="row" style="align-items:center;gap:12px">
                        <div class="bar" style="flex:1"><i style="width:${t.accuracy ?? 0}%"></i></div>
                        <strong>${t.accuracy === null ? '—' : t.accuracy + '%'}</strong>
                    </div>
                </div>
            `).join('') : `
                <div class="card empty">Add practice questions with topics to see your competency breakdown.</div>
            `}
            <p class="small muted" style="margin-top:16px">Repeated attempts count as additional practice. Results for questions removed from your current question bank cannot be categorized here.</p>
        `;
    }

    if (studyTab === 'rewards') {
        const rewards = bayouStudyRewards();
        const unlocked = rewards.filter(r => r.unlocked).length;
        const next = rewards.find(r => !r.unlocked);
        body += `
            <div class="card" style="margin:18px 0;border-color:#E7C987">
                <div class="eyebrow">💗 Your Royal Study Journey</div>
                <h3>🏆 Achievement Collection</h3>
                <p class="muted">Badges are earned automatically from saved practice across all your courses.</p>
                <div class="stats" style="margin:16px 0">
                    <div class="card stat"><strong>${unlocked}/${rewards.length}</strong><small>Unlocked Badges</small></div>
                    <div class="card stat"><strong>${pct(unlocked, rewards.length)}%</strong><small>Collection Complete</small></div>
                </div>
                ${next ? `<p><strong>✨ Next milestone:</strong> ${esc(next.title)} — ${Math.min(next.count, next.goal)}/${next.goal}</p>` : '<p>👑 Every badge unlocked! You did that!</p>'}
                <p class="small muted">Mock OA badges require the assessment type to be saved. Older attempts without that information are not counted as Mock OAs.</p>
            </div>
            <div class="grid two">${rewards.map(r => bayouRewardCard(r)).join('')}</div>
        `;
    }

    if (studyTab === 'history') {
        body += `
            <div class="tablewrap">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Score</th>
                            <th>Accuracy</th>
                        </tr>
                    </thead>

                    <tbody>
                        ${aa.slice().reverse().map(a => `
                            <tr>
                                <td>
                                    ${new Date(a.created_at)
                                        .toLocaleDateString()}
                                </td>

                                <td>${a.score}/${a.total}</td>

                                <td>
                                    ${pct(a.score, a.total)}%
                                </td>
                            </tr>
                        `).join('') || `
                            <tr>
                                <td colspan="3">
                                    No practice attempts yet.
                                </td>
                            </tr>
                        `}
                    </tbody>
                </table>
            </div>
        `;
    }

    shell('📚 The Bayou Study Studio', body);
}

/* ==========================================
   PRIVATE RESOURCE VAULT
========================================== */

function vaultPage() {
    const published = publicItems.filter(r => r.published !== false);
    const privateCards = resources.map(r => ({...r, _visibility:'private'}));
    const publicCards = published.map(r => ({...r, _visibility:'public'}));
    const all = [...privateCards, ...publicCards];
    shell('✨ Resource Vault', `
        <div class="row" style="align-items:center;flex-wrap:wrap;gap:14px">
            <p class="muted">Manage study resources for your courses. Choose what stays private and what your visitors can see.</p>
            ${button('+ Add Resource', 'addResource')}
        </div>
        <div class="grid two">
            ${all.map(r => {
                const c = courses.find(c => c.code && c.code.toLowerCase() === String(r.course_code || r.area || '').toLowerCase());
                const code = r.course_code || (c ? c.code : r.area) || 'General';
                return `<article class="card">
                    <span class="pill">${r._visibility === 'public' ? '🌸 Public' : '🔒 Private'} · ${esc(code)} · ${esc(r.kind || r.format || 'Link')}</span>
                    <h3>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;text-decoration-color:#f58ec4;text-underline-offset:4px" title="Open resource in a new tab">${esc(r.title)} ↗</a>` : esc(r.title)}</h3>
                    <p>${esc(r.description || r.purpose || r.topic || '')}</p>
                    ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Open Resource ↗</a>` : ''}
                    ${r.body ? `<details><summary>Read Study Guide</summary><p style="white-space:pre-wrap">${esc(r.body)}</p></details>` : ''}
                    <div class="actions" style="margin-top:14px">
                        <button type="button" class="btn secondary" data-vault-edit="${esc(r.id)}" data-vault-type="${r._visibility}">✏️ Edit / Visibility</button>
                        <button type="button" class="btn secondary" data-vault-delete="${esc(r.id)}" data-vault-type="${r._visibility}" style="border-color:#b65c73;color:#f4a6ba">🗑️ Delete</button>
                    </div>
                </article>`;
            }).join('') || `<div class="card empty">No resources yet. Select + Add Resource to begin. ✨</div>`}
        </div>
    `);
}

/* ==========================================
   PRIVATE STUDY PLANNER
========================================== */

const plannerLocalDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const plannerDate = iso => plannerLocalDate(new Date(iso));
const plannerTime = iso => new Date(iso).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
const plannerCourse = id => courses.find(c => c.id === id);
const plannerHtmlDateTime = iso => {
    const d = new Date(iso);
    return `${plannerLocalDate(d)}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};
function plannerPage() {
    const monthStart = new Date(plannerMonth.getFullYear(), plannerMonth.getMonth(), 1);
    const firstWeekday = monthStart.getDay();
    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth()+1, 0).getDate();
    const today = plannerLocalDate(new Date());
    const sorted = [...studySessions].sort((a,b) => new Date(a.starts_at)-new Date(b.starts_at));
    const chosen = sorted.filter(s => plannerDate(s.starts_at) === plannerSelectedDay);
    const weekStart = new Date(); weekStart.setHours(0,0,0,0); weekStart.setDate(weekStart.getDate()-weekStart.getDay());
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate()+7);
    const weekly = sorted.filter(s => new Date(s.starts_at)>=weekStart && new Date(s.starts_at)<weekEnd);
    const done = weekly.filter(s => s.completed).length;
    const totalMinutes = weekly.reduce((sum,s) => sum+(new Date(s.ends_at)-new Date(s.starts_at))/60000,0);
    const editing = studySessions.find(s => s.id === plannerEditingId);
    const startDefault = editing ? plannerHtmlDateTime(editing.starts_at) : `${plannerSelectedDay}T19:30`;
    const endDefault = editing ? plannerHtmlDateTime(editing.ends_at) : `${plannerSelectedDay}T20:15`;
    const courseOptions = courses.map(c=>`<option value="${esc(c.id)}" ${editing?.course_id===c.id?'selected':''}>${esc(c.code)} — ${esc(c.title)}</option>`).join('');
    const calendar = Array.from({length:firstWeekday},()=>'<div></div>').concat(Array.from({length:daysInMonth},(_,i)=>{
        const date=plannerLocalDate(new Date(monthStart.getFullYear(),monthStart.getMonth(),i+1));
        const events=sorted.filter(s=>plannerDate(s.starts_at)===date);
        return `<button type="button" data-planner-day="${date}" aria-label="${date}, ${events.length} sessions" style="min-height:67px;border-radius:12px;border:1px solid ${date===plannerSelectedDay?'#ec83b2':'#cbb7b955'};background:${date===plannerSelectedDay?'#f5d5e7':date===today?'#fcecf5':'#fff9fb'};color:#473038;text-align:left;padding:7px;cursor:pointer"><strong>${i+1}</strong><div style="font-size:11px;margin-top:5px">${events.length?`${events.filter(x=>x.completed).length}/${events.length} ✓ · ${events.length} 📚`:''}</div></button>`;
    })).join('');
    const eventCard = s => `<article class="card" style="margin-bottom:10px;padding:16px">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center"><div><strong>${esc(s.title)}</strong> ${s.completed?'✅':''}<p class="muted" style="margin:4px 0">${esc(plannerTime(s.starts_at))} – ${esc(plannerTime(s.ends_at))}${s.course_id?` · ${esc(plannerCourse(s.course_id)?.code || 'Course')}`:''}</p>${s.notes?`<p style="white-space:pre-wrap;margin:5px 0">${esc(s.notes)}</p>`:''}</div>
        <div class="actions"><button type="button" class="btn secondary" data-planner-toggle="${esc(s.id)}">${s.completed?'↩ Undo':'✓ Complete'}</button><button type="button" class="btn secondary" data-planner-edit="${esc(s.id)}">✏️ Edit</button><button type="button" class="btn secondary" data-planner-delete="${esc(s.id)}">🗑️ Delete</button></div></div></article>`;
    shell('🌙 Bayou Study Planner', `
        <div class="card"><span class="eyebrow">After-Hours Study Mode</span><h3>Your Study Routine</h3><p>Weekdays: 7:30–8:15 PM · 8:25–9:10 PM · 9:20–9:40 PM</p><p class="muted">Weekends remain flexible. These are suggested study blocks, not automatic calendar events.</p></div>
        <div class="grid three" style="margin:16px 0">
            <div class="card"><span class="eyebrow">This Week</span><h3>${weekly.length} sessions</h3></div>
            <div class="card"><span class="eyebrow">Completed</span><h3>${done} / ${weekly.length}</h3></div>
            <div class="card"><span class="eyebrow">Planned Study Time</span><h3>${(totalMinutes/60).toFixed(1)} hours</h3></div>
        </div>
        <div class="card" style="margin-bottom:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><h3 style="margin:0">📅 ${esc(monthStart.toLocaleDateString(undefined,{month:'long',year:'numeric'}))}</h3><div class="actions"><button type="button" class="btn secondary" data-planner-month="-1">← Previous</button><button type="button" class="btn secondary" data-planner-today="1">Today</button><button type="button" class="btn secondary" data-planner-month="1">Next →</button></div></div>
            <div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px;margin-top:15px">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div style="text-align:center;font-size:12px;font-weight:700">${d}</div>`).join('')}${calendar}</div>
        </div>
        <div class="card" style="margin-bottom:16px"><h3>${editing?'✏️ Edit Study Session':'💗 Schedule a Study Session'}</h3>
            <form id="plannerForm" style="display:grid;gap:12px">
                <label>Session Title <input name="title" required maxlength="160" value="${esc(editing?.title || '')}" placeholder="e.g., D658 Assessment Practice"></label>
                <label>WGU Course <select name="course_id"><option value="">General Study / No Course</option>${courseOptions}</select></label>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px"><label>Start <input type="datetime-local" name="starts_at" required value="${esc(startDefault)}"></label><label>End <input type="datetime-local" name="ends_at" required value="${esc(endDefault)}"></label></div>
                <label>Notes (optional)<textarea name="notes" rows="3" placeholder="What will you work on?">${esc(editing?.notes || '')}</textarea></label>
                <div class="actions"><button class="btn" type="submit">${editing?'💾 Save Changes':'＋ Add Study Session'}</button>${editing?'<button type="button" class="btn secondary" data-planner-cancel="1">Cancel Edit</button>':''}</div>
                <p id="plannerMessage" role="status" class="muted"></p>
            </form>
        </div>
        <div class="card"><h3>📚 Sessions for ${esc(new Date(plannerSelectedDay+'T12:00:00').toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}))}</h3>${chosen.map(eventCard).join('')||'<p class="muted">No sessions scheduled. Choose a time above to add one! 🪷</p>'}</div>
        <div class="card" style="margin-top:16px"><h3>🌸 Upcoming Sessions</h3>${sorted.filter(s=>new Date(s.ends_at)>=new Date()&&!s.completed).slice(0,8).map(s=>`<p><strong>${esc(new Date(s.starts_at).toLocaleDateString())}</strong> · ${esc(plannerTime(s.starts_at))} · ${esc(s.title)}</p>`).join('')||'<p class="muted">No upcoming sessions yet.</p>'}</div>
    `);
}
async function plannerRefresh() {
    const result = await sb.from('study_sessions').select('*').order('starts_at',{ascending:true});
    if (result.error) throw result.error;
    studySessions = result.data || [];
    render();
}
async function plannerSave(form) {
    const data = Object.fromEntries(new FormData(form));
    const starts = new Date(data.starts_at), ends = new Date(data.ends_at);
    if (!data.title.trim() || !Number.isFinite(starts.getTime()) || !Number.isFinite(ends.getTime()) || ends<=starts) {
        alert('Please enter a title and an end time after the start time.'); return;
    }
    const payload = {title:data.title.trim(),course_id:data.course_id||null,notes:data.notes?.trim()||null,starts_at:starts.toISOString(),ends_at:ends.toISOString(),updated_at:new Date().toISOString()};
    let result;
    if (plannerEditingId) result=await sb.from('study_sessions').update(payload).eq('id',plannerEditingId);
    else result=await sb.from('study_sessions').insert({...payload,user_id:session.user.id});
    if (result.error) {alert('Could not save session: '+result.error.message);return;}
    plannerEditingId=null; plannerSelectedDay=plannerLocalDate(starts); plannerMonth=new Date(starts.getFullYear(),starts.getMonth(),1);
    try {await plannerRefresh();} catch(error) {alert('Saved, but refresh failed: '+error.message);}
}

/* ==========================================
   PRIVATE DEGREE & CAREER PLANS
========================================== */

function privatePage() {
    shell('🔐 Private Degree & Career Plans', `
        <div class="notice">
            Owner-only area. These decisions are not
            displayed on your public website.
        </div>

        <div class="grid two">
            <div class="card">
                <span class="eyebrow">
                    Internal Planning
                </span>

                <h3>Elementary Education</h3>

                <p>
                    Compare degree requirements,
                    certification steps, and program options.
                </p>
            </div>

            <div class="card">
                <span class="eyebrow">
                    Internal Planning
                </span>

                <h3>Technology Applications</h3>

                <p>
                    Track alternate certification
                    pathways and technology teaching goals.
                </p>
            </div>
        </div>

        <div class="card" style="margin-top:16px">
            <h3>Private Notes</h3>

            <textarea id="privateNotes"
                placeholder="Personal plans and reminders…"></textarea>

            <p>
                ${button('Save Private Note', 'savePrivateNote')}
            </p>
        </div>
    `);

    loadPrivateNote();
}

async function loadPrivateNote() {
    if (!owner) return;

    const result = await sb.from('private_notes')
        .select('body')
        .eq('key', 'career_plans')
        .maybeSingle();

    if (result.error) {
        console.error(result.error);
        return;
    }

    const input = $('#privateNotes');

    if (input) {
        input.value = result.data?.body || '';
    }
}

/* ==========================================
   ADMIN HEADQUARTERS
========================================== */

function adminPage() {
    shell('👑 Royal Admin Headquarters', `
        <div class="notice">
            Owner-only controls. Public resources
            must be explicitly published.
        </div>

        <div class="grid two">
            <div class="card">
                <h3>🪷 Manage Courses</h3>

                <p>
                    Update Bayou statuses, percentages,
                    credit units, and private notes.
                </p>

                ${button('Course Console', 'courses')}

                ${button(
                    'Add Course',
                    'addCourse',
                    'btn secondary'
                )}
            </div>

            <div class="card">
                <h3>📚 Build Study Content</h3>

                <p>
                    Create flashcards and scenario-based
                    practice questions.
                </p>

                ${button('Study Studio', 'study')}

                ${button(
                    'New Flashcard',
                    'addFlash',
                    'btn secondary'
                )}
            </div>

            <div class="card">
                <h3>✨ Import Workbook Data</h3>

                <p>
                    Import your private spreadsheet JSON.
                    Never publish this file.
                </p>

                <input type="file"
                    id="importFile"
                    accept="application/json,.json">

                <p>
                    ${button(
                        'Import Courses & Links',
                        'importData'
                    )}
                </p>
            </div>

            <div class="card">
                <h3>💗 Publish Study Resources</h3>

                <p>
                    Publish instructor-shareable resources
                    to your public Study Lounge.
                </p>

                ${button(
                    'Publish New Resource',
                    'publishResource'
                )}
            </div>
        </div>

        <div class="sectionhead">
            <h2>Published Resources</h2>
        </div>

        <div class="tablewrap">
            <table>
                <thead>
                    <tr>
                        <th>Title</th>
                        <th>Course</th>
                        <th>Visibility</th>
                        <th>Action</th>
                    </tr>
                </thead>

                <tbody>
                    ${publicItems.map(r => `
                        <tr>
                            <td>${esc(r.title)}</td>
                            <td>${esc(r.course_code || '')}</td>
                            <td>
                                ${r.published ? 'Public' : 'Draft'}
                            </td>

                            <td>
                                <button class="linkbtn"
                                    data-unpublish="${esc(r.id)}">
                                    Unpublish
                                </button>
                            </td>
                        </tr>
                    `).join('') || `
                        <tr>
                            <td colspan="4">
                                No published resources.
                            </td>
                        </tr>
                    `}
                </tbody>
            </table>
        </div>
    `);
}

/* ==========================================
   MODALS & DATABASE WRITES
========================================== */

function modal(title, body, submit) {
    const dialog = document.createElement('dialog');

    dialog.className = 'card';

    dialog.style.cssText = `
        max-width:620px;
        width:calc(100% - 25px);
        background:#12382c;
        color:#f9f1db;
        border:1px solid #ff9fcb;
        border-radius:18px;
    `;

    dialog.innerHTML = `
        <form id="modalForm">
            <div class="row">
                <h2>${esc(title)}</h2>

                <button type="button"
                    class="ghost"
                    id="closeModal">✕</button>
            </div>

            ${body}

            <div class="actions" style="margin-top:20px">
                <button class="btn" type="submit">
                    Save
                </button>

                <button class="btn secondary"
                    type="button"
                    id="cancelModal">
                    Cancel
                </button>
            </div>
        </form>
    `;

    document.body.append(dialog);
    dialog.showModal();

    dialog.querySelector('#closeModal').onclick =
        () => dialog.close();

    dialog.querySelector('#cancelModal').onclick =
        () => dialog.close();

    dialog.onclose = () => dialog.remove();

    dialog.querySelector('form').onsubmit = async event => {
        event.preventDefault();

        const values = Object.fromEntries(
            new FormData(event.target)
        );

        try {
            await submit(values);

            dialog.close();

            await loadPrivate();
            await loadPublic();

            render();
        } catch (error) {
            alert(error.message);
        }
    };
}

const field = (name, label, value = '', type = 'text') => `
    <div class="field">
        <label>${esc(label)}</label>

        <input name="${esc(name)}"
            type="${esc(type)}"
            value="${esc(value)}"
            ${['title', 'front', 'prompt'].includes(name)
                ? 'required'
                : ''}>
    </div>
`;

const textarea = (name, label, value = '') => `
    <div class="field">
        <label>${esc(label)}</label>

        <textarea name="${esc(name)}">${esc(value)}</textarea>
    </div>
`;

async function write(table, record, id) {
    if (!owner) throw Error('Owner access required.');

    const query = id
        ? sb.from(table).update(record).eq('id', id)
        : sb.from(table).insert(record);

    const result = await query;

    if (result.error) throw result.error;
}

/* ==========================================
   COURSE EDITOR
========================================== */

function editCourse(id) {
    const c = courses.find(x => x.id === id) || {};

    modal(
        id ? 'Edit Bayou Course' : 'Add Bayou Course',

        field('title', 'Class Name / Course Title (editable)', c.title) +

        `<div class="fields">
            ${field('code', 'Course Number / Code (editable)', c.code)}
            ${field('cu', 'Credit Units', c.cu ?? 3, 'number')}
        </div>` +

        field('domain', 'Domain', c.domain) +

        `<div class="field">
            <label>Official Bayou Status</label>

            <select name="status">
                ${opt(statusOptions, c.status || 'Not Started')}
            </select>
        </div>` +

        field(
            'progress',
            'Progress Percentage',
            c.progress ?? 0,
            'number'
        ) +

        field('completed_at', 'Actual Completion Date (optional)', c.completed_at ? String(c.completed_at).slice(0,10) : '', 'date') +

        textarea('notes', 'Private Course Notes', c.notes),

        async values => {
            values.title = String(values.title || '').trim();
            values.code = String(values.code || '').trim().toUpperCase();
            if (!values.title || !values.code) {
                throw Error('Course name and course number are required.');
            }
            const status = values.status;
            const providedDate = String(values.completed_at || '').trim();
            values.completed_at = isDone({status})
                ? (providedDate || (isDone(c) ? (c.completed_at || null) : new Date().toISOString().slice(0,10)))
                : null;

            await write('courses', {
                ...values,
                cu: Number(values.cu),
                progress: isDone({ status })
                    ? 100
                    : clampProgress(values.progress)
            }, id);
        }
    );
}

/* ==========================================
   FLASHCARD BUILDER
========================================== */

function addFlash() {
    const c = active();

    if (!c) {
        alert('Add a course first.');
        return;
    }

    modal(
        'Create Bayou Flashcard',

        field('front', 'Front / Question') +
        textarea('back', 'Back / Answer'),

        async values => {
            if (!values.front.trim() ||
                !values.back.trim()) {
                throw Error('Both sides are required.');
            }

            await write('flashcards', {
                course_id: c.id,
                ...values
            });
        }
    );
}

/* ==========================================
   PRACTICE QUESTION BUILDER
========================================== */

function addQuestion() {
    const c = active();

    if (!c) {
        alert('Add a course first.');
        return;
    }

    modal(
        'Create Practice Question',

        field('topic', 'Competency / Topic') +
        textarea('prompt', 'Question Scenario') +

        ['A', 'B', 'C', 'D'].map((letter, index) =>
            field('choice' + index, 'Choice ' + letter)
        ).join('') +

        `<div class="field">
            <label>Correct Answer</label>

            <select name="correct_index">
                <option value="0">A</option>
                <option value="1">B</option>
                <option value="2">C</option>
                <option value="3">D</option>
            </select>
        </div>` +

        textarea('explanation', 'Answer Explanation'),

        async values => {
            const options = [0, 1, 2, 3].map(
                index => values['choice' + index]
            );

            if (!values.prompt.trim() ||
                options.some(x => !x?.trim())) {
                throw Error(
                    'Question and all four choices are required.'
                );
            }

            await write('quiz_questions', {
                course_id: c.id,
                topic: values.topic,
                prompt: values.prompt,
                options,
                correct_index: Number(values.correct_index),
                explanation: values.explanation
            });
        }
    );
}

/* ==========================================
   PRIVATE RESOURCE BUILDER
========================================== */

function addResource(id = null, originalVisibility = 'private') {
    const original = id ? (originalVisibility === 'public'
        ? publicItems.find(r => r.id === id)
        : resources.find(r => r.id === id)) : null;
    if (id && !original) { alert('Resource not found. Refresh and try again.'); return; }
    const initialCode = original?.course_code || original?.area || '';
    const initialVisibility = original ? originalVisibility : 'private';
    const courseOptions = courses.slice().sort((a,b) => String(a.code || a.title).localeCompare(String(b.code || b.title)));
    const resourceField = (name, label, val = '', required = false) => `
        <div class="field"><label for="bayou-${name}">${esc(label)}</label>
        <input id="bayou-${name}" name="${name}" value="${esc(val)}" ${required ? 'required' : ''}></div>`;
    const body = `
        <div class="field"><label for="bayou-visibility">Who can see this resource?</label>
            <select id="bayou-visibility" name="visibility" style="width:100%;padding:13px;background:#09271f;color:#fff;border:1px solid #577467;border-radius:9px">
                <option value="private" ${initialVisibility === 'private' ? 'selected' : ''}>🔒 Private — only me</option>
                <option value="public" ${initialVisibility === 'public' ? 'selected' : ''}>🌸 Public — anyone visiting the site</option>
            </select>
        </div>
        <div class="field"><label for="bayou-course-search">Class (search by code or name)</label>
            <input id="bayou-course-search" type="search" autocomplete="off" placeholder="Search D658 or course name…" value="${esc(initialCode)}">
            <select id="bayou-course-select" name="course_code" size="${Math.min(5, Math.max(2, courseOptions.length + 1))}" style="width:100%;margin-top:7px;padding:9px;background:#09271f;color:#fff;border:1px solid #577467;border-radius:9px">
                <option value="">General / No class</option>
                ${courseOptions.map(c => `<option value="${esc(c.code || '')}" ${c.code === initialCode ? 'selected' : ''}>${esc(c.code || '—')} — ${esc(c.title || '')}</option>`).join('')}
            </select>
            <small class="muted">Choose a result below the search box. Public resources will appear on that course's page.</small>
        </div>
        ${resourceField('title','Resource Title',original?.title || '',true)}
        ${resourceField('topic','Topic',original?.topic || '',false)}
        ${resourceField('format','Format / Type',original?.kind || original?.format || 'Link')}
        ${resourceField('url','HTTPS URL (optional)',original?.url || '')}
        <div class="field"><label>Purpose / Description</label><textarea name="purpose">${esc(original?.description || original?.purpose || '')}</textarea></div>
        <div class="field"><label>Optional notes / study guide</label><textarea name="body">${esc(original?.body || '')}</textarea></div>`;
    modal(id ? 'Edit Study Resource' : 'Add Study Resource', body, async values => {
        const visibility = values.visibility;
        const code = values.course_code || '';
        const title = String(values.title || '').trim();
        const url = String(values.url || '').trim();
        if (!title) throw Error('Resource title is required.');
        if (url && !/^https:\/\//i.test(url)) throw Error('Use an HTTPS URL or leave the URL blank.');
        const privateRecord = {area:code || null,topic:values.topic || null,title,
            format:values.format || null,url:url || null,purpose:values.purpose || null};
        const publicRecord = {course_code:code || null,title,kind:values.format || null,
            url:url || null,description:values.purpose || null,body:values.body || null,published:true};
        const destination = visibility === 'public' ? 'public_resources' : 'resources';
        const source = originalVisibility === 'public' ? 'public_resources' : 'resources';
        const record = visibility === 'public' ? publicRecord : privateRecord;
        if (id && destination === source) {
            await write(destination, record, id);
        } else {
            // Create the destination first; never remove the original if saving fails.
            await write(destination, record);
            if (id) {
                const deletion = await sb.from(source).delete().eq('id',id);
                if (deletion.error) {
                    throw Error('New resource saved, but original could not be removed: ' + deletion.error.message + '. Refresh before trying again.');
                }
            }
        }
    });
    const dialog = document.querySelector('dialog:last-of-type');
    const searchBox = dialog?.querySelector('#bayou-course-search');
    const select = dialog?.querySelector('#bayou-course-select');
    if (searchBox && select) {
        const opts = [...select.options];
        searchBox.addEventListener('input', () => {
            const q = searchBox.value.trim().toLowerCase();
            for (const option of opts) {
                option.hidden = !!q && !!option.value && !option.text.toLowerCase().includes(q);
            }
            const matching = opts.find(o => o.value && !o.hidden);
            if (matching && q) select.value = matching.value;
            else if (!q) select.value = '';
        });
        select.addEventListener('change', () => {
            const selected = select.selectedOptions[0];
            if (selected) searchBox.value = selected.value ? selected.text : '';
        });
    }
}

/* ==========================================
   PUBLIC RESOURCE PUBLISHER
========================================== */

function publishResource() {
    modal(
        'Publish Study Resource',

        field('title', 'Public Title') +
        field('course_code', 'Course Code', 'D658') +
        field('kind', 'Resource Type', 'Mnemonic') +
        textarea('description', 'Public Description') +
        field('url', 'Optional HTTPS Link') +
        textarea('body', 'Optional Public Study Guide'),

        async values => {
            if (!values.title.trim()) {
                throw Error('Title is required.');
            }

            if (values.url &&
                !/^https:\/\//i.test(values.url)) {
                throw Error('Use an HTTPS URL.');
            }

            await write('public_resources', {
                ...values,
                published: true
            });
        }
    );
}

/* ==========================================
   SPREADSHEET IMPORT
========================================== */

async function importData() {
    const file = $('#importFile')?.files[0];

    if (!file) {
        alert(
            'Select private-workbook-import.json first.'
        );
        return;
    }

    if (!confirm(
        'Import workbook courses and resources? ' +
        'Existing courses with matching titles will be skipped.'
    )) return;

    try {
        const data = JSON.parse(await file.text());
        let count = 0;

        for (const c of data.courses || []) {
            if (courses.some(x => x.title === c.title)) {
                continue;
            }

            const result = await sb.from('courses').insert({
                ...c,
                progress: courseProgress(c)
            });

            if (result.error) throw result.error;

            count++;
        }

        for (const r of data.resources || []) {
            if (resources.some(x => x.url === r.url)) {
                continue;
            }

            const result = await sb
                .from('resources')
                .insert(r);

            if (result.error) throw result.error;
        }

        alert(
            `Imported ${count} new courses. ` +
            'Please verify course statuses and credits.'
        );

        await loadPrivate();
        await loadPublic();

        render();

    } catch (error) {
        alert('Import failed: ' + error.message);
    }
}

/* ==========================================
   QUIZ ENGINE
========================================== */


let bayouExamSubmitting = false;
async function bayouSubmitMockOA() {
    if (!bayouExamStarted || quizDone || bayouExamSubmitting) return;
    bayouExamSubmitting = true;
    try {

    const c = active();
    if (!c) return;

    const qq = bayouActiveQuestions(
        questions.filter(q => q.course_id === c.id && !isD658PreAssessment(q))
    );

    if (!qq.length) return;

    const score = qq.filter(
        q => quizAnswers[q.id] === Number(q.correct_index)
    ).length;

    const result = await sb.from('quiz_attempts').insert({
        course_id: c.id,
        score,
        total: qq.length,
        answers: { ...quizAnswers, __bayouExamType: bayouExamTimed ? 'timed' : 'untimed' }
    });

    if (result.error) {
        bayouExamSaveFailed = true;
        render();
        alert('Could not save Mock OA. Your answers are preserved. Use Retry Save. ' + result.error.message);
        return;
    }

    bayouExamSaveFailed = false;
    quizDone = true;

    if (bayouExamTimer !== null) {
        clearInterval(bayouExamTimer);
        bayouExamTimer = null;
    }

    await loadPrivate();
    render();
    } finally {
        bayouExamSubmitting = false;
    }
}

async function quizNext() {
        const c = active();
    const qq = bayouActiveQuestions(
        questions.filter(x => x.course_id === c.id && !isD658PreAssessment(x))
    );
    if (!qq.length || quizDone) return;
    if (bayouExamStarted && bayouExamTimed && bayouExamTimeRemaining() <= 0) {
        await bayouSubmitMockOA();
        return;
    }
    const q = qq[quizIndex];

    const selected = document.querySelector(
        'input[name="quizAnswer"]:checked'
    );

    if (!selected) {
        alert('Choose an answer first.');
        return;
    }

    quizAnswers[q.id] = Number(selected.value);

    if (quizIndex < qq.length - 1) {
        quizIndex++;
        render();
        return;
    }

    if (bayouExamStarted) {
        await bayouSubmitMockOA();
        return;
    }

    const score = qq.filter(
        x => quizAnswers[x.id] === Number(x.correct_index)
    ).length;

    const result = await sb.from('quiz_attempts').insert({
        course_id: c.id,
        score,
        total: qq.length,
        answers: quizAnswers
    });

    if (result.error) {
        alert(result.error.message);
        return;
    }

    quizDone = true;

    await loadPrivate();
    render();
}

async function bayouSaveD658Review(course, review) {
    if (!owner || d658ReviewSaving || !review.length) return;
    const score = review.filter(q => d658ReviewAnswers[q.id] === Number(q.correct_index)).length;
    d658ReviewSaving = true;
    render();
    try {
        const result = await sb.from('quiz_attempts').insert({
            course_id: course.id,
            score,
            total: review.length,
            answers: {...d658ReviewAnswers}
        });
        if (result.error) {
            alert('Could not save your review: ' + result.error.message);
            return;
        }
        d658ReviewDone = true;
        await loadPrivate();
    } catch (error) {
        alert('Could not save your review: ' + (error?.message || String(error)));
    } finally {
        d658ReviewSaving = false;
        render();
    }
}

/* ==========================================
   ACTION HANDLER
========================================== */

async function handle(action) {
    if (action === 'restartD658Review') {
        d658ReviewIndex = 0; d658ReviewAnswers = {}; d658ReviewDone = false;
        render(); return;
    }
    if (action === 'd658ReviewPrev') {
        d658ReviewIndex = Math.max(0, d658ReviewIndex - 1);
        render(); return;
    }
    if (action === 'd658ReviewSubmitEarly') {
        if (!owner || d658ReviewSaving || d658ReviewDone) return;
        const c = active();
        if (!c || c.code !== 'D658') return;
        const review = d658ReviewQuestions(c.id);
        if (!review.length) return;
        const selected = document.querySelector('input[name="d658ReviewAnswer"]:checked');
        const current = review[d658ReviewIndex];
        if (selected && current) d658ReviewAnswers[current.id] = Number(selected.value);
        const answered = review.filter(q => d658ReviewAnswers[q.id] !== undefined).length;
        if (!confirm(`Submit this review now? ${answered} of ${review.length} answered; ${review.length - answered} unanswered will count as incorrect.`)) return;
        return bayouSaveD658Review(c, review);
    }
    if (action === 'd658ReviewNext') {
        if (!owner || d658ReviewSaving) return;
        const c = active();
        if (!c || c.code !== 'D658') return;
        const review = d658ReviewQuestions(c.id);
        const q = review[d658ReviewIndex];
        if (!q) return;
        const selected = document.querySelector('input[name="d658ReviewAnswer"]:checked');
        if (!selected && d658ReviewAnswers[q.id] === undefined) {
            alert('Choose an answer first.'); return;
        }
        if (selected) d658ReviewAnswers[q.id] = Number(selected.value);
        if (d658ReviewIndex < review.length - 1) {
            d658ReviewIndex++; render(); return;
        }
        return bayouSaveD658Review(c, review);
    }

    const pages = [
        'home',
        'catalog',
        'resources',
        'login',
        'dashboard',
        'courses',
        'study',
        'vault',
        'admin',
        'planner',
        'private'
    ];

    if (pages.includes(action)) {
        if (bayouExamStarted && !quizDone && action !== 'study') {
            if (!confirm('Leave your Mock OA? Unsaved answers will be discarded.')) return;
            bayouResetExamSession();
            bayouExamType = 'practice';
        }
        view = action;
        render();
        return;
    }

    if (action === 'studyRewards') {
        view = 'study';
        studyTab = 'rewards';
        render();
        return;
    }

    if (action === 'logout') {
        bayouResetExamSession();
        if (sb) await sb.auth.signOut();

        session = null;
        owner = false;
        view = 'home';

        courses = [];
        resources = [];
        cards = [];
        questions = [];
        attempts = [];

        render();
        return;
    }

    if (!owner) return;

    if (action === 'addCourse') return editCourse();
    if (action === 'addFlash') return addFlash();
    if (action === 'addQuestion') return addQuestion();
    if (action === 'addResource') return addResource();
    if (action === 'publishResource') return publishResource();
    if (action === 'importData') return importData();

    if (action === 'savePrivateNote') {
        const body = $('#privateNotes').value;

        const result = await sb.from('private_notes').upsert({
            key: 'career_plans',
            body
        }, {
            onConflict: 'key'
        });

        if (result.error) {
            alert(result.error.message);
            return;
        }

        alert('Private note saved! 💗');
        return;
    }

    if (action === 'flip') {
        flipped = !flipped;
        render();
        return;
    }

    if (action === 'prevFlash' ||
        action === 'nextFlash') {
        const len = cards.filter(
            x => x.course_id === active().id
        ).length;

        if (!len) return;

        flashIndex = (
            flashIndex +
            (action === 'nextFlash' ? 1 : -1) +
            len
        ) % len;

        flipped = false;
        render();
        return;
    }

    if (action === 'startMockOA') {
        const c = active();

        if (!c) return;

        const available = questions.filter(
            q => q.course_id === c.id && !isD658PreAssessment(q)
        );

        if (!available.length) {
            alert('Add practice questions before starting a Mock OA.');
            return;
        }

        const examType = document.querySelector(
            '#bayouExamType'
        )?.value || 'untimed';

        if (examType === 'practice') {
            alert('Choose Timed or Untimed Mock OA to begin.');
            return;
        }

        const requestedLimit = Number(
            document.querySelector(
                '#bayouExamQuestionLimit'
            )?.value || 25
        );

        const requestedMinutes = Number(
            document.querySelector(
                '#bayouExamMinutes'
            )?.value || 60
        );

        bayouExamType = examType;
        bayouExamTimed = examType === 'timed';

        bayouExamQuestionLimit = Math.min(
            available.length,
            Math.max(1, Math.floor(requestedLimit) || 25)
        );

        bayouExamMinutes = Math.min(
            240,
            Math.max(1, Math.floor(requestedMinutes) || 60)
        );

        bayouResetExamSession();

        bayouExamTimed = examType === 'timed';

        bayouExamQuestionIds = bayouShuffleQuestions(
            available
        )
            .slice(0, bayouExamQuestionLimit)
            .map(q => q.id);

        bayouExamStarted = true;

        bayouExamDeadline = bayouExamTimed
            ? Date.now() + bayouExamMinutes * 60000
            : null;

        studyTab = 'quiz';

        bayouStartExamCountdown();

        render();
        return;
    }

    if (action === 'retryMockOASave') {
        return bayouSubmitMockOA();
    }

    if (action === 'quizNext') {
        return quizNext();
    }

    if (action === 'restartQuiz') {
        bayouResetExamSession();
        bayouExamType = 'practice';
        render();
        return;
    }
}

/* ==========================================
   CLICK EVENTS
========================================== */

document.addEventListener('click', async event => {
    if (!owner || !event.target.closest('[data-planner-day],[data-planner-month],[data-planner-today],[data-planner-toggle],[data-planner-edit],[data-planner-delete],[data-planner-cancel]')) return;
    const el = event.target.closest('[data-planner-day],[data-planner-month],[data-planner-today],[data-planner-toggle],[data-planner-edit],[data-planner-delete],[data-planner-cancel]');
    event.preventDefault(); event.stopImmediatePropagation();
    if (el.dataset.plannerDay) {plannerSelectedDay=el.dataset.plannerDay;plannerEditingId=null;render();return;}
    if (el.dataset.plannerMonth) {plannerMonth=new Date(plannerMonth.getFullYear(),plannerMonth.getMonth()+Number(el.dataset.plannerMonth),1);plannerEditingId=null;render();return;}
    if (el.dataset.plannerToday) {const d=new Date();plannerSelectedDay=plannerLocalDate(d);plannerMonth=new Date(d.getFullYear(),d.getMonth(),1);plannerEditingId=null;render();return;}
    if (el.dataset.plannerCancel) {plannerEditingId=null;render();return;}
    if (el.dataset.plannerEdit) {plannerEditingId=el.dataset.plannerEdit;render();document.querySelector('#plannerForm')?.scrollIntoView({behavior:'smooth',block:'start'});return;}
    const id=el.dataset.plannerToggle||el.dataset.plannerDelete;
    const item=studySessions.find(s=>s.id===id); if (!item)return;
    if (el.dataset.plannerDelete && !confirm(`Delete "${item.title}"? This cannot be undone.`))return;
    const result=el.dataset.plannerDelete?await sb.from('study_sessions').delete().eq('id',id):await sb.from('study_sessions').update({completed:!item.completed,updated_at:new Date().toISOString()}).eq('id',id);
    if (result.error) {alert('Could not update session: '+result.error.message);return;}
    if (plannerEditingId===id)plannerEditingId=null;
    try {await plannerRefresh();}catch(error){alert('Could not refresh planner: '+error.message);}
}, true);

document.addEventListener('click', async event => {
    const gardenFilter = event.target.closest('[data-garden-filter]');
    if (gardenFilter) {
        bayouGardenFilter = gardenFilter.dataset.gardenFilter;
        render();
        return;
    }
    const resourceFilter = event.target.closest('[data-resource-filter]');
    if (resourceFilter) {
        bayouResourceFilter = resourceFilter.dataset.resourceFilter;
        render();
        return;
    }

    const action = event.target.closest('[data-action]');

    if (action) {
        event.preventDefault();
        await handle(action.dataset.action);
        return;
    }

    const navigation = event.target.closest('[data-view]');

    if (navigation) {
        event.preventDefault();
        if (bayouExamStarted && !quizDone && navigation.dataset.view !== 'study') {
            if (!confirm('Leave your Mock OA? Unsaved answers will be discarded.')) return;
            bayouResetExamSession();
            bayouExamType = 'practice';
        }
        view = navigation.dataset.view;
        render();
        return;
    }

    const publicTile = event.target.closest(
        '[data-public-course]'
    );

    if (publicTile) {
        selectedPublicCourse =
            publicTile.dataset.publicCourse;

        view = 'publicCourse';
        render();
        return;
    }

    const course = event.target.closest('[data-course]');

    if (course && owner) {
        if (bayouExamStarted && !quizDone && !confirm('Switch courses and discard your Mock OA?')) return;
        bayouResetExamSession();
        bayouExamType = 'practice';
        activeCourse = course.dataset.course;
        d658ReviewIndex = 0; d658ReviewAnswers = {}; d658ReviewDone = false;
        view = 'study';
        studyTab = 'overview';
        render();
        return;
    }

    const deleteVault = event.target.closest('[data-vault-delete]');
    if (deleteVault && owner) {
        const id = deleteVault.dataset.vaultDelete;
        const visibility = deleteVault.dataset.vaultType;
        const item = visibility === 'public'
            ? publicItems.find(r => r.id === id)
            : resources.find(r => r.id === id);
        if (!item) {
            alert('Resource not found. Refresh and try again.');
            return;
        }
        if (!confirm(`Permanently delete "${item.title}"? This cannot be undone.`)) return;
        const table = visibility === 'public' ? 'public_resources' : 'resources';
        const result = await sb.from(table).delete().eq('id', id);
        if (result.error) {
            alert('Could not delete resource: ' + result.error.message);
            return;
        }
        await loadPublic();
        await loadPrivate();
        render();
        return;
    }

    const editVault = event.target.closest('[data-vault-edit]');
    if (editVault && owner) {
        addResource(editVault.dataset.vaultEdit, editVault.dataset.vaultType);
        return;
    }

    const edit = event.target.closest('[data-editcourse]');

    if (edit && owner) {
        editCourse(edit.dataset.editcourse);
        return;
    }

    const tab = event.target.closest('[data-tab]');

    if (tab && owner) {
        if (bayouExamStarted && !quizDone && tab.dataset.tab !== 'quiz') {
            if (!confirm('Leave your Mock OA? Unsaved answers will be discarded.')) return;
            bayouResetExamSession();
            bayouExamType = 'practice';
        } else if (!bayouExamStarted && tab.dataset.tab !== 'quiz') {
            quizIndex = 0;
            quizAnswers = {};
            quizDone = false;
        }
        studyTab = tab.dataset.tab;
        render();
        return;
    }

    const unpublish = event.target.closest(
        '[data-unpublish]'
    );

    if (unpublish && owner &&
        confirm('Unpublish this study resource?')) {
        const result = await sb.from('public_resources')
            .update({ published: false })
            .eq('id', unpublish.dataset.unpublish);

        if (result.error) {
            alert(result.error.message);
            return;
        }

        await loadPublic();
        render();
    }
});

/* ==========================================
   CHANGE EVENTS
========================================== */

document.addEventListener('change', async event => {
    if (event.target.matches('input[name="d658ReviewAnswer"]') && owner && !d658ReviewDone) {
        const c = active();
        const q = c && d658ReviewQuestions(c.id)[d658ReviewIndex];
        if (q) d658ReviewAnswers[q.id] = Number(event.target.value);
        return;
    }

    if (event.target.matches('input[name="quizAnswer"]') && owner && !quizDone) {
        const c = active();
        if (c) {
            const current = bayouActiveQuestions(questions.filter(q => q.course_id === c.id && !isD658PreAssessment(q)))[quizIndex];
            if (current) quizAnswers[current.id] = Number(event.target.value);
        }
        return;
    }
    
    if (event.target.matches('input[name="bayouMode"]') && owner) {
        if (bayouExamStarted && !quizDone) return;
        const newMode = event.target.value;

        if (newMode === bayouQuizMode) return;

        if (quizIndex > 0 && !quizDone &&
            !confirm('Switch modes and restart this practice session?')) {
            render();
            return;
        }

        bayouQuizMode = newMode;
        bayouQuizQuestionIds = [];

        quizIndex = 0;
        quizAnswers = {};
        quizDone = false;

        render();
        return;
    }

    if (event.target.matches('[data-status]') && owner) {
        const c = courses.find(
            x => x.id === event.target.dataset.status
        );

        if (!c) return;

        const status = event.target.value;

        const result = await sb.from('courses')
            .update({
                status,
                completed_at: isDone({status}) ? (isDone(c) ? (c.completed_at || null) : new Date().toISOString().slice(0,10)) : null,
                progress: isDone({ status })
                    ? 100
                    : c.progress
            })
            .eq('id', c.id);

        if (result.error) {
            alert(result.error.message);
            return;
        }

        await loadPrivate();
        await loadPublic();

        render();
    }

    if (event.target.id === 'studyCourse' && owner) {
        if (bayouExamStarted && !quizDone && !confirm('Switch courses and discard your Mock OA?')) {
            render();
            return;
        }
        bayouResetExamSession();
        bayouExamType = 'practice';
        activeCourse = event.target.value;
        flashIndex = 0;
        flipped = false;
        quizIndex = 0;
        quizAnswers = {};
        quizDone = false;
        render();
    }
});

/* ==========================================
   SEARCH
========================================== */

document.addEventListener('input', event => {
    if (event.target.id === 'courseSearch' && owner) {
        search = event.target.value;

        const position = event.target.selectionStart;

        coursePage();

        const input = $('#courseSearch');

        input.focus();
        input.setSelectionRange(position, position);
    }
});

/* ==========================================
   LOGIN SUBMISSION
========================================== */

document.addEventListener('submit', async event => {
    if (event.target.id === 'plannerForm') {
        event.preventDefault();
        if (owner && sb && session) await plannerSave(event.target);
        return;
    }
    if (event.target.id !== 'loginForm') return;

    event.preventDefault();

    if (!sb) return;

    const values = Object.fromEntries(
        new FormData(event.target)
    );

    const result = await sb.auth.signInWithPassword({
        email: values.email,
        password: values.password
    });

    if (result.error) {
        $('#authMsg').textContent = result.error.message;
        return;
    }

    await load();

    if (!owner) {
        await sb.auth.signOut();

        alert('This account is not authorized as the owner.');

        view = 'home';
        render();
        return;
    }

    view = 'dashboard';
    render();
});

/* ==========================================
   AUTH STATE
========================================== */

if (ready) {
    sb.auth.onAuthStateChange(event => {
        if (event === 'SIGNED_OUT') {
            bayouResetExamSession();
            owner = false;
            session = null;
            view = 'home';

            courses = [];
            resources = [];
            cards = [];
            questions = [];
            attempts = [];

            render();
        }
    });
}

/* ==========================================
   PAGE REFRESH + BROWSER HISTORY
========================================== */
window.addEventListener('hashchange', () => {
    const next = bayouInitialView();
    if (next !== view) {
        if (typeof bayouExamStarted !== 'undefined' && bayouExamStarted && !quizDone && next !== 'study') {
            if (!confirm('Leave your Mock OA? Unsaved answers will be discarded.')) {
                history.replaceState(null, '', '#' + view);
                return;
            }
            bayouResetExamSession();
        }
        view = next;
        render();
    }
});

/* ==========================================
   INITIALIZE
========================================== */

load();
