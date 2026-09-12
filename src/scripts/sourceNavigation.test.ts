import {findNoteRange} from './sourceNavigation';
function check(source: string, text: string, stepIndex: number, expected: string | null, expectedStart?: number) {
  const range = findNoteRange(source, text, stepIndex);
  const actual = range ? source.slice(...range) : null;
  if (actual !== expected) throw new Error(`Chapter selection: ${actual} != ${expected}`);
  if (expectedStart !== undefined && range?.[0] !== expectedStart) throw new Error(`Wrong chapter position: ${range?.[0]} != ${expectedStart}`);
}
check('{"steps":[{"note":"Build"}]}', 'Build', 1, '"Build"');
check('// "note":"Fake"\n{"steps":[{"note":"Build"}]}', 'Fake', 1, null);
check('{"steps":[{"note" /* a comment */ : "Build"}]}', 'Build', 1, '"Build"');
check(String.raw`{"steps":[{"note":"\u00e9dition"}]}`, String.fromCharCode(233) + 'dition', 1, String.raw`"\u00e9dition"`);
const repeated = '{"steps":[{"note":"Repeat"},{"note":"Repeat"}]}';
check(repeated, 'Repeat', 2, '"Repeat"', repeated.lastIndexOf('"Repeat"'));
check(repeated, 'Repeat', 3, null);
check(String.raw`{"steps":[{"note":"Quoted \"word\""}]}`, 'Quoted "word"', 1, String.raw`"Quoted \"word\""`);
const misleading = '{"note":"Build","steps":[{"let":{"note":"Build","nested":[{"note":"Build"}]}},{"note":"Build"}],"checks":[{"note":"Build"}]}';
check(misleading, 'Build', 2, '"Build"', misleading.indexOf('"Build"}],"checks"'));
check(misleading, 'Build', 1, null);
check('{"exports":{"steps":[{"note":"Build"}]},"steps":[{"note":"Actual"}]}', 'Build', 1, null);
check('{"steps":[{"let":{"note":"other","values":[1,2,3]}},{"note":"🛠 Build"}]}', '🛠 Build', 2, '"🛠 Build"');
check('{"steps":[{"note":"Build"}]}', 'Build', 0, null);
check('{"steps":[{"note":"Build"}]}', 'Build', 1.5, null);
const duplicateKeys = '{"steps":[{"note":"Build"}],"steps":[{"note":"Build","note":"Build"}]}';
check(duplicateKeys, 'Build', 1, '"Build"', duplicateKeys.lastIndexOf('"Build"'));
check('{"steps":[{"note":"Build","note":"Changed"}]}', 'Build', 1, null);
console.log('PASS source chapter selection: exact step positions, comments, Unicode, escaped/repeated notes, nested arguments and metadata');
