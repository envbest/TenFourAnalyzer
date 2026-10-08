import type { Capture } from './types';
export const EVENTS = new Set(['fastFoldTableState','expertFastFoldTableState','privateFastFoldTableState','fastFoldTableRemoved','expertFastFoldTableRemoved','privateFastFoldTableRemoved','fastFoldState','expertFastFoldState','privateFastFoldState']);
export function decodeFrames(raw: string): {event:string;payload:unknown}[] {
  const out:{event:string;payload:unknown}[]=[];
  if (raw.length>2_000_000) return out;
  for (const frame of raw.split('\x1e')) {
    // Engine.IO MESSAGE + Socket.IO EVENT, optional namespace / ack id.
    const m=frame.match(/^42(?:\/[^,]*,)?\d*(\[.*)$/s);
    if (!m) continue;
    try {const value=JSON.parse(m[1]); if(Array.isArray(value) && EVENTS.has(value[0]) && value[1] && typeof value[1]==='object')out.push({event:value[0],payload:value[1]});} catch { /* Non-JSON/binary packets are never persisted. */ }
  }
  return out;
}
export function sanitize(value:unknown,depth=0):unknown {
  if(depth>20) return null;
  if(typeof value==='string')return value.slice(0,20_000);
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(value===null||typeof value==='boolean')return value;
  if(Array.isArray(value))return value.slice(0,4000).map(v=>sanitize(v,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!/(token|authorization|cookie|password|secret|email|credential|sessionid|__proto__|constructor|prototype)/i.test(k)).slice(0,200).map(([k,v])=>[k,sanitize(v,depth+1)]));
  return null;
}
export function validCapture(value:unknown):value is Capture {
  if(!value||typeof value!=='object')return false;
  const x=value as Capture;
  return typeof x.id==='string' && x.id.length>0 && x.id.length<=180 && typeof x.connection==='string' && x.connection.length>0 && x.connection.length<=180 && Number.isSafeInteger(x.at) && x.at>=0 && Number.isFinite(new Date(x.at).getTime()) && (EVENTS.has(x.event)||x.event==='handDetail'||x.event==='connectionClosed') && !!x.payload && typeof x.payload==='object' && !Array.isArray(x.payload) && (x.sequence===undefined||(Number.isSafeInteger(x.sequence)&&x.sequence>=0));
}
