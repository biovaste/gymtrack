// Portable prototype operations. Existing records and unknown extension fields survive imports.
const Model = require('../workout-model.js');
const Library = require('../exercise-library.js');
const Ladder = require('./load-ladder.js');
const clone = value => JSON.parse(JSON.stringify(value));
const fail = code => { throw new Error(code); };
const obj = x => x && typeof x === 'object' && !Array.isArray(x);
function normalizePlan(raw) {
  if (!obj(raw) || (raw.type && raw.type !== 'workout-plan') || (raw.version != null && raw.version !== 1)) fail('invalidPlan');
  if (!Array.isArray(raw.days) || !raw.days.length || (raw.library != null && Model.libraryListErrors(raw.library).length)) fail('invalidPlan');
  JSON.stringify(raw,(_key,value)=>{if(typeof value==='number'&&!Number.isFinite(value))fail('invalidPlan');return value;});
  const p = clone(raw);
  p.type = 'workout-plan'; p.version = 1;
  p.days = p.days.map((d, di) => {
    if (!obj(d) || !Array.isArray(d.exercises) || !d.exercises.length) fail('invalidPlan');
    const warmup = d.warmup || [];
    if (!Array.isArray(warmup)) fail('invalidPlan');
    return {...d, id:d.id || `day-${di}`, name:d.name || `Day ${di+1}`, warmup:warmup.map(w => {
      const item = typeof w === 'string' ? {name:w,detail:''} : w;
      if (!obj(item) || typeof item.name !== 'string' || !item.name.trim()) fail('invalidPlan');
      return item;
    }), exercises:d.exercises.map((e, ei) => {
      if (!obj(e) || !e.name || Model.errors(e).length) fail('invalidPlan');
      if (e.alternates != null && !Array.isArray(e.alternates)) fail('invalidPlan');
      for (const a of e.alternates || []) if (!obj(a) || !a.name || Model.errors(a).length) fail('invalidPlan');
      const sets = e.sets ?? 3, warmupSets = e.warmupSets ?? 0;
      if (!Number.isInteger(sets) || sets < 1 || sets > 100 || !Number.isInteger(warmupSets) || warmupSets < 0 || warmupSets > 20) fail('invalidPlan');
      if (warmupSets && e.metric && e.metric !== 'load') fail('invalidPlan');
      for (const k of ['weight','barWeight','restSeconds','restSecondsNext']) if (e[k] != null && (typeof e[k] !== 'number' || !Number.isFinite(e[k]) || e[k] < 0 || e[k] > 100000)) fail('invalidPlan');
      return {...e,id:e.id || `exercise-${di}-${ei}`,sets,warmupSets,reps:String(e.reps ?? '8-12'),weight:e.weight ?? 0,
        targetRpe:e.targetRpe ?? null,restSeconds:e.restSeconds ?? 120,metric:e.metric || 'load',equipment:e.equipment || 'barbell',
        superset:e.superset ? String(e.superset).trim().toUpperCase().slice(0,2) : null};
    })};
  });
  return p;
}
function importDocument(text) {
  let raw; try { raw = JSON.parse(text); } catch { fail('invalidPlan'); }
  if (raw?.type === 'gymtrack-backup') {
    if (raw.version !== 1 || !Array.isArray(raw.sessions) || !Array.isArray(raw.bodyWeight)) fail('invalidPlan');
    return {...clone(raw),plan:normalizePlan(raw.plan)};
  }
  return {type:'gymtrack-backup',version:1,plan:normalizePlan(raw),sessions:[],bodyWeight:[],settings:{unit:'kg'}};
}
function rows(e) {
  const work = Array.from({length:e.sets},()=>Model.row(e));
  if (e.metric !== 'load' || !e.warmupSets) return work;
  const ramps={1:[.6],2:[.5,.75],3:[.4,.6,.8]};
  const fractions=ramps[e.warmupSets] || Array.from({length:e.warmupSets},(_,i)=>.4+.45*i/(e.warmupSets-1));
  return fractions.map(f=>{
    const target=e.weight*f;
    const weight=e.loadProfile ? Model.nextLoad(e.loadProfile,target+1e-6,-1)
      : e.equipment==='other' ? Math.round(target*2)/2
      : Ladder.isLoadable(e.equipment,e.barWeight,target) ? target : Ladder.nextWeight(e.equipment,e.barWeight,target,-1);
    return {...Model.row(e),weight,warmup:true,rpe:null};
  }).concat(work);
}
function start(plan, dayIndex, id, now) {
  const d=plan.days[dayIndex]; if(!d) fail('invalidPlan');
  return {id,dayId:d.id,dayName:d.name,startedAt:now,notes:'',readiness:{},warmup:clone(d.warmup || []).map(w=>({...w,done:false})),
    exercises:d.exercises.map(e=>({...clone(e),planId:e.id,plannedSets:e.sets,plannedReps:e.reps,plannedWeight:e.weight,swappedFrom:null,notes:'',sets:rows(e)}))};
}
function updateSet(active, ei, si, field, value) {
  const out=clone(active), e=out.exercises[ei], row=e?.sets[si]; if(!row) fail('invalidSet');
  const fields=e.metric==='height' ? ['heightCm'] : Model.timed(e) ? ['weight','durationSeconds','distanceMeters','speedKph','rpe'] : ['weight','reps','rpe'];
  if (!fields.includes(field) || (value != null && (!Number.isFinite(value) || value < 0 || value > 100000 || (field==='rpe' && (value < 1 || value > 10)) || (field==='reps' && !Number.isInteger(value))))) fail('invalidSet');
  row[field]=value; return out;
}
function toggleSet(active, ei, si) {
  const out=clone(active), e=out.exercises[ei], s=e.sets[si];
  if(!s.done) {
    const required=e.metric==='height'?['heightCm']:e.metric==='duration'?['durationSeconds']:e.metric==='distance'?['distanceMeters']:e.metric==='cardio'?[]:['reps'];
    if(required.some(k=>!(s[k]>0)) || (e.metric==='cardio' && !['durationSeconds','distanceMeters','speedKph'].some(k=>s[k]>0))) fail('invalidSet');
  }
  s.done=!s.done; return out;
}
function swap(active, ei, ai) {
  const out=clone(active), e=out.exercises[ei], a=e.alternates?.[ai];
  if(!a || e.sets.some(s=>s.done)) fail('swapLogged');
  const merged={...e,...clone(a),equipment:a.equipment || e.equipment,metric:a.metric || e.metric,sets:e.plannedSets,warmupSets:0};
  for(const k of ['movementId','side','setupId','loadProfile','libraryEntry','durationSeconds','distanceMeters','speedKph']) if(a[k]==null) delete merged[k];
  merged.plannedWeight=merged.weight; merged.swappedFrom=e.name; merged.sets=rows(merged); out.exercises[ei]=merged; return out;
}
function restAfter(active, ei, si, now) {
  const e=active.exercises[ei], set=e.sets[si];
  if(!set.done || set.warmup)return undefined;
  if(!active.exercises.some(x=>x.sets.some(s=>!s.done)))return null;
  let seconds=e.restSeconds;
  if(e.superset){
    let lo=ei,hi=ei;
    while(lo>0&&active.exercises[lo-1].superset===e.superset)lo--;
    while(hi+1<active.exercises.length&&active.exercises[hi+1].superset===e.superset)hi++;
    if(active.exercises.slice(lo,hi+1).every(x=>x.sets.every(s=>s.done))){const last=active.exercises[hi];seconds=last.restSecondsNext ?? last.restSeconds;}
  }else if(e.sets.every(s=>s.done))seconds=e.restSecondsNext ?? seconds;
  return {endsAt:now+seconds*1000};
}
function finish(active, now) {
  const exercises=active.exercises.map(e=>({...Model.metadata(e),name:e.name,description:e.description,plannedSets:e.plannedSets,plannedReps:e.plannedReps,
    plannedWeight:e.plannedWeight,targetRpe:e.targetRpe,equipment:e.equipment,barWeight:e.barWeight,metric:e.metric,superset:e.superset,
    swappedFrom:e.swappedFrom,notes:e.notes,sets:e.sets.filter(s=>s.done).map(s=>Model.recordSet(e,s))})).filter(e=>e.sets.length);
  if(!exercises.length) fail('noSets');
  return {id:active.id,date:new Date(active.startedAt).toISOString(),dayName:active.dayName,durationMin:Math.max(1,Math.round((now-active.startedAt)/60000)),
    notes:active.notes,exercises,...(Object.keys(active.readiness || {}).length?{readiness:clone(active.readiness)}:{}),
    ...(active.warmup?.length?{warmup:{total:active.warmup.length,done:active.warmup.filter(w=>w.done).length}}:{})};
}
function effort(record) {
  let weighted=0,reps=0,total=0,covered=0;
  for(const e of record.exercises) if(!e.metric || e.metric==='load') for(const s of e.sets) if(!s.warmup){total++;if(s.rpe!=null){covered++;const n=s.reps>0?s.reps:1;weighted+=s.rpe*n;reps+=n;}}
  if(!reps) return null;const rpe=Math.round(weighted/reps*10)/10;return {rpe,load:Math.round(rpe*record.durationMin),coverage:covered/total};
}
module.exports={restAfter,normalizePlan,importDocument,start,updateSet,toggleSet,swap,finish,effort,rows,clone,Model,Library};
