import test from 'node:test';
import assert from 'node:assert/strict';
import {rankSeven,settlementPots} from '../src/core/pots';
import {validateHand,pokerstars} from '../src/core/export';
import {validateBettingOrder} from '../src/core/betting';
import {parseLines} from '../src/core/adapter';
import type {Hand} from '../src/core/types';
function allIn():Hand{return {
 id:'side',sourceId:'side',tableId:'side',mode:'normal',startedAt:1,updatedAt:2,heroSeat:0,button:0,
 players:[{seat:0,name:'A',position:'BTN',cards:['As','Ah'],start:5000},{seat:1,name:'B',position:'SB',cards:['Ks','Kh'],start:10000},{seat:2,name:'C',position:'BB',cards:['Qs','Qh'],start:10000}],
 board:['2c','3d','7h','8s','9c'],actions:[{seat:1,street:'preflop',kind:'sb',amount:50},{seat:2,street:'preflop',kind:'bb',amount:100},{seat:0,street:'preflop',kind:'raise',amount:5000,to:5000,allIn:true},{seat:1,street:'preflop',kind:'raise',amount:9950,to:10000,allIn:true},{seat:2,street:'preflop',kind:'call',amount:9900,allIn:true}],
 payouts:[{seat:0,amount:15000},{seat:1,amount:10000}],rake:0,smallBlind:50,bigBlind:100,status:'complete',issues:[],warnings:[],rawLines:[],profit:10000
};}

test('rank evaluator covers every category, wheel straights, kickers and board ties',()=>{
 const ranks=[['As','Jd','9c','7h','5s','3c','2d'],['As','Ah','9c','7h','5s','3c','2d'],['As','Ah','9c','9h','5s','3c','2d'],['As','Ah','Ac','7h','5s','3c','2d'],['As','2h','3c','4h','5s','9c','Td'],['As','Js','9s','7s','5s','3c','2d'],['As','Ah','Ac','7h','7s','3c','2d'],['As','Ah','Ac','Ad','5s','3c','2d'],['As','2s','3s','4s','5s','9c','Td']].map(rankSeven);
 assert.ok(ranks.every(n=>n!==null));for(let i=1;i<ranks.length;i++)assert.ok(ranks[i]!>ranks[i-1]!);
 assert.ok(rankSeven(['2s','3h','4c','5h','6s','9c','Td'])!>ranks[4]!);
 assert.ok(rankSeven(['As','Ah','Kc','7h','5s','3c','2d'])!>ranks[1]!);
 assert.equal(rankSeven(['As','Ks','Qs','Js','Ts','2d','3c']),rankSeven(['As','Ks','Qs','Js','Ts','4d','5c']));
 assert.equal(rankSeven(['As','As','Qs','Js','Ts','2d','3c']),null);
});

test('unequal all-ins create main and side pots with explicit awards in export',async()=>{
 const h=allIn();assert.deepEqual(validateHand(h),[]);
 const {pots}=settlementPots(h);assert.deepEqual(pots.map(p=>p.amount),[15000,10000]);assert.deepEqual(pots[1].eligible,[1,2]);
 const text=await pokerstars(h);assert.match(text,/Hero collected \$150 from main pot/);assert.match(text,/Player2 collected \$100 from side pot/);assert.match(text,/3-max/);
 assert.match(text,/Main pot \$150\. Side pot \$100\./);
 h.rake=200;h.payouts[0].amount-=100;h.payouts[1].amount-=100;h.profit=h.profit!-100;
 assert.deepEqual(validateHand(h),[]);assert.deepEqual(settlementPots(h).pots.map(p=>p.rake),[100,100]);
});

test('invalid side-pot eligibility and unknown rake allocation stay blocked',()=>{
 let h=allIn();h.payouts=[{seat:0,amount:25000}];h.profit=20000;
 assert.ok(validateHand(h).some(s=>s.includes('ポット')));
 h=allIn();[h.players[0].cards,h.players[1].cards]=[h.players[1].cards,h.players[0].cards];h.payouts=[{seat:1,amount:24900}];h.rake=100;h.profit=-5000;
 assert.ok(validateHand(h).some(s=>s.includes('一意')));
 h=allIn();h.players[2].cards=[];assert.ok(validateHand(h).some(s=>s.includes('公開カード')));
});

test('tied multiway all-ins split main and side pots instead of inventing a sole winner',()=>{
 const h=allIn();h.board=['Ac','Kc','Qc','Jc','Tc'];h.payouts=[{seat:0,amount:5000},{seat:1,amount:10000},{seat:2,amount:10000}];h.profit=0;
 assert.deepEqual(validateHand(h),[]);assert.deepEqual(settlementPots(h).pots.map(p=>p.awards.map(w=>w.amount)),[[5000,5000,5000],[5000,5000]]);
 h.payouts[1].amount++;h.payouts[2].amount--;assert.ok(validateHand(h).length);
});

test('a short all-in call is limited by the remaining stack and marked all-in',()=>{
 const h=allIn();h.players[2].start=3000;
 const parsed=parseLines(['SB POST 0.5bb','BB POST 1bb','BTN RAISE 50bb','SB ALL-IN 100bb','BB CALL'],h.players);
 assert.equal(parsed.actions.at(-1)?.amount,2900);assert.equal(parsed.actions.at(-1)?.allIn,true);
});

test('short all-in raises do not reopen raising for a player who has already acted',()=>{
 const h=allIn();h.players[0].start=10000;h.players[1].start=350;h.players[2].start=10000;
 h.actions=parseLines(['SB POST 0.5bb','BB POST 1bb','BTN RAISE 3bb','SB ALL-IN 3.5bb','BB CALL','BTN RAISE 6bb','BB CALL'],h.players).actions;
 assert.ok(validateBettingOrder(h).some(s=>s.includes('レイズ権')));
 h.actions=parseLines(['SB POST 0.5bb','BB POST 1bb','BTN RAISE 3bb','SB ALL-IN 3.5bb','BB CALL','BTN CALL'],h.players).actions;
 assert.deepEqual(validateBettingOrder(h),[]);
});
