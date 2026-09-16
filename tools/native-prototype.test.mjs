import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import Core from '../shared/workout-core.js';
import drafts from '../shared/workout-drafts.js';
import groups from '../shared/workout-groups.js';
import Ladder from '../shared/load-ladder.js';
import storage from '../mobile/src/storage/repository.js';
import sync from '../mobile/src/sync/test-transport.js';
import rest from '../shared/rest-controller.js';
const current=JSON.parse(readFileSync(new URL('./fixtures/native/current-plan.json',import.meta.url)));
const legacy=readFileSync(new URL('./fixtures/native/legacy-backup.json',import.meta.url),'utf8');
test('superset rounds preserve sides, original indices, unequal sets and nonadjacent tags',()=>{
 const a=Core.start(Core.normalizePlan(current),0,'groups',1000);
 const before=JSON.stringify(a);
 const g=groups.workoutGroups(a.exercises);
 assert.deepEqual(g[0].members,[0,1]);
 assert.deepEqual(g[0].rounds[0].items,[{ei:0,indices:[0]}]);
 assert.deepEqual(g[0].rounds[1].items,[{ei:0,indices:[1]},{ei:1,indices:[0]}]);
 assert.deepEqual(g[0].rounds[2].items,[{ei:0,indices:[2]},{ei:1,indices:[1]}]);
 assert.equal(JSON.stringify(a),before);
 a.exercises[1].sets.pop();a.exercises[3].superset='A';
 const shorter=groups.workoutGroups(a.exercises);
 assert.deepEqual(shorter[0].rounds[2].items,[{ei:0,indices:[2]}]);
 assert.equal(shorter[2].tag,null);
 const indices=shorter.flatMap(g=>g.rounds.flatMap(r=>r.items.flatMap(x=>x.indices.map(si=>x.ei+':'+si))));
 assert.equal(new Set(indices).size,a.exercises.reduce((n,e)=>n+e.sets.length,0));
});
test('latest numeric and note drafts are included before logging and completing',()=>{
 const active=Core.start(Core.normalizePlan(current),0,'draft-session',1000);
 const updated=drafts.applyDrafts(active,{'0:1:weight':'35,5','0:1:reps':'9','notes':'Latest typed note'});
 const record=Core.finish(Core.toggleSet(updated,0,1),61000);
 assert.equal(record.exercises[0].sets[0].weight,35.5);
 assert.equal(record.exercises[0].sets[0].reps,9);
 assert.equal(record.notes,'Latest typed note');
 assert.equal(active.exercises[0].sets[1].weight,28);
 for(const text of ['no','1.2.3','Infinity','-1','1e3'])assert.throws(()=>drafts.applyDrafts(active,{'0:1:weight':text}),/invalidSet/);
 assert.throws(()=>drafts.applyDrafts(active,{'0:1:reps':'2.5'}),/invalidSet/);
 assert.throws(()=>drafts.applyDrafts(active,{'0:1:rpe':'11'}),/invalidSet/);
});
test('edited measurements round-trip without changing side/setup identity or input fixtures',()=>{
 const a=Core.start(Core.normalizePlan(current),0,'measurements',1000);
 const edits=[
  [0,1,{weight:35.5,reps:9,rpe:7.5}],
  [1,0,{weight:21,reps:11,rpe:8}],
  [2,0,{heightCm:42.5}],
  [3,0,{durationSeconds:47.5,weight:10,rpe:6}],
  [4,0,{distanceMeters:32.5,weight:20,rpe:7}],
  [5,0,{durationSeconds:600,distanceMeters:2000,speedKph:12,rpe:8}],
 ];
 let edited=a;
 for(const [ei,si,values] of edits){
  for(const [field,value] of Object.entries(values))edited=Core.updateSet(edited,ei,si,field,value);
  edited=Core.toggleSet(edited,ei,si);
 }
 const record=JSON.parse(JSON.stringify(Core.finish(edited,61000)));
 for(const [ei,,values] of edits){
  for(const [field,value] of Object.entries(values))assert.equal(record.exercises[ei].sets[0][field],value);
  if(ei>1)assert.equal('reps' in record.exercises[ei].sets[0],false);
 }
 assert.notEqual(Core.Model.key(record.exercises[0]),Core.Model.key(record.exercises[1]));
 assert.equal(a.exercises[0].sets[1].weight,28);
 assert.throws(()=>Core.updateSet(a,2,0,'reps',10),/invalidSet/);
 for(const value of [-1,NaN,Infinity,100001])assert.throws(()=>Core.updateSet(a,3,0,'durationSeconds',value),/invalidSet/);
});
function adapter(path=':memory:'){
 const sql=new DatabaseSync(path);return {sql,execAsync:async s=>sql.exec(s),getFirstAsync:async(s,...p)=>sql.prepare(s).get(...p),getAllAsync:async(s,...p)=>sql.prepare(s).all(...p),runAsync:async(s,...p)=>sql.prepare(s).run(...p)};
}
async function setup(path){const db=adapter(path),repo=new storage.Repository(db);await repo.init();await repo.importBackup(Core.importDocument(legacy),legacy);return {db,repo};}
test('all metric fixtures preserve snapshots and separate sides; completed fields match metric',()=>{
 const p=Core.normalizePlan(current),a=Core.start(p,0,'session',1000);assert.notEqual(Core.Model.key(a.exercises[0]),Core.Model.key(a.exercises[1]));
 assert.equal(a.exercises[0].sets[0].weight,14);assert.equal(a.exercises[0].sets[0].warmup,true);
 p.days[0].exercises[0].libraryEntry.description='changed';assert.notEqual(a.exercises[0].libraryEntry.description,'changed');
 let log=a;for(let ei=0;ei<a.exercises.length;ei++){if(a.exercises[ei].metric==='height')log=Core.updateSet(log,ei,0,'heightCm',30);log=Core.toggleSet(log,ei,0);}
 const record=Core.finish(log,61000);for(const e of record.exercises)if(e.metric!=='load')assert.equal('reps' in e.sets[0],false);
 assert.equal(Core.effort(record).rpe,8);assert.equal(record.exercises[0].sets[0].warmup,true);
 assert.throws(()=>Core.swap(log,0,0),/swapLogged/);
 const swapped=Core.swap(a,0,0);assert.equal(swapped.exercises[0].movementId,'db-press');assert.equal(swapped.exercises[0].loadProfile,undefined);
});
test('legacy backup retains unknown fields, aliases and historical values',()=>{
 const before=JSON.parse(legacy),after=Core.importDocument(legacy);for(const k of ['sessions','aliases','extension','bodyWeight'])assert.deepEqual(after[k],before[k]);
 assert.throws(()=>Core.importDocument(JSON.stringify({...current,version:2})),/invalidPlan/);
 assert.throws(()=>Core.normalizePlan({...current,days:[{exercises:[{name:'bad',sets:Infinity}]}]}),/invalidPlan/);
});
test('extracted kg ladder remains equivalent to browser ladder',()=>{
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');const ctx=vm.createContext({});vm.runInContext(app.slice(app.indexOf('/* LADDER-START */'),app.indexOf('/* LADDER-END */')),ctx);
 for(const eq of ['dumbbell','cable','machine','barbell','trap-bar','other'])for(let w=0;w<100;w+=.5){assert.equal(Ladder.isLoadable(eq,null,w),ctx.isLoadable(eq,null,w));assert.equal(Ladder.nextWeight(eq,null,w,-1),ctx.nextWeight(eq,null,w,-1));}
});
test('SQLite rollback preserves active data and repeated completion stays idempotent across restart',async()=>{
 const path=join(mkdtempSync(join(tmpdir(),'gym-native-')),'test.db');const {db,repo}=await setup(path);let a=Core.start(Core.normalizePlan(current),0,'session',1000);a=Core.toggleSet(a,0,1);await repo.saveActive(a,{endsAt:99000});
 const record=Core.finish(a,61000);const run=db.runAsync;db.runAsync=async(s,...p)=>{if(s.startsWith('INSERT INTO outbox'))throw Error('disk full');return run(s,...p);};
 await assert.rejects(repo.complete(record),/disk full/);assert.equal((await repo.snapshot()).active.id,a.id);assert.equal((await repo.snapshot()).backup.sessions.length,1);
 db.runAsync=run;await repo.complete(record);await repo.complete(record);db.sql.close();
 const reopened=adapter(path),again=new storage.Repository(reopened);await again.init();const s=await again.snapshot();assert.equal(s.backup.sessions.length,2);assert.equal(s.active,null);assert.equal(s.rest,null);assert.equal(s.outbox.length,1);assert.deepEqual(s.backup.sessions[0],JSON.parse(legacy).sessions[0]);reopened.sql.close();
});
test('sync failures retain data; retries and duplicate delivery keep one receiver record',async()=>{
 const {db,repo}=await setup();let a=Core.toggleSet(Core.start(Core.normalizePlan(current),0,'session',1000),0,1);await repo.saveActive(a);await repo.complete(Core.finish(a,61000));
 for(const mode of ['offline','timeout','unauthorized','server','conflict']){await repo.retry(sync.testTransport(db,mode));assert.equal((await repo.snapshot()).outbox[0].status,mode);assert.equal((await repo.snapshot()).backup.sessions.length,2);}
 await repo.retry(sync.testTransport(db,'success'));await sync.testTransport(db,'success')('session',{});assert.equal((await db.getAllAsync('SELECT * FROM test_receiver')).length,1);db.sql.close();
});
test('rest reconciliation cancels obsolete notifications and handles denied/expired states',async()=>{
 const scheduled=new Map();let allowed=true;const scheduler={cancel:async id=>scheduled.delete(id),allowed:async()=>allowed,schedule:async(id,at)=>scheduled.set(id,at)};
 await rest.reconcileRest(scheduler,{endsAt:100},0);await rest.reconcileRest(scheduler,{endsAt:200},0);assert.equal(scheduled.size,1);assert.equal([...scheduled.values()][0],200);
 allowed=false;assert.equal(await rest.reconcileRest(scheduler,{endsAt:200},0),'denied');assert.equal(scheduled.size,0);
 allowed=true;await rest.reconcileRest(scheduler,{endsAt:200},0);await rest.reconcileRest(scheduler,null,0);assert.equal(scheduled.size,0);
 assert.equal(await rest.reconcileRest(scheduler,{endsAt:10},20),'idle');
});

test('rest respects warmups, next-movement prescription and final workout completion',()=>{
 const p=Core.normalizePlan(current);p.days[0].exercises[1].restSecondsNext=90;
 const a=Core.start(p,0,'s',0);a.exercises[0].sets[0].done=true;assert.equal(Core.restAfter(a,0,0,0),undefined);
 for(const e of a.exercises.slice(0,2))for(const s of e.sets)s.done=true;
 assert.equal(Core.restAfter(a,0,1,0).endsAt,90000);
 for(const e of a.exercises)for(const s of e.sets)s.done=true;
 assert.equal(Core.restAfter(a,5,1,0),null);
});
