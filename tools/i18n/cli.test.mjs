import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pending, applyDrafts } from './cli.mjs';
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
