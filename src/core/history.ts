import {cards,units,type Action,type Capture,type Hand,type Street} from './types';
import {validateHand} from './export';
const object=(x:unknown):Record<string,any>=>x&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,any>:{};
const sameCards=(a:string[],b:string[])=>[...a].sort().join() === [...b].sort().join();

/** Enrich a recorded hand only when time, positions, hero cards and board agree. */
export function fromHistory(c:Capture,previous:Hand):Hand|undefined {
  if(c.event!=='handDetail')return;
  const payload=object(c.payload),detail=object(payload.detail),result=object(detail.result);
  const startedAt=typeof detail.startedAt==='string'?Date.parse(detail.startedAt):NaN;
  const endedAt=typeof detail.createdAt==='string'?Date.parse(detail.createdAt):startedAt;
  if(detail.mode!==undefined&&detail.mode!==previous.mode)return;
  if(typeof payload.handId!=='string'||detail.id!==payload.handId||!Number.isFinite(startedAt)
    ||!Number.isFinite(endedAt)||endedAt<startedAt||previous.startedAt<startedAt-2000||previous.startedAt>endedAt+2000||!Array.isArray(detail.players)||detail.players.length!==previous.players.length
    ||!Array.isArray(result.winners)||result.winners.length===0||units(result.rake)===null||result.rake<0)return;
  if(previous.sourceId&&!previous.sourceId.startsWith('table:')&&previous.sourceId!==detail.id)return;
  const players=detail.players.map(object),positions=new Set(players.map((p:any)=>p.position));
  if(positions.size!==players.length||players.some((p:any)=>cards(p.cards).length!==2||units(p.profit)===null))return;
  if(!result.winners.every((w:unknown)=>{const winner=object(w);return positions.has(winner.position)&&units(winner.amount)!==null&&winner.amount>0;}))return;
  const hero=previous.players.find(p=>p.seat===previous.heroSeat),revealedHero=players.find((p:any)=>p.position===hero?.position);
  if(!hero||hero.cards.length!==2||!revealedHero||!sameCards(hero.cards,cards(revealedHero.cards)))return;
  const board=Array.isArray(detail.rounds)?detail.rounds.flatMap((r:unknown)=>cards(object(r).cards)):[];
  if(previous.board.some((card,i)=>board[i]!==card))return;
  const allCards=[...board,...players.flatMap((p:any)=>cards(p.cards))];
  if(new Set(allCards).size!==allCards.length)return;
  const enriched=previous.players.map(p=>{
    const revealed=players.find((r:any)=>r.position===p.position);
    if(!revealed||(p.cards.length&&!sameCards(p.cards,cards(revealed.cards))))return null;
    return {...p,cards:cards(revealed.cards)};
  });
  if(enriched.some(p=>p===null))return;
  const matched:Hand={...previous,sourceId:detail.id,players:enriched as Hand['players'],revealedAt:c.at,updatedAt:Math.max(previous.updatedAt,c.at),warnings:previous.warnings.filter(s=>!s.startsWith('出力IDは卓ID')&&!s.startsWith('履歴補完を保留'))};
  try{return completeHistory(detail,matched,c.at);}
  catch(error){return {...matched,warnings:[...matched.warnings,`履歴補完を保留: ${error instanceof Error?error.message:String(error)}`]};}

}


