import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../i18n.js', import.meta.url), 'utf8');
function boot({ saved, browser = 'fi-FI', storageFails = false } = {}) {
  const storage = new Map(saved ? [['gym.language', saved]] : []);
  const ctx = vm.createContext({
    Intl, navigator: { languages: [browser] },
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
  const { api } = boot();
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
  const { api } = boot();
  assert.equal(api.t('workout.saved', { name: '<img>{name}&' }), 'Tallennettu: <img>{name}&');
});
test('Finnish formatting and decimal parsing do not reinterpret stored units', () => {
  const { api } = boot();
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
