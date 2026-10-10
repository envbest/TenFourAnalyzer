import { recordKey } from './adapter';
import {fromHistory} from './history';
import {applyCapture,reconstruct,preservesEvidence,removalMatches} from './reprocess';
import { sanitize, validCapture } from './protocol';
import type { Annotation, Capture, Hand, RecorderStatus } from './types';
const DB='tenfour-analyzer-v1';
let opened:Promise<IDBDatabase>|null=null;
export function database():Promise<IDBDatabase>{
  return opened??=new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB,1);
    req.onupgradeneeded=()=>{const db=req.result;db.createObjectStore('events',{keyPath:'id'}).createIndex('connection','connection');db.createObjectStore('hands',{keyPath:'id'});db.createObjectStore('annotations',{keyPath:'id'});db.createObjectStore('meta');};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>{opened=null;reject(req.error);};
  });
}
const result=<T>(r:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const done=(tx:IDBTransaction)=>new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('保存を中断しました'));});
export const initialStatus:RecorderStatus={lastSeen:0,lastSaved:0,error:null,enabled:true,events:0};
export async function listHands(){const db=await database();return result<Hand[]>(db.transaction('hands').objectStore('hands').getAll());}
export async function annotations(){const db=await database();return result<Annotation[]>(db.transaction('annotations').objectStore('annotations').getAll());}
export async function status():Promise<RecorderStatus>{const db=await database();return await result(db.transaction('meta').objectStore('meta').get('status'))??initialStatus;}
export async function setStatus(patch:Partial<RecorderStatus>){const db=await database(),tx=db.transaction('meta','readwrite'),end=done(tx),store=tx.objectStore('meta');const old=await result(store.get('status'));store.put({...initialStatus,...old,...patch},'status');await end;}
export async function annotate(annotation:Annotation){const db=await database(),tx=db.transaction('annotations','readwrite'),end=done(tx);tx.objectStore('annotations').put(annotation);await end;}
export async function ingest(input:Capture){
  if(!validCapture(input))throw new Error('受信データ形式が不正です');
  const c={...input,payload:sanitize(input.payload)};
  const db=await database(),tx=db.transaction(['events','hands','meta'],'readwrite'),end=done(tx);
  try{
  const events=tx.objectStore('events'),hands=tx.objectStore('hands'),meta=tx.objectStore('meta');
  // All reads/writes are in one transaction: retries and service-worker restarts are idempotent.
  const current:RecorderStatus=await result(meta.get('status'))??initialStatus;
  if(!current.enabled){await end;return;}
  if(await result(events.get(c.id))){await end;return;}
  events.put(c);
  if(c.event==='handDetail'){
    const candidates=(await result<Hand[]>(hands.getAll())).map(h=>fromHistory(c,h)).filter((h):h is Hand=>!!h);
    if(candidates.length===1)hands.put(candidates[0]);
  }
  const key=recordKey(c);
  const ids=c.event==='connectionClosed'
    ?new Set((await result<Capture[]>(events.index('connection').getAll(c.connection))).map(recordKey))
    :c.event.endsWith('TableRemoved')?new Set((await result<Hand[]>(hands.getAll())).filter(h=>removalMatches(c,h)).map(h=>h.id)):new Set([key]);
  for(const id of ids){if(!id)continue;const previous=await result<Hand|undefined>(hands.get(id));const h=applyCapture(c,previous);if(h&&h!==previous)hands.put(h);}
  meta.put({...current,lastSeen:c.at,lastSaved:Date.now(),events:current.events+1,error:null},'status');await end;
  }catch(error){try{tx.abort();}catch{}await end.catch(()=>{});throw error;}
}
export async function bulkExportState():Promise<{ids:string[];exclude:boolean}>{
  const db=await database(),store=db.transaction('meta').objectStore('meta');
  const [ids,exclude]=await Promise.all([result<string[]|undefined>(store.get('bulkExports')),result<boolean|undefined>(store.get('excludeBulkExports'))]);
  return {ids:ids??[],exclude:exclude??false};
}
export async function setExcludeBulkExports(exclude:boolean){
  const db=await database(),tx=db.transaction('meta','readwrite'),end=done(tx);
  tx.objectStore('meta').put(exclude,'excludeBulkExports');await end;
}
export async function recordBulkExport(ids:string[]){
  if(!ids.every(identifier))throw new Error('出力済みハンドIDが不正です');
  const db=await database(),tx=db.transaction('meta','readwrite'),end=done(tx),store=tx.objectStore('meta');
  try{const old=await result<string[]|undefined>(store.get('bulkExports'));store.put([...new Set([...(old??[]),...ids])],'bulkExports');await end;}
  catch(error){try{tx.abort();}catch{}await end.catch(()=>{});throw error;}
}
export async function backup(){
  const db=await database(),tx=db.transaction(['events','hands','annotations','meta']);
  const [events,hands,notes,bulkExports]=await Promise.all([result(tx.objectStore('events').getAll()),result(tx.objectStore('hands').getAll()),result(tx.objectStore('annotations').getAll()),result<string[]|undefined>(tx.objectStore('meta').get('bulkExports'))]);
  return {format:'tenfour-analyzer',version:1,createdAt:new Date().toISOString(),events,hands,annotations:notes,bulkExports:bulkExports??[]};
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const identifier=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<300;
const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v);
const nonnegative=(v:unknown)=>integer(v)&&(v as number)>=0;
const seat=(v:unknown)=>nonnegative(v)&&(v as number)<=8;
const nullable=(v:unknown,check:(x:unknown)=>boolean)=>v===null||check(v);
const timestamp=(v:unknown)=>nonnegative(v)&&Number.isFinite(new Date(v as number).getTime());
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(s=>typeof s==='string');
const cardList=(v:unknown,max:number)=>strings(v)&&v.length<=max&&v.every(c=>/^[2-9TJQKA][cdhs]$/.test(c));
export function validHandShape(h:unknown):h is Hand {
  if(!object(h))return false;
  return identifier(h.id)&&identifier(h.tableId)&&nullable(h.sourceId,identifier)
    &&['normal','expert','private'].includes(h.mode as string)&&timestamp(h.startedAt)&&timestamp(h.updatedAt)
    &&nullable(h.heroSeat,seat)&&nullable(h.button,seat)
    &&Array.isArray(h.players)&&h.players.length<=9&&h.players.every(p=>object(p)&&seat(p.seat)
      &&typeof p.name==='string'&&typeof p.position==='string'&&cardList(p.cards,2)
      &&nullable(p.start,nonnegative)&&(p.uid===undefined||typeof p.uid==='string'))
    &&new Set(h.players.map(p=>p.seat)).size===h.players.length
    &&Array.isArray(h.actions)&&h.actions.length<=4000&&h.actions.every(a=>object(a)&&seat(a.seat)
      &&['preflop','flop','turn','river'].includes(a.street as string)
      &&['sb','bb','fold','check','call','bet','raise','return'].includes(a.kind as string)
      &&nonnegative(a.amount)&&(a.to===undefined||nonnegative(a.to))&&(a.allIn===undefined||typeof a.allIn==='boolean'))
    &&cardList(h.board,5)&&Array.isArray(h.payouts)&&h.payouts.every(p=>object(p)&&seat(p.seat)&&nonnegative(p.amount))
    &&nullable(h.rake,integer)&&nullable(h.smallBlind,nonnegative)&&nullable(h.bigBlind,nonnegative)&&nullable(h.profit,integer)
    &&(h.revealedAt===undefined||timestamp(h.revealedAt))
    &&(h.historyCompletedAt===undefined||timestamp(h.historyCompletedAt))
    &&(h.connection===undefined||identifier(h.connection))
    &&(h.observedStacks===undefined||(Array.isArray(h.observedStacks)&&h.observedStacks.length<=9&&h.observedStacks.every(s=>object(s)&&seat(s.seat)&&nullable(s.amount,nonnegative))&&new Set(h.observedStacks.map(s=>s.seat)).size===h.observedStacks.length))
    &&strings(h.issues)&&strings(h.warnings)&&strings(h.rawLines)
    &&['recording','incomplete','complete'].includes(h.status as string)&&(h.demo===undefined||typeof h.demo==='boolean');
}
export interface RestoreReport { hands:number; events:number; annotations:number; skippedHands:number }
export async function restore(value:unknown):Promise<RestoreReport>{
  const b=value as Awaited<ReturnType<typeof backup>>;
  const unique=(rows:{id:string}[])=>new Set(rows.map(r=>r.id)).size===rows.length;
  if(!b||b.format!=='tenfour-analyzer'||b.version!==1||!Array.isArray(b.hands)||!Array.isArray(b.events)||!Array.isArray(b.annotations)||b.hands.length>100000||b.events.length>500000||b.annotations.length>100000||!b.hands.every(validHandShape)||!b.events.every(validCapture)||!b.annotations.every(a=>a&&identifier(a.id)&&typeof a.note==='string'&&a.note.length<=10000&&typeof a.bookmark==='boolean')||![b.hands,b.events,b.annotations].every(unique))throw new Error('対応するバックアップ形式ではありません');
  if(b.bulkExports!==undefined&&(!Array.isArray(b.bulkExports)||b.bulkExports.length>100000||!b.bulkExports.every(identifier)))throw new Error('対応するバックアップ形式ではありません');
  const cleaned=b.events.map(e=>({...e,payload:sanitize(e.payload)}));
  const db=await database(),tx=db.transaction(['events','hands','annotations','meta'],'readwrite'),end=done(tx);
  const report:RestoreReport={hands:0,events:0,annotations:0,skippedHands:0};
  try{
    const events=tx.objectStore('events'),hands=tx.objectStore('hands'),notes=tx.objectStore('annotations'),meta=tx.objectStore('meta');
    for(const e of cleaned){if(!await result(events.get(e.id))){events.add(e);report.events++;}}
    for(const h of b.hands){const old=await result<Hand|undefined>(hands.get(h.id));if(!old||h.updatedAt>old.updatedAt){hands.put(h);report.hands++;}else report.skippedHands++;}
    for(const a of b.annotations){if(!await result(notes.get(a.id))){notes.add(a);report.annotations++;}}
    const previousExports=await result<string[]|undefined>(meta.get('bulkExports'));
    meta.put([...new Set([...(previousExports??[]),...(b.bulkExports??[])])],'bulkExports');
    const current:RecorderStatus=await result(meta.get('status'))??initialStatus;
    meta.put({...current,events:await result(events.count())},'status');
    await end;return report;
  }catch(error){try{tx.abort();}catch{/* The transaction may already have aborted. */}await end.catch(()=>{});throw error;}
}
export async function seedHands(hands:Hand[]){const db=await database(),tx=db.transaction('hands','readwrite'),end=done(tx);hands.forEach(h=>tx.objectStore('hands').put(h));await end;}

export async function reprocess(){
  // Lock event and hand stores together so live ingestion cannot be overwritten.
  const db=await database(),tx=db.transaction(['events','hands'],'readwrite'),end=done(tx);
  try{
    const [events,existing]=await Promise.all([
      result<Capture[]>(tx.objectStore('events').getAll()),
      result<Hand[]>(tx.objectStore('hands').getAll())
    ]);
    const rebuilt=reconstruct(events),old=new Map(existing.map(h=>[h.id,h]));
    let rebuiltHands=0;
    for(const h of rebuilt.hands.values()){
      const previous=old.get(h.id);
      if(previous&&!preservesEvidence(h,previous))continue;
      tx.objectStore('hands').put(h);old.delete(h.id);rebuiltHands++;
    }
    await end;
    return {events:events.length,rebuiltHands,preservedHands:old.size,ambiguousHands:rebuilt.ambiguous.size};
  }catch(error){try{tx.abort();}catch{/* Already finished. */}await end.catch(()=>{});throw error;}
}
