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

- [ ] **Step 5: Verify markup and syntax statically**

There is no browser or DOM-testing tool available in this environment, so verify structurally instead of visually.

Run: `grep -n 'id="nav-results"\|id="results-view"\|id="results-content"' index.html`
Expected: three matching lines, one per ID.

Run: `grep -n "results-view" index.html`
Expected: among the matches, a line inside `switchView()` reading `document.getElementById('results-view').classList.toggle('hidden', view !== 'results');`.

Then confirm the whole inline script still parses as valid JavaScript (a typo in a large HTML edit like this is easy to miss without a browser):

```bash
node -e "
const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
fs.writeFileSync('/tmp/wc-bracket-script-check.js', match[1]);
"
node --check /tmp/wc-bracket-script-check.js
```

Expected: no output from `node --check` (exit code 0 means syntax is valid).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: add Results view scaffold, nav tab, and styles"
```

---

### Task 3: Render Functions + Wiring into Refresh/Demo

**Files:**
- Modify: `index.html` (new `renderResultsView` + 4 helper render functions; calls added to `doRefresh()` and `renderDemo()`; the `/* TESTABLE:END */` marker moves from after `findBestWorstPick` to after the new `renderResultsView`)
- Modify: `scripts/extract-testable.mjs` (add a minimal `document.getElementById` stub so string-returning render functions can be exercised headlessly, and export the new function/constant names)
- Create: `scripts/results-render.test.mjs`

**Interfaces:**
- Consumes: `isTournamentComplete`, `computePerfectBracket`, `computeOverlap`, `findBestWorstPick` (Task 1); `#results-content` (Task 2); existing `PARTICIPANTS`, `calcPersonScore`, `calcTeamScore`, `FLAGS`, `MOCK_TEAM_STATS`.
- Produces: `renderResultsView(teamStats, isComplete): void` — called on every live refresh and every demo render, mirroring how `renderLeaderboard` is called unconditionally regardless of which tab is active.

**Note on verification:** There is no browser, jsdom, or Playwright/Puppeteer available in this environment. `renderPodium`, `renderPerfectBracket`, `renderOverlapSection`, and `renderBestWorstSection` are pure functions that only ever return an HTML string, and `renderResultsView` only ever touches the DOM through one line (`document.getElementById('results-content').innerHTML = ...`) — so a tiny fake `document` object (just enough to record what was written) is enough to unit-test all five functions for real, the same way Task 1 tested the pure computations. This task adds that stub and real assertions instead of a manual browser check.

- [ ] **Step 1: Relocate the `TESTABLE:END` marker**

Task 1 placed `/* TESTABLE:END */` right after `findBestWorstPick`, so the harness only extracts the pure computations. This task's new render functions need to be inside that block too (so Step 4 can test them), so the marker moves down. Find:

```html
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

Replace with (just the marker line removed — the function is unchanged):

```html
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
```

- [ ] **Step 2: Add the render functions, ending with the relocated marker**

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
    /* TESTABLE:END */
```

- [ ] **Step 3: Wire it into demo mode**

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

- [ ] **Step 4: Wire it into live refresh (success and stale-fallback paths)**

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

- [ ] **Step 5: Extend the test harness with a `document` stub**

Task 1's implementer found that the original `vm.createContext()` design (from Task 1's brief) makes arrays/objects returned across the sandbox boundary fail `assert.deepEqual`/`deepStrictEqual` on this Node version (they're structurally equal but not the same realm's `Array`, and Node's assert now checks that). Their fix, verified by the Task 1 reviewer, was to run the extracted code with `vm.runInThisContext()` wrapped in an IIFE instead — this keeps every call's `const`/`let` declarations scoped to that call's function body (so `loadTestable()` can be called many times per process without an "already declared" error) while keeping return values in the host realm (so `assert.deepEqual` works normally). **Read `scripts/extract-testable.mjs` on disk before editing — the text below is what it actually contains after Task 1, not what Task 1's original brief specified.**

Find (all of `scripts/extract-testable.mjs` as Task 1 actually left it):

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
  const result = vm.runInThisContext(
    `(function() {
      ${code}
      return { ${EXPORTED_NAMES.join(', ')} };
    })()`
  );
  return result;
}
```

Replace the whole file with:

```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = path.join(__dirname, '..', 'index.html');

