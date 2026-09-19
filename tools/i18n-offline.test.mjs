import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
function harness() {
  const events = {}, deleted = [], requested = [], installed = [];
  const ctx = vm.createContext({
    URL, location: { origin: 'https://example.test' },
    self: { registration: { scope: 'https://example.test/gym/' },
      addEventListener: (type, handler) => { events[type] = handler; },
      clients: { claim: async () => {} } },
    caches: {
      open: async name => ({
        match: async url => ({ body: 'installed version', cache: name, url }),
        addAll: async paths => { installed.push(...paths); }
      }),
      keys: async () => ['gymtrack-old', 'unrelated-app', vm.runInContext('CACHE', ctx)],
      delete: async name => { deleted.push(name); }
    },
    fetch: async req => { requested.push(req.url); return { body: 'new server version' }; }
  });
  vm.runInContext(sw, ctx);
  return { events, deleted, requested, installed };
}
test('offline install includes translation runtime, exercise dictionary and catalogue', async () => {
  const h = harness(); let done;
  h.events.install({ waitUntil: promise => { done = promise; } });
  await done;
  for (const path of ['./exercise-library.js', './workout-model.js', './i18n.js', './exercises.js', './locales/catalog.js', './app-config.js']) assert.ok(h.installed.includes(path));
});
test('cached app and catalogue remain immutable until next worker activation', async () => {
  const h = harness();
  for (const path of ['app.js', 'locales/catalog.js', '']) {
    let response;
    h.events.fetch({ request: { method: 'GET', url: 'https://example.test/gym/' + path }, respondWith: value => { response = value; } });
    assert.equal((await response).body, 'installed version');
  }
  assert.equal(h.requested.length, 0);
});
test('fresh update probes, external APIs and review tools bypass shell cache', () => {
  const h = harness();
  for (const url of ['https://example.test/gym/app.js?fresh=1', 'https://api.example.test/data', 'https://example.test/api/state']) {
    let captured = false;
    h.events.fetch({ request: { method: 'GET', url }, respondWith: () => { captured = true; } });
    assert.equal(captured, false, url);
  }
});
test('activation retires old GymTrack cache without deleting unrelated applications', async () => {
  const h = harness(); let done;
  h.events.activate({ waitUntil: value => { done = value; } }); await done;
  assert.deepEqual(h.deleted, ['gymtrack-old']);
});
