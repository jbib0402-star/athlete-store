"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { History, Minus, PackageCheck, Plus, RotateCcw } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase";

type PointHistoryRow = {
  id: string;
  amount: number;
  description: string;
  created_at: string;
};

type UsedItemRow = {
  id: string;
  product_name: string;
  used_at: string;
  effect_text: string | null;
  effect_duration_hours: number | null;
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatPoints(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

export default function ProfileHistoryEnhancer() {
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [pointLogs, setPointLogs] = useState<PointHistoryRow[]>([]);
  const [usedItems, setUsedItems] = useState<UsedItemRow[]>([]);
  const [currency, setCurrency] = useState("P");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError("");

    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) {
      setLoading(false);
      return;
    }

    const [logsRes, inventoryRes, settingsRes] = await Promise.all([
      supabase
        .from("point_logs")
        .select("id,amount,description,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("inventory")
        .select("id,product_name,used_at,effect_text,effect_duration_hours")
        .eq("user_id", userId)
        .not("used_at", "is", null)
        .order("used_at", { ascending: false })
        .limit(100),
      supabase
        .from("app_settings")
        .select("value")
        .eq("key", "currency_name")
        .maybeSingle()
    ]);

    if (logsRes.error || inventoryRes.error) {
      setError(logsRes.error?.message || inventoryRes.error?.message || "내역을 불러오지 못했습니다.");
    } else {
      setPointLogs((logsRes.data || []) as PointHistoryRow[]);
      setUsedItems((inventoryRes.data || []) as UsedItemRow[]);
      if (settingsRes.data?.value) setCurrency(String(settingsRes.data.value));
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) refresh();
      else {
        setPointLogs([]);
        setUsedItems([]);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [supabase, refresh]);

  useEffect(() => {
    const scan = () => {
      const profilePage = document.querySelector<HTMLElement>(".profile-page");
      const originalHistory = profilePage?.querySelector<HTMLElement>(".history-panel") || null;

      if (!profilePage || !originalHistory) {
        setMount(previous => previous && document.body.contains(previous) ? previous : null);
        return;
      }

      originalHistory.style.display = "none";
      let target = profilePage.querySelector<HTMLElement>(".profile-history-enhanced-mount");
      if (!target) {
        target = document.createElement("div");
        target.className = "profile-history-enhanced-mount";
        originalHistory.insertAdjacentElement("beforebegin", target);
        refresh();
      }
      setMount(previous => previous === target ? previous : target);
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [refresh]);

  if (!mount) return null;

  return createPortal(
    <div className="profile-history-grid">
      <section className="panel profile-history-panel">
        <div className="panel-heading profile-history-heading">
          <div>
            <div className="eyebrow">POINT HISTORY</div>
            <h2>포인트 내역</h2>
          </div>
          <button className={`profile-history-refresh ${loading ? "loading" : ""}`} type="button" onClick={refresh} disabled={loading} aria-label="내역 새로고침" title="내역 새로고침">
            <RotateCcw size={20}/>
          </button>
        </div>

        {error ? <div className="profile-history-error">{error}</div> : pointLogs.length ? (
          <div className="history-list profile-history-scroll">
            {pointLogs.map(log => <div className="history-row" key={log.id}>
              <div className={`history-sign ${log.amount >= 0 ? "plus" : "minus"}`}>{log.amount >= 0 ? <Plus/> : <Minus/>}</div>
              <div><strong>{log.description}</strong><span>{formatDateTime(log.created_at)}</span></div>
              <b className={log.amount >= 0 ? "positive" : "negative"}>{log.amount >= 0 ? "+" : ""}{formatPoints(log.amount)} {currency}</b>
            </div>)}
          </div>
        ) : <div className="empty-state compact"><History size={30}/><h3>아직 포인트 내역이 없습니다.</h3></div>}
      </section>

      <section className="panel profile-history-panel">
        <div className="panel-heading profile-history-heading">
          <div>
            <div className="eyebrow">ITEM HISTORY</div>
            <h2>아이템 사용 내역</h2>
          </div>
          <PackageCheck size={21}/>
        </div>

        {usedItems.length ? (
          <div className="item-use-history-list profile-history-scroll">
            {usedItems.map(item => <div className="item-use-history-row" key={item.id}>
              <div className="item-use-history-icon"><PackageCheck size={18}/></div>
              <div>
                <strong>{item.product_name}</strong>
                {item.effect_text && <p>{item.effect_text}{item.effect_duration_hours ? ` · ${item.effect_duration_hours}시간 지속` : ""}</p>}
                <span>{formatDateTime(item.used_at)} 사용</span>
              </div>
            </div>)}
          </div>
        ) : <div className="empty-state compact"><PackageCheck size={30}/><h3>아직 사용한 아이템이 없습니다.</h3><p>보관함에서 사용한 아이템이 여기에 기록됩니다.</p></div>}
      </section>
    </div>,
    mount
  );
}
