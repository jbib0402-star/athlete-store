"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Gift, X } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase";

type GiftNotice = {
  id: string;
  product_name: string;
  product_image_url: string | null;
  gift_from_name: string;
  purchased_at: string;
};

export default function GiftArrivalNotifier() {
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [queue, setQueue] = useState<GiftNotice[]>([]);
  const [closing, setClosing] = useState(false);

  const loadUnseen = useCallback(async () => {
    if (!supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) {
      setQueue([]);
      return;
    }

    const { data, error } = await supabase
      .from("inventory")
      .select("id,product_name,product_image_url,gift_from_name,purchased_at")
      .eq("user_id", userId)
      .not("gift_from_name", "is", null)
      .is("gift_notice_seen_at", null)
      .order("purchased_at", { ascending: true })
      .limit(20);

    if (error || !data) return;

    const incoming = data
      .filter(row => row.gift_from_name)
      .map(row => ({
        id: String(row.id),
        product_name: String(row.product_name),
        product_image_url: row.product_image_url ? String(row.product_image_url) : null,
        gift_from_name: String(row.gift_from_name),
        purchased_at: String(row.purchased_at)
      }));

    setQueue(current => {
      const byId = new Map<string, GiftNotice>();
      for (const item of current) byId.set(item.id, item);
      for (const item of incoming) byId.set(item.id, item);
      return Array.from(byId.values()).sort(
        (a, b) => new Date(a.purchased_at).getTime() - new Date(b.purchased_at).getTime()
      );
    });
  }, [supabase]);

  useEffect(() => {
    if (!supabase) return;

    let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
    let disposed = false;

    const connectRealtime = async () => {
      if (realtimeChannel) {
        await supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId || disposed) {
        setQueue([]);
        return;
      }

      await loadUnseen();
      if (disposed) return;

      realtimeChannel = supabase
        .channel(`gift-arrivals:${userId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "inventory",
            filter: `user_id=eq.${userId}`
          },
          () => {
            void loadUnseen();
          }
        )
        .subscribe(status => {
          if (status === "SUBSCRIBED") void loadUnseen();
        });
    };

    void connectRealtime();

    // Realtime가 잠시 끊겨도 선물을 놓치지 않도록 짧은 폴링을 안전망으로 유지합니다.
    const interval = window.setInterval(() => void loadUnseen(), 10000);
    const onFocus = () => void loadUnseen();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void loadUnseen();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const { data } = supabase.auth.onAuthStateChange(() => {
      setQueue([]);
      void connectRealtime();
    });

    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      data.subscription.unsubscribe();
      if (realtimeChannel) void supabase.removeChannel(realtimeChannel);
    };
  }, [supabase, loadUnseen]);

  const current = queue[0] || null;

  const dismiss = useCallback(async (id: string) => {
    if (!supabase || closing) return;
    setClosing(true);

    await supabase.rpc("mark_gift_notice_seen", { inventory_item_id: id });
    window.setTimeout(() => {
      setQueue(items => items.filter(item => item.id !== id));
      setClosing(false);
    }, 280);
  }, [supabase, closing]);

  useEffect(() => {
    if (!current || closing) return;

    let timer: number | null = null;
    const schedule = () => {
      if (timer) window.clearTimeout(timer);
      if (document.visibilityState === "visible") {
        timer = window.setTimeout(() => void dismiss(current.id), 8000);
      }
    };

    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => {
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [current, closing, dismiss]);

  if (!current) return null;

  return <aside className={`gift-arrival-toast ${closing ? "closing" : ""}`} role="status" aria-live="polite">
    <div className="gift-arrival-icon">
      {current.product_image_url
        ? <img src={current.product_image_url} alt="" />
        : <Gift size={23} />}
    </div>
    <div className="gift-arrival-copy">
      <span>GIFT DELIVERY</span>
      <strong>선물이 도착했습니다!</strong>
      <p><b>{current.gift_from_name}</b>님이 <em>{current.product_name}</em>을 선물했어요.</p>
      {queue.length > 1 && <small>대기 중인 선물 {queue.length - 1}개</small>}
    </div>
    <button type="button" className="gift-arrival-close" aria-label="선물 알림 닫기" onClick={() => void dismiss(current.id)}>
      <X size={17} />
    </button>
  </aside>;
}
