import assert from 'node:assert/strict';
export async function checkExerciseLibrary(page, context) {
  await page.evaluate(() => {
    endSession(); closeModal(); I18n.setLocale('en'); settings.autoSync=false;
    plan=normalizePlan({days:[{id:'library-day',name:'Library test',exercises:[
      {name:'Legacy press',superset:'A',movementId:'existing-explicit',side:'right',setupId:'Old machine',loadProfile:{unit:'kg',offset:0,increment:7}},
      {name:'Legacy row',superset:'A'}]}]});
    savePlan(); tab='plan'; expandedDay='library-day'; render();
  });
  const original=await page.evaluate(()=>JSON.stringify(plan.days[0].exercises));
  await page.click('[data-action="ex-add"]');
  await page.fill('#library-query','shoulder press');
  await page.selectOption('#library-category','press');
  await page.getByRole('button',{name:/One Arm Seated Dumbbell Shoulder Press/}).click();
  await page.getByRole('button',{name:'Use library name',exact:true}).click();
  assert.equal(await page.inputValue('#f-equipment'),'dumbbell');
  await page.locator('#modal-root details summary').click();
  await page.selectOption('#f-side','left');
  await page.fill('#f-setupId','Bench 2');
  await page.fill('#f-weight','10');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  assert.equal(await page.evaluate(()=>JSON.stringify(plan.days[0].exercises.slice(0,2))),original);
  assert.match(await page.evaluate(()=>ExerciseLibrary.instructions(plan.days[0].exercises[2],I18n.explanation,lookupExplanation)),/Brace/);
  await page.evaluate(()=>exEditModal('library-day',2));
  await page.fill('#f-desc','Stop at eye level.');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  assert.equal(await page.evaluate(()=>ExerciseLibrary.instructions(plan.days[0].exercises[2],I18n.explanation)),'Stop at eye level.');
  await page.click('[data-action="ex-add"]');
  await page.fill('#library-query','My unfamiliar press');
  await page.getByRole('button',{name:'Create custom entry',exact:true}).click();
  await page.fill('#custom-description','Keep the custom cue.');
  await page.selectOption('#custom-equipment','machine');
  await page.getByRole('button',{name:'Continue to plan settings',exact:true}).click();
  await page.locator('#modal-root details summary').click();
  await page.fill('#f-increment','7');
  await page.fill('#f-weight','28');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  const customId=await page.evaluate(()=>plan.days[0].exercises[3].movementId);
  await page.click('[data-action="ex-add"]');
  await page.fill('#library-query','Local nickname');
  await page.getByRole('button',{name:'Create custom entry',exact:true}).click();
  await page.selectOption('#custom-link',customId);
  await page.getByRole('button',{name:'Continue to plan settings',exact:true}).click();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  assert.equal(await page.evaluate(()=>plan.days[0].exercises[4].movementId),customId);
  assert.equal(await page.evaluate(()=>Object.keys(aliases).includes('local nickname')),false);
  // Editing an older snapshot must retain aliases registered more recently.
  await page.evaluate(()=>exEditModal('library-day',3));
  await page.getByRole('button',{name:'Save',exact:true}).click();
  assert.ok(await page.evaluate(()=>plan.library.some(e=>e.aliases.includes('Local nickname'))));
  const beforeRestore = await page.evaluate(()=>plan);
  await page.evaluate(()=>restoreBackup(buildBackup()));
  assert.deepEqual(await page.evaluate(()=>plan),JSON.parse(JSON.stringify(beforeRestore)));
  await page.evaluate(()=>{
    const exportPlan=JSON.parse(buildExport()).currentPlan;
    if(!exportPlan.library.some(e=>e.aliases.includes('Local nickname'))) throw Error('Export lost alias');
    const normalized=normalizePlan(exportPlan);
    if(normalized.days[0].exercises[2].description!=='Stop at eye level.') throw Error('Override lost');
    try { normalizePlan({days:[{exercises:[{name:'Broken',movementId:'x',libraryEntry:{id:'y'}}]}]}); throw Error('Accepted invalid reference'); }
    catch(e) { if(e.message==='Accepted invalid reference') throw e; }
  });
  let pushed;
  await page.route('https://api.gymtrack.hithitpull.fi/**',route=>{
    if(route.request().method()==='POST') pushed=JSON.parse(route.request().postData());
    return route.fulfill({status:200,contentType:'application/json',body:'{}'});
  });
  await page.evaluate(()=>workerPush({silent:true}));
  assert.ok(pushed.plan.library.some(e=>e.id===customId));
  const stored=await page.evaluate(()=>localStorage.getItem('gym.plan'));
  await context.setOffline(true); await page.reload();
  assert.equal(await page.evaluate(()=>localStorage.getItem('gym.plan')),stored);
  await page.evaluate(()=>{I18n.setLocale('fi');exerciseLibraryModal('library-day');});
  assert.equal(await page.getByText('Liikekirjasto',{exact:true}).count(),1);
  await page.fill('#library-query','Local nickname');
  assert.equal(await page.locator('[data-library-id]').count(),1);
  await page.fill('#library-query',''); await page.selectOption('#library-category','press');
  assert.match(await page.locator('#library-results').textContent(),/Istuen|istuen/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(await page.evaluate(()=>I18n.missingKeys()),[]);
  await page.waitForTimeout(200);
  await page.screenshot({path:'tmp/exercise-library-fi.png',fullPage:true});
  await context.setOffline(false);
  await page.evaluate(()=>{closeModal();I18n.setLocale('en');});
  const remote = await page.evaluate(()=>{
    const b=JSON.parse(buildBackup()); b.plan=normalizePlan({days:[{name:'Replacement',exercises:[]}]});
    b.updatedAt=Date.now()+1000; return b;
  });
  await page.route('https://api.gymtrack.hithitpull.fi/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(remote)}));
  await page.evaluate(()=>workerReconcile());
  assert.ok(await page.evaluate(()=>plan.library.some(e=>e.aliases.includes('Local nickname'))));
  assert.equal(await page.evaluate(()=>plan.days[0].name),'Replacement');
  console.log('Library browser checks passed: variants, explicit aliases, custom entries, overrides, backup/export/sync reconciliation and offline Finnish browsing.');
}
