# Results View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an always-visible "Results" tab to the WC 2026 pool tracker (`index.html`) showing a podium, the "perfect bracket" (best 2 teams per pot), each player's overlap with it, and the pool's best pick / bust.

**Architecture:** Everything lives in the existing single-file `index.html` (vanilla JS, no build step) — a third view alongside Standings and Matches, following the same `switchView()` / eager-render pattern already used for the leaderboard. Four new pure functions do the computation; new render functions turn their output into HTML; a small Node test harness (dev-only, not shipped) unit-tests the pure functions by extracting them out of `index.html` at test time.

**Tech Stack:** Vanilla JS, HTML, CSS (matches existing "kit" brutalist theme). Node.js built-in `node:test` / `node:assert` / `node:vm` for the logic tests — no new npm dependencies, no `package.json` needed.

## Global Constraints

- No new runtime dependencies, no build step — `index.html` must keep working when opened directly as a static file.
- Visual style must reuse the existing CSS custom properties and component classes (`.card`, `.medal`, `.team-row`, `.t-flag`, etc.) from the "kit" theme — no new color/font tokens.
- The Results tab is **always visible** in nav (not conditionally shown/hidden based on tournament state) — only its *content* changes based on completion state.
- Perfect-bracket / best-worst-pick tiebreak rule everywhere it applies: higher score → more `totalGoals` → alphabetical by team name (ascending).
- Full final standings are **not** duplicated on this view — only top 3 (podium). Full list stays on the Standings tab.

---

### Task 1: Pure Results Computations (TDD)

**Files:**
- Modify: `index.html` (insert `/* TESTABLE:START */` marker before the `// ── Static Data` comment, and `/* TESTABLE:END */` + 4 new functions after the `calcPersonScore` line)
- Create: `scripts/extract-testable.mjs`
- Create: `scripts/results-logic.test.mjs`

**Interfaces:**
- Consumes: existing `POTS`, `PARTICIPANTS`, `TEAM_POT`, `MOCK_TEAM_STATS`, `calcTeamScore(teamName, teamStats): number` — all already defined in `index.html` between the markers.
- Produces (for later tasks):
  - `isTournamentComplete(matchesData): boolean`
  - `computePerfectBracket(teamStats): { [pot: string]: [string, string] }` — exactly 2 team names per pot key `"1"`–`"4"`.
  - `computeOverlap(participant: {name, teams}, perfectTeamsSet: Set<string>): { matched: string[], count: number }`
  - `findBestWorstPick(teamStats): { best: {team: string, score: number, pickedBy: string[]}, worst: {team: string, score: number, pickedBy: string[]} }`

- [ ] **Step 1: Create the test extraction harness**

The app has no build step, so the pure functions live inline in `index.html`'s one `<script>` block. To unit-test them without adding a bundler, this harness pulls the text between two comment markers out of `index.html` and runs it in a Node `vm` sandbox.

Create `scripts/extract-testable.mjs`:

```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = path.join(__dirname, '..', 'index.html');

const EXPORTED_NAMES = [
  'POTS', 'PARTICIPANTS', 'TEAM_POT', 'MOCK_TEAM_STATS', 'MOCK_ELIMINATED',
  'calcTeamScore', 'calcPersonScore',
  'isTournamentComplete', 'computePerfectBracket', 'computeOverlap', 'findBestWorstPick',
];

export function loadTestable() {
  const html = readFileSync(INDEX_HTML, 'utf8');
  const start = html.indexOf('/* TESTABLE:START */');
  const end = html.indexOf('/* TESTABLE:END */');
  if (start === -1 || end === -1) {
    throw new Error('TESTABLE markers not found in index.html');
  }
  const code = html.slice(start, end);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    `${code}\nthis.__EXPORTS__ = { ${EXPORTED_NAMES.join(', ')} };`,
    sandbox,
    { filename: 'index.html (testable block)' }
  );
  return sandbox.__EXPORTS__;
}
```

- [ ] **Step 2: Write the failing tests**

