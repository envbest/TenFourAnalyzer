import { GTO_IMPORT_STATUS, cards, units, type Action, type Capture, type Hand, type Player, type Street } from './types';
const obj=(x:unknown):Record<string,any>=>x&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,any>:{};
export function positions(seats:unknown[],button:number):Map<number,string> {
  const occupied=seats.map((s,i)=>s?i:-1).filter(i=>i>=0);
  const sorted=occupied.sort((a,b)=>(a-button+seats.length)%seats.length-(b-button+seats.length)%seats.length);
  const labels=sorted.length===2?['BTN/SB','BB']:['BTN','SB','BB',...['UTG','HJ','CO'].slice(6-sorted.length)];
  return new Map(sorted.map((seat,i)=>[seat,labels[i]??'?']));
}
export function parseLines(lines:string[],players:Player[]):{actions:Action[];issues:string[]} {
  const actions:Action[]=[]; const issues:string[]=[];
  let street:Street='preflop'; let paid=new Map<number,number>(); let high=0;
  const stacks=new Map(players.map(p=>[p.seat,p.start??Infinity]));
  let section:'actions'|'showdown'|'results'='actions';
  for(const raw of lines){
    const marker=raw.match(/^#\s*(PREFLOP|FLOP|TURN|RIVER)\b/i);
    if(marker){section='actions';street=marker[1].toLowerCase() as Street;paid=new Map;high=0;continue;}
    if(/^#\s*SHOWDOWN\b/i.test(raw)){section='showdown';continue;}
    if(/^#\s*RESULTS?\b/i.test(raw)){section='results';continue;}
    if(section==='showdown'&&/^(UTG|HJ|CO|BTN(?:\/SB)?|SB|BB): (High Card|One Pair|Two Pair|Three of a Kind|Straight|Flush|Full House|Four of a Kind|Straight Flush|Royal Flush)$/i.test(raw))continue;
    if(section==='results'&&/^(UTG|HJ|CO|BTN(?:\/SB)?|SB|BB|Rake): [+-]?\d+(?:\.\d+)?bb$/i.test(raw))continue;
    if(/^#.*(?:SHOWDOWN|RESULT|wins|Split pot|HAND)/i.test(raw))continue;
    const m=raw.match(/^(UTG|HJ|CO|BTN(?:\/SB)?|SB|BB)\s+(POST(?:\s+(?:SB|BB))?|FOLD|CHECK|CALL|RAISE|BET|ALL-IN|RETURN)\s*(?:\(?([\d.]+)(?:bb)?\)?)?\s*$/i);
    if(!m){issues.push(`未対応のアクション表記: ${raw.slice(0,100)}`);continue;}
    const p=players.find(p=>p.position===m[1]||(m[1]==='SB'&&p.position==='BTN/SB'));
    if(!p){issues.push(`席が不明: ${m[1]}`);continue;}
    const verb=m[2].toUpperCase(), old=paid.get(p.seat)??0,remaining=stacks.get(p.seat)??Infinity;
    const value=m[3]===undefined?null:units(Number(m[3]));
    let kind:Action['kind']; let amount=0; let to:number|undefined;
    if(verb==='FOLD')kind='fold';else if(verb==='CHECK')kind='check';
    else if(verb.startsWith('POST')){kind=p.position==='BB'?'bb':'sb';amount=value??-1;}
    else if(verb==='CALL'){kind='call';amount=value??Math.min(remaining,Math.max(0,high-old));}
    else if(verb==='RETURN'){kind='return';amount=value??-1;}
    else {kind=verb==='BET'?'bet':verb==='ALL-IN'?(value!==null&&value<=high?'call':high===0?'bet':'raise'):'raise';to=value??undefined;amount=value===null?-1:value-old;}
    if(amount<0){issues.push(`金額を解釈できません: ${raw}`);continue;}
    if(kind==='return')paid.set(p.seat,old-amount);else paid.set(p.seat,old+amount);
    stacks.set(p.seat,remaining+(kind==='return'?amount:-amount));
    high=Math.max(0,...paid.values());
    actions.push({street,seat:p.seat,kind,amount,...(to!==undefined?{to}:{}),...(verb==='ALL-IN'||(kind!=='return'&&amount>0&&amount===remaining)?{allIn:true}:{})});
  }
  return {actions,issues:[...new Set(issues)]};
}
export function recordKey(c:Capture):string|null {
  const p=obj(c.payload);const id=p.tableId;
  if(typeof id!=='string' || !id || id.length>160)return null;
  const mode=c.event.startsWith('expert')?'expert':c.event.startsWith('private')?'private':'normal';
  const hand=typeof p.handId==='string'&&p.handId.length>0&&p.handId.length<=100?p.handId:null;
  return `${mode}:${id}${hand?`:${hand}`:''}`;
}
export function fromSnapshot(c:Capture,previous?:Hand):Hand|null {
  const p=obj(c.payload), key=recordKey(c);if(!key||!Array.isArray(p.seats)||p.seats.length<2||p.seats.length>9)return null;
  const at=c.at, button=Number.isInteger(p.buttonPosition)?p.buttonPosition:null;
  const pos=positions(p.seats,button??0);
  const lines=Array.isArray(p.actionHistory)?p.actionHistory.filter((x:unknown):x is string=>typeof x==='string'):[];
  const results=Array.isArray(p.handResults)?p.handResults.map(obj):[];
  const cardIssues:string[]=[];
  const players:Player[]=p.seats.flatMap((s:unknown,i:number)=>{
    if(!s)return [];const seat=obj(s);const old=previous?.players.find(x=>x.seat===i);
    const visible=cards(seat.cards),revealed=cards(results.find((r:any)=>r.seatIndex===i)?.hand);
    const known=visible.length?visible:old?.cards??[];
    if(revealed.length===2&&known.length===2&&[...revealed].sort().join()!==[...known].sort().join())cardIssues.push(`開示カードが受信済みカードと不一致: ${pos.get(i)??i}`);
    return [{seat:i,name:typeof seat.playerName==='string'?seat.playerName:`Player ${i+1}`,position:pos.get(i)??'?',uid:typeof seat.uid==='string'?seat.uid:undefined,cards:revealed.length===2?revealed:known,start:units(seat.initialChips)??units(seat.startingStack)??old?.start??null}];
  });
  const parsed=parseLines(lines,players);
  // Only infer the starting stack when all observed actions are forced posts or folds.
  const opening=lines.length>0 && parsed.issues.length===0 && parsed.actions.every(a=>['sb','bb','fold'].includes(a.kind)) && !cards(p.communityCards).length;
  if(opening)for(const player of players){const chip=units(obj(p.seats[player.seat]).chips);if(chip!==null&&player.start===null)player.start=chip+parsed.actions.filter(a=>a.seat===player.seat).reduce((n,a)=>n+a.amount,0);}
  const historyShrunk=previous && lines.length<previous.rawLines.length;
  if(historyShrunk)return {...previous,updatedAt:at,issues:[...new Set([...previous.issues,'同じ卓IDで履歴の巻き戻りを検出。原本の確認が必要です'])],status:'incomplete'};
  const heroSeat=Number.isInteger(p.mySeatIndex)?p.mySeatIndex:previous?.heroSeat??null;
  const complete=results.length>0;const issues=[...parsed.issues,...cardIssues];
  const observedStacks=complete?previous?.observedStacks:players.map(player=>({seat:player.seat,amount:units(obj(p.seats[player.seat]).chips)}));
  const payouts:{seat:number;amount:number}[]=[];
  let rake:number|null=null;
  if(complete && players.length>=2 && results.length===players.length && new Set(results.map((r:any)=>r.seatIndex)).size===players.length && results.every((r:any)=>units(r.profit)!==null&&players.some(p=>p.seat===r.seatIndex))){
    // Return only the unique unmatched contribution. This does not invent a betting action.
    const contributed=()=>players.map(p=>({seat:p.seat,amount:parsed.actions.filter(a=>a.seat===p.seat).reduce((n,a)=>n+(a.kind==='return'?-a.amount:a.amount),0)})).sort((a,b)=>b.amount-a.amount);
    const totals=contributed(), excess=totals[0].amount-totals[1].amount;
    // Live Fast Fold snapshots reset every seat to its initial stack at settlement.
    // Only accept that reset if directly observed pre-settlement chips reconcile
    // with every player's full contribution. Missing observations fail closed.
    const verifiedReset=p.isHandInProgress===false&&players.every(player=>{
      const seat=obj(p.seats[player.seat]),spent=totals.find(t=>t.seat===player.seat)!.amount;
      return player.start!==null&&units(seat.chips)===player.start&&units(seat.initialChips)===player.start
        &&observedStacks?.find(s=>s.seat===player.seat)?.amount===player.start-spent;
    });
    const lastStreet=parsed.actions.at(-1)?.street??'preflop';
    if(excess>0 && !parsed.actions.some(a=>a.seat===totals[0].seat&&a.kind==='fold'))parsed.actions.push({seat:totals[0].seat,street:lastStreet,kind:'return',amount:excess});
    rake=-results.reduce((n:number,r:any)=>n+(units(r.profit)??0),0);
    for(const r of results){
      const player=players.find(p=>p.seat===r.seatIndex)!;
      const contribution=contributed().find(p=>p.seat===r.seatIndex)!.amount;
      const profit=units(r.profit)!,win=profit+contribution;
      if(win<0 || (r.isWinner===false&&win!==0))issues.push(`精算結果と投入額が不一致: ${player.position}`);
      if(win>0)payouts.push({seat:r.seatIndex,amount:win});
      const chips=units(obj(p.seats[r.seatIndex]).chips);
      if(player.start===null||chips===null||(!verifiedReset&&chips!==player.start-contribution&&chips!==player.start+profit))issues.push(`終了スタックを照合できません: ${player.position}`);
    }
  } else if(complete)issues.push('全プレイヤーの精算結果が揃っていません');
  const heroResult=results.find((r:any)=>r.seatIndex===heroSeat);
  const sourceId=typeof p.handId==='string'?p.handId:previous?.sourceId??`table:${p.tableId}`;
  if(!complete)issues.push('終了結果が未取得');
  return {id:key,sourceId,connection:c.connection,tableId:p.tableId,mode:key.startsWith('expert')?'expert':key.startsWith('private')?'private':'normal',startedAt:previous?.startedAt??at,updatedAt:at,heroSeat,button,players,board:cards(p.communityCards),actions:parsed.actions,payouts,rake,smallBlind:parsed.actions.find(a=>a.kind==='sb')?.amount??null,bigBlind:parsed.actions.find(a=>a.kind==='bb')?.amount??null,status:complete?'complete':'recording',issues,warnings:[GTO_IMPORT_STATUS,...(sourceId.startsWith('table:')?['出力IDは卓IDから生成します。日時は最初の受信時刻です。']:[])],rawLines:lines,profit:units(heroResult?.profit),...(observedStacks?{observedStacks}:{}),...(previous?.revealedAt?{revealedAt:previous.revealedAt}:{})};
}
