import test from 'node:test';
import assert from 'node:assert/strict';
import {completedDownload} from '../src/ui/completedDownload';
function mock(){
  const changes=new Set<(d:chrome.downloads.DownloadDelta)=>void>(),erased=new Set<(id:number)=>void>();
  const api={download:async()=>7,search:async()=>[{id:7,state:'in_progress'}],onChanged:{addListener:(f:any)=>changes.add(f),removeListener:(f:any)=>changes.delete(f)},onErased:{addListener:(f:any)=>erased.add(f),removeListener:(f:any)=>erased.delete(f)}};
  const send=(id:number,state:string)=>changes.forEach(f=>f({id,state:{current:state}}));
  return {api:api as unknown as Parameters<typeof completedDownload>[0],raw:api,changes,erased,send};
}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('canceling the save dialog cannot reach export-history recording',async()=>{
  const m=mock();m.raw.download=async()=>{throw new Error('Download canceled');};let marked=false;
  await assert.rejects(completedDownload(m.api,'blob:test','test.txt').then(()=>{marked=true;}));
  assert.equal(marked,false);assert.equal(m.changes.size,0);
});
test('starting a download does not mark it; only its own completion does',async()=>{
  const m=mock();let marked=false;
  const p=completedDownload(m.api,'blob:test','test.txt').then(()=>{marked=true;});await tick();
  assert.equal(marked,false);m.send(99,'complete');await tick();assert.equal(marked,false);
  m.send(7,'complete');await p;assert.equal(marked,true);assert.equal(m.changes.size,0);assert.equal(m.erased.size,0);
});
test('interruption and removal leave export history untouched',async()=>{
  for(const remove of [false,true]){const m=mock();let marked=false;
    const p=completedDownload(m.api,'blob:test','test.txt').then(()=>{marked=true;});const rejected=assert.rejects(p);await tick();
    if(remove)m.erased.forEach(f=>f(7));else m.send(7,'interrupted');
    await rejected;assert.equal(marked,false);assert.equal(m.changes.size,0);assert.equal(m.erased.size,0);
  }
});
test('completion before event subscription is detected by the exact download ID',async()=>{
  const m=mock();m.raw.search=async()=>[{id:7,state:'complete'}];
  await completedDownload(m.api,'blob:test','test.txt');assert.equal(m.changes.size,0);
});
test('missing download and failed status query cannot count as success',async()=>{
  for(const failed of [false,true]){const m=mock();m.raw.search=async()=>{if(failed)throw new Error('search failed');return [];};
    await assert.rejects(completedDownload(m.api,'blob:test','test.txt'));assert.equal(m.changes.size,0);
  }
});
