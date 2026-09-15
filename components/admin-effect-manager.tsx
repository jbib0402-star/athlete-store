"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getSupabaseBrowser } from "@/lib/supabase";

type ManagedEffect = {
  representative_id: string;
  user_id: string;
  username: string;
  character_name: string;
  product_name: string;
  effect_text: string | null;
  effect_duration_hours: number | null;
  effect_expires_at: string;
  stack_count: number;
};

function formatRemaining(expiresAt: string) {
  const ms = Math.max(0, new Date(expiresAt).getTime() - Date.now());
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}분 남음`;
  return `${hours}시간 ${minutes}분 남음`;
}

export default function AdminEffectManager() {
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPage, setAdminPage] = useState<HTMLElement | null>(null);
  const [effects, setEffects] = useState<ManagedEffect[]>([]);
  const [loading, setLoading] = useState(false);
  const [clearingId, setClearingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  const showNotice = useCallback((text: string, error = false) => {
    setNotice({ text, error });
    window.setTimeout(() => setNotice(null), 3200);
  }, []);

  const request = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    if (!supabase) throw new Error("서버 연결 정보를 확인해주세요.");
    const { data: sessionData } = await supabase.auth.getSession();
    const response = await fetch("/api/admin-effects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionData.session?.access_token || ""}`
      },
      body: JSON.stringify({ action, payload })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
    return data;
  }, [supabase]);

  const loadEffects = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const data = await request("list_active_effects");
      setEffects((data.effects || []) as ManagedEffect[]);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "상태이상을 불러오지 못했습니다.", true);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, request, showNotice]);

  useEffect(() => {
    if (!supabase) return;
    const checkAdmin = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) return setIsAdmin(false);
      const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
      setIsAdmin(data?.role === "admin");
    };
    checkAdmin();
    const { data } = supabase.auth.onAuthStateChange(() => checkAdmin());
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    const scan = () => {
      const page = document.querySelector<HTMLElement>(".admin-page");
      const activeTab = page?.querySelector<HTMLButtonElement>(".admin-tabs button.active");
      const isMemberPointsTab = Boolean(activeTab?.textContent?.includes("회원") && activeTab?.textContent?.includes("포인트"));
      const target = isMemberPointsTab ? page || null : null;
      setAdminPage(previous => previous === target ? previous : target);
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isAdmin || !adminPage) return;
    loadEffects();
  }, [isAdmin, adminPage, loadEffects]);

  async function clearEffect(effect: ManagedEffect) {
    const stackText = effect.stack_count > 1 ? ` (${effect.stack_count}개 중첩 전체)` : "";
    if (!window.confirm(`${effect.character_name}의 '${effect.product_name}' 상태이상${stackText}을 삭제할까요?\n아이템 사용 기록은 남고 현재 효과만 종료됩니다.`)) return;

    setClearingId(effect.representative_id);
    try {
      const data = await request("clear_active_effect", { inventory_id: effect.representative_id });
      showNotice(data.message || "상태이상을 종료했습니다.");
      await loadEffects();
      window.setTimeout(() => window.location.reload(), 450);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "상태이상을 삭제하지 못했습니다.", true);
    } finally {
      setClearingId(null);
    }
  }

  if (!isAdmin || !adminPage) return null;

  return createPortal(<>
    {notice && <div className={`admin-effect-notice ${notice.error ? "error" : ""}`}>{notice.text}</div>}
    <section className="panel admin-effect-manager">
      <div className="panel-heading admin-effect-heading">
        <div>
          <div className="eyebrow">ACTIVE EFFECTS · ADMIN TEST</div>
          <h2>상태이상 관리</h2>
          <p>테스트용으로 현재 적용 중인 효과만 종료할 수 있습니다. 아이템 사용 기록은 유지됩니다.</p>
        </div>
        <button type="button" className="button outline small" disabled={loading} onClick={loadEffects}>{loading ? "불러오는 중…" : "새로고침"}</button>
      </div>

      {effects.length ? <div className="admin-effect-list">
        {effects.map(effect => <article className="admin-effect-row" key={`${effect.user_id}-${effect.representative_id}`}>
          <div className="admin-effect-user">
            <strong>{effect.character_name}</strong>
            <span>@{effect.username}</span>
          </div>
          <div className="admin-effect-detail">
            <strong>{effect.product_name}{effect.stack_count > 1 && <em> ×{effect.stack_count} 중첩</em>}</strong>
            <span>{effect.effect_text || "아이템 효과 적용 중"}</span>
            <small>{effect.effect_duration_hours ? `${effect.effect_duration_hours}시간 효과 · ` : ""}{formatRemaining(effect.effect_expires_at)}</small>
          </div>
          <button type="button" className="button danger small" disabled={clearingId === effect.representative_id} onClick={() => clearEffect(effect)}>
            {clearingId === effect.representative_id ? "삭제 중…" : "효과 삭제"}
          </button>
        </article>)}
      </div> : <div className="admin-effect-empty">현재 적용 중인 상태이상이 없습니다.</div>}
    </section>
  </>, adminPage);
}
