import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pokerstars,validateHand} from '../src/core/export';
import {demoHands} from '../src/core/demo';
import type {Hand} from '../src/core/types';

const reported=():Hand=>JSON.parse(readFileSync(new URL('./fixtures/reported-import.json',import.meta.url),'utf8'));

test('reported rejected hand exports conventional header, exact amounts and consistent showdown summary',async()=>{
  const h=reported();assert.deepEqual(validateHand(h),[]);
  const text=await pokerstars(h);
  assert.match(text,/^PokerStars Hand #\d+: Hold'em No Limit \(\$0\.50\/\$1\.00 USD\) - 2026\/10\/08 16:39:13 UTC \[2026\/10\/08 12:39:13 ET\]\n/);
  const id=text.match(/^PokerStars Hand #(\d+)/)![1];
  assert.ok(BigInt(id)<=BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(BigInt(Number(id)),BigInt(id));
  assert.match(text,/Hero: shows \[Ah 4s\] \(a pair of Aces\)/);
  assert.match(text,/Player6: shows \[5s Qs\] \(high card Ace\)/);
  assert.match(text,/Seat 2: Hero \(big blind\) showed \[Ah 4s\] and won \(\$17\.40\) with a pair of Aces/);
  assert.match(text,/Seat 6: Player6 \(button\) showed \[5s Qs\] and lost with high card Ace/);
  assert.doesNotMatch(text,/mucked/);
  assert.match(text,/Total pot \$18\.32 \| Rake \$0\.92/);
  assert.equal(text.match(/\$(\d+)(?![\d.])/g),null);
});

test('ET header conversion preserves winter offsets and midnight',async()=>{
  const h=reported();h.startedAt=Date.parse('2026-01-09T05:00:00Z');
  assert.match(await pokerstars(h),/2026\/01\/09 05:00:00 UTC \[2026\/01\/09 00:00:00 ET\]/);
});

test('sparse occupied seats never exceed the declared table size',async()=>{
  const h=demoHands()[0];
  h.players=h.players.map(p=>({...p,seat:p.seat+3}));h.heroSeat!+=3;h.button!+=3;
  h.actions=h.actions.map(a=>({...a,seat:a.seat+3}));h.payouts=h.payouts.map(p=>({...p,seat:p.seat+3}));
  const text=await pokerstars(h),capacity=Number(text.match(/' (\d+)-max/)![1]);
  assert.ok(h.players.every(p=>p.seat+1<=capacity));
});
