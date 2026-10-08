import type { Hand, Action } from './types';
const a=(seat:number,kind:Action['kind'],amount=0,street:Action['street']='preflop',to?:number):Action=>({seat,kind,amount,street,...(to===undefined?{}:{to})});
export function demoHands():Hand[]{
  const at=Date.now();
  const base:Hand={id:'demo:001',sourceId:'demo-001',tableId:'demo-table',mode:'normal',startedAt:at-300000,updatedAt:at-250000,heroSeat:0,button:0,players:[{seat:0,name:'You',position:'BTN',cards:['As','Ks'],start:10000},{seat:1,name:'Player 2',position:'SB',cards:[],start:10000},{seat:2,name:'Player 3',position:'BB',cards:[],start:10000},{seat:3,name:'Player 4',position:'UTG',cards:[],start:10000},{seat:4,name:'Player 5',position:'HJ',cards:[],start:10000},{seat:5,name:'Player 6',position:'CO',cards:[],start:10000}],board:['Ah','7s','2d'],actions:[a(1,'sb',50),a(2,'bb',100),a(3,'fold'),a(4,'fold'),a(5,'fold'),a(0,'raise',250,'preflop',250),a(1,'fold'),a(2,'call',150),a(2,'check',0,'flop'),a(0,'bet',200,'flop'),a(2,'fold',0,'flop'),a(0,'return',200,'flop')],payouts:[{seat:0,amount:523}],rake:27,smallBlind:50,bigBlind:100,status:'complete',issues:[],warnings:[],rawLines:[],profit:273,demo:true};
  const second:Hand={...structuredClone(base),id:'demo:002',sourceId:'demo-002',startedAt:at-600000,heroSeat:2,profit:-250,players:base.players.map(p=>({...p,cards:p.seat===2?['Qh','Qd']:[]}))};
  const third:Hand={...structuredClone(base),id:'demo:003',sourceId:'demo-003',startedAt:at-900000,board:[],actions:base.actions.slice(0,4),payouts:[],rake:null,profit:null,status:'incomplete',issues:['Fast Fold後の終了結果が未取得'],players:base.players.map(p=>({...p,cards:p.seat===0?['7s','6s']:[]}))};
  return [base,second,third];
}
