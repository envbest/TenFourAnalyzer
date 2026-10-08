import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from './fixtures/observed-fast-fold.json';
import {ingest,listHands,backup,reprocess,annotate,annotations} from '../src/core/store';
import {validateHand,pokerstars} from '../src/core/export';
import type {Capture} from '../src/core/types';
const events=fixture as Capture[];

test('real Fast Fold detail completes missing actions, returns uncalled chips, and matches every profit',async()=>{
 for(const mode of ['normal','expert','private']){
  for(const original of events.slice(0,2)){
   const e=structuredClone(original);e.id=mode+e.id;e.event=mode==='normal'?'fastFoldTableState':mode==='expert'?'expertFastFoldTableState':'privateFastFoldTableState';e.connection=mode;
   await ingest(e);
  }
 }
 // Identical timestamps/cards across modes must not be matched without a mode discriminator.
 await ingest(events[2]);assert.ok((await listHands()).every(h=>h.status==='recording'));
 for(const mode of ['normal','expert','private']){
  const e=structuredClone(events[2]);e.id=mode+e.id;(e.payload as any).detail.mode=mode;
  await ingest(e);const h=(await listHands()).find(h=>h.mode===mode)!;
  assert.equal(h.status,'complete');assert.ok(h.historyCompletedAt);assert.deepEqual(validateHand(h),[]);
  assert.equal(h.profit,0);assert.equal(h.rake,0);assert.equal(h.actions.at(-1)?.kind,'return');assert.equal(h.actions.at(-1)?.amount,200);
  assert.equal(h.actions.length,9);assert.deepEqual(h.payouts,[{seat:4,amount:200}]);
  assert.match(await pokerstars(h),/Uncalled bet \(\$2\) returned to Player5/);
  const stale=structuredClone(events[0]);stale.id=mode+'late-snapshot';stale.at=e.at+100;stale.event=mode==='normal'?'fastFoldTableState':mode==='expert'?'expertFastFoldTableState':'privateFastFoldTableState';
  await ingest(stale);assert.equal((await listHands()).find(h=>h.mode===mode)?.status,'complete');
 }
 const before=await listHands();await annotate({id:before[0].id,note:'preserve',bookmark:true});
 const raw=(await backup()).events;await reprocess();assert.deepEqual(await listHands(),before);assert.equal((await annotations())[0].note,'preserve');assert.deepEqual((await backup()).events,raw);
});
