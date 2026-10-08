import { money, type Hand, type Street } from './types';
import { validateBettingOrder } from './betting';
export function validateHand(h:Hand):string[]{
  const errors=[...h.issues,...validateBettingOrder(h)];const add=(s:string)=>errors.push(s);
  if(h.status!=='complete')add('ハンドが完了していません');
  if(!h.sourceId)add('ハンドIDがありません');
  if(!Number.isFinite(h.startedAt))add('日時が不正です');
  if(h.players.length<2||h.players.length>6)add('対応人数は2〜6人です');
  const seats=new Set(h.players.map(p=>p.seat));
  if(seats.size!==h.players.length||h.players.some(p=>!Number.isInteger(p.seat)||p.seat<0||p.seat>8))add('席番号が不正です');
  if(h.button===null||!seats.has(h.button))add('ボタン位置が不明です');
  const hero=h.players.find(p=>p.seat===h.heroSeat);if(!hero||hero.cards.length!==2)add('自分のカードが不足しています');
  if(h.players.some(p=>p.start===null||!Number.isSafeInteger(p.start)||p.start<0))add('開始スタックが不明または不正です');
  if(!h.smallBlind||!h.bigBlind||h.smallBlind>=h.bigBlind)add('ブラインドが不明または不正です');
  const allCards=[...h.board,...h.players.flatMap(p=>p.cards)];
  if(allCards.some(c=>!/^[2-9TJQKA][cdhs]$/.test(c))||new Set(allCards).size!==allCards.length||![0,3,4,5].includes(h.board.length)||h.players.some(p=>![0,2].includes(p.cards.length)))add('カードの枚数・重複・表記が不正です');
  if(h.rake===null||!Number.isSafeInteger(h.rake)||h.rake<0)add('レーキが不明または不正です');
  const stacks=new Map(h.players.map(p=>[p.seat,p.start??0]));const paid=new Map<number,number>();const folded=new Set<number>();
  let street:Street='preflop',high=0,total=0;let lastStreet=0;
  const order:Street[]=['preflop','flop','turn','river'];
  if(h.actions.filter(a=>a.kind==='sb').length!==1||h.actions.filter(a=>a.kind==='bb').length!==1)add('ブラインド投稿が不足または重複しています');
  for(const a of h.actions){
    const si=order.indexOf(a.street);
    if(si<lastStreet||si<0)add('ストリート順序が不正です');
    lastStreet=si;
    if(({preflop:0,flop:3,turn:4,river:5}[a.street]??99)>h.board.length)add('ストリートに必要なボードがありません');
    if(a.street!==street){street=a.street;paid.clear();high=0;}
    if(!seats.has(a.seat)||folded.has(a.seat))add('不正な席またはフォールド後のアクションです');
    if(!Number.isSafeInteger(a.amount)||a.amount<0){add('投入額が不正です');continue;}
    const old=paid.get(a.seat)??0,stack=stacks.get(a.seat)??0;
    if(a.kind==='check'&&(a.amount!==0||old!==high))add('チェック時の投入額が一致しません');
    if(a.kind==='fold'&&a.amount!==0)add('フォールドでチップを投入しています');
    if(a.kind==='call'&&a.amount!==Math.min(stack,high-old))add('コール額が一致しません');
    if(a.kind==='bet'&&(high!==0||a.amount===0))add('ベット額またはタイミングが不正です');
    if(a.kind==='raise'&&(old+a.amount<=high||a.to!==old+a.amount))add('レイズ額が一致しません');
    if(a.kind==='return'&&(a.amount>old||a.amount<=0))add('未コール分の返却額が不正です');
    if(a.kind==='sb'&&(a.street!=='preflop'||a.amount!==h.smallBlind))add('SBが一致しません');
    if(a.kind==='bb'&&(a.street!=='preflop'||a.amount!==h.bigBlind))add('BBが一致しません');
    if(!['sb','bb','fold','check','call','bet','raise','return'].includes(a.kind))add('未対応のアクションです');
    const delta=a.kind==='return'?-a.amount:a.amount;
    if(delta>stack)add('スタックを超える投入です');
    if(a.allIn&&delta!==stack)add('オールイン額が一致しません');
    stacks.set(a.seat,stack-delta);paid.set(a.seat,old+delta);high=Math.max(0,...paid.values());total+=delta;
    if(a.kind==='fold')folded.add(a.seat);
  }
  if(h.payouts.length===0||h.payouts.some(p=>!seats.has(p.seat)||folded.has(p.seat)||!Number.isSafeInteger(p.amount)||p.amount<=0))add('獲得額または勝者が不正です');
  if(total!==h.payouts.reduce((n,p)=>n+p.amount,0)+(h.rake??0))add('投入額・獲得額・レーキが一致しません');
  const active=h.players.filter(p=>!folded.has(p.seat));
  if(active.length>1&&h.board.length!==5)add('ショーダウンのボードが不足しています');
  if(active.length>1&&h.payouts.some(w=>h.players.find(p=>p.seat===w.seat)?.cards.length!==2))add('ショーダウンの勝者カードが不足しています');
  if(h.payouts.length>1)add('複数ポット・分配の出力は初期版では未対応です');
  const hs=h.heroSeat;
  if(h.profit!==null&&hs!==null){const spent=h.actions.filter(a=>a.seat===hs).reduce((n,a)=>n+(a.kind==='return'?-a.amount:a.amount),0),won=h.payouts.filter(p=>p.seat===hs).reduce((n,p)=>n+p.amount,0);if(won-spent!==h.profit)add('自分の収支が一致しません');}
  return [...new Set(errors)];
}
export async function pokerstars(h:Hand):Promise<string>{
  const issues=validateHand(h);if(issues.length)throw new Error(issues.join('\n'));
  // Stable 60-bit numeric ID, namespaced to avoid reusing IDs from another poker site.
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`TenFour:${h.mode}:${h.sourceId}`)));
  const id=BigInt('0x'+Array.from(hash.slice(0,8),n=>n.toString(16).padStart(2,'0')).join('')).toString();
  const name=(seat:number)=>seat===h.heroSeat?'Hero':`Player${seat+1}`;
  const amount=(n:number)=>money(n).replaceAll(',','');
  const date=new Date(h.startedAt).toISOString().replace('T',' ').slice(0,19).replaceAll('-','/');
  const lines=[`PokerStars Hand #${id}: Hold'em No Limit ($${amount(h.smallBlind!)} / $${amount(h.bigBlind!)} USD) - ${date} UTC`,`Table 'TenFour-${id}' 6-max Seat #${h.button!+1} is the button`,...h.players.map(p=>`Seat ${p.seat+1}: ${name(p.seat)} ($${amount(p.start!)} in chips)`)];
  for(const a of h.actions.filter(a=>a.kind==='sb'||a.kind==='bb'))lines.push(`${name(a.seat)}: posts ${a.kind==='sb'?'small':'big'} blind $${amount(a.amount)}`);
  lines.push('*** HOLE CARDS ***',`Dealt to Hero [${h.players.find(p=>p.seat===h.heroSeat)!.cards.join(' ')}]`);
  let street:Street='preflop',high=h.bigBlind!;const paid=new Map<number,number>();
  for(const a of h.actions){
    if(a.street!==street){street=a.street;high=0;paid.clear();if(street==='flop')lines.push(`*** FLOP *** [${h.board.slice(0,3).join(' ')}]`);if(street==='turn')lines.push(`*** TURN *** [${h.board.slice(0,3).join(' ')}] [${h.board[3]}]`);if(street==='river')lines.push(`*** RIVER *** [${h.board.slice(0,4).join(' ')}] [${h.board[4]}]`);}
    const old=paid.get(a.seat)??0,next=old+(a.kind==='return'?-a.amount:a.amount);const suffix=a.allIn?' and is all-in':'';
    if(a.kind==='fold')lines.push(`${name(a.seat)}: folds`);
    if(a.kind==='check')lines.push(`${name(a.seat)}: checks`);
    if(a.kind==='call'||a.kind==='bet')lines.push(`${name(a.seat)}: ${a.kind==='call'?'calls':'bets'} $${amount(a.amount)}${suffix}`);
    if(a.kind==='raise')lines.push(`${name(a.seat)}: raises $${amount(next-high)} to $${amount(next)}${suffix}`);
    if(a.kind==='return')lines.push(`Uncalled bet ($${amount(a.amount)}) returned to ${name(a.seat)}`);
    paid.set(a.seat,next);high=Math.max(0,...paid.values());
  }
  // All-in runouts may have no actions on later streets.
  const order:Street[]=['preflop','flop','turn','river'];
  for(const next of order.slice(order.indexOf(street)+1)){
    if(next==='flop'&&h.board.length>=3)lines.push(`*** FLOP *** [${h.board.slice(0,3).join(' ')}]`);
    if(next==='turn'&&h.board.length>=4)lines.push(`*** TURN *** [${h.board.slice(0,3).join(' ')}] [${h.board[3]}]`);
    if(next==='river'&&h.board.length>=5)lines.push(`*** RIVER *** [${h.board.slice(0,4).join(' ')}] [${h.board[4]}]`);
  }
  const folded=new Set(h.actions.filter(a=>a.kind==='fold').map(a=>a.seat));const active=h.players.filter(p=>!folded.has(p.seat));
  if(active.length>1){lines.push('*** SHOW DOWN ***');for(const p of active)if(p.cards.length===2)lines.push(`${name(p.seat)}: shows [${p.cards.join(' ')}]`);}
  for(const p of h.payouts)lines.push(`${name(p.seat)} collected $${amount(p.amount)} from pot`);
  const total=h.payouts.reduce((n,p)=>n+p.amount,0)+h.rake!;
  lines.push('*** SUMMARY ***',`Total pot $${amount(total)} | Rake $${amount(h.rake!)}`);
  if(h.board.length)lines.push(`Board [${h.board.join(' ')}]`);
  for(const p of h.players){const win=h.payouts.filter(w=>w.seat===p.seat).reduce((n,w)=>n+w.amount,0);const fold=h.actions.find(a=>a.seat===p.seat&&a.kind==='fold');lines.push(`Seat ${p.seat+1}: ${name(p.seat)}${p.seat===h.button?' (button)':''} ${fold?`folded ${fold.street==='preflop'?'before Flop':`on the ${fold.street[0].toUpperCase()+fold.street.slice(1)}`}`:win?`collected ($${amount(win)})`:'mucked'}`);}
  return lines.join('\n')+'\n\n';
}
