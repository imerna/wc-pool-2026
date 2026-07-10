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