Create `scripts/results-logic.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTestable } from './extract-testable.mjs';

const {
  POTS, PARTICIPANTS, MOCK_TEAM_STATS,
  isTournamentComplete, computePerfectBracket, computeOverlap, findBestWorstPick,
} = loadTestable();

test('computePerfectBracket picks the top 2 scoring teams per pot from MOCK_TEAM_STATS', () => {
  const bracket = computePerfectBracket(MOCK_TEAM_STATS);
  assert.deepEqual(Object.keys(bracket).sort(), ['1', '2', '3', '4']);
  for (const [pot, teams] of Object.entries(bracket)) {
    assert.equal(teams.length, 2);
    for (const team of teams) assert.ok(POTS[pot].includes(team));
  }
  // France (champion, 154 base pts) and Spain (finalist, 107) are the clear top 2 in Pot 1.
  assert.deepEqual(bracket[1], ['France', 'Spain']);
});

test('computePerfectBracket breaks ties by goals scored, then alphabetically', () => {
  const pot1 = POTS[1];
  const tied = {};
  for (const t of pot1) tied[t] = { matchPoints: 0, totalGoals: 0, playedGames: 0, groupPosition: 0 };
  const bracket = computePerfectBracket(tied);
  // Every Pot 1 team ties at score 0 -> alphabetical order decides: Argentina, Belgium.
  assert.deepEqual(bracket[1], ['Argentina', 'Belgium']);
});

test('computeOverlap returns matched teams and a count', () => {
  const jimmy = PARTICIPANTS.find(p => p.name === 'Jimmy');
  const perfectTeamsSet = new Set(['France', 'USA']);
  const result = computeOverlap(jimmy, perfectTeamsSet);
  assert.deepEqual(result.matched.sort(), ['France', 'USA']);
  assert.equal(result.count, 2);
});

test('computeOverlap returns zero matches when nothing overlaps', () => {
  const jimmy = PARTICIPANTS.find(p => p.name === 'Jimmy');
  const result = computeOverlap(jimmy, new Set(['Qatar']));
  assert.deepEqual(result.matched, []);
  assert.equal(result.count, 0);
});

test('findBestWorstPick scopes to drafted teams only and picks extremes by score', () => {
  const { best, worst } = findBestWorstPick(MOCK_TEAM_STATS);
  const draftedTeams = new Set(PARTICIPANTS.flatMap(p => p.teams));
  assert.ok(draftedTeams.has(best.team));
  assert.ok(draftedTeams.has(worst.team));
  assert.ok(best.score >= worst.score);
  assert.ok(Array.isArray(best.pickedBy) && best.pickedBy.length > 0);
  assert.ok(Array.isArray(worst.pickedBy) && worst.pickedBy.length > 0);
});

test('isTournamentComplete is true only when the FINAL match is FINISHED', () => {
  const notDone = { matches: [{ stage: 'FINAL', status: 'SCHEDULED' }] };
  const done    = { matches: [{ stage: 'FINAL', status: 'FINISHED' }] };
  const missing = { matches: [{ stage: 'SEMI_FINALS', status: 'FINISHED' }] };
  assert.equal(isTournamentComplete(notDone), false);
  assert.equal(isTournamentComplete(done), true);
  assert.equal(isTournamentComplete(missing), false);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test scripts/results-logic.test.mjs`
