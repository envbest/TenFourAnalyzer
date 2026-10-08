import type { Hand, Street } from './types';
export function replay(hand:Hand,step=hand.actions.length){
  const balances=new Map(hand.players.map(p=>[p.seat,p.start]));
  const contributions=new Map(hand.players.map(p=>[p.seat,0]));const folded=new Set<number>();
  let pot=0;let street:Street='preflop';
  for(const a of hand.actions.slice(0,step)){
    street=a.street;if(a.kind==='fold')folded.add(a.seat);
    const delta=a.kind==='return'?-a.amount:a.amount;
    const balance=balances.get(a.seat);if(balance!=null)balances.set(a.seat,balance-delta);
    contributions.set(a.seat,(contributions.get(a.seat)??0)+delta);pot+=delta;
  }
  const count={preflop:0,flop:3,turn:4,river:5}[street];
  return {balances,contributions,folded,pot,street,board:hand.board.slice(0,count)};
}
