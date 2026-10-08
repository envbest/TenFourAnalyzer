import type { Hand, Street } from './types';
/** Reject incomplete decision sequences even when the chip totals happen to balance. */
export function validateBettingOrder(h:Hand):string[]{
  const problems:string[]=[];
  const seats=h.players.map(p=>p.seat).sort((a,b)=>a-b);
  const stacks=new Map(h.players.map(p=>[p.seat,p.start??0]));
  const folded=new Set<number>();let paid=new Map<number,number>();
  let street:Street='preflop',current=0,lastRaise=h.bigBlind??0,decisions=false,returned=false;
  let pending=new Set<number>();let cursor=h.actions.find(a=>a.kind==='bb')?.seat??h.button??0;
  const active=()=>seats.filter(s=>!folded.has(s)&&(stacks.get(s)??0)>0);
  const stillIn=()=>seats.filter(s=>!folded.has(s));
  const next=()=>{for(let step=1;step<=seats.length;step++){const s=seats[(seats.indexOf(cursor)+step)%seats.length];if(pending.has(s)&&!folded.has(s)&&(stacks.get(s)??0)>0)return s;}return undefined;};
  const unfinished=()=>stillIn().length>1&&[...pending].some(s=>!folded.has(s)&&(stacks.get(s)??0)>0);
  for(const a of h.actions){
    if(a.street!==street){
      if(unfinished())problems.push('前のストリートのアクションが完了していません');
      street=a.street;paid=new Map;current=0;lastRaise=h.bigBlind??0;cursor=h.button??0;decisions=true;
      const eligible=active();pending=new Set(eligible.length>1?eligible:[]);
    }
    if(a.kind==='sb'||a.kind==='bb'){
      if(decisions)problems.push('ブラインド投稿の順序が不正です');
      paid.set(a.seat,(paid.get(a.seat)??0)+a.amount);stacks.set(a.seat,(stacks.get(a.seat)??0)-a.amount);current=Math.max(current,paid.get(a.seat)!);continue;
    }
    if(a.kind==='return'){
      const ranked=[...paid.entries()].sort((a,b)=>b[1]-a[1]);
      if(!ranked.length||ranked[0][0]!==a.seat||a.amount!==ranked[0][1]-(ranked[1]?.[1]??0))problems.push('返却額が未コール分と一致しません');
      returned=true;paid.set(a.seat,(paid.get(a.seat)??0)-a.amount);continue;
    }
    if(returned)problems.push('返却後にアクションが続いています');
    if(!decisions){decisions=true;pending=new Set(active());}
    if(stillIn().length<2)problems.push('勝者確定後にアクションが続いています');
    if(next()!==a.seat)problems.push('アクション順序が不正または途中のアクションが不足しています');
    const old=paid.get(a.seat)??0,remaining=stacks.get(a.seat)??0,newTotal=old+a.amount;
    if(a.kind==='bet'||a.kind==='raise'){
      const increment=newTotal-current;
      if(increment<lastRaise&&a.amount!==remaining)problems.push('最小レイズ額を満たしていません');
      if(increment>=lastRaise)lastRaise=increment;
      current=newTotal;pending=new Set(active().filter(s=>s!==a.seat));
    }
    if(a.kind==='fold')folded.add(a.seat);
    pending.delete(a.seat);cursor=a.seat;paid.set(a.seat,newTotal);stacks.set(a.seat,remaining-a.amount);
  }
  if(unfinished())problems.push('最終ストリートのアクションが不足しています');
  const sb=h.actions.find(a=>a.kind==='sb'),bb=h.actions.find(a=>a.kind==='bb');
  if(sb&&bb&&h.button!==null){const after=(s:number)=>seats[(seats.indexOf(s)+1)%seats.length];if(sb.seat!==(seats.length===2?h.button:after(h.button))||bb.seat!==after(sb.seat))problems.push('ブラインドとボタンの位置が一致しません');}
  return [...new Set(problems)];
}