Expected: FAIL — `loadTestable` throws `Error: TESTABLE markers not found in index.html` (since the markers don't exist in `index.html` yet).

- [ ] **Step 4: Add the TESTABLE markers and implement the 4 functions in `index.html`**

Find this line in `index.html` (the start of the Static Data section):

```html
    // ── Static Data ──────────────────────────────────────────────────────────────
```

Replace it with:

```html
    /* TESTABLE:START */
    // ── Static Data ──────────────────────────────────────────────────────────────
```

Then find this line (the end of the Scoring Engine section):

```html
    const calcPersonScore = (p, teamStats) => p.teams.reduce((s, t) => s + calcTeamScore(t, teamStats), 0);
```

Replace it with:

```html
    const calcPersonScore = (p, teamStats) => p.teams.reduce((s, t) => s + calcTeamScore(t, teamStats), 0);

    // ── Results: pure computations ────────────────────────────────────────────────
    function isTournamentComplete(matchesData) {
      const final = matchesData?.matches?.find(m => m.stage === 'FINAL');
      return final?.status === 'FINISHED';
    }

    function rankTeamsByScore(teamNames, teamStats) {
      return [...teamNames].sort((a, b) => {
        const scoreDiff = calcTeamScore(b, teamStats) - calcTeamScore(a, teamStats);
        if (scoreDiff !== 0) return scoreDiff;
        const goalsDiff = (teamStats[b]?.totalGoals ?? 0) - (teamStats[a]?.totalGoals ?? 0);
        if (goalsDiff !== 0) return goalsDiff;
        return a.localeCompare(b);
      });
    }

    function computePerfectBracket(teamStats) {
      const bracket = {};
      for (const [pot, teams] of Object.entries(POTS)) {
        bracket[pot] = rankTeamsByScore(teams, teamStats).slice(0, 2);
      }
      return bracket;
    }

    function computeOverlap(participant, perfectTeamsSet) {
      const matched = participant.teams.filter(t => perfectTeamsSet.has(t));
      return { matched, count: matched.length };
    }

    function findBestWorstPick(teamStats) {
      const draftedBy = {};
      for (const p of PARTICIPANTS) {
        for (const t of p.teams) (draftedBy[t] ??= []).push(p.name);
      }
      const ranked = rankTeamsByScore(Object.keys(draftedBy), teamStats);
      const best = ranked[0];
      const worst = ranked[ranked.length - 1];
      return {
        best:  { team: best,  score: calcTeamScore(best, teamStats),  pickedBy: draftedBy[best] },
        worst: { team: worst, score: calcTeamScore(worst, teamStats), pickedBy: draftedBy[worst] },
      };
    }
    /* TESTABLE:END */
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test scripts/results-logic.test.mjs`
Expected: PASS — 6 tests, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add index.html scripts/extract-testable.mjs scripts/results-logic.test.mjs
git commit -m "$(cat <<'EOF'
feat: add pure computation functions for Results view

isTournamentComplete, computePerfectBracket, computeOverlap, and
findBestWorstPick — unit-tested via a Node vm harness that extracts
the marked block from index.html, since the app has no build step.
EOF
)"
```

---

### Task 2: Results View HTML/CSS Scaffold + Nav Wiring

**Files:**
- Modify: `index.html` (nav button, `<main id="results-view">` container, CSS block, `switchView()`)

**Interfaces:**
- Consumes: none (pure structure/styling task).
- Produces: DOM elements `#nav-results`, `#results-view`, `#results-content` and an updated `switchView(view)` that Task 3 will call into via `renderResultsView`.

- [ ] **Step 1: Add the nav button**

Find:

```html
    <nav class="view-nav">
      <button id="nav-standings" class="pill active" onclick="switchView('standings')">Standings</button>
      <button id="nav-matches"   class="pill"        onclick="switchView('matches')">Matches</button>
    </nav>
```

Replace with:

```html
    <nav class="view-nav">
      <button id="nav-standings" class="pill active" onclick="switchView('standings')">Standings</button>
      <button id="nav-matches"   class="pill"        onclick="switchView('matches')">Matches</button>
      <button id="nav-results"   class="pill"        onclick="switchView('results')">Results</button>
    </nav>
```

- [ ] **Step 2: Add the results view container**

Find:

```html
  <main id="matches-view" class="hidden">
    <div class="match-filters">
      <button id="mf-today"    class="pill active" onclick="setMatchFilter('today')">Today</button>
      <button id="mf-results"  class="pill"        onclick="setMatchFilter('results')">Results</button>
      <button id="mf-upcoming" class="pill"        onclick="setMatchFilter('upcoming')">Upcoming</button>
    </div>
    <div id="match-list"></div>
  </main>
```

Replace with:

