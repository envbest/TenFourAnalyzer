import {decodeFrames,sanitize} from '../core/protocol';
(() => {
  const CHANNEL='tenfour-analyzer-capture-v1';
  let sequence=0;
  const safeHost=(url:string)=>{try{const u=new URL(url,location.href);return u.hostname==='game.tenfour-poker.com'&&u.pathname.startsWith('/socket.io/');}catch{return false;}};
  const emit=(event:string,payload:unknown,connection:string)=>{
    try{window.postMessage({channel:CHANNEL,capture:{id:crypto.randomUUID(),at:Date.now(),sequence:sequence++,event,payload:sanitize(payload),connection}},location.origin);}catch{/* Never interrupt game delivery. */}
  };
  const Original=window.WebSocket;
  window.WebSocket=new Proxy(Original,{construct(Target,args){
    const socket=Reflect.construct(Target,args) as WebSocket;
    if(safeHost(String(args[0]))){
      const id=crypto.randomUUID();let chain=Promise.resolve();
      socket.addEventListener('message',(e:MessageEvent)=>{
        chain=chain.then(async()=>{const raw=typeof e.data==='string'?e.data:e.data instanceof Blob?await e.data.text():null;if(raw)for(const packet of decodeFrames(raw))emit(packet.event,packet.payload,id);}).catch(()=>{});
      });
      socket.addEventListener('close',()=>{chain.then(()=>emit('connectionClosed',{},id)).catch(()=>{});});
    }
    return socket;
  }});
  // Passive observation of regular hand detail JSON. No export endpoints or outgoing auth are recorded.
  const originalFetch=window.fetch;
  window.fetch=function(...args:Parameters<typeof fetch>){
    const promise=Reflect.apply(originalFetch,this,args) as Promise<Response>;
    try{
      const address=args[0] instanceof Request?args[0].url:String(args[0]);const url=new URL(address,location.href);
      if(url.hostname==='game.tenfour-poker.com'&&/^\/api\/hand\/[a-zA-Z0-9_-]+$/.test(url.pathname)){
        void promise.then(response=>{if(response.ok)return response.clone().text().then(raw=>{if(raw.length<2_000_000)emit('handDetail',{handId:url.pathname.split('/').at(-1),detail:JSON.parse(raw)},'http');});}).catch(()=>{});
      }
    }catch{/* Preserve native fetch behavior. */}
    return promise;
  };
})();
