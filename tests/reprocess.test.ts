import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCapture,reconstruct} from '../src/core/reprocess';
import {ingest,listHands,backup,restore,annotate,reprocess,seedHands,status} from '../src/core/store';
import type {Capture} from '../src/core/types';
const opening=(id:string,at:number,table='table',connection='one'):Capture=>({id,at,connection,event:'fastFoldTableState',payload:{tableId:table,mySeatIndex:0,buttonPosition:0,seats:[{playerName:'Hero',chips:99.5,cards:['As','Ks']},{playerName:'Other',chips:99}],actionHistory:['SB POST 0.5bb','BB POST 1bb'],communityCards:[]}});
const removed=(at:number):Capture=>({...opening('removed',at),event:'fastFoldTableRemoved',payload:{tableId:'table'}});
const closed=(at:number):Capture=>({...opening('closed',at),event:'connectionClosed',payload:{}});

test('reconstruction orders events chronologically and scopes closure to its connection',()=>{
 const a=opening('z-first',10),b=opening('a-second',20),other=opening('other',15,'other','two');
 const expected=applyCapture(closed(30),applyCapture(b,applyCapture(a)));
 const rebuilt=reconstruct([closed(30),b,other,a]);
 assert.deepEqual(rebuilt.hands.get('normal:table'),expected);
 assert.equal(rebuilt.hands.get('normal:other')?.status,'recording');
 assert.equal(rebuilt.ambiguous.size,0);
});

test('ambiguous timestamps are skipped without affecting independent tables',()=>{
 for(const last of [opening('second',10),removed(10),closed(10)]){
  const rebuilt=reconstruct([last,opening('first',10),opening('other',10,'other','two')]);
  assert.ok(rebuilt.ambiguous.has('normal:table'));
  assert.ok(!rebuilt.hands.has('normal:table'));
  assert.ok(rebuilt.hands.has('normal:other'));
 }
});

test('reprocessing raw-only restores recovers hands and retains notes, raw data and recorder settings',async()=>{
 const events=[removed(30),opening('a-second',20),opening('z-first',10)];
 await restore({format:'tenfour-analyzer',version:1,hands:[],events,annotations:[]});
 await annotate({id:'normal:table',note:'keep',bookmark:true});
 const before=await backup(),rec=await status();
 const report=await reprocess();assert.equal(report.rebuiltHands,1);
 const h=(await listHands())[0];assert.equal(h.status,'incomplete');assert.equal(h.startedAt,10);assert.equal(h.updatedAt,30);
 assert.equal(h.players[0].start,10000);
 const after=await backup();assert.deepEqual(after.events,before.events);assert.deepEqual(after.annotations,before.annotations);assert.deepEqual(await status(),rec);
 await reprocess();assert.deepEqual((await backup()).hands,after.hands);
});

test('missing, older, ambiguous and less complete archives cannot replace existing evidence',async()=>{
 const base=(await listHands())[0];
 const newer={...base,id:'normal:newer',tableId:'newer',updatedAt:100};
 const complete={...base,id:'normal:complete',tableId:'complete',status:'complete' as const};
 const absent={...base,id:'normal:absent',tableId:'absent'};
 const ambiguous={...base,id:'normal:ambiguous',tableId:'ambiguous'};
 await seedHands([newer,complete,absent,ambiguous]);
 await restore({format:'tenfour-analyzer',version:1,hands:[],annotations:[],events:[opening('newer',40,'newer'),opening('complete',40,'complete'),opening('ambiguous1',40,'ambiguous'),opening('ambiguous2',40,'ambiguous')]});
 const report=await reprocess();assert.equal(report.preservedHands,4);assert.equal(report.ambiguousHands,1);
 for(const h of [newer,complete,absent,ambiguous])assert.deepEqual((await listHands()).find(x=>x.id===h.id),h);
});

test('live ingestion and reconstruction serialize without losing a capture',async()=>{
 await Promise.all([reprocess(),ingest(opening('live',200,'live','live'))]);
 const h=(await listHands()).find(h=>h.id==='normal:live');assert.ok(h);assert.equal(h.updatedAt,200);
 assert.equal((await backup()).events.filter(e=>e.id==='live').length,1);
});

test('write failure rolls back earlier reconstructed hands',async()=>{
 const before=await backup(),put=IDBObjectStore.prototype.put;let writes=0;
 IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){
  if(this.name==='hands'&&++writes===2)throw new Error('simulated rebuild failure');
  return put.apply(this,args);
 };
 try{await assert.rejects(reprocess(),/simulated rebuild failure/);}
 finally{IDBObjectStore.prototype.put=put;}
 const after=await backup();assert.deepEqual(after.hands,before.hands);assert.deepEqual(after.events,before.events);assert.deepEqual(after.annotations,before.annotations);
});