```html
  <main id="matches-view" class="hidden">
    <div class="match-filters">
      <button id="mf-today"    class="pill active" onclick="setMatchFilter('today')">Today</button>
      <button id="mf-results"  class="pill"        onclick="setMatchFilter('results')">Results</button>
      <button id="mf-upcoming" class="pill"        onclick="setMatchFilter('upcoming')">Upcoming</button>
    </div>
    <div id="match-list"></div>
  </main>

  <main id="results-view" class="hidden">
    <div id="results-content"></div>
  </main>
```

- [ ] **Step 3: Add CSS for the new view**

Find:

```html
    .score-modal-disclaimer {
      margin-top: 0.7rem; font-family: var(--f-mono); font-size: 0.62rem;
      color: var(--muted); line-height: 1.5; opacity: 0.75;
    }
  </style>
```

Replace with:

```html
    .score-modal-disclaimer {
      margin-top: 0.7rem; font-family: var(--f-mono); font-size: 0.62rem;
      color: var(--muted); line-height: 1.5; opacity: 0.75;
    }

    /* ── Results view ── */
    .results-pending { text-align: center; padding: 3.5rem 1.25rem 3rem; max-width: 520px; margin: 0 auto; }
    .results-pending-icon { font-size: 3.4rem; display: inline-block; margin-bottom: 1rem; }
    .results-pending-text { font-family: var(--f-mono); font-size: 0.85rem; color: var(--muted); line-height: 1.7; }

    .results-section { max-width: 760px; margin: 0 auto 1.6rem; padding: 0 1rem; }
    .results-heading {
      font-family: var(--f-display); font-size: 1rem; letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--ink); margin-bottom: 0.7rem;
    }

    .podium-card { margin-bottom: 0.7rem; }
    .podium-card .medal { font-size: 1.5rem; }

    .pb-card { padding: 0.4rem 1rem; }
    .pb-row { display: flex; align-items: center; gap: 0.8rem; padding: 0.7rem 0; border-bottom: 1px solid var(--ink); flex-wrap: wrap; }
    .pb-row:last-child { border-bottom: none; }
    .pb-pot { font-family: var(--f-mono); font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; min-width: 3.5rem; }
    .pb-teams { display: flex; gap: 1.2rem; flex-wrap: wrap; }
    .pb-team { display: flex; align-items: center; gap: 0.4rem; font-family: var(--f-body); font-weight: 600; }
    .pb-team .t-score { font-family: var(--f-mono); font-size: 0.8rem; color: var(--muted); font-weight: 400; }

    .ov-card { margin-bottom: 0.6rem; }
    .ov-dots { display: flex; gap: 0.22rem; margin-top: 0.4rem; }
    .ov-dot { width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid var(--ink); background: transparent; }
    .ov-dot.filled { background: var(--live); border-color: var(--live); }
    .ov-count { font-family: var(--f-display); font-weight: 800; font-size: 1.3rem; }
    .ov-matched { display: flex; flex-direction: column; gap: 0.5rem; }
    .ov-match { display: flex; align-items: center; gap: 0.5rem; font-family: var(--f-body); font-weight: 600; }
    .ov-none { font-family: var(--f-mono); font-size: 0.8rem; color: var(--muted); }

    .pick-row { display: flex; gap: 0.9rem; flex-wrap: wrap; }
    .pick-card { flex: 1 1 220px; padding: 1.1rem; text-align: center; }
    .pick-icon { font-size: 2.2rem; }
    .pick-label { font-family: var(--f-display); font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin: 0.4rem 0 0.6rem; }
    .pick-team { display: flex; align-items: center; justify-content: center; gap: 0.4rem; font-family: var(--f-body); font-weight: 700; font-size: 1.15rem; }
    .pick-score { font-family: var(--f-mono); font-size: 0.85rem; color: var(--muted); margin-top: 0.3rem; }
    .pick-by { font-family: var(--f-mono); font-size: 0.68rem; color: var(--muted); margin-top: 0.5rem; }
  </style>
```

- [ ] **Step 4: Wire the nav toggle into `switchView()`**

Find:

