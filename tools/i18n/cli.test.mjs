import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pending, applyDrafts, releaseCache } from './cli.mjs';
import { edit, reconcile, revision, recordVersion } from './core.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gym-i18n-cli-'));
  await mkdir(path.join(root, 'locales/source'), { recursive: true });
  const source = {
    'ui.hello': { en: 'Hello {name}', context: 'Greeting', screen: 'Home', role: 'label' },
    'ui.save': { en: 'Save', fi: 'Tallenna', context: 'Save button', screen: 'Home', role: 'button' }
  };
  await writeFile(path.join(root, 'locales/source/ui.json'), JSON.stringify(source));
  await writeFile(path.join(root, 'locales/glossary.fi.md'), '');
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, source };
}

test('pending export and apply-drafts preserve manual wording and reject stale revisions', async t => {
  const { root, source } = await fixture(t);
  const [item] = await pending(root);
  await applyDrafts(root, { translations: [{ key: item.key, fi: 'Hei {name}', sourceRevision: item.sourceRevision }] });
  let review = JSON.parse(await readFile(path.join(root, 'locales/fi.review.json'), 'utf8'));
  review = edit(source, review, { key: 'ui.hello', fi: 'Terve {name}', action: 'draft', sourceRevision: revision(source['ui.hello']), version: recordVersion(review.entries['ui.hello']) });
  await writeFile(path.join(root, 'locales/fi.review.json'), JSON.stringify(review));
  await applyDrafts(root, { translations: [{ key: 'ui.hello', fi: 'Hei taas {name}', sourceRevision: revision(source['ui.hello']) }] });
  review = JSON.parse(await readFile(path.join(root, 'locales/fi.review.json'), 'utf8'));
  assert.equal(review.entries['ui.hello'].fi, 'Terve {name}');
  assert.equal(review.entries['ui.hello'].suggestion.fi, 'Hei taas {name}');
  await assert.rejects(applyDrafts(root, { translations: [{ key: 'ui.hello', fi: 'Vanhentunut {name}', sourceRevision: 'stale' }] }), /stale revision/);
});

test('offline cache version is stable across Windows and Unix line endings', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gym-i18n-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'locales'), { recursive: true });
  const assets = ['index.html', 'styles.css', 'app.js', 'workout-model.js', 'exercise-library.js', 'i18n.js', 'exercises.js', 'locales/catalog.js', 'manifest.webmanifest'];
  await Promise.all(assets.map(file => writeFile(path.join(root, file), 'alpha\r\nbeta\r\n')));
  await writeFile(path.join(root, 'sw.js'), "const CACHE = 'gymtrack-i18n-development';\r\nself.value = true;\r\n");
  await releaseCache(root);
  const generated = await readFile(path.join(root, 'sw.js'), 'utf8');
  await Promise.all(assets.map(file => writeFile(path.join(root, file), 'alpha\nbeta\n')));
  await writeFile(path.join(root, 'sw.js'), generated.replace(/\n/g, '\r\n'));
  await releaseCache(root, true);
  await writeFile(path.join(root, 'styles.css'), 'changed\n');
  await assert.rejects(releaseCache(root, true), /Offline app version is stale/);
});
