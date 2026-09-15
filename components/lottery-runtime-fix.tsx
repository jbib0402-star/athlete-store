"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { getSupabaseBrowser } from "@/lib/supabase";

type LotteryProduct = { id: string; name: string };
type ScratchResult = {
  product_name: string;
  result_label: string;
  reward_points: number;
  attempt_no: number;
  daily_limit: number;
};

function ScratchTicket({ result, onClose }: { result: ScratchResult; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scratchingRef = useRef(false);
  const scratchedCells = useRef(new Set<string>());
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    canvas.width = 620;
    canvas.height = 230;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#b8bdc3";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(255,255,255,.28)";
    ctx.lineWidth = 10;
    for (let x = -220; x < 820; x += 34) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 220, 230);
      ctx.stroke();
    }
    ctx.fillStyle = "#5e6670";
    ctx.font = "800 24px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("긁어서 행운을 확인하세요!", 310, 115);
  }, []);

  const scratch = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!scratchingRef.current || revealed) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (canvas.width / rect.width);
    const y = (event.clientY - rect.top) * (canvas.height / rect.height);

    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(x, y, 34, 0, Math.PI * 2);
    ctx.fill();

    const cellX = Math.max(0, Math.min(11, Math.floor(x / (canvas.width / 12))));
    const cellY = Math.max(0, Math.min(4, Math.floor(y / (canvas.height / 5))));
    scratchedCells.current.add(`${cellX}:${cellY}`);
    if (scratchedCells.current.size >= 22) setRevealed(true);
  };

  return createPortal(
    <div className="lottery-backdrop">
      <section className="lottery-modal" role="dialog" aria-modal="true" aria-labelledby="lottery-runtime-title">
        <div className="lottery-ticket-top">
          <div><span>DAILY SCRATCH</span><h2 id="lottery-runtime-title">{result.product_name}</h2></div>
          <b>오늘 {result.attempt_no} / {result.daily_limit}회</b>
        </div>
        <p className="lottery-guide">은색 부분을 마우스나 손가락으로 긁어 결과를 확인해주세요!</p>
        <div className={`scratch-card ${revealed ? "revealed" : ""}`}>
          <div className="scratch-result">
            <span>{result.reward_points > 0 ? "🎉 WINNER" : "TRY AGAIN"}</span>
            <strong>{result.result_label}</strong>
            <p>{result.reward_points > 0 ? `+${result.reward_points.toLocaleString("ko-KR")} P가 자동 지급되었습니다!` : "아쉽지만 다음 복권의 행운을 노려보세요!"}</p>
          </div>
          <canvas
            ref={canvasRef}
            onPointerDown={event => {
              scratchingRef.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              scratch(event);
            }}
            onPointerMove={scratch}
            onPointerUp={() => { scratchingRef.current = false; }}
            onPointerCancel={() => { scratchingRef.current = false; }}
          />
        </div>
        {!revealed
          ? <p className="lottery-progress-hint">조금 더 긁으면 결과가 완전히 공개됩니다.</p>
          : <button type="button" className="button primary wide lottery-close" onClick={onClose}>결과 확인</button>}
      </section>
    </div>,
    document.body
  );
}