```js
    function switchView(view) {
      currentView = view;
      document.getElementById('leaderboard').classList.toggle('hidden', view !== 'standings');
      document.getElementById('matches-view').classList.toggle('hidden', view !== 'matches');
      document.getElementById('nav-standings').classList.toggle('active', view === 'standings');
      document.getElementById('nav-matches').classList.toggle('active', view === 'matches');
      if (view === 'matches') {
        if (lastGoodData) renderMatchesView(lastGoodData.matches.matches);
        else document.getElementById('match-list').innerHTML =
          '<p class="match-empty">Loading match data…</p>';
      }
    }
```

Replace with:

```js
    function switchView(view) {
      currentView = view;
      document.getElementById('leaderboard').classList.toggle('hidden', view !== 'standings');
      document.getElementById('matches-view').classList.toggle('hidden', view !== 'matches');
      document.getElementById('results-view').classList.toggle('hidden', view !== 'results');
      document.getElementById('nav-standings').classList.toggle('active', view === 'standings');
      document.getElementById('nav-matches').classList.toggle('active', view === 'matches');
      document.getElementById('nav-results').classList.toggle('active', view === 'results');
      if (view === 'matches') {
        if (lastGoodData) renderMatchesView(lastGoodData.matches.matches);
        else document.getElementById('match-list').innerHTML =
          '<p class="match-empty">Loading match data…</p>';
      }
    }
```

- [ ] **Step 5: Manually verify the scaffold in a browser**

Open `index.html` directly in a browser (double-click it, or `open index.html` / `xdg-open index.html`).

Expected:
- A third "Results" pill appears in the nav, next to Standings and Matches.
- Clicking it hides the Standings leaderboard and shows an empty `#results-view` (blank — content comes in Task 3), and the pill highlights as active.
- Clicking back to Standings or Matches still works as before.
- No console errors.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: add Results view scaffold, nav tab, and styles"
```

---

### Task 3: Render Functions + Wiring into Refresh/Demo

**Files:**
- Modify: `index.html` (new `renderResultsView` + 4 helper render functions; calls added to `doRefresh()` and `renderDemo()`)

**Interfaces:**
- Consumes: `isTournamentComplete`, `computePerfectBracket`, `computeOverlap`, `findBestWorstPick` (Task 1); `#results-content` (Task 2); existing `PARTICIPANTS`, `calcPersonScore`, `calcTeamScore`, `FLAGS`, `MOCK_TEAM_STATS`.
- Produces: `renderResultsView(teamStats, isComplete): void` — called on every live refresh and every demo render, mirroring how `renderLeaderboard` is called unconditionally regardless of which tab is active.

- [ ] **Step 1: Add the render functions**

Find the end of the Matches View section:

```js
    function renderMatchesView(matchesData) {
      const matches = filterMatches(matchesData);
      const list = document.getElementById('match-list');

      if (matches.length === 0) {
        const msg = matchFilter === 'today'
          ? 'No matches today<br>Check Results or Upcoming'
          : matchFilter === 'results' ? 'No results yet'
          : 'No upcoming matches';
        list.innerHTML = `<p class="match-empty">${msg}</p>`;
        return;
      }

      // Group by local date
      const groups = new Map();
      for (const m of matches) {
        const key = new Date(m.utcDate).toLocaleDateString();
        if (!groups.has(key)) groups.set(key, { label: matchDateLabel(m.utcDate), matches: [] });
        groups.get(key).matches.push(m);
      }

      const showHeaders = matchFilter !== 'today';
      let html = '';
      for (const { label, matches: group } of groups.values()) {
        if (showHeaders) html += `<div class="date-header">${label}</div>`;
        html += group.map(renderMatchCard).join('');
      }
      list.innerHTML = html;
    }
```

Insert immediately after it (before the `// ── App Controller` section):

