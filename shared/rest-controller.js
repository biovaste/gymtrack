// Reconcile after every persisted change and restart. Fixed identifier makes a
// crash after scheduling recoverable without persisting an OS-generated ID.
async function reconcileRest(scheduler,rest,now){
  await scheduler.cancel('gymtrack-prototype-rest');
  if(!rest || rest.endsAt<=now)return 'idle';
  if(!await scheduler.allowed())return 'denied';
  await scheduler.schedule('gymtrack-prototype-rest',rest.endsAt);return 'scheduled';
}
module.exports={reconcileRest};
