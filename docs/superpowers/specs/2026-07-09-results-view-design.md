# Results View — Design Spec

## 1. Overview

Add a third view to the existing single-page pool tracker (`index.html`): **Results**. It's a celebratory recap shown alongside the existing Standings and Matches views — a permanent nav tab, not something that only appears at tournament end.

Its purpose is to answer, once the tournament (or a given point in it) has produced enough data:
- Who won the pool (podium)
- What the theoretically optimal bracket would have been (best 2 teams per pot)
- How close each player got to that optimal bracket
- Which individual pick was the best value and which was the biggest bust

This is purely a display feature. It introduces no new data sources, no new API calls, and no new scoring rules — it consumes the `teamStats` object already produced by `buildTeamStats()` on every refresh cycle, exactly like the Standings and Matches views do.

## 2. Trigger / Availability

- `Results` is added as a third pill in `.view-nav`, alongside `Standings` and `Matches`, using the existing `switchView()` pattern.
- It is **always visible**, not conditionally shown.
- Readiness gate: the view checks whether the `FINAL` match's `status` is `FINISHED` in the currently loaded matches data.
  - If not yet finished: render a placeholder card — "Tournament in progress — check back after the final."
  - If finished: render the full Results content described below.
- In Demo mode, the mock data (`MOCK_TEAM_STATS` / `MOCK_ELIMINATED`) already represents a post-final snapshot (France champions), so Results renders fully in demo mode.

## 3. Data Computations

All computation is derived from the existing `teamStats` map and `PARTICIPANTS`/`POTS` constants already in `index.html`. No new persisted data.

### 3.1 Podium
Reuse the same ranking already computed for Standings (`PARTICIPANTS.map(p => ({...p, score: calcPersonScore(p, teamStats)})).sort(...)`). Take the top 3.

### 3.2 Perfect Bracket
For each pot (1–4), rank that pot's 12 teams by `calcTeamScore(team, teamStats)` descending. Take the top 2.

**Tiebreak rule** (in order): higher `calcTeamScore` → more `totalGoals` → alphabetical by team name. Deterministic, no randomness.

Result: an object `{ 1: [teamA, teamB], 2: [...], 3: [...], 4: [...] }`, 8 teams total — the "perfect bracket."

### 3.3 Player Overlap ("How Close Did You Get?")
For each participant, intersect their 8 drafted teams with the 8 perfect-bracket teams.

```js
function computeOverlap(participant, perfectBracketSet) {
  const matched = participant.teams.filter(t => perfectBracketSet.has(t));
  return { matched, count: matched.length };
}
```

Sort participants by `count` descending (ties broken by existing pool rank) for display order. This is a bragging-rights stat, not a ranking that affects real standings.

### 3.4 Best Pick / Bust of the Pool
Scope: the **union of all drafted teams** across all 7 participants (not all 48 tournament teams — only teams someone actually picked). Duplicate picks (a team drafted by multiple players) count once.

- **Best Pick** = drafted team with the highest `calcTeamScore`.
- **Bust of the Pool** = drafted team with the lowest `calcTeamScore`.
- Display shows the team plus which participant(s) drafted them (there can be more than one).
- Tiebreak: same rule as 3.2 (score → goals → alphabetical).

## 4. UI Layout

New `<main id="results-view" class="hidden">` sibling to `#leaderboard` and `#matches-view`, following the same `.hidden` toggle convention as `switchView()`.

Sections, top to bottom:

1. **Podium** — 3 stacked cards for 1st/2nd/3rd, reusing `.card`, `.medal`, `.rank-1/2/3` styles from Standings so gold/silver/bronze treatment is visually consistent. Shows name + final score only (no team breakdown — that's what Standings is for).

2. **The Perfect Bracket** — 4 rows, one per pot. Each row: pot number/label, the 2 team flags + names, and their scores. Reuses `.team-row` styling from the existing breakdown component.

3. **How Close Did You Get?** — one collapsible row per participant (reusing the `.card` expand/collapse interaction already wired up for Standings cards):
   - Collapsed: name, a dot-meter (`●` for matched, `○` for not, out of 8), and "N/8 matched."
   - Expanded: which specific teams matched, each as a flag + name (checkmark styling).
   - Sorted by match count descending.

4. **Best Pick / Bust callouts** — two side-by-side (or stacked on mobile) cards: 🔥 Best Pick and 💀 Bust of the Pool, each showing team, score, and drafting participant(s).

Clicking any team flag anywhere in Results opens the existing score-breakdown modal (`showScoreModal()`), same as in Standings — no new modal needed.

## 5. Non-Goals (Out of Scope)

- No new API calls or data fields.
- No changes to the actual scoring engine or pool standings.
- No historical/time-series charts.
- No edit/admin capability — this is read-only, same as the rest of the app.
- Full final standings table is **not** duplicated here — Podium is intentionally condensed to top 3; the full list stays on the Standings tab.

## 6. Open Risk / Edge Cases

- **Ties in perfect-bracket selection or best/worst pick**: handled by the deterministic tiebreak in 3.2/3.4 — acceptable for a bragging-rights feature, no need for a "co-best" display.
- **A team with 0 drafted picks** can't be Best Pick/Bust since scope is limited to drafted teams (3.4) — this is intentional, avoids surfacing a team nobody picked as the "story."
- **Pre-final placeholder**: relies on the `matches.json` FINAL match reaching `FINISHED` status; if the API's stage naming changes this could fail silently and show "in progress" forever — low risk since Standings/Matches already depend on the same stage strings.
