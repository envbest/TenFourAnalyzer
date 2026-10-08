import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFrames,sanitize,validCapture} from '../src/core/protocol';
import {fromSnapshot,parseLines,positions} from '../src/core/adapter';
import {demoHands} from '../src/core/demo';
import {validateHand,pokerstars} from '../src/core/export';
import {replay} from '../src/core/replay';
import {units,type Capture} from '../src/core/types';
const capture=(payload:object):Capture=>({id:'event-1',at:1234567890000,connection:'connection-1',event:'fastFoldTableState',payload});
const snapshot=()=>({tableId:'abc',buttonPosition:0,mySeatIndex:0,street:'preflop',seats:[{playerName:'Hero',uid:'hero',chips:100,cards:['As','Kd']},{playerName:'Small',uid:'small',chips:99.5,cards:[]},{playerName:'Big',uid:'big',chips:99,cards:[]}],actionHistory:['SB POST 0.5bb','BB POST 1bb'],communityCards:[],isHandInProgress:true});
test('Socket.IO events, namespaces, ack IDs and polling envelopes',()=>{
 const x=decodeFrames('0{"sid":"private"}\x1e42["fastFoldTableState",{"tableId":"x"}]\x1e42/game,25["expertFastFoldTableState",{"tableId":"y"}]\x1e2');
 assert.deepEqual(x.map(e=>e.event),['fastFoldTableState','expertFastFoldTableState']);
 assert.equal(decodeFrames('40{"token":"private"}').length,0);assert.equal(decodeFrames('42["onlinePlayers",{}]').length,0);
 assert.equal(decodeFrames('42oops').length,0);assert.equal(decodeFrames('42["fastFoldTableState",null]').length,0);
});
test('credentials and prototype keys are removed recursively',()=>{
 const input=JSON.parse('{"token":"private","players":[{"uid":"u","email":"mail","cards":["As"]}],"nested":{"Authorization":"Bearer secret","sessionId":"abc","chips":12},"__proto__":{"bad":true}}');
 assert.deepEqual(sanitize(input),{players:[{uid:'u',cards:['As']}],nested:{chips:12}});
});
test('reject malformed bridge envelopes',()=>{assert.equal(validCapture(null),false);assert.equal(validCapture({...capture({}),at:NaN}),false);assert.equal(validCapture(capture({})),true);});
test('money uses exact hundredths',()=>{assert.equal(units(0.1),10);assert.equal(units(12.34),1234);assert.equal(units(0.001),null);assert.equal(units(Infinity),null);});
test('seat positions support heads up and missing seats',()=>{
 assert.deepEqual([...positions([{},null,{},{}],2)],[ [2,'BTN'],[3,'SB'],[0,'BB'] ]);
 assert.deepEqual([...positions([{},{}],0)],[[0,'BTN/SB'],[1,'BB']]);
});
test('snapshot retains hero cards, opening stacks, cumulative action history',()=>{
 const a=fromSnapshot(capture(snapshot()))!;assert.equal(a.players[1].start,10000);assert.equal(a.players[0].start,10000);
 const next={...snapshot(),actionHistory:['SB POST 0.5bb','BB POST 1bb','BTN RAISE 3bb','SB FOLD','BB CALL'],seats:snapshot().seats.map(s=>({...s,cards:[],chips:97}))};
 const b=fromSnapshot({...capture(next),id:'event-2'},a)!;
 assert.deepEqual(b.players[0].cards,['As','Kd']);assert.equal(b.actions.at(-1)?.amount,200);assert.equal(b.actions.length,5);
 assert.equal(fromSnapshot(capture(next),b)!.actions.length,5);
 assert.ok(validateHand(b).length>0);
});
test('capture mid hand never fabricates starting stacks',()=>{const h=fromSnapshot(capture({...snapshot(),actionHistory:['SB POST 0.5bb','BB POST 1bb','BTN RAISE 3bb']}))!;assert.equal(h.players[0].start,null);});
test('history rollback fails closed',()=>{const h=fromSnapshot(capture({...snapshot(),actionHistory:['SB POST 0.5bb','BB POST 1bb','BTN RAISE 3bb']}))!;const next=fromSnapshot(capture(snapshot()),h)!;assert.equal(next.status,'incomplete');assert.equal(next.actions.length,3);});
test('unknown action lines are preserved as issues',()=>{const p=demoHands()[0].players;const result=parseLines(['BTN DANCE 4bb'],p);assert.equal(result.actions.length,0);assert.match(result.issues[0],/未対応/);});
test('street commitments reset and call amount is derived from current bet',()=>{
 const x=parseLines(['SB POST 0.5bb','BB POST 1bb','BTN RAISE 3bb','SB FOLD','BB CALL','# FLOP [Ah 7s 2d]','BB CHECK','BTN BET 4bb','BB CALL'],demoHands()[0].players);
 assert.equal(x.issues.length,0);assert.equal(x.actions.at(-1)?.amount,400);assert.equal(x.actions.at(-1)?.street,'flop');
});
test('valid demo hands balance, incomplete hands are excluded',()=>{const [h,lost,incomplete]=demoHands();assert.deepEqual(validateHand(h),[]);assert.deepEqual(validateHand(lost),[]);assert.ok(validateHand(incomplete).length>0);});
test('wrong payouts, duplicate cards, missing ID and starting stack fail export',async()=>{
 for(const mutate of [(h:any)=>h.payouts[0].amount++,(h:any)=>h.board[0]='As',(h:any)=>h.sourceId=null,(h:any)=>h.players[0].start=null]){
  const h=demoHands()[0];mutate(h);assert.ok(validateHand(h).length);await assert.rejects(pokerstars(h));
 }
});
test('unmatched check / over-stack raise / folded winner fail validation',()=>{
 let h=demoHands()[0];h.actions[7]={seat:2,street:'preflop',kind:'check',amount:0};assert.ok(validateHand(h).some(x=>x.includes('チェック')));
 h=demoHands()[0];h.players[0].start=1;assert.ok(validateHand(h).some(x=>x.includes('スタック')));
 h=demoHands()[0];h.payouts[0].seat=2;assert.ok(validateHand(h).some(x=>x.includes('勝者')));
});
test('PokerStars exporter uses raise increment, refunds, stable IDs and aliases',async()=>{
 const h=demoHands()[0],text=await pokerstars(h);
 assert.match(text,/Hero: raises \$1\.50 to \$2\.50/);assert.match(text,/Uncalled bet \(\$2\.00\) returned to Hero/);assert.match(text,/Total pot \$5\.50 \| Rake \$0.27/);
 assert.equal(await pokerstars(h),text);assert.match(text,/Dealt to Hero \[As Ks\]/);assert.doesNotMatch(text,/undefined|NaN/);
});
test('replay calculates pot and remaining stack before settlement',()=>{
 const h=demoHands()[0];assert.equal(replay(h,2).pot,150);assert.equal(replay(h,6).balances.get(0),9750);assert.equal(replay(h).pot,550);assert.equal(replay(h).balances.get(0),9750);assert.deepEqual(replay(h,2).board,[]);
});
test('all-in runout exports board streets without synthetic actions',async()=>{
 const h=demoHands()[0];h.players=h.players.slice(0,2);h.players[0].position='BTN/SB';h.players[1].position='BB';h.players[1].cards=['Kh','Kd'];h.board=['Ah','7s','2d','3c','4d'];
 h.actions=[{seat:0,street:'preflop',kind:'sb',amount:50},{seat:1,street:'preflop',kind:'bb',amount:100},{seat:0,street:'preflop',kind:'raise',amount:9950,to:10000,allIn:true},{seat:1,street:'preflop',kind:'call',amount:9900,allIn:true}];h.payouts=[{seat:0,amount:19600}];h.rake=400;h.profit=9600;
 assert.deepEqual(validateHand(h),[]);const text=await pokerstars(h);assert.match(text,/\*\*\* FLOP \*\*\*/);assert.match(text,/\*\*\* TURN \*\*\*/);assert.match(text,/\*\*\* RIVER \*\*\*/);assert.match(text,/\*\*\* SHOW DOWN \*\*\*/);
});
test('complete live snapshot reconciles chips and results, returns unmatched bet, exports',async()=>{
 const start=snapshot();start.seats=start.seats.map(s=>({...s,initialChips:100}));
 const first=fromSnapshot(capture(start))!;
 const final={...start,isHandInProgress:false,communityCards:[],actionHistory:['SB POST 0.5bb','BB POST 1bb','BTN RAISE 3bb','SB FOLD','BB FOLD'],seats:[{...start.seats[0],chips:101.5},{...start.seats[1],chips:99.5},{...start.seats[2],chips:99}],handResults:[{seatIndex:0,profit:1.5,isWinner:true},{seatIndex:1,profit:-0.5,isWinner:false},{seatIndex:2,profit:-1,isWinner:false}]};
 const h=fromSnapshot(capture(final),first)!;
 assert.equal(h.status,'complete');assert.equal(h.actions.at(-1)?.kind,'return');assert.equal(h.actions.at(-1)?.amount,200);assert.deepEqual(validateHand(h),[]);
 const text=await pokerstars(h);assert.match(text,/Hero collected \$2\.50 from pot/);
 const bad=structuredClone(final);bad.seats[0].chips=999;assert.ok(validateHand(fromSnapshot(capture(bad),first)!).some(e=>e.includes('終了スタック')));
});
test('missing check, out-of-order actions and under-minimum raises are rejected',()=>{
 let h=demoHands()[0];h.actions.splice(8,1);assert.ok(validateHand(h).some(s=>s.includes('順序')));
 h=demoHands()[0];[h.actions[2],h.actions[3]]=[h.actions[3],h.actions[2]];assert.ok(validateHand(h).some(s=>s.includes('順序')));
 h=demoHands()[0];h.actions[5].amount=150;h.actions[5].to=150;assert.ok(validateHand(h).some(s=>s.includes('最小レイズ')));
});
