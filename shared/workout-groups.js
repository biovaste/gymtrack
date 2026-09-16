// Presentation indices only: stored exercise/set order and identities never change.
function workoutGroups(exercises) {
  const groups=[];
  for(let ei=0;ei<exercises.length;ei++){
    const tag=exercises[ei].superset || null;
    const previous=groups[groups.length-1];
    if(tag && previous?.tag===tag) previous.members.push(ei);
    else groups.push({tag,members:[ei]});
  }
  return groups.map(group=>{
    if(group.members.length===1)return {...group,tag:null,rounds:[{key:'all',items:[{ei:group.members[0],indices:exercises[group.members[0]].sets.map((_,si)=>si)}]}]};
    const rounds=[];
    const warmups=group.members.flatMap(ei=>exercises[ei].sets.flatMap((s,si)=>s.warmup?[{ei,indices:[si]}]:[]));
    if(warmups.length)rounds.push({key:'warmup',warmup:true,items:warmups});
    const work=group.members.map(ei=>({ei,indices:exercises[ei].sets.flatMap((s,si)=>s.warmup?[]:[si])}));
    for(let i=0;i<Math.max(...work.map(x=>x.indices.length));i++){
      rounds.push({key:`round-${i}`,number:i+1,items:work.filter(x=>i<x.indices.length).map(x=>({ei:x.ei,indices:[x.indices[i]]}))});
    }
    return {...group,rounds};
  });
}
module.exports={workoutGroups};
