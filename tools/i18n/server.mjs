import http from 'node:http';
import { randomBytes,timingSafeEqual } from 'node:crypto';
import { readFile,open,unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load,reconcile,save,build,recordVersion,revision,edit,validate,hash,json,atomic } from './core.mjs';
import { generate } from './generate.mjs';
import { scan } from './scan.mjs';
import { releaseCache } from './cli.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url));
export async function start(root,{port=Number(process.env.I18N_REVIEW_PORT || 4178),quiet=false}={}) {
  const token=randomBytes(32).toString('hex');let address;let busy=false;
  const lockfile=path.join(root,'locales/.review.lock');
  const lock=await open(lockfile,'wx').catch(e=>{if(e.code==='EEXIST')throw Error('Another review server may be running. Stop it first; if it crashed, remove locales/.review.lock.');throw e;});
  await lock.writeFile(String(process.pid));
  const server=http.createServer(async(req,res)=>{
    const reply=(code,value,type='application/json')=>{res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});res.end(type==='application/json'?JSON.stringify(value):value);};
    try {
      if(req.headers.host!==address || (req.headers.origin && req.headers.origin!==`http://${address}`)|| (req.headers['sec-fetch-site'] && !['none','same-origin'].includes(req.headers['sec-fetch-site']))) return reply(403,{error:'Local same-origin access only'});
      const url=new URL(req.url,`http://${address}`);
      if(req.method==='GET' && ['/','/review.js','/review.css'].includes(url.pathname)) {const file=url.pathname==='/'?'review.html':url.pathname.slice(1);return reply(200,await readFile(path.join(directory,file),'utf8'),file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8');}
      if(req.method==='GET' && url.pathname==='/api/state') {
        const {source,review}=await load(root);const next=reconcile(source,review);
        return reply(200,{token,entries:Object.entries(next.entries).map(([key,r])=>({key,...r,version:recordVersion(r)})),lastScan:next.lastScan || null});
      }
      if(req.method!=='POST')return reply(404,{error:'Not found'});
      const supplied=Buffer.from(req.headers['x-review-token'] || '');const expected=Buffer.from(token);
      if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected))return reply(403,{error:'Invalid review session'});
      if(!['/api/save','/api/check','/api/generate','/api/import','/api/exercises','/api/import-exercises'].includes(url.pathname))return reply(404,{error:'Not found'});
      if(busy)return reply(409,{error:'A review operation is running. Try again shortly.'});
      busy=true;
      try {
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>3_000_000)throw Error('Request too large');}
        const data=JSON.parse(body||'{}');const {source,review:old}=await load(root);let review=reconcile(source,old);
        if(url.pathname==='/api/exercises' || url.pathname==='/api/import-exercises') {
          const entries=Array.isArray(data)?data:data.entries || data.exercises;
          if(!Array.isArray(entries)||entries.length>100)throw Error('Expected up to 100 pending exercises');
          const file=path.join(root,'locales/source/imported-exercises.json');const imported=await json(file,{});const nextSource={...source};
          for(const item of entries) {
            if(typeof item.name!=='string'||!item.name.trim()||item.name.length>200||typeof (item.description||'')!=='string'||(item.description||'').length>5000)throw Error('Invalid exercise name or description');
            const prefix=`exercises.imported_${hash([item.name.trim().toLowerCase(),item.description||''])}`;
            for(const [role,en] of [['name',item.name],['description',item.description]]) {
              if(!en)continue;
              const key=`${prefix}.${role}`;
              if(nextSource[key])continue;
              const existing=role==='name'?Object.entries(nextSource).find(([k,e])=>k.startsWith('exercises.')&&k.endsWith('.name')&&e.en===en):null;
              imported[key]={en,fi:existing?review.entries[existing[0]]?.fi||'':'',context:`Imported exercise ${role}: ${item.name}. Translate for display, preserving stored exercise identity.`,screen:'Exercises',role:role==='name'?'exercise-name':'exercise-description'};
              nextSource[key]=imported[key];
            }
          }
          const after=await load(root);if(JSON.stringify(after.source)!==JSON.stringify(source)||JSON.stringify(after.review)!==JSON.stringify(old)){const e=Error('Files changed during exercise generation. Reload and retry.');e.status=409;throw e;}
          // Persist the imported queue even when an API provider is not configured.
          // Missing entries stay visible in the reviewer and can be drafted by hand.
          review=reconcile(nextSource,review);
          await atomic(file,JSON.stringify(imported,null,2)+'\n');
          let warning;
          if(process.env.I18N_API_KEY && process.env.I18N_MODEL) {
            try { review=await generate(nextSource,review,{root}); }
            catch(e) { warning=`Automatic draft generation unavailable: ${e.message}`; }
          } else warning='Exercise entries imported as missing drafts. Configure I18N_API_KEY and I18N_MODEL to generate Finnish suggestions.';
          await save(root,review);
          try { await build(root); await releaseCache(root); } catch(e) { warning=warning ? `${warning} ${e.message}` : e.message; }
          return reply(200,{ok:true,warning});
        }
        if(url.pathname==='/api/save')review=edit(source,review,data);
        if(url.pathname==='/api/generate') {
          const r=review.entries[data.key];if(!r||data.version!==recordVersion(r)) {const e=Error('Entry changed. Reload first.');e.status=409;throw e;}
          const before=JSON.stringify(source);const beforeReview=JSON.stringify(old);
          review=await generate(source,review,{root,keys:[data.key]});
          const after=await load(root);if(before!==JSON.stringify(after.source)||beforeReview!==JSON.stringify(after.review)) {const e=Error('Files changed during generation. Reload and retry.');e.status=409;throw e;}
        }
        if(url.pathname==='/api/import') {
          if(!Array.isArray(data.entries)||data.entries.length>5000)throw Error('Expected an entries array');
          for(const item of data.entries) {
            if(!Object.hasOwn(source,item.key)||item.sourceRevision!==revision(source[item.key]))throw Error(`Source changed or unknown key: ${item.key}`);
            validate(source[item.key],item.fi,item.key);
            review=edit(source,review,{...item,action:'draft'});
          }
        }
        if(url.pathname==='/api/check') {
          const result=await scan(root,source);
          review.lastScan={at:new Date().toISOString(),issues:result.issues,pending:Object.values(review.entries).filter(r=>!['approved','retired'].includes(r.status)).length};
          let warning;
          if(process.env.I18N_API_KEY && process.env.I18N_MODEL) {
            try { review=await generate(source,review,{root}); }
            catch(e) { warning=`Automatic draft generation unavailable: ${e.message}`; }
          } else if(Object.values(review.entries).some(r=>r.status==='missing')) {
            warning='Automatic draft generation is not configured; missing Finnish drafts remain visible for review.';
          }
          await save(root,review);
          try { await build(root); await releaseCache(root); } catch(e) { warning=warning ? `${warning} ${e.message}` : e.message; }
          return reply(200,{ok:true,issues:result.issues,warning});
        }
        await save(root,review);
        // Save survives even when a different missing entry prevents a full app build.
        let warning;try {await build(root);await releaseCache(root);}catch(e){warning=e.message;}
        reply(200,{ok:true,warning});
      } finally {busy=false;}
    } catch(e) {reply(e.status||400,{error:e.message});}
  });
  try {await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}catch(e){await lock.close();await unlink(lockfile);throw e;}
  address=`127.0.0.1:${server.address().port}`;
  server.once('close',()=>{lock.close().then(()=>unlink(lockfile)).catch(()=>{});});
  if(!quiet)console.log(`Finnish review: http://${address}\nDrafts appear in the app immediately after the next normal release.`);
  return {server,url:`http://${address}`,token};
}
