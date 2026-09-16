// Async SQLite interface shared by Expo and the Node SQLite regression adapter.
class Repository {
  constructor(db){this.db=db;this.tail=Promise.resolve();}
  serial(fn){const p=this.tail.then(fn);this.tail=p.catch(()=>{});return p;}
  async init(){
    const version=await this.db.getFirstAsync('PRAGMA user_version');
    if(version.user_version>1) throw Error('futureDatabase');
    await this.db.execAsync(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
      PRAGMA user_version=1;`);
  }
  async get(key){const r=await this.db.getFirstAsync('SELECT payload FROM documents WHERE key=?',key);return r?JSON.parse(r.payload):null;}
  async put(key,value){await this.db.runAsync('INSERT OR REPLACE INTO documents(key,payload) VALUES (?,?)',key,JSON.stringify(value));}
  async transaction(fn){await this.db.execAsync('BEGIN IMMEDIATE');try{const result=await fn();await this.db.execAsync('COMMIT');return result;}catch(e){await this.db.execAsync('ROLLBACK');throw e;}}
  saveActive(active,rest){return this.serial(()=>this.transaction(async()=>{await this.put('active',active);if(rest!==undefined) await this.put('rest',rest);}));}
  setRest(rest){return this.serial(()=>this.put('rest',rest));}
  setPreference(key,value){return this.serial(()=>this.put(key,value));}
  importBackup(backup,original){return this.serial(()=>this.transaction(async()=>{
    if(await this.get('active')) throw Error('activeImport');
    const previous=await this.get('backup');
    if(previous || (await this.db.getAllAsync('SELECT id FROM sessions')).length) throw Error('importOccupied');
    await this.put('originalImport',original);await this.put('backup',backup);
    for(const s of backup.sessions){if(!s.id) throw Error('invalidPlan');await this.db.runAsync('INSERT INTO sessions(id,payload) VALUES (?,?)',s.id,JSON.stringify(s));}
  }));}
  complete(record){return this.serial(()=>this.transaction(async()=>{
    const exists=await this.db.getFirstAsync('SELECT id FROM sessions WHERE id=?',record.id);
    if(exists)return;
    const active=await this.get('active');if(!active || active.id!==record.id)throw Error('noActive');
    await this.db.runAsync('INSERT INTO sessions(id,payload) VALUES (?,?)',record.id,JSON.stringify(record));
    await this.db.runAsync('INSERT INTO outbox(id,payload,status) VALUES (?,?,?)',record.id,JSON.stringify(record),'pending');
    await this.put('active',null);await this.put('rest',null);
  }));}
  discard(){return this.saveActive(null,null);}
  async snapshot(){return this.serial(async()=>{
    const b=await this.get('backup');const records=await this.db.getAllAsync('SELECT payload FROM sessions ORDER BY rowid');
    return {backup:b?{...b,sessions:records.map(r=>JSON.parse(r.payload))}:null,active:await this.get('active'),rest:await this.get('rest'),
      outbox:await this.db.getAllAsync('SELECT id,status FROM outbox ORDER BY rowid'),language:await this.get('language') || 'en'};
  });}
  retry(transport){return this.serial(async()=>{
    const pending=await this.db.getAllAsync("SELECT * FROM outbox WHERE status != 'synced' ORDER BY rowid");
    for(const item of pending){
      try {await transport(item.id,JSON.parse(item.payload));await this.db.runAsync('UPDATE outbox SET status=? WHERE id=?','synced',item.id);}
      catch(e){await this.db.runAsync('UPDATE outbox SET status=? WHERE id=?',e.message,item.id);break;}
    }
  });}
}
module.exports={Repository};
