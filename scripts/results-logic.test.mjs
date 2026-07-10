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
