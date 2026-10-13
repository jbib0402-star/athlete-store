"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getSupabaseBrowser } from "@/lib/supabase";

type Prize = {id:string;name:string;description:string;image_url:string;weight:number;is_active:boolean};
type DrawProduct = {id:string;name:string;price:number};
type Result = {inventory_id:string;name:string;description:string;image_url:string;count:number;remaining:number};
type Edit = {id?:string;name:string;description:string;image_url:string;weight:number;is_active:boolean};
const emptyEdit:Edit = {name:"",description:"",image_url:"",weight:1,is_active:true};

export default function GachaShop() {
 const supabase=useMemo(()=>getSupabaseBrowser(),[]);
 const [products,setProducts]=useState<DrawProduct[]>([]);
 const [product,setProduct]=useState<DrawProduct|null>(null);
 const [phase,setPhase]=useState<"ready"|"drawing"|"result">("ready");
 const [result,setResult]=useState<Result|null>(null);
 const [remaining,setRemaining]=useState(5);
 const [statusReady,setStatusReady]=useState(false);
 const [pool,setPool]=useState<Prize[]>([]);
 const [error,setError]=useState("");
 const [operator,setOperator]=useState(false);
 const [adminPage,setAdminPage]=useState<Element|null>(null);
 const [managerOpen,setManagerOpen]=useState(false);
 const [allPrizes,setAllPrizes]=useState<Prize[]>([]);
 const [edit,setEdit]=useState<Edit|null>(null);
 const [saving,setSaving]=useState(false);
 const [adminError,setAdminError]=useState("");
 const lock=useRef(false);
 const requestKey=useRef<string|null>(null);

 const load=useCallback(async()=>{
   if(!supabase)return;
   const {data:s}=await supabase.auth.getSession();
   if(!s.session){setProducts([]);setOperator(false);return;}
   const [p,me]=await Promise.all([
     supabase.from("products").select("id,name,price").eq("is_gacha",true).eq("is_active",true),
     supabase.from("profiles").select("role").eq("id",s.session.user.id).maybeSingle()
   ]);
   setProducts(p.data||[]);setOperator(me.data?.role==="admin"||me.data?.role==="staff");
 },[supabase]);
 useEffect(()=>{void load();if(!supabase)return;const {data}=supabase.auth.onAuthStateChange(()=>{void load();});window.addEventListener("athlete-data-changed",load);return()=>{data.subscription.unsubscribe();window.removeEventListener("athlete-data-changed",load);};},[supabase,load]);
 useEffect(()=>{
   const scan=()=>setAdminPage(document.querySelector(".admin-page"));
   scan();const o=new MutationObserver(scan);o.observe(document.body,{childList:true,subtree:true});return()=>o.disconnect();
 },[]);
 const refreshStatus=useCallback(async()=>{
   if(!supabase)return;
   const {data,error}=await supabase.rpc("gacha_daily_status");
   if(error)throw new Error(error.message);
   setRemaining(Number(data.remaining));setStatusReady(true);
 },[supabase]);
 useEffect(()=>{
   const click=(event:MouseEvent)=>{
     const node=event.target instanceof Element?event.target:null;
     const button=node?.closest<HTMLButtonElement>(".store-action-button.buy");
     if(!button || button.disabled)return;
     const name=button.closest(".product-card")?.querySelector("h3")?.textContent?.trim();
     const p=products.find(p=>p.name===name);if(!p)return;
     event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
     setProduct(p);setResult(null);setPhase("ready");setError("");setStatusReady(false);requestKey.current=null;
     void refreshStatus().catch(e=>setError(e.message));
     void supabase?.from("gacha_prizes").select("*").order("created_at").then(({data})=>setPool(data||[]));
   };
   document.addEventListener("click",click,true);return()=>document.removeEventListener("click",click,true);
 },[products,refreshStatus,supabase]);
 async function draw(){
   if(!supabase||!product||lock.current||!statusReady||remaining<=0)return;
   lock.current=true;setPhase("drawing");setError("");
   requestKey.current ||= crypto.randomUUID();
   const delay=new Promise(resolve=>setTimeout(resolve,window.matchMedia("(prefers-reduced-motion: reduce)").matches?0:1200));
   try{
     const {data,error}=await supabase.rpc("draw_gacha",{target_product_id:product.id,request_key:requestKey.current});
     if(error)throw new Error(error.message);
     await delay;setResult(data as Result);setRemaining(Number(data.remaining));setPhase("result");requestKey.current=null;
     window.dispatchEvent(new CustomEvent("athlete-data-changed"));
   }catch(e){setError(e instanceof Error?e.message:"뽑기를 완료하지 못했습니다. 다시 시도해주세요.");setPhase("ready");void refreshStatus().catch(()=>{});}
   finally{lock.current=false;}
 }
 async function adminRequest(action:string,payload:Record<string,unknown>={}){
   if(!supabase)throw new Error("로그인이 필요합니다.");
   const {data}=await supabase.auth.getSession();
   const res=await fetch("/api/admin",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${data.session?.access_token||""}`},body:JSON.stringify({action,payload})});
   const json=await res.json();if(!res.ok)throw new Error(json.error||"설정을 저장하지 못했습니다.");return json;
 }
 async function manage(){setManagerOpen(true);setAdminError("");try{const data=await adminRequest("list_gacha_prizes");setAllPrizes(data.items||[]);}catch(e){setAdminError(e instanceof Error?e.message:"불러오지 못했습니다.");}}
 async function save(){
   if(!edit||saving)return;setSaving(true);setAdminError("");
   try{await adminRequest("save_gacha_prize",edit as unknown as Record<string,unknown>);setEdit(null);const data=await adminRequest("list_gacha_prizes");setAllPrizes(data.items||[]);}
   catch(e){setAdminError(e instanceof Error?e.message:"저장하지 못했습니다.");}finally{setSaving(false);}
 }
 const total=pool.reduce((n,p)=>n+p.weight,0),adminTotal=allPrizes.filter(p=>p.is_active).reduce((n,p)=>n+p.weight,0);
 return <>
 {operator&&adminPage&&createPortal(<section className="panel gacha-admin-panel"><div className="panel-heading"><div><div className="eyebrow">MYSTERY GACHA</div><h2>잡동사니 뽑기 관리</h2><p className="muted">결과물의 이름·설명·이미지·등장 여부·확률 비중을 수정합니다.</p></div><button className="button outline" onClick={()=>void manage()}>결과물 관리</button></div></section>,adminPage)}
 {product&&<div className="gacha-backdrop"><section className={`gacha-modal ${phase}`} role="dialog" aria-modal="true" aria-label="잡동사니 뽑기">
   <button className="gacha-close" aria-label="닫기" disabled={phase==="drawing"} onClick={()=>setProduct(null)}>×</button>
   <span className="gacha-kicker">MYSTERY GACHA</span><h2>{phase==="result"&&result?result.name:product.name}</h2>
   <p className="gacha-count" role="status">오늘 남은 뽑기 {statusReady?remaining:"확인 중"} / 5회 · 한국시간 자정 초기화</p>
   {phase==="result"&&result?<><img className="gacha-result-image" src={result.image_url} alt={result.name}/><p className="gacha-description">{result.description}</p><p className="muted">내 보관함에 저장했어요. 선물하거나 나중에 다시 볼 수 있어요.</p><div className="gacha-actions"><button className="button outline" onClick={()=>setProduct(null)}>보관함에 보관하기</button><button className="button primary" disabled={remaining<=0} onClick={()=>void draw()}>한 번 더 · {product.price.toLocaleString()}P</button></div></>
    :phase==="drawing"?<div className="gacha-drawing" aria-live="polite"><div className="gacha-capsule">?</div><p>달그락 달그락… 무엇이 나올까요?</p></div>
    :<><div className="gacha-capsule">?</div><p className="gacha-description">쓸모 있는 물건부터 황당한 잡동사니까지!<br/>중복 당첨 가능 · 물건 1개가 보관함에 들어가요.</p><button className="button primary wide" disabled={!statusReady||remaining<=0||pool.length===0} onClick={()=>void draw()}>{remaining<=0?"오늘 뽑기 완료":`한 번 뽑기 · ${product.price.toLocaleString()}P`}</button>
      <details className="gacha-pool"><summary>뽑힐 수 있는 물건과 확률 보기 ({pool.length}종)</summary><div>{pool.map(p=><article key={p.id}><img src={p.image_url} alt="" loading="lazy"/><strong>{p.name}</strong><span>{total?(p.weight/total*100).toFixed(2):0}%</span><p>{p.description}</p></article>)}</div></details></>}
   {error&&<p className="form-error" role="alert">{error}</p>}
 </section></div>}
 {managerOpen&&<div className="gacha-backdrop"><section className="gacha-modal gacha-manager" role="dialog" aria-modal="true" aria-label="뽑기 결과물 관리"><button className="gacha-close" disabled={saving} onClick={()=>{setManagerOpen(false);setEdit(null);}} aria-label="닫기">×</button><h2>뽑기 결과물 관리</h2>
   {adminError&&<p className="form-error" role="alert">{adminError}</p>}
   {edit?<form onSubmit={e=>{e.preventDefault();void save();}}><label>아이템 이름<input maxLength={80} required value={edit.name} onChange={e=>setEdit({...edit,name:e.target.value})}/></label><label>설명<textarea rows={4} maxLength={1000} required value={edit.description} onChange={e=>setEdit({...edit,description:e.target.value})}/></label><label>이미지 URL<input required value={edit.image_url} onChange={e=>setEdit({...edit,image_url:e.target.value})} placeholder="https://…"/></label><label>확률 비중<input type="number" min={1} max={1000000} required value={edit.weight} onChange={e=>setEdit({...edit,weight:Number(e.target.value)})}/><small>1은 기본 비중입니다. 2로 바꾸면 비중 1인 물건보다 두 배 자주 나와요.</small></label><label className="gacha-check"><input type="checkbox" checked={edit.is_active} onChange={e=>setEdit({...edit,is_active:e.target.checked})}/>뽑기에서 등장</label><div className="gacha-actions"><button type="button" className="button outline" disabled={saving} onClick={()=>setEdit(null)}>취소</button><button className="button primary" disabled={saving}>{saving?"저장 중…":"저장"}</button></div></form>
   :<><button className="button primary" onClick={()=>setEdit({...emptyEdit})}>결과물 추가</button><div className="gacha-prize-list">{allPrizes.map(p=><article key={p.id}><img src={p.image_url} alt="" loading="lazy"/><div><strong>{p.name}</strong><p>{p.description}</p><small>{p.is_active?`${(p.weight/adminTotal*100).toFixed(2)}% · 비중 ${p.weight}`:"등장 중지"}</small></div><button className="button outline small" onClick={()=>setEdit({...p})}>수정</button></article>)}</div></>}
 </section></div>}
 </>;
}
