import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from './fixtures/observed-showdown.json';
import {ingest,listHands,backup} from '../src/core/store';
import {reconstruct} from '../src/core/reprocess';
import {validCapture,decodeFrames} from '../src/core/protocol';
import type {Capture} from '../src/core/types';
const event=(id:string,at:number,connection:string,mode='normal'):Capture=>({...structuredClone(fixture[0]),id,at,connection,event:mode==='normal'?'fastFoldTableState':mode==='expert'?'expertFastFoldTableState':'privateFastFoldTableState'}) as Capture;

test('normal, Expert and private captures retain separate hands, removals and reconnect state',async()=>{
 for(const mode of ['normal','expert','private']){
  const first=event(mode+'-one',100,'old-'+mode,mode);await ingest(first);
  const closed:Capture={id:mode+'-close',at:110,connection:first.connection,event:'connectionClosed',payload:{}};await ingest(closed);
  assert.equal((await listHands()).find(h=>h.mode===mode)?.status,'incomplete');
  const reconnect=event(mode+'-two',120,'new-'+mode,mode);await ingest(reconnect);
  assert.equal((await listHands()).find(h=>h.mode===mode)?.status,'recording');
  await ingest({...closed,id:mode+'-late-close',at:130});
  assert.equal((await listHands()).find(h=>h.mode===mode)?.status,'recording');
  await ingest({...first,id:mode+'-stale',at:105});
  assert.equal((await listHands()).find(h=>h.mode===mode)?.connection,reconnect.connection);
  const removal={...reconnect,id:mode+'-remove',at:140,event:reconnect.event.replace('TableState','TableRemoved'),payload:{tableId:'observed-showdown'}};
  await ingest(removal);assert.equal((await listHands()).find(h=>h.mode===mode)?.status,'incomplete');
 }
 assert.equal((await listHands()).length,3);
 const rebuilt=reconstruct((await backup()).events);assert.equal(rebuilt.hands.size,3);
 assert.ok([...rebuilt.hands.values()].every(h=>h.status==='incomplete'));
});

test('a persistent private table keeps hands with different server hand IDs separate',async()=>{
 const one=event('private-hand1',200,'private-persistent','private');(one.payload as any).handId='one';
 const two=event('private-hand2',210,'private-persistent','private');(two.payload as any).handId='two';
 await ingest(one);await ingest(two);
 const h=await listHands();assert.ok(h.some(h=>h.id==='private:observed-showdown:one'));assert.ok(h.some(h=>h.id==='private:observed-showdown:two'));
 await ingest({...two,id:'private-persistent-remove',at:220,event:'privateFastFoldTableRemoved',payload:{tableId:'observed-showdown'}});
 assert.ok((await listHands()).filter(h=>h.connection==='private-persistent').every(h=>h.status==='incomplete'));
});

test('same-millisecond capture sequence reconstructs without random event-ID ordering',()=>{
 const first={...event('z',100,'seq'),sequence:1};
 const second={...event('a',100,'seq'),sequence:2};(second.payload as any).actionHistory.push('UTG FOLD');
 const removed={...first,id:'m',sequence:3,event:'fastFoldTableRemoved',payload:{tableId:'observed-showdown'}};
 const result=reconstruct([removed,second,first]);assert.equal(result.ambiguous.size,0);
 assert.equal(result.hands.get('normal:observed-showdown')?.status,'incomplete');
 assert.equal(result.hands.get('normal:observed-showdown')?.actions.length,3);
 const duplicate=reconstruct([first,{...second,sequence:1}]);assert.equal(duplicate.ambiguous.size,1);
 assert.equal(validCapture({...first,sequence:-1}),false);assert.equal(validCapture({...first,sequence:1.2}),false);
 for(const mode of ['normal','expert','private']){
  const c=event(mode,1,'socket',mode);assert.equal(decodeFrames('42'+JSON.stringify([c.event,c.payload]))[0].event,c.event);
 }
});
