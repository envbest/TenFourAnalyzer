import {fromSnapshot,recordKey} from './adapter';
import {fromHistory} from './history';
import type {Capture,Hand} from './types';

/** The same transition is used by live recording and offline reconstruction. */
export function applyCapture(c:Capture,previous?:Hand):Hand|undefined {
  if(previous&&c.at<previous.updatedAt)return previous;
  if(c.event.endsWith('TableState')){
    if(previous?.historyCompletedAt)return previous;
    const next=fromSnapshot(c,previous)??previous;
    return previous?.status==='complete'&&next?.status!=='complete'?previous:next;
  }
  if(previous?.connection&&previous.connection!==c.connection)return previous;
  const removed=c.event.endsWith('TableRemoved');
  if(previous&&((removed&&previous.status!=='complete')||(c.event==='connectionClosed'&&previous.status==='recording'))){
    const issue=removed?'卓から退出。終了結果の補完が必要です':'接続が終了しました';
    return {...previous,status:'incomplete',updatedAt:c.at,issues:[...new Set([...previous.issues,issue])]};
  }
  return previous;
}

export function removalMatches(c:Capture,h:Hand){
  const key=recordKey(c);
  return !!key&&(h.id===key||h.id.startsWith(key+':'))&&(!h.connection||h.connection===c.connection);
}

export function reconstruct(events:Capture[]){
  const hands=new Map<string,Hand>(),connections=new Map<string,Set<string>>(),ambiguous=new Set<string>();
  const ordered=[...events].sort((a,b)=>a.at-b.at);
  // Old captures have millisecond timestamps but no ordering within a millisecond.
  // Never guess that ordering from random event IDs.
  for(let start=0;start<ordered.length;){
    let end=start+1;while(end<ordered.length&&ordered[end].at===ordered[start].at)end++;
    const group=ordered.slice(start,end).sort((a,b)=>a.connection.localeCompare(b.connection)||(a.sequence??0)-(b.sequence??0)),touched=new Map<string,Capture>();
    for(const c of group){const key=recordKey(c);if(key){let ids=connections.get(c.connection);if(!ids)connections.set(c.connection,ids=new Set);ids.add(key);}}
    for(const c of group){
      if(c.event==='handDetail'){
        const matches=[...hands.values()].filter(h=>!ambiguous.has(h.id)).map(h=>fromHistory(c,h)).filter((h):h is Hand=>!!h);
        if(matches.length===1)hands.set(matches[0].id,matches[0]);
        continue;
      }
      const key=recordKey(c);
      const ids=c.event==='connectionClosed'?[...connections.get(c.connection)??[]]:c.event.endsWith('TableRemoved')?[...connections.get(c.connection)??[]].filter(id=>id===key||id.startsWith(key+':')):key&&c.event.endsWith('TableState')?[key]:[];
      for(const id of ids){
        const earlier=touched.get(id);
        if(earlier&&(earlier.connection!==c.connection||earlier.sequence===undefined||c.sequence===undefined||earlier.sequence>=c.sequence))ambiguous.add(id);touched.set(id,c);
        const h=applyCapture(c,hands.get(id));if(h)hands.set(id,h);
      }
    }
    start=end;
  }
  for(const id of ambiguous)hands.delete(id);
  return {hands,ambiguous};
}

/** A partial archive must not erase information available only in an imported hand. */
export function preservesEvidence(next:Hand,old:Hand){
  return next.updatedAt>=old.updatedAt&&next.startedAt<=old.startedAt
    &&(old.status!=='complete'||next.status==='complete')
    &&(old.heroSeat===null||next.heroSeat!==null)&&(old.button===null||next.button!==null)
    &&(old.profit===null||next.profit!==null)&&(old.rake===null||next.rake!==null)
    &&next.payouts.length>=old.payouts.length
    &&(!old.sourceId||old.sourceId.startsWith('table:')||next.sourceId===old.sourceId)
    &&next.rawLines.length>=old.rawLines.length&&next.board.length>=old.board.length
    &&old.players.every(p=>{const n=next.players.find(n=>n.seat===p.seat);return n&&(p.start===null||n.start!==null)&&n.cards.length>=p.cards.length;});
}
