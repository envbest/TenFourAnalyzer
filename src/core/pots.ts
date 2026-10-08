import type {Hand} from './types';
export interface Pot { amount:number; eligible:number[]; awards:{seat:number;amount:number}[]; rake:number }

/** Lexicographically sortable five-card rank; wheel straights use five as high card. */
function rankFive(cards:string[]):number {
  const values=cards.map(c=>'23456789TJQKA'.indexOf(c[0])+2).sort((a,b)=>b-a);
  const groups=[...new Set(values)].map(v=>({v,n:values.filter(x=>x===v).length})).sort((a,b)=>b.n-a.n||b.v-a.v);
  const unique=[...new Set(values)],flush=cards.every(c=>c[1]===cards[0][1]);
  const straight=unique.length===5?(unique[0]-unique[4]===4?unique[0]:unique.join()==='14,5,4,3,2'?5:0):0;
  let score:number[];
  if(flush&&straight)score=[8,straight];
  else if(groups[0].n===4)score=[7,groups[0].v,groups[1].v];
  else if(groups[0].n===3&&groups[1].n===2)score=[6,groups[0].v,groups[1].v];
  else if(flush)score=[5,...values];
  else if(straight)score=[4,straight];
  else if(groups[0].n===3)score=[3,...groups.map(g=>g.v)];
  else if(groups[0].n===2&&groups[1].n===2)score=[2,...groups.map(g=>g.v)];
  else if(groups[0].n===2)score=[1,...groups.map(g=>g.v)];
  else score=[0,...values];
  while(score.length<6)score.push(0);
  return score.reduce((n,v)=>n*15+v,0);
}
export function rankSeven(cards:string[]):number|null {
  if(cards.length!==7||new Set(cards).size!==7||cards.some(c=>!/^[2-9TJQKA][cdhs]$/.test(c)))return null;
  let best=0;
  for(let a=0;a<7;a++)for(let b=a+1;b<7;b++)best=Math.max(best,rankFive(cards.filter((_,i)=>i!==a&&i!==b)));
  return best;
}

// Integer transportation flow: pot supplies must match winner payouts plus rake.
// Bounds let us test whether a second allocation is possible instead of guessing.
function allocate(supplies:number[],demands:number[],allowed:boolean[][],bound?:{p:number;r:number;min?:number;max?:number}){
  const supply=[...supplies],demand=[...demands],lower=bound?.min??0;
  if(bound){supply[bound.p]-=lower;demand[bound.r]-=lower;}
  if(supply.some(n=>n<0)||demand.some(n=>n<0))return null;
  const n=2+supply.length+demand.length,sink=n-1,cap=Array.from({length:n},()=>Array(n).fill(0));
  for(let p=0;p<supply.length;p++){
    cap[0][1+p]=supply[p];
    for(let r=0;r<demand.length;r++)if(allowed[p][r])cap[1+p][1+supply.length+r]=(bound?.p===p&&bound.r===r?(bound.max??supplies[p])-lower:supplies[p]);
  }
  demand.forEach((d,r)=>cap[1+supply.length+r][sink]=d);
  const initial=cap.map(row=>[...row]);let flow=0;
  while(true){
    const parent=Array(n).fill(-1),queue=[0];parent[0]=0;
    for(let i=0;i<queue.length&&parent[sink]<0;i++)for(let v=0;v<n;v++)if(parent[v]<0&&cap[queue[i]][v]>0){parent[v]=queue[i];queue.push(v);}
    if(parent[sink]<0)break;
    let delta=Infinity;for(let v=sink;v!==0;v=parent[v])delta=Math.min(delta,cap[parent[v]][v]);
    for(let v=sink;v!==0;v=parent[v]){cap[parent[v]][v]-=delta;cap[v][parent[v]]+=delta;}flow+=delta;
  }
  if(flow!==supply.reduce((a,b)=>a+b,0)||flow!==demand.reduce((a,b)=>a+b,0))return null;
  return supply.map((_,p)=>demand.map((_,r)=>initial[1+p][1+supply.length+r]-cap[1+p][1+supply.length+r]+(bound?.p===p&&bound.r===r?lower:0)));
}