const EXPORTED_NAMES = [
  'POTS', 'PARTICIPANTS', 'TEAM_POT', 'MOCK_TEAM_STATS', 'MOCK_ELIMINATED', 'FLAGS',
  'calcTeamScore', 'calcPersonScore',
  'isTournamentComplete', 'computePerfectBracket', 'computeOverlap', 'findBestWorstPick',
  'renderPodium', 'renderPerfectBracket', 'renderOverlapSection', 'renderBestWorstSection', 'renderResultsView',
];

export function loadTestable() {
  const html = readFileSync(INDEX_HTML, 'utf8');
  const start = html.indexOf('/* TESTABLE:START */');
  const end = html.indexOf('/* TESTABLE:END */');
  if (start === -1 || end === -1) {
    throw new Error('TESTABLE markers not found in index.html');
  }
  const code = html.slice(start, end);

  // The only DOM API the testable block ever calls is document.getElementById(id).innerHTML = string.
  // vm.runInThisContext() runs in the real Node global object (see Task 1's report for why), so the
  // stub is installed on globalThis for the duration of this call and removed immediately after —
  // safe because each loadTestable() call runs the extracted code synchronously, start to finish,
  // before returning.
  const elements = {};
  globalThis.document = {
    getElementById(id) {
      if (!elements[id]) elements[id] = { innerHTML: '' };
      return elements[id];
    },
  };
  try {
    const result = vm.runInThisContext(
      `(function() {
        ${code}
        return { ${EXPORTED_NAMES.join(', ')} };
      })()`
    );
    return { ...result, elements };
  } finally {
    delete globalThis.document;
  }
}
```

- [ ] **Step 6: Write automated tests for the render functions**

Create `scripts/results-render.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTestable } from './extract-testable.mjs';

test('renderResultsView shows the pending placeholder when the tournament is not complete', () => {
  const { MOCK_TEAM_STATS, renderResultsView, elements } = loadTestable();
  renderResultsView(MOCK_TEAM_STATS, false);
  assert.match(elements['results-content'].innerHTML, /Tournament in progress/);
});

test('renderResultsView renders all four sections when the tournament is complete', () => {
  const { MOCK_TEAM_STATS, renderResultsView, elements } = loadTestable();
  renderResultsView(MOCK_TEAM_STATS, true);
  const html = elements['results-content'].innerHTML;
  assert.match(html, /Final Results/);
  assert.match(html, /The Perfect Bracket/);
  assert.match(html, /How Close Did You Get\?/);
  assert.match(html, /Best Pick/);
  assert.match(html, /Bust of the Pool/);
  // Jimmy is the mock-data pool leader; France/Spain are Pot 1's top scorers.
  assert.match(html, /Jimmy/);
  assert.match(html, /France/);
  assert.match(html, /Spain/);
});

test('renderPodium renders the given entries with rank classes', () => {
  const { renderPodium } = loadTestable();
  const html = renderPodium([{ name: 'Alice', score: 100 }, { name: 'Bob', score: 80 }]);
  assert.match(html, /rank-1/);
  assert.match(html, /rank-2/);
  assert.match(html, /Alice/);
  assert.match(html, /100/);
  assert.match(html, /Bob/);
});

test('renderPerfectBracket lists each pot with its two teams and scores', () => {
  const { renderPerfectBracket, MOCK_TEAM_STATS } = loadTestable();
  const html = renderPerfectBracket({ 1: ['France', 'Spain'] }, MOCK_TEAM_STATS);
  assert.match(html, /Pot 1/);
  assert.match(html, /France/);
  assert.match(html, /Spain/);
});

