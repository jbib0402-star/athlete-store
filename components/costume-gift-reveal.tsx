"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Gift, X } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase";

export default function CostumeGiftReveal({ itemId, name, onClose, onOpened }: {
  itemId: string; name: string; onClose: () => void; onOpened?: () => void;
}) {
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [phase, setPhase] = useState<"ready" | "opening" | "revealed" | "error">("ready");
  const [imageUrl, setImageUrl] = useState("");
  const [from, setFrom] = useState("");
  const [error, setError] = useState("");
  const dialog = useRef<HTMLElement>(null);
  const running = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !running.current) close.current();
      if (event.key === "Tab") {
        const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]');
        if (!controls?.length) { event.preventDefault(); return; }
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); if (previous?.isConnected) previous.focus(); };
  }, []);

  async function open() {
    if (running.current || !supabase) return;
    running.current = true; setPhase("opening"); setError("");
    const delay = new Promise(resolve => setTimeout(resolve, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 100 : 2200));
    try {
      const { data, error: rpcError } = await supabase.rpc("open_costume_gift", { inventory_item_id: itemId });
      if (rpcError) throw new Error(rpcError.message);
      onOpened?.();
      const { data: signed, error: urlError } = await supabase.storage.from("costume-gifts").createSignedUrl(data.path, 3600);
      if (urlError || !signed) throw new Error(urlError?.message || "이미지를 불러오지 못했습니다.");
      await Promise.all([delay, new Promise<void>((resolve, reject) => {
        const image = new Image();
        const timeout = setTimeout(() => reject(new Error("이미지 로딩이 지연되고 있습니다. 다시 시도해주세요.")), 15000);
        image.onload = () => { clearTimeout(timeout); resolve(); };
        image.onerror = () => { clearTimeout(timeout); reject(new Error("이미지를 불러오지 못했습니다. 다시 시도해주세요.")); };
        image.src = signed.signedUrl;
      })]);
      setFrom(data.from || ""); setImageUrl(signed.signedUrl); setPhase("revealed");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "상자를 열지 못했습니다."); setPhase("error"); }
    finally { running.current = false; }
  }

  return <div className="costume-reveal-backdrop" onMouseDown={() => !running.current && onClose()}>
    <section className={`costume-reveal ${phase}`} ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="costume-reveal-title" onMouseDown={event => event.stopPropagation()}>
      <button type="button" className="icon-button costume-close" aria-label="닫기" disabled={phase === "opening"} onClick={onClose}><X/></button>
      <h2 id="costume-reveal-title">{phase === "revealed" ? "짜잔! 선물이 도착했어요" : name}</h2>
      {phase === "revealed" ? <>
        {from && <p>{from}에게 받은 선물</p>}
        <img className="costume-revealed-image" src={imageUrl} alt={`${from || "친구"}에게 받은 코스튬 선물`}/>
        <div className="costume-reveal-actions"><a className="button outline" href={imageUrl} target="_blank" rel="noopener noreferrer">이미지 새 창으로 보기</a><button className="button primary" onClick={onClose}>닫기</button></div>
      </> : <>
        <div className="costume-box-icon"><Gift size={100} strokeWidth={1.5}/></div>
        <p aria-live="polite">{phase === "opening" ? "두구두구… 어떤 선물일까요?" : "상자를 열어 선물 이미지를 확인해보세요."}</p>
        {phase === "error" && <p role="alert" className="costume-error">{error}</p>}
        <button className="button primary" disabled={phase === "opening" || !supabase} onClick={open}>{phase === "opening" ? "개봉 중…" : phase === "error" ? "다시 시도" : "선물상자 열기"}</button>
      </>}
    </section>
  </div>;
}