export default function LotteryRuntimeFix() {
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [lotteryProducts, setLotteryProducts] = useState<LotteryProduct[]>([]);
  const [scratchQueue, setScratchQueue] = useState<ScratchResult[]>([]);
  const [limitNotice, setLimitNotice] = useState<string | null>(null);
  const processingRef = useRef(new Set<string>());

  const loadLotteryProducts = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from("products")
      .select("id,name")
      .eq("special_type", "lottery")
      .eq("is_active", true);
    setLotteryProducts((data || []) as LotteryProduct[]);
  }, [supabase]);

  useEffect(() => {
    loadLotteryProducts();
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange(() => loadLotteryProducts());
    return () => data.subscription.unsubscribe();
  }, [supabase, loadLotteryProducts]);

  const pushResult = useCallback((result: ScratchResult) => {
    setScratchQueue(queue => [...queue, result]);
  }, []);

  const playInventoryLottery = useCallback(async (product: LotteryProduct, inventoryId: string) => {
    if (!supabase || processingRef.current.has(inventoryId)) return;
    processingRef.current.add(inventoryId);
    try {
      const { data, error } = await supabase.rpc("play_lottery", { inventory_item_id: inventoryId });
      if (error) {
        setLimitNotice(error.message);
        return;
      }
      pushResult(data as ScratchResult);
    } finally {
      processingRef.current.delete(inventoryId);
    }
  }, [supabase, pushResult]);

  const findUnusedLotteryInventory = useCallback(async (product: LotteryProduct) => {
    if (!supabase) return null;
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) return null;
    const { data } = await supabase
      .from("inventory")
      .select("id")
      .eq("user_id", userId)
      .eq("product_id", product.id)
      .is("used_at", null)
      .order("purchased_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.id ? String(data.id) : null;
  }, [supabase]);

  const autoPlayRecentCartLotteries = useCallback(async (startedAt: string) => {
    if (!supabase || !lotteryProducts.length) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) return;
    const lotteryIds = new Set(lotteryProducts.map(product => product.id));

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await new Promise(resolve => window.setTimeout(resolve, 500));
      const { data } = await supabase
        .from("inventory")
        .select("id,product_id,purchased_at")
        .eq("user_id", userId)
        .is("used_at", null)
        .gte("purchased_at", startedAt)
        .order("purchased_at", { ascending: true });

      const recent = (data || []).filter(row => row.product_id && lotteryIds.has(String(row.product_id)));
      if (!recent.length) continue;

      for (const row of recent) {
        const product = lotteryProducts.find(item => item.id === String(row.product_id));
        if (!product) continue;
        await playInventoryLottery(product, String(row.id));
      }
      return;
    }
  }, [supabase, lotteryProducts, playInventoryLottery]);

  useEffect(() => {
    if (!supabase) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const buyButton = target.closest<HTMLButtonElement>(".store-action-button.buy");
      if (buyButton) {
        const card = buyButton.closest<HTMLElement>(".product-card");
        const productName = card?.querySelector("h3")?.textContent?.trim() || "";
        const product = lotteryProducts.find(item => item.name === productName);
        if (!product) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (!window.confirm(`${product.name}을(를) 구매하고 바로 복권을 긁을까요?`)) return;

        void (async () => {
          const key = `purchase:${product.id}`;
          if (processingRef.current.has(key)) return;
          processingRef.current.add(key);
          try {
            const { data, error } = await supabase.rpc("purchase_lottery", { target_product_id: product.id });
            if (error) {
              setLimitNotice(error.message);
              return;
            }
            pushResult(data as ScratchResult);
          } finally {
            processingRef.current.delete(key);
          }
        })();
        return;
      }

      const inventoryButton = target.closest<HTMLButtonElement>(".inventory-card button");
      if (inventoryButton && inventoryButton.textContent?.includes("사용")) {
        const card = inventoryButton.closest<HTMLElement>(".inventory-card");
        const productName = card?.querySelector("strong")?.textContent?.trim() || "";
        const product = lotteryProducts.find(item => item.name === productName);
        if (!product) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (!window.confirm(`${product.name}을(를) 사용하고 복권을 긁을까요?`)) return;

        void (async () => {
          const inventoryId = await findUnusedLotteryInventory(product);
          if (!inventoryId) {
            setLimitNotice("사용할 수 있는 복권을 찾지 못했습니다. 새로고침 후 다시 시도해주세요.");
            return;
          }
          await playInventoryLottery(product, inventoryId);
        })();
        return;
      }

      const checkoutButton = target.closest<HTMLButtonElement>(".checkout-box button.button.primary.wide");
      if (checkoutButton && checkoutButton.textContent?.includes("전부 구매")) {
        const startedAt = new Date(Date.now() - 1000).toISOString();
        void autoPlayRecentCartLotteries(startedAt);
      }
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [supabase, lotteryProducts, findUnusedLotteryInventory, playInventoryLottery, pushResult, autoPlayRecentCartLotteries]);

  useEffect(() => {
    const syncAdminVisibility = () => {
      const activeTab = document.querySelector<HTMLButtonElement>(".admin-tabs button.active");
      const isMembers = Boolean(activeTab?.textContent?.includes("회원"));
      document.querySelectorAll<HTMLElement>(".lottery-admin-usage").forEach(section => {
        section.style.display = isMembers ? "" : "none";
      });
    };

    syncAdminVisibility();
    const observer = new MutationObserver(syncAdminVisibility);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const closeScratch = useCallback(() => {
    setScratchQueue(queue => {
      const next = queue.slice(1);
      if (!next.length) window.setTimeout(() => window.location.reload(), 80);
      return next;
    });
  }, []);

  const current = scratchQueue[0] || null;

  return <>
    {current && <ScratchTicket result={current} onClose={closeScratch} />}
    {limitNotice && createPortal(
      <div className="lottery-backdrop" onMouseDown={() => setLimitNotice(null)}>
        <section className="lottery-limit-modal" role="alertdialog" aria-modal="true" onMouseDown={event => event.stopPropagation()}>
          <div className="lottery-limit-icon">🎟️</div>
          <span>DAILY LOTTERY</span>
          <h2>복권 이용 안내</h2>
          <p>{limitNotice}</p>
          <button type="button" className="button primary wide" onClick={() => setLimitNotice(null)}>확인</button>
        </section>
      </div>,
      document.body
    )}
  </>;
}
