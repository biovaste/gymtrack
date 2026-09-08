import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { load,reconcile,save,build,atomic,hash,revision,recordVersion,edit,validate } from './core.mjs';
import { generate } from './generate.mjs';
import { scan } from './scan.mjs';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export async function releaseCache(root,check=false) {
  const file=path.join(root,'sw.js');const sw=await readFile(file,'utf8').catch(()=>null);if(!sw)return;
  const canonical=text=>text.replace(/\r\n?/g,'\n');
  const current=canonical(sw);
  const normalized=current.replace(/const CACHE = '[^']+';/,"const CACHE = 'gymtrack-i18n-development';");
  const contents=await Promise.all(['index.html','styles.css','app.js','workout-model.js','exercise-library.js','i18n.js','exercises.js','locales/catalog.js','manifest.webmanifest'].map(async f=>canonical(await readFile(path.join(root,f),'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;}))));
  const expected=normalized.replace("const CACHE = 'gymtrack-i18n-development';",`const CACHE = 'gymtrack-i18n-${hash([normalized,...contents])}';`);
  if(check && current!==expected)throw Error('Offline app version is stale: run node tools/i18n/cli.mjs build');
  if(!check && current!==expected)await atomic(file,expected);
}
export async function pending(root) {
  const {source,review:old}=await load(root);const review=reconcile(source,old);
  return Object.entries(source).filter(([key,entry])=>!review.entries[key].fi || review.entries[key].status==='missing').map(([key,entry])=>({
    key,en:entry.en,context:entry.context,screen:entry.screen,role:entry.role,
    ...(entry.examples ? {examples:entry.examples} : {}),sourceRevision:revision(entry)
  }));
}
export async function applyDrafts(root,payload,{provenance={model:'codex',promptVersion:'codex-apply-drafts'} }={}) {
  if(!payload || !Array.isArray(payload.translations) || payload.translations.length>1000) throw Error('Expected a translations array with at most 1000 entries');
  const {source,review:old}=await load(root);let review=reconcile(source,old);const seen=new Set();
  for(const item of payload.translations) {
    if(!item || typeof item.key!=='string' || typeof item.fi!=='string' || typeof item.sourceRevision!=='string') throw Error('Each translation requires key, fi and sourceRevision');
    if(seen.has(item.key)) throw Error(`Duplicate translation key: ${item.key}`);seen.add(item.key);
    if(!Object.hasOwn(source,item.key)) throw Error(`Unknown translation key: ${item.key}`);
    if(item.sourceRevision!==revision(source[item.key])) throw Error(`Source changed or stale revision: ${item.key}`);
    validate(source[item.key],item.fi,item.key);
  }
  const at=new Date().toISOString();
  for(const item of payload.translations) {
    const current=review.entries[item.key];
    if(current.origin==='manual' || current.status==='approved') {
      current.suggestion={fi:item.fi,revision:current.revision,provenance:{...provenance,at}};
      continue;
    }
    review=edit(source,review,{key:item.key,fi:item.fi,version:recordVersion(current),sourceRevision:item.sourceRevision,action:'draft'});
    const next=review.entries[item.key];next.origin='generated';next.provenance={...provenance,at};delete next.suggestion;
  }
  await save(root,review);return {source,review,count:payload.translations.length};
}
async function main() {
  const command=process.argv[2] || 'check';
  if(command==='review') {const {start}=await import('./server.mjs');await start(root);return;}
  if(command==='generate') {const {source,review}=await load(root);const next=reconcile(source,review);await save(root,next);await save(root,await generate(source,next,{root}));await build(root);await releaseCache(root);}
  else if(command==='pending') {console.log(JSON.stringify({schemaVersion:1,translations:await pending(root)},null,2));}
  else if(command==='apply-drafts') {const file=process.argv[3];if(!file)throw Error('Usage: apply-drafts <json-file|->');const payload=JSON.parse(file==='-' ? await new Promise((resolve,reject)=>{let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>resolve(input));process.stdin.on('error',reject);}) : await readFile(file,'utf8'));await applyDrafts(root,payload);await build(root);await releaseCache(root);console.log(`Applied ${payload.translations.length} Finnish drafts.`);}
  else if(command==='build') {await build(root);await releaseCache(root);}
  else if(command==='check') {const {source}=await build(root,{check:true});const result=await scan(root,source);if(result.issues.length)throw Error(result.issues.join('\n'));await releaseCache(root,true);console.log(`Localization OK: ${Object.keys(source).length} context-specific bilingual entries.`);}
  else if(command==='scan') {const {source}=await load(root);const result=await scan(root,source);console.log(JSON.stringify(result,null,2));if(result.issues.length)process.exitCode=1;}
  else throw Error('Commands: build, check, scan, generate, pending, apply-drafts, review');
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e.message);process.exitCode=1;});
