
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
let view = 'home';

let courses = [];
let resources = [];
let cards = [];
let questions = [];
let attempts = [];
let publicItems = [];
let publicCourses = [];

let activeCourse = null;
let selectedPublicCourse = null;
let studyTab = 'overview';
let flashIndex = 0;
let flipped = false;
let quizIndex = 0;
let quizAnswers = {};
let quizDone = false;
let search = '';

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
        'quiz_attempts'
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
        attempts
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

        <div class="status-legend">
            ${statusOptions.map(status => {
                const b = getBayouStatus(status);

                return `
                    <span class="legend-item"
                        style="border-color:${b.color}">
                        ${esc(b.name)}
                    </span>
                `;
            }).join('')}
        </div>

        <div class="bayou-course-grid">
            ${publicCourses.map(courseTile).join('') || `
                <div class="card empty">
                    🌱 My course garden is waiting to bloom!
                    Courses will appear after database setup.
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

                    <h3>${esc(resource.title)}</h3>

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

        ${resourceCards(matching)}

        <p class="small muted" style="margin-top:20px">
            Only resources intentionally published by
            Jai Davis appear here.
        </p>
    `;
}

function publicPage() {
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

        ${resourceCards(publicItems)}
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

function dashboard() {
    const stats = progressStats(courses);

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
    `);
}

/* ==========================================
   PRIVATE STUDY STUDIO
========================================== */

function studyPage() {
    const c = active();

    if (!c) {
        shell('The Bayou Study Studio',
            '<div class="card empty">Add or import a course first.</div>');
        return;
    }

    const cc = cards.filter(x => x.course_id === c.id);
    const qq = questions.filter(x => x.course_id === c.id);
    const aa = attempts.filter(x => x.course_id === c.id);

    const tabs = [
        ['overview', 'Overview'],
        ['flashcards', `Flashcards (${cc.length})`],
        ['quiz', `Practice Quiz (${qq.length})`],
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
        if (!qq.length) {
            body += `
                <div class="card empty">
                    No practice questions yet.

                    <p>
                        ${button('Add Question', 'addQuestion')}
                    </p>
                </div>
            `;
        } else if (quizDone) {
            const correct = qq.filter(
                q => quizAnswers[q.id] === q.correct_index
            ).length;

            body += `
                <div class="card">
                    <div class="eyebrow">Practice Complete</div>

                    <h3>
                        ${correct}/${qq.length}
                        · ${pct(correct, qq.length)}%
                    </h3>

                    <p class="muted">
                        Saved to your private attempt history.
                    </p>

                    ${qq.map((q, index) => `
                        <details class="card"
                            style="margin:10px 0">

                            <summary>
                                Question ${index + 1}
                                ·
                                ${quizAnswers[q.id] === q.correct_index
                                    ? '✓ Correct'
                                    : '✕ Review'}
                            </summary>

                            <p>${esc(q.prompt)}</p>

                            <p>
                                <strong>Answer:</strong>
                                ${esc(q.options[q.correct_index])}
                            </p>

                            <p>${esc(q.explanation || '')}</p>
                        </details>
                    `).join('')}

                    ${button('Retake Quiz', 'restartQuiz')}
                </div>
            `;
        } else {
            const q = qq[quizIndex];

            body += `
                <div class="card">
                    <div class="row">
                        <span class="pill">
                            Question ${quizIndex + 1}
                            / ${qq.length}
                        </span>

                        <span class="muted small">
                            ${esc(q.topic || 'Practice')}
                        </span>
                    </div>

                    <h3>${esc(q.prompt)}</h3>

                    ${(q.options || []).map((choice, index) => `
                        <label class="answer">
                            <input type="radio"
                                name="quizAnswer"
                                value="${index}"
                                ${quizAnswers[q.id] === index
                                    ? 'checked'
                                    : ''}>

                            ${String.fromCharCode(65 + index)}.
                            ${esc(choice)}
                        </label>
                    `).join('')}

                    <div style="margin-top:20px">
                        ${button(
                            quizIndex === qq.length - 1
                                ? 'Submit Practice'
                                : 'Next Question →',
                            'quizNext'
                        )}
                    </div>
                </div>
            `;
        }
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
    shell('✨ Resource Vault', `
        <div class="row">
            <p class="muted">
                Private resources imported from your workbook.
            </p>

            ${button('+ Add Link', 'addResource')}
        </div>

        <div class="grid two">
            ${resources.map(r => `
                <div class="card">
                    <span class="pill">
                        ${esc(r.area || 'Resource')}
                        · ${esc(r.format || 'Link')}
                    </span>

                    <h3>${esc(r.title)}</h3>

                    <p>
                        ${esc(r.topic || '')}
                        · ${esc(r.purpose || '')}
                    </p>

                    <a href="${esc(r.url)}"
                        target="_blank"
                        rel="noopener noreferrer">
                        Open Resource ↗
                    </a>
                </div>
            `).join('') || `
                <div class="card empty">
                    Import your resource vault to begin.
                </div>
            `}
        </div>
    `);
}

/* ==========================================
   PRIVATE STUDY PLANNER
========================================== */

function plannerPage() {
    shell('🌙 Bayou Study Planner', `
        <div class="card">
            <span class="eyebrow">
                After-Hours Study Mode
            </span>

            <h3>Your Study Routine</h3>

            <p>
                Weekday study blocks from your spreadsheet:
            </p>

            <p>7:30–8:15 PM</p>
            <p>8:25–9:10 PM</p>
            <p>9:20–9:40 PM</p>

            <p class="muted">
                Weekends remain flexible.
            </p>

            <div class="notice">
                Editable calendar events and reminders
                will be added in a later update.
            </div>
        </div>
    `);
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

        field('title', 'Course Title', c.title) +

        `<div class="fields">
            ${field('code', 'Course Code', c.code)}
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

        textarea('notes', 'Private Course Notes', c.notes),

        async values => {
            const status = values.status;

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

function addResource() {
    modal(
        'Add Private Resource',

        field('area', 'Area / Subject') +
        field('topic', 'Topic') +
        field('title', 'Resource Title') +
        field('format', 'Format') +
        field('url', 'URL', 'https://') +
        textarea('purpose', 'Purpose'),

        async values => {
            if (!/^https:\/\//i.test(values.url)) {
                throw Error('Use an HTTPS URL.');
            }

            await write('resources', values);
        }
    );
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

async function quizNext() {
    const c = active();
    const qq = questions.filter(x => x.course_id === c.id);
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

    const score = qq.filter(
        x => quizAnswers[x.id] === x.correct_index
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

/* ==========================================
   ACTION HANDLER
========================================== */

async function handle(action) {
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
        view = action;
        render();
        return;
    }

    if (action === 'logout') {
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

    if (action === 'quizNext') {
        return quizNext();
    }

    if (action === 'restartQuiz') {
        quizIndex = 0;
        quizAnswers = {};
        quizDone = false;
        render();
    }
}

/* ==========================================
   CLICK EVENTS
========================================== */

document.addEventListener('click', async event => {
    const action = event.target.closest('[data-action]');

    if (action) {
        event.preventDefault();
        await handle(action.dataset.action);
        return;
    }

    const navigation = event.target.closest('[data-view]');

    if (navigation) {
        event.preventDefault();
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
        activeCourse = course.dataset.course;
        view = 'study';
        studyTab = 'overview';
        render();
        return;
    }

    const edit = event.target.closest('[data-editcourse]');

    if (edit && owner) {
        editCourse(edit.dataset.editcourse);
        return;
    }

    const tab = event.target.closest('[data-tab]');

    if (tab && owner) {
        studyTab = tab.dataset.tab;
        quizIndex = 0;
        quizAnswers = {};
        quizDone = false;
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
    if (event.target.matches('[data-status]') && owner) {
        const c = courses.find(
            x => x.id === event.target.dataset.status
        );

        if (!c) return;

        const status = event.target.value;

        const result = await sb.from('courses')
            .update({
                status,
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
   INITIALIZE
========================================== */

load();
