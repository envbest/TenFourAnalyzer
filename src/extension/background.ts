import {ingest,setStatus} from '../core/store';
chrome.action.onClicked.addListener(()=>{void chrome.tabs.create({url:chrome.runtime.getURL('index.html')});});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id||!sender.tab||!sender.url?.startsWith('https://tenfour-poker.com/'))return false;
  if(message.type==='capture'){
    ingest(message.capture).then(()=>reply({ok:true})).catch(async error=>{const text=error instanceof Error?error.message:'記録に失敗しました';await setStatus({error:text}).catch(()=>{});reply({ok:false,error:text});});return true;
  }
  if(message.type==='captureError'){void setStatus({error:String(message.error).slice(0,500)});reply({ok:true});}
  return false;
});
