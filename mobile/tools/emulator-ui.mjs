// Emulator UI helpers. Operates only on the isolated prototype app.
// Usage: node mobile/tools/emulator-ui.mjs dump | tap "visible text" | screenshot path
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
const adb=path.join(process.env.LOCALAPPDATA,'Android','Sdk','platform-tools','adb.exe');
const run=(...args)=>execFileSync(adb,args,{encoding:'utf8',timeout:30000});
const action=process.argv[2] || 'dump';
if(action==='screenshot'){
 const png=execFileSync(adb,['exec-out','screencap','-p']);writeFileSync(process.argv[3],png);
}else{
 run('shell','rm','-f','/sdcard/gymtrack-ui.xml');
 run('shell','uiautomator','dump','/sdcard/gymtrack-ui.xml');
 const xml=run('shell','cat','/sdcard/gymtrack-ui.xml');
 const nodes=[...xml.matchAll(/<node\b[^>]+>/g)].map(([tag])=>Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]])));
 if(action==='dump')process.stdout.write(JSON.stringify(nodes.filter(n=>n.text||n['content-desc']).map(n=>({text:n.text,description:n['content-desc'],bounds:n.bounds})),null,2));
 else if(action==='tap'){
  const n=nodes.find(n=>{
   const bounds=n.bounds?.match(/-?\d+/g)?.map(Number);
   return bounds&&bounds[2]>bounds[0]&&bounds[3]>bounds[1]&&n.enabled!=='false'&&
     (n.text===process.argv[3]||n['content-desc']===process.argv[3]);
  });
  if(!n)throw Error('Control not visible: '+process.argv[3]);
  const [x1,y1,x2,y2]=n.bounds.match(/\d+/g).map(Number);run('shell','input','tap',String(Math.round((x1+x2)/2)),String(Math.round((y1+y2)/2)));
 }else throw Error('Unknown action');
}
