"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase";

export type GachaItem = { id: string; product_name: string; product_image_url: string | null; gacha_description: string | null; used_at?: string | null };
export default function GachaItemDialog({ item, onClose, onChanged, readOnly = false }: { readOnly?: boolean; item: GachaItem; onClose: () => void; onChanged?: () => void }) {
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [members,setMembers] = useState<{id:string;character_name:string;username:string}[]>([]);
  const [recipient,setRecipient] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const lock = useRef(false);
  useEffect(() => { if (!supabase || item.used_at || readOnly) return; void (async()=>{
    const {data:session}=await supabase.auth.getSession();
    const {data}=await supabase.from("profiles").select("id,character_name,username").neq("id",session.session?.user.id || "").order("character_name");
    setMembers(data || []);
  })(); },[supabase,item.used_at,readOnly]);
  async function act(gift:boolean) {
    if (!supabase || lock.current || readOnly || item.used_at) return;
    if (!gift && !window.confirm("이 아이템을 사용하고 사용 내역에 남길까요?")) return;
    lock.current=true;setBusy(true);setError("");
    try {
      const {error}=gift ? await supabase.rpc("gift_gacha_item",{inventory_item_id:item.id,recipient_id:recipient})
        : await supabase.rpc("use_inventory_item",{inventory_item_id:item.id});
      if(error) throw new Error(error.message);
      window.dispatchEvent(new CustomEvent("athlete-data-changed"));onChanged?.();onClose();
    } catch(e){setError(e instanceof Error?e.message:"처리하지 못했습니다.");}
    finally{lock.current=false;setBusy(false);}
  }
  return <div className="gacha-backdrop"><section className="gacha-modal" role="dialog" aria-modal="true" aria-label="뽑기 아이템">
    <button type="button" className="gacha-close" disabled={busy} onClick={onClose} aria-label="닫기">×</button>
    <span className="gacha-kicker">ODDS & ENDS</span><h2>{item.product_name}</h2>
    {item.product_image_url && <img className="gacha-result-image" src={item.product_image_url} alt={item.product_name}/>}
    <p className="gacha-description">{item.gacha_description}</p>
    {!item.used_at && !readOnly && <><label>선물 받을 캐릭터<select value={recipient} disabled={busy} onChange={e=>setRecipient(e.target.value)}><option value="">캐릭터 선택</option>{members.map(m=><option key={m.id} value={m.id}>{m.character_name} · @{m.username}</option>)}</select></label>
    <div className="gacha-actions"><button className="button outline" disabled={busy||!recipient} onClick={()=>void act(true)}>이 물건 선물하기</button><button className="button outline" disabled={busy} onClick={()=>void act(false)}>사용하고 기록에 남기기</button></div></>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <button className="button primary wide" disabled={busy} onClick={onClose}>{item.used_at || readOnly ? "닫기" : "보관하기"}</button>
  </section></div>;
}
