import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {ingest,listHands,backup,restore,annotate,annotations,setStatus,status} from '../src/core/store';
import type {Capture} from '../src/core/types';
const event=(id:string,table='test-table'):Capture=>({id,at:Date.now(),event:'fastFoldTableState',connection:'c1',payload:{tableId:table,mySeatIndex:0,buttonPosition:0,seats:[{playerName:'H',chips:99.5,cards:['As','Ks']},{playerName:'V',chips:99}],actionHistory:['SB POST 0.5bb','BB POST 1bb'],authorization:'secret',communityCards:[]}});
test('atomic ingestion, duplicates, concurrent tables, backup and non-destructive restore',async()=>{
 await Promise.all([ingest(event('a')),ingest(event('a')),ingest(event('b','other-table'))]);
 assert.equal((await listHands()).length,2);assert.equal((await status()).events,2);
 let b=await backup();assert.equal(b.events.length,2);assert.doesNotMatch(JSON.stringify(b),/secret|authorization/);
 await annotate({id:'normal:test-table',note:'keep me',bookmark:true});b=await backup();
 await annotate({id:'normal:test-table',note:'new note',bookmark:false});
 await restore(b);assert.equal((await backup()).events.length,2);assert.equal((await annotations())[0].note,'new note');
 await ingest({...event('removed'),event:'fastFoldTableRemoved',payload:{tableId:'test-table'}});assert.equal((await listHands()).find(h=>h.tableId==='test-table')?.status,'incomplete');
 await setStatus({enabled:false});await ingest(event('paused','paused-table'));assert.equal((await listHands()).length,2);
 await setStatus({enabled:true});await ingest(event('resumed','paused-table'));assert.equal((await listHands()).length,3);
 await assert.rejects(restore({...b,hands:[{id:'invalid'}]}));assert.equal((await listHands()).length,3);
 await ingest({...event('close'),event:'connectionClosed',payload:{}});assert.ok((await listHands()).every(h=>h.status==='incomplete'));
});

test('restore validates the entire backup before writing and preserves incomplete hands',async()=>{
 const b=await backup();
 for(const change of [
  (h:any)=>delete h.profit,
  (h:any)=>h.profit='100',
  (h:any)=>h.heroSeat=9,
  (h:any)=>h.updatedAt=1e20,
  (h:any)=>h.players[0].cards=['invalid'],
  (h:any)=>h.players.push({...h.players[0]}),
  (h:any)=>h.actions[0].kind='unknown',
  (h:any)=>h.actions[0].street='showdown',
  (h:any)=>h.actions[0].amount=-1,
  (h:any)=>h.actions[0].to='100',
  (h:any)=>h.actions[0].allIn='yes',
  (h:any)=>h.bigBlind=undefined,
 ]){
  const broken=structuredClone(b);change(broken.hands[0]);
  broken.events.push(event('must-not-write'));
  await assert.rejects(restore(broken),/バックアップ形式/);
 }
 await assert.rejects(restore({...b,hands:[b.hands[0],b.hands[0]]}));
 await assert.rejects(restore({...b,events:[b.events[0],b.events[0]]}));
 await assert.rejects(restore({...b,events:[{...event('array'),payload:[]}]}));
 const after=await backup();assert.deepEqual(after.events,b.events);assert.deepEqual(after.hands,b.hands);
 const report=await restore(b);
 assert.deepEqual(report,{hands:0,events:0,annotations:0,skippedHands:b.hands.length});
});

test('restore merges newer hands, preserves original events and notes, and reconciles counters',async()=>{
 const b=await backup(),existing=b.events[0];
 const h=structuredClone(b.hands[0]);h.updatedAt++;h.profit=null;
 const collision={...existing,payload:{overwritten:true}};
 const added=event('imported-event','imported-table');
 await setStatus({enabled:false,error:'existing error'});
 const before=await status();
 const report=await restore({...b,hands:[h],events:[collision,added],annotations:[{id:h.id,note:'imported',bookmark:true},{id:'new-note',note:'new',bookmark:false}]});
 assert.equal(report.hands,1);assert.equal(report.events,1);
 const after=await backup();assert.deepEqual(after.events.find(e=>e.id===existing.id),existing);
 assert.equal(after.hands.find(x=>x.id===h.id)?.updatedAt,h.updatedAt);
 assert.equal(after.annotations.find(a=>a.id==='normal:test-table')?.note,'new note');
 assert.equal(after.annotations.find(a=>a.id==='new-note')?.note,'new');
 assert.deepEqual(await status(),{...before,events:after.events.length});
 const again=await restore({...b,hands:[h],events:[added],annotations:[]});
 assert.deepEqual(again,{hands:0,events:0,annotations:0,skippedHands:1});
 await setStatus({enabled:true,error:null});
 await Promise.all([restore({...b,hands:[],annotations:[],events:[event('concurrent-import')]}),ingest(event('concurrent-live'))]);
 assert.equal((await status()).events,(await backup()).events.length);
});

test('a failure after queued writes rolls back all restored data',async()=>{
 const b=await backup(),before=await status();
 const put=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){
  if(this.name==='meta')throw new Error('simulated write failure');
  return put.apply(this,args);
 };
 try{
  await assert.rejects(restore({...b,hands:[],events:[event('rollback-event')],annotations:[{id:'rollback-note',note:'rollback',bookmark:false}]}),/simulated write failure/);
 }finally{IDBObjectStore.prototype.put=put;}
 const after=await backup();
 assert.deepEqual(after.events,b.events);assert.deepEqual(after.annotations,b.annotations);assert.deepEqual(await status(),before);
});
