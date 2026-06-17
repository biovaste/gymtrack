#!/usr/bin/env node
/*
 * push-plan.mjs — push a workout plan from this desktop into the GymTrack
 * GitHub gist, so the mobile app loads it automatically on next launch.
 *
 * It does a safe read-modify-write: only the `plan` is replaced; your logged
 * sessions and body-weight history in the gist are preserved. The sync
 * timestamp is bumped so the app knows the cloud copy is newer and pulls it.
 *
 * Usage:
 *   node tools/push-plan.mjs path/to/plan.json     # plan from a file
 *   echo '<workout-plan json>' | node tools/push-plan.mjs   # or via stdin
 *
 * Env vars:
 *   GIST_ID   optional — skip auto-discovery and target this gist id
 *   GH        optional — path to the gh executable
 *
 * Requires the GitHub CLI (`gh`) authenticated with the `gist` scope.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GH = process.env.GH || (process.platform === 'win32' ? 'C:\\Program Files\\GitHub CLI\\gh.exe' : 'gh');
const FILENAME = 'gymtrack-data.json';

function gh(args, input) {
  return execFileSync(GH, args, { input, encoding: 'utf8', maxBuffer: 1 << 25 });
}
const ghJson = path => JSON.parse(gh(['api', path, '-H', 'Accept: application/vnd.github+json']));

function findGistId() {
  if (process.env.GIST_ID) return process.env.GIST_ID;
  const list = ghJson('/gists?per_page=100'); // newest first
  const hit = list.find(g => g.files && g.files[FILENAME]);
  if (!hit) {
    console.error('✗ No GymTrack gist found on this GitHub account.\n' +
      '  Enable cloud sync in the app on your phone first (Claude tab → paste a\n' +
      '  token with the "gist" scope → Save), then run this again. Or pass GIST_ID=<id>.');
    process.exit(1);
  }
  return hit.id;
}

function readNewPlan() {
  const file = process.argv[2];
  let raw = (file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8'));
  raw = raw.replace(/^﻿/, '').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const plan = JSON.parse(raw);
  if (plan.type && plan.type !== 'workout-plan') throw new Error('Plan JSON "type" must be "workout-plan".');
  if (!Array.isArray(plan.days) || !plan.days.length) throw new Error('Plan needs a non-empty "days" array.');
  return plan;
}

async function main() {
  const id = findGistId();
  const gist = ghJson('/gists/' + id);
  const f = gist.files && gist.files[FILENAME];
  if (!f) throw new Error(`Gist ${id} has no ${FILENAME}.`);

  let content = f.content;
  if (f.truncated && f.raw_url) content = await (await fetch(f.raw_url)).text(); // >1MB gists are truncated inline

  let backup;
  try { backup = JSON.parse(content); } catch { backup = null; }
  if (!backup || backup.type !== 'gymtrack-backup') throw new Error('Gist content is not a GymTrack backup.');

  const newPlan = readNewPlan();
  const keptSessions = (backup.sessions || []).length;
  const keptBw = (backup.bodyWeight || []).length;
  const oldPlan = backup.plan && backup.plan.name;

  backup.plan = newPlan;                       // app normalizes this on pull
  backup.updatedAt = Date.now();               // mark cloud copy as newest
  backup.exportedAt = new Date().toISOString();

  const body = { files: { [FILENAME]: { content: JSON.stringify(backup, null, 2) } } };
  const tmp = join(tmpdir(), 'gymtrack-push-' + Date.now() + '.json');
  writeFileSync(tmp, JSON.stringify(body));
  try { gh(['api', '-X', 'PATCH', '/gists/' + id, '--input', tmp]); }
  finally { unlinkSync(tmp); }

  console.log(`✓ Pushed plan "${newPlan.name || '(unnamed)'}" — ${newPlan.days.length} day(s) — to gist ${id}.`);
  console.log(`  Kept ${keptSessions} session(s) and ${keptBw} body-weight entr${keptBw === 1 ? 'y' : 'ies'}; replaced previous plan "${oldPlan || '—'}".`);
  console.log('  Open the GymTrack app on your phone — it loads the new plan on launch.');
}

main().catch(e => { console.error('✗ ' + e.message); process.exit(1); });