```js
    // ── Results View ─────────────────────────────────────────────────────────────
    const MEDAL_ICON = ['🥇', '🥈', '🥉'];

    function renderPodium(podium) {
      const rows = podium.map((p, i) => `
        <div class="card rank-${i + 1} podium-card">
          <div class="card-header">
            <div class="medal">${MEDAL_ICON[i]}</div>
            <div class="mid"><div class="name">${p.name}</div></div>
            <div class="right"><div><div class="score">${p.score}</div><div class="pts">PTS</div></div></div>
          </div>
        </div>`).join('');
      return `<section class="results-section">
        <h2 class="results-heading">Final Results</h2>
        ${rows}
      </section>`;
    }

    function renderPerfectBracket(perfectBracket, teamStats) {
      const rows = Object.entries(perfectBracket).map(([pot, teams]) => {
        const teamHtml = teams.map(t => `
          <span class="pb-team">
            <span class="t-flag" data-team="${t}">${FLAGS[t] ?? '🏳️'}</span>
            <span class="t-name">${t}</span>
            <span class="t-score">${calcTeamScore(t, teamStats)}</span>
          </span>`).join('');
        return `<div class="pb-row"><span class="pb-pot">Pot ${pot}</span><div class="pb-teams">${teamHtml}</div></div>`;
      }).join('');
      return `<section class="results-section">
        <h2 class="results-heading">The Perfect Bracket</h2>
        <div class="card pb-card">${rows}</div>
      </section>`;
    }

    function renderOverlapSection(overlaps) {
      const rows = overlaps.map(p => {
        const dots = Array.from({ length: 8 }, (_, i) =>
          `<span class="ov-dot${i < p.count ? ' filled' : ''}"></span>`).join('');
        const matchedHtml = p.matched.map(t => `
          <span class="ov-match"><span class="t-flag" data-team="${t}">${FLAGS[t] ?? '🏳️'}</span> ${t}</span>`).join('');
        return `<div class="card ov-card" data-name="${p.name}">
          <div class="card-header">
            <div class="mid"><div class="name">${p.name}</div><div class="ov-dots">${dots}</div></div>
            <div class="right"><div class="ov-count">${p.count}/8</div><span class="chev">&#8250;</span></div>
          </div>
          <div class="breakdown"><div class="breakdown-inner ov-matched">${matchedHtml || '<span class="ov-none">No matches</span>'}</div></div>
        </div>`;
      }).join('');
      return `<section class="results-section">
        <h2 class="results-heading">How Close Did You Get?</h2>
        ${rows}
      </section>`;
    }

    function renderBestWorstSection(best, worst) {
      const pickCard = (icon, label, pick, cls) => `
        <div class="card pick-card ${cls}">
          <div class="pick-icon">${icon}</div>
          <div class="pick-label">${label}</div>
          <div class="pick-team">
            <span class="t-flag" data-team="${pick.team}">${FLAGS[pick.team] ?? '🏳️'}</span>
            <span class="t-name">${pick.team}</span>
          </div>
          <div class="pick-score">${pick.score} pts</div>
          <div class="pick-by">Picked by ${pick.pickedBy.join(', ')}</div>
        </div>`;
      return `<section class="results-section">
        <h2 class="results-heading">Best Pick &amp; Bust of the Pool</h2>
        <div class="pick-row">
          ${pickCard('🔥', 'Best Pick', best, 'pick-best')}
          ${pickCard('💀', 'Bust of the Pool', worst, 'pick-worst')}
        </div>
      </section>`;
    }

    function renderResultsView(teamStats, isComplete) {
      const container = document.getElementById('results-content');
      if (!isComplete) {
        container.innerHTML = `
          <div class="results-pending">
            <span class="results-pending-icon">🏆</span>
            <p class="results-pending-text">Tournament in progress — check back after the final.</p>
          </div>`;
        return;
      }

      const ranked = PARTICIPANTS
        .map(p => ({ ...p, score: calcPersonScore(p, teamStats) }))
        .sort((a, b) => b.score - a.score);
      const podium = ranked.slice(0, 3);
      const perfectBracket = computePerfectBracket(teamStats);
      const perfectTeamsSet = new Set(Object.values(perfectBracket).flat());
      const overlaps = ranked
        .map(p => ({ ...p, ...computeOverlap(p, perfectTeamsSet) }))
        .sort((a, b) => b.count - a.count);
      const { best, worst } = findBestWorstPick(teamStats);

      container.innerHTML = [
        renderPodium(podium),
        renderPerfectBracket(perfectBracket, teamStats),
        renderOverlapSection(overlaps),
        renderBestWorstSection(best, worst),
      ].join('');
    }
```

