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
