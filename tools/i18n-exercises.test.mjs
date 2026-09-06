import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const catalogue = JSON.parse(fs.readFileSync(new URL('../locales/source/exercises.json', import.meta.url), 'utf8'));
const source = fs.readFileSync(new URL('../exercises.js', import.meta.url), 'utf8');
function setup(extra = {}, unavailable = false) {
  const entries = { ...catalogue, ...extra };
  let locale = 'fi';
  const stored = new Map();
  const I18n = {
    locale: () => locale,
    setLocale: value => { locale = value; },
    english: key => entries[key]?.en,
    t: (key, params = {}) => (entries[key]?.[locale] || key).replace(/\{(\w+)\}/g, (all, key) => params[key] ?? all)
  };
  const context = { I18n, GYM_I18N_CATALOG: { entries }, localStorage: {
    getItem: key => { if (unavailable) throw Error('disabled'); return stored.get(key); },
    setItem: (key, value) => { if (unavailable) throw Error('disabled'); stored.set(key, value); }
  } };
  vm.runInNewContext(source, context);
  return I18n;
}

test('all built-in explanations have independent translated names and instructions', () => {
  const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const library = vm.runInNewContext('(' + app.match(/const EX_LIBRARY = (\{[\s\S]*?\n\});/)[1] + ')');
  const api = setup();
  for (const [name, description] of Object.entries(library)) {
    const key = 'exercises.' + name.replace(/[^a-z0-9]+/g, '_');
    assert.ok(catalogue[key + '.name']?.fi, name);
    assert.equal(api.explanation(name, description), catalogue[key + '.description'].fi, name);
    api.setLocale('en');
    assert.equal(api.exercise(name), name);
    assert.equal(api.explanation(name, description), description);
    api.setLocale('fi');
  }
});

test('all starter exercise and alternate names resolve', () => {
  const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const starter = app.slice(app.indexOf('function defaultPlan()'), app.indexOf('/* ================= state'));
  const names = [...starter.matchAll(/(?:ex\(|\{ name: )'([^']+)'/g)].map(match => match[1]);
  const api = setup();
  for (const name of names) assert.notEqual(api.exercise(name), name, name);
  assert.equal(api.pendingExercises().length, 0);
});

test('recognizes specific movements before broader matches and retains every modifier', () => {
  const api = setup();
  assert.equal(api.exercise('Incline Dumbbell Bench Press'), 'Vinopenkkipunnerrus käsipainoilla');
  assert.equal(api.exercise('Cable Triceps Extension — Single-Arm'), 'Ojentajapunnerrus — taljassa, yhdellä kädellä');
  assert.equal(api.exercise('Weighted Pull-Ups'), 'Leuanveto myötäotteella — lisäpainolla');
  assert.equal(api.exercise('Assisted Chin-Up'), 'Leuanveto vastaotteella — avustettuna');
  assert.notEqual(api.exercise('Reverse Pec Deck'), api.exercise('Pec Deck'));
  assert.notEqual(api.exercise('Front Squat'), api.exercise('Squat'));
  assert.notEqual(api.exercise('Split Squat'), api.exercise('Lunge'));
  assert.equal(catalogue['exercises.lunge.description'].fi.includes('taakse taaksepäin'), false);
});

test('unknown qualifiers and substrings remain intact and enter a deduplicated queue', () => {
  const api = setup();
  for (const name of ['Press', 'Squatfish', 'Bench Press Rehab Protocol', 'Lunge Complex']) {
    assert.equal(api.exercise(name), name);
    assert.equal(api.exercise(name.toUpperCase()), name.toUpperCase());
  }
  assert.equal(api.pendingExercises().length, 4);
  assert.equal(JSON.parse(api.exportPendingExercises()).length, 4);
});

test('custom instructions survive generic matches and accept supplied or reviewed translations', () => {
  const api = setup();
  const instruction = 'Pause three seconds on each rep.';
  assert.equal(api.explanation('Squat', instruction), instruction);
  assert.equal(api.explanation('Squat', instruction, { fi: { description: 'Pysähdy kolmeksi sekunniksi jokaisella toistolla.' } }), 'Pysähdy kolmeksi sekunniksi jokaisella toistolla.');
  api.exercise('Custom Move');
  api.setExerciseTranslation('Custom Move', { fi: { name: 'Oma liike' } });
  assert.equal(api.exercise('CUSTOM MOVE'), 'Oma liike');
  assert.equal(api.pendingExercises().length, 1);
  api.setExerciseTranslation('Squat', { fi: { description: 'Pysähdy kolmeksi sekunniksi jokaisella toistolla.' } });
  assert.equal(api.pendingExercises().length, 0);
});

test('new reviewed catalogue names and descriptions resolve without runtime changes', () => {
  const api = setup({
    'exercises.imported_ab123.name': { en: 'Special Row Variant', fi: 'Erityinen soutuvariaatio' },
    'exercises.imported_ab123.description': { en: 'Custom instruction.', fi: 'Oma ohje.' }
  });
  assert.equal(api.exercise('Special Row Variant'), 'Erityinen soutuvariaatio');
  assert.equal(api.explanation('Special Row Variant', 'Custom instruction.'), 'Oma ohje.');
});

test('display works when local storage is unavailable', () => {
  const api = setup({}, true);
  assert.equal(api.exercise('Bench Press'), 'Penkkipunnerrus');
  assert.equal(api.exercise('Unrecognized'), 'Unrecognized');
});

test('reverse Finnish dictionary names for English display without changing stored identity', () => {
  const api = setup();
  assert.equal(api.exercise('Penkkipunnerrus'), 'Penkkipunnerrus');
  api.setLocale('en');
  assert.equal(api.exercise('Penkkipunnerrus'), 'Bench Press');
  assert.equal(api.exercise('Bench Press'), 'Bench Press');
  assert.equal(api.explanation('Penkkipunnerrus', null), api.english('exercises.bench_press.description'));
  assert.equal(api.explanation('Penkkipunnerrus', 'Stored coach cue.'), 'Stored coach cue.');
});

test('supplied and reviewed English exercise translations work before locale fallback', () => {
  const api = setup();
  api.setLocale('en');
  assert.equal(api.exercise('Coach Movement', { en: { name: 'Coach Movement (English)' } }), 'Coach Movement (English)');
  assert.equal(api.explanation('Squat', 'Built-in cue.', { en: { description: 'English coach cue.' } }), 'English coach cue.');
  api.setExerciseTranslation('Custom Move', { en: { name: 'Custom English', description: 'Custom English cue.' } });
  assert.equal(api.exercise('Custom Move'), 'Custom English');
  assert.equal(api.explanation('Custom Move', 'fallback'), 'Custom English cue.');
});