- [ ] **Step 2: Wire it into demo mode**

Find:

```js
    function renderDemo() {
      liveTeams = new Set();
      eliminatedTeams = MOCK_ELIMINATED;
      lastTeamStats = MOCK_TEAM_STATS;
      renderLeaderboard(MOCK_TEAM_STATS);
      document.getElementById('last-updated').textContent = 'Demo · post-final snapshot — France champions';
      setStatusColor('demo');
      setRefreshing(false);
    }
```

Replace with:

```js
    function renderDemo() {
      liveTeams = new Set();
      eliminatedTeams = MOCK_ELIMINATED;
      lastTeamStats = MOCK_TEAM_STATS;
      renderLeaderboard(MOCK_TEAM_STATS);
      renderResultsView(MOCK_TEAM_STATS, true);
      document.getElementById('last-updated').textContent = 'Demo · post-final snapshot — France champions';
      setStatusColor('demo');
      setRefreshing(false);
    }
```

- [ ] **Step 3: Wire it into live refresh (success and stale-fallback paths)**

Find:

```js
    async function doRefresh() {
      if (mode !== 'live') return;
      setRefreshing(true);
      try {
        const [standings, matches] = await Promise.all([fetchStandings(), fetchMatches()]);
        lastGoodData = { standings, matches };
        const teamStats = buildTeamStats(standings, matches);
        lastTeamStats = teamStats;
        buildActivitySets(matches, teamStats);
        renderLeaderboard(teamStats);
        if (currentView === 'matches') renderMatchesView(matches.matches);
        updateLastUpdated(matches);
        setStatusColor('live');
        errorActive = false;
      } catch (err) {
        console.error('Refresh failed:', err);
        if (lastGoodData) {
          const teamStats = buildTeamStats(lastGoodData.standings, lastGoodData.matches);
          lastTeamStats = teamStats;
          buildActivitySets(lastGoodData.matches, teamStats);
          renderLeaderboard(teamStats);
          updateLastUpdated(lastGoodData.matches);
          document.getElementById('last-updated').textContent += ' · could not refresh';
          setStatusColor('error');
        } else {
          renderErrorState();
          setStatusColor('error');
        }
      } finally {
        setRefreshing(false);
        scheduleNext();
      }
    }
```

Replace with:

```js
    async function doRefresh() {
      if (mode !== 'live') return;
      setRefreshing(true);
      try {
        const [standings, matches] = await Promise.all([fetchStandings(), fetchMatches()]);
        lastGoodData = { standings, matches };
        const teamStats = buildTeamStats(standings, matches);
        lastTeamStats = teamStats;
        buildActivitySets(matches, teamStats);
        renderLeaderboard(teamStats);
        renderResultsView(teamStats, isTournamentComplete(matches));
        if (currentView === 'matches') renderMatchesView(matches.matches);
        updateLastUpdated(matches);
        setStatusColor('live');
        errorActive = false;
      } catch (err) {
        console.error('Refresh failed:', err);
        if (lastGoodData) {
          const teamStats = buildTeamStats(lastGoodData.standings, lastGoodData.matches);
          lastTeamStats = teamStats;
          buildActivitySets(lastGoodData.matches, teamStats);
          renderLeaderboard(teamStats);
          renderResultsView(teamStats, isTournamentComplete(lastGoodData.matches));
          updateLastUpdated(lastGoodData.matches);
          document.getElementById('last-updated').textContent += ' · could not refresh';
          setStatusColor('error');
        } else {
          renderErrorState();
          setStatusColor('error');
        }
      } finally {
        setRefreshing(false);
        scheduleNext();
      }
    }
```

- [ ] **Step 4: Manually verify in a browser (Demo mode)**

Open `index.html` in a browser. It starts in Live mode by default; press **Shift+D** to reveal the dev pills, then click **Demo data** to switch to Demo mode (which uses the post-final mock data).