/** History amounts are street totals, including CALL (observed in real responses). */
function completeHistory(detail:Record<string,any>,previous:Hand,at:number):Hand {
  const fail=(message:string):never=>{throw new Error(message);};
  if(previous.players.some(p=>p.start===null))fail('開始スタックが未取得です');
  if(!Array.isArray(detail.rounds)||!detail.rounds.length)fail('ストリート情報が不足しています');
  const forced=previous.actions.filter(a=>a.kind==='sb'||a.kind==='bb');
  if(forced.length!==2||forced[0].kind!=='sb'||forced[1].kind!=='bb')fail('ブラインドが未取得です');
  const actions:Action[]=forced.map(a=>({...a})),board:string[]=[];
  const stacks=new Map(previous.players.map(p=>[p.seat,p.start!]));
  let paid=new Map<number,number>();
  for(const a of forced){stacks.set(a.seat,stacks.get(a.seat)!-a.amount);paid.set(a.seat,a.amount);}
  const streets:Street[]=['preflop','flop','turn','river'];let last=-1,sawShowdown=false;
  const contribution=(seat:number)=>actions.filter(a=>a.seat===seat).reduce((n,a)=>n+(a.kind==='return'?-a.amount:a.amount),0);
  for(const value of detail.rounds){
    const round=object(value),name=typeof round.street==='string'?round.street.toLowerCase():'';
    if(sawShowdown)fail('ショーダウン後にストリートが続いています');
    if(name==='showdown'){if(last<0||round.actions?.length)fail('未対応のショーダウンアクションです');sawShowdown=true;continue;}
    const index=streets.indexOf(name as Street);
    if(index!==last+1)fail('履歴のストリートが不足または重複しています');last=index;
    if(!Array.isArray(round.actions))fail('履歴のアクションが不足しています');
    const received=cards(round.cards);
    if(index>0){
      if(received.length!==(index===1?3:1))fail('履歴のボードが不足しています');
      board.push(...received);paid=new Map;
      if(units(round.pot)!==previous.players.reduce((sum,p)=>sum+contribution(p.seat),0))fail('ストリート開始時のポットが一致しません');
    }else if(received.length)fail('プリフロップのボードが不正です');
    for(const value of round.actions){
      const action=object(value),player=previous.players.find(p=>p.position===action.position);
      if(!player)fail('履歴の席が一致しません');
      const seat=player!.seat,old=paid.get(seat)??0,remaining=stacks.get(seat)!;
      const high=Math.max(0,...paid.values()),verb=String(action.action).toLowerCase().replace(/[- ]/g,'');
      let kind:Action['kind'],amount=0,to:number|undefined;
      if(verb==='fold'||verb==='check'){kind=verb;if(action.amount!==undefined&&action.amount!==0)fail('投入を伴わないアクションに金額があります');}
      else if(verb==='call'||verb==='bet'||verb==='raise'||verb==='allin'){
        const total=action.amount===undefined&&verb==='call'?old+Math.min(remaining,high-old):units(action.amount);
        if(total===null)fail('履歴の投入額が不正です');
        amount=total!-old;
        kind=verb==='allin'?(total!<=high?'call':high===0?'bet':'raise'):verb as Action['kind'];
        if(kind==='raise')to=total!;
      }else fail(`未対応の履歴アクション: ${String(action.action).slice(0,40)}`);
      if(amount<0||amount>remaining)fail('履歴の投入額がスタックと一致しません');
      const allIn=amount>0&&amount===remaining;
      if((verb==='allin'||action.allIn===true)&&!allIn)fail('履歴のオールイン額が一致しません');
      actions.push({seat,street:name as Street,kind:kind!,amount,...(to===undefined?{}:{to}),...(allIn?{allIn:true}:{})});
      paid.set(seat,old+amount);stacks.set(seat,remaining-amount);
    }
  }
  const prefix=previous.actions.filter(a=>a.kind!=='return');
  if(prefix.some((a,i)=>{const b=actions[i];return !b||a.seat!==b.seat||a.street!==b.street||a.kind!==b.kind||a.amount!==b.amount||(a.kind==='raise'&&a.to!==b.to);}))fail('受信済みアクションと履歴が一致しません');
  if(previous.status!=='complete'&&previous.observedStacks?.some(s=>{
    const p=previous.players.find(p=>p.seat===s.seat),spent=previous.actions.filter(a=>a.seat===s.seat).reduce((n,a)=>n+(a.kind==='return'?-a.amount:a.amount),0);
    return !p||s.amount===null||s.amount!==p.start!-spent;
  }))fail('受信済みスタックと投入額が一致しません');
  const totals=previous.players.map(p=>({seat:p.seat,amount:contribution(p.seat)})).sort((a,b)=>b.amount-a.amount);
  const excess=totals[0].amount-totals[1].amount;
  if(excess>0&&!actions.some(a=>a.seat===totals[0].seat&&a.kind==='fold'))actions.push({seat:totals[0].seat,street:actions.at(-1)!.street,kind:'return',amount:excess});
  const result=object(detail.result);
  const payouts=result.winners.map((value:unknown)=>{const w=object(value);return {seat:previous.players.find(p=>p.position===w.position)!.seat,amount:units(w.amount)!};});
  for(const p of previous.players){
    const won=payouts.filter((w:{seat:number;amount:number})=>w.seat===p.seat).reduce((n:number,w:{amount:number})=>n+w.amount,0);
    const recorded=detail.players.find((r:any)=>r.position===p.position);
    if(won-contribution(p.seat)!==units(recorded.profit))fail(`履歴の収支と獲得額が一致しません: ${p.position}`);
  }
  const hero=previous.players.find(p=>p.seat===previous.heroSeat)!;
  const candidate:Hand={...previous,actions,board,payouts,rake:units(result.rake),status:'complete',issues:[],profit:units(detail.players.find((p:any)=>p.position===hero.position).profit),historyCompletedAt:at};
  const issues=validateHand(candidate);if(issues.length)fail(issues.join(' / '));
  return candidate;
}
