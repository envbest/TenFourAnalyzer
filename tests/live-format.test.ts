import 'fake-indexeddb/auto';
import {ingest,listHands,reprocess,backup} from '../src/core/store';
import test from 'node:test';
import assert from 'node:assert/strict';
import captures from './fixtures/observed-showdown.json';
import {fromSnapshot,parseLines} from '../src/core/adapter';
import {fromHistory} from '../src/core/history';
import {reconstruct} from '../src/core/reprocess';
import {pokerstars,validateHand} from '../src/core/export';
import type {Capture} from '../src/core/types';
const events=captures as Capture[];

test('observed live showdown reconciles reset stacks and retains all revealed cards',async()=>{
 const rebuilt=reconstruct(events),h=rebuilt.hands.get('normal:observed-showdown')!;
 assert.equal(rebuilt.ambiguous.size,0);assert.deepEqual(validateHand(h),[]);
 assert.equal(h.sourceId,'observed-history');assert.equal(h.profit,254);assert.equal(h.rake,26);
 assert.deepEqual(h.payouts,[{seat:2,amount:484}]);assert.equal(h.actions.length,14);
 assert.ok(h.players.every(p=>p.cards.length===2));assert.deepEqual(h.players[1].cards,['5d','3s']);
 const text=await pokerstars(h);assert.equal((text.match(/PokerStars Hand/g)||[]).length,1);
 assert.match(text,/Dealt to Hero \[9d Jh\]/);assert.match(text,/Hero collected \$4.84/);
 assert.match(text,/Player1: shows \[Ah Jd\]/);assert.doesNotMatch(text,/Player2: shows/);
 assert.match(text,/Total pot \$5\.10 \| Rake \$0.26/);
});

test('reset chips without directly observed contribution evidence remain blocked',()=>{
 const final=events[2];
 assert.ok(validateHand(fromSnapshot(final)!).some(e=>e.includes('終了スタック')));
 const opening=fromSnapshot(events[0])!;
 assert.ok(validateHand(fromSnapshot(final,opening)!).some(e=>e.includes('終了スタック')));
 const previous=fromSnapshot(events[1],opening)!;previous.observedStacks![0].amount!++;
 assert.ok(validateHand(fromSnapshot(final,previous)!).some(e=>e.includes('終了スタック')));
});

test('summary rows are accepted only in the expected section and unknown lines still block export',()=>{
 const h=fromSnapshot(events[0])!;
 assert.equal(parseLines(['# SHOWDOWN','BTN: High Card','# RESULTS','BTN: -2.3bb','Rake: 0.26bb'],h.players).issues.length,0);
 assert.ok(parseLines(['BTN: High Card','Rake: 0.26bb'],h.players).issues.length);
 assert.ok(parseLines(['# SHOWDOWN','BTN DANCE 5bb'],h.players).issues.length);
 assert.ok(parseLines(['# RESULTS','BTN: invalid'],h.players).issues.length);
});

test('conflicting revealed cards are not silently accepted',()=>{
 const previous=fromSnapshot(events[1],fromSnapshot(events[0])!)!;
 const final=structuredClone(events[2]);(final.payload as any).handResults[2].hand=['As','Ks'];
 assert.ok(validateHand(fromSnapshot(final,previous)!).some(e=>e.includes('開示カード')));
});

test('history completes a partial capture from recorded actions and settlement',()=>{
 const partial=fromSnapshot(events[0])!,h=fromHistory(events[4],partial)!;
 assert.ok(h);assert.equal(h.status,'complete');assert.equal(h.actions.length,14);assert.deepEqual(validateHand(h),[]);assert.ok(h.historyCompletedAt);
 assert.ok(h.players.every(p=>p.cards.length===2));assert.ok(h.revealedAt);
 for(const change of [
  (d:any)=>{d.startedAt='2025-01-01T00:00:00Z';d.createdAt='2025-01-01T00:01:00Z';},
  (d:any)=>d.players[5].cards=['As','Ks'],
  (d:any)=>d.players[0].position='BB',
  (d:any)=>d.players[0].cards=['9d','Jh'],
  (d:any)=>d.result.winners=[],
 ]){const bad=structuredClone(events[4]);change((bad.payload as any).detail);assert.equal(fromHistory(bad,partial),undefined);}
 const withBoard=fromSnapshot(events[1],partial)!;withBoard.board=['As','Ks','Qs'];
 assert.equal(fromHistory(events[4],withBoard),undefined);
});

test('ambiguous history matching does not reveal cards on either candidate',()=>{
 const duplicate=structuredClone(events[0]);duplicate.id='duplicate';(duplicate.payload as any).tableId='duplicate';
 const result=reconstruct([events[0],duplicate,events[4]]);
 assert.equal(result.hands.size,2);assert.ok([...result.hands.values()].every(h=>!h.revealedAt));
});


test('live history ingestion and later reconstruction preserve revealed cards and actual source ID',async()=>{
 for(const e of events)await ingest(e);
 const before=await backup(),h=(await listHands())[0];
 assert.equal(h.sourceId,'observed-history');assert.ok(h.players.every(p=>p.cards.length===2));
 assert.deepEqual(validateHand(h),[]);await reprocess();assert.deepEqual((await listHands())[0],h);
 assert.deepEqual((await backup()).events,before.events);
});

test('mismatched actions, profits, pots and missing stacks cannot silently complete a hand',()=>{
 const partial=fromSnapshot(events[0])!;
 for(const change of [
  (d:any)=>d.rounds[0].actions.splice(0,1),
  (d:any)=>d.rounds[1].pot=999,
  (d:any)=>d.players[0].profit=-100,
  (d:any)=>d.result.winners[0].amount=100,
  (d:any)=>d.rounds[0].actions[3].action='Unknown',
  (d:any)=>d.rounds.push({...d.rounds[0]}),
 ]){
  const bad=structuredClone(events[4]);change((bad.payload as any).detail);
  const result=fromHistory(bad,partial)!;assert.equal(result.status,'recording');assert.ok(result.warnings.some(s=>s.startsWith('履歴補完を保留')));
 }
 const missing=structuredClone(partial);missing.players[0].start=null;
 assert.equal(fromHistory(events[4],missing)?.status,'recording');
 const conflict=structuredClone(partial);conflict.actions.push({seat:3,street:'preflop',kind:'raise',amount:400,to:400});
 assert.equal(fromHistory(events[4],conflict)?.status,'recording');
});
