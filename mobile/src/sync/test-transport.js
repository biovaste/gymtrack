// Deliberately no network path. The receiver persists stable operation IDs in SQLite.
function testTransport(db,mode){return async(id,payload)=>{
  if(mode!=='success')throw Error(mode);
  await db.execAsync('CREATE TABLE IF NOT EXISTS test_receiver(id TEXT PRIMARY KEY,payload TEXT NOT NULL)');
  await db.runAsync('INSERT OR IGNORE INTO test_receiver(id,payload) VALUES (?,?)',id,JSON.stringify(payload));
};}
module.exports={testTransport};
