import type {RecorderStatus} from '../core/types';

export function recorderState(rec:RecorderStatus,now=Date.now()){
  if(rec.error)return 'error';
  if(!rec.enabled)return 'paused';
  if(!rec.lastSeen)return 'unreceived';
  return now-rec.lastSeen<20_000?'receiving':'idle';
}
export const recorderLabels={error:'保存エラー',paused:'記録停止中',unreceived:'まだ受信を確認できていません',receiving:'データ受信中',idle:'新しいデータを待っています'};

export function RecorderNotice({rec,onRefresh,onResume}:{rec:RecorderStatus;onRefresh:()=>Promise<void>;onResume:()=>Promise<void>}){
  const state=recorderState(rec);
  const guide=<>
    <ol>
      <li>この拡張機能を入れたブラウザ・プロファイルでTenFourを開きます。</li>
      <li><strong>拡張機能の導入・更新後は、TenFourのページを再読み込みしてください。</strong> プレイ中なら、終了してから行ってください。</li>
      <li>TenFourの「Hand History」で過去のハンド詳細を1件開き、ここに戻ります。</li>
    </ol>
    <p>保存イベント数が増え、最終保存時刻が更新されれば受信できています。表示は約3秒ごとに更新します。履歴詳細だけではハンド一覧に追加されない場合があります。</p>
    <div className="button-row"><a className="button secondary" href="https://tenfour-poker.com/" target="_blank" rel="noopener noreferrer">TenFourを開く</a><button className="button secondary" onClick={()=>void onRefresh()}>状態を更新</button></div>
    <p className="muted">変わらない場合は、拡張機能が有効か、TenFourへのサイトアクセスが許可されているかをブラウザの拡張機能管理画面で確認してください。</p>
  </>;
  return <section className={`recorder-notice ${state}`} aria-label="記録の受信状況">
    <h2>{recorderLabels[state]}</h2>
    {state==='unreceived'&&<p>拡張機能を読み込むだけでは、すでに開いているTenFourの記録は始まりません。まず次の手順で受信を確認してください。</p>}
    {state==='idle'&&<p>以前の受信は確認済みです。直近20秒間は対象データを受信していません。ロビーや操作していない間にもこの表示になります。接続が切れたという判定ではありません。</p>}
    {state==='receiving'&&<p>対象データを受信し、ブラウザ内に保存しています。</p>}
    {state==='paused'&&<p>自動記録を停止しています。新しいデータを保存するには記録を再開してください。</p>}
    {state==='error'&&<p>保存処理でエラーが発生しています。画面のエラー内容を確認してください。未保存のデータがある可能性があるため、TenFourのページを閉じたり再読み込みしたりする前に確認してください。</p>}
    <p className="recorder-metrics">保存イベント数：<strong>{rec.events.toLocaleString()} 件</strong><span>最終保存：{rec.lastSaved?new Date(rec.lastSaved).toLocaleString('ja-JP'):'まだ保存されていません'}</span></p>
    {state==='paused'&&<button className="button primary" onClick={()=>void onResume()}>記録を再開する</button>}
    {state==='unreceived'?guide:(state==='idle'||state==='receiving')&&<details><summary>記録されないときの確認手順</summary>{guide}</details>}
  </section>;
}
