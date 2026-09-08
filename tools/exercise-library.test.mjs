import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import Library from '../exercise-library.js';
import Model from '../workout-model.js';
const entry = { ...Library.builtins[0], id: 'custom:press', name: 'My press', aliases: ['Push thing'], description: 'Pause at the bottom.' };

test('library selection is explicit and retains independent side/setup identity', () => {
  const selected = Library.attach(entry);
  assert.notEqual(Model.key(selected), Model.key({name: entry.name}));
  assert.equal(Model.key(selected), Model.key(Library.attach(entry, 'Push thing')));
  for (const change of [{side:'left'}, {side:'right'}, {setupId:'Machine 2'}, {equipment:'machine'}]) assert.notEqual(Model.key(selected), Model.key({...selected,...change}));
  selected.libraryEntry.aliases.push('new');
  assert.deepEqual(entry.aliases,['Push thing']);
});
test('search finds aliases and filters without reordering plan/supersets', () => {
  const plan = {library:[entry],days:[{exercises:[{...Library.attach(entry),superset:'A'},{name:'Legacy',superset:'A'}]}]};
  const before=JSON.stringify(plan);
  assert.equal(Library.search(Library.entries(plan),'push thing')[0].id,entry.id);
  assert.equal(Library.search([entry],'','cardio').length,0);
  assert.equal(Library.search([entry],'','','chest').length,1);
  assert.equal(JSON.stringify(plan),before);
});
test('instructions inherit snapshots and preserve prescription overrides', () => {
  const ex=Library.attach(entry);
  assert.equal(Library.instructions(ex),entry.description);
  assert.equal(Library.instructions({...ex,description:'Use half range.'}),'Use half range.');
  const copied=JSON.parse(JSON.stringify(Model.metadata(ex)));
  entry.description='Changed default';
  assert.equal(Library.instructions(copied),'Pause at the bottom.');
  entry.description='Pause at the bottom.';
});
test('custom entries, aliases and snapshots survive replacement plan and JSON round trips', () => {
  const old={library:[entry],days:[]};
  const incoming={days:[{exercises:[{...Library.attach(entry),description:'Plan cue',loadProfile:{unit:'kg',offset:0,increment:7},side:'left',setupId:'Stack'}]}]};
  incoming.library=Library.importLibrary(old,incoming);
  const restored=JSON.parse(JSON.stringify(incoming));
  assert.deepEqual(restored.library,[entry]);
  assert.deepEqual(Model.errors(restored.days[0].exercises[0]),[]);
  assert.equal(Library.instructions(restored.days[0].exercises[0]),'Plan cue');
  assert.deepEqual(Library.importLibrary(restored,{days:[]}),[entry]);
  assert.deepEqual(Model.libraryListErrors([entry,entry]),['library duplicate id']);
  assert.ok(Model.errors({...Library.attach(entry),movementId:'different'}).length);
  assert.ok(Model.errors({libraryEntry:{id:'broken'}}).length);
});
test('curated entries reuse translated catalogue descriptions and discovery aliases', () => {
  const ctx=vm.createContext({localStorage:{getItem:()=>null,setItem:()=>{}},navigator:{language:'en'}});
  for(const path of ['locales/catalog.js','i18n.js','exercises.js','exercise-library.js']) vm.runInContext(readFileSync(new URL('../'+path,import.meta.url),'utf8'),ctx);
  const {ExerciseLibrary:L,I18n}=ctx;
  for(const item of L.builtins) {
    assert.deepEqual(Model.libraryErrors(item),[]);
    assert.ok(item.description, item.name+' needs default instructions');
    I18n.setLocale('fi');
    assert.notEqual(I18n.exercise(item.name),item.name,item.name+' needs Finnish display');
    assert.ok(L.instructions(L.attach(item),I18n.explanation));
  }
  I18n.setLocale('en');
  assert.equal(L.search(L.builtins,'rdl','','',I18n.exercise,I18n.exerciseSearchNames)[0].name,'Romanian Deadlift');
  assert.equal(L.search(L.builtins,'penkkipunnerrus','','',I18n.exercise,I18n.exerciseSearchNames).length>0,true);
});
