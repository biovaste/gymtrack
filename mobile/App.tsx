import React, {useEffect,useRef,useState} from 'react';
import {Alert,AppState,BackHandler,KeyboardAvoidingView,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import * as Picker from 'expo-document-picker';
import {File,Paths} from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {askPermission,scheduler} from './src/platform/notifications';
const Core=require('../shared/workout-core');
const {applyDrafts}=require('../shared/workout-drafts');
const {workoutGroups}=require('../shared/workout-groups');
const {Repository}=require('./src/storage/repository');
const {testTransport}=require('./src/sync/test-transport');
const {reconcileRest}=require('../shared/rest-controller');
const sample=require('../tools/fixtures/native/current-plan.json');
const catalogue=require('../locales/source/ui.json');
const errors:Record<string,[string,string]>={invalidPlan:['This file is not a supported plan or backup.','Tiedosto ei ole tuettu ohjelma tai varmuuskopio.'],invalidSet:['Check the set values before continuing.','Tarkista sarjan arvot ennen jatkamista.'],noSets:['Complete at least one set before saving.','Kirjaa vähintään yksi sarja ennen tallennusta.'],swapLogged:['Swap before logging sets.','Vaihda liike ennen sarjojen kirjaamista.'],activeImport:['Finish the active workout before importing.','Päätä treeni ennen tuontia.'],importOccupied:['This prototype keeps one imported backup. Export your data first; replacing it is not supported yet.','Prototyyppi säilyttää yhden tuodun varmuuskopion. Vie tietosi ensin; korvaamista ei vielä tueta.']};
function Numeric({value,label,onSave,disabled}:{value:any;label:string;onSave:(v:string)=>void;disabled:boolean}){
 const [draft,setDraft]=useState(value==null?'':String(value));useEffect(()=>setDraft(value==null?'':String(value)),[value]);
 return <View style={styles.field}><Text style={styles.small}>{label}</Text><TextInput accessibilityLabel={label} editable={!disabled} style={styles.input} keyboardType="decimal-pad" value={draft} onChangeText={text=>{setDraft(text);onSave(text);}}/></View>;
}
export default function App(){
 const repo=useRef<any>(null),db=useRef<any>(null);const [state,setState]=useState<any>(null),[busy,setBusy]=useState(false),[screen,setScreen]=useState('plan'),[language,setLanguage]=useState<'en'|'fi'>('en'),[input,setInput]=useState(''),[mode,setMode]=useState('success'),[clock,setClock]=useState(Date.now()),[notice,setNotice]=useState(''),[bootError,setBootError]=useState('');
 const latest=useRef<any>(null),drafts=useRef<Record<string,string>>({});
 const draft=(key:string,text:string)=>{drafts.current[key]=text;};
 const current=()=>applyDrafts(latest.current,drafts.current);
 const locked=useRef(false);const t=(en:string,fi:string)=>language==='fi'?fi:en;
 const tr=(key:string)=>catalogue[key]?.[language] || key;
 const refresh=async()=>{const s=await repo.current.snapshot();latest.current=s.active;setState(s);setLanguage(s.language);return s;};
 const restScheduler=()=>scheduler(t('Rest complete','Palautus päättyi'),t('Ready for your next set.','Valmis seuraavaan sarjaan.'));
 const reconcile=async(s:any)=>{try{const status=await reconcileRest(restScheduler(),s.rest,Date.now());setNotice(status==='denied'?t('Rest notifications are disabled. The timer still works in the app.','Palautusilmoitukset eivät ole käytössä. Ajastin toimii sovelluksessa.'):'');}catch{setNotice(t('Workout saved. Rest notification could not be scheduled.','Treeni tallennettu. Palautusilmoituksen ajastus epäonnistui.'));}};
 const act=async(fn:()=>Promise<void>,flush=true)=>{if(locked.current)return;locked.current=true;setBusy(true);try{if(flush&&latest.current&&Object.keys(drafts.current).length){const edits={...drafts.current};const next=current();await repo.current.saveActive(next);latest.current=next;for(const key of Object.keys(edits))if(drafts.current[key]===edits[key])delete drafts.current[key];}await fn();const s=await refresh();await reconcile(s);}catch(e:any){if(__DEV__)console.warn('Prototype action failed:',e.message);const pair=errors[e.message];Alert.alert(t('Could not complete action','Toiminto epäonnistui'),pair?pair[language==='fi'?1:0]:t('Your last saved data is retained. Please retry.','Viimeksi tallennetut tiedot säilyvät. Yritä uudelleen.'));}finally{locked.current=false;setBusy(false);}};
 useEffect(()=>{
  let alive=true,connection:SQLite.SQLiteDatabase|undefined,repository:any;
  (async()=>{try{
    connection=await SQLite.openDatabaseAsync('gymtrack-prototype.db',{useNewConnection:true});
    repository=new Repository(connection);await repository.init();
    if(!alive){await connection.closeAsync();return;}
    db.current=connection;repo.current=repository;
    const s=await refresh();if(s.active)setScreen('workout');await reconcile(s);
  }catch(e:any){if(alive)setBootError(String(e.message));}})();
  return()=>{alive=false;if(repo.current===repository){repo.current=null;db.current=null;void repository.tail.then(()=>connection?.closeAsync()).catch(()=>{});}};
 },[]);
 useEffect(()=>{const tick=setInterval(()=>setClock(Date.now()),1000);const sub=AppState.addEventListener('change',x=>{if(repo.current)void act(async()=>{});});return()=>{clearInterval(tick);sub.remove();};},[language]);
 useEffect(()=>{const sub=BackHandler.addEventListener('hardwareBackPress',()=>{if(screen!=='plan'){void act(async()=>{setScreen('plan');});return true;}return false;});return()=>sub.remove();},[screen]);
 const button=(label:string,fn:()=>void,secondary=false,key?:React.Key)=><Pressable key={key} accessibilityRole="button" disabled={busy} style={[styles.button,secondary&&styles.secondary,busy&&{opacity:.5}]} onPress={fn}><Text style={styles.buttonText}>{label}</Text></Pressable>;
 const saveActive=async(a:any,rest?:any)=>{await repo.current.saveActive(a,rest);latest.current=a;};
 const importText=(text:string)=>act(async()=>{const backup=Core.importDocument(text);await repo.current.importBackup(backup,text);setInput('');});
 const pick=()=>act(async()=>{const r=await Picker.getDocumentAsync({type:['application/json','text/plain'],copyToCacheDirectory:true});if(!r.canceled){const text=await new File(r.assets[0].uri).text();await repo.current.importBackup(Core.importDocument(text),text);}});
 const exportFile=()=>act(async()=>{const s=await repo.current.snapshot();if(!s.backup)return;const file=new File(Paths.cache,'gymtrack-prototype-backup.json');file.create({overwrite:true});file.write(JSON.stringify({...s.backup,exportedAt:new Date().toISOString()},null,2));if(await Sharing.isAvailableAsync())await Sharing.shareAsync(file.uri,{mimeType:'application/json',UTI:'public.json'});else throw Error('sharing');});
 const active=state?.active;const unit=state?.backup?.settings?.unit || 'kg';
 return <SafeAreaProvider><SafeAreaView style={styles.safe}><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':'height'}><View style={styles.header}><Text style={styles.title}>GymTrack</Text><Pressable onPress={()=>void act(async()=>repo.current.setPreference('language',language==='en'?'fi':'en'))}><Text style={styles.link}>{language==='en'?'Suomi':'English'}</Text></Pressable></View>
 <Text style={styles.banner}>{t('Prototype • local data • simulated sync','Prototyyppi • paikalliset tiedot • testisynkronointi')}</Text>
 <View style={styles.tabs}>{[['plan',t('Plan','Ohjelma')],['workout',t('Workout','Treeni')],['history',t('History','Historia')]].map(([key,label])=><Pressable key={key} onPress={()=>void act(async()=>{setScreen(key);})}><Text style={[styles.link,screen===key&&{color:'#fff'}]}>{label}</Text></Pressable>)}</View>
 <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
 {!state?<Text style={styles.text}>{bootError?t('Storage could not be opened. Restart to retry.','Tallennustilaa ei voitu avata. Käynnistä uudelleen.'):t('Loading…','Ladataan…')}</Text>:<>
 {!!notice&&<Text style={styles.warning}>{notice}</Text>}
 {screen==='plan'&&<><Text style={styles.heading}>{state.backup?.plan.name || t('Bring your plan','Tuo ohjelmasi')}</Text><Text style={styles.text}>{t('Use your own plan or one written by a human coach or an AI assistant.','Käytä omaa, valmentajan tai tekoälyn laatimaa ohjelmaa.')}</Text>
 {!state.backup&&<>{button(t('Try sample workout','Kokeile esimerkkitreeniä'),()=>void importText(JSON.stringify(sample)))}{button(t('Import JSON file','Tuo JSON-tiedosto'),()=>void pick(),true)}<TextInput multiline style={[styles.input,{minHeight:100}]} accessibilityLabel={t('Plan JSON','Ohjelman JSON')} placeholder={t('Paste plan or backup JSON','Liitä ohjelma tai varmuuskopio JSON-muodossa')} placeholderTextColor="#aaa" value={input} onChangeText={setInput}/>{button(t('Import pasted plan','Tuo liitetty ohjelma'),()=>void importText(input),true)}</>}
 {state.backup?.plan.days.map((d:any,i:number)=><View key={d.id} style={styles.card}><Text style={styles.heading}>{d.name}</Text>{d.exercises.map((e:any,j:number)=><Text key={j} style={styles.text}>{e.name} · {e.sets} {t('sets','sarjaa')} · {tr('exercise.model.'+e.metric)}</Text>)}{button(active?t('Resume workout','Jatka treeniä'):t('Start workout','Aloita treeni'),()=>void act(async()=>{if(!active)await saveActive(Core.start(state.backup.plan,i,Crypto.randomUUID(),Date.now()));setScreen('workout');}))}</View>)}
 {state.backup&&button(t('Export backup','Vie varmuuskopio'),()=>void exportFile(),true)}</>}
 {screen==='workout'&&(!active?<Text style={styles.text}>{t('Start a workout from Plan.','Aloita treeni Ohjelma-välilehdeltä.')}</Text>:<><Text style={styles.heading}>{active.dayName}</Text>
 {button(t('Enable rest notifications','Ota palautusilmoitukset käyttöön'),()=>void act(async()=>{await askPermission();}),true)}
 {state.rest&&<View style={styles.card}><Text style={styles.heading}>{Math.max(0,Math.ceil((state.rest.endsAt-clock)/1000))} s</Text>{button('+15 s',()=>void act(async()=>repo.current.setRest({...state.rest,endsAt:Math.max(Date.now(),state.rest.endsAt)+15000})),true)}{button(t('Skip rest','Ohita palautus'),()=>void act(async()=>repo.current.setRest(null)),true)}</View>}
 {active.warmup.map((w:any,i:number)=><Pressable key={i} disabled={busy} onPress={()=>void act(async()=>{const a=Core.clone(current());a.warmup[i].done=!w.done;await saveActive(a);})}><Text style={styles.text}>{w.done?'☑':'□'} {w.name} {w.detail}</Text></Pressable>)}
 {workoutGroups(active.exercises).map((group:any)=><View key={group.members[0]}>{group.tag&&<Text style={styles.heading}>{t('Superset','Supersarja')} {group.tag}</Text>}{group.rounds.map((round:any)=><View key={round.key}>{group.tag&&<Text style={styles.text}>{round.warmup?t('Warm-up','Lämmittely'):t('Round','Kierros')+' '+round.number}</Text>}{round.items.map(({ei,indices}:any)=>{const e=active.exercises[ei];return <View key={ei+':'+indices[0]} style={styles.card}><Text style={styles.heading}>{e.superset?`${e.superset} · `:''}{e.name}</Text><Text style={styles.small}>{e.side || ''} {e.setupId || ''}</Text><Text style={styles.text}>{Core.Library.instructions(e)}</Text>
 {indices.map((si:number)=>{const s=e.sets[si];return <View key={si} style={styles.set}><Text style={styles.small}>{s.warmup?t('Warm-up','Lämmittely'):t('Set','Sarja')} {si+1}</Text><View style={styles.fields}>{Object.keys(s).filter(k=>!['done','warmup'].includes(k)).map(k=><Numeric key={k} label={({weight:unit,reps:t('Reps','Toistot'),rpe:'RPE',heightCm:'cm',durationSeconds:'s',distanceMeters:'m',speedKph:'km/h'} as any)[k] || k} value={s[k]} disabled={busy||s.done} onSave={v=>draft(`${ei}:${si}:${k}`,v)}/>)}</View>{e.metric==='cardio'&&Core.Model.speed(s)>0&&<Text style={styles.small}>{t('Pace','Vauhti')}: {Math.floor(3600/Core.Model.speed(s)/60)}:{String(Math.floor(3600/Core.Model.speed(s)%60)).padStart(2,'0')} /km</Text>}{button(s.done?t('Undo set','Peru sarja'):t('Log set','Kirjaa sarja'),()=>void act(async()=>{const a=Core.toggleSet(current(),ei,si);const rest=Core.restAfter(a,ei,si,Date.now());await saveActive(a,rest);void Haptics.selectionAsync().catch(()=>{});}),!s.done)}</View>;})}
 {indices[0]===0&&!e.sets.some((s:any)=>s.done)&&e.alternates?.map((a:any,ai:number)=>button(t('Swap: ','Vaihda: ')+a.name,()=>void act(async()=>saveActive(Core.swap(current(),ei,ai))),true,ai))}
 </View>;})}</View>)}</View>)}
 <Text style={styles.text}>{t('Workout notes','Treenin muistiinpanot')}</Text><TextInput style={styles.input} multiline key={active.id} accessibilityLabel={t('Workout notes','Treenin muistiinpanot')} defaultValue={active.notes} onChangeText={text=>draft('notes',text)}/>
 {button(t('Save workout','Tallenna treeni'),()=>void act(async()=>{await repo.current.complete(Core.finish(current(),Date.now()));setScreen('history');}))}
 {button(t('Discard workout','Hylkää treeni'),()=>Alert.alert(t('Discard workout?','Hylätäänkö treeni?'),t('Unsaved workout sets will be removed.','Keskeneräisen treenin sarjat poistetaan.'),[{text:t('Cancel','Peruuta'),style:'cancel'},{text:t('Discard','Hylkää'),style:'destructive',onPress:()=>void act(async()=>{await repo.current.discard();drafts.current={};setScreen('plan');},false)}]),true)}</>)}
 {screen==='history'&&<><Text style={styles.heading}>{t('Saved workouts','Tallennetut treenit')}</Text><Text style={styles.text}>{tr('sync.saved_locally')}</Text>
 {(state.backup?.sessions || []).slice().reverse().map((s:any)=><View key={s.id} style={styles.card}><Text style={styles.heading}>{s.dayName || s.date}</Text><Text style={styles.small}>{s.date} · {s.durationMin || '—'} min</Text>{s.exercises.map((e:any,i:number)=><Text key={i} style={styles.text}>{e.name}: {e.sets.length} {t('sets','sarjaa')}</Text>)}{Core.effort(s)&&<Text style={styles.text}>{t('Set-RPE estimate','Sarjojen RPE-arvio')}: {Core.effort(s).rpe} · {Core.effort(s).load} AU</Text>}</View>)}
 {state.outbox.map((o:any)=><Text key={o.id} style={styles.small}>{t('Test sync','Testisynkronointi')}: {({synced:t('Synced to test receiver','Synkronoitu testivastaanottimeen'),pending:t('Pending','Odottaa'),offline:t('Offline — retry','Ei yhteyttä — yritä uudelleen'),timeout:t('Timed out — retry','Aikakatkaisu — yritä uudelleen'),unauthorized:t('Access denied','Pääsy evätty'),server:t('Server error','Palvelinvirhe'),conflict:t('Conflict — local data retained','Ristiriita — paikalliset tiedot säilytetty')} as any)[o.status] || o.status}</Text>)}
 <Text style={styles.text}>{t('Simulate sync result','Valitse synkronoinnin testitulos')}</Text><View style={styles.fields}>{[['success','Success','Onnistuu'],['offline','Offline','Ei yhteyttä'],['timeout','Timeout','Aikakatkaisu'],['unauthorized','Denied','Estetty'],['server','Server error','Palvelinvirhe'],['conflict','Conflict','Ristiriita']].map(([k,en,fi])=><Pressable key={k} onPress={()=>setMode(k)}><Text style={[styles.link,{padding:8},mode===k&&{color:'#fff'}]}>{t(en,fi)}</Text></Pressable>)}</View>
 {button(t('Retry test sync','Yritä testisynkronointia'),()=>void act(async()=>repo.current.retry(testTransport(db.current,mode))),true)}{state.backup&&button(t('Export backup','Vie varmuuskopio'),()=>void exportFile(),true)}</>}
 </>}
 </ScrollView></KeyboardAvoidingView></SafeAreaView></SafeAreaProvider>;
}
const styles=StyleSheet.create({safe:{flex:1,backgroundColor:'#101820'},header:{padding:18,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},title:{fontSize:26,fontWeight:'700',color:'#fff'},heading:{fontSize:20,fontWeight:'600',color:'#fff',marginBottom:10},banner:{color:'#c2d0da',paddingHorizontal:18,fontSize:12},tabs:{flexDirection:'row',justifyContent:'space-around',padding:18},link:{color:'#68dbc6',fontSize:16},content:{padding:18,paddingBottom:60,gap:14},card:{backgroundColor:'#1d2a35',padding:16,borderRadius:16,marginTop:10},text:{color:'#e0e8ee',fontSize:16,marginVertical:5},small:{color:'#b5c6d1',fontSize:13},warning:{color:'#ffd786',fontSize:15},button:{backgroundColor:'#146957',padding:14,borderRadius:12,marginVertical:6},secondary:{backgroundColor:'#2c4050'},buttonText:{color:'#fff',fontSize:16,textAlign:'center',fontWeight:'600'},input:{backgroundColor:'#0d1720',color:'#fff',padding:12,borderRadius:8,fontSize:17,borderWidth:1,borderColor:'#486070'},fields:{flexDirection:'row',flexWrap:'wrap',gap:8},field:{minWidth:65,flexGrow:1},set:{borderTopWidth:1,borderColor:'#3d505e',paddingTop:12,marginTop:12}});
