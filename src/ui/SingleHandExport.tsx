import {useEffect,useRef,useState} from 'react';
import {Copy,Download,FileText,X} from 'lucide-react';
import {pokerstars,validateHand} from '../core/export';
import type {Hand} from '../core/types';

export function SingleHandExport({hand}:{hand:Hand}){
  const dialog=useRef<HTMLDialogElement>(null),field=useRef<HTMLTextAreaElement>(null);
  const [prepared,setPrepared]=useState<{text:string;filename:string;label:string;demo:boolean}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const issues=validateHand(hand);
  useEffect(()=>{if(prepared&&!dialog.current?.open)dialog.current?.showModal();},[prepared]);
  const prepare=async()=>{
    setBusy(true);setError('');setMessage('');
    try{
      const text=await pokerstars(hand),id=text.match(/^PokerStars Hand #(\d+)/)![1];
      setPrepared({text,filename:`tenfour-${id}${hand.demo?'-DEMO':''}.txt`,label:hand.sourceId??hand.id,demo:!!hand.demo});
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const copy=async()=>{
    if(!prepared)return;setError('');setMessage('');
    try{await navigator.clipboard.writeText(prepared.text);setMessage('このハンドをコピーしました');}
    catch{field.current?.focus();field.current?.select();setError('自動コピーできませんでした。選択されたテキストを Ctrl+C（Macは⌘C）でコピーしてください。');}
  };
  const download=()=>{
    if(!prepared)return;
    const url=URL.createObjectURL(new Blob([prepared.text],{type:'text/plain;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=prepared.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
  };
  return <div className="single-hand-export">
    <button className="button secondary small-button" disabled={busy||issues.length>0} onClick={()=>void prepare()}><FileText size={16}/>{busy?'作成中…':'このハンドを出力'}</button>
    {issues.length>0&&<p className="muted">出力保留：{issues[0]}。確認事項を参照してください。</p>}
    {!prepared&&error&&<p role="alert">{error}</p>}
    <dialog ref={dialog} className="modal single-hand-dialog" aria-labelledby="single-export-title" onClose={()=>{setPrepared(null);setError('');setMessage('');}}>
      <button className="modal-close icon-button" aria-label="閉じる" onClick={()=>dialog.current?.close()}><X size={20}/></button>
      <h2 id="single-export-title">このハンドを出力</h2>
      <p>{prepared?.label}{prepared?.demo?' · 架空のデモデータ':''}</p>
      <p>GTOWizardの「Upload → Single Hand」に貼り付けるための英語のPokerStars互換テキストです。取り込み検証は未実施です。</p>
      <label htmlFor="single-hand-text">ハンド履歴テキスト（1件）</label>
      <textarea ref={field} id="single-hand-text" readOnly spellCheck={false} value={prepared?.text??''} onFocus={e=>e.currentTarget.select()}/>
      <div className="button-row"><button className="button primary" onClick={()=>void copy()}><Copy size={16}/>テキストをコピー</button><button className="button secondary" onClick={download}><Download size={16}/>この1件をダウンロード</button></div>
      {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    </dialog>
  </div>;
}
