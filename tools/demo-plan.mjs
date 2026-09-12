/*
 * demo-plan.mjs — write the demo seed's plan half to a JSON file so the existing
 * validator can check it:
 *
 *   node tools/demo-plan.mjs tmp/demo-plan.json
 *   node tools/push-plan.mjs --check tmp/demo-plan.json
 *
 * With no argument it prints the plan to stdout. tools/demo.test.mjs runs both
 * steps automatically, so the demo plan cannot drift away from the ladder and
 * uniqueness rules the phone depends on.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const demoData = require(join(root, 'demo-data.js'));

export const plan = demoData.plan();

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const out = process.argv[2];
  const json = JSON.stringify(plan, null, 2);
  if (!out) { console.log(json); }
  else { mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(resolve(out), json); console.log(`Wrote ${out}`); }
}