test('renderOverlapSection shows dot meters, matched teams, and "No matches" when empty', () => {
  const { renderOverlapSection } = loadTestable();
  const html = renderOverlapSection([
    { name: 'Ian', count: 1, matched: ['France'] },
    { name: 'Jay', count: 0, matched: [] },
  ]);
  assert.match(html, /Ian/);
  assert.match(html, /1\/8/);
  assert.match(html, /Jay/);
  assert.match(html, /0\/8/);
  assert.match(html, /No matches/);
});

test('renderBestWorstSection shows both pick cards with scores and pickedBy', () => {
  const { renderBestWorstSection } = loadTestable();
  const html = renderBestWorstSection(
    { team: 'France', score: 154, pickedBy: ['Jimmy', 'Ian'] },
    { team: 'Qatar', score: 2, pickedBy: ['Ryan'] }
  );
  assert.match(html, /Best Pick/);
  assert.match(html, /Bust of the Pool/);
  assert.match(html, /France/);
  assert.match(html, /Jimmy, Ian/);
  assert.match(html, /Qatar/);
  assert.match(html, /Ryan/);
});
```

- [ ] **Step 7: Run all tests and a syntax check**

Run: `node --test scripts/`
Expected: PASS — the 6 tests from Task 1 (`results-logic.test.mjs`) plus the 6 new tests in `results-render.test.mjs`, 0 failures.

Then, since this task made large edits to the inline `<script>` block, confirm it still parses cleanly (no browser available to catch a stray typo visually):

```bash
node -e "
const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
fs.writeFileSync('/tmp/wc-bracket-script-check.js', match[1]);
"
node --check /tmp/wc-bracket-script-check.js
```

Expected: no output (syntax OK).

- [ ] **Step 8: Commit**

```bash
git add index.html scripts/extract-testable.mjs scripts/results-render.test.mjs
git commit -m "$(cat <<'EOF'
feat: render Results view content and wire into refresh/demo

Extends the Node vm test harness with a minimal document stub so the
string-returning render functions (and renderResultsView's two states)
get real automated coverage, since no browser/jsdom is available here.
EOF
)"
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

- [ ] **Step 2: Verify the new listeners statically**

There is no browser or DOM-testing tool available in this environment, so confirm by inspection that the two new listeners exactly mirror the already-shipped leaderboard listeners added in `index.html` (same file, look just above your new code) — that pattern is known-working in production, so matching it is the check.

Run: `grep -n "results-content" index.html`
Expected: two `addEventListener` calls on `document.getElementById('results-content')` — one `'click'` handler that skips `.t-flag[data-team]` and otherwise toggles `.expanded` on the closest `.ov-card`, and one `'contextmenu'` handler that calls `showScoreModal(flag.dataset.team)` after `e.preventDefault()`.

Run: `node --test scripts/*.test.mjs` (the directory form `node --test scripts/` fails on this Node version with `MODULE_NOT_FOUND` — Task 3 hit this and confirmed the glob form is the working equivalent)
Expected: PASS — all 12 tests from Tasks 1 and 3 still passing (confirms this task's edits didn't touch any tested logic; this task adds no new automated tests since event dispatch itself can't be exercised without a DOM).

Then confirm the script still parses cleanly:

```bash
node -e "
const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
fs.writeFileSync('/tmp/wc-bracket-script-check.js', match[1]);
"
node --check /tmp/wc-bracket-script-check.js
```

Expected: no output (syntax OK).

- [ ] **Step 3: Note the remaining manual check for the project owner**

Click/right-click behavior and the pending placeholder's visual appearance can't be exercised without a real browser, which isn't available in this environment. In your final report, say so explicitly and note that a human should do one last check by opening `index.html` directly: expand/collapse a row in "How Close Did You Get?", right-click a team flag anywhere in Results to confirm the score modal opens, and run `renderResultsView(MOCK_TEAM_STATS, false)` in the browser console to preview the "tournament in progress" placeholder (then reload to restore normal content — that call has no lasting effect).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add Results view expand/collapse and score-modal interactivity"
```
