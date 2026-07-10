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
  // vm.runInThisContext() runs in the real Node global object, so a lightweight stub is installed on
  // globalThis for loadTestable() to use. Note: unlike the pure computation functions, render functions
  // such as renderResultsView are *returned* here and invoked later by the caller, after this call has
  // already returned — so the stub is intentionally left in place rather than removed in a `finally`
  // block (deleting it immediately would make every returned render function throw
  // "document is not defined" as soon as the caller invoked it). Each loadTestable() call simply
  // installs a fresh stub + elements object, overwriting whatever the previous call left behind.
  const elements = {};
  globalThis.document = {
    getElementById(id) {
      if (!elements[id]) elements[id] = { innerHTML: '', querySelector: () => null };
      return elements[id];
    },
  };
  const result = vm.runInThisContext(
    `(function() {
      ${code}
      return { ${EXPORTED_NAMES.join(', ')} };
    })()`
  );
  return { ...result, elements };
}