Click the **Results** tab and check:
- A "Final Results" section shows 3 podium cards (🥇 Jimmy, 🥈 Alfonso, 🥉 Ryan per the mock data ranking) — not a "tournament in progress" placeholder.
- A "The Perfect Bracket" section lists 4 rows (Pot 1–4), each with 2 team flags/names/scores. Pot 1 should show France and Spain.
- A "How Close Did You Get?" section lists all 7 players with a dot meter and an N/8 count, sorted by count descending.
- A "Best Pick & Bust of the Pool" section shows two cards with a team, score, and "Picked by ..." line each.
- No console errors.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: render Results view content and wire into refresh/demo"
```

---

### Task 4: Interactivity — Expand/Collapse and Score Modal, Final Verification

**Files:**
- Modify: `index.html` (two new event listeners near the existing leaderboard/modal listeners)

**Interfaces:**
- Consumes: `.ov-card` / `.card.expanded` convention (Task 3 output), existing `showScoreModal(teamName)` function, `.t-flag[data-team]` convention used throughout the app.
- Produces: none for later tasks — this is the last task.

- [ ] **Step 1: Add expand/collapse + score-modal listeners for the Results view**

Find:

```js
    // Expand / collapse a participant card (but not when opening the score modal).
    document.getElementById('leaderboard').addEventListener('click', e => {
      if (e.target.closest('.t-flag[data-team]')) return;
      const card = e.target.closest('.card');
      if (card) card.classList.toggle('expanded');
    });

    // Right-click / long-press a team flag in an expanded card → score breakdown.
    document.getElementById('leaderboard').addEventListener('contextmenu', e => {
      const flag = e.target.closest('.t-flag[data-team]');
      if (!flag) return;
      e.preventDefault();
      showScoreModal(flag.dataset.team);
    });
```

Replace with:

```js
    // Expand / collapse a participant card (but not when opening the score modal).
    document.getElementById('leaderboard').addEventListener('click', e => {
      if (e.target.closest('.t-flag[data-team]')) return;
      const card = e.target.closest('.card');
      if (card) card.classList.toggle('expanded');
    });

    // Right-click / long-press a team flag in an expanded card → score breakdown.
    document.getElementById('leaderboard').addEventListener('contextmenu', e => {
      const flag = e.target.closest('.t-flag[data-team]');
      if (!flag) return;
      e.preventDefault();
      showScoreModal(flag.dataset.team);
    });

    // Same two interactions, scoped to the Results view's overlap cards / team flags.
    document.getElementById('results-content').addEventListener('click', e => {
      if (e.target.closest('.t-flag[data-team]')) return;
      const card = e.target.closest('.ov-card');
      if (card) card.classList.toggle('expanded');
    });

    document.getElementById('results-content').addEventListener('contextmenu', e => {
      const flag = e.target.closest('.t-flag[data-team]');
      if (!flag) return;
      e.preventDefault();
      showScoreModal(flag.dataset.team);
    });
```

- [ ] **Step 2: Manually verify interactivity in a browser (Demo mode)**

With `index.html` open in Demo mode on the Results tab:
- Click a player row in "How Close Did You Get?" — it expands to show which specific teams matched the perfect bracket (or "No matches" if `count` is 0). Clicking again collapses it.
- Right-click (or long-press on touch) a team flag anywhere in Results (perfect bracket row, overlap breakdown, or best/worst pick card) — the existing score breakdown modal opens showing that team's point breakdown. Close it via the ✕ button, backdrop click, or Escape.

- [ ] **Step 3: Manually verify the "pending" placeholder path**

Since Demo mode's mock data always represents a post-final snapshot, temporarily preview the pending state via the browser console:

```js
renderResultsView(MOCK_TEAM_STATS, false)
```

Expected: the Results tab content is replaced by the "🏆 Tournament in progress — check back after the final." placeholder, styled consistently with the rest of the app.

Reload the page afterward to restore normal content (this was a manual, temporary check — no code change).

- [ ] **Step 4: Run the full logic test suite one more time**

Run: `node --test scripts/results-logic.test.mjs`
Expected: PASS — all 6 tests still passing (confirms Tasks 2–4 didn't touch the tested logic).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add Results view expand/collapse and score-modal interactivity"
```
