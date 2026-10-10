type Downloads=Pick<typeof chrome.downloads,'download'|'search'|'onChanged'|'onErased'>;

/** Starting a download is not proof that the user saved it. */
export async function completedDownload(api:Downloads,url:string,filename:string):Promise<void>{
  const id=await api.download({url,filename,saveAs:true});
  if(!Number.isInteger(id))throw new Error('ダウンロードを開始できませんでした');
  await new Promise<void>((resolve,reject)=>{
    let finished=false;
    const finish=(error?:Error)=>{
      if(finished)return;finished=true;
      api.onChanged.removeListener(changed);api.onErased.removeListener(erased);
      error?reject(error):resolve();
    };
    const inspect=(state?:string)=>{
      if(state==='complete')finish();
      else if(state==='interrupted')finish(new Error('保存がキャンセルされたか中断されました'));
    };
    const changed=(delta:chrome.downloads.DownloadDelta)=>{if(delta.id===id)inspect(delta.state?.current);};
    const erased=(erasedId:number)=>{if(erasedId===id)finish(new Error('保存完了を確認できませんでした'));};
    api.onChanged.addListener(changed);api.onErased.addListener(erased);
    // Completion may precede listener registration. Search closes that race.
    void api.search({id}).then(items=>{
      if(items.length)inspect(items[0].state);
      else finish(new Error('保存完了を確認できませんでした'));
    }).catch(error=>finish(error instanceof Error?error:new Error(String(error))));
  });
}