export function settlementPots(h:Hand):{pots:Pot[];issues:string[]} {
  const fail=(issue:string)=>({pots:[] as Pot[],issues:[issue]});
  const folded=new Set(h.actions.filter(a=>a.kind==='fold').map(a=>a.seat));
  const totals=h.players.map(p=>({seat:p.seat,amount:h.actions.filter(a=>a.seat===p.seat).reduce((n,a)=>n+(a.kind==='return'?-a.amount:a.amount),0)}));
  if(totals.some(t=>!Number.isSafeInteger(t.amount)||t.amount<0))return fail('ポットへの投入額が不正です');
  const levels=[...new Set(totals.map(t=>t.amount).filter(n=>n>0))].sort((a,b)=>a-b),pots:Pot[]=[];let previous=0;
  for(const level of levels){
    const contributors=totals.filter(t=>t.amount>=level),eligible=contributors.filter(t=>!folded.has(t.seat)).map(t=>t.seat).sort((a,b)=>a-b);
    const amount=(level-previous)*contributors.length;previous=level;
    if(!eligible.length)return fail('獲得できるプレイヤーがいないポットです');
    if(contributors.length===1)return fail('未コール分の返却が不足しています');
    const last=pots.at(-1);if(last&&last.eligible.join()===eligible.join())last.amount+=amount;else pots.push({amount,eligible,awards:[],rake:0});
  }
  if(!pots.length||h.rake===null||h.rake<0||!Number.isSafeInteger(h.rake)||h.payouts.some(w=>w.amount<=0||!Number.isSafeInteger(w.amount)))return fail('ポットの精算情報が不足しています');
  const seats=[...new Set(h.payouts.map(w=>w.seat))],demands=seats.map(seat=>h.payouts.filter(w=>w.seat===seat).reduce((n,w)=>n+w.amount,0));
  const hasRake=h.rake>0;if(hasRake)demands.push(h.rake);
  const winners:number[][]=[];
  for(const pot of pots){
    if(pot.eligible.length===1){winners.push(pot.eligible);continue;}
    const ranked=pot.eligible.map(seat=>({seat,rank:rankSeven([...h.board,...h.players.find(p=>p.seat===seat)!.cards])}));
    // Single-pot records may legitimately omit a mucked loser's cards.
    if(ranked.some(p=>p.rank===null)){
      if(pots.length>1)return fail('サイドポットの配分確認に必要な公開カードが不足しています');
      winners.push(pot.eligible);continue;
    }
    const best=Math.max(...ranked.map(p=>p.rank!));winners.push(ranked.filter(p=>p.rank===best).map(p=>p.seat));
  }
  const allowed=pots.map((_,p)=>demands.map((_,r)=>r===seats.length||winners[p].includes(seats[r])));
  const amounts=pots.map(p=>p.amount);
  const fixedSplit=pots.length>1&&!hasRake;
  let allocation:number[][]|null;
  if(fixedSplit){
    allocation=pots.map((pot,p)=>{
      const ordered=[...winners[p]];
      // The first occupied seat left of the button receives the odd chip.
      ordered.sort((a,b)=>((a-(h.button??0)+8)%9)-((b-(h.button??0)+8)%9));
      const share=Math.floor(pot.amount/ordered.length),extra=pot.amount%ordered.length;
      return seats.map(seat=>{const i=ordered.indexOf(seat);return i<0?0:share+(i<extra?1:0);});
    });
    if(allocation.some((row,p)=>row.reduce((a,b)=>a+b,0)!==amounts[p])||demands.some((n,r)=>allocation!.reduce((s,row)=>s+row[r],0)!==n))allocation=null;
  }else allocation=allocate(amounts,demands,allowed);
  if(!allocation)return fail('獲得額・ポット参加資格・公開カードの勝敗が一致しません');
  if(pots.length>1&&!fixedSplit)for(let p=0;p<pots.length;p++)for(let r=0;r<demands.length;r++)if(allowed[p][r]){
    const n=allocation[p][r];
    if((n>0&&allocate(amounts,demands,allowed,{p,r,max:n-1}))||(n<Math.min(amounts[p],demands[r])&&allocate(amounts,demands,allowed,{p,r,min:n+1})))return fail('サイドポットごとの獲得額・レーキ配分を一意に確定できません');
  }
  for(let p=0;p<pots.length;p++){
    pots[p].awards=seats.flatMap((seat,r)=>allocation[p][r]>0?[{seat,amount:allocation[p][r]}]:[]);
    pots[p].rake=hasRake?allocation[p][seats.length]:0;
    if(winners[p].length>1&&winners[p].every(seat=>h.players.find(p=>p.seat===seat)?.cards.length===2)&&h.board.length===5){
      const shares=winners[p].map(seat=>pots[p].awards.find(w=>w.seat===seat)?.amount??0);
      if(Math.max(...shares)-Math.min(...shares)>1)return fail('同役のポット分配額が一致しません');
    }
  }
  return {pots,issues:[]};
}
