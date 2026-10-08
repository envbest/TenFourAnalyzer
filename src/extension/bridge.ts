import { validCapture } from '../core/protocol';
import type { Capture } from '../core/types';
const queue:Capture[]=[];let running=false;let retry=0;
async function flush(){
  if(running)return;running=true;
  try{while(queue.length){const response=await chrome.runtime.sendMessage({type:'capture',capture:queue[0]});if(!response?.ok)throw new Error(response?.error??'保存失敗');queue.shift();retry=0;}}
  catch {retry++;setTimeout(flush,Math.min(30_000,1000*2**Math.min(retry,5)));}
  finally{running=false;}
}
window.addEventListener('message',e=>{
  if(e.source!==window||e.origin!==location.origin||e.data?.channel!=='tenfour-analyzer-capture-v1'||!validCapture(e.data.capture))return;
  if(JSON.stringify(e.data.capture).length>2_000_000)return;
  if(queue.length>=1000){void chrome.runtime.sendMessage({type:'captureError',error:'保存待ちが上限に達しました。ページを閉じずに記録状況を確認してください。'}).catch(()=>{});return;}
  queue.push(e.data.capture);void flush();
});
