"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase";

type Prize = {id:string;name:string;description:string;image_url:string;weight:number;is_active:boolean};
type DrawProduct = {id:string;name:string;price:number};
type Result = {inventory_id:string;name:string;description:string;image_url:string};

export default function GachaShop() {
 const supabase=useMemo(()=>getSupabaseBrowser(),[]);
 const [products,setProducts]=useState<DrawProduct[]>([]);
 const [product,setProduct]=useState<DrawProduct|null>(null);
 const [phase,setPhase]=useState<"ready"|"drawing"|"result">("ready");
 const [result,setResult]=useState<Result|null>(null);
 const [poolReady,setPoolReady]=useState(false);
 const [pool,setPool]=useState<Prize[]>([]);
 const [error,setError]=useState("");
 const lock=useRef(false);
 const requestKey=useRef<string|null>(null);

 const load=useCallback(async()=>{
   if(!supabase)return;
   const {data:s}=await supabase.auth.getSession();
   if(!s.session){setProducts([]);return;}
   const {data}=await supabase.from("products").select("id,name,price").eq("is_gacha",true).eq("is_active",true);
   setProducts(data||[]);
 },[supabase]);
 useEffect(()=>{void load();if(!supabase)return;const {data}=supabase.auth.onAuthStateChange(()=>{void load();});window.addEventListener("athlete-data-changed",load);return()=>{data.subscription.unsubscribe();window.removeEventListener("athlete-data-changed",load);};},[supabase,load]);
 useEffect(()=>{
   const click=(event:MouseEvent)=>{
     const node=event.target instanceof Element?event.target:null;
     const button=node?.closest<HTMLButtonElement>(".store-action-button.buy");
     if(!button || button.disabled)return;
     const name=button.closest(".product-card")?.querySelector("h3")?.textContent?.trim();
     const p=products.find(p=>p.name===name);if(!p)return;
     event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
     setProduct(p);setResult(null);setPhase("ready");setError("");setPoolReady(false);setPool([]);requestKey.current=null;
     void (async()=>{
       if(!supabase)return;
       const {data,error}=await supabase.from("gacha_prizes").select("*").eq("is_active",true).order("created_at");
       if(error)throw new Error(error.message);
       setPool(data||[]);setPoolReady(true);
     })().catch(e=>setError(e instanceof Error?e.message:"뽑기 물품을 불러오지 못했습니다."));
   };
   document.addEventListener("click",click,true);return()=>document.removeEventListener("click",click,true);
 },[products,supabase]);
 async function draw(){
   if(!supabase||!product||lock.current||!poolReady||pool.length===0)return;
   lock.current=true;setPhase("drawing");setError("");
   requestKey.current ||= crypto.randomUUID();
   const delay=new Promise(resolve=>setTimeout(resolve,window.matchMedia("(prefers-reduced-motion: reduce)").matches?0:1200));
   try{
     const {data,error}=await supabase.rpc("draw_gacha",{target_product_id:product.id,request_key:requestKey.current});
     if(error)throw new Error(error.message);
     await delay;setResult(data as Result);setPhase("result");requestKey.current=null;
     window.dispatchEvent(new CustomEvent("athlete-data-changed"));
   }catch(e){setError(e instanceof Error?e.message:"뽑기를 완료하지 못했습니다. 다시 시도해주세요.");setPhase("ready");}
   finally{lock.current=false;}
 }
 const total=pool.reduce((n,p)=>n+p.weight,0);
 return <>
 {product&&<div className="gacha-backdrop"><section className={`gacha-modal ${phase}`} role="dialog" aria-modal="true" aria-label="잡동사니 뽑기">
   <button className="gacha-close" aria-label="닫기" disabled={phase==="drawing"} onClick={()=>setProduct(null)}>×</button>
   <span className="gacha-kicker">MYSTERY GACHA</span><h2>{phase==="result"&&result?result.name:product.name}</h2>
   <p className="gacha-count" role="status">횟수 제한 없이 뽑을 수 있어요.</p>
   {phase==="result"&&result?<><img className="gacha-result-image" src={result.image_url} alt={result.name}/><p className="gacha-description">{result.description}</p><p className="muted">잡동사니 수집 앨범에 한 장 추가했어요! 보관함에서 확인하고 선물할 수 있어요.</p><div className="gacha-actions"><button className="button outline" onClick={()=>setProduct(null)}>보관함에 보관하기</button><button className="button primary" disabled={!poolReady||pool.length===0} onClick={()=>void draw()}>한 번 더 · {product.price.toLocaleString()}P</button></div></>
    :phase==="drawing"?<div className="gacha-drawing" aria-live="polite"><div className="gacha-capsule">?</div><p>달그락 달그락… 무엇이 나올까요?</p></div>
    :<><div className="gacha-capsule">?</div><p className="gacha-description">쓸모 있는 물건부터 황당한 잡동사니까지!<br/>중복 당첨 가능 · 물건 1개가 보관함에 들어가요.</p><button className="button primary wide" disabled={!poolReady||pool.length===0} onClick={()=>void draw()}>{poolReady ? `한 번 뽑기 · ${product.price.toLocaleString()}P` : "물품 확인 중…"}</button>
      <details className="gacha-pool"><summary>뽑힐 수 있는 물건과 확률 보기 ({pool.length}종)</summary><div>{pool.map(p=><article key={p.id}><img src={p.image_url} alt="" loading="lazy"/><strong>{p.name}</strong><span>{total?(p.weight/total*100).toFixed(2):0}%</span><p>{p.description}</p></article>)}</div></details></>}
   {error&&<p className="form-error" role="alert">{error}</p>}
 </section></div>}
 </>;
}
