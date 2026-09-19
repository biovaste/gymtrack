import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../i18n.js', import.meta.url), 'utf8');
function boot({ saved, browser = 'fi-FI', storageFails = false, hostname = 'gymtrack.hithitpull.fi', lang } = {}) {
  const storage = new Map(saved ? [['gym.language', saved]] : []);
  const ctx = vm.createContext({
    Intl, URLSearchParams, navigator: { languages: [browser] }, location: { hostname, port: '', search: '' },
    localStorage: { getItem: key => { if (storageFails) throw Error(); return storage.get(key); }, setItem: (key, value) => { if (storageFails) throw Error(); storage.set(key, value); } },
    GYM_I18N_CATALOG: { entries: {
      'settings.sound.on': { en: 'On', fi: 'Ääni käytössä' },
      'settings.sync.on': { en: 'On', fi: 'Synkronointi käytössä' },
      'workout.saved': { en: 'Saved {name}', fi: 'Tallennettu: {name}' },
      'draft.message': { en: 'Draft', fi: 'Luonnos', status: 'draft' }
    } }
  });
  vm.runInContext(source, ctx);
  return { api: ctx.I18n, storage };
}

test('same source in different contexts resolves independently; drafts are live', () => {
  const { api } = boot({ saved: 'fi' });
  assert.equal(api.t('settings.sound.on'), 'Ääni käytössä');
  assert.equal(api.t('settings.sync.on'), 'Synkronointi käytössä');
  assert.equal(api.t('draft.message'), 'Luonnos');
});
test('explicit language survives boot and switching does not touch workout data', () => {
  const { api, storage } = boot({ saved: 'en' });
  storage.set('gym.active', '{"exercise":"Bench Press","weight":80}');
  assert.equal(api.t('settings.sound.on'), 'On');
  api.setLocale('fi');
  assert.equal(storage.get('gym.language'), 'fi');
  assert.equal(storage.get('gym.active'), '{"exercise":"Bench Press","weight":80}');
  assert.equal(api.setLocale('invalid'), false);
  assert.equal(api.locale(), 'fi');
});
test('interpolation is plain text and does not recursively interpolate values', () => {
  const { api } = boot({ saved: 'fi' });
  assert.equal(api.t('workout.saved', { name: '<img>{name}&' }), 'Tallennettu: <img>{name}&');
});
test('Finnish formatting and decimal parsing do not reinterpret stored units', () => {
  const { api } = boot({ saved: 'fi' });
  assert.equal(api.number(12.5), '12,5');
  assert.equal(api.parseNumber('12,5'), 12.5);
  assert.equal(api.parseNumber('12.5'), 12.5);
  assert.equal(api.parseNumber(''), null);
  assert.equal(api.parseNumber('12kg'), null);
  assert.equal(api.parseNumber('1,2,3'), null);
  assert.equal(api.plural(1), 'one');
  assert.equal(api.plural(2), 'other');
});
test('denied storage still permits a session language choice', () => {
  const { api } = boot({ storageFails: true });
  assert.equal(api.setLocale('en'), true);
  assert.equal(api.t('draft.message'), 'Draft');
});


test('both coaching prompts expose the current schema in English and Finnish', () => {
  const ctx=vm.createContext({Intl,navigator:{language:'en'},localStorage:{getItem:()=>null,setItem:()=>{}}});
  vm.runInContext(readFileSync(new URL('../locales/catalog.js',import.meta.url),'utf8'),ctx);
  vm.runInContext(source,ctx);
  const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const prompts=app.slice(app.indexOf('const coachPlanSchema ='),app.indexOf('async function copyText'));
  vm.runInContext("const unit=()=> 'kg'; const tr=(key,args)=>I18n.t(key,args);"+prompts,ctx);
  for(const language of ['en','fi']) {
    ctx.I18n.setLocale(language);
    for(const expression of ['AI_PROMPT()', 'AI_URL_PROMPT("https://example.test/data")']) {
      const result=vm.runInContext(expression,ctx);
      for(const field of ['libraryEntry','movementId','loadProfile','warmupSets','durationSeconds','distanceMeters','speedKph']) assert.ok(result.includes(field),language+': '+field);
      assert.equal(result.includes('{schema}'),false);
      assert.equal(result.includes('{unit}'),false);
      assert.doesNotMatch(result,/Claude/);
    }
  }
});

test('track defaults: personal is English, alpha is Finnish, each keeps its own choice', () => {
  assert.equal(boot({ browser: 'fi-FI' }).api.locale(), 'en');
  const alpha = boot({ hostname: 'alpha.gymtrack.hithitpull.fi', browser: 'en-GB' });
  assert.equal(alpha.api.locale(), 'fi');
  alpha.api.setLocale('en');
  assert.equal(alpha.storage.get('gym_alpha.language'), 'en');
  assert.equal(alpha.storage.has('gym.language'), false);
});
